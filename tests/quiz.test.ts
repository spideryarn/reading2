/**
 * **The quiz stage's pure half** — the path's order, the premise, and what
 * validation throws away. No network, no model.
 *
 * Every case here is a way the stage would be wrong *quietly*. A quiz that
 * comes back with twenty plausible questions about nothing in particular looks
 * exactly like one that works (docs/reusable/silent-success.md), so the things
 * worth pinning are the ones with no visible symptom:
 *
 * - **the order**, because since `quiz/5` the model's order *is* the path —
 *   each step leaning on the one before — and a sort anywhere would ask a step
 *   before the one it leans on while looking like a perfectly good list;
 * - **the premise**, because one that gives away its own question's answer
 *   turns a step into a reading exercise, and nothing on screen says so;
 * - **the drops, and where they fall**, because a dropped question is
 *   indistinguishable from one the model chose not to set, and a drop in the
 *   middle of a path is a hole the next step has to be answerable across;
 * - **the stamp field names**, because getting those wrong makes every quiz
 *   permanently non-current with nothing anywhere going red. That one is the
 *   whole of GPT Sol's finding 3 on the plan.
 *
 * Until 2026-09-30 this file also pinned a band sort and a band-spread gate.
 * Both went with the band itself —
 * docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md.
 *
 * The prompts themselves are pinned at the bottom, in the shape
 * tests/remember-prompt.test.ts uses: a rule is here by name because it is the fix
 * for a specific way the first draft misbehaved, and because it is the kind of
 * paragraph a later tidy-up would shorten out without knowing what it was for.
 * What the prompts *do* is `evals/quiz.ts`'s question, and only a model can
 * answer it.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_EVIDENCE,
  MAX_QUESTIONS,
  PROMPT_VERSION,
  QUIZ_READER_RULES,
  QUIZ_SYSTEM,
  buildQuiz,
  emptyDropped,
  validateEvidence,
  withOldClientBands,
} from "../src/quiz.js";
import { GRADE_WORDS, gradeWords, QUIZ_MARK_SYSTEM } from "../src/quiz-mark.js";
import { readerFailureOf } from "../src/job-failure.js";
import { kindOfMessage, worthRetrying } from "../src/messages.js";
import type { Block, QuizDropped, QuizResponse } from "../src/types.js";
import { CAPABLE_MODEL } from "../src/models.js";

const block = (id: string, text: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

/** Three paragraphs, in document order — `spya-aaaaaa` is first on the page. */
const blocks: Block[] = [
  block("spya-aaaaaa", "A simulation of a rainstorm does not make anything actually wet."),
  block("spya-bbbbbb", "Intelligence is mainly about doing; consciousness is mostly about being."),
  block("spya-cccccc", "Brains are not computers, and the metaphor has been hugely influential."),
];

/** A quote each block really contains, so a raw question built on it survives. */
const QUOTES: Record<string, string> = {
  "spya-aaaaaa": "does not make anything actually wet",
  "spya-bbbbbb": "consciousness is mostly about being",
  "spya-cccccc": "Brains are not computers",
};

/**
 * One question as the model would send it — valid unless told otherwise.
 * `blockId` picks where its answer lives; `over` replaces any field, and an
 * explicit `undefined` removes one.
 */
const raw = (
  n: number,
  over: Record<string, unknown> = {},
  blockId = "spya-aaaaaa",
): Record<string, unknown> => ({
  question: `Question number ${n}?`,
  referenceAnswer: `Answer number ${n}.`,
  evidence: [{ blockId, quote: QUOTES[blockId] }],
  ...over,
});

/** A question whose only evidence is a quote the article does not contain. */
const unanchored = (n: number): Record<string, unknown> =>
  raw(n, { evidence: [{ blockId: "spya-aaaaaa", quote: "a sentence the article lacks" }] });

const build = (questions: unknown[], dropped: QuizDropped = emptyDropped()) =>
  buildQuiz({ questions }, { power: "standard", slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped });

const texts = (questions: readonly { question: string }[]): string[] => questions.map((q) => q.question);

describe("the path is the model's order", () => {
  /**
   * **THE test of this file, since `quiz/5`.** The model sets the questions in
   * the order they build on one another, and that order is the path. Until
   * 2026-09-30 the server sorted the batch by band, then value, then position
   * on the page; the three questions below are in an order every one of those
   * keys would change — the last one's answer is first on the page — so any
   * sort that comes back goes red here.
   */
  it("keeps the questions in the order the model gave them", () => {
    const quiz = build([
      raw(3, {}, "spya-cccccc"),
      raw(1, {}, "spya-bbbbbb"),
      raw(2, { band: "hard", value: 5 }, "spya-aaaaaa"),
    ]);
    expect(texts(quiz.questions)).toEqual([
      "Question number 3?",
      "Question number 1?",
      "Question number 2?",
    ]);
  });

  it("keeps the order across a drop, closing the gap rather than reshuffling", () => {
    const quiz = build([raw(1), unanchored(2), raw(3), raw(4)]);
    expect(texts(quiz.questions)).toEqual([
      "Question number 1?",
      "Question number 3?",
      "Question number 4?",
    ]);
  });

  it("stores no band or value, even when the model still sends them", () => {
    /* A cached model habit, or an old prompt's output replayed through the
       validator: the fields are not read, so they are not stored. A stored band
       would be a judgement nothing makes any more, sitting in every artefact. */
    const quiz = build([raw(1, { band: "easy", value: 4 })]);
    expect(quiz.questions[0]).not.toHaveProperty("band");
    expect(quiz.questions[0]).not.toHaveProperty("value");
  });

  it("stamps the new prompt version", () => {
    expect(PROMPT_VERSION).toBe("quiz/5");
  });
});

describe("the premise", () => {
  const PREMISE = "The piece says a simulated storm makes nothing wet.";

  it("is kept when the model gives one", () => {
    const quiz = build([raw(1), raw(2, { premise: `  ${PREMISE}  ` })]);
    expect(quiz.questions[0]).not.toHaveProperty("premise");
    expect(quiz.questions[1]?.premise).toBe(PREMISE);
  });

  it("is left off, and the question kept, when it is empty or not a string", () => {
    const quiz = build([raw(1, { premise: "   " }), raw(2, { premise: 42 }), raw(3, { premise: null })]);
    expect(quiz.questions).toHaveLength(3);
    for (const q of quiz.questions) expect(q).not.toHaveProperty("premise");
  });

  it("is dropped when it only repeats the question", () => {
    const quiz = build([raw(1, { premise: "question NUMBER 1?" })]);
    expect(quiz.questions).toHaveLength(1);
    expect(quiz.questions[0]).not.toHaveProperty("premise");
  });

  /**
   * **The giveaway, at its crudest.** A premise is shown above its question
   * whenever the reader did not just get the step before right, so one that
   * contains this question's reference answer hands the reader the answer —
   * on exactly the screens where they were struggling. The prompt forbids it;
   * this catches the verbatim case, and subtler ones are the eval's.
   */
  it("is dropped when it contains the question's own reference answer", () => {
    const quiz = build([
      raw(1, {
        referenceAnswer: "Because simulation is not the real thing.",
        premise: "Seth says, because simulation is not the real thing, that nothing is wet.",
      }),
    ]);
    expect(quiz.questions).toHaveLength(1);
    expect(quiz.questions[0]).not.toHaveProperty("premise");
  });

  it("does not fail the question when it is dropped", () => {
    /* The positive control for the three above: a premise is optional help,
       and a bad one costs the help, never the step. */
    const quiz = build([raw(1, { premise: "question number 1?" }), raw(2)]);
    expect(texts(quiz.questions)).toEqual(["Question number 1?", "Question number 2?"]);
  });
});

describe("gaps in the path", () => {
  /**
   * **A drop in the middle breaks the path; a drop at the end shortens it.**
   * Only the first is worth a signal — the step after a hole leans on a step
   * the reader will never see, and the walk shows every premise on a batch
   * with one (src/web/quiz-ladder.ts § `showPremise`). So `gaps` counts
   * dropped questions with a kept question somewhere after them.
   */
  it("counts a question dropped in the middle", () => {
    const dropped = emptyDropped();
    build([raw(1), unanchored(2), raw(3)], dropped);
    expect(dropped.unanchored).toBe(1);
    expect(dropped.gaps).toBe(1);
  });

  it("does not count a question dropped at the end", () => {
    const dropped = emptyDropped();
    build([raw(1), raw(2), unanchored(3)], dropped);
    expect(dropped.unanchored).toBe(1);
    expect(dropped.gaps).toBe(0);
  });

  it("counts a run of drops, and every kind of drop, before a kept question", () => {
    const dropped = emptyDropped();
    build([raw(1), null, raw(1), unanchored(3), raw(4), unanchored(5)], dropped);
    /* A malformed one, a duplicate and an unanchored one sit between two kept
       questions: three gaps. The last is a tail drop and is not one. */
    expect(dropped.malformed).toBe(1);
    expect(dropped.duplicate).toBe(1);
    expect(dropped.unanchored).toBe(2);
    expect(dropped.gaps).toBe(3);
  });

  it("counts a drop before the first kept question, because the path lost its start", () => {
    const dropped = emptyDropped();
    build([unanchored(1), raw(2)], dropped);
    expect(dropped.gaps).toBe(1);
  });

  it("is carried onto the artefact, where the walk reads it", () => {
    const quiz = build([raw(1), unanchored(2), raw(3)]);
    expect(quiz.dropped.gaps).toBe(1);
  });
});

describe("how many", () => {
  it(`keeps ${MAX_QUESTIONS} and counts the rest, without calling them gaps`, () => {
    const dropped = emptyDropped();
    const quiz = build(
      Array.from({ length: MAX_QUESTIONS + 3 }, (_, i) => raw(i)),
      dropped,
    );
    expect(quiz.questions).toHaveLength(MAX_QUESTIONS);
    expect(dropped.overCap).toBe(3);
    /* Past the cap is the end of the path, not a hole in it. */
    expect(dropped.gaps).toBe(0);
  });

  /**
   * **What the over-cap number is not.** It counts array elements the loop
   * never reached, and those may be malformed, duplicate or unanchored. GPT
   * Sol's reproduction: a full batch and one more item that is not a question
   * at all. `overCap` is 1, `malformed` is 0 — because nothing looked at it.
   */
  it("counts the unexamined tail without judging it", () => {
    const dropped = emptyDropped();
    const questions: unknown[] = Array.from({ length: MAX_QUESTIONS }, (_, i) => raw(i));
    questions.push({ band: "hard" });
    build(questions, dropped);
    expect(dropped.overCap).toBe(1);
    expect(dropped.malformed, "the tail item was never examined, so nothing judged it").toBe(0);
  });
});

/**
 * **The one refusal left**: every question named a passage the article does
 * not contain. Its reader's sentence and its diagnostic are two strings, since
 * docs/plans/260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md
 * stage 2 split them — `Error.message` for the log and Sentry,
 * `readerFailureOf` for the band in red.
 */
describe("when nothing survives", () => {
  const STEP_LABEL = "Writing the questions";

  const refused = (questions: unknown[]): { reader: string; diagnostic: string; err: unknown } => {
    try {
      build(questions);
    } catch (err) {
      return { reader: readerFailureOf(err, STEP_LABEL).message, diagnostic: (err as Error).message, err };
    }
    throw new Error("the batch was supposed to be refused");
  };

  it("tells the reader why there are no questions without reciting the drop counts", () => {
    const { reader, diagnostic } = refused([unanchored(1), unanchored(2)]);
    expect(reader).toMatch(/\[quiz-unanchored\]$/);
    expect(reader).toContain("could be tied back to a passage");
    expect(reader).not.toMatch(/malformed|duplicates|block id/);
    expect(diagnostic).toContain("malformed");
    expect(diagnostic).toContain("duplicates");
  });

  it("says out loud that another go is worth having", () => {
    const { reader } = refused([unanchored(1)]);
    expect(kindOfMessage(reader)).toBe("retry");
    expect(worthRetrying(reader)).toBe(true);
  });
});

/**
 * **The one-week bridge for tabs still running the band ladder.** An old tab
 * reads `question.band` on every Next and throws without one, so the GET route
 * adds `band: "easy", value: 3` — in the response, never the stored artefact.
 */
describe("withOldClientBands", () => {
  const response = (): QuizResponse => ({
    quiz: build([raw(1), raw(2, { premise: "Something said before." })]),
    stale: false,
    outdated: false,
  });

  it("gives every question a band and a value an old ladder can walk", () => {
    const out = withOldClientBands(response());
    for (const q of out.quiz.questions) {
      expect(q).toMatchObject({ band: "easy", value: 3 });
    }
    /* Everything else rides through untouched. */
    expect(out.quiz.questions[1]?.premise).toBe("Something said before.");
    expect(out.stale).toBe(false);
  });

  it("keeps a band and value an old artefact already has", () => {
    /* A `quiz/4` artefact still in the store carries real bands. The bridge
       must not flatten them to `easy`, or an old tab reading an old quiz would
       lose the ladder it was built for. */
    const r = response();
    const old = { ...r.quiz.questions[0], band: "hard", value: 5 };
    const out = withOldClientBands({ ...r, quiz: { ...r.quiz, questions: [old as never] } });
    expect(out.quiz.questions[0]).toMatchObject({ band: "hard", value: 5 });
  });

  it("does not touch the artefact it was given", () => {
    const r = response();
    const before = JSON.stringify(r);
    withOldClientBands(r);
    expect(JSON.stringify(r)).toBe(before);
    expect(r.quiz.questions[0]).not.toHaveProperty("band");
  });
});

describe("what the model says, and what we believe of it", () => {
  it("drops a question whose only block id is not in the article", () => {
    const dropped = emptyDropped();
    expect(() =>
      buildQuiz(
        {
          questions: [
            {
              question: "Where does the invented block live?",
              referenceAnswer: "Nowhere at all.",
              evidence: [{ blockId: "spya-zzzzzz", quote: "does not make anything actually wet" }],
            },
          ],
        },
        { power: "standard", slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped },
      ),
    ).toThrow();
    expect(dropped.unknownIds).toBe(1);
    expect(dropped.unanchored).toBe(1);
  });

  it("drops the evidence whose quote is not in the block it named", () => {
    /* Checking that an id exists proves only that a paragraph exists. The quote
       is what ties the reference answer to the page — GPT Sol's finding 2 — so
       a quote `findQuote` cannot locate takes its evidence with it. The question
       survives on the evidence that did land. */
    const dropped = emptyDropped();
    const quiz = buildQuiz(
      {
        questions: [
          {
            question: "What does a simulated rainstorm not do?",
            referenceAnswer: "It does not make anything wet.",
            evidence: [
              { blockId: "spya-aaaaaa", quote: "a sentence the article never contains at all" },
              { blockId: "spya-aaaaaa", quote: "does not make anything actually wet" },
            ],
          },
        ],
      },
      { power: "standard", slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped },
    );
    expect(dropped.unquoted).toBe(1);
    expect(dropped.unanchored).toBe(0);
    expect(quiz.questions[0]?.evidence).toHaveLength(1);
  });

  it("stores the article's characters rather than the model's typing", () => {
    /* `findQuote` is deliberately forgiving about case and whitespace, so a
       match is not a promise that the two strings are equal — and what the
       panel shows under "the article says" has to be what the article says.
       src/quotes.ts § `place`, and src/timeline.ts § `validateOccurrences`. */
    const dropped = emptyDropped();
    const evidence = validateEvidence(
      [{ blockId: "spya-bbbbbb", quote: "INTELLIGENCE   is\nmainly about doing" }],
      blocks,
      dropped,
    );
    expect(evidence[0]?.quote).toBe("Intelligence is mainly about doing");
    expect(evidence[0]?.start).toBe(0);
  });

  it("takes at most three pieces of evidence per question", () => {
    const dropped = emptyDropped();
    const evidence = validateEvidence(
      [
        { blockId: "spya-aaaaaa", quote: "A simulation of a rainstorm" },
        { blockId: "spya-bbbbbb", quote: "Intelligence is mainly about doing" },
        { blockId: "spya-cccccc", quote: "Brains are not computers" },
        { blockId: "spya-aaaaaa", quote: "does not make anything actually wet" },
      ],
      blocks,
      dropped,
    );
    expect(evidence).toHaveLength(MAX_EVIDENCE);
    expect(dropped.truncated).toBe(1);
  });

  it("drops a second question asking the same thing", () => {
    const dropped = emptyDropped();
    const one = {
      question: "What does a simulated rainstorm not do?",
      referenceAnswer: "It does not make anything wet.",
      evidence: [{ blockId: "spya-aaaaaa", quote: "does not make anything actually wet" }],
    };
    const quiz = buildQuiz(
      { questions: [one, { ...one, question: "  what does a Simulated Rainstorm not do?  " }] },
      { power: "standard", slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped },
    );
    expect(quiz.questions).toHaveLength(1);
    expect(dropped.duplicate).toBe(1);
  });

  it("drops a question with no question in it, or that is not an object at all", () => {
    /* A band the model invented used to be malformed too; since `quiz/5` a band
       is not read, so an unknown one is simply ignored ("stores no band or
       value", above). */
    const dropped = emptyDropped();
    const base = {
      question: "What does a simulated rainstorm not do?",
      referenceAnswer: "It does not make anything wet.",
      evidence: [{ blockId: "spya-aaaaaa", quote: "does not make anything actually wet" }],
    };
    expect(() =>
      buildQuiz(
        {
          questions: [
            { ...base, question: "   " },
            { ...base, question: undefined },
            null,
          ],
        },
        { power: "standard", slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped },
      ),
    ).toThrow();
    expect(dropped.malformed).toBe(3);
  });

  it("drops a question with no reference answer", () => {
    /* The reference answer is half the feature: it is what the mark is made
       against, and it is what a reader gets when they say "I don't know, tell
       me". A question without one is a question with nowhere to go. */
    const dropped = emptyDropped();
    expect(() =>
      buildQuiz(
        {
          questions: [
            {
              question: "What does a simulated rainstorm not do?",
              evidence: [{ blockId: "spya-aaaaaa", quote: "does not make anything actually wet" }],
            },
          ],
        },
        { power: "standard", slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped },
      ),
    ).toThrow();
    expect(dropped.malformed).toBe(1);
  });

  it("refuses to write an empty quiz when nothing survived", () => {
    /* An empty quiz is indistinguishable from a working one until a reader
       opens it, and writing one makes the step report done for ever after. */
    const dropped = emptyDropped();
    expect(() =>
      buildQuiz(
        {
          questions: [
            {
              question: "What does a simulated rainstorm not do?",
              referenceAnswer: "It does not make anything wet.",
              evidence: [{ blockId: "spya-zzzzzz", quote: "does not make anything actually wet" }],
            },
          ],
        },
        { power: "standard", slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped },
      ),
    ).toThrow(/nothing to write/);
  });

  it("refuses an answer with no questions array at all", () => {
    /* `{}` used to reach the loop, come back as `[]` and be written as a
       perfectly ordinary empty artefact. There is no legitimate empty case
       here — every article can be asked about — so both roads lead to a throw,
       and this one says which road it was. src/timeline.ts § `buildTimeline`. */
    expect(() =>
      buildQuiz({}, { power: "standard", slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped: emptyDropped() }),
    ).toThrow(/questions/);
  });
});

describe("the stamp the store will read off the artefact", () => {
  const quiz = buildQuiz(
    {
      questions: [
        {
          question: "What does a simulated rainstorm not do?",
          referenceAnswer: "It does not make anything wet.",
          evidence: [{ blockId: "spya-aaaaaa", quote: "does not make anything actually wet" }],
        },
      ],
    },
    { power: "standard", slug: "noema", blocks, sourceHash: "the-hash", elapsedMs: 12, dropped: emptyDropped() },
  );

  /**
   * **The single most important assertion in this file.**
   *
   * `stampOf` (src/store/artifacts.ts) reads `sourceHash`, `version` and
   * `generator` **off the artefact**. `inputHash`, `promptVersion` and `model`
   * are the in-memory `StepStamp` names and appear nowhere on disk. The first
   * draft of the plan used the in-memory ones: `stampOf(quiz)` would have
   * returned `{}`, `sameStamp` would have answered false on every comparison,
   * and the step would have re-run on every job for ever — writing a perfectly
   * good artefact each time, with nothing going red, because the artefact
   * parses and the ids resolve.
   *
   * A test that the artefact parses would not have caught it. This one does.
   */
  it("spells them sourceHash, version and generator", () => {
    expect(quiz.sourceHash).toBe("the-hash");
    expect(quiz.version).toBe(PROMPT_VERSION);
    expect(quiz.generator).toBe(CAPABLE_MODEL);
    for (const wrong of ["inputHash", "promptVersion", "model"]) {
      expect(quiz, `${wrong} is the in-memory name and must not be on disk`).not.toHaveProperty(
        wrong,
      );
    }
  });

  it("mints a batch id, and a fresh one each time", () => {
    const again = buildQuiz(
      {
        questions: [
          {
            question: "What does a simulated rainstorm not do?",
            referenceAnswer: "It does not make anything wet.",
            evidence: [{ blockId: "spya-aaaaaa", quote: "does not make anything actually wet" }],
          },
        ],
      },
      { power: "standard", slug: "noema", blocks, sourceHash: "the-hash", elapsedMs: 12, dropped: emptyDropped() },
    );
    expect(quiz.batchId).toMatch(/^spya-[a-z0-9]{6}$/);
    expect(again.batchId).not.toBe(quiz.batchId);
  });

  it("carries the counters, because a dropped question has no other tell", () => {
    expect(quiz.dropped).toEqual(emptyDropped());
  });
});

describe("the generation prompt", () => {
  /* Each of these is a finding from the spike on a real article, or a rule GPT
     Sol's review required. They are pinned by name because they are the kind of
     line a later tidy-up shortens out of a prompt without knowing what it was
     for. What they DO is evals/quiz.ts's question. */
  it("bans a question about where something sits in the piece", () => {
    /* The spike produced "in the closing argument…" — a question the reader,
       answering from memory with no article in front of them, cannot place. */
    expect(QUIZ_SYSTEM).toContain("A QUESTION ABOUT WHERE SOMETHING SITS IN THE PIECE");
  });

  it("states the and-ban as a shape rule rather than a preference", () => {
    expect(QUIZ_SYSTEM).toContain("ONE QUESTION MARK, ONE THING ASKED");
  });

  it("asks for full stops in the reference answer", () => {
    /* Every answer in the spike came back as one semicolon-spliced sentence. */
    expect(QUIZ_SYSTEM).toContain("WITH FULL STOPS");
  });

  it("names the reference answer as a draft rather than a key", () => {
    expect(QUIZ_SYSTEM).toContain("NOT AN ANSWER KEY");
  });

  /**
   * **The path, stated as the structure of the prompt** rather than as a
   * wish. The first probe without the premise field asked for "build on one
   * another" in prose and mostly got the article walked in document order
   * with nothing leaning on anything —
   * docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md
   * § The shape.
   */
  it("sets the quiz as a path that ends at the takeaways", () => {
    expect(QUIZ_SYSTEM).toContain("THE QUIZ IS A PATH");
    expect(QUIZ_SYSTEM).toMatch(/two to four takeaways/);
    expect(QUIZ_SYSTEM).toContain("END AT THE TAKEAWAYS");
  });

  it("asks for a premise that restates only the step immediately before", () => {
    /* The walk keys on the verdict for the question at index - 1
       (src/web/quiz-ladder.ts § `showPremise`), which is only right if the
       premise restates that step and no earlier one. GPT Sol's R2-1. */
    expect(QUIZ_SYSTEM).toContain("THE PREMISE — HOW A STEP LEANS ON THE ONE BEFORE");
    expect(QUIZ_SYSTEM).toContain("IMMEDIATELY BEFORE");
  });

  it("forbids a premise that gives the step away", () => {
    /* A premise is shown exactly when the reader is struggling, so one that
       carries this question's answer hands it over on the screens that matter
       most. `readPremise` in src/quiz.ts catches the verbatim case; this is the
       rule the model is given for the rest. */
    expect(QUIZ_SYSTEM).toContain("THE PREMISE RESTATES THE ANSWER JUST GIVEN, AND ADDS NOTHING");
  });

  it("treats a premise that says something no question asked as a missing step", () => {
    /* Added after the eval run: a premise carrying a fact the path never asked
       for is a step the model skipped, stated as given — and the reader shown
       it is told something they were never asked to work out. */
    expect(QUIZ_SYSTEM).toContain("IF THE PREMISE SAYS SOMETHING NO QUESTION ASKED, A STEP IS MISSING.");
  });

  it("requires the question to stand on its own, because the premise is sometimes hidden", () => {
    /* A reader who got the step before right sees the question alone; "why
       does this rule it out?" would then be a question about nothing. */
    expect(QUIZ_SYSTEM).toContain("THE QUESTION MUST BE A WHOLE QUESTION WITHOUT ITS PREMISE");
  });

  it("keeps every step small", () => {
    /* SPIDERYARN-READING2-21, Greg, 2026-09-05: *"The quiz questions are too
       hard. Certainly, they should start much, much easier."* Since the path,
       "easy" is not a band the model picks but the size of every step. */
    expect(QUIZ_SYSTEM).toContain("EVERY QUESTION IS SMALL");
    expect(QUIZ_SYSTEM).toContain("ONE OR TWO SENTENCES");
    expect(QUIZ_SYSTEM).toMatch(/without effort/);
    expect(QUIZ_SYSTEM).toContain("A PREMISE DOES NOT MAKE A BIG STEP SMALL");
  });

  it("asks for the questions to be about what the argument leans on", () => {
    /* The other half of READING2-21: *"they should focus on what's most
       important."* A rule about which questions get SET. */
    expect(QUIZ_SYSTEM).toContain("KEEP TO WHAT MATTERS");
  });

  it("says nothing about a reader in the constant prompt", () => {
    /* 261001c, GPT Sol's plan review F8: a conditional paragraph still speaks
       to a model whose condition is absent, so the reader rules are a block of
       their own, sent only with a profile (tests/quiz-step-registration.test.ts
       asks the request). */
    expect(QUIZ_SYSTEM).not.toMatch(/note about the reader|reason for reading|WHO IS READING/);
  });

  it("lets a reading reason move most of the path towards its takeaways", () => {
    /* SPIDERYARN-READING2-6Q. Merely carrying the profile to the request is not
       the feature: without these rules the model has no instruction to change
       the proportions, and every plumbing test still passes. */
    expect(QUIZ_READER_RULES).toContain("WHICH PARTS");
    expect(QUIZ_READER_RULES).toMatch(/choose the\s+takeaways that matter for that reason/);
    expect(QUIZ_READER_RULES).toMatch(/spend most of the questions on the\s+parts of the piece that bear on it/);
  });

  it("lets who is reading move the path, the kind of question and the pitch", () => {
    /* Greg, 2026-10-01, reversing 6Q's "About moves only the vocabulary":
       *"Quiz should definitely adapt heavily based on User-profile and
       Why-are-you-reading"*. docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md. */
    expect(QUIZ_READER_RULES).toMatch(/A line\s+about who they are moves the path too/);
    expect(QUIZ_READER_RULES).toMatch(/the reason leads and who they are chooses within\s+it/);
    expect(QUIZ_READER_RULES).toMatch(/Two readers with the same reason and different work should\s+get visibly different quizzes/);
    expect(QUIZ_READER_RULES).toContain("WHAT KIND OF QUESTION");
    expect(QUIZ_READER_RULES).toContain("HOW IT IS PITCHED");
    expect(QUIZ_READER_RULES).not.toContain("ONLY THE REASON FOR READING MOVES THE PATH");
    expect(QUIZ_READER_RULES).not.toMatch(/no reason for reading, set the ordinary path/);
  });

  it("keeps the piece's own point on the path however narrow the goal", () => {
    /* The failure Greg's answer invites: a strong goal that skips what the
       piece is for. */
    expect(QUIZ_READER_RULES).toContain("THE PIECE'S POINT IS STILL ON THE PATH");
    expect(QUIZ_READER_RULES).toMatch(/normally three or\s+four in a path of twenty, one or two in a short one/);
    /* Round 1 of the eval got one closing question and no evidence. */
    expect(QUIZ_READER_RULES).toContain("ask for the evidence too");
    expect(QUIZ_READER_RULES).toMatch(/Take\s+these steps from setup, not from the steps about what they are after/);
    expect(QUIZ_READER_RULES).toContain("Do not pad");
  });

  it("keeps the note about the reader out of questions, premises and answers", () => {
    expect(QUIZ_READER_RULES).toMatch(
      /never say or hint that a note was given — in\s+a question, a premise or a reference answer/i,
    );
    expect(QUIZ_READER_RULES).toContain("Nothing is asked \"because\" of it");
  });

  it("asks for no band, no spread and no value any more", () => {
    /* The three fields the path replaced. A prompt that still asked for them
       would spend the model's attention on a judgement nothing reads, and the
       validator would silently drop what it produced. */
    expect(QUIZ_SYSTEM).not.toMatch(/\bBAND\b|\bSPREAD\b|\bVALUE\b/);
    expect(QUIZ_SYSTEM).not.toMatch(/"band"|"value"|at least (three|five) "(easy|hard)"/);
  });

  it("does not promise a retry that does not exist, or describe the gate at all", () => {
    /* The prompt used to tell the model a failing batch meant "the article is
       asked again". Nothing retries at any layer, so that was a false promise
       the model was reasoning against — the whole reason the section was
       touched on 2026-09-03.

       The assertion above only pins the sentence that did NOT change, so it
       would watch the false one come back without a word. This is the negative
       half, and it is deliberately wider than the one sentence: any description
       of what our gate does is a description that goes stale when the gate
       moves, which is exactly what happened here within a day — and the gate it
       described, the band spread, is itself gone since 2026-09-30. */
    expect(QUIZ_SYSTEM).not.toMatch(/asked again|thrown away whole|press the button/i);
  });

  it("tells the model an unanchored question is thrown away", () => {
    expect(QUIZ_SYSTEM).toContain("copied VERBATIM");
  });
});

describe("the marking prompt", () => {
  /**
   * **The section GPT Sol's finding 1 is entirely about**, and the one thing
   * this feature is most likely to get wrong: the reference answer is model
   * prose written before anybody answered, and a marker that treats it as a
   * rubric will tell a reader who is right that they are wrong.
   */
  it("makes the article the authority and the reference a fallible draft", () => {
    expect(QUIZ_MARK_SYSTEM).toContain("SOURCE OF AUTHORITY");
    expect(QUIZ_MARK_SYSTEM).toContain("IT IS NOT A RUBRIC OR AN ANSWER KEY");
    expect(QUIZ_MARK_SYSTEM).toContain("THE ARTICLE WINS");
  });

  it("tells it to side with the reader against a wrong reference", () => {
    expect(QUIZ_MARK_SYSTEM).toContain(
      "Never reject an answer merely because it differs from the reference answer",
    );
    expect(QUIZ_MARK_SYSTEM).toMatch(/DEFEND THE READER AGAINST THE REFERENCE/);
  });

  it("keeps Remember mode's entitlement rules, which are the ones that cost", () => {
    expect(QUIZ_MARK_SYSTEM).toContain("A CORRECTION MAY NOT BE BUILT OUT OF YOUR OWN INFERENCE");
    expect(QUIZ_MARK_SYSTEM).toContain("DISAGREEING WITH THE AUTHOR IS NOT GETTING IT WRONG");
    expect(QUIZ_MARK_SYSTEM).toContain("A SHORTER ANSWER IS NOT A WORSE ANSWER");
  });

  it("draws the line between confirming a claim and grading a reader", () => {
    /* "The article supports X" confirms a claim; "your answer was correct"
       grades the reader. A quiz question has a right answer, so confirming is
       allowed here where it is not in free recall — which is exactly why the
       line has to be drawn in words rather than left to tone. */
    expect(QUIZ_MARK_SYSTEM).toContain("CONFIRMING IS NOT GRADING");
    expect(QUIZ_MARK_SYSTEM).toContain("NO SCORE, NO GRADE, NO MARK");
    expect(QUIZ_MARK_SYSTEM).toContain("NO INVENTORY");
  });

  it("protects a mis-transcribed word from being read as a misunderstanding", () => {
    expect(QUIZ_MARK_SYSTEM).toMatch(/more likely the transcript than\s+the reader/);
  });

  it("says an unsettled question is unsettled rather than picking a side", () => {
    expect(QUIZ_MARK_SYSTEM).toContain("more than the article establishes");
  });
});

/**
 * **The instrument, not the rule.** `gradeWords` counts what the prompt already
 * forbids, on every real mark, because eight eval cases cannot tell a leak from
 * noise — Stage 1 ran one prompt twice and scored 0 and 3.
 *
 * The assertions below are anchored to **sentences the marker actually wrote**
 * in `evals/results/quiz.md`, not to invented examples. A counter tested only
 * against phrases somebody made up is a counter that agrees with whoever wrote
 * it; these three got past a prompt that names them by hand.
 */
describe("counting the marks that graded the reader", () => {
  it("sees the three that got past the prompt in the committed run", () => {
    expect(
      gradeWords("the general principle and its application are both present and correctly tied together"),
    ).toBe(1);
    expect(gradeWords("— anthropocentrism and anthropomorphism — correctly described.")).toBe(1);
    expect(gradeWords("The reader's answer tracks the article's actual point.")).toBe(1);
  });

  it("leaves a reply that is about the article alone", () => {
    expect(
      gradeWords("Yes — the piece does tie it to the cost of retraining [spya-k3m9qt]."),
    ).toBe(0);
  });

  it("counts phrases rather than places, so one word twice is one", () => {
    expect(gradeWords("correctly, and again correctly")).toBe(1);
  });

  /* The drift this pairing exists to stop: the prompt naming a word by hand and
     the counter being unable to see it. Every word the prompt lists in its
     "words that are a mark whatever sentence they sit in" paragraph is here. */
  it("counts every word the prompt names in that paragraph", () => {
    /* Whitespace-normalised, because the prompt is hard-wrapped and `"nicely
       put"` is split across a line break in it. A model reads that as one
       phrase; a substring check does not, and the first version of this test
       failed on the prompt rather than on anything wrong. */
    const prompt = QUIZ_MARK_SYSTEM.toLowerCase().replace(/\s+/g, " ");
    for (const word of ["correctly", "rightly", "tracks the article", "holds up", "spot on", "nicely put"]) {
      expect(prompt, `the prompt no longer names "${word}"`).toContain(word);
      expect(GRADE_WORDS as readonly string[], `nothing counts "${word}"`).toContain(word);
    }
  });
});
