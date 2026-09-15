// @vitest-environment jsdom
/**
 * **Pressing "?" and watching the answer arrive must not throw React #185.**
 *
 * Greg, 2026-09-12, build d358f773: *"In a question mark comment response.
 * Minified React error #185"* — "Maximum update depth exceeded". He was on an
 * owner's reading view with Summary open in the band and a glossary term
 * selected, pressed the gutter's "?", and the floating chat dialog streamed an
 * answer.
 *
 * Harness copied from tests/public-network-trace.test.tsx: the real `App` at
 * the real address, a stubbed `fetch`, and the three browser APIs jsdom lacks.
 * The chat POST answers with an SSE stream this file controls, so each frame —
 * begin, deltas, done — lands in its own `act` and a loop at any one of them
 * is caught at the frame that caused it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";

const session: { user: { id: string; email: string } | null } = { user: null };

vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: session.user, loading: false }),
}));

const authListeners: ((event: string, session: unknown) => void)[] = [];

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        authListeners.push(fn);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});
Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
if (!(globalThis as { CSS?: unknown }).CSS) {
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
}

const SLUG = "a-piece";
const TERM = "spya-term01";

const OWNED: Article = {
  meta: {
    slug: SLUG,
    title: "A piece",
    byline: "Somebody",
    url: "https://example.com/a",
  },
  assets: undefined,
  navLabelStatus: "ready",
  blocks: [
    { id: "spya-aaaaaa", tag: "h1", kind: "heading", level: 1, text: "A piece", words: 2, html: "<h1>A piece</h1>", gistable: false },
    { id: "spya-bbbbbb", tag: "p", kind: "text", text: "The first paragraph of the piece.", words: 6, html: "<p>The first paragraph of the piece.</p>", gistable: true },
    { id: "spya-cccccc", tag: "p", kind: "text", text: "It cites an argument made elsewhere.", words: 6, html: "<p>It cites an argument made elsewhere.</p>", gistable: true },
  ],
  tree: {
    version: "test",
    generator: "test",
    slug: SLUG,
    rootId: "n0",
    nodes: {
      n0: { id: "n0", depth: 0, parent: null, children: ["n1"], range: ["spya-aaaaaa", "spya-cccccc"], title: "A piece", gist: "What the piece says." },
      n1: { id: "n1", depth: 1, parent: "n0", children: [], range: ["spya-bbbbbb", "spya-cccccc"], title: "The argument it makes", gist: "Where the piece gets to." },
    },
  },
  // biome-ignore lint/suspicious/noExplicitAny: fixture, same shape as public-network-trace's
} as any;

const GLOSSARY = {
  status: "ready",
  glossary: {
    entries: [
      {
        id: TERM,
        name: "Integrated information theory",
        kind: "concept",
        aliases: [],
        senseHere: "What the author means by it here.",
        blocks: ["spya-bbbbbb"],
      },
    ],
  },
};

/** The one open chat stream, pushed from the test. */
interface ChatStream {
  frame(event: string, data: unknown): void;
  close(): void;
  threadId: string;
}
/* Cast rather than annotated: the only assignment is inside a stream's
   `start` callback, which control-flow analysis cannot see, so an annotated
   `= null` narrows every later read to `null`. */
let stream = null as ChatStream | null;
const posts: { url: string; body: Record<string, unknown> }[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * When set, the chat POST answers with this many deltas **already buffered**:
 * begin, every delta and done are enqueued in `start()`, before the response
 * is handed back, which is what a proxy that batches frames delivers. Each
 * `reader.read()` then resolves as a microtask, so the whole answer is drained
 * in one microtask chain with no macrotask between frames.
 */
let burst: number | null = null;
const BURST_WORD = "word ";

function chatStream(threadId: string): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      if (burst !== null) {
        const frame = (event: string, data: unknown) =>
          c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        frame("begin", {
          threadId,
          title: "About the paragraph",
          messageId: "spya-burstr",
          questionId: "spya-burstq",
          attempt: "att-burst",
        });
        for (let i = 0; i < burst; i++) frame("delta", { text: BURST_WORD });
        frame("done", {
          text: BURST_WORD.repeat(burst),
          citations: [],
          searches: 0,
          model: "anthropic/claude-sonnet-5",
        });
        c.close();
        return;
      }
      stream = {
        threadId,
        frame: (event, data) => c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
        close: () => c.close(),
      };
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function reply(url: string, method: string, init?: RequestInit): Response {
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  if (url === "/api/reader") return json({ experimentalSince: null });
  if (method === "POST" && url.startsWith("/api/chat/")) {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    posts.push({ url, body });
    const id = typeof body.threadId === "string" ? body.threadId : "spya-srvthr";
    return chatStream(id);
  }
  if (method === "POST") return new Response(null, { status: 204 });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/")) return json({ threads: [] });
  if (url.startsWith("/api/glossary/")) return json(GLOSSARY);
  if (url === "/api/jobs") return json({ jobs: [] });
  return json({});
}

const { App } = await import("../src/web/App.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");

let host: HTMLDivElement;
let root: Root;
let errors: string[] = [];
let thrown: unknown[] = [];

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.user = { id: "owner-1", email: "greg@example.com" };
  stream = null;
  burst = null;
  posts.length = 0;
  errors = [];
  thrown = [];
  resetExperimental();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(reply(String(input), init?.method ?? "GET", init)),
  );
  const real = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
    void real;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host, {
    onUncaughtError: (e) => thrown.push(e),
    onCaughtError: (e) => thrown.push(e),
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function open(search: string): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}${search}`);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(App, null)));
  });
  await act(async () => {
    for (const fn of [...authListeners]) fn("SIGNED_IN", { user: session.user });
  });
  await settle();
}

/** Everything React said about an update loop, from either channel. */
const loops = () =>
  [...errors, ...thrown.map((e) => String((e as Error)?.message ?? e))].filter((m) =>
    /Maximum update depth|#185|getSnapshot should be cached/i.test(m),
  );

const WORDS = ["Because ", "the ", "example ", "[spya-bbbbbb] ", "is ", "doing ", "the ", "arguing [spya-cccccc]."];

async function press(block: string): Promise<void> {
  const row = host.querySelector(`tr[data-block="${block}"]`) ?? host;
  const help =
    [...row.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Ask the AI for help") ??
    null;
  expect(help, `there must be a '?' to press on ${block}`).toBeTruthy();
  await act(async () => help?.click());
  await settle();
}

type Stream = ChatStream;

async function begin(s: Stream, replyId: string): Promise<void> {
  await act(async () => {
    s.frame("begin", {
      threadId: s.threadId,
      title: "About the paragraph",
      messageId: replyId,
      questionId: `${replyId}q`,
      attempt: `att-${replyId}`,
    });
  });
  await settle(2);
}

async function deltas(s: Stream, words: readonly string[]): Promise<void> {
  for (const word of words) {
    await act(async () => s.frame("delta", { text: word }));
    await settle(1);
  }
}

async function finish(s: Stream): Promise<void> {
  await act(async () => {
    s.frame("done", { text: WORDS.join(""), citations: [], searches: 0, model: "anthropic/claude-sonnet-5" });
    s.close();
  });
  await settle();
}

async function pressAndStream(search: string): Promise<void> {
  await open(search);
  await press("spya-bbbbbb");
  expect(posts, "the press must have sent").toHaveLength(1);
  const s = stream;
  expect(s, "the chat POST must have opened a stream").toBeTruthy();
  if (!s) return;
  /* Two block citations, because `Cited` draws a chip for each and gives it a
     Tooltip only once the answer has landed (ChatPanel.tsx § `live`), so the
     `done` frame is the commit where a floating layer first mounts. */
  await begin(s, "spya-msgrep");
  await deltas(s, WORDS);
  await finish(s);
}

const GREG =
  `?remember=quiz&gate=0.00&term=${TERM}&diagram=illustrated&rank=prioritised&bar=0.30&citeby=document&mode=summary&at=spya-bbbbbb`;

/* **The control.** Every case below asserts `loops()` is empty, and an empty
   list from a detector that cannot hear React is the silent-success shape.
   So the detector is pointed at a component that really loops, through the
   same root and the same console spy, and must come back non-empty. */
describe("the detector", () => {
  it("hears a real update loop", async () => {
    const { useLayoutEffect, useState } = await import("react");
    function Loops() {
      const [n, setN] = useState(0);
      useLayoutEffect(() => setN(n + 1));
      return createElement("span", null, n);
    }
    /* A layout-effect loop is thrown out of `act` rather than logged, so any
       case below that loops goes red by throwing before its `loops()` line —
       seen on 2026-09-15. Caught here so the control can assert on it. */
    let threw: unknown = null;
    try {
      await act(async () => {
        root.render(createElement(Loops));
      });
    } catch (e) {
      threw = e;
    }
    const heard = [...loops(), String((threw as Error | null)?.message ?? "")].filter((m) =>
      /Maximum update depth/.test(m),
    );
    expect(heard.length, "the detector must hear React's #185").toBeGreaterThan(0);
  });
});

describe("a '?' answer streaming into the floating dialog", () => {
  it("does not loop on a plain reading view", async () => {
    await pressAndStream("");
    expect(host.textContent).toContain("doing the arguing");
    expect(loops()).toEqual([]);
  });

  it("does not loop with Greg's address: Summary open, a term selected, remember=quiz", async () => {
    await pressAndStream(GREG);
    expect(host.textContent).toContain("doing the arguing");
    expect(loops()).toEqual([]);
  });

  it("does not loop when a landed citation is hovered and focused", async () => {
    await pressAndStream(GREG);
    const chips = [...host.querySelectorAll<HTMLElement>(".chat-dialog .cite-hit")];
    expect(chips.length, "the landed answer must draw its citation chips").toBeGreaterThan(0);
    for (const chip of chips) {
      await act(async () => {
        chip.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        chip.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, pointerType: "mouse" }));
        chip.focus();
        chip.querySelector<HTMLElement>("a")?.focus();
      });
      await settle(3);
    }
    expect(loops()).toEqual([]);
  });

  it("does not loop when '?' is pressed again on the same paragraph after it answered", async () => {
    await pressAndStream(GREG);
    /* The reopen path: `helpThreadFor` finds the conversation this block
       already has, and the target flips from a draft to `{ kind: "thread" }`. */
    const help = [...host.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Ask the AI for help",
    );
    if (help) {
      await act(async () => help.click());
      await settle();
    }
    expect(loops()).toEqual([]);
  });

  it("does not loop when a second '?' is pressed on another paragraph mid-answer", async () => {
    await open(GREG);
    await press("spya-bbbbbb");
    const first = stream;
    expect(first).toBeTruthy();
    if (!first) return;
    await begin(first, "spya-msgre1");
    await deltas(first, WORDS.slice(0, 3));
    await press("spya-cccccc");
    const second = stream;
    expect(second, "the second press must have sent").not.toBe(first);
    if (!second || second === first) return;
    await begin(second, "spya-msgre2");
    await deltas(first, WORDS.slice(3));
    await deltas(second, WORDS);
    await finish(first);
    await finish(second);
    expect(loops()).toEqual([]);
  });

  /* **The mechanism, and the case that goes red for it.** The chat store
     notifies `useSyncExternalStore`, which renders synchronously once per
     dispatch, and `drainTurn` dispatches once per frame. With the frames
     already buffered every read resolves as a microtask, so N frames are N
     synchronous commits in one chain — and `Conversation`'s scroll effect
     (ChatPanel.tsx § `setAway(false)` on every `chars` change) leaves an
     update pending after each, so React's nested-update count climbs until
     the ~51st dispatch throws #185 out of `sink.delta`. The turn's catch turns
     that into a failed answer whose text is React's error.

     Not in `act`, and that is the point: `act` drains each frame's work
     before the next, which is exactly why the five cases above stay green. */
  it("does not loop when the whole answer arrives already buffered", async () => {
    const N = 150;
    burst = N;
    await open(GREG);
    const row = host.querySelector('tr[data-block="spya-bbbbbb"]') ?? host;
    const help = [...row.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Ask the AI for help",
    );
    expect(help, "there must be a '?' to press").toBeTruthy();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    try {
      help?.click();
      for (let i = 0; i < 40; i++) await new Promise((go) => setTimeout(go, 5));
    } finally {
      (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    }
    expect(posts, "the press must have sent").toHaveLength(1);
    const page = document.body.textContent ?? "";
    expect(page, "React's error text must not be on the page").not.toMatch(/Maximum update depth|#185/);
    expect(host.querySelector(".chat-turn.model.failed"), "no answer may be in an error state").toBeNull();
    const answer = host.querySelector(".chat-dialog .chat-turn.model")?.textContent ?? "";
    expect(answer.replace(/\s+/g, " ").trim()).toContain(BURST_WORD.repeat(N).trim());
    expect(loops()).toEqual([]);
  });
});

