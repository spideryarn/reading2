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
 * calls). And a sixth, that same title block drawn as one fused paragraph of
 * pop-up labels, with an author's details deleted by Readability's byline search:
 * `tidyTitleBlock` makes it one row per author. And a seventh, its own error
 * report: a macro it could not expand, written into the prose as `\name`
 * (`removeUndefinedMacro`).
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
 * layout (padding cells, an SVG frame's paths, a duplicate download link, the
 * title block's pop-up labels and repeated marks) and LaTeXML's own error
 * reports. The one exception is narrow and named: an undefined macro's argument
 * when it is a name from the TeX source rather than prose — a colour theme, a
 * .bib file, a citation key (`removeUndefinedMacro` says which shapes).
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
  /** The author block rewritten as one row per author: 0 or 1. */
  titleBlocks: number;
  /** LaTeXML's `ltx_ERROR` reports of a macro it could not expand, removed. */
  undefinedMacros: number;
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
 * Rewrite the five shapes in a supported LaTeXML document in `doc`, and say
 * how many of each. An unrecognised source address, or a page with no
 * `article.ltx_document`, is not touched.
 *
 * Called from `prepareDocument` (src/extract.ts) **before `canonicaliseMaths`**:
 * the aligned equation is joined from each cell's TeX annotation, which that
 * pass replaces, and a boxed passage's formulas sit under an `<svg>`, where
 * that pass converts nothing.
 */
export function prepareLatexml(doc: Document): LatexmlStats {
  const stats: LatexmlStats = { alignedEquations: 0, equationGroupsLeftAlone: 0, svgObjects: 0, listings: 0, boxedPassages: 0, titleBlocks: 0, undefinedMacros: 0 };
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
    for (const marker of Array.from(root.querySelectorAll("span.ltx_ERROR.undefined"))) {
      if (removeUndefinedMacro(marker, targets)) stats.undefinedMacros += 1;
    }
  }
  if (tidyTitleBlock(doc, targets)) stats.titleBlocks += 1;
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
 * 8. A macro LaTeXML could not expand
 * ------------------------------------------------------------------ */

/** One TeX control sequence and nothing else: `\hohsettheme`, `\ucite`, `\\`. */
const CONTROL_SEQUENCE = /^\\(?:[A-Za-z@]+\*?|[^A-Za-z@\s])$/u;

/**
 * A name from the TeX source, not a word: one token with an underscore or a
 * lower-case letter straight before a capital — `hohRose`,
 * `Biblio_paper_brillouin`. An ordinary word (`Funding`) and an acronym
 * (`LP4FM`) have neither.
 */
const SOURCE_NAME = /^(?=[\w-]{1,64}$)[\w-]*(?:_|[a-z][A-Z])[\w-]*$/u;

/** A citation key, or several joined by commas; a full stop or comma only between key characters. */
const CITATION_KEY = /^[\w:\-/+]+(?:[.,][\w:\-/+]+)*/u;

/** What a few measured macros stood for, where leaving nothing would join two phrases. */
const STOOD_FOR: ReadonlyMap<string, string> = new Map([
  /* elsarticle's and CEUR's keyword separator (2610.10541). */
  ["\\sep", "; "],
]);

/** Inline elements whose text belongs to the same run on either side of a marker. */
const INLINE_TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  "A",
  "ABBR",
  "B",
  "BDI",
  "BDO",
  "CITE",
  "CODE",
  "DATA",
  "DEL",
  "DFN",
  "EM",
  "I",
  "INS",
  "KBD",
  "LABEL",
  "MARK",
  "Q",
  "RUBY",
  "S",
  "SAMP",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TIME",
  "U",
  "VAR",
]);

/**
 * Remove LaTeXML's report of a macro it had no definition for, and the argument
 * it orphaned where that is plainly a name from the source rather than prose.
 * The report is the macro's name, set as text in
 * `<span class="ltx_ERROR undefined">`; the argument follows as ordinary text,
 * because LaTeXML did not know the macro took one.
 *
 * The report is never the author's words, so it always goes. What follows it
 * usually is the author's (a funding statement after `\bmsection`, a workshop's
 * name after `\workshoptitle`) and stays. Two shapes of argument are not, and
 * go with it:
 *
 * - a `p.ltx_p` straight after it whose whole text is one `SOURCE_NAME` —
 *   `\hohsettheme{hohRose}`, a colour theme (2609.01481v1), and
 *   `\bibliographyfullrefs{Biblio_paper_brillouin}`, a .bib file (2610.11413);
 * - a key straight after a macro whose name says `cite`, when the key has a
 *   digit, an underscore or a capital inside it (so `\excite electrons` keeps
 *   its word) —
 *   `phases\ucite{dagotto2005}.` reads `phases.` (2610.11126, 104 of them).
 *
 * Where taking the report out would join two words, a space stands in its
 * place; `STOOD_FOR` names the macros that stood for something more, only when
 * their phrase is present on both sides. Measured on 79 arXiv papers,
 * 2026-10-09:
 * docs/plans/261009f-latex-undefined-macros-leave-the-page.md.
 */
function removeUndefinedMacro(marker: Element, targets: ReadonlySet<string>): boolean {
  if (marker.children.length > 0 || marker.parentElement?.closest(SKIP)) return false;
  const name = (marker.textContent ?? "").trim();
  if (!CONTROL_SEQUENCE.test(name)) return false;
  const argument = sourceNameArgument(marker);
  if (holdsALinkTarget(marker, targets) || (argument && holdsALinkTarget(argument, targets))) return false;

  const after = marker.nextSibling;
  if (/cite/iu.test(name) && after?.nodeType === 3) {
    const text = after.textContent ?? "";
    const key = CITATION_KEY.exec(text)?.[0];
    if (key && /\d|_|[a-z][A-Z]/u.test(key)) {
      after.textContent = text.slice(key.length);
      /* TeX source commonly puts a space before a citation command. Once the
         unusable citation is gone, sentence punctuation belongs to the word. */
      if (/^[,.;:!?)}\]]/u.test(after.textContent ?? "")) trimInlineWhitespaceBefore(marker);
    }
  }
  argument?.remove();
  const before = inlineTextBeside(marker, "before");
  const next = inlineTextBeside(marker, "after");
  const stoodFor = STOOD_FOR.get(name);
  if (stoodFor !== undefined && /\S/u.test(before) && /\S/u.test(next)) {
    trimInlineWhitespaceBefore(marker);
    marker.replaceWith(stoodFor);
  } else if (stoodFor !== undefined) {
    /* A separator without a phrase on both sides is only another report. */
    marker.remove();
  } else if (/\S$/u.test(before) && /^[\p{L}\p{N}]/u.test(next)) {
    marker.replaceWith(" ");
  } else {
    marker.remove();
  }
  return true;
}

/** The paragraph straight after `marker`, if its whole text is one name from the source. */
function sourceNameArgument(marker: Element): Element | null {
  let node = marker.nextSibling;
  while (node && node.nodeType === 3 && (node.textContent ?? "").trim() === "") node = node.nextSibling;
  if (node?.nodeType !== 1) return null;
  const p = node as Element;
  if (!p.matches("p.ltx_p") || p.children.length > 0) return null;
  return SOURCE_NAME.test((p.textContent ?? "").trim()) ? p : null;
}

/**
 * Text on one side in the same inline run. A marker may be the first or last
 * child of a `<span>` or `<em>` even though words touch that wrapper outside;
 * stop at the first block-like element rather than joining separate blocks.
 */
function inlineTextBeside(marker: Element, side: "before" | "after"): string {
  const parts: string[] = [];
  const siblingOf = side === "before" ? (node: Node) => node.previousSibling : (node: Node) => node.nextSibling;
  const add = side === "before" ? (text: string) => parts.unshift(text) : (text: string) => parts.push(text);
  let edge: Node = marker;
  while (true) {
    let sibling = siblingOf(edge);
    while (sibling) {
      const part = inlineSiblingText(sibling);
      if (part === null) return parts.join("");
      add(part);
      sibling = siblingOf(sibling);
    }
    const parent = edge.parentElement;
    if (!parent || !INLINE_TEXT_ELEMENTS.has(parent.tagName)) return parts.join("");
    edge = parent;
  }
}

/** Text contributed by one sibling; `null` means that sibling ends the inline run. */
function inlineSiblingText(node: Node): string | null {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  return INLINE_TEXT_ELEMENTS.has(element.tagName) ? (element.textContent ?? "") : null;
}

/** Remove whitespace immediately before `marker`, through inline wrappers. */
function trimInlineWhitespaceBefore(marker: Element): void {
  let edge: Node = marker;
  while (true) {
    let sibling = edge.previousSibling;
    while (sibling) {
      const result = trimInlineEnd(sibling);
      if (result === "content" || result === "boundary") return;
      sibling = sibling.previousSibling;
    }
    const parent = edge.parentElement;
    if (!parent || !INLINE_TEXT_ELEMENTS.has(parent.tagName)) return;
    edge = parent;
  }
}

/** Trim an inline subtree's end; say whether content or a flow boundary stopped us. */
function trimInlineEnd(node: Node): "content" | "empty" | "boundary" {
  if (node.nodeType === 3) {
    const text = node.textContent ?? "";
    node.textContent = text.trimEnd();
    return (node.textContent ?? "") === "" ? "empty" : "content";
  }
  if (node.nodeType !== 1) return "empty";
  const element = node as Element;
  if (!INLINE_TEXT_ELEMENTS.has(element.tagName)) return "boundary";
  for (const child of Array.from(element.childNodes).reverse()) {
    const result = trimInlineEnd(child);
    if (result !== "empty") return result;
  }
  return "empty";
}

/* ------------------------------------------------------------------ *
 * 5. The paper's authors
 * ------------------------------------------------------------------ */

/** A footnote mark set as text after a name. */
const TRAILING_MARKS = /[\s*∗†‡§¶‖]+$/u;

/** What may stand between two creators, spaces collapsed and lower-cased. A closed list: each was seen on a page. */
const BETWEEN_CREATORS: ReadonlySet<string> = new Set(["", "and", ","]);

const AUTHOR_CREATOR = "span.ltx_creator.ltx_role_author";

/** What a creator may hold beside its one personname: the notes block, and the footnote `\thanks` makes. */
const BESIDE_THE_NAME = "span.ltx_author_notes, span.ltx_note.ltx_role_thanks";

/** One person's ORCID record, and nothing else at that address. */
const ORCID_RECORD = /^https?:\/\/orcid\.org\/\d{4}-\d{4}-\d{4}-\d{3}[\dX]\/?$/u;

/** Labels an ORCID link can display instead of the person's name. */
const ORCID_LINK_LABEL = /\b(?:orcid|profile|record)\b/iu;

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
 *       span.ltx_note.ltx_role_thanks    the footnote `\thanks` makes, when it is set beside the name: not read here (`latexmlTitleBlock` hands it to a model)
 *       span.ltx_author_notes            affiliations, addresses, emails: not read here (`latexmlTitleBlock` hands them to a model)
 *     span.ltx_author_before             the space, the ", " or the " and " between them: not read
 * ```
 *
 * **Names only**, and a name is the personname's own text: an ORCID link, a
 * superscript and a footnote are left out. One link is read into: a name that
 * is itself the two-word text of a link to that person's ORCID record, the
 * logo beside it left out. This is the exact observed widening: a one-word
 * control label and four whitespace-joined name words both refuse. Any other
 * link in a personname refuses, which is what keeps a "Code" or "Dataset"
 * link marked up as a creator from being read as a person.
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
  const block = titleBlockOf(doc);
  return block ? (readCreators(block)?.map((c) => c.name) ?? null) : null;
}

/**
 * **The title block as the authors pass reads it**: the names `latexmlAuthorNames`
 * reads, and one line of text per creator — the name and everything set beside
 * it (the `\thanks` note, the affiliation and email contacts) — which is what a
 * model's affiliations are held to (src/arxiv-affiliations.ts). Read before
 * `prepareDocument`, like the names: `tidyTitleBlock` moves these nodes. `null`
 * exactly when `latexmlAuthorNames` is.
 *
 * **One projection of the page, defined here**: LaTeXML's furniture — a note's
 * repeated marks and number (only in a note whose measured shape validates),
 * and a contact's label when it is exactly one of the measured
 * `CONTACT_LABELS` — is **replaced by a space**, never just deleted. Replaced,
 * because deleting fuses the words either side:
 * `Affiliation:Department` `Affiliation:University` became `DepartmentUniversity`,
 * a word the page never printed (GPT Sol, plan review of 261009m). Taken out at
 * all, because LaTeXML splits one institution over several contacts
 * (`Affiliation: Department of Physics, Affiliation: University of Trento`), and
 * with the labels in, that institution is no run of words (2610.08392). A label
 * not in the list stays, as words: it may be the author's.
 */
export function latexmlTitleBlock(doc: Document): { names: string[]; creators: string[] } | null {
  const block = titleBlockOf(doc);
  const creators = block ? readCreators(block) : null;
  if (!creators) return null;
  return {
    names: creators.map((c) => c.name),
    creators: creators.map((c) => {
      const copy = c.creator.cloneNode(true) as Element;
      /* `NOTE_FURNITURE` is a selector, not proof. A stranger can put those
         classes on arbitrary words; deleting them would make the words on
         either side newly consecutive and let the model store a phrase the
         page never printed. `noteContent` is the tidy rewrite's structural and
         textual validation of the measured note shape. Malformed furniture
         stays as evidence, so the verifier has to account for its words. */
      const noteFurniture = Array.from(copy.querySelectorAll(".ltx_note")).flatMap((note) =>
        noteContent(note) === null ? [] : Array.from(note.querySelectorAll(NOTE_FURNITURE)),
      );
      const furniture = [
        ...noteFurniture,
        ...Array.from(copy.querySelectorAll(".ltx_contact_name")).filter(
          (label) => label.children.length === 0 && CONTACT_LABELS.has((label.textContent ?? "").trim()),
        ),
      ];
      for (const el of furniture) el.replaceWith(copy.ownerDocument.createTextNode(" "));
      /* And a space after the name and each contact and note, for the same
         reason: they are separate lines in the pop-up, whatever whitespace the
         markup has between them. */
      for (const el of Array.from(copy.querySelectorAll(".ltx_personname, .ltx_contact, .ltx_note"))) el.after(" ");
      return (copy.textContent ?? "").replace(/\s+/gu, " ").trim();
    }),
  };
}

/** The one `.ltx_authors` under the one `article.ltx_document` at a LaTeXML address, or `null`. */
function titleBlockOf(doc: Document): Element | null {
  if (!hasLatexmlSource(doc)) return null;
  const roots = doc.querySelectorAll(DOCUMENT);
  const root = roots[0];
  if (roots.length !== 1 || root === undefined) return null;
  const blocks = root.querySelectorAll(".ltx_authors");
  const block = blocks[0];
  if (blocks.length !== 1 || block === undefined || !noOwnText(block)) return null;
  return block;
}

/** One creator in the title block: its element, its one personname, the name read off it, and what is beside it. */
interface Creator {
  readonly creator: Element;
  readonly person: Element;
  readonly name: string;
  readonly beside: readonly Element[];
}

/** The creators of a title block in order, each plainly one name, or `null`: the shape documented on `latexmlAuthorNames`. */
function readCreators(block: Element): Creator[] | null {
  const creators: Creator[] = [];
  const children = Array.from(block.children);
  for (const [i, child] of children.entries()) {
    if (child.matches("span.ltx_author_before")) {
      const between = (child.textContent ?? "").replace(/\s+/gu, " ").trim().toLowerCase();
      if (
        child.children.length !== 0 ||
        !BETWEEN_CREATORS.has(between) ||
        !children[i - 1]?.matches(AUTHOR_CREATOR) ||
        !children[i + 1]?.matches(AUTHOR_CREATOR)
      ) {
        return null;
      }
      continue;
    }
    if (!child.matches(AUTHOR_CREATOR) || !noOwnText(child)) return null;
    const parts = Array.from(child.children);
    const person = parts.filter((p) => p.matches("span.ltx_personname"));
    if (person.length !== 1 || parts.some((p) => p !== person[0] && !p.matches(BESIDE_THE_NAME))) return null;
    const name = oneName(person[0] as Element);
    if (name === null) return null;
    creators.push({ creator: child, person: person[0] as Element, name, beside: parts.filter((p) => p !== person[0]) });
  }
  return creators.length > 0 ? creators : null;
}

/** The observed two-word ORCID-linked name, with at most a wordless logo beside its text. */
function isOrcidLinkedName(el: Element): boolean {
  if (!el.matches("a.ltx_ref.ltx_href") || !ORCID_RECORD.test(el.getAttribute("href") ?? "")) return false;
  if (!Array.from(el.children).every((part) => part.matches(".ltx_graphics") && (part.textContent ?? "").trim() === "")) return false;
  const linked = (el.textContent ?? "").trim().replace(/\s+/gu, " ");
  /* The one measured widening is a two-word name. Stay closed: a one-word
     control label and four whitespace-joined name words are both plausible
     text inside the same link and neither is plainly one person. */
  return linked.split(" ").length === 2 && !ORCID_LINK_LABEL.test(linked);
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

/* ------------------------------------------------------------------ *
 * 6. The title block is one row per author
 * ------------------------------------------------------------------ */

/** A note's own furniture: the mark printed twice, the `thanks:` label, the repeated number. */
const NOTE_FURNITURE = ".ltx_note_mark, .ltx_note_type, .ltx_tag_note";

/** The exact labels measured in title-block contacts. Anything more may be the author's words. */
const CONTACT_LABELS = new Set([
  "Address:",
  "Affiliation:",
  "Correspondence to:",
  "E-mail",
  "Email address:",
  "Email:",
]);

/** Elements that HTML parsing cannot leave inside the `<p>` this rewrite promises to make. */
const NOT_IN_AN_AUTHOR_ROW =
  "address, article, aside, blockquote, div, dl, fieldset, footer, form, h1, h2, h3, h4, h5, h6, header, hgroup, hr, main, nav, ol, p, pre, section, table, ul";

/** Readability 0.6.0's byline name test; a matching short node is deleted during extraction. */
const READABILITY_BYLINE = /byline|author|dateline|writtenby|p-author/iu;

/** Everything the rewrite may leave behind. Every other word in the block must come out again. */
const LEFT_BEHIND = `${NOTE_FURNITURE}, .ltx_contact_name, .ltx_author_before`;

/** Marks this rewrite writes, which the word check does not count. Removed before the swap. */
const OUR_MARK = "data-latexml-title-mark";

/** `compareDocumentPosition`: the other node comes after this one. */
const FOLLOWING = 4;

/**
 * **`div.ltx_authors` → one `<p>` per author, then each note once, numbered.**
 *
 * On arXiv each author's affiliation and email, and each `\thanks` footnote, sit
 * in a pop-up that CSS hides. Without the CSS every label, mark and pop-up is
 * text, so a reader got one paragraph: `Ashish Vaswani ††thanks: Equal
 * contribution… Noam Shazeer11footnotemark: 1 Affiliation: Google Brain Email:
 * …`. And the `ltx_*author*` classes are what Readability's byline search
 * matches: it takes the first such element under 100 characters, keeps its
 * text as the byline and **deletes it from the article** — one author's details,
 * or a whole author.
 *
 * ```
 * <div id="(the block's own)">
 *   <p>Ashish Vaswani<sup>1</sup><br>Google Brain<br>avaswani@google.com</p>
 *   <p>Aidan N. Gomez<sup>1,2</sup><br>University of Toronto<br>aidan@…</p>
 *   <p><sup>1</sup> Equal contribution. Listing order is random. …</p>
 *   <p><sup>2</sup> Work performed while at Google Brain.</p>
 * </div>
 * ```
 *
 * or, when no author has a contact or a note, one `<p>` of the names.
 *
 * **The marks are LaTeX's, renumbered.** The title's `\thanks` notes are
 * numbered in order and `\footnotemark[N]` repeats the Nth, which is how a
 * second author shares a note. LaTeXML prints the note's mark as `†` and the
 * repeat as `N`, so here each worded note is numbered by its place in the block
 * and each name carries the numbers it holds or repeats. A repeat whose Nth note
 * is not in the block (a `\thanks` on the title counts towards N) is not proved,
 * and refuses.
 *
 * **Moved, never retyped**, so a link, a formula or an id in a name, contact or
 * note goes with it. Then two checks on the result before it replaces the
 * block, either of which leaves the page as it was: the same words, as often,
 * as the block less `LEFT_BEHIND`; and every id or name in the block that a
 * link points at still there (rule 3). The shape is `readCreators`'s, plus:
 * `ltx_author_notes` holds one `ltx_author_notes_content` holding only
 * `ltx_contact`s, and a note is `ltx_role_thanks` with words or
 * `ltx_role_footnotemark` with none.
 *
 * docs/plans/261009d-arxiv-html-title-block-tidied-at-import.md.
 */
function tidyTitleBlock(doc: Document, targets: ReadonlySet<string>): boolean {
  const original = titleBlockOf(doc);
  if (!original) return false;
  const root = original.closest(DOCUMENT);
  if (!root) return false;
  const block = original.cloneNode(true) as Element;
  const creators = readCreators(block);
  if (!creators) return false;

  /* The notes. A thanks before the block (on the title) still counts towards a repeat's N. */
  const notes = Array.from(block.querySelectorAll(".ltx_note"));
  const thanks = notes.filter((n) => n.matches(".ltx_role_thanks"));
  const earlier = Array.from(root.querySelectorAll(".ltx_note.ltx_role_thanks, .ltx_pubnote.ltx_role_thanks")).filter(
    (n) => !original.contains(n) && (n.compareDocumentPosition(original) & FOLLOWING) !== 0,
  ).length;
  const contentOf = new Map<Element, Node[]>();
  const numberOf = new Map<Element, number>();
  for (const note of notes) {
    const content = noteContent(note);
    if (content === null) return false;
    const words = content.some((n) => (n.textContent ?? "").trim() !== "");
    if (note.matches(".ltx_role_thanks")) {
      if (!words) return false;
      contentOf.set(note, content);
      numberOf.set(note, thanks.indexOf(note) + 1);
    } else if (note.matches(".ltx_role_footnotemark")) {
      const tag = (note.querySelector(".ltx_tag_note")?.textContent ?? "").trim();
      const nth = /^\d+$/u.test(tag) ? Number(tag) - earlier : 0;
      if (words || nth < 1 || nth > thanks.length) return false;
      numberOf.set(note, nth);
    } else {
      return false;
    }
  }

  const rows: { name: Node[]; marks: number[]; contacts: Node[][] }[] = [];
  for (const { creator, person, beside } of creators) {
    const contacts: Node[][] = [];
    for (const part of beside) {
      if (!part.matches("span.ltx_author_notes")) continue;
      const lines = contactLines(part);
      if (lines === null) return false;
      contacts.push(...lines);
    }
    const numbers = Array.from(creator.querySelectorAll(".ltx_note")).map((n) => numberOf.get(n) ?? 0);
    const marks = [...new Set(numbers)].sort((a, b) => a - b);
    const name = trimmed(Array.from(person.childNodes).filter((n) => !isElement(n, ".ltx_note")));
    rows.push({ name, marks, contacts });
  }

  const out = doc.createElement("div");
  const id = original.getAttribute("id");
  if (id) out.setAttribute("id", id);
  const mark = (numbers: readonly number[]) => {
    const sup = doc.createElement("sup");
    sup.setAttribute(OUR_MARK, "");
    sup.textContent = numbers.join(",");
    return sup;
  };
  if (rows.every((r) => r.marks.length === 0 && r.contacts.length === 0)) {
    const p = doc.createElement("p");
    rows.forEach((r, i) => {
      if (i > 0) p.append(", ");
      p.append(...r.name);
    });
    out.append(p);
  } else {
    for (const r of rows) {
      const p = doc.createElement("p");
      p.append(...r.name);
      if (r.marks.length > 0) p.append(mark(r.marks));
      for (const line of r.contacts) p.append(doc.createElement("br"), ...line);
      out.append(p);
    }
    for (const note of thanks) {
      const p = doc.createElement("p");
      p.append(mark([numberOf.get(note) ?? 0]), " ", ...trimmed(contentOf.get(note) ?? []));
      out.append(p);
    }
  }
  /* An empty `mailto:` link goes nowhere: LaTeXML writes the address as its text only. */
  for (const a of Array.from(out.querySelectorAll('a[href="mailto:"]'))) a.replaceWith(...Array.from(a.childNodes));

  if (hasReadabilityBylineCandidate(out)) return false;
  if (wordsIn(out, `[${OUR_MARK}]`).join(" ") !== wordsIn(original, LEFT_BEHIND).join(" ")) return false;
  const kept = new Set([out, ...Array.from(out.querySelectorAll("[id], [name]"))].flatMap((el) => [el.getAttribute("id"), el.getAttribute("name")]));
  for (const el of [original, ...Array.from(original.querySelectorAll("[id], [name]"))]) {
    if (linkedNamesOf(el, targets).some((target) => !kept.has(target))) return false;
  }
  for (const sup of Array.from(out.querySelectorAll(`[${OUR_MARK}]`))) sup.removeAttribute(OUR_MARK);
  original.replaceWith(out);
  return true;
}

const isElement = (n: Node, selector: string): boolean => n.nodeType === 1 && (n as Element).matches(selector);

/** A note's words, its furniture left out — or `null` if it is not the measured shape. */
function noteContent(note: Element): Node[] | null {
  const [markEl, outer, ...more] = Array.from(note.children);
  if (more.length > 0 || !markEl?.matches("sup.ltx_note_mark") || !outer?.matches("span.ltx_note_outer") || !noOwnText(note)) return null;
  const inner = Array.from(outer.children);
  const content = inner[0];
  if (inner.length !== 1 || !content?.matches("span.ltx_note_content") || !noOwnText(outer)) return null;
  const kind = note.matches(".ltx_role_thanks")
    ? "thanks:"
    : note.matches(".ltx_role_footnotemark")
      ? "footnotemark:"
      : null;
  if (kind === null) return null;
  const marks = Array.from(note.querySelectorAll(".ltx_note_mark"));
  const types = Array.from(note.querySelectorAll(".ltx_note_type"));
  const tags = Array.from(note.querySelectorAll(".ltx_tag_note"));
  const text = (el: Element) => (el.textContent ?? "").replace(/\s+/gu, " ").trim();
  if (
    marks.length !== 2 ||
    marks.some((el) => el.children.length > 0 || !/^(?:\d+|[*∗†‡§¶‖]+)$/u.test(text(el))) ||
    text(marks[0]!) !== text(marks[1]!) ||
    types.length !== 1 ||
    types[0]!.children.length > 0 ||
    text(types[0]!).toLowerCase() !== kind ||
    (kind === "thanks:"
      ? tags.length !== 0
      : tags.length !== 1 || tags[0]!.children.length > 0 || !/^\d+$/u.test(text(tags[0]!)))
  ) {
    return null;
  }
  const kept = Array.from(content.childNodes).filter((n) => !isElement(n, NOTE_FURNITURE));
  if (kind === "footnotemark:" && kept.some((n) => n.nodeType === 1 || (n.textContent ?? "").trim() !== "")) return null;
  if (hasParagraphBreakingContent(kept)) return null;
  return kept;
}

/** Each contact's nodes, its label left out, one line each — or `null` if the notes hold anything else. */
function contactLines(notes: Element): Node[][] | null {
  const inner = Array.from(notes.children);
  const content = inner[0];
  if (inner.length !== 1 || !content?.matches("span.ltx_author_notes_content") || !noOwnText(notes) || !noOwnText(content)) return null;
  const lines: Node[][] = [];
  for (const contact of Array.from(content.children)) {
    if (!contact.matches("span.ltx_contact")) return null;
    const labels = Array.from(contact.children).filter((n) => n.matches(".ltx_contact_name"));
    const label = labels[0];
    if (
      labels.length !== 1 ||
      label !== contact.firstElementChild ||
      label.children.length > 0 ||
      !CONTACT_LABELS.has((label.textContent ?? "").replace(/\s+/gu, " ").trim())
    ) {
      return null;
    }
    const line = trimmed(Array.from(contact.childNodes).filter((n) => n !== label));
    if (hasParagraphBreakingContent(line)) return null;
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

/** Whether moving these nodes into a `<p>` would make invalid paragraph content. */
function hasParagraphBreakingContent(nodes: readonly Node[]): boolean {
  return nodes.some((node) => {
    if (node.nodeType !== 1) return false;
    const el = node as Element;
    return el.matches(NOT_IN_AN_AUTHOR_ROW) || el.querySelector(NOT_IN_AN_AUTHOR_ROW) !== null;
  });
}

/** Whether Readability would take and delete any part of the rewritten block as its byline. */
function hasReadabilityBylineCandidate(root: Element): boolean {
  return [root, ...Array.from(root.querySelectorAll("*"))].some((el) => {
    const rel = el.getAttribute("rel");
    const itemprop = el.getAttribute("itemprop");
    const named =
      rel === "author" ||
      itemprop?.includes("author") ||
      READABILITY_BYLINE.test(`${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""}`);
    const length = (el.textContent ?? "").trim().length;
    return !!named && length > 0 && length < 100;
  });
}

/** Without the whitespace-only text at either end, and the ends' own whitespace trimmed. */
function trimmed(nodes: readonly Node[]): Node[] {
  const out = [...nodes];
  const blank = (n: Node | undefined) => n !== undefined && n.nodeType === 3 && (n.textContent ?? "").trim() === "";
  while (blank(out[0])) out.shift();
  while (blank(out[out.length - 1])) out.pop();
  const first = out[0];
  const last = out[out.length - 1];
  if (first?.nodeType === 3) first.textContent = (first.textContent ?? "").replace(/^\s+/u, "");
  if (last?.nodeType === 3) last.textContent = (last.textContent ?? "").replace(/\s+$/u, "");
  return out;
}

/** The letter-and-digit runs of `el`, sorted, less what `leaveOut` matches. */
function wordsIn(el: Element, leaveOut: string): string[] {
  const copy = el.cloneNode(true) as Element;
  for (const f of Array.from(copy.querySelectorAll(leaveOut))) f.remove();
  /* A row or a line ends a word, as it does on screen; `textContent` would glue `Zhang` to `Stephen`. */
  for (const end of Array.from(copy.querySelectorAll("p, br"))) end.after(" ");
  return ((copy.textContent ?? "").match(/[\p{L}\p{N}]+/gu) ?? []).sort();
}
