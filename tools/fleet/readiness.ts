/**
 * **What a readiness reading is**: one run of one check, and enough about the
 * tree it ran on that the answer means something.
 *
 * > add a tab for "Readiness" that shows information about the latest tests and
 * > type-checking (on dev, when last run, able to trigger/refresh) and anything
 * > else you can think of. Ideally shows graphs of 24h history
 * >
 * > — Greg, 2026-09-08
 *
 * The plan is
 * docs/plans/260909b-readiness-tab-latest-tests-and-typecheck-on-dev-with-24h-graphs.md,
 * and § "What the first draft got wrong" is worth reading before changing
 * anything here. This file is the leaf: the shapes, and the functions that turn
 * bytes back into them. No filesystem, no git, no parsing of anybody's output —
 * those are `readiness-store.ts`, `readiness-git.ts` and `readiness-parse.ts`.
 *
 * ## THE STATES, WHICH ARE THE WHOLE DESIGN
 *
 * `health-history.ts` is the sibling and makes the same argument for the same
 * reason: everything here follows from refusing to merge these.
 *
 *  1. **Pass.** The check ran to completion and exited 0.
 *  2. **Fail.** It ran to completion and exited non-zero.
 *  3. **Void.** It started and we do not know how it ended. **Three different
 *     ways in**, and a design that merged them would lose the only thing that
 *     says which: no `EXIT=` line at all; a shell's 128+signal, which is a kill
 *     and not a verdict; or *the wrapper itself died before it could record*.
 *     (A run whose exit says 0 but which never printed its own summary is the
 *     third by another road — nothing showed it reached a conclusion.)
 *
 *     **A tree that changed under the run is NOT void**, and this used to say it
 *     was. Such a run reached a perfectly real verdict; what it cannot do is say
 *     that verdict was about any commit. That is a question for
 *     `readiness-verdict.ts`, which refuses it a vote, and the distinction
 *     matters because the run's own result is still worth drawing.
 *  4. **Running.** It started and has not finished. Its own state, because "no
 *     terminal record yet" and "no terminal record ever" differ in that only the
 *     first resolves itself.
 *  5. **No reading.** Nobody ran the check. It cannot be written down — the
 *     thing that would write it is the thing that was not there — so it is only
 *     ever an *absence*, and the page draws it as its own state.
 *  6. **A reading about a different tree.** A dozen worktrees run suites on a
 *     dozen branches on this box. A green `npm test` in someone else's worktree
 *     is a true fact about their branch and says nothing whatever about `dev`.
 *     Pooling those is the specific lie this tab exists not to tell, which is
 *     why every record carries two {@link TreeStamp}s and why that type has an
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
 * than a blank space. `other` is the escape hatch and it is a *stated* one — a
 * run we recognised and deliberately have no opinion about.
 */
export const CHECK_KINDS = ["test", "typecheck", "check", "lint", "build", "other"] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

/** The npm script each kind is, for the one place that maps between them. */
export const SCRIPT_FOR_KIND: Record<Exclude<CheckKind, "other">, string> = {
  test: "test",
  typecheck: "typecheck",
  check: "check",
  lint: "lint",
  build: "build",
};

/**
 * The checks a green tree has to have passed. See {@link readinessVerdict}'s
 * home in `readiness-verdict.ts`.
 *
 * `build` is deliberately not here even though `npm run check` gates on it: it
 * is the one check whose failure is visible within seconds of a deploy, and
 * requiring it would make the headline say `unknown` almost permanently while
 * nobody runs it standalone. It still shows as a row.
 */
export const REQUIRED_CHECKS: readonly CheckKind[] = ["test", "typecheck"];

/**
 * Did the run cover everything that check normally covers?
 *
 * **`npm test -- tests/one-file.test.ts` is not "the tests passed"**, and it is
 * the single easiest way for this tab to tell a comfortable lie: a targeted
 * two-second run of one file drawn identically to a 26-minute full suite. So
 * scope is recorded, § 5's conjunction reads only `full` records, and a
 * `narrowed` one draws in the history in its own tone with the command it
 * actually ran.
 *
 * `unknown` is a run whose command could not be recovered at all — a scanned
 * log where npm printed no banner. It counts for nothing, like `narrowed`.
 */
export type Scope = "full" | "narrowed" | "unknown";

/* ------------------------------------------------------------------ *
 * Which tree.
 * ------------------------------------------------------------------ */

/**
 * The commit a check ran on — **or a stated reason there is not one.**
 *
 * NOT `sha: string | null`. A null reads downstream as "no commit", and there
 * is a world of difference between *this came from a tmux log, which records no
 * commit at all* and *git would not run in that directory*. The first is a
 * permanent property of a source and the page says so once; the second is a
 * fault somebody should fix. The same argument `health.ts` makes about `why`.
 */
export type TreeStamp =
  | {
      kind: "known";
      /** Full 40-char sha. Abbreviating is the page's job, not the record's. */
      sha: string;
      /** The branch name, or null on a detached HEAD. */
      branch: string | null;
      /**
       * **Anything on disk that is not this commit**, at this instant —
       * modifications, staged changes, and untracked files that are not
       * gitignored.
       *
       * Untracked counts. A source file that was imported but never committed
       * makes the working tree compile and the commit not, which is the exact
       * failure `npm run typecheck:committed` exists for; a stamp used for
       * voting has to mean *what ran was this commit*.
       */
      dirty: boolean;
    }
  | { kind: "unknown"; why: string };

/* ------------------------------------------------------------------ *
 * What it found.
 * ------------------------------------------------------------------ */

export type TestTally = { passed: number; failed: number; skipped: number; total: number };

/**
 * One row of `npm run check`'s summary table.
 *
 * The gate/advisory split is the interesting half of that command
 * (scripts/check.ts § header): a gate is green today so a failure is news, and
 * an advisory is a to-do list with a known backlog. Collapsing them into one
 * red/green would re-teach everybody to ignore the whole thing, which is the
 * exact failure that file was written to avoid.
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
   * not read — and a wrapper record does not fill it in either: it keeps only
   * bounded ends of the output, and it does not try to infer a clean row's
   * gate status from the headings. So `unknown` is what a `✓` row gets from
   * either source, and the page shows it as unknown.
   *
   * Defaulting to `gate` would promote every clean advisory; defaulting to
   * `advisory` would demote every clean gate. Copying `check.ts`'s own list in
   * here would be a second source of truth kept in step by nothing.
   */
  gate: "gate" | "advisory" | "unknown";
  verdict: "clean" | "findings" | "failed" | "did-not-run";
  /** How many findings, where the table gave a number. Null for a bare `has findings`. */
  findings: number | null;
};

/**
 * The numbers a check reports, per check that reports any.
 *
 * A discriminated union rather than a bag of optionals: "371 tests passed" and
 * "126 complexity findings" are not one field wearing two hats, and a renderer
 * that has to guess which optionals are meaningful will one day print
 * `0 tests passed` over a typecheck.
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
      projects: number | null;
      /**
       * `error TS…` lines. **Supplementary, never the verdict.**
       *
       * `scripts/typecheck.ts` writes its failures to stderr and still ends with
       * `✓ all N source files are covered by some project` — so that tick
       * coexists with errors. It proves the run FINISHED; the exit status is the
       * only thing that says whether it passed. Counting the error lines here is
       * for the page to show, not for anything to conclude from.
       */
      errors: number | null;
    }
  | { kind: "check"; steps: CheckStep[] }
  /** The check reports no numbers, or none we recognised. Its own arm, not an empty one. */
  | { kind: "none" };

/* ------------------------------------------------------------------ *
 * The record on disk.
 * ------------------------------------------------------------------ */

/**
 * Where a record came from, on the wire because the two are not equally good.
 *
 * `wrapper` — `scripts/readiness-run.ts` ran the check itself, so it knows the
 * argv, the cwd, both instants and the sha at each end. The feature is built on
 * this one.
 *
 * `tmux-log` — reconstructed afterwards from a `logs/tmux-jobs/*.log`. It can
 * say when a run finished and how it ended; **it cannot say which commit it ran
 * on**, because nothing writes that into the log. Those arrive with `unknown`
 * tree stamps, are never persisted, and **can never satisfy the readiness
 * verdict**. Merging the two would make a strong claim out of a weak one.
 */
export type RecordSource = "wrapper" | "tmux-log";

/** Everything both states carry. */
type RunCommon = {
  schema: 1;
  /** Unique per run. Also printed into the tmux log, so the scan can skip its own wrapper. */
  runId: string;
  startedAt: string;
  /** The wrapper's pid, so a pending record can be resolved. Null for a scanned run. */
  pid: number | null;
  /** `os.hostname()`. A pid is only meaningful on the box that minted it. */
  host: string | null;
  /**
   * **The kernel's own start time for that pid**, field 22 of
   * `/proc/<pid>/stat`, in clock ticks since boot. Null off Linux, or when
   * `/proc` could not be read.
   *
   * A pid alone does not identify a process. GPT Sol's P1.2: the wrapper dies,
   * the box reboots or the pid is recycled within the trust window, and an
   * unrelated process now owns the number — so a dead run reads as *running*
   * for ever, and the tab reports a suite in progress that nobody is running.
   *
   * The pair (pid, starttime) is unique for the life of a boot, so comparing it
   * turns "some process has this number" into "this process is still here".
   */
  procStartToken: string | null;
  cwd: string;
  check: CheckKind;
  scope: Scope;
  /**
   * The command as actually run — the argv for a wrapper, npm's own second
   * banner line for a scanned log. Null when neither was recoverable. Shown
   * verbatim; never re-parsed to decide anything.
   */
  commandLine: string | null;
  treeAtStart: TreeStamp;
  source: RecordSource;
};

/**
 * **The pending record, written BEFORE the child is spawned.**
 *
 * This is the finding that mattered most in GPT Sol's plan review, because the
 * case it describes is the exact one this feature exists to expose:
 *
 * > dev's previous run passed → a new run starts → the wrapper is selected by
 * > the OOM killer before append → the store contains no evidence of the
 * > attempt → the dashboard continues displaying the old pass as the latest
 * > readiness result.
 *
 * A wrapper that only records after its child ends can identify a signal-killed
 * child but cannot record its own death, and its own death is a *box* failure —
 * the loudest thing this tab could possibly have to say.
 */
export type StartedRecord = RunCommon & { state: "started" };

export type Outcome = "pass" | "fail" | "void";

export type FinishedRecord = RunCommon & {
  state: "finished";
  /** When the run finished, ISO 8601. What the page sorts and plots by. */
  at: string;
  /** Wall clock, ms, measured on a MONOTONIC clock so an NTP step cannot make it negative. */
  durationMs: number | null;
  outcome: Outcome;
  /**
   * The exit status, when one was recovered.
   *
   * **A null forces `void`, but the reverse does not hold**: a run killed by
   * SIGTERM has a perfectly good status of 143 and is still void. Those are the
   * two different ways a run fails to produce a verdict — nobody wrote a status
   * down, and a status was written that means *killed* — and both must stay
   * distinguishable, because only the second says what killed it.
   */
  exit: number | null;
  counts: Counts;
  /**
   * The tree when the run ENDED.
   *
   * A 26-minute suite on a tree somebody edited at minute three is a reading
   * about no commit that ever existed. If this differs from `treeAtStart`, or
   * either end is dirty, the run cannot vote — see `readiness-verdict.ts`.
   */
  treeAtEnd: TreeStamp;
  logPath: string | null;
  /** Why this is void, or any other caveat worth carrying. Null when there is none. */
  why: string | null;
};

export type RunRecord = StartedRecord | FinishedRecord;

/* ------------------------------------------------------------------ *
 * The resolved view.
 * ------------------------------------------------------------------ */

/**
 * What a *reader* sees, which is not quite what is on disk.
 *
 * A `started` record with no terminal record is resolved here — never by a
 * writer — into `running` or `void`, by asking whether its process is still
 * alive. Doing it at read time is what lets a provisional answer correct itself
 * on the next poll instead of being frozen.
 */
export type ResolvedState = Outcome | "running";

export type Reading = {
  record: RunRecord;
  state: ResolvedState;
  /** When this reading is *about* — the finish for a finished run, the start otherwise. */
  atMs: number;
  /** Why it resolved this way, when that is not obvious. */
  why: string | null;
};

/**
 * A pending record we refuse to believe, however alive its pid looks.
 *
 * The **second** line of defence, behind the (pid, host, start-time) identity
 * in {@link RunCommon.procStartToken}. That identity is exact where `/proc` is
 * readable; this backstop covers the platforms and failures where it is not,
 * and it is what makes a stale record eventually resolve even if a pid were
 * somehow reused perfectly.
 *
 * Six hours is comfortably longer than the longest check here (`npm run check`,
 * ~26 minutes). A genuinely live run older than that reads as void, which is
 * deliberate and stated on the page rather than hidden. The alternative — a
 * heartbeat the wrapper keeps writing — is a second mechanism to maintain for a
 * case that has not happened.
 */
export const PENDING_TRUST_MS = 6 * 60 * 60 * 1000;

/**
 * Is the process that wrote this pending record still the one running?
 *
 * Takes the whole record rather than a pid, because a pid on its own is not an
 * identity: it needs the host it was minted on and the kernel's start time for
 * it. See {@link RunCommon.procStartToken}.
 */
export type IsRunProcessAlive = (record: RunRecord) => boolean;

export function resolveRecord(
  record: RunRecord,
  nowMs: number,
  isAlive: IsRunProcessAlive,
): Reading {
  if (record.state === "finished") {
    return {
      record,
      state: record.outcome,
      atMs: Date.parse(record.at),
      why: record.why,
    };
  }
  const startedMs = Date.parse(record.startedAt);
  const age = nowMs - startedMs;
  if (age > PENDING_TRUST_MS) {
    return {
      record,
      state: "void",
      atMs: startedMs,
      why:
        `it started ${Math.round(age / 3_600_000)} hours ago and never recorded an outcome — ` +
        "too long ago to trust a pid, so whether anything is still running is not knowable from here",
    };
  }
  if (record.pid !== null && isAlive(record)) {
    return { record, state: "running", atMs: startedMs, why: null };
  }
  return {
    record,
    state: "void",
    atMs: startedMs,
    why: "the process that started this run is gone and it never recorded an outcome — it was killed before it could",
  };
}

/* ------------------------------------------------------------------ *
 * Exit statuses.
 * ------------------------------------------------------------------ */

/**
 * The lowest and highest status a POSIX shell reports for a **signalled** child.
 *
 * `sh` sets `$?` to 128 + the signal number, and `scripts/tmux-job.ts` writes
 * exactly that into the log as `EXIT=<n>`. So a log ending `EXIT=137` is
 * SIGKILL — the OOM killer, which fires on this box — sitting under a page of
 * green ticks. That is not a failing suite and it is certainly not a passing
 * one.
 *
 * Linux's signals run to `SIGRTMAX` (64), so 129..192. **128 itself is
 * excluded**: it is what a shell reports for an invalid argument to `exit`,
 * not a signal at all.
 */
export const SIGNALLED_EXIT_MIN = 129;
/**
 * 128 + `SIGRTMAX`, **not 128 + 31.**
 *
 * This said 159 on the grounds that "signals are 1..31 and 160+ is nobody's
 * signal". That is false on Linux: the real-time signals run to 64, so a shell
 * status of 162 is signal 34. Reading that as an ordinary failure is the one
 * direction that costs something — a killed run drawn as a red suite sends
 * somebody hunting a bug that is not there — so the whole platform range is
 * treated as a kill. GPT Sol, 2026-09-09.
 *
 * The trade is that a check exiting 137 or 162 deliberately would be read as
 * killed. No check here does, and the failure mode is `void` rather than green.
 */
export const SIGNALLED_EXIT_MAX = 192;

export function isSignalledExit(exit: number): boolean {
  return Number.isInteger(exit) && exit >= SIGNALLED_EXIT_MIN && exit <= SIGNALLED_EXIT_MAX;
}

/**
 * What one recovered exit status means.
 *
 * **Three outcomes, not two.** A caller with no status at all must not reach
 * this — `void` from an absent status is the caller's own branch, and a default
 * parameter here would let `undefined` become a number and then a verdict. What
 * this decides is the other half: a status a shell only produces for a killed
 * process is `void` too, with the reason stated, because the alternative is
 * drawing an OOM kill as a red suite and sending somebody to look for a bug
 * that is not there.
 *
 * The error direction is deliberate. A check that genuinely exited 143 of its
 * own accord is misread as void — and void never renders green, so the cost of
 * being wrong is a reading that says *we do not know* where it could have said
 * *it failed*. That is the right way round.
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
          /* Anything unrecognised — including the `boolean` an earlier schema
             might have written — reads as `unknown` rather than being coerced.
             A `false` coerced to "advisory" demotes a gate, which is the half of
             that table that matters. */
          gate: gate === "gate" || gate === "advisory" ? gate : "unknown",
          verdict,
          findings: asFiniteNumber(step["findings"]),
        });
      }
      return { kind: "check", steps };
    }
    default:
      /* An arm this build does not know — written by a later one, or corrupt.
         `none` rather than a throw: a record whose numbers we cannot read is
         still a record of whether the check passed, which is the part the page
         most needs. */
      return { kind: "none" };
  }
}

/** A full commit id, and nothing that merely looks like one. */
const SHA = /^[0-9a-f]{40}$/;

/**
 * A tree stamp, **validated strictly enough that it cannot vote by accident.**
 *
 * The first version read `dirty: v["dirty"] === true`, which turns a *missing*
 * field into `false` — so a record with no `dirty` at all, from an older schema
 * or a corrupt write, parsed as a clean tree and could satisfy the readiness
 * conjunction. GPT Sol's P0.3:
 *
 * > `{"treeAtStart":{"kind":"known","sha":"<dev-sha>"}, …}` parses as clean and
 * > can vote. It should be unreadable, causing `unknown`.
 *
 * Returning `null` here makes the whole record unreadable, and an unreadable
 * record forces the verdict to `unknown` — which is the machinery that exists
 * so a corrupt latest record cannot expose an older green one. Making the field
 * lenient quietly routed around it.
 */
function asTree(v: unknown): TreeStamp | null {
  if (!isRecord(v)) return null;
  if (v["kind"] === "known") {
    const sha = asString(v["sha"]);
    if (sha === null || !SHA.test(sha)) return null;
    if (typeof v["dirty"] !== "boolean") return null;
    const branch = v["branch"] === null ? null : asString(v["branch"]);
    return { kind: "known", sha, branch, dirty: v["dirty"] };
  }
  if (v["kind"] === "unknown") {
    return { kind: "unknown", why: asString(v["why"]) ?? "no reason was recorded" };
  }
  return null;
}

/**
 * One file's bytes to a {@link RunRecord}, or null when they are not one.
 *
 * **Validated per field rather than cast.** These bytes crossed a persistence
 * boundary AND a version boundary — a build from last week wrote some of them,
 * and a build in another worktree is writing them right now — so a `JSON.parse`
 * result is `unknown` until something has looked at it. Casting here would hand
 * every consumer downstream a promise nobody checked: `health-history.ts`'s
 * finding 8, one file along.
 *
 * **The outcome and the exit status must agree**, and in both directions.
 * `pass` requires exactly 0; `fail` requires an ordinary non-zero. `void` keeps
 * the latitude, because it is the arm that means *we do not know* — it may
 * carry a kill status, an ordinary one, or none at all.
 *
 * Checking only the obvious contradictions was not enough: it left
 * `{"outcome":"pass","exit":1}` readable, and two records like that produce a
 * green verdict. GPT Sol's P0.3, 2026-09-09. Nothing downstream should ever
 * have to choose which half of a self-contradicting record to believe — an
 * unreadable record is a state the verdict already handles, by going `unknown`.
 */
export function parseRunRecord(text: string): RunRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed["schema"] !== 1) return null;

  const runId = asString(parsed["runId"]);
  const startedAt = asString(parsed["startedAt"]);
  const cwd = asString(parsed["cwd"]);
  const check = parsed["check"];
  const scope = parsed["scope"];
  const source = parsed["source"];
  const treeAtStart = asTree(parsed["treeAtStart"]);

  if (runId === null || startedAt === null || cwd === null || treeAtStart === null) return null;
  if (Number.isNaN(Date.parse(startedAt))) return null;
  if (!(CHECK_KINDS as readonly unknown[]).includes(check)) return null;
  if (scope !== "full" && scope !== "narrowed" && scope !== "unknown") return null;
  if (source !== "wrapper" && source !== "tmux-log") return null;

  const common: RunCommon = {
    schema: 1,
    runId,
    startedAt,
    pid: asFiniteNumber(parsed["pid"]),
    host: asString(parsed["host"]),
    procStartToken: asString(parsed["procStartToken"]),
    cwd,
    check: check as CheckKind,
    scope,
    commandLine: asString(parsed["commandLine"]),
    treeAtStart,
    source,
  };

  if (parsed["state"] === "started") return { ...common, state: "started" };
  if (parsed["state"] !== "finished") return null;

  const at = asString(parsed["at"]);
  const outcome = parsed["outcome"];
  const treeAtEnd = asTree(parsed["treeAtEnd"]);
  if (at === null || Number.isNaN(Date.parse(at)) || treeAtEnd === null) return null;
  if (outcome !== "pass" && outcome !== "fail" && outcome !== "void") return null;

  /* **The outcome and the status have to agree, in both directions.**
     Checking only the two obvious contradictions left `{"outcome":"pass","exit":1}`
     perfectly readable, and two records like that produce a `ready` verdict —
     GPT Sol's P0.3. `void` keeps the widest latitude, because it is the arm
     that means *we do not know*: it may carry a kill status, an ordinary
     status (a run that exited 0 without printing its own footer), or none. */
  const exit = asFiniteNumber(parsed["exit"]);
  if (outcome === "pass" && exit !== 0) return null;
  if (outcome === "fail" && (exit === null || exit === 0 || isSignalledExit(exit))) return null;

  const counts = asCounts(parsed["counts"]);
  if (outcome === "pass" && countsContradictPass(counts)) return null;

  return {
    ...common,
    state: "finished",
    at,
    durationMs: asFiniteNumber(parsed["durationMs"]),
    outcome,
    exit,
    counts,
    treeAtEnd,
    logPath: asString(parsed["logPath"]),
    why: asString(parsed["why"]),
  };
}

/**
 * Does a record's own detail contradict its claim to have passed?
 *
 * **The verdict and the counts are two views of one run, and a record where they
 * disagree is not a reading.** GPT Sol drove both of these to a green verdict:
 *
 * > a full `check` record with `outcome: "pass"`, `exit: 0`, clean stamps on
 * > dev, and a summary row saying `test FAILED` … emits passes for every
 * > required check. The same class exists for a standalone test record whose
 * > accepted Vitest tally contains failures but whose outcome says pass.
 *
 * Neither is producible by the wrapper — `npm run check` exiting 0 has no
 * `FAILED` row — so what this catches is a corrupt or hand-written record. That
 * is precisely the case the whole unreadable-record machinery exists for: a
 * record that cannot be trusted must make the verdict `unknown`, not vote. It
 * is the same rule as `{"outcome":"pass","exit":1}`, one field along.
 *
 * **Only `pass` is checked.** A failing run whose numbers look clean is
 * ordinary — a suite can fail in its setup with every test green — and refusing
 * those would throw away real failures to tidy up a shape.
 */
export function countsContradictPass(counts: Counts): boolean {
  switch (counts.kind) {
    case "vitest":
      return (counts.tests?.failed ?? 0) > 0 || (counts.files?.failed ?? 0) > 0;
    case "check":
      return counts.steps.some((step) => step.verdict === "failed");
    case "typecheck":
    case "none":
      /* `typecheck`'s error count is deliberately not a verdict — that file
         writes to stderr and its exit status is what decides — so a non-zero
         count beside a pass is not a contradiction here. */
      return false;
    default: {
      const never: never = counts;
      throw new Error(`unhandled counts kind: ${JSON.stringify(never)}`);
    }
  }
}
