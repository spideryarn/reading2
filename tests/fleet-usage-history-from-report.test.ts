/**
 * Turning one usage pass into one history line.
 *
 * The mapping is where the plan's honesty rules become code, so most of these
 * tests are about a claim the line must NOT make.
 */
import { describe, expect, it } from "vitest";

import {
  cacheObservationOf,
  scanObservationOf,
  usageHistoryLineFrom,
  type PassInput,
} from "../tools/fleet/usage-history-from-report.js";
import { encodeUsageHistoryLine } from "../tools/fleet/usage-history-record.js";
import type { RateLimitHit, ScanCoverage, UsageAccount, UsageReport } from "../tools/fleet/wire.js";

function coverage(over: Partial<ScanCoverage> = {}): ScanCoverage {
  return {
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
    ...over,
  };
}

const ACCOUNT: UsageAccount = {
  kind: "value",
  email: "greg@rehearsable.ai",
  orgId: null,
  orgName: null,
  subscriptionType: "max",
  accountUuid: "acct-A",
  rateLimitTier: null,
};

function hit(over: Partial<RateLimitHit> = {}): RateLimitHit {
  return {
    id: "h1",
    window: "five_hour",
    resetsAtMs: 1788922199754,
    hitAtMs: Date.parse("2026-09-09T00:10:00.000Z"),
    hitAt: "2026-09-09T00:10:00.000Z",
    status: "rejected",
    claudeSessionId: "conv-1",
    transcriptPath: "/home/greg/.claude/projects/x/abc.jsonl",
    message: "rate limit exceeded",
    ...over,
  } as RateLimitHit;
}

function report(over: Partial<UsageReport> = {}): UsageReport {
  return {
    account: ACCOUNT,
    cache: {
      kind: "value",
      accountUuid: "acct-A",
      fetchedAtMs: Date.parse("2026-09-09T00:50:35.885Z"),
      ageMs: 1000,
      windows: [
        {
          kind: "value",
          window: "five_hour",
          utilizationPercent: 40,
          resetsAt: "2026-09-09T02:49:59.754Z",
          resetsAtMs: 1788922199754,
          msUntilReset: 10_000,
        },
        { kind: "unknown", window: "nimbus_quill", why: "no resets_at, so the utilization (0) cannot be checked" },
      ],
    },
    rateLimits: { kind: "none", coverage: coverage() },
    verdict: { level: "ok", reasons: ["no limit hit"], activeLimit: null },
    collectedAt: "2026-09-09T00:50:35.000Z",
    tookMs: 40,
    ...over,
  };
}

const OPTS = { nextDueMs: 300_000, recordedAt: "2026-09-09T00:50:40.000Z" };

describe("the cache observation", () => {
  it("keeps every window the file had, including ones it could not read", () => {
    /* Three unknown windows are live on this box today. A closed union would let
       an exhaustive switch compile while dropping a real one. */
    const obs = cacheObservationOf(report().cache);
    expect(obs.kind).toBe("attributed");
    if (obs.kind !== "attributed") return;
    expect(obs.windows.map((w) => w.window)).toEqual(["five_hour", "nimbus_quill"]);
    expect(obs.windows[1]).toMatchObject({ kind: "unknown", why: expect.stringContaining("resets_at") });
  });

  it("is UNATTRIBUTED, not unknown, when the cache carried no account", () => {
    /* Different failures. `unknown` means we could not read the cache;
       `unattributed` means we read it and cannot say whose it is — the
       /login-swap case. Only the second is evidence a switch happened. */
    const obs = cacheObservationOf({
      kind: "value",
      accountUuid: null,
      fetchedAtMs: 0,
      ageMs: 0,
      windows: [
        {
          kind: "value",
          window: "five_hour",
          utilizationPercent: 90,
          resetsAt: "2026-09-09T02:49:59.754Z",
          resetsAtMs: 1788922199754,
          msUntilReset: 1,
        },
      ],
    });
    expect(obs.kind).toBe("unattributed");
    /* AND IT CARRIES NO WINDOWS. Publishing a percentage we cannot attribute
       would put another account's headroom on this account's line. */
    expect(JSON.stringify(obs)).not.toContain("90");
  });

  it("passes an unreadable cache through as unknown, with the producer's reason", () => {
    const obs = cacheObservationOf({ kind: "unknown", why: "the file would not parse" });
    expect(obs).toEqual({ kind: "unknown", why: "the file would not parse" });
  });
});

describe("the scan observation", () => {
  it("is conclusive when the coverage supports it, and carries no incidents for a clean scan", () => {
    const obs = scanObservationOf({ kind: "none", coverage: coverage() });
    expect(obs).toMatchObject({ conclusive: true, why: null, incidents: [] });
  });

  it("is INCONCLUSIVE when transcripts could not be opened, using the shared helper's reason", () => {
    /* Not re-derived here: `absenceGapReason` is the same function the card
       asks, pinned against the producer by its own test. Two answers to one
       question from the same bytes is the thing this avoids. */
    const obs = scanObservationOf({
      kind: "none",
      coverage: coverage({ transcriptsOpened: 1, transcriptsUnreadable: 3, unreadableWhy: ["EACCES"] }),
    });
    expect(obs.conclusive).toBe(false);
    expect(obs.why).toBeTruthy();
  });

  it("groups hits into incidents and keeps a conversation COUNT, not the uuids", () => {
    const obs = scanObservationOf({
      kind: "hits",
      coverage: coverage(),
      hits: [
        hit({ id: "a", claudeSessionId: "conv-1" }),
        hit({ id: "b", claudeSessionId: "conv-2" }),
        hit({ id: "c", claudeSessionId: "conv-1" }),
      ],
    });
    expect(obs.incidents).toHaveLength(1);
    expect(obs.incidents[0]).toMatchObject({ rejections: 3, conversations: 2 });
    /* The uuids themselves must not survive into the history: they are the bulk
       of the payload and the chart never needs them. */
    expect(JSON.stringify(obs)).not.toContain("conv-1");
  });

  it("carries NO transcript path and NO error prose into the history", () => {
    /* The privacy argument for storing the projection rather than the raw
       report: a transcript path carries project and worktree names, and this
       file is long-lived and unpruned. */
    const obs = scanObservationOf({ kind: "hits", coverage: coverage(), hits: [hit()] });
    const json = JSON.stringify(obs);
    expect(json).not.toContain(".claude/projects");
    expect(json).not.toContain("rate limit exceeded");
  });
});

describe("the whole line", () => {
  it("records the publication decision WITHOUT losing the observation", () => {
    /* The failure this design exists to prevent. `keep-stored` means the
       checkpoint kept an earlier report — it does not mean this pass observed
       nothing. The cache reading is independent of the transcript scan. */
    const input: PassInput = {
      kind: "keep-stored",
      report: report({
        rateLimits: { kind: "none", coverage: coverage({ transcriptsOpened: 1, transcriptsUnreadable: 3 }) },
      }),
      why: "the fresh scan did not finish",
      at: "2026-09-09T00:50:40.000Z",
    };
    const line = usageHistoryLineFrom(input, OPTS);
    if (line.pass.kind !== "pass") throw new Error("shape");
    expect(line.pass.publication).toEqual({ decision: "keep-stored", why: "the fresh scan did not finish" });
    expect(line.pass.cache.kind).toBe("attributed");
    expect(line.pass.scan.conclusive).toBe(false);
  });

  it("uses the REPORT's own collectedAt, not the pass's `at`", () => {
    /* Three clocks kept apart. The observation's instant is the reading's, and
       a 30-45 second scan means they are genuinely different numbers. */
    const line = usageHistoryLineFrom(
      { kind: "take-fresh", report: report(), why: "finished", at: "2026-09-09T00:51:20.000Z" },
      OPTS,
    );
    if (line.pass.kind !== "pass") throw new Error("shape");
    expect(line.pass.collectedAt).toBe("2026-09-09T00:50:35.000Z");
    expect(line.recordedAt).toBe("2026-09-09T00:50:40.000Z");
  });

  it("maps a collector failure to its own arm, with no collectedAt anywhere", () => {
    const line = usageHistoryLineFrom(
      { kind: "collector-failed", why: "ENOENT", at: "2026-09-09T00:55:00.000Z" },
      OPTS,
    );
    expect(line.pass).toEqual({ kind: "collector-failed", at: "2026-09-09T00:55:00.000Z", why: "ENOENT" });
    expect(JSON.stringify(line)).not.toContain("collectedAt");
  });

  it("produces something the codec will actually accept", () => {
    /* The join. A mapper that produced a shape the encoder refuses would fail
       at 03:00 in a daemon rather than here. */
    for (const input of [
      { kind: "take-fresh", report: report(), why: "ok", at: "2026-09-09T00:50:40.000Z" },
      { kind: "keep-stored", report: report(), why: "kept", at: "2026-09-09T00:50:40.000Z" },
      { kind: "collector-failed", why: "boom", at: "2026-09-09T00:50:40.000Z" },
    ] satisfies PassInput[]) {
      expect(() => encodeUsageHistoryLine(usageHistoryLineFrom(input, OPTS)), input.kind).not.toThrow();
    }
  });
});
