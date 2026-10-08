/**
 * **Which commit to deploy, and whether its tests have already been seen to
 * pass** — the two judgements behind `npm run deploy -- --ready`.
 * docs/plans/261007k-deploy-a-commit-the-readiness-loop-already-saw-green.md.
 *
 * Pure, like `deploy-checks.ts` beside it: the store read and the git calls are
 * in `deploy.ts`, so every refusal here can be tested against the broken record
 * rather than only the working one.
 *
 * ## What a reused test gate claims, and nothing more
 *
 * That **the readiness runner** ran a full `npm run check` on exactly this
 * commit, clean at both ends, within the last day, and that its `test` and
 * `typecheck` rows were clean — with nothing on that commit since that failed
 * or did not finish. Not that the suite passes in the deploy's own throwaway
 * worktree: the two are made the same way (261007k § 3, and the runner's
 * `.env.local` and corpus are refreshed by `scripts/readiness-loop.ts` for
 * that), but they are not the same process. The danger this file exists to
 * avoid is the one in docs/reusable/silent-success.md: a record that only
 * looks like evidence. So it does not restate what "green" means — it asks
 * `readinessVerdict`, whose five clauses took five review rounds — and adds
 * only what the deploy needs on top: which checkout, and how recently.
 */
import { aboutDevTree, readinessVerdict } from "../tools/fleet/readiness-verdict.js";
import { PREPARATION_VERSION, type FinishedRecord, type Reading } from "../tools/fleet/readiness.js";
import { asTestOutcome, RERUN_FILES_MAX, TEST_OUTCOME_VERSION, type TestOutcome } from "../tools/fleet/test-outcome.js";
import { SUITE_BUILDS } from "./deploy-checks.js";

/**
 * How old a passing run may be and still stand in for the test gate.
 *
 * The commit cannot change; the box can — the shared local database, the
 * runner's `.env.local`, the installed tools. A day is the Readiness tab's own
 * window (`WINDOW_HOURS`). Runs here take 70–80 minutes, so this is roughly the
 * last eighteen of them.
 */
export const TEST_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type TestEvidence =
  | {
      kind: "reuse";
      /** The `npm run check` run whose `test` row stands in for the gate. */
      record: FinishedRecord;
      /** One line for the gate and the summary, naming the run. */
      sentence: string;
    }
  | { kind: "run"; why: string };

const hoursAgo = (ms: number): string => {
  const h = ms / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(ms / 60_000))}m ago` : `${h.toFixed(1)}h ago`;
};

/**
 * **Does the readiness store already prove this commit's test gate?**
 *
 * `readings` includes every record in the reuse window. The newest settled
 * result decides; an unfinished attempt cannot clear a failure.
 *
 * Every way of saying no is `run` with the reason, and the deploy then runs the
 * suite as it always did. There is no third answer.
 */
export function testEvidenceFor(opts: {
  sha: string;
  readings: readonly Reading[];
  /** Records in the store that would not parse. Any at all forces `run`. */
  unreadable: number;
  nowMs: number;
  /** `readinessRunnerPath(primary)`, from tools/fleet/readiness.ts. */
  runnerCwd: string;
  /** sha256 of the primary's `.env.local` now, hex; null when there is none. */
  envLocalSha256: string | null;
}): TestEvidence {
  const { sha, readings, unreadable, nowMs, runnerCwd, envLocalSha256 } = opts;
  const verdict = readinessVerdict({ readings, devSha: sha, caveat: "", unreadable });
  if (verdict.kind === "unknown") return { kind: "run", why: whyUnknown(verdict.why, readings, sha) };
  if (verdict.kind === "not-ready") {
    return {
      kind: "run",
      why: verdict.failing.map((e) => `${e.check}: ${e.why}`).join("; "),
    };
  }

  /* `ready`, so every required check's newest settled event on this sha is a
     pass. Now: is the one for `test` a run the deploy can stand behind? */
  const record = verdict.evidence.find((e) => e.check === "test")?.record ?? null;
  if (record === null || record.state !== "finished") {
    return { kind: "run", why: "the readiness verdict named no finished run for test" };
  }
  const testReadings = readings.filter((r) =>
    (r.record.check === "test" || r.record.check === "check") && aboutDevTree(r, sha).ok,
  );
  // A running check can start before another check finishes. Its start time
  // then loses to that finish in the tab's timeline, but it remains unfinished.
  if (testReadings.some((r) => r.state === "running")) {
    return { kind: "run", why: "a test or check on this commit is still going — an unfinished run cannot stand behind a deploy" };
  }
  // The verdict's equal-time passes have equal severity, so it keeps whichever
  // came first. That is enough to say green, but not to choose preparation or
  // prerequisite-build evidence. Refuse an ambiguous run instead of letting
  // filesystem order choose which record's stamp and rows are checked.
  if (testReadings.some((r) => r.record !== record && r.atMs === Date.parse(record.at))) {
    return { kind: "run", why: "multiple test/check records share the passing run's timestamp, so its preparation evidence is ambiguous" };
  }
  const problem = runnerRecordProblem({ record, sha, runnerCwd, envLocalSha256, testRow: "clean", nowMs, label: "the passing run" });
  if (problem !== null) return { kind: "run", why: problem };
  const age = nowMs - Date.parse(record.at);

  const minutes = record.durationMs === null ? "" : `, ${Math.round(record.durationMs / 60_000)}m`;
  return {
    kind: "reuse",
    record,
    sentence:
      `reused readiness run ${record.runId} (npm run check in the readiness runner, finished ` +
      `${record.at} — ${hoursAgo(age)}${minutes}): test and typecheck clean on ${sha.slice(0, 8)}`,
  };
}

/**
 * **Why one readiness run cannot stand behind a deploy's test gate**, or null
 * when it can — the clauses about the run itself, shared by the exact-commit
 * reuse above and the partial one below ({@link readinessFullRun}), so neither
 * restates them. Which run to ask about is the caller's question.
 */
function runnerRecordProblem(opts: {
  record: FinishedRecord;
  sha: string;
  runnerCwd: string;
  envLocalSha256: string | null;
  /** What the `test` row must say: `clean`, or either for a run whose failures a rerun repeats. */
  testRow: "clean" | "clean-or-failed";
  nowMs: number;
  /** "the passing run", "the run" — for the sentences. */
  label: string;
}): string | null {
  const { record, sha, runnerCwd, envLocalSha256, testRow, nowMs, label } = opts;
  if (record.check !== "check") {
    return (
      `${label} is a \`${record.check}\` run, not a full \`npm run check\` — ` +
      "only the check runs the builds the suite reads, in the order the deploy does"
    );
  }
  if (record.cwd !== runnerCwd) {
    return (
      `${label} ran in ${record.cwd}, not in the readiness runner (${runnerCwd}) — ` +
      "another checkout's .env.local, node_modules and corpus are whatever was left there"
    );
  }
  /* **The loop's own statement that it prepared this checkout at this sha.**
     The directory alone is not that: a record from before the corpus refresh
     and the linked `.env.local`, or a wrapper somebody ran by hand in the
     runner, has the right cwd and none of the preparation (GPT Sol, P1-1). */
  const prep = record.preparation ?? null;
  if (prep === null) {
    return `${label} carries no preparation stamp from the readiness loop (a hand run, or one from before 2026-10-07)`;
  }
  if (prep.version !== PREPARATION_VERSION) {
    return `${label} was prepared the version-${prep.version} way, not version ${PREPARATION_VERSION}`;
  }
  if (prep.envLocalVerified !== true) return "the wrapper did not verify the prepared .env.local at both ends of this run";
  if (prep.sha !== sha) return `${label}'s preparation is about ${prep.sha.slice(0, 8)}, not ${sha.slice(0, 8)}`;
  if (envLocalSha256 === null) return "this checkout has no .env.local to compare the run's with";
  if (prep.envLocalSha256 !== envLocalSha256) return `.env.local has changed since ${label} read it`;
  if (record.testOutcomeVersion !== TEST_OUTCOME_VERSION) return `${label} has no version-${TEST_OUTCOME_VERSION} outcome proving completed teardown`;
  if (testRow === "clean" && record.testOutcome?.kind !== "pass") {
    return `${label}'s test row is clean but its reporter says ${record.testOutcome == null ? "nothing" : record.testOutcome.kind === "unusable" ? record.testOutcome.why : record.testOutcome.kind}`;
  }

  /* **Every step the deploy's own gate runs before its tests, clean in this
     run's table.** `check.ts` carries on past a failed build, so a clean test
     row can sit on top of the previous commit's `api-dist/` (GPT Sol, P1-2);
     and the verdict reads a missing row as a pass, which is right for the tab
     and wrong here. A row missing is a refusal. */
  const rows = record.counts.kind === "check" ? record.counts.steps : [];
  for (const step of ["typecheck", ...SUITE_BUILDS, "test"]) {
    const found = rows.filter((r) => r.name === step);
    if (found.length === 0) return `${label}'s summary has no \`${step}\` row`;
    const allowed = step === "test" && testRow === "clean-or-failed" ? ["clean", "failed"] : ["clean"];
    const bad = found.find((r) => !allowed.includes(r.verdict));
    if (bad !== undefined) return `\`${step}\` was ${bad.verdict} in ${label}`;
  }

  const atMs = Date.parse(record.at);
  if (!Number.isFinite(atMs)) return `${label}'s finish time '${record.at}' does not parse`;
  if (atMs > nowMs) return `${label} says it finished at ${record.at}, which is in the future on this clock`;
  const age = nowMs - atMs;
  if (age > TEST_EVIDENCE_MAX_AGE_MS) {
    return `${label} finished ${hoursAgo(age)}, older than the ${TEST_EVIDENCE_MAX_AGE_MS / 3_600_000}h a reused test gate may be`;
  }
  return null;
}

/**
 * The verdict's `unknown` sentence, plus which clause the newest run that
 * started on this sha failed. The verdict alone says "no reading counts" and
 * not why, and "the tree was dirty" and "nothing ever ran here" send the
 * operator to different places.
 */
function whyUnknown(verdictWhy: string, readings: readonly Reading[], sha: string): string {
  const onSha = readings
    .filter((r) => r.record.treeAtStart.kind === "known" && r.record.treeAtStart.sha === sha)
    .sort((a, b) => b.atMs - a.atMs)[0];
  if (onSha === undefined) return `no readiness run in the store is about ${sha.slice(0, 8)}`;
  const about = aboutDevTree(onSha, sha);
  return about.ok ? verdictWhy : `${verdictWhy} — the newest run on it (${onSha.record.runId}) does not count: ${about.why}`;
}

/* ------------------------------------------------------------------ */
/* Rerunning only what failed — docs/plans/261008h                     */
/* ------------------------------------------------------------------ */

/**
 * One full run of the suite on one commit, from either place that keeps them:
 * the deploy's own test gate (`logs/deploy/test-runs/`) or the readiness loop's
 * `npm run check`. Built by {@link readinessFullRuns} and the deploy's reader of
 * its own records; judged by {@link partialEvidenceFor}.
 */
export type FullRun = {
  source: "deploy-gate" | "readiness";
  /** The readiness run id, or the deploy record's file name. */
  id: string;
  sha: string;
  /** When it finished. */
  atMs: number;
  /** What the suite showed, as far as a rerun goes. */
  outcome: TestOutcome;
  /** Why this run cannot stand in at all, whatever its outcome — or null. */
  refusal: string | null;
  /** Started and not finished; `atMs` is its start. Blocks every run on its commit. */
  running?: true;
};

export type PartialEvidence =
  | {
      kind: "rerun";
      from: FullRun;
      /** The test files to run at the candidate, sorted. Empty: nothing to rerun. */
      files: string[];
      /** One line for the gate and the summary. */
      sentence: string;
    }
  | { kind: "run"; why: string };

/**
 * How old the run may be when it answers for a **different** commit. The
 * exact-commit reuse keeps {@link TEST_EVIDENCE_MAX_AGE_MS}; a run standing in
 * for later commits it never saw is held to a much shorter leash, so the
 * changes it did not test are hours of `dev`, not a day of it (GPT Sol on
 * 261008h, P2-3).
 */
export const CROSS_COMMIT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * **Files whose change can alter a test's result without being a test**: what
 * the suite is run with rather than what it tests. A change here since the run
 * means the whole suite, because rerunning the failed files would answer a
 * question about a different harness. Every file under `tests/` that is not
 * itself a test is in — fixtures, helpers, setup, snapshots — which is cruder
 * than listing them and cannot go stale (GPT Sol on 261008h, P2-4).
 */
const TEST_INFRASTRUCTURE = [
  "package.json",
  "package-lock.json",
  ".npmrc",
  "vitest.config.ts",
  "vitest-admission.ts",
  "admission-journal.ts",
  "tsconfig.json",
  "tsconfig.base.json",
  "scripts/vitest-outcome-reporter.ts",
  "scripts/db-test-create.ts",
  "scripts/corpus-materialise.ts",
];

export function isTestInfrastructure(p: string): boolean {
  return TEST_INFRASTRUCTURE.includes(p) || (p.startsWith("tests/") && !isTestFile(p));
}

/** A file vitest would collect: the include pattern in `vitest.config.ts`. */
export function isTestFile(p: string): boolean {
  return /^tests\/.+\.test\.tsx?$/.test(p);
}

/**
 * **May the candidate's test gate run only some files, and which?**
 *
 * The newest run on the *nearest* retained ancestor of the candidate (the
 * candidate itself included) decides before age limits are applied, and it must
 * be a whole-suite run, settled, and — unless it is on the candidate itself —
 * younger than {@link CROSS_COMMIT_MAX_AGE_MS}. Green or red only in files it
 * named, the gate reruns those files and every test file changed since;
 * anything else is `run`, the whole suite, with the reason. A nearer run that
 * cannot be used does not fall back to an older one that can: whatever made it
 * unusable may be what changed in between. A newer attempt on the same commit
 * that is still going, or was not a whole-suite run, blocks the older one the
 * same way (its `refusal` says so) — the timeline `testEvidenceFor` reads
 * through `readinessVerdict`, kept here (GPT Sol on 261008h, P1-8).
 *
 * What a pass here claims is "a whole run at X, and these files at the
 * candidate" — never that the suite passed at the candidate. The risk taken is
 * Greg's (2026-10-08, the plan's header): a change since the run that breaks a
 * test nobody reruns. The readiness loop's next full run is what catches it.
 */
export function partialEvidenceFor(opts: {
  /** The candidate. */
  sha: string;
  runs: readonly FullRun[];
  nowMs: number;
  /** Is `a` an ancestor of (or equal to) `b`? null when git could not say. */
  isAncestor: (a: string, b: string) => boolean | null;
  /** `git rev-list --count <sha>`, or null. */
  ancestors: (sha: string) => number | null;
  /** `git diff --name-only <x> <candidate>`, or null when git could not say. */
  changedSince: (x: string) => string[] | null;
  /** Does the candidate have this path? */
  existsAtCandidate: (p: string) => boolean;
}): PartialEvidence {
  const { sha, runs, nowMs, isAncestor, ancestors, changedSince, existsAtCandidate } = opts;
  const related: FullRun[] = [];
  for (const r of runs) {
    const contains = isAncestor(r.sha, sha);
    if (contains === null) return { kind: "run", why: `git could not place the run on ${r.sha.slice(0, 8)} in the candidate's history` };
    if (contains) related.push(r);
  }
  /* **A run still going says nothing yet**, so it does not decide which
     commit is nearest: the readiness loop is mid-run most of the time, on a
     commit newer than its last verdict, and letting that attempt stand in
     the way would send nearly every deploy to the whole suite (measured
     against the store on 2026-10-08). It still blocks the runs on its own
     commit, below — the same-commit rule `testEvidenceFor` applies. A void
     run is different: it ended without a verdict, possibly by hanging, so it
     stays on the timeline. */
  const settled = related.filter((r) => r.running !== true);
  if (settled.length === 0) {
    return {
      kind: "run",
      why:
        `no full run of the suite on ${sha.slice(0, 8)} or an ancestor in the last ${TEST_EVIDENCE_MAX_AGE_MS / 3_600_000}h` +
        (related.length > 0 ? " that has finished" : ""),
    };
  }

  const depth = new Map<string, number | null>();
  for (const r of settled) if (!depth.has(r.sha)) depth.set(r.sha, ancestors(r.sha));
  if ([...depth.values()].some((d) => d === null)) {
    return { kind: "run", why: "git could not count the history of a commit a run was on" };
  }
  const deepest = Math.max(...[...depth.values()].map((d) => d ?? 0));
  const nearestShas = [...depth.entries()].filter(([, d]) => d === deepest).map(([s]) => s);
  if (nearestShas.length !== 1) {
    return {
      kind: "run",
      why: `${nearestShas.map((s) => s.slice(0, 8)).join(" and ")} are equally near, so which run decides cannot be said`,
    };
  }
  const x = nearestShas[0] as string;
  if ([...depth.keys()].some((s) => s !== x && isAncestor(s, x) !== true)) {
    return { kind: "run", why: "runs are on incomparable ancestors, so the nearest run cannot be decided" };
  }
  const onX = settled.filter((r) => r.sha === x).sort((a, b) => b.atMs - a.atMs);
  const chosen = onX[0] as FullRun;
  /* A run on this same commit that has not finished may yet contradict the
     one chosen, whenever it started. */
  const running = related.find((r) => r.sha === x && r.running === true);
  if (running !== undefined) {
    return { kind: "run", why: `a run on ${x.slice(0, 8)} (${running.source} ${running.id}) is still going — an unfinished run cannot stand behind a deploy` };
  }
  if (onX.some((r) => r !== chosen && r.atMs === chosen.atMs)) {
    return { kind: "run", why: `two runs on ${x.slice(0, 8)} share one instant, so which decides cannot be said` };
  }
  const label = `the newest run on ${x.slice(0, 8)} (${chosen.source} ${chosen.id})`;
  if (chosen.atMs > nowMs) return { kind: "run", why: `${label} says it finished in the future on this clock` };
  const age = nowMs - chosen.atMs;
  if (age > TEST_EVIDENCE_MAX_AGE_MS) {
    return { kind: "run", why: `no full run in the last ${TEST_EVIDENCE_MAX_AGE_MS / 3_600_000}h on the nearest commit: ${label} finished ${hoursAgo(age)}` };
  }
  if (chosen.refusal !== null) return { kind: "run", why: `${label} cannot stand in: ${chosen.refusal}` };
  if (chosen.outcome.kind === "unusable") return { kind: "run", why: `${label} cannot be rerun in part: ${chosen.outcome.why}` };
  if (x !== sha && age > CROSS_COMMIT_MAX_AGE_MS) {
    return {
      kind: "run",
      why: `${label} finished ${hoursAgo(age)}; a run on another commit may stand in for ${CROSS_COMMIT_MAX_AGE_MS / 3_600_000}h at most`,
    };
  }

  const changed = x === sha ? [] : changedSince(x);
  if (changed === null) return { kind: "run", why: `git could not list what changed between ${x.slice(0, 8)} and ${sha.slice(0, 8)}` };
  const infra = changed.filter(isTestInfrastructure);
  if (infra.length > 0) {
    return {
      kind: "run",
      why: `the test harness changed since ${x.slice(0, 8)} (${infra.slice(0, 4).join(", ")}${infra.length > 4 ? " …" : ""})`,
    };
  }

  const failed = chosen.outcome.kind === "red-in-files" ? chosen.outcome.failed : [];
  const missing = failed.filter((p) => !existsAtCandidate(p) && !changed.includes(p));
  if (missing.length > 0) return { kind: "run", why: `failed files are missing without a committed deletion: ${missing.join(" ")}` };
  const files = [...new Set([...failed, ...changed.filter(isTestFile)])].filter(existsAtCandidate).sort();
  if (files.length > RERUN_FILES_MAX) {
    return { kind: "run", why: `${files.length} files to rerun — more than ${RERUN_FILES_MAX}, so the suite in all but name` };
  }

  const was = chosen.outcome.kind === "pass" ? "green" : `red only in ${failed.join(" ")}`;
  const on = x === sha ? `this commit` : `${x.slice(0, 8)} (${changed.length} file(s) changed since)`;
  return {
    kind: "rerun",
    from: chosen,
    files,
    sentence:
      `a whole run on ${on} by ${chosen.source} ${chosen.id}, ${hoursAgo(age)}, ${was} — ` +
      (files.length === 0 ? "nothing to rerun here" : `plus ${files.length} file(s) here: ${files.join(" ")}`),
  };
}

/**
 * The readiness store's runs of the suite, as {@link FullRun}s. A run about no
 * commit (dirty, or the tree moved under it) is left out — the verdict's rule. Everything else
 * that ran the tests on a commit is in, because a newer one can block an older
 * one: a run still going, or a `test` run rather than a full check, arrives
 * with a refusal. A full check that cannot be trusted carries the same clauses
 * the exact-commit reuse applies ({@link runnerRecordProblem}).
 */
export function readinessFullRuns(opts: {
  readings: readonly Reading[];
  runnerCwd: string;
  envLocalSha256: string | null;
  nowMs: number;
}): FullRun[] {
  const out: FullRun[] = [];
  for (const r of opts.readings) {
    const record = r.record;
    if (record.source !== "wrapper" || (record.check !== "check" && record.check !== "test")) continue;
    if (record.treeAtStart.kind !== "known") continue;
    const sha = record.treeAtStart.sha;
    const base = { source: "readiness" as const, id: record.runId, sha, atMs: r.atMs };
    if (r.state === "running") {
      out.push({ ...base, outcome: { kind: "unusable", why: "still running" }, refusal: "it is still running", running: true });
      continue;
    }
    /* Check the checkout separately from scope. Narrowed runs cannot stand
       in, but a newer red in one must still block the older whole run. */
    if (!aboutDevTree({ ...r, record: { ...record, scope: "full" } }, sha).ok) continue;
    if (record.state !== "finished" || r.state === "void") {
      out.push({ ...base, outcome: { kind: "unusable", why: r.why ?? "the run never finished" }, refusal: "it did not reach a verdict" });
      continue;
    }
    if (record.check !== "check" || record.scope !== "full") {
      out.push({ ...base, outcome: { kind: "unusable", why: "not a full check" }, refusal: `it is a ${record.scope} \`${record.check}\` run, not a full \`npm run check\`` });
      continue;
    }
    const label = `readiness run ${record.runId}`;
    const refusal = runnerRecordProblem({ ...opts, record, sha, testRow: "clean-or-failed", label });
    /* The test row and the reporter, not the record's own outcome: a full
       check fails for its other gates too, and those are not the test gate's
       business (GPT Sol on 261008h, P1-8). */
    const row = record.counts.kind === "check" ? record.counts.steps.find((s) => s.name === "test")?.verdict : undefined;
    const reported = record.testOutcome ?? null;
    let outcome: TestOutcome;
    if (row === "clean") {
      outcome =
        reported === null
          ? { kind: "unusable", why: "its suite carries no reporter outcome" }
          : reported.kind === "pass"
            ? reported
            : { kind: "unusable", why: `its test row is clean but vitest's reporter says ${reported.kind === "unusable" ? reported.why : reported.kind}` };
    } else if (row === "failed") {
      outcome =
        reported === null
          ? { kind: "unusable", why: "its suite failed, and it carries no reporter outcome naming the files (a run from before 2026-10-08)" }
          : reported.kind === "pass"
            ? { kind: "unusable", why: "its test row failed but vitest's reporter says passed" }
            : reported;
    } else {
      outcome = { kind: "unusable", why: `its test row is ${row ?? "missing"}` };
    }
    out.push({ ...base, outcome, refusal });
  }
  return out;
}

/** One end of a deploy test run's checkout. */
export type DeployRunTree = { sha: string; clean: boolean; envLocalSha256: string | null };

/**
 * What the deploy writes after running the whole suite itself, one file per
 * run in `logs/deploy/test-runs/` of the primary, so the next deploy can rerun
 * only what failed. Only whole-suite runs are written: a rerun is reported and
 * not recorded, so evidence never chains from one partial run to the next.
 *
 * It guards against mistakes, not against a same-user agent forging one — no
 * file on this box can, the readiness store included (GPT Sol on 261008h, P1-9).
 */
export type DeployRunRecord = {
  schema: typeof TEST_OUTCOME_VERSION;
  by: "deploy-gate";
  /** Unique per run. */
  runId: string;
  sha: string;
  /** The throwaway worktree it ran in. */
  root: string;
  startedAt: string;
  /** When it finished. */
  at: string;
  /** vitest's exit status; null when it had none. */
  exit: number | null;
  atStart: DeployRunTree;
  atEnd: DeployRunTree;
  /** Already checked against `exit` when written ({@link agreeingWithExit}). */
  outcome: TestOutcome;
};

/** Written before starting Vitest, then replaced by its finished record. */
export type DeployRunStartedRecord = Pick<DeployRunRecord, "schema" | "by" | "runId" | "sha" | "root" | "startedAt" | "atStart"> & {
  state: "started";
};

/**
 * One deploy record as a {@link FullRun}, or why it cannot be read. Unreadable
 * is the caller's to treat as a refusal of the whole partial path — a record
 * that would not parse could be the nearest red.
 */
export function deployFullRun(text: string, id: string, envLocalSha256: string | null): FullRun | { unreadable: string } {
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { unreadable: `${id} is not JSON` };
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return { unreadable: `${id} is not a deploy test record` };
  const outcome = asTestOutcome(v.outcome);
  const atMs = typeof v.at === "string" ? Date.parse(v.at) : Number.NaN;
  const startedMs = typeof v.startedAt === "string" ? Date.parse(v.startedAt) : Number.NaN;
  const tree = (t: unknown): DeployRunTree | null => {
    const o = t as Record<string, unknown> | null;
    return typeof o?.sha === "string" && typeof o.clean === "boolean" && (o.envLocalSha256 === null || typeof o.envLocalSha256 === "string")
      ? { sha: o.sha, clean: o.clean, envLocalSha256: o.envLocalSha256 as string | null }
      : null;
  };
  const atStart = tree(v.atStart);
  const atEnd = tree(v.atEnd);
  if (
    (v.schema !== 2 && v.schema !== TEST_OUTCOME_VERSION) ||
    v.by !== "deploy-gate" ||
    typeof v.runId !== "string" ||
    v.runId === "" ||
    typeof v.root !== "string" || !v.root.startsWith("/") ||
    !Number.isFinite(startedMs) ||
    typeof v.sha !== "string" ||
    !/^[0-9a-f]{40}$/.test(v.sha) ||
    atStart === null
  ) {
    return { unreadable: `${id} is not a deploy test record` };
  }
  const sha = v.sha;
  if (v.state === "started") {
    /* This store is read with the deploy mutex held, so a different deploy
       cannot still be running. Keep interrupted attempts on the timeline;
       a whole run finishing later may supersede them. */
    const why = "the deploy started a full suite but never recorded its finish";
    return { source: "deploy-gate", id: v.runId, sha, atMs: startedMs, outcome: { kind: "unusable", why }, refusal: why };
  }
  if ((v.state !== undefined && v.state !== "finished") || !Number.isFinite(atMs) || startedMs > atMs ||
      (v.exit !== null && (!Number.isInteger(v.exit) || (v.exit as number) < 0)) || outcome === null || atEnd === null) {
    return { unreadable: `${id} is not a finished deploy test record` };
  }
  const refusal =
    v.schema === 2
      ? "its outcome predates the protocol proving completed teardown"
      : atStart.sha !== sha || atEnd.sha !== sha
      ? `its checkout was not on ${sha.slice(0, 8)} at both ends`
      : !atStart.clean || !atEnd.clean
        ? "its checkout was not clean at both ends"
        : atStart.envLocalSha256 !== atEnd.envLocalSha256
          ? ".env.local changed during that run"
          : envLocalSha256 === null
            ? "this checkout has no .env.local to compare the run's with"
            : atEnd.envLocalSha256 !== envLocalSha256
              ? ".env.local has changed since that run read it"
              : outcome.kind !== "unusable" && (v.exit === null || (outcome.kind === "pass") !== (v.exit === 0))
                ? "its outcome disagrees with its recorded exit"
              : null;
  return { source: "deploy-gate", id: v.runId, sha, atMs, outcome, refusal };
}

/**
 * **`--ready`'s candidate: the first commit from the green one on whose notes
 * the `changelog` gate passes.** `path` is the green commit then every later
 * commit on `origin/dev` that contains it, oldest first. The green commit can
 * never carry notes written after it was tested, so without this `--ready`
 * waited for a green run on a commit after the notes, which on 2026-10-08 never
 * came (docs/plans/261008h § What went wrong today).
 */
export function firstCarryingNotes(
  path: readonly string[],
  notesGap: (sha: string) => string | null,
): { kind: "found"; sha: string; after: number } | { kind: "none"; why: string } {
  let first: string | null = null;
  for (const [i, sha] of path.entries()) {
    const gap = notesGap(sha);
    if (gap === null) return { kind: "found", sha, after: i };
    first ??= gap;
  }
  return {
    kind: "none",
    why:
      `no commit from ${path[0]?.slice(0, 8) ?? "?"} to origin/dev carries release notes that cover it` +
      (first ? ` (the green commit: ${first})` : "") +
      " — run npm run changelog:prepare",
  };
}

/**
 * **The newest commit on `origin/dev` whose test gate the store already proves.**
 *
 * `candidates` is every sha the store has a run about, each already judged by
 * {@link testEvidenceFor} and placed against `origin/dev` by the caller. Newest
 * is decided by ancestry, not by when its run finished: `dev` only
 * fast-forwards, so its past tips form one chain, and the one with the most
 * ancestors contains all the others. A run that finished last may well be about
 * an older commit.
 */
export function newestReadyCommit(
  /** Is `a` an ancestor of (or equal to) `b`? null when git could not say. */
  isAncestor: (a: string, b: string) => boolean | null,
  candidates: readonly {
    sha: string;
    evidence: TestEvidence;
    /** Is it `origin/dev` or one of its ancestors? */
    onTrunk: boolean;
    /** `git rev-list --count <sha>`. */
    ancestors: number;
  }[],
): { kind: "chosen"; sha: string; evidence: Extract<TestEvidence, { kind: "reuse" }> } | { kind: "none"; why: string[] } {
  let best: { sha: string; evidence: Extract<TestEvidence, { kind: "reuse" }>; ancestors: number } | null = null;
  for (const c of candidates) {
    if (!c.onTrunk || c.evidence.kind !== "reuse") continue;
    if (best === null || c.ancestors > best.ancestors) best = { sha: c.sha, evidence: c.evidence, ancestors: c.ancestors };
  }
  if (best !== null) {
    /* The count is a shortcut that is only sound along one chain. Runs the
       deploy can reuse are made at fetched dev tips, which form one; but that
       is the loop's habit, not a fact this function has seen, so it is checked
       (GPT Sol on 261007k, P2-6). */
    const chosen = best;
    const stray = candidates.filter(
      (c) => c.onTrunk && c.evidence.kind === "reuse" && c.sha !== chosen.sha && isAncestor(c.sha, chosen.sha) !== true,
    );
    if (stray.length > 0) {
      return {
        kind: "none",
        why: [
          `${chosen.sha.slice(0, 8)} has the most history, but ${stray.map((c) => c.sha.slice(0, 8)).join(", ")} ` +
            "is not inside it, so which green commit is newest cannot be decided — deploy one by hand",
        ],
      };
    }
    return { kind: "chosen", sha: chosen.sha, evidence: chosen.evidence };
  }

  const newestFirst = [...candidates].sort((a, b) => b.ancestors - a.ancestors);
  const why = newestFirst.slice(0, 5).map((c) => {
    const reason = !c.onTrunk ? "not on origin/dev" : c.evidence.kind === "run" ? c.evidence.why : "usable";
    return `${c.sha.slice(0, 8)}: ${reason}`;
  });
  return {
    kind: "none",
    why: why.length > 0 ? why : ["the readiness store has no run about any commit in its retention"],
  };
}

/**
 * The trunk gate under `--ready`, in place of `trunkGap`'s equality.
 *
 * Equality refuses two things: a stale checkout (behind `origin/dev`) and an
 * unpushed commit (ahead of it). Under `--ready` the first is the point — the
 * candidate is chosen from `dev`'s history on purpose — so it is reported, not
 * refused; the second is still refused, because a commit `origin/dev` does not
 * contain was never pushed. Fails closed when `origin/dev` cannot be read,
 * like `trunkGap`.
 */
export function readyTrunkGap(opts: {
  sha: string;
  trunkSha: string | null;
  /** `git merge-base --is-ancestor sha trunkSha`; null when git could not say. */
  isAncestor: boolean | null;
}): string | null {
  const { sha, trunkSha, isAncestor } = opts;
  if (!trunkSha) return "could not read origin/dev — refusing rather than assuming the candidate is on it";
  if (isAncestor === null) return `could not tell whether ${sha.slice(0, 8)} is on origin/dev — refusing`;
  if (!isAncestor) return `${sha.slice(0, 8)} is not on origin/dev (${trunkSha.slice(0, 8)}), so it was never pushed`;
  return null;
}
