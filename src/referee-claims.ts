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
 *    see `ClaimPassage.reasoning`.
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
   * shape, and "confirms the claim" is not. The prompt says so and the eval is
   * what would check it; this field's own promise is only that it is one line
   * about the connection.
   */
  reasoning: string;
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
): { claims: Claim[]; dropped: DroppedClaims } {
  const list = (raw as { claims?: unknown } | null | undefined)?.claims;
  if (!Array.isArray(list)) throw new UnreadableClaims("claims-not-an-array");

  const dropped = nothingDropped();
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const at = positions(blocks);
  const claims: Claim[] = [];
  const seen = new Set<string>();

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

    const { passages, discarded } = readPassages(row.passages, byId, at, dropped);
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
  return { claims, dropped };
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
    passages.push({
      blockId,
      quote: block.text.slice(span.start, span.end),
      start: span.start,
      reasoning: typeof reasoning === "string" ? reasoning.trim() : "",
    });
  }

  passages.sort(byDocument(at));
  if (passages.length > MAX_PASSAGES) {
    dropped.passageTruncated += passages.length - MAX_PASSAGES;
    passages.length = MAX_PASSAGES;
  }
  return { passages, discarded };
}
