/**
 * **The article's own words, drawn outside the prose as the prose draws them**
 * — maths as maths, italics as italics — from the block's own markup.
 *
 * > I saw a quote in skim mode that referred to some LaTeX formulae that was
 * > just showing the unrendered LaTeX. It should be obviously showing the
 * > rendered LaTeX. … Perhaps do this with some kind of reusable excerpt
 * > machinery?
 * >
 * > — Greg, 2026-10-09 (spya-pqae7m)
 *
 * A quote, an idea's passage, a citing sentence: each is stored as plain
 * `block.text`, which is where the model found it, and `block.text` holds a
 * formula as its TeX source and has lost every `<em>`. Drawn as a string, an
 * excerpt therefore showed `\(d_k\)` where the paragraph above it showed
 * *d*<sub>k</sub>. docs/plans/261009k-excerpts-keep-maths-and-formatting.md.
 *
 * ## How
 *
 *  1. **Find the words in the block's markup as it was before any maths was
 *     drawn** — `mathsSource` (maths-provenance.ts), or `block.html` for a
 *     block with none. Those are the words the excerpt was taken from, TeX and
 *     all, so the same forgiving finder the prose marks use
 *     (src/quote-match.ts § `findQuote`) places it.
 *  2. **Widen the range to whole formulas.** A cut that lands inside `\(…\)`
 *     takes the whole formula rather than half its source.
 *  3. **Clone the range and keep only inline formatting** (`KEEP`), with no
 *     attribute on anything. A link becomes its words: an excerpt usually sits
 *     inside a button that goes to the passage, and a link inside a button is
 *     neither valid nor clickable. Pictures, diagrams and scripts go.
 *  4. **Draw its maths with the renderer that drew the block's**, then put the
 *     result through the article policy once more — the same doorway the prose
 *     uses (maths.ts § Why the output goes through the sanitiser again).
 *
 * Nothing here can mint an id: `KEEP` elements are created bare, and every
 * `<math>` kept is one the policy already accepted, whose addressing
 * attributes maths.ts refused (docs/project/block-ids.md).
 *
 * `null` when the words are not in the block — the caller draws the string, as
 * before, with its maths drawn if this block's renderer is to hand
 * (`excerptFallbackHtml`).
 */

import { findMathSpans, MATHS_SKIP_TAGS } from "../maths-tex.js";
import { findQuote } from "../quote-match.js";
import type { Block } from "../types.js";
import { renderBlockMaths } from "./maths.js";
import { mathsSource } from "./maths-provenance.js";
import { sanitizeBlockHtml } from "./sanitize.js";

/** Inline formatting an excerpt keeps, recreated without attributes. */
const KEEP = new Set([
  "em", "i", "strong", "b", "sub", "sup", "code", "kbd", "samp", "var",
  "s", "del", "ins", "u", "small", "q", "cite", "abbr", "dfn",
]);

/** Gone, contents and all: nothing in them is words an excerpt can show. */
const DROP = new Set([
  "img", "svg", "picture", "video", "audio", "iframe", "object", "embed",
  "script", "style", "template", "noscript", "canvas", "hr", "button", "input",
  "select", "textarea",
]);

/**
 * Where a nested block starts inside a block — a space, as `extractText`
 * (src/blocks.ts) inserts one, so two paragraphs of a blockquote do not run
 * together.
 */
const BOUNDARY = new Set([
  "p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
  "figcaption", "td", "th", "tr", "dt", "dd",
]);

const MATHML = "http://www.w3.org/1998/Math/MathML";
const SKIP = MATHS_SKIP_TAGS.join(", ");

/** An inert document: nothing in a block's html loads while it is parsed here. */
let inert: Document | null = null;
function inertDoc(): Document {
  if (!inert) inert = document.implementation.createHTMLDocument("");
  return inert;
}

/**
 * **`words` from `block`, as html** — or `null` when they are not in it.
 *
 * `words` is what the caller would otherwise have drawn as a string: a whole
 * quote, or the front of one it has cut (and will put its own `…` after).
 */
export function excerptHtml(block: Block, words: string): string | null {
  const source = mathsSource(block);
  /* Twice for a block that had maths drawn: first in the words the model saw,
     TeX and all, which is where a stored quote came from; then in the block
     as drawn, which is where a reader's selection and a snippet cut from the
     rendered text came from — their formulas are already symbols. */
  const fromSource = source ? cutFrom(source.html, words) : null;
  if (source && fromSource !== null) return finish(renderBlockMaths(fromSource, source.render));
  const asDrawn = cutFrom(block.html, words);
  return asDrawn === null ? null : finish(asDrawn);
}

/**
 * **The last step for every excerpt**: a displayed formula drawn in the line,
 * so a row stays a row, and the whole put back through the article policy.
 * Inline is MathML's own `display`, not CSS — `display: inline` on a `<math>`
 * takes it out of MathML layout (docs/project/maths.md § Where it sits).
 */
function finish(html: string): string {
  const holder = inertDoc().createElement("div");
  holder.innerHTML = html;
  for (const math of holder.querySelectorAll("math")) {
    math.removeAttribute("display");
    math.classList.remove("tml-display");
    if (math.getAttribute("class") === "") math.removeAttribute("class");
  }
  return sanitizeBlockHtml(holder.innerHTML);
}

/** `words` cut out of `html` with only inline formatting left, or `null` when they are not in it. */
function cutFrom(html: string, words: string): string | null {
  const doc = inertDoc();
  const root = doc.createElement("div");
  root.innerHTML = html;

  const nodes = textNodes(root);
  const text = nodes.map((n) => n.data).join("");
  /* No `near`: the first occurrence is the one meant, for the reason
     search-hits.ts § `resolveQuotes` gives, and no caller has an offset in
     this string's space. */
  const span = findQuote(text, words);
  if (span === null) return null;

  const range = doc.createRange();
  const start = locate(nodes, span.start, "start");
  const end = locate(nodes, span.end, "end");
  if (!start || !end) return null;
  setBoundary(range, start.node, widen(start.node, start.offset, "start"), "start");
  setBoundary(range, end.node, widen(end.node, end.offset, "end"), "end");
  if (range.collapsed) return null;

  const out = doc.createElement("div");
  out.append(keepInline(range.cloneContents(), doc));
  return out.innerHTML.trim();
}

/**
 * **A string the block could not place**, drawn with its maths if the block's
 * renderer is to hand — otherwise `null`, and the caller draws it as text.
 */
export function excerptFallbackHtml(block: Block | undefined, words: string): string | null {
  const source = block ? mathsSource(block) : null;
  if (!source) return null;
  const holder = inertDoc().createElement("div");
  holder.textContent = words;
  const escaped = holder.innerHTML;
  const drawn = renderBlockMaths(escaped, source.render);
  return drawn === escaped ? null : finish(drawn);
}

function textNodes(root: Element): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/**
 * The text node and offset for a character offset into the joined text. A
 * start prefers the node the character is in; an end, the node it closes.
 */
function locate(
  nodes: readonly Text[],
  at: number,
  side: "start" | "end",
): { node: Text; offset: number } | null {
  let from = 0;
  for (const node of nodes) {
    const to = from + node.data.length;
    if (side === "start" ? at < to : at <= to) return { node, offset: at - from };
    from = to;
  }
  return null;
}

/** An offset moved out of any formula it falls inside, to that formula's edge. */
function widen(node: Text, offset: number, side: "start" | "end"): number {
  if (node.parentElement?.closest(SKIP)) return offset;
  for (const span of findMathSpans(node.data)) {
    if (span.start < offset && offset < span.end) return side === "start" ? span.start : span.end;
  }
  return offset;
}

/**
 * Set one end of the range — outside any `<math>` the offset is inside, so a
 * formula the article carried as MathML is never cut in half either.
 */
function setBoundary(range: Range, node: Text, offset: number, side: "start" | "end"): void {
  const math = node.parentElement?.closest("math");
  if (math) {
    if (side === "start") range.setStartBefore(math);
    else range.setEndAfter(math);
    return;
  }
  if (side === "start") range.setStart(node, offset);
  else range.setEnd(node, offset);
}

/** The fragment with only `KEEP` elements and `<math>` left, every other element unwrapped or dropped. */
function keepInline(from: Node, doc: Document): DocumentFragment {
  const out = doc.createDocumentFragment();
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.append(doc.createTextNode(child.nodeValue ?? ""));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    if (el.localName === "math" && el.namespaceURI === MATHML) {
      out.append(el.cloneNode(true));
      continue;
    }
    if (el.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
    const tag = el.localName;
    if (DROP.has(tag)) continue;
    if (tag === "br") {
      out.append(doc.createTextNode(" "));
      continue;
    }
    if (BOUNDARY.has(tag) && out.childNodes.length > 0) out.append(doc.createTextNode(" "));
    const inner = keepInline(el, doc);
    if (KEEP.has(tag)) {
      const bare = doc.createElement(tag);
      bare.append(inner);
      out.append(bare);
    } else {
      out.append(inner);
    }
  }
  return out;
}
