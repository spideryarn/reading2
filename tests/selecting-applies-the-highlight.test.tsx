// @vitest-environment jsdom
/**
 * **Selecting words applies the highlight, and the box that opens customises
 * or removes it.**
 *
 * > how about if selecting text automatically applies the highlight and also
 * > pops up the fuller box to allow the user to customise (or remove) it, and
 * > they can just click off if they're happy with the highlighting
 * >
 * > — Greg, 2026-10-04
 *
 * Outside Referee mode, letting go of a drag stores a yellow highlight (one
 * POST) and opens `CommentDialog` on that row: the gutter bookmark's pattern
 * (tests/a-gutter-bookmark-opens-the-comment-box.test.tsx), on a selection.
 * While that box is *fresh* (opened by the selection that made its comment):
 * a press anywhere else closes it and keeps the highlight, Delete reads
 * *Remove highlight*, and while the row is untouched *Copy, don't highlight*
 * (or a native copy of the still-selected words) copies and takes it off.
 * An overlapping re-selection in the gesture that closed the box replaces it.
 * Referee mode keeps the draft box (`AnnotateDialog`) and writes nothing.
 *
 * Whole app (`App` under `StrictMode`, real nuqs adapter, real Tooltip), since
 * the press crosses TableView, Reader, useComments and CommentDialog. Harness
 * from the gutter bookmark's test.
 * docs/plans/261004f-selecting-applies-the-highlight-and-the-box-customises-or-removes-it.md
 * § GPT Sol's plan review.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Comment } from "../src/types.js";
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

/**
 * **jsdom collapses the document's selection whenever anything is focused; a
 * browser does not when the thing is a button.** `CommentDialog` focuses its
 * close button on opening, so under jsdom every selection would be gone by the
 * time the box is up, and nothing here could ask what a ⌘C would then copy.
 * Measured 2026-10-04: select text, `button.focus()`, and `toString()` is `""`.
 * A text field is left to jsdom, since focusing one does move the selection.
 */
const jsdomFocus = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function focusKeepingSelection(
  this: HTMLElement,
  options?: FocusOptions,
): void {
  const selection = window.getSelection();
  const kept =
    selection && selection.rangeCount > 0 && !selection.isCollapsed
      ? selection.getRangeAt(0).cloneRange()
      : null;
  jsdomFocus.call(this, options);
  if (!kept || !selection || this.matches("input, textarea, [contenteditable]")) return;
  selection.removeAllRanges();
  selection.addRange(kept);
};

/** Every request the page made, in order, with its body if it had one. */
const trace: { url: string; method: string; body: unknown }[] = [];

const SLUG = "a-piece";
const SECOND_SLUG = "another-piece";
const PARAGRAPH =
  "The first paragraph of the piece carries enough words to be selected in two places at once.";
const SECOND = "A second paragraph, so that there is somewhere else on the page to press.";
const PARA = "spya-bbbbbb";
const OTHER = "spya-cccccc";

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
    id: PARA,
    tag: "p",
    kind: "text",
    text: PARAGRAPH,
    words: 17,
    html: `<p>${PARAGRAPH}</p>`,
    gistable: true,
  },
  {
    id: OTHER,
    tag: "p",
    kind: "text",
    text: SECOND,
    words: 14,
    /* "somewhere else" is a link, for the drag that ends inside one. */
    html: `<p>${SECOND.replace(
      "somewhere else",
      `<a href="#${PARA}">somewhere else</a>`,
    )}</p>`,
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
      range: ["spya-aaaaaa", OTHER],
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

/** What the comment store holds, as the stub server sees it. */
let stored: Comment[] = [];
/** A separate article's rows: comment ids are scoped by article in Postgres. */
let secondStored: Comment[] = [];
/** The status the comments POST answers with. Set per case. */
let storeStatus = 200;
/** When set, the opening GET of the comment list waits for it. */
let heldList: Promise<void> | null = null;
/** When set, every PATCH to a comment waits for it — a colour not yet answered. */
let heldPatch: Promise<void> | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const LIST = `/api/comments/${SLUG}`;

function reply(url: string, method: string, body: unknown): Response {
  if (url === `/api/public/article/${SLUG}`) return json(ARTICLE);
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  if (url === `/api/public/article/${SECOND_SLUG}`) {
    return json({ ...ARTICLE, meta: { ...ARTICLE.meta, slug: SECOND_SLUG, title: "Another piece" } });
  }
  if (url === `/api/article/${SECOND_SLUG}`) {
    return json({ ...OWNED, meta: { ...OWNED.meta, slug: SECOND_SLUG, title: "Another piece" } });
  }
  if (url === "/api/reader") return json({ experimentalSince: null });
  if (url === LIST && method === "POST") {
    if (storeStatus !== 200) return json({ error: "no" }, storeStatus);
    const b = body as { id: string; blockId: string; quote?: string; start?: number; colour?: string };
    const comment = {
      id: b.id,
      blockId: b.blockId,
      ...(b.quote !== undefined ? { quote: b.quote, start: b.start } : {}),
      ...(b.colour ? { colour: b.colour } : {}),
      status: "none",
      createdAt: "2026-10-04T10:00:00.000Z",
    } as Comment;
    stored = [...stored.filter((c) => c.id !== comment.id), comment];
    return json({ comment });
  }
  if (url.startsWith(`${LIST}/`)) {
    const [id, verb] = url.slice(LIST.length + 1).split("/");
    const row = stored.find((c) => c.id === id);
    if (method === "DELETE") {
      stored = stored.filter((c) => c.id !== id);
      return new Response(null, { status: 204 });
    }
    if (method === "PATCH" && row) {
      const patch = body as { colour?: Comment["colour"] | null; body?: string | null };
      const { colour, body: words, ...rest } = row;
      const nextColour = verb === "colour" ? (patch.colour ?? undefined) : colour;
      const nextWords = verb === "colour" ? words : (patch.body ?? undefined);
      const next = {
        ...rest,
        ...(nextColour ? { colour: nextColour } : {}),
        ...(nextWords ? { body: nextWords } : {}),
      } as Comment;
      stored = stored.map((c) => (c.id === id ? next : c));
      return json({ comment: next });
    }
  }
  const secondList = `/api/comments/${SECOND_SLUG}`;
  if (url.startsWith(`${secondList}/`) && method === "DELETE") {
    const id = url.slice(secondList.length + 1);
    secondStored = secondStored.filter((c) => c.id !== id);
    return new Response(null, { status: 204 });
  }
  if (url.startsWith(secondList)) return json({ comments: secondStored });
  if (method === "POST") return new Response(null, { status: 204 });
  if (url.startsWith(LIST)) return json({ comments: stored });
  if (url.startsWith("/api/chat/")) return json({ threads: [] });
  if (url.startsWith("/api/glossary/")) return json({ status: "none", glossary: null });
  if (url === "/api/jobs") return json({ jobs: [] });
  return json({});
}

const { App } = await import("../src/web/App.js");
const { navigate } = await import("../src/web/router.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");
const activation = await import("../src/web/activation.js");
const { SETTLE_MS } = await import("../src/web/TouchSelectionChip.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

const OWNER = { id: "owner-1", email: "a@example.com" };

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  trace.length = 0;
  stored = [];
  secondStored = [];
  storeStatus = 200;
  heldList = null;
  heldPatch = null;
  who.set(OWNER);
  activation.resetActivations();
  resetExperimental();
  window.getSelection()?.removeAllRanges();
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
    if (heldList && method === "GET" && url.startsWith(LIST)) {
      return heldList.then(() => reply(url, method, body));
    }
    if (heldPatch && method === "PATCH") return heldPatch.then(() => reply(url, method, body));
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
  Reflect.deleteProperty(navigator, "clipboard");
});

async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function open(search = ""): Promise<void> {
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

const commentPosts = () => trace.filter((r) => r.method === "POST" && r.url === LIST);
const chatPosts = () => trace.filter((r) => r.method === "POST" && r.url === `/api/chat/${SLUG}`);
const deletes = () => trace.filter((r) => r.method === "DELETE").map((r) => r.url);
const dialog = () => host.querySelector<HTMLElement>(".cmt-dialog");
const draftBox = () => host.querySelector<HTMLElement>(".annotate-dialog");
/** The comment ids painted on the first paragraph, one string per `<mark>`. */
const marks = () =>
  [...host.querySelectorAll<HTMLElement>(`tr[data-block="${PARA}"] mark.cmt`)].map(
    (m) => m.dataset.comment ?? "",
  );
const painted = () => marks().join(" ");
const sentId = (n = 0): string => {
  const post = commentPosts()[n];
  if (!post) throw new Error(`no comment POST number ${n}`);
  return (post.body as { id: string }).id;
};
const button = (re: RegExp) =>
  [...(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) =>
    re.test((b.textContent ?? "").trim()),
  );

describe("Ask in chat while Chat is already open", () => {
  it("sends the follow-up at the press instead of hiding it until a later mode change", async () => {
    const comment: Comment = {
      id: "spya-cmt777",
      blockId: PARA,
      quote: PARAGRAPH.slice(4, 19),
      start: 4,
      createdAt: "2026-10-06T10:00:00.000Z",
      status: "done",
      answer: "The bumps are the observations the model has to explain.",
    };
    stored = [comment];
    await open(`?mode=chat&note=${comment.id}`);
    await until(() => dialog() !== null);

    const question = "Why does that follow?";
    const box = dialog()?.querySelector<HTMLInputElement>(
      'input[aria-label="Ask a follow-up question about this passage"]',
    );
    expect(box, "the explanation has its follow-up box").not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(box, question);
      box?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button(/^Ask in chat$/)?.click());
    await until(() => chatPosts().length > 0);

    expect(chatPosts(), "the press is the Send even when Chat was already open").toHaveLength(1);
    expect(chatPosts()[0]?.body).toMatchObject({
      question: expect.stringContaining(question),
      anchor: { blockId: PARA, quote: comment.quote, start: comment.start },
    });
  });
});
const swatch = (name: string) =>
  dialog()?.querySelector<HTMLButtonElement>(`[role="radio"][aria-label="${name}"]`);

const prose = (block = PARA) => {
  const el = host.querySelector<HTMLElement>(`tr[data-block="${block}"] td.text .prose`);
  if (!el) throw new Error(`no prose for ${block}`);
  return el;
};

/** A DOM point at `offset` characters into the block's rendered text. */
function pointAt(within: HTMLElement, offset: number): [Node, number] {
  const walker = document.createTreeWalker(within, NodeFilter.SHOW_TEXT);
  let left = offset;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.textContent?.length ?? 0;
    if (left <= len) return [n, left];
    left -= len;
  }
  throw new Error(`offset ${offset} is past the end of the block`);
}

function setSelection(start: number, end: number, block = PARA): void {
  const el = prose(block);
  const range = document.createRange();
  range.setStart(...pointAt(el, start));
  range.setEnd(...pointAt(el, end));
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** One pointer press, in the order a browser sends it. */
function down(el: Element): void {
  el.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }),
  );
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
}
function up(el: Element): void {
  el.dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse" }),
  );
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
}

/**
 * A whole press on one element: pointerdown, and the click after it, as two
 * turns — a `.click()` alone would miss the order the box depends on.
 *
 * **A press in the prose takes the selection with it**, as a browser's
 * mousedown on text does; a press on a button leaves it. That is said here
 * since the box stopped closing at `pointerdown`: until then the repaint that
 * close caused had collapsed the selection, and no case could tell. (A click on
 * the selected words themselves is the exception, and has its own case.)
 */
async function press(el: Element): Promise<void> {
  await act(async () => {
    down(el);
    if (el.closest("td.text .prose")) window.getSelection()?.removeAllRanges();
  });
  await act(async () => {
    up(el);
  });
  await settle();
}

/**
 * A mouse drag over `[start, end)` of a paragraph. The press lands in the
 * prose and takes the old selection with it, as a browser's mousedown does;
 * the new one is there by the time the button comes up.
 */
async function drag(start: number, end: number): Promise<string> {
  await act(async () => {
    down(prose());
    window.getSelection()?.removeAllRanges();
  });
  await act(async () => {
    setSelection(start, end);
    up(prose());
  });
  await settle();
  return PARAGRAPH.slice(start, end);
}

/** A writable clipboard whose answer the test decides. */
function clipboard(writeText: (t: string) => Promise<void>): string[] {
  const wrote: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (t: string) => {
        wrote.push(t);
        return writeText(t);
      },
    },
  });
  return wrote;
}

describe("letting go of a mouse selection", () => {
  it("stores one yellow highlight, paints it, and opens the comment's own box on it", async () => {
    await open();
    const quote = await drag(4, 19);

    const posts = commentPosts();
    expect(posts, "exactly one store").toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ blockId: PARA, quote, start: 4, colour: "yellow" });
    const id = sentId();

    expect(draftBox(), "not the draft box").toBeNull();
    expect(dialog(), "the comment's box opened").not.toBeNull();
    expect(dialog()?.querySelector(".cmt-quote")?.textContent).toBe(quote);
    expect(painted(), "the words are painted").toContain(id);
    await until(() => param("note") === id);
    expect(param("note")).toBe(id);

    expect(dialog()?.textContent).toContain("Highlighted. Click away to keep it.");
    expect(button(/^Remove highlight$/), "Delete says what it does here").toBeDefined();
    expect(button(/^Delete$/)).toBeUndefined();
    expect(button(/^Copy, don.t highlight$/)).toBeDefined();
    expect(
      dialog()?.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute("aria-label"),
    ).toBe("Yellow");
    /* The paint replaces the paragraph's nodes, which collapses a selection.
       A mouse keeps its words selected, so a native copy still has them. */
    expect(window.getSelection()?.toString()).toBe(quote);
  });

  it("opens the box after the opening read when the list had not loaded", async () => {
    let release!: () => void;
    heldList = new Promise<void>((go) => {
      release = go;
    });
    await open();
    await drag(4, 19);
    expect(commentPosts(), "held behind the opening read").toHaveLength(0);
    expect(dialog()).toBeNull();
    expect(draftBox()).toBeNull();

    await act(async () => release());
    await until(() => dialog() !== null);
    expect(commentPosts()).toHaveLength(1);
    expect(dialog()?.textContent).toContain("Highlighted. Click away to keep it.");
    expect(painted()).toContain(sentId());
  });

  it("does not open over something the reader chose while the create was held", async () => {
    let release!: () => void;
    heldList = new Promise<void>((go) => {
      release = go;
    });
    await open();
    await drag(4, 19);
    const comments = host.querySelector<HTMLButtonElement>('.dock button[aria-label="Comments"]');
    await act(async () => comments?.click());
    await until(() => param("panel") === "questions");

    await act(async () => release());
    await until(() => commentPosts().length === 1);
    await settle(12);
    expect(dialog(), "the drawer is what the reader chose").toBeNull();
    expect(param("note")).toBeNull();
    expect(painted(), "the highlight is still stored and painted").toContain(sentId());
  });

  for (const changeView of [false, true]) {
    it(`a held selection create ${changeView ? "stays closed after changing Debate view" : "opens over unchanged Debate"}`, async () => {
      let release!: () => void;
      heldList = new Promise<void>((go) => { release = go; });
      await open("?mode=peer-review&peer-review=reception");
      expect(param("mode")).toBe("peer-review");
      await drag(4, 19);
      expect(commentPosts()).toHaveLength(0);
      expect(dialog()).toBeNull();
      if (changeView) {
        await act(async () => history.pushState(null, "", `/read/${SLUG}?mode=peer-review&peer-review=claims`));
        await settle();
        expect(param("peer-review")).toBe("claims");
      }
      await act(async () => release());
      await until(() => commentPosts().length === 1);
      await settle(12);
      if (changeView) {
        expect(dialog()).toBeNull();
        expect(param("note")).toBeNull();
      } else {
        await until(() => dialog() !== null);
        expect(dialog()).not.toBeNull();
      }
      expect(painted()).toContain(sentId());
    });
  }

  it("shows nothing as highlighted when the store refuses", async () => {
    storeStatus = 500;
    await open();
    await drag(4, 19);
    await settle(12);
    expect(commentPosts().length).toBeGreaterThanOrEqual(1);
    expect(dialog(), "no box").toBeNull();
    expect(marks(), "no paint").toEqual([]);
    await until(() => param("note") === null);
    expect(param("note")).toBeNull();
  });

  it("a later press inside the table does not highlight the same words twice", async () => {
    await open();
    await drag(4, 19);
    /* A press on a gutter icon leaves the browser's selection where it was. */
    const chat = host.querySelector<HTMLButtonElement>(`tr[data-block="${PARA}"] .block-chat`);
    expect(chat, "the paragraph has its chat icon").not.toBeNull();
    await press(chat!);
    expect(commentPosts(), "still one highlight").toHaveLength(1);
    expect(host.querySelector(".chat-dialog"), "and the icon did its job").not.toBeNull();
    expect(dialog()).toBeNull();
  });

  /* The case with nothing to hide it: while the create is held there is no
     paint, so the words are still selected when the next mouseup in the table
     reads the selection. */
  it("nor while its create is still held behind the opening read", async () => {
    let release!: () => void;
    heldList = new Promise<void>((go) => {
      release = go;
    });
    await open();
    await drag(4, 19);
    expect(window.getSelection()?.toString(), "nothing has repainted the words").toBe(
      PARAGRAPH.slice(4, 19),
    );
    const chat = host.querySelector<HTMLButtonElement>(`tr[data-block="${OTHER}"] .block-chat`);
    expect(chat, "a gutter icon to press").not.toBeNull();
    await press(chat!);
    await act(async () => release());
    await settle(12);
    expect(commentPosts(), "one highlight, not two").toHaveLength(1);
  });
});

describe("the click that ends a drag", () => {
  /* GPT Sol, E4 on plan 261004f. The click handler used to ask the live
     selection whether a drag had just ended; the highlight is now painted
     between the mouseup and the click, and the paint collapses the selection. */
  it("does not follow the link the drag was inside, even once the paint has taken the selection", async () => {
    await open();
    const link = prose(OTHER).querySelector("a")!;
    expect(link, "the second paragraph has its link").not.toBeNull();
    const at = SECOND.indexOf("somewhere else");
    await act(async () => {
      down(link);
      window.getSelection()?.removeAllRanges();
    });
    await act(async () => {
      setSelection(at, at + 9, OTHER);
      link.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    });
    expect(commentPosts(), "the drag was a selection").toHaveLength(1);
    /* What the repaint does in a browser, said outright. The link is a new
       node by now, so the click goes to the one on the page. */
    window.getSelection()?.removeAllRanges();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
    await act(async () => {
      prose(OTHER).querySelector("a")!.dispatchEvent(click);
    });
    expect(click.defaultPrevented, "the browser must not follow it").toBe(true);
  });

  it("does not mistake a later keyboard click for the missing click after a repainted drag", async () => {
    await open();
    const link = prose(OTHER).querySelector("a")!;
    const at = SECOND.indexOf("somewhere else");
    await act(async () => {
      down(link);
      window.getSelection()?.removeAllRanges();
      setSelection(at, at + 9, OTHER);
      link.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    });
    window.getSelection()?.removeAllRanges();
    const keyboardClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: 0,
    });
    await act(async () => {
      prose(OTHER).querySelector("a")!.dispatchEvent(keyboardClick);
    });
    await until(() => param("at") === PARA);
    expect(param("at"), "the stale drag latch swallowed keyboard activation").toBe(PARA);
  });
});

describe("the fresh box: click away to keep it", () => {
  it("a press elsewhere closes it and keeps the highlight", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    await press(prose(OTHER));
    await until(() => param("note") === null);
    expect(dialog()).toBeNull();
    expect(painted()).toContain(id);
    expect(deletes()).toEqual([]);
  });

  /* **The press that closes it decides where the reader is going; the box must
     not take focus back.** Closing restored focus to the opener or the
     paragraph's gutter mark, and `focus()` scrolls its target into view: mid
     press, the page jumped back to the highlight, a drag begun in the prose
     made no selection, and a gutter icon's click landed on something else
     (browser check, 2026-10-04). */
  it("a press elsewhere does not hand focus back to the highlight or its gutter mark", async () => {
    await open();
    await drag(4, 19);
    const focused: Element[] = [];
    const real = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, ...args: []) {
      focused.push(this);
      return real.apply(this, args);
    };
    try {
      await press(prose(OTHER));
      await until(() => param("note") === null);
      await settle();
    } finally {
      HTMLElement.prototype.focus = real;
    }
    expect(dialog()).toBeNull();
    expect(focused.map((el) => el.className || el.tagName)).toEqual([]);
  });

  it("a click on the words just highlighted is a click away, not a request to reopen", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    const mark = host.querySelector<HTMLElement>(`tr[data-block="${PARA}"] mark.cmt`)!;
    await act(async () => {
      down(mark);
      window.getSelection()?.removeAllRanges();
    });
    await act(async () => {
      /* The paint that takes the ring off has replaced the node. */
      up(host.querySelector<HTMLElement>(`tr[data-block="${PARA}"] mark.cmt`)!);
    });
    await until(() => param("note") === null);
    await settle(12);
    expect(dialog(), "it closed and stayed closed").toBeNull();
    expect(param("note")).toBeNull();
    expect(painted()).toContain(id);
    expect(commentPosts()).toHaveLength(1);
  });

  /* A click on selected text does not collapse the selection until after its
     mouseup, and a mouse's words are still selected while the box is open. So
     the mouseup reads the highlight's own anchor again. */
  it("nor a request for a second highlight, when its words are still selected at the mouseup", async () => {
    await open();
    const quote = await drag(4, 19);
    const id = sentId();
    await until(() => param("note") === id);
    expect(window.getSelection()?.toString(), "the words are still selected").toBe(quote);
    const mark = host.querySelector<HTMLElement>(`tr[data-block="${PARA}"] mark.cmt`)!;
    await act(async () => {
      down(mark);
    });
    await act(async () => {
      up(mark);
    });
    await until(() => param("note") === null);
    await settle(12);
    expect(commentPosts(), "one highlight").toHaveLength(1);
    expect(deletes()).toEqual([]);
    expect(dialog(), "closed, and not reopened").toBeNull();
    expect(painted()).toContain(id);
  });

  it("the press that closes it is not swallowed: a Dock button still does its job", async () => {
    await open();
    await drag(4, 19);
    const comments = host.querySelector<HTMLButtonElement>('.dock button[aria-label="Comments"]');
    expect(comments).not.toBeNull();
    await press(comments!);
    await until(() => param("panel") === "questions");
    expect(host.querySelector(".dock-drawer"), "the drawer opened").not.toBeNull();
    expect(dialog(), "and the box went").toBeNull();
    expect(painted()).toContain(sentId());
  });

  it("nor is a gutter icon's", async () => {
    await open();
    await drag(4, 19);
    const bookmark = host.querySelector<HTMLButtonElement>(`tr[data-block="${OTHER}"] .blk-bookmark`);
    expect(bookmark).not.toBeNull();
    await press(bookmark!);
    await until(() => commentPosts().length === 2);
    expect(commentPosts(), "the highlight, then the bookmark").toHaveLength(2);
    expect(commentPosts()[1]?.body).toMatchObject({ blockId: OTHER });
    expect(commentPosts()[1]?.body).not.toHaveProperty("quote");
  });

  it("a press inside the box, or inside something the box portals, does not close it", async () => {
    await open();
    await drag(4, 19);
    const note = dialog()?.querySelector<HTMLTextAreaElement>("textarea.cmt-note");
    await press(note!);
    expect(dialog(), "its own textarea").not.toBeNull();

    /* The Copy button's tooltip is a real portal: it is at the end of <body>,
       outside the box's element. */
    const copy = button(/^Copy, don.t highlight$/)!;
    await act(async () => {
      copy.dispatchEvent(new MouseEvent("mouseenter"));
      await new Promise((go) => setTimeout(go, 700));
    });
    const card = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(card, "the tooltip opened").not.toBeNull();
    expect(dialog()?.contains(card), "and it is not inside the box's element").toBe(false);
    await act(async () => {
      down(card!);
    });
    await settle();
    expect(dialog(), "a press on what the box portals is a press inside it").not.toBeNull();
  });

  it("a box opened from the mark is an ordinary one: a press elsewhere leaves it open", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    await press(prose(OTHER));
    await until(() => dialog() === null);

    const mark = host.querySelector<HTMLElement>(`tr[data-block="${PARA}"] mark.cmt`);
    await act(async () => {
      down(mark!);
      window.getSelection()?.removeAllRanges();
    });
    await act(async () => {
      up(mark!);
    });
    await until(() => param("note") === id);
    expect(dialog()).not.toBeNull();
    expect(dialog()?.textContent).not.toContain("Click away to keep it");
    expect(button(/^Delete$/), "and Delete is Delete").toBeDefined();
    expect(button(/^Copy/), "with no Copy button").toBeUndefined();

    await press(prose(OTHER));
    await settle(12);
    expect(dialog(), "still open").not.toBeNull();
  });

  it("a keyboard activation after click-off can reopen the highlight as an ordinary box", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    await press(prose(OTHER));
    await until(() => dialog() === null);

    const gutterMark = host.querySelector<HTMLButtonElement>(
      `tr[data-block="${PARA}"] .blk-cmt`,
    );
    expect(gutterMark).not.toBeNull();
    await act(async () => {
      gutterMark!.focus();
      gutterMark!.click();
    });
    await until(() => param("note") === id);
    expect(dialog(), "the stale click-off latch ignored the keyboard activation").not.toBeNull();
    expect(dialog()?.textContent).not.toContain("Click away to keep it");
  });

  it("a keyboard activation after touch click-off can reopen the highlight", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    await act(async () => {
      prose(OTHER).dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
        }),
      );
    });
    await act(async () => {
      prose(OTHER).dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
        }),
      );
    });
    expect(dialog(), "touch click-off closes the fresh box").toBeNull();

    const gutterMark = host.querySelector<HTMLButtonElement>(
      `tr[data-block="${PARA}"] .blk-cmt`,
    );
    await act(async () => {
      gutterMark!.focus();
      gutterMark!.click();
    });
    await until(() => param("note") === id);
    expect(dialog(), "the touch gesture left no latch for keyboard activation").not.toBeNull();
    expect(dialog()?.textContent).not.toContain("Click away to keep it");
  });

  it("words typed and not yet committed are stored by the press that closes it", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    const note = dialog()!.querySelector<HTMLTextAreaElement>("textarea.cmt-note")!;
    await act(async () => {
      note.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(note, "worth a second look");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    /* The dispatched press moves no focus, so nothing here blurs the field: the
       words are committed by the box itself, as its press ends. (Until the
       close moved to the end of the gesture this case sent only a pointerdown.) */
    await press(prose(OTHER));
    await until(() => stored.find((c) => c.id === id)?.body !== undefined);
    expect(stored.find((c) => c.id === id)?.body).toBe("worth a second look");
    expect(dialog()).toBeNull();
  });
});

/**
 * **The press that closes the fresh box changes nothing until it ends.**
 *
 * Found in real Chrome, 2026-10-04: with the box open, a mouse drag that began
 * in the highlight's own paragraph made no selection at all. The box closed on
 * `pointerdown`; closing takes the open ring off the mark, which rewrites that
 * paragraph through `innerHTML`; and that happened between `pointerdown` and
 * `mousedown`, so the browser anchored its drag on nodes that were no longer in
 * the document. "Overlap means correction" could not happen with a real mouse,
 * and nor could a second highlight in the same paragraph.
 *
 * jsdom starts no drag, so what is asked is the thing the browser needs: **a
 * text node of that paragraph, held from before the press, is still in the
 * document when the button comes up**, and the box is still open until then.
 */
describe("the press that closes the fresh box does nothing until it ends", () => {
  const firstText = (block = PARA): Text => {
    const node = document.createTreeWalker(prose(block), NodeFilter.SHOW_TEXT).nextNode();
    if (!node) throw new Error("the paragraph has no text");
    return node as Text;
  };
  const pointer = (type: string, pointerType: "mouse" | "touch") =>
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerType });

  /** `drag`, checking at the press what a browser's drag depends on. */
  async function dragInTheSameParagraph(start: number, end: number): Promise<string> {
    const held = firstText();
    const open = sentId(commentPosts().length - 1);
    await act(async () => {
      down(prose());
      window.getSelection()?.removeAllRanges();
    });
    await settle();
    expect(held.isConnected, "the press rewrote the paragraph under the pointer").toBe(true);
    expect(dialog(), "the box is still open while the button is down").not.toBeNull();
    expect(param("note")).toBe(open);
    await act(async () => {
      setSelection(start, end);
      up(prose());
    });
    await settle();
    return PARAGRAPH.slice(start, end);
  }

  it("a drag begun in the highlight's own paragraph still has its nodes, and makes the next highlight", async () => {
    await open();
    await drag(4, 19);
    const first = sentId(0);
    await until(() => param("note") === first);
    /* 41, not 40: the drag begins on a word, so nothing is trimmed. */
    const quote = await dragInTheSameParagraph(41, 55);
    expect(commentPosts()).toHaveLength(2);
    const second = sentId(1);
    expect(commentPosts()[1]?.body).toMatchObject({ quote, start: 41, colour: "yellow" });
    await until(() => param("note") === second);
    expect(dialog(), "the new highlight's box is open").not.toBeNull();
    expect(dialog()?.querySelector(".cmt-quote")?.textContent).toBe(quote);
    expect(dialog()?.textContent, "and it is the fresh one").toContain("Click away to keep it");
    expect(deletes(), "they do not overlap, so both are kept").toEqual([]);
    expect(painted()).toContain(first);
    expect(painted()).toContain(second);
  });

  it("an overlapping drag in that paragraph replaces the untouched highlight: one row left, the new one", async () => {
    await open();
    await drag(4, 19);
    const first = sentId(0);
    await until(() => param("note") === first);
    const quote = await dragInTheSameParagraph(10, 30);
    await until(() => deletes().length > 0);
    const second = sentId(1);
    expect(deletes()).toEqual([`${LIST}/${first}`]);
    expect(stored.map((c) => c.id), "exactly one row").toEqual([second]);
    expect(painted()).not.toContain(first);
    await until(() => param("note") === second);
    expect(dialog()?.querySelector(".cmt-quote")?.textContent).toBe(quote);
  });

  it("an overlapping drag keeps a highlight the reader had recoloured", async () => {
    await open();
    await drag(4, 19);
    const first = sentId(0);
    await act(async () => swatch("Green")?.click());
    await until(() => stored.find((c) => c.id === first)?.colour === "green");
    await dragInTheSameParagraph(10, 30);
    await settle(12);
    expect(deletes()).toEqual([]);
    expect(stored.map((c) => c.id)).toEqual([first, sentId(1)]);
  });

  it("a plain press elsewhere closes the box when the button comes up, not before", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    await until(() => param("note") === id);
    const held = firstText();
    await act(async () => {
      down(prose(OTHER));
      window.getSelection()?.removeAllRanges();
    });
    await settle();
    expect(dialog(), "still open at the press").not.toBeNull();
    expect(held.isConnected).toBe(true);
    await act(async () => {
      up(prose(OTHER));
    });
    await until(() => param("note") === null);
    expect(dialog(), "closed at the release").toBeNull();
    expect(painted(), "and the highlight is kept").toContain(id);
    expect(deletes()).toEqual([]);
  });

  it("a finger's tap elsewhere closes it when the finger lifts", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    await until(() => param("note") === id);
    await act(async () => {
      prose(OTHER).dispatchEvent(pointer("pointerdown", "touch"));
    });
    await settle();
    expect(dialog(), "still open while the finger is down").not.toBeNull();
    await act(async () => {
      prose(OTHER).dispatchEvent(pointer("pointerup", "touch"));
    });
    await until(() => param("note") === null);
    expect(dialog()).toBeNull();
    expect(painted()).toContain(id);
  });

  it("a press the browser cancels closes it too", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    await until(() => param("note") === id);
    await act(async () => {
      prose(OTHER).dispatchEvent(pointer("pointerdown", "touch"));
    });
    await act(async () => {
      prose(OTHER).dispatchEvent(pointer("pointercancel", "touch"));
    });
    await until(() => param("note") === null);
    expect(dialog()).toBeNull();
    expect(painted()).toContain(id);
  });

  /* The choice for a mouse press whose `mouseup` never reaches the window:
     nothing was closed, so nothing is half closed. The box stays open and
     fresh, and the next press is judged on its own. */
  it("a mouse press whose release never arrives leaves the box open and fresh, and the next press decides", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    await until(() => param("note") === id);
    await act(async () => {
      down(prose(OTHER));
    });
    await settle(12);
    expect(dialog(), "no release, no close").not.toBeNull();
    expect(dialog()?.textContent).toContain("Click away to keep it");

    /* A press inside the box does not inherit the abandoned one. */
    await press(dialog()!.querySelector<HTMLTextAreaElement>("textarea.cmt-note")!);
    expect(dialog(), "a press inside is still a press inside").not.toBeNull();
    expect(param("note")).toBe(id);

    await press(prose(OTHER));
    await until(() => param("note") === null);
    expect(dialog(), "and a whole press outside still closes it").toBeNull();
    expect(painted()).toContain(id);
  });
});

describe("the fresh box: remove, and copy", () => {
  it("Remove highlight takes the paint off in one press and keeps nothing", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    await act(async () => button(/^Remove highlight$/)?.click());
    await until(() => deletes().length > 0);
    expect(deletes()).toEqual([`${LIST}/${id}`]);
    expect(marks()).toEqual([]);
    expect(dialog(), "and the box closes").toBeNull();
    await until(() => param("note") === null);
    expect(param("note")).toBeNull();
  });

  it("Copy, don't highlight: copies the words, and only then removes the row", async () => {
    await open();
    const quote = await drag(4, 19);
    const id = sentId();
    let allow!: () => void;
    const wrote = clipboard(
      () =>
        new Promise<void>((go) => {
          allow = go;
        }),
    );
    await act(async () => button(/^Copy, don.t highlight$/)?.click());
    await settle();
    expect(wrote).toEqual([quote]);
    expect(deletes(), "not before the clipboard has answered").toEqual([]);
    expect(painted()).toContain(id);

    await act(async () => allow());
    await until(() => deletes().length > 0);
    expect(deletes()).toEqual([`${LIST}/${id}`]);
    expect(marks()).toEqual([]);
    expect(dialog()).toBeNull();
  });

  it("still removes the highlight when the box closes before the clipboard answers", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    let allow!: () => void;
    clipboard(
      () =>
        new Promise<void>((go) => {
          allow = go;
        }),
    );
    await act(async () => button(/^Copy, don.t highlight$/)?.click());
    await press(prose(OTHER));
    expect(dialog(), "click-off closes the box while the clipboard is pending").toBeNull();
    expect(deletes()).toEqual([]);

    await act(async () => allow());
    await until(() => deletes().length > 0);
    expect(deletes()).toEqual([`${LIST}/${id}`]);
    expect(painted()).not.toContain(id);
  });

  it("claims two successful Copy presses only once", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    const allow: (() => void)[] = [];
    clipboard(
      () =>
        new Promise<void>((go) => {
          allow.push(go);
        }),
    );
    await act(async () => {
      button(/^Copy, don.t highlight$/)?.click();
      button(/^Copy, don.t highlight$/)?.click();
    });

    await act(async () => {
      allow[1]!();
      allow[0]!();
    });
    await settle(12);
    expect(deletes()).toEqual([`${LIST}/${id}`]);
  });

  it("does not delete twice when Remove highlight wins while Copy is pending", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    let allow!: () => void;
    clipboard(
      () =>
        new Promise<void>((go) => {
          allow = go;
        }),
    );
    await act(async () => button(/^Copy, don.t highlight$/)?.click());

    await act(async () => {
      button(/^Remove highlight$/)?.click();
      allow();
    });
    await settle(12);
    expect(deletes()).toEqual([`${LIST}/${id}`]);
  });

  it("keeps a highlight changed after reopening while an old copy is pending", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    let allow!: () => void;
    clipboard(
      () =>
        new Promise<void>((go) => {
          allow = go;
        }),
    );
    await act(async () => button(/^Copy, don.t highlight$/)?.click());
    await press(prose(OTHER));

    const gutterMark = host.querySelector<HTMLButtonElement>(
      `tr[data-block="${PARA}"] .blk-cmt`,
    );
    await act(async () => gutterMark!.click());
    await until(() => param("note") === id);
    await act(async () => swatch("Green")?.click());
    await until(() => stored.find((comment) => comment.id === id)?.colour === "green");

    await act(async () => allow());
    await settle(12);
    expect(deletes(), "the old copy cannot remove the changed row").toEqual([]);
    expect(stored.find((comment) => comment.id === id)?.colour).toBe("green");
  });

  it("keeps words being typed after reopening while an old copy is pending", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    let allow!: () => void;
    clipboard(
      () =>
        new Promise<void>((go) => {
          allow = go;
        }),
    );
    await act(async () => button(/^Copy, don.t highlight$/)?.click());
    await press(prose(OTHER));

    const gutterMark = host.querySelector<HTMLButtonElement>(
      `tr[data-block="${PARA}"] .blk-cmt`,
    );
    await act(async () => gutterMark!.click());
    await until(() => param("note") === id);
    const note = dialog()!.querySelector<HTMLTextAreaElement>("textarea.cmt-note")!;
    await act(async () => {
      note.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(note, "still typing");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => allow());
    await settle(12);
    expect(deletes(), "the old copy cannot discard unblurred words").toEqual([]);
    expect(note.value).toBe("still typing");
    expect(stored.some((comment) => comment.id === id)).toBe(true);
  });

  it("does not apply an old clipboard answer to a same-id row after the article changes", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    let allow!: () => void;
    clipboard(
      () =>
        new Promise<void>((go) => {
          allow = go;
        }),
    );
    await act(async () => button(/^Copy, don.t highlight$/)?.click());
    await press(prose(OTHER));

    /* Comment ids are article-scoped in Postgres. This is a different row even
       though it has the same client-minted id and happens to be pristine. */
    secondStored = stored.map((comment) => ({
      ...comment,
      createdAt: "2026-10-04T11:00:00.000Z",
    }));
    await act(async () => navigate(`/read/${SECOND_SLUG}`));
    await until(
      () =>
        location.pathname === `/read/${SECOND_SLUG}` &&
        host.querySelector(`tr[data-block="${PARA}"] td.text .prose`) !== null,
    );

    await act(async () => allow());
    await settle(12);
    expect(
      deletes(),
      "the old copy deleted the unrelated same-id row in the next article",
    ).not.toContain(`/api/comments/${SECOND_SLUG}/${id}`);
    expect(secondStored.some((comment) => comment.id === id)).toBe(true);
  });

  it("a refused copy says so and keeps the highlight", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    clipboard(() => Promise.reject(new Error("NotAllowedError")));
    await act(async () => button(/^Copy, don.t highlight$/)?.click());
    await settle(12);
    expect(deletes()).toEqual([]);
    expect(painted()).toContain(id);
    expect(dialog(), "the box is still there").not.toBeNull();
    const said = dialog()?.querySelector('.cmt-copy-said[role="status"]')?.textContent ?? "";
    expect(said).toMatch(/would not allow the copy/);
    expect(said).toMatch(/highlight is kept/);
  });

  it("with no clipboard at all, the same", async () => {
    await open();
    await drag(4, 19);
    Reflect.deleteProperty(navigator, "clipboard");
    await act(async () => button(/^Copy, don.t highlight$/)?.click());
    await settle(12);
    expect(deletes()).toEqual([]);
    expect(painted()).toContain(sentId());
    expect(dialog()?.querySelector('.cmt-copy-said[role="status"]')?.textContent).toMatch(
      /highlight is kept/,
    );
  });

  it("a native copy of the still-selected words removes the untouched highlight too", async () => {
    await open();
    await drag(4, 19);
    const id = sentId();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    await act(async () => {
      prose().dispatchEvent(event);
    });
    expect(event.defaultPrevented, "the copy itself is left to the browser").toBe(false);
    await until(() => deletes().length > 0);
    expect(deletes()).toEqual([`${LIST}/${id}`]);
    expect(marks()).toEqual([]);
    expect(dialog()).toBeNull();
  });

  it("a native copy of other words removes nothing", async () => {
    await open();
    await drag(4, 19);
    await act(async () => {
      setSelection(0, 10, OTHER);
      prose(OTHER).dispatchEvent(new Event("copy", { bubbles: true, cancelable: true }));
    });
    await settle(12);
    expect(deletes()).toEqual([]);
    expect(dialog()).not.toBeNull();
  });

  it("a native copy from the note field never removes the highlight", async () => {
    await open();
    await drag(4, 19);
    const note = dialog()!.querySelector<HTMLTextAreaElement>("textarea.cmt-note")!;
    await act(async () => {
      note.focus();
      /* Some browsers retain the document range while the textarea owns the
         caret. The copy target, not that stale range, says what is copied. */
      setSelection(4, 19);
      note.dispatchEvent(new Event("copy", { bubbles: true, cancelable: true }));
    });
    await settle(12);
    expect(deletes()).toEqual([]);
    expect(dialog()).not.toBeNull();
  });

  it("once the reader has changed the highlight, Copy only copies", async () => {
    await open();
    const quote = await drag(4, 19);
    const id = sentId();
    await act(async () => swatch("Green")?.click());
    await until(() => stored.find((c) => c.id === id)?.colour === "green");
    await settle();
    expect(button(/^Copy, don.t highlight$/), "no longer offered").toBeUndefined();
    const plain = button(/^Copy$/);
    expect(plain).toBeDefined();
    const wrote = clipboard(() => Promise.resolve());
    await act(async () => plain?.click());
    await settle(12);
    expect(wrote).toEqual([quote]);
    expect(deletes()).toEqual([]);
    expect(painted()).toContain(id);
    expect(dialog()).not.toBeNull();

    /* And neither does a native copy. */
    await act(async () => {
      setSelection(4, 19);
      prose().dispatchEvent(new Event("copy", { bubbles: true, cancelable: true }));
    });
    await settle(12);
    expect(deletes()).toEqual([]);
  });
});

describe("overlap means correction", () => {
  it("an overlapping re-selection replaces an untouched highlight", async () => {
    await open();
    await drag(4, 19);
    const first = sentId(0);
    const quote = await drag(10, 30);
    await until(() => deletes().length > 0);
    expect(commentPosts()).toHaveLength(2);
    const second = sentId(1);
    expect(commentPosts()[1]?.body).toMatchObject({ quote, start: 10, colour: "yellow" });
    expect(deletes(), "the first is removed").toEqual([`${LIST}/${first}`]);
    expect(painted()).not.toContain(first);
    expect(painted()).toContain(second);
    await until(() => param("note") === second);
    expect(dialog()?.querySelector(".cmt-quote")?.textContent).toBe(quote);
  });

  it("keeps a highlight the reader had changed", async () => {
    await open();
    await drag(4, 19);
    const first = sentId(0);
    await act(async () => swatch("Green")?.click());
    await until(() => stored.find((c) => c.id === first)?.colour === "green");
    await drag(10, 30);
    await settle(12);
    expect(commentPosts()).toHaveLength(2);
    expect(deletes()).toEqual([]);
    expect(stored.map((c) => c.id)).toContain(first);
  });

  it("keeps one whose colour press has not been answered yet", async () => {
    await open();
    await drag(4, 19);
    const first = sentId(0);
    /* The store has not answered the colour press, so the row this tab holds
       is still yellow when the next drag lands. */
    let answer!: () => void;
    heldPatch = new Promise<void>((go) => {
      answer = go;
    });
    await act(async () => swatch("Green")?.click());
    await settle();
    expect(stored.find((c) => c.id === first)?.colour, "not yet stored").toBe("yellow");
    await drag(10, 30);
    await act(async () => answer());
    await settle(12);
    expect(deletes()).toEqual([]);
    expect(stored.map((c) => c.id)).toContain(first);
    expect(stored.find((c) => c.id === first)?.colour).toBe("green");
  });

  it("keeps one that does not overlap", async () => {
    await open();
    await drag(4, 19);
    const first = sentId(0);
    await drag(40, 55);
    await settle(12);
    expect(commentPosts()).toHaveLength(2);
    expect(deletes()).toEqual([]);
    expect(painted()).toContain(first);
    expect(painted()).toContain(sentId(1));
  });

  it("only in the gesture that closed the box: a later overlapping selection keeps both", async () => {
    await open();
    await drag(4, 19);
    await press(prose(OTHER));
    await until(() => dialog() === null);
    await drag(10, 30);
    await settle(12);
    expect(commentPosts()).toHaveLength(2);
    expect(deletes()).toEqual([]);
  });
});

describe("Referee mode keeps the draft box", () => {
  it("a selection opens AnnotateDialog and writes nothing", async () => {
    await open("?mode=referee");
    const quote = await drag(4, 19);
    expect(draftBox(), "the draft box").not.toBeNull();
    expect(draftBox()?.querySelector(".annotate-quote")?.textContent).toBe(quote);
    expect(dialog()).toBeNull();
    expect(commentPosts(), "nothing is stored until the referee says").toHaveLength(0);
    expect(marks()).toEqual([]);
  });

  it("Ask AI stores the comment before sending it with the saved comment id", async () => {
    await open("?mode=referee");
    const quote = await drag(4, 19);
    const words = "How does this support the conclusion?";
    const note = draftBox()?.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Your comment on this passage"]',
    );
    expect(note).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(note, words);
      note?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => draftBox()?.querySelector<HTMLButtonElement>(".annotate-ask-ai")?.click());
    await until(() => chatPosts().length > 0);

    expect(commentPosts()).toHaveLength(1);
    expect(chatPosts()).toHaveLength(1);
    const saved = commentPosts()[0]!;
    const sent = chatPosts()[0]!;
    expect(trace.indexOf(saved), "the free write precedes the paid one").toBeLessThan(
      trace.indexOf(sent),
    );
    expect(saved.body).toMatchObject({ blockId: PARA, quote, start: 4, body: words });
    expect(sent.body).toMatchObject({
      question: expect.stringContaining(words),
      anchor: { blockId: PARA, quote, start: 4 },
      sourceCommentId: (saved.body as { id: string }).id,
    });
  });
});

describe("a finger's selection", () => {
  const touch = (type: string) =>
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch" });

  it("the button applies the highlight, opens the box, and puts the selection away", async () => {
    await open();
    await act(async () => {
      prose().dispatchEvent(touch("pointerdown"));
      setSelection(4, 19);
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(commentPosts(), "a touch selection writes nothing by itself").toHaveLength(0);
    await act(async () => {
      await new Promise((go) => setTimeout(go, SETTLE_MS + 50));
    });
    const chip = document.querySelector<HTMLButtonElement>("button.touch-select-chip");
    expect(chip, "the chip").not.toBeNull();
    await act(async () => {
      chip!.dispatchEvent(touch("pointerdown"));
      chip!.dispatchEvent(touch("pointerup"));
      chip!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(commentPosts()).toHaveLength(1);
    expect(commentPosts()[0]?.body).toMatchObject({ start: 4, colour: "yellow" });
    expect(dialog(), "the comment's box").not.toBeNull();
    expect(draftBox()).toBeNull();
    expect(painted()).toContain(sentId());
    expect(window.getSelection()?.isCollapsed ?? true, "the handles and callout are put away").toBe(
      true,
    );
    expect(document.querySelector("button.touch-select-chip"), "no chip over the box").toBeNull();
    expect(document.activeElement?.tagName, "no text field focused, so no keyboard").not.toBe(
      "TEXTAREA",
    );
  });

  /* With the list in, the paint collapses the selection anyway. This is the
     case where only the press can: nothing is painted until the read lands. */
  it("the selection is put away at the press, even while the create is held", async () => {
    let release!: () => void;
    heldList = new Promise<void>((go) => {
      release = go;
    });
    await open();
    await act(async () => {
      prose().dispatchEvent(touch("pointerdown"));
      setSelection(4, 19);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await act(async () => {
      await new Promise((go) => setTimeout(go, SETTLE_MS + 50));
    });
    const chip = document.querySelector<HTMLButtonElement>("button.touch-select-chip");
    expect(chip, "the chip").not.toBeNull();
    await act(async () => {
      chip!.dispatchEvent(touch("pointerdown"));
      chip!.dispatchEvent(touch("pointerup"));
    });
    expect(marks(), "nothing painted yet").toEqual([]);
    expect(window.getSelection()?.isCollapsed ?? true).toBe(true);
    await act(async () => release());
    await until(() => dialog() !== null);
    expect(commentPosts()).toHaveLength(1);
    expect(dialog(), "and the box opens once the row exists").not.toBeNull();
  });
});
