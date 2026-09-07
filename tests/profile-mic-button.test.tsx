// @vitest-environment jsdom
/**
 * **The microphone button announces one thing, not two.**
 *
 * It is an *action* button: the name says what the press will do, and there is
 * no `aria-pressed`. The APG's button pattern allows that, and allows the
 * opposite — a fixed name with the state in `aria-pressed` — but not both at
 * once, which is what was here until 2026-08-27: the name swapped between
 * "Dictate" and "Stop dictating" *and* `aria-pressed` was set, so the state
 * arrived twice in two vocabularies and read as "Stop dictating, toggle
 * button, pressed".
 *
 * `title` has to agree rather than merely not collide: with an `aria-label`
 * present, an otherwise-unused `title` becomes the accessible **description**,
 * so a "fixed name, moving tooltip" arrangement rebuilds the same problem one
 * layer down. Found by GPT Sol reviewing
 * docs/research/260827b-microphone-library-options.md, which has the reasoning.
 *
 * That description slot carries something worth saying instead. For one day it
 * was an *"unreliable"* sticker; since 2026-08-27 it is the microphone's one
 * promise — **your voice is sent to OpenAI to be transcribed** — which
 * is a fact about how the control works rather than a warning about whether it
 * does. The sticker went with the bug it was about; the sentence replacing it
 * is the privacy reversal that dictation's second pass required, and it is
 * tested here for the same reason the sticker was: it has to be reachable
 * *from the button*, which is the difference between a promise and a
 * decoration. docs/plans/260827x-dictation-two-pass.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseDictation } from "../src/web/useDictation.js";

/* The button is the whole subject, so the hook behind it is a fixture: one
   mutable object the test poses in each state and re-renders from. */
const state: { armed: boolean; transcribing: boolean } = { armed: false, transcribing: false };

vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (): UseDictation => ({
    supported: true,
    phase: state.transcribing ? "transcribing" : state.armed ? "listening" : "idle",
    armed: state.armed,
    transcribing: state.transcribing,
    liveText: true,
    interim: "",
    level: { current: 0 },
    meter: "none",
    quiet: false,
    toggle: () => {},
    error: null,
    startedAt: state.armed ? 1_000 : null,
    deviceLabel: state.armed ? "MacBook Pro Microphone (Built-in)" : null,
    deviceId: null,
    deviceUnavailable: false,
    chooseDevice: () => {},
    recording: null,
    clearRecording: () => {},
    canRetry: false,
    retry: () => {},
  }),
}));

const { ProfileBox } = await import("../src/web/ProfileBox.js");

let host: HTMLDivElement;
let root: Root;

function render(): HTMLButtonElement {
  act(() => {
    root.render(
      createElement(ProfileBox, {
        id: "about",
        label: "About you",
        hint: "What the model is told about you.",
        placeholder: "",
        value: "",
        onChange: () => {},
        onCommit: () => {},
        max: 500,
      }),
    );
  });
  const button = host.querySelector<HTMLButtonElement>("button.prof-mic");
  if (!button) throw new Error("no microphone button rendered");
  return button;
}

/**
 * Pose the browser as offline or on, the way it actually reaches the page: a
 * `navigator.onLine` that answers, and the event that says it changed.
 * `useOnline` subscribes to the events, so setting the property alone would
 * leave a rendered component showing the old answer for ever.
 */
function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value: online, configurable: true });
  act(() => {
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  });
}

beforeEach(() => {
  state.armed = false;
  state.transcribing = false;
  setOnline(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the microphone button", () => {
  it("names the action, which changes with the state", () => {
    expect(render().getAttribute("aria-label")).toBe("Dictate");
    state.armed = true;
    expect(render().getAttribute("aria-label")).toBe("Stop dictating");
  });

  /* Not a toggle, so it must not also claim to be one. */
  it("sets no aria-pressed", () => {
    expect(render().hasAttribute("aria-pressed")).toBe(false);
    state.armed = true;
    expect(render().hasAttribute("aria-pressed")).toBe(false);
  });

  /* The description slot is finite: it carries the promise, so it must not also
     carry a `title` that merely repeats the name. */
  it("spends its accessible description on the promise, not on its own name", () => {
    const button = render();
    expect(button.hasAttribute("title")).toBe(false);
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const described = host.querySelector(`#${describedBy}`);
    expect(described?.textContent).toContain("transcribed");
  });

  /* The microphone is already off by then, so a press could only mean "start
     again" — and starting again a moment before the words arrive throws away
     the dictation the reader just gave. */
  it("cannot be pressed while the words are being transcribed", () => {
    state.transcribing = true;
    const button = render();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Turning your words into text");
  });

  /**
   * **Recording into nothing is the failure this prevents.** Greg, 2026-09-05:
   * *"If it's offline before, we should disable the mic input button."* The
   * words that get saved come from a `POST /api/transcribe`, so with no network
   * a dictation is a minute of talking followed by a failure — and the button
   * looked exactly as it always does right up until then.
   *
   * `navigator.onLine` is only trusted in this direction; see `useOnline.ts`.
   */
  describe("when the browser says there is no network", () => {
    it("is disabled before the reader can press it", () => {
      setOnline(false);
      expect(render().disabled).toBe(true);
    });

    it("says why, rather than being mysteriously dead", () => {
      setOnline(false);
      const button = render();
      /* Both, because they reach different people: the name is what a screen
         reader announces for a disabled control, and the tooltip is the only
         thing a mouse gets. A disabled button with no reason on it is the
         thing copy.md exists to stop. */
      expect(button.getAttribute("aria-label")).toMatch(/internet connection/i);
      expect(button.getAttribute("title")).toMatch(/internet connection/i);
    });

    it("comes back on its own when the connection does", () => {
      setOnline(false);
      expect(render().disabled).toBe(true);
      setOnline(true);
      expect(render().disabled).toBe(false);
      expect(render().getAttribute("aria-label")).toBe("Dictate");
    });

    /**
     * **It is also the Stop button, and that nearly cost a trapped recording.**
     *
     * Found by GPT Sol reviewing the plan, as a P0: this one control both
     * starts and stops, so disabling it on `offline` would mean a reader whose
     * wifi drops mid-sentence cannot stop the microphone at all — and since
     * 2026-09-05 a recogniser losing its connection no longer ends the
     * dictation either, so nothing else would have ended it. The offline guard
     * is about *starting* something that cannot work; stopping always works,
     * and the transcription is attempted afterwards regardless.
     */
    it("still stops a dictation that is already running", () => {
      state.armed = true;
      setOnline(false);
      const button = render();
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("aria-label")).toBe("Stop dictating");
    });

    /* The promise slot is finite and the offline reason is more urgent than a
       fact about storage the reader cannot act on until the button works. */
    it("spends its description on the reason it cannot be used", () => {
      setOnline(false);
      const button = render();
      const describedBy = button.getAttribute("aria-describedby");
      const described = host.querySelector(`#${describedBy}`);
      expect(described?.textContent).toMatch(/internet connection/i);
    });
  });
});

describe("what the reader is told before they press it", () => {
  /* **This used to assert "isn't stored", and that claim was withdrawn on
     2026-09-07** — dictation moved to a transcriber that cannot be routed with
     zero data retention (docs/plans/260907c-dictation-onto-an-openai-transcriber.md).
     The test was red when the sentence changed, which is what it is for.

     What it pins now is deliberately not the exact wording, because the wording
     is Greg's to approve and will very likely be tuned. It pins the two things
     that make the sentence honest, either of which a well-meaning edit could
     drop while making it read more nicely: **who gets the recording**, and that
     we do **not** tell the reader it is unstored. The second is a negative
     assertion on purpose — it is the one that would otherwise creep back. */
  it("names who receives the voice, and does not claim it is unstored", () => {
    render();
    const words = host.querySelector(".prof-mic-note .sr-only")?.textContent ?? "";
    expect(words).toContain("transcribed");
    expect(words).toMatch(/OpenAI/);
    expect(words).not.toMatch(/isn't stored|is not stored|never stored/i);
  });

  /* **It belongs to the button, not to this box**, which is the fix for a
     project doc that claimed a sentence sat beside every microphone while chat
     and the comment dialog had none. Asserted through `aria-describedby` rather
     than by looking for the class, because being *reachable from the control*
     is the whole property — a sentence on the page that the button does not
     point at is decoration. GPT Sol's code review, item 10. */
  it("is what the button points its description at", () => {
    const button = render();
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const described = host.querySelector(`#${describedBy}`);
    expect(described?.textContent).toContain("transcribed");
  });

  /* Somebody arriving by keyboard should meet it on the way to the control,
     not after it. */
  it("comes before the button in reading order", () => {
    const button = render();
    const mark = host.querySelector(".prof-mic-note");
    if (!mark) throw new Error("no microphone note");
    // Node.DOCUMENT_POSITION_FOLLOWING: the button follows the marker.
    expect(mark.compareDocumentPosition(button) & 4).toBeTruthy();
  });

  /* **The sticker is gone, and this is what stops it coming back.** It was true
     for one day in August and outlived the bug; a word like that left on a
     control people are being asked to rely on is worse than no label at all. */
  it("no longer calls dictation unreliable", () => {
    state.armed = true;
    render();
    expect(host.textContent).not.toMatch(/unreliable/i);
    expect(host.querySelector(".prof-mic-wip")).toBeNull();
  });
});
