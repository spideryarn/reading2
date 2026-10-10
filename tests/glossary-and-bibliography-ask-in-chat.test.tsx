// @vitest-environment jsdom
/**
 * **Ask in chat on a Glossary entry and on a cited work starts a chat that
 * remembers the entry, and the entry shows the way back to it.**
 * Plan docs/plans/261006d-glossary-and-citations-ask-in-chat-with-origin.md
 * (D1, D4, D5, D6) and its review's F1 and F3.
 *
 * The whole app (`App` under `StrictMode`, the real nuqs adapter), for the
 * reason tests/sources-claim-check-in-chat.test.tsx gives and one more: the
 * chat summaries, the sender and the reopening handler travel
 * `Reader` → the owner's band → the panel → the row, and a panel test passes
 * over a prop that one of those never forwarded (F3).
 *
 * **The press is the Send**, since 2026-10-06. Greg, in report spya-x896vu:
 * *"When I click "ask in Chat" anywhere, automatically submit the input
 * (rather than just prefilling the input box and waiting for me to hit
 * send)"*. Until then the question waited in Chat's box for a second press.
 * docs/plans/261006j-ask-in-chat-sends-the-question.md.
 *
 * What is claimed, for each mode:
 *
 * 1. the press lands in Chat, in a **fresh** conversation, and **sends the
 *    fenced name and its question once**, leaving Chat's box empty;
 * 2. that one request carries **exactly** that entry's origin: its id, and
 *    its name cut to the cap;
 * 3. back in the mode the entry has its mark, with the count and the answer's
 *    opening line, though the page was never reloaded;
 * 4. the mark opens that conversation **beside the mode** (`?thread=`);
 * 5. Chat's list says where the conversation was started;
 * 6. a chat started under an older name still marks the entry (matched by id);
 * 7. a visitor's band draws neither the button nor the mark.
 *
 * And for Glossary alone: a term the article never quotes still has the
 * button (a chat needs no passage), and a name longer than the origin's cap
 * is sent cut, not refused.
 *
 * **Ideas joined them on 2026-10-09** (plan 261009k, stage 3), with the same
 * seven claims, and so did **the way back from the chat** (stage 2): the line
 * above an open chat's transcript that opens the item's mode on the item —
 * for every origin, Debate's claim and angle included.
 *
 * **Since 2026-10-09 the button stands where Dig deeper was** (plan 261009k):
 * no entry and no row offers Dig deeper, and that is pinned here in the
 * rendered reader too. The *Ask in chat* the *Look up a term* box offers is
 * not touched (tests/glossary-ask-in-chat.test.tsx).
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Article,
  type ChatThread,
  type Bibliography,
  type Reception,
  type Glossary,
  type Ideas,
  MAX_ORIGIN_NAME_CHARS,
  type ThreadOrigin,
  type ThreadSummary,
} from "../src/types.js";
import type { PublicArticle } from "../src/public-types.js";
import { askAboutCitedWork, askAboutGlossaryEntry, askAboutIdea } from "../src/web/chat-handoff.js";
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

const BIBLIOGRAPHY: Bibliography = {
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
} as Bibliography;

/* The id alphabet has no `i`, `l`, `o` or `1`, so `?idea=` would refuse an
   id spelled with one. */
const IDEA = "spya-dea222";
const OTHER_IDEA = "spya-dea333";
const IDEA_NAME = "Experience has a felt quality";
const IDEA_STATEMENT = "There is something it is like to have an experience.";

const IDEAS: Ideas = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  ideas: [
    {
      id: IDEA,
      name: IDEA_NAME,
      provenance: "assumed",
      statement: IDEA_STATEMENT,
      occurrences: [
        { blockId: "spya-bbbbbb", quote: "the felt quality of an experience", reasoning: "It names it.", start: 11 },
      ],
    },
    {
      id: OTHER_IDEA,
      name: "Dennett disputes qualia",
      provenance: "introduced",
      statement: "The piece sets itself against Dennett.",
      occurrences: [{ blockId: "spya-bbbbbb", quote: "as Dennett disputes", reasoning: "It says so.", start: 46 }],
    },
  ],
  generatedAt: "2026-09-01T09:00:00.000Z",
  elapsedMs: 1,
} as Ideas;

/* One of Debate's claims, from an older search's rows (the legacy list), and
   the counts that search would have stored. */
const CLAIM_QUOTE = "Qualia are the felt quality of an experience";
const RECEPTION_COUNTS = {
  returnedSources: 1,
  reportedRows: 1,
  keptRows: 1,
  omittedOverCap: 0,
  webSearches: 1,
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
  direct: { rows: [], counts: RECEPTION_COUNTS },
  claims: {
    rows: [
      {
        id: "spya-c7w2d2",
        claimQuote: CLAIM_QUOTE,
        blockId: "spya-bbbbbb",
        title: "A reply",
        url: "https://example.org/reply",
        sourceQuote: "A response to the claim.",
        relation: "qualifies",
        lean: "neither",
        applies: "It qualifies the claim.",
        bears: "directly",
      },
    ],
    counts: RECEPTION_COUNTS,
  },
} as Reception;

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
  bibliography: { citations: BIBLIOGRAPHY.citations, capped: false },
  ideas: { ideas: IDEAS.ideas },
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
let refuseNextSend = false;
/** When set, the summaries are this list and not the server's: a re-read that has not caught up yet. */
let frozenSummaries: ChatThread[] | null = null;
let bibliographyMayReply: Promise<void> | null = null;
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
    if (refuseNextSend) {
      refuseNextSend = false;
      return json({ error: "Send refused for this test" }, 400);
    }
    return answerTurn(body as { threadId: string; question: string; origin?: ThreadOrigin });
  }
  if (method === "POST") return new Response(null, { status: 204 });
  if (url === `/api/chat/${SLUG}?summary=1`) return json({ threads: (frozenSummaries ?? server).map(summarise) });
  if (url === `/api/chat/${SLUG}`) return json({ threads: server });
  if (url.startsWith("/api/glossary/"))
    return json({ glossary: GLOSSARY, stale: false, outdated: false, profileChanged: false });
  if (url.startsWith("/api/bibliography/")) return json({ bibliography: BIBLIOGRAPHY, stale: false, outdated: false });
  if (url.startsWith("/api/ideas/"))
    return json({ ideas: IDEAS, stale: false, outdated: false, profileChanged: false });
  if (url === `/api/reception/${SLUG}`) return json({ reception: RECEPTION, stale: false, outdated: false });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url === "/api/jobs") return json({ jobs: [] });
  return json({});
}

const { App } = await import("../src/web/App.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");
const activation = await import("../src/web/activation.js");
const { ASK_ENTRY_IN_CHAT, ASK_IDEA_IN_CHAT, ASK_WORK_IN_CHAT, OPEN_ENTRY_CHAT, OPEN_IDEA_CHAT, OPEN_WORK_CHAT } =
  await import("../src/web/OriginChat.js");

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
  refuseNextSend = false;
  frozenSummaries = null;
  bibliographyMayReply = null;
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
    if (url.startsWith("/api/bibliography/") && bibliographyMayReply !== null) {
      return bibliographyMayReply.then(() => reply(url, method, body));
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
const composer = (): HTMLTextAreaElement | null =>
  host.querySelector<HTMLTextAreaElement>(".mode-band textarea.chat-input");
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>(".chat-dialog");
const marks = () => [...host.querySelectorAll<HTMLButtonElement>(".mode-band button.origin-chat")];

async function tap(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(down, "pointerType", { value: "touch" });
    button.dispatchEvent(down);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
    Object.defineProperty(click, "pointerType", { value: "touch" });
    button.dispatchEvent(click);
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
/** Any Dig deeper left in the band — none since plan 261009k. */
const digDeeper = (): HTMLButtonElement[] =>
  [...host.querySelectorAll<HTMLButtonElement>(".mode-band button")].filter((b) =>
    /Dig deeper|Digging deeper/.test(b.textContent ?? ""),
  );

describe("Ask in chat on a Glossary entry", () => {
  it("lets a finger read the icon's card before a second tap sends", async () => {
    who.set(OWNER);
    await open(`?mode=glossary&term=${QUOTED}`);
    await until(() => entryButton() !== null, "the open entry's Ask in chat");
    const button = entryButton() as HTMLButtonElement;
    await tap(button);
    expect(param("mode"), "the first tap only reveals").toBe("glossary");
    expect(chatPosts()).toHaveLength(0);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("Tap again to do it.");
    await tap(button);
    await until(() => param("mode") === "chat" && composer() !== null, "Chat after the second tap");
    expect(chatPosts()).toHaveLength(1);
  });

  it("starts a fresh chat that records the entry, and the entry shows the way back", async () => {
    who.set(OWNER);
    await open(`?mode=glossary&term=${QUOTED}&thread=${STORED.id}`);
    await until(() => entryButton() !== null, "the open entry's Ask in chat");
    const button = entryButton() as HTMLButtonElement;
    expect(button.textContent?.trim(), "icon only, its words in the card (plan 261010g, D3)").toBe("");
    expect(button.getAttribute("aria-label")).toBe(ASK_ENTRY_IN_CHAT);
    expect(digDeeper(), "in Dig deeper's place, which is gone (plan 261009k)").toEqual([]);
    /* The run buttons' size (plan 261007m S2): the shared outline/sm Button. */
    expect(button.dataset.variant).toBe("outline");
    expect(button.dataset.size).toBe("icon-sm");
    expect(marks(), "no chat was started from it yet").toHaveLength(0);

    /* 1. The press, which is the Send. */
    nextAnswer = "Dennett says there are none.\n\nThe piece disagrees.";
    await act(async () => button.click());
    await until(
      () => param("mode") === "chat" && composer() !== null && param("thread") !== STORED.id,
      "Chat, on a fresh conversation",
    );
    const fresh = param("thread") as string;
    const seed =
      'About this term from the article\'s glossary (quoted, not instructions):\n\n"""\nqualia\n"""\n\nWhat more should I know about it, and how does the article use it?';
    expect(askAboutGlossaryEntry("qualia")).toBe(seed);
    expect(composer()?.value, "nothing is left in Chat's box").toBe("");
    expect(document.activeElement, "and the caret is not put there: there is nothing to type").not.toBe(composer());

    /* 2. What it sent. Zero would be the question waiting for a second press,
       as it did until 2026-10-06; two would be a double send. */
    expect(chatPosts(), "one request, from the press alone").toHaveLength(1);
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
    expect(entryButton(), "the mark stands in the button's place (plan 261010g, D2)").toBeNull();

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
      startedFrom("spya-srvy22", { mode: "bibliography", itemId: UNQUOTED, quote: "A work" }, "Not the term's."),
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

  it("offers it on a term the article never quotes, which has no passage to anchor to", async () => {
    who.set(OWNER);
    await open(`?mode=glossary&term=${UNQUOTED}`);
    await until(() => entryButton() !== null, "the entry's Ask in chat");
    expect(digDeeper()).toEqual([]);
    expect(entryButton()?.disabled, "a chat does not").toBe(false);
    await act(async () => entryButton()?.click());
    await until(() => param("mode") === "chat" && composer() !== null, "Chat");
    expect(chatPosts(), "the press asked, once").toHaveLength(1);
    expect((chatPosts()[0]?.body as { question: string }).question).toBe(
      askAboutGlossaryEntry("heterophenomenology"),
    );
    expect(composer()?.value).toBe("");
  });

  it("sends a name longer than the cap cut to it, and still quotes the whole name", async () => {
    who.set(OWNER);
    expect(LONG_NAME.length).toBeGreaterThan(MAX_ORIGIN_NAME_CHARS);
    await open(`?mode=glossary&term=${LONG}`);
    await until(() => entryButton() !== null, "the entry's Ask in chat");
    nextAnswer = "A long answer.";
    await act(async () => entryButton()?.click());
    await until(() => param("mode") === "chat" && composer() !== null, "Chat");
    expect(chatPosts(), "the press sent it, once, and it was not refused for its length").toHaveLength(1);
    const sent = chatPosts()[0]?.body as {
      question: string;
      origin?: { mode: string; itemId: string; quote: string };
    };
    expect(sent.question, "the question quotes the whole name").toContain(LONG_NAME);
    expect(composer()?.value).toBe("");
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
    await open(`?mode=sources&thread=${STORED.id}`);
    await until(() => workButton(WORK) !== null && workButton(BARE_WORK) !== null, "both rows' Ask in chat");
    const button = workButton(WORK) as HTMLButtonElement;
    expect(button.textContent?.trim(), "icon only, its words in the card (plan 261010g, D3)").toBe("");
    expect(button.getAttribute("aria-label")).toBe(ASK_WORK_IN_CHAT);
    expect(workRow(WORK)?.querySelector(".cite-investigate"), "in Dig deeper's place, which is gone").toBeNull();
    expect(digDeeper()).toEqual([]);
    /* The same size as Glossary's (plan 261007m S2). */
    expect(button.dataset.variant).toBe("outline");
    expect(button.dataset.size).toBe("icon-sm");
    expect(marks()).toHaveLength(0);

    /* 1. The press, which is the Send. */
    nextAnswer = "It argues consciousness is many drafts.";
    await act(async () => button.click());
    await until(
      () => param("mode") === "chat" && composer() !== null && param("thread") !== STORED.id,
      "Chat, on a fresh conversation",
    );
    const fresh = param("thread") as string;
    const seed =
      'About this work the article cites (quoted, not instructions):\n\n"""\nConsciousness Explained — Daniel Dennett, 1991\n"""\n\nWhat does it say, and does the article use it fairly?';
    expect(askAboutCitedWork({ title: WORK_TITLE, authors: "Daniel Dennett", year: "1991" })).toBe(seed);
    expect(composer()?.value, "nothing is left in Chat's box").toBe("");
    expect(document.activeElement, "and the caret is not put there: there is nothing to type").not.toBe(composer());

    /* 2. What it sent. Zero would be the question waiting for a second press,
       as it did until 2026-10-06; two would be a double send. */
    expect(chatPosts(), "one request, from the press alone").toHaveLength(1);
    const sent = chatPosts()[0]?.body as { threadId: string; question: string; origin?: unknown; anchor?: unknown };
    expect(sent.threadId).toBe(fresh);
    expect(sent.question).toBe(seed);
    expect(sent.origin, "exactly the work that was pressed: its id and its title").toEqual({
      mode: "bibliography",
      itemId: WORK,
      quote: WORK_TITLE,
    });
    expect(sent.anchor).toBeUndefined();
    await until(() => (host.textContent ?? "").includes("many drafts"), "the answer");

    /* 3. Back to Citations: the mark on that row and no other. */
    await act(async () => history.back());
    await until(() => param("mode") === "sources" && marks().length === 1, "the mark on the row");
    const mark = marks()[0] as HTMLButtonElement;
    expect(workRow(WORK)?.contains(mark)).toBe(true);
    expect(mark.getAttribute("aria-label")).toBe(OPEN_WORK_CHAT);
    expect(mark.querySelector(".origin-chat-count")?.textContent).toBe("1");
    expect(mark.querySelector(".origin-chat-line")?.textContent).toBe("It argues consciousness is many drafts.");
    expect(workButton(WORK), "the mark stands in the button's place (plan 261010g, D2)").toBeNull();

    /* 4. The mark opens the conversation beside Citations. */
    await act(async () => mark.click());
    await until(() => param("thread") === fresh && dialog() !== null, "the conversation beside Citations");
    expect(param("mode")).toBe("sources");

    /* 5. Chat's list. */
    await act(async () => dialog()?.querySelector<HTMLButtonElement>(".chat-dialog-close")?.click());
    await until(() => param("thread") === null, "the dialog to close");
    expect(await sourcesInChatsList(2)).toEqual(["Started from a cited work in Sources › Bibliography"]);
  });

  it("quotes a work with no authors or year by its title alone", async () => {
    who.set(OWNER);
    await open("?mode=sources");
    await until(() => workButton(BARE_WORK) !== null, "the row's Ask in chat");
    await act(async () => workButton(BARE_WORK)?.click());
    await until(() => param("mode") === "chat" && composer() !== null, "Chat");
    expect(chatPosts(), "the press asked, once").toHaveLength(1);
    expect((chatPosts()[0]?.body as { question: string }).question).toContain(
      '"""\nWhat Is It Like to Be a Bat?\n"""',
    );
    expect(composer()?.value).toBe("");
  });

  it("still marks a work whose chat was started under an older title", async () => {
    who.set(OWNER);
    server.push(
      startedFrom("spya-srvz22", { mode: "bibliography", itemId: WORK, quote: "Consciousness explained (1st ed.)" }, "An older answer."),
      startedFrom("spya-srvy22", { mode: "glossary", itemId: BARE_WORK, quote: "a term" }, "Not the work's."),
    );
    await open("?mode=sources");
    await until(() => marks().length === 1, "the mark");
    expect(workRow(WORK)?.contains(marks()[0] as HTMLButtonElement)).toBe(true);
    expect(workRow(BARE_WORK)?.querySelector(".origin-chat")).toBeNull();
  });

  it("draws neither the button nor the mark for a visitor", async () => {
    await open("?mode=sources");
    await until(() => workRow(WORK) !== null, "the visitor's rows");
    expect(host.querySelector(".cite-ask-chat")).toBeNull();
    expect(host.querySelector(".origin-chat")).toBeNull();
    expect([...host.querySelectorAll("button")].filter((b) => (b.textContent ?? "").includes("Ask in chat"))).toEqual([]);
    expect(chatPosts()).toHaveLength(0);
  });
});

describe.each(["glossary", "bibliography", "ideas"] as const)("a %s entry's chat across visits", (mode) => {
  const itemId = { glossary: QUOTED, bibliography: WORK, ideas: IDEA }[mode];
  const quote = { glossary: "qualia", bibliography: WORK_TITLE, ideas: IDEA_NAME }[mode];
  const origin = { mode, itemId, quote };
  /* Bibliography is Sources' Bibliography since 2026-10-09 (plan 261009l). */
  const word = (m: "chat" | typeof mode) => (m === "bibliography" ? "sources" : m);
  const search = `?mode=${word(mode)}${{ glossary: `&term=${QUOTED}`, bibliography: "", ideas: `&idea=${IDEA}` }[mode]}`;
  const button = () => ({ glossary: entryButton, bibliography: () => workButton(WORK), ideas: ideaButton })[mode]();

  async function visit(next: "chat" | "glossary" | "bibliography" | "ideas"): Promise<void> {
    const params = new URLSearchParams(location.search);
    params.set("mode", word(next));
    if (next !== "chat") params.delete("thread");
    history.pushState(null, "", `/read/${SLUG}?${params}`);
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await until(() => param("mode") === word(next), `the ${next} mode`);
  }

  /** Press Ask in chat, which sends the question (set `nextAnswer` first). */
  async function start(): Promise<string> {
    await until(() => button() !== null, "Ask in chat");
    await act(async () => button()?.click());
    await until(() => param("mode") === "chat" && composer() !== null, "the new chat");
    return param("thread") as string;
  }

  /* Until 2026-10-06 this test held that the UNSENT question and its origin
     were kept while Chat was left and reopened. The press sends now, so there
     is no unsent question from these buttons; what is left to hold is that
     one press stays one request across the same journey. The unsent-origin
     machinery itself is tests/conversation-band-origin.test.tsx's. */
  it("sends the question and its origin once, and does not send or refill it when Chat is left and reopened", async () => {
    who.set(OWNER);
    await open(search);
    nextAnswer = "The one question's answer.";
    const firstId = await start();
    /* Zero here is the old behaviour (waiting for Send); two is a double send. */
    expect(chatPosts(), "the press sent it, once").toHaveLength(1);
    const sent = chatPosts()[0]?.body as { threadId: string; origin?: unknown } | undefined;
    expect(sent?.threadId).toBe(firstId);
    expect(sent?.origin).toEqual(origin);
    expect(composer()?.value).toBe("");
    await visit(mode);
    await until(() => marks().length === 1, "the chat's mark");
    expect(marks()[0]?.querySelector(".origin-chat-line")?.textContent).toBe(nextAnswer);
    await visit("chat");
    await until(
      () => host.querySelector(".mode-band .chat-thread, .mode-band textarea.chat-input") !== null,
      "Chat again",
    );
    expect(chatPosts(), "coming back does not send it a second time").toHaveLength(1);
    expect(server.filter((t) => t.origin?.mode === mode), "and starts no second conversation").toHaveLength(1);
    for (const box of host.querySelectorAll<HTMLTextAreaElement>(".mode-band textarea.chat-input")) {
      expect(box.value, "nor put the question back in a box").toBe("");
    }
  });

  /* The first Send is the press itself. */
  it("forgets a refused handoff, so pressing the item again starts a real chat", async () => {
    who.set(OWNER);
    await open(search);
    refuseNextSend = true;
    const firstId = await start();
    await until(() => (host.textContent ?? "").includes("Send refused for this test"), "the refusal");
    expect(chatPosts(), "the press made the one request that was refused").toHaveLength(1);
    expect(server).toHaveLength(1);
    await visit(mode);
    expect(marks()).toHaveLength(0);
    await until(() => button() !== null, "Ask in chat again");
    nextAnswer = "The retried question's answer.";
    await act(async () => button()?.click());
    await until(() => param("mode") === "chat" && param("thread") !== firstId, "a new conversation");
    const retriedId = param("thread") as string;
    expect(chatPosts()).toHaveLength(2);
    expect(chatPosts().map((r) => (r.body as { origin?: unknown }).origin)).toEqual([origin, origin]);
    expect(server.find((t) => t.id === retriedId)?.origin).toEqual(origin);
    await visit(mode);
    await until(() => marks().length === 1, "the retried chat's mark");
    await act(async () => marks()[0]?.click());
    await until(() => param("thread") === retriedId && dialog() !== null, "the retried conversation");
  });

  /* Until plan 261010g this held the opposite: a second press started a
     second chat. Greg, spya-pdpnjf: *"I'm 99% sure it somehow created a new
     chat rather than resuming the existing one for that citation."* */
  it("has one chat: once there is one, the mark stands in the button's place and reopens it", async () => {
    who.set(OWNER);
    await open(search);
    nextAnswer = "The first conversation.";
    const firstId = await start();
    await visit(mode);
    await until(() => marks().length === 1, "the first mark");
    expect(button(), "no second Ask in chat beside the mark").toBeNull();
    await act(async () => marks()[0]?.click());
    await until(() => param("thread") === firstId && dialog() !== null, "the first conversation");
    expect(chatPosts(), "reopening sends nothing").toHaveLength(1);
    expect(server.filter((t) => t.origin?.mode === mode)).toHaveLength(1);
  });
});

describe("a prose hover card's Ask in chat, on an item that already has a chat", () => {
  const card = async (selector: string, ask: string): Promise<HTMLButtonElement> => {
    await until(() => host.querySelector(selector) !== null, `the mark ${selector}`);
    await act(async () => {
      const event = new MouseEvent("pointerover", { bubbles: true, clientX: 10, clientY: 10 });
      Object.defineProperty(event, "pointerType", { value: "mouse" });
      host.querySelector(selector)?.dispatchEvent(event);
    });
    await until(() => document.querySelector(ask) !== null, `the card's ${ask}`);
    return document.querySelector<HTMLButtonElement>(ask) as HTMLButtonElement;
  };

  it.each([
    ["glossary", "?mode=glossary", `.prose mark.term`, ".prose-card-term-ask"],
    ["bibliography", "?mode=sources", `.prose mark.cite`, ".prose-card-cite-ask"],
  ] as const)("reopens the %s item's chat and sends nothing", async (mode, search, mark, ask) => {
    who.set(OWNER);
    const itemId = mode === "glossary" ? QUOTED : WORK;
    const quote = mode === "glossary" ? "qualia" : WORK_TITLE;
    server.push(startedFrom("spya-srvx33", { mode, itemId, quote }, "The earlier answer."));
    await open(search);
    const button = await card(mark, ask);
    expect(button.textContent?.trim(), "icon only (plan 261010g, D3)").toBe("");
    await act(async () => button.click());
    await until(() => param("thread") === "spya-srvx33" && dialog() !== null, "the earlier conversation");
    expect(chatPosts(), "no new question").toHaveLength(0);
    expect(server.filter((t) => t.origin?.mode === mode), "and no second chat").toHaveLength(1);
  });

  /* GPT Sol's F1 on plan 261010g: still in Chat, the summaries have not been
     re-read since the first press, so only the band's report of the thread it
     began can say the work has a chat. */
  it("reopens a chat begun moments ago, before the summaries have heard of it", async () => {
    who.set(OWNER);
    await open("?mode=sources");
    await until(() => workButton(WORK) !== null, "the row's Ask in chat");
    frozenSummaries = structuredClone(server);
    nextAnswer = "The first answer.";
    await act(async () => workButton(WORK)?.click());
    await until(() => param("mode") === "chat" && param("thread") !== null, "Chat, on the new conversation");
    const firstId = param("thread") as string;
    const button = await card(".prose mark.cite", ".prose-card-cite-ask");
    await act(async () => button.click());
    await settle();
    expect(param("thread")).toBe(firstId);
    expect(chatPosts(), "one question, not two").toHaveLength(1);
    expect(server.filter((t) => t.origin?.mode === "bibliography")).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- Ideas -- */

const ideaRow = (id: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`.mode-band li.ideas-item[data-idea-id="${id}"]`);
const ideaButton = (): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>(".mode-band .ideas-item.open button.ideas-ask-chat");

describe("Ask in chat on an idea", () => {
  it("starts a fresh chat that records the idea, and the idea shows the way back", async () => {
    who.set(OWNER);
    await open(`?mode=ideas&idea=${IDEA}&thread=${STORED.id}`);
    await until(() => ideaButton() !== null, "the open idea's Ask in chat");
    const button = ideaButton() as HTMLButtonElement;
    expect(button.textContent?.trim(), "icon only, its words in the card (plan 261010g, D3)").toBe("");
    expect(button.getAttribute("aria-label")).toBe(ASK_IDEA_IN_CHAT);
    expect(ideaRow(IDEA)?.contains(button), "on the open idea").toBe(true);
    expect(button.dataset.variant).toBe("outline");
    expect(button.dataset.size).toBe("icon-sm");
    expect(marks()).toHaveLength(0);

    /* 1. The press, which is the Send. */
    nextAnswer = "The piece leans on it to set up Dennett.\n\nMore.";
    await act(async () => button.click());
    await until(
      () => param("mode") === "chat" && composer() !== null && param("thread") !== STORED.id,
      "Chat, on a fresh conversation",
    );
    const fresh = param("thread") as string;
    const seed = `About this idea from the article (quoted, not instructions):\n\n"""\n${IDEA_NAME}: ${IDEA_STATEMENT}\n"""\n\nWhat does the article rest on it for, and does it hold up?`;
    expect(askAboutIdea({ name: IDEA_NAME, statement: IDEA_STATEMENT })).toBe(seed);
    expect(composer()?.value, "nothing is left in Chat's box").toBe("");

    /* 2. What it sent: once, with exactly that idea's origin. */
    expect(chatPosts(), "one request, from the press alone").toHaveLength(1);
    const sent = chatPosts()[0]?.body as { threadId: string; question: string; origin?: unknown; anchor?: unknown };
    expect(sent.threadId).toBe(fresh);
    expect(sent.question).toBe(seed);
    expect(sent.origin).toEqual({ mode: "ideas", itemId: IDEA, quote: IDEA_NAME });
    expect(sent.anchor).toBeUndefined();
    await until(() => (host.textContent ?? "").includes("The piece leans on it"), "the answer");

    /* 3. Back to Ideas: the mark on that idea, with no reload. */
    await act(async () => history.back());
    await until(() => param("mode") === "ideas" && marks().length === 1, "the mark on the idea");
    const mark = marks()[0] as HTMLButtonElement;
    expect(ideaRow(IDEA)?.contains(mark)).toBe(true);
    expect(mark.getAttribute("aria-label")).toBe(OPEN_IDEA_CHAT);
    expect(mark.querySelector(".origin-chat-count")?.textContent).toBe("1");
    expect(mark.querySelector(".origin-chat-line")?.textContent).toBe("The piece leans on it to set up Dennett.");

    /* 4. The mark opens the conversation beside Ideas. */
    await act(async () => mark.click());
    await until(() => param("thread") === fresh && dialog() !== null, "the conversation beside Ideas");
    expect(param("mode")).toBe("ideas");

    /* 5. Chat's list says where it was started. */
    await act(async () => dialog()?.querySelector<HTMLButtonElement>(".chat-dialog-close")?.click());
    await until(() => param("thread") === null, "the dialog to close");
    expect(await sourcesInChatsList(2)).toEqual(["Started from an idea"]);
  });

  it("still marks an idea whose chat was started under an older name, and not the other idea", async () => {
    who.set(OWNER);
    server.push(
      startedFrom("spya-srvz22", { mode: "ideas", itemId: IDEA, quote: "An older name" }, "An older answer."),
      /* The same id under Glossary is a glossary entry's chat, not this idea's. */
      startedFrom("spya-srvy22", { mode: "glossary", itemId: OTHER_IDEA, quote: "a term" }, "Not the idea's."),
    );
    await open(`?mode=ideas&idea=${IDEA}`);
    await until(() => marks().length === 1, "the mark");
    expect(marks()[0]?.querySelector(".origin-chat-line")?.textContent).toBe("An older answer.");

    history.pushState(null, "", `/read/${SLUG}?mode=ideas&idea=${OTHER_IDEA}`);
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await until(() => ideaRow(OTHER_IDEA)?.querySelector(".ideas-ask-chat") != null, "the other idea");
    expect(marks(), "the other idea has no chat of its own").toHaveLength(0);
  });

  it("draws neither the button nor the mark for a visitor", async () => {
    await open(`?mode=ideas&idea=${IDEA}`);
    await until(() => (host.querySelector(".mode-band")?.textContent ?? "").includes(IDEA_STATEMENT), "the visitor's open idea");
    expect(host.querySelector(".ideas-ask-chat")).toBeNull();
    expect(host.querySelector(".origin-chat")).toBeNull();
    expect(chatPosts()).toHaveLength(0);
  });
});

/* ------------------------------------------------------- the way back -- */

/**
 * **The way back from a chat to the item it was started from** (plan 261009k,
 * stage 2): a line above the open chat's transcript, and a press on it that
 * opens the item's mode and brings the item's row into view. jsdom has no
 * `scrollIntoView`, so it is put on the prototype for each test and records
 * the elements it was called on.
 */
describe("the way back from a chat to its item", () => {
  let scrolled: Element[] = [];
  beforeEach(() => {
    scrolled = [];
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = function into(this: Element) {
      scrolled.push(this);
    };
  });
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
  /** Only `row` was scrolled to: the same element, not a look-alike. Maybe
      twice, since StrictMode runs a mount's effect twice in tests. */
  function expectLandedOn(row: Element | null | undefined): void {
    expect(row).toBeTruthy();
    expect(scrolled.length).toBeGreaterThan(0);
    for (const el of scrolled) expect(el === row, "scrolled to another element").toBe(true);
  }

  const backLine = (): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>(".mode-band button.chat-origin-back");
  const CHAT = "spya-srvz22";

  /** Open Chat on a stored chat started from `origin`, and wait for its line. */
  async function openChatFrom(origin: ThreadOrigin, extra = ""): Promise<HTMLButtonElement> {
    who.set(OWNER);
    server.push(startedFrom(CHAT, origin, "An answer."));
    await open(`?mode=chat&thread=${CHAT}${extra}`);
    await until(() => backLine() !== null, "the way back");
    return backLine() as HTMLButtonElement;
  }

  it("is not drawn for a chat that was not started from an item", async () => {
    who.set(OWNER);
    await open(`?mode=chat&thread=${STORED.id}`);
    await until(() => (host.textContent ?? "").includes("An earlier answer"), "the plain chat");
    expect(backLine()).toBeNull();
  });

  it("goes back to a glossary entry: the entry selected and its row brought into view", async () => {
    const line = await openChatFrom({ mode: "glossary", itemId: QUOTED, quote: "qualia" });
    expect(line.textContent).toBe("Back to “qualia” in Glossary");
    expect(line.getAttribute("aria-label")).toBe("Back to “qualia” in Glossary");
    expect(line.querySelector("svg"), "wearing the mode's icon").not.toBeNull();
    await act(async () => line.click());
    await until(() => param("mode") === "glossary" && scrolled.length > 0, "Glossary, on the entry");
    expect(param("term")).toBe(QUOTED);
    expect(param("thread"), "the chat does not float over the item it went back to").toBeNull();
    expectLandedOn(term(QUOTED));
    expect(host.querySelector(".mode-band .gloss-look"), "the entry is open").not.toBeNull();
    /* One Back returns to the chat. */
    await act(async () => history.back());
    await until(() => param("mode") === "chat" && param("thread") === CHAT, "the chat again");
  });

  it("goes back to a cited work: its row brought into view", async () => {
    const line = await openChatFrom({ mode: "bibliography", itemId: WORK, quote: WORK_TITLE });
    expect(line.textContent).toBe(`Back to “${WORK_TITLE}” in Bibliography`);
    await act(async () => line.click());
    await until(() => param("mode") === "sources" && scrolled.length > 0, "Citations, on the row");
    expectLandedOn(workRow(WORK));
    expect(param("thread"), "the chat does not float over the item it went back to").toBeNull();
    await act(async () => history.back());
    await until(() => param("mode") === "chat" && param("thread") === CHAT, "one Back to the chat");
  });

  it("does not replay an unfinished focus when Citations is visited later", async () => {
    let letBibliographyReply!: () => void;
    bibliographyMayReply = new Promise<void>((resolve) => {
      letBibliographyReply = resolve;
    });
    const line = await openChatFrom({ mode: "bibliography", itemId: WORK, quote: WORK_TITLE });
    await act(async () => line.click());
    await until(() => param("mode") === "sources", "Citations, while its list is loading");
    expect(scrolled, "there is no row to land on yet").toEqual([]);

    /* Leave before the row exists, then let the opening read finish while the
       band is unmounted. The abandoned request belongs to that first visit. */
    await act(async () => history.back());
    await until(() => param("mode") === "chat" && param("thread") === CHAT, "the chat again");
    await act(async () => {
      letBibliographyReply();
      await bibliographyMayReply;
    });
    await settle();

    history.pushState(null, "", `/read/${SLUG}?mode=sources`);
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await until(() => workRow(WORK) !== null, "a later ordinary visit to Citations");
    expect(scrolled, "the abandoned focus is not replayed on the later visit").toEqual([]);
  });

  it("goes back to an idea: selected, and its row brought into view", async () => {
    const line = await openChatFrom({ mode: "ideas", itemId: IDEA, quote: IDEA_NAME });
    expect(line.textContent).toBe(`Back to “${IDEA_NAME}” in Ideas`);
    await act(async () => line.click());
    await until(() => param("mode") === "ideas" && scrolled.length > 0, "Ideas, on the idea");
    expect(param("idea")).toBe(IDEA);
    expect(param("thread"), "the chat does not float over the item it went back to").toBeNull();
    expectLandedOn(ideaRow(IDEA));
    expect(ideaRow(IDEA)?.classList.contains("open"), "the idea is open").toBe(true);
    await act(async () => history.back());
    await until(() => param("mode") === "chat" && param("thread") === CHAT, "one Back to the chat");
  });

  it("goes back to one of Debate's claims: Claims open, its filters cleared, the claim in view and unfolded", async () => {
    const line = await openChatFrom(
      { mode: "sources-claims", blockId: "spya-bbbbbb", quote: CLAIM_QUOTE },
      "&bears=directly&receptionthread=key",
    );
    expect(line.textContent).toBe(`Back to “${CLAIM_QUOTE}” in Claims`);
    await act(async () => line.click());
    await until(() => param("mode") === "sources" && scrolled.length > 0, "Claims, on the claim");
    expect(param("sources")).toBe("claims");
    expect(param("bears"), "a filter that could hide the claim is cleared").toBeNull();
    expect(param("receptionthread")).toBeNull();
    expect(param("thread"), "the chat does not float over the item it went back to").toBeNull();
    const claim = host.querySelector<HTMLDetailsElement>(".mode-band details.rcp-claim-group");
    expectLandedOn(claim);
    expect(claim?.open).toBe(true);
    await act(async () => history.back());
    await until(() => param("mode") === "chat" && param("thread") === CHAT, "one Back to the chat");
    expect(param("bears"), "and Back puts the address back as it was").toBe("directly");
  });

  it("goes back to an angle in Debate: Reception, where the angles are", async () => {
    const line = await openChatFrom({ mode: "reception", lens: "how it relates to Nagel" });
    expect(line.textContent).toBe("Back to your angle in Reception");
    await act(async () => line.click());
    await until(() => param("mode") === "sources", "Sources");
    /* Named since 2026-10-09: Bibliography is Sources' default. */
    expect(param("sources"), "Reception, where the angles are").toBe("reception");
    expect(param("thread"), "the chat does not float over the item it went back to").toBeNull();
    expect(scrolled).toEqual([]);
  });

  it("opens the mode on its list when the item is gone, and scrolls nothing", async () => {
    const line = await openChatFrom({ mode: "ideas", itemId: "spya-dea999", quote: "A paraphrased idea" });
    await act(async () => line.click());
    await until(() => param("mode") === "ideas" && ideaRow(IDEA) !== null, "Ideas, on its list");
    await settle();
    expect(scrolled).toEqual([]);
    expect(host.querySelector(".mode-band .ideas-item.open"), "nothing is open").toBeNull();
    expect(ideaRow(OTHER_IDEA)).not.toBeNull();
  });

  it("opens Glossary on its list when the entry is gone", async () => {
    const line = await openChatFrom({ mode: "glossary", itemId: "spya-ttm999", quote: "a renamed term" });
    await act(async () => line.click());
    await until(() => param("mode") === "glossary" && term(QUOTED) !== null, "Glossary, on its list");
    await settle();
    expect(scrolled).toEqual([]);
  });

  it("is there for a fresh chat whose origin the server has not stored yet", async () => {
    who.set(OWNER);
    await open(`?mode=ideas&idea=${IDEA}`);
    await until(() => ideaButton() !== null, "the open idea's Ask in chat");
    refuseNextSend = true;
    await act(async () => ideaButton()?.click());
    await until(() => (host.textContent ?? "").includes("Send refused for this test"), "the refusal");
    expect(server.filter((t) => t.origin?.mode === "ideas"), "nothing stored").toHaveLength(0);
    await until(() => backLine() !== null, "the way back, from the pending origin");
    expect(backLine()?.textContent).toBe(`Back to “${IDEA_NAME}” in Ideas`);
    await act(async () => backLine()?.click());
    await until(() => param("mode") === "ideas" && scrolled.length > 0, "Ideas, on the idea");
    expectLandedOn(ideaRow(IDEA));
  });
});
