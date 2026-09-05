/**
 * **The two dictation benchmarks must not report a clean run over nothing.**
 *
 * The class is
 * `docs/postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md`
 * — a clean bill computed over the collection the failure emptied — and this
 * file is the red that was watched before
 * [`evals/dictation/coverage.ts`](../evals/dictation/coverage.ts) existed:
 * `reportsCleanTheOldWay` below is a verbatim copy of the three lines
 * `bench-models.ts` used to end on, and it returns `true` for an arm that
 * answered nothing. It is kept rather than deleted so the assertions are
 * against a **shape** that is still in front of the reader, not against a
 * memory of one.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type Attempt,
  callCounts,
  coverageLines,
  coverageOf,
  exitCodeFor,
} from "../evals/dictation/coverage.js";

/**
 * `bench-models.ts` as it stood before this work: `clean` starts true and is
 * falsified only by an answer naming another model. An arm with no answers has
 * nothing to filter, so nothing falsifies it.
 */
function reportsCleanTheOldWay(
  arms: { name: string; model: string }[],
  whoAnswered: Map<string, Map<string, number>>,
): boolean {
  let clean = true;
  for (const a of arms) {
    const seen = whoAnswered.get(a.name) ?? new Map<string, number>();
    const odd = [...seen].filter(([m]) => m !== a.model);
    if (odd.length) clean = false;
  }
  return clean;
}

const MODEL = "google/gemini-3.1-flash-lite";
/** Two arms of thirty calls each; the second one's calls were all lost. */
const oneArmSilent: Attempt[] = [
  { name: "flash-lite +vocab", attempted: 30, sentTo: MODEL, answers: new Map([[MODEL, 30]]) },
  { name: "flash-lite bare", attempted: 30, sentTo: MODEL, answers: new Map() },
];

describe("an arm that answered nothing", () => {
  it("was reported clean by the logic this replaces", () => {
    /* The bug, still executable. If this ever goes false the copy has drifted
       and the test below is guarding a different shape than it claims. */
    expect(
      reportsCleanTheOldWay(
        [
          { name: "flash-lite +vocab", model: MODEL },
          { name: "flash-lite bare", model: MODEL },
        ],
        new Map([["flash-lite +vocab", new Map([[MODEL, 30]])]]),
      ),
    ).toBe(true);
  });

  it("is not clean, is named, and exits 1", () => {
    const c = coverageOf(oneArmSilent);
    expect(c.clean).toBe(false);
    expect(c.silent).toEqual(["flash-lite bare"]);
    expect(exitCodeFor(c)).toBe(1);
    expect(coverageLines(c).join("\n")).toContain("ANSWERED NOTHING AT ALL");
  });

  it("does not get the sentence about every call naming its model", () => {
    expect(coverageLines(coverageOf(oneArmSilent)).join("\n")).not.toContain("every call came back");
  });
});

describe("a run where nothing came back at all", () => {
  const nothing: Attempt[] = [
    { name: "a", attempted: 30, sentTo: MODEL, answers: new Map() },
    { name: "b", attempted: 30, sentTo: MODEL, answers: new Map() },
  ];

  it("says it measured nothing rather than printing zeroes", () => {
    const c = coverageOf(nothing);
    expect(c.clean).toBe(false);
    expect(coverageLines(c).join("\n")).toContain("NOTHING WAS MEASURED");
    expect(exitCodeFor(c)).toBe(1);
  });

  it("counts the calls as attempted-but-not-answered in the results file", () => {
    expect(callCounts(coverageOf(nothing))).toEqual({ attempted: 60, answered: 0, lost: 60 });
  });
});

describe("a run with no arms at all", () => {
  /* The whole-collection version of the same thing: a report over an empty
     table has no rows to complain about, so an absence-of-complaint check
     passes it. */
  it("is refused rather than called clean", () => {
    const c = coverageOf([]);
    expect(c.clean).toBe(false);
    expect(exitCodeFor(c)).toBe(1);
    expect(coverageLines(c).join("\n")).toContain("NO ARMS RAN AT ALL");
  });
});

describe("the ordinary shapes", () => {
  it("calls a full run clean", () => {
    const c = coverageOf([
      { name: "a", attempted: 30, sentTo: MODEL, answers: new Map([[MODEL, 30]]) },
      { name: "b", attempted: 30, sentTo: MODEL, answers: new Map([[MODEL, 30]]) },
    ]);
    expect(c.clean).toBe(true);
    expect(exitCodeFor(c)).toBe(0);
    expect(callCounts(c)).toEqual({ attempted: 60, answered: 60, lost: 0 });
  });

  it("refuses to call a thinned run clean, but still lets it be read", () => {
    const c = coverageOf([
      { name: "a", attempted: 30, sentTo: MODEL, answers: new Map([[MODEL, 28]]) },
    ]);
    expect(c.clean).toBe(false);
    expect(c.short).toEqual(["a"]);
    /* Two lost calls out of thirty is a thin table, not a missing one — the
       distinction `evals/quiz.ts` draws, and the reason this exits 0. */
    expect(exitCodeFor(c)).toBe(0);
    expect(callCounts(c)).toEqual({ attempted: 30, answered: 28, lost: 2 });
  });

  it("refuses a clean bill when more came back than was sent", () => {
    /* The other direction, which nobody gets bitten by and so nobody writes
       down: a wrong denominator makes every rate above it wrong, and
       `answered !== attempted` is the only thing that can see it. */
    const c = coverageOf([
      { name: "a", attempted: 10, sentTo: MODEL, answers: new Map([[MODEL, 12]]) },
    ]);
    expect(c.clean).toBe(false);
    expect(c.over).toEqual(["a"]);
    expect(coverageLines(c).join("\n")).toContain("MORE CALLS CAME BACK THAN WERE SENT");
  });

  it("refuses a clean bill over numbers that are not whole and positive", () => {
    /* `NaN` compares false to everything, so it is silent, short and over all
       at once — which is to say none of them. `clean` is stated forwards for
       exactly this: a state nobody enumerated lands on the unclean side.
       `RUNS=abc` is how a caller reaches it. GPT Sol's review, item 3. */
    for (const bad of [Number.NaN, -1, 1.5, 0]) {
      const c = coverageOf([{ name: "a", attempted: bad, answered: bad }]);
      expect(c.clean).toBe(false);
      expect(exitCodeFor(c)).toBe(1);
    }
    expect(coverageLines(coverageOf([{ name: "a", attempted: Number.NaN, answered: 4 }]))
      .join("\n")).toContain("NOT WHOLE POSITIVE NUMBERS");
  });

  it("exits 1 when more came back than was sent, because the denominator is wrong", () => {
    /* Not a readable-but-thin run: every rate above is over a population that
       never existed. GPT Sol's review, item 1. */
    expect(
      exitCodeFor(
        coverageOf([{ name: "a", attempted: 10, sentTo: MODEL, answers: new Map([[MODEL, 12]]) }]),
      ),
    ).toBe(1);
  });

  it("counts an answer naming no model as an answer, and as not the model asked for", () => {
    /* `(none)` is what `bench-models.ts` records when the response named
       nothing. It came back, so it is not silence; it did not agree, so it is
       not confirmation. */
    const c = coverageOf([
      { name: "a", attempted: 2, sentTo: MODEL, answers: new Map([["(none)", 2]]) },
    ]);
    expect(c.answered).toBe(2);
    expect(c.silent).toEqual([]);
    expect(c.misnamed).toEqual(["a"]);
    expect(c.clean).toBe(false);
  });

  it("skips the misnaming half for a harness that cannot see who answered", () => {
    /* `bench-vocabulary-sources.ts` holds the model fixed and does not carry
       `answeredBy`, so it passes no `sentTo` and gets the coverage half only. */
    const c = coverageOf([{ name: "shipped", attempted: 20, answered: 20 }]);
    expect(c.misnamed).toEqual([]);
    expect(c.clean).toBe(true);
  });

  it("still refuses a clean bill to a count-only condition that answered nothing", () => {
    const c = coverageOf([
      { name: "shipped", attempted: 20, answered: 20 },
      { name: "whole library", attempted: 20, answered: 0 },
    ]);
    expect(c.clean).toBe(false);
    expect(c.silent).toEqual(["whole library"]);
    expect(exitCodeFor(c)).toBe(1);
  });
});

describe("every TypeScript benchmark in the directory goes through coverage.ts", () => {
  /**
   * **So the next one is not written without it.** The previous fix for this
   * class was recorded in a comment directly above the line that relapsed,
   * which is exactly what a comment cannot prevent. A README paragraph is the
   * same instrument. This fails instead.
   *
   * `bench-*.mjs` is deliberately out of scope: those two already branch on the
   * empty case and print `FAIL` rows before computing anything, which is the
   * same guarantee reached another way — swept and confirmed 2026-09-05.
   */
  const dir = new URL("../evals/dictation/", import.meta.url);
  const benches = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("bench-") && f.endsWith(".ts"))
    .sort();

  it("found the benchmarks it claims to be checking", () => {
    /* A collector that matches nothing passes every assertion about its
       contents, forever — `silent-success.md`. Two exist today. */
    expect(benches).toEqual(["bench-models.ts", "bench-vocabulary-sources.ts"]);
  });

  for (const file of benches) {
    it(`${file} imports coverage.ts and exits on it`, () => {
      const src = fs.readFileSync(new URL(file, dir), "utf8");
      expect(src).toMatch(/from "\.\/coverage\.js"/);
      expect(src).toMatch(/exitCodeFor\(coverage\)/);
    });
  }
});

describe("the results files", () => {
  /**
   * **No planned product may be written into a results field.** This is the
   * second bug directly: `calls: CONDITIONS.length * utterances.length * RUNS`
   * is what the run intended, under a name that claims to say what happened.
   *
   * A source-text check, with the limits that implies — reformatting defeats
   * it, and it only sees this one spelling of the mistake. It is here because
   * the thing being guarded is a single line in a script that cannot be
   * imported, so there is nothing else to assert against.
   */
  const PLANNED_PRODUCT = /\b(?:calls|answered)\s*:\s*[A-Za-z]+\.length\s*\*/;

  /**
   * Comments out, because both files now *quote* the old line in order to
   * explain it — and the first version of this guard went red on that quotation
   * rather than on any code. Naive: a `*​/` inside a string literal would eat
   * the rest of the file. Neither of these files has one, and the control below
   * is what says the guard can still fire after the stripping.
   */
  const code = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("can still fire — the guard, against the line it was written for", () => {
    /* `silent-success.md`: a check you have never seen fail is not evidence,
       and a check whose subject has been stripped away fails silently forever. */
    expect(code("const x = {\n  calls: CONDITIONS.length * utterances.length * RUNS,\n};")).toMatch(
      PLANNED_PRODUCT,
    );
  });

  for (const file of ["bench-models.ts", "bench-vocabulary-sources.ts"]) {
    it(`${file} does not record a planned count as an outcome`, () => {
      const src = fs.readFileSync(new URL(`../evals/dictation/${file}`, import.meta.url), "utf8");
      /* Both files must still hold the real assignment, or the stripping has
         removed more than it should and the check above is over nothing. */
      expect(code(src)).toMatch(/calls: callCounts\(coverage\)/);
      expect(code(src)).not.toMatch(PLANNED_PRODUCT);
    });

    it(`${file} prints the coverage and raises the exit code from it`, () => {
      /* The wiring, which the unit tests above cannot see: neither script can
         be imported — both load `.env.local`, throw without an API key and
         make paid calls at import — so this is what is available. Both lines
         are absent from the versions before this work. */
      const src = code(
        fs.readFileSync(new URL(`../evals/dictation/${file}`, import.meta.url), "utf8"),
      );
      expect(src).toMatch(/for \(const line of coverageLines\(coverage\)\) console\.log\(line\)/);
      expect(src).toMatch(/if \(exitCodeFor\(coverage\) === 1\) process\.exitCode = 1/);
    });
  }
});
