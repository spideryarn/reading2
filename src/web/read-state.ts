/**
 * **What a component knows about one stored artefact, as one value.**
 *
 * A read of "the Ideas for this article" is always in exactly one of these
 * states, and a hook that keeps it as a status word, a value, an error string
 * and some flags can hold combinations that are none of them. Here the
 * combination is the value, and the only ways to make a new one are the three
 * functions below.
 *
 * **A type for a result, not a shared hook.** The fetch, the parse, what counts
 * as "none yet" and the copy stay in each hook; the order replies may commit in
 * is `useOrderedRead`'s; a running job and a rewrite hold are not read states.
 * Pure, and no React, so tests/read-state.test.ts can walk every cell.
 *
 * A spike on `useIdeas` alone:
 * docs/plans/261006n-one-type-for-a-read-spiked-on-useideas.md.
 */

/** `A` is everything that arrived with the answer. */
export type Read<A> =
  /** Nothing known: the opening read, or *Try again* with nothing on screen. */
  | { kind: "asking" }
  /** Nothing known, and the read failed. */
  | { kind: "failed"; error: string }
  | {
      kind: "known";
      /** `null`: the server said "none yet". */
      answer: A | null;
      /**
       * The last re-read failed, in a reader's sentence; `answer` still stands.
       * Test it with `!== null`, never truthiness.
       */
      recheck: string | null;
    };

/** A read answered: an answer, or `null` for "none yet". Any earlier failure is over. */
export function landed<A>(answer: A | null): Read<A> {
  return { kind: "known", answer, recheck: null };
}

/**
 * A read failed. What was known stays known — "none yet" included — under the
 * newest sentence; with nothing known there is only the failure.
 */
export function failedRead<A>(was: Read<A>, error: string): Read<A> {
  return was.kind === "known" ? { ...was, recheck: error } : { kind: "failed", error };
}

/**
 * *Try again* was pressed — and only that: an ordinary reload or refresh makes
 * no transition when it starts. An answer on screen stays there with its
 * failure cleared; anything else goes back to asking, a known "none yet"
 * included. That last case is today's behaviour and an open question
 * (tests/ideas-read-states.test.tsx § none yet, then a failed refresh).
 */
export function retrying<A>(was: Read<A>): Read<A> {
  return was.kind === "known" && was.answer !== null ? { ...was, recheck: null } : { kind: "asking" };
}

/** The answer on hand, if there is one — whatever the last re-read did. */
export function answerOf<A>(read: Read<A>): A | null {
  return read.kind === "known" ? read.answer : null;
}

/** The failure to tell the reader about, if the last read failed. */
export function failureOf(read: Read<unknown>): string | null {
  return read.kind === "failed" ? read.error : read.kind === "known" ? read.recheck : null;
}

/**
 * **For `useAutoRun` and nothing else** — the four words its interface takes.
 * A failed recheck changes none of them: "none yet" is still `none` and a list
 * is still `ready`, or a flaky connection would change what gets spent.
 */
export function statusOf(read: Read<unknown>): "loading" | "error" | "none" | "ready" {
  switch (read.kind) {
    case "asking":
      return "loading";
    case "failed":
      return "error";
    case "known":
      return read.answer === null ? "none" : "ready";
  }
}
