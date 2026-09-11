// @vitest-environment jsdom
/**
 * **Ask in chat carries the glossary's question across, and spends nothing.**
 *
 * The glossary's *Look up a term* box refuses a word the article does not
 * contain (`[gl-ask-absent]`, `[gl-ask-part-word]`) and offers **Ask in chat**,
 * because chat is the one surface that may answer from outside the piece. Until
 * 2026-09-11 that button only switched mode, so the reader arrived in chat with
 * an empty box and had to type the word a second time. Greg, 2026-09-11,
 * choosing between opening the question in the conversation already on screen
 * and a new one: *"fresh"*.
 *
 * So the claims, each against the whole app — `App` under `StrictMode` and the
 * real nuqs adapter, as `main.tsx` mounts it — because the handoff crosses
 * three components (the glossary panel, `Reader`, the conversation band) and a
 * test of any one of them can pass over a seam that drops the question:
 *
 * 1. the question arrives in a **fresh** conversation's composer, naming the
 *    term **as it was submitted** (trimmed), editable and focused;
 * 2. **zero** chat requests before Send, **exactly one** after — and it goes to
 *    the new conversation, not to the one `?thread=` named on arrival;
 * 3. a long term and one with quotation marks in it are carried as data;
 * 4. the floating chat draft the reader already had is still there when they
 *    come back out of chat mode;
 * 5. a visitor has no box and therefore no button.
 *
 * The harness is tests/a-broken-mode-leaves-the-article-readable.test.tsx's,
 * cut down to what this file needs.
 * docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md § C.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, ChatThread } from "../src/types.js";
import type { PublicArticle } from "../src/public-types.js";
import { ASKED_TERM_ABSENT, ASKED_TERM_PART_WORD } from "../src/messages.js";
import { MODE_LABEL } from "../src/title-text.js";
import { askAboutTerm } from "../src/web/chat-handoff.js";

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

/** Every request the page made, in order, with its body if it had one. */
const trace: { url: string; method: string; body: unknown }[] = [];

const SLUG = "a-piece";
const PARAGRAPH = "The first paragraph of the piece.";

const BLOCKS: PublicArticle["blocks"] = [
  {
    id: "spya-aaaaaa",
    tag: "h1",
    kind: "heading",
    level: 1,
    text: "A piece",
    words: 2,
    html: "<h1>A piece</h1>",
    gistable: false,
  },
  {
    id: "spya-bbbbbb",
    tag: "p",
    kind: "text",
    text: PARAGRAPH,
    words: 6,
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
      title: "A piece",
      gist: "What the piece says.",
    },
  },
};

const ARTICLE: PublicArticle = {
  meta: { slug: SLUG, title: "A piece", byline: "Somebody" },
  blocks: BLOCKS,
  tree: TREE,
  comments: [],
  searches: [],
  assets: undefined,
  navLabelStatus: "ready",
};

const OWNED: Article = {
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  navLabelStatus: "ready",
  meta: { slug: SLUG, title: "A piece", url: "https://example.com/a" },
};

/** A conversation the reader already has, and the one `?thread=` names on arrival. */
const STORED: ChatThread = {
  id: "spya-k3m9qt",
  kind: "chat",
  title: "An earlier conversation",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
  messages: [
    { id: "m1", role: "user", text: "An earlier question", createdAt: "2026-08-27T10:00:00.000Z", status: "done" },
    { id: "m2", role: "assistant", text: "An earlier answer", createdAt: "2026-08-27T10:00:01.000Z", status: "done" },
  ],
};

/** What the ask route refuses with. Set per case. */
let refusal = ASKED_TERM_ABSENT.message;

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
  if (url === `/api/glossary/${SLUG}/ask` && method === "POST") return json({ error: refusal }, 409);
  if (url === `/api/chat/${SLUG}` && method === "POST") return openStream();
  if (method === "POST") return new Response(null, { status: 204 });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/")) return json({ threads: [STORED] });
  if (url.startsWith("/api/glossary/")) return json({ status: "none", glossary: null });
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
  refusal = ASKED_TERM_ABSENT.message;
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

function buttonNamed(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => (b.textContent ?? "").trim() === label,
  );
}

/** Type into the glossary's box and press Look up — the whole of the reader's half. */
async function lookUp(typed: string): Promise<void> {
  const box = host.querySelector<HTMLInputElement>(".gloss-ask-input");
  expect(box, "the owner's glossary draws the Look up a term box").not.toBeNull();
  const input = box as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, typed);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

const chatPosts = () => trace.filter((r) => r.method === "POST" && r.url === `/api/chat/${SLUG}`);
/** Typed chat and every paid child route, including `/live`. */
const chatApiPosts = () =>
  trace.filter((r) => r.method === "POST" && r.url.startsWith(`/api/chat/${SLUG}`));
const askPosts = () => trace.filter((r) => r.method === "POST" && r.url.endsWith("/ask"));

/** The composer of the conversation chat mode has open. */
function composer(): HTMLTextAreaElement | null {
  return host.querySelector<HTMLTextAreaElement>(".mode-band textarea.chat-input");
}

async function askInChat(): Promise<void> {
  const button = buttonNamed("Ask in chat");
  expect(button, "the refusal offers Ask in chat").toBeDefined();
  await act(async () => (button as HTMLButtonElement).click());
  await until(() => param("mode") === "chat" && composer() !== null && param("thread") !== STORED.id);
}

async function send(): Promise<void> {
  const form = composer()?.form;
  expect(form, "the composer is a form").toBeTruthy();
  await act(async () => {
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

describe("Ask in chat, from the glossary's refusal", () => {
  it("opens a fresh conversation holding the question, sends nothing, and sends once on Send", async () => {
    who.set(OWNER);
    /* `?thread=` names a conversation the reader already has, so "fresh" is
       falsifiable: a handoff that wrote into the open conversation would put
       the question under STORED. */
    await open(`?mode=glossary&thread=${STORED.id}`);

    await lookUp("  Bayesian prior  ");
    /* The positive control for the request count below: the harness can see a
       POST, and the box sent the trimmed term. */
    expect(askPosts().map((r) => r.body)).toEqual([{ term: "Bayesian prior" }]);
    expect(host.textContent).toContain("[gl-ask-absent]");

    await askInChat();

    expect(param("mode")).toBe("chat");
    const fresh = param("thread");
    expect(fresh, "a conversation of its own").not.toBeNull();
    expect(fresh).not.toBe(STORED.id);

    const question = askAboutTerm("Bayesian prior");
    expect(question).toContain('"Bayesian prior"');
    expect(composer()?.value, "the question is in the box").toBe(question);
    expect(composer()?.readOnly, "and the box is editable").toBe(false);
    expect(document.activeElement, "and has the caret").toBe(composer());
    expect(composer()?.selectionStart, "at the end, so typing follows the question").toBe(
      question.length,
    );
    expect(host.textContent, "the old conversation is not what is open").not.toContain(
      "An earlier question",
    );
    expect(chatApiPosts(), "nothing is sent until the reader presses Send").toHaveLength(0);

    await send();

    expect(chatPosts(), "exactly one request, on Send").toHaveLength(1);
    expect(chatApiPosts(), "and no other chat or Live request accompanied it").toHaveLength(1);
    const body = chatPosts()[0]?.body as { threadId: string; question: string };
    expect(body.question).toBe(question);
    expect(body.threadId).toBe(fresh);
    expect(body.threadId).not.toBe(STORED.id);
  });

  it("carries what the reader edited, not the handed-over text", async () => {
    who.set(OWNER);
    await open("?mode=glossary");
    await lookUp("axiom");
    await askInChat();

    const box = composer() as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "Is an axiom the same as an assumption?");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await send();

    expect(chatPosts().map((r) => (r.body as { question: string }).question)).toEqual([
      "Is an axiom the same as an assumption?",
    ]);
  });

  it("offers the door on a part-word refusal too, and carries a long term with quotes in it as data", async () => {
    who.set(OWNER);
    refusal = ASKED_TERM_PART_WORD.message;
    await open("?mode=glossary");
    /* Eighty characters is the box's own limit, and quotation marks are the
       characters most likely to be mistaken for structure on the way. */
    const term = `"the so-called 'hard problem'" of consciousness, as Chalmers put it in 1995`;
    expect(term.length).toBeLessThanOrEqual(80);
    await lookUp(term);
    await askInChat();

    expect(composer()?.value).toBe(askAboutTerm(term));
    expect(composer()?.value).toContain(term);
    expect(chatApiPosts()).toHaveLength(0);
  });

  it("leaves the floating chat draft the reader already had where it was", async () => {
    who.set(OWNER);
    await open("?mode=glossary");

    /* A draft about the paragraph, opened from its gutter — the one kind of
       chat draft that survives a mode switch, because `Reader` holds it. */
    const chip = host.querySelector<HTMLButtonElement>(
      'tr[data-block="spya-bbbbbb"] button[aria-label="Chat about this paragraph"]',
    );
    expect(chip, "the paragraph offers a chat").not.toBeNull();
    await act(async () => chip?.click());
    await settle();
    const floating = () => host.querySelector(".chat-dialog");
    expect(host.textContent, "the floating draft opened on the paragraph").toContain(PARAGRAPH);
    const before = floating()?.textContent ?? "";
    expect(before).toContain(PARAGRAPH);

    await lookUp("axiom");
    await askInChat();
    expect(composer()?.value).toBe(askAboutTerm("axiom"));

    /* Back out to the glossary: the floating draft is there again, about the
       same paragraph, and carries none of the glossary's question. */
    const glossary = [...host.querySelectorAll<HTMLButtonElement>('.dock-modes [role="radio"]')].find(
      (b) => b.getAttribute("aria-label") === MODE_LABEL.glossary,
    );
    await act(async () => glossary?.click());
    await until(() => param("mode") === "glossary");
    expect(floating()?.textContent ?? "", "the floating draft came back").toContain(PARAGRAPH);
    expect(floating()?.textContent ?? "").not.toContain("axiom");
    expect(chatApiPosts()).toHaveLength(0);
  });

  it("gives a visitor no box, and so no paid door", async () => {
    await open("?mode=glossary");
    expect(host.textContent, "the visitor's article rendered").toContain(PARAGRAPH);
    expect(host.querySelector(".gloss-ask-input")).toBeNull();
    expect(buttonNamed("Ask in chat")).toBeUndefined();
    expect(askPosts()).toHaveLength(0);
    expect(chatApiPosts()).toHaveLength(0);
  });
});
