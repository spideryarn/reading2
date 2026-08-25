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

export interface Mark {
  /** The comment this mark belongs to. Ends up in `data-comment`. */
  id: string;
  /** Inclusive, in the block's rendered-text offset space. */
  start: number;
  /** Exclusive. */
  end: number;
  /** The comment whose dialog is open, so the prose can say which one it is. */
  open?: boolean;
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
 * `html` with every mark wrapped in `<mark class="cmt">`.
 *
 * Overlapping marks share one `<mark>` whose `data-comment` lists them
 * space-separated, rather than nesting — two underlines stacked on the same
 * words read as a rendering bug, and the click handler only needs the first id
 * to have something to open.
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
      el.className = "cmt";
      el.setAttribute("data-comment", covering.map((m) => m.id).join(" "));
      // The asterisk goes on the final run only, so a mark broken across an
      // <em> still shows exactly one marker.
      if (covering.some((m) => m.end === nodeStart + to)) el.setAttribute("data-mark-end", "");
      if (covering.some((m) => m.open)) el.setAttribute("data-open", "");
      el.textContent = piece;
      fragment.appendChild(el);
    }
    node.parentNode?.replaceChild(fragment, node);
  }
  return root.innerHTML;
}

function host(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
