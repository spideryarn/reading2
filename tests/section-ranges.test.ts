/**
 * **Each heading's section, as indices** — src/section-ranges.ts, the rule the
 * fold store and the front- and back-matter pass share (plan 261018a, F8).
 */
import { describe, expect, it } from "vitest";

import { sectionRanges } from "../src/section-ranges.js";

const h = (id: string, level?: number) => ({ id, kind: "heading", ...(level === undefined ? {} : { level }) });
const p = (id: string) => ({ id, kind: "text" });

describe("sectionRanges", () => {
  it("gives a heading every block up to the next heading at its level or coarser", () => {
    const blocks = [p("intro"), h("A", 2), p("a1"), h("Ax", 3), p("ax1"), h("B", 2), p("b1")];
    expect(sectionRanges(blocks)).toEqual([
      { id: "A", start: 1, end: 5 },
      { id: "Ax", start: 3, end: 5 },
      { id: "B", start: 5, end: 7 },
    ]);
  });

  it("runs the last open sections to the end of the article", () => {
    expect(sectionRanges([h("A", 1), h("Ax", 2), p("x")])).toEqual([
      { id: "A", start: 0, end: 3 },
      { id: "Ax", start: 1, end: 3 },
    ]);
  });

  it("counts a heading with no level as the narrowest, 6", () => {
    const blocks = [h("A", 6), p("a"), h("B"), p("b"), h("C", 5), p("c")];
    expect(sectionRanges(blocks)).toEqual([
      { id: "A", start: 0, end: 2 },
      { id: "B", start: 2, end: 4 },
      { id: "C", start: 4, end: 6 },
    ]);
    /* A level-less heading under an h5 is inside it. */
    expect(sectionRanges([h("C", 5), h("B"), p("b")])).toEqual([
      { id: "C", start: 0, end: 3 },
      { id: "B", start: 1, end: 3 },
    ]);
  });

  it("has nothing for an article without headings", () => {
    expect(sectionRanges([p("a"), p("b")])).toEqual([]);
    expect(sectionRanges([])).toEqual([]);
  });
});
