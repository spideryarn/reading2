/**
 * **The instrument for cluster N, measured before anything is concluded from
 * it** — `evals/pdf/item-boundaries/boundaries.mts`.
 *
 * The corpus comparison in `compare.mts` answers one question: if `pass0` kept
 * the text-layer item boundary it currently throws away, would the fused folio
 * that `folioOffset` in src/pdf-score.ts infers by vote simply stop existing —
 * and would anything the check catches today stop being caught? Its numbers go
 * into a plan and decide whether an extraction change is worth making, so the
 * classifier they come from is pinned here on hand-built item runs first.
 *
 * The first run is the real one: file page 37 of Kuhn's "A Landscape of
 * Consciousness" as pdf.js hands it over — the running header, the empty
 * end-of-line marker, the folio `64` from the FOOT of the page, then the heading
 * from the top, with no marker between them. Coordinates copied from pdf.js on
 * 2026-09-11; the strings are the ones tests/pdf-score.test.ts already carries.
 *
 * docs/plans/260911b-pdf-item-boundaries-evidence.md
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classify,
  headingsAtLineBreaks,
  pageTextAsPass0,
  pageTextSplitAtLineBreaks,
  type RawItem,
  readRawPages,
  truncatedHeading,
} from "../evals/pdf/item-boundaries/boundaries.mjs";
import { compareDocument, mutationResult } from "../evals/pdf/item-boundaries/compare.mjs";
import { pass0 } from "../src/pdf.js";
import { scorePage } from "../src/pdf-score.js";

/** An upright run: `size` is the font's vertical scale, which is what `transform[3]` carries. */
const item = (str: string, x: number, y: number, size: number, over: Partial<RawItem> = {}): RawItem => ({
  str,
  hasEOL: false,
  transform: [size, 0, 0, size, x, y],
  width: str.length * size * 0.5,
  height: str.trim() ? size : 0,
  ...over,
});
const eol = (x: number, y: number, size: number): RawItem => item("", x, y, size, { hasEOL: true });

const KUHN_37: RawItem[] = [
  item("Progress in Biophysics and Molecular Biology 190 (2024) 28–169", 381.2, 752.4, 6.4),
  eol(294.4, 31.6, 6.4),
  item("64", 294.4, 31.6, 6.4, { width: 7.2 }),
  item("9.5.10.", 37.6, 732.9, 8, { width: 24.4 }),
  item(" ", 62, 732.9, 8),
  item("Mansell", 67, 732.9, 8, { width: 25.9 }),
  item("’", 92.9, 732.9, 8, { width: 2.7 }),
  item("s perceptual control theory", 95.5, 732.9, 8, { hasEOL: true }),
];

describe("the item boundary pass0 discards", () => {
  it("reads the Kuhn page exactly as pass0 does today — the folio welded to the heading", () => {
    expect(pageTextAsPass0(KUHN_37)).toBe(
      "Progress in Biophysics and Molecular Biology 190 (2024) 28–169\n649.5.10. Mansell’s perceptual control theory",
    );
  });

  it("finds the one fused boundary that is really a line break, and only that one", () => {
    const breaks = classify(KUHN_37).filter((b) => b.kind === "line-break");
    expect(breaks.map((b) => [b.left, b.right])).toEqual([["64", "9.5.10."]]);
  });

  it("splits the page there and nowhere else", () => {
    expect(pageTextSplitAtLineBreaks(KUHN_37)).toBe(
      "Progress in Biophysics and Molecular Biology 190 (2024) 28–169\n64\n9.5.10. Mansell’s perceptual control theory",
    );
  });

  it("recovers the heading as printed, with no folio vote", () => {
    expect(headingsAtLineBreaks(KUHN_37)).toEqual(["9.5.10."]);
  });

  /* The adversarial half — every case below is something a looser rule would
     split, and splitting it would admit a corrupted number or break a word. */

  it("does not split a section number drawn as two runs on one line — `12.3.` stays `12.3.`", () => {
    const run = [item("1", 38, 760, 8, { width: 4.4 }), item("2.3. Inline span heading", 42.4, 760, 8, { hasEOL: true })];
    expect(classify(run).map((b) => b.kind)).toEqual(["touching"]);
    expect(pageTextSplitAtLineBreaks(run)).toBe("12.3. Inline span heading");
    expect(headingsAtLineBreaks(run)).toEqual([]);
  });

  it("does not split a word a font change cut in two", () => {
    const run = [item("normaliz", 38, 700, 10, { width: 40 }), item("ation of", 78, 700, 10, { hasEOL: true })];
    expect(pageTextSplitAtLineBreaks(run)).toBe("normalization of");
  });

  it("calls a raised footnote marker a shift, not a line", () => {
    const run = [item("footnote", 38, 740, 8, { width: 30 }), item("12", 68, 743, 5), item(" marker", 74, 740, 8)];
    expect(classify(run).map((b) => b.kind)).toEqual(["shift"]);
    expect(pageTextSplitAtLineBreaks(run)).toBe("footnote12 marker");
  });

  it("reports a visible gap with no space in the text layer, and does not invent the space", () => {
    const run = [item("word", 10, 500, 8, { width: 16 }), item("next", 34, 500, 8, { hasEOL: true })];
    expect(classify(run).map((b) => b.kind)).toEqual(["gap"]);
    expect(pageTextSplitAtLineBreaks(run)).toBe("wordnext");
  });

  it("splits the join from the foot of one column to the head of the next", () => {
    const run = [item("the left column ends", 40, 90, 9, { width: 90 }), item("and the right begins", 310, 760, 9)];
    expect(classify(run).map((b) => b.kind)).toEqual(["line-break"]);
    expect(pageTextSplitAtLineBreaks(run)).toBe("the left column ends\nand the right begins");
  });

  it("leaves a page number pdf.js already put on its own line alone — it is not a fused boundary", () => {
    const run = [item("conscious life else-", 40, 60, 9, { hasEOL: true }), item("439", 290, 30, 9)];
    expect(classify(run)).toEqual([]);
  });

  it("skips a sideways stamp exactly as pass0 does", () => {
    const stamp = item("arXiv:1607.06450v1", 20, 400, 10, { transform: [0, 10, -10, 0, 20, 400] });
    const run = [item("normaliza", 100, 700, 12, { width: 50 }), stamp, item("tion", 150, 700, 12)];
    expect(pageTextAsPass0(run)).toBe("normalization");
    expect(classify(run).map((b) => b.kind)).toEqual(["touching"]);
  });
});

describe("the adversarial transcription", () => {
  it("drops the first digit of a multi-digit component, else the first component", () => {
    expect(truncatedHeading("12.3. Genuine heading")).toBe("2.3. Genuine heading");
    expect(truncatedHeading("9.5.10. Mansell")).toBe("5.10. Mansell");
    expect(truncatedHeading("4. My personal")).toBeNull();
    expect(truncatedHeading("In 1843 the society")).toBeNull();
  });

  it("produces the exact protected token that the invented list reports", () => {
    const corrupted = truncatedHeading("12.3. Genuine heading")!;
    const token = corrupted.split(" ")[0]!.replace(/\.$/u, "");
    const scored = scorePage(
      1,
      ["12.3. Genuine heading"],
      [{ page: 1, type: "heading2", text: corrupted, continues: false, uncertain: false }],
      "12.3. Genuine heading",
    );
    expect(token).toBe("2.3");
    expect(scored.invented).toContain(token);
  });

  it("does not count a token that was already invented before the mutation as caught", () => {
    expect(mutationResult([], ["2.3"], "2.3")).toBe("caught");
    expect(mutationResult(["2.3"], ["2.3"], "2.3")).toBe("confounded");
    expect(mutationResult([], [], "2.3")).toBe("missed");
  });

  it("exposes the unmeasured stacked-maths counterexample: the split can forgive a dropped number", () => {
    const stacked = [item("1", 40, 710, 10, { width: 5 }), item("2", 40, 700, 10, { width: 5 })];
    expect(classify(stacked).map((b) => b.kind)).toEqual(["line-break"]);
    expect(pageTextAsPass0(stacked)).toBe("12");
    expect(pageTextSplitAtLineBreaks(stacked)).toBe("1\n2");

    const records = [{ page: 1, type: "paragraph" as const, text: "1", continues: false, uncertain: false }];
    expect(scorePage(1, ["12"], records, "12").invented).toEqual(["1"]);
    expect(scorePage(1, ["1", "2"], records, "1\n2").invented).toEqual([]);
  });
});

describe("the corpus comparison can tell two readings apart", () => {
  /* "No verdict changed" is only a result if the comparison could have said
     otherwise. The control arm splits at every join — the rule the plan
     forbids — and on the committed Kuhn cut it changes five failure lists.
     The real split changes two, and only by withdrawing a false one: page 1's
     licence URL is welded to the first word of the next line, so a model that
     transcribed the URL exactly was scored as having invented it. If this ever
     stops distinguishing the arms, the numbers in the plan stop meaning
     anything. */
  it("sees the control arm's damage on the Kuhn cut, and only a withdrawn false fault from the line-break split", async () => {
    const file = path.join(import.meta.dirname, "../evals/pdf/titles/kuhn-landscape-of-consciousness/source.pdf");
    const r = await compareDocument(file, { db: false });
    expect(r.census.kinds["line-break"]).toBe(3);
    expect(r.refusals.readings).toBe(6);
    expect(r.refusals.verdictChanged).toEqual([]);
    expect(r.refusals.failuresChanged).toHaveLength(2);
    for (const change of r.refusals.failuresChanged) {
      expect(change.newOnly).toEqual([]);
      expect(change.oldOnly).toEqual([
        expect.stringMatching(/are on none of these pages — http:\/\/creativecommons\.org\/licenses\/by-nc-nd\/4\.0\.$/u),
      ]);
    }
    expect(r.refusals.controlFailuresChanged).toBeGreaterThan(2);
  }, 30_000);
});

describe("the harness reads a real PDF the way pass0 does", () => {
  /* The comparison's first claim is "page text unchanged". That is only true
     if this module's reading of the items is pass0's, byte for byte — so it is
     checked against pass0 itself on a committed fixture, not against a copy of
     its loop. */
  it("reproduces pass0's page text for every page of the easy fixture", async () => {
    const file = path.join(import.meta.dirname, "../evals/pdf/easy/source.pdf");
    const [ours, theirs] = await Promise.all([readRawPages(file), pass0(file)]);
    expect(ours.length).toBe(theirs.pages.length);
    for (const [i, items] of ours.entries()) expect(pageTextAsPass0(items)).toBe(theirs.pages[i]!.text);
  });
});
