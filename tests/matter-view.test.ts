/**
 * **Which stretches the reading view folds, what each stub says, and which
 * Structure rows are drawn faint** — src/web/matter-view.ts, and the `matter`
 * flag on structure.ts's and outline.ts's rows.
 * docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md
 * § Stage 3, and its plan review: F7 (the echo is subtracted), F9 (one
 * stretch, by index).
 */
import { describe, expect, it } from "vitest";
import { MATTER_KINDS } from "../src/matter.js";
import type { Block, BlockId, MatterKindName, MatterStretchStored } from "../src/types.js";
import {
  MATTER_KIND_ORDER,
  atFront,
  matterStretches,
  stubCount,
  stubHow,
  stubLabel,
  stubWhat,
  coveredByStretches,
} from "../src/web/matter-view.js";
import { outlineProjection } from "../src/web/outline.js";
import { structureProjection } from "../src/web/structure.js";
import type { SummaryNode } from "../src/web/tree.js";

const id = (s: string) => `spya-${s}` as BlockId;
const b = (s: string, text = s, kind: Block["kind"] = "text", words = text.split(/\s+/).filter(Boolean).length): Block =>
  ({ id: id(s), kind, tag: kind === "heading" ? "h2" : "p", text, words, html: text }) as Block;

describe("the kinds, in one order", () => {
  it("is the server's closed list, in the server's order", () => {
    expect([...MATTER_KIND_ORDER]).toEqual([...MATTER_KINDS]);
  });
});

describe("matterStretches: where the stretches come from", () => {
  const blocks = [
    { ...b("ttl", "A Title", "heading"), tag: "h1", level: 1 } as Block,
    b("nam", "Jane Roe1 and John Doe2"),
    b("abh", "Abstract"),
    b("abs", "We find that things happen."),
    b("bod", "The argument itself."),
    b("ref", "Roe 2020. A paper."),
  ];
  const art = (matter?: MatterStretchStored[]) => ({
    blocks,
    meta: { byline: "Jane Roe; John Doe" },
    ...(matter === undefined ? {} : { matter }),
  });
  const s = (from: string, to: string, ...kinds: MatterKindName[]): MatterStretchStored => ({
    from: id(from),
    to: id(to),
    kinds,
  });
  const NO_ECHO = new Set<BlockId>();

  it("is the stored stretches when the article carries them, resolved by index", () => {
    const out = matterStretches(art([s("abh", "abs", "abstract"), s("ref", "ref", "references")]), NO_ECHO);
    expect(out).toEqual([
      { ids: [id("abh"), id("abs")], start: 2, end: 3, kinds: ["abstract"] },
      { ids: [id("ref")], start: 5, end: 5, kinds: ["references"] },
    ]);
  });

  it("falls back to the byline rule, as one authors stretch, when the article carries none", () => {
    const out = matterStretches(art(), NO_ECHO);
    expect(out).toEqual([{ ids: [id("nam")], start: 1, end: 1, kinds: ["authors"] }]);
  });

  it("does not fall back when the stored answer is that there is nothing to fold", () => {
    expect(matterStretches(art([]), NO_ECHO)).toEqual([]);
  });

  it("drops a stretch whose ends are not blocks, or are the wrong way round, or that overlaps one before it", () => {
    const out = matterStretches(
      art([
        s("abs", "abh", "abstract"), // reversed by index
        s("nam", "gone", "authors"), // an end that is not a block
        s("nam", "abh", "authors"),
        s("abh", "abs", "abstract"), // overlaps the one before
        s("ref", "ref", "references"),
      ]),
      NO_ECHO,
    );
    expect(out.map((x) => x.ids)).toEqual([[id("nam"), id("abh")], [id("ref")]]);
  });

  it("leaves the masthead's echo out, keeps the kinds bar the title it was, and drops a stretch that was only echo", () => {
    const echo = new Set([id("ttl")]);
    expect(matterStretches(art([s("ttl", "nam", "title", "authors")]), echo)).toEqual([
      { ids: [id("nam")], start: 1, end: 1, kinds: ["authors"] },
    ]);
    expect(matterStretches(art([s("ttl", "nam", "title", "authors")]), NO_ECHO)).toEqual([
      { ids: [id("ttl"), id("nam")], start: 0, end: 1, kinds: ["title", "authors"] },
    ]);
    expect(matterStretches(art([s("nam", "abs", "authors", "abstract")]), echo)[0]?.kinds).toEqual([
      "authors",
      "abstract",
    ]);
    expect(matterStretches(art([s("ttl", "ttl", "title")]), echo)).toEqual([]);
  });
});

describe("the stub's label", () => {
  it("names one kind by its own label", () => {
    expect(stubLabel(["authors"])).toBe("Authors and affiliations");
    expect(stubLabel(["abstract"])).toBe("Abstract");
    expect(stubLabel(["dates"])).toBe("Publication details");
    expect(stubLabel(["references"])).toBe("References");
    expect(stubLabel(["title"])).toBe("Title");
  });

  it("names up to three, in the closed order, in sentence case", () => {
    expect(stubLabel(["funding", "acknowledgements"])).toBe("Acknowledgements and funding");
    expect(stubLabel(["declarations", "funding", "acknowledgements", "authors"])).toBe(
      "Authors and affiliations, acknowledgements and funding",
    );
  });

  /* Browser pass of 261018a: a title-and-byline stretch and the authors'
     list further down both read "Authors and affiliations". */
  it("starts with the title when the title is among them, and calls the authors just that", () => {
    expect(stubLabel(["title", "authors"])).toBe("Title and authors");
    expect(stubLabel(["authors", "title"])).toBe("Title and authors");
    expect(stubLabel(["title", "abstract"])).toBe("Title and abstract");
    expect(stubLabel(["title", "authors", "abstract", "keywords"])).toBe("Title, authors and abstract");
  });
});

describe("the stub's count", () => {
  const blocks = [
    b("abh", "Abstract"),
    b("ab1", "one two three four five"),
    b("ab2", "six seven"),
    b("rfh", "References", "heading"),
    b("r1", "Roe 2020."),
    b("emp", "  ", "text", 0),
    b("r2", "Doe 2021."),
  ];

  it("counts an abstract's words, its heading not among them", () => {
    expect(stubCount({ start: 0, end: 2, kinds: ["abstract"] }, blocks)).toBe("8 words");
    expect(stubCount({ start: 2, end: 2, kinds: ["abstract"] }, blocks)).toBe("2 words");
  });

  it("counts references as entries: non-empty blocks that are not the heading", () => {
    expect(stubCount({ start: 3, end: 6, kinds: ["references"] }, blocks)).toBe("2 entries");
    expect(stubCount({ start: 4, end: 4, kinds: ["references"] }, blocks)).toBe("1 entry");
  });

  it("counts everything else in lines, the empty block not among them", () => {
    expect(stubCount({ start: 3, end: 6, kinds: ["acknowledgements"] }, blocks)).toBe("3 lines");
    expect(stubCount({ start: 1, end: 1, kinds: ["authors"] }, blocks)).toBe("1 line");
    expect(stubCount({ start: 0, end: 2, kinds: ["abstract", "keywords"] }, blocks)).toBe("3 lines");
  });
});

describe("the stub's ⓘ", () => {
  it("says what each named kind is, in one plain line each", () => {
    expect(stubWhat(["abstract"])).toBe("The authors' own summary of the paper.");
    expect(stubWhat(["funding", "acknowledgements"])).toBe("The authors' thanks. Who paid for the work.");
  });

  it("says Spideryarn folded it and nothing is removed, true to where the stretch is", () => {
    expect(stubHow(true)).toMatch(/^Spideryarn folds this away so the page starts with the article\. Nothing is removed\.$/);
    expect(stubHow(false)).toMatch(/Nothing is removed\.$/);
    expect(stubHow(false)).not.toMatch(/starts with/);
    const ten = Array.from({ length: 10 }, (_, i) => b(`x${i}`));
    expect(atFront({ start: 1 }, ten)).toBe(true);
    expect(atFront({ start: 8 }, ten)).toBe(false);
  });
});

/* Plan review of 261018a, F9. */
describe("coveredByStretches: Structure's faint rows", () => {
  const stretches = [
    { start: 2, end: 5 },
    { start: 6, end: 9 },
    { start: 12, end: 14 },
  ];

  it("is a row wholly inside one stretch, its ends included", () => {
    expect(coveredByStretches(2, 5, stretches)).toBe(true);
    expect(coveredByStretches(3, 4, stretches)).toBe(true);
    expect(coveredByStretches(7, 7, stretches)).toBe(true);
  });

  it("is not a row that only partly overlaps one", () => {
    expect(coveredByStretches(1, 3, stretches)).toBe(false);
    expect(coveredByStretches(9, 10, stretches)).toBe(false);
    expect(coveredByStretches(11, 13, stretches)).toBe(false);
  });

  /* Browser pass of 261018a: "Title and Abstract" is two stretches, back to
     back, and is all matter; pressing it opens both (fold.ts §
     `openStretchesWithin`). */
  it("is a row spanning stretches back to back, which together cover it", () => {
    expect(coveredByStretches(4, 7, stretches)).toBe(true);
    expect(coveredByStretches(2, 9, stretches)).toBe(true);
  });

  it("is not a row across a gap between two stretches", () => {
    expect(coveredByStretches(8, 13, stretches)).toBe(false);
    expect(coveredByStretches(2, 14, stretches)).toBe(false);
  });

  it("is nothing without stretches", () => {
    expect(coveredByStretches(0, 0, [])).toBe(false);
  });
});

/** Two parts: the abstract (rows 0–1) and the body (rows 2–9), which has two sections. */
function tree(): SummaryNode {
  const node = (nid: string, title: string, startRow: number, endRow: number, children: SummaryNode[] = [], number = ""): SummaryNode =>
    ({
      node: { id: nid, depth: 1, parent: null, children: [], range: [id(`r${startRow}`), id(`r${endRow}`)], title },
      number,
      startRow,
      endRow,
      children,
      title,
    }) as unknown as SummaryNode;
  return node("n0", "Root", 0, 9, [
    node("n1", "Abstract", 0, 1, [], "1"),
    node("n2", "The body", 2, 9, [node("n3", "Method", 2, 5, [], "2.1"), node("n4", "Results", 6, 9, [], "2.2")], "2"),
  ]);
}

describe("the matter flag on Structure's rows, in both faces", () => {
  const matter = [{ start: 0, end: 1 }];

  it("marks a part wholly inside a stretch, keeps its number and label, and leaves the rest", () => {
    const proj = structureProjection({ root: tree(), focusRow: 0, rungA: 1, rungB: 1, allowParagraphs: false, matter });
    const rows = proj.columnA.rows.map((r) => [r.number, r.text, r.matter]);
    expect(rows).toEqual([
      ["1", "Abstract", true],
      ["2", "The body", false],
    ]);
  });

  it("marks nothing without stretches", () => {
    const proj = structureProjection({ root: tree(), focusRow: 0, rungA: 1, rungB: 1, allowParagraphs: false });
    expect(proj.columnA.rows.every((r) => !r.matter)).toBe(true);
  });

  it("marks a row that spans two stretches back to back, and its rows", () => {
    const proj = structureProjection({
      root: tree(),
      focusRow: 6,
      rungA: 1,
      rungB: 1,
      allowParagraphs: false,
      matter: [
        { start: 2, end: 5 },
        { start: 6, end: 9 },
      ],
    });
    expect(proj.columnA.rows.find((r) => r.text === "The body")?.matter).toBe(true);
    expect(proj.columnB.rows.map((r) => [r.text, r.matter])).toEqual([
      ["Method", true],
      ["Results", true],
    ]);
  });

  it("is the same rule in the list face", () => {
    const proj = outlineProjection({
      root: tree(),
      supplementOf: new Map(),
      arcByRow: null,
      focusRow: 0,
      rung: 1,
      allowParagraphs: false,
      matter,
    });
    expect(proj.rows.map((r) => [r.text, r.matter])).toEqual([
      ["Abstract", true],
      ["The body", false],
    ]);
  });
});
