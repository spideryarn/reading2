/**
 * **Stage 2 for an article that arrived as several pages** — `readArticle` once
 * per page, and the pages joined into the one article stage 3 cuts.
 *
 * docs/plans/261024p-a-multi-page-article-imports-from-its-first-page.md §
 * *Stage 2: extracting each part* is the design, and GPT Sol's review of it
 * (docs/plans/261024p-plan-review-sol.md, F3–F5) is why it looks like this
 * rather than like the first draft. In order:
 *
 * 1. **Each page is read on its own, with its own address as the base.** Gluing
 *    the pages into one document and letting Readability choose keeps one
 *    chapter, measured. Page 1 gives all the metadata and every refusal that
 *    matters; a later page Readability declines, or that is a bot check, is
 *    dropped and logged (counts only), not fatal.
 * 2. **No heading of ours** (F3). A heading we wrote would be an ordinary
 *    author heading by stage 3, in Structure and in the reading view, with
 *    nothing to say it is ours. The one heading put back is the page's *own*
 *    main `<h1>`, which Readability drops when it matches the title it chose;
 *    it goes back as an `<h2>` — Readability's own level for every `<h1>` it
 *    keeps — in the author's words, and only when the page's content does not
 *    already open with it.
 * 3. **Every later page's anchors are namespaced** through `namespaceAnchors`,
 *    references rewritten whether or not the page defines the target, so a
 *    dead link stays dead instead of landing in page 1. Note ids and callout
 *    context ids are the exception: their shapes are patterns stage 3 checks
 *    (`NOTE_ID_PATTERN`, `CONTEXT_ID_PATTERN`), so a colliding one takes the
 *    next free counter instead of a prefix.
 * 4. **One notes region, moved whole** (F4). Every page's notes, with the
 *    authored heading that introduces them, go to the end under one heading;
 *    with one container per page, `splitBlocks` (src/supplement.ts) calls the
 *    notes stranded and drops the Notes node for the whole article.
 * 5. **No deduplication** (F5). Repeated furniture is the lesser harm.
 * 6. **The floor is applied to the joined text**, so a short landing page
 *    followed by its chapters is not "too little to read".
 *
 * **The return type is `readArticle`'s, exactly**, so `runExtract` switches by
 * one line — and with no parts this returns `readArticle`'s own object.
 *
 * What it does not do, and the integrator should know: a link from one page to
 * another page of the same article by its full address
 * (`https://site/chapter-2#sec`) stays a link out — Readability has already
 * made it absolute and nothing here knows the pages' addresses as anchors.
 */

import { CONTAINER_ATTR, NOTE_ID_PATTERN, NOTE_ATTR, REF_ATTR, BACK_ATTR, type NoteStats } from "./notes.js";
import { CONTEXT_ATTRS, CONTEXT_ID_PATTERN } from "./reserved.js";
import { ChallengePage } from "./challenge-page.js";
import { capabilityFloor, readArticle } from "./extract.js";
import { openingRecordElement } from "./front-matter-authors.js";
import { jsdom } from "./jsdom-lazy.js";
import { log as logFor, type Log } from "./log.js";
import type { CalloutStats } from "./callouts.js";

/** What `readArticle` returns, and therefore what this returns. */
export type ReadArticleResult = ReturnType<typeof readArticle>;

/** One fetched page: its decoded HTML and the address it was read from. */
export interface PageSource {
  html: string;
  /** The base relative links resolve against. `null` only for a page-1 upload. */
  url: string | null;
}

/**
 * Read page 1 and every later part, and join them.
 *
 * `parts` are the pages after page 1, in reading order. Empty, and the answer
 * is `readArticle(page1.html, page1.url)` itself.
 */
export function readParts(
  page1: PageSource,
  parts: readonly PageSource[],
  opts: { log?: Log } = {},
): ReadArticleResult {
  const first = readArticle(page1.html, page1.url);
  if (parts.length === 0) return first;
  /* Page 1 refuses as it always has: a bot check, or no article at all.
     Page 1's *floor* is not final — that is point 6, below. */
  if (first.refusal instanceof ChallengePage || !first.article) return first;

  const later: { page: number; read: ReadArticleResult; article: NonNullable<ReadArticleResult["article"]> }[] = [];
  let challenges = 0;
  let declined = 0;
  parts.forEach((part, i) => {
    const read = readArticle(part.html, part.url);
    if (read.refusal instanceof ChallengePage) challenges++;
    else if (!read.article) declined++;
    else later.push({ page: i + 2, read, article: read.article });
  });
  if (challenges + declined > 0) {
    /* Counts only: never a page's prose, and not its address either, which can
       carry a query string somebody would not want in a log. */
    (opts.log ?? logFor("pipeline")).warn(
      { pages: parts.length + 1, read: later.length + 1, challenges, declined },
      "multi-page: later pages dropped",
    );
  }

  const content = joinContents(
    first.article.content ?? "",
    later.map(({ page, read, article }) => ({
      page,
      content: article.content ?? "",
      heading: ownHeading(read),
    })),
  );
  const article = { ...first.article, content: content.html, textContent: content.text, length: content.text.length };
  const all = [first, ...later.map((l) => l.read)];
  return {
    ...first,
    article,
    refusal: capabilityFloor(article),
    notes: sumNotes(all.map((r) => r.notes)),
    callouts: sumCallouts(all.map((r) => r.callouts)),
    removed: sumCounts(all.map((r) => r.removed)),
    kept: sumCounts(all.map((r) => r.kept)),
  };
}

/**
 * **The page's own main heading, as text**, or null.
 *
 * Read off `opening` rather than by parsing the page a further time:
 * `pageOpening` already starts at the page's main `<h1>` (`article h1, main
 * h1`, else the first `h1` — src/front-matter-authors.ts § `openingBounds`),
 * leaves out what the page hid from its reader, and has scrubbed our reserved
 * attributes along with the rest of `readArticle`. The first record is the
 * heading only when the walk began at one and that record's element is the
 * `<h1>` — checked, rather than assumed, so a heading whose own text was hidden
 * cannot hand us the paragraph after it.
 */
function ownHeading(read: ReadArticleResult): string | null {
  if (!read.openingHeaded) return null;
  const record = read.opening[0];
  if (!record || openingRecordElement(record) !== "H1") return null;
  const text = squash(record.text);
  return text === "" ? null : text;
}

const squash = (text: string): string => text.replace(/\s+/gu, " ").trim();

/** What counts as something on the page even with no words: an `<hr>` does not. */
const MEDIA = "img, picture, video, audio, iframe, svg, canvas, math, object, embed";
const HEADING = /^H[1-6]$/;

function hasSubstance(node: Element): boolean {
  return /\S/u.test(node.textContent ?? "") || node.matches(MEDIA) || node.querySelector(MEDIA) !== null;
}

/**
 * Join the pages' Readability output into one fragment.
 *
 * One JSDOM for the lot, with a silent `VirtualConsole` for the reason
 * `sourceDom` in src/extract.ts gives; no address, because this parses
 * Readability's *output*, whose links are already absolute or in-page.
 */
function joinContents(
  firstContent: string,
  later: readonly { page: number; content: string; heading: string | null }[],
): { html: string; text: string } {
  const { JSDOM, VirtualConsole } = jsdom();
  const doc = new JSDOM("<!doctype html><html><body></body></html>", { virtualConsole: new VirtualConsole() }).window
    .document;

  const parse = (html: string): DocumentFragment => {
    const t = doc.createElement("template");
    t.innerHTML = html;
    return t.content;
  };

  const first = parse(firstContent);
  const taken = { notes: noteIdsIn(first), contexts: contextIdsIn(first), anchors: anchorNamesIn(first) };
  const pages: DocumentFragment[] = [first];
  for (const part of later) {
    const fragment = parse(part.content);
    namespaceAnchors(fragment, `p${part.page}-`, taken);
    if (part.heading) restoreHeading(doc, fragment, part.heading);
    pages.push(fragment);
  }

  /* After namespacing, so every note id already says which note it is. */
  const notes = pages.map(takeNotesRegion);
  for (const fragment of pages) doc.body.appendChild(fragment);

  const items = notes.flatMap((n) => n.items);
  if (items.length > 0) {
    const heading = notes.find((n) => n.heading)?.heading;
    if (heading) doc.body.appendChild(heading);
    const section = doc.createElement("section");
    section.setAttribute(CONTAINER_ATTR, "");
    const list = doc.createElement("ol");
    section.appendChild(list);
    for (const item of items) list.appendChild(item);
    doc.body.appendChild(section);
  }
  return { html: doc.body.innerHTML, text: doc.body.textContent ?? "" };
}

/**
 * Put the page's own `<h1>` back as an `<h2>`, unless the content already
 * opens with its words. Text only — `textContent`, never markup — so nothing
 * the page wrote is carried across as HTML.
 */
function restoreHeading(doc: Document, fragment: DocumentFragment, heading: string): void {
  const opens = squash(fragment.textContent ?? "").toLowerCase();
  if (opens.startsWith(heading.toLowerCase())) return;
  const h2 = doc.createElement("h2");
  h2.textContent = heading;
  /* Inside Readability's page wrapper when there is one, so the heading sits
     with the content it introduces rather than as a stray sibling. */
  const host = fragment.firstElementChild ?? fragment;
  host.insertBefore(h2, host.firstChild);
}

// ───────────────────────────────────────────────────────────── anchors

/** Attributes whose value is a list of ids, whitespace-separated. */
const ID_LIST_ATTRS = [
  "aria-labelledby",
  "aria-describedby",
  "aria-controls",
  "aria-owns",
  "aria-flowto",
  "aria-details",
  "aria-errormessage",
  "aria-activedescendant",
  "for",
  "headers",
  "form",
  "list",
  "itemref",
];
/** Attributes whose value is a reference when it starts with `#`. */
const FRAGMENT_ATTRS = ["href", "xlink:href", "usemap"];
/** `url(#x)`, `url('#x')`, `url("#x")` — in `style`, `fill`, `clip-path`, `mask`, `filter`… */
const URL_REF = /url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/gu;

const NOTE_BASE = /^(spya-note-[0-9a-f]{10})(?:-[0-9]+)?$/;
const CONTEXT_BASE = /^(c-[0-9a-f]{10})(?:-[0-9]+)?$/;

/** `base`, `base-2`, `base-3`… — the first nobody has. */
function nextFree(value: string, shape: RegExp, taken: ReadonlySet<string>): string {
  const base = shape.exec(value)?.[1] ?? value;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * The note ids `canonicaliseNotes` minted on this page: the `id` of an element
 * carrying our note stamp with the same value, in the stamp's shape. An author
 * id that merely *looks* like one is an ordinary anchor and is prefixed.
 */
function noteIdsIn(root: ParentNode): Set<string> {
  const out = new Set<string>();
  for (const el of Array.from(root.querySelectorAll(`[id][${NOTE_ATTR}]`))) {
    const id = el.getAttribute("id") ?? "";
    if (NOTE_ID_PATTERN.test(id) && el.getAttribute(NOTE_ATTR) === id) out.add(id);
  }
  return out;
}

function contextIdsIn(root: ParentNode): Set<string> {
  const out = new Set<string>();
  for (const { attr } of CONTEXT_ATTRS) {
    for (const el of Array.from(root.querySelectorAll(`[${attr}]`))) out.add(el.getAttribute(attr) ?? "");
  }
  return out;
}

function anchorNamesIn(root: ParentNode): Set<string> {
  const out = new Set<string>();
  for (const el of Array.from(root.querySelectorAll("[id], a[name], map[name]"))) {
    const id = el.getAttribute("id");
    if (id) out.add(id);
    if (el.tagName === "A" || el.tagName === "MAP") {
      const name = el.getAttribute("name");
      if (name) out.add(name);
    }
  }
  return out;
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/**
 * **Give one page's anchors names no other page uses** — the one helper, so
 * there is no second copy of the rule to drift.
 *
 * Every `id`, `a[name]` and `map[name]` takes `prefix`, and every same-document
 * reference — `href`/`xlink:href`/`usemap` starting `#`, the id-list attributes
 * (`aria-*`, `for`, `headers`…), `url(#…)` in any attribute — is rewritten
 * through the same map. **A reference the page does not define is prefixed
 * too**, so a dead link stays dead rather than landing on page 1's anchor of
 * the same name (gradual-disempowerment: three footnote links did).
 *
 * **Except a note id.** `NOTE_ID_PATTERN` is what stage 3 will carry into a
 * block, and `p2-spya-note-…` fails it, which would silently cost the note its
 * identity. So a note id keeps its shape and, only where an earlier page has
 * taken it (two notes reading "Ibid."), the next free counter — in `id`, in
 * the three note stamps and in every reference. Callout context ids
 * (`data-spya-callout`, `mintContextId`) the same, for `CONTEXT_ID_PATTERN`.
 *
 * `taken` holds what earlier pages use and is extended with this page's.
 * Exported for the tests.
 */
export function namespaceAnchors(
  root: ParentNode,
  prefix: string,
  taken: { notes: Set<string>; contexts: Set<string>; anchors: Set<string> },
): void {
  const elements = Array.from(root.querySelectorAll("*"));

  /* This page's own note ids, so a suffix never lands on one of them. */
  const own = noteIdsIn(root);
  const reserved = new Set(taken.anchors);
  const renamed = new Map<string, string>();
  const ordinary = (value: string): string => {
    if (!reserved.has(value)) return value;
    for (let n = 2; ; n++) if (!reserved.has(`${value}-${n}`)) return `${value}-${n}`;
  };
  const rename = (name: string): void => {
    if (renamed.has(name)) return;
    if (own.has(name)) {
      const to = nextFree(name, NOTE_BASE, reserved);
      reserved.add(to);
      renamed.set(name, to);
    } else {
      const to = ordinary(prefix + name);
      reserved.add(to);
      renamed.set(name, to);
    }
  };
  for (const el of elements) {
    const id = el.getAttribute("id");
    if (id) rename(id);
    if ((el.tagName === "A" || el.tagName === "MAP") && el.getAttribute("name")) rename(el.getAttribute("name")!);
  }
  const ref = (fragment: string): string => {
    const decoded = decodeFragment(fragment);
    const found = renamed.get(fragment) ?? renamed.get(decoded);
    if (found !== undefined) return found;
    const to = ordinary(prefix + fragment);
    reserved.add(to);
    renamed.set(fragment, to);
    return to;
  };

  const noteStamps = [NOTE_ATTR, REF_ATTR, BACK_ATTR];
  for (const el of elements) {
    const id = el.getAttribute("id");
    if (id) el.setAttribute("id", renamed.get(id)!);
    if (el.tagName === "A" || el.tagName === "MAP") {
      const name = el.getAttribute("name");
      if (name) el.setAttribute("name", renamed.get(name)!);
    }
    for (const attr of FRAGMENT_ATTRS) {
      const value = el.getAttribute(attr);
      if (value && value.length > 1 && value.startsWith("#")) el.setAttribute(attr, `#${ref(value.slice(1))}`);
    }
    for (const attr of ID_LIST_ATTRS) {
      const value = el.getAttribute(attr);
      if (value && /\S/u.test(value)) el.setAttribute(attr, value.trim().split(/\s+/u).map(ref).join(" "));
    }
    for (const attr of Array.from(el.attributes)) {
      if (!attr.value.includes("url(")) continue;
      const next = attr.value.replace(URL_REF, (_m, quote: string, frag: string) => `url(${quote}#${ref(frag)}${quote})`);
      if (next !== attr.value) el.setAttribute(attr.name, next);
    }
    for (const attr of noteStamps) {
      const value = el.getAttribute(attr);
      const to = value ? renamed.get(value) : undefined;
      if (to !== undefined && to !== value) el.setAttribute(attr, to);
    }
  }
  for (const name of own) taken.notes.add(renamed.get(name) ?? name);
  for (const name of reserved) taken.anchors.add(name);

  /* Callout context ids: a value, not an anchor, so nothing links to them —
     only renamed where an earlier page has the same one. */
  const contexts = contextIdsIn(root);
  const reservedContexts = new Set([...taken.contexts, ...contexts]);
  const contextRenamed = new Map<string, string>();
  for (const value of contexts) {
    if (!taken.contexts.has(value) || !CONTEXT_ID_PATTERN.test(value)) continue;
    const to = nextFree(value, CONTEXT_BASE, reservedContexts);
    reservedContexts.add(to);
    contextRenamed.set(value, to);
  }
  for (const { attr } of CONTEXT_ATTRS) {
    for (const el of Array.from(root.querySelectorAll(`[${attr}]`))) {
      const to = contextRenamed.get(el.getAttribute(attr) ?? "");
      if (to !== undefined) el.setAttribute(attr, to);
    }
  }
  for (const value of contexts) taken.contexts.add(contextRenamed.get(value) ?? value);
}

// ───────────────────────────────────────────────────────────── notes

/**
 * **Take one page's notes out, with the heading that introduces them** — what
 * the joined article puts at its end as one region.
 *
 * The items are every child of the `<ol>` in `section[data-spya-notes]`
 * (src/notes.ts writes exactly one such container per page). The heading is
 * the authored one standing *immediately* before the container — nothing with
 * words between, an `<hr>` or an empty wrapper allowed — which is the shape
 * `canonicaliseNotes` leaves a pandoc `<section class="footnotes"><h2>Notes</h2>`
 * in. Whatever is left empty by the move goes too, so no husk becomes a block.
 */
function takeNotesRegion(fragment: DocumentFragment): { items: Node[]; heading: Element | null } {
  const container = fragment.querySelector(`section[${CONTAINER_ATTR}]`);
  if (!container) return { items: [], heading: null };
  const heading = introducingHeading(container);
  const items: Node[] = [];
  for (const list of Array.from(container.children).filter((c) => c.tagName === "OL")) {
    items.push(...Array.from(list.childNodes).filter((n) => n.nodeType === 1));
    list.remove();
  }
  if (heading) {
    const parent = heading.parentElement;
    heading.remove();
    pruneEmpty(parent);
  }
  if (!hasSubstance(container)) {
    const parent = container.parentElement;
    container.remove();
    pruneEmpty(parent);
  }
  return { items, heading };
}

/** The heading right before `el` in document order, with nothing worded between. */
function introducingHeading(el: Element): Element | null {
  let node: Element = el;
  for (;;) {
    let prev = node.previousElementSibling;
    while (!prev) {
      const parent = node.parentElement;
      if (!parent) return null;
      /* Words directly in the parent before this element are words between. */
      if (wordsBefore(node)) return null;
      node = parent;
      prev = node.previousElementSibling;
    }
    if (wordsBefore(node)) return null;
    if (!hasSubstance(prev)) {
      node = prev;
      continue;
    }
    return lastHeadingIn(prev);
  }
}

/** Non-blank text nodes between `el` and its previous element sibling. */
function wordsBefore(el: Element): boolean {
  for (let n = el.previousSibling; n && n.nodeType !== 1; n = n.previousSibling) {
    if (n.nodeType === 3 && /\S/u.test(n.nodeValue ?? "")) return true;
  }
  return false;
}

/** `el` if it is a heading, or the heading its last worded content sits in. */
function lastHeadingIn(el: Element): Element | null {
  let cur: Element = el;
  for (;;) {
    if (HEADING.test(cur.tagName)) return cur;
    const children = Array.from(cur.children);
    const last = [...children].reverse().find(hasSubstance);
    if (!last) return null;
    /* Words after the last worded child are the last thing, and not in a heading. */
    for (let n = last.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === 3 && /\S/u.test(n.nodeValue ?? "")) return null;
    }
    cur = last;
  }
}

function pruneEmpty(node: Element | null): void {
  while (node && !hasSubstance(node)) {
    const parent = node.parentElement;
    node.remove();
    node = parent;
  }
}

// ───────────────────────────────────────────────────────────── stats

/** Per-key sums of flat count records — `removed` and `kept`. */
function sumCounts(records: readonly Readonly<Record<string, number>>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) for (const [k, v] of Object.entries(r)) out[k] = (out[k] ?? 0) + v;
  return out;
}

function sumNotes(all: readonly NoteStats[]): NoteStats {
  const [head, ...rest] = all;
  const out: NoteStats = { ...head!, shapes: { ...head!.shapes } };
  for (const s of rest) {
    out.notes += s.notes;
    out.markers += s.markers;
    out.backlinks += s.backlinks;
    out.synthesised += s.synthesised;
    for (const k of Object.keys(out.shapes) as (keyof NoteStats["shapes"])[]) out.shapes[k] += s.shapes[k];
  }
  return out;
}

function sumCallouts(all: readonly CalloutStats[]): CalloutStats {
  const [head, ...rest] = all;
  const out: CalloutStats = { ...head!, shapes: { ...head!.shapes } };
  for (const s of rest) {
    out.containers += s.containers;
    out.stamped += s.stamped;
    out.skipped += s.skipped;
    for (const k of Object.keys(out.shapes) as (keyof CalloutStats["shapes"])[]) out.shapes[k] += s.shapes[k];
  }
  return out;
}
