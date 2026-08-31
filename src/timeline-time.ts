/**
 * Reading a date out of the article's **own characters** — the safety property
 * the whole timeline mode rests on, and the only route a date has into the
 * artefact.
 *
 * See docs/plans/260831i-timeline-mode.md § The model supplies evidence; code supplies
 * dates. The model is never asked for a date. It returns the article's temporal
 * words — "By the next morning, July 11" — and this file reads the date out of
 * the block those words came from. A date the article does not contain has no
 * way in, because there is nowhere for one to come from.
 *
 * ## Why the obvious design does not work
 *
 * The first design asked the model for a date and checked its words were in the
 * block with `findQuote`. That check fails in **both** directions, and both
 * were proved rather than argued (plan § The phrase check does not work):
 *
 *  - It rejects correct dates. `spya-ebtbnm` reads `[F]rom July 13 through
 *    July 19` — an editorial capitalisation bracket in a quoted METR excerpt.
 *    The model normalises it to `from`, as a person would, and `findQuote`
 *    returns null. `FOLD` in src/quote-match.ts cannot help: brackets change
 *    the string's length and every fold there must not.
 *  - It accepts wrong ones. `findQuote` is substring matching with no token
 *    boundary, so `July 1` is found inside `July 11` — and four of the test
 *    article's blocks hold two distinct dates each.
 *
 * So this file does not locate the model's string at all. It scans **the block**
 * for date expressions, scans the **phrase** for the same, and uses the phrase
 * only to *choose which of the block's dates is meant*. Selection is by parsed
 * value, not by substring: `July 1` and `July 11` are 07-01 and 07-11, they do
 * not match, and the phrase is refused. The brackets never come up, because the
 * `[F]rom` is between two of the block's own tokens and nothing has to reproduce
 * it.
 *
 * ## No `Date` objects, anywhere
 *
 * ISO day-precision strings end to end, compared as strings. The platform
 * `Date` constructor picks up a timezone, and a day that moves by one across
 * the server/client line is the kind of wrong that looks right
 * (plan § The traps, item 3). Every calculation here is integer arithmetic on
 * year/month/day.
 *
 * Pure: no model call, no file I/O, nothing from src/web.
 */
import type { Span } from "./quote-match.js";
import type { BlockId, TimelineModality, When, WhenRefusal } from "./types.js";

/**
 * The three artefact-shaped types this file reads and writes now live in
 * src/types.ts, beside `Ideas`, `Quotes` and every other artefact's, and they
 * are re-exported here so the parser stays the one place a caller has to know
 * about to use it.
 *
 * They were declared locally while Stage 1 was being built, because another
 * session held src/types.ts and reaching into a file somebody else is editing
 * is how two agents overwrite each other. Stage 4 moved them, as the note that
 * stood here said it would.
 */
export type { TimelineModality, When, WhenRefusal };

/**
 * Which side of the publication date a year-less expression resolves to.
 *
 * `"past"` — the default, and right for almost everything: an article narrating
 * what happened means the most recent July 7, not next year's. `"future"` is
 * for a prediction, and it is the one case where the default is backwards — a
 * January piece saying "in December we expect…" means the coming December.
 * Stage 2 has `modality` from the model and passes it.
 *
 * **This one did not move to src/types.ts with the others**, and that is the
 * distinction the move was drawn on: it is an argument to `readWhen`, not a
 * field of the artefact and not a value on the wire, so it belongs beside the
 * function that reads it.
 */
export type WhenDirection = "past" | "future";

export type WhenResult = { ok: true; when: When } | { ok: false; reason: WhenRefusal };

export interface WhenInput {
  /** The block's own text — the only place a date is allowed to come from. */
  text: string;
  /** The model's words. Used to *choose* a date, never to supply one. */
  phrase: string;
  /** The block those characters belong to. */
  blockId: BlockId;
  /**
   * The publication date, or null. ISO; a full timestamp is fine, the day is
   * taken off the front. Nineteen of the test article's twenty-four
   * expressions are year-less, so with no frame most of them stay undated —
   * which is the point. **No year is ever guessed.**
   */
  frame: string | null;
  /**
   * The occurrence's span inside `text`, when the caller has one. The date must
   * sit inside it, so a phrase that is in the block but belongs to a different
   * sentence is refused rather than quietly dated.
   */
  within?: Span;
  /** Defaults to `"past"`. Pass `"future"` for a prediction. */
  direction?: WhenDirection;
}

/**
 * A phrase is untrusted model output, so it is bounded before it is scanned.
 * A temporal expression is a handful of words; anything longer is not one, and
 * refusing is cheaper than deciding which part of it to believe.
 */
export const MAX_PHRASE_CHARS = 240;
/** More dates than a range can hold. See `readWhen`'s structure step. */
export const MAX_PHRASE_ATOMS = 8;

// ---------------------------------------------------------------------------
// ISO days, as integers and strings. Never a `Date`.
// ---------------------------------------------------------------------------

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(y: number, m: number): number {
  if (m < 1 || m > 12) return 0;
  if (m === 2 && isLeap(y)) return 29;
  return MONTH_LENGTHS[m - 1] ?? 0;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** `null` rather than a nonsense string, so 30 February cannot become a date. */
function isoOf(y: number, m: number, d: number): string | null {
  if (y < 1000 || y > 9999) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDay(iso: string): Ymd | null {
  const m = ISO_DAY.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return isoOf(y, mo, d) === null ? null : { y, m: mo, d };
}

/** One day either side, by hand, because a `Date` would bring a timezone. */
function shiftDay(iso: string, delta: 1 | -1): string | null {
  const at = parseIsoDay(iso);
  if (!at) return null;
  let { y, m, d } = at;
  d += delta;
  if (d < 1) {
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    d = daysInMonth(y, m);
  } else if (d > daysInMonth(y, m)) {
    d = 1;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return isoOf(y, m, d);
}

/**
 * The publication day, off whatever the metadata carries.
 *
 * `Meta.publishedAt` is the publisher's own string — Readability hands back
 * `"2026-08-29T22:47:53+00:00"` — and only the day matters here, so the front
 * ten characters are taken and validated. A string that is not a real day
 * yields no frame at all, which means no year gets filled, which is the correct
 * failure.
 */
export function dayFrame(frame: string | null | undefined): string | null {
  if (typeof frame !== "string") return null;
  const day = frame.slice(0, 10);
  return parseIsoDay(day) === null ? null : day;
}

// ---------------------------------------------------------------------------
// Scanning text for date expressions
// ---------------------------------------------------------------------------

const MONTH_ALT =
  "january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec";

const MONTH_NUMBER: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

/**
 * Which components an expression actually states. An absent one is absent
 * rather than unknown: "July 7" has no `y`, and that is the fact the year rule
 * and `sameDate` both work off. `| undefined` is spelled out because
 * `exactOptionalPropertyTypes` is on, and a reader that returns
 * `{ y: undefined }` should be as legal as one that omits the key.
 */
interface DateParts {
  y?: number | undefined;
  m?: number | undefined;
  d?: number | undefined;
}

/** One date expression found in a string, in that string's own offsets. */
interface RawDate extends DateParts {
  start: number;
  /** Exclusive. */
  end: number;
  /** Was the month word capitalised? Only ever consulted for a bare month. */
  capitalised: boolean;
}

interface DatePattern {
  source: string;
  read: (m: RegExpExecArray) => DateParts | null;
}

function monthOf(word: string | undefined): number | undefined {
  return word === undefined ? undefined : MONTH_NUMBER[word.toLowerCase()];
}

function optionalYear(raw: string | undefined): number | undefined {
  return raw === undefined ? undefined : Number(raw);
}

/**
 * In priority order, longest form first. A later pattern's match is discarded
 * where it overlaps one already accepted — which is what stops the bare-month
 * pattern from also matching the "July" inside "July 13", and the bare-year
 * pattern from matching the "2026" inside "2026-07-19".
 */
const DATE_PATTERNS: DatePattern[] = [
  {
    source: "\\b(\\d{4})-(\\d{2})-(\\d{2})\\b",
    read: (m) => ({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }),
  },
  {
    // "July 7", "July 7, 2026", "Jul. 7th"
    source: `\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`,
    read: (m) => ({ m: monthOf(m[1]), d: Number(m[2]), y: optionalYear(m[3]) }),
  },
  {
    // "7 July", "7th of July 2026"
    source: `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})\\.?(?:\\s*,?\\s*(\\d{4}))?\\b`,
    read: (m) => ({ d: Number(m[1]), m: monthOf(m[2]), y: optionalYear(m[3]) }),
  },
  {
    // "May 2026"
    source: `\\b(${MONTH_ALT})\\.?\\s*,?\\s*(\\d{4})\\b`,
    read: (m) => ({ m: monthOf(m[1]), y: Number(m[2]) }),
  },
  {
    // A bare month. See `bareMonthsMustBeCapitalised`.
    source: `\\b(${MONTH_ALT})\\b`,
    read: (m) => ({ m: monthOf(m[1]) }),
  },
  {
    // A bare year. Only ever reached when the phrase names it too.
    source: "\\b(1\\d{3}|20\\d{2})\\b",
    read: (m) => ({ y: Number(m[1]) }),
  },
];

interface ScanOptions {
  /**
   * Drop a bare "may" that is the modal verb rather than the month — and
   * "march", and "august". The month word alone is genuinely ambiguous in
   * English prose, and the article says "why couldn't they" three sentences
   * from "During May". Capitalisation is what separates them, and it is only
   * consulted on the block: a model that lowercases its own copy of the phrase
   * is still allowed to select a capitalised month.
   */
  bareMonthsMustBeCapitalised: boolean;
}

function overlapsAccepted(accepted: RawDate[], start: number, end: number): boolean {
  return accepted.some((a) => start < a.end && a.start < end);
}

function scanDates(text: string, options: ScanOptions): RawDate[] {
  const accepted: RawDate[] = [];
  for (const pattern of DATE_PATTERNS) {
    // A fresh regex per scan: a module-level /g/ regex carries `lastIndex`
    // between calls, and this function is called twice per event.
    const re = new RegExp(pattern.source, "gi");
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlapsAccepted(accepted, start, end)) continue;
      const parts = pattern.read(m);
      if (!parts || (parts.m === undefined && parts.y === undefined)) continue;
      const capitalised = /^[A-Z]/.test(m[0]);
      const bareMonth = parts.m !== undefined && parts.d === undefined && parts.y === undefined;
      if (bareMonth && options.bareMonthsMustBeCapitalised && !capitalised) continue;
      accepted.push({ start, end, capitalised, ...parts });
    }
  }
  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}

/**
 * Do these two expressions name the same date?
 *
 * Every component the phrase states must equal the block's. A component only
 * one of them states is not a disagreement — the block may write "2026-07-19"
 * where the model wrote "July 19" — but a component they *both* state and
 * disagree on is, and that is what stops `July 1` selecting `July 11`.
 */
function sameDate(want: RawDate, have: RawDate): boolean {
  if (want.m !== have.m) return false;
  if (want.d !== have.d) return false;
  if (want.y !== undefined && have.y !== undefined && want.y !== have.y) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Resolving one expression to an interval
// ---------------------------------------------------------------------------

/**
 * The days one expression covers. "July 7" is one day wide; "May" is
 * thirty-one, and that width is where month precision lives — there is no
 * `granularity` field, because the interval already says it.
 *
 * Both edges are kept rather than just a point, because an exclusive bound
 * needs the right one: "before May" is the day before the 1st, not the day
 * before the 31st.
 */
interface Atom {
  start: string;
  /** Inclusive. */
  end: string;
  yearFilled: boolean;
}

/** The days this expression would cover in `year`, or null if it cannot. */
function intervalIn(year: number, raw: RawDate): { start: string; end: string } | null {
  if (raw.m === undefined) {
    const start = isoOf(year, 1, 1);
    const end = isoOf(year, 12, 31);
    return start && end ? { start, end } : null;
  }
  if (raw.d === undefined) {
    const start = isoOf(year, raw.m, 1);
    const end = isoOf(year, raw.m, daysInMonth(year, raw.m));
    return start && end ? { start, end } : null;
  }
  const day = isoOf(year, raw.m, raw.d);
  return day === null ? null : { start: day, end: day };
}

/**
 * The year rule, and it is a decision rather than a detail (plan § The traps,
 * item 5).
 *
 * A stated year is used as stated. A year-less date takes **the nearest
 * instance on the side `direction` names** — by default the most recent one at
 * or before publication, so a piece published on 3 January mentioning December
 * means last December and not the December two years back. With no frame, no
 * year is guessed at all: the expression yields no date, which is the correct
 * answer rather than a plausible one.
 *
 * **It picks rather than widening.** An earlier draft spanned both candidate
 * years wherever a year-less date landed after publication, which is honest and
 * useless: a year-wide interval for something almost certainly last December
 * leaves the row with no date it can sensibly print. Greg's call that dates no
 * longer sort anything is what makes picking cheap — a wrong pick costs a wrong
 * label, not a wrong order.
 *
 * `"future"` is the case where the default is backwards, and it is the only
 * one: a January piece saying "in December we expect…" means the coming
 * December. Stage 2 has `modality` from the model and passes it.
 */
function resolveAtom(
  raw: RawDate,
  frame: string | null,
  direction: WhenDirection,
): Atom | WhenRefusal {
  if (raw.y !== undefined) {
    const only = intervalIn(raw.y, raw);
    return only === null ? "unparseablePhrase" : { ...only, yearFilled: false };
  }
  if (frame === null) return "noYearFrame";
  const frameYear = parseIsoDay(frame)?.y;
  if (frameYear === undefined) return "noYearFrame";

  /* The publication year first, then the year on the far side of it. An
     interval that straddles publication counts as this year's either way, so
     "During May" in a piece published mid-May is this May. */
  const here = intervalIn(frameYear, raw);
  const reaches =
    here !== null && (direction === "past" ? here.start <= frame : here.end >= frame);
  if (reaches && here !== null) return { ...here, yearFilled: true };

  const there = intervalIn(frameYear + (direction === "past" ? -1 : 1), raw);
  /* When the neighbouring year has no 29 February, fall back to the
     publication year's own — the only candidate left, and better than refusing
     a date the article plainly states. */
  const only = there ?? here;
  return only === null ? "unparseablePhrase" : { ...only, yearFilled: true };
}

// ---------------------------------------------------------------------------
// The words around the date
// ---------------------------------------------------------------------------

/**
 * What the words before a date do to it.
 *
 * `notUntil` is the one that reads backwards and it is deliberate: "did not
 * happen until July 13" says the event was **at or after** the 13th, which is a
 * lower bound. It sits with "by" and "before" in the prompt's list of *bounds*,
 * not of upper bounds, and rendering it as "at or before 13 July" would print
 * the opposite of what the article said.
 */
type CueKind =
  | "plain"
  | "extended"
  | "upperInclusive"
  | "upperExclusive"
  | "lowerInclusive"
  | "lowerExclusive";

/**
 * Longest and most specific first: `not … until` has to be tried before the
 * plain cues, because the winner is the match ending nearest the date and
 * "until" would otherwise be read alone.
 */
const CUES: { source: string; kind: CueKind }[] = [
  { source: "\\bnot\\b[^.;!?]{0,40}?\\buntil\\b", kind: "lowerInclusive" },
  { source: "\\bno\\s+earlier\\s+than\\b", kind: "lowerInclusive" },
  { source: "\\bno\\s+later\\s+than\\b", kind: "upperInclusive" },
  { source: "\\bover\\s+the\\s+course\\s+of\\b", kind: "extended" },
  { source: "\\bthroughout\\b", kind: "extended" },
  { source: "\\bduring\\b", kind: "extended" },
  { source: "\\ball\\s+through\\b", kind: "extended" },
  { source: "\\bprior\\s+to\\b", kind: "upperExclusive" },
  { source: "\\bearlier\\s+than\\b", kind: "upperExclusive" },
  { source: "\\bbefore\\b", kind: "upperExclusive" },
  { source: "\\bas\\s+of\\b", kind: "upperInclusive" },
  { source: "\\balready\\b", kind: "upperInclusive" },
  { source: "\\bup\\s+to\\b", kind: "upperInclusive" },
  { source: "\\bby\\b", kind: "upperInclusive" },
  { source: "\\bafter\\b", kind: "lowerExclusive" },
  { source: "\\blater\\s+than\\b", kind: "lowerExclusive" },
  { source: "\\bsince\\b", kind: "lowerInclusive" },
  { source: "\\bfrom\\b", kind: "lowerInclusive" },
  { source: "\\bon\\b", kind: "plain" },
  { source: "\\bin\\b", kind: "plain" },
  { source: "\\bat\\b", kind: "plain" },
];

/** The article's own hedges. They do not change the interval; they belong in
 * the phrase the reader is shown, because they are the article being careful. */
const HEDGES = ["at\\s+some\\s+point", "some\\s*time", "roughly", "approximately", "around"];

/** How far back to look for the words that govern a date. */
const LOOKBACK_CHARS = 64;

interface Cue {
  kind: CueKind;
  start: number;
}

/** Everything after the last sentence end, within the lookback. */
function governingWindow(text: string, at: number): { window: string; from: number } {
  const from = Math.max(0, at - LOOKBACK_CHARS);
  const raw = text.slice(from, at);
  let cut = 0;
  for (let i = 0; i < raw.length - 1; i++) {
    if (".;!?".includes(raw[i] ?? "") && /\s/.test(raw[i + 1] ?? "")) cut = i + 2;
  }
  return { window: raw.slice(cut), from: from + cut };
}

function lastMatch(source: string, window: string): { start: number; end: number } | null {
  const re = new RegExp(source, "gi");
  let best: { start: number; end: number } | null = null;
  for (let m = re.exec(window); m !== null; m = re.exec(window)) {
    best = { start: m.index, end: m.index + m[0].length };
  }
  return best;
}

/**
 * The cue nearest the date, reading right to left — so "at some point on
 * July 12" is governed by "on" rather than by "at", and "By the night of
 * July 8" by "by" rather than by nothing.
 *
 * A cue with another date between it and this one is dropped: in "By May 12 …
 * on May 26" the "by" belongs to the 12th, and lending it to the 26th would
 * turn a point into a bound.
 */
function cueBefore(text: string, at: number, dates: RawDate[]): Cue | null {
  const { window, from } = governingWindow(text, at);
  let best: Cue | null = null;
  let bestEnd = -1;
  for (const cue of CUES) {
    const hit = lastMatch(cue.source, window);
    if (hit === null || hit.end <= bestEnd) continue;
    bestEnd = hit.end;
    best = { kind: cue.kind, start: from + hit.start };
  }
  if (best === null) return null;
  const found = best;
  const interposed = dates.some((d) => d.start >= found.start && d.end <= at);
  return interposed ? null : found;
}

/** Extend the shown phrase left over a hedge, when only whitespace separates
 * them — "At some point on July 12" rather than "on July 12". */
function hedgeBefore(text: string, at: number): number | null {
  const { window, from } = governingWindow(text, at);
  for (const source of HEDGES) {
    const hit = lastMatch(source, window);
    if (hit === null) continue;
    if (!/^\s*$/.test(window.slice(hit.end))) continue;
    return from + hit.start;
  }
  return null;
}

const RANGE_CONNECTOR = /^\s*(?:through|thru|to|till|until|-|–|—)\s*$/i;
const RANGE_AND = /^\s*and\s*$/i;
const BETWEEN_BEFORE = /\bbetween\b[^.;!?]{0,20}$/i;

/**
 * Is the text between two dates a range connector?
 *
 * "and" only counts after "between", because "May 12 and the agents…" is not a
 * range and "between May 12 and May 26" is.
 */
function joinsARange(text: string, a: RawDate, b: RawDate): boolean {
  const between = text.slice(a.end, b.start);
  if (RANGE_CONNECTOR.test(between)) return true;
  return RANGE_AND.test(between) && BETWEEN_BEFORE.test(text.slice(0, a.start));
}

// ---------------------------------------------------------------------------
// The parse
// ---------------------------------------------------------------------------

function refuse(reason: WhenRefusal): WhenResult {
  return { ok: false, reason };
}

/**
 * Which of the block's dates the phrase means.
 *
 * Selection walks the phrase's expressions left to right, each time taking the
 * nearest unclaimed match in the block — so the second half of "from July 13
 * through July 19" picks the 19th that follows the 13th rather than an earlier
 * one somewhere else in the paragraph.
 */
function selectDates(wanted: RawDate[], found: RawDate[], anchorAt: number): RawDate[] | null {
  const taken: RawDate[] = [];
  let anchor = anchorAt;
  for (const want of wanted) {
    const candidates = found.filter((f) => !taken.includes(f) && sameDate(want, f));
    if (candidates.length === 0) return null;
    candidates.sort((x, y) => Math.abs(x.start - anchor) - Math.abs(y.start - anchor));
    const pick = candidates[0];
    if (!pick) return null;
    taken.push(pick);
    anchor = pick.end;
  }
  taken.sort((a, b) => a.start - b.start);
  return taken;
}

function inside(within: Span | undefined, date: RawDate): boolean {
  if (!within) return true;
  return date.start >= within.start && date.end <= within.end;
}

interface Bounds {
  earliest: string | null;
  latest: string | null;
  extent: "instant" | "extended";
}

function boundsFrom(atom: Atom, kind: CueKind): Bounds | null {
  switch (kind) {
    case "upperInclusive":
      return { earliest: null, latest: atom.end, extent: "instant" };
    case "upperExclusive": {
      const latest = shiftDay(atom.start, -1);
      return latest === null ? null : { earliest: null, latest, extent: "instant" };
    }
    case "lowerInclusive":
      return { earliest: atom.start, latest: null, extent: "instant" };
    case "lowerExclusive": {
      const earliest = shiftDay(atom.end, 1);
      return earliest === null ? null : { earliest, latest: null, extent: "instant" };
    }
    case "extended":
      return { earliest: atom.start, latest: atom.end, extent: "extended" };
    default:
      return { earliest: atom.start, latest: atom.end, extent: "instant" };
  }
}

/**
 * Read a date out of a block's characters, or say why not.
 *
 * `parseWhen` is the same thing with the reason thrown away; the stage wants
 * the reason, because a phrase we could not read and a phrase that never
 * carried a date must not render as the same row
 * (plan § Three outcomes, not two).
 */
export function readWhen(input: WhenInput): WhenResult {
  const { text, phrase, blockId, within } = input;
  if (typeof text !== "string" || typeof phrase !== "string") return refuse("unparseablePhrase");
  if (phrase.trim() === "") return refuse("noDateInPhrase");
  if (phrase.length > MAX_PHRASE_CHARS) return refuse("unparseablePhrase");

  const wanted = scanDates(phrase, { bareMonthsMustBeCapitalised: false });
  if (wanted.length === 0) return refuse("noDateInPhrase");
  if (wanted.length > MAX_PHRASE_ATOMS) return refuse("unparseablePhrase");

  const all = scanDates(text, { bareMonthsMustBeCapitalised: true });
  const found = all.filter((d) => inside(within, d));
  const dates = selectDates(wanted, found, within?.start ?? 0);
  if (dates === null) return refuse("phraseNotInOccurrence");

  const frame = dayFrame(input.frame);
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return refuse("unparseablePhrase");

  const isRange = dates.length === 2 && joinsARange(text, first, last);
  if (dates.length > 1 && !isRange) return refuse("unparseablePhrase");

  const cue = cueBefore(text, first.start, all);
  const kind: CueKind = isRange ? "extended" : (cue?.kind ?? "plain");

  const direction = input.direction ?? "past";
  const early = resolveAtom(first, frame, direction);
  if (typeof early === "string") return refuse(early);
  const late = isRange ? resolveAtom(last, frame, direction) : early;
  if (typeof late === "string") return refuse(late);

  const bounds = boundsFrom(isRange ? { ...early, end: late.end } : early, kind);
  if (bounds === null) return refuse("unparseablePhrase");

  const from = cue?.start ?? first.start;
  const start = hedgeBefore(text, from) ?? from;
  return {
    ok: true,
    when: {
      earliest: bounds.earliest,
      latest: bounds.latest,
      extent: bounds.extent,
      phrase: text.slice(start, last.end),
      at: { blockId, start, end: last.end },
      yearFilled: early.yearFilled || late.yearFilled,
    },
  };
}

/** `readWhen` with the reason dropped. */
export function parseWhen(input: WhenInput): When | null {
  const result = readWhen(input);
  return result.ok ? result.when : null;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * Predictions and hypotheticals sort after everything that happened, and share
 * one partition because the panel draws one divider between history and what
 * the piece expects. A hypothetical is not a *different* kind of not-yet than a
 * prediction as far as the reader's eye running down the column is concerned.
 */
const MODALITY_RANK: Record<TimelineModality, number> = {
  happened: 0,
  predicted: 1,
  hypothetical: 1,
};

/**
 * An unusable `order` sorts last within its partition rather than first. A row
 * the model could not place has no claim on the top of the list, and index
 * breaks the tie so the result is still deterministic.
 *
 * **`null` is in the type because it is what reaches disk.** The stage stores
 * `null` for an event the model did not number — `NaN` would be the obvious
 * in-memory choice and `JSON.stringify` writes it as `null` anyway, so a field
 * typed `number` would have been a lie the moment the artefact was read back.
 * GPT Sol found it in the artefact rather than in the code, 2026-08-31.
 */
function orderKey(order: number | null): number {
  return typeof order === "number" && Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
}

/**
 * The whole sort: modality partition, then the model's `order`, then the
 * event's own index.
 *
 * **Dates do not move anything** — Greg's call, 2026-08-31
 * (plan § Ordering). An event known only to be "by 4 July" may have happened on
 * the 1st, and sorting it to the 4th would assert otherwise. The dates are
 * still compared, by `countOrderConflicts`, as a check on the model rather than
 * as a sort key.
 */
export function orderEvents<T extends { order: number | null; modality: TimelineModality }>(
  events: readonly T[],
): T[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const rank = (MODALITY_RANK[a.event.modality] ?? 1) - (MODALITY_RANK[b.event.modality] ?? 1);
      if (rank !== 0) return rank;
      const order = orderKey(a.event.order) - orderKey(b.event.order);
      if (order !== 0) return order;
      return a.index - b.index;
    })
    .map((entry) => entry.event);
}

/**
 * Pairs where the article's own dates **prove** an order and the model's
 * `order` says the opposite.
 *
 * Changes nothing on screen. It is the only signal we get that the model has
 * misread the chronology, and the test article is the reason to want it: it
 * recounts the same three months three times, once per civilisation, and says
 * out loud that it is getting ahead of the story. A high count there may be the
 * mode working; a high count on a plainly linear article is the mode failing,
 * and without the counter those look identical.
 *
 * Only within a modality partition, because `order` does not decide anything
 * across one — a prediction sorts after history whatever its number says, so an
 * inversion there is not evidence of a misreading.
 *
 * Proof is strict: intervals are closed, so `A.latest < B.earliest` means A had
 * finished before B could start. Same-day and merely-overlapping intervals
 * prove nothing and are not counted.
 */
export function countOrderConflicts<
  T extends { order: number | null; modality: TimelineModality; when: When | null },
>(events: readonly T[]): number {
  let conflicts = 0;
  for (let i = 0; i < events.length; i++) {
    for (let j = 0; j < events.length; j++) {
      if (i === j) continue;
      const a = events[i];
      const b = events[j];
      if (!a || !b) continue;
      if (MODALITY_RANK[a.modality] !== MODALITY_RANK[b.modality]) continue;
      const before = a.when?.latest;
      const after = b.when?.earliest;
      if (!before || !after || !(before < after)) continue;
      if (orderKey(a.order) > orderKey(b.order)) conflicts++;
    }
  }
  return conflicts;
}

// ---------------------------------------------------------------------------
// The marks
// ---------------------------------------------------------------------------

/**
 * The three slots of the notation, left to right — a bound or an opening on
 * each side, and the event between them (plan § The marks).
 *
 * Compositional rather than a name per glyph, because that is what the notation
 * is: five legend rows are five compositions of these three, and the sixth case
 * the legend does not draw — an open-ended span, "lasted over a month until…" —
 * composes too, which a fixed list of names would have had no room for.
 */
export interface Mark {
  /** Is there a bound on the earlier side? */
  earlier: "bound" | "open";
  /** `bar` when the event fills the interval; `rejected` is the ⊘ case. */
  body: "dot" | "bar" | "rejected";
  /** Is there a bound on the later side? */
  later: "bound" | "open";
}

/**
 * What to draw for one row.
 *
 * `dateRejected` is the third outcome: the piece dates this and we could not
 * read the date. It must not look like a row the piece never dated, or "fails
 * visibly" is only true inside a counter.
 */
export function markFor(when: When | null, dateRejected = false): Mark {
  if (dateRejected) return { earlier: "bound", body: "rejected", later: "bound" };
  if (when === null) return { earlier: "open", body: "dot", later: "open" };
  return {
    earlier: when.earliest === null ? "open" : "bound",
    body: when.extent === "extended" ? "bar" : "dot",
    later: when.latest === null ? "open" : "bound",
  };
}
