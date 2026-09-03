/**
 * Stage 2, before Readability — every footnote shape rewritten into one.
 *
 * The web has at least four ways of saying "there is a note here and its text
 * is over there", and they disagree about everything: which element wraps
 * which, whether there is a `<sup>` at all, whether the note's body is an
 * `<li>` or a `<div>`, and — for Tufte CSS — whether the mechanism is markup we
 * are allowed to keep at all. The four we have measured are in
 * docs/plans/260828o-footnotes.md; the two that already worked end to end are Gwern's
 * and Wikipedia's, and they are structurally opposite:
 *
 *     gwern:      <a href="#fn1" id="fnref1"><sup>1</sup></a>   the anchor wraps the sup
 *     wikipedia:  <sup id="cite_ref-…"><a href="#cite_note-…">   the sup wraps the anchor
 *     substack:   <a class="footnote-anchor" id="footnote-anchor-1" href="#footnote-1">1</a>
 *                 …and the note is <div class="footnote"><a id="footnote-1">1</a><div>…</div></div>
 *     tufte:      <label class="margin-toggle sidenote-number"></label>
 *                 <input type="checkbox" id="sn-…"><span class="sidenote">…</span>
 *
 * **Why this has to run before Readability, and not at stage 3.** `runExtract`
 * runs Readability *and sanitises its output* before `splitIntoBlocks` ever sees
 * the document (src/extract.ts). By stage 3 the identifying classes are gone —
 * Readability's `keepClasses: false` takes them — and for Tufte the `<label>`
 * and `<input>` that carry the numbering are gone too, because both are in
 * `ARTICLE_CONFIG.FORBID_TAGS` and correctly so (src/sanitize-policy.ts). What
 * reaches a reader today is the sidenote's text sitting mid-sentence, unmarked,
 * indistinguishable from the author's own prose. Not lost — reclassified as
 * argument, silently.
 *
 * So this sits beside `unhideCollapsedSections`, the existing pre-Readability
 * repair pass, and for the same reason: it needs the page as the author wrote
 * it.
 *
 * ## What "canonical" means here
 *
 * A **marker** where the note was cited:
 *
 *     <sup><a data-spya-note-ref="<noteId>" id="<markerId>" href="#<noteId>">7</a></sup>
 *
 * and a **note**, one per note, all of them in one container at the end:
 *
 *     <section data-spya-notes="">
 *       <ol>
 *         <li id="<noteId>" data-spya-note="<noteId>">…the note's prose…
 *             <a data-spya-note-back="<noteId>" href="#<markerId>">↩</a></li>
 *       </ol>
 *     </section>
 *
 * `<markerId>` is the id the author gave the marker wherever they gave it one —
 * `fnref7` on Gwern — and `spya-noteref-3` only where they did not. The
 * back-link is likewise the author's own element, stamped rather than rebuilt,
 * wherever there is one to keep. Both are point 5 below, and both are the block
 * id contract rather than politeness.
 *
 * Four things about that shape are load-bearing.
 *
 * 1. **The note's body is one block-level element.** This is what fixes the live
 *    Substack bug: there, the note arrives as an inline `<a>` holding the digit
 *    followed by a sibling `<div>` holding the prose, so stage 3 emits *two*
 *    blocks and all eighteen markers retarget onto the one whose entire text is
 *    a digit. `stats.retargeted` reports 36 of 36 while half the links are
 *    useless. An `<li>` is a leaf block in stage 3 (src/blocks.ts), and stage 3
 *    does not descend into a leaf, so everything inside it becomes one block and
 *    a marker lands on the note's words.
 * 2. **`noteId` is minted here**, from a hash of the note's own text, so a note
 *    has an identity that is neither its number (an author inserting a note at
 *    the top renumbers everything below) nor its block id (which does not exist
 *    yet). Both ends carry it. Retrofitting an identity later means re-deriving
 *    it from markup that has already been thrown away.
 * 3. **`id` is `spya-note-…`, deliberately NOT a spideryarn block id.** A block
 *    id here would be *reused* by stage 3 rather than carried over, so every
 *    re-extraction would mint a fresh id for every note and orphan any comment
 *    on one. As an ordinary author anchor it goes through
 *    `stampAuthorAnchors`/`retargetAnchors` like Wikipedia's `cite_note-…` does
 *    today, and the marker's href follows it to the block id.
 * 4. **Back-links are plural.** Wikipedia has one note cited thirteen times in
 *    this corpus. One synthesised back-link where the note had three markers
 *    reads exactly like a working feature.
 * 5. **Where the author already wrote back-links, they are stamped in place and
 *    not replaced.** This is the id contract, not tidiness. Stage 3 recovers a
 *    block's id by matching its tag and its text (`exactKey`, src/blocks.ts), so
 *    changing the words of a note costs it its id and orphans every comment on
 *    it. Gwern's back-link reads `↩︎` — U+21A9 *plus a variation selector* — and
 *    writing `↩` over it re-minted all 34 of its note blocks and 31 of
 *    Wikipedia's 121 on the first implementation, measured. The folded fallback
 *    key keeps combining marks on purpose, so it missed too. We synthesise a
 *    back-link only where the source has none we can keep: Tufte, which has none
 *    at all, and Substack, whose back-link is the leading digit that has to go.
 *    Same rule for the marker: it keeps the id the author gave it, so their
 *    back-link's href still lands on it.
 *
 * ## Reading a stranger's DOM before it has been sanitised
 *
 * Reading is not the danger; *carrying* is. A hostile page that could get a
 * `data-spya-note` stamp of its own past us would have arbitrary body prose
 * dressed as trusted apparatus — and, once anything downstream treats the stamp
 * as meaningful, hidden from summaries or presented as ours. So:
 *
 * - every copy of our reserved attributes that the document arrived with is
 *   removed first, `<template>` contents included (a DOM query does not enter a
 *   template's fragment, which is how a stamp survived two scrubs once already
 *   — see `scrubStamps` in src/blocks.ts);
 * - every value we write is either a fixed string or an id we minted;
 * - nothing is built by string concatenation and no raw attribute or raw HTML is
 *   copied across — note prose is *moved*, as the original nodes, so its links
 *   stay live and the ordinary sanitiser still gets the last word on it;
 * - `<label>`, `<input>` and the rest of the form controls are stripped out of
 *   anything we move, never admitted.
 *
 * ## Four adapters, not one inference
 *
 * A note is recognised by the markup its publisher actually writes — pandoc's
 * `role="doc-noteref"` and `fn`/`fnref` ids, Wikipedia's `cite_ref`/`cite_note`,
 * Substack's `footnote-anchor`/`footnote` classes, Tufte's `sidenote` class —
 * and round-tripping is then *validation* on top of that.
 *
 * The first version of this file had it the other way round: any numbered link
 * whose target linked back was a note. That is broader than the brief and it is
 * worse than doing nothing. GPT Sol reproduced two cases against it — a numbered
 * link to a reciprocal `<td>` made the whole table vanish and moved its cell into
 * Notes, and a numbered link to reciprocal `<nav>` prose hoisted that prose out
 * and dressed it as a note. Neither needed a forged attribute; the topology was
 * enough. Round-tripping alone cannot tell a footnote from any two elements that
 * happen to point at each other.
 *
 * Belt and braces on top of the shape evidence: a note's body may never sit
 * inside a `table`, `nav`, `header`, `footer` or `aside`, whatever it calls
 * itself.
 *
 * ## What it deliberately does not do
 *
 * **A note with no back-link is not recognised.** Round-tripping is the signal
 * all three anchor-based shapes share and that ordinary cross-references do not,
 * so it stays as the validating half of the rule. A publisher who emits markers
 * with no back-links gets today's behaviour, which is the safe direction:
 * `retargeted > 0` is not evidence that footnotes work (ar5iv and gutenberg both
 * report a healthy retarget count from cross-references and neither has a
 * footnote our four adapters recognise).
 *
 * **LaTeXML's inline footnotes are out of scope** — ar5iv renders them inside the
 * body prose with no id/href pair at all, so there is no marker to rewrite and no
 * note to move. That fixture is left untouched deliberately, and is asserted as
 * an unsupported shape rather than as a page with no footnotes in it.
 *
 * **Tufte's numbering is not reconstructed**, only replaced: the original
 * `<label>` is empty and the number is drawn by a CSS counter, so we number the
 * sidenotes ourselves in document order. That is enough for the integrity bug,
 * which is that the note text stops being body prose.
 *
 * **A Tufte margin note that is really a figure caption is left where it is** —
 * one holding an `<img>`, or one inside a `<figure>`. Hoisting those would move
 * a caption away from its picture, which is a different and worse wrong than the
 * one being fixed here.
 */

import { createHash } from "node:crypto";
import { RESERVED_ATTRS, scrubReserved as sharedScrub } from "./reserved.js";

/**
 * On the note's own element. The value is the noteId.
 *
 * Exported because stage 3 reads it back (`src/blocks.ts`, `noteFieldsFor`) and
 * a second spelling of the string in the reading file is how a stamp and its
 * reader drift apart without either side going red.
 */
export const NOTE_ATTR = RESERVED_ATTRS.note;
/**
 * On a marker in the prose. The value is the noteId it points at.
 *
 * Exported for the same reason as `NOTE_ATTR`: stage 3 reads it back, to take
 * the marker out of a block's carry-over key so that renumbering a note does
 * not cost the paragraph citing it its id (`withoutNoteControls`, src/blocks.ts).
 */
export const REF_ATTR = RESERVED_ATTRS.noteRef;
/** On a back-link inside a note. The value is the noteId it belongs to. */
export const BACK_ATTR = RESERVED_ATTRS.noteBack;
/** On the one container all notes end up in. Read back by stage 3 — see NOTE_ATTR. */
export const CONTAINER_ATTR = RESERVED_ATTRS.notesContainer;

/**
 * The shape `mintNoteId` produces, and the only shape stage 3 will carry into a
 * `Block`.
 *
 * Stage 2 is the trust boundary — `scrubReserved` takes every copy of our
 * attributes off the document before we write ours, so after this pass every
 * stamp in the document is ours. This pattern is the belt: whatever else goes
 * wrong upstream, the string that reaches `blocks.json`, Postgres and the
 * public payload is ten hex digits and an optional counter, not a page's text.
 */
export const NOTE_ID_PATTERN = /^spya-note-[0-9a-f]{10}(?:-[0-9]+)?$/;

/**
 * Ours, and therefore forgeable. Scrubbed off the input before anything is
 * written, so that after this pass every one of them in the document was
 * written by us.
 *
 * The four names and the scrub itself live in src/reserved.ts, which is the one
 * file allowed to name a `data-spya-*` attribute — three families had grown
 * three copies of the same template-aware walk, and the risk was never the
 * copies that exist but the fourth, written by somebody who had read none of
 * them. docs/plans/260831af-carrying-markup-facts-past-readability.md.
 */
const RESERVED = [NOTE_ATTR, REF_ATTR, BACK_ATTR, CONTAINER_ATTR];

/** The four publishers we recognise, and nothing else. */
export type NoteShape = "gwern" | "wikipedia" | "substack" | "tufte";

export interface NoteStats {
  /** Distinct notes canonicalised. Not the number of markers, and not the number of blocks. */
  notes: number;
  /** Markers rewritten. At least `notes`, and thirteen times it on one Wikipedia note. */
  markers: number;
  /** Back-links stamped or synthesised — one per marker, never one per note. */
  backlinks: number;
  /** How many of those we wrote ourselves, rather than keeping the author's. */
  synthesised: number;
  /** How each note was recognised, so a shape silently going missing is visible. */
  shapes: Record<NoteShape, number>;
}

const EMPTY_STATS = (): NoteStats => ({
  notes: 0,
  markers: 0,
  backlinks: 0,
  synthesised: 0,
  shapes: { gwern: 0, wikipedia: 0, substack: 0, tufte: 0 },
});

/**
 * What a marker is allowed to say. A footnote marker is a number, a letter, a
 * roman numeral or a dagger — never a phrase. This one rule is what keeps a
 * table of contents out: Project Gutenberg's chapter links round-trip through a
 * "back to contents" anchor perfectly well, and are excluded here because their
 * text is a chapter title.
 *
 * Brackets and trailing punctuation are allowed around it because Wikipedia's
 * marker reads `[1]` and plenty of print-derived HTML reads `(3)` or `4.`. The
 * optional word is for Wikipedia's second reference group, whose markers read
 * `[note 1]` — two of the 170 in that fixture, and leaving them out would be a
 * regression dressed as a rounding error.
 */
const MARKER_LABEL =
  /^[\s[({<]*(?:(?:note|footnote|endnote|fn|ref|nb|n)\.?\s*)?(?:[0-9]{1,4}|[a-z]{1,3}|[*†‡§¶#^+]{1,3})[\s\])}>.,;:]*$/i;

/**
 * Elements a note's body is never allowed to be. A link to a heading or to a
 * whole section is a cross-reference, whatever else is true of it — and letting
 * one through would hoist a chunk of the argument into the notes.
 */
const NEVER_A_NOTE_BODY = new Set([
  "H1", "H2", "H3", "H4", "H5", "H6",
  "SECTION", "ARTICLE", "MAIN", "BODY", "HTML", "NAV", "HEADER", "FOOTER",
  "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "FIGURE",
]);

/** Where a note's prose is allowed to live once we go looking one level up. */
const NOTE_BODY_TAGS = new Set(["LI", "DD", "P", "DIV", "BLOCKQUOTE"]);

/**
 * A note's body may not live inside any of these, whatever else says it is a
 * note. Hoisting a table cell out of its table, or navigation prose out of its
 * `<nav>`, is worse than doing nothing: it removes ordinary content from the
 * article and presents it as apparatus. GPT Sol reproduced both against the
 * first version of this file, and a figure caption against the second.
 *
 * **This list is defence in depth, and not the rule.** Adding a tag each time
 * somebody finds another one is whack-a-mole; the thing that actually decides is
 * the topology each adapter requires of a note body — see `ANCHOR_SHAPES`, where
 * a pandoc note has to be an `<li>` in a list or sit in a notes container.
 */
const NEVER_INSIDE = "table, nav, header, footer, aside, figure, details, dialog, menu, form";

/** Never moved into a note, whatever the page says. See the security note above. */
const NEVER_ADMITTED = "label, input, button, select, textarea, option, form, style, script";

/**
 * One publisher's way of saying "this is a footnote", written down as the two
 * questions worth asking: does this link look like one of their markers, and
 * does the thing it points at look like one of their notes?
 *
 * **Both halves have to agree** before anything is rewritten. That is what makes
 * these adapters rather than an inference: a page that says nothing about
 * footnotes gets left alone, however suggestively its links point at each other.
 */
interface AnchorShape {
  name: Exclude<NoteShape, "tufte">;
  marker: (a: Element) => boolean;
  target: (t: Element) => boolean;
  /**
   * Does this publisher already write back-links we can keep? Keeping them is
   * what saves the note block's id (see the header). Substack's is the leading
   * digit, which has to go, so there is nothing to keep.
   */
  reuseBacklinks: boolean;
}

/** `el.matches` with a selector we wrote — never one built from page content. */
const is = (el: Element, selector: string): boolean => el.matches(selector);

/** A list item, and really in a list — where every pandoc note lives. */
const isListItem = (t: Element): boolean =>
  t.tagName === "LI" && (t.parentElement?.tagName === "OL" || t.parentElement?.tagName === "UL");

const ANCHOR_SHAPES: readonly AnchorShape[] = [
  {
    /* pandoc, which is what Gwern publishes: the anchor wraps the sup, the note
       is an `<li id="fn1">` in a `role="doc-endnotes"` section, and the back-link
       says `role="doc-backlink"`.

       **The target rule is topology, and it has to be.** Demanding
       `role="doc-noteref"` on the marker would be the obvious tightening and it
       is wrong: only 21 of gwern.html's 34 markers carry the role, so it would
       lose thirteen real notes. And `id="fn1"` on its own is not evidence of
       anything — a page needs to write only that and a reciprocal `id="fnref1"`
       to get an ordinary figure caption emptied out of its `<figure>` and moved
       into Notes, which GPT Sol reproduced against the previous version. So the
       note has to *be shaped like* a note: an item in a list, or inside a notes
       container. A caption is neither, and every real pandoc note is both. */
    name: "gwern",
    marker: (a) => is(a, "[role='doc-noteref'], .footnote-ref") || /^fnref/.test(a.id),
    target: (t) =>
      t.closest("[role='doc-endnotes'], .footnotes") !== null ||
      (/^fn\d/.test(t.id) && isListItem(t)),
    reuseBacklinks: true,
  },
  {
    /* Wikipedia/Parsoid: the sup wraps the anchor, and the id that back-links aim
       at is on the `<sup>` rather than on the `<a>` inside it. Same topology
       rule as pandoc — a reference is an item in the reference list. */
    name: "wikipedia",
    marker: (a) => /^cite_ref/.test(a.id) || a.closest("sup.reference, sup.mw-ref") !== null,
    target: (t) =>
      t.closest(".mw-references, .references, ol.references") !== null ||
      (/^cite_note/.test(t.id) && isListItem(t)),
    reuseBacklinks: true,
  },
  {
    /* Substack: no `<sup>` anywhere, and the note arrives as a `<div>` whose
       first child is an `<a>` holding the digit. That digit is both the fragment
       target and the back-link, which is the whole reason the note used to come
       out as two blocks with every marker landing on the one reading "1". */
    name: "substack",
    marker: (a) => is(a, ".footnote-anchor, [data-component-name='FootnoteAnchorToDOM']"),
    target: (t) =>
      is(t, ".footnote-number, .footnote, [data-component-name='FootnoteToDOM']") ||
      t.closest(".footnote, [data-component-name='FootnoteToDOM']") !== null,
    reuseBacklinks: false,
  },
];

/** One note, as recognised, before anything has been rewritten. */
interface Candidate {
  /** The element whose contents are the note's prose. Its children get moved. */
  body: Element;
  /** Every place in the prose that cites it, in document order. */
  markers: Element[];
  /** Text for each marker, in step with `markers`. */
  labels: string[];
  /** The author's own back-links, kept and stamped where the shape allows it. */
  backlinks: Element[];
  /** Nodes deleted whatever happens — Tufte's checkbox, Substack's leading digit. */
  discard: Element[];
  shape: NoteShape;
  reuseBacklinks: boolean;
}

/**
 * Take every reserved attribute off, **including the ones `querySelectorAll`
 * cannot see.** A template's children live in a separate document fragment, so
 * a query walks straight past them while `outerHTML` serialises them in full.
 */
function scrubReserved(root: ParentNode): void {
  sharedScrub(root, RESERVED);
}

/**
 * Every name a fragment could be aiming at.
 *
 * **Two rules, and both of them are the browser's.** `id` before `<a name>`, so
 * a `name` that collides with an id elsewhere never wins; and within each pass
 * the **first in document order** wins, which is what a browser does with a
 * document that uses the same id twice — and CMS output does.
 *
 * The first version of this had the `[id]` loop overwriting, so the *last*
 * duplicate won. A marker whose link resolves correctly in a browser was then
 * rewritten to point at a different element: a correct link made confidently
 * wrong, which is a worse outcome than not recognising the note at all.
 *
 * `src/blocks.ts` (see the loop over `authored`, around the `renamed` map) is
 * the authority on this rule and states it in the same words. It is duplicated
 * here and in `src/web/internal-links.ts`, which gets it from `querySelector`
 * returning the first match rather than from a loop, because each reads a
 * different shape of input; that duplication is what produced the bug, and
 * unifying it is a change to three call sites rather than to this stage.
 * (This used to name a fourth, `src/graph.ts`. No such file has ever existed —
 * `git log --all` is empty for it — and `src/web/graph.ts` is about tf-idf
 * edges, not fragments. Corrected 2026-09-03.)
 */
function indexTargets(doc: Document): Map<string, Element> {
  const byName = new Map<string, Element>();
  for (const el of Array.from(doc.querySelectorAll("[id]"))) {
    if (el.id && !byName.has(el.id)) byName.set(el.id, el);
  }
  for (const el of Array.from(doc.querySelectorAll("a[name]"))) {
    const name = el.getAttribute("name");
    if (name && !byName.has(name)) byName.set(name, el);
  }
  return byName;
}

/** `decodeURIComponent` throws on a lone `%`; a malformed fragment is just text. */
function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/** What `<a href="#…">` points at, or null if it points nowhere or off-document. */
function resolveAnchor(a: Element, byName: Map<string, Element>): Element | null {
  const href = a.getAttribute("href");
  if (!href || href.length < 2 || !href.startsWith("#")) return null;
  const raw = href.slice(1);
  return byName.get(raw) ?? byName.get(decodeFragment(raw)) ?? null;
}

const textOf = (el: Element): string => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const wordCount = (s: string): number => (s ? s.split(/\s+/).length : 0);

/**
 * The note's own words, with the given elements passed over.
 *
 * Used for the identity hash, so that a note's id depends on what it *says* and
 * not on the back-links around it. Wikipedia's back-links read `1 2 3` — one per
 * place the note is cited — so a note gaining a fourth citation would otherwise
 * change identity without a word of it changing.
 */
function textSkipping(el: Element, skip: Set<Element>): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3 /* TEXT_NODE */) out += child.nodeValue ?? "";
    else if (child.nodeType === 1 /* ELEMENT_NODE */ && !skip.has(child as Element)) {
      out += textSkipping(child as Element, skip);
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * The element that holds this note's prose, given whatever the marker's href
 * resolved to.
 *
 * Gwern and Wikipedia both aim at the `<li>` that *is* the note, so the answer
 * is the target. Substack aims at an inline `<a>` holding the note's digit,
 * whose parent is the `<div class="footnote">` that is really the note — and
 * taking the target at face value there is exactly the bug: the marker lands on
 * a block whose entire text is "1".
 *
 * **One level up, and no further.** A rule that kept walking would eventually
 * find a container holding half the article, and hoist it.
 */
function noteBodyFor(target: Element, isForeignMarker: (el: Element) => boolean): Element | null {
  if (NEVER_A_NOTE_BODY.has(target.tagName)) return null;
  if (target.closest(NEVER_INSIDE)) return null;
  if (target.querySelector("h1, h2, h3, h4, h5, h6")) return null;

  // Already block-level, and holds more than a number: it is the note.
  if (NOTE_BODY_TAGS.has(target.tagName) && wordCount(textOf(target)) > 2) return target;

  /* One level up. The guard is that the parent must not cite a *different*
     note: a paragraph of prose does, and a note's own wrapper does not. Its own
     back-link is not a foreign marker, which is what makes Substack — where the
     note's digit is itself a link back to the marker — come out as the `<div>`
     rather than as the digit. */
  const parent = target.parentElement;
  if (
    parent &&
    NOTE_BODY_TAGS.has(parent.tagName) &&
    !parent.querySelector("h1, h2, h3, h4, h5, h6") &&
    !Array.from(parent.querySelectorAll("a[href^='#']")).some(isForeignMarker)
  ) {
    return parent;
  }
  return NOTE_BODY_TAGS.has(target.tagName) ? target : null;
}

/**
 * Gwern, Wikipedia and Substack — three adapters sharing one validator.
 *
 * A pair is a note when **its publisher's own markup says so** (`ANCHOR_SHAPES`),
 * the marker is short enough to *be* a marker, its target is a bounded piece of
 * prose rather than a section, and **the note links back** to at least one of the
 * places it is cited.
 *
 * That last one is validation, not recognition — the first version of this file
 * used it as the whole rule and it accepted table cells and navigation prose. It
 * is still worth keeping, because it is the property that distinguishes a note
 * from a cross-reference *within* a page that does publish footnotes, and it is
 * a property of the note rather than of a single marker: Wikipedia lists one
 * back-link per use, and a note used thirteen times must not lose twelve of them
 * because only the first happened to be checked.
 */
function collectAnchorPairs(doc: Document, byName: Map<string, Element>): Candidate[] {
  const anchors = Array.from(doc.querySelectorAll("a[href^='#']"));

  // Marker-shaped links, grouped by what they point at.
  const groups = new Map<Element, Element[]>();
  for (const a of anchors) {
    if (!MARKER_LABEL.test(textOf(a))) continue;
    const target = resolveAnchor(a, byName);
    if (!target || target === a || target.contains(a)) continue;
    const bucket = groups.get(target);
    if (bucket) bucket.push(a);
    else groups.set(target, [a]);
  }
  const everyMarker = new Set<Element>();
  for (const list of groups.values()) for (const m of list) everyMarker.add(m);

  const out: Candidate[] = [];
  for (const [target, markers] of groups) {
    /* The publisher's own evidence, first and before anything else is asked.
       Every marker in the group has to belong to the same shape as the target:
       if one of them does not, the group is left alone entirely, because moving
       the note would leave that odd marker pointing at an id we had deleted. */
    const shape = ANCHOR_SHAPES.find((s) => s.target(target) && markers.every(s.marker));
    if (!shape) continue;

    /* The round trip. No longer the discriminator — the shape above is — but
       still the check that separates a note from a cross-reference on a page
       that really does publish footnotes.
     *
     * A back-link may aim at the marker itself (Gwern, Substack) or at
     * something small wrapping it (Wikipedia aims at the `<sup>`). It may NOT
     * aim at a block that merely contains the marker: a marker's own href
     * points at the note's `<li>`, and that `<li>` contains the note's
     * back-links — so without this restriction *every* body paragraph holding a
     * single Wikipedia citation round-trips, and gets hoisted into the notes as
     * though it were one. */
    const pointsBackAt = (a: Element): boolean => {
      const t = resolveAnchor(a, byName);
      if (t === null) return false;
      return markers.some(
        (m) =>
          t === m ||
          (t.contains(m) && !NOTE_BODY_TAGS.has(t.tagName) && !NEVER_A_NOTE_BODY.has(t.tagName)),
      );
    };
    /* A marker that cites some *other* note. Its presence says "this is prose",
       which is what stops the one-level-up rule swallowing a paragraph. */
    const isForeignMarker = (el: Element): boolean => everyMarker.has(el) && !pointsBackAt(el);

    const body = noteBodyFor(target, isForeignMarker);
    if (!body) continue;
    if (markers.some((m) => body.contains(m))) continue; // a back-link, not a marker

    const backwards = Array.from(body.querySelectorAll("a[href^='#']")).filter(pointsBackAt);
    if (backwards.length === 0) continue;

    out.push({
      body,
      markers,
      /* The author's own marker text, kept verbatim — as *text*, written with
         `textContent`, so it cannot be markup. Normalising `[1]` to `1` was
         tried and reverted: it changes the words of every paragraph that cites
         a note (so their block ids re-mint for no gain), and it runs Wikipedia's
         `translation,[5][6]` together into `translation,56`, which reads as
         fifty-six. Marker dress belongs to stage 5, where a reader can see it. */
      labels: markers.map((m) => textOf(m)),
      backlinks: backwards,
      discard: [],
      shape: shape.name,
      reuseBacklinks: shape.reuseBacklinks,
    });
  }
  return out;
}

/**
 * Tufte CSS: a `<label>` where the number goes, a checkbox that does the
 * showing and hiding, and a `<span>` holding the note. The label and the input
 * are both forbidden by our sanitiser and correctly so, so by stage 3 there is
 * nothing left but the note's words, sitting in the middle of somebody else's
 * sentence.
 *
 * The span is the anchor of the search rather than the label, because the span
 * is the only one of the three that carries content — and because Tufte's own
 * documentation page quotes the whole mechanism inside `<pre><code>`, where it
 * is text and not elements, so a query cannot see it.
 */
function collectTufte(doc: Document): Candidate[] {
  const out: Candidate[] = [];
  for (const span of Array.from(doc.querySelectorAll("span.sidenote, span.marginnote"))) {
    /* A margin note holding a picture is a figure caption wearing a margin
       note's clothes. Moving it to the end of the article would separate a
       caption from the thing it captions — a different wrong, and a worse one. */
    const isMargin = span.classList.contains("marginnote");
    if (isMargin && (span.querySelector("img") || span.closest("figure"))) continue;
    if (wordCount(textOf(span)) === 0) continue;
    // Same rule as the anchor shapes: a note never comes out of a table or nav.
    if (span.closest(NEVER_INSIDE)) continue;

    const discard: Element[] = [];
    /* The checkbox is the span's own sibling; the label may be nested inside a
       `<span class="newthought">` a little way off, and is found by its `for`.
       Matched by attribute value rather than by building a selector, so an id
       with a quote or a bracket in it cannot become a selector injection. */
    const input =
      span.previousElementSibling?.tagName === "INPUT" ? span.previousElementSibling : null;
    let marker: Element | null = null;
    if (input) {
      discard.push(input);
      const forId = input.getAttribute("id");
      if (forId) {
        for (const label of Array.from(doc.querySelectorAll("label[for]"))) {
          if (label.getAttribute("for") === forId) {
            marker = label;
            break;
          }
        }
      }
    }
    /* No label to stand in for: put the marker where the note itself sat, which
       is the point in the sentence the author chose. */
    if (!marker) marker = span;
    /* Tufte publishes no back-link at all — the checkbox is the whole return
       journey — so ours is the only one there will be. */
    out.push({
      body: span,
      markers: [marker],
      labels: [""],
      backlinks: [],
      discard,
      shape: "tufte",
      reuseBacklinks: false,
    });
  }
  return out;
}

/**
 * An identity for a note that is neither its number nor its position.
 *
 * From a hash of the note's own words, so it survives an author inserting a new
 * note above it — the case that renumbers everything and, left to the ordinary
 * carry-over key, re-mints the id of every paragraph that cites one. Two notes
 * reading exactly alike ("Ibid.") get a counter appended, because an id has to
 * be unique before it can be anything else.
 */
function mintNoteId(text: string, taken: Set<string>): string {
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 10);
  let id = `spya-note-${digest}`;
  for (let n = 2; taken.has(id); n++) id = `spya-note-${digest}-${n}`;
  taken.add(id);
  return id;
}

/** The deepest element containing all of them, or null if the list is empty. */
function commonAncestor(els: Element[]): Element | null {
  let current = els[0] ?? null;
  for (const el of els.slice(1)) {
    while (current && !current.contains(el)) current = current.parentElement;
    if (!current) return null;
  }
  return current;
}

/**
 * Form controls and hidden text, out of a note before anything reads it.
 *
 * They are never prose, they are what Tufte's mechanism is made of, and a page
 * that put one inside a note would otherwise have it walked into a container we
 * build. **Called before the identity hash, not after**: hashing first meant that
 * editing the text of a hidden `<script>` or `<style>` inside a note changed the
 * note's id while every visible word of it stayed the same.
 */
function stripNeverAdmitted(el: Element): void {
  for (const bad of Array.from(el.querySelectorAll(NEVER_ADMITTED))) bad.remove();
}

/**
 * Everything a note ends up saying, moved rather than copied — so the note's own
 * hyperlinks stay live and the ordinary sanitiser is still the thing that
 * decides what survives.
 */
function moveContents(from: Element, to: Element): void {
  while (from.firstChild) to.appendChild(from.firstChild);
}

/**
 * Which markers the author already provides a way back from.
 *
 * Wikipedia lists one back-link per use — thirteen on one note in this corpus —
 * and aims each at the `<sup>` that wraps the marker rather than at the marker
 * itself, which is why containment counts and not just identity.
 */
function backLinksByMarker(
  markers: Element[],
  backlinks: Iterable<Element>,
  byName: Map<string, Element>,
): Map<Element, Element[]> {
  const out = new Map<Element, Element[]>();
  for (const back of backlinks) {
    const target = resolveAnchor(back, byName);
    if (target === null) continue;
    for (const marker of markers) {
      if (target === marker || target.contains(marker)) {
        out.set(marker, [...(out.get(marker) ?? []), back]);
      }
    }
  }
  return out;
}

/**
 * Our marker in place of the author's, keeping the id they gave it.
 *
 * Wrapped in a `<sup>` unless the author already had one around it — that is the
 * shape a reader expects, and it is what Gwern and Wikipedia both draw, one way
 * or the other. The label is written with `textContent`, so it is text and
 * cannot be markup.
 */
function replaceMarker(
  doc: Document,
  original: Element,
  { noteId, markerId, label }: { noteId: string; markerId: string; label: string },
): void {
  const link = doc.createElement("a");
  link.setAttribute("href", `#${noteId}`);
  link.setAttribute("id", markerId);
  link.setAttribute(REF_ATTR, noteId);
  link.textContent = label;

  const inSup = original.parentElement?.tagName === "SUP";
  const replacement: Element = inSup ? link : doc.createElement("sup");
  if (!inSup) replacement.appendChild(link);
  original.replaceWith(replacement);
}

/** Strip whatever is now empty, up to but never including `stop`. */
function pruneEmptyAncestors(from: Element | null, stop: Element | null): void {
  let node = from;
  while (node && node !== stop && node.parentElement) {
    const parent = node.parentElement;
    const empty =
      !/\S/.test(node.textContent ?? "") &&
      node.querySelector("img, picture, video, audio, iframe, svg, canvas") === null;
    if (!empty) return;
    node.remove();
    node = parent;
  }
}

/**
 * Rewrite every footnote shape in `doc` into one, in place.
 *
 * Call it before Readability. Returns what it did, in numbers a naive
 * implementation would conflate: how many notes there are, how many places cite
 * them, how many back-links that came to, how many of those we wrote ourselves,
 * and which publisher's shape each note was recognised by.
 */
export function canonicaliseNotes(doc: Document): NoteStats {
  scrubReserved(doc);

  const byName = indexTargets(doc);
  const candidates = [...collectAnchorPairs(doc, byName), ...collectTufte(doc)];
  if (candidates.length === 0) return EMPTY_STATS();

  /* Document order, so the notes list reads in the order the article cites
     them rather than in the order two detectors happened to run. */
  candidates.sort((a, b) =>
    a.body.compareDocumentPosition(b.body) & 4 /* DOCUMENT_POSITION_FOLLOWING */ ? -1 : 1,
  );

  const taken = new Set<string>(Array.from(doc.querySelectorAll("[id]"), (el) => el.id));
  const stats = EMPTY_STATS();

  const host = commonAncestor(candidates.flatMap((c) => [c.body, ...c.markers]));
  if (!host) return EMPTY_STATS();

  const container = doc.createElement("section");
  container.setAttribute(CONTAINER_ATTR, "");
  const list = doc.createElement("ol");
  container.appendChild(list);

  let tufteNumber = 0;
  let markerSeq = 0;

  /* Two targets sitting in one wrapper would derive the same body, and the
     second of them would then hoist an element the first had already emptied —
     an `<li>` holding nothing but a back-link, which is the stub bug again in a
     new place. */
  const consumed = new Set<Element>();

  for (const candidate of candidates) {
    if (consumed.has(candidate.body)) continue;
    consumed.add(candidate.body);

    /* The author's own back-links, kept where the shape allows it — which is the
       id contract, not tidiness. See point 5 in the header: writing `↩` over
       Gwern's `↩︎` changed every note block's text and re-minted all 34 of them.
       Substack's back-link is the anchor holding the note's leading digit, so
       there it goes and ours takes its place at the end, where it does not lead
       the block. */
    const kept = candidate.reuseBacklinks ? candidate.backlinks : [];
    if (!candidate.reuseBacklinks) for (const old of candidate.backlinks) old.remove();
    for (const old of candidate.discard) old.remove();

    /* Strip first, hash second. The other way round, editing the text of a
       hidden `<script>` inside a note changed the note's identity while every
       visible word of it stayed the same. */
    stripNeverAdmitted(candidate.body);
    const keptSet = new Set(kept.filter((el) => candidate.body.contains(el)));
    const prose = textSkipping(candidate.body, keptSet);
    if (wordCount(prose) === 0) continue; // nothing to be a note

    const noteId = mintNoteId(prose, taken);
    const item = doc.createElement("li");
    item.setAttribute("id", noteId);
    item.setAttribute(NOTE_ATTR, noteId);
    moveContents(candidate.body, item);

    const backFor = backLinksByMarker(candidate.markers, keptSet, byName);

    for (let i = 0; i < candidate.markers.length; i++) {
      const original = candidate.markers[i]!;
      /* The id the author gave this marker, kept — their back-link's href points
         at it, and minting a new one is how the back-links came to dangle and be
         thrown away. Only a marker they left anonymous gets one of ours. */
      const markerId = original.id || uniqueId(`spya-noteref-${++markerSeq}`, taken);
      const label =
        candidate.shape === "tufte"
          ? String(i === 0 ? ++tufteNumber : tufteNumber)
          : candidate.labels[i] || String(i + 1);

      replaceMarker(doc, original, { noteId, markerId, label });
      stats.markers++;

      /* Stamped in place where the author wrote one. Not the text, not the href,
         not the element — the note block's words have to come out exactly as
         they went in, or the block loses its id on the next re-extraction. */
      const existing = backFor.get(original) ?? [];
      for (const back of existing) {
        back.setAttribute(BACK_ATTR, noteId);
        stats.backlinks++;
      }
      if (existing.length > 0) continue;

      const back = doc.createElement("a");
      back.setAttribute("href", `#${markerId}`);
      back.setAttribute(BACK_ATTR, noteId);
      back.textContent = "↩";
      item.appendChild(doc.createTextNode(" "));
      item.appendChild(back);
      stats.backlinks++;
      stats.synthesised++;
    }

    list.appendChild(item);
    stats.notes++;
    stats.shapes[candidate.shape]++;

    /* The husk the note left behind — Substack's `<div class="footnote">`,
       Gwern's `<li>` and the `<ol>` and `<section>` that held it — goes, or
       stage 3 emits a run of empty blocks and an `<hr>` where the notes used
       to be. */
    const parent = candidate.body.parentElement;
    candidate.body.remove();
    pruneEmptyAncestors(parent, host);
  }

  host.appendChild(container);
  return stats;
}

/** `base`, or `base-2`, `base-3`… — whichever is not spoken for yet. */
function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}
