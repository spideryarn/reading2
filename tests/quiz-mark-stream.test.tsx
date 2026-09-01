// @vitest-environment jsdom
/**
 * **A mark stream that stops without finishing must not tick the question.**
 *
 * This is the test the plan calls the most important one in stage 2, and the
 * reason is one sentence: *a provider or a socket can stop cleanly without
 * finishing, and that looks exactly like finishing.* A mocked complete SSE
 * transcript proves nothing about it — every frame arrives, the reply is whole,
 * and the assertion passes for the wrong reason. So the case here is a body
 * that emits two `delta` frames and then **closes with no terminal frame at
 * all**: no `done`, no `error`, just an ordinary end of stream.
 *
 * What must happen:
 *
 * - the question is **not** in `answered` — a tick is a claim the reader
 *   answered it and the model replied, and neither half is true;
 * - the attempt ends `failed` rather than `done`, so the panel keeps the Answer
 *   button live and the reader can try again;
 * - the two deltas that *did* arrive are kept, because the reader has already
 *   read them and half a mark plus a reason beats a spinner that turns into
 *   nothing.
 *
 * The three cases beside it are the ones that would make this vacuous if they
 * were wrong: a complete stream **does** tick; an explicit `error` frame does
 * not; and a mid-stream `error` after two deltas keeps the deltas.
 *
 * Harness copied from tests/use-chat-recovery.test.ts — React's own `act` and
 * `createRoot`, no testing library, a stubbed `fetch`. Real timers here, unlike
 * there: nothing under test is on a clock, and `readEvents`' stall timer is
 * sixty seconds away from anything this file does.
 *
 * ## Both halves of the same stream live here
 *
 * The describes above are the **client** half — what `useQuiz` does with the
 * frames it is handed. The two at the bottom are the **server** half:
 * `markAnswerStream` itself, driven by a stubbed provider, because the two
 * remaining ways a mark can be quietly wrong are invisible from the client.
 * A reply truncated at `MARK_MAX_TOKENS` arrives as a perfectly well-formed
 * stream with `[DONE]` on the end, and an abandoned one is written to a socket
 * nobody is reading — so in both cases every frame the client can see says the
 * mark succeeded. Only the generator knows otherwise, so only the generator can
 * be asked.
 *
 * docs/plans/260831al-review-quiz-sub-mode.md § The stream has to be able to say
 * it failed; docs/plans/260831al-review-quiz-sub-mode-stage4-review-sol.md
 * findings 3 and 6.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuiz, type UseQuiz } from "../src/web/useQuiz.js";
import { markAnswerStream, type QuizMarkEvent } from "../src/quiz-mark.js";
import type { Block, Meta, Quiz } from "../src/types.js";

const SLUG = "an-article";
const BATCH = "spya-batch1";
const Q1 = "spya-quest1";

let container: HTMLDivElement;
let root: Root;
let latest: UseQuiz | undefined;

function Harness() {
  latest = useQuiz(SLUG);
  return null;
}

const QUIZ: Quiz = {
  version: "quiz/1",
  generator: "a-model",
  slug: SLUG,
  batchId: BATCH,
  sourceHash: "hash",
  questions: [
    {
      id: Q1,
      question: "What does the piece claim?",
      referenceAnswer: "It claims a thing. Then it argues for it.",
      evidence: [{ blockId: "spya-aaaaaa", quote: "a quoted passage", start: 0 }],
      band: "easy",
      value: 5,
    },
  ],
  dropped: {
    unknownIds: 0,
    unquoted: 0,
    truncated: 0,
    overCap: 0,
    malformed: 0,
    duplicate: 0,
    unanchored: 0,
  },
  generatedAt: "2026-09-01T00:00:00.000Z",
  elapsedMs: 1,
};

const enc = new TextEncoder();

/** One SSE frame, exactly as `sse` in src/routes.ts writes it. */
function frame(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * **Two deltas, then `close()` — and nothing else.**
 *
 * This is the whole point of the file. `close()` on a `ReadableStream` is a
 * *clean* end: `reader.read()` resolves `{ done: true }`, no error is thrown,
 * and the `for await` in `useQuiz` simply finishes. From inside that loop it is
 * indistinguishable from a stream that said `done` — which is exactly why the
 * hook cannot infer completion from the loop ending.
 */
function stopsWithoutFinishing(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(frame("delta", { text: "You have " }));
      c.enqueue(frame("delta", { text: "the first half of it. " }));
      c.close();
    },
  });
}

function finishesProperly(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(frame("delta", { text: "You have " }));
      c.enqueue(frame("delta", { text: "the first half of it. " }));
      c.enqueue(frame("done", { reply: "You have the first half of it. The rest is in spya-b.", model: "a-model" }));
      c.close();
    },
  });
}

function failsMidway(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(frame("delta", { text: "You have " }));
      c.enqueue(frame("delta", { text: "the first half of it. " }));
      c.enqueue(frame("error", { error: "The model stopped talking.", text: "" }));
      c.close();
    },
  });
}

/** What the next `POST /api/quiz/:slug/mark` answers with. */
let markBody: () => ReadableStream<Uint8Array>;

/**
 * Let every microtask hop settle.
 *
 * A `fetch` chain, a `ReadableStream` reader and React's own scheduling each
 * add hops, so one `await` is not enough and the count is deliberately generous.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  markBody = stopsWithoutFinishing;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        /* Two GETs matter: the quiz itself, and `useJobs`' poll — which
           `useStepJob` starts on mount and which would otherwise be an
           unhandled rejection loud enough to hide the assertion. */
        const body = url.startsWith("/api/quiz/")
          ? { quiz: QUIZ, stale: false, outdated: false }
          : { jobs: [] };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(body)),
        } as unknown as Response);
      }
      if (init.method === "POST" && url.endsWith("/mark")) {
        return Promise.resolve({ ok: true, status: 200, body: markBody() } as unknown as Response);
      }
      throw new Error(`unexpected fetch: ${init.method} ${url}`);
    }),
  );

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness));
  });
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  latest = undefined;
});

async function answer(text: string): Promise<void> {
  await act(async () => {
    await latest?.mark(Q1, text);
  });
  await settle();
}

describe("a mark stream that stops without a done frame", () => {
  it("does not tick the question answered", async () => {
    await answer("I think it claims a thing.");

    /* **The assertion the whole file exists for.** `answered` is what the panel
       draws a tick from, and a tick is a claim that this reader answered this
       question and got a reply. Two deltas and a closed socket is neither. */
    expect(latest?.answered.has(Q1)).toBe(false);
  });

  it("leaves the reply retryable rather than finished", async () => {
    await answer("I think it claims a thing.");

    /* `"failed"`, not `"done"` and not left on `"marking"`. The panel reads
       exactly this field to decide whether the Answer button says "Answer" or
       "Try again", and a spinner that never resolves is the failure this
       replaced. */
    expect(latest?.attempt?.status).toBe("failed");
    expect(latest?.attempt?.error).toBeTruthy();
  });

  it("keeps the half that did arrive", async () => {
    await answer("I think it claims a thing.");

    /* The reader has already read these words. Throwing them away on the
       failure would make the screen go backwards, which is worse than an
       incomplete mark with a sentence under it. */
    expect(latest?.attempt?.reply).toBe("You have the first half of it. ");
  });
});

describe("and the cases that keep that from being vacuous", () => {
  it("does tick when the stream really finishes", async () => {
    /* Without this the three above would pass on a hook that never ticked
       anything — which is a broken feature that satisfies every assertion in
       this file. */
    markBody = finishesProperly;
    await answer("I think it claims a thing.");

    expect(latest?.answered.has(Q1)).toBe(true);
    expect(latest?.attempt?.status).toBe("done");
    expect(latest?.attempt?.reply).toBe("You have the first half of it. The rest is in spya-b.");
  });

  it("does not tick on an explicit error frame either", async () => {
    /* The other terminal frame. It carries a real reason where the silent close
       above has to invent one, and it must reach the same place: un-ticked,
       failed, retryable. */
    markBody = failsMidway;
    await answer("I think it claims a thing.");

    expect(latest?.answered.has(Q1)).toBe(false);
    expect(latest?.attempt?.status).toBe("failed");
    expect(latest?.attempt?.error).toBe("The model stopped talking.");
    // And the deltas before the failure are still on screen.
    expect(latest?.attempt?.reply).toBe("You have the first half of it. ");
  });
});

/* ── the server half: `markAnswerStream` itself ──────────────────────────── */

/**
 * The smallest article a mark can be made against.
 *
 * Nothing here is asserted on — the prompt's contents are `tests/quiz.test.ts`'s
 * business. It exists so the generator has something to send.
 */
const META = { slug: SLUG, title: "A piece" } as Meta;
const BLOCKS = [
  { id: "spya-aaaaaa", tag: "p", kind: "text", text: "alpha", html: "<p>alpha</p>" },
  { id: "spya-bbbbbb", tag: "p", kind: "text", text: "beta", html: "<p>beta</p>" },
] as Block[];

const MARK = {
  meta: META,
  blocks: BLOCKS,
  question: "What does the piece claim?",
  referenceAnswer: "It claims a thing. Then it argues for it.",
  evidence: [],
  answer: "I think it claims a thing.",
};

/** One OpenRouter frame — `data: {…}`, which is not the shape `sse` writes. */
const wire = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

/**
 * A provider reply whose body streams the given raw SSE text.
 *
 * `closes` is the whole reason this takes an option. A stream that ends is the
 * ordinary case; one that stays open is how a reader is given something to
 * abandon, and the abort has to arrive while the socket is still live or there
 * is nothing to cancel.
 */
function provider(raw: string, closes = true): Response {
  return {
    ok: true,
    headers: new Headers(),
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(raw));
        if (closes) c.close();
      },
    }),
  } as unknown as Response;
}

/** Point `fetch` at one provider reply, leaving the app's own GETs alone. */
function providerSays(reply: () => Response): void {
  process.env.OPENROUTER_API_KEY = "test-key";
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      /* `useJobs` is still polling behind these tests — the harness above
         mounted the hook — and handing it a half-written model stream would be
         an unhandled rejection loud enough to hide an assertion. */
      if (typeof url === "string" && url.startsWith("/api/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ jobs: [] })),
        } as unknown as Response);
      }
      return Promise.resolve(reply());
    }),
  );
}

async function drain(gen: AsyncGenerator<QuizMarkEvent>): Promise<QuizMarkEvent[]> {
  const out: QuizMarkEvent[] = [];
  for await (const event of gen) out.push(event);
  return out;
}

describe("a reply the provider did not finish writing", () => {
  it("refuses one cut off at the token ceiling rather than calling it a mark", async () => {
    /* **`[DONE]` arrives**, and that is the point of the case. A truncated
       reply is not a broken connection: OpenRouter finishes the stream
       properly and says `finish_reason: "length"` on the way out, so every
       other witness this generator has says the reply is whole. Only the
       reason says otherwise, and it used to be read as a *second witness for*
       completion. */
    providerSays(() =>
      provider(
        wire({ choices: [{ delta: { content: "You have the first half of it, and then" } }] }) +
          wire({ choices: [{ finish_reason: "length", delta: {} }] }) +
          "data: [DONE]\n\n",
      ),
    );

    await expect(drain(markAnswerStream(MARK))).rejects.toThrow(/\[ai-mark-cut-off\]/);
  });

  it("refuses one the safety filter stopped part-way", async () => {
    /* The same shape and a different sentence. `saidNothing` already tells a
       reader that a filter fired when *nothing* arrived; a filter that fires
       two sentences in is the same fact and must not become a tick. */
    providerSays(() =>
      provider(
        wire({ choices: [{ delta: { content: "You have the first half" } }] }) +
          wire({ choices: [{ finish_reason: "content_filter", delta: {} }] }) +
          "data: [DONE]\n\n",
      ),
    );

    await expect(drain(markAnswerStream(MARK))).rejects.toThrow(/\[ai-filtered\]/);
  });

  it("still accepts a reply the provider says it finished", async () => {
    /* The negative control. Without it the two above pass on a generator that
       refuses everything, which is a broken feature with a green suite. */
    providerSays(() =>
      provider(
        wire({ choices: [{ delta: { content: "You have it." } }] }) +
          wire({ choices: [{ finish_reason: "stop", delta: {} }] }) +
          "data: [DONE]\n\n",
      ),
    );

    const events = await drain(markAnswerStream(MARK));
    expect(events.at(-1)).toMatchObject({ type: "done", reply: "You have it." });
  });
});

describe("a mark the reader walked away from", () => {
  it("ends with no `done`, so half a reply is never filed as a whole one", async () => {
    /* The reader navigated away. `sseChunks` cancels its reader on abort and a
       cancelled read resolves `{ done: true }`, so the loop ends **cleanly** —
       which is exactly what made this hard to see: there is no error anywhere,
       the text that arrived is real, and the generator used to run straight on
       to `yield { type: "done" }` with it. */
    providerSays(() =>
      provider(wire({ choices: [{ delta: { content: "You have the first half of it. " } }] }), false),
    );

    const gone = new AbortController();
    const seen: QuizMarkEvent[] = [];
    for await (const event of markAnswerStream({ ...MARK, signal: gone.signal })) {
      seen.push(event);
      if (event.type === "delta") gone.abort();
    }

    expect(seen.some((e) => e.type === "done")).toBe(false);
    // And what did arrive is still what arrived — this is not a throw.
    expect(seen).toEqual([{ type: "delta", text: "You have the first half of it. " }]);
  });
});
