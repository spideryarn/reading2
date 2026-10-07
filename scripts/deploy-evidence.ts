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
  if (record.check !== "check") {
    return {
      kind: "run",
      why:
        `the newest pass for test is a \`${record.check}\` run, not a full \`npm run check\` — ` +
        "only the check runs the builds the suite reads, in the order the deploy does",
    };
  }
  if (record.cwd !== runnerCwd) {
    return {
      kind: "run",
      why:
        `the newest pass for test ran in ${record.cwd}, not in the readiness runner (${runnerCwd}) — ` +
        "another checkout's .env.local, node_modules and corpus are whatever was left there",
    };
  }
  /* **The loop's own statement that it prepared this checkout at this sha.**
     The directory alone is not that: a record from before the corpus refresh
     and the linked `.env.local`, or a wrapper somebody ran by hand in the
     runner, has the right cwd and none of the preparation (GPT Sol, P1-1). */
  const prep = record.preparation ?? null;
  if (prep === null) {
    return {
      kind: "run",
      why: "the passing run carries no preparation stamp from the readiness loop (a hand run, or one from before 2026-10-07)",
    };
  }
  if (prep.version !== PREPARATION_VERSION) {
    return { kind: "run", why: `the passing run was prepared the version-${prep.version} way, not version ${PREPARATION_VERSION}` };
  }
  if (prep.envLocalVerified !== true) {
    return { kind: "run", why: "the wrapper did not verify the prepared .env.local at both ends of this run" };
  }
  if (prep.sha !== sha) {
    return { kind: "run", why: `the passing run's preparation is about ${prep.sha.slice(0, 8)}, not this commit` };
  }
  if (envLocalSha256 === null) return { kind: "run", why: "this checkout has no .env.local to compare the run's with" };
  if (prep.envLocalSha256 !== envLocalSha256) {
    return { kind: "run", why: ".env.local has changed since the passing run read it" };
  }

  /* **Every step the deploy's own gate runs before its tests, clean in this
     run's table.** `check.ts` carries on past a failed build, so a clean test
     row can sit on top of the previous commit's `api-dist/` (GPT Sol, P1-2);
     and the verdict reads a missing row as a pass, which is right for the tab
     and wrong here. A row missing is a refusal. */
  const rows = record.counts.kind === "check" ? record.counts.steps : [];
  for (const step of ["typecheck", ...SUITE_BUILDS, "test"]) {
    const found = rows.filter((r) => r.name === step);
    if (found.length === 0) return { kind: "run", why: `the passing run's summary has no \`${step}\` row` };
    const notClean = found.find((r) => r.verdict !== "clean");
    if (notClean !== undefined) return { kind: "run", why: `\`${step}\` was ${notClean.verdict} in the passing run` };
  }

  const atMs = Date.parse(record.at);
  if (!Number.isFinite(atMs)) return { kind: "run", why: `the run's finish time '${record.at}' does not parse` };
  if (atMs > nowMs) {
    return { kind: "run", why: `the run says it finished at ${record.at}, which is in the future on this clock` };
  }
  const age = nowMs - atMs;
  if (age > TEST_EVIDENCE_MAX_AGE_MS) {
    return {
      kind: "run",
      why:
        `the passing run finished ${hoursAgo(age)}, older than the ` +
        `${TEST_EVIDENCE_MAX_AGE_MS / 3_600_000}h a reused test gate may be`,
    };
  }

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
