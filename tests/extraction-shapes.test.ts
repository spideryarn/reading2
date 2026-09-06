/**
 * **The shape corpus, as a gate.**
 *
 * [`evals/extraction/shapes.mts`](../evals/extraction/shapes.mts) holds the
 * cases; this runs every one on every change and fails by name. The corpus's own
 * reason for existing is in that file's header, and the short version is § B's
 * diagnosis of itself: **the hand-built cases were written by whoever was fixing
 * the bug, so they demonstrate a fix rather than sample a space.**
 *
 * What is asserted here beyond "each case holds":
 *
 * - **every placement branch and every stamp resolution is exercised by some
 *   case** — a branch nothing reaches is a branch nothing tests, which is
 *   260827ab's "zero regressions" and `first-20-percent`'s "not exercised on any
 *   fixture" wearing a third hat;
 * - **the known holes are still exactly three**, so closing one or opening
 *   another is a deliberate edit rather than a drift;
 * - **the mutation seam is not left on**, because a floor moved by a case that
 *   threw would make every later verdict a verdict about a different instrument.
 *
 * No network, no model, no database.
 */
import { describe, expect, it } from "vitest";

import {
  RUN_PLACEMENTS,
  type RunPlacement,
  currentPlacementFloor,
} from "../evals/extraction/scorecard.mjs";
import {
  SHAPE_CASES,
  SHAPE_PAGES,
  type ShapeVerdict,
  runShape,
  runShapeCorpus,
} from "../evals/extraction/shapes.mjs";

/* One run of the whole matrix, shared: `runShapeCorpus` also carries the
   structural guards (no duplicate names, no page without a candidate). */
const VERDICTS: ShapeVerdict[] = runShapeCorpus();
const byName = new Map(VERDICTS.map((v) => [v.case.name, v]));

describe("the shape corpus — source shape × transformation × gate × resolution path", () => {
  for (const c of SHAPE_CASES) {
    it(`${c.name} (${c.transformation})`, () => {
      /* Re-run rather than reading the shared verdict, so a failure names one
         case and the seam check runs once per case. */
      const v = runShape(c);
      expect(v.problems, `${c.name}: ${v.problems.join("; ")}`).toEqual([]);
      expect(v.ok).toBe(true);
    });
  }

  it("leaves the placement-floor seam where it found it", () => {
    /* A case that threw inside `withPlacementFloor` would leave the instrument
       mutated and every verdict after it would be about a different one. */
    expect(currentPlacementFloor()).toBe(8);
  });
});

describe("the corpus samples a space rather than demonstrating a fix", () => {
  it("exercises every placement branch the order walk has", () => {
    /**
     * **A branch no case reaches is a branch no case tests**, and this repository
     * has shipped that three times over: an eval arm the corpus could not
     * exercise, a `--fixture` argument that selected nothing, an exemption table
     * checked against a run that never ran the pair. The list below is the whole
     * enumeration in `scorecard.mts`, so adding a branch without a shape for it
     * fails here.
     */
    const reached = new Set<RunPlacement>();
    for (const v of VERDICTS) {
      for (const k of RUN_PLACEMENTS) if (v.card.placements.runs[k] > 0) reached.add(k);
    }
    expect([...RUN_PLACEMENTS].filter((k) => !reached.has(k))).toEqual([]);
  });

  it("exercises every way a stamp can resolve, including `none`", () => {
    const reached = new Set<string>();
    for (const v of VERDICTS) {
      for (const [k, n] of Object.entries(v.card.placements.carriers)) if (n > 0) reached.add(k);
    }
    expect([...reached].sort()).toEqual(["ancestor", "descendant", "direct", "none"]);
  });

  it("gives every source shape at least one candidate, and every candidate a control", () => {
    /* The second half is the one that matters: a red card proves nothing unless
       the same page has been seen green. Every page must hold at least one case
       whose two gates both pass. */
    const green = new Set(
      VERDICTS.filter(
        (v) => v.card.gates.attribution.passed === true && v.card.gates.sourceOrder.passed === true,
      ).map((v) => v.case.page),
    );
    expect(SHAPE_PAGES.filter((p) => !green.has(p.name)).map((p) => p.name)).toEqual([]);
  });

  it("still pins exactly three holes, and says what each cannot see", () => {
    /**
     * **A hole is a measurement, not a TODO.** All three assert what the
     * instrument does rather than what it should, so closing any one of them turns
     * this file red on purpose — which is the point: it makes the fix a decision
     * somebody took rather than a behaviour that drifted.
     */
    const holes = VERDICTS.filter((v) => v.case.hole).map((v) => v.case.name);
    expect(holes.sort()).toEqual([
      "a-cell-moved-across-a-row-boundary",
      "a-stamped-inline-moved-across-a-list-item-boundary",
      "borrowing-under-a-text-free-wrapper",
    ]);
  });

  it("shows each hole against a correct extraction of the same page, gate for gate", () => {
    /**
     * **What makes a hole a hole**, said as an assertion rather than in prose: the
     * damaged candidate and a correct extraction of the SAME page get the same
     * verdict from both gates. A case that merely passed could be a page nothing
     * interesting happens on; this is the pair that says the gates cannot tell
     * the two apart. What can, on one of the three, is the placement census —
     * `borrowing-under-a-text-free-wrapper` carries a page-wide run where the
     * correct extraction carries none, which is the whole argument for having it.
     */
    for (const v of VERDICTS.filter((x) => x.case.hole)) {
      const control = VERDICTS.find(
        (x) => x.case.page === v.case.page && x.case.transformation === "verbatim",
      );
      expect(control, `${v.case.name} has no verbatim control on its own page`).toBeDefined();
      for (const g of ["attribution", "sourceOrder"] as const) {
        expect(v.card.gates[g].passed, `${v.case.name}: ${g}`).toBe(true);
        expect(control!.card.gates[g].passed, `${control!.case.name}: ${g}`).toBe(true);
      }
    }
  });

  it("makes the `ancestor`-cannot-supply branch fire, which no shipped fixture does", () => {
    /**
     * The branch GPT Sol's eighth review opened: an owner that cannot place its
     * generated node's run, and a subtree that can. Zero across the fifteen
     * shipped extractions — so if this corpus does not fire it, nothing does.
     */
    const n = VERDICTS.reduce((t, v) => t + v.card.placements.runs.subtreeOnly, 0);
    expect(n).toBeGreaterThan(0);
  });

  it("counts the runs placed page-wide under a stamp their owner has no entry for", () => {
    /**
     * **The ownerless-ancestor hole, as a number rather than a sentence.** It is
     * pinned exactly, because the interesting failure is it going UP — a second
     * shape that quietly starts taking the branch — as much as it going down.
     */
    const n = VERDICTS.reduce((t, v) => t + v.card.placements.ownerlessStamped, 0);
    expect(n).toBe(1);
    const v = byName.get("borrowing-under-a-text-free-wrapper")!;
    expect(v.card.placements.ownerlessStamped).toBe(1);
    expect(v.card.placements.runs.page).toBe(1);
  });
});

describe("the placement floor, which until 2026-09-06 was pinned by nothing", () => {
  /**
   * The finding this closes: dropping `MIN_RUN_IN_ELEMENT` from 8 to 1 in
   * `placeInSpan` — which turns the cover into a bare character subsequence —
   * left all 66 cases in `extraction-scorer.test.ts` green, while six other
   * mutations of the same branch were each caught.
   */
  it("has one shape that comes apart when the floor moves, and says which", () => {
    const withFloor = SHAPE_CASES.filter((c) => c.underFloor);
    expect(withFloor.map((c) => c.name)).toEqual(["borrowed-phrase-spelled-out-by-the-subtree"]);
    /* `runShape` asserts every listed floor's card AND that at least one differs
       from the shipped one; a mutation that changes nothing is a case that has
       stopped pinning anything. */
    const v = runShape(withFloor[0]!);
    expect(v.problems).toEqual([]);
    expect(v.card.gates.sourceOrder.passed, "at the shipped floor the borrowing is caught")
      .toBe(false);
    /* **Both sides of the boundary, so the case says where it is rather than
       only that it exists.** Measured at floors 1–12: green at 1 and 2, red at 3
       and above. Pinning 3 is what stops the shipped constant being loosened by
       one and nothing noticing. */
    expect(withFloor[0]!.underFloor!.map((f) => f.floor)).toEqual([1, 2, 3]);
  });
});
