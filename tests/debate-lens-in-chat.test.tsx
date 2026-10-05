// @vitest-environment jsdom
/**
 * **Looking at the debate from an angle starts a chat that remembers the
 * angle, and Debate lists it as the way back — with no reload.**
 * Plan docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md, A.
 *
 * The whole app, for the reason tests/debate-check-claim-in-chat.test.tsx
 * gives: the angle crosses the panel, Debate's band, `Reader`, the
 * conversation band and the draft store on the way out, and comes back
 * through the thread summaries `Reader` holds. This is that file's harness.
 *
 * What is claimed, in order:
 *
 * 1. Enter in the box lands in Chat, in a **fresh** conversation, with the
 *    fenced angle and the fixed question in the box, and **nothing sent**;
 * 2. Send posts once, and the body's origin is **exactly** `{ mode, lens }`:
 *    no block, no quote, no anchor;
 * 3. Back returns to Debate, and *Your angles* has the line, never reloaded;
 * 4. the line opens that conversation **beside Debate** (`?thread=`, the mode
 *    unchanged);
 * 5. Chat's list shows the conversation with Debate's icon, named as an angle.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, ChatThread, Debate, ThreadOrigin, ThreadSummary } from "../src/types.js";
import type { PublicArticle } from "../src/public-types.js";
import { askDebateThroughLens } from "../src/web/chat-handoff.js";
import { forgetChatDrafts } from "../src/web/chat-draft.js";

const who = vi.hoisted(() => {
  let user: { id: string; email: string } | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => user,
    set(next: { id: string; email: string } | null) {
      user = next;
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
});

vi.mock("../src/web/useSession.js", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSession: () => ({
      session: null,
      user: useSyncExternalStore(who.subscribe, who.get, who.get),
      loading: false,
    }),
  };
});

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

const trace: { url: string; method: string; body: unknown }[] = [];

const SLUG = "a-piece-with-angles";
const FIRST_BLOCK = "spya-ffffff";
const LAST_BLOCK = "spya-gggggg";
const LENS = "how it relates to Smith 2019";

const BLOCKS: PublicArticle["blocks"] = [
  {
    id: FIRST_BLOCK,
    tag: "h1",
    kind: "heading",
    level: 1,
    text: "A piece with angles",
    words: 4,
    html: "<h1>A piece with angles</h1>",
    gistable: false,
  },
  {
    id: LAST_BLOCK,
    tag: "p",
    kind: "text",
    text: "It is said that memories survive metamorphosis in moths.",
    words: 9,
    html: "<p>It is said that memories survive metamorphosis in moths.</p>",
    gistable: true,
  },
];

const TREE: PublicArticle["tree"] = {
  version: "test",
  generator: "test",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: {
      id: "n0",
      depth: 0,
      parent: null,
      children: [],
      range: [FIRST_BLOCK, LAST_BLOCK],
      title: "A piece with angles",
      gist: "What the piece says.",
    },
  },
};

const COUNTS = {
  returnedSources: 1,
  reportedRows: 1,
  keptRows: 1,
  omittedOverCap: 0,
  webSearches: 2,
  lost: {
    uncited: 0,
    selfSource: 0,
    unverifiedSource: 0,
    directnessUnverified: 0,
    sourceIsCopy: 0,
    claimNotInBlock: 0,
    unknownBlockId: 0,
    malformed: 0,
  },
};

const DEBATE: Debate = {
  version: "debate/3",
  generator: "model",
  slug: SLUG,
  sourceHash: "hash",
  elapsedMs: 1,
  searchedAt: "2026-10-03T12:00:00.000Z",
  direct: { rows: [], counts: COUNTS },
  claims: {
    rows: [
      {
        id: "spya-c7w2d4",
        claimQuote: "memories survive metamorphosis",
        blockId: LAST_BLOCK,
        title: "On moths",
        url: "https://example.org/moths",
        sourceQuote: "A response to the claim.",
        relation: "qualifies" as const,
        lean: "neither" as const,
        applies: "It qualifies the claim.",
        bears: "directly" as const,
      },
    ],
    counts: COUNTS,
  },
} as Debate;

const ARTICLE: PublicArticle = {
  meta: { slug: SLUG, title: "A piece with angles", byline: "Somebody" },
  blocks: BLOCKS,
  tree: TREE,
  comments: [],
  searches: [],
  assets: undefined,
  navLabelStatus: "ready",
};

const OWNED: Article = {
  highPowerSince: null,
  titleOverridden: false,
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  meta: { slug: SLUG, title: "A piece with angles", url: "https://example.com/angles" },
};

/** A conversation the reader already has, so "fresh" can be told from "reused". */
const STORED: ChatThread = {
  id: "spya-r8z3nj",
  kind: "chat",
  title: "An earlier conversation",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
  messages: [
    { id: "m1", role: "user", text: "An earlier question", createdAt: "2026-08-27T10:00:00.000Z", status: "done" },
    { id: "m2", role: "assistant", text: "An earlier answer", createdAt: "2026-08-27T10:00:01.000Z", status: "done" },
  ],
};

/* ------------------------------------------------------- the fake server -- */

let server: ChatThread[] = [];
let nextAnswer = "";
let minted = 0;
/** Ids the fake mints; the id alphabet has no `i`, `l`, `o` or `1`. */
const mint = (): string => `spya-srw${"abcdefgh"[minted++ % 8]}22`;

function summarise(t: ChatThread): ThreadSummary {
  const answers = t.messages.filter((m) => m.role === "assistant" && m.status === "done");
  const last = answers.at(-1)?.text.split("\n")[0];
  return {
    id: t.id,
    title: t.title,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    kind: t.kind,
    ...(t.origin ? { origin: t.origin } : {}),
    turns: t.messages.filter((m) => m.role === "user").length,
    ...(last ? { lastLine: last } : {}),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Store the turn as the real route does, then stream its ids and the finished answer. */
function answerTurn(body: { threadId: string; question: string; origin?: ThreadOrigin }): Response {
  const at = new Date(Date.parse("2026-10-05T10:00:00.000Z") + server.length * 1000 + minted * 10).toISOString();
  let thread = server.find((t) => t.id === body.threadId);
  if (!thread) {
    thread = {
      id: body.threadId,
      kind: "chat",
      title: body.question.slice(0, 60),
      createdAt: at,
      updatedAt: at,
      ...(body.origin ? { origin: body.origin } : {}),
      messages: [],
    };
    server.push(thread);
  }
  const questionId = mint();
  const messageId = mint();
  thread.updatedAt = at;
  thread.messages.push(
    { id: questionId, role: "user", text: body.question, createdAt: at, status: "done" },
    { id: messageId, role: "assistant", text: nextAnswer, createdAt: at, status: "done" },
  );
  const enc = new TextEncoder();
  const text = nextAnswer;
  const title = thread.title;
  const origin = thread.origin;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const frame = (event: string, data: unknown) =>
        c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      frame("begin", {
        threadId: body.threadId,
        title,
        messageId,
        questionId,
        attempt: "att",
        ...(origin ? { origin } : {}),
      });
      frame("delta", { text });
      frame("done", { text, citations: [], searches: 0, model: "a-model" });
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function reply(url: string, method: string, body: unknown): Response {
  if (url === `/api/public/article/${SLUG}`) return json(ARTICLE);
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  if (url === "/api/reader") return json({ experimentalSince: null });
  if (url === `/api/debate/${SLUG}`) return json({ debate: DEBATE, stale: false, outdated: false });
  if (url === `/api/chat/${SLUG}` && method === "POST") {
    return answerTurn(body as { threadId: string; question: string; origin?: ThreadOrigin });
  }
  if (method === "POST") return new Response(null, { status: 204 });
  if (url === `/api/chat/${SLUG}?summary=1`) return json({ threads: server.map(summarise) });
  if (url === `/api/chat/${SLUG}`) return json({ threads: server });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url === "/api/jobs") return json({ jobs: [] });
  return json({});
}

const { App } = await import("../src/web/App.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");
const activation = await import("../src/web/activation.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

const OWNER = { id: "owner-1", email: "a@example.com" };

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  trace.length = 0;
  server = [structuredClone(STORED)];
  nextAnswer = "";
  minted = 0;
  who.set(null);
  activation.resetActivations();
  resetExperimental();
  forgetChatDrafts();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      body = String(init?.body);
    }
    trace.push({ url, method, body });
    return Promise.resolve(reply(url, method, body));
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
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
    root.render(
      createElement(StrictMode, null, createElement(NuqsAdapter, null, createElement(App, null))),
    );
  });
  await act(async () => {
    const user = who.get();
    const posed = user === null ? null : { user };
    for (const fn of [...authListeners]) fn(user === null ? "SIGNED_OUT" : "SIGNED_IN", posed);
  });
  await settle();
}

const param = (name: string): string | null => new URLSearchParams(location.search).get(name);

async function until(check: () => boolean, what = "the page to settle"): Promise<void> {
  for (let i = 0; i < 80 && !check(); i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  await settle();
  if (!check()) throw new Error(`waited for ${what}, and it did not happen`);
}

const chatPosts = () => trace.filter((r) => r.method === "POST" && r.url.startsWith(`/api/chat/${SLUG}`));
const posts = () => trace.filter((r) => r.method === "POST");

const lensBox = () => host.querySelector<HTMLInputElement>(".mode-band form.dbt-lens-row input");
const angles = () => [...host.querySelectorAll<HTMLButtonElement>(".mode-band .dbt-angles button.dbt-angle")];
const composer = (): HTMLTextAreaElement | null =>
  host.querySelector<HTMLTextAreaElement>(".mode-band textarea.chat-input");
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>(".chat-dialog");

async function typeAndSend(box: HTMLTextAreaElement, text: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    box.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

async function typeLensAndEnter(words: string): Promise<void> {
  const box = lensBox() as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(box, words);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    box.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("looking at the debate from an angle", () => {
  it("starts a fresh chat that records the angle, and Debate lists the way back to it", async () => {
    who.set(OWNER);
    await open(`?mode=debate&thread=${STORED.id}`);
    await until(() => lensBox() !== null, "the box in Debate");
    expect(angles(), "no chat was started from an angle yet").toHaveLength(0);
    const postsAtLoad = posts().length;

    /* 1. Enter in the box. */
    await typeLensAndEnter(`  ${LENS} `);
    await until(
      () => param("mode") === "chat" && composer() !== null && param("thread") !== STORED.id,
      "Chat, on a fresh conversation",
    );
    const fresh = param("thread") as string;
    expect(fresh).not.toBeNull();
    const seed = askDebateThroughLens(LENS);
    expect(seed).toContain(`"""\n${LENS}\n"""`);
    expect(composer()?.value).toBe(seed);
    expect(host.textContent, "the earlier conversation is not what is open").not.toContain("An earlier question");
    expect(chatPosts(), "Enter sends nothing to chat").toHaveLength(0);
    expect(posts().length, "and nothing anywhere else: no search was started").toBe(postsAtLoad);

    /* 2. Send, as it stands. */
    nextAnswer = "Two replies take that angle.\n\nThe first is a 2021 review.";
    await typeAndSend(composer() as HTMLTextAreaElement, seed);
    expect(chatPosts(), "one request, on Send").toHaveLength(1);
    const sent = chatPosts()[0]?.body as { threadId: string; question: string; origin?: unknown; anchor?: unknown };
    expect(sent.threadId).toBe(fresh);
    expect(sent.question).toBe(seed);
    expect(sent.origin, "exactly the angle, trimmed, and nothing of a claim").toEqual({ mode: "debate", lens: LENS });
    expect(sent.anchor).toBeUndefined();
    await until(() => (host.textContent ?? "").includes("Two replies take that angle."), "the answer");

    /* 3. Back to Debate: the line under the box, with no reload. */
    await act(async () => history.back());
    await until(() => param("mode") === "debate" && angles().length === 1, "the angle's line");
    expect(angles()[0]?.querySelector(".dbt-angle-words")?.textContent).toBe(LENS);
    expect(lensBox()?.value, "the box is empty again").toBe("");

    /* 4. The line opens the conversation beside Debate. */
    await act(async () => angles()[0]?.click());
    await until(() => param("thread") === fresh && dialog() !== null, "the conversation beside Debate");
    expect(param("mode"), "still in Debate").toBe("debate");
    await until(() => (dialog()?.textContent ?? "").includes("Two replies take that angle."), "its transcript");

    /* 5. Chat's list says where it came from. */
    await act(async () => dialog()?.querySelector<HTMLButtonElement>(".chat-dialog-close")?.click());
    await until(() => param("thread") === null, "the dialog to close");
    history.pushState(null, "", `/read/${SLUG}?mode=chat`);
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await until(() => host.querySelectorAll(".mode-band .chat-thread").length === 2, "Chat's list");
    const rows = [...host.querySelectorAll<HTMLElement>(".mode-band .chat-thread")];
    const fromDebate = rows.filter((r) => r.querySelector(".chat-thread-source") !== null);
    expect(fromDebate, "one row is marked as started elsewhere").toHaveLength(1);
    expect(fromDebate[0]?.querySelector(".chat-thread-source")?.getAttribute("aria-label")).toBe(
      "Started from an angle in Debate",
    );
  });
});
