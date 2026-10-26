// @vitest-environment jsdom
/**
 * **A question asked in Sources › Investigate starts a chat that remembers the
 * question, and Investigate lists it as the way back — with no reload.**
 * Plan docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md, A,
 * where this was Reception's angle box; Sources › Investigate since plan
 * docs/plans/261020n-sources-reception-layout-and-a-sources-chat-sub-mode.md
 * (Stage 2), which also asks here that arriving on Investigate sends nothing, that one
 * press is one chat request, and that a claim and a work go through their own
 * sub-modes' senders.
 *
 * The whole app, for the reason tests/sources-claim-check-in-chat.test.tsx
 * gives: the angle crosses the panel, Debate's band, `Reader`, the
 * conversation band and the draft store on the way out, and comes back
 * through the thread summaries `Reader` holds. This is that file's harness.
 *
 * **Enter in the box is the Send**, since 2026-10-06. Greg, in report
 * spya-x896vu: *"When I click "ask in Chat" anywhere, automatically submit the
 * input (rather than just prefilling the input box and waiting for me to hit
 * send)"*. Until then the question waited in Chat's box for a second press.
 * docs/plans/261006j-ask-in-chat-sends-the-question.md.
 *
 * What is claimed, in order:
 *
 * 1. Enter in the box lands in Chat, in a **fresh** conversation, and **sends
 *    the fenced question and the search line once**: Chat's box is left empty
 *    and without the caret, and nothing else is posted anywhere;
 * 2. that one request's origin is **exactly** `{ mode, lens }`: no block, no
 *    quote, no anchor;
 * 3. Back returns to Investigate, and *Your questions* has the line, never reloaded;
 * 4. the line opens that conversation **beside Sources** (`?thread=`, the mode
 *    unchanged);
 * 5. Chat's list shows the conversation with Sources' icon, named as a
 *    question in Sources › Investigate.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Article,
  Bibliography,
  ChatThread,
  CitedWork,
  Reception,
  SourcesClaimList,
  ThreadOrigin,
  ThreadSummary,
} from "../src/types.js";
import type { PublicArticle } from "../src/public-types.js";
import { askAboutCitedWork, askInSources, askToCheckClaim } from "../src/web/chat-handoff.js";
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

const RECEPTION: Reception = {
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
} as Reception;

const CLAIM_QUOTE = "memories survive metamorphosis";
const CLAIM_LIST: SourcesClaimList = {
  version: "debate-claims/1",
  generator: "a-model",
  slug: SLUG,
  sourceHash: "hash",
  claims: [{ id: "c1", blockId: LAST_BLOCK, quote: CLAIM_QUOTE, statement: "Moths remember." }],
  dropped: { unknownIds: 0, unquoted: 0, tooLong: 0, duplicate: 0 },
  generatedAt: "2026-10-03T12:00:00.000Z",
  elapsedMs: 1,
} as SourcesClaimList;

const WORK = {
  id: "spya-wrk222",
  key: "work:moths",
  title: "Moths and memory",
  authors: "Blackiston",
  year: "2008",
  why: "The study it leans on.",
  relevance: 0.9,
  mentions: [],
  citedAt: [],
  firstCited: LAST_BLOCK,
  citedInBody: false,
  url: "https://doi.org/10.1371/journal.pone.0001736",
  linkFrom: "doi",
} as unknown as CitedWork;

const BIBLIOGRAPHY = {
  version: "bibliography/1",
  generator: "a-model",
  slug: SLUG,
  sourceHash: "hash",
  citations: [WORK],
  capped: false,
  generatedAt: "2026-10-03T12:00:00.000Z",
  elapsedMs: 1,
} as unknown as Bibliography;

const ARTICLE: PublicArticle = {
  meta: { slug: SLUG, title: "A piece with angles", byline: "Somebody" },
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
let summaryGate: Promise<void> | null = null;
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

/** The reader's experimental switch: off unless a test turns it on. Off for § Where it sits, which no longer asks it. */
let experimentalSince: string | null = null;
/** The stored literature search, or `null` for none yet (§ Where it sits). */
let storedSituate: unknown = null;

function reply(url: string, method: string, body: unknown): Response {
  if (url === `/api/public/article/${SLUG}`) return json(ARTICLE);
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  if (url === "/api/reader") return json({ experimentalSince });
  /* Nobody has searched the literature for this one (`200 null`, the none-yet answer). */
  if (url === `/api/situate/${SLUG}`) return json(storedSituate);
  if (url === `/api/reception/${SLUG}`) return json({ reception: RECEPTION, stale: false, outdated: false });
  if (url === `/api/sources-claims/${SLUG}`) return json({ claimList: CLAIM_LIST, stale: false, outdated: false });
  if (url === `/api/bibliography/${SLUG}`) return json({ bibliography: BIBLIOGRAPHY, stale: false, outdated: false });
  if (url === `/api/chat/${SLUG}` && method === "POST") {
    return answerTurn(body as { threadId: string; question: string; origin?: ThreadOrigin });
  }
  if (url === `/api/comments/${SLUG}` && method === "POST") {
    return json({
      comment: {
        ...(body as Record<string, unknown>),
        createdAt: "2026-10-20T23:00:00.000Z",
        status: "none",
      },
    });
  }
  if (method === "POST") return new Response(null, { status: 204 });
  if (url === `/api/chat/${SLUG}?summary=1`) return json({ threads: server.map(summarise) });
  if (url === `/api/chat/${SLUG}`) return json({ threads: server });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url === "/api/jobs") return json({ jobs: [] });
  return json({});
}

const { App } = await import("../src/web/App.js");
const { SOURCES_INVESTIGATE_SUGGESTED } = await import("../src/web/InvestigatePanel.js");
const { SITUATE_RUN } = await import("../src/web/situate-dossier.js");
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
  summaryGate = null;
  experimentalSince = null;
  storedSituate = null;
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
    if (url === `/api/chat/${SLUG}?summary=1` && summaryGate) {
      return summaryGate.then(() => reply(url, method, body));
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
const posts = () => trace.filter((r) => r.method === "POST");

const lensBox = () => host.querySelector<HTMLInputElement>(".mode-band form.investigate-box-row input");
const angles = () => [...host.querySelectorAll<HTMLButtonElement>(".mode-band .investigate-yours button.investigate-yours-line")];
const investigateRows = (section: string) => [
  ...host.querySelectorAll<HTMLButtonElement>(`.mode-band .investigate-section${section} button.investigate-q`),
];
const composer = (): HTMLTextAreaElement | null =>
  host.querySelector<HTMLTextAreaElement>(".mode-band textarea.chat-input");
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>(".chat-dialog");
const annotation = (): HTMLElement | null => document.querySelector<HTMLElement>(".annotate-dialog");
/** A DOM point at `offset` characters into rendered prose. */
function prosePoint(within: HTMLElement, offset: number): [Node, number] {
  const walker = document.createTreeWalker(within, NodeFilter.SHOW_TEXT);
  let left = offset;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (left <= length) return [node, left];
    left -= length;
  }
  throw new Error(`offset ${offset} is past the end of the prose`);
}
/** One of *Where it sits*' tools (WhereItSitsPanel.tsx), by its address. */
const tool = (view: string): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>(`.mode-band .where-tools button.where-tool[data-tool="${view}"]`);
/** One of Sources' chips, by its label (SourcesMode.tsx § `SourcesViews`). */
const chip = (label: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>('.mode-band [role="radiogroup"][aria-label="Sources view"] button.summ-view-btn')].find(
    (b) => (b.getAttribute("aria-label") ?? "").split(",")[0] === label,
  );

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

describe("asking a question in Sources › Investigate", () => {
  /* Until 2026-10-06 this test held the opposite: nothing listed until Send,
     and the unsent lens restored on coming back to Chat. Enter is the Send
     now, so there is no unsent lens to restore; what is left to hold is that
     the one press is one request however often Chat is left and reopened.
     The unsent-draft machinery itself is tests/conversation-band-origin.test.tsx's. */
  it("sends the question once on Enter, lists it in Investigate, and does not send or refill it on returning to Chat", async () => {
    who.set(OWNER);
    await open("?mode=sources&sources=investigate");
    await until(() => lensBox() !== null, "the box in Investigate");
    nextAnswer = "One reply takes that angle.";
    await typeLensAndEnter(LENS);
    await until(() => param("mode") === "chat" && composer() !== null, "Chat");
    /* Zero here is the old behaviour (waiting for Send); two is a double send. */
    expect(chatPosts(), "Enter alone sent it, once").toHaveLength(1);
    const sent = chatPosts()[0]?.body as { question: string; origin: ThreadOrigin } | undefined;
    expect(sent?.question).toBe(askInSources(LENS));
    expect(sent?.origin).toEqual({ mode: "reception", lens: LENS });
    expect(composer()?.value, "and left nothing in the box").toBe("");
    expect(server, "the conversation is on the server").toHaveLength(2);

    await act(async () => history.back());
    await until(() => param("mode") === "sources" && angles().length === 1, "Ask again, with the question listed");

    history.pushState(null, "", `/read/${SLUG}?mode=chat`);
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await until(
      () =>
        param("mode") === "chat" &&
        host.querySelector(".mode-band .chat-thread, .mode-band textarea.chat-input") !== null,
      "Chat again",
    );
    expect(chatPosts(), "coming back does not send it a second time").toHaveLength(1);
    expect(server, "and starts no second conversation").toHaveLength(2);
    for (const box of host.querySelectorAll<HTMLTextAreaElement>(".mode-band textarea.chat-input")) {
      expect(box.value, "nor put the question back in a box").toBe("");
    }
  });

  /* One press is one action. Until 2026-10-06 Enter in Debate's box moved the
     caret into Chat's box, already holding the question, and the same key,
     still held, must not then send it (found by GPT Sol's review;
     docs/postmortems/261005o). Enter now sends the question itself and the
     caret does not move to Chat's box, so the held key has nowhere to land.
     What is still held: the press is one request, and a repeating Enter in
     Chat's box, whatever is in it, is never a Send of its own. */
  it("does not send a second time on a held Enter repeating into Chat's box, and a fresh Enter still sends", async () => {
    who.set(OWNER);
    await open("?mode=sources&sources=investigate");
    await until(() => lensBox() !== null, "the box in Investigate");
    await typeLensAndEnter(LENS);
    await until(() => param("mode") === "chat" && composer() !== null, "Chat");
    expect(chatPosts(), "Enter sent the angle").toHaveLength(1);
    const box = composer() as HTMLTextAreaElement;
    expect(document.activeElement, "the caret did not follow the key into Chat's box").not.toBe(box);

    /* The key still held, on the empty box. */
    const held = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true });
    await act(async () => {
      box.dispatchEvent(held);
    });
    await settle();
    expect(chatPosts(), "holding the handoff key is not a second Send").toHaveLength(1);

    /* And on a box with words in it, where a Send would have something to send. */
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "And who disagrees?");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const heldOnWords = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true });
    await act(async () => {
      box.dispatchEvent(heldOnWords);
    });
    await settle();
    expect(chatPosts(), "a repeating Enter does not send what is typed either").toHaveLength(1);
    expect(heldOnWords.defaultPrevented, "and it adds no blank line to the question").toBe(true);
    expect(composer()?.value).toBe("And who disagrees?");

    await act(async () => {
      composer()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await settle();
    const sentTurns = chatPosts();
    expect(sentTurns, "a press of its own sends").toHaveLength(2);
    const first = sentTurns[0]?.body as { threadId: string } | undefined;
    const second = sentTurns[1]?.body as { question: string; threadId: string } | undefined;
    expect(second?.question).toBe("And who disagrees?");
    expect(first?.threadId, "the first turn named its conversation").toBeTruthy();
    expect(second?.threadId, "to the same conversation").toBe(first?.threadId);
  });

  it("starts a fresh chat that records the question, and Investigate lists the way back to it", async () => {
    who.set(OWNER);
    await open(`?mode=sources&sources=investigate&thread=${STORED.id}`);
    await until(() => lensBox() !== null, "the box in Investigate");
    expect(angles(), "no chat was started from an angle yet").toHaveLength(0);
    const postsAtLoad = posts().length;

    /* 1. Enter in the box, which is the Send. */
    nextAnswer = "Two replies take that angle.\n\nThe first is a 2021 review.";
    await typeLensAndEnter(`  ${LENS} `);
    await until(
      () => param("mode") === "chat" && composer() !== null && param("thread") !== STORED.id,
      "Chat, on a fresh conversation",
    );
    const fresh = param("thread") as string;
    expect(fresh).not.toBeNull();
    const seed = askInSources(LENS);
    expect(seed).toContain(`"""\n${LENS}\n"""`);
    expect(composer()?.value, "nothing is left in Chat's box").toBe("");
    expect(document.activeElement, "and the caret is not put there: there is nothing to type").not.toBe(composer());
    expect(host.textContent, "the earlier conversation is not what is open").not.toContain("An earlier question");

    /* 2. What it sent. Zero would be the question waiting for a second press,
       as it did until 2026-10-06; two would be a double send. */
    expect(chatPosts(), "one request, from Enter alone").toHaveLength(1);
    expect(posts().length, "and nothing anywhere else: no search was started").toBe(postsAtLoad + 1);
    const sent = chatPosts()[0]?.body as { threadId: string; question: string; origin?: unknown; anchor?: unknown };
    expect(sent.threadId).toBe(fresh);
    expect(sent.question).toBe(seed);
    expect(sent.origin, "exactly the angle, trimmed, and nothing of a claim").toEqual({ mode: "reception", lens: LENS });
    expect(sent.anchor).toBeUndefined();
    await until(() => (host.textContent ?? "").includes("Two replies take that angle."), "the answer");

    /* 3. Back to Investigate: the line under *Your questions*, with no reload. */
    await act(async () => history.back());
    await until(() => param("mode") === "sources" && angles().length === 1, "the angle's line");
    expect(angles()[0]?.querySelector(".investigate-yours-words")?.textContent).toBe(LENS);
    expect(lensBox()?.value, "the box is empty again").toBe("");

    /* 4. The line opens the conversation beside Sources. */
    await act(async () => angles()[0]?.click());
    await until(() => param("thread") === fresh && dialog() !== null, "the conversation beside Sources");
    expect(param("mode"), "still in Sources").toBe("sources");
    await until(() => (dialog()?.textContent ?? "").includes("Two replies take that angle."), "its transcript");

    /* 5. Chat's list says where it came from. */
    await act(async () => dialog()?.querySelector<HTMLButtonElement>(".chat-dialog-close")?.click());
    await until(() => param("thread") === null, "the dialog to close");
    history.pushState(null, "", `/read/${SLUG}?mode=chat`);
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await until(() => host.querySelectorAll(".mode-band .chat-thread").length === 2, "Chat's list");
    const rows = [...host.querySelectorAll<HTMLElement>(".mode-band .chat-thread")];
    const fromClaimCheck = rows.filter((r) => r.querySelector(".chat-thread-source") !== null);
    expect(fromClaimCheck, "one row is marked as started elsewhere").toHaveLength(1);
    expect(fromClaimCheck[0]?.querySelector(".chat-thread-source")?.getAttribute("aria-label")).toBe(
      "Started from a question in Sources › Investigate",
    );
  });

  /* GPT Sol's F9 on plan 261020n: several new one-press places send a paid
     chat turn, so arriving buys nothing, and each press buys exactly one. */
  it("sends nothing on arrival, with every row drawn", async () => {
    who.set(OWNER);
    await open("?mode=sources&sources=investigate");
    await until(
      () => investigateRows(".investigate-claims").length === 1 && investigateRows(".investigate-works").length === 1,
      "Investigate, with a claim and a work",
    );
    expect(investigateRows("").length).toBe(SOURCES_INVESTIGATE_SUGGESTED.length + 2);
    expect(chatPosts(), "no chat question on arrival").toEqual([]);
    expect(trace.filter((r) => r.method === "POST" && r.url === "/api/jobs"), "and no job").toEqual([]);
  });

  it("sends a suggested question once, stored as its own lens", async () => {
    who.set(OWNER);
    await open("?mode=sources&sources=investigate");
    await until(() => investigateRows("").length > 0, "Investigate's questions");
    const question = SOURCES_INVESTIGATE_SUGGESTED[0] as string;
    await act(async () => investigateRows("")[0]?.click());
    await until(() => param("mode") === "chat" && chatPosts().length > 0, "Chat");
    expect(chatPosts()).toHaveLength(1);
    const sent = chatPosts()[0]?.body as { question: string; origin: ThreadOrigin };
    expect(sent.question).toBe(askInSources(question));
    expect(sent.origin).toEqual({ mode: "reception", lens: question });
  });

  it("sends one chat turn when a suggested question is double-clicked, under StrictMode", async () => {
    who.set(OWNER);
    await open("?mode=sources&sources=investigate");
    await until(() => investigateRows("").length > 0, "Investigate's questions");
    const row = investigateRows("")[0] as HTMLButtonElement;
    /* Both clicks in one `act` model the browser delivering the two click
       events before the navigation has replaced this panel. `open` wraps the
       app in StrictMode, so this also keeps the handoff effect's replay in the
       assertion. */
    await act(async () => {
      row.click();
      row.click();
    });
    await until(() => param("mode") === "chat" && chatPosts().length > 0, "Chat");
    expect(chatPosts(), "one double click is one paid turn").toHaveLength(1);
    expect(server, "and one fresh conversation").toHaveLength(2);
  });

  it("asks about a claim through Claims' own question and origin", async () => {
    who.set(OWNER);
    await open("?mode=sources&sources=investigate");
    await until(() => investigateRows(".investigate-claims").length === 1, "the claim's row");
    await act(async () => investigateRows(".investigate-claims")[0]?.click());
    await until(() => param("mode") === "chat" && chatPosts().length > 0, "Chat");
    expect(chatPosts()).toHaveLength(1);
    const sent = chatPosts()[0]?.body as { question: string; origin: ThreadOrigin };
    expect(sent.question).toBe(askToCheckClaim(CLAIM_QUOTE));
    expect(sent.origin).toEqual({ mode: "sources-claims", blockId: LAST_BLOCK, quote: CLAIM_QUOTE });

    /* Back on Investigate, the claim shows its chat's mark in the button's place. */
    await act(async () => history.back());
    await until(
      () => param("mode") === "sources" && host.querySelector(".mode-band .investigate-claims .origin-chat") !== null,
      "the claim's mark",
    );
    expect(investigateRows(".investigate-claims")).toHaveLength(0);
  });

  /* Greg, 2026-10-20 (spya-nhwy3d): "I started an investigate chat … and I can
     see it listed in the chat threads, but when I go to investigate, it just
     shows me an empty thing." Arriving on Investigate opens the newest
     Investigate conversation beside Sources, once per visit, and buys nothing.
     docs/plans/261021b-investigate-takes-you-back-to-your-conversation.md. */
  describe("coming back to Investigate", () => {
    function lensChat(id: string, lens: string, updatedAt: string, answer: string): ChatThread {
      return {
        id,
        kind: "chat",
        title: `Question: ${lens}`,
        createdAt: updatedAt,
        updatedAt,
        origin: { mode: "reception", lens },
        messages: [
          { id: `${id}-q`, role: "user", text: askInSources(lens), createdAt: updatedAt, status: "done" },
          { id: `${id}-a`, role: "assistant", text: answer, createdAt: updatedAt, status: "done" },
        ],
      };
    }
    const OLDER = lensChat("spya-k3m9qt", "How has it been received?", "2026-10-20T21:56:00.000Z", "Received warmly.");
    const NEWER = lensChat("spya-v7x2rd", "Who disagrees with it?", "2026-10-20T22:30:00.000Z", "Some physicists do.");

    it("opens the newest Investigate conversation beside Sources, and sends nothing", async () => {
      server = [structuredClone(STORED), structuredClone(OLDER), structuredClone(NEWER)];
      who.set(OWNER);
      await open("?mode=sources&sources=investigate");
      await until(() => param("thread") === NEWER.id && dialog() !== null, "the newest conversation beside Investigate");
      expect(param("mode"), "still in Sources").toBe("sources");
      expect(param("sources")).toBe("investigate");
      await until(() => (dialog()?.textContent ?? "").includes("Some physicists do."), "its transcript");
      expect(chatPosts(), "opening a stored conversation buys nothing").toEqual([]);
    });

    it("stays closed once closed, for the rest of the visit", async () => {
      server = [structuredClone(STORED), structuredClone(OLDER)];
      who.set(OWNER);
      await open("?mode=sources&sources=investigate");
      await until(() => param("thread") === OLDER.id && dialog() !== null, "the conversation beside Investigate");
      await act(async () => dialog()?.querySelector<HTMLButtonElement>(".chat-dialog-close")?.click());
      await until(() => param("thread") === null && dialog() === null, "the dialog to close");
      await settle(10);
      expect(param("thread"), "not reopened").toBeNull();
      expect(dialog()).toBeNull();
      expect(angles(), "and the conversation is still listed").toHaveLength(1);
    });

    it("leaves a conversation the address already names", async () => {
      server = [structuredClone(STORED), structuredClone(OLDER), structuredClone(NEWER)];
      who.set(OWNER);
      await open(`?mode=sources&sources=investigate&thread=${OLDER.id}`);
      await until(() => dialog() !== null && angles().length === 2, "the named conversation");
      await settle(10);
      expect(param("thread"), "the one the address named, not the newest").toBe(OLDER.id);
    });

    /* GPT Sol's F2 on the plan: a `?thread=` no dialog draws (a stale id, or
       Chat's state carried across) is still not replaced. */
    it("leaves a `?thread=` that no dialog draws", async () => {
      server = [structuredClone(STORED), structuredClone(OLDER)];
      who.set(OWNER);
      await open("?mode=sources&sources=investigate&thread=spya-zzzz22");
      await until(() => angles().length === 1, "Your questions");
      await settle(10);
      expect(param("thread")).toBe("spya-zzzz22");
      expect(dialog()).toBeNull();
    });

    /* GPT Sol's F1: an unsent passage chat holds its words only in the dialog,
       so the arrival must not replace it. */
    it("does not replace an unsent passage chat", async () => {
      server = [structuredClone(STORED), structuredClone(OLDER)];
      let releaseSummaries!: () => void;
      summaryGate = new Promise<void>((resolve) => {
        releaseSummaries = resolve;
      });
      who.set(OWNER);
      await open("?mode=sources&sources=reception");
      const chatChip = () => host.querySelector<HTMLButtonElement>(`tr[data-block="${LAST_BLOCK}"] button.block-chat`);
      await until(() => chatChip() !== null, "the paragraph's chat button");
      await act(async () => chatChip()?.click());
      await until(() => dialog()?.querySelector("textarea") != null, "the passage chat's box");
      const box = dialog()?.querySelector("textarea") as HTMLTextAreaElement;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(box, "Not sent yet");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
      /* A tool since plan 261025h: back to Where it sits, whose tools row has it. */
      await act(async () => chip("Where it sits")?.click());
      await until(() => tool("investigate") !== null, "Where it sits' tools");
      await act(async () => tool("investigate")?.click());
      await until(() => lensBox() !== null, "Investigate");
      await act(async () => releaseSummaries());
      await until(() => angles().length === 1, "Your questions after the held summary list arrives");
      await settle(10);
      expect(param("thread"), "nothing opened over it").toBeNull();
      expect(dialog()?.querySelector("textarea")?.value).toBe("Not sent yet");
      expect(chatPosts()).toEqual([]);
      await act(async () => dialog()?.querySelector<HTMLButtonElement>(".chat-dialog-close")?.click());
      await until(() => dialog() === null, "the passage draft to close");
      await settle(10);
      expect(param("thread"), "the arrival was spent while the draft was open").toBeNull();
    });

    it("does not open over an annotation in progress", async () => {
      server = [structuredClone(STORED), structuredClone(OLDER)];
      who.set(OWNER);
      await open("?mode=referee");
      const prose = host.querySelector<HTMLElement>(`tr[data-block="${LAST_BLOCK}"] td.text .prose`);
      expect(prose).not.toBeNull();
      await act(async () => {
        const range = document.createRange();
        range.setStart(...prosePoint(prose!, 3));
        range.setEnd(...prosePoint(prose!, 17));
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        prose?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      });
      await until(() => annotation() !== null, "the annotation box");
      const box = annotation()?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your comment on this passage"]');
      expect(box).not.toBeNull();
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(box, "Unfinished evidence");
        box?.dispatchEvent(new Event("input", { bubbles: true }));
      });

      await act(async () => {
        history.pushState(null, "", `/read/${SLUG}?mode=sources&sources=investigate`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await until(() => lensBox() !== null, "Investigate");
      await settle(10);
      expect(param("thread"), "no conversation opened over the annotation").toBeNull();
      expect(dialog()).toBeNull();
      expect(annotation()?.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Unfinished evidence");
      expect(chatPosts()).toEqual([]);
    });

    /* GPT Sol's F3: a visit is one mount of the panel. */
    it("opens it again on coming back to Investigate from another chip", async () => {
      server = [structuredClone(STORED), structuredClone(OLDER)];
      who.set(OWNER);
      await open("?mode=sources&sources=investigate");
      await until(() => param("thread") === OLDER.id && dialog() !== null, "the conversation");
      await act(async () => dialog()?.querySelector<HTMLButtonElement>(".chat-dialog-close")?.click());
      await until(() => param("thread") === null && dialog() === null, "the dialog to close");
      await act(async () => chip("Bibliography")?.click());
      await until(() => param("sources") === "bibliography", "Bibliography");
      await settle(4);
      expect(param("thread"), "not opened outside Investigate").toBeNull();
      /* Investigate is a tool inside Where it sits since plan 261025h. */
      await act(async () => chip("Where it sits")?.click());
      await until(() => tool("investigate") !== null, "Where it sits' tools");
      await act(async () => tool("investigate")?.click());
      await until(() => param("thread") === OLDER.id && dialog() !== null, "the conversation again");
    });

    it("a suggested question pressed with the conversation open starts one fresh chat", async () => {
      server = [structuredClone(STORED), structuredClone(OLDER)];
      who.set(OWNER);
      await open("?mode=sources&sources=investigate");
      await until(() => param("thread") === OLDER.id && dialog() !== null, "the conversation");
      await act(async () => investigateRows("")[0]?.click());
      await until(() => param("mode") === "chat" && chatPosts().length > 0, "Chat");
      await settle(4);
      expect(chatPosts(), "one paid turn").toHaveLength(1);
      expect(server, "in one fresh conversation").toHaveLength(3);
      const sent = chatPosts()[0]?.body as { threadId: string };
      expect(sent.threadId).not.toBe(OLDER.id);
    });

    it("does not open the stored conversation when summaries arrive after a question has left for Chat", async () => {
      server = [structuredClone(STORED), structuredClone(OLDER)];
      let releaseSummaries!: () => void;
      summaryGate = new Promise<void>((resolve) => {
        releaseSummaries = resolve;
      });
      who.set(OWNER);
      await open("?mode=sources&sources=investigate");
      await until(() => investigateRows("").length > 0, "Investigate's questions");
      await act(async () => investigateRows("")[0]?.click());
      await until(() => param("mode") === "chat" && chatPosts().length === 1, "the fresh Chat turn");
      const sent = chatPosts()[0];
      if (!sent) throw new Error("the fresh Chat turn was not recorded");
      const fresh = (sent.body as { threadId: string }).threadId;
      await act(async () => releaseSummaries());
      await settle(10);
      expect(param("mode")).toBe("chat");
      expect(param("thread"), "the stored Investigate chat did not replace the fresh one").toBe(fresh);
      expect(param("thread")).not.toBe(OLDER.id);
      expect(chatPosts()).toHaveLength(1);
    });

    it("opens nothing when there is no Investigate conversation", async () => {
      who.set(OWNER);
      await open("?mode=sources&sources=investigate");
      await until(() => lensBox() !== null, "the box in Investigate");
      await settle(10);
      expect(param("thread")).toBeNull();
      expect(dialog()).toBeNull();
    });

    it("the way back from an older Investigate chat lands on that chat, not the newest", async () => {
      server = [structuredClone(STORED), structuredClone(OLDER), structuredClone(NEWER)];
      who.set(OWNER);
      await open(`?mode=chat&thread=${OLDER.id}`);
      const back = () => host.querySelector<HTMLButtonElement>(".mode-band .chat-origin-back");
      await until(() => back() !== null, "Chat's way back");
      await act(async () => back()?.click());
      await until(() => param("mode") === "sources" && dialog() !== null, "Investigate, with the conversation beside it");
      await settle(10);
      expect(param("sources")).toBe("investigate");
      expect(param("thread")).toBe(OLDER.id);
      expect(chatPosts()).toEqual([]);
    });
  });

  it("asks about a work through Bibliography's own question and origin", async () => {
    who.set(OWNER);
    await open("?mode=sources&sources=investigate");
    await until(() => investigateRows(".investigate-works").length === 1, "the work's row");
    await act(async () => investigateRows(".investigate-works")[0]?.click());
    await until(() => param("mode") === "chat" && chatPosts().length > 0, "Chat");
    expect(chatPosts()).toHaveLength(1);
    const sent = chatPosts()[0]?.body as { question: string; origin: ThreadOrigin };
    expect(sent.question).toBe(askAboutCitedWork(WORK, []));
    expect(sent.origin).toEqual({ mode: "bibliography", itemId: WORK.id, quote: WORK.title });
  });
});

/* Plan 261025h: *Where it sits* is Sources' default for the owner, and the
   literature search's dossier is in it for every owner, out of the
   experimental switch (decision 5, GPT Sol's F7). Opening it reads, offers the
   press, and buys nothing; a finding's chat stores the finding's own origin,
   and its way back lands on *Where it sits*, on the finding (decision 9). */
describe("Where it sits", () => {
  const situateReads = () => trace.filter((r) => r.url === `/api/situate/${SLUG}`);
  const dossier = () => host.querySelector<HTMLElement>(".mode-band .where-situate");
  const FINDING_ID = "si-0123456789ab";
  const FINDING = {
    id: FINDING_ID,
    kind: "challenged",
    blockId: LAST_BLOCK,
    quote: CLAIM_QUOTE,
    note: "A 2020 study found the memories do not survive.",
    strength: "strong",
    sources: [{ origin: "web", url: "https://example.org/moths", title: "Moths forget", quote: "the memories did not survive" }],
  };
  const DOSSIER = {
    situate: {
      version: "situate/1",
      generator: "a-model",
      slug: SLUG,
      sourceHash: "hash",
      profileHash: null,
      generatedAt: "2026-10-24T10:00:00.000Z",
      elapsedMs: 1,
      kind: "empirical",
      year: 2008,
      angle: "since",
      outcome: "read",
      overview: "It is still argued over.",
      findings: [FINDING],
      questions: [],
      searched: { queries: [], pages: 0, citers: 0, cited: 0 },
      counts: {
        written: 1, kept: 1, malformed: 0, unknownBlock: 0, unquoted: 0, unknownSource: 0, sourceUnquoted: 0,
        noSource: 0, citationRule: 0, perBlock: 0, overCap: 0, duplicate: 0, queriesRefused: 0,
      },
    },
    stale: false,
    outdated: false,
    profileChanged: false,
  };
  const findingRow = () => host.querySelector<HTMLElement>(`.mode-band .where-situate [data-finding="${FINDING_ID}"]`);

  it("is the owner's bare Sources address, and with the switch off offers Search the literature and buys nothing", async () => {
    who.set(OWNER);
    await open("?mode=sources");
    await until(() => dossier()?.querySelector("button") != null, "the dossier's press");
    expect(experimentalSince, "the switch is off").toBeNull();
    expect(situateReads().length).toBeGreaterThan(0);
    expect(dossier()?.textContent).toContain(SITUATE_RUN);
    expect(dossier()?.textContent).not.toMatch(/experimental/i);
    expect(chip("Where it sits")?.getAttribute("aria-checked")).toBe("true");
    expect(trace.filter((r) => r.method === "POST" && r.url === "/api/jobs"), "no job on arrival").toEqual([]);
    expect(chatPosts()).toEqual([]);
  });

  it("goes to a tool and back, and Back and Forward keep one chip checked, buying nothing", async () => {
    who.set(OWNER);
    await open("?mode=sources");
    await until(() => tool("reception") !== null, "Where it sits' tools");
    const checked = () =>
      [...host.querySelectorAll('.mode-band [role="radiogroup"][aria-label="Sources view"] [aria-checked="true"]')].map(
        (b) => (b.getAttribute("aria-label") ?? "").split(",")[0],
      );
    await act(async () => tool("reception")?.click());
    await until(() => param("sources") === "reception", "Reception");
    expect(checked()).toEqual(["Where it sits"]);
    await act(async () => chip("Bibliography")?.click());
    await until(() => param("sources") === "bibliography", "Bibliography");
    expect(checked()).toEqual(["Bibliography"]);
    await act(async () => history.back());
    await until(() => param("sources") === "reception", "Back to Reception");
    expect(checked()).toEqual(["Where it sits"]);
    await act(async () => history.back());
    await until(() => param("sources") === null && dossier() !== null, "Back to Where it sits");
    expect(checked()).toEqual(["Where it sits"]);
    await act(async () => history.forward());
    await until(() => param("sources") === "reception", "Forward to Reception");
    /* The tool's way back is a plain move too. */
    const back = host.querySelector<HTMLButtonElement>(".mode-band .where-back");
    await act(async () => back?.click());
    await until(() => param("sources") === null, "← Where it sits");
    expect(posts().filter((r) => r.url === "/api/jobs"), "no job: Bibliography was already made").toEqual([]);
  });

  it("asks about a finding with the finding's own origin", async () => {
    storedSituate = DOSSIER;
    who.set(OWNER);
    await open("?mode=sources");
    await until(() => findingRow() !== null, "the finding");
    const ask = findingRow()?.querySelector<HTMLButtonElement>("button.situate-ask");
    await act(async () => ask?.click());
    /* `AskInChatButton` reveals, then sends on the second press. */
    if (chatPosts().length === 0) await act(async () => findingRow()?.querySelector<HTMLButtonElement>("button.situate-ask")?.click());
    await until(() => chatPosts().length === 1, "the finding's chat");
    const sent = chatPosts()[0]?.body as { origin: ThreadOrigin };
    expect(sent.origin).toEqual({ mode: "situate", itemId: FINDING_ID, quote: CLAIM_QUOTE });
  });

  it("the way back from a finding's chat opens Where it sits on that finding", async () => {
    storedSituate = DOSSIER;
    const chat: ChatThread = {
      ...structuredClone(STORED),
      id: "spya-fndcht",
      title: "Finding: memories",
      origin: { mode: "situate", itemId: FINDING_ID, quote: CLAIM_QUOTE },
    };
    server = [structuredClone(STORED), chat];
    who.set(OWNER);
    await open(`?mode=chat&thread=${chat.id}`);
    const back = () => host.querySelector<HTMLButtonElement>(".mode-band .chat-origin-back");
    await until(() => back() !== null, "Chat's way back");
    expect(back()?.textContent).toContain("Where it sits");
    await act(async () => back()?.click());
    await until(() => param("mode") === "sources" && findingRow() !== null, "Where it sits, with the finding");
    expect(param("sources"), "the default, left off").toBeNull();
    expect(param("thread"), "the chat does not cover the row").toBeNull();
    expect(chatPosts()).toEqual([]);
  });
});
