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
 * So a date the article does not contain has no way into the artefact, because
 * there is nowhere for one to come from. That is structural rather than
 * checked, and it is the fix for the safety hole the first design had: the
 * plan's original phrase-check failed in *both* directions — it rejected the
 * one correctly-stated span on the test article (an editorial `[F]rom` bracket)
 * and it accepted `July 1` found inside `July 11`. Both proved rather than
 * argued; the write-up is in src/timeline-time.ts's header.
 *
 * A hallucinated date is the highest-consequence thing this app could ship: a
 * wrong glossary entry looks wrong, and `12 June 2019` looks exactly like
 * `12 June 2019`.
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
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { partsOf } from "./arc.js";
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
  /** Copied verbatim by the model, and located by us — never trusted unlocated. */
  quote: string;
  /**
   * A disambiguator between repeats, never the anchor: the client re-finds the
   * words itself in the *rendered* text, which is a different offset space from
   * `block.text`. src/web/annotate.ts § the header.
   */
  start: number;
}

export interface TimelineEvent {
  id: TimelineEventId;
  /** A handle, not a retelling. Under about ten words. */
  label: string;
  /** What the parser read out of the article, or null when there is no date. */
  when: When | null;
  /**
   * **The third outcome** (plan § Three outcomes, not two): the piece dates
   * this and we could not read the date. It must not render as an ordinary
   * undated row, or "fails visibly" is true only inside a counter.
   *
   * `false` with `when: null` means the piece never dated it — which is a
   * correct answer and often the right one.
   */
  dateRejected: boolean;
  /**
   * The article's temporal words when they carry **no date at all** — "another
   * month later", "within a few hours". Shown in the date column where a date
   * would otherwise be.
   *
   * Only ever set when `readWhen` refused with `noDateInPhrase`, which means
   * the parser scanned these words and found no date expression in them. That
   * is the safety property: a string that reaches the reader through this field
   * has been proved not to contain a date, so the mode's one rule — nothing is
   * dated unless the article dates it — cannot be got round by putting a date
   * in here.
   */
  phrase?: string;
  /**
   * The model's reading of where this sits in the sequence, and **the sort
   * key** — Greg's call, 2026-08-31: the dates do not move anything. An event
   * known only to be "by 4 July" may have happened on the 1st, and sorting it
   * to the 4th would assert otherwise.
   */
  order: number;
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
    unanchored: 0,
    unordered: 0,
    unparseablePhrase: 0,
    phraseNotInOccurrence: 0,
    noDateInPhrase: 0,
    noYearFrame: 0,
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
    const quote = text(o.quote);
    const span = quote ? findQuote(block.text, quote, undefined, "spaced") : null;
    if (!span) {
      dropped.unquoted++;
      continue;
    }
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
 * coming December. A **hypothetical** stays `"past"` — a counterfactual is
 * usually about something that did not happen *then* ("if they had caught it in
 * July"), and the two share a sort partition without sharing a tense.
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

interface Dating {
  when: When | null;
  dateRejected: boolean;
  phrase?: string;
}

/**
 * Read the date out of the article, or say why not.
 *
 * **The phrase must sit inside one of the event's own quotes**, which is why
 * `within` is passed. That is a stricter rule than "somewhere in the block",
 * and it is a rule the prompt states rather than one the model has to guess:
 * four of this article's blocks hold two distinct dates each, and a block-wide
 * window would let an event borrow its neighbour's date whenever the two
 * differ by a component the phrase does not state.
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
  if (!phrase) return { when: null, dateRejected: false };

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
    if (result.ok) return { when: result.when, dateRejected: false };
    if (REFUSAL_RANK[result.reason] < REFUSAL_RANK[worst]) worst = result.reason;
  }

  dropped[worst]++;
  /* `noDateInPhrase` is the relative case and is not a rejection: "another
     month later" is the article declining to date something, and a row drawn
     with the ⊘ glyph here would be accusing the piece of something it never
     did. Every other refusal IS a rejection — the piece dates this and we could
     not read it — and the panel has to say so. */
  if (worst === "noDateInPhrase") return { when: null, dateRejected: false, phrase };
  return { when: null, dateRejected: true };
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
    /* A number, or NaN — never a coerced 0. `Number("")` is 0 and a missing
       order is not "first"; `orderKey` in src/timeline-time.ts sorts a
       non-finite order last within its partition, deliberately, because a row
       the model could not place has no claim on the top of the list. */
    const order = typeof r.order === "number" && Number.isFinite(r.order) ? r.order : Number.NaN;
    if (!Number.isFinite(order)) dropped.unordered++;

    const dating = dateEvent(text(r.phrase), occurrences, frame, modality, dropped);
    out.push({
      id: mintUniqueId(taken),
      label,
      when: dating.when,
      dateRejected: dating.dateRejected,
      ...(dating.phrase ? { phrase: dating.phrase } : {}),
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
export function evidenceKey(event: Pick<TimelineEvent, "when" | "occurrences">): string {
  const blocks = [...new Set(event.occurrences.map((o) => o.blockId))].sort().join(",");
  const when = event.when ? `${event.when.earliest ?? ""}..${event.when.latest ?? ""}` : "";
  return `${blocks}|${when}`;
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
  const taken = new Set<string>(opts.inherit?.values() ?? []);
  const fresh = inheritIds(
    toEvents(parsed.events, opts.blocks, opts.frame, taken, opts.dropped),
    opts.inherit ?? null,
  );
  const raws = Array.isArray(parsed.events) ? parsed.events.length : 0;

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
  opts.dropped.orderConflicts = countOrderConflicts(events);

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
  outFile: string;
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

DO NOT GIVE DATES

This is the rule everything else here serves. Do not write a date anywhere in
your answer. Not in "phrase", not in "label", not in any field.

Instead, copy the article's OWN temporal words — "By the next morning, July 11"
— into "phrase", and stop. We read the date out of those words ourselves, out
of the article's own characters. A date you write down cannot be used and will
be thrown away; a date the article does not contain has no way in at all.

So there is nothing to be gained by working one out, and nothing lost by
leaving an event undated. An undated event is a CORRECT answer and is often the
right one.

WHAT "phrase" IS

The temporal expression itself, copied from the paragraph, INCLUDING the word
that governs it.

  GOOD  "by July 4"          BAD  "July 4"
  GOOD  "During May"         BAD  "May"
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

The phrase must appear INSIDE one of this event's own quotes, in the same
words. We look for it there and nowhere else.

So when an event has a time, choose a quote that contains the time. If the
article says "By May 12, some agents had figured out how to talk to each other",
the quote is that sentence, not the clause after the comma. A phrase we cannot
find inside a quote is dropped, and the row then says out loud that the piece
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
    : "We do not know when this article was published. That means a date written without a\n" +
      "year cannot be resolved and the event will show without one. Nothing changes for you:\n" +
      "copy the article's words as it writes them and let us worry about it.";

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
  dir: string;
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
  /* `parseJsonFrom`, not `JSON.parse`: blocks.json *is* the article, and V8's
     own parse error quotes the first characters of what it was handed. */
  const { blocks } = parseJsonFrom<{ blocks: Block[] }>(
    await readFile(path.join(opts.dir, "blocks.json"), "utf-8"),
    "blocks.json",
  );
  const tree = parseJsonFrom<Tree>(
    await readFile(path.join(opts.dir, "tree.json"), "utf-8"),
    "tree.json",
  );
  const onDiskMeta: Meta | null = await readFile(path.join(opts.dir, "meta.json"), "utf-8")
    .then((raw) => JSON.parse(raw) as Meta)
    .catch(() => null);
  /* A stub with a title in it is enough for the prompt head — it is context for
     the model, not something the answer cites — and it keeps a missing
     meta.json from failing a run that has everything else it needs. The
     fingerprint below uses `onDiskMeta` and never this: hashing the stub would
     write a fingerprint the pipeline's stamp can never reproduce, and the
     article would report stale for ever while looking healthy. src/ideas.ts
     says the same thing at greater length. */
  const meta: Meta = onDiskMeta ?? ({ title: fallbackHeadTitle(tree) } as Meta);

  const sourceHash = inputFingerprint(blocks, tree, onDiskMeta);
  /* The publisher's own string, day precision, timezone untouched —
     `dayFrame` in src/timeline-time.ts takes the front ten characters. */
  const frame = onDiskMeta?.publishedAt ?? null;

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
    slug: tree.slug,
    blocks,
    sourceHash,
    frame,
    elapsedMs: Date.now() - started,
    inherit,
    dropped,
  });

  const outFile = path.join(opts.dir, "timeline.json");
  await writeFile(outFile, JSON.stringify(timeline, null, 2), "utf-8");

  return {
    timeline,
    outFile,
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
  const when = event.when;
  if (event.dateRejected) return "  ⊘  ";
  if (!when) return event.phrase ? `“${event.phrase}”` : "  ·  ";
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
  // Before the call, not after: this is the only thing on screen while the
  // model works, and printing it afterwards makes the command look hung.
  console.log(`Building the timeline with ${CAPABLE_MODEL}…`);
  const run = await generateTimeline({
    dir,
    /* The CLI has files and no store, so it reads the file — and `readTimeline`
       gives one `null` for every kind of failure. Acceptable here: a person is
       watching, and the worst case is a re-run that mints fresh ids in a
       directory they named by hand. The pipeline wants the store's baseline. */
    previous: await readTimeline(dir),
    onProgress: (detail) => process.stdout.write(`\r  ${detail}          `),
  });

  const { timeline, dropped } = run;
  const dated = timeline.events.filter((e) => e.when !== null).length;
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
      `${dropped.truncated} occurrences over the cap, ${dropped.overCap} events over the cap, ` +
      `${dropped.unordered} without an order`,
  );
  console.log(
    `Dates:   ${dropped.noDateInPhrase} phrases with no date in them (fine), ` +
      `${dropped.unparseablePhrase} unparseable, ` +
      `${dropped.phraseNotInOccurrence} not in the quoted passage, ` +
      `${dropped.noYearFrame} with no year to fill in, ` +
      `${dropped.orderConflicts} order conflicts`,
  );
  console.log(`\nWrote ${run.outFile}`);
}

/* **`stageCli`, which is the guard and the ledger together.** Awaited rather
   than `void`ed: flushing the ledger, and any failure in it, are part of the
   command finishing rather than something the process might exit before doing.
   src/cli-ledger.ts says what the one line replaces and why it is one line. */
await stageCli(import.meta.url, main);
