/**
 * **A cited work's text, from its address** — or the reason there is none.
 *
 *   readPaperText("https://arxiv.org/abs/1706.03762")
 *     → { kind: "read", format: "pdf", text: "Attention Is All You Need …", … }
 *
 * Two callers: the support check in Bibliography (plan 260929g, which reads
 * the paper to see whether it says what the article cites it for) and fb5h's
 * canonical link for an upload, which wants the scholarly meta tags. Both are
 * in a request path with a reader waiting, so this is one attempt, one
 * deadline, and at most one extra hop.
 *
 * ## What it does, in order
 *
 * 1. An arXiv `abs/` page is rewritten to its `pdf/` address before anything is
 *    fetched — the abstract page is a landing page, and the PDF is the paper.
 * 2. **Every request goes through `fetchDocument`** (src/fetch.ts), never a bare
 *    `fetch`: the address is a stranger's choice (an article's reference list,
 *    or a web search), so the scheme check, the private-address guard, the
 *    redirect limit, the size cap and the type sniff are the whole reason this
 *    is safe to run. src/chat-tools.ts § `readWebPage` is the precedent.
 * 3. A PDF is read from its **free text layer** (src/pdf.ts § `pass0`) — no
 *    model. A scan with no text is *unreadable*, stated as such.
 * 4. An HTML page has its scholarly meta tags read first (Google Scholar's
 *    `citation_*` convention, plus Dublin Core and PRISM for the DOI). If it
 *    names a `citation_pdf_url`, that is fetched **once**, through the same
 *    guard, and its text layer preferred; if that fails the page's own
 *    Readability text is used instead. No further hops, whatever the PDF's
 *    page says.
 *
 * ## The text is the paper's, not ours
 *
 * Whitespace is normalised and a word broken across a PDF line (`infor-` /
 * `mation`) is mended, and nothing else is changed: the caller checks a
 * model's quotations against this string with src/quote-match.ts, so every
 * word in it must be one the paper printed. Running headers and footers that
 * repeat on three or more pages are dropped, because `pass0` has already found
 * them and they are not prose.
 *
 * ## What is logged
 *
 * Host, kind, format, words, milliseconds and a failure code — never the URL
 * (a query string can carry anything), never the title, never a word of the
 * text. docs/project/logging.md.
 */
import { Readability } from "@mozilla/readability";

import { FetchFailure, type FetchedDocument, type FetchFailureCode, type FetchOptions, fetchDocument } from "./fetch.js";
import { jsdom } from "./jsdom-lazy.js";
import { log, since } from "./log.js";
import type { PaperUnreadableReason } from "./messages.js";
import { arxivIdOf } from "./paper-sources.js";
import {
  baselineFor,
  pageLines,
  pass0,
  pdfUnreadableReason,
  SCAN_WORDS_PER_PAGE,
  TooManyCharacters,
  TooManyPages,
  TooManyTextItems,
} from "./pdf.js";
import { hostOf } from "./urls.js";

export type { PaperUnreadableReason } from "./messages.js";
export { paperUnreadableSentence } from "./messages.js";

/** The scholarly meta tags an HTML page declared about itself. Every field is the page's claim, unchecked. */
export interface PaperMeta {
  /** Bare, lower-cased: `10.1038/nature14539`, never a `doi.org` URL. */
  doi?: string;
  title?: string;
  /** In the page's order, as the page spelled them. */
  authors?: string[];
  /** Absolute, http(s) only. */
  pdfUrl?: string;
}

/**
 * One page of a PDF's text layer, **as printed**: its lines in order, running
 * headers and footers removed, and nothing else changed — a word broken at a
 * line end is still broken here. src/paper-evidence.ts builds its canonical
 * text from these, because a heading is only recognisable as a line of its own
 * and a word broken across a page is only mendable with both pages in hand
 * (plan 261001a, GPT Sol's P-9).
 */
export interface PaperPage {
  /** 1-based, the PDF's own page index. */
  page: number;
  lines: string[];
  /**
   * **Page 1 only: its lines with the running headers and footers kept.** A
   * conference template repeats the paper's title as a running header, so
   * `pass0` calls it furniture and `lines` loses the title from the top of
   * page 1 too. The identity check (src/paper-evidence.ts § confirmIdentity)
   * reads these; everything chunked, sent, hashed or searched reads `lines`.
   */
  linesWithFurniture?: string[];
}

export type PaperText =
  | {
      kind: "read";
      /** Where the text came from, after redirects — the PDF's address when the PDF was used. */
      url: string;
      host: string;
      format: "html" | "pdf";
      text: string;
      words: number;
      /** The page's `citation_title`, else Readability's title. Absent for a bare PDF: its metadata title is too often a filename. */
      title?: string;
      /** From the HTML page, when there was one — kept when its `citation_pdf_url` supplied the text. */
      meta?: PaperMeta;
      /** The PDF's pages and lines (`PaperPage`), whenever `format` is `pdf`. */
      pages?: PaperPage[];
    }
  | {
      kind: "unreadable";
      /** The furthest address we got to. */
      url: string;
      host: string;
      why: PaperUnreadableReason;
      /** For logs and developers, never for the reader: `fetchDocument`'s code, or the page count. */
      detail?: string;
    };

/**
 * **An HTML page and no PDF behind it**, returned only to a caller that asked
 * for `pdfOnly`. The page may be the full text, an abstract, a landing page or
 * a paywall notice, and nothing here can tell which (plan 261001a, Sol P-3) —
 * so it is said, rather than read.
 */
export interface PaperNotPdf {
  kind: "not-pdf";
  url: string;
  host: string;
  meta?: PaperMeta;
}

export interface ReadPaperOptions {
  /** The caller's cancellation. A cancelled read comes back `unreadable: "timeout"`. */
  signal?: AbortSignal;
  /** One deadline for the whole read, both fetches and the PDF parse. */
  timeoutMs?: number;
  /** Test seams, handed straight to `fetchDocument` — so a test needs no network and no DNS. */
  fetch?: Pick<FetchOptions, "fetchImpl" | "resolve" | "now">;
  /**
   * **Only a PDF's text layer counts.** An HTML page whose `citation_pdf_url`
   * is absent comes back `not-pdf` instead of as Readability's text, and one
   * whose PDF link failed comes back as that failure. The overloads on
   * `readPaperText` make `not-pdf` reachable only from here.
   */
  pdfOnly?: boolean;
}

/** A paper's PDF, not a book's. 15 MB covers a figure-heavy paper; the fetcher's own default is 50 MB. */
export const PAPER_MAX_BYTES = 15 * 1024 * 1024;
/** Over this many pages it is a thesis or a book, and reading it costs `pass0` seconds a reader is waiting through. */
export const PAPER_MAX_PAGES = 150;
export const PAPER_TIMEOUT_MS = 25_000;
/**
 * Characters of text layer read before giving up — the bound on what `pass0`
 * holds in memory, beside the bytes and pages ones. About 60,000 words: past
 * that it is a book, not a paper. Plan 261001a stage 2, Sol P-5.
 */
export const PAPER_MAX_CHARS = 400_000;
/** Empty positioned runs consume memory without advancing the character cap. */
export const PAPER_MAX_TEXT_ITEMS = 200_000;

/**
 * The first path segment of a page *about* an arXiv paper: arXiv's own abstract
 * page (`/abs/`), alphaXiv's (`/abs/`, `/overview/`) and Hugging Face's
 * (`/papers/`). See `arxivPdfUrl`.
 */
const ABOUT_A_PAPER: ReadonlySet<string> = new Set(["abs", "overview", "papers"]);

/**
 * A page about an arXiv paper → the paper's PDF. `null` for anything else.
 *
 * Both id shapes (`1706.03762`, `hep-th/9901001`), with or without a version,
 * which is kept: a citation to `v1` is a citation to what `v1` says.
 *
 * **Which paper is the registry's answer** (src/paper-sources.ts § `arxivIdOf`),
 * so the pages about a paper on Hugging Face and alphaXiv are read from arXiv's
 * PDF as arXiv's own abstract page is
 * (docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md
 * § The arXiv mirrors are arXiv). Until 2026-10-06 this had a parser of its own.
 *
 * **Only a page about the paper is rewritten**, which is what this did before:
 * `arxivIdOf` also knows arXiv's `/pdf/`, `/html/` and `/format/` addresses and
 * its DOI, and each of those is still `null` here and fetched as itself. A PDF
 * or an HTML rendering is the paper already, and the callers that hold a DOI
 * read its landing page for the identity it declares (src/paper-evidence.ts).
 */
export function arxivPdfUrl(url: string): string | null {
  const id = arxivIdOf(url);
  if (id === null) return null;
  const first = new URL(url).pathname.split("/")[1]?.toLowerCase() ?? "";
  return ABOUT_A_PAPER.has(first) ? `https://arxiv.org/pdf/${id.versionedId}` : null;
}

/** Which of our reasons a fetch failure is. Total over `FetchFailureCode`, so a new code is a red compile. */
function reasonFor(code: FetchFailureCode): PaperUnreadableReason {
  switch (code) {
    case "invalid-url":
    case "unsupported-scheme":
      return "invalid-url";
    case "blocked-address":
      return "blocked";
    case "unauthorized":
    case "forbidden":
    case "rate-limited":
    /* A redirect loop from a publisher is nearly always a cookie or login wall
       turning us away, not a broken site. */
    case "too-many-redirects":
      return "refused";
    case "not-found":
      return "not-found";
    case "server-error":
    case "http-error":
      return "site-error";
    case "dns":
    case "connection":
    case "certificate":
      return "network";
    case "timeout":
      return "timeout";
    case "too-large":
      return "too-large";
    case "unsupported-type":
      return "not-a-document";
    case "empty":
      return "paywall-or-empty";
    default: {
      const never: never = code;
      return never;
    }
  }
}

/** Why a PDF gave us no text, as an `unreadable` without its url and host. */
type PdfOutcome =
  | { ok: true; text: string; words: number; pages: PaperPage[] }
  | { ok: false; why: PaperUnreadableReason; detail?: string };

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Whitespace only. Spaces and tabs (and no-break spaces) collapse to one space,
 * every line is trimmed, and a run of blank lines becomes one — so paragraphs
 * survive and nothing a quotation could contain is changed.
 */
export function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The text layer, one paragraph per page.
 *
 * `baselineFor` rather than the raw page text: it is `pass0`'s page with the
 * running headers and footers removed and line-break hyphens mended, which is
 * exactly the cleaning wanted here and already argued for in src/pdf.ts. Lines
 * are joined with a space — a PDF's line breaks are layout, not the author's.
 */
async function pdfText(bytes: Uint8Array, signal: AbortSignal): Promise<PdfOutcome> {
  let pass: Awaited<ReturnType<typeof pass0>>;
  try {
    pass = await pass0(bytes, {
      maxPages: PAPER_MAX_PAGES,
      maxChars: PAPER_MAX_CHARS,
      maxItems: PAPER_MAX_TEXT_ITEMS,
      retainItems: false,
      signal,
    });
  } catch (err) {
    /* The deadline, reaching pdf.js since plan 261001a: the parse is ended, not waited out. */
    if (signal.aborted) return { ok: false, why: "timeout", detail: "timeout" };
    if (err instanceof TooManyPages) return { ok: false, why: "too-large", detail: `${err.pages} pages` };
    if (err instanceof TooManyCharacters) return { ok: false, why: "too-large", detail: `over ${err.limit} characters` };
    if (err instanceof TooManyTextItems) return { ok: false, why: "too-large", detail: `over ${err.limit} text items` };
    if (pdfUnreadableReason(err) !== null) return { ok: false, why: "damaged", detail: pdfUnreadableReason(err) ?? "" };
    throw err;
  }
  const pages = pass.pages.map((p) => baselineFor(pass, p.page).join(" ")).map((p) => p.replace(/\s+/g, " ").trim());
  const text = pages.filter(Boolean).join("\n\n");
  const words = countWords(text);
  /* `isScan` judges the content pages and needs more than one of them; a
     one-page scan (or a file of blank pages) is caught by the total. */
  if (pass.isScan || words < SCAN_WORDS_PER_PAGE) return { ok: false, why: "scan", detail: `${words} words` };
  return {
    ok: true,
    text,
    words,
    pages: pass.pages.map((p, i) => ({
      page: p.page,
      lines: pageLines(pass, p.page),
      ...(i === 0 ? { linesWithFurniture: p.text.split("\n").filter((line) => line.trim()) } : {}),
    })),
  };
}

/** The first DOI-shaped string in a meta value — `doi:10…`, `https://doi.org/10…` and a bare `10…` all qualify. */
function doiIn(value: string): string | undefined {
  const m = /10\.\d{4,9}\/[^\s"<>]+/.exec(value);
  return m ? m[0].replace(/[.,;]+$/, "").toLowerCase() : undefined;
}

/**
 * The page's `citation_*` / `dc.*` / `prism.*` tags. Read **before** Readability,
 * which rewrites the document it is given.
 */
function metaFrom(document: Document, baseUrl: string): PaperMeta {
  const meta: PaperMeta = {};
  const authors: string[] = [];
  for (const el of Array.from(document.querySelectorAll("meta"))) {
    const name = (el.getAttribute("name") ?? el.getAttribute("property") ?? "").trim().toLowerCase();
    const content = el.getAttribute("content")?.replace(/\s+/g, " ").trim();
    if (!name || !content) continue;
    switch (name) {
      case "citation_title":
        meta.title ??= content;
        break;
      case "citation_author":
        authors.push(content);
        break;
      case "citation_doi":
      case "prism.doi":
      case "dc.identifier":
        if (meta.doi === undefined) {
          const doi = doiIn(content);
          if (doi) meta.doi = doi;
        }
        break;
      case "citation_pdf_url": {
        if (meta.pdfUrl) break;
        try {
          const abs = new URL(content, baseUrl);
          if (abs.protocol === "http:" || abs.protocol === "https:") meta.pdfUrl = abs.toString();
        } catch {
          /* Not an address; the page's text is still there. */
        }
        break;
      }
    }
  }
  if (authors.length > 0) meta.authors = authors;
  return meta;
}

/** One log line per read, then the result. Host, kind, words, ms, code — never the URL, title or text. */
function logged<R extends PaperText | PaperNotPdf>(result: R, started: number, code?: string): R {
  const line = {
    host: result.host,
    kind: result.kind,
    ...(result.kind === "read"
      ? { format: result.format, words: result.words }
      : result.kind === "unreadable"
        ? { why: result.why }
        : {}),
    ...(code ? { code } : {}),
    ms: since(started),
  };
  log("model").info(line, `paper text: ${result.kind}`);
  return result;
}

type Hop =
  | { ok: true; url: string; text: string; words: number; pages: PaperPage[] }
  | { ok: false; why: PaperUnreadableReason; detail?: string };

/**
 * **The one extra hop**: a landing page's `citation_pdf_url`, through the same
 * `fetchDocument` guard. Its failure is not the paper's failure — the page
 * itself may still carry the full text — so the caller remembers it rather than
 * returning it, unless the page turns out to have nothing either.
 */
async function followPdfLink(pdfUrl: string, fetchOpts: FetchOptions, signal: AbortSignal): Promise<Hop> {
  let pdfDoc: FetchedDocument;
  try {
    pdfDoc = await fetchDocument(pdfUrl, fetchOpts);
  } catch (err) {
    if (!(err instanceof FetchFailure)) throw err;
    return { ok: false, why: reasonFor(err.code), detail: err.code };
  }
  /* An HTML "PDF" is a publisher's interstitial or login page. */
  if (pdfDoc.kind !== "pdf") return { ok: false, why: "paywall-or-empty", detail: "pdf link served html" };
  const pdf = await pdfText(pdfDoc.bytes, signal);
  if (signal.aborted) return { ok: false, why: "timeout", detail: "timeout" };
  return pdf.ok ? { ok: true, url: pdfDoc.url, text: pdf.text, words: pdf.words, pages: pdf.pages } : pdf;
}

/**
 * Fetch the address a scholarly work lives at and return its readable text.
 *
 * Never throws for anything the far end did — a dead link, a 403, a paywall, a
 * scan and a timeout are all `unreadable`, each with a reason that has a
 * sentence (`paperUnreadableSentence`). It throws only for a fault of ours: an
 * error from pdf.js that is not about the file, or a bug.
 *
 * **The deadline reaches the PDF parse** since plan 261001a: `pass0` takes the
 * signal, checks it between pages and destroys pdf.js's loading task when it
 * fires, so a parse still running at the deadline is ended rather than waited
 * out. `PAPER_MAX_CHARS` bounds what it holds.
 *
 * With `pdfOnly`, an HTML page is never read as the paper (`PaperNotPdf`).
 */
export function readPaperText(
  url: string,
  opts: ReadPaperOptions & { pdfOnly: true },
): Promise<PaperText | PaperNotPdf>;
export function readPaperText(url: string, opts?: ReadPaperOptions & { pdfOnly?: false }): Promise<PaperText>;
export async function readPaperText(url: string, opts: ReadPaperOptions = {}): Promise<PaperText | PaperNotPdf> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? PAPER_TIMEOUT_MS;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([deadline, opts.signal]) : deadline;
  const fetchOpts: FetchOptions = { ...opts.fetch, timeoutMs, maxBytes: PAPER_MAX_BYTES, attempts: 1, signal };

  const unreadable = (at: string, why: PaperUnreadableReason, detail?: string): PaperText | PaperNotPdf =>
    logged({ kind: "unreadable", url: at, host: hostOf(at), why, ...(detail ? { detail } : {}) }, started, detail);

  const target = arxivPdfUrl(url) ?? url.trim();
  let doc: FetchedDocument;
  try {
    doc = await fetchDocument(target, fetchOpts);
  } catch (err) {
    if (err instanceof FetchFailure) return unreadable(err.url || target, reasonFor(err.code), err.code);
    throw err;
  }

  if (doc.kind === "pdf") {
    const pdf = await pdfText(doc.bytes, signal);
    if (signal.aborted) return unreadable(doc.url, "timeout", "timeout");
    if (!pdf.ok) return unreadable(doc.url, pdf.why, pdf.detail);
    const host = hostOf(doc.url);
    return logged(
      {
        kind: "read",
        url: doc.url,
        host,
        format: "pdf",
        text: normaliseWhitespace(pdf.text),
        words: pdf.words,
        pages: pdf.pages,
      },
      started,
    );
  }

  const { JSDOM } = jsdom();
  const dom = new JSDOM(doc.text, { url: doc.url });
  const meta = metaFrom(dom.window.document, doc.url);

  const hop = meta.pdfUrl ? await followPdfLink(meta.pdfUrl, fetchOpts, signal) : null;
  if (hop?.ok) {
    return logged(
      {
        kind: "read",
        url: hop.url,
        host: hostOf(hop.url),
        format: "pdf",
        text: normaliseWhitespace(hop.text),
        words: hop.words,
        ...(meta.title ? { title: meta.title } : {}),
        meta,
        pages: hop.pages,
      },
      started,
    );
  }
  if (signal.aborted) return unreadable(doc.url, "timeout", "timeout");
  if (opts.pdfOnly) {
    /* The PDF link's own failure says more than "no PDF" does; with no link at
       all, the page is all there is, and it does not count. */
    if (hop) return unreadable(doc.url, hop.why, hop.detail);
    return logged(
      { kind: "not-pdf", url: doc.url, host: hostOf(doc.url), ...(Object.keys(meta).length > 0 ? { meta } : {}) },
      started,
    );
  }

  const page = pageText(dom.window.document, meta);
  if (!page) {
    /* Nothing on the page either: the hop's reason (a scan, a 403) says more than "empty" would. */
    return hop ? unreadable(doc.url, hop.why, hop.detail) : unreadable(doc.url, "paywall-or-empty", "no readable text");
  }
  return logged(
    {
      kind: "read",
      url: doc.url,
      host: hostOf(doc.url),
      format: "html",
      ...page,
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    },
    started,
  );
}

/**
 * **An HTML document already in hand — its scholarly meta tags, its own
 * `<title>` and description, and Readability's text** — with no fetch and no
 * model. For the bulk import's metadata step (src/paper-metadata.ts §
 * `extractHtmlMetadata`), which reads an uploaded web page the way
 * `readPaperText` reads a fetched one: the same `metaFrom` and the same
 * Readability, so there is one HTML reader here rather than two.
 *
 * No base address: an upload has none. A relative `citation_pdf_url` therefore
 * does not resolve and is left out, which is right — nothing here follows it.
 * `text` is empty, not absent, when Readability found nothing.
 */
export function htmlDocumentText(html: string): {
  meta: PaperMeta;
  title?: string;
  description?: string;
  text: string;
} {
  const { JSDOM } = jsdom();
  const dom = new JSDOM(html);
  const document = dom.window.document;
  /* `about:blank` cannot be a base for anything relative, so only an absolute
     `citation_pdf_url` survives — and it is not read here either way. */
  const meta = metaFrom(document, "about:blank");
  const ownTitle = normaliseWhitespace(document.title ?? "") || undefined;
  const description = Array.from(document.querySelectorAll("meta"))
    .filter((el) => {
      const name = (el.getAttribute("name") ?? el.getAttribute("property") ?? "").trim().toLowerCase();
      return name === "description" || name === "og:description" || name === "citation_abstract";
    })
    .map((el) => normaliseWhitespace(el.getAttribute("content") ?? ""))
    .find((content) => content !== "");
  /* After the meta reads: Readability rewrites the document it is given. */
  const page = pageText(document, meta);
  const title = meta.title ?? ownTitle ?? page?.title;
  return {
    meta,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    text: page?.text ?? "",
  };
}

/** Readability's text and title, the same parser stage 2 and `readWebPage` use. `null` when the page has no text. */
function pageText(document: Document, meta: PaperMeta): { text: string; words: number; title?: string } | null {
  const parsed = new Readability(document).parse();
  const text = normaliseWhitespace(parsed?.textContent ?? "");
  if (!text) return null;
  const title = meta.title ?? (parsed?.title?.trim() || undefined);
  return { text, words: countWords(text), ...(title ? { title } : {}) };
}
