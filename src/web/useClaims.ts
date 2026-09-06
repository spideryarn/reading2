/**
 * The client half of a paper's claims run — Stage 4 of
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md § 2.
 *
 * **`useCriteria.ts` with the list taken out**, and it is deliberately that
 * rather than something better: every rule in that file was learned the hard way
 * and three of them come from postmortems. What survives the copy, and what does
 * not:
 *
 * - **No minted id, because there is nothing to name.** One run per article, so
 *   `begin` needs nothing from the client and the server's row is the whole
 *   identity. Criteria mints one because `?crits=` has to name a real row from
 *   the first frame.
 * - **No tombstone, because there is nothing to delete.** A criterion can be
 *   deleted while its answer is in the air; a claims run can only be *replaced*,
 *   and a second POST while the first is still streaming is handled by
 *   `running` refusing to start one.
 * - **The terminal contract survives, and it matters more here than there.**
 *   One `begin`, then any number of `claim`, then **exactly one `done`**. A body
 *   that ends with neither a `done` nor an error is a failure and says so —
 *   because a stream can end by simply stopping, and on this panel that looks
 *   exactly like a paper whose claims all arrived.
 * - **The final list replaces the streamed one**, never merges with it. That is
 *   not tidiness: the authoritative pass is where the document sort happens over
 *   the whole answer, and a merge would leave the panel holding claims in the
 *   order the model happened to emit them. See `ClaimsBand` for the other half
 *   of that, which is what keeps the order right *during* the stream.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Claim, ClaimsRun } from "../referee-claims.js";
import { isStale } from "../search-stale.js";
import { apiFetch, failure, readJson } from "./lib/api.js";
import { readEvents, STREAM_STALL_MS } from "./lib/sse.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type ArtefactStatus, useAutoRun } from "./useAutoRun.js";
import { describeFetchFailure } from "./useComments.js";

export interface ClaimsApi {
  /** The stored run, or `null` when this paper has never been asked. */
  run: ClaimsRun | null;
  /** The paper has moved since this run was answered — or we cannot tell. */
  stale: boolean;
  /** False until the first fetch has answered, either way — `SearchApi.loaded`. */
  loaded: boolean;
  /** Did that first fetch fail? The half `loaded` cannot carry. */
  loadFailed: boolean;
  /** Pull the paper's claims. A second call while one is running does nothing. */
  pull(): void;
  /** A failure of the *transport*. A model failure lives on `run.status`. */
  error: string | null;
}

const url = (slug: string) => `/api/referee/claims/${encodeURIComponent(slug)}`;

export function useClaims(slug: string): ClaimsApi {
  const [run, setRun] = useState<ClaimsRun | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The paper's fingerprint, as the server last reported it. Three states, and
   * the third earns the wrapper: `null` is *we have not been told* — nothing
   * has answered yet, or the fetch failed — and `{ hash: undefined }` is *the
   * server checked and cannot tell*, which `isStale` counts as stale.
   *
   * The distinction is about **whether we heard from the server at all**, not
   * about which keys the reply carried. A `sourceHash` the server computed as
   * `undefined` does not survive `JSON.stringify`, so the two are
   * indistinguishable in the parsed body and only the GET's own success branch
   * knows which it is looking at — see it below.
   */
  const [fingerprint, setFingerprint] = useState<{ hash: string | undefined } | null>(null);

  /**
   * Is a POST from this tab still in the air?
   *
   * A ref rather than state, and read inside `pull` rather than passed to it,
   * for the reason useComments.ts records: a `setState` updater must be pure and
   * StrictMode calls it twice, so firing a POST from inside one spends two model
   * calls. This is the guard, and it is checked before anything else happens.
   */
  const running = useRef(false);

  /**
   * **Which article this hook is about now**, so a stream started for the last
   * one cannot write into it.
   *
   * A claims run takes a minute or two and the reader is free to open another
   * paper in the meantime. Without this the in-flight stream keeps calling
   * `setRun`, and the new article's panel fills with the old paper's claims —
   * each of them anchored to block ids this article does not have, so the rows
   * would be doors into nothing. `useCriteria` solves the same problem with its
   * per-request `live` flag; there is one request here, so a ref holding the
   * live slug is the smaller version of it.
   */
  const current = useRef(slug);

  /**
   * **The read, lifted out of the effect** so that it can be asked a second
   * time — the automatic run needs a way back from a GET that *failed*
   * (useAutoRun.ts § A failed read is not an answer), and there was none.
   *
   * **Through `useOrderedRead`, not a bare callback.** A second read is a second
   * request in the air, and two requests about one paper can land out of order —
   * which is exactly the bug that module exists for, and which every other
   * artefact reader in this app already routes around
   * (tests/artefact-read-race.test.tsx). Doing it by hand here would be the
   * ninth copy of a race nobody won the first eight times. GPT Sol, 2026-09-06.
   *
   * `current()` is asked after the `await` and before any `set`, which is that
   * module's one requirement of a caller.
   */
  const load = useCallback(
    async (current: () => boolean) => {
      await apiFetch(url(slug))
        .then((r) => readJson<{ run?: ClaimsRun | null; sourceHash?: string; error?: string }>(r))
        .then((body) => {
          if (!current()) return;
          if (body.error) {
            setError(body.error);
            setLoadFailed(true);
          } else {
            setRun(body.run ?? null);
            /* **Unconditionally, including when the field is missing.** A reply
               that got here is the server's answer about this paper, so
               `undefined` is not silence — it is "we checked and cannot tell",
               which `isStale` counts as stale. That is the whole point of the
               wrapper on `fingerprint`, and it is reachable only from here: the
               server sends `sourceHash: undefined` for a paper whose blocks it
               could not read, `JSON.stringify` deletes the key outright, and
               `"sourceHash" in body` was therefore false for exactly the case the
               state exists to carry. Silence is the *error* branch below, which
               leaves the fingerprint `null`. */
            setFingerprint({ hash: body.sourceHash });
            /* **Cleared on a read that worked**, which matters only to `reload`:
               a first read that failed left `loadFailed` true, and a second that
               succeeded has to take it back or the panel goes on showing the
               failure over a paper it has now read. The opening read cannot reach
               this — the effect below has just set it false. */
            setLoadFailed(false);
            setError(null);
          }
          setLoaded(true);
        })
        .catch((e: Error) => {
          if (!current()) return;
          setError(describeFetchFailure(e));
          setLoadFailed(true);
          setLoaded(true);
        });
    },
    [slug],
  );

  /* `discard` is what fences a superseded generation — see the effect below,
     which calls it before starting the next paper's read. */
  const { reload, discard } = useOrderedRead(load);

  useEffect(() => {
    current.current = slug;
    /* A stream still in the air belongs to the previous article and is no longer
       allowed to write; the guard above stops it, and this lets the reader start
       one here without waiting for it. */
    running.current = false;
    setRun(null);
    setLoaded(false);
    setLoadFailed(false);
    setFingerprint(null);
    void reload();
    /* **Every reply still in the air is now about the previous paper.** The
       teardown rather than a `live` flag, because `useOrderedRead` is the thing
       that knows which generation a reply belongs to. */
    return discard;
  }, [slug, reload, discard]);

  const pull = useCallback(() => {
    if (running.current) return;
    running.current = true;
    /** The article this run is about. Every write below is gated on it. */
    const mine = slug;
    const stillMine = () => current.current === mine;
    setError(null);
    /* A spinner with nothing under it, immediately — and note what this throws
       away: the previous answer. That is the same call `begin` makes on the
       server (src/store/pg-referee-claims.ts § One run per article), and it is
       deliberate.
       Yesterday's claims under today's spinner is the one state a referee cannot
       interpret. */
    setRun({ status: "pending", createdAt: new Date().toISOString(), claims: [] });

    let settled = false;
    void (async () => {
      try {
        const r = await apiFetch(url(slug), { method: "POST" });
        /* A failure before the stream opens is ordinary JSON — the server reads
           the article and checks it has blocks before it writes a header. A
           failure after it opens is the stream simply ending, handled below. */
        if (!r.ok || !r.body) throw await failure(r);

        for await (const event of readEvents(r.body, { stallMs: STREAM_STALL_MS })) {
          // Checked once per frame, not once per stream: the reader can open
          // another paper between two frames of the same run.
          if (!stillMine()) return;
          if (event.name === "begin") {
            const begun = event.data as ClaimsRun;
            /* Fresher news about the paper than the GET has: the server
               fingerprints the blocks as it opens the run, so this hash *is* the
               article's current one. */
            if (begun.sourceHash !== undefined) setFingerprint({ hash: begun.sourceHash });
            setRun(begun);
            continue;
          }
          if (event.name === "claim") {
            const { claim } = event.data as { claim: Claim };
            setRun((prev) =>
              prev === null ? prev : { ...prev, claims: [...prev.claims, claim] },
            );
            continue;
          }
          if (event.name === "done") {
            settled = true;
            /* The final pass is authoritative and legitimately differs from what
               streamed — it is where the whole answer is sorted into document
               order — so it **replaces** rather than merging. */
            setRun(event.data as ClaimsRun);
            return;
          }
        }

        if (!settled) throw new Error("The claims stopped arriving. Try again.");
      } catch (e) {
        if (!stillMine()) return;
        const message = describeFetchFailure(e as Error);
        setError(message);
        /* Stored on the row rather than only in `error`, so the panel shows the
           same Try again it shows for a model failure. A transport failure and a
           provider failure look identical from here and call for the same act. */
        setRun((prev) => ({
          status: "error",
          createdAt: prev?.createdAt ?? new Date().toISOString(),
          claims: [],
          error: message,
          ...(prev?.sourceHash === undefined ? {} : { sourceHash: prev.sourceHash }),
        }));
      } finally {
        /* Only if this is still the live article: the slug effect has already
           cleared the flag for the new one, and clearing it again here would be
           this run reaching forward into a paper it knows nothing about. */
        if (stillMine()) running.current = false;
      }
    })();
  }, [slug]);

  /**
   * **The referee pressed Claims and this paper has never been asked — ask it.**
   *
   * Greg's rule about opening a mode (src/web/useAutoRun.ts), one level down:
   * the press is minted by the chip in `RefereeViews` (App.tsx), and arriving
   * here any other way — a pasted `?referee=claims`, a Back step, the mode button
   * on a URL that already said `claims` — spends nothing.
   *
   * **The first target with no job behind it.** A claims run is one SSE stream
   * rather than a pipeline step (src/web/auto-run-targets.ts), so `pull` takes
   * the place of `ensure`. The hook does not care: it asks *is there anything
   * there* and *did the reader press it*, and this file decides what running
   * means.
   *
   * The four states, and the order is load-bearing:
   *
   *  - `!loaded` → **loading**, and the press waits for it;
   *  - `loadFailed` → **error**, which is not an answer, so the press is kept and
   *    `reload` asks again — tested before `run`, because after a `reload` the
   *    two are not exclusive and a failure the referee can see must not be
   *    hidden by a run from before it;
   *  - a `run` → **ready**, so the press retires having spent nothing;
   *  - otherwise **none**, and the press starts the stream.
   *
   * `pull` already refuses a second run while one is in flight — the `running`
   * ref above — which is also what makes `<StrictMode>`'s double effects safe
   * here. And `pull` installs a `{status:"pending"}` row synchronously, so the
   * very next render reads `ready`: the press cannot be spent twice even in
   * principle.
   */
  const status: ArtefactStatus = !loaded
    ? "loading"
    : loadFailed
      ? "error"
      : run !== null
        ? "ready"
        : "none";
  useAutoRun(
    slug,
    "claims",
    status,
    async () => pull(),
    async () => {
      await reload();
    },
  );

  const stale = useMemo(
    () => (run === null || fingerprint === null ? false : isStale(run, fingerprint.hash)),
    [run, fingerprint],
  );

  return { run, stale, loaded, loadFailed, pull, error };
}
