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
 * and trademarks (docs/plans/footnotes.md § Why both directions may already
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

/** On a marker in the prose. The value is the id of the note it points at. */
export const NOTE_REF_ATTR = "data-spya-note-ref";
/** On a back-link inside a note. The value is the note it belongs to. */
export const NOTE_BACK_ATTR = "data-spya-note-back";
/** On the note's own element, written by stage 2 and still in the stored html. */
const NOTE_ATTR = "data-spya-note";
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
}

export interface NoteIndex {
  byNote: Map<string, Note>;
  /** A note block's id to the note it belongs to. Only note blocks are in it. */
  noteOf: Map<BlockId, string>;
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

/** Every `data-spya-note-ref` in a piece of stored html, in order. */
function markersIn(html: string): string[] {
  if (!html.includes(NOTE_REF_ATTR)) return [];
  return [...html.matchAll(/data-spya-note-ref="([^"]*)"/g)].map((m) => m[1] ?? "");
}

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

  for (const block of blocks) {
    if (!isNoteBlock(block)) continue;
    const id = block.noteId as string;
    noteOf.set(block.id, id);
    const note = byNote.get(id);
    if (note) note.blocks.push(block);
    else byNote.set(id, { id, blocks: [block], citedBy: [], markers: 0 });
  }

  /* Which passages cite each note. Read out of the body's own html rather than
     out of the DOM, so it is the same answer before the article is rendered and
     during a re-annotation — and so the count is of the article, not of what
     happens to be mounted. */
  for (const block of blocks) {
    let cited: Set<string> | null = null;
    for (const id of markersIn(block.html)) {
      const note = byNote.get(id);
      if (!note) continue;
      note.markers += 1;
      cited ??= new Set<string>();
      if (cited.has(id)) continue;
      cited.add(id);
      note.citedBy.push(block.id);
    }
  }

  return { byNote, noteOf };
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
 * Mark the way back the reader actually came.
 *
 * One note, thirteen markers, thirteen back-links — and a reader who followed
 * the seventh has no way to tell which of the thirteen is theirs. The back-links
 * point at *blocks* (stage 3 repoints them there), so the one to mark is the one
 * whose href is the passage the reader left.
 *
 * Written straight onto injected html rather than through the annotation pass,
 * for the reason `TAP_ATTR` gives in useHoverCard.ts: React replaces those nodes
 * wholesale, so a stale mark leaves with the node it was on — and the caller
 * re-runs this whenever the prose is re-annotated.
 *
 * Returns the undo.
 */
export function markReturnPath(root: ParentNode, fromBlockId: BlockId | null): () => void {
  if (!fromBlockId || !/^[A-Za-z0-9_-]+$/.test(fromBlockId)) return () => {};
  const marked = Array.from(
    root.querySelectorAll(`a[${NOTE_BACK_ATTR}][href="#${fromBlockId}"]`),
  );
  for (const el of marked) el.setAttribute(CAME_FROM_ATTR, "");
  return () => {
    for (const el of marked) el.removeAttribute(CAME_FROM_ATTR);
  };
}
