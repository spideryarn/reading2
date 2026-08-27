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
 * That description slot now carries something worth saying instead: dictation
 * does not reliably work, and the reader is told so before they lean on it.
 * Greg asked for that on 2026-08-27 having failed to get it working — so these
 * tests also pin that the warning is reachable from the button rather than
 * merely present somewhere on the page, which is the difference between a
 * caveat and a decoration.
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

  /* The description slot is finite: it now carries the caveat, so it must not
     also carry a `title` that merely repeats the name. */
  it("spends its accessible description on the warning, not on its own name", () => {
    const button = render();
    expect(button.hasAttribute("title")).toBe(false);
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const described = host.querySelector(`#${describedBy}`);
    expect(described?.textContent).toContain("often transcribes nothing");
  });
});

describe("the under-construction warning", () => {
  it("is on the page before the button is ever pressed", () => {
    render();
    const mark = host.querySelector(".prof-mic-wip");
    expect(mark?.textContent).toContain("unreliable");
  });

  /* Somebody arriving by keyboard should meet the caveat on the way to the
     control, not after it. */
  it("comes before the button in reading order", () => {
    const button = render();
    const mark = host.querySelector(".prof-mic-wip");
    if (!mark) throw new Error("no warning marker");
    // Node.DOCUMENT_POSITION_FOLLOWING: the button follows the marker.
    expect(mark.compareDocumentPosition(button) & 4).toBeTruthy();
  });

  it("says what to do instead, and that the typed text is safe", () => {
    render();
    const words = host.querySelector(".prof-mic-wip .sr-only")?.textContent ?? "";
    expect(words).toContain("type instead");
    expect(words).toContain("safe");
  });

  /* Repeated while it is running, since the marker is easy to skim past and
     that minute is when it matters — but not read twice, because the button's
     description already carried it. */
  it("says it again while dictation is running, silently", () => {
    expect(host.querySelector(".prof-mic-wip-note")).toBeNull();
    state.armed = true;
    render();
    const note = host.querySelector(".prof-mic-wip-note");
    expect(note?.textContent).toContain("often transcribes nothing");
    expect(note?.getAttribute("aria-hidden")).toBe("true");
  });
});
