/**
 * **What "ready" means**, which the first draft of the plan never said — and
 * that omission was the most valuable thing GPT Sol found in it:
 *
 * > tests pass on SHA A → dev advances to B → typecheck passes on B → both
 * > latest tiles are green → the tab says ready even though no commit has
 * > passed both checks.
 * >
 * > — GPT Sol, 2026-09-09
 *
 * Two green tiles are not a green tree. Readiness is a **conjunction keyed to
 * one sha**, and it is computed here, once, by a pure function, so that no
 * renderer anywhere is left to imply it by putting two ticks next to each other.
 *
 * ## Not-ready is rare; unknown is the common answer
 *
 * The third arm is the point of the whole file. A tab that says
 * *unknown — typecheck has no reading on this commit* is useful and true. One
 * that says *not ready* for the same evidence is wrong, and one that says
 * *ready* is dangerous. Most of the time on this box the honest answer is
 * unknown, and the sentence that says which clause failed is the feature.
 */
import {
  REQUIRED_CHECKS,
  type CheckKind,
  type Reading,
  type RunRecord,
} from "./readiness.js";

export type Verdict =
  | { kind: "ready"; sha: string; evidence: Evidence[]; caveat: string }
  | { kind: "not-ready"; sha: string; failing: Evidence[]; evidence: Evidence[]; caveat: string }
  | { kind: "unknown"; why: string; sha: string | null; evidence: Evidence[] };

/** One check's contribution, kept whichever way the verdict went. */
export type Evidence = {
  check: CheckKind;
  state: "pass" | "fail" | "void" | "running" | "missing";
  /** The record behind it, when there is one. */
  record: RunRecord | null;
  /** A sentence a person can act on. */
  why: string;
};

export type VerdictInput = {
  /** Everything in the window, oldest first, already resolved. */
  readings: readonly Reading[];
  /** `origin/dev` as this box sees it, or null when git could not say. */
  devSha: string | null;
  /** The caveat about what "on dev" may claim — `readiness-git.ts`. */
  caveat: string;
  /**
   * Records that would not parse. **Non-zero forces `unknown`.**
   *
   * A corrupt latest record that is merely skipped exposes the *previous* pass
   * as the newest reading, which is this feature's signature failure wearing a
   * different hat. GPT Sol's P1.6.
   */
  unreadable: number;
  /** Which checks must pass. Injected so a test can narrow it. */
  required?: readonly CheckKind[];
};

/**
 * Can this reading vote?
 *
 * Every clause here is a way the first draft would have counted something it
 * should not have. They are checked in the order a person would explain them.
 */
export function canVote(reading: Reading, devSha: string): { ok: true } | { ok: false; why: string } {
  const r = reading.record;

  /* (1) The backfill may never vote. It has no sha AT ALL — nothing writes the
         commit into a tmux log — so "it passed on dev" is not a claim it is
         able to make, however green it looks. */
  if (r.source !== "wrapper") {
    return { ok: false, why: "it was reconstructed from a tmux log, which does not record the commit it ran on" };
  }

  /* (2) A narrowed run is not the check. `npm test -- one-file.test.ts` prints
         the same banner and a perfectly normal green summary. */
  if (r.scope !== "full") {
    return {
      ok: false,
      why:
        r.scope === "narrowed"
          ? `it ran \`${r.commandLine ?? "a narrowed command"}\`, which is not the whole check`
          : "what it actually ran could not be recovered, so its scope is unknown",
    };
  }

  if (r.state !== "finished") return { ok: false, why: "it has not finished" };
  if (reading.state !== "pass" && reading.state !== "fail") {
    return { ok: false, why: reading.why ?? "it did not reach a verdict" };
  }

  /* (3) Both ends of the run, and both clean. A 26-minute suite on a tree
         somebody edited at minute three is a reading about no commit that ever
         existed — and this is the clause that catches it. */
  if (r.treeAtStart.kind !== "known" || r.treeAtEnd.kind !== "known") {
    return { ok: false, why: "the commit it ran on could not be recorded" };
  }
  if (r.treeAtStart.sha !== r.treeAtEnd.sha) {
    return { ok: false, why: "the checkout moved to another commit while it was running, so it tested neither" };
  }
  if (r.treeAtStart.dirty || r.treeAtEnd.dirty) {
    return { ok: false, why: "the tree had uncommitted changes, so what passed was not any commit" };
  }
  if (r.treeAtStart.sha !== devSha) {
    return { ok: false, why: "it ran on a different commit" };
  }
  return { ok: true };
}

/**
 * The newest reading per check, among a set already narrowed by the caller.
 *
 * "Newest" is by `atMs`, never by position: once a backfill exists, directory
 * order is not time order, and a reader that took the last element would call
 * yesterday the latest. GPT Sol's P1.7.
 */
function newestPerCheck(readings: readonly Reading[]): Map<CheckKind, Reading> {
  const best = new Map<CheckKind, Reading>();
  for (const reading of readings) {
    const held = best.get(reading.record.check);
    if (held === undefined || reading.atMs > held.atMs) best.set(reading.record.check, reading);
  }
  return best;
}

/**
 * Is this reading an *attempt* on the dev sha that reached no verdict?
 *
 * Kept separate from the voting readings because it is a different kind of
 * fact. A run that is still going, or that died, does not fail a check — but it
 * does mean somebody thought there was a reason to run it again, and painting
 * green over the top of that is the stale-green the pending record exists to
 * prevent.
 */
function unsettlesDev(reading: Reading, devSha: string, required: readonly CheckKind[]): boolean {
  const r = reading.record;
  return (
    (reading.state === "running" || reading.state === "void") &&
    r.source === "wrapper" &&
    r.scope === "full" &&
    r.treeAtStart.kind === "known" &&
    r.treeAtStart.sha === devSha &&
    required.includes(r.check)
  );
}

export function readinessVerdict(input: VerdictInput): Verdict {
  const required = input.required ?? REQUIRED_CHECKS;

  if (input.unreadable > 0) {
    return {
      kind: "unknown",
      sha: input.devSha,
      evidence: [],
      why:
        `${input.unreadable} readiness record(s) could not be read, and the newest of them may be the ` +
        "one that matters — a corrupt latest record that is quietly skipped shows the PREVIOUS pass as " +
        "the current state, which is the one thing this tab must never do",
    };
  }

  if (input.devSha === null) {
    return {
      kind: "unknown",
      sha: null,
      evidence: [],
      why: "this box's git could not say what origin/dev is, so there is nothing to hold a reading against",
    };
  }
  const devSha = input.devSha;

  /* A full `npm run check` contains the required checks, so one passing check
     run on this sha satisfies all of them at once. Looked for first because it
     is the strongest single piece of evidence available. */
  const onDev = input.readings.filter((r) => canVote(r, devSha).ok);
  const wholeCheck = [...onDev].reverse().find((r) => r.record.check === "check");
  if (wholeCheck !== undefined && wholeCheck.state === "pass") {
    return {
      kind: "ready",
      sha: devSha,
      caveat: input.caveat,
      evidence: [
        {
          check: "check",
          state: "pass",
          record: wholeCheck.record,
          why: "a full `npm run check` passed on this commit, and its gates include the required checks",
        },
      ],
    };
  }

  /* **Narrowed to the readings that can vote BEFORE picking the newest.** The
     other way round — newest first, then ask whether it counts — reports a
     check that is currently re-running as one nobody has ever run, because the
     unfinished attempt is the newest thing there is. Found by this file's own
     test; the sentence it produced was true of nothing. */
  const newest = newestPerCheck(onDev);
  const evidence: Evidence[] = [];
  let missing = 0;
  let failing = 0;

  for (const check of required) {
    const reading = newest.get(check);
    if (reading === undefined) {
      /* Say WHY there is no reading, using the newest thing we do have. "It ran
         on another commit" and "nobody has ever run it" are different problems
         with different fixes, and a verdict that flattens them tells somebody
         to do the wrong thing about it. */
      const nearest = newestPerCheck(input.readings).get(check);
      const why =
        nearest === undefined
          ? "nothing has run it in this window"
          : `the latest reading does not count: ${(canVote(nearest, devSha) as { why?: string }).why ?? "it is not about this commit"}`;
      evidence.push({
        check,
        state: nearest?.state === "running" || nearest?.state === "void" ? nearest.state : "missing",
        record: nearest?.record ?? null,
        why,
      });
      missing += 1;
      continue;
    }
    evidence.push({
      check,
      state: reading.state === "pass" ? "pass" : "fail",
      record: reading.record,
      why: reading.state === "pass" ? "passed on this commit" : "failed on this commit",
    });
    if (reading.state !== "pass") failing += 1;
  }

  if (failing > 0) {
    return {
      kind: "not-ready",
      sha: devSha,
      failing: evidence.filter((e) => e.state === "fail"),
      evidence,
      caveat: input.caveat,
    };
  }

  /**
   * **A later attempt on the same sha unsettles the answer**, and this is asked
   * BEFORE "has anything run at all".
   *
   * A check that passed and is now being re-run, and a check that has never
   * run, are both `unknown` — but only one of them is about to have an answer,
   * and telling somebody "nobody has run it" while it is running would send
   * them to run it a third time.
   */
  const unsettled = input.readings.filter((r) => unsettlesDev(r, devSha, required));
  if (unsettled.length > 0) {
    const running = unsettled.filter((r) => r.state === "running");
    const which = [...new Set(unsettled.map((r) => r.record.check))].join(", ");
    return {
      kind: "unknown",
      sha: devSha,
      evidence,
      why:
        running.length > 0
          ? `a ${which} run on this commit is still going, so the answer is about to change`
          : `a ${which} run on this commit is unaccounted for — it started and never recorded how it ended`,
    };
  }

  if (missing > 0) {
    const names = evidence.filter((e) => e.state !== "pass").map((e) => e.check);
    return {
      kind: "unknown",
      sha: devSha,
      evidence,
      why: `no reading counts for ${names.join(" or ")} on this commit — not that they failed, that nobody has run them here`,
    };
  }

  return { kind: "ready", sha: devSha, evidence, caveat: input.caveat };
}
