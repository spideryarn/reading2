// @vitest-environment jsdom
/**
 * **A quick search starts the thorough one by itself, and swaps it in** —
 * plan 261004l. Each case names the plan-review finding it pins (F1–F7,
 * docs/plans/261004l-auto-thorough-plan-review-sol.md).
 *
 * The real `SearchBand` over the real `useSearch`, `apiFetch` mocked, in the
 * shape of tests/search-as-you-type.test.tsx. Real timers: the pause is 600 ms
 * and the settle is `SETTLE_MS`, and the cases wait them out.
 *
 * Every "nothing was asked" sits beside a positive control — a request that
 * *was* sent through the same harness — so a server mock that had stopped
 * recording could not pass as a refusal.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId, SearchHit, SearchRun } from "../src/types.js";
import { assignSlots } from "../src/web/hit-colours.js";
import type { Found } from "../src/web/search-hits.js";
import { PAUSE_MS } from "../src/web/quick-session.js";
import { SETTLE_MS } from "../src/web/modes/search/auto-thorough.js";
import { storedPairs, THOROUGH_PAIR_PREFIX } from "../src/web/modes/search/stored-pairs.js";

let answer: (url: string, init: RequestInit) => Promise<Response>;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = (url: string, init: RequestInit = {}) => answer(url, init);
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}) => {
      const r = await apiFetch(url, init);
      if (!r.ok) throw await real.failure(r);
      return r;
    },
  };
});

/* This jsdom has no `localStorage`; the pairs a reload tidies are kept there
   (stored-pairs.ts). The shim tests/minimal-paper-ui.test.tsx uses. */
const stored = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
    clear: () => stored.clear(),
    get length() {
      return stored.size;
    },
    key: (i: number) => [...stored.keys()][i] ?? null,
  },
});

const { SearchBand } = await import("../src/web/modes/search/SearchMode.js");
const { searchDraftFor } = await import("../src/web/search-draft.js");

const SLUG = "a-paper";
const BLOCK = "spya-k3m9qt" as BlockId;
const BLOCKS: Block[] = [
  {
    id: BLOCK,
    tag: "p",
    kind: "text",
    text: "Thirty-one participants in each arm, with no unexposed comparison group.",
    words: 11,
    html: "<p>Thirty-one participants in each arm, with no unexposed comparison group.</p>",
    gistable: true,
  },
];
const QUICK_HIT: SearchHit = {
  blockId: BLOCK,
  quote: "Thirty-one participants in each arm, with no unexposed comparison group.",
  confidence: 90,
  reasoning: "",
};
const MEANING_HIT: SearchHit = {
  blockId: BLOCK,
  quote: "no unexposed comparison group",
  confidence: 95,
  reasoning: "It names the missing control.",
};

let host: HTMLDivElement;
let root: Root;
let found: Found[] = [];

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
  await flush();
}
/** Wait out the typing pause, and a little more. */
const pause = () => wait(PAUSE_MS + 80);
/** Wait out the settle, and a little more. */
const settle = () => wait(SETTLE_MS + 150);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}
/** One POST the mock server is answering, and the handle to answer it with. */
interface Out {
  id: string;
  criterion: string;
  kind: "quick" | "meaning";
  revises: boolean;
  /** `begin` has been sent; send `done` (or a failed `done`) and close. */
  finish(status?: "done" | "error", hits?: SearchHit[]): void;
  /** Stream one passage, as the model finds it. */
  hit(hit: SearchHit): void;
  /** Close the stream with no `done`: a dropped connection. */
  cut(): void;
}

interface ServerOptions {
  /** `done`: quick answers at once. `hold`: `begin`, then the test finishes it. `http`: a 500. */
  quick?: "done" | "hold" | "http";
  /** `hold`: `begin`, then the test finishes it. `http`: a 500 before any stream. */
  meaning?: "hold" | "http";
  /** `begin` answers a meaning search under this id instead of the one sent. */
  meaningAs?: string;
  /** PATCH answers 500 with this message. */
  patchFails?: string;
  /** What the opening GET answers: the rows saved before this tab loaded. */
  saved?: SearchRun[];
}

/**
 * A server the test drives. The server's `createdAt` rises with every new
 * row, and a revision keeps its row's first one, as the real one does.
 */
function server(options: ServerOptions = {}) {
  const calls: Call[] = [];
  const outs: Out[] = [];
  const config = { quick: "done", meaning: "hold", ...options };
  const born = new Map<string, string>();
  let minute = 0;
  answer = (url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, url, body });
    if (method === "GET") return Promise.resolve(json({ runs: config.saved ?? [] }));
    if (method === "PATCH" && config.patchFails !== undefined) {
      return Promise.resolve(json({ error: config.patchFails }, 500));
    }
    if (method !== "POST") return Promise.resolve(json({ ok: true }));

    const kind = body!.kind as "quick" | "meaning";
    const mode = config[kind];
    if (mode === "http") {
      return Promise.resolve(json({ error: `the ${kind} search could not start` }, 500));
    }
    const id = kind === "meaning" && config.meaningAs !== undefined ? config.meaningAs : String(body!.id);
    if (!born.has(id)) {
      minute += 1;
      born.set(id, `2026-10-04T09:${String(minute).padStart(2, "0")}:00.000Z`);
    }
    const run = {
      id,
      criterion: String(body!.criterion),
      kind,
      createdAt: born.get(id)!,
      status: "pending",
      hits: [] as SearchHit[],
    };
    const enc = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        c.enqueue(enc.encode(`event: begin\ndata: ${JSON.stringify(run)}\n\n`));
      },
    });
    const out: Out = {
      id,
      criterion: run.criterion,
      kind,
      revises: body!.revises === true,
      finish(status = "done", hits = kind === "quick" ? [QUICK_HIT] : [MEANING_HIT]) {
        const done =
          status === "done"
            ? { ...run, status, hits }
            : { ...run, status, hits: [], error: "The model could not answer." };
        controller.enqueue(enc.encode(`event: done\ndata: ${JSON.stringify(done)}\n\n`));
        controller.close();
      },
      hit: (hit) => controller.enqueue(enc.encode(`event: hit\ndata: ${JSON.stringify({ hit })}\n\n`)),
      cut: () => controller.close(),
    };
    outs.push(out);
    if (kind === "quick" && mode === "done") out.finish();
    return Promise.resolve(
      new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
  };
  return {
    calls,
    outs,
    config,
    posts: (kind: "quick" | "meaning") => outs.filter((o) => o.kind === kind),
    /** Every POST of this kind the client sent, answered or refused, by its words. */
    asked: (kind: "quick" | "meaning") =>
      calls.filter((c) => c.method === "POST" && c.body?.kind === kind).map((c) => c.body!.criterion),
    deletes: () => calls.filter((c) => c.method === "DELETE").map((c) => c.url.split("/").at(-1)),
    patches: () => calls.filter((c) => c.method === "PATCH"),
  };
}

function mount({ strict = false, slug = SLUG } = {}): void {
  const band = createElement(
    NuqsAdapter,
    null,
    createElement(SearchBand, {
      slug,
      blocks: BLOCKS,
      onJump: () => {},
      onFound: (next: Found[]) => {
        found = next;
      },
      openHit: null,
      onOpenHit: () => {},
    }),
  );
  act(() => {
    root.render(strict ? createElement(StrictMode, null, band) : band);
  });
}

function must<T extends Element>(selector: string, within: ParentNode = host): T {
  const el = within.querySelector<T>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}
const box = () => must<HTMLInputElement>("input.srch-input");

function type(text: string): void {
  const el = box();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function enter(): void {
  act(() => {
    box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
}
function click(el: Element): void {
  act(() => {
    (el as HTMLElement).click();
  });
}
const matcher = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".srch-mode")].find((b) =>
    b.textContent?.includes(name),
  )!;
const savedRows = () => [...host.querySelectorAll<HTMLElement>(".srch-saved-row")];
/** The saved rows' words, top to bottom. */
const listed = () =>
  savedRows().map((r) => must(".srch-saved-criterion", r).textContent ?? "");
function rowFor(words: string): HTMLElement {
  const row = savedRows().find((r) => must(".srch-saved-criterion", r).textContent === words);
  if (!row) throw new Error(`no saved row for ${words}`);
  return row;
}
const isQuick = (row: HTMLElement) => row.querySelector(".srch-saved-kind") !== null;
function ticked(): string[] {
  return [...host.querySelectorAll<HTMLInputElement>('input[aria-label^="Also mark: "]')]
    .filter((b) => b.checked)
    .map((b) => (b.getAttribute("aria-label") ?? "").slice("Also mark: ".length));
}
/** The palette slot a row is drawn in, read off the custom property it sets. */
const slotOf = (el: HTMLElement) =>
  Number(/--cat-(\d+)-rgb/.exec(el.getAttribute("style") ?? "")?.[1]);
const inUrl = () => new URLSearchParams(location.search).get("runs");
/**
 * `?runs=` is this, or soon will be. nuqs writes the URL on a throttle, so a
 * second write close behind the first lands a few tens of milliseconds after
 * the state it follows; the ticks are the synchronous reading.
 */
async function urlRuns(expected: string): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => expect(inUrl()).toBe(expected));
  });
}
const errorLines = () => [...host.querySelectorAll(".srch-error")].map((e) => e.textContent);

/** Press the row's palette button and pick a hue it is not drawn in. Returns the slot picked. */
async function recolour(words: string): Promise<number> {
  click(must(`button[aria-label="Change the colour of: ${words}"]`));
  await flush(2);
  const swatch = [...document.querySelectorAll<HTMLButtonElement>(".srch-picker-swatch")].find(
    (b) => !b.classList.contains("showing"),
  );
  if (!swatch) throw new Error("the colour picker did not open");
  const slot = Number(/--cat-(\d+)-rgb/.exec(swatch.getAttribute("style") ?? "")?.[1]);
  click(swatch);
  await flush(2);
  return slot;
}

const WORDS = "arguments against";

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", `/read/${SLUG}?mode=search&match=quick`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  found = [];
  // The draft outlives the band (one per article, for the page's life): empty
  // it, or typing the same words as the last case is not an edit at all.
  searchDraftFor(SLUG).set("");
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("a quick search starts the thorough one", () => {
  it("Enter starts thorough as soon as the quick answer lands, and not before", async () => {
    const s = server({ quick: "hold" });
    mount();
    await flush();
    type(WORDS);
    enter();
    await flush();
    // Control: the quick ask went out; nothing thorough until it lands.
    expect(s.asked("quick")).toEqual([WORDS]);
    expect(s.asked("meaning")).toEqual([]);

    act(() => s.posts("quick")[0]!.finish());
    await flush();
    expect(s.asked("meaning")).toEqual([WORDS]);
    // One row, the quick one, saying so quietly; the thorough row is not ticked.
    expect(listed()).toEqual([WORDS]);
    expect(isQuick(rowFor(WORDS))).toBe(true);
    // A spinner the size of the button it stands in for, named for a screen reader.
    const sign = rowFor(WORDS).querySelector(".srch-upgrading");
    expect(sign?.getAttribute("aria-label")).toBe("Thorough search running");
    expect(sign?.querySelector(".srch-spin")).not.toBeNull();
    expect(rowFor(WORDS).querySelector("button.srch-thorough")).toBeNull();
    await urlRuns(s.posts("quick")[0]!.id);
  });

  it("F1: a pause, then Enter on unchanged words, starts it at once", async () => {
    const s = server();
    mount();
    await flush();
    type(WORDS);
    await pause();
    // Control: quick asked and answered by the pause alone; thorough is waiting for the settle.
    expect(s.asked("quick")).toEqual([WORDS]);
    expect(rowFor(WORDS).querySelector("button.srch-thorough")).not.toBeNull();
    expect(s.asked("meaning")).toEqual([]);

    enter();
    await flush();
    expect(s.asked("quick"), "Enter on unchanged words asks no second quick search").toEqual([WORDS]);
    expect(s.asked("meaning")).toEqual([WORDS]);
  });

  it("a pause alone starts it only after the settle", async () => {
    const s = server();
    mount();
    await flush();
    type(WORDS);
    await pause();
    await wait(SETTLE_MS / 2);
    expect(s.asked("quick")).toEqual([WORDS]);
    expect(s.asked("meaning")).toEqual([]);
    await wait(SETTLE_MS / 2 + 150);
    expect(s.asked("meaning")).toEqual([WORDS]);
  });

  it("an earlier Enter does not skip the settle for a later row with the same words", async () => {
    const s = server();
    mount();
    await flush();
    type(WORDS);
    enter();
    await flush();
    act(() => s.posts("meaning")[0]!.finish());
    await flush();
    expect(isQuick(rowFor(WORDS))).toBe(false);

    type("other words");
    type(WORDS);
    await pause();
    expect(s.asked("quick")).toEqual([WORDS, WORDS]);
    expect(s.asked("meaning")).toEqual([WORDS]);
    await settle();
    expect(s.asked("meaning")).toEqual([WORDS, WORDS]);
  });

  it("Enter held until loading still starts its row's thorough search immediately", async () => {
    const s = server();
    const respond = answer;
    let release!: (response: Response) => void;
    answer = (url, init) => (init.method ?? "GET") === "GET"
      ? new Promise<Response>((resolve) => { release = resolve; })
      : respond(url, init);
    mount();
    await flush();
    type(WORDS);
    enter();
    type("other words");
    await pause();
    expect(s.asked("quick")).toEqual([]);

    act(() => release(json({ runs: [] })));
    await flush();
    expect(s.asked("quick")).toEqual([WORDS, "other words"]);
    expect(s.asked("meaning")).toEqual([WORDS]);
    await settle();
    expect(s.asked("meaning")).toEqual([WORDS, "other words"]);
  });

  it("leaving Search mode before the settle starts nothing", async () => {
    const s = server();
    mount();
    await flush();
    type(WORDS);
    await pause();
    expect(s.asked("quick")).toEqual([WORDS]);
    await act(async () => root.unmount());
    await settle();
    expect(s.asked("meaning")).toEqual([]);
    // (Its control is the case above: the same steps, still mounted, do ask.)
    root = createRoot(host);
  });

  it("F2: an edit just before the settle deadline is not answered with the old words", async () => {
    const s = server();
    mount();
    await flush();
    type(WORDS);
    await pause();
    await wait(SETTLE_MS - 500);
    // The reader adds a word; the pause that would ask it has not come yet.
    type(`${WORDS} dualism`);
    await wait(PAUSE_MS - 100);
    // The deadline has passed with the edit unasked: nothing thorough, and nothing lost.
    expect(s.asked("quick")).toEqual([WORDS]);
    expect(s.asked("meaning")).toEqual([]);

    enter();
    await flush();
    // Control: the edit is asked, into the same row, and *its* thorough search starts.
    expect(s.posts("quick").map((o) => [o.criterion, o.revises])).toEqual([
      [WORDS, false],
      [`${WORDS} dualism`, true],
    ]);
    expect(s.asked("meaning")).toEqual([`${WORDS} dualism`]);
  });

  it("F2: an edit just before thorough finishes is not lost to the swap", async () => {
    const s = server();
    mount();
    await flush();
    type(WORDS);
    await pause();
    await settle();
    expect(s.asked("meaning")).toEqual([WORDS]);
    const quickId = s.posts("quick")[0]!.id;
    const meaning = s.posts("meaning")[0]!;

    type(`${WORDS} dualism`);
    act(() => meaning.finish());
    await flush();
    // Not swapped: the quick row stays, and the thorough answer is thrown away.
    expect(isQuick(rowFor(WORDS))).toBe(true);
    expect(s.deletes()).toEqual([meaning.id]);

    await pause();
    // The session is still open on that row, so the pause revises it.
    expect(s.posts("quick").at(-1)).toMatchObject({
      id: quickId,
      criterion: `${WORDS} dualism`,
      revises: true,
    });
  });

  it("the pending thorough row is not listed, counted, ticked or drawn", async () => {
    const s = server();
    mount();
    await flush();
    type(WORDS);
    enter();
    await flush();
    const meaning = s.posts("meaning")[0]!;
    expect(meaning, "control: the thorough search is out").toBeDefined();
    // A passage arrives on the hidden row while it is still running.
    act(() => meaning.hit(MEANING_HIT));
    await flush();

    expect(listed()).toEqual([WORDS]);
    await urlRuns(s.posts("quick")[0]!.id);
    // Control: the quick row's hit is drawn, so `found` is being published.
    expect(found.map((f) => f.runId)).toEqual([s.posts("quick")[0]!.id]);
  });

  it("done swaps it in: the tick, the colour, the URL, one row, one delete", async () => {
    const s = server();
    mount();
    await flush();
    type(WORDS);
    enter();
    await flush();
    const quick = s.posts("quick")[0]!;
    const meaning = s.posts("meaning")[0]!;
    const slot = slotOf(rowFor(WORDS));
    expect(Number.isInteger(slot)).toBe(true);

    act(() => meaning.finish());
    await flush();
    expect(listed()).toEqual([WORDS]);
    expect(isQuick(rowFor(WORDS))).toBe(false);
    expect(rowFor(WORDS).querySelector(".srch-upgrading")).toBeNull();
    expect(ticked()).toEqual([WORDS]);
    await urlRuns(meaning.id);
    expect(slotOf(rowFor(WORDS))).toBe(slot);
    expect(s.deletes()).toEqual([quick.id]);
    // The thorough answer's passages are the ones drawn now.
    expect(found.map((f) => f.runId)).toEqual([meaning.id]);
  });

  it("an unticked quick row gives an unticked thorough row", async () => {
    const s = server();
    mount();
    await flush();
    type(WORDS);
    enter();
    await flush();
    click(must(`input[aria-label="Also mark: ${WORDS}"]`));
    await flush();
    expect(ticked()).toEqual([]);

    act(() => s.posts("meaning")[0]!.finish());
    await flush();
    expect(isQuick(rowFor(WORDS)), "control: it did swap").toBe(false);
    expect(ticked()).toEqual([]);
    await urlRuns("none");
  });

  it("F3: the swapped row keeps its place among rows asked meanwhile", async () => {
    // Quick answers are held, so the first's thorough row is created *after* the second quick row.
    const s = server({ quick: "hold" });
    mount();
    await flush();
    type("first question");
    enter();
    await flush();
    type("second question");
    enter();
    await flush();
    // Newest first: the second quick row is above the first.
    expect(listed()).toEqual(["second question", "first question"]);

    act(() => s.posts("quick")[0]!.finish());
    await flush();
    const first = s.posts("meaning")[0];
    expect(first?.criterion).toBe("first question");

    // By its own time the thorough row is the newest in the list. It must not jump to the top.
    act(() => first!.finish());
    await flush();
    expect(isQuick(rowFor("first question")), "control: it did swap").toBe(false);
    expect(listed()).toEqual(["second question", "first question"]);
  });

  it("F4: thorough takes the colour the quick row is drawn in at the swap, not at launch", async () => {
    const s = server();
    mount();
    await flush();
    type(WORDS);
    enter();
    await flush();
    const meaning = s.posts("meaning")[0]!;
    const before = slotOf(rowFor(WORDS));
    const picked = await recolour(WORDS);
    expect(picked).not.toBe(before);
    expect(slotOf(rowFor(WORDS)), "control: the quick row was recoloured").toBe(picked);

    act(() => meaning.finish());
    await flush();
    expect(isQuick(rowFor(WORDS))).toBe(false);
    expect(slotOf(rowFor(WORDS))).toBe(picked);
    expect(s.patches().at(-1)).toMatchObject({
      url: `/api/search/${SLUG}/${meaning.id}`,
      body: { colour: picked },
    });
  });

  it("F5: A, then B, then A again asks A's thorough search once", { timeout: 20_000 }, async () => {
    const s = server();
    mount();
    await flush();
    type("alpha words");
    await pause();
    await settle();
    type("bravo words");
    await pause();
    await settle();
    // Control: each settled answer started one thorough search.
    expect(s.asked("meaning")).toEqual(["alpha words", "bravo words"]);

    type("alpha words");
    await pause();
    await settle();
    expect(s.asked("quick")).toEqual(["alpha words", "bravo words", "alpha words"]);
    expect(s.asked("meaning")).toEqual(["alpha words", "bravo words"]);
    // Both obsolete requests stay hidden while they run, and nothing was deleted yet.
    expect(listed()).toEqual(["alpha words"]);
    expect(s.deletes()).toEqual([]);

    // Each is thrown away when it lands, and the quick row is left alone.
    const [alpha, bravo] = s.posts("meaning");
    act(() => bravo!.finish());
    act(() => alpha!.finish());
    await flush();
    expect(s.deletes().sort()).toEqual([alpha!.id, bravo!.id].sort());
    expect(listed()).toEqual(["alpha words"]);
    expect(isQuick(rowFor("alpha words"))).toBe(true);
  });

  it("deleting the quick row throws the thorough answer away when it lands", async () => {
    const s = server();
    mount();
    await flush();
    type(WORDS);
    enter();
    await flush();
    const quick = s.posts("quick")[0]!;
    const meaning = s.posts("meaning")[0]!;
    click(must('button[title="Delete this search"]', rowFor(WORDS)));
    await flush();
    expect(s.deletes()).toEqual([quick.id]);
    expect(listed()).toEqual([]);

    act(() => meaning.finish());
    await flush();
    expect(s.deletes()).toEqual([quick.id, meaning.id]);
    expect(listed()).toEqual([]);
  });

  it("F6: find on the meaning matcher is disabled for words whose thorough search is hidden", async () => {
    const s = server();
    mount();
    await flush();
    type(WORDS);
    enter();
    await flush();
    expect(s.asked("meaning")).toEqual([WORDS]);

    click(matcher("meaning"));
    await flush();
    expect(box().value).toBe(WORDS);
    expect(must<HTMLButtonElement>("button.srch-go").disabled).toBe(true);
    // Control: other words can be asked, so the button is not simply dead.
    type(`${WORDS} dualism`);
    await flush();
    expect(must<HTMLButtonElement>("button.srch-go").disabled).toBe(false);
  });

  it("follows a begin that answers thorough under another id", async () => {
    const s = server({ meaningAs: "spya-srv009" });
    mount();
    await flush();
    type(WORDS);
    enter();
    await flush();
    // Still hidden under the server's id.
    expect(listed()).toEqual([WORDS]);
    expect(isQuick(rowFor(WORDS))).toBe(true);
    expect(rowFor(WORDS).querySelector(".srch-upgrading")).not.toBeNull();

    act(() => s.posts("meaning")[0]!.finish());
    await flush();
    expect(listed()).toEqual([WORDS]);
    expect(isQuick(rowFor(WORDS))).toBe(false);
    await urlRuns("spya-srv009");
  });

  it("asks once and swaps once under StrictMode", async () => {
    const s = server();
    mount({ strict: true });
    await flush();
    type(WORDS);
    enter();
    await flush();
    expect(s.asked("quick")).toEqual([WORDS]);
    expect(s.asked("meaning")).toEqual([WORDS]);
    act(() => s.posts("meaning")[0]!.finish());
    await flush();
    expect(s.deletes()).toEqual([s.posts("quick")[0]!.id]);
    expect(listed()).toEqual([WORDS]);
    expect(isQuick(rowFor(WORDS))).toBe(false);
  });

  describe("F7: a thorough search that fails leaves the quick row and says nothing", () => {
    /** The quick row is as it was, with its button back, and no error line. */
    async function quietlyBack(s: ReturnType<typeof server>): Promise<void> {
      expect(s.asked("meaning"), "control: the thorough search was asked, once").toEqual([WORDS]);
      expect(listed()).toEqual([WORDS]);
      expect(isQuick(rowFor(WORDS))).toBe(true);
      expect(rowFor(WORDS).querySelector(".srch-upgrading")).toBeNull();
      expect(rowFor(WORDS).querySelector<HTMLButtonElement>("button.srch-thorough")?.disabled).toBe(false);
      expect(errorLines()).toEqual([]);
      await urlRuns(s.posts("quick")[0]!.id);
    }

    it("an HTTP failure", async () => {
      const s = server({ meaning: "http" });
      mount();
      await flush();
      type(WORDS);
      enter();
      await flush();
      await quietlyBack(s);
      // A failure is not retried by itself.
      await settle();
      await quietlyBack(s);
    });

    it("a dropped stream", async () => {
      const s = server();
      mount();
      await flush();
      type(WORDS);
      enter();
      await flush();
      act(() => s.posts("meaning")[0]!.cut());
      await flush();
      await quietlyBack(s);
      expect(s.deletes()).toEqual([s.posts("meaning")[0]!.id]);
    });

    it("a model failure", async () => {
      const s = server();
      mount();
      await flush();
      type(WORDS);
      enter();
      await flush();
      act(() => s.posts("meaning")[0]!.finish("error"));
      await flush();
      await quietlyBack(s);
      expect(s.deletes()).toEqual([s.posts("meaning")[0]!.id]);
    });

    it("neither clears nor replaces an error line that was already there", async () => {
      const s = server({ quick: "hold", meaning: "http", patchFails: "The colour was not saved." });
      mount();
      await flush();
      type(WORDS);
      enter();
      await flush();
      // A foreground failure, while the quick answer is still out.
      await recolour(WORDS);
      expect(errorLines()).toEqual(["The colour was not saved."]);

      act(() => s.posts("quick")[0]!.finish());
      await flush();
      // Control: the thorough search was asked and refused, after that line was set.
      expect(s.asked("meaning")).toEqual([WORDS]);
      expect(isQuick(rowFor(WORDS))).toBe(true);
      expect(errorLines()).toEqual(["The colour was not saved."]);
    });
  });

  it("a failed quick search starts nothing", async () => {
    const s = server({ quick: "http" });
    mount();
    await flush();
    type(WORDS);
    enter();
    await flush();
    expect(s.asked("quick")).toEqual([WORDS]);
    expect(errorLines(), "the quick failure is said out loud").toHaveLength(1);
    await settle();
    expect(s.asked("meaning")).toEqual([]);

    // Control: the same harness asks thorough for a quick search that works.
    s.config.quick = "done";
    type("other words");
    enter();
    await flush();
    expect(s.asked("meaning")).toEqual(["other words"]);
  });
});

/**
 * **A pair left behind is tidied when the list is next loaded** — the plan's
 * Q-reload. The reader left Search mode, reloaded or closed the tab while the
 * thorough search was out, so the server has both rows; this tab loads them.
 * Only a pair this browser wrote down at launch is tidied (stored-pairs.ts).
 */
describe("a quick row and its thorough row left behind are tidied on load", () => {
  const QUICK_ID = "spya-qk3m9a";
  const MEANING_ID = "spya-mn7w2d";
  const quickRow = (over: Partial<SearchRun> = {}): SearchRun => ({
    id: QUICK_ID,
    criterion: WORDS,
    kind: "quick",
    createdAt: "2026-10-05T09:01:00.000Z",
    status: "done",
    hits: [QUICK_HIT],
    ...over,
  });
  const thoroughRow = (over: Partial<SearchRun> = {}): SearchRun => ({
    id: MEANING_ID,
    criterion: WORDS,
    kind: "meaning",
    createdAt: "2026-10-05T09:01:03.000Z",
    status: "done",
    hits: [MEANING_HIT],
    ...over,
  });
  const RECORD = { slug: SLUG, quickId: QUICK_ID, meaningId: MEANING_ID, words: WORDS };
  const remembered = () => storedPairs.of(SLUG);
  /** Open Search mode with these rows saved and these ids ticked in the URL. */
  async function open(saved: SearchRun[], runs: string, options: { strict?: boolean } = {}) {
    history.replaceState(null, "", `/read/${SLUG}?mode=search&match=quick&runs=${runs}`);
    const s = server({ saved });
    mount(options);
    await flush();
    return s;
  }
  /** Leave Search mode: the band unmounts, the page does not. */
  async function leave(): Promise<void> {
    await act(async () => root.unmount());
    root = createRoot(host);
  }

  beforeEach(() => stored.clear());
  afterEach(() => vi.restoreAllMocks());

  it("the thorough row takes the quick row's place: one row, its tick, its colour, one delete", async () => {
    await storedPairs.add(RECORD);
    const saved = [quickRow(), thoroughRow()];
    const slot = assignSlots(saved).get(QUICK_ID);
    const s = await open(saved, QUICK_ID);

    expect(listed()).toEqual([WORDS]);
    expect(isQuick(rowFor(WORDS))).toBe(false);
    expect(ticked()).toEqual([WORDS]);
    await urlRuns(MEANING_ID);
    expect(slotOf(rowFor(WORDS))).toBe(slot);
    expect(s.patches()).toMatchObject([
      { url: `/api/search/${SLUG}/${MEANING_ID}`, body: { colour: slot } },
    ]);
    expect(s.deletes()).toEqual([QUICK_ID]);
    expect(found.map((f) => f.runId)).toEqual([MEANING_ID]);
    expect(errorLines()).toEqual([]);
    expect(await remembered()).toEqual([]);
  });

  it("leaves both rows when this browser did not launch the pair", async () => {
    // The reader asked quick and thorough for the same words by hand: the same two rows, no record.
    const s = await open([quickRow(), thoroughRow()], QUICK_ID);
    expect(savedRows()).toHaveLength(2);
    expect(s.deletes()).toEqual([]);
    expect(s.patches()).toEqual([]);
  });

  it("keeps a colour the reader pinned on the quick row", async () => {
    await storedPairs.add(RECORD);
    await open([quickRow({ colour: 5 }), thoroughRow()], QUICK_ID);
    expect(isQuick(rowFor(WORDS)), "control: it was tidied").toBe(false);
    expect(slotOf(rowFor(WORDS))).toBe(5);
  });

  it("an unticked quick row gives an unticked thorough row", async () => {
    await storedPairs.add(RECORD);
    const s = await open([quickRow(), thoroughRow()], "none");
    expect(listed()).toEqual([WORDS]);
    expect(isQuick(rowFor(WORDS))).toBe(false);
    expect(ticked()).toEqual([]);
    expect(s.deletes()).toEqual([QUICK_ID]);
  });

  it("keeps the quick row's place among rows asked meanwhile", async () => {
    const between = quickRow({
      id: "spya-qk3m9b",
      criterion: "second question",
      createdAt: "2026-10-05T09:01:02.000Z",
    });
    // Control, with no record so nothing is tidied: by its own time the thorough row is on top.
    await open([quickRow(), between, thoroughRow()], QUICK_ID);
    expect(listed()).toEqual([WORDS, "second question", WORDS]);
    await leave();

    await storedPairs.add(RECORD);
    await open([quickRow(), between, thoroughRow()], QUICK_ID);
    expect(listed()).toEqual(["second question", WORDS]);
    expect(isQuick(rowFor(WORDS))).toBe(false);
  });

  it("a thorough row still running is left, and tidied at the load after it finishes", async () => {
    await storedPairs.add(RECORD);
    const s = await open([quickRow(), thoroughRow({ status: "pending", hits: [] })], QUICK_ID);
    expect(savedRows()).toHaveLength(2);
    expect(s.deletes()).toEqual([]);
    expect(s.patches()).toEqual([]);
    expect(await remembered()).toEqual([RECORD]);
    await leave();

    const later = await open([quickRow(), thoroughRow()], QUICK_ID);
    expect(listed()).toEqual([WORDS]);
    expect(isQuick(rowFor(WORDS))).toBe(false);
    expect(later.deletes()).toEqual([QUICK_ID]);
  });

  it.each([
    ["the thorough row failed", quickRow(), thoroughRow({ status: "error", hits: [], error: "No." })],
    ["the quick row's words were changed", quickRow({ criterion: `${WORDS} dualism` }), thoroughRow()],
    ["the quick row failed", quickRow({ status: "error", hits: [], error: "No." }), thoroughRow()],
  ])("leaves both rows, for good, when %s", async (_name, q, m) => {
    await storedPairs.add(RECORD);
    const s = await open([q, m], QUICK_ID);
    expect(savedRows()).toHaveLength(2);
    expect(s.deletes()).toEqual([]);
    expect(s.patches()).toEqual([]);
    await urlRuns(QUICK_ID);
    expect(await remembered()).toEqual([]);
  });

  it("leaves both rows when the reader has ticked the thorough one", async () => {
    await storedPairs.add(RECORD);
    const s = await open([quickRow(), thoroughRow()], `${QUICK_ID},${MEANING_ID}`);
    expect(savedRows()).toHaveLength(2);
    expect(ticked()).toEqual([WORDS, WORDS]);
    expect(s.deletes()).toEqual([]);
    expect(s.patches()).toEqual([]);
    expect(await remembered()).toEqual([]);
  });

  it("does nothing offline, and keeps the pair for a load that reaches the server", async () => {
    await storedPairs.add(RECORD);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const s = await open([quickRow(), thoroughRow()], QUICK_ID);
    expect(savedRows()).toHaveLength(2);
    expect(s.deletes()).toEqual([]);
    expect(await remembered()).toEqual([RECORD]);
  });

  it("keeps a pair from a cached opening list even when the browser says online", async () => {
    await storedPairs.add(RECORD);
    history.replaceState(null, "", `/read/${SLUG}?mode=search&match=quick&runs=${QUICK_ID}`);
    const saved = [quickRow(), thoroughRow()];
    const s = server({ saved });
    const online = answer;
    answer = (url, init) => {
      if ((init.method ?? "GET") !== "GET") return online(url, init);
      const response = json({ runs: saved });
      response.headers.set("x-spideryarn-offline", "copy");
      return Promise.resolve(response);
    };
    mount();
    await flush();
    expect(savedRows()).toHaveLength(2);
    expect(s.deletes()).toEqual([]);
    expect(await remembered()).toEqual([RECORD]);
    await leave();
    const back = await open(saved, QUICK_ID);
    expect(back.deletes()).toEqual([QUICK_ID]);
  });

  it("a second article waits for its own opening list inside the same mount", async () => {
    await storedPairs.add(RECORD);
    await open([quickRow(), thoroughRow({ status: "pending", hits: [] })], QUICK_ID);
    const nextSlug = "another-paper";
    const next = { ...RECORD, slug: nextSlug, quickId: "spya-qk3m9c", meaningId: "spya-mn7w2f" };
    await storedPairs.add(next);
    const s = server({ saved: [quickRow({ id: next.quickId }), thoroughRow({ id: next.meaningId })] });
    mount({ slug: nextSlug });
    await flush();
    expect(s.deletes()).toEqual([next.quickId]);
    expect(savedRows()).toHaveLength(1);
    expect(isQuick(savedRows()[0]!)).toBe(false);
    expect(await remembered()).toEqual([RECORD]);
    expect(await storedPairs.of(nextSlug)).toEqual([]);
  });

  it("another article's pair is not this one's", async () => {
    await storedPairs.add({ ...RECORD, slug: "another-paper" });
    const s = await open([quickRow(), thoroughRow()], QUICK_ID);
    expect(savedRows()).toHaveLength(2);
    expect(s.deletes()).toEqual([]);
  });

  it("tidies once under StrictMode", async () => {
    await storedPairs.add(RECORD);
    const s = await open([quickRow(), thoroughRow()], QUICK_ID, { strict: true });
    expect(listed()).toEqual([WORDS]);
    expect(s.deletes()).toEqual([QUICK_ID]);
    expect(s.patches()).toHaveLength(1);
  });

  it("storage that holds something else is read as no pairs", async () => {
    stored.set(THOROUGH_PAIR_PREFIX + MEANING_ID, JSON.stringify({ ...RECORD, meaningId: "spya-mn7w2x" }));
    stored.set(`${THOROUGH_PAIR_PREFIX}spya-mn7w2y`, "not json");
    const s = await open([quickRow(), thoroughRow()], QUICK_ID);
    expect(savedRows()).toHaveLength(2);
    expect(s.deletes()).toEqual([]);
  });

  it.each(["tick then untick thorough", "press the thorough row, then the quick row"])(
    "a reader's choice survives the next load: %s",
    async (choice) => {
      await storedPairs.add(RECORD);
      await open([quickRow(), thoroughRow({ status: "pending", hits: [] })], QUICK_ID);
      expect(await remembered(), "control: the pending pair is eligible").toEqual([RECORD]);
      const meaningRow = savedRows().find((r) => !isQuick(r))!;
      if (choice === "tick then untick thorough") {
        const tick = must<HTMLInputElement>('input[aria-label^="Also mark: "]', meaningRow);
        click(tick);
        click(tick);
      } else {
        click(must(".srch-saved-body", meaningRow));
        click(must(".srch-saved-body", savedRows().find(isQuick)!));
      }
      await flush();
      expect(await remembered()).toEqual([]);
      await leave();
      const back = await open([quickRow(), thoroughRow()], QUICK_ID);
      expect(savedRows()).toHaveLength(2);
      expect(back.deletes()).toEqual([]);
    },
  );

  it("a ticked thorough row already declares a choice while it is pending", async () => {
    await storedPairs.add(RECORD);
    const s = await open([quickRow(), thoroughRow({ status: "pending", hits: [] })], MEANING_ID);
    expect(savedRows()).toHaveLength(2);
    expect(s.deletes()).toEqual([]);
    expect(await remembered()).toEqual([]);
  });

  it("a failed opening read keeps the record for a successful later load", async () => {
    await storedPairs.add(RECORD);
    const s = server();
    const success = answer;
    answer = (url, init) => (init.method ?? "GET") === "GET"
      ? Promise.resolve(json({ error: "The saved searches could not load." }, 500))
      : success(url, init);
    mount();
    await flush();
    expect(errorLines()).not.toEqual([]);
    expect(s.deletes()).toEqual([]);
    expect(await remembered()).toEqual([RECORD]);
    await leave();
    const back = await open([quickRow(), thoroughRow()], QUICK_ID);
    expect(back.deletes()).toEqual([QUICK_ID]);
  });

  it("select all ticks the thorough row, so it cancels the tidy too (S2)", async () => {
    storedPairs.add(RECORD);
    await open([quickRow(), thoroughRow({ status: "pending", hits: [] })], QUICK_ID);
    expect(remembered(), "control: the pending pair is eligible").toEqual([RECORD]);
    click(must(".srch-all input"));
    await flush();
    expect(ticked(), "control: select all ticked both").toHaveLength(2);
    expect(remembered()).toEqual([]);
  });

  it.each(["forget", "invalidate"])("%s needs no write, so a full storage cannot keep a stale record", async (operation) => {
    storedPairs.add(RECORD);
    const fail = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    if (operation === "forget") storedPairs.forget(MEANING_ID);
    else storedPairs.invalidate(QUICK_ID);
    fail.mockRestore();
    expect(remembered()).toEqual([]);
    const s = await open([quickRow(), thoroughRow()], QUICK_ID);
    expect(savedRows()).toHaveLength(2);
    expect(s.deletes()).toEqual([]);
  });

  it("a gesture on the quick row alone does not cancel the tidy", async () => {
    await storedPairs.add(RECORD);
    await open([quickRow(), thoroughRow({ status: "pending", hits: [] })], QUICK_ID);
    click(must(".srch-saved-body", savedRows().find(isQuick)!));
    await flush();
    expect(await remembered()).toEqual([RECORD]);
  });

  it("forgetting a pair touches no other pair's record, so no other tab's write can bring it back", () => {
    // R1: with one list under one key, a tab writing its older copy of the list revived a forgotten pair.
    const other = { ...RECORD, slug: "other-paper", meaningId: "spya-mn7w2e" };
    storedPairs.add(RECORD);
    storedPairs.add(other);
    const writes = vi.spyOn(window.localStorage, "setItem");
    storedPairs.forget(MEANING_ID);
    expect(writes, "forgetting writes nothing").not.toHaveBeenCalled();
    expect(remembered()).toEqual([]);
    expect(storedPairs.of("other-paper")).toEqual([other]);
    expect([...stored.keys()]).toEqual([THOROUGH_PAIR_PREFIX + other.meaningId]);
  });

  describe("what the tab that asked writes down", () => {
    /** Type, press Enter, and have the thorough search out. */
    async function launch() {
      history.replaceState(null, "", `/read/${SLUG}?mode=search&match=quick`);
      const s = server();
      mount();
      await flush();
      type(WORDS);
      enter();
      await flush();
      return { s, quick: s.posts("quick")[0]!, meaning: s.posts("meaning")[0]! };
    }

    it("the pair, when the thorough search starts, and nothing once it is swapped in", async () => {
      const { quick, meaning } = await launch();
      expect(await remembered()).toEqual([
        { slug: SLUG, quickId: quick.id, meaningId: meaning.id, words: WORDS },
      ]);
      act(() => meaning.finish());
      await flush();
      expect(isQuick(rowFor(WORDS)), "control: it did swap").toBe(false);
      expect(await remembered()).toEqual([]);
    });

    it("nothing once the thorough search has failed", async () => {
      const { meaning } = await launch();
      expect(await remembered()).toHaveLength(1);
      act(() => meaning.finish("error"));
      await flush();
      expect(await remembered()).toEqual([]);
    });

    it("nothing once the quick row's words change: that answer is to be thrown away", async () => {
      // No Enter: Enter seals the session, and the next words would be a new row.
      history.replaceState(null, "", `/read/${SLUG}?mode=search&match=quick`);
      const s = server();
      mount();
      await flush();
      type(WORDS);
      await pause();
      await settle();
      expect(await remembered()).toHaveLength(1);
      type(`${WORDS} dualism`);
      await pause();
      expect(s.posts("quick")[1]?.revises, "control: the same row was revised").toBe(true);
      expect(await remembered()).toEqual([]);
    });

    it("a revision followed by departure in the same batch revokes the pair", async () => {
      const s = server();
      mount();
      await flush();
      type(WORDS);
      await pause();
      await settle();
      const quick = s.posts("quick")[0]!;
      expect(await remembered(), "control: the automatic pair was written").toHaveLength(1);
      // No passive effect can inspect the revised row before this departure.
      act(() => {
        searchDraftFor(SLUG).band()!.flush(`${WORDS} dualism`);
        root.unmount();
      });
      root = createRoot(host);
      expect(s.posts("quick")[1]?.revises).toBe(true);
      expect(await remembered()).toEqual([]);
      // Even if the row later returns to its original words, this answer was discarded.
      const back = await open([quickRow({ id: quick.id }), thoroughRow({ id: s.posts("meaning")[0]!.id })], quick.id);
      expect(savedRows()).toHaveLength(2);
      expect(back.deletes()).toEqual([]);
    });

    it("nothing once begin answers thorough under another id: the record is not rewritten (S1)", async () => {
      history.replaceState(null, "", `/read/${SLUG}?mode=search&match=quick`);
      const s = server({ meaningAs: MEANING_ID });
      const writes = vi.spyOn(window.localStorage, "setItem");
      mount();
      await flush();
      type(WORDS);
      enter();
      await flush();
      expect(s.posts("meaning")[0]?.id, "control: thorough was asked and renamed").toBe(MEANING_ID);
      expect(writes, "control: the pair was written at launch").toHaveBeenCalledTimes(1);
      expect(remembered()).toEqual([]);
      expect([...stored.keys()]).toEqual([]);
    });

    it("leave Search mode mid-search, come back after it finished: one row", async () => {
      const { quick, meaning } = await launch();
      await urlRuns(quick.id);
      await leave();
      expect(await remembered(), "leaving does not forget the pair").toHaveLength(1);

      // The server finished both; this is what the next opening GET answers.
      const back = await open(
        [
          quickRow({ id: quick.id }),
          thoroughRow({ id: meaning.id }),
        ],
        quick.id,
      );
      expect(listed()).toEqual([WORDS]);
      expect(isQuick(rowFor(WORDS))).toBe(false);
      expect(ticked()).toEqual([WORDS]);
      expect(back.deletes()).toEqual([quick.id]);
      await urlRuns(meaning.id);
    });
  });
});
