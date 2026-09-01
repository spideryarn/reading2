/**
 * **The switch. A test may not spend money.**
 *
 * Named in `setupFiles` in [`vitest.config.ts`](../../vitest.config.ts), which
 * loads it into every test file before anything else runs. The machinery, the
 * reasoning and the accident behind it are next door in
 * [`provider-guard.ts`](provider-guard.ts).
 *
 * A handful of lines, and they are separate from the machinery on purpose. The first
 * draft of this guard installed itself as an import side effect, and its own
 * "is the guard loaded?" test then passed with `setupFiles` deleted from the
 * config — importing the module to ask the question was what installed the
 * thing being asked about. Nothing but this file calls
 * `installProviderGuard()`, so `providerGuardInstalled()` answers a real
 * question: did the config load me?
 */

import { afterEach, beforeEach } from "vitest";

import {
  assertNoRefusedProviderCalls,
  installProviderGuard,
  noteFetchBeforeTest,
  restoreFetchAfterTest,
} from "./provider-guard.js";

installProviderGuard();

/* Registered here, so they are the first `beforeEach` and the last `afterEach`
   of every file: a test file's own hooks are registered after these, and vitest
   runs `afterEach` in reverse. So a file that unstubs in its own `afterEach` has
   already done so by the time `restoreFetchAfterTest()` looks. */
beforeEach(noteFetchBeforeTest);

/* Restore first, assert second. The assert throws, and a guard that only puts
   itself back when the test passed is a guard that is missing exactly when it
   is needed. */
afterEach(() => {
  restoreFetchAfterTest();
  assertNoRefusedProviderCalls();
});
