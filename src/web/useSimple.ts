/**
 * **Simple, as the owner's band sees it** — Summary's plain-words sub-mode: the
 * stored paragraphs, whether they still describe the article, and the verbs
 * that write them. docs/plans/260930i-simple-summaries-eli15-sub-mode.md.
 *
 * `useFaq`'s shape, because the artefact's contract is the same: model work over
 * the article, stored once, replaced on a re-run, and two staleness facts
 * — `stale` (the article moved: the panel says so) and `outdated` (an older
 * prompt: silent). The read half is `GET /api/simple/:slug`; the write half is
 * a job (`steps: ["simple"]`). Ordering is src/web/useOrderedRead.ts's, the job
 * src/web/useStepJob.ts's, and a press on a plain-words control with nothing
 * stored starts it through src/web/useAutoRun.ts — so this file is only the
 * parse, the 404 branch and the verbs.
 *
 * **Mounted only while Summary is on screen, and only for an owner**
 * (modes/summary/SummaryMode.tsx § `OwnerSimple`): `useAutoRun`'s owner must
 * die with the view so a press cannot be spent after the reader has left it,
 * and a visitor reads the paragraphs off the public payload with no hook at all.
 */
import { useCallback, useEffect, useState } from "react";
import type { Job, SimpleSummary, SimpleSummaryResponse } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { type ArtefactStatus, useAutoRun } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

export interface UseSimple {
  status: ArtefactStatus;
  simple: SimpleSummary | null;
  /** The article moved under these paragraphs. */
  stale: boolean;
  /** The article is the same and the current prompt would write this differently. */
  outdated: boolean;
  /** Written for a profile — derived from the artefact's `profileHash`, as `useIdeas` does. */
  profiled: boolean;
  /** The reader has changed their profile since. Never stale; it offers a rewrite. */
  profileChanged: boolean;
  slug: string;
  error: string | null;
  /** The job writing this article's Simple, if one is. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: StepFailure | null;
  /** `StepJob.stalled`: this tab can see the job and cannot move it. */
  stalled: boolean;
  /** `StepJob.starting`: the POST has gone and the queue has not seen it yet. */
  starting: boolean;
  /** Repeat only the GET after a failed read — useFaq.ts § `retryRead`. */
  retryRead(): Promise<void>;
  /**
   * Read again because something it depends on has changed — the profile
   * panel's save, so `profileChanged` is the server's verdict on the new
   * profile. `OrderedRead.refresh`. Never spends. ProfilePanel.tsx § Regenerate.
   */
  refresh(): Promise<void>;
  /** **Write it if nobody has** — unforced, the automatic run's verb and the empty state's. */
  ensure(): Promise<void>;
  /** The forced run — the stale notice's button. It replaces the paragraphs. */
  regenerate(): Promise<void>;
  cancel(id: string): void;
}

export function useSimple(slug: string): UseSimple {
  const [status, setStatus] = useState<ArtefactStatus>("loading");
  const [simple, setSimple] = useState<SimpleSummary | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* `current()` after every `await`, before any state is set: false means this
     reply is about an article the hook has since moved on from. */
  const load = useCallback(
    async (current: () => boolean) => {
      try {
        const res = await apiFetch(`/api/simple/${encodeURIComponent(slug)}`);
        if (!current()) return;
        if (res.status === 404) {
          /* The ordinary case: nobody has asked for one yet. */
          setSimple(null);
          setStale(false);
          setOutdated(false);
          setProfileChanged(false);
          setError(null);
          setStatus("none");
          return;
        }
        const loaded = await readJson<SimpleSummaryResponse>(res);
        if (!current()) return;
        setSimple(loaded.simpleSummary);
        setStale(loaded.stale);
        setOutdated(loaded.outdated);
        setProfileChanged(loaded.profileChanged);
        setError(null);
        setStatus("ready");
      } catch (err) {
        if (!current()) return;
        setError(describeFetchFailure(err as Error));
        /* A failed revalidation must not take the paragraphs away — only the
           opening read has nothing to fall back on. useFaq.ts, useDebate.ts. */
        setStatus((was) => (was === "loading" ? "error" : was));
      }
    },
    [slug],
  );

  const { reload, refresh } = useOrderedRead(load);

  const retryRead = useCallback(async () => {
    setError(null);
    if (simple === null) setStatus("loading");
    await reload();
  }, [simple, reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* `refresh`, not `reload`: a finished job has just written new paragraphs,
     and a request already in flight read the old ones. */
  const queue = useStepJob(slug, "simple", refresh, "watches-queue");

  /* Two verbs, split on `force` — useIdeas.ts § `ensure` has why they must not
     share one. */
  const ensure = useCallback(async () => {
    await queue.start({});
  }, [queue]);
  const regenerate = useCallback(async () => {
    await queue.start({ force: true });
  }, [queue]);

  /* A press — Summary on the bar, its command-bar rows, the slider or either
     end button — spends; arrival never does. */
  useAutoRun(slug, "simple", status, ensure, reload);

  return {
    status,
    simple,
    stale,
    outdated,
    profiled: simple?.profileHash != null,
    profileChanged,
    slug,
    error,
    job: queue.job,
    failed: queue.failed,
    stalled: queue.stalled,
    starting: queue.starting,
    retryRead,
    refresh,
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}
