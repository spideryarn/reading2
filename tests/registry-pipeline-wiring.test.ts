/**
 * **The registry enrichers are in the real pipeline steps.** The pure tests
 * inject them directly and the dependency-identity test only proves what a
 * deps object contains; neither fails if `src/pipeline.ts` forgets to call the
 * enricher. These assertions inspect the registered run functions themselves,
 * and also pin the freshness decision: enrichment follows generation rather
 * than entering either prompt or stamp.
 */
import { describe, expect, it } from "vitest";

import { STEPS } from "../src/pipeline.js";

function position(body: string, name: string): number {
  const at = body.indexOf(name);
  expect(at, `${name} is absent from the registered step`).toBeGreaterThanOrEqual(0);
  return at;
}

describe("the Stage 5/6 pipeline wiring", () => {
  it("enriches the Bibliography after generation and before returning the artefact", () => {
    const body = STEPS.bibliography.run.toString();
    expect(position(body, "generateBibliography")).toBeLessThan(position(body, "attachCitationRegistry"));
    expect(position(body, "attachCitationRegistry")).toBeLessThan(position(body, "parts: { bibliography"));
  });

  it("enriches Debate after its searches and before returning the artefact", () => {
    const body = STEPS.reception.run.toString();
    expect(position(body, "generateReception")).toBeLessThan(position(body, "attachReceptionRegistry"));
    expect(position(body, "attachReceptionRegistry")).toBeLessThan(position(body, "parts: { reception"));
  });
});
