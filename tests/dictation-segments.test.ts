// @vitest-environment jsdom
/**
 * **A long dictation is cut into parts, sent while the reader is still
 * talking, and delivered as one transcript — or not at all.**
 *
 * Greg hit `[mic-full]` two and a half minutes into a Feedback message
 * (SPIDERYARN-READING2-5B): one recording could not grow past what one request
 * may carry. The tape now rotates (tests/mic-recording.test.ts pins where), and
 * this file pins what the hook does with the parts:
 *
 * - each finished part goes up at once, and the transcript is their words **in
 *   order**, handed to `onTranscript` **once**;
 * - **all or nothing**: a part that failed publishes nothing, and Retry re-sends
 *   only the parts that failed;
 * - every row of the plan's cancellation table, on the path with a recogniser
 *   (Chromium) and the one without (Safari, Firefox): Stop, the ceiling and
 *   another box taking the microphone keep the uploads; a superseding press, a
 *   device change and an unmount abort them; a stale session never publishes.
 *
 * docs/plans/260929f-feedback-thank-you-as-a-toast-and-dictation-that-never-runs-out-of-tape.md
 * § Part B, revised after review.
 */
import { act, createElement, type ReactNode, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMicrophoneLock } from "../src/web/mic-lock.js";
import { PART_MS } from "../src/web/mic-recording.js";
import type { TranscriptionResult } from "../src/web/transcriber.js";
import { joinTranscripts, useDictation } from "../src/web/useDictation.js";
import { useDictationField } from "../src/web/useDictationField.js";

/* ------------------------------------------------------------- the fakes -- */

/** A recorder the test hands chunks to by hand. `onstop` is a task, like a real one. */
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported(t: string) {
    return t.startsWith("audio/webm");
  }
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  failOnStop = false;
  constructor() {
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    setTimeout(() => (this.failOnStop ? this.onerror?.() : this.onstop?.()), 0);
  }
  emit(bytes: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
  fail() {
    this.state = "inactive";
    this.onerror?.();
  }
}

function recorder(): FakeRecorder {
  const r = FakeRecorder.instances.at(-1);
  if (!r) throw new Error("no recorder was built");
  return r;
}

class FakeRecognition {
  static built: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onsoundstart: (() => void) | null = null;
  onsoundend: (() => void) | null = null;
  constructor() {
    FakeRecognition.built.push(this);
  }
  /** Chromium's shape: the argument is type-checked, which is the whole probe. */
  start(track?: unknown) {
    if (track !== undefined && !(typeof track === "object" && track && "readyState" in track)) {
      throw new TypeError("parameter 1 is not of type 'MediaStreamTrack'.");
    }
  }
  stop() {}
  abort() {
    setTimeout(() => this.onend?.(), 0);
  }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}

function recognition(): FakeRecognition {
  const r = FakeRecognition.built.at(-1);
  if (!r) throw new Error("no recogniser was built");
  return r;
}

/** Every request the hook made, in order, each held open until the test answers it. */
interface Call {
  size: number;
  signal: AbortSignal | undefined;
  answer(r: TranscriptionResult): void;
}
let calls: Call[] = [];
/**
 * Answer as though the abort came too late — the request had already finished.
 * Without it, every stale session is stopped by the "abandoned" answer and the
 * guard that is meant to stop it is never exercised: the mutation that removed
 * it passed the whole file.
 */
let ignoreAbort = false;

const transcribe = (blob: Blob, _mime: string, _where: unknown, signal?: AbortSignal) =>
  new Promise<TranscriptionResult>((resolve) => {
    /* Aborting answers "abandoned", as the real uploader does — so a test that
       forgets to abort still finds out from the answer, not only the signal. */
    if (!ignoreAbort) {
      signal?.addEventListener("abort", () =>
        resolve({ ok: false, abandoned: true, message: "aborted", retryable: false }),
      );
    }
    calls.push({ size: blob.size, signal, answer: resolve });
  });

const ok = (text: string): TranscriptionResult => ({ ok: true, text });
const failed = (retryable: boolean): TranscriptionResult => ({
  ok: false,
  message: "We couldn't transcribe that. [mic-upstream]",
  retryable,
});

let clock = 0;
/** The ceiling's callback, caught so a test can reach five minutes without waiting them. */
let ceilings: Array<() => void> = [];

type Path = "recogniser" | "no recogniser";

function install(path: Path) {
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal(
    "MediaStream",
    class {
      constructor(private tracks: unknown[] = []) {}
      getAudioTracks() {
        return this.tracks;
      }
    },
  );
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      resume = async () => {};
      createMediaStreamSource = () => ({ connect: () => {}, disconnect: () => {} });
      createAnalyser = () => ({ fftSize: 2048, getFloatTimeDomainData: () => {}, disconnect: () => {} });
    },
  );
  if (path === "recogniser") {
    vi.stubGlobal("SpeechRecognition", class extends FakeRecognition {});
    Object.defineProperty(navigator, "userAgentData", {
      configurable: true,
      value: { brands: [{ brand: "Chromium", version: "151" }] },
    });
  } else {
    // Firefox: no recogniser at all. Safari's path is the same one after the probe.
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    delete (navigator as { userAgentData?: unknown }).userAgentData;
  }
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => {
        const track = {
          readyState: "live",
          addEventListener: () => {},
          removeEventListener: () => {},
          stop: () => {},
        };
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      },
    },
  });
}

beforeEach(() => {
  resetMicrophoneLock();
  FakeRecorder.instances = [];
  FakeRecognition.built = [];
  calls = [];
  ignoreAbort = false;
  ceilings = [];
  clock = 0;
  const base = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => base + clock);
  const realSetTimeout = window.setTimeout.bind(window);
  vi.spyOn(window, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
    if (ms === 5 * 60_000) {
      ceilings.push(fn);
      return 0;
    }
    return realSetTimeout(fn, ms);
  }) as typeof window.setTimeout);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/* ----------------------------------------------------------- the harness -- */

function drive(send = transcribe) {
  const transcripts: string[] = [];
  const ends: number[] = [];
  let state: ReturnType<typeof useDictation> | null = null;
  function Probe(): ReactNode {
    state = useDictation({
      onText: () => {},
      onTranscript: (t) => transcripts.push(t),
      onEnd: () => ends.push(1),
      context: { kind: "profile" },
      transcribe: send,
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
    transcripts,
    ends,
    get: () => {
      if (!state) throw new Error("the hook never rendered");
      return state;
    },
    unmount: () => act(() => root.unmount()),
  };
}

function driveField() {
  let field: ReturnType<typeof useDictationField> | null = null;
  let value = "Before";
  function Probe(): ReactNode {
    const [text, setText] = useState(value);
    const box = useRef<HTMLTextAreaElement>(null);
    value = text;
    field = useDictationField({
      value: text,
      onChange: setText,
      box,
      context: { kind: "profile" },
      transcribe,
    });
    return createElement("textarea", {
      ref: box,
      value: text,
      readOnly: field.readOnly,
      onChange: () => {},
    });
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: Root;
  act(() => {
    root = createRoot(host);
    root.render(createElement(Probe));
  });
  const box = host.querySelector("textarea");
  if (!box) throw new Error("the field never rendered");
  box.setSelectionRange(value.length, value.length);
  return {
    box,
    value: () => value,
    get: () => {
      if (!field) throw new Error("the field hook never rendered");
      return field;
    },
    unmount: () => act(() => root.unmount()),
  };
}

async function settle() {
  await act(async () => {
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 10; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

/** Press, and get as far as the tape running, on either path. */
async function press(h: ReturnType<typeof drive>, path: Path) {
  act(() => h.get().toggle());
  await settle();
  if (path === "recogniser") act(() => recognition().onaudiostart?.());
  await settle();
  expect(h.get().phase).toBe("listening");
}

/** Talk for `ms`, and the recorder hands over `bytes` at the end of it. */
function talk(ms: number, bytes: number) {
  clock += ms;
  act(() => recorder().emit(bytes));
}

/** Press Stop, the way each path ends: the recogniser's `onend`, or at once. */
async function stop(h: ReturnType<typeof drive>, path: Path) {
  act(() => h.get().toggle());
  if (path === "recogniser") act(() => recognition().onend?.());
  await settle();
}

async function answer(i: number, r: TranscriptionResult) {
  const c = calls[i];
  if (!c) throw new Error(`no request ${i}`);
  act(() => c.answer(r));
  await settle();
}

/** Three parts: two rotations, then a tail. Requests 0 and 1 are in flight before Stop. */
async function longDictation(h: ReturnType<typeof drive>, path: Path) {
  await press(h, path);
  talk(PART_MS, 1000);
  await settle();
  talk(PART_MS, 2000);
  await settle();
  talk(5000, 3000);
}

/* ------------------------------------------------------------ the joining -- */

describe("joining the parts' words", () => {
  it("puts a space between parts and leaves one part exactly as it came", () => {
    expect(joinTranscripts(["Hello there.", " and then  ", "more."])).toBe("Hello there. and then more.");
    expect(joinTranscripts(["a", "", "b"])).toBe("a b");
    expect(joinTranscripts([" as it came "])).toBe(" as it came ");
    expect(joinTranscripts(["", ""])).toBe("");
  });
});

describe.each<Path>(["recogniser", "no recogniser"])("a long dictation, %s", (path) => {
  beforeEach(() => install(path));

  it("sends each part while the reader is still talking, and delivers them in order, once", async () => {
    const h = drive();
    await longDictation(h, path);
    // Two parts already up, and the microphone still open.
    expect(calls.map((c) => c.size)).toEqual([1000, 2000]);
    expect(h.get().armed).toBe(true);

    await stop(h, path);
    expect(calls.map((c) => c.size)).toEqual([1000, 2000, 3000]);
    // Answered out of order; delivered in order.
    await answer(2, ok("three"));
    await answer(0, ok("one"));
    expect(h.transcripts).toEqual([]);
    await answer(1, ok("two"));
    expect(h.transcripts).toEqual(["one two three"]);
    expect(h.ends).toHaveLength(1);
    expect(h.get().phase).toBe("idle");
    expect(h.get().recording).toBeNull();
    h.unmount();
  });

  it("publishes nothing when one part fails, keeps every part, and retries only that one", async () => {
    const h = drive();
    await longDictation(h, path);
    await stop(h, path);
    await answer(0, ok("one"));
    await answer(1, failed(true));
    await answer(2, ok("three"));
    expect(h.transcripts).toEqual([]);
    expect(h.get().error).toContain("[mic-upstream]");
    expect(h.get().recording?.parts.map((p) => p.blob.size)).toEqual([1000, 2000, 3000]);
    expect(h.get().canRetry).toBe(true);

    act(() => h.get().retry());
    await settle();
    // One request, and it is the failed part's bytes.
    expect(calls.map((c) => c.size)).toEqual([1000, 2000, 3000, 2000]);
    await answer(3, ok("two"));
    expect(h.transcripts).toEqual(["one two three"]);
    expect(h.get().recording).toBeNull();
    h.unmount();
  });

  it("offers no retry when any failed part could never succeed", async () => {
    const h = drive();
    await longDictation(h, path);
    await stop(h, path);
    await answer(0, failed(true));
    await answer(1, failed(false));
    await answer(2, ok("three"));
    expect(h.transcripts).toEqual([]);
    expect(h.get().canRetry).toBe(false);
    expect(h.get().recording?.parts).toHaveLength(3);
    h.unmount();
  });

  it("says [mic-silent] when every part came back empty, and offers the audio", async () => {
    const h = drive();
    await longDictation(h, path);
    await stop(h, path);
    for (const i of [0, 1, 2]) await answer(i, ok(""));
    expect(h.transcripts).toEqual([]);
    expect(h.get().error).toContain("[mic-silent]");
    expect(h.get().recording?.parts).toHaveLength(3);
    h.unmount();
  });

  it("keeps a short tail after a rotation, where a dictation that short alone would be dropped", async () => {
    const h = drive();
    await press(h, path);
    talk(PART_MS, 1000);
    await settle();
    talk(400, 500);
    await stop(h, path);
    expect(calls.map((c) => c.size)).toEqual([1000, 500]);
    h.unmount();
  });

  it("ends the dictation on a broken tape, publishes nothing and offers what came before it", async () => {
    const h = drive();
    await press(h, path);
    talk(PART_MS, 1000);
    await settle();
    expect(calls).toHaveLength(1);
    // A suspended tab's backlog, in one chunk too big for any request.
    talk(1000, 2_200_000);
    // No recogniser `onend` is needed before a request nobody can use is cancelled.
    expect(calls[0]?.signal?.aborted).toBe(true);
    if (path === "recogniser") act(() => recognition().onend?.());
    await settle();
    expect(h.get().armed).toBe(false);
    expect(h.get().error).toContain("[mic-broken]");
    expect(h.get().recording?.parts.map((p) => p.blob.size)).toEqual([1000]);
    expect(h.get().canRetry).toBe(false);
    expect(h.transcripts).toEqual([]);
    h.unmount();
  });

  it("reports a recorder error while flushing the only part as [mic-broken], not [mic-empty]", async () => {
    const h = drive();
    await press(h, path);
    talk(5000, 1000);
    recorder().failOnStop = true;
    await stop(h, path);
    expect(h.get().error).toContain("[mic-broken]");
    expect(h.get().error).not.toContain("[mic-empty]");
    expect(calls).toHaveLength(0);
    expect(h.get().recording).toBeNull();
    h.unmount();
  });

  it("turns a synchronously throwing transcriber into [mic-unexpected] and keeps the audio", async () => {
    const h = drive(() => {
      throw new Error("caller broke its promise contract");
    });
    await press(h, path);
    talk(5000, 1000);
    await stop(h, path);
    expect(h.get().error).toContain("[mic-unexpected]");
    expect(h.get().recording?.parts.map((p) => p.blob.size)).toEqual([1000]);
    expect(h.get().canRetry).toBe(false);
    h.unmount();
  });

  it("ends as [mic-no-tape] when every advertised container asynchronously refuses", async () => {
    const h = drive();
    await press(h, path);
    act(() => recorder().fail());
    act(() => recorder().fail());
    await settle();
    if (path === "recogniser") act(() => recognition().onend?.());
    await settle();
    expect(h.get().armed).toBe(false);
    expect(h.get().error).toContain("[mic-no-tape]");
    expect(h.get().error).not.toContain("[mic-empty]");
    expect(calls).toHaveLength(0);
    h.unmount();
  });

  /* Sol's round-two C1: with live words already confirmed, the microphone
     used to stop mid-sentence and say nothing at all. */
  it("says so when every container refuses after live words were confirmed", async () => {
    if (path !== "recogniser") return;
    const h = drive();
    await press(h, path);
    act(() =>
      recognition().onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: "rough words" } }],
      }),
    );
    act(() => recorder().fail());
    act(() => recorder().fail());
    await settle();
    act(() => recognition().onend?.());
    await settle();
    expect(h.get().armed).toBe(false);
    expect(h.get().error).toContain("[mic-broken]");
    expect(calls).toHaveLength(0);
    h.unmount();
  });

  /* ------------------------------------------- the cancellation table --- */

  it("the ceiling ends it like Stop: uploads kept, the tail sent, one transcript", async () => {
    const h = drive();
    await longDictation(h, path);
    expect(ceilings).toHaveLength(1);
    act(() => ceilings[0]?.());
    if (path === "recogniser") act(() => recognition().onend?.());
    await settle();
    expect(h.get().error).toContain("[mic-full]");
    expect(calls.map((c) => c.signal?.aborted)).toEqual([false, false, false]);
    for (const [i, w] of ["a", "b", "c"].entries()) await answer(i, ok(w));
    expect(h.transcripts).toEqual(["a b c"]);
    h.unmount();
  });

  it("another box taking the microphone ends it like Stop, and it still publishes", async () => {
    const h = drive();
    await longDictation(h, path);
    const first = path === "recogniser" ? recognition() : null;
    const other = drive();
    act(() => other.get().toggle());
    await settle();
    // Asked to stop the ordinary way; on Chromium the recogniser then ends.
    act(() => first?.onend?.());
    await settle();
    // The first box's parts, all three, none aborted.
    const mine = calls.slice(0, 3);
    expect(mine.map((c) => c.size)).toEqual([1000, 2000, 3000]);
    expect(mine.map((c) => c.signal?.aborted)).toEqual([false, false, false]);
    for (const [i, w] of ["a", "b", "c"].entries()) await answer(i, ok(w));
    expect(h.transcripts).toEqual(["a b c"]);
    other.unmount();
    h.unmount();
  });

  it("a new press in the same box aborts the last one's uploads, and it never publishes", async () => {
    const h = drive();
    await longDictation(h, path);
    await stop(h, path);
    expect(calls).toHaveLength(3);
    act(() => h.get().toggle());
    await settle();
    expect(calls.map((c) => c.signal?.aborted)).toEqual([true, true, true]);
    for (const [i, w] of ["a", "b", "c"].entries()) await answer(i, ok(w));
    expect(h.transcripts).toEqual([]);
    expect(h.ends).toEqual([]);
    h.unmount();
  });

  it("a stale session never publishes, even when its requests finish regardless", async () => {
    ignoreAbort = true;
    const h = drive();
    await longDictation(h, path);
    await stop(h, path);
    act(() => h.get().toggle());
    await settle();
    for (const [i, w] of ["a", "b", "c"].entries()) await answer(i, ok(w));
    expect(h.transcripts).toEqual([]);
    expect(h.ends).toEqual([]);
    // And the new press is untouched by it.
    expect(h.get().armed).toBe(true);
    h.unmount();
  });

  it("an unmount after Stop, while the parts are still being transcribed, aborts them", async () => {
    const h = drive();
    await longDictation(h, path);
    await stop(h, path);
    expect(calls).toHaveLength(3);
    h.unmount();
    expect(calls.map((c) => c.signal?.aborted)).toEqual([true, true, true]);
  });

  it("a device change mid-dictation aborts the parts already sent", async () => {
    const h = drive();
    await press(h, path);
    talk(PART_MS, 1000);
    await settle();
    expect(calls).toHaveLength(1);
    act(() => h.get().chooseDevice("another-mic"));
    await settle();
    expect(calls[0]?.signal?.aborted).toBe(true);
    await answer(0, ok("stale"));
    expect(h.transcripts).toEqual([]);
    h.unmount();
  });

  it("an unmount aborts the parts already sent", async () => {
    const h = drive();
    await press(h, path);
    talk(PART_MS, 1000);
    await settle();
    expect(calls).toHaveLength(1);
    h.unmount();
    expect(calls[0]?.signal?.aborted).toBe(true);
    await answer(0, ok("stale"));
    expect(h.transcripts).toEqual([]);
  });

  it("a retry has its own controller: an unmount aborts it, and nothing publishes", async () => {
    const h = drive();
    await longDictation(h, path);
    await stop(h, path);
    await answer(0, ok("one"));
    await answer(1, failed(true));
    await answer(2, ok("three"));
    act(() => h.get().retry());
    await settle();
    const retryCall = calls[3];
    expect(retryCall?.signal).not.toBe(calls[0]?.signal);
    h.unmount();
    expect(retryCall?.signal?.aborted).toBe(true);
    expect(h.transcripts).toEqual([]);
  });

  it("a new dictation aborts a retry that it supersedes", async () => {
    const h = drive();
    await longDictation(h, path);
    await stop(h, path);
    await answer(0, ok("one"));
    await answer(1, failed(true));
    await answer(2, ok("three"));
    act(() => h.get().retry());
    await settle();
    const retryCall = calls[3];
    expect(retryCall?.signal?.aborted).toBe(false);
    act(() => h.get().toggle());
    await settle();
    expect(retryCall?.signal?.aborted).toBe(true);
    expect(h.transcripts).toEqual([]);
    h.unmount();
  });

  it("discarding the recording aborts its retry and hands the box back", async () => {
    const h = drive();
    await longDictation(h, path);
    await stop(h, path);
    await answer(0, ok("one"));
    await answer(1, failed(true));
    await answer(2, ok("three"));
    act(() => h.get().retry());
    await settle();
    const retryCall = calls[3];
    act(() => h.get().clearRecording());
    await settle();
    expect(retryCall?.signal?.aborted).toBe(true);
    expect(h.get().recording).toBeNull();
    expect(h.get().phase).toBe("idle");
    expect(h.transcripts).toEqual([]);
    h.unmount();
  });

  it("contains a synchronous throw on Retry as [mic-unexpected]", async () => {
    let attempt = 0;
    const h = drive(() => {
      attempt++;
      if (attempt === 1) return Promise.resolve(failed(true));
      throw new Error("caller broke its promise contract");
    });
    await press(h, path);
    talk(5000, 1000);
    await stop(h, path);
    expect(h.get().canRetry).toBe(true);
    act(() => h.get().retry());
    await settle();
    expect(h.get().error).toContain("[mic-unexpected]");
    expect(h.get().canRetry).toBe(false);
    expect(h.get().recording?.parts.map((p) => p.blob.size)).toEqual([1000]);
    expect(h.get().phase).toBe("idle");
    h.unmount();
  });
});

describe("the field's live-word span", () => {
  beforeEach(() => install("recogniser"));

  it("keeps the superseded session's rough words outside the new session's replacement span", async () => {
    const h = driveField();
    act(() => h.get().toggle());
    await settle();
    const first = recognition();
    act(() => first.onaudiostart?.());
    act(() =>
      first.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: "old rough" } }],
      }),
    );
    expect(h.value()).toBe("Before old rough");
    talk(5000, 1000);

    // Stop, then supersede it before the recogniser's final `onend` arrives.
    act(() => h.get().toggle());
    h.box.setSelectionRange(h.value().length, h.value().length);
    act(() => h.get().toggle());
    act(() =>
      first.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: "stale phrase" } }],
      }),
    );
    act(() => first.onend?.());
    await settle();

    const second = recognition();
    act(() => second.onaudiostart?.());
    act(() =>
      second.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: "new rough" } }],
      }),
    );
    talk(5000, 2000);
    act(() => h.get().toggle());
    act(() => second.onend?.());
    await settle();
    expect(calls).toHaveLength(1);
    await answer(0, ok("NEW FINAL"));
    expect(h.value()).toBe("Before old rough NEW FINAL");
    h.unmount();
  });

  it("continues after a device change at the end of the words already kept", async () => {
    const h = driveField();
    act(() => h.get().toggle());
    await settle();
    const first = recognition();
    act(() => first.onaudiostart?.());
    act(() =>
      first.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: "old rough" } }],
      }),
    );
    expect(h.value()).toBe("Before old rough");

    act(() => h.get().dictation.chooseDevice("another-mic"));
    await settle();
    const second = recognition();
    act(() => second.onaudiostart?.());
    act(() =>
      second.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: "new rough" } }],
      }),
    );
    talk(5000, 2000);
    act(() => h.get().toggle());
    act(() => second.onend?.());
    await settle();
    expect(calls).toHaveLength(1);
    await answer(0, ok("NEW FINAL"));
    expect(h.value()).toBe("Before old rough NEW FINAL");
    h.unmount();
  });
});
