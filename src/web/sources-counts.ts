/**
 * **The numbers on Sources' three chips, and the rows behind them** —
 * pure selectors, used by the chip row (SourcesMode.tsx §
 * `SourcesViews`) and by the panels that draw the lists (BibliographyPanel,
 * DebatePanel), so a chip's number and the list under it are one derivation
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
 * - **Reception**: the rows about the piece, through the thread the reader
 *   picked (`?debatethread=`), as Debate's segment counted them.
 * - **Claims**: the listed claims, until the reader's checks have put
 *   sources on screen, and then those sources plus any rows an older search
 *   kept (plan 261008i § 5); with no list, the older search's rows through
 *   the relevance bar and the thread.
 *
 * Imports no React, so a test can call it on fixtures alone.
 */
import type {
  PublicClaimDebateRow,
  PublicDebate,
  PublicDebateClaimList,
  PublicDirectDebateRow,
} from "../public-types.js";
import type { Debate, DebateBears, DebateClaimCheck, DebateClaimList, ListedClaim } from "../types.js";
import { readStoredSynthesis } from "../debate-synthesis.js";
import { checkedRowCount, drawChecks } from "./debate-checks.js";
import { RELEVANCE_DEFAULT, visibleClaims } from "./debate-order.js";
import { inThread, selectedThread, type Thread, threadsOf, threadsWithin } from "./debate-threads.js";
import type { ThresholdResult } from "./threshold.js";

/** Either arm's stored debate: the owner's, or a visitor's public projection. */
type AnyDebate = Debate | PublicDebate;
/* The public row types are the narrower shape, and every owner's row is one
   of them (DebatePanel.tsx § `DirectRow`). */
type DirectRow = PublicDirectDebateRow;
type ClaimRow = PublicClaimDebateRow;

const NO_DIRECT: readonly DirectRow[] = [];
const NO_CLAIMS: readonly ClaimRow[] = [];

/** The debate's threads, from its stored synthesis, read the one checked way (debate-synthesis.ts). */
export function debateThreads(debate: AnyDebate | null): Thread[] {
  return threadsOf(debate !== null ? readStoredSynthesis(debate) : null);
}

/** **Reception, through the thread**: the threads it offers, the one selected, and the rows shown. */
export interface ReceptionSelection {
  threads: Thread[];
  thread: Thread | null;
  shown: DirectRow[];
}

export function receptionSelection(
  debate: AnyDebate | null,
  threads: readonly Thread[],
  threadParam: string | null,
): ReceptionSelection {
  const rows: readonly DirectRow[] = debate?.direct.rows ?? NO_DIRECT;
  const within = threadsWithin(threads, rows);
  const thread = selectedThread(within, threadParam);
  return { threads: within, thread, shown: inThread(rows, thread) };
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
  debate: AnyDebate | null,
  threads: readonly Thread[],
  relevance: DebateBears | null,
  threadParam: string | null,
): ClaimsSelection {
  const rows: readonly ClaimRow[] = debate?.claims.rows ?? NO_CLAIMS;
  const barred = visibleClaims(rows, relevance ?? RELEVANCE_DEFAULT);
  const within = threadsWithin(threads, rows);
  const thread = selectedThread(within, threadParam);
  return { barred, threads: within, thread, shown: inThread(barred.visible, thread) };
}

/** The sources the reader's own checks put on screen, over the current list (debate-checks.ts). */
export function checkedSources(checks: readonly DebateClaimCheck[], list: DebateClaimList | null): number {
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

/** **The three chips' numbers.** Bibliography's is `null` while there is no list to count. */
export interface SourcesCounts {
  bibliography: number | null;
  reception: number;
  claims: ClaimsCount;
}

export interface SourcesCountsInput {
  /** The works cited, or `null` while there is no list (not made, or still loading). */
  works: readonly unknown[] | null;
  debate: AnyDebate | null;
  /** Claims' list of the article's claims, or `null` when none is read. */
  listed: readonly ListedClaim[] | null;
  /** `checkedSources`, or 0 for a visitor, who has no checks. */
  checked: number;
  /** `?bears=`, null for untouched. */
  relevance: DebateBears | null;
  /** `?debatethread=`. */
  thread: string | null;
}

export function sourcesCounts(input: SourcesCountsInput): SourcesCounts {
  const threads = debateThreads(input.debate);
  const reception = receptionSelection(input.debate, threads, input.thread);
  const claims = claimsSelection(input.debate, threads, input.relevance, input.thread);
  return {
    bibliography: input.works === null ? null : input.works.length,
    reception: reception.shown.length,
    claims: claimsCount(input.listed, input.checked, claims.shown.length),
  };
}

/** Claims' list as either arm holds it: the owner's once ready, a visitor's off the payload. */
export function listedClaims(
  list:
    | { kind: "owner"; status: string; claimList: DebateClaimList | null }
    | { kind: "visitor"; claimList: PublicDebateClaimList | null },
): readonly ListedClaim[] | null {
  if (list.kind === "owner") return list.status === "ready" ? (list.claimList?.claims ?? null) : null;
  return list.claimList?.claims ?? null;
}
