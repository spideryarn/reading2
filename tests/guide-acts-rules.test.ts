/**
 * **Which of a guide answer's buttons may press themselves, and what the
 * guide's prompt says about it** — plan
 * docs/plans/261007p-the-guide-acts-without-a-press-and-opens-every-new-article.md,
 * Item 1.
 *
 * The pure half: `modeActsAlone` (src/acts-alone.ts), the one rule the prompt
 * and the page both read; `answerMayAct` and `actsAlone` (src/web/guide-acts.ts);
 * and the prompt's marking of each mode (src/guide.ts § `modeWordsSection`).
 * The drawn half is tests/guide-acts-chips.test.tsx; the event is
 * tests/guide-acts-controller.test.ts.
 */
import { describe, expect, it } from "vitest";
import { modeActsAlone } from "../src/acts-alone.js";
import { modeWordsSection } from "../src/guide.js";
import type { ChatMessage } from "../src/types.js";
import type { ChatChip } from "../src/web/chat-commands.js";
import type { CommandProposal, ModeTarget } from "../src/web/command-proposal.js";
import { actsAlone, answerMayAct } from "../src/web/guide-acts.js";

describe("modeActsAlone", () => {
  it("lets a mode that makes nothing open itself", () => {
    expect(modeActsAlone("mode:structure", false)).toBe(true);
    expect(modeActsAlone("submode:learn:tutorial", false)).toBe(true);
  });

  it("keeps a mode that generates a press", () => {
    expect(modeActsAlone("mode:glossary", true)).toBe(false);
    expect(modeActsAlone("submode:learn:tutorial", true)).toBe(false);
  });

  it("keeps Search and every one of its sub-modes a press, though they generate nothing", () => {
    expect(modeActsAlone("mode:search", false)).toBe(false);
    expect(modeActsAlone("submode:search:x", false)).toBe(false);
    expect(modeActsAlone("submode:search:thorough", false)).toBe(false);
  });

  it("does not mistake a key that only starts like Search's for Search", () => {
    expect(modeActsAlone("mode:searchlight", false)).toBe(true);
  });
});

describe("answerMayAct", () => {
  const AT = "2026-10-07T09:00:00.000Z";
  const answer = (over: Partial<ChatMessage> = {}): ChatMessage => ({
    id: "spya-ans001",
    role: "assistant",
    text: "I've opened Structure.\n\n[cmd:mode:mode%3Astructure]",
    createdAt: AT,
    status: "done",
    ...over,
  });

  it("lets a finished answer act", () => {
    expect(answerMayAct(answer())).toBe(true);
  });

  it("does not let a stopped, cut-off, unfinished or failed answer act", () => {
    expect(answerMayAct(answer({ stopped: true }))).toBe(false);
    expect(answerMayAct(answer({ truncated: true }))).toBe(false);
    expect(answerMayAct(answer({ status: "pending" }))).toBe(false);
    expect(answerMayAct(answer({ status: "error" }))).toBe(false);
  });

  it("does not let the reader's own question act", () => {
    expect(answerMayAct(answer({ role: "user" }))).toBe(false);
  });
});

describe("actsAlone", () => {
  const target = (key: string, generates: boolean): ModeTarget => ({
    key,
    label: key,
    description: "A mode.",
    generates,
  });
  const chip = (proposal: CommandProposal, t?: ModeTarget): ChatChip => ({
    proposal,
    ...(t === undefined ? {} : { target: t }),
    enabled: true,
  });

  it("acts for a jump to where the article first says some words", () => {
    expect(actsAlone(chip({ id: "jump-first", words: "the method" }))).toBe(true);
  });

  it("acts for a mode that makes nothing and is not Search", () => {
    expect(actsAlone(chip({ id: "mode", key: "mode:structure" }, target("mode:structure", false)))).toBe(true);
  });

  it("does not act for a mode that generates, for Search, or for a mode with no target", () => {
    expect(actsAlone(chip({ id: "mode", key: "mode:glossary" }, target("mode:glossary", true)))).toBe(false);
    expect(actsAlone(chip({ id: "mode", key: "mode:search" }, target("mode:search", false)))).toBe(false);
    expect(actsAlone(chip({ id: "mode", key: "mode:structure" }))).toBe(false);
  });

  it("does not act for anything that looks up, searches, finds, tags or bookmarks", () => {
    const presses: CommandProposal[] = [
      { id: "find", words: "the method" },
      { id: "glossary-open", termId: "spya-k3m9qt" },
      { id: "glossary-ask", term: "qualia" },
      { id: "quick-search", words: "imaging method" },
      { id: "tag-add", tag: "to read" },
      { id: "tag-remove", tag: "to read" },
      { id: "bookmark", blockId: "spya-k3m9qt" },
    ];
    for (const p of presses) expect(actsAlone(chip(p)), p.id).toBe(false);
  });
});

describe("the guide's prompt says which modes open at once", () => {
  const section = modeWordsSection();
  const line = (label: string): string => {
    const found = section.split("\n").find((l) => l.startsWith(`- ${label}: `));
    if (found === undefined) throw new Error(`no line for ${label}`);
    return found;
  };

  it("marks Structure as opening at once", () => {
    expect(line("Structure")).toContain(" Opens at once: [cmd:mode:mode%3Astructure]");
    expect(line("Structure")).not.toContain("Button:");
  });

  it("marks Glossary, which generates, and Search, which writes, as buttons", () => {
    expect(line("Glossary")).toContain(" Button: [cmd:mode:mode%3Aglossary]");
    expect(line("Glossary")).not.toContain("Opens at once:");
    expect(line("Search")).toContain(" Button: [cmd:mode:mode%3Asearch]");
    expect(line("Search")).not.toContain("Opens at once:");
  });

  it("tells the model this conversation is the exception to the button rule", () => {
    expect(section).toContain("In this conversation, unlike the rule above");
  });
});
