/**
 * **What Debate's Claims draws from the reader's checks** — pure, so the
 * panel's decisions can be tested without painting it. Plan
 * docs/plans/261008i-debate-claims-picked-by-the-reader.md § 3 and § 5.
 *
 * A claim can be checked more than once (Dig further, or ticked again), and
 * its rows are **every finished check's rows for it, an address drawn once**:
 * the first check to find a page keeps it.
 */
import type { DebateCheckRow, DebateClaimCheck, DebateClaimList } from "../types.js";

/** What is under one claim. */
export interface ClaimFindings {
  /** Every finished check's rows for this claim, oldest first, one per address. */
  rows: DebateCheckRow[];
  /** Its latest check is still out. */
  pending: boolean;
  /** Its latest check failed: the reader's sentence for why. */
  error: string | null;
  /**
   * The sentence its latest **finished** check earns when it adds nothing to
   * read: `found-nothing` only when that check answered this claim with no
   * rows and nothing earlier found any either; `not-answered` when the model
   * left the claim out — never drawn as *found nothing* (plan § 3, F5).
   */
  line: "found-nothing" | "not-answered" | null;
  /** A finished check has looked at it, so Dig further has something to build on. */
  canDig: boolean;
}

/** The checks drawn under this list: made from it, by its fingerprint. */
export function checksUnder(
  checks: readonly DebateClaimCheck[],
  list: Pick<DebateClaimList, "sourceHash"> | null,
): DebateClaimCheck[] {
  return list === null ? [] : checks.filter((c) => c.listSourceHash === list.sourceHash);
}

/** Is any check out on the article — under this list or not? The server holds one at a time. */
export function anyPending(checks: readonly DebateClaimCheck[]): boolean {
  return checks.some((c) => c.status === "pending");
}

/** What is under one claim, or `null` when nothing has checked it. */
export function claimFindings(checks: readonly DebateClaimCheck[], claimId: string): ClaimFindings | null {
  const mine = checks.filter((c) => c.targets.some((t) => t.claimId === claimId));
  const last = mine[mine.length - 1];
  if (last === undefined) return null;
  const rows: DebateCheckRow[] = [];
  const seen = new Set<string>();
  let latest: "answered" | "not-answered" | null = null;
  for (const check of mine) {
    if (check.status !== "done") continue;
    const result = check.results.find((r) => r.claimId === claimId);
    if (result === undefined) continue;
    latest = result.outcome;
    if (result.outcome !== "answered") continue;
    for (const row of result.rows) {
      if (seen.has(row.url)) continue;
      seen.add(row.url);
      rows.push(row);
    }
  }
  return {
    rows,
    pending: last.status === "pending",
    error: last.status === "error" ? (last.error ?? null) : null,
    line: latest === "not-answered" ? "not-answered" : latest === "answered" && rows.length === 0 ? "found-nothing" : null,
    canDig: latest !== null,
  };
}

/** The claims the reader typed, in the order first checked. */
export function ownClaims(checks: readonly DebateClaimCheck[]): { claimId: string; text: string }[] {
  const out: { claimId: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const check of checks) {
    for (const target of check.targets) {
      if (target.kind !== "own" || seen.has(target.claimId)) continue;
      seen.add(target.claimId);
      out.push({ claimId: target.claimId, text: target.text });
    }
  }
  return out;
}

/**
 * **The rows the checks put on screen**, counted the way they are drawn: per
 * claim, an address once. The same page under two claims is two rows, because
 * it is drawn twice.
 */
export function checkedRowCount(checks: readonly DebateClaimCheck[]): number {
  const claims = new Set(checks.flatMap((c) => c.targets.map((t) => t.claimId)));
  let n = 0;
  for (const claimId of claims) n += claimFindings(checks, claimId)?.rows.length ?? 0;
  return n;
}
