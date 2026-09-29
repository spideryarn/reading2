/**
 * src/paper-text.ts — a cited work's text from its address, with no network.
 *
 * The fetch and the resolver are injected exactly as tests/fetch.test.ts
 * injects them, so every request goes through the real `fetchDocument` — the
 * guard, the size cap and the type sniff are under test here too, not stubbed
 * out. The PDFs are real: `evals/pdf/easy` has a text layer (and two running
 * headers), and pdf-lib makes a file of blank pages for the scan.
 */
import { readFile } from "node:fs/promises";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { FetchLike } from "../src/fetch.js";
import { arxivPdfUrl, normaliseWhitespace, paperUnreadableSentence, readPaperText } from "../src/paper-text.js";

const EASY = new URL("../evals/pdf/easy/source.pdf", import.meta.url);

type Reply = Response | Error;

/** A fetch that answers by URL, and remembers what it was asked. */
function scripted(replies: Record<string, () => Reply>): { impl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const impl: FetchLike = async (url) => {
    calls.push(url);
    const next = replies[url];
    if (!next) throw new Error(`unscripted fetch: ${url}`);
    const r = next();
    if (r instanceof Error) throw r;
    return r;
  };
  return { impl, calls };
}

function seams(impl: FetchLike) {
  return { fetch: { fetchImpl: impl, resolve: async () => ["93.184.216.34"] } };
}

const html = (body: string) => () => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const pdf = (bytes: Uint8Array) => () =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "application/pdf" } });
const status = (code: number) => () => new Response("no", { status: code, headers: { "content-type": "text/html" } });

const PARAGRAPHS = Array.from(
  { length: 6 },
  (_, i) =>
    `<p>Paragraph ${i + 1} of the paper argues that reading slowly and carefully, with the text in front of you, ` +
    `leads to better recall than reading a summary of the same material, and it reports a study of this.</p>`,
).join("\n");

const ARTICLE = `<!doctype html><html><head>
<title>Slow reading | Journal of Things</title>
<meta name="citation_title" content="Slow Reading and Recall">
<meta name="citation_author" content="Ada Lovelace">
<meta name="citation_author" content="Charles Babbage">
<meta name="DC.Identifier" content="doi:10.1234/ABC.5678">
</head><body><article><h1>Slow Reading and Recall</h1>
${PARAGRAPHS}
</article></body></html>`;

function landing(pdfUrl: string): string {
  return ARTICLE.replace("</head>", `<meta name="citation_pdf_url" content="${pdfUrl}">\n</head>`);
}

async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return await doc.save();
}

describe("readPaperText", () => {
  it("reads an HTML article page with Readability, and its meta tags", async () => {
    const { impl } = scripted({ "https://journal.example/paper": html(ARTICLE) });
    const got = await readPaperText("https://journal.example/paper", seams(impl));
    if (got.kind !== "read") throw new Error(`unreadable: ${got.why}`);
    expect(got.format).toBe("html");
    expect(got.host).toBe("journal.example");
    expect(got.text).toContain("Paragraph 3 of the paper argues that reading slowly");
    expect(got.words).toBe(got.text.split(/\s+/).filter(Boolean).length);
    expect(got.title).toBe("Slow Reading and Recall");
    expect(got.meta).toEqual({
      title: "Slow Reading and Recall",
      authors: ["Ada Lovelace", "Charles Babbage"],
      doi: "10.1234/abc.5678",
    });
  });

  it("follows citation_pdf_url once and prefers the PDF's text layer, keeping the page's meta", async () => {
    const bytes = new Uint8Array(await readFile(EASY));
    const { impl, calls } = scripted({
      "https://journal.example/landing": html(landing("/content/paper.pdf")),
      "https://journal.example/content/paper.pdf": pdf(bytes),
    });
    const got = await readPaperText("https://journal.example/landing", seams(impl));
    if (got.kind !== "read") throw new Error(`unreadable: ${got.why}`);
    expect(calls).toEqual(["https://journal.example/landing", "https://journal.example/content/paper.pdf"]);
    expect(got.format).toBe("pdf");
    expect(got.url).toBe("https://journal.example/content/paper.pdf");
    expect(got.meta?.pdfUrl).toBe("https://journal.example/content/paper.pdf");
    expect(got.meta?.authors).toEqual(["Ada Lovelace", "Charles Babbage"]);
    expect(got.title).toBe("Slow Reading and Recall");
    // The paper's words, not the landing page's.
    expect(got.text).not.toContain("Paragraph 3 of the paper");
    expect(got.words).toBeGreaterThan(3000);
    // Running headers pass0 found on every page are gone…
    expect(got.text).not.toMatch(/Observatori: Centre d.Estudis Australians/i);
    // …and no line breaks survive inside a page.
    expect(got.text.split("\n\n").every((page) => !page.includes("\n"))).toBe(true);
  });

  it("falls back to the page's own text when citation_pdf_url fails", async () => {
    const { impl, calls } = scripted({
      "https://journal.example/landing": html(landing("https://cdn.journal.example/paper.pdf")),
      "https://cdn.journal.example/paper.pdf": status(403),
    });
    const got = await readPaperText("https://journal.example/landing", seams(impl));
    if (got.kind !== "read") throw new Error(`unreadable: ${got.why}`);
    expect(calls).toHaveLength(2);
    expect(got.format).toBe("html");
    expect(got.url).toBe("https://journal.example/landing");
    expect(got.text).toContain("Paragraph 3 of the paper");
  });

  it("does not follow a citation_pdf_url that resolves to a private address", async () => {
    const { impl, calls } = scripted({ "https://journal.example/landing": html(landing("http://10.0.0.5/paper.pdf")) });
    const got = await readPaperText("https://journal.example/landing", seams(impl));
    expect(calls).toEqual(["https://journal.example/landing"]);
    expect(got.kind === "read" && got.format).toBe("html");
  });

  it("rewrites an arXiv abstract page to its PDF before fetching", async () => {
    const bytes = new Uint8Array(await readFile(EASY));
    const { impl, calls } = scripted({ "https://arxiv.org/pdf/1706.03762v5": pdf(bytes) });
    const got = await readPaperText("https://export.arxiv.org/abs/1706.03762v5", seams(impl));
    expect(calls).toEqual(["https://arxiv.org/pdf/1706.03762v5"]);
    expect(got.kind === "read" && got.format).toBe("pdf");
  });

  it("knows both arXiv id shapes, and leaves everything else alone", () => {
    expect(arxivPdfUrl("https://arxiv.org/abs/1706.03762")).toBe("https://arxiv.org/pdf/1706.03762");
    expect(arxivPdfUrl("http://www.arxiv.org/abs/hep-th/9901001v2")).toBe("https://arxiv.org/pdf/hep-th/9901001v2");
    expect(arxivPdfUrl("https://arxiv.org/pdf/1706.03762")).toBeNull();
    expect(arxivPdfUrl("https://notarxiv.org/abs/1706.03762")).toBeNull();
  });

  it("calls a 403 refused and a 404 not-found", async () => {
    const { impl } = scripted({ "https://a.example/x": status(403), "https://a.example/y": status(404) });
    const refused = await readPaperText("https://a.example/x", seams(impl));
    const missing = await readPaperText("https://a.example/y", seams(impl));
    expect(refused).toMatchObject({ kind: "unreadable", why: "refused", host: "a.example" });
    expect(missing).toMatchObject({ kind: "unreadable", why: "not-found" });
  });

  it("calls a PDF with no text layer a scan", async () => {
    const { impl } = scripted({ "https://a.example/scan.pdf": pdf(await blankPdf(3)) });
    const got = await readPaperText("https://a.example/scan.pdf", seams(impl));
    expect(got).toMatchObject({ kind: "unreadable", why: "scan" });
  });

  it("refuses a PDF with too many pages", async () => {
    const { impl } = scripted({ "https://a.example/book.pdf": pdf(await blankPdf(151)) });
    const got = await readPaperText("https://a.example/book.pdf", seams(impl));
    expect(got).toMatchObject({ kind: "unreadable", why: "too-large", detail: "151 pages" });
  });

  it("calls a page with no readable text paywall-or-empty", async () => {
    const { impl } = scripted({ "https://a.example/wall": html("<!doctype html><html><head><title>Log in</title></head><body></body></html>") });
    const got = await readPaperText("https://a.example/wall", seams(impl));
    expect(got).toMatchObject({ kind: "unreadable", why: "paywall-or-empty" });
  });

  it("has a reader's sentence for every reason", () => {
    expect(paperUnreadableSentence("scan")).toMatch(/^We could not get the paper because /);
  });

  it("normalises whitespace without touching words", () => {
    expect(normaliseWhitespace("  a  b\t\tc  \r\n\n\n\n d-\ne ")).toBe("a b c\n\nd-\ne");
  });
});
