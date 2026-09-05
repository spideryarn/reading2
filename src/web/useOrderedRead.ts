/**
 * **Two reads of one artefact, in the order they were asked for** — the half of
 * an artefact hook that [`useStepJob`](./useStepJob.ts) does not take.
 *
 * Every mode's read hook is the same three moments: the opening GET, the band's
 * mount revalidating behind whatever is on screen, and a GET after a job wrote
 * something new. Those three race, on one slug, and the losing interleaving is
 * not exotic — it is what happens whenever a reader opens a mode while a job for
 * that article is already running:
 *
 *   1. the opening GET starts, and reads the **old** artefact;
 *   2. the job finishes and `useStepJob` calls `onFinished`;
 *   3. that read lands **first**, with the new artefact;
 *   4. the opening GET lands **last** and overwrites it — permanently, because
 *      `useJobs` has already announced the job and nothing retries.
 *
 * `useGlossary` grew the cure in 2026-08-27, alone, out of a GPT Sol review; the
 * seven other readers were copied from it *before* the cure and none of them had
 * it (docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md
 * § T2.1, reproduced by tests/artefact-read-race.test.tsx). This module is that
 * mechanism, lifted out of `useGlossary` so there is one of it rather than nine.
 *
 * ## What it is, in three rules
 *
 *  - **An ordinary `reload()` may join the read already in flight.** Two callers
 *    asking "have I got it yet" is one question, and opening a band while the
 *    page's own opening GET is outstanding should cost nothing.
 *  - **A `refresh()` must trail it, never join it.** "The list has changed" is a
 *    different question, and a request already out may have read the database
 *    *before* the change it is being asked about — so it is not an answer.
 *  - **Only the newest generation may commit.** A `discard()` (or a change of
 *    article) makes every reply still in the air news about an artefact that no
 *    longer exists.
 *
 * ## What it deliberately is not
 *
 * **Not a `useArtefactRead`.** Parsing, the 404 branch, the status union, the
 * error copy and the artefact state stay in each hook, where they differ
 * substantively — a 404 means "nobody has asked for one yet" in seven different
 * sentences, `useSketch` validates its scene at ingress, `useArc` reads a stale
 * artefact as *no* artefact. A generic reader would flatten all of that into a
 * bag of options. Narrowed to request ordering by GPT Sol reviewing
 * docs/plans/260828aj-simplification-wave-2.md § 2.6, and that narrowing is the
 * reason this module is forty lines instead of four hundred.
 *
 * **And dedupe alone is not the fix.** The one-in-flight join, on its own,
 * *recreates* the bug: `onFinished` would join the pre-job read and be answered
 * with the pre-job artefact. It takes both verbs — the join and the trailing
 * read — which is why they are two names on the interface and not a boolean.
 */
import { useCallback, useEffect, useRef } from "react";

/**
 * One hook's own read, with everything about it that is not ordering.
 *
 * @param current ask it **after every `await`, before setting any state**: false
 *   means this reply is about an artefact the hook has since thrown away, or a
 *   different article, and committing it would put the discarded one back on
 *   screen. It is the whole of "only the newest generation may commit", and the
 *   one thing a caller cannot be given for free.
 *
 * The body owns its own failures. Every caller already wraps itself in a
 * `try`/`catch` that turns a throw into `error` state, and a rejection out of
 * here would surface as an unhandled one in the trailing read.
 */
export type ArtefactRead = (current: () => boolean) => Promise<void>;

export interface OrderedRead {
  /**
   * Read again **only if nothing is already reading** — the opening GET, and a
   * band revalidating on mount.
   *
   * Joins a request already in flight rather than starting a second, so opening
   * a mode while the page's own read is outstanding costs nothing.
   *
   * Use it when the question is *"have I got it yet"*. When the question is
   * *"it has changed"*, use `refresh`.
   */
  reload(): Promise<void>;
  /**
   * Read again **because what is on the server has just changed** — which today
   * always means a job finished. This is what a caller passes to `useStepJob` as
   * its `onFinished`.
   *
   * A request in flight is not an answer to this question, so it arms a
   * **trailing** read that runs after the current one instead of joining it.
   */
  refresh(): Promise<void>;
  /**
   * Arm the trailing read **without starting one** — for a local write that the
   * server already has.
   *
   * The difference from `refresh` is the case where nothing is in flight: there
   * is nothing to repair, and a fetch would rebuild rows the reader is looking
   * at for an answer we already hold. `useGlossary.patchEntry` is the one caller
   * (a term lookup, stored server-side before it reaches us).
   */
  armRefresh(): void;
  /**
   * **This artefact is gone** — a DELETE, or the reader asked for it to be
   * rebuilt. Every reply still in the air is dropped, and the trailing read with
   * them: a read now would race the rebuild.
   *
   * **Nothing calls this today.** Its one caller was `useGlossary`'s `clear()`,
   * which went with the glossary panel's *Start again* on 2026-09-05
   * (`Foot` in ./GlossaryPanel.tsx), and none of the other seven readers ever
   * had a delete to need it for. A cross-family review said to remove it; it is
   * kept, on the narrower ground that this is a shared seam and the eight hooks
   * over it did not ask for a contract change — the first artefact to grow a
   * delete wants exactly this, and the generation counter it bumps is still
   * load-bearing for slug changes either way. Delete it if that stops being
   * true.
   */
  discard(): void;
}

export function useOrderedRead(read: ArtefactRead): OrderedRead {
  /* Bumped by every read and by every discard. A reply carrying an older number
     than the current one is news about an artefact that no longer exists. */
  const generation = useRef(0);
  /* The request in flight, so a second caller joins it instead of starting one.
     Cleared in `finally`, including on the throw. */
  const inFlight = useRef<Promise<void> | null>(null);
  /* Somebody asked for fresh data while a request was already out. That request
     may have read the database before the change they are asking about, so it is
     not an answer — one more read runs when it lands. A flag rather than a
     queue: two changes during one request still only need one more read. */
  const trailing = useRef(false);
  /* `reload` schedules itself for the trailing read, and a `useCallback` cannot
     name itself. */
  const latest = useRef<() => Promise<void>>(async () => {});

  /**
   * **A different article invalidates everything — during render, not in an
   * effect.**
   *
   * React runs child effects before the parent's, and the child is the band,
   * whose own mount effect calls `reload()`. So an effect that cleared
   * `inFlight` would clear the request the band had *just* started and then
   * start a second — the duplicate this whole mechanism exists to prevent,
   * rebuilt one layer down. `useGlossary` learned that with a test that counted
   * 2, and its slug-change block is the shape this replaces.
   *
   * Keyed on the identity of `read`, which every caller derives from the slug
   * with `useCallback` — so it is the same question asked in the one place the
   * hook already has to be right about. (`useSketch` also rekeys on the block
   * order, which is correct for the same reason: a read against the old order
   * must not commit against the new one.) Idempotent, so a second render pass
   * over the same value does nothing.
   */
  const reading = useRef(read);
  if (reading.current !== read) {
    reading.current = read;
    generation.current++;
    inFlight.current = null;
    trailing.current = false;
  }

  const reload = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const mine = ++generation.current;
    /* `| undefined`, and declared before it is assigned, so the `finally` below
       can ask whether the entry it is about to clear is still its own. Without
       that check this sequence loses the dedupe: request A is in flight;
       `discard()` nulls the entry; `reload()` starts request B and stores it;
       A's `finally` then nulls B's entry, and the next `reload()` starts a third
       request instead of joining B. Not a correctness bug — the generation
       counter still drops the stale replies — but it is the duplicate request
       this whole mechanism is about, rebuilt inside it.

       The `undefined` is load-bearing rather than cosmetic: `let run:
       Promise<void>` does not typecheck, because TypeScript cannot see that the
       `finally` runs only after an `await`. GPT Sol found that this change had
       been made in `useGlossary` without re-running the typechecker. */
    let run: Promise<void> | undefined;
    run = (async () => {
      try {
        await read(() => mine === generation.current);
      } finally {
        if (inFlight.current === run) inFlight.current = null;
        /* Somebody asked for fresh data while this was out. Only if we are still
           the current generation — a `discard()` since then means this
           artefact is being rebuilt and a read now would race it. */
        if (trailing.current && mine === generation.current) {
          trailing.current = false;
          void latest.current();
        }
      }
    })();
    inFlight.current = run;
    return run;
  }, [read]);
  latest.current = reload;

  const refresh = useCallback((): Promise<void> => {
    if (!inFlight.current) return reload();
    trailing.current = true;
    /* Awaited twice on purpose. The first await is the request already out; its
       `finally` is what launches the trailing one and puts it in `inFlight`, so
       the second await is that. Returning after the first would resolve before
       the refresh this function promised had happened — nothing awaits it today,
       which is exactly why the contract should not be left lying. GPT Sol,
       reviewing the built code. */
    return (async () => {
      await inFlight.current;
      if (inFlight.current) await inFlight.current;
    })();
  }, [reload]);

  const armRefresh = useCallback(() => {
    if (inFlight.current) trailing.current = true;
  }, []);

  const discard = useCallback(() => {
    generation.current++;
    inFlight.current = null;
    trailing.current = false;
  }, []);

  /* Nothing armed survives unmount. Without this, a request outstanding when the
     reader closes the article can finish, find `trailing` set, and launch a read
     for a page nobody is on. The generation check makes it harmless; it is still
     a request nobody wanted. */
  useEffect(
    () => () => {
      trailing.current = false;
    },
    [],
  );

  return { reload, refresh, armRefresh, discard };
}
