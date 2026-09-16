/**
 * **What a Structure row's hover card is allowed to say.**
 *
 * Greg asked for the card — *"Add rich tooltips to Structure mode (so I can see
 * summary of that bit of the text)"*, 2026-09-12 — and the whole difficulty is
 * not building it but keeping it from being noise. Structure's two columns are
 * already showing a great deal: the current row prints its own gist once the
 * ladder reaches rung 2, and column B *is* the current part's list of sections.
 * A card that repeats either is the failure docs/project/tooltips.md names
 * outright — a hover that costs a reader a second to discover they knew it
 * already is worse than no card at all.
 *
 * So the card is computed as **what the panel is not already showing**, and that
 * is a pure question about the projection. It is tested here, with no DOM,
 * because a browser can show that a card appeared and cannot show that the card
 * which *should* have been suppressed was.
 *
 * The one thing to be sceptical of in this file is a case that passes because
 * the projection returned no rows at all. Every assertion below reaches a named
 * row first and fails loudly if it is missing.
 *
 * docs/plans/260916b-rich-tooltips-on-structure-mode-rows.md
 */
import { describe, expect, it } from "vitest";
import {
  PARAGRAPH_CAP,
  type StructureCard,
  type StructureRow,
  structureProjection,
} from "../src/web/structure.js";
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
  const id = `c${++seq}` as NodeId;
  const tree: TreeNode = {
    id,
    depth: 1,
    parent: "c0" as NodeId,
    children: (opts.children ?? []).map((c) => c.node.id),
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
      id: "c0" as NodeId,
      depth: 0,
      parent: null,
      children: children.map((c) => c.node.id),
      range: ["spya-croot-a" as BlockId, "spya-croot-z" as BlockId],
      title: "A piece",
    },
    number: "",
    startRow: 0,
    endRow: 999,
    blocks: 1000,
    children,
  };
}

/**
 * Every rung, which is what makes the *suppressions* visible: at rung A 4 and
 * rung B 5 every row prints its own gist, so a card that still offered one would
 * be repeating the line above it on every row in the panel.
 */
const ALL = { rungA: 4, rungB: 5, allowParagraphs: true } as const;

/**
 * The rungs the panel actually draws at today — `STAGE_ONE_RUNG_A` and
 * `STAGE_ONE_RUNG_B` in StructurePanel.tsx, both 2. Only the current row gets a
 * gist, so **carrying the gist is the common case** and it is worth at least one
 * case asking about the shipped configuration rather than the extreme one.
 */
const SHIPPED = { rungA: 2, rungB: 2, allowParagraphs: true } as const;

/** The card's child list as plain words — the ids are React's business, not a test's. */
function labels(card: StructureCard | null | undefined): string[] {
  return (card?.children ?? []).map((c) => c.text);
}

/** Find a row by its text, and fail by name rather than by `undefined.card`. */
function row(rows: readonly StructureRow[], text: string): StructureRow {
  const found = rows.find((r) => r.text === text);
  if (!found) {
    throw new Error(`no row "${text}" — rows were: ${rows.map((r) => r.text).join(", ")}`);
  }
  return found;
}

describe("a Structure row's card", () => {
  /**
   * The base shape: three parts, the reader in the second. The first and third
   * are *not* current, so their sections are nowhere on screen — which is
   * exactly when the card has something to offer.
   */
  function threeParts(): SummaryNode {
    return root([
      node({
        title: "PART ONE",
        number: "1",
        startRow: 0,
        endRow: 9,
        gist: "What part one establishes.",
        children: [
          node({ title: "One A", number: "1.1", startRow: 0, endRow: 4 }),
          node({ title: "One B", number: "1.2", startRow: 5, endRow: 9 }),
        ],
      }),
      node({
        title: "PART TWO",
        number: "2",
        startRow: 10,
        endRow: 19,
        gist: "What part two establishes.",
        children: [
          node({ title: "Two A", number: "2.1", startRow: 10, endRow: 14, gist: "A's gist." }),
          node({ title: "Two B", number: "2.2", startRow: 15, endRow: 19, gist: "B's gist." }),
        ],
      }),
      node({
        title: "PART THREE",
        number: "3",
        startRow: 20,
        endRow: 29,
        gist: "What part three establishes.",
      }),
    ]);
  }

  it("carries the gist and the list of what is inside, for a part the reader is not in", () => {
    const p = structureProjection({ root: threeParts(), focusRow: 12, ...SHIPPED });
    const one = row(p.columnA.rows, "PART ONE");
    /* The premise: at the shipped rung this row prints no gist of its own, so
       the card is the only place that sentence can be read. Asserted rather than
       assumed, because if the rung ever started printing it the case below would
       go red for a reason that has nothing to do with the card. */
    expect(one.gist).toBeUndefined();
    expect(one.card).not.toBeNull();
    expect(one.card?.gist).toBe("What part one establishes.");
    expect(labels(one.card)).toEqual(["One A", "One B"]);
    expect(one.card?.more).toBe(0);
  });

  /**
   * The same row with every rung climbed. Nothing about the node changed; the
   * panel is now printing the sentence itself, so the card stops offering it and
   * keeps only the preview of what is inside.
   */
  it("drops the gist once the ladder is printing it on the row", () => {
    const p = structureProjection({ root: threeParts(), focusRow: 12, ...ALL });
    const one = row(p.columnA.rows, "PART ONE");
    expect(one.gist).toBe("What part one establishes.");
    expect(one.card?.gist).toBeUndefined();
    expect(labels(one.card)).toEqual(["One A", "One B"]);
  });

  /**
   * **The current part is the row with the least to say, not the most.** Its
   * gist is printed on the row by rung 2, and its sections *are* column B. A
   * card here would be the panel reading itself back.
   */
  it("is absent on the current part, whose gist and sections are both on screen", () => {
    const p = structureProjection({ root: threeParts(), focusRow: 12, ...SHIPPED });
    const here = row(p.columnA.rows, "PART TWO");
    expect(here.here).toBe(true);
    expect(here.gist).toBe("What part two establishes.");
    expect(here.card).toBeNull();
  });

  /**
   * The same part, one rung lower. Nothing about the *node* changed; what
   * changed is that the panel is no longer printing the gist, so the card is
   * the only place it can be read.
   */
  it("picks the gist back up when the rung stopped printing it on the row", () => {
    const p = structureProjection({
      root: threeParts(),
      focusRow: 25,
      rungA: 1,
      rungB: 1,
      allowParagraphs: true,
    });
    const r = row(p.columnA.rows, "PART ONE");
    expect(r.gist).toBeUndefined();
    expect(r.card?.gist).toBe("What part one establishes.");
  });

  it("caps the list of children and says how many it left off", () => {
    const many = root([
      node({
        title: "BIG PART",
        number: "1",
        startRow: 0,
        endRow: 19,
        gist: "A large part.",
        children: Array.from({ length: 9 }, (_, i) =>
          node({ title: `Section ${i + 1}`, number: `1.${i + 1}`, startRow: i * 2, endRow: i * 2 + 1 }),
        ),
      }),
      node({ title: "OTHER PART", number: "2", startRow: 20, endRow: 29, gist: "Elsewhere." }),
    ]);
    /* The reader is in the *other* part, so BIG PART's sections are not drawn. */
    const p = structureProjection({ root: many, focusRow: 25, ...ALL });
    const card = row(p.columnA.rows, "BIG PART").card;
    expect(labels(card)).toEqual([
      "Section 1",
      "Section 2",
      "Section 3",
      "Section 4",
      "Section 5",
    ]);
    expect(card?.more).toBe(4);
  });

  /**
   * **Counted after the drop, never before.** A child with neither a title nor a
   * navLabel is not a row anybody can be shown (structure.ts § `rowText`), so
   * counting it would make "+ N more" a promise the card cannot keep — the bug
   * the spine's `BandCard` carries a comment about.
   */
  it("does not count a child it could not name", () => {
    const withBlank = root([
      node({
        title: "PART ONE",
        number: "1",
        startRow: 0,
        endRow: 9,
        gist: "One.",
        children: [
          node({ title: "Named", number: "1.1", startRow: 0, endRow: 4 }),
          node({ title: "", number: "1.2", startRow: 5, endRow: 9 }),
        ],
      }),
      node({ title: "PART TWO", number: "2", startRow: 10, endRow: 19, gist: "Two." }),
    ]);
    const p = structureProjection({ root: withBlank, focusRow: 15, ...ALL });
    const card = row(p.columnA.rows, "PART ONE").card;
    expect(labels(card)).toEqual(["Named"]);
    expect(card?.more).toBe(0);
  });

  describe("when there is no gist", () => {
    it("lets a navLabel stand in", () => {
      const r = root([
        node({
          title: "TITLED",
          number: "1",
          startRow: 0,
          endRow: 9,
          navLabel: "the bit about herons",
        }),
        node({ title: "PART TWO", number: "2", startRow: 10, endRow: 19, gist: "Two." }),
      ]);
      const p = structureProjection({ root: r, focusRow: 15, ...ALL });
      const card = row(p.columnA.rows, "TITLED").card;
      expect(card?.gist).toBeUndefined();
      expect(card?.navLabel).toBe("the bit about herons");
    });

    /**
     * **Never twice.** With no title, `rowText` has already used the navLabel as
     * the row's own text; printing it again underneath in italics reads as a
     * rendering fault rather than as a summary. `BandCard`'s rule, and the
     * reason its condition carries `&& node.title?.trim()`.
     */
    it("does not repeat a navLabel the row is already wearing as its title", () => {
      const r = root([
        node({ title: "", number: "1", startRow: 0, endRow: 9, navLabel: "the bit about herons" }),
        node({ title: "PART TWO", number: "2", startRow: 10, endRow: 19, gist: "Two." }),
      ]);
      const p = structureProjection({ root: r, focusRow: 15, ...ALL });
      const r1 = row(p.columnA.rows, "the bit about herons");
      expect(r1.card).toBeNull();
    });

    it("withholds a leaf navLabel from the card when paragraph labels are not allowed", () => {
      const r = root([
        node({
          title: "TITLED LEAF",
          number: "1",
          startRow: 0,
          endRow: 9,
          navLabel: "the paragraph label that must stay hidden",
        }),
        node({ title: "PART TWO", number: "2", startRow: 10, endRow: 19, gist: "Two." }),
      ]);
      const p = structureProjection({
        root: r,
        focusRow: 15,
        rungA: 4,
        rungB: 5,
        allowParagraphs: false,
      });
      expect(row(p.columnA.rows, "TITLED LEAF").card).toBeNull();
    });
  });

  /**
   * **The apparatus is in the structure and outside the argument**, and three
   * places already keep it that way: it is unnumbered, it is never descended
   * into, and it is never asked for a gist (`makeRow`, `buildSummaryTree`,
   * src/supplement.ts). A card would be the fourth place and the one that broke
   * it — the only thing it could carry is a `navLabel` standing in for the gist
   * the apparatus is deliberately not given, which is the same withholding
   * undone by a different door.
   */
  it("is absent on the apparatus, however much the node happens to carry", () => {
    const r = root([
      node({ title: "PART ONE", number: "1", startRow: 0, endRow: 9, gist: "One." }),
      node({
        title: "Notes",
        number: "",
        startRow: 10,
        endRow: 19,
        navLabel: "the endnotes",
        gist: "A gist no supplement should ever have.",
        supplement: true,
      }),
    ]);
    const p = structureProjection({ root: r, focusRow: 1, ...ALL });
    const notes = row(p.columnA.rows, "Notes");
    expect(notes.supplement).toBe(true);
    /* The row withholds it too — this is the rule the card is being held to. */
    expect(notes.gist).toBeUndefined();
    expect(notes.card).toBeNull();
  });

  /**
   * **A paragraph row gets nothing, and the reason is stronger than tidiness.**
   * Paragraph rows exist only when `allowParagraphs` is true, which the band
   * only sets when the prose is beside it rather than covering it
   * (StructureMode.tsx). So the paragraph itself is on screen, a few centimetres
   * to the right, and a card summarising two sentences the reader can already
   * read is worse than no card.
   */
  it("is absent on a paragraph row", () => {
    const r = root([
      node({
        title: "PART ONE",
        number: "1",
        startRow: 0,
        endRow: 5,
        gist: "One.",
        children: [
          node({
            title: "SECTION",
            number: "1.1",
            startRow: 0,
            endRow: 5,
            gist: "The section.",
            children: [
              node({ title: "", number: "", startRow: 0, endRow: 2, navLabel: "first para" }),
              node({ title: "", number: "", startRow: 3, endRow: 5, navLabel: "second para" }),
            ],
          }),
        ],
      }),
    ]);
    const p = structureProjection({ root: r, focusRow: 1, ...ALL });
    const para = row(p.columnB.rows, "first para");
    expect(para.kind).toBe("paragraph");
    expect(para.card).toBeNull();
  });

  describe("the current section, whose paragraphs may or may not be on screen", () => {
    /** A section of `n` paragraphs, inside one part, with the reader in it. */
    function sectionOf(n: number): SummaryNode {
      return root([
        node({
          title: "PART ONE",
          number: "1",
          startRow: 0,
          endRow: n - 1,
          gist: "One.",
          children: [
            node({
              title: "SECTION",
              number: "1.1",
              startRow: 0,
              endRow: n - 1,
              gist: "The section's gist.",
              children: Array.from({ length: n }, (_, i) =>
                node({ title: "", number: "", startRow: i, endRow: i, navLabel: `para ${i + 1}` }),
              ),
            }),
          ],
        }),
      ]);
    }

    it("offers no card when its gist is on the row and its paragraphs are spliced in beneath it", () => {
      const p = structureProjection({ root: sectionOf(3), focusRow: 1, ...ALL });
      const here = row(p.columnB.rows, "SECTION");
      expect(here.gist).toBe("The section's gist.");
      expect(p.columnB.rows.some((r) => r.kind === "paragraph")).toBe(true);
      expect(here.card).toBeNull();
    });

    /**
     * Over the cap the paragraph run is withheld whole — never truncated — and
     * the panel prints an honest total instead. That total says *how many*; the
     * card is where *which* can still be read.
     */
    it("lists the paragraphs when there were too many to draw", () => {
      const n = PARAGRAPH_CAP + 4;
      const p = structureProjection({ root: sectionOf(n), focusRow: 1, ...ALL });
      expect(p.columnB.rows.some((r) => r.kind === "paragraph")).toBe(false);
      const here = row(p.columnB.rows, "SECTION");
      expect(labels(here.card)).toEqual(["para 1", "para 2", "para 3", "para 4", "para 5"]);
      expect(here.card?.more).toBe(n - 5);
    });

    /**
     * **The rule the card must not be quieter about than the column is.**
     *
     * A paragraph is named by its `navLabel`, and a navLabel is a pointer to
     * prose that must never stand *in place of* prose that could be shown
     * (structure.ts § `StructureInput.allowParagraphs`). So when the band covers
     * the article, or stage 5 has not written the labels, the whole layer is
     * withheld — and a hover card is a smaller surface than a column, not a
     * licence to break the same rule quietly. GPT Sol's review of the plan,
     * finding 1.
     */
    it("names no paragraph at all when the page is in no position to name one", () => {
      const p = structureProjection({
        root: sectionOf(PARAGRAPH_CAP + 4),
        focusRow: 1,
        rungA: 4,
        rungB: 5,
        allowParagraphs: false,
      });
      const here = row(p.columnB.rows, "SECTION");
      /* Its gist is on the row, its paragraphs may not be named, and there is
         nothing else — so there is no card, rather than an empty one. */
      expect(here.gist).toBe("The section's gist.");
      expect(here.card).toBeNull();
    });

    /**
     * A shallow branch can end directly under a part: it is a section by depth
     * and a paragraph by shape, so `rowText` falls back to its leaf navLabel.
     * Column A's cards are a second route to that label, independent of the
     * current section in column B, and must obey the same gate.
     */
    it("does not leak a leaf navLabel through a non-current part's children", () => {
      const r = root([
        node({
          title: "SHALLOW PART",
          number: "1",
          startRow: 0,
          endRow: 9,
          gist: "The shallow part's gist.",
          children: [
            node({
              title: "",
              number: "1.1",
              startRow: 0,
              endRow: 9,
              navLabel: "the paragraph label that must stay hidden",
            }),
          ],
        }),
        node({ title: "CURRENT PART", number: "2", startRow: 10, endRow: 19, gist: "Current." }),
      ]);
      const p = structureProjection({
        root: r,
        focusRow: 15,
        rungA: 2,
        rungB: 2,
        allowParagraphs: false,
      });
      const card = row(p.columnA.rows, "SHALLOW PART").card;
      expect(card?.gist).toBe("The shallow part's gist.");
      expect(labels(card)).toEqual([]);
    });

    /**
     * **The rung the panel actually draws at today is 2, so this is the shape
     * that ships**: no paragraph rows anywhere in the mode, and the card is the
     * only place the level below the section can be seen at all. GPT Sol's
     * review of the plan, finding 1 — the plan had reasoned about rung 3 as
     * though it were on.
     */
    it("is, at the shipped rung, the only place the current section's paragraphs appear", () => {
      const p = structureProjection({ root: sectionOf(3), focusRow: 1, ...SHIPPED });
      expect(p.columnB.rows.some((r) => r.kind === "paragraph")).toBe(false);
      const here = row(p.columnB.rows, "SECTION");
      expect(labels(here.card)).toEqual(["para 1", "para 2", "para 3"]);
    });
  });
});
