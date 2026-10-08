/**
 * **Which group a thread is in, and how its body splits** — the two pure rules
 * the admin's *Needs a decision* rests on (src/feedback-question-values.ts).
 * docs/plans/261008i-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md,
 * decisions 1 and 11, and GPT Sol's plan review F2 and F15.
 */
import { describe, expect, it } from "vitest";

import { questionState, splitQuestionBody } from "../src/feedback-question-values.js";

const at = (hour: number) => `2026-10-08T${String(hour).padStart(2, "0")}:00:00.000Z`;

describe("questionState — the later of a reply and a deferral wins (F2)", () => {
  it("is waiting with nothing, and responded once a reply is not yet acted on", () => {
    expect(questionState({ replies: [], deferredAt: null })).toBe("waiting");
    expect(questionState({ replies: [{ createdAt: at(9), acted: false }], deferredAt: null })).toBe("responded");
  });

  it("is waiting again once every reply has been acted on and the question left open", () => {
    expect(questionState({ replies: [{ createdAt: at(9), acted: true }], deferredAt: null })).toBe("waiting");
  });

  it("is deferred when the deferral is the later, and on a tie", () => {
    expect(questionState({ replies: [], deferredAt: at(9) })).toBe("deferred");
    expect(questionState({ replies: [{ createdAt: at(9), acted: false }], deferredAt: at(10) })).toBe("deferred");
    expect(questionState({ replies: [{ createdAt: at(9), acted: false }], deferredAt: at(9) })).toBe("deferred");
  });

  it("is responded when a reply came after the deferral", () => {
    expect(questionState({ replies: [{ createdAt: at(11), acted: false }], deferredAt: at(10) })).toBe("responded");
  });

  it("does not bring an old deferral back once the reply after it has been acted on", () => {
    /* Defer at 10, reply at 11, an agent acts on it and leaves the question
       open: the follow-up is in the body, and it waits on Greg again. */
    expect(questionState({ replies: [{ createdAt: at(11), acted: true }], deferredAt: at(10) })).toBe("waiting");
  });
});

describe("splitQuestionBody — the short version first, the details shut", () => {
  it("splits on a line that is exactly Details", () => {
    expect(splitQuestionBody("Which one?\n\nA. This.\nB. That.\n\nDetails\n\nThe background.")).toEqual({
      summary: "Which one?\n\nA. This.\nB. That.",
      details: "The background.",
    });
  });

  it("draws the whole body when there is no such line, or nothing either side of it", () => {
    expect(splitQuestionBody("Background. A. B.")).toEqual({ summary: "Background. A. B.", details: null });
    expect(splitQuestionBody("Details\nall of it")).toEqual({ summary: "Details\nall of it", details: null });
    expect(splitQuestionBody("Which?\nDetails")).toEqual({ summary: "Which?\nDetails", details: null });
  });

  it("does not split on a padded line or one with more words in it (F15)", () => {
    expect(splitQuestionBody("Which?\n Details \nmore").details).toBeNull();
    expect(splitQuestionBody("Which?\nDetails below\nmore").details).toBeNull();
  });
});
