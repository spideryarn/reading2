/**
 * **Where an answer from *Ask about Spideryarn* may link** —
 * src/web/help/help-answer-links.ts. The answer is model output: a link is
 * drawn only to an address the Help itself has, matched exactly. Plan
 * docs/plans/261007k-help-chatbot.md, F4.
 */
import { describe, expect, it } from "vitest";

import type { HelpCorpusPage } from "../src/help-chat.js";
import corpus from "../src/help-corpus.generated.json" with { type: "json" };
import { helpAnswerHref, helpAnswerHrefs } from "../src/web/help/help-answer-links.js";

describe("helpAnswerHref", () => {
  it("takes a Help page's address, exactly", () => {
    expect(helpAnswerHref("/help/spine")).toBe("/help/spine");
    expect(helpAnswerHref("/help/feedback")).toBe("/help/feedback");
  });

  it("takes the contents page, /help", () => {
    expect(helpAnswerHref("/help")).toBe("/help");
  });

  it("takes a question at its place on the questions' page", () => {
    const question = (corpus as HelpCorpusPage[]).find((p) => p.href.includes("#faq-"));
    expect(question).toBeDefined();
    expect(helpAnswerHref(question?.href ?? "")).toBe(question?.href);
  });

  it("refuses an address on the web", () => {
    expect(helpAnswerHref("https://example.com/")).toBeNull();
    expect(helpAnswerHref("https://spideryarn.com/help/spine")).toBeNull();
    expect(helpAnswerHref("//evil.example/help/spine")).toBeNull();
  });

  it("refuses a script", () => {
    expect(helpAnswerHref("javascript:alert(1)")).toBeNull();
    expect(helpAnswerHref("JavaScript:/help/spine")).toBeNull();
  });

  it("refuses a /help/ path the Help does not have", () => {
    expect(helpAnswerHref("/help/no-such-page")).toBeNull();
    expect(helpAnswerHref("/help/questions#faq-no-such-question")).toBeNull();
  });

  it("refuses a near miss", () => {
    for (const near of [
      "/help/spine/",
      "/help/Spine",
      "help/spine",
      "/help/spine?x=1",
      "/help/spine#top",
      " /help/spine",
      "/help/",
      "/help/../login",
      "/help#spine",
    ]) {
      expect(helpAnswerHref(near), near).toBeNull();
    }
  });

  it("is the corpus's addresses and /help, no more and no fewer", () => {
    const fromCorpus = new Set(["/help", ...(corpus as HelpCorpusPage[]).map((p) => p.href)]);
    expect([...helpAnswerHrefs()].sort()).toEqual([...fromCorpus].sort());
  });
});
