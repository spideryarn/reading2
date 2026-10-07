// @vitest-environment jsdom
/**
 * **A dictation that is about to be stopped says so first.**
 *
 * Feedback report spya-n8cuqq (SPIDERYARN-READING2-E8), Greg, 2026-10-06: *"it
 * cut me off after five minutes. I mean, the first thing is, if you're ever
 * going to cut me off like that, you should give me some kind of feedback of
 * some kind."* There was a sentence, twelve pixels high, shown after the
 * microphone had already stopped; somebody thinking aloud is not looking at
 * the box. Plan docs/plans/261007b-dictation-says-when-it-is-about-to-stop-and-runs-fifteen-minutes.md.
 *
 * Pinned here:
 *
 * 1. In the last minute the strip wears a warning and counts down; before that
 *    it looks ordinary.
 * 2. The screen reader is told once, not once a second.
 * 3. A chime plays when the last minute starts, once per dictation.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DictationStrip } from "../src/web/DictationStrip.js";
import { CAP_WARNING_MS, MAX_MS } from "../src/web/mic-recording.js";
import { useLastMinuteChime } from "../src/web/quiet-chime.js";
import type { UseDictation } from "../src/web/useDictation.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date("2026-10-07T10:00:00Z").getTime();

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

/** A listening dictation with `left` milliseconds before it is stopped. */
function listening(left: number | null): UseDictation {
  return {
    supported: true,
    phase: "listening",
    armed: true,
    transcribing: false,
    liveText: true,
    interim: "",
    level: { current: 0 },
    meter: "measured",
    quiet: false,
    toggle: () => {},
    error: null,
    startedAt: left === null ? NOW : NOW + left - MAX_MS,
    endsAt: left === null ? null : NOW + left,
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

describe("the cap, and the minute before it", () => {
  it("is fifteen minutes, with a minute's warning", () => {
    expect(MAX_MS).toBe(15 * 60_000);
    expect(CAP_WARNING_MS).toBe(60_000);
  });

  it("looks ordinary until the last minute", () => {
    act(() => root.render(createElement(DictationStrip, { dictation: listening(5 * 60_000) })));
    const line = host.querySelector(".prof-listening");
    expect(line?.classList.contains("ending")).toBe(false);
    expect(line?.textContent).toContain("Listening");
    expect(line?.textContent).not.toContain("stops in");
  });

  it("warns and counts down in the last minute", () => {
    act(() => root.render(createElement(DictationStrip, { dictation: listening(45_000) })));
    const line = host.querySelector(".prof-listening");
    expect(line?.classList.contains("ending"), "the last minute looks like any other").toBe(true);
    expect(line?.querySelector(".prof-quiet-icon"), "no warning glyph").not.toBeNull();
    expect(line?.textContent).toContain("Dictation stops in 0:45");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(host.querySelector(".prof-listening")?.textContent).toContain("Dictation stops in 0:40");
  });

  it("starts warning by itself when the last minute arrives", () => {
    act(() => root.render(createElement(DictationStrip, { dictation: listening(62_000) })));
    expect(host.querySelector(".prof-listening")?.classList.contains("ending")).toBe(false);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(host.querySelector(".prof-listening")?.classList.contains("ending")).toBe(true);
  });

  it("tells a screen reader once, not once a second", () => {
    act(() => root.render(createElement(DictationStrip, { dictation: listening(45_000) })));
    const said = () => host.querySelector('[role="status"]')?.textContent;
    const first = said();
    expect(first).toBe("Dictation stops within a minute");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(said()).toBe(first);
  });

  /* A tab back from hidden can draw before the late cap runs. 0:00 over a
     live microphone is not true. GPT Sol's code review, C4. */
  it("says it is stopping, not 0:00, at and past the deadline", () => {
    act(() => root.render(createElement(DictationStrip, { dictation: listening(0) })));
    expect(host.querySelector(".prof-listening")?.textContent).toContain("Stopping dictation…");
    expect(host.querySelector(".prof-listening")?.textContent).not.toContain("0:00");
    act(() => root.render(createElement(DictationStrip, { dictation: listening(-4000) })));
    expect(host.querySelector(".prof-listening")?.textContent).toContain("Stopping dictation…");
  });

  it("says nothing about a cap when no recording is running to be capped", () => {
    act(() => root.render(createElement(DictationStrip, { dictation: listening(null) })));
    expect(host.querySelector(".prof-listening")?.classList.contains("ending")).toBe(false);
  });

  it("does not let a quiet microphone hide the cap warning", () => {
    act(() =>
      root.render(createElement(DictationStrip, { dictation: { ...listening(45_000), quiet: true } })),
    );
    const line = host.querySelector(".prof-listening");
    expect(line?.textContent).toContain("Dictation stops in 0:45");
    expect(line?.classList.contains("ending")).toBe(true);
  });
});

/** An `AudioContext` that counts the notes asked of it. */
function fakeContext() {
  const notes: number[] = [];
  const param = () => ({ value: 0, setValueAtTime: () => {}, linearRampToValueAtTime: () => {} });
  const ctx = {
    state: "running",
    currentTime: 0,
    destination: {},
    createOscillator: () => ({
      type: "sine",
      frequency: param(),
      connect: () => {},
      start: () => {
        notes.push(1);
      },
      stop: () => {},
    }),
    createGain: () => ({ gain: param(), connect: () => {} }),
  };
  return { ctx: ctx as unknown as AudioContext, notes };
}

function chimeProbe(ctx: AudioContext | null, endsAt: number | null) {
  function Probe({ endsAt }: { endsAt: number | null }): ReactNode {
    useLastMinuteChime(endsAt, ctx);
    return null;
  }
  act(() => root.render(createElement(Probe, { endsAt })));
  return (next: number | null) => act(() => root.render(createElement(Probe, { endsAt: next })));
}

describe("the chime when the last minute starts", () => {
  it("plays when a minute is left, and not before", () => {
    const { ctx, notes } = fakeContext();
    chimeProbe(ctx, NOW + MAX_MS);
    act(() => {
      vi.advanceTimersByTime(MAX_MS - CAP_WARNING_MS - 1000);
    });
    expect(notes).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(notes.length).toBeGreaterThan(0);
  });

  it("plays once, however often the component draws", () => {
    const { ctx, notes } = fakeContext();
    const set = chimeProbe(ctx, NOW + MAX_MS);
    act(() => {
      vi.advanceTimersByTime(MAX_MS - CAP_WARNING_MS);
    });
    const once = notes.length;
    set(NOW + MAX_MS);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(notes).toHaveLength(once);
  });

  it("plays again for the next dictation", () => {
    const { ctx, notes } = fakeContext();
    const set = chimeProbe(ctx, NOW + MAX_MS);
    act(() => {
      vi.advanceTimersByTime(MAX_MS);
    });
    const once = notes.length;
    expect(once).toBeGreaterThan(0);
    set(null);
    set(Date.now() + MAX_MS);
    act(() => {
      vi.advanceTimersByTime(MAX_MS);
    });
    expect(notes).toHaveLength(once * 2);
  });

  it("does not play for a dictation that was stopped first", () => {
    const { ctx, notes } = fakeContext();
    const set = chimeProbe(ctx, NOW + MAX_MS);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    set(null);
    act(() => {
      vi.advanceTimersByTime(MAX_MS);
    });
    expect(notes).toHaveLength(0);
  });

  /* A throttled tab or a laptop that slept runs the timer late. "A minute
     left", said with ten seconds left or after the cap, is not true. GPT Sol's
     plan review, P5. */
  it("does not play late, when the timer fires with the minute mostly gone", () => {
    const { ctx, notes } = fakeContext();
    chimeProbe(ctx, NOW + MAX_MS);
    /* The clock jumps; no timer runs. Then the timer runs, far too late. */
    vi.setSystemTime(NOW + MAX_MS - 10_000);
    act(() => {
      vi.advanceTimersByTime(MAX_MS);
    });
    expect(notes).toHaveLength(0);
  });

  it("stays silent with no audio context, and does not throw", () => {
    chimeProbe(null, NOW + MAX_MS);
    act(() => {
      vi.advanceTimersByTime(MAX_MS);
    });
  });
});
