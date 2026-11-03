// @vitest-environment jsdom
/**
 * **The box's own done action, asked for while the microphone is involved**
 * (`finishThenDone`), and a second press on Stop however fast the transcriber
 * answers, across the real `useDictation` boundary. Plan
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
import { captureHeldStops, type HeldStops } from "./helpers/held-stop.js";

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
let holds: HeldStops;
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
  holds = captureHeldStops();
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


/** `refuse`: the box's done action turns down whatever lands, as a too-long answer is. */
function harness({ refuse = false }: { refuse?: boolean } = {}) {
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
      onDone: (): boolean => {
        if (refuse) return false;
        sent.push({ value, busy: current.busy });
        return true;
      },
      box,
      context: { kind: "profile" },
      transcribe,
      report: () => {},
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
    act(() => holds.expire());
    await settle();
    expect(h.get().readOnly).toBe(true);
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
    act(() => holds.expire());
    await settle();
    const last = calls.length - 1;
    await h.answer(last, ok("words for the new microphone"));
    expect(h.sent).toEqual([]);
  });
});

/* **There is no fast ending to land on any more.** A second press used to be
   counted *after* Stop, and words back inside that window put the button back
   to Dictate before the second press arrived (plan 261010f, item 2, patched
   it; plan 261011y removed the window). Now the Stop is held and the second
   press lands on it, so the transcriber's speed cannot come between them. */
describe("a second press, however fast the words come back", () => {
  it("stops at the second press and sends the quick words once, never starting the microphone", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().toggle());
    expect(h.get().dictation.armed, "held: still listening after the first press").toBe(true);
    act(() => h.get().toggle());
    expect(holds.pending(), "the second press took the hold").toBe(0);
    await settle();
    expect(h.get().dictation.armed).toBe(false);
    await h.answer(0, ok("quick words"));
    expect(h.get().dictation.phase).toBe("idle");
    expect(FakeRecorder.instances, "no new recording").toHaveLength(1);
    expect(h.sent).toEqual([{ value: "quick words", busy: false }]);
  });

  it("after a single Stop has run its course, a press is an ordinary press", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().toggle());
    act(() => holds.expire());
    await settle();
    await h.answer(0, ok("quick words"));
    act(() => h.get().toggle());
    await settle();
    expect(h.get().dictation.phase).toBe("listening");
    expect(h.sent).toEqual([]);
  });
});

/* **`submit`: the one way a box's Send, Enter and form submit reach the done
   action** (report spya-gjcyq3, plan 261103b). Idle, it is the done action;
   while the microphone is involved, it is `finishThenDone`. And when a press
   was made and nothing could be sent, the field says so (`unsent`). */
describe("submit: Send pressed, whatever the microphone is doing", () => {
  it("on an idle box, runs the done action at once", async () => {
    const h = harness();
    act(() => h.get().submit());
    expect(h.sent).toEqual([{ value: "", busy: false }]);
    expect(FakeRecorder.instances).toHaveLength(0);
  });

  it("while listening, stops the microphone and sends the words once they land", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().submit());
    await settle();
    expect(h.get().dictation.armed).toBe(false);
    expect(h.get().sendingAfter).toBe(true);
    expect(h.sent).toEqual([]);
    await h.answer(0, ok("pressed send mid-sentence"));
    expect(h.sent).toEqual([{ value: "pressed send mid-sentence", busy: false }]);
  });

  it("a second press while the words are on their way still sends once", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().submit());
    await settle();
    act(() => h.get().submit());
    act(() => h.get().submit());
    await settle();
    expect(calls).toHaveLength(1);
    await h.answer(0, ok("once"));
    expect(h.sent).toEqual([{ value: "once", busy: false }]);
  });

  it("Stop pressed first, then Send inside the hold: one send, the hold taken", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().toggle());
    act(() => h.get().submit());
    expect(holds.pending(), "Send took the held Stop").toBe(0);
    await settle();
    await h.answer(0, ok("stopped then sent"));
    expect(h.sent).toEqual([{ value: "stopped then sent", busy: false }]);
  });

  it("Stop pressed and run its course, then Send while transcribing: sends when the words land", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().toggle());
    act(() => holds.expire());
    await settle();
    act(() => h.get().submit());
    await h.answer(0, ok("late send"));
    expect(h.sent).toEqual([{ value: "late send", busy: false }]);
  });

  it("when the words do not come, sends nothing and says nothing was sent", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().submit());
    await settle();
    expect(h.get().unsent).toBe(false);
    await h.answer(0, failed);
    expect(h.sent).toEqual([]);
    expect(h.get().unsent).toBe(true);
  });

  it("a Try again that lands clears the notice and still sends nothing by itself", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().submit());
    await settle();
    await h.answer(0, failed);
    expect(h.get().unsent).toBe(true);
    act(() => h.get().dictation.retry());
    await settle();
    await h.answer(1, ok("second time lucky"));
    expect(h.shown()).toBe("second time lucky");
    expect(h.get().unsent).toBe(false);
    expect(h.sent, "the reader presses Send for these").toEqual([]);
  });

  it("Send pressed during a Try again that fails: nothing sent then, nor by a later Try again (Sol's plan review, P1)", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().toggle());
    act(() => holds.expire());
    await settle();
    await h.answer(0, failed);
    act(() => h.get().dictation.retry());
    await settle();
    expect(h.get().readOnly, "the retry is on its way").toBe(true);
    act(() => h.get().submit());
    await h.answer(1, failed);
    expect(h.sent).toEqual([]);
    expect(h.get().unsent, "the press is owed an answer").toBe(true);
    expect(h.get().sendingAfter).toBe(false);
    act(() => h.get().dictation.retry());
    await settle();
    await h.answer(2, ok("third time"));
    expect(h.shown()).toBe("third time");
    expect(h.sent, "a Try again sends nothing by itself").toEqual([]);
  });

  it("the notice goes when a new dictation starts", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().submit());
    await settle();
    await h.answer(0, failed);
    expect(h.get().unsent).toBe(true);
    act(() => h.get().dictation.clearRecording());
    await h.start();
    expect(h.get().unsent).toBe(false);
  });

  it("words that land and are refused by the box say nothing was sent (Sol's code review, F1)", async () => {
    const h = harness({ refuse: true });
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().submit());
    await settle();
    await h.answer(0, ok("far too long an answer"));
    expect(h.shown()).toBe("far too long an answer");
    expect(h.sent).toEqual([]);
    expect(h.get().unsent).toBe(true);
  });

  it("a plain Stop that fails says nothing about sending", async () => {
    const h = harness();
    await h.start();
    clock += 3000;
    act(() => h.recorder().emit(300));
    act(() => h.get().toggle());
    act(() => holds.expire());
    await settle();
    await h.answer(0, failed);
    expect(h.get().unsent).toBe(false);
  });
});
