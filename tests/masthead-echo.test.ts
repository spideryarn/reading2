/**
 * **Which leading blocks only repeat the masthead** — src/web/masthead-echo.ts.
 *
 * Greg, spya-t6cdve, 2026-10-06: *"Why does this article seem to show the title
 * twice on the page?"* The masthead draws the title and block 0 of the prose is
 * an `<h1>` with the same words.
 * docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md
 * § The rule; each case below is a line of it or one of GPT Sol's findings on it.
 *
 * The blocks are built the way stage 3 stores them: `html` is the element's
 * own `outerHTML`, tag and stamped id included (tests/fixtures/data-root/
 * output/noema-mythology-of-conscious-ai.blocks.json, blocks 0 and 1).
 */
import { describe, expect, it } from "vitest";
import type { Block, BlockId } from "../src/types.js";
import { mastheadEcho } from "../src/web/masthead-echo.js";

const id = (s: string) => `spya-${s}` as BlockId;

/** A heading whose html is `inner` inside its own tag; `text` is what it reads as. */
const heading = (key: string, text: string, tag = "h1", inner = text): Block => ({
  id: id(key),
  tag,
  kind: "heading",
  level: Number(tag.slice(1)),
  text,
  words: text.split(/\s+/).length,
  html: `<${tag} id="${id(key)}">${inner}</${tag}>`,
  gistable: true,
});

const para = (key: string, text: string, inner = text): Block => ({
  id: id(key),
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p id="${id(key)}">${inner}</p>`,
  gistable: true,
});

/** The debug page's `<div class="meta">`, as the splitter stores it: a `p`, with the template's line breaks. */
const metaLine = (key: string, text: string): Block =>
  para(key, text, `\n  ${text.replace(" · ~", "\n  · ~")}\n`);

const article = (title: string, blocks: Block[], titleOverridden = false) => ({
  meta: { title },
  blocks,
  titleOverridden,
});

const body = para("body00", "The most obvious difference between real essays and school essays.");

describe("mastheadEcho: the wrapper's shape", () => {
  it("hides the wrapper's heading and its reading-time line", () => {
    const blocks = [
      heading("title0", "The Age of the Essay"),
      metaLine("meta00", "Paul Graham · paulgraham.com · ~26 min read"),
      body,
    ];
    expect([...mastheadEcho(article("The Age of the Essay", blocks))]).toEqual([id("title0"), id("meta00")]);
  });

  it("knows the line with no byline and no site, which starts at the dot", () => {
    const blocks = [heading("title0", "Claude’s Constitution"), metaLine("meta00", "· ~141 min read"), body];
    expect([...mastheadEcho(article("Claude’s Constitution", blocks))]).toEqual([id("title0"), id("meta00")]);
  });

  it("keeps an author's own bare reading time: the wrapper always writes the dot", () => {
    const blocks = [heading("title0", "Something else"), para("meta00", "~26 min read"), body];
    expect(mastheadEcho(article("A different title", blocks)).size).toBe(0);
  });

  it("hides both by shape when the title was tidied on import and no longer matches (Sol F4)", () => {
    const blocks = [
      heading("title0", "The Age of the Essay | Paul Graham"),
      metaLine("meta00", "Paul Graham · ~26 min read"),
      body,
    ];
    expect([...mastheadEcho(article("The Age of the Essay", blocks))]).toEqual([id("title0"), id("meta00")]);
  });

  it("keeps a renamed article's heading and still hides our line (Sol F3)", () => {
    const blocks = [
      heading("title0", "The Age of the Essay"),
      metaLine("meta00", "Paul Graham · ~26 min read"),
      body,
    ];
    expect([...mastheadEcho(article("Essays, by PG", blocks, true))]).toEqual([id("meta00")]);
  });

  it("keeps a renamed article's heading even when the rename is the same words", () => {
    const blocks = [heading("title0", "The Age of the Essay"), metaLine("meta00", "· ~26 min read"), body];
    expect([...mastheadEcho(article("The Age of the Essay", blocks, true))]).toEqual([id("meta00")]);
  });

  it("does not take a sentence that mentions a reading time for our line", () => {
    const blocks = [
      heading("title0", "Something else"),
      para("p10000", "This piece is roughly a ~5 min read"),
      body,
    ];
    expect(mastheadEcho(article("A different title", blocks)).size).toBe(0);
  });

  it("does not take a paragraph that goes on after the reading time for our line", () => {
    const blocks = [
      heading("title0", "Something else"),
      para("p10000", "Posted by Jo · ~5 min read, or ten if you follow the links."),
      body,
    ];
    expect(mastheadEcho(article("A different title", blocks)).size).toBe(0);
  });

  it("does not take a line with markup in it for ours", () => {
    const blocks = [
      heading("title0", "Something else"),
      para("p10000", "Jo Bloggs · ~5 min read", '<a href="/jo">Jo Bloggs</a> · ~5 min read'),
      body,
    ];
    expect(mastheadEcho(article("A different title", blocks)).size).toBe(0);
  });

  it("does not take a second heading that reads like our line for it: the wrapper's is a paragraph", () => {
    const blocks = [heading("title0", "Something else"), heading("sub000", "· ~5 min read", "h2"), body];
    expect(mastheadEcho(article("A different title", blocks)).size).toBe(0);
  });

  it("needs the heading before the line: a reading-time line under an h2 is not the wrapper", () => {
    const blocks = [heading("title0", "Overview", "h2"), metaLine("meta00", "· ~26 min read"), body];
    expect(mastheadEcho(article("A different title", blocks)).size).toBe(0);
  });
});

describe("mastheadEcho: the same words at block 0", () => {
  it("hides a paper's own first heading when it says what the masthead says", () => {
    const blocks = [heading("title0", "Attention Is All You Need"), body];
    expect([...mastheadEcho(article("Attention Is All You Need", blocks))]).toEqual([id("title0")]);
  });

  it("compares after trimming, collapsing whitespace and lower-casing", () => {
    const blocks = [heading("title0", "  Attention  Is All\nYou NEED "), body];
    expect([...mastheadEcho(article("Attention is all you need", blocks))]).toEqual([id("title0")]);
  });

  it("hides nothing when the first heading says something else", () => {
    const blocks = [heading("title0", "Journal of Machine Learning Research"), body];
    expect(mastheadEcho(article("Attention Is All You Need", blocks)).size).toBe(0);
  });

  it("keeps a renamed article's first heading", () => {
    const blocks = [heading("title0", "Attention Is All You Need"), body];
    expect(mastheadEcho(article("Attention Is All You Need", blocks, true)).size).toBe(0);
  });

  it("keeps a heading with inline markup, which the plain masthead does not show (Sol F2)", () => {
    const blocks = [
      heading("title0", "Attention Is All You Need", "h1", "Attention Is <em>All</em> You Need"),
      body,
    ];
    expect(mastheadEcho(article("Attention Is All You Need", blocks)).size).toBe(0);
  });

  it("keeps a heading with maths in it, which the prose draws and the masthead does not", () => {
    const title = "Bounds on \\(\\alpha\\) for sparse graphs";
    const blocks = [heading("title0", title), body];
    expect(mastheadEcho(article(title, blocks)).size).toBe(0);
  });

  it("keeps a first block that says the title but is not an h1", () => {
    expect(mastheadEcho(article("Overview", [heading("title0", "Overview", "h2"), body])).size).toBe(0);
    expect(mastheadEcho(article("Overview", [para("title0", "Overview"), body])).size).toBe(0);
  });

  it("never hides a later heading, even an h1 that equals the title (Sol F2)", () => {
    const blocks = [
      para("kicker", "Essays"),
      para("date00", "September 2004"),
      heading("title2", "The Age of the Essay"),
      body,
    ];
    expect(mastheadEcho(article("The Age of the Essay", blocks)).size).toBe(0);
  });
});

describe("mastheadEcho: the edges", () => {
  it("is empty for an article with no blocks", () => {
    expect(mastheadEcho(article("Anything", [])).size).toBe(0);
  });

  it("hides a lone heading that equals the title", () => {
    const blocks = [heading("title0", "Anything")];
    expect([...mastheadEcho(article("Anything", blocks))]).toEqual([id("title0")]);
  });

  it("never returns more than the first two blocks", () => {
    const blocks = [
      heading("title0", "Anything"),
      metaLine("meta00", "· ~3 min read"),
      metaLine("meta01", "· ~3 min read"),
      heading("title3", "Anything"),
    ];
    expect([...mastheadEcho(article("Anything", blocks))]).toEqual([id("title0"), id("meta00")]);
  });
});
