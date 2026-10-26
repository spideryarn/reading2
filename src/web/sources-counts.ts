/**
 * **The numbers on Sources' chips, and the rows behind them** —
 * pure selectors, used by the chip row (SourcesMode.tsx §
 * `SourcesViews`) and by the panels that draw the lists (BibliographyPanel,
 * NotCitedPanel, LinksPanel, ReceptionAndClaimsPanel), so a chip's number and the list under it are one derivation
 * and cannot disagree. GPT Sol's F4 on
 * docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md: the
 * counts used to be worked out inside each panel, where the wrapper drawing
 * one chip row for both could not reach them, and a simplified copy of them
 * in the wrapper would have changed what the numbers mean.
 *
 * What each number counts is unchanged from the two modes:
 *
 * - **Bibliography**: the works cited, every one — the number Bibliography's (i)
 *   gave ("12 works cited"), not the rows its threshold leaves.
 * - **Not cited**: the rows OpenAlex's search left once the bibliography was
 *   taken out — no number until the owner's stored answer is read, and never
 *   one for a visitor, who has no such chip.
 * - **Links**: distinct external addresses in the article's own markup.
 * - **Reception**: every stored row about the piece. Since plan 261020n
 *   (spya-dk4tfq) a thread no longer narrows Reception: its themes and key
 *   sources are sections the reader opens, and *Every page* holds every row,
 *   so the chip counts what *Every page* lists. `?receptionthread=` opens a
 *   section there and moves no number.
 * - **Claims**: the listed claims, until the reader's checks have put
 *   sources on screen, and then those sources plus any rows an older search
 *   kept (plan 261008i § 5); with no list, the older search's rows through
 *   the relevance bar and the thread.
 * - **Investigate** has no number: there is nothing to count before a press, and its
 *   *Your questions* is not a list the chip should number (plan 261020n).
 *
 * Imports no React, so a test can call it on fixtures alone.
 */
import type {
  PublicClaimReceptionRow,
  PublicReception,
  PublicSourcesClaimList,
  PublicDirectReceptionRow,
} from "../public-types.js";
import type {
  Reception,
  RelatedWorkResult,
  SourcesClaimsBears,
  SourcesClaimCheck,
  SourcesClaimList,
  ListedClaim,
} from "../types.js";
import { readStoredSynthesis } from "../reception-synthesis.js";
import { checkedRowCount, drawChecks } from "./sources-claim-checks.js";
import { RELEVANCE_DEFAULT, visibleClaims } from "./reception-order.js";
import { inThread, selectedThread, type Thread, threadsOf, threadsWithin } from "./reception-threads.js";
import type { ThresholdResult } from "./threshold.js";

/** Either arm's stored Reception: the owner's, or a visitor's public projection. */
type AnyReception = Reception | PublicReception;
/* The public row types are the narrower shape, and every owner's row is one
   of them (ReceptionAndClaimsPanel.tsx § `DirectRow`). */
type DirectRow = PublicDirectReceptionRow;
type ClaimRow = PublicClaimReceptionRow;

const NO_DIRECT: readonly DirectRow[] = [];
const NO_CLAIMS: readonly ClaimRow[] = [];

/** Reception's threads, from its stored synthesis, read the one checked way (reception-synthesis.ts). */
export function receptionThreads(reception: AnyReception | null): Thread[] {
  return threadsOf(reception !== null ? readStoredSynthesis(reception) : null);
}

/** One of Reception's AI sections: a theme, or the key sources, and the stored rows it names. */
export interface ReceptionSection {
  thread: Thread;
  rows: DirectRow[];
}

/**
 * **Reception, as sections** (plan 261020n): every stored row, which is what
 * *Every page* lists and the chip counts, and each thread **with a stored row
 * here** as a section of its own (`threadsWithin`, GPT Sol's F4 on that plan —
 * a theme made only of an older search's claim rows is neither drawn nor
 * counted in Reception). A row is in every section that names it, so the
 * sections' counts may add up to more than the chip's.
 */
export interface ReceptionSelection {
  rows: DirectRow[];
  sections: ReceptionSection[];
}

export function receptionSelection(reception: AnyReception | null, threads: readonly Thread[]): ReceptionSelection {
  const rows: readonly DirectRow[] = reception?.direct.rows ?? NO_DIRECT;
  return {
    rows: [...rows],
    sections: threadsWithin(threads, rows).map((thread) => ({ thread, rows: inThread(rows, thread) })),
  };
}

/**
 * **An older search's claim rows, through the relevance bar and then the
 * thread** — one pass, so the list, the bar's *N of M* and the count come out
 * of the same result (threshold.ts).
 */
export interface ClaimsSelection {
  barred: ThresholdResult<ClaimRow>;
  threads: Thread[];
  thread: Thread | null;
  shown: ClaimRow[];
}

export function claimsSelection(
  reception: AnyReception | null,
  threads: readonly Thread[],
  relevance: SourcesClaimsBears | null,
  threadParam: string | null,
): ClaimsSelection {
  const rows: readonly ClaimRow[] = reception?.claims.rows ?? NO_CLAIMS;
  const barred = visibleClaims(rows, relevance ?? RELEVANCE_DEFAULT);
  const within = threadsWithin(threads, rows);
  const thread = selectedThread(within, threadParam);
  return { barred, threads: within, thread, shown: inThread(barred.visible, thread) };
}

/** The sources the reader's own checks put on screen, over the current list (sources-claim-checks.ts). */
export function checkedSources(checks: readonly SourcesClaimCheck[], list: SourcesClaimList | null): number {
  return list === null ? 0 : checkedRowCount(drawChecks(checks, list));
}

/** **Claims' number, and what it counts.** */
export interface ClaimsCount {
  n: number;
  unit: "claim" | "source";
}

export function claimsCount(
  listed: readonly ListedClaim[] | null,
  checked: number,
  olderShown: number,
): ClaimsCount {
  if (checked > 0) return { n: checked + olderShown, unit: "source" };
  if (listed !== null) return { n: listed.length, unit: "claim" };
  return { n: olderShown, unit: "source" };
}

/** **The chips' numbers.** Bibliography's and Not cited's are `null` while there is no list to count. */
export interface SourcesCounts {
  bibliography: number | null;
  /** Not cited's rows, once a stored search is read (NotCitedPanel.tsx). */
  notCited: number | null;
  /** The distinct web addresses the article links to (outbound-links.ts). */
  links: number;
  reception: number;
  claims: ClaimsCount;
}

export interface SourcesCountsInput {
  /** The works cited, or `null` while there is no list (not made, or still loading). */
  works: readonly unknown[] | null;
  /** Not cited's answer (useRelatedWork.ts); absent or `null` while unread, and for a visitor. */
  notCited?: RelatedWorkResult | null;
  /** Links' rows, `outboundLinks` over the blocks — always there, since nothing makes them. */
  links: readonly unknown[];
  reception: AnyReception | null;
  /** Claims' list of the article's claims, or `null` when none is read. */
  listed: readonly ListedClaim[] | null;
  /** `checkedSources`, or 0 for a visitor, who has no checks. */
  checked: number;
  /** `?bears=`, null for untouched. */
  relevance: SourcesClaimsBears | null;
  /** `?receptionthread=` — Claims' filter; it moves no number in Reception. */
  thread: string | null;
}

export function sourcesCounts(input: SourcesCountsInput): SourcesCounts {
  const threads = receptionThreads(input.reception);
  const reception = receptionSelection(input.reception, threads);
  const claims = claimsSelection(input.reception, threads, input.relevance, input.thread);
  return {
    bibliography: input.works === null ? null : input.works.length,
    notCited: input.notCited?.kind === "found" ? input.notCited.works.length : null,
    links: input.links.length,
    reception: reception.rows.length,
    claims: claimsCount(input.listed, input.checked, claims.shown.length),
  };
}

/** Claims' list as either arm holds it: the owner's once ready, a visitor's off the payload. */
export function listedClaims(
  list:
    | { kind: "owner"; status: string; claimList: SourcesClaimList | null }
    | { kind: "visitor"; claimList: PublicSourcesClaimList | null },
): readonly ListedClaim[] | null {
  if (list.kind === "owner") return list.status === "ready" ? (list.claimList?.claims ?? null) : null;
  return list.claimList?.claims ?? null;
}

/** What *Where it sits*' tools row can number (WhereItSitsPanel.tsx § `SOURCES_TOOLS`, less Investigate). */
export interface WhereToolCounts {
  reception?: number;
  claims?: number;
  "not-cited"?: number;
}

/**
 * **The tools row's numbers: one wherever a stored result has been read, 0
 * included**, and none where nothing is stored. Until 2026-10-26 a tool drew
 * its number only above 0, so *Pages about it* showed nothing over a stored
 * search that had confirmed no page, the same as a search never run; and Not
 * cited's stored answer was not read on *Where it sits* at all, so it never
 * had one there (a persona review; SourcesMode.tsx now reads it, which is a
 * read of our own table and asks OpenAlex nothing). The numbers are the
 * chips' own (`sourcesCounts`), so a tool and its list cannot disagree.
 */
export function whereToolCounts(
  counts: SourcesCounts,
  stored: { reception: boolean; claims: boolean },
): WhereToolCounts {
  return {
    ...(stored.reception ? { reception: counts.reception } : {}),
    ...(stored.claims ? { claims: counts.claims.n } : {}),
    ...(counts.notCited !== null ? { "not-cited": counts.notCited } : {}),
  };
}
