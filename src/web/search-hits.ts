/**
 * Turning either kind of search into the same two things: **a list to read and
 * marks to draw.**
 *
 * This is where the design decision in docs/project/search.md actually lives.
 * The reader has one box with two matchers behind it — the letters they typed,
 * or what those letters mean — and everything downstream of this file is
 * identical for both. One results list, one kind of mark, one sort control, one
 * set of styles. The two matchers meet here and nothing after here has to know
 * which one ran.
 *
 * That is the shape the version this is borrowed from arrived at too, and its
 * own note is worth having: *the same UI serves both literal and semantic
 * search, switched by a URL parameter. That is the right relationship between
 * the two: one place to look for things, two ways of matching.*
 * (docs/project/original-version/search-and-chat.md)
 *
 * ## The offset space, which is the thing to get right
 *
 * Every span in here is measured in **the rendered text of `block.html`** — the
 * concatenation of its text nodes, which is what `Range.toString()` measures
 * and what `renderedText` in annotate.ts produces. Not `block.text`, which is a
 * different string of a different length (annotate.ts § Why the offsets are DOM
 * offsets). The stored hits arrive measured in `block.text`, because that is
 * the string the server can see, so **their quote is re-found here rather than
 * trusted** — text first, offsets only as a tie-break, exactly as a comment's
 * anchor is resolved.
 */
import { renderedText, type Mark } from "./annotate.js";
import { findQuote, snippet } from "../quote-match.js";
import type { Block, BlockId, SearchHit } from "../types.js";

/**
 * Shorter than this and a literal search matches most of the article.
 *
 * Two, not one: a single character washes every "e" on the page, which is not a
 * search result, it is a rendering accident. Two is enough for "AI" and "GPT",
 * which are exactly the short things somebody genuinely looks for.
 */
export const MIN_FIND_CHARS = 2;

/** How much of the passage the results list shows before you hover it. */
const SHORT_SNIPPET = 90;

/**
 * And how much the hover card shows.
 *
 * Two lengths rather than one is carried straight over from the version this is
 * borrowed from, and its reasoning is exactly right: short in the list so the
 * results stay scannable, long on hover so a hit can be judged without leaving
 * the list. *Cheap, and it is the difference between a results list you can skim
 * and one you have to click through.*
 */
const LONG_SNIPPET = 400;

/**
 * One match, in the form the panel and the prose both want.
 *
 * The fields that are `null` in words mode are the ones the model supplies:
 * a substring match has no confidence to report and no reasoning to give, and
 * inventing a 100% for it would be putting a number on the screen that means
 * something different from the number beside it.
 */
export interface Found {
  /** Unique within one result set — `blockId` alone is not, blocks repeat. */
  key: string;
  blockId: BlockId;
  /**
   * The saved search this came from, or `null` for a literal match.
   *
   * Several searches can be switched on at once (SearchPanel.tsx § Saved), and
   * from `orderFound` onwards their results are **one list**. So every result
   * has to be able to say which question found it — otherwise the merged list
   * is a pile of passages with no provenance, which is precisely the failure
   * the colour exists to prevent.
   */
  runId: string | null;
  /**
   * Which palette slot that search wears — `null` for a literal match.
   *
   * Assigned by src/web/hit-colours.ts, resolved to an actual hue by
   * styles/colourscales.css, and never turned into a colour anywhere in
   * between. A literal match has no slot because it belongs to no saved search:
   * it wears the one fixed search hue, the way it always did.
   */
  slot: number | null;
  /** The block's position in the article. What `document` order sorts on. */
  index: number;
  /** Inclusive, in the block's rendered-text offset space. */
  start: number;
  /** Exclusive. */
  end: number;
  /** 0–100 for a meaning hit; `null` for a literal one. */
  confidence: number | null;
  /** The model's one line on why this matches; `null` for a literal match. */
  reasoning: string | null;
  /** What the list shows. */
  short: string;
  /** What the hover card shows. */
  long: string;
  /**
   * How far through the article this match falls, 0 at the first word and 1 at
   * the last.
   *
   * Both matchers carry it, which is the point: a literal hit has no confidence
   * to show and this is the one thing the row can say about it besides its
   * words. Greg's ask, 2026-08-26 — *each result shows both confidence and
   * place.*
   *
   * Measured in **characters of the article**, not in blocks, because blocks are
   * wildly uneven: an article that ends in twenty one-line list items would put
   * a result three-quarters of the way down the page at "90% through" if the
   * denominator were the block count. Characters are the cheap stand-in for
   * height. The offset *within* the block is folded in too, so two hits in one
   * long paragraph are not drawn in the same place.
   */
  at: number;
  /**
   * True when the model's quote could not be found in the rendered prose and
   * the whole block is marked instead.
   *
   * The honest fallback, and it is a fallback rather than a failure: the model
   * named a block and said why, and that much is still true even when the exact
   * words have moved. Marking nothing would throw away a good answer over a
   * whitespace difference; marking the wrong words would be worse than either.
   * The panel says so, so a reader can see which kind of mark they are looking
   * at rather than wondering why one result is a slab.
   */
  whole: boolean;
}

/**
 * The article as one ruler, so a match can say how far through it it falls.
 *
 * **Built from the rendered text, and it is handed the strings rather than the
 * blocks.** The first version summed `block.text.length` instead, on the grounds
 * that it is already on the block and costs no DOM — and it was measuring the
 * ruler in one string space while measuring the position along it in another.
 * `block.text` normalises whitespace and inserts a space at every nested block
 * boundary; `renderedText` is the raw concatenation of text nodes. For a
 * paragraph the two agree to within a character or two, and for a table or a
 * deeply nested list they do not. Nothing would have looked broken; the bars
 * would just have been wrong, by an amount nobody could see. Raised by a GPT Sol
 * review, 2026-08-26.
 *
 * Taking the already-rendered strings rather than the blocks is what makes that
 * affordable: `findLiteral` has to render every block anyway, so the ruler is
 * free there, and `resolveHits` pays one pass it did not before.
 *
 * `total` is floored at 1 so an empty article divides rather than throwing a NaN
 * into a CSS percentage, where it would silently render as 0%.
 */
interface Ruler {
  /** Characters before block `i` begins. */
  starts: number[];
  /** Characters in block `i`. */
  lengths: number[];
  /** Characters in the whole article, at least 1. */
  total: number;
}

function ruler(texts: string[]): Ruler {
  const lengths = texts.map((t) => t.length);
  const starts: number[] = [];
  let running = 0;
  for (const length of lengths) {
    starts.push(running);
    running += length;
  }
  return { starts, lengths, total: Math.max(1, running) };
}

/**
 * Where a span inside block `index` falls in the whole article, 0–1.
 *
 * One string space throughout: `start` is an offset into the block's rendered
 * text, and `scale` is built from those same strings. The clamps are belt and
 * braces — with one space they cannot fire — and they stay because the cost is
 * nothing and the failure they prevent is a bar drawn outside its own track.
 */
function placeOf(scale: Ruler, index: number, start: number): number {
  const length = scale.lengths[index] ?? 0;
  const within = length > 0 ? Math.min(1, Math.max(0, start / length)) : 0;
  const chars = (scale.starts[index] ?? 0) + within * length;
  return Math.min(1, Math.max(0, chars / scale.total));
}

/** Every place `needle` appears in `hay`, case-insensitively. */
function literalSpans(hay: string, needle: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const lowerHay = hay.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  for (
    let i = lowerHay.indexOf(lowerNeedle);
    i !== -1;
    i = lowerHay.indexOf(lowerNeedle, i + lowerNeedle.length)
  ) {
    spans.push({ start: i, end: i + needle.length });
  }
  return spans;
}

/**
 * Every occurrence of `find` in the article — the free matcher.
 *
 * Deliberately a plain case-insensitive substring, not the whitespace-tolerant
 * matcher `findQuote` uses and not a word-boundary one like the glossary's.
 * This is find-on-page, and find-on-page has an established meaning that
 * readers already hold: what you typed, wherever it appears, including inside a
 * longer word. A cleverer matcher here would be a *different feature* wearing
 * this one's name — and the reader who wants cleverness has the other toggle.
 *
 * Empty for a query shorter than `MIN_FIND_CHARS`, which is "not searching yet"
 * rather than "no results" — the panel tells them apart.
 */
export function findLiteral(blocks: Block[], find: string | null): Found[] {
  const needle = find?.trim() ?? "";
  if (needle.length < MIN_FIND_CHARS) return [];
  const found: Found[] = [];
  const texts = blocks.map((b) => renderedText(b.html));
  const scale = ruler(texts);
  blocks.forEach((block, index) => {
    const text = texts[index] ?? "";
    for (const span of literalSpans(text, needle)) {
      found.push({
        key: `${block.id}:${span.start}`,
        blockId: block.id,
        /* No saved search behind it, and therefore no colour of its own: a
           literal match is what you typed, and what you typed is in the box.
           styles.css paints a slotless hit in the one fixed search hue. */
        runId: null,
        slot: null,
        index,
        ...span,
        confidence: null,
        reasoning: null,
        short: snippet(text, span, SHORT_SNIPPET),
        long: snippet(text, span, LONG_SNIPPET),
        at: placeOf(scale, index, span.start),
        whole: false,
      });
    }
  });
  return found;
}

/** A saved search that is switched on, reduced to what drawing it needs. */
export interface ActiveRun {
  id: string;
  /** Its palette slot — `assignSlots` in src/web/hit-colours.ts. */
  slot: number;
  hits: SearchHit[];
}

/**
 * The stored hits of every switched-on meaning-search, resolved against the
 * prose they name, as **one list**.
 *
 * The resolution is the part that matters. A hit arrives as a block id and the
 * words the model quoted; where those words *are* on this page is a question
 * only the browser can answer, because the offset space is the rendered one.
 * `findQuote` is forgiving about whitespace and curly quotes for the reasons
 * set out in src/quote-match.ts, and the server has already checked that the
 * quote resolves against `block.text`, so a failure here means the two strings
 * genuinely differ — which is the `whole` case above rather than a lost result.
 *
 * A hit naming a block the article no longer has is dropped outright. That can
 * only happen if the article was re-extracted since the search was saved, and
 * an id that is simply gone has nowhere to point; the alternative is a row in
 * the list that does nothing when pressed.
 *
 * ## Several runs, one pass — and it is not only about speed
 *
 * This took a list of hits until 2026-08-26, and the obvious way to switch on
 * three searches at once would have been to call it three times and concatenate.
 * That is wrong twice. It renders every block's text once per run, which is the
 * one genuinely expensive thing in this file; and it builds a `ruler` per run,
 * so each result's *place* would be measured against a scale rebuilt from the
 * same numbers — identical today, and a trap the moment anything about the
 * ruler stops being a pure function of the blocks. One pass, one ruler, one
 * answer.
 */
export function resolveHits(blocks: Block[], runs: ActiveRun[]): Found[] {
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  const texts = blocks.map((b) => renderedText(b.html));
  const scale = ruler(texts);
  const found: Found[] = [];
  for (const run of runs) {
    for (const [n, hit] of run.hits.entries()) {
      const at = index.get(hit.blockId);
      if (at === undefined) continue;
      const text = texts[at] ?? "";
      /* `whole` comes from whether `findQuote` found anything, and from nothing
         else. The first version of this inferred it — a span covering the entire
         block, plus the quote not equalling the block's text — and real data
         broke it within the hour: a quote that genuinely *is* the whole block
         produces exactly the shape the fallback produces, and the model had
         retyped a line break as a space, so a perfect match was labelled "the
         exact words have moved". A derived fact that usually agrees with a known
         one is the shape of most of docs/reusable/silent-success.md. */
      const located = findQuote(text, hit.quote, hit.start);
      const whole = located === null;
      const span = located ?? { start: 0, end: text.length };
      found.push({
        /* The run id is part of the key, and it has to be. `blockId:n` was
           unique while exactly one search could be showing; with three switched
           on, three searches that each found their second hit in the same
           paragraph produce three results all called `spya-k3m9qt:1`. React
           renders the first and drops the rest with a duplicate-key warning
           nobody reads, `openKey` opens whichever it matches first, and the
           mark in the prose belongs to a different search from the row the
           reader pressed. Every one of those is silent.

           `n` and not the offset within the run, for the reason it always was:
           two hits can legitimately quote the same words with different
           reasoning, and the stored order is the only thing that separates
           them. */
        key: `${run.id}:${hit.blockId}:${n}`,
        blockId: hit.blockId,
        runId: run.id,
        slot: run.slot,
        index: at,
        ...span,
        confidence: hit.confidence,
        reasoning: hit.reasoning,
        short: whole
          ? snippet(text, { start: 0, end: 0 }, SHORT_SNIPPET)
          : snippet(text, span, SHORT_SNIPPET),
        long: whole
          ? snippet(text, { start: 0, end: 0 }, LONG_SNIPPET)
          : snippet(text, span, LONG_SNIPPET),
        /* `span.start`, which for a fallback is 0 — the top of the block. That is
           the honest answer: the whole paragraph is marked, so where in it the
           model meant is exactly what we do not know. */
        at: placeOf(scale, at, span.start),
        whole,
      });
    }
  }
  return found;
}

/**
 * The results in the order the reader asked for.
 *
 * `document` breaks ties on offset, so two matches in one paragraph come out in
 * reading order rather than in whatever order the matcher happened to produce
 * them. `confidence` breaks ties on document order for the same reason, and
 * sorts a literal match — which has no confidence — as though it were certain,
 * because in words mode *every* result has no confidence and the tie-break is
 * then the only thing doing any work.
 *
 * A copy, not a sort in place: the caller's array is memoised upstream and
 * mutating it would reorder a result set the marks were already computed from.
 */
export function orderFound(found: Found[], order: "document" | "confidence"): Found[] {
  const copy = [...found];
  copy.sort((a, b) =>
    order === "confidence" && (a.confidence ?? 100) !== (b.confidence ?? 100)
      ? (b.confidence ?? 100) - (a.confidence ?? 100)
      : a.index - b.index || a.start - b.start,
  );
  return copy;
}

/**
 * How faint the faintest mark may be.
 *
 * A wash at 20% of a 50%-confidence match is not a subtle mark, it is an
 * invisible one — and an invisible mark is indistinguishable from a bug. This
 * is the floor that keeps a low-confidence hit *quiet* rather than *absent*.
 * The reader can still tell it apart from a strong one, because the strong one
 * is five times heavier and because the number is printed in the list.
 */
const MIN_STRENGTH = 0.35;

/**
 * The marks to draw, grouped by block.
 *
 * `strength` is confidence mapped onto the floor above, and a literal match is
 * full strength: it either is the text you typed or it is not, and drawing it
 * at some middling opacity would be inventing an uncertainty that does not
 * exist.
 *
 * Empty map for no results, which is the ordinary case — a reader who has not
 * opened search, or has not typed anything, and the prose is untouched. Same
 * shape and the same principle as `termMarks` in annotate.ts: **the article
 * acquires marks when the reader asks for them and at no other time.**
 */
export function hitMarks(found: Found[], openKey: string | null): Map<BlockId, Mark[]> {
  const byBlock = new Map<BlockId, Mark[]>();
  for (const f of found) {
    if (f.end <= f.start) continue;
    const list = byBlock.get(f.blockId) ?? [];
    list.push({
      id: f.key,
      start: f.start,
      end: f.end,
      kind: "hit",
      slot: f.slot,
      strength:
        f.confidence === null
          ? 1
          : MIN_STRENGTH + (1 - MIN_STRENGTH) * (Math.min(100, Math.max(0, f.confidence)) / 100),
      ...(f.key === openKey ? { open: true } : {}),
    });
    byBlock.set(f.blockId, list);
  }
  return byBlock;
}

/**
 * The strongest mark in each block, for the bar down the left of the paragraph.
 *
 * Greg's call, 2026-08-25: a bar so a match is findable while scrolling past at
 * speed. The wash alone is not — it is behind a phrase, it is faint by design
 * at low confidence, and it can be one line in the middle of a paragraph. The
 * bar is the thing you see out of the corner of your eye.
 *
 * It is scaled *harder* than the wash by the stylesheet, which is a trick taken
 * directly from the version this is borrowed from and one of the few pieces of
 * its implementation worth copying verbatim: *a wash faint enough to keep text
 * readable is too faint to notice; the border carries the signal, the fill
 * carries the extent.*
 */
export function blockStrength(found: Found[]): Map<BlockId, number> {
  const byBlock = new Map<BlockId, number>();
  for (const f of found) {
    const strength = f.confidence === null ? 1 : Math.min(100, Math.max(0, f.confidence)) / 100;
    byBlock.set(f.blockId, Math.max(byBlock.get(f.blockId) ?? 0, strength));
  }
  return byBlock;
}

/**
 * Which searches matched anywhere in each block, as palette slots — the colours
 * the bar down the left of the paragraph is divided into.
 *
 * The bar and the marks answer two different questions and that is why they are
 * scoped differently. A mark says *these words matched, and these searches found
 * them*; the bar says *there is something in this paragraph*, which is the
 * signal you catch while scrolling past at speed (`blockStrength` above has the
 * borrowed reasoning). So a paragraph where one search matched the first
 * sentence and another matched the last gets **two** segments in its bar and
 * **one** rule under each phrase — and both are true.
 *
 * Sorted and de-duplicated for the reason `annotateHtml` sorts its stripes: the
 * same pair of searches must draw the same bar in every paragraph they share,
 * or the reader is reading an order that came out of the result list's sort.
 *
 * `null` slots — literal matches — are dropped rather than given a segment,
 * because a words search has no colour and cannot be one of several: the two
 * matchers are never on at the same time.
 */
export function blockHues(found: Found[]): Map<BlockId, number[]> {
  const byBlock = new Map<BlockId, Set<number>>();
  for (const f of found) {
    if (f.slot === null) continue;
    const set = byBlock.get(f.blockId) ?? new Set<number>();
    set.add(f.slot);
    byBlock.set(f.blockId, set);
  }
  return new Map([...byBlock].map(([id, set]) => [id, [...set].sort((a, b) => a - b)]));
}
