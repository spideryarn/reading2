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
 * docs/plans/260827k-microphone-device-and-recording.md.
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
import { resetMicrophoneLock } from "../src/web/mic-lock.js";
import { useDictation } from "../src/web/useDictation.js";

/* See the same note in tests/dictation-phases.test.ts: the auth header cannot
   be minted here, so `apiFetch` is replaced with a bare `fetch` and everything
   else in the upload path is real. */
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return { ...real, apiFetch: (url: string, init?: RequestInit) => fetch(url, init) };
});

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

/**
 * The second pass, faked.
 *
 * Every dictation now uploads, so a fixture without this reaches a real `fetch`
 * in jsdom and the failure surfaces as "no recording was kept" — which is the
 * assertion half this file is about, and would have been wrong for a reason
 * that had nothing to do with recording.
 */
let transcribeFails = false;
let transcriptReply = "the server's version";

function install() {
  vi.stubGlobal("fetch", async (url: string) => {
    if (!String(url).includes("/api/transcribe")) throw new Error(`unexpected fetch: ${url}`);
    if (transcribeFails) return new Response("{}", { status: 502 });
    return new Response(JSON.stringify({ text: transcriptReply, ms: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
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

/**
 * Let the microphone claim, the capture and any pending release all land.
 *
 * The timers matter as much as the microtasks: since 2026-08-27 a new session
 * **waits for the previous one's track to be stopped** before asking for a
 * device (mic-lock.ts), and that release comes after the tape's deferred
 * `onstop`. Microtasks alone leave the second session queued for ever, which
 * looks exactly like a capture that failed.
 */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20);
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

function drive() {
  const text: string[] = [];
  const ends: number[] = [];
  const transcripts: string[] = [];
  let state: ReturnType<typeof useDictation> | null = null;
  function Probe(): ReactNode {
    state = useDictation({
      onText: (t) => text.push(t),
      onTranscript: (t) => transcripts.push(t),
      onEnd: () => ends.push(1),
      context: { kind: "profile" },
    });
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
    transcripts,
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
  /* The claim is page-wide and module-level, so a test that leaves it held
     would hang the next one at `getUserMedia`. */
  resetMicrophoneLock();
  built = [];
  recorders = [];
  gumWith = [];
  gumPlan = [];
  tracksStopped = 0;
  nextLabel = "MacBook Pro Microphone (Built-in)";
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  transcribeFails = false;
  transcriptReply = "the server's version";
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
  it("refuses the whole dictation when the microphone is refused", async () => {
    /* **The reverse of what this test used to assert**, and deliberately. It
       used to check that a refused `getUserMedia` fell through to the recogniser
       opening its own device, on the rule that a meter which cannot get samples
       must never stop dictation. Since 2026-08-27 the track is not for the
       meter, it is for the recording — and without a recording there is no
       transcript, so there is nothing to fall through to. A refusal is now a
       dictation that cannot happen, and the reader is told. */
    const h = drive();
    act(() => h.get().chooseDevice("abc123"));
    await settle();
    gumPlan = ["denied"];
    act(() => h.get().toggle());
    await settle();
    expect(h.get().armed).toBe(false);
    expect(h.get().error).toMatch(/microphone could not be started/i);
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
    /* **Nothing came back, and no error happened** — which is exactly the shape
       of the failure this feature was built for. A silent microphone yields
       `no-speech`, which is suppressed because it fires on every ordinary
       pause, so an error-only trigger would have been silent through the whole
       thing. Here the model returns a successful, empty transcript and the
       recogniser produced nothing either, and the audio is offered. */
    transcriptReply = "";
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
  /**
   * **This test used to say something else, and it was right at the time.**
   *
   * It was *"keeps nothing when words came back, even if it then ended badly"*,
   * and it pinned the rule that the audio was kept only when the recogniser had
   * confirmed nothing — because on Chromium a reader with rough words in the box
   * has the worse version rather than nothing.
   *
   * Two things happened on 2026-09-05, and the second is why the old test had to
   * go rather than merely be renamed. A recogniser error stopped ending the
   * dictation, so *"it then ended badly"* was no longer true of it at all — the
   * old assertion still passed, and passed **while checking nothing**, which is
   * exactly the shape docs/reusable/silent-success.md is about. And the rule it
   * pinned became unsafe: with the tape running on past a dead recogniser, the
   * rough words cover the first half of a dictation and the recording covers all
   * of it. GPT Sol's plan review, F2.
   */
  it("does not end, and keeps nothing yet, when the recogniser fails mid-dictation", async () => {
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
    /* Nothing to offer: the microphone is still open and the dictation is still
       going. The *reason* matters — this is not the old "we threw it away". */
    expect(h.get().recording).toBeNull();
    expect(h.get().armed).toBe(true);
    h.unmount();
  });

  it("keeps the audio when the recogniser failed and the transcription then failed too", async () => {
    /* **The converse, and the one that was losing speech.** The recogniser dies
       part-way, the reader keeps talking, and the upload then fails — very
       likely for the same reason, since one common cause of both is having no
       network. The rough words in the box are the first half of what was said;
       the tape is all of it, and it is the only copy. */
    transcribeFails = true;
    const h = drive();
    await pressAndOpen(h);
    recorders[0]?.emit(4096);
    act(() => {
      saidFinal(latest(), "the first half");
    });
    await act(async () => {
      latest().onerror?.({ error: "network" });
      await vi.advanceTimersByTimeAsync(20);
    });
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    act(() => h.get().toggle());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(h.get().error).not.toBeNull();
    expect(h.get().recording).not.toBeNull();
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
    // Nothing came back, which is the state that leaves a recording to throw away.
    transcriptReply = "";
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
    // Nothing came back, which is the state that leaves a recording to throw away.
    transcriptReply = "";
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
