// @vitest-environment jsdom
/**
 * **Closing the New session panel must stop the microphone.**
 *
 * One test, one bug, and the bug is the reason this file exists rather than a
 * few lines inside another.
 *
 * `NewSessionPanel` renders its box and its Stop control behind `open`. Closing
 * the panel therefore **unmounts nothing** — the component and its dictation
 * hook stay mounted, so `useDictation`'s cleanup never runs, and a dictation
 * started before Close carries on recording behind a panel with no way to reach
 * it. The toggle is inside the branch that just disappeared.
 *
 * The product hit this exact shape in its Feedback dialog and
 * docs/project/dictation.md names it: *"if the box lives in a component that
 * stays mounted when it disappears — a dialog whose parent renders it open or
 * shut — closing it unmounts nothing, so `useDictation`'s cleanup never runs and
 * the microphone keeps recording behind a shut dialog."* This was written by
 * somebody who had read that sentence and not applied it; **GPT Sol found it as
 * the P1 of its review**, 2026-09-08.
 *
 * The hook is a fixture, deliberately. Nothing here opens a microphone — the
 * subject is whether the panel *asks* it to stop, and the state machine has its
 * own tests.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UseDictation } from "../src/web/useDictation.js";

/** One mutable object the test poses, and the toggles it records. */
const state = { armed: false, toggles: 0 };

vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (): UseDictation =>
    ({
      supported: true,
      phase: state.armed ? "listening" : "idle",
      armed: state.armed,
      transcribing: false,
      liveText: true,
      interim: "",
      level: { current: 0 },
      meter: "none",
      quiet: false,
      /* What the panel must call. It does NOT flip `armed` — the real hook does
         that asynchronously, and a fixture that did it here would make the test
         pass on the strength of its own bookkeeping. */
      toggle: () => {
        state.toggles += 1;
      },
      error: null,
      startedAt: state.armed ? 1_000 : null,
      deviceLabel: null,
      deviceId: null,
      deviceUnavailable: false,
      chooseDevice: () => {},
      recording: null,
      clearRecording: () => {},
      canRetry: false,
      retry: () => {},
    }) as UseDictation,
}));

const { NewSessionPanel } = await import("../tools/fleet/web/src/NewSessionPanel");

/** A launcher that never launches; this file is not about starting agents. */
const api = {
  start: async () => ({ accepted: false as const, why: "not in this test" }),
  feed: async () => ({ busy: false, launches: [] }),
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  state.armed = false;
  state.toggles = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(): void {
  act(() => {
    root.render(<NewSessionPanel api={api as never} />);
  });
}

/** Press the button whose label starts with the given text. */
function press(label: string): void {
  const button = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").startsWith(label));
  if (!button) throw new Error(`no button labelled ${label}; saw: ${[...host.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("the New session panel's microphone", () => {
  it("is asked to stop when the panel is closed", () => {
    render();
    press("New session");
    /* Armed, as though somebody had pressed Dictate and started talking. */
    act(() => {
      state.armed = true;
    });
    render();
    expect(state.toggles).toBe(0);

    press("Close");
    /* **The assertion.** Without the effect on `open`, this is 0 and the
       microphone is still recording behind a panel with no Stop button. */
    expect(state.toggles).toBe(1);
  });

  it("does not touch a microphone that was never on", () => {
    /* A stop for a dictation that is not running would claim and release the
       page's one microphone for nothing, and `mic-lock.ts` is what arbitrates
       that between boxes. */
    render();
    press("New session");
    press("Close");
    expect(state.toggles).toBe(0);
  });
});
