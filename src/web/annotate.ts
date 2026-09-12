/**
 * Drawing a persistent mark over part of a block's prose — the "there is a
 * comment here" artefact described in docs/project/comments.md.
 *
 * ## Why the offsets are DOM offsets, not `block.text` offsets
 *
 * The obvious anchor is a character offset into `block.text`. It is wrong.
 * `extractText` in src/blocks.ts collapses whitespace *and inserts a space at
 * every nested block boundary*, so its string and the string the browser
 * actually renders are different lengths. Offsets taken against one and applied
 * to the other land somewhere plausible and silently wrong — exactly the class
 * of failure docs/reusable/silent-success.md is about.
 *
 * So the offset space here is the concatenation of the **text nodes of
 * `block.html`**, which is what `Range.toString()` measures and what a
 * `TreeWalker` over `SHOW_TEXT` produces. Both sides of this file use that one
 * definition, and the browser's own parser computes it — no entity table, no
 * tag scanner, nothing that can drift from what the DOM does.
 *
 * ## Why marks are per-text-node runs
 *
 * A selection may start inside an `<em>` and end outside it. One `<mark>` around
 * the whole range would be malformed HTML (`<em>a<mark>b</em>c</mark>`) and the
 * browser would silently repair it into something else. So a mark becomes one
 * `<mark>` per text node it touches — always well-formed, because a wrap never
 * crosses an element boundary. The last run carries `data-mark-end`, which is
 * what the asterisk in styles.css hangs off, so a mark spanning three runs still
 * shows one marker.
 *
 * Offsets are a *disambiguator*, never the anchor: `resolveMark` re-finds the
 * quote by text and only uses the offset to choose between repeats. That is what
 * lets a comment survive an edit above it, in the same spirit as
 * docs/project/block-ids.md.
 */

import { termPattern, termSpans } from "../term-match.js";
import { PALETTE_SLOTS } from "./hit-colours.js";
import type { ValenceDirection } from "./valence.js";
import type { Block, BlockId, QuoteStroke } from "../types.js";
import { costOn, leafClock, noteCost } from "./annotation-cost.js";

/**
 * What a mark is *for*, and therefore how it is drawn and what listens to it.
 *
 * `cmt` is a comment: a persistent artefact the reader made, clickable, and it
 * carries the ✳ marker at its end. `chat` is a conversation started from that
 * selection — persistent and clickable in the same way, and since 2026-08-26 it
 * is the one a fresh selection makes (docs/plans/260826ab-chat-as-gateway.md); comments
 * are closed to new arrivals, so a `cmt` mark is now always an older one.
 * `term` is a glossary occurrence: standing —
 * every term in the list is drawn, in every mode, since 2026-08-26 — and inert
 * to the *click*, because pressing it should do what pressing the prose has
 * always done. Hovering one is not inert: it opens the term's card
 * (ProseHoverCard.tsx), which is the affordance that replaced the underline
 * appearing and disappearing. `hit` is a search result: transient in
 * the same way, inert in the same way, and the only kind whose *intensity*
 * carries information — see `strength`.
 *
 * **Any two of them can cover the same words**, and that is the case worth
 * being careful about: a reader can ask a question about a sentence that also
 * contains a term and also matches what they searched for. So the merged
 * `<mark>` carries whichever classes apply, and each kind's attributes are
 * populated from its own marks alone — a click handler that read a term's id
 * out of `data-comment` would try to open a comment that does not exist.
 *
 * **A `chat` and a `cmt` over the same words is the one overlap a reader can
 * click**, and only one of them can win. The handler in TableView.tsx prefers
 * the chat: it is the living artefact, and since comments can no longer be
 * created the overlap is always an older explanation. The comment does not
 * become unreachable — the Dock's drawer lists every comment for the article
 * and opens it — it loses a shortcut. A chooser is the right answer if these
 * turn out to be common, and they should be getting rarer.
 *
 * **This is why we did not need the CSS Custom Highlight API.**
 * docs/project/original-version/highlighting.md is emphatic that a third kind
 * of mark over the same prose is where a wrapper-span library gives up, because
 * HTML elements nest and two ranges that merely cross have no valid markup —
 * and it recommends `::highlight()` over `Range` objects instead. That
 * recommendation is right about the problem and was aimed at a different
 * solution to it: `annotateHtml` below does not wrap a range, it **cuts every
 * text node at every boundary and labels each piece with whichever marks cover
 * it**. Nothing nests, so nothing can fail to nest. The third kind cost this
 * file one entry in a union and one `if`, which is the evidence that the
 * approach holds; if a fourth ever needs per-mark *styling* that classes cannot
 * express, that is when to reconsider.
 */
export type MarkKind = "cmt" | "chat" | "term" | "hit";

/**
 * How many coloured rules one phrase can wear.
 *
 * Six, and it was four until a GPT Sol review pointed out that the reason given
 * for four was **arithmetically false**. That reason said a fifth stripe would
 * be sub-pixel; six stripes in a 6px band are 1 CSS pixel each, which is a
 * hairline but is a line, and every modern display draws it. Dropping a
 * search's mark is a real loss of provenance, and it was being justified by a
 * number nobody had done.
 *
 * Six rather than eight because the band cannot grow: the stripes live in the
 * leading below the text (styles.css § stacked hues), and past 6px they reach
 * the line underneath. Six is where the stripes hit 1px, which is the last
 * width that is still a mark rather than a suggestion.
 *
 * **What is lost past six, and why it is nearly unreachable.** This is the cap
 * on searches covering *the same phrase*, not on searches switched on — three
 * searches matching one article routinely touch different sentences and each
 * gets a full 2px rule. Seven searches whose model all quoted the same words is
 * not a case anybody has reached, and the palette only holds eight. When it
 * happens the reader loses the knowledge that a seventh search matched **here**;
 * they do not lose the search. It is still in the results list in its own
 * colour, and — since `blockHues` is capped separately and far higher — still
 * a segment in the bar down the left of the paragraph.
 */
export const HUE_STRIPES = 6;

/**
 * How many hues the **bar down the left of a paragraph** can draw — eight.
 *
 * A different cap from `HUE_STRIPES` for the reason the comment above gives:
 * the two marks have different amounts of room. The stripes share the few
 * pixels of leading under one line of text; the bar runs the whole height of
 * the paragraph. TableView.tsx sets it.
 *
 * **Its own constant since 2026-08-27, and that is the point of it.** It used
 * to be `CATEGORICAL_SLOTS`, which was the same number by coincidence and
 * stopped being so the day the palette grew to sixteen
 * (`PALETTE_SLOTS`, hit-colours.ts). The number here is not a property of the
 * palette at all: it is **how many `td.text.has-hit[data-hues="N"]` rules
 * styles.css actually defines**, because the gradient's stops are written out
 * per count. Set `data-hues="9"` and no rule matches, so the bar paints
 * nothing — the whole mark disappears rather than losing its ninth stripe,
 * which is the loud failure hiding inside a quiet-looking constant. Pinned
 * against the stylesheet by tests/annotate.test.ts.
 */
export const BAR_HUES = 8;

/**
 * **A hue that is not an identity** — the two fields a valence-painted mark
 * carries, and the reason they are a union rather than two more optionals.
 *
 * A referee's for/against criterion paints its marks by *direction* rather than
 * by which criterion found them (docs/project/referee-mode.md § Criteria, and
 * the plan that reversed the earlier rule). `hue` is the resolved ramp token —
 * `var(--div-rg-0-rgb)`, from `valenceRgbToken` — and `dir` is the same number
 * said in a word, which styles.css draws as a small sign so the colour is never
 * the only carrier.
 *
 * **The two arms make four wrong states unrepresentable.** `hue` without `dir`
 * would paint a judgement with nothing beside it; `dir` without `hue` would
 * print a sign on an identity mark; `hue` with a `null` slot would be a mark
 * whose paragraph bar has no colour to draw; and — since 2026-09-02 — a
 * `hue` on anything that is not a `hit`, which is why `kind` is on the union
 * rather than on `MarkBase`. Only a search-shaped mark is ever painted by
 * direction, and a `cmt` carrying a `dir` would have printed a sign after
 * somebody's own comment. GPT Sol's finding 11.
 *
 * A `hit` mark with neither is the ordinary identity case, and every `cmt`,
 * `chat` and `term` mark is the second arm by construction — `kind` stays
 * optional there because it always has been: absent means `cmt`, which is what
 * every mark was before the glossary.
 *
 * **What the type still does not decide is whether the slot is a *usable*
 * one** — an integer inside the palette — and that is deliberate. A nominal
 * `PaletteSlot` would need a validator called at every construction site, for a
 * value `assignSlots` already promises and that only ever reaches a
 * custom-property name through the guard in `annotateHtml` below. So the guard
 * is where a fractional or out-of-range slot is caught, and this comment says
 * so rather than claiming the compiler does it.
 */
type MarkValence =
  | { kind: "hit"; hue: string; dir: ValenceDirection; slot: number }
  | { kind?: MarkKind; hue?: undefined; dir?: undefined; slot?: number | null };

export type Mark = MarkBase & MarkValence;

interface MarkBase {
  /** The comment, or the glossary term, this mark belongs to. */
  id: string;
  /** Inclusive, in the block's rendered-text offset space. */
  start: number;
  /** Exclusive. */
  end: number;
  /**
   * The comment whose dialog is open — or the search result the reader has
   * pressed in the panel — so the prose can say which one it is.
   */
  open?: boolean;
  /**
   * How strongly to wash these words, 0–1. **`hit` marks only.**
   *
   * The one piece of information a mark carries in its appearance rather than
   * beside it, and it is here because a search hit has a confidence and the
   * reader ought to be able to see which matches the model was sure about. A
   * binary highlight hides the model's uncertainty, which is the opposite of
   * what docs/project/vision.md § Principles asks for.
   *
   * Where two hits cover the same words the **strongest wins**, rather than the
   * two adding up: opacity that accumulates would make an overlap of two
   * middling matches look more certain than either of them is, which is a claim
   * nobody made.
   */
  strength?: number;
  /**
   * Which saved search this hit belongs to, as a **palette slot** — `hit` marks
   * only, and `null` for a literal match, which belongs to no saved search.
   *
   * A number rather than a colour, for the reason the line above `strength`
   * gives about `--hit-a` and for one more: the slot is a fact about *which
   * question was asked*, and the hue that stands for it is a fact about the
   * palette. src/web/hit-colours.ts decides the first, styles/colourscales.css
   * decides the second, and neither has to know about the other.
   *
   * Where several hits cover the same words their slots do **not** collapse
   * the way `strength` does. That is the whole point of the colour: two
   * searches finding the same sentence is exactly the thing worth showing, and
   * a winner-takes-all rule here would hide it. See `annotateHtml` for what the
   * markup does with more than one.
   *
   * **A mark that carries a `hue` narrows this to a real number** — see
   * `MarkValence` above, which is the half of `Mark` that says so.
   */
  slot?: number | null;
  /**
   * How to **outline** these words — how heavily and how brightly: a quote,
   * and `hit` marks only. One `QuoteStroke` (src/types.ts), never a weight and
   * a brightness as two fields that could arrive one without the other.
   *
   * The counterpart of `strength`, and exclusive with it **by convention rather
   * than by type** — both are optional here, so nothing stops a caller setting
   * both and getting a mark that is drawn as a stroke *and* washed. The single
   * place that decides is `search-hits.ts § baseMarks`, whose comment says what
   * went wrong while a quote was both. Said plainly because an earlier draft of
   * this comment claimed the types enforced it; they do not, and a claim like
   * that is exactly what stops the next person checking (GPT Sol, 2026-09-07).
   * A discriminated union would enforce it, and would be the right shape if a
   * third kind of painting ever arrives.
   *
   * Where two quotes cover the same words the **heaviest wins**, on the same
   * argument `strength` makes. In practice they cannot: `dedupeOverlaps`
   * (src/quotes.ts) drops any quote whose span clashes with a longer one in the
   * same block, which is what stops two nested outlines reading as one heavier
   * mark — a priority neither quote has. The `Math.max` here is the belt to
   * that brace, because the drawing now depends on a property the artefact
   * happens to hold rather than one this file enforces. The brightness takes the
   * maximum beside it, for the same can-not-arise reason.
   */
  quoteStroke?: QuoteStroke;
}

/** A comment's stored anchor, before it has been matched against the block. */
export interface Anchor {
  quote: string;
  /** Where the quote was when it was made. A hint for choosing between repeats. */
  start: number;
}

/**
 * The text the browser will render for this html — the offset space everything
 * else in this file speaks.
 */
export function renderedText(html: string): string {
  // Counted in place rather than through a wrapper because there is exactly one
  // `return` here and it is an expression. `leafClock()` reads the clock only in
  // the diagnostic mode — annotation-cost.ts § Three states, not two.
  const counting = costOn();
  const t0 = leafClock();
  const text = host(html).textContent ?? "";
  if (counting) noteCost("renderedText", t0);
  return text;
}

/**
 * Find `anchor.quote` in `text`, preferring the occurrence nearest to where it
 * used to be. Returns `null` when the quote is gone, which is the honest
 * outcome: the paragraph was edited, and highlighting the wrong words would be
 * worse than highlighting none.
 *
 * **`offsetTrusted: false`** is for a block whose text changed length under the
 * anchor without the paragraph being edited — today, one that had maths drawn
 * into it at ingress (src/web/maths.ts § `rendersMaths`). Its offset may then be
 * nearer the wrong one of two repeats, so it is not asked: one occurrence
 * resolves, two or more draw nothing. The same rule as above, applied to a
 * tie-breaker that has stopped being one.
 */
export function resolveMark(
  text: string,
  anchor: Anchor,
  opts: { offsetTrusted?: boolean } = {},
): { start: number; end: number } | null {
  /* The measurement wraps the worker rather than sitting in front of each of
     its three `return`s, so a fourth one added later cannot escape being
     counted — annotation-cost.ts § the header. */
  const counting = costOn();
  const t0 = leafClock();
  const found = opts.offsetTrusted === false ? findOnlyQuote(text, anchor) : findQuote(text, anchor);
  if (counting) noteCost("resolveMark", t0);
  return found;
}

/** The quote's one occurrence, or `null` for none and for more than one. */
function findOnlyQuote(text: string, anchor: Anchor): { start: number; end: number } | null {
  if (anchor.quote.length === 0) return null;
  const first = text.indexOf(anchor.quote);
  if (first === -1 || text.indexOf(anchor.quote, first + 1) !== -1) return null;
  return { start: first, end: first + anchor.quote.length };
}

/** `resolveMark` without the stopwatch — the whole of the real work. */
function findQuote(text: string, anchor: Anchor): { start: number; end: number } | null {
  if (anchor.quote.length === 0) return null;
  // The overwhelmingly common case: nothing moved. The bounds check is not
  // paranoia: `startsWith` clamps a negative position to 0 and happily matches,
  // and we would then return the *unclamped* start — a mark drawn a few
  // characters left of its own words, looking like a CSS bug.
  if (anchor.start >= 0 && text.startsWith(anchor.quote, anchor.start)) {
    return { start: anchor.start, end: anchor.start + anchor.quote.length };
  }
  let best = -1;
  for (let i = text.indexOf(anchor.quote); i !== -1; i = text.indexOf(anchor.quote, i + 1)) {
    if (best === -1 || Math.abs(i - anchor.start) < Math.abs(best - anchor.start)) best = i;
  }
  return best === -1 ? null : { start: best, end: best + anchor.quote.length };
}

/**
 * `html` with every mark wrapped in a `<mark>`.
 *
 * Overlapping marks share one `<mark>` whose `data-comment` (or `data-term`)
 * lists them space-separated, rather than nesting — two underlines stacked on
 * the same words read as a rendering bug, and the click handler only needs the
 * first id to have something to open.
 *
 * Marks of different kinds overlap the same way, which is what makes a comment
 * on a sentence containing a glossary term draw one element with both classes
 * rather than two nested ones. See `MarkKind`.
 */
export function annotateHtml(html: string, marks: readonly Mark[]): string {
  /* Wrapped rather than timed at each `return`, for the reason `resolveMark`
     above gives. The fast path counts as a call: `TableView` reaches it once
     per marked block per re-annotation, and hiding the cheap calls would
     flatter the number this instrument exists to produce. */
  const counting = costOn();
  const t0 = leafClock();
  const out = annotate(html, marks);
  if (counting) noteCost("annotateHtml", t0);
  return out;
}

/** `annotateHtml` without the stopwatch. */
function annotate(html: string, marks: readonly Mark[]): string {
  const live = marks.filter((m) => m.end > m.start);
  if (live.length === 0) return html;

  const root = host(html);
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);

  let offset = 0;
  for (const node of nodes) {
    const value = node.nodeValue ?? "";
    const nodeStart = offset;
    offset += value.length;
    const touching = live.filter((m) => m.start < offset && m.end > nodeStart);
    if (touching.length === 0) continue;
    // Text inside an `<svg>` or `<math>` is counted but never wrapped. `<mark>`
    // is an HTML element, and putting one inside foreign content produces a
    // subtree whose serialisation and re-parse are governed by different rules
    // than the tree we just built — the parser differential this whole file is
    // downstream of (docs/project/security.md). Inline SVG survives sanitising
    // by choice, so this is reachable.
    //
    // Note the order: `offset` has already advanced. Skipping the *count* as
    // well would shift every offset after a diagram, and marks would land a few
    // characters off — the offset space is defined by `renderedText`, which
    // counts these nodes. Flagged by GPT-5's review, 2026-08-25.
    if (!isHtmlElement(node.parentNode)) continue;

    // Cut the node wherever any mark begins or ends, then label each piece with
    // whichever marks cover it. Sorting the cuts is what makes overlaps fall out
    // for free instead of needing a second pass.
    const cuts = new Set<number>([0, value.length]);
    for (const m of touching) {
      cuts.add(clamp(m.start - nodeStart, 0, value.length));
      cuts.add(clamp(m.end - nodeStart, 0, value.length));
    }
    const points = [...cuts].sort((a, b) => a - b);

    const fragment = doc.createDocumentFragment();
    for (let i = 0; i < points.length - 1; i++) {
      // `?? 0` only to satisfy noUncheckedIndexedAccess — the loop bound and
      // the fact that `cuts` always holds 0 and value.length mean both indices
      // are in range.
      const from = points[i] ?? 0;
      const to = points[i + 1] ?? 0;
      if (from === to) continue;
      const piece = value.slice(from, to);
      const covering = touching.filter(
        (m) => m.start <= nodeStart + from && m.end >= nodeStart + to,
      );
      if (covering.length === 0) {
        fragment.appendChild(doc.createTextNode(piece));
        continue;
      }
      const el = doc.createElement("mark");
      const comments = covering.filter((m) => (m.kind ?? "cmt") === "cmt");
      const chats = covering.filter((m) => m.kind === "chat");
      const terms = covering.filter((m) => m.kind === "term");
      const hits = covering.filter((m) => m.kind === "hit");
      // Every class that applies. `mark.cmt` and `mark.chat` are what the click
      // handler in TableView.tsx selects on, so a term or a hit must never
      // carry either class alone — and neither artefact may lose its class
      // because one of them happens to overlap it.
      el.className = [
        comments.length > 0 ? "cmt" : "",
        chats.length > 0 ? "chat" : "",
        terms.length > 0 ? "term" : "",
        hits.length > 0 ? "hit" : "",
      ]
        .filter(Boolean)
        .join(" ");
      if (comments.length > 0) {
        el.setAttribute("data-comment", comments.map((m) => m.id).join(" "));
        // The asterisk goes on the final run only, so a mark broken across an
        // <em> still shows exactly one marker. Comments only: a glossary term
        // is not an artefact the reader made and does not get a marker.
        if (comments.some((m) => m.end === nodeStart + to)) el.setAttribute("data-mark-end", "");
      }
      if (chats.length > 0) {
        el.setAttribute("data-chat", chats.map((m) => m.id).join(" "));
        /* Its own marker, on the final run only, for the same reason the
           comment's is: a mark broken across an <em> shows one marker, not
           three. A separate attribute rather than sharing `data-mark-end`,
           because a run can end a chat mark without ending a comment mark that
           overlaps it, and one attribute would put the marker in the wrong
           place for whichever of them did not end there. */
        if (chats.some((m) => m.end === nodeStart + to)) el.setAttribute("data-chat-end", "");
      }
      if (terms.length > 0) el.setAttribute("data-term", terms.map((m) => m.id).join(" "));
      if (hits.length > 0) {
        el.setAttribute("data-hit", hits.map((m) => m.id).join(" "));
        /* **Two kinds of hit share this element, and they are painted
           differently.** A quote carries a tier and is drawn as an outline; a
           search hit carries a strength and is drawn as a wash. One run can be
           covered by both, and then it wears both.

           `data-wash` is what says "something here wants the search painting",
           and it is the switch the stylesheet hangs the wash, the hue band and
           its bottom padding off. Before it, those were unconditional on
           `mark.hit` — so a quote arrived wearing a fill, which is the opposite
           of what a quote is supposed to look like. */
        const washes = hits.filter((m) => m.quoteStroke === undefined);
        const quoted = hits.filter((m) => m.quoteStroke !== undefined);
        const style: string[] = [];
        if (washes.length > 0) {
          el.setAttribute("data-wash", "");
          /* The wash intensity, as a custom property the stylesheet multiplies a
             colour by (styles.css § search mode). Written as a *number* rather
             than as a colour on purpose: the colour belongs to the design tokens
             and the confidence belongs to the model, and a component that mixed
             them here would put a hex value beyond the reach of the theme.

             Strongest wins — see `strength` on Mark. `toFixed(3)` because this
             string goes into an attribute on every marked run of every marked
             block, and 17 digits of float noise is real bytes for no gain.

             **Over the washing marks only.** While quotes were `strength: 1`
             hits, a quote lying over a hedged search hit took this maximum to 1
             and repainted the model's confidence at full — see § baseMarks in
             search-hits.ts. */
          const strength = Math.max(...washes.map((m) => clamp(m.strength ?? 1, 0, 1)));
          style.push(`--hit-a:${strength.toFixed(3)}`);
        }
        /* Heaviest and brightest win — see `quoteStroke` on Mark, and why it
           cannot arise. */
        if (quoted.length > 0) {
          const strokes = quoted.flatMap((m) => (m.quoteStroke ? [m.quoteStroke] : []));
          const tier = Math.max(...strokes.map((q) => q.tier));
          el.setAttribute("data-quote", String(tier));
          /* **The fade, as a number in the style this element already carries**
             — the `--hit-a` pattern, and for its reason: the colour is the
             token's, the brightness is the quote's priority. No new attribute,
             so nothing new for the sanitiser to reserve: an article's own
             `style` is stripped before this runs (src/sanitize-policy.ts). */
          const alpha = Math.max(...strokes.map((q) => q.alpha));
          style.push(`--quote-a:${clamp(alpha, 0, 1).toFixed(2)}`);
        }
        /* And which searches found these words, as one rule each stacked under
           the wash — Greg's call on 2026-08-26, over blending the washes
           together. Blending is prettier for two and turns to mud at three, and
           the mud is a colour that is not in the palette, so the reader cannot
           look it up; stacked rules stay identifiable however many there are,
           and the text's contrast never changes at all.

           Sorted ascending and de-duplicated, so the same pair of searches
           draws the same pair of rules in the same order wherever they meet.
           Two hits from *one* search covering one phrase is one rule, which is
           right: the question was asked once.

           Only a *token* crosses this seam; `--h0` … `--h5` hold palette or
           ramp references, never colours, and styles.css turns them into a
           stripe of the right height at the right offset. See `HUE_STRIPES` for
           why six.

           **Two kinds of stripe, deduplicated on two different keys**, which is
           GPT Sol's finding 3 and is the whole of why this is not one `Set` of
           slots any more. An identity stripe answers *which source found this*
           and two hits from one search are one stripe; a valence stripe answers
           *which way this cuts* and two results from one criterion pointing
           opposite ways are two. Keyed on the slot for both, one criterion's
           −90 and +70 over one phrase would collapse into a single stripe and a
           direction would be silently dropped, and two criteria that landed on
           the same ramp step would draw one uninterrupted band while
           `data-hues` said two. Keying each kind on the thing it means costs
           one array and removes both.

           The tokens cannot collide across the two kinds — `--cat-*` and
           `--div*` are different families — so the dedup below is one `Set` per
           kind rather than one shared one only because the *order* differs:
           identity ascending by slot, valence ascending by ramp step, which for
           `--div-rg-0` … `--div-rg-8` is the same as sorting the strings. Both
           are stable and arbitrary, which is what makes the same pair of
           sources draw the same pair of rules wherever they meet.

           **And the cap is shared between the two rather than applied to the
           concatenation** — `shareStripes` below, GPT Sol's finding 3 on the
           built code. */
        /* `Number.isInteger` and the range check, not just `typeof number`.
           The slot is interpolated straight into a custom-property *name*
           (`--cat-3-rgb`), so a `NaN` or a `2.5` arriving here would emit
           `var(--cat-NaN-rgb)` — which is not an error anywhere, it is a
           reference to a property nobody defined, so the declaration is invalid
           at computed-value time and the stripe simply does not paint. A search
           whose marks quietly stop being coloured is precisely the failure mode
           docs/reusable/silent-success.md is about, and the guard costs a
           comparison. `assignSlots` already promises an integer in range; this
           is here because *this* is the line that would be silent about it. */
        const usable: number[] = [];
        const valences: string[] = [];
        /* **`washes`, not `hits`.** A quote has a slot — `resolveQuotes` gives
           every quote slot 0 so the spine rail packs one lane — but the slot
           means "one source called Quotes", not "a search whose colour this
           is". Drawing it as a hue stripe would put a categorical search colour
           under a passage no search found, and would give the quote a bottom
           band it then has to pad for. The stripes belong to the wash. */
        for (const m of washes) {
          /* A valence mark's hue is already resolved (`valenceRgbToken`, via
             `hitMarks`), and its slot is not interpolated into anything — so it
             skips the validation below rather than being subject to it. The
             type is what keeps the two apart: a `hue` cannot arrive without a
             `dir` or with a null slot. */
          if (m.hue !== undefined) {
            valences.push(m.hue);
            continue;
          }
          const slot = m.slot;
          /* Both ends of the range, not just the bottom. A slot of 8 in an
             eight-hue palette emits `var(--cat-8-rgb)` — a reference to a
             property nobody defined, so the declaration is invalid at
             computed-value time and the stripe paints nothing at all. Same
             silent shape as a NaN, and worth the second comparison for the same
             reason. Raised by a GPT Sol review, 2026-08-26. */
          if (
            typeof slot !== "number" ||
            !Number.isInteger(slot) ||
            slot < 0 ||
            slot >= PALETTE_SLOTS
          ) {
            continue;
          }
          usable.push(slot);
        }
        const tokens = shareStripes(
          [...new Set(usable)].sort((a, b) => a - b).map((slot) => `var(--cat-${slot}-rgb)`),
          [...new Set(valences)].sort(),
        );
        if (tokens.length > 0) {
          el.setAttribute("data-hues", String(tokens.length));
          for (const [i, token] of tokens.entries()) {
            style.push(`--h${i}:${token}`);
          }
        }
        /* Only when there is something to say. A quote-only run has no wash and
           no stripes, and `style=""` on every such mark is bytes for nothing. */
        if (style.length > 0) el.setAttribute("style", style.join(";"));
        /* **Where each quote begins and ends, which is what lets an outline
           survive being split.** A mark becomes one `<mark>` per text node and
           splits again at every annotation boundary, so one quote containing an
           `<em>` is three sibling elements — and three closed rings around one
           sentence read as three separate quotes, which a wash never did.

           So the stylesheet draws the rules above and below on every fragment
           and the inline end-caps only on the two that carry these, and the
           outline runs continuously across the joins. Measured in Chrome on
           2026-09-07: no gap at the seam, only a 14% antialias dip visible at
           4×. The same pattern, and the same reason, as `data-mark-end` for a
           comment's asterisk.

           Derived from the mark's own offsets rather than from its position
           among its siblings, so a quote that starts mid-node is still capped
           where the quote starts and not where the run does. */
        for (const m of quoted) {
          if (m.start === nodeStart + from) el.setAttribute("data-quote-start", "");
          if (m.end === nodeStart + to) el.setAttribute("data-quote-end", "");
        }
        /* **The sign, which is what pays for painting a judgement in colour.**
           docs/project/colour-scales.md forbids colour being the only carrier
           of a good/bad judgement, and the prose has no words — so a mark drawn
           by valence carries `−`, `·` or `+` after it, through
           `mark.hit[data-dir]::after` in styles.css.

           **Printed on the run where a valence mark ends, exactly as the
           comment asterisk is**, so a phrase broken across an `<em>` gets one
           sign rather than three.

           **But derived from every valence mark *covering* that run, not only
           from the ones ending on it** — GPT Sol's finding 5, and the two are
           not the same question. An against range over the whole sentence,
           overlapped by a for range over its first half, ends the `for` mark at
           the halfway cut: the run there is drawn in *both* colours, and a sign
           taken from the ending mark alone would print `+` over it and hide the
           against direction entirely. `hits` is already filtered to the marks
           covering this run, so the fix is to ask it rather than `ending`.

           `mixed` is the fourth value and it is not a tidy-up: two results of
           one criterion, or two criteria, can point opposite ways over one
           phrase — the case Sol's finding 3 is about — and both stripes are
           drawn. Printing one of the two signs there would be this file
           choosing a verdict, so it prints `±` and lets the panel say which is
           which. */
        const directed = hits.filter((m) => m.dir !== undefined);
        if (directed.some((m) => m.end === nodeStart + to)) {
          const dirs = new Set(directed.map((m) => m.dir));
          el.setAttribute("data-dir", dirs.size === 1 ? [...dirs][0]! : "mixed");
        }
      }
      /* The one the reader has pressed — the comment whose dialog is open, the
         search hit they clicked in the panel, the conversation on screen, the
         term selected in the glossary band. All four mean the same thing and
         want the same treatment: after a jump, the panel and the passage have
         to be visibly the same thing.

         **One attribute per kind, and that is a bug fix.** It was a single
         `data-open` until 2026-08-26, which was fine while only one kind of
         mark was ever numerous — but a merged mark carries every class that
         applies, so `mark.hit[data-open]` matched a hit that merely *overlapped*
         a pressed comment, and drew it as though the reader had pressed the
         hit. Underlining every glossary term is what made that reachable rather
         than theoretical: now any pressed term sitting inside a searched-for
         sentence lights the search result up, and any open comment lights up
         every term inside it. Raised by a GPT Sol review, 2026-08-26.

         Chat was worse and in the other direction: `mark.chat[data-open]` is a
         real rule in styles.css and `TableView` has always passed `open` for
         chats, but nothing here ever read it — so an open conversation's mark
         was drawn as open only by the accident of overlapping a comment or a
         hit. Giving each kind its own attribute fixes that in the same stroke.

         The attribute is *not* the class with a suffix by accident: the
         selectors in styles.css are `mark.cmt[data-cmt-open]` and so on, so a
         forged attribute on its own still cannot make anything look pressed —
         and all four are in the sanitiser's FORBID_ATTR beside `data-comment`
         (src/sanitize-policy.ts) for the same reason the others are. */
      if (comments.some((m) => m.open)) el.setAttribute("data-cmt-open", "");
      if (chats.some((m) => m.open)) el.setAttribute("data-chat-open", "");
      if (hits.some((m) => m.open)) el.setAttribute("data-hit-open", "");
      if (terms.some((m) => m.open)) el.setAttribute("data-term-open", "");
      el.textContent = piece;
      fragment.appendChild(el);
    }
    node.parentNode?.replaceChild(fragment, node);
  }
  return root.innerHTML;
}

/**
 * **How the six stripes are shared out when a phrase carries both kinds.**
 *
 * The obvious spelling is `[...identity, ...valence].slice(0, HUE_STRIPES)`,
 * and it is what shipped first. It has a failure that is worse than losing a
 * stripe: six single-ended criteria over one phrase fill every lane, so a
 * diverging result over the same words draws **no valence colour at all** while
 * still printing its `−` or `+` — the sign and the colours then describe
 * different facts, which is the one thing this mark must never do, because the
 * sign is what pays for painting a judgement in colour in the first place.
 * GPT Sol's finding 3 on the built code.
 *
 * So each kind is guaranteed its share of the lanes before either is allowed to
 * spill into the other's:
 *
 * - whichever kind is absent costs nothing, and the other takes the whole cap,
 *   which is every case before referee mode existed and most cases after it;
 * - with both present each is guaranteed `⌊HUE_STRIPES / 2⌋`, and whatever the
 *   other kind does not use is handed back rather than left empty.
 *
 * **Identity first, and both lists already sorted**, so the ordering property
 * the block above claims still holds: the same pair of sources draws the same
 * pair of rules, in the same order, wherever they meet. The arithmetic below
 * depends on nothing but the two lengths, so it is stable for the same reason.
 *
 * What is *lost* past the cap is unchanged and is the same loss `HUE_STRIPES`
 * describes: the knowledge that a further source matched **here**. Every one of
 * them keeps its row in the panel and its segment in the paragraph bar.
 */
function shareStripes(identity: string[], valence: string[]): string[] {
  if (identity.length === 0 || valence.length === 0) {
    return [...identity, ...valence].slice(0, HUE_STRIPES);
  }
  const share = Math.floor(HUE_STRIPES / 2);
  /* Valence is measured against identity's *guaranteed* share rather than
     against what it actually took, and then identity is re-measured against
     what valence took. That order is what lets either side use the whole
     remainder while neither can be starved: one valence stripe beside eight
     identity ones is 5 + 1, not 3 + 1. */
  const takeValence = Math.min(valence.length, HUE_STRIPES - Math.min(identity.length, share));
  const takeIdentity = Math.min(identity.length, HUE_STRIPES - takeValence);
  return [...identity.slice(0, takeIdentity), ...valence.slice(0, takeValence)];
}

/**
 * True for an element the browser parses by HTML rules. Foreign content —
 * anything inside `<svg>` or `<math>` — is namespaced differently, and an HTML
 * element grafted into it does not round-trip the way the surrounding tree does.
 */
function isHtmlElement(node: Node | null): boolean {
  return (
    node?.nodeType === 1 &&
    (node as Element).namespaceURI === "http://www.w3.org/1999/xhtml"
  );
}

function host(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* ---------------------------------------------------------- glossary terms --
   The other kind of mark, and the only one this file knows how to *find* for
   itself. A comment arrives with its own anchor; a term arrives as a list of
   spellings, and where it sits in the prose is a question. */

/** One glossary term, reduced to what drawing it in the prose needs. */
export interface TermSelection {
  /** The entry's id, so the mark can say which term it belongs to. */
  id: string;
  /** Canonical name first, then aliases — `formsOf` in src/term-match.ts. */
  forms: string[];
  /**
   * The blocks the *server* found this term in.
   *
   * Not a hint and not an optimisation, though it is also both: it is the
   * agreement between the two halves. The occurrence list in `glossary.json`
   * and the underlines here are computed from the same rule
   * (src/term-match.ts), so restricting the search to the blocks that list
   * names means a disagreement shows up as **no underline** rather than as an
   * underline in a block the panel says has none. One of those is a visible
   * bug; the other is the panel and the prose quietly telling you different
   * things.
   *
   * It is also the difference between scanning six blocks and scanning four
   * hundred on every render.
   */
  blocks: BlockId[];
  /**
   * The term the reader has pressed in the glossary panel, if this is it.
   *
   * Every entry is underlined now (see `termMarks` below), so "selected" can no
   * longer mean "the one with a mark on it" — it has to be a *difference*
   * between marks instead. This is what `mark.term[data-term-open]` hangs off, and
   * it does the same job `open` does for a comment and for a search hit: after
   * a jump, the row in the panel and the words in the prose have to be visibly
   * the same thing.
   */
  open?: boolean;
}

/**
 * Every occurrence of every term, as marks, grouped by block.
 *
 * **A list rather than one selection, since 2026-08-26.** Until then the prose
 * was marked only while a term was pressed in the panel, and the comment in
 * styles.css was emphatic about why: the version this was borrowed from
 * underlined every term in every article always, which is the prose acquiring
 * marks on the model's initiative rather than the reader's. Greg reversed that
 * — *"Glossary entries should always be underlined in the verbatim text column,
 * even outside Glossary mode"* — so the underline is now a standing property of
 * the article, and the thing that arrives on the reader's initiative is the
 * hover card (ProseHoverCard.tsx) rather than the line itself. Two consequences
 * worth knowing: the mark had to get quieter (a wash behind every term in the
 * piece is a wash behind half the article — styles.css § mark.term), and the
 * emphasis it used to carry moved onto `open`.
 *
 * Empty map for an article with no glossary, which is still the ordinary case,
 * and then the prose is untouched exactly as it was before.
 *
 * The rendered text of a block is computed **once**, however many terms want
 * it. `renderedText` parses HTML, and doing that per term per block was the
 * one thing in here that would have made a long article's glossary expensive
 * now that the whole list is drawn rather than one entry of it.
 */
export function termMarks(
  blocks: Block[],
  selections: readonly TermSelection[],
): Map<BlockId, Mark[]> {
  const byBlock = new Map<BlockId, Mark[]>();
  if (selections.length === 0) return byBlock;

  /* Which terms to look for in which block, inverted up front. The `blocks`
     list on each selection is the agreement with the server documented above,
     and inverting it is what keeps this to one pass over the article rather
     than one pass per term. */
  const wanted = new Map<BlockId, { id: string; pattern: RegExp; open: boolean }[]>();
  for (const selection of selections) {
    const pattern = termPattern(selection.forms);
    if (!pattern) continue;
    for (const id of selection.blocks) {
      const list = wanted.get(id) ?? [];
      list.push({ id: selection.id, pattern, open: selection.open === true });
      wanted.set(id, list);
    }
  }

  for (const block of blocks) {
    const here = wanted.get(block.id);
    if (!here) continue;
    // `renderedText`, not `block.text` — the offset space every mark in this
    // file speaks. The two strings are different lengths, and the whole header
    // of this file is about what happens when you mix them up.
    const text = renderedText(block.html);
    const marks: Mark[] = [];
    for (const term of here) {
      for (const span of termSpans(text, term.pattern)) {
        marks.push({ id: term.id, kind: "term" as const, ...span, ...(term.open ? { open: true } : {}) });
      }
    }
    if (marks.length > 0) byBlock.set(block.id, marks);
  }
  return byBlock;
}
