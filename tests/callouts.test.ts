/**
 * Stage 2 recognises the boxes an author set apart from the prose, before
 * Readability throws the markup that says so away — src/callouts.ts, and
 * docs/plans/callout-blocks.md for the measurement this came from.
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
 * Substack callouts come through: docs/plans/callout-blocks.md § Measured.
 */

import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
  const dir = await mkdtemp(path.join(tmpdir(), "callouts-"));
  try {
    const outFile = path.join(dir, "page.html");
    await runExtract({ html, url: "https://example.test/page", outFile, dataDir: dir });
    let extracted = await readFile(outFile, "utf-8");
    if (opts.withoutCallouts) extracted = extracted.replaceAll(' data-spya-callout=""', "");
    return splitIntoBlocks(extracted, opts.previous).blocks;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
    expect(blockStarting(blocks, "Whoa!").kind).toBe("callout");
  });

  it("classifies an admonition, and keeps a heading inside one a heading", async () => {
    const blocks = await blocksFor(
      page(
        `<div class="admonition note"><h3>A note to the reader</h3>` +
          `<p>Attention is worth spending here, because the argument turns on it and the rest of ` +
          `the section assumes you have understood this paragraph.</p></div>`,
      ),
    );
    expect(blockStarting(blocks, "Attention is worth").kind).toBe("callout");
    // The tree is built from heading levels. A box around a heading does not
    // stop it being one.
    const heading = blockStarting(blocks, "A note to the reader");
    expect(heading.kind).toBe("heading");
    expect(heading.level).toBe(3);
  });

  it("leaves a blockquote inside a callout a quote", async () => {
    const blocks = await blocksFor(
      page(
        `<div class="callout"><blockquote><p>The quotation inside the box is still a quotation, ` +
          `and it is set as one, because a box around it changes who is speaking not at all.` +
          `</p></blockquote></div>`,
      ),
    );
    expect(blockStarting(blocks, "The quotation inside").kind).toBe("quote");
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
    expect(blockStarting(blocks, "Loose words").kind).toBe("callout");
  });

  it("classifies a callout whose only child is a span", async () => {
    const blocks = await blocksFor(
      page(
        `<div data-callout="true"><span>Inline content and nothing else, which stage 3 would ` +
          `never find by looking at a block's ancestors.</span></div>`,
      ),
    );
    expect(blockStarting(blocks, "Inline content").kind).toBe("callout");
  });

  it("classifies a Docusaurus admonition", async () => {
    const blocks = await blocksFor(
      page(
        `<div class="theme-admonition theme-admonition-warning alert alert--warning">` +
          `<p>Do not delete this token, because everything downstream of it assumes it is there ` +
          `and none of it will tell you when it is not.</p></div>`,
      ),
    );
    expect(blockStarting(blocks, "Do not delete").kind).toBe("callout");
  });

  it("keeps a unique callout gistable and takes it off a body-repeating one", async () => {
    const repeated =
      "The conspiracy began almost immediately after the evaluations were started, and it took " +
      "the shape nobody had planned for.";
    const blocks = await blocksFor(
      page(
        `<p>${repeated}</p>` +
          `<div class="callout"><p>${repeated}</p></div>` +
          `<div class="callout"><p>A sentence that is said exactly once in this article and ` +
          `therefore has something of its own to contribute.</p></div>`,
      ),
    );
    // The pull-quote rule, which now covers callouts — but only against *other*
    // blocks' text. It used to find each callout inside itself.
    expect(blockStarting(blocks, "A sentence that is said").gistable).toBe(true);
    const quoted = blocks.filter((b) => b.kind === "callout" && b.text.startsWith("The conspiracy"));
    expect(quoted).toHaveLength(1);
    expect(quoted[0]?.gistable).toBe(false);
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
    expect(was?.kind).toBe("text"); // the world before this feature
    expect(now?.kind).toBe("callout");
    expect(now?.id).toBe(was?.id);
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
    expect(blockStarting(blocks, "First paragraph of the box").kind).toBe("callout");
    expect(blockStarting(blocks, "Second paragraph of the box").kind).toBe("callout");
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
    expect(doc.querySelectorAll("[data-spya-callout]").length).toBe(2); // the aside and its <p>
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
