// @vitest-environment jsdom
/**
 * **A double press on Stop also sends.** Greg, spya-rp8676, 2026-10-04:
 * *"if I'm in a feedback report and I double click the stop button, then it
 * should also click send afterwards for me."*
 * docs/plans/261005a-dictation-double-press-on-stop-also-sends.md.
 *
 * Two halves, and they are tested apart because they fail apart:
 *
 * - **the field** decides whether a second press counts, and sends only once
 *   the real transcript is in the box, and only for what the box was about;
 * - **the button** has to let the second press arrive at all, which a
 *   `disabled` button never does.
 *
 * `useDictation` is stubbed, so each ending is driven by hand through the
 * options the field gave it: `onTranscript`, then `onEnd`, in the order the
 * real hook calls them.
 */
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseDictation } from "../src/web/useDictation.js";
import type { UseDictationField } from "../src/web/useDictationField.js";

interface Options {
  onText(text: string): void;
  onTranscript(text: string): boolean | undefined;
  onEnd(): void;
}
const mic = vi.hoisted(() => ({
  armed: false,
  transcribing: false,
  toggles: 0,
  endsAt: null as number | null,
  finishNow: null as (() => void) | null,
  options: null as unknown,
}));
vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (options: unknown) => {
    mic.options = options;
    return {
      armed: mic.armed,
      transcribing: mic.transcribing,
      phase: mic.armed ? "listening" : mic.transcribing ? "transcribing" : "idle",
      endsAt: mic.endsAt,
      toggle() {
        mic.toggles++;
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
let field: UseDictationField | null = null;
/** What `onDone` saw each time it ran: the box's value and whether it was busy. */
let sent: Array<{ value: string; busy: boolean }> = [];
/** What the box is drawn with; a test changes these and draws again. */
let withDone = true;
let doneKey: string | undefined;

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
    doneKey,
    ...(withDone ? { onDone: () => sent.push({ value, busy: f.busy }) } : {}),
  });
  field = f;
  return createElement("textarea", { ref: box, readOnly: f.readOnly, value, onChange() {} });
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

/** Start a dictation: one press, and the microphone is on. */
function start() {
  act(() => f().toggle());
  mic.armed = true;
  draw();
}
/** The Stop press: the microphone goes off and the transcript is on its way. */
function stop() {
  act(() => f().toggle());
  mic.armed = false;
  mic.transcribing = true;
  draw();
}
/** The second press, as the button makes it: only if the field offers one. */
function pressAgain(): boolean {
  const again = f().again;
  if (!again) return false;
  act(() => again());
  return true;
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
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  field = null;
  sent = [];
  withDone = true;
  doneKey = undefined;
  mic.armed = false;
  mic.transcribing = false;
  mic.toggles = 0;
  mic.endsAt = null;
  mic.finishNow = null;
  draw();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("a second press on Stop, in the field", () => {
  it("sends once the transcript has arrived, with the new words and not busy", () => {
    start();
    expect(f().again, "nothing to press twice while still talking").toBeUndefined();
    stop();
    wait(200);
    expect(pressAgain()).toBe(true);
    expect(f().sendingAfter, "the reader is told the second press was taken").toBe(true);
    expect(f().again, "taken once; the button has nothing more to do").toBeUndefined();
    expect(sent, "not before the words arrive").toEqual([]);

    end("the evidence, not the history");
    expect(sent).toEqual([{ value: "the evidence, not the history", busy: false }]);
    expect(f().sendingAfter).toBe(false);
  });

  it("sends exactly once, however many more renders follow", () => {
    start();
    stop();
    pressAgain();
    end("once");
    draw();
    draw();
    expect(sent).toHaveLength(1);
  });

  it("does nothing on a single press", () => {
    start();
    stop();
    end("just the words");
    expect(sent).toEqual([]);
  });

  it("stops offering the second press once it is too late to be a double press", () => {
    start();
    stop();
    wait(DOUBLE_PRESS_MS - 1);
    expect(f().again).toBeDefined();
    wait(2);
    expect(f().again, "the button goes back to disabled").toBeUndefined();
    end("too late");
    expect(sent).toEqual([]);
  });

  it("does not send when nothing was transcribed", () => {
    start();
    stop();
    pressAgain();
    end(null);
    expect(sent, "a failed or empty dictation sends nothing").toEqual([]);
    expect(f().sendingAfter).toBe(false);
  });

  it("does not send when a later retry delivers the words", () => {
    start();
    stop();
    pressAgain();
    end(null);
    /* Try again, some time later: a second ending of the same dictation. */
    end("the retry's words");
    expect(sent, "the wish to send ended with the failure").toEqual([]);
  });

  it("does not carry a double press over into the next dictation", () => {
    start();
    stop();
    pressAgain();
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
    stop();
    pressAgain();
    /* The reader moves on while the words are on their way. */
    doneKey = "question-2";
    draw();
    expect(f().sendingAfter, "the strip must stop promising a send that was withdrawn").toBe(false);
    end("an answer to question one");
    expect(sent, "an answer is not sent to a question it was not said to").toEqual([]);
  });

  it("withdraws the second press when the target changes during the window", () => {
    doneKey = "question-1";
    draw();
    start();
    stop();

    doneKey = "question-2";
    draw();

    expect(f().again, "question two must not accept a double press on question one's Stop").toBeUndefined();
    end("an answer to question one");
    expect(sent).toEqual([]);
  });

  it("does not revive a withdrawn wish when the same target key returns", () => {
    doneKey = "open";
    draw();
    start();
    stop();
    pressAgain();

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
    stop();
    pressAgain();

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
    stop();
    end(null);
    const before = mic.toggles;
    expect(f().again).toBeUndefined();
    act(() => f().toggle());
    expect(mic.toggles, "trying again straight away starts a dictation").toBe(before + 1);
    expect(sent).toEqual([]);
  });

  it("a box with no done action never offers a second press", () => {
    withDone = false;
    draw();
    start();
    stop();
    expect(f().again).toBeUndefined();
  });
});

describe("the box's done action while dictation is involved", () => {
  it("records the wish before a synchronous ending", () => {
    start();
    mic.finishNow = () => {
      options().onTranscript("synchronous words");
      mic.armed = false;
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

describe("the button, while the words are on their way", () => {
  const dictation = (over: Partial<UseDictation>): UseDictation =>
    ({ armed: false, transcribing: false, phase: "idle", ...over }) as UseDictation;

  function button(props: { again?: () => void; toggle: () => void; sendingAfter?: boolean }) {
    act(() =>
      root.render(
        createElement(DictationButton, {
          dictation: dictation({ transcribing: true, phase: "transcribing" }),
          ...props,
        }),
      ),
    );
    const el = host.querySelector("button");
    if (!el) throw new Error("no button");
    return el;
  }

  it("is disabled, as it always was, when there is no second press to make", () => {
    const el = button({ toggle: vi.fn() });
    expect(el.disabled).toBe(true);
    expect(el.getAttribute("aria-label")).toBe("Turning your words into text");
  });

  it("can be pressed while a second press counts, and says what the press does", () => {
    const toggle = vi.fn();
    const again = vi.fn();
    const el = button({ toggle, again });
    expect(el.disabled, "a disabled button never hears the second click").toBe(false);
    expect(el.hasAttribute("aria-disabled"), "it is not disabled, so it does not say so").toBe(false);
    expect(el.getAttribute("aria-label")).toBe("Send when the words arrive");
    act(() => el.click());
    expect(again).toHaveBeenCalledTimes(1);
    expect(toggle, "never a new dictation over the one in flight").not.toHaveBeenCalled();
  });

  it("once the press is taken, is disabled and says that it will send", () => {
    const el = button({ toggle() {}, sendingAfter: true });
    expect(el.disabled).toBe(true);
    expect(el.getAttribute("aria-label")).toMatch(/then sending/);
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
