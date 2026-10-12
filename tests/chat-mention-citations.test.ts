// @vitest-environment jsdom
/**
 * **A citation of another article brought into the conversation** — the pure
 * half (src/web/citations.ts § `crossArticles`, `splitCitations`). Plan
 * docs/plans/261012d-chat-at-mention-your-own-articles.md § 4, and GPT Sol's
 * F1 on it: a block id names an article only when exactly one article has it.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MentionedArticleView } from "../src/types.js";
import { crossArticles, splitCitations } from "../src/web/citations.js";
import { CrossArticleRef } from "../src/web/CrossArticleRef.js";

const OPEN = new Map([
  ["spya-aaaaaa", "the open article's first paragraph"],
  ["spya-shared", "a paragraph whose id an import carried"],
]);

const href = (slug: string) => `/read/${encodeURIComponent(slug)}`;

const SMITH: MentionedArticleView = {
  available: true,
  title: "Smith 2024, Replication",
  slug: "smith-2024",
  blockIds: ["spya-smth23", "spya-shared", "spya-bth234"],
};
const JONES: MentionedArticleView = {
  available: true,
  title: "Reply to Jones",
  slug: "reply-to-jones",
  blockIds: ["spya-jnes23", "spya-bth234"],
};
const GONE: MentionedArticleView = { available: false, title: "Deleted one", reason: "deleted" };

describe("crossArticles and splitCitations — ids from articles brought in", () => {
  const cross = crossArticles(OPEN, [SMITH, JONES, GONE], href);
  const split = (para: string) => splitCitations(para, OPEN, cross);

  it("draws an id unique to one mentioned article as a chip for that article, with the server's slug", () => {
    expect(split("It reports d = 0.21 [spya-smth23].")).toEqual([
      { kind: "text", text: "It reports d = 0.21 " },
      {
        kind: "cross",
        ids: ["spya-smth23"],
        source: { slug: "smith-2024", title: "Smith 2024, Replication", href: "/read/smith-2024" },
      },
      { kind: "text", text: "." },
    ]);
  });

  it("builds the rendered link from the allowlisted href, never from title text", () => {
    const markup = renderToStaticMarkup(
      createElement(CrossArticleRef, {
        id: "spya-smth23",
        source: { slug: "server-slug", title: "../model text?next=elsewhere", href: "/read/server-slug" },
      }),
    );
    expect(markup).toContain('href="/read/server-slug?at=spya-smth23"');
    expect(markup).not.toContain("/read/..%2Fmodel");
  });

  it("leaves an id two mentioned articles share as the characters the model wrote", () => {
    expect(split("Both say so [spya-bth234].")).toEqual([{ kind: "text", text: "Both say so [spya-bth234]." }]);
  });

  it("leaves an id the open article shares with a mentioned one as text, not an open-article chip", () => {
    expect(split("See [spya-shared].")).toEqual([{ kind: "text", text: "See [spya-shared]." }]);
  });

  it("leaves a colliding id visible when the same bracket also has a usable id", () => {
    expect(split("Compare [spya-shared, spya-smth23].")).toEqual([
      { kind: "text", text: "Compare [spya-shared, spya-smth23]." },
    ]);
  });

  it("keeps an open-article id exactly as before", () => {
    expect(split("Here [spya-aaaaaa].")).toEqual([
      { kind: "text", text: "Here " },
      { kind: "cite", ids: ["spya-aaaaaa"] },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves an id nobody has as text, as before", () => {
    expect(split("Made up [spya-zzzzzz].")).toEqual([{ kind: "text", text: "Made up [spya-zzzzzz]." }]);
  });

  it("splits one bracket across articles, each in the order it first appears", () => {
    expect(split("[spya-jnes23, spya-aaaaaa, spya-smth23]")).toEqual([
      {
        kind: "cross",
        ids: ["spya-jnes23"],
        source: { slug: "reply-to-jones", title: "Reply to Jones", href: "/read/reply-to-jones" },
      },
      { kind: "cite", ids: ["spya-aaaaaa"] },
      {
        kind: "cross",
        ids: ["spya-smth23"],
        source: { slug: "smith-2024", title: "Smith 2024, Replication", href: "/read/smith-2024" },
      },
    ]);
  });

  it("reads nothing from an unavailable mention, which carries no ids", () => {
    const onlyGone = crossArticles(OPEN, [GONE], href);
    expect(onlyGone.byId.size).toBe(0);
    expect(onlyGone.ambiguous.size).toBe(0);
  });

  it("is the old behaviour when nothing was brought in", () => {
    expect(splitCitations("x [spya-smth23]", OPEN, crossArticles(OPEN, undefined, href))).toEqual([
      { kind: "text", text: "x [spya-smth23]" },
    ]);
  });
});
