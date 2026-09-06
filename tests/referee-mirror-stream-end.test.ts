/**
 * **How a Mirror stream is allowed to end** — the policy half of
 * `mirrorStream` in src/referee-mirror.ts.
 *
 * Mirror reads the same shared classification every other streaming caller does
 * (`classifyEnd` in src/ai-call.ts) and then makes its own decisions from it,
 * which is the reason that function reports rather than decides. Two of those
 * decisions are worth pinning, because both look like omissions to somebody
 * reading the switch cold.
 *
 * **Why a file of its own.** tests/referee-mirror.test.ts is Mirror's
 * deterministic half and says so in its first line — nothing in it calls a
 * model. tests/referee-mirror-route.test.ts stubs `fetch` to *throw*, because
 * its whole point is that certain runs never reach the model.
 * tests/referee-mirror-stream.test.tsx is the React hook. And
 * tests/overflow-message-reaches-its-caller.test.ts drives `mirrorStream` over
 * real SSE but exists for one property compared across four callers. So Mirror
 * was the one of the four JSON callers with no place to put this; Search has
 * tests/search-stream.test.ts and the other two referee runs have their own run
 * files.
 *
 * Modelled on tests/search-stream.test.ts § "what the provider says about how it
 * stopped". See
 * docs/plans/260901g-one-stream-end-classification-shared-by-five-callers.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mirrorStream } from "../src/referee-mirror.js";
import type { Block, BlockId, Comment } from "../src/types.js";

const METHODS = "Participants were randomised by a computer-generated sequence held off site.";

const BLOCKS: Block[] = [
  {
    id: "spya-k3m9qt" as BlockId,
    tag: "p",
    kind: "text",
    text: METHODS,
    words: METHODS.split(/\s+/).length,
    html: `<p>${METHODS}</p>`,
    gistable: true,
  },
];

/** One comment with something written under it, so Mirror reaches the model. */
const COMMENT: Comment = {
  id: "spya-c00001",
  blockId: "spya-k3m9qt" as BlockId,
  quote: "randomised",
  start: METHODS.indexOf("randomised"),
  createdAt: "2026-09-02T00:00:00.000Z",
  status: "none",
  body: "This does not say who held the sequence.",
};

/* The wire shape `validateRemarks` actually reads: `comment`, not `commentId`,
   and one of the three kinds the model is allowed to send. */
const REMARK = { kind: "specificity", comment: "spya-c00001", note: "Say who held it." };

/** One SSE frame, exactly as OpenRouter writes them. */
const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

/** A response whose body is the given SSE text, split so a `data:` line lands
    across two reads — the same awkwardness tests/search-stream.test.ts uses. */
function sse(raw: string, splitAt = 7): Response {
  const bytes = new TextEncoder().encode(raw);
  const parts = [bytes.slice(0, splitAt), bytes.slice(splitAt)].filter((p) => p.length > 0);
  let i = 0;
  return {
    ok: true,
    headers: new Headers(),
    body: new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < parts.length) c.enqueue(parts[i++] as Uint8Array);
        else c.close();
      },
    }),
  } as unknown as Response;
}

/** A complete `{"remarks": [...]}` object, then the given finish reason, then
    `[DONE]` — every witness but `finish_reason` saying this went well. */
function endedWith(reason: string): Response {
  return sse(
    frame({
      model: "anthropic/claude-sonnet-4.5",
      choices: [{ delta: { content: JSON.stringify({ remarks: [REMARK] }) } }],
    }) +
      frame({ choices: [{ finish_reason: reason, delta: {} }] }) +
      "data: [DONE]\n\n",
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("what the provider says about how it stopped", () => {
  it("refuses a run the provider itself said it errored out of, even though it parses", async () => {
    /* **The one behaviour the shared classifier changed here.** The object is
       complete and `[DONE]` arrives, so every other witness says this is a good
       run; only `finish_reason` disagrees, and the guard it used to reach was a
       conjunction that a non-null reason could only make *less* likely to fire.
       It is the same event as an `error` inside a 200, arriving in a field
       rather than as data, so it gets the same sentence. */
    fetchMock.mockResolvedValue(endedWith("error"));

    /* Collected rather than drained, so the assertion can be the expensive half:
       the text really did stream, so a referee watching really was shown it, and
       the run is still refused. Without this the test would pass on a stream
       that produced nothing — a much easier thing to refuse. */
    let streamed = "";
    let sawDone = false;
    let thrown: Error | undefined;
    try {
      for await (const e of mirrorStream({ blocks: BLOCKS, comments: [COMMENT] })) {
        if (e.type === "delta") streamed += e.text;
        else sawDone = true;
      }
    } catch (err) {
      thrown = err as Error;
    }
    expect(streamed).toContain("Say who held it.");
    expect(sawDone).toBe(false);
    expect(thrown?.message).toMatch(/\[ai-interrupted\]/);
  });

  it("accepts a `length` that landed after the object closed, rather than refusing a short answer", async () => {
    /* The control for `case "truncated"` being a `break`. Quiz refuses every
       `length`; Mirror must not, because a model that fills its budget with a
       couple of good remarks and stops has produced a legitimately short
       answer — and a `length` that lands mid-object is already caught by the
       strict parse, which tests/overflow-message-reaches-its-caller.test.ts
       pins. Without this, "refuse every truncation" would pass the whole file. */
    fetchMock.mockResolvedValue(endedWith("length"));
    let done: { remarks: readonly unknown[] } | undefined;
    for await (const e of mirrorStream({ blocks: BLOCKS, comments: [COMMENT] })) {
      if (e.type === "done") done = e;
    }
    expect(done?.remarks).toHaveLength(1);
  });
});
