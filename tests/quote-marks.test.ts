// @vitest-environment jsdom
/**
 * **Every quote the panel is showing is marked in the prose** — the half of
 * quotes mode Greg asked for on 2026-09-05 (SPIDERYARN-READING2-1Z), and the
 * one property a test can hold that a screenshot cannot.
 *
 * Until then only the *selected* quote was marked, so the mode looked like
 * nothing at all until a row was pressed:
 *
 * > skim through it just reading the stuff that is marked
 * >
 * > — Greg, 2026-09-05
 *
 * **The assertion that earns its keep is that MORE THAN ONE is marked.** A test
 * saying "the selected quote is marked" passes against the bug, which is
 * exactly how the bug survived: everything about one quote was right.
 *
 * jsdom rather than node, for the reason tests/ideas-resolve.test.ts and
 * tests/search-hits.test.ts both give: these spans live in *the browser's*
 * offset space, defined by the concatenation of a block's text nodes, and a
 * hand-rolled equivalent tested in node would pass against itself.
 *
 * The pure ordering and thresholding functions underneath are covered next door
 * in tests/quotes-panel.test.ts. What this file is about is the seam between
 * them and the marks: `markedQuotes` decides *which* quotes, `resolveQuotes`
 * turns them into the `Found[]` the prose, the paragraph bar and the rail all
 * read, and the two must be talking about the same set.
 */
import { describe, expect, it } from "vitest";
import { findLiteral, quoteMarkKey, resolveQuotes } from "../src/web/search-hits.js";
import { markedQuotes, quoteTier, QUOTE_BAR_DEFAULT } from "../src/web/QuotesPanel.js";
import type { Block, Quote } from "../src/types.js";

const block = (id: string, html: string): Block => {
  const text = html.replace(/<[^>]+>/g, "");
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html, gistable: true };
};

const BLOCKS: Block[] = [
  block("spya-aaaaaa", "<p>Writing is thinking, and there is no way round that.</p>"),
  block("spya-bbbbbb", "<p>Most people never had to write anything down at all.</p>"),
  block("spya-cccccc", "<p>So the pressure went away, and writing is thinking still.</p>"),
];

/** A quote of the article's own characters, which is what the artefact stores. */
function q(id: string, blockId: string, text: string, importance?: number): Quote {
  return {
    id,
    blockId,
    text,
    ...(importance === undefined ? {} : { importance }),
  };
}

const THREE: Quote[] = [
  q("qa", "spya-aaaaaa", "Writing is thinking", 0.9),
  q("qb", "spya-bbbbbb", "Most people never had to write", 0.5),
  q("qc", "spya-cccccc", "writing is thinking still", 0.95),
];

/**
 * `resolveQuotes` over these blocks, with the tier attached the way
 * `QuotesMode` attaches it. The resolver takes the tier already computed —
 * `quoteTier` lives next to `priorityOf` because that is where the thresholds
 * belong — so the seam this file is about now has one more thing crossing it.
 */
const rq = (quotes: readonly Quote[]) =>
  resolveQuotes(
    BLOCKS,
    quotes.map((quote) => ({ ...quote, tier: quoteTier(quote) })),
  );

describe("the quotes the prose marks", () => {
  it("marks every one of them, not only the one that is selected", () => {
    /* The whole report, in one assertion. Three quotes in the list, three
       washed passages on the page — and nobody has pressed anything. */
    const found = rq(markedQuotes(THREE, "document", null));
    expect(found).toHaveLength(3);
    expect(found.map((f) => f.blockId)).toEqual([
      "spya-aaaaaa",
      "spya-bbbbbb",
      "spya-cccccc",
    ]);
  });

  it("marks them in document order, whatever order the panel lists them in", () => {
    /* `?rank=importance` reorders the list; it does not reorder the article.
       Nothing downstream sorts, so the ordering has to happen here — the same
       call `resolveIdea`'s caller makes, for the same reason. */
    const found = rq(markedQuotes(THREE, "importance", null));
    expect(found.map((f) => f.index)).toEqual([0, 1, 2]);
  });

  it("marks exactly what the bar is showing, so the slider is the density control", () => {
    /* Greg asked for the threshold slider and got it on 2026-08-31; what it did
       not do was change how much of the article is highlighted, because only
       one quote was ever marked. Feeding it the thresholded list is what makes
       the two the same control.

       A row the bar has hidden with its wash still on the paragraph is the
       precise failure src/web/threshold.ts exists to prevent. */
    const marked = markedQuotes(THREE, "prioritised", 0.9);
    expect(marked.map((m) => m.id)).toEqual(["qa", "qc"]);
    expect(rq(marked)).toHaveLength(2);
  });

  it("resolves the bar's default the way the panel does, from a null", () => {
    /* Null is "nobody has touched the bar" all the way from the URL, and it is
       the panel that resolves it — so the marks must resolve it identically or
       the list and the page disagree on the opening screen. */
    expect(markedQuotes(THREE, "prioritised", null).map((m) => m.id)).toEqual(
      markedQuotes(THREE, "prioritised", QUOTE_BAR_DEFAULT).map((m) => m.id),
    );
  });

  it("gives every quote one run id, so the rail draws one lane and not sixteen", () => {
    /* The rail packs one lane per run id (src/web/spine-marks.ts § laneOrder),
       and the gutter is ten pixels. A run id per quote would have given a
       sixteen-lane rail of 1.5px marks laid over each other and sorted sideways
       by an arbitrary id — which is not "the same rail, busier", it is a smear.

       Quotes are ONE source, the way the literal matcher is one source. The
       identity of the individual quote is in `key`, which is what the mark, the
       ring and the hover card read. */
    const found = rq(markedQuotes(THREE, "document", null));
    expect(new Set(found.map((f) => f.runId)).size).toBe(1);
    expect(new Set(found.map((f) => f.key)).size).toBe(3);
  });

  it("names the quote in the key, so the pressed row can get the ring", () => {
    /* `mark.hit[data-hit-open]` is how search says *this washed phrase is the
       row you pressed*, and quotes did not need it while there was only ever
       one mark on the page. With all of them marked it is the only thing that
       distinguishes the reader's selection, and the key is computed in one
       place so the band and the resolver cannot disagree about its shape. */
    const found = rq(markedQuotes(THREE, "document", null));
    const key = quoteMarkKey("qb", "spya-bbbbbb");
    expect(found.map((f) => f.key)).toContain(key);
  });

  it("drops a quote whose block the article no longer has, and keeps the rest", () => {
    /* A stale artefact is the ordinary case here — the quotes stamp does not
       cover the article's text, so a re-extraction leaves ids behind. One dead
       quote must not take the other two off the page with it. */
    const withGhost = [...THREE, q("qd", "spya-gone01", "A line from a paragraph that went")];
    expect(rq(markedQuotes(withGhost, "document", null))).toHaveLength(3);
  });

  it("marks nothing when there are no quotes, which is the ordinary state", () => {
    /* The article acquires marks when the reader asks for them and at no other
       time — the rule `hitMarks` and `termMarks` both keep. */
    expect(rq(markedQuotes([], "document", null))).toEqual([]);
  });
});

/**
 * **The stroke, and the priority it carries** — docs/project/quotes.md § The
 * stroke, docs/plans/260907c-….md.
 *
 * A jsdom test can prove the attribute is on the element and can prove nothing
 * about whether the page reads well; the second half is the browser pass, and it
 * is written up in the plan. What is worth holding here is the *mapping*, which
 * is the part a later edit could quietly change.
 */
describe("how heavily each quote is drawn", () => {
  it("is heavy above the bar's default and light below it", () => {
    /* The two controls tell one story: at the bar's resting position everything
       on the page is heavy, and the light ones are what dragging it down
       reveals. If this threshold and QUOTE_BAR_DEFAULT ever part company, the
       reader gets a page where raising the bar hides a heavy stroke and leaves
       a light one — which reads as a bug in the feature whose whole job is to
       say what matters. */
    expect(quoteTier(q("x", "spya-aaaaaa", "t", 0.8))).toBe(2);
    expect(quoteTier(q("x", "spya-aaaaaa", "t", 0.95))).toBe(2);
    expect(quoteTier(q("x", "spya-aaaaaa", "t", 0.79))).toBe(1);
    expect(quoteTier(q("x", "spya-aaaaaa", "t", 0))).toBe(1);
  });

  it("takes the priority the bar takes, not `importance` alone", () => {
    /* `priorityOf` is `max(importance, striking)`, and `?bar=` thresholds on it.
       A quote that is merely striking still clears the bar, so it must also draw
       heavy — otherwise the page and the slider disagree about the same quote. */
    const striking: Quote = { id: "s", blockId: "spya-aaaaaa", text: "t", striking: 0.9 };
    expect(quoteTier(striking)).toBe(2);
  });

  it("draws an unscored quote light, and still draws it", () => {
    /* Both halves matter. A quote scored on neither axis survives every position
       of the bar (docs/project/quotes.md § The bar hides what is below it), so
       leaving it unmarked would be a row in the panel with nothing in the prose
       — the precise failure threshold.ts exists to prevent. And it must be
       light, because it has earned no emphasis. */
    const unscored = q("u", "spya-aaaaaa", "Writing is thinking");
    expect(quoteTier(unscored)).toBe(1);
    expect(rq([unscored])).toHaveLength(1);
  });

  it("carries the tier onto the passage, so the prose can draw it", () => {
    const found = rq(markedQuotes(THREE, "document", null));
    expect(found.map((f) => f.quoteTier)).toEqual([2, 1, 2]);
  });

  it("leaves a search hit with no tier at all", () => {
    /* `quoteTier: null` is what the stylesheet reads as "this is a wash, not an
       outline". A search hit that acquired one would be drawn as a quote. */
    const hits = findLiteral(BLOCKS, "thinking");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((f) => f.quoteTier === null)).toBe(true);
  });
});
