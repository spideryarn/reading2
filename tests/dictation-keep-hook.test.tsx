// @vitest-environment jsdom
/**
 * **What the hook tells its keeper, and what it does with a recording one hands
 * back.** docs/plans/260929h-dictation-that-survives-a-closed-tab.md.
 *
 * The keeper itself is tests/dictation-keep.test.ts. This pins the other half:
 * that every way a dictation ends reaches the device copy the right way round —
 * **forgotten** only once its words are in the box or the reader threw it away,
 * **released** (left for next time) whenever the page lets go without that —
 * and that a recovered tape becomes the ordinary failed-recording row, whose
 * Try again puts the words in the box.
 *
 * The no-recogniser path (Safari, Firefox) throughout: the keeper hangs off the
 * tape, which both paths share, and this path has no `onend` to choreograph.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMicrophoneLock } from "../src/web/mic-lock.js";
import type {
  DictationKeeper,
  KeptTape,
  RecoveredTape,
  TranscriptionResult,
} from "../src/web/transcriber.js";
import { useDictation } from "../src/web/useDictation.js";

/* ------------------------------------------------------------- the fakes -- */

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
  constructor() {
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    setTimeout(() => this.onstop?.(), 0);
  }
  emit(bytes: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
}

function recorder(): FakeRecorder {
  const r = FakeRecorder.instances.at(-1);
  if (!r) throw new Error("no recorder was built");
  return r;
}

interface Call {
  where: unknown;
  answer(r: TranscriptionResult): void;
}
let calls: Call[] = [];
const transcribe = (_blob: Blob, _mime: string, where: unknown, signal?: AbortSignal) =>
  new Promise<TranscriptionResult>((resolve) => {
    signal?.addEventListener("abort", () =>
      resolve({ ok: false, abandoned: true, message: "aborted", retryable: false }),
    );
    calls.push({ where, answer: resolve });
  });
const ok = (text: string): TranscriptionResult => ({ ok: true, text });
const offline: TranscriptionResult = {
  ok: false,
  message: "We couldn't reach the server to transcribe that. [mic-offline]",
  retryable: true,
};
const refused: TranscriptionResult = {
  ok: false,
  message: "This browser recorded audio in a format we can't transcribe. [mic-format]",
  retryable: false,
};

/** One kept tape, as a log of what it was told. */
interface Log {
  where: unknown;
  chunks: number;
  broken: boolean;
  complete: boolean;
  forgot: boolean;
  released: boolean;
}
function fakeTape(log: Log): KeptTape {
  return {
    chunk: () => {
      log.chunks++;
    },
    broken: () => {
      log.broken = true;
    },
    complete: () => {
      log.complete = true;
    },
    intact: () => !log.forgot && !log.released,
    forget: () => {
      log.forgot = true;
    },
    release: () => {
      log.released = true;
    },
  };
}
let tapes: Log[] = [];
let waiting: RecoveredTape<unknown> | null = null;
let recovered: Log | null = null;
const keeper = (box = "feedback"): DictationKeeper<unknown> => ({
  box,
  begin(where) {
    const log: Log = { where, chunks: 0, broken: false, complete: false, forgot: false, released: false };
    tapes.push(log);
    return fakeTape(log);
  },
  async recover() {
    const found = waiting;
    waiting = null;
    return found;
  },
});
/** A tape an earlier page left behind, to be handed to the next `recover()`. */
function leftBehind(opts: { complete?: boolean; broken?: boolean } = {}) {
  recovered = { where: null, chunks: 0, broken: false, complete: false, forgot: false, released: false };
  waiting = {
    tape: fakeTape(recovered),
    where: { kind: "article", slug: "spoken-about" },
    startedAt: Date.now() - 60_000,
    parts: [{ blob: new Blob([new Uint8Array(3000)]), mimeType: "audio/webm", ms: 90_000 }],
    broken: opts.broken ?? false,
    complete: opts.complete ?? true,
  };
}
function tape(): Log {
  const t = tapes.at(-1);
  if (!t) throw new Error("nothing was kept");
  return t;
}

let clock = 0;

beforeEach(() => {
  resetMicrophoneLock();
  FakeRecorder.instances = [];
  calls = [];
  tapes = [];
  waiting = null;
  recovered = null;
  clock = 0;
  const base = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => base + clock);
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
  vi.stubGlobal("SpeechRecognition", undefined);
  vi.stubGlobal("webkitSpeechRecognition", undefined);
  delete (navigator as { userAgentData?: unknown }).userAgentData;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => {
        const track = { readyState: "live", addEventListener: () => {}, removeEventListener: () => {}, stop: () => {} };
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      },
    },
  });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/* ----------------------------------------------------------- the harness -- */

function drive(opts: { keep?: DictationKeeper<unknown>; accepts?: boolean } = {}) {
  const transcripts: string[] = [];
  let state: ReturnType<typeof useDictation> | null = null;
  const keep = opts.keep ?? keeper();
  function Probe(): ReactNode {
    state = useDictation({
      onText: () => {},
      onTranscript: (t) => {
        transcripts.push(t);
        return opts.accepts ?? true;
      },
      context: { kind: "profile" },
      transcribe,
      keep,
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
    get: () => {
      if (!state) throw new Error("the hook never rendered");
      return state;
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

async function press(h: ReturnType<typeof drive>) {
  act(() => h.get().toggle());
  await settle();
  expect(h.get().phase).toBe("listening");
}

function talk(ms: number, bytes: number) {
  clock += ms;
  act(() => recorder().emit(bytes));
}

async function stop(h: ReturnType<typeof drive>) {
  act(() => h.get().toggle());
  await settle();
}

async function answer(r: TranscriptionResult) {
  const call = calls.at(-1);
  if (!call) throw new Error("nothing was sent");
  await act(async () => call.answer(r));
  await settle();
}

/* ------------------------------------------------------------- the tests -- */

describe("the hook tells its keeper", () => {
  it("every chunk, and forgets the tape once the words are in the box", async () => {
    const h = drive();
    await press(h);
    expect(tapes).toHaveLength(0); // nothing recorded, nothing kept
    talk(1000, 100);
    talk(1000, 100);
    talk(1000, 100);
    expect(tape().chunks).toBe(3);
    expect(tape().where).toEqual({ kind: "profile" });
    await stop(h);
    expect(tape().complete).toBe(true);
    await answer(ok("hello there"));
    expect(h.transcripts).toEqual(["hello there"]);
    expect(tape()).toMatchObject({ forgot: true, released: false });
  });

  it("keeps it through a failed upload, says so, and forgets it when Retry lands", async () => {
    const h = drive();
    await press(h);
    talk(3000, 300);
    await stop(h);
    await answer(offline);
    expect(tape()).toMatchObject({ forgot: false, released: false });
    expect(h.get().keptOnDevice).toBe(true);
    expect(h.get().canRetry).toBe(true);
    act(() => h.get().retry());
    await settle();
    await answer(ok("second time lucky"));
    expect(h.transcripts).toEqual(["second time lucky"]);
    expect(tape().forgot).toBe(true);
    expect(h.get().keptOnDevice).toBe(false);
  });

  it("does not say the audio is kept when the keeper's writes failed", async () => {
    const failing: DictationKeeper<unknown> = {
      ...keeper(),
      begin: (where) => ({ ...keeper().begin(where)!, intact: () => false }),
    };
    const h = drive({ keep: failing });
    await press(h);
    talk(3000, 300);
    await stop(h);
    await answer(offline);
    expect(h.get().recording).not.toBeNull();
    expect(h.get().keptOnDevice).toBe(false);
  });

  it("forgets it when the reader discards the recording", async () => {
    const h = drive();
    await press(h);
    talk(3000, 300);
    await stop(h);
    await answer(offline);
    act(() => h.get().clearRecording());
    expect(tape().forgot).toBe(true);
  });

  it("marks a recording the server refused for good as save-only", async () => {
    const h = drive();
    await press(h);
    talk(3000, 300);
    await stop(h);
    await answer(refused);
    expect(tape()).toMatchObject({ broken: true, forgot: false });
  });

  it("releases, not forgets, when the page goes mid-sentence", async () => {
    const h = drive();
    await press(h);
    talk(3000, 300);
    h.unmount();
    await settle();
    expect(tape()).toMatchObject({ forgot: false, released: true, complete: false });
  });

  it("releases a failed recording when the page goes, rather than forgetting it", async () => {
    const h = drive();
    await press(h);
    talk(3000, 300);
    await stop(h);
    await answer(offline);
    h.unmount();
    expect(tape()).toMatchObject({ forgot: false, released: true });
  });

  it("releases the last recording when the reader presses again, to be offered next time", async () => {
    const h = drive();
    await press(h);
    talk(3000, 300);
    await stop(h);
    await answer(offline);
    const first = tape();
    await press(h);
    expect(first).toMatchObject({ forgot: false, released: true });
  });

  it("forgets a dictation too short to transcribe", async () => {
    const h = drive();
    await press(h);
    talk(500, 50);
    await stop(h);
    expect(tape().forgot).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("does not forget words the box refused to take", async () => {
    const h = drive({ accepts: false });
    await press(h);
    talk(3000, 300);
    await stop(h);
    await answer(ok("nowhere to go"));
    expect(tape()).toMatchObject({ forgot: false, released: true });
  });
});

describe("a recording an earlier page left behind", () => {
  it("is offered on mount, and Try again transcribes it against where it was going", async () => {
    leftBehind();
    const h = drive();
    await settle();
    expect(h.get().error).toContain("[mic-recovered]");
    expect(h.get().recording?.parts).toHaveLength(1);
    expect(h.get().canRetry).toBe(true);
    expect(h.get().keptOnDevice).toBe(true);
    act(() => h.get().retry());
    await settle();
    expect(calls.at(-1)?.where).toEqual({ kind: "article", slug: "spoken-about" });
    await answer(ok("recovered words"));
    expect(h.transcripts).toEqual(["recovered words"]);
    expect(recovered?.forgot).toBe(true);
  });

  it("does not claim nothing was lost when that page died mid-sentence", async () => {
    leftBehind({ complete: false });
    const h = drive();
    await settle();
    expect(h.get().error).toContain("[mic-cut-off]");
    expect(h.get().canRetry).toBe(true);
  });

  it("is offered to save only when it broke", async () => {
    leftBehind({ broken: true });
    const h = drive();
    await settle();
    expect(h.get().recording).not.toBeNull();
    expect(h.get().canRetry).toBe(false);
  });

  it("is let go, not shown, when the reader is already dictating", async () => {
    let hand: ((v: RecoveredTape<unknown> | null) => void) | null = null;
    const slow: DictationKeeper<unknown> = {
      ...keeper(),
      recover: () =>
        new Promise((r) => {
          hand = r;
        }),
    };
    const h = drive({ keep: slow });
    await press(h);
    leftBehind();
    await act(async () => hand?.(waiting));
    await settle();
    expect(recovered).toMatchObject({ released: true, forgot: false });
    expect(h.get().recording).toBeNull();
  });

  it("is let go when the box unmounts before the recovery lands", async () => {
    let hand: ((v: RecoveredTape<unknown> | null) => void) | null = null;
    const slow: DictationKeeper<unknown> = {
      ...keeper(),
      recover: () =>
        new Promise((r) => {
          hand = r;
        }),
    };
    const h = drive({ keep: slow });
    h.unmount();
    leftBehind();
    await act(async () => hand?.(waiting));
    expect(recovered).toMatchObject({ released: true, forgot: false });
  });
});
