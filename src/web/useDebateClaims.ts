/**
 * **Debate's claims list, as the reading view sees it** — the claims the
 * article rests on that someone outside could argue with, whether that still
 * describes the article, and the two things you can ask for.
 * docs/plans/261008i-debate-claims-picked-by-the-reader.md § 2.
 *
 * `useFaq`'s shape, because the artefact's contract is the same: one model call
 * over the article, stored once, **replaced** on a re-run, and two staleness
 * facts — no profile is in this stage's stamp. The read half is
 * `GET /api/debate-claims/:slug`; the write half is the `debate-claims` job.
 *
 * ## Its own press, never Reception's
 *
 * Mounted beside `useDebate` by `DebateBand` in both sub-modes, so that a press
 * on Claims that is still waiting for this GET is retired the moment the reader
 * moves to Reception (`enabled`), exactly as `useDebate` retires a Reception
 * press that lands on Claims (useAutoRun.ts § `enabled`, GPT Sol's C1 on stage
 * 1). The two hooks spend two different targets (`debate` and
 * `debate-claims`, activation.ts § `activationForDebate`), so neither press
 * can buy the other's work: the list is a few cents and searches nothing; the
 * Reception search goes to the open web.
 *
 * **Arrival never POSTs.** A pasted `?debate=claims`, Back, a reload and a
 * last-view restore mount this hook with nobody having pressed anything, so
 * they read, and the panel draws *List its claims*.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { NONE_YET_AS_NULL_HEADER } from "../types.js";
import type { DebateClaimList, DebateClaimListResponse, Job } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { useFreshReads, useRewriteHold } from "./rewrite-hold.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";
import { MalformedReply } from "./lib/reader-facing.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

type DebateClaimsStatus = "loading" | "none" | "ready" | "error";

export interface UseDebateClaims {
  status: DebateClaimsStatus;
  claimList: DebateClaimList | null;
  /** The rendered body or cited head moved under this list. */
  stale: boolean;
  /** The article is the same and the current prompt would write this differently. */
  outdated: boolean;
  slug: string;
  error: string | null;
  /** The job listing this article's claims, if one is. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: StepFailure | null;
  /** `StepJob.stalled`: this tab can see the job and cannot move it. */
  stalled: boolean;
  /** `StepJob.starting`: the POST has gone and the queue has not seen it yet. */
  starting: boolean;
  /** The run in flight was started by a press on Claims. `UseDebate.automatic`. */
  automatic: boolean;
  /** Repeat only the GET after a failed read — useFaq.ts § `retryRead`. */
  retryRead(): Promise<void>;
  /**
   * **List them if nobody has** — unforced, for the press and for *List its
   * claims*. They have to be the same request or their `work_key`s differ and
   * the reader pays twice: useIdeas.ts § `ensure`.
   */
  ensure(): Promise<void>;
  /** **List them again** — forced, for the stale list's button. It replaces the list. */
  regenerate(): Promise<void>;
  /** The forced run has neither replaced the list nor failed. rewrite-hold.ts. */
  rewriting: boolean;
  /** Read again, trailing a read in flight — `OrderedRead.refresh`. Never spends. */
  refresh(): Promise<void>;
  cancel(id: string): void;
}

/**
 * @param enabled whether Claims is the sub-mode on screen. A press for Claims
 *   that arrives while Reception is showing is retired unspent (useAutoRun.ts §
 *   `enabled`).
 */
export function useDebateClaims(slug: string, enabled = true): UseDebateClaims {
  const [status, setStatus] = useState<DebateClaimsStatus>("loading");
  const [claimList, setClaimList] = useState<DebateClaimList | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fresh = useFreshReads();
  const { begin, landed } = fresh;
  /** The article the server has said "none yet" for — useFaq.ts § `saidNoneFor`. */
  const saidNoneFor = useRef<string | null>(null);

  const load = useCallback(
    async (current: () => boolean) => {
      const started = begin();
      try {
        /* "None yet" as `200 null` rather than a red 404 — useFaq.ts. */
        const res = await apiFetch(`/api/debate-claims/${encodeURIComponent(slug)}`, {
          headers: { [NONE_YET_AS_NULL_HEADER]: "1" },
        });
        if (!current()) return;
        const loaded = res.status === 404 ? null : await readJson<DebateClaimListResponse | null>(res);
        if (!current()) return;
        if (loaded === null) {
          /* The ordinary case: nobody has pressed Claims on this article. */
          setClaimList(null);
          setStale(false);
          setOutdated(false);
          landed(started, res, null);
          setError(null);
          saidNoneFor.current = slug;
          setStatus("none");
          return;
        }
        if (typeof loaded?.claimList !== "object" || loaded.claimList === null) {
          throw new MalformedReply("the claims reply has no claims list");
        }
        setClaimList(loaded.claimList);
        landed(started, res, loaded.claimList.generatedAt);
        setStale(loaded.stale);
        setOutdated(loaded.outdated);
        setError(null);
        saidNoneFor.current = null;
        setStatus("ready");
      } catch (err) {
        if (!current()) return;
        setError(describeFetchFailure(err as Error));
        /* A failed revalidation must not take the list away — useFaq.ts. */
        setStatus((was) => (was !== "loading" ? was : saidNoneFor.current === slug ? "none" : "error"));
      }
    },
    [slug, begin, landed],
  );

  const { reload, refresh } = useOrderedRead(load);

  const retryRead = useCallback(async () => {
    setError(null);
    if (claimList === null) setStatus("loading");
    await reload();
  }, [claimList, reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* `refresh`, not `reload`: a finished job has just written a new list. */
  const queue = useStepJob(slug, "debate-claims", refresh, "watches-queue");

  const ensure = useCallback(async () => {
    await queue.start({});
  }, [queue]);
  /* The forced verb holds the list it was pressed on (rewrite-hold.ts); the
     list's clock is its identity. */
  const hold = useRewriteHold({
    slug,
    step: "debate-claims",
    identity: claimList?.generatedAt ?? null,
    queue,
    fresh,
    refresh,
  });
  const held = hold.run;
  const regenerate = useCallback(async () => {
    await held(() => queue.start({ force: true }));
  }, [queue, held]);

  /* A press on Claims, never arrival, spends — and only while Claims is
     showing. `reload` is the way out of a failed read. */
  const auto = useAutoRun(slug, "debate-claims", status, ensure, reload, enabled);

  return {
    status,
    claimList,
    stale,
    outdated,
    slug,
    error,
    job: queue.job,
    failed: hold.rewriting ? null : queue.failed,
    stalled: queue.stalled,
    starting: queue.starting,
    automatic: auto && (queue.job !== null || queue.starting),
    rewriting: hold.rewriting,
    refresh,
    retryRead,
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}
