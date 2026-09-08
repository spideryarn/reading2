/**
 * WHICH USAGE REPORT SHOULD BE PUBLISHED — the stored one or the one this pass
 * just took.
 *
 * The store remembers and the pass judges, and this is the judging. It lives
 * here rather than in `store.ts` because the store must not decide what is true;
 * it lives here rather than in `usage.ts` because that module reads the box and
 * this one only compares two readings. Pure: two reports and a clock in, a
 * decision and a sentence out.
 *
 * ## Why a stored report is worth keeping at all
 *
 * A full scan is 30-45 seconds over ~2.9 GB and does not always finish. **A
 * rejection found at 13:00 whose window resets on Friday is still in force at
 * 13:05 even if the 13:05 scan fell over**, so discarding it would lose a fact
 * that has not expired and report `unknown` in its place — honest, and strictly
 * less true than what we knew a minute ago.
 *
 * ## The two ways keeping it goes wrong, and both were found by review
 *
 * The first draft of this rule was *"complete always supersedes; incomplete
 * supersedes only if what is stored is also incomplete or absent"*, which is
 * right in shape and has two holes, named by `w2-usage-limits` on 2026-09-08:
 *
 * 1. **No age bound.** A complete report from three days ago would displace
 *    every incomplete one for ever, and nothing would ever let it go. That is a
 *    stale reading that reads exactly like a current one — the failure this whole
 *    stage exists to refuse — merely moved out of `~/.claude.json` and into
 *    `current.json`.
 * 2. **No account check.** Stored report for account A, a `/login` to account B,
 *    an incomplete pass: the rule would keep A's report and a reader would see
 *    another account's headroom as current. **This same check has now had to be
 *    added in three separate places in one day**, which is itself the argument
 *    for it.
 *
 * ## "The same account" is a thing that must be PROVED, not assumed
 *
 * `UsageAccount` has a `logged-out` arm and an `unknown` arm, and `accountUuid`
 * is nullable inside `value`. So sameness is provable only when both sides are
 * `value` with a non-null uuid that matches; every other combination means *we
 * could not tell whether the account changed*, and reading that as *it did not*
 * is the wave's own rule inverted — **an incomplete observation may not be read
 * as a negative one.** So anything short of a proved match discards the stored
 * report, which is the safe direction: the cost is one wasted scan's worth of
 * memory, and the cost the other way is publishing someone else's headroom.
 */
import type { StoredUsage, UsageAccount, UsageReport } from "../fleet/wire.js";
import { LONGEST_ACTIVE_WINDOW_MS, absenceGap, absenceIsConclusive } from "./usage.js";

/**
 * What to publish, and why — a union rather than a boolean, because the reason is
 * the useful half. It goes in a daemon note, where "kept the 13:00 reading, this
 * scan did not finish" is actionable and `false` is not.
 */
export type UsageCarry =
  | { kind: "take-fresh"; why: string }
  | { kind: "keep-stored"; why: string };

/**
 * Whether two readings are provably about the same Claude account.
 *
 * Deliberately strict: `logged-out`, `unknown`, and a null `accountUuid` all
 * answer NO, because none of them proves a match. A permissive version would
 * read "we could not tell" as "unchanged", which is the one direction that
 * publishes another account's numbers.
 */
export function sameAccount(a: UsageAccount, b: UsageAccount): boolean {
  if (a.kind !== "value" || b.kind !== "value") return false;
  if (a.accountUuid === null || b.accountUuid === null) return false;
  return a.accountUuid === b.accountUuid;
}

// "Complete" is `absenceIsConclusive`, which already means exactly this and is
// exported for callers that want the boolean. Re-deriving it here would be a
// second declaration of one rule, and it would drift the day somebody adds an
// arm to `absenceGap`.

/**
 * The decision.
 *
 * Order matters and each check is a reason to stop trusting the stored report,
 * so they are tried before the completeness comparison that is the rule's point:
 * an account mismatch or an expired report is not a close call to be weighed
 * against coverage, it is a stored reading that has stopped describing anything.
 *
 * `nowMs` is injected rather than read, so a test can stand a report at exactly
 * the age bound instead of sleeping seven days.
 */
export function chooseUsage(stored: StoredUsage, fresh: UsageReport, nowMs: number): UsageCarry {
  if (stored.kind !== "report") {
    return { kind: "take-fresh", why: "nothing was stored, so there is nothing to keep" };
  }
  const held = stored.report;

  if (!sameAccount(held.account, fresh.account)) {
    return {
      kind: "take-fresh",
      why:
        "the stored report is not provably about the account this pass read, so it may not be shown as " +
        "current — an account we cannot match is not an account we know is unchanged",
    };
  }

  const ageMs = nowMs - Date.parse(held.collectedAt);
  // NaN when `collectedAt` is unparseable, and `NaN >= x` is false — so a report
  // with a broken clock would survive the age check. Refuse it explicitly instead:
  // a reading we cannot date is one we cannot say is current.
  if (!Number.isFinite(ageMs) || ageMs >= LONGEST_ACTIVE_WINDOW_MS) {
    return {
      kind: "take-fresh",
      why:
        "the stored report is older than the longest window it could describe, or carries no usable " +
        "instant, so every rejection in it has expired and it describes nothing",
    };
  }

  if (absenceIsConclusive(fresh.rateLimits.coverage)) {
    return { kind: "take-fresh", why: "this scan finished, so it is the better reading by construction" };
  }

  return {
    kind: "keep-stored",
    why:
      `this scan did not finish (${absenceGap(fresh.rateLimits.coverage) ?? "incomplete"}), and the stored ` +
      `reading from ${held.collectedAt} is about the same account and has not aged out — an account has not ` +
      "stopped being rate-limited because nobody could finish looking",
  };
}
