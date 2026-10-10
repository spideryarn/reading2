/**
 * `SPIDERYARN_PIPELINE_EFFORT`, read through one checked parser
 * (src/models.ts § `pipelineEffortOverride`).
 *
 * Until 2026-10-04 three places read the variable with an unchecked cast,
 * `process.env.SPIDERYARN_PIPELINE_EFFORT as Effort | undefined`: `effortFor`,
 * src/bibliography.ts and src/skim.ts. A cast checks nothing at run time, so a
 * typo (`hgih`) went to the provider as the effort, and an empty string did
 * too, because `"" ?? fallback` is `""`.
 *
 * It is a developer's knob, set on purpose for one eval run. So a value that
 * is not one of the three **throws** rather than falling back: a run that
 * silently used the default would be a wrong measurement with nothing to say
 * it was one.
 *
 * This file is the helper and `effortFor`. The other two call sites are tested
 * where their stubs are: tests/bibliography.test.ts and tests/skim.test.ts, each
 * for its own fallback.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EFFORTS, STAGE_EFFORT, effortFor, pipelineEffortOverride } from "../src/models.js";

const NAME = "SPIDERYARN_PIPELINE_EFFORT";

let before: string | undefined;
beforeEach(() => {
  before = process.env[NAME];
  delete process.env[NAME];
});
afterEach(() => {
  if (before === undefined) delete process.env[NAME];
  else process.env[NAME] = before;
});

describe("pipelineEffortOverride", () => {
  it("knows the three levels, and only those", () => {
    expect([...EFFORTS]).toEqual(["low", "medium", "high"]);
  });

  it("is undefined when the variable is unset", () => {
    expect(pipelineEffortOverride()).toBeUndefined();
  });

  it("is undefined when the variable is empty, which is how a shell unsets one", () => {
    process.env[NAME] = "";
    expect(pipelineEffortOverride()).toBeUndefined();
  });

  it.each(["low", "medium", "high"] as const)("reads %s", (level) => {
    process.env[NAME] = level;
    expect(pipelineEffortOverride()).toBe(level);
  });

  it.each(["hgih", "HIGH", " high", "max", "0", "undefined"])(
    "throws on %j, naming the variable and the three values",
    (value) => {
      process.env[NAME] = value;
      expect(() => pipelineEffortOverride()).toThrow(NAME);
      expect(() => pipelineEffortOverride()).toThrow(/low, medium or high/);
    },
  );

  it("is read at call time, so an eval can set it around one run", () => {
    process.env[NAME] = "low";
    expect(pipelineEffortOverride()).toBe("low");
    process.env[NAME] = "high";
    expect(pipelineEffortOverride()).toBe("high");
    delete process.env[NAME];
    expect(pipelineEffortOverride()).toBeUndefined();
  });
});

describe("effortFor, the first of the three call sites", () => {
  it("falls back to the stage's own effort when the variable is unset", () => {
    expect(effortFor("arc")).toBe(STAGE_EFFORT.arc);
    expect(effortFor("glossary")).toBe(STAGE_EFFORT.glossary);
  });

  it("falls back to the stage's own effort when the variable is empty", () => {
    /* Red before the parser: `"" ?? STAGE_EFFORT[stage]` is `""`, and that
       went on the wire as the effort. */
    process.env[NAME] = "";
    expect(effortFor("arc")).toBe(STAGE_EFFORT.arc);
    expect(effortFor("glossary")).toBe(STAGE_EFFORT.glossary);
  });

  it.each(["low", "medium", "high"] as const)("lets %s override every stage", (level) => {
    process.env[NAME] = level;
    expect(effortFor("arc")).toBe(level);
    expect(effortFor("glossary")).toBe(level);
  });

  it("throws on a typo instead of sending it to the provider", () => {
    /* Red before the parser: it returned "hgih". */
    process.env[NAME] = "hgih";
    expect(() => effortFor("arc")).toThrow(NAME);
  });
});
