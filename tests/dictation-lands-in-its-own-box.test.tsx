// @vitest-environment jsdom
/**
 * **A dictation's words go to the box they were said into, and nowhere else.**
 *
 * The comment dialog and the quiz panel keep one mounted dictation while the
 * reader moves from comment to comment, or question to question, and clear the
 * box on the move. On a browser with no live words there is no span to prove
 * the box still belongs to the dictation, so a transcript arriving after the
 * move used to land in the next comment's box. Now it is offered back on the
 * strip instead, and lands when the reader is back where they said it. Plan
 * docs/plans/261009a-dictation-transcript-lands-in-the-next-box.md
 * (qi-cfrv4spd).
 *
 * The real `useDictation`, on the no-recogniser path (Safari, Firefox)
 * throughout. Harness from tests/dictation-double-stop-sends-real-hook.test.tsx.
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

describe("a dictation lands only in the box it was said into", () => {
  it("is offered back, not put in the next comment's box, when the reader moves on mid-transcription", async () => {
    const h = drive();
    await h.say();
    await h.move("B");
    await h.answer(0, ok("about comment A"));

    expect(h.shown.B, "comment B's box").toBe("");
    expect(h.get().dictation.error).toContain("[mic-moved]");
    expect(h.get().dictation.recording, "the recording is still offered").not.toBeNull();
    expect(h.get().dictation.canRetry).toBe(true);

    /* Try again here is refused the same way, and loses nothing. */
    await h.retry();
    expect(h.shown.B).toBe("");
    expect(h.get().dictation.error).toContain("[mic-moved]");
    expect(h.get().dictation.recording).not.toBeNull();
    expect(h.get().dictation.canRetry).toBe(true);

    /* Back where it was said, Try again puts it there — without paying again. */
    await h.move("A");
    await h.retry();
    expect(h.shown.A).toBe("about comment A");
    expect(calls, "the transcript was kept, not transcribed twice").toHaveLength(1);
    expect(h.get().dictation.error).toBeNull();
  });

  it("does not let a failure's Try again put comment A's words in comment B's box", async () => {
    const h = drive();
    await h.say();
    await h.answer(0, failed);
    expect(h.get().dictation.canRetry).toBe(true);

    /* Pressed in B: nothing is sent, nothing is paid for. */
    await h.move("B");
    await h.retry();
    expect(calls, "no transcription for the wrong box").toHaveLength(1);
    expect(h.shown.B).toBe("");
    expect(h.get().dictation.error).toContain("[mic-moved]");
    expect(h.get().dictation.canRetry).toBe(true);

    await h.move("A");
    await h.retry();
    await h.answer(1, ok("about comment A"));
    expect(h.shown.A).toBe("about comment A");
  });

  it("moves the box while a failure's Try again is on its way, and keeps the words", async () => {
    const h = drive();
    await h.say();
    await h.answer(0, failed);
    await h.retry();
    await h.move("B");
    await h.answer(1, ok("about comment A"));
    expect(h.shown.B).toBe("");
    expect(h.get().dictation.error).toContain("[mic-moved]");

    act(() => h.get().toggle());
    await settle();
    expect(h.get().dictation.phase, "a new press must not erase the retry's only copy").toBe("idle");
    expect(h.get().dictation.error).toContain("[mic-moved-held]");
    expect(h.get().dictation.canRetry).toBe(true);

    await h.move("A");
    await h.retry();
    expect(h.shown.A).toBe("about comment A");
    expect(calls, "the words came back once and were kept").toHaveLength(2);
  });

  it("refuses a new press that would clear words this device could not keep", async () => {
    const h = drive();
    await h.say();
    await h.move("B");
    await h.answer(0, ok("about comment A"));
    expect(h.get().dictation.error).toContain("[mic-moved]");

    act(() => h.get().toggle());
    await settle();
    expect(h.get().dictation.phase, "the microphone did not open").toBe("idle");
    expect(h.get().dictation.error).toContain("[mic-moved-held]");
    expect(h.get().dictation.recording).not.toBeNull();
    expect(h.get().dictation.canRetry).toBe(true);

    /* Discard is the reader letting go; then the microphone is theirs again. */
    act(() => h.get().dictation.clearRecording());
    await h.say();
    await h.answer(1, ok("about comment B"));
    expect(h.shown.B).toBe("about comment B");
  });

  it("a refused press leaves the ended value proof intact, so retry follows an edited box's caret", async () => {
    const h = drive();
    await h.say();
    await h.move("B");
    await h.answer(0, ok("about comment A"));
    await h.move("A");
    h.type("alpha beta");
    const box = host.querySelector("textarea")!;
    box.setSelectionRange(1, 1);
    act(() => h.get().toggle());
    await settle();
    expect(h.get().dictation.error).toContain("[mic-moved-held]");
    box.setSelectionRange(5, 5);
    await h.retry();
    expect(h.shown.A).toBe("alpha about comment A beta");
  });

  it("a refused press leaves focus where the reader put it", async () => {
    const h = drive();
    await h.say();
    await h.move("B");
    await h.answer(0, ok("about comment A"));
    const button = document.createElement("button");
    host.appendChild(button);
    button.focus();
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { f(0); return 1; });
    act(() => h.get().toggle());
    expect(document.activeElement).toBe(button);
  });

  it("keeps Try again, Save and Discard on the strip and explains that saving alone does not unblock Dictate", async () => {
    const h = drive({ showStrip: true });
    await h.say();
    await h.move("B");
    await h.answer(0, ok("about comment A"));
    act(() => h.get().toggle());
    await settle();
    const offered = h.get().dictation.recording;
    const retry = host.querySelector<HTMLButtonElement>(".prof-recording-retry");
    const save = host.querySelector<HTMLButtonElement>(".prof-recording-save");
    const discard = host.querySelector<HTMLButtonElement>(".prof-recording-drop");
    expect(retry?.textContent).toContain("Try again");
    expect(save?.textContent).toContain("Save");
    expect(discard?.getAttribute("aria-label")).toBe("Discard the recording");
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", class extends URL {
      static override createObjectURL() { return "blob:saved"; }
      static override revokeObjectURL() {}
    });
    act(() => save?.click());
    expect(download).toHaveBeenCalledOnce();
    expect(h.get().dictation.recording).toBe(offered);
    expect(host.querySelector(".prof-box-error")?.textContent).toMatch(/discard.*before dictating again/);
    act(() => discard?.click());
    expect(host.querySelector(".prof-recording")).toBeNull();
  });

  it("offers the new box's old tape once the pending dictation and its offer are settled", async () => {
    const old: RecoveredTape<unknown> = {
      tape: {
        chunk() {}, broken() {}, complete() {}, intact: async () => true, forget() {},
        release() { waiting.set("comment:B", old); },
      },
      where: { kind: "profile" }, startedAt: Date.now() - 60_000,
      parts: [{ blob: new Blob([new Uint8Array(3000)]), mimeType: "audio/webm", ms: 5000 }],
      broken: false, complete: true,
    };
    waiting.set("comment:B", old);
    const h = drive();
    await h.say();
    await h.move("B");
    await h.answer(0, ok("about comment A"));
    expect(h.get().dictation.error).toContain("[mic-moved]");
    act(() => h.get().dictation.clearRecording());
    await settle();
    expect(h.get().dictation.error, "recovery must be deferred, not skipped until another navigation").toContain("[mic-recovered]");
    await h.retry();
    await h.answer(1, ok("old words for B"));
    expect(h.shown.B).toBe("old words for B");
  });

  it("on Chromium, does not put a live phrase said into comment A into comment B's box", async () => {
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
      abort() {}
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return true;
      }
    }
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
    Object.defineProperty(navigator, "userAgentData", {
      configurable: true,
      value: { brands: [{ brand: "Chromium", version: "151" }], mobile: false, platform: "macOS" },
    });
    const recogniser = () => {
      const r = recognisers.at(-1);
      if (!r) throw new Error("no recogniser");
      return r;
    };

    const h = drive();
    act(() => h.get().toggle());
    await settle();
    await act(async () => recogniser().onaudiostart?.());
    await h.move("B");
    await act(async () =>
      recogniser().onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "said about A" } }] }),
    );
    expect(h.shown.B, "comment B's box").toBe("");
  });

  it("does not offer comment B's old tape over comment A's words while they are on their way", async () => {
    let released = false;
    waiting.clear();
    waiting.set("comment:B", {
      tape: {
        chunk() {},
        broken() {},
        complete() {},
        intact: async () => true,
        forget() {},
        release() {
          released = true;
        },
      },
      where: { kind: "profile" },
      startedAt: Date.now() - 60_000,
      parts: [{ blob: new Blob([new Uint8Array(3000)]), mimeType: "audio/webm", ms: 5000 }],
      broken: false,
      complete: true,
    });
    const h = drive();
    await h.say();
    await h.move("B");
    expect(h.get().dictation.error, "B's tape waits while A's words are on their way").toBeNull();
    expect(waiting.has("comment:B"), "recovery waits to claim B's tape until the box is idle").toBe(true);
    expect(released).toBe(false);

    await h.answer(0, ok("about comment A"));
    expect(h.get().dictation.error).toContain("[mic-moved]");
    await h.move("A");
    await h.retry();
    expect(h.shown.A).toBe("about comment A");
  });

  it("still lands when the box was merely shut (Feedback, the command bar)", async () => {
    const h = drive();
    await h.say();
    await h.move(null);
    await h.answer(0, ok("said before closing"));
    expect(h.shown.shut).toBe("said before closing");
    expect(h.get().dictation.error).toBeNull();
  });
});
