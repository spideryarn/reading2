// @vitest-environment jsdom
/**
 * **Six catches that used to print a raw exception now say a reader's
 * sentence**, and the stream reader they share throws errors of the right class.
 *
 * `useGlossary` (*Dig deeper* and the ask box), `useCitations` (*Investigate*),
 * `useQuiz` (the mark), `useProjection` and `useSimilar` each put
 * `(err as Error).message` on screen for anything but a stall, so Safari's
 * "Load failed" and a JavaScript bug's own words reached a reader. They go
 * through `describeFetchFailure` now, which meant the throw seam had to be
 * fixed first: `readAnswerStream` threw its early-end sentence as a plain
 * `Error`, which the helper would have called a fault of the page.
 * docs/plans/261007a-ui-sweep-umbrella.md § K4, and its review's U11.
 *
 * ## Only `fetch` is posed
 *
 * The real `apiFetch`, `readJson`, `readEvents` and `readAnswerStream`: a lost
 * connection is recognised by the mark those helpers put on a `TypeError` they
 * saw come out of the transport, so a test that mocked `apiFetch` to throw one
 * would be testing the unexpected-exception row instead
 * (tests/read-error-matrix.test.tsx says the same of the read hooks).
 *
 * ## The rows
 *
 *  - **unreachable**: `fetch` rejects with a `TypeError`. `[net-down]`.
 *  - **cut mid-stream**: the body errors with a `TypeError`. `[net-down]`.
 *  - **stalled**: bytes, then nothing for sixty seconds. `[ai-stalled]`.
 *  - **refused**: a 4xx with the server's `{ error }`. That sentence, whole.
 *  - **ended early**: the body closes with no terminal frame. The caller's
 *    sentence for it (`[ai-cut-off]`, or the quiz's own).
 *  - **malformed completion**: a `done` the caller's check refuses.
 *    `[web-unexpected]`, as every other reply of the wrong shape.
 *  - **unexpected**: an exception nobody wrote for a reader. `[web-unexpected]`,
 *    and none of its words.
 *
 * Projection and Similar read JSON, not a stream, so only the first, fourth and
 * last rows exist for them. The quiz's `done` accepts any frame (it falls back
 * to the words that arrived), so it has no malformed row.
 */
import { act, createElement, type ReactElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENDED_UNFINISHED, PAGE_FAULT } from "../src/messages.js";
import type { BlockId, Citations, CitedWork, GlossaryEntry, GlossaryResponse, Quiz } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "T" } } }),
      refreshSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: async () => undefined,
  writeCached: async () => undefined,
  reserveTicket: async () => null,
  invalidate: async () => undefined,
  cachedSlugs: async () => new Set<string>(),
  rememberUser: () => {},
  lastKnownUser: () => null,
  forgetUser: () => {},
}));

/* `describeFetchFailure` reports the unexpected rows; keep that off the wire. */
vi.mock("../src/web/monitoring.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/monitoring.js")>(
    "../src/web/monitoring.js",
  );
  return { ...real, captureClientFailure: () => {} };
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
const { useCitations, useCitationsRead } = await import("../src/web/useCitations.js");
const { useQuiz, useQuizRead } = await import("../src/web/useQuiz.js");
const { useProjection } = await import("../src/web/useProjection.js");
const { useSimilar } = await import("../src/web/useSimilar.js");
const { readAnswerStream } = await import("../src/web/lib/sse.js");
const { MalformedReply, ReaderFacingError } = await import("../src/web/lib/reader-facing.js");

/* ------------------------------------------------------------ the fixtures -- */

const SLUG = "a-piece";
const BLOCK = "spya-k3m9qt" as BlockId;
const TERM = "spya-kennedy";
const WORK_ID = "spya-c2d3e4";
const QUESTION = "spya-quest1";

const GLOSSARY = {
  glossary: {
    version: 1,
    model: "test",
    sourceHash: "abc",
    profileHash: null,
    entries: [
      {
        id: TERM,
        name: "John F. Kennedy",
        kind: "person",
        aliases: ["JFK"],
        background: "",
        difficulty: 0.3,
        centrality: 0.5,
        blocks: [BLOCK],
      } as unknown as GlossaryEntry,
    ],
  },
  stale: false,
  outdated: false,
  profileChanged: false,
} as unknown as GlossaryResponse;

const WORK: CitedWork = {
  id: WORK_ID,
  key: "work:w",
  title: "A work",
  why: "What the piece uses it for.",
  mentions: [],
  citedAt: [BLOCK],
  firstCited: BLOCK,
  citedInBody: true,
  url: "https://doi.org/10.1000/xyz",
  linkFrom: "doi",
};

const CITATIONS: Citations = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  citations: [WORK],
  capped: false,
  generatedAt: "2026-09-30T09:00:00.000Z",
  elapsedMs: 1,
};

const QUIZ: Quiz = {
  version: "quiz/1",
  generator: "a-model",
  slug: SLUG,
  batchId: "spya-batch1",
  sourceHash: "hash",
  questions: [
    {
      id: QUESTION,
      question: "What does the piece claim?",
      referenceAnswer: "It claims a thing. Then it argues for it.",
      evidence: [{ blockId: BLOCK, quote: "a quoted passage", start: 0 }],
    },
  ],
  dropped: { unknownIds: 0, unquoted: 0, truncated: 0, overCap: 0, malformed: 0, duplicate: 0, unanchored: 0 },
  generatedAt: "2026-09-01T00:00:00.000Z",
  elapsedMs: 1,
};

/* --------------------------------------------------------------- the wire -- */

const enc = new TextEncoder();
const frame = (event: string, data: unknown) =>
  enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A stream that has said one thing, held open for the test to finish. */
function opened(): { response: Response; body: ReadableStreamDefaultController<Uint8Array> } {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      body = c;
      c.enqueue(frame("delta", { text: "The first half. " }));
    },
  });
  return {
    response: new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    body,
  };
}

/** How the failure under test arrives. `null` while every POST is a surprise. */
let post: ((url: string) => Promise<Response>) | null = null;

/* A sentence the server wrote, with no registered code on purpose: a 4xx is a
   refusal a route chose to send, and many are deliberately uncoded. */
const REFUSAL = "The list was written for an older version of this piece, so nothing was asked.";
/* What a bug says. None of it may reach a reader. */
const BUG = "Cannot read properties of undefined (reading 'kennedy')";

const ROWS = {
  unreachable: {
    arrive: async () => {
      post = () => Promise.reject(new TypeError("Load failed"));
    },
    says: /\[net-down\]$/,
  },
  refused: {
    arrive: async () => {
      post = async () => json({ error: REFUSAL }, 409);
    },
    says: new RegExp(`^${REFUSAL}$`),
  },
  unexpected: {
    arrive: async () => {
      post = () => Promise.reject(new Error(BUG));
    },
    says: /\[web-unexpected\]$/,
  },
} as const;

type Finish = (body: ReadableStreamDefaultController<Uint8Array>) => Promise<void> | void;

/** The four ways an open stream can go wrong. */
const STREAM_ROWS: Record<string, { finish: Finish; says: RegExp }> = {
  "cut mid-stream": {
    finish: (body) => body.error(new TypeError("network error")),
    says: /\[net-down\]$/,
  },
  stalled: {
    finish: async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    },
    says: /\[ai-stalled\]$/,
  },
  "ended early": {
    finish: (body) => body.close(),
    says: /\[ai-cut-off\]$/,
  },
  "malformed completion": {
    finish: (body) => {
      body.enqueue(frame("done", { nothing: "this page asked for" }));
      body.close();
    },
    says: /\[web-unexpected\]$/,
  },
};

/* ------------------------------------------------------------ the harness -- */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  post = null;
  /* A built page: the development build keeps the browser's own words in
     brackets (`couldNotReach`), and the claim here is about what a reader sees. */
  vi.stubEnv("PROD", true);
  vi.stubGlobal("navigator", { onLine: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      if (!post) throw new Error(`the test made an unexpected POST: ${url}`);
      return post(url);
    }
    if (url === `/api/glossary/${SLUG}`) return json(GLOSSARY);
    if (url === `/api/citations/${SLUG}`) return json({ citations: CITATIONS, stale: false, outdated: false });
    if (url === `/api/quiz/${SLUG}`) return json({ quiz: QUIZ, stale: false, outdated: false });
    return json({ jobs: [] });
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Real time, for the JSON reads: a `Response` body takes a macrotask or two. */
async function breathe(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Mount a hook and keep the value of the last committed render. */
async function drive<T>(use: () => T): Promise<() => T> {
  let latest!: T;
  function Probe(): ReactElement | null {
    const value = use();
    useEffect(() => {
      latest = value;
    });
    return null;
  }
  await act(async () => {
    root.render(createElement(Probe));
  });
  await breathe();
  return () => latest;
}

/**
 * One site that reads a kept answer off a stream: how to mount it, how to
 * press it, and where its failure sentence lands.
 */
interface StreamSite<T> {
  use(): T;
  ready(hook: T): boolean;
  press(hook: T): Promise<unknown>;
  failure(hook: T): string | null | undefined;
  /** This site's sentence for a body that ends with no terminal frame. */
  ended: RegExp;
  /** False for the quiz, whose `done` refuses nothing. */
  refusesADone: boolean;
}

function site<T>(s: StreamSite<T>): StreamSite<T> {
  return s;
}

const glossaryHooks = () => {
  const read = useGlossaryRead(SLUG);
  return { read, band: useGlossary(SLUG, read) };
};

const SITES = {
  "Glossary's Dig deeper": site({
    use: glossaryHooks,
    ready: (h) => h.read.status === "ready",
    press: (h) => h.read.look(TERM),
    failure: (h) => h.read.lookFailed?.message,
    ended: /\[ai-cut-off\]$/,
    refusesADone: true,
  }),
  "Glossary's ask box": site({
    use: glossaryHooks,
    ready: (h) => h.read.status === "ready",
    press: (h) => h.band.ask("Kennedy"),
    failure: (h) => h.band.askFailed,
    ended: /\[ai-cut-off\]$/,
    refusesADone: true,
  }),
  "Citations' Investigate": site({
    use: () => useCitations(SLUG, useCitationsRead(SLUG)),
    ready: (h) => h.status === "ready",
    press: (h) => h.investigate(WORK_ID),
    failure: (h) => h.investigateFailed?.message,
    ended: /\[ai-cut-off\]$/,
    refusesADone: true,
  }),
  "the quiz's mark": site({
    use: () => useQuiz(SLUG, useQuizRead(SLUG)),
    ready: (h) => h.status === "ready",
    press: (h) => h.mark(QUESTION, "I think it claims a thing."),
    failure: (h) => h.attempt?.error,
    /* Its own words, pinned to the letter in tests/quiz-mark-stream.test.tsx. */
    ended: /^The reply stopped arriving before it was finished\. Nothing was lost — try again\.$/,
    refusesADone: false,
  }),
} as const;

/* -------------------------------------------------------------- the seam -- */

describe("readAnswerStream: the class of each thing it throws", () => {
  const bodyOf = (...frames: Uint8Array[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const f of frames) c.enqueue(f);
        c.close();
      },
    });
  const accept = { delta: () => {}, done: (data: unknown) => (data as { ok?: true } | null)?.ok };

  it("a body that ends early is a sentence for a reader", async () => {
    const thrown = await readAnswerStream(bodyOf(frame("delta", { text: "half" })), accept).catch((e) => e);
    expect(thrown).toBeInstanceOf(ReaderFacingError);
    expect((thrown as Error).message).toBe(ENDED_UNFINISHED.message);
  });

  it("a body that ends early says the caller's own sentence when it has one", async () => {
    const thrown = await readAnswerStream(bodyOf(), accept, { stopped: "Stopped.", ended: "Ended." }).catch((e) => e);
    expect(thrown).toBeInstanceOf(ReaderFacingError);
    expect((thrown as Error).message).toBe("Ended.");
  });

  it("a completion the caller refuses is a reply of the wrong shape, not a reader's sentence", async () => {
    const thrown = await readAnswerStream(bodyOf(frame("done", {})), accept).catch((e) => e);
    expect(thrown).toBeInstanceOf(MalformedReply);
    expect(thrown).not.toBeInstanceOf(ReaderFacingError);
  });
});

/* ------------------------------------------------------- the four streams -- */

describe.each(Object.entries(SITES))("%s", (_name, raw) => {
  const at = raw as StreamSite<unknown>;

  async function mounted(): Promise<() => unknown> {
    const latest = await drive(at.use);
    expect(at.ready(latest()), "the list never arrived, so nothing can be pressed").toBe(true);
    return latest;
  }

  it.each(Object.entries(ROWS))("%s, before any stream opens", async (name, row) => {
    const latest = await mounted();
    await row.arrive();
    await act(async () => {
      await at.press(latest());
    });
    await breathe();
    const said = at.failure(latest());
    expect(said, `nothing was said about a request that was ${name}`).toBeTruthy();
    expect(said).toMatch(row.says);
    expect(said).not.toContain("Load failed");
    expect(said).not.toContain("Cannot read");
  });

  it.each(Object.entries(STREAM_ROWS))("%s", async (name, row) => {
    if (name === "malformed completion" && !at.refusesADone) return;
    const latest = await mounted();
    const stream = opened();
    post = async () => stream.response;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let pressed!: Promise<unknown>;
    await act(async () => {
      pressed = at.press(latest());
    });
    await settle();
    await act(async () => {
      await row.finish(stream.body);
      await pressed;
    });
    vi.useRealTimers();
    await breathe();
    const said = at.failure(latest());
    expect(said, `nothing was said about a stream that ${name}`).toBeTruthy();
    expect(said).toMatch(name === "ended early" ? at.ended : row.says);
    expect(said).not.toContain("network error");
    expect(said).not.toContain("sent nothing for");
  });
});

/* ------------------------------------------------- the two diagram reads -- */

describe.each([
  ["the projection", () => useProjection(SLUG, true)],
  ["the dotted lines", () => useSimilar(SLUG, true)],
] as const)("%s", (_name, use) => {
  it.each(Object.entries(ROWS))("%s", async (name, row) => {
    await row.arrive();
    const latest = await drive<{ status: string; error: string | null }>(use);
    expect(latest().status, `a request that was ${name} did not end as a failure`).toBe("error");
    expect(latest().error).toMatch(row.says);
    expect(latest().error).not.toContain("Load failed");
    expect(latest().error).not.toContain("Cannot read");
  });

  it("says the page's own sentence, whole, for an exception nobody wrote", async () => {
    await ROWS.unexpected.arrive();
    const latest = await drive<{ error: string | null }>(use);
    expect(latest().error).toBe(PAGE_FAULT.message);
  });
});
