/**
 * **The quiz eval's marking cases and its counters**, shared by
 * `evals/quiz.ts` (the prompts) and `evals/quiz-models.ts` (Haiku against
 * Sonnet, plan 261029i). Moved here unchanged so the two evals hold one copy:
 * a second copy of eight hand-labelled cases is the one that would drift.
 * Importing `evals/quiz.ts` itself would run it.
 *
 * The cases are written against the committed corpus article, Seth's "The
 * Mythology Of Conscious AI" — `evals/quiz.ts`' header says why that matters.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GRADE_WORDS } from "../src/quiz-mark.js";
import { findQuote } from "../src/quote-match.js";
import type { Block, Meta, QuizEvidence } from "../src/types.js";

export interface MarkCase {
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

export const CASES: readonly MarkCase[] = [
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
       a judgement the piece cannot support — and absence simply shows the next
       step's premise, which is the outcome a reader would want from an unfair question. */
    expectVerdict: "none",
    /* Doubles as Sol's "reference unsupported by its evidence": the draft
       over-claims, and the reader is the one being careful. The article says we
       ought to worry about organoids; it never says it thinks one would be
       conscious. That distinction is the same one evals/learn-recall.ts had
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

export const BANNED = [...GRADE_WORDS, ...ALSO_BANNED];

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

export async function loadMeta(dir: string): Promise<Meta | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, "meta.json"), "utf-8")) as Meta;
  } catch {
    return null;
  }
}

export function flags(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED.filter((phrase) => lower.includes(phrase));
}

export function namesTheDraft(text: string): boolean {
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
export function citations(text: string, blocks: readonly Block[]): { known: number; unknown: number } {
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
export function misattributed(reply: string, blocks: readonly Block[]): { checked: number; wrong: number } {
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

