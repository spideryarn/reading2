// @vitest-environment jsdom
/**
 * **The bar's two *Find more* rows** — Stage 2 of
 * docs/plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md.
 *
 * Greg, 2026-10-04 (spya-rbxrgc):
 *
 * > There are lots of cases where we have a sort of find more button, for
 * > example in the glossary mode. Let's make that be part of the command bar as
 * > well.
 *
 * What a happy path would not see:
 *
 *  - **A row is drawn only while its list can be added to** (GPT Sol's F3):
 *    the reading view hands the bar a press per band, and hands none when the
 *    read says there is no list, or the run would rewrite it, or it is full.
 *    Never to a visitor, never on the Metadata page.
 *  - **An absent verdict is not an append** (F2).
 *  - **`find more …` is also what the `find` verb takes** (F5): the rows come
 *    first, and the *Find “more …” in this article* row after them.
 *  - **Enter posts nothing and arms nothing**: it leaves a one-shot hand-off
 *    and opens the band with the plain mode setter. The band's half is
 *    tests/find-more-from-the-command-bar.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODE_CATALOG } from "../src/mode-catalog.js";
import { MAX_QUOTES_TOTAL, type Block, type Glossary, type Job, type Quotes } from "../src/types.js";
import type { CommandExecutor } from "../src/web/command-proposal.js";
import { EXPERIMENTAL_OFF } from "./helpers/experimental-fixtures.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: { supported: false, armed: false, transcribing: false, toggle: () => {} },
    readOnly: false,
    busy: false,
    toggle: () => {},
  }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({ DictationButton: () => null, DictationStrip: () => null }));

const { Dock } = await import("../src/web/Dock.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { chatExecutor, readingExecutor } = await import("../src/web/command-runners.js");
const { pendingActivation, resetActivations } = await import("../src/web/activation.js");
const {
  FIND_MORE_MODES,
  findMoreCommand,
  findMoreWords,
  freshRunOffered,
  glossaryAppendOnOffer,
  glossaryFindMoreOffered,
  quotesAppendOnOffer,
  quotesFindMoreOffered,
} = await import("../src/web/find-more.js");
const { handOffFindMore, pendingFindMore, resetFindMoreForTests, takeFindMore } = await import(
  "../src/web/find-more-handoff.js"
);

const SLUG = "a-piece";
const BLOCKS: Block[] = [];

afterEach(() => {
  resetFindMoreForTests();
  resetActivations();
  vi.useRealTimers();
});

/* ------------------------------------------------------------- the words -- */

describe("the words a Find more row answers to", () => {
  it("is one row per band that has the button, named for its mode", () => {
    expect([...FIND_MORE_MODES]).toEqual(["glossary", "quotes"]);
    expect(findMoreWords("glossary").label).toBe("Glossary › Find more");
    expect(findMoreWords("quotes").label).toBe("Quotes › Find more");
  });

  it.each(FIND_MORE_MODES)("spells every phrase out for every name %s answers to", (mode) => {
    const { aliases } = findMoreWords(mode);
    for (const name of [mode, ...MODE_CATALOG[mode].aliases]) {
      for (const phrase of [`find more ${name}`, `more ${name}`, `${name} find more`, `add more ${name}`]) {
        expect(aliases, phrase).toContain(phrase);
      }
    }
    expect(aliases).toContain("find more");
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("is a typed-only row that generates and is never run from a sentence without a press", () => {
    const row = findMoreCommand("glossary", () => ({ kind: "close" }));
    expect(row).toMatchObject({
      kind: "action",
      id: "find-more-glossary",
      generates: true,
      typedOnly: true,
      opensOnly: false,
    });
  });

  it("names no figure in what the reader is told", () => {
    for (const mode of FIND_MORE_MODES) expect(findMoreWords(mode).description).not.toMatch(/[$£€]|\bcents?\b/);
  });
});

/* -------------------------------------------------- when one is on offer -- */

const LIST = { entries: [] } as unknown as Glossary;
const JOB = { id: "job-1" } as unknown as Job;
const quotesOf = (n: number): Quotes => ({ quotes: Array.from({ length: n }, () => ({})) }) as unknown as Quotes;

describe("whether the glossary's list can be added to (the row's gate)", () => {
  const read = { status: "ready", glossary: LIST, panelRun: "append" } as const;

  it("is so for a settled read, a list, and the server's own word that the run appends", () => {
    expect(glossaryAppendOnOffer(read)).toBe(true);
  });

  it.each([
    ["the read is still out", { ...read, status: "loading" }],
    ["the read failed", { ...read, status: "error" }],
    ["there is no list", { ...read, status: "none", glossary: null }],
    ["the run would rewrite it", { ...read, panelRun: "rewrite" }],
    ["the server gave no verdict (F2)", { ...read, panelRun: undefined }],
  ] as const)("is not when %s", (_, state) => {
    expect(glossaryAppendOnOffer(state)).toBe(false);
  });
});

describe("whether a fresh Find more is what the glossary band offers now (F1)", () => {
  const idle = {
    status: "ready",
    glossary: LIST,
    panelRun: "append",
    job: null,
    starting: false,
    failed: null,
    rewriting: false,
  } as const;

  it("is so when nothing is out and the list can be added to", () => {
    expect(glossaryFindMoreOffered(idle)).toBe(true);
  });

  it.each([
    ["a job is running", { ...idle, job: JOB }],
    ["the POST is out", { ...idle, starting: true }],
    ["a run failed and offers Retry", { ...idle, failed: { message: "x", retryable: true, retry: () => {} } }],
    ["a POST was refused", { ...idle, failed: { message: "x", retryable: true, retry: null } }],
    ["a run failed for good", { ...idle, failed: { message: "x", retryable: false, retry: null } }],
    ["a forced run's list has not loaded", { ...idle, rewriting: true }],
    ["the run would rewrite", { ...idle, panelRun: "rewrite" }],
    ["there is no verdict", { ...idle, panelRun: undefined }],
    ["there is no list", { ...idle, status: "none", glossary: null }],
  ] as const)("is not when %s", (_, state) => {
    expect(glossaryFindMoreOffered(state)).toBe(false);
  });

  it("shares the run-is-idle half with the band's own row", () => {
    expect(freshRunOffered({ job: null, starting: false, failed: null })).toBe(true);
    expect(freshRunOffered({ job: JOB, starting: false, failed: null })).toBe(false);
    expect(freshRunOffered({ job: null, starting: true, failed: null })).toBe(false);
    expect(freshRunOffered({ job: null, starting: false, failed: { message: "x", retryable: true, retry: null } })).toBe(
      false,
    );
  });
});

describe("whether the quotes' list can be added to, and whether Find more is offered now", () => {
  const read = { status: "ready", quotes: quotesOf(3), stale: false, outdated: false } as const;
  const idle = { ...read, job: null, starting: false, failed: null } as const;

  it("is so for a current list under the ceiling", () => {
    expect(quotesAppendOnOffer(read)).toBe(true);
    expect(quotesFindMoreOffered(idle)).toBe(true);
    expect(quotesAppendOnOffer({ ...read, quotes: quotesOf(MAX_QUOTES_TOTAL - 1) })).toBe(true);
  });

  it.each([
    ["the read is still out", { ...idle, status: "loading" }],
    ["there is no list", { ...idle, status: "none", quotes: null }],
    ["the article moved", { ...idle, stale: true }],
    ["an older prompt chose them", { ...idle, outdated: true }],
    ["the list is full", { ...idle, quotes: quotesOf(MAX_QUOTES_TOTAL) }],
  ] as const)("is neither when %s", (_, state) => {
    expect(quotesAppendOnOffer(state)).toBe(false);
    expect(quotesFindMoreOffered(state)).toBe(false);
  });

  it.each([
    ["a job is running", { ...idle, job: JOB }],
    ["the POST is out", { ...idle, starting: true }],
    ["a run failed and offers Retry", { ...idle, failed: { message: "x", retryable: true, retry: () => {} } }],
    ["a POST was refused", { ...idle, failed: { message: "x", retryable: true, retry: null } }],
    ["a run failed for good", { ...idle, failed: { message: "x", retryable: false, retry: null } }],
  ] as const)("is drawn but not offered now when %s", (_, state) => {
    expect(quotesAppendOnOffer(state)).toBe(true);
    expect(quotesFindMoreOffered(state)).toBe(false);
  });
});

/* ------------------------------------------------------------ the hand-off -- */

describe("the hand-off", () => {
  it("is taken once, by the band it was left for, on the article it was left for", () => {
    handOffFindMore(SLUG, "glossary");
    const nonce = pendingFindMore(SLUG, "glossary");
    expect(nonce).not.toBeNull();
    expect(pendingFindMore(SLUG, "quotes")).toBeNull();
    expect(pendingFindMore("another-piece", "glossary")).toBeNull();
    expect(takeFindMore("another-piece", "glossary", nonce ?? -1)).toBe(false);
    expect(takeFindMore(SLUG, "quotes", nonce ?? -1)).toBe(false);
    expect(takeFindMore(SLUG, "glossary", (nonce ?? -1) + 1)).toBe(false);
    expect(takeFindMore(SLUG, "glossary", nonce ?? -1)).toBe(true);
    expect(takeFindMore(SLUG, "glossary", nonce ?? -1)).toBe(false);
    expect(pendingFindMore(SLUG, "glossary")).toBeNull();
  });

  it("is gone when the session changes under it", () => {
    handOffFindMore(SLUG, "quotes");
    const nonce = pendingFindMore(SLUG, "quotes") ?? -1;
    jobEngine.reset();
    expect(pendingFindMore(SLUG, "quotes")).toBeNull();
    expect(takeFindMore(SLUG, "quotes", nonce)).toBe(false);
  });

  it("is gone ten seconds after a press nobody took", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T10:00:00.000Z"));
    handOffFindMore(SLUG, "glossary");
    const nonce = pendingFindMore(SLUG, "glossary") ?? -1;
    vi.setSystemTime(new Date("2026-10-04T10:00:09.000Z"));
    expect(pendingFindMore(SLUG, "glossary")).toBe(nonce);
    vi.setSystemTime(new Date("2026-10-04T10:00:10.000Z"));
    expect(pendingFindMore(SLUG, "glossary")).toBeNull();
    expect(takeFindMore(SLUG, "glossary", nonce)).toBe(false);
  });
});

/* ------------------------------------------- the reading view's executor -- */

describe("the reading view's executor", () => {
  it("has no Find more unless it is handed one, and only the one it is handed", () => {
    expect(readingExecutor({ slug: SLUG, blocks: BLOCKS, jump: vi.fn() }).findMore).toBeUndefined();
    const only = readingExecutor({ slug: SLUG, blocks: BLOCKS, jump: vi.fn(), findMore: { glossary: vi.fn() } });
    expect(Object.keys(only.findMore ?? {})).toEqual(["glossary"]);
    const neither = readingExecutor({
      slug: SLUG,
      blocks: BLOCKS,
      jump: vi.fn(),
      findMore: { glossary: undefined, quotes: undefined },
    });
    expect(Object.keys(neither.findMore ?? {})).toEqual([]);
  });

  it("leaves the hand-off and opens the band with the mover it was given — no arming, and closes", () => {
    const open = vi.fn();
    const executor = readingExecutor({ slug: SLUG, blocks: BLOCKS, jump: vi.fn(), findMore: { quotes: open } });
    expect(executor.findMore?.quotes?.()).toEqual({ kind: "close" });
    expect(open).toHaveBeenCalledTimes(1);
    expect(pendingFindMore(SLUG, "quotes")).not.toBeNull();
    expect(pendingFindMore(SLUG, "glossary")).toBeNull();
    expect(pendingActivation(SLUG, "quotes")).toBeNull();
  });

  it("is not something a chat chip can press", () => {
    const reading = readingExecutor({ slug: SLUG, blocks: BLOCKS, jump: vi.fn(), findMore: { glossary: vi.fn() } });
    const chat = chatExecutor({ reading, blocks: BLOCKS, jump: vi.fn(), tags: { edit: vi.fn() }, find: vi.fn() });
    expect(chat.findMore).toBeUndefined();
  });
});

/* -------------------------------------------------------- the rows, drawn -- */

let host: HTMLDivElement;
let root: Root;
let opened: string[];

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", `/read/${SLUG}?at=spya-k3m9qt`);
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
  opened = [];
  jobEngine.reset();
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    posts.push(url);
    if (url === "/api/jobs") return Promise.resolve(new Response(JSON.stringify({ jobs: [] })));
    return Promise.resolve(new Response("{}"));
  });
  posts = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Every address `fetch` was asked for. */
let posts: string[] = [];

/** The executor Reader builds, with a press for each band named. */
function executor(bands: readonly ("glossary" | "quotes")[]): CommandExecutor {
  return readingExecutor({
    slug: SLUG,
    blocks: BLOCKS,
    jump: () => {},
    findMore: {
      glossary: bands.includes("glossary") ? () => opened.push("glossary") : undefined,
      quotes: bands.includes("quotes") ? () => opened.push("quotes") : undefined,
    },
  });
}

function reading(exec?: CommandExecutor): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as tests/command-bar.test.tsx § reading
      createElement(Dock as any, {
        slug: SLUG,
        view: "article",
        mode: "plain",
        onMode: () => {},
        experimental: EXPERIMENTAL_OFF,
        executor: exec,
      }),
    );
  });
}

function metadataPage(): void {
  history.replaceState(null, "", `/read/${SLUG}/metadata`);
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the metadata page's Dock has no onMode, on purpose
      createElement(Dock as any, { slug: SLUG, view: "metadata", experimental: EXPERIMENTAL_OFF }),
    );
  });
}

const dialog = (): HTMLDialogElement => host.querySelector("dialog.cmdbar") as HTMLDialogElement;
const input = (): HTMLInputElement => dialog().querySelector("input.cmdbar-input") as HTMLInputElement;
const listed = (): string[] =>
  [...dialog().querySelectorAll<HTMLElement>('[role="option"]')].map(
    (r) => r.querySelector(".cmdbar-name")?.textContent ?? "",
  );

function openBar(): void {
  act(() => host.querySelector<HTMLButtonElement>(".dock-commands")?.click());
}

function type(text: string): void {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function enter(): Promise<void> {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

const GLOSSARY = "Glossary › Find more";
const QUOTES = "Quotes › Find more";

describe("the rows, in the bar", () => {
  it("waits to be typed for: the list the bar opens on has neither", () => {
    reading(executor(["glossary", "quotes"]));
    openBar();
    expect(listed()).not.toContain(GLOSSARY);
    expect(listed()).not.toContain(QUOTES);
  });

  it("puts both ahead of the Find “more” row for a bare `find more`", () => {
    reading(executor(["glossary", "quotes"]));
    openBar();
    type("find more");
    expect(listed()).toEqual([GLOSSARY, QUOTES, "Find “more” in this article"]);
  });

  it("puts the glossary's ahead of the Find “more terms” row for `find more terms`", () => {
    reading(executor(["glossary", "quotes"]));
    openBar();
    type("find more terms");
    expect(listed()).toEqual([GLOSSARY, "Find “more terms” in this article"]);
  });

  it("finds each by the other ways of saying it", () => {
    reading(executor(["glossary", "quotes"]));
    openBar();
    type("more quotes");
    expect(listed()[0]).toBe(QUOTES);
    type("add more terms");
    expect(listed()[0]).toBe(GLOSSARY);
    type("excerpts find more");
    expect(listed()).toEqual([QUOTES]);
  });

  it("still puts the mode first for its own name, and Run again first for `rerun glossary`", () => {
    reading(executor(["glossary", "quotes"]));
    openBar();
    type("glossary");
    expect(listed()[0]).toBe("Glossary");
    expect(listed()).toContain(GLOSSARY);
    type("quotes");
    expect(listed()[0]).toBe("Quotes");
    type("rerun glossary");
    expect(listed()[0]).toBe("Glossary › Run again");
    expect(listed()).not.toContain(GLOSSARY);
  });

  it("draws only the row whose band offers an append", () => {
    reading(executor(["quotes"]));
    openBar();
    type("find more");
    expect(listed()).toEqual([QUOTES, "Find “more” in this article"]);
  });

  it("draws neither when neither band offers one, for a visitor, or on the Metadata page", () => {
    reading(executor([]));
    openBar();
    type("find more");
    expect(listed()).toEqual(["Find “more” in this article"]);

    /* A visitor's executor is the jump alone (tests/command-runners.test.ts). */
    reading(readingExecutor({ slug: SLUG, blocks: BLOCKS, jump: () => {} }));
    type("find more terms");
    expect(listed()).toEqual(["Find “more terms” in this article"]);
  });

  it("draws neither on the Metadata page, which has no band", () => {
    metadataPage();
    openBar();
    type("find more");
    expect(listed()).toEqual(["Find “more” in this article"]);
    type("glossary find more");
    expect(listed()).toEqual([]);
  });

  it("on Enter leaves the hand-off, opens the band, closes — and posts nothing", async () => {
    reading(executor(["glossary", "quotes"]));
    openBar();
    type("find more terms");
    const before = posts.filter((url) => url !== "/api/jobs").length;
    await enter();
    expect(opened).toEqual(["glossary"]);
    expect(dialog().open).toBe(false);
    expect(pendingFindMore(SLUG, "glossary")).not.toBeNull();
    expect(pendingActivation(SLUG, "glossary")).toBeNull();
    expect(posts.filter((url) => url !== "/api/jobs").length).toBe(before);
  });
});
