/**
 * **The quiz stage's pure half** — ordering, band quotas, and what validation
 * throws away. No network, no model.
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
 * - **the quotas**, because a model asked nicely for a spread does not give one
 *   (the spike measured `ease` never leaving 2–4 across 24 questions);
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
  bandQuota,
  buildQuiz,
  emptyDropped,
  orderQuestions,
  quotaShortfall,
  validateEvidence,
} from "../src/quiz.js";
import { QUIZ_MARK_SYSTEM } from "../src/quiz-mark.js";
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

describe("the band quota", () => {
  /* Asking nicely does not work — the spike's two runs produced 24 questions
     and `ease` never left 2–4 on either. So the batch is *required* to use both
     ends, and a batch that does not is a failed generation.

     The quota scales with the batch, which is the decision the plan left open:
     "at least three easy and three hard" is right for a full twelve and is an
     instruction to pad a piece that only supports four questions. See
     `bandQuota` in src/quiz.ts. */
  it("wants three of each end in a full batch", () => {
    expect(bandQuota(MAX_QUESTIONS)).toBe(3);
  });

  it("asks nothing of a batch too short to carry a spread", () => {
    expect(bandQuota(0)).toBe(0);
    expect(bandQuota(3)).toBe(0);
  });

  it("scales in between rather than jumping", () => {
    expect(bandQuota(4)).toBe(1);
    expect(bandQuota(8)).toBe(2);
    expect(bandQuota(11)).toBe(2);
  });

  it("reports both ends of a full batch that has neither", () => {
    const all = Array.from({ length: 12 }, (_, i) =>
      question(`spya-med0${String(i).padStart(2, "0")}`, "medium", 3),
    );
    expect(quotaShortfall(all)).toEqual([
      { band: "easy", want: 3, have: 0 },
      { band: "hard", want: 3, have: 0 },
    ]);
  });

  it("is satisfied by a batch that uses both ends", () => {
    const spread: QuizQuestion[] = [
      ...Array.from({ length: 3 }, (_, i) => question(`spya-easy0${i}`, "easy", 4)),
      ...Array.from({ length: 6 }, (_, i) => question(`spya-med00${i}`, "medium", 3)),
      ...Array.from({ length: 3 }, (_, i) => question(`spya-hard0${i}`, "hard", 5)),
    ];
    expect(quotaShortfall(spread)).toEqual([]);
  });

  it("asks nothing of a legitimately short batch", () => {
    /* A three-question article is not a failed generation. "Up to twelve, fewer
       where the article does not support twelve" is the count rule, and a quota
       that fired here would turn it into a floor. */
    expect(quotaShortfall([question("spya-med001", "medium", 3)])).toEqual([]);
  });

  it("fails the stage rather than writing a full batch with no spread", () => {
    const questions = Array.from({ length: 12 }, (_, i) => ({
      question: `Question number ${i}?`,
      referenceAnswer: "Because the article says so.",
      band: "medium",
      value: 3,
      evidence: [{ blockId: "spya-aaaaaa", quote: "does not make anything actually wet" }],
    }));
    expect(() =>
      buildQuiz(
        { questions },
        {
          slug: "x",
          blocks,
          sourceHash: "hash",
          elapsedMs: 1,
          dropped: emptyDropped(),
        },
      ),
    ).toThrow(/easy/);
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

  it("asks for the quota structurally, in both bands", () => {
    expect(QUIZ_SYSTEM).toContain("THE SPREAD IS NOT OPTIONAL");
    expect(QUIZ_SYSTEM).toMatch(/at least three "easy" and at least three "hard"/);
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
