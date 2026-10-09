// @vitest-environment jsdom
/**
 * **"Why are you reading this?" on the add page, saving as it is typed** —
 * docs/plans/261004l-the-add-page-purpose-box-saves-as-you-type.md, over the
 * box plan 260930e § Stage 1 put there.
 *
 * What is pinned, and why each matters:
 *
 *  - **The page posts no mode job, on any path.** The server queues the first
 *    modes when the import publishes
 *    (tests/publication-queues-the-main-modes.test.ts), so a `run:` from this
 *    page is a second set. Every case asserts there is none.
 *  - **The purpose is saved while the import runs**, after a short pause, on a
 *    blur and on the way out, so it is in the row before publication reads it.
 *  - **Nothing is written until the article's stored purpose has been read**
 *    (260930e F1, kept): the page knows the slug before the row exists, and on
 *    a re-add the box would otherwise be empty over a sentence the reader
 *    cannot see. After that, an emptied box clears.
 *  - **One write at a time**, the newest text behind it.
 *  - **The article opens by itself** unless the box is focused or holds words
 *    the server does not have, and then exactly once.
 *  - **A refused save stays on the page**, with the words.
 *
 * Table-driven over the three ways an add finishes, because each arrives on
 * its own and the bug that matters is one of them forgetting the rule. Two of
 * them have no slug until they finish, so nothing can be saved before then.
 *
 * The session itself is tested without React in tests/add-purpose.test.ts.
 * `JobCard` is the real one here: the Retry tests are about what pressing its
 * button does to the page around it.
 */
import { act, createElement, startTransition, StrictMode, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "../src/types.js";
import type { UseJobs } from "../src/web/useJobs.js";
import type { Transfer } from "../src/web/uploadEngine.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom's `localStorage` is shadowed by Node's own global here (see
   src/web/shelf-hidden-columns.ts), so the test brings its own. */
const stored = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
    clear: () => stored.clear(),
  },
});
/* And `sessionStorage`, where the ask-purpose mark lives (plan 261001s § Stage 3). */
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
const mark = () => session.get("spideryarn.ask-purpose") ?? null;

/**
 * Everything that left the page, in order: `patch:<slug>:<body>` (the
 * purpose), `leave:<slug>:<body>` (the same write as a `keepalive`),
 * `reader:<body>` (the tick box's setting), `put:` (High-powered AI),
 * `nav:<href>` and `run:<steps>` — which nothing should ever be. Reads of the
 * stored purpose are counted apart, in `reads`.
 */
const events: string[] = [];
const reads: string[] = [];
const runs = () => events.filter((e) => e.startsWith("run:"));
const patches = () => events.filter((e) => e.startsWith("patch:"));
const leaves = () => events.filter((e) => e.startsWith("leave:"));
const patch = (purpose: string | null, slug = SLUG) => `patch:${slug}:${JSON.stringify({ purpose })}`;

let jobs: Job[] = [];
type AddAnswer = Job | { article: string; repeat?: true } | { publicCopy: { slug: string; title: string } } | null;
/** Each `add` the page made, and whether it asked for the reader's own copy (plan 261009j). */
const addCalls: ("plain" | "own")[] = [];
let addResult: AddAnswer | Promise<AddAnswer> = null;
let addUploadResult: Promise<Job | { article: string } | null> = Promise.resolve(null);
let retryResult: (() => Job | null) | null = null;
const queue: UseJobs = {
  get jobs() {
    return jobs;
  },
  loaded: true,
  error: null,
  driverFailures: {},
  lastFailure: () => null,
  add: async (_url, options) => {
    addCalls.push(options?.ownCopy ? "own" : "plain");
    return addResult;
  },
  addUpload: () => addUploadResult as ReturnType<UseJobs["addUpload"]>,
  run: async (request) => {
    events.push(`run:${request.steps.join(",")}`);
    return null;
  },
  reset: async () => null,
  cancel: async () => {},
  retry: async () => retryResult?.() ?? null,
  forget: async () => {},
};
vi.mock("../src/web/useJobs.js", () => ({ useJobs: () => queue, useJobSession: () => {} }));

let transfer: Transfer | null = null;
vi.mock("../src/web/useUpload.js", () => ({ useUpload: () => transfer }));
vi.mock("../src/web/uploadEngine.js", () => ({ uploadEngine: { retry: () => {}, cancel: () => {} } }));

const navigations: string[] = [];
vi.mock("../src/web/router.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/router.js")>()),
  navigate: (href: string) => {
    navigations.push(href);
    events.push(`nav:${href}`);
  },
}));

/** How High-powered AI's PUT answers (plan 261002k). Replaced per test. */
let putAnswer: () => Promise<Response> = async () =>
  new Response(JSON.stringify({ highPowerSince: "2026-10-02T23:00:00.000Z" }), { status: 200 });
const puts = () => events.filter((e) => e.startsWith("put:"));

/** The purpose each article has on the server. A PATCH that lands writes it. */
const purposes = new Map<string, string>();
/** Articles whose row has not been made yet: `purposeFailed: true`. */
const notYet = new Set<string>();
const json = (body: unknown, init: ResponseInit = { status: 200 }) =>
  new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } });
const storePurpose = (slug: string, body: { purpose: string | null }): Response => {
  const value = body.purpose?.trim() ?? "";
  if (value === "") purposes.delete(slug);
  else purposes.set(slug, value);
  return json({ entry: null, purpose: value === "" ? null : value });
};
/** How the PATCH answers. Replaced per test; the default stores what it was sent. */
let patchAnswer: (body: { purpose: string | null }, slug: string) => Promise<Response> = async (body, slug) =>
  storePurpose(slug, body);
/** How `GET /api/reader?slug=` answers. Replaced per test; the default reads `purposes`. */
let purposeAnswer: (slug: string) => Promise<Response> = async (slug) => readPurpose(slug);
const readPurpose = (slug: string, offline = false): Response =>
  json(
    { autoModes: readerAutoModes, purpose: purposes.get(slug) ?? null, purposeFailed: notYet.has(slug) },
    offline ? { status: 200, headers: { "x-spideryarn-offline": "copy" } } : { status: 200 },
  );
/** What `GET /api/reader` says the reader's setting is. Replaced per test. */
let readerAutoModes = true;
vi.mock("../src/web/lib/api.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/web/lib/api.js")>();
  return {
    ...actual,
    apiFetch: async (input: string, init: RequestInit = {}) => {
      if (input === "/api/reader" && init.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { autoModes: boolean };
        events.push(`reader:${JSON.stringify(body)}`);
        readerAutoModes = body.autoModes;
        return new Response(JSON.stringify({ autoModes: readerAutoModes }), { status: 200 });
      }
      if (input === "/api/reader") {
        return new Response(JSON.stringify({ autoModes: readerAutoModes }), { status: 200 });
      }
      if (input.startsWith("/api/reader?slug=") && (init.method ?? "GET") === "GET") {
        const slug = decodeURIComponent(input.slice("/api/reader?slug=".length));
        reads.push(slug);
        return purposeAnswer(slug);
      }
      if (init.method === "PUT" && input.endsWith("/high-power")) {
        const body = JSON.parse(String(init.body)) as { on: boolean };
        events.push(`put:${input.split("/")[3]}:${body.on}`);
        return putAnswer();
      }
      if (init.method === "PATCH" && input.startsWith("/api/library/")) {
        const body = JSON.parse(String(init.body)) as { purpose: string | null };
        const slug = decodeURIComponent(input.slice("/api/library/".length));
        events.push(`patch:${slug}:${JSON.stringify(body)}`);
        return patchAnswer(body, slug);
      }
      throw new Error(`unexpected fetch ${input}`);
    },
    /* The `keepalive` write `pagehide` sends. Recorded, not applied. */
    leavingFetch: (input: string, init: RequestInit = {}) => {
      events.push(`leave:${decodeURIComponent(input.slice("/api/library/".length))}:${String(init.body)}`);
      return Promise.resolve();
    },
  };
});

const { AddPage, resetAddPurposeForTests } = await import("../src/web/AddPage.js");
const { ADD_PURPOSE_IDLE_MS, PURPOSE_READ_FINAL_TRIES,
  PURPOSE_READ_MAX_TRIES, PURPOSE_READ_RETRY_MS } = await import(
  "../src/web/add-purpose.js"
);
const { resetAutoModesSettingForTests } = await import("../src/web/auto-modes-setting.js");

const SLUG = "a-paper";
const UPLOAD_ID = "up-1";
const URL_SOURCE = { kind: "url", url: "https://example.com/a-paper" } as const;
const UPLOAD_SOURCE = { kind: "upload", uploadId: UPLOAD_ID } as const;
/** **The page posts no mode job** — the server queues them at publication. */
const NO_RUNS: string[] = [];
const OPEN = "Open the article";
const OPEN_UNSAVED = "Open without saving";

const makeJob = (id: string, status: Job["status"], slug = SLUG): Job =>
  ({ id, slug, status, steps: [] }) as unknown as Job;

let host: HTMLDivElement;
let root: Root;
let mounted = false;
let strict = false;
let source: Parameters<typeof AddPage>[0]["source"] = URL_SOURCE;

function render(next = source): void {
  source = next;
  const page = createElement(AddPage, { source });
  act(() => {
    root.render(strict ? createElement(StrictMode, null, page) : page);
  });
}

/** Let requests answer and effects run, without moving the clock. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/** Let time pass: the box sitting still. */
async function pause(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

function unmount(): void {
  if (!mounted) return;
  mounted = false;
  act(() => root.unmount());
}

const box = (): HTMLTextAreaElement => {
  const el = host.querySelector<HTMLTextAreaElement>("textarea");
  if (!el) throw new Error("no purpose box on the page");
  return el;
};
const button = (name: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
const press = (name: string): void => {
  const b = button(name);
  if (!b) throw new Error(`no ${name} button`);
  act(() => b.click());
};

function type(value: string): void {
  const el = box();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const focus = () => act(() => box().focus());
const blur = () => act(() => box().blur());
/** Visible words on the status line; `ticked` asks about the decorative tick. */
const statusLine = (): string => {
  const line = host.querySelector(".prof-save")?.cloneNode(true) as HTMLElement | undefined;
  line?.querySelectorAll(".prof-save-tick, .sr-only").forEach((node) => {
    node.remove();
  });
  return line?.textContent?.trim() ?? "";
};
/** The faint tick a save that landed leaves for a moment — `SaveStatus`. */
const ticked = (): boolean => host.querySelector(".prof-save.is-saved .prof-save-tick") !== null;
/** What the line reads whenever nothing has failed: typing and saving do not change it. */
const QUIET = "Saves as you type.";

function leaving(): boolean {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

/** A response a test answers when it chooses. */
function heldResponse() {
  let answer: (r: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    answer = resolve;
  });
  return { promise, answer: (r: Response) => answer(r) };
}

/**
 * The three ways an add finishes. `start` leaves the page mid-add with the
 * purpose box showing; `finish` makes the completion arrive.
 *
 * `slugEarly`: whether the page knows the article while the import runs. Only
 * a job does; an upload answered with an existing article has no slug until
 * that answer, so nothing typed can be saved before it.
 */
interface Producer {
  name: string;
  slugEarly: boolean;
  start(): Promise<void>;
  finish(): Promise<void>;
}

const PRODUCERS: Producer[] = [
  {
    name: "a job reaching done",
    slugEarly: true,
    async start() {
      addResult = makeJob("job-1", "running");
      jobs = [addResult];
      render(URL_SOURCE);
      await settle();
    },
    async finish() {
      jobs = [makeJob("job-1", "done")];
      render();
      await settle();
    },
  },
  {
    name: "the engine's upload answered with an existing article",
    slugEarly: false,
    async start() {
      transfer = { uploadId: UPLOAD_ID, filename: "p.pdf", bytes: 10, phase: { kind: "sending", sent: 4 } };
      render(UPLOAD_SOURCE);
      await settle();
    },
    async finish() {
      transfer = { uploadId: UPLOAD_ID, filename: "p.pdf", bytes: 10, phase: { kind: "article", slug: SLUG } };
      render();
      await settle();
    },
  },
  {
    name: "this page's own POST answered with an existing article",
    slugEarly: false,
    async start() {
      let answer: (value: { article: string }) => void = () => {};
      addUploadResult = new Promise((resolve) => {
        answer = resolve;
      });
      this.finish = async () => {
        answer({ article: SLUG });
        await settle();
      };
      render(UPLOAD_SOURCE);
      await settle();
    },
    async finish() {
      throw new Error("start() sets this");
    },
  },
];
const JOB = PRODUCERS[0] as Producer;

beforeEach(() => {
  vi.useFakeTimers();
  resetAutoModesSettingForTests();
  resetAddPurposeForTests();
  window.localStorage.clear();
  session.clear();
  purposes.clear();
  notYet.clear();
  readerAutoModes = true;
  events.length = 0;
  reads.length = 0;
  navigations.length = 0;
  jobs = [];
  addResult = null;
  addUploadResult = Promise.resolve(null);
  retryResult = null;
  transfer = null;
  strict = false;
  source = URL_SOURCE;
  patchAnswer = async (body, slug) => storePurpose(slug, body);
  purposeAnswer = async (slug) => readPurpose(slug);
  putAnswer = async () =>
    new Response(JSON.stringify({ highPowerSince: "2026-10-02T23:00:00.000Z" }), { status: 200 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mounted = true;
});

afterEach(async () => {
  unmount();
  /* Unmounting retires the session, which may still send its last words. Let
     that happen here, not into the next test's events. */
  await vi.advanceTimersByTimeAsync(0);
  host.remove();
  vi.useRealTimers();
});

describe.each(PRODUCERS)("when $name", (producer) => {
  it("an untouched box opens the article by itself, with no PATCH", async () => {
    await producer.start();
    expect(box(), "the purpose box was not offered while the add ran").toBeTruthy();
    await producer.finish();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(runs(), "the page posted a mode job").toEqual(NO_RUNS);
    expect(patches()).toEqual([]);
  });

  it("typed and blurred: saved once, before the article opens", async () => {
    await producer.start();
    focus();
    type("how they handled missing data");
    blur();
    await settle();
    await producer.finish();
    if (producer.slugEarly) {
      /* Saved during the import, so there is nothing to wait for. */
      expect(navigations, "a saved, blurred box still waited").toEqual([`/read/${SLUG}`]);
    } else {
      /* Nothing to save to until now. It saves by itself, and the page, having
         stopped, stays stopped until the reader says. */
      expect(navigations, "navigated over words that were not saved").toEqual([]);
      press(OPEN);
      await settle();
    }
    expect(patches()).toEqual([patch("how they handled missing data")]);
    expect(events.indexOf(patches()[0] as string)).toBeLessThan(events.indexOf(`nav:/read/${SLUG}`));
    expect(runs(), "the page posted a mode job").toEqual(NO_RUNS);
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(mark(), "a reader who answered is asked again").toBeNull();
  });

  it("a focused box waits; Open the article saves the words, then opens", async () => {
    await producer.start();
    focus();
    type("the evidence");
    await producer.finish();
    expect(navigations, "navigated out from under a reader in the box").toEqual([]);
    expect(button(OPEN_UNSAVED), "offered to drop words that can be saved").toBeUndefined();
    press(OPEN);
    await settle();
    expect(patches()).toEqual([patch("the evidence")]);
    expect(events.indexOf(patches()[0] as string)).toBeLessThan(events.indexOf(`nav:/read/${SLUG}`));
    expect(runs(), "the page posted a mode job").toEqual(NO_RUNS);
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("a refused save stays, says why, keeps the words, and offers Open without saving", async () => {
    patchAnswer = async () => new Response(JSON.stringify({ error: "The shelf is unavailable." }), { status: 503 });
    await producer.start();
    type("the evidence");
    await producer.finish();
    press(OPEN);
    await settle();
    expect(patches().length).toBeGreaterThanOrEqual(1);
    expect(navigations).toEqual([]);
    expect(box().value).toBe("the evidence");
    expect(statusLine()).toBe("Not saved — The shelf is unavailable.");
    expect(button(OPEN)?.disabled, "no second go after a refusal").toBe(false);

    const sent = patches().length;
    await pause(ADD_PURPOSE_IDLE_MS * 5);
    expect(patches(), "a refused save was retried by itself").toHaveLength(sent);
    press(OPEN_UNSAVED);
    await settle();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    unmount();
    await settle();
    expect(patches(), "the draft the reader gave up was sent behind their back").toHaveLength(sent);
    expect(leaves()).toEqual([]);
    expect(runs()).toEqual(NO_RUNS);
  });

  it("a touched box of spaces never sends a PATCH over an article with no purpose (F1)", async () => {
    await producer.start();
    focus();
    type("x");
    type("   ");
    /* Still focused: the reader may be about to type, so it waits. */
    await producer.finish();
    expect(navigations).toEqual([]);
    press(OPEN);
    await settle();
    expect(patches()).toEqual([]);
    expect(runs(), "the page posted a mode job").toEqual(NO_RUNS);
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("a touched, emptied and blurred box opens as if untouched", async () => {
    await producer.start();
    focus();
    type("x");
    type("");
    blur();
    await producer.finish();
    expect(patches()).toEqual([]);
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("under StrictMode, untouched: one navigation", async () => {
    strict = true;
    await producer.start();
    await producer.finish();
    expect(runs(), "the page posted a mode job").toEqual(NO_RUNS);
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("under StrictMode, a double press: one PATCH, one navigation", async () => {
    strict = true;
    await producer.start();
    focus();
    type("the evidence");
    await producer.finish();
    const open = button(OPEN);
    act(() => {
      open?.click();
      open?.click();
    });
    await settle();
    expect(patches()).toEqual([patch("the evidence")]);
    expect(runs(), "the page posted a mode job").toEqual(NO_RUNS);
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });
});

describe("a completion already there on the first render", () => {
  it("under StrictMode's double effect: one navigation", async () => {
    /* The only producer that can be non-null at mount — the other two arrive
       through state an effect sets — so the only one that meets StrictMode's
       second run of the deciding effect. */
    strict = true;
    transfer = { uploadId: UPLOAD_ID, filename: "p.pdf", bytes: 10, phase: { kind: "article", slug: SLUG } };
    render(UPLOAD_SOURCE);
    await settle();
    expect(runs(), "the page posted a mode job").toEqual(NO_RUNS);
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });
});

describe("saved as it is typed, while the import runs", () => {
  it("not before the pause, once after it, and a keystroke starts the pause again", async () => {
    await JOB.start();
    type("the");
    await pause(ADD_PURPOSE_IDLE_MS - 100);
    type("the evidence");
    await pause(ADD_PURPOSE_IDLE_MS - 100);
    expect(patches(), "saved inside the pause").toEqual([]);
    expect(statusLine(), "typing changed the line").toBe(QUIET);
    expect(ticked()).toBe(false);
    await pause(100);
    expect(patches()).toEqual([patch("the evidence")]);
    expect(statusLine()).toBe(QUIET);
    expect(ticked()).toBe(true);
    await pause(ADD_PURPOSE_IDLE_MS * 5);
    expect(patches(), "saved again with nothing changed").toHaveLength(1);
    expect(navigations).toEqual([]);
  });

  /* Greg, 2026-10-05: "perhaps a 1s rather than 0.7s debounce is fine to avoid
     it appearing too often and distracting the user". */
  it("a one-second pause, not the other boxes' two seconds", () => {
    expect(ADD_PURPOSE_IDLE_MS).toBe(1_000);
  });

  it("a blur saves at once, and so does ⌘/Ctrl+Enter", async () => {
    await JOB.start();
    focus();
    type("the evidence");
    blur();
    await settle();
    expect(patches()).toEqual([patch("the evidence")]);

    focus();
    type("the evidence, and the methods");
    act(() => {
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    });
    await settle();
    expect(patches()).toEqual([patch("the evidence"), patch("the evidence, and the methods")]);
    expect(navigations, "the shortcut opened an article that is not in yet").toEqual([]);
  });

  it("a hidden tab saves, and pagehide sends the keepalive write", async () => {
    await JOB.start();
    type("the evidence");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    try {
      act(() => void document.dispatchEvent(new Event("visibilitychange")));
      await settle();
    } finally {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    }
    expect(patches()).toEqual([patch("the evidence")]);

    type("the evidence, and more");
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(leaves()).toEqual([`leave:${SLUG}:${JSON.stringify({ purpose: "the evidence, and more" })}`]);
  });

  it("leaving the page with unsaved words sends them", async () => {
    await JOB.start();
    type("the evidence");
    unmount();
    await settle();
    expect(patches()).toEqual([patch("the evidence")]);
  });

  it("one write at a time: B waits for A, and the last PATCH is the last text", async () => {
    const first = heldResponse();
    patchAnswer = () => first.promise;
    await JOB.start();
    type("A");
    await pause(ADD_PURPOSE_IDLE_MS);
    expect(patches()).toEqual([patch("A")]);
    type("B");
    await pause(ADD_PURPOSE_IDLE_MS * 4);
    expect(patches(), "a second write went out beside the first").toEqual([patch("A")]);
    expect(statusLine()).toBe(QUIET);
    expect(ticked(), "ticked words that are not in the request").toBe(false);

    patchAnswer = async (body, slug) => storePurpose(slug, body);
    first.answer(storePurpose(SLUG, { purpose: "A" }));
    await settle();
    expect(patches()).toEqual([patch("A"), patch("B")]);
    await pause(ADD_PURPOSE_IDLE_MS * 4);
    expect(patches()).toHaveLength(2);
    expect(purposes.get(SLUG)).toBe("B");
  });

  it("typed back to what was loaded while a write is out: the timer sends the correction (F2)", async () => {
    purposes.set(SLUG, "S");
    const first = heldResponse();
    patchAnswer = () => first.promise;
    await JOB.start();
    expect(box().value).toBe("S");
    type("A");
    await pause(ADD_PURPOSE_IDLE_MS);
    type("S");
    await pause(ADD_PURPOSE_IDLE_MS * 4);
    expect(patches()).toEqual([patch("A")]);
    expect(leaving(), "a write in flight under a clean box was safe to leave").toBe(true);

    patchAnswer = async (body, slug) => storePurpose(slug, body);
    first.answer(storePurpose(SLUG, { purpose: "A" }));
    await settle();
    await pause(ADD_PURPOSE_IDLE_MS);
    expect(patches(), "nothing sent S after A landed").toEqual([patch("A"), patch("S")]);
    expect(purposes.get(SLUG)).toBe("S");
    expect(leaving()).toBe(false);
  });
});

describe("held until the article exists", () => {
  it("sends nothing while the row is not there, then the typed text once it is", async () => {
    notYet.add(SLUG);
    await JOB.start();
    /* Every way the page asks for a save: the pause, the shortcut, a blur. */
    focus();
    type("the evidence");
    await pause(ADD_PURPOSE_IDLE_MS * 4);
    act(() => {
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    });
    blur();
    await pause(PURPOSE_READ_RETRY_MS * 3);
    expect(patches(), "wrote to an article that does not exist yet").toEqual([]);
    expect(reads.length).toBeGreaterThan(2);
    /* Nothing scary while the article is on its way: the hint says when it saves,
       and leaving is still questioned. Greg, 2026-10-05. */
    expect(statusLine(), "said Not saved over words that are only waiting").toBe("");
    expect(leaving(), "words with nowhere to go yet were safe to leave").toBe(true);

    notYet.delete(SLUG);
    await pause(PURPOSE_READ_RETRY_MS);
    expect(patches()).toEqual([patch("the evidence")]);
    expect(ticked()).toBe(true);
    expect(leaving()).toBe(false);
  });

  it("says nothing over an empty box", async () => {
    notYet.add(SLUG);
    await JOB.start();
    expect(statusLine(), "an empty box claimed a save state").toBe("");
    notYet.delete(SLUG);
    await pause(PURPOSE_READ_RETRY_MS);
    expect(statusLine()).toBe("Saves as you type.");
  });

  it("does not take an offline copy as proof the article exists (F5)", async () => {
    purposeAnswer = async (slug) => readPurpose(slug, true);
    await JOB.start();
    type("the evidence");
    await pause(PURPOSE_READ_RETRY_MS * 3);
    expect(patches()).toEqual([]);
    expect(statusLine()).toBe("");
    expect(ticked(), "ticked a save that never went").toBe(false);
  });

  it("a job over an existing article shows the stored purpose, sends nothing for it, and an emptied box then clears", async () => {
    purposes.set(SLUG, "why I came");
    await JOB.start();
    expect(box().value).toBe("why I came");
    await pause(ADD_PURPOSE_IDLE_MS * 4);
    expect(patches()).toEqual([]);

    type("");
    await pause(ADD_PURPOSE_IDLE_MS);
    expect(patches()).toEqual([patch(null)]);
    expect(purposes.has(SLUG)).toBe(false);
  });

  it("a box emptied before the stored purpose was read erases nothing (F1)", async () => {
    purposes.set(SLUG, "why I came");
    notYet.add(SLUG);
    await JOB.start();
    focus();
    type("x");
    type("");
    blur();
    await pause(ADD_PURPOSE_IDLE_MS * 4);
    notYet.delete(SLUG);
    await pause(PURPOSE_READ_RETRY_MS);
    expect(patches(), "an empty box cleared a purpose the reader could not see").toEqual([]);
    expect(box().value).toBe("why I came");
    expect(purposes.get(SLUG)).toBe("why I came");
  });

  it("an untouched job over an existing article opens by itself with the stored purpose left alone", async () => {
    purposes.set(SLUG, "why I came");
    await JOB.start();
    await JOB.finish();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(patches()).toEqual([]);
    expect(mark(), "the first-open question's mark was not written").toBe(SLUG);
  });
});

describe("at the end of the import", () => {
  it("while the save is in flight the button waits, and the page opens only once it answers", async () => {
    const held = heldResponse();
    patchAnswer = () => held.promise;
    await JOB.start();
    focus();
    type("the evidence");
    await JOB.finish();
    press(OPEN);
    await settle();
    expect(navigations).toEqual([]);
    expect(button("Saving…")?.disabled, "Open was not held while saving").toBe(true);
    /* The button the reader pressed says it; the line under the box stays quiet. */
    expect(statusLine()).toBe(QUIET);
    held.answer(storePurpose(SLUG, { purpose: "the evidence" }));
    await settle();
    expect(patches()).toHaveLength(1);
    expect(runs(), "the page posted a mode job").toEqual(NO_RUNS);
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("a save still in flight when the import finishes is waited for, even blurred", async () => {
    const held = heldResponse();
    patchAnswer = () => held.promise;
    await JOB.start();
    focus();
    type("the evidence");
    blur();
    await settle();
    await JOB.finish();
    expect(navigations, "opened while the write was still on its way").toEqual([]);
    held.answer(storePurpose(SLUG, { purpose: "the evidence" }));
    await settle();
    /* It stopped, so it stays stopped until the reader says. */
    expect(navigations).toEqual([]);
    press(OPEN);
    await settle();
    expect(patches()).toHaveLength(1);
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("a blur while waiting saves and does not open", async () => {
    await JOB.start();
    focus();
    type("the evidence");
    await JOB.finish();
    blur();
    await settle();
    expect(patches()).toEqual([patch("the evidence")]);
    expect(navigations).toEqual([]);
    expect(button(OPEN)).toBeTruthy();
  });

  it("⌘/Ctrl+Enter is Open the article once the import is in", async () => {
    await JOB.start();
    focus();
    type("the evidence");
    await JOB.finish();
    act(() => {
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    });
    await settle();
    expect(patches()).toHaveLength(1);
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("a refusal clears on the next keystroke, and the edited words can be saved", async () => {
    patchAnswer = async () => new Response(JSON.stringify({ error: "The shelf is unavailable." }), { status: 503 });
    await JOB.start();
    focus();
    type("the evidence");
    await JOB.finish();
    press(OPEN);
    await settle();
    expect(statusLine()).toBe("Not saved — The shelf is unavailable.");
    expect(button(OPEN_UNSAVED)).toBeTruthy();

    patchAnswer = async (body, slug) => storePurpose(slug, body);
    type("the evidence, again");
    expect(statusLine()).toBe(QUIET);
    expect(host.textContent).not.toContain("The shelf is unavailable.");
    expect(button(OPEN_UNSAVED), "still offering to drop words that can now be saved").toBeUndefined();
    press(OPEN);
    await settle();
    expect(patches().at(-1)).toBe(patch("the evidence, again"));
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("when the stored purpose could never be read, says so and offers Open without saving", async () => {
    notYet.add(SLUG);
    await JOB.start();
    type("the evidence");
    await pause(PURPOSE_READ_RETRY_MS * (PURPOSE_READ_MAX_TRIES + 5));
    expect(statusLine()).toBe("Not saved. Could not read this article's saved reason.");
    /* The import finishing means the row exists, so the read gets a short
       fresh run before it gives up for good. */
    await JOB.finish();
    await pause(PURPOSE_READ_RETRY_MS * (PURPOSE_READ_FINAL_TRIES + 2));
    expect(statusLine()).toBe("Not saved. Could not read this article's saved reason.");
    const asked = reads.length;
    expect(navigations).toEqual([]);
    press(OPEN);
    await settle();
    expect(navigations, "opened over words it could not save, without being told to").toEqual([]);
    expect(button(OPEN)?.disabled).toBe(false);
    press(OPEN_UNSAVED);
    await settle();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(patches()).toEqual([]);
    expect(reads).toHaveLength(asked);
  });

  it("says what the first modes used, whatever the tick box now says", async () => {
    /* The modes were queued when the import published, with the profile as it
       stood. The sentence must be true with automatic modes off too (F8). */
    readerAutoModes = false;
    await JOB.start();
    focus();
    await JOB.finish();
    const ready =
      "Ready. Any first modes that were queued use the reason saved when the import finished. " +
      "Changes saved after that reach chat and anything you generate later.";
    expect(host.textContent).toContain(ready);
    act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    await settle();
    expect(host.textContent).toContain(ready);
    expect(host.textContent).toContain(
      "Optional. Saves by itself after a short pause, once the article exists. " +
        "If first modes are generated automatically, they use the reason saved when the import finishes. " +
        "For this article only. Never what the article says. " +
        "You can change it later on the article's Metadata page.",
    );
  });
});

describe("when the address changes", () => {
  const OTHER_SOURCE = { kind: "url", url: "https://example.com/another-paper" } as const;
  const OTHER_SLUG = "another-paper";

  async function goToOther(): Promise<void> {
    addResult = makeJob("job-2", "running", OTHER_SLUG);
    jobs = [makeJob("job-1", "running"), addResult];
    render(OTHER_SOURCE);
    await settle();
  }

  it("the old draft goes to the old article, and the new box starts empty", async () => {
    await JOB.start();
    type("the first article's evidence");
    await goToOther();
    expect(box().value).toBe("");
    expect(patches()).toEqual([patch("the first article's evidence", SLUG)]);

    jobs = [makeJob("job-1", "running"), makeJob("job-2", "done", OTHER_SLUG)];
    render();
    await settle();
    expect(patches()).toHaveLength(1);
    expect(navigations).toEqual([`/read/${OTHER_SLUG}`]);
  });

  it("the old draft waits for the old write in flight, and neither answer touches the new page", async () => {
    const first = heldResponse();
    const second = heldResponse();
    const answers = [first, second];
    patchAnswer = () => (answers.shift() as ReturnType<typeof heldResponse>).promise;
    await JOB.start();
    type("A");
    await pause(ADD_PURPOSE_IDLE_MS);
    type("B");
    await goToOther();
    expect(patches(), "the old draft went out beside the write in flight").toEqual([patch("A", SLUG)]);

    first.answer(storePurpose(SLUG, { purpose: "A" }));
    await settle();
    expect(patches()).toEqual([patch("A", SLUG), patch("B", SLUG)]);
    second.answer(storePurpose(SLUG, { purpose: "B" }));
    await settle();
    expect(box().value, "an old save answering late wrote into the new box").toBe("");
    expect(statusLine()).toBe("Saves as you type.");
    expect(navigations).toEqual([]);
    expect(purposes.get(SLUG)).toBe("B");
    expect(purposes.has(OTHER_SLUG)).toBe(false);
  });

  it("a read answered after the address changed does not seed the new box", async () => {
    const held = heldResponse();
    purposeAnswer = async (slug) => (slug === SLUG ? held.promise : readPurpose(slug));
    purposes.set(SLUG, "the first article's purpose");
    notYet.add(OTHER_SLUG);
    await JOB.start();
    await goToOther();
    held.answer(readPurpose(SLUG));
    await settle();
    expect(box().value, "the old article's purpose landed in the new article's box").toBe("");
    type("for the second");
    await pause(ADD_PURPOSE_IDLE_MS * 2);
    expect(patches()).toEqual([]);
    expect(statusLine()).toBe("");
    expect(ticked()).toBe(false);
  });

  it("two addresses for one article: the second waits for the first's last write (F9)", async () => {
    const SLASHED = { kind: "url", url: "https://example.com/a-paper/" } as const;
    const first = heldResponse();
    patchAnswer = () => first.promise;
    await JOB.start();
    type("A");
    await pause(ADD_PURPOSE_IDLE_MS);
    const readsBefore = reads.length;

    addResult = makeJob("job-2", "running", SLUG);
    jobs = [makeJob("job-1", "running"), addResult];
    render(SLASHED);
    await settle();
    type("C");
    await pause(PURPOSE_READ_RETRY_MS * 2);
    expect(reads, "the new session read while the old one still had a write out").toHaveLength(readsBefore);
    expect(patches()).toEqual([patch("A")]);

    patchAnswer = async (body, slug) => storePurpose(slug, body);
    first.answer(storePurpose(SLUG, { purpose: "A" }));
    await settle();
    expect(patches()).toEqual([patch("A"), patch("C")]);
    expect(purposes.get(SLUG)).toBe("C");
  });
});

describe("Retry after a failed import (F3)", () => {
  async function failThenRetry(): Promise<void> {
    addResult = makeJob("job-1", "running");
    jobs = [addResult];
    render(URL_SOURCE);
    await settle();
    return;
  }

  async function retry(slug = SLUG): Promise<void> {
    jobs = [makeJob("job-1", "error")];
    render();
    await settle();
    retryResult = () => {
      const replacement = makeJob("job-2", "running", slug);
      jobs = [makeJob("job-1", "error"), replacement];
      return replacement;
    };
    const again = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Retry"));
    expect(again, "the failed job's card offered no Retry").toBeTruthy();
    act(() => again?.click());
    await settle();
  }

  async function retryToDone(): Promise<void> {
    await retry();
    jobs = [makeJob("job-1", "error"), makeJob("job-2", "done")];
    render();
    await settle();
  }

  it("follows the replacement job and opens the article when it finishes", async () => {
    await failThenRetry();
    await retryToDone();
    expect(navigations, "the page kept watching the failed job").toEqual([`/read/${SLUG}`]);
    expect(runs(), "the page posted a mode job").toEqual(NO_RUNS);
    expect(mark(), "an untouched retry completion lost the first-open question").toBe(SLUG);
  });

  it("does not mark a retry completion after the empty box was focused and blurred", async () => {
    await failThenRetry();
    focus();
    blur();
    await retryToDone();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(mark(), "Retry forgot that the reader had already seen the box").toBeNull();
  });

  it("does not promise the article will exist once the import has stopped (F13)", async () => {
    notYet.add(SLUG);
    await failThenRetry();
    type("the evidence");
    expect(statusLine()).toBe("");
    jobs = [makeJob("job-1", "error")];
    render();
    await settle();
    expect(statusLine()).toBe(
      "Not saved. The import stopped before this article's saved reason could be read.",
    );
    const asked = reads.length;
    await pause(PURPOSE_READ_RETRY_MS * 5);
    expect(reads, "went on asking about a stopped import").toHaveLength(asked);

    /* Retry is a fresh run of the read, and the words go once it answers. */
    notYet.delete(SLUG);
    await retry();
    expect(patches()).toEqual([patch("the evidence")]);
  });

  it("keeps a typed purpose across the retry", async () => {
    notYet.add(SLUG);
    await failThenRetry();
    type("the evidence");
    notYet.delete(SLUG);
    await retry();
    expect(box().value).toBe("the evidence");
    expect(patches()).toEqual([patch("the evidence")]);
    jobs = [makeJob("job-1", "error"), makeJob("job-2", "done")];
    render();
    await settle();
    /* Typed, never focused, and saved by the time it finished. */
    expect(patches()).toHaveLength(1);
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  describe("when the Retry comes back as a different article", () => {
    const SECOND = "a-paper-2";

    it("the old article gets the old words, and the typed words follow the reader", async () => {
      await failThenRetry();
      type("the evidence");
      await retry(SECOND);
      expect(box().value).toBe("the evidence");
      expect(patches()).toEqual([patch("the evidence", SLUG), patch("the evidence", SECOND)]);
    });

    it("a stored purpose the reader never edited does not follow them", async () => {
      purposes.set(SLUG, "why I came to the first");
      await failThenRetry();
      expect(box().value).toBe("why I came to the first");
      await retry(SECOND);
      expect(box().value, "one article's purpose was carried to another").toBe("");
      await pause(ADD_PURPOSE_IDLE_MS * 4);
      expect(patches()).toEqual([]);
    });

    it("a clear cannot reach the new article before its purpose has been read", async () => {
      purposes.set(SLUG, "why I came to the first");
      purposes.set(SECOND, "why I came to the second");
      notYet.add(SECOND);
      await failThenRetry();
      type("");
      await retry(SECOND);
      await pause(ADD_PURPOSE_IDLE_MS * 4);
      expect(patches(), "the emptied box cleared an article it was not emptied over").toEqual([
        patch(null, SLUG),
      ]);
      notYet.delete(SECOND);
      await pause(PURPOSE_READ_RETRY_MS);
      expect(box().value).toBe("why I came to the second");
      expect(patches()).toHaveLength(1);
    });
  });
});

/* ---------------------------------------------------------------------------
 * Plan 261001s (Greg, 2026-10-01, spya-hbqezu): *"if they don't fill this in …
 * pop up an input box asking why they're reading it when the article loads for
 * the first time"* — Stage 3's mark. Written only when the page opens the
 * article by itself and the reader never touched the box.
 * ------------------------------------------------------------------------- */

describe.each(PRODUCERS)("the ask-purpose mark (261001s § Stage 3) when $name", (producer) => {
  it("is written when the page opens the article by itself, untouched", async () => {
    await producer.start();
    await producer.finish();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(mark()).toBe(SLUG);
  });

  it("is not written after a focus and a blur over an empty box", async () => {
    await producer.start();
    focus();
    blur();
    await producer.finish();
    expect(navigations, "the auto-open rule changed").toEqual([`/read/${SLUG}`]);
    expect(mark(), "a reader who looked at the box is asked again").toBeNull();
  });

  it("is not written for a box typed in and emptied", async () => {
    await producer.start();
    type("x");
    type("");
    await producer.finish();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(mark()).toBeNull();
  });

  it("is not written on Open the article", async () => {
    await producer.start();
    /* Keep the box empty: the press, not the presence of words, is what says
       the reader saw the question. Keeping focus through the completion is how
       an empty box reaches the button. */
    focus();
    await producer.finish();
    press(OPEN);
    await settle();
    expect(patches()).toEqual([]);
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(mark()).toBeNull();
  });
});

/**
 * **High-powered AI chosen at import** — plan 261002k. The box sends the
 * Metadata switch's own PUT; what is pinned here is the page's half: nothing is
 * sent unless ticked, and a tick is sent — over all three ways an add finishes,
 * one of which never had a job, so the intent is sent against the completion's
 * slug.
 *
 * **The page no longer holds the modes until the switch answers**, because it
 * no longer queues them (plan 261004h § High-powered AI). What stands in for
 * that is on the server: each mode step reads the article's power as it
 * starts, and none starts before the labels job ahead of it has ended
 * (tests/publication-queues-the-main-modes.test.ts).
 */
describe.each(PRODUCERS)("High-powered AI at import, when $name", (producer) => {
  const powerBox = (): HTMLInputElement => {
    const el = host.querySelector<HTMLInputElement>("[data-add-high-power] input[type=checkbox]");
    if (!el) throw new Error("no High-powered AI box on the page");
    return el;
  };

  it("is offered, off, and sends nothing when left alone", async () => {
    await producer.start();
    expect(powerBox().checked).toBe(false);
    await producer.finish();
    expect(puts()).toEqual([]);
    expect(runs(), "the page posted a mode job").toEqual(NO_RUNS);
  });

  it("ticked, it sends the switch, and opens the article without waiting for the answer", async () => {
    let answer: () => void = () => {};
    putAnswer = () =>
      new Promise((resolve) => {
        answer = () =>
          resolve(new Response(JSON.stringify({ highPowerSince: "2026-10-02T23:00:00.000Z" }), { status: 200 }));
      });
    await producer.start();
    act(() => powerBox().click());
    expect(powerBox().checked).toBe(true);
    await producer.finish();
    expect(puts()).toEqual([`put:${SLUG}:true`]);
    expect(navigations, "the navigation waited for the switch").toEqual([`/read/${SLUG}`]);
    answer();
    await settle();
    expect(runs(), "the page posted a mode job").toEqual(NO_RUNS);
    expect(events.indexOf(`put:${SLUG}:true`)).toBe(0);
  });

  it("a refusal changes nothing about what the page posts", async () => {
    putAnswer = async () =>
      new Response(JSON.stringify({ error: "[pay-high-power] Not enough of your allowance left." }), {
        status: 402,
      });
    await producer.start();
    act(() => powerBox().click());
    await producer.finish();
    await settle();
    expect(puts()).toEqual([`put:${SLUG}:true`]);
    expect(runs(), "the page posted a mode job").toEqual(NO_RUNS);
  });
});

describe("High-powered AI add-page wiring", () => {
  const powerBox = (): HTMLInputElement => {
    const el = host.querySelector<HTMLInputElement>("[data-add-high-power] input[type=checkbox]");
    if (!el) throw new Error("no High-powered AI box on the page");
    return el;
  };

  it("uses the job's allocated slug, not one derived from the address", async () => {
    addResult = makeJob("job-allocated", "running", "allocated-title-2");
    jobs = [addResult];
    render(URL_SOURCE);
    await settle();
    act(() => powerBox().click());
    await settle();
    expect(puts()).toEqual(["put:allocated-title-2:true"]);
  });

  it("under StrictMode sends one switch request", async () => {
    strict = true;
    addResult = makeJob("job-1", "running");
    jobs = [addResult];
    render(URL_SOURCE);
    await settle();
    act(() => powerBox().click());
    await settle();
    expect(puts()).toEqual([`put:${SLUG}:true`]);
  });

  it("starts a new address with a fresh intent and sends only to that address's job slug", async () => {
    addResult = makeJob("job-1", "running");
    jobs = [addResult];
    render(URL_SOURCE);
    await settle();
    act(() => powerBox().click());
    await settle();

    const other = { kind: "url", url: "https://example.com/another-paper" } as const;
    addResult = makeJob("job-2", "running", "allocated-other-paper");
    jobs = [makeJob("job-1", "running"), addResult];
    render(other);
    await settle();
    expect(powerBox().checked, "the first address's choice leaked into the second").toBe(false);
    act(() => powerBox().click());
    await settle();

    expect(puts()).toEqual([`put:${SLUG}:true`, "put:allocated-other-paper:true"]);
  });

  it("keeps the box on and says switch-off failed when the server refuses it", async () => {
    addResult = makeJob("job-1", "running");
    jobs = [addResult];
    render(URL_SOURCE);
    await settle();
    act(() => powerBox().click());
    await settle();

    putAnswer = async () =>
      new Response(JSON.stringify({ error: "The article could not be changed." }), { status: 503 });
    act(() => powerBox().click());
    await settle();

    expect(powerBox().checked, "a refused switch-off was drawn as off").toBe(true);
    expect(host.textContent).toContain("Not switched off — The article could not be changed.");
  });
});


describe("committed purpose ownership", () => {
  const never = new Promise<void>(() => {});
  function Gate({ blocked }: { blocked: boolean }) {
    if (blocked) throw never;
    return null;
  }
  const screen = (next: typeof source, blocked: boolean) =>
    createElement(Suspense, { fallback: "Waiting" },
      createElement(AddPage, { source: next }), createElement(Gate, { blocked }));

  it("keeps the visible session editable when a new-address render suspends", async () => {
    addResult = makeJob("job-1", "running");
    jobs = [addResult];
    act(() => root.render(screen(URL_SOURCE, false)));
    await settle();
    focus();
    const visible = box();
    await act(async () => {
      startTransition(() => root.render(screen({ kind: "url", url: "https://example.com/other" }, true)));
    });
    expect(box()).toBe(visible);
    expect(document.activeElement).toBe(visible);
    type("words on the still-visible page");
    expect(leaving(), "the visible unsaved session lost its leave warning").toBe(true);
    await pause(ADD_PURPOSE_IDLE_MS);
    expect(patches(), "a discarded render retired the session still on screen").toEqual([
      patch("words on the still-visible page"),
    ]);
    expect(purposes.get(SLUG)).toBe("words on the still-visible page");
    // Abandon the transition: the original address remains the committed page.
    act(() => root.render(screen(URL_SOURCE, false)));
    await settle();
    expect(box().value).toBe("words on the still-visible page");
  });

  it("does not open a new address while the reused textarea still has focus", async () => {
    await JOB.start();
    focus();
    const visible = box();
    const other = makeJob("job-2", "running", "other-paper");
    addResult = other;
    jobs = [other];
    render({ kind: "url", url: "https://example.com/other-paper" });
    await settle();
    expect(box()).toBe(visible);
    expect(document.activeElement).toBe(box());
    jobs = [makeJob("job-2", "done", "other-paper")];
    render();
    await settle();
    expect(navigations, "opened with the caret still in the box").toEqual([]);
    expect(button(OPEN)).toBeDefined();
  });
});


it("the visible ready page can open while a new-address render is suspended", async () => {
  const never = new Promise<void>(() => {});
  function Gate({ blocked }: { blocked: boolean }) {
    if (blocked) throw never;
    return null;
  }
  const screen = (next: typeof source, blocked: boolean) =>
    createElement(Suspense, { fallback: "Waiting" },
      createElement(AddPage, { source: next }), createElement(Gate, { blocked }));
  addResult = makeJob("job-1", "running");
  jobs = [addResult];
  act(() => root.render(screen(URL_SOURCE, false)));
  await settle();
  focus();
  jobs = [makeJob("job-1", "done")];
  act(() => root.render(screen(URL_SOURCE, false)));
  await settle();
  expect(navigations).toEqual([]);
  await act(async () => {
    startTransition(() => root.render(screen({ kind: "url", url: "https://example.com/other" }, true)));
  });
  press(OPEN);
  expect(navigations, "a speculative completion fenced off the button still on screen").toEqual([`/read/${SLUG}`]);
});


describe("same-slug retirement across page lifetimes (F9)", () => {
  it.each(["unmount and later mount", "three rapid sessions"])("orders A, B and the latest words through %s", async (path) => {
    const first = heldResponse();
    const lastOld = heldResponse();
    const lastNew = heldResponse();
    const answers = [first, lastOld, lastNew];
    patchAnswer = () => (answers.shift() as ReturnType<typeof heldResponse>).promise;
    await JOB.start();
    type("A");
    await pause(ADD_PURPOSE_IDLE_MS);
    type("B");
    const before = reads.length;

    if (path === "unmount and later mount") {
      unmount();
      await settle();
      root = createRoot(host);
      mounted = true;
      render(URL_SOURCE);
      await settle();
    } else {
      addResult = makeJob("job-2", "running", SLUG);
      jobs = [addResult];
      render({ kind: "url", url: "https://example.com/a-paper/" });
      await settle();
      type("C");
      addResult = makeJob("job-3", "running", SLUG);
      jobs = [addResult];
      render({ kind: "url", url: "https://example.com/a-paper?third=1" });
      await settle();
    }
    const latest = path === "unmount and later mount" ? "C" : "D";
    type(latest);
    await pause(ADD_PURPOSE_IDLE_MS * 2);
    expect(reads, "a successor read before every predecessor finished").toHaveLength(before);
    expect(patches()).toEqual([patch("A")]);

    first.answer(storePurpose(SLUG, { purpose: "A" }));
    await settle();
    expect(patches()).toEqual([patch("A"), patch("B")]);
    expect(reads).toHaveLength(before);
    lastOld.answer(storePurpose(SLUG, { purpose: "B" }));
    await settle();
    expect(patches()).toEqual([patch("A"), patch("B"), patch(latest)]);
    lastNew.answer(storePurpose(SLUG, { purpose: latest }));
    await settle();
    expect(purposes.get(SLUG)).toBe(latest);
    expect(ticked()).toBe(true);
    expect(leaving()).toBe(false);
  });
});

/**
 * **A repeat paste stops to say so** — Greg, 2026-10-06: *"yes repeat pastes
 * should be free (and signal they're a repeat in the UI)"*. The server answers
 * `{ article, repeat: true }` with nothing spent and nothing queued, so the
 * page must not open by itself (the reader would see nothing to notice), must
 * not offer boxes that apply to an import that never ran, and must not go on
 * saying "Queueing it…". docs/plans/261007k-repeat-paste-is-free-and-says-so.md.
 */
describe("a repeat paste of an article already on the shelf", () => {
  it("under StrictMode a repeat stays, and a double press opens once", async () => {
    strict = true;
    addResult = { article: SLUG, repeat: true };
    render(URL_SOURCE);
    await settle();
    expect(navigations).toEqual([]);
    const open = button(OPEN)!;
    act(() => { open.click(); open.click(); });
    await settle();
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("a late repeat answer for an old address cannot replace the new one", async () => {
    let answer!: (value: AddAnswer) => void;
    addResult = new Promise((resolve) => { answer = resolve; });
    render(URL_SOURCE);
    await settle();
    addResult = { article: "new-address-article", repeat: true };
    render({ kind: "url", url: "https://example.org/new-address" });
    await settle();
    answer({ article: SLUG, repeat: true });
    await settle();
    expect(navigations).toEqual([]);
    press(OPEN);
    expect(navigations).toEqual(["/read/new-address-article"]);
  });

  it("keeps a draft entered before the repeat answer and waits for its save", async () => {
    let answer!: (value: AddAnswer) => void;
    addResult = new Promise((resolve) => { answer = resolve; });
    render(URL_SOURCE);
    await settle();
    focus();
    type("why this matters to me");
    patchAnswer = async () => json({ error: "save refused" }, { status: 500 });
    answer({ article: SLUG, repeat: true });
    await settle();
    expect(box().value).toBe("why this matters to me");
    press(OPEN);
    await settle();
    expect(navigations).toEqual([]);
    expect(box().value).toBe("why this matters to me");
    expect(button(OPEN_UNSAVED)).toBeTruthy();
  });

  it("keeps the outcome of High-powered AI chosen before the repeat answer visible", async () => {
    let answer!: (value: AddAnswer) => void;
    addResult = new Promise((resolve) => { answer = resolve; });
    render(URL_SOURCE);
    await settle();
    const tick = host.querySelector<HTMLInputElement>("[data-add-high-power] input")!;
    act(() => tick.click());
    putAnswer = async () => json({ error: "allowance exhausted" }, { status: 402 });
    answer({ article: SLUG, repeat: true });
    await settle();
    expect(puts()).toEqual([`put:${SLUG}:true`]);
    expect(host.querySelector("[data-add-high-power]")).not.toBeNull();
    expect(host.textContent).toContain("allowance exhausted");
    expect(navigations).toEqual([]);
  });

  it("says it was already there, offers nothing to tick, and opens on the button", async () => {
    const { DIRECT_ADD_SENT_TEXT_AWAY, REPEAT_PASTE_ON_THE_SHELF } = await import("../src/messages.js");
    addResult = { article: SLUG, repeat: true };
    render(URL_SOURCE);
    await settle();

    expect(navigations, "opened by itself over the repeat").toEqual([]);
    expect(host.textContent).toContain(REPEAT_PASTE_ON_THE_SHELF);
    expect(host.textContent).not.toContain("Queueing it");
    expect(host.textContent, "said the text was sent, over a paste that sent nothing").not.toContain(
      DIRECT_ADD_SENT_TEXT_AWAY,
    );
    expect(host.querySelector("textarea"), "the purpose box over a repeat").toBeNull();
    expect(host.querySelector("input[type=checkbox]"), "a box to tick over a repeat").toBeNull();

    press(OPEN);
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(patches()).toEqual([]);
    expect(runs()).toEqual(NO_RUNS);
  });
});

/**
 * **Somebody else has already made this address public**, so the add stops and
 * asks — Greg, 2026-10-09: *"ask them if they'd rather use the public one for
 * free or have their own version which will use up one of their allotted
 * slots."* Nothing was spent, nothing is opened by itself, and nothing of the
 * import's (purpose, High-powered, sharing) is sent to somebody else's article.
 * docs/plans/261009j-a-public-copy-offered-at-import.md.
 */
describe("an address somebody else has made public", () => {
  const THEIRS = { slug: "their-public-copy", title: "Their Public Copy" };

  beforeEach(() => {
    addCalls.length = 0;
  });

  it("asks, under StrictMode, with one request and nothing sent anywhere", async () => {
    const { DIRECT_ADD_SENT_TEXT_AWAY, PUBLIC_COPY_OWN, PUBLIC_COPY_READ } = await import("../src/messages.js");
    strict = true;
    addResult = { publicCopy: THEIRS };
    render(URL_SOURCE);
    await settle();

    expect(addCalls).toEqual(["plain"]);
    expect(host.querySelector("[data-add-public]")).not.toBeNull();
    expect(host.textContent).toContain("Their Public Copy");
    const read = [...host.querySelectorAll("a")].find((a) => a.textContent === PUBLIC_COPY_READ);
    expect(read?.getAttribute("href")).toBe(`/read/${THEIRS.slug}`);
    expect(button(PUBLIC_COPY_OWN)).toBeTruthy();
    expect(navigations, "opened somebody else's article by itself").toEqual([]);
    expect(host.textContent).not.toContain("Queueing it");
    expect(host.textContent).not.toContain(DIRECT_ADD_SENT_TEXT_AWAY);
    expect(host.querySelector("textarea"), "the purpose box over the choice").toBeNull();
    expect(host.querySelector("input[type=checkbox]"), "a box to tick over the choice").toBeNull();
    expect(patches()).toEqual([]);
    expect(puts()).toEqual([]);
    expect(reads.filter((slug) => slug === THEIRS.slug)).toEqual([]);
  });

  it("asks again for the reader's own copy, and carries on as an ordinary import", async () => {
    const { PUBLIC_COPY_OWN } = await import("../src/messages.js");
    strict = true;
    addResult = { publicCopy: THEIRS };
    render(URL_SOURCE);
    await settle();

    const job = makeJob("job-own", "running");
    jobs = [job];
    addResult = job;
    press(PUBLIC_COPY_OWN);
    await settle();

    expect(addCalls).toEqual(["plain", "own"]);
    expect(host.querySelector("[data-add-public]")).toBeNull();
    expect(host.querySelector("textarea"), "the purpose box is back for the import").not.toBeNull();
  });

  it("keeps a High-powered choice made before the answer for the reader's own import, never theirs", async () => {
    const { PUBLIC_COPY_OWN } = await import("../src/messages.js");
    let answer!: (value: AddAnswer) => void;
    addResult = new Promise((resolve) => { answer = resolve; });
    render(URL_SOURCE);
    await settle();
    const tick = host.querySelector<HTMLInputElement>("[data-add-high-power] input")!;
    act(() => tick.click());
    answer({ publicCopy: THEIRS });
    await settle();
    expect(puts(), "High-powered sent to somebody else's article").toEqual([]);

    const job = makeJob("job-own", "running");
    jobs = [job];
    addResult = job;
    press(PUBLIC_COPY_OWN);
    await settle();
    expect(puts()).toEqual([`put:${SLUG}:true`]);
  });

  it("asks for the reader's own copy at once when they chose it on the public article", async () => {
    const { markOwnCopy } = await import("../src/web/own-copy-intent.js");
    strict = true;
    markOwnCopy(URL_SOURCE.url);
    addResult = makeJob("job-own", "running");
    jobs = [addResult];
    render(URL_SOURCE);
    await settle();
    expect(addCalls).toEqual(["own"]);
    expect(host.querySelector("[data-add-public]")).toBeNull();
  });

  it("does not let a mark for one address answer another", async () => {
    const { markOwnCopy } = await import("../src/web/own-copy-intent.js");
    markOwnCopy("https://example.org/somewhere-else");
    addResult = { publicCopy: THEIRS };
    render(URL_SOURCE);
    await settle();
    expect(addCalls).toEqual(["plain"]);
    expect(host.querySelector("[data-add-public]")).not.toBeNull();
  });
});
