/**
 * **The switch. A test may not spend money.**
 *
 * Named in `setupFiles` in [`vitest.config.ts`](../../vitest.config.ts), which
 * loads it into every test file before anything else runs. The machinery, the
 * reasoning and the accident behind it are next door in
 * [`provider-guard.ts`](provider-guard.ts).
 *
 * Four lines, and they are separate from the machinery on purpose. The first
 * draft of this guard installed itself as an import side effect, and its own
 * "is the guard loaded?" test then passed with `setupFiles` deleted from the
 * config — importing the module to ask the question was what installed the
 * thing being asked about. Nothing but this file calls
 * `installProviderGuard()`, so `providerGuardInstalled()` answers a real
 * question: did the config load me?
 */

import { afterEach } from "vitest";

import { assertNoRefusedProviderCalls, installProviderGuard } from "./provider-guard.js";

installProviderGuard();

afterEach(assertNoRefusedProviderCalls);
