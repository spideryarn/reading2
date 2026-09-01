/**
 * `sseChunks`'s `malformedFrames` option — src/openrouter-stream.ts.
 *
 * The shared SSE parser chat, explain and search all drive. Its default,
 * lenient behaviour (skip a `data:` frame that doesn't parse as JSON) is
 * right for chat and explain, whose payload is prose: a dropped frame costs
 * a few words. It is wrong for search, whose payload is one JSON object —
 * dropping a frame there can drop exactly one element of the `hits` array
 * while leaving text either side that still parses, so search opts into
 * `malformedFrames: "throw"` and throws instead. Found by a GPT Sol review,
 * 2026-08-26.
 *
 * Named-string option rather than a bare boolean, on a second pass by the
 * same review: a positional `true`/`false` reads as noise at the call site
 * and a slip between the two changes behaviour with nothing in the diff to
 * say what changed. `{ malformedFrames: "throw" }` cannot be inverted by a
 * typo without the diff saying so in words.
 *
 * This file pins the option itself, in isolation from any particular caller.
 * tests/search-stream.test.ts pins the same thing through
 * `findPassagesStream`, end to end.
 */
import { describe, expect, it } from "vitest";
import { sseChunks } from "../src/openrouter-stream.js";
import { classifyEnd } from "../src/ai-call.js";
import type { StreamEnd } from "../src/openrouter-stream.js";

/** A response body that emits the given raw SSE text, then closes. */
function sseBody(raw: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(raw);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

const frame = (raw: string) => `data: ${raw}\n\n`;

async function drain(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

describe("sseChunks", () => {
  it("defaults to lenient: a malformed data frame is skipped, not thrown", async () => {
    const body = sseBody(
      frame('{"choices":[{"delta":{"content":"a"}}]}') +
        frame("{this is not json") +
        frame('{"choices":[{"delta":{"content":"b"}}]}') +
        "data: [DONE]\n\n",
    );
    const end: StreamEnd = { terminated: false };
    const chunks = await drain(sseChunks(body, new AbortController().signal, () => {}, end));
    expect(chunks).toHaveLength(2); // the malformed frame contributed nothing, and nothing broke
    expect(end.terminated).toBe(true);
  });

  it('malformedFrames: "throw" throws on the same malformed frame instead of silently dropping it', async () => {
    const body = sseBody(
      frame('{"choices":[{"delta":{"content":"a"}}]}') + frame("{this is not json"),
    );
    const end: StreamEnd = { terminated: false };
    await expect(
      drain(sseChunks(body, new AbortController().signal, () => {}, end, { malformedFrames: "throw" })),
    ).rejects.toThrow(/\[ai-unreadable\]/);
  });

  it("throws without leaking the offending text — that text is the model's own output", async () => {
    // V8 puts a prefix of the bad input into a bare SyntaxError's message.
    // `providerSpokeNonsense()` is what this option throws instead, and this
    // is the assertion that would catch a regression back to the raw error.
    const secret = "REASONING: the reader's private criterion was";
    const body = sseBody(frame(`{${secret}`));
    const end: StreamEnd = { terminated: false };
    const err = await drain(
      sseChunks(body, new AbortController().signal, () => {}, end, { malformedFrames: "throw" }),
    ).then(
      () => { throw new Error("expected a rejection"); },
      (e: unknown) => e as Error,
    );
    expect(err.message).not.toMatch(/reader's private criterion/);
  });

  it("does not treat `[DONE]` as a malformed frame in either mode", async () => {
    const body = sseBody(`${frame('{"choices":[{"delta":{"content":"a"}}]}')}data: [DONE]\n\n`);
    const end: StreamEnd = { terminated: false };
    const chunks = await drain(
      sseChunks(body, new AbortController().signal, () => {}, end, { malformedFrames: "throw" }),
    );
    expect(chunks).toHaveLength(1);
    expect(end.terminated).toBe(true);
  });
});

/**
 * **`classifyEnd`, one case per outcome.**
 *
 * The value of these tests is not that a switch returns what it says. It is
 * that until 2026-09-01 this decision was written seven times and was wrong in
 * six, and nothing anywhere went red — the guard was
 * `!end.terminated && finishReason === null`, so a non-null reason could only
 * make it *less* likely to fire and no finish reason ever failed a stream.
 * These are the cases that guard could not see.
 * docs/postmortems/260901c-the-success-signal-that-outlived-its-witness.md.
 */
describe("classifyEnd", () => {
  const quiet = () => new AbortController().signal;
  const fired = () => {
    const c = new AbortController();
    c.abort();
    return c.signal;
  };
  /** Nothing of ours fired, and no reader gave up. */
  const calm = () => ({ signal: undefined, deadline: quiet(), stalled: quiet() });

  const ended = (over: Partial<StreamEnd> = {}): StreamEnd => ({
    terminated: false,
    finishReason: null,
    answered: true,
    ...over,
  });

  it("calls a terminated stream finished", () => {
    expect(classifyEnd(ended({ terminated: true }), calm())).toEqual({ kind: "finished" });
  });

  it('calls "stop" finished even without the terminator', () => {
    expect(classifyEnd(ended({ finishReason: "stop" }), calm())).toEqual({ kind: "finished" });
  });

  /* **The four the old guard walked straight past.** Each of these arrived with
     a finish reason, which is precisely what made the conjunction false. */
  it('calls "length" truncated rather than finished', () => {
    expect(classifyEnd(ended({ terminated: true, finishReason: "length" }), calm())).toEqual({
      kind: "truncated",
    });
  });

  it('calls "content_filter" filtered', () => {
    expect(classifyEnd(ended({ finishReason: "content_filter" }), calm())).toEqual({
      kind: "filtered",
    });
  });

  it('calls "tool_calls" a request for tools', () => {
    expect(classifyEnd(ended({ finishReason: "tool_calls" }), calm())).toEqual({
      kind: "wants-tools",
    });
  });

  it('calls "error" a provider failure', () => {
    expect(classifyEnd(ended({ finishReason: "error" }), calm())).toEqual({
      kind: "provider-failed",
    });
  });

  it("calls a stream that just stopped unterminated, which is the one the old guard could catch", () => {
    expect(classifyEnd(ended(), calm())).toEqual({ kind: "unterminated" });
  });

  /* **Ours before theirs.** A deadline or a stall aborts the reader, which ends
     the loop cleanly and leaves whatever reason had already arrived standing.
     Asking the provider first would file our own silence as whatever the model
     last happened to say — so these three carry a finish reason *and* a fired
     signal, and the signal has to win. */
  it("blames our deadline before anything the provider said", () => {
    expect(
      classifyEnd(ended({ terminated: true, finishReason: "stop" }), {
        signal: undefined,
        deadline: fired(),
        stalled: quiet(),
      }),
    ).toEqual({ kind: "timed-out" });
  });

  it("blames our stall timer before anything the provider said", () => {
    expect(
      classifyEnd(ended({ finishReason: "length" }), {
        signal: undefined,
        deadline: quiet(),
        stalled: fired(),
      }),
    ).toEqual({ kind: "went-quiet" });
  });

  it("calls it abandoned when the reader's own signal is the one that fired", () => {
    expect(
      classifyEnd(ended({ finishReason: "stop" }), {
        signal: fired(),
        deadline: quiet(),
        stalled: quiet(),
      }),
    ).toEqual({ kind: "abandoned" });
  });

  /* Our clocks abort the reader's signal too, so "the reader left" and "we gave
     up" are the same aborted signal seen twice. `readerAborted` is what tells
     them apart, and this is the case that proves it is still doing so. */
  it("does not call our own timeout an abandonment, though both signals are aborted", () => {
    expect(
      classifyEnd(ended(), { signal: fired(), deadline: fired(), stalled: quiet() }),
    ).toEqual({ kind: "timed-out" });
  });

  /**
   * **An unknown reason is finished, not failed**, and the asymmetry is
   * deliberate. A provider or gateway spelling its clean stop `end_turn` would
   * otherwise fail every call it served, and would fail it by throwing away a
   * complete reply somebody has already read. Wrong the other way costs one
   * case behaving as it did before this existed.
   */
  /**
   * **An unknown reason is reported, not resolved**, and that is the correction
   * a review of the plan made before any of this was built. Folding `end_turn`
   * into `finished` looks tidy and smuggles a decision — "an unrecognised stop
   * is a clean one" — out of the callers and into here, where it would be
   * everybody's and nobody would see it. The terminator travels with it so a
   * caller has both facts.
   */
  it("hands an unfamiliar finish reason back as a fact rather than resolving it", () => {
    expect(classifyEnd(ended({ terminated: true, finishReason: "end_turn" }), calm())).toEqual({
      kind: "unknown-finish-reason",
      reason: "end_turn",
      terminated: true,
    });
  });

  it("carries the terminator with it, because that is the half the caller needs", () => {
    expect(classifyEnd(ended({ finishReason: "end_turn" }), calm())).toEqual({
      kind: "unknown-finish-reason",
      reason: "end_turn",
      terminated: false,
    });
  });
});

/* **Where the other half is proven.** A classifier over fields nobody
   populates would answer "unterminated" for every stream and look principled —
   the same silent success in a new place. The writing happens in
   `openRouterStream` (src/ai-call.ts), not in `sseChunks`, which stays a parser
   and owns only framing facts like `[DONE]`; so the wiring is exercised where a
   real provider response goes through the real shim, in
   tests/quiz-mark-stream.test.tsx — "a reply the provider did not finish
   writing" sends `finish_reason: "length"` down a mocked fetch and asserts the
   mark is refused. That test fails if this field stops being written, which is
   the property worth having. Duplicating its fetch harness here to assert the
   field directly would buy a second copy of the same evidence. */
