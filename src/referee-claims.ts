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
 * guard was built on the wrong side of the door. `otherTextInQuotes` is the
 * other side: the rest of the text inside the passages these claims quote, that
 * no claim begins in — computed rather than asked for, and worded as *other
 * text* rather than as *claims the model missed*, because the second of those is
 * the same judgement in reverse.
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
   * **This claim's own line was a verdict, so it was blanked** and `claim` is
   * the empty string.
   *
   * Set by `validateClaims` and never by the model, exactly like
   * `ClaimPassage.withheld`. Until 2026-09-01 the fail-safe read `reasoning`
   * only, and a committed test pinned an adequacy verdict surviving untouched in
   * the headline — *"The 40% claim is not supported by the results"* — which
   * GPT Sol's second review called what it was: not an edge case but a direct
   * bypass, in the most prominent sentence on the row.
   *
   * **The claim survives, and so does its label.** The paper's own `quote` is
   * already on the row and is not the model's judgement, so it stands in as the
   * label (`CLAIM_WITHHELD`). Dropping the claim instead would cost the referee
   * a claim the paper actually makes, to be rid of one sentence.
   */
  claimWithheld?: true;
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
  /**
   * **How many good passages `MAX_PASSAGES` cut off this claim.**
   *
   * Different from `discarded` in the way that matters: those were the model's
   * failures and these were ours, so the row says a different sentence
   * (`PASSAGES_CAPPED`) and it is not a reason to run anything again.
   *
   * **Never sorted on, never printed as a number.** It is here so the cap is not
   * silent — GPT Sol's second review, finding 5: a cap nobody is told about is a
   * fourth ranking signal, visibility itself, in a sub-mode built to have none.
   * The panel says a numberless sentence; this field is for a log or an eval.
   *
   * Optional and absent when nothing was cut, so a run stored before this
   * existed reads as zero — which is the truth about it.
   */
  passagesOmitted?: number;
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
   * **How many claims `MAX_CLAIMS` cut off the end of this run.**
   *
   * The run-level half of `Claim.passagesOmitted`, and it exists for the same
   * reason: a referee reading an apparently complete list in which the claims
   * the paper makes last were systematically dropped is being ranked by
   * visibility (GPT Sol's second review, finding 5).
   *
   * **Optional, and the panel is honest either way.** `validateClaims` computes
   * it as `DroppedClaims.truncated`, but the route that stores a run
   * (src/routes.ts § `runRefereeClaims`) writes `claims` and `model` and nothing
   * else, so until it also writes this the field is absent on every stored run.
   * The panel therefore falls back to `CLAIMS_AT_CAP`, which says the one thing
   * a full list proves on its own; with the field it says `claimsOmittedNote`
   * instead. Wiring it up is one line in that route:
   * `claimsOmitted: event.outcome.dropped.truncated`.
   */
  claimsOmitted?: number;
  /**
   * Fingerprint of the blocks this run was answered against — `hashBlocks`,
   * src/source-hash.ts. Same field and same word as `SavedCriterion`, and absent
   * counts as stale for the same reason: not knowing is not the same as knowing
   * it is fine (`isStale`, src/search-stale.ts, which takes this shape
   * structurally).
   */
  sourceHash?: string;
}

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
 *
 * **It says what the model was asked for, and no longer what a row "only"
 * says.** The first version promised *each row says only that the model thinks
 * this passage takes the claim up*, and that was a promise the code cannot keep:
 * `ADEQUACY_FRAMES` below is a fail-safe with a stated miss rate, and a verdict
 * phrased around every frame reaches the screen. GPT Sol's second review said so
 * — *"arbitrary model-authored linkage prose cannot reach the screen"* if the
 * rule is to be hard — and the honest half of the answer is to stop claiming a
 * boundary that is not there. What *is* enforced is written down beside the
 * frames.
 */
export const LINKAGE_NOT_ADEQUACY =
  "The model was asked for one thing only: where the paper takes each claim up. Whether the " +
  "passage carries the claim is yours to judge — press a row and read the paragraph.";

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
  const what = n === 1 ? "One line the model wrote was" : `${n} lines the model wrote were`;
  return `${what} withheld above, for reading as a judgement on whether the paper carries a claim.`;
}

/**
 * **What stands where a withheld claim headline would have been.**
 *
 * The headline is the model's one-line paraphrase of a claim, and until
 * 2026-09-01 it was the one piece of model prose on the panel that nothing
 * scanned — *"the biggest text on screen"*, and a committed test pinned a
 * verdict surviving in it untouched (GPT Sol's second review, finding 2). It is
 * scanned now, and when it reads as a verdict the row loses it.
 *
 * **The row does not lose its label with it.** The paper's own sentence is
 * already on the row, already validated against the block it came from, and it
 * is not the model's judgement — so it stands in as the label, which is the
 * fallback the review asked for. Nothing is invented and nothing is dropped.
 */
export const CLAIM_WITHHELD =
  "The model's one-line version of this claim was withheld — it read as a judgement on whether " +
  "the paper carries the claim, and that judgement is yours. The paper's own words stand below in " +
  "its place.";

/**
 * **What a row says when the model named more passages than the cap keeps.**
 *
 * Numberless on purpose, and it is the same rule that keeps every other number
 * off a claim row: a count of passages is one glance from a ranking, and *how
 * many were cut* is that count again by another route. What a referee needs from
 * this sentence is that the row is incomplete and which way the cut went, and
 * both of those fit without a digit. The count itself is on
 * `Claim.passagesOmitted` for a log or an eval to read.
 */
export const PASSAGES_CAPPED =
  "The model named more passages for this claim than are shown. What was cut is what comes " +
  "latest in the paper — the cut is by position, never by how much a passage seemed to matter.";

/**
 * **And the same thing for the list as a whole**, where the number is allowed.
 *
 * Outside the list, so the no-digit rule that governs a claim row does not
 * apply, and a count here cannot be read as a ranking of anything: it is a fact
 * about this app's cap. `n` is how many claims validation threw away for being
 * past `MAX_CLAIMS`.
 */
export function claimsOmittedNote(n: number): string {
  const what = n === 1 ? "One further claim the model returned was" : `${n} further claims the model returned were`;
  return `${what} cut, because this run reached the panel's cap of ${MAX_CLAIMS}. The cut is from the end of the paper, so it is the claims the paper makes last that are missing.`;
}

/**
 * **And what the panel says when it can see the cap was reached but not how far
 * past it the answer went.**
 *
 * A run stored before `ClaimsRun.claimsOmitted` existed — and, until the route
 * carries that field, every run — has the claims and not the count. Saying
 * nothing would be the silent cap the review objected to; inventing a number
 * would be worse. So this sentence says the one thing that is certainly true.
 */
export const CLAIMS_AT_CAP =
  `This run reached the panel's cap of ${MAX_CLAIMS} claims. If the model returned more, they were ` +
  "cut from the end of the paper, so the claims the paper makes last may be missing here.";

/** The heading over the rest of the text inside the passages the claims quote. */
export const OTHER_TEXT_HEADING = "Other text inside these quoted passages";

/**
 * **What that list is, and — more important — what it is not.**
 *
 * The distinction is the whole value of the feature. These are units of the
 * paper that sit **inside a passage a claim above quotes** and that no claim
 * above begins in. That is a mechanical fact about the list; it is **not** a
 * list of claims the model missed, because deciding what is a claim is a
 * judgement and this sub-mode does not make judgements about the paper. A quoted
 * sentence carries background and setup as well as claims, and a claim anchored
 * in one clause of a compound sentence leaves the rest of it here.
 *
 * The last clause hands the judgement over explicitly, because a referee who
 * reads this as an accusation will either dismiss it or over-trust it, and both
 * are worse than reading three sentences of the paper.
 *
 * **The heading and the word "sentences" both changed on 2026-09-01.** GPT Sol's
 * second review found three mismatches between what this said and what it did:
 * *"Not accounted for"* landed before its own caveat; the rows were called
 * sentences when the splitter deliberately makes clauses; and *no claim is
 * anchored in it* reads as absence of coverage when it means only that no claim
 * **begins** there. See `otherTextInQuotes`.
 */
export const OTHER_TEXT_NOTE =
  "The rest of the text inside the passages the claims above quote, split into sentences and " +
  "clauses, with the parts a claim above begins in taken out. That is a fact about the list above " +
  "rather than about the paper: a quoted sentence carries background, citation and setup as well " +
  "as claims. Read them, and decide for yourself whether any of them is a claim.";

/**
 * **And that this list is capped too**, printed only when the cap fired.
 *
 * No count, for the reason nothing else in this section has one: six of these is
 * not a worse answer than two.
 */
export const OTHER_TEXT_AT_CAP =
  "There was more text inside those quoted passages than is shown here. The list is capped, and " +
  "what is missing is what comes latest in the paper.";

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
 * **This is defence in depth and it is not the enforcing boundary**, which is
 * GPT Sol's second review put plainly, and the numbers behind the frames should
 * be read the same way. The 6/6-and-10/10 in `evals/results/referee-claims.md`
 * is **in-sample**: the frames were shaped by the very lines they are checked
 * against, so a production miss is necessarily an eval miss too. The held-out
 * set the review asked for is `HELD_OUT` in `evals/referee-claims.ts` — written
 * before any of these frames was touched, labelled by hand, and reported with
 * its misses rather than its hits.
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
 * ## It reads the claim's own line too, since 2026-09-01
 *
 * It used to read `reasoning` only, on the argument that a claim's headline is
 * its identity and there is nothing to put in its place. Both halves of that
 * were wrong. The headline is the biggest text on the row, so it was the best
 * place in the sub-mode to put a verdict; and there *is* something to put in its
 * place — **the paper's own sentence**, which is already on the row, already
 * checked against the block it came from, and is not the model's judgement.
 * `Claim.claimWithheld` and `CLAIM_WITHHELD`.
 */
const ADEQUACY_FRAMES: readonly { readonly name: string; readonly re: RegExp }[] = [
  {
    name: "degree or negation on a support verb",
    re: /\b(?:fully|directly|clearly|convincingly|adequately|sufficiently|amply|strongly|weakly|partially|partly|barely|hardly|does not|doesn't|do not|don't|did not|didn't|fails? to|failed to|falls? short of|stops? short of|cannot|can't)\s+(?:\w+\s+){0,2}(?:establish|support|substantiat|justif|prove|proves|proven|warrant|carr(?:y|ies)|bears? out|corroborat|validat|deliver|demonstrat|backs?|backed)/i,
  },
  {
    /* The subject list grew past `claim` on 2026-09-01: *"the 40% figure is not
       backed by the results"* is the same verdict about the same sentence, and
       a headline is where a model would write it. */
    name: "the claim is / is not established",
    re: /\b(?:claims?|contributions?|figures?|numbers?|headline|abstract|assertions?|results?)\s+(?:is|are|was|were)\s+(?:not\s+)?(?:fully\s+|well\s+|poorly\s+|thinly\s+|only\s+|partly\s+)?(?:establish|support|substantiat|justif|prov|warrant|borne out|backed|demonstrat|corroborat)/i,
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

  /* --- The four below are GPT Sol's, from its second review, and none of them
         matched anything above when it wrote them. They are the shapes that say
         a verdict without a single verdict word in them, which is why a word
         list and the first nine frames both walk straight past:

           "The results report 11.5%, while the abstract promises 40%."
           "Only SST-2 is examined."
           "No transfer experiment appears in the paper."
           "The result and the headline concern different quantities."

         Each was checked against all 48 model-authored lines of the five
         guarded runs in `evals/results/referee-claims.md` — headlines and
         reasoning lines both — and raises no alarm on any of them. That is a
         false-alarm check on real committed output rather than on invented
         sentences, which is the only kind worth having here: a frame that
         blanks an honest linkage line costs the referee something real.

         And they are still frames rather than a boundary. Adding them makes the
         four sentences above in-sample, so their green proves the code has not
         regressed and nothing else. --- */
  {
    /* Setting the paper's own number against what it promised. The contrast
       word carries it — a linkage line names the abstract all the time and
       never puts a *but* in front of it. */
    name: "the paper's own number set against the claim",
    re: /\b(?:while|whereas|but|yet|though|although|against|compared with|compared to)\b[^.]{0,64}\b(?:abstract|headline|introduction|contributions?|claims?|claimed|promise[sd]?)\b/i,
  },
  {
    name: "two different quantities",
    re: /\b(?:different|another|not the same)\s+(?:\w+\s+){0,2}(?:quantity|quantities|measure|measures|metric|metrics|number|numbers|thing|things|question)\b/i,
  },
  {
    name: "the paper contains no such thing",
    re: /\bno\s+(?:\S+\s+){0,3}(?:experiment|test|analysis|evaluation|measurement|comparison|study|ablation)s?\s+(?:appears?|is|are|was|were|exists?)\b|\b(?:appears?|is|are)\s+(?:nowhere|absent)\b|\bnowhere in the (?:paper|manuscript)\b/i,
  },
  {
    /* **Anchored at the start of the line**, and that is the whole of the
       narrowing. *"Only SST-2 is examined"* is a verdict standing on its own;
       *"notes that only SST-2 was examined"* is a restatement of the paper's own
       limitations sentence, and blanking that would cost a referee a true line.
       The anchor is trivially stepped around by writing "Note that" first, which
       is what defence in depth looks like rather than a hole. */
    name: "a scope verdict standing on its own",
    re: /^(?:only|just|merely)\s+(?:\S+\s+){0,4}(?:is|are|was|were)\s+(?:examined|tested|evaluated|measured|reported|studied|run|shown)\b/i,
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

/* ------------------------- the rest of what the claims quoted -- */

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

/**
 * As many of these as a referee will read before deciding the section is noise.
 *
 * The narrowing in `otherTextInQuotes` is what makes this cap rarely fire — the
 * rows can only come from inside a quote the model actually returned — but a
 * model that quotes whole paragraphs would still produce a wall, and a wall is
 * the failure that matters most for a section whose entire value is being read.
 * Past the cap the panel says so (`OTHER_TEXT_AT_CAP`) rather than trimming in
 * silence.
 */
export const MAX_OTHER_TEXT = 12;

/** One sentence — or one clause of a compound one — of the paper, where it sits. */
export interface OtherText {
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
 * is enough for the job it has — see `otherTextInQuotes` — and pretending
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
 * **The rest of the text inside the passages the claims quote** — the answer to
 * *what did the model swallow into a quote instead of putting in front of the
 * referee*, computed rather than asked for.
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
 * **can** be computed is what a returned quote covered and no returned claim
 * began in.
 *
 * ## The rule, and it is two lines
 *
 * A unit is listed when its start lies **inside some claim's quote** and **no
 * claim begins in it**.
 *
 * - **Begins inside, not overlaps.** A quote covering a whole three-clause
 *   sentence would otherwise account for all three, which is precisely the
 *   failure this exists to surface. `claim.start` is already the anchor
 *   contract, so no fuzzy matching is involved anywhere in here.
 * - **Claims, not passages.** The question is which *claims* the list does not
 *   make. A passage is not a claim, and letting one account for a unit would
 *   quietly hide a dropped claim that some other claim happened to cite.
 *
 * ## It used to read the whole block, and that was too much — 2026-09-01
 *
 * The first version listed every unit of every block a claim was taken from. It
 * is mechanically true and GPT Sol's second review was right that it does not
 * survive contact with a real paper: one long abstract block produces dozens of
 * background and setup clauses under a heading reading *"Not accounted for"*,
 * which is enough for a referee to stop reading the section — the failure that
 * matters most for a feature whose whole value is being read.
 *
 * So it is narrowed to the failure it was introduced for. The swallowed
 * neighbour is still caught, because a swallowed claim is by definition **inside
 * the quote that swallowed it**: the Ridge answer's memory and robustness
 * clauses sit inside the abstract sentence quoted whole under the speed claim,
 * and tests/referee-claims-accounting.test.ts pins that against the real
 * committed answer.
 *
 * **What the narrowing gives up**, written down rather than discovered later: a
 * claim the model never quoted anywhere near — the third sentence of an
 * introduction whose first sentence it quoted — is no longer listed. That case
 * has never been observed; the swallowed one has, twice, on a repeat run. If it
 * turns out to matter, the honest escalation is the same one the old version
 * reached for and could not justify either: a fixed prefix of the article, named
 * as a prefix, rather than a judgement about where a paper's claims live.
 */
export function otherTextInQuotes(blocks: Block[], claims: readonly Claim[]): OtherText[] {
  /** Per block: where each claim begins, and the span each claim's quote covers. */
  const anchors = new Map<BlockId, { starts: number[]; spans: [number, number][] }>();
  for (const c of claims) {
    const at = anchors.get(c.blockId) ?? { starts: [], spans: [] };
    at.starts.push(c.start);
    at.spans.push([c.start, c.start + c.quote.length]);
    anchors.set(c.blockId, at);
  }

  const out: OtherText[] = [];
  /* Document order, like everything else here: the article's block order, then
     position within the block. Nothing is sorted by anything else, and there is
     nothing to rank. */
  for (const block of blocks) {
    const anchor = anchors.get(block.id);
    if (!anchor) continue;
    const found = units(block.text);
    for (const [i, unit] of found.entries()) {
      /* The next unit's start, not this one's trimmed length: a claim anchored
         in the whitespace a trim removed would otherwise account for nothing at
         all, and the units have to tile the block for the rule to be total. */
      const end = found[i + 1]?.start ?? block.text.length;
      if (!anchor.spans.some(([from, to]) => unit.start >= from && unit.start < to)) continue;
      if (anchor.starts.some((s) => s >= unit.start && s < end)) continue;
      if ((unit.text.match(/\S+/g) ?? []).length < MIN_UNIT_WORDS) continue;
      out.push({ blockId: block.id, text: unit.text, start: unit.start });
    }
  }
  /* Cut from the end of the paper, the only defensible place when the order is
     positional — and said out loud on the panel rather than trimmed in silence. */
  return out.slice(0, MAX_OTHER_TEXT);
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

    const { passages, discarded, omitted } = readPassages(
      row.passages,
      byId,
      at,
      dropped,
      readsAsAVerdict,
      withheld,
    );
    /* **The headline goes through the same fail-safe as a passage's line.** It
       is the biggest text on the row and it used to be the one piece of model
       prose nothing scanned. What stands in its place is the paper's own
       sentence, which is on the row already — see `Claim.claimWithheld`. */
    const line = claim.trim();
    const headlineIsAVerdict = readsAsAVerdict(line);
    if (headlineIsAVerdict) withheld.push(line);
    claims.push({
      id,
      blockId,
      // The article's words, not the model's retyping — the guarantee this
      // validation exists to give.
      quote: block.text.slice(span.start, span.end),
      start: span.start,
      claim: headlineIsAVerdict ? "" : line,
      ...(headlineIsAVerdict ? { claimWithheld: true as const } : {}),
      passages,
      discarded,
      ...(omitted > 0 ? { passagesOmitted: omitted } : {}),
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
): { passages: ClaimPassage[]; discarded: number; omitted: number } {
  if (!Array.isArray(raw)) return { passages: [], discarded: 0, omitted: 0 };

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
  /* Counted on the claim as well as in the run's tally, so the cap can say so on
     the row that lost something rather than only in a log line nobody reads —
     `Claim.passagesOmitted`, and GPT Sol's second review, finding 5. */
  let omitted = 0;
  if (passages.length > MAX_PASSAGES) {
    omitted = passages.length - MAX_PASSAGES;
    dropped.passageTruncated += omitted;
    passages.length = MAX_PASSAGES;
  }
  return { passages, discarded, omitted };
}
