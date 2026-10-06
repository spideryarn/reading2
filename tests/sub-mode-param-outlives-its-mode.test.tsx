// @vitest-environment jsdom
/**
 * **A sub-mode parameter outlives its mode, on purpose — and the one place
 * that costs something.**
 *
 * `learn=quiz` beside `mode=chat` was reported as a leak (qi-e99pjdz2). It
 * is a decision: the Dock writes `mode` alone, so every sub-mode parameter
 * (`learn`, `diagram`, `referee`, `summary`, `structure`, `debate`) stays in
 * the address when the reader leaves its mode, and that is what returns them to
 * the half or the picture they chose when they press the mode again. The first
 * half of this file pins that, so the next reader of the address finds a
 * decision rather than an omission. It passed from the day it was written.
 *
 * The second half is the defect keeping it leaves (GPT Sol, F2 of the 261004l
 * plan review). With `learn=quiz` retained and a Chat conversation open,
 * pressing Learn used to write `mode` alone: Learn mounted on Quiz with
 * the Chat thread still selected, and `LearnBand` cleared `thread` an effect
 * later. params.ts § `learnParam` rule 1 says Quiz and a cleared `thread`
 * are **one navigation**. So these assert the frames the Quiz half is rendered
 * with, from its first, and not the address after the repair effect has run —
 * that address is right with or without the fix.
 *
 * Through the real page, exactly as `main.tsx` mounts it; the harness is
 * tests/headings-crumbs-wiring.test.tsx's.
 * docs/plans/261004l-four-small-queued-fixes-fetch-failure-sentences-composer-focus-stale-remember-param-marginalia-head-at-the-top.md § C
 * docs/project/url-state.md § a sub-mode parameter outlives its mode.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicArticle } from "../src/public-types.js";
import type { Article, ChatThread } from "../src/types.js";
import { modeLinkHref } from "../src/web/Dock.js";
import { returnToSubMode, subModeParams } from "../src/web/sub-modes.js";

const who = vi.hoisted(() => {
  const user: { id: string; email: string } | null = { id: "sub-mode-owner", email: "owner@example.com" };
  return { get: () => user };
});

vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: who.get(), loading: false }),
}));

/* Hoisted: this file imports Dock.js statically, which subscribes at import. */
const authListeners = vi.hoisted(() => [] as ((event: string, session: unknown) => void)[]);

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

/**
 * **Every frame the Quiz half is rendered with**: what the address state said
 * each time `LearnBand` drew `QuizPanel`. The stub reads the same nuqs keys
 * the band does, so a frame in which Quiz is up with a thread still selected
 * is recorded here whether or not the address ever shows it (nuqs moves React
 * first and may fold the repair into the same history write).
 */
const quizFrames = vi.hoisted(() => [] as { mode: string; learn: string; thread: string | null }[]);

vi.mock("../src/web/QuizPanel.js", async (original) => {
  const real = await original<typeof import("../src/web/QuizPanel.js")>();
  const { useQueryStates } = await import("nuqs");
  const { modeParam, learnParam, threadParam } = await import("../src/web/params.js");
  function QuizPanel() {
    const [frame] = useQueryStates({ mode: modeParam, learn: learnParam, thread: threadParam });
    quizFrames.push({ mode: frame.mode, learn: frame.learn, thread: frame.thread });
    return createElement("div", { className: "quiz-stub" });
  }
  return { ...real, QuizPanel };
});

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

const SLUG = "a-sub-mode-piece";
const PARAGRAPH = "The paragraph the piece is made of.";
const THREAD_ID = "spya-t4read";

const BLOCKS: PublicArticle["blocks"] = [
  {
    id: "spya-s1aaaa",
    tag: "p",
    kind: "text",
    text: PARAGRAPH,
    words: 7,
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
      range: ["spya-s1aaaa", "spya-s1aaaa"],
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

/** A Chat conversation, so `?thread=` names something Chat keeps open. */
const CHAT: ChatThread = {
  id: THREAD_ID,
  kind: "chat",
  title: "Something I asked",
  createdAt: "2026-10-04T10:00:00.000Z",
  updatedAt: "2026-10-04T10:00:00.000Z",
  messages: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function reply(url: string, method: string): Response {
  if (url === `/api/public/article/${SLUG}`) return json(ARTICLE);
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  /* The switch is on. Learn was behind it when this was written; since
     2026-10-05 only its Explore part is (docs/project/experimental-features.md). */
  if (url === "/api/reader") return json({ experimentalSince: "2026-10-02T00:00:00.000Z" });
  if (method === "POST") return new Response(null, { status: 204 });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/")) return json({ threads: [CHAT] });
  if (url === "/api/jobs") return json({ jobs: [] });
  return json({});
}

const { App } = await import("../src/web/App.js");
const { AppBoundary } = await import("../src/web/AppBoundary.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  quizFrames.length = 0;
  resetExperimental();
  vi.stubGlobal("innerWidth", 1400);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(reply(String(input), init?.method ?? "GET")),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
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

/** Wait for the address to say something: nuqs throttles its history writes. */
async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  expect(check(), what).toBe(true);
}

const param = (key: string): string | null => new URLSearchParams(location.search).get(key);

async function open(search: string): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}${search}`);
  await act(async () => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(NuqsAdapter, null, createElement(AppBoundary, null, createElement(App, null))),
      ),
    );
  });
  await act(async () => {
    const user = who.get();
    for (const fn of [...authListeners]) fn("SIGNED_IN", user && { user });
  });
  await settle();
  expect(host.textContent, "the article is up").toContain(PARAGRAPH);
}

/** A press on one of the bar's mode buttons, by its accessible name. */
async function pressMode(label: string): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>(`button[role="radio"][aria-label="${label}"]`);
  expect(button, `the bar draws no ${label} button`).not.toBeNull();
  await act(async () => button?.click());
  await settle();
}

describe("a sub-mode parameter outlives its mode", () => {
  it("leaving Learn's Quiz for Chat keeps `learn=quiz`, and pressing Learn again opens Quiz", async () => {
    await open("?mode=learn&learn=quiz");
    expect(host.querySelector(".quiz-stub"), "Quiz is the half that is open").not.toBeNull();

    await pressMode("Chat");
    await until(() => param("mode") === "chat", "Chat never opened");
    expect(param("learn"), "kept beside another mode, on purpose").toBe("quiz");
    expect(host.querySelector(".quiz-stub"), "and inert there: Chat's band, not the Quiz").toBeNull();

    await pressMode("Learn");
    await until(() => param("mode") === "learn", "Learn never opened");
    expect(param("learn")).toBe("quiz");
    expect(host.querySelector(".quiz-stub"), "back on the half the reader chose").not.toBeNull();
  });
});

describe("returning to Learn's Quiz from a Chat conversation", () => {
  it("opens Quiz and clears the thread in one navigation: no frame has both", async () => {
    await open(`?mode=chat&learn=quiz&thread=${THREAD_ID}`);
    expect(param("thread"), "Chat keeps its conversation selected").toBe(THREAD_ID);
    expect(param("learn")).toBe("quiz");
    expect(quizFrames, "Quiz is not drawn under Chat").toEqual([]);
    const push = vi.spyOn(history, "pushState");

    await pressMode("Learn");
    await until(() => param("mode") === "learn" && param("thread") === null, "Learn's Quiz never opened");

    expect(quizFrames.length, "the Quiz half was drawn").toBeGreaterThan(0);
    expect(
      quizFrames.filter((f) => f.thread !== null),
      "Quiz was drawn with the Chat conversation still selected",
    ).toEqual([]);
    expect(quizFrames.every((f) => f.mode === "learn" && f.learn === "quiz")).toBe(true);
    /* One entry, and it is the whole trip: nothing pushed carries the pair. */
    const pushed = push.mock.calls.map((call) => new URL(String(call[2]), location.href).searchParams);
    expect(pushed.filter((p) => p.get("mode") === "learn")).toHaveLength(1);
    expect(pushed.some((p) => p.get("learn") === "quiz" && p.get("thread") !== null)).toBe(false);

    await act(async () => history.back());
    await until(
      () => param("mode") === "chat" && param("thread") === THREAD_ID,
      "one Back did not return to the Chat conversation",
    );
  });

  it("leaves `thread` alone on the way back to Recall, Tutorial or Explore, as before", () => {
    /* Each of those bands overrules a stale thread itself and writes its own
       (ConversationModes.tsx § ConversationBand); only Quiz has no thread. */
    for (const view of ["recall", "tutorial", "explore"] as const) {
      expect(returnToSubMode("learn", { learn: view })).toBeNull();
    }
    expect(returnToSubMode("learn", { learn: "quiz" })).toEqual(
      subModeParams({ mode: "learn", view: "quiz" }),
    );
    /* And only for Learn: another mode's press writes `mode` alone. */
    expect(returnToSubMode("chat", { learn: "quiz" })).toBeNull();
    expect(returnToSubMode("diagram", { learn: "quiz" })).toBeNull();
  });
});

describe("the metadata page's plain Learn link", () => {
  /* The carried query string keeps everything but `panel=` (router.ts §
     `carriedSearch`), so a reader who went from a Chat conversation to the
     metadata page with `learn=quiz` retained really does carry both. */
  it("does not carry a Chat thread into Quiz", () => {
    const href = modeLinkHref(SLUG, `mode=chat&learn=quiz&thread=${THREAD_ID}&at=spya-s1aaaa`, "learn");
    const url = new URL(href, "https://example.com");
    expect(url.pathname).toBe(`/read/${SLUG}`);
    expect(url.searchParams.get("mode")).toBe("learn");
    expect(url.searchParams.get("learn")).toBe("quiz");
    expect(url.searchParams.get("thread"), "Quiz and a thread in one address").toBeNull();
    expect(url.searchParams.get("at"), "the reader's place still travels").toBe("spya-s1aaaa");
  });

  it("keeps the thread when the retained half is not Quiz, and for every other mode's link", () => {
    const recall = new URL(modeLinkHref(SLUG, `mode=chat&thread=${THREAD_ID}`, "learn"), "https://example.com");
    expect(recall.searchParams.get("thread")).toBe(THREAD_ID);
    const tutorial = new URL(
      modeLinkHref(SLUG, `mode=chat&learn=tutorial&thread=${THREAD_ID}`, "learn"),
      "https://example.com",
    );
    expect(tutorial.searchParams.get("thread")).toBe(THREAD_ID);
    expect(tutorial.searchParams.get("learn")).toBe("tutorial");
    const chat = new URL(
      modeLinkHref(SLUG, `mode=glossary&learn=quiz&thread=${THREAD_ID}`, "chat"),
      "https://example.com",
    );
    expect(chat.searchParams.get("thread")).toBe(THREAD_ID);
    expect(chat.searchParams.get("learn"), "the sub-mode parameter outlives its mode here too").toBe("quiz");
  });
});
