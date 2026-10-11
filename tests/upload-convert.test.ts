/**
 * Text, Markdown and Word uploads turned into a web page — src/upload-convert.ts,
 * and the decision of which one a file is — `uploadedFormat` in src/fetch.ts.
 * docs/plans/261011j-upload-text-markdown-and-word-files.md.
 *
 * The `.docx` fixtures are built here from their XML parts rather than checked
 * in, so each test says exactly which Word feature it is about.
 */
import { strToU8, unzipSync, Zip, ZipDeflate, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { uploadedFormat } from "../src/fetch.js";
import {
  boundedDocxParts,
  convertUpload,
  decodeText,
  DOCX_MAX_INFLATED,
  DocxTooLarge,
  DocxUnreadable,
  markdownToHtml,
  textToHtml,
} from "../src/upload-convert.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A minimal Word document: the given `<w:body>` contents, a Heading 1 style, and an image relationship. */
function docx(body: string, extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/_rels/document.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId9" Type="${R}/image" Target="media/image1.png"/></Relationships>`,
    ),
    "word/styles.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W}">` +
        `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="${R}" ` +
        `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
        `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
        `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}</w:body></w:document>`,
    ),
    ...extra,
  });
}

const heading = (text: string) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const picture =
  `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="A chart"/>` +
  `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
  `<pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("convertUpload — Word", () => {
  it("keeps the headings and paragraphs, and titles the page after the first heading", async () => {
    const got = await convertUpload("docx", docx(heading("Quarterly review") + para("Sales rose.")), "q3-final-v2.docx");
    expect(got?.html).toContain("<title>Quarterly review</title>");
    expect(got?.html).toContain("<h1>Quarterly review</h1>");
    expect(got?.html).toContain("<p>Sales rose.</p>");
    expect(got?.encoding).toBeNull();
  });

  it("escapes the document's text rather than passing it through as markup", async () => {
    const got = await convertUpload("docx", docx(para("a &lt;script&gt;alert(1)&lt;/script&gt; b")), "x.docx");
    expect(got?.html).not.toContain("<script>");
    expect(got?.html).toContain("&lt;script&gt;");
  });

  /* The picture's bytes are not even in the archive mammoth reads: the guard
     skips word/media/, and the converter never asks for them. */
  it("drops pictures without reading them", async () => {
    const png = new Uint8Array(4096).fill(7);
    const got = await convertUpload("docx", docx(para("Before.") + picture + para("After."), { "word/media/image1.png": png }), "x.docx");
    expect(got?.html).toContain("Before.");
    expect(got?.html).toContain("After.");
    expect(got?.html).not.toContain("<img");
    expect(got?.html).not.toContain("data:");
  });

  it("falls back to the filename when there is no heading", async () => {
    const got = await convertUpload("docx", docx(para("Just prose.")), "My notes.docx");
    expect(got?.html).toContain("<title>My notes</title>");
  });

  it("refuses a zip that is not a Word document, and bytes that are not a zip", async () => {
    expect(await convertUpload("docx", zipSync({ "hello.txt": utf8("hi") }), "x.docx")).toBeNull();
    expect(await convertUpload("docx", utf8("PK\u0003\u0004 and then nonsense"), "x.docx")).toBeNull();
  });
});

describe("boundedDocxParts — the zip-bomb guard", () => {
  /** Rewrite every header's uncompressed size to `declared` — a liar about how big the part is. */
  const lieAboutSizes = (zip: Uint8Array, declared: number): Uint8Array => {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i + 4 <= zip.length; i++) {
      const signature = view.getUint32(i, true);
      if (signature === 0x04034b50) view.setUint32(i + 22, declared, true); // local header
      if (signature === 0x02014b50) view.setUint32(i + 24, declared, true); // central directory
    }
    return zip;
  };

  /**
   * **The claim the guard rests on**: what is counted is what comes out of the
   * inflater, never what a header says. 64 MiB of zeros compresses to ~64 KB,
   * and both headers are rewritten to declare 1 KB. jszip, which mammoth uses,
   * would inflate all 64 MiB; the first version of this guard bounded the
   * *buffer* to 1 KB but still inflated the whole stream (Sol, finding 2).
   */
  it("refuses a part whose header understates what it inflates to", () => {
    const bomb = lieAboutSizes(zipSync({ "word/document.xml": new Uint8Array(64 * 1024 * 1024) }), 1024);
    expect(() => boundedDocxParts(bomb)).toThrow(DocxTooLarge);
  });

  /* A stored (uncompressed) entry is copied, not inflated, and the first version
     copied its *compressed* size while counting its declared one. */
  it("counts a stored part by what it really holds", () => {
    const stored = lieAboutSizes(
      zipSync({ "word/document.xml": new Uint8Array(DOCX_MAX_INFLATED + 1) }, { level: 0 }),
      1024,
    );
    expect(() => boundedDocxParts(stored)).toThrow(DocxTooLarge);
  });

  /* Archives written as a stream carry their sizes after the data (a "data
     descriptor"), so there is no header size to check at all — only the count. */
  it("reads a streamed archive, and refuses a streamed bomb", () => {
    const streamed = (files: Record<string, Uint8Array>): Uint8Array => {
      const out: Uint8Array[] = [];
      const zip = new Zip((error, chunk) => {
        if (error) throw error;
        out.push(chunk);
      });
      for (const [name, data] of Object.entries(files)) {
        const entry = new ZipDeflate(name);
        zip.add(entry);
        entry.push(data, true);
      }
      zip.end();
      return new Uint8Array(out.flatMap((c) => [...c]));
    };
    const fine = boundedDocxParts(streamed({ "word/document.xml": utf8("<w:document/>") }));
    expect(unzipSync(fine)["word/document.xml"]).toEqual(utf8("<w:document/>"));
    expect(() => boundedDocxParts(streamed({ "word/document.xml": new Uint8Array(40 * 1024 * 1024) }))).toThrow(
      DocxTooLarge,
    );
  });

  /* Two directory entries for one name is how one stream gets counted once and
     read twice; a real Word file never has it. */
  it("refuses a name that appears twice", () => {
    const twice = zipSync({ "word/document.xml": utf8("a"), "word/documenX.xml": utf8("b") }, { level: 0 });
    const name = utf8("documenX");
    for (let i = 0; i + name.length <= twice.length; i++) {
      if (name.every((byte, j) => twice[i + j] === byte)) twice[i + 7] = "t".charCodeAt(0);
    }
    expect(() => boundedDocxParts(twice)).toThrow(DocxUnreadable);
  });

  /* The stream reader walks local headers and never needs the central
     directory, so cutting it off, or appending junk after it, changes nothing
     the count depends on (Sol, code review finding 4). */
  it("still counts a bomb whose central directory is cut off", () => {
    const bomb = zipSync({ "word/document.xml": new Uint8Array(40 * 1024 * 1024) });
    const view = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
    let central = bomb.length;
    for (let i = 0; i + 4 <= bomb.length; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        central = i;
        break;
      }
    }
    expect(central).toBeLessThan(bomb.length);
    expect(() => boundedDocxParts(bomb.subarray(0, central))).toThrow(DocxTooLarge);
  });

  it("reads a real document with junk after the archive", async () => {
    const withJunk = new Uint8Array([...docx(para("Still here.")), ...utf8("trailing junk ".repeat(100))]);
    expect((await convertUpload("docx", withJunk, "x.docx"))?.html).toContain("<p>Still here.</p>");
  });

  /* fflate's own "unexpected end" error, not ours — the guard's contract is to
     throw, and `convertUpload` turns any throw into a refusal. */
  it("refuses an archive cut off in the middle of a part", async () => {
    const whole = docx(para("x".repeat(100_000)));
    const half = Math.floor(whole.length / 2);
    expect(() => boundedDocxParts(whole.subarray(0, half))).toThrow();
    expect(await convertUpload("docx", whole.subarray(0, half), "x.docx")).toBeNull();
  });

  it("refuses a compression method it does not know", () => {
    const zip = zipSync({ "word/document.xml": utf8("hello") }, { level: 0 });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i + 4 <= zip.length; i++) {
      const signature = view.getUint32(i, true);
      if (signature === 0x04034b50) view.setUint16(i + 8, 14, true); // LZMA, local header
      if (signature === 0x02014b50) view.setUint16(i + 10, 14, true); // and central directory
    }
    expect(() => boundedDocxParts(zip)).toThrow(DocxUnreadable);
  });

  it("refuses parts that honestly declare more than the cap", () => {
    const big = zipSync({ "word/document.xml": new Uint8Array(DOCX_MAX_INFLATED + 1) });
    expect(() => boundedDocxParts(big)).toThrow(DocxTooLarge);
  });

  it("does not count the pictures towards the cap, because it never inflates them", () => {
    const heavy = docx(para("x"), { "word/media/huge.png": new Uint8Array(DOCX_MAX_INFLATED + 1) });
    expect(() => boundedDocxParts(heavy)).not.toThrow();
  });

  it("refuses an archive with too many entries", () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 2001; i++) entries[`junk/${i}.xml`] = new Uint8Array(0);
    expect(() => boundedDocxParts(zipSync(entries))).toThrow(DocxTooLarge);
  });
});

describe("textToHtml", () => {
  it("makes a paragraph of each block between blank lines, and escapes everything", () => {
    const html = textToHtml("A title\n\nFirst line\nwrapped here.\r\n\r\n<b>not bold</b> & co", "file");
    expect(html).toContain("<title>A title</title>");
    expect(html).toContain("<h1>A title</h1>");
    expect(html).not.toContain("<p>A title</p>");
    expect(html).toContain("<p>First line\nwrapped here.</p>");
    expect(html).toContain("<p>&lt;b&gt;not bold&lt;/b&gt; &amp; co</p>");
  });

  it("takes the filename as the title when the first line is too long to be one", () => {
    expect(textToHtml(`${"word ".repeat(40)}\n\nmore`, "notes")).toContain("<title>notes</title>");
  });
});

describe("decodeText", () => {
  it("reads UTF-8, a BOM either way round, and falls back to windows-1252", () => {
    expect(decodeText(utf8("café"))).toEqual({ text: "café", encoding: "utf-8" });
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toEqual({ text: "hi", encoding: "utf-8" });
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toEqual({ text: "hi", encoding: "utf-16le" });
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]))).toEqual({ text: "hi", encoding: "utf-16be" });
    /* 0x93/0x94 are curly quotes in windows-1252 and invalid as UTF-8. */
    expect(decodeText(new Uint8Array([0x93, 0x68, 0x69, 0x94]))).toEqual({
      text: "“hi”",
      encoding: "windows-1252",
    });
  });
});

describe("markdownToHtml", () => {
  it("renders CommonMark and GitHub tables, and titles the page after the first heading", () => {
    const html = markdownToHtml("# Notes on *Dune*\n\nSome **bold**.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n", "file");
    expect(html).toContain("<title>Notes on Dune</title>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<table>");
  });

  it("escapes raw HTML in the Markdown", () => {
    const html = markdownToHtml("Hello <script>alert(1)</script>\n", "file");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("uploadedFormat", () => {
  it("believes the name for text, Markdown and Word when the bytes agree", () => {
    expect(uploadedFormat("notes.txt", utf8("Just some notes.\n"))).toBe("text");
    expect(uploadedFormat("README.md", utf8("# Hi\n\ntext"))).toBe("markdown");
    expect(uploadedFormat("draft.docx", docx(para("x")))).toBe("docx");
  });

  /* The invariant tests/fetch.test.ts pins for the HTML path: what the bytes
     say the fetched path would have found is never contradicted by a name. */
  it("lets the bytes overrule the name", () => {
    expect(uploadedFormat("page.txt", utf8("<!doctype html><html><body><p>hi</p></body></html>"))).toBe("html");
    expect(uploadedFormat("paper.md", utf8("%PDF-1.7\n1 0 obj"))).toBe("pdf");
    expect(uploadedFormat("paper.docx", utf8("%PDF-1.7\n1 0 obj"))).toBe("pdf");
  });

  /* One rule with the fetched path, not a second one for text names: a PDF
     header past byte zero is still a PDF, and leading HTML still a page, even
     in a file called `.docx` (GPT Sol, code review finding 1). The full corpus
     is in tests/fetch.test.ts. */
  it("reads the bytes exactly as the fetched path would, whatever the converted name", () => {
    expect(uploadedFormat("notes.txt", utf8("\n%PDF-1.7\n1 0 obj"))).toBe("pdf");
    expect(uploadedFormat("page.docx", utf8("<!doctype html><html><body><p>hi</p></body></html>"))).toBe("html");
  });

  it("refuses binary dressed as text, and a Word file that is not a zip", () => {
    expect(uploadedFormat("notes.txt", new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x41]))).toBeNull();
    expect(uploadedFormat("draft.docx", utf8("not a zip"))).toBeNull();
  });

  it("reads a UTF-16 text file with a BOM as text, not as binary", () => {
    const bytes = new Uint8Array([0xff, 0xfe, ...[..."Hello"].flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(uploadedFormat("notes.txt", bytes)).toBe("text");
  });

  it("leaves PDF and HTML names to the rule they always had", () => {
    expect(uploadedFormat("paper.pdf", utf8("%PDF-1.7\n"))).toBe("pdf");
    expect(uploadedFormat("saved.html", utf8("<p>hello</p>"))).toBe("html");
  });
});

describe("Word's ways of hiding text", () => {
  /**
   * **Why the injection scan reads the converted page and not the `.docx`**
   * (src/injection-scan.ts, a defence this work does not touch). Its question
   * is whether the model reads text the reader cannot see. mammoth keeps no
   * colour, size or the hidden-text flag, so white, one-point and "hidden"
   * text all come out as ordinary paragraphs — in the page the reader reads and
   * the model reads alike. If a mammoth upgrade ever kept one of them, this
   * goes red and the scan has a Word-shaped blind spot to answer for.
   */
  it("comes out as ordinary visible prose", async () => {
    const run = (props: string, text: string) => `<w:p><w:r><w:rPr>${props}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;
    const got = await convertUpload(
      "docx",
      docx(
        run('<w:color w:val="FFFFFF"/>', "WHITE-TEXT") +
          run('<w:sz w:val="2"/>', "TINY-TEXT") +
          run('<w:highlight w:val="white"/><w:vanish/>', "VANISHED-TEXT"),
      ),
      "x.docx",
    );
    expect(got?.html).toContain("<p>WHITE-TEXT</p>");
    expect(got?.html).toContain("<p>TINY-TEXT</p>");
    expect(got?.html).toContain("<p>VANISHED-TEXT</p>");
    expect(got?.html).not.toMatch(/style=|class=|hidden/);
  });
});
