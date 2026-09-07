/**
 * **Structure mode's projection: what each column draws, and which row says "you
 * are here".**
 *
 * `structureProjection` is pure and takes no DOM, so it is tested directly.
 * Everything asserted here is about the *tree* — which part contains the focus
 * row, which sections belong to it, what a supplement's number is, when a
 * paragraph list is drawn and when it becomes a count — and none of it is about
 * rendering. The panel's own output is covered by
 * tests/every-mode-draws-its-surface.test.tsx § `DRAWS` and by
 * tests/public-network-trace.test.tsx § `BAND_SAYS`, which between them assert
 * that **both** columns reach the screen.
 *
 * **Hand-built trees, never `data/`.** That directory is gitignored, so a test
 * reading it does not travel to CI or to another checkout; and in a worktree it
 * is the *fixture* cut copied by `npm run worktree:setup`, not the corpus, so a
 * number measured from it would be a claim about the fixtures wearing the
 * corpus's name. GPT Sol's review of the plan, findings 4 and 5.
 *
 * The one thing to be sceptical of in this file is a test that passes because
 * the projection returned nothing. Every case below asserts on content rather
 * than only on absence, for that reason.
 *
 * docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md
 */
import { describe, expect, it } from "vitest";
import { PARAGRAPH_CAP, structureProjection } from "../src/web/structure.js";
import type { SummaryNode } from "../src/web/tree.js";
import type { BlockId, NodeId, TreeNode } from "../src/types.js";

let seq = 0;

function node(opts: {
  title: string;
  number: string;
  startRow: number;
  endRow: number;
  navLabel?: string;
  gist?: string;
  supplement?: true;
  children?: SummaryNode[];
}): SummaryNode {
  const id = `n${++seq}` as NodeId;
  const tree: TreeNode = {
    id,
    depth: 1,
    parent: "n0" as NodeId,
    children: [],
    range: [`spya-${id}a` as BlockId, `spya-${id}z` as BlockId],
    title: opts.title,
  };
  if (opts.navLabel !== undefined) tree.navLabel = opts.navLabel;
  const summary: SummaryNode = {
    node: tree,
    number: opts.number,
    startRow: opts.startRow,
    endRow: opts.endRow,
    blocks: opts.endRow - opts.startRow + 1,
    children: opts.children ?? [],
  };
  if (opts.gist !== undefined) summary.gist = opts.gist;
  if (opts.supplement === true) summary.supplement = true;
  return summary;
}

function root(children: SummaryNode[]): SummaryNode {
  return {
    node: {
      id: "n0" as NodeId,
      depth: 0,
      parent: null,
      children: children.map((c) => c.node.id),
      range: ["spya-root-a" as BlockId, "spya-root-z" as BlockId],
      title: "A piece",
    },
    number: "",
    startRow: 0,
    endRow: 999,
    blocks: 1000,
    children,
  };
}

/** Paragraph children for a section, `n` of them, filling its range. */
function paras(n: number, from: number): SummaryNode[] {
  return Array.from({ length: n }, (_, i) =>
    node({ title: `p${i + 1}`, number: `x.${i + 1}`, startRow: from + i, endRow: from + i }),
  );
}

const ALL = {
  rungA: 4,
  rungB: 5,
  allowParagraphs: true,
} as const;

/**
 * **Five parts, and the middle one has five sections.** The reader is in part 3,
 * section 3.3 — the middle of the middle.
 *
 * Five and not three, and that is GPT Sol's code review finding 7: with three
 * parts, "the current one and its two neighbours" is *everybody*, so rungs 3 and
 * 4 are indistinguishable and an implementation that made them identical passed
 * all sixteen tests. The same held for column B. Five is the smallest size at
 * which "near" and "all" are different answers, on both sides.
 */
function corpus() {
  return root([
    node({ title: "P1", number: "1", startRow: 0, endRow: 9, gist: "g1" }),
    node({ title: "P2", number: "2", startRow: 10, endRow: 19, gist: "g2" }),
    node({
      title: "P3",
      number: "3",
      startRow: 20,
      endRow: 69,
      gist: "g3",
      children: [
        node({ title: "S1", number: "3.1", startRow: 20, endRow: 29, gist: "s1" }),
        node({ title: "S2", number: "3.2", startRow: 30, endRow: 39, gist: "s2" }),
        node({
          title: "S3",
          number: "3.3",
          startRow: 40,
          endRow: 49,
          gist: "s3",
          children: paras(3, 40),
        }),
        node({ title: "S4", number: "3.4", startRow: 50, endRow: 59, gist: "s4" }),
        node({ title: "S5", number: "3.5", startRow: 60, endRow: 69, gist: "s5" }),
      ],
    }),
    node({ title: "P4", number: "4", startRow: 70, endRow: 79, gist: "g4" }),
    node({ title: "P5", number: "5", startRow: 80, endRow: 89, gist: "g5" }),
  ]);
}

/** The reader is in P3 / S3 — the middle of the middle. */
const IN_S3 = 42;

describe("structureProjection", () => {
  it("puts every part in column A and only the current part's sections in column B", () => {
    const p = structureProjection({ root: corpus(), focusRow: IN_S3, ...ALL });

    expect(p.columnA.rows.map((r) => r.text)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    /* **The sections of the part the reader is in, and no others.** This is the
       claim the mode's whole card makes — "the right-hand column is always the
       inside of the row marked in the left" — so it is asserted as an identity
       rather than as a `toContain`, which would pass over a column that had
       every section in the article. */
    expect(p.columnB.rows.filter((r) => r.kind === "section").map((r) => r.text)).toEqual([
      "S1",
      "S2",
      "S3",
      "S4",
      "S5",
    ]);
    expect(p.ofPart?.text).toBe("P3");
    expect(p.ofPart?.number).toBe("3");
  });

  it("points every row at its own first block", () => {
    /* **The jump target, which nothing asserted until GPT Sol replaced every
       `blockId` with one wrong constant and all 22 tests stayed green** (code
       review, finding 7). A row that jumps somewhere else is the worst kind of
       bug this mode can have — it looks entirely correct until you press it, and
       then it silently moves the reader. Ids come from the fixture's own nodes,
       so this compares the projection against the tree rather than against a
       list retyped here. */
    const tree = corpus();
    const p = structureProjection({ root: tree, focusRow: IN_S3, ...ALL });

    const expectedA = tree.children.map((c) => c.node.range[0]);
    expect(p.columnA.rows.map((r) => r.blockId)).toEqual(expectedA);
    /* And they are all different, or a projection handing every row the same id
       would satisfy the line above on a one-part tree. */
    expect(new Set(expectedA).size).toBe(expectedA.length);

    const part3 = tree.children[2];
    expect(p.columnB.rows.filter((r) => r.kind === "section").map((r) => r.blockId)).toEqual(
      part3?.children.map((c) => c.node.range[0]),
    );
    expect(p.columnB.rows.filter((r) => r.kind === "paragraph").map((r) => r.blockId)).toEqual(
      part3?.children[2]?.children.map((c) => c.node.range[0]),
    );
  });

  it("marks the same part in A and the same section in B, from one selection", () => {
    const p = structureProjection({ root: corpus(), focusRow: IN_S3, ...ALL });

    /* The two columns agreeing is the property, not two separate facts: a
       projection computing "current" twice can mark part 2 on the left while
       listing part 3's sections on the right, and nothing errors. */
    expect(p.columnA.rows.filter((r) => r.here).map((r) => r.text)).toEqual(["P3"]);
    expect(p.columnB.rows.filter((r) => r.here).map((r) => r.text)).toEqual(["S3"]);
  });

  it("re-fills column B when the reader crosses into another part", () => {
    const tree = corpus();
    expect(
      structureProjection({ root: tree, focusRow: 5, ...ALL }).columnB.rows.map((r) => r.text),
    ).toEqual([]);
    expect(
      structureProjection({ root: tree, focusRow: 55, ...ALL })
        .columnB.rows.filter((r) => r.kind === "section")
        .map((r) => r.text),
    ).toEqual(["S1", "S2", "S3", "S4", "S5"]);
    /* Column A is the same list at both, which is the half of the design that
       makes the pair readable: the document does not move, only what you are
       looking inside does. */
    expect(
      structureProjection({ root: tree, focusRow: 55, ...ALL }).columnA.rows.map((r) => r.text),
    ).toEqual(["P1", "P2", "P3", "P4", "P5"]);
  });

  it("draws no column B and says so when the reader is between parts", () => {
    /* Not a failure: the tree need not cover every block, so a run of prose under
       no part leaves the reader genuinely outside all of them. What the
       projection must not do is guess a part. */
    const p = structureProjection({ root: corpus(), focusRow: 500, ...ALL });
    expect(p.ofPart).toBeNull();
    expect(p.columnB.rows).toEqual([]);
    /* And column A is still the whole document — the positive control, without
       which this test would pass over a projection that returned nothing. */
    expect(p.columnA.rows).toHaveLength(5);
    expect(p.columnA.rows.some((r) => r.here)).toBe(false);
  });

  it("draws no column B for a current part that has no text to name it", () => {
    /* Otherwise the right-hand column is the inside of a row that is not on
       screen and is not marked: column A drops a titleless part (`rowText`), so
       the selection has to drop it too or the two disagree. GPT Sol's code
       review, finding 4. */
    const p = structureProjection({
      root: root([
        node({
          title: "",
          number: "1",
          startRow: 0,
          endRow: 19,
          children: [node({ title: "S", number: "1.1", startRow: 0, endRow: 19 })],
        }),
        node({ title: "P2", number: "2", startRow: 20, endRow: 29 }),
      ]),
      focusRow: 5,
      ...ALL,
    });
    expect(p.columnA.rows.map((r) => r.text)).toEqual(["P2"]);
    expect(p.columnA.rows.some((r) => r.here)).toBe(false);
    expect(p.ofPart).toBeNull();
    expect(p.columnB.rows).toEqual([]);
  });

  describe("the rungs", () => {
    it("gives column A gists to nobody, the current row, its neighbours, then everybody", () => {
      const withGists = (rungA: 1 | 2 | 3 | 4) =>
        structureProjection({ root: corpus(), focusRow: IN_S3, rungA, rungB: 1, allowParagraphs: true })
          .columnA.rows.filter((r) => r.gist !== undefined)
          .map((r) => r.text);

      expect(withGists(1)).toEqual([]);
      expect(withGists(2)).toEqual(["P3"]);
      /* Both neighbours, not one: "near" is a quantity of extra detail spent on
         either side of the reader, so an asymmetric answer would be a bug that
         reads as a design. */
      expect(withGists(3)).toEqual(["P2", "P3", "P4"]);
      /* **And rung 4 is more than rung 3**, which needed five parts to be able to
         say: with three, "the current one and its neighbours" is everybody, so an
         implementation with rung 4 identical to rung 3 passed. Sol's finding 7. */
      expect(withGists(4)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    });

    it("gives column B gists on the same ladder, one rung later", () => {
      /* Never asserted at all before Sol's finding 7 — column B's rungs 4 and 5
         were entirely uncovered, and deleting their behaviour left every test
         green. */
      const withGists = (rungB: 1 | 2 | 3 | 4 | 5) =>
        structureProjection({ root: corpus(), focusRow: IN_S3, rungA: 1, rungB, allowParagraphs: true })
          .columnB.rows.filter((r) => r.kind === "section" && r.gist !== undefined)
          .map((r) => r.text);

      expect(withGists(1)).toEqual([]);
      expect(withGists(2)).toEqual(["S3"]);
      expect(withGists(3)).toEqual(["S3"]);
      expect(withGists(4)).toEqual(["S2", "S3", "S4"]);
      expect(withGists(5)).toEqual(["S1", "S2", "S3", "S4", "S5"]);
    });

    it("never draws less at a higher rung, on either column", () => {
      /* **Monotonicity, as a property rather than as five examples.** A ladder
         whose higher rung draws fewer rows is the failure mode this design is
         most exposed to — two columns, two ladders and a window between them —
         and it is exactly what the combined section-and-paragraph window used to
         do (Sol's finding 3). */
      const count = (rungA: 1 | 2 | 3 | 4, rungB: 1 | 2 | 3 | 4 | 5) => {
        const p = structureProjection({
          root: corpus(),
          focusRow: IN_S3,
          rungA,
          rungB,
          allowParagraphs: true,
          limitB: 6,
        });
        return {
          a: p.columnA.rows.filter((r) => r.gist !== undefined).length,
          sections: p.columnB.rows.filter((r) => r.kind === "section").length,
          rows: p.columnB.rows.length,
        };
      };

      for (const rungA of [2, 3, 4] as const) {
        expect(count(rungA, 1).a, `A rung ${rungA}`).toBeGreaterThanOrEqual(count(1, 1).a);
      }
      /* The mandatory sibling level never shrinks as the optional detail above it
         is switched on — the specific inversion the old code had. */
      for (const rungB of [2, 3, 4, 5] as const) {
        expect(count(1, rungB).sections, `B rung ${rungB}`).toBe(count(1, 1).sections);
        expect(count(1, rungB).rows, `B rung ${rungB}`).toBeGreaterThanOrEqual(count(1, 1).rows);
      }
    });

    it("adds the current section's paragraphs at rung 3 and not before", () => {
      const paragraphs = (rungB: 1 | 2 | 3 | 4 | 5) =>
        structureProjection({ root: corpus(), focusRow: IN_S3, rungA: 1, rungB, allowParagraphs: true })
          .columnB.rows.filter((r) => r.kind === "paragraph")
          .map((r) => r.text);

      expect(paragraphs(2)).toEqual([]);
      expect(paragraphs(3)).toEqual(["p1", "p2", "p3"]);
    });

    it("puts the paragraphs under their own section and nowhere else", () => {
      /* The order matters: a flat column that appended every paragraph at the end
         would satisfy a `toContain` and be a different mode. */
      const rows = structureProjection({ root: corpus(), focusRow: IN_S3, ...ALL }).columnB.rows;
      expect(rows.map((r) => `${r.kind}:${r.text}`)).toEqual([
        "section:S1",
        "section:S2",
        "section:S3",
        "paragraph:p1",
        "paragraph:p2",
        "paragraph:p3",
        "section:S4",
        "section:S5",
      ]);
    });

    it("drops the whole paragraph rung rather than truncating it when the column is tight", () => {
      /* **The inversion Sol's finding 3 names, from the other side.** With the
         combined list windowed, a five-section column with a limit of five and
         the paragraph rung on would replace sections S4 and S5 with paragraphs
         p1 and p2 — a higher rung drawing less of the mandatory level, and a
         paragraph run cut in half despite the "all or none" promise. */
      const p = structureProjection({
        root: corpus(),
        focusRow: IN_S3,
        rungA: 1,
        rungB: 3,
        allowParagraphs: true,
        limitB: 5,
      });
      expect(p.columnB.rows.map((r) => r.text)).toEqual(["S1", "S2", "S3", "S4", "S5"]);
      expect(p.columnB.rows.filter((r) => r.kind === "paragraph")).toEqual([]);
      /* And the counts stay counts of *sections*, which is the level the window
         is over. Nothing is hidden here, so both are zero. */
      expect(p.columnB.earlier).toBe(0);
      expect(p.columnB.later).toBe(0);
    });

    it("draws the paragraphs when there is room for the whole run", () => {
      /* The positive control for the test above: with one more row of budget the
         rung comes back whole, so that test is about *tightness* rather than
         about paragraphs never drawing. */
      const p = structureProjection({
        root: corpus(),
        focusRow: IN_S3,
        rungA: 1,
        rungB: 3,
        allowParagraphs: true,
        limitB: 8,
      });
      expect(p.columnB.rows.filter((r) => r.kind === "paragraph").map((r) => r.text)).toEqual([
        "p1",
        "p2",
        "p3",
      ]);
    });
  });

  describe("paragraphs have no centre", () => {
    const bigSection = (n: number) =>
      root([
        node({
          title: "Middles",
          number: "1",
          startRow: 0,
          endRow: 99,
          children: [
            node({
              title: "Long",
              number: "1.1",
              startRow: 0,
              endRow: 99,
              gist: "A big one.",
              children: paras(n, 0),
            }),
          ],
        }),
      ]);

    it("never marks a paragraph as current, however deep the reader is in it", () => {
      /* `focusRow` is section-granular, so the deepest row *containing* the
         reader is always the section's FIRST paragraph — a mark that would be
         wrong far more often than right and look entirely plausible. Asserted
         across the whole range rather than at one row, because a bug here would
         only show at the top of a section. */
      for (const at of [0, 1, 2]) {
        const p = structureProjection({ root: bigSection(3), focusRow: at, ...ALL });
        expect(p.columnB.rows.filter((r) => r.kind === "paragraph" && r.here)).toEqual([]);
        /* And the section above them is still marked — otherwise this would pass
           on a projection that marked nothing at all. */
        expect(p.columnB.rows.filter((r) => r.here).map((r) => r.text)).toEqual(["Long"]);
      }
    });

    it("draws all the paragraphs up to the cap, and none past it", () => {
      const at = PARAGRAPH_CAP;
      const under = structureProjection({ root: bigSection(at), focusRow: 0, ...ALL });
      expect(under.columnB.rows.filter((r) => r.kind === "paragraph")).toHaveLength(at);
      expect(under.paragraphTotal).toBeNull();

      /* **All or none, never a truncation**, which would say the section ends
         where the list does. And never a window, which would say we know where
         in it the reader is. */
      const over = structureProjection({ root: bigSection(at + 1), focusRow: 0, ...ALL });
      expect(over.columnB.rows.filter((r) => r.kind === "paragraph")).toEqual([]);
      expect(over.paragraphTotal).toBe(at + 1);
    });

    it("withholds the layer without a count when paragraph rows are not permissible at all", () => {
      /* Two different absences. Too many to draw is about *this section*, and the
         count is the honest thing to say instead. `allowParagraphs: false` — the
         band covers the prose, or stage 5's labels are not written yet — is about
         the *page*, and a count there would explain the wrong absence: the reader
         would read "26 paragraphs" as the reason they cannot see them. */
      const p = structureProjection({
        root: bigSection(PARAGRAPH_CAP + 1),
        focusRow: 0,
        rungA: 4,
        rungB: 5,
        allowParagraphs: false,
      });
      expect(p.columnB.rows.filter((r) => r.kind === "paragraph")).toEqual([]);
      expect(p.paragraphTotal).toBeNull();
      /* The rungs below still draw, which is what withholding a layer means. */
      expect(p.columnB.rows.map((r) => r.text)).toEqual(["Long"]);
      expect(p.columnB.rows[0]?.gist).toBe("A big one.");
    });
  });

  describe("the window on a column that will not fit", () => {
    const many = root(
      Array.from({ length: 11 }, (_, i) =>
        node({ title: `P${i + 1}`, number: `${i + 1}`, startRow: i * 10, endRow: i * 10 + 9 }),
      ),
    );

    it("keeps the rows around the reader and counts the rest, at both ends", () => {
      /* The reader is in P6, the middle. A window of five keeps 4..8. */
      const p = structureProjection({ root: many, focusRow: 52, ...ALL, limitA: 5 });
      expect(p.columnA.rows.map((r) => r.text)).toEqual(["P4", "P5", "P6", "P7", "P8"]);
      expect(p.columnA.earlier).toBe(3);
      expect(p.columnA.later).toBe(3);
      /* The counts and the rows have to agree, or the level's shape is a lie. */
      expect(p.columnA.earlier + p.columnA.rows.length + p.columnA.later).toBe(11);
    });

    it("does not run off either end of the list", () => {
      const first = structureProjection({ root: many, focusRow: 2, ...ALL, limitA: 5 });
      expect(first.columnA.rows.map((r) => r.text)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
      expect(first.columnA.earlier).toBe(0);
      expect(first.columnA.later).toBe(6);

      const last = structureProjection({ root: many, focusRow: 105, ...ALL, limitA: 5 });
      expect(last.columnA.rows.map((r) => r.text)).toEqual(["P7", "P8", "P9", "P10", "P11"]);
      expect(last.columnA.earlier).toBe(6);
      expect(last.columnA.later).toBe(0);
    });

    it("hides nothing and counts nothing when everything fits", () => {
      const p = structureProjection({ root: many, focusRow: 52, ...ALL, limitA: 20 });
      expect(p.columnA.rows).toHaveLength(11);
      expect(p.columnA.earlier).toBe(0);
      expect(p.columnA.later).toBe(0);
    });

    it("draws no rows at all for a capacity of zero, and says which side of you they are on", () => {
      /* **A capacity of zero used to draw everything.** `limit <= 0` fell into
         the no-limit branch, so a column measured as having room for nothing
         produced the *maximum* overflow — the failure inverted, and silent,
         because the panel clips rather than scrolls. GPT Sol's code review,
         finding 3. The counts split at the reader rather than calling all eleven
         "later", which is the only thing left to say once no row fits. */
      const p = structureProjection({ root: many, focusRow: 52, ...ALL, limitA: 0 });
      expect(p.columnA.rows).toEqual([]);
      expect(p.columnA.earlier).toBe(5);
      expect(p.columnA.later).toBe(6);
      expect(p.columnA.earlier + p.columnA.later).toBe(11);
    });
  });

  describe("the rows a tree does not give cleanly", () => {
    it("falls back to a navLabel, drops a part with no text at all, and leaves the numbers alone", () => {
      const p = structureProjection({
        root: root([
          node({ title: "  ", navLabel: "The bit about ships", number: "1", startRow: 0, endRow: 9 }),
          node({ title: "", number: "2", startRow: 10, endRow: 19 }),
          node({ title: "Ends", number: "3", startRow: 20, endRow: 29 }),
        ]),
        focusRow: 0,
        ...ALL,
      });

      /* A whitespace-only title is not a title, and `"  "` rather than `""` is
         the shape the corpus has: `if (title)` on an untrimmed string passes it
         through as a blank row. */
      expect(p.columnA.rows.map((r) => r.text)).toEqual(["The bit about ships", "Ends"]);
      /* **The gap in the numbering is deliberate.** Renumbering to 1, 2 would
         tell the reader the third part is the second one, while the spine,
         Outline and Hierarchy all still call it the third. */
      expect(p.columnA.rows.map((r) => r.number)).toEqual(["1", "3"]);
    });

    it("gives the supplement a row with no number, does not open it, and still lets it be current", () => {
      const p = structureProjection({
        root: root([
          node({ title: "Openings", number: "1", startRow: 0, endRow: 9 }),
          node({
            title: "Notes",
            number: "2",
            startRow: 10,
            endRow: 19,
            supplement: true,
            children: [node({ title: "A note", number: "2.1", startRow: 10, endRow: 19 })],
          }),
        ]),
        focusRow: 12,
        ...ALL,
      });

      const supp = p.columnA.rows[1];
      expect(supp?.number).toBe("");
      expect(supp?.supplement).toBe(true);
      /* Still a place the reader can be: losing the mark inside the apparatus
         would have the panel claim they are nowhere. */
      expect(supp?.here).toBe(true);
      /* **But it is not opened.** The apparatus is outside the argument, and
         listing its structure in column B would put the endnotes on a par with
         the article's own parts. */
      expect(p.columnB.rows).toEqual([]);
      expect(p.columnA.rows[0]?.number).toBe("1");
    });

    it("returns two empty columns for a null tree and for a tree with no parts", () => {
      for (const tree of [null, root([])]) {
        const p = structureProjection({ root: tree, focusRow: 0, ...ALL });
        expect(p.columnA.rows).toEqual([]);
        expect(p.columnB.rows).toEqual([]);
        expect(p.ofPart).toBeNull();
      }
    });
  });
});
