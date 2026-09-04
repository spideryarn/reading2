/**
 * Footnotes, as the reader meets them in the prose — one place that knows what
 * a marker is, which blocks a note is made of, and what a preview of one may
 * contain.
 *
 * Stage 2 rewrites every publisher's footnote markup into one shape
 * (src/notes.ts) and stage 3 carries three fields onto the blocks — `role`,
 * `treatment` and `noteId`. What arrives here, measured through the real
 * pipeline over the gwern, wikipedia, substack and tufte fixtures, is:
 *
 *     marker:  <sup><a href="#spya-a3maqu" id="fnref1"
 *                      data-spya-note-ref="spya-note-71f9008f33">1</a></sup>
 *     note:    <li id="spya-a3maqu" data-spya-note="spya-note-71f9008f33">…
 *                <a href="#spya-h67683" data-spya-note-back="…">↩︎</a></li>
 *
 * The marker's `href` has already been repointed at the note's **block** id by
 * stage 3, and every one of the 34 + 170 + 18 + 5 markers in those fixtures
 * lands on the *first* block of its note.
 *
 * ## A marker is recognised twice, and both halves are needed
 *
 * The attribute is fast and it is ours — stage 2 scrubs every copy of it off the
 * page before writing its own, so a hostile article cannot forge one. A *buggy*
 * pipeline can, though, and that is what the second half catches: resolve the
 * href through `internalTarget` — the same resolver a click goes through, so the
 * card and the jump can never disagree — and check that the block it lands on is
 * really a note. Both maps are precomputed, so the check costs a lookup.
 *
 * **Never by being inside a `<sup>`.** Superscripts are also powers, ordinals
 * and trademarks (docs/plans/260828o-footnotes.md § Why both directions may already
 * work).
 *
 * ## A note is a range of blocks
 *
 * Gwern has 34 notes across 41 blocks: `ownContent` splits a note containing a
 * list into the parent item and its children (src/blocks.ts), and Substack used
 * to split every note into a digit and its prose. So a preview gathers **every**
 * block carrying the note's id, in document order, and shows the whole thing —
 * a note clipped to its first block is a preview that lies about the note's
 * length.
 *
 * ## Why the preview is rebuilt rather than injected
 *
 * The stored html of a note block carries `id="spya-a3maqu"` and, on Wikipedia,
 * a hundred of Parsoid's own `id="mwBg4"`s. Injecting it a second time would put
 * **duplicate ids in the document**, and everything in this app addresses text by
 * id — including `internalTarget`'s own `[id="…"]` fallback, which takes the
 * first in document order and would start resolving the article's links into a
 * floating card. So every id is **stripped** rather than namespaced: a namespaced
 * id is still an id nothing links to, and the preview is a transient copy that
 * nothing may ever be the target of. Fewer parts, and no second naming scheme to
 * keep unique.
 *
 * The other half of the trap is that the preview lives in a portal, outside
 * `TableView`'s delegated click handler (TableView.tsx § onClick), so its links
 * would either do nothing or navigate the whole page. It owns its own delegation
 * — see `ProseHoverCard` § NoteCard.
 */
import type { BlockId } from "../types.js";
import { internalTarget } from "./internal-links.js";

/* **The three names come from src/reserved.ts, which is where stage 2 writes
   them.** They used to be spelled again here, and this file is the one place
   that spelling could drift without either side going red: stage 2 mints the
   attribute, the stored html carries it across a database, and this reads it
   back months later. That module has no imports precisely so the browser can
   have it. docs/plans/260831af-carrying-markup-facts-past-readability.md. */
import { RESERVED_ATTRS } from "../reserved.js";

/** On a marker in the prose. The value is the id of the note it points at. */
export const NOTE_REF_ATTR = RESERVED_ATTRS.noteRef;
/** On a back-link inside a note. The value is the note it belongs to. */
export const NOTE_BACK_ATTR = RESERVED_ATTRS.noteBack;
/** On the note's own element, written by stage 2 and still in the stored html. */
const NOTE_ATTR = RESERVED_ATTRS.note;
/** Marks the back-link that leads to the passage the reader arrived from. */
export const CAME_FROM_ATTR = "data-came-from";

/**
 * As much of a block as this file needs.
 *
 * Structural rather than `Block`, so a visitor's `PublicBlock` — which carries
 * all three note fields in full (public-types.ts) — is accepted unchanged.
 */
export interface NoteBlock {
  id: BlockId;
  tag: string;
  html: string;
  role?: string | undefined;
  treatment?: string | undefined;
  noteId?: string | undefined;
  /**
   * Only read to decide whether the author already wrote a *Notes* heading
   * above their notes — `notesRegion` below. Optional because nothing else here
   * needs it and a caller holding only `id`/`tag`/`html` is still a legal
   * `NoteBlock`; a missing one simply means we cannot tell, and we draw our own
   * heading, which is the safe direction.
   */
  text?: string | undefined;
}

export interface Note {
  /** The stage-2 note id, `spya-note-…`. */
  id: string;
  /** Every block of it, in document order. Never empty. */
  blocks: NoteBlock[];
  /** The distinct blocks that cite it, in document order. Wikipedia: up to 13. */
  citedBy: BlockId[];
  /** Every marker, which is at least `citedBy.length` — one block can cite twice. */
  markers: number;
  /**
   * **The number the reader sees at the note**, and it is the author's own —
   * the text of the first marker that cites it, in document order: `1`, `[7]`,
   * `†`.
   *
   * Taken from the marker rather than counted here, so that what is printed
   * beside the note is character-for-character what the reader tapped. Counting
   * would drift the moment one note of a piece went unrecognised: the sixth
   * marker would say `6` and the fifth note would say `5`, and neither the
   * reader nor we would know which was lying.
   *
   * `ordinal` is the fallback, and there are two ways to reach it — a note
   * nothing cites (there is no marker to take a label from) and a label too
   * long to be a number, which is markup we did not expect rather than a
   * footnote number. Stage 2 guarantees a non-empty label on every marker it
   * writes (`src/notes.ts`, `candidate.labels[i] || String(i + 1)`), so in
   * practice the first case is the live one.
   */
  label: string;
  /** 1-based, by the document order of each note's first marker. */
  ordinal: number;
}

export interface NoteIndex {
  byNote: Map<string, Note>;
  /** A note block's id to the note it belongs to. Only note blocks are in it. */
  noteOf: Map<BlockId, string>;
  /**
   * The first block of the notes region, or null when the article has none.
   *
   * Stage 2 gathers every note into one container at the end of the document
   * (`src/notes.ts`), so the region really is one contiguous run and the reading
   * view can draw a rule above it.
   */
  first: BlockId | null;
  /**
   * Does a heading already say these are the notes?
   *
   * Gwern's page ends `## Bibliography` and then nine bare `<li>`s, so the
   * reader meets the apparatus with nothing to say it is apparatus. Wikipedia
   * writes its own `References` heading and must not get a second one.
   */
  titled: boolean;
}

/**
 * A block that is really part of a note.
 *
 * All three fields, not just `role`: they are written together by one ancestor
 * lookup in stage 3, so a block carrying one and not the others is a broken
 * pipeline rather than a shape to be tolerant of — and tolerating it is how a
 * preview ends up rendering an ordinary paragraph as apparatus.
 */
function isNoteBlock(block: NoteBlock): boolean {
  return (
    block.role === "footnote" &&
    block.treatment === "supplement" &&
    typeof block.noteId === "string" &&
    block.noteId.length > 0
  );
}

/**
 * Every `data-spya-note-ref` in a piece of stored html, in order, with the text
 * the author put in it.
 *
 * The label is read out of the same match rather than from a second pass,
 * because it is only ever the marker's own text node: stage 2 writes it with
 * `textContent` (`replaceMarker`, src/notes.ts), so there is no markup inside a
 * marker to trip over and the stamp is the last attribute on the element. A
 * shape we did not write falls out as an empty label and the note takes its
 * ordinal instead.
 */
function markersIn(html: string): { id: string; label: string }[] {
  if (!html.includes(NOTE_REF_ATTR)) return [];
  const re = new RegExp(`${NOTE_REF_ATTR}="([^"]*)"[^>]*>([^<]*)`, "g");
  return [...html.matchAll(re)].map((m) => ({ id: m[1] ?? "", label: (m[2] ?? "").trim() }));
}

/**
 * A marker's text, if it is short enough to be a number.
 *
 * `1`, `[7]`, `†`, `a` — all of them fine. Anything longer is markup we did not
 * expect, and printing it in a 2rem margin would push the note's first line
 * somewhere strange. Six characters is `[123]` with room to spare.
 */
const NUMBERISH = 6;

/**
 * The notes of an article, from its blocks alone.
 *
 * Built once per article and handed to the hover card, because `read` runs on
 * every `pointerover` that hits a link and must not scan anything. The marker
 * scan is a string test per block before any regex, so the 143 body blocks of
 * gwern that carry no marker cost one `includes`.
 */
export function buildNoteIndex(blocks: readonly NoteBlock[]): NoteIndex {
  const byNote = new Map<string, Note>();
  const noteOf = new Map<BlockId, string>();

  let first: BlockId | null = null;
  let before: NoteBlock | null = null;
  let previous: NoteBlock | null = null;
  for (const block of blocks) {
    if (!isNoteBlock(block)) {
      previous = block;
      continue;
    }
    if (first === null) {
      first = block.id;
      before = previous;
    }
    const id = block.noteId as string;
    noteOf.set(block.id, id);
    const note = byNote.get(id);
    if (note) note.blocks.push(block);
    else byNote.set(id, { id, blocks: [block], citedBy: [], markers: 0, label: "", ordinal: 0 });
  }

  countCitations(blocks, byNote);
  return { byNote, noteOf, first, titled: introduces(before) };
}

/**
 * Which passages cite each note, and what the author numbered it.
 *
 * Read out of the body's own html rather than out of the DOM, so it is the same
 * answer before the article is rendered and during a re-annotation — and so the
 * count is of the article, not of what happens to be mounted.
 *
 * Fills `markers`, `citedBy`, `label` and `ordinal` in place.
 */
function countCitations(blocks: readonly NoteBlock[], byNote: Map<string, Note>): void {
  let numbered = 0;
  for (const block of blocks) {
    let cited: Set<string> | null = null;
    for (const { id, label } of markersIn(block.html)) {
      const note = byNote.get(id);
      if (!note) continue;
      note.markers += 1;
      /* The **first** marker in document order settles both, and neither is
         revisited: a Wikipedia note cited thirteen times has thirteen markers
         reading `[5]`, and one cited from a table of contents as well as from
         the prose would otherwise take its number from whichever came last. */
      if (note.ordinal === 0) {
        note.ordinal = ++numbered;
        note.label = label.length > 0 && label.length <= NUMBERISH ? label : String(note.ordinal);
      }
      cited ??= new Set<string>();
      if (cited.has(id)) continue;
      cited.add(id);
      note.citedBy.push(block.id);
    }
  }

  /* A note nothing cites still needs a number, and it has to be one no cited
     note is already using — so they carry on from the last marker rather than
     restarting. Rare: it means stage 2 kept a note whose marker did not survive
     stage 3. */
  for (const note of byNote.values()) {
    if (note.ordinal !== 0) continue;
    note.ordinal = ++numbered;
    note.label = String(note.ordinal);
  }
}

/**
 * Headings that already say "the notes start here".
 *
 * `References` is in because it is what Wikipedia calls exactly this section.
 * **`Bibliography` is deliberately out**: it is the list of works cited, which
 * is a different thing that often sits directly above the notes — it does on
 * the gwern page this was reported from — and treating it as a notes heading
 * would suppress ours precisely where it is most needed.
 */
const NOTES_HEADING = /^(foot|end)?\s*notes?$|^references$/i;

/**
 * Does the block above the notes already introduce them?
 *
 * Text, not html, because the question is what the reader can read — a heading
 * whose words are wrapped in a `<span>` says *Notes* just as plainly. A block
 * with no `text` answers no, and we draw our own heading: two headings is a
 * cosmetic wart, and none is the report this exists to answer.
 */
function introduces(block: NoteBlock | null): boolean {
  if (!block || !/^h[1-6]$/i.test(block.tag)) return false;
  return NOTES_HEADING.test((block.text ?? "").trim());
}

/** Where a note begins, for the row that begins it. Null for every other block. */
export interface NoteStart {
  /** The author's own number for this note — `Note.label`. */
  label: string;
  /** Is this the first note of the article, and so the top of the region? */
  opensRegion: boolean;
  /** Should we draw the heading the source never wrote? */
  needsHeading: boolean;
}

/**
 * Is this block the start of a note, and if so what should be drawn beside it?
 *
 * Called once per row of the reading table, so it is two map lookups and a
 * comparison. A note is a *range* of blocks (see the header), and only its first
 * one gets a number — the other seven of gwern's longest are continuations of
 * the same note and numbering each would claim there were eight.
 */
export function noteStartAt(index: NoteIndex, blockId: BlockId): NoteStart | null {
  const noteId = index.noteOf.get(blockId);
  if (!noteId) return null;
  const note = index.byNote.get(noteId);
  if (!note || note.blocks[0]?.id !== blockId) return null;
  const opensRegion = index.first === blockId;
  return { label: note.label, opensRegion, needsHeading: opensRegion && !index.titled };
}

/** What the pointer found, when what it found is a footnote marker. */
export interface NoteMarker {
  note: Note;
  /** The block the jump lands on — the note's first. */
  blockId: BlockId;
  /** The author's own marker text: `1`, `[1]`, `†`. May be empty. */
  label: string;
}

/**
 * Is this element inside a footnote marker, and if so, whose?
 *
 * Null for everything else, including an `<a>` carrying our attribute whose
 * target is not a note block — see the header. Cheap enough for a hover: one
 * `closest`, one resolution, two map lookups.
 */
export function noteMarkerAt(
  el: Element,
  doc: Document,
  index: NoteIndex,
): NoteMarker | null {
  const anchor = el.closest?.(`a[${NOTE_REF_ATTR}]`);
  if (!anchor) return null;
  const blockId = internalTarget(anchor, doc);
  if (!blockId) return null;
  const noteId = index.noteOf.get(blockId);
  if (!noteId) return null;
  /* The two halves have to agree. They are written from one stamp, so a
     disagreement is a pipeline fault, and drawing a card for the note the href
     happens to reach would be confidently wrong rather than silent. */
  const stamped = anchor.getAttribute(NOTE_REF_ATTR);
  if (stamped && stamped !== noteId) return null;
  const note = index.byNote.get(noteId);
  if (!note) return null;
  return { note, blockId, label: (anchor.textContent ?? "").trim() };
}

/**
 * Is this element inside a note's back-link — the other direction?
 *
 * Its href was repointed at the **block** that cites the note, so hovering one
 * previews that passage and clicking one goes there, both through machinery that
 * already exists. What this adds is that the card can say which direction it is
 * pointing: "elsewhere in this article" is true and useless on a back-link.
 */
export function isBackLink(el: Element): boolean {
  return el.closest?.(`a[${NOTE_BACK_ATTR}]`) !== null;
}

/** A note's own element, unwrapped so the preview reads as prose and not as a bullet. */
const UNWRAP = new Set(["LI", "DD"]);

/**
 * The note's whole text, as a fragment safe to put in a floating card.
 *
 * Every id goes, every `<a name>` goes, and the note's back-links go with them:
 * Wikipedia's are the run of `1 2 3 …` that opens the note, which in a preview
 * of that note is thirteen links to where the reader already is. What is left is
 * the note's own words with its own hyperlinks live, which is the whole point of
 * a sidenote-grade preview.
 *
 * Parsed into an inert document — `createHTMLDocument` has no browsing context,
 * so nothing loads and nothing runs — and the html was sanitised server-side
 * before it was stored. This only removes.
 */
export function notePreviewHtml(note: Note, doc: Document): string {
  const inert = doc.implementation.createHTMLDocument("");
  const out = inert.createElement("div");

  for (const block of note.blocks) {
    const holder = inert.createElement("div");
    holder.innerHTML = block.html;

    for (const back of Array.from(holder.querySelectorAll(`a[${NOTE_BACK_ATTR}]`))) {
      const parent = back.parentElement;
      back.remove();
      pruneEmpty(parent, holder);
    }
    for (const el of Array.from(holder.querySelectorAll("*"))) {
      el.removeAttribute("id");
      el.removeAttribute("name");
      el.removeAttribute(NOTE_ATTR);
    }

    const part = inert.createElement("div");
    part.className = "note-part";
    part.setAttribute("data-tag", block.tag.toLowerCase());
    const only = holder.children.length === 1 ? holder.firstElementChild : null;
    const source = only && UNWRAP.has(only.tagName) ? only : holder;
    while (source.firstChild) part.appendChild(source.firstChild);
    out.appendChild(part);
  }

  return out.innerHTML;
}

/** Whatever is left with nothing in it, up to but never including `stop`. */
function pruneEmpty(from: Element | null, stop: Element): void {
  let node = from;
  while (node && node !== stop && node.parentElement) {
    const parent = node.parentElement;
    if (/\S/.test(node.textContent ?? "")) return;
    if (node.querySelector("img, picture, video, audio, iframe, svg, canvas")) return;
    node.remove();
    node = parent;
  }
}

/**
 * **Where the reader came from**, which is a passage *and* a note — never one
 * of the two.
 *
 * Carried as one value rather than as two arguments so that a caller cannot
 * pair the passage it left with a different note than the one it followed. Both
 * halves come off a single `NoteMarker`, so the mismatch is unrepresentable
 * rather than merely avoided. GPT Sol, F7.
 */
export interface NoteReturn {
  /** The block the reader was reading when they followed the marker. */
  from: BlockId;
  /** The note they followed — `Note.id`, the stage-2 `spya-note-…`. */
  noteId: string;
}

/**
 * Mark the way back the reader actually came.
 *
 * One note, thirteen markers, thirteen back-links — and a reader who followed
 * the seventh has no way to tell which of the thirteen is theirs. The back-links
 * point at *blocks* (stage 3 repoints them there), so the passage is half the
 * answer.
 *
 * **Only half.** Matching on the passage alone asks "which back-links lead
 * where I came from", and when that passage cites *two* notes the answer is one
 * back-link in each of them — so the second note lit up claiming to be the way
 * the reader had come. The case that was tested was one note cited thirteen
 * times, which is the mirror image and works; the case that was not is two
 * notes cited from one sentence. GPT Sol, F7. So both halves are compared, and
 * the note id is what tells the two apart.
 *
 * **Compared as attributes, not built into a selector.** `fromBlockId` used to
 * be interpolated into a query string behind an `/^[A-Za-z0-9_-]+$/` test; two
 * values would now need that test, and a second regex guarding a second
 * interpolation is two chances to get it wrong for no gain. Querying the fixed
 * attribute selector and comparing raw attribute values removes the dynamic
 * selector entirely, which is Sol's correction to this fix and better than the
 * `CSS.escape` it replaces the need for.
 *
 * Written straight onto injected html rather than through the annotation pass,
 * for the reason `TAP_ATTR` gives in useHoverCard.ts: React replaces those nodes
 * wholesale, so a stale mark leaves with the node it was on — and the caller
 * re-runs this whenever the prose is re-annotated.
 *
 * One note cited **twice in the same passage** still marks both of its
 * back-links, and that is left alone: both lead to the same block, and this
 * app's navigation contract is block-level throughout (docs/project/block-ids.md).
 *
 * Returns the undo.
 */
export function markReturnPath(root: ParentNode, origin: NoteReturn | null): () => void {
  if (!origin?.from || !origin.noteId) return () => {};
  const href = `#${origin.from}`;
  const marked = Array.from(root.querySelectorAll(`a[${NOTE_BACK_ATTR}]`)).filter(
    (a) => a.getAttribute(NOTE_BACK_ATTR) === origin.noteId && a.getAttribute("href") === href,
  );
  for (const el of marked) el.setAttribute(CAME_FROM_ATTR, "");
  return () => {
    for (const el of marked) el.removeAttribute(CAME_FROM_ATTR);
  };
}
