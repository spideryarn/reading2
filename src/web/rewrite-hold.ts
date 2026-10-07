/**
 * **Regenerate's hold: a forced rewrite was pressed on the artefact still on
 * screen, and has neither replaced it nor failed** — so every forced paid
 * control in that mode waits.
 *
 * `job` and `starting` cover the run itself. They do not cover the gap after
 * it: a finished job leaves `job` before its re-read lands, and a re-read that
 * is slow, fails, or is answered from the offline copy keeps the old artefact
 * on screen with Regenerate enabled. Pressing it is a second paid run for one
 * result. Quiz grew a hold for this alone (plan 261002f); this is that rule,
 * with the holes GPT Sol found in it closed, for every mode hook with a forced
 * verb. Which those are is not listed here: tests/rewrite-hold.test.tsx § ROWS
 * has a row for each, and § the membership guard names the files that force a
 * step and are outside it, each with its reason.
 * docs/plans/261004c-sweep-cluster-5-a-failed-read-can-be-retried-and-says-a-readers-sentence.md § 2a.
 *
 * ## Where it lives, and why not in a band or a read
 *
 * In this module, keyed by `(slug, step)`. A band unmounts while the paid job
 * runs on (docs/postmortems/261002f-a-band-local-hold-cannot-protect-a-job-that-outlives-the-band.md),
 * and a read instance is no better: Ideas' band makes its own reader and
 * Marginalia a second, and Simple, Thread and Sketch read wholly inside the
 * band. Reopening the band would lose the hold, and the offline copy would put
 * the old artefact back with Regenerate enabled.
 *
 * **A full page reload forgets it.** That is an accepted limit, and it is this:
 * a reader who reloads the page during a rewrite can be offered a second one.
 *
 * **Fenced to the job engine's session** rather than cleared by a listener:
 * `teardown` (sign-out, another account) bumps `jobEngine.epoch()`, and a hold
 * made under an older epoch is not there.
 *
 * ## What releases it — exactly three things
 *
 *  1. a **fresh** read shows a different identity: the replacement arrived;
 *  2. this press's job is listed as failed or cancelled, or
 *     its POST was refused (the verb releases it there);
 *  3. the job this press made is **over** — seen ended in a loaded, idle job
 *     list, or the engine has said so (§ A hold must not outlive every way of
 *     learning its outcome) — and a **fresh** read that *started after the
 *     band saw that* has landed: the rewrite ended without replacing it.
 *
 * *Fresh* is two checks the Quiz original did not make:
 *
 *  - **Provenance.** A GET already in the air when the job finished can land
 *    after the list goes idle, carrying the old artefact. So a read carries the
 *    number it *started* with, and rule 3 counts only a read started after the
 *    mark taken when the ended job was first seen. Rule 1 also needs a read
 *    started after the press: an earlier online answer can remain in `latest`
 *    after a different artefact arrives from the shared offline copy.
 *  - **Not an offline copy.** `apiFetch` answers a failed GET from the offline
 *    store with a real 200 marked `x-spideryarn-offline: copy`. That is not the
 *    server's word, so it is never a fresh read.
 *
 * ## Why the hold carries the job's id, not a `posted` boolean
 *
 * `starting` is mount-local in `useStepJob`, so a band reopened while the POST
 * is in the air sees an idle list; rule 3 must not apply until the POST has
 * landed. A boolean set when it lands is not enough, though: the engine learns
 * of the new job only on its next poll, so for one round trip the list is still
 * idle, and the rule-3 read races that poll. A job absent from the list is
 * indistinguishable from one not listed yet (jobEngine.ts § `recordCompletions`),
 * so rule 3 asks for the positive fact: this id, in the list, no longer queued
 * or running.
 *
 * ## A hold must not outlive every way of learning its outcome
 *
 * Terminal rows stay listed, but not for ever (`KEEP_FINISHED`, src/jobs.ts).
 * A job that failed while no band was mounted and was trimmed before one came
 * back is in no list again, so rules 2 and 3 as first written never fired and
 * the control was dead until a reload (GPT Sol's C3, plan 261007b). So `run`
 * also asks the engine, which outlives every band: `watchTerminal` answers
 * once, when the job is listed as over or is missing from a list *asked after
 * the POST had answered* — the one absence that does mean gone, since the row
 * existed by then and a job still going cannot be forgotten. Either answer
 * sets `over`, and rule 3 takes it from there with the same fresh read. It
 * cannot release early: the engine speaks only once the server's job is
 * finished, and the read must start after a band has seen that.
 *
 * ## What this is not
 *
 * `useRewriteHold` owns no read and no job. Each mode hook passes its identity,
 * its queue and its fresh-read facts, and keeps its own state, verbs, 404
 * branch and copy — useOrderedRead.ts § What it deliberately is not.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { StepName } from "../types.js";
import { jobEngine } from "./jobEngine.js";
import type { StepJob } from "./useStepJob.js";

interface Hold {
  /** The artefact the forced verb was pressed on. */
  readonly identity: string;
  /** The job the press made, once its POST has answered. Null while it is in the air. */
  readonly posted: string | null;
  /** Global read-start clock at the press, surviving a reader's remount. */
  readonly afterRead: number;
  /** `jobEngine.epoch()` when it was made — see the header. */
  readonly epoch: number;
  /** The engine has said `posted` ended or is gone — § A hold must not outlive…. */
  readonly over?: true;
}

const holds = new Map<string, Hold>();
const listeners = new Set<() => void>();
/* Read instances come and go, so a press's fence cannot use a mount-local
   counter. `begun()` still records only this reader's most recent start. */
let readClock = 0;

const keyOf = (slug: string, step: StepName) => `${slug}\n${step}`;

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function holdAt(key: string): Hold | null {
  const hold = holds.get(key);
  if (!hold) return null;
  return hold.epoch === jobEngine.epoch() ? hold : null;
}

/** Remove `hold`, unless a later press has already replaced it. */
function drop(key: string, hold: Hold): void {
  if (holds.get(key) !== hold) return;
  holds.delete(key);
  emit();
}

/**
 * **Whether a forced run of `step` is held** — the same check `run` makes
 * before it posts, for a press that is not a mode hook's: the command bar's
 * *Run again* row (CommandBar.tsx § `rerunRows`), which until plan 261007i
 * posted beside the hold and bought a second run for one result. A hold whose
 * job ended while no band was mounted stays up until a band reads again, so
 * a caller that refuses here says how to release it: open the mode.
 */
export function rewriteHeld(slug: string, step: StepName): boolean {
  return holdAt(keyOf(slug, step)) !== null;
}

/**
 * **A read's start number, and whether what landed was the server's word.**
 *
 * The bookkeeping a mode's read keeps for the hold, and nothing else about the
 * read: `begin()` at the top of the load, `landed()` beside the state it sets
 * for a 200 or a 404. An offline copy is dropped here, so no caller has to
 * remember to ask.
 */
export interface FreshReads {
  /** Call first thing in the read. Returns the number this read started with. */
  begin(): number;
  /**
   * This read was answered — a 200, or a 404 (`identity` null). Call it after
   * `current()`, with the other state. A copy from the offline store is
   * ignored.
   */
  landed(started: number, res: Response, identity: string | null): void;
  /** The newest read begun so far. */
  begun(): number;
  /** The last read the server itself answered, or null. */
  latest: { readonly started: number; readonly identity: string | null } | null;
}

export function useFreshReads(): FreshReads {
  const count = useRef(0);
  const [latest, setLatest] = useState<FreshReads["latest"]>(null);
  const begin = useCallback(() => (count.current = ++readClock), []);
  const begun = useCallback(() => count.current, []);
  const landed = useCallback((started: number, res: Response, identity: string | null) => {
    /* Optional all the way down: a test's hand-built stub has no `headers`. */
    if (res.headers?.get?.("x-spideryarn-offline") === "copy") return;
    setLatest({ started, identity });
  }, []);
  return { begin, landed, begun, latest };
}

export interface RewriteHold {
  /** Every forced paid control in the mode honours this. */
  rewriting: boolean;
  /**
   * Make the forced run, holding the artefact on screen. `start` is the mode's
   * own `queue.start({ force: true, … })`. The hold outlives the band, so the
   * job's id (or the refusal) is recorded here when the POST answers, whether
   * or not anything is still mounted.
   */
  run(start: () => Promise<string | null>): Promise<void>;
}

export function useRewriteHold({
  slug,
  step,
  identity,
  queue,
  fresh,
  refresh,
}: {
  slug: string;
  step: StepName;
  /** What identifies the artefact on screen — `generatedAt`, Quiz's `batchId` — or null with none. */
  identity: string | null;
  queue: Pick<StepJob<StepName>, "job" | "loaded" | "starting" | "failed" | "ended" | "registerRetryHold">;
  /** The read's own bookkeeping — `useFreshReads`, on whichever hook holds the read. */
  fresh: FreshReads;
  /** The read's `refresh`. Called once, when the job is first seen ended. Never spends. */
  refresh(): Promise<void>;
}): RewriteHold {
  const key = keyOf(slug, step);
  const hold = useSyncExternalStore(
    subscribe,
    useCallback(() => holdAt(key), [key]),
  );
  const { latest, begun } = fresh;

  /* A remount can watch another tab's job while our POST is still in the air.
     Only the outcome of the id this press made can release its hold. */
  const outcome = hold?.posted ? queue.ended(hold.posted) : null;
  const failed = outcome === "error" || outcome === "cancelled";

  /* Rule 1: the replacement arrived. */
  useEffect(() => {
    if (hold && latest && latest.started > hold.afterRead && latest.identity !== hold.identity) drop(key, hold);
  }, [key, hold, latest]);

  /* Rule 2: this press failed or was cancelled, including while unmounted. */
  useEffect(() => {
    if (hold && failed) drop(key, hold);
  }, [key, hold, failed]);

  /* Rule 3. `ended` is the job this press made, seen over in a list with
     nothing else running for the step. Not `!queue.starting`: that flag is
     about this same job until the effect that sees it listed clears it, one
     render after the list says it is done.

     **The mark is taken during render, not in the effect**, because
     `useStepJob`'s own effect has already asked for the post-job read by the
     time an effect here runs: a mark taken after it would discount the one
     read that is the answer, and cost a second GET per rewrite. A ref written
     in render, as useOrderedRead.ts § `reading` is; idempotent. */
  const ended =
    hold !== null &&
    hold.posted !== null &&
    queue.loaded &&
    queue.job === null &&
    (outcome !== null || hold.over === true);
  const mark = useRef<number | null>(null);
  if (!ended) mark.current = null;
  else if (mark.current === null) mark.current = begun();
  const asked = useRef(false);
  useEffect(() => {
    if (!ended || !hold) {
      asked.current = false;
      return;
    }
    /* Once, so a read that qualifies is guaranteed to exist — unless one has
       started since the mark already. `refresh` trails a read in flight. */
    if (!asked.current) {
      asked.current = true;
      if (mark.current !== null && begun() <= mark.current) void refresh();
    }
    if (mark.current !== null && latest && latest.started > mark.current) drop(key, hold);
  }, [key, hold, ended, latest, begun, refresh]);

  const run = useCallback(
    async (start: () => Promise<string | null>) => {
      /* The shared hold fences the verb before React can disable a control,
         including a handler captured by another mount. */
      if (holdAt(key)) return;
      let made: Hold | null = null;
      if (identity !== null) {
        made = { identity, posted: null, afterRead: readClock, epoch: jobEngine.epoch() };
        holds.set(key, made);
        emit();
      }
      let jobId: string | null;
      try {
        jobId = await start();
      } catch (err) {
        if (made) drop(key, made);
        throw err;
      }
      if (made === null || holds.get(key) !== made) return;
      if (jobId) {
        const posted: Hold = { ...made, posted: jobId };
        holds.set(key, posted);
        /* Heard with no band mounted too. Whatever the ending, rule 3 decides. */
        jobEngine.watchTerminal(jobId, () => {
          if (holds.get(key) !== posted) return;
          holds.set(key, { ...posted, over: true });
          emit();
        });
      }
      /* Refused: nothing was made, so there is nothing to wait for. */
      else holds.delete(key);
      emit();
    },
    [key, identity],
  );

  /* JobProgress's Retry uses the same hold, while preserving the retry
     endpoint and the replacement job's id. The registration belongs to this
     queue mount; Metadata has no artefact hold to register. */
  const registerRetryHold = queue.registerRetryHold;
  useEffect(() => registerRetryHold?.(run), [registerRetryHold, run]);

  return {
    /* An offline copy with a different identity does not settle the hold. */
    rewriting: hold !== null && !failed,
    run,
  };
}
