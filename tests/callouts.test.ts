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
 * The pages here are synthetic rather than fixtures, and **that used to be the
 * whole story and is not any more.** This header said *not one of the sixteen
 * extraction fixtures produces a callout block*; it was true when written and
 * stopped being true when `mkdocs_tabs.html` arrived, which produces **8 callout
 * blocks in 2 contexts** and did so before anything in this file was touched.
 * Corrected 2026-09-07 while measuring C5 — the claim was standing unread, which
 * is the class of defect § C0.1 was written about.
 *
 * What remains true is the limitation behind it: rfc9110's 32 editorial
 * `<aside>`s and gwern's 3 admonitions are thrown out by Readability before
 * stage 3 sees them, so those two shapes have no fixture evidence at all. The
 * two that do are `mkdocs_tabs` and, since C5, `archwiki_install` — 13 boxes,
 * 9 contexts, 17 blocks, asserted at the bottom of this file. Off the corpus,
 * the article this was built for: docs/plans/260831ae-callouts-the-box-the-author-drew.md § Measured.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { canonicaliseCallouts, type CalloutStats } from "../src/callouts.js";
import { runExtract } from "../src/extract.js";
import { splitIntoBlocks } from "../src/blocks.js";
import type { Block } from "../src/types.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "../evals/extraction/fixtures");

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

  it("does not let the guard overrule a Docusaurus admonition either", () => {
    /* **Found 2026-09-07 while adding ArchWiki, and it was live.**
       `theme-admonition` was in `CONTAINER_SELECTOR` and had no branch in
       `shapeOf`, so it fell through to `"aside"` — the one shape the call site
       runs `isNavigation` over. A declared admonition of a single link was
       skipped, which is precisely what the case below says must not happen, and
       every Docusaurus box was counted as an aside in the stats. No fixture
       carries the class, so nothing on the corpus moved either way; this is here
       so the branch cannot be removed by tidying. */
    const { stats } = stamped(
      '<div class="theme-admonition theme-admonition-warning alert alert--warning">' +
        '<p><a href="/docs/upgrade">Read the upgrade guide before you start</a></p></div>',
    );
    expect(stats.containers).toBe(1);
    expect(stats.skipped).toBe(0);
    expect(stats.shapes.admonition).toBe(1);
    expect(stats.shapes.aside).toBe(0);
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

/**
 * **ArchWiki's `Template:Note`, and it is the first shape in this file asserted
 * end to end on a committed page.**
 *
 * Every case above is synthetic, for the reason the header gives — and the
 * evidence that any of this works on a real article lived in one Substack post
 * outside the repo. ArchWiki's box survives Readability, so the ladder can be
 * run here: source candidates, accepted matches, stamps, survivors, affected
 * blocks, changed assertion, and a counterfactual, all on bytes somebody
 * actually served.
 *
 * The shape is its own argument for why the selector is a class and never a
 * word. The label is a **`<strong>` first child** —
 * `<div class="archwiki-template-box archwiki-template-box-note"><strong>Note</strong> …</div>`
 * — so there is no `admonition-title` element to find, and the only thing that
 * *reads* like a signal is the visible word. `acx.html` is in the negatives
 * below as the standing proof that reading it is not allowed.
 */
describe("ArchWiki's template box", () => {
  it("classifies a note box whose label is a bare <strong>", async () => {
    const blocks = await blocksFor(
      page(
        `<div class="archwiki-template-box archwiki-template-box-note"><strong>Note</strong> ` +
          `Arch Linux installation images do not support Secure Boot, so you will need to disable ` +
          `it before booting the installation medium and may re-enable it afterwards.</div>`,
      ),
    );
    const box = blockStarting(blocks, "Note");
    expect(box.context?.type).toBe("callout");
    expect(box.kind).toBe("text");
  });

  it("puts the surviving boxes of the real Arch install guide into contexts", async () => {
    /* **The counterfactual is inside the test**, because "13 containers" is a
       number a recogniser that stamped nothing downstream would also report:
       what is asserted is a box's *body text reaching a block that carries a
       context*, which is the only part of this a reader can see. */
    const html = await readFile(path.join(FIXTURES, "archwiki_install.html"), "utf-8");
    const url = "https://wiki.archlinux.org/title/Installation_guide";
    const source = new JSDOM(html, { url }).window.document;
    const boxes = Array.from(source.querySelectorAll('[class~="archwiki-template-box"]'));
    const severity = (suffix: string) =>
      boxes.filter((b) => b.classList.contains(`archwiki-template-box-${suffix}`)).length;
    // 1. source candidates — the top of the ladder, and the spread the wiki writes
    expect(boxes).toHaveLength(13);
    expect([severity("note"), severity("tip"), severity("warning")]).toEqual([7, 5, 1]);

    // 2. accepted matches
    const extracted = await runExtract({ html, url, slug: "archwiki-install" });
    expect(extracted.callouts.containers).toBe(13);
    expect(extracted.callouts.skipped).toBe(0);
    expect(extracted.callouts.shapes.archwiki).toBe(13);

    /* 3. **DOM mutations and stamps, and 4. what survives Readability** — the
       two middle rungs, pinned because without them the ladder is only its
       endpoints: a change from 109 stamps to 17, or from 78 survivors to some
       other number that still lands 17 blocks, would otherwise stay green. GPT
       Sol, 2026-09-07. */
    expect(extracted.callouts.stamped).toBe(109);
    const outDoc = new JSDOM(extracted.extractedHtml).window.document;
    expect(outDoc.querySelectorAll("[data-spya-callout]")).toHaveLength(78);

    // 5. affected blocks
    const { blocks } = splitIntoBlocks(extracted.extractedHtml);
    const inContext = blocks.filter((b) => b.context !== undefined);
    expect(inContext).toHaveLength(17); // affected blocks
    expect(new Set(inContext.map((b) => b.context?.id)).size).toBe(9);

    /* **The changed assertion, and it is measured on block text rather than on
       the output DOM.** `textContent` moves under this feature — `wrapLooseRuns`
       inserts a `<p>` and the whitespace around the label changes with it — so a
       substring test against the serialised page reports four boxes arriving
       that were already there. Block text is whitespace-normalised and does not
       move, and the label is dropped from the needle because a label survives on
       its own even where its body does not.

       **Ten of the thirteen reach a block and nine of those get the context.**
       Readability drops boxes 4, 5 and 12 entirely and the stamp does not rescue
       them — measured, and the answer to whether it would was not known in
       advance. Box 3 survives without a context because it sits inside a `<li>`
       that stage 3 emits as one block: `contextFor` asks `closest`, which reads
       a block's ancestors and never what is inside it. */
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const contextText = norm(inContext.map((b) => b.text).join(" "));
    const allText = norm(blocks.map((b) => b.text).join(" "));
    const bodyOf = (box: Element) => {
      const clone = box.cloneNode(true) as Element;
      clone.querySelector(":scope > strong")?.remove();
      return norm(clone.textContent ?? "");
    };
    const survived = boxes.filter((b) => allText.includes(bodyOf(b)));
    const inABox = boxes.filter((b) => contextText.includes(bodyOf(b)));
    expect(survived).toHaveLength(10);
    expect(inABox).toHaveLength(9);
  });

  it("adds a context to seventeen blocks of the Arch guide, and moves four spaces", async () => {
    /* **The counterfactual, run in the suite rather than by hand.** The control
       is the same page with the class token misspelt, so the selector misses it
       and every other input to Readability's scoring — length, tag structure,
       link density, the class *weight* regexes, which match neither spelling —
       is what it was. If the recogniser ever moved a block boundary, split a
       list or re-minted an id, this is where it says so, and it says it on a
       real page rather than on eight paragraphs of filler.

       **The title says "four spaces" because the first draft said "changes
       nothing else" and that was false**, which GPT Sol caught by comparing the
       fields this test was not comparing. `wrapLooseRuns` pulls the whitespace
       text node between `<strong>Note</strong>` and the sibling `<ul>` into the
       `<p>` it builds, so four blocks' `html` gains a trailing `" \n"`. It
       renders identically, `text` is whitespace-normalised so no id moves, and
       `hashBlocks` does not fingerprint `html` — but it is a difference, and an
       overclaim in a counterfactual is the one thing a counterfactual may not
       have. So it is asserted rather than described. */
    const html = await readFile(path.join(FIXTURES, "archwiki_install.html"), "utf-8");
    const url = "https://wiki.archlinux.org/title/Installation_guide";
    const off = html.replace(/archwiki-template-box/g, "archwiki-tmplate-box");
    const extract = async (source: string) =>
      (await runExtract({ html: source, url, slug: "archwiki-install" })).extractedHtml;

    const offHtml = await extract(off);
    const onHtml = await extract(html);
    const before = splitIntoBlocks(offHtml).blocks;
    /* Ids carried from the control run, so `html` can be compared at all: a
       fresh mint puts a different id in every block's markup. That it carries
       221 of 221 is itself the assertion a reader cares about — somebody who
       imported this page before the adapter and re-imports it after keeps every
       annotation. */
    const after = splitIntoBlocks(onHtml, before).blocks;
    expect(after.map((b) => b.id)).toEqual(before.map((b) => b.id));

    const shape = (bs: Block[]) =>
      bs.map((b) => `${b.tag}|${b.kind}|${b.level ?? ""}|${b.words}|${b.gistable}|${b.note ?? ""}|${b.text}`);
    expect(shape(after)).toEqual(shape(before));
    expect(before.filter((b) => b.context !== undefined)).toHaveLength(0);
    expect(after.filter((b) => b.context !== undefined)).toHaveLength(17);

    /* Every `html` difference, and there are four: the label paragraph of each
       of the four boxes whose `<strong>` sits before a sibling `<ul>`. */
    const movedHtml = before
      .map((b, i) => [b.html, after[i]?.html] as const)
      .filter(([a, b]) => a !== b);
    expect(movedHtml).toHaveLength(4);
    for (const [was, now] of movedHtml) {
      // Whitespace and nothing else — every non-space character is where it was.
      expect(now?.replace(/\s+/g, "")).toBe(was?.replace(/\s+/g, ""));
      // And in each case it is the label paragraph, not some other block.
      expect(was).toMatch(/<strong>(Note|Tip)<\/strong>/);
    }
  });

  /* ------------------------------------------ the adversarial set, such as it is */

  /**
   * **Written before the recogniser existed and watched to fail** — but C0's
   * adversary rule says a *different agent* writes the negative, and one agent
   * cannot satisfy that however it orders its own work. So this is a substitute,
   * and it is named as one rather than claimed as compliance: the cases went in
   * first and were run red, six of them, before the selector existed.
   *
   * **Only the first is a negative.** GPT Sol counted, 2026-09-07: `acx.html` is
   * a true word-based negative; the emphasis case is a positive plus a negative
   * against splitting; the nesting case tests de-duplication; and the
   * whole-section case is positive recognition with structure preserved. A real
   * adversarial set for this recogniser is still owed, and its author must not
   * be whoever wrote `CONTAINER_SELECTOR`.
   *
   * **It was written on 2026-09-07** — "attacks on the ArchWiki recogniser", the
   * last describe in this file, by a second agent that did not touch
   * src/callouts.ts. It found the recogniser sound and `wrapLooseRuns` not
   * quite, and it found that the negative below proves less than this comment
   * claims for it. Both are recorded there rather than restated here.
   */
  it("stamps nothing on acx.html, which says 'Note' six times in ordinary prose", async () => {
    /* The free adversary this repo already keeps: 133k characters of real essay
       carrying none of this markup. A selector that ever read the visible word
       reddens here rather than in review.

       Six case-sensitive occurrences of `Note` and — measured, because the first
       version of this name claimed otherwise — **zero of `Tip`**. GPT Sol,
       2026-09-07. The count is asserted so that swapping the fixture for one
       without the word would not leave a negative that proves nothing. */
    const html = await readFile(path.join(FIXTURES, "acx.html"), "utf-8");
    const doc = new JSDOM(html, { url: "https://www.astralcodexten.com/" }).window.document;
    expect((doc.body.textContent ?? "").match(/\bNote\b/g)).toHaveLength(6);
    expect(doc.querySelector('[class~="archwiki-template-box"]')).toBeNull();
    expect(canonicaliseCallouts(doc).shapes.archwiki).toBe(0);
  });

  it("does not read the <strong> as a label when it is the author's own emphasis", async () => {
    /* The box is still a box — the class says so, and a heuristic may not
       overrule a declaration (src/callouts.ts § isNavigation). What must not
       happen is the leading `<strong>` being taken for a detached label and cut
       off from the sentence it is part of: one block, whole sentence. */
    const blocks = await blocksFor(
      page(
        `<div class="archwiki-template-box archwiki-template-box-warning"><strong>Never</strong> ` +
          `run this against a disk that still holds a partition table you care about, because ` +
          `nothing in the tooling will ask you a second time.</div>`,
      ),
    );
    const box = blockStarting(blocks, "Never run this");
    expect(box.context?.type).toBe("callout");
    expect(box.text).toContain("a second time");
    expect(blocks.filter((b) => b.text === "Never")).toHaveLength(0);
  });

  it("counts an ArchWiki box inside another callout once", () => {
    const dom = new JSDOM(
      `<!doctype html><html><body><div class="callout">` +
        `<div class="archwiki-template-box archwiki-template-box-tip"><strong>Tip</strong> ` +
        `A box the wiki wrapped inside a box the theme wrapped.</div></div></body></html>`,
    );
    const stats = canonicaliseCallouts(dom.window.document);
    expect(stats.containers).toBe(1);
    expect(stats.shapes.callout).toBe(1);
    expect(stats.shapes.archwiki).toBe(0);
    const ids = new Set(
      Array.from(dom.window.document.querySelectorAll("[data-spya-callout]")).map((el) =>
        el.getAttribute("data-spya-callout"),
      ),
    );
    expect(ids.size).toBe(1); // one box, one context — not two nested ones
  });

  it("does not break a section the box was wrapped round by mistake", async () => {
    /* The adversary that asks whether this recogniser has a size limit. It does
       not, deliberately and like every other entry in `CONTAINER_SELECTOR`: a
       publisher saying "this is a box" is honoured whatever is inside it. What
       is asserted is that being in a box costs nothing — the headings are still
       headings at their own levels, which is what the granularity tree is built
       from, and every block of the section shares one context. */
    const blocks = await blocksFor(
      page(
        `<div class="archwiki-template-box"><h2>Pre-installation</h2>` +
          `<p>Consult the article on preparing the installation medium, which covers verifying ` +
          `the signature and writing the image to a USB stick before you begin.</p>` +
          `<h3>Verify signature</h3>` +
          `<p>It is generally recommended to verify the image signature before use, especially ` +
          `when downloading from an HTTP mirror rather than from the project itself.</p></div>`,
      ),
    );
    const h2 = blockStarting(blocks, "Pre-installation");
    const h3 = blockStarting(blocks, "Verify signature");
    expect(h2.kind).toBe("heading");
    expect(h2.level).toBe(2);
    expect(h3.kind).toBe("heading");
    expect(h3.level).toBe(3);
    const ids = new Set(blocks.filter((b) => b.context).map((b) => b.context?.id));
    expect(ids.size).toBe(1);
    expect(blockStarting(blocks, "Consult the article").context?.id).toBe(h2.context?.id);
  });
});

/**
 * **The adversarial set for `[class~="archwiki-template-box"]`, written by a
 * different agent** — docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md
 * § C0, which says the negative fixture for a recogniser may not be written by
 * whoever wrote the recogniser. The block above says as much about itself and
 * asks for this one; this is it.
 *
 * The two rules under test are the plan's, not this file's:
 *
 * 1. **Recognition is on markup, never on meaning or the visible words.**
 * 2. **Restricting an element by where it sits proves nothing about what it is
 *    for** — so the question asked of every case here is what the publisher
 *    writes that markup *for*, and the answers come from ArchWiki's own
 *    stylesheet rather than from what looks plausible.
 *
 * That stylesheet is the evidence for most of what follows.
 * `https://wiki.archlinux.org/index.php?title=MediaWiki:Common.css&action=raw`,
 * read 2026-09-07, gives the wiki four kinds of box and one class each:
 *
 * - `div.archwiki-template-box` — the authored aside, in four severities:
 *   `-note`, `-tip`, `-warning` and **`-highlight`**, which no fixture carries.
 * - `.archwiki-template-navigation` — "Navigation templates", the wiki's chrome.
 * - `div.archwiki-template-message` — "Status templates", the maintenance banner
 *   an *editor* writes *about* the article ("this page is out of date"), which is
 *   not the author speaking to the reader at all.
 * - `div.archwiki-template-meta-related-articles` — the see-also rail.
 *
 * The three that are not the author's aside share a prefix with the one that is
 * and share no *token* with it, so the whole defence is that `~=` matches tokens.
 * Every case below is either an attempt to get past that or an attempt to make
 * the stamp do damage once it is through.
 */
describe("attacks on the ArchWiki recogniser", () => {
  function stamped(body: string): { stats: CalloutStats; doc: Document } {
    const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`);
    const stats = canonicaliseCallouts(dom.window.document);
    return { stats, doc: dom.window.document };
  }

  /** Every distinct value of the stamp in the document, container and insides alike. */
  function contextIds(doc: Document): Set<string | null> {
    return new Set(
      Array.from(doc.querySelectorAll("[data-spya-callout]")).map((el) =>
        el.getAttribute("data-spya-callout"),
      ),
    );
  }

  it("does not match a class token that merely contains the string", () => {
    /* **The `~=` versus `*=` case, stated as an assertion rather than as a
       comment on the selector.** Each of these carries the recogniser's string
       and none of them is its token. Widen `CONTAINER_SELECTOR` to `*=` and the
       first four match; the fifth needs no defence beyond the spec, since
       attribute-value matching is case-sensitive either way. Watched red under
       four separate mutations, 2026-09-07. */
    for (const cls of [
      "not-archwiki-template-box", // a token that ends with it
      "archwiki-template-boxed", // a token that starts with it
      "wrapper-archwiki-template-box-inner", // it, buried mid-token
      "archwiki-template-box-note", // the severity without the box: the CSS requires both
      "ARCHWIKI-TEMPLATE-BOX", // class matching is case-sensitive outside quirks mode
    ]) {
      const { stats, doc } = stamped(
        `<div class="${cls}"><strong>Note</strong> Body text that reads exactly like a box.</div>`,
      );
      expect([cls, stats.containers, stats.skipped]).toEqual([cls, 0, 0]);
      expect(doc.querySelector("[data-spya-callout]")).toBeNull();
    }
  });

  it("matches the token however the class attribute is spaced", () => {
    // The other side of the same coin: token matching must not be defeated by
    // the whitespace a template engine happens to emit.
    for (const attr of [
      'class="  archwiki-template-box   archwiki-template-box-note  "',
      'class="archwiki-template-box\narchwiki-template-box-note"',
      "class=archwiki-template-box",
    ]) {
      const { stats } = stamped(`<div ${attr}><strong>Note</strong> Body text.</div>`);
      expect([attr, stats.shapes.archwiki]).toEqual([attr, 1]);
    }
  });

  it("leaves ArchWiki's navigation, status and see-also boxes alone", () => {
    /* **The "what is this markup *for*" case**, and the reason it is worth having
       is that all four of these are `div`s the wiki draws a border round, in the
       same stylesheet, one line apart. Only the first is the author speaking to
       the reader; `-message` in particular is a *maintenance banner about the
       article*, written by an editor, and setting it as an authored aside would
       be the app putting words in the author's mouth. */
    const box = stamped('<div class="archwiki-template-box archwiki-template-box-note"><strong>Note</strong> The author, speaking.</div>');
    expect(box.stats.shapes.archwiki).toBe(1);

    for (const cls of [
      "archwiki-template-navigation",
      "archwiki-template-message",
      "archwiki-template-meta-related-articles",
    ]) {
      const { stats, doc } = stamped(
        `<div class="${cls}"><p>This article or section is out of date. Reason: the boot ` +
          `loader section no longer matches the current release.</p></div>`,
      );
      expect([cls, stats.containers, stats.skipped]).toEqual([cls, 0, 0]);
      expect(doc.querySelector("[data-spya-callout]")).toBeNull();
    }
  });

  it("leaves the sibling-classed spans of the real Arch guide alone", async () => {
    /* The same attack on bytes somebody served rather than on markup this file
       invented. `archwiki_install.html` carries 45 elements whose class contains
       `archwiki-template`; 13 are the boxes and the other 32 are inline
       `<span class="plainlinks archwiki-template-man">` wrappers round a link to
       a man page — a footnote-sized fragment of a sentence, and never a box.

       **Twenty-five of them sit outside every box**, so under a substring
       selector they would each become a container of their own: a link and
       nothing else, which `shapeOf` cannot name, which falls through to `"aside"`
       and gets thrown out by the link-density guard. `skipped` would go from 0 to
       25 and the reader would see no difference at all — which is exactly the
       kind of silent wrong the ladder in the test above cannot see, because every
       number in it is about the boxes. So it is asserted here instead. */
    const html = await readFile(path.join(FIXTURES, "archwiki_install.html"), "utf-8");
    const doc = new JSDOM(html, { url: "https://wiki.archlinux.org/title/Installation_guide" }).window.document;
    const prefixed = Array.from(doc.querySelectorAll('[class*="archwiki-template"]'));
    const siblings = prefixed.filter((el) => !el.classList.contains("archwiki-template-box"));
    const outside = siblings.filter((el) => el.closest('[class~="archwiki-template-box"]') === null);
    expect([prefixed.length, siblings.length, outside.length]).toEqual([45, 32, 25]);
    expect(new Set(siblings.map((el) => el.className))).toEqual(
      new Set(["plainlinks archwiki-template-man", "plainlinks archwiki-template-pkg"]),
    );

    const stats = canonicaliseCallouts(doc);
    expect(stats.containers).toBe(13);
    expect(stats.skipped).toBe(0); // nothing was matched and then thrown away
    // Not one of the 25 is stamped at all — not as a container, not as an inside.
    expect(outside.filter((el) => el.hasAttribute("data-spya-callout"))).toHaveLength(0);
  });

  it("recognises a severity the corpus does not contain", () => {
    /* The bare token is chosen over the three suffixed ones so that a box type
       the wiki adds later is recognised rather than silently missed, and the
       stylesheet already has a fourth — `archwiki-template-box-highlight` — that
       no fixture carries. Evidence for the choice rather than an argument for it. */
    const { stats } = stamped(
      '<div class="archwiki-template-box archwiki-template-box-highlight"><strong>Highlight</strong> ' +
        "A severity that exists in ArchWiki's stylesheet and in none of the sixteen fixtures.</div>",
    );
    expect(stats.shapes.archwiki).toBe(1);
  });

  it("stamps nothing anywhere in acx.html, not merely nothing ArchWiki-shaped", async () => {
    /* The standing negative, tightened. The case above asserts
       `shapes.archwiki === 0`, which a recogniser that had started reading the
       word "Note" and filing it under some *other* shape would also satisfy. What
       is asserted here is that 133k characters of essay produce no context of any
       kind and no stamp anywhere in the document — and the word counts are
       asserted with it, so swapping the fixture for one that never says "Note"
       would redden rather than quietly leave a negative that proves nothing. */
    const html = await readFile(path.join(FIXTURES, "acx.html"), "utf-8");
    const doc = new JSDOM(html, { url: "https://www.astralcodexten.com/" }).window.document;
    const text = doc.body.textContent ?? "";
    expect((text.match(/\bNote\b/g) ?? []).length).toBe(6);
    expect((text.match(/\b(Tip|Warning|Caution)\b/g) ?? []).length).toBe(0);
    const stats = canonicaliseCallouts(doc);
    expect(stats).toEqual({
      containers: 0,
      stamped: 0,
      skipped: 0,
      shapes: { callout: 0, admonition: 0, archwiki: 0, pullquote: 0, aside: 0 },
    });
    expect(doc.querySelector("[data-spya-callout]")).toBeNull();
    /* **And here is what acx cannot prove**, measured 2026-09-07 rather than
       assumed: not one element in those 133k characters has text *beginning*
       with Note, Tip or Warning, and not one has a leading `<strong>` label. Its
       six "Note"s are all mid-sentence. So a recogniser keying on the word
       anywhere reddens here — and a recogniser keying on the *label*, which is
       the shortcut ArchWiki's own markup invites and therefore the one anybody
       would actually reach for, sails straight past. The next case is the
       negative acx cannot be. */
    const els = Array.from(doc.body.querySelectorAll("*"));
    expect(els.filter((e) => /^\s*(Note|Tip|Warning)\b/.test(e.textContent ?? ""))).toHaveLength(0);
  });

  it("stamps nothing on real pages that write ArchWiki's label without its markup", async () => {
    /* **The standing negative the plan actually needs.** § C0 calls `acx.html` the
       proof that a word is not a selector; the case above shows it only half is,
       because acx never puts the word where ArchWiki puts it. What is needed is a
       real page carrying the *shape* — a paragraph whose first child is
       `<strong>Note</strong>` — and not carrying the class. The corpus has two,
       and neither was being read as a negative.

       **MDN, as served**: fifteen elements whose text begins with Note, Tip or
       Warning, three of them with the leading `<strong>` label, nought callout
       containers of any shape. */
    const mdn = await readFile(path.join(FIXTURES, "mdn_cache.html"), "utf-8");
    const mdnDoc = new JSDOM(mdn, { url: "https://developer.mozilla.org/" }).window.document;
    const labelled = (d: Document) =>
      Array.from(d.body.querySelectorAll("p, div, blockquote, li, aside, td, dd")).filter((el) => {
        const first = el.firstElementChild;
        return first?.tagName === "STRONG" && /^(Note|Tip|Warning)\b/.test((first.textContent ?? "").trim());
      });
    expect(labelled(mdnDoc).length).toBe(3);
    expect(canonicaliseCallouts(mdnDoc).containers).toBe(0);

    /* **RFC 9110, with its markup taken away and every label left standing.**
       Thirty-two of its editorial asides are written exactly as ArchWiki writes a
       box — `<aside><p><strong>Note:</strong> …</p></aside>` — so renaming the
       tag to a bare `<div>` produces a page that still *says* Note thirty-two
       times in the right place and no longer says anything in markup. The
       recogniser must go completely silent, and the count of labels is asserted
       alongside so that a rename which also ate the labels could not pass. */
    const rfc = await readFile(path.join(FIXTURES, "rfc9110.html"), "utf-8");
    const url = "https://www.rfc-editor.org/rfc/rfc9110.html";
    const asMarkup = new JSDOM(rfc, { url }).window.document;
    expect(canonicaliseCallouts(asMarkup).shapes.aside).toBe(32); // recognised by the tag
    const stripped = rfc.replace(/<aside\b/g, "<div").replace(/<\/aside>/g, "</div>");
    const asWords = new JSDOM(stripped, { url }).window.document;
    expect(labelled(asWords).length).toBe(32); // the words are all still there
    expect(canonicaliseCallouts(asWords)).toEqual({
      containers: 0,
      stamped: 0,
      skipped: 0,
      shapes: { callout: 0, admonition: 0, archwiki: 0, pullquote: 0, aside: 0 },
    });
    expect(asWords.querySelector("[data-spya-callout]")).toBeNull();
  });

  it("splits a loose run at an HTML comment exactly where Readability would", async () => {
    /* **`wrapLooseRuns` ends a run at anything that is not text or phrasing, and
       a comment node is neither** — so `Words before <!-- … --> words after`
       becomes two paragraphs where the source had one sentence, and MediaWiki
       emits comments inside its templates. That is a block boundary the reader
       can see, which is what this case was written to catch.

       It does not catch it, and the reason is the point: Readability's own
       `_grabArticle` gathers the phrasing children of a `<div>` into `<p>`s with
       the same rule and the same exception, so the split happens with the class
       and without it. The file's claim that the wrapping "is what Readability
       would have done anyway" holds for comments too. Kept as the negative
       control it turned out to be — delete the `PHRASING` test from
       `wrapLooseRuns` and this stays green, but bend the *run* rule and it moves. */
    const inner =
      `<strong>Note</strong> Words before the editorial comment ` +
      `<!-- FIXME: check this against the current release --> and words after it, which in the ` +
      `source is one single sentence of ordinary prose.`;
    const withBox = await blocksFor(page(`<div class="archwiki-template-box archwiki-template-box-note">${inner}</div>`));
    const without = await blocksFor(page(`<div>${inner}</div>`));
    const shape = (bs: Block[]) => bs.map((b) => `${b.tag}|${b.kind}|${b.words}|${b.text}`);
    expect(shape(withBox)).toEqual(shape(without));
    // And the box is genuinely there, so this is not vacuously green.
    expect(new Set(withBox.filter((b) => b.context).map((b) => b.context?.id)).size).toBe(1);
  });

  it("stamps a box of nothing but links, because a declaration outranks a guard", () => {
    /* **`isNavigation` does not run on this shape** — the call site asks it only
       of `<aside>`, and an ArchWiki box is a publisher saying "this is a box".
       So a box whose text is entirely links is stamped, and an `<aside>` wrapped
       round a `<nav>` walks past the guard the moment the class is added.

       That is exposure by design and not by accident, and the reason it is safe
       is the taxonomy above rather than the guard: what ArchWiki actually writes
       its navigation with is `archwiki-template-navigation`, asserted two cases
       up. If the wiki ever puts `archwiki-template-box` on chrome, this test is
       the record of what the recogniser will then do. */
    const links = stamped(
      '<div class="archwiki-template-box"><p><a href="/a">Related one</a> · ' +
        '<a href="/b">Related two</a> · <a href="/c">Related three</a></p></div>',
    );
    expect([links.stats.containers, links.stats.skipped]).toEqual([1, 0]);
    const nav = stamped('<aside class="archwiki-template-box"><nav><p>On this page.</p></nav></aside>');
    expect([nav.stats.shapes.archwiki, nav.stats.skipped]).toEqual([1, 0]);
  });

  it("still recognises a box inside an aside the guard threw away", () => {
    /* The other direction of the same seam, and the one that would have been a
       real loss: the outer `<aside>` is rejected as navigation, so it is never
       stamped, so the nesting check has nothing to find and the genuine box
       inside it is recognised on its own. A rejection must not swallow what it
       contains. */
    const { stats, doc } = stamped(
      "<aside><nav><p>Sections of this page.</p></nav>" +
        '<div class="archwiki-template-box archwiki-template-box-warning"><strong>Warning</strong> ' +
        "A real box the theme happened to put inside its own chrome.</div></aside>",
    );
    expect([stats.containers, stats.skipped, stats.shapes.archwiki]).toEqual([1, 1, 1]);
    expect(contextIds(doc).size).toBe(1);
    expect(doc.querySelector("aside")?.hasAttribute("data-spya-callout")).toBe(false);
  });

  it("counts a callout inside an ArchWiki box once, and a box inside a box once", () => {
    /* The nesting case above this block runs one direction — ArchWiki inside a
       theme's `.callout`. Both of the others are here, because a context nesting
       inside itself is the failure to look for and only one arrangement of three
       was being checked. */
    const inner = stamped(
      '<div class="archwiki-template-box archwiki-template-box-note"><strong>Note</strong> Outer.' +
        '<div class="callout"><p>A theme box the wiki text put inside a template box.</p></div></div>',
    );
    expect([inner.stats.containers, inner.stats.shapes.archwiki, inner.stats.shapes.callout]).toEqual([1, 1, 0]);
    expect(contextIds(inner.doc).size).toBe(1);

    const same = stamped(
      '<div class="archwiki-template-box archwiki-template-box-note"><strong>Note</strong> Outer.' +
        '<div class="archwiki-template-box archwiki-template-box-tip"><strong>Tip</strong> Inner.</div></div>',
    );
    expect([same.stats.containers, same.stats.shapes.archwiki]).toEqual([1, 1]);
    expect(contextIds(same.doc).size).toBe(1);
  });

  it("gives two boxes with identical words two contexts", () => {
    // `mintContextId` hashes the container's text, so the same box twice would
    // silently be one context without the `taken` set.
    const { stats, doc } = stamped(
      '<div class="archwiki-template-box"><strong>Note</strong> Identical body text.</div>' +
        '<div class="archwiki-template-box"><strong>Note</strong> Identical body text.</div>',
    );
    expect(stats.containers).toBe(2);
    expect(contextIds(doc).size).toBe(2);
  });

  it("does not reach a box inside a template, or the html and body elements", () => {
    const inTemplate = stamped(
      '<template><div class="archwiki-template-box"><strong>Note</strong> Hidden.</div></template>' +
        "<p>Ordinary prose.</p>",
    );
    expect(inTemplate.stats.containers).toBe(0);

    /* The query is rooted at `doc.body`, which cannot match itself — so a page
       that puts the token on its own `<body>` does not box the whole article. */
    const dom = new JSDOM(
      '<!doctype html><html class="archwiki-template-box"><body class="archwiki-template-box">' +
        "<p>Ordinary prose.</p></body></html>",
    );
    const stats = canonicaliseCallouts(dom.window.document);
    expect(stats.containers).toBe(0);
    expect(dom.window.document.querySelector("[data-spya-callout]")).toBeNull();
  });

  /**
   * **A defect, and it is not ArchWiki's.** Reported rather than fixed —
   * adversary's rules, 2026-09-07.
   *
   * `wrapLooseRuns` builds a `<p>` and puts it *inside* the container. When the
   * container is itself a `<p>`, that is a `<p>` inside a `<p>`: legal to build
   * in a DOM, impossible to parse back. Stage 2 serialises and stage 3 reparses,
   * the parser closes the outer paragraph at the inner one, and one paragraph
   * arrives as three blocks — the real one with an **empty block on either side**,
   * the first of them carrying the callout context.
   *
   * The suite already forbids exactly this: "does not sweep a list into a
   * paragraph of its own making" asserts `withBox.some((b) => b.text === "")` is
   * false. It is true here.
   *
   * **`archwiki-template-box` cannot reach it** — ArchWiki's stylesheet says
   * `div.archwiki-template-box`, and all 13 boxes in the fixture are `div`s. What
   * reaches it is `[class~="pullquote"]` and `[class~="callout"]`, both of which
   * a CMS writes on a `<p>` as a matter of course, and both of which have been in
   * `CONTAINER_SELECTOR` since 2026-08-31. So this is a pre-existing hole that
   * the new entry sits next to rather than one it opened.
   *
   * **Fixed 2026-09-07, in the pass that found it.** `wrapLooseRuns` now returns
   * immediately for a container that cannot hold a paragraph — it is already a
   * block element and `canonicaliseCallouts` has already stamped it, so nothing
   * is lost by building nothing. The adversary left this as `it.fails` plus a
   * test measuring the two empty blocks; the fix turned the first green and the
   * second red, and the second is gone.
   */
  /**
   * **GPT Sol, P1-01, 2026-09-07 — the negative rfc9110 does *not* cover.**
   *
   * rfc9110 and mdn_cache kill a rule matching a leading `<strong>Note</strong>`
   * *anywhere*, because their 35 labels sit in exactly that position. They do
   * not kill the narrower rule Sol named: **an unclassed `<div>` whose direct
   * first child is the label** — which is ArchWiki's own placement (13 of them)
   * and matches nothing in rfc9110 or mdn_cache, where every label is inside a
   * `<p>` inside an `<aside>`.
   *
   * Measured across all 39 fixtures: **no page has that shape unclassed**, so
   * unlike the rfc9110 case there is no real page to point at and this one is
   * synthetic and says so. A synthetic negative is the weaker kind and it is
   * still the difference between a rule nothing can falsify and one something
   * can. If a real page with this shape ever enters the corpus, replace this.
   */
  it("stays silent on an unclassed <div> whose first child is a <strong> label", async () => {
    const body =
      `<div><strong>Note</strong> An ordinary aside a writer typed by hand, with no class on it ` +
      `at all, which is the shape a leading-label rule would claim and the class rule must not.</div>`;
    const blocks = await blocksFor(page(body));
    expect(blocks.some((b) => b.context !== undefined)).toBe(false);
    /* And the words are still there — silence, not deletion. */
    expect(blocks.some((b) => b.text.includes("An ordinary aside a writer typed"))).toBe(true);
  });

  /**
   * **GPT Sol, P0-01, 2026-09-07.** The first fix guarded on `PHRASING`, which
   * answers *can this element join a phrasing run* and not *can this element
   * contain a paragraph*. Those are different questions and the second is the
   * one this code is asking. `<summary>`, `<legend>`, `<pre>` and every heading
   * take phrasing content only, are not in `PHRASING`, and can carry a class —
   * so `CONTAINER_SELECTOR`'s attribute arms reach them.
   *
   * The cost is not cosmetic. `<summary class="callout">` and
   * `<legend class="callout">` came back out of the round trip as `p` blocks
   * with **reminted ids**, and block ids are the one contract this whole
   * codebase rests on (docs/project/block-ids.md). `<h2>` and `<pre>` keep their
   * ids and reach stored block HTML as `<h2><p>…</p></h2>`, which is invalid.
   */
  for (const tag of ["summary", "legend", "h2", "pre"] as const) {
    it(`does not build a paragraph inside <${tag}>, which cannot hold one`, async () => {
      const inner = "A box a CMS put its class on, in an element that takes phrasing content only.";
      /* `<summary>` and `<legend>` are only valid inside their own parents, so
         the fixture gives them one — otherwise the parser moves them and the
         test measures its own scaffolding rather than the code. */
      const wrap = (x: string) =>
        tag === "summary"
          ? `<details open>${x}<p>Body of the disclosure.</p></details>`
          : tag === "legend"
            ? `<fieldset>${x}<p>Body of the fieldset.</p></fieldset>`
            : x;
      const plain = await blocksFor(page(wrap(`<${tag}>${inner}</${tag}>`)));
      /* **`previous` matters and its absence would make this test meaningless.**
         A first extraction mints ids at random, so two independent runs differ
         whatever the code does. The question worth asking is the one a reader
         lives with: does putting the class on remint an id that already
         existed? */
      const boxed = await blocksFor(page(wrap(`<${tag} class="callout">${inner}</${tag}>`)), {
        previous: plain,
      });

      const mine = blockStarting(boxed, "A box a CMS put");
      const theirs = blockStarting(plain, "A box a CMS put");
      /* The tag survives: the callout class must not change what the element is. */
      expect(mine.tag).toBe(theirs.tag);
      /* No `<p>` was built inside it, so the stored html holds no nested one. */
      expect(mine.html).not.toMatch(/<p[\s>]/);
      /* And the id carries, which is the half that actually costs a reader —
         every note, highlight and scroll position is addressed by it. */
      expect(mine.id).toBe(theirs.id);
      /* The stamp is still on it — the guard returns early, it does not skip. */
      expect(mine.context?.type).toBe("callout");
    });
  }

  it("does not flank a <p> that is itself the callout with empty blocks", async () => {
    const inner =
      "A pull quote a CMS wrote as a paragraph with a class on it, which is a shape the corpus " +
      "does not carry and the selector accepts.";
    const without = await blocksFor(page(`<p>${inner}</p>`));
    const withBox = await blocksFor(page(`<p class="pullquote">${inner}</p>`), {
      previous: without,
    });
    expect(withBox.some((b) => b.text === "")).toBe(false);
    expect(withBox).toHaveLength(without.length);
    /* **Sol P2-01: the guard must return early, not skip.** Without this the
       test would pass just as happily if the fix had stopped stamping the
       container altogether — the empty blocks would be gone and so would the
       callout. */
    const mine = blockStarting(withBox, "A pull quote");
    expect(mine.context?.type).toBe("callout");
    expect(mine.id).toBe(blockStarting(without, "A pull quote").id);
  });

});
