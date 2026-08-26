/**
 * `sseChunks`'s `strict` parameter — src/openrouter-stream.ts.
 *
 * The shared SSE parser chat, explain and search all drive. Its default,
 * lenient behaviour (skip a `data:` frame that doesn't parse as JSON) is
 * right for chat and explain, whose payload is prose: a dropped frame costs
 * a few words. It is wrong for search, whose payload is one JSON object —
 * dropping a frame there can drop exactly one element of the `hits` array
 * while leaving text either side that still parses, so search opts into
 * `strict: true` and throws instead. Found by a GPT Sol review, 2026-08-26.
 *
 * This file pins the parameter itself, in isolation from any particular
 * caller. tests/search-stream.test.ts pins the same thing through
 * `findPassagesStream`, end to end.
 */
import { describe, expect, it } from "vitest";
import { sseChunks } from "../src/openrouter-stream.js";
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

  it("strict: true throws on the same malformed frame instead of silently dropping it", async () => {
    const body = sseBody(
      frame('{"choices":[{"delta":{"content":"a"}}]}') + frame("{this is not json"),
    );
    const end: StreamEnd = { terminated: false };
    await expect(
      drain(sseChunks(body, new AbortController().signal, () => {}, end, true)),
    ).rejects.toThrow(/\[ai-unreadable\]/);
  });

  it("strict throws without leaking the offending text — that text is the model's own output", async () => {
    // V8 puts a prefix of the bad input into a bare SyntaxError's message.
    // `providerSpokeNonsense()` is what strict mode throws instead, and this
    // is the assertion that would catch a regression back to the raw error.
    const secret = "REASONING: the reader's private criterion was";
    const body = sseBody(frame(`{${secret}`));
    const end: StreamEnd = { terminated: false };
    const err = await drain(
      sseChunks(body, new AbortController().signal, () => {}, end, true),
    ).then(
      () => { throw new Error("expected a rejection"); },
      (e: unknown) => e as Error,
    );
    expect(err.message).not.toMatch(/reader's private criterion/);
  });

  it("does not treat `[DONE]` as a malformed frame in either mode", async () => {
    const body = sseBody(`${frame('{"choices":[{"delta":{"content":"a"}}]}')}data: [DONE]\n\n`);
    const end: StreamEnd = { terminated: false };
    const chunks = await drain(sseChunks(body, new AbortController().signal, () => {}, end, true));
    expect(chunks).toHaveLength(1);
    expect(end.terminated).toBe(true);
  });
});
