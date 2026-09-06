/**
 * A word cut in half by a page break, and the two places it can be lost.
 *
 * 1. **The baseline** (src/pdf.ts `mendHyphens`). It joined a hyphen-ending
 *    line to whatever came next, and at the foot of a page what comes next is
 *    the page number: `else-` + `439` = `else439`, a token no transcription can
 *    match, and the destruction of the only evidence that the word was broken.
 * 2. **The article** (src/pdf-read.ts `mendSeamHyphens`). At a chunk seam the
 *    two halves are read by two different model calls, neither able to see the
 *    other, so `renderHtml` joins them with a space: **"passed the dis
 *    patcher"**, which is in committed output for data/ball-lightning.
 *
 * Everything here is deterministic — the committed `harder` fixture for the
 * seam evidence, a two-page PDF built here for the page-number one. No model.
 *
 * SEEN RED, 2026-08-31, each against the specific reversion named on it.
 */
import { memoryCheckpoints } from "./helpers/memory-checkpoints.js";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { baselineFor, pageLines, type PdfRecord, pass0 } from "../src/pdf.js";
import {
  mendSeamHyphens,
  type PdfReader,
  planChunks,
  renderHtml,
  runPdfExtract,
} from "../src/pdf-read.js";

/** A raw PDF's sha256, which `renderHtml` requires and nothing here reads. */
const RAW_SHA = "a".repeat(64);

const HARDER = "evals/pdf/harder/source.pdf";

const paragraph = (page: number, text: string, continues = false): PdfRecord => ({
  page,
  type: "paragraph",
  text,
  continues,
  uncertain: false,
});

// ------------------------------------------------------------ the baseline

/**
 * Nagel's "What Is It Like to Be a Bat?" page 6 in miniature — the line that
 * broke it, and the page number under it. The real file is not committable
 * (it is in `data/`, gitignored), so its shape is rebuilt here; the line
 * ordering was checked against the real one on 2026-08-31, and pdf.js reads
 * both the same way: prose line, then `439`.
 */
async function pageNumberedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const one = doc.addPage([612, 792]);
  one.drawText("The question whether there is conscious life else-", { x: 40, y: 700, size: 12 });
  one.drawText("439", { x: 300, y: 60, size: 10 });
  const two = doc.addPage([612, 792]);
  two.drawText("where in the universe, it is likely that nobody knows.", { x: 40, y: 700, size: 12 });
  return doc.save();
}

describe("the baseline at the foot of a page", () => {
  it("does not weld the page number onto the broken word", async () => {
    /* RED without the `/^\p{L}/u` clause in mendHyphens: the baseline's last
       line is "conscious life else439". */
    const pass = await pass0(await pageNumberedPdf());
    const baseline = baselineFor(pass, 1);
    expect(baseline.join(" ")).not.toContain("else439");
    expect(baseline.at(-1)).toBe("439");
    expect(baseline[0]).toMatch(/else-$/);
  });

  it("still joins a word broken inside a page, which is what it is for", async () => {
    /* The guard must not have turned mendHyphens off. RED if the join is
       deleted outright rather than made conditional. */
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText("a photograph of the skull-", { x: 40, y: 700, size: 12 });
    page.drawText("shape.html which nobody kept", { x: 40, y: 680, size: 12 });
    const pass = await pass0(await doc.save());
    expect(baselineFor(pass, 1).join(" ")).toContain("skullshape.html");
  });

  it("hands the seam repair the break itself, un-mended", async () => {
    /* The reason `pageLines` exists separately from `baselineFor`, and the
       only shape that can tell them apart: a figure caption drawn at the foot
       of the page, after the body text. In text-layer order it follows the
       broken word, so mending welds them into "disFigure 1. The rear cabin",
       and the evidence that the page ended mid-word is gone.

       RED if the repair reads `baselineFor`: the closing line no longer ends
       in a hyphen and the seam is never mended. Which is why this asserts the
       repaired article rather than the lines — the lines are the mechanism,
       "dispatcher" is the thing that matters. */
    const doc = await PDFDocument.create();
    const one = doc.addPage([612, 792]);
    one.drawText("The captain got up and passed the dis-", { x: 40, y: 700, size: 12 });
    one.drawText("Figure 1. The rear cabin, looking aft.", { x: 40, y: 120, size: 10 });
    const two = doc.addPage([612, 792]);
    two.drawText("patcher and went into the rear cabin.", { x: 40, y: 700, size: 12 });
    const pass = await pass0(await doc.save());

    expect(baselineFor(pass, 1).join(" ")).toContain("disFigure");
    expect(pageLines(pass, 1).at(-1)).toMatch(/^Figure 1/);
    expect(pageLines(pass, 1).some((l) => l.trimEnd().endsWith("dis-"))).toBe(true);

    const out = mendSeamHyphens(
      [
        paragraph(1, "The captain got up and passed the dis"),
        paragraph(2, "patcher and went into the rear cabin.", true),
      ],
      pass,
    );
    expect(out[0]!.text).toBe("The captain got up and passed the dispatcher");
  });
});

// ------------------------------------------------------------ the article

describe("a word broken across a chunk seam", () => {
  it("glues it back from the text layer, and the reader gets one word", async () => {
    /* RED without mendSeamHyphens: the rendered HTML says "dis patcher".
       Pages 3 and 4 of the committed fixture; the halves and the page break
       are the real ones, only the records are hand-written. */
    const pass = await pass0(HARDER);
    const records = [
      paragraph(3, "The captain passed the dis"),
      paragraph(4, "patcher and went into the rear cabin.", true),
    ];
    const html = renderHtml(mendSeamHyphens(records, pass), "t", RAW_SHA);
    expect(html).toContain("dispatcher and went into the rear cabin.");
    expect(html).not.toContain("dis patcher");
  });

  it("takes the hyphen off when the model transcribed it", async () => {
    /* The prompt tells the model to mend hyphenation, and at a seam it cannot,
       so what it does with the hyphen is its own choice: ball-lightning's
       committed output drops it, but "dis-" is the same break with the mark
       still attached. RED without the optional hyphen in the tail pattern (the
       repair declines and the reader gets "dis- patcher"), and RED again
       without the strip in the glue (the reader gets "dis-patcher"). */
    const pass = await pass0(HARDER);
    const out = mendSeamHyphens(
      [
        paragraph(3, "The captain passed the dis-"),
        paragraph(4, "patcher and went into the rear cabin.", true),
      ],
      pass,
    );
    expect(out[0]!.text).toBe("The captain passed the dispatcher");
  });

  it("declines when the continuation does not start with letters", async () => {
    /* An opening quotation mark, a bracket, a stray bullet: whatever it is, it
       is not the second half of a word, and gluing it produces `dis"patcher`.
       RED without the leading-letters pattern on the continuation token. */
    const pass = await pass0(HARDER);
    const out = mendSeamHyphens(
      [
        paragraph(3, "The captain passed the dis"),
        paragraph(4, '"patcher and went into the rear cabin."', true),
      ],
      pass,
    );
    expect(out[0]!.text).toBe("The captain passed the dis");
  });

  it("reads past a page number printed at the top of the page", async () => {
    /* Some journals put the folio at the head rather than the foot, so the
       later page's first line has no letters in it at all. RED if the opening
       check takes the first line instead of the first line with letters: "44"
       does not begin with "patcher", and a real break goes unmended. */
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).drawText("The captain got up and passed the dis-", {
      x: 40,
      y: 700,
      size: 12,
    });
    const two = doc.addPage([612, 792]);
    two.drawText("44", { x: 300, y: 760, size: 10 });
    two.drawText("patcher and went into the rear cabin.", { x: 40, y: 700, size: 12 });
    const pass = await pass0(await doc.save());
    expect(pageLines(pass, 2)[0]).toBe("44");

    const out = mendSeamHyphens(
      [
        paragraph(1, "The captain got up and passed the dis"),
        paragraph(2, "patcher and went into the rear cabin.", true),
      ],
      pass,
    );
    expect(out[0]!.text).toBe("The captain got up and passed the dispatcher");
  });

  it("will not fuse two real words over an unrelated hyphen on the page", async () => {
    /* GPT Sol's case, and the reason the earlier-page rule carries the word
       before the stem. A page holding "An in-" also holds a *different*
       sentence ending in "arrived in", and the next page opens "time to hear
       the verdict." — which the later-page check waves through, because a
       paragraph that continues across a page break always opens with that
       page's first words. Page 3 of the fixture ends twenty-three lines with a
       hyphen; matching a bare stem is barely a filter at all.

       RED without the anchor: "They finally arrived intime". */
    const doc = await PDFDocument.create();
    const one = doc.addPage([612, 792]);
    one.drawText("An in-", { x: 40, y: 720, size: 12 });
    one.drawText("ternal distinction matters.", { x: 40, y: 700, size: 12 });
    one.drawText("They finally arrived in", { x: 40, y: 680, size: 12 });
    doc.addPage([612, 792]).drawText("time to hear the verdict.", { x: 40, y: 700, size: 12 });
    const pass = await pass0(await doc.save());

    const out = mendSeamHyphens(
      [
        paragraph(1, "An internal distinction matters. They finally arrived in"),
        paragraph(2, "time to hear the verdict.", true),
      ],
      pass,
    );
    expect(out[0]!.text).toBe("An internal distinction matters. They finally arrived in");
    expect(out[1]!.text).toBe("time to hear the verdict.");
  });

  it("will not anchor on a word that is only punctuation", async () => {
    /* The same sentence as above with an em dash before the stem. `before` is
       "—", it folds to nothing, and the anchor silently collapses back to the
       bare stem the anchor exists to replace. GPT Sol found this on the second
       pass, after the first fix.

       RED without the `beforeLetters` guard: "arrived — intime". */
    const doc = await PDFDocument.create();
    const one = doc.addPage([612, 792]);
    one.drawText("An in-", { x: 40, y: 720, size: 12 });
    one.drawText("ternal distinction matters.", { x: 40, y: 700, size: 12 });
    one.drawText("They finally arrived — in", { x: 40, y: 680, size: 12 });
    doc.addPage([612, 792]).drawText("time to hear the verdict.", { x: 40, y: 700, size: 12 });
    const pass = await pass0(await doc.save());

    const out = mendSeamHyphens(
      [
        paragraph(1, "An internal distinction matters. They finally arrived — in"),
        paragraph(2, "time to hear the verdict.", true),
      ],
      pass,
    );
    expect(out[0]!.text).toBe("An internal distinction matters. They finally arrived — in");
  });

  it("wants the whole word on the next page, not a prefix of it", async () => {
    /* The model transcribed "patch" where page 4 says "patcher". Something is
       wrong and this function does not know what, so it declines: "dis patch"
       is visibly broken, and "dispatch" is a plausible-looking word that was
       never on the page. RED if the later-page check goes back to `startsWith`
       on the folded line. */
    const pass = await pass0(HARDER);
    const out = mendSeamHyphens(
      [
        paragraph(3, "The captain passed the dis"),
        paragraph(4, "patch and went into the rear cabin.", true),
      ],
      pass,
    );
    expect(out[0]!.text).toBe("The captain passed the dis");
  });

  it("does not treat capitalisation as evidence", async () => {
    /* Small caps, a caps-and-small-caps run-in head, a page that shouts: the
       text layer's case is typography, not information. RED if `letters` stops
       case folding — the stem "DIS" would no longer answer the model's "dis". */
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).drawText("HE WATCHED AS THE CAPTAIN PASSED THE DIS-", {
      x: 40,
      y: 700,
      size: 12,
    });
    doc.addPage([612, 792]).drawText("patcher and went aft.", { x: 40, y: 700, size: 12 });
    const pass = await pass0(await doc.save());

    const out = mendSeamHyphens(
      [
        paragraph(1, "He watched as the captain passed the dis"),
        paragraph(2, "patcher and went aft.", true),
      ],
      pass,
    );
    expect(out[0]!.text).toBe("He watched as the captain passed the dispatcher");
  });

  it("declines a record with no word before the broken one", async () => {
    /* One word is not context: there is nothing to anchor against, so the
       stem would be matching a hyphen anywhere on the page again. RED without
       the `before === undefined` guard. */
    const pass = await pass0(HARDER);
    const out = mendSeamHyphens(
      [paragraph(3, "dis"), paragraph(4, "patcher and went into the rear cabin.", true)],
      pass,
    );
    expect(out[0]!.text).toBe("dis");
  });

  it("does not touch the array it was given", async () => {
    /* It returns copies, and the caller keeps the originals for the record
       count. RED if the copy at the top of mendSeamHyphens is dropped. */
    const pass = await pass0(HARDER);
    const records = [
      paragraph(3, "The captain passed the dis"),
      paragraph(4, "patcher and went into the rear cabin.", true),
    ];
    const out = mendSeamHyphens(records, pass);
    expect(out[0]!.text).toBe("The captain passed the dispatcher");
    expect(records[0]!.text).toBe("The captain passed the dis");
    expect(records[1]!.text).toBe("patcher and went into the rear cabin.");
  });

  it("declines when the model's last word ended the sentence", async () => {
    /* A full stop after the stem means the flow stopped there, so a matching
       "dis-" somewhere on page 3 is a coincidence rather than evidence. RED
       without the anchored tail pattern: "dis.patcher". */
    const pass = await pass0(HARDER);
    const out = mendSeamHyphens(
      [
        paragraph(3, "The captain passed the dis."),
        paragraph(4, "patcher and went into the rear cabin.", true),
      ],
      pass,
    );
    expect(out[0]!.text).toBe("The captain passed the dis.");
  });

  it("leaves an ordinary sentence continuation alone", async () => {
    /* Five of the seven seams in the corpus are this: a sentence that runs on
       across the page break with no hyphen anywhere, which `continues` already
       handles. It is the MAJORITY case, and the stem check is the only thing
       standing between it and a welded word.

       RED without the stem check: the model's next record opens with page 2's
       first words, which is exactly what the later-page check is looking for,
       so the two checks agree and produce "and stood upHe walked forward". */
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).drawText("The captain saw the light and stood up and", {
      x: 40,
      y: 700,
      size: 12,
    });
    doc.addPage([612, 792]).drawText("He walked forward to the cockpit.", { x: 40, y: 700, size: 12 });
    const pass = await pass0(await doc.save());

    const out = mendSeamHyphens(
      [
        paragraph(1, "The captain saw the light and stood up and"),
        paragraph(2, "He walked forward to the cockpit.", true),
      ],
      pass,
    );
    expect(out[0]!.text).toBe("The captain saw the light and stood up and");
    expect(out[1]!.text).toBe("He walked forward to the cockpit.");
  });

  it("leaves the word alone when the model already mended it", async () => {
    /* Inside a chunk the model sees both pages and joins them itself, so its
       last word is `dispatcher` and there is no `dispatcher-` on page 3. */
    const pass = await pass0(HARDER);
    const out = mendSeamHyphens(
      [
        paragraph(3, "The captain passed the dispatcher"),
        paragraph(4, "and went into the rear cabin.", true),
      ],
      pass,
    );
    expect(out[0]!.text).toBe("The captain passed the dispatcher");
    expect(out[1]!.text).toBe("and went into the rear cabin.");
  });

  it("declines the seam whose next page opens with something else", async () => {
    /* Page 5 of the fixture ends "thun-", but page 6's text layer opens with
       "Figure 2. Sketch 1997 by Alfred Geiswinkler" — the caption, not the
       continuation. Gluing would produce "thunderstorm" from a coincidence or
       "thunFigure" from a guess, so it must decline. RED if the check on the
       later page's opening line is dropped. */
    const pass = await pass0(HARDER);
    const records = [
      paragraph(5, "a ball of light during the thun"),
      paragraph(6, "derstorm that afternoon.", true),
    ];
    const out = mendSeamHyphens(records, pass);
    expect(out[0]!.text).toBe("a ball of light during the thun");
    expect(out[1]!.text).toBe("derstorm that afternoon.");
  });

  it("does not reach across a record renderHtml would not join", async () => {
    /* A footnote is transcribed and then dropped (see RENDERED), and dropping
       it resets renderHtml's cursor — so the two paragraphs are never joined,
       and moving a word between them would put it in a paragraph the reader
       sees end before it. RED if the RENDERED reset goes: the repair fires and
       the article says "dispatcher" in one paragraph and "and went into the
       rear cabin." in the next, with nothing between them.

       Stated as the limitation it is: a footnote at the foot of page 3 leaves
       the seam broken. That is renderHtml's non-joining, not this function's —
       and it is the honest, conservative half of the trade. */
    const pass = await pass0(HARDER);
    const out = mendSeamHyphens(
      [
        paragraph(3, "The captain passed the dis"),
        { ...paragraph(3, "1. Ibid., p. 44."), type: "footnote" as const },
        paragraph(4, "patcher and went into the rear cabin.", true),
      ],
      pass,
    );
    expect(out[0]!.text).toBe("The captain passed the dis");
    expect(out[2]!.text).toBe("patcher and went into the rear cabin.");
  });

  it("does not reach across a change of block, either", async () => {
    /* Same rule as the footnote above, the other half of renderHtml's join
       condition: it will not join a paragraph to a quote, so neither will
       this. RED without the same-type check — the word moves into a paragraph
       and the quote loses its first word. */
    const pass = await pass0(HARDER);
    const out = mendSeamHyphens(
      [
        paragraph(3, "The captain passed the dis"),
        { ...paragraph(4, "patcher and went into the rear cabin.", true), type: "quote" as const },
      ],
      pass,
    );
    expect(out[0]!.text).toBe("The captain passed the dis");
    expect(out[1]!.text).toBe("patcher and went into the rear cabin.");
  });

  it("waits to be told the two records are one flow", async () => {
    /* `continues` is the model's own statement that this record carries on
       from the last, and it is the third of renderHtml's three join
       conditions. Without it the page-4 record is a new paragraph, and a
       paragraph does not begin in the middle of a word. RED without the
       `continues` requirement — the evidence on both pages still matches, and
       the repair fires on a boundary the reader sees as a paragraph break. */
    const pass = await pass0(HARDER);
    const out = mendSeamHyphens(
      [
        paragraph(3, "The captain passed the dis"),
        paragraph(4, "patcher and went into the rear cabin."),
      ],
      pass,
    );
    expect(out[0]!.text).toBe("The captain passed the dis");
    expect(out[1]!.text).toBe("patcher and went into the rear cabin.");
  });

  it("does not mistake a column break for a page break", async () => {
    /* Both records are on page 3. The model marks a column break `continues`
       just as it marks a page break, and page 3 really does hold a line ending
       "win-" and really does open with "Figure 1." — so both halves of the
       evidence match, on a boundary where they mean nothing. The evidence is
       only evidence when the halves are on consecutive pages.

       RED without the adjacent-page check: "seen in the winFigure 1. Colour
       drawing". */
    const pass = await pass0(HARDER);
    const out = mendSeamHyphens(
      [
        paragraph(3, "as seen in the win"),
        paragraph(3, "Figure 1. Colour drawing of Haidinger's object", true),
      ],
      pass,
    );
    expect(out[0]!.text).toBe("as seen in the win");
  });

  it("empties a one-word continuation without losing the paragraph after it", async () => {
    /* When the continuation record holds nothing but the second half of the
       word, it ends up empty. renderHtml skips an empty record without moving
       its cursor, so the paragraph after it still joins on and the reader gets
       one sentence. Pages 8 and 9 of the fixture: "or-" + "ange". */
    const pass = await pass0(HARDER);
    const records = [
      paragraph(8, "He saw an or"),
      paragraph(9, "ange", true),
      paragraph(9, "sphere of 15 cm.", true),
    ];
    const out = mendSeamHyphens(records, pass);
    expect(out[0]!.text).toBe("He saw an orange");
    expect(out[1]!.text).toBe("");
    expect(renderHtml(out, "t", RAW_SHA)).toContain("He saw an orange sphere of 15 cm.");
  });
});

// ------------------------------------------------------------ the wiring

/**
 * The end of the road: the file the reader is served.
 *
 * GPT Sol's second finding, and the fair one — every test above calls
 * `mendSeamHyphens` directly, so deleting the single line in `runPdfExtract`
 * that applies it would have left the whole file green. This one runs the real
 * stage against the real fixture with a scripted reader, and reads the HTML off
 * the disk.
 *
 * Pages 3 and 4 are a genuine chunk seam here: `planChunks` cuts the fourteen
 * pages as 1–3, 4–6, 7–9, 10–12, 13–14, and it is asserted below rather than
 * assumed, because that is the whole reason the model cannot mend the word
 * itself.
 */
function seamReader(): PdfReader {
  return {
    id: "test/seam",
    read(_pdf, instruction) {
      const asked = [...instruction.matchAll(/\d+/g)].map(Number);
      const pages = instruction.includes("included only so you can see")
        ? asked.slice(1)
        : asked;
      return Promise.resolve({
        records: pages.map((page) => ({
          page,
          type: "paragraph" as const,
          text:
            page === 3
              ? "The captain passed the dis"
              : page === 4
                ? "patcher and went into the rear cabin."
                : `Observation number ${page}, reported in Vienna.`,
          continues: page === 4,
          uncertain: false,
        })),
        stripped: 0,
        finish: "stop" as const,
        usage: { input: 1, output: 1 },
        ms: 1,
      });
    },
  };
}

describe("the stage as it actually runs", () => {
  it("writes an article with the word mended", async () => {
    /* RED with `const mended = all` in runPdfExtract, which is the one line
       nothing else in this file can see. */
    const bytes = new Uint8Array(await readFile(HARDER));
    const pass = await pass0(bytes);
    const cut = planChunks(pass).map((c) => c.pages);
    expect(cut[0]).toEqual([1, 2, 3]);
    expect(cut[1]).toEqual([4, 5, 6]);

    const result = await runPdfExtract({
      frontMatter: null,
      bytes,
      checkpoints: memoryCheckpoints({ slug: "seam", articleId: "article-seam" }),
      slug: "seam",
      reader: seamReader(),
    });

    const html = result.extractedHtml;
    expect(html).toContain("The captain passed the dispatcher and went into the rear cabin.");
    expect(html).not.toContain("dis patcher");
  });
});
