/**
 * Which usage report gets published — the stored one or the fresh one.
 *
 * The rule exists so that a scan which did not finish cannot lose a rejection
 * that has not expired. Every test below is one of the ways that keeping a
 * stored report goes wrong instead.
 */
import { describe, expect, test } from "vitest";

import type { ScanCoverage, StoredUsage, UsageAccount, UsageReport } from "../tools/fleet/wire.js";
import { LONGEST_ACTIVE_WINDOW_MS } from "../tools/overseer/usage.js";
import { chooseUsage, sameAccount } from "../tools/overseer/usage-carry.js";

const NOW = Date.parse("2026-09-08T12:00:00.000Z");

/** A coverage that `absenceGap` calls conclusive — everything looked at, nothing unread. */
function completeCoverage(over: Partial<ScanCoverage> = {}): ScanCoverage {
  return {
    transcriptsFound: 10,
    transcriptsSelected: 10,
    transcriptsOpened: 10,
    transcriptsUnreadable: 0,
    unreadableWhy: [],
    linesScanned: 5000,
    candidateLines: 3,
    linesParsed: 3,
    malformedCandidates: 0,
    quotaLimitsWithoutErrorSignal: 0,
    truncatedByLimit: false,
    sinceMs: null,
    tookMs: 1234,
    ...over,
  };
}

function account(uuid: string | null, over: Partial<Extract<UsageAccount, { kind: "value" }>> = {}): UsageAccount {
  return {
    kind: "value",
    email: "greg@rehearsable.ai",
    orgId: null,
    orgName: null,
    subscriptionType: "max",
    accountUuid: uuid,
    rateLimitTier: null,
    ...over,
  };
}

function report(over: Partial<UsageReport> = {}): UsageReport {
  return {
    account: account("acct-A"),
    /*
     * `unknown`, NOT an invented `absent` arm. The first version of this fixture
     * wrote `{kind:"absent"} as UsageReport["cache"]` and the `as` silenced a
     * compiler error saying the arm does not exist — so every test below, and
     * every mutation run against them, exercised a report shape the parser would
     * refuse and the collector can never produce. Checking a discriminant and
     * casting the tail is the defect this module's own review kept finding; in a
     * FIXTURE it is worse, because it decides what the tests are about.
     *
     * `chooseUsage` provably never reads `cache` — grep the module — so the logic
     * was unaffected. That was confirmed rather than assumed, which is the only
     * reason the six green mutations still count.
     */
    cache: { kind: "unknown", why: "no cache reading in this fixture" },
    rateLimits: { kind: "none", coverage: completeCoverage() },
    verdict: { level: "ok", reasons: ["no limit hit"], activeLimit: null },
    collectedAt: "2026-09-08T11:59:00.000Z",
    tookMs: 1234,
    ...over,
  };
}

function stored(r: UsageReport): StoredUsage {
  return { kind: "report", report: r };
}

/** A scan that opened nothing: `absenceGap` refuses to call this an absence. */
const INCOMPLETE = { kind: "none", coverage: completeCoverage({ transcriptsOpened: 0 }) } as UsageReport["rateLimits"];

describe("proving two readings are about the same account", () => {
  test("two value arms with the same uuid match", () => {
    expect(sameAccount(account("acct-A"), account("acct-A"))).toBe(true);
  });

  test("different uuids do not", () => {
    expect(sameAccount(account("acct-A"), account("acct-B"))).toBe(false);
  });

  /*
   * The three "we could not tell" cases, and all three answer NO. Reading any of
   * them as a match is the one direction that publishes another account's numbers
   * — an incomplete observation may not be read as a negative one.
   */
  test("a null uuid does not match another null uuid", () => {
    expect(sameAccount(account(null), account(null))).toBe(false);
  });

  test("logged-out matches nothing, including itself", () => {
    const out: UsageAccount = { kind: "logged-out", projectsDirectory: null };
    expect(sameAccount(out, out)).toBe(false);
    expect(sameAccount(out, account("acct-A"))).toBe(false);
  });

  test("unknown matches nothing, including itself", () => {
    const unknown: UsageAccount = { kind: "unknown", why: "claude auth status did not answer" };
    expect(sameAccount(unknown, unknown)).toBe(false);
    expect(sameAccount(unknown, account("acct-A"))).toBe(false);
  });
});

describe("choosing between a stored report and a fresh one", () => {
  test("an incomplete scan keeps a recent stored report for the same account", () => {
    const held = report({ collectedAt: "2026-09-08T11:00:00.000Z" });

    const choice = chooseUsage(stored(held), report({ rateLimits: INCOMPLETE }), NOW);

    // The whole reason this rule exists: an account has not stopped being
    // rate-limited because nobody could finish looking.
    expect(choice.kind).toBe("keep-stored");
    expect(choice.why).toMatch(/did not finish/);
  });

  test("a complete scan always supersedes", () => {
    const held = report({ collectedAt: "2026-09-08T11:00:00.000Z" });

    const choice = chooseUsage(stored(held), report(), NOW);

    expect(choice.kind).toBe("take-fresh");
    expect(choice.why).toMatch(/this scan finished/);
  });

  test("nothing stored means there is nothing to keep", () => {
    const choice = chooseUsage({ kind: "none", why: "no pass yet", at: "2026-09-08T10:00:00.000Z" }, report({ rateLimits: INCOMPLETE }), NOW);

    expect(choice.kind).toBe("take-fresh");
    expect(choice.why).toMatch(/nothing was stored/);
  });

  /*
   * THE ACCOUNT HOLE. Stored report for A, a `/login` to B, an incomplete pass:
   * the first draft of this rule kept A's report and would have shown another
   * account's headroom as current.
   */
  test("a stored report for a DIFFERENT account may not survive, even against an incomplete scan", () => {
    const held = report({ account: account("acct-A"), collectedAt: "2026-09-08T11:00:00.000Z" });
    const fresh = report({ account: account("acct-B"), rateLimits: INCOMPLETE });

    const choice = chooseUsage(stored(held), fresh, NOW);

    expect(choice.kind).toBe("take-fresh");
    expect(choice.why).toMatch(/not provably about the account/);
  });

  test("an account we cannot match is not an account we know is unchanged", () => {
    const held = report({ account: account("acct-A"), collectedAt: "2026-09-08T11:00:00.000Z" });
    const fresh = report({ account: { kind: "unknown", why: "auth status failed" }, rateLimits: INCOMPLETE });

    const choice = chooseUsage(stored(held), fresh, NOW);

    expect(choice.kind).toBe("take-fresh");
  });

  /*
   * THE AGE HOLE. Without a bound, a complete report from three days ago would
   * displace every incomplete one for ever — a stale reading that reads exactly
   * like a current one, moved from ~/.claude.json into current.json.
   */
  test("a stored report older than the longest window it could describe is let go", () => {
    const held = report({ collectedAt: new Date(NOW - LONGEST_ACTIVE_WINDOW_MS - 1).toISOString() });

    const choice = chooseUsage(stored(held), report({ rateLimits: INCOMPLETE }), NOW);

    expect(choice.kind).toBe("take-fresh");
    expect(choice.why).toMatch(/older than the longest window/);
  });

  test("one millisecond inside the bound is still kept, so the boundary is the boundary", () => {
    const held = report({ collectedAt: new Date(NOW - LONGEST_ACTIVE_WINDOW_MS + 1).toISOString() });

    expect(chooseUsage(stored(held), report({ rateLimits: INCOMPLETE }), NOW).kind).toBe("keep-stored");
  });

  test("a stored report whose instant cannot be parsed is let go rather than kept for ever", () => {
    // `NaN >= LONGEST_ACTIVE_WINDOW_MS` is FALSE, so an age check written without
    // the finite guard would have kept this one indefinitely — the age hole
    // reopening through a broken clock rather than through an old one.
    const held = report({ collectedAt: "not a timestamp" });

    const choice = chooseUsage(stored(held), report({ rateLimits: INCOMPLETE }), NOW);

    expect(choice.kind).toBe("take-fresh");
    expect(choice.why).toMatch(/no usable/);
  });

  test("the reason names the stored reading's instant, because a held report is not a fresh one", () => {
    const held = report({ collectedAt: "2026-09-08T11:00:00.000Z" });

    const choice = chooseUsage(stored(held), report({ rateLimits: INCOMPLETE }), NOW);

    // A decision a person reads in a daemon note has to say WHICH reading survived.
    expect(choice.why).toContain("2026-09-08T11:00:00.000Z");
  });
});
