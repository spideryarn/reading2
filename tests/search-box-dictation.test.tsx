// @vitest-environment jsdom
/**
 * **Search mode's box takes dictation** — plan
 * docs/plans/261103a-microphone-in-the-search-box.md (report spya-ubbygh).
 *
 * The box is a meaning search as you type: every edit feeds the typing
 * session, which asks a paid quick search after a pause. What is pinned:
 *
 *  - the box has the shared microphone;
 *  - Chromium's live phrases fill the box but never reach the session, so a
 *    half-heard phrase cannot ask a search; the landed words reach it once;
 *  - Enter while the microphone is on stops it and searches when the words
 *    land, with those words (dictation.md § Adding it to a box).
 *
 * `useDictation` is stubbed as tests/comment-note-dictation.test.tsx does.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Matcher } from "../src/web/params.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MicOptions {
  onText(text: string): void;
  onTranscript(text: string): boolean | undefined;
  onEnd(): void;
}
const mic = vi.hoisted(() => ({
  state: { armed: false, transcribing: false } as { armed: boolean; transcribing: boolean },
  error: null as string | null,
  options: null as unknown,
  toggles: 0,
}));
vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (options: unknown) => {
    mic.options = options;
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
      error: mic.error,
      startedAt: null,
      endsAt: null,
      deviceLabel: null,
      deviceId: null,
      deviceUnavailable: false,
      recording: null,
      keptOnDevice: false,
      canRetry: false,
      toggle() {
        mic.toggles += 1;
        /* Stop goes to the transcription, as the real hook does. */
        mic.state = s.armed ? { armed: false, transcribing: true } : { armed: true, transcribing: false };
        return undefined;
      },
      dismiss() {},
      chooseDevice() {},
      clearRecording() {},
      retry() {},
    };
  },
}));
vi.mock("../src/web/dictation-upload.js", () => ({
  useReaderTranscriber: () => async () => {
    throw new Error("not called");
  },
}));

const { SearchPanel } = await import("../src/web/SearchPanel.js");
type Access = Parameters<typeof SearchPanel>[0]["access"];

let container: HTMLDivElement;
let root: Root;
let edits: string[];
let flushes: string[];
let finds: (string | null)[];
let tick: () => void = () => {};

const typing = {
  edit: (text: string) => void edits.push(text),
  flush: (text: string) => void flushes.push(text),
  ownsWords: () => false,
  end() {},
  blur() {},
  focus() {},
};

function Harness({ start }: { start: Matcher }) {
  const [matcher, setMatcher] = useState<Matcher>(start);
  const [find, setFind] = useState<string | null>(null);
  const [, setN] = useState(0);
  tick = () => setN((n) => n + 1);
  const access: Access = {
    kind: "owner",
    loaded: true,
    loadError: null,
    error: null,
    running: new Set(),
    typing,
    onAsk: () => {},
    onRetry: () => {},
    onRecolour: () => {},
    onDelete: () => {},
  };
  return (
    <SearchPanel
      access={access}
      slug="constitution"
      matcher={matcher}
      onMatcher={setMatcher}
      find={find}
      onFind={(next) => {
        finds.push(next);
        setFind(next);
      }}
      runs={[]}
      active={[]}
      slots={new Map()}
      onToggle={() => {}}
      onSolo={() => {}}
      onToggleAll={() => {}}
      found={[]}
      all={[]}
      order="document"
      onOrder={() => {}}
      gate={0}
      gateMoved={false}
      onGate={() => {}}
      openKey={null}
      onOpen={() => {}}
    />
  );
}

const input = () => container.querySelector<HTMLInputElement>("input.srch-input")!;
const micButton = () => container.querySelector<HTMLButtonElement>(".srch-box button.prof-mic");
const options = () => mic.options as MicOptions;
const radio = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (b) => b.textContent?.trim() === name,
  )!;

async function redraw(): Promise<void> {
  await act(async () => tick());
}
async function phase(armed: boolean, transcribing: boolean): Promise<void> {
  mic.state = { armed, transcribing };
  await redraw();
}
async function land(words: string): Promise<void> {
  mic.state = { armed: false, transcribing: false };
  await act(async () => {
    options().onTranscript(words);
    options().onEnd();
  });
  await redraw();
}

beforeEach(async () => {
  mic.state = { armed: false, transcribing: false };
  mic.error = null;
  mic.options = null;
  mic.toggles = 0;
  edits = [];
  flushes = [];
  finds = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness start="meaning" />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Search mode's microphone (261103a)", () => {
  it("has the shared microphone", () => {
    expect(micButton()).not.toBeNull();
  });

  it("asks nothing on half-heard words, and hands the landed words to the session once", async () => {
    await act(async () => micButton()!.click());
    await phase(true, false);
    await act(async () => options().onText("rough live guess"));
    expect(input().value).toBe("rough live guess");
    expect(edits).toEqual([]);
    await phase(false, true);
    await land("the separation of powers");
    expect(input().value).toBe("the separation of powers");
    expect(edits).toEqual(["the separation of powers"]);
    expect(flushes).toEqual([]);
  });

  it("Enter while the microphone is on stops it and searches when the words land", async () => {
    await act(async () => micButton()!.click());
    await phase(true, false);
    await act(async () => options().onText("rough"));
    const toggles = mic.toggles;
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(flushes).toEqual([]);
    expect(mic.toggles).toBe(toggles + 1);
    await land("checks and balances");
    expect(flushes).toEqual(["checks and balances"]);
    // The double press's search is the only one: no second session after it.
    expect(edits).toEqual([]);
  });

  it("Enter on an empty box while recording (Safari: no live words) still waits for the words", async () => {
    await act(async () => micButton()!.click());
    await phase(true, false);
    expect(input().value).toBe("");
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await land("judicial review");
    expect(flushes).toEqual(["judicial review"]);
  });

  it.each(["find", "double Stop"])("%s searches the landed words once, without opening a second session", async (action) => {
    await act(async () => micButton()!.click());
    await phase(true, false);
    await act(async () => options().onText("rough"));
    await act(async () => {
      if (action === "find") container.querySelector<HTMLButtonElement>(".srch-go")!.click();
      else {
        micButton()!.click();
        micButton()!.click();
      }
    });
    expect(flushes).toEqual([]);
    await land("checks and balances");
    expect(flushes).toEqual(["checks and balances"]);
    expect(edits).toEqual([]);
  });

  it("writes live and final words to the words matcher without asking a paid search", async () => {
    await act(async () => radio("words").click());
    await act(async () => micButton()!.click());
    await phase(true, false);
    await act(async () => options().onText("rough"));
    expect(finds.at(-1)).toBe("rough");
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await land("the commerce clause");
    expect(finds.at(-1)).toBe("the commerce clause");
    expect(input().value).toBe("the commerce clause");
    expect(flushes).toEqual([]);
    expect(edits).toEqual([]);
  });

  it("a failed transcription leaves the rough words unsearched", async () => {
    await act(async () => micButton()!.click());
    await phase(true, false);
    await act(async () => options().onText("rough live guess"));
    mic.state = { armed: false, transcribing: false };
    mic.error = "Could not turn that into text. [mic-transcribe]";
    await act(async () => options().onEnd());
    await redraw();
    expect(input().value).toBe("rough live guess");
    expect(edits).toEqual([]);
  });

  it("searches a delivered transcript even when the cap warning remains", async () => {
    await act(async () => micButton()!.click());
    await phase(true, false);
    await act(async () => options().onText("rough"));
    mic.error = "Dictation stopped at the time limit. [mic-capped]";
    await phase(false, true);
    await land("checks and balances");
    expect(edits).toEqual(["checks and balances"]);
  });

  it("does not search rough guesses when no transcript was delivered and no error was set", async () => {
    await act(async () => micButton()!.click());
    await phase(true, false);
    await act(async () => options().onText("rough live guess"));
    // useDictation's empty-success path does not set an error after live words.
    mic.state = { armed: false, transcribing: false };
    await act(async () => options().onEnd());
    await redraw();
    expect(input().value).toBe("rough live guess");
    expect(edits).toEqual([]);
  });

  it("does not search stale rough words after clearing invalidates delivery", async () => {
    await act(async () => micButton()!.click());
    await phase(true, false);
    await act(async () => options().onText("rough live guess"));
    await act(async () => container.querySelector<HTMLButtonElement>(".srch-clear")!.click());
    expect(input().value).toBe("");
    await land("checks and balances");
    expect(input().value).toBe("");
    expect(edits.filter((text) => text !== "")).toEqual([]);
  });

  it("keys typed while the microphone is on wait for its ending", async () => {
    await act(async () => micButton()!.click());
    await phase(true, false);
    await act(async () => options().onText("rough"));
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
        input(),
        "rough typed",
      );
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(edits).toEqual([]);
  });

  it("a words-mode Enter is not a paid search after the toggle moves to meaning", async () => {
    await act(async () => radio("words").click());
    expect(radio("words").getAttribute("aria-checked")).toBe("true");
    await act(async () => micButton()!.click());
    await phase(true, false);
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await act(async () => radio("meaning").click());
    await land("the commerce clause");
    expect(input().value).toBe("the commerce clause");
    expect(flushes).toEqual([]);
    expect(edits).toEqual([]);
  });

  it("a matcher switch away and back keeps automatic submission cancelled", async () => {
    await act(async () => micButton()!.click());
    await phase(true, false);
    await act(async () => options().onText("rough"));
    await act(async () => radio("words").click());
    await act(async () => radio("meaning").click());
    await land("the commerce clause");
    expect(input().value).toBe("the commerce clause");
    expect(flushes).toEqual([]);
    expect(edits).toEqual([]);
  });
});
