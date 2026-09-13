/**
 * **The reminder to mark where each claim came from rides beside the question.**
 *
 * WHERE EACH CLAIM CAME FROM lives in `SYSTEM`, ahead of a whole article and the
 * conversation, and a hand-read of thirty answers written under it found it
 * largely unfollowed: every "?" answer stated facts from memory unmarked, and
 * "My inference" / "unverified" appeared in none of them
 * (docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md
 * § Progress). Recency is the cheapest lever, so one line points back at the
 * section from the final user message — below the `cache_control` breakpoint,
 * where it costs no cache write — and does not restate it, so the rule still
 * has one owner. Fable's recommendation, 2026-09-13.
 *
 * Chat only: Remember has its own prompt and its own idea of what an answer is.
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
  question: "How does this fit the wider debate?",
  anchor: { blockId: "spya-q4w8re" },
};

type Built = ReturnType<typeof buildConverseMessages>;
const finalUser = (m: Built) => String(m.at(-1)?.content ?? "");
const prefix = (m: Built) => JSON.stringify(m.slice(0, 3));

const LINE = "Mark where each claim came from, as WHERE EACH CLAIM CAME FROM says";

describe("the provenance reminder", () => {
  it("is in the final user message of a chat turn", () => {
    expect(finalUser(buildConverseMessages(base))).toContain(LINE);
  });

  it("comes before the question, so the question is still last", () => {
    const text = finalUser(buildConverseMessages(base));
    expect(text.indexOf(LINE)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(LINE)).toBeLessThan(text.indexOf(base.question));
    expect(text.endsWith(base.question)).toBe(true);
  });

  it("names the three marks and the rule for a specific fact", () => {
    const text = finalUser(buildConverseMessages(base));
    expect(text).toContain("a block id for the article");
    expect(text).toContain("The article doesn't say so, but");
    expect(text).toContain("called unverified");
  });

  it("is on a help turn too, beside the addendum and not inside it", () => {
    const text = finalUser(buildConverseMessages({ ...base, help: true }));
    expect(text).toContain(LINE);
    expect(text).toContain('The reader pressed the "?"');
  });

  it("never says search, web, look it up or tool — SYSTEM owns those words", () => {
    /* tests/help-prompt.test.ts checks the whole final message of a help turn
       for these four; this line is in that message, so it must not be the
       thing that breaks it. */
    const text = finalUser(buildConverseMessages({ ...base, help: true })).toLowerCase();
    for (const word of ["search", "web", "look it up", "tool"]) {
      expect(text.includes(word), `the final message mentions "${word}"`).toBe(false);
    }
  });

  it("is absent from a Remember turn", () => {
    expect(finalUser(buildConverseMessages({ ...base, kind: "remember" }))).not.toContain(LINE);
  });

  it("changes nothing above the cache breakpoint", () => {
    const chat = buildConverseMessages(base);
    const help = buildConverseMessages({ ...base, help: true });
    expect(prefix(help)).toBe(prefix(chat));
  });
});
