// @vitest-environment jsdom
/**
 * **A selection can be added to the glossary** — Greg, 2026-10-28
 * (spya-turkg3): *"When I highlight a piece of text, it gives me the option to
 * highlight or comment it. Okay, great. Can we also have the option to add it
 * to the glossary?"*
 *
 * The press is the command bar's *Look up "X"* with the selected words as X
 * (command-proposal.ts § `glossaryProposalFor`): an entry that already names
 * them is opened, and anything else goes to the Glossary band's *Look up a
 * term* box through the one-shot hand-off, which asks once — and a finished
 * answer adds the term for the owner. The band and its one ask are
 * tests/glossary-ask-from-the-command-bar.test.tsx; this file is the two ways
 * in, through the whole app: a finger's chip, and a mouse's fresh box.
 *
 * Harness from tests/selecting-applies-the-highlight.test.tsx, with a glossary
 * that exists and an `/ask` that streams a finished answer. No model is asked.
 * docs/plans/261029d-a-reminder-bar-at-the-top-and-add-a-selection-to-the-glossary.md
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

/** Whether the article has a glossary yet. Set per case. */
let glossaryOn = true;

const enc = new TextEncoder();
const frame = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/** The glossary read, and the look-up stream, as the server would answer them. */
function glossaryReply(url: string, method: string): Response | null {
  if (url === `/api/glossary/${SLUG}/ask` && method === "POST") {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(frame("begin", { term: "two places", blockId: PARA, quote: "two places" }));
        c.enqueue(frame("delta", { text: "What it is" }));
        c.enqueue(
          frame("done", {
            term: "two places",
            blockId: PARA,
            quote: "two places",
            lookup: { answer: "x", citations: [], searches: 0, model: "m", at: "2026-10-29T00:00:00.000Z" },
            added: { kind: "no-glossary" },
          }),
        );
        c.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (url === `/api/glossary/${SLUG}` && method === "GET") {
    if (!glossaryOn) return json(null);
    return json({
      glossary: {
        version: "glossary/3",
        sourceHash: "abc",
        profileHash: null,
        passes: 1,
        entries: [
          {
            id: "spya-gggggg",
            name: "paragraph",
            kind: "concept",
            aliases: [],
            senseHere: "A unit of the piece.",
            blocks: [PARA],
          },
        ],
      },
      stale: false,
      outdated: false,
      profileChanged: false,
    });
  }
  return null;
}

function reply(url: string, method: string, body: unknown): Response {
  const glossary = glossaryReply(url, method);
  if (glossary) return glossary;
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
  glossaryOn = true;
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
const deletes = () => trace.filter((r) => r.method === "DELETE").map((r) => r.url);
const dialog = () => host.querySelector<HTMLElement>(".cmt-dialog");
/** The comment ids painted on the first paragraph, one string per `<mark>`. */
const marks = () =>
  [...host.querySelectorAll<HTMLElement>(`tr[data-block="${PARA}"] mark.cmt`)].map(
    (m) => m.dataset.comment ?? "",
  );
const sentId = (n = 0): string => {
  const post = commentPosts()[n];
  if (!post) throw new Error(`no comment POST number ${n}`);
  return (post.body as { id: string }).id;
};
const button = (re: RegExp) =>
  [...(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) =>
    re.test((b.textContent ?? "").trim()),
  );

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


/* ------------------------------------------------------------------------- */

const ASK = `/api/glossary/${SLUG}/ask`;
const asks = () => trace.filter((r) => r.method === "POST" && r.url === ASK);
const jobPosts = () => trace.filter((r) => r.method === "POST" && r.url.startsWith("/api/jobs"));
const boxButton = (name: string) => button(new RegExp(`^${name}$`));
const chipButtons = () =>
  [...document.querySelectorAll<HTMLButtonElement>("div.touch-select-chips button")].map((b) =>
    (b.textContent ?? "").trim(),
  );
const touch = (type: string) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch" });

/** A finger selects `[start, end)` and the handles come to rest. */
async function touchSelect(start: number, end: number): Promise<void> {
  await act(async () => {
    prose().dispatchEvent(touch("pointerdown"));
    setSelection(start, end);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await act(async () => {
    await new Promise((go) => setTimeout(go, SETTLE_MS + 50));
  });
}

async function tapChip(label: string): Promise<void> {
  const chip = [...document.querySelectorAll<HTMLButtonElement>("div.touch-select-chips button")].find(
    (b) => (b.textContent ?? "").trim() === label,
  );
  if (!chip) throw new Error(`no chip button "${label}"`);
  await act(async () => {
    chip.dispatchEvent(touch("pointerdown"));
    chip.dispatchEvent(touch("pointerup"));
    chip.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await settle();
}

const at = (words: string): [number, number] => {
  const start = PARAGRAPH.indexOf(words);
  if (start < 0) throw new Error(`"${words}" is not in the paragraph`);
  return [start, start + words.length];
};

describe("a mouse's selection: the fresh box offers Add to glossary", () => {
  it("looks up new words: the untouched highlight goes, the box closes, Glossary opens and asks once", async () => {
    await open();
    await drag(...at("two places"));
    const id = sentId();
    const add = boxButton("Add to glossary");
    expect(add, "the button, beside Copy").toBeDefined();
    add?.focus();
    expect(document.activeElement).toBe(add);
    await act(async () => add?.click());
    await until(() => asks().length > 0);
    expect(asks()).toHaveLength(1);
    expect(asks()[0]?.body).toEqual({ term: "two places" });
    expect(deletes(), "the highlight the selection made is taken off").toEqual([`${LIST}/${id}`]);
    expect(marks(), "and its paint").toEqual([]);
    expect(dialog(), "and its box").toBeNull();
    expect(param("mode")).toBe("glossary");
    await until(() => document.activeElement?.matches(".mode-band.gloss") === true);
    expect(document.activeElement, "focus follows the closed box into the labelled band").toBe(
      host.querySelector(".mode-band.gloss"),
    );
    expect(document.activeElement?.matches("input, textarea"), "does not summon a phone keyboard").toBe(
      false,
    );
    expect(jobPosts(), "a look-up, never a glossary run").toEqual([]);
  });

  it("opens an entry that already names the words, and asks nothing", async () => {
    await open();
    await drag(...at("paragraph"));
    const add = boxButton("Add to glossary");
    add?.focus();
    await act(async () => add?.click());
    await until(() => param("mode") === "glossary");
    await until(() => document.activeElement?.matches(".gloss-term-btn") === true);
    expect(param("mode")).toBe("glossary");
    expect(document.activeElement?.closest<HTMLElement>("[data-term-id]")?.dataset.termId).toBe(
      "spya-gggggg",
    );
    expect(asks(), "no model call for a term the glossary has").toEqual([]);
  });

  it("keeps a highlight the reader had already recoloured", async () => {
    await open();
    await drag(...at("two places"));
    await act(async () => swatch("Green")?.click());
    await settle();
    await act(async () => boxButton("Add to glossary")?.click());
    await until(() => asks().length > 0);
    expect(asks(), "the look-up still went").toHaveLength(1);
    expect(deletes()).toEqual([]);
  });

  it("is not offered for words longer than a term", async () => {
    await open();
    await drag(0, 85);
    expect(boxButton("Copy, don.t highlight"), "the box is the fresh one").toBeDefined();
    expect(boxButton("Add to glossary")).toBeUndefined();
  });

  it("is not offered on an article with no glossary yet: that press would have to generate one", async () => {
    glossaryOn = false;
    await open();
    await drag(...at("two places"));
    expect(boxButton("Copy, don.t highlight")).toBeDefined();
    expect(boxButton("Add to glossary")).toBeUndefined();
  });
});

describe("a finger's selection: the chip has a second button", () => {
  it("looks the words up without highlighting them, and puts the selection away", async () => {
    await open();
    await touchSelect(...at("two places"));
    expect(chipButtons()).toEqual(["Highlight or comment", "Add to glossary"]);
    await tapChip("Add to glossary");
    await until(() => asks().length > 0);
    expect(asks()).toHaveLength(1);
    expect(asks()[0]?.body).toEqual({ term: "two places" });
    expect(commentPosts(), "nothing highlighted").toHaveLength(0);
    expect(window.getSelection()?.isCollapsed ?? true, "the handles and callout are put away").toBe(true);
    expect(param("mode")).toBe("glossary");
  });

  it("has one button when there is no glossary to add to", async () => {
    glossaryOn = false;
    await open();
    await touchSelect(...at("two places"));
    expect(chipButtons()).toEqual(["Highlight or comment"]);
  });

  it("and for a visitor, no chip at all", async () => {
    who.set(null);
    await open();
    await touchSelect(...at("two places"));
    expect(chipButtons()).toEqual([]);
  });
});
