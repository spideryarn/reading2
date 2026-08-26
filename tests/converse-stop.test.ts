/**
 * Stopping an answer — src/converse.ts, and the one branch of it that is not a
 * model call.
 *
 * `fetch` is stubbed, so this is deterministic and costs nothing. What is under
 * test is the thing docs/plans/chat-mode.md § "A stop is not a failure" asserts
 * and that nothing else can check: **the reader pressing stop must end in a
 * `done` event with `stopped: true`, never in a throw.** Every path that can
 * throw instead is a red row and an apology for a button they pressed on
 * purpose.
 *
 * It exists because that promise was broken twice in one afternoon, in two
 * different catches, and the second time it was broken there was already a test
 * asserting the correct behaviour — one that built its message row *by hand*
 * and so could pass while the code that would produce it did the opposite. The
 * tests here go through `converse` for that reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { converse, stoppedByReader } from "../src/converse.js";
import type { Block, Meta } from "../src/types.js";

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const blocks = [{ id: "spya-k3m9qt", html: "<p>alpha</p>", text: "alpha" }] as Block[];

/** One OpenRouter SSE frame carrying a piece of the answer. */
const delta = (text: string) =>
  `data: ${JSON.stringify({ model: "test/model", choices: [{ delta: { content: text } }] })}\n\n`;

/**
 * A response body that emits `frames` and then **stays open**, exactly as a
 * model still thinking does. Nothing here ever ends the stream: the only way
 * out of these tests is the abort, which is the point.
 */
function hangingBody(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent < frames.length) {
        controller.enqueue(encoder.encode(frames[sent] as string));
        sent++;
        return;
      }
      // Never resolves. The abort is what ends it.
      return new Promise<void>(() => {});
    },
  });
}

/** A `fetch` that honours the signal it is given, as the real one does. */
function stubFetch(make: () => Response | Promise<Response>) {
  return vi.fn((_url: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal;
    return new Promise<Response>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      void Promise.resolve(make()).then(resolve, reject);
    });
  });
}

/** Drain `converse` to its last event, stopping the moment `at` says so. */
async function run(signal: AbortSignal, stop: () => void, at: (chars: number) => boolean) {
  const events = [];
  let chars = 0;
  for await (const event of converse({ meta, blocks, history: [], question: "why?", slug: "example", signal })) {
    events.push(event);
    if (event.type === "delta") {
      chars += event.text.length;
      if (at(chars)) stop();
    }
  }
  return events;
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
});
afterEach(() => vi.unstubAllGlobals());

describe("a stop ends in `done`, never in a throw", () => {
  it("keeps the words that had arrived, and only those", async () => {
    /* Two frames are queued and the stop lands after the first, so the second
       must not be in the answer. That half of the assertion is the one worth
       having: "keeps what arrived" is easy to satisfy by accident if the whole
       body is read before anything is yielded. */
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      stubFetch(
        () => ({ ok: true, body: hangingBody([delta("Because "), delta("of X.")]) }) as Response,
      ),
    );
    const events = await run(
      controller.signal,
      () => controller.abort(new Error("stopped")),
      (c) => c >= "Because ".length,
    );
    const last = events.at(-1);
    expect(last?.type).toBe("done");
    if (last?.type !== "done") return;
    expect(last.stopped).toBe(true);
    // Trimmed, as every stored answer is. The trailing space went with it.
    expect(last.text).toBe("Because");
  });

  it("survives a stop landing before the model's first byte", async () => {
    /* The catch around the *initial* fetch, which is a different catch from the
       one around the chunk loop and was missed the first time. A model that
       queues, or searches the web before it says anything, leaves the reader
       looking at `thinking…` with a live stop button for several seconds — so
       this is the window a stop is MOST likely to land in, and it was the one
       that stored `AbortError: stopped by the reader` as a failed answer. */
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      stubFetch(() => new Promise<Response>(() => {})), // never replies
    );
    const events: unknown[] = [];
    const iterator = converse({
      meta,
      blocks,
      history: [],
      question: "why?",
      slug: "example",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("stopped by the reader")), 5);
    for await (const event of iterator) events.push(event);
    expect(events).toEqual([
      {
        type: "done",
        text: "",
        citations: [],
        searches: 0,
        model: expect.any(String),
        unknownIds: [],
        // Empty rather than absent: `converse` always says what its tools did,
        // and on a stop before the first byte the honest answer is "nothing".
        tools: [],
        // A stop is not a truncation. Nothing ran out of room; the reader
        // ended it, which is what `stopped` beneath already says.
        truncated: false,
        stopped: true,
        // Four nulls, not four zeros. Nothing was asked, so the provider
        // reported nothing — and "we were never told" has to stay tellable
        // from "the cache read nothing", which is the alarm.
        usage: {
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
        },
      },
    ]);
  });

  it("keeps what a paid round already bought when the stop lands between rounds", async () => {
    /* A turn is several requests now, and this is the gap between two of them:
       round one has run a tool and been billed for it, round two is connecting,
       and the reader presses stop. That used to yield a hard-coded `done` — no
       text, no citations, no searches, four null token counts — under a comment
       saying "nothing was asked, so there is nothing to report". True of a
       function that made one request; false the day a turn became several. The
       reader had already paid for a round, and this threw the receipt away.
       Found by a GPT Sol review, 2026-08-26. */
    const encoder = new TextEncoder();
    /** A body that emits its frames and then properly ends, unlike `hangingBody`. */
    const closedBody = (frames: string[]) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          for (const f of frames) c.enqueue(encoder.encode(f));
          c.enqueue(encoder.encode("data: [DONE]\n\n"));
          c.close();
        },
      });

    const controller = new AbortController();
    let call = 0;
    vi.stubGlobal(
      "fetch",
      stubFetch(() => {
        call++;
        if (call > 1) return new Promise<Response>(() => {}); // round two never replies
        return {
          ok: true,
          body: closedBody([
            delta("Looking that up. "),
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "toolu_1",
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
            })}\n\n`,
            `data: ${JSON.stringify({
              choices: [],
              usage: { prompt_tokens: 1234, completion_tokens: 56, prompt_tokens_details: { cached_tokens: 78 } },
            })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ finish_reason: "tool_calls", delta: {} }] })}\n\n`,
          ]),
        } as Response;
      }),
    );

    const events: { type: string }[] = [];
    setTimeout(() => controller.abort(new Error("stopped")), 40);
    for await (const event of converse({
      meta,
      blocks,
      history: [],
      question: "why?",
      slug: "example",
      signal: controller.signal,
    })) {
      events.push(event);
    }
    const last = events.at(-1) as
      | {
          type: string;
          text: string;
          stopped: boolean;
          tools: unknown[];
          usage: { inputTokens: number | null; outputTokens: number | null };
        }
      | undefined;
    expect(last?.type).toBe("done");
    expect(last?.stopped).toBe(true);
    // The words round one wrote, and the tool it ran.
    expect(last?.text).toBe("Looking that up.");
    expect(last?.tools).toHaveLength(1);
    // And what it cost. Nulls here would say the turn was free, which it was not.
    expect(last?.usage.inputTokens).toBe(1234);
    expect(last?.usage.outputTokens).toBe(56);
  });

  it("does not call a stop a garbled tool call", async () => {
    /* The stop that lands while a tool call is still arriving. The catch around
       the chunk loop sets `stopped` and falls through rather than throwing, so
       the guards below it run — and the fragments the reader interrupted are, by
       definition, unassembled. The malformed-call guard was not looking at
       `stopped`, so it filed the interruption as "the request for it arrived
       garbled": a red row and an apology for a button they had just pressed.
       Which is the very bug the empty-answer guard beside it already carries a
       stop branch to prevent. Found by a GPT Sol review, 2026-08-27. */
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      stubFetch(
        () =>
          ({
            ok: true,
            body: hangingBody([
              // A fragment with no id and no name — the head never arrived.
              `data: ${JSON.stringify({
                model: "test/model",
                choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] } }],
              })}\n\n`,
              `data: ${JSON.stringify({ choices: [{ finish_reason: "tool_calls", delta: {} }] })}\n\n`,
            ]),
          }) as Response,
      ),
    );

    const events: { type: string }[] = [];
    let failure: string | null = null;
    setTimeout(() => controller.abort(new Error("stopped")), 20);
    try {
      for await (const event of converse({
        meta,
        blocks,
        history: [],
        question: "why?",
        slug: "example",
        signal: controller.signal,
      })) {
        events.push(event);
      }
    } catch (err) {
      failure = (err as Error).message;
    }
    expect(failure).toBeNull();
    const last = events.at(-1) as { type: string; stopped: boolean } | undefined;
    expect(last?.type).toBe("done");
    expect(last?.stopped).toBe(true);
  });

  it("does not run the rest of a tool batch after the reader has stopped", async () => {
    /* A model can ask for three tools at once and they run one at a time, so a
       stop landing during the first used to wait for all three: the signal was
       only consulted *after* the whole batch. Which is the opposite of what a
       stop button is for, and it also let a turn run past its own deadline —
       the deadline was attached to the model requests and to nothing else.
       Found by a GPT Sol review, 2026-08-26.

       The stop is delivered from inside the loop over the events, at the moment
       the first tool reports `done`. That is deterministic in a way a timer is
       not: the generator is suspended at that `yield` while this runs. */
    const encoder = new TextEncoder();
    const three = [0, 1, 2].map(
      (i) =>
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: i,
                    id: `toolu_${i}`,
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
        })}\n\n`,
    );
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      stubFetch(
        () =>
          ({
            ok: true,
            body: new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(encoder.encode(delta("Looking. ")));
                for (const f of three) c.enqueue(encoder.encode(f));
                c.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ choices: [{ finish_reason: "tool_calls", delta: {} }] })}\n\n`,
                  ),
                );
                c.enqueue(encoder.encode("data: [DONE]\n\n"));
                c.close();
              },
            }),
          }) as Response,
      ),
    );

    const events: { type: string; run?: { status: string } }[] = [];
    let stoppedAt = -1;
    for await (const event of converse({
      meta,
      blocks,
      history: [],
      question: "why?",
      slug: "example",
      signal: controller.signal,
    })) {
      events.push(event as { type: string; run?: { status: string } });
      if (event.type === "tool" && event.run.status === "done" && stoppedAt < 0) {
        stoppedAt = events.length;
        controller.abort(new Error("stopped"));
      }
    }

    expect(stoppedAt).toBeGreaterThan(0);
    const done = events.at(-1) as { type: string; stopped: boolean; tools: unknown[] } | undefined;
    expect(done?.type).toBe("done");
    expect(done?.stopped).toBe(true);
    // One tool ran, not three. The two the model also asked for were dropped.
    expect(done?.tools).toHaveLength(1);
    // And nothing was left mid-flight: a `running` row nothing finishes is the
    // one thing this loop must never store.
    const [first] = (done?.tools ?? []) as { status: string }[];
    expect(first?.status).toBe("done");
  });

  it("stops a tool batch when the turn's own deadline fires, and says so", async () => {
    /* `readerAborted` answers "was this the reader?", and returns false the
       moment the deadline has fired — correct for what it is asked, and it meant
       the between-tools check let a turn that had already run out of time work
       through the rest of its batch. No further model request was ever paid for
       (the next `fetch` rejects on the composite signal); the wasted work was
       the tools, and the reader was told about it late. Found by a GPT Sol
       review, 2026-08-27.

       Deterministic despite involving a real clock, because the generator is
       *suspended* at the `yield` below while this waits: the deadline is
       guaranteed to have fired by the time it resumes. */
    const encoder = new TextEncoder();
    const two = [0, 1].map(
      (i) =>
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: i,
                    id: `toolu_${i}`,
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
        })}\n\n`,
    );
    vi.stubGlobal(
      "fetch",
      stubFetch(
        () =>
          ({
            ok: true,
            body: new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(encoder.encode(delta("Looking. ")));
                for (const f of two) c.enqueue(encoder.encode(f));
                c.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ choices: [{ finish_reason: "tool_calls", delta: {} }] })}\n\n`,
                  ),
                );
                c.enqueue(encoder.encode("data: [DONE]\n\n"));
                c.close();
              },
            }),
          }) as Response,
      ),
    );

    const ran: string[] = [];
    let failure: string | null = null;
    try {
      for await (const event of converse({
        meta,
        blocks,
        history: [],
        question: "why?",
        slug: "example",
        timeoutMs: 60,
      })) {
        if (event.type === "tool" && event.run.status === "done") {
          ran.push(event.run.name);
          // Hold here, suspended, until the turn's deadline has passed.
          await new Promise((r) => setTimeout(r, 80));
        }
      }
    } catch (err) {
      failure = (err as Error).message;
    }

    // The first tool ran; the second never started.
    expect(ran).toHaveLength(1);
    // And the reader is told the true thing — a deadline, not a silent stop.
    // `[ai-slow]` is `tookTooLong`; the number in the sentence is the deadline,
    // which is 60 milliseconds here and reads oddly, so the code is what is
    // pinned rather than the prose.
    expect(failure).toContain("did not finish within");
    expect(failure).toContain("[ai-slow]");
  });

  it("survives a stop after the response arrives but before a single word does", async () => {
    // The empty-answer check used to throw here — "the model returned no text"
    // — which is true of a broken provider and false of a reader in a hurry.
    const controller = new AbortController();
    vi.stubGlobal("fetch", stubFetch(() => ({ ok: true, body: hangingBody([]) }) as Response));
    const events: { type: string }[] = [];
    setTimeout(() => controller.abort(new Error("stopped")), 5);
    for await (const event of converse({
      meta,
      blocks,
      history: [],
      question: "why?",
      slug: "example",
      signal: controller.signal,
    })) {
      events.push(event);
    }
    const last = events.at(-1) as { type: string; text: string; stopped: boolean } | undefined;
    expect(last?.type).toBe("done");
    expect(last?.stopped).toBe(true);
    expect(last?.text).toBe("");
  });
});

describe("stoppedByReader — was that actually the reader?", () => {
  const fresh = () => new AbortController();

  it("says yes for the caller's own signal, carrying its own reason", () => {
    const reader = fresh();
    const reason = new Error("stopped by the reader");
    reader.abort(reason);
    expect(stoppedByReader(reason, reader.signal, fresh().signal, fresh().signal)).toBe(true);
  });

  it("says no when the deadline or the stall fired, even if the reader also did", () => {
    /* Order matters, and this is the case it decides. A reader who presses stop
       *because* nothing has arrived for a minute has both signals aborted, and
       calling that a stop would tell them they ended an answer the model had
       already given up on. */
    const reader = fresh();
    const reason = new Error("stopped");
    reader.abort(reason);
    const deadline = fresh();
    deadline.abort(new Error("timeout"));
    expect(stoppedByReader(reason, reader.signal, deadline.signal, fresh().signal)).toBe(false);
    const stall = fresh();
    stall.abort(new Error("stalled"));
    expect(stoppedByReader(reason, reader.signal, fresh().signal, stall.signal)).toBe(false);
  });

  it("says no to a failure that merely coincided with the stop", () => {
    /* A provider error thrown from inside the loop while the signal happens to
       be aborted. Reclassifying it as a stop threw the provider's message away
       and committed the half answer as clean — so the one thing that could have
       explained the failure was the one thing not recorded. */
    const reader = fresh();
    reader.abort(new Error("stopped"));
    const provider = new Error("OpenRouter: upstream refused");
    expect(stoppedByReader(provider, reader.signal, fresh().signal, fresh().signal)).toBe(false);
  });

  it("says no when nobody asked it to stop", () => {
    expect(stoppedByReader(new Error("x"), undefined, fresh().signal, fresh().signal)).toBe(false);
  });
});

describe("failures are loud", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says a silence is a silence, not a slow answer", async () => {
    /* Mirrors tests/explain.test.ts § "says a silence is a silence" — the one
       failure a mock made of whole SSE frames cannot produce: a body that opens
       and then sends nothing at all, so only the stall clock ends the stream.
       `sseChunks` cancels the reader when the stall fires, and a cancelled read
       resolves `{ done: true }` rather than throwing — so the loop exits
       cleanly, with neither `[DONE]` nor a `finish_reason`, and it is the
       post-loop guards' job to tell that apart from a connection that merely
       stopped.

       explain.ts had a guard for exactly this and converse.ts did not, so this
       threw the generic "before it was finished" and logged `ended without
       finishing` where it should have said `stalled: true` — the one line
       somebody reads to decide whether to blame the network or the provider.
       docs/postmortems/converse-stall-misfiled-as-incomplete.md. */
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream<Uint8Array>({ pull() {} }), // opens, then says nothing
      } as unknown as Response),
    );

    async function run() {
      for await (const _event of converse({
        meta,
        blocks,
        history: [],
        question: "why?",
        slug: "example",
        stallMs: 20,
      })) {
        // Draining is the point; the throw happens once the loop ends.
      }
    }

    /* Matched on the bracketed code rather than the sentence. The wording is
       reader-facing copy and is expected to be revised (docs/project/copy.md);
       the code is the stable part, and is there precisely so a test does not
       pin prose. */
    await expect(run()).rejects.toThrow(/\[ai-stalled\]/);
  });

  it("refuses without repeating what the provider said", async () => {
    /* The leak this pins: OpenRouter's error body is the one place an upstream
       might echo part of what we sent, and what we sent is the whole article
       plus the reader's question. It used to reach `Error.message`, which
       routes.ts hands to Pino *and* returns to the client — article prose in a
       log, which docs/project/logging.md forbids outright.

       Written for all three callers rather than just the one that had a test,
       because the leak was in all three: converse, explain and search each had
       their own copy of the throw. See `providerRefused` in
       src/openrouter-stream.ts. */
    const secret = "your prompt contained: the whole article, verbatim";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => secret,
        body: null,
      } as unknown as Response),
    );

    async function run() {
      for await (const _event of converse({ meta, blocks, history: [], question: "why?", slug: "example" })) {
        // Draining is the point; the throw happens on the failed response.
      }
    }

    await expect(run()).rejects.toThrow(/\[ai-busy\]/);
    await expect(run()).rejects.not.toThrow(/whole article, verbatim/);
  });
});
