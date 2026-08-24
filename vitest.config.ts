import { defineConfig } from "vitest/config";

/**
 * Deliberately separate from vite.config.ts: that file mounts the /api dev
 * middleware and the React plugin, neither of which a node-side unit test
 * should drag in. Vitest loads this instead — see docs/project/testing.md.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
