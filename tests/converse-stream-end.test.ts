/**
 * How a chat turn reads the *end* of each stream it makes — src/converse.ts.
 *
 * Separate from tests/converse-stop.test.ts, whose whole promise is one thing
 * ("a reader's stop is a `done` with `stopped: true`, never a throw") and which
 * should stay about that. This file is about the other half: a turn is up to
 * `MAX_TOOL_ROUNDS + 1` provider requests, each ends its own way, and the turn's
 * verdict is a **fold** over the rounds' — which is where two bugs lived.
 *
 * 1. `finish_reason: "error"` was handed on as a finished answer. It reached the
 *    conjunction `!end.terminated && finishReason === null`, where a non-null
 *    reason could only make the guard *less* likely to fire — so a provider that
 *    said it had failed had its half-answer stored as a whole one. Converse
 *    already throws `providerFailedMidAnswer()` for the same event arriving as
 *    `chunk.error` data.
 * 2. `truncated` read only the **last** round's reason, so a round cut off at
 *    `max_tokens` mid-sentence, whose partial tool call still reassembled, went
 *    round again and had its reason overwritten. The answer the reader was shown
 *    stopped mid-sentence and the flag said it had not.
 *
 * docs/plans/260901g-one-stream-end-classification-shared-by-five-callers.md § Stage E,
 * docs/postmortems/260901c-the-success-signal-that-outlived-its-witness.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ConverseEvent, converse } from "../src/converse.js";
import type { Block, Meta } from "../src/types.js";

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const blocks = [{ id: "spya-k3m9qt", html: "<p>alpha</p>", text: "alpha" }] as Block[];

/** One OpenRouter SSE frame carrying a piece of the answer. */
const delta = (text: string) =>
  `data: ${JSON.stringify({ model: "test/model", choices: [{ delta: { content: text } }] })}\n\n`;

/** A frame that says why the model stopped, and nothing else. */
const ends = (reason: string) =>
  `data: ${JSON.stringify({ choices: [{ finish_reason: reason, delta: {} }] })}\n\n`;

/**
 * A frame asking for one tool, whole — an id and a name, which is all `wanted`
 * needs to survive reassembly and send the turn round again.
 */
const asksForATool = (index: number) =>
  `data: ${JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index,
              id: `toolu_${index}`,
              type: "function",
              function: {
                name: "search_article_words",
                arguments: JSON.stringify({ query: "alpha" }),
              },
            },
          ],
        },
      },
    ],
  })}\n\n`;

const encoder = new TextEncoder();
/** A body that emits its frames, adds `[DONE]`, and closes — a well-behaved stream. */
const closedBody = (frames: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(encoder.encode(f));
      c.enqueue(encoder.encode("data: [DONE]\n\n"));
      c.close();
    },
  });

/** A `fetch` handing out one body per round, in order. */
function roundsOf(...bodies: string[][]) {
  let call = 0;
  return vi.fn(async () => {
    const frames = bodies[call] ?? bodies[bodies.length - 1] ?? [];
    call++;
    return { ok: true, headers: new Headers(), body: closedBody(frames) } as Response;
  });
}

/** Drain a whole turn and hand back its events. */
async function drain() {
  const events = [];
  for await (const event of converse({
    meta,
    blocks,
    history: [],
    question: "why?",
    slug: "example",
  })) {
    events.push(event);
  }
  return events;
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
});
afterEach(() => vi.unstubAllGlobals());

describe("a provider that says it failed", () => {
  it("throws rather than storing the half-answer as a whole one", async () => {
    /* A complete-looking answer, `finish_reason: "error"`, and then `[DONE]` —
       which is the shape that made the old guard unfireable twice over: the
       terminator arrived *and* the reason was non-null, and the guard wanted
       neither. Converse throws exactly this for the same failure arriving as
       `chunk.error` data; the field form is the one that got through. */
    vi.stubGlobal("fetch", roundsOf([delta("Here is the answer."), ends("error")]));
    let failure: string | null = null;
    let events: { type: string }[] = [];
    try {
      events = await drain();
    } catch (err) {
      failure = (err as Error).message;
    }
    /* Asserted as "something was thrown" before "it was the right thing",
       because the mutation that matters here — turning the `throw` back into a
       `break` — leaves `failure` null, and `expect(null).toContain(…)` reports
       an argument-type complaint rather than the fact that a truncated failure
       was delivered as an answer. A red test has to say what went wrong.
       docs/reusable/silent-success.md. */
    expect(failure).not.toBeNull();
    /* The bracketed code, not the sentence — the prose is reader-facing copy and
       is expected to be revised (docs/project/copy.md). */
    expect(failure).toContain("[ai-interrupted]");
    // And nothing was yielded that says the answer finished.
    expect(events.some((e) => e.type === "done")).toBe(false);
  });
});

describe("a terminator that had already arrived when our own clock fired", () => {
  it("delivers the finished answer rather than throwing it away as a timeout", async () => {
    /* **`[DONE]` is proof the whole response arrived**, and `classifyEnd` used
       to ask the signals first — so a deadline that fired in the gap between the
       terminator being received and the loop noticing it threw away a complete
       answer the reader had already watched appear, with "[ai-slow] … try
       again". GPT Sol's finding F5, reproduced here without its timing harness.

       The whole reply — prose, finish reason and `[DONE]` — is **one enqueued
       chunk**, so `sseChunks` takes it in a single `read()` and then walks its
       own line buffer, yielding the prose from inside that walk. It is suspended
       *there*, with `[DONE]` already received and not yet seen, which is exactly
       the gap. This test is the consumer, so sleeping between events resumes it
       only after the deadline has fired — no race, and nothing depending on how
       fast the box is beyond the 200 ms margin. */
    const wholeReplyInOneChunk = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(
          encoder.encode(`${delta("A whole answer.")}${ends("stop")}data: [DONE]\n\n`),
        );
        c.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers(),
        body: wholeReplyInOneChunk,
      }) as unknown as Response),
    );

    const events: ConverseEvent[] = [];
    let failure: string | null = null;
    try {
      for await (const event of converse({
        meta,
        blocks,
        history: [],
        question: "why?",
        slug: "example",
        timeoutMs: 50,
      })) {
        events.push(event);
        // Hand control back only once the deadline is certainly past.
        if (event.type === "delta") await new Promise((r) => setTimeout(r, 250));
      }
    } catch (err) {
      failure = (err as Error).message;
    }

    expect(failure).toBeNull();
    const last = events.at(-1);
    expect(last?.type).toBe("done");
    if (last?.type !== "done") return;
    expect(last.text).toBe("A whole answer.");
    // And it is not reported as a stop either: nobody stopped anything.
    expect(last.stopped).toBe(false);
  });
});

describe("truncation is folded over the rounds, not read off the last one", () => {
  it("flags a turn whose first round ran out of room mid-sentence", async () => {
    /* The hole the plan names. Round one writes prose, asks for a tool, and is
       cut off at `max_tokens` — `finish_reason: "length"`. Its partial call
       still reassembles (`wanted` needs only an id and a name), so the turn goes
       round again, and round two's clean `stop` used to overwrite the reason.
       The reader was shown a sentence that stops halfway and told nothing. */
    vi.stubGlobal(
      "fetch",
      roundsOf(
        [delta("The three reasons are, first, that the"), asksForATool(0), ends("length")],
        [delta("Here is the rest."), ends("stop")],
      ),
    );
    const events = await drain();
    const last = events.at(-1);
    expect(last?.type).toBe("done");
    if (last?.type !== "done") return;
    expect(last.truncated).toBe(true);
    // A tool really did run, which is what took the turn into a second round.
    expect(last.tools).toHaveLength(1);
  });

  it("does not flag a round cut off inside its tool arguments having written nothing", async () => {
    /* The control against the fix over-reaching, and the reason the second
       disjunct is guarded on the round's own prose. The panel's sentence for
       `truncated` is a **failure** with a retry offered — "This answer ran out
       of room and stopped mid-sentence" — and a round that wrote no prose left
       nothing mid-sentence in the stored answer. Green before the fix and after. */
    vi.stubGlobal(
      "fetch",
      roundsOf(
        [asksForATool(0), ends("length")],
        [delta("Here is the answer."), ends("stop")],
      ),
    );
    const events = await drain();
    const last = events.at(-1);
    expect(last?.type).toBe("done");
    if (last?.type !== "done") return;
    expect(last.truncated).toBe(false);
    expect(last.text).toBe("Here is the answer.");
  });
});
