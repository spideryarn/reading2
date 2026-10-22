// @vitest-environment jsdom
/**
 * **Skim's *What are you skimming for?* box takes dictation** — `PurposeAsk`
 * in src/web/SkimPurpose.tsx, plan
 * docs/plans/261021e-microphone-on-the-five-remaining-prose-boxes.md § Stage 2
 * and Sol's F1/F8.
 *
 * What is pinned:
 *
 *  - the box has a microphone, kept as `skim:purpose:<slug>`;
 *  - *Plan the route for this* is disabled, and its handler refuses, while the
 *    microphone is on and again while its words are on their way;
 *  - a banner arriving mid-dictation does not take the box (unmounting would
 *    abort the dictation), and once the microphone is idle it does;
 *  - the microphone cannot start while a save is in flight, or a route is.
 *
 * `useDictation` is stubbed as tests/add-page-dictation.test.tsx does; the
 * purpose read and save are stubbed so `PurposeLine` renders on its own.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseSkim } from "../src/web/useSkim.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ---------- the microphone ---------- */

interface MicOptions {
  onText(text: string): void;
  onTranscript(text: string): boolean | undefined;
  onEnd(): void;
  keep?: { box: string };
}
const mic = vi.hoisted(() => ({
  state: { armed: false, transcribing: false },
  options: null as unknown,
  boxes: [] as string[],
}));
vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (options: { keep?: { box: string } }) => {
    mic.options = options;
    mic.boxes.push(options.keep?.box ?? "(no keeper)");
    const s = mic.state;
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
      toggle() {
        mic.state = { armed: !s.armed, transcribing: false };
        return undefined;
      },
      dismiss() {},
      chooseDevice() {},
      clearRecording() {},
      retry() {},
    };
  },
}));
vi.mock("../src/web/DictationStrip.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/DictationStrip.js")>()),
  DictationStrip: () => null,
}));
vi.mock("../src/web/dictation-upload.js", () => ({
  useReaderTranscriber: () => async () => {
    throw new Error("not called");
  },
}));

/* ---------- the purpose ---------- */

const saves: string[] = [];
let saveReply: Promise<string | null> | null = null;
vi.mock("../src/web/purpose.js", () => ({
  usePurpose: () => ({ state: "ready", purpose: null, purposeFailed: false, profile: null }),
  savePurpose: async (_slug: string, text: string) => {
    saves.push(text);
    return saveReply ?? text;
  },
  storedPurpose: async () => null,
}));

const { PurposeLine } = await import("../src/web/SkimPurpose.js");

/* ---------- the harness ---------- */

let ensured = 0;
function owner(over: Partial<UseSkim> = {}): UseSkim {
  return {
    status: "ready",
    skim: null,
    stale: false,
    outdated: false,
    profileChanged: false,
    profileNoticeDismissed: false,
    dismissFailed: null,
    dismissProfileNotice: async () => {},
    notOnRoute: 0,
    slug: "a-route",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    quotesFirst: false,
    ideasFirst: false,
    retryRead: async () => {},
    ensure: async () => {
      ensured += 1;
    },
    regenerate: async () => {},
    rewriting: false,
    refresh: async () => {},
    cancel: () => {},
    ...over,
  } as UseSkim;
}

let host: HTMLDivElement;
let root: Root;
let props: { owner: UseSkim; bannerUp: boolean };

function render(next: Partial<typeof props> = {}): void {
  props = { ...props, ...next };
  act(() => root.render(createElement(PurposeLine, props)));
}
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await act(async () => {});
}

const box = () => host.querySelector<HTMLTextAreaElement>("#skim-purpose-input");
const micButton = () => host.querySelector<HTMLButtonElement>(".skim-purpose-ask button.prof-mic");
const planButton = (): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === "Plan the route for this",
  );
/** The button's own handler, past `disabled` (tests/add-page-dictation.test.tsx § forceClick). */
function forceClick(el: Element | undefined): void {
  if (!el) throw new Error("nothing to click");
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  const p = key ? (el as unknown as Record<string, { onClick?: () => void }>)[key] : undefined;
  if (!p?.onClick) throw new Error("no onClick on the element");
  act(() => p.onClick?.());
}
function type(value: string): void {
  const el = box();
  if (!el) throw new Error("no box");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function setMic(state: "armed" | "transcribing" | "idle"): void {
  mic.state = { armed: state === "armed", transcribing: state === "transcribing" };
  render();
}
async function end(transcript?: string): Promise<void> {
  const o = mic.options as MicOptions;
  act(() => {
    if (transcript !== undefined) o.onTranscript(transcript);
    mic.state = { armed: false, transcribing: false };
    o.onEnd();
  });
  render();
  await settle();
}

beforeEach(async () => {
  mic.state = { armed: false, transcribing: false };
  mic.options = null;
  mic.boxes.length = 0;
  saves.length = 0;
  saveReply = null;
  ensured = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  props = { owner: owner(), bannerUp: false };
  render();
  await settle();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Skim's purpose box takes dictation", () => {
  it("has a microphone, kept per article", () => {
    expect(box()).not.toBeNull();
    expect(micButton()).not.toBeNull();
    expect(mic.boxes).toContain("skim:purpose:a-route");
  });

  for (const state of ["armed", "transcribing"] as const) {
    it(`refuses Plan while ${state}`, async () => {
      type("how they handled missing data");
      expect(planButton()?.disabled).toBe(false);
      setMic(state);
      expect(planButton()?.disabled).toBe(true);
      forceClick(planButton());
      forceClick(planButton());
      await settle();
      expect(saves).toEqual([]);
      expect(ensured).toBe(0);
    });
  }

  it("lets Plan go once the words have landed", async () => {
    setMic("armed");
    await end("how they handled missing data");
    expect(planButton()?.disabled).toBe(false);
    forceClick(planButton());
    await settle();
    expect(saves).toEqual(["how they handled missing data"]);
  });

  it("keeps the box under a banner that arrives mid-dictation, and gives it up once idle", async () => {
    type("how they");
    setMic("armed");
    render({ bannerUp: true });
    await settle();
    expect(box()).not.toBeNull();
    expect(planButton()?.disabled).toBe(true);
    await end("how they handled missing data");
    expect(box()).toBeNull();
    expect(saves).toEqual([]);
  });

  it("claims the hold before a microphone press and banner arrival can share a render", async () => {
    type("how they");
    const m = micButton();
    if (!m) throw new Error("no microphone");
    /* The microphone's state update and the answer that raises the banner can
       land in one React batch. The hold has to be claimed by the press itself;
       a layout effect after the next child render is too late, because the
       parent can decide to unmount that child first. AddPage's two boxes pin
       the same race in `useBusyDictation`. */
    act(() => {
      m.click();
      props = { ...props, bannerUp: true };
      root.render(createElement(PurposeLine, props));
    });
    await settle();
    expect(box()).not.toBeNull();
    expect(planButton()?.disabled).toBe(true);
  });

  it("refuses Plan under a banner even when the box is held and the microphone has just stopped", async () => {
    type("how they");
    setMic("armed");
    render({ bannerUp: true });
    await settle();
    /* Words on their way: still held, still refused. */
    setMic("transcribing");
    expect(box()).not.toBeNull();
    forceClick(planButton());
    await settle();
    expect(saves).toEqual([]);
  });

  /** A double press on Stop: the field's own path to *Plan*, past the button. */
  async function doublePressThenLand(transcript: string): Promise<void> {
    const m = micButton();
    if (!m) throw new Error("no microphone");
    act(() => m.click());
    act(() => m.click());
    await end(transcript);
  }

  it("plans once the words land after a double press on Stop", async () => {
    setMic("armed");
    await doublePressThenLand("how they handled missing data");
    expect(saves).toEqual(["how they handled missing data"]);
  });

  it("does not plan from a double press on Stop under a banner that arrived mid-dictation", async () => {
    setMic("armed");
    render({ bannerUp: true });
    await settle();
    await doublePressThenLand("how they handled missing data");
    expect(saves).toEqual([]);
    expect(box()).toBeNull();
  });

  it("will not start the microphone while a save is in flight", async () => {
    type("how they handled missing data");
    expect(micButton()?.disabled).toBe(false);
    let answer: (v: string | null) => void = () => {};
    saveReply = new Promise((r) => {
      answer = r;
    });
    forceClick(planButton());
    await settle();
    expect(saves).toHaveLength(1);
    expect(micButton()?.disabled).toBe(true);
    await act(async () => answer("how they handled missing data"));
    await settle();
  });

  it("will not start the microphone while a route is being planned elsewhere", async () => {
    render({ owner: owner({ starting: true }) });
    expect(micButton()?.disabled).toBe(true);
  });
});
