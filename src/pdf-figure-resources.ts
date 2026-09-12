/**
 * **Whether anything a page paints is an image, or paint pdf.js cannot see** —
 * the pure traversal src/pdf-figure-page.ts runs over a page's resources,
 * split out of it (GPT Sol F34,
 * docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md) so the rules can be
 * tested on plain objects rather than on a PDF built for each.
 *
 * The page is described to it as a small lazy tree — `ResourceNode` — whose
 * entries are functions, so the adapter over pdf-lib reads a dictionary only
 * when the walk reaches it. That keeps the walk's order and its early exits
 * exactly what they were before the split: the first doubt answers, and
 * nothing after it is read.
 *
 * **Every doubt is a yes.** An entry the adapter could not classify, a content
 * stream it could not read to the end, a nesting past `MAX_RESOURCE_DEPTH`:
 * none of them proves the page has no image.
 */

/**
 * How deep the walk follows Form XObjects, tiling patterns, Type 3 fonts and
 * soft masks inside one another. A real figure nests two or three deep; past
 * this, the answer is "an image may be in there", because the walk could not
 * prove otherwise.
 */
export const MAX_RESOURCE_DEPTH = 8;

/**
 * The inline-image operator as a token: `BI` between PDF whitespace or
 * delimiters. PDF whitespace includes NUL, which JavaScript's `\s` does not;
 * omitting it lets a valid NUL-delimited inline image pass this refusal. Loose
 * on purpose — a string that happens to spell ` BI ` is a refused page, never
 * a missed image.
 */
const PDF_TOKEN_BOUNDARY = String.raw`[\x00\x09\x0a\x0c\x0d\x20()[\]{}<>/%]`;
const INLINE_IMAGE = new RegExp(`(?:^|${PDF_TOKEN_BOUNDARY})BI(?=${PDF_TOKEN_BOUNDARY})`);

/** A content stream's decoded bytes, or `null` when it could not be read to the end. */
export type Content = () => Uint8Array | null;

/** What an `/XObject` entry is. `unclassified` is a doubt. */
export type XObjectEntry =
  | { kind: "image" }
  | { kind: "unclassified" }
  | { kind: "form"; content: Content; resources: () => ResourceNode | undefined };

/**
 * Something with a content stream of its own — a tiling pattern, a soft mask's
 * group. `none` is a graphics state with no soft mask; `unreadable` is a doubt.
 */
export type PaintedEntry =
  | { kind: "none" }
  | { kind: "unreadable" }
  | { kind: "painted"; content: Content; resources: () => ResourceNode | undefined };

/** What a `/Font` entry is. Only a Type 3 font paints with content streams of its own. */
export type FontEntry =
  | { kind: "unclassified" }
  | { kind: "other" }
  | { kind: "type3"; glyphs: () => readonly Content[]; resources: () => ResourceNode | undefined };

/** One `/Resources` dictionary, read lazily, entry by entry. */
export interface ResourceNode {
  /** Identity for the walk's `seen` set — the same dictionary reached twice is walked once. */
  readonly id: unknown;
  xobjects(): readonly (() => XObjectEntry)[];
  patterns(): readonly (() => PaintedEntry)[];
  fonts(): readonly (() => FontEntry)[];
  /** One per `/ExtGState` entry that has a soft mask; `null` for a state that is not a dictionary. */
  softMasks(): readonly (() => PaintedEntry)[];
}

/** A page: its own content, as one byte sequence, and its resources. */
export interface PageTree {
  contents: Content;
  resources: () => ResourceNode | undefined;
}

export interface PageInspection {
  /** An image, XObject or inline, anywhere the page reaches — or a doubt. */
  imageInResources: boolean;
  /** Reachable paint (a Type 3 glyph program) that pdf.js's path list does not show. */
  unmeasuredPaint: boolean;
}

/** Does this content contain an inline image? Unreadable is a yes. */
export function hasInlineImage(bytes: Uint8Array | null): boolean {
  if (!bytes) return true;
  return INLINE_IMAGE.test(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1"));
}

/**
 * The page's own content first, then its resources: XObjects, tiling
 * patterns, fonts, soft masks, each depth-first. The first doubt answers.
 */
export function inspectPageTree(page: PageTree): PageInspection {
  const walk: Walk = { seen: new Set(), unmeasuredPaint: false };
  const imageInResources = hasInlineImage(page.contents()) || walkResources(page.resources(), 0, walk);
  return { imageInResources, unmeasuredPaint: walk.unmeasuredPaint };
}

interface Walk {
  seen: Set<unknown>;
  unmeasuredPaint: boolean;
}

function walkResources(node: ResourceNode | undefined, depth: number, walk: Walk): boolean {
  if (!node) return false;
  if (depth > MAX_RESOURCE_DEPTH) return true;
  if (walk.seen.has(node.id)) return false;
  walk.seen.add(node.id);
  return (
    node.xobjects().some((entry) => xobjectPaintsImage(entry(), depth, walk)) ||
    node.patterns().some((entry) => paintedEntryPaintsImage(entry(), depth, walk)) ||
    node.fonts().some((entry) => fontPaintsImage(entry(), depth, walk)) ||
    node.softMasks().some((entry) => paintedEntryPaintsImage(entry(), depth, walk))
  );
}

/** An image, an XObject we cannot classify, or a form whose content or resources reach one. */
function xobjectPaintsImage(entry: XObjectEntry, depth: number, walk: Walk): boolean {
  if (entry.kind !== "form") return true;
  return hasInlineImage(entry.content()) || walkResources(entry.resources(), depth + 1, walk);
}

function paintedEntryPaintsImage(entry: PaintedEntry, depth: number, walk: Walk): boolean {
  if (entry.kind === "none") return false;
  if (entry.kind === "unreadable") return true;
  return hasInlineImage(entry.content()) || walkResources(entry.resources(), depth + 1, walk);
}

/**
 * A Type 3 font marks the page unmeasured before anything else is asked of it:
 * pdf.js renders a Type 3 CharProc internally but does not put its vector
 * paths in the page's operator list, so PDFium would draw ink the ownership and
 * complexity rules never measured. Then its glyphs and resources are walked
 * for images like any other content.
 */
function fontPaintsImage(entry: FontEntry, depth: number, walk: Walk): boolean {
  if (entry.kind === "unclassified") return true;
  if (entry.kind === "other") return false;
  walk.unmeasuredPaint = true;
  if (entry.glyphs().some((glyph) => hasInlineImage(glyph()))) return true;
  return walkResources(entry.resources(), depth + 1, walk);
}
