/**
 * **A scoped expansion the model ran out of room for, and why parsing it is not
 * enough** — docs/plans/260904d-deepen-fat-sections.md § stage 5.
 *
 * `liveExpansionExecutor` used to ignore `stop_reason` on the argument that a
 * truncated answer necessarily fails to parse and is therefore caught as a
 * `malformed-answer`. That is true of almost every truncation and false of the
 * one that matters: an answer cut immediately after a closing brace is **valid
 * JSON describing half a section**, and it parses, normalises, derives, passes
 * every coverage check, gets written to the checkpoint and is published as a
 * complete tree. Nothing anywhere says a level went missing.
 * ⟨GPT Sol's review of stage 5a, finding 6.⟩
 *
 * The fixture below is exactly that answer: two sections asked about, one
 * section answered, `stop_reason: "max_tokens"`. The point of the pair of tests
 * is that the *same body* is accepted when the model stopped of its own accord —
 * so what is being asserted is that the stop reason is read, not that some
 * answers are refused.
 *
 * No network: `streamMessage` is replaced at the module boundary.
 */
import { describe, expect, it, vi } from "vitest";

import { ExpansionRefused } from "../src/hierarchy-cascade.js";
import type { ExpansionRequest } from "../src/hierarchy-expand.js";
import { ExpansionTruncated, liveExpansionExecutor } from "../src/hierarchy-deepen.js";

/** What the mocked `finalMessage` will answer with, set per test. */
const answer: { stopReason: string; text: string } = {
  stopReason: "end_turn",
  text: "{}",
};

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => ({
      onText: () => {},
      finalMessage: async () => ({
        content: [{ type: "text", text: answer.text }],
        stop_reason: answer.stopReason,
        usage: {
          input_tokens: 1_100,
          output_tokens: 220,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 40,
        },
      }),
    }),
  };
});

/** Valid JSON, and half of what was asked for — the shape that gets through. */
const HALF = JSON.stringify({
  sections: [
    {
      section: 1,
      children: [{ start: "spya-aaaaaa", title: "The First Part", gist: "It opens.", verdict: "finished" }],
    },
  ],
});

/** The executor only reads `params`; the rest of the request is not its business. */
const REQUEST = { params: { messages: [], system: "" } } as unknown as ExpansionRequest;

describe("an expansion the model ran out of room for", () => {
  it("is refused even though it parses", async () => {
    answer.stopReason = "max_tokens";
    answer.text = HALF;
    await expect(liveExpansionExecutor()(REQUEST)).rejects.toBeInstanceOf(ExpansionTruncated);
  });

  /**
   * The control. Without it, "a truncated answer is refused" is satisfied by an
   * executor that refuses everything, and the assertion above would keep passing
   * over a stage that had stopped working entirely.
   */
  it("is the same body the executor hands back when the model chose to stop", async () => {
    answer.stopReason = "end_turn";
    answer.text = HALF;
    /* **And what it cost, beside the body.** The executor is the only place a
       scoped call's tokens exist — the seam handed back a bare string until
       2026-09-05 and the wave's whole bill reached nothing on `HierarchyRun`.
       All four, because the two cache figures are the ones a shared prefix
       moves and the ones an optional field would have quietly left at zero.
       src/hierarchy-deepen.ts § `ExpansionAnswer`. */
    await expect(liveExpansionExecutor()(REQUEST)).resolves.toEqual({
      text: HALF,
      usage: {
        inputTokens: 1_100,
        outputTokens: 220,
        cacheReadTokens: 900,
        cacheWriteTokens: 40,
      },
    });
  });

  /**
   * **And it is not redrawn**, which is the second half of the fix.
   *
   * A redraw at the identical `max_tokens` is three calls failing the same way:
   * the budget is a function of the request, so a call that truncates
   * deterministically truncates every time. `ExpansionTruncated` is therefore
   * not an `ExpansionRefused` — the class is the retry policy, which is the rule
   * `ExpansionRefused`'s own docblock states.
   */
  it("is not the kind of refusal the wave draws again", () => {
    expect(new ExpansionTruncated()).not.toBeInstanceOf(ExpansionRefused);
  });
});
