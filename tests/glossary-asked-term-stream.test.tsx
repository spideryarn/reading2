// @vitest-environment jsdom
/**
 * **The glossary's *Look up a term* box shows the answer as it arrives, and
 * only a `done` frame makes it an answer.** The hook's half of cluster E stage 1
 * — docs/plans/260910g-stream-glossary-answers-as-they-arrive.md. The route's
 * half is tests/glossary-asked-term-stream-route.test.ts.
 *
 * Each case drives a body the test holds open, frame by frame, so the moment
 * *during* the stream is observable. The claims:
 *
 * 1. Text is visible (`askDraft`) before the stream finishes, and `asked` stays
 *    null until `done`.
 * 2. An `error` frame, EOF without a terminal frame, and a malformed `done`
 *    each end as a failure with the draft kept and marked, never as `asked`.
 * 3. A keystroke, a slug change and unmount each **abort the request** — the
 *    thing that cancels the body, which is how the server learns to stop the
 *    paid call — and nothing lands afterwards.
 * 4. The quote drawn is the `begin` frame's (the article's), not the typed term.
 *
 * The panel needs nuqs and the layout to mount, so this drives the hook, as
 * tests/glossary-asked-term-race.test.tsx does.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskedTermAnswer, GlossaryResponse } from "../src/types.js";
import type { GlossaryRead, UseGlossary } from "../src/web/useGlossary.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const enc = new TextEncoder();
const frame = (event: string, data: unknown) =>
  enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const FOUND = { term: "attention head", blockId: "spya-bbbbbb", quote: "Attention Heads" };
const ANSWER: AskedTermAnswer = {
  ...FOUND,
  blockId: FOUND.blockId as AskedTermAnswer["blockId"],
  lookup: {
    answer: "An answer about attention heads.",
    citations: [],
    searches: 1,
    model: "a-model",
    at: "2026-09-10T00:00:00.000Z",
  },
};

const EMPTY_GLOSSARY = {
  glossary: { version: 1, model: "test", sourceHash: "abc", profileHash: null, entries: [] },
  stale: false,
  outdated: false,
  profileChanged: false,
} as unknown as GlossaryResponse;

/** The open `ask` body, and the signal its request was sent with. */
let body: ReadableStreamDefaultController<Uint8Array> | null = null;
const bodies: ReadableStreamDefaultController<Uint8Array>[] = [];
let signal: AbortSignal | undefined;
let asks = 0;

vi.mock("../src/web/lib/api.js", () => {
  const api = {
    apiFetch: async (input: string, init?: RequestInit) => {
      if (!input.endsWith("/ask")) {
        return new Response(JSON.stringify(EMPTY_GLOSSARY), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      asks += 1;
      signal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            body = c;
            bodies.push(c);
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    },
    readJson: async (res: Response) => res.json(),
    failure: async (res: Response) => new Error(String(res.status)),
    fetchOk: async (input: string) => api.apiFetch(input),
  };
  return api;
});

vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs: [],
    loaded: true,
    error: null,
    driverFailures: {},
    lastFailure: () => null,
    run: async () => null,
    cancel: async () => {},
  }),
}));

const { useGlossary, useGlossaryRead } = await import("../src/web/useGlossary.js");

let band: UseGlossary | null = null;

function Band({ slug, read }: { slug: string; read: GlossaryRead }): ReactElement | null {
  band = useGlossary(slug, read);
  return null;
}

function Reading({ slug }: { slug: string }): ReactElement {
  const read = useGlossaryRead(slug);
  return createElement(Band, { slug, read });
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  body = null;
  bodies.length = 0;
  signal = undefined;
  asks = 0;
  band = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(slug = "constitution"): Promise<void> {
  await act(async () => {
    root.render(createElement(Reading, { slug }));
  });
  await settle();
}

/**
 * Let the stream reader and React catch up with what was just enqueued —
 * tests/quiz-mark-stream.test.tsx's `settle`: a `ReadableStream` reader and
 * React's scheduling each add microtask hops, so the count is generous.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * Start an ask and leave it in flight.
 *
 * **The promise comes back in a box, and that is not decoration.** An `async`
 * function that returns a promise *adopts* it, so `await start()` would wait for
 * the whole stream to finish — which, with the body held open, is never. The
 * first draft of this file did exactly that and timed out every case.
 */
async function start(term = "attention head"): Promise<{ running: Promise<void> }> {
  let running: Promise<void> = Promise.resolve();
  await act(async () => {
    running = band?.ask(term) ?? Promise.resolve();
  });
  await settle();
  return { running };
}

/** Let the in-flight ask end, and React catch up. */
async function finished(running: Promise<void>): Promise<void> {
  await act(async () => {
    await running;
  });
  await settle();
}

function send(event: string, data: unknown): void {
  body?.enqueue(frame(event, data));
}

function end(): void {
  try {
    body?.close();
  } catch {
    // Cancelled already.
  }
}

describe("an answer that is still arriving", () => {
  it("admits only one request when two submissions land in the same tick", async () => {
    await mount();
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      /* React has not committed `setAsking(true)` between these calls. A state
         guard therefore sees `false` twice; the live-controller ref is the
         same-tick admission record, as it is in `useQuiz.mark`. */
      first = band?.ask("attention head") ?? Promise.resolve();
      second = band?.ask("attention head") ?? Promise.resolve();
    });
    await settle();

    /* Complete every body that was actually opened before asserting, so the
       red version of this test leaves no held reader behind. */
    for (const opened of bodies) {
      opened.enqueue(frame("begin", FOUND));
      opened.enqueue(frame("delta", { text: ANSWER.lookup.answer }));
      opened.enqueue(frame("done", ANSWER));
      opened.close();
    }
    await act(async () => Promise.all([first, second]));
    await settle();

    expect(asks).toBe(1);
    expect(band?.asked).toEqual(ANSWER);
    expect(band?.asking).toBe(false);
  });

  it("shows the first words before the stream finishes, and is not an answer yet", async () => {
    await mount();
    const { running } = await start();
    send("begin", FOUND);
    send("delta", { text: "An answer " });
    await settle();

    expect(band?.askDraft).toEqual({ ...FOUND, text: "An answer " });
    expect(band?.asked).toBeNull();
    expect(band?.asking).toBe(true);

    send("delta", { text: "about attention heads." });
    send("done", ANSWER);
    end();
    await finished(running);

    expect(band?.asked).toEqual(ANSWER);
    expect(band?.askDraft).toBeNull();
    expect(band?.asking).toBe(false);
    expect(band?.askFailed).toBeNull();
    expect(asks).toBe(1);
  });

  it("draws the article's words as the quote, not the typed term", async () => {
    await mount();
    await start("ATTENTION HEAD");
    send("begin", FOUND);
    await settle();
    expect(band?.askDraft?.quote).toBe("Attention Heads");
  });
});

describe("a stream that ends without `done`", () => {
  it("is a failure when the body simply stops, with the draft kept and never promoted", async () => {
    await mount();
    const { running } = await start();
    send("begin", FOUND);
    send("delta", { text: "Half an " });
    end();
    await finished(running);

    expect(band?.asked).toBeNull();
    expect(band?.askFailed).toMatch(/\[ai-cut-off\]/);
    expect(band?.askDraft?.text).toBe("Half an ");
    expect(band?.asking).toBe(false);
  });

  it("is a failure on an `error` frame, carrying the server's sentence", async () => {
    await mount();
    const { running } = await start();
    send("begin", FOUND);
    send("delta", { text: "Half an " });
    send("error", { error: "The AI service began answering and then hit a problem. [ai-interrupted]" });
    end();
    await finished(running);

    expect(band?.asked).toBeNull();
    expect(band?.askFailed).toMatch(/\[ai-interrupted\]/);
  });

  it("is a failure when `done` is not the shape of an answer", async () => {
    await mount();
    const { running } = await start();
    send("begin", FOUND);
    send("done", { ...ANSWER, lookup: { answer: "" } });
    end();
    await finished(running);

    expect(band?.asked).toBeNull();
    expect(band?.askFailed).not.toBeNull();
  });

  it("does not promote malformed citation members to an answer", async () => {
    await mount();
    const { running } = await start();
    send("begin", FOUND);
    /* An array alone is not `Citation[]`. If this reaches `asked`,
       `GlossaryPanel` reads `c.url` while rendering and takes the panel down. */
    send("done", {
      ...ANSWER,
      lookup: { ...ANSWER.lookup, citations: [null] },
    });
    end();
    await finished(running);

    expect(band?.asked).toBeNull();
    expect(band?.askFailed).not.toBeNull();
  });
});

describe("a reader who moves on", () => {
  it("can clear and submit a replacement before React rerenders", async () => {
    await mount();
    const { running: first } = await start();
    const firstBody = body;
    const firstSignal = signal;

    let replacement!: Promise<void>;
    await act(async () => {
      /* A keystroke clears the old ask and a submit can follow in the same
         tick. The rendered `asking` value is still true here; the controller
         ref has already been cleared and is the fact the admission guard must
         read. */
      band?.clearAsked();
      replacement = band?.ask("attention head") ?? Promise.resolve();
    });
    await settle();

    expect(firstSignal?.aborted).toBe(true);
    expect(asks).toBe(2);
    expect(band?.asking).toBe(true);

    /* Let the abandoned request discover EOF. Its `finally` must not switch
       off the replacement request's spinner. */
    firstBody?.close();
    await finished(first);
    expect(band?.asking).toBe(true);

    send("begin", FOUND);
    send("delta", { text: ANSWER.lookup.answer });
    send("done", ANSWER);
    end();
    await finished(replacement);

    expect(band?.asked).toEqual(ANSWER);
    expect(band?.asking).toBe(false);
    expect(band?.askFailed).toBeNull();
  });

  it("aborts the request on a keystroke, and nothing lands afterwards", async () => {
    await mount();
    const { running } = await start();
    send("begin", FOUND);
    send("delta", { text: "An answer " });
    await settle();

    await act(async () => band?.clearAsked());
    await settle();
    expect(signal?.aborted).toBe(true);
    /* The box is usable at once: the request is disowned, not merely ignored. */
    expect(band?.asking).toBe(false);

    send("delta", { text: "that is not wanted." });
    send("done", ANSWER);
    end();
    await finished(running);

    expect(band?.asked).toBeNull();
    expect(band?.askDraft).toBeNull();
    expect(band?.askFailed).toBeNull();
  });

  it("aborts the request when the article changes, and clears the answer", async () => {
    await mount("constitution");
    const { running } = await start();
    send("begin", FOUND);
    send("delta", { text: "An answer " });
    await settle();

    await mount("another-article");
    expect(signal?.aborted).toBe(true);
    expect(band?.askDraft).toBeNull();
    expect(band?.asking).toBe(false);

    send("done", ANSWER);
    end();
    await finished(running);
    expect(band?.asked).toBeNull();
  });

  it("aborts the request when the band goes", async () => {
    await mount();
    await start();
    send("begin", FOUND);
    await settle();

    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    end();
    /* So `afterEach`'s unmount has something to unmount. */
    root = createRoot(host);
  });
});
