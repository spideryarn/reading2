import { fileURLToPath } from "node:url";
import type { InlineConfig } from "vitest/node";
import { defaultExclude, defineConfig } from "vitest/config";

import { TEST_LANES, type TestLane } from "./tests/store-migration-registry.js";
import {
  ADMISSION_POLICY_VERSION,
  decideAdmission,
  markReadinessAdmissionRefusal,
  readMemorySnapshot,
  readReserveBytes,
  READINESS_ADMISSION_TOKEN_ENV,
  resolveParallelWorkers,
} from "./vitest-admission.js";

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
 * What this config asks for, and the one place the machine gets a veto.
 *
 * Two questions, asked in order because they are different questions: *how many
 * workers should one run take here* — the three layers in
 * [`vitest-admission.ts`](./vitest-admission.ts) — and *is there room for a run
 * at all*, from the same module, which exists because the answer to the first
 * turned out to be nearly irrelevant to memory. 87% of a run's peak RSS is
 * spent before its first worker forks, so capping workers bounds forks and not
 * gigabytes;
 * docs/plans/260908b-adaptive-test-resource-limits-so-concurrent-suites-cannot-exhaust-the-box.md
 * has the table. The second question can only ever reduce the first, or refuse.
 *
 * **The number logged here is what the CONFIG asked for, and is deliberately
 * not called the resolved one.** `--maxWorkers` on the command line beats it —
 * that is the escape hatch the cap sits at the root to preserve, and
 * tests/vitest-worker-caps.test.ts pins it — so a line announcing itself as the
 * final worker count would be a lie on exactly the runs somebody is debugging.
 * GPT Sol, 2026-09-08.
 */
function workersForThisRun(): number {
  /* The token exists only to authenticate a refusal back to readiness-run.
     Consume it before Vitest creates workers, so ordinary test output cannot
     learn it and impersonate the config-time decision. */
  const readinessAdmissionToken = process.env[READINESS_ADMISSION_TOKEN_ENV];
  delete process.env[READINESS_ADMISSION_TOKEN_ENV];
  const nominal = resolveParallelWorkers();
  const decision = decideAdmission({
    nominalWorkers: nominal,
    snapshot: readMemorySnapshot(),
    reserveBytes: readReserveBytes(),
  });
  /* A refusal is thrown rather than returned as a small number: the arithmetic
     has said no worker fits, and the failure mode this whole file exists to
     stop is a run that starts anyway and takes postgres down with it. It must
     also not look like a red test — the message says so in as many words. */
  if (decision.kind === "refuse") {
    throw new Error(markReadinessAdmissionRefusal(decision.message, readinessAdmissionToken));
  }
  if (decision.kind === "not-applicable") return nominal;
  if (decision.workers < nominal) {
    const gb = (n: number) => `${(n / 1024 ** 3).toFixed(2)} GB`;
    console.error(
      `[vitest] memory admission: asking for ${decision.workers} of a nominal ${nominal} workers ` +
        `(MemAvailable ${gb(decision.availableBytes)}, reserve ${gb(decision.reserveBytes)}, ` +
        `room for ${decision.capacity}). --maxWorkers still overrides this. ` +
        `Policy v${ADMISSION_POLICY_VERSION}, pid ${process.pid}.`,
    );
  }
  return decision.workers;
}

const PARALLEL_WORKERS = workersForThisRun();

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
