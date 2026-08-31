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
 * the same state as armed and hearing. docs/plans/260827f-microphone-level-meter.md.
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
import { resetMicrophoneLock } from "../src/web/mic-lock.js";
import { useDictation } from "../src/web/useDictation.js";

/* **`apiFetch` and not `fetch`, so the auth header goes on** — which is right in
   the app and unrunnable here, since no test can mint a real ES256 token
   (docs/project/auth.md). So the wrapper is replaced with a straight `fetch`
   and everything else in the path is the real thing: the base64, the body, the
   route, the response parsing. What is not covered is the header, and that is
   said here rather than left to be assumed. */
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return {
    ...real,
    apiFetch: (url: string, init?: RequestInit) => fetch(url, init),
  };
});

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
  /**
   * **`abort()` fires `end`, because a real one does.**
   *
   * That is not decoration: since 2026-08-27 the capability probe *waits* for
   * this event before opening our own track, because `abort()` promises
   * disconnection and a later `end` rather than synchronous release of the
   * device (GPT Sol's code review, item 4). A fake that never fires it makes
   * every Safari-path test wait out the 200ms bound and pass for the wrong
   * reason. Asynchronous, like the real thing.
   */
  abort() {
    this.aborted++;
    setTimeout(() => this.onend?.(), 0);
  }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}

/**
 * Just enough `MediaRecorder` to reach the second pass.
 *
 * The tape is no longer optional: since 2026-08-27 every dictation records and
 * uploads, so a fixture without a recorder tests a code path that no longer
 * exists. Bytes are emitted on `start` so that `stop()` has something to hand
 * back — a recorder that produced nothing is a different test, and it is in
 * dictation-recording.test.ts.
 */
class FakeRecorder {
  static isTypeSupported(t: string) {
    return t.startsWith("audio/webm");
  }
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() {
    this.state = "recording";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(8192)]) });
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    setTimeout(() => this.onstop?.(), 0);
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

/**
 * The transcription round trip, faked.
 *
 * Deliberately returns something the recogniser never said, because the
 * property under test is that the **server's** words end up in the box and the
 * live ones do not. A fixture that returned the same string either way would
 * pass whether or not the second pass was wired up at all —
 * docs/reusable/silent-success.md.
 */
let transcriptReply = "THE SERVER SAID THIS";
/**
 * How much time the test says has passed.
 *
 * The recorder throws away anything under two seconds — an accidental
 * double-press must not produce a quarter-second of nothing wearing the word
 * "recording" — so a test that runs in one millisecond gets no tape and
 * therefore no transcript, which would look exactly like a broken second pass.
 * `Date.now` is moved rather than the timers faked, because the tape's `onstop`
 * is a real `setTimeout` and faking that turns the ordering assertions in this
 * file into no-ops.
 */
let clock = 0;
function talkFor(ms: number) {
  clock += ms;
}
let transcribeCalls = 0;
let transcribeFails = false;

function install(Ctor: typeof FakeRecognition) {
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("fetch", async (url: string) => {
    if (!String(url).includes("/api/transcribe")) throw new Error(`unexpected fetch: ${url}`);
    transcribeCalls++;
    if (transcribeFails) {
      return new Response(JSON.stringify({ error: "nope" }), { status: 502 });
    }
    return new Response(JSON.stringify({ text: transcriptReply, ms: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("SpeechRecognition", Ctor);
  vi.stubGlobal("webkitSpeechRecognition", Ctor);
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

/** One `onresult` event, in the shape the spec hands over. */
function result(phrases: Array<[string, boolean]>) {
  return {
    resultIndex: 0,
    results: phrases.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })),
  };
}

/**
 * Let the tape's `onstop` timer, the base64 encode and the fetch all land.
 *
 * The recorder's `onstop` is deliberately deferred by a `setTimeout` in the
 * fixture, because a real one is — firing it synchronously made every ordering
 * assertion in this file pass whether the code was right or wrong.
 */
async function drain() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

/** `beginCapture` is async; let its microtasks land. */
async function settleCapture() {
  await act(async () => {
    /* Enough turns for the microphone claim *and* the capture, and a real
       macrotask between them. The claim added an `await` in front of
       `getUserMedia` on 2026-08-27 (mic-lock.ts) and a new session now waits
       for the previous one's track to be released — which happens after the
       tape's deferred `onstop`, so microtasks alone leave the second session
       queued for ever. That showed up as every capture test failing at once
       rather than as anything to do with locking. */
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
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

beforeEach(() => {
  /* The claim is page-wide and module-level, so a test that leaves it held
     would hang the next one at `getUserMedia`. */
  resetMicrophoneLock();
  built = [];
  gumCalls = 0;
  gumRejects = false;
  transcribeCalls = 0;
  transcribeFails = false;
  clock = 0;
  const realNow = Date.now.bind(Date);
  const base = realNow();
  vi.spyOn(Date, "now").mockImplementation(() => base + clock);
  transcriptReply = "THE SERVER SAID THIS";
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

  it("dictates on Firefox, which has no recogniser at all", async () => {
    /* **The browser this change was advertised as adding, and for one round its
       button did nothing.** `supported` was widened to mean "can open a
       microphone" because the live words are decoration — and `start()` still
       began `if (!Ctor) return`, so Firefox got a control that was present and
       dead. GPT Sol's code review, item 6.

       What it gets: the track, the meter, the recorder and the transcript.
       What it does not: words while you talk, which is what `liveText` is for
       and what the strip says out loud. */
    vi.unstubAllGlobals();
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    install(ChromiumRecognition);
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);

    const h = drive();
    expect(h.get().supported).toBe(true);
    act(() => h.get().toggle());
    await settleCapture();
    expect(gumCalls).toBe(1);
    expect(built).toHaveLength(0);
    expect(h.get().phase).toBe("listening");
    expect(h.get().liveText).toBe(false);

    talkFor(4000);
    act(() => h.get().toggle());
    await drain();
    expect(transcribeCalls).toBe(1);
    expect(h.transcripts).toEqual(["THE SERVER SAID THIS"]);
    h.unmount();
  });

  it("takes the track itself on Safari, and never starts the recogniser", async () => {
    /* **The reversal of 2026-08-27, and the load-bearing test for it.**
       WebKit allows one microphone source at a time, so on Safari the choice is
       live words *or* a recording — and we now take the recording, because the
       transcript that comes out of it is the half that gets saved.

       Two assertions, and both matter. The stream is opened (there is something
       to record and something to measure), and `started` is **empty** — the
       recogniser was probed and then aborted, never started for real. A version
       that opened our track *and* let the recogniser open its own would pass a
       test that only checked the first. */
    useSafari();
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    expect(gumCalls).toBe(1);
    /* One entry, and it is **the probe** — `SafariRecognition.start` ignores its
       argument and starts, which is exactly the behaviour the probe exists to
       detect. The abort in the same synchronous turn is what stops that from
       becoming a second live microphone, and the assertion that matters is that
       nothing started it *again* afterwards. */
    expect(latest().started).toEqual([null]);
    expect(latest().aborted).toBe(1);
    expect(h.get().liveText).toBe(false);
    expect(h.get().phase).toBe("listening");
    h.unmount();
  });

  it("refuses to dictate at all when the microphone will not open", async () => {
    /* **This used to carry on, and carrying on is now wrong.** The old rule was
       that a meter which cannot get samples must never be the thing that stops
       dictation, so a refused `getUserMedia` fell through to the recogniser
       opening its own device. There is no such fallback now: without our track
       there is nothing to record, and without a recording there is no
       transcript — so a dictation that could not open the microphone is a
       dictation that cannot happen, and saying so is better than a button that
       looks armed and will produce nothing. */
    gumRejects = true;
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    expect(h.get().armed).toBe(false);
    expect(h.get().error).toMatch(/microphone could not be started/i);
    h.unmount();
  });

  it("sends the recording up and puts the server's words in, not the recogniser's", async () => {
    /* **The whole point of the second pass, and the one thing that can be
       silently wrong.** The live text and the transcript are deliberately
       different strings in the fixture, so a build that never uploaded — or
       that appended instead of replacing — fails here rather than looking
       right. */
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    act(() => latest().onresult?.(result([["a rough guess", true]])));
    expect(h.text).toEqual(["a rough guess"]);

    talkFor(4000);
    act(() => h.get().toggle());
    expect(h.get().phase).toBe("transcribing");
    act(() => latest().onend?.());
    await drain();
    expect(transcribeCalls).toBe(1);
    expect(h.transcripts).toEqual(["THE SERVER SAID THIS"]);
    expect(h.get().phase).toBe("idle");
    h.unmount();
  });

  it("says so, and keeps the audio, when the transcription fails", async () => {
    /* On Chromium the live words are still in the box, so this is the reader
       having the worse version rather than nothing. Elsewhere it is the whole
       dictation — which is why the audio is offered back whenever nothing else
       came of it. */
    transcribeFails = true;
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    talkFor(4000);
    act(() => h.get().toggle());
    act(() => latest().onend?.());
    await drain();
    expect(h.transcripts).toEqual([]);
    expect(h.get().error).not.toBeNull();
    expect(h.get().phase).toBe("idle");
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

  it("measures on Safari now too, because the track is ours there as well", async () => {
    /* **This assertion is the reverse of the one it replaces.** Until
       2026-08-27 Safari got no track, so the meter had nothing to measure and
       fell back to the recogniser's binary `soundstart` / `soundend`. Now the
       track is ours on every browser, so the bars are a real RMS everywhere and
       the fallback is only for the second before samples start flowing. */
    useSafari();
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    expect(h.get().meter).toBe("measured");
    h.unmount();
  });

  it("has no samples to show during the opening second, and says `detected` there", async () => {
    /* **What is left of the fallback.** It used to be the whole of Safari;
       since the track is ours everywhere it is the measured ~1.1 seconds
       between the press and the microphone actually opening, when there is a
       phase to draw and nothing yet to draw it from. `soundstart` and
       `soundend` still drive the bars through it, which is real observation
       rather than an invented animation — the property that made showing a
       binary signal in the same bars defensible in the first place. */
    const h = drive();
    act(() => h.get().toggle());
    expect(h.get().phase).toBe("opening");
    expect(h.get().meter).toBe("detected");
    act(() => latest().onsoundstart?.());
    expect(h.get().level.current).toBe(1);
    act(() => latest().onsoundend?.());
    expect(h.get().level.current).toBe(0);
    await settleCapture();
    h.unmount();
  });
});

describe("ending, and the promise that it saves", () => {
  it("acknowledges the press at once, by going to `transcribing` rather than idle", async () => {
    /* The reader's press must be acknowledged now, not whenever the recogniser
       gets round to ending — even though the ending itself waits for `onend`.

       **`transcribing` and not `idle`**, which is the 2026-08-27 change: the
       microphone is off, which is what they asked for, but the dictation is not
       over, and a box that went back to normal here would invite exactly the
       edit that `readOnly` exists to prevent. `armed` is false either way, so
       nothing reads this as a second listening state. */
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => h.get().toggle());
    expect(h.get().phase).toBe("transcribing");
    expect(h.get().armed).toBe(false);
    expect(h.get().transcribing).toBe(true);
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
