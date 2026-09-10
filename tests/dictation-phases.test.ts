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
import { sendForTranscription } from "../src/web/dictation-upload.js";
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

/**
 * Every track the fake `getUserMedia` has handed out, so that a test can pose
 * the device going away — `r.onerror` consults `readyState` to decide whether a
 * recogniser failure is the end of the dictation or the end of the decoration.
 */
let tracksHandedOut: MediaStreamTrack[] = [];

function fakeTrack() {
  const track = {
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
  tracksHandedOut.push(track);
  return track;
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
/**
 * What a failing transcription answers with.
 *
 * A number rather than a boolean, because *which* failure it is decides whether
 * a Retry is offered at all — `retryable` in `dictation-upload.ts`. 502 is a
 * service that broke and is worth another go; 503 is the family that pressing
 * cannot fix — a server with no API key, and, since 2026-09-07, every provider
 * refusal that would be refused identically next time (a malformed request, a
 * declined one, a model this app cannot reach). `src/transcribe.ts` decides
 * which is which from copy.md's `FailureKind`, not from a list of statuses.
 */
let transcribeStatus = 502;
/**
 * Hold the *next* transcription request open until the test lets it go.
 *
 * Needed for one property only, and that property cannot be tested without it:
 * a stale retry must lose to a newer dictation **that has already finished**.
 * Without a gate the fake `fetch` resolves on the next microtask, so the retry
 * always answered while the second dictation was still armed — and was dropped
 * by a different guard than the one under test. The test passed and proved
 * nothing, which is the shape docs/reusable/silent-success.md is about.
 */
let heldRequest: (() => void) | null = null;
let holdNext = false;

function install(Ctor: typeof FakeRecognition) {
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("fetch", async (url: string) => {
    if (!String(url).includes("/api/transcribe")) throw new Error(`unexpected fetch: ${url}`);
    transcribeCalls++;
    if (holdNext) {
      holdNext = false;
      await new Promise<void>((release) => {
        heldRequest = release;
      });
    }
    if (transcribeFails) {
      return new Response(JSON.stringify({ error: "nope" }), { status: transcribeStatus });
    }
    return new Response(JSON.stringify({ text: transcriptReply, ms: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("SpeechRecognition", Ctor);
  vi.stubGlobal("webkitSpeechRecognition", Ctor);
  /* **The engine, as well as the recogniser's shape.** The probe runs only on
     Chromium, because on WebKit its `start()` puts up a permission prompt that
     the `abort()` cannot take back (docs/plans/260910g). `userAgentData` is how
     the hook tells, so each shape brings the engine it belongs to — set or
     removed every time, since `vi.unstubAllGlobals` does not reach a property
     defined on `navigator`. */
  chromiumEngine(Ctor === ChromiumRecognition);
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

/** Whether `navigator.userAgentData` exists, which only Chromium ships. */
function chromiumEngine(on: boolean) {
  if (on) {
    Object.defineProperty(navigator, "userAgentData", {
      configurable: true,
      value: { brands: [{ brand: "Chromium", version: "151" }], mobile: false, platform: "macOS" },
    });
  } else {
    // Deleted rather than set to undefined: the hook asks `in`, so it must be absent.
    delete (navigator as { userAgentData?: unknown }).userAgentData;
  }
}

/** Swap in the Safari shape mid-test, keeping the frame stubs. */
function useSafari() {
  built = [];
  vi.unstubAllGlobals();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  /* **A fresh constructor each time.** The hook caches the probe's answer per
     constructor for the life of the page, so reusing one class across tests
     means only the first Safari test in the file can ever see a probe — and a
     test asserting "no probe" passes in any later position for the wrong
     reason. Measured: the two-press test below went green against the unfixed
     hook until this line. */
  install(class extends SafariRecognition {});
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
      /* The product's own transcriber, so the fake `fetch` below is still
         reached through the whole real upload path. It is a parameter
         rather than an import inside the hook since 2026-09-08 —
         src/web/transcriber.ts says why. */
      transcribe: sendForTranscription,
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
  transcribeStatus = 502;
  heldRequest = null;
  holdNext = false;
  clock = 0;
  const realNow = Date.now.bind(Date);
  const base = realNow();
  vi.spyOn(Date, "now").mockImplementation(() => base + clock);
  transcriptReply = "THE SERVER SAID THIS";
  tracksStopped = 0;
  tracksHandedOut = [];
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
       to record and something to measure), and `started` is **empty**. A
       version that opened our track *and* let the recogniser open its own would
       pass a test that only checked the first. */
    useSafari();
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    expect(gumCalls).toBe(1);
    /* **Empty, and not even the probe.** Until 2026-09-10 this read `[null]`
       and called that entry harmless: the capability probe started the
       recogniser and aborted it in the same turn. On WebKit that `start()`
       reaches the per-site microphone prompt before the abort arrives, and the
       abort does not take the prompt back — so the reader was asked twice on
       the first press of every page load, which on an iPhone home-screen app is
       most presses. SPIDERYARN-READING2-2R; docs/plans/260910g. */
    expect(latest().started).toEqual([]);
    expect(latest().aborted).toBe(0);
    expect(h.get().liveText).toBe(false);
    expect(h.get().phase).toBe("listening");
    h.unmount();
  });

  it("asks for the microphone once per press on Safari, the first press included", async () => {
    /* The report's own shape: "sometimes twice in a row". The first press of a
       page load was the one that asked twice, so the test presses twice and
       counts both. `getUserMedia` once each, and the recogniser — the thing
       that put up the extra prompt — never told to start at all. */
    useSafari();
    const h = drive();
    for (let press = 0; press < 2; press++) {
      act(() => h.get().toggle());
      await settleCapture();
      expect(h.get().phase).toBe("listening");
      talkFor(4000);
      act(() => h.get().toggle());
      await drain();
    }
    expect(gumCalls).toBe(2);
    expect(built.flatMap((r) => r.started)).toEqual([]);
    expect(h.transcripts).toEqual(["THE SERVER SAID THIS", "THE SERVER SAID THIS"]);
    h.unmount();
  });

  it("does not probe a recogniser outside Chromium, whatever its shape", async () => {
    /* **The gate is the engine, not the recogniser's behaviour**, because
       behaviour is exactly what the probe cannot observe without the side effect
       that costs a prompt. So a recogniser that *would* take a track, in a
       browser without `userAgentData`, is left alone and the reader gets the
       Safari row: a recording, a meter, no live words. Losing decoration on an
       engine that might one day ship the overload is the cheap mistake; a
       permission prompt the reader cannot explain is the expensive one. */
    chromiumEngine(false);
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    expect(gumCalls).toBe(1);
    expect(latest().started).toEqual([]);
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

  /**
   * **A Retry that sends the same recording again.** Greg, 2026-09-05: *"If the
   * error appears afterwards, we should add a Retry button."*
   *
   * Feasible because the audio is already kept for the download offer, so this
   * is a button over a `Blob` that is in memory anyway rather than a second
   * recording path. Offered only where that `Blob` is kept — when nothing
   * landed in the box at all — which is also the only case where the reader has
   * lost something. See the plan for why the other case is deferred.
   */
  it("offers a retry after a failed transcription, and sends the same audio", async () => {
    transcribeFails = true;
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    talkFor(4000);
    act(() => h.get().toggle());
    act(() => latest().onend?.());
    await drain();
    expect(h.get().error).not.toBeNull();
    expect(h.get().recording).not.toBeNull();
    expect(h.get().canRetry).toBe(true);
    expect(transcribeCalls).toBe(1);

    transcribeFails = false;
    act(() => h.get().retry());
    await drain();
    expect(transcribeCalls).toBe(2);
    expect(h.transcripts).toEqual(["THE SERVER SAID THIS"]);
    /* The failure is cleared along with the offer: leaving either up beside a
       transcript that did arrive tells the reader something untrue. */
    expect(h.get().error).toBeNull();
    expect(h.get().recording).toBeNull();
    expect(h.get().canRetry).toBe(false);
    expect(h.get().phase).toBe("idle");
    h.unmount();
  });

  it("puts the failure and the audio back when a retry fails too", async () => {
    transcribeFails = true;
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    talkFor(4000);
    act(() => h.get().toggle());
    act(() => latest().onend?.());
    await drain();
    act(() => h.get().retry());
    await drain();
    expect(transcribeCalls).toBe(2);
    expect(h.transcripts).toEqual([]);
    expect(h.get().error).not.toBeNull();
    expect(h.get().recording).not.toBeNull();
    /* Still offered. A second blip is not evidence that a third try is
       hopeless, and the audio is right there. */
    expect(h.get().canRetry).toBe(true);
    expect(h.get().phase).toBe("idle");
    h.unmount();
  });

  it("does not offer a retry when the transcription worked and heard nothing", async () => {
    /* `[mic-silent]` is a *success* with an empty transcript — the model heard
       no speech. The audio is offered back so the reader can hear what we
       heard, but sending the same silence again would spend a model call to
       produce the same nothing. */
    transcriptReply = "";
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    talkFor(4000);
    act(() => h.get().toggle());
    act(() => latest().onend?.());
    await drain();
    expect(h.get().error).toMatch(/didn't catch any words/i);
    expect(h.get().recording).not.toBeNull();
    expect(h.get().canRetry).toBe(false);
    h.unmount();
  });

  it("closes the box while a retry is in flight", async () => {
    /* `transcribing` is what makes the text box `readOnly` and the microphone
       button dead. A retry is the same two seconds as the first attempt and
       needs the same protection: an edit landing mid-flight is the problem the
       closed box exists to delete. */
    transcribeFails = true;
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    talkFor(4000);
    act(() => h.get().toggle());
    act(() => latest().onend?.());
    await drain();
    transcribeFails = false;
    act(() => h.get().retry());
    expect(h.get().phase).toBe("transcribing");
    expect(h.get().transcribing).toBe(true);
    await drain();
    expect(h.get().phase).toBe("idle");
    h.unmount();
  });

  it("offers no retry for a failure that pressing a button cannot fix", async () => {
    /* A 503 here is `[mic-not-set-up]` — this server has no API key — or any of
       the provider refusals that map to it since 2026-09-07. copy.md calls those
       the `ours`, `bug` and `blocked` kinds: nothing the reader can do, and
       offering a Retry is the mistake that file singles out, because they press
       it five times and conclude the app is broken. The audio is still kept and
       still downloadable; it is the button that is wrong, not the keeping. */
    transcribeFails = true;
    transcribeStatus = 503;
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    talkFor(4000);
    act(() => h.get().toggle());
    act(() => latest().onend?.());
    await drain();
    expect(h.get().error).not.toBeNull();
    expect(h.get().recording).not.toBeNull();
    expect(h.get().canRetry).toBe(false);
    h.unmount();
  });

  it("ends rather than listening to nothing when the recogniser dies and no tape can be made", async () => {
    /* **The dead end the degradation opened.** Once a recogniser error stops
       ending the dictation, the tape is the only source of words left — and
       `recordTrack` returns null when every container this browser offers
       refuses to start. Carrying on there leaves the microphone armed with no
       live words, no recording and no five-minute cap, under a strip promising
       words when the reader stops. GPT Sol's code review, D2. */
    vi.stubGlobal(
      "MediaRecorder",
      Object.assign(
        class {
          constructor() {
            throw new Error("this browser will not record anything");
          }
        },
        { isTypeSupported: () => true },
      ),
    );
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onerror?.({ error: "network" }));
    await drain();
    expect(h.get().armed).toBe(false);
    expect(h.get().phase).toBe("idle");
    expect(h.get().error).toMatch(/\[mic-no-tape\]/);
    expect(h.ends).toHaveLength(1);
    h.unmount();
  });

  it("does not offer a second dictation the first one's audio", async () => {
    /* **The one that would have put the wrong words in the box.** `start()` used
       to clear the *displayed* recording and leave `retryable` holding the
       previous dictation's audio — so a second dictation that failed showed a
       Retry button which cheerfully re-transcribed the first one. Nothing on
       screen distinguishes the two. GPT Sol's code review, D1. */
    transcribeFails = true;
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    talkFor(4000);
    act(() => h.get().toggle());
    act(() => latest().onend?.());
    await drain();
    expect(h.get().canRetry).toBe(true);

    /* A second dictation, which the reader abandons before anything is
       recorded — so there is nothing new to retry. */
    act(() => h.get().toggle());
    await settleCapture();
    expect(h.get().canRetry).toBe(false);
    act(() => h.get().toggle());
    act(() => latest().onend?.());
    await drain();
    expect(h.get().canRetry).toBe(false);
    /* And pressing it anyway does nothing, rather than sending the first
       dictation's audio. */
    const before = transcribeCalls;
    act(() => h.get().retry());
    await drain();
    expect(transcribeCalls).toBe(before);
    h.unmount();
  });

  it("lets a retry lose to a newer dictation that has already stopped", async () => {
    /* The window `session.current` alone did not close: `finish()` clears that
       ref *before* the new dictation's own upload resolves, so a stale retry
       landing in the gap passed the guard, published its transcript and set the
       phase to idle underneath the newer one. `retryGeneration` is what closes
       it. GPT Sol's code review, D1, second half. */
    transcribeFails = true;
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    talkFor(4000);
    act(() => h.get().toggle());
    act(() => latest().onend?.());
    await drain();
    expect(h.get().canRetry).toBe(true);

    transcribeFails = false;
    /* The retry's request is held open, so that the second dictation can run
       all the way to its end while the first one's answer is still in flight —
       which is the window, and the only way to stand in it. */
    holdNext = true;
    act(() => h.get().retry());
    await drain();
    expect(heldRequest).not.toBeNull();

    transcriptReply = "THE SECOND DICTATION";
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    talkFor(4000);
    act(() => h.get().toggle());
    act(() => latest().onend?.());
    await drain();
    expect(h.transcripts).toEqual(["THE SECOND DICTATION"]);

    /* Now let the retry answer. `session.current` is null by this point —
       `finish()` cleared it — so the session check alone would let it through. */
    transcriptReply = "THE STALE RETRY";
    act(() => heldRequest?.());
    await drain();
    expect(h.transcripts).toEqual(["THE SECOND DICTATION"]);
    expect(h.get().phase).toBe("idle");
    h.unmount();
  });

  it("lets a new dictation started mid-retry win", async () => {
    /* **The retry runs with no `Session`**, so nothing else stops its answer
       landing on top of one. A reader who gives up waiting and presses the
       microphone again would otherwise have the microphone switched off under
       them when the retry resolved — `setPhase("idle")` on a dictation that is
       genuinely open — and a stale transcript spliced into it. */
    transcribeFails = true;
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    talkFor(4000);
    act(() => h.get().toggle());
    act(() => latest().onend?.());
    await drain();
    expect(h.get().canRetry).toBe(true);

    transcribeFails = false;
    act(() => h.get().retry());
    /* And now, before the retry can answer, they start again. */
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    await drain();
    expect(h.get().armed).toBe(true);
    expect(h.transcripts).toEqual([]);
    talkFor(4000);
    act(() => h.get().toggle());
    act(() => latest().onend?.());
    await drain();
    expect(h.transcripts).toEqual(["THE SERVER SAID THIS"]);
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

  it("fires onEnd on a recogniser error with no live track, which is the case that used to lose text", async () => {
    /* Before this, dictated words were committed by the stop button and by
       nothing else. An error ended the session with the confirmed text sitting
       unsaved in a box the reader believed had taken it.

       **The premise moved on 2026-09-05 and the invariant did not.** It used to
       be enough that the recogniser had failed; now a recogniser failure ends
       the dictation only when our own track has gone too, because otherwise
       there is still a microphone open and a tape to make. What is unchanged,
       and is what this test is for, is that **an ending always fires `onEnd`** —
       the change narrows what counts as an ending rather than loosening that. */
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    /* The device walked out of the room a moment before the recogniser noticed
       anything. `readyState` is what `r.onerror` consults. */
    for (const t of tracksHandedOut) Object.assign(t, { readyState: "ended" });
    act(() => latest().onerror?.({ error: "network" }));
    expect(h.ends).toHaveLength(1);
    expect(h.get().phase).toBe("idle");
    /* **The microphone, not the connection.** Both events fire on an unplugged
       headset and they race; whichever wins used to decide what the reader was
       told, so the same hardware failure sent them either to reconnect a device
       or to check their wifi. The track is the authority on the track.
       GPT Sol's code review, E1. */
    expect(h.get().error).toMatch(/disconnected/i);
    expect(h.get().error).not.toMatch(/internet/i);
    h.unmount();
  });

  it("takes over the timer and the tape when the recogniser dies before it ever opened", async () => {
    /* **The case GPT Sol's plan review caught (F6).** `audiostart` is the zero
       for the timer, for the word "listening" and for the recorder — so a
       version that merely declined to end the session would have left it armed
       in `opening`, recording nothing, for as long as the reader kept talking.
       That is worse than the ending it replaced. Our track is open; the
       recogniser is simply not part of this dictation any more, which is
       exactly Firefox's situation, and this is Firefox's code path. */
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onerror?.({ error: "network" }));
    expect(h.get().phase).toBe("listening");
    expect(h.get().startedAt).not.toBeNull();
    expect(h.get().error).toBeNull();
    talkFor(4000);
    act(() => h.get().toggle());
    await drain();
    expect(h.transcripts).toEqual(["THE SERVER SAID THIS"]);
    h.unmount();
  });

  /**
   * **The recogniser is decoration, so its dying is not the dictation dying.**
   *
   * Greg, 2026-09-05: *"I tried using the microphone input in Feedback and got
   * a [mic-offline] error."* That code came from here — Chrome's Web Speech
   * API ships its audio to a server, and a captive portal or a VPN blip makes
   * it fail. Until this, that ended the recording **mid-sentence**, showed a
   * message about the reader's internet connection, and told them to press the
   * microphone again — about a path that had usually worked perfectly, because
   * the words that get saved come from the tape and not from the recogniser.
   *
   * Safari and Firefox have run the whole feature with no recogniser at all
   * since day one, so this is not a new state: it is the state they are always
   * in, reached from a different direction.
   */
  it("keeps recording when the recogniser dies mid-sentence", async () => {
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    act(() => latest().onaudiostart?.());
    act(() => latest().onresult?.(result([["the words so far", true]])));
    talkFor(4000);

    act(() => latest().onerror?.({ error: "network" }));
    expect(h.get().armed).toBe(true);
    expect(h.ends).toHaveLength(0);
    /* **Nothing is said**, because nothing has gone wrong for the reader. The
       strip's own sentence changes from "Listening" to "Listening — the words
       appear when you stop", which is Safari's sentence and is now true here. */
    expect(h.get().error).toBeNull();
    expect(h.get().liveText).toBe(false);

    /* A recogniser fires `end` after it errors. That must not restart it into
       the same failure, and must not end the dictation either. */
    act(() => latest().onend?.());
    expect(h.get().armed).toBe(true);
    expect(h.get().error).toBeNull();

    /* And the dictation still delivers, which is the whole point. */
    act(() => h.get().toggle());
    await drain();
    expect(h.transcripts).toEqual(["THE SERVER SAID THIS"]);
    expect(h.ends).toHaveLength(1);
    h.unmount();
  });

  it("keeps recording through a recogniser error of any kind, while the track is live", async () => {
    /* `not-allowed` and `audio-capture` read like microphone failures and are
       not: this app owns the track itself, the recogniser is merely running on
       it, and a track that has genuinely gone fires its own `ended` listener
       (which raises `[mic-unplugged]`). So the gate is *"is the tape still
       running"*, not a list of codes to trust. */
    for (const code of ["not-allowed", "audio-capture", "service-not-allowed", "aborted"]) {
      const h = drive();
      act(() => h.get().toggle());
      await settleCapture();
      act(() => latest().onaudiostart?.());
      talkFor(4000);
      act(() => latest().onerror?.({ error: code }));
      expect(h.get().armed, code).toBe(true);
      expect(h.get().error, code).toBeNull();
      act(() => h.get().toggle());
      await drain();
      h.unmount();
    }
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

  it("reports an `aborted` nobody asked for, once there is no track left either", async () => {
    /* Ours are swallowed by the identity check; this one arrives while the
       reader still has the button armed, so it is a real termination — of the
       *recogniser*. Since 2026-09-05 that ends the dictation only when the
       microphone has gone as well, which is what this poses. While the track is
       live it is a decoration failing, and the test above covers that. */
    const h = drive();
    act(() => h.get().toggle());
    await settleCapture();
    for (const t of tracksHandedOut) Object.assign(t, { readyState: "ended" });
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
