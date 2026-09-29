/**
 * **What sits under a Trajectory stop** — the scrapbook's card, gathered from
 * what the other modes have *already* written for this article: the glossary
 * terms the passage uses, the ideas it bears on, the FAQ question it answers,
 * and where it sits in the study's timeline.
 *
 * Pure: the artefacts, the stop's block and the route in, the clusters out.
 * Nothing here fetches or generates; the band reads the artefacts through the
 * read-only hooks (`useGlossaryRead`, `useIdeasRead`, `useFaqRead`,
 * `useTimelineRead`), so "nothing on the card starts a run" is structural
 * (Sol F22).
 *
 * The rules, each from docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
 * § Stage 3 in detail and its revision after Sol's review:
 *
 * - **Terms are found in the prose the reader sees**, `renderedText(block.html)`,
 *   by the one shared matcher (`formsOf`, `termPattern`, `termAppears` in
 *   src/term-match.ts), over **every** glossary entry — not the entry's stored
 *   block list, which the spike showed misses word forms, and which is what
 *   the prose underlining restricts itself to (F23).
 * - **"Also at stop k"**, never "met": the first *earlier* stop on this pass
 *   whose passage uses the term too. The client does not know what the reader
 *   has read, only where the route goes (F20).
 * - **A stale artefact contributes nothing.** It may describe blocks that have
 *   moved. An *outdated* one — the article unchanged, an older prompt — is
 *   shown (F19).
 * - **Not gathered:** the section's gist (it gave away the finding in the
 *   spike) and the quote's reason (it repeated the role).
 */
import type {
  Block,
  BlockId,
  Faq,
  Glossary,
  GlossaryEntry,
  Ideas,
  Timeline,
} from "../types.js";
import { formsOf, termAppears, termPattern, termSpans } from "../term-match.js";
import { renderedText } from "./annotate.js";

/** An artefact as the card needs it: the value if there is one, and whether it is stale. */
export interface Fresh<T> {
  value: T | null;
  stale: boolean;
}

/**
 * `Pick`s of the artefacts, not the artefacts, because a visitor's band hands
 * the card the public payload's copies — the same lists, without the
 * provenance a visitor is never sent (`VisitorTrajectoryBand`, since
 * 2026-09-29).
 */
export interface CardSources {
  glossary: Fresh<Pick<Glossary, "entries">>;
  ideas: Fresh<Pick<Ideas, "ideas">>;
  faq: Fresh<Pick<Faq, "questions">>;
  timeline: Fresh<Pick<Timeline, "events">>;
}

export interface CardTerm {
  entry: GlossaryEntry;
  /** The first earlier stop on this pass that also uses it, numbered from 1 — or `null`. */
  alsoAt: number | null;
}

export interface CardIdea {
  id: string;
  name: string;
  /** The idea itself, one line — what the chip opens in place (260929f, 59). */
  statement: string;
}

/** One of the passages FAQ pairs with a question: the article's own words. */
export interface CardPassage {
  blockId: BlockId;
  quote: string;
  /** Distinguishes repeated copies of the same words in one block, as in FAQ. */
  start: number;
  /** The section path, `Results › Robustness`, or `null` where the tree does not cover it. */
  place: string | null;
  /**
   * **This is the stop's own quote** — the same block, and the words of one
   * are all visible in the stop quote. Established by the source offsets where
   * the Quote has them, or conservatively by the words for an older Quote, not
   * the block alone (Sol, plan 260929f F3), so the panel can say "this passage"
   * rather than repeat the quote the reader is looking at.
   */
  here: boolean;
}

export interface CardQuestion {
  id: string;
  question: string;
  /**
   * **Every** passage FAQ pairs with it, this paragraph's included (Sol,
   * plan 260929f F3): the pairing is by block, so FAQ's words in this
   * paragraph may not be the stop's quote, and "the others" cannot be told
   * apart by block alone.
   */
  passages: CardPassage[];
}

export interface CardEvent {
  id: string;
  label: string;
}

/**
 * Where a card link goes: a mode and the selection it opens on (`?term=`,
 * `?idea=`, `?event=`). FAQ has no selection in the address, so its link opens
 * the list at the top.
 */
export type CardTarget =
  | { kind: "term"; id: string }
  | { kind: "idea"; id: string }
  | { kind: "event"; id: string }
  | { kind: "faq" };

/** The mode a card link opens — total, so a new kind cannot fall into another's switch (Sol, 260929f F8). */
export function modeForCardTarget(target: CardTarget): "glossary" | "ideas" | "timeline" | "faq" {
  switch (target.kind) {
    case "term":
      return "glossary";
    case "idea":
      return "ideas";
    case "event":
      return "timeline";
    case "faq":
      return "faq";
    default: {
      const never: never = target;
      return never;
    }
  }
}

export interface StopCard {
  terms: CardTerm[];
  ideas: CardIdea[];
  questions: CardQuestion[];
  events: CardEvent[];
}

const EMPTY: StopCard = { terms: [], ideas: [], questions: [], events: [] };

export function cardIsEmpty(card: StopCard): boolean {
  return (
    card.terms.length === 0 &&
    card.ideas.length === 0 &&
    card.questions.length === 0 &&
    card.events.length === 0
  );
}

/** The value, unless there is none or it is stale (F19). */
function usable<T>(source: Fresh<T>): T | null {
  return source.stale ? null : source.value;
}

export function gatherStopCard(opts: {
  /** The current stop's block. */
  blockId: BlockId;
  blocks: readonly Block[];
  /**
   * The blocks of the stops on this pass, in route order — `null` for a stop
   * whose quote has gone. For "also at stop k".
   */
  route: readonly (BlockId | null)[];
  sources: CardSources;
  /** A block's section path, for the FAQ passages. Absent: no place is shown. */
  placeOf?: (blockId: BlockId) => string | null;
  /** The stop's own quote, to recognise a FAQ passage that is already visible below. */
  quote?: { text: string; start?: number } | null;
}): StopCard {
  const { blockId, sources } = opts;
  const byId = new Map(opts.blocks.map((b) => [b.id, b]));
  const here = byId.get(blockId);
  if (!here) return EMPTY;

  const texts = new Map<BlockId, string>();
  const textOf = (id: BlockId): string | null => {
    const cached = texts.get(id);
    if (cached !== undefined) return cached;
    const b = byId.get(id);
    if (!b) return null;
    const text = renderedText(b.html);
    texts.set(id, text);
    return text;
  };

  return {
    terms: termsAt(usable(sources.glossary), blockId, textOf, opts.route),
    ideas: ideasAt(usable(sources.ideas), blockId),
    questions: questionsAt(usable(sources.faq), blockId, opts.placeOf ?? (() => null), opts.quote ?? null),
    events: eventsAt(usable(sources.timeline), blockId),
  };
}

function termsAt(
  glossary: Pick<Glossary, "entries"> | null,
  blockId: BlockId,
  textOf: (id: BlockId) => string | null,
  route: readonly (BlockId | null)[],
): CardTerm[] {
  if (!glossary) return [];
  const text = textOf(blockId);
  if (!text) return [];
  const at = route.indexOf(blockId);
  const earlier = at > 0 ? route.slice(0, at) : [];

  const found: { term: CardTerm; first: number }[] = [];
  for (const entry of glossary.entries) {
    const pattern = termPattern(formsOf(entry));
    if (!pattern) continue;
    const first = termSpans(text, pattern)[0];
    if (!first) continue;
    let alsoAt: number | null = null;
    for (const [i, id] of earlier.entries()) {
      if (id === null) continue;
      const other = textOf(id);
      if (other && termAppears(other, pattern)) {
        alsoAt = i + 1;
        break;
      }
    }
    found.push({ term: { entry, alsoAt }, first: first.start });
  }
  /* Where each first appears in the passage, so the chips read in its order. */
  return found.sort((a, b) => a.first - b.first).map((f) => f.term);
}

function ideasAt(ideas: Pick<Ideas, "ideas"> | null, blockId: BlockId): CardIdea[] {
  if (!ideas) return [];
  return ideas.ideas
    .filter((idea) => idea.occurrences.some((o) => o.blockId === blockId))
    .map((idea) => ({ id: idea.id, name: idea.name, statement: idea.statement }));
}

function questionsAt(
  faq: Pick<Faq, "questions"> | null,
  blockId: BlockId,
  placeOf: (blockId: BlockId) => string | null,
  quote: { text: string; start?: number } | null,
): CardQuestion[] {
  if (!faq) return [];
  const mine = quote === null ? "" : squash(quote.text);
  const same = (p: { blockId: BlockId; quote: string; start: number }) => {
    if (p.blockId !== blockId || quote === null || mine === "") return false;
    /* Both offsets are in the same `block.text` space. Besides proving that the
       FAQ's whole passage is visible in the stop quote, they distinguish two
       copies of the same words in one paragraph. Old Quotes may lack `start`,
       so their deliberately conservative fallback is words-only. */
    if (quote.start !== undefined) {
      return p.start >= quote.start && p.start + p.quote.length <= quote.start + quote.text.length;
    }
    const theirs = squash(p.quote);
    if (theirs === mine) return true;
    /* Only hide a FAQ passage that is wholly visible in the stop quote. A
       longer FAQ passage containing the stop would hide words not shown below.
       Require a real sentence so a few shared words do not count. */
    return theirs.length >= SAME_PASSAGE_MIN && mine.includes(theirs);
  };
  return faq.questions
    .filter((q) => q.passages.some((p) => p.blockId === blockId))
    .map((q) => ({
      id: q.id,
      question: q.question,
      passages: q.passages.map((p) => ({
        blockId: p.blockId,
        quote: p.quote,
        start: p.start,
        here: same(p),
        place: placeOf(p.blockId),
      })),
    }));
}

/** How long a legacy FAQ passage must be before containment alone counts as the same passage. */
const SAME_PASSAGE_MIN = 40;

/** Case, spacing and quotation marks aside — enough to see one quote inside another. */
function squash(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u201c\u201d\u2018\u2019"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function eventsAt(timeline: Pick<Timeline, "events"> | null, blockId: BlockId): CardEvent[] {
  if (!timeline) return [];
  return timeline.events
    .filter((event) => event.occurrences.some((o) => o.blockId === blockId))
    .map((event) => ({ id: event.id, label: event.label }));
}
