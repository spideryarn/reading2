/**
 * src/web/step-names.ts — every step named as the reader meets it, and the
 * names read from the tables that own them rather than copied
 * (docs/plans/261009u-metadata-ai-processing-named-as-the-modes-are.md).
 */
import { describe, expect, it } from "vitest";
import { MODE_CATALOG } from "../src/mode-catalog.js";
import { STEP_ORDER } from "../src/step-order.js";
import { MODE_LABEL } from "../src/title-text.js";
import { stepName, stepWhat } from "../src/web/step-names.js";
import { DIAGRAM_SUB_MODES, LEARN_SUB_MODES, PEER_REVIEW_SUB_MODES, SUMMARY_SUB_MODES } from "../src/web/sub-modes.js";

describe("stepName and stepWhat", () => {
  it("give every step a name and a line", () => {
    for (const step of STEP_ORDER) {
      expect(stepName(step).trim(), step).not.toBe("");
      expect(stepWhat(step).trim(), step).not.toBe("");
    }
  });

  it("name a sub-mode's step `Mode › Sub`, as the command bar does", () => {
    expect(stepName("tweets")).toBe(`${MODE_LABEL.summary} › ${SUMMARY_SUB_MODES.thread.label}`);
    expect(stepName("quiz")).toBe(`${MODE_LABEL.learn} › ${LEARN_SUB_MODES.quiz.label}`);
    expect(stepName("sketch")).toBe(`${MODE_LABEL.diagram} › ${DIAGRAM_SUB_MODES.sketch.label}`);
    expect(stepName("debate")).toBe(
      `${MODE_LABEL["peer-review"]} › ${PEER_REVIEW_SUB_MODES.reception.label}`,
    );
    expect(stepName("citations")).toBe(
      `${MODE_LABEL["peer-review"]} › ${PEER_REVIEW_SUB_MODES.bibliography.label}`,
    );
    expect(stepWhat("tweets")).toBe(SUMMARY_SUB_MODES.thread.description);
  });

  it("name a mode's step by the mode, with the catalogue's line", () => {
    expect(stepName("glossary")).toBe(MODE_LABEL.glossary);
    expect(stepWhat("faq")).toBe(MODE_CATALOG.faq.description);
  });

  /* The report's own complaint: two different modes' steps read *Writing the
     questions* and *Finding the questions*. No two steps may share a name. */
  it("never gives two steps one name", () => {
    const names = STEP_ORDER.map((step) => stepName(step));
    expect(new Set(names).size).toBe(names.length);
  });

  /* A server newer than this copy can send a step it has never heard of. */
  it("keeps the server's label for a step it does not know, prototype keys included", () => {
    for (const step of ["a-step-from-a-newer-server", "__proto__", "constructor", "toString"]) {
      expect(stepName(step, "Some stage"), step).toBe("Some stage");
      expect(stepWhat(step), step).toBe("");
    }
  });

  it("names the non-mode steps where the reader sees them", () => {
    expect(stepWhat("arc")).toMatch(/Structure.*Marginalia/);
    expect(stepWhat("relations")).toMatch(/Marginalia/);
    expect(stepName("blocks")).toBe("Blocks");
    expect(stepName("simple")).toBe(
      `${MODE_LABEL.summary} › ${SUMMARY_SUB_MODES.brief.label} and ${SUMMARY_SUB_MODES.fuller.label}`,
    );
  });
});
