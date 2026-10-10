// @vitest-environment jsdom
/**
 * The double-Stop promise across the real `useDictation` boundary. The focused
 * field tests stub that hook so they can enumerate policy cheaply; this one
 * pins the ordering the policy depends on: transcript, idle, then `onEnd`.
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

describe("double Stop over the real dictation hook", () => {
  it("sends the landed transcript once, while a failed ending and its retry send nothing", async () => {
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
    const stopTwice = async () => {
      clock += 3000;
      act(() => recorder().emit(300));
      act(() => get().toggle());
      expect(get().again, "the second press is live while the transcript is pending").toBeDefined();
      act(() => get().again?.());
      await settle();
    };
    const answer = async (index: number, result: TranscriptionResult) => {
      const call = calls[index];
      if (!call) throw new Error(`transcription ${index} did not start`);
      act(() => call.answer(result));
      await settle();
    };

    act(() => root.render(createElement(Box)));

    await start();
    await stopTwice();
    await answer(0, ok("the words in the box"));
    expect(sent).toEqual([{ value: "the words in the box", busy: false }]);

    await start();
    await stopTwice();
    await answer(1, failed);
    expect(sent, "a failed ending does not honour the send wish").toHaveLength(1);
    expect(get().dictation.canRetry).toBe(true);

    act(() => get().dictation.retry());
    await settle();
    await answer(2, ok("only after retry"));
    expect(shown).toContain("only after retry");
    expect(sent, "Try again is a later ending, not the ending double-pressed").toHaveLength(1);

    const recorders = FakeRecorder.instances.length;
    act(() => get().toggle());
    await settle();
    expect(get().dictation.phase, "the next press starts a new dictation").toBe("listening");
    expect(FakeRecorder.instances).toHaveLength(recorders + 1);
    expect(sent, "the retry did not inherit the old Stop press").toHaveLength(1);
  });
});
