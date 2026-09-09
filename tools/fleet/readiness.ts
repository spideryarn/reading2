/**
 * **What a readiness reading is**: one finished run of one check, and enough
 * about the tree it ran on that the answer means something.
 *
 * > add a tab for "Readiness" that shows information about the latest tests and
 * > type-checking (on dev, when last run, able to trigger/refresh) and anything
 * > else you can think of. Ideally shows graphs of 24h history
 * >
 * > — Greg, 2026-09-08
 *
 * The plan is
 * docs/plans/260909b-readiness-tab-latest-tests-and-typecheck-on-dev-with-24h-graphs.md.
 * This file is the leaf: the shape, and the functions that turn bytes back into
 * it. No filesystem, no git, no parsing of anybody's output — those are
 * `readiness-history.ts`, `readiness-git.ts` and `readiness-parse.ts`.
 *
 * ## THE STATES, WHICH ARE THE WHOLE DESIGN
 *
 * `health-history.ts` is the sibling and its header makes the same argument for
 * the same reason: everything here follows from refusing to merge these.
 *
 *  1. **Pass.** The check ran to completion and exited 0.
 *  2. **Fail.** It ran to completion and exited non-zero.
 *  3. **Void.** It started and we do not know how it ended — killed, OOMed, a
 *     log with no `EXIT=` line. **This is not a fail, and it is emphatically
 *     not a pass.** The specimen on this box is a suite that ends `EXIT=143`
 *     over a log full of green ticks because something else killed it, and a
 *     `void` reading must never contribute a green pixel to anything.
 *  4. **No reading.** Nobody ran the check. It cannot be written down — the
 *     thing that would write it is the thing that was not there — so it is only
 *     ever the *absence* of a line, and the page draws it as its own state.
 *
 * And a fifth this feature has that box health never did:
 *
 *  5. **A reading about a different tree.** A dozen worktrees run suites on a
 *     dozen branches on this box. A green `npm test` in someone else's worktree
 *     is a true fact about their branch and says nothing whatever about `dev`.
 *     Pooling those is the specific lie this tab exists not to tell, which is
 *     why every reading carries a {@link TreeStamp} and why that stamp has an
 *     `unknown` arm rather than a nullable sha.
 */

/* ------------------------------------------------------------------ *
 * Which check.
 * ------------------------------------------------------------------ */

/**
 * The checks worth a row on the page, and `other` for a run that was one of
 * this repo's npm scripts but not one of these.
 *
 * A closed union rather than a free string: the panel has a row per kind and a
 * `Record<CheckKind, …>` is what makes a forgotten row a compile error rather
 * than a blank space. `other` is the escape hatch, and it is a *stated* one —
 * a run we recognised and deliberately do not have an opinion about.
 */
export const CHECK_KINDS = ["test", "typecheck", "check", "lint", "build", "other"] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

/** The npm script name each kind is, for the one place that maps between them. */
export const SCRIPT_FOR_KIND: Record<Exclude<CheckKind, "other">, string> = {
  test: "test",
  typecheck: "typecheck",
  check: "check",
  lint: "lint",
  build: "build",
};

/**
 * Did the run cover everything that check normally covers?
 *
 * **`npm test -- tests/one-file.test.ts` is not "the tests passed"**, and it is
 * the single easiest way for this tab to tell a comfortable lie: a targeted
 * two-second run of one file, drawn identically to a 26-minute full suite. So
 * scope is recorded, the page's "is dev green" line reads only `full` readings,
 * and a `narrowed` one is drawn in the history in its own muted tone with the
 * command it actually ran.
 *
 * `unknown` is for a reading whose command we could not recover at all, which
 * is what a scanned log gives when npm printed no banner.
 */
export type Scope = "full" | "narrowed" | "unknown";

/* ------------------------------------------------------------------ *
 * Which tree.
 * ------------------------------------------------------------------ */

/**
 * The commit the check ran on — **or a stated reason there is not one.**
 *
 * NOT `sha: string | null`. A null would be read by every consumer downstream
 * as "no commit", and there is a world of difference between *this reading came
 * from a tmux log, which records no commit at all* and *git was not available
 * in that directory*. The first is a permanent property of the backfill source
 * and the page says so once; the second is a fault somebody should fix. The
 * same argument `health.ts` makes about its readings' `why`.
 *
 * `dirty` is the tree state **when the run started**. A 26-minute suite on a
 * tree that was edited at minute three is a reading about no commit that ever
 * existed, and saying so is the whole value of the field.
 */
export type TreeStamp =
  | {
      kind: "known";
      /** Full 40-char sha. Abbreviating is the page's job, not the record's. */
      sha: string;
      /** The branch name, or null on a detached HEAD. */
      branch: string | null;
      /** Uncommitted changes present when the run started. */
      dirty: boolean;
    }
  | { kind: "unknown"; why: string };

/* ------------------------------------------------------------------ *
 * What it found.
 * ------------------------------------------------------------------ */

/**
 * The numbers a check reports, per check that reports any.
 *
 * A discriminated union rather than a bag of optionals: "371 tests passed" and
 * "126 complexity findings" are not the same field wearing different hats, and
 * a renderer that has to guess which optionals are meaningful is a renderer
 * that will one day print `0 tests passed` over a typecheck.
 *
 * **Every count is nullable inside its arm**, because a parser that could not
 * find its summary block must say so rather than return a zero. A zero is a
 * measurement; a missing summary is not.
 */
export type Counts =
  | {
      kind: "vitest";
      /** `Test Files  2 passed (2)`. */
      files: TestTally | null;
      /** `Tests  1 failed | 4 passed (5)`. */
      tests: TestTally | null;
    }
  | {
      kind: "typecheck";
      /** How many tsconfig projects it reported on. */
      projects: number | null;
      /**
       * `error TS…` lines it printed. **Supplementary, never the verdict** —
       * `scripts/typecheck.ts` writes its failures to stderr and its last two
       * lines are always ticks, so the exit code is the only thing that decides.
       */
      errors: number | null;
    }
  | {
      kind: "check";
      /** One per step of `npm run check`'s summary table, in its own order. */
      steps: CheckStep[];
    }
  /** The check reports no numbers, or none we recognised. Its own arm, not an empty one. */
  | { kind: "none" };

export type TestTally = { passed: number; failed: number; skipped: number; total: number };

/**
 * One row of `npm run check`'s summary table.
 *
 * The gate/advisory split is the interesting half of that command
 * (scripts/check.ts § header): a gate is green today so a failure is news, and
 * an advisory is a to-do list with a known backlog. Collapsing the two into one
 * red/green would re-teach everybody to ignore the whole thing, which is the
 * exact failure that file was written to avoid.
 *
 * `did-not-run` is its own verdict for the same reason it is one there: a
 * counted tool that crashed before printing scores zero findings, and zero
 * findings renders as clean.
 */
export type CheckStep = {
  name: string;
  /**
   * **Tri-state, because the summary table does not always say.**
   *
   * `scripts/check.ts` prints `✗` only for a failing gate and `!` only for a
   * noisy advisory, so those two marks are proof. A `✓` is printed for both,
   * and the `── typecheck (gate)` heading that would settle it is hundreds of
   * lines earlier — inside the part of a multi-megabyte log the scanner does
   * not read. A wrapper reading, which holds the whole output, fills it in.
   *
   * Defaulting to `gate` would promote every clean advisory; defaulting to
   * `advisory` would demote every clean gate. Copying `check.ts`'s own list in
   * here would be a second source of truth kept in step by nothing. So it says
   * `unknown` and the page shows it as unknown.
   */
  gate: "gate" | "advisory" | "unknown";
  verdict: "clean" | "findings" | "failed" | "did-not-run";
  /** How many findings, where the table gave a number. Null for a bare `has findings`. */
  findings: number | null;
};

/* ------------------------------------------------------------------ *
 * The reading.
 * ------------------------------------------------------------------ */

export type Outcome = "pass" | "fail" | "void";

/**
 * Where a reading came from, and it is on the wire because the two sources are
 * not equally good.
 *
 * `wrapper` — `scripts/readiness-run.ts` ran the check itself, so it knows the
 * argv, the cwd, the sha and both instants. This is the source the feature is
 * built on.
 *
 * `tmux-log` — reconstructed afterwards from a `logs/tmux-jobs/*.log`. It can
 * say when a run finished and how it ended; **it cannot say which commit it ran
 * on**, because nothing writes that into the log. Those readings arrive with an
 * `unknown` {@link TreeStamp} and the page draws them differently. Merging the
 * two would make a strong claim out of a weak one.
 */
export type ReadingSource = "wrapper" | "tmux-log";

export type Reading = {
  schema: 1;
  /** When the run FINISHED, ISO 8601. The instant the page sorts and plots by. */
  at: string;
  /** When it started. Null for a scanned log, which does not record it. */
  startedAt: string | null;
  /** Wall clock, ms. Null when we only know one of the two instants. */
  durationMs: number | null;
  check: CheckKind;
  scope: Scope;
  /**
   * The command line as it was actually run — npm's own second banner line for
   * a scanned log, the argv for a wrapper reading. Null when neither was
   * recoverable. Shown verbatim; never re-parsed to decide anything.
   */
  commandLine: string | null;
  /** The directory it ran in — a worktree root, usually. */
  cwd: string;
  tree: TreeStamp;
  outcome: Outcome;
  /**
   * The process's exit status, when one was recovered.
   *
   * **A null here forces `outcome: "void"`, but the reverse does not hold**: a
   * run killed by SIGTERM has a perfectly good status of 143 and is still void.
   * Those are the two different ways a run fails to produce a verdict — nobody
   * wrote a status down, and a status was written that means *killed* — and
   * both must stay distinguishable, because only the second can tell you what
   * killed it. See {@link outcomeFromExit}.
   */
  exit: number | null;
  counts: Counts;
  /** Where to go and read the whole thing. Null for a wrapper run that kept no log. */
  logPath: string | null;
  source: ReadingSource;
  /**
   * Why this reading is `void`, or any other caveat worth carrying. Null when
   * there is nothing to say. Bounded — see `readiness-history.ts`.
   */
  why: string | null;
};

/* ------------------------------------------------------------------ *
 * Reading one back.
 * ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asTally(v: unknown): TestTally | null {
  if (!isRecord(v)) return null;
  const passed = asFiniteNumber(v["passed"]);
  const failed = asFiniteNumber(v["failed"]);
  const skipped = asFiniteNumber(v["skipped"]);
  const total = asFiniteNumber(v["total"]);
  if (passed === null || failed === null || skipped === null || total === null) return null;
  return { passed, failed, skipped, total };
}

function asCounts(v: unknown): Counts {
  if (!isRecord(v)) return { kind: "none" };
  switch (v["kind"]) {
    case "vitest":
      return { kind: "vitest", files: asTally(v["files"]), tests: asTally(v["tests"]) };
    case "typecheck":
      return {
        kind: "typecheck",
        projects: asFiniteNumber(v["projects"]),
        errors: asFiniteNumber(v["errors"]),
      };
    case "check": {
      const raw = v["steps"];
      if (!Array.isArray(raw)) return { kind: "check", steps: [] };
      const steps: CheckStep[] = [];
      for (const step of raw) {
        if (!isRecord(step)) continue;
        const name = asString(step["name"]);
        const verdict = step["verdict"];
        if (name === null) continue;
        if (verdict !== "clean" && verdict !== "findings" && verdict !== "failed" && verdict !== "did-not-run") {
          continue;
        }
        const gate = step["gate"];
        steps.push({
          name,
          /* Anything this build does not recognise — including the `boolean`
             an earlier schema might have written — reads as `unknown` rather
             than being coerced. A `false` coerced to "advisory" would demote a
             gate, which is the half of that table that matters. */
          gate: gate === "gate" || gate === "advisory" ? gate : "unknown",
          verdict,
          findings: asFiniteNumber(step["findings"]),
        });
      }
      return { kind: "check", steps };
    }
    default:
      /* An arm this build does not know — written by a later one, or corrupt.
         `none` rather than a throw: a reading whose numbers we cannot read is
         still a reading about whether the check passed, and that is the part
         the page most needs. */
      return { kind: "none" };
  }
}

function asTree(v: unknown): TreeStamp | null {
  if (!isRecord(v)) return null;
  if (v["kind"] === "known") {
    const sha = asString(v["sha"]);
    if (sha === null) return null;
    const branch = v["branch"] === null ? null : asString(v["branch"]);
    return { kind: "known", sha, branch, dirty: v["dirty"] === true };
  }
  if (v["kind"] === "unknown") {
    return { kind: "unknown", why: asString(v["why"]) ?? "no reason was recorded" };
  }
  return null;
}

/**
 * One line of the file to a {@link Reading}, or null when it is not one.
 *
 * **Validated per field rather than cast.** These bytes crossed a persistence
 * boundary AND a version boundary — a build from last week wrote some of them,
 * and a build in another worktree is writing them right now — so a `JSON.parse`
 * result is `unknown` until something has looked at it. Casting here would hand
 * every consumer downstream a promise nobody checked, which is
 * `health-history.ts`'s finding 8 and the same mistake one file along.
 *
 * Two invariants are enforced here rather than trusted, because the feature
 * rests on them:
 *
 *  - **No status means void.** A record claiming `pass` or `fail` with no exit
 *    status is not a reading, it is a guess, and we would rather drop it than
 *    draw it. (The converse is not an invariant: a void run may well have a
 *    status — 143 — and that status is the only thing that says what killed it.)
 *  - **A signalled status is never a verdict.** A record saying `pass` on exit
 *    143 contradicts itself; nothing downstream should have to decide which
 *    half to believe.
 */
export function parseReadingLine(line: string): Reading | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed["schema"] !== 1) return null;

  const at = asString(parsed["at"]);
  const cwd = asString(parsed["cwd"]);
  const check = parsed["check"];
  const scope = parsed["scope"];
  const outcome = parsed["outcome"];
  const source = parsed["source"];
  const tree = asTree(parsed["tree"]);

  if (at === null || cwd === null || tree === null) return null;
  if (!(CHECK_KINDS as readonly unknown[]).includes(check)) return null;
  if (scope !== "full" && scope !== "narrowed" && scope !== "unknown") return null;
  if (outcome !== "pass" && outcome !== "fail" && outcome !== "void") return null;
  if (source !== "wrapper" && source !== "tmux-log") return null;
  if (Number.isNaN(Date.parse(at))) return null;

  const exit = asFiniteNumber(parsed["exit"]);
  if (exit === null && outcome !== "void") return null;
  if (exit !== null && isSignalledExit(exit) && outcome !== "void") return null;

  const startedAt = asString(parsed["startedAt"]);
  if (startedAt !== null && Number.isNaN(Date.parse(startedAt))) return null;

  return {
    schema: 1,
    at,
    startedAt,
    durationMs: asFiniteNumber(parsed["durationMs"]),
    check: check as CheckKind,
    scope,
    commandLine: asString(parsed["commandLine"]),
    cwd,
    tree,
    outcome,
    exit,
    counts: asCounts(parsed["counts"]),
    logPath: asString(parsed["logPath"]),
    source,
    why: asString(parsed["why"]),
  };
}

/**
 * The lowest and highest status a POSIX shell reports for a **signalled** child.
 *
 * `sh` sets `$?` to 128 + the signal number, and `scripts/tmux-job.ts` writes
 * exactly that `$?` into the log as `EXIT=<n>`. So a log ending `EXIT=143` is
 * SIGTERM — a run something else on this box killed — sitting under a page of
 * green ticks, which is the specimen this feature's `void` arm exists for. That
 * is not a failing suite and it is certainly not a passing one.
 *
 * Signals are 1..31 on Linux, so 129..159. **128 itself is excluded**: it is
 * what a shell reports for an invalid argument to `exit`, not a signal, and
 * 160+ is nobody's signal.
 */
export const SIGNALLED_EXIT_MIN = 129;
export const SIGNALLED_EXIT_MAX = 159;

export function isSignalledExit(exit: number): boolean {
  return Number.isInteger(exit) && exit >= SIGNALLED_EXIT_MIN && exit <= SIGNALLED_EXIT_MAX;
}

/**
 * What one recovered exit status means.
 *
 * **Three outcomes, not two.** A caller with no status at all must not reach
 * this function — `void` from an absent status is the caller's own branch, and
 * a default parameter here would let `undefined` become a number and then a
 * verdict. What this decides is the other half: a status that a shell only
 * produces for a killed process is `void` too, with the reason stated, because
 * the alternative is drawing an OOM kill as a red suite and sending somebody
 * off to look for a bug that is not there.
 *
 * The error direction is deliberate. A check that genuinely exited 143 of its
 * own accord would be misread as void — and void never renders green, so the
 * cost of being wrong here is a reading that says *we do not know* where it
 * could have said *it failed*. That is the right way round.
 */
export function outcomeFromExit(exit: number): { outcome: Outcome; why: string | null } {
  if (exit === 0) return { outcome: "pass", why: null };
  if (isSignalledExit(exit)) {
    return {
      outcome: "void",
      why:
        `the process was killed by signal ${exit - 128} (exit ${exit}), so whatever its output says ` +
        "it did not finish — this box's OOM killer fires under load",
    };
  }
  return { outcome: "fail", why: null };
}

/** Did the run finish AND cover the whole check? The question the page's headline asks. */
export function isFullVerdict(reading: Reading): boolean {
  return reading.scope === "full" && reading.outcome !== "void";
}
