// @vitest-environment jsdom
/**
 * **On Chromium, Try again replaces the rough live words, as a first try does.**
 *
 * The recogniser's guesses go into the box while the reader talks, and the
 * real transcript replaces them. When the transcription failed, the field had
 * already let go of where those guesses were, so a Try again could only insert
 * beside them and the box would hold the sentence twice. To avoid that, the
 * hook offered no Try again at all once a guess was in the box — so on Chrome a
 * failed dictation was the rough words and an audio file to save. Now the
 * field remembers the failed session's words, and Try again replaces them while
 * they are still there. Queue item qi-qxkryezr, question q-tqdnp8.
 *
 * The real `useDictation` and `useDictationField`, with a fake recogniser.
 * Harness from tests/dictation-lands-in-its-own-box.test.tsx.
 */
import { act, createElement, type ReactNode, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMicrophoneLock } from "../src/web/mic-lock.js";
import type { DictationKeeper, RecoveredTape, TranscriptionResult } from "../src/web/transcriber.js";
import { DictationStrip } from "../src/web/DictationStrip.js";
import { useDictationField, type UseDictationField } from "../src/web/useDictationField.js";

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported(type: string) {
    return type.startsWith("audio/webm");
  }
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
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

interface Call {
  answer(result: TranscriptionResult): void;
}
let calls: Call[] = [];
const transcribe = () =>
  new Promise<TranscriptionResult>((resolve) => {
    calls.push({ answer: resolve });
  });
const ok = (text: string): TranscriptionResult => ({ ok: true, text });
const failed: TranscriptionResult = {
  ok: false,
  message: "We couldn't reach the server to transcribe that. [mic-offline]",
  retryable: true,
};

let clock = 0;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetMicrophoneLock();
  FakeRecorder.instances = [];
  calls = [];
  waiting.clear();
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
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 10; i++) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

/** A tape an earlier page left in a box, waiting to be recovered, by box name. */
const waiting = new Map<string, RecoveredTape<unknown>>();
/**
 * A keeper that names its box and cannot keep: the in-memory copy is the only
 * one. It can hand back a tape left in `waiting`.
 */
const keeper = (box: string): DictationKeeper<unknown> => ({
  box,
  begin: () => null,
  recover: async () => {
    const found = waiting.get(box) ?? null;
    waiting.delete(box);
    return found;
  },
});

/**
 * One box reused across targets, as CommentDialog and QuizPanel reuse theirs:
 * the keeper is named for the target, and a move clears the box. `null` is a
 * shut box with no keeper (Feedback, the command bar).
 */
function drive(options: { keep?: (box: string) => DictationKeeper<unknown>; showStrip?: boolean } = {}) {
  let field: UseDictationField | null = null;
  let edit: (text: string) => void = () => {};
  const shown: Record<string, string> = {};
  function Box({ target }: { target: string | null }): ReactNode {
    const [value, setValue] = useState("");
    edit = setValue;
    const box = useRef<HTMLTextAreaElement>(null);
    shown[target ?? "shut"] = value;
    /* A move clears the box, as the comment dialog's does — except a shut
       box, which keeps what it had (Feedback). */
    useEffect(() => {
      if (target !== null) setValue("");
    }, [target]);
    const f = useDictationField({
      value,
      onChange: setValue,
      box,
      context: { kind: "profile" },
      transcribe,
      report: () => {},
      ...(target !== null && { keep: (options.keep ?? keeper)(`comment:${target}`) }),
    });
    field = f;
    return createElement("div", null,
      createElement("textarea", { ref: box, value, readOnly: f.readOnly, onChange() {} }),
      options.showStrip && createElement(DictationStrip, { dictation: f.dictation }),
    );
  }
  const get = (): UseDictationField => {
    if (!field) throw new Error("field did not render");
    return field;
  };
  const recorder = (): FakeRecorder => {
    const r = FakeRecorder.instances.at(-1);
    if (!r) throw new Error("recorder did not start");
    return r;
  };
  act(() => root.render(createElement(Box, { target: "A" })));
  return {
    get,
    shown,
    type: (text: string) => act(() => edit(text)),
    move: async (target: string | null) => {
      act(() => root.render(createElement(Box, { target })));
      await settle();
    },
    say: async () => {
      act(() => get().toggle());
      await settle();
      expect(get().dictation.phase).toBe("listening");
      clock += 3000;
      act(() => recorder().emit(300));
      act(() => get().toggle());
      await settle();
    },
    answer: async (index: number, result: TranscriptionResult) => {
      const call = calls[index];
      if (!call) throw new Error(`transcription ${index} did not start`);
      act(() => call.answer(result));
      await settle();
    },
    retry: async () => {
      act(() => get().dictation.retry());
      await settle();
    },
  };
}


const recognisers: FakeRecognition[] = [];
class FakeRecognition {
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
    recognisers.push(this);
  }
  start() {}
  stop() {}
  /* The hook's probe waits for the `end` an abort promises. */
  abort() {
    setTimeout(() => this.onend?.(), 0);
  }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}

beforeEach(() => {
  recognisers.length = 0;
  vi.stubGlobal("SpeechRecognition", FakeRecognition);
  vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
  Object.defineProperty(navigator, "userAgentData", {
    configurable: true,
    value: { brands: [{ brand: "Chromium", version: "151" }], mobile: false, platform: "macOS" },
  });
});

const recogniser = (): FakeRecognition => {
  const r = recognisers.at(-1);
  if (!r) throw new Error("no recogniser");
  return r;
};

/** Talk on Chromium: `rough` is what the recogniser confirms, then Stop. */
async function sayRoughly(h: ReturnType<typeof drive>, rough: string) {
  act(() => h.get().toggle());
  await settle();
  expect(h.get().dictation.phase).toBe("listening");
  await act(async () =>
    recogniser().onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: rough } }] }),
  );
  clock += 3000;
  const r = FakeRecorder.instances.at(-1);
  if (!r) throw new Error("recorder did not start");
  act(() => r.emit(300));
  act(() => h.get().toggle());
  await settle();
  await act(async () => recogniser().onend?.());
  await settle();
}

describe("Try again after a failed Chromium transcription", () => {
  it("replaces the rough words rather than adding the transcript beside them", async () => {
    const h = drive();
    await sayRoughly(h, "the rough words");
    await h.answer(0, failed);
    expect(h.shown.A, "the rough words stay while the failure is shown").toBe("the rough words");
    expect(h.get().dictation.canRetry, "Try again is offered").toBe(true);

    await h.retry();
    await h.answer(1, ok("The real words."));
    expect(h.shown.A).toBe("The real words.");
    expect(h.get().dictation.error).toBeNull();
  });

  it("keeps what the reader had typed around them", async () => {
    const h = drive();
    h.type("Before. ");
    await sayRoughly(h, "the rough words");
    await h.answer(0, failed);
    expect(h.shown.A).toBe("Before. the rough words");
    h.type("Before. the rough words And after.");

    await h.retry();
    await h.answer(1, ok("The real words."));
    expect(h.shown.A).toBe("Before. The real words. And after.");
  });

  it("finds the rough words where an edit before them moved them", async () => {
    const h = drive();
    await sayRoughly(h, "the rough words");
    await h.answer(0, failed);
    h.type("Typed first. the rough words");

    await h.retry();
    await h.answer(1, ok("The real words."));
    expect(h.shown.A).toBe("Typed first. The real words.");
  });

  it("does not overwrite rough words the reader has corrected by hand", async () => {
    const h = drive();
    await sayRoughly(h, "the rough words");
    await h.answer(0, failed);
    h.type("the right words");

    await h.retry();
    await h.answer(1, ok("The real words."));
    expect(h.shown.A, "the reader's correction survives").toContain("the right words");
    expect(h.shown.A, "and the transcript still lands").toContain("The real words.");
  });

  it("does not mistake a short phrase the reader typed elsewhere for the rough words", async () => {
    const h = drive();
    await sayRoughly(h, "yes");
    await h.answer(0, failed);
    h.type("I typed yes myself");
    const box = host.querySelector("textarea")!;
    box.setSelectionRange(box.value.length, box.value.length);

    await h.retry();
    await h.answer(1, ok("The real answer."));
    expect(h.shown.A, "the reader's own short phrase survives").toBe(
      "I typed yes myself The real answer.",
    );
  });

  it("does not let a recovered tape replace rough words whose recording was discarded", async () => {
    const h = drive();
    await sayRoughly(h, "the rough words");
    await h.answer(0, failed);
    const old: RecoveredTape<unknown> = {
      tape: {
        chunk() {}, broken() {}, complete() {}, intact: async () => true, forget() {}, release() {},
      },
      where: { kind: "profile" },
      startedAt: Date.now() - 60_000,
      parts: [{ blob: new Blob([new Uint8Array(3000)]), mimeType: "audio/webm", ms: 5000 }],
      broken: false,
      complete: true,
    };
    waiting.set("comment:A", old);
    act(() => h.get().dictation.clearRecording());
    await settle();
    expect(h.get().dictation.error).toContain("[mic-recovered]");
    const box = host.querySelector("textarea")!;
    box.setSelectionRange(box.value.length, box.value.length);

    await h.retry();
    await h.answer(1, ok("Words from the old page."));
    expect(h.shown.A, "discard made the visible rough words ordinary reader text").toBe(
      "the rough words Words from the old page.",
    );
  });

  it("a fresh dictation after the failure does not reach back for the old rough words", async () => {
    const h = drive();
    await sayRoughly(h, "the rough words");
    await h.answer(0, failed);
    /* Pressing the microphone again lets the failed one go. */
    act(() => h.get().dictation.clearRecording());
    await settle();
    await sayRoughly(h, "new rough");
    await h.answer(1, ok("New words."));
    expect(h.shown.A).toBe("the rough words New words.");
  });
});
