/**
 * **Referee's Promises job under the name it had until 2026-10-11** —
 * `referee-claims`, when the sub-mode was called Claims. `ai_calls` is append
 * only, so every row written before the rename keeps the old word for ever;
 * the three readers that name a ledger row (`costCategoryOf`, `taskOf`, the
 * article's cost view) must read it as `referee-promises`, through
 * `RETIRED_JOBS` (src/step-order.ts). Plan
 * docs/plans/261011g-referee-claims-become-promises-and-starter-criteria-wait-for-the-referee-own.md
 * (GPT Sol's F5 on it); tests/reception-old-names.test.ts § the ledger's old
 * names is the precedent.
 */
import { describe, expect, it } from "vitest";
import { costCategoryOf } from "../src/cost-categories.js";
import { taskOf } from "../src/cost-cube.js";
import { currentLedgerName, currentStepName } from "../src/step-order.js";
import { lineName } from "../src/web/ArticleCost.js";

describe("an ai_calls row written as `referee-claims`", () => {
  it("is called `referee-promises` now, and is a job rename rather than a step's", () => {
    expect(currentLedgerName("referee-claims")).toBe("referee-promises");
    expect(currentStepName("referee-claims")).toBe("referee-claims");
  });

  it("is classified as the new job is", () => {
    const now = costCategoryOf({ scopeKind: "request", job: "referee-promises", stepName: null });
    expect(now).toBe("interactive request work");
    expect(costCategoryOf({ scopeKind: "request", job: "referee-claims", stepName: null })).toBe(now);
  });

  it("is named by the new word in the cost cube and the article's cost view", () => {
    expect(taskOf({ job: "referee-claims", stepName: null })).toBe("referee-promises");
    expect(lineName({ job: "referee-claims", stepName: null } as never)).toBe("referee-promises");
  });
});
