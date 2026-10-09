/**
 * **Debate's reader-picked claim checks, as the reading view sees them** — the
 * article's checks, read, and the one thing you can do: press Check.
 * docs/plans/261008i-debate-claims-picked-by-the-reader.md § 3.
 *
 * The read half is `GET /api/debate-claims/:slug/checks`, which also sweeps a
 * check whose server died. The write half is the POST, an SSE stream that
 * opens with the `pending` check (`begin`) and closes with it finished
 * (`done`), and only after the answer is stored — so the stream's `done` is
 * the same row a reload would read.
 *
 * ## The button is held from press to answer
 *
 * `sending` is set by the press and cleared only once the `done` frame has
 * been read into `checks`, or the press failed — so there is no frame of the
 * panel between the two where the button looks pressable over a check that is
 * still out. A check pending from **another tab** holds it too (the panel asks
 * `checks`), and while one is out this tab reads again every
 * `PENDING_POLL_MS`, so the other tab's answer arrives here without a reload.
 *
 * **Nothing here ever spends on arrival.** Only `check()` POSTs, and only a
 * press calls it.
 *
 * ## Newest wins
 *
 * Focus, a retry and the pending poll can each send a read, and the replies
 * can arrive in any order. Every read is numbered when it is sent, and a reply
 * older than the newest one applied is dropped — and so is any read sent
 * before a frame from this tab's own stream was applied, since the frame is
 * newer than what that read will say (GPT Sol's E11).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DebateCheckRequest, DebateClaimCheck, DebateClaimChecksResponse } from "../types.js";
import { apiFetch, failure, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { MalformedReply } from "./lib/reader-facing.js";
import { readAnswerStream } from "./lib/sse.js";

/** How often to read again while a check from elsewhere is out. */
export const PENDING_POLL_MS = 15_000;

export interface UseDebateChecks {
  status: "loading" | "ready" | "error";
  /** Every check on the article, oldest first. The panel draws the ones under the current list. */
  checks: readonly DebateClaimCheck[];
  /** Why the read failed, if it did. */
  error: string | null;
  /** This tab's press is out: from the press until its answer is read. */
  sending: boolean;
  /** Why this tab's last press failed before a check was stored. Cleared by the next press. */
  pressError: string | null;
  /**
   * Press Check. One web search; the caller has already decided it may.
   * True when the stored answer was read, so the panel can clear what was
   * picked; false when the press failed and the picks should stay.
   */
  check(request: DebateCheckRequest): Promise<boolean>;
  /** Read again. Never spends. */
  refresh(): Promise<void>;
}

function isCheck(value: unknown): value is DebateClaimCheck {
  const v = value as Partial<DebateClaimCheck> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.id === "string" &&
    typeof v.status === "string" &&
    Array.isArray(v.targets) &&
    Array.isArray(v.results)
  );
}

/** One check in, replacing any with its id, keeping creation order and never regressing a terminal row. */
function withCheck(checks: readonly DebateClaimCheck[], check: DebateClaimCheck): DebateClaimCheck[] {
  const at = checks.findIndex((c) => c.id === check.id);
  if (at === -1) return [...checks, check];
  if (checks[at]!.status !== "pending" && check.status === "pending") return [...checks];
  const next = [...checks];
  next[at] = check;
  return next;
}

/** Does a stored check belong to this press? Own-claim ids are minted by the server. */
function answersRequest(check: DebateClaimCheck, request: DebateCheckRequest): boolean {
  if (request.digFurther !== undefined) {
    return check.digFurther && check.targets.length === 1 && check.targets[0]?.claimId === request.digFurther;
  }
  if (check.digFurther) return false;

  const listed = check.targets.filter((target) => target.kind === "listed").map((target) => target.claimId);
  const asked = request.claimIds ?? [];
  if (listed.length !== asked.length || listed.some((claimId, at) => claimId !== asked[at])) return false;

  const own = check.targets.filter((target) => target.kind === "own");
  return request.own === undefined
    ? own.length === 0
    : own.length === 1 && own[0]?.text === request.own.trim();
}

function later(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, PENDING_POLL_MS));
}

/** Reconcile an accepted POST whose answer stream broke, using free reads only. */
async function waitForStoredCheck(
  mine: string,
  current: { readonly current: string },
  before: ReadonlySet<string>,
  request: DebateCheckRequest,
  begunId: string | null,
  refresh: () => Promise<readonly DebateClaimCheck[] | null>,
): Promise<boolean> {
  let checkId = begunId;
  while (current.current === mine) {
    const stored = await refresh();
    if (checkId === null) {
      const candidates = stored?.filter(
        (candidate) => !before.has(candidate.id) && answersRequest(candidate, request),
      );
      /* The store is oldest first. If the stream broke before `begin`, this
         press is the newest matching row, not an earlier identical press from
         another tab that this tab's stale first read had not seen. */
      checkId = candidates?.[candidates.length - 1]?.id ?? null;
    }
    const ours = checkId === null ? undefined : stored?.find((candidate) => candidate.id === checkId);
    if (ours && ours.status !== "pending") return true;
    await later();
  }
  return false;
}

export function useDebateChecks(slug: string): UseDebateChecks {
  const [status, setStatus] = useState<UseDebateChecks["status"]>("loading");
  const [checks, setChecks] = useState<readonly DebateClaimCheck[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pressError, setPressError] = useState<string | null>(null);
  /** The article on screen, so an answer for another one is never drawn here. */
  const current = useRef(slug);
  current.current = slug;
  /* **Unmounting leaves the article too.** Every late answer, and the
     broken-stream poll in `waitForStoredCheck`, stops on `current` no longer
     being its slug, and without this an unmount changed nothing, so that poll
     read and set state every fifteen seconds for as long as the check stayed
     pending. Set again on mount, before the first read's effect, for a remount
     that comes without a render. docs/postmortems/261009e-live-stall-tick-outlived-the-test.md. */
  useEffect(() => {
    current.current = slug;
    return () => {
      current.current = "";
    };
  }, [slug]);
  const checksNow = useRef(checks);
  checksNow.current = checks;
  const url = `/api/debate-claims/${encodeURIComponent(slug)}/checks`;
  /** The number of the last read sent, and of the newest state applied (a read's, or a frame's). */
  const sent = useRef(0);
  const applied = useRef(0);
  /** A stream frame is newer than every read already out. */
  const applyFrame = useCallback((check: DebateClaimCheck) => {
    applied.current = sent.current;
    setChecks((was) => withCheck(was, check));
  }, []);

  const refreshChecks = useCallback(async (): Promise<readonly DebateClaimCheck[] | null> => {
    const mine = slug;
    const number = ++sent.current;
    try {
      const res = await apiFetch(url);
      const body = await readJson<DebateClaimChecksResponse>(res);
      if (current.current !== mine) return null;
      if (!Array.isArray(body?.checks) || !body.checks.every(isCheck)) {
        throw new MalformedReply("the checks reply has no list of checks");
      }
      /* Overtaken: a newer read, or a frame of this tab's own, is on screen. */
      if (number <= applied.current) return null;
      applied.current = number;
      setChecks(body.checks);
      setError(null);
      setStatus("ready");
      return body.checks;
    } catch (err) {
      /* An overtaken read's failure says nothing about what is on screen. */
      if (current.current !== mine || number <= applied.current) return null;
      setError(describeFetchFailure(err as Error));
      /* A failed re-read keeps what is on screen. */
      setStatus((was) => (was === "ready" ? was : "error"));
      return null;
    }
  }, [slug, url]);

  const refresh = useCallback(async (): Promise<void> => {
    await refreshChecks();
  }, [refreshChecks]);

  useEffect(() => {
    setStatus("loading");
    setChecks([]);
    setSending(false);
    setPressError(null);
    void refresh();
  }, [refresh]);

  /* A tab with no pending row would otherwise never learn that another tab
     started a check after this one's first read. Coming back to it is a free
     occasion to reconcile. */
  useEffect(() => {
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  /* Another tab's check is out: read again until it lands. Not while this
     tab's own stream is the one bringing the answer. */
  const elsewhere = !sending && checks.some((c) => c.status === "pending");
  useEffect(() => {
    if (!elsewhere) return;
    const timer = setInterval(() => void refresh(), PENDING_POLL_MS);
    return () => clearInterval(timer);
  }, [elsewhere, refresh]);

  const check = useCallback(
    async (request: DebateCheckRequest): Promise<boolean> => {
      const mine = slug;
      const before = new Set(checksNow.current.map((stored) => stored.id));
      let accepted = false;
      let begunId: string | null = null;
      setSending(true);
      setPressError(null);
      try {
        const res = await apiFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        /* A refusal is JSON, before any header: a stale list, a check already
           out, the allowance. Its sentence is the reader's. */
        if (!res.ok || !res.body) throw await failure(res);
        accepted = true;
        const done = await readAnswerStream<DebateClaimCheck>(res.body, {
          begin(data) {
            if (current.current === mine && isCheck(data)) {
              begunId = data.id;
              applyFrame(data);
            }
          },
          delta() {},
          done(data) {
            return isCheck(data) ? data : undefined;
          },
        });
        if (current.current === mine) applyFrame(done);
        return true;
      } catch (err) {
        if (current.current !== mine) return false;
        if (accepted) {
          /* The server keeps going after a dropped stream. Keep this press
             held, and reconcile the row until its stored terminal state is
             visible; returning true clears the picks just as a `done` frame
             would. This never POSTs. */
          const recovered = await waitForStoredCheck(mine, current, before, request, begunId, refreshChecks);
          return recovered;
        }
        setPressError(describeFetchFailure(err as Error));
        /* A refusal happened before an answer stream existed. Read once in
           case another tab's pending check was the reason. */
        void refresh();
        return false;
      } finally {
        if (current.current === mine) setSending(false);
      }
    },
    [slug, url, refresh, refreshChecks, applyFrame],
  );

  return { status, checks, error, sending, pressError, check, refresh };
}
