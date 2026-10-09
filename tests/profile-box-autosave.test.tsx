// @vitest-environment jsdom
/**
 * **The profile box saves itself, says that it has, and stops you leaving
 * before it has.**
 *
 * Greg, 2026-09-30 (spya-czbj9r): *"make it clearer when it has saved (e.g.
 * show some loading spinner and then green-checkmark or similar. And if I try
 * and close the page before it has saved, either warn the user, or auto-save.
 * Maybe auto-save any time it has been idle for a few seconds?"*
 *
 * `ProfileBox` is the one box behind both `/profile` and Metadata's "Why you're
 * reading this one", so this is where the behaviour lives and where it is
 * tested. docs/plans/261001l-autosave-about-you-and-honest-mic-fallback.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveState } from "../src/web/useAutosavedText.js";
import type { UseDictation } from "../src/web/useDictation.js";

const mic: { armed: boolean; transcribing: boolean } = { armed: false, transcribing: false };

vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (): UseDictation => ({
    supported: true,
    phase: mic.armed ? "listening" : "idle",
    armed: mic.armed,
    transcribing: mic.transcribing,
    liveText: true,
    interim: "",
    level: { current: 0 },
    meter: "none",
    quiet: false,
    toggle: () => {},
    error: null,
    startedAt: mic.armed ? 1_000 : null,
    endsAt: null,
    deviceLabel: null,
    deviceId: null,
    deviceUnavailable: false,
    chooseDevice: () => {},
    recording: null,
    keptOnDevice: false,
    clearRecording: () => {},
    canRetry: false,
    retry: () => {},
    artifact: () => 0,
    dismiss: () => {},
  }),
}));

const { ProfileBox, AUTOSAVE_IDLE_MS } = await import("../src/web/ProfileBox.js");

let host: HTMLDivElement;
let root: Root;
let commits = 0;

function render(value: string, save: SaveState, inFlight = false) {
  act(() => {
    root.render(
      createElement(ProfileBox, {
        id: "about",
        article: null,
        label: "About you",
        hint: "What the model is told about you.",
        placeholder: "",
        value,
        onChange: () => {},
        onCommit: () => {
          commits++;
        },
        max: 500,
        save,
        inFlight,
      }),
    );
  });
}

function status(): string {
  return host.querySelector(".prof-save")?.textContent ?? "";
}

function leaving(): boolean {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

beforeEach(() => {
  vi.useFakeTimers();
  commits = 0;
  mic.armed = false;
  mic.transcribing = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("saving after a pause", () => {
  it("is a few seconds, not a keystroke", () => {
    expect(AUTOSAVE_IDLE_MS).toBeGreaterThanOrEqual(1_500);
    expect(AUTOSAVE_IDLE_MS).toBeLessThanOrEqual(5_000);
  });

  it("commits once the box has been idle, and not before", () => {
    render("Cognitive", { kind: "dirty" });
    act(() => vi.advanceTimersByTime(AUTOSAVE_IDLE_MS - 1));
    expect(commits).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(commits).toBe(1);
  });

  it("starts the pause again on every keystroke", () => {
    render("C", { kind: "dirty" });
    act(() => vi.advanceTimersByTime(AUTOSAVE_IDLE_MS - 100));
    render("Co", { kind: "dirty" });
    act(() => vi.advanceTimersByTime(AUTOSAVE_IDLE_MS - 100));
    expect(commits).toBe(0);
    act(() => vi.advanceTimersByTime(100));
    expect(commits).toBe(1);
  });

  it("does nothing when there is nothing unsaved", () => {
    render("Cognitive", { kind: "clean" });
    act(() => vi.advanceTimersByTime(AUTOSAVE_IDLE_MS * 3));
    expect(commits).toBe(0);
  });

  /* GPT Sol's F2 on docs/plans/261004l-the-add-page-purpose-box-saves-as-you-type.md.
     Loaded S, typed A, A's write goes, typed back to S: the box is clean and
     no timer is armed. When A lands the box is dirty against A, with no
     keystroke to start the pause, and nothing sent S until a blur. */
  it("starts the pause when a write lands over a box that has moved back", () => {
    render("S", { kind: "clean" });
    render("A", { kind: "dirty" });
    act(() => vi.advanceTimersByTime(AUTOSAVE_IDLE_MS));
    expect(commits).toBe(1);
    render("A", { kind: "saving" }, true);
    render("S", { kind: "clean" }, true);
    act(() => vi.advanceTimersByTime(AUTOSAVE_IDLE_MS * 3));
    expect(commits).toBe(1);
    /* A has landed: the same text in the box, now unsaved. */
    render("S", { kind: "dirty" }, false);
    act(() => vi.advanceTimersByTime(AUTOSAVE_IDLE_MS - 1));
    expect(commits).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(commits, "S was never sent after A landed").toBe(2);
  });

  /* F12: a refusal must not earn another attempt by itself, whatever lands. */
  it("does not start the pause over a refusal, even as the write ends", () => {
    render("A", { kind: "saving" }, true);
    render("A", { kind: "error", message: "Too long" }, false);
    act(() => vi.advanceTimersByTime(AUTOSAVE_IDLE_MS * 3));
    expect(commits).toBe(0);
  });

  /* The dictation commits for itself when its words land; a save mid-recording
     would be a save of the box without them. */
  it("waits while the microphone is on", () => {
    mic.armed = true;
    render("Cognitive", { kind: "dirty" });
    act(() => vi.advanceTimersByTime(AUTOSAVE_IDLE_MS * 3));
    expect(commits).toBe(0);
  });

  /* The transcript can take longer than the pause; a save then is a save of
     the recogniser's guesses. GPT Sol's plan review, item 3. */
  it("waits while the transcript is on its way", () => {
    mic.transcribing = true;
    render("Cognitive", { kind: "dirty" });
    act(() => vi.advanceTimersByTime(AUTOSAVE_IDLE_MS * 3));
    expect(commits).toBe(0);
  });
});

describe("leaving the page", () => {
  it("is questioned while there is unsaved text", () => {
    render("Cognitive", { kind: "dirty" });
    expect(leaving()).toBe(true);
  });

  it("is questioned while a save is still on its way", () => {
    render("Cognitive", { kind: "saving" });
    expect(leaving()).toBe(true);
  });

  /* The box can say clean while an older write is still on its way to replace
     what it shows (the F2 shape); that is not safe to leave either. */
  it("is questioned while any write is in flight, whatever the box says", () => {
    render("S", { kind: "clean" }, true);
    expect(leaving()).toBe(true);
  });

  it("is not questioned once it is saved", () => {
    render("Cognitive", { kind: "saved" });
    expect(leaving()).toBe(false);
    render("Cognitive", { kind: "clean" });
    expect(leaving()).toBe(false);
  });
});

describe("what it says", () => {
  /* Greg, 2026-10-05: "a faint green tick that appears when it saves (with a
     tooltip) and then fades away, with no scary 'unsaved' indicator". So the
     words are the same before, during and after; only the tick comes and goes. */
  it("reads the same while typing and while saving, with no tick and no spinner", () => {
    render("Cognitive", { kind: "clean" });
    const quiet = status();
    expect(quiet).toBe("Saves as you type.");
    for (const kind of ["dirty", "saving"] as const) {
      render("Cognitive", { kind });
      expect(status(), kind).toBe(quiet);
      expect(status(), kind).not.toMatch(/unsaved|not saved|saving/i);
      expect(host.querySelector(".prof-save svg"), kind).toBeNull();
    }
  });

  it("ticks a save that landed, and says Saved to a screen reader and on hover", () => {
    render("Cognitive", { kind: "saved" });
    const tick = host.querySelector<HTMLElement>(".prof-save.is-saved .prof-save-tick");
    expect(tick?.querySelector("svg")).not.toBeNull();
    /* A polite announcement may wait longer than the visual tick. Its words
       must survive the tick becoming visibility:hidden. */
    expect(host.querySelector(".prof-save > .sr-only")?.textContent).toBe("Saved");
    expect(tick?.querySelector(".sr-only")).toBeNull();
    expect(tick?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector(".prof-save-words")?.textContent).toBe("Saves as you type.");
    /* The card is the house Tooltip, opened by hover. */
    act(() => {
      tick?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      tick?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      vi.advanceTimersByTime(2_000);
    });
    expect(document.querySelector("[role=tooltip]")?.textContent).toBe("Saved");
  });

  it("removes an open tooltip when the visual tick finishes, keeping the polite words", () => {
    render("Cognitive", { kind: "saved" });
    const tick = host.querySelector<HTMLElement>(".prof-save-tick");
    act(() => {
      tick?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      tick?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      vi.advanceTimersByTime(2_000);
    });
    expect(document.querySelector("[role=tooltip]")).not.toBeNull();
    /* jsdom has WebkitAnimation styles but no AnimationEvent constructor,
       so React subscribes to the prefixed event in this environment. */
    act(() => tick?.dispatchEvent(new Event("webkitAnimationEnd", { bubbles: true })));
    expect(host.querySelector(".prof-save-tick")).toBeNull();
    expect(document.querySelector("[role=tooltip]")).toBeNull();
    expect(host.querySelector(".prof-save > .sr-only")?.textContent).toBe("Saved");
  });

  /* The fade is a CSS animation on a mounted element, so a second save has to
     mount a new one or its tick would never be seen. */
  it("ticks again for the next save", () => {
    render("Cognitive", { kind: "saved" });
    const first = host.querySelector(".prof-save-tick");
    render("Cognitive more", { kind: "dirty" });
    expect(host.querySelector(".prof-save-tick")).toBeNull();
    render("Cognitive more", { kind: "saved" });
    expect(host.querySelector(".prof-save-tick")).not.toBeNull();
    expect(host.querySelector(".prof-save-tick")).not.toBe(first);
  });

  it("names the failure rather than looking saved", () => {
    render("Cognitive", { kind: "error", message: "Too long" });
    expect(status()).toMatch(/not saved/i);
    expect(status()).toContain("Too long");
  });
});
