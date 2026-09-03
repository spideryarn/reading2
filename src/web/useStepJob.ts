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
 * ## The read half is next door
 *
 * Each surface still owns its own GET, its own `status`, its own 404 branch and
 * its own artefact state — those differ substantively and stay put. What was
 * genuinely shared is the *ordering* of the reads, which `useGlossary` alone had
 * (generations, a one-in-flight dedupe and a trailing fetch) and the seven
 * others did not, and which changing behaviour made its own piece of work
 * (docs/plans/260828aj-simplification-wave-2.md § 2.6). That landed on
 * 2026-09-02 as **[`useOrderedRead`](./useOrderedRead.ts)** — read it beside
 * this file, because the two halves meet at one line: the `onFinished` a caller
 * passes here must be the read's `refresh`, never its `reload`. A `reload`
 * *joins* the GET already in flight, which may have read the artefact before the
 * job wrote it, and the new one is then lost for good
 * (tests/artefact-read-race.test.tsx).
 *
 * ## Who uses it
 *
 * **Eight, and this line said four until 2026-09-01** — it named `useGlossary`,
 * `useIdeas`, `useSummaries` and `src/web/Tweets.tsx`, and `useSummaries` no
 * longer exists. The list now is `useArc`, `useGlossary`, `useIdeas`,
 * `useQuotes`, `useQuiz`, `useSketch`, `useTimeline` and `src/web/Tweets.tsx`.
 * Called out rather than quietly corrected, because it is the same species of
 * stale comment that cost a day in 2026-08-27's CPU work: a quantity a file
 * asserts and nothing measures is a perfectly good reason to believe something
 * false.
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jobWorthRetrying } from "../job-failure.js";
import { driverStalled } from "../job-state.js";
import { worthRetrying } from "../messages.js";
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

/**
 * **A run that ended badly, and what the reader can do about it.**
 *
 * One value rather than a sentence beside a boolean beside a callback, for the
 * reason `postFailure` below already gives about its own two halves: *"the
 * failure and its reason are one value … so no later edit can set one and
 * forget the other"*. A panel cannot wire the message and forget the
 * retryability, because there is nothing to forget — they arrive together or
 * not at all.
 *
 * This was a bare `string | null` until 2026-09-03, which is what let
 * `JobProgress` redraw its ordinary run button under **every** failure while
 * the shelf card next door had been consulting `retryable` since August. Same
 * job, same failure, two different answers.
 */
export interface StepFailure {
  /**
   * What to show the reader.
   *
   * Off the record for a job that failed — `job.error`, which since 2026-09-03
   * is a sentence somebody wrote for a reader rather than whatever a step
   * threw (src/job-failure.ts) — and from the server's own refusal for a POST
   * that never produced a job.
   */
  message: string;
  /**
   * Whether another go at this could come out differently.
   *
   * `jobWorthRetrying` for a job on the record, so the band and the shelf card
   * cannot disagree about one job; `worthRetrying` on the sentence for a
   * refusal that never became one, which is the same fallback every other
   * surface uses for a stored message. Both read *nobody said* as **yes** —
   * src/job-failure.ts § Which way to be wrong.
   */
  retryable: boolean;
  /**
   * Run the failed job again, skipping whatever finished — or `null` when there
   * is no job to run.
   *
   * Null is the POST that never landed: there is no id, so the honest
   * affordance is the ordinary run button, which `JobProgress` is already
   * drawing. Being null is *not* the same as `retryable` being false, and the
   * two are separate fields for that reason: one is a judgement about the
   * failure, the other is whether there is anything to point the judgement at.
   */
  retry: (() => void) | null;
}

export interface StepJob {
  /**
   * The job writing this article's artefact, if one is. Null otherwise.
   *
   * Found in the polled list rather than remembered from the click, which is
   * what makes a run started in **another tab** show up here as progress rather
   * than as a button that appears to do nothing. `enqueue` hands back the job
   * already in flight for an identical request (src/jobs.ts), so pressing the
   * button twice cannot start a second one.
   *
   * **Not a CLI run.** This said "another tab, `npm run glossary`" until
   * 2026-09-02, and the second half was never true: those command lines call
   * the generators directly and write no job record, so nothing about them ever
   * reaches this list. They are outside the queue, which means a panel that
   * sees an artefact absent can start a paid call beside one. That is a
   * developer's own foot rather than a reader's; what changes here is that
   * nothing claims otherwise.
   */
  job: Job | null;
  /**
   * Why the run stopped, if it stopped badly — whether this session started it
   * or merely watched it. See `watchedId` below for why the second half
   * matters, and for the two ways it was got wrong first.
   */
  failed: StepFailure | null;
  /**
   * **This tab can see the job and cannot move it.** A separate question from
   * anything on the record, and the reason it comes through here.
   *
   * `drive` (src/web/jobEngine.ts) catches a failed `POST /advance`, waits, and
   * retries for ever without a word, so a job whose advance route keeps
   * answering 500 sits confidently at `running` while every status poll looks
   * healthy — docs/reusable/silent-success.md, in the one loop built to prevent
   * a stalled ingest.
   *
   * **Not on `Job`, and deliberately not through `displayJob`.** The count is
   * the engine's, per tab, durable nowhere; the job itself is fine and it is
   * the *connection* that is unwell, so the reader needs both facts rather than
   * one overriding the other. src/job-state.ts § Transport health is not a job
   * state has the argument in full.
   *
   * It comes through this hook because this hook already holds the queue
   * subscription — GPT Sol, 2026-09-01, on stage 5 having shown the warning on
   * the shelf card and not in the band: *"a reader drawing a sketch or
   * generating a glossary may never look at the shelf card; their only surface
   * can therefore spin indefinitely without the warning."*
   */
  stalled: boolean;
  /**
   * **The POST has gone and the queue has not seen the job yet.**
   *
   * A state the surfaces did not have, and its absence was visible: between the
   * press and the job appearing in the poll, `job` is null and `JobProgress`
   * draws its ordinary run button again. So a reader who pressed once was
   * offered the button a second time before anything had happened — and after
   * an automatic run, offered it before they had pressed anything at all.
   *
   * It is not "a job is queued": that is `job`, off the record. This is the
   * gap between the two, owned by the mount that made the request, and it ends
   * the moment the id `start` returned turns up in a list.
   */
  starting: boolean;
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
 *   **Pass the read's `refresh`, not its `reload`** — `useOrderedRead`, and § The
 *   read half is next door above. Every one of the eight does now.
 *
 *   `onFinished` rather than watching for a status change, because `useJobs`
 *   already knows which jobs it has announced and which were merely on the
 *   shelf when the mode was opened — so opening a band does not refetch once
 *   per historical job.
 *
 *   **The cost, said out loud:** subscribing puts the shared engine on its idle
 *   cadence, so sitting in one of these modes is one small request every eight
 *   seconds while the tab is visible. What it buys is that a run started in
 *   another tab shows up here as progress rather than as a button that appears
 *   to do nothing — and **not** a CLI run, which writes no job record at all:
 *   see `job` above. Closing the band stops the idle poll
 *   again — src/web/jobEngine.ts § When it polls — and never stops a job that
 *   is actually running.
 */
export function useStepJob(slug: string, step: StepName, onFinished: () => void): StepJob {
  /**
   * Ids this mount has already announced through `onFinished`.
   *
   * Read by the reconciliation below, which has to tell *the engine never told
   * anybody about this one* from *the engine has just told me*. A ref rather
   * than state because it is written from inside an effect and read from
   * another effect in the same commit — see the reconciliation for why the
   * order is what makes it work.
   */
  const announced = useRef<Set<string>>(new Set());
  const announce = useCallback(
    (job: Job) => {
      if (job.slug !== slug || !writesStep(job, step)) return;
      announced.current.add(job.id);
      onFinished();
    },
    [slug, step, onFinished],
  );
  const queue = useJobs(announce);

  /**
   * **The job this panel is about**: the one running this step on this article,
   * or — if none is running — the one that will run next.
   *
   * This was `.find(active)` over `queue.jobs` until 2026-09-02, and that was
   * only ever right while an article could hold one active job. It can hold a
   * *line* now, and `queue.jobs` is **newest first** (`listJobs`, src/jobs.ts),
   * so a panel with two matching jobs bound to the newer one and silently
   * dropped the older one's progress and its failure. Two matching jobs is not
   * exotic: a forced and an unforced glossary both write `glossary`, and their
   * work keys differ, so `enqueueOrGet` does not collapse them.
   *
   * **Running first, then the oldest queued.** A running job is the one whose
   * progress there is anything to show. With none running, the oldest queued is
   * the one `claim`'s predecessor rule will take next — same order,
   * `(createdAt, id)` — so the panel is about the run that is about to happen
   * rather than about whichever row sorted first.
   *
   * `queue.jobs` is not re-sorted, only scanned: the comparison is between the
   * two or three rows that match, and building a sorted copy of every job on
   * every poll to pick one of them is work nobody reads.
   */
  const job = useMemo(() => {
    const mine = queue.jobs.filter((j) => j.slug === slug && writesStep(j, step));
    const running = mine.find((j) => j.status === "running");
    if (running) return running;
    let oldest: Job | null = null;
    for (const candidate of mine) {
      if (candidate.status !== "queued") continue;
      if (!oldest) {
        oldest = candidate;
        continue;
      }
      /* The same tie-break as the store's, so the panel and the claim cannot
         disagree about which of two jobs queued in one millisecond goes first —
         src/store/pg-jobs.ts § `blockedByAnother`. */
      if (candidate.createdAt < oldest.createdAt) oldest = candidate;
      else if (candidate.createdAt === oldest.createdAt && candidate.id < oldest.id) {
        oldest = candidate;
      }
    }
    return oldest;
  }, [queue.jobs, slug, step]);

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

  /**
   * **The id the last `start` returned, until the queue has accounted for it.**
   *
   * A ref rather than state because nothing renders it: it exists so the effect
   * below can ask *has the job I just made turned up yet*, and a render for
   * that question would be a render for nothing.
   */
  const startedId = useRef<string | null>(null);
  const [starting, setStarting] = useState(false);

  /**
   * **A job that was already `done` on the first poll is otherwise never
   * announced, and the panel waits for ever.**
   *
   * `recordCompletions` (src/web/jobEngine.ts) treats the engine's first job
   * list as a baseline rather than as news, and it is right to: opening the app
   * does not make every job that ever succeeded finish again. But the engine
   * polls whether or not anything is mounted, so *this* sequence is real and
   * happens on a fast step:
   *
   *  1. the panel's GET 404s — `status: "none"`;
   *  2. the panel posts, and the job finishes;
   *  3. the engine's **first** list of the session carries it as `done`;
   *  4. nothing is announced, `load` is never called again, and the panel shows
   *     *nobody has done this yet* over an artefact that exists.
   *
   * The reader's only move from there is to ask for it again, which is the loop
   * this whole feature is supposed to have closed. GPT Sol, 2026-09-02, and it
   * is invisible unless you read the poller's seeding rule against the panel's
   * state machine.
   *
   * So: **the exact id `start` returned**, reconciled once. Not "any historical
   * completion", which would turn every job on the shelf into news and refetch
   * once per record — the thing the baseline rule exists to prevent.
   *
   * `announced` is what keeps a job that finishes normally from being reloaded
   * twice. `useJobs`'s drain effect is registered before this one — it is
   * called first, at the top of this hook — so by the time this runs, the
   * engine has already had its say about the same list.
   */
  useEffect(() => {
    const id = startedId.current;
    if (id === null) return;
    const seen = queue.jobs.find((j) => j.id === id);
    if (!seen) return;
    /* It exists, so the request is no longer merely in flight. */
    setStarting(false);
    startedId.current = null;
    if (seen.status === "queued" || seen.status === "running") return;
    if (seen.status === "done" && !announced.current.has(id)) onFinished();
  }, [queue.jobs, onFinished]);
  /**
   * The watched job, once it has stopped badly — and whether it is worth
   * another go.
   *
   * **The id comes out with it**, because a Retry is a job-level action and
   * `job` above is null by the time this is non-null: a failed job leaves the
   * queued/running set, which is the whole reason `watchedId` exists. Without
   * the id the band could say *try again* and have nothing to try.
   *
   * `jobWorthRetrying` and not a comparison written here, so the band and the
   * shelf card ask one question of one function — src/job-failure.ts. A cancel
   * is always worth another go: the reader stopped it, which is not the same as
   * not wanting it, and Retry skips whatever finished before they did.
   */
  const stopped = useMemo(() => {
    const mine = watchedId ? queue.jobs.find((j) => j.id === watchedId) : undefined;
    if (!mine) return null;
    if (mine.status === "error") {
      return {
        id: mine.id,
        message: mine.error ?? "The job failed.",
        retryable: jobWorthRetrying(mine),
      };
    }
    if (mine.status === "cancelled") return { id: mine.id, message: "Stopped.", retryable: true };
    return null;
  }, [queue.jobs, watchedId]);

  const start = useCallback(
    async ({ force = false, useProfile = true }: StepRun = {}) => {
      setWatchedId(null);
      /* Before the `await`, so the button is gone for the whole of the round
         trip rather than from whenever it comes back. */
      setStarting(true);
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
      if (started) {
        setWatchedId(started.id);
        startedId.current = started.id;
        return;
      }
      /* Nothing was made, so there is nothing to wait for and the button is the
         right thing to show — with the reason under it. */
      startedId.current = null;
      setStarting(false);
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
  /* **A refusal used to be on a clock**, because one of them named a job: the
     409 for an article that already had different work in flight, which expired
     when that job did. There is no such refusal any more — a second job on one
     article is queued rather than turned away — so what is left is the ordinary
     kind: a quota, a bad step, a dead network. Those are true until the next
     press, which is when `start` clears this. */
  /* **Built here rather than inside the memo above**, because it closes over
     `queue.retry` — a fresh function on every render, so putting it in the
     memo's dependencies would defeat the memo, and leaving it out would be a
     stale closure. The `.find` is what is worth memoising; a two-field object
     is not. Same shape as `cancel` in the returned interface below. */
  const failed: StepFailure | null = postFailure
    ? {
        message: postFailure.reason ?? "Couldn't start the job.",
        /* No `failureKind` to read — nothing became a job — so the sentence is
           all there is, which is exactly what `worthRetrying` is for. A quota
           refusal carries `[pay-free]` and correctly withholds the offer; an
           unrecognised sentence keeps it. */
        retryable: worthRetrying(postFailure.reason),
        /* Nothing to retry: the run button beside this message *is* the retry. */
        retry: null,
      }
    : stopped
      ? {
          message: stopped.message,
          retryable: stopped.retryable,
          retry: () => void queue.retry(stopped.id),
        }
      : null;

  /* `driverStalled` rather than a comparison written out here, so the threshold
     lives in one place — the shelf card asks the same function. */
  const stalled = job !== null && driverStalled(queue.driverFailures, job.id);

  return {
    job,
    failed,
    stalled,
    /* Never both. Once the job is on the record it is the thing to draw, and a
       spinner over a spinner is a state nobody can read. */
    starting: starting && job === null,
    start,
    /* `void`, because the interface promises nothing to await: every surface
       fires this from a click and the outcome arrives through the polled list. */
    cancel: (id) => void queue.cancel(id),
  };
}
