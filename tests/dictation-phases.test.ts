// @vitest-environment jsdom
/**
 * **`useDictation` — the three phases, and the promise that stopping saves.**
 *
 * This is the regression test for what Greg reported on 2026-08-27: he pressed
 * the microphone and *"nothing seemed to happen"*. Nothing was broken. The
 * device does not open until about **1.1 seconds** after the press, and the old
 * hook set `listening` on the line straight after `r.start()` — so the button
 * claimed to be listening a full second before it could hear anything, and
 * whatever was said into that second was gone without a sign.
 *
 * So the property under test is that **the phase tracks the microphone rather
 * than the intention**: armed and deaf is a state with a name, and it is not
 * the same state as armed and hearing. docs/plans/microphone-level-meter.md.
 *
 * The rest of the file is the other half of the same bug — the ways a dictation
 * can end that nobody had accounted for. `onEnd` has to fire on all of them,
 * because `ProfileBox` commits from it: before this, a `network` error left
 * confirmed words sitting in a box the reader believed had taken them.
 *
 * ## Two paths through `beginCapture`
 *
 * A recogniser whose prototype has `processLocally` is a recent Chromium and
 * *might* accept `start(audioTrack)`, so we open a track and share it. Anything
 * else — Safari — opens no stream at all, because WebKit allows one microphone
 * source at a time and a second capture can kill the recogniser's. Both paths
 * are driven here; the fixture picks between them by whether the fake's
 * prototype carries the property.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDictation } from "../src/web/useDictation.js";

/* ------------------------------------------------------------- the fakes -- */

/** Every recogniser the hook has constructed, newest last. */
let built: FakeRecognition[] = [];
let gumCalls = 0;
let gumRejects = false;
let tracksStopped = 0;
/** `ended` handlers the hook installed on the track it opened. */
let endedListeners: Array<() => void> = [];

class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  started: unknown[] = [];
  aborted = 0;
  stopped = 0;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onsoundstart: (() => void) | null = null;
  onsoundend: (() => void) | null = null;
  constructor() {
    built.push(this);
  }
  /** Overridden per shape: the whole feature detect turns on this behaviour. */
  start(track?: unknown) {
    this.started.push(track ?? null);
  }
  stop() {
    this.stopped++;
  }
  abort() {
    this.aborted++;
  }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}

function trackLike(t: unknown): boolean {
  return typeof t === "object" && t !== null && "readyState" in t && "stop" in t;
}

/**
 * The Chromium shape: `start` **type-checks its argument**, exactly as Chrome
 * 151 does (`parameter 1 is not of type 'MediaStreamTrack'`). That type check is
 * the entire capability probe, so a fake that merely accepts anything would be
 * modelling Safari while claiming to be Chrome.
 */
class ChromiumRecognition extends FakeRecognition {
  override start(track?: unknown) {
    if (track !== undefined && !trackLike(track)) {
      throw new TypeError("parameter 1 is not of type 'MediaStreamTrack'.");
    }
    this.started.push(track ?? null);
  }
}

/**
 * The Safari shape: no overload, so the extra argument is **silently ignored**
 * and the recogniser starts on its own capture. This is the case that makes a
 * guess-based feature detect dangerous — it does not fail, it succeeds wrongly.
 */
class SafariRecognition extends FakeRecognition {
  override start(_track?: unknown) {
    this.started.push(null);
  }
}

function fakeTrack() {
  return {
    readyState: "live",
    muted: false,
    addEventListener: (name: string, fn: () => void) => {
      if (name === "ended") endedListeners.push(fn);
    },
    removeEventListener: () => {},
    stop: () => {
      tracksStopped++;
    },
  } as unknown as MediaStreamTrack;
}

function install(Ctor: typeof FakeRecognition) {
  vi.stubGlobal("SpeechRecognition", Ctor);
  vi.stubGlobal("webkitSpeechRecognition", Ctor);
  vi.stubGlobal("MediaStream", class {});
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      resume = async () => {};
      suspend = async () => {};
      createMediaStreamSource = () => ({ connect: () => {}, disconnect: () => {} });
      createAnalyser = () => ({
        fftSize: 2048,
        getFloatTimeDomainData: () => {},
        disconnect: () => {},
      });
    },
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => {
        gumCalls++;
        if (gumRejects) throw new DOMException("denied", "NotAllowedError");
        return { getAudioTracks: () => [fakeTrack()], getTracks: () => [fakeTrack()] };
      },
    },
  });
}

/** Swap in the Safari shape mid-test, keeping the frame stubs. */
function useSafari() {
  built = [];
  vi.unstubAllGlobals();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  install(SafariRecognition);
}

/** The recogniser currently under test — the last one the hook built. */
function latest(): FakeRecognition {
  const r = built.at(-1);
  if (!r) throw new Error("the hook never built a recogniser");
  return r;
}

/** `beginCapture` is async; let its microtasks land. */
async function settleCapture() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function drive() {
  const text: string[] = [];
  const ends: number[] = [];
  let state: ReturnType<typeof useDictation> | null = null;
  function Probe(): ReactNode {
    state = useDictation(
      (t) => text.push(t),
      () => ends.push(1),
    );
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
    text,
    ends,
    get: () => {
      if (!state) throw new Error("the hook never rendered");
      return state;
    },
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  built = [];
  gumCalls = 0;
  gumRejects = false;
  tracksStopped = 0;
  endedListeners = [];
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  install(ChromiumRecognition);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("the three phases", () => {
  it("starts idle", () => {
    const h = drive();
    expect(h.get().phase).toBe("idle");
    expect(h.get().armed).toBe(false);
    h.unmount();
  });

  it("is `opening`, not `listening`, until the device actually opens", async () => {
    /* The bug, exactly. The old hook went to its listening state on the line
       after `r.start()` — a measured 1.1 seconds before `audiostart`. */
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    expect(h.get().phase).toBe("opening");
    expect(h.get().armed).toBe(true);
    h.unmount();
  });

  it("becomes `listening` on audiostart", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    expect(h.get().phase).toBe("listening");
    h.unmount();
  });

  it("drops back to `opening` when Safari restarts it mid-session", async () => {
    // Between `onend` and the next `audiostart` the microphone genuinely is
    // deaf again, so claiming otherwise would be the original bug returning by
    // a side door.
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    expect(h.get().phase).toBe("listening");
    act(() => latest().onend?.());
    expect(h.get().phase).toBe("opening");
    expect(h.get().armed).toBe(true);
    h.unmount();
  });

  it("stays armed across that restart rather than needing another press", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    const r = latest();
    const startsBefore = r.started.length;
    act(() => r.onend?.());
    expect(r.started.length).toBe(startsBefore + 1);
    h.unmount();
  });
});

describe("one microphone, shared or not at all", () => {
  it("opens a track and hands it to the recogniser on Chromium", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    expect(gumCalls).toBe(1);
    expect(latest().started[0]).not.toBeNull();
    h.unmount();
  });

  it("opens NO stream at all on Safari", async () => {
    /* WebKit supports one microphone source at a time, so a second capture can
       kill the recogniser's or switch the routing under it. The meter gives up
       its numbers rather than risk that. */
    useSafari();
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    expect(gumCalls).toBe(0);
    expect(latest().started).toEqual([null]);
    expect(h.get().meter).toBe("detected");
    h.unmount();
  });

  it("keeps dictating when the microphone we wanted for the meter is refused", async () => {
    /* A meter that cannot get samples must never be the thing that stops
       dictation. The recogniser opens its own device and carries on; the bars
       fall back to its sound events. GPT Sol's review, item 11. */
    gumRejects = true;
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    expect(h.get().armed).toBe(true);
    expect(h.get().error).toBeNull();
    expect(latest().started).toEqual([null]);
    h.unmount();
  });
});

describe("the meter's source", () => {
  it("is nothing at all while idle", () => {
    const h = drive();
    expect(h.get().meter).toBe("none");
    h.unmount();
  });

  it("is a real RMS wherever the track can be shared", async () => {
    // Chromium: one track, handed to both, so the bars are the actual audio
    // being transcribed rather than a second opinion about the room.
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    expect(h.get().meter).toBe("measured");
    h.unmount();
  });

  it("falls back to the recogniser's own sound events where it cannot", async () => {
    useSafari();
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    expect(h.get().meter).toBe("detected");
    h.unmount();
  });

  it("moves the fallback level on soundstart and back on soundend", async () => {
    /* Binary, but real: `soundstart` is the recogniser reporting what it heard
       on the audio it is actually transcribing. Nothing here is invented, which
       is the property that makes showing it in the same bars defensible. */
    useSafari();
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onsoundstart?.());
    expect(h.get().level.current).toBe(1);
    act(() => latest().onsoundend?.());
    expect(h.get().level.current).toBe(0);
    h.unmount();
  });
});

describe("ending, and the promise that it saves", () => {
  it("puts the button back the instant stop is pressed", async () => {
    // The reader's press must be acknowledged now, not whenever the recogniser
    // gets round to ending — even though the ending itself waits for `onend`.
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => h.get().toggle());
    expect(h.get().phase).toBe("idle");
    h.unmount();
  });

  it("waits for the last result before committing, then fires onEnd once", async () => {
    /* The bug this ordering exists for: `stop()` used to commit and *then* call
       `r.stop()`, which delivers one final result — so the last phrase of every
       dictation landed after the only save. GPT Sol's code review, item 1. */
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    const r = latest();
    act(() => h.get().toggle());
    expect(h.ends).toHaveLength(0); // nothing committed yet
    act(() =>
      r.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: "the last thing I said" } }],
      }),
    );
    expect(h.text).toContain("the last thing I said");
    act(() => r.onend?.());
    expect(h.ends).toHaveLength(1);
    expect(h.text).toContain("the last thing I said");
    h.unmount();
  });

  it("fires onEnd only once even if onend arrives twice", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    const r = latest();
    act(() => h.get().toggle());
    act(() => r.onend?.());
    act(() => r.onend?.());
    expect(h.ends).toHaveLength(1);
    h.unmount();
  });

  it("commits anyway if stop() throws and there will be no onend", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    const r = latest();
    r.stop = () => {
      throw new Error("gone");
    };
    act(() => h.get().toggle());
    expect(h.ends).toHaveLength(1);
    h.unmount();
  });

  it("fires onEnd on a `network` error, which is the case that used to lose text", async () => {
    /* Before this, dictated words were committed by the stop button and by
       nothing else. An error ended the session with the confirmed text sitting
       unsaved in a box the reader believed had taken it. */
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onerror?.({ error: "network" }));
    expect(h.ends).toHaveLength(1);
    expect(h.get().phase).toBe("idle");
    expect(h.get().error).toMatch(/connection/i);
    h.unmount();
  });

  it("does not fire onEnd on `no-speech`, which is not an ending", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onerror?.({ error: "no-speech" }));
    expect(h.ends).toHaveLength(0);
    expect(h.get().armed).toBe(true);
    expect(h.get().error).toBeNull();
    h.unmount();
  });

  it("reports an `aborted` nobody asked for", async () => {
    // Ours are swallowed by the identity check; this one arrives while the
    // reader still has the button armed, so it is a real termination.
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onerror?.({ error: "aborted" }));
    expect(h.get().phase).toBe("idle");
    expect(h.get().error).not.toBeNull();
    h.ends.length = 0;
    h.unmount();
  });

  it("says nothing about the `aborted` our own stop provokes", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    const r = latest();
    act(() => h.get().toggle()); // marks the session stop-requested
    act(() => r.onerror?.({ error: "aborted" }));
    act(() => r.onend?.());
    expect(h.get().error).toBeNull();
    expect(h.ends).toHaveLength(1);
    h.unmount();
  });

  it("will not let a dead session's error tear down the one that replaced it", async () => {
    /* A queued error from a recogniser the reader has already moved on from
       used to pass the identity check and terminate its successor. It must now
       end its own session silently and leave the live one alone.
       GPT Sol's code review, item 2. */
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    const first = latest();
    act(() => h.get().toggle());
    act(() => first.onend?.());
    h.ends.length = 0;
    act(() => h.get().toggle()); // a fresh session
    await settleCapture();
    expect(built).toHaveLength(2);
    act(() => first.onerror?.({ error: "network" }));
    expect(h.get().armed).toBe(true);
    expect(h.get().error).toBeNull();
    expect(h.ends).toHaveLength(0);
    h.unmount();
  });

  it("stops the track it owns, so the recording indicator goes out", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    const before = tracksStopped;
    act(() => h.get().toggle());
    act(() => latest().onend?.());
    expect(tracksStopped).toBeGreaterThan(before);
    h.unmount();
  });

  it("ends the session when the microphone is unplugged under it", async () => {
    /* An externally ended track otherwise leaves a meter measuring nothing and
       a button claiming to listen. GPT Sol's code review, item 6. */
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => {
      for (const fn of endedListeners) fn();
    });
    expect(h.get().phase).toBe("idle");
    expect(h.get().error).toMatch(/disconnected/i);
    expect(h.ends).toHaveLength(1);
    h.unmount();
  });

  it("aborts and releases the microphone when the page goes away mid-dictation", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    const r = latest();
    const before = tracksStopped;
    h.unmount();
    expect(r.aborted).toBe(1);
    expect(tracksStopped).toBeGreaterThan(before);
  });
});

describe("what reaches the textarea", () => {
  it("hands over confirmed phrases and keeps guesses out of them", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() =>
      latest().onresult?.({
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: "the evidence" } },
          { isFinal: false, 0: { transcript: "not the his" } },
        ],
      }),
    );
    expect(h.text).toEqual(["the evidence"]);
    expect(h.get().interim).toBe("not the his");
    h.unmount();
  });
});
