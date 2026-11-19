import { describe, expect, it } from "vitest";

import { ARMS, assertArmRunnable, HAIKU } from "../evals/citations-recall/run.js";
import { checkedNotes, workLines } from "../evals/citations-recall/notes-pass.js";

const CURRENT = {
  promptVersion: "citations/8",
  model: HAIKU,
  effort: "high" as const,
};

describe("the citations-recall run's arm guards", () => {
  it("accepts the production arm only when its model and effort are production's", () => {
    expect(() => assertArmRunnable("P", ARMS.P!, CURRENT)).not.toThrow();
    expect(() => assertArmRunnable("P", ARMS.P!, { ...CURRENT, model: "another/model" })).toThrow(/model|production sends/i);
    expect(() => assertArmRunnable("P", ARMS.P!, { ...CURRENT, effort: "low" })).toThrow(/effort|production sends/i);
  });

  it("refuses every citations/7 arm after production's prompt changes", () => {
    for (const [name, arm] of Object.entries(ARMS).filter(([, arm]) => arm.prompt !== "production" && arm.prompt !== "notes1")) {
      expect(() => assertArmRunnable(name, arm, CURRENT), name).toThrow(/measured against citations\/7/);
      expect(() => assertArmRunnable(name, arm, { ...CURRENT, promptVersion: "citations/7" }), name).not.toThrow();
    }
  });

  it("pins the N1 notes arm to the production prompt it modified", () => {
    expect(() => assertArmRunnable("N1", ARMS.N1!, CURRENT)).not.toThrow();
    expect(() => assertArmRunnable("N1", ARMS.N1!, { ...CURRENT, promptVersion: "citations/9" })).toThrow(
      /measured against citations\/8/,
    );
  });
});

describe("the notes-only pass's joins", () => {
  it("accepts exactly one valid note for every id, in any order", () => {
    expect(checkedNotes(["w1", "w2"], { notes: [
      { id: "w2", why: "Second", relevance: 0.2 },
      { id: "w1", why: "First", relevance: 0.1 },
    ] })?.size).toBe(2);
    expect(checkedNotes(["w1", "w2"], { notes: [
      { id: "w1", why: "First", relevance: 0.1 },
      { id: "w1", why: "Again", relevance: 0.2 },
    ] })).toBeNull();
    expect(checkedNotes(["w1"], { notes: [{ id: "w2", why: "Other", relevance: 0.1 }] })).toBeNull();
  });

  it("uses resolved body passages instead of appending the model's fallback place", () => {
    const blocks = new Map([
      ["body", { id: "body", text: "The body citation." }],
      ["model", { id: "model", text: "The model's own place." }],
    ]) as unknown as Parameters<typeof workLines>[2];
    const lines = workLines(
      "w1",
      { title: "Work", why: "Old", relevance: 0.1, mentions: [{ block: "model", quote: "" }] },
      blocks,
      ["body"],
    );
    expect(lines).toContain("The body citation.");
    expect(lines).not.toContain("The model's own place.");
  });
});
