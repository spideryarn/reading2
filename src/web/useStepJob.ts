/**
 * **One pipeline step, run from a reading-view surface**: the job that is
 * writing this article's artefact, the button that asks for one, and the two
 * quite different ways that can go wrong.
 *
 * Four surfaces wanted exactly this and each had grown its own copy — a
 * `writesX(job)` predicate, an `onFinished` wrapper, a `useJobs(...)`, a `job`
 * memo, and `postFailed`/`startedId`/`stopped`/`failed`, in that order, and
 * byte-identical apart from the step name. `jscpd` found three of the four; the
 * fourth is inline in a component, which is why it was invisible to the tool
 * and is a good part of the reason it drifted.
 *
 * That drift is the argument for this module rather than the line count.
 * `useGlossary` learned the `queue.error` trick and `useIdeas` did not, and
 * told the reader *"The request did not reach the server."* about jobs the
 * server had received and refused, for a day. `Tweets.tsx` worked out what
 * forcing a step does to the steps after it and none of the other three
 * recorded it. Every paragraph below existed in one, two or three of the four.
 *
 * ## The read half is not here
 *
 * Each surface still owns its own GET, its own `status` and its own artefact
 * state. That half is genuinely not identical yet — `useGlossary` has
 * generations, a dedupe and trailing fetches that the other three have none of
 * — and unifying it *changes behaviour*, so it is its own piece of work
 * (docs/plans/260828aj-simplification-wave-2.md § 2.6). What this hook takes is the job
 * half, where the four really were the same code.
 *
 * ## Who uses it
 *
 * All four: `useGlossary`, `useIdeas`, `useSummaries` and `src/web/Tweets.tsx`.
 *
 * The thread page came last, a day after the other three, because it had a
 * hundred lines of another session's uncommitted work in it on the day this was
 * extracted and editing it would have taken their changes along. It is the one
 * whose copy was inline in a component rather than in a hook, which is why
 * `jscpd` never saw it and why it drifted furthest — and for that whole day it
 * carried the bug in `failed` that § `failed` below describes, because the fix
 * lived here and nothing propagated it.
 *
 * That is the argument for the module in one sentence: a fix that lands in a
 * shared place reaches every caller, and a fix that lands in one of four copies
 * reaches one.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Job, StepName } from "../types.js";
import { useJobs } from "./useJobs.js";

/**
 * What a surface can vary about one run. Everything else is the step's own.
 *
 * Not exported: every caller builds one inline at `start(...)`, and wave 2's
 * §1.5 was a whole item about five near-identical types exported out of these
 * same five files with nothing importing them.
 */
interface StepRun {
  /**
   * Run it even though the step thinks its artefact is current.
   *
   * Turned into `force: [step]` — the step **named** — and never a positional
   * or blanket force. All four of the steps this hook is used for
   * (`glossary`, `summary`, `ideas`, `tweets`) are in `FORCE_ONLY_WHEN_NAMED`
   * (src/pipeline.ts), which means the force-cascade is not allowed to speak
   * for them: unnamed is unforced, silently, and the reader would watch a job
   * start, run and change nothing.
   *
   * The naming matters in the other direction too. **Forcing a step forces
   * every step after it** — `cascadeForce` in src/jobs.ts — so a force that
   * named something earlier in `STEP_ORDER` would buy extra model calls on
   * steps whose inputs never moved. Naming exactly the one step this job runs
   * is what keeps a rewrite the price of one artefact. (Recorded only in
   * `Tweets.tsx` until this module existed, where it read as a fact about
   * `tweets` being last in `STEP_ORDER` rather than a rule.)
   */
  force?: boolean;
  /**
   * Whether this run uses the reader's profile. Defaults to yes.
   *
   * Sent **only when it is `false`**, so the ordinary request is the same bytes
   * it has always been and absent goes on meaning yes — the server reads it the
   * same way, src/routes.ts § `parseJobRequest`.
   *
   * It rides on the run rather than being panel state because the artefact
   * records what it was run with (`profileHash`, src/profile.ts), so the next
   * visit reads the reader's choice off the file instead of remembering it.
   */
  useProfile?: boolean;
}

export interface StepJob {
  /**
   * The job writing this article's artefact, if one is. Null otherwise.
   *
   * Found in the polled list rather than remembered from the click, which is
   * what makes a run started somewhere else — another tab, `npm run glossary` —
   * show up here as progress rather than as a button that appears to do
   * nothing. `enqueue` hands back the job already in flight for an identical
   * request (src/jobs.ts), so pressing the button twice cannot start a second
   * one.
   */
  job: Job | null;
  /**
   * Why the run stopped, if it stopped badly — whether this session started it
   * or merely watched it. See `watchedId` below for why the second half
   * matters, and for the two ways it was got wrong first.
   */
  failed: string | null;
  /** Ask for a run. Resolves once the POST has been answered, not when the job has. */
  start(run?: StepRun): Promise<void>;
  cancel(id: string): void;
}

/** Is this job one that would write the artefact this step writes? */
function writesStep(job: Job, step: StepName): boolean {
  return job.steps.some((s) => s.name === step);
}

/**
 * @param onFinished called when a job **for this article** that runs **this
 *   step** reaches `done` — so the surface can reload whatever it just wrote.
 *   The filtering is here so that no caller has to remember it; all four had
 *   written the same two-clause `if`.
 *
 *   `onFinished` rather than watching for a status change, because `useJobs`
 *   already knows which jobs it has announced and which were merely on the
 *   shelf when the mode was opened — so opening a band does not refetch once
 *   per historical job.
 *
 *   **The cost, said out loud:** `useJobs` polls the whole job list and never
 *   stops while the tab is visible, so sitting in one of these modes is one
 *   small request every eight seconds. What it buys is that a run started in
 *   another tab or from the CLI shows up here as progress rather than as a
 *   button that appears to do nothing. If it ever matters, the fix is an idle
 *   switch in `useJobs`, not a private poller in each surface.
 */
export function useStepJob(slug: string, step: StepName, onFinished: () => void): StepJob {
  const announce = useCallback(
    (job: Job) => {
      if (job.slug === slug && writesStep(job, step)) onFinished();
    },
    [slug, step, onFinished],
  );
  const queue = useJobs(announce);

  const job = useMemo(
    () =>
      queue.jobs
        .filter((j) => j.slug === slug && writesStep(j, step))
        .find((j) => j.status === "queued" || j.status === "running") ?? null,
    [queue.jobs, slug, step],
  );

  /**
   * What went wrong, in the two quite different ways it can.
   *
   * `postFailure` is the request never producing a job: nothing will arrive in
   * the polled list to explain the silence, so the surface has to say it
   * itself. `watchedId` is the other one, and it is why that is not the whole
   * story — a job that fails *leaves* the running set, so without it the button
   * would simply reappear as though nothing had happened.
   *
   * **The failure and its reason are one value**, not a boolean beside a
   * string, so no later edit can set one and forget the other — which is
   * precisely how the four copies of this drifted in the first place. `null`
   * means the last press produced a job.
   */
  const [postFailure, setPostFailure] = useState<{ reason: string | null } | null>(null);
  /**
   * **The last run this mount has anything to say about**, whoever started it.
   *
   * Two rounds of getting this wrong, and they are worth keeping because they
   * are opposite errors:
   *
   * **It was only the job this hook started.** `job` above deliberately reads
   * the queue rather than a remembered click, so a run from the CLI, the shelf
   * or another tab shows up as progress — and then, when it *failed*, it simply
   * left the queued/running set. The row vanished, the artefact on screen was
   * unchanged, and nothing was said: which reads exactly like the run having
   * finished and changed nothing. On `sketch` that is two minutes and $0.20.
   *
   * **Then it was `startedId ?? seenId`**, which is the same bug with the sign
   * flipped. Once this mount had started anything, that id won for good: a
   * later run from elsewhere could fail and be ignored, and — worse, because it
   * invents rather than loses — an *old* failure of ours came back out from
   * behind a newer run's spinner, about a job that had since succeeded.
   *
   * So it is **one id, and always the latest**. `start` writes it because a job
   * that fails between the POST and the next poll is never seen running and the
   * press is the only record of it; the effect then overwrites it with whatever
   * is running now. Both ⟨Sol⟩, 2026-08-30, the second one reviewing the fix to
   * the first — which is the argument for a second round rather than one.
   *
   * **Only what this mount saw**, which keeps the original promise: an old
   * failure from another day is not dug up and presented as news, because this
   * is never set for a job that was already over when the panel opened.
   */
  const [watchedId, setWatchedId] = useState<string | null>(null);
  useEffect(() => {
    if (!job) return;
    setWatchedId(job.id);
    /* Something is running, so "the request never landed" is no longer a true
       account of anything on screen. Without this it would sit under a live
       spinner until the next press. */
    setPostFailure(null);
  }, [job]);
  const stopped = useMemo(() => {
    const mine = watchedId ? queue.jobs.find((j) => j.id === watchedId) : undefined;
    if (!mine) return null;
    if (mine.status === "error") return mine.error ?? "The job failed.";
    if (mine.status === "cancelled") return "Stopped.";
    return null;
  }, [queue.jobs, watchedId]);

  const start = useCallback(
    async ({ force = false, useProfile = true }: StepRun = {}) => {
      setWatchedId(null);
      const started = await queue.run({
        slug,
        steps: [step],
        /* The step named, never a positional force — see `force` on `StepRun`
           for both halves of why. */
        ...(force ? { force: [step] } : {}),
        ...(useProfile ? {} : { useProfile: false }),
      });
      /* **The reason is taken here, and kept.** See `failed` below: the two
         obvious places to read it from are both wrong, and this is the one
         instant at which the right value is available. */
      setPostFailure(started === null ? { reason: queue.lastFailure() } : null);
      if (started) setWatchedId(started.id);
    },
    [queue, slug, step],
  );

  /**
   * **A failed POST does not mean the request never landed.** `queue.run`
   * returns null for *any* throw, and `readJson` throws on a 4xx or a 5xx
   * (src/web/useJobs.ts § `act`) — so a job the server received and **refused**,
   * for quota or auth or a bad step, is one of these. `useIdeas` said *"The
   * request did not reach the server."* here until 2026-08-28, which is a false
   * claim about what happened and threw away the server's own reason.
   *
   * ## Neither obvious way of getting that reason works
   *
   * **Reading `queue.error` inside `start`** gives you the value from the
   * render that created the closure. `useJobs` sets it during the same `await`,
   * so what you read is the *previous* error, or null — which is how a failed
   * request ends up reported as nothing at all. Learned on the thread page, met
   * again in the glossary.
   *
   * **Reading `queue.error` at render** — the fix all four copies had, and it
   * is right for about one frame. `error` is shared with the poller, and
   * `act`'s own `finally` starts a poll the instant the POST fails; the server
   * is fine, the poll succeeds, and its `setError(null)` takes the sentence
   * away again. The reader is left with the fallback below, which says nothing.
   * Found by a GPT Sol review of the built code, 2026-08-28, and its point
   * about the *test* is the sharper half: a posed queue has no poll, so the
   * test that came with that fix proved the ternary and not the sequence.
   *
   * So the reason is snapshotted in `start`, out of `queue.lastFailure()` — a
   * ref that only the actions write and no poll can clear —
   * and held until the next press.
   * `tests/refused-job-reason-survives.test.tsx` drives the real sequence.
   */
  const failed = postFailure ? (postFailure.reason ?? "Couldn't start the job.") : stopped;

  return {
    job,
    failed,
    start,
    /* `void`, because the interface promises nothing to await: every surface
       fires this from a click and the outcome arrives through the polled list. */
    cancel: (id) => void queue.cancel(id),
  };
}
