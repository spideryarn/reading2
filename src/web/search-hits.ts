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
import type { ClaimPassage } from "../referee-claims.js";
import type { DivergingScale, RefereeResult } from "../referee-criteria.js";
import type {
  Block,
  BlockId,
  IdeaOccurrence,
  SearchHit,
  TimelineOccurrence,
} from "../types.js";
import type { HitOrder } from "./params.js";
import { valenceDirection, valenceRgbToken } from "./valence.js";
import { applyThreshold, type ThresholdResult } from "./threshold.js";

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
  /**
   * **Which way this passage cuts**, −100…+100 — a referee's for/against
   * criterion and nothing else. `null` everywhere else, which is every other
   * source: a search hit, an idea, a quote, a timeline event, a claim's passage
   * and a literal match all say *this is here*, never *this is bad*.
   *
   * **The number, not a colour and not a token.** `Found` carries source facts
   * — a slot, a confidence, offsets — and the palette is resolved later, in
   * `hitMarks`, where the Reader already owns the display scale. A CSS token on
   * this interface would put presentation state on a resolver and make
   * `resolveCriterion` depend on the URL, which is GPT Sol's finding 5.
   *
   * It is **not** the wash and it is **not** the confidence. The wash carries
   * how sure the model was that the passage is relevant; this carries what it
   * said about it. Two results with opposite valences and equal confidence draw
   * the same wash, which is pinned in tests/referee-criteria-resolve.test.ts,
   * because a wash scaled by |valence| would look informative and mean
   * something else entirely.
   */
  valence: number | null;
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

/**
 * A lowercased copy of `hay`, plus the way back to the original's offsets.
 *
 * **`toLowerCase` does not preserve length**, and the naive version of the
 * matcher below assumed it did: find the needle in a lowercased haystack, then
 * use that index against the original string. `İ` (U+0130) lowercases to two
 * code units, so a single one of those anywhere earlier in a paragraph puts
 * every later offset out by one — the wash starts a letter late, the snippet
 * starts a letter late, and the "42% in" is shifted. Nothing throws.
 *
 * The same trap is written down in src/library-search.ts § `foldWithMap`, which
 * is what makes this one worth being annoyed about: it was a known hazard in
 * this repo, in a function doing the same job, and this one did not check.
 * Raised by a GPT Sol review, 2026-08-26.
 *
 * `map[i]` is the offset in `hay` that folded code unit `i` came from, and
 * `map` has one extra entry at the end so a span that runs to the very last
 * character has somewhere to point. Deliberately **only case**, not the accent
 * and punctuation folding library search does: this is find-on-page, and
 * find-on-page has a meaning readers already hold.
 *
 * Iterated by **code point**, which `for…of` over a string gives for free.
 * Walking code units instead would be shorter and would quietly stop matching
 * every cased script above the BMP — Adlam, Deseret, Osage, Vithkuqi — because
 * lowercasing half a surrogate pair returns that half unchanged. Adlam is a
 * living script in daily use; trading one obscure failure for another is not a
 * fix.
 */
function foldCase(hay: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let at = 0;
  for (const ch of hay) {
    const lower = ch.toLowerCase();
    for (let n = 0; n < lower.length; n++) map.push(at);
    folded += lower;
    at += ch.length;
  }
  map.push(hay.length);
  return { folded, map };
}

/** What `foldCase` returns: the folded text, and where each unit came from. */
interface Folded {
  folded: string;
  map: number[];
}

/**
 * Every place `needle` appears in `hay`, case-insensitively.
 *
 * Takes the fold rather than making it, because the fold depends only on `hay`
 * and `hay` does not change while somebody types. `folds` below holds it.
 */
function literalSpans(
  hay: string,
  needle: string,
  { folded, map }: Folded,
): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  /* The needle is folded the same way, and its *folded* length is what steps
     the search forward — the two can differ, and stepping by the original's
     length is how you would get overlapping matches back. */
  const lowerNeedle = foldCase(needle).folded;
  if (lowerNeedle.length === 0) return spans;
  for (
    let i = folded.indexOf(lowerNeedle);
    i !== -1;
    i = folded.indexOf(lowerNeedle, i + lowerNeedle.length)
  ) {
    const start = map[i] ?? hay.length;
    const end = map[i + lowerNeedle.length] ?? hay.length;
    /* Can only fire if a fold expanded the last character of the match, which
       would make the span empty in the original. `hitMarks` drops empty spans
       anyway; dropping it here keeps it out of the results list too. */
    if (end > start) spans.push({ start, end });
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
  /* `page`, rather than the two lines this used to be — which were `page`'s
     first and third fields spelled out a second time. Typing another character
     re-ran them over the whole article; now the second keypress parses nothing.
     The `index` map `page` also builds is unused here, and costs one pass over
     an array this function is about to walk anyway. */
  const { texts, scale } = page(blocks);
  const folded = foldedTexts(blocks);
  blocks.forEach((block, index) => {
    const text = texts[index] ?? "";
    const fold = folded[index] ?? { folded: "", map: [0] };
    for (const span of literalSpans(text, needle, fold)) {
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
        /* A literal match is the letters you typed appearing where they appear.
           There is no judgement in it and there is nothing to be a judgement
           *about*, which is what `null` says here. */
        valence: null,
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
/**
 * The blocks, rendered and measured once — everything `resolveOne` needs that
 * does not vary per passage.
 *
 * Built once per array of blocks and shared, for the reason the note above
 * `resolveHits` gives: rendering every block's text is the one genuinely
 * expensive thing in this file, and a ruler rebuilt per source would measure
 * each result's *place* against a scale reconstructed from the same numbers.
 */
interface Page {
  index: Map<BlockId, number>;
  texts: string[];
  scale: Ruler;
}

/**
 * The same article, asked again, is not parsed again.
 *
 * `renderedText` is `document.createElement("div")`, an `innerHTML =` and a
 * `textContent` read — a full HTML parse, per block. `page` does it for every
 * block, and **six** exported resolvers call `page`. Two of them call it inside
 * a loop: one `resolveClaim` per shown claim (ClaimsPanel.tsx) and one
 * `resolveCriterion` per ticked criterion (CriteriaPanel.tsx). So referee mode
 * was O(claims × blocks) parses, and ticking one criterion paid for all of them
 * again; a literal search paid a whole pass per keypress.
 *
 * **Keyed on the array's identity, not on its contents**, which is the right key
 * here for a reason worth stating: `article.blocks` is replaced wholesale when
 * the article changes, and nothing on the client mutates a blocks array in
 * place — so a surviving identity is a guarantee that the html behind it
 * survived too. A content hash would be a parse to avoid a parse.
 *
 * A `WeakMap` rather than a `Map` so a closed article is collectable: the entry
 * dies with the array, there is nothing to invalidate and no size to bound. It
 * is also why this is not a `useMemo` in some component — five different
 * components ask this question, and they should share one answer rather than
 * hold five.
 *
 * The `Page` handed back is **shared, and must not be mutated.** Everything
 * that takes one only reads it.
 */
const pages = new WeakMap<Block[], Page>();

/**
 * And the case-folded form of the same text, for the one caller that needs it.
 *
 * `foldCase` walks the article by code point and allocates a `number[]` as long
 * as it, per block. Inside `literalSpans` that ran **once per block per
 * keypress**, which is the other half of the cost `page` above addresses — the
 * parse was the loud half, this is the one that survives it.
 *
 * **Its own `WeakMap` rather than a field on `Page`, and lazily**, because
 * `resolveHits` and the four other resolvers never fold anything. Most readers
 * never type in the find box at all, and they should not be holding an offset
 * map the length of the article in case they do. Keyed on the same `blocks`
 * array, so the two caches live and die together.
 */
const folds = new WeakMap<Block[], Folded[]>();

function foldedTexts(blocks: Block[]): Folded[] {
  const had = folds.get(blocks);
  if (had) return had;
  const built = page(blocks).texts.map(foldCase);
  folds.set(blocks, built);
  return built;
}

function page(blocks: Block[]): Page {
  const had = pages.get(blocks);
  if (had) return had;
  const texts = blocks.map((b) => renderedText(b.html));
  const built: Page = {
    index: new Map(blocks.map((b, i) => [b.id, i])),
    texts,
    scale: ruler(texts),
  };
  pages.set(blocks, built);
  return built;
}

/**
 * One passage — a block id plus the words somebody quoted — resolved against
 * the prose as it is actually rendered.
 *
 * **Extracted so the third source could not drift from the first two.** This
 * was the body of `resolveHits`, and when `resolveIdea` arrived the choice was
 * to repeat it or to lift it. Repeating it would have meant two copies of the
 * `whole` rule, and that rule has already been got wrong once here in exactly
 * the way a second copy invites (see the comment on `located` below).
 *
 * `null` when the article no longer has the block. That can only happen after a
 * re-extraction, and an id that is simply gone has nowhere to point; the
 * alternative is a row in the list that does nothing when pressed.
 */
function resolveOne(
  at: Page,
  spec: {
    key: string;
    blockId: BlockId;
    runId: string | null;
    slot: number | null;
    quote: string;
    start?: number;
    confidence: number | null;
    /**
     * **Required, and `null` at five of the six call sites** — see `Found`.
     *
     * Written out by every caller rather than defaulted, so that a seventh
     * source has to decide whether it is making a judgement about the passage
     * instead of inheriting the answer of whichever resolver was copied.
     */
    valence: number | null;
    reasoning: string | null;
  },
): Found | null {
  const i = at.index.get(spec.blockId);
  if (i === undefined) return null;
  const text = at.texts[i] ?? "";
  /* `whole` comes from whether `findQuote` found anything, and from nothing
     else. The first version of this inferred it — a span covering the entire
     block, plus the quote not equalling the block's text — and real data broke
     it within the hour: a quote that genuinely *is* the whole block produces
     exactly the shape the fallback produces, and the model had retyped a line
     break as a space, so a perfect match was labelled "the exact words have
     moved". A derived fact that usually agrees with a known one is the shape of
     most of docs/reusable/silent-success.md. */
  const located = findQuote(text, spec.quote, spec.start);
  const whole = located === null;
  const span = located ?? { start: 0, end: text.length };
  return {
    key: spec.key,
    blockId: spec.blockId,
    runId: spec.runId,
    slot: spec.slot,
    index: i,
    ...span,
    confidence: spec.confidence,
    valence: spec.valence,
    reasoning: spec.reasoning,
    short: whole
      ? snippet(text, { start: 0, end: 0 }, SHORT_SNIPPET)
      : snippet(text, span, SHORT_SNIPPET),
    long: whole
      ? snippet(text, { start: 0, end: 0 }, LONG_SNIPPET)
      : snippet(text, span, LONG_SNIPPET),
    /* `span.start`, which for a fallback is 0 — the top of the block. That is
       the honest answer: the whole paragraph is marked, so where in it the
       source meant is exactly what we do not know. */
    at: placeOf(at.scale, i, span.start),
    whole,
  };
}

/**
 * One idea's occurrences, resolved into the same `Found[]` everything
 * downstream reads.
 *
 * **The third arm, after the literal matcher and the meaning search.** Nothing
 * below this line knows or cares which of the three produced a passage — the
 * marks, the paragraph bar, the spine lanes and the ordering all read `Found`
 * and nothing else — which is why an entire mode's worth of highlighting cost
 * one function.
 *
 * Two things about the arguments are decisions rather than plumbing:
 *
 * - **`confidence: null`.** A search hit's confidence answers *is this what you
 *   asked for*, and nobody asked the article a question here. `null` is the
 *   value a literal word-match already carries, so the threshold, the ordering
 *   and the wash all already know what to do with it — `keepAbove` reads it as
 *   certain rather than as zero, which is the behaviour a passage with no
 *   opinion attached should have.
 * - **A real `slot`, and a real `runId`.** The lane in the rail is keyed by run
 *   id, so an idea would get its own lane whatever its slot were; the slot is
 *   needed for the *paragraph bar*, which deliberately drops `null` slots
 *   (`blockHues` below). An idea with no slot would paint the rail and leave
 *   the bar blank, which looks like a rendering bug and is not one.
 */
export function resolveIdea(
  blocks: Block[],
  idea: { id: string; slot: number; occurrences: IdeaOccurrence[] },
): Found[] {
  const at = page(blocks);
  const out: Found[] = [];
  for (const [n, o] of idea.occurrences.entries()) {
    const one = resolveOne(at, {
      /* Same three-part key as a search hit, and for the same reason: one idea
         can be needed twice in the same paragraph, and `blockId:n` alone stopped
         being unique the moment more than one source could be on screen. */
      key: `${idea.id}:${o.blockId}:${n}`,
      blockId: o.blockId,
      runId: idea.id,
      slot: idea.slot,
      quote: o.quote,
      ...(o.start !== undefined && { start: o.start }),
      confidence: null,
      /* An idea is a proposition the piece assumes, and where it is assumed.
         Nothing here judges it. */
      valence: null,
      reasoning: o.reasoning,
    });
    if (one) out.push(one);
  }
  return out;
}

/**
 * **All the quotes the panel is showing**, resolved into the same `Found` every
 * search hit and idea becomes.
 *
 * A quote is a `{blockId, text, start}`, which is what `resolveOne` already
 * takes — so this is a shape change and nothing else, and that is deliberate: a
 * second way of drawing a marked passage is a second thing to keep in step with
 * the first. The prose gets the same wash, the rail gets the same lane, and the
 * panel steps through it with the same component.
 *
 * **Plural since 2026-09-05**, and that is the whole of one feedback report.
 * It took one quote — the selected one — so quotes mode drew nothing at all
 * until a row was pressed, and the `?bar=` slider changed the list without
 * changing the page. Greg asked to be able to *"skim through it just reading
 * the stuff that is marked"*, which is what search already does through this
 * same pipe: one call, every passage, marked at once.
 *
 * Four fields worth a word:
 *
 * - **`confidence: null`.** A search hit's confidence answers *is this what you
 *   asked for*, and nobody asked the article a question. The value a literal
 *   word-match already carries, so `keepAbove`, the ordering and the wash all
 *   already know what to do with it.
 * - **`reasoning` is the model's `reason`**, which the panel shows in a tooltip
 *   rather than as body text. It reaches the prose hover card too, which is the
 *   right place for it: it is a caption on the passage either way.
 * - **A real `slot`**, so the paragraph bar has a hue — `blockHues` drops `null`
 *   slots, so a quote without one would paint the rail and leave the bar blank,
 *   which looks like a rendering bug and is not one. Slot `0` for every quote:
 *   the categorical palette says *which search found this*, and there is only
 *   one thing here that found anything.
 * - **`runId` is `QUOTES_RUN` and not the quote's own id**, which is the one
 *   thing the plural version had to change. The rail packs one lane per run id
 *   (spine-marks.ts § `laneOrder`) and the gutter is ten pixels, so an id per
 *   quote gives a sixteen-lane rail of 1.5px marks laid over each other and
 *   ordered sideways by an arbitrary string. **The quotes are one source**, the
 *   way the literal matcher is one source; the identity of the individual quote
 *   stays in `key`, which is what the mark, the ring and the hover card read.
 *
 * **The `text` here is the article's own characters**, not the model's typing —
 * src/quotes.ts § `place` slices the block. So this re-find is looking for the
 * real words, which is the one place the two halves of src/quote-match.ts are
 * allowed to differ: this side runs both passes, because the rendered text
 * genuinely lacks whitespace `extractText` invented.
 *
 * **And it deliberately sends no `start`.** The stored offset is in
 * `block.text`'s space and this search is in the rendered text's space; the two
 * drift by every character `extractText` collapsed or inserted, so the hint
 * would pick a repeat rather than disambiguate between them. See the parameter
 * below.
 *
 * A quote naming a block the article no longer has is dropped and the rest are
 * kept, which is `resolveOne`'s rule and matters more here than anywhere else:
 * the quotes stamp does not cover the article's text, so a stale artefact is
 * the ordinary case rather than the exceptional one.
 */
export function resolveQuotes(
  blocks: Block[],
  /**
   * **No `start`, deliberately** — see the note in the docstring above.
   *
   * The stored offset is measured in `block.text`; this function searches the
   * *rendered* text, which is a different string of a different length. Passing
   * it as `near` does not disambiguate, it misdirects: GPT Sol reproduced a
   * table where `block.text` put the first occurrence at 120 while the rendered
   * occurrences were at 60 and 126, so the hint chose the second sentence and
   * the mark landed on the wrong one.
   *
   * Omitting it is not a loss here, and that is what makes this the right fix
   * rather than a retreat: `locate` in src/quotes.ts always takes the **first**
   * occurrence, so the first rendered occurrence is the one that was meant.
   * Search and ideas cannot do this — their offsets come from a model naming a
   * block — which is why the general fix is an occurrence ordinal and is not
   * built.
   */
  quotes: readonly { id: string; blockId: BlockId; text: string; reason?: string }[],
): Found[] {
  const at = page(blocks);
  const out: Found[] = [];
  for (const quote of quotes) {
    const one = resolveOne(at, {
      key: quoteMarkKey(quote.id, quote.blockId),
      blockId: quote.blockId,
      runId: QUOTES_RUN,
      slot: 0,
      quote: quote.text,
      confidence: null,
      /* A quote is a line worth keeping. Which is a judgement of a sort, and not
         one with two ends. */
      valence: null,
      reasoning: quote.reason ?? "",
    });
    if (one) out.push(one);
  }
  /* Document order, so the marks are in the order the reader meets them
     whatever `?rank=` the panel is listing them in. Nothing downstream sorts a
     `Found[]`, and `blockMatches` counts in whatever order it is handed. */
  return orderFound(out, "document");
}

/**
 * The one identity every quote's marks share, and therefore its single lane in
 * the rail — see `resolveQuotes` above for why it is not the quote's own id.
 *
 * A literal string rather than `null`, which is the literal matcher's and means
 * *no colour of its own*; quotes do have one, `slot: 0`.
 */
export const QUOTES_RUN = "quotes";

/**
 * A quote's key among the marks — **one place, because two places drift.**
 *
 * The same three-part shape as a hit and an occurrence, with `0` for the index:
 * a quote is exactly one passage, so there is no second one to tell apart, and
 * keeping the shape means nothing downstream has to know which of the sources
 * it is looking at.
 *
 * Exported because the band needs it to say *which quote the reader pressed*
 * (`mark.hit[data-hit-open]`) without walking the resolved list — and computing
 * that string in two files is how the ring comes to be about a quote that is
 * not the selected one.
 */
export function quoteMarkKey(id: string, blockId: BlockId): string {
  return `${id}:${blockId}:0`;
}

/**
 * One timeline event's occurrences, resolved into the same `Found[]` the ideas
 * and the search hits become.
 *
 * `resolveIdea` with two fields removed, and both removals are the artefact
 * being honest rather than this being a lesser version of it:
 *
 * - **No `reasoning`.** A timeline occurrence is `{ blockId, quote, start }` and
 *   nothing else — the model is asked where the event is mentioned, never for a
 *   line about why. The row shows the article's words; there is no commentary to
 *   caption them with, and inventing an empty string here would put a blank
 *   caption slot into the prose hover card.
 * - **`slot: 0`.** Timeline paints no lane down the rail — that is on the
 *   deferred list with the marks (docs/plans/260831i-timeline-mode.md § Appendix), so
 *   there is no palette to assign from. Zero is the value `assignSlots` would
 *   give the first row anyway, so the wash in the prose is the ordinary one.
 *
 * **`start` is passed**, unlike `resolveQuote` next door, and for the reason
 * that one gives: these offsets come from a model naming a block, so the first
 * rendered occurrence is not necessarily the one meant. Same call as
 * `resolveIdea`, which has the same provenance.
 */
export function resolveTimelineEvent(
  blocks: Block[],
  event: { id: string; occurrences: TimelineOccurrence[] },
): Found[] {
  const at = page(blocks);
  const out: Found[] = [];
  for (const [n, o] of event.occurrences.entries()) {
    const one = resolveOne(at, {
      /* The same three-part key as a hit, an occurrence and a quote. One event
         really can be mentioned twice in the same paragraph — the test article
         recounts the same three months once per civilisation — so `blockId:n`
         alone is not an identity. */
      key: `${event.id}:${o.blockId}:${n}`,
      blockId: o.blockId,
      runId: event.id,
      slot: 0,
      quote: o.quote,
      start: o.start,
      confidence: null,
      /* When the piece says a thing happened. There is no direction in a date. */
      valence: null,
      reasoning: null,
    });
    if (one) out.push(one);
  }
  return out;
}

/**
 * One referee criterion's results, resolved into the same `Found[]` everything
 * downstream reads.
 *
 * **The fifth arm**, after the literal matcher, the meaning search, the ideas
 * and the quotes — and it is the fifth for the reason the third one was: an
 * entire sub-mode's worth of marking costs one function, because nothing below
 * this line knows or cares which source produced a passage.
 *
 * Three of the arguments are decisions rather than plumbing:
 *
 * - **`confidence` is the result's own**, unlike ideas and quotes which pass
 *   `null`. A referee criterion really does carry a 0–100 relevance the model
 *   reported, in the same unit and with the same meaning as a `SearchHit`'s
 *   (src/referee-criteria.ts § `Judged.confidence`), so the wash strength, the
 *   `?conf=` bar and the confidence ordering all mean what they already mean.
 * - **A real `slot`, and `runId` is the criterion's id.** One lane in the rail
 *   per criterion, and a slot so the paragraph bar has a hue — `blockHues`
 *   drops `null` slots, so a criterion without one would paint the rail and
 *   leave the bar blank, which looks like a rendering bug and is not one.
 * - **`start` is passed**, like a search hit's and an idea's and unlike a
 *   quote's: these offsets come from a model naming a block, so the first
 *   rendered occurrence is not necessarily the one meant.
 *
 * ## The valence, which this function used to drop on purpose
 *
 * A `DivergingResult` carries a −100…+100 valence, and until 2026-09-02 **none
 * of it reached `Found`**: the prose said which criterion and the panel said
 * which way. Greg reversed that, having read a paper with it:
 *
 * > I'm not convinced that the highlighting colour in the text matches the
 * > colour in the Referee Claims. Here, "So if extrapolation" counts against on
 * > the left, and yet it is highlighted with a green line in the text on the
 * > right. … I was thinking that it should match the colour of the left-hand
 * > panel. If that's set to red/green, so should the prose be.
 *
 * He is describing a real defect rather than a preference. The two marks were
 * painted from two palettes with nothing on screen saying they were two, so a
 * criterion that happened to draw the green identity slot underlined *every* one
 * of its passages green, including the ones the panel called "counts against" in
 * red. So the valence comes through now, for `diverging` results only, and
 * `hitMarks` turns it into a ramp token.
 *
 * **What that costs, said plainly.** The prose stripe no longer answers *which
 * criterion said this* — the bar down the left of the paragraph and the rail
 * still do, from `slot`, which is why `blockHues` and `spine-marks.ts` were
 * deliberately left reading it. And a stripe that carries a verdict may not
 * carry it in colour alone (docs/project/colour-scales.md), which is paid for by
 * the sign glyph `annotateHtml` draws and the key in the Criteria panel.
 * docs/plans/260902f-make-referee-mode-understandable.md has the whole argument,
 * including the two things it knowingly does not fix.
 *
 * **The number and not a token**, for the reason `Found.valence` gives: this
 * function must not learn which ramp the reader is looking at.
 */
export function resolveCriterion(
  blocks: Block[],
  criterion: { id: string; slot: number; results: RefereeResult[] },
): Found[] {
  const at = page(blocks);
  const out: Found[] = [];
  for (const [n, r] of criterion.results.entries()) {
    const one = resolveOne(at, {
      /* The same three-part key as a hit, an occurrence and a quote — one
         criterion can match twice in the same paragraph, so `blockId` alone is
         not an identity, and with several criteria switched on at once
         `blockId:n` is not either. */
      key: `${criterion.id}:${r.blockId}:${n}`,
      blockId: r.blockId,
      runId: criterion.id,
      slot: criterion.slot,
      quote: r.quote,
      ...(r.start !== undefined && { start: r.start }),
      confidence: r.confidence,
      /* `diverging` only, and read off the result's own discriminant rather
         than off the criterion's config — the two can disagree. A criterion
         answered while it was `single` and later edited would have `single`
         results under a `diverging` config, and `r.kind` is the field that
         says what the model actually returned. */
      valence: r.kind === "diverging" ? r.valence : null,
      reasoning: r.reasoning,
    });
    if (one) out.push(one);
  }
  return out;
}

/**
 * One claim's passages, resolved into the same `Found[]` everything downstream
 * reads.
 *
 * **The sixth arm**, after the literal matcher, the meaning search, the ideas,
 * the quotes and the referee's criteria — and it is the sixth for the reason the
 * third one was: an entire sub-mode's worth of marking costs one function,
 * because nothing below this line knows or cares which source produced a
 * passage.
 *
 * Three of the arguments are decisions rather than plumbing, and all three are
 * the same decision:
 *
 * - **`confidence: null`**, like an idea's and a quote's and unlike a
 *   criterion's. There is no number on a `ClaimPassage` and there is not going
 *   to be one (src/referee-claims.ts § `ClaimPassage`): the row asserts that a
 *   passage takes a claim up, never how well. `null` is what a literal
 *   word-match already carries, so the threshold, the ordering and the wash all
 *   already know what to do with it — `keepAbove` reads it as certain rather
 *   than as zero, which is the behaviour a passage with no opinion attached
 *   should have. Inventing a 100 here would put a number on the screen that
 *   means something different from the number beside it.
 * - **The claim itself is not marked, only its passages.** The claim's own
 *   sentence is where the paper *states* the thing; painting it in the same hue
 *   as the passages would say the abstract is evidence for the abstract. The
 *   panel row jumps to it; the prose does not wear it.
 * - **A real `slot`, and `runId` is the claim's id.** One lane in the rail per
 *   claim, and a slot so the paragraph bar has a hue — `blockHues` drops `null`
 *   slots, so a claim without one would paint the rail and leave the bar blank,
 *   which looks like a rendering bug and is not one.
 *
 * **`start` is passed**, like a search hit's and a criterion's and unlike a
 * quote's: these offsets come from a model naming a block, so the first rendered
 * occurrence is not necessarily the one meant.
 */
export function resolveClaim(
  blocks: Block[],
  claim: { id: string; slot: number; passages: ClaimPassage[] },
): Found[] {
  const at = page(blocks);
  const out: Found[] = [];
  for (const [n, p] of claim.passages.entries()) {
    const one = resolveOne(at, {
      /* The same three-part key as a hit, an occurrence, a quote and a
         criterion's result: one claim can be taken up twice in the same
         paragraph, so `blockId` alone is not an identity, and with several
         claims switched on at once `blockId:n` is not either. */
      key: `${claim.id}:${p.blockId}:${n}`,
      blockId: p.blockId,
      runId: claim.id,
      slot: claim.slot,
      quote: p.quote,
      start: p.start,
      confidence: null,
      /* **The identity-only path, and it stays that way.** A claim's passage
         says the paper takes this claim up here; whether it carries the claim
         is the referee's call and not the model's
         (docs/project/referee-mode.md § Claims). There is no valence to carry
         and a claim mark wears its claim's own hue. */
      valence: null,
      reasoning: p.reasoning,
    });
    if (one) out.push(one);
  }
  return out;
}

export function resolveHits(blocks: Block[], runs: ActiveRun[]): Found[] {
  const at = page(blocks);
  const found: Found[] = [];
  for (const run of runs) {
    for (const [n, hit] of run.hits.entries()) {
      const one = resolveOne(at, {
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
        quote: hit.quote,
        ...(hit.start !== undefined && { start: hit.start }),
        confidence: hit.confidence,
        /* A search answers *is this what you asked for*, which the confidence
           already carries. It never answers *is this good*. */
        valence: null,
        reasoning: hit.reasoning,
      });
      if (one) found.push(one);
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
export function orderFound(found: Found[], order: HitOrder): Found[] {
  const copy = [...found];
  copy.sort((a, b) =>
    order === "confidence" && (a.confidence ?? 100) !== (b.confidence ?? 100)
      ? (b.confidence ?? 100) - (a.confidence ?? 100)
      : a.index - b.index || a.start - b.start,
  );
  return copy;
}

/* ------------------------------------------------------------ prioritised --
   The third order, added 2026-08-26 at Greg's request:

   > add a "Prioritised" ordering/filtering (kinda like how we do with
   > Glossary) that orders by place but thresholds by confidence, and a
   > threshold slider to the UI

   It is the glossary's prioritised order, and since 2026-09-03 it is that
   without qualification: **all three thresholds hide what is below them and
   say how many.** The shared rule is in threshold.ts, and this file keeps only
   the unit (0–100 confidence), the track and the copy.

   **This comment used to argue the opposite, and the reversal is worth
   naming.** It said *"the glossary groups; this hides"* — that a glossary is a
   reference list, a term you cannot find is a term you have lost, and only a
   search is the kind of errand where a weak answer should go away. Greg looked
   at the built thing and disagreed:

   > I think it would be clearer if it only showed the stuff above threshold
   > (with an indication below perhaps that "N hidden…"). And there are other
   > modes with thresholds - they should work the same way.
   >
   > — Greg, 2026-09-03

   The reference-list argument did not survive contact, and the reason is that
   it treated hiding as loss. The bar is on screen with its number, the foot
   line says how many it is holding back, and dragging it left is one gesture:
   **a term is not lost when the control that hid it is the control in your
   hand.** What the argument got right, and what remains true, is that hiding
   is worth *more* here than next door — the results the panel drops lose their
   marks in the prose too, because `App.tsx` computes one array and hands it to
   both. Hiding is also the only reading of "orders by place" that is true: two
   groups is not place order, it is group order with place inside it.

   **The cost is that a filter can silently swallow everything**, which is the
   failure this codebase keeps catching itself in
   (docs/reusable/silent-success.md). So nothing here is allowed to be quiet:
   the foot line (`hiddenNote`) says how many are hidden in every state
   including none and all, the count beside the slider is `N of M` rather than
   `N`, and the panel's own header keeps reporting the unfiltered total. */

/**
 * The bar's **starting** position, on the 0–100 scale the rows print.
 *
 * `50` because it is the midpoint of the scale the rows print, and a threshold
 * the reader can locate on a number they can already see beats one they have to
 * be told about. **Not** "more likely than not": this confidence is the model's
 * judgement about its own answer and explicitly not a probability
 * (docs/project/search.md § What the number means), so reading the halfway
 * point as a coin-flip would be the flattering explanation the hover card was
 * rewritten to avoid. Halfway up *worth a look* → *probably*, no more than
 * that. An absolute starting point
 * rather than a relative "top half", for the reason the glossary's gate gives:
 * when the model's confidences run hot or cold an absolute bar degenerates to
 * *no filtering*, which is the list the reader had before, while a relative one
 * would always hide half of them however sure the model was.
 *
 * A default rather than a constant: `?conf=` overrides it, and that parameter
 * deliberately has no default of its own so "absent" keeps meaning nobody has
 * touched it. See `confParam` in params.ts.
 */
export const PRIORITY_CONF = 50;

/** One step of the slider, and therefore how precise `?conf=` gets. */
export const CONF_STEP = 1;

/**
 * The bar applied to a list of results — the survivors, and how many went.
 *
 * **A result with no confidence always survives**, which is `survivesThreshold`
 * in threshold.ts and the one line in the feature that must not be got wrong.
 * Two different things arrive with a null confidence and the rule is right for
 * both:
 *
 *  - **Every literal match.** Words mode has no confidence to report at all, so
 *    treating null as zero would empty that list completely the moment an
 *    `?order=prioritised` link was opened there. The same `?? 100` that makes
 *    `orderFound` sort a literal match as certain, for the same reason: absent
 *    is not low.
 *  - **A malformed stored hit.** `SearchHit.confidence` is typed non-null and
 *    `validateHits` enforces it, but saved JSON is cast rather than re-validated
 *    on the way back in (src/searches.ts), so a null can reach here from an old
 *    or hand-edited file. Showing it is the lossless direction: a result the
 *    reader can see and judge, rather than one silently withheld on the
 *    strength of a missing field. GPT Sol's review, 2026-08-26.
 *
 * Note that `runId === null` — not nullness of the confidence — is what
 * actually distinguishes a literal hit from a model one, which is why the tests
 * below exercise both spellings rather than assuming they coincide.
 *
 * **One result rather than a filter beside a counter.** `ConfSlider` prints
 * `N of M` and a foot line saying how many are hidden, and both come out of
 * this — a count that disagrees with the list under it is the failure the whole
 * threshold module exists to make impossible.
 */
export function applyConf(found: Found[], gate: number): ThresholdResult<Found> {
  return applyThreshold(found, gate, (f) => f.confidence);
}

/**
 * The results that survive the bar. Only ever called for `prioritised`.
 *
 * A thin wrapper, and it stays a separate name because of where it is called:
 * `App.tsx` applies the threshold in **exactly one place**, so what reaches the
 * panel is what reaches the prose and the rows can never be a different set
 * from the marks. No second filter may appear in `SearchPanel`.
 */
export function keepAbove(found: Found[], gate: number): Found[] {
  return applyConf(found, gate).visible;
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
 *
 * ## Where the palette is resolved, and why it is here
 *
 * A `Found` carrying a valence becomes a mark painted by **direction** rather
 * than by which source found it, and this is the line where the number becomes
 * a ramp token. Not in `resolveCriterion`, which would then have to know which
 * ramp the reader is looking at (`Found.valence` says why); not in
 * `annotateHtml`, which knows nothing about referees and should not start. This
 * is where the Reader hands the display scale in, so this is where a `−64`
 * becomes `var(--div-rg-1-rgb)` and the word `against`.
 *
 * **`scale` is required rather than defaulted**, although five of the six
 * sources never produce a valence at all. A default would make forgetting to
 * thread `?refscale=` through look exactly like passing `rg` deliberately, and
 * the whole point of one scale for the whole mode is that the two ramps put red
 * at opposite ends of the truth.
 *
 * **The pressed result is applied on top of a cached, `openKey`-free set of
 * marks** — see `unpressed` below, which is where that matters and why.
 */
export function hitMarks(
  found: Found[],
  openKey: string | null,
  scale: DivergingScale,
): Map<BlockId, Mark[]> {
  const base = baseMarks(found, scale);
  /* A copy of the map, so the per-block arrays below can differ from the cached
     ones without the cache ever seeing it. */
  const byBlock = new Map(base);
  if (openKey === null) return byBlock;
  for (const [blockId, marks] of base) {
    if (!marks.some((m) => m.id === openKey)) continue;
    byBlock.set(
      blockId,
      marks.map((m) => (m.id === openKey ? { ...m, open: true } : m)),
    );
  }
  return byBlock;
}

/**
 * The same marks **before anybody pressed one of them**, cached on the result
 * array's identity — the same key, and the same argument for it, as `pages`
 * above: nothing on the client mutates a `Found[]` in place (`orderFound` and
 * `keepAbove` both copy), so a surviving identity guarantees the results behind
 * it survived too.
 *
 * **Why the pressed key is applied on top rather than folded in.** `hitMarks`
 * used to bake `open` into every mark it built, so pressing one result in the
 * panel handed `TableView` a fresh array for *every* block with a hit in it —
 * and `proseHtml` decides a block can reuse its html by comparing those arrays
 * by identity, so the press re-annotated the whole article to move one ring.
 * This is the split `openTerm` has had from `termMarksByBlock` since
 * 2026-08-26; `TermSelection.open` in annotate.ts gives the argument, and
 * docs/plans/260905i-… § Stage 2 has the measurement.
 *
 * The arrays handed back are **shared, and must not be mutated** — as `page`'s
 * are. Every caller either reads them or spreads them into a new array.
 */
const unpressed = new WeakMap<Found[], Map<DivergingScale, Map<BlockId, Mark[]>>>();

function baseMarks(found: Found[], scale: DivergingScale): Map<BlockId, Mark[]> {
  const byScale = unpressed.get(found) ?? new Map<DivergingScale, Map<BlockId, Mark[]>>();
  const had = byScale.get(scale);
  if (had) return had;
  const byBlock = new Map<BlockId, Mark[]>();
  for (const f of found) {
    if (f.end <= f.start) continue;
    const list = byBlock.get(f.blockId) ?? [];
    /* A valence with no slot cannot happen — `resolveCriterion` is the only
       source of one and it always carries the criterion's slot — and `Mark`'s
       type refuses it rather than trusting that. So the check is on both, and
       an impossible pair falls back to the identity mark it would have been. */
    const painted =
      f.valence !== null && f.slot !== null
        ? { slot: f.slot, hue: valenceRgbToken(scale, f.valence), dir: valenceDirection(f.valence) }
        : { slot: f.slot };
    list.push({
      id: f.key,
      start: f.start,
      end: f.end,
      kind: "hit",
      ...painted,
      strength:
        f.confidence === null
          ? 1
          : MIN_STRENGTH + (1 - MIN_STRENGTH) * (Math.min(100, Math.max(0, f.confidence)) / 100),
    });
    byBlock.set(f.blockId, list);
  }
  byScale.set(scale, byBlock);
  unpressed.set(found, byScale);
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
 * What matched in each block: **which searches, and how many times.**
 *
 * The bar down the left of a paragraph and the marks under its phrases answer
 * two different questions, and that is why they are scoped differently. A mark
 * says *these words matched, and these searches found them*; the bar says
 * *there is something in this paragraph*, which is the signal you catch while
 * scrolling past at speed (`blockStrength` above has the borrowed reasoning).
 * So a paragraph where one search matched the first sentence and another
 * matched the last gets **two** segments in its bar and **one** rule under each
 * phrase — and both are true.
 *
 * ## Identity is the run, not the slot
 *
 * The obvious shape for this is a set of palette slots, and it was that until a
 * GPT Sol review, 2026-08-26, pointed out what it costs: **slots deliberately
 * repeat past the eighth search** (hit-colours.ts § assignSlots), and select-all
 * on an article with nine saved searches switches on nine. Keyed by slot, the
 * ninth search and whichever earlier one shares its hue collapse into one
 * entry — one mark in the rail instead of two, and one lane carrying the union
 * of two searches' shapes. Silent, and precisely wrong in the case the reader
 * asked for the most.
 *
 * So a search is identified by its **run id**, and the slot rides along as the
 * thing that decides its colour. Two searches wearing the same hue then get two
 * of everything, which is honest: the palette has run out, and the panel says
 * so by printing the criterion beside every dot.
 *
 * ## Why `null` survives here and does not survive `blockHues`
 *
 * A literal match belongs to no saved search and has no colour of its own —
 * both its id and its slot are `null`, and the paragraph bar drops it so the
 * bar falls back to the one fixed search hue it has always been. The **spine**
 * cannot do that: it has nothing to fall back to, and dropping the nulls there
 * would mean the rail showed every meaning-search and *nothing at all* in words
 * mode, which is the matcher a reader is most likely to be using. So the null
 * is carried, and spine-marks.ts is where it becomes a lane. Getting this wrong
 * would have been silent in the only way that matters: the feature would work
 * perfectly for every search that cost money and do nothing for the free one.
 *
 * `count` is every individual match in the block, not the number of searches
 * that found it — the two differ whenever one search quotes the same paragraph
 * twice, and it is the first that answers "how much is in here".
 */
export interface MatchingSearch {
  /** The saved search, or `null` for a literal match. */
  runId: string | null;
  /** Its palette slot, or `null` for a literal match — a colour, not an identity. */
  slot: number | null;
}

export interface BlockMatch {
  /** The searches that matched here, in a fixed order. */
  searches: MatchingSearch[];
  /** How many individual matches fall in this block. */
  count: number;
}

/**
 * A fixed order for the searches in a block: by slot, then by run id.
 *
 * By **slot** first so the same pair of searches draws the same thing in every
 * paragraph they share — the reason `annotateHtml` sorts its stripes, and the
 * failure otherwise is that the reader is reading an order that came out of the
 * result list's sort, which they can change with the order control.
 *
 * By **run id** as the tie-break, which only does any work once the palette has
 * wrapped and two searches wear one hue. Arbitrary, and it has to be *stable
 * and arbitrary* rather than "whichever arrived first".
 */
function byColourThenId(a: MatchingSearch, b: MatchingSearch): number {
  const slotDiff = (a.slot ?? -1) - (b.slot ?? -1);
  if (slotDiff !== 0) return slotDiff;
  const left = a.runId ?? "";
  const right = b.runId ?? "";
  return left < right ? -1 : left > right ? 1 : 0;
}

export function blockMatches(found: Found[]): Map<BlockId, BlockMatch> {
  const byBlock = new Map<BlockId, { searches: Map<string, MatchingSearch>; count: number }>();
  for (const f of found) {
    const entry = byBlock.get(f.blockId) ?? { searches: new Map(), count: 0 };
    /* Keyed by the run id — `""` for a literal match, which has exactly one
       identity because the two matchers are never both on. Keyed by the slot,
       this is where the ninth search would have disappeared. */
    entry.searches.set(f.runId ?? "", { runId: f.runId, slot: f.slot });
    entry.count += 1;
    byBlock.set(f.blockId, entry);
  }
  return new Map(
    [...byBlock].map(([id, entry]) => [
      id,
      { searches: [...entry.searches.values()].sort(byColourThenId), count: entry.count },
    ]),
  );
}

/**
 * The same thing, as the paragraph bar wants it: **colours only, once each.**
 *
 * Derived from `blockMatches` rather than looping again, so there is one answer
 * to "which searches matched in this block" and two views of it. Two things are
 * dropped on the way, and both are right for a bar and wrong for the rail:
 *
 * - `null` slots — literal matches — get no segment at all, because a words
 *   search has no colour and cannot be one of several. The stylesheet falls
 *   back to the one fixed search hue when `data-hues` is absent.
 * - A slot two searches happen to share becomes **one** segment. The bar is
 *   divided into colours, and two segments of the same colour side by side is
 *   not a division, it is a wider segment drawn as two.
 */
export function blockHues(found: Found[]): Map<BlockId, number[]> {
  const out = new Map<BlockId, number[]>();
  for (const [id, match] of blockMatches(found)) {
    const slots = [
      ...new Set(match.searches.map((s) => s.slot).filter((s): s is number => s !== null)),
    ];
    if (slots.length > 0) out.set(id, slots);
  }
  return out;
}
