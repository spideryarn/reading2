/**
 * **The four looks of a Quiz question, and the three-day rule** — plan 261029m
 * (Greg's spya-v2aehw): answered, deeper for right, and a quiet "time to
 * recall it again" once the answer has gone stale.
 */
import { describe, expect, it } from "vitest";
import { agoWords, daysSince, quizLook, quizLookClass, quizLookFor, quizLookSpoken, RECALL_AFTER_DAYS } from "../src/web/quiz-recall.js";

const NOW = Date.parse("2026-10-29T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

describe("quizLook", () => {
  it("is none with no kept answer", () => {
    expect(quizLook(undefined, NOW)).toBe("none");
  });
  it("is answered for a fresh answer with no verdict, or a wrong one", () => {
    expect(quizLook({ answeredAt: ago(60_000) }, NOW)).toBe("answered");
    expect(quizLook({ answeredAt: ago(60_000), verdict: "wrong" }, NOW)).toBe("answered");
  });
  it("is right only for a right verdict", () => {
    expect(quizLook({ answeredAt: ago(60_000), verdict: "right" }, NOW)).toBe("right");
  });
  it("turns due at exactly RECALL_AFTER_DAYS, not a minute before", () => {
    expect(RECALL_AFTER_DAYS).toBe(3);
    expect(quizLook({ answeredAt: ago(3 * DAY - 1) }, NOW)).toBe("answered");
    expect(quizLook({ answeredAt: ago(3 * DAY) }, NOW)).toBe("due");
    expect(quizLook({ answeredAt: ago(3 * DAY), verdict: "right" }, NOW)).toBe("due");
  });
  it("is never due for an answer stamped in the future (a fast clock)", () => {
    expect(quizLook({ answeredAt: new Date(NOW + 10 * DAY).toISOString() }, NOW)).toBe("answered");
  });
});

describe("the words and classes", () => {
  it("every answered look keeps quiz-answered, so the green is one rule", () => {
    expect(quizLookClass("none")).toBe("");
    for (const look of ["answered", "right", "due"] as const) expect(quizLookClass(look)).toContain("quiz-answered");
  });
  it("counts whole days, and says weeks past a fortnight", () => {
    expect(daysSince(ago(5 * DAY + 3600_000), NOW)).toBe(5);
    expect(daysSince("not a date", NOW)).toBe(0);
    expect(agoWords(4)).toBe("4 days ago");
    expect(agoWords(9)).toBe("a week ago");
    expect(agoWords(22)).toBe("3 weeks ago");
    expect(quizLookSpoken("due", 4)).toBe(" (answered 4 days ago: worth trying again from memory)");
    expect(quizLookSpoken("right", 0)).toBe(" (answered; the check thought it looked right)");
  });
});

describe("quizLookFor: right belongs to the words that were judged", () => {
  const kept = { answer: "Judged words.", answeredAt: ago(60_000), verdict: "right" as const };
  it("keeps right with an empty box or the same words", () => {
    expect(quizLookFor(kept, NOW, "")).toBe("right");
    expect(quizLookFor(kept, NOW, " Judged words. ")).toBe("right");
  });
  it("steps down to answered under different words", () => {
    expect(quizLookFor(kept, NOW, "Something else.")).toBe("answered");
  });
  it("leaves due alone", () => {
    expect(quizLookFor({ ...kept, answeredAt: ago(4 * DAY) }, NOW, "Something else.")).toBe("due");
  });
});
