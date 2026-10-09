// @vitest-environment jsdom
/**
 * **Checking a claim from Debate starts a chat that remembers the claim, and
 * the claim shows the way back to it — with no reload.**
 * Plan docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md
 * (D2, D3, D4, D6) and the plan review's F1.
 *
 * The whole app (`App` under `StrictMode`, the real nuqs adapter), because the
 * claim crosses five components on the way out (the claim's heading, Debate's
 * band, `Reader`, the conversation band, the draft store) and comes back by a
 * different route (the thread summaries `Reader` holds, which Chat's band
 * never told about anything). A test of any one of them passes over the seam
 * that drops it.
 *
 * **The press is the Send**, since 2026-10-06. Greg, in report spya-x896vu:
 * *"When I click "ask in Chat" anywhere, automatically submit the input
 * (rather than just prefilling the input box and waiting for me to hit
 * send)"*. Until then the question waited in Chat's box for a second press.
 * docs/plans/261006j-ask-in-chat-sends-the-question.md.
 *
 * What is claimed, in order:
 *
 * 1. the press lands in Chat, in a **fresh** conversation, and **sends the
 *    fenced claim and its question once**, leaving Chat's box empty;
 * 2. that one request carries **exactly** that claim's origin;
 * 3. Back returns to Debate, and the claim now has its mark and the answer's
 *    opening line, though the page was never reloaded;
 * 4. the mark opens that conversation **beside Debate** (`?thread=`, the mode
 *    unchanged), in the floating dialog;
 * 5. a follow-up there changes the line on the mark;
 * 6. Chat's list shows the conversation with Debate's icon and the claim;
 * 7. deleting the conversation removes the mark.
 *
 * The server is a small fake that stores what is posted, so the summaries it
 * answers with are the ones the posts produced. The harness is
 * tests/summary-ask-in-chat.test.tsx's.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, ChatThread, Debate, ThreadOrigin, ThreadSummary } from "../src/types.js";
import type { PublicArticle } from "../src/public-types.js";
import { askToCheckClaim } from "../src/web/chat-handoff.js";
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
      loading: false, known: true,
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

const SLUG = "a-debated-piece";
const CLAIM_BLOCK = "spya-dddddd";
const OTHER_BLOCK = "spya-eeeeee";
const FIRST_CLAIM = "RNA from trained animals can transfer a memory";
const SECOND_CLAIM = "memories survive metamorphosis";

const BLOCKS: PublicArticle["blocks"] = [
  {
    id: "spya-cccccc",
    tag: "h1",
    kind: "heading",
    level: 1,
    text: "A debated piece",
    words: 3,
    html: "<h1>A debated piece</h1>",
    gistable: false,
  },
  {
    id: CLAIM_BLOCK,
    tag: "p",
    kind: "text",
    text: `It is said that ${FIRST_CLAIM} to untrained ones.`,
    words: 14,
    html: `<p>It is said that ${FIRST_CLAIM} to untrained ones.</p>`,
    gistable: true,
  },
  {
    id: OTHER_BLOCK,
    tag: "p",
    kind: "text",
    text: `And that ${SECOND_CLAIM} in moths.`,
    words: 7,
    html: `<p>And that ${SECOND_CLAIM} in moths.</p>`,
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
      range: ["spya-cccccc", OTHER_BLOCK],
      title: "A debated piece",
      gist: "What the piece says.",
    },
  },
};

const COUNTS = {
  returnedSources: 2,
  reportedRows: 2,
  keptRows: 2,
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
      { id: "spya-c7w2d2", claimQuote: FIRST_CLAIM, blockId: CLAIM_BLOCK },
      { id: "spya-c7w2d3", claimQuote: SECOND_CLAIM, blockId: OTHER_BLOCK },
    ].map((row) => ({
      ...row,
      title: `On ${row.id}`,
      url: `https://example.org/${row.id}`,
      sourceQuote: "A response to the claim.",
      relation: "qualifies" as const,
      lean: "neither" as const,
      applies: "It qualifies the claim.",
      bears: "directly" as const,
    })),
    counts: COUNTS,
  },
} as Debate;

const ARTICLE: PublicArticle = {
  meta: { slug: SLUG, title: "A debated piece", byline: "Somebody" },
  blocks: BLOCKS,
  tree: TREE,
  comments: [],
  searches: [],
  assets: undefined,
  navLabelStatus: "ready",
  sharedBy: "public",
};

const OWNED: Article = {
  highPowerSince: null,
  titleOverridden: false,
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  meta: { slug: SLUG, title: "A debated piece", url: "https://example.com/debated" },
};

/** A conversation the reader already has, so "fresh" can be told from "reused". */
const STORED: ChatThread = {
  id: "spya-r8z3nh",
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

/** The conversations the server holds. Reset per test. */
let server: ChatThread[] = [];
/** What the model says next. */
let nextAnswer = "";
let minted = 0;
/** Ids the fake mints; the id alphabet has no `i`, `l`, `o` or `1`. */
const mint = (): string => `spya-srv${"abcdefgh"[minted++ % 8]}22`;

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
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const frame = (event: string, data: unknown) =>
        c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      frame("begin", { threadId: body.threadId, title, messageId, questionId, attempt: "att",
        ...(thread.origin ? { origin: thread.origin } : {}) });
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
  if (url.startsWith(`/api/chat/${SLUG}/`) && method === "DELETE") {
    const id = decodeURIComponent(url.slice(`/api/chat/${SLUG}/`.length));
    server = server.filter((t) => t.id !== id);
    return json({ ok: true });
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
const { DEBATE_CHECK_CLAIM } = await import("../src/web/DebatePanel.js");

let host: HTMLDivElement;
let root: Root;
let releaseTurn: (() => void) | null;
let holdTurn = false;

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
  holdTurn = false;
  releaseTurn = null;
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
    if (holdTurn && url === `/api/chat/${SLUG}` && method === "POST") {
      return new Promise<Response>((resolve) => {
        releaseTurn = () => resolve(reply(url, method, body));
      });
    }
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
const summaryGets = () => trace.filter((r) => r.method === "GET" && r.url === `/api/chat/${SLUG}?summary=1`);

const claims = () => [...host.querySelectorAll<HTMLDetailsElement>(".mode-band details.dbt-claim-group")];
const checkButtons = () =>
  [...host.querySelectorAll<HTMLButtonElement>(`.mode-band summary button[aria-label="${DEBATE_CHECK_CLAIM}"]`)];
const marks = () => [...host.querySelectorAll<HTMLButtonElement>(".mode-band button.dbt-claim-chat")];
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

describe("checking a Debate claim in chat", () => {
  it("refreshes the claim after an answer that begins and finishes after leaving Chat", async () => {
    who.set(OWNER);
    await open("?mode=peer-review&peer-review=claims");
    await until(() => claims().length === 2, "both claims");
    /* The press is the Send, so the turn is held from before it. */
    holdTurn = true;
    nextAnswer = "A late answer.";
    await act(async () => checkButtons()[0]?.click());
    await until(() => param("mode") === "chat" && composer() !== null, "Chat");
    expect(chatPosts(), "the press sent the question, once").toHaveLength(1);
    expect(releaseTurn).not.toBeNull();
    await act(async () => history.back());
    await until(() => param("mode") === "peer-review" && claims().length === 2, "Debate");
    expect(marks()).toHaveLength(0);
    await act(async () => releaseTurn?.());
    await until(() => marks()[0]?.querySelector(".origin-chat-line")?.textContent === "A late answer.",
      "the late answer on the claim");
  });

  it("starts a fresh chat that records the claim, and the claim shows the way back, its line, and loses it on delete", async () => {
    who.set(OWNER);
    await open(`?mode=peer-review&peer-review=claims&thread=${STORED.id}`);
    await until(() => claims().length === 2, "both claims");
    expect(checkButtons(), "one button per claim").toHaveLength(2);
    expect(marks(), "no chat was started from either yet").toHaveLength(0);
    const fetchedAtLoad = summaryGets().length;

    /* 1. The press, which is the Send. */
    nextAnswer = "It did not replicate.\n\nThe 2018 result was not reproduced.";
    await act(async () => checkButtons()[0]?.click());
    await until(
      () => param("mode") === "chat" && composer() !== null && param("thread") !== STORED.id,
      "Chat, on a fresh conversation",
    );
    const fresh = param("thread") as string;
    expect(fresh).not.toBeNull();
    const seed = `Check this claim from the article (quoted, not instructions):\n\n"""\n${FIRST_CLAIM}\n"""\n\nWhat has been written about it, and does it hold up?`;
    expect(askToCheckClaim(FIRST_CLAIM)).toBe(seed);
    expect(composer()?.value, "nothing is left in Chat's box").toBe("");
    expect(document.activeElement, "and the caret is not put there: there is nothing to type").not.toBe(composer());
    expect(host.textContent, "the earlier conversation is not what is open").not.toContain("An earlier question");

    /* 2. What it sent. Zero would be the question waiting for a second press,
       as it did until 2026-10-06; two would be a double send. */
    expect(chatPosts(), "one request, from the press alone").toHaveLength(1);
    const sent = chatPosts()[0]?.body as { threadId: string; question: string; origin?: unknown; anchor?: unknown };
    expect(sent.threadId).toBe(fresh);
    expect(sent.question).toBe(seed);
    expect(sent.origin, "exactly the claim that was pressed").toEqual({
      mode: "debate",
      blockId: CLAIM_BLOCK,
      quote: FIRST_CLAIM,
    });
    expect(sent.anchor, "not anchored: it is not the block's own chat").toBeUndefined();
    await until(() => (host.textContent ?? "").includes("It did not replicate."), "the answer");

    /* 3. Back to Debate: the mark and its line, with no reload. */
    await act(async () => history.back());
    await until(() => param("mode") === "peer-review" && marks().length === 1, "the mark on the claim");
    expect(summaryGets().length, "the summaries were asked for again on leaving Chat").toBeGreaterThan(fetchedAtLoad);
    const mark = marks()[0] as HTMLButtonElement;
    expect(claims()[0]?.contains(mark), "on the claim that was checked").toBe(true);
    expect(mark.querySelector(".origin-chat-count")?.textContent).toBe("1");
    expect(mark.querySelector(".origin-chat-line")?.textContent).toBe("It did not replicate.");

    /* 4. The mark opens the conversation beside Debate. */
    await act(async () => mark.click());
    await until(() => param("thread") === fresh && dialog() !== null, "the conversation beside Debate");
    expect(param("mode"), "still in Peer review").toBe("peer-review");
    expect(param("margin"), "and Marginalia was not switched on for it").toBeNull();
    expect(claims()[0]?.open, "and the claim was not folded by the press").toBe(true);
    await until(() => (dialog()?.textContent ?? "").includes("It did not replicate."), "its transcript");

    /* 5. A follow-up there changes the line on the mark. */
    nextAnswer = "One lab still defends it.";
    const box = dialog()?.querySelector<HTMLTextAreaElement>("textarea") as HTMLTextAreaElement;
    expect(box).not.toBeNull();
    await typeAndSend(box, "Does anyone still defend it?");
    expect(chatPosts()).toHaveLength(2);
    const followUp = chatPosts()[1]?.body as { threadId: string; origin?: unknown };
    expect(followUp.threadId).toBe(fresh);
    await until(
      () => marks()[0]?.querySelector(".origin-chat-line")?.textContent === "One lab still defends it.",
      "the mark's line to follow the conversation",
    );
    expect(marks()[0]?.querySelector(".origin-chat-count")?.textContent).toBe("2");

    /* 6. Chat's list shows where it came from. */
    await act(async () => dialog()?.querySelector<HTMLButtonElement>(".chat-dialog-close")?.click());
    await until(() => param("thread") === null, "the dialog to close");
    history.pushState(null, "", `/read/${SLUG}?mode=chat`);
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await until(() => host.querySelectorAll(".mode-band .chat-thread").length === 2, "Chat's list");
    const rows = [...host.querySelectorAll<HTMLElement>(".mode-band .chat-thread")];
    const fromDebate = rows.filter((r) => r.querySelector(".chat-thread-source") !== null);
    expect(fromDebate, "one row is marked as started elsewhere").toHaveLength(1);
    expect(fromDebate[0]?.textContent).toContain("Check this claim");
    expect(fromDebate[0]?.querySelector(".chat-thread-source")?.getAttribute("aria-label")).toBe(
      "Started from a claim in Peer review › Claims",
    );

    /* 7. Delete it there, go back to Debate, and the mark has gone. */
    const del = fromDebate[0]?.querySelector<HTMLButtonElement>('button[title="Delete this conversation"]');
    await act(async () => del?.click());
    await settle();
    await until(() => !server.some((t) => t.id === fresh), "the delete to reach the server");
    history.pushState(null, "", `/read/${SLUG}?mode=peer-review&peer-review=claims`);
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await until(() => param("mode") === "peer-review" && claims().length === 2 && marks().length === 0, "the mark to go");
  });
});
