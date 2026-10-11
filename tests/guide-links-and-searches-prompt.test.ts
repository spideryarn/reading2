/**
 * **The guide links into the piece without asking which kind of link, and
 * offers searches it can run** — plan
 * docs/plans/261011aa-guide-and-chat-run-in-article-searches-in-place-and-link-the-article-readily.md,
 * on Greg's reports spya-mpg67x and spya-ma72mx.
 *
 * In the thread that prompted it, the spoken guide asked "links to the
 * highlighted passages, or external links?", then read "links within the
 * article" as the article's own hyperlinks and said there were none; the typed
 * one said "I've taken you to the first of the three" and "I can't save
 * searches for you". These pin the sentences that answer each, and that the
 * spoken guide is told it without a token or a tool name, since the voice
 * model has neither (src/live-gpt.ts).
 */
import { describe, expect, it } from "vitest";
import { buildConverseMessages } from "../src/converse.js";
import { SPOKEN_GUIDE, liveInstructions } from "../src/live.js";
import type { Block, Meta } from "../src/types.js";

const system = (kind: "guide" | "chat"): string => {
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
  return String(buildConverseMessages({ meta, blocks: [block], history: [], question: "Links?", kind })[0]?.content);
};

const flat = (text: string) => text.replace(/\s+/g, " ");

describe("the typed guide", () => {
  const guide = flat(system("guide"));

  it("takes a request for links as places in this article, without asking which kind", () => {
    expect(guide).toContain("when they ask for links, or to be shown where something is, they mean places in this article: cite the blocks at once, without asking which kind of link they mean");
    expect(guide).toContain("They mean the article's own hyperlinks only when they say so");
  });

  it("never claims to have moved the reader", () => {
    expect(guide).toContain("Never write that you have taken them somewhere, opened something or jumped to a passage");
  });

  it("offers searches as buttons that run under the answer, and never says it cannot", () => {
    expect(guide).toContain("Pressing it runs that search here, under your answer");
    expect(guide).toContain("never say you cannot search, run or save searches");
    expect(guide).toContain("do not use them instead of the buttons");
  });
});

describe("Chat's buttons", () => {
  it("says a search button lists what it finds under the answer, in Chat as in the guide", () => {
    for (const kind of ["chat", "guide"] as const) {
      const text = flat(system(kind));
      expect(text, kind).toContain("lists them under your answer, as links to each passage");
      expect(text, kind).not.toContain("opens a search showing every place");
    }
  });
});

describe("the spoken guide", () => {
  it("shows passages for links and searches, and names no token, tool or block id", () => {
    const spoken = flat(SPOKEN_GUIDE);
    expect(spoken).toContain("When they ask for links, or to be shown where something is, they mean passages in this article");
    expect(spoken).toContain("Do not ask which kind of link they mean");
    expect(spoken).toContain("use the article search, then show the passages it found");
    expect(spoken).toContain("exception to the general rule above against using a lookup");
    expect(SPOKEN_GUIDE).not.toMatch(/\[cmd:|spya-|show_passage|search_article/);
  });

  it("keeps the no-spoken-ids rule in the composed Realtime prompt", () => {
    const meta = { slug: "piece", title: "A piece", byline: "Someone" } as unknown as Meta;
    const blocks = [
      {
        id: "spya-aaaaaa",
        tag: "p",
        kind: "text",
        text: "A paragraph.",
        words: 2,
        html: "<p>A paragraph.</p>",
        gistable: true,
      },
    ] as Block[];
    const spoken = liveInstructions({ meta, blocks, kind: "guide" });
    expect(spoken).toContain("NEVER SAY A BLOCK ID OUT LOUD");
    expect(spoken).toContain("When they explicitly ask you to search the piece for something");
    expect(spoken).not.toContain("[cmd:");
  });
});
