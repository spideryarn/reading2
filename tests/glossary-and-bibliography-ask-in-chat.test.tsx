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
 * for every origin, Claims' claim and Sources' Investigate angle included.
 *
 * **Since 2026-10-09 the button stands where Dig deeper was** (plan 261009k):
 * no entry and no row offers Dig deeper, and that is pinned here in the
 * rendered reader too. The *Ask in chat* the *Look up a term* box offers is
 * not touched (tests/glossary-ask-in-chat.test.tsx).
 */
import { readFileSync } from "node:fs";
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
  MAX_CHAT_QUESTION_CHARS,
  MAX_ORIGIN_NAME_CHARS,
  type SimpleSummary,
  type SourcesDigest,
  type SourcesDigestParagraph,
  type ThreadOrigin,
  type ThreadSummary,
} from "../src/types.js";
import type { PublicArticle } from "../src/public-types.js";
import {
  askAboutCitedWork,
  askAboutGlossaryEntry,
  askAboutIdea,
  askAboutModelText,
  CITED_WORK_QUESTION,
  DIGEST_PARAGRAPH_QUESTION,
} from "../src/web/chat-handoff.js";
import { askAboutBlock, askDoesItSayThat } from "../src/chat-question.js";
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

/* Viewing as another reader, when a test sets it (plan 261030b: view-as never sends). */
const viewAs = vi.hoisted(() => ({ nonce: null as string | null }));
vi.mock("../src/web/lib/view-as.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/lib/view-as.js")>()),
  viewAsNonce: () => viewAs.nonce,
}));

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

/* One of Claims's claims, from an older search's rows (the legacy list), and
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

/* Summary's Brief and Fuller, and a sources digest (plan 261030b § The ask box). */
const BRIEF_FIRST = "This piece says experience has a felt quality.";
const FULLER_FIRST = "In fuller words, the piece argues that qualia are real.";
const SIMPLE: SimpleSummary = {
  version: "simple/2",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  generatedAt: "2026-10-04T09:00:00.000Z",
  elapsedMs: 1,
  profileHash: null,
  levels: {
    brief: [
      { text: BRIEF_FIRST, ids: ["spya-bbbbbb"] },
      { text: "And that Dennett is wrong about it.", ids: ["spya-bbbbbb"] },
    ],
    fuller: [
      { text: FULLER_FIRST, ids: ["spya-bbbbbb"] },
      { text: "It sets itself against Dennett's account at length.", ids: ["spya-bbbbbb"] },
    ],
  },
} as SimpleSummary;

const DIGEST_OVERVIEW = "The piece leans on Dennett and on Nagel.";
/** Long enough that the whole digest's first message has to be cut to fit. */
const DIGEST_LONG = `Nagel's bat paper is the other ${"pillar ".repeat(700)}it stands on.`;
const DIGEST_CHECK = "Dennett may say less about qualia than the passage uses him for.";
function digestParagraph(text: string): SourcesDigestParagraph {
  return {
    text,
    sentences: [{ text, id: "spya-bbbbbb" }],
    ids: ["spya-bbbbbb"],
    more: "",
    sources: [],
    leadIds: [],
  } as SourcesDigestParagraph;
}
const DIGEST: SourcesDigest = {
  version: "sources-digest/1",
  generator: "test",
  phases: { plan: "test", read: "test", write: "test" },
  slug: SLUG,
  sourceHash: "h",
  profileHash: null,
  generatedAt: "2026-10-30T12:00:00.000Z",
  elapsedMs: 1,
  year: null,
  outcome: "written",
  overview: [{ text: DIGEST_OVERVIEW, id: null }],
  sections: {
    cites: [digestParagraph("Dennett's book is what the piece argues with."), digestParagraph(DIGEST_LONG)],
    citedBy: [],
    missed: [],
    check: [digestParagraph(DIGEST_CHECK)],
  },
  leads: [],
  pieceSearch: null,
  citers: 0,
  reports: [],
  evidence: [],
  counts: {
    leadsWritten: 0, leadsDropped: 0, queriesRefused: 0, searches: 0, readers: 0, readersFailed: 0,
    offVerdict: 0, quotesWritten: 0, quotesUnknownSource: 0, quotesUnchecked: 0, unknownIds: 0,
    sentenceIds: 0, unanchored: 0, emptyParagraphs: 0, unknownSources: 0, unknownLeads: 0, overCap: 0,
  },
} as SourcesDigest;
/** The digest's item id: `sd-` and its time's digits; a paragraph's adds `-p` and its number. */
const DIGEST_ID = "sd-20261030120000000";

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
  simpleSummary: { levels: SIMPLE.levels },
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
let conflictCiteCheckId: string | null = null;
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
  /* Whose account a view-as tab is showing: the owner's (view-as-session.ts). */
  if (url === "/api/admin/view-as/current")
    return json({ subjectId: "owner-1", subjectEmail: "a@example.com", expiresAt: new Date(Date.now() + 600_000).toISOString() });
  if (url === `/api/chat/${SLUG}` && method === "POST") {
    if (refuseNextSend) {
      refuseNextSend = false;
      return json({ error: "Send refused for this test" }, 400);
    }
    const sent = body as { origin?: ThreadOrigin };
    if (conflictCiteCheckId && sent.origin?.mode === "cite-check") {
      return json({ error: "A chat already exists.", threadId: conflictCiteCheckId }, 409);
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
  if (url === `/api/simple/${SLUG}`)
    return json({ simpleSummary: SIMPLE, stale: false, outdated: false, profileChanged: false });
  if (url === `/api/sources-digest/${SLUG}`)
    return json({ sourcesDigest: DIGEST, stale: false, outdated: false, profileChanged: false });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url === "/api/jobs") return json({ jobs: [] });
  return json({});
}

const { App } = await import("../src/web/App.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");
const activation = await import("../src/web/activation.js");
const { resetViewAsSessionForTests, startViewAsSession } = await import("../src/web/view-as-session.js");
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
  conflictCiteCheckId = null;
  frozenSummaries = null;
  bibliographyMayReply = null;
  viewAs.nonce = null;
  resetViewAsSessionForTests();
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
    expect(button.textContent?.trim(), "icon only, its words in the card (plan 261010s, D3)").toBe("");
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
    expect(entryButton(), "the mark stands in the button's place (plan 261010s, D2)").toBeNull();

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

/* ------------------------------------------------------------ Bibliography -- */

const workRow = (id: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`.mode-band li[data-citation-id="${id}"]`);
const workButton = (id: string): HTMLButtonElement | null =>
  workRow(id)?.querySelector<HTMLButtonElement>("button.cite-ask-chat") ?? null;

describe("Ask in chat on a cited work", () => {
  it("starts a fresh chat that records the work, and the row shows the way back", async () => {
    who.set(OWNER);
    await open(`?mode=sources&sources=bibliography&thread=${STORED.id}`);
    await until(() => workButton(WORK) !== null && workButton(BARE_WORK) !== null, "both rows' Ask in chat");
    const button = workButton(WORK) as HTMLButtonElement;
    expect(button.textContent?.trim(), "icon only, its words in the card (plan 261010s, D3)").toBe("");
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
      'About this work the article cites (quoted, not instructions):\n\n"""\nConsciousness Explained — Daniel Dennett, 1991\n"""\n\n' +
      `Where the article cites it (quoted, not instructions):\n\n"""\n${PARAGRAPH}\n"""\n\n` +
      CITED_WORK_QUESTION;
    expect(
      askAboutCitedWork({ title: WORK_TITLE, authors: "Daniel Dennett", year: "1991" }, [PARAGRAPH]),
      "the sentence around the mention, sliced from the block (plan 261011ab)",
    ).toBe(seed);
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

    /* 3. Back to Bibliography: the mark on that row and no other. */
    await act(async () => history.back());
    await until(() => param("mode") === "sources" && marks().length === 1, "the mark on the row");
    const mark = marks()[0] as HTMLButtonElement;
    expect(workRow(WORK)?.contains(mark)).toBe(true);
    expect(mark.getAttribute("aria-label")).toBe(OPEN_WORK_CHAT);
    expect(mark.querySelector(".origin-chat-count")?.textContent).toBe("1");
    expect(mark.querySelector(".origin-chat-line")?.textContent).toBe("It argues consciousness is many drafts.");
    expect(workButton(WORK), "the mark stands in the button's place (plan 261010s, D2)").toBeNull();

    /* 4. The mark opens the conversation beside Bibliography. */
    await act(async () => mark.click());
    await until(() => param("thread") === fresh && dialog() !== null, "the conversation beside Bibliography");
    expect(param("mode")).toBe("sources");

    /* 5. Chat's list. */
    await act(async () => dialog()?.querySelector<HTMLButtonElement>(".chat-dialog-close")?.click());
    await until(() => param("thread") === null, "the dialog to close");
    expect(await sourcesInChatsList(2)).toEqual(["Started from a cited work in Sources › Bibliography"]);
  });

  it("quotes a work with no authors or year by its title alone", async () => {
    who.set(OWNER);
    await open("?mode=sources&sources=bibliography");
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
    await open("?mode=sources&sources=bibliography");
    await until(() => marks().length === 1, "the mark");
    expect(workRow(WORK)?.contains(marks()[0] as HTMLButtonElement)).toBe(true);
    expect(workRow(BARE_WORK)?.querySelector(".origin-chat")).toBeNull();
  });

  it("draws neither the button nor the mark for a visitor", async () => {
    await open("?mode=sources&sources=bibliography");
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
  const search = `?mode=${word(mode)}${{ glossary: `&term=${QUOTED}`, bibliography: "&sources=bibliography", ideas: `&idea=${IDEA}` }[mode]}`;
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

  /* Until plan 261010s this held the opposite: a second press started a
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
    ["bibliography", "?mode=sources&sources=bibliography", `.prose mark.cite`, ".prose-card-cite-ask"],
  ] as const)("reopens the %s item's chat and sends nothing", async (mode, search, mark, ask) => {
    who.set(OWNER);
    const itemId = mode === "glossary" ? QUOTED : WORK;
    const quote = mode === "glossary" ? "qualia" : WORK_TITLE;
    server.push(startedFrom("spya-srvx33", { mode, itemId, quote }, "The earlier answer."));
    await open(search);
    const button = await card(mark, ask);
    expect(button.textContent?.trim(), "icon only (plan 261010s, D3)").toBe("");
    await act(async () => button.click());
    await until(() => param("thread") === "spya-srvx33" && dialog() !== null, "the earlier conversation");
    expect(chatPosts(), "no new question").toHaveLength(0);
    expect(server.filter((t) => t.origin?.mode === mode), "and no second chat").toHaveLength(1);
  });

  /* Plan 261011w: *Does it say that?* is not the item's chat. It starts a fresh
     one, anchored on the paragraph the card was opened from, even when the
     work already has its own chat. Since plan 261024m it carries a
     `cite-check` origin, the work and the paragraph, so a rest on the card and
     a second press find it; no `auto`, because a press is never capped. */
  it("Does it say that? starts a fresh chat anchored on the citing paragraph", async () => {
    who.set(OWNER);
    server.push(startedFrom("spya-srvx34", { mode: "bibliography", itemId: WORK, quote: WORK_TITLE }, "Earlier."));
    await open("?mode=sources&sources=bibliography");
    const button = await card(".prose mark.cite", ".prose-card-cite-check");
    await act(async () => button.click());
    await until(() => chatPosts().length === 1, "the question sent");
    const sent = chatPosts()[0]?.body as { question: string; origin?: unknown; anchor?: unknown; auto?: unknown };
    expect(sent.anchor).toEqual({ blockId: "spya-bbbbbb" });
    expect(sent.origin).toEqual({ mode: "cite-check", itemId: WORK, blockId: "spya-bbbbbb", quote: WORK_TITLE });
    expect(sent.auto).toBeUndefined();
    expect(sent.question).toBe(
      askAboutBlock({
        blockId: "spya-bbbbbb",
        question: askDoesItSayThat({ title: WORK_TITLE, authors: "Daniel Dennett", year: "1991" }),
      }),
    );
    /* The ordinary passage path stays beside the prose outside Chat/Learn; it
       does not silently turn a Sources press into navigation to Chat. */
    expect(param("mode")).toBe("sources");
    expect(dialog()).not.toBeNull();
  });

  /* Plan 261024m: the paragraph's check is one chat, so a second press opens it. */
  it("Does it say that? reopens this paragraph's check and sends nothing", async () => {
    who.set(OWNER);
    server.push(
      startedFrom(
        "spya-srvx35",
        { mode: "cite-check", itemId: WORK, blockId: "spya-bbbbbb", quote: WORK_TITLE },
        "It does, in chapter 2.",
      ),
    );
    await open("?mode=sources&sources=bibliography");
    const button = await card(".prose mark.cite", ".prose-card-cite-check");
    await act(async () => button.click());
    await until(() => param("thread") === "spya-srvx35" && dialog() !== null, "the earlier check");
    expect(chatPosts(), "no new question").toHaveLength(0);
  });

  it("Does it say that? adopts a check another tab created after this tab's summary read", async () => {
    who.set(OWNER);
    const existing = startedFrom(
      "spya-srvx36",
      { mode: "cite-check", itemId: WORK, blockId: "spya-bbbbbb", quote: WORK_TITLE },
      "The other tab's answer.",
    );
    server.push(existing);
    frozenSummaries = server.filter((thread) => thread.id !== existing.id);
    conflictCiteCheckId = existing.id;
    await open("?mode=sources&sources=bibliography");
    const button = await card(".prose mark.cite", ".prose-card-cite-check");
    await act(async () => button.click());
    await until(() => param("thread") === existing.id, "the existing check's id after the 409");
    await until(() => (dialog()?.textContent ?? "").includes("The other tab's answer."), "the existing check after the 409");
    expect(chatPosts(), "the deliberate press made only its one attempt").toHaveLength(1);
  });

  /* GPT Sol's F1 on plan 261010s: still in Chat, the summaries have not been
     re-read since the first press, so only the band's report of the thread it
     began can say the work has a chat. */
  it("reopens a chat begun moments ago, before the summaries have heard of it", async () => {
    who.set(OWNER);
    await open("?mode=sources&sources=bibliography");
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
    expect(button.textContent?.trim(), "icon only, its words in the card (plan 261010s, D3)").toBe("");
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

/* ---------------------------------------- the ask box (plan 261030b) -- */

/**
 * **The ask box under the sources digest and under Summary's Brief and
 * Fuller, and each digest paragraph's own chat** (plan
 * docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md
 * § The ask box, Stage 3). The claims, in the rendered reader for this
 * file's reason (the senders travel `Reader` → the band → the panel):
 *
 * 1. the box's Send starts **one** fresh chat, with that item's origin and a
 *    first message that quotes the text and fits Chat's 4,000 characters;
 * 2. once the item has its chat, the chat's mark stands in the box's place and
 *    reopens it, sending nothing and starting no second chat;
 * 3. a digest paragraph's *Ask in chat* names the paragraph by its number
 *    across the four sections;
 * 4. Summary's box is under Brief and Fuller and not under Thread, and its
 *    paragraph buttons are as they were;
 * 5. a visitor, and an administrator viewing as the owner, get no box, no
 *    paragraph button and no mark.
 */
const askBox = (): HTMLInputElement | null => host.querySelector<HTMLInputElement>(".mode-band .ask-box input");
const digestParagraphs = () => [...host.querySelectorAll<HTMLElement>(".mode-band [data-digest-paragraph]")];
const digestParagraphButtons = () => [...host.querySelectorAll<HTMLButtonElement>(".mode-band .digest-ask-para")];
const askMark = (): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>(".mode-band .digest-ask .origin-chat, .mode-band .simple-ask-box .origin-chat");
const summaryParagraphButtons = () => [
  ...host.querySelectorAll<HTMLButtonElement>(`.mode-band .simple-refs button[aria-label="Ask about this paragraph in chat"]`),
];

/** Type the reader's words into the ask box and press Enter. */
async function ask(words: string): Promise<void> {
  const input = askBox() as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, words);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

/** Go to an address in this tab, as a link or Back would. */
async function goTo(search: string): Promise<void> {
  history.pushState(null, "", `/read/${SLUG}${search}`);
  await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
  await settle();
}

type Sent = { threadId: string; question: string; origin?: unknown };

describe("the ask box under the sources digest, and each paragraph's chat", () => {
  it("sends the reader's words and the digest, cut to fit, as a fresh chat about the digest", async () => {
    who.set(OWNER);
    await open(`?mode=sources&sources=digest&thread=${STORED.id}`);
    await until(() => askBox() !== null, "the digest's ask box");
    expect(
      digestParagraphs().map((p) => p.dataset.digestParagraph),
      "each paragraph numbered across the sections",
    ).toEqual([`${DIGEST_ID}-p1`, `${DIGEST_ID}-p2`, `${DIGEST_ID}-p3`]);
    expect(marks(), "no chat yet").toHaveLength(0);

    nextAnswer = "Nagel claimed there is something it is like to be a bat.";
    await ask("  What did Nagel actually claim?  ");
    await until(
      () => param("mode") === "chat" && param("thread") !== STORED.id && chatPosts().length === 1,
      "Chat, on a fresh conversation",
    );
    expect(chatPosts(), "one request, from the Send alone").toHaveLength(1);
    const sent = chatPosts()[0]?.body as Sent;
    expect(sent.threadId).toBe(param("thread"));
    expect(sent.origin).toEqual({ mode: "sources-digest", itemId: DIGEST_ID, quote: DIGEST_OVERVIEW });
    /* Spelled out, so this file does not only agree with the panel's builder:
       the overview, then each section with paragraphs under its heading. */
    const text = [
      DIGEST_OVERVIEW,
      `What it builds on:\nDennett's book is what the piece argues with.\n\n${DIGEST_LONG}`,
      `Worth checking: citations that may not say that:\n${DIGEST_CHECK}`,
    ].join("\n\n");
    expect(sent.question).toBe(askAboutModelText({ kind: "digest", question: "What did Nagel actually claim?", text }));
    expect(sent.question.startsWith("My question:\n\nWhat did Nagel actually claim?\n\n"), "the reader's words first, whole").toBe(true);
    expect(sent.question.length).toBeLessThanOrEqual(MAX_CHAT_QUESTION_CHARS);
    expect(sent.question, "the long paragraph cut, visibly").toMatch(/…\n"""$/);
    expect(sent.question, "and what came after it left out").not.toContain(DIGEST_CHECK);
    expect(composer()?.value, "nothing is left in Chat's box").toBe("");
  });

  it("has one chat: once the digest has one, its mark stands in the box's place and reopens it", async () => {
    who.set(OWNER);
    await open("?mode=sources&sources=digest");
    await until(() => askBox() !== null, "the digest's ask box");
    nextAnswer = "The digest's first answer.";
    await ask("Is this fair to Dennett?");
    await until(() => param("mode") === "chat" && chatPosts().length === 1, "the new chat");
    const firstId = param("thread") as string;

    await goTo("?mode=sources&sources=digest");
    await until(() => askMark() !== null, "the digest's mark");
    expect(askBox(), "no box beside the mark").toBeNull();
    expect(askMark()?.querySelector(".origin-chat-line")?.textContent).toBe(nextAnswer);
    expect(digestParagraphButtons(), "a paragraph's chat is its own, so each still has its button").toHaveLength(3);
    await act(async () => askMark()?.click());
    await until(() => param("thread") === firstId && dialog() !== null, "the first conversation, beside the mode");
    expect(param("mode")).toBe("sources");
    expect(chatPosts(), "reopening sends nothing").toHaveLength(1);
    expect(server.filter((t) => t.origin?.mode === "sources-digest"), "and starts no second chat").toHaveLength(1);
  });

  it("starts a paragraph's own chat, named by its number across the sections, and then marks it", async () => {
    who.set(OWNER);
    await open("?mode=sources&sources=digest");
    await until(() => digestParagraphButtons().length === 3, "each paragraph's Ask in chat");
    const button = digestParagraphButtons()[2] as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("Ask about this paragraph in chat");
    /* The control every per-item chat uses (controls.md § Controls that do
       the same job look the same): AskInChatButton's outline icon button. */
    expect(button.dataset.variant).toBe("outline");
    expect(button.dataset.size).toBe("icon-sm");
    nextAnswer = "It holds up only in part.";
    await act(async () => button.click());
    await until(() => param("mode") === "chat" && chatPosts().length === 1, "the paragraph's chat");
    const sent = chatPosts()[0]?.body as Sent;
    expect(sent.origin, "the first paragraph of Worth checking is the third").toEqual({
      mode: "sources-digest",
      itemId: `${DIGEST_ID}-p3`,
      quote: DIGEST_CHECK,
    });
    expect(sent.question).toBe(
      askAboutModelText({ kind: "digest-paragraph", question: DIGEST_PARAGRAPH_QUESTION, text: DIGEST_CHECK }),
    );

    await goTo("?mode=sources&sources=digest");
    await until(() => marks().length === 1, "the paragraph's mark");
    const third = digestParagraphs()[2];
    expect(third?.querySelector(".origin-chat"), "the mark is on that paragraph").not.toBeNull();
    expect(third?.querySelector(".digest-ask-para"), "in its button's place").toBeNull();
    expect(digestParagraphButtons()).toHaveLength(2);
    expect(askBox(), "the whole digest's box is a different chat").not.toBeNull();
    await act(async () => third?.querySelector<HTMLButtonElement>(".origin-chat")?.click());
    await until(() => dialog() !== null, "the paragraph's conversation, beside the mode");
    expect(chatPosts()).toHaveLength(1);
  });
});

describe("the ask box under Summary's Brief and Fuller", () => {
  it.each(["brief", "fuller"] as const)("sits under %s, starts one chat about that level, then gives way to its mark", async (level) => {
    who.set(OWNER);
    await open(`?mode=summary&summary=${level}`);
    await until(() => askBox() !== null, `the box under ${level}`);
    /* The paragraph button is left as it is: one per paragraph, the ghost one. */
    expect(summaryParagraphButtons()).toHaveLength(2);
    for (const b of summaryParagraphButtons()) expect(b.classList.contains("simple-ask")).toBe(true);

    nextAnswer = `An answer about ${level}.`;
    await ask("Is that the whole argument?");
    await until(() => param("mode") === "chat" && chatPosts().length === 1, "the level's chat");
    const sent = chatPosts()[0]?.body as Sent;
    const paragraphs = SIMPLE.levels[level].map((p) => p.text);
    expect(sent.origin).toEqual({ mode: "summary", itemId: `ss-${level}-20261004090000000`, quote: paragraphs[0] });
    expect(sent.question).toBe(
      askAboutModelText({ kind: level, question: "Is that the whole argument?", text: paragraphs.join("\n\n") }),
    );
    expect(sent.question.length).toBeLessThanOrEqual(MAX_CHAT_QUESTION_CHARS);
    const firstId = param("thread") as string;

    await goTo(`?mode=summary&summary=${level}`);
    await until(() => askMark() !== null, "the level's mark");
    expect(askBox()).toBeNull();
    await act(async () => askMark()?.click());
    await until(() => param("thread") === firstId && dialog() !== null, "the level's conversation, beside the mode");
    expect(chatPosts(), "reopening sends nothing").toHaveLength(1);
    expect(server.filter((t) => t.origin?.mode === "summary")).toHaveLength(1);
  });

  it("is one chat per level: Fuller's box is not Brief's chat", async () => {
    who.set(OWNER);
    server.push(startedFrom("spya-srvx36", { mode: "summary", itemId: "ss-brief-20261004090000000", quote: BRIEF_FIRST }, "Brief."));
    await open("?mode=summary&summary=brief");
    await until(() => askMark() !== null, "Brief's mark");
    await goTo("?mode=summary&summary=fuller");
    await until(() => askBox() !== null, "Fuller's box");
    expect(askMark()).toBeNull();
  });

  it("is not under Thread", async () => {
    who.set(OWNER);
    await open("?mode=summary&summary=thread");
    await until(() => host.querySelector(".mode-band") !== null, "Summary's band");
    expect(askBox()).toBeNull();
    expect(host.querySelector(".mode-band .simple-ask-box")).toBeNull();
    /* Falsifiable: the same reader gets the box on Brief. */
    await goTo("?mode=summary&summary=brief");
    await until(() => askBox() !== null, "the box under Brief");
  });
});

describe("no ask box for a visitor, or while viewing as the owner", () => {
  it("gives a visitor Summary's paragraphs and no box", async () => {
    await open("?mode=summary&summary=brief");
    await until(() => host.querySelectorAll(".mode-band .simple-para").length === 2, "the visitor's summary");
    expect(askBox()).toBeNull();
    expect(host.querySelector(".mode-band .simple-ask-box")).toBeNull();
    expect(summaryParagraphButtons()).toHaveLength(0);
  });

  it("gives a visitor's shared ?sources=digest Bibliography, and no digest to ask about", async () => {
    await open("?mode=sources&sources=digest");
    await until(() => workRow(WORK) !== null, "the visitor's Bibliography");
    expect(digestParagraphs()).toHaveLength(0);
    expect(askBox()).toBeNull();
    expect(trace.filter((r) => r.url.startsWith("/api/sources-digest/"))).toHaveLength(0);
  });

  it("draws the digest and Summary in view-as with no box, no paragraph button and no mark", async () => {
    who.set(OWNER);
    viewAs.nonce = "v".repeat(43);
    /* As a view-as tab's page starts: waiting to hear whose account it is. */
    resetViewAsSessionForTests();
    server.push(startedFrom("spya-srvx35", { mode: "sources-digest", itemId: DIGEST_ID, quote: DIGEST_OVERVIEW }, "Earlier."));
    /* main.tsx's ViewAsBar starts the session; App alone does not mount it. */
    const stop = startViewAsSession();
    try {
      await open("?mode=sources&sources=digest");
      await until(() => digestParagraphs().length === 3, "the owner's digest, viewed as them");
      expect(askBox()).toBeNull();
      expect(digestParagraphButtons()).toHaveLength(0);
      expect(marks(), "not even the mark: its press would open a chat to send in").toHaveLength(0);
      await goTo("?mode=summary&summary=brief");
      await until(() => host.querySelectorAll(".mode-band .simple-para").length === 2, "the owner's summary, viewed as them");
      expect(askBox()).toBeNull();
      expect(host.querySelector(".mode-band .simple-ask-box")).toBeNull();
      expect(chatPosts()).toHaveLength(0);
    } finally {
      stop();
    }
  });
});

/**
 * **The way back from a chat to the item it was started from** (plan 261009k,
 * stage 2): a line above the open chat's transcript, and a press on it that
 * opens the item's mode and lands on the item's row — centred in the list's
 * own scroller and flashed, since 2026-10-17 (item-focus.ts § useLandOnItem,
 * spya-m53cdk).
 *
 * A landing is recorded twice over: `scrolled`, every row that took the flash
 * (`element-flash`), and `scrollers`, every element whose `scrollTop` was
 * written. The bands' real stylesheets are loaded, so the scroller a landing
 * finds is the one the computed style says scrolls, as in a browser; jsdom has
 * no layout, so a scroller is given a height (anything that does not scroll
 * keeps jsdom's 0).
 */
const BAND_CSS = ["timeline", "glossary", "ideas", "reception"]
  .map((name) => readFileSync(`src/web/styles/${name}.css`, "utf8"))
  .join("\n");
describe("the way back from a chat to its item", () => {
  let scrolled: Element[] = [];
  let scrollers: Element[] = [];
  let watch: MutationObserver;
  let style: HTMLStyleElement;
  const restore: (() => void)[] = [];
  beforeEach(() => {
    scrolled = [];
    scrollers = [];
    style = document.createElement("style");
    style.textContent = BAND_CSS;
    document.head.append(style);
    watch = new MutationObserver((changes) => {
      for (const c of changes) {
        if (c.target instanceof Element && c.target.classList.contains("element-flash")) scrolled.push(c.target);
      }
    });
    watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
    const height = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
    const top = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    const scrolls = (el: Element) => /^(auto|scroll)$/.test(getComputedStyle(el).overflowY);
    Object.defineProperty(Element.prototype, "clientHeight", {
      configurable: true,
      get(this: Element) {
        return scrolls(this) ? 200 : (height?.get?.call(this) ?? 0);
      },
    });
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      get(this: Element) {
        return top?.get?.call(this) ?? 0;
      },
      set(this: Element, v: number) {
        scrollers.push(this);
        top?.set?.call(this, v);
      },
    });
    restore.push(() => {
      if (height) Object.defineProperty(Element.prototype, "clientHeight", height);
      if (top) Object.defineProperty(Element.prototype, "scrollTop", top);
    });
  });
  afterEach(() => {
    watch.disconnect();
    style.remove();
    for (const r of restore.splice(0)) r();
  });
  /** Only `row` was landed on — the same element, not a look-alike, maybe
      twice since StrictMode runs a mount's effect twice — and the scroller
      moved was `scroller`, its own list's. */
  function expectLandedOn(row: Element | null | undefined, scroller: string): void {
    expect(row).toBeTruthy();
    expect(scrolled.length).toBeGreaterThan(0);
    for (const el of scrolled) expect(el === row, "flashed another element").toBe(true);
    const moved = scrollers.filter((el) => el.contains(row ?? null));
    expect(moved.length, `the row's own scroller, ${scroller}, was moved`).toBeGreaterThan(0);
    for (const el of moved) expect(el.matches(scroller), `moved ${el.className}, not ${scroller}`).toBe(true);
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
    expectLandedOn(term(QUOTED), ".gloss-list");
    expect(host.querySelector(".mode-band .gloss-look"), "the entry is open").not.toBeNull();
    /* One Back returns to the chat. */
    await act(async () => history.back());
    await until(() => param("mode") === "chat" && param("thread") === CHAT, "the chat again");
  });

  it("goes back to a cited work: its row brought into view", async () => {
    const line = await openChatFrom({ mode: "bibliography", itemId: WORK, quote: WORK_TITLE });
    expect(line.textContent).toBe(`Back to “${WORK_TITLE}” in Bibliography`);
    await act(async () => line.click());
    await until(() => param("mode") === "sources" && scrolled.length > 0, "Bibliography, on the row");
    expectLandedOn(workRow(WORK), ".tl-scroll");
    expect(param("thread"), "the chat does not float over the item it went back to").toBeNull();
    await act(async () => history.back());
    await until(() => param("mode") === "chat" && param("thread") === CHAT, "one Back to the chat");
  });

  it("does not replay an unfinished focus when Bibliography is visited later", async () => {
    let letBibliographyReply!: () => void;
    bibliographyMayReply = new Promise<void>((resolve) => {
      letBibliographyReply = resolve;
    });
    const line = await openChatFrom({ mode: "bibliography", itemId: WORK, quote: WORK_TITLE });
    await act(async () => line.click());
    await until(() => param("mode") === "sources", "Bibliography, while its list is loading");
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

    history.pushState(null, "", `/read/${SLUG}?mode=sources&sources=bibliography`);
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await until(() => workRow(WORK) !== null, "a later ordinary visit to Bibliography");
    expect(scrolled, "the abandoned focus is not replayed on the later visit").toEqual([]);
  });

  it("goes back to an idea: selected, and its row brought into view", async () => {
    const line = await openChatFrom({ mode: "ideas", itemId: IDEA, quote: IDEA_NAME });
    expect(line.textContent).toBe(`Back to “${IDEA_NAME}” in Ideas`);
    await act(async () => line.click());
    await until(() => param("mode") === "ideas" && scrolled.length > 0, "Ideas, on the idea");
    expect(param("idea")).toBe(IDEA);
    expect(param("thread"), "the chat does not float over the item it went back to").toBeNull();
    expectLandedOn(ideaRow(IDEA), ".ideas-scroll");
    expect(ideaRow(IDEA)?.classList.contains("open"), "the idea is open").toBe(true);
    await act(async () => history.back());
    await until(() => param("mode") === "chat" && param("thread") === CHAT, "one Back to the chat");
  });

  it("goes back to one of Claims's claims: Claims open, its filters cleared, the claim in view and unfolded", async () => {
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
    expectLandedOn(claim, ".rcp-scroll, .rcp-listed-wrap");
    expect(claim?.open).toBe(true);
    await act(async () => history.back());
    await until(() => param("mode") === "chat" && param("thread") === CHAT, "one Back to the chat");
    expect(param("bears"), "and Back puts the address back as it was").toBe("directly");
  });

  /* Reception's angle box until plan 261020n, which moved it and its list to
     Sources › Investigate: an angle chat made before then lands there too. */
  it("goes back to a question in Sources: Investigate, where Your questions lists it", async () => {
    const line = await openChatFrom({ mode: "reception", lens: "how it relates to Nagel" });
    expect(line.textContent).toBe("Back to your question in Investigate");
    const came = param("thread");
    expect(came).not.toBeNull();
    await act(async () => line.click());
    await until(() => param("mode") === "sources", "Sources");
    /* Named since 2026-10-09: Bibliography is Sources' default. */
    expect(param("sources"), "Investigate, where the questions are").toBe("investigate");
    await until(
      () => [...document.querySelectorAll(".mode-band .investigate-yours-words")].some((w) => w.textContent === "how it relates to Nagel"),
      "the question listed under Your questions",
    );
    /* Unlike an item's way back, a question's keeps its chat open beside
       Investigate: the conversation is what Investigate takes you back to
       (Greg, 2026-10-20, spya-nhwy3d; plan 261021b). */
    expect(param("thread"), "the conversation it came from stays open beside Investigate").toBe(came);
    expect(scrolled).toEqual([]);
  });

  /* Plan 261030b: the digest's way back opens Sources › Digest, and a
     paragraph's lands on that paragraph (Stage 3b). */
  it("goes back to a paragraph of the sources digest: Sources › Digest, the paragraph in view and flashed", async () => {
    const line = await openChatFrom({ mode: "sources-digest", itemId: `${DIGEST_ID}-p3`, quote: "Dennett may say less" });
    expect(line.textContent).toBe("Back to “Dennett may say less” in Digest");
    await act(async () => line.click());
    await until(() => param("mode") === "sources" && scrolled.length > 0, "Digest, on the paragraph");
    expect(param("sources")).toBe("digest");
    expect(param("thread")).toBeNull();
    const paragraph = host.querySelector(`.mode-band [data-digest-paragraph="${DIGEST_ID}-p3"]`);
    expect(paragraph?.textContent, "the third paragraph: the first of Worth checking").toContain(DIGEST_CHECK);
    expectLandedOn(paragraph, ".tl-scroll");
  });

  it("opens the digest at its top for the whole digest's chat, or a paragraph of a digest written since", async () => {
    const line = await openChatFrom({ mode: "sources-digest", itemId: "sd-20261030215639123-p2", quote: "Nobody has tested it" });
    await act(async () => line.click());
    await until(() => param("mode") === "sources", "Sources");
    expect(param("sources")).toBe("digest");
    await until(() => host.querySelector(".mode-band [data-digest-paragraph]") !== null, "the digest");
    expect(scrolled, "an id the digest no longer has lands nowhere").toEqual([]);
  });

  it("goes back to a summary level: Summary on that level, the chat closed", async () => {
    const line = await openChatFrom({ mode: "summary", itemId: "ss-fuller-20261030215639123", quote: "In plain words" });
    expect(line.textContent).toBe("Back to “In plain words” in Fuller");
    await act(async () => line.click());
    await until(() => param("mode") === "summary", "Summary");
    expect(param("summary")).toBe("fuller");
    expect(param("thread")).toBeNull();
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
    expectLandedOn(ideaRow(IDEA), ".ideas-scroll");
  });
});
