/**
 * **The reminder to keep a chat answer brief rides beside the question.**
 *
 * Greg asked for chat, comment and question answers "a little bit briefer"
 * (SPIDERYARN-READING2-6X). Tightening the length rule in `SYSTEM` moved
 * Explain's answers by about 15% and chat's by only 6–7%, short of the measured
 * target, so, as with the provenance line
 * (tests/chat-provenance-line.test.ts), one line points back at the rule from
 * the final user message, below the `cache_control` breakpoint.
 * docs/plans/260930g-briefer-chat-and-explain-answers.md.
 *
 * Chat only: Learn has its own prompt and its own LENGTH section.
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

const LINE =
  "Keep it brief, as WHAT IT MUST NOT DO says: most answers need fewer than 300 words, unless they ask for more.";
const SYSTEM_RULE =
  "Most answers need fewer than 300 words. Go longer when they ask for more, such as a summary.";

describe("the length reminder", () => {
  it("is in the final user message of a chat turn, before the question", () => {
    const text = finalUser(buildConverseMessages(base));
    expect(text).toContain(LINE);
    expect(text.endsWith(base.question)).toBe(true);
  });

  it("points at a section chat's system prompt actually has, holding the rule", () => {
    const sys = system(buildConverseMessages(base)).replace(/\s+/g, " ");
    expect(sys).toContain("WHAT IT MUST NOT DO");
    expect(sys).toContain("One or two short paragraphs is usually right");
    expect(sys).toContain(SYSTEM_RULE);
  });

  it("is on a help turn too", () => {
    expect(finalUser(buildConverseMessages({ ...base, help: true }))).toContain(LINE);
  });

  it("is absent from a Learn turn", () => {
    expect(finalUser(buildConverseMessages({ ...base, kind: "learn" }))).not.toContain(LINE);
  });

  it("is absent from a Candidates turn", () => {
    expect(finalUser(buildConverseMessages({ ...base, kind: "candidates" }))).not.toContain(LINE);
  });

  it("stays beside the current question when the chat has history", () => {
    const history: ChatMessage[] = [
      {
        id: "question-1",
        role: "user",
        text: "Give me the short version.",
        createdAt: "2026-09-30T10:00:00.000Z",
        status: "done",
      },
      {
        id: "answer-1",
        role: "assistant",
        text: "The short version.",
        createdAt: "2026-09-30T10:00:01.000Z",
        status: "done",
      },
    ];
    const messages = buildConverseMessages({
      ...base,
      history,
      question: "Now give me a detailed section-by-section account.",
    });
    const text = finalUser(messages);
    expect(text).toContain(LINE);
    expect(text.endsWith("Now give me a detailed section-by-section account.")).toBe(true);
    expect(JSON.stringify(messages.slice(0, -1))).not.toContain(LINE);
  });

  it("is nowhere above the cache breakpoint", () => {
    const m = buildConverseMessages(base);
    expect(JSON.stringify(m.slice(0, -1))).not.toContain(LINE);
  });
});
