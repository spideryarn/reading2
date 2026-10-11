/**
 * How a chat box's words arrived — src/web/composer-modality.ts, plan
 * 261011z (report spya-z30x5n). The four outcomes, and the two rules Sol's plan
 * review added: a seeded box is unrecorded (F4), and emptying the box starts
 * afresh (F3).
 */
import { describe, expect, it } from "vitest";

import { afterChange, composerModality, freshProvenance } from "../src/web/composer-modality.js";

const type = (text: string) => (p: ReturnType<typeof freshProvenance>) => afterChange(p, text, "keyboard");
const dictate = (text: string) => (p: ReturnType<typeof freshProvenance>) => afterChange(p, text, "dictation");
const run = (start: string, ...steps: ((p: ReturnType<typeof freshProvenance>) => ReturnType<typeof freshProvenance>)[]) =>
  composerModality(steps.reduce((p, step) => step(p), freshProvenance(start)));

describe("composerModality", () => {
  it("says typed for keyboard alone", () => {
    expect(run("", type("W"), type("Why"))).toBe("typed");
  });

  it("says dictated for a dictation sent untouched", () => {
    expect(run("", dictate("why does he"), dictate("Why does he say so?"))).toBe("dictated");
  });

  it("says mixed for a dictation then edited, and for typing then dictating", () => {
    expect(run("", dictate("Why does he say so?"), type("Why does he say so, really?"))).toBe("mixed");
    expect(run("", type("About this: "), dictate("About this: why?"))).toBe("mixed");
  });

  it("says nothing for a box that began with words in it, whatever follows", () => {
    expect(run("a handed-over quote", type("a handed-over quote!"))).toBeNull();
    expect(run("a restored draft", dictate("a restored draft and more"))).toBeNull();
  });

  it("starts afresh once the box is empty", () => {
    expect(run("", dictate("Why?"), type(""), type("H"), type("How?"))).toBe("typed");
    expect(run("seeded", type(""), dictate("Why?"))).toBe("dictated");
  });

  it("says nothing when nothing was seen to arrive", () => {
    expect(run("")).toBeNull();
  });
});
