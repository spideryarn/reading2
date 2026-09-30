/**
 * **The reminder to keep a chat answer brief rides beside the question.**
 *
 * Greg asked for chat, comment and question answers "a little bit briefer"
 * (SPIDERYARN-READING2-6X). Tightening the length rule in `SYSTEM` moved
 * Explain's answers by about 15% and chat's by no more than two runs of the old
 * prompt differ, so, as with the provenance line
 * (tests/chat-provenance-line.test.ts), one line points back at the rule from
 * the final user message, below the `cache_control` breakpoint.
 * docs/plans/260930g-briefer-chat-and-explain-answers.md.
 *
 * Chat only: Remember has its own prompt and its own LENGTH section.
 */
import { describe, expect, it } from "vitest";
import { buildConverseMessages } from "../src/converse.js";
import type { Block, ChatMessage, Meta } from "../src/types.js";

const block = (id: string, text: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

const blocks: Block[] = [
  block("spya-q4w8re", "The measurement was real; the inference was not."),
  block("spya-z2x6cv", "Phrenology was a science of bumps, and it was wrong."),
];

const meta = { title: "A piece", byline: "Somebody" } as unknown as Meta;

const base = {
  meta,
  blocks,
  history: [] as ChatMessage[],
  question: "What does this mean?",
  anchor: { blockId: "spya-q4w8re" },
};

type Built = ReturnType<typeof buildConverseMessages>;
const finalUser = (m: Built) => String(m.at(-1)?.content ?? "");
const system = (m: Built) => String(m[0]?.content ?? "");

const LINE = "Keep it brief, as WHAT IT MUST NOT DO says";

describe("the length reminder", () => {
  it("is in the final user message of a chat turn, before the question", () => {
    const text = finalUser(buildConverseMessages(base));
    expect(text).toContain(LINE);
    expect(text.endsWith(base.question)).toBe(true);
  });

  it("points at a section chat's system prompt actually has, holding the rule", () => {
    const sys = system(buildConverseMessages(base));
    expect(sys).toContain("WHAT IT MUST NOT DO");
    expect(sys).toContain("One or two short paragraphs is usually right");
  });

  it("is on a help turn too", () => {
    expect(finalUser(buildConverseMessages({ ...base, help: true }))).toContain(LINE);
  });

  it("is absent from a Remember turn", () => {
    expect(finalUser(buildConverseMessages({ ...base, kind: "remember" }))).not.toContain(LINE);
  });

  it("is nowhere above the cache breakpoint", () => {
    const m = buildConverseMessages(base);
    expect(JSON.stringify(m.slice(0, -1))).not.toContain(LINE);
  });
});
