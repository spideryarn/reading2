/**
 * **A model's answer puts `--answer-gap` between its paragraphs** — tokens.css,
 * typography.md § Vertical rhythm, plan
 * docs/plans/261022e-phone-tap-bar-at-40px-and-a-wider-gap-between-paragraphs-of-model-answers.md.
 *
 * Each surface below picked its own number until 2026-10-22, and chat's 0.6rem
 * was barely more than the space between two lines. This pins that each one
 * still takes the token, so an edit that puts a literal back is caught here.
 * The browser shots in the plan are the evidence that the gap is what it says.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readerCssNoComments } from "./helpers/stylesheets.js";

const css = readerCssNoComments().replace(/\s+/g, " ");
const help = readFileSync(new URL("../src/web/help/HelpAsk.tsx", import.meta.url), "utf8");

describe("the gap between paragraphs of a model's answer", () => {
  it("is one em, defined once", () => {
    expect(css.match(/--answer-gap:/g)).toHaveLength(1);
    expect(css).toMatch(/--answer-gap: 1em;/);
  });

  it("is what chat puts between the answer's own blocks", () => {
    expect(css).toContain(
      ":is(.chat-turn.model, .chat-hint-text) > :is(p:not([class]), .fmt-list, .fmt-quote, .fmt-pre) + :is(p:not([class]), .fmt-list, .fmt-quote, .fmt-pre) { margin-top: var(--answer-gap); }",
    );
  });

  it("is what the AI's answer to a comment puts between paragraphs", () => {
    expect(css).toContain(".cmt-answer p + p { margin-top: var(--answer-gap); }");
  });

  it("is Help's answer's flex gap", () => {
    expect(help).toMatch(/const ANSWER_CLASS =\s*"[^"]*tw:gap-\[var\(--answer-gap\)\]/);
  });
});
