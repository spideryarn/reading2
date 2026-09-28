/**
 * **The shared plain-words rule reaches the prompt that is actually sent**, for
 * the explaining prompts wired in stage 3 of
 * docs/plans/260926a-plainer-summaries-and-glossary.md.
 *
 * tests/plain-words-coverage.test.ts only asks whether a file mentions
 * `plainWords(` somewhere in its code; that is satisfied by a call whose result
 * goes nowhere. This asks the stronger question for each prompt: does the
 * system text a model receives contain `plainWords(...)`'s output, for the kinds
 * that prompt writes, exactly once — and is the old per-prompt plain-words
 * sentence it replaced gone, so the prompt gives one rule and not two
 * (docs/project/prompting-guide.md § Where it lives).
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { main as changelogMain } from "../scripts/changelog/changelog.js";
import { buildConverseMessages } from "../src/converse.js";
import { buildExplainMessages } from "../src/explain.js";
import { SYSTEM as LINK_SUMMARY_SYSTEM, LINK_SUMMARY_PROMPT_VERSION } from "../src/link-summary.js";
import { LIVE_SYSTEM } from "../src/live.js";
import { plainWords, type PlainKind } from "../src/plain-words.js";
import { QUIZ_MARK_SYSTEM } from "../src/quiz-mark.js";
import { CANDIDATES_SYSTEM } from "../src/referee-candidates-prompt.js";
import { CLAIMS_SYSTEM } from "../src/referee-claims-run.js";
import { criteriaSystemPrompt } from "../src/referee-criteria-run.js";
import { MIRROR_SYSTEM } from "../src/referee-mirror.js";
import { buildSearchMessages } from "../src/search.js";
import type { Block, ChatMessage, Meta } from "../src/types.js";

const meta = { title: "A piece", byline: "Someone" } as unknown as Meta;
const blocks = [{ id: "spya-aaaaaa", text: "Some words.", type: "paragraph" }] as unknown as Block[];

/** A system message's text, whether it was sent as a string or as parts. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p as { text?: string }).text ?? "").join("");
  throw new Error("unexpected message content");
}

const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const chatBase = { meta, blocks, history: [] as ChatMessage[], question: "why?" };

const prompts: { name: string; text: () => string; kinds: PlainKind[]; oldSentence?: string }[] = [
  {
    name: "Explain",
    text: () => textOf(buildExplainMessages(meta, blocks, "spya-aaaaaa", "Some")[0]?.content),
    kinds: ["explain"],
    oldSentence: "Keep the author's own\n  distinctive words",
  },
  {
    name: "chat",
    text: () => textOf(buildConverseMessages({ ...chatBase, kind: "chat" })[0]?.content),
    kinds: ["explain"],
    oldSentence: "Keeps the author's own distinctive words",
  },
  {
    name: "Remember",
    text: () => textOf(buildConverseMessages({ ...chatBase, kind: "remember" })[0]?.content),
    kinds: ["explain"],
    oldSentence: "PLAIN WORDS. Keep the author's vocabulary",
  },
  { name: "quiz mark", text: () => QUIZ_MARK_SYSTEM, kinds: ["explain"], oldSentence: "Plain words too:" },
  {
    name: "search",
    text: () => textOf(buildSearchMessages(meta, blocks, "anything")[0]?.content),
    kinds: ["explain"],
  },
  { name: "link summary", text: () => LINK_SUMMARY_SYSTEM, kinds: ["explain"] },
  {
    name: "live",
    text: () => LIVE_SYSTEM,
    kinds: ["explain", "spoken"],
    oldSentence: "Ordinary words for everything else",
  },
  { name: "referee candidates", text: () => CANDIDATES_SYSTEM, kinds: ["explain"] },
  { name: "referee mirror", text: () => MIRROR_SYSTEM, kinds: ["explain"] },
  { name: "referee criteria", text: () => criteriaSystemPrompt({ kind: "single" }), kinds: ["explain"] },
  { name: "referee claims", text: () => CLAIMS_SYSTEM, kinds: ["explain", "landmark"] },
];

describe("each explaining prompt carries the shared rule, once", () => {
  for (const p of prompts) {
    it(`${p.name}: plainWords(${p.kinds.join(", ")})`, () => {
      const text = p.text();
      expect(occurrences(text, plainWords(...p.kinds))).toBe(1);
      /* One rule, not two: the heading appears once, and the prompt's own
         old plain-words sentence is gone. */
      expect(occurrences(text, "PLAIN WORDS\n")).toBe(1);
      if (p.oldSentence !== undefined) expect(text).not.toContain(p.oldSentence);
    });
  }

  it("the link-summary prompt version moved with its wording", () => {
    expect(LINK_SUMMARY_PROMPT_VERSION).toBe(4);
  });
});

describe("the changelog's copy stage", () => {
  /* copy-prompt.md is a file handed to a model and cannot interpolate
     TypeScript, so copy-inputs writes the rule out beside the inputs and names
     it in its instructions for the operator. */
  it("copy-inputs writes plainWords('explain') beside the inputs and names it", () => {
    const work = mkdtempSync(path.join(tmpdir(), "spya-plain-words-changelog-"));
    writeFileSync(path.join(work, "assigned.json"), "[]\n");
    const said: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      said.push(args.join(" "));
    });
    try {
      changelogMain(["copy-inputs", "--work", work]);
    } finally {
      spy.mockRestore();
    }
    const file = path.join(work, "copy-plain-words.md");
    expect(readFileSync(file, "utf8")).toBe(`${plainWords("explain")}\n`);
    expect(said.join("\n")).toContain(file);
  });
});
