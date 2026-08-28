/**
 * Pipeline stage 3 — split an extracted article into blocks and give each a
 * stable id. See docs/project/architecture.md#pipeline and
 * docs/project/block-ids.md.
 *
 *   npm run blocks -- output/noema-mythology-of-conscious-ai.html
 *
 * Writes ids into the HTML in place (so `#spya-k3m9qt` anchors work with no
 * JavaScript) and a sibling `.blocks.json`. Re-running is idempotent: ids
 * already present are kept, only missing ones are minted.
 */

import { JSDOM } from "jsdom";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSpideryarnId, mintUniqueId } from "./ids.js";
/* The three strings stage 2 stamped into the DOM, from the file that writes
   them. See noteFieldsFor. */
import { CONTAINER_ATTR, NOTE_ATTR, NOTE_ID_PATTERN } from "./notes.js";
import { sanitizeInPlace, sanitizeStoredBlocks } from "./sanitize.js";
import { SANITIZER_VERSION } from "./sanitize-policy.js";
/* `Block` and `BlockKind` come from types.ts rather than being declared here.
   This file *writes* blocks.json — the spine every later stage addresses text
   through (docs/project/block-ids.md) — so a second declaration of its shape is
   the one place a silent divergence costs most. There was one until
   2026-08-26: field-for-field identical to types.ts, and nothing checking that
   it stayed so, because pipeline.ts reads only `run.stats` and there is no
   assignment point where the two would ever be compared.

   An `import type` is erased, so this does not put jsdom in anyone's bundle —
   the reason types.ts gives for staying declaration-only still holds. */
import type { Block, BlockKind } from "./types.js";

/**
 * Blocks are the *finest* unit a reader takes in as one thing, so a `<li>` is a
 * block and the `<ul>` around it is not. Containers become nodes in the tree
 * instead, which is what lets the ToC choose its own granularity: one row for a
 * list of terse bullets, one row per item for a list of real arguments.
 * See docs/project/table-of-contents.md#granularity.
 */
const LEAF_BLOCKS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "PRE", "BLOCKQUOTE", "FIGURE", "TABLE", "IMG", "HR", "IFRAME",
]);

/** Descended into, never emitted. */
const CONTAINERS = new Set([
  "DIV", "SECTION", "ARTICLE", "MAIN", "UL", "OL", "DL",
  "HEADER", "FOOTER", "ASIDE", "NAV", "BODY",
]);

/**
 * `IFRAME` is deliberately not here, though it used to be. By the time this
 * runs, src/sanitize.ts has already deleted every iframe except a video embed
 * from an allowlisted origin — so the only ones left are ones Greg decided to
 * keep (2026-08-25), and skipping them here would drop the video out of the
 * reading view while leaving it in the HTML file. That is precisely the bug the
 * allowlist was written to avoid, and it survived until GPT-5's review caught
 * it. Sanitising is what makes this line safe to change.
 */
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "FORM", "BUTTON"]);

/**
 * Captions that sit *beside* a figure rather than inside it, so they arrive as
 * ordinary paragraphs. They belong to the image, not to the argument, and a ToC
 * row reading "Figure 2: A modern version of a McCulloch-Pitts neuron…" as a
 * peer of real prose is noise. Matched on the explicit marker only — never on
 * length, because "Given all this, what should we do?" is seven words of
 * genuine argument.
 */
const CAPTION_MARKER = /^(figure|fig\.?|table|chart|diagram|image|photo|plate)\s*\d*\s*[:.—-]/i;

/** Standalone boilerplate labels acting as headings: "Credits", "Sources". */
const BOILERPLATE_LABEL = /^(credits?|sources?|notes?|references?|photo credits?)$/i;

/**
 * Fold text down to what two extractions of the same paragraph agree on: case,
 * punctuation and whitespace all drift between Readability runs, so none of
 * them can be part of a match key.
 *
 * Until 2026-08-26 this was `[^a-z0-9 ]`, which is a correct spelling of
 * "punctuation" only if the only text you have ever looked at is English. In
 * Cyrillic, Greek, Chinese, Arabic or Devanagari it deleted the paragraph, and
 * every one of the five resulting failures reported success — see
 * docs/postmortems/block-id-matching-non-latin.md.
 *
 * `NFKC` first is load-bearing rather than tidy: `\p{M}` is kept so Devanagari
 * matras and Arabic diacritics survive, which means NFD `café` (e + U+0301)
 * would otherwise key differently from NFC `café`. NFKC composes them. It
 * changes string length, which is fatal in src/quote-match.ts — that file
 * hand-rolls a length-preserving fold because it derives offsets — but nothing
 * here derives offsets, so it is available to us.
 *
 * Whitespace is collapsed *after* the strip, not before, so `and — as` and
 * `and as` agree; stripping the dash first leaves a double space behind.
 */
const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, "")
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .trim();

/**
 * Is there anything here at all?
 *
 * A different question from "what is this text's match key", and it has to be
 * asked separately. `normalize` folds `★ ★ ★` and `©` to nothing, so a
 * paragraph made of symbols reads as empty to it — and three call sites used to
 * take that answer as permission to drop the paragraph.
 *
 * Bare `/\S/` is not the test, though, which is what the first version of this
 * used. A zero-width space, a soft hyphen and a lone variation selector are all
 * non-whitespace and all render as nothing, so `<span>&#8203;</span>` became a
 * paragraph and `<p><img>&#8203;</p>` stopped being an image-only one. Every
 * one of those is `Default_Ignorable_Code_Point`, which is precisely the
 * category "present in the text, absent from the page".
 */
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const hasContent = (s: string) => /\S/u.test(s.replace(IGNORABLE, ""));

/** Lists nested directly inside this element. */
const nestedLists = (el: Element) =>
  Array.from(el.children).filter((c) => c.tagName === "UL" || c.tagName === "OL");

/**
 * An `<li>` holding a nested list is a leaf *and* a container: "Nested outer"
 * is its own readable unit, and the items beneath it are separate ones. We emit
 * the item's own content as a block and descend into the sublist, so every item
 * at every level is addressable. Without this the sublist is swallowed into its
 * parent's text and cannot be linked to at all.
 *
 * The block's text and html come from a clone with the sublists stripped, so no
 * two blocks ever contain the same text — the flat sequence the tree ranges
 * over must not overlap.
 */
function ownContent(el: Element): Element {
  const nested = nestedLists(el);
  if (nested.length === 0) return el;
  const clone = el.cloneNode(true) as Element;
  for (const child of nestedLists(clone)) child.remove();
  return clone;
}

/**
 * Text with block boundaries preserved as spaces. Bare `textContent` runs
 * adjacent blocks together — a blockquote of two paragraphs comes out as
 * "…sentence one.Sentence two…" — which corrupts word counts and any gist
 * written from it.
 */
function extractText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const n of Array.from(
    clone.querySelectorAll("p,div,br,li,h1,h2,h3,h4,h5,h6,blockquote,figcaption,td,th,tr"),
  )) {
    n.insertAdjacentText("beforebegin", " ");
  }
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function classify(el: Element): { kind: BlockKind; level?: number } {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) return { kind: "heading", level: Number(tag[1]) };
  if (tag === "PRE") return { kind: "code" };
  if (tag === "BLOCKQUOTE") return { kind: "quote" };
  if (tag === "FIGURE" || tag === "IMG" || tag === "HR" || tag === "IFRAME") {
    return { kind: "media" };
  }
  if (tag === "TABLE") return { kind: "other" };
  return { kind: "text" };
}

/**
 * What kind of block this is, and whether the ToC should write a row about it.
 *
 * `classify` answers from the tag alone; this is everything that needs the text
 * as well. Split out of `splitIntoBlocks` so the id-assignment logic and the
 * gistable rules can each be read without the other.
 */
function describeBlock(
  el: Element,
  text: string,
  proseText: string[],
): { kind: BlockKind; level: number | undefined; gistable: boolean; note: string | undefined } {
  let { kind, level } = classify(el);
  let gistable = true;
  let note: string | undefined;

  if (kind === "media" || el.tagName === "HR") {
    gistable = false;
    note = "media";
  } else if (el.tagName === "P" && isImageOnly(el)) {
    kind = "media";
    gistable = false;
    note = "image-only paragraph";
  } else if (text.length === 0) {
    gistable = false;
    note = "empty";
  } else if (CAPTION_MARKER.test(text)) {
    kind = "caption";
    gistable = false;
    note = "figure caption";
  } else if (BOILERPLATE_LABEL.test(text)) {
    gistable = false;
    note = "boilerplate label";
  }

  // Pull-quotes repeat a sentence that is already in the prose. Giving them
  // gists would put the same claim in the ToC twice.
  if (gistable && (kind === "quote" || el.closest("figure"))) {
    const probe = normalize(text).slice(0, 60);
    if (probe.length >= 30 && proseText.some((p) => p.includes(probe))) {
      gistable = false;
      note = "pull-quote duplicating body text";
    }
  }

  return { kind, level, gistable, note };
}

/** What `noteFieldsFor` can add to a block. All three absent for body prose. */
type NoteFields = Pick<Block, "role" | "treatment" | "noteId">;

/**
 * Whether this block is apparatus rather than argument, read off the stamps
 * stage 2 left in the DOM (src/notes.ts).
 *
 * **An ancestor lookup, not a check for the stamp itself, and that is the whole
 * point.** A note is a *range* of blocks: gwern has 34 notes and 118
 * block-level elements inside the notes container, so classifying only the
 * elements carrying `data-spya-note` would leave 84 blocks of footnote prose
 * classified as argument — summarised, embedded, and on the clock — with every
 * count still looking plausible. Measured, docs/plans/footnotes.md.
 *
 * A block is a supplement because it is **inside the container**; it belongs to
 * a note because a `[data-spya-note]` ancestor says which. The container is
 * asked first so that a stamp somewhere else in the document — which stage 2
 * never produces — cannot pull a paragraph out of the argument on its own.
 *
 * **Where the forgery defence lives, because it is not here.** These attributes
 * are ours and therefore forgeable, and stage 3 cannot tell one of ours from a
 * page's. The scrub is at stage 2, where the untrusted document arrives:
 * `scrubReserved` takes every copy off before a single one of ours is written,
 * and it runs unconditionally, before the "no candidates" early return. So the
 * rule stage 3 depends on is that **`splitIntoBlocks` is only ever handed HTML
 * that has been through `canonicaliseNotes`** — which today is the whole of
 * `runExtract`, its only production caller. `NOTE_ID_PATTERN` is the belt: a
 * value that is not the ten hex digits stage 2 mints is not carried, so nothing
 * a page wrote can reach blocks.json, Postgres or the public payload as an id.
 *
 * Only `"footnote"` is assigned. See `Block.role` for why the other four exist.
 */
function noteFieldsFor(el: Element): NoteFields {
  if (el.closest(`[${CONTAINER_ATTR}]`) === null) return {};
  const noteId = el.closest(`[${NOTE_ATTR}]`)?.getAttribute(NOTE_ATTR);
  return {
    role: "footnote",
    treatment: "supplement",
    ...(noteId && NOTE_ID_PATTERN.test(noteId) ? { noteId } : {}),
  };
}

/** A `<p>` whose only real content is an image is a media block, not prose. */
function isImageOnly(el: Element): boolean {
  return (
    el.querySelector("img") !== null && !hasContent(el.textContent ?? "")
  );
}

/**
 * Wrap loose text sitting directly inside a container in a `<p>`, so it becomes
 * addressable instead of vanishing.
 *
 * `walk` iterates `el.children`, which is elements only — so a bare text node
 * between two containers is invisible to it and its words never reach any
 * block. That was survivable while every wrapper the author wrote survived to
 * this point, because the text always had *some* element around it. Sanitising
 * broke that assumption: DOMPurify drops an unrecognised tag but keeps its
 * contents, so `<x-article>real prose</x-article>` — the kind of custom element
 * a modern CMS emits, which Readability passes through untouched — arrives here
 * as naked text and used to be silently dropped, along with whatever id it
 * carried. GPT-5's review caught it, 2026-08-25.
 *
 * Done here rather than in a pass of its own so it inherits `walk`'s decision
 * about what counts as a container: the only elements this touches are ones we
 * were about to descend into and emit nothing for.
 */
function rewrapOrphanText(el: Element): void {
  const doc = el.ownerDocument;
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== 3) continue; // TEXT_NODE
    if (!hasContent(node.nodeValue ?? "")) continue;
    const p = doc.createElement("p");
    el.replaceChild(p, node);
    p.appendChild(node);
  }
}

function collectElements(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    rewrapOrphanText(el);
    for (const child of Array.from(el.children)) {
      const tag = child.tagName;
      if (SKIP.has(tag)) continue;
      if (LEAF_BLOCKS.has(tag)) {
        out.push(child);
        // A list item is the one leaf that can contain further blocks.
        if (tag === "LI") for (const sublist of nestedLists(child)) walk(sublist);
        continue; // otherwise never descend into a leaf
      }
      if (CONTAINERS.has(tag)) {
        walk(child);
        continue;
      }
      // Unknown wrapper: descend if it holds block-level children, else treat
      // it as a block so no content silently disappears.
      const hasBlockChildren = Array.from(child.children).some(
        (c) => LEAF_BLOCKS.has(c.tagName) || CONTAINERS.has(c.tagName),
      );
      if (hasBlockChildren) walk(child);
      else if (hasContent(child.textContent ?? "")) out.push(child);
    }
  };
  walk(root);
  return out;
}

export interface SplitResult {
  blocks: Block[];
  html: string;
  stats: {
    total: number;
    reused: number;
    carried: number;
    minted: number;
    /** Internal links repointed from the author's id to ours. retargetAnchors. */
    retargeted: number;
    gistable: number;
  };
}

/**
 * Ids already present in the HTML survive a re-run of this stage. They do NOT
 * survive a re-run of *stage 2*, which writes a fresh document from Readability
 * with no ids in it at all — and re-extraction is exactly the case random ids
 * exist to protect against (block-ids.md#why-random-and-not-sequential).
 *
 * So when the previous blocks.json is available we re-attach ids by matching
 * block text. A paragraph keeps its id for as long as its words are unchanged,
 * regardless of what was inserted above it. An edited paragraph gets a fresh id
 * and loses its annotations — that is a real limit, and honest: we cannot tell
 * a heavily rewritten paragraph from a new one.
 *
 * Matching is first-come over the previous document's order, and each previous
 * id is consumed once, so a page with several identical short paragraphs can't
 * hand the same id to two blocks.
 */
/**
 * Pass one's key: the tag, plus the text as written with whitespace collapsed.
 * Two runs that produced the same paragraph agree here.
 *
 * **The tag is in the key because the text alone is not enough**, which GPT
 * Sol's review of the first version of this file caught: `<h2>Same words</h2>`
 * and `<p>Same words</p>` keyed identically, so re-rendering them the other way
 * round swapped their ids and reported `carried: 2`. Two paragraphs that really
 * do read alike still share a key, and still take their ids in order — that is
 * correct, because they *are* alike, and minting instead would drop the ids of
 * every repeated `<li>Yes</li>` on the page.
 */
function exactKey(tag: string, text: string, html: string): string | null {
  const written = text.replace(/\s+/gu, " ").trim();
  if (written) return `x:${tag}:${written}`;
  // Images and rules carry no text, so match them on what they point at —
  // otherwise every figure is re-minted on each re-extraction and any ToC row
  // aimed at a diagram goes stale.
  const src = /\bsrc="([^"]+)"/.exec(html)?.[1];
  return src ? `s:${tag}:${src}` : null;
}

/**
 * Pass two's key: the same words, once punctuation and case are folded away.
 *
 * **A key with no letter or number in it is not a key**, and returning one is
 * how `❤️` and `☀️` came to share an id: the fold strips both symbols and keeps
 * the variation selector, because U+FE0F is a mark and marks are kept for
 * Devanagari's sake. One old block, one new one, an unambiguous bucket, and
 * completely different content. Anything that folds down to marks and spaces
 * alone gets a fresh id instead.
 */
function foldedKey(tag: string, text: string): string | null {
  const words = normalize(text);
  return words && /[\p{L}\p{N}]/u.test(words) ? `f:${tag}:${words}` : null;
}

function bucketBy<T>(items: T[], key: (item: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

interface Candidate {
  tag: string;
  text: string;
  html: string;
}

/**
 * Re-attach previous ids to this run's blocks — the whole reason a
 * re-extraction is survivable, since stage 2 hands us a fresh document from
 * Readability with no ids in it at all
 * (block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters).
 *
 * **Two passes, and the second one refuses to guess.**
 *
 *   pass 1  exact text (or, for a block with none, its src)  → consume the id
 *   pass 2  the folded key, and only where exactly one previous block and
 *           exactly one new block claim it                   → consume the id
 *   else    re-mint
 *
 * Pass one first because it needs no judgement, and because it is what stops
 * two paragraphs trading ids when a re-render merely reorders them. Pass two
 * catches the ordinary drift the fold exists for — a curly apostrophe going
 * straight, an entity decoding differently.
 *
 * The ambiguity rule is the part with design in it. A fold creates equivalence
 * classes the raw text does not have — `Ⅳ` and `IV` both become `iv`, `①` and
 * `1` both become `1` — so a bucket can hold two genuinely different
 * paragraphs, and the old code handed the id to whichever came first. That is
 * not "the id was lost", it is "the reader's note is now attached to a
 * different claim", and block-ids.md is explicit that a lost anchor is the
 * safer failure. So an ambiguous bucket re-mints and says so in `minted`.
 *
 * Runs over the whole document at once rather than block by block, because
 * "is this bucket ambiguous?" cannot be answered until every claimant is known.
 *
 * Returns one entry per candidate: the id it may keep, or undefined to mint.
 */
function carryOverIds(
  previous: Block[] | undefined,
  candidates: Candidate[],
  taken: Set<string>,
): (string | undefined)[] {
  const out: (string | undefined)[] = candidates.map(() => undefined);
  if (!previous?.length) return out;

  const claim = (id: string | undefined): boolean => {
    if (id === undefined || taken.has(id)) return false;
    taken.add(id);
    return true;
  };

  // Pass one. Each previous id is consumed once, so a page with several
  // identical short paragraphs cannot hand the same id to two blocks.
  const byExact = bucketBy(previous, (b) => exactKey(b.tag, b.text, b.html));
  const unmatched: number[] = [];
  candidates.forEach((c, i) => {
    const key = exactKey(c.tag, c.text, c.html);
    const bucket = key === null ? undefined : byExact.get(key);
    let id: string | undefined;
    while (bucket?.length && id === undefined) {
      const next = bucket.shift()!.id;
      if (claim(next)) id = next;
    }
    if (id === undefined) unmatched.push(i);
    else out[i] = id;
  });

  // Pass two, over what is left on both sides.
  const byFolded = bucketBy(
    previous.filter((b) => !taken.has(b.id)),
    (b) => foldedKey(b.tag, b.text),
  );
  const claimants = bucketBy(unmatched, (i) => foldedKey(candidates[i]!.tag, candidates[i]!.text));
  for (const [key, indices] of claimants) {
    const bucket = byFolded.get(key);
    if (indices.length !== 1 || bucket?.length !== 1) continue; // ambiguous → mint
    if (claim(bucket[0]!.id)) out[indices[0]!] = bucket[0]!.id;
  }

  return out;
}

/**
 * Where the author's own anchor names are parked while the sanitiser runs.
 *
 * Stage 3 has to know an element's *old* name to repoint the links that use it,
 * and there is exactly one window in which to read it: after the sanitiser has
 * decided which elements survive, and before ids are handed out. Those are two
 * different documents — `sanitizeInPlace` replaces `innerHTML`, so every node
 * is re-parsed and nothing can be remembered across it by identity.
 *
 * Hence an attribute, which is text and does survive. DOMPurify keeps `data-*`
 * by default, and keeps these in the very cases the `id` itself is deleted
 * (see stampAuthorAnchors).
 *
 * **Two of them, because `id` and `<a name>` are not equal claims.** The HTML
 * spec resolves a fragment by looking at every `id` in the document *first* and
 * only then at named anchors, so a `name` that matches an `id` elsewhere never
 * wins — and one attribute could not tell the two apart. GPT Sol's review,
 * 2026-08-26.
 *
 * **They are scrubbed twice**, and both matter. Every copy the document arrived
 * carrying is removed before we write ours, so an article cannot forge one; and
 * every one of ours is removed the moment it has been read, which is before a
 * single block's html is serialised. Nothing with these attributes on it has
 * ever reached `blocks.json`, and tests/blocks.test.ts pins that.
 */
const WAS_ID = "data-spya-was-id";
const WAS_NAME = "data-spya-was-name";
const STAMPS = `[${WAS_ID}], [${WAS_NAME}]`;

/**
 * Take every stamp off, **including the ones `querySelectorAll` cannot see.**
 *
 * A DOM query does not enter `<template>`: its children live in a separate
 * document fragment, so `doc.querySelectorAll("[data-…]")` walks straight past
 * them while `outerHTML` serialises them in full. A stamp inside a template
 * therefore survived both scrubs and reached `blocks.json` — inert, but the
 * invariant above said it could not happen, and an invariant that is false is
 * worse than one nobody claimed. Found by GPT Sol's review, 2026-08-26.
 */
function scrubStamps(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll(STAMPS))) {
    el.removeAttribute(WAS_ID);
    el.removeAttribute(WAS_NAME);
  }
  for (const t of Array.from(root.querySelectorAll("template"))) {
    scrubStamps((t as HTMLTemplateElement).content);
  }
}

/**
 * Record what each element is called *by the article*, before we rename it.
 *
 * `id` and `<a name>` both, because a named anchor is what a page written
 * before ids were universal uses for the same job, and `href="#note"` cannot
 * tell you which one it is aiming at.
 *
 * Runs **before the sanitiser**, which is the whole point. DOMPurify's
 * `SANITIZE_DOM` deletes any `id` or `name` whose value happens to name a
 * property of `document` or of a form element — `target`, `title`, `name`,
 * `method`, `action`, `links`, `images`, `forms` and a long tail of others. Ids
 * like that are common enough in real headings, and without this pass they are
 * gone before stage 3 has ever seen the element, taking every link to them with
 * them.
 *
 * **The name is also written onto the first child**, and that is not
 * belt-and-braces. The sanitiser deletes elements it does not know while
 * *keeping their contents* — `<x-section id="methods"><h2>Methods</h2>` loses
 * the wrapper and keeps the heading — so a name living only on the wrapper dies
 * with it. Realistic CMS markup, and reproduced by GPT Sol's review,
 * 2026-08-26. When the wrapper survives, both stamps say the same thing and the
 * outer one is read first, so the copy costs nothing and changes no answer.
 *
 * `<html>` and `<body>` are cleared but never stamped. They sit outside the
 * subtree the sanitiser rewrites, so an attribute there crosses it untouched —
 * which is exactly what a forged one would need. Nothing links to `<body>`
 * anyway; `#top` is a fragment the browser handles itself.
 */
function stampAuthorAnchors(doc: Document): void {
  scrubStamps(doc.body);
  for (const root of [doc.documentElement, doc.body]) {
    root?.removeAttribute(WAS_ID);
    root?.removeAttribute(WAS_NAME);
  }
  for (const el of Array.from(doc.body.querySelectorAll("[id], a[name]"))) {
    const id = el.getAttribute("id");
    const name = el.tagName === "A" ? el.getAttribute("name") : null;
    // Ours already: nothing to rename, and nothing to link back to.
    if (id && !isSpideryarnId(id)) stamp(el, WAS_ID, id);
    if (name && !isSpideryarnId(name)) stamp(el, WAS_NAME, name);
  }
}

/** On the element, and on its first child in case the element is unwrapped. */
function stamp(el: Element, attr: string, value: string): void {
  el.setAttribute(attr, value);
  const heir = el.firstElementChild;
  if (heir && !heir.hasAttribute(attr)) heir.setAttribute(attr, value);
}

interface AuthorAnchor {
  el: Element;
  was: string;
  /** `id` beats `name`, always — see WAS_ID. */
  kind: "id" | "name";
}

/** Read the stamps back, in document order, and take them all off again. */
function readAuthorAnchors(doc: Document): AuthorAnchor[] {
  const out: AuthorAnchor[] = [];
  for (const el of Array.from(doc.body.querySelectorAll(STAMPS))) {
    const id = el.getAttribute(WAS_ID);
    const name = el.getAttribute(WAS_NAME);
    if (id) out.push({ el, was: id, kind: "id" });
    if (name) out.push({ el, was: name, kind: "name" });
  }
  scrubStamps(doc.body);
  return out;
}

/**
 * Which block a reader would be looking at if they followed a link to this
 * element — and the order of the four cases is the whole content of it.
 *
 *  1. The element **is** a block. Itself.
 *  2. The element **contains** blocks — `<section id="methods">`, or the nested
 *     `<ul>` inside an `<li>`. Its first one, because that is where the thing
 *     being pointed at begins. This has to be tried before case 3: a nested
 *     list is both inside a block and around one, and the answer the link meant
 *     is the inner one.
 *  3. The element is **inside** a block — a footnote span, an emphasised
 *     phrase. The block containing it, because a block is the finest thing the
 *     reading view can put under your eye.
 *  4. The element is **between** blocks — a standalone `<a name="note"></a>`,
 *     which is what a table's foster-parented anchor also collapses to. The
 *     next block after it, which is where a browser would have landed.
 *
 * Wrappers are the case that most looks like it needs no work and gets it most
 * wrong: their ids survive stage 3 untouched, so the link looks fine, but a
 * wrapper is never in anybody's `block.html` and so is not in the rendered page
 * at all. Cases 2 and 4 both came out of GPT Sol's review, 2026-08-26.
 *
 * Undefined when it resolves to nothing — an element after the last block with
 * nothing inside it — and the link is then left exactly as the author wrote it.
 *
 * `order` is built once for the document rather than walked per anchor. The
 * first version descended each element's subtree with `querySelectorAll("*")`,
 * which is quadratic on nested markup: Sol measured 1.5s on a synthetic page
 * with 750 nested ids, against 188ms for the same page without them.
 */
function blockFor(
  el: Element,
  blockOf: Map<Element, string>,
  blocksInOrder: Element[],
  order: Map<Element, number>,
): string | undefined {
  const own = blockOf.get(el);
  if (own !== undefined) return own;

  const at = order.get(el);
  // Not in the walk at all — nothing sane to say about where it sits.
  if (at === undefined) return undefined;
  const next = blocksInOrder.find((b) => (order.get(b) ?? -1) > at);

  // Case 2 before case 3: the first block after this element is a descendant of
  // it exactly when this element wraps something.
  if (next && el.contains(next)) return blockOf.get(next);
  for (let node = el.parentElement; node; node = node.parentElement) {
    const above = blockOf.get(node);
    if (above !== undefined) return above;
  }
  return next ? blockOf.get(next) : undefined;
}

/**
 * Point the article's own internal links at our ids.
 *
 * A published page links to its own sections — the Anthropic constitution has
 * five, `<a href="#how-we-think-about-corrigibility">` among them — and the
 * target is an `id` the author put on a heading. Stage 3 then gives that
 * heading a spideryarn id and **overwrites the author's**, because a block can
 * only have one id and everything in this project addresses text by ours
 * (docs/project/block-ids.md). The link survives the sanitiser intact and now
 * points at a fragment that exists nowhere in the document, so clicking it puts
 * the fragment in the address bar and moves nothing.
 *
 * Silent in the way this codebase keeps meeting
 * (docs/reusable/silent-success.md): nothing throws, the link still looks like
 * a link, and the article reads fine until someone follows one.
 *
 * So the id is not really destroyed, it is *renamed*, and this renames the
 * references with it. Done here rather than in the client because here is the
 * only place both names are known at once — one stage-3 run later the author's
 * id is gone from the HTML for good.
 *
 * Two things it deliberately does not touch:
 *
 *  - **Links that leave this document.** `href` has to start with `#`. A link
 *    out to `https://example.test/page#section` is a link to somebody else's
 *    page and must stay one. That also means a page that links to *itself* the
 *    long way round — `href="https://this.article/#section"` — is not repaired,
 *    because stage 3 is not told what the article's own address is. No article
 *    we have ingested does that; see docs/plans/internal-anchor-links.md.
 *  - **Fragments no element answers to.** A dead link stays dead rather than
 *    being pointed somewhere plausible.
 *
 * And on a re-run there is simply nothing to do: every href already says
 * `#spya-…`, no stamp is written for an id of ours, and the map comes out
 * empty. Idempotent, like the rest of the stage.
 *
 * The fragment is compared raw *and* percent-decoded, because an id with a
 * space or a non-ASCII letter in it is written encoded in the href and plain in
 * the attribute.
 */
function retargetAnchors(doc: Document, renamed: Map<string, string>): number {
  if (renamed.size === 0) return 0;
  let count = 0;
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href");
    if (!href || href.length < 2 || !href.startsWith("#")) continue;
    const fragment = href.slice(1);
    const target = renamed.get(fragment) ?? renamed.get(decodeFragment(fragment));
    if (target === undefined) continue;
    a.setAttribute("href", `#${target}`);
    count++;
  }
  return count;
}

/** `decodeURIComponent` throws on a lone `%`; a malformed fragment is just text. */
function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

export function splitIntoBlocks(html: string, previous?: Block[]): SplitResult {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  /*
   * Before anything reads this document, and before a single id is minted.
   *
   * This is the only gate between a stranger's HTML and the reading view: the
   * client renders `block.html` with dangerouslySetInnerHTML, and Readability
   * upstream is not a sanitiser and does not claim to be. Doing it here rather
   * than in the client means the stored blocks.json is clean, so every later
   * consumer inherits that instead of having to remember. See src/sanitize.ts
   * for what survives and docs/project/security.md for why.
   *
   * Order matters: sanitising first means ids are stamped onto elements that
   * are staying. Sanitising afterwards would mint ids for elements about to be
   * deleted, and the blocks array would list ids that the HTML no longer has.
   */
  /* Before the sanitiser, because the sanitiser deletes some of what this is
     here to read; and read back straight after, because the sanitiser re-parses
     the document and these are the only nodes that outlive it. See WAS_ID. */
  stampAuthorAnchors(doc);
  sanitizeInPlace(doc.body);
  const authored = readAuthorAnchors(doc);
  /* Document order for every element, once. blockFor needs to ask "what is the
     next block after this?" and asking it by walking subtrees is quadratic. */
  const order = new Map<Element, number>();
  Array.from(doc.body.querySelectorAll("*")).forEach((el, i) => {
    order.set(el, i);
  });

  const elements = collectElements(doc.body);

  // Reserve every id already in the document, ours or the author's, so a minted
  // id can never collide with one.
  const taken = new Set<string>(
    Array.from(doc.querySelectorAll("[id]"), (el) => el.id).filter(Boolean),
  );

  // Prose text, for spotting pull-quotes that merely repeat it.
  const proseText = elements
    .filter((el) => el.tagName === "P" && !el.closest("figure, blockquote"))
    .map((el) => normalize(el.textContent ?? ""));

  let reused = 0;
  let carried = 0;
  let minted = 0;

  /* Content first, ids second. The matcher works over the whole document at
     once — whether a folded bucket is ambiguous cannot be answered until every
     claimant is known — so every candidate has to exist before any id is handed
     out. See carryOverIds. */
  const found = elements.map((el) => {
    const content = ownContent(el);
    return { el, content, text: extractText(content) };
  });

  // Three ways to get an id, in descending order of confidence: it is already
  // in the document; the previous run had a block with these words; or this is
  // genuinely new text.
  /* `taken` is seeded from every id in the document, so it cannot answer "has
     this one been given to a block yet?" — and a document can arrive with the
     same id on two elements, from a hand-edit or a CMS that duplicated a node.
     Both used to be reused, and blocks.json came out with a duplicate key that
     would corrupt everything addressed by it. The second one mints. */
  const assigned = new Set<string>();
  const ids: (string | undefined)[] = found.map(({ el }) => {
    const existing = el.getAttribute("id");
    if (!isSpideryarnId(existing) || assigned.has(existing!)) return undefined;
    reused++;
    taken.add(existing!);
    assigned.add(existing!);
    return existing!;
  });

  const pending = ids.flatMap((id, i) => (id === undefined ? [i] : []));
  const recovered = carryOverIds(
    previous,
    pending.map((i) => ({
      tag: found[i]!.el.tagName.toLowerCase(),
      text: found[i]!.text,
      html: found[i]!.content.outerHTML,
    })),
    taken,
  );
  pending.forEach((i, n) => {
    const id = recovered[n];
    if (id === undefined) minted++;
    else carried++;
    ids[i] = id ?? mintUniqueId(taken);
    found[i]!.el.setAttribute("id", ids[i]!);
  });

  /* After every id is settled and before a single block's html is read: the
     rewrite has to see the final ids, and the html has to see the rewrite. */
  const blockOf = new Map<Element, string>();
  found.forEach(({ el }, i) => {
    blockOf.set(el, ids[i]!);
  });
  const blocksInOrder = found.map(({ el }) => el);
  const renamed = new Map<string, string>();
  /* Every `id` in the document, and only then the named anchors — the order the
     HTML spec resolves a fragment in, so a `name` never beats an `id` that
     matches it. Within each pass, first in document order wins, which is what a
     browser does with a document that uses the same id twice (and CMS output
     does). `authored` is in document order because querySelectorAll is. */
  for (const kind of ["id", "name"] as const) {
    for (const anchor of authored) {
      if (anchor.kind !== kind || renamed.has(anchor.was)) continue;
      const block = blockFor(anchor.el, blockOf, blocksInOrder, order);
      if (block !== undefined) renamed.set(anchor.was, block);
    }
  }
  const retargeted = retargetAnchors(doc, renamed);

  const blocks: Block[] = found.map(({ el, text }, index) => {
    const id = ids[index]!;
    /* Recomputed rather than reused. `ownContent` may have cloned this element
       before it had an id and before its links were repointed, and the stored
       html has to be the document's, not a snapshot of it part-way through.
       Patching the id onto the clone (which is what this used to do) fixed the
       half of that we knew about. */
    const content = ownContent(el);

    const { kind, level, gistable, note } = describeBlock(el, text, proseText);
    return {
      id,
      tag: el.tagName.toLowerCase(),
      kind,
      ...(level !== undefined ? { level } : {}),
      text,
      words: text.length ? text.split(/\s+/).length : 0,
      html: content.outerHTML,
      gistable,
      ...(note ? { note } : {}),
      /* Read from `el`, which is still in the document: the note stamps are
         `data-*`, so neither the sanitiser nor `scrubStamps` (which only takes
         WAS_ID/WAS_NAME off) has touched them. */
      ...noteFieldsFor(el),
    };
  });

  return {
    blocks,
    html: dom.serialize(),
    stats: {
      total: blocks.length,
      reused,
      carried,
      minted,
      retargeted,
      gistable: blocks.filter((b) => b.gistable).length,
    },
  };
}

// ---------------------------------------------------------------- CLI

/**
 * The CLI lives in a function rather than at the top level so this module has
 * no top-level `await`. With one, the module becomes an *async module* and any
 * CommonJS consumer gets ERR_REQUIRE_ASYNC_MODULE on import — which the isMain
 * guard does not prevent, since it is the syntax that matters, not whether the
 * branch runs. ESM importers are unaffected either way; this just keeps
 * splitIntoBlocks importable from anywhere.
 */
export interface BlocksRun extends SplitResult {
  htmlFile: string;
  jsonFile: string;
}

/**
 * The contents of a `blocks.json`, cleaned and then stamped. **Every writer of
 * that file must go through this**, and there are three of them: stage 3 here,
 * stage 4 in src/toc.ts, and the Postgres export in src/store/export.ts.
 *
 * The stamp is what lets the read seam tell an artefact cleaned by the current
 * policy from one cleaned by nothing (`sanitizeStoredBlocks` in
 * src/sanitize.ts, and docs/project/security.md). Two things had to be true for
 * that to work, and the first version of this had neither.
 *
 * **It has to reach the file that is actually read.** Stage 3 stamps
 * `output/<slug>.blocks.json`; the server opens `data/<slug>/blocks.json`, and
 * stage 4 rewrites *that* one from scratch. A plain `{ blocks }` there dropped
 * the stamp, so every article read back as stale — safe, since stale means
 * re-sanitise, but it paid 33ms a load to re-clean files that were already clean
 * and fired the "predates the sanitiser" warning on every article, which is how
 * a warning stops being read.
 *
 * **And it has to be true.** This is why the sanitise is here rather than left
 * to the caller. Stage 3 has genuinely just sanitised its blocks; the other two
 * have not. Stage 4 reads whatever `blocks.json` it was pointed at, and the
 * export reads rows out of Postgres that were imported from some file of unknown
 * age — so a bare stamp at those two call sites would take content that may
 * predate the sanitiser entirely and **certify it as clean**, which is worse
 * than the gap it was written to close. A stamp that can be wrong is not a
 * weaker version of this feature, it is the opposite of it.
 *
 * So the stamp is a fact by construction: nothing can be stamped without having
 * been through the policy on the way. Sanitising is idempotent, so for stage 3
 * this is a no-op, and all three of these are batch stages that make model calls
 * — 33ms for a large article is not a number any of them can notice.
 *
 * A shared helper rather than a rule written down, for the reason
 * docs/project/security.md gives about the slug check: a rule stated in one
 * function is not a rule the codebase follows. The two things that make it one
 * are a helper whose absence is visible at the call site, and a test that fails
 * when it is missing — tests/sanitize-stale-artefact.test.ts has the test.
 */
export function blocksArtefact(blocks: Block[]): { sanitizer: number; blocks: Block[] } {
  return { sanitizer: SANITIZER_VERSION, blocks: sanitizeStoredBlocks(blocks, undefined).blocks };
}

/**
 * Stage 3 over a file on disk: read, split, write both artefacts back.
 *
 * Exported because there are two callers and they must not drift — `main()`
 * below, and the ingest queue running the same stage in the server process
 * (src/pipeline.ts). Everything interesting is still in `splitIntoBlocks`,
 * which is pure; this is the IO around it.
 *
 * **Ids are carried over from the existing blocks.json, not re-minted.** That
 * is the whole reason a re-extraction is survivable — see
 * docs/project/block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters.
 */
export async function runBlocks(opts: {
  htmlFile: string;
  jsonFile?: string;
}): Promise<BlocksRun> {
  const htmlFile = opts.htmlFile;
  const jsonFile = opts.jsonFile ?? `${htmlFile.replace(/\.html$/, "")}.blocks.json`;

  // If a previous run's blocks.json is sitting there, use it to carry ids
  // across a re-extraction that wiped them from the HTML.
  let previous: Block[] | undefined;
  try {
    previous = JSON.parse(await readFile(jsonFile, "utf-8")).blocks as Block[];
  } catch {
    previous = undefined; // first run for this article
  }

  const source = await readFile(htmlFile, "utf-8");
  const result = splitIntoBlocks(source, previous);

  await writeFile(htmlFile, result.html, "utf-8");
  /* `blocksArtefact`, not a bare `{ blocks }` — see its own comment. The stamp
     is what makes a stale artefact visible at all; without it a blocks.json
     written before DOMPurify existed is indistinguishable from one written this
     morning, and "re-run stage 3 to clean them" is advice nothing ever asks
     for. Re-running this stage *is* the migration: it rewrites the file anyway. */
  await writeFile(jsonFile, JSON.stringify(blocksArtefact(result.blocks), null, 2), "utf-8");

  return { ...result, htmlFile, jsonFile };
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: tsx src/blocks.ts <article.html> [blocks.json]");
    process.exit(1);
  }
  const argOut = process.argv[3];
  const { blocks, stats, jsonFile: outJson } = await runBlocks({
    htmlFile: input,
    ...(argOut ? { jsonFile: argOut } : {}),
  });

  const byKind = blocks.reduce<Record<string, number>>((acc, b) => {
    acc[b.kind] = (acc[b.kind] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Blocks:    ${stats.total}  (${JSON.stringify(byKind)})`);
  console.log(
    `Ids:       ${stats.reused} reused, ${stats.carried} carried over, ${stats.minted} minted`,
  );
  console.log(`Links:     ${stats.retargeted} internal links repointed at our ids`);
  console.log(`Gistable:  ${stats.gistable}  (${stats.total - stats.gistable} skipped)`);
  console.log(`\nHTML:      ${path.resolve(input)}`);
  console.log(`Blocks:    ${path.resolve(outJson)}`);
}

/* Compared as resolved paths, not by suffix. `import.meta.url.endsWith(basename)`
   also matches when a *different* entry file with the same basename imports this
   module — `scripts/arc.ts` importing `src/arc.ts` would run the CLI as a side
   effect of the import, which is the one thing this guard exists to prevent. */
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) void main();
