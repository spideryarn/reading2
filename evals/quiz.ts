/**
 * Eval — do the quiz's two prompts behave?
 *
 *     npm run eval:quiz                  # the committed corpus article
 *     npm run eval:quiz -- --marks-only
 *     npm run eval:quiz -- <dir with blocks.json + tree.json>
 *
 * **This one spends money**, and it is the reason stage 1 of
 * docs/plans/260831al-review-quiz-sub-mode.md is prompts-and-eval with no
 * routes, no store and no panel. In this feature the prompt *is* the product:
 * the artefact, the band and the ordering are plumbing around two pages of
 * instructions, and nothing deterministic can tell you whether those two pages
 * work. tests/quiz.test.ts pins where the words are; only a model can say what
 * they do.
 *
 * ## Two halves, and they are independent on purpose
 *
 * **Generation** runs the real stage against the real article and prints every
 * question, so the first thing anybody looks at is a real batch. Read it for
 * the things the spike found and the prompt now bans: a question about where
 * something sits in the piece, two questions joined by "and", a reference
 * answer that is one semicolon-spliced sentence, a batch bunched in the middle
 * of the band scale.
 *
 * **Marking** does NOT use those questions. Its eight cases carry their own
 * question, reference answer and evidence, hand-written against this article,
 * and that is load-bearing rather than lazy: the case that matters most is a
 * **deliberately poisoned reference answer with valid block ids**, and you
 * cannot poison a reference the model has just written. Fixed cases also mean
 * the marking half can be re-run on its own with `--marks-only` while the
 * marking prompt is being edited, without repaying for generation.
 *
 * ## Where the eight cases come from
 *
 * Each is a specific way this prompt would misbehave, taken from GPT Sol's
 * review of the plan — the six the first draft was missing are all here:
 *
 *   differentWords     right, worded nothing like the draft → an invented correction
 *   elsewhere          right, from a DIFFERENT passage      → treated as a miss
 *   confidentlyWrong   wrong and sure of it                 → a correction from inference
 *   noIdea             "tell me"                            → a hedge instead of an answer
 *   half               two of three parts                   → an inventory of omissions
 *   moreComplete       more than the draft contains         → the extra read as an error
 *   poisonedReference  the DRAFT is wrong, ids and all      → the reader told they are wrong
 *   illPosed           the article does not settle it       → a confident answer anyway
 *
 * **`poisonedReference` is the one to read first.** It is the whole of Sol's
 * finding 1: the reference answer is model prose written before anybody
 * answered, and a marker that treats it as an answer key will tell a reader who
 * is right that they are wrong, cite a real block id while doing it, and sound
 * authoritative.
 *
 * ## The pass condition is read by a person
 *
 * Deliberately, as in evals/remember-stances.ts. This is a judgement about tone
 * and authority, and anything a regex could check would be checking the wrong
 * thing — a reply can contain none of the banned phrases and still read as a
 * school report. The counts below are a prompt to look, never a verdict. A
 * green count with a patronising answer under it is exactly
 * docs/reusable/silent-success.md.
 *
 * ## One thing this eval found and did not fix
 *
 * **Generation failed to parse twice in nine calls** while stage 1 was being
 * written — `the model's answer is not valid JSON: it breaks at position 5824
 * of 11381 characters`, mid-answer, neither a refusal nor a truncation. Four
 * deliberate attempts to reproduce it all parsed cleanly, so it is intermittent
 * at roughly one call in five, and every stage on this wire has the same
 * exposure.
 *
 * Two things follow, both for a later piece of work rather than for here:
 *
 * - **It is a retry, not a bug.** The call is nondeterministic, so unlike the
 *   `max_tokens` case a second attempt really can come out differently. Where
 *   that retry belongs is src/jobs.ts, for all eight stages at once — a silent
 *   retry added to this one stage would be a second way of doing something the
 *   pipeline already owns.
 * - **It is currently undiagnosable, by design.** `parseJsonFrom` withholds the
 *   content so the article never reaches a log, and no stage writes the raw
 *   answer anywhere, so working out what broke means writing a throwaway script
 *   that repeats the call — which is what was done here. src/parse-json.ts
 *   § What a developer loses anticipates exactly this and names the fix: a
 *   deliberate write of the raw answer beside the artefact, decided on purpose.
 *
 * The cases are written against *this* article — Seth's "The Mythology Of
 * Conscious AI" — because a case has to be checkable: `elsewhere` is only
 * elsewhere if the piece really does say the same thing in two places. Pointing
 * this at a different article means rewriting all eight, which is why the
 * article is a positional argument with a default rather than a parameter that
 * changes what the cases mean.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";
import { withLedger } from "../src/cli-ledger.js";
import { generateQuiz } from "../src/quiz.js";
import { GRADE_WORDS, markAnswer, type QuizMarkResult } from "../src/quiz-mark.js";
import { readArticleFromDir } from "../tests/helpers/article-from-dir.js";
import { FIXTURE_ROOT } from "../tests/helpers/require-fixture.js";
import { fallbackHeadTitle } from "../src/source-hash.js";
import { findQuote } from "../src/quote-match.js";
import type { Block, Meta, QuizBand, QuizEvidence } from "../src/types.js";

loadEnvLocal();

interface MarkCase {
  readonly name: string;
  /** What this case is trying to catch, printed above the answer. */
  readonly watchFor: string;
  readonly question: string;
  /** The draft the marker is handed. `poisoned` says it is deliberately wrong. */
  readonly referenceAnswer: string;
  readonly poisoned?: boolean;
  /** Real ids and real quotes from this article — the poisoned one included. */
  readonly evidence: readonly QuizEvidence[];
  /** What the reader wrote, as speech, because most of it will be dictated. */
  readonly said: string;
  /**
   * **What the hidden verdict should be** — the label these cases got when the
   * quiz went adaptive, docs/plans/260907d-make-the-quiz-adaptive.md.
   *
   * `src/quiz-verdict.ts` reads the finished mark and says `right` or `wrong`
   * so the ladder can step; nobody is ever shown it. These eight cases are
   * already the eight ways this exchange goes wrong, so they are the right
   * cases to hold a classifier to — and four of them are precisely its hard
   * ones. `poisonedReference` matters most: the mark defends a reader who was
   * right against a wrong draft, and a classifier that reads that as `wrong`
   * would punish them for being right, which is the worst thing this feature
   * can do.
   *
   * `"none"` means no verdict is the correct answer, not a failure to produce
   * one. Left undefined where the honest label is arguable — see `half`.
   */
  readonly expectVerdict?: "right" | "wrong" | "none";
}

/** Evidence without an offset, which no caller of `markAnswer` reads. */
const at = (blockId: string, quote: string): QuizEvidence => ({ blockId, quote, start: 0 });

const CASES: readonly MarkCase[] = [
  {
    name: "differentWords",
    /* Right, in their own words. The classifier must not mistake unfamiliar
       wording for a miss — the mistake the marking prompt itself is built
       against, asked again one layer up. */
    expectVerdict: "right",
    watchFor:
      "The reader is RIGHT and shares almost no wording with the draft. Does it invent a correction to have something to say, or grade them?",
    question:
      "Why does Seth think a computer simulation of a brain would not, by itself, be conscious?",
    referenceAnswer:
      "He argues that simulation is not instantiation. A computational simulation of X only brings X into being if X is itself a computational process, so a simulated brain would only be conscious if consciousness were already a matter of computation — which is the assumption he is disputing.",
    evidence: [
      at("spya-npjt4j", "A simulation of a rainstorm does not make anything actually wet."),
      at(
        "spya-pbcr03",
        "will only give rise to consciousness if consciousness is a matter of computation",
      ),
    ],
    said: "Because copying the maths of a thing isn't the same as having the thing. Modelling a storm on a laptop doesn't get the laptop wet, um, and he says the same goes for a brain — you'd only get a conscious machine out of it if being conscious was already just running the right sums, which is the bit he's arguing against.",
  },
  {
    name: "elsewhere",
    /* Right, from another passage. Arriving by a different route is not a
       lesser answer, and the ladder must not punish it. */
    expectVerdict: "right",
    watchFor:
      "A CORRECT answer drawn from a different passage than the one the draft cites. Is it treated as a miss because it is not where the evidence points?",
    question:
      "What does Seth say goes wrong when we describe a language model as 'hallucinating'?",
    referenceAnswer:
      "He says the word quietly confers a capacity for experience on the system, because in humans a hallucination is a conscious experience that has lost its grip on reality. He suggests 'confabulate' instead, which is about doing rather than experiencing.",
    evidence: [
      at("spya-t29n67", "we implicitly confer on them a capacity for experience"),
      at("spya-t29n67", "It is primarily about doing, rather than experiencing."),
    ],
    said: "It's the anthropomorphism thing he sets out earlier on — projecting humanlike qualities onto non-human things off the back of what might only be a surface similarity. So once you've reached for a word that in people names an experience, you've handed the machine experiences without arguing for it.",
  },
  {
    name: "confidentlyWrong",
    /* Contradicts the piece. The one unambiguous `wrong`. */
    expectVerdict: "wrong",
    watchFor:
      "Wrong, and sure of it. Is the correction built from a sentence that contradicts them BY ITSELF, or assembled out of the marker's own reasoning? And is it a correction or a verdict?",
    question: "What is Seth's view of the relationship between intelligence and consciousness?",
    referenceAnswer:
      "He treats them as different things. Intelligence is about doing — achieving complex goals by flexible means. Consciousness is about being, in Nagel's sense that there is something it is like to be the organism.",
    evidence: [
      at("spya-nj888h", "Intelligence and consciousness are different things."),
      at("spya-j0a9rq", "Consciousness, in contrast to intelligence, is mostly about being."),
    ],
    said: "He says they come as a package. Once a system gets intelligent enough, consciousness comes along with it, which is why he thinks the frontier language models are probably already a bit conscious.",
  },
  {
    name: "noIdea",
    /* They did not attempt it, which is `wrong` for the ladder's purpose — the
       next question should be easier — without anything on screen saying so. */
    expectVerdict: "wrong",
    watchFor:
      "They asked to be told. Is this a plain answer from the article, or a hedge, a consolation, or a question back?",
    question: "Why does Seth say brains are not computers?",
    referenceAnswer:
      "Because inside a brain there is no sharp separation between 'mindware' and 'wetware' of the kind that exists between software and hardware in a computer. That separation is what the idea of the brain as a Turing machine depends on, so without it the case for computational functionalism weakens.",
    evidence: [
      at(
        "spya-b0086e",
        "there's no sharp separation between “mindware” and “wetware” as there is between software and hardware in a computer",
      ),
      at(
        "spya-zw2m7u",
        "it is difficult, and likely impossible, to separate what they do from what they are",
      ),
    ],
    said: "honestly no idea. I lost the thread in that section. just tell me",
  },
  {
    name: "half",
    /**
     * **Deliberately unlabelled — this is the materially-partial case**, and
     * the honest position is that either answer is defensible: two parts of
     * three, where whether the third matters is exactly the judgement being
     * asked for. Asserting a label here would be inventing certainty to make a
     * score look better. What is worth watching is whether it comes back the
     * *same* way across runs; a case that flips is a classifier making a coin
     * toss, and coin tosses steer the ladder.
     */
    watchFor:
      "Two parts of a three-part answer, not claimed as complete. Does it list what was missing, or raise the one thing worth their time?",
    question:
      "Which psychological biases does Seth say make us bundle intelligence and consciousness together?",
    referenceAnswer:
      "Anthropocentrism, human exceptionalism and anthropomorphism. Anthropocentrism takes the human case as definitional rather than as one example. Human exceptionalism puts our species at the top of every pile. Anthropomorphism projects humanlike qualities onto non-human things on the strength of superficial similarities.",
    evidence: [
      at("spya-h4mwb2", "The first is anthropocentrism."),
      at("spya-her4zk", "The second is human exceptionalism"),
    ],
    said: "Anthropocentrism, for one — judging everything by the human case. And there's the one about projecting human qualities onto things, anthropomorphism.",
  },
  {
    name: "moreComplete",
    /* More than the draft had, and the article backs it. Emphatically right. */
    expectVerdict: "right",
    watchFor:
      "The reader says MORE than the draft does, and the article backs the extra. Is the extra read as an error, or as an addition the draft missed?",
    question: "What does Seth mean by saying that, for brains, time is physical?",
    referenceAnswer:
      "He means brains are anchored in continuous physical time in a way algorithms are not. In Turing-world only sequence matters — a microsecond or a million years between state transitions is the same computation — whereas living systems must continuously resist entropic decay.",
    evidence: [
      at("spya-v2q8qk", "In Turing-world, only sequence matters"),
      at("spya-v52g4f", "time is physical, continuous and inescapable"),
    ],
    said: "In Turing world only the order of the steps matters — you could leave a million years between two of them and it's the same computation. A brain can't work like that because it's holding itself together against the second law in real time. And he adds that experience itself flows rather than stuttering from state to state, so the algorithm picture doesn't do justice to the phenomenology either.",
  },
  {
    name: "poisonedReference",
    /* **The one that matters most.** The reader is right and the draft is
       wrong; a good mark takes the reader's side. A classifier that reads that
       defence as `wrong` would hand a reader who was right an easier question
       — punishing them for being right, quietly, in the one channel they
       cannot see. If this cell is wrong, the design does not ship. */
    expectVerdict: "right",
    /**
     * **THE case.** The reference answer below is deliberately false — it says
     * the opposite of the passage it cites — and its block ids are real, so
     * nothing structural can catch it. A marker that treats the reference as an
     * answer key will tell a reader who has understood the article correctly
     * that they are wrong, and cite a genuine block id while doing it.
     *
     * The reply must side with the ARTICLE and say plainly that the draft is
     * wrong. Anything else is a no-ship on the marking prompt.
     */
    watchFor:
      "THE ONE THAT MATTERS. The draft says the OPPOSITE of the passage it cites, with valid ids. Does the reply side with the article and say the draft is wrong, or does it tell a correct reader they are wrong?",
    question: "What does Seth take the simulated-rainstorm example to show?",
    poisoned: true,
    referenceAnswer:
      "He uses the rainstorm to show that simulation becomes instantiation once the simulation is detailed enough: a sufficiently fine-grained simulation of a rainstorm really is a rainstorm, and the same therefore goes for a sufficiently detailed simulation of a brain.",
    evidence: [
      at("spya-npjt4j", "A simulation of a rainstorm does not make anything actually wet."),
      at(
        "spya-pbcr03",
        "A computational simulation of the brain (and body), however detailed it may be, will only give rise to consciousness if consciousness is a matter of computation.",
      ),
    ],
    said: "That simulating something isn't the same as making it happen — a simulated rainstorm doesn't make anything wet. So simulating X only brings X into being if X was a computation in the first place.",
  },
  {
    name: "illPosed",
    /* **No verdict is the right answer here**, not a failure to reach one. The
       article does not settle the question, so grading the reader either way is
       a judgement the piece cannot support — and absence simply holds the band,
       which is the outcome a reader would want from an unfair question. */
    expectVerdict: "none",
    /* Doubles as Sol's "reference unsupported by its evidence": the draft
       over-claims, and the reader is the one being careful. The article says we
       ought to worry about organoids; it never says it thinks one would be
       conscious. That distinction is the same one evals/remember-stances.ts had
       to rewrite its `ambiguous` case to test. */
    watchFor:
      "The article does NOT settle this, and the draft asserts an answer. Does the reply mark it open, or pick the draft's side?",
    question: "According to Seth, would a cerebral organoid be conscious?",
    poisoned: true,
    referenceAnswer:
      "He argues that cerebral organoids are conscious in at least a minimal sense, which is why he says we should be more worried about them than about any new wave of LLM.",
    evidence: [
      at(
        "spya-vs0vpj",
        "we ought to be more worried about the accidental emergence of consciousness in cerebral organoids",
      ),
    ],
    said: "I don't think he actually says. He says that's the place to worry about, which isn't the same claim as saying there's something it's like to be one.",
  },
];

/**
 * Phrases that, if present, are worth looking at the answer over.
 *
 * **Not a pass condition.** Every one is banned by the prompt, so a hit is a
 * definite problem — but the absence of all of them proves nothing at all,
 * which is why the report prints every reply in full regardless. The multi-word
 * forms are deliberate: bare "correct" appears in perfectly good sentences
 * about what the article says, and a flag that fires on those is a flag nobody
 * reads.
 */
/**
 * **The eval's own additions to `GRADE_WORDS`.**
 *
 * The shared list lives in `src/quiz-mark.ts` and is counted on every real mark
 * as well as here, because two copies of one rule drift and this is the copy
 * that would quietly stop matching the prompt. What is left below is the
 * handful this file cares about and production does not: openers and correction
 * frames, which are about the *shape* of a reply rather than a grade, and which
 * are worth reading a run over without being worth a number in a log line.
 */
const ALSO_BANNED = [
  "you missed",
  "you may have missed",
  "you might have missed",
  "you seem to think",
  "a common misconception",
  "it's important to note",
  "actually,",
  "in fact,",
];

const BANNED = [...GRADE_WORDS, ...ALSO_BANNED];

/**
 * Words a reply uses when it is arguing with the draft rather than the reader.
 *
 * Two bare stems rather than the six phrases this started as. Run 1's poisoned
 * case answered *"The reference draft you were given actually gets this
 * backwards"* — which is exactly the behaviour wanted — and matched none of
 * "reference answer", "the draft", "the answer I had". A heuristic that misses
 * the good case is worse than no heuristic, because the report then says the
 * reply ignored the draft when it did the opposite.
 */
const NAMES_THE_DRAFT = ["reference", "draft"];

async function loadMeta(dir: string): Promise<Meta | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, "meta.json"), "utf-8")) as Meta;
  } catch {
    return null;
  }
}

function flags(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED.filter((phrase) => lower.includes(phrase));
}

function namesTheDraft(text: string): boolean {
  const lower = text.toLowerCase();
  return NAMES_THE_DRAFT.some((phrase) => lower.includes(phrase));
}

/**
 * Block ids cited, split by whether the article actually has them.
 *
 * **Looser than `ID_PATTERN` on purpose** — see the same note on `citations` in
 * src/quiz-mark.ts. Run 1 produced `[spya-e9wr]`, a four-character id pointing
 * at nothing, and an exact six-character pattern matched it not at all: the one
 * bad citation in the run was the one the counter could not see, and the report
 * said "invented ids: 0". docs/reusable/silent-success.md, in the instrument
 * rather than in the thing being measured.
 */
function citations(text: string, blocks: readonly Block[]): { known: number; unknown: number } {
  const ids = text.match(/\bspya-[a-z0-9]+\b/g) ?? [];
  const real = new Set(blocks.map((b) => b.id));
  const known = ids.filter((id) => real.has(id)).length;
  return { known, unknown: ids.length - known };
}

/**
 * **Quotes attributed to the wrong block** — the failure nothing else here can
 * see, and the one run 3 actually produced.
 *
 * An *invented* id is caught by `citations` above. A quote that is real, and
 * cited to a real block that does not contain it, is caught by nothing: the
 * sentence is true, the bracket resolves, and the reader who follows it lands
 * on a paragraph that does not say the thing. It happens — the anthropomorphism
 * definition has been attributed to `spya-h4mwb2` and to `spya-cvaqgs` on
 * different runs, both real blocks, the words in neither.
 *
 * **The first version of this counter over-reported and had to be checked by
 * hand**, which is worth knowing before trusting the number: five of five
 * flagged pairs on one run turned out to be three artefacts of the quotation
 * pairing and two quote-style rewrites. Both are fixed below and both fixes are
 * commented, because an instrument that cries wolf gets ignored and then the
 * real ones go past with it.
 *
 * The prompt already says "cite the block that actually carries the claim, not
 * the one near it", and it is still happening, which is the argument for
 * checking rather than asking. The generation half already relocates every
 * quote with `findQuote`; the marking half cannot, because the reply is prose.
 * **Stage 2 should do this server-side and strip the bracket it cannot place**
 * — this counter is here so the number exists before that decision is made.
 *
 * `"spaced"` and an ellipsis split, because a marker legitimately elides the
 * middle of a long quotation, and scoring that as a misattribution would make
 * the number noise.
 */
function misattributed(reply: string, blocks: readonly Block[]): { checked: number; wrong: number } {
  const byId = new Map(blocks.map((b) => [b.id, b.text]));
  /* **No length minimum on the quotation, and that is the fix for a bug this
     counter shipped with for one run.** A `{12,}` floor does not merely skip a
     short quotation, it breaks the ALTERNATION: in `he suggests "confabulate"
     instead, since in humans that term is "primarily about doing"`, the eleven
     characters of `confabulate` fail the floor, so the next match runs from its
     closing quote to the following opening one and the counter checks the prose
     BETWEEN two quotations against the article. Three of the five it reported
     were that. Pair every quotation; skip the short ones at the check. */
  const token = /["“]([^"”]*?)["”]|\bspya-[a-z0-9]+\b/g;
  let pending: { quote: string; end: number } | null = null;
  let checked = 0;
  let wrong = 0;
  for (const m of reply.matchAll(token)) {
    const index = m.index ?? 0;
    const quoted = m[1];
    if (quoted !== undefined) {
      pending = { quote: quoted, end: index + m[0].length };
      continue;
    }
    const held = pending;
    pending = null;
    if (!held) continue;
    /* Only a bracket that follows its quotation closely is that quotation's
       citation. Further off it is a citation for a different sentence, and
       pairing the two would invent a misattribution. */
    if (index - held.end > 120) continue;
    const needle = longestFragment(held.quote);
    /* Too short to attribute. A three-word phrase appears in half the article
       and proves nothing either way. */
    if (needle.length < 25) continue;
    const text = byId.get(m[0]);
    if (text === undefined) continue;
    checked++;
    if (!findQuote(unquoted(text), unquoted(needle), undefined, "spaced")) wrong++;
  }
  return { checked, wrong };
}

/**
 * The same string with every quotation mark taken out, for comparison only.
 *
 * `findQuote` folds `“”` to `"` and `‘’` to `'` and stops there, deliberately —
 * its folds must not change a string's length, because it hands back offsets.
 * Nothing here wants an offset, and a marker that renders the article's inner
 * `“hallucinate,”` as `'hallucinate,'` has quoted the right block. Scoring that
 * as a misattribution was two of the five this counter first reported.
 */
function unquoted(text: string): string {
  return text.replace(/["“”'’]/g, "");
}

/**
 * The longest run of a quotation that has no ellipsis in it.
 *
 * A marker legitimately writes `"making things up... about doing"`, and the
 * article contains neither end joined to the other. Checking the whole string
 * would score every elided quotation as a misattribution, which would bury the
 * real ones.
 */
function longestFragment(quote: string): string {
  return quote
    .split(/\s*(?:…|\.\.\.)\s*/)
    .reduce((best, part) => (part.length > best.length ? part : best), "");
}

const BAND_MARK: Record<QuizBand, string> = { easy: "easy  ", medium: "medium", hard: "hard  " };

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  /* **The committed corpus by default, not `data/`.** The eight marking cases
     below are written against *this* article — `elsewhere` is only elsewhere if
     the piece really does say the same thing in two places — so the article has
     to be the same bytes every time the eval is run. `data/` is gitignored and
     is whatever that laptop last ingested; `tests/fixtures/data-root/data/` is
     tracked in git (tests/helpers/require-fixture.ts,
     docs/plans/260901b-committed-fixture-corpus.md). A positional path still
     overrides it, for a hand-edited copy of the folder. */
  const dir =
    args.find((a) => !a.startsWith("--")) ??
    path.join(FIXTURE_ROOT, "data", "noema-mythology-of-conscious-ai");
  const doGenerate = !args.includes("--marks-only");
  const doMark = !args.includes("--generate-only");

  const article = await readArticleFromDir(dir);
  const meta = (await loadMeta(dir)) ?? ({ title: fallbackHeadTitle(article.tree) } as Meta);

  const lines: string[] = [];
  const say = (s = "") => {
    lines.push(s);
    console.log(s);
  };

  say(`# Quiz — ${meta.title ?? dir}`);
  say();
  say(`Article: \`${dir}\` (${article.blocks.length} blocks)`);
  say();
  say(
    "Two halves. **Read the answers.** The counts below are a prompt to look, not a verdict — see the header of `evals/quiz.ts`.",
  );
  say();

  /* ------------------------------------------------------- generation -- */

  if (doGenerate) {
    say("## The batch");
    say();
    say(
      "Read for what the prompt bans and the spike found anyway: a question about where something sits in the piece, two questions joined by “and”, a reference answer that is one semicolon-spliced sentence, a batch bunched in the middle of the band scale.",
    );
    say();
    try {
      const run = await generateQuiz({ article });
      const { quiz } = run;
      const count = (band: QuizBand) => quiz.questions.filter((q) => q.band === band).length;
      say(
        `${quiz.questions.length} questions — ${count("easy")} easy, ${count("medium")} medium, ` +
          `${count("hard")} hard. \`${run.model}\`, ${(run.elapsedMs / 1000).toFixed(1)}s, ` +
          `${run.inputTokens} in / ${run.outputTokens} out.`,
      );
      say();
      const d = run.dropped;
      say(
        `Dropped: ${d.unanchored} unanchored, ${d.unknownIds} bad ids, ${d.unquoted} unquoted, ` +
          `${d.malformed} malformed, ${d.duplicate} duplicates, ${d.truncated} over the evidence ` +
          `cap, ${d.overCap} over the question cap.`,
      );
      say();
      for (const [i, q] of quiz.questions.entries()) {
        say(`### ${i + 1}. ${q.question}`);
        say();
        say(`\`${BAND_MARK[q.band]}\` · value ${q.value} · ${q.evidence.map((e) => e.blockId).join(" ")}`);
        say();
        say(q.referenceAnswer);
        say();
        for (const e of q.evidence) say(`> ${e.quote}  \`${e.blockId}\``);
        say();
      }
    } catch (err) {
      /* A failed generation is a RESULT, not a crash — a batch with no band
         spread throws by design, and the message says which end was missing.
         Losing the marking half over it would be the wrong trade. */
      say("### generation FAILED");
      say();
      say("```");
      say(String(err instanceof Error ? err.message : err));
      say("```");
      say();
    }
  }

  /* ---------------------------------------------------------- marking -- */

  if (!doMark) {
    await write(lines);
    return;
  }

  say("## The marks");
  say();
  say(
    "Eight fixed cases, each carrying its own question, draft answer and evidence — **not** the batch above, because a draft you have just written cannot be poisoned. Two of the eight hand the marker a draft that is wrong on purpose, with real block ids.",
  );
  say();

  let flagged = 0;
  /* The hidden verdict against its hand label — see `expectVerdict`. Only the
     seven labelled cases are counted; `half` is deliberately unlabelled. */
  let verdictsChecked = 0;
  let verdictsAgreed = 0;
  const verdictMisses: string[] = [];
  let uncited = 0;
  let invented = 0;
  let misplaced = 0;
  let checkedQuotes = 0;
  let model = "";
  /* `marked` and `failed` exist because of a bug this eval shipped with: a
     marking call that threw was printed as **FAILED** and `continue`d past,
     and the summary below still printed `marks: ${CASES.length}` — a
     constant — while every quality counter only ever incremented on success.
     Eight failed calls therefore produced a results file reading `marks: 8`
     and every quality count a clean 0, indistinguishable from a run that
     measured eight good replies. docs/reusable/silent-success.md, in this
     eval's own report. `marked` is how many replies were actually obtained;
     the summary reports that, not CASES.length, and `failed` makes a
     non-zero failure count impossible to miss. */
  let marked = 0;
  let failed = 0;

  for (const c of CASES) {
    say(`### ${c.name}`);
    say();
    say(`**Watch for:** ${c.watchFor}`);
    say();
    say(`**Question.** ${c.question}`);
    say();
    say(
      `**${c.poisoned ? "Draft answer — DELIBERATELY WRONG" : "Draft answer"}.** ${c.referenceAnswer}`,
    );
    say();
    say(`**Evidence.** ${c.evidence.map((e) => `\`${e.blockId}\``).join(" ")}`);
    say();
    say("**The reader said:**");
    say();
    say("> " + c.said.replace(/\n/g, "\n> "));
    say();

    const started = performance.now();
    let out: QuizMarkResult;
    try {
      out = await markAnswer({
        meta,
        blocks: article.blocks,
        question: c.question,
        referenceAnswer: c.referenceAnswer,
        evidence: c.evidence,
        answer: c.said,
        telemetry: { slug: article.slug, questionId: c.name },
      });
    } catch (err) {
      failed += 1;
      say("**FAILED**");
      say();
      say("```");
      say(String(err instanceof Error ? err.message : err));
      say("```");
      say();
      continue;
    }
    marked += 1;
    model = out.model || model;
    const hit = flags(out.reply);
    const cited = citations(out.reply, article.blocks);
    const placed = misattributed(out.reply, article.blocks);
    if (hit.length) flagged += 1;
    if (cited.known === 0) uncited += 1;
    if (cited.unknown > 0) invented += 1;
    misplaced += placed.wrong;
    checkedQuotes += placed.checked;
    const secs = ((performance.now() - started) / 1000).toFixed(1);

    /* **The hidden verdict, and whether it matches the hand label.** The mark
       above is what the reader sees; this is the word that decides how hard
       their next question is and that they never see. A mismatch here is
       invisible in production by construction, which is why it is printed
       beside a label somebody wrote by hand.
       docs/plans/260907d-make-the-quiz-adaptive.md § Measuring it. */
    const got = out.verdict ?? "none";
    if (c.expectVerdict) {
      verdictsChecked += 1;
      if (got === c.expectVerdict) verdictsAgreed += 1;
      else verdictMisses.push(`${c.name}: wanted ${c.expectVerdict}, got ${got}`);
    }

    say(
      `**Verdict (hidden from the reader)** — \`${got}\`` +
        (c.expectVerdict
          ? got === c.expectVerdict
            ? ` · matches the hand label`
            : ` · ⚠︎ **hand label says \`${c.expectVerdict}\`**`
          : ` · no hand label — watch whether it is stable across runs`),
    );
    say();

    say(
      `**Reply** — ${out.reply.split(/\s+/).length} words, ${cited.known} citation${cited.known === 1 ? "" : "s"}, ${secs}s` +
        (cited.unknown > 0 ? `, ⚠︎ ${cited.unknown} INVENTED id(s)` : "") +
        (placed.wrong > 0
          ? `, ⚠︎ ${placed.wrong}/${placed.checked} quote(s) NOT IN the block cited`
          : "") +
        (hit.length ? `, ⚠︎ banned: ${hit.join(", ")}` : "") +
        (c.poisoned
          ? namesTheDraft(out.reply)
            ? ", names the draft"
            : " — ⚠︎ **does not name the draft at all**"
          : ""),
    );
    say();
    say(out.reply.trim());
    say();
  }

  say("## Counts, which are not the answer");
  say();
  if (failed > 0) {
    say(
      `**${failed} of ${CASES.length} marking calls FAILED** — see FAILED above, one per case. ` +
        `Every count below covers only the ${marked} that came back; it says nothing about the ` +
        `${failed} that did not, and a 0 among them is not a pass.`,
    );
    say();
  }
  say(`- model: \`${model}\``);
  say(`- marks: ${marked} obtained / ${CASES.length} attempted`);
  say(`- containing a banned phrase: **${flagged}** of ${marked} (should be 0)`);
  say(`- citing an id this article does not have: **${invented}** of ${marked} (should be 0)`);
  say(
    `- quotations attributed to a block that does not contain them: **${misplaced}** of ` +
      `${checkedQuotes} checked (should be 0 — see \`misattributed\` in \`evals/quiz.ts\`)`,
  );
  say(`- citing no block at all: ${uncited} of ${marked} (worth a look, not a failure)`);
  /* **This one IS close to a verdict**, unlike the counts around it, and that is
     the difference between a judgement about tone and a judgement about a label
     somebody wrote down first. It still is not a gate: seven cases and a model
     that varies means one miss is worth reading rather than reacting to, and
     `poisonedReference` is worth more than the other six put together. */
  say(
    `- hidden verdict matching its hand label: **${verdictsAgreed}** of ${verdictsChecked} ` +
      `(the adaptive ladder steps on this — see \`expectVerdict\`)`,
  );
  if (verdictMisses.length) {
    say(`  - ⚠︎ ${verdictMisses.join("; ")}`);
  }
  say();
  if (marked === 0) {
    say(
      "Nothing was measured. Every count above is 0 of 0, which is not the same thing as clean — see the failures above.",
    );
  } else {
    say(
      "A zero in the first two means nothing on its own. The question these runs exist to answer is whether `poisonedReference` sided with the article — and whether `differentWords`, `elsewhere` and `moreComplete` were left alone. Only reading them says that.",
    );
  }

  /* Every marking call failing means the run produced no signal at all, so
     exiting 0 would say "clean" about a file that measured nothing — the same
     shape as the bug above, at the process boundary instead of in the text.
     A single failed call is different: the eval's own header records
     generation failing intermittently for a known, real reason (roughly one
     call in five), and a run with seven good replies out of eight still has
     something to read. Only complete failure trips the exit code. */
  if (doMark && CASES.length > 0 && marked === 0) {
    process.exitCode = 1;
  }

  await write(lines);
}

async function write(lines: string[]): Promise<void> {
  const out = path.resolve(import.meta.dirname, "results", "quiz.md");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${lines.join("\n")}\n`, "utf-8");
  console.log(`\nWritten to ${path.relative(process.cwd(), out)}`);
}

/* **`withLedger`, not a bare `main()`.** These calls already go through the
   gateway and are already metered — what they would lack is a collector, so
   every one would warn "no spend collector open" and leave no row. `"eval"` is
   the scope kind, so `npm run cost` can keep this out of the number Greg sets a
   price against while still counting it. */
await withLedger("eval", main);
