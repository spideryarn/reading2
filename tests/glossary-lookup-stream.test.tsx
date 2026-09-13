// @vitest-environment jsdom
/**
 * **An entry's *Check the web* shows its answer as it arrives, and only a
 * `done` frame puts it on the entry.** The hook's half of cluster E stage 2 —
 * docs/plans/260910g-stream-glossary-answers-as-they-arrive.md; the route's
 * half is tests/glossary-lookup-stream-route.test.ts.
 *
 * The claims:
 *
 * 1. Text is visible (`lookDraft`) before the stream finishes; the entry has no
 *    lookup until `done`, and then has exactly the one `done` carried.
 * 2. EOF without a terminal frame, an `error` frame and a malformed `done` each
 *    end as `lookFailed`, the draft kept, and **the list read again** — the
 *    server may have stored the answer even though this stream did not say so
 *    (a save's read-back failing, or the socket dying after the save).
 * 3. Another article, or the band going, stops reading — and nothing from the
 *    old stream lands on the new article's list.
 * 4. Two presses in one tick start one request.
 *
 * Harness from tests/glossary-asked-term-stream.test.tsx.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlossaryEntry, GlossaryLookup, GlossaryResponse } from "../src/types.js";
import type { GlossaryRead, UseGlossary } from "../src/web/useGlossary.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const enc = new TextEncoder();
const frame = (event: string, data: unknown) =>
  enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const ID = "spya-kennedy";
const ENTRY = {
  id: ID,
  name: "John F. Kennedy",
  kind: "person",
  aliases: ["JFK"],
  background: "",
  difficulty: 0.3,
  centrality: 0.5,
  blocks: ["spya-aaaaaa"],
} as unknown as GlossaryEntry;

const LOOKUP: GlossaryLookup = {
  answer: "An answer about Kennedy.",
  citations: [{ url: "https://example.org/jfk", title: "A page" }],
  searches: 1,
  model: "a-model",
  at: "2026-09-10T00:00:00.000Z",
};

const GLOSSARY = {
  glossary: {
    version: 1,
    model: "test",
    sourceHash: "abc",
    profileHash: null,
    entries: [ENTRY],
  },
  stale: false,
  outdated: false,
  profileChanged: false,
} as unknown as GlossaryResponse;

/** The open lookup body, the signal it was sent with, and what was asked. */
let body: ReadableStreamDefaultController<Uint8Array> | null = null;
let signal: AbortSignal | undefined;
let posts = 0;
let reads = 0;
let holdRead = false;
let releaseRead: (() => void) | null = null;
let readResponse: GlossaryResponse = GLOSSARY;

vi.mock("../src/web/lib/api.js", () => {
  const api = {
    apiFetch: async (input: string, init?: RequestInit) => {
      if (!input.endsWith("/lookup")) {
        reads += 1;
        if (holdRead) {
          await new Promise<void>((resolve) => {
            releaseRead = resolve;
          });
        }
        return new Response(JSON.stringify(readResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      posts += 1;
      signal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            body = c;
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
const { GlossaryPanel } = await import("../src/web/GlossaryPanel.js");

let band: UseGlossary | null = null;
let reading: GlossaryRead | null = null;

function Band({ slug, read }: { slug: string; read: GlossaryRead }): ReactElement | null {
  band = useGlossary(slug, read);
  return createElement(GlossaryPanel, {
    access: { kind: "owner", owner: band, glossary: band.glossary },
    termId: ID,
    onTerm: () => {},
    sort: "prioritised",
    onSort: () => {},
    gate: null,
    onGate: () => {},
    onJump: () => {},
    onAskChat: () => {},
  });
}

function Reading({ slug }: { slug: string }): ReactElement {
  const read = useGlossaryRead(slug);
  reading = read;
  return createElement(Band, { slug, read });
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  body = null;
  signal = undefined;
  posts = 0;
  reads = 0;
  holdRead = false;
  releaseRead = null;
  readResponse = GLOSSARY;
  band = null;
  reading = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(slug = "constitution"): Promise<void> {
  await act(async () => {
    root.render(createElement(Reading, { slug }));
  });
  await settle();
}

/** Start a lookup and leave it in flight — the promise boxed, see the ask test's `start`. */
async function start(): Promise<{ running: Promise<void> }> {
  let running: Promise<void> = Promise.resolve();
  await act(async () => {
    running = band?.look(ID) ?? Promise.resolve();
  });
  await settle();
  return { running };
}

async function finished(running: Promise<void>): Promise<void> {
  await act(async () => {
    await running;
  });
  await settle();
}

const send = (event: string, data: unknown) => body?.enqueue(frame(event, data));
function end(): void {
  try {
    body?.close();
  } catch {
    // Cancelled already.
  }
}

const entry = () => band?.glossary?.entries.find((e) => e.id === ID);

describe("a lookup that is still arriving", () => {
  it("shows the first words before the stream finishes, and puts only `done` on the entry", async () => {
    await mount();
    const { running } = await start();
    send("delta", { text: "An answer " });
    await settle();

    expect(band?.lookDraft).toEqual({ id: ID, text: "An answer " });
    expect(band?.looking).toBe(ID);
    expect(entry()?.lookup).toBeUndefined();

    send("delta", { text: "about Kennedy." });
    send("done", { entry: { ...ENTRY, lookup: LOOKUP } });
    end();
    await finished(running);

    expect(entry()?.lookup).toEqual(LOOKUP);
    expect(band?.lookDraft).toBeNull();
    expect(band?.looking).toBeNull();
    expect(band?.lookFailed).toBeNull();
    expect(posts).toBe(1);
  });

  it("says when a glossary rewrite removes the entry whose answer was stored", async () => {
    await mount();
    const { running } = await start();
    send("delta", { text: "An answer for a term being replaced. " });
    await settle();

    readResponse = {
      ...GLOSSARY,
      glossary: { ...GLOSSARY.glossary, entries: [] },
    };
    await act(async () => {
      await reading?.refresh();
    });
    expect(entry()).toBeUndefined();

    send("done", { entry: { ...ENTRY, lookup: LOOKUP } });
    end();
    await finished(running);

    const kept = band?.lookKept;
    expect(kept).toEqual({ id: ID, name: ENTRY.name });
    expect(host.textContent).toContain(
      "The answer for John F. Kennedy was saved, but that term is no longer in the glossary",
    );
  });
});

describe("a lookup that ends without `done`", () => {
  it("fails when the body simply stops, keeps the draft, and reads the list again", async () => {
    await mount();
    const readsBefore = reads;
    const { running } = await start();
    send("delta", { text: "Half an " });
    end();
    await finished(running);

    expect(entry()?.lookup).toBeUndefined();
    expect(band?.lookFailed).toMatchObject({ id: ID });
    expect(band?.lookFailed?.message).toMatch(/\[ai-cut-off\]/);
    expect(band?.lookDraft).toEqual({ id: ID, text: "Half an " });
    expect(band?.looking).toBeNull();
    /* **The server may have kept it anyway**, so the list is read again rather
       than `error` being taken to mean "nothing was stored". */
    expect(reads).toBeGreaterThan(readsBefore);
  });

  it("fails on an `error` frame, carrying the server's sentence", async () => {
    await mount();
    const { running } = await start();
    send("delta", { text: "Half an " });
    send("error", { error: "Could not keep it. [gl-cut-off]" });
    end();
    await finished(running);

    expect(entry()?.lookup).toBeUndefined();
    expect(band?.lookFailed).toMatchObject({ id: ID });
    expect(band?.lookFailed?.message).toMatch(/\[gl-cut-off\]/);
  });

  it("fails when `done` carries no usable lookup", async () => {
    await mount();
    const { running } = await start();
    send("done", { entry: { ...ENTRY, lookup: { answer: "" } } });
    end();
    await finished(running);

    expect(entry()?.lookup).toBeUndefined();
    expect(band?.lookFailed).not.toBeNull();
  });

  it("keeps admission closed until the read-back after a failure has settled", async () => {
    await mount();
    holdRead = true;
    const { running } = await start();
    send("delta", { text: "An answer the server may have saved. " });
    send("error", { error: "The connection broke after the save may have landed." });
    end();
    await settle();

    /* If the saved answer is about to arrive through this held read, admitting
       a retry starts a second paid call and the read then hides its draft behind
       the first stored answer. Reconciliation is part of the first lookup. */
    await act(async () => {
      void band?.look(ID);
      await Promise.resolve();
    });
    await settle();
    expect(posts).toBe(1);

    /* The first request did save before its terminal frame was lost. The held
       reconciliation must surface that answer, with no replacement call. */
    readResponse = {
      ...GLOSSARY,
      glossary: { ...GLOSSARY.glossary, entries: [{ ...ENTRY, lookup: LOOKUP }] },
    };
    holdRead = false;
    releaseRead?.();
    await finished(running);
    expect(entry()?.lookup).toEqual(LOOKUP);
    expect(posts).toBe(1);
  });
});

describe("a reader who moves on", () => {
  it("stops reading when the article changes, and nothing lands on the new list", async () => {
    await mount("constitution");
    const { running } = await start();
    send("delta", { text: "An answer " });
    await settle();

    await mount("another-article");
    expect(signal?.aborted).toBe(true);
    expect(band?.looking).toBeNull();
    expect(band?.lookDraft).toBeNull();

    send("done", { entry: { ...ENTRY, lookup: LOOKUP } });
    end();
    await finished(running);
    expect(entry()?.lookup).toBeUndefined();
    expect(band?.lookFailed).toBeNull();
  });

  it("stops reading when the band goes", async () => {
    await mount();
    await start();
    send("delta", { text: "An answer " });
    await settle();

    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    end();
    root = createRoot(host);
  });

  it("starts one request for two presses in one tick", async () => {
    await mount();
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = band?.look(ID) ?? Promise.resolve();
      void band?.look(ID);
    });
    await settle();
    expect(posts).toBe(1);
    send("done", { entry: { ...ENTRY, lookup: LOOKUP } });
    end();
    await finished(first);
  });
});
