import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { acceptedStructureAnswer } from "../evals/paperwork/structure-parse.js";
import type { Block } from "../src/types.js";

const body: Block[] = [
  { id: "spya-trm001", tag: "p", kind: "text", text: "Some prose.", words: 2, html: "<p>Some prose.</p>", gistable: true },
];

/* Valid JSON on purpose: the parser downstream would accept every one of these
   texts, so only the termination check can refuse them. */
const TEXT = JSON.stringify({ root: { title: "Whole", gist: "A claim.", children: [] } });

const message = (over: Partial<Anthropic.Message>): Anthropic.Message =>
  ({
    content: [{ type: "text", text: TEXT }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
    ...over,
  }) as Anthropic.Message;

describe("an eval's whole-document structure answer", () => {
  it("is the answer's text when the call ended normally", () => {
    expect(acceptedStructureAnswer(message({}), body, 80_000)).toBe(TEXT);
  });

  it("is refused when the answer stopped at max_tokens, however well it parses", () => {
    expect(() => acceptedStructureAnswer(message({ stop_reason: "max_tokens" }), body, 80_000)).toThrow(
      /table of contents.*80,?000/s,
    );
  });

  it("is refused when the model refused, by stop_reason or by stop_details", () => {
    expect(() => acceptedStructureAnswer(message({ stop_reason: "refusal" }), body, 80_000)).toThrow(/refus/i);
    expect(() =>
      acceptedStructureAnswer(
        message({ stop_details: { type: "refusal" } } as unknown as Partial<Anthropic.Message>),
        body,
        80_000,
      ),
    ).toThrow(/refus/i);
  });
});
