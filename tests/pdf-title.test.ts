/**
 * **The title ladder, and the rung that ignored the evidence the next rung
 * uses.** Arithmetic only — no network, no key, no model.
 *
 * Reported 2026-09-05: a 142-page Elsevier paper was ingested and given the
 * title *"Progress in Biophysics and Molecular Biology"* — the journal, not the
 * paper. `pass0` over that document had already put
 * `progress in biophysics and molecular biology` **first** in `pass.furniture`,
 * because it is the running header on 141 of its 142 pages. Rung 3 of the
 * ladder consults that set. Rung 2 did not, and rung 2 answers first.
 *
 * docs/plans/260905b-pdf-front-matter-and-the-title-it-stole.md
 */
import { describe, expect, it } from "vitest";
import type { Pass0, PdfRecord } from "../src/pdf.js";
import { foldLine } from "../src/pdf.js";
import { titleFrom } from "../src/pdf-read.js";

const record = (over: Partial<PdfRecord> = {}): PdfRecord => ({
  page: 1,
  type: "paragraph",
  text: "Some words.",
  continues: false,
  uncertain: false,
  ...over,
});

/** A `Pass0` with the given page text and the given lines already called furniture. */
const pages = (
  texts: string[],
  furniture: string[] = [],
  metaTitle: string | null = null,
): Pass0 => ({
  pages: texts.map((text, i) => ({
    page: i + 1,
    text,
    words: text.split(/\s+/).filter(Boolean).length,
    items: [],
  })),
  isScan: false,
  metaTitle,
  furniture: new Set(furniture.map(foldLine)),
});

const JOURNAL = "Progress in Biophysics and Molecular Biology";
const PAPER = "A landscape of consciousness: Toward a taxonomy of explanations and implications";

describe("the title ladder", () => {
  it("does not take the journal's name off the masthead when pass 0 has called it furniture", () => {
    /* The record order is the order the model returned it in, and on Elsevier's
       page 1 the journal is set larger than the paper — so a model calling it
       `heading1` is being reasonable, and the ladder has to be the thing that
       knows better. */
    const records = [
      record({ type: "heading1", text: JOURNAL }),
      record({ type: "paragraph", text: "Contents lists available at ScienceDirect" }),
      record({ type: "heading1", text: PAPER }),
      record({ type: "paragraph", text: "Robert Lawrence Kuhn" }),
    ];
    const header = `${JOURNAL} 190 (2024) 28–169`;
    const pass = pages([`${header}\n${PAPER}`, `${header}\nmore`, `${header}\nmore`], [header]);
    expect(titleFrom(records, pass, "kuhn.pdf")).toBe(PAPER);
  });

  it("keeps a furniture heading when it is the only heading there is", () => {
    /* Plenty of journals print the article's own title as the verso running
       head. Rejecting every furniture-matching heading would throw away exactly
       the right answer on those, so the rejection only applies while a better
       heading is still on the page. */
    const records = [record({ type: "heading1", text: PAPER })];
    const pass = pages([PAPER, PAPER, PAPER], [PAPER]);
    expect(titleFrom(records, pass, "paper.pdf")).toBe(PAPER);
  });

  it("still prefers a metadata title that does not look like a filename", () => {
    const pass = pages(["anything", "anything", "anything"], [], PAPER);
    expect(titleFrom([record({ type: "heading1", text: JOURNAL })], pass, "x.pdf")).toBe(PAPER);
  });

  it("still ignores a metadata title that is really a filename", () => {
    const pass = pages([PAPER, "b", "c"], [], "Microsoft Word - Lyn McCreddon 1");
    expect(titleFrom([record({ type: "heading1", text: PAPER })], pass, "x.pdf")).toBe(PAPER);
  });

  it("still refuses a heading that is not on the first page", () => {
    const records = [record({ page: 2, type: "heading1", text: "Hauntings" })];
    const pass = pages(["The real title line", "b", "c"]);
    expect(titleFrom(records, pass, "x.pdf")).toBe("The real title line");
  });

  it("falls all the way to the filename when there is nothing else", () => {
    expect(titleFrom([], pages(["", "", ""]), "my-paper.pdf")).toBe("my-paper");
  });
});
