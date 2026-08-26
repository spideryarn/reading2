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
import { CATEGORICAL_SLOTS } from "./hit-colours.js";
import type { Block, BlockId } from "../types.js";

/**
 * What a mark is *for*, and therefore how it is drawn and what listens to it.
 *
 * `cmt` is a comment: a persistent artefact the reader made, clickable, and it
 * carries the ✳ marker at its end. `chat` is a conversation started from that
 * selection — persistent and clickable in the same way, and since 2026-08-26 it
 * is the one a fresh selection makes (docs/plans/chat-as-gateway.md); comments
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

export interface Mark {
  /** The comment, or the glossary term, this mark belongs to. */
  id: string;
  /** Inclusive, in the block's rendered-text offset space. */
  start: number;
  /** Exclusive. */
  end: number;
  /** Defaults to `cmt`, which is what every mark was before the glossary. */
  kind?: MarkKind;
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
   */
  slot?: number | null;
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
  return host(html).textContent ?? "";
}

/**
 * Find `anchor.quote` in `text`, preferring the occurrence nearest to where it
 * used to be. Returns `null` when the quote is gone, which is the honest
 * outcome: the paragraph was edited, and highlighting the wrong words would be
 * worse than highlighting none.
 */
export function resolveMark(text: string, anchor: Anchor): { start: number; end: number } | null {
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
export function annotateHtml(html: string, marks: Mark[]): string {
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
        /* The wash intensity, as a custom property the stylesheet multiplies a
           colour by (styles.css § search mode). Written as a *number* rather
           than as a colour on purpose: the colour belongs to the design tokens
           and the confidence belongs to the model, and a component that mixed
           them here would put a hex value beyond the reach of the theme.

           Strongest wins — see `strength` on Mark. `toFixed(3)` because this
           string goes into an attribute on every marked run of every marked
           block, and 17 digits of float noise is real bytes for no gain. */
        const strength = Math.max(...hits.map((m) => clamp(m.strength ?? 1, 0, 1)));
        const style = [`--hit-a:${strength.toFixed(3)}`];
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

           Only the slot number crosses this seam; `--h0` … `--h5` name palette
           entries, and styles.css turns them into a stripe of the right height
           at the right offset. See `HUE_STRIPES` for why six. */
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
        for (const m of hits) {
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
            slot >= CATEGORICAL_SLOTS
          ) {
            continue;
          }
          usable.push(slot);
        }
        const slots = [...new Set(usable)].sort((a, b) => a - b).slice(0, HUE_STRIPES);
        if (slots.length > 0) {
          el.setAttribute("data-hues", String(slots.length));
          for (const [i, slot] of slots.entries()) {
            style.push(`--h${i}:var(--cat-${slot}-rgb)`);
          }
        }
        el.setAttribute("style", style.join(";"));
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
