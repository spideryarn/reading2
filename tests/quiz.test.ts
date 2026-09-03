/**
 * **The quiz stage's pure half** — ordering, the band spread, and what
 * validation throws away. No network, no model.
 *
 * Every case here is a way the stage would be wrong *quietly*. A quiz that
 * comes back with twelve plausible questions about nothing in particular looks
 * exactly like one that works (docs/reusable/silent-success.md), so the things
 * worth pinning are the ones with no visible symptom:
 *
 * - **the order**, because the first draft of the plan proposed `ease + value`
 *   and a test asserting the behaviour it produces, which is the opposite of
 *   what Greg asked for. See `puts an easy peripheral question before a hard
 *   central one` below — it is the assertion that goes red on the wrong rule;
 * - **the spread**, because a model asked nicely for one does not give it (the
 *   spike measured `ease` never leaving 2–4 across 24 questions);
 * - **the drops**, because a dropped question is indistinguishable from one the
 *   model chose not to set;
 * - **the stamp field names**, because getting those wrong makes every quiz
 *   permanently non-current with nothing anywhere going red. That one is the
 *   whole of GPT Sol's finding 3 on the plan.
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
  QUIZ_SYSTEM,
  SPREAD_FROM,
  buildQuiz,
  emptyDropped,
  missingBandEnds,
  orderQuestions,
  validateEvidence,
} from "../src/quiz.js";
import { GRADE_WORDS, gradeWords, QUIZ_MARK_SYSTEM } from "../src/quiz-mark.js";
import { readerFailureOf } from "../src/job-failure.js";
import { kindOfMessage, worthRetrying } from "../src/messages.js";
import { CAPABLE_MODEL } from "../src/models.js";
import type { Block, QuizBand, QuizQuestion } from "../src/types.js";

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

const question = (
  id: string,
  band: QuizBand,
  value: number,
  blockId = "spya-aaaaaa",
): QuizQuestion => ({
  id,
  question: `What about ${id}?`,
  referenceAnswer: "Something the article says.",
  evidence: [{ blockId, quote: "a quote", start: 0 }],
  band,
  value,
});

const ids = (questions: readonly QuizQuestion[]): string[] => questions.map((q) => q.id);

describe("the order the reader meets the questions in", () => {
  /**
   * **THE test of this file.**
   *
   * Greg asked for "easy-first-then-getting-harder, and central-or-important-
   * first", in that order. The first draft of the plan implemented it as
   * `ease + value` descending, under which hard-central `(ease 1, value 5)` and
   * easy-peripheral `(ease 5, value 1)` both sum to 6 and the value tie-break
   * then puts the **hard** one first — the exact reverse of the first clause.
   * The plan even proposed a test asserting that. GPT Sol's finding 4.
   *
   * So this is the assertion the previous design got backwards, written out the
   * right way round and commented so nobody "fixes" it back.
   */
  it("puts an easy peripheral question before a hard central one", () => {
    const easyPeripheral = question("spya-easy01", "easy", 1);
    const hardCentral = question("spya-hard01", "hard", 5);
    expect(ids(orderQuestions([hardCentral, easyPeripheral], blocks))).toEqual([
      "spya-easy01",
      "spya-hard01",
    ]);
  });

  it("runs easy, then medium, then hard, whatever the values say", () => {
    const given = [
      question("spya-hard01", "hard", 5),
      question("spya-med001", "medium", 5),
      question("spya-easy01", "easy", 1),
    ];
    expect(ids(orderQuestions(given, blocks))).toEqual([
      "spya-easy01",
      "spya-med001",
      "spya-hard01",
    ]);
  });

  it("puts the central question first WITHIN a band", () => {
    const given = [question("spya-easy01", "easy", 2), question("spya-easy02", "easy", 5)];
    expect(ids(orderQuestions(given, blocks))).toEqual(["spya-easy02", "spya-easy01"]);
  });

  it("breaks a tie by where the answer sits on the page", () => {
    /* Ties are the common case rather than the edge case — the spike found four
       distinct sums over twelve questions — so "then the model's own order"
       would mean *arbitrary* for most of the list. Document order is the honest
       answer to "these two are equally easy and equally central", and it reads
       well: a tied group arrives in the order the reader met it. */
    const later = question("spya-late01", "medium", 3, "spya-cccccc");
    const earlier = question("spya-erly01", "medium", 3, "spya-aaaaaa");
    expect(ids(orderQuestions([later, earlier], blocks))).toEqual([
      "spya-erly01",
      "spya-late01",
    ]);
  });

  it("sorts a question whose evidence is in no known block last, not first", () => {
    /* `toQuestions` drops these, so this is defence in depth — but the wrong
       answer here is the dangerous one: an unknown block position defaulting to
       0 would put a question nobody can check at the top of the list. */
    const unknown = question("spya-unkn01", "medium", 3, "spya-zzzzzz");
    const known = question("spya-know01", "medium", 3, "spya-cccccc");
    expect(ids(orderQuestions([unknown, known], blocks))).toEqual([
      "spya-know01",
      "spya-unkn01",
    ]);
  });

  it("leaves the input array alone", () => {
    const given = [question("spya-hard01", "hard", 5), question("spya-easy01", "easy", 1)];
    orderQuestions(given, blocks);
    expect(ids(given)).toEqual(["spya-hard01", "spya-easy01"]);
  });
});

describe("both ends of the band scale", () => {
  /* Asking nicely does not work — the spike's two runs produced 24 questions
     and `ease` never left 2–4 on either. So a batch is *required* to use both
     ends, and one that uses neither is a failed generation.

     **What "required" means changed on 2026-09-03.** It used to be a
     proportion, `min(3, floor(n / 4))`, and the tests that pinned that
     arithmetic are gone with it — see `missingBandEnds` in src/quiz.ts and
     docs/plans/260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md
     for why the proportion was the wrong thing to be measuring. The two things
     those tests were protecting survive here: a batch too short to carry a
     spread is asked for nothing, and a full batch that came back flat fails.
     The third — "three of each end of a full twelve" — is now the *prompt's*
     target rather than the gate's floor, and is pinned in "the generation
     prompt" below. */

  /**
   * Every batch size the rule applies to — generated rather than listed,
   * because a hand-picked list is how the first draft of this block claimed to
   * cover every gated size while skipping 6, 7, 10 and 11.
   */
  const gated = Array.from({ length: MAX_QUESTIONS - SPREAD_FROM + 1 }, (_, i) => SPREAD_FROM + i);

  /** `n` questions, of which one is `easy`, one is `hard`, and the rest medium. */
  const oneOfEachEnd = (n: number): QuizQuestion[] => [
    question("spya-easy01", "easy", 4),
    question("spya-hard01", "hard", 5),
    ...Array.from({ length: n - 2 }, (_, i) =>
      question(`spya-med0${String(i).padStart(2, "0")}`, "medium", 3),
    ),
  ];

  /** `n` questions with `band` at one end and nothing at the other. */
  const oneEndOnly = (n: number, band: QuizBand): QuizQuestion[] => [
    question("spya-end001", band, 4),
    ...Array.from({ length: n - 1 }, (_, i) =>
      question(`spya-med0${String(i).padStart(2, "0")}`, "medium", 3),
    ),
  ];

  it.each(gated)("is satisfied at %i by one question at each end", (n) => {
    /* One of each is the whole rule, at every gated size. The batch that failed
       in production — nine questions, one `hard` — differs from this only in
       the count, which is exactly the thing that should not have mattered. */
    expect(missingBandEnds(oneOfEachEnd(n))).toEqual([]);
  });

  it.each(gated)("names the missing end at %i when the batch reaches only one", (n) => {
    expect(missingBandEnds(oneEndOnly(n, "easy"))).toEqual(["hard"]);
    expect(missingBandEnds(oneEndOnly(n, "hard"))).toEqual(["easy"]);
  });

  it("names both ends of a batch that has neither", () => {
    const flat = Array.from({ length: MAX_QUESTIONS }, (_, i) =>
      question(`spya-med0${String(i).padStart(2, "0")}`, "medium", 3),
    );
    expect(missingBandEnds(flat)).toEqual(["easy", "hard"]);
  });

  it("asks nothing of a batch one question short of the boundary", () => {
    /* The exemption side of `SPREAD_FROM`, and the reason it exists: a
       three-question article is not a failed generation. "Up to twelve, fewer
       where the article does not support twelve" is the count rule, and a
       spread rule firing here would turn that ceiling into a floor and so
       instruct the model to pad. */
    const short = Array.from({ length: SPREAD_FROM - 1 }, (_, i) =>
      question(`spya-med0${String(i).padStart(2, "0")}`, "medium", 3),
    );
    expect(missingBandEnds(short)).toEqual([]);
    expect(missingBandEnds([])).toEqual([]);
    expect(missingBandEnds([question("spya-med001", "medium", 3)])).toEqual([]);
  });

  it("asks for both ends the moment the batch reaches the boundary", () => {
    /* The other side of the same line. Both sides are asserted because the
       boundary is a product decision rather than a fact about arithmetic, and
       the old rule's boundary fell out of a `floor()` where nobody could see
       it. */
    const atBoundary = Array.from({ length: SPREAD_FROM }, (_, i) =>
      question(`spya-med0${String(i).padStart(2, "0")}`, "medium", 3),
    );
    expect(missingBandEnds(atBoundary)).toEqual(["easy", "hard"]);
  });

  it("builds the batch production rejected: nine questions, one of them hard", () => {
    /* The reported failure, 2026-09-03. Nine survivors with a single `hard`
       question were refused because the old quota wanted two — discarding a
       paid 36-second call over a batch that carries both ends and orders
       perfectly well. It has to build. */
    const bands = [
      "easy",
      "easy",
      "easy",
      "medium",
      "medium",
      "medium",
      "medium",
      "medium",
      "hard",
    ];
    const quiz = buildQuiz(
      {
        questions: bands.map((band, i) => ({
          question: `Question number ${i}?`,
          referenceAnswer: "Because the article says so.",
          band,
          value: 3,
          evidence: [{ blockId: "spya-aaaaaa", quote: "does not make anything actually wet" }],
        })),
      },
      { slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped: emptyDropped() },
    );
    expect(quiz.questions).toHaveLength(9);
    expect(quiz.questions.filter((q) => q.band === "hard")).toHaveLength(1);
  });

  it("fails the stage rather than writing a full batch with no spread", () => {
    const questions = Array.from({ length: 12 }, (_, i) => ({
      question: `Question number ${i}?`,
      referenceAnswer: "Because the article says so.",
      band: "medium",
      value: 3,
      evidence: [{ blockId: "spya-aaaaaa", quote: "does not make anything actually wet" }],
    }));
    /* The reader's half, which is where that sentence lives now — `.toThrow`
       matches `Error.message`, and `Error.message` is the diagnostic since the
       seam split the two audiences (src/job-failure.ts § Two strings, not one). */
    expect(readerOf(questions)).toMatch(/all came out at the same middling level/);
  });

  /**
   * **The refusal, taken apart into its two audiences.**
   *
   * Since stage 2 of
   * docs/plans/260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md
   * a refused batch throws *two* sentences: `Error.message` is the diagnostic,
   * for the log and Sentry, and `readerFailureOf` is what src/jobs.ts persists
   * onto `job.error` and `step.error` and the band renders in red. Every
   * assertion below has to say which one it is about, and the copy rules apply
   * to the second.
   *
   * The step label handed to `readerFailureOf` is only used by the *generic*
   * sentence, which none of these reach — every one of them declares its own.
   * It is spelled out rather than imported from `STEPS` so this file stays a
   * test of the quiz's pure half and drags in no pipeline.
   */
  const STEP_LABEL = "Writing the questions";

  const refused = (
    bands: readonly string[],
    quote = "does not make anything actually wet",
  ): { reader: string; diagnostic: string } => {
    const questions = bands.map((band, i) => ({
      question: `Question number ${i}?`,
      referenceAnswer: "Because the article says so.",
      band,
      value: 3,
      evidence: [{ blockId: "spya-aaaaaa", quote }],
    }));
    try {
      buildQuiz(
        { questions },
        { slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped: emptyDropped() },
      );
    } catch (err) {
      return {
        reader: readerFailureOf(err, STEP_LABEL).message,
        diagnostic: (err as Error).message,
      };
    }
    throw new Error("the batch was supposed to be refused");
  };

  /** Just the reader's half, which is what most of the cases below are about. */
  const failing = (bands: readonly string[], quote?: string): string =>
    (quote === undefined ? refused(bands) : refused(bands, quote)).reader;

  /** The same, from a raw question list rather than a list of bands. */
  const readerOf = (questions: readonly unknown[]): string => {
    try {
      buildQuiz(
        { questions },
        { slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped: emptyDropped() },
      );
    } catch (err) {
      return readerFailureOf(err, STEP_LABEL).message;
    }
    throw new Error("the batch was supposed to be refused");
  };

  /** `n` bands: `band` once, then medium. */
  const oneEndOnlyBands = (band: string, n: number): string[] =>
    Array.from({ length: n }, (_, i) => (i === 0 ? band : "medium"));

  it("names the end that is missing, and counts what survived rather than what was sent", () => {
    /* The count is the one GPT Sol reproduced and the reason this test grew a
       second case. `fresh.length` is survivors, so a message saying the service
       "wrote" that many is false whenever validation dropped anything — twelve
       back with seven unanchored reported five written. Both cases below assert
       the count, and the dropped-heavy one is what makes the wording load-
       bearing rather than incidental. */
    const noHard = failing(oneEndOnlyBands("easy", 5));
    expect(noHard).toContain("5 survived checking");
    expect(noHard).toContain("no hard one among them");

    const noEasy = failing(oneEndOnlyBands("hard", 7));
    expect(noEasy).toContain("7 survived checking");
    expect(noEasy).toContain("no easy one among them");

    /* Twelve sent, seven of them naming a quote the article does not contain,
       so five survive and the sentence must describe five *survivors*. */
    const afterDrops = readerOf(
      Array.from({ length: 12 }, (_, i) => ({
        question: `Question number ${i}?`,
        referenceAnswer: "Because the article says so.",
        band: i === 0 ? "easy" : "medium",
        value: 3,
        evidence: [
          {
            blockId: "spya-aaaaaa",
            quote: i < 5 ? "does not make anything actually wet" : "a sentence the article lacks",
          },
        ],
      })),
    );
    expect(afterDrops).toContain("5 survived checking");
    /* Twelve is the number the *diagnostic* carries — the reader is told what
       survived and nothing about what was sent, because the difference is a
       validator's business. */
    expect(afterDrops).not.toContain("12");
  });

  it("does not overstate what a batch missing one end would read like", () => {
    /* Five easy-and-medium questions with no hard one DO build up from easier
       to harder; they just stop short of the hard end. An earlier draft said
       they "would not build up from easier to harder", which is a claim about
       the batch that is plainly false to anyone looking at it — GPT Sol's, and
       the kind of overstatement that makes a reader distrust the rest. */
    const noHard = failing(oneEndOnlyBands("easy", 5));
    expect(noHard).toContain("would not cover the full range");
    expect(noHard).not.toContain("would not build up");
  });

  it("carries nothing a reader cannot act on, and says what they can", () => {
    /* What went wrong in production was not a missing fact but three extra
       ones: a source-file reference, a section name, and an instruction
       addressed to whoever tunes the prompt.

       Note what is NOT excluded. The words `easy` and `hard` appear, doing
       ordinary work in an English sentence — "no hard one among them" is not
       jargon. What the regex rejects is the band as a *quoted name*, which is
       our vocabulary for a scale the panel never shows
       (src/web/QuizPanel.tsx sees neither band nor value). */
    const both = [failing(oneEndOnlyBands("easy", 5)), failing(oneEndOnlyBands("hard", 7))];
    for (const message of both) {
      expect(message).not.toMatch(/src\/|\.ts|§|prompt|wanted|"easy"|"hard"|"medium"/);
      /* Something to do, said as copy.md rule 3 asks — how it usually goes,
         rather than a bare "try again", and in the words on the button the
         reader is looking at ("Write the questions" / "Write them again",
         src/web/QuizPanel.tsx). Trying again is what Greg had to guess at on the
         day, and it worked. */
      expect(message).toContain("Writing the questions again usually");
    }
  });

  /**
   * **The seam, from this side of it.**
   *
   * tests/step-failure-seam.test.ts proves that an *undeclared* error cannot
   * reach the reader; this proves the other half for the failure that started
   * it. The band arithmetic and the pointer to the prompt were what Greg was
   * shown in production on 2026-09-03. They are still written — a 1-in-4
   * failure rate is exactly what somebody wants those figures for — they just
   * go to the log now.
   */
  it("keeps the arithmetic for the log and out of the reader's sentence", () => {
    const { reader, diagnostic } = refused(oneEndOnlyBands("easy", 9));

    /* The reader's half: a code to quote, and none of the three things
       docs/project/copy.md says must not be there. */
    expect(reader).toMatch(/\[quiz-spread\]$/);
    expect(reader).not.toContain("src/quiz.ts");
    expect(reader).not.toMatch(/easy 1, medium 8/);

    /* The developer's: the counts, the band as a name, and the thing to change
       if this keeps happening. Asserted rather than assumed, because a split
       that quietly dropped the diagnostic would look exactly like a split that
       worked. */
    expect(diagnostic).toContain("9 of 9 survived");
    expect(diagnostic).toContain("missing hard");
    expect(diagnostic).toContain("easy 1, medium 8, hard 0");
    expect(diagnostic).toContain("src/quiz.ts");
    /* And they really are two strings, not one string read twice. */
    expect(diagnostic).not.toBe(reader);
  });

  /**
   * `retry`, and it has to be declared rather than inferred: the sentence used
   * to carry no code at all, so `failureKindOf` answered `undefined` and the
   * button survived by the compatibility rule rather than by anybody meaning
   * it. Now it is meant. src/job-failure.ts § Which way to be wrong.
   */
  it("says out loud that another go is worth having", () => {
    const { reader } = refused(oneEndOnlyBands("easy", 9));
    expect(kindOfMessage(reader)).toBe("retry");
    expect(worthRetrying(reader)).toBe(true);
  });

  /**
   * The other refusal in the same function, migrated with it: every question
   * naming a passage the article does not contain. Its old sentence was a tally
   * of five drop reasons, which is a debugging aid on a reader's screen.
   */
  it("tells the reader why there are no questions without reciting the drop counts", () => {
    const { reader, diagnostic } = refused(
      oneEndOnlyBands("easy", 5),
      "a sentence this article does not contain",
    );
    expect(reader).toMatch(/\[quiz-unanchored\]$/);
    expect(reader).toContain("could be tied back to a passage");
    expect(reader).not.toMatch(/malformed|duplicates|block id/);
    expect(diagnostic).toContain("malformed");
    expect(diagnostic).toContain("duplicates");
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
              band: "easy",
              value: 4,
              evidence: [{ blockId: "spya-zzzzzz", quote: "does not make anything actually wet" }],
            },
          ],
        },
        { slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped },
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
            band: "easy",
            value: 4,
            evidence: [
              { blockId: "spya-aaaaaa", quote: "a sentence the article never contains at all" },
              { blockId: "spya-aaaaaa", quote: "does not make anything actually wet" },
            ],
          },
        ],
      },
      { slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped },
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
      band: "easy",
      value: 4,
      evidence: [{ blockId: "spya-aaaaaa", quote: "does not make anything actually wet" }],
    };
    const quiz = buildQuiz(
      { questions: [one, { ...one, question: "  what does a Simulated Rainstorm not do?  " }] },
      { slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped },
    );
    expect(quiz.questions).toHaveLength(1);
    expect(dropped.duplicate).toBe(1);
  });

  it("drops a question with no band, or a band it invented", () => {
    const dropped = emptyDropped();
    const base = {
      question: "What does a simulated rainstorm not do?",
      referenceAnswer: "It does not make anything wet.",
      value: 4,
      evidence: [{ blockId: "spya-aaaaaa", quote: "does not make anything actually wet" }],
    };
    expect(() =>
      buildQuiz(
        {
          questions: [
            { ...base, band: "trivial" },
            { ...base, question: "And another?", band: undefined },
            null,
          ],
        },
        { slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped },
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
              band: "easy",
              value: 4,
              evidence: [{ blockId: "spya-aaaaaa", quote: "does not make anything actually wet" }],
            },
          ],
        },
        { slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped },
      ),
    ).toThrow();
    expect(dropped.malformed).toBe(1);
  });

  it("keeps twelve and counts the rest", () => {
    const bands: QuizBand[] = ["easy", "easy", "easy", "hard", "hard", "hard"];
    const questions = Array.from({ length: 15 }, (_, i) => ({
      question: `Question number ${i}?`,
      referenceAnswer: "Because the article says so.",
      band: bands[i] ?? "medium",
      value: 3,
      evidence: [{ blockId: "spya-aaaaaa", quote: "does not make anything actually wet" }],
    }));
    const dropped = emptyDropped();
    const quiz = buildQuiz(
      { questions },
      { slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped },
    );
    expect(quiz.questions).toHaveLength(MAX_QUESTIONS);
    expect(dropped.overCap).toBe(3);
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
              band: "easy",
              value: 4,
              evidence: [{ blockId: "spya-zzzzzz", quote: "does not make anything actually wet" }],
            },
          ],
        },
        { slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped },
      ),
    ).toThrow(/nothing to write/);
  });

  it("refuses an answer with no questions array at all", () => {
    /* `{}` used to reach the loop, come back as `[]` and be written as a
       perfectly ordinary empty artefact. There is no legitimate empty case
       here — every article can be asked about — so both roads lead to a throw,
       and this one says which road it was. src/timeline.ts § `buildTimeline`. */
    expect(() =>
      buildQuiz({}, { slug: "x", blocks, sourceHash: "hash", elapsedMs: 1, dropped: emptyDropped() }),
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
          band: "easy",
          value: 4,
          evidence: [{ blockId: "spya-aaaaaa", quote: "does not make anything actually wet" }],
        },
      ],
    },
    { slug: "noema", blocks, sourceHash: "the-hash", elapsedMs: 12, dropped: emptyDropped() },
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
            band: "easy",
            value: 4,
            evidence: [{ blockId: "spya-aaaaaa", quote: "does not make anything actually wet" }],
          },
        ],
      },
      { slug: "noema", blocks, sourceHash: "the-hash", elapsedMs: 12, dropped: emptyDropped() },
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

  it("asks for the spread structurally, in both bands", () => {
    expect(QUIZ_SYSTEM).toContain("THE SPREAD IS NOT OPTIONAL");
    expect(QUIZ_SYSTEM).toMatch(/at least three "easy" and at least three "hard"/);
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
       moves, which is exactly what happened here within a day. State the target
       and let src/quiz.ts § missingBandEnds enforce the floor. */
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
