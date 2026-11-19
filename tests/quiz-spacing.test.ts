/**
 * **When a Quiz question comes back** — `recallAfterDays`, plan 261030c § The
 * schedule, exactly. Greg's option B on q-m9zkx3: wrong, a day; right, a week,
 * then longer each time it is right again. An unjudged try is never wrong.
 */
import { describe, expect, it } from "vitest";

import {
  asOf,
  MAX_RECALL_AFTER_DAYS,
  parseRecallAfterDays,
  RECALL_AFTER_DAYS,
  recallAfterDays,
  type QuizTry,
} from "../src/quiz-spacing.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-10-30T12:00:00Z");

/** Oldest first, as a person would write it; the function takes newest first. */
function history(...tries: [QuizTry["verdict"], number][]): QuizTry[] {
  return tries.map(([verdict, at], i) => ({ id: `t${i}`, verdict, at: T0 + at })).reverse();
}

describe("recallAfterDays", () => {
  it("is the flat three days with no tries, or none judged (every row from before 261030c)", () => {
    expect(recallAfterDays([])).toBe(RECALL_AFTER_DAYS);
    expect(recallAfterDays(history([null, 0]))).toBe(3);
    expect(recallAfterDays(history([null, 0], [null, 5 * DAY]))).toBe(3);
  });

  it("is a day after a wrong, and a week after a first right", () => {
    expect(recallAfterDays(history(["wrong", 0]))).toBe(1);
    expect(recallAfterDays(history(["right", 0]))).toBe(7);
  });

  it("doubles with each right a day or more after the last, up to the ceiling", () => {
    expect(recallAfterDays(history(["right", 0], ["right", 7 * DAY]))).toBe(14);
    expect(recallAfterDays(history(["right", 0], ["right", 7 * DAY], ["right", 21 * DAY]))).toBe(28);
    const four = history(["right", 0], ["right", 7 * DAY], ["right", 21 * DAY], ["right", 49 * DAY]);
    expect(recallAfterDays(four)).toBe(56);
    const six = history(...[0, 1, 2, 3, 4, 5].map((n): ["right", number] => ["right", n * 60 * DAY]));
    expect(recallAfterDays(six)).toBe(MAX_RECALL_AFTER_DAYS);
  });

  it("counts rights inside one day once, and one exactly a day apart twice", () => {
    expect(recallAfterDays(history(["right", 0], ["right", DAY - 1]))).toBe(7);
    expect(recallAfterDays(history(["right", 0], ["right", DAY]))).toBe(14);
    expect(recallAfterDays(history(["right", 0], ["right", 60_000], ["right", 120_000]))).toBe(7);
  });

  it("judges an edited answer again: a right then a wrong is a day", () => {
    expect(recallAfterDays(history(["right", 0], ["right", 7 * DAY], ["wrong", 8 * DAY]))).toBe(1);
  });

  it("starts the ladder again after a wrong", () => {
    expect(recallAfterDays(history(["right", 0], ["right", 7 * DAY], ["wrong", 8 * DAY], ["right", 9 * DAY]))).toBe(7);
  });

  it("never treats an unjudged try as wrong, and an unjudged newest try is the neutral three days", () => {
    /* GPT Sol's plan review F2: a long run then a failed check must not keep the
       eight-week clock — the newest answer could have been wrong. */
    const long = history(["right", 0], ["right", 7 * DAY], ["right", 21 * DAY], ["right", 49 * DAY], [null, 50 * DAY]);
    expect(recallAfterDays(long)).toBe(3);
    /* An unjudged try in the middle neither counts nor breaks the run. */
    expect(recallAfterDays(history(["right", 0], [null, 3 * DAY], ["right", 7 * DAY]))).toBe(14);
    expect(recallAfterDays(history(["wrong", 0], [null, DAY], ["right", 2 * DAY]))).toBe(7);
  });

  it("takes the order it is given, the store's, rather than re-sorting by time", () => {
    /* Two rows in one millisecond: the store orders them by microsecond and
       id; JS time cannot. The first is the newest. */
    const tie: QuizTry[] = [
      { id: "b", verdict: "wrong", at: T0 },
      { id: "a", verdict: "right", at: T0 },
    ];
    expect(recallAfterDays(tie)).toBe(1);
    expect(recallAfterDays([...tie].reverse())).toBe(7);
  });
});

describe("asOf", () => {
  it("leaves out a try that landed after the one being scheduled", () => {
    /* A second mark lands between `record`'s insert and its history read: the
       first mark's schedule is its own (a right, a week), not the newer wrong's. */
    const tries: QuizTry[] = [
      { id: "later", verdict: "wrong", at: T0 + 1000 },
      { id: "mine", verdict: "right", at: T0 },
      { id: "older", verdict: null, at: T0 - DAY },
    ];
    expect(asOf(tries, "mine").map((t) => t.id)).toEqual(["mine", "older"]);
    expect(recallAfterDays(asOf(tries, "mine"))).toBe(7);
    expect(asOf(tries, "absent")).toEqual([]);
  });
});

describe("parseRecallAfterDays", () => {
  it("takes a whole number in range, and three days for anything else", () => {
    expect(parseRecallAfterDays(1)).toBe(1);
    expect(parseRecallAfterDays(56)).toBe(56);
    for (const bad of [undefined, null, Number.NaN, 0, -1, 2.5, MAX_RECALL_AFTER_DAYS + 1, "7", Infinity]) {
      expect(parseRecallAfterDays(bad)).toBe(RECALL_AFTER_DAYS);
    }
  });
});
