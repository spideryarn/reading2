/**
 * **A READING THAT IS WRONG ABOUT ITS OWN CONTENTS IS REFUSED, AT EVERY BOUNDARY.**
 *
 * GPT Sol's re-review of plan 260910c found two ways a malformed per-account
 * reading could still reach the page as a confident number, and both have to be
 * closed at all three places the shape is parsed — the producer's
 * `parseAccountUsageSections` (what the store reads back), the dashboard
 * server's `projectAccountUsage`, and the browser's `parseAccountUsage`. Three
 * copies of one rule is the house pattern for this shape (each end reads the
 * file; the browser cannot import node modules), and it means a rule closed at
 * one boundary and forgotten at another is a hole that looks shut.
 *
 *  - **A reset-credit count that is not a count.** Negative or fractional
 *    values were accepted as long as they were finite, and
 *    `CodexResetCreditsCard` would print "-1 reset credits". The history route's
 *    own parser already requires a non-negative whole number; these three did
 *    not.
 *  - **Duplicate readings inside one section.** Two `five_hour` windows, or two
 *    Codex buckets with one `limitId`, rendered as two conflicting numbers under
 *    one heading. The providers key these by object, so a duplicate can only
 *    come from a corrupted or hand-edited checkpoint — which is exactly the case
 *    the parsers exist for. Only duplicate ACCOUNTS were refused.
 *
 * **Every refusal has a positive control beside it.** A parser that refused
 * everything would pass every "refuses X" test here, so the valid section is
 * shown to pass all three boundaries first.
 */
import { describe, expect, it } from "vitest";

import { projectAccountUsage } from "../tools/fleet/account-usage-feed.js";
import { parseAccountUsage } from "../tools/fleet/web/src/types.js";
import { parseAccountUsageSections } from "../tools/overseer/account-usage.js";

const TAKEN_AT = "2026-09-10T06:00:00.000Z";
const WRITTEN_AT = "2026-09-10T06:00:30.000Z";
/* Two hours after the reading: inside a 300-minute window, which is what the
   browser's bucket parser checks a Codex reset against. */
const RESETS_AT = "2026-09-10T08:00:00.000Z";

function claudeSection(windows: unknown[]): Record<string, unknown> {
  return {
    name: "mindstone",
    family: "claude",
    role: "pool",
    origin: "registered",
    displayEmail: null,
    providerAccountId: "provider-claude",
    takenAt: TAKEN_AT,
    reading: { kind: "windows", windows },
  };
}

function claudeWindow(window: string, utilizationPercent: number): Record<string, unknown> {
  return { kind: "value", window, utilizationPercent, resetsAt: RESETS_AT };
}

function codexBucket(limitId: string): Record<string, unknown> {
  return {
    limitId,
    limitName: null,
    planType: "pro",
    credits: null,
    individualLimit: null,
    spendControlReached: false,
    rateLimitReachedType: null,
    windows: [
      {
        kind: "value",
        slot: "primary",
        windowMinutes: 300,
        usedPercent: 12,
        resetsAt: RESETS_AT,
        resetsAtMs: Date.parse(RESETS_AT),
      },
    ],
  };
}

function codexSection(buckets: unknown[], resetCredits: unknown): Record<string, unknown> {
  return {
    name: "ambient",
    family: "codex",
    role: "orchestrator",
    origin: "ambient",
    displayEmail: null,
    providerAccountId: "provider-codex",
    takenAt: TAKEN_AT,
    reading: { kind: "buckets", buckets, resetCredits },
  };
}

/** The verdict of all three boundaries on one list of sections, in one shape. */
function verdicts(accounts: unknown[]): { producer: boolean; fleet: boolean; browser: boolean } {
  const producer = parseAccountUsageSections(accounts) !== null;
  const fleet =
    projectAccountUsage({
      schema: 2,
      writtenAt: WRITTEN_AT,
      accountUsage: { kind: "reading", collectedAt: TAKEN_AT, problems: [], accounts },
    }).kind === "published";
  const browser =
    parseAccountUsage({
      kind: "published",
      collectedAt: TAKEN_AT,
      coordinatorWrittenAt: WRITTEN_AT,
      problems: [],
      accounts,
    }).kind === "published";
  return { producer, fleet, browser };
}

const ALL_ACCEPT = { producer: true, fleet: true, browser: true };
const ALL_REFUSE = { producer: false, fleet: false, browser: false };

describe("the positive controls: a well-formed reading passes every boundary", () => {
  it("accepts a valid Claude section with two distinct windows", () => {
    expect(verdicts([claudeSection([claudeWindow("five_hour", 41), claudeWindow("seven_day", 12)])])).toEqual(
      ALL_ACCEPT,
    );
  });

  it("accepts a valid Codex section with distinct buckets and a whole reset-credit count", () => {
    expect(verdicts([codexSection([codexBucket("codex"), codexBucket("gpt-5-codex")], 2)])).toEqual(ALL_ACCEPT);
  });

  it("accepts a Codex section that reports no reset-credit count at all", () => {
    expect(verdicts([codexSection([codexBucket("codex")], null)])).toEqual(ALL_ACCEPT);
  });
});

describe("a reset-credit count that is not a count is refused everywhere", () => {
  it.each([
    ["negative", -1],
    ["fractional", 1.5],
  ])("refuses a %s count", (_label, resetCredits) => {
    expect(verdicts([codexSection([codexBucket("codex")], resetCredits)])).toEqual(ALL_REFUSE);
  });
});

describe("duplicate readings inside one section are refused everywhere", () => {
  it("refuses a Claude section carrying the same window twice", () => {
    expect(verdicts([claudeSection([claudeWindow("five_hour", 41), claudeWindow("five_hour", 7)])])).toEqual(
      ALL_REFUSE,
    );
  });

  it("refuses a Codex section carrying the same bucket twice", () => {
    expect(verdicts([codexSection([codexBucket("codex"), codexBucket("codex")], 2)])).toEqual(ALL_REFUSE);
  });
});
