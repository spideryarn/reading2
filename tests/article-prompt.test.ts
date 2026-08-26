/**
 * **The cached prefix has to be the same bytes, and nothing here can prove that
 * it is cached — only that it is the same.**
 *
 * That split is the point of this file. Prompt caching matches a byte-exact
 * prefix, so the whole feature rests on one property: the article part of a
 * request does not change when the thing being asked about changes. That
 * property is pure, so it is testable here, with no network and no model.
 *
 * Whether the provider then actually caches it is *not* testable here, and
 * pretending otherwise would be the exact mistake this feature is prone to. See
 * `evals/prompt-caching.ts` for the half that costs money, and
 * docs/reusable/silent-success.md for why both halves are needed: a broken
 * cache returns a correct answer, raises no error, and only shows up as a
 * bigger bill.
 *
 * The regression these tests exist to catch by name is `←READER IS HERE`. It
 * used to sit *inside* the article body in src/explain.ts and src/converse.ts,
 * which meant explain never once hit a cache and chat missed whenever the
 * reader scrolled. It is an easy thing to put back, because putting it back
 * looks like helping the model.
 */
import { describe, expect, it } from "vitest";
import {
  CACHE_FLOOR_TOKENS,
  articleText,
  articleWithIds,
  cachedText,
  estimateTokens,
  readerPositionLine,
  underCacheFloor,
} from "../src/article-prompt.js";
import { buildSearchMessages } from "../src/search.js";
import { buildExplainMessages } from "../src/explain.js";
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
  block("spya-aaaaaa", "The first paragraph says one thing."),
  block("spya-bbbbbb", "The second paragraph says another."),
  block("spya-cccccc", "The third paragraph disagrees with both."),
];

const meta: Meta = {
  slug: "example",
  title: "An Example Article",
  byline: "A. Writer",
  siteName: "Somewhere",
  url: "https://example.com/piece",
};

/** The article half of a message whose content was built as parts. */
const partText = (content: unknown, i: number): string =>
  (content as { text: string }[])[i]!.text;

describe("articleWithIds", () => {
  it("does not depend on anything about the call", () => {
    // Called twice with identical arguments, it is the same string — the
    // baseline the rest of this file builds on.
    expect(articleWithIds(meta, blocks)).toBe(articleWithIds(meta, blocks));
  });

  it("never contains the reader-position marker", () => {
    // The marker's old home. If someone reintroduces it into the body, every
    // cache in the request path silently stops working and this is the only
    // thing that says so.
    expect(articleWithIds(meta, blocks)).not.toContain("READER IS HERE");
  });

  it("puts every block's id in, so answers can cite them", () => {
    const out = articleWithIds(meta, blocks);
    for (const b of blocks) expect(out).toContain(b.id);
  });

  it("drops optional head fields rather than emitting them empty", () => {
    const bare: Meta = { slug: "x", title: "Just A Title" };
    const out = articleWithIds(bare, blocks);
    expect(out).toContain("TITLE: Just A Title");
    expect(out).not.toContain("BY:");
    expect(out).not.toContain("URL:");
  });
});

describe("readerPositionLine", () => {
  it("names the block when there is one", () => {
    expect(readerPositionLine("spya-bbbbbb")).toContain("spya-bbbbbb");
  });

  it("is empty when the reader's position is unknown", () => {
    // So callers can concatenate it without producing a stray blank line that
    // would itself change the suffix bytes.
    expect(readerPositionLine(undefined)).toBe("");
  });
});

describe("the three request-path builders share one article", () => {
  /* The strongest test here. Search, explain and converse each used to render
     the article themselves, and the copies had already drifted — one omitted the
     URL line, two carried the marker. If anybody inlines a private copy again,
     this goes red. */
  it("produces the same article bytes from all three", () => {
    const fromSearch = partText(buildSearchMessages(meta, blocks, "anything")[1]!.content, 0);
    const fromExplain = partText(
      buildExplainMessages(meta, blocks, "spya-aaaaaa", "a quote")[1]!.content,
      0,
    );
    const fromConverse = buildConverseMessages({
      meta,
      blocks,
      history: [],
      question: "why?",
      at: "spya-aaaaaa",
    })[1]!.content as string;

    // Each wraps the article in its own one-line preamble, so compare the
    // article itself rather than the whole message.
    const article = articleWithIds(meta, blocks);
    expect(fromSearch).toContain(article);
    expect(fromExplain).toContain(article);
    expect(fromConverse).toContain(article);
  });
});

describe("search's cached part is stable across criteria", () => {
  it("is byte-identical for two different searches", () => {
    const a = buildSearchMessages(meta, blocks, "passages about disagreement");
    const b = buildSearchMessages(meta, blocks, "something else entirely");
    expect(partText(a[1]!.content, 0)).toBe(partText(b[1]!.content, 0));
  });

  it("keeps the criterion out of the cached part", () => {
    // The failure this guards is subtle and total: a breakpoint placed after the
    // varying text means every call writes a new entry and none ever reads one.
    const m = buildSearchMessages(meta, blocks, "a very distinctive criterion");
    expect(partText(m[1]!.content, 0)).not.toContain("a very distinctive criterion");
    expect(partText(m[1]!.content, 1)).toContain("a very distinctive criterion");
  });

  it("marks the article part, and only the article part", () => {
    const parts = buildSearchMessages(meta, blocks, "x")[1]!.content as {
      cache_control?: unknown;
    }[];
    expect(parts[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(parts[1]!.cache_control).toBeUndefined();
  });
});

describe("explain's cached part is stable across selections", () => {
  it("is byte-identical for two different selected blocks", () => {
    // The headline regression. Before the marker moved out of the body, these
    // two differed, and explain could never hit a cache in its life.
    const a = buildExplainMessages(meta, blocks, "spya-aaaaaa", "first quote");
    const b = buildExplainMessages(meta, blocks, "spya-cccccc", "third quote");
    expect(partText(a[1]!.content, 0)).toBe(partText(b[1]!.content, 0));
  });

  it("still tells the model where the reader is, in the suffix", () => {
    // Moving the marker must not cost the model the information.
    const m = buildExplainMessages(meta, blocks, "spya-cccccc", "third quote");
    expect(partText(m[1]!.content, 1)).toContain("spya-cccccc");
    expect(partText(m[1]!.content, 0)).not.toContain("READER IS HERE");
  });

  it("keeps the quote out of the cached part", () => {
    const m = buildExplainMessages(meta, blocks, "spya-aaaaaa", "a memorable quotation");
    expect(partText(m[1]!.content, 0)).not.toContain("a memorable quotation");
  });
});

describe("converse's article message is stable across a conversation", () => {
  const turn = (role: "user" | "assistant", text: string): ChatMessage =>
    ({ id: `spya-${role[0]}${text.length}`, role, text, status: "done" }) as ChatMessage;

  it("does not change when the reader scrolls", () => {
    const a = buildConverseMessages({
      meta,
      blocks,
      history: [],
      question: "q",
      at: "spya-aaaaaa",
    });
    const b = buildConverseMessages({
      meta,
      blocks,
      history: [],
      question: "q",
      at: "spya-cccccc",
    });
    expect(a[1]!.content).toBe(b[1]!.content);
  });

  it("does not change as the history grows", () => {
    /* The article message sits before the history, so a longer conversation
       must not disturb it. This is what lets the cached prefix survive a chat
       that has run past `HISTORY_TURNS` and started dropping its oldest turns. */
    const empty = buildConverseMessages({ meta, blocks, history: [], question: "q" });
    const busy = buildConverseMessages({
      meta,
      blocks,
      history: [turn("user", "earlier question"), turn("assistant", "earlier answer")],
      question: "q",
    });
    expect(empty[1]!.content).toBe(busy[1]!.content);
  });

  it("puts the reader's position with the question, not in the article", () => {
    const m = buildConverseMessages({
      meta,
      blocks,
      history: [],
      question: "what does this mean?",
      at: "spya-bbbbbb",
    });
    expect(m[1]!.content as string).not.toContain("spya-bbbbbb ←");
    expect(m[1]!.content as string).not.toContain("READER IS HERE");
    expect(m[m.length - 1]!.content as string).toContain("spya-bbbbbb");
    expect(m[m.length - 1]!.content as string).toContain("what does this mean?");
  });
});

describe("the cache floor", () => {
  it("counts a short article as too short to cache", () => {
    // Below the floor a breakpoint is accepted and does nothing, returning zeros
    // that look exactly like a broken cache. Callers log this so the two can be
    // told apart.
    expect(underCacheFloor(articleWithIds(meta, blocks))).toBe(true);
  });

  it("flips at the boundary the estimate implies", () => {
    const under = "x".repeat((CACHE_FLOOR_TOKENS - 1) * 4);
    const over = "x".repeat((CACHE_FLOOR_TOKENS + 1) * 4);
    expect(underCacheFloor(under)).toBe(true);
    expect(underCacheFloor(over)).toBe(false);
  });

  it("estimates tokens from characters", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("")).toBe(0);
  });

  it("clears the floor for an article of realistic length", () => {
    /* A guard against the shared block quietly shrinking below the floor — at
       which point caching stops, silently, with no error anywhere. The fixture
       here stands in for a real article; the eval checks the real ones. */
    const long = Array.from({ length: 400 }, (_, i) =>
      block(`spya-${String(i).padStart(6, "0")}`, "A sentence of ordinary length goes here."),
    );
    expect(underCacheFloor(articleWithIds(meta, long))).toBe(false);
  });
});

describe("articleText — the bare-text family", () => {
  it("does not depend on anything about the call", () => {
    expect(articleText(meta, blocks)).toBe(articleText(meta, blocks));
  });

  it("carries no block ids, so the answer cannot cite them", () => {
    /* The arc, the thread and the glossary all ask for prose *about* the piece
       rather than pointers into it. An id in the prompt is an invitation to put
       one in the answer. */
    const out = articleText(meta, blocks);
    for (const b of blocks) expect(out).not.toContain(b.id);
  });

  it("still contains every block's words", () => {
    const out = articleText(meta, blocks);
    for (const b of blocks) expect(out).toContain(b.text);
  });

  it("survives a missing meta", () => {
    // A stage can run before extraction has a title, and the absence has to be
    // the same absence everywhere or the shared block stops being shared.
    expect(articleText(null, blocks)).toBe(articleText(null, blocks));
    expect(articleText(null, blocks)).not.toContain("TITLE:");
  });

  it("differs from the id-annotated rendering", () => {
    // Two renderings on purpose, and two caches. Worth pinning so nobody
    // "simplifies" them into one and quietly changes what four stages send.
    expect(articleText(meta, blocks)).not.toBe(articleWithIds(meta, blocks));
  });
});

describe("cachedText — what is really in the prefix", () => {
  it("includes the system prompt, not only the marked part", () => {
    /* The prefix runs from byte zero of the request, so the system prompt counts
       towards the floor. Measuring only the marked block under-counts, and the
       first version did exactly that: an 893-token article whose request cached
       2,056 tokens reported `tooShortToCache: true` while caching worked. A
       false alarm is the costly way to be wrong — nobody believes the next one. */
    const m = buildSearchMessages(meta, blocks, "a criterion");
    const prefix = cachedText(m);
    expect(prefix).toContain(m[0]!.content as string);
    expect(prefix).toContain(articleWithIds(meta, blocks));
  });

  it("stops at the breakpoint", () => {
    const m = buildSearchMessages(meta, blocks, "a very distinctive criterion");
    expect(cachedText(m)).not.toContain("a very distinctive criterion");
  });

  it("stops at the breakpoint for explain too", () => {
    const m = buildExplainMessages(meta, blocks, "spya-aaaaaa", "a memorable quotation");
    expect(cachedText(m)).not.toContain("a memorable quotation");
  });

  it("falls back to the whole conversation when nothing is marked", () => {
    /* Converse uses OpenRouter's automatic mode, which marks a block we never
       name. Returning everything errs towards "long enough", which is the safe
       direction: the alternative is crying wolf. */
    const m = buildConverseMessages({ meta, blocks, history: [], question: "why?" });
    const prefix = cachedText(m);
    expect(prefix).toContain(articleWithIds(meta, blocks));
    expect(prefix.length).toBeGreaterThan(0);
  });
});
