/**
 * The pages a chat answer cites, gathered across a turn that took two requests.
 *
 * `collectCitations` (src/openrouter-stream.ts) has its own unit tests, and they
 * cover the rules — dedupe, first title wins, drop anything that is not
 * http(s). What they cannot reach is the thing this file is for: **the map
 * lives above the round loop, so a page cited in round one is still cited after
 * round two.** That is a fact about `converse`, not about the collector, and
 * nothing else asserts it.
 *
 * It matters because the two halves fail in opposite directions and both are
 * quiet. Reset the map per round and a reader gets round two's citations only,
 * with round one's reading silently thrown away. Keep it but let a later
 * sighting overwrite an earlier one and the *title* changes under them — which
 * is the one field a provider is least consistent about between rounds.
 * `searches` was broken in exactly this way in this exact loop and stored an
 * answer that said the model had not searched while showing its citations
 * (src/converse.ts, 2026-08-26); the citations beside it had no test at all.
 * Named as the gap by a GPT Sol review, 2026-08-28.
 *
 * `fetch` is stubbed, so this is deterministic and costs nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { converse } from "../src/converse.js";
import type { Block, Meta } from "../src/types.js";

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const blocks = [{ id: "spya-k3m9qt", html: "<p>alpha</p>", text: "alpha" }] as Block[];

const encoder = new TextEncoder();

/** A body that emits its frames and then ends, as a finished round does. */
function closedBody(frames: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(encoder.encode(f));
      c.enqueue(encoder.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

const delta = (text: string) => frame({ model: "test/model", choices: [{ delta: { content: text } }] });

/** One `url_citation` annotation, in the shape OpenRouter sends it. */
const cite = (url: string, title?: string) =>
  frame({
    choices: [
      {
        delta: {
          annotations: [{ type: "url_citation", url_citation: { url, ...(title ? { title } : {}) } }],
        },
      },
    ],
  });

/** The frame that ends a round, and says whether another one follows. */
const ends = (reason: "tool_calls" | "stop") => frame({ choices: [{ finish_reason: reason, delta: {} }] });

/** A tool call, so that round one is followed by a round two. */
const toolCall = frame({
  choices: [
    {
      delta: {
        tool_calls: [
          {
            index: 0,
            id: "toolu_1",
            type: "function",
            function: { name: "search_article_words", arguments: JSON.stringify({ query: "alpha" }) },
          },
        ],
      },
    },
  ],
});

/** A `fetch` that answers each round from `rounds`, in order. */
function stubRounds(rounds: string[][]) {
  let call = 0;
  return vi.fn(
    () =>
      Promise.resolve({
        ok: true,
        headers: new Headers(),
        body: closedBody(rounds[call++] ?? []),
      }) as Promise<Response>,
  );
}

/** Drain `converse` and return its `done` event. */
async function answer() {
  const events = [];
  for await (const event of converse({
    meta,
    blocks,
    history: [],
    question: "why?",
    slug: "example",
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }
  const last = events.at(-1);
  if (last?.type !== "done") throw new Error(`expected a done event, got ${last?.type}`);
  return last;
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
});
afterEach(() => vi.unstubAllGlobals());

describe("citations survive the round that follows them", () => {
  it("keeps a page cited in round one, with the title it had then", async () => {
    /* The two rounds cite the same page under different titles, and round two
       also cites one of its own. Both halves of the assertion are load-bearing:
       `one.example` being present at all is what the hoisting buys, and its
       title still being round one's is what the dedupe buys. Two rounds citing
       the same page under the *same* title would pass with either one deleted —
       see docs/reusable, and tests/collect-citations.test.ts, where that exact
       fixture was hiding the dedupe it was named after. */
    vi.stubGlobal(
      "fetch",
      stubRounds([
        [delta("Looking that up. "), cite("https://one.example/a", "First look"), toolCall, ends("tool_calls")],
        [
          delta("Here it is."),
          cite("https://one.example/a", "Second look"),
          cite("https://two.example/b", "The other one"),
          ends("stop"),
        ],
      ]),
    );

    const done = await answer();
    expect(done.citations).toEqual([
      { url: "https://one.example/a", title: "First look" },
      { url: "https://two.example/b", title: "The other one" },
    ]);
    // Both rounds' words, so the failure above cannot be a turn that stopped early.
    expect(done.text).toBe("Looking that up. Here it is.");
  });

  it("drops a citation whose URL is not http(s), in a later round as in the first", async () => {
    /* The drop is `collectCitations`'s rule and is tested there. What is here is
       that the later round goes through the same call — an early draft collected
       round one's annotations and read round two's straight off the chunk. */
    vi.stubGlobal(
      "fetch",
      stubRounds([
        [cite("https://one.example/a", "Kept"), toolCall, ends("tool_calls")],
        [delta("Done."), cite("javascript:alert(1)", "Not a page"), ends("stop")],
      ]),
    );

    const done = await answer();
    expect(done.citations).toEqual([{ url: "https://one.example/a", title: "Kept" }]);
  });
});
