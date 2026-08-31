/**
 * Pipeline stage 5h — the **timeline**: when the piece says these things
 * happened, in what order, and how sure it actually is.
 *
 *   npx tsx src/timeline.ts data/openai-huggingface
 *
 * Full design, the two reviews that rewrote it and the spike that measured it:
 * docs/plans/timeline-mode.md.
 *
 * ## The one thing that makes this different from every other stage
 *
 * **The model returns evidence. Code returns dates.** The model is never asked
 * for a date, an interval, or a bound. It returns the article's own temporal
 * words — `"By the next morning, July 11"` — and `readWhen` in
 * src/timeline-time.ts reads the date out of the **block's own characters**.
 *
 * So a date the article does not contain has no way into `when`, because there
 * is nowhere for one to come from. That is structural rather than checked, and
 * it is the fix for the safety hole the first design had: the
 * plan's original phrase-check failed in *both* directions — it rejected the
 * one correctly-stated span on the test article (an editorial `[F]rom` bracket)
 * and it accepted `July 1` found inside `July 11`. Both proved rather than
 * argued; the write-up is in src/timeline-time.ts's header.
 *
 * A hallucinated date is the highest-consequence thing this app could ship: a
 * wrong glossary entry looks wrong, and `12 June 2019` looks exactly like
 * `12 June 2019`.
 *
 * ## "The model cannot state a date" is a claim about the whole artefact
 *
 * The parser secures `when`, and that is not the same thing, which GPT Sol
 * demonstrated rather than argued on 2026-08-31: the model also writes a
 * `label` and a `phrase`, both of them prose, and `"06/12/19"` is a date to
 * every reader and to no pattern in `scanDates`. Two of the three ways in were
 * open, so all three are shut here rather than in the prompt:
 *
 * - **`when`** — parsed out of the block. Structural, and it always was.
 * - **`phrase`** — never the model's string. It is the article's own characters,
 *   sliced out of the block at the offsets `findQuote` located, exactly as
 *   `When.phrase` is. Words we cannot find in the quoted passage are not shown.
 * - **`label`** — checked with the same parser: a date expression in a label
 *   must be one the cited passage carries, or the event is dropped and counted.
 *   See `labelStatesAnUncitedDate`.
 *
 * So the sentence that is true of the finished artefact is: **every date and
 * every temporal word a reader sees came out of the article's own characters.**
 *
 * ## What the model is asked for, and what it is not
 *
 *   label       a short handle — NOT a retelling
 *   order       its reading of where this sits in the sequence — THE SORT KEY
 *   modality    happened | predicted | hypothetical
 *   phrase      the article's own temporal words, copied — or null
 *   occurrences [{ blockId, quote }], validated as `ideas` validates them
 *
 * It is **not** asked for a date, `earliest`/`latest`, `extent`, `basis`, or a
 * relative offset. Every one of those either comes out of the parser now or was
 * cut. `basis` in particular was a coin toss — the spike marked 16 dates
 * `"stated"` on one run and 13 of the same ones `"derived"` on the next, off
 * the same prompt — because in "July 7" the month is stated and the year is
 * derived and one field cannot say both.
 *
 * `extent` is worth a second look, because docs/plans/timeline-mode.md
 * § The prompt still asks for it: it is the parser's now. "During May" and
 * "from July 13 through July 19" are `extended` because `cueBefore` and
 * `joinsARange` read the block's own words, not because anybody judged it.
 *
 * ## The freshness input is blocks AND tree AND the publication date
 *
 * `datedArticleFingerprint`, **not** the `articleFingerprint` the other stages
 * use and not the `articleWithIdsFingerprint` `ideas` uses — see
 * `inputFingerprint`. The date is the reference frame for nineteen of the
 * twenty-four temporal expressions on the test article, so it is load-bearing
 * here in a way it is nowhere else. The profile is deliberately **not** in the
 * stamp: who is reading changes what an *idea* is, and does not change when
 * something happened.
 *
 * ## Ids do not inherit on the label
 *
 * `ideas` keys id inheritance on the name and this stage cannot, and that was
 * measured rather than feared: the spike reran the same prompt on the same
 * article and the labels paraphrased every time — *"Message volume crashes
 * package manager"* became *"Agents crash the package manager"*. Keying on the
 * label would break every saved `?event=` link on every regeneration. See
 * `evidenceKey`.
 *
 * ## Types live here for now
 *
 * `TimelineEvent` and the rest belong in src/types.ts and move there in Stage 4
 * with the store plumbing. They are local because another session is holding
 * that file, and reaching into it to add five interfaces is how two agents
 * overwrite each other. Same reason `TimelineModality` is local to
 * src/timeline-time.ts.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { partsOf } from "./arc.js";
import { type Article, readArticleFromDir } from "./article-input.js";
import { mintUniqueId } from "./ids.js";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { CAPABLE_MODEL, effortFor } from "./models.js";
import { MODEL_REFUSED } from "./messages.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import {
  type BlockFingerprint,
  datedArticleFingerprint,
  fallbackHeadTitle,
  type MetaFingerprintDated,
} from "./source-hash.js";
import { findQuote } from "./quote-match.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import { parseJsonFrom, readJsonOrNull, stripFence } from "./parse-json.js";
import { articleWithIds } from "./article-prompt.js";
import { articleWordCounts, isBodyEvidence } from "./block-policy.js";
import { loadEnvLocal } from "./env.js";
import {
  countOrderConflicts,
  orderEvents,
  readWhen,
  type TimelineModality,
  type When,
  type WhenDirection,
  type WhenRefusal,
} from "./timeline-time.js";
import type { Block, BlockId, Meta, Tree } from "./types.js";
import { stageCli } from "./cli-ledger.js";

/**
 * Bumped whenever the prompt changes in a way that changes what an *event* is.
 *
 * Exported so tests assert against the current value rather than pinning a
 * literal — a fixture that hardcodes the version tests the fixture.
 */
export const PROMPT_VERSION = "timeline/1";

/**
 * The most events one call may carry into the artefact.
 *
 * Forty rather than `ideas`' ten, and the number was **set twice**: the spike's
 * two runs produced 25 and 23 events, so this was 30 — and the first real run
 * of this file returned 31 and had one silently thrown away. A cap the good run
 * trips is a cap that deletes real events, which is exactly what it did.
 *
 * It is a guard against a model that has started listing sentences, not a
 * target, so it sits well clear of the densest article we have: 4,000 words
 * that narrate three months three times over. If a piece ever genuinely wants
 * forty-one rows, the thing to look at is the labels.
 */
export const MAX_EVENTS = 40;

/** The most occurrences one event may carry. As `ideas`, for the same reason. */
export const MAX_OCCURRENCES = 6;

const MODALITIES: ReadonlySet<string> = new Set<TimelineModality>([
  "happened",
  "predicted",
  "hypothetical",
]);

/** An event id. A string like any other id here; named so the panel can say so. */
export type TimelineEventId = string;

/** Where in the article this event is mentioned. The same shape `ideas` uses. */
export interface TimelineOccurrence {
  blockId: BlockId;
  /**
   * **The article's own characters** — the block sliced at the offsets
   * `findQuote` located, not the model's copy of them. See
   * `validateOccurrences`; the panel shows this as what the article says.
   */
  quote: string;
  /**
   * A disambiguator between repeats, never the anchor: the client re-finds the
   * words itself in the *rendered* text, which is a different offset space from
   * `block.text`. src/web/annotate.ts § the header.
   */
  start: number;
}

/**
 * **Which of the four things happened to this event's date**, as one field the
 * panel can switch on.
 *
 * A union rather than `when: When | null` plus two flags, because the four cases
 * draw four different rows and three of the combinations those flags allow do
 * not exist: a parsed date with no `When`, a rejection carrying a date, a
 * words-shown row with no words. `AGENTS.md` § Writing code — let the types
 * carry it rather than a comment.
 *
 * | kind | the row draws |
 * |---|---|
 * | `dated` | the date and its marks |
 * | `words` | **the article's own words**, in the date column |
 * | `untimed` | nothing — the row is placed by `order` alone |
 * | `rejected` | **⊘**, and "the piece dates this and we could not read it" |
 *
 * The middle two are the pair most easily collapsed and must not be: a piece
 * that said "another month later" has dated the event as far as it ever will,
 * and drawing a blank there loses the only thing it told us. The last is the
 * one the review caught — demoting it to an ordinary blank makes "fails
 * visibly" true only inside a counter.
 */
export type Dating =
  /** The parser read a date out of the article's own characters. */
  | { kind: "dated"; when: When }
  /**
   * The article's temporal words, which carry no date we can read out of them —
   * "another month later", "within a few hours". Located in the quoted passage
   * and **sliced out of the block**, so these are the article's characters.
   */
  | { kind: "words"; phrase: string }
  /** The article puts no time on this at all. A correct answer, and a common one. */
  | { kind: "untimed" }
  /**
   * The piece dates this and we could not read the date.
   *
   * `reason` is carried rather than dropped because the panel has something
   * different to say for each, and one of them is the majority case on this
   * shelf: `noYearFrame` means the article stated a day and a month and we had
   * no publication date to take the year from, which is true of every article
   * ingested before 2026-08-31. "We don't know which year" and "that date is
   * not in the passage you quoted" are not the same sentence.
   *
   * `phrase` is the article's words where we could locate them, and explicitly
   * `null` where we could not — a required nullable rather than an optional,
   * so a caller cannot forget the case exists.
   */
  | {
      kind: "rejected";
      reason: Exclude<WhenRefusal, "noDateInPhrase">;
      phrase: string | null;
    };

/**
 * The date, for the callers that only want that.
 *
 * Tolerates an event with no `dating` at all, which is not paranoia: the one
 * caller that reads events this code did not write is `idsByEvidence`, and it
 * reads the artefact **on disk** — written by whatever version of this file was
 * current when the article was last run. A shape change is a reason to mint
 * fresh ids, never a reason for the stage to throw.
 */
export function whenOf(event: Pick<TimelineEvent, "dating">): When | null {
  return event.dating?.kind === "dated" ? event.dating.when : null;
}

export interface TimelineEvent {
  id: TimelineEventId;
  /** A handle, not a retelling. Under about ten words. */
  label: string;
  /** What the article said about when, and what we could make of it. */
  dating: Dating;
  /**
   * The model's reading of where this sits in the sequence, and **the sort
   * key** — Greg's call, 2026-08-31: the dates do not move anything. An event
   * known only to be "by 4 July" may have happened on the 1st, and sorting it
   * to the 4th would assert otherwise.
   *
   * `null` when the model did not number the event. Nullable rather than `NaN`
   * because `JSON.stringify` writes `NaN` as `null` regardless, so a field
   * typed `number` would have described the artefact wrongly the moment it was
   * read back — and `orderKey` sorts either of them last within the partition.
   */
  order: number | null;
  modality: TimelineModality;
  occurrences: TimelineOccurrence[];
}

export interface Timeline {
  version: string;
  generator: string;
  slug: string;
  /** Blocks, tree **and the publication date** — see `inputFingerprint`. */
  sourceHash: string;
  /** In the order they are to be shown. Never re-sorted after this. */
  events: TimelineEvent[];
  /**
   * Pairs where the article's own dates prove an order and the model put them
   * the other way round. Changes nothing on screen; it is the only signal we
   * get that the model has misread the chronology. See `countOrderConflicts`.
   */
  orderConflicts: number;
  generatedAt: string;
  elapsedMs: number;
}

/**
 * What this artefact was written from: **the blocks, the tree and the dated
 * metadata** — `datedArticleFingerprint` in src/source-hash.ts.
 *
 * The one stage that does not use `articleFingerprint` or
 * `articleWithIdsFingerprint`, and the plan originally said it should. It was
 * wrong: neither of those carries `publishedAt`, and the publication date is
 * the reference frame for nineteen of the twenty-four temporal expressions on
 * the test article. A publisher re-dating a post changes almost every row here
 * and not one word anywhere else, which is exactly why the date is in the hash
 * of the stage that names it **and no other** — widening the shared
 * `MetaFingerprint` would mark five paid artefacts stale over bytes no model
 * ever saw. src/source-hash.ts § `MetaFingerprintDated`.
 */
export function inputFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintDated | null,
): string {
  return datedArticleFingerprint(blocks, tree, meta);
}

/** Does this artefact still describe the article, tree and publication date on disk? */
export function isStale(
  timeline: Timeline,
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintDated | null,
): boolean {
  return timeline.sourceHash !== inputFingerprint(blocks, tree, meta);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** One event as the model returns it, before any of it has been believed. */
interface RawEvent {
  label?: unknown;
  order?: unknown;
  modality?: unknown;
  phrase?: unknown;
  occurrences?: unknown;
}

interface RawOccurrence {
  blockId?: unknown;
  quote?: unknown;
}

/**
 * What was thrown away, and why. **Every one of these is invisible from
 * outside** — a dropped event looks exactly like a happening the model chose
 * not to name — which is the whole reason they are counted and logged.
 *
 * Counts only. Never the quote, never the phrase, never the label, never the
 * raw parse error: a step that throws is logged by src/jobs.ts with
 * `errorFields`, and an error is a value that travels.
 */
export interface Dropped {
  /** A `blockId` that is not in blocks.json. The model invented it. */
  unknownIds: number;
  /** A `quote` that `findQuote` could not locate in the block the model named. */
  unquoted: number;
  /** Occurrences past `MAX_OCCURRENCES` on one event. */
  truncated: number;
  /** Events past `MAX_EVENTS`, discarded whole. */
  overCap: number;
  /** Events with no label, or an unusable modality. Dropped. */
  malformed: number;
  /**
   * Events whose **label** states a date the cited passage does not carry.
   * Dropped, because a label is prose the panel prints beside a date column and
   * a date smuggled into it is indistinguishable from one the article gave.
   *
   * The prompt bans this and a ban relocates a register rather than deleting
   * one — docs/project/glossary.md — so it is also checked, with the same
   * parser that reads `when`. See `labelStatesAnUncitedDate`.
   */
  datedLabel: number;
  /** Events that lost **every** occurrence and were therefore dropped whole. */
  unanchored: number;
  /**
   * Events whose `order` was missing or not a number. **Not dropped** — the row
   * keeps its content and sorts last within its partition, which is what
   * `orderKey` in src/timeline-time.ts was written to do. Counted because a
   * model that has stopped numbering its events has stopped doing the one
   * judgement this stage's sort depends on, and silence there would look
   * exactly like a well-ordered run.
   */
  unordered: number;
  /**
   * The phrase carried date-shaped words we could not read: over the cap, or
   * several dates that are not a range. **The ⊘ row.**
   */
  unparseablePhrase: number;
  /**
   * The phrase named a date the quoted passage does not carry. **The ⊘ row**,
   * and the one that means the model went looking outside its own evidence.
   */
  phraseNotInOccurrence: number;
  /**
   * The phrase carries no date at all — "another month later", "within a few
   * hours". **Not a failure**, and not a ⊘: the article did not date the event,
   * so the row shows the article's words and draws no marks. Counted because
   * the number is interesting, not because it is bad.
   */
  noDateInPhrase: number;
  /**
   * A year-less date and no publication date to take the year from. **The ⊘
   * row**, and on any article ingested before 2026-08-31 it will be almost
   * every row, because `publishedAt` arrives only by re-extraction.
   */
  noYearFrame: number;
  /**
   * Temporal words we could not find in the quoted passage, so they are not
   * shown. The event survives with its order and its occurrences; only the
   * words are withheld, because a phrase we cannot locate is the model's
   * writing rather than the article's.
   */
  phraseNotFound: number;
  /**
   * Events sharing an `order` with another event. **Not a drop, and not
   * necessarily wrong** — two things can happen at once. It is here because the
   * failure it detects has no other tell: a model that gives every event
   * `order: 1` has stopped doing the one judgement the sort depends on, and the
   * panel would then quietly show the order the events arrived in.
   * `countOrderConflicts` cannot see it, because ties prove nothing.
   */
  duplicateOrders: number;
  /**
   * Pairs where the dates prove an order and the model's `order` says the
   * opposite — `countOrderConflicts`. Not a drop at all; it lives here because
   * this is the object the counts are reported from.
   */
  orderConflicts: number;
}

export function emptyDropped(): Dropped {
  return {
    unknownIds: 0,
    unquoted: 0,
    truncated: 0,
    overCap: 0,
    malformed: 0,
    datedLabel: 0,
    unanchored: 0,
    unordered: 0,
    unparseablePhrase: 0,
    phraseNotInOccurrence: 0,
    noDateInPhrase: 0,
    noYearFrame: 0,
    phraseNotFound: 0,
    duplicateOrders: 0,
    orderConflicts: 0,
  };
}

/** An occurrence that survived validation, with the span the parser needs. */
interface PlacedOccurrence extends TimelineOccurrence {
  /** Where the quote sits in `block.text`. Not written to the artefact. */
  end: number;
  /** The block's own text, so the parser can read the date out of it. */
  text: string;
}

/**
 * Believe an occurrence only if the article backs it up — **the id must exist,
 * and the words must be there.** The same discipline as `validateOccurrences`
 * in src/ideas.ts and `validateHits` in src/search.ts.
 *
 * One deliberate difference: `"spaced"` rather than the default forgiving
 * match. src/quote-match.ts § `passes` says why — the forgiving pass deletes
 * whitespace entirely and so accepts a word the model split in two, and here a
 * located quote is being read as a claim that the model **copied** the article
 * rather than as a best effort at drawing a mark. The quote is also what the
 * date has to sit inside, so a sloppy match would widen the window a date may
 * be read from. `ideas` and `search` still pass the default; that is a known
 * gap with artefacts to think about, and this stage has none yet.
 */
export function validateOccurrences(
  raw: unknown,
  blocks: readonly Block[],
  dropped: Dropped,
): PlacedOccurrence[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const out: PlacedOccurrence[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    /* Per element, before any field is read: a `null` or a bare string in the
       array throws on the first property access and would take the whole event
       with it. src/glossary.ts § `toEntries` had exactly this bug. */
    if (!item || typeof item !== "object") {
      dropped.malformed++;
      continue;
    }
    const o = item as RawOccurrence;
    const blockId = text(o.blockId) as BlockId;
    const block = byId.get(blockId);
    if (!block) {
      dropped.unknownIds++;
      continue;
    }
    const typed = text(o.quote);
    const span = typed ? findQuote(block.text, typed, undefined, "spaced") : null;
    if (!span) {
      dropped.unquoted++;
      continue;
    }
    /* **The block's characters, not the model's typing.** The panel puts this
       under "the article says", so it has to be what the article says — and
       `findQuote` is deliberately forgiving about case and whitespace, which
       means a match is not a promise that the two strings are equal. GPT Sol,
       2026-08-31, who also demonstrated that `"spaced"` still finds `"July 1"`
       inside `"July 11"`: with the slice stored, a mislocated quote at least
       shows the reader what was actually matched rather than what was typed.
       `ideas` and `search` still store the model's string; converging them is a
       separate landing with artefacts to migrate, and this stage has none. */
    const quote = block.text.slice(span.start, span.end);
    out.push({ blockId, quote, start: span.start, end: span.end, text: block.text });
  }
  if (out.length > MAX_OCCURRENCES) {
    dropped.truncated += out.length - MAX_OCCURRENCES;
    return out.slice(0, MAX_OCCURRENCES);
  }
  return out;
}

/**
 * Which side of the publication date a year-less expression resolves to.
 *
 * Only a prediction reads forwards, and that is the one case where the default
 * is backwards: a January piece saying "in December we expect…" means the
 * coming December.
 *
 * **A hypothetical stays `"past"`, and that is measured rather than reasoned.**
 * `predicted` and `hypothetical` share a sort partition — the panel draws one
 * divider between history and what the piece expects — and it is tempting to
 * give them one tense as well. On the test article that is wrong by a year:
 * its single hypothetical row is *"at some point after July 12"*, a
 * counterfactual about something that nearly happened **in the past**, and
 * resolving it forwards dates it 2027-07-13. Its single prediction, meanwhile,
 * says *"over the next six months"* — a relative phrase carrying no date at
 * all, so the direction never reaches it. Every other row on that article is
 * `happened`, and all sixteen dated ones move by a year if the direction flips.
 *
 * So the two modalities differ in tense and the partition does not care.
 */
function directionFor(modality: TimelineModality): WhenDirection {
  return modality === "predicted" ? "future" : "past";
}

/**
 * How informative a refusal is. When several occurrences refuse for different
 * reasons, the most informative one is the truth about the event: `noYearFrame`
 * means the date was **found and read** and only the year was missing, which is
 * a completely different fact from "that date is not in this passage".
 */
const REFUSAL_RANK: Record<WhenRefusal, number> = {
  noYearFrame: 0,
  unparseablePhrase: 1,
  phraseNotInOccurrence: 2,
  noDateInPhrase: 3,
};

/**
 * The article's own characters for a phrase the parser could not date.
 *
 * `findQuote`, then a **slice of the block** — never the model's string. The
 * phrase reaches the reader in the date column, so it is held to the same rule
 * as everything else on the row: it has to be in the article. See
 * `TimelineEvent.phrase` for the demonstration that made this necessary.
 *
 * The located words must sit inside the occurrence's own quote, which is the
 * same window the date is read from. `near` biases the search to that quote, so
 * a phrase the article repeats is found at the occurrence rather than at the
 * first repeat in the block.
 */
function locatePhrase(phrase: string, occurrences: readonly PlacedOccurrence[]): string | null {
  for (const o of occurrences) {
    const span = findQuote(o.text, phrase, o.start, "spaced");
    if (span && span.start >= o.start && span.end <= o.end) {
      return o.text.slice(span.start, span.end);
    }
  }
  return null;
}

/**
 * Does the **label** state a date the cited passage does not carry?
 *
 * The third route a fabricated date had into the artefact, and the one that
 * would have looked most like the article's own words: `label` is prose, the
 * panel prints it beside the date column, and nothing read it. A model that
 * writes `"4 July: the package manager crashes"` puts a date in front of the
 * reader whatever the parser does with `phrase`.
 *
 * It is checked with `readWhen` rather than with a second date scanner, so the
 * label is held to exactly the rule the date column is held to and there is one
 * definition of "is this date in this passage" rather than two.
 *
 * Three of the four refusals are innocent and only one is an offence:
 *
 * | refusal | what it means for a label | verdict |
 * |---|---|---|
 * | `noDateInPhrase` | no date in the label at all — the ordinary case | fine |
 * | `noYearFrame` | the date IS in the passage; only the year was missing | fine |
 * | `phraseNotInOccurrence` | the label names a date the passage does not carry | **offence** |
 * | `unparseablePhrase` | over the phrase cap, or several dates that are not a range | **offence** |
 *
 * `unparseablePhrase` counts as an offence partly because a label long enough
 * to pass `MAX_PHRASE_CHARS` is not a handle in the first place.
 */
export function labelStatesAnUncitedDate(
  label: string,
  occurrences: readonly PlacedOccurrence[],
  frame: string | null,
): boolean {
  let offence = false;
  for (const o of occurrences) {
    const result = readWhen({
      text: o.text,
      phrase: label,
      blockId: o.blockId,
      frame,
      within: { start: o.start, end: o.end },
    });
    /* Any occurrence that vindicates the label settles it. `noDateInPhrase` is
       decided from the label alone, before the block is looked at, so the first
       occurrence answers for all of them. */
    if (result.ok) return false;
    if (result.reason === "noDateInPhrase" || result.reason === "noYearFrame") return false;
    offence = true;
  }
  return offence;
}

/**
 * Read the date out of the article, or say why not.
 *
 * **The phrase must sit inside one of the event's own quotes**, which is why
 * `within` is passed. That is a stricter rule than "somewhere in the block":
 * four of the test article's blocks hold two distinct dates each, and a
 * block-wide window would let an event borrow its neighbour's date whenever the
 * two differ by a component the phrase does not state.
 *
 * It is strictness about **which date is selected**, and not, despite how it
 * reads, a rule that the whole phrase is inside the quote — the words that
 * govern the date are looked for in the block, so a quote holding `"July 12,
 * agents acted"` can still be dated `"By July 12"` if the block says "By".
 * That is correct: the cue genuinely governs that date in the article. GPT Sol,
 * 2026-08-31, who found the comment claiming more than the code did.
 *
 * Every occurrence is tried, because a multi-occurrence event is dated by one
 * of its passages and mentioned again in the others.
 */
export function dateEvent(
  phrase: string,
  occurrences: readonly PlacedOccurrence[],
  frame: string | null,
  modality: TimelineModality,
  dropped: Dropped,
): Dating {
  /* No phrase is not a refusal. The article gives this event no time at all,
     which the prompt calls a correct answer and often the right one. */
  if (!phrase) return { kind: "untimed" };

  const direction = directionFor(modality);
  let worst: WhenRefusal = "noDateInPhrase";
  for (const o of occurrences) {
    const result = readWhen({
      text: o.text,
      phrase,
      blockId: o.blockId,
      frame,
      within: { start: o.start, end: o.end },
      direction,
    });
    if (result.ok) return { kind: "dated", when: result.when };
    if (REFUSAL_RANK[result.reason] < REFUSAL_RANK[worst]) worst = result.reason;
  }

  dropped[worst]++;
  /* The article's words go in the row either way, because on an article with no
     publication date EVERY dated event lands here — the field arrives only by
     re-extraction, so that is the common path on this shelf — and a row reading
     "we could not read the date" with no words beside it tells the reader
     nothing they can check. */
  const located = locatePhrase(phrase, occurrences);
  if (located === null) dropped.phraseNotFound++;
  /* `noDateInPhrase` is the relative case and is not a rejection: "another
     month later" is the article declining to date something, and a row drawn
     with the ⊘ glyph here would be accusing the piece of something it never
     did. Every other refusal IS a rejection — the piece dates this and we could
     not read it — and the panel has to say so. */
  if (worst === "noDateInPhrase") {
    /* Words we could not find in the passage are not the article's, so there is
       nothing honest to show and the row falls back to its order. */
    return located === null ? { kind: "untimed" } : { kind: "words", phrase: located };
  }
  return { kind: "rejected", reason: worst, phrase: located };
}

/**
 * Turn what the model said into events, believing as little of it as possible.
 *
 * The drop rule is **a label, a usable modality, and at least one surviving
 * occurrence**. Everything else degrades rather than failing the batch: a bad
 * `order` sorts last, an unreadable date becomes a visible rejection, and
 * twenty good events are not lost because one came back with
 * `modality: "maybe"`.
 */
export function toEvents(
  raw: unknown,
  blocks: readonly Block[],
  frame: string | null,
  taken: Set<string>,
  dropped: Dropped,
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const raws = Array.isArray(raw) ? raw : [];
  for (const [i, item] of raws.entries()) {
    if (!item || typeof item !== "object") {
      dropped.malformed++;
      continue;
    }
    const r = item as RawEvent;
    const label = text(r.label);
    const modalityText = text(r.modality).toLowerCase();
    if (!label || !MODALITIES.has(modalityText)) {
      dropped.malformed++;
      continue;
    }
    const modality = modalityText as TimelineModality;
    const occurrences = validateOccurrences(r.occurrences, blocks, dropped);
    if (occurrences.length === 0) {
      dropped.unanchored++;
      continue;
    }
    /* After the occurrences, because the check reads the passages the event
       cites — a label naming a date is only an offence against the passage it
       claims to be about. */
    if (labelStatesAnUncitedDate(label, occurrences, frame)) {
      dropped.datedLabel++;
      continue;
    }
    /* A number or `null` — never a coerced 0. `Number("")` is 0 and a missing
       order is not "first"; `orderKey` in src/timeline-time.ts sorts a null
       order last within its partition, deliberately, because a row the model
       could not place has no claim on the top of the list. */
    const order = typeof r.order === "number" && Number.isFinite(r.order) ? r.order : null;
    if (order === null) dropped.unordered++;

    out.push({
      id: mintUniqueId(taken),
      label,
      dating: dateEvent(text(r.phrase), occurrences, frame, modality, dropped),
      order,
      modality,
      /* The parser's working — `text` and `end` — stays out of the artefact.
         `text` is a copy of the block, and an artefact that carried one would
         be a second copy of the article nothing keeps in step. */
      occurrences: occurrences.map(({ blockId, quote, start }) => ({ blockId, quote, start })),
    });
    /* **The cap is enforced here, not merely requested in the prompt.** Nothing
       makes the model obey a number, and everything else in this file believes
       as little as possible of what came back. */
    if (out.length === MAX_EVENTS) {
      dropped.overCap += Math.max(0, raws.length - i - 1);
      break;
    }
  }
  return out;
}

/**
 * The key an id is inherited on: **the cited block set plus the date**.
 *
 * Not the label, and that is the finding rather than a preference. The spike
 * reran the same prompt on the same article and the labels paraphrased every
 * time — *"Message volume crashes package manager"* → *"Agents crash the
 * package manager"* — so `idsByName`'s trick from src/ideas.ts would mint a
 * fresh id for almost every event on every regeneration and quietly orphan
 * every `?event=` link a reader holds.
 *
 * The block set and the date are the two things that were actually **validated**
 * — the ids exist, the quotes were located, the date was read out of the
 * article's own characters — so they are the two things a re-run can be
 * expected to reproduce. Of 21 events matched across the spike's two runs,
 * block ids moved 0 times and bounds moved once.
 *
 * `earliest`/`latest` rather than the whole `When`: `phrase` and `at` are
 * offsets into a block, and a block whose text shifted by one character would
 * break every id on the page for no reason a reader could see.
 */
export function evidenceKey(event: Pick<TimelineEvent, "dating" | "occurrences">): string {
  const blocks = [...new Set(event.occurrences.map((o) => o.blockId))].sort().join(",");
  const when = whenOf(event);
  return `${blocks}|${when ? `${when.earliest ?? ""}..${when.latest ?? ""}` : ""}`;
}

/**
 * Ids from the list this run is replacing, keyed by `evidenceKey`.
 *
 * **A key two events share is dropped rather than given to the first of them.**
 * Inheriting an id wrongly is worse than minting a new one: a stale link that
 * lands on nothing is a dead end the reader can see, and one that lands on a
 * *different* event is a dead end that looks like it worked. The test article
 * has several blocks holding two events, so this is the ordinary case and not
 * a corner.
 */
export function idsByEvidence(onDisk: Timeline | null): Map<string, TimelineEventId> {
  const seen = new Map<string, TimelineEventId>();
  const ambiguous = new Set<string>();
  for (const event of onDisk?.events ?? []) {
    /* **The previous artefact is untrusted input, not a value of this type.**
       It was written by whichever version of this file was current when the
       article last ran, and the shape has already changed once — `when` +
       `dateRejected` + `phrase` became `dating` on 2026-08-31. An event this
       version cannot key is one whose id cannot be carried, which costs a
       reader's `?event=` link and is the correct outcome; throwing here would
       fail the whole stage on an artefact it is about to replace. */
    if (!event || typeof event.id !== "string" || !Array.isArray(event.occurrences)) continue;
    const key = evidenceKey(event);
    if (seen.has(key)) {
      ambiguous.add(key);
      continue;
    }
    seen.set(key, event.id);
  }
  for (const key of ambiguous) seen.delete(key);
  return seen;
}

/** Carry the old ids onto the events that carry the same evidence. */
export function inheritIds(
  fresh: TimelineEvent[],
  inherit: Map<string, TimelineEventId> | null,
): TimelineEvent[] {
  if (!inherit || inherit.size === 0) return fresh;
  /* Ambiguity on *this* side too. Two fresh events with the same evidence would
     both claim the one old id, and an id handed out twice addresses whichever
     the panel happened to find first. */
  const counts = new Map<string, number>();
  for (const event of fresh) {
    const key = evidenceKey(event);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return fresh.map((event) => {
    const key = evidenceKey(event);
    const old = inherit.get(key);
    if (!old || counts.get(key) !== 1) return event;
    return { ...event, id: old };
  });
}

/** The artefact, from what the model said plus what we could verify of it. */
export function buildTimeline(
  parsed: { events?: unknown },
  opts: {
    slug: string;
    blocks: readonly Block[];
    sourceHash: string;
    /** The publication day, or null — and null is the common case on this shelf. */
    frame: string | null;
    elapsedMs: number;
    inherit?: Map<string, TimelineEventId> | null;
    dropped: Dropped;
  },
): Timeline {
  /* **The shape of the answer, before the shape of anything in it.** `events`
     absent, `null`, or an object rather than an array all used to reach
     `toEvents`, come back as `[]`, and be written as a perfectly ordinary
     empty timeline with every counter at zero — a model that answered `{}`
     reported as an article with no chronology. That is the exact failure
     docs/reusable/silent-success.md is about, and the empty case being
     legitimate here is what hid it. GPT Sol, 2026-08-31. */
  if (!Array.isArray(parsed.events)) {
    throw new Error(
      "The model's answer has no `events` array in it, so there is nothing to read. " +
        "An article with no chronology comes back as `{\"events\": []}`; this came back " +
        "as something else, which is a failed answer rather than an empty one.",
    );
  }
  const taken = new Set<string>(opts.inherit?.values() ?? []);
  const fresh = inheritIds(
    toEvents(parsed.events, opts.blocks, opts.frame, taken, opts.dropped),
    opts.inherit ?? null,
  );
  const raws = parsed.events.length;

  /* **Zero events is a legitimate artefact here, and it is the only stage where
     that is true.** `buildIdeas` throws on an empty list because an article
     always has ideas; most articles are not chronological, and a panel that
     says "this piece tells no story in time" is a real answer to a real
     question (plan § Most articles are not chronological).

     What is NOT legitimate is the model naming events and every one of them
     being thrown away. That is a failure wearing the empty case's clothes, and
     writing it would make the step report done for ever after. */
  if (fresh.length === 0 && raws > 0) {
    const d = opts.dropped;
    throw new Error(
      `The model named ${raws} events and none of them could be anchored to the article, ` +
        "so there is nothing to write. " +
        `Dropped: ${d.unanchored} with no usable passage, ${d.unknownIds} passages naming a ` +
        `block id that is not in this article, ${d.unquoted} whose quote could not be found ` +
        `in the block it named, ${d.malformed} malformed.`,
    );
  }

  const events = orderEvents(fresh);
  /* Projected rather than passed whole: `countOrderConflicts` compares dates,
     and the union is where a date now lives. */
  opts.dropped.orderConflicts = countOrderConflicts(
    events.map((e) => ({ order: e.order, modality: e.modality, when: whenOf(e) })),
  );
  /* Nulls do not count as a repeat: `unordered` already has them, and two
     events the model failed to number are not two events it placed together. */
  const numbered = events.map((e) => e.order).filter((o): o is number => o !== null);
  opts.dropped.duplicateOrders = numbered.length - new Set(numbered).size;

  return {
    version: PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    slug: opts.slug,
    sourceHash: opts.sourceHash,
    /* **Fixed at write time and never re-derived.** The panel colours and
       numbers rows by walking this list, so a list that re-sorted itself
       between reads would move every row on the page. src/ideas.ts
       § `inReadingOrder` learned this one first. */
    events,
    orderConflicts: opts.dropped.orderConflicts,
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
  };
}

/**
 * The timeline on disk, or null — for this file's own CLI and, later, the API.
 *
 * Every road to `null` is the same road: no file, a truncated one, a document
 * of the wrong shape. That is right for the panel, which has one thing to say
 * either way, and wrong for the pipeline, which loses every `?event=` link on
 * one of them — Stage 4 wants a `previousTimelineFrom` reading the store's
 * baseline, the shape `previousIdeasFrom` has in src/ideas.ts.
 */
export async function readTimeline(dir: string): Promise<Timeline | null> {
  const found = await readJsonOrNull<Timeline>(path.join(dir, "timeline.json"));
  /* A truncated write parses as `null`, and `null` is a perfectly good JSON
     document — without this the panel would report "nobody has built the
     timeline for this one yet", the artefact gone and nothing saying so. */
  if (!found || typeof found !== "object" || !Array.isArray(found.events)) return null;
  return found;
}

export interface TimelineRun {
  timeline: Timeline;
  blocks: number;
  words: number;
  /** The publication day the dates were read against, or null. */
  frame: string | null;
  dropped: Dropped;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  elapsedMs: number;
}

const SYSTEM = `You are building a TIMELINE of the events an article narrates: what happened,
in what order, and what the piece itself says about when.

NEVER A DATE OF YOUR OWN

This is the rule everything else here serves. Copy; do not compute, and do not
remember.

Every temporal word in your answer must be COPIED from the paragraph you are
citing. If the article writes "By the next morning, July 11", that whole string
goes in "phrase" — the date in it is the article's and it belongs there. What
must never appear is a date you worked out or already knew: not in "phrase",
not in "label", not anywhere.

You do not need to resolve anything. We read the date out of the article's own
characters ourselves, so a date that is not in the paragraph is of no use to us
and will be thrown away — and an event whose LABEL states a date the paragraph
does not carry is thrown away whole.

So there is nothing to be gained by working one out, and nothing lost by
leaving an event undated. An undated event is a CORRECT answer and is often the
right one.

WHAT "phrase" IS

The temporal expression itself, copied from the paragraph, INCLUDING the word
that governs it.

  GOOD  "by July 4"          BAD  "July 4"
  GOOD  "During May"         BAD  "May"
  GOOD  "on May 26"          BAD  "2026-05-26"
  GOOD  "from July 13 through July 19"
  GOOD  "At some point on July 12"
  GOOD  "By the next morning, July 11"

The governing word carries the meaning. "by July 4" does not mean July 4 — it
means at or before July 4, which is a different claim, and the reader is shown
your words. Copy them; do not tidy them.

RELATIVE EXPRESSIONS ARE PHRASES TOO

"Another month later", "within a few hours", "over the course of the next day".
Put them in "phrase" exactly as the article writes them. Do NOT do the
arithmetic, do not name the event they are relative to, do not convert them to
anything. The reader is shown the article's words in place of a date, which is
honest: we know where this sits in the sequence and nothing more.

If the article puts BOTH a relative expression and a date on one event — "Two
weeks later, on May 26" — copy the whole thing, both halves.

WHEN THERE IS NO TIME AT ALL

"phrase": null. The event still belongs on the timeline: it has an order, and
the piece narrates it. Do not reach for the nearest date in the paragraph to
fill the field. A field invites filling, and this is the one field where filling
it wrongly puts a false date in front of a reader.

WHERE THE PHRASE HAS TO BE

Inside one of this event's own quotes. We look for it there and nowhere else.

So when an event has a time, choose a quote that contains the time. If the
article says "By May 12, some agents had figured out how to talk to each other",
the quote is that sentence, not the clause after the comma. When we cannot find
the phrase in any of the event's quotes, the row says out loud that the piece
dated this and we could not read the date — which is worse for the reader than
an honest "phrase": null.

WHAT IS AN EVENT

Something that HAPPENS in the story the piece tells. Include undated steps that
are still ordered — "order" is required on every event whether or not it has a
time.

EXCLUDE the piece's own dates: when it was published, when the author
interviewed somebody, how long the author spent reading the reports. Those are
about the article, not about the story it tells.

The same happening mentioned in two places is ONE event with two occurrences,
not two events.

ORDER

"order" is your reading of the sequence: 1, 2, 3… in the order the things
actually happened, which is NOT necessarily the order the article tells them
in. A piece that recounts the same months twice, once per participant, still
has one sequence underneath. This is the only ordering there is — we do not
sort by date — so it is worth getting right.

MODALITY

  "happened"     — the piece narrates it as having occurred.
  "predicted"    — the piece expects it: "I continue to expect...".
  "hypothetical" — a possibility, a counterfactual, a scenario.

A prediction is not an uncertain date. A confident forecast about next year is
"predicted", not "happened".

LABEL

"label" is a handle, not a retelling — under about ten words, enough to
recognise an event you have already read about. Never write a label a reader
could substitute for the paragraph. If somebody could follow the whole story
from your labels alone, they are too long.

OCCURRENCES

  "blockId" — MUST be one of the ids listed in the article below. Never invent
              one, never guess at one you half-remember. A wrong id points the
              reader at the wrong paragraph, which is worse than nothing.
  "quote"   — copied VERBATIM from that block, character for character. Not a
              paraphrase, not tidied up. If you cannot copy it exactly, leave
              the occurrence out.

One to three occurrences per event. An event you cannot anchor at all will be
thrown away, so do not offer it.

FIVE WAYS TO GET THIS WRONG

1. THE DATE YOU WROTE DOWN
   BAD:  "phrase": "2026-07-04", or a label reading "4 July: the package
         manager crashes".
   GOOD: "phrase": "by July 4". The article's words. We do the rest.

2. THE CONFIDENT GUESS
   BAD:  "phrase": "the early days of the project" on an event you believe
         happened in March — words that gesture at the paragraph instead of
         being the paragraph's own time.
   GOOD: "phrase": null. The event keeps its order and loses a time it never
         had.

3. THE RETELLING LABEL
   BAD:  "OpenAI's agents discovered they could talk to each other through the
          shared filesystem and began coordinating"
   GOOD: "Agents work out how to talk"

4. THE TOPIC ON A LINE
   BAD:  label "The rise of the agent civilizations", with a time stapled on.
         A theme is not an event. It cannot have happened at a time.
   GOOD: leave it out.

5. THE PREDICTION FILED AS HISTORY
   BAD:  "Rapid advances continue", modality "happened"
   GOOD: modality "predicted"

OUTPUT

JSON only, no prose, no code fence:

{"events": [
  {
    "label": "...",
    "order": 1,
    "modality": "happened|predicted|hypothetical",
    "phrase": "..." or null,
    "occurrences": [{"blockId": "spya-k3m9qt", "quote": "..."}]
  }
]}

Every field is required on every event. "phrase" may be null; nothing else may.

Fewer, better events beat a list padded to a number. An article that tells no
story in time should come back with an empty list, and that is a real answer.`;

/**
 * What the model is shown: the skeleton, then the reference frame.
 *
 * The skeleton before the full text, in the order `arc`, `glossary` and `ideas`
 * already use — it is what lets the model judge the sequence against the shape
 * of the argument rather than against the order of the paragraphs, which is the
 * thing it is being asked to see past.
 *
 * **The publication date goes here, in the user prompt, and not in the article
 * block.** `articleWithIds` writes TITLE / BY / PUBLISHED IN / URL and no date,
 * which is what keeps this stage's article bytes identical to `ideas`' and
 * `sketch`'s so the three can share one cached prefix
 * (`ARTICLE_RENDERER` in src/models.ts). A date in the head would break that
 * for every article, to save nothing.
 */
export function renderPrompt(opts: { tree: Tree; frame: string | null }): string {
  const skeleton = partsOf(opts.tree)
    .map((p, i) => `PART ${i + 1}: ${p.title}\n  ${p.gist ?? "(no gist)"}`)
    .join("\n\n");

  /* Said either way, and said plainly. On most of this shelf there is no
     publication date — the field arrives only by re-extraction — and a prompt
     that simply omitted the frame would leave the model to work out for itself
     whether a year-less date was safe to hand back. It is: the parser refuses
     to guess a year, so those rows stay undated, and that is the correct
     answer rather than a degraded one. */
  const frame = opts.frame
    ? `This article was published on ${opts.frame}. Almost every date in a piece like this is\n` +
      "written without a year, and we fill the year in from that date ourselves. You do not\n" +
      "need to think about years at all — copy the words as the article writes them."
    : "We do not know when this article was published. A date written without a year cannot\n" +
      "be resolved, so those rows will show the article's words and no date. Nothing changes\n" +
      "for you: copy the words as the article writes them and let us worry about it. Do NOT\n" +
      "supply the year yourself — a year you are confident about is exactly the thing this\n" +
      "asks you not to write.";

  return `Build the timeline of this article.

=== THE REFERENCE FRAME ===

${frame}

=== ITS SHAPE ===

${skeleton}`;
}

/**
 * Read the model's answer, fence and all.
 *
 * `stripFence` then `parseJsonFrom`, never a bare `JSON.parse` —
 * src/parse-json.ts § `stripFence` has the reasoning.
 */
function parseJson(raw: string): { events?: unknown } {
  return parseJsonFrom<{ events?: unknown }>(stripFence(raw), "the model's answer");
}

/**
 * The answer budget, in tokens. **Measured, not guessed**: the spike's two runs
 * on the test article produced 12,000 and 19,600 output tokens, and that
 * article is at the dense end of what this mode will see. Undersizing does not
 * degrade — it throws `truncationFailure` and loses the whole pass — so the
 * budget sits above the larger of the two rather than between them.
 */
export const ANSWER_TOKENS = 20_000;

export async function generateTimeline(opts: {
  /**
   * **The article, handed in — never a directory to open.**
   *
   * The eighth stage of this shape and the first born converted
   * (src/article-input.ts). The reason is not tidiness: a stage's `stamp` asks
   * the *store* for blocks, tree and metadata, and every stage that also opened
   * its own files hashed one article and generated from another. On a laptop
   * those are the same bytes; through a job-scoped `/tmp` on a deployment they
   * are not, and the result is a stale artefact reporting itself current for
   * ever with nothing about it looking wrong. Taking the article as an argument
   * makes that unrepresentable, so **do not reach for `fs` in here**.
   *
   * **For Stage 4, and written down here so it is not lost:** `stamp` and `run`
   * must read the article through *different* helpers. `run` cannot proceed
   * without one, so it takes `readArticle`, which refuses. `stamp` asks what
   * stamp this step *would* write, and an unreadable article there means we
   * cannot tell — so it takes `tryReadArticle` and returns `null`, which
   * `stepIsDone` turns into a re-run. That is the safe way to be wrong; a throw
   * is a failed job.
   */
  article: Article;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
  /** Mark the article as a cache breakpoint — see src/glossary.ts for the note. */
  cacheArticle?: boolean;
  /**
   * The timeline this article already has, or `null` **only** when it genuinely
   * has none.
   *
   * **Required, for the reason `generateIdeas`'s `previous` is**: an optional
   * parameter is precisely what a later landing could drop while still
   * compiling, and the result would be a stage that re-mints every id on every
   * run and reports success. There is one thing this is read for — ids, and
   * only when `sourceHash` matches — so nothing else here would notice.
   */
  previous: Timeline | null;
}): Promise<TimelineRun> {
  const { blocks, tree, meta: articleMeta } = opts.article;

  /* **Two values, deliberately, and the difference is the whole thing.**
     `articleWithIds` needs a head to write its `TITLE:` line, so an article
     with no metadata gets a stub — and the stub is for the PROMPT and stops
     there. The fingerprint below is handed the real `articleMeta`, `null` and
     all, because the pipeline's `stamp` reads the article and sees `null`:
     hash the stub instead and this stage writes a fingerprint the stamp can
     never reproduce, so every article without metadata reports stale for ever,
     on every run, with nothing red anywhere.

     It matters more here than for `ideas` or `sketch`. An article with no
     metadata is not an edge case for this stage — it is every article ingested
     before 2026-08-31, because the publication date only arrives on
     re-extraction.

     **And a green suite is not evidence this is right.** Applying the mutation
     — hash the stub — reddens nothing today, because `articleWithIdsFingerprint`
     resolves `fallbackHeadTitle` itself and the stub carries that one field and
     nothing else, so the two hashes are identical. The rule protects the day
     that stops being true. docs/reusable/silent-success.md, with a case where
     even the mutation agrees with the bug. */
  const meta: Meta = articleMeta ?? ({ title: fallbackHeadTitle(tree) } as Meta);
  const sourceHash = inputFingerprint(blocks, tree, articleMeta);

  /* The publisher's own string, day precision, timezone untouched —
     `dayFrame` in src/timeline-time.ts takes the front ten characters. */
  const frame = articleMeta?.publishedAt ?? null;

  /* Ids are inherited only when the artefact describes the same article: one
     inherited across a re-extraction would carry a reader's link onto an event
     in text that is gone. */
  const onDisk = opts.previous;
  const inherit = onDisk && onDisk.sourceHash === sourceHash ? idsByEvidence(onDisk) : null;

  /* **The argument, not the apparatus** — applied at the call site, as
     src/ideas.ts explains: filtering inside `articleWithIds` would be right for
     the pipeline stages and wrong for search, explain and converse. */
  const evidence = blocks.filter(isBodyEvidence);
  const words = articleWordCounts(blocks).body;
  const started = Date.now();
  const maxTokens = budgetFor("timeline", ANSWER_TOKENS);

  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "timeline",
      {
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: effortFor("timeline") },
        /* Article first, then this stage's instructions. The cache prefix runs
           from the top of the request, so anything ahead of the article that
           differs between stages breaks the match before it starts. */
        system: [
          {
            type: "text" as const,
            /* **`articleWithIds`, not `articleText`** — every occurrence is a
               block id the model has to name, so the ids have to be on the
               page. `ideas` shipped once with the other renderer and every
               occurrence was dropped as an invented id, with the stage
               reporting that the model had returned nothing. `ARTICLE_RENDERER`
               in src/models.ts is where that fact is recorded. */
            text: articleWithIds(meta, evidence),
            ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
          },
          { type: "text" as const, text: SYSTEM },
        ],
        messages: [{ role: "user", content: renderPrompt({ tree, frame }) }],
      },
      { ...(opts.signal ? { signal: opts.signal } : {}) },
    );

    if (opts.onProgress) {
      const report = opts.onProgress;
      let chars = 0;
      let last = 0;
      call.onText((delta) => {
        chars += delta.length;
        // Throttled: the model emits deltas far faster than anyone reads them,
        // and each of these is a write the job poller may pick up.
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        report(`${Math.round(chars / 1000)}k characters of timeline so far`);
      });
    }

    /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper
       is what records what this call cost. src/messages-stream.ts. */
    message = await call.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  if (wasRefused(message)) {
    /* `stop_details` is neither thrown nor logged — it is the provider's own
       words about a request that carried the whole article. src/messages.ts. */
    throw new Error(MODEL_REFUSED.message);
  }
  if (message.stop_reason === "max_tokens") {
    throw truncationFailure("timeline", maxTokens, ANSWER_TOKENS, {
      outputTokens: message.usage.output_tokens,
      answerChars: message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .reduce((n, b) => n + b.text.length, 0),
    });
  }

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const dropped = emptyDropped();
  const timeline = buildTimeline(parseJson(raw), {
    slug: opts.article.slug,
    blocks,
    sourceHash,
    frame,
    elapsedMs: Date.now() - started,
    inherit,
    dropped,
  });

  /* **The file is written by the caller, not here.** Stage 4 returns `parts`
     for the transaction to write, the way `sketch` already does, and this is
     the seam where that happens — a generator that also writes is a generator
     that cannot be made transactional without being taken apart first. */
  return {
    timeline,
    blocks: blocks.length,
    words,
    frame,
    dropped,
    model: CAPABLE_MODEL,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    elapsedMs: Date.now() - started,
  };
}

/** One row, in the notation the panel will draw — see `markFor`. */
function line(event: TimelineEvent): string {
  const d = event.dating;
  /* A rejected row keeps its words where it has them — on an article with no
     publication date every dated event lands here, and "⊘" alone would tell the
     reader nothing they could go and check. */
  if (d.kind === "rejected") return d.phrase ? `  ⊘  “${d.phrase}”` : "  ⊘  ";
  if (d.kind === "words") return `“${d.phrase}”`;
  if (d.kind === "untimed") return "  ·  ";
  const when = d.when;
  const body = when.extent === "extended" ? "▬▬" : " ● ";
  return `${when.earliest === null ? "⋯" : "│"}${body}${when.latest === null ? "⋯" : "│"} ` +
    `${when.earliest ?? ""}${when.earliest !== when.latest ? `…${when.latest ?? ""}` : ""}`;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: tsx src/timeline.ts <dir with blocks.json + tree.json>");
    console.error("Running it again replaces the timeline — it does not append.");
    process.exit(1);
  }
  /* **In `main`, never in `generateTimeline`.** The server already loaded
     `.env.local` before any stage runs, so doing it inside the generator would
     be a no-op there and an import of `node:fs` into a path that does not need
     one. `tests/paid-cli-ledger.test.ts` holds this rule for every stage CLI. */
  loadEnvLocal();
  /* **The last filesystem read in this half of the pipeline lives in ONE
     place** — src/article-input.ts — and this is a caller that has a folder and
     no store. The generator is handed the result; it never opens anything. */
  const article = await readArticleFromDir(dir);
  // Before the call, not after: this is the only thing on screen while the
  // model works, and printing it afterwards makes the command look hung.
  console.log(`Building the timeline with ${CAPABLE_MODEL}…`);
  const run = await generateTimeline({
    article,
    /* The CLI has files and no store, so it reads the file — and `readTimeline`
       gives one `null` for every kind of failure. Acceptable here: a person is
       watching, and the worst case is a re-run that mints fresh ids in a
       directory they named by hand. The pipeline wants the store's baseline. */
    previous: await readTimeline(dir),
    onProgress: (detail) => process.stdout.write(`\r  ${detail}          `),
  });
  /* Written here rather than in the generator — see the note on the return
     value. Stage 4 hands `parts` to the transaction instead. */
  const outFile = path.join(dir, "timeline.json");
  await writeFile(outFile, JSON.stringify(run.timeline, null, 2), "utf-8");

  const { timeline, dropped } = run;
  const dated = timeline.events.filter((e) => e.dating.kind === "dated").length;
  console.log(
    `\n${run.blocks} blocks, ${run.words} words → ${timeline.events.length} events ` +
      `(${dated} dated), frame ${run.frame ?? "none"}`,
  );
  for (const event of timeline.events) {
    const mark = event.modality === "happened" ? " " : event.modality === "predicted" ? "→" : "?";
    console.log(`  ${mark} ${line(event).padEnd(28)} ${event.label}  (${event.occurrences.length})`);
  }
  console.log(`\nTokens:  ${run.inputTokens} in, ${run.outputTokens} out`);
  console.log(`Elapsed: ${(run.elapsedMs / 1000).toFixed(1)}s`);
  console.log(
    `Dropped: ${dropped.unanchored} unanchored, ${dropped.unknownIds} bad ids, ` +
      `${dropped.unquoted} unquoted, ${dropped.malformed} malformed, ` +
      `${dropped.datedLabel} with a date in the label, ` +
      `${dropped.truncated} occurrences over the cap, ${dropped.overCap} events over the cap`,
  );
  console.log(
    `Dates:   ${dropped.noDateInPhrase} phrases with no date in them (fine), ` +
      `${dropped.unparseablePhrase} unparseable, ` +
      `${dropped.phraseNotInOccurrence} not in the quoted passage, ` +
      `${dropped.noYearFrame} with no year to fill in, ` +
      `${dropped.phraseNotFound} phrases we could not locate and so did not show`,
  );
  console.log(
    `Order:   ${dropped.unordered} without an order, ` +
      `${dropped.duplicateOrders} sharing one with another event, ` +
      `${dropped.orderConflicts} conflicts with the article's own dates`,
  );
  console.log(`\nWrote ${outFile}`);
}

/* **`stageCli`, which is the guard and the ledger together.** Awaited rather
   than `void`ed: flushing the ledger, and any failure in it, are part of the
   command finishing rather than something the process might exit before doing.
   src/cli-ledger.ts says what the one line replaces and why it is one line. */
await stageCli(import.meta.url, main);
