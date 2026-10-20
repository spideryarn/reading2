// @vitest-environment jsdom
/**
 * **The add page's two microphones, and the page that leaves by itself** —
 * plan docs/plans/261020r-dictation-on-the-add-page-boxes-and-a-microphone-by-default.md
 * § Stage 4. Report spya-wc4vku (Greg, 2026-10-19).
 *
 * Unmounting a box aborts its dictation, and this page opens the article by
 * itself when the import finishes. So every exit has to ask whether either box
 * is busy (armed, or its words on their way), and nothing may save the rough
 * live guesses by itself. What is pinned:
 *
 *  - completion while a box is busy waits at *ready*, and still waits after;
 *  - every press that opens the article is disabled and refuses while busy;
 *  - a public-copy answer does not unmount a busy box, and its Read link is
 *    disabled while it is;
 *  - once *Open* is waiting on a save, neither microphone can start;
 *  - no idle save, no hidden-tab save, of live guesses; the dictation's own
 *    commit at its end saves the transcript;
 *  - the keeper's box names, and the report's surface.
 *
 * `useDictation` is stubbed as tests/help-ask-dictation.test.tsx does, but per
 * box: both boxes call it, so its options and its armed/transcribing state are
 * keyed by the keeper's box name. The add-page harness is a cut-down copy of
 * tests/add-page-purpose.test.tsx's.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "../src/types.js";
import type { UseJobs } from "../src/web/useJobs.js";
import type { Transfer } from "../src/web/uploadEngine.js";
import type { DictationFailure } from "../src/web/transcriber.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom's storages are shadowed by Node's here (tests/add-page-purpose.test.tsx). */
for (const name of ["localStorage", "sessionStorage"] as const) {
  const map = new Map<string, string>();
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
    },
  });
}

/* ---------- the microphone, one per box ---------- */

interface MicOptions {
  onText(text: string): void;
  onTranscript(text: string): boolean | undefined;
  onEnd(): void;
  keep?: { box: string };
  report(failure: DictationFailure, context: unknown): void;
}
const mic = vi.hoisted(() => ({
  state: new Map<string, { armed: boolean; transcribing: boolean }>(),
  options: new Map<string, unknown>(),
  reported: [] as Array<Record<string, string> | undefined>,
  /** The hook refuses a start, as it does for a moved offer or a press in the cap's grace. */
  refuse: false,
}));
vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (options: { keep?: { box: string } }) => {
    const name = options.keep?.box ?? "(no keeper)";
    mic.options.set(name, options);
    const s = mic.state.get(name) ?? { armed: false, transcribing: false };
    return {
      supported: true,
      phase: s.armed ? "listening" : s.transcribing ? "transcribing" : "idle",
      armed: s.armed,
      transcribing: s.transcribing,
      liveText: true,
      interim: "",
      level: { current: 0 },
      meter: "none",
      quiet: false,
      error: null,
      startedAt: null,
      endsAt: null,
      deviceLabel: null,
      deviceId: null,
      deviceUnavailable: false,
      recording: null,
      keptOnDevice: false,
      canRetry: false,
      testBox: name,
      toggle() {
        if (mic.refuse && !s.armed) return false;
        mic.state.set(name, { armed: !s.armed, transcribing: false });
      },
      dismiss() {},
      chooseDevice() {},
      clearRecording() {},
      retry() {
        mic.state.set(name, { armed: false, transcribing: true });
      },
    };
  },
}));
vi.mock("../src/web/DictationStrip.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/DictationStrip.js")>()),
  DictationStrip: ({ dictation }: { dictation: { testBox: string; retry(): void } }) =>
    createElement("button", {
      type: "button",
      "data-test-retry": dictation.testBox,
      onClick: dictation.retry,
    }),
}));
vi.mock("../src/web/dictation-upload.js", () => ({
  useReaderTranscriber: () => async () => {
    throw new Error("not called");
  },
}));
vi.mock("../src/web/monitoring.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/monitoring.js")>()),
  captureClientFailure: (_err: unknown, tags?: Record<string, string>) => {
    mic.reported.push(tags);
  },
}));

/* ---------- the queue, the upload, the router, the server ---------- */

const events: string[] = [];
const patches = () => events.filter((e) => e.startsWith("patch:"));
const profiles = () => events.filter((e) => e.startsWith("profile:"));
const navigations: string[] = [];

let jobs: Job[] = [];
type AddAnswer = Job | { publicCopy: { slug: string; title: string } } | null;
let addResult: AddAnswer | Promise<AddAnswer> = null;
const queue: UseJobs = {
  get jobs() {
    return jobs;
  },
  loaded: true,
  error: null,
  driverFailures: {},
  lastFailure: () => null,
  add: async () => addResult,
  addUpload: () => Promise.resolve(null) as ReturnType<UseJobs["addUpload"]>,
  run: async (request) => {
    events.push(`run:${request.steps.join(",")}`);
    return null;
  },
  reset: async () => null,
  cancel: async () => {},
  retry: async () => null,
  forget: async () => {},
};
vi.mock("../src/web/useJobs.js", () => ({ useJobs: () => queue, useJobSession: () => {} }));

let transfer: Transfer | null = null;
vi.mock("../src/web/useUpload.js", () => ({ useUpload: () => transfer }));
vi.mock("../src/web/uploadEngine.js", () => ({ uploadEngine: { retry: () => {}, cancel: () => {} } }));
vi.mock("../src/web/router.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/router.js")>()),
  navigate: (href: string) => {
    navigations.push(href);
  },
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const purposes = new Map<string, string>();
let readerProfile: string | null = null;
let patchAnswer: (body: { purpose: string | null }, slug: string) => Promise<Response>;
let purposeAnswer: (slug: string) => Promise<Response>;
const readPurpose = (slug: string) =>
  json({ autoModes: true, purpose: purposes.get(slug) ?? null, purposeFailed: false });
const storePurpose = (slug: string, body: { purpose: string | null }) => {
  const value = body.purpose?.trim() ?? "";
  if (value === "") purposes.delete(slug);
  else purposes.set(slug, value);
  return json({ entry: null, purpose: value === "" ? null : value });
};
vi.mock("../src/web/lib/api.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/lib/api.js")>()),
  apiFetch: async (input: string, init: RequestInit = {}) => {
    if (input === "/api/reader" && init.method === "PATCH" && String(init.body).includes('"profile"')) {
      const body = JSON.parse(String(init.body)) as { profile: string | null };
      events.push(`profile:${body.profile}`);
      readerProfile = body.profile;
      return json({ profile: readerProfile });
    }
    if (input === "/api/reader" && init.method === "PATCH") return json({ autoModes: true });
    if (input === "/api/reader") return json({ autoModes: true, profile: readerProfile });
    if (input.startsWith("/api/reader?slug=")) {
      return purposeAnswer(decodeURIComponent(input.slice("/api/reader?slug=".length)));
    }
    if (init.method === "PATCH" && input.startsWith("/api/library/")) {
      const body = JSON.parse(String(init.body)) as { purpose: string | null };
      const slug = decodeURIComponent(input.slice("/api/library/".length));
      events.push(`patch:${slug}:${body.purpose}`);
      return patchAnswer(body, slug);
    }
    if (init.method === "PUT" && input.endsWith("/high-power")) return json({ highPowerSince: null });
    throw new Error(`unexpected fetch ${input}`);
  },
  leavingFetch: (input: string, init: RequestInit = {}) => {
    events.push(`leave:${input}:${String(init.body)}`);
    return Promise.resolve();
  },
}));

const { AddPage, resetAddPurposeForTests } = await import("../src/web/AddPage.js");
const { ADD_PURPOSE_IDLE_MS } = await import("../src/web/add-purpose.js");
const { AUTOSAVE_IDLE_MS } = await import("../src/web/ProfileBox.js");
const { resetAutoModesSettingForTests } = await import("../src/web/auto-modes-setting.js");
const { PUBLIC_COPY_READ } = await import("../src/messages.js");
const { normaliseUrl } = await import("../src/ingest.js");

const SLUG = "a-paper";
const URL_SOURCE = { kind: "url", url: "https://example.com/a-paper" } as const;
const OPEN = "Open the article";
const OPEN_UNSAVED = "Open without saving";
const ABOUT = "add:about-you";
const makeJob = (id: string, status: Job["status"]): Job =>
  ({ id, slug: SLUG, status, steps: [] }) as unknown as Job;

let host: HTMLDivElement;
let root: Root;
let mounted = false;
let source: Parameters<typeof AddPage>[0]["source"] = URL_SOURCE;

function render(next = source): void {
  source = next;
  act(() => root.render(createElement(AddPage, { source })));
}
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}
async function pause(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}
async function start(): Promise<void> {
  addResult = makeJob("job-1", "running");
  jobs = [addResult];
  render(URL_SOURCE);
  await settle();
}
async function finish(): Promise<void> {
  jobs = [makeJob("job-1", "done")];
  render();
  await settle();
}

const purposeBox = () => host.querySelector<HTMLTextAreaElement>("#add-purpose");
const aboutBox = () => host.querySelector<HTMLTextAreaElement>("#add-about-you");
const button = (name: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
const press = (name: string): void => {
  const b = button(name);
  if (!b) throw new Error(`no ${name} button`);
  act(() => b.click());
};
/**
 * The button's own handler, past `disabled`: a disabled button swallows the
 * click, so this is how a test asks whether the handler refuses as well.
 */
function forceClick(el: Element | undefined): void {
  if (!el) throw new Error("nothing to click");
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  const props = key ? (el as unknown as Record<string, { onClick?: () => void }>)[key] : undefined;
  if (!props?.onClick) throw new Error("no onClick on the element");
  act(() => props.onClick?.());
}
const openButtons = () =>
  [...host.querySelectorAll<HTMLButtonElement>("[data-add-ready] button")].filter(
    (b) => b.textContent?.trim() === OPEN,
  );
const bars = () => [...host.querySelectorAll("[data-add-ready]")].map((b) => b.getAttribute("data-add-ready"));
const mics = () => [...host.querySelectorAll<HTMLButtonElement>("button.prof-mic")];

function type(el: HTMLTextAreaElement | null, value: string): void {
  if (!el) throw new Error("no box");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The purpose box's keeper name, whatever the address is. */
const purposeName = (): string => {
  const names = [...mic.options.keys()].filter((k) => k.startsWith("add:purpose:"));
  if (names.length === 0) throw new Error("no purpose microphone drawn");
  return names[names.length - 1] as string;
};
const options = (name: string): MicOptions => {
  const o = mic.options.get(name);
  if (!o) throw new Error(`no microphone for ${name}`);
  return o as MicOptions;
};
/** Put a box's microphone into a state, and redraw so the field sees it. */
function setMic(name: string, state: "armed" | "transcribing" | "idle"): void {
  mic.state.set(name, { armed: state === "armed", transcribing: state === "transcribing" });
  render();
}
/** A live guess, as Chromium's recogniser hands it over. */
function live(name: string, text: string): void {
  act(() => options(name).onText(text));
}
/** The dictation ends: the transcript, if any, then the hook's `onEnd`. */
async function end(name: string, transcript?: string): Promise<void> {
  act(() => {
    if (transcript !== undefined) options(name).onTranscript(transcript);
    mic.state.set(name, { armed: false, transcribing: false });
    options(name).onEnd();
  });
  render();
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  resetAutoModesSettingForTests();
  resetAddPurposeForTests();
  window.localStorage.clear();
  window.sessionStorage.clear();
  mic.state.clear();
  mic.options.clear();
  mic.reported.length = 0;
  mic.refuse = false;
  purposes.clear();
  readerProfile = null;
  events.length = 0;
  navigations.length = 0;
  jobs = [];
  addResult = null;
  transfer = null;
  source = URL_SOURCE;
  patchAnswer = async (body, slug) => storePurpose(slug, body);
  purposeAnswer = async (slug) => readPurpose(slug);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mounted = true;
});

afterEach(async () => {
  if (mounted) {
    mounted = false;
    act(() => root.unmount());
  }
  await vi.advanceTimersByTimeAsync(0);
  host.remove();
  vi.useRealTimers();
});

describe.each([
  { box: "purpose", state: "armed" },
  { box: "purpose", state: "transcribing" },
  { box: "about you", state: "armed" },
] as const)("the import finishes while the $box box is $state", ({ box, state }) => {
  it("waits at ready with both Open buttons disabled, and still waits once the words are in", async () => {
    await start();
    const name = box === "purpose" ? purposeName() : ABOUT;
    setMic(name, state);
    await finish();
    expect(navigations, "the page left, aborting a live dictation").toEqual([]);
    expect(bars()).toEqual(["top", "bottom"]);
    expect(openButtons()).toHaveLength(2);
    for (const b of openButtons()) expect(b.disabled, "Open the article lit while dictating").toBe(true);
    forceClick(openButtons()[0]);
    forceClick(openButtons()[1]);
    await settle();
    expect(navigations, "Open the article's handler did not refuse while dictating").toEqual([]);

    await end(name);
    await pause(ADD_PURPOSE_IDLE_MS * 3);
    expect(navigations, "left by itself once the dictation ended: the reader was in the box").toEqual([]);
    for (const b of openButtons()) expect(b.disabled).toBe(false);
    act(() => openButtons()[0]?.click());
    await settle();
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });
});

describe("every press that opens the article", () => {
  it("⌘/Ctrl+Enter in the purpose box does not open while it is dictating", async () => {
    await start();
    const name = purposeName();
    setMic(name, "armed");
    await finish();
    act(() => {
      purposeBox()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
      purposeBox()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    });
    await settle();
    expect(navigations).toEqual([]);
    await end(name);
    act(() => {
      purposeBox()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    });
    await settle();
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("Open without saving is disabled and refuses while a box is dictating", async () => {
    patchAnswer = async () => json({ error: "The shelf is unavailable." }, 503);
    await start();
    type(purposeBox(), "the evidence");
    await finish();
    press(OPEN);
    await settle();
    expect(button(OPEN_UNSAVED), "the refusal did not offer Open without saving").toBeTruthy();

    setMic(ABOUT, "armed");
    expect(button(OPEN_UNSAVED)?.disabled).toBe(true);
    forceClick(button(OPEN_UNSAVED));
    await settle();
    expect(navigations, "Open without saving left over a live dictation").toEqual([]);

    await end(ABOUT);
    expect(button(OPEN_UNSAVED)?.disabled).toBe(false);
    press(OPEN_UNSAVED);
    await settle();
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("a microphone press the hook refuses does not leave the page holding", async () => {
    await start();
    act(() => purposeBox()?.focus());
    type(purposeBox(), "the evidence");
    await finish();
    mic.refuse = true;
    act(() => mics()[0]?.click());
    await settle();
    for (const b of openButtons()) expect(b.disabled, "a refused start left the page thinking a box was busy").toBe(false);
    act(() => openButtons()[0]?.click());
    await settle();
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("once Open is waiting on a save, neither microphone can start", async () => {
    await start();
    act(() => purposeBox()?.focus());
    type(purposeBox(), "the evidence");
    await finish();
    expect(navigations).toEqual([]);
    expect(mics()).toHaveLength(2);
    for (const m of mics()) expect(m.disabled).toBe(false);

    let answer: (r: Response) => void = () => {};
    patchAnswer = (body, slug) =>
      new Promise((resolve) => {
        answer = (r) => {
          storePurpose(slug, body);
          resolve(r);
        };
      });
    press(OPEN);
    await settle();
    expect(button("Saving…")).toBeTruthy();
    expect(mics()).toHaveLength(2);
    for (const m of mics()) expect(m.disabled, "a microphone could start under a pending Open").toBe(true);

    answer(json({ entry: null, purpose: "the evidence" }));
    await settle();
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });
});

describe("somebody else's public copy, answered while the purpose box is dictating", () => {
  const THEIRS = { slug: "their-public-copy", title: "Their Public Copy" };

  it("keeps the box when the microphone press and public-copy answer land in one batch", async () => {
    let answer: (value: AddAnswer) => void = () => {};
    addResult = new Promise((resolve) => {
      answer = resolve;
    });
    render(URL_SOURCE);
    await settle();

    act(() => {
      mics()[0]?.click();
      answer({ publicCopy: THEIRS });
    });
    await settle();

    expect(purposeBox(), "the answer unmounted a dictation before its layout effect reported busy").not.toBeNull();
    expect(button(PUBLIC_COPY_READ)?.disabled).toBe(true);
  });

  it("keeps the box when a transcription retry and public-copy answer land in one batch", async () => {
    let answer: (value: AddAnswer) => void = () => {};
    addResult = new Promise((resolve) => {
      answer = resolve;
    });
    render(URL_SOURCE);
    await settle();

    act(() => {
      host.querySelector<HTMLButtonElement>(`[data-test-retry="${purposeName()}"]`)?.click();
      answer({ publicCopy: THEIRS });
    });
    await settle();

    expect(purposeBox(), "the answer unmounted a retry before its layout effect reported busy").not.toBeNull();
    expect(button(PUBLIC_COPY_READ)?.disabled).toBe(true);
  });

  it("keeps the box, disables the Read link, and lets the box go once the words are in", async () => {
    let answer: (value: AddAnswer) => void = () => {};
    addResult = new Promise((resolve) => {
      answer = resolve;
    });
    render(URL_SOURCE);
    await settle();
    expect(purposeBox(), "no purpose box while the add was asked").not.toBeNull();
    const name = purposeName();
    setMic(name, "armed");
    answer({ publicCopy: THEIRS });
    await settle();

    expect(host.querySelector("[data-add-public]")).not.toBeNull();
    expect(purposeBox(), "the answer unmounted a live recording").not.toBeNull();
    expect(
      [...host.querySelectorAll("a")].find((a) => a.textContent === PUBLIC_COPY_READ),
      "a live link away from a live dictation",
    ).toBeUndefined();
    expect(button(PUBLIC_COPY_READ)?.disabled).toBe(true);
    expect(navigations).toEqual([]);

    await end(name);
    expect(purposeBox()).toBeNull();
    const read = [...host.querySelectorAll("a")].find((a) => a.textContent === PUBLIC_COPY_READ);
    expect(read?.getAttribute("href")).toBe(`/read/${THEIRS.slug}`);
  });
});

describe("no save of the live guesses", () => {
  it("purpose: no idle save while armed; the dictation's commit saves the transcript", async () => {
    await start();
    const name = purposeName();
    setMic(name, "armed");
    live(name, "the rough guess");
    expect(purposeBox()?.value).toBe("the rough guess");
    await pause(ADD_PURPOSE_IDLE_MS * 5);
    expect(patches(), "the live guesses were saved by the idle timer").toEqual([]);

    await end(name, "the transcript");
    expect(purposeBox()?.value).toBe("the transcript");
    expect(patches()).toEqual([`patch:${SLUG}:the transcript`]);
  });

  it("purpose: a hidden tab does not commit while armed; the dictation's commit saves", async () => {
    await start();
    const name = purposeName();
    setMic(name, "armed");
    live(name, "the rough guess");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try {
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await settle();
      expect(patches(), "a hidden tab saved the live guesses").toEqual([]);
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
    expect(document.visibilityState).toBe("visible");

    await end(name, "the transcript");
    expect(patches()).toEqual([`patch:${SLUG}:the transcript`]);
  });

  it("purpose: a stored purpose read during a dictation is held, and the box unchanged until the end", async () => {
    purposes.set(SLUG, "why I came");
    let answer: () => void = () => {};
    purposeAnswer = (slug) =>
      new Promise((resolve) => {
        answer = () => resolve(readPurpose(slug));
      });
    await start();
    const name = purposeName();
    setMic(name, "armed");
    answer();
    await settle();
    expect(purposeBox()?.value, "a stored purpose moved into the box under a live dictation").toBe("");
    expect(patches()).toEqual([]);

    await end(name);
    expect(purposeBox()?.value).toBe("why I came");
    expect(patches()).toEqual([]);
  });

  it("purpose: a session made mid-dictation, when the slug arrives, starts paused", async () => {
    /* An upload has no slug until it is answered with an article, so the
       session is replaced then, under a dictation that is already running. */
    purposes.set(SLUG, "why I came");
    transfer = { uploadId: "up-1", filename: "p.pdf", bytes: 10, phase: { kind: "sending", sent: 4 } };
    render({ kind: "upload", uploadId: "up-1" });
    await settle();
    const name = purposeName();
    setMic(name, "armed");
    live(name, "the rough guess");
    transfer = { uploadId: "up-1", filename: "p.pdf", bytes: 10, phase: { kind: "article", slug: SLUG } };
    render();
    await settle();
    await pause(ADD_PURPOSE_IDLE_MS * 5);
    expect(navigations).toEqual([]);
    expect(purposeBox()?.value).toBe("the rough guess");
    expect(patches(), "the new session saved the live guesses").toEqual([]);

    await end(name, "the transcript");
    expect(patches()).toEqual([`patch:${SLUG}:the transcript`]);
  });

  it("About you: no profile save while armed, even past the pause; saved at the end", async () => {
    await start();
    expect(aboutBox(), "About you is offered to a reader with no profile").not.toBeNull();
    setMic(ABOUT, "armed");
    live(ABOUT, "A nurse, new to");
    expect(aboutBox()?.value).toBe("A nurse, new to");
    await pause(AUTOSAVE_IDLE_MS * 3);
    expect(profiles(), "About you saved the live guesses").toEqual([]);

    await end(ABOUT, "A nurse, new to statistics.");
    expect(profiles()).toEqual(["profile:A nurse, new to statistics."]);
  });
});

describe("the keeper's names and the report's surface", () => {
  it("names the purpose box by the address and About you by nothing", async () => {
    await start();
    expect(purposeName()).toBe(`add:purpose:${normaliseUrl(URL_SOURCE.url)}`);
    expect(mic.options.has(ABOUT)).toBe(true);
  });

  it("gives two uploads two purpose names", async () => {
    transfer = { uploadId: "up-1", filename: "p.pdf", bytes: 10, phase: { kind: "sending", sent: 4 } };
    render({ kind: "upload", uploadId: "up-1" });
    await settle();
    expect(mic.options.has("add:purpose:up-1")).toBe(true);
    transfer = { uploadId: "up-2", filename: "q.pdf", bytes: 10, phase: { kind: "sending", sent: 4 } };
    render({ kind: "upload", uploadId: "up-2" });
    await settle();
    expect(mic.options.has("add:purpose:up-2")).toBe(true);
    expect(mic.options.has("add:purpose:")).toBe(false);
  });

  it("reports a failure in either box as the add page's", async () => {
    await start();
    const failure: DictationFailure = {
      message: "The microphone would not open. [mic-denied]",
      micError: "NotAllowedError",
      live: false,
      chosenMic: "none",
    } as DictationFailure;
    options(purposeName()).report(failure, { kind: "article", slug: SLUG });
    options(ABOUT).report(failure, { kind: "profile" });
    expect(mic.reported.map((t) => t?.dictation_surface)).toEqual(["add", "add"]);
  });
});
