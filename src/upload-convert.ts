/**
 * **A text, Markdown or Word upload, turned into a web page** — stage 1's
 * half of docs/plans/261011j-upload-text-markdown-and-word-files.md.
 *
 * `acquireUpload` (src/pipeline.ts) calls this for the three converted formats
 * and from then on the upload *is* an uploaded web page: stored as `html`, read
 * by Readability at stage 2, sanitised at stage 3 like any other page. So this
 * module makes no promise about safety and needs none — an `.html` upload is
 * already legal, and anything a converter could emit, a reader could already
 * have written into one. What it does promise is that **a `.docx` cannot make
 * us retain more than `DOCX_MAX_INFLATED` of inflated parts**, and that refusal
 * happens after at most one bounded input push's additional output, whatever the
 * archive claims about itself: the zip guard below.
 *
 * Server-only: mammoth and micromark are not in the browser bundle.
 */
import { Unzip, UnzipInflate, zipSync } from "fflate";
import mammoth from "mammoth";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import type { ConvertedFormat } from "./uploads.js";

/** What a conversion made: a whole HTML document, and the text encoding it was read in. */
export interface ConvertedUpload {
  html: string;
  /** The encoding a text or Markdown file was decoded with; `null` for Word. */
  encoding: string | null;
}

/**
 * Turn one upload into an HTML document, or `null` when the bytes are not the
 * format the name claimed — a `.docx` that is some other zip, or one past the
 * zip guard's limits. The caller refuses with `[up-pdf]`.
 */
export async function convertUpload(
  format: ConvertedFormat,
  bytes: Uint8Array,
  filename: string,
): Promise<ConvertedUpload | null> {
  const stem = filenameStem(filename);
  switch (format) {
    case "text": {
      const { text, encoding } = decodeText(bytes);
      return { html: textToHtml(text, stem), encoding };
    }
    case "markdown": {
      const { text, encoding } = decodeText(bytes);
      return { html: markdownToHtml(text, stem), encoding };
    }
    case "docx": {
      const html = await docxToHtml(bytes, stem);
      return html === null ? null : { html, encoding: null };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

/**
 * **Bytes to a string, the way a browser opening a local `.txt` would.** A BOM
 * decides if there is one (UTF-8, or UTF-16 either way round, which is what
 * Windows Notepad's "Unicode" writes); otherwise UTF-8 if the bytes are valid
 * UTF-8, otherwise windows-1252 — the same default `decodeHtml` (src/fetch.ts)
 * falls back to, for the same reason: it is what old files with no declaration
 * almost always are, and it never fails.
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

/** The longest first line we will take as a plain-text file's title. */
const TITLE_LINE_MAX = 120;

/**
 * **Paragraphs on blank lines, every character escaped**, and nothing else.
 *
 * Single newlines stay inside the paragraph, where the prose's own white-space
 * rule folds them into spaces — so a hard-wrapped file (Project Gutenberg's 72
 * columns, an email) reads as prose rather than as a column of short lines. A
 * poem loses its line breaks; that is the trade, and prose is the common case.
 *
 * The title is the first line when it is short enough to be one, else the
 * filename.
 */
export function textToHtml(text: string, stem: string): string {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const first = paragraphs[0]?.split("\n")[0]?.trim() ?? "";
  const title = first !== "" && first.length <= TITLE_LINE_MAX ? first : stem;
  /* A first paragraph that is only that title line is the file's heading, and
     is drawn as one — not as a paragraph repeating the title (seen in the
     browser check). */
  const headed = paragraphs[0] === title;
  const body = paragraphs
    .map((p, i) => (i === 0 && headed ? `<h1>${escapeHtml(p)}</h1>` : `<p>${escapeHtml(p)}</p>`))
    .join("\n");
  return htmlDocument(title, body);
}

/* ------------------------------------------------------------------ *
 * Markdown
 * ------------------------------------------------------------------ */

/**
 * **CommonMark plus GitHub's tables, strikethrough, task lists and autolinks**,
 * by micromark — the tokenizer `mdast-util-from-markdown` is built on, already
 * in the tree for chat and the help pages.
 *
 * **Raw HTML inside the Markdown is escaped**, micromark's default. Not for
 * safety — see this module's header — but because it is the library's default
 * and the boring choice: a `<details>` in a README shows as text.
 */
export function markdownToHtml(text: string, stem: string): string {
  const body = micromark(text, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
  return htmlDocument(firstHeading(body) ?? stem, body);
}

/* ------------------------------------------------------------------ *
 * Word
 * ------------------------------------------------------------------ */

/** The most entries a `.docx` may hold. A real one has a few dozen. */
export const DOCX_MAX_ENTRIES = 2000;

/**
 * The most a `.docx`'s kept parts may inflate to, in all. 32 MiB of XML is a
 * document of a couple of thousand pages; past it we refuse rather than find
 * out what mammoth does with it.
 */
export const DOCX_MAX_INFLATED = 32 * 1024 * 1024;

/**
 * Parts we never inflate: the pictures (dropped in v1 — stage 4.5 hosts only
 * images with a web address), embedded objects and fonts. They are most of a
 * large document's weight and none of its words.
 */
const DOCX_SKIPPED_PREFIXES = ["word/media/", "word/embeddings/", "word/fonts/"];

/** Why a `.docx` was turned away by the guard rather than by mammoth. */
export class DocxTooLarge extends Error {}

/** Why a `.docx` was refused by the guard as damaged rather than as too large. */
export class DocxUnreadable extends Error {}

/**
 * How much compressed input the guard hands the inflater at once. Deflate
 * expands at most ~1032:1, so one push can emit at most ~16 MiB before the
 * count below sees it and stops.
 */
const PUSH_BYTES = 16 * 1024;

/**
 * **The zip-bomb guard**: the `.docx`'s parts, inflated while counting the
 * bytes that actually come out, stopped the moment the count passes the cap,
 * and re-zipped for mammoth.
 *
 * mammoth inflates with jszip, which grows its output to whatever the stream
 * produces and ignores the size the header declares — so a 50 MiB file that
 * inflates to 50 GiB would take the process with it.
 *
 * **Counted, not declared.** The first version trusted fflate's `unzipSync` to
 * inflate each part into a buffer of its *declared* size, and GPT Sol showed
 * that bounds the memory but not the work: the inflater runs the whole stream
 * and discards what does not fit, a stored entry copies its *compressed* size,
 * and several directory entries can point at one stream
 * (docs/plans/261011j-upload-text-markdown-and-word-files-plan-review-sol.md,
 * finding 2). So this streams the archive through `Unzip` a small push at a
 * time and counts what each part emits; no declared uncompressed size is
 * trusted as the count.
 *
 * **Re-zipping is what makes the bound reach mammoth.** It reads our archive,
 * not the reader's, so whatever the original's central directory says — sizes,
 * offsets, a second copy of a name — never reaches jszip.
 *
 * @throws `DocxTooLarge` past `DOCX_MAX_ENTRIES` or `DOCX_MAX_INFLATED`;
 *   `DocxUnreadable` for a repeated kept name, a part that never finished, or
 *   a compression method other than stored and deflate; and whatever fflate
 *   throws for something that is not a zip.
 */
export function boundedDocxParts(bytes: Uint8Array): Uint8Array {
  const parts: Record<string, Uint8Array> = {};
  const unfinished = new Set<string>();
  let entries = 0;
  let inflated = 0;
  let failure: Error | null = null;
  const fail = (error: Error) => {
    failure ??= error;
  };

  const unzip = new Unzip((file) => {
    if (failure) return;
    entries += 1;
    if (entries > DOCX_MAX_ENTRIES) return fail(new DocxTooLarge(`more than ${DOCX_MAX_ENTRIES} entries`));
    if (DOCX_SKIPPED_PREFIXES.some((prefix) => file.name.startsWith(prefix))) return;
    if (file.name in parts || unfinished.has(file.name)) return fail(new DocxUnreadable(`${file.name} twice`));
    if (file.compression !== 0 && file.compression !== 8) {
      return fail(new DocxUnreadable(`compression method ${file.compression}`));
    }
    const chunks: Uint8Array[] = [];
    unfinished.add(file.name);
    file.ondata = (error, data, final) => {
      if (failure) return;
      if (error) return fail(new DocxUnreadable(error.message));
      inflated += data.byteLength;
      if (inflated > DOCX_MAX_INFLATED) {
        file.terminate();
        return fail(new DocxTooLarge(`parts inflate past ${DOCX_MAX_INFLATED} bytes`));
      }
      chunks.push(data);
      if (final) {
        unfinished.delete(file.name);
        parts[file.name] = concat(chunks);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  for (let at = 0; at < bytes.byteLength && !failure; at += PUSH_BYTES) {
    const end = Math.min(at + PUSH_BYTES, bytes.byteLength);
    unzip.push(bytes.subarray(at, end), end === bytes.byteLength);
  }
  if (failure) throw failure;
  if (unfinished.size > 0) throw new DocxUnreadable(`${unfinished.size} part(s) never finished`);
  /* Level 0: stored, so jszip's read of our archive costs a copy, not a second inflate. */
  return zipSync(parts, { level: 0 });
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * A `.docx` to an HTML document by mammoth, or `null` if it is not one we can
 * read.
 *
 * mammoth maps Word's *styles* to structure — Heading 1 to `<h1>`, list
 * paragraphs to `<ul>`/`<ol>`, tables, footnotes, links — and drops fonts and
 * colours, which is the shape Readability and the block splitter want.
 *
 * **`externalFileAccess: false`, said out loud** although it is the default
 * since mammoth 1.11.0: a `.docx` can name `file:///…` as a linked image, and
 * before that version mammoth read it (CVE-2025-11849). **The floor in
 * package.json is 1.12.3, not 1.11.0**: 1.12.2 fixed a prototype pollution that
 * could turn that option back on, and 1.12.3 a ReDoS (mammoth's NEWS; GPT Sol,
 * plan review finding 3). The images converter returns no address and never
 * calls `read`, so no picture is inflated or fetched; the `<img>` it leaves is
 * removed below.
 *
 * **In-process, like pdf.js and Readability.** mammoth's README recommends a
 * separate thread with a timeout for untrusted documents, and so would pdf.js's
 * for hostile PDFs; neither runs in one here. What a `.docx` adds over those —
 * the zip — is bounded by `boundedDocxParts`; isolating every document parser is
 * its own piece of work, queued rather than started for one format.
 */
async function docxToHtml(bytes: Uint8Array, stem: string): Promise<string | null> {
  let rezipped: Uint8Array;
  try {
    rezipped = boundedDocxParts(bytes);
  } catch {
    return null;
  }
  let body: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(rezipped.buffer, rezipped.byteOffset, rezipped.byteLength) },
      {
        externalFileAccess: false,
        /* A `.docx` can carry its own mammoth style map, which would let the
           file choose what its paragraphs become. Ours only. */
        includeEmbeddedStyleMap: false,
        /* Word's own *Title* style is not in mammoth's default map, so a
           document's title came out as a plain paragraph and the page was named
           after its first section (measured on calibre's demo.docx). */
        styleMap: ["p[style-name='Title'] => h1:fresh"],
        convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
      },
    );
    body = result.value;
  } catch {
    return null;
  }
  /* mammoth's own output, so its text is already escaped and an `<img` here
     can only be one of the tags it wrote. */
  body = body.replace(/<img\b[^>]*>/g, "");
  return htmlDocument(firstHeading(body) ?? stem, body);
}

/* ------------------------------------------------------------------ *
 * Shared
 * ------------------------------------------------------------------ */

/** A complete page around a converted body, UTF-8 declared so stage 1's decoder agrees. */
function htmlDocument(title: string, body: string): string {
  return (
    `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>\n` +
    `<body><article>\n${body}\n</article></body></html>\n`
  );
}

/**
 * The text of the first `<h1>` in a converter's output, for the `<title>`.
 * Readability reads `<title>` first and an uploaded file has no other, so
 * without this a Word document headed *Quarterly review* would be titled
 * after whatever its file was called.
 *
 * A regex over *generated* HTML, not over anything a reader wrote: micromark
 * and mammoth escape text, so the only tags here are theirs.
 */
function firstHeading(body: string): string | null {
  const match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(body);
  if (!match?.[1]) return null;
  const text = decodeEntities(match[1].replace(/<[^>]*>/g, "")).trim();
  return text === "" ? null : text;
}

/** The filename without its last extension, for a title of last resort. */
function filenameStem(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const stem = (dot > 0 ? filename.slice(0, dot) : filename).trim();
  return stem === "" ? "Untitled" : stem;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Undo the escaping micromark and mammoth do, so `escapeHtml` does not double it. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
