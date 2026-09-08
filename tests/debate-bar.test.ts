/**
 * **The identification bar's one pass, and the two things it must never do.**
 *
 * Debate's group-one rows carry the name of the strongest evidence that the page
 * is about *this* article — it links the address, it quotes the article's own
 * words, or it names the title — and since 2026-09-06 the reader can set a floor
 * under that (`?name=`, docs/plans/260906b-…md § "The bar").
 *
 * The panel's own rendering is covered next door in debate-panel.test.tsx. What
 * is here is the rule underneath, tested without a DOM, because two of its
 * properties are invisible on screen until they are wrong:
 *
 *  1. **The order.** `named` is weaker than `quoted` is weaker than `linked`,
 *     and the ordering is a fact about evidence rather than a preference — a
 *     page that links this article's address has done the one thing a page about
 *     a *different* document with the same title cannot. Inverted, every
 *     assertion about "the default hides the weak ones" still reads plausibly
 *     while the panel hides exactly the rows worth keeping.
 *  2. **Claim rows are not in it.** They carry no level at all, so they are not
 *     hidden by this, not in its `N of M`, and not in what it says it is holding
 *     back. `threshold.ts` names a count that disagrees with the list under it as
 *     this feature's worst failure, and the way to produce one here is to let a
 *     claim row into either number.
 *
 * The default is the third thing, and it was measured rather than chosen: see
 * `DEBATE_LEVEL_DEFAULT`, and the plan's § Stage P for the corpus numbers.
 */
import { describe, expect, it } from "vitest";

import {
  DEBATE_LEVEL_DEFAULT,
  IDENTIFICATION_STOPS,
  isIdentificationLevel,
  stopAt,
  stopIndex,
  visibleDirect,
} from "../src/web/debate-levels.js";
import {
  type BlockId,
  type DirectDebateRow,
  type IdentificationSignal,
  identificationLevel,
} from "../src/types.js";

const KNOWN = "spya-k3m9qt" as BlockId;

function row(id: string, identifies: IdentificationSignal[]): DirectDebateRow {
  return {
    id,
    url: `https://example.org/${id}`,
    title: "A page",
    sourceQuote: "the third section does not survive its own second",
    articleReferenceQuote: "Notes on my sourdough starter, week 3",
    relation: "disputes",
    lean: "leans-against",
    applies: "It says the piece contradicts itself.",
    identifies,
  };
}

const NAMED = row("spya-d2w4r2", [
  { kind: "named", by: "title", witness: "Notes on my sourdough starter, week 3" },
]);
const QUOTED = row("spya-d2w4r3", [
  { kind: "quoted", quote: "a starter needs cool water", blockId: KNOWN, coverage: 0.04, density: 0.13 },
  { kind: "named", by: "title", witness: "Notes on my sourdough starter, week 3" },
]);
const LINKED = row("spya-d2w4r4", [
  { kind: "linked", url: "https://example.net/the-piece" },
  { kind: "named", by: "title", witness: "Notes on my sourdough starter, week 3" },
]);
const ALL = [NAMED, QUOTED, LINKED];

describe("the three stops, and the order they are in", () => {
  /* The positive control for everything below: if the track and the strength
     order ever disagree, the slider walks the stops in one order and hides rows
     in another, and every assertion about a *level* still passes. */
  it("runs weakest first, so left shows everything and right shows least", () => {
    expect([...IDENTIFICATION_STOPS]).toEqual(["named", "quoted", "linked"]);
    expect(IDENTIFICATION_STOPS.map(stopIndex)).toEqual([0, 1, 2]);
    expect(IDENTIFICATION_STOPS.map((_, i) => stopAt(i))).toEqual([...IDENTIFICATION_STOPS]);
    /* A track position nobody can reach resolves to the default rather than
       throwing — the same rule the parser follows for a word nobody defined. */
    expect(stopAt(9)).toBe(DEBATE_LEVEL_DEFAULT);
  });

  it("reads the three words and refuses everything else", () => {
    for (const level of IDENTIFICATION_STOPS) expect(isIdentificationLevel(level)).toBe(true);
    for (const junk of ["Named", "quotes", "", "0", null, undefined]) {
      expect(isIdentificationLevel(junk), String(junk)).toBe(false);
    }
  });

  it("takes each row's strongest signal, not its first", () => {
    /* The rows above deliberately carry `named` alongside the stronger fact,
       because that is what a real row looks like: a page that links the article
       usually names it too. A bar reading the first element would hide both. */
    expect(identificationLevel(LINKED)).toBe("linked");
    expect(identificationLevel(QUOTED)).toBe("quoted");
    expect(identificationLevel(NAMED)).toBe("named");
  });
});

describe("what the bar keeps at each stop", () => {
  it("shows everything at its weakest stop", () => {
    const { visible, hiddenCount } = visibleDirect(ALL, "named");
    expect(visible).toEqual(ALL);
    expect(hiddenCount).toBe(0);
  });

  it("hides the named-only row at the default, and keeps the other two", () => {
    expect(DEBATE_LEVEL_DEFAULT).toBe("quoted");
    const { visible, hiddenCount } = visibleDirect(ALL, DEBATE_LEVEL_DEFAULT);
    expect(visible.map((r) => r.id)).toEqual([QUOTED.id, LINKED.id]);
    expect(hiddenCount).toBe(1);
  });

  it("hides a quoting page at the strictest stop, and keeps only the linking one", () => {
    /* The half of the order the default cannot test. Invert the rank and this is
       the assertion that goes red — the one above still passes, because it only
       says the weakest row goes. */
    const { visible, hiddenCount } = visibleDirect(ALL, "linked");
    expect(visible.map((r) => r.id)).toEqual([LINKED.id]);
    expect(hiddenCount).toBe(2);
  });

  it("leaves the rows in the order they arrived, at every stop", () => {
    /* `DEBATE_NO_RANKING`: the list is search order and position carries no
       claim, so a bar that sorted by level would make it carry one. */
    const shuffled = [LINKED, NAMED, QUOTED];
    expect(visibleDirect(shuffled, "named").visible.map((r) => r.id)).toEqual(
      shuffled.map((r) => r.id),
    );
    expect(visibleDirect(shuffled, "quoted").visible.map((r) => r.id)).toEqual([
      LINKED.id,
      QUOTED.id,
    ]);
  });

  it("counts what it hides and what it shows to the whole list, always", () => {
    /* The one-pass promise: `visible.length + hiddenCount` is the list, at every
       stop. A filter beside a counter is how the two come apart. */
    for (const stop of IDENTIFICATION_STOPS) {
      const { visible, hiddenCount } = visibleDirect(ALL, stop);
      expect(visible.length + hiddenCount, stop).toBe(ALL.length);
    }
  });

  it("reads a row stored before the field existed as its weakest, and hides it at the default", () => {
    /* Every artefact written before 2026-09-06 has no `identifies` key at all;
       `identifiesOf` reads it as `named` on the witness that kept it. That is
       what the field would have said, and it means an old artefact meets the
       default as the decoy does rather than sailing past it. */
    const old = { ...NAMED } as Partial<DirectDebateRow> & { identifies?: unknown };
    delete old.identifies;
    const rows = [old as DirectDebateRow, QUOTED];
    expect(visibleDirect(rows, DEBATE_LEVEL_DEFAULT).visible.map((r) => r.id)).toEqual([QUOTED.id]);
  });
});
