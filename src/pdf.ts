/**
 * Pipeline stage 2, for a PDF — **pass 0: everything the file will tell us for
 * free.** See docs/plans/pdf-ingestion.md.
 *
 *   npx tsx src/pdf.ts evals/pdf/easy/source.pdf
 *
 * No model call, no network, no native binary, about 0.4 s for 17 pages. What
 * it produces is used four times over:
 *
 *   - the page count, so an 800-page book is refused with a sentence rather
 *     than a bill;
 *   - words per page, so "this is a scan with no text in it" is a fact we
 *     state rather than a surprise the model runs into;
 *   - the repeated lines — running headers, footers, page numbers — which the
 *     model is told to drop and which therefore must not count against it;
 *   - and the per-page text, which is the BASELINE every transcribed page is
 *     checked against. That is the whole reason this stage exists: a model
 *     transcribing a page can drop a paragraph, summarise one, or invent one,
 *     and all three read as fluent English. Only something that already knows
 *     what is on the page can tell.
 *
 * A scan has none of this, which is exactly why a scan is the hard case —
 * see docs/plans/pdf-ingestion.md#a-scan-with-no-text-layer.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
/**
 * **pdf.js is loaded on demand, and that is not a performance tweak.**
 *
 * A static import here reaches the serverless API, because src/pipeline.ts
 * imports src/pdf-read.ts imports this file, and src/vercel.ts imports the
 * pipeline. pdf.js then evaluates at module scope on *every* route, and its
 * module body touches `DOMMatrix`, which Node does not have — it comes from
 * `@napi-rs/canvas`, an optional platform-specific package that pdf.js
 * `require`s inside a try/catch.
 *
 * Vercel's dependency tracer cannot see a require it never statically reads, so
 * the canvas package is left out of the function bundle while pdf.js is put in.
 * The result, measured in production 2026-08-27:
 *
 *     ReferenceError: DOMMatrix is not defined
 *       at node_modules/pdfjs-dist/legacy/build/pdf.mjs:16713
 *
 * on every request, to every route, PDF or not — and never on a laptop, where
 * `@napi-rs/canvas-darwin-arm64` is sitting in node_modules and supplies
 * `DOMMatrix` happily. A green build, a green deploy, and a dead API.
 * docs/postmortems/pdfjs-dommatrix-serverless.md.
 *
 * Deferring the import means a route that never opens a PDF never loads pdf.js,
 * so the API comes up whether or not the canvas binary made it into the bundle.
 * It costs one `await` on the first PDF this process handles.
 */
type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<Pdfjs> | undefined;

/** pdf.js, imported the first time something actually needs it. */
function loadPdfjs(): Promise<Pdfjs> {
  /* The *promise* is cached rather than the module, so two concurrent callers
     share one import rather than racing to start a second one. */
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

/** One text run as pdf.js found it: where it sits on the page, and what it says. */
export interface TextItem {
  /** Points from the left edge. Two clusters of these is what a two-column page looks like. */
  x: number;
  /** Points from the *bottom* edge — pdf.js uses PDF coordinates, so bigger is higher. */
  y: number;
  text: string;
}

export interface PageText {
  /** 1-based, and the number every later artefact addresses this page by. */
  page: number;
  /** Line breaks preserved; runs of spaces and tabs collapsed. */
  text: string;
  words: number;
  items: TextItem[];
}

export interface Pass0 {
  pages: PageText[];
  /**
   * The title in the PDF's own metadata, if it has one worth having.
   *
   * Recorded rather than trusted. A great many PDFs carry `Microsoft Word -
   * Lyn McCreddon 1` here — the `easy` fixture does — which is a filename
   * wearing a title's clothes. `titleFrom` in src/pdf-read.ts decides.
   */
  metaTitle: string | null;
  /**
   * True when the pages carry no extractable text — a photographic scan.
   *
   * Judged on the *content* pages rather than on all of them, because a
   * digitisation service's own generated rights page does carry text: the
   * Wellcome scan in evals/pdf/much-harder has 95 words in the whole file and
   * every one of them is on Wellcome's cover sheet. A test of "every page is
   * empty" says that document is not a scan, which is the opposite of true.
   */
  isScan: boolean;
  /**
   * Lines that repeat across pages: running headers, footers, page numbers.
   *
   * Normalised, because a running header carries the page number and so is
   * never byte-identical twice. The model is told to leave these out, so they
   * have to come out of the baseline too — otherwise a correct transcription
   * loses recall for obeying its instructions, and the threshold gets widened
   * to accommodate it until it stops catching anything.
   */
  furniture: Set<string>;
}

/**
 * **One unit of a page, as the model is asked to return it** — the shape the
 * whole stage is built around, so it lives here rather than in whichever file
 * needed it first.
 *
 * `page` is the *printed* page of the original document, not the index within
 * whatever chunk was sent, and it is on every record even though v1's reader
 * never shows it: the check in src/pdf-score.ts cannot assert that a page was
 * transcribed without it, and "view the scanned page" needs it later.
 */
export interface PdfRecord {
  page: number;
  type: RecordType;
  text: string;
  /** This record continues the one before it — the same paragraph broken across a column or a page. */
  continues: boolean;
  /** The model could not read some of this. Its text will contain ⟦illegible⟧. */
  uncertain: boolean;
}

/**
 * The vocabulary, deliberately small. Everything here renders to one HTML
 * element in code, so malformed nesting and stray attributes are not something
 * the model can produce.
 *
 * **The last three are transcribed and then thrown away, and that is the design
 * rather than an oddity.** v1 does not show footnotes, references or a
 * publisher's cover page — Greg's call, and it stands. The obvious way to
 * implement "does not show" is to tell the model not to transcribe them, and
 * that is what the first version did. It quietly broke the only check this
 * stage has: the baseline is the PDF's own text layer, which contains every
 * footnote, so a page whose footnotes were correctly dropped looks exactly like
 * a page whose last paragraph was lost. The threshold then has to be loose
 * enough to allow 20–40% of an academic page to be missing, at which point it
 * cannot see a lost paragraph at all.
 *
 * So the model transcribes them, labels them, and `RENDERED` below drops them.
 * The check compares like with like, the gate can be tight, and v2 showing
 * footnotes is a change to one set rather than a change to the prompt, the
 * check and the thresholds together.
 *
 * **`tabledata` was the same lesson taught twice.** The first version applied
 * this to footnotes and references and left rule 7 saying "do not transcribe a
 * table's cells" — which is right about what v1 *shows*, and wrong in exactly
 * the same way. The `harder` fixture's page 10 is Table 1, ninety-one words of
 * cells in the text layer and one caption in the output, and a word-perfect
 * transcription failed the gate for obeying its instructions. GPT Sol asked
 * whether transcribing footnotes moved the problem rather than solving it; it
 * had moved it as far as tables. Transcribe everything, label it, show a
 * subset.
 */
export type RecordType =
  | "heading1"
  | "heading2"
  | "heading3"
  | "paragraph"
  | "quote"
  | "listitem"
  | "figure"
  | "table"
  | "code"
  | "footnote"
  | "reference"
  | "cover"
  | "tabledata";

/**
 * What v1 puts on the page. Everything else is transcribed, checked, and not shown.
 *
 * This set is also **what the check gates on**, and that is not a coincidence:
 * a fault the reader can never see is worth reporting and not worth failing an
 * article for. src/pdf-score.ts § `check`.
 */
export const RENDERED: ReadonlySet<RecordType> = new Set<RecordType>([
  "heading1",
  "heading2",
  "heading3",
  "paragraph",
  "quote",
  "listitem",
  "figure",
  "table",
  "code",
]);

/** How many pages must share a line before it is furniture rather than prose. */
const FURNITURE_PAGES = 3;

/** Below this, a page has no usable text layer. A stray character is not a text layer. */
const SCAN_WORDS_PER_PAGE = 20;

/**
 * Fold a line to what two pages of running header have in common.
 *
 * Digits go as well as punctuation — the page number is the part that changes,
 * and keeping it means the header never repeats and never gets recognised.
 * That costs us a line of pure prose that happens to be nothing but numbers,
 * on three or more pages, which is not a document we are trying to serve.
 */
export const foldLine = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .trim();

/**
 * Every line that appears on `FURNITURE_PAGES` or more pages.
 *
 * Counted once per page, so a phrase repeated three times on one page is not
 * furniture — that is a refrain, and it is the author's.
 */
export function repeatedLines(pages: { text: string }[]): Set<string> {
  const seen = new Map<string, number>();
  for (const page of pages) {
    const onThisPage = new Set(
      page.text.split("\n").map(foldLine).filter((l) => l.length > 3),
    );
    for (const line of onThisPage) seen.set(line, (seen.get(line) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n >= FURNITURE_PAGES).map(([line]) => line));
}

/**
 * The text layer, page by page.
 *
 * `hasEOL` rather than guessing from `y`: pdf.js already knows where the line
 * ended, and reconstructing it from coordinates gets superscripts and inline
 * maths wrong. Line breaks are kept because `repeatedLines` needs them — a
 * running header is a *line*, and a text blob has none.
 *
 * **There is no `isEvalSupported: false` here, and there was until the
 * typechecker said otherwise.** A PDF is a stranger's file
 * (docs/project/security.md), older pdf.js compiled pattern code out of one
 * with `Function`, and that flag turned it off — so it looked like exactly the
 * line this file should carry. pdf.js 6 removed the option: it is not in the
 * typings and not in the build, so passing it did nothing at all while reading
 * as a precaution. Which is the house pattern (docs/reusable/silent-success.md)
 * in its smallest form: a security option that is a comment.
 */
export class TooManyPages extends Error {
  constructor(
    readonly pages: number,
    readonly limit: number,
  ) {
    super(`This PDF has ${pages} pages and the limit is ${limit}.`);
    this.name = "TooManyPages";
  }
}

export async function pass0(
  source: string | Uint8Array,
  opts: { maxPages?: number } = {},
): Promise<Pass0> {
  /**
   * **A copy, and it is not defensive tidiness.** pdf.js takes *ownership* of
   * the array it is given: it transfers the underlying buffer to its worker and
   * leaves the caller holding a detached one. Every later use of those bytes
   * then fails — `Cannot transfer object of unsupported type` from the next
   * library to touch them, which names neither this function nor the reason.
   * Found by src/pdf-read.ts, which hashes the file and cuts pages out of it
   * after asking pass 0 what is in it.
   */
  const data =
    typeof source === "string" ? new Uint8Array(await readFile(source)) : new Uint8Array(source);
  /* The loading task is kept, not just its promise, because it is the only
     thing that can destroy the worker — `PDFDocumentProxy.cleanup()` releases
     page resources and leaves the worker running. The guard below needs to walk
     away from a document it has decided not to read. */
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true });
  const doc = await loadingTask.promise;

  /**
   * **The cap, before a single page is read.**
   *
   * This check used to live in src/pdf-read.ts, over `pass.pages.length` — that
   * is, over the array this function returns, which it can only produce by
   * having walked every page and every text item into memory first. So the cap
   * bounded what we spent on *models*, which is what it was written for, and
   * bounded nothing at all about what pdf.js did before that. A small, valid
   * file with a hundred thousand pages was fully parsed and then refused.
   *
   * `doc.numPages` is available the moment the document opens, from the page
   * tree, without touching a page. Asking it here costs nothing and closes the
   * whole gap.
   *
   * That gap was survivable while the only way to reach this parser was a URL
   * we had chosen to fetch. **An upload hands it to a stranger**, which is why
   * this moved rather than being left as a note — see
   * docs/plans/pdf-upload-and-storage.md and docs/project/security.md.
   *
   * The limit is passed in rather than imported: this module has no opinion
   * about cost, and `MAX_PAGES` belongs to the stage that pays.
   */
  if (opts.maxPages !== undefined && doc.numPages > opts.maxPages) {
    try {
      await loadingTask.destroy();
    } catch {
      /* Being abandoned anyway. A failure to release a worker we are throwing
         away must not replace the error that says why we are throwing it. */
    }
    throw new TooManyPages(doc.numPages, opts.maxPages);
  }

  const pages: PageText[] = [];
  let metaTitle: string | null = null;
  try {
    const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: string } | undefined;
    metaTitle = info?.Title?.trim() || null;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        items.push({
          x: Math.round(item.transform[4]!),
          y: Math.round(item.transform[5]!),
          text: item.str,
        });
        text += item.str + (item.hasEOL ? "\n" : "");
      }
      const trimmed = text.replace(/[ \t]+/g, " ").trim();
      pages.push({
        page: n,
        text: trimmed,
        words: trimmed ? trimmed.split(/\s+/).length : 0,
        items,
      });
    }
  } finally {
    /* `cleanup` releases page resources; **`destroy` is what stops the worker**,
       and the comment two hundred lines up already said so while this line went
       on calling only the first. So a parse that threw, and every ordinary
       successful parse, left a worker behind — one per document rather than one
       per refusal, which is the larger of the two leaks. Found by the
       cross-family review, 2026-08-26.

       Both, and in this order: `cleanup` on a document whose worker has gone is
       not something to rely on. Neither may replace the error that brought us
       here, so each is allowed to fail on its own. */
    try {
      await doc.cleanup?.();
    } catch {
      /* Being torn down regardless. */
    }
    try {
      await loadingTask.destroy();
    } catch {
      /* Ditto — see the guard above the page loop. */
    }
  }

  const withText = pages.filter((p) => p.words >= SCAN_WORDS_PER_PAGE);
  return {
    pages,
    metaTitle,
    isScan: withText.length <= 1 && pages.length > 1,
    furniture: repeatedLines(pages),
  };
}

/**
 * The baseline a transcribed page is checked against: this page's text layer
 * with the furniture lines removed.
 *
 * Returned as lines rather than tokens so the caller decides how to compare —
 * the scorer wants tokens, a human reading a failure wants lines.
 */
export function baselineFor(pass: Pass0, page: number): string[] {
  const found = pass.pages.find((p) => p.page === page);
  if (!found) return [];
  return mendHyphens(
    found.text.split("\n").filter((line) => line.trim() && !pass.furniture.has(foldLine(line))),
  );
}

/**
 * Join a line that ends in a hyphen to the one after it, dropping the hyphen —
 * because that is exactly what the model is told to do, and the baseline has to
 * have been told the same things.
 *
 * Without it, a *correct* transcription loses recall on every hyphenated word:
 * the page holds `skull-` and `shape.html` as two tokens, the model returns
 * `skullshape.html` as one, and neither matches the other. Small, and it lands
 * on the one metric everything else is judged against, so it is worth the
 * dozen lines.
 *
 * The cost, stated: a line genuinely ending in a hyphen — `self-` in
 * "self- and other-regarding" — is joined to the next word wrongly. That
 * produces one wrong token in the baseline rather than two, which is the
 * cheaper of the two mistakes, and it is rare in a way that hyphenation at a
 * line break is not.
 */
function mendHyphens(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const previous = out.at(-1);
    if (previous !== undefined && /(\p{L})[-\u2010\u00ad]$/u.test(previous)) {
      out[out.length - 1] = previous.replace(/[-\u2010\u00ad]$/u, "") + line.trimStart();
      continue;
    }
    out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------- CLI

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: tsx src/pdf.ts <file.pdf>");
    process.exit(1);
  }
  const { pages, isScan, furniture } = await pass0(input);
  const words = pages.map((p) => p.words).sort((a, b) => a - b);
  console.log(`File:      ${path.resolve(input)}`);
  console.log(`Pages:     ${pages.length}${isScan ? "   (a scan — no text layer)" : ""}`);
  console.log(
    `Words:     ${words.reduce((a, b) => a + b, 0)} total, per page min ${words[0]} median ${words[words.length >> 1]} max ${words.at(-1)}`,
  );
  console.log(`Furniture: ${furniture.size} repeated line(s)`);
  for (const line of furniture) console.log(`             ${line.slice(0, 90)}`);
}

/* Resolved paths, not a suffix match — see the same guard in src/blocks.ts for
   why `endsWith` runs the CLI as a side effect of an unrelated import. */
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) void main();
