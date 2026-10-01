// @vitest-environment jsdom
/**
 * **A quiet microphone is worth noticing while it is still on.**
 *
 * Feedback report SPIDERYARN-READING2-7Z (spya-wu265m), Greg, 2026-10-01:
 * *"Warn me (both visually, and perhaps with a subtle auditory warning too)
 * while recording if it looks like this is a problem."* The observation already
 * existed — `quiet`, ten seconds under −55 dBFS — and said *"No sound detected
 * yet"* in the same faint grey as *"Listening"*, which is not a warning anybody
 * notices. Plan docs/plans/261001k-dictation-silent-mic-warning-and-a-message-that-goes.md.
 *
 * Two things are pinned here:
 *
 * 1. The strip wears the warning — a class and a glyph — only while `quiet`.
 * 2. The chime plays **once per dictation**, not once per stretch of quiet. The
 *    chime can be picked up by the microphone, which ends the quiet; a
 *    per-stretch rule would then chime again ten seconds later, for ever.
 *    GPT Sol's plan review, F3.
 */
import { act, createElement, StrictMode, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DictationStrip } from "../src/web/DictationStrip.js";
import { useQuietChime } from "../src/web/quiet-chime.js";
import type { UseDictation } from "../src/web/useDictation.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A listening dictation, as the strip sees it. Only what the strip reads. */
function listening(quiet: boolean): UseDictation {
  return {
    supported: true,
    phase: "listening",
    armed: true,
    transcribing: false,
    liveText: true,
    interim: "",
    level: { current: 0 },
    meter: "measured",
    quiet,
    toggle: () => {},
    error: null,
    startedAt: Date.now(),
    deviceLabel: "MacBook Pro Microphone (Built-in)",
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
  } satisfies UseDictation;
}

describe("the strip, while the microphone hears nothing", () => {
  it("says so as a warning, not in the faint grey of everything being fine", () => {
    act(() => root.render(createElement(DictationStrip, { dictation: listening(true) })));
    const line = host.querySelector(".prof-listening");
    expect(line?.textContent).toContain("No sound detected yet");
    expect(line?.classList.contains("quiet"), "the quiet line looks like the listening one").toBe(true);
    expect(line?.querySelector(".prof-quiet-icon"), "no warning glyph").not.toBeNull();
  });

  it("looks ordinary while sound is getting in", () => {
    act(() => root.render(createElement(DictationStrip, { dictation: listening(false) })));
    const line = host.querySelector(".prof-listening");
    expect(line?.classList.contains("quiet")).toBe(false);
    expect(line?.querySelector(".prof-quiet-icon")).toBeNull();
  });
});

/** An `AudioContext` that counts the notes asked of it. */
function fakeContext() {
  const notes: number[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime: () => {},
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  });
  const ctx = {
    state: "running",
    currentTime: 0,
    destination: {},
    createOscillator: () => {
      const o = {
        type: "sine",
        frequency: param(),
        connect: () => {},
        start: () => {
          notes.push(1);
        },
        stop: () => {},
      };
      return o;
    },
    createGain: () => ({ gain: param(), connect: () => {} }),
  };
  return { ctx: ctx as unknown as AudioContext, notes };
}

function chimeProbe(ctx: AudioContext | null) {
  let set: (quiet: boolean, session: number | null) => void = () => {};
  function Probe(): ReactNode {
    const [state, setState] = useStateish();
    set = setState;
    useQuietChime(state.quiet, state.session, ctx);
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return (quiet: boolean, session: number | null) => act(() => set(quiet, session));
}

/* A tiny state holder, so the probe re-renders with whatever the test hands it. */
function useStateish(): [
  { quiet: boolean; session: number | null },
  (quiet: boolean, session: number | null) => void,
] {
  const [s, setS] = useState<{ quiet: boolean; session: number | null }>({
    quiet: false,
    session: null,
  });
  return [s, (quiet, session) => setS({ quiet, session })];
}

describe("the chime", () => {
  it("plays when the quiet arrives, and only once in a dictation", () => {
    const { ctx, notes } = fakeContext();
    const set = chimeProbe(ctx);
    set(false, 1000);
    expect(notes).toHaveLength(0);
    set(true, 1000);
    const once = notes.length;
    expect(once, "no chime when the quiet arrived").toBeGreaterThan(0);
    /* Sound — perhaps the chime itself, heard by the microphone — and then
       quiet again. Not a second chime: that is the loop. */
    set(false, 1000);
    set(true, 1000);
    expect(notes).toHaveLength(once);
  });

  it("plays again in the next dictation", () => {
    const { ctx, notes } = fakeContext();
    const set = chimeProbe(ctx);
    set(true, 1000);
    const once = notes.length;
    set(false, null);
    set(false, 2000);
    set(true, 2000);
    expect(notes.length).toBe(once * 2);
  });

  it("stays silent, without throwing, where there is no audio context", () => {
    const set = chimeProbe(null);
    expect(() => set(true, 1000)).not.toThrow();
  });

  it("does not play with no dictation running", () => {
    const { ctx, notes } = fakeContext();
    const set = chimeProbe(ctx);
    set(true, null);
    expect(notes).toHaveLength(0);
  });

  it("plays only once when StrictMode repeats the effect", () => {
    const { ctx, notes } = fakeContext();
    function AlreadyQuiet(): ReactNode {
      useQuietChime(true, 1000, ctx);
      return null;
    }
    act(() => root.render(createElement(StrictMode, null, createElement(AlreadyQuiet))));
    /* Two oscillators are the two notes of one chime. A repeated effect would
       produce four. */
    expect(notes).toHaveLength(2);
  });
});
