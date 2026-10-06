// @vitest-environment jsdom
/**
 * **Ask in chat on a Glossary entry and on a cited work starts a chat that
 * remembers the entry, and the entry shows the way back to it.**
 * Plan docs/plans/261006d-glossary-and-citations-ask-in-chat-with-origin.md
 * (D1, D4, D5, D6) and its review's F1 and F3.
 *
 * The whole app (`App` under `StrictMode`, the real nuqs adapter), for the
 * reason tests/debate-check-claim-in-chat.test.tsx gives and one more: the
 * chat summaries, the sender and the reopening handler travel
 * `Reader` → the owner's band → the panel → the row, and a panel test passes
 * over a prop that one of those never forwarded (F3).
 *
 * What is claimed, for each mode:
 *
 * 1. the press lands in Chat, in a **fresh** conversation, with the fenced
 *    name and a question in the box, and **nothing sent**;
 * 2. Send posts once, and the body carries **exactly** that entry's origin:
 *    its id, and its name cut to the cap;
 * 3. back in the mode the entry has its mark, with the count and the answer's
 *    opening line, though the page was never reloaded;
 * 4. the mark opens that conversation **beside the mode** (`?thread=`);
 * 5. Chat's list says where the conversation was started;
 * 6. a chat started under an older name still marks the entry (matched by id);
 * 7. a visitor's band draws neither the button nor the mark.
 *
 * And for Glossary alone: a term the article never quotes still has the
 * button (Dig deeper is disabled there; a chat needs no passage), and a name
 * longer than the origin's cap is sent cut, not refused.
 *
 * Dig deeper itself is not touched, and neither is the *Ask in chat* the
 * *Look up a term* box offers (tests/glossary-ask-in-chat.test.tsx).
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Article,
  type ChatThread,
  type Citations,
  type Glossary,
  MAX_ORIGIN_NAME_CHARS,
  type ThreadOrigin,
  type ThreadSummary,
} from "../src/types.js";
import type { PublicArticle } from "../src/public-types.js";
import { askAboutCitedWork, askAboutGlossaryEntry } from "../src/web/chat-handoff.js";
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

const SLUG = "a-piece-with-terms";
const PARAGRAPH = "Qualia are the felt quality of an experience, as Dennett disputes.";
const QUOTED = "spya-ttm222";
const UNQUOTED = "spya-ttm333";
const LONG = "spya-ttm444";
const LONG_NAME = `the ${"very ".repeat(70)}long name of a thing`;
const WORK = "spya-c7t2wd";
const BARE_WORK = "spya-c7t2we";
const WORK_TITLE = "Consciousness Explained";

const BLOCKS: PublicArticle["blocks"] = [
  {
    id: "spya-aaaaaa",
    tag: "h1",
    kind: "heading",
    level: 1,
    text: "A piece with terms",
    words: 4,
    html: "<h1>A piece with terms</h1>",
    gistable: false,
  },
  {
    id: "spya-bbbbbb",
    tag: "p",
    kind: "text",
    text: PARAGRAPH,
    words: 11,
    html: `<p>${PARAGRAPH}</p>`,
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
      range: ["spya-aaaaaa", "spya-bbbbbb"],
      title: "A piece with terms",
      gist: "What the piece says.",
    },
  },
};

const GLOSSARY: Glossary = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  entries: [
    {
      id: QUOTED,
      name: "qualia",
      kind: "concept",
      aliases: [],
      senseHere: "The felt quality of an experience.",
      blocks: ["spya-bbbbbb"],
    },
    {
      id: UNQUOTED,
      name: "heterophenomenology",
      kind: "concept",
      aliases: [],
      senseHere: "Named by the list, never used by the piece.",
      blocks: [],
    },
    {
      id: LONG,
      name: LONG_NAME,
      kind: "concept",
      aliases: [],
      senseHere: "A name longer than an origin may store.",
      blocks: ["spya-bbbbbb"],
    },
  ],
  passes: 1,
  generatedAt: "2026-09-01T09:00:00.000Z",
  elapsedMs: 1,
};

const CITATIONS: Citations = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  citations: [
    {
      id: WORK,
      key: "work:consciousness explained|dennett|1991",
      title: WORK_TITLE,
      authors: "Daniel Dennett",
      year: "1991",
      why: "The view the piece argues with.",
      relevance: 0.9,
      influence: 0.9,
      mentions: [{ blockId: "spya-bbbbbb", quote: "as Dennett disputes", start: 46 }],
      citedAt: ["spya-bbbbbb"],
      firstCited: "spya-bbbbbb",
      citedInBody: true,
      url: "https://scholar.google.com/scholar?q=Consciousness+Explained",
      linkFrom: "search",
    },
    {
      id: BARE_WORK,
      key: "work:what is it like to be a bat||",
      title: "What Is It Like to Be a Bat?",
      why: "The question the piece starts from.",
      relevance: 0.8,
      influence: 0.8,
      mentions: [],
      citedAt: ["spya-bbbbbb"],
      firstCited: "spya-bbbbbb",
      citedInBody: true,
      url: "https://scholar.google.com/scholar?q=Bat",
      linkFrom: "search",
    },
  ],
  capped: false,
  generatedAt: "2026-09-01T09:00:00.000Z",
  elapsedMs: 1,
} as Citations;

/** What a visitor is sent: the same lists, in the page's own payload. */
const ARTICLE: PublicArticle = {
  meta: { slug: SLUG, title: "A piece with terms", byline: "Somebody" },
  blocks: BLOCKS,
  tree: TREE,
  comments: [],
  searches: [],
  assets: undefined,
  navLabelStatus: "ready",
  sharedBy: "public",
  glossary: { entries: GLOSSARY.entries },
  citations: { citations: CITATIONS.citations, capped: false },
} as PublicArticle;

const OWNED: Article = {
  highPowerSince: null,
  titleOverridden: false,
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  meta: { slug: SLUG, title: "A piece with terms", url: "https://example.com/terms" },
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

/** A chat started from an entry, as the server would hold it after one answered question. */
function startedFrom(id: string, origin: ThreadOrigin, answer: string): ChatThread {
  const at = "2026-10-06T09:00:00.000Z";
  return {
    id,
    kind: "chat",
    title: "Started earlier",
    createdAt: at,
    updatedAt: at,
    origin,
    messages: [
      { id: "q1", role: "user", text: "What more?", createdAt: at, status: "done" },
      { id: "a1", role: "assistant", text: answer, createdAt: at, status: "done" },
    ],
  };
}

/* ------------------------------------------------------- the fake server -- */

let server: ChatThread[] = [];
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
  const at = new Date(Date.parse("2026-10-06T10:00:00.000Z") + server.length * 1000 + minted * 10).toISOString();
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
      frame("begin", { threadId: body.threadId, title, messageId, questionId, attempt: "att", ...(origin ? { origin } : {}) });
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
  if (url === `/api/chat/${SLUG}` && method === "POST") {
    return answerTurn(body as { threadId: string; question: string; origin?: ThreadOrigin });
  }
  if (method === "POST") return new Response(null, { status: 204 });
  if (url === `/api/chat/${SLUG}?summary=1`) return json({ threads: server.map(summarise) });
  if (url === `/api/chat/${SLUG}`) return json({ threads: server });
  if (url.startsWith("/api/glossary/"))
    return json({ glossary: GLOSSARY, stale: false, outdated: false, profileChanged: false });
  if (url.startsWith("/api/citations/")) return json({ citations: CITATIONS, stale: false, outdated: false });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url === "/api/jobs") return json({ jobs: [] });
  return json({});
}

const { App } = await import("../src/web/App.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");
const activation = await import("../src/web/activation.js");
const { ASK_ENTRY_IN_CHAT, ASK_WORK_IN_CHAT, OPEN_ENTRY_CHAT, OPEN_WORK_CHAT } = await import(
  "../src/web/OriginChat.js"
);

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
const composer = (): HTMLTextAreaElement | null =>
  host.querySelector<HTMLTextAreaElement>(".mode-band textarea.chat-input");
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>(".chat-dialog");
const marks = () => [...host.querySelectorAll<HTMLButtonElement>(".mode-band button.origin-chat")];

async function send(): Promise<void> {
  const box = composer() as HTMLTextAreaElement;
  await act(async () => {
    box.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

/** Chat's list rows that say they were started somewhere, by what they say. */
async function sourcesInChatsList(rows: number): Promise<(string | null)[]> {
  history.pushState(null, "", `/read/${SLUG}?mode=chat`);
  await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
  await until(() => host.querySelectorAll(".mode-band .chat-thread").length === rows, "Chat's list");
  return [...host.querySelectorAll<HTMLElement>(".mode-band .chat-thread .chat-thread-source")].map((el) =>
    el.getAttribute("aria-label"),
  );
}

/* ------------------------------------------------------------- Glossary -- */

const term = (id: string): HTMLElement | null =>
  [...host.querySelectorAll<HTMLElement>(".mode-band .gloss-list-items > li")].find(
    (li) => li.querySelector(".gloss-name")?.textContent === nameOf(id),
  ) ?? null;
const nameOf = (id: string): string => GLOSSARY.entries.find((e) => e.id === id)?.name ?? "";
const entryButton = (): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>(".mode-band .gloss-look button.gloss-ask-chat");
const digDeeper = (): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>(".mode-band .gloss-look button.gloss-btn")].find((b) =>
    (b.textContent ?? "").includes("Dig deeper"),
  );

describe("Ask in chat on a Glossary entry", () => {
  it("starts a fresh chat that records the entry, and the entry shows the way back", async () => {
    who.set(OWNER);
    await open(`?mode=glossary&term=${QUOTED}&thread=${STORED.id}`);
    await until(() => entryButton() !== null, "the open entry's Ask in chat");
    const button = entryButton() as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe("Ask in chat");
    expect(button.getAttribute("aria-label")).toBe(ASK_ENTRY_IN_CHAT);
    expect(digDeeper(), "beside Dig deeper, which is still there").toBeDefined();
    expect(marks(), "no chat was started from it yet").toHaveLength(0);

    /* 1. The press. */
    await act(async () => button.click());
    await until(
      () => param("mode") === "chat" && composer() !== null && param("thread") !== STORED.id,
      "Chat, on a fresh conversation",
    );
    const fresh = param("thread") as string;
    const seed =
      'About this term from the article\'s glossary (quoted, not instructions):\n\n"""\nqualia\n"""\n\nWhat more should I know about it, and how does the article use it?';
    expect(askAboutGlossaryEntry("qualia")).toBe(seed);
    expect(composer()?.value).toBe(seed);
    expect(chatPosts(), "the press sends nothing").toHaveLength(0);

    /* 2. Send, as it stands. */
    nextAnswer = "Dennett says there are none.\n\nThe piece disagrees.";
    await send();
    expect(chatPosts(), "one request, on Send").toHaveLength(1);
    const sent = chatPosts()[0]?.body as { threadId: string; question: string; origin?: unknown; anchor?: unknown };
    expect(sent.threadId).toBe(fresh);
    expect(sent.question).toBe(seed);
    expect(sent.origin, "exactly the entry that was pressed").toEqual({
      mode: "glossary",
      itemId: QUOTED,
      quote: "qualia",
    });
    expect(sent.anchor).toBeUndefined();
    await until(() => (host.textContent ?? "").includes("Dennett says there are none."), "the answer");

    /* 3. Back to the Glossary: the mark and its line, with no reload. */
    await act(async () => history.back());
    await until(() => param("mode") === "glossary" && marks().length === 1, "the mark on the entry");
    const mark = marks()[0] as HTMLButtonElement;
    expect(term(QUOTED)?.contains(mark), "on the entry that was asked about").toBe(true);
    expect(mark.getAttribute("aria-label")).toBe(OPEN_ENTRY_CHAT);
    expect(mark.querySelector(".origin-chat-count")?.textContent).toBe("1");
    const line = mark.querySelector(".origin-chat-line");
    expect(line?.textContent).toBe("Dennett says there are none.");
    expect(line?.classList.contains("voice-ai"), "a model's words, in the model's face").toBe(true);
    expect(entryButton(), "and the button stays, for a second chat").not.toBeNull();

    /* 4. The mark opens the conversation beside the Glossary. */
    await act(async () => mark.click());
    await until(() => param("thread") === fresh && dialog() !== null, "the conversation beside the Glossary");
    expect(param("mode")).toBe("glossary");
    await until(() => (dialog()?.textContent ?? "").includes("Dennett says there are none."), "its transcript");

    /* 5. Chat's list says where it was started. */
    await act(async () => dialog()?.querySelector<HTMLButtonElement>(".chat-dialog-close")?.click());
    await until(() => param("thread") === null, "the dialog to close");
    expect(await sourcesInChatsList(2)).toEqual(["Started from a glossary entry"]);
  });

  it("still marks an entry whose chat was started under an older name, and not its neighbours", async () => {
    who.set(OWNER);
    server.push(
      startedFrom("spya-srvz22", { mode: "glossary", itemId: QUOTED, quote: "the raw feels" }, "An older answer."),
      /* The same id under the other mode is a cited work's chat, not this entry's. */
      startedFrom("spya-srvy22", { mode: "citations", itemId: UNQUOTED, quote: "A work" }, "Not the term's."),
    );
    await open(`?mode=glossary&term=${QUOTED}`);
    await until(() => marks().length === 1, "the mark");
    expect(marks()[0]?.querySelector(".origin-chat-line")?.textContent).toBe("An older answer.");
    await act(async () => marks()[0]?.click());
    await until(() => param("thread") === "spya-srvz22", "that conversation");

    history.pushState(null, "", `/read/${SLUG}?mode=glossary&term=${UNQUOTED}`);
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await until(() => term(UNQUOTED)?.querySelector(".gloss-ask-chat") != null, "the other entry");
    expect(marks(), "the other entry has no chat of its own").toHaveLength(0);
  });

  it("offers it on a term the article never quotes, where Dig deeper cannot run", async () => {
    who.set(OWNER);
    await open(`?mode=glossary&term=${UNQUOTED}`);
    await until(() => entryButton() !== null, "the entry's Ask in chat");
    expect(digDeeper()?.disabled, "Dig deeper needs a passage").toBe(true);
    expect(entryButton()?.disabled, "a chat does not").toBe(false);
    await act(async () => entryButton()?.click());
    await until(() => param("mode") === "chat" && composer() !== null, "Chat");
    expect(composer()?.value).toBe(askAboutGlossaryEntry("heterophenomenology"));
  });

  it("sends a name longer than the cap cut to it, and still quotes the whole name", async () => {
    who.set(OWNER);
    expect(LONG_NAME.length).toBeGreaterThan(MAX_ORIGIN_NAME_CHARS);
    await open(`?mode=glossary&term=${LONG}`);
    await until(() => entryButton() !== null, "the entry's Ask in chat");
    await act(async () => entryButton()?.click());
    await until(() => param("mode") === "chat" && composer() !== null, "Chat");
    expect(composer()?.value).toContain(LONG_NAME);
    nextAnswer = "A long answer.";
    await send();
    const sent = chatPosts()[0]?.body as { origin?: { mode: string; itemId: string; quote: string } };
    expect(sent.origin?.mode).toBe("glossary");
    expect(sent.origin?.itemId).toBe(LONG);
    expect(sent.origin?.quote.length).toBeLessThanOrEqual(MAX_ORIGIN_NAME_CHARS);
    expect(LONG_NAME.startsWith(sent.origin?.quote ?? "\u0000")).toBe(true);
  });

  it("draws neither the button nor the mark for a visitor", async () => {
    await open(`?mode=glossary&term=${QUOTED}`);
    await until(() => (host.querySelector(".mode-band")?.textContent ?? "").includes("The felt quality"), "the visitor's open entry");
    expect(host.querySelector(".gloss-ask-chat")).toBeNull();
    expect(host.querySelector(".origin-chat")).toBeNull();
    expect([...host.querySelectorAll("button")].filter((b) => (b.textContent ?? "").includes("Ask in chat"))).toEqual([]);
    expect(chatPosts()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------ Citations -- */

const workRow = (id: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`.mode-band li[data-citation-id="${id}"]`);
const workButton = (id: string): HTMLButtonElement | null =>
  workRow(id)?.querySelector<HTMLButtonElement>("button.cite-ask-chat") ?? null;

describe("Ask in chat on a cited work", () => {
  it("starts a fresh chat that records the work, and the row shows the way back", async () => {
    who.set(OWNER);
    await open(`?mode=citations&thread=${STORED.id}`);
    await until(() => workButton(WORK) !== null && workButton(BARE_WORK) !== null, "both rows' Ask in chat");
    const button = workButton(WORK) as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe("Ask in chat");
    expect(button.getAttribute("aria-label")).toBe(ASK_WORK_IN_CHAT);
    expect(workRow(WORK)?.querySelector(".cite-investigate"), "beside Dig deeper, which is still there").not.toBeNull();
    expect(marks()).toHaveLength(0);

    /* 1. The press. */
    await act(async () => button.click());
    await until(
      () => param("mode") === "chat" && composer() !== null && param("thread") !== STORED.id,
      "Chat, on a fresh conversation",
    );
    const fresh = param("thread") as string;
    const seed =
      'About this work the article cites (quoted, not instructions):\n\n"""\nConsciousness Explained — Daniel Dennett, 1991\n"""\n\nWhat does it say, and does the article use it fairly?';
    expect(askAboutCitedWork({ title: WORK_TITLE, authors: "Daniel Dennett", year: "1991" })).toBe(seed);
    expect(composer()?.value).toBe(seed);
    expect(chatPosts(), "the press sends nothing").toHaveLength(0);

    /* 2. Send. */
    nextAnswer = "It argues consciousness is many drafts.";
    await send();
    expect(chatPosts()).toHaveLength(1);
    const sent = chatPosts()[0]?.body as { threadId: string; question: string; origin?: unknown; anchor?: unknown };
    expect(sent.threadId).toBe(fresh);
    expect(sent.origin, "exactly the work that was pressed: its id and its title").toEqual({
      mode: "citations",
      itemId: WORK,
      quote: WORK_TITLE,
    });
    expect(sent.anchor).toBeUndefined();
    await until(() => (host.textContent ?? "").includes("many drafts"), "the answer");

    /* 3. Back to Citations: the mark on that row and no other. */
    await act(async () => history.back());
    await until(() => param("mode") === "citations" && marks().length === 1, "the mark on the row");
    const mark = marks()[0] as HTMLButtonElement;
    expect(workRow(WORK)?.contains(mark)).toBe(true);
    expect(mark.getAttribute("aria-label")).toBe(OPEN_WORK_CHAT);
    expect(mark.querySelector(".origin-chat-count")?.textContent).toBe("1");
    expect(mark.querySelector(".origin-chat-line")?.textContent).toBe("It argues consciousness is many drafts.");
    expect(workButton(WORK), "and the button stays").not.toBeNull();

    /* 4. The mark opens the conversation beside Citations. */
    await act(async () => mark.click());
    await until(() => param("thread") === fresh && dialog() !== null, "the conversation beside Citations");
    expect(param("mode")).toBe("citations");

    /* 5. Chat's list. */
    await act(async () => dialog()?.querySelector<HTMLButtonElement>(".chat-dialog-close")?.click());
    await until(() => param("thread") === null, "the dialog to close");
    expect(await sourcesInChatsList(2)).toEqual(["Started from a cited work"]);
  });

  it("quotes a work with no authors or year by its title alone", async () => {
    who.set(OWNER);
    await open("?mode=citations");
    await until(() => workButton(BARE_WORK) !== null, "the row's Ask in chat");
    await act(async () => workButton(BARE_WORK)?.click());
    await until(() => param("mode") === "chat" && composer() !== null, "Chat");
    expect(composer()?.value).toContain('"""\nWhat Is It Like to Be a Bat?\n"""');
  });

  it("still marks a work whose chat was started under an older title", async () => {
    who.set(OWNER);
    server.push(
      startedFrom("spya-srvz22", { mode: "citations", itemId: WORK, quote: "Consciousness explained (1st ed.)" }, "An older answer."),
      startedFrom("spya-srvy22", { mode: "glossary", itemId: BARE_WORK, quote: "a term" }, "Not the work's."),
    );
    await open("?mode=citations");
    await until(() => marks().length === 1, "the mark");
    expect(workRow(WORK)?.contains(marks()[0] as HTMLButtonElement)).toBe(true);
    expect(workRow(BARE_WORK)?.querySelector(".origin-chat")).toBeNull();
  });

  it("draws neither the button nor the mark for a visitor", async () => {
    await open("?mode=citations");
    await until(() => workRow(WORK) !== null, "the visitor's rows");
    expect(host.querySelector(".cite-ask-chat")).toBeNull();
    expect(host.querySelector(".origin-chat")).toBeNull();
    expect([...host.querySelectorAll("button")].filter((b) => (b.textContent ?? "").includes("Ask in chat"))).toEqual([]);
    expect(chatPosts()).toHaveLength(0);
  });
});
