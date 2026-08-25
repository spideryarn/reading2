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
    include: ["tests/**/*.test.ts"],
  },
});
