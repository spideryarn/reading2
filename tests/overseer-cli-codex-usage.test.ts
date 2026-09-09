/** The dedicated usage command prints and serialises both subscription readings. */
import { describe, expect, it } from "vitest";

import { runUsageCommand, usageJson, usageLines } from "../scripts/overseer.js";
import type { CodexUsageReading, UsageReport } from "../tools/fleet/wire.js";

const CLAUDE: UsageReport = {
  account: { kind: "value", email: "greg@example.test", orgId: null, orgName: null, subscriptionType: "max", accountUuid: "acct-a", rateLimitTier: null },
  cache: { kind: "unknown", why: "no cache" },
  rateLimits: {
    kind: "none",
    coverage: {
      transcriptsFound: 4,
      transcriptsSelected: 4,
      transcriptsOpened: 4,
      transcriptsUnreadable: 0,
      unreadableWhy: [],
      linesScanned: 900,
      candidateLines: 0,
      linesParsed: 0,
      malformedCandidates: 0,
      quotaLimitsWithoutErrorSignal: 0,
      truncatedByLimit: false,
      sinceMs: null,
      tookMs: 40,
    },
  },
  verdict: { level: "ok", reasons: ["no limit hit"], activeLimit: null },
  collectedAt: "2026-09-09T12:00:00.000Z",
  tookMs: 40,
};

const CODEX: CodexUsageReading = {
  kind: "value",
  accountId: "account-redacted",
  readAt: "2026-09-09T11:59:00.000Z",
  resetCredits: 2,
  buckets: [{
    limitId: "codex",
    limitName: null,
    planType: "pro",
    credits: { hasCredits: false, unlimited: false, balance: "0" },
    individualLimit: null,
    spendControlReached: false,
    rateLimitReachedType: "weekly",
    windows: [{
      kind: "value",
      slot: "primary",
      windowMinutes: 10_080,
      usedPercent: 124,
      resetsAt: "2026-09-15T01:23:19.000Z",
      resetsAtMs: Date.parse("2026-09-15T01:23:19.000Z"),
    }],
  }],
};

describe("overseer usage", () => {
  it("prints both accounts and retains the Claude scan's positive control", () => {
    const text = usageLines(CLAUDE, CODEX).join("\n");
    expect(text).toContain("Claude subscription");
    expect(text).toContain("Codex subscription");
    expect(text).toContain("124% used");
    expect(text).toContain("RATE LIMIT REACHED — weekly");
    expect(text).toContain("scanned   4/4 of 4 transcripts, 900 lines");
    expect(text).not.toContain("API credits");
  });

  it("adds Codex to --json rather than leaving the old Claude-only report", async () => {
    expect(usageJson(CLAUDE, CODEX)).toEqual({ ...CLAUDE, codex: CODEX });
    const output: string[] = [];
    await runUsageCommand(
      { command: "usage", json: true },
      { claude: async () => CLAUDE, codex: async () => CODEX, out: (line) => output.push(line) },
    );
    expect(JSON.parse(output.join("\n"))).toEqual({ ...CLAUDE, codex: CODEX });
  });

  it("still prints Claude and its positive control when the Codex collector rejects", async () => {
    const output: string[] = [];
    await runUsageCommand(
      { command: "usage", json: false },
      {
        claude: async () => CLAUDE,
        codex: async () => { throw new Error("temporary failure"); },
        out: (line) => output.push(line),
      },
    );
    const text = output.join("\n");
    expect(text).toContain("scanned   4/4 of 4 transcripts, 900 lines");
    expect(text).toContain("Codex subscription");
    expect(text).toContain("temporary failure");
    expect(text).toContain("retryable");
  });
});
