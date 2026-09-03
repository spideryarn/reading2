import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Deliberately separate from vite.config.ts: that file mounts the /api dev
 * middleware and the React plugin, neither of which a node-side unit test
 * should drag in. Vitest loads this instead — see docs/project/testing.md.
 */
export default defineConfig({
  // Repeated from vite.config.ts on purpose: vitest loads this file INSTEAD of
  // that one, so an alias declared only there is invisible here, and a test
  // importing `@/…` fails to resolve while the dev server is perfectly happy.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/web", import.meta.url)) },
  },
  test: {
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
    /* **Loaded into every test file: a test may not spend money.** It wraps
       `globalThis.fetch` and refuses a request to a provider host before it is
       sent. Not a nicety — two tests in `tests/referee-mirror-route.test.ts`
       made real, paid OpenRouter calls on 2026-08-31 and stayed green, because
       an empty answer and no answer look the same from outside.

       If this line goes away, `tests/no-provider-calls-guard.test.ts` goes red
       twice: once because the wrapper is absent at run time, and once because
       it reads this file and cannot find the path. See
       docs/postmortems/260901g-a-unit-test-that-bought-inference.md. */
    setupFiles: ["./tests/setup/no-provider-calls.ts"],
    /* `.tsx` as well as `.ts`, since 2026-08-27. Until then this was `.ts`
       only, which is why the repo had no component tests: a file that mounts a
       React component wants JSX, and a `.tsx` test was simply never collected —
       it did not fail, it was not found, which is the worst way for a test file
       to be absent. */
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
