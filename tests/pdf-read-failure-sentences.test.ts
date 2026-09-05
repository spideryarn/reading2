/**
 * **Every place other than the page cap where `runPdfExtract` writes a sentence
 * for a reader** — the cap has its own file, tests/pdf-page-cap-message.test.ts.
 *
 * Three of them when this file was written, and five since 2026-09-04, when the
 * two ways a PDF never opens at all got sentences of their own — the last
 * `describe` below, and the one whose absence was doing the most damage.
 *
 * All three arrived at the card as `stepGaveUp`'s generic copy: two were bare
 * `throw new Error(...)`, which `readerFailureOf` reads as *nobody declared
 * anything*, and the third used the `stageFailure(kind, detail)` form, which
 * says only what kind of failure it is and treats the sentence as a log-only
 * diagnostic. docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md
 * § Bug 1.
 *
 * **The assertion is at the seam and on the distinguishing content**, never on
 * the whole sentence: copy stays rewritable (docs/project/copy.md), and what
 * has to survive a rewrite is that the reader is told the page numbers, or the
 * megabytes, rather than "this step did not finish".
 */
import { PDFDocument } from "pdf-lib";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/**
 * **The log level, before any import**, for the last `describe` in this file.
 * `level()` in src/log.ts reads `LOG_LEVEL` once, at that module's load, and
 * vitest's `NODE_ENV=test` otherwise makes the logger `silent` — which writes
 * nothing, which would satisfy every `not.toContain` down there.
 * tests/helpers/log-capture.ts § *two things a caller has to do*.
 */
const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  if (previousLevel === undefined || ["silent", "fatal", "error"].includes(previousLevel)) {
    process.env.LOG_LEVEL = "warn";
  }
  return { previousLevel };
});

import { readerFailureOf } from "../src/job-failure.js";
import { worthRetrying } from "../src/messages.js";
import { pdfUnreadableReason } from "../src/pdf.js";
import {
  knownNativeFinish,
  openRouterReader,
  runPdfExtract,
  type ChunkReading,
  type PdfReader,
} from "../src/pdf-read.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { memoryCheckpoints } from "./helpers/memory-checkpoints.js";

afterAll(() => {
  if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = HOISTED.previousLevel;
});

const LABEL = "Extracting the article";

/** The bracketed code at the end of a sentence, which is what these tests match on. */
const codeOf = (message: string) => message.match(/\[([a-z0-9-]+)\]$/)?.[1];

/** A real, minimal, valid PDF with the given number of blank pages. */
async function pdfWithPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([200, 200]);
  return doc.save();
}

async function threw(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("that was supposed to throw and did not");
}

/**
 * A reader that answers every chunk the same way, so the run reaches the
 * `finish` branch under test on its first call and stops there.
 *
 * The real `openRouterReader` is used for the size refusal below, which happens
 * before anything is sent — a fake there would be testing the fake.
 */
function readerAnswering(finish: string, nativeFinish?: string): PdfReader {
  const reading: ChunkReading = {
    records: [],
    stripped: 0,
    finish,
    ...(nativeFinish === undefined ? {} : { nativeFinish }),
    usage: { input: 0, output: 0 },
    ms: 1,
  };
  return { id: "fake/pdf-v2", read: async () => reading };
}

const checkpoints = () => memoryCheckpoints({ slug: "a-pdf", articleId: "article-a-pdf" });

describe("a chunk too big to send", () => {
  const had = process.env.OPENROUTER_API_KEY;
  afterEach(() => {
    if (had === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = had;
  });

  it("tells the reader the size, not that the step did not finish", async () => {
    /* The key is read before the size check and its absence is a different
       failure, so it has to be present — and nothing is sent, because the
       refusal is arithmetic on the encoded length. */
    process.env.OPENROUTER_API_KEY = "not-a-real-key";
    /* Base64 is four characters per three bytes, so this encodes to ~32 MB
       against the 30 MB a request can carry. Not a valid PDF, and it does not
       need to be: nothing parses it on this path. */
    const oversized = new Uint8Array(24 * 1024 * 1024);
    const err = await threw(() => openRouterReader().read(oversized, "read this"));

    const reader = readerFailureOf(err, LABEL);
    expect(reader.message).toMatch(/\bMB\b/);
    expect(reader.message).not.toContain("[jb-step-no]");
    expect(reader.kind).toBe("blocked");
  });
});

describe("a chunk the model could not finish or would not read", () => {
  it("names the pages whose reading was cut off", async () => {
    const bytes = await pdfWithPages(2);
    const err = await threw(() =>
      runPdfExtract({
        frontMatter: null,
        bytes,
        slug: "a-pdf",
        checkpoints: checkpoints(),
        reader: readerAnswering("length"),
      }),
    );

    const reader = readerFailureOf(err, LABEL);
    expect(reader.message).toMatch(/\b1, 2\b/);
    expect(reader.message).not.toContain("[jb-step-again]");
  });

  it("names the pages the safety filter stopped, and does not repeat the provider's word for it", async () => {
    const bytes = await pdfWithPages(2);
    const err = await threw(() =>
      runPdfExtract({
        frontMatter: null,
        bytes,
        slug: "a-pdf",
        checkpoints: checkpoints(),
        reader: readerAnswering("content_filter", "RECITATION"),
      }),
    );

    const reader = readerFailureOf(err, LABEL);
    expect(reader.message).toMatch(/\b1, 2\b/);
    expect(reader.message).not.toContain("[jb-step-again]");
    /* Rule 4 in docs/project/copy.md, and the reason site 8's diagnostic cannot
       be `{ authored }` while it carries this: `nativeFinish` is the provider's
       own word and is not ours to repeat. */
    expect(reader.message).not.toContain("RECITATION");
    expect(reader.kind).toBe("blocked");
  });
});

/**
 * **And the log is not a safe harbour for it either.**
 *
 * The sentence above was the only thing asserted for a day, and the value went
 * to Pino verbatim two lines away from the assertion that it must not reach the
 * reader — docs/project/logging.md § *any moment where a provider's own text
 * becomes an `Error`*, which says outright that a provider value is not to be
 * trusted because it is expected to be a short enum. GPT Sol, reviewing the
 * built stage 1, finding 3.
 *
 * So these assert the **destination**: what is written is one of the literals in
 * `NATIVE_FINISH_REASONS`, and the string the provider sent appears nowhere.
 */
describe("the provider's word for a refusal, on its way to the log", () => {
  /** `unrecognised` is the answer for anything not on the list, `undefined` for nothing. */
  it("answers with one of our strings or with nothing at all", () => {
    expect(knownNativeFinish(undefined)).toBeUndefined();
    expect(knownNativeFinish("RECITATION")).toBe("recitation");
    expect(knownNativeFinish("content_filter")).toBe("content_filter");
    expect(knownNativeFinish("a sentence nobody expected")).toBe("unrecognised");
    /* Not a prefix match and not a substring one: a reason that merely *starts*
       with a known word is still a string we did not write. */
    expect(knownNativeFinish("safety — because of: <the document>")).toBe("unrecognised");
  });

  it("logs the literal it matched, and not the provider's own spelling of it", async () => {
    const bytes = await pdfWithPages(2);
    const logged = await logLinesWhile(async () => {
      await threw(() =>
        runPdfExtract({
          frontMatter: null,
          bytes,
          slug: "a-pdf",
          checkpoints: checkpoints(),
          reader: readerAnswering("content_filter", "RECITATION"),
        }),
      );
    });
    /* First, because every failure of the capture itself — the level left
       silent, a path that stopped logging — produces an empty string, and an
       empty string passes every `not.toContain` below it. */
    expect(logged, "the capture caught nothing, so nothing below can go red").toContain(
      "safety filter refused a pdf chunk",
    );
    expect(logged).toContain(`"nativeFinish":"recitation"`);
    expect(logged).not.toContain("RECITATION");
  });

  it("replaces a reason nobody has ever seen, however much of the document is in it", async () => {
    /* What an unconstrained provider string can be, and the reason this is not
       a hypothetical: a 200 that echoes the request is exactly the shape
       src/pdf-read.ts § `json.error` already had to close. */
    const ECHOED = "prohibited: the reader's own paragraph, quoted back";
    const bytes = await pdfWithPages(2);
    const logged = await logLinesWhile(async () => {
      await threw(() =>
        runPdfExtract({
          frontMatter: null,
          bytes,
          slug: "a-pdf",
          checkpoints: checkpoints(),
          reader: readerAnswering("content_filter", ECHOED),
        }),
      );
    });
    expect(logged, "the capture caught nothing, so nothing below can go red").toContain(
      "safety filter refused a pdf chunk",
    );
    expect(logged).toContain(`"nativeFinish":"unrecognised"`);
    expect(logged).not.toContain("quoted back");
  });
});

/**
 * **The file the parser cannot open at all**, which had no sentence of its own
 * until 2026-09-04 and therefore got the worst one available.
 *
 * `runPdfExtract` translated `TooManyPages` out of `pass0` and rethrew
 * everything else bare, so a password-protected or damaged PDF reached
 * `readerFailureOf` with nothing declared — which reads as *nobody said*, which
 * means `retry`. The reader got a Retry button, pressed it, and got the same
 * refusal for as long as they were willing to keep pressing: the expensive copy
 * mistake docs/project/copy.md names outright, in the one input class stage 1 of
 * this plan did not audit. ⟨GPT Sol, reviewing the built stages 4 and 5⟩
 *
 * **Real files, real pdf.js exceptions.** The encrypted one is a hand-built PDF
 * with a standard-security `/Encrypt` dictionary in its trailer — measured
 * 2026-09-04 to produce a real `PasswordException` — and the damaged one is
 * bytes that begin `%PDF` and are not a document. A test that constructed the
 * exceptions itself would prove only that the branch exists.
 */
describe("a PDF that will not open", () => {
  /**
   * A minimal PDF encrypted with the standard security handler.
   *
   * The `/O` and `/U` strings are nonsense on purpose: pdf.js reaches
   * `PasswordException` as soon as it finds an `/Encrypt` dictionary it has no
   * password for, and never gets as far as caring whether the hashes are real.
   */
  function encryptedPdf(): Uint8Array {
    const objs = [
      "<</Type/Catalog/Pages 2 0 R>>",
      "<</Type/Pages/Kids[3 0 R]/Count 1>>",
      "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>",
      `<</Filter/Standard/V 1/R 2/O<${"ab".repeat(32)}>/U<${"cd".repeat(32)}>/P -1>>`,
    ];
    let body = "%PDF-1.4\n";
    const offsets: number[] = [];
    objs.forEach((o, i) => {
      offsets.push(body.length);
      body += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xrefAt = body.length;
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
    const trailer =
      `trailer\n<</Size ${objs.length + 1}/Root 1 0 R/Encrypt 4 0 R` +
      `/ID[<${"11".repeat(16)}><${"22".repeat(16)}>]>>\n` +
      `startxref\n${xrefAt}\n%%EOF\n`;
    return new TextEncoder().encode(body + xref + trailer);
  }

  const damagedPdf = () => new TextEncoder().encode("%PDF-1.4\nnot really a document\n%%EOF\n");

  const sentenceFor = async (bytes: Uint8Array) =>
    readerFailureOf(
      await threw(() => runPdfExtract({ frontMatter: null, bytes, slug: "a-pdf", checkpoints: checkpoints() })),
      LABEL,
    );

  it("tells a reader with a locked file that a password is what is missing", async () => {
    const reader = await sentenceFor(encryptedPdf());
    /* The whole finding in one assertion: a Retry button on a file that will
       never open is the app lying about the way out. */
    expect(worthRetrying(reader.message), "offered a Retry that cannot ever work").toBe(false);
    expect(reader.kind).toBe("blocked");
    expect(reader.message).toMatch(/password/i);
    expect(reader.message).not.toContain("[jb-step-again]");
  });

  it("tells a reader with a damaged file that the file is the problem", async () => {
    const reader = await sentenceFor(damagedPdf());
    expect(worthRetrying(reader.message), "offered a Retry that cannot ever work").toBe(false);
    expect(reader.kind).toBe("blocked");
    expect(reader.message).not.toContain("[jb-step-again]");
  });

  /* Two refusals, two codes: "locked" and "damaged" are different things to be
     told, and a shared code would make the bracket useless for the one job it
     has. */
  it("does not say the same thing about a locked file and a damaged one", async () => {
    const locked = await sentenceFor(encryptedPdf());
    const damaged = await sentenceFor(damagedPdf());
    expect(codeOf(damaged.message)).not.toBe(codeOf(locked.message));
  });

  /**
   * **And a broken parser is still not a broken document.** A failed dynamic
   * import or a pdf.js regression must not be dressed up as a statement about
   * the reader's file — the same fail-closed line stage 1's page counter draws
   * (src/pipeline.ts § `refuseAnOverlongPdf`). Asserted on the classifier,
   * because no real file makes pdf.js throw a `TypeError`.
   */
  it("does not call a broken parser a broken document", () => {
    expect(pdfUnreadableReason(new TypeError("loadPdfjs is not a function"))).toBeNull();
    expect(pdfUnreadableReason("not an error at all")).toBeNull();
  });
});
