// @vitest-environment jsdom
/**
 * **`useAudioLevel` — the loop that has to actually run.**
 *
 * The level meter's whole job is to be believed, so the failure that matters is
 * the quiet one: bars that sit at rest while the microphone works perfectly.
 * That happened for real during the build on 2026-08-27 — everything was wired
 * correctly and the meter read a flat zero, because the decibel floor had been
 * *reasoned about* rather than measured and a real quiet room turned out to sit
 * below it. Nothing failed. Nothing logged. It simply looked broken.
 *
 * A browser pass caught that one, and a browser pass will not always be
 * available: driving it needs a live microphone, a live extension connection,
 * and somebody willing to talk. So the lifecycle is pinned here instead, with a
 * fake audio graph — jsdom has no `AudioContext`, no `MediaStreamTrack` and no
 * `requestAnimationFrame` worth the name, which turns out to be an advantage,
 * because a fake analyser can be told exactly what the room sounds like.
 *
 * What this file is checking, all of it from GPT Sol's review of the plan
 * (2026-08-27, items 4, 5 and 13):
 *
 * 1. The frame loop runs and the level ref is actually written.
 * 2. A **suspended context** is not read as silence. `AnalyserNode` on a
 *    suspended context returns its last buffer for ever, which is a flat line
 *    that looks exactly like a dead microphone.
 * 3. An **ended or muted track** is not read as silence either.
 * 4. Teardown disconnects both nodes and — the one that would break dictation —
 *    **does not stop the track**, which belongs to `useDictation`.
 * 5. The quiet observation needs ten seconds of genuine quiet, and a hidden tab
 *    coming back does not count as any of them.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAudioLevel } from "../src/web/useAudioLevel.js";

/* ---------------------------------------------------------- the fake room -- */

/** What the analyser will report, as an RMS. Set by each test. */
let roomRms = 0;
let disconnects: string[] = [];

function fakeAnalyser() {
  return {
    fftSize: 2048,
    getFloatTimeDomainData(buf: Float32Array) {
      // A DC offset of `roomRms` has exactly that RMS, which keeps the fixture
      // about the level under test rather than about waveform shapes.
      buf.fill(roomRms);
    },
    disconnect: () => disconnects.push("analyser"),
  };
}

function fakeCtx(state: AudioContextState = "running") {
  return {
    state,
    createMediaStreamSource: () => ({
      connect: () => {},
      disconnect: () => disconnects.push("source"),
    }),
    createAnalyser: fakeAnalyser,
  } as unknown as AudioContext;
}

let trackStopped = false;
function fakeTrack(over: { readyState?: string; muted?: boolean } = {}) {
  trackStopped = false;
  return {
    readyState: over.readyState ?? "live",
    muted: over.muted ?? false,
    stop: () => {
      trackStopped = true;
    },
  } as unknown as MediaStreamTrack;
}

/* jsdom has no rAF worth using and none that fake timers can drive, so frames
   are delivered by hand. `frame(n)` is n frames at roughly 60Hz. */
let pending = new Map<number, FrameRequestCallback>();
let nextHandle = 1;
let clock = 0;

function frames(count: number, msEach = 16) {
  for (let i = 0; i < count; i++) {
    const due = [...pending.entries()];
    pending = new Map();
    clock += msEach;
    act(() => {
      for (const [, fn] of due) fn(clock);
    });
  }
}

function drive(track: MediaStreamTrack | null, ctx: AudioContext | null) {
  let latest: ReturnType<typeof useAudioLevel> | null = null;
  function Probe(): ReactNode {
    latest = useAudioLevel(track, ctx);
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: Root;
  act(() => {
    root = createRoot(host);
    root.render(createElement(Probe));
  });
  return {
    state: () => {
      if (!latest) throw new Error("the hook never rendered");
      return latest;
    },
    stop: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  roomRms = 0;
  clock = 0;
  pending = new Map();
  nextHandle = 1;
  disconnects = [];
  /* A real queue with a real `cancelAnimationFrame`. A no-op cancel cannot
     prove teardown: the loop would look cancelled because nothing pumped it,
     which is the same reading a leak gives. GPT Sol's code review, item 10. */
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    const handle = nextHandle++;
    pending.set(handle, fn);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    pending.delete(handle);
  });
  vi.stubGlobal("performance", { now: () => clock });
  vi.stubGlobal("MediaStream", class {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("while the microphone is open", () => {
  it("writes a level that follows the room", () => {
    /* The regression test for the build's own bug. It is not enough that the
       hook reports `measuring`: the number has to move. */
    roomRms = 0.05; // ordinary speech, about −26 dBFS
    const { state, stop } = drive(fakeTrack(), fakeCtx());
    expect(state().measuring).toBe(true);
    expect(state().level.current).toBe(0);
    frames(2);
    expect(state().level.current).toBeGreaterThan(0.5);
    stop();
  });

  it("keeps a quiet room visibly off the floor", () => {
    // Measured room tone in the study this was built in. It must not read zero;
    // a flat meter in a working room is the whole failure being guarded against.
    roomRms = 0.0005;
    const { state, stop } = drive(fakeTrack(), fakeCtx());
    frames(2);
    expect(state().level.current).toBeGreaterThan(0.02);
    stop();
  });

  it("falls gently rather than dropping out between syllables", () => {
    roomRms = 0.2;
    const { state, stop } = drive(fakeTrack(), fakeCtx());
    frames(2);
    const loud = state().level.current;
    roomRms = 0;
    frames(1);
    const after = state().level.current;
    expect(after).toBeLessThan(loud);
    expect(after).toBeGreaterThan(loud * 0.5);
    stop();
  });
});

describe("what must not be mistaken for silence", () => {
  it("does not measure a suspended context", () => {
    /* A suspended `AudioContext` hands back its last buffer for ever. Reading
       that as a measurement means reporting a flat line — indistinguishable
       from a dead microphone — with complete confidence. Sol's item 5. */
    const { state, stop } = drive(fakeTrack(), fakeCtx("suspended"));
    frames(3);
    expect(state().measuring).toBe(false);
    expect(state().quiet).toBe(false);
    stop();
  });

  it("does not measure an ended track", () => {
    const { state, stop } = drive(fakeTrack({ readyState: "ended" }), fakeCtx());
    frames(3);
    expect(state().measuring).toBe(false);
    stop();
  });

  it("does not measure a muted track", () => {
    roomRms = 0.05;
    const { state, stop } = drive(fakeTrack({ muted: true }), fakeCtx());
    frames(3);
    expect(state().measuring).toBe(false);
    expect(state().quiet).toBe(false);
    stop();
  });

  it("measures nothing at all without a track", () => {
    const { state, stop } = drive(null, fakeCtx());
    frames(3);
    expect(state().measuring).toBe(false);
    expect(state().level.current).toBe(0);
    stop();
  });
});

describe("the quiet observation", () => {
  it("does not appear before ten seconds", () => {
    const { state, stop } = drive(fakeTrack(), fakeCtx());
    frames(60, 100); // six seconds of silence
    expect(state().quiet).toBe(false);
    stop();
  });

  it("appears after ten seconds of genuine silence", () => {
    const { state, stop } = drive(fakeTrack(), fakeCtx());
    frames(130, 100); // thirteen seconds
    expect(state().quiet).toBe(true);
    stop();
  });

  it("is cleared the moment somebody speaks", () => {
    const { state, stop } = drive(fakeTrack(), fakeCtx());
    frames(130, 100);
    expect(state().quiet).toBe(true);
    roomRms = 0.05;
    frames(2, 100);
    expect(state().quiet).toBe(false);
    stop();
  });

  it("does not count time the document was hidden", () => {
    /* rAF does not run in a hidden tab, so the first frame after the reader
       comes back sees one enormous gap. Counting it would tell somebody who
       switched tabs for a minute that their microphone had gone quiet — which
       is true and useless, and reads as a fault report. Sol's item 5. */
    const { state, stop } = drive(fakeTrack(), fakeCtx());
    frames(20, 100); // two seconds, nothing said
    frames(1, 60_000); // a minute away from the tab, delivered as one frame
    frames(20, 100); // two more seconds
    expect(state().quiet).toBe(false);
    stop();
  });
});

describe("teardown", () => {
  it("disconnects both nodes, so a stop/start cycle does not leak into the shared context", () => {
    const { stop } = drive(fakeTrack(), fakeCtx());
    frames(2);
    stop();
    expect(disconnects).toContain("source");
    expect(disconnects).toContain("analyser");
  });

  it("does NOT stop the track, which belongs to useDictation", () => {
    /* The one that would break dictation outright rather than merely the meter:
       the track is shared with the recogniser, and stopping somebody else's
       track takes their microphone away mid-sentence. */
    const track = fakeTrack();
    const { stop } = drive(track, fakeCtx());
    frames(2);
    stop();
    expect(trackStopped).toBe(false);
  });

  it("actually stops the loop, rather than merely stopping being pumped", () => {
    roomRms = 0.2;
    const { stop } = drive(fakeTrack(), fakeCtx());
    frames(2);
    expect(pending.size).toBeGreaterThan(0);
    stop();
    expect(pending.size).toBe(0);
  });

  it("leaves the level at rest", () => {
    roomRms = 0.2;
    const { state, stop } = drive(fakeTrack(), fakeCtx());
    frames(2);
    const ref = state().level;
    stop();
    expect(ref.current).toBe(0);
  });
});
