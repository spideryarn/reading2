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
import { quoteFinder, type Span } from "../quote-match.js";
import type { Block } from "../types.js";
import { renderBlockMaths } from "./maths.js";
import { mathsSource } from "./maths-provenance.js";
import { sanitizeBlockHtml } from "./sanitize.js";

/** Inline formatting an excerpt keeps, recreated without attributes. */
const KEEP = new Set([
  "em", "i", "strong", "b", "sub", "sup", "code", "kbd", "samp", "var",
  "s", "del", "ins", "u", "small", "cite", "abbr", "dfn",
]);

/*
 * Not kept, and why not: `<a>` (an excerpt usually sits inside a button that
 * goes to the passage) and `<q>` (the caller already puts the excerpt in
 * quotation marks, and a browser draws its own for a `<q>` — Sol, plan review
 * F7). Both are unwrapped to their words, like any element not in `KEEP`.
 */

/**
 * Gone, contents and all: nothing in them is words an excerpt can show. Their
 * text is left out of the matching too (`textNodes`), so words that ran
 * across a diagram's label are not "found" and then drawn without it (F5).
 */
const DROP = new Set([
  "img", "svg", "picture", "video", "audio", "iframe", "object", "embed",
  "script", "style", "template", "noscript", "canvas", "hr", "button", "input",
  "select", "textarea",
]);
const DROP_SELECTOR = [...DROP].join(", ");

/**
 * Attributes nothing in an excerpt may carry, on a `<math>` kept whole: the
 * article's own MathML is not checked the way temml's is (maths.ts §
 * `mathElement`), and the policy keeps `id`, `name`, a safe `href` and some
 * `data-spya-*` (Sol, plan review F2; docs/project/block-ids.md). Every
 * `data-*` goes too.
 */
const ADDRESSING = new Set(["id", "name", "href", "xlink:href", "tabindex", "autofocus"]);

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
const XHTML = "http://www.w3.org/1999/xhtml";
const SKIP = MATHS_SKIP_TAGS.join(", ");

/** An inert document: nothing in a block's html loads while it is parsed here. */
let inert: Document | null = null;
function inertDoc(): Document {
  if (!inert) inert = document.implementation.createHTMLDocument("");
  return inert;
}

/**
 * Where a caller's words sit, when it knows: an offset into the block's text
 * **as drawn** (`renderedText(block.html)`) — a search hit's or an idea's
 * `Found.start`, a comment's anchor. It chooses between repeats, so a hit on
 * the second "same words" is drawn from the second (Sol, plan review F3). A
 * caller without one — a stored quote, measured in `block.text` — passes
 * nothing and gets the first occurrence, which is `resolveQuotes`' rule.
 */
export interface ExcerptAt {
  near?: number;
}

/** Each block's excerpts, by words and position — a list draws the same ones on every render (F6). */
const cache = new WeakMap<Block, Map<string, string | null>>();

/**
 * **`words` from `block`, as html** — or `null` when they are not in it.
 *
 * `words` is what the caller would otherwise have drawn as a string: a whole
 * quote, or the front of one it has cut (and will put its own `…` after).
 */
export function excerptHtml(block: Block, words: string, at: ExcerptAt = {}): string | null {
  const key = `${at.near ?? ""}\u0000${words}`;
  let mine = cache.get(block);
  if (!mine) {
    mine = new Map();
    cache.set(block, mine);
  }
  if (mine.has(key)) return mine.get(key) ?? null;
  const html = draw(block, words, at);
  mine.set(key, html);
  return html;
}

function draw(block: Block, words: string, at: ExcerptAt): string | null {
  const source = mathsSource(block);
  /* Twice for a block that had maths drawn: first in the words the model saw,
     TeX and all, which is where a stored quote came from; then in the block
     as drawn, which is where a reader's selection and a snippet cut from the
     rendered text came from — their formulas are already symbols. A caller
     with a position measured it in the drawn text, so it skips the first. */
  if (source && at.near === undefined) {
    const fromSource = cutFrom(block, source.html, words);
    if (fromSource !== null) return finish(renderBlockMaths(fromSource, source.render));
  }
  const asDrawn = cutFrom(block, block.html, words, at.near);
  return asDrawn === null ? null : finish(asDrawn);
}

/**
 * **The last step for every excerpt**: a displayed formula drawn in the line,
 * so a row stays a row, and the whole put back through the article policy.
 * Inline is MathML's own `display`, not CSS — `display: inline` on a `<math>`
 * takes it out of MathML layout (docs/project/maths.md § Where it sits).
 */
function finish(html: string): string {
  /* Words alone — the usual case — are already safe: they were serialised from
     text nodes, so every `<` and `&` is escaped. Only markup needs the pass. */
  if (!html.includes("<")) return html;
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
function cutFrom(block: Block, html: string, words: string, near?: number): string | null {
  const doc = inertDoc();
  const { root, nodes, find } = parsed(block, html);
  /* `near` is measured in the drawn text, which counts a dropped element's
     text and this does not — a diagram's labels before the words move it by
     their length. Only a tie-break between repeats, so close is enough. */
  const span = find(words, near);
  if (span === null) return null;

  const range = doc.createRange();
  const start = locate(nodes, span.start, "start");
  const end = locate(nodes, span.end, "end");
  if (!start || !end) return null;
  setBoundary(range, start.node, widen(start.node, start.offset, "start"), "start");
  setBoundary(range, end.node, widen(end.node, end.offset, "end"), "end");
  if (range.collapsed) return null;

  const out = doc.createElement("div");
  out.append(withAncestors(keepInline(range.cloneContents(), doc), range, root, doc));
  return out.innerHTML.trim();
}

/** One parse of a block's html, and the finder over its text, for every excerpt cut from it. */
interface Parsed {
  root: Element;
  nodes: Text[];
  find: (words: string, near?: number) => Span | null;
}

/**
 * **Each block parsed once**, in each of its two forms, however many excerpts
 * are cut from it. A Search for a common word draws hundreds of hits from a
 * few dozen blocks, and parsing the block per hit was the cost the browser
 * check measured (plan 261009k § Costs). Nothing mutates the tree:
 * `cloneContents` copies.
 */
const parses = new WeakMap<Block, Map<string, Parsed>>();

function parsed(block: Block, html: string): Parsed {
  let mine = parses.get(block);
  if (!mine) {
    mine = new Map();
    parses.set(block, mine);
  }
  const had = mine.get(html);
  if (had) return had;
  const root = inertDoc().createElement("div");
  root.innerHTML = html;
  const nodes = textNodes(root);
  const made = { root, nodes, find: quoteFinder(nodes.map((n) => n.data).join("")) };
  mine.set(html, made);
  return made;
}

/**
 * **The formatting the excerpt sits wholly inside.** `cloneContents` copies
 * the elements a range crosses but not the ones it is inside, so the words of
 * `<em>important words</em>` came out plain (Sol, plan review F1). Each `KEEP`
 * element between the range's common ancestor and the block is put back
 * around it, innermost first.
 */
function withAncestors(inner: DocumentFragment, range: Range, root: Element, doc: Document): Node {
  let wrapped: Node = inner;
  const common = range.commonAncestorContainer;
  for (let el = common instanceof Element ? common : common.parentElement; el && el !== root; el = el.parentElement) {
    if (el.namespaceURI !== XHTML || !KEEP.has(el.localName)) continue;
    const bare = doc.createElement(el.localName);
    bare.append(wrapped);
    wrapped = bare;
  }
  return wrapped;
}

/**
 * **A string the block could not place**, drawn with its maths if the block's
 * renderer is to hand — otherwise `null`, and the caller draws it as text.
 */
export function excerptFallbackHtml(block: Block | undefined, words: string): string | null {
  const source = block ? mathsSource(block) : null;
  if (!source) return null;
  /* A code block's `\(…\)` is code, which the placed path keeps as source
     (`MATHS_SKIP_TAGS`). Its words, unplaced, have lost that context, so they
     stay a string rather than turn into maths (Sol, plan review F9). */
  if (block?.kind === "code") return null;
  const holder = inertDoc().createElement("div");
  holder.textContent = words;
  const escaped = holder.innerHTML;
  const drawn = renderBlockMaths(escaped, source.render);
  return drawn === escaped ? null : finish(drawn);
}

/** The text nodes an excerpt can show: everything but what `DROP` leaves out. */
function textNodes(root: Element): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement?.closest(DROP_SELECTOR)) out.push(n as Text);
  }
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
      out.append(inertMath(el, doc));
      continue;
    }
    if (el.namespaceURI !== XHTML) continue;
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

/**
 * A `<math>` copied whole, with nothing in it that addresses anything: no
 * `ADDRESSING` attribute or `data-*` on any element, and any HTML inside it
 * (a link in an `<mtext>`) reduced to its words (F2).
 */
function inertMath(math: Element, doc: Document): Node {
  const copy = math.cloneNode(true) as Element;
  for (const el of [copy, ...copy.querySelectorAll("*")]) {
    if (el.namespaceURI === XHTML) {
      el.replaceWith(doc.createTextNode(el.textContent ?? ""));
      continue;
    }
    for (const attr of [...el.attributes]) {
      if (ADDRESSING.has(attr.name) || ADDRESSING.has(attr.localName) || attr.name.startsWith("data-")) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return copy;
}
