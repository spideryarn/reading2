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
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseDictation } from "../src/web/useDictation.js";

/* The button is the whole subject, so the hook behind it is a fixture: one
   mutable object the test poses in each state and re-renders from. */
const state: { armed: boolean } = { armed: false };

vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (): UseDictation => ({
    supported: true,
    phase: state.armed ? "listening" : "idle",
    armed: state.armed,
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

  /* `title` is the accessible description here, not a free-floating tooltip. */
  it("keeps the tooltip saying exactly what the name says", () => {
    expect(render().getAttribute("title")).toBe("Dictate");
    state.armed = true;
    expect(render().getAttribute("title")).toBe("Stop dictating");
  });
});
