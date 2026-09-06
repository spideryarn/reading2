import { readFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { InlineConfig } from "vitest/node";
import { defaultExclude, defineConfig } from "vitest/config";

import { TEST_LANES, type TestLane } from "./tests/store-migration-registry.js";

/**
 * Deliberately separate from vite.config.ts: that file mounts the /api dev
 * middleware and the React plugin, neither of which a node-side unit test
 * should drag in. Vitest loads this instead — see docs/project/testing.md.
 *
 * ## Three projects, because a test suite cannot share a database with a dev server
 *
 * `npm test` was nondeterministically red on the Hetzner box: two runs of an
 * unchanged tree failed 6 and 31 files, and the failing sets were **disjoint**.
 * The cause is not in the code. `claim` takes one global singleton row with
 * `NOWAIT` and refuses the instant anybody else holds it, and on a box where ten
 * worktrees each run a dev server, somebody else usually does.
 * docs/plans/260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md
 * has the measurements, the root cause and the isolation boundary proved rather
 * than argued.
 *
 * So the suite is split into three disjoint projects, and **membership is
 * derived from `TEST_LANES`** rather than written out again here — one manifest,
 * one verdict per file, and a guard in
 * tests/store-migration-registry.test.ts that re-derives the universe from a
 * static scan and fails when a file that opens a Postgres connection is in no
 * lane:
 *
 * | project | what it gets | where it runs |
 * |---|---|---|
 * | `private-postgres` | every file the scan finds, bar the four below, plus the four it cannot see (`LANES_BEYOND_THE_SCAN`, all of them Storage) | a database minted for this run alone, dropped afterwards. **The bucket is shared** — docs/project/testing.md § Storage is not isolated |
 * | `shared-services` | the four bound to a Supabase service that reads `postgres` | the stack's own `postgres`, as before |
 * | `unit` | everything else | nowhere: `DATABASE_URL` **and** `SUPABASE_URL` are **poisoned**, so neither Postgres nor Storage answers |
 *
 * Each has a setup file that says which of those three it is, and asserts it —
 * `tests/setup/private-db.ts`, `tests/setup/shared-db.ts`,
 * `tests/setup/unit-no-database.ts`. None of those assertions is decoration: the
 * redirect that silently does not happen is the failure this whole stage is
 * about, and a suite that reports success having quietly run against the shared
 * database looks exactly like one that worked.
 */
const ALIAS = {
  // Repeated from vite.config.ts on purpose: vitest loads this file INSTEAD of
  // that one, so an alias declared only there is invisible here, and a test
  // importing `@/…` fails to resolve while the dev server is perfectly happy.
  "@": fileURLToPath(new URL("./src/web", import.meta.url)),
};

/** The files one lane owns, straight out of the manifest. */
function filesIn(lane: TestLane): string[] {
  return Object.entries(TEST_LANES)
    .filter(([, l]) => l === lane)
    .map(([file]) => file)
    .sort();
}

const PRIVATE = filesIn("private-postgres");
const SHARED = filesIn("shared-services");

/**
 * A floor, not a count. Empty is what a broken import or a moved `tests/`
 * directory produces, and an empty database lane is a config that runs every
 * Postgres suite in the unit project — where they would fail on the poisoned
 * URL rather than pass, but for a reason nobody could read.
 */
if (PRIVATE.length < 50 || SHARED.length < 3) {
  throw new Error(
    `TEST_LANES yielded ${PRIVATE.length} private and ${SHARED.length} shared files, ` +
      "which is too few to be the real manifest — check the import above.",
  );
}

/**
 * **How many files run at once: half the machine, not all of it.**
 *
 * Vitest's default is `availableParallelism() - 1`, decided by each run in
 * ignorance of every other. That is right for a machine running one suite and
 * wrong for both of ours, where a dozen worktrees each have an agent that runs
 * `npm test` when it suits them. What it costs when they collide, and what a
 * cap costs when they don't, are measured in
 * docs/plans/260906h-cap-vitest-workers-so-one-box-can-hold-ten-suites.md.
 *
 * Three layers, narrowest first — one run, one machine, everywhere:
 *
 *     VITEST_MAX_WORKERS                        "this run is alone, go faster"
 *     ~/.config/spideryarn/vitest-max-workers   "this machine is crowded"
 *     half the cores, and at least 2
 *
 * The middle one is a **file** rather than an environment variable because the
 * variable does not arrive: measured on the box, nothing in the `env` block of
 * `~/.claude/settings.json` reaches a Claude Bash tool call, not even the
 * `CLAUDE_CODE_SCROLL_SPEED` that has been in it since the box was built. A
 * file has no propagation to be wrong about. `infra/hetzner/provision.sh`
 * writes 3 into it; a laptop has none and takes the half.
 *
 * **Why the override is read here and then deleted.** Vitest reads
 * `VITEST_MAX_WORKERS` itself, in `resolveConfig`, **after** the line that
 * turns `fileParallelism: false` into `maxWorkers: 1`, and for every project —
 * so leaving it set lets a knob for *using less of the machine* quietly
 * de-serialise the private-postgres lane below, which is serial because its
 * files share a database and a job-queue singleton. That trades a slow suite
 * for a lying one, and it had already been typed in good faith
 * (260906f ran `VITEST_MAX_WORKERS=4 npm run check`). Deleting it is the only
 * lever a config file has, since everything vitest does with it happens later.
 * `tests/vitest-worker-caps.test.ts` pins vitest's behaviour as well as ours,
 * so a release that fixes the ordering upstream turns red here rather than
 * leaving a defence nobody dares delete.
 */
export const MACHINE_WORKERS_FILE = join(homedir(), ".config", "spideryarn", "vitest-max-workers");

/** Both layers say a worker count the same way, so they are read the same way. */
function parseWorkerCount(raw: string, source: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const workers = Number(raw.trim());
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(
      `${source} must be a whole number of workers, 1 or more; got ${JSON.stringify(raw)}. ` +
        "Remove it to take half of this machine's cores.",
    );
  }
  return workers;
}

/**
 * Exported for `tests/vitest-worker-caps.test.ts`, which has to be able to ask
 * what this machine would do *without* the file this machine happens to have —
 * otherwise the test for the default answer is red on the box and green on the
 * laptop, which is worse than having no test.
 */
export function resolveParallelWorkers(machineFile = MACHINE_WORKERS_FILE): number {
  /* **Consumed once, and not remembered.** Vite evaluates this file again on a
     watch restart, by which time the variable is gone, so `npm run test:watch`
     started with an override falls back to the machine's number after the first
     restart. That is a real wart and it was fixed once, by keeping the value on
     `globalThis` — but a config file cannot tell a restart from a second vitest
     in the same process, so the remembered value then leaked into instances
     that never asked for it (both measured by GPT Sol, 2026-09-06). Both
     mistakes are worth the same: a run that is faster or slower than asked.
     Neither can reach the serial lane, which names its own `maxWorkers: 1`. So
     the simpler wrong thing wins over the more complicated wrong thing, and
     `tests/vitest-worker-caps.test.ts` pins the absence of the leak. */
  const fromEnv = process.env.VITEST_MAX_WORKERS;
  delete process.env.VITEST_MAX_WORKERS;
  const chosen = fromEnv === undefined ? undefined : parseWorkerCount(fromEnv, "VITEST_MAX_WORKERS");
  if (chosen !== undefined) return chosen;

  /* **Only "there is no such file" is silent**, because that is the normal
     case: a laptop has nothing to say. A file that exists and cannot be read —
     wrong permissions, a directory where the file should be, a failing disk —
     is a machine that *did* mean to set a policy and whose policy is not being
     applied, and swallowing that would hand the box back a cap of 8 with
     nothing anywhere to say why. GPT Sol, 2026-09-06. */
  let fromFile: string | undefined;
  try {
    fromFile = readFileSync(machineFile, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`${machineFile} exists but could not be read; fix it or remove it.`, { cause });
    }
    fromFile = undefined;
  }
  const machine = fromFile === undefined ? undefined : parseWorkerCount(fromFile, machineFile);
  if (machine !== undefined) return machine;

  return Math.max(2, Math.floor(availableParallelism() / 2));
}

const PARALLEL_WORKERS = resolveParallelWorkers();

/**
 * What every project shares. Split out so the three differ **only** in the ways
 * they are supposed to: which files, which setup, and whether they are
 * serialised.
 */
const COMMON = {
  environment: "node",
  /* **Vitest's default, written down because something now depends on it.**
     `src/process-state.ts` keeps the job queue's locks on `globalThis` so that
     they survive a dev-server reload, which means they also survive
     `vi.resetModules()` — and with isolation off they would survive from one
     *test file* to the next, so one file's leftover `running` job would count
     against another file's concurrency cap. Isolation per file is what makes
     that impossible; it is on by default and this line is here so that turning
     it off is a decision rather than an accident. GPT Sol, 2026-09-02,
     docs/postmortems/260902c-the-truncation-retry-cost-storm.md. */
  isolate: true,
  /* **Six times vitest's 5s default, because this box is never idle.**
     Ten-plus worktrees share it and each runs its own suite, so "busy" is the
     normal state rather than the unlucky one. The suites that hit the default
     — pdf-chunk-concurrency, pdf-seam-hyphens, block-policy-prompts,
     health-schema, ai-calls-spend-pg — take 5–9s doing real work, parsing a
     PDF or building twelve prompts. They are not slow because anything is
     wrong; they sit within a factor of two of the cap, so they fail whenever
     somebody else is working.

     What that costs is not a re-run. On 2026-09-03 a `npm run check` came back
     with seven failures, six of them these timeouts and one a real regression
     a guard had caught, and the six hid the one for a whole extra pass. A gate
     whose red is usually noise is a gate people stop reading.

     docs/project/testing.md § a test that spawns a process needs its own
     timeout already argues this in the repo's own voice — *"being generous
     costs nothing except when something really is stuck; being tight costs
     whoever is unlucky"* — and thirty-odd files already set 20–60s locally.
     This is that policy applied once instead of one bite at a time.

     **It hides nothing that mattered.** The caution further down that page —
     *"do not raise a timeout to make it go away"* — is about `insertWhenSlotFree`
     exhausting a 40 × 500ms budget at ~20,500ms, which still fails on its own
     assertion under this cap. A per-file timeout stays the right answer for
     anything genuinely long; this only moves the floor.
     docs/plans/260903d-improve-the-codebase-second-sweep.md § Deferred, item 5. */
  testTimeout: 30_000,
  hookTimeout: 30_000,
} satisfies InlineConfig;

/**
 * **Loaded into every test file: a test may not spend money.** It wraps
 * `globalThis.fetch` and refuses a request to a provider host before it is
 * sent. Not a nicety — two tests in `tests/referee-mirror-route.test.ts`
 * made real, paid OpenRouter calls on 2026-08-31 and stayed green, because
 * an empty answer and no answer look the same from outside.
 *
 * If this line goes away, `tests/no-provider-calls-guard.test.ts` goes red
 * twice: once because the wrapper is absent at run time, and once because
 * it reads this file and cannot find the path. See
 * docs/postmortems/260901g-a-unit-test-that-bought-inference.md.
 *
 * **First in every project's list**, and the lane setup after it: a lane setup
 * connects to Postgres, and doing that before the guard is installed would leave
 * one window per test file in which nothing is watching `fetch`.
 */
const NO_PROVIDER_CALLS = "./tests/setup/no-provider-calls.ts";

export default defineConfig({
  resolve: { alias: ALIAS },
  test: {
    /* **At the root, not on each project**, and that is not a tidiness
       preference. Vitest prefers a *project's* `maxWorkers` over the global one,
       so a cap written into the shared block below would silently beat an
       explicit `vitest --maxWorkers=8` on the command line — the ordinary
       escape hatch, quietly doing nothing. From here the two parallel lanes
       fall back to this value and a CLI flag still wins. GPT Sol, 2026-09-06.

       The private lane names its own `maxWorkers: 1` and so is unaffected by
       either, which is the point of it. */
    maxWorkers: PARALLEL_WORKERS,
    projects: [
      {
        resolve: { alias: ALIAS },
        test: {
          ...COMMON,
          name: "unit",
          /* `.tsx` as well as `.ts`, since 2026-08-27. Until then this was `.ts`
             only, which is why the repo had no component tests: a file that
             mounts a React component wants JSX, and a `.tsx` test was simply
             never collected — it did not fail, it was not found, which is the
             worst way for a test file to be absent. */
          include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
          /* The two database lanes, subtracted. `defaultExclude` is spread back
             in because naming `exclude` at all replaces vitest's own list, and
             dropping it would collect `node_modules` and `dist`. */
          exclude: [...defaultExclude, ...PRIVATE, ...SHARED],
          setupFiles: [NO_PROVIDER_CALLS, "./tests/setup/unit-no-database.ts"],
        },
      },
      {
        resolve: { alias: ALIAS },
        test: {
          ...COMMON,
          name: "private-postgres",
          include: PRIVATE,
          /* One database for the whole run: minted, seeded, leased and dropped
             once, in vitest's own process. */
          globalSetup: ["./tests/setup/private-db-global.ts"],
          setupFiles: [NO_PROVIDER_CALLS, "./tests/setup/private-db.ts"],
          /* **Serialised, on purpose, for v1.** Per-run isolation removes the
             dev servers and the peers; it does not remove this run from itself,
             and several of these suites drive the same global job-queue
             singleton. Slower is acceptable, reproducible is the point —
             260903e § Stage D. Per-worker databases are its stage G, and are a
             wall-clock optimisation rather than a correctness one.

             `fileParallelism: false` is what serialises the files; `maxWorkers`
             follows it rather than leading, because vitest overrides the latter
             from the former and stating both is how a reader learns that. It
             also overrides COMMON's cap, which this lane must not take.

             **Neither line survives `VITEST_MAX_WORKERS` in the environment**,
             which is why resolveParallelWorkers() above removes it before
             vitest can read it. */
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
      {
        resolve: { alias: ALIAS },
        test: {
          ...COMMON,
          name: "shared-services",
          include: SHARED,
          setupFiles: [NO_PROVIDER_CALLS, "./tests/setup/shared-db.ts"],
        },
      },
    ],
  },
});
