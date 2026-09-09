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
  CHECK_KINDS,
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
export function aboutDevTree(reading: Reading, devSha: string): { ok: true } | { ok: false; why: string } {
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

  /* (3) The commit, at BOTH ends, and clean at both. A 26-minute suite on a tree
         somebody edited at minute three is a reading about no commit that ever
         existed — and this is the clause that catches it.

         A run still going has only a start stamp, and that is enough to say
         WHICH tree it is about, which is all an unsettling event needs. */
  if (r.treeAtStart.kind !== "known") {
    return { ok: false, why: "the commit it ran on could not be recorded" };
  }
  if (r.treeAtStart.sha !== devSha) {
    return { ok: false, why: "it ran on a different commit" };
  }
  if (r.treeAtStart.dirty) {
    return { ok: false, why: "the tree had uncommitted changes, so what it tested was not any commit" };
  }
  if (r.state === "finished") {
    if (r.treeAtEnd.kind !== "known") {
      return { ok: false, why: "the commit it ended on could not be recorded" };
    }
    if (r.treeAtStart.sha !== r.treeAtEnd.sha) {
      return { ok: false, why: "the checkout moved to another commit while it was running, so it tested neither" };
    }
    if (r.treeAtEnd.dirty) {
      return { ok: false, why: "the tree had uncommitted changes by the end, so what passed was not any commit" };
    }
  }
  return { ok: true };
}

/**
 * Can this reading vote — that is, is it about dev's tree AND did it reach a
 * verdict?
 *
 * Split from {@link aboutDevTree} because an unfinished run is still evidence:
 * it cannot say *green*, but it can say *do not call this settled*. Conflating
 * the two questions is what made a check that was being re-run report as one
 * nobody had ever run.
 */
export function canVote(reading: Reading, devSha: string): { ok: true } | { ok: false; why: string } {
  const about = aboutDevTree(reading, devSha);
  if (!about.ok) return about;
  if (reading.record.state !== "finished") return { ok: false, why: "it has not finished" };
  if (reading.state !== "pass" && reading.state !== "fail") {
    return { ok: false, why: reading.why ?? "it did not reach a verdict" };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * One timeline per required check.
 * ------------------------------------------------------------------ */

/**
 * **What happened to one check, at one instant.**
 *
 * The verdict used to work on "the newest reading whose `check` field is
 * `test`", and GPT Sol showed two ways that produces green over a tree that is
 * not:
 *
 * > 10:00 full `check` passes on A. 11:00 full `test` fails on A. The
 * > whole-check shortcut returns `ready` before the 11:00 evidence is examined.
 *
 * > 10:00 standalone test and typecheck pass on A. 11:00 full `check` fails
 * > with its table saying `test FAILED`. The newest whole-check is not a pass so
 * > the shortcut is skipped, and the old standalone passes are still the newest
 * > `test`/`typecheck` readings. Result: ready.
 *
 * Both come from the same mistake: a run of `npm run check` **is** a run of the
 * test and typecheck gates, and modelling it as a separate row lets the two
 * disagree with each other by age. So every reading is decomposed into events on
 * the timelines of the checks it actually says something about, and each
 * timeline is then reduced by taking its newest event. One rule, and neither
 * scenario survives it.
 */
type Event = {
  atMs: number;
  state: "pass" | "fail" | "unsettled";
  /** The reading it came from — a whole-check run, for a `test` event, is normal. */
  reading: Reading;
  why: string;
};

/** `npm run check`'s summary rows, by the check each row is about. */
function rowsOfCheck(reading: Reading): Map<CheckKind, "pass" | "fail"> {
  const rows = new Map<CheckKind, "pass" | "fail">();
  const record = reading.record;
  if (record.state !== "finished" || record.counts.kind !== "check") return rows;
  for (const step of record.counts.steps) {
    if (!(CHECK_KINDS as readonly string[]).includes(step.name)) continue;
    /* Only a `clean` row is a pass. `findings` on an advisory is not a failure
       and not a pass either — it says nothing about the gate we care about — so
       it contributes no event rather than a green one. */
    if (step.verdict === "clean") rows.set(step.name as CheckKind, "pass");
    else if (step.verdict === "failed" || step.verdict === "did-not-run") rows.set(step.name as CheckKind, "fail");
  }
  return rows;
}

/**
 * Every event a set of readings puts on each required check's timeline.
 *
 * The whole-check substitution is sound for the reason Sol confirmed: under
 * `scripts/check.ts`, a passing outer status plus its own footer proves the
 * test and typecheck **gates** completed successfully — a killed gate makes the
 * outer command fail, and a killed advisory runs after the gates and cannot
 * invalidate them. What was never sound was letting that pass outrank a fresher
 * result.
 */
/**
 * One failed `npm run check`, as an event on **every** required timeline.
 *
 * **Every required check gets an event — there is no "omit this one".** That
 * omission was a live false-green path, and GPT Sol drove it end to end:
 *
 * > 10:00 test passes on A. 10:00 typecheck passes on A. 10:30 `check` fails on
 * > A, but its accepted summary contains only `typecheck clean`. Because
 * > `rows.size > 0` the unreadable-table branch is skipped, no event is emitted
 * > for test, so its 10:00 pass survives and the verdict is `ready`.
 *
 * A table that names some rows and not others is not evidence that the unnamed
 * ones were fine; it is a table we could only partly read. So a missing row —
 * or a row whose verdict cannot convict, which under the current `check.ts` a
 * gate never prints — becomes `unsettled` rather than nothing.
 */
function wholeCheckFailureEvents(
  reading: Reading,
  required: readonly CheckKind[],
): { check: CheckKind; event: Event }[] {
  const rows = rowsOfCheck(reading);
  return required.map((check) => {
    const row = rows.get(check);
    if (row === undefined) {
      return {
        check,
        event: {
          atMs: reading.atMs,
          state: "unsettled" as const,
          reading,
          why:
            "a full `npm run check` failed on this commit and its summary does not say how this check " +
            "fared — a table we could only partly read is not evidence that the rest was fine",
        },
      };
    }
    return {
      check,
      event: {
        atMs: reading.atMs,
        state: row,
        reading,
        why:
          row === "pass"
            ? "clean in a full `npm run check` on this commit"
            : "failed in a full `npm run check` on this commit",
      },
    };
  });
}

function timelines(
  readings: readonly Reading[],
  devSha: string,
  required: readonly CheckKind[],
): Map<CheckKind, Event[]> {
  const out = new Map<CheckKind, Event[]>(required.map((check) => [check, []]));
  const add = (check: CheckKind, event: Event): void => {
    const line = out.get(check);
    if (line !== undefined) line.push(event);
  };

  for (const reading of readings) {
    if (!aboutDevTree(reading, devSha).ok) continue;
    const record = reading.record;

    /* An attempt that reached no verdict unsettles whatever it was an attempt
       AT — including, for a `check` run, every required check at once. */
    if (reading.state !== "pass" && reading.state !== "fail") {
      const why =
        reading.state === "running"
          ? "a run on this commit is still going, so the answer is about to change"
          : `a run on this commit is unaccounted for: ${reading.why ?? "it started and never recorded how it ended"}`;
      for (const target of record.check === "check" ? required : [record.check]) {
        add(target, { atMs: reading.atMs, state: "unsettled", reading, why });
      }
      continue;
    }

    if (record.check === "check") {
      if (reading.state === "pass") {
        for (const target of required) {
          add(target, {
            atMs: reading.atMs,
            state: "pass",
            reading,
            why: "a full `npm run check` passed on this commit, and its gates include this one",
          });
        }
      } else {
        for (const { check, event } of wholeCheckFailureEvents(reading, required)) add(check, event);
      }
      continue;
    }

    add(record.check, {
      atMs: reading.atMs,
      state: reading.state === "pass" ? "pass" : "fail",
      reading,
      why: reading.state === "pass" ? "passed on this commit" : "failed on this commit",
    });
  }
  return out;
}

/**
 * How bad an event is, for resolving two that happened in the same millisecond.
 *
 * **A tie must not be broken by input order.** Two runs can finish in the same
 * millisecond, and with a pass listed before a fail the reducer returned the
 * pass and the verdict came out green — filesystem order deciding whether the
 * tree is broken. GPT Sol, 2026-09-09. The worse event wins.
 */
const SEVERITY: Record<Event["state"], number> = { pass: 0, unsettled: 1, fail: 2 };

/**
 * **One timeline to one answer**, with the two rules that make it honest.
 *
 * *Newest wins* — by `atMs`, never by position: once a backfill exists,
 * directory order is not time order, and a reader taking the last element would
 * call yesterday the latest.
 *
 * *A known failure is sticky.* A check that failed and is now being re-run has
 * not stopped having failed. Reducing on "the newest event of any kind" turned
 * that into `unknown` the moment somebody retried — worse than the code it
 * replaced, and a flat contradiction of this file's own stated policy. So the
 * newest **settled** event decides, and a later unsettled one can only unsettle
 * a *pass*. GPT Sol's P1 regression, 2026-09-09.
 */
function reduceTimeline(events: readonly Event[]): Event | null {
  let settled: Event | null = null;
  let unsettled: Event | null = null;
  for (const event of events) {
    const slot = event.state === "unsettled" ? unsettled : settled;
    const better =
      slot === null ||
      event.atMs > slot.atMs ||
      (event.atMs === slot.atMs && SEVERITY[event.state] > SEVERITY[slot.state]);
    if (!better) continue;
    if (event.state === "unsettled") unsettled = event;
    else settled = event;
  }

  if (settled === null) return unsettled;
  if (settled.state === "fail") return settled;
  /* A pass, and something later that reached no verdict: not green any more.
     `>=` rather than `>` so a rerun that landed in the same millisecond as the
     pass it followed still unsettles it. */
  if (unsettled !== null && unsettled.atMs >= settled.atMs) return unsettled;
  return settled;
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

  const lines = timelines(input.readings, devSha, required);
  const evidence: Evidence[] = [];
  const failing: Evidence[] = [];
  const unsettled: Evidence[] = [];
  const missing: Evidence[] = [];

  for (const check of required) {
    const latest = reduceTimeline(lines.get(check) ?? []);
    if (latest === null) {
      /* Say WHY there is no event, from the newest reading that mentioned this
         check at all. "It ran on another commit" and "nobody has ever run it"
         are different problems with different fixes. */
      const nearest = reduceTimeline(
        input.readings
          .filter((r) => r.record.check === check)
          .map((r) => ({ atMs: r.atMs, state: "unsettled" as const, reading: r, why: "" })),
      );
      const item: Evidence = {
        check,
        state: "missing",
        record: nearest?.reading.record ?? null,
        why:
          nearest === null
            ? "nothing has run it in this window"
            : `the latest reading does not count: ${(aboutDevTree(nearest.reading, devSha) as { why?: string }).why ?? "it is not about this commit"}`,
      };
      evidence.push(item);
      missing.push(item);
      continue;
    }

    const item: Evidence = {
      check,
      state: latest.state === "pass" ? "pass" : latest.state === "fail" ? "fail" : latest.reading.state === "running" ? "running" : "void",
      record: latest.reading.record,
      why: latest.why,
    };
    evidence.push(item);
    if (latest.state === "fail") failing.push(item);
    else if (latest.state === "unsettled") unsettled.push(item);
  }

  /* **A known failure outranks a rerun in progress.** Somebody retrying a red
     check does not make it less red, and reporting `unknown` there would hide
     the one answer a person can act on. */
  if (failing.length > 0) {
    return { kind: "not-ready", sha: devSha, failing, evidence, caveat: input.caveat };
  }

  /* And an in-progress rerun outranks "nobody has run it": telling somebody
     nothing has run while it is running sends them to run it a third time. */
  if (unsettled.length > 0) {
    return {
      kind: "unknown",
      sha: devSha,
      evidence,
      why: `${unsettled.map((e) => e.check).join(", ")}: ${unsettled[0]?.why ?? "unsettled"}`,
    };
  }

  if (missing.length > 0) {
    return {
      kind: "unknown",
      sha: devSha,
      evidence,
      why: `no reading counts for ${missing.map((e) => e.check).join(" or ")} on this commit — not that they failed, that nobody has run them here`,
    };
  }

  return { kind: "ready", sha: devSha, evidence, caveat: input.caveat };
}
