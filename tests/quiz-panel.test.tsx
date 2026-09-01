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
 *  2. **The order is the artefact's.** `orderQuestions` sorts the whole batch
 *     once, against bands and values this panel never sees. A sort here would
 *     be a second opinion, and a plausible-looking wrong order is unfalsifiable
 *     by eye.
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
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Quiz, QuizQuestion } from "../src/types.js";
import type { Attempt, UseQuiz } from "../src/web/useQuiz.js";

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
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: { supported: true, armed: false, transcribing: readOnly },
    readOnly,
    toggle: () => {},
  }),
}));
/* The real button opens a Floating UI tooltip and reads devices; neither is
   what these tests are about. */
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => createElement("button", { type: "button" }, "mic"),
  DictationStrip: () => null,
}));

const { QuizPanel } = await import("../src/web/QuizPanel.js");

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
    band: "easy",
    value: 3,
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
    job: null,
    failed: null,
    /* Stage 6's blocking job — src/web/useStepJob.ts. Nothing here is refused. */
    blocking: null,
    /* The tab can reach the server — src/job-state.ts § `driverStalled`. */
    stalled: false,
    attempt: null,
    answered: new Set<string>(),
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

function paint(o: UseQuiz) {
  act(() => {
    root.render(
      createElement(QuizPanel, {
        owner: o,
        blocks: BLOCKS,
        onJump: (id: BlockId) => jumped.push(id),
      }),
    );
  });
}

/** Every button whose visible text is exactly `label`. */
function buttons(label: string): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")].filter(
    (b) => (b.textContent ?? "").trim() === label,
  ) as HTMLButtonElement[];
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
  cleared.length = 0;
  marked.length = 0;
  jumped.length = 0;
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
    press("Next");
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
  /* Deliberately not sorted by band, by value, by id or alphabetically, so any
     sort added here changes the answer. `orderQuestions` in src/quiz.ts has
     already done this against the whole batch. */
  const scrambled = [
    question(3, { band: "hard", value: 5 }),
    question(1, { band: "easy", value: 1 }),
    question(2, { band: "medium", value: 4 }),
  ];

  it("draws the rows in the order it was given, however wrong that order looks", () => {
    paint(owner({ quiz: batch(scrambled) }));
    press("Show all 3");
    const rows = [...host.querySelectorAll(".quiz-list-q")].map((n) => n.textContent);
    expect(rows).toEqual(["Question number 3?", "Question number 1?", "Question number 2?"]);
  });

  it("opens the question that was picked, and shuts the list", () => {
    paint(owner({ quiz: batch(scrambled) }));
    press("Show all 3");
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
    press("Next");
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
       against, and nothing stores it. */
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
    expect(host.querySelector<HTMLButtonElement>("button.gloss-run")?.disabled).toBe(true);
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
    press("Next");
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
    expect(answer?.disabled).toBe(true);
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
    expect(answer?.disabled).toBe(true);
    expect(host.textContent).toContain("cannot be marked against them");
  });
});
