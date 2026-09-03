/**
 * Run everything that can be checked without a human, in one command.
 *
 *   npm run check
 *   npm run check -- --fast     # skip the client build (the slow one)
 *   npm run check -- --offline  # no database needed, and NOT the real gate
 *
 * The point of this file is the **gate/advisory split**, which is the only
 * interesting decision in it.
 *
 * A check that always fails is a check nobody runs. This repo's lint baseline
 * is deliberately not clean (docs/project/linting.md), and Knip currently
 * reports real findings that are queued rather than fixed. If `npm run check`
 * exited non-zero because of those, everyone would learn to ignore its exit
 * code, and the day a *test* broke it would be ignored too. So:
 *
 *   - a GATE fails the command. It is green today, and a failure means
 *     something is newly wrong.
 *   - an ADVISORY prints its findings and does not fail the command. It is a
 *     to-do list, not a verdict.
 *
 * A check earns promotion from advisory to gate on the day its findings reach
 * zero — not before. Promoting one with a known backlog just re-teaches
 * everyone to ignore the exit code. See docs/project/static-analysis.md.
 *
 * ## The test gate runs under `REQUIRE_POSTGRES=1`
 *
 * Seventy-odd test files turn themselves into `describe.skip` when Postgres is
 * unreachable, so `npm test` is green having run none of them. This is the
 * command whose green result gets quoted as evidence, which is exactly the run
 * that flag exists for: a suite that cannot reach the database registers one
 * failing test instead of skipping. See docs/project/testing.md § When a skip
 * is not acceptable.
 *
 * `--offline` drops the flag, so the rest is still usable on a machine with no
 * Docker. It says so in the summary — a run that let the database suites skip
 * must not read like a run that proved them.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAST = process.argv.includes("--fast");
const OFFLINE = process.argv.includes("--offline");

type Step = {
  name: string;
  /** Fails `npm run check` when non-zero. */
  gate: boolean;
  argv: string[];
  /** Added to the environment of this step only. */
  env?: Record<string, string>;
  /** Why it is advisory rather than a gate, printed when it has findings. */
  note?: string;
  /**
   * How many findings this step reported, for the steps whose exit code does
   * not say. Both of the ones that need this exit 0 while holding findings —
   * Biome because `info` is not a failure, jscpd because it only fails above a
   * `--threshold` we do not set — so without a counter the summary would print
   * "clean" over a list of real findings. Which is the bug this repo keeps
   * writing down: docs/reusable/silent-success.md.
   */
  count?: (output: string) => number;
};

const countMatches = (re: RegExp) => (out: string) => out.match(re)?.length ?? 0;

const STEPS: Step[] = [
  // ---- gates: green today, so a failure is news --------------------------
  {
    name: "typecheck",
    gate: true,
    argv: ["run", "--silent", "typecheck"],
  },
  {
    /**
     * Typechecking does not prove Vite can resolve, bundle and parse the CSS.
     * Those failures only ever showed up in a deploy before this was here.
     *
     * **Above the test gate, and that ordering is load-bearing.**
     * `tests/pdf-bundle-trace.test.ts` inspects `api-dist/vercel.js` and fails
     * — deliberately loudly rather than skipping, which is the right call —
     * when it is not there. With the test gate above this one, `npm run check`
     * was red on a clean checkout for everybody who had not happened to run the
     * API build by hand. That is the exact failure this file's header sets out
     * to avoid: a check that always fails is a check nobody runs.
     *
     * `npm run build` is both passes as of 2026-09-03 (`build:client` then
     * `build:api`, the same recipe `vercel.json` runs), so running it here is
     * all this needs. The API pass costs about 400 ms.
     *
     * **`--fast` narrows this step to `build:api` rather than skipping it** —
     * see the loop below for why.
     */
    name: "build",
    gate: true,
    argv: ["run", "--silent", "build"],
  },
  {
    // Under REQUIRE_POSTGRES=1 unless --offline — see the header. Without it a
    // green tick here covers a quarter of the suite not having run.
    //
    // Below `build`, for the reason written on it.
    name: "test",
    gate: true,
    argv: ["run", "--silent", "test"],
    ...(OFFLINE ? {} : { env: { REQUIRE_POSTGRES: "1" } }),
  },
  {
    // Import cycles. Zero of them today, across four independent tools, so
    // this gates from day one. Biome parses with its own parser rather than
    // tsc, which is why it works at all under TypeScript 7.
    name: "cycles",
    gate: true,
    argv: ["run", "--silent", "cycles"],
  },
  {
    /**
     * **A forked snapshot chain — two worktrees generating from one parent.**
     *
     * `drizzle-kit check` is the only thing that reads `drizzle/meta/*` as a
     * linked list. It was already run by `scripts/deploy.ts`, and by nothing
     * else, so a fork survived every branch-level check and surfaced at the
     * deploy — which is late, because the fork's real damage is to the *next*
     * `drizzle-kit generate`, which refuses on it and **exits 0 having written
     * nothing**. Verified 2026-09-02 against a copy of `drizzle/` with a second
     * snapshot claiming `0051`'s parent: `check` exits 1 and names both files,
     * `generate` prints the same error and exits 0.
     *
     * Gates from day one because it is green on this tree today, and it needs
     * no database — the config carries no `dbCredentials` (drizzle.config.ts),
     * so this stays offline, as every step here but the test gate does. About
     * 2 s.
     *
     * **It does not cover holes.** It rejects malformed and out-of-date
     * snapshots, and groups the rest by `prevId` to find a fork — so it is
     * green with `0003` and `0029` missing and with the `0021 → 0022` break.
     * Those are `snapshotProblems` in scripts/migration-snapshots.ts, run by
     * the test gate above. See
     * docs/plans/260902c-concurrent-migrations-across-worktrees.md.
     */
    name: "chain",
    gate: true,
    argv: ["run", "--silent", "db:chain"],
  },

  {
    /**
     * **Does the repository compile — as opposed to your copy of it?**
     *
     * `typecheck` above reads the working tree; the build reads what is in git,
     * and they differ by exactly the files you have not committed. So a lane
     * can be green here while `HEAD` does not compile, which had happened three
     * times before this existed: 2026-08-28 (16 errors across four files),
     * `113ce17` the day after, to the person who had just written that up, and
     * 2026-08-31, when `src/blocks.ts` sat in `HEAD` importing an untracked
     * `src/reserved.ts` while a dozen sessions all typechecked clean.
     *
     * **A gate since 2026-09-03**, on this file's own rule and its own written
     * promise: it landed as an advisory because `HEAD` had five errors that
     * day, with the note that *"the day `npm run typecheck:committed` is green,
     * `gate: false` becomes `gate: true` and this paragraph goes."* It was green
     * that day and nobody had flipped it — found by the sweep in
     * docs/plans/260903a-improve-the-codebase-sweep.md, which is the argument
     * for writing the exit condition down rather than the argument against.
     *
     * If this ever goes red, the fix is somebody's untracked file, not this
     * check: run `npm run typecheck:committed` and it names the missing import.
     */
    name: "committed",
    gate: true,
    argv: ["run", "--silent", "typecheck:committed"],
  },

  // ---- advisories: real findings, deliberately not blocking --------------
  {
    name: "lint",
    gate: false,
    argv: ["run", "--silent", "lint"],
    note: "the lint baseline is not clean on purpose — docs/project/linting.md",
  },
  {
    name: "knip",
    gate: false,
    argv: ["run", "--silent", "knip"],
    note: "unused files/exports/deps are queued, not fixed — promote to a gate when this reaches zero",
  },
  {
    name: "complexity",
    gate: false,
    argv: ["run", "--silent", "complexity"],
    note: "a high score means 'go and look', never 'this is wrong'",
    count: countMatches(/noExcessiveCognitiveComplexity/g),
  },
  {
    name: "dupes",
    gate: false,
    argv: ["run", "--silent", "dupes"],
    note: "some duplication is honest; read before deduplicating",
    count: countMatches(/Clone found/g),
  },
];

const results: { step: Step; code: number; findings?: number }[] = [];

for (const step of STEPS) {
  /**
   * **`--fast` drops the client build, not the API one**, and the difference is
   * the whole reason this is not a `continue`.
   *
   * The client build is the slow half; `build:api` is about 400 ms. But the
   * test gate below reads `api-dist/vercel.js`
   * (tests/pdf-bundle-trace.test.ts), so skipping the build outright made
   * `--fast` permanently red — a mode nobody can use is the same bug as a gate
   * nobody can pass, one flag along.
   *
   * `build:api` compiles `dist/index.html` into the function, so on a tree that
   * has never had a client build it fails — loudly, naming the fix, from
   * scripts/client-shell.ts: *"Run `npm run build` before the API build."* That
   * is the right answer for `--fast` on a clean checkout: it is a shortcut for
   * a tree you have already built once, and it says so instead of failing
   * somewhere else.
   */
  const argv = FAST && step.name === "build" ? ["run", "--silent", "build:api"] : step.argv;
  const fast = argv !== step.argv ? " (--fast: API build only)" : "";

  const requiring = step.env?.REQUIRE_POSTGRES === "1" ? " REQUIRE_POSTGRES=1" : "";
  console.log(`\n── ${step.name} ${step.gate ? "(gate)" : "(advisory)"}${requiring}${fast}`);

  const env = { ...process.env, ...step.env };

  if (!step.count) {
    const run = spawnSync("npm", argv, { cwd: ROOT, stdio: "inherit", env });
    // A signal (or a missing binary) leaves status null. Treat that as a
    // failure rather than letting `null` fall through as a falsy success.
    results.push({ step, code: run.status ?? 1 });
    continue;
  }

  // Counted steps have to be captured to be counted, so echo the output
  // ourselves rather than inheriting the stream.
  const run = spawnSync("npm", argv, { cwd: ROOT, encoding: "utf8", env });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  process.stdout.write(output);
  results.push({ step, code: run.status ?? 1, findings: step.count(output) });
}

console.log(`\n${"=".repeat(60)}\nsummary\n${"=".repeat(60)}`);

/**
 * Did this step have nothing to say?
 *
 * A counted step's exit code does not tell you how many findings it had — but
 * it still tells you whether the tool **ran**, and those are different
 * questions. Reading the count alone meant a Biome or jscpd that crashed before
 * printing anything scored zero findings and was reported as `✓ clean`: a tool
 * that did not run, indistinguishable from a tool that found nothing. That is
 * the bug this script's own header is about, committed inside the script that
 * exists to catch it.
 */
function verdict(r: { step: Step; code: number; findings?: number }): "clean" | "findings" | "broke" {
  if (r.findings !== undefined && r.code !== 0) return "broke";
  if (r.findings !== undefined) return r.findings === 0 ? "clean" : "findings";
  return r.code === 0 ? "clean" : "findings";
}

let gateFailed = false;
for (const r of results) {
  const { step, findings } = r;
  const v = verdict(r);
  if (v !== "clean" && step.gate) gateFailed = true;
  const mark = v === "clean" ? "✓" : step.gate ? "✗" : "!";
  const label =
    v === "clean"
      ? "clean"
      : v === "broke"
        ? `DID NOT RUN (exit ${r.code})`
        : step.gate
          ? "FAILED"
          : findings === undefined
            ? "has findings"
            : `${findings} finding(s)`;
  console.log(`  ${mark} ${step.name.padEnd(12)} ${label}`);
  if (v === "broke") {
    console.log("      the tool itself failed — its count above is not a result");
  } else if (v === "findings" && !step.gate && step.note) {
    console.log(`      ${step.note}`);
  }
}

const noisy = results.filter((r) => verdict(r) !== "clean");

/* Said in both directions and last, so it cannot be read past: the difference
   between a run that proved the database suites and one that let them skip is
   the whole reason the flag exists. */
if (OFFLINE) {
  console.log(
    "\n--offline: the test gate ran WITHOUT REQUIRE_POSTGRES=1, so every suite that\n" +
      "needs Postgres was free to skip. This is NOT the real gate. Run `npm run check`\n" +
      "with a database up before quoting this result as evidence.",
  );
}

if (gateFailed) {
  console.error("\nA gate failed. That means something is newly wrong.");
} else {
  console.log(OFFLINE ? "\nAll gates green, minus the database suites." : "\nAll gates green.");
  if (noisy.length > 0) {
    console.log(
      `${noisy.length} advisory check(s) have findings above — a to-do list, not a verdict.`,
    );
  }
}

process.exit(gateFailed ? 1 : 0);
