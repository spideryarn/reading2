// @vitest-environment jsdom
/**
 * **Every work the piece cites is marked where it cites it** — the prose half of
 * Citations mode, asked for by Greg on 2026-09-12 (SPIDERYARN-READING2-3M):
 *
 * > And (just as we do with quotes and glossary), once generated, we should
 * > always visually indicate Citations somehow in the main text
 *
 * docs/plans/260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button.md.
 *
 * jsdom rather than node, for the reason tests/quote-marks.test.ts and
 * tests/search-hits.test.ts both give: these spans live in **the browser's**
 * offset space — the concatenation of a block's text nodes — and a hand-rolled
 * equivalent tested in node would pass against itself.
 *
 * ## The two assertions that earn their keep
 *
 * Everything here is one-liner-testable except two cases, and those two are the
 * whole reason this file exists rather than a line in an existing one. Both are
 * about what happens when the words are **not** where the artefact says:
 *
 *  - **a place that cannot be re-found draws nothing, not the whole block.**
 *    The obvious way to build these marks is on `resolveOne` in search-hits.ts,
 *    which every other passage source uses — and `resolveOne` falls back to
 *    `{start: 0, end: text.length}` when it cannot locate the quote. For a
 *    search hit that is right: the model named the block and its locator may
 *    have drifted. For a citation it is catastrophic and silent — failing to
 *    find `(Tulving 1983)` would tint an entire paragraph, and nothing
 *    downstream can tell that from a mark somebody meant.
 *  - **a quote occurring twice in one block draws nothing, not the first.** The
 *    plan's first draft argued that the first *rendered* occurrence must be the
 *    one meant, because `verifyPlace` takes the first occurrence in
 *    `block.text`. GPT Sol refused it: the relocation branch establishes
 *    uniqueness across blocks, not within one, and the two strings undergo
 *    different whitespace transformations, so "first here" does not prove "first
 *    there". One match is safe; two are no answer.
 *
 * A test that only checked "a citation gets a mark" passes against both.
 */
import { describe, expect, it } from "vitest";
import { annotateHtml, citeMarks, type CiteSelection, type Mark } from "../src/web/annotate.js";
import type { Block, BlockId } from "../src/types.js";

const block = (id: string, html: string): Block => {
  const text = html.replace(/<[^>]+>/g, "");
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html, gistable: true };
};

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. docs/project/block-ids.md. */
const ONE = "spya-k3m9qt" as BlockId;
const TWO = "spya-p7w2dn" as BlockId;
const REFS = "spya-h4v8zr" as BlockId;

const BLOCKS: Block[] = [
  block(ONE, "<p>Context is reinstated at retrieval (Tulving 1983), which is the claim.</p>"),
  block(TWO, "<p>Later work — see <em>Kaplan et al 2020</em> — scaled it up.</p>"),
  block(REFS, "<p>Tulving, E. (1983). Elements of Episodic Memory. Oxford.</p>"),
];

/** A work reduced to what drawing it in the prose needs, as the Reader reduces it. */
function cite(id: string, places: { blockId: BlockId; quote: string }[]): CiteSelection {
  return { id, places };
}

const TULVING = cite("spya-a2b3c4", [
  { blockId: ONE, quote: "(Tulving 1983)" },
  { blockId: REFS, quote: "Tulving, E. (1983)" },
]);
const KAPLAN = cite("spya-d5e6f7", [{ blockId: TWO, quote: "Kaplan et al 2020" }]);

/** The marks on one block, as ids, so an assertion reads like the claim it makes. */
function idsOn(marks: Map<BlockId, unknown[]>, id: BlockId): string[] {
  return (marks.get(id) ?? []).map((m) => (m as { id: string }).id);
}

describe("citeMarks", () => {
  it("marks every work in every block that cites it, and more than one of them", () => {
    const marks = citeMarks(BLOCKS, [TULVING, KAPLAN]);
    /* **More than one work and more than one block**, which is the assertion a
       "the citation is marked" test would not make — and the bug it would pass
       against is the one where everything about the first work is right. */
    expect([...marks.keys()].sort()).toEqual([ONE, TWO, REFS].sort());
    expect(idsOn(marks, ONE)).toEqual([TULVING.id]);
    expect(idsOn(marks, TWO)).toEqual([KAPLAN.id]);
    /* The bibliography entry is marked too: a reader who has skipped to the
       references is standing in the one place every work is named. */
    expect(idsOn(marks, REFS)).toEqual([TULVING.id]);
  });

  it("puts the mark on the citation's own characters, in the browser's offset space", () => {
    const marks = citeMarks(BLOCKS, [TULVING]);
    const first = BLOCKS[0]!;
    const html = annotateHtml(first.html, marks.get(ONE) ?? []);
    /* The span, not the paragraph: what is inside the <mark> is exactly the
       citation. An offset taken against `block.text` and applied here lands
       somewhere plausible and silently wrong — annotate.ts's whole header. */
    expect(html).toContain(`<mark class="cite" data-cite="${TULVING.id}">(Tulving 1983)</mark>`);
  });

  it("marks a citation the article wrote inside its own markup", () => {
    /* `Kaplan et al 2020` is wholly inside an <em>, so the mark nests cleanly;
       the point of the case is that the rendered text the search runs against
       is the concatenation of the text nodes, not the html. */
    const marks = citeMarks(BLOCKS, [KAPLAN]);
    const html = annotateHtml(BLOCKS[1]!.html, marks.get(TWO) ?? []);
    expect(html).toContain(`<mark class="cite" data-cite="${KAPLAN.id}">Kaplan et al 2020</mark>`);
  });

  it("DRAWS NOTHING for a place whose words are not there, rather than the whole block", () => {
    /* The `resolveOne` trap. A citation the article no longer contains — the
       paragraph was re-extracted, the artefact was not — must vanish, not
       expand to the paragraph. */
    const gone = cite("spya-g8h9j2", [{ blockId: ONE, quote: "(Baddeley 1974)" }]);
    const marks = citeMarks(BLOCKS, [gone]);
    expect(marks.get(ONE)).toBeUndefined();
    expect(marks.size).toBe(0);
    /* And said the other way round, because "no entry" and "an entry covering
       everything" are the two outcomes this is between. */
    expect(annotateHtml(BLOCKS[0]!.html, marks.get(ONE) ?? [])).not.toContain("<mark");
  });

  it("DRAWS NOTHING when the citation occurs twice in one block, rather than the first", () => {
    const twice = block(
      "spya-m5n6p7" as BlockId,
      "<p>Both (Tulving 1983) and later (Tulving 1983) say so.</p>",
    );
    const work = cite("spya-q2r3s4", [
      { blockId: twice.id as BlockId, quote: "(Tulving 1983)" },
    ]);
    const marks = citeMarks([twice], [work]);
    expect(marks.size).toBe(0);
  });

  it("keeps the other works when one of them cannot be placed", () => {
    /* A stale artefact is the ordinary case, not the exceptional one — the
       citations stamp does not cover the article's text. One bad place must not
       take the list down with it. */
    const gone = cite("spya-g8h9j2", [{ blockId: ONE, quote: "(Baddeley 1974)" }]);
    const marks = citeMarks(BLOCKS, [gone, KAPLAN]);
    expect(idsOn(marks, TWO)).toEqual([KAPLAN.id]);
  });

  it("names a block the article no longer has without throwing", () => {
    const orphan = cite("spya-t2u3v4", [{ blockId: "spya-zzzzzz" as BlockId, quote: "anything" }]);
    expect(citeMarks(BLOCKS, [orphan]).size).toBe(0);
  });

  it("is an empty map for an article with no citations, so the prose is untouched", () => {
    expect(citeMarks(BLOCKS, []).size).toBe(0);
  });

  it("merges into one <mark> with both classes where a citation sits inside a quote", () => {
    /* Two kinds over the same words are ONE element carrying both classes, not
       two nested ones — annotate.ts § MarkKind. Pinned here because the
       citation is the fifth kind and the merge is what the class list is for:
       a citation inside a quoted sentence must keep `hit` so the quote's stroke
       survives, and keep `cite` so the card can find it. */
    const marks = citeMarks(BLOCKS, [TULVING]).get(ONE) ?? [];
    /* A real `QuoteStroke` — `{ tier, alpha }`, src/types.ts. The first draft of
       this line wrote `fade` for `alpha` and the test still passed, because
       `baseMarks` forks on `quoteStroke !== null` and nothing here reads the
       field. `npm run typecheck` is what caught it, which is the argument
       docs/project/typechecking.md makes about wrong states the compiler can
       refuse. */
    const quote: Mark = {
      id: "q:1",
      start: 0,
      end: 60,
      kind: "hit",
      quoteStroke: { tier: 1, alpha: 1 },
    };
    const html = annotateHtml(BLOCKS[0]!.html, [...marks, quote]);
    expect(html).toMatch(/<mark class="[^"]*\bhit\b[^"]*"[^>]*data-cite=/);
    expect(html).toMatch(/<mark class="[^"]*\bcite\b/);
  });
});
