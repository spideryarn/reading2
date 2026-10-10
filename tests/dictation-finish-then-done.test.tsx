// @vitest-environment jsdom
/**
 * **The box's own done action, asked for while the microphone is involved**
 * (`finishThenDone`), and a second press on Stop that arrives after a fast
 * ending, across the real `useDictation` boundary. Plan
 * docs/plans/261010f-feedback-dialog-send-after-dictation-and-a-saved-draft.md,
 * reports spya-t9qu3v and spya-exhqqr: Send pressed while the microphone was on
 * did nothing at all. The harness is dictation-double-stop-sends-real-hook's.
 */
import { act, createElement, type ReactNode, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMicrophoneLock } from "../src/web/mic-lock.js";
import type { TranscriptionResult } from "../src/web/transcriber.js";
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


const DOUBLE_PRESS_MS = 600;

function harness() {
  let field: UseDictationField | null = null;
  let shown = "";
  const sent: Array<{ value: string; busy: boolean }> = [];

  function Box(): ReactNode {
    const [value, setValue] = useState("");
    const box = useRef<HTMLTextAreaElement>(null);
    shown = value;
    const current = useDictationField({
      value,
      onChange: setValue,
      onDone: () => sent.push({ value, busy: current.busy }),
      box,
      context: { kind: "profile" },
      transcribe,
    });
    field = current;
    return createElement("textarea", { ref: box, value, readOnly: current.readOnly, onChange() {} });
  }
  const get = (): UseDictationField => {
    if (!field) throw new Error("field did not render");
    return field;
  };
  const recorder = (): FakeRecorder => {
    const current = FakeRecorder.instances.at(-1);
    if (!current) throw new Error("recorder did not start");
    return current;
  };
  const start = async () => {
    act(() => get().toggle());
    await settle();
    expect(get().dictation.phase).toBe("listening");
  };
  const answer = async (index: number, result: TranscriptionResult) => {
    const call = calls[index];
    if (!call) throw new Error(`transcription ${index} did not start`);
    act(() => call.answer(result));
    await settle();
  };
  act(() => root.render(createElement(Box)));
  return { get, recorder, start, answer, sent, shown: () => shown };
}

describe("finishThenDone: the done action, pressed while the microphone is involved", () => {
  it("while listening, stops the microphone and runs the done action once the words land", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().finishThenDone());
    await settle();
    expect(h.get().dictation.armed, "the microphone is off").toBe(false);
    expect(h.get().sendingAfter).toBe(true);
    expect(h.sent, "nothing before the words").toEqual([]);
    await h.answer(0, ok("said, then sent"));
    expect(h.sent).toEqual([{ value: "said, then sent", busy: false }]);
  });

  it("while the words are on their way, runs the done action once they land", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().toggle());
    await settle();
    expect(h.get().readOnly).toBe(true);
    clock += DOUBLE_PRESS_MS + 1;
    act(() => h.get().finishThenDone());
    await h.answer(0, ok("late words"));
    expect(h.sent).toEqual([{ value: "late words", busy: false }]);
  });

  it("runs nothing when the words do not come", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().finishThenDone());
    await settle();
    await h.answer(0, failed);
    expect(h.sent).toEqual([]);
    expect(h.get().busy, "and the box is free to send by hand").toBe(false);
    expect(h.get().sendingAfter).toBe(false);
  });

  it("does nothing on an idle box", async () => {
    const h = harness();
    act(() => h.get().finishThenDone());
    await settle();
    expect(h.sent).toEqual([]);
    expect(h.get().sendingAfter).toBe(false);
    expect(FakeRecorder.instances, "and never starts the microphone").toHaveLength(0);
  });

  it("is withdrawn when the session restarts on another microphone", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().finishThenDone());
    /* The reader picks a different microphone while the words are on their
       way: the hook abandons that session and starts a new one without an
       ending of its own. A wish made for the old one must not send the new. */
    act(() => h.get().dictation.chooseDevice("another-mic"));
    await settle();
    if (h.get().dictation.phase !== "listening") await h.start();
    expect(h.get().sendingAfter, "the promise is gone with its session").toBe(false);
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().toggle());
    await settle();
    const last = calls.length - 1;
    await h.answer(last, ok("words for the new microphone"));
    expect(h.sent).toEqual([]);
  });
});

describe("a second press after a fast ending", () => {
  it("sends when the ending already delivered words, and never starts the microphone", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().toggle());
    await settle();
    /* The words arrive inside the double-press window. */
    await h.answer(0, ok("quick words"));
    expect(h.get().dictation.phase).toBe("idle");
    const recorders = FakeRecorder.instances.length;
    clock += 200;
    act(() => h.get().toggle());
    await settle();
    expect(FakeRecorder.instances.length, "no new recording").toBe(recorders);
    expect(h.get().dictation.armed).toBe(false);
    expect(h.sent).toEqual([{ value: "quick words", busy: false }]);
  });

  it("is an ordinary press once the window has passed", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().toggle());
    await settle();
    await h.answer(0, ok("quick words"));
    clock += DOUBLE_PRESS_MS + 1;
    act(() => h.get().toggle());
    await settle();
    expect(h.get().dictation.phase).toBe("listening");
    expect(h.sent).toEqual([]);
  });
});
