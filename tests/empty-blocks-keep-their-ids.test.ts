/**
 * Stage 3 — a block with nothing in it at all must still keep its id across a
 * re-extraction, and a block that merely *looks* empty must not.
 *
 * `exactKey` returned `null` for any block whose text was empty and whose html
 * held no `src`: an `<hr>`, an empty `<p>`, an empty `<li>`, a `<figure>` the
 * sanitiser left with no image in it. `bucketBy` drops a `null` key, so such a
 * block was in no bucket on **either** side of the match and re-minted on every
 * run over byte-identical input — 218 blocks across 17 of the 35 corpus
 * fixtures. docs/postmortems/260905a-empty-blocks-remint-their-ids-on-every-extraction.md.
 *
 * A reader can anchor a chat to any block by its id alone, with no selection
 * (`Chat.about` is `{ blockId }` in src/types.ts, and every block gets a
 * permalink and a chat button from `BlockGutter`), so this is not purely a
 * machine-facing problem — but the two machines are where the damage was:
 *
 *  - `hashBlocks` (src/source-hash.ts) hashes the id, so half the corpus
 *    reported a changed article after a re-extraction that changed no word,
 *    taking every derived artefact stale with it;
 *  - `blocksMatchTheirHtml` (src/pipeline.ts) re-derives the document and
 *    compares it byte for byte, so under Postgres — where `extracted_html`
 *    carries none of our ids — the `blocks` step never reported itself done.
 *
 * The fix keys such a block on its tag, attributes and inner text in pass one,
 * **and only when there is genuinely nothing in it** — no text, no `src`, and no
 * child element — and `carryOverIds` **refuses the whole bucket** when the two
 * sides hold different numbers of it. Both guards exist because the first
 * version of the fix had neither: two `<figure>`s wrapping different inline SVGs
 * have no text and no `src` either, and keying those by tag alone moved one
 * diagram's id onto the other; and greedy consumption slid every id onto the
 * next rule when a page inserted one. GPT Sol reproduced the first and argued
 * the second, 2026-09-05.
 */
import { describe, expect, it } from "vitest";
import { splitIntoBlocks } from "../src/blocks.js";
import { STEPS, type StepContext } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import type { ArtifactReads } from "../src/store/artifacts.js";
import type { Block } from "../src/types.js";

/**
 * Stage 2's document, which is what stage 3 is handed in production: fresh from
 * Readability, with **none of our ids in it**. On the filesystem store the
 * stamped and extracted HTML are one file and the ids are simply reused off the
 * document, which is why this bug was invisible there; in Postgres they are two
 * columns and this is the one stage 3 reads.
 */
const resplit = (extractedHtml: string, previous: Block[]) =>
  splitIntoBlocks(extractedHtml, previous);

const idsOf = (blocks: Block[]) => blocks.map((b) => b.id);
const idsOfTag = (blocks: Block[], tag: string) =>
  blocks.filter((b) => b.tag === tag).map((b) => b.id);

describe("a block with nothing in it keeps its id across a re-extraction", () => {
  const ARTICLE = `
    <article>
      <h1>Soul Machine</h1>
      <p>The first paragraph carries the argument.</p>
      <hr>
      <p></p>
      <ul><li></li><li>A real item.</li></ul>
      <figure></figure>
      <p>The last paragraph closes it.</p>
    </article>
  `;

  const first = splitIntoBlocks(ARTICLE);

  it("has the four text-less shapes in it, or it is testing nothing", () => {
    const empty = first.blocks.filter((b) => b.text === "" && !/\bsrc="/.test(b.html));
    expect(empty.map((b) => b.tag).sort()).toEqual(["figure", "hr", "li", "p"]);
  });

  it("carries every id when the same document is split again", () => {
    const second = resplit(ARTICLE, first.blocks);
    expect(idsOf(second.blocks)).toEqual(idsOf(first.blocks));
    expect(second.stats.minted).toBe(0);
  });

  it("keeps the article's fingerprint identical, which is what went stale", () => {
    const second = resplit(ARTICLE, first.blocks);
    expect(hashBlocks(second.blocks)).toBe(hashBlocks(first.blocks));
  });

  it("re-derives the same document byte for byte", () => {
    // The middle of `blocksMatchTheirHtml`'s three questions; the whole guard,
    // through the real step, is the last test in this file.
    expect(resplit(ARTICLE, first.blocks).html).toBe(first.html);
  });

  /**
   * **The empties are reordered here, and that is the point.** Asserting that
   * the `<p>`s and the `<li>`s each keep their own ids in document order proves
   * nothing while the document order is unchanged: one global bucket for every
   * empty block would pass it too. Swapping the empty `<li>` and the empty `<p>`
   * separates the two hypotheses. Sol's note, 2026-09-05.
   */
  it("keys an empty <p> apart from an empty <li>, even when they trade places", () => {
    const swapped = `
      <article>
        <h1>Soul Machine</h1>
        <p>The first paragraph carries the argument.</p>
        <hr>
        <ul><li></li><li>A real item.</li></ul>
        <p></p>
        <figure></figure>
        <p>The last paragraph closes it.</p>
      </article>
    `;
    const second = resplit(swapped, first.blocks);
    // The empty <p> is the one with no text; the prose paragraphs keep theirs.
    const emptyP = (bs: Block[]) => bs.filter((b) => b.tag === "p" && b.text === "").map((b) => b.id);
    expect(emptyP(second.blocks)).toEqual(emptyP(first.blocks));
    expect(idsOfTag(second.blocks, "li")).toEqual(idsOfTag(first.blocks, "li"));
    expect(second.stats.minted).toBe(0);
  });
});

/**
 * The ambiguity case, which is the whole risk of the fix: every `<hr>` in a
 * document keys `e:hr`, so one bucket holds several ids. Pass one consumes them
 * in document order — the same rule that keeps every repeated `<li>Yes</li>`'s
 * id today — and these tests say what that buys and what it concedes.
 */
describe("several empty blocks of one tag share a bucket", () => {
  const page = (body: string) => `<article><h1>Rules</h1>${body}</article>`;
  const TWO = page("<p>Alpha stands first.</p><hr><p>Beta follows.</p><hr><p>Gamma ends it.</p>");

  it("two <hr>s keep their two ids, in order", () => {
    const first = splitIntoBlocks(TWO);
    const second = resplit(TWO, first.blocks);
    expect(idsOfTag(second.blocks, "hr")).toEqual(idsOfTag(first.blocks, "hr"));
    expect(idsOfTag(first.blocks, "hr")).toHaveLength(2);
  });

  it("inserting a paragraph between them does not swap them", () => {
    const first = splitIntoBlocks(TWO);
    const withInsert = page(
      "<p>Alpha stands first.</p><hr><p>Beta follows.</p><p>An inserted aside.</p><hr><p>Gamma ends it.</p>",
    );
    const second = resplit(withInsert, first.blocks);
    expect(idsOfTag(second.blocks, "hr")).toEqual(idsOfTag(first.blocks, "hr"));
    // And the prose either side kept its own ids, so nothing rotated.
    const textIds = (bs: Block[]) =>
      bs.filter((b) => b.text.startsWith("Alpha") || b.text.startsWith("Gamma")).map((b) => b.id);
    expect(textIds(second.blocks)).toEqual(textIds(first.blocks));
  });

  /**
   * **Add or remove one and the whole bucket refuses, which is the rule with
   * the design in it.**
   *
   * Position is the only thing distinguishing the second `<hr>` from the third,
   * so consuming the bucket greedily would slide every id after an insertion
   * onto the rule below — and a chat can be anchored to a block by its id alone,
   * so that is a reader's question re-attached to a different place in the
   * argument. block-ids.md: a lost anchor is safer than a wrong one.
   *
   * **And it costs no fingerprint**, which is what settles it: `hashBlocks` runs
   * over every block, so an article that gained or lost one has a different
   * fingerprint whatever these ids do. Nothing stable is being thrown away.
   *
   * The first version of this fix went the other way — greedy, on the argument
   * that two empty rules are interchangeable — and these three tests asserted
   * the slide. GPT Sol argued it back, 2026-09-05.
   */
  it("refuses the whole bucket when one of three is removed", () => {
    const THREE = page("<p>One.</p><hr><p>Two.</p><hr><p>Three.</p><hr><p>Four.</p>");
    const first = splitIntoBlocks(THREE);
    const before = idsOfTag(first.blocks, "hr");
    expect(before).toHaveLength(3);

    const withoutMiddle = page("<p>One.</p><hr><p>Two.</p><p>Three.</p><hr><p>Four.</p>");
    const second = resplit(withoutMiddle, first.blocks);
    const after = idsOfTag(second.blocks, "hr");
    expect(after).toHaveLength(2);
    for (const id of after) expect(before).not.toContain(id);
    // Only the rules: every paragraph keeps its id.
    expect(second.stats.minted).toBe(2);
  });

  it("refuses the whole bucket when one is inserted in the middle", () => {
    const first = splitIntoBlocks(TWO);
    const before = idsOfTag(first.blocks, "hr");
    const withInsert = page(
      "<p>Alpha stands first.</p><hr><p>Inserted.</p><hr><p>Beta follows.</p><hr><p>Gamma ends it.</p>",
    );
    const second = resplit(withInsert, first.blocks);
    for (const id of idsOfTag(second.blocks, "hr")) expect(before).not.toContain(id);
    // Three rules and the inserted paragraph.
    expect(second.stats.minted).toBe(4);
  });

  it("refuses the whole bucket when one is added at the end", () => {
    const first = splitIntoBlocks(TWO);
    const withExtra = page(
      "<p>Alpha stands first.</p><hr><p>Beta follows.</p><hr><p>Gamma ends it.</p><hr>",
    );
    const second = resplit(withExtra, first.blocks);
    for (const id of idsOfTag(second.blocks, "hr")) {
      expect(idsOfTag(first.blocks, "hr")).not.toContain(id);
    }
    expect(second.stats.minted).toBe(3);
  });

  /**
   * **The two sides being counted have to be the same population**, and the
   * first version of the refusal counted the wrong one.
   *
   * `carryOverIds` is handed only the *pending* candidates — the blocks that did
   * not already have one of our ids on them in the document — while its bucket
   * holds *every* previous block. A part-stamped document (one rule carrying its
   * id, one not: a hand-edit, or a duplicate id the second of which is refused
   * reuse) therefore looked like an article that had lost a rule, and the
   * surviving one re-minted for nothing. GPT Sol found it, 2026-09-05. The count
   * to compare against is the ids nobody has claimed yet.
   */
  it("counts only the ids still going spare when half the document is stamped", () => {
    const first = splitIntoBlocks(TWO);
    const [one, two] = idsOfTag(first.blocks, "hr");
    // The document as a half-finished re-run leaves it: the first rule still
    // carries its id, the second has lost hers.
    const halfStamped = page(
      `<p>Alpha stands first.</p><hr id="${one}"><p>Beta follows.</p><hr><p>Gamma ends it.</p>`,
    );
    const second = resplit(halfStamped, first.blocks);
    expect(idsOfTag(second.blocks, "hr")).toEqual([one, two]);
    expect(second.stats.minted).toBe(0);
  });

  /**
   * **What cardinality does not catch, pinned rather than claimed away.** It
   * compares *net* counts, so an edit that removes one rule and adds another
   * passes the guard and the ids slide: the second rule takes the first's id and
   * the new one takes the second's. This is the same irreducible ambiguity the
   * contract already accepts for two paragraphs that read alike — there is
   * nothing in either rule to say which is which — and it is here so that
   * whoever narrows it changes a test rather than nothing. GPT Sol, 2026-09-05.
   */
  it("does not catch a removal and an insertion that cancel out", () => {
    const first = splitIntoBlocks(TWO);
    const [one, two] = idsOfTag(first.blocks, "hr");
    const swapped = page(
      "<p>Alpha stands first.</p><p>Beta follows.</p><hr><p>Gamma ends it.</p><hr>",
    );
    const second = resplit(swapped, first.blocks);
    expect(idsOfTag(second.blocks, "hr")).toEqual([one, two]);
    expect(second.stats.minted).toBe(0);
  });

  /**
   * **A different tag's count changing must not punish this one.** The refusal
   * is per key, so adding a paragraph-shaped empty block leaves the rules alone.
   */
  it("refuses only the bucket whose count moved", () => {
    const first = splitIntoBlocks(TWO);
    const withEmptyP = page(
      "<p>Alpha stands first.</p><hr><p></p><p>Beta follows.</p><hr><p>Gamma ends it.</p>",
    );
    const second = resplit(withEmptyP, first.blocks);
    expect(idsOfTag(second.blocks, "hr")).toEqual(idsOfTag(first.blocks, "hr"));
    expect(second.stats.minted).toBe(1);
  });
});

/**
 * **A block can have no text and no `src` and still be one of a kind**, and this
 * is the case the first version of the fix got wrong.
 *
 * `<figure><svg>…</svg></figure>` is how a diagram arrives when the page draws
 * it inline — `block-ids.md` § *A bare `<svg>` gets no id* says a figure-wrapped
 * one is a thing Hierarchy points at. Keyed on its tag alone, reordering two of
 * them put the circle's id on the rectangle, with `minted: 0` and an unchanged
 * fingerprint saying all was well. GPT Sol found and reproduced it.
 */
describe("a text-less block with markup in it mints rather than guessing", () => {
  const page = (body: string) => `<article><h1>Diagrams</h1>${body}</article>`;
  const CIRCLE = `<figure><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg></figure>`;
  const RECT = `<figure><svg viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8"></rect></svg></figure>`;

  it("does not move one diagram's id onto another when they are reordered", () => {
    const first = splitIntoBlocks(page(CIRCLE + RECT));
    const circleFirst = first.blocks.find((b) => b.html.includes("circle"))!.id;
    const rectFirst = first.blocks.find((b) => b.html.includes("rect"))!.id;
    expect(circleFirst).not.toBe(rectFirst);

    const second = resplit(page(RECT + CIRCLE), first.blocks);
    expect(second.blocks.find((b) => b.html.includes("circle"))!.id).not.toBe(rectFirst);
    expect(second.blocks.find((b) => b.html.includes("rect"))!.id).not.toBe(circleFirst);
    // Both mint: a lost anchor is safer than a moved one. Keying them properly
    // needs a structural digest, which is deferred in the postmortem.
    expect(second.stats.minted).toBe(2);
  });

  /**
   * **The same argument as the SVG, one step less obvious.** `class` and
   * `data-*` survive the sanitiser, so `<hr class="section-break">` is not the
   * same rule as a plain `<hr>` — it is drawn differently. The key carries the
   * attributes (sorted, minus `id`) so that reordering two unlike rules mints
   * instead of trading their ids.
   */
  it("does not treat two <hr>s with different classes as interchangeable", () => {
    const rules = (body: string) => `<article><h1>Rules</h1>${body}</article>`;
    const doc = rules(
      `<p>One paragraph.</p><hr class="section-break"><p>Two.</p><hr class="thin"><p>Three.</p>`,
    );
    const first = splitIntoBlocks(doc);
    const section = first.blocks.find((b) => b.html.includes("section-break"))!.id;
    const thin = first.blocks.find((b) => b.html.includes("thin"))!.id;
    expect(section).not.toBe(thin);

    const swapped = rules(
      `<p>One paragraph.</p><hr class="thin"><p>Two.</p><hr class="section-break"><p>Three.</p>`,
    );
    const second = resplit(swapped, first.blocks);
    // Each rule keeps its own id, because the key knows they are not alike.
    expect(second.blocks.find((b) => b.html.includes("section-break"))!.id).toBe(section);
    expect(second.blocks.find((b) => b.html.includes("thin"))!.id).toBe(thin);
    expect(second.stats.minted).toBe(0);
  });

  /**
   * **`<p></p>` and `<p>&#160;</p>` are two different paragraphs**, and the
   * second draws a blank line. `extractText` collapses a non-breaking space to
   * nothing — U+00A0 is `\s` — so the text side of the key cannot tell them
   * apart, and `children` does not see a text node. The key carries the
   * childless element's `innerHTML`, which is safe to carry *because* it is
   * childless: no id of ours in it, no href `retargetAnchors` repointed.
   */
  it("does not treat an empty paragraph and a blank-line one as the same block", () => {
    const doc = (body: string) => `<article><h1>Spacing</h1>${body}</article>`;
    const bare = "<p></p>";
    const nbsp = "<p>&#160;</p>";
    const first = splitIntoBlocks(doc(`<p>Prose one.</p>${bare}<p>Prose two.</p>${nbsp}`));
    const empties = first.blocks.filter((b) => b.tag === "p" && b.text === "");
    expect(empties).toHaveLength(2);

    const second = resplit(doc(`<p>Prose one.</p>${nbsp}<p>Prose two.</p>${bare}`), first.blocks);
    const after = second.blocks.filter((b) => b.tag === "p" && b.text === "");
    // Each one keeps its own id rather than taking the other's.
    expect(after[0]!.id).toBe(empties[1]!.id);
    expect(after[1]!.id).toBe(empties[0]!.id);
    expect(second.stats.minted).toBe(0);
  });

  /**
   * **An id the author wrote is left out of the key, and here is what that buys
   * and what it costs.** By the time a block is stored, its `id` is ours — the
   * author's name for it has been overwritten — so leaving `id` out is the only
   * way the two sides of a match can agree at all.
   */
  it("carries a block the author named, which is 33 of the corpus's blocks", () => {
    const doc = (body: string) => `<article><h1>Named</h1>${body}</article>`;
    const body = `<p>Prose one.</p><hr id="alpha"><p>Prose two.</p><hr id="beta">`;
    const first = splitIntoBlocks(doc(body));
    const second = resplit(doc(body), first.blocks);
    expect(idsOfTag(second.blocks, "hr")).toEqual(idsOfTag(first.blocks, "hr"));
    expect(second.stats.minted).toBe(0);
  });

  /**
   * **The known limitation, pinned with its blast radius** — which is the one
   * thing the `<hr>` limitation this whole file exists for was missing.
   *
   * Two empty blocks of one tag differing *only* in an author-written id trade
   * ids when the page reorders them. Who reads that: a chat anchored to the
   * block by id alone would move to the other one; a comment cannot be here (it
   * needs a quote); the reading position is a section; and the author's own
   * `#alpha` anchor is unaffected, because retargeting is re-resolved from the
   * current document on every run. `hashBlocks` does not move, because the two
   * ids are both still present.
   *
   * Refusing instead — GPT Sol's proposal, 2026-09-05 — costs 33 blocks on 3 of
   * the 35 corpus fixtures, which go on flipping their fingerprint and never
   * reporting the `blocks` step done. That was measured before this was chosen.
   */
  it("trades two named rules when they are reordered, which is the accepted cost", () => {
    const doc = (body: string) => `<article><h1>Named</h1>${body}</article>`;
    const first = splitIntoBlocks(
      doc(`<p>Prose one.</p><hr id="alpha"><p>Prose two.</p><hr id="beta">`),
    );
    const [alpha, beta] = idsOfTag(first.blocks, "hr");
    const second = resplit(
      doc(`<p>Prose one.</p><hr id="beta"><p>Prose two.</p><hr id="alpha">`),
      first.blocks,
    );
    // The rule now named `beta` wears what was the `alpha` rule's id: the ids
    // stay in document order while the names moved.
    expect(idsOfTag(second.blocks, "hr")).toEqual([alpha, beta]);
    expect(second.stats.minted).toBe(0);
  });

  /**
   * **The attribute list is JSON, not `name=value` joined by a space**, for the
   * reason `keyOf` gives about every other key in this file: a delimiter a page
   * can write into an attribute value is not a delimiter. These two rules spell
   * the same joined string — `class=a data-x=b` — and are not the same rule.
   */
  it("does not let one attribute value spell another rule's attribute list", () => {
    const rules = (body: string) => `<article><h1>Rules</h1>${body}</article>`;
    const one = `<hr class="a data-x=b">`;
    const two = `<hr class="a" data-x="b">`;
    const first = splitIntoBlocks(rules(`<p>Prose one.</p>${one}<p>Prose two.</p>${two}`));
    const ids = first.blocks.filter((b) => b.tag === "hr").map((b) => b.id);
    const second = resplit(rules(`<p>Prose one.</p>${two}<p>Prose two.</p>${one}`), first.blocks);
    // Reordered, each keeps its own id rather than taking the other's.
    expect(second.blocks.filter((b) => b.tag === "hr").map((b) => b.id)).toEqual([ids[1], ids[0]]);
  });

  it("still re-mints such a block on an unchanged document, which is the cost", () => {
    // Honest about what is *not* fixed: an inline-SVG figure goes on churning,
    // exactly as it did before 2026-09-05. It is the price of not guessing, and
    // the corpus has none of them — all 218 of the churning blocks were empty.
    const doc = page(CIRCLE);
    const first = splitIntoBlocks(doc);
    expect(resplit(doc, first.blocks).stats.minted).toBe(1);
  });
});

/**
 * **The real guard, through the real step**, in the shape production has: stage
 * 2's html with none of our ids in it. Asserting the byte comparison by hand
 * (above) tests the same arithmetic the guard does; this tests the guard.
 */
describe("the blocks step reports itself done under a Postgres-shaped store", () => {
  const ARTICLE = `<article><h1>Soul Machine</h1><p>The argument, at some length.</p><hr><p></p></article>`;

  /** The three artefacts `blocksMatchTheirHtml` reads, and nothing else. */
  const storeOf = (blocks: Block[], stampedHtml: string, extractedHtml: string) =>
    ({
      read: async (_slug: string, _step: string, kind: string) =>
        kind === "blocks"
          ? { blocks }
          : kind === "stampedHtml"
            ? stampedHtml
            : kind === "extractedHtml"
              ? extractedHtml
              : null,
      /* The guard calls `read` and nothing else; the cast keeps the other five
         methods of `ArtifactReads` out of a test that would only be asserting
         that it can write five stubs. */
    }) as unknown as ArtifactReads;

  const ctx = (): StepContext => ({
    slug: "empty-blocks-probe",
    url: "https://example.test/empty",
    report: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  });

  it("is done, though the extracted html carries no ids and the article has an <hr>", async () => {
    const run = splitIntoBlocks(ARTICLE);
    expect(run.blocks.some((b) => b.tag === "hr")).toBe(true);
    const store = storeOf(run.blocks, run.html, ARTICLE);
    expect(await STEPS.blocks.isDone?.(ctx(), store)).toBe(true);
  });
});
