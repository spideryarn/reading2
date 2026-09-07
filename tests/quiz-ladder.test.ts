/**
 * **The adaptive ladder** — which question comes next, and the invariant it is
 * allowed to change.
 *
 * Pure: no model, no network, no React. That is the point of putting the rule
 * in src/web/quiz-ladder.ts rather than inside the panel — a walk over a batch is
 * simulatable, so the plan's worked trace and these tests read the same code
 * the reader does.
 *
 * The cases worth having are the quiet ones. A ladder that silently stops
 * moving, repeats a question, or hands a struggling reader the hardest thing in
 * the batch looks from the outside exactly like a quiz — nothing goes red and
 * nobody is told (docs/reusable/silent-success.md). So:
 *
 * - **every cell of the nine-cell table**, because a table is exactly the shape
 *   that gets one entry wrong and stays plausible;
 * - **the bounded ends**, because `right` at `hard` and `wrong` at `easy` have
 *   nowhere to go and the obvious `index ± 1` walks off both;
 * - **an empty band**, because 6/3/3 is a typical batch and `medium` empties
 *   first — this is the common case, not an exotic one;
 * - **absence**, because it is a designed outcome rather than an error path:
 *   the classifier failing must hold the band, not stall or throw;
 * - **the amended invariant**, below, which is the one assertion here that is
 *   about the design rather than the code.
 *
 * docs/plans/260907d-make-the-quiz-adaptive.md.
 */
import { describe, expect, it } from "vitest";
import { firstQuestion, nextQuestion } from "../src/web/quiz-ladder.js";
import type { QuizBand, QuizQuestion, QuizVerdict } from "../src/types.js";

/**
 * A question with only the fields the ladder reads. The rest of `QuizQuestion`
 * — the reference answer, the evidence — is nothing to do with selection, and
 * filling it in here would suggest it was.
 */
function q(id: string, band: QuizBand, value: number): QuizQuestion {
  return {
    id,
    question: `${id}?`,
    referenceAnswer: "",
    evidence: [],
    band,
    value,
  };
}

/**
 * A batch in **the server's order** — band, then value descending, then
 * document position, which is what `orderQuestions` produces. Every test here
 * depends on that being the input, because the whole design is that the client
 * reads this order rather than making its own.
 *
 * Shaped 6/3/3, which quiz.md records as a typical batch since the prompt
 * started leaning easy on 2026-09-05.
 */
const BATCH: QuizQuestion[] = [
  q("e1", "easy", 5),
  q("e2", "easy", 5),
  q("e3", "easy", 4),
  q("e4", "easy", 4),
  q("e5", "easy", 3),
  q("e6", "easy", 2),
  q("m1", "medium", 5),
  q("m2", "medium", 4),
  q("m3", "medium", 3),
  q("h1", "hard", 5),
  q("h2", "hard", 4),
  q("h3", "hard", 3),
];

/** The id the ladder picks, which is all any of these cases care about. */
function next(
  seen: string[],
  from: QuizBand,
  verdict: QuizVerdict | undefined,
  batch: QuizQuestion[] = BATCH,
): string | undefined {
  return nextQuestion(batch, seen, from, verdict)?.id;
}

describe("where the quiz opens", () => {
  it("starts at the front of the server's array", () => {
    expect(firstQuestion(BATCH)?.id).toBe("e1");
  });

  /**
   * The plan's first draft said "the first question is always easy". It is not:
   * `missingBandEnds` exempts any batch below `SPREAD_FROM` (= 4) from the
   * spread rule, so a short article can come back with no `easy` question at
   * all. What survives is the weaker, true claim — the front of the array.
   */
  it("does not require an easy question to exist", () => {
    const short = [q("m1", "medium", 5), q("h1", "hard", 4), q("m2", "medium", 3)];
    expect(firstQuestion(short)?.id).toBe("m1");
  });

  it("has nothing to open with when the batch is empty", () => {
    expect(firstQuestion([])).toBeUndefined();
  });
});

describe("the nine-cell table", () => {
  /* Right: one band harder, bounded at `hard`. */
  it("easy answered right goes to medium", () => {
    expect(next(["e1"], "easy", "right")).toBe("m1");
  });
  it("medium answered right goes to hard", () => {
    expect(next(["e1", "m1"], "medium", "right")).toBe("h1");
  });
  it("hard answered right stays at hard, because there is nothing above", () => {
    expect(next(["e1", "m1", "h1"], "hard", "right")).toBe("h2");
  });

  /* Wrong: one band easier, bounded at `easy`. */
  it("hard answered wrong goes to medium", () => {
    expect(next(["e1", "m1", "h1"], "hard", "wrong")).toBe("m2");
  });
  it("medium answered wrong goes to easy", () => {
    expect(next(["e1", "m1"], "medium", "wrong")).toBe("e2");
  });
  it("easy answered wrong stays at easy, because there is nothing below", () => {
    expect(next(["e1"], "easy", "wrong")).toBe("e2");
  });

  /* Absence: hold the band. A designed outcome, not a failure path. */
  it("holds the band when there is no verdict", () => {
    expect(next(["e1"], "easy", undefined)).toBe("e2");
    expect(next(["e1", "m1"], "medium", undefined)).toBe("m2");
    expect(next(["e1", "m1", "h1"], "hard", undefined)).toBe("h2");
  });
});

describe("the value ordering inside a band is the server's, never ours", () => {
  /**
   * **The amended invariant, as an assertion.**
   *
   * The old rule was that the panel must not re-sort at all; an adaptive walk
   * plainly changes the cross-band order, so the rule now reads: the server
   * remains the sole authority for the static ranking, and traversal must
   * preserve the server's relative order *within* every band.
   *
   * **What this catches and what it does not**, measured by mutating the
   * implementation rather than assumed: a comparator that reorders within a
   * band (ascending `value`, say) turns six of these cases red. A comparator
   * that sorts by `value` descending does **not**, and that is correct rather
   * than a hole — within a band the server's order already *is* value
   * descending, so such a sort is behaviourally identical and violates nothing
   * the amended invariant states.
   *
   * The stronger rule — *the client must never sort at all* — is a code-level
   * tripwire that no test can express, so it is stated in src/web/quiz-ladder.ts
   * and enforced by reading. Don't mistake this green for covering it.
   */
  it("meets every band's questions in the server's order, whatever the path", () => {
    const met: string[] = [];
    const seen: string[] = [];
    let current = firstQuestion(BATCH);
    /* A reader who lurches about: right, wrong, right, wrong, … so the walk
       crosses bands repeatedly rather than marching up one. */
    let i = 0;
    while (current) {
      met.push(current.id);
      seen.push(current.id);
      const verdict: QuizVerdict = i % 2 === 0 ? "right" : "wrong";
      current = nextQuestion(BATCH, seen, current.band, verdict);
      i += 1;
    }

    expect(met).toHaveLength(BATCH.length);
    for (const band of ["easy", "medium", "hard"] as const) {
      const server = BATCH.filter((x) => x.band === band).map((x) => x.id);
      const walked = met.filter((id) => server.includes(id));
      expect(walked).toEqual(server);
    }
  });

  it("takes the highest-value unseen question in the band it lands on", () => {
    /* m1 is value 5 and m2 is value 4; having seen m1, the next medium is m2
       rather than whichever medium happens to appear first in the document. */
    expect(next(["e1", "m1"], "easy", "right")).toBe("m2");
  });
});

describe("an empty band", () => {
  /** 6 easy / 3 hard and no medium at all — allowed, since the gate asks only
      for presence at each *end*. Going up from easy must not stall. */
  const noMedium = BATCH.filter((x) => x.band !== "medium");

  it("steps past a band that was never there, in the direction of travel", () => {
    expect(next(["e1"], "easy", "right", noMedium)).toBe("h1");
  });

  it("steps past a band that has been used up", () => {
    const seen = ["e1", "m1", "m2", "m3"];
    expect(next(seen, "easy", "right")).toBe("h1");
  });

  it("comes back the other way when the direction of travel is exhausted", () => {
    /* Every hard and every medium seen; a right answer at medium has nowhere
       up and nowhere level, so it falls back to easy rather than giving up. */
    const seen = ["m1", "m2", "m3", "h1", "h2", "h3"];
    expect(next(seen, "medium", "right")).toBe("e1");
  });
});

describe("exhaustion", () => {
  it("returns nothing once every question has been seen", () => {
    const all = BATCH.map((x) => x.id);
    expect(next(all, "easy", "right")).toBeUndefined();
    expect(next(all, "hard", "wrong")).toBeUndefined();
  });

  it("never offers a question twice, however the reader answers", () => {
    for (const verdict of ["right", "wrong", undefined] as const) {
      const seen: string[] = [];
      let current = firstQuestion(BATCH);
      while (current) {
        expect(seen).not.toContain(current.id);
        seen.push(current.id);
        current = nextQuestion(BATCH, seen, current.band, verdict);
      }
      expect(seen).toHaveLength(BATCH.length);
    }
  });

  /**
   * **Exhaustion is not adaptation, and the code should not pretend it is.**
   *
   * A reader who gets everything wrong uses up all six easy questions, then all
   * three medium, and is then handed a hard one — because the only alternative
   * is ending their quiz, which this feature deliberately refuses to do. The
   * test exists so that behaviour is a decision on the record rather than a
   * surprise.
   */
  it("eventually hands a struggling reader a hard question, once nothing easier is left", () => {
    const seen: string[] = [];
    let current = firstQuestion(BATCH);
    const bands: QuizBand[] = [];
    while (current) {
      bands.push(current.band);
      seen.push(current.id);
      current = nextQuestion(BATCH, seen, current.band, "wrong");
    }
    expect(bands.slice(0, 6)).toEqual(Array(6).fill("easy"));
    expect(bands.slice(6, 9)).toEqual(Array(3).fill("medium"));
    expect(bands.slice(9)).toEqual(Array(3).fill("hard"));
  });
});
