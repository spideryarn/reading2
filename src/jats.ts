/**
 * **A JATS article, as a web page** — Europe PMC's full-text XML turned into
 * the HTML document stage 2 reads like any other.
 *
 * docs/plans/261018j-a-refused-paper-read-from-europe-pmc-and-a-saved-page-keeps-its-address.md
 * § Stage 1, with GPT Sol's S5, S7 and S8. The precedent is src/upload-convert.ts:
 * a format that is not a web page becomes one in stage 1, is stored as `html`,
 * and from then on is a page for Readability and the sanitiser.
 *
 * ## Built, never copied
 *
 * The XML is somebody else's, so nothing of its markup crosses: every output
 * element is one this file creates by name, its text set as text, and its
 * attributes only the ones written here (an `id` read from the XML is checked
 * against a closed character class; a link's `href` is http(s) or `#id`; a
 * picture's `src` is the open-data bucket's address built around an encoded
 * file name). MathML is rebuilt the same way, by namespace, with an attribute
 * allowlist. An element this file does not know contributes its children;
 * a few contribute nothing (`EMPTY` below).
 *
 * ## What is refused before parsing (S5)
 *
 * jsdom's XML parser expands an internal `<!ENTITY>` declaration, so a
 * document with any entity declaration or internal DTD subset is refused
 * before it is parsed — which also refuses every external entity, since one
 * must be declared. The only DOCTYPE let through is JATS's own `PUBLIC` one,
 * which two of the six measured papers carry; jsdom fetches no DTD for it.
 * Then two bounds: the number of elements parsed, and the size of the page
 * built. Each refusal is a `JatsRefused` with a fixed reason and no text from
 * the document, so the caller can log it.
 *
 * ## The head (S7)
 *
 * Readability reads the date from `article:published_time` and the site from
 * `og:site_name`, and src/meta-authors.ts and src/article-registry.ts read
 * `citation_author` (with `citation_author_institution`) and `citation_doi`.
 * So those are what the head carries, from the JATS's own front matter — not
 * from any later lookup.
 */

import { jsdom } from "./jsdom-lazy.js";

const MATHML_NS = "http://www.w3.org/1998/Math/MathML";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** How much a document may be. The six measured papers are 2,300–3,800 elements and 130–480 KB. */
export const JATS_LIMITS = { maxElements: 200_000, maxDepth: 512, maxHtmlChars: 20 * 1024 * 1024 } as const;

export type JatsRefusal = "declarations" | "parse" | "not-an-article" | "no-body" | "too-large";

/** A JATS document we will not convert. `reason` is fixed words; nothing from the document is in the message. */
export class JatsRefused extends Error {
  constructor(readonly reason: JatsRefusal) {
    super(`The JATS document was refused: ${reason}.`);
    this.name = "JatsRefused";
  }
}

/** JATS's own DOCTYPE, with a public id and a system literal and nothing between brackets. */
const JATS_DOCTYPE = /<!DOCTYPE\s+article\s+PUBLIC\s+"[^"[\]<>]*"\s+"[^"[\]<>]*"\s*>/gi;

/**
 * S5: no entity declarations, no internal subset, and no DOCTYPE but JATS's.
 * Checked on the raw text, before any parser sees it — so a declaration inside
 * a comment or CDATA is refused too, which costs nothing real.
 */
function refuseDeclarations(xml: string): void {
  if (/<!ENTITY/i.test(xml)) throw new JatsRefused("declarations");
  const doctypes = xml.match(/<!DOCTYPE/gi)?.length ?? 0;
  if (doctypes === 0) return;
  const allowed = xml.match(JATS_DOCTYPE)?.length ?? 0;
  if (doctypes !== 1 || allowed !== 1) throw new JatsRefused("declarations");
}

/** Bound both the amount of work and its nesting before the recursive converter sees it. */
function refuseOversizedTree(document: Document): void {
  const root = document.documentElement;
  const stack: { element: Element; depth: number }[] = [{ element: root, depth: 1 }];
  let elements = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    elements += 1;
    if (elements > JATS_LIMITS.maxElements || current.depth > JATS_LIMITS.maxDepth) {
      throw new JatsRefused("too-large");
    }
    for (let child = current.element.lastElementChild; child !== null; child = child.previousElementSibling) {
      stack.push({ element: child, depth: current.depth + 1 });
    }
  }
}

/** An id we will carry over: what a JATS id looks like, and nothing a selector or a URL could be bent by. */
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,80}$/;

/** Elements whose content is never shown. */
const EMPTY = new Set([
  "supplementary-material",
  "journal-meta",
  "processing-meta",
  "media",
  "alt-text",
  "object-id",
  "custom-meta-group",
  "permissions",
  "related-article",
  "counts",
  "self-uri",
  "kwd-group",
  "funding-group",
]);

/** Inline JATS → the HTML element it becomes. Anything else inline contributes its children. */
const INLINE_AS: Readonly<Record<string, string>> = {
  italic: "em",
  bold: "strong",
  sup: "sup",
  sub: "sub",
  monospace: "code",
  underline: "u",
  strike: "s",
};

/** The JATS elements that are blocks: a `<p>` cannot hold them, so a paragraph that does is split around them. */
const BLOCKS = new Set([
  "p",
  "sec",
  "list",
  "def-list",
  "disp-quote",
  "boxed-text",
  "fig",
  "fig-group",
  "table-wrap",
  "table-wrap-group",
  "disp-formula",
  "disp-formula-group",
  "preformat",
  "code",
  "statement",
  "ref-list",
  "glossary",
  "fn-group",
  "ack",
  "notes",
  "app",
  "app-group",
  "verse-group",
  "graphic",
  "array",
  "table",
  "title",
  "caption",
  "attrib",
  "speech",
  ...EMPTY,
]);

/** The presentation MathML we rebuild. Anything else in the MathML namespace contributes its children. */
const MATHML_ELEMENTS = new Set([
  "math", "mi", "mn", "mo", "ms", "mtext", "mspace", "mrow", "mfrac", "msqrt", "mroot", "mstyle",
  "merror", "mpadded", "mphantom", "mfenced", "menclose", "msub", "msup", "msubsup", "munder",
  "mover", "munderover", "mmultiscripts", "mprescripts", "none", "mtable", "mtr", "mtd",
  "mlabeledtr", "semantics", "annotation",
]);
const MATHML_ATTRIBUTES = new Set([
  "mathvariant", "display", "stretchy", "fence", "separator", "separators", "lspace", "rspace",
  "accent", "accentunder", "linethickness", "width", "height", "depth", "form", "movablelimits",
  "largeop", "symmetric", "maxsize", "minsize", "columnalign", "rowalign", "columnspan", "rowspan",
  "scriptlevel", "displaystyle", "open", "close", "notation", "encoding", "bevelled",
  "numalign", "denomalign", "columnlines", "rowlines", "frame", "columnspacing", "rowspacing", "align",
]);
/** An attribute value we carry into MathML: short, and no markup or script characters. */
const SAFE_MATHML_VALUE = /^[A-Za-z0-9 .,:#%+\-_/()]{0,64}$/;

type Ctx = {
  out: Document;
  /** `PMC4595480.1`: the directory on the open-data bucket. */
  bucketDir: string;
  /** Floats (`floats-group`) not yet placed, by id: each goes after the first paragraph citing it. */
  floats: Map<string, Element>;
  /** Every id this page will carry, so an in-page link is made only to something that is there. */
  ids: Set<string>;
};

function kids(el: Element): Element[] {
  return Array.from(el.children);
}

function child(el: Element, name: string): Element | undefined {
  return kids(el).find((c) => c.localName === name);
}

function children(el: Element, name: string): Element[] {
  return kids(el).filter((c) => c.localName === name);
}

function textOf(el: Element | undefined | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function isJats(node: Node): node is Element {
  return node.nodeType === 1 && (node as Element).namespaceURI !== MATHML_NS;
}

/** A name, given names first: `Joel Pearson`. An eastern-style name keeps its own order. */
function personName(name: Element): string {
  const surname = textOf(child(name, "surname"));
  const given = textOf(child(name, "given-names"));
  const suffix = textOf(child(name, "suffix"));
  const eastern = name.getAttribute("name-style") === "eastern";
  const whole = (eastern ? [surname, given] : [given, surname]).filter(Boolean).join(" ");
  return [whole, suffix].filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ *
 * Front matter: title, authors, date, journal, DOI
 * ------------------------------------------------------------------ */

interface Front {
  title: string;
  subtitle: string;
  authors: { name: string; affiliations: string[] }[];
  /** `YYYY-MM-DD` for `article:published_time`, when the JATS gives at least a month. */
  date: string | null;
  year: string | null;
  journal: string;
  doi: string | null;
}

/**
 * The authors. S8: a `contrib-group` whose own `content-type` says author
 * holds `contrib`s that carry no type; elsewhere a `contrib` says so itself.
 * A group or contrib that names another role (editor, reviewer) is left out.
 */
function authorsOf(meta: Element, affs: Map<string, string>): Front["authors"] {
  const out: Front["authors"] = [];
  for (const group of children(meta, "contrib-group")) {
    const groupType = group.getAttribute("content-type");
    for (const contrib of children(group, "contrib")) {
      const type = contrib.getAttribute("contrib-type") ?? groupType ?? "author";
      if (type !== "author") continue;
      const name = child(contrib, "name") ?? child(child(contrib, "name-alternatives") ?? contrib, "name");
      const shown = name ? personName(name) : textOf(child(contrib, "collab"));
      if (shown === "") continue;
      const affiliations = [
        ...children(contrib, "aff").map(affText),
        ...children(contrib, "xref")
          .filter((x) => x.getAttribute("ref-type") === "aff")
          .flatMap((x) => (x.getAttribute("rid") ?? "").split(/\s+/))
          .map((rid) => affs.get(rid) ?? ""),
      ].filter((a) => a !== "");
      out.push({ name: shown, affiliations: [...new Set(affiliations)] });
    }
  }
  return out;
}

/** An affiliation's words, without its label. */
function affText(aff: Element): string {
  const copy = aff.cloneNode(true) as Element;
  for (const label of children(copy, "label")) label.remove();
  return textOf(copy).replace(/^[,;\s]+/, "");
}

/** Every `aff` in the front matter, by id. */
function affiliations(meta: Element): Map<string, string> {
  const out = new Map<string, string>();
  for (const aff of Array.from(meta.getElementsByTagName("aff"))) {
    const id = aff.getAttribute("id");
    if (id) out.set(id, affText(aff));
  }
  return out;
}

/**
 * The publication date. S8: an electronic or print date before a collection's
 * year, which is often all a `collection` date gives.
 */
function dateOf(meta: Element): { date: string | null; year: string | null } {
  const dates = children(meta, "pub-date");
  const rank = (d: Element): number => {
    const type = d.getAttribute("pub-type") ?? d.getAttribute("date-type") ?? "";
    const format = d.getAttribute("publication-format") ?? "";
    if (type === "epub" || (type === "pub" && format === "electronic")) return 0;
    if (type === "ppub" || (type === "pub" && format === "print")) return 1;
    if (type === "" || type === "pub") return 2;
    if (type === "collection") return 4;
    return 3;
  };
  const best = [...dates].sort((a, b) => rank(a) - rank(b))[0];
  if (!best) return { date: null, year: null };
  const year = textOf(child(best, "year"));
  const month = textOf(child(best, "month"));
  const day = textOf(child(best, "day"));
  if (!/^\d{4}$/.test(year)) return { date: null, year: null };
  if (!/^\d{1,2}$/.test(month)) return { date: null, year };
  /* A month with no day is given its first: `publicationDate` (src/extract.ts)
     reads a whole day or nothing, and the year is what the reading view uses. */
  const dd = /^\d{1,2}$/.test(day) ? day.padStart(2, "0") : "01";
  return { date: `${year}-${month.padStart(2, "0")}-${dd}`, year };
}

function frontOf(article: Element): Front {
  const front = child(article, "front");
  const meta = front ? child(front, "article-meta") : undefined;
  const journalMeta = front ? child(front, "journal-meta") : undefined;
  const titleGroup = meta ? child(meta, "title-group") : undefined;
  const doi = meta
    ? children(meta, "article-id").find((id) => id.getAttribute("pub-id-type") === "doi")
    : undefined;
  const journalTitle = journalMeta
    ? textOf(journalMeta.getElementsByTagName("journal-title")[0])
    : "";
  return {
    title: textOf(titleGroup ? child(titleGroup, "article-title") : undefined),
    subtitle: textOf(titleGroup ? child(titleGroup, "subtitle") : undefined),
    authors: meta ? authorsOf(meta, affiliations(meta)) : [],
    ...(meta ? dateOf(meta) : { date: null, year: null }),
    journal: journalTitle,
    doi: doi ? textOf(doi) || null : null,
  };
}

/** `PMC4595480.1`: the XML's own `pmcid-ver` when it is this paper's, else version 1. */
function bucketDirOf(article: Element, pmcid: string): string {
  const meta = article.getElementsByTagName("article-meta")[0];
  const ver = meta
    ? textOf(children(meta, "article-id").find((id) => id.getAttribute("pub-id-type") === "pmcid-ver"))
    : "";
  return new RegExp(`^${pmcid}\\.\\d{1,4}$`).test(ver) ? ver : `${pmcid}.1`;
}

/* ------------------------------------------------------------------ *
 * The body
 * ------------------------------------------------------------------ */

function make(ctx: Ctx, tag: string, id?: string | null): HTMLElement {
  const el = ctx.out.createElement(tag);
  if (id && SAFE_ID.test(id)) {
    el.id = id;
    ctx.ids.add(id);
  }
  return el;
}

function append(parent: Node, text: string): void {
  if (text !== "") parent.appendChild(parent.ownerDocument!.createTextNode(text));
}

/** An external link's address, if it is one we would let a reader follow. */
function webHref(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function hrefOf(el: Element): string | null {
  return el.getAttributeNS(XLINK_NS, "href") ?? el.getAttribute("xlink:href") ?? el.getAttribute("href");
}

/** The bucket address of one of the paper's files. The name is one opaque, encoded path segment. */
function bucketUrl(ctx: Ctx, file: string): string {
  return `https://pmc-oa-opendata.s3.amazonaws.com/${ctx.bucketDir}/${encodeURIComponent(file)}`;
}

/** S8: the full picture (`content-type="image"`, or untyped), never the thumbnail. */
function pictureOf(el: Element): Element | null {
  const graphics = [
    ...children(el, "graphic"),
    ...children(el, "alternatives").flatMap((a) => children(a, "graphic")),
  ];
  return (
    graphics.find((g) => g.getAttribute("content-type") === "image") ??
    graphics.find((g) => !g.hasAttribute("content-type")) ??
    graphics.find((g) => g.getAttribute("content-type") !== "thumb") ??
    null
  );
}

function img(ctx: Ctx, graphic: Element, alt: string): HTMLElement | null {
  const file = hrefOf(graphic);
  if (!file || file.trim() === "") return null;
  const el = make(ctx, "img");
  el.setAttribute("src", bucketUrl(ctx, file.trim()));
  el.setAttribute("alt", alt);
  return el;
}

/**
 * **Inline content into `parent`**: text, emphasis, links, references,
 * formulas. A block met here (which `renderFlow` keeps from happening inside a
 * paragraph) contributes its text.
 */
function renderInline(ctx: Ctx, node: Node, parent: Node): void {
  if (node.nodeType === 3 || node.nodeType === 4) {
    append(parent, node.nodeValue ?? "");
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  if (el.namespaceURI === MATHML_NS) {
    const math = mathml(ctx, el);
    if (math) parent.appendChild(math);
    return;
  }
  const name = el.localName;
  if (EMPTY.has(name)) return;
  const as = INLINE_AS[name];
  if (as) {
    const out = make(ctx, as);
    for (const c of Array.from(el.childNodes)) renderInline(ctx, c, out);
    parent.appendChild(out);
    return;
  }
  switch (name) {
    case "ext-link":
    case "uri": {
      const href = webHref(hrefOf(el) ?? (name === "uri" ? el.textContent : null));
      const out = href ? make(ctx, "a") : null;
      if (out && href) out.setAttribute("href", href);
      for (const c of Array.from(el.childNodes)) renderInline(ctx, c, out ?? parent);
      if (out) parent.appendChild(out);
      return;
    }
    case "xref": {
      const rid = (el.getAttribute("rid") ?? "").split(/\s+/)[0] ?? "";
      const out = SAFE_ID.test(rid) ? make(ctx, "a") : null;
      if (out) out.setAttribute("href", `#${rid}`);
      for (const c of Array.from(el.childNodes)) renderInline(ctx, c, out ?? parent);
      if (out) parent.appendChild(out);
      return;
    }
    case "pub-id": {
      const value = textOf(el);
      if (el.getAttribute("pub-id-type") === "doi" && /^10\.\d{4,9}\/\S+$/.test(value)) {
        const out = make(ctx, "a");
        out.setAttribute("href", `https://doi.org/${encodeURI(value)}`);
        append(out, value);
        parent.appendChild(out);
      } else {
        append(parent, value);
      }
      return;
    }
    case "name":
      append(parent, personName(el));
      return;
    case "break":
      parent.appendChild(make(ctx, "br"));
      return;
    case "inline-graphic": {
      const pic = img(ctx, el, "");
      if (pic) parent.appendChild(pic);
      return;
    }
    case "inline-formula":
    case "disp-formula":
      formula(ctx, el, parent, name === "disp-formula");
      return;
    case "tex-math":
      parent.appendChild(texMath(ctx, el, false));
      return;
    case "label":
    case "title":
      for (const c of Array.from(el.childNodes)) renderInline(ctx, c, parent);
      return;
    default:
      for (const c of Array.from(el.childNodes)) renderInline(ctx, c, parent);
  }
}

/**
 * **A run of mixed content as blocks**: inline content gathered into
 * paragraphs, and a block child breaking the paragraph around it — JATS lets a
 * `<p>` hold a list or a figure, and HTML does not.
 */
function renderFlow(ctx: Ctx, nodes: Node[], parent: Node, depth: number): void {
  let para: HTMLElement | null = null;
  const flush = () => {
    if (para && (para.textContent ?? "").trim() !== "" ) parent.appendChild(para);
    else if (para?.querySelector("img, math")) parent.appendChild(para);
    para = null;
  };
  for (const node of nodes) {
    const isBlock = isJats(node) && BLOCKS.has(node.localName);
    if (!isBlock) {
      if ((node.nodeType === 3 || node.nodeType === 4) && (node.nodeValue ?? "").trim() === "" && para === null) continue;
      para ??= make(ctx, "p");
      renderInline(ctx, node, para);
      continue;
    }
    flush();
    renderBlock(ctx, node as Element, parent, depth);
  }
  flush();
}

/** One block element of the body or the back. */
function renderBlock(ctx: Ctx, el: Element, parent: Node, depth: number): void {
  const name = el.localName;
  if (EMPTY.has(name)) return;
  switch (name) {
    case "p": {
      const before = parent.childNodes.length;
      renderFlow(ctx, Array.from(el.childNodes), parent, depth);
      /* The paragraph's own id, on the first paragraph it became. */
      const first = parent.childNodes[before] as Element | undefined;
      const id = el.getAttribute("id");
      if (first?.localName === "p" && id && SAFE_ID.test(id) && !first.id) {
        first.id = id;
        ctx.ids.add(id);
      }
      placeFloats(ctx, el, parent, depth);
      return;
    }
    case "sec":
    case "ack":
    case "notes":
    case "app":
    case "glossary":
    case "boxed-text":
      /* A box is a `section` too, not an `aside`: Readability drops asides, and a box is the article's own words. */
      section(ctx, el, parent, depth);
      return;
    case "app-group":
    case "fig-group":
    case "table-wrap-group":
    case "disp-formula-group":
    case "verse-group":
    case "speech":
    case "statement":
      renderFlow(ctx, Array.from(el.childNodes).filter((n) => !(isJats(n) && (n.localName === "title" || n.localName === "label"))), parent, depth);
      return;
    case "title":
      return;
    case "caption":
    case "attrib":
      renderFlow(ctx, Array.from(el.childNodes), parent, depth);
      return;
    case "list":
      parent.appendChild(list(ctx, el, depth));
      return;
    case "def-list":
      parent.appendChild(defList(ctx, el, depth));
      return;
    case "disp-quote": {
      const quote = make(ctx, "blockquote", el.getAttribute("id"));
      renderFlow(ctx, Array.from(el.childNodes), quote, depth);
      parent.appendChild(quote);
      return;
    }
    case "fig":
      parent.appendChild(figure(ctx, el));
      return;
    case "table-wrap":
      parent.appendChild(tableWrap(ctx, el, depth));
      return;
    case "graphic": {
      const pic = img(ctx, el, "");
      if (pic) {
        const fig = make(ctx, "figure", el.getAttribute("id"));
        fig.appendChild(pic);
        parent.appendChild(fig);
      }
      return;
    }
    case "disp-formula": {
      const p = make(ctx, "p", el.getAttribute("id"));
      formula(ctx, el, p, true);
      parent.appendChild(p);
      return;
    }
    case "preformat":
    case "code": {
      const pre = make(ctx, "pre", el.getAttribute("id"));
      append(pre, el.textContent ?? "");
      parent.appendChild(pre);
      return;
    }
    case "table": {
      parent.appendChild(table(ctx, el, depth));
      return;
    }
    case "array": {
      const t = child(el, "table") ?? child(el, "tbody");
      if (t) parent.appendChild(table(ctx, t, depth));
      return;
    }
    case "ref-list":
      refList(ctx, el, parent, depth);
      return;
    case "fn-group":
      fnGroup(ctx, el, parent, depth);
      return;
    default:
      renderFlow(ctx, Array.from(el.childNodes), parent, depth);
  }
}

function heading(ctx: Ctx, depth: number, el: Element): HTMLElement | null {
  /* A box keeps its title in its caption. */
  const caption = child(el, "caption");
  const title = child(el, "title") ?? (caption ? child(caption, "title") : undefined);
  const label = textOf(child(el, "label"));
  if (!title && label === "") return null;
  const h = make(ctx, `h${Math.min(6, Math.max(2, depth + 1))}`);
  if (label !== "") append(h, `${label} `);
  if (title) for (const c of Array.from(title.childNodes)) renderInline(ctx, c, h);
  return (h.textContent ?? "").trim() === "" ? null : h;
}

const DEFAULT_TITLES: Readonly<Record<string, string>> = {
  ack: "Acknowledgments",
  glossary: "Glossary",
  notes: "Notes",
};

function section(ctx: Ctx, el: Element, parent: Node, depth: number): void {
  const out = make(ctx, "section", el.getAttribute("id"));
  const h = heading(ctx, depth, el);
  if (h) out.appendChild(h);
  else if (DEFAULT_TITLES[el.localName]) {
    const fallback = make(ctx, `h${Math.min(6, depth + 1)}`);
    append(fallback, DEFAULT_TITLES[el.localName] ?? "");
    out.appendChild(fallback);
  }
  renderFlow(
    ctx,
    Array.from(el.childNodes).filter((n) => !(isJats(n) && (n.localName === "title" || n.localName === "label"))),
    out,
    /* A section with no title of its own does not push its children a level down. */
    out.firstElementChild !== null && /^h[1-6]$/.test(out.firstElementChild.localName) ? depth + 1 : depth,
  );
  /* A section with nothing in it but its heading — supplementary files, which
     are not carried — is left out rather than shown as a title over nothing. */
  if (Array.from(out.children).some((c) => !/^h[1-6]$/.test(c.localName))) parent.appendChild(out);
}

function list(ctx: Ctx, el: Element, depth: number): HTMLElement {
  const type = el.getAttribute("list-type") ?? "";
  const ordered = /^(order|alpha|roman)/.test(type);
  const out = make(ctx, ordered ? "ol" : "ul", el.getAttribute("id"));
  for (const item of children(el, "list-item")) {
    const li = make(ctx, "li", item.getAttribute("id"));
    renderFlow(ctx, Array.from(item.childNodes).filter((n) => !(isJats(n) && n.localName === "label")), li, depth);
    out.appendChild(li);
  }
  return out;
}

function defList(ctx: Ctx, el: Element, depth: number): HTMLElement {
  const out = make(ctx, "dl", el.getAttribute("id"));
  for (const item of children(el, "def-item")) {
    const dt = make(ctx, "dt", item.getAttribute("id"));
    for (const term of children(item, "term")) for (const c of Array.from(term.childNodes)) renderInline(ctx, c, dt);
    out.appendChild(dt);
    for (const def of children(item, "def")) {
      const dd = make(ctx, "dd");
      renderFlow(ctx, Array.from(def.childNodes), dd, depth);
      out.appendChild(dd);
    }
  }
  return out;
}

/** A caption's label and content, as a figure's `figcaption` or a table's `caption`. */
function captionInto(ctx: Ctx, el: Element, out: HTMLElement, depth: number): void {
  const label = textOf(child(el, "label"));
  if (label !== "") {
    const strong = make(ctx, "strong");
    append(strong, label);
    out.appendChild(strong);
    append(out, " ");
  }
  const caption = child(el, "caption");
  if (!caption) return;
  const title = child(caption, "title");
  if (title) {
    const b = make(ctx, "strong");
    for (const c of Array.from(title.childNodes)) renderInline(ctx, c, b);
    out.appendChild(b);
    append(out, " ");
  }
  renderFlow(ctx, Array.from(caption.childNodes).filter((n) => !(isJats(n) && n.localName === "title")), out, depth);
}

function figure(ctx: Ctx, el: Element): HTMLElement {
  const out = make(ctx, "figure", el.getAttribute("id"));
  const pic = pictureOf(el);
  const label = textOf(child(el, "label"));
  const picture = pic ? img(ctx, pic, label) : null;
  if (picture) out.appendChild(picture);
  const caption = make(ctx, "figcaption");
  captionInto(ctx, el, caption, 0);
  if ((caption.textContent ?? "").trim() !== "") out.appendChild(caption);
  return out;
}

/** S8: a `table-wrap` holding only a picture of the table is drawn as a figure. */
function tableWrap(ctx: Ctx, el: Element, depth: number): HTMLElement {
  const t = child(el, "table") ?? children(el, "alternatives").flatMap((a) => children(a, "table"))[0];
  if (!t) return figure(ctx, el);
  const out = table(ctx, t, depth, el.getAttribute("id"));
  const caption = make(ctx, "caption");
  captionInto(ctx, el, caption, depth);
  if ((caption.textContent ?? "").trim() !== "") out.insertBefore(caption, out.firstChild);
  const foot = child(el, "table-wrap-foot");
  if (!foot) return out;
  const wrapper = make(ctx, "div");
  wrapper.appendChild(out);
  renderFlow(ctx, Array.from(foot.childNodes), wrapper, depth);
  return wrapper;
}

/** A table, rebuilt cell by cell: rows, header and data cells, and their spans. */
function table(ctx: Ctx, el: Element, depth: number, id?: string | null): HTMLElement {
  const out = make(ctx, "table", id ?? el.getAttribute("id"));
  const rowsInto = (from: Element, to: Node) => {
    for (const tr of children(from, "tr")) {
      const row = make(ctx, "tr");
      for (const cell of kids(tr).filter((c) => c.localName === "th" || c.localName === "td")) {
        const out = make(ctx, cell.localName);
        for (const span of ["colspan", "rowspan"]) {
          const value = cell.getAttribute(span);
          if (value && /^[1-9]\d{0,2}$/.test(value)) out.setAttribute(span, value);
        }
        const blocks = kids(cell).some((c) => isJats(c) && BLOCKS.has(c.localName));
        if (blocks) renderFlow(ctx, Array.from(cell.childNodes), out, depth);
        else for (const c of Array.from(cell.childNodes)) renderInline(ctx, c, out);
        row.appendChild(out);
      }
      to.appendChild(row);
    }
  };
  for (const part of kids(el)) {
    if (part.localName === "thead" || part.localName === "tbody" || part.localName === "tfoot") {
      const section = make(ctx, part.localName);
      rowsInto(part, section);
      out.appendChild(section);
    }
  }
  if (children(el, "tr").length > 0) {
    const body = make(ctx, "tbody");
    rowsInto(el, body);
    out.appendChild(body);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Maths
 * ------------------------------------------------------------------ */

/** S8: bare MathML rebuilt by namespace, its attributes from the allowlist. `null` for nothing drawable. */
function mathml(ctx: Ctx, el: Element): Element | null {
  const build = (from: Element): Node[] => {
    const name = from.localName;
    if (name === "annotation-xml") return [];
    if (name === "annotation" && !/^application\/x-tex$/i.test(from.getAttribute("encoding") ?? "")) return [];
    const inner = (): Node[] =>
      Array.from(from.childNodes).flatMap((c): Node[] =>
        c.nodeType === 1 && (c as Element).namespaceURI === MATHML_NS
          ? build(c as Element)
          : c.nodeType === 3 || c.nodeType === 4
            ? [ctx.out.createTextNode(c.nodeValue ?? "")]
            : [],
      );
    if (!MATHML_ELEMENTS.has(name)) return inner();
    const out = ctx.out.createElementNS(MATHML_NS, name);
    for (const attr of Array.from(from.attributes)) {
      if (attr.namespaceURI !== null) continue;
      if (MATHML_ATTRIBUTES.has(attr.localName) && SAFE_MATHML_VALUE.test(attr.value)) {
        out.setAttribute(attr.localName, attr.value);
      }
    }
    for (const c of inner()) out.appendChild(c);
    return [out];
  };
  const built = build(el);
  const root = built[0];
  if (root?.nodeType !== 1) return null;
  if ((root as Element).localName === "math") return root as Element;
  const math = ctx.out.createElementNS(MATHML_NS, "math");
  for (const n of built) math.appendChild(n);
  return math;
}

/**
 * A `tex-math`'s TeX, without the LaTeX document JATS often wraps it in
 * (`\documentclass…\begin{document}$…$\end{document}`) or its own `$` signs.
 */
function texSource(el: Element): string {
  let tex = el.textContent ?? "";
  const body = /\\begin\{document\}([\s\S]*?)\\end\{document\}/.exec(tex);
  if (body?.[1] !== undefined) tex = body[1];
  tex = tex.trim();
  const dollars = /^\$\$([\s\S]*)\$\$$/.exec(tex) ?? /^\$([\s\S]*)\$$/.exec(tex) ?? /^\\\[([\s\S]*)\\\]$/.exec(tex);
  return (dollars?.[1] ?? tex).trim();
}

/** A formula as `<math>` carrying its TeX: what src/maths-import.ts turns into delimited TeX. */
function texMath(ctx: Ctx, tex: Element, display: boolean, rendered?: Element | null): Element {
  const math = ctx.out.createElementNS(MATHML_NS, "math");
  if (display) math.setAttribute("display", "block");
  const semantics = ctx.out.createElementNS(MATHML_NS, "semantics");
  const row = ctx.out.createElementNS(MATHML_NS, "mrow");
  if (rendered) for (const c of Array.from(rendered.childNodes)) row.appendChild(c);
  semantics.appendChild(row);
  const annotation = ctx.out.createElementNS(MATHML_NS, "annotation");
  annotation.setAttribute("encoding", "application/x-tex");
  annotation.appendChild(ctx.out.createTextNode(texSource(tex)));
  semantics.appendChild(annotation);
  math.appendChild(semantics);
  return math;
}

/** An `inline-formula` or `disp-formula`: its MathML, its TeX, or both; and a display formula's number after it. */
function formula(ctx: Ctx, el: Element, parent: Node, display: boolean): void {
  const holders = [el, ...children(el, "alternatives")];
  const mml = holders.flatMap((h) => kids(h).filter((c) => c.namespaceURI === MATHML_NS && c.localName === "math"))[0];
  const tex = holders.flatMap((h) => children(h, "tex-math"))[0];
  const rendered = mml ? mathml(ctx, mml) : null;
  if (rendered && display) rendered.setAttribute("display", "block");
  const math = tex ? texMath(ctx, tex, display, rendered) : rendered;
  if (math) parent.appendChild(math);
  else {
    const pic = pictureOf(el);
    const shown = pic ? img(ctx, pic, "") : null;
    if (shown) parent.appendChild(shown);
  }
  const label = textOf(child(el, "label"));
  if (label !== "") append(parent, ` ${label}`);
}

/* ------------------------------------------------------------------ *
 * References and notes
 * ------------------------------------------------------------------ */

/** S8: each reference list once, where it stands — in a body section for four of the six papers. */
function refList(ctx: Ctx, el: Element, parent: Node, depth: number): void {
  const out = make(ctx, "section", el.getAttribute("id"));
  const h = heading(ctx, depth, el);
  if (h) out.appendChild(h);
  else if (depth <= 1) {
    const fallback = make(ctx, "h2");
    append(fallback, "References");
    out.appendChild(fallback);
  }
  const refs = children(el, "ref");
  if (refs.length > 0) {
    const ol = make(ctx, "ol");
    for (const ref of refs) ol.appendChild(reference(ctx, ref));
    out.appendChild(ol);
  }
  for (const nested of children(el, "ref-list")) refList(ctx, nested, out, depth + 1);
  for (const p of children(el, "p")) renderBlock(ctx, p, out, depth);
  parent.appendChild(out);
}

function reference(ctx: Ctx, ref: Element): HTMLElement {
  const li = make(ctx, "li", ref.getAttribute("id"));
  const citations = kids(ref).filter((c) => c.localName === "mixed-citation" || c.localName === "element-citation" || c.localName === "citation");
  const first = citations[0];
  if (!first) {
    for (const c of Array.from(ref.childNodes)) if (!(isJats(c) && c.localName === "label")) renderInline(ctx, c, li);
  } else if (first.localName === "element-citation") {
    elementCitation(ctx, first, li);
  } else {
    for (const c of Array.from(first.childNodes)) renderInline(ctx, c, li);
  }
  /* Whitespace as the XML spelled it, tidied: a mixed citation's runs of newlines are not the reader's. */
  for (const text of Array.from(li.childNodes).filter((n) => n.nodeType === 3)) {
    text.nodeValue = (text.nodeValue ?? "").replace(/\s+/g, " ");
  }
  return li;
}

/**
 * An `element-citation`, which is the reference's parts with no punctuation
 * between them: written out here as authors, year, title, source, volume,
 * pages and DOI.
 */
function elementCitation(ctx: Ctx, cite: Element, li: HTMLElement): void {
  const pieces: (string | Node)[] = [];
  const people = children(cite, "person-group");
  const names = (group: Element) =>
    kids(group)
      .map((p) => (p.localName === "name" ? personName(p) : p.localName === "etal" ? "et al." : p.localName === "collab" ? textOf(p) : ""))
      .filter(Boolean)
      .join(", ");
  const authors = people.length > 0 ? people.map(names).filter(Boolean).join("; ") : kids(cite).filter((c) => c.localName === "name" || c.localName === "collab").map((c) => (c.localName === "name" ? personName(c) : textOf(c))).join(", ");
  if (authors) pieces.push(authors);
  const year = textOf(child(cite, "year"));
  if (year) pieces.push(`(${year})`);
  for (const tag of ["article-title", "chapter-title"]) {
    const t = textOf(child(cite, tag));
    if (t) pieces.push(t);
  }
  const source = child(cite, "source");
  if (source) {
    const em = make(ctx, "em");
    append(em, textOf(source));
    pieces.push(em);
  }
  const volume = textOf(child(cite, "volume"));
  const issue = textOf(child(cite, "issue"));
  if (volume || issue) pieces.push(`${volume}${issue ? `(${issue})` : ""}`);
  const fpage = textOf(child(cite, "fpage"));
  const lpage = textOf(child(cite, "lpage"));
  const elocation = textOf(child(cite, "elocation-id"));
  if (fpage) pieces.push(lpage ? `${fpage}–${lpage}` : fpage);
  else if (elocation) pieces.push(elocation);
  const comment = textOf(child(cite, "comment"));
  if (comment) pieces.push(comment);
  for (const [i, piece] of pieces.entries()) {
    if (typeof piece === "string") append(li, piece);
    else li.appendChild(piece);
    append(li, i === pieces.length - 1 ? "." : ". ");
  }
  for (const id of children(cite, "pub-id")) {
    if (id.getAttribute("pub-id-type") !== "doi") continue;
    append(li, " ");
    renderInline(ctx, id, li);
  }
  for (const link of children(cite, "ext-link")) {
    append(li, " ");
    renderInline(ctx, link, li);
  }
}

function fnGroup(ctx: Ctx, el: Element, parent: Node, depth: number): void {
  const out = make(ctx, "section", el.getAttribute("id"));
  const h = heading(ctx, depth, el);
  if (h) out.appendChild(h);
  else {
    const fallback = make(ctx, `h${Math.min(6, depth + 1)}`);
    append(fallback, "Notes");
    out.appendChild(fallback);
  }
  const ol = make(ctx, "ol");
  for (const fn of children(el, "fn")) {
    const li = make(ctx, "li", fn.getAttribute("id"));
    renderFlow(ctx, Array.from(fn.childNodes).filter((n) => !(isJats(n) && n.localName === "label")), li, depth);
    ol.appendChild(li);
  }
  if (ol.childNodes.length > 0) out.appendChild(ol);
  parent.appendChild(out);
}

/* ------------------------------------------------------------------ *
 * Floats
 * ------------------------------------------------------------------ */

/**
 * A `floats-group`'s figures and tables, each placed after the first paragraph
 * that cites it — where a reader of the journal's own page would meet it.
 */
function placeFloats(ctx: Ctx, p: Element, parent: Node, depth: number): void {
  if (ctx.floats.size === 0) return;
  for (const xref of Array.from(p.getElementsByTagName("xref"))) {
    for (const rid of (xref.getAttribute("rid") ?? "").split(/\s+/)) {
      const float = ctx.floats.get(rid);
      if (!float) continue;
      ctx.floats.delete(rid);
      renderBlock(ctx, float, parent, depth);
    }
  }
}

/* ------------------------------------------------------------------ *
 * The whole document
 * ------------------------------------------------------------------ */

function meta(ctx: Ctx, head: HTMLElement, attr: "name" | "property", key: string, content: string): void {
  if (content === "") return;
  const m = ctx.out.createElement("meta");
  m.setAttribute(attr, key);
  m.setAttribute("content", content);
  head.appendChild(m);
}

/**
 * **The page for one JATS article**: a whole HTML document as a string. Pure,
 * apart from the parser. Throws `JatsRefused` for anything it will not
 * convert: declarations (S5), malformed XML, a root that is not `article`, a
 * body with no text, or a document past `JATS_LIMITS`.
 *
 * `pmcid` names the directory on PMC's open-data bucket the figures are in.
 */
export function jatsToHtml(xml: string, pmcid: string): string {
  refuseDeclarations(xml);
  const { JSDOM, VirtualConsole } = jsdom();
  let source: Document;
  try {
    source = new JSDOM(xml, { contentType: "application/xml", virtualConsole: new VirtualConsole() }).window.document;
  } catch {
    throw new JatsRefused("parse");
  }
  refuseOversizedTree(source);
  const article = source.documentElement;
  if (article.localName !== "article" || article.namespaceURI !== null) throw new JatsRefused("not-an-article");
  const body = child(article, "body");
  if (!body || textOf(body) === "") throw new JatsRefused("no-body");

  const out = new JSDOM("<!doctype html><html><head></head><body></body></html>").window.document;
  const ctx: Ctx = { out, bucketDir: bucketDirOf(article, pmcid), floats: new Map(), ids: new Set() };
  const floatsGroup = child(article, "floats-group");
  for (const float of floatsGroup ? kids(floatsGroup) : []) {
    const id = float.getAttribute("id");
    if (id) ctx.floats.set(id, float);
  }

  const front = frontOf(article);
  const head = out.head;
  const charset = out.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  head.appendChild(charset);
  const title = out.createElement("title");
  title.textContent = front.title;
  head.appendChild(title);
  meta(ctx, head, "name", "citation_title", front.title);
  for (const author of front.authors) {
    meta(ctx, head, "name", "citation_author", author.name);
    for (const aff of author.affiliations) meta(ctx, head, "name", "citation_author_institution", aff);
  }
  meta(ctx, head, "name", "citation_doi", front.doi ?? "");
  meta(ctx, head, "name", "citation_journal_title", front.journal);
  meta(ctx, head, "name", "citation_publication_date", front.date ?? front.year ?? "");
  meta(ctx, head, "property", "og:site_name", front.journal);
  meta(ctx, head, "property", "article:published_time", front.date ?? "");

  const page = make(ctx, "article");
  const h1 = make(ctx, "h1");
  const titleGroup = article.getElementsByTagName("title-group")[0];
  const articleTitle = titleGroup ? child(titleGroup, "article-title") : undefined;
  if (articleTitle) for (const c of Array.from(articleTitle.childNodes)) renderInline(ctx, c, h1);
  page.appendChild(h1);
  if (front.subtitle !== "") {
    const sub = make(ctx, "p");
    append(sub, front.subtitle);
    page.appendChild(sub);
  }
  if (front.authors.length > 0) {
    const byline = make(ctx, "p");
    append(byline, front.authors.map((a) => a.name).join(", "));
    page.appendChild(byline);
  }

  const articleMeta = article.getElementsByTagName("article-meta")[0];
  const abstracts = articleMeta ? children(articleMeta, "abstract") : [];
  /* A teaser repeats the abstract in a sentence; it is shown only when it is all there is. */
  const shown = abstracts.filter((a) => !["teaser", "web-summary"].includes(a.getAttribute("abstract-type") ?? ""));
  for (const abstract of shown.length > 0 ? shown : abstracts) {
    const sec = make(ctx, "section", abstract.getAttribute("id"));
    const h = heading(ctx, 1, abstract);
    if (h) sec.appendChild(h);
    else {
      const fallback = make(ctx, "h2");
      append(fallback, "Abstract");
      sec.appendChild(fallback);
    }
    renderFlow(ctx, Array.from(abstract.childNodes).filter((n) => !(isJats(n) && n.localName === "title")), sec, 2);
    page.appendChild(sec);
  }

  renderFlow(ctx, Array.from(body.childNodes), page, 1);
  /* Floats no paragraph cited, at the end of the body rather than nowhere. */
  for (const float of [...ctx.floats.values()]) renderBlock(ctx, float, page, 1);
  ctx.floats.clear();

  const back = child(article, "back");
  if (back) renderFlow(ctx, Array.from(back.childNodes), page, 1);

  out.body.appendChild(page);
  /* An in-page link to an id the page does not carry (an affiliation, a
     supplementary file) is unwrapped to its text rather than left pointing nowhere. */
  for (const a of Array.from(out.querySelectorAll('a[href^="#"]'))) {
    if (ctx.ids.has((a.getAttribute("href") ?? "").slice(1))) continue;
    a.replaceWith(...Array.from(a.childNodes));
  }
  const html = `<!doctype html>\n${out.documentElement.outerHTML}`;
  if (html.length > JATS_LIMITS.maxHtmlChars) throw new JatsRefused("too-large");
  return html;
}
