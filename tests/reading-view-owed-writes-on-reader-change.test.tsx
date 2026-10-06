// @vitest-environment jsdom
/**
 * **A write the reading view owes as it unmounts is not sent as the next
 * reader.** docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md § Stage 2;
 * the class is docs/postmortems/261006g-work-made-for-one-reader-outlives-a-change-of-reader.md.
 *
 * Reader A has an article open. Another tab signs in as reader B. The auth
 * listener in `api.ts` hears first, so by the time React unmounts A's view
 * the tab holds B's token, and every write made from a cleanup is *made*
 * under B. Each case here types or reads as A, changes the reader, lets the
 * view go the way `ArticlePage` lets it go, and asks one thing of the real
 * `api.ts`: that no write left carrying B's token.
 *
 * `api.ts` is real and so is each component; only the SDK and `fetch` are
 * stood in. Every case was red before its call site named its reader.
 */
import { act, createElement, type ReactNode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Article, BlockId } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom's storages are shadowed by Node's own globals here (tests/add-page-purpose.test.tsx). */
const session = new Map<string, string>();
Object.defineProperty(window, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => void session.set(key, value),
    removeItem: (key: string) => void session.delete(key),
    clear: () => session.clear(),
  },
});

/* ---- The SDK: who is signed in, and everybody who asked to be told. ---- */

interface FakeSession {
  access_token: string;
  user: { id: string };
}
let signedIn: FakeSession | null = null;
const listeners = new Set<(event: string, session: FakeSession | null) => void>();
const sessionOf = (id: string): FakeSession => ({ access_token: `TOKEN-${id}`, user: { id } });

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: signedIn } }),
      refreshSession: async () => ({ data: { session: signedIn } }),
      onAuthStateChange: (fn: (event: string, session: FakeSession | null) => void) => {
        listeners.add(fn);
        return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
      },
    },
  },
  googleSignInAvailable: false,
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: { supported: false, armed: false, transcribing: false },
    readOnly: false,
    busy: false,
    toggle: () => {},
  }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => null,
  DictationStrip: () => null,
}));
/* As tests/metadata-origin.test.tsx: `?at=` and the dock are not what this is about. */
vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [null, () => {}],
}));
vi.mock("../src/web/Dock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/Dock.js")>()),
  Dock: () => null,
}));
vi.mock("../src/web/scroll.js", () => ({ stickyOffset: () => 0 }));

const { SignedInReader } = await import("../src/web/lib/made-for.js");
const { useProfile } = await import("../src/web/useProfile.js");
const { WrittenForYou } = await import("../src/web/WrittenForYou.js");
const { PurposePrompt } = await import("../src/web/PurposePrompt.js");
const { Metadata } = await import("../src/web/Metadata.js");
const { useComments } = await import("../src/web/useComments.js");
const { useReadingTime } = await import("../src/web/useReadingTime.js");

/* ---- The network: every request, and whose token it carried. ---- */

const SLUG = "a-paper";
interface Sent {
  url: string;
  method: string;
  as: string | null;
  body: unknown;
}
let sent: Sent[] = [];
/** What `GET /api/reader` answers: the two halves of A's profile. */
let stored: { profile: string | null; purpose: string | null } = { profile: null, purpose: null };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function answer(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  sent.push({ url, method, as: new Headers(init.headers).get("Authorization"), body });
  const path = url.split("?")[0] ?? url;
  if (method !== "GET") {
    if (path.startsWith("/api/comments/")) return Promise.resolve(json({ comment: { ...body, status: "none" } }));
    return Promise.resolve(json({ ...body }));
  }
  if (path === "/api/reader") return Promise.resolve(json({ ...stored, purposeFailed: false }));
  if (path.startsWith("/api/metadata/")) {
    return Promise.resolve(
      json({ slug: SLUG, dir: `data/${SLUG}`, stages: [], comments: 0, profile: null, purpose: stored.purpose, archivedAt: null }),
    );
  }
  if (path.startsWith("/api/comments/")) return Promise.resolve(json({ comments: [] }));
  if (path.startsWith("/api/reading-time/")) return Promise.resolve(json({ seconds: {} }));
  return Promise.resolve(json({}));
}

/** Every write that carried B's token. The whole claim of this file is that it is empty. */
const writtenAsB = () =>
  sent.filter((r) => r.method !== "GET" && r.as === "Bearer TOKEN-B").map((r) => `${r.method} ${r.url}`);
/** And the control: A's own writes still go, so the fence is not simply a wall. */
const writtenAsA = () =>
  sent.filter((r) => r.method !== "GET" && r.as === "Bearer TOKEN-A").map((r) => `${r.method} ${r.url}`);

/* ---- The page: `App`'s provider, and the reading view under it. ---- */

let host: HTMLDivElement;
let root: Root;

/** What `App` draws for a signed-in reader: their id above the page. */
function draw(reader: string, page: ReactNode): void {
  act(() => {
    root.render(createElement(SignedInReader.Provider, { value: reader }, page));
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function announce(id: string): void {
  signedIn = sessionOf(id);
  for (const tell of [...listeners]) tell("SIGNED_IN", signedIn);
}

/**
 * Another tab signs in as B: the SDK tells `api.ts`, and only then does React
 * draw B's page, which has no reading view in it yet (`useArticleAccess`
 * answers LOADING for a new reader).
 */
async function becomeB(): Promise<void> {
  announce("B");
  draw("B", null);
  await settle();
}

function type(el: HTMLTextAreaElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => void unhandled.push(reason);

beforeEach(() => {
  sent = [];
  stored = { profile: "About A.", purpose: "Why A is reading." };
  session.clear();
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
  vi.stubGlobal("fetch", answer);
  const proto = window.HTMLDialogElement?.prototype;
  if (proto) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  for (const tell of [...listeners]) tell("SIGNED_OUT", null);
  announce("A");
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  process.off("unhandledRejection", onUnhandled);
});

describe("a write the view owes as it unmounts, after the reader changed", () => {
  it("the profile panel does not write A's About me or purpose as B", async () => {
    draw("A", createElement(WrittenForYou, { written: true, changed: false, slug: SLUG }));
    await act(async () => host.querySelector<HTMLButtonElement>("button.prof-badge")?.click());
    await settle();
    const boxes = [...document.querySelectorAll<HTMLTextAreaElement>(".prof-panel textarea")];
    expect(boxes.map((b) => b.value)).toEqual(["About A.", "Why A is reading."]);
    type(boxes[0]!, "About A, and more that B must never have.");
    type(boxes[1]!, "A's own reason.");

    await becomeB();

    expect(writtenAsB()).toEqual([]);
  });

  it("the profile page's box does not either, even if it was drawn once for B first", async () => {
    let profile!: ReturnType<typeof useProfile>;
    function Page() {
      profile = useProfile();
      return null;
    }
    draw("A", createElement(Page));
    await settle();
    act(() => profile.setDraft("About A, typed and not saved."));

    /* The page is not under the article's gate, so it outlives the change. */
    announce("B");
    draw("B", createElement(Page));
    await settle();
    act(() => profile.commit());
    await settle();
    draw("B", null);
    await settle();

    expect(writtenAsB()).toEqual([]);
    expect(unhandled).toEqual([]);
  });

  it("the first-open purpose prompt does not write A's purpose as B", async () => {
    stored = { profile: null, purpose: null };
    session.set("spideryarn.ask-purpose", SLUG);
    draw("A", createElement(PurposePrompt, { slug: SLUG }));
    await settle();
    const box = host.querySelector<HTMLTextAreaElement>("textarea");
    if (!box) throw new Error("the prompt did not open");
    type(box, "A's reason, half typed.");

    await becomeB();

    expect(writtenAsB()).toEqual([]);
  });

  it("the metadata page does not write A's purpose as B", async () => {
    draw(
      "A",
      createElement(Metadata, { slug: SLUG, article: article(), onRenamed: () => {}, onVisibility: () => {} }),
    );
    await settle();
    const box = host.querySelector<HTMLTextAreaElement>("#article-purpose");
    if (!box) throw new Error("no purpose box on the metadata page");
    expect(box.value).toBe("Why A is reading.");
    type(box, "A's reason, changed and not saved.");

    await becomeB();

    expect(writtenAsB()).toEqual([]);
  });

  it("a draft comment is not stored as B: on unmount, and on pagehide", async () => {
    const draft = { id: "c-261006f-1", blockId: "spya-aaaaaa" as BlockId, body: "A's note." };
    let comments!: ReturnType<typeof useComments>;
    let stored_: Promise<unknown> | null = null;
    /* `AnnotateDialog`, as far as this goes: a child whose cleanup stores the draft. */
    function Box() {
      useEffect(
        () => () => {
          stored_ = comments.create(draft);
        },
        [],
      );
      return null;
    }
    function View() {
      comments = useComments(SLUG);
      return createElement(Box);
    }
    draw("A", createElement(View));
    await settle();
    expect(comments.loaded).toBe(true);
    const whileMounted = comments;

    announce("B");
    /* The page is going, in the moment before React has drawn anything for B. */
    whileMounted.createOnLeave({ ...draft, id: "c-261006f-2" });
    draw("B", null);
    await settle();

    expect(writtenAsB()).toEqual([]);
    /* The refusal is one more failed create to the caller, and nobody else hears. */
    expect(await stored_).toBeNull();
    expect(unhandled).toEqual([]);
  });

  it("reading time is not counted for B: on unmount, and on pagehide", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    const table = document.createElement("table");
    const row = document.createElement("tr");
    row.dataset.block = "spya-aaaaaa";
    row.getBoundingClientRect = () => ({ top: 0, bottom: 400, height: 400 }) as DOMRect;
    const tbody = document.createElement("tbody");
    tbody.append(row);
    table.append(tbody);
    document.body.append(table);

    let time!: ReturnType<typeof useReadingTime>;
    const words = new Map([["spya-aaaaaa" as BlockId, 230]]);
    function View() {
      time = useReadingTime(SLUG, words, true);
      return null;
    }
    const tick = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };
    draw("A", createElement(View));
    await tick(50);
    time.setCounting(true);
    await tick(5_000);

    announce("B");
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(writtenAsB()).toEqual([]);

    /* And the ordinary request, from the cleanup: more seconds, then the view goes. */
    announce("A");
    await tick(5_000);
    /* The control: there are seconds to send, and A's own page hiding sends them. */
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(writtenAsA()).toEqual([`POST /api/reading-time/${SLUG}`]);
    await tick(5_000);
    announce("B");
    draw("B", null);
    await tick(50);

    expect(writtenAsB()).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

describe("queued comment writes keep their mounted reader", () => {
  it.each(["edit", "place", "recolour"] as const)("a queued %s is not sent as B", async (kind) => {
    let comments!: ReturnType<typeof useComments>;
    function View() { comments = useComments(SLUG); return null; }
    draw("A", createElement(View));
    await settle();
    let release!: () => void;
    vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
      const response = answer(url, init);
      if (init.method === "PATCH" && !release) {
        return new Promise<Response>((resolve) => { release = () => { void response.then(resolve); }; });
      }
      return response;
    });
    let first!: Promise<void>;
    act(() => { first = comments.edit("comment-a", "A's first words"); });
    await settle();
    expect(writtenAsA()).toHaveLength(1);
    let queued!: Promise<void>;
    act(() => {
      queued = kind === "edit" ? comments.edit("comment-a", "A's queued words")
        : kind === "place" ? comments.place("comment-a", { criterionId: "criterion-a", valence: null })
        : comments.recolour("comment-a", "yellow");
    });
    await becomeB();
    release();
    await act(async () => { await first; await queued; });
    expect(writtenAsB()).toEqual([]);
  });

  it("a create's late deletion is not sent as B", async () => {
    let comments!: ReturnType<typeof useComments>;
    function View() { comments = useComments(SLUG); return null; }
    draw("A", createElement(View));
    await settle();
    let release!: () => void;
    vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
      const response = answer(url, init);
      if (init.method === "POST") {
        return new Promise<Response>((resolve) => { release = () => { void response.then(resolve); }; });
      }
      return response;
    });
    let created!: Promise<unknown>;
    act(() => {
      created = comments.create({ id: "comment-a", blockId: "spya-aaaaaa" as BlockId, body: "A's words" });
    });
    await settle();
    act(() => { comments.remove("comment-a"); });
    await becomeB();
    release();
    await act(async () => { await created; });
    expect(writtenAsB()).toEqual([]);
  });
});

describe("and the reader's own writes still go", () => {
  it("the profile panel's unmount save is sent for A while the tab is A's", async () => {
    draw("A", createElement(WrittenForYou, { written: true, changed: false, slug: SLUG }));
    await act(async () => host.querySelector<HTMLButtonElement>("button.prof-badge")?.click());
    await settle();
    const boxes = [...document.querySelectorAll<HTMLTextAreaElement>(".prof-panel textarea")];
    type(boxes[0]!, "About A, changed.");
    draw("A", null);
    await settle();
    expect(writtenAsA()).toEqual(["PATCH /api/reader"]);
  });

  it("a visitor's view, which names nobody, is unfenced", async () => {
    /* No provider: `useMadeFor` answers null, as it does on a shared link. */
    let time!: ReturnType<typeof useComments>;
    function View() {
      time = useComments(SLUG);
      return null;
    }
    act(() => root.render(createElement(View)));
    await settle();
    time.createOnLeave({ id: "c-261006f-3", blockId: "spya-aaaaaa" as BlockId });
    await settle();
    expect(writtenAsA()).toEqual([`POST /api/comments/${SLUG}`]);
  });
});

function article(): Article {
  return {
    highPowerSince: null,
    titleOverridden: false,
    meta: { slug: SLUG, title: "A paper" },
    blocks: [
      {
        id: "spya-aaaaaa",
        tag: "p",
        kind: "text",
        text: "A paragraph.",
        words: 2,
        html: "<p>A paragraph.</p>",
        gistable: true,
      },
    ],
    assets: undefined,
    navLabelStatus: "ready",
    sourceGuess: undefined,
    tree: {
      version: "t",
      generator: "t",
      slug: SLUG,
      rootId: "n0",
      nodes: {
        n0: { id: "n0", depth: 0, parent: null, children: [], range: ["spya-aaaaaa", "spya-aaaaaa"], title: "A paper" },
      },
    },
  } as unknown as Article;
}
