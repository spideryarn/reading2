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
 * docs/research/microphone-library-options.md, which has the reasoning.
 *
 * That description slot carries something worth saying instead. For one day it
 * was an *"unreliable"* sticker; since 2026-08-27 it is the microphone's one
 * promise — **your voice is sent to be transcribed, and is not stored** — which
 * is a fact about how the control works rather than a warning about whether it
 * does. The sticker went with the bug it was about; the sentence replacing it
 * is the privacy reversal that dictation's second pass required, and it is
 * tested here for the same reason the sticker was: it has to be reachable
 * *from the button*, which is the difference between a promise and a
 * decoration. docs/plans/dictation-two-pass.md.
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

beforeEach(() => {
  state.armed = false;
  state.transcribing = false;
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
    expect(described?.textContent).toContain("sent to be transcribed");
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
});

describe("what the reader is told before they press it", () => {
  it("says the voice is sent to be transcribed, and not stored", () => {
    render();
    const words = host.querySelector(".prof-mic-note .sr-only")?.textContent ?? "";
    expect(words).toContain("sent to be transcribed");
    expect(words).toContain("isn't stored");
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
    expect(described?.textContent).toContain("sent to be transcribed");
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
