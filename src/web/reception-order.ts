/**
 * **How each of Debate's two lists is arranged, which orders Reception can
 * honestly offer, and the relevance bar that goes with Claims.** Pure, and
 * apart from the panel so the rules can be read and tested without a DOM —
 * faq-order.ts's reason.
 *
 * Greg, 2026-09-29 (SPIDERYARN-READING2-5P):
 *
 * > And add some UI to filter at the top of Debate mode (take inspiration from
 * > Glossary), e.g. chronological order; positivity, relevance, and a
 * > prioritised mode (default) with thresholding. Use your judgment.
 *
 * That was four orders over one mixed list. Since 2026-10-03 the two searches
 * are two sub-modes (docs/plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md),
 * and each has its own arrangement:
 *
 *  - **Claims** is always grouped by claim, in **article order**, each group
 *    headed by the claim's own words (`groupByClaim`). Within a claim, the rows
 *    the AI judged to bear most directly come first (`bears`) and the ones it
 *    did not judge last, in search order. There is no order control, and
 *    `?debateby=` is ignored. The relevance bar (`?bears=`) filters these rows.
 *  - **Reception** has three orders, `?debateby=`, each applied **within** its
 *    two identification groups (reception-levels.ts):
 *     - **prioritised** (*as found*, the default and absent from the address) —
 *       the order the search found them in. The word in the address is from
 *       when this order sorted claim rows by `bears`; kept so old links hold.
 *     - **date** — oldest first by `rowYear` (the registry's year, else
 *       `publishedYear`), undated last, with a marker at the article's own year.
 *     - **stance** — critical first, then *could not tell*, *neither*,
 *       *supportive*.
 *
 * `claim` was a fourth order until then. An old `?debateby=claim` is rewritten
 * to `?debate=claims` before anything parses it (router.ts §
 * `liftLegacyDebateBy`), so nothing here knows the word.
 *
 * ## Why a heading here is not the heading ReceptionAndClaimsPanel refused
 *
 * The panel used to refuse group headings outright, and it was right about the
 * one it refused: grouping by `relation` would put *the model's reading of a
 * stranger's page* in a heading, where it reads as a claim we stand behind. A
 * claim heading is **the article's own words, located in its block** —
 * `claimQuote` was checked against the block it names before the row was kept
 * (src/reception.ts). Structure by what we can verify; keep the model's readings
 * inside rows. So *stance* is an **order, never a grouping**: its rows are
 * flat, and nothing above them says *critical* in our voice. *Date* is flat
 * too; the only line inside it says what is **missing** — *no year found* —
 * which is a fact about the row, not a reading of the page.
 *
 * ## The two rules, both Glossary's
 *
 *  1. **An order that needs data this debate does not have is not offered, and
 *     asking for it draws *as found*** (`effectiveReceptionOrder`, Glossary's
 *     `effectiveSort`; 260929h's F6).
 *  2. **An order that would draw exactly what another one draws is not offered
 *     either** (`receptionOrderOptions`, 260929h's F14): two buttons that give
 *     the same list teach a reader the control does nothing. Fewer than two
 *     distinct orders is no bar at all.
 *
 * **The stage-2 fields are read off `object`, never off the typed row.** A
 * stored row is never revalidated, and an older one carries none of them. So
 * every read here copes with the field being absent or nonsense.
 *
 * **Search order is the tie-break everywhere**, and it is never re-sorted by
 * identification level — the chip on a direct row already says that.
 */
import type { BlockId, SourcesClaimsBears, ReceptionLean, RegistryWork } from "../types.js";
import { readStoredBears, readStoredLean } from "../types.js";
import { readRegistryWork } from "../registry-work.js";
import { applyThreshold, type ThresholdResult } from "./threshold.js";

/**
 * Reception's three orders. `params.ts` imports this **as a type only** and
 * spells the list itself, so this module stays off the reader's eager startup
 * path — the arrangement faq-order.ts § FaqOrder records.
 */
export type ReceptionOrder = "prioritised" | "date" | "stance";

/**
 * **The order the orders are preferred in** when two would draw the same list:
 * the earlier one is kept. Also the order of the buttons.
 */
export const RECEPTION_ORDER_PREFERENCE: readonly ReceptionOrder[] = ["prioritised", "date", "stance"];

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
 * **One piece of a Reception list, as the panel draws it.**
 *
 *  - `flat` — rows with no heading: every row in *as found* and *stance*, the
 *    dated rows in *date*.
 *  - `undated` — *date* only: rows with no year found, last, in search order.
 *  - `marker` — *date* only: where the article's own year falls. No rows.
 */
export type ReceptionGroup<R> =
  | { kind: "flat"; rows: R[] }
  | { kind: "undated"; rows: R[] }
  | { kind: "marker"; year: number; rows: never[] };

/** The rows answering one claim, headed by its own words — Claims' one kind of group. */
export interface ClaimGroup<C> {
  claimQuote: string;
  blockId: BlockId;
  rows: C[];
}

/**
 * **A row's `bears`, or null** — `readStoredBears` over any shape, so a
 * visitor's row is read the same way as the owner's.
 */
export function readBears(row: object): SourcesClaimsBears | null {
  return readStoredBears(row as { bears?: unknown });
}

/**
 * **A row's `publishedYear`, or null** — a four-digit integer and nothing else
 * (260929h's F1: a year, not a date).
 */
export function readPublishedYear(row: object): number | null {
  const value = (row as { publishedYear?: unknown }).publishedYear;
  return typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= 9999
    ? value
    : null;
}

/**
 * **A row's registry record, or null** (plan 261001a stage 6) — rebuilt by
 * `readRegistryWork`, so a stored row in any shape reads as a record or as
 * nothing.
 */
export function readRowRegistry(row: object): RegistryWork | null {
  return readRegistryWork((row as { registry?: unknown }).registry);
}

/**
 * **The year a row is dated by**: the registry's, where the row's address
 * carried an identifier whose record agreed with the page's title, else
 * `publishedYear`. The *date* order sorts on this and nothing else.
 */
export function rowYear(row: object): number | null {
  return readRowRegistry(row)?.year ?? readPublishedYear(row);
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
const STANCE_RANK: Record<ReceptionLean, number> = {
  "leans-against": 0,
  "cannot-tell": 1,
  neither: 2,
  "leans-for": 3,
};

/**
 * **`bears` as a position — weakest first**, which is left-to-right on the
 * relevance bar and the direction `applyThreshold` needs (keep `>=`). Internal
 * machinery, never shown and never in the URL: `?bears=` carries the word.
 */
const BEARS_RANK: Record<SourcesClaimsBears, number> = { loosely: 0, partly: 1, directly: 2 };

/** The relevance bar's stops, weakest first — left shows everything. */
export const RELEVANCE_STOPS: readonly SourcesClaimsBears[] = ["loosely", "partly", "directly"];

/**
 * **Where the relevance bar sits untouched: `loosely`, which hides nothing.**
 * `bears` is a new model judgment nobody has evaluated yet, so a default that
 * hid rows on it would be hiding them on an unchecked score (260929h's F5).
 * Tightening this waits for a labelled evaluation.
 */
export const RELEVANCE_DEFAULT: SourcesClaimsBears = "loosely";

/** Where a stop sits on the track, and the stop at a track position. */
export function relevanceIndex(stop: SourcesClaimsBears): number {
  return BEARS_RANK[stop];
}
export function relevanceAt(index: number): SourcesClaimsBears {
  return RELEVANCE_STOPS[index] ?? RELEVANCE_DEFAULT;
}

/**
 * **The relevance bar applied to the claim rows, once** — the one pass the
 * list, the `N of M` and the `hiddenNote` all read (threshold.ts's argument).
 *
 * **Claim rows only**: `bears` is how directly a page bears on *its claim*, and
 * a row about the piece has no claim. **A row the AI did not judge always
 * survives** — `survivesThreshold`'s rule, and the lossless direction: an
 * absent judgment is not a low one.
 */
export function visibleClaims<C extends object>(rows: readonly C[], stop: SourcesClaimsBears): ThresholdResult<C> {
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
 * **Claims' list: one group per claim identity `(blockId, claimQuote)`, in
 * article order** — 260929h's F9. Two quotes in one block are two groups; rows
 * that share a page stay separate rows, each under its own claim.
 *
 * `blockOrder` is each block's position in the article, handed down from
 * `Reader` (260929h's F8); a claim in a block it does not know, or one of two
 * claims in the same block, keeps the order the search first gave it.
 *
 * **Within a claim, most directly bearing first, the unjudged last**, search
 * order within each — what *prioritised* did across the whole list until
 * 2026-10-03. A row from before `bears` existed is simply an unjudged one.
 *
 * `claims` is the rows the relevance bar and the thread left, when the panel
 * calls this. It is not modified.
 */
export function groupByClaim<C extends ClaimLikeRow>(
  claims: readonly C[],
  blockOrder: ReadonlyMap<BlockId, number>,
): ClaimGroup<C>[] {
  const groups = new Map<string, ClaimGroup<C>>();
  for (const row of claims) {
    /* A NUL between the two halves, which neither a block id nor a located
       quotation can contain, so no pair can collide with another. */
    const key = `${row.blockId}\u0000${row.claimQuote}`;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { claimQuote: row.claimQuote, blockId: row.blockId, rows: [row] });
  }
  return stableBy([...groups.values()], (g) => blockOrder.get(g.blockId) ?? Number.POSITIVE_INFINITY).map(
    (g) => ({
      ...g,
      rows: stableBy(g.rows, (r) => {
        const bears = readBears(r);
        return bears === null ? Number.POSITIVE_INFINITY : -BEARS_RANK[bears];
      }),
    }),
  );
}

/** Is the data behind this order there at all? Rule 1 in the header. */
function hasDataFor(order: ReceptionOrder, rows: readonly object[]): boolean {
  switch (order) {
    case "date":
      return rows.some((r) => rowYear(r) !== null);
    case "prioritised":
    case "stance":
      return true;
    default: {
      const unreachable: never = order;
      return unreachable;
    }
  }
}

/** Only the groups that have something in them; a marker always counts. */
function nonEmpty<R>(groups: ReceptionGroup<R>[]): ReceptionGroup<R>[] {
  return groups.filter((g) => g.kind === "marker" || g.rows.length > 0);
}

/**
 * **One of Reception's two groups in one order**, as the pieces the panel
 * draws. `rows` is not modified.
 *
 * `articleYear` is the year the article gives for itself, for *date*'s marker,
 * or null for no marker.
 */
export function orderReceptionRows<R extends OrderableRow>(
  rows: readonly R[],
  order: ReceptionOrder,
  articleYear: number | null = null,
): ReceptionGroup<R>[] {
  switch (order) {
    case "prioritised":
      return nonEmpty<R>([{ kind: "flat", rows: [...rows] }]);
    case "stance":
      return nonEmpty<R>([{ kind: "flat", rows: stableBy(rows, (r) => STANCE_RANK[readStoredLean(r)]) }]);
    case "date":
      return byDate(rows, articleYear);
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
 * it without the list claiming it came after (260929h's F1: a year cannot
 * order two things inside itself). With no dated row that late, it goes after
 * the last dated one. **With no dated row at all there is no marker**:
 * Reception draws two groups, each ordered here on its own, and a marker over a
 * group of undated rows would mark a place in nothing.
 */
function byDate<R extends OrderableRow>(rows: readonly R[], articleYear: number | null): ReceptionGroup<R>[] {
  const dated = stableBy(
    rows.filter((r) => rowYear(r) !== null),
    (r) => rowYear(r) ?? 0,
  );
  const undated = rows.filter((r) => rowYear(r) === null);
  if (articleYear === null || dated.length === 0) {
    return nonEmpty<R>([
      { kind: "flat", rows: dated },
      { kind: "undated", rows: undated },
    ]);
  }
  const cut = dated.findIndex((r) => (rowYear(r) ?? 0) >= articleYear);
  const at = cut === -1 ? dated.length : cut;
  return nonEmpty<R>([
    { kind: "flat", rows: dated.slice(0, at) },
    { kind: "marker", year: articleYear, rows: [] },
    { kind: "flat", rows: dated.slice(at) },
    { kind: "undated", rows: undated },
  ]);
}

/**
 * **What a reader would see in one order, as a string** — the row ids in
 * order, section by section, plus the structure *date* adds: its marker and
 * its undated line.
 */
function signature<R extends OrderableRow>(
  sections: readonly (readonly R[])[],
  order: ReceptionOrder,
  articleYear: number | null,
): string {
  return sections
    .map((rows) =>
      orderReceptionRows(rows, order, articleYear)
        .map((g) => {
          const ids = g.rows.map((r) => r.id).join(",");
          if (g.kind === "marker") return `marker-${String(g.year)}`;
          return g.kind === "undated" ? `undated-${ids}` : ids;
        })
        .join("|"),
    )
    .join("||");
}

/**
 * The orders this debate has the data for **and** that draw something the
 * others do not, in preference order — each paired with its signature, so
 * `effectiveReceptionOrder` can find which offered order draws what a hidden
 * one would have. Never empty: *as found* always has its data and is first.
 */
function distinctOrders<R extends OrderableRow>(
  sections: readonly (readonly R[])[],
  articleYear: number | null,
): { order: ReceptionOrder; sig: string }[] {
  const all = sections.flat();
  const seen = new Set<string>();
  const out: { order: ReceptionOrder; sig: string }[] = [];
  for (const order of RECEPTION_ORDER_PREFERENCE) {
    if (!hasDataFor(order, all)) continue;
    const sig = signature(sections, order, articleYear);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ order, sig });
  }
  return out;
}

/**
 * **The orders Reception's bar offers**, in button order — or none, when fewer
 * than two would draw different lists (F14).
 *
 * `sections` is Reception's groups as drawn, in order (reception-levels.ts §
 * `receptionSections`): each order is applied within a group, so an order that
 * could only move a row past one in the *other* group changes nothing on
 * screen and is not offered.
 */
export function receptionOrderOptions<R extends OrderableRow>(
  sections: readonly (readonly R[])[],
  articleYear: number | null = null,
): ReceptionOrder[] {
  const distinct = distinctOrders(sections, articleYear);
  return distinct.length < 2 ? [] : distinct.map((d) => d.order);
}

/**
 * **The order Reception is actually drawn in**, which is not always the one
 * the URL asked for — Glossary's `effectiveSort`, and 260929h's F6.
 *
 *  - Asked for *date* on rows none of which carries a year → *as found*.
 *  - Asked for one that would draw the same list as an order preferred before
 *    it → that order, so the bar's pressed button is the list on screen.
 *
 * Same sections as `receptionOrderOptions`, for the same reason.
 */
export function effectiveReceptionOrder<R extends OrderableRow>(
  sections: readonly (readonly R[])[],
  requested: ReceptionOrder,
  articleYear: number | null = null,
): ReceptionOrder {
  const distinct = distinctOrders(sections, articleYear);
  if (distinct.some((d) => d.order === requested)) return requested;
  if (!hasDataFor(requested, sections.flat())) return "prioritised";
  const sig = signature(sections, requested, articleYear);
  return distinct.find((d) => d.sig === sig)?.order ?? "prioritised";
}
