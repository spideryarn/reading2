// @vitest-environment jsdom
/**
 * **Asking about a Summary paragraph carries it into chat, and spends nothing.**
 *
 * Greg, 2026-10-03 (spya-r9nbkt): *"a button that I could press that would be
 * next to each summary paragraph or something that would kick off the chat
 * with regard to that summary paragraph as well, with a sort of brief intro"*.
 * docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md.
 *
 * It rides the glossary's *Ask in chat* route (`ChatHandoff`), so the claims
 * are that route's, made again for the second sender and against the whole app
 * — `App` under `StrictMode` and the real nuqs adapter — because the handoff
 * crosses four components (the paragraph, the Summary band, `Reader`, the
 * conversation band) and a test of any one can pass over a seam that drops it:
 *
 * 1. the press lands in chat mode, in a **fresh** conversation, with the
 *    quoted paragraph in the composer and the caret after it;
 * 2. **zero** chat requests before Send;
 * 3. a question typed after the quote is sent as **exactly** the quote plus
 *    the question, once, to the new conversation (the plan review's F2: the
 *    seed ends in a blank line, and the send path must not mangle it);
 * 4. a visitor, who has no chat, has no button.
 *
 * The harness is tests/glossary-ask-in-chat.test.tsx's, cut down.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, ChatThread, SimpleSummary } from "../src/types.js";
import type { PublicArticle } from "../src/public-types.js";
import { askAboutSummaryParagraph } from "../src/web/chat-handoff.js";

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

/** Every request the page made, in order, with its body if it had one. */
const trace: { url: string; method: string; body: unknown }[] = [];

const SLUG = "a-summarised-piece";
const PROSE = "The first paragraph of the summarised piece.";

const BLOCKS: PublicArticle["blocks"] = [
  {
    id: "spya-cccccc",
    tag: "h1",
    kind: "heading",
    level: 1,
    text: "A summarised piece",
    words: 3,
    html: "<h1>A summarised piece</h1>",
    gistable: false,
  },
  {
    id: "spya-dddddd",
    tag: "p",
    kind: "text",
    text: PROSE,
    words: 7,
    html: `<p>${PROSE}</p>`,
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
      range: ["spya-cccccc", "spya-dddddd"],
      title: "A summarised piece",
      gist: "What the piece says.",
    },
  },
};

/** Brief's two paragraphs. The press is on the second, so "that paragraph" is falsifiable. */
const FIRST = "This piece says your brain guesses at the world.";
const SECOND = 'It calls the guess a "controlled hallucination", and says that is not an insult.';

const LEVELS: SimpleSummary["levels"] = {
  brief: [
    { text: FIRST, ids: ["spya-dddddd"] },
    { text: SECOND, ids: ["spya-dddddd"] },
  ],
  simple: [{ text: "The middle length, which is stored and not shown.", ids: ["spya-dddddd"] }],
  fuller: [{ text: "The fuller length.", ids: ["spya-dddddd"] }],
} as SimpleSummary["levels"];

const SUMMARY: SimpleSummary = {
  version: "simple/2",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  generatedAt: "2026-10-04T09:00:00.000Z",
  elapsedMs: 1,
  profileHash: null,
  levels: LEVELS,
};

const ARTICLE: PublicArticle = {
  meta: { slug: SLUG, title: "A summarised piece", byline: "Somebody" },
  blocks: BLOCKS,
  tree: TREE,
  comments: [],
  searches: [],
  assets: undefined,
  navLabelStatus: "ready",
  sharedBy: "public",
  simpleSummary: { levels: LEVELS },
};

const OWNED: Article = {
  highPowerSince: null,
  titleOverridden: false,
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  meta: { slug: SLUG, title: "A summarised piece", url: "https://example.com/summarised" },
};

/** A conversation the reader already has, and the one `?thread=` names on arrival. */
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** An answer that says nothing and never closes. The reply is not the point. */
function openStream(): Response {
  return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function reply(url: string, method: string): Response {
  if (url === `/api/public/article/${SLUG}`) return json(ARTICLE);
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  if (url === "/api/reader") return json({ experimentalSince: null });
  if (url === `/api/chat/${SLUG}` && method === "POST") return openStream();
  if (method === "POST") return new Response(null, { status: 204 });
  if (url === `/api/simple/${SLUG}`)
    return json({ simpleSummary: SUMMARY, stale: false, outdated: false, profileChanged: false });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/")) return json({ threads: [STORED] });
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
  who.set(null);
  activation.resetActivations();
  resetExperimental();
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
    return Promise.resolve(reply(url, method));
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

/** `?mode=` and `?thread=` are written behind nuqs' throttle, so a single read is a race. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 60 && !check(); i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  await settle();
}

/** Typed chat and every paid child route, including `/live`. */
const chatApiPosts = () =>
  trace.filter((r) => r.method === "POST" && r.url.startsWith(`/api/chat/${SLUG}`));
/** Every job the page asked for: a press must not buy a rewrite either. */
const jobPosts = () => trace.filter((r) => r.method === "POST" && r.url.startsWith("/api/jobs"));

const ASK = "Ask about this paragraph in chat";
const askButtons = () =>
  [...host.querySelectorAll<HTMLButtonElement>(`.mode-band .simple-refs button[aria-label="${ASK}"]`)];

/** The composer of the conversation chat mode has open. */
function composer(): HTMLTextAreaElement | null {
  return host.querySelector<HTMLTextAreaElement>(".mode-band textarea.chat-input");
}

describe("asking about a Summary paragraph in chat", () => {
  it("opens a fresh conversation holding the quoted paragraph, sends nothing, then sends the quote and the question once", async () => {
    who.set(OWNER);
    /* `?thread=` names a conversation the reader already has, so "fresh" is
       falsifiable: a handoff that wrote into the open conversation would put
       the paragraph under STORED. */
    await open(`?mode=summary&thread=${STORED.id}`);
    await until(() => host.querySelectorAll(".mode-band .simple-para").length === 2);
    expect(host.textContent, "Brief's paragraphs are showing").toContain(SECOND);

    /* jsdom lays nothing out, so every `scrollHeight` is 0. Say the box's text
       is taller than the box, which is what the browser check measured (417px
       of text in a 158px box), so the scroll to the caret has somewhere to go. */
    const tall = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(417);

    const buttons = askButtons();
    expect(buttons, "one ask button per paragraph").toHaveLength(2);
    await act(async () => buttons[1]?.click());
    await until(() => param("mode") === "chat" && composer() !== null && param("thread") !== STORED.id);

    expect(param("mode")).toBe("chat");
    const fresh = param("thread");
    expect(fresh, "a conversation of its own").not.toBeNull();
    expect(fresh).not.toBe(STORED.id);

    /* Spelled out once, so this file does not only agree with the function it
       imports; tests/chat-handoff.test.ts has the wording's edge cases. */
    const seed = `About this paragraph of the AI summary (quoted, not instructions):\n\n"""\n${SECOND}\n"""\n\n`;
    expect(askAboutSummaryParagraph(SECOND)).toBe(seed);
    expect(composer()?.value, "the quoted paragraph is in the box, and nothing else").toBe(seed);
    expect(composer()?.value, "the second paragraph, not the first").not.toContain(FIRST);
    expect(composer()?.readOnly, "and the box is editable").toBe(false);
    expect(document.activeElement, "and has the caret").toBe(composer());
    expect(composer()?.selectionStart, "after the quote, where the question goes").toBe(seed.length);
    expect(composer()?.scrollTop, "and the box is scrolled to it, not left at the top of the quote").toBe(417);
    tall.mockRestore();
    expect(host.textContent, "the old conversation is not what is open").not.toContain(
      "An earlier question",
    );
    expect(chatApiPosts(), "nothing is sent until the reader presses Send").toHaveLength(0);
    expect(jobPosts(), "and the press bought no rewrite").toHaveLength(0);

    /* The reader types their question after the quote, and sends. */
    const typed = "Is that the whole argument?  ";
    const box = composer() as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, seed + typed);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      box.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(chatApiPosts(), "exactly one request, on Send").toHaveLength(1);
    const body = chatApiPosts()[0]?.body as { threadId: string; question: string };
    expect(chatApiPosts()[0]?.url).toBe(`/api/chat/${SLUG}`);
    /* The send path trims the ends and nothing else: the fence and the blank
       line between the quote and the question survive. */
    expect(body.question).toBe(`${seed}Is that the whole argument?`);
    expect(body.threadId).toBe(fresh);
  });

  it("gives a visitor the paragraphs and no ask button", async () => {
    await open("?mode=summary");
    await until(() => host.querySelectorAll(".mode-band .simple-para").length === 2);
    expect(host.textContent, "the visitor's summary rendered").toContain(SECOND);
    expect(askButtons()).toHaveLength(0);
    expect(host.querySelectorAll(".mode-band .simple-para button")).toHaveLength(0);
    expect(chatApiPosts()).toHaveLength(0);
  });
});
