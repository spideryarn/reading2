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
    /* `.tsx` as well as `.ts`, since 2026-08-27. Until then this was `.ts`
       only, which is why the repo had no component tests: a file that mounts a
       React component wants JSX, and a `.tsx` test was simply never collected —
       it did not fail, it was not found, which is the worst way for a test file
       to be absent. */
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
