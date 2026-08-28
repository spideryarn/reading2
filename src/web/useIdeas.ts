/**
 * The ideas, as the reading view sees them: the list, whether it still
 * describes the article, and the one thing you can ask for.
 *
 * The read half is `GET /api/ideas/:slug`; the write half is a **job**, because
 * finding them is a model call over the whole article and takes tens of seconds
 * (docs/project/ingest-queue.md).
 *
 * ## Three verbs became one, and that is the feature rather than a shortcut
 *
 * `useGlossary` has `find`, `more` and `reset`, and the difference between the
 * first two is the whole of that feature: running the glossary step again
 * **appends**, so "give me more terms" and "start over" cannot be the same
 * button and `reset` needs a DELETE of its own to mean anything.
 *
 * Ideas replaces. A piece has three to ten of them, not forty, so there is
 * nothing to paginate and nothing to append — which means running the step
 * again already *is* "start again". One verb, no DELETE route, and the class of
 * bugs that comes with an append path (a FORBIDDEN list, `existingFor`, "a
 * stale list is not appended to") does not exist here to be got wrong.
 *
 * See docs/plans/ideas-mode.md and src/ideas.ts.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Ideas, IdeasResponse, Job } from "../types.js";
import { useJobs } from "./useJobs.js";
import { apiFetch, readJson } from "./lib/api.js";
import { useHasProfile } from "./useProfile.js";

export type IdeasStatus = "loading" | "none" | "ready" | "error";

export interface UseIdeas {
  status: IdeasStatus;
  ideas: Ideas | null;
  /** The article moved after these were written — blocks **or** sections. */
  stale: boolean;
  /** They predate the current prompt. A different fact from `stale`, with its own sentence. */
  outdated: boolean;
  /** These were written from a reader profile at all. */
  profiled: boolean;
  /**
   * ...and that profile is no longer the reader's.
   *
   * **The fact that matters most here of all five surfaces that carry it.** In
   * a glossary a changed profile means some terms would now be chosen
   * differently; here it changes what "assumed" *means*, because what a reader
   * has to bring is defined by who they are. So this is the one place the step
   * also re-runs on its own — `profileHash` is in the freshness stamp
   * (src/pipeline.ts § ideas), which no other stage does yet.
   */
  profileChanged: boolean;
  hasProfile: boolean;
  error: string | null;
  /** The job writing this article's ideas, if one is. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: string | null;
  /**
   * Write the list — the only verb. `force` is passed always, because the
   * button means "find them again" whether or not there is a current artefact,
   * and the freshness check would otherwise turn a deliberate regeneration into
   * a no-op that looks exactly like a broken button.
   */
  find(useProfile?: boolean): Promise<void>;
  cancel(id: string): void;
}

/** Is this job one that would write the ideas? */
function writesIdeas(job: Job): boolean {
  return job.steps.some((s) => s.name === "ideas");
}

export function useIdeas(slug: string): UseIdeas {
  const [status, setStatus] = useState<IdeasStatus>("loading");
  const [ideas, setIdeas] = useState<Ideas | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profiled, setProfiled] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const hasProfile = useHasProfile(slug);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/ideas/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        // The ordinary case, not a fault: most articles have none, and this is
        // what the panel's button is for.
        setIdeas(null);
        setStale(false);
        setOutdated(false);
        setProfiled(false);
        setProfileChanged(false);
        setError(null);
        setStatus("none");
        return;
      }
      const loaded = await readJson<IdeasResponse>(res);
      setIdeas(loaded.ideas);
      setStale(loaded.stale);
      setOutdated(loaded.outdated);
      /* `!= null` rather than truthiness: the field is `string | null |
         undefined` and only `null` and absent mean "written without one". */
      setProfiled(loaded.ideas.profileHash != null);
      setProfileChanged(loaded.profileChanged);
      setError(null);
      setStatus("ready");
    } catch (err) {
      setError((err as Error).message);
      /* **A failed revalidation must not take the list away.** `load` is not
         only the opening read — `onFinished` below calls it again every time a
         job finishes — and `IdeasPanel` renders the list only under
         `status === "ready"`, so an unconditional `error` here made a flaky
         connection blank a list that was still perfectly good. Only the opening
         read has nothing to fall back on. The message is shown either way. Same
         guard, same reason, as useGlossary.ts § `fetchNow`. */
      setStatus((was) => (was === "loading" ? "error" : was));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  /* `onFinished` rather than watching for a status change, and the cost said
     out loud exactly as useGlossary says it: `useJobs` polls the whole job list
     and never stops, so sitting in ideas mode is one small request every eight
     seconds. What it buys is that a run started in another tab or from
     `npm run ideas` shows up here as progress rather than as a button that
     appears to do nothing. */
  const onFinished = useCallback(
    (job: Job) => {
      if (job.slug === slug && writesIdeas(job)) void load();
    },
    [slug, load],
  );
  const queue = useJobs(onFinished);

  const job = useMemo(
    () =>
      queue.jobs
        .filter((j) => j.slug === slug && writesIdeas(j))
        .find((j) => j.status === "queued" || j.status === "running") ?? null,
    [queue.jobs, slug],
  );

  const [postFailed, setPostFailed] = useState(false);
  const [startedId, setStartedId] = useState<string | null>(null);
  const stopped = useMemo(() => {
    const mine = startedId ? queue.jobs.find((j) => j.id === startedId) : undefined;
    if (!mine) return null;
    if (mine.status === "error") return mine.error ?? "The job failed.";
    if (mine.status === "cancelled") return "Stopped.";
    return null;
  }, [queue.jobs, startedId]);

  const find = useCallback(
    async (useProfile = true) => {
      setStartedId(null);
      const started = await queue.run({
        slug,
        steps: ["ideas"],
        /* **Always forced**, which is the one place this differs from
           `useGlossary.find`. There the unforced call is meaningful because the
           step's own freshness check will agree when there is nothing current;
           here the button says "find them again" and is offered *beside a list
           that is current*, so an unforced run would skip and the reader would
           watch a job start and finish having changed nothing.

           Forcing is safe in a way it is not for the glossary: this step
           replaces rather than appends, so a forced run cannot silently
           lengthen anything. `ideas` is in FORCE_ONLY_WHEN_NAMED, so naming it
           here forces exactly this step and nothing else. */
        force: ["ideas" as const],
        /* Sent only when it is `false`, so the ordinary request is the same
           bytes it has always been and absent goes on meaning yes. */
        ...(useProfile ? {} : { useProfile: false }),
      });
      setPostFailed(started === null);
      if (started) setStartedId(started.id);
    },
    [queue, slug],
  );

  /* Two quite different silences, one sentence. `postFailed` is having no job —
     nothing will arrive in the list to explain it. `stopped` is a job that
     started and died, which matters because a failed job leaves the running set
     and the button would otherwise simply reappear as though nothing had
     happened.

     **`postFailed` does not mean the request never landed.** `queue.run`
     returns null for any throw, and `readJson` throws on a 4xx or a 5xx
     (src/web/useJobs.ts § `act`) — so a job the server received and refused
     was being reported as a dead network, which is false, and the server's own
     reason was thrown away. `queue.error` is what it said.

     Read here at render and not inside `find`, where it would be the value from
     the render that created the closure — `useJobs` sets it during the same
     `await`, so reading it there gives you the *previous* error, or null, which
     is how a failed request ends up reported as nothing at all. Learned on the
     thread page, met again in the glossary, and the same trap is here. */
  const failed = postFailed ? (queue.error ?? "Couldn't start the job.") : stopped;

  return {
    status,
    ideas,
    stale,
    outdated,
    profiled,
    profileChanged,
    hasProfile,
    error,
    job,
    failed,
    find,
    cancel: queue.cancel,
  };
}
