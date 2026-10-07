/**
 * **A LaTeXML page's own shapes, put into the shapes the rest of the pipeline
 * already reads** — stage 2, before Readability.
 *
 * LaTeXML is what turns a paper's TeX into arXiv's HTML rendering
 * (`arxiv.org/html/…`) and ar5iv's. It is faithful to the TeX, and four of its
 * shapes reach a reader of ours broken, each measured on the five papers of
 * docs/investigations/261005e-arxiv-html-rendering-against-its-pdf-through-our-pipeline.md:
 *
 * | LaTeXML writes | a reader got | here it becomes |
 * |---|---|---|
 * | an aligned equation as a table, one inline formula per cell | fragments, the number in the middle | one display formula, the number beside it |
 * | an SVG plot as `<object type="image/svg+xml">` | a caption over nothing | an `<img>` at the same address |
 * | a code listing as one `<div>` per line | a paragraph per line | one `<pre>` |
 * | a `tcolorbox` as an SVG frame with its words in a `<foreignObject>` | an empty block: the sanitiser deletes `foreignObject` | the words, out of the frame |
 *
 * and a fifth thing it writes that nothing read: the authors, in the title
 * block and in no `<meta>` tag (`latexmlAuthorNames`, which src/meta-authors.ts
 * calls).
 *
 * ## The three rules every rewrite here follows
 *
 * 1. **Only at a supported LaTeXML source address, and only beneath
 *    `article.ltx_document`.** A class name alone is not proof a page is
 *    LaTeXML's.
 * 2. **An exact, written-down shape of direct children, and the page is left as
 *    it was when the shape does not hold** — the rule src/maths-import.ts works
 *    to. Every shape here is one that was measured on a real page; a shape
 *    nobody has seen is not guessed at.
 * 3. **The container's `id` is kept, and so is every descendant `id` or `name`
 *    a link in the page points at — or the page is left unchanged.** Stage 3
 *    repoints the paper's cross-references by those ids
 *    (src/blocks.ts § `retargetAnchors`).
 *
 * Nothing here deletes an author's words: what is removed is the publisher's
 * layout (padding cells, an SVG frame's paths, a duplicate download link).
 *
 * docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md
 * § *Stage: the HTML arm's faults*; tests/latexml.test.ts.
 */

import { fragmentTargets, texOfMathML } from "./maths-import.js";
import { texWouldDraw } from "./maths-server.js";
import { MATHS_SKIP_TAGS } from "./maths-tex.js";

/**
 * What was rewritten, as counts. `equationGroupsLeftAlone` is the one that
 * counts something *not* done: an equation group whose shape was not the
 * measured one, which a reader still gets in fragments.
 */
export interface LatexmlStats {
  alignedEquations: number;
  equationGroupsLeftAlone: number;
  svgObjects: number;
  listings: number;
  boxedPassages: number;
}

/** The element every rule here must find above what it rewrites. */
const DOCUMENT = "article.ltx_document";

/** The web sources this stage has measured as LaTeXML output. */
const LATEXML_SOURCES: ReadonlyMap<string, string> = new Map([
  ["https://arxiv.org", "/html/"],
  ["https://ar5iv.labs.arxiv.org", "/html/"],
]);

/** The elements whose text the reading view does not scan for TeX. */
const SKIP = MATHS_SKIP_TAGS.join(",");

/**
 * Rewrite the four shapes in a supported LaTeXML document in `doc`, and say
 * how many of each. An unrecognised source address, or a page with no
 * `article.ltx_document`, is not touched.
 *
 * Called from `prepareDocument` (src/extract.ts) **before `canonicaliseMaths`**:
 * the aligned equation is joined from each cell's TeX annotation, which that
 * pass replaces, and a boxed passage's formulas sit under an `<svg>`, where
 * that pass converts nothing.
 */
export function prepareLatexml(doc: Document): LatexmlStats {
  const stats: LatexmlStats = { alignedEquations: 0, equationGroupsLeftAlone: 0, svgObjects: 0, listings: 0, boxedPassages: 0 };
  if (!hasLatexmlSource(doc)) return stats;
  const roots = Array.from(doc.querySelectorAll(DOCUMENT));
  if (roots.length === 0) return stats;
  /* Once, not per element: the links do not change while this runs. */
  const targets = fragmentTargets(doc);
  for (const root of roots) {
    /* The boxes first: their words may hold an equation group or a listing,
       which the later rules can only see once it is out of the SVG. */
    for (const svg of Array.from(root.querySelectorAll("svg.ltx_picture"))) {
      if (liftBoxedPassage(svg, targets)) stats.boxedPassages += 1;
    }
    for (const table of Array.from(root.querySelectorAll("table.ltx_equationgroup"))) {
      if (joinAlignedEquation(table, targets)) stats.alignedEquations += 1;
      else stats.equationGroupsLeftAlone += 1;
    }
    for (const object of Array.from(root.querySelectorAll("object"))) {
      if (svgObjectToImage(object)) stats.svgObjects += 1;
    }
    for (const listing of Array.from(root.querySelectorAll("div.ltx_listing"))) {
      if (listingToPre(listing, targets)) stats.listings += 1;
    }
  }
  return stats;
}

/**
 * Producer evidence outside the page's markup. The document URL is the final
 * fetched address JSDOM was given; unlike a class or generator comment, a
 * stranger's page cannot opt itself into these rewrites by writing one.
 */
function hasLatexmlSource(doc: Document): boolean {
  try {
    const url = new URL(doc.URL);
    const path = LATEXML_SOURCES.get(url.origin);
    return path !== undefined && url.pathname.startsWith(path);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Shared
 * ------------------------------------------------------------------ */

/** No text directly under `el` but whitespace. */
function noOwnText(el: Element): boolean {
  return Array.from(el.childNodes).every((n) => n.nodeType !== 3 || (n.textContent ?? "").trim() === "");
}

/** Nothing under it at all but whitespace. */
function isEmpty(el: Element): boolean {
  return el.children.length === 0 && noOwnText(el);
}

/** The `id` and `name` of `el`, the ones a link in the page points at. */
function linkedNamesOf(el: Element, targets: ReadonlySet<string>): string[] {
  return [el.getAttribute("id"), el.getAttribute("name")].filter((v): v is string => !!v && targets.has(v));
}

/** Is `el`, or anything beneath it, something a link in the page points at? */
function holdsALinkTarget(el: Element, targets: ReadonlySet<string>): boolean {
  if (targets.size === 0) return false;
  return [el, ...Array.from(el.querySelectorAll("[id], [name]"))].some((node) => linkedNamesOf(node, targets).length > 0);
}

/* ------------------------------------------------------------------ *
 * 1. An aligned equation is one display formula
 * ------------------------------------------------------------------ */

/** The classes a group may carry. Any other — `ltx_eqn_gather`, `ltx_eqn_eqnarray` — is another environment. */
const GROUP_CLASSES = new Set(["ltx_equationgroup", "ltx_eqn_table", "ltx_eqn_align"]);

/** One row of a group, read: its formula cells' TeX (`""` for an empty cell) and its number cell, if it has one. */
interface EquationRow {
  readonly cells: readonly string[];
  readonly number: { readonly cell: Element; readonly side: "left" | "right" } | null;
}

/**
 * **`table.ltx_equationgroup` → one row holding `\[\begin{aligned}…\end{aligned}\]`.**
 *
 * The shape, and nothing wider (measured on 2605.20355v1, 2610.01658v1,
 * 2610.03261v1 and 2610.01988v1):
 *
 * ```
 * table.ltx_equationgroup.ltx_eqn_table[.ltx_eqn_align]
 *   tbody+                      one holding every row, or one per row
 *     tr.ltx_equation.ltx_eqn_row
 *       [td.ltx_eqn_eqno]       the number, when it is written on the left
 *       td.ltx_eqn_center_padleft   (empty)
 *       td.ltx_td.ltx_eqn_cell  ×1 or ×2, the same in every row: empty, or one inline <math>
 *       td.ltx_eqn_center_padright  (empty)
 *       [td.ltx_eqn_eqno]       the number, when it is written on the right
 * ```
 *
 * **At most one number in the whole group.** A group whose rows are numbered
 * independently is several equations a paper cites one by one; joining them
 * would need one formula to carry several numbers, and that has no fixture.
 * Four formula cells (two alignment columns), a row of words (`\intertext`),
 * and every other alignment environment are left alone for the same reason.
 *
 * What is written is the single-line equation's own shape — one row, the
 * formula in one cell as delimited display TeX, the number in the cell beside
 * it — which the maths pass produces today and stage 3 already reads. The
 * table keeps its `id`; a linked `tbody` or `tr` id is carried by the one
 * `tbody` and `tr` that remain, and a group with more linked ids than those
 * two can carry, or a link to anything else inside it, is left alone.
 *
 * Each cell's leading `\displaystyle` is dropped (LaTeXML adds it to every
 * cell; `aligned` sets its cells in display style already). Only if the
 * reading view would draw the result (`texWouldDraw`).
 */
function joinAlignedEquation(table: Element, targets: ReadonlySet<string>): boolean {
  const group = readEquationGroup(table);
  if (group === null) return false;
  const { rows, body, tr, number } = group;
  const homes = homesForLinkedIds(table, group, targets);
  if (homes === null) return false;

  const tex = `\\begin{aligned}\n${rows.map(rowTex).join(" \\\\\n")}\n\\end{aligned}`;
  /* The reading view ends a span at the first closer it meets, escaped or not
     (src/maths-tex.ts § `enclosed`). */
  if (tex.includes("\\]") || !texWouldDraw(tex, true)) return false;

  /* Nothing has been changed until here; from here nothing can decline. */
  const padLeft = tr.querySelector(":scope > td.ltx_eqn_center_padleft");
  const padRight = tr.querySelector(":scope > td.ltx_eqn_center_padright");
  const formula = table.ownerDocument.createElement("td");
  formula.className = "ltx_eqn_cell ltx_align_center";
  formula.append(table.ownerDocument.createTextNode(`\\[${tex}\\]`));
  number?.cell.removeAttribute("rowspan");
  tr.replaceChildren(
    ...(number?.side === "left" ? [number.cell] : []),
    ...(padLeft ? [padLeft] : []),
    formula,
    ...(padRight ? [padRight] : []),
    ...(number?.side === "right" ? [number.cell] : []),
  );
  body.replaceChildren(tr);
  table.replaceChildren(body);
  for (const [home, id] of homes) home.setAttribute("id", id);
  return true;
}

/** A group that holds the shape: its rows read, the one `tbody` and `tr` that will remain, and its number. */
interface EquationGroup {
  readonly rows: readonly EquationRow[];
  readonly body: Element;
  readonly tr: Element;
  readonly number: EquationRow["number"];
}

/** The table against the grammar in `joinAlignedEquation`'s header, or `null`. Reads; changes nothing. */
function readEquationGroup(table: Element): EquationGroup | null {
  if (table.tagName !== "TABLE" || !Array.from(table.classList).every((c) => GROUP_CLASSES.has(c))) return null;
  if (!table.classList.contains("ltx_eqn_table")) return null;
  /* Text in an element the reading view skips is never drawn as maths. */
  if (table.parentElement?.closest(SKIP)) return null;

  const bodies = Array.from(table.children);
  if (!noOwnText(table) || bodies.some((b) => b.tagName !== "TBODY" || !noOwnText(b))) return null;
  /* One tbody holding every row, or a tbody per row. */
  if (bodies.length > 1 && bodies.some((b) => b.children.length !== 1)) return null;
  const trs = bodies.flatMap((b) => Array.from(b.children));
  const rows: EquationRow[] = [];
  for (const row of trs.map(readEquationRow)) {
    if (row === null) return null;
    rows.push(row);
  }
  const [first] = rows;
  const [body] = bodies;
  const [tr] = trs;
  if (first === undefined || body === undefined || tr === undefined) return null;
  if (rows.some((r) => r.cells.length !== first.cells.length)) return null;
  const numbers = rows.flatMap((r) => (r.number ? [r.number] : []));
  if (numbers.length > 1) return null;
  return { rows, body, tr, number: numbers[0] ?? null };
}

/**
 * **Rule 3 for a group**: where each linked id that would otherwise be deleted
 * goes, or `null` if one of them has nowhere to go.
 *
 * The table, the number cell and the tag in it stay as they are. Of the rest,
 * only a `tbody` or a `tr` carries an id a paper's cross-reference points at,
 * and one of each remains, so two linked ids can be kept and a third cannot. A
 * linked `name`, or a linked id on a cell or a formula, has no home at all.
 * (Any element inside the table resolves to the table's block in stage 3, so
 * which of the two carries which id does not matter.)
 */
function homesForLinkedIds(table: Element, group: EquationGroup, targets: ReadonlySet<string>): Map<Element, string> | null {
  const survivors = [group.body, group.tr];
  const free = survivors.filter((s) => linkedNamesOf(s, targets).length === 0);
  const homes = new Map<Element, string>();
  for (const node of Array.from(table.querySelectorAll("[id], [name]"))) {
    const linked = linkedNamesOf(node, targets);
    if (linked.length === 0 || survivors.includes(node) || group.number?.cell.contains(node)) continue;
    const home = free.shift();
    const movable = (node.tagName === "TBODY" || node.tagName === "TR") && linked.length === 1 && linked[0] === node.id;
    if (!movable || home === undefined) return null;
    homes.set(home, node.id);
  }
  return homes;
}

/** One row against the grammar in `joinAlignedEquation`'s header, or `null`. */
function readEquationRow(tr: Element): EquationRow | null {
  if (tr.tagName !== "TR" || !tr.classList.contains("ltx_equation") || !tr.classList.contains("ltx_eqn_row")) return null;
  if (!noOwnText(tr)) return null;
  const tds = Array.from(tr.children);
  if (tds.some((td) => td.tagName !== "TD" || td.hasAttribute("colspan"))) return null;
  let number: EquationRow["number"] = null;
  const isNumber = (td: Element | undefined): td is Element => td?.classList.contains("ltx_eqn_eqno") === true;
  if (isNumber(tds[0])) number = { cell: tds.shift() as Element, side: "left" };
  if (isNumber(tds.at(-1))) {
    if (number) return null;
    number = { cell: tds.pop() as Element, side: "right" };
  }
  if (number && !isNumberCell(number.cell)) return null;
  const padLeft = tds.shift();
  const padRight = tds.pop();
  if (!padLeft?.classList.contains("ltx_eqn_center_padleft") || !isEmpty(padLeft)) return null;
  if (!padRight?.classList.contains("ltx_eqn_center_padright") || !isEmpty(padRight)) return null;
  if (tds.length !== 1 && tds.length !== 2) return null;
  const cells: string[] = [];
  for (const td of tds) {
    const tex = formulaCellTex(td);
    if (tex === null) return null;
    cells.push(tex);
  }
  /* A row of nothing is not a line of an equation. */
  if (cells.every((c) => c === "")) return null;
  return { cells, number };
}

/** `td.ltx_eqn_eqno` holding one `span.ltx_tag` with the number in it, and nothing else. */
function isNumberCell(td: Element): boolean {
  const tag = td.firstElementChild;
  return (
    td.children.length === 1 &&
    noOwnText(td) &&
    tag?.tagName === "SPAN" &&
    tag.classList.contains("ltx_tag") &&
    tag.children.length === 0 &&
    (tag.textContent ?? "").trim() !== ""
  );
}

/** A formula cell's TeX: `""` for an empty cell, `null` for anything but one inline `<math>` with a source. */
function formulaCellTex(td: Element): string | null {
  if (!td.classList.contains("ltx_td") || !td.classList.contains("ltx_eqn_cell")) return null;
  if (isEmpty(td)) return "";
  const math = td.firstElementChild;
  if (td.children.length !== 1 || !noOwnText(td) || math?.tagName.toLowerCase() !== "math") return null;
  if (math.getAttribute("display") === "block") return null;
  const raw = texOfMathML(math)?.trim();
  if (!raw) return null;
  const tex = raw.replace(/^\\displaystyle(?![A-Za-z])\s*/u, "").trim();
  /* A cell has to be a formula on its own. Otherwise an authored alignment
     control such as a bare `&` or `\\` can become valid only after this pass
     wraps it in `aligned`, where it changes the rows or columns we build. */
  return tex !== "" && !hasAlignmentControl(tex) && texWouldDraw(tex, false) ? tex : null;
}

/**
 * Does a cell carry alignment syntax **of its own, at its top level**?
 *
 * A column or row break inside an environment the cell opens and closes
 * itself (`cases`, `subarray`, `pmatrix`) belongs to that environment and is
 * consumed by it wherever the cell is put: 2610.01658v1 has five such groups,
 * each right in the author's TeX. One at the cell's top level would be read by
 * the `aligned` this pass wraps round it, as a column or a row nobody wrote.
 * So the depth counted is `\begin`…`\end` only. Braces are not counted: what a
 * brace group does with an alignment control differs between renderers, and
 * declining costs only the layout. A cell whose environments do not balance is
 * declined too. Comments are skipped because their tokens are not TeX input.
 *
 * GPT Sol's F20 made every control a refusal; that sent the five groups above
 * back to fragments, measured on the re-run, and this is the narrowing.
 */
function hasAlignmentControl(tex: string): boolean {
  let depth = 0;
  for (let i = 0; i < tex.length; i += 1) {
    const char = tex[i];
    if (char === "%") {
      const end = tex.indexOf("\n", i + 1);
      if (end === -1) break;
      i = end;
      continue;
    }
    if (char === "&") {
      if (depth === 0) return true;
      continue;
    }
    if (char !== "\\") continue;
    const next = tex[i + 1] ?? "";
    if (next === "\\") {
      if (depth === 0) return true;
      i += 1;
      continue;
    }
    const word = /^[A-Za-z]+/u.exec(tex.slice(i + 1))?.[0] ?? "";
    if (word === "begin") depth += 1;
    else if (word === "end") {
      depth -= 1;
      if (depth < 0) return true;
    } else if ((word === "cr" || word === "tabularnewline") && depth === 0) return true;
    /* The escaped character or control word cannot be a top-level token too. */
    i += word === "" ? 1 : word.length;
  }
  return depth !== 0;
}

/**
 * One row's TeX: its cells joined at the alignment point.
 *
 * **Each cell ends its own line**, so a `%` comment in one cell's source cannot
 * swallow the `&` or the `\\` after it. And a row that would open with `[` is
 * given an empty group first: `\\` reads a following `[…]` as its spacing
 * argument.
 */
function rowTex(row: EquationRow): string {
  const joined = row.cells
    .map((cell, i) => (i === 0 ? cell : `& ${cell}`.trim()))
    .filter((part) => part !== "")
    .join("\n");
  return joined.startsWith("[") ? `{}${joined}` : joined;
}

/* ------------------------------------------------------------------ *
 * 2. An SVG plot in an <object> is an image
 * ------------------------------------------------------------------ */

/** What an `<img>` takes from the `<object>` it replaces. `type` and `data` are the object's own. */
const IMAGE_ATTRIBUTES = ["id", "class", "width", "height", "alt", "title"];

/**
 * **`figure object[type="image/svg+xml"][data]`, with nothing in it → `<img>`**
 * at the same address, with the same `id` and dimensions.
 *
 * An `<object>` is deleted by Readability's clean-up with everything else that
 * can embed (`_clean(e, "object")`), so the figure reached a reader as a
 * caption. An object with fallback children — a description, another picture —
 * is the author's content in a shape this does not know, and is left alone.
 *
 * **Nothing about hosting changes.** Stage 4.5 does not host SVG: it records
 * `unsupported-format` and leaves the image addressed at its publisher, as it
 * does for every other SVG (src/assets.ts § `sniffImage`).
 */
function svgObjectToImage(object: Element): boolean {
  if ((object.getAttribute("type") ?? "").trim().toLowerCase() !== "image/svg+xml") return false;
  const address = (object.getAttribute("data") ?? "").trim();
  if (address === "" || !isEmpty(object)) return false;
  /* Beneath a figure, not only directly in one: a panel of a multi-part figure
     sits in a `div.ltx_flex_cell` (four of ar5iv 1706.03762's five). */
  if (object.closest("figure") === null) return false;
  const img = object.ownerDocument.createElement("img");
  img.setAttribute("src", address);
  for (const name of IMAGE_ATTRIBUTES) {
    const value = object.getAttribute(name);
    if (value !== null) img.setAttribute(name, value);
  }
  object.replaceWith(img);
  return true;
}

/* ------------------------------------------------------------------ *
 * 3. A code listing is one code block
 * ------------------------------------------------------------------ */

/** What a line may not hold if it is to sit in a `<pre>`: blocks, and a formula, which a `<pre>` never draws. */
const NOT_IN_A_PRE = "math, div, p, table, ul, ol, dl, pre, figure, blockquote, h1, h2, h3, h4, h5, h6, .ltx_listing";

/**
 * **`div.ltx_listing` whose children are all `div.ltx_listingline` → one
 * `<pre>`** holding each line's child nodes, a newline between lines.
 *
 * One thing may come before the lines, because the page this was measured on
 * (2608.13566, eighteen listings) has it on every one: `div.ltx_listing_data`
 * holding a single `<a href="data:…" download>`, LaTeXML's "download this
 * listing" link — the same text again, base64-encoded. It is the publisher's
 * control and goes. A cell holding anything else is not that, and the listing
 * is left alone.
 *
 * **An algorithm set as a listing is left alone**: its lines hold formulas, and
 * the reading view does not draw maths inside a `<pre>`. So is a listing with a
 * line a link points at, since the line's `<div>` — and its id — is what goes.
 * The spans inside the lines, links and anchors among them, are moved, not
 * copied, so their ids survive.
 */
function listingToPre(listing: Element, targets: ReadonlySet<string>): boolean {
  if (!noOwnText(listing)) return false;
  const children = Array.from(listing.children);
  const download = children[0]?.classList.contains("ltx_listing_data") ? children.shift() : undefined;
  if (download && !isDownloadLink(download)) return false;
  if (children.length === 0) return false;
  for (const line of children) {
    if (line.tagName !== "DIV" || !line.classList.contains("ltx_listingline")) return false;
    if (line.querySelector(NOT_IN_A_PRE) !== null) return false;
    if (linkedNamesOf(line, targets).length > 0) return false;
    if (!lineWhitespaceIsExact(line)) return false;
  }
  if (download && holdsALinkTarget(download, targets)) return false;

  const doc = listing.ownerDocument;
  const pre = doc.createElement("pre");
  const id = listing.getAttribute("id");
  if (id) pre.setAttribute("id", id);
  children.forEach((line, i) => {
    if (i > 0) pre.append(doc.createTextNode("\n"));
    /* The line break LaTeXML's serialiser puts before `</div>` is the page's
       indentation, not the listing's: a space in a listing is its own span. */
    for (const edge of [line.firstChild, line.lastChild]) {
      if (edge?.nodeType === 3 && /^[\r\n]+$/u.test(edge.textContent ?? "")) edge.remove();
    }
    pre.append(...Array.from(line.childNodes));
  });
  listing.replaceWith(pre);
  return true;
}

/**
 * LaTeXML writes at most a bare newline at either edge. Pretty-printing
 * whitespace between inline children collapses in a `<div>` but becomes a
 * literal new line in `<pre>`, so that is another shape and stays untouched.
 */
function lineWhitespaceIsExact(line: Element): boolean {
  for (const node of Array.from(line.childNodes)) {
    if (node.nodeType !== 3 || !/[\r\n]/u.test(node.textContent ?? "")) continue;
    const edge = node === line.firstChild || node === line.lastChild;
    if (!edge || !/^[\r\n]+$/u.test(node.textContent ?? "")) return false;
  }
  return true;
}

/** `div.ltx_listing_data` holding exactly one `<a href="data:…">` and no words of its own. */
function isDownloadLink(cell: Element): boolean {
  const a = cell.firstElementChild;
  return (
    cell.children.length === 1 &&
    noOwnText(cell) &&
    a?.tagName === "A" &&
    a.children.length === 0 &&
    a.hasAttribute("download") &&
    /^data:/iu.test((a.getAttribute("href") ?? "").trim())
  );
}

/* ------------------------------------------------------------------ *
 * 7. A boxed passage keeps its words
 * ------------------------------------------------------------------ */

/** What an SVG that only frames a passage is drawn with. `text`, `image`, `circle`, `use`: a drawing. */
const FRAME_TAGS = new Set(["g", "path", "rect"]);

/** Content that would begin loading or running only after it was lifted into ordinary HTML. */
const ACTIVE_PASSAGE_CONTENT = "audio, embed, iframe, img, link, object, picture, script, source, style, svg, video";

/**
 * **`svg.ltx_picture` that is only a frame round one `<foreignObject>` → a
 * `<span>` holding that object's words.**
 *
 * LaTeXML draws a `tcolorbox` as an SVG: two paths for the border and the
 * fill, and the boxed text as HTML inside a `foreignObject`. Readability keeps
 * all of it. The sanitiser then deletes the `foreignObject` with everything in
 * it (DOMPurify's SVG profile does not allow one — it is where HTML is parsed
 * inside foreign content, the home of most mXSS — src/sanitize-policy.ts), and
 * the reader is left an empty frame. **That policy is not loosened.** The words
 * are taken out of the SVG here instead, where they are ordinary HTML in an
 * ordinary element, and the sanitiser reads them like any other.
 *
 * The shape, measured on §3 of 2608.13566:
 *
 * ```
 * svg.ltx_picture                  not .ltx_markedasmath
 *   g / path / rect …              nothing else: no text, no image
 *   foreignObject                  exactly one in the whole SVG
 *     span.ltx_foreignobject_container
 *       span.ltx_foreignobject_content   → its child nodes are the passage
 * ```
 *
 * A diagram is not this: it has a `foreignObject` per label (nine in each of
 * Figure 1's panels in 2610.01988v1) and is left as the picture it is. The
 * `<span>` takes the SVG's `id`; the passage's own ids move with it; a link to
 * any part of the frame leaves the page unchanged. A `<span>` because the SVG
 * sits where phrasing content does, and stage 3 makes a block of the paragraph
 * round it.
 */
function liftBoxedPassage(svg: Element, targets: ReadonlySet<string>): boolean {
  if (svg.classList.contains("ltx_markedasmath")) return false;
  const objects = Array.from(svg.querySelectorAll("foreignObject"));
  const object = objects[0];
  if (objects.length !== 1 || object === undefined) return false;
  const container = object.firstElementChild;
  const content = container?.firstElementChild;
  if (
    object.children.length !== 1 ||
    !noOwnText(object) ||
    !container?.matches("span.ltx_foreignobject_container") ||
    container.children.length !== 1 ||
    !noOwnText(container) ||
    !content?.matches("span.ltx_foreignobject_content") ||
    (content.textContent ?? "").trim() === ""
  ) {
    return false;
  }
  if (content.querySelector(ACTIVE_PASSAGE_CONTENT) !== null) return false;
  /* Everything else in the SVG is the frame: drawn, wordless, and not linked to. */
  for (const part of Array.from(svg.querySelectorAll("*"))) {
    if (content.contains(part)) {
      /* The wrapper itself is discarded: only its children move. A linked id
         or name on that wrapper therefore has no faithful home. */
      if (part === content && linkedNamesOf(part, targets).length > 0) return false;
      continue;
    }
    if (linkedNamesOf(part, targets).length > 0) return false;
    if (part === object || part === container) continue;
    if (!FRAME_TAGS.has(part.tagName.toLowerCase()) || !noOwnText(part)) return false;
  }
  if (!noOwnText(svg)) return false;

  const passage = svg.ownerDocument.createElement("span");
  const id = svg.getAttribute("id");
  if (id) passage.setAttribute("id", id);
  passage.append(...Array.from(content.childNodes));
  svg.replaceWith(passage);
  return true;
}

/* ------------------------------------------------------------------ *
 * 5. The paper's authors
 * ------------------------------------------------------------------ */

/** A footnote mark set as text after a name. */
const TRAILING_MARKS = /[\s*∗†‡§¶‖]+$/u;

/** What may stand between two creators, spaces collapsed and lower-cased. A closed list: each was seen on a page. */
const BETWEEN_CREATORS: ReadonlySet<string> = new Set(["", "and", ","]);

/** What a creator may hold beside its one personname: the notes block, and the footnote `\thanks` makes. */
const BESIDE_THE_NAME = "span.ltx_author_notes, span.ltx_note.ltx_role_thanks";

/** One person's ORCID record, and nothing else at that address. */
const ORCID_RECORD = /^https?:\/\/orcid\.org\/\d{4}-\d{4}-\d{4}-\d{3}[\dX]\/?$/u;

/**
 * **The names in a LaTeXML title block, in the page's order — or `null`.**
 *
 * A LaTeXML page declares its authors in no `<meta>` tag, so the byline was
 * Readability's guess, and on the five papers measured it was: one author of
 * twelve with his affiliation, the word "and", and a cited author out of the
 * reference list. src/meta-authors.ts hands these names to the path a page's
 * declared authors already take.
 *
 * The shape, the same on all five, with what 19 more pages added on 2026-10-07:
 *
 * ```
 * article.ltx_document  (one)
 *   div.ltx_authors      (one)
 *     span.ltx_creator.ltx_role_author   ×n
 *       span.ltx_personname              one, holding one name
 *       span.ltx_note.ltx_role_thanks    the footnote `\thanks` makes, when it is set beside the name: not read
 *       span.ltx_author_notes            affiliations, addresses, emails: not read
 *     span.ltx_author_before             the space, the ", " or the " and " between them: not read
 * ```
 *
 * **Names only**, and a name is the personname's own text: an ORCID link, a
 * superscript and a footnote are left out. One link is read into: a name that
 * is itself the text of a link to that person's ORCID record, the logo beside
 * it left out. Any other link in a personname refuses, which is what keeps a
 * "Code" or "Dataset" link marked up as a creator from being read as a person.
 *
 * The footnote beside the personname hides nobody. A creator still holds
 * exactly one personname and no words of its own, so a second name after the
 * footnote refuses as it did before. Older LaTeXML puts every author,
 * their marks and their affiliations into one `personname` separated by commas
 * and line breaks; telling a name from an institution there is a guess, so
 * **one creator that is not plainly one name gives `null` for the whole list**
 * and the byline stays as it was. A list with somebody missing is worse than
 * the one Readability made.
 */
export function latexmlAuthorNames(doc: Document): string[] | null {
  if (!hasLatexmlSource(doc)) return null;
  const roots = doc.querySelectorAll(DOCUMENT);
  const root = roots[0];
  if (roots.length !== 1 || root === undefined) return null;
  const blocks = root.querySelectorAll(".ltx_authors");
  const block = blocks[0];
  if (blocks.length !== 1 || block === undefined || !noOwnText(block)) return null;
  const names: string[] = [];
  for (const child of Array.from(block.children)) {
    if (child.matches("span.ltx_author_before")) {
      const between = (child.textContent ?? "").replace(/\s+/gu, " ").trim().toLowerCase();
      if (child.children.length !== 0 || !BETWEEN_CREATORS.has(between)) return null;
      continue;
    }
    if (!child.matches("span.ltx_creator.ltx_role_author") || !noOwnText(child)) return null;
    const parts = Array.from(child.children);
    const person = parts.filter((p) => p.matches("span.ltx_personname"));
    if (person.length !== 1 || parts.some((p) => p !== person[0] && !p.matches(BESIDE_THE_NAME))) return null;
    const name = oneName(person[0] as Element);
    if (name === null) return null;
    names.push(name);
  }
  return names.length > 0 ? names : null;
}

/** A link to one person's ORCID record that holds words and, at most, the logo: no element with text of its own. */
function isOrcidLinkedName(el: Element): boolean {
  if (!el.matches("a.ltx_ref.ltx_href") || !ORCID_RECORD.test(el.getAttribute("href") ?? "")) return false;
  return Array.from(el.children).every((part) => part.matches(".ltx_graphics") && (part.textContent ?? "").trim() === "");
}

/** The one name a `personname` holds, or `null` if it holds anything that is not plainly one. */
function oneName(person: Element): string | null {
  let text = "";
  /* A mark ends the name. Words after one are a second person or a place:
     `Jane Doe<sup>1</sup> John Smith<sup>2</sup>`. */
  let ended = false;
  const add = (more: string): boolean => {
    if (ended && more.trim() !== "") return false;
    text += more;
    return true;
  };
  for (const node of Array.from(person.childNodes)) {
    if (node.nodeType === 3) {
      if (!add(node.textContent ?? "")) return null;
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    /* Marks and links beside the name: not part of it. */
    if (el.matches("sup, a.ltx_orcid, .ltx_note")) {
      ended = true;
      continue;
    }
    /* A name set in a font: `<span class="ltx_text ltx_font_bold">`, holding only text. */
    if (el.matches("span.ltx_text") && el.children.length === 0) {
      if (!add(el.textContent ?? "")) return null;
      continue;
    }
    /* A name that is the text of its own ORCID link: `<a href="https://orcid.org/…"><object
       class="ltx_graphics">` (the logo) ` Jane Doe</a>`. The link is the whole name, so words
       before it or after it are somebody or something else; its own go through every check below. */
    if (isOrcidLinkedName(el)) {
      if (text.trim() !== "" || !add(el.textContent ?? "")) return null;
      ended = true;
      continue;
    }
    return null;
  }
  const name = text.replace(/\s+/gu, " ").replace(TRAILING_MARKS, "").trim();
  if (name === "" || !/\p{L}/u.test(name)) return null;
  /* Two people, a person and a place, an address: not one name. */
  if (/[,;:@\d/()&]/u.test(name) || /(^|\s)and(\s|$)/iu.test(name)) return null;
  if (name.split(" ").length > 6) return null;
  return name;
}
