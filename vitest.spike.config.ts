/**
 * SPIKE (throwaway): the ordinary vitest config plus a setup file that
 * redirects the suite at a private database. Separate so nothing about the real
 * config changes while the question is still open.
 */
import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config.js";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      /* Appended, not replaced: the provider guard in the base config is what
         stops a test buying inference, and dropping it here would be a quiet
         way to reintroduce that. */
      setupFiles: ["./tests/setup/no-provider-calls.ts", "./tests/setup/spike-db.ts"],
    },
  }),
);
