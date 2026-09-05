/**
 * **Which of a destination's mentions the reader is actually on.**
 *
 * A destination linked twice in one article is ordinary — the noema essay has
 * two such pairs in sixty-two links — and until 2026-09-05 the card summarised
 * the second mention against the first one's paragraph. That failure is the
 * reason this file exists rather than a note in the prompt suite: the answer
 * still arrives, still reads well, and is about a sentence the reader is not
 * looking at. Nothing anywhere goes red. GPT Sol, 2026-09-05, P1-1;
 * docs/project/links.md.
 *
 * Four claims, and the first two are the same claim in the two shapes
 * `articleLinks` can produce — getting only one of them working is the likely
 * mistake, because they take different code paths through one loop:
 *
 * 1. **The same anchor text twice** is *one* row carrying two `blockIds`, so the
 *    occurrence has to be chosen inside a row.
 * 2. **Different anchor text** is *two* rows carrying one `blockId` each, so the
 *    occurrence has to be chosen between rows — and the author's own words for
 *    the destination travel with it, which is half of what makes the answer
 *    relative.
 * 3. **A block that does not check out is a refusal**, not a quiet fall back to
 *    the first mention. It must be both kinds of not-checking-out: a block of
 *    some other article, and a block of *this* article that does not contain
 *    this link. Anything less lets a caller nominate any paragraph of their own
 *    article to have summarised against any link in it.
 * 4. **Saying nothing still works.** A client from before this existed sends no
 *    block, and gets the first mention — the old behaviour, on purpose.
 *
 * Pure: no database, no network, no model. `linkSummaryStream` refuses on
 * membership before it reads any store, which is why claim 3 can be asserted
 * against the generator itself rather than against a mock of one.
 */

import { describe, expect, it } from "vitest";

import { linkInArticle } from "../src/link-previews.js";
import { linkSummaryStream, readerContext } from "../src/link-summary.js";
import type { Article, Block, LinkSummaryEvent, Meta, Tree } from "../src/types.js";
import { requestTarget } from "../src/urls.js";

const PAPER = "https://destination.example/paper";
const TARGET = requestTarget(PAPER) ?? "";

const FIRST = "Early on the argument leans on a paper about measurement.";
const MIDDLE = "A paragraph in between that links nowhere at all.";
const SECOND = "Forty pages later the same paper is turned against its own authors.";

function block(id: string, text: string, html: string): Block {
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html, gistable: true };
}

/** `<p>` with one anchor in it, so `articleLinks` has something to parse. */
function withLink(id: string, text: string, words: string): Block {
  return block(id, text, `<p id="${id}">${text} <a href="${PAPER}">${words}</a></p>`);
}

/**
 * Two mentions of one destination, forty pages apart.
 *
 * `sameWords` is the difference between the two shapes: with it the author used
 * one phrase twice and `articleLinks` reports one row, without it they used two
 * and it reports two.
 */
function anArticle(sameWords: boolean): Article {
  const meta: Meta = {
    slug: "test-two-mentions",
    title: "What the measurement problem costs",
    url: "https://example.invalid/piece",
  };
  const tree: Tree = {
    version: "1",
    generator: "test",
    slug: "test-two-mentions",
    rootId: "n0",
    nodes: { n0: { id: "n0", title: "root", blocks: [], children: [], gist: "A gist." } },
  } as unknown as Tree;
  return {
    meta,
    blocks: [
      withLink("spya-aaaaaa", FIRST, "the paper"),
      block("spya-bbbbbb", MIDDLE, `<p id="spya-bbbbbb">${MIDDLE}</p>`),
      withLink("spya-cccccc", SECOND, sameWords ? "the paper" : "its own authors"),
    ],
    tree,
    assets: undefined,
  } as Article;
}

/** What the route does with the answer, in the two lines the route does it in. */
function contextAt(article: Article, blockId: string | "first"): string {
  const at = linkInArticle(
    article.blocks,
    article.meta.url ?? undefined,
    TARGET,
    blockId === "first" ? "first" : { blockId },
  );
  if (!at) throw new Error(`no occurrence at ${blockId}`);
  return readerContext(article, at);
}

describe("choosing the mention the pointer is on", () => {
  it("finds the second of two mentions under the same words", () => {
    /* One `ArticleLink` with two `blockIds`, so the choice is *inside* a row.
       Before this existed, both of these returned the first paragraph. */
    const article = anArticle(true);
    expect(contextAt(article, "spya-cccccc")).toContain(SECOND);
    expect(contextAt(article, "spya-cccccc")).not.toContain(FIRST);
    expect(contextAt(article, "spya-aaaaaa")).toContain(FIRST);
    expect(contextAt(article, "spya-aaaaaa")).not.toContain(SECOND);
  });

  it("finds the second of two mentions under different words, and its words with it", () => {
    /* Two `ArticleLink`s with one `blockId` each, so the choice is *between*
       rows — and the anchor's own text is the author's characterisation of the
       destination, which is often the only statement of why it is cited. A
       version that got the paragraph right and the words wrong would read as
       working. */
    const article = anArticle(false);
    const later = contextAt(article, "spya-cccccc");
    expect(later).toContain(SECOND);
    expect(later).toContain("its own authors");
    expect(later).not.toContain(FIRST);
    const earlier = contextAt(article, "spya-aaaaaa");
    expect(earlier).toContain(FIRST);
    expect(earlier).toContain("the paper");
    expect(earlier).not.toContain(SECOND);
  });

  it("gives the first mention to a caller that names no block", () => {
    for (const sameWords of [true, false]) {
      expect(contextAt(anArticle(sameWords), "first")).toContain(FIRST);
    }
  });

  it("knows nothing about a block that does not contain the link", () => {
    for (const sameWords of [true, false]) {
      const article = anArticle(sameWords);
      const base = article.meta.url ?? undefined;
      /* In the article, and linking nothing. */
      expect(linkInArticle(article.blocks, base, TARGET, { blockId: "spya-bbbbbb" })).toBeNull();
      /* Not in the article at all. */
      expect(linkInArticle(article.blocks, base, TARGET, { blockId: "spya-zzzzzz" })).toBeNull();
      /* And the membership question itself is unchanged by any of it. */
      expect(linkInArticle(article.blocks, base, TARGET)).not.toBeNull();
    }
  });
});

describe("the route refuses a block that does not check out", () => {
  /** The first event the stream yields, which for every case here is the last. */
  async function firstEvent(blockId: unknown): Promise<LinkSummaryEvent> {
    for await (const event of linkSummaryStream({
      slug: "test-two-mentions",
      article: anArticle(true),
      url: PAPER,
      blockId,
      profile: null,
    })) {
      return event;
    }
    throw new Error("the stream yielded nothing");
  }

  it("refuses a block of some other article", async () => {
    /* **A refusal and not a fallback**, which is the whole finding: a nominated
       block that quietly became the first mention would let a caller have any
       paragraph of their own article summarised against any link in it, and
       would look exactly like this feature working. */
    expect(await firstEvent("spya-zzzzzz")).toEqual({ kind: "refused" });
  });

  it("refuses a block of this article that does not carry the link", async () => {
    expect(await firstEvent("spya-bbbbbb")).toEqual({ kind: "refused" });
  });

  /* **`null` is not tested here and that is deliberate.** A caller that names no
     block gets past membership and on to the preview cache, which is a store
     read and a database this file does not want; the behaviour it would assert
     — the first mention — is the third case in the suite above. */
  it("refuses a block that is not a string at all", async () => {
    /* A query parameter is whatever arrived. A client bug that sent a number
       must not be read as "no block given" and answered with the first
       mention — that is the fallback wearing a different hat. */
    expect(await firstEvent(7)).toEqual({ kind: "refused" });
  });
});
