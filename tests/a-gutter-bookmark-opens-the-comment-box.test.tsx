// @vitest-environment jsdom
/**
 * **Pressing the gutter's bookmark opens the comment box on it.**
 *
 * A bookmark used to be a silent mark: one press and nothing on screen said
 * where to add words, short of selecting text and reaching for the AI. Now the
 * press stores a whole-block bookmark (one POST, a `blockId` and no `quote`),
 * and once the store confirms, the comment dialog opens on the new comment with
 * its own box, whose placeholder says the AI does not reply, and `?note=` names
 * it. Nothing is sent to chat.
 *
 * 1. the owner presses `.blk-bookmark`: one POST, no quote; then `.cmt-dialog`
 *    is open on that id with the "the AI doesn’t reply" box, and no chat call;
 * 2. a failed store opens nothing and leaves `?note=` unset; a retry opens it;
 * 3. a surface the reader opens while the store answers stays in front.
 *
 * Whole app (`App` under `StrictMode`, real nuqs adapter), because the press
 * crosses BlockGutter, Reader and CommentDialog. Harness cut down from
 * tests/glossary-ask-in-chat.test.tsx.
 * docs/plans/261002j-visible-bookmark-comment-without-ai-and-comment-kinds-in-the-margin.md,
 * SPIDERYARN-READING2-9C.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";
import type { PublicArticle } from "../src/public-types.js";

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
  meta: { slug: SLUG, title: "A piece", url: "https://example.com/a" },
};

/** The status the comments POST answers with. Set per case. */
let storeStatus = 200;
/** When set, the comments POST waits for it — a slow store. */
let held: Promise<void> | null = null;
/** The experimental-features switch, as `/api/reader` answers it. Debate is behind it. */
let experimentalSince: string | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function reply(url: string, method: string, body: unknown): Response {
  if (url === `/api/public/article/${SLUG}`) return json(ARTICLE);
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  if (url === "/api/reader") return json({ experimentalSince });
  if (url === `/api/comments/${SLUG}` && method === "POST") {
    if (storeStatus !== 200) return json({ error: "no" }, storeStatus);
    const b = body as { id: string; blockId: string };
    return json({
      comment: {
        id: b.id,
        blockId: b.blockId,
        status: "none",
        createdAt: "2026-10-02T10:00:00.000Z",
      },
    });
  }
  if (method === "POST") return new Response(null, { status: 204 });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/")) return json({ threads: [] });
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
  storeStatus = 200;
  held = null;
  experimentalSince = null;
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
    if (held && method === "POST" && url === `/api/comments/${SLUG}`) {
      return held.then(() => reply(url, method, body));
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

/** `?note=` is written behind nuqs' throttle, so a single read is a race. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 60 && !check(); i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  await settle();
}

const commentPosts = () =>
  trace.filter((r) => r.method === "POST" && r.url === `/api/comments/${SLUG}`);
const chatRequests = () => trace.filter((r) => r.url.startsWith("/api/chat/") && r.method !== "GET");

async function pressBookmark(): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>(
    'tr[data-block="spya-bbbbbb"] .blk-bookmark',
  );
  expect(button, "the owner's paragraph offers a bookmark").not.toBeNull();
  expect(button?.getAttribute("aria-label")).toBe("Bookmark this paragraph");
  await act(async () => button?.click());
  await settle();
}

describe("the gutter's bookmark button", () => {
  it("stores a whole-block bookmark, then opens the comment box on it", async () => {
    who.set(OWNER);
    await open("");
    await pressBookmark();

    const posts = commentPosts();
    expect(posts, "exactly one store").toHaveLength(1);
    const sent = posts[0]?.body as Record<string, unknown>;
    expect(sent.blockId).toBe("spya-bbbbbb");
    expect(sent).not.toHaveProperty("quote");
    expect(sent).not.toHaveProperty("start");

    await until(() => host.querySelector(".cmt-dialog") !== null);
    const dialog = host.querySelector(".cmt-dialog");
    expect(dialog, "the comment dialog opened").not.toBeNull();
    expect(dialog?.getAttribute("aria-label")).toBe("Bookmark");
    const box = dialog?.querySelector<HTMLTextAreaElement>("textarea.cmt-note");
    expect(box, "with its comment box").not.toBeNull();
    expect(box?.placeholder).toContain("the AI doesn’t reply");
    await until(() => param("note") === sent.id);
    expect(param("note")).toBe(sent.id);
    expect(chatRequests(), "nothing was asked of the AI").toHaveLength(0);
  });

  /* GPT Sol, P1 on plan 261002j: an answer arriving after the reader opened
     something else must not replace it. */
  it("does not open over a chat the reader started while the store was answering", async () => {
    who.set(OWNER);
    let release!: () => void;
    held = new Promise<void>((go) => {
      release = go;
    });
    await open("");
    await pressBookmark();
    expect(commentPosts()).toHaveLength(1);

    const chat = host.querySelector<HTMLButtonElement>('tr[data-block="spya-bbbbbb"] .block-chat');
    await act(async () => chat?.click());
    await settle();
    expect(host.querySelector(".chat-dialog"), "the chat draft opened").not.toBeNull();

    await act(async () => release());
    await settle(12);
    expect(param("note")).toBeNull();
    expect(host.querySelector(".cmt-dialog")).toBeNull();
    expect(host.querySelector(".chat-dialog"), "the chat is still what is open").not.toBeNull();
  });

  it("does not open over a mode band the reader chose while the store was answering", async () => {
    who.set(OWNER);
    let release!: () => void;
    held = new Promise<void>((go) => {
      release = go;
    });
    await open("");
    await pressBookmark();

    const summary = host.querySelector<HTMLButtonElement>('.dock-modes button[aria-label="Summary"]');
    expect(summary, "the mode button exists").not.toBeNull();
    await act(async () => summary?.click());
    await until(() => param("mode") === "summary");
    expect(host.querySelector(".mode-band"), "the mode band opened").not.toBeNull();

    await act(async () => release());
    await settle(12);
    expect(param("note")).toBeNull();
    expect(host.querySelector(".cmt-dialog")).toBeNull();
    expect(param("mode"), "the chosen mode is still open").toBe("summary");
  });

  /* **A sub-mode is a foreground choice too, and all six of them are.** The
     snapshot the late answer is checked against named five sub-mode parameters
     by hand and left Debate's out (it arrived later, 4b502174a), so Reception →
     Claims while the store answered changed nothing the check could see, and
     the box opened over the view the reader had just chosen. The snapshot is
     built from a `Record<ModeWithSubModes, …>` now (Reader.tsx § `surface`).

     The first case is the control: without it, "no box" would also be what a
     Debate band that never let the box open looks like.

     **The view is changed through the address**, as the command bar's
     sub-mode row and a Forward step change it, rather than by pressing the
     band's chip: the chips are drawn only over a stored debate, and what is
     under test is `Reader`'s snapshot, which hears the parameter whoever wrote
     it. `enableHistorySync()` above is what makes nuqs hear a `pushState`. */
  const chooseClaims = async () => {
    await act(async () => {
      history.pushState(null, "", `/read/${SLUG}?mode=debate&debate=claims`);
    });
    await settle();
  };

  it("opens over Debate when the reader stayed on the view they were in", async () => {
    who.set(OWNER);
    experimentalSince = "2026-10-01T00:00:00.000Z";
    let release!: () => void;
    held = new Promise<void>((go) => {
      release = go;
    });
    await open("?mode=debate");
    expect(host.querySelector(".mode-band"), "Debate's band is open").not.toBeNull();
    await pressBookmark();
    expect(commentPosts()).toHaveLength(1);

    await act(async () => release());
    await until(() => host.querySelector(".cmt-dialog") !== null);
    expect(host.querySelector(".cmt-dialog"), "nothing changed, so the box opens").not.toBeNull();
  });

  it("does not open over a Debate view the reader chose while the store was answering", async () => {
    who.set(OWNER);
    experimentalSince = "2026-10-01T00:00:00.000Z";
    let release!: () => void;
    held = new Promise<void>((go) => {
      release = go;
    });
    await open("?mode=debate");
    await pressBookmark();
    expect(commentPosts()).toHaveLength(1);

    await chooseClaims();
    expect(param("debate")).toBe("claims");
    expect(param("mode"), "the mode itself did not change").toBe("debate");
    expect(host.querySelector(".mode-band"), "and its band is still open").not.toBeNull();

    await act(async () => release());
    await settle(12);
    expect(param("note")).toBeNull();
    expect(host.querySelector(".cmt-dialog")).toBeNull();
    expect(param("debate"), "the chosen view is still open").toBe("claims");
  });

  it("does not open behind the Comments drawer chosen while the store was answering", async () => {
    who.set(OWNER);
    let release!: () => void;
    held = new Promise<void>((go) => {
      release = go;
    });
    await open("");
    await pressBookmark();

    const comments = host.querySelector<HTMLButtonElement>('.dock button[aria-label="Comments"]');
    expect(comments, "the Comments button exists").not.toBeNull();
    await act(async () => comments?.click());
    await until(() => param("panel") === "questions");
    expect(host.querySelector(".dock-drawer"), "the Comments drawer opened").not.toBeNull();

    await act(async () => release());
    await settle(12);
    expect(param("note")).toBeNull();
    expect(host.querySelector(".cmt-dialog")).toBeNull();
    expect(host.querySelector(".dock-drawer"), "the drawer is still what is open").not.toBeNull();
  });

  /* GPT Sol, P1 on plan 261002j: the button that opened it is gone, replaced
     by the mark, so closing puts focus on the mark rather than nowhere. */
  it("hands focus to the paragraph's new mark when the dialog closes", async () => {
    who.set(OWNER);
    await open("");
    await pressBookmark();
    await until(() => host.querySelector(".cmt-dialog") !== null);
    const close = host.querySelector<HTMLButtonElement>(".cmt-dialog .cmt-close");
    await act(async () => close?.click());
    await until(() => host.querySelector(".cmt-dialog") === null);
    const mark = host.querySelector('tr[data-block="spya-bbbbbb"] .blk-cmt');
    expect(mark, "the paragraph has its mark").not.toBeNull();
    expect(document.activeElement).toBe(mark);
  });

  it("opens nothing when the store fails", async () => {
    who.set(OWNER);
    storeStatus = 500;
    await open("");
    await pressBookmark();
    await settle();

    expect(commentPosts().length, "the press did try to store").toBeGreaterThanOrEqual(1);
    expect(host.querySelector(".cmt-dialog")).toBeNull();
    expect(param("note")).toBeNull();
  });

  it("reuses the failed press on retry, then opens the confirmed bookmark", async () => {
    who.set(OWNER);
    storeStatus = 500;
    await open("");
    await pressBookmark();
    expect(host.querySelector(".cmt-dialog"), "the failed press opened a dialog").toBeNull();
    const firstId = (commentPosts()[0]?.body as { id?: string } | undefined)?.id;
    expect(firstId, "the failed press sent an id").toBeTruthy();

    storeStatus = 200;
    await pressBookmark();
    await until(() => host.querySelector(".cmt-dialog") !== null);
    const posts = commentPosts();
    expect(posts).toHaveLength(2);
    expect((posts[1]?.body as { id?: string } | undefined)?.id, "the retry changed identity").toBe(firstId);
    expect(param("note")).toBe(firstId);
    expect(host.querySelector(".cmt-dialog"), "the confirmed retry opened the dialog").not.toBeNull();
  });
});
