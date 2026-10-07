/**
 * **Where `tidyTitle` is applied to a web page, and what it is kept away from.**
 * The rules themselves are in tests/title-tidy.test.ts; the PDF seam is in
 * tests/pdf-frontmatter-wiring.test.ts, beside the stub reader it needs.
 * docs/plans/261005g-tidy-an-imported-title-and-keep-the-original.md
 */
import { describe, expect, it } from "vitest";

import { runExtract } from "../src/extract.js";
import { paperMeta } from "../src/paper-metadata.js";
import { metaColumns } from "../src/store/artifacts-pg.js";
import type { Meta } from "../src/types.js";

const page = (title: string, opts: { lang?: string; sentence?: string } = {}) => {
  const sentence = opts.sentence ?? "of ordinary prose, long enough that Readability keeps this article";
  const prose = Array.from(
    { length: 8 },
    (_, i) => `<p>Paragraph ${i} ${sentence} rather than deciding the page is a navigation shell.</p>`,
  ).join("\n");
  const lang = opts.lang ? ` lang="${opts.lang}"` : "";
  return `<!doctype html><html${lang}><head><title>${title}</title></head><body><article>${prose}</article></body></html>`;
};

const extract = (html: string) => runExtract({ html, url: "https://example.com/piece", slug: "piece" });

describe("an HTML page's title, at import", () => {
  it("all capitals becomes title case in meta, and the original is kept", async () => {
    const { meta, extractedHtml } = await extract(page("THE ORDER OF TIME", { lang: "en" }));
    expect(meta.title).toBe("The Order of Time");
    expect(meta.titleOriginal).toBe("THE ORDER OF TIME");
    /* The page's own `<title>` is not recased. Until 2026-10-07 the page's body
       also opened with an `<h1>` of ours carrying it, which stage 3 made a
       block of (src/extract.ts § `debugPage`, plan 261007b). */
    expect(extractedHtml).toContain("<title>THE ORDER OF TIME</title>");
    expect(extractedHtml).not.toContain("<h1>");
  });

  it("a title in ordinary case is stored as it came, with no original", async () => {
    const { meta } = await extract(page("The Order of Time"));
    expect(meta.title).toBe("The Order of Time");
    expect(meta).not.toHaveProperty("titleOriginal");
  });

  it("an acronym the article itself writes in capitals is kept", async () => {
    const { meta } = await extract(
      page("THE FUTURE OF NASA", { sentence: "says that NASA is an agency, and that NASA has a future, at enough length that Readability keeps it" }),
    );
    expect(meta.title).toBe("The Future of NASA");
  });

  it("a page that declares another language keeps its capitals", async () => {
    const { meta } = await extract(page("DIE ORDNUNG DER ZEIT", { lang: "de" }));
    expect(meta.title).toBe("DIE ORDNUNG DER ZEIT");
    expect(meta).not.toHaveProperty("titleOriginal");
  });

  it("does not recase entity syntax left by a doubly encoded title", async () => {
    const { meta } = await extract(page("THE &amp;amp;AMP; HISTORY OF SCIENCE"));
    expect(meta.title).toBe("THE &AMP; HISTORY OF SCIENCE");
    expect(meta).not.toHaveProperty("titleOriginal");
    expect(metaColumns(meta).title).toBe("THE &AMP; HISTORY OF SCIENCE");
  });
});

describe("the column", () => {
  const meta: Meta = { slug: "piece", title: "The Order of Time", fetchedAt: "2026-10-05T00:00:00.000Z" };

  it("holds the original when there is one", () => {
    expect(metaColumns({ ...meta, titleOriginal: "THE ORDER OF TIME" }).titleOriginal).toBe("THE ORDER OF TIME");
  });

  it("is cleared by an extraction that tidied nothing, not left from the last one", () => {
    expect(metaColumns(meta).titleOriginal).toBeNull();
  });

  it("is made plain exactly as the title is, so the pair differ only by the tidying", () => {
    /* The column's `plainTitle` backstop decodes one more level of a
       doubly-encoded title. Applied to the title alone, the original would
       keep markup the title had lost, and "Use that title" would put it back. */
    const columns = metaColumns({
      ...meta,
      title: "The &lt;i&gt;Order&lt;/i&gt; of Time",
      titleOriginal: "THE &lt;i&gt;ORDER&lt;/i&gt; OF TIME",
    });
    expect(columns.title).toBe("The Order of Time");
    expect(columns.titleOriginal).toBe("THE ORDER OF TIME");
  });

  it("is not kept when making both plain leaves nothing between them", () => {
    expect(metaColumns({ ...meta, titleOriginal: "The <i>Order</i> of Time" }).titleOriginal).toBeNull();
  });
});

describe("a minimal paper's title", () => {
  const found = { from: "no-text-layer" as const, authors: [], abstract: null, doi: null, textChars: 0, answeredBy: null };

  it("is tidied too, with no body to name an acronym", () => {
    expect(paperMeta({ slug: "s", kind: "pdf", found: { ...found, title: "THE ORDER OF TIME" } })).toEqual({
      slug: "s",
      title: "The Order of Time",
      titleOriginal: "THE ORDER OF TIME",
      source: "pdf",
    });
  });
});
