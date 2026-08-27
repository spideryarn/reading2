// @vitest-environment jsdom
/**
 * **`useDictation` — the device it opened, the clock, and the audio it kept.**
 *
 * The round this tests began with Greg pressing the button a second time and
 * reporting the same nothing. Nothing was broken again: Chrome handed the page
 * "Microsoft Teams Audio Device (Virtual)", a conferencing loopback that emits
 * exactly `0.0`. The recogniser heard nothing because there was nothing, and
 * the meter drew a flat line because the line was flat — and no part of the
 * page said *which* microphone had produced that zero.
 * docs/plans/microphone-device-and-recording.md.
 *
 * So the properties here are mostly about **not claiming things**:
 *
 * - the timer's zero is `audiostart`, not the press, because the 1.1 seconds
 *   before the microphone opens are not seconds of recording;
 * - the recorder's zero is the same event, or the saved file is longer than the
 *   timer beside it says;
 * - a refused permission does not quietly become a start on a different device;
 * - audio is kept only when nothing came back, and released the instant it did.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDictation } from "../src/web/useDictation.js";

/* ------------------------------------------------------------- the fakes -- */

let built: FakeRecognition[] = [];
let recorders: FakeRecorder[] = [];
/** Every constraint `getUserMedia` was called with, in order. */
let gumWith: MediaStreamConstraints[] = [];
/** What the next `getUserMedia` should do; shift()ed per call. */
let gumPlan: Array<"ok" | "overconstrained" | "denied"> = [];
let tracksStopped = 0;
let nextLabel = "MacBook Pro Microphone (Built-in)";

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
  /** Chrome 151's shape: the argument is type-checked, which is the whole probe. */
  start(track?: unknown) {
    if (track !== undefined && !(typeof track === "object" && track !== null && "stop" in track)) {
      throw new TypeError("parameter 1 is not of type 'MediaStreamTrack'.");
    }
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

class FakeRecorder {
  static isTypeSupported(t: string) {
    return t.startsWith("audio/webm");
  }
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** The track was still live when we were told to stop. The whole ordering point. */
  trackLiveAtStop: boolean | null = null;
  constructor(private stream: { getAudioTracks(): Array<{ readyState: string }> }) {
    recorders.push(this);
  }
  start() {
    this.state = "recording";
  }
  /**
   * **`onstop` is deferred, because a real one is.**
   *
   * `MediaRecorder.stop()` flushes and then fires; firing synchronously made
   * every ordering assertion in this file pass whether the code was right or
   * wrong, because the whole window closed inside one microtask drain. The
   * measurement of whether the track was still live is taken *now*, which is
   * when the code under test asked for the stop.
   */
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.trackLiveAtStop = this.stream.getAudioTracks()[0]?.readyState === "live";
    setTimeout(() => this.onstop?.(), 0);
  }
  emit(bytes: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
}

function fakeTrack(label: string) {
  const t = {
    label,
    readyState: "live",
    muted: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    stop: () => {
      t.readyState = "ended";
      tracksStopped++;
    },
  };
  return t as unknown as MediaStreamTrack & { readyState: string };
}

function install() {
  vi.stubGlobal("SpeechRecognition", FakeRecognition);
  vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
  vi.stubGlobal(
    "MediaStream",
    class {
      constructor(private tracks: MediaStreamTrack[] = []) {}
      getAudioTracks() {
        return this.tracks;
      }
      getTracks() {
        return this.tracks;
      }
    },
  );
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      resume = async () => {};
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
      getUserMedia: async (c: MediaStreamConstraints) => {
        gumWith.push(c);
        const plan = gumPlan.shift() ?? "ok";
        if (plan === "overconstrained")
          throw new DOMException("no such device", "OverconstrainedError");
        if (plan === "denied") throw new DOMException("denied", "NotAllowedError");
        const track = fakeTrack(nextLabel);
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
}

function latest(): FakeRecognition {
  const r = built.at(-1);
  if (!r) throw new Error("the hook never built a recogniser");
  return r;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
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

/** Press, let the capture land, and report that the microphone opened. */
async function pressAndOpen(h: ReturnType<typeof drive>) {
  act(() => h.get().toggle());
  await settle();
  await act(async () => {
    latest().onaudiostart?.();
  });
}

function saidFinal(r: FakeRecognition, transcript: string) {
  r.onresult?.({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript } }],
  });
}

beforeEach(() => {
  built = [];
  recorders = [];
  gumWith = [];
  gumPlan = [];
  tracksStopped = 0;
  nextLabel = "MacBook Pro Microphone (Built-in)";
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  install();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-27T14:32:00"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/* ------------------------------------------------------------- the clock -- */

describe("the timer's zero", () => {
  it("is not the press", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settle();
    expect(h.get().phase).toBe("opening");
    expect(h.get().startedAt).toBeNull();
    h.unmount();
  });

  it("is `audiostart`, the moment there is actually audio", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settle();
    vi.setSystemTime(new Date("2026-08-27T14:32:01"));
    await act(async () => {
      latest().onaudiostart?.();
    });
    expect(h.get().startedAt).toBe(new Date("2026-08-27T14:32:01").getTime());
    h.unmount();
  });

  /* Safari ends the session on a pause and the hook restarts it. That is still
     one dictation, and a clock that reset there would tell somebody two minutes
     in that they had been talking for two seconds. */
  it("survives a mid-session restart rather than starting again", async () => {
    const h = drive();
    await pressAndOpen(h);
    const first = h.get().startedAt;
    await act(async () => {
      latest().onend?.();
    });
    vi.setSystemTime(new Date("2026-08-27T14:33:30"));
    await act(async () => {
      latest().onaudiostart?.();
    });
    expect(h.get().startedAt).toBe(first);
    h.unmount();
  });

  it("is cleared when the dictation ends", async () => {
    const h = drive();
    await pressAndOpen(h);
    act(() => h.get().toggle());
    await act(async () => {
      latest().onend?.();
    });
    expect(h.get().startedAt).toBeNull();
    h.unmount();
  });
});

/* ------------------------------------------------------------ the device -- */

describe("which microphone it opens", () => {
  it("asks for anything at all when nothing has been chosen", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settle();
    expect(gumWith).toEqual([{ audio: true }]);
    h.unmount();
  });

  it("reports the name of what it actually opened", async () => {
    nextLabel = "Microsoft Teams Audio Device (Virtual)";
    const h = drive();
    await pressAndOpen(h);
    expect(h.get().deviceLabel).toBe("Microsoft Teams Audio Device (Virtual)");
    h.unmount();
  });

  it("asks for a remembered device by name on the next press", async () => {
    const h = drive();
    act(() => h.get().chooseDevice("abc123"));
    await settle();
    act(() => h.get().toggle());
    await settle();
    expect(gumWith.at(-1)).toEqual({ audio: { deviceId: { exact: "abc123" } } });
    h.unmount();
  });

  /* The remembered headset has been unplugged. `exact` rejects rather than
     silently substituting — which is what we want — and this is the one case
     that then asks plainly instead of leaving the reader with no microphone. */
  it("falls back to the default when the remembered device is gone", async () => {
    const h = drive();
    act(() => h.get().chooseDevice("gone"));
    await settle();
    gumPlan = ["overconstrained"];
    act(() => h.get().toggle());
    await settle();
    expect(gumWith).toEqual([
      { audio: { deviceId: { exact: "gone" } } },
      { audio: true },
    ]);
    h.unmount();
  });

  /**
   * The one that matters. A refused permission used to fall through the same
   * branch and start the recogniser on the browser's default device, with
   * nothing on screen saying a different microphone was in use — the exact
   * silent substitution this whole round is about. GPT Sol's review, item 3.
   */
  it("does NOT quietly try another device when permission was refused", async () => {
    const h = drive();
    act(() => h.get().chooseDevice("abc123"));
    await settle();
    gumPlan = ["denied"];
    act(() => h.get().toggle());
    await settle();
    expect(gumWith).toEqual([{ audio: { deviceId: { exact: "abc123" } } }]);
    // And it claims no device, because it opened none.
    expect(h.get().deviceLabel).toBeNull();
    h.unmount();
  });

  /**
   * The recogniser still starts after a refusal — a meter that cannot get
   * samples must never be the thing that stops dictation, and its own `start()`
   * is what produces a real error code and real copy. But it may be listening
   * to a *different* microphone from the one the reader picked, and there is no
   * way from here to find out which. So it says so.
   *
   * Sol's code review (item 2) was right that the previous test proved only
   * that no second `getUserMedia` happened, which is a much weaker claim than
   * the one the comments were making.
   */
  it("starts recognition anyway after a refusal, and says the choice was not honoured", async () => {
    const h = drive();
    act(() => h.get().chooseDevice("abc123"));
    await settle();
    gumPlan = ["denied"];
    act(() => h.get().toggle());
    await settle();
    expect(latest().started).toEqual([null]);
    expect(h.get().deviceUnavailable).toBe(true);
    h.unmount();
  });

  it("says nothing about availability when no device was ever chosen", async () => {
    const h = drive();
    await pressAndOpen(h);
    expect(h.get().deviceUnavailable).toBe(false);
    h.unmount();
  });

  it("says the choice was not honoured when it had to fall back", async () => {
    const h = drive();
    act(() => h.get().chooseDevice("gone"));
    await settle();
    gumPlan = ["overconstrained"];
    await pressAndOpen(h);
    expect(h.get().deviceUnavailable).toBe(true);
    // ...while still naming whatever it actually opened.
    expect(h.get().deviceLabel).toBe("MacBook Pro Microphone (Built-in)");
    h.unmount();
  });

  it("restarts on the new device when one is chosen mid-dictation", async () => {
    const h = drive();
    await pressAndOpen(h);
    const before = built.length;
    act(() => h.get().chooseDevice("other"));
    await settle();
    expect(built.length).toBe(before + 1);
    expect(gumWith.at(-1)).toEqual({ audio: { deviceId: { exact: "other" } } });
    expect(h.get().phase).not.toBe("idle");
    /* **The old microphone is released before the new one is asked for.** A
       device change that waited on a recording nobody is going to keep would
       hold two captures open at once, which is the invariant the whole
       one-track design exists to protect. */
    expect(tracksStopped).toBe(1);
    h.unmount();
  });
});

/* --------------------------------------------------------- the recording -- */

describe("the audio it keeps", () => {
  /* The recorder's zero has to be the timer's zero. `getUserMedia` hands back a
     track that is already live a measured 1.1 seconds before `audiostart`, so a
     recorder started on arrival captures a second the timer says does not
     exist. GPT Sol's review, item 4. */
  it("does not start recording until the microphone is actually open", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settle();
    expect(recorders).toHaveLength(0);
    await act(async () => {
      latest().onaudiostart?.();
    });
    expect(recorders).toHaveLength(1);
    h.unmount();
  });

  it("offers the audio back when the dictation transcribed nothing", async () => {
    const h = drive();
    await pressAndOpen(h);
    recorders[0]?.emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    act(() => h.get().toggle());
    await act(async () => {
      latest().onend?.();
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(h.get().recording?.blob.size).toBe(4096);
    expect(h.get().recording?.ext).toBe("webm");
    h.unmount();
  });

  /* One predicate, decided at the end. A dictation that produced words and then
     failed keeps no audio: the reader already has what they said. */
  it("keeps nothing when words came back, even if it then ended badly", async () => {
    const h = drive();
    await pressAndOpen(h);
    recorders[0]?.emit(4096);
    act(() => {
      saidFinal(latest(), "the evidence");
    });
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    await act(async () => {
      latest().onerror?.({ error: "network" });
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(h.text).toEqual(["the evidence"]);
    expect(h.get().recording).toBeNull();
    h.unmount();
  });

  /**
   * The ordering GPT Sol's review (item 1) was about. Stopping the track under
   * a live recorder loses the final `dataavailable`, which is the tail of the
   * file — the part somebody listening back is most likely to want.
   */
  it("stops the recorder while the track is still live, not after killing it", async () => {
    const h = drive();
    await pressAndOpen(h);
    recorders[0]?.emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    act(() => h.get().toggle());
    await act(async () => {
      latest().onend?.();
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(recorders[0]?.trackLiveAtStop).toBe(true);
    expect(tracksStopped).toBe(1);
    h.unmount();
  });

  it("throws the last one away when a new dictation starts", async () => {
    const h = drive();
    await pressAndOpen(h);
    recorders[0]?.emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    act(() => h.get().toggle());
    await act(async () => {
      latest().onend?.();
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(h.get().recording).not.toBeNull();
    act(() => h.get().toggle());
    await settle();
    expect(h.get().recording).toBeNull();
    h.unmount();
  });

  /**
   * `session.current` answers "is one running?", which is not "is this the most
   * recent press?". Press, stop with nothing said, press again and stop again:
   * the first tape resolves last, into a `session.current` that is null again,
   * and without a generation check it publishes audio from two dictations ago
   * under a strip that is about neither. GPT Sol's code review, item 1.
   */
  it("does not publish audio from a dictation the reader has moved on from", async () => {
    const h = drive();
    await pressAndOpen(h);
    recorders[0]?.emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    act(() => h.get().toggle());
    // The first session ends, but its recorder has NOT finished flushing yet.
    await act(async () => {
      latest().onend?.();
    });
    // A second dictation, begun and ended before the first tape resolves.
    await pressAndOpen(h);
    act(() => h.get().toggle());
    await act(async () => {
      latest().onend?.();
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(h.get().recording).toBeNull();
    h.unmount();
  });

  it("can be thrown away by hand", async () => {
    const h = drive();
    await pressAndOpen(h);
    recorders[0]?.emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    act(() => h.get().toggle());
    await act(async () => {
      latest().onend?.();
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(h.get().recording).not.toBeNull();
    act(() => h.get().clearRecording());
    expect(h.get().recording).toBeNull();
    h.unmount();
  });

  /* A reader's voice must not outlive the component that was about it. */
  it("keeps nothing when the page is left mid-dictation", async () => {
    const h = drive();
    await pressAndOpen(h);
    recorders[0]?.emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    h.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(recorders[0]?.state).toBe("inactive");
  });
});
