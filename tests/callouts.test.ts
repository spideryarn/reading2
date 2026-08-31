/**
 * Stage 2 recognises the boxes an author set apart from the prose, before
 * Readability throws the markup that says so away — src/callouts.ts, and
 * docs/plans/260831ae-callouts-the-box-the-author-drew.md for the measurement
 * this came from.
 *
 * **What a recognised callout produces is a `context`, not a `kind`** — the
 * block keeps its own form and belongs to an authored group
 * (docs/plans/260831af-carrying-markup-facts-past-readability.md). Assertions
 * here read `block.context`; `kind` is asserted where it must be *unchanged*,
 * which is the half that was wrong for half a day.
 *
 * **These run the real pipeline, not `canonicaliseCallouts` on its own.**
 * `runExtract` (jsdom, Readability, the sanitiser) and then `splitIntoBlocks`,
 * because the whole bug is that Readability deletes the `<div>` the class was
 * on. A test that called the stage-2 pass and then read the DOM back would pass
 * on the very markup that fails in production, which is the trap
 * tests/notes-canonical.test.ts names at the top of the file.
 *
 * The pages here are synthetic rather than fixtures, and that is a real
 * limitation rather than a convenience: **not one of the sixteen extraction
 * fixtures produces a callout block**, because the two that carry the markup —
 * rfc9110's 32 editorial `<aside>`s and gwern's 3 admonitions — are thrown out
 * of the article by Readability before stage 3 sees them. The evidence that
 * this works on a real page is the article it was built for, whose nine
 * Substack callouts come through: docs/plans/260831ae-callouts-the-box-the-author-drew.md § Measured.
 */

import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { canonicaliseCallouts, type CalloutStats } from "../src/callouts.js";
import { runExtract } from "../src/extract.js";
import { splitIntoBlocks } from "../src/blocks.js";
import type { Block } from "../src/types.js";

/** Enough body prose either side that Readability keeps the article at all. */
const FILLER = Array.from(
  { length: 8 },
  (_, i) =>
    `<p>Body paragraph ${i}. Readability scores by text length, so a page has to have some, and ` +
    "this sentence exists to give it some. It is ordinary argument and nothing else, written at " +
    "enough length that the container it sits in wins the scoring against the chrome around it.</p>",
).join("\n");

function page(body: string): string {
  return `<!doctype html><html><head><title>A page with a box in it</title></head>
    <body><article>${FILLER}${body}${FILLER}</article></body></html>`;
}

/**
 * The real stage 2 then the real stage 3.
 *
 * `withoutCallouts` re-runs stage 2 with the stamps taken back off the extracted
 * HTML, which is the only honest way to produce "what this article looked like
 * before the feature" without a second extraction path to keep in step.
 * `previous` is the earlier run's blocks, which is how stage 3 carries ids over.
 */
async function blocksFor(
  html: string,
  opts: { withoutCallouts?: boolean; previous?: Block[] } = {},
): Promise<Block[]> {
  const { extractedHtml } = await runExtract({
    html,
    url: "https://example.test/page",
    slug: "page",
  });
  /* Stage 2 writes nothing since 2026-08-31 — the store decides where the page
     lands — so this is the artefact, in memory. */
  const extracted = opts.withoutCallouts
    ? extractedHtml.replace(/ data-spya-callout="[^"]*"/g, "")
    : extractedHtml;
  return splitIntoBlocks(extracted, opts.previous).blocks;
}

/** The one block whose text starts with `prefix`, or a failure that says what was there. */
function blockStarting(blocks: Block[], prefix: string): Block {
  const found = blocks.find((b) => b.text.startsWith(prefix));
  if (!found) {
    throw new Error(
      `No block starts with ${JSON.stringify(prefix)}. Blocks: ${JSON.stringify(
        blocks.map((b) => `${b.kind}: ${b.text.slice(0, 40)}`),
        null,
        1,
      )}`,
    );
  }
  return found;
}

describe("a callout survives Readability deleting the element that named it", () => {
  it("classifies Substack's callout-block, whose div does not survive", async () => {
    const blocks = await blocksFor(
      page(
        `<div data-callout="true" class="callout-block"><p><span>Whoa! Shared Artifactory cache ` +
          `is a covert mailbox among agents. And there are messages specifically to us?</span></p></div>`,
      ),
    );
    const callout = blockStarting(blocks, "Whoa!");
    expect(callout.context?.type).toBe("callout");
    expect(callout.kind).toBe("text"); // its own form is unchanged by the box
    expect(callout.context?.id).toMatch(/^c-[0-9a-f]{10}$/);
  });

  it("classifies an admonition, and keeps a heading inside one a heading", async () => {
    const blocks = await blocksFor(
      page(
        `<div class="admonition note"><h3>A note to the reader</h3>` +
          `<p>Attention is worth spending here, because the argument turns on it and the rest of ` +
          `the section assumes you have understood this paragraph.</p></div>`,
      ),
    );
    const body = blockStarting(blocks, "Attention is worth");
    expect(body.context?.type).toBe("callout");
    /* The tree is built from heading levels. A box around a heading does not
       stop it being one — **and the heading is in the box too**, which is the
       thing `kind: "callout"` could not say and the reason contexts exist. */
    const heading = blockStarting(blocks, "A note to the reader");
    expect(heading.kind).toBe("heading");
    expect(heading.level).toBe(3);
    expect(heading.context?.id).toBe(body.context?.id);
  });

  it("leaves a blockquote inside a callout a quote", async () => {
    const blocks = await blocksFor(
      page(
        `<div class="callout"><blockquote><p>The quotation inside the box is still a quotation, ` +
          `and it is set as one, because a box around it changes who is speaking not at all.` +
          `</p></blockquote></div>`,
      ),
    );
    const quoted = blockStarting(blocks, "The quotation inside");
    expect(quoted.kind).toBe("quote");
    expect(quoted.context?.type).toBe("callout"); // in the box, and still a quotation
  });

  it("classifies loose text in a callout, which has no element to stamp", async () => {
    /* The shape that made the first version of this pass silently do nothing:
       Readability deletes the `<div>` and builds a *fresh* `<p>` from the text,
       so the stamp has to be put on a paragraph of our own first
       (src/callouts.ts § wrapLooseRuns). GPT Sol, 2026-08-31. */
    const blocks = await blocksFor(
      page(
        `<div class="callout">Loose words with no paragraph around them, written straight into ` +
          `the box the way a hand-written page does it.</div>`,
      ),
    );
    expect(blockStarting(blocks, "Loose words").context?.type).toBe("callout");
  });

  it("classifies a callout whose only child is a span", async () => {
    const blocks = await blocksFor(
      page(
        `<div data-callout="true"><span>Inline content and nothing else, which stage 3 would ` +
          `never find by looking at a block's ancestors.</span></div>`,
      ),
    );
    expect(blockStarting(blocks, "Inline content").context?.type).toBe("callout");
  });

  it("classifies a Docusaurus admonition", async () => {
    const blocks = await blocksFor(
      page(
        `<div class="theme-admonition theme-admonition-warning alert alert--warning">` +
          `<p>Do not delete this token, because everything downstream of it assumes it is there ` +
          `and none of it will tell you when it is not.</p></div>`,
      ),
    );
    expect(blockStarting(blocks, "Do not delete").context?.type).toBe("callout");
  });

  it("changes no policy: a callout is gistable exactly as the same words would be", async () => {
    /* **The rule this pins is that a context decides nothing.** For half a day
       the pull-quote check asked about callouts, so a box round a repeated
       sentence set `gistable: false` — presentation reaching into the argument
       machinery, and worse, doing it through a field `hashBlocks` cannot see,
       so removing the box later flipped it back with the article's fingerprint
       unchanged. GPT Sol traced that; src/blocks.ts § describeBlock has it.

       So: the same words are gistable in the box and out of it. A genuine
       pull-quote is a `<blockquote>` or lives in a `<figure>`, and both were
       covered before callouts existed. */
    const repeated =
      "The conspiracy began almost immediately after the evaluations were started, and it took " +
      "the shape nobody had planned for.";
    const blocks = await blocksFor(
      page(
        `<p>${repeated}</p>` +
          `<div class="callout"><p>${repeated}</p></div>` +
          `<div class="callout"><p>A sentence that is said exactly once in this article and ` +
          `therefore has something of its own to contribute.</p></div>` +
          `<blockquote><p>${repeated}</p></blockquote>`,
      ),
    );
    expect(blockStarting(blocks, "A sentence that is said").gistable).toBe(true);
    const repeatedInBox = blocks.filter(
      (b) => b.context !== undefined && b.text.startsWith("The conspiracy"),
    );
    expect(repeatedInBox).toHaveLength(1);
    expect(repeatedInBox[0]?.gistable).toBe(true);
    // And the rule still fires where it always did: a real blockquote repeating
    // the body is still a pull-quote.
    const asQuote = blocks.find((b) => b.kind === "quote" && b.text.startsWith("The conspiracy"));
    expect(asQuote?.gistable).toBe(false);
  });

  it("carries a block's id across the stamp arriving", async () => {
    /* The whole reason this pass stamps rather than rewrites: a re-extraction
       must not re-mint the id, or every comment on that paragraph is orphaned.
       Ids carry over on tag + text (src/blocks.ts § exactKey), and the previous
       run's blocks are what stage 3 matches against. */
    const html = page(
      `<div data-callout="true" class="callout-block"><p>A paragraph that was ordinary prose ` +
        `before anybody taught this pipeline what a callout is.</p></div>`,
    );
    const before = await blocksFor(html, { withoutCallouts: true });
    const after = await blocksFor(html, { previous: before });
    const was = before.find((b) => b.text.startsWith("A paragraph that was ordinary"));
    const now = after.find((b) => b.text.startsWith("A paragraph that was ordinary"));
    expect(was?.context).toBeUndefined(); // the world before this feature
    expect(now?.context?.type).toBe("callout");
    expect(now?.kind).toBe("text"); // unchanged, which is why the id survives
    expect(now?.id).toBe(was?.id);
  });

  it("does not sweep a list into a paragraph of its own making", async () => {
    /* **GPT Sol's reproduction, 2026-08-31**, and the reason `wrapLooseRuns`
       asks about phrasing content rather than about the leaves stage 3 emits.
       With the two conflated, the `<ul>` was swept into a synthetic `<p>` —
       invalid markup, which the next reparse unpicks into different blocks with
       different tags, costing the trailing one its carry-over key. */
    const markup =
      `<div class="callout">Words before the list, long enough to be scored as the prose they are.` +
      `<ul><li>The first item of a list that must stay a list.</li></ul>` +
      `<span>Words after the list, in a span, which is phrasing content and may be gathered.</span>` +
      `</div>`;
    const withBox = await blocksFor(page(markup));
    /* The control: the same article with the class taken off, so the callout
       pass does nothing at all. Boundaries must be identical either way. */
    const without = await blocksFor(page(markup.replace(' class="callout"', "")));

    const shape = (bs: Block[]) =>
      bs.filter((b) => b.text !== "").map((b) => `${b.tag}:${b.text.slice(0, 20)}`);
    expect(shape(withBox)).toEqual(shape(without));
    expect(withBox.some((b) => b.text === "")).toBe(false); // no synthetic empty block
    // The list item is in the box, and is still a list item.
    const item = blockStarting(withBox, "The first item");
    expect(item.tag).toBe("li");
    expect(item.context?.type).toBe("callout");
    // And every block of the box shares its id, the trailing span included.
    const ids = new Set(withBox.filter((b) => b.context).map((b) => b.context?.id));
    expect(ids.size).toBe(1);
    expect(blockStarting(withBox, "Words after the list").context?.id).toBe(item.context?.id);
  });

  it("marks every paragraph of a multi-paragraph callout", async () => {
    const blocks = await blocksFor(
      page(
        `<div class="callout"><p>First paragraph of the box, long enough that Readability does ` +
          `not fold it into something else on its way past.</p>` +
          `<p>Second paragraph of the box, equally long, and it belongs to the same box as the ` +
          `one above it does.</p></div>`,
      ),
    );
    const first = blockStarting(blocks, "First paragraph of the box");
    const second = blockStarting(blocks, "Second paragraph of the box");
    expect(first.context?.type).toBe("callout");
    /* **One id across both**, which is the identity a multi-paragraph callout
       did not have when this was a `kind`: each paragraph is its own block, and
       nothing said they were the same box. */
    expect(second.context?.id).toBe(first.context?.id);
  });
});

/**
 * The `<aside>` guard, asserted where it actually decides something.
 *
 * **Through the pipeline these would be vacuous**, and that is worth saying out
 * loud: Readability throws `<aside>` out of the article on its own — measured,
 * nothing from any of rfc9110's 32 editorial asides or gwern's 3 admonitions
 * reaches a block — so a pipeline test of "this sidebar is not a callout" would
 * be green with the guard deleted. So the guard is tested against the DOM it
 * guards, one call to the stage-2 pass, and the *stamp* is the assertion.
 */
describe("what is not a callout", () => {
  function stamped(body: string): { stats: CalloutStats; doc: Document } {
    const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`);
    const stats = canonicaliseCallouts(dom.window.document);
    return { stats, doc: dom.window.document };
  }

  it("ignores an aside that is a list of links", () => {
    const { stats, doc } = stamped(
      `<aside><p><a href="/one">Related reading one</a> · <a href="/two">Related reading two</a>` +
        ` · <a href="/three">Related reading three</a> · <a href="/four">Related four</a></p></aside>`,
    );
    expect(stats.containers).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(doc.querySelector("[data-spya-callout]")).toBeNull();
  });

  it("ignores an aside wrapped round a nav", () => {
    const { stats, doc } = stamped(
      "<aside><nav><p>On this page you will find the sections listed here.</p></nav></aside>",
    );
    expect(stats.containers).toBe(0);
    expect(doc.querySelector("[data-spya-callout]")).toBeNull();
  });

  it("does not let the guard overrule a publisher saying so", () => {
    /* An explicit `data-callout` whose entire text is a link. The guard is for
       the one ambiguous signal; a declaration outranks a heuristic. */
    const { stats } = stamped(
      '<div data-callout="true"><p><a href="/warning">Read this essential warning</a></p></div>',
    );
    expect(stats.containers).toBe(1);
    expect(stats.shapes.callout).toBe(1);
  });

  it("keeps a short aside whose one link is a citation", () => {
    /* Readability's own coefficient: a link to a fragment of the same page
       counts for 0.3, because `See <a href="#section-4">Section 4</a>` is how an
       RFC's editorial aside is written. Counted in full, this is 0.53 and gets
       thrown away. */
    const { stats } = stamped(
      '<aside><p>Note: see <a href="#section-4">Section 4 of this document</a>.</p></aside>',
    );
    expect(stats.containers).toBe(1);
    expect(stats.shapes.aside).toBe(1);
  });

  it("keeps an aside of editorial prose, which is what an RFC writes", () => {
    // The other side of the same guard: with it too strict, rfc9110's 32
    // "Note: …" boxes would be indistinguishable from MDN's sidebars.
    const { stats, doc } = stamped(
      '<aside id="section-4.2.5-2"><p><strong>Note:</strong> The fragment identifier component ' +
        'is not part of the scheme definition for a URI scheme (see ' +
        '<a href="https://example.test/rfc3986">Section 4.3</a>).</p></aside>',
    );
    expect(stats.containers).toBe(1);
    expect(stats.shapes.aside).toBe(1);
    /* Every element inside is stamped, not a chosen few: which one survives
       Readability is not knowable here, and an inert stamp costs an attribute
       while a missing one costs the feature (src/callouts.ts § INSIDE_SELECTOR). */
    expect(doc.querySelector(`aside[data-spya-callout]`)).not.toBeNull();
    expect(doc.querySelector(`p[data-spya-callout]`)).not.toBeNull();
  });

  it("does not let a sidebar's scripts dilute its link density", () => {
    /* cornell.html's `<aside id="supersizeme">`: four links, two ad slots, and
       about 1,200 characters of googletag/addthis configuration. `textContent`
       counts script source as text, so the first version of the guard measured
       this at well under half links and stamped all 21 of its elements. */
    const script = `var addthis_config = { ${"data_track_clickback: true, ".repeat(30)} };`;
    const { stats } = stamped(
      '<aside id="supersizeme" class="col-sm-4"><h2>U.S. Code Toolbox</h2>' +
        '<div><a href="/wex">Law about… Articles from Wex</a></div>' +
        '<div><a href="/topn">Table of Popular Names</a></div>' +
        '<div><a href="/ptoa">Parallel Table of Authorities</a></div>' +
        `<script type="text/javascript">${script}</script></aside>`,
    );
    expect(stats.containers).toBe(0);
    expect(stats.skipped).toBe(1);
  });

  it("ignores a Wikipedia hatnote, which is what role=note is used for", () => {
    /* `[role="note"]` was in the selector until the corpus was measured: it is
       how Wikipedia marks "Main article: …", seven times on one article, and
       every one is navigation. The signal was dropped rather than the guard
       bent — src/callouts.ts § CONTAINER_SELECTOR. This is here so that adding
       it back is a decision rather than an oversight. */
    const { stats, doc } = stamped(
      '<div role="note" class="hatnote navigation-not-searchable">Further information: ' +
        '<a href="/wiki/Word_embedding">Word embedding</a></div>',
    );
    expect(stats.containers).toBe(0);
    expect(doc.querySelector("[data-spya-callout]")).toBeNull();
  });

  it("counts a callout inside a callout once", () => {
    const { stats } = stamped(
      '<div class="callout"><div class="admonition"><p>A box the CMS wrapped twice.</p></div></div>',
    );
    expect(stats.containers).toBe(1);
  });

  it("keeps the transport out of the html the reader gets", async () => {
    /* The fact crosses once, as `block.context`. The attribute that carried it
       is stage-2-to-stage-3 transport and nothing in the browser reads it —
       unlike the note stamps, which the hover card does. Two copies of one fact
       with nothing keeping them in step is the shape to avoid. GPT Sol,
       2026-08-31. */
    const blocks = await blocksFor(
      page(
        `<div data-callout="true" class="callout-block"><p>A paragraph in a box, whose markup ` +
          `should carry no sign of how we found that out.</p></div>`,
      ),
    );
    const inBox = blockStarting(blocks, "A paragraph in a box");
    expect(inBox.context?.type).toBe("callout");
    expect(inBox.html).not.toContain("data-spya-callout");
    expect(blocks.every((b) => !b.html.includes("data-spya-callout"))).toBe(true);
  });

  it("does not let a page forge the stamp", async () => {
    // Ours, and therefore forgeable — the same reasoning as src/notes.ts. A
    // stamp the page arrived carrying is removed before we write any of ours.
    const blocks = await blocksFor(
      page(
        `<p data-spya-callout="">This paragraph is ordinary argument that the publisher has ` +
          `dressed as one of our callouts, and it must be rendered as the prose it is.</p>`,
      ),
    );
    const forged = blockStarting(blocks, "This paragraph is ordinary");
    expect(forged.context).toBeUndefined();
    expect(forged.kind).toBe("text");
    expect(forged.html).not.toContain("data-spya-callout");
  });

  it("does not let a page forge the stamp from inside a template", async () => {
    // A DOM query does not enter a <template>'s fragment, which is how a stamp
    // survived two scrubs once already — src/blocks.ts § scrubStamps.
    const blocks = await blocksFor(
      page(
        `<template><p data-spya-callout="">Hidden.</p></template>` +
          `<p>An ordinary paragraph that follows the template and is long enough to be scored as ` +
          `the prose that it is, rather than dropped.</p>`,
      ),
    );
    expect(blocks.every((b) => !b.html.includes("data-spya-callout"))).toBe(true);
  });
});
