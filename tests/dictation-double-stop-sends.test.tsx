// @vitest-environment jsdom
/**
 * **A double press on Stop also sends.** Greg, spya-rp8676, 2026-10-04:
 * *"if I'm in a feedback report and I double click the stop button, then it
 * should also click send afterwards for me."*
 * docs/plans/261005a-dictation-double-press-on-stop-also-sends.md.
 *
 * **The Stop press is held, not followed by a window** (plan
 * docs/plans/261011y-dictation-short-recordings-and-a-double-press-that-lands.md,
 * Part 2). On a box with a done action a Stop press waits `DOUBLE_PRESS_MS`
 * before it stops anything, and nothing on screen changes meanwhile; a second
 * press inside that time stops at once and sends once the real words are in.
 * Greg, spya-j5h3cb: *"as soon as I click the first of the two double-click
 * clicks, it automatically kind of changes the UI"*.
 *
 * Two halves, tested apart because they fail apart:
 *
 * - **the field** decides whether a press is a second press, when the
 *   microphone actually stops, and sends only once the real transcript is in
 *   the box, and only for what the box was about;
 * - **the button** must still be Stop, and still have the focus, when the
 *   second press comes.
 *
 * `useDictation` is stubbed, so each ending is driven by hand through the
 * options the field gave it: `onTranscript`, then `onEnd`, in the order the
 * real hook calls them. The stub's `toggle` turns the microphone off when it
 * is on and on when it is off, as the real one does, and counts.
 */
import { act, createElement, Fragment, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseDictationField } from "../src/web/useDictationField.js";

interface Options {
  onText(text: string): void;
  onTranscript(text: string): boolean | undefined;
  onEnd(): void;
}
const mic = vi.hoisted(() => ({
  armed: false,
  transcribing: false,
  /** The phase while armed; Chromium's recogniser goes back to `opening` after a pause. */
  armedPhase: "listening" as "listening" | "opening",
  toggles: 0,
  endsAt: null as number | null,
  finishNow: null as (() => void) | null,
  options: null as unknown,
}));
vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (options: unknown) => {
    mic.options = options;
    return {
      supported: true,
      armed: mic.armed,
      transcribing: mic.transcribing,
      phase: mic.armed ? mic.armedPhase : mic.transcribing ? "transcribing" : "idle",
      endsAt: mic.endsAt,
      toggle() {
        mic.toggles++;
        if (mic.armed) {
          mic.armed = false;
          mic.transcribing = true;
        } else {
          mic.armed = true;
          mic.transcribing = false;
        }
        mic.finishNow?.();
      },
    };
  },
}));

const { useDictationField, DOUBLE_PRESS_MS } = await import("../src/web/useDictationField.js");
const { DictationButton } = await import("../src/web/DictationStrip.js");
const { helpModeReadingWords } = await import("./helpers/help-words.js");

let host: HTMLDivElement;
let root: Root;
let mounted = true;
let field: UseDictationField | null = null;
/** What `onDone` saw each time it ran: the box's value, and whether it was busy. */
let sent: Array<{ value: string; busy: boolean }> = [];
/** What the box is drawn with; a test changes these and draws again. */
let withDone = true;
let withButton = false;
let doneKey: string | undefined;
/** Frames asked for and not yet drawn: the field puts the focus back in one. */
let frames: FrameRequestCallback[] = [];

function Box() {
  const box = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState("");
  const f: UseDictationField = useDictationField({
    value,
    onChange: setValue,
    box,
    context: null,
    transcribe: async () => {
      throw new Error("not called");
    },
    report: () => {},
    doneKey,
    ...(withDone
      ? {
          onDone: () => {
            sent.push({ value, busy: f.busy });
          },
        }
      : {}),
  });
  field = f;
  const area = createElement("textarea", { key: "box", ref: box, readOnly: f.readOnly, value, onChange() {} });
  if (!withButton) return area;
  return createElement(
    Fragment,
    null,
    area,
    createElement(DictationButton, {
      key: "mic",
      dictation: f.dictation,
      toggle: f.toggle,
      sendingAfter: f.sendingAfter,
      doubleStop: f.doubleStop,
    }),
  );
}

function draw() {
  act(() => root.render(createElement(Box)));
}
function f(): UseDictationField {
  if (!field) throw new Error("the hook did not render");
  return field;
}
function options(): Options {
  return mic.options as Options;
}
/** Draw the frames asked for so far, as the browser would on its next paint. */
function paint() {
  const due = frames;
  frames = [];
  act(() => {
    for (const frame of due) frame(0);
  });
}

/** Start a dictation: one press, and the microphone is on. */
function start() {
  act(() => f().toggle());
  draw();
  expect(mic.armed).toBe(true);
}
/** One press on Stop, as the field's toggle takes it. */
function press() {
  act(() => f().toggle());
  draw();
}
/** Stop pressed twice, inside the hold. */
function stopTwice() {
  press();
  press();
}
/** One press on Stop, left alone until the hold runs out. */
function stop() {
  press();
  wait(DOUBLE_PRESS_MS);
  draw();
}
function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
/** The hook's ending, in its real order: the words, the phase, then `onEnd`. */
function end(transcript: string | null) {
  act(() => {
    if (transcript !== null) options().onTranscript(transcript);
    mic.transcribing = false;
    options().onEnd();
  });
  draw();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
  field = null;
  sent = [];
  withDone = true;
  withButton = false;
  doneKey = undefined;
  mic.armed = false;
  mic.transcribing = false;
  mic.armedPhase = "listening";
  mic.toggles = 0;
  mic.endsAt = null;
  mic.finishNow = null;
  draw();
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a single press on Stop, on a box with a done action", () => {
  it("is held for DOUBLE_PRESS_MS, then stops; and sends nothing", () => {
    start();
    const before = mic.toggles;
    press();
    expect(mic.toggles, "held: the microphone is still on").toBe(before);
    expect(f().dictation.armed).toBe(true);
    expect(f().sendingAfter).toBe(false);
    wait(DOUBLE_PRESS_MS - 1);
    expect(mic.toggles, "not before the hold runs out").toBe(before);
    wait(1);
    expect(mic.toggles, "stopped when it does").toBe(before + 1);
    draw();
    expect(f().readOnly, "the words are on their way").toBe(true);
    end("just the words");
    expect(sent).toEqual([]);
    wait(DOUBLE_PRESS_MS * 3);
    expect(mic.toggles, "and nothing more is pressed afterwards").toBe(before + 1);
  });

  it("is not held on a box with no done action: Stop stops at once", () => {
    withDone = false;
    draw();
    expect(f().doubleStop).toBe(false);
    start();
    const before = mic.toggles;
    press();
    expect(mic.toggles).toBe(before + 1);
    expect(f().readOnly).toBe(true);
    /* And a second press is not a second press: the button is disabled now, and
       the field's own toggle starts again only through the hook. */
    wait(DOUBLE_PRESS_MS);
    expect(mic.toggles).toBe(before + 1);
    end("words");
    expect(sent).toEqual([]);
  });
});

describe("a second press on Stop, in the field", () => {
  it("stops at the second press, without waiting, and sends once the transcript has arrived", () => {
    start();
    const before = mic.toggles;
    press();
    expect(mic.toggles).toBe(before);
    press();
    expect(mic.toggles, "stopped at the second press").toBe(before + 1);
    expect(f().sendingAfter, "the reader is told the second press was taken").toBe(true);
    wait(DOUBLE_PRESS_MS * 2);
    expect(mic.toggles, "the hold did not fire as well").toBe(before + 1);
    expect(sent, "not before the words arrive").toEqual([]);

    end("the evidence, not the history");
    expect(sent).toEqual([{ value: "the evidence, not the history", busy: false }]);
    expect(f().sendingAfter).toBe(false);
  });

  it("sends exactly once, however many more renders follow", () => {
    start();
    stopTwice();
    end("once");
    draw();
    draw();
    expect(sent).toHaveLength(1);
  });

  it("is not a second press once the hold has run out", () => {
    start();
    stop();
    expect(f().sendingAfter).toBe(false);
    end("too late");
    expect(sent).toEqual([]);
  });

  /* The real hook delivers no transcript for an empty answer either (`[mic-silent]`,
     `[mic-empty]`): it reaches `onEnd` without `onTranscript`, as here. */
  it("does not send when nothing was transcribed", () => {
    start();
    stopTwice();
    end(null);
    expect(sent, "a failed or empty dictation sends nothing").toEqual([]);
    expect(f().sendingAfter).toBe(false);
  });

  it("does not send when a later retry delivers the words", () => {
    start();
    stopTwice();
    end(null);
    /* Try again, some time later: a second ending of the same dictation. */
    end("the retry's words");
    expect(sent, "the wish to send ended with the failure").toEqual([]);
  });

  it("does not carry a double press over into the next dictation", () => {
    start();
    stopTwice();
    end(null);
    start();
    stop();
    end("the second dictation");
    expect(sent).toEqual([]);
  });

  it("does not send to a different comment or question than the one it was pressed on", () => {
    doneKey = "question-1";
    draw();
    start();
    stopTwice();
    /* The reader moves on while the words are on their way. */
    doneKey = "question-2";
    draw();
    expect(f().sendingAfter, "the strip must stop promising a send that was withdrawn").toBe(false);
    end("an answer to question one");
    expect(sent, "an answer is not sent to a question it was not said to").toEqual([]);
  });

  it("still stops when the target changes during the hold, and sends nothing for either", () => {
    doneKey = "question-1";
    draw();
    start();
    const before = mic.toggles;
    press();

    doneKey = "question-2";
    draw();
    expect(mic.toggles, "still held").toBe(before);
    wait(DOUBLE_PRESS_MS);
    expect(mic.toggles, "the reader pressed Stop: a new key does not withdraw that").toBe(before + 1);
    draw();
    end("an answer to question one");
    expect(sent).toEqual([]);
  });

  it("a second press after the target changed mid-hold stops at once, and sends to neither", () => {
    doneKey = "question-1";
    draw();
    start();
    const before = mic.toggles;
    press();
    doneKey = "question-2";
    draw();
    press();
    expect(mic.toggles, "the second press stops now").toBe(before + 1);
    expect(f().sendingAfter, "the words were said to question one").toBe(false);
    wait(DOUBLE_PRESS_MS);
    expect(mic.toggles, "and the hold does not fire as well").toBe(before + 1);
    end("an answer to question one");
    expect(sent).toEqual([]);
  });

  it("does not revive a withdrawn wish when the same target key returns", () => {
    doneKey = "open";
    draw();
    start();
    stopTwice();

    doneKey = "shut";
    draw();
    doneKey = "open";
    draw();
    end("a report from the earlier opening");

    expect(sent, "closing Feedback withdraws the wish even after it is reopened").toEqual([]);
  });

  it("does not send to a target that changes in the same React batch as the ending", () => {
    doneKey = "question-1";
    draw();
    start();
    stopTwice();

    /* `onEnd` schedules the done action for an effect. A parent can move the
       reused box before that effect runs, in the same batch as the hook's own
       state updates, so the target must be checked again at the effect. */
    act(() => {
      options().onTranscript("an answer to question one");
      mic.transcribing = false;
      options().onEnd();
      doneKey = "question-2";
      root.render(createElement(Box));
    });

    expect(sent, "the deferred action must not use question two's onDone").toEqual([]);
  });

  it("a press after the dictation has ended is an ordinary press", () => {
    start();
    stopTwice();
    end(null);
    const before = mic.toggles;
    act(() => f().toggle());
    expect(mic.toggles, "trying again straight away starts a dictation").toBe(before + 1);
    expect(mic.armed).toBe(true);
    expect(sent).toEqual([]);
  });
});

describe("what the hold survives, and what ends it", () => {
  it("does not press Stop at expiry once the cap has passed during the hold", () => {
    start();
    mic.endsAt = Date.now() + 100;
    draw();
    const before = mic.toggles;
    press();
    expect(mic.toggles, "held: the cap has not passed yet").toBe(before);
    /* The cap stops the session itself; this render, and the latest one the
       hold reads, still says `armed`. A toggle here would reach the hook's
       start branch. */
    wait(DOUBLE_PRESS_MS);
    expect(mic.toggles, "the expiry must not press the hook past the cap").toBe(before);
  });

  it("is not withdrawn when the recogniser goes back to opening during it", () => {
    start();
    const before = mic.toggles;
    press();
    /* Chromium's recogniser restarts after a pause: armed, phase `opening`. */
    mic.armedPhase = "opening";
    draw();
    mic.armedPhase = "listening";
    draw();
    expect(mic.toggles).toBe(before);
    wait(DOUBLE_PRESS_MS);
    expect(mic.toggles, "the microphone must not be left on").toBe(before + 1);
  });

  it("presses nothing after the box has gone", () => {
    start();
    const before = mic.toggles;
    press();
    frames = [];
    act(() => root.unmount());
    mounted = false;
    expect(() => wait(DOUBLE_PRESS_MS * 2)).not.toThrow();
    expect(mic.toggles).toBe(before);
    expect(frames, "nor asks for a frame to focus a box that has gone").toEqual([]);
  });

  it("is taken by the box's own Send: stops now, sends after the words, and the hold never fires", () => {
    start();
    const before = mic.toggles;
    press();
    act(() => f().finishThenDone());
    expect(mic.toggles, "stopped by Send, at once").toBe(before + 1);
    expect(f().sendingAfter).toBe(true);
    draw();
    wait(DOUBLE_PRESS_MS * 2);
    expect(mic.toggles, "the held Stop did not toggle a second time").toBe(before + 1);
    end("sent by the button");
    expect(sent).toEqual([{ value: "sent by the button", busy: false }]);
  });
});

describe("the box's done action while dictation is involved", () => {
  it("records the wish before a synchronous ending", () => {
    start();
    mic.finishNow = () => {
      options().onTranscript("synchronous words");
      mic.transcribing = false;
      options().onEnd();
    };

    act(() => f().finishThenDone());

    expect(sent).toEqual([{ value: "synchronous words", busy: false }]);
  });

  it("does not toggle into a new session after the cap has already stopped this one", () => {
    start();
    mic.endsAt = Date.now();
    draw();
    const before = mic.toggles;

    act(() => f().finishThenDone());

    expect(mic.toggles, "the stale armed render reached the hook's start branch").toBe(before);
    expect(f().sendingAfter).toBe(true);
    act(() => {
      options().onTranscript("words stopped by the cap");
      mic.armed = false;
      options().onEnd();
    });
    expect(sent).toEqual([{ value: "words stopped by the cap", busy: false }]);
  });
});

describe("the button, between the two presses", () => {
  function button(): HTMLButtonElement {
    const el = host.querySelector("button");
    if (!el) throw new Error("no button");
    return el;
  }
  const textarea = () => host.querySelector("textarea");

  it("stays Stop, keeps the focus, and takes a second keyboard press", () => {
    withButton = true;
    draw();
    act(() => button().click());
    draw();
    paint();
    expect(mic.armed).toBe(true);

    /* Enter or Space on a focused button is a click on it. */
    act(() => button().focus());
    act(() => button().click());
    paint();
    expect(button().getAttribute("aria-label"), "nothing changes on the first press").toBe("Stop dictating");
    expect(button().disabled).toBe(false);
    expect(document.activeElement, "the focus stays on the button for the second press").toBe(button());

    act(() => button().click());
    draw();
    paint();
    expect(mic.armed, "stopped at the second press").toBe(false);
    expect(document.activeElement, "and the focus goes back to the box").toBe(textarea());
    end("said by keyboard");
    expect(sent).toEqual([{ value: "said by keyboard", busy: false }]);
  });

  it("puts the focus back in the box when a single press's hold runs out", () => {
    withButton = true;
    draw();
    act(() => button().click());
    draw();
    paint();
    act(() => button().focus());
    act(() => button().click());
    paint();
    expect(document.activeElement).toBe(button());
    wait(DOUBLE_PRESS_MS);
    draw();
    paint();
    expect(document.activeElement).toBe(textarea());
  });

  it("is disabled while the words are on their way, and says that it will send once a second press was taken", () => {
    withButton = true;
    draw();
    act(() => button().click());
    draw();
    act(() => button().click());
    act(() => button().click());
    draw();
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-label")).toMatch(/then sending/);
  });

  it("is disabled while the words are on their way after a single press", () => {
    withButton = true;
    draw();
    act(() => button().click());
    draw();
    act(() => button().click());
    wait(DOUBLE_PRESS_MS);
    draw();
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-label")).toBe("Turning your words into text");
  });
});

describe("the reader's help", () => {
  it("names every box where double Stop sends", () => {
    /* The words of Chat's Help page from "Reading it" on, where the boxes are named. */
    const words = helpModeReadingWords("chat");
    expect(words).toMatch(/Feedback/);
    expect(words).toMatch(/follow-up/);
    expect(words).toMatch(/quiz answer/);
    expect(words).toMatch(/annotate a passage/);
  });
});
