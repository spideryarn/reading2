// @vitest-environment jsdom
/**
 * **The Quiz band, and the five things about it that can be got wrong quietly.**
 *
 * Most of what this panel does is visible the moment you look at it — a
 * question is drawn or it is not. These are the rules where the wrong behaviour
 * looks exactly like the right one on a screenshot:
 *
 *  1. **The reference answer collapses again when the reader moves on.** Left
 *     open it carries over, and the next question arrives with its answer
 *     already under it. Nothing goes red; the reader just stops being quizzed.
 *  2. **The order is the artefact's.** Since `quiz/5` it is the model's path,
 *     each step leaning on the ones before; a sort here would ask step 6 before
 *     the step 5 it leans on, and a plausible-looking wrong order is
 *     unfalsifiable by eye.
 *  3. **A tick means a mark reached `done`.** A reply that is merely non-empty
 *     is a stream that stopped, which looks identical to one that finished.
 *  4. **The Answer button is refused while a transcript is on its way.**
 *     `readOnly` stops typing and nothing else, so the button is live during
 *     the two seconds between the reader stopping and the good words landing —
 *     and marking the recogniser's rough guess is the one outcome the two-pass
 *     design must not produce.
 *  5. **A mark stays bound to the answer and the batch it was computed for.**
 *     The box is editable again once a mark lands, so the reader can be sitting
 *     in front of feedback about a sentence they have deleted — and the screen
 *     looks entirely ordinary. A new batch has the same shape and a nastier
 *     end: the attempt outlives it, the old request is still holding
 *     `live.current`, and the Answer button is enabled and inert.
 *
 * Each has a positive control beside it, because a test that has never been
 * able to fail is not evidence — docs/reusable/silent-success.md.
 */
import { act, createElement, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Quiz, QuizQuestion } from "../src/types.js";
import type { Attempt, UseQuiz } from "../src/web/useQuiz.js";
import type { ReadSoFar } from "../src/web/read-filter.js";
import { STARTING } from "../src/job-state.js";
import { SLOW_AFTER_MS } from "../src/web/useSlow.js";

/**
 * Dictation is mocked, and only so that rule 4 above can be tested at all.
 *
 * jsdom has no `navigator.mediaDevices` and no `MediaRecorder`, so the real
 * hook reports `supported: false` and the microphone never renders — which
 * would leave the one dictation rule that can corrupt an answer untested. The
 * mock is the hook's contract and nothing more: a `readOnly` flag the panel
 * must honour.
 */
let readOnly = false;
/** The microphone recording — only the ← / → rule reads it. */
let armed = false;
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: { supported: true, armed, transcribing: readOnly },
    readOnly,
    busy: readOnly || armed,
    toggle: () => {},
  }),
}));
/* The real button opens a Floating UI tooltip and reads devices; neither is
   what these tests are about. */
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => createElement("button", { type: "button" }, "mic"),
  DictationStrip: () => null,
}));

/* The badge's own behaviour — the panel, its boxes, Regenerate's guards — is
   tests/profile-panel.test.tsx's. Here only what Quiz hands it. */
type BadgeProps = import("../src/web/WrittenForYou.js").ProfileState & {
  regenerate?: import("../src/web/ProfilePanel.js").Regenerate;
};
let badge: BadgeProps | null = null;
vi.mock("../src/web/WrittenForYou.js", () => ({
  WrittenForYou: (props: BadgeProps) => {
    badge = props;
    return props.written ? createElement("span", { "data-badge": "" }) : null;
  },
}));

const { QuizPanel } = await import("../src/web/QuizPanel.js");
type QuizArrival = import("../src/web/QuizPanel.js").QuizArrival;

/* **Real ids, and that matters.** `ID_PATTERN` rejects `1`, `i`, `l` and `o`,
   so a plausible-looking fixture id such as `spya-aaa111` is not one of ours and
   is never drawn as a chip — the first draft of this file used exactly that and
   the citation test failed for a reason that had nothing to do with the panel.
   docs/project/block-ids.md § the alphabet. */
const KNOWN = "spya-k3m9qt";
const OTHER = "spya-p7w2dn";
/** Id-shaped, ours by construction, and not in this article. */
const INVENTED = "spya-zzq4wv";

const BLOCKS = new Map<string, string>([
  [KNOWN, "The first paragraph, which the answer lives in."],
  [OTHER, "The second paragraph."],
]);

function question(n: number, over: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    /* `mintUniqueId` in src/quiz.ts makes these block ids by construction, so
       the fixtures are too — same alphabet, same length. */
    id: `spya-qm9qt${"23456789"[n - 1] ?? "2"}`,
    question: `Question number ${n}?`,
    referenceAnswer: `The reference answer to ${n}.`,
    evidence: [{ blockId: KNOWN as BlockId, quote: "The first paragraph", start: 0 }],
    ...over,
  };
}

function batch(questions: QuizQuestion[], batchId = "spya-batch1"): Quiz {
  return {
    version: "quiz/1",
    generator: "a-model",
    slug: "a-piece",
    batchId,
    sourceHash: "hash",
    questions,
    dropped: {
      unknownIds: 0,
      unquoted: 0,
      truncated: 0,
      overCap: 0,
      malformed: 0,
      duplicate: 0,
      unanchored: 0,
    },
    generatedAt: "2026-09-01T10:00:00.000Z",
    elapsedMs: 1,
  };
}

const cleared: number[] = [];
const marked: { id: string; answer: string }[] = [];

function owner(over: Partial<UseQuiz> = {}): UseQuiz {
  return {
    status: "ready",
    quiz: batch([question(1), question(2)]),
    stale: false,
    outdated: false,
    slug: "a-piece",
    error: null,
    retryRead: async () => {},
    job: null,
    failed: null,
    /* Nothing pressed, so nothing is in flight. The case where this is true is
       the gap between the press and the first poll, and the panel had no way to
       know about it at all until 2026-09-03 — see "the button between the press
       and the poll" below. */
    starting: false,
    /* The tab can reach the server — src/job-state.ts § `driverStalled`. */
    stalled: false,
    attempt: null,
    answered: new Set<string>(),
    /* Nothing kept: restoring an answer is tests/quiz-kept-answers.test.tsx,
       which runs the real hooks. */
    kept: new Map(),
    keptUnread: false,
    showKept: () => {},
    profiled: false,
    profileChanged: false,
    rewriting: false,
    refresh: async () => {},
    ensure: async () => {},
    write: async () => {},
    cancel: () => {},
    mark: async (id: string, answer: string) => {
      marked.push({ id, answer });
    },
    clearAttempt: () => {
      cleared.push(1);
    },
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
const jumped: BlockId[] = [];

/** The ← / → handler the panel last registered — see "← and → step the path". */
let arrowKeys: ((dir: -1 | 1) => boolean) | null = null;

function paint(o: UseQuiz) {
  act(() => {
    root.render(
      createElement(QuizPanel, {
        owner: o,
        blocks: BLOCKS,
        onArrowKeys: (h: ((dir: -1 | 1) => boolean) | null) => {
          arrowKeys = h;
        },
        onJump: (id: BlockId) => jumped.push(id),
      }),
    );
  });
}

/**
 * Every button whose name is exactly `label` — its `aria-label` when it has one
 * (the step row is icons since SPIDERYARN-READING2-71), otherwise its visible
 * text.
 */
function buttons(label: string): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")].filter(
    (b) => (b.getAttribute("aria-label") ?? (b.textContent ?? "").trim()) === label,
  ) as HTMLButtonElement[];
}

/**
 * Refused the way the step row refuses: `IconButton`'s `aria-disabled`, and
 * **never** the native attribute, which would take the button out of the tab
 * order and stop its tooltip opening (IconButton.tsx § `disabled`). A natively
 * disabled one throws rather than counting as either answer. GPT Sol's plan
 * review, finding 3.
 */
function off(b: HTMLButtonElement | undefined): boolean | undefined {
  if (b?.disabled) throw new Error(`"${b.getAttribute("aria-label")}" is natively disabled`);
  return b && b.getAttribute("aria-disabled") === "true";
}

function press(label: string) {
  const [b] = buttons(label);
  if (!b) throw new Error(`no button labelled "${label}" — found: ${[...host.querySelectorAll("button")].map((x) => `"${(x.textContent ?? "").trim()}"`).join(", ")}`);
  act(() => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function type(text: string) {
  const box = host.querySelector("textarea");
  if (!box) throw new Error("no answer box");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  readOnly = false;
  armed = false;
  cleared.length = 0;
  marked.length = 0;
  jumped.length = 0;
  arrowKeys = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the reference answer is behind a door that shuts again", () => {
  it("is not on the page until it is asked for", () => {
    paint(owner());
    expect(host.textContent).not.toContain("The reference answer to 1.");
  });

  it("opens", () => {
    paint(owner());
    press("Show a reference answer");
    expect(host.textContent).toContain("The reference answer to 1.");
  });

  /* The rule. Without the `setShowAnswer(false)` in `move` this test is the
     only thing that fails — the panel looks entirely correct. */
  it("shuts again on the next question, rather than following the reader along", () => {
    paint(owner());
    press("Show a reference answer");
    expect(host.textContent).toContain("The reference answer to 1.");
    press("Next question");
    expect(host.textContent).toContain("Question number 2?");
    expect(host.textContent).not.toContain("The reference answer to 2.");
  });

  it("calls it *a* reference answer, never *the*", () => {
    paint(owner());
    expect(buttons("Show a reference answer")).toHaveLength(1);
    expect(host.textContent).not.toContain("Show the reference answer");
  });

  it("offers the blocks it came from, and they jump", () => {
    paint(owner());
    press("Show a reference answer");
    const chip = host.querySelector(".quiz-evidence .block-ref") as HTMLAnchorElement | null;
    expect(chip).not.toBeNull();
    act(() => {
      chip?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    expect(jumped).toEqual([KNOWN]);
  });
});

describe("the list is the artefact's order and nothing else", () => {
  /* Deliberately not sorted by id, by text or alphabetically, so any sort
     added here changes the answer. The order is the path the model set. */
  const scrambled = [question(3), question(1), question(2)];

  it("draws the rows in the order it was given, however wrong that order looks", () => {
    paint(owner({ quiz: batch(scrambled) }));
    press("Show all 3 questions");
    const rows = [...host.querySelectorAll(".quiz-list-q")].map((n) => n.textContent);
    expect(rows).toEqual(["Question number 3?", "Question number 1?", "Question number 2?"]);
  });

  it("opens the question that was picked, and shuts the list", () => {
    paint(owner({ quiz: batch(scrambled) }));
    press("Show all 3 questions");
    const [, second] = [...host.querySelectorAll(".quiz-list-row")] as HTMLButtonElement[];
    act(() => {
      second?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector(".quiz-question")?.textContent).toBe("Question number 1?");
    expect(host.querySelectorAll(".quiz-list-row")).toHaveLength(0);
    expect(host.textContent).toContain("Question 2 of 3");
  });

  it("throws away the attempt on screen when the reader moves", () => {
    paint(owner({ quiz: batch(scrambled) }));
    type("something I typed");
    /* Counted from here rather than from zero: mounting is itself a change of
       batch, so the reset effect has already fired once by now. What this test
       is about is the move. */
    const before = cleared.length;
    press("Next question");
    expect(cleared).toHaveLength(before + 1);
    expect(host.querySelector("textarea")?.value).toBe("");
  });
});

describe("a tick means a mark that finished", () => {
  const q = question(1);
  /* Every attempt carries the answer it was computed from, and these fixtures
     match what the tests type into the box — otherwise rule 5 fires and the
     panel is quite right to say the mark is about something else. */
  const MINE = "what I remember";
  const half: Attempt = {
    questionId: q.id,
    answer: MINE,
    status: "marking",
    reply: "You got the ",
    error: null,
  };
  const stopped: Attempt = {
    questionId: q.id,
    answer: MINE,
    status: "failed",
    reply: "You got the ",
    error: "The connection dropped.",
  };

  it("does not tick a mark that is still arriving", () => {
    paint(owner({ quiz: batch([q]), attempt: null, answered: new Set() }));
    type(MINE);
    paint(owner({ quiz: batch([q]), attempt: half, answered: new Set() }));
    expect(host.textContent).toContain("You got the");
    expect(host.textContent).not.toContain("answered");
  });

  it("does not tick a stream that stopped without finishing, and keeps what arrived", () => {
    /* Answered first, so the box holds what the reader wrote — a retry is only
       meaningful with their answer still in it, and the button is disabled on an
       empty box whatever the attempt says. */
    paint(owner({ quiz: batch([q]), attempt: null, answered: new Set() }));
    type(MINE);
    paint(owner({ quiz: batch([q]), attempt: stopped, answered: new Set() }));

    expect(host.textContent).toContain("You got the");
    expect(host.textContent).toContain("The connection dropped.");
    expect(host.textContent).not.toContain("answered");
    /* Retryable — the button says so, it is live, and pressing it asks again. */
    const [again] = buttons("Try again");
    expect(again?.disabled).toBe(false);
    press("Try again");
    expect(marked).toEqual([{ id: q.id, answer: MINE }]);
  });

  /* The positive control. Without it the two above pass on a panel that can
     never tick anything at all. */
  it("does tick when the mark reached done", () => {
    paint(owner({ quiz: batch([q]), attempt: null, answered: new Set([q.id]) }));
    expect(host.textContent).toContain("answered");
  });

  it("draws the mark's citations as chips that jump, and leaves an invented id as text", () => {
    const done: Attempt = {
      questionId: q.id,
      answer: MINE,
      status: "done",
      reply: `He does tie it to cost [${KNOWN}], and not to [${INVENTED}].`,
      error: null,
    };
    paint(owner({ quiz: batch([q]), attempt: null, answered: new Set() }));
    type(MINE);
    paint(owner({ quiz: batch([q]), attempt: done, answered: new Set([q.id]) }));
    const chips = [...host.querySelectorAll(".quiz-reply .block-ref")] as HTMLAnchorElement[];
    expect(chips).toHaveLength(1);
    act(() => {
      chips[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    expect(jumped).toEqual([KNOWN]);
    /* The id the article does not have stays as the characters the model wrote,
       rather than becoming a chip that goes nowhere. */
    expect(host.querySelector(".quiz-reply")?.textContent).toContain(INVENTED);
  });
});

/**
 * **Rule 5, and the reason it is here rather than anywhere louder.**
 *
 * Nothing about either half of this shows up as an error. In the first, the
 * reader edits the box and reads a mark computed for the sentence they have
 * just deleted, under a line that still says the question is answered — an
 * ordinary-looking screen that is telling them something untrue. In the second
 * the panel is *more* than ordinary-looking: the questions are new, the Answer
 * button is enabled, and pressing it does nothing at all, because the old
 * attempt is still holding `useQuiz`'s single live request.
 */
describe("a mark stays bound to the answer it was computed from", () => {
  const q = question(1);
  const FIRST = "because he ties it to cost";
  const mark = (answer: string): Attempt => ({
    questionId: q.id,
    answer,
    status: "done",
    reply: "You have the cost claim, and not the timing one.",
    error: null,
  });

  /** Answer, get marked, and leave the box exactly as the marker saw it. */
  function answerAndGetMarked() {
    paint(owner({ quiz: batch([q]), attempt: null, answered: new Set() }));
    type(FIRST);
    paint(owner({ quiz: batch([q]), attempt: mark(FIRST), answered: new Set([q.id]) }));
  }

  /* The positive control. Without it the test below passes on a panel that
     disowns every mark the moment it is drawn. */
  it("stands as it is while the box still holds the answer it marked", () => {
    answerAndGetMarked();
    expect(host.textContent).toContain("You have the cost claim");
    expect(host.textContent).toContain("answered");
    expect(host.textContent).not.toContain("This mark is about your previous answer");
  });

  it("says whose answer it is once the reader edits the box under it", () => {
    answerAndGetMarked();
    type(`${FIRST}, and to how long it takes`);
    expect(host.textContent).toContain("This mark is about your previous answer");
    /* And the question stops claiming to be answered, because what is in the
       box has not been. */
    expect(host.textContent).not.toContain("answered");
    /* The mark itself stays on screen. Throwing it away on a keystroke is the
       other way of being wrong here — it is the thing the reader is editing
       against. */
    expect(host.textContent).toContain("You have the cost claim");
  });

  it("comes back when the reader puts the old words back", () => {
    answerAndGetMarked();
    type("something else entirely");
    type(FIRST);
    expect(host.textContent).not.toContain("This mark is about your previous answer");
    expect(host.textContent).toContain("answered");
  });

  /* **An emptied box is the original hole in miniature**, and the first version
     of this test asserted the opposite. Excluding the empty case left a reader
     looking at an empty box, feedback about the answer they had just deleted,
     and a line still saying "answered" — which is exactly the thing this
     describe block exists to stop. What was actually wrong was the note telling
     them to press an Answer button that is disabled while the box is empty, so
     the note is what changed. GPT Sol's second review; the plan's stage 6. */
  it("owns up to an answer that has been deleted, without naming a button that is disabled", () => {
    answerAndGetMarked();
    type("");
    expect(host.textContent).toContain("This mark is about an answer you have since deleted");
    expect(host.textContent).not.toContain("Press Answer");
    expect(host.textContent).not.toContain("answered");
    /* The mark itself is still there to read, as it is on any other edit. */
    expect(host.textContent).toContain("You have the cost claim");
    expect(off(buttons("Answer")[0])).toBe(true);
  });

  it("stops calling the press a retry once the answer has changed", () => {
    /* A failed mark offers *Try again*, which means the same words one more
       time. Editing them makes the press a new answer, and the note above the
       button says "Press Answer" — so the button had better say Answer. */
    const failed: Attempt = {
      questionId: q.id,
      answer: FIRST,
      status: "failed",
      reply: "You have the ",
      error: "The connection dropped.",
    };
    paint(owner({ quiz: batch([q]), attempt: null, answered: new Set() }));
    type(FIRST);
    paint(owner({ quiz: batch([q]), attempt: failed, answered: new Set() }));
    expect(buttons("Try again")).toHaveLength(1);

    type(`${FIRST}, and to how long it takes`);
    expect(buttons("Try again")).toHaveLength(0);
    expect(buttons("Answer")).toHaveLength(1);
  });

  it("does not carry the attempt into a batch that replaced it", () => {
    paint(owner({ quiz: batch([question(1), question(2)]) }));
    press("Next question");
    expect(host.textContent).toContain("Question 2 of 2");
    const before = cleared.length;

    /* *Write them again* — same article, new questions, new `batchId`. */
    paint(owner({ quiz: batch([question(3), question(4)], "spya-batch2") }));

    /* The reset ran at all: the index is back to the first question. Asserted
       so that a failure below cannot be a dead effect wearing rule 5's name. */
    expect(host.textContent).toContain("Question 1 of 2");
    /* And it threw the attempt away with everything else. Not cosmetic: the
       old request still holds `live.current` in `useQuiz`, and `mark` opens
       with `if (live.current) return`, so without this the new batch's Answer
       button is enabled and silently does nothing. */
    expect(cleared).toHaveLength(before + 1);
  });
});

describe("the answer box", () => {
  it("will not mark an empty answer", () => {
    paint(owner());
    const [answer] = buttons("Answer");
    expect(off(answer)).toBe(true);
    press("Answer");
    expect(marked).toEqual([]);
  });

  it("marks what was typed", () => {
    paint(owner());
    type("  because he says so  ");
    press("Answer");
    expect(marked).toEqual([{ id: question(1).id, answer: "because he says so" }]);
  });

  /* The rule. `readOnly` refuses typing and nothing else, so without the guard
     in `submit` this posts the recogniser's rough guess a moment before the
     good words arrive. */
  it("refuses to mark while a transcript is still on its way", () => {
    readOnly = true;
    paint(owner());
    type("the rough guess");
    press("Answer");
    expect(marked).toEqual([]);
  });

  it("will not let a stale batch be marked at all", () => {
    paint(owner({ stale: true }));
    type("anything");
    const [answer] = buttons("Answer");
    expect(off(answer)).toBe(true);
    press("Answer");
    expect(marked).toEqual([]);
    expect(host.textContent).toContain("cannot be marked against them");
  });

  /* Greg, 2026-10-03 (spya-fzgcqu): an icon and a tooltip, as chat's Send is.
     The word is the button's name and the card's head, never its face. */
  it("is an icon: its word is its name, not its text", () => {
    paint(owner());
    type("because he says so");
    const [answer] = buttons("Answer");
    expect(answer?.textContent?.trim()).toBe("");
    expect(answer?.querySelector("svg")).not.toBeNull();
  });

  it("marks on Cmd+Enter and on Ctrl+Enter, and not on a bare Enter", () => {
    paint(owner());
    type("because he says so");
    const box = host.querySelector("textarea");
    const key = (init: KeyboardEventInit) =>
      act(() => {
        box?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...init }));
      });
    key({});
    expect(marked).toEqual([]);
    key({ metaKey: true });
    key({ ctrlKey: true });
    expect(marked.map((m) => m.answer)).toEqual(["because he says so", "because he says so"]);
  });

  /* spya-qnrxuw: *"show the whole answer and don't put my answer in a
     scrollable box."* jsdom lays nothing out, so the height the browser would
     report is stubbed; what is tested is that the panel asks for it and uses it. */
  it("is as tall as what is written in it", () => {
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 240,
    });
    try {
      paint(owner());
      type("a long answer");
      expect(host.querySelector("textarea")?.style.height).toBe("240px");
    } finally {
      delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });
});

describe("the whole answer after a width change", () => {
  const watches: Array<{
    tick(): void;
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];

  beforeEach(() => {
    watches.length = 0;
    vi.stubGlobal("ResizeObserver", class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        watches.push({
          tick: () => callback([], this as unknown as ResizeObserver),
          observe: this.observe,
          disconnect: this.disconnect,
        });
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fits the unchanged answer on narrower and wider widths, including its borders", () => {
    paint(owner());
    type("the same long answer across widths");
    const box = host.querySelector("textarea")!;
    let width = 500;
    let height = 240;
    // A browser's scrollHeight cannot shrink below a height still set inline.
    const measure = vi.fn(() => Math.max(height, (Number.parseFloat(box.style.height) || 0) - 2));
    Object.defineProperties(box, {
      clientWidth: { configurable: true, get: () => width },
      scrollHeight: { configurable: true, get: measure },
      offsetHeight: { configurable: true, get: () => 102 },
      clientHeight: { configurable: true, get: () => 100 },
    });
    const watch = watches.find((w) => w.observe.mock.calls.some(([el]) => el === box));
    expect(watch, "the mounted box was never observed").toBeDefined();
    act(() => watch!.tick());
    expect(box.style.height).toBe("242px");

    // The fit itself delivers a height notification. It must not measure again.
    measure.mockClear();
    act(() => watch!.tick());
    expect(measure).not.toHaveBeenCalled();

    width = 287;
    height = 640;
    act(() => watch!.tick());
    expect(box.style.height).toBe("642px");
    width = 820;
    height = 160;
    act(() => watch!.tick());
    expect(box.style.height).toBe("162px");
    expect(box.value).toBe("the same long answer across widths");
  });

  it("disconnects when the filter hides the box, then fits and observes the new box", () => {
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(240);
    const read: ReadSoFar = {
      levels: new Map([[KNOWN as BlockId, 4 as const]]),
      status: "loaded",
      bodyWords: new Map([[KNOWN as BlockId, 100]]),
    };
    const o = owner();
    const paintRead = (readSoFar: ReadSoFar) => act(() => root.render(
      createElement(QuizPanel, { owner: o, blocks: BLOCKS, readSoFar, onJump: () => {} }),
    ));
    paintRead(read);
    type("an unchanged draft");
    const first = host.querySelector("textarea")!;
    const oldWatch = watches.find((w) => w.observe.mock.calls.some(([el]) => el === first))!;
    expect(oldWatch).toBeDefined();

    paintRead({ ...read, status: "loading" });
    expect(host.querySelector("textarea")).toBeNull();
    expect(oldWatch.disconnect).toHaveBeenCalledOnce();
    paintRead(read);
    const second = host.querySelector("textarea")!;
    expect(second).not.toBe(first);
    expect(second.value).toBe("an unchanged draft");
    expect(second.style.height).toBe("240px");
    const newWatch = watches.find((w) => w.observe.mock.calls.some(([el]) => el === second))!;
    expect(newWatch).toBeDefined();
    expect(newWatch).not.toBe(oldWatch);

    act(() => root.unmount());
    expect(newWatch.disconnect).toHaveBeenCalledOnce();
    root = createRoot(host);
  });
});

/* spya-smev24: *"I was expecting there to be a button at the bottom underneath,
   sort of for, you know, next question."* There was one, small and grey, below
   the reference-answer disclosure. So the step row sits under the mark, and
   once the mark is finished Next is the filled button and Answer the quiet one. */
describe("Next is the thing to press once the answer is marked", () => {
  const [q1, q2] = [question(1), question(2)];
  const TYPED = "because he ties it to cost";
  const attempt = (status: Attempt["status"], verdict?: "right" | "wrong"): Attempt => ({
    questionId: q1.id,
    answer: TYPED,
    status,
    reply: "You have the cost claim.",
    error: null,
    ...(verdict ? { verdict } : {}),
  });
  const filled = (label: string) => buttons(label)[0]?.classList.contains("quiz-go");
  function marked_(a: Attempt | null) {
    paint(owner({ quiz: batch([q1, q2]), attempt: null }));
    type(TYPED);
    paint(owner({ quiz: batch([q1, q2]), attempt: a }));
  }

  it("puts the step row above the reference answer", () => {
    marked_(attempt("done"));
    const step = host.querySelector(".quiz-step");
    const reveal = host.querySelector(".quiz-reveal");
    expect(step && reveal).toBeTruthy();
    expect(step?.previousElementSibling?.classList.contains("quiz-reply")).toBe(true);
    expect(
      (step as Element).compareDocumentPosition(reveal as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("fills Answer, not Next, before there is a mark", () => {
    marked_(null);
    expect(filled("Answer")).toBe(true);
    expect(filled("Next question")).toBe(false);
  });

  it("does not fill Next while the mark is still arriving", () => {
    marked_(attempt("marking"));
    expect(filled("Next question")).toBe(false);
  });

  /* The same for every verdict, because the verdict is never for showing. */
  it.each([["right"], ["wrong"], [undefined]] as const)(
    "fills Next and quiets Answer once the mark is done (verdict: %s)",
    (verdict) => {
      marked_(attempt("done", verdict));
      expect(filled("Next question")).toBe(true);
      expect(filled("Answer")).toBe(false);
      /* Quiet, not refused: the same words may still be marked again. */
      expect(off(buttons("Answer")[0])).toBeFalsy();
      press("Answer");
      expect(marked).toEqual([{ id: q1.id, answer: TYPED }]);
      press("Next question");
      expect(host.textContent).toContain("Question 2 of 2");
    },
  );

  it("hands the fill back to Answer when the box is edited", () => {
    marked_(attempt("done"));
    type(`${TYPED}, and to time`);
    expect(filled("Next question")).toBe(false);
    expect(filled("Answer")).toBe(true);
  });

  it("keeps keyboard focus on Next as the mark finishes and its look changes", () => {
    marked_(attempt("marking"));
    const [next] = buttons("Next question");
    act(() => next!.focus());
    expect(document.activeElement).toBe(next);
    paint(owner({ quiz: batch([q1, q2]), attempt: attempt("done") }));
    expect(filled("Next question")).toBe(true);
    expect(buttons("Next question")[0]).toBe(next);
    expect(document.activeElement).toBe(next);
  });

  it("fills nothing on the last question, where there is no next", () => {
    paint(owner({ quiz: batch([q1]), attempt: null }));
    type(TYPED);
    paint(owner({ quiz: batch([q1]), attempt: attempt("done") }));
    const [next] = buttons("Next question");
    expect(off(next)).toBe(true);
    expect(filled("Next question")).toBe(false);
  });
});

/**
 * **The button between the press and the first poll.**
 *
 * A quiz build takes forty seconds and costs about $0.07, and for the first
 * second of it there is no job in the polled list — so without `starting` the
 * panel drew *Write the questions* again and a reader who pressed once was
 * invited to press twice. Every other band had been passing this prop since it
 * existed; the quiz had not, because `useQuiz` did not expose it and
 * `JobProgress` carried a comment claiming the quiz *"watch[es] a job it did
 * not start"*. It starts its own.
 */
/**
 * **Written for your profile, and Regenerate** — plan 261002f. Greg, 2026-10-02:
 * *"it needs a "Regenerate for my profile". That's more important, ok to lose
 * answers."*
 */
describe("the written-for-your-profile badge", () => {
  beforeEach(() => {
    badge = null;
  });

  it("is on the head of a quiz written for a profile, with the forced run behind Regenerate", () => {
    const wrote: number[] = [];
    paint(
      owner({
        profiled: true,
        profileChanged: true,
        write: async () => {
          wrote.push(1);
        },
      }),
    );
    expect(host.querySelector("[data-badge]"), "no badge on a profiled quiz").not.toBeNull();
    expect(badge?.written).toBe(true);
    expect(badge?.changed).toBe(true);
    badge?.regenerate?.run();
    /* `write` is the forced verb — `ensure` would skip a current batch. */
    expect(wrote).toEqual([1]);
  });

  it("says before the press that the answers so far go", () => {
    paint(owner({ profiled: true, profileChanged: true }));
    expect(badge?.regenerate?.consequence).toMatch(/new questions for your profile/i);
    expect(badge?.regenerate?.consequence).toMatch(/answers so far are cleared/i);
  });

  it("holds Regenerate while a quiz job is already starting or running", () => {
    paint(owner({ profiled: true, profileChanged: true, starting: true }));
    expect(badge?.regenerate?.busy).toBe(true);
    paint(owner({ profiled: true, profileChanged: true }));
    expect(badge?.regenerate?.busy).toBe(false);
  });

  it("holds Regenerate after the job, until the replacement batch has been read", () => {
    /* Sol's plan review: `job` is gone before the re-read lands, and a failed
       re-read keeps the old batch with its old `profileChanged`. */
    paint(owner({ profiled: true, profileChanged: true, rewriting: true }));
    expect(badge?.regenerate?.busy).toBe(true);
  });

  it("offers a read retry after a rewrite's GET fails, without buying another run", async () => {
    const refresh = vi.fn(async () => {});
    const write = vi.fn(async () => {});
    paint(owner({ rewriting: true, error: "Couldn't read the questions.", refresh, write }));
    expect(buttons("Read the new questions")).toHaveLength(1);
    press("Read the new questions");
    await act(async () => {});
    expect(refresh).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it("holds the stale banner's forced run until the replacement has been read too", () => {
    paint(owner({ stale: true }));
    expect(buttons("Write them again")).toHaveLength(1);
    paint(owner({ stale: true, rewriting: true }));
    expect(buttons("Write them again")).toHaveLength(0);
    expect(buttons("Read the new questions")).toHaveLength(1);
  });

  it("is absent on a quiz written with no profile", () => {
    paint(owner({ profiled: false }));
    expect(host.querySelector("[data-badge]")).toBeNull();
  });
});

describe("the gap between pressing and the job appearing", () => {
  it("takes the button away rather than offering a second press", () => {
    paint(owner({ quiz: null, status: "none", starting: true }));
    expect(buttons("Write the questions"), "the button was still there to press again").toEqual([]);
    expect(host.textContent).toContain(STARTING);
  });

  it("offers it when nothing is in flight", () => {
    /* The control, on screen first: an empty `buttons()` above proves nothing
       unless the same panel does draw one when it should. */
    paint(owner({ quiz: null, status: "none", starting: false }));
    expect(buttons("Write the questions").length).toBe(1);
  });
});


/**
 * **The walk: a path in order, with help that adapts.**
 *
 * Since `quiz/5` the questions are a path the model set, each step leaning on
 * the one before, and the reader walks it front to back — Next is the next
 * question in the array, whatever happened. What adapts is the premise: shown
 * above a step unless the reader has just come there with Next from a step
 * judged right. Greg chose adaptive with no control on 2026-09-06; the band
 * ladder that kept that promise until 2026-09-30 is gone
 * (docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md § The walk).
 *
 * Two kinds of case, and the second is as load-bearing as the first: the help
 * adapts, and the reader is never told that anything did. And one the plan
 * adds: **the list shows stems only**, because a premise is an earlier
 * question's answer and scanning the list must not answer rows the reader has
 * not reached (Sol F3).
 */
describe("the walk is the path, and the premise is the help that adapts", () => {
  const P2 = "The piece ties it to cost.";
  const P3 = "Cost is what the author measures.";
  /** Three steps: an opening with no premise, then two that lean back. */
  const PATH = batch([question(1), question(2, { premise: P2 }), question(3, { premise: P3 })]);
  const [first, second, third] = PATH.questions as [QuizQuestion, QuizQuestion, QuizQuestion];

  /** A finished mark for a question, judged as given. */
  function judged(id: string, verdict: "right" | "wrong" | undefined): Attempt {
    return {
      questionId: id,
      answer: "what they wrote",
      status: "done",
      reply: "That tracks the piece.",
      error: null,
      ...(verdict ? { verdict } : {}),
    };
  }

  const stem = () => host.querySelector(".quiz-question")?.textContent ?? null;
  const premiseShown = () => host.querySelector(".quiz-premise")?.textContent ?? null;

  /** A fresh panel, for a loop that paints several independent walks. */
  function remount() {
    act(() => root.unmount());
    root = createRoot(host);
  }

  function pickRow(n: number) {
    act(() => {
      const rows = [...host.querySelectorAll(".quiz-list-row")] as HTMLElement[];
      rows[n]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("opens at the front of the path", () => {
    paint(owner({ quiz: PATH }));
    expect(stem()).toBe("Question number 1?");
    expect(host.textContent).toContain("Question 1 of 3");
    /* The opening step leans on nothing, so there is nothing above it. */
    expect(premiseShown()).toBeNull();
  });

  it("goes to the next question in the array whatever the verdict", () => {
    for (const verdict of ["right", "wrong", undefined] as const) {
      paint(owner({ quiz: PATH, attempt: judged(first.id, verdict) }));
      press("Next question");
      expect(stem(), `after ${verdict ?? "no"} verdict`).toBe("Question number 2?");
      expect(host.textContent).toContain("Question 2 of 3");
      remount();
    }
  });

  it("asks the next step on its own after a right answer", () => {
    paint(owner({ quiz: PATH, attempt: judged(first.id, "right") }));
    press("Next question");
    expect(premiseShown()).toBeNull();
    /* Hiding the premise is not hiding the step. */
    expect(stem()).toBe("Question number 2?");
  });

  it("hands the reader the thread after a wrong answer, above the question and apart from it", () => {
    paint(owner({ quiz: PATH, attempt: judged(first.id, "wrong") }));
    press("Next question");
    expect(premiseShown()).toBe(P2);
    const premise = host.querySelector(".quiz-premise");
    const q = host.querySelector(".quiz-question");
    expect(premise?.compareDocumentPosition(q as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(q?.textContent).not.toContain(P2);
  });

  it("hands it over too when nothing was judged — a skip, or a classifier that failed", () => {
    paint(owner({ quiz: PATH, attempt: judged(first.id, undefined) }));
    press("Next question");
    expect(premiseShown()).toBe(P2);
    remount();
    paint(owner({ quiz: PATH }));
    press("Next question");
    expect(premiseShown()).toBe(P2);
  });

  it("remembers the verdict after the attempt has gone", () => {
    /* In the app `move` clears the attempt, so by the time step 2 is on screen
       the only record of step 1's verdict is the panel's own. */
    const o = owner({ quiz: PATH, attempt: judged(first.id, "right") });
    paint(o);
    paint({ ...o, attempt: null });
    press("Next question");
    expect(stem()).toBe("Question number 2?");
    expect(premiseShown()).toBeNull();
  });

  it("follows the latest verdict on the step before", () => {
    const o = owner({ quiz: PATH, attempt: judged(first.id, "right") });
    paint(o);
    press("Next question");
    paint({ ...o, attempt: null });
    press("Previous question");
    /* Answered again, and wrong this time. */
    paint({ ...o, attempt: judged(first.id, "wrong") });
    press("Next question");
    expect(premiseShown()).toBe(P2);
  });

  it("shows the premise on a step reached by Previous, even after a right answer before it", () => {
    /* Right on 1, right on 2, on to 3, then back to 2. The reader did not just
       carry step 1's thread to step 2 — they came from the other side. */
    const o = owner({ quiz: PATH, attempt: judged(first.id, "right") });
    paint(o);
    press("Next question");
    expect(premiseShown()).toBeNull();
    paint({ ...o, attempt: judged(second.id, "right") });
    press("Next question");
    press("Previous question");
    expect(stem()).toBe("Question number 2?");
    expect(premiseShown()).toBe(P2);
  });

  it("walks back one step at a time, and counts the position on the path", () => {
    paint(owner({ quiz: PATH }));
    press("Next question");
    press("Next question");
    expect(host.textContent).toContain("Question 3 of 3");
    expect(off(buttons("Next question")[0]), "Next was live on the last step").toBe(true);
    press("Previous question");
    expect(stem()).toBe("Question number 2?");
    expect(host.textContent).toContain("Question 2 of 3");
    press("Previous question");
    expect(off(buttons("Previous question")[0])).toBe(true);
  });

  it("jumps to a question picked from the list, and walks on from there", () => {
    paint(owner({ quiz: PATH }));
    press("Show all 3 questions");
    pickRow(2);
    expect(host.textContent).toContain("Question 3 of 3");
    expect(host.querySelectorAll(".quiz-list-row")).toHaveLength(0);
    press("Previous question");
    expect(stem()).toBe("Question number 2?");
  });

  /**
   * **A jump is not an arrival by Next** — GPT Sol's R2-1. Step 2 was judged
   * right, and then the reader went elsewhere; coming to step 3 from the list,
   * they have not just carried step 2's thread there, so step 3 keeps its
   * premise. Keyed on the verdict alone, this would be asked bare.
   */
  it("shows the premise on a step picked from the list, even when the step before was right", () => {
    const o = owner({ quiz: PATH });
    paint(o);
    press("Next question");
    paint({ ...o, attempt: judged(second.id, "right") });
    press("Previous question");
    paint({ ...o, attempt: null });
    press("Show all 3 questions");
    pickRow(2);
    expect(stem()).toBe("Question number 3?");
    expect(premiseShown()).toBe(P3);
  });

  /**
   * **A path with a hole in it shows every premise.** Validation dropped a
   * step mid-path, so for some step "the one before" on screen is not the one
   * its premise restates, and a right answer to it is no evidence. The positive
   * control is the same walk without the gap, above: right on step 1, Next,
   * no premise.
   */
  it("always shows the premise when the batch had a question dropped mid-path", () => {
    const gapped: Quiz = { ...PATH, dropped: { ...PATH.dropped, gaps: 1 } };
    paint(owner({ quiz: gapped, attempt: judged(first.id, "right") }));
    press("Next question");
    expect(premiseShown()).toBe(P2);
  });

  /**
   * **The list never shows a premise** — Sol's F3. A premise restates an
   * earlier step's answer; drawn in the list it would answer rows the reader
   * has not reached yet. The positive control first: the premise is on
   * screen, so its absence from the list is not merely its absence from the
   * page.
   */
  it("lists question stems only, never premises", () => {
    paint(owner({ quiz: PATH }));
    press("Next question");
    expect(premiseShown()).toBe(P2);
    press("Show all 3 questions");
    const list = host.querySelector(".quiz-list")?.textContent ?? "";
    expect(list).toContain("Question number 2?");
    expect(list).toContain("Question number 3?");
    expect(list).not.toContain(P2);
    expect(list).not.toContain(P3);
  });

  it("does not disturb the current attempt when its own row is picked", () => {
    /* `move` aborts a mark in flight and clears the draft, so treating "the
       current one" as a move lets a reader destroy a half-typed answer by
       tapping the highlighted row. GPT Sol's code review on the ladder caught
       it once; the index walk keeps the guard. */
    paint(owner({ quiz: PATH }));
    cleared.length = 0;
    press("Show all 3 questions");
    pickRow(0);
    expect(cleared, "the attempt was cleared by picking the current row").toEqual([]);
    expect(stem()).toBe("Question number 1?");
    expect(buttons("Hide the list")).toEqual([]);
  });

  it("forgets every verdict when the batch is replaced", () => {
    const o = owner({ quiz: PATH, attempt: judged(first.id, "right") });
    paint(o);
    press("Next question");
    expect(premiseShown()).toBeNull();
    /* The same questions under a new `batchId` — the case where a verdict map
       that outlived its batch would still find ids to match. */
    paint({ ...o, quiz: { ...PATH, batchId: "spya-batch2" }, attempt: null });
    expect(host.textContent).toContain("Question 1 of 3");
    press("Next question");
    expect(premiseShown()).toBe(P2);
  });

  it("does not put the old verdict back while clearing a replacement batch", () => {
    const old = owner({ quiz: PATH, attempt: judged(first.id, "right") });
    paint(old);
    press("Next question");
    expect(premiseShown()).toBeNull();

    /* The replacement deliberately reuses ids, and the old completed attempt
       deliberately survives this render. The reset effect calls
       `clearAttempt`, but effects from this same render still see the old prop:
       recording it again after clearing the map would silently carry a verdict
       across batches. */
    paint({
      ...old,
      quiz: { ...PATH, batchId: "spya-batch2" },
      attempt: judged(first.id, "right"),
    });
    expect(host.textContent).toContain("Question 1 of 3");
    press("Next question");
    expect(premiseShown()).toBe(P2);
  });

  /**
   * **The rule that makes this adaptive rather than a gauge.** quiz.md: quoting
   * a difficulty at a reader is handing them a token with nothing behind it.
   * The premise must not become one either — no "a hint", no level. This
   * asserts the absence, which is the only way an absence gets defended.
   */
  it("never says a word about difficulty, however the reader is doing", () => {
    for (const verdict of ["right", "wrong", undefined] as const) {
      paint(owner({ quiz: PATH, attempt: judged(first.id, verdict) }));
      press("Next question");
      press("Show all 3 questions");
      const shown = (host.textContent ?? "").toLowerCase();
      for (const leak of ["easy", "medium", "hard", "harder", "easier", "difficulty", "level"]) {
        expect(
          shown,
          `"${leak}" reached the screen after a ${verdict ?? "missing"} verdict`,
        ).not.toContain(leak);
      }
      remount();
    }
  });

  /**
   * **The verdict lands last, and Next must not outrun it.**
   *
   * It is judged from the *finished* mark, so it arrives with the terminal
   * frame — after the reader has read every word. The next step's premise
   * depends on it, so a Next pressed in that window would arrive with no
   * verdict and abort the classifier on the way out: the help quietly stuck
   * on, on a screen that looks entirely normal. GPT Sol's first finding on the
   * ladder's built code, and it holds for the premise the same way.
   */
  describe("while the mark is still arriving", () => {
    const marking = (id: string): Attempt => ({
      questionId: id,
      answer: "what they wrote",
      status: "marking",
      reply: "That tracks the piece, and the rest is still arriving",
      error: null,
    });

    it("will not move on before the verdict has landed", () => {
      paint(owner({ quiz: PATH, attempt: marking(first.id) }));
      const [next] = buttons("Next question");
      expect(off(next), "Next was live while the verdict was still in flight").toBe(true);
    });

    it("leaves Previous and the list live, so a reader can still walk away", () => {
      const o = owner({ quiz: PATH });
      paint(o);
      press("Next question");
      paint({ ...o, attempt: marking(second.id) });
      const [prev] = buttons("Previous question");
      expect(off(prev), "a reader waiting on a mark was trapped").toBe(false);
      expect(buttons("Show all 3 questions").length).toBe(1);
    });

    it("moves again once the mark is done, and the verdict decides the premise", () => {
      const o = owner({ quiz: PATH });
      paint(o);
      press("Next question");
      paint({ ...o, attempt: marking(second.id) });
      expect(off(buttons("Next question")[0])).toBe(true);
      paint({ ...o, attempt: judged(second.id, "right") });
      expect(off(buttons("Next question")[0])).toBe(false);
      press("Next question");
      expect(stem()).toBe(third.question);
      expect(premiseShown()).toBeNull();
    });
  });
});

/**
 * **Only what you have read** — SPIDERYARN-READING2-61,
 * docs/plans/260930e-quiz-only-asks-about-what-you-have-read.md.
 *
 * The rules that look right on a screenshot when they are wrong: an empty map
 * from a failed or unfinished read shown as "read nothing"; a question drawn
 * under a draft that belonged to another; a Next over an unread step treated
 * as an arrival from the step before, which hides the premise that bridges it.
 */
describe("only what you have read", () => {
  /** A third real block, so three steps can each lean on their own passage. */
  const THIRD = "spya-h4r7nx";
  const THREE = new Map([...BLOCKS, [THIRD, "The third paragraph."]]);
  const on = (id: string) => [{ blockId: id as BlockId, quote: "x", start: 0 }];
  const P2 = "The second step's premise.";
  const P3 = "The third step's premise.";
  const PATH = batch([
    question(1, { evidence: on(KNOWN) }),
    question(2, { evidence: on(OTHER), premise: P2 }),
    question(3, { evidence: on(THIRD), premise: P3 }),
  ]);
  const [first, second, third] = PATH.questions as [QuizQuestion, QuizQuestion, QuizQuestion];

  function read(ids: string[], status: ReadSoFar["status"] = "loaded"): ReadSoFar {
    return {
      levels: new Map(ids.map((id) => [id, 4 as const])),
      status,
      bodyWords: new Map([
        [KNOWN, 100],
        [OTHER, 100],
        [THIRD, 200],
      ]),
    };
  }

  function paintRead(o: UseQuiz, readSoFar: ReadSoFar | undefined, blocks = THREE) {
    act(() => {
      root.render(createElement(QuizPanel, { owner: o, blocks, readSoFar, onJump: () => {} }));
    });
  }

  const stem = () => host.querySelector(".quiz-question")?.textContent ?? null;
  const premiseShown = () => host.querySelector(".quiz-premise")?.textContent ?? null;
  const box = () => host.querySelector<HTMLInputElement>(".quiz-only-read input");
  const tick = () =>
    act(() => {
      box()?.click();
    });

  function judged(id: string, verdict: "right" | "wrong"): Attempt {
    return { questionId: id, answer: "a", status: "done", reply: "ok", error: null, verdict };
  }

  it("has no tick-box, and walks every question, when reading time is off", () => {
    paintRead(owner({ quiz: PATH }), undefined);
    expect(box()).toBeNull();
    expect(stem()).toBe(first.question);
    expect(host.textContent).toContain("Question 1 of 3");
  });

  it("opens on the first question about a passage read, and counts only those", () => {
    paintRead(owner({ quiz: PATH }), read([OTHER, THIRD]));
    expect(box()?.checked).toBe(true);
    expect(stem()).toBe(second.question);
    expect(host.textContent).toContain("Question 1 of 2");
  });

  it("says how much of the piece is read, by body words, as a pie named by the figure", () => {
    paintRead(owner({ quiz: PATH }), read([THIRD]));
    /* 200 of 400 words. By blocks it would have been a third. Drawn, not
       printed (spya-mafmm6, plan 261003e): the figure is the pie's name. */
    expect(host.querySelector("button.share-pie")?.getAttribute("aria-label")).toBe(
      "About 50% of the piece read so far",
    );
    expect(host.textContent).not.toContain("of the piece read so far");
  });

  it("says nothing has been read yet rather than showing an unread question, and unticking brings them back", () => {
    paintRead(owner({ quiz: PATH }), read([]));
    expect(stem()).toBeNull();
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).toContain("None of these questions is about a passage you have read yet");
    tick();
    expect(stem()).toBe(first.question);
    expect(host.textContent).toContain("Question 1 of 3");
  });

  it("waits while the levels are loading, rather than calling that read nothing", () => {
    /* The shared wait line (BandWaiting.tsx): nothing in it before 600ms. */
    vi.useFakeTimers();
    try {
      paintRead(owner({ quiz: PATH }), read([], "loading"));
      expect(host.querySelector('.band-waiting[role="status"]')).not.toBeNull();
      expect(host.textContent).not.toContain("Looking for what you have read");
      act(() => {
        vi.advanceTimersByTime(SLOW_AFTER_MS + 1);
      });
      expect(host.textContent).toContain("Looking for what you have read");
      expect(host.textContent).not.toContain("None of these questions");
      expect(host.querySelector("textarea")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("walks every question, and says why, when the levels could not be loaded", () => {
    paintRead(owner({ quiz: PATH }), read([], "failed"));
    expect(stem()).toBe(first.question);
    expect(host.textContent).toContain("Question 1 of 3");
    expect(host.textContent).toContain("couldn’t load what you have read");
    expect(host.querySelector("button.share-pie")).toBeNull();
  });

  it("counts a passage the article no longer has as unread, however long it was on screen", () => {
    paintRead(owner({ quiz: PATH }), read([THIRD]), new Map([...BLOCKS]));
    expect(host.textContent).toContain("None of these questions");
  });

  it("shows the premise after a Next that skipped a step, even one answered right earlier", () => {
    /* The skipped step must carry a `right`, or the premise shows anyway and
       the test proves nothing about how the reader arrived. So: untick, answer
       step 2 right, tick again (which moves off step 2), go back to step 1,
       then Next over step 2 to step 3. */
    const o = owner({ quiz: PATH });
    const some = read([KNOWN, THIRD]);
    paintRead(o, some);
    tick();
    press("Next question");
    expect(stem()).toBe(second.question);
    paintRead({ ...o, attempt: judged(second.id, "right") }, some);
    tick();
    expect(stem()).toBe(third.question);
    press("Previous question");
    expect(stem()).toBe(first.question);
    press("Next question");
    expect(stem()).toBe(third.question);
    expect(premiseShown(), "a Next over a skipped step counted as arriving from it").toBe(P3);
  });

  it("hides the premise after a right answer when Next skipped nothing — the control", () => {
    paintRead(owner({ quiz: PATH, attempt: judged(first.id, "right") }), read([KNOWN, OTHER]));
    press("Next question");
    expect(stem()).toBe(second.question);
    expect(premiseShown()).toBeNull();
  });

  it("lists only the questions read, and says how many more there are", () => {
    paintRead(owner({ quiz: PATH }), read([KNOWN]));
    press("Show all 1 question");
    const rows = [...host.querySelectorAll(".quiz-list-row")].map((r) => r.textContent ?? "");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(first.question);
    expect(host.textContent).toContain(UNREAD_2_OF_3);
    /* Moved up beside the count, not said a second time under the list. */
    expect(host.textContent?.split("you have not read yet")).toHaveLength(2);
  });

  /**
   * **Each count says what it counts** (plan 261006g § The Quiz count). The
   * (i) card said "12 questions" and the band "Question 1 of 5", both true and
   * neither explained; the sentence that did explain was under the list, which
   * is closed until asked for.
   */
  const UNREAD_2_OF_3 = "There are 3 in all: the other 2 are about passages you have not read yet.";

  it("says what 'of N' leaves out with the list closed, beside the count", () => {
    paintRead(owner({ quiz: PATH }), read([KNOWN]));
    expect(host.querySelector(".quiz-list-row"), "the list is closed").toBeNull();
    expect(host.textContent).toContain("Question 1 of 1");
    const count = host.querySelector(".gloss-count");
    expect(count?.nextElementSibling?.textContent).toBe(UNREAD_2_OF_3);
  });

  it("says it of one question in the singular", () => {
    paintRead(owner({ quiz: PATH }), read([KNOWN, OTHER]));
    expect(host.textContent).toContain("Question 1 of 2");
    expect(host.textContent).toContain(
      "There are 3 in all: the other one is about a passage you have not read yet.",
    );
    press("Next question");
    expect(host.textContent).toContain("Question 2 of 2");
    expect(host.textContent).toContain(
      "There are 3 in all: the other one is about a passage you have not read yet.",
    );
  });

  it("says nothing of the kind when the filter hides none", () => {
    paintRead(owner({ quiz: PATH }), read([KNOWN, OTHER, THIRD]));
    expect(host.textContent).toContain("Question 1 of 3");
    expect(host.textContent).not.toContain("in all");
    paintRead(owner({ quiz: PATH }), read([KNOWN]));
    tick();
    expect(host.textContent).toContain("Question 1 of 3");
    expect(host.textContent).not.toContain("in all");
  });

  it("the (i) card's count is the whole batch, and says so", async () => {
    paintRead(owner({ quiz: PATH }), read([KNOWN]));
    const about = host.querySelector<HTMLButtonElement>('.band-about[aria-label="About this mode"]');
    await act(async () => about?.click());
    const tip = document.querySelector('[role="tooltip"], [role="dialog"]')?.textContent ?? "";
    expect(tip).toContain("3 questions in all.");
    await act(async () => about?.click());
  });

  it("keeps the question and the draft as more of the piece is read", () => {
    const o = owner({ quiz: PATH });
    paintRead(o, read([OTHER]));
    type("half an answer");
    const clears = cleared.length;
    paintRead(o, read([KNOWN, OTHER]));
    expect(stem()).toBe(second.question);
    expect(host.querySelector("textarea")?.value).toBe("half an answer");
    expect(cleared.length).toBe(clears);
    /* And the earlier step is now reachable. */
    expect(host.textContent).toContain("Question 2 of 2");
  });

  it("moves off an unread question through the ordinary move when the tick-box goes back on", () => {
    paintRead(owner({ quiz: PATH }), read([OTHER]));
    tick();
    /* Unticked: the whole path again, from where the reader was. */
    expect(stem()).toBe(second.question);
    press("Previous question");
    expect(stem()).toBe(first.question);
    type("a draft about the first");
    const clears = cleared.length;
    tick();
    expect(stem()).toBe(second.question);
    /* The draft belonged to the first question, and went with it. */
    expect(host.querySelector("textarea")?.value).toBe("");
    expect(cleared.length).toBeGreaterThan(clears);
  });
});

describe("only what you have read, across a new batch", () => {
  it("opens a replacement batch on its first question read, not near the old batch's place", () => {
    const on = (id: string) => [{ blockId: id as BlockId, quote: "x", start: 0 }];
    const readSoFar: ReadSoFar = {
      levels: new Map([[KNOWN, 4 as const]]),
      status: "loaded",
      bodyWords: new Map([[KNOWN, 100]]),
    };
    const A = batch([1, 2, 3, 4].map((n) => question(n, { evidence: on(KNOWN) })), "spya-batch1");
    /* Unread, read, unread, read: from the old place (index 2) the nearest
       read step is 3; from the front it is 1. */
    const B = batch(
      [1, 2, 3, 4].map((n) =>
        question(n, { question: `New question ${n}?`, evidence: on(n % 2 === 0 ? KNOWN : OTHER) }),
      ),
      "spya-batch2",
    );
    const paintB = (quiz: Quiz) =>
      act(() => {
        root.render(
          createElement(QuizPanel, { owner: owner({ quiz }), blocks: BLOCKS, readSoFar, onJump: () => {} }),
        );
      });
    paintB(A);
    press("Next question");
    press("Next question");
    expect(host.querySelector(".quiz-question")?.textContent).toBe("Question number 3?");
    paintB(B);
    expect(host.querySelector(".quiz-question")?.textContent).toBe("New question 2?");
  });

  it("does not paint the replacement batch at the old batch's index before its reset effect", () => {
    const commits: Array<string | null> = [];
    const A = batch([question(1), question(2), question(3)], "spya-batch1");
    const B = batch(
      [1, 2, 3].map((n) => question(n, { question: `New question ${n}?` })),
      "spya-batch2",
    );

    function CommitProbe() {
      /* Layout effects see the committed DOM before QuizPanel's passive reset
         effects. A final-DOM assertion cannot catch the one paint in which a
         new question can otherwise sit over the preceding batch's draft. */
      useLayoutEffect(() => {
        commits.push(host.querySelector(".quiz-question")?.textContent ?? null);
      });
      return null;
    }

    const paintWithProbe = (quiz: Quiz) =>
      act(() => {
        root.render(
          createElement(
            "div",
            null,
            createElement(QuizPanel, {
              owner: owner({ quiz }),
              blocks: BLOCKS,
              onJump: () => {},
            }),
            createElement(CommitProbe),
          ),
        );
      });

    paintWithProbe(A);
    press("Next question");
    press("Next question");
    type("an answer to the old third question");
    commits.length = 0;

    paintWithProbe(B);

    expect(commits[0], "the first replacement commit exposed the old index").toBeNull();
    expect(host.querySelector(".quiz-question")?.textContent).toBe("New question 1?");
    expect(host.querySelector("textarea")?.value).toBe("");
  });
});

/**
 * **← and → step the path** — SPIDERYARN-READING2-71; keyboard.md § ← / → in
 * Quiz. The panel hands `Reader` one handler, which `useArrowNav`
 * calls after its own guards (no modifier, not typing, no drawer). What is
 * tested here is the half only the panel knows: that the handler is the
 * buttons' own rule, that it answers `false` when it took nothing — so the key
 * goes back to the browser — and that a stray press cannot throw away an
 * answer that has not been marked.
 */
describe("← and → step the path", () => {
  const PATH = batch([question(1), question(2), question(3)]);
  const [first] = PATH.questions as [QuizQuestion];
  const stem = () => host.querySelector(".quiz-question")?.textContent ?? null;
  const key = (dir: -1 | 1): boolean | undefined => {
    let took: boolean | undefined;
    act(() => {
      took = arrowKeys?.(dir);
    });
    return took;
  };

  it("registers a handler while a question is showing, and takes it back on unmount", () => {
    paint(owner({ quiz: PATH }));
    expect(arrowKeys).not.toBeNull();
    act(() => root.unmount());
    expect(arrowKeys, "the handler outlived the panel").toBeNull();
    root = createRoot(host);
  });

  it("→ is Next and ← is Previous, and neither wraps", () => {
    paint(owner({ quiz: PATH }));
    expect(key(-1), "← on the first question took the key").toBe(false);
    expect(stem()).toBe("Question number 1?");
    expect(key(1)).toBe(true);
    expect(stem()).toBe("Question number 2?");
    expect(key(1)).toBe(true);
    expect(stem()).toBe("Question number 3?");
    expect(key(1), "→ on the last question took the key").toBe(false);
    expect(stem()).toBe("Question number 3?");
    expect(key(-1)).toBe(true);
    expect(stem()).toBe("Question number 2?");
  });

  it("→ waits for a mark still arriving, as Next does", () => {
    paint(
      owner({
        quiz: PATH,
        attempt: { questionId: first.id, answer: "mine", status: "marking", reply: "So far", error: null },
      }),
    );
    /* The box is left empty, so this is `canGoNext` refusing and not the
       unmarked-draft rule below. */
    expect(key(1)).toBe(false);
    expect(stem()).toBe("Question number 1?");
  });

  it("will not throw away an answer that has not been marked", () => {
    paint(owner({ quiz: PATH }));
    type("half an answer");
    expect(key(1), "a stray → discarded a draft").toBe(false);
    expect(stem()).toBe("Question number 1?");
    expect(host.querySelector("textarea")?.value).toBe("half an answer");
    // Positive control: the same key moves once the box is empty again.
    type("");
    expect(key(1)).toBe(true);
    expect(stem()).toBe("Question number 2?");
  });

  /* The box is empty in both, so the draft rule above cannot be what refuses. */
  it("will not move while the microphone is recording", () => {
    armed = true;
    paint(owner({ quiz: PATH }));
    expect(key(1), "a stray → moved while the reader was talking").toBe(false);
    expect(stem()).toBe("Question number 1?");
    armed = false;
    paint(owner({ quiz: PATH }));
    expect(key(1), "the control: the same press moves once it stops").toBe(true);
  });

  it("will not move while a transcript is on its way", () => {
    readOnly = true;
    paint(owner({ quiz: PATH }));
    expect(key(1), "the transcript would land under the next question").toBe(false);
    expect(stem()).toBe("Question number 1?");
  });

  it("an unavailable step button is still focusable and does nothing when pressed", () => {
    paint(owner({ quiz: PATH }));
    const [prev] = buttons("Previous question");
    expect(off(prev)).toBe(true);
    const before = cleared.length;
    press("Previous question");
    expect(stem()).toBe("Question number 1?");
    expect(cleared.length, "a refused press still ran move()").toBe(before);
  });

  it("moves on once the answer has been marked", () => {
    const o = owner({ quiz: PATH });
    paint(o);
    type("mine");
    paint({
      ...o,
      attempt: { questionId: first.id, answer: "mine", status: "done", reply: "Good.", error: null },
    });
    expect(key(1)).toBe(true);
    expect(stem()).toBe("Question number 2?");
  });
});

/**
 * **A question pressed in the prose lands the band on it** — `QuizArrival`,
 * SPIDERYARN-READING2-6V; docs/plans/260930i-quiz-questions-in-the-prose-and-in-trajectory-stops.md
 * and GPT Sol's plan review of it (findings 1–3). The arrival names its batch;
 * it is a jump, so the premise shows; the question already open is not moved
 * to, because `move` would abort its mark; the tick-box gives way; and the
 * landing survives StrictMode running the effects twice.
 */
describe("an arrival from the prose", () => {
  const THIRD = "spya-h4r7nx";
  const THREE = new Map([...BLOCKS, [THIRD, "The third paragraph."]]);
  const on = (id: string) => [{ blockId: id as BlockId, quote: "x", start: 0 }];
  const P3 = "The third step's premise.";
  const PATH = batch([
    question(1, { evidence: on(KNOWN) }),
    question(2, { evidence: on(OTHER) }),
    question(3, { evidence: on(THIRD), premise: P3 }),
  ]);
  const [first, second, third] = PATH.questions as [QuizQuestion, QuizQuestion, QuizQuestion];
  const stem = () => host.querySelector(".quiz-question")?.textContent ?? null;
  const premiseShown = () => host.querySelector(".quiz-premise")?.textContent ?? null;
  const taken: QuizArrival[] = [];

  function paintAt(
    o: UseQuiz,
    arrival: QuizArrival | null,
    opts: { readSoFar?: ReadSoFar; strict?: boolean } = {},
  ) {
    const panel = createElement(QuizPanel, {
      owner: o,
      blocks: THREE,
      readSoFar: opts.readSoFar,
      arrival,
      onArrivalTaken: (a: QuizArrival) => taken.push(a),
      onJump: () => {},
    });
    act(() => {
      root.render(opts.strict ? createElement(StrictMode, null, panel) : panel);
    });
  }

  beforeEach(() => {
    taken.length = 0;
  });

  it("opens on the pressed question, with its premise, and hands the arrival back", () => {
    const o = owner({ quiz: PATH });
    paintAt(o, null);
    expect(stem()).toBe(first.question);
    const a: QuizArrival = { batchId: PATH.batchId, questionId: third.id };
    paintAt(o, a);
    expect(stem()).toBe(third.question);
    expect(premiseShown(), "a jump shows the premise").toBe(P3);
    expect(taken).toContain(a);
  });

  it("lands on it when the band mounts with the arrival already there — under StrictMode", () => {
    const a: QuizArrival = { batchId: PATH.batchId, questionId: second.id };
    paintAt(owner({ quiz: PATH }), a, { strict: true });
    /* The batch reset's `setAt(0)` runs twice as well; the landing must win both times. */
    expect(stem()).toBe(second.question);
    expect(host.textContent).toContain("Question 2 of 3");
  });

  it("ignores an arrival from another batch, even when the id is in this one, and still hands it back", () => {
    const a: QuizArrival = { batchId: "spya-oldbat", questionId: third.id };
    paintAt(owner({ quiz: PATH }), a);
    expect(stem()).toBe(first.question);
    expect(taken).toContain(a);
  });

  it("does not move to the question already open, so a mark still arriving survives", () => {
    const marking: Attempt = { questionId: first.id, answer: "half", status: "marking", reply: "So far", error: null };
    const o = owner({ quiz: PATH, attempt: marking });
    paintAt(o, null);
    const before = cleared.length;
    paintAt(o, { batchId: PATH.batchId, questionId: first.id });
    expect(cleared.length, "the open question's mark was thrown away").toBe(before);
    expect(stem()).toBe(first.question);
    /* The control: another question does move, and takes the mark with it. */
    paintAt(o, { batchId: PATH.batchId, questionId: second.id });
    expect(cleared.length).toBeGreaterThan(before);
    expect(stem()).toBe(second.question);
  });

  it("turns 'Only what I've read' off when it would hide the pressed question", () => {
    const readSoFar: ReadSoFar = {
      levels: new Map([[KNOWN, 4 as const]]),
      status: "loaded",
      bodyWords: new Map([
        [KNOWN, 100],
        [OTHER, 100],
        [THIRD, 100],
      ]),
    };
    const o = owner({ quiz: PATH });
    paintAt(o, null, { readSoFar });
    const box = () => host.querySelector<HTMLInputElement>(".quiz-only-read input");
    expect(box()?.checked).toBe(true);
    paintAt(o, { batchId: PATH.batchId, questionId: third.id }, { readSoFar });
    expect(stem()).toBe(third.question);
    expect(box()?.checked, "the tick-box should say it gave way").toBe(false);
    expect(host.textContent).toContain("Question 3 of 3");
    expect(host.textContent).not.toContain("you have not read yet");
  });

  it("wins when the filter tries to move off that same unread opening question", () => {
    const readSoFar: ReadSoFar = {
      /* The opening question is unread and the second is read. On mount, the
         filter effect therefore tries to move 0 -> 1 in the same commit that
         the arrival turns the filter off and asks to stay on 0. */
      levels: new Map([[OTHER, 4 as const]]),
      status: "loaded",
      bodyWords: new Map([
        [KNOWN, 100],
        [OTHER, 100],
        [THIRD, 100],
      ]),
    };
    const arrival: QuizArrival = { batchId: PATH.batchId, questionId: first.id };
    paintAt(owner({ quiz: PATH }), arrival, { readSoFar });
    expect(stem(), "the earlier filter effect overruled the prose arrival").toBe(first.question);
    expect(host.querySelector<HTMLInputElement>(".quiz-only-read input")?.checked).toBe(false);
  });

  it("preserves a live mark when reading levels exclude the same question requested by an arrival", () => {
    const readSoFar: ReadSoFar = {
      levels: new Map([[OTHER, 4 as const]]),
      status: "failed",
      bodyWords: new Map([[KNOWN, 100], [OTHER, 100], [THIRD, 100]]),
    };
    const marking: Attempt = { questionId: first.id, answer: "half", status: "marking", reply: "So far", error: null };
    const o = owner({ quiz: PATH, attempt: marking });
    paintAt(o, null, { readSoFar });
    const before = cleared.length;
    const a: QuizArrival = { batchId: PATH.batchId, questionId: first.id };
    paintAt(o, a, { readSoFar: { ...readSoFar, status: "loaded" } });
    expect(cleared.length, "the earlier filter aborted the requested question's mark").toBe(before);
    expect(stem()).toBe(first.question);

    /* A handled arrival cannot permanently override a later filter press,
       even if its owner has not yet removed it from the props. */
    act(() => host.querySelector<HTMLInputElement>(".quiz-only-read input")?.click());
    expect(stem()).toBe(second.question);
    expect(cleared.length).toBeGreaterThan(before);
  });
});

/**
 * **Where to look again** — SPIDERYARN-READING2-6R,
 * docs/plans/260930i-quiz-scores-answers-by-section-and-says-where-to-look-again.md.
 *
 * The rules a screenshot would not catch: the block appearing on no evidence
 * (a right answer, or no verdict); a count or a verdict word reaching the page;
 * "back to its question" offered for the question already open, or for one
 * the reading filter will not let the reader land on.
 */
describe("where to look again", () => {
  const THIRD = "spya-h4r7nx";
  const THREE = new Map([...BLOCKS, [THIRD, "The third paragraph."]]);
  const on = (id: string) => [{ blockId: id as BlockId, quote: "x", start: 0 }];
  const PATH = batch([
    question(1, { evidence: on(KNOWN) }),
    question(2, { evidence: on(OTHER), premise: "The second step's premise." }),
    question(3, { evidence: on(THIRD) }),
  ]);
  const [first, second] = PATH.questions as [QuizQuestion, QuizQuestion, QuizQuestion];
  /** "Opening" is KNOWN; "Middle" is OTHER and THIRD. */
  const SECTIONS = {
    sections: [
      { row: 0, blockId: KNOWN as BlockId, nodeId: "n1", title: "Opening", titleVoice: "ai" as const },
      { row: 1, blockId: OTHER as BlockId, nodeId: "n2", title: "Middle", titleVoice: "ai" as const },
    ],
    rowOf: new Map<BlockId, number>([
      [KNOWN as BlockId, 0],
      [OTHER as BlockId, 1],
      [THIRD as BlockId, 2],
    ]),
  };

  function paintSections(o: UseQuiz, readSoFar?: ReadSoFar) {
    act(() => {
      root.render(
        createElement(QuizPanel, {
          owner: o,
          blocks: THREE,
          readSoFar,
          sections: SECTIONS,
          onJump: (id: BlockId) => jumped.push(id),
        }),
      );
    });
  }

  function judged(id: string, verdict?: "right" | "wrong"): Attempt {
    return { questionId: id, answer: "a", status: "done", reply: "ok", error: null, ...(verdict ? { verdict } : {}) };
  }

  const block = () => host.querySelector(".quiz-look-again");
  const stem = () => host.querySelector(".quiz-question")?.textContent ?? null;
  const RETRY = "Back to a question on Opening";

  it("is not there until an answer has been judged wrong", () => {
    paintSections(owner({ quiz: PATH }));
    expect(block()).toBeNull();
    paintSections(owner({ quiz: PATH, attempt: judged(first.id, "right") }));
    expect(block()).toBeNull();
    paintSections(owner({ quiz: PATH, attempt: judged(first.id) }));
    expect(block()).toBeNull();
  });

  it("names the section and nothing else, and the name jumps the prose there", () => {
    paintSections(owner({ quiz: PATH, attempt: judged(first.id, "wrong") }));
    expect(block()?.textContent).toBe("Where to look againOpening");
    const before = jumped.length;
    act(() => {
      (host.querySelector(".quiz-look-again-section") as HTMLElement).click();
    });
    expect(jumped.slice(before)).toEqual([KNOWN]);
    // In the title's voice — the fixture's titles are the model's (fonts.md).
    expect(host.querySelector(".quiz-look-again-section")?.classList.contains("voice-ai")).toBe(true);
  });

  it("offers the missed question from elsewhere on the path, not while it is open, and goes back to it as a jump", () => {
    const o = owner({ quiz: PATH, attempt: judged(first.id, "wrong") });
    paintSections(o);
    expect(buttons(RETRY)).toHaveLength(0);
    paintSections({ ...o, attempt: null });
    press("Next question");
    expect(stem()).toBe(second.question);
    expect(buttons(RETRY)).toHaveLength(1);
    press(RETRY);
    expect(stem()).toBe(first.question);
    expect(host.textContent).toContain("Question 1 of 3");
  });

  it("returns to a later missed question as a jump, so its premise is shown", () => {
    const o = owner({ quiz: PATH });
    paintSections(o);
    press("Next question");
    paintSections({ ...o, attempt: judged(second.id, "wrong") });
    press("Next question");
    expect(stem()).toBe("Question number 3?");

    press("Back to a question on Middle");
    expect(stem()).toBe(second.question);
    expect(host.querySelector(".quiz-premise")?.textContent).toBe("The second step's premise.");
  });

  it("drops the section once its answer is judged right again", () => {
    const o = owner({ quiz: PATH, attempt: judged(first.id, "wrong") });
    paintSections(o);
    expect(block()).not.toBeNull();
    paintSections({ ...o, attempt: judged(first.id, "right") });
    expect(block()).toBeNull();
  });

  it("drops the old wrong verdict when a newer finished mark has no verdict", () => {
    const o = owner({ quiz: PATH, attempt: judged(first.id, "wrong") });
    paintSections(o);
    expect(block()).not.toBeNull();
    paintSections({ ...o, attempt: judged(first.id) });
    expect(block()).toBeNull();
  });

  it("forgets the section on a replacement batch, even while the old completed attempt is still in props", () => {
    const old = owner({ quiz: PATH, attempt: judged(first.id, "wrong") });
    paintSections(old);
    expect(block()).not.toBeNull();

    /* The replacement deliberately reuses question ids and the old attempt
       survives the first render. Without both the map reset and the
       reset-only verdict pass, "Opening" comes straight back on the new batch. */
    paintSections({
      ...old,
      quiz: { ...PATH, batchId: "spya-batch2" },
      attempt: judged(first.id, "wrong"),
    });
    expect(stem(), "the reset hid the new batch instead of clearing the old verdict").toBe(first.question);
    expect(block()).toBeNull();
  });

  it("does not offer a question the reading filter will not land on", () => {
    const read = (ids: string[]): ReadSoFar => ({
      levels: new Map(ids.map((id) => [id as BlockId, 4 as const])),
      status: "loaded",
      bodyWords: new Map([
        [KNOWN as BlockId, 100],
        [OTHER as BlockId, 100],
        [THIRD as BlockId, 100],
      ]),
    });
    /* Answered while everything was read… */
    const o = owner({ quiz: PATH, attempt: judged(first.id, "wrong") });
    paintSections(o, read([KNOWN, OTHER, THIRD]));
    paintSections({ ...o, attempt: null }, read([KNOWN, OTHER, THIRD]));
    press("Next question");
    expect(buttons(RETRY)).toHaveLength(1);
    /* …and then the opening passage no longer counts as read. */
    paintSections({ ...o, attempt: null }, read([OTHER, THIRD]));
    expect(block()?.textContent).toContain("Opening");
    expect(buttons(RETRY)).toHaveLength(0);
  });
});
