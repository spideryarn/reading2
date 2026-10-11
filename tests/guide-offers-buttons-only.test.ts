/**
 * **The guide's prompt offers every mode as a button, and forbids it to open
 * anything itself** — plan
 * docs/plans/261011m-guide-suggests-a-mode-with-a-button-a-bigger-chat-box-suggestions-centred.md,
 * stage 1. Greg, 2026-10-11, `spya-gae0zv`:
 *
 * > I think instead it should suggest things, with a UI button for them to
 * > press that would take them to that mode, so that they're aware of what's
 * > happening.
 *
 * Until then (plan 261007p) a mode that only moved the reader was marked
 * *Opens at once* and the model was told to say "I've opened it". The page
 * half of the reversal, a finished answer that opens nothing, is
 * tests/guide-suggests-not-opens.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { buildConverseMessages } from "../src/converse.js";
import { modeWordsSection } from "../src/guide.js";
import type { Block, Meta } from "../src/types.js";

const section = modeWordsSection();

const guideSystem = (): string => {
  const block: Block = {
    id: "spya-aaaaaa",
    tag: "p",
    kind: "text",
    text: "A paragraph.",
    words: 2,
    html: "<p>A paragraph.</p>",
    gistable: true,
  };
  const meta = { title: "A piece", byline: "Someone" } as unknown as Meta;
  return String(
    buildConverseMessages({ meta, blocks: [block], history: [], question: "Any suggestions?", kind: "guide" })[0]?.content,
  );
};

describe("the guide's list of modes", () => {
  it("prints every mode token it offers as a Button", () => {
    const tokens = [...section.matchAll(/(\S+:)? ?\[cmd:mode:[^\]]+\]/g)];
    expect(tokens.length, "the list offers some modes").toBeGreaterThan(5);
    for (const [whole, label] of tokens) expect(label, whole).toBe("Button:");
  });

  it("marks nothing as opening at once", () => {
    expect(section).not.toContain("Opens at once");
    expect(guideSystem()).not.toContain("Opens at once");
  });

  it("offers Structure, which only moves the reader, as a button like any other", () => {
    expect(section).toContain("- Structure: ");
    expect(section).toContain(" Button: [cmd:mode:mode%3Astructure]");
  });
});

describe("what the guide is told it may do", () => {
  it("forbids it to open anything itself, and to say it has", () => {
    expect(section).toContain("You may use your article-reading tools to answer.");
    expect(section).toMatch(/you never open a mode,\s+move the reader or run an action you offer in the app/);
    expect(section).toContain("Never say you have opened it or done it");
    expect(section).toContain("say what pressing it will do");
  });

  it("no longer tells it that it may act", () => {
    const system = guideSystem();
    expect(system).not.toContain("some actions you may take");
    expect(system).not.toContain("I've opened");
    expect(system).not.toContain("ALREADY MADE");
  });
});
