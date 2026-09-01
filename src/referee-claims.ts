/**
 * **The claims a paper makes up front, and where in the paper each one is taken
 * up** — the stored shape, and the validation that decides what is allowed to
 * become one.
 *
 * Stage 4 of docs/plans/260831an-referee-mode-for-peer-reviewers.md § 2. Nothing
 * here calls a model, touches a database or reads a file: it is the half that
 * can be tested with a fixture, and it is where the three rules live.
 *
 * ## The three rules, and they are the whole of the design
 *
 * The plan's first draft ranked claims by how few passages supported them and
 * called the empty row *"a finding made of structure rather than judgement"*. A
 * cross-family review removed that and was right to. Deciding what the claims
 * are, which passages count, and that nothing supports one, are all judgements;
 * a zero-passage row may mean the extractor missed a table, a figure or a
 * supplement, or that the paper words the thing differently. And counting
 * passages is indefensible as a proxy for adequacy — one decisive result beats
 * five repetitive mentions. The failure mode named in the plan is specific: *a
 * tired referee opens Claims first, reads the top "thin" rows, and treats
 * everything unlisted as clean. That is the mode most likely to replace reading,
 * dressed as the one least likely to.*
 *
 * So:
 *
 * 1. **Document order, never thinness order.** `validateClaims` sorts by where
 *    the claim sits in the article and by nothing else, and it does the sort
 *    itself rather than leaving it to a caller — see `byDocument`. There is no
 *    comparator anywhere in this feature that reads `passages.length`.
 * 2. **"The model did not find a passage for this."** `NO_PASSAGE_FOUND` below,
 *    and it is a value rather than a string in a panel so that a test can hold
 *    it to that. Never "none", never "unsupported", never "the paper does not
 *    address this" — tests/referee-copy-is-about-the-model.test.ts.
 * 3. **Linkage only, never adequacy.** A `ClaimPassage` asserts that a passage
 *    addresses the claim. Whether the results *carry* the abstract's sentence is
 *    the referee's job, and it is the interesting part. There is deliberately no
 *    confidence, no strength, no score and no valence on anything in this file —
 *    see `ClaimPassage.reasoning`. Until 2026-09-01 this rule was held by nothing
 *    but the prompt; it now also has a **fail-safe** that blanks a `reasoning`
 *    line reading as a verdict and counts what it blanked (`ADEQUACY_FRAMES`).
 *    A fail-safe, not a guarantee — read its docstring for what it cannot see.
 *
 * ## And the fourth thing, which is not a rule but a hole in the first three
 *
 * All three rules are about the rows that came back. **A claim that never gets a
 * row is invisible**, and the panel looks exactly as tidy either way — so the
 * guard was built on the wrong side of the door. `unaccountedSentences` is the
 * other side: the sentences of the blocks these claims came from that no claim
 * is anchored in, computed rather than asked for, and worded as *what the answer
 * did not account for* rather than as *claims the model missed*, because the
 * second of those is the same judgement in reverse.
 *
 * ## And the third state, which is the trap this feature inherited
 *
 * There are three outcomes for a claim, not two: passages were found, the model
 * looked and named none, and **the model named some and not one of them could be
 * checked against the paper**. The third used to render as the second one level
 * up in Criteria, where a `done` row with no results printed *"the model did not
 * find a passage"* about an answer that had found one and failed to score it
 * (GPT Sol's finding 4). Here that is `Claim.discarded`: a per-claim count of
 * passages thrown away, carried onto the row so the panel can say the true
 * sentence rather than the near one. `PASSAGES_UNUSABLE` is that sentence.
 *
 * ## The anchor is the same contract as everything else
 *
 * `blockId` + `quote`, with `start` as a disambiguator and never as the anchor —
 * docs/project/block-ids.md. Every quote, on a claim and on a passage, is
 * re-found in the block it names and **replaced with the article's own
 * characters**, so nothing downstream is ever shown the model's retyping.
 *
 * **The match runs `"spaced"`, not the default.** `findQuote`'s second pass
 * deletes whitespace entirely, which is right for the browser comparing a stored
 * quote against rendered text and wrong here: this comparison is being read as
 * the claim *that the model copied the text*, and pass two accepts a word the
 * model split in two (an article saying *fall apart* matches a model saying
 * *fall a part*). src/quote-match.ts § `passes`. `validateHits` in src/search.ts
 * and `validateResults` in src/referee-criteria.ts still pass the default and
 * that is a known gap in both; this file does not copy it.
 */

import { findQuote } from "./quote-match.js";
import type { Block, BlockId } from "./types.js";

/* ------------------------------------------------------------- the shapes -- */

/** Where in the piece something points. Id first, text second, offsets never. */
interface Anchored {
  blockId: BlockId;
  /** The words as they appear in the block — never as the model retyped them. */
  quote: string;
  /** Where `quote` sat in `block.text`. A disambiguator, never the anchor. */
  start: number;
}

/**
 * One passage where the paper takes a claim up.
 *
 * **There is no number on this type and there is not going to be one.** No
 * confidence, no strength, no rank, no valence. A number here would be read as
 * *how well this passage supports the claim*, which is the adequacy judgement
 * the whole sub-mode refuses to make, and a number that meant something narrower
 * would still be sorted on by somebody eventually. The row says *the model says
 * this passage addresses that claim*; the referee presses it, lands on the
 * paragraph, and decides.
 */
export interface ClaimPassage extends Anchored {
  /**
   * One short line on **how** this passage bears on the claim — the methods
   * step, the table, the limitation.
   *
   * Linkage, never adequacy: "reports the accuracy the abstract quotes" is the
   * shape, and "confirms the claim" is not. The prompt asks for that, and since
   * 2026-09-01 `validateClaims` also **blanks a line that reads as a verdict**
   * rather than printing it — see `ADEQUACY_FRAMES` and `withheld` below.
   *
   * An empty string means either that the model wrote nothing here or that what
   * it wrote was withheld; `withheld` is what tells those apart.
   */
  reasoning: string;
  /**
   * **This passage's `reasoning` was a verdict, so it was blanked.**
   *
   * Set by `validateClaims` and never by the model. The passage itself survives:
   * the linkage — *this paragraph bears on that claim* — is the useful half and
   * is still a door into the prose, so losing the row to save the sentence would
   * cost the referee more than it saved. Failing safe means dropping the
   * sentence, not the passage.
   *
   * Optional and absent on an ordinary passage rather than `false`, so that a
   * stored run written before this existed reads the same as one where nothing
   * was withheld — which is the truth about both.
   */
  withheld?: true;
}

/** One claim the paper makes about itself, and where it is taken up. */
export interface Claim extends Anchored {
  /**
   * **Stable, derived, never minted** — `blockId:start`.
   *
   * Used as a React key, as the key `assignSlots` colours by, and as the
   * identity a panel toggles. Derived rather than random for one reason that
   * matters: a claim is validated **twice**, once per item as it streams and
   * once over the whole reply at the end, and a minted id would differ between
   * the two — so the claim the referee had switched on would go dark the moment
   * the authoritative answer landed. Two claims anchored to the same words in
   * the same block are the same claim and the second is dropped, so this is
   * unique within a run.
   */
  id: string;
  /**
   * The claim in one line, so a list of ten can be read down.
   *
   * A restatement rather than a verdict, and the paper's own `quote` sits under
   * it — the line is the label, the quote is the evidence that the paper said
   * it.
   */
  claim: string;
  /**
   * Where the paper addresses it, **in document order**.
   *
   * May be empty, and an empty one is a real answer that the panel says in
   * words: `NO_PASSAGE_FOUND` when nothing was named, `PASSAGES_UNUSABLE` when
   * things were named and none survived. `discarded` is what tells those apart.
   */
  passages: ClaimPassage[];
  /**
   * How many passages the model named for this claim that could not be kept —
   * an unknown block id, a quote not in the block it named, a row with no anchor
   * at all.
   *
   * **Carried on the row rather than only counted globally**, because the
   * sentence under an empty claim depends on it and nothing else could tell.
   * See this file's header, and `PASSAGES_UNUSABLE`.
   */
  discarded: number;
}

/**
 * One run of Claims over one article — the whole stored artefact.
 *
 * **One row per article, not a list**, which is the one shape difference from
 * `SavedCriterion`: a referee writes several criteria and asks the paper what
 * *it* claims exactly once. Running it again replaces it, because the second
 * answer is about the same paper and the first was not a thing anybody chose to
 * keep.
 *
 * `status` is written **before** the model is called, exactly as on a
 * `SavedCriterion` and a `SearchRun` and a `Comment`, so a crash mid-run leaves
 * a visible unfinished run rather than a question that evaporated.
 */
export interface ClaimsRun {
  status: "pending" | "done" | "error";
  createdAt: string;
  claims: Claim[];
  model?: string;
  error?: string;
  /**
   * Fingerprint of the blocks this run was answered against — `hashBlocks`,
   * src/source-hash.ts. Same field and same word as `SavedCriterion`, and absent
   * counts as stale for the same reason: not knowing is not the same as knowing
   * it is fine (`isStale`, src/search-stale.ts, which takes this shape
   * structurally).
   */
  sourceHash?: string;
}

/* --------------------------------------------------------------- the copy -- */

/**
 * **What a claim with no passages says.**
 *
 * The subject is the model, and that is the whole sentence's job. The shorter,
 * more natural, wrong version — *"the paper does not address this"* — is a
 * finding, and a zero-passage row is not evidence for it: the extractor may have
 * dropped a table or a figure or a supplement, the paper may word the thing
 * differently, or the model may simply have missed it. GPT Sol's second finding
 * made this the condition of Claims surviving the review at all.
 *
 * A value rather than a string inside the panel, so that
 * tests/referee-copy-is-about-the-model.test.ts can check the sentence itself
 * rather than scanning a file for phrasings nobody has thought of yet.
 */
export const NO_PASSAGE_FOUND =
  "The model did not find a passage for this — which is a fact about the search, not about " +
  "the paper.";

/**
 * **And what a claim says when the model named passages and none survived.**
 *
 * The third state. Every passage the model gave for this claim named a block
 * this article does not have, quoted words that are not in the block it named,
 * or carried no anchor at all — so there is nothing to show, and *"the model did
 * not find a passage"* would be false about it. Two different sentences, because
 * they call for different actions: one is an answer, the other is a reason to
 * run it again.
 */
export const PASSAGES_UNUSABLE =
  "The model pointed at passages for this claim and none of them could be found in the paper, " +
  "so there is nothing to show. That is about the answer rather than about the paper.";

/**
 * **What the panel says about what a row is and is not** — printed above the
 * list, always, not folded away behind anything.
 *
 * Rule 3. The model asserts that a passage addresses a claim; whether the
 * results carry the abstract's sentence is the referee's own call, and it is the
 * part worth their time.
 */
export const LINKAGE_NOT_ADEQUACY =
  "Each row says only that the model thinks this passage takes the claim up. Whether it carries " +
  "the claim is yours to judge — press a row and read the paragraph.";

/**
 * **And that the order is the paper's, not a ranking.**
 *
 * Said out loud because a reader who assumes a list is sorted best-first will
 * read the top of it and stop, and this list has no best-first. The plan is
 * blunt about the referee this is protecting.
 */
export const DOCUMENT_ORDER_NOTE =
  "In the order the paper makes them. Nothing here is ranked, and a claim with fewer passages " +
  "under it is not a weaker claim.";

/**
 * **What stands where a withheld `reasoning` line would have been.**
 *
 * The subject is the model's sentence, and the second half hands the judgement
 * back rather than making it. It says the passage survived, because a referee
 * who sees a line disappear will otherwise wonder what else went with it.
 *
 * Never *"this passage does not carry the claim"* and never *"the model was
 * wrong"* — we have no standing for either. All that happened is that a sentence
 * matched a shape this sub-mode does not print.
 */
export const REASONING_WITHHELD =
  "The model's line about this passage was withheld — it read as a judgement on whether the " +
  "passage carries the claim, and that judgement is yours. The passage itself is untouched.";

/**
 * **And the count, out loud rather than only in a log line.**
 *
 * A fail-safe nobody can see is a fail-safe nobody can check: if the frames
 * start firing on ordinary linkage sentences, the referee is the one who would
 * notice, and they cannot notice a thing that only ever reached a log.
 * docs/reusable/silent-success.md.
 */
export function withheldNote(n: number): string {
  const what = n === 1 ? "One line the model wrote under a passage was" : `${n} lines the model wrote under passages were`;
  return `${what} withheld below, for reading as a judgement on whether the passage carries the claim.`;
}

/** The heading over the sentences the claims do not account for. */
export const UNACCOUNTED_HEADING = "Not accounted for";

/**
 * **What that list is, and — more important — what it is not.**
 *
 * The distinction is the whole value of the feature. These are sentences that
 * sit in the blocks the claims above were taken from and that no claim above is
 * anchored in. That is a mechanical fact about the list; it is **not** a list of
 * claims the model missed, because deciding what is a claim is a judgement and
 * this sub-mode does not make judgements about the paper. A block a claim came
 * from carries background, citation and setup as well as claims, and a claim
 * anchored in one part of a compound sentence leaves the rest of it here.
 *
 * The last clause hands the judgement over explicitly, because a referee who
 * reads this as an accusation will either dismiss it or over-trust it, and both
 * are worse than reading three sentences of the paper.
 */
export const UNACCOUNTED_NOTE =
  "Sentences from the blocks these claims were taken from, that no claim above is anchored in. " +
  "That is a fact about the list above rather than about the paper: those blocks carry " +
  "background, citation and setup as well as claims, and a claim anchored in one part of a " +
  "sentence leaves the rest of it here. Read them, and decide for yourself whether any of them " +
  "is a claim.";

/* --------------------------------------------------------------- the caps -- */

/**
 * As many claims as a paper actually makes up front, plus room.
 *
 * An abstract and an introduction carry a handful; twenty is past anything real
 * and short of anything a panel cannot be read down. Beyond it the extras are
 * **counted, not dropped in silence** (`DroppedClaims.truncated`), because a cap
 * that never says so is a cap nobody finds out about.
 */
export const MAX_CLAIMS = 20;

/**
 * How many passages one claim keeps.
 *
 * A cap and not a target — and this is the number most likely to be misread, so:
 * a claim with eight passages under it is not better established than one with
 * two. The prompt asks for the passages that take the claim up and no others.
 */
export const MAX_PASSAGES = 8;

/* ------------------------------------------ adequacy, and the fail-safe -- */

/**
 * **Sentences that are a judgement about whether a passage carries a claim.**
 *
 * These frames were built and argued for in `evals/referee-claims.ts`, where
 * they were checked in both directions against real committed model output: they
 * fire on all six adequacy lines of the ablated run — the same paper with the
 * prompt's refusals cut out — and stay silent on ten guarded linkage lines,
 * including four minimal pairs from the same paragraph of the same paper. A
 * naive word list raises three false alarms on `appraisal`, a paper *about*
 * evidence quality, where these raise none.
 *
 * They live here rather than in the eval because they are now load-bearing in
 * two places, and **a second copy is a thing nothing keeps in step**: the eval
 * imports these, so its self-check table (`SELF_CHECK`, which pins both
 * directions to verbatim committed lines) is a test of the code that actually
 * runs on a referee's answer.
 *
 * ## Frames, not words, and that is the whole design
 *
 * Every pattern needs a **degree, a negation or a comparison bolted to a support
 * verb** — "fully establishes", "does not carry", "falls short of the claim".
 * Bare "support", "weak", "evidence" and "establishes" match nothing on their
 * own, because all four are ordinary words in an honest linkage sentence and in
 * a paper about evidence quality they are the subject matter.
 *
 * ## What this cannot do, and it is a lot
 *
 * A verdict phrased in ordinary English that avoids every frame is missed, and
 * one phrased in the paper's own words is masked by `subtractPaperPhrases` along
 * with the false alarms. So this is a **fail-safe, not a guarantee**: it catches
 * the shapes a model actually produced when the refusals were removed, and the
 * prompt is still what does most of the work.
 *
 * ## The stronger move, weighed and not taken — 2026-09-01
 *
 * **Replace `reasoning` with a closed enum of linkage kinds** —
 * reports-the-figure / describes-the-method / restates-the-claim / … — which the
 * eval agent proposed. It is genuinely stronger: adequacy would become
 * *unrepresentable* rather than caught by a pattern, and no frame could be
 * evaded by phrasing. Greg weighed it and did not take it, because it costs the
 * specific sentence, and the specific sentence is the part a referee uses:
 * *"reports the measured reduction figure on the single dataset tested"* tells
 * them more than a category would, and it is what makes the row worth pressing.
 *
 * **This is the escalation if the frames prove insufficient** — a verdict in
 * ordinary English that slips past every pattern, seen more than once, is what
 * would trigger it. Recorded here because the code is where the next person
 * meets the question, and again in
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md § 2.
 *
 * It also reads **`reasoning` only**. A verdict written into a claim's own
 * one-line restatement is not blanked, because that line is the claim's identity
 * and there is nothing to put in its place — the eval still scans it, and that
 * gap is deliberate rather than overlooked.
 */
const ADEQUACY_FRAMES: readonly { readonly name: string; readonly re: RegExp }[] = [
  {
    name: "degree or negation on a support verb",
    re: /\b(?:fully|directly|clearly|convincingly|adequately|sufficiently|amply|strongly|weakly|partially|partly|barely|hardly|does not|doesn't|do not|don't|did not|didn't|fails? to|failed to|falls? short of|stops? short of|cannot|can't)\s+(?:\w+\s+){0,2}(?:establish|support|substantiat|justif|prove|proves|proven|warrant|carr(?:y|ies)|bears? out|corroborat|validat|deliver)/i,
  },
  {
    name: "the claim is / is not established",
    re: /\bclaims?\s+(?:is|are|was|were)\s+(?:not\s+)?(?:fully\s+|well\s+|poorly\s+|thinly\s+|only\s+|partly\s+)?(?:establish|support|substantiat|justif|prov|warrant|borne out)/i,
  },
  {
    name: "overstated / unsupported",
    re: /\b(?:unsupported|overstat|overclaim|overreach|oversell|understat|unjustified|unwarranted)/i,
  },
  {
    name: "quantity of evidence as a verdict",
    re: /\b(?:no|little|scant|thin|weak|insufficient|inadequate|limited|scarce)\s+(?:direct\s+|empirical\s+|real\s+|actual\s+)?(?:evidence|support|basis|grounds|backing)\s+(?:for|to|that|here)\b/i,
  },
  {
    name: "counting passages as a verdict",
    re: /\bonly\s+(?:one|a single|two|this one|these two)\s+(?:passage|place|mention|result|experiment|sentence|paragraph|block|point)/i,
  },
  {
    /* **The claim was never tested — not "X was not measured".** The narrower
       shape is the whole difference between a verdict and a restatement, and
       both were in the first paid run: the guarded model wrote *"notes that the
       transfer experiments referenced in the introduction were not conducted"*,
       which is what the limitations paragraph says, and the ablated one wrote
       *"Limitations explicitly admit the transfer claim was not tested"*, which
       is a finding about the claim. The first draft of this frame fired on both.
       So the negated verb has to have the claim, the contribution or the
       abstract beside it. Both lines are pinned in the eval's `SELF_CHECK`, so
       the narrowing cannot quietly come undone. */
    name: "the claim was never tested",
    re: /\b(?:claims?|contributions?|abstract|assertion)\b[^.]{0,48}\b(?:was|were|is|are)\s+(?:never|not)\s+(?:actually\s+|directly\s+|ever\s+)?(?:tested|measured|shown|demonstrated|substantiated|verified|run|established|supported)\b|\b(?:never|not)\s+(?:actually\s+|directly\s+|ever\s+)?(?:tested|shown|demonstrated|substantiated|verified|run)\b[^.]{0,32}\b(?:claims?|contributions?|abstract)\b/i,
  },
  {
    /* An assertion offered where evidence was expected — the ablated run's
       *"Only speculative discussion is offered in place of transfer evidence"*. */
    name: "assertion in place of evidence",
    re: /\bin place of\s+(?:\S+\s+){0,3}(?:evidence|support|proof|data|a test|testing)\b|\b(?:only|merely|just|no more than)\s+(?:\w+\s+){0,1}(?:speculative|speculation|assertion|assertions|restatement|restatements|repetition)\b/i,
  },
  {
    /* `\S+` and not `\w+` in the gap: the first draft used `\w+` and could not
       step over "40%", so *"far smaller than the 40% figure claimed up front"*
       — an adequacy verdict in the ablated run — went unflagged. A character
       class is a silent way for a counter to stop covering the case it was
       written for. */
    name: "the result measured against the claim",
    re: /\b(?:short of|less than|smaller than|more modest than|narrower than|broader than|weaker than|stronger than|at odds with|inconsistent with|contradicts|undercuts|does not match|rather than the)\s+(?:\S+\s+){0,4}(?:claim|abstract|headline|introduction|contribution|figure|number)/i,
  },
  {
    name: "the paper fails to",
    re: /\bthe paper\s+(?:does not|doesn't|fails? to|never)\b/i,
  },
  {
    name: "a verdict on the whole paper",
    re: /\b(?:publishable|should be accepted|should be rejected|accept this paper|reject this paper|merits publication|strong paper|weak paper|significant contribution|the evidence is strong|unusually strong)\b/i,
  },
];

/** Which frames a line matches, by name. Empty is the ordinary case. */
export function adequacyFrames(text: string): string[] {
  return ADEQUACY_FRAMES.filter((f) => f.re.test(text)).map((f) => f.name);
}

/** How long a run of the paper's own words counts as the paper's rather than the model's. */
const PAPER_PHRASE = 4;

/**
 * Lower-case, punctuation-flattened words — the form both halves of the
 * subtraction compare in. Exported because the eval compares quotes the same
 * way and there must be one of it.
 */
export function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9%.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every four-word run of the paper's own text, so the model's echo of it can be masked. */
export function paperPhrases(blocks: readonly Block[]): Set<string> {
  const words = normaliseText(blocks.map((b) => b.text).join(" ")).split(" ");
  const grams = new Set<string>();
  for (let i = 0; i + PAPER_PHRASE <= words.length; i++) {
    grams.add(words.slice(i, i + PAPER_PHRASE).join(" "));
  }
  return grams;
}

/**
 * The model's sentence with every four-word run of the paper's own text masked
 * out, so that a model echoing the paper's vocabulary cannot be mistaken for a
 * model passing judgement on it.
 *
 * Masked words become `·` rather than disappearing, so that removing the middle
 * of a sentence cannot join its two halves into a frame neither of them was.
 */
export function subtractPaperPhrases(text: string, grams: Set<string>): string {
  const words = text.split(/\s+/).filter(Boolean);
  const normed = words.map((w) => normaliseText(w));
  const keep = words.map(() => true);
  for (let i = 0; i + PAPER_PHRASE <= words.length; i++) {
    if (grams.has(normed.slice(i, i + PAPER_PHRASE).join(" "))) {
      for (let k = i; k < i + PAPER_PHRASE; k++) keep[k] = false;
    }
  }
  return words.map((w, i) => (keep[i] ? w : "·")).join(" ");
}

/* --------------------------------- what the claims did not account for -- */

/**
 * How many words a fragment has to have before it counts as an assertion.
 *
 * Six, and it is doing two jobs at once: a comma or a full stop is only a unit
 * boundary when **both** sides clear it, and a unit shorter than this is never
 * reported. That single number is what keeps *"We present Ridge,"* from being a
 * unit that swallows the anchor of the claim in the clause after it, and what
 * keeps *"Our contributions are three."* off the list.
 *
 * It was tuned against the five papers in `evals/referee-claims.ts`, and the
 * tuning is recorded rather than smoothed away: at five, *"In a pre-registered
 * randomised trial,"* became a unit of its own and orphaned the fluency claim
 * that follows it in the same sentence.
 */
const MIN_UNIT_WORDS = 6;

/** One sentence — or one clause of a compound one — of the paper, where it sits. */
export interface OpeningSentence {
  blockId: BlockId;
  /** The article's own characters. */
  text: string;
  /** Where it starts in `block.text`, so the row is a door like every other row. */
  start: number;
}

/**
 * Split a block into the units a claim could be anchored in: sentences, and the
 * clauses of a compound sentence.
 *
 * **Both sides of a boundary must clear `MIN_UNIT_WORDS`**, which is what stops
 * an abbreviation, a decimal or an appositive from producing a fragment. The
 * consequence is deliberate: the tail after the last accepted boundary always
 * clears it too, so a unit below the threshold can only ever be a whole short
 * block.
 *
 * This is a splitter, not a parser. It does not know what a clause is; it knows
 * where commas and full stops are and how long the pieces either side are. That
 * is enough for the job it has — see `unaccountedSentences` — and pretending
 * otherwise would be pretending to know which words are a claim.
 */
function units(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  const wordsIn = (s: string): number => (s.trim().match(/\S+/g) ?? []).length;

  /* A boundary sits after the comma, the semicolon or the sentence-ending stop,
     so the punctuation stays with the clause it closes. */
  const boundaries: number[] = [];
  const re = /[,;]\s+|[.!?]["'”’)\]]*\s+/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    boundaries.push(m.index + m[0].length);
  }

  let from = 0;
  for (const at of boundaries) {
    if (at <= from) continue;
    if (wordsIn(text.slice(from, at)) < MIN_UNIT_WORDS) continue;
    if (wordsIn(text.slice(at)) < MIN_UNIT_WORDS) continue;
    out.push({ text: text.slice(from, at).trim(), start: from });
    from = at;
  }
  const tail = text.slice(from).trim();
  if (tail !== "") out.push({ text: tail, start: from });
  return out;
}

/**
 * **The sentences the claims above do not account for** — the answer to *what
 * did the model not put in front of the referee*, computed rather than asked
 * for.
 *
 * ## Why this exists
 *
 * The sub-mode's defence against *a tired referee treats everything unlisted as
 * clean* is `NO_PASSAGE_FOUND`: a claim that gets a row and an honest sentence
 * saying nothing was found for it. **A claim that never gets a row is
 * invisible**, and the panel looks exactly as tidy either way. The eval found
 * exactly that (`evals/results/referee-claims.md` § *And the failure the rule
 * says nothing about*): two papers silently dropped a claim from their own
 * abstract, twice each, and in both cases the dropped claim's words *were* in
 * the answer — swallowed inside a neighbouring claim's quote, which is not the
 * same as the referee having the claim.
 *
 * Completeness cannot be verified in general: deciding what a paper's claims are
 * is a judgement, which is exactly why this feature refuses to rank them. What
 * **can** be computed is what the answer did not account for.
 *
 * ## The rule, and it is one line
 *
 * A unit is accounted for when **some claim's quote begins inside it**. Nothing
 * else counts:
 *
 * - **Begins inside, not overlaps.** A quote covering a whole three-clause
 *   sentence would otherwise account for all three, which is precisely the
 *   failure this exists to surface. `claim.start` is already the anchor
 *   contract, so no fuzzy matching is involved anywhere in here.
 * - **Claims, not passages.** The question is which *claims* the list does not
 *   make. A passage is not a claim, and letting one account for a unit would
 *   quietly hide a dropped claim that some other claim happened to cite.
 *
 * ## And the blocks it looks at are the model's own choice
 *
 * Only the blocks a claim in this run is anchored in. **Not "the opening"**, and
 * that is the deliberate part: deciding which blocks are the paper's opening is
 * itself a judgement, and one made wrong in either direction — a title page, a
 * long introduction, a contributions list six paragraphs down. Taking the blocks
 * the claims actually came from asserts nothing at all about the paper, and
 * makes every row say only *this sentence sits beside a claim you were given,
 * and no claim was anchored in it*.
 *
 * **The gap that leaves**, written down rather than discovered later: a whole
 * block the model ignored — a contributions list it never quoted from — is
 * invisible here, because nothing anchored to it. Closing that would mean
 * asserting where the paper's claims live, which is the judgement this refuses
 * to make. If it turns out to matter, the honest version is a fixed prefix of
 * the article, named as a prefix.
 */
export function unaccountedSentences(blocks: Block[], claims: readonly Claim[]): OpeningSentence[] {
  const anchors = new Map<BlockId, number[]>();
  for (const c of claims) {
    const at = anchors.get(c.blockId);
    if (at) at.push(c.start);
    else anchors.set(c.blockId, [c.start]);
  }

  const out: OpeningSentence[] = [];
  /* Document order, like everything else here: the article's block order, then
     position within the block. Nothing is sorted by anything else, and there is
     nothing to rank. */
  for (const block of blocks) {
    const starts = anchors.get(block.id);
    if (!starts) continue;
    const found = units(block.text);
    for (const [i, unit] of found.entries()) {
      /* The next unit's start, not this one's trimmed length: a claim anchored
         in the whitespace a trim removed would otherwise account for nothing at
         all, and the units have to tile the block for the rule to be total. */
      const end = found[i + 1]?.start ?? block.text.length;
      if (starts.some((s) => s >= unit.start && s < end)) continue;
      if ((unit.text.match(/\S+/g) ?? []).length < MIN_UNIT_WORDS) continue;
      out.push({ blockId: block.id, text: unit.text, start: unit.start });
    }
  }
  return out;
}

/* ---------------------------------------------------------- what was lost -- */

/** What validation threw away, so a log line and a panel can say it out loud. */
export interface DroppedClaims {
  /** Claims with no `blockId`, no `quote`, or no line saying what the claim is. */
  malformed: number;
  /** Claims anchored to a block this article does not have. */
  unknownIds: number;
  /** Claims whose quote is not in the block they named. */
  unquoted: number;
  /** Claims anchored to words an earlier claim already claimed. */
  duplicates: number;
  /** Claims past `MAX_CLAIMS`. Counted so a cap is never silent. */
  truncated: number;
  /** Passages with no anchor in them at all. */
  passageMalformed: number;
  /** Passages naming a block this article does not have. */
  passageUnknownIds: number;
  /** Passages whose quote is not in the block they named. */
  passageUnquoted: number;
  /** Passages repeating a passage already kept for the same claim. */
  passageDuplicates: number;
  /** Passages past `MAX_PASSAGES` on one claim. */
  passageTruncated: number;
}

function nothingDropped(): DroppedClaims {
  return {
    malformed: 0,
    unknownIds: 0,
    unquoted: 0,
    duplicates: 0,
    truncated: 0,
    passageMalformed: 0,
    passageUnknownIds: 0,
    passageUnquoted: 0,
    passageDuplicates: 0,
    passageTruncated: 0,
  };
}

/**
 * **How many whole claims the model returned that could not be kept** — the
 * number that tells *the model found nothing* apart from *the model found
 * something and could not produce a usable answer about it*.
 *
 * The same function, for the same reason, as `discardedRows` in
 * src/referee-criteria.ts, whose docstring carries the bug: those two states
 * used to render as one sentence and the sentence was false for the second of
 * them. `truncated` is deliberately not here — those claims were good and *we*
 * capped them, which is a fact about this app rather than about the answer, and
 * a truncated answer has `MAX_CLAIMS` claims in it so it is never the empty case
 * this exists for. Nor are the `passage*` counts: a claim whose passages were
 * all thrown away is still a claim, and it says so on its own row through
 * `Claim.discarded`.
 */
export function discardedClaims(dropped: DroppedClaims): number {
  return dropped.malformed + dropped.unknownIds + dropped.unquoted + dropped.duplicates;
}

/* ---------------------------------------------------------- the validator -- */

/**
 * Thrown when the reply is not the shape a reply has to be.
 *
 * The top-level shape is **asserted, not defaulted**, for the reason
 * `UnreadableResults` gives one file over: an unreadable reply quietly becoming
 * `[]` is stored as the legitimate, meaningful answer *"this paper makes no
 * claims up front"* — which is a sentence about the paper that nothing has
 * earned, and the one failure a referee could not possibly diagnose.
 * docs/reusable/silent-success.md.
 */
export class UnreadableClaims extends Error {
  constructor(cause: string) {
    super("The model's answer could not be read as a list of claims.", { cause });
    this.name = "UnreadableClaims";
  }
}

/** A block's position in the article, by id — the only sort key in this file. */
function positions(blocks: Block[]): Map<BlockId, number> {
  const at = new Map<BlockId, number>();
  for (const [i, b] of blocks.entries()) at.set(b.id, i);
  return at;
}

/**
 * **Document order, and it is the only order this feature has.**
 *
 * Block position first, then offset within the block, then the claim's own text
 * so that the sort is total and a re-run of the same answer cannot shuffle. It
 * reads `at` and the anchor and nothing else — in particular it cannot see
 * `passages`, which is what makes "no ranking by support count" a property of
 * the code rather than a promise in a prompt.
 */
function byDocument<T extends Anchored>(at: Map<BlockId, number>): (a: T, b: T) => number {
  return (a, b) => {
    const ai = at.get(a.blockId) ?? Number.MAX_SAFE_INTEGER;
    const bi = at.get(b.blockId) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    if (a.start !== b.start) return a.start - b.start;
    return a.quote < b.quote ? -1 : a.quote > b.quote ? 1 : 0;
  };
}

/**
 * The claims worth keeping, in the order the paper makes them, and an account of
 * what was thrown away.
 *
 * Tolerant parse, strict validation, count what you dropped, never invent — the
 * discipline borrowed wholesale from src/search.ts and src/referee-criteria.ts.
 * What is different here is only what the rules above require: the sort is by
 * position and cannot see how many passages a claim has, and a claim whose
 * passages were all thrown away keeps its own count so the panel can say which
 * of the three things happened.
 */
export function validateClaims(
  raw: unknown,
  blocks: Block[],
): { claims: Claim[]; dropped: DroppedClaims; withheld: string[] } {
  const list = (raw as { claims?: unknown } | null | undefined)?.claims;
  if (!Array.isArray(list)) throw new UnreadableClaims("claims-not-an-array");

  const dropped = nothingDropped();
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const at = positions(blocks);
  const claims: Claim[] = [];
  const seen = new Set<string>();

  /**
   * The verdict lines this pass blanked, so a caller can say how many and an
   * eval can still read what they said.
   *
   * **Returned rather than logged**, and returned rather than left on the
   * passage: the server may not log a passage's reasoning (a paper under review
   * is somebody else's unpublished work — src/referee-claims-run.ts § What may
   * be logged), and shipping the sentence to the client under another name would
   * be printing it after all. The eval is the one caller that reads the strings.
   */
  const withheld: string[] = [];

  /**
   * The frames, applied — raw first, and the paper's own words subtracted only
   * if something fires.
   *
   * That order is an optimisation with a point: `paperPhrases` walks the whole
   * article, this runs once per passage, and `validateClaims` is called again
   * for **every claim as it streams**. A frame firing is rare, so the article is
   * almost never walked; and when it does fire the subtraction is what separates
   * a model passing judgement from a model quoting a paper that is about
   * evidence quality.
   */
  let grams: Set<string> | undefined;
  const readsAsAVerdict = (line: string): boolean => {
    if (line === "" || adequacyFrames(line).length === 0) return false;
    grams ??= paperPhrases(blocks);
    return adequacyFrames(subtractPaperPhrases(line, grams)).length > 0;
  };

  for (const item of list) {
    const row = (item ?? {}) as Record<string, unknown>;
    const { blockId, quote, claim } = row;
    if (
      typeof blockId !== "string" ||
      typeof quote !== "string" ||
      typeof claim !== "string" ||
      claim.trim() === ""
    ) {
      dropped.malformed++;
      continue;
    }

    const block = byId.get(blockId);
    if (!block) {
      dropped.unknownIds++;
      continue;
    }
    const span = findQuote(block.text, quote, undefined, "spaced");
    if (!span) {
      dropped.unquoted++;
      continue;
    }

    const id = `${blockId}:${span.start}`;
    if (seen.has(id)) {
      dropped.duplicates++;
      continue;
    }
    seen.add(id);

    const { passages, discarded } = readPassages(
      row.passages,
      byId,
      at,
      dropped,
      readsAsAVerdict,
      withheld,
    );
    claims.push({
      id,
      blockId,
      // The article's words, not the model's retyping — the guarantee this
      // validation exists to give.
      quote: block.text.slice(span.start, span.end),
      start: span.start,
      claim: claim.trim(),
      passages,
      discarded,
    });
  }

  /* Sorted **after** the whole list is built rather than inserted in order, so
     that the comparator is one function with one job and there is nowhere for a
     second ordering rule to hide. */
  claims.sort(byDocument(at));

  if (claims.length > MAX_CLAIMS) {
    /* Truncated from the **end of the document**, which is the only defensible
       place to cut when the order is positional: any other choice would be a
       judgement about which claims matter, made by a cap. */
    dropped.truncated = claims.length - MAX_CLAIMS;
    claims.length = MAX_CLAIMS;
  }
  return { claims, dropped, withheld };
}

/**
 * One claim's passages, checked the same way the claim itself was.
 *
 * `discarded` comes back separately from the shared `dropped` tally because the
 * two answer different questions: the tally is a log line about the whole run,
 * and this number decides which sentence appears under *this* row. Both are
 * kept — see `Claim.discarded`.
 */
function readPassages(
  raw: unknown,
  byId: Map<BlockId, Block>,
  at: Map<BlockId, number>,
  dropped: DroppedClaims,
  readsAsAVerdict: (line: string) => boolean,
  withheld: string[],
): { passages: ClaimPassage[]; discarded: number } {
  if (!Array.isArray(raw)) return { passages: [], discarded: 0 };

  const passages: ClaimPassage[] = [];
  const seen = new Set<string>();
  let discarded = 0;

  for (const item of raw) {
    const row = (item ?? {}) as Record<string, unknown>;
    const { blockId, quote, reasoning } = row;
    if (typeof blockId !== "string" || typeof quote !== "string") {
      dropped.passageMalformed++;
      discarded++;
      continue;
    }
    const block = byId.get(blockId);
    if (!block) {
      dropped.passageUnknownIds++;
      discarded++;
      continue;
    }
    const span = findQuote(block.text, quote, undefined, "spaced");
    if (!span) {
      dropped.passageUnquoted++;
      discarded++;
      continue;
    }
    const key = `${blockId}:${span.start}`;
    if (seen.has(key)) {
      /* Not counted as discarded: the passage IS on the row, once. Counting it
         would let a claim whose only failure was a repeat print the sentence
         reserved for an answer nothing could be made of. */
      dropped.passageDuplicates++;
      continue;
    }
    seen.add(key);
    /* **Blank the sentence, keep the passage.** The linkage is still a door into
       the prose and is the half a referee uses; dropping the row to be rid of
       one sentence would cost them a real passage to save a bad line. Failing
       safe here means failing towards showing the paragraph. */
    const line = typeof reasoning === "string" ? reasoning.trim() : "";
    const verdict = readsAsAVerdict(line);
    if (verdict) withheld.push(line);
    passages.push({
      blockId,
      quote: block.text.slice(span.start, span.end),
      start: span.start,
      reasoning: verdict ? "" : line,
      ...(verdict ? { withheld: true as const } : {}),
    });
  }

  passages.sort(byDocument(at));
  if (passages.length > MAX_PASSAGES) {
    dropped.passageTruncated += passages.length - MAX_PASSAGES;
    passages.length = MAX_PASSAGES;
  }
  return { passages, discarded };
}
