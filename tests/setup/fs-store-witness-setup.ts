/**
 * One JSON line per test file — its path, and the filesystem-store sites it
 * reached — appended to `FSW_OUT`. Witness 2 of docs/plans/260903f.
 *
 * Loaded only by `vitest.witness.config.ts`, which
 * [scripts/store-migration-witness.ts](../../scripts/store-migration-witness.ts)
 * runs; `vitest.config.ts` never mentions it and `npm test` never loads it.
 *
 * **A file that writes no line is `unresolved`, not clean.** The line is
 * written in `afterAll`, so a file that fails or skips before its hooks run
 * reports nothing at all — and the script scores that as "did not report"
 * rather than "did not touch". Keeping those two apart is the point of the
 * whole witness.
 */
import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, expect } from "vitest";

import { hits, setPhase } from "./fs-store-witness.js";

const OUT = process.env.FSW_OUT;

beforeAll(() => {
  setPhase("test");
});

afterAll(() => {
  if (!OUT) return;
  const state = expect.getState();
  const testPath = state.testPath ?? "<unknown>";
  appendFileSync(OUT, `${JSON.stringify({ testPath, sites: [...hits].sort() })}\n`, "utf8");
});
