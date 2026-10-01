/**
 * **Every record type the transcription asks for is either shown, or hidden on
 * purpose with the reason written here.**
 *
 * The class this guards: a type transcribed, scored and never shown, with
 * nobody noticing because each refusal looked deliberate. `tabledata` was in
 * that state from 2026-08-26 to 2026-10-01 — every table in every PDF a caption
 * over nothing (report spya-pawfwx) — and `footnote` until 2026-09-30.
 * docs/postmortems/261001b-pdf-tables-and-figures-withheld-by-a-one-thing-rule.md.
 *
 * The map is typed `Record<RecordType, …>`, so a new record type does not
 * typecheck until somebody decides here whether a reader sees it.
 */
import { describe, expect, it } from "vitest";
import type { PdfRecord, RecordType } from "../src/pdf.js";
import { renderHtml } from "../src/pdf-read.js";

type Fate = "shown" | { hidden: string };

const FATE: Record<RecordType, Fate> = {
  heading1: "shown",
  heading2: "shown",
  heading3: "shown",
  paragraph: "shown",
  quote: "shown",
  listitem: "shown",
  figure: "shown",
  table: "shown",
  code: "shown",
  footnote: "shown",
  tabledata: "shown",
  reference: { hidden: "v1: the references list is not drawn (Greg's call; src/citation-reference-list.ts)" },
  cover: { hidden: "a publisher's or library's whole page, not the article" },
  publisher: { hidden: "the publisher's furniture on the article's pages — masthead, DOI strip, dates" },
};

describe("what a reader sees of each record type", () => {
  for (const [type, fate] of Object.entries(FATE) as [RecordType, Fate][]) {
    it(`${type} is ${fate === "shown" ? "shown" : "hidden on purpose"}`, () => {
      const word = `Zq${type}word`;
      /* Page 2 of a document that starts on page 1, and a table before the
         cells, because those are the conditions under which each is shown: an
         uncited note on the first page is an affiliation, and cells belong to
         a table. */
      const records: PdfRecord[] = [
        { page: 1, type: "paragraph", text: "Opening prose.", continues: false, uncertain: false },
        ...(type === "tabledata"
          ? [{ page: 2, type: "table" as const, text: "Table 1. T.", continues: false, uncertain: false }]
          : []),
        { page: 2, type, text: `1 ${word} here.`, continues: false, uncertain: false },
      ];
      const html = renderHtml(records, "T", "e".repeat(64));
      expect(html.includes(word)).toBe(fate === "shown");
    });
  }
});
