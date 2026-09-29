/**
 * **The orders Debate's list can be drawn in, which of them a given debate can
 * honestly offer, and the relevance bar that goes with *prioritised*.** Pure,
 * and apart from the panel so the rules can be read and tested without a DOM —
 * faq-order.ts's reason.
 *
 * Greg, 2026-09-29 (SPIDERYARN-READING2-5P):
 *
 * > And add some UI to filter at the top of Debate mode (take inspiration from
 * > Glossary), e.g. chronological order; positivity, relevance, and a
 * > prioritised mode (default) with thresholding. Use your judgment.
 *
 * Four orders, `?debateby=` (docs/plans/260929h-debate-mode-clearer-sources-and-orders.md
 * § The order bar):
 *
 *  - **prioritised** — rows about this piece first, then claim rows by how
 *    directly the AI judged each one bears on its claim (`bears`), and the ones
 *    it did not judge last, in search order. Needs a claim row that carries
 *    `bears`, which only a `debate/3` search writes. The relevance bar
 *    (`?bears=`) filters claim rows in this order and no other.
 *  - **claim** (*by claim*) — rows about this piece as the first group, then one
 *    group per claim in **article order**, headed by the claim's own words.
 *    Needs nothing the artefact does not already have.
 *  - **date** — oldest first by `publishedYear`, undated last, with a marker at
 *    the article's own year. Needs a row that carries a year.
 *  - **stance** — critical first, then *could not tell*, *neither*,
 *    *supportive*. Needs nothing new.
 *
 * ## Why a heading here is not the heading DebatePanel refused
 *
 * The panel used to refuse group headings outright, and it was right about the
 * one it refused: grouping by `relation` would put *the model's reading of a
 * stranger's page* in a heading, where it reads as a claim we stand behind. A
 * *by claim* heading is **the article's own words, located in its block** —
 * `claimQuote` was checked against the block it names before the row was kept
 * (src/debate.ts). Structure by what we can verify; keep the model's readings
 * inside rows. So *stance* is an **order, never a grouping**: its rows are
 * flat, and nothing above them says *critical* in our voice. *Prioritised* and
 * *date* are flat too; the only lines inside them say what is **missing** —
 * *not judged*, *no year found* — which is a fact about the row, not a reading
 * of the page.
 *
 * ## The two rules, both Glossary's
 *
 *  1. **An order that needs data this debate does not have is not offered, and
 *     asking for it draws *by claim*** (`effectiveDebateOrder`, Glossary's
 *     `effectiveSort`; the plan's F6).
 *  2. **An order that would draw exactly what another one draws is not offered
 *     either** (`debateOrderOptions`, the plan's F14): two buttons that give the
 *     same list teach a reader the control does nothing. Fewer than two
 *     distinct orders is no bar at all.
 *
 * **The stage-2 fields are read off `object`, never off the typed row.** A
 * visitor's rows come through the public types, which do not carry them (the
 * DTO is a listed defence and does not pass them — the plan's § Deliberately
 * not in this), and a stored row is never revalidated. So every read here
 * copes with the field being absent or nonsense, and a visitor is offered *by
 * claim* and *stance* by construction.
 *
 * **Search order is the tie-break everywhere**, and it is never re-sorted by
 * identification level — the chip on a direct row already says that.
 */
import type { BlockId, DebateBears, DebateLean } from "../types.js";
import { readStoredBears, readStoredLean } from "../types.js";
import { applyThreshold, type ThresholdResult } from "./threshold.js";

/**
 * The four orders. `params.ts` imports this **as a type only** and spells the
 * list itself, so this module stays off the reader's eager startup path — the
 * arrangement faq-order.ts § FaqOrder records.
 */
export type DebateOrder = "prioritised" | "claim" | "date" | "stance";

/**
 * **The order the orders are preferred in** when two would draw the same list:
 * the earlier one is kept. Also the order of the buttons.
 */
export const DEBATE_ORDER_PREFERENCE: readonly DebateOrder[] = ["prioritised", "claim", "date", "stance"];

/** What every row this module orders has — the owner's row and a visitor's alike. */
export interface OrderableRow {
  id: string;
  /* `unknown`, both of them, because a stored row may carry the old `valence`
     and no `lean` — `readStoredLean` sorts that out. */
  lean?: unknown;
  valence?: unknown;
}

/** A row answering a claim the article makes — its identity is `(blockId, claimQuote)`. */
export interface ClaimLikeRow extends OrderableRow {
  claimQuote: string;
  blockId: BlockId;
}

/**
 * **One piece of the list, as the panel draws it.**
 *
 *  - `piece` — the rows about this piece (the direct search's), *by claim* only.
 *  - `claim` — the rows answering one claim, headed by its own words.
 *  - `flat` — rows with no heading: every row in *stance*, the judged and dated
 *    rows in *prioritised* and *date*.
 *  - `unjudged` — *prioritised* only: claim rows the AI gave no `bears`, last,
 *    in search order, under a line saying so. Never hidden by the bar.
 *  - `undated` — *date* only: rows with no year found, last, in search order.
 *  - `marker` — *date* only: where the article's own year falls. No rows.
 */
export type DebateGroup<D, C> =
  | { kind: "piece"; rows: D[] }
  | { kind: "claim"; claimQuote: string; blockId: BlockId; rows: C[] }
  | { kind: "flat"; rows: (D | C)[] }
  | { kind: "unjudged"; rows: C[] }
  | { kind: "undated"; rows: (D | C)[] }
  | { kind: "marker"; year: number; rows: never[] };

/**
 * **A row's `bears`, or null** — `readStoredBears` over any shape, so a
 * visitor's row (which has no such field in its type) is read the same way.
 */
export function readBears(row: object): DebateBears | null {
  return readStoredBears(row as { bears?: unknown });
}

/**
 * **A row's `publishedYear`, or null** — a four-digit integer and nothing else
 * (the plan's F1: a year, not a date).
 */
export function readPublishedYear(row: object): number | null {
  const value = (row as { publishedYear?: unknown }).publishedYear;
  return typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= 9999
    ? value
    : null;
}

/** A row's `workTitle`, or null when absent or blank. */
export function readWorkTitle(row: object): string | null {
  const value = (row as { workTitle?: unknown }).workTitle;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** A row's `authors`, the strings only, or an empty list. */
export function readAuthors(row: object): string[] {
  const value = (row as { authors?: unknown }).authors;
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is string => typeof a === "string" && a.trim() !== "");
}

/**
 * **The year in an article's `publishedAt`**, or null. The publisher's own
 * string (src/types.ts § `Meta.publishedAt`), so the leading four digits when
 * it starts with them, else whatever `Date.parse` makes of it.
 */
export function yearOf(publishedAt: unknown): number | null {
  if (typeof publishedAt !== "string") return null;
  const lead = /^\s*(\d{4})\b/.exec(publishedAt);
  if (lead?.[1]) return Number(lead[1]);
  const t = Date.parse(publishedAt);
  return Number.isNaN(t) ? null : new Date(t).getUTCFullYear();
}

/**
 * **Critical first**, because *interrogate* is what this mode is for; then the
 * two that take no side, *could not tell* before *neither*; supportive last.
 * A `Record` so a fifth lean is a compile error here.
 */
const STANCE_RANK: Record<DebateLean, number> = {
  "leans-against": 0,
  "cannot-tell": 1,
  neither: 2,
  "leans-for": 3,
};

/**
 * **`bears` as a position — weakest first**, which is left-to-right on the
 * relevance bar and the direction `applyThreshold` needs (keep `>=`). Internal
 * machinery, never shown and never in the URL: `?bears=` carries the word,
 * `debate-levels.ts`'s reason.
 */
const BEARS_RANK: Record<DebateBears, number> = { loosely: 0, partly: 1, directly: 2 };

/** The relevance bar's stops, weakest first — left shows everything. */
export const RELEVANCE_STOPS: readonly DebateBears[] = ["loosely", "partly", "directly"];

/**
 * **Where the relevance bar sits untouched: `loosely`, which hides nothing.**
 * `bears` is a new model judgment nobody has evaluated yet, so a default that
 * hid rows on it would be hiding them on an unchecked score (the plan's F5).
 * Tightening this waits for a labelled evaluation.
 */
export const RELEVANCE_DEFAULT: DebateBears = "loosely";

/** Where a stop sits on the track, and the stop at a track position. */
export function relevanceIndex(stop: DebateBears): number {
  return BEARS_RANK[stop];
}
export function relevanceAt(index: number): DebateBears {
  return RELEVANCE_STOPS[index] ?? RELEVANCE_DEFAULT;
}

/**
 * **The relevance bar applied to the claim rows, once** — the one pass the
 * list, the `N of M` and the `hiddenNote` all read (threshold.ts's argument).
 *
 * **Claim rows only**, and the signature is the guard: rows about this piece
 * belong to the identification bar, so the two bars own disjoint rows and
 * neither count can drift into the other's (the plan's F7). **A row the AI did
 * not judge always survives** — `survivesThreshold`'s rule, and the lossless
 * direction: an absent judgment is not a low one.
 */
export function visibleClaims<C extends object>(rows: readonly C[], stop: DebateBears): ThresholdResult<C> {
  return applyThreshold(rows, BEARS_RANK[stop], (row) => {
    const bears = readBears(row);
    return bears === null ? null : BEARS_RANK[bears];
  });
}

/** A stable sort by a key, `Infinity` last — `Array.prototype.sort` is stable. */
function stableBy<T>(rows: readonly T[], key: (row: T) => number): T[] {
  return rows
    .map((row, i) => ({ row, i, k: key(row) }))
    .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k < b.k ? -1 : 1))
    .map((x) => x.row);
}

/**
 * Is the data behind this order there at all? Rule 1 in the header.
 *
 * *Prioritised* asks the **claim** rows: `bears` orders and filters only them,
 * so a judgment on a row about this piece would offer an order that changes
 * nothing.
 */
function hasDataFor(order: DebateOrder, direct: readonly object[], claims: readonly object[]): boolean {
  switch (order) {
    case "prioritised":
      return claims.some((r) => readBears(r) !== null);
    case "date":
      return [...direct, ...claims].some((r) => readPublishedYear(r) !== null);
    case "claim":
    case "stance":
      return true;
    default: {
      const unreachable: never = order;
      return unreachable;
    }
  }
}

/** Only the groups that have something in them; a marker always counts. */
function nonEmpty<D, C>(groups: DebateGroup<D, C>[]): DebateGroup<D, C>[] {
  return groups.filter((g) => g.kind === "marker" || g.rows.length > 0);
}

/**
 * **The list in one order**, as groups.
 *
 * `direct` is the rows about this piece and `claims` the rows answering what it
 * claims — each already through its own bar, when the panel calls this.
 * Neither array is modified.
 *
 * `blockOrder` is each block's position in the article, handed down from
 * `Reader` (the plan's F8); a claim in a block it does not know, or in one of
 * two claims in the same block, keeps the order the search first gave it.
 * `articleYear` is the year the article gives for itself, for *date*'s marker,
 * or null for no marker.
 */
export function orderDebateRows<D extends OrderableRow, C extends ClaimLikeRow>(
  direct: readonly D[],
  claims: readonly C[],
  order: DebateOrder,
  blockOrder: ReadonlyMap<BlockId, number>,
  articleYear: number | null = null,
): DebateGroup<D, C>[] {
  switch (order) {
    case "claim":
      return byClaim(direct, claims, blockOrder);
    case "stance":
      return [{ kind: "flat", rows: stableBy<D | C>([...direct, ...claims], (r) => STANCE_RANK[readStoredLean(r)]) }];
    case "prioritised": {
      /* Rows about this piece lead, as they always have; then the judged claim
         rows, most directly bearing first; then the unjudged, in search order,
         under their own line (F6). */
      const judged = claims.filter((r) => readBears(r) !== null);
      const unjudged = claims.filter((r) => readBears(r) === null);
      const sorted = stableBy(judged, (r) => -BEARS_RANK[readBears(r) ?? "loosely"]);
      return nonEmpty<D, C>([
        { kind: "flat", rows: [...direct, ...sorted] },
        { kind: "unjudged", rows: unjudged },
      ]);
    }
    case "date":
      return byDate(direct, claims, articleYear);
    default: {
      const unreachable: never = order;
      return unreachable;
    }
  }
}

/**
 * *Date*: dated rows oldest first (same-year rows in search order), the
 * article's own year marked, undated rows last.
 *
 * **The marker goes before the first row whose year is the article's or
 * later**, and says only *"This piece, 2022"* — so a same-year row sits under
 * it without the list claiming it came after (the plan's F1: a year cannot
 * order two things inside itself). With no dated row that late, it goes after
 * the last dated one.
 */
function byDate<D extends OrderableRow, C extends ClaimLikeRow>(
  direct: readonly D[],
  claims: readonly C[],
  articleYear: number | null,
): DebateGroup<D, C>[] {
  const all: (D | C)[] = [...direct, ...claims];
  const dated = stableBy(
    all.filter((r) => readPublishedYear(r) !== null),
    (r) => readPublishedYear(r) ?? 0,
  );
  const undated = all.filter((r) => readPublishedYear(r) === null);
  if (articleYear === null) {
    return nonEmpty<D, C>([
      { kind: "flat", rows: dated },
      { kind: "undated", rows: undated },
    ]);
  }
  const cut = dated.findIndex((r) => (readPublishedYear(r) ?? 0) >= articleYear);
  const at = cut === -1 ? dated.length : cut;
  return nonEmpty<D, C>([
    { kind: "flat", rows: dated.slice(0, at) },
    { kind: "marker", year: articleYear, rows: [] },
    { kind: "flat", rows: dated.slice(at) },
    { kind: "undated", rows: undated },
  ]);
}

/**
 * *By claim*: the rows about this piece, then one group per claim identity
 * `(blockId, claimQuote)` — the plan's F9. Two quotes in one block are two
 * groups; rows that share a page stay separate rows, each under its own claim.
 */
function byClaim<D extends OrderableRow, C extends ClaimLikeRow>(
  direct: readonly D[],
  claims: readonly C[],
  blockOrder: ReadonlyMap<BlockId, number>,
): DebateGroup<D, C>[] {
  const groups = new Map<string, { claimQuote: string; blockId: BlockId; rows: C[] }>();
  for (const row of claims) {
    /* A NUL between the two halves, which neither a block id nor a located
       quotation can contain, so no pair can collide with another. */
    const key = `${row.blockId}\u0000${row.claimQuote}`;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { claimQuote: row.claimQuote, blockId: row.blockId, rows: [row] });
  }
  const claimGroups = stableBy([...groups.values()], (g) => blockOrder.get(g.blockId) ?? Number.POSITIVE_INFINITY);
  const out: DebateGroup<D, C>[] = [];
  if (direct.length > 0) out.push({ kind: "piece", rows: [...direct] });
  for (const g of claimGroups) {
    out.push({ kind: "claim", claimQuote: g.claimQuote, blockId: g.blockId, rows: g.rows });
  }
  return out;
}

/**
 * **What a reader would see in one order, as a string** — the row ids in order,
 * plus the boundaries between headings when there is more than one. One group
 * under one heading is not structure, so it compares equal to the same rows
 * flat; the lines inside *prioritised* and *date* mark where rows went, which
 * the id sequence already carries.
 */
function signature(groups: readonly DebateGroup<OrderableRow, ClaimLikeRow>[]): string {
  const headed = groups.filter((g) => g.kind === "piece" || g.kind === "claim");
  if (headed.length > 1) return headed.map((g) => g.rows.map((r) => r.id).join(",")).join("|");
  return groups.flatMap((g) => g.rows.map((r) => r.id)).join(",");
}

/**
 * The orders this debate has the data for **and** that draw something the
 * others do not, in preference order — each paired with its signature, so
 * `effectiveDebateOrder` can find which offered order draws what a hidden one
 * would have. Never empty: *by claim* always has its data.
 *
 * Signatures are taken with no bar applied and no marker: the question is what
 * the order does to this debate, not where two sliders happen to sit.
 */
function distinctOrders<D extends OrderableRow, C extends ClaimLikeRow>(
  direct: readonly D[],
  claims: readonly C[],
  blockOrder: ReadonlyMap<BlockId, number>,
): { order: DebateOrder; sig: string }[] {
  const seen = new Set<string>();
  const out: { order: DebateOrder; sig: string }[] = [];
  for (const order of DEBATE_ORDER_PREFERENCE) {
    if (!hasDataFor(order, direct, claims)) continue;
    const sig = signature(orderDebateRows(direct, claims, order, blockOrder));
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ order, sig });
  }
  return out;
}

/**
 * **The orders the bar offers**, in button order — or none, when fewer than two
 * would draw different lists (F14).
 *
 * The panel hands this **every** row the debate kept, not the rows the bars
 * left: an order button that appeared and vanished as the reader dragged a
 * different control would be worse than either (Glossary's `sortOptions` makes
 * the same call about its own slider).
 */
export function debateOrderOptions<D extends OrderableRow, C extends ClaimLikeRow>(
  direct: readonly D[],
  claims: readonly C[],
  blockOrder: ReadonlyMap<BlockId, number>,
): DebateOrder[] {
  const distinct = distinctOrders(direct, claims, blockOrder);
  return distinct.length < 2 ? [] : distinct.map((d) => d.order);
}

/**
 * **The order the list is actually drawn in**, which is not always the one the
 * URL asked for — Glossary's `effectiveSort`, and the plan's F6.
 *
 *  - Asked for an order this debate has no data for (prioritised or date on
 *    anything before `debate/3`, or on a visitor's rows) → *by claim*.
 *  - Asked for one that would draw the same list as an order preferred before
 *    it → that order, so the bar's pressed button is the list on screen.
 *
 * Same rows as `debateOrderOptions`, for the same reason.
 */
export function effectiveDebateOrder<D extends OrderableRow, C extends ClaimLikeRow>(
  direct: readonly D[],
  claims: readonly C[],
  requested: DebateOrder,
  blockOrder: ReadonlyMap<BlockId, number>,
): DebateOrder {
  if (!hasDataFor(requested, direct, claims)) return "claim";
  const distinct = distinctOrders(direct, claims, blockOrder);
  if (distinct.some((d) => d.order === requested)) return requested;
  const sig = signature(orderDebateRows(direct, claims, requested, blockOrder));
  return distinct.find((d) => d.sig === sig)?.order ?? "claim";
}
