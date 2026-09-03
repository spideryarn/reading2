/**
 * TEMPORARY SCAFFOLDING — witness 2 of docs/plans/260903f, stage A.
 * Delete before anything is committed. Not referenced from vitest.config.ts;
 * it is loaded only by the throwaway --config used to take the measurement.
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
