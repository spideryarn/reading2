/**
 * **Plain text with monospaced blocks in it** (src/plain-text-blocks.ts): the
 * one line-state reading a question's body is drawn, split and compiled by.
 * Plan 261028b, Stage 2, and GPT Sol's plan review F3.
 */
import { describe, expect, it } from "vitest";

import { fencedLines, parsePlainTextBlocks } from "../src/plain-text-blocks.js";

describe("parsePlainTextBlocks", () => {
  it("is one text block when there is no fence", () => {
    expect(parsePlainTextBlocks("Which one?\n\nA. This.\nB. That.")).toEqual({
      blocks: [{ kind: "text", text: "Which one?\n\nA. This.\nB. That." }],
      unclosed: false,
    });
  });

  it("toggles on a line that is exactly three backticks, and does not show the fence", () => {
    expect(parsePlainTextBlocks("Before.\n\n```\n+---+\n| A |\n+---+\n```\n\nAfter.")).toEqual({
      blocks: [
        { kind: "text", text: "Before." },
        { kind: "mono", text: "+---+\n| A |\n+---+" },
        { kind: "text", text: "After." },
      ],
      unclosed: false,
    });
  });

  it("keeps every line inside a fence, leading spaces and blank lines included", () => {
    expect(parsePlainTextBlocks("```\n   indented\n\n  two\n```").blocks).toEqual([
      { kind: "mono", text: "   indented\n\n  two" },
    ]);
  });

  it("does not take a padded fence, or one with a language after it, as a fence", () => {
    for (const notFence of [" ```", "``` ", "```text", "````"]) {
      expect(parsePlainTextBlocks(`a\n${notFence}\nb`).blocks, notFence).toEqual([
        { kind: "text", text: `a\n${notFence}\nb` },
      ]);
    }
  });

  it("keeps a Details line inside a fence as content", () => {
    expect(parsePlainTextBlocks("```\n| Details |\nDetails\n```").blocks).toEqual([
      { kind: "mono", text: "| Details |\nDetails" },
    ]);
  });

  it("reads CRLF as LF", () => {
    expect(parsePlainTextBlocks("a\r\n```\r\n x\r\n```\r\nb")).toEqual({
      blocks: [
        { kind: "text", text: "a" },
        { kind: "mono", text: " x" },
        { kind: "text", text: "b" },
      ],
      unclosed: false,
    });
  });

  it("draws an empty fence as nothing", () => {
    expect(parsePlainTextBlocks("a\n```\n```\nb").blocks).toEqual([
      { kind: "text", text: "a" },
      { kind: "text", text: "b" },
    ]);
  });

  it("says unclosed, and gives the whole text back as plain text", () => {
    expect(parsePlainTextBlocks("a\n```\nx\n```\nb\n```\ny")).toEqual({
      blocks: [{ kind: "text", text: "a\n```\nx\n```\nb\n```\ny" }],
      unclosed: true,
    });
  });
});

describe("fencedLines", () => {
  it("marks fence lines and what is between them as inside", () => {
    expect(fencedLines("a\n```\nb\n```\nc")).toEqual({
      lines: ["a", "```", "b", "```", "c"],
      inside: [false, true, true, true, false],
      unclosed: false,
    });
  });

  it("reports every line outside when a fence is never closed", () => {
    expect(fencedLines("a\n```\nb").inside).toEqual([false, false, false]);
  });
});
