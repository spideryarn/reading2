/**
 * The summaries, as the reading view sees them: the artefact, whether it still
 * describes the article, and the one thing you can ask for.
 *
 * The read half is `GET /api/summary/:slug`; the write half is a **job**,
 * because writing them is several model calls over the whole article and takes
 * a minute or two (docs/project/ingest-queue.md). So this is the same shape as
 * `useGlossary` beside it, and deliberately so — the two answer the same
 * question about different artefacts, and the day they stop agreeing is the day
 * one of them is wrong.
 *
 * **One verb, where the glossary has three.** The glossary needs `find`, `more`
 * and `reset` because running its step *appends* to the list. This step
 * replaces its artefact wholesale, so "write them" and "write them again" are
 * one button whose only difference is whether the step's own freshness check
 * agrees — which is exactly what `force` is for, and why there is no DELETE
 * endpoint on the other side of it (src/api.ts § `loadSummaries`).
 *
 * **The panel works without any of this.** Every internal tree node already
 * carries a one-sentence gist from stage 4, so summary mode has a usable
 * shortest rung before a single model call is made. That is why this hook's
 * `status: "none"` is not an empty state but an offer: the ladder is there, and
 * the two longer rungs are what the button buys.
 *
 * See docs/project/summaries.md.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Job, Summaries, SummariesResponse } from "../types.js";
import { useJobs } from "./useJobs.js";
import { readJson } from "./lib/api.js";
import { useHasProfile } from "./useProfile.js";

export type SummariesStatus = "loading" | "none" | "ready" | "error";

export interface UseSummaries {
  status: SummariesStatus;
  summaries: Summaries | null;
  /** The article moved after they were written. Said out loud, never worked around. */
  stale: boolean;
  /** Written from a reader profile, and whether that profile has changed since. */
  profiled: boolean;
  profileChanged: boolean;
  /**
   * The reader has a profile that applies to **this article** — either half.
   *
   * Resolved here rather than in the panel because the slug is here, and the
   * question needs it: a reader who has written only "why you're reading this
   * one" has a profile as far as every prompt is concerned. src/web/useProfile.ts.
   */
  hasProfile: boolean;
  /** A read failure, or the reason the last request could not be started. */
  error: string | null;
  /** The job writing this article's summaries, if one is. Null otherwise. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: string | null;
  /**
   * Write them. `force` is for the case where the step thinks it is current.
   *
   * `guidance` is the reader's own note about what they are reading for. It
   * steers what the summaries put first and nothing else — the rules that hold
   * it to that are in src/summarise.ts, in the constant half of the prompt.
   * Blank and absent are the same thing.
   */
  /**
   * Write them. `useProfile` defaults to true; pass false for a plain set.
   *
   * On the action rather than in panel state, because the artefact records what
   * it was run with (`profileHash`) — so the next visit reads the reader's
   * choice off the file rather than having to remember it.
   */
  write(force?: boolean, guidance?: string, useProfile?: boolean): Promise<void>;
  cancel(id: string): void;
}

/** Is this job one that would write summaries? */
function writesSummaries(job: Job): boolean {
  return job.steps.some((s) => s.name === "summary");
}

export function useSummaries(slug: string): UseSummaries {
  const [status, setStatus] = useState<SummariesStatus>("loading");
  const [summaries, setSummaries] = useState<Summaries | null>(null);
  const [stale, setStale] = useState(false);
  const [profiled, setProfiled] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const hasProfile = useHasProfile(slug);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/summary/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        // The ordinary case, not a fault: most articles have none, and the
        // panel still works — it falls back to the gists on the tree.
        setSummaries(null);
        setStale(false);
        setError(null);
        setStatus("none");
        return;
      }
      const loaded = await readJson<SummariesResponse>(res);
      setSummaries(loaded.summaries);
      setStale(loaded.stale);
      /* `!= null`, not truthiness: `null` and absent both mean "written without
         a profile" and a hash means written with one. */
      setProfiled(loaded.summaries.profileHash != null);
      setProfileChanged(loaded.profileChanged);
      setError(null);
      setStatus("ready");
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * `onFinished` rather than watching for a status change: `useJobs` already
   * knows which jobs it has announced and which were merely on the shelf when
   * the mode was opened, so entering summary mode does not refetch once per
   * historical job.
   *
   * **The cost, said out loud**, exactly as `useGlossary` says it: `useJobs`
   * polls the whole job list and never stops, so sitting in this mode is one
   * small request every eight seconds. What it buys is that a run started in
   * another tab or from `npm run summarise` shows up here as progress rather
   * than as a button that appears to do nothing.
   */
  const onFinished = useCallback(
    (job: Job) => {
      if (job.slug === slug && writesSummaries(job)) void load();
    },
    [slug, load],
  );
  const queue = useJobs(onFinished);

  /**
   * The job writing this article's summaries, if one is.
   *
   * Found in the polled list rather than remembered from the click, which is
   * what makes a run started somewhere else show up here as progress.
   * `enqueue` hands back the job already in flight for an identical request, so
   * pressing the button twice cannot start a second one.
   */
  const job = useMemo(
    () =>
      queue.jobs
        .filter((j) => j.slug === slug && writesSummaries(j))
        .find((j) => j.status === "queued" || j.status === "running") ?? null,
    [queue.jobs, slug],
  );

  /**
   * What went wrong, in the two quite different ways it can.
   *
   * `postFailed` is the request never landing: no job exists, so nothing will
   * arrive in the list to explain the silence. `startedId` is the other one,
   * and it is why this is not a boolean — a job that fails leaves the running
   * set, so without it the button would simply reappear as though nothing had
   * happened. Scoped to the job **this session started**, so an old failure
   * from another day is not dug up and presented as news.
   */
  const [postFailed, setPostFailed] = useState(false);
  const [startedId, setStartedId] = useState<string | null>(null);
  const stopped = useMemo(() => {
    const mine = startedId ? queue.jobs.find((j) => j.id === startedId) : undefined;
    if (!mine) return null;
    if (mine.status === "error") return mine.error ?? "The job failed.";
    if (mine.status === "cancelled") return "Stopped.";
    return null;
  }, [queue.jobs, startedId]);

  const write = useCallback(
    async (force = false, guidance?: string, useProfile = true) => {
      setStartedId(null);
      const steer = guidance?.trim();
      const started = await queue.run({
        slug,
        steps: ["summary"],
        ...(force ? { force: ["summary" as const] } : {}),
        // Trimmed to nothing is not sent at all, so a box the reader typed in
        // and then cleared does not become an empty instruction in the prompt.
        ...(steer ? { guidance: steer } : {}),
        // Only when it is false, so the ordinary request is unchanged and
        // absent goes on meaning yes — src/routes.ts § parseJobRequest.
        ...(useProfile ? {} : { useProfile: false }),
      });
      setPostFailed(started === null);
      if (started) setStartedId(started.id);
    },
    [queue, slug],
  );

  /* `queue.error` is read here at render and not inside `write`, where it would
     be the value from the render that created the closure — the hook sets it
     during the same `await`, so reading it there gives you the *previous*
     error, or null, which is how a failed request ends up reported as nothing
     at all. Learned on the thread page, met again in the glossary, and the same
     trap is here. */
  const failed = postFailed ? (queue.error ?? "Couldn't start the job.") : stopped;

  return {
    status,
    summaries,
    stale,
    profiled,
    profileChanged,
    hasProfile,
    error,
    job,
    failed,
    write,
    cancel: (id) => void queue.cancel(id),
  };
}
