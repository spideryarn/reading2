// @vitest-environment jsdom
/**
 * **The Quiz band, and the four things about it that can be got wrong quietly.**
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

function batch(questions: QuizQuestion[]): Quiz {
  return {
    version: "quiz/1",
    generator: "a-model",
    slug: "a-piece",
    batchId: "spya-batch1",
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
    press("Next");
    expect(cleared).toHaveLength(1);
    expect(host.querySelector("textarea")?.value).toBe("");
  });
});

describe("a tick means a mark that finished", () => {
  const q = question(1);
  const half: Attempt = { questionId: q.id, status: "marking", reply: "You got the ", error: null };
  const stopped: Attempt = {
    questionId: q.id,
    status: "failed",
    reply: "You got the ",
    error: "The connection dropped.",
  };

  it("does not tick a mark that is still arriving", () => {
    paint(owner({ quiz: batch([q]), attempt: half, answered: new Set() }));
    expect(host.textContent).toContain("You got the");
    expect(host.textContent).not.toContain("answered");
  });

  it("does not tick a stream that stopped without finishing, and keeps what arrived", () => {
    /* Answered first, so the box holds what the reader wrote — a retry is only
       meaningful with their answer still in it, and the button is disabled on an
       empty box whatever the attempt says. */
    paint(owner({ quiz: batch([q]), attempt: null, answered: new Set() }));
    type("what I remember");
    paint(owner({ quiz: batch([q]), attempt: stopped, answered: new Set() }));

    expect(host.textContent).toContain("You got the");
    expect(host.textContent).toContain("The connection dropped.");
    expect(host.textContent).not.toContain("answered");
    /* Retryable — the button says so, it is live, and pressing it asks again. */
    const [again] = buttons("Try again");
    expect(again?.disabled).toBe(false);
    press("Try again");
    expect(marked).toEqual([{ id: q.id, answer: "what I remember" }]);
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
      status: "done",
      reply: `He does tie it to cost [${KNOWN}], and not to [${INVENTED}].`,
      error: null,
    };
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
