/**
 * The per-account headroom collector, plan 260910c.
 *
 * Every dependency is injected, so this file never reaches a credential, an
 * HTTP endpoint or a codex binary. The classes it exists to pin are the ones
 * named in the plan's verification section and in GPT Sol's review of it:
 * absence never becomes a zero, one account's failure never becomes another's,
 * one subscription never becomes two sections, a percentage never appears under
 * an account nobody proved it belongs to, and a short list never passes for a
 * complete one.
 */
import { describe, expect, it } from "vitest";

import {
  collectAccountUsage,
  parseAccountUsageSections,
  type AccountUsageDeps,
} from "../tools/overseer/account-usage.js";
import type { AccountEntry, AccountUsageReading, RegistryReading } from "../tools/overseer/accounts.js";
import type { CodexUsageReading } from "../tools/fleet/wire.js";

const NOW = new Date("2026-09-10T06:00:00.000Z");

function entry(overrides: Partial<AccountEntry> & Pick<AccountEntry, "name" | "family" | "stateDir">): AccountEntry {
  return {
    role: "pool",
    providerAccountId: `provider-${overrides.name}`,
    providerTenantId: `tenant-${overrides.name}`,
    addedAt: "2026-09-09T00:00:00.000Z",
    familyData: {},
    ...overrides,
  };
}

function claudeValue(overrides: Partial<Extract<AccountUsageReading, { kind: "value" }>> = {}): AccountUsageReading {
  return {
    kind: "value",
    configDir: "/home/tester/.claude-mindstone",
    takenAt: "2026-09-10T05:59:30.000Z",
    identity: {
      providerAccountId: "provider-mindstone",
      providerTenantId: "tenant-mindstone",
      displayEmail: "greg@mindstone.com",
    },
    windows: [
      {
        kind: "value",
        window: "five_hour",
        utilizationPercent: 12,
        resetsAt: "2026-09-10T09:00:00.000Z",
        resetsAtMs: Date.parse("2026-09-10T09:00:00.000Z"),
        msUntilReset: 10_800_000,
      },
      {
        kind: "expired",
        window: "seven_day",
        resetsAt: "2026-09-09T09:00:00.000Z",
        resetsAtMs: Date.parse("2026-09-09T09:00:00.000Z"),
        msSinceReset: 75_600_000,
        why: "the cached reading said 41% used and that window reset 21 hours ago",
      },
    ],
    ...overrides,
  };
}

function codexValue(overrides: Partial<Extract<CodexUsageReading, { kind: "value" }>> = {}): CodexUsageReading {
  return {
    kind: "value",
    accountId: "provider-codexone",
    readAt: "2026-09-10T05:59:45.000Z",
    buckets: [
      {
        limitId: "codex",
        limitName: null,
        planType: "pro",
        credits: null,
        individualLimit: null,
        spendControlReached: null,
        rateLimitReachedType: null,
        windows: [
          {
            kind: "value",
            slot: "primary",
            windowMinutes: 300,
            usedPercent: 8,
            resetsAt: "2026-09-10T09:00:00.000Z",
            resetsAtMs: Date.parse("2026-09-10T09:00:00.000Z"),
          },
        ],
      },
    ],
    resetCredits: null,
    ...overrides,
  };
}

/**
 * The default Claude reader answers with a DIFFERENT identity per directory,
 * because that is what a box with two subscriptions on it does — and because a
 * fixture that answered identically everywhere would be silently collapsed by
 * `collapseDuplicateSubscriptions`, making every multi-account test read as one
 * account for a reason nothing on screen would explain. The tests that want a
 * collision ask for one explicitly.
 */
function claudeValueFor(configDir: string): AccountUsageReading {
  return configDir === "/home/tester/.claude-mindstone"
    ? claudeValue({ configDir })
    : claudeValue({
        configDir,
        identity: {
          providerAccountId: `provider-at-${configDir}`,
          providerTenantId: `tenant-at-${configDir}`,
          displayEmail: `someone@${configDir}`,
        },
      });
}

function deps(overrides: Partial<AccountUsageDeps> = {}): AccountUsageDeps {
  return {
    registry: async (): Promise<RegistryReading> => ({ kind: "ambient", accounts: [] }),
    claudeUsage: async (configDir) => claudeValueFor(configDir),
    codexUsage: async () => codexValue(),
    ambientClaudeDir: () => "/home/tester/.claude",
    ambientCodexHome: () => "/home/tester/.codex",
    now: () => NOW,
    ...overrides,
  };
}

/** The ambient Codex reading the daemon's own usage pass produced, in the shape it is handed over. */
const AMBIENT_CODEX = codexValue({ accountId: "provider-ambient-codex" });

describe("collectAccountUsage lists every account-subscription on the box", () => {
  it("reads each registered account and the ambient logins beside them", async () => {
    const stored = await collectAccountUsage(
      deps({
        registry: async () => ({
          kind: "value",
          schema: 1,
          accounts: [
            entry({ name: "mindstone", family: "claude", stateDir: "/home/tester/.claude-mindstone", displayEmail: "greg@mindstone.com" }),
          ],
        }),
      }),
      AMBIENT_CODEX,
    );
    expect(stored.kind).toBe("reading");
    if (stored.kind !== "reading") throw new Error(stored.why);
    expect(stored.accounts.map((section) => `${section.family}/${section.name}`)).toEqual([
      "claude/ambient",
      "claude/mindstone",
      "codex/ambient",
    ]);
    expect(stored.problems).toEqual([]);
  });

  /**
   * THE AMBIENT LOGIN'S ROLE IS `orchestrator`, AND ITS ORIGIN IS `ambient`.
   *
   * These were one field until GPT Sol pointed out the category error: folding
   * provenance into the role makes *what is this account for* unanswerable for
   * the one account the answer matters most about — the one every supervisory
   * model call is spent on.
   */
  it("says what an account is for and how the box knows about it, separately", async () => {
    const stored = await collectAccountUsage(
      deps({
        registry: async () => ({
          kind: "value",
          schema: 1,
          accounts: [entry({ name: "mindstone", family: "claude", stateDir: "/home/tester/.claude-mindstone" })],
        }),
      }),
    );
    if (stored.kind !== "reading") throw new Error(stored.why);
    const ambient = stored.accounts.find((section) => section.name === "ambient");
    const registered = stored.accounts.find((section) => section.name === "mindstone");
    expect(ambient).toMatchObject({ role: "orchestrator", origin: "ambient" });
    expect(registered).toMatchObject({ role: "pool", origin: "registered" });
  });

  /**
   * THE DUPLICATE-AMBIENT CLASS. The Overseer daemon can itself be launched
   * routed, and then "the ambient account" IS a registered one. Two rows for one
   * subscription, taken a moment apart and disagreeing by a percent or two, make
   * both rows untrustworthy.
   */
  it("does not draw the ambient login twice when it is itself a registered account", async () => {
    const stored = await collectAccountUsage(
      deps({
        ambientClaudeDir: () => "/home/tester/.claude-mindstone/",
        registry: async () => ({
          kind: "value",
          schema: 1,
          accounts: [entry({ name: "mindstone", family: "claude", stateDir: "/home/tester/.claude-mindstone" })],
        }),
      }),
    );
    if (stored.kind !== "reading") throw new Error(stored.why);
    const claude = stored.accounts.filter((section) => section.family === "claude");
    expect(claude).toHaveLength(1);
    expect(claude[0]?.name).toBe("mindstone");
  });

  it("does not draw the ambient Codex login twice either", async () => {
    let registeredCodexReads = 0;
    const stored = await collectAccountUsage(
      deps({
        ambientCodexHome: () => "/home/tester/.codex-one",
        codexUsage: async () => {
          registeredCodexReads += 1;
          return codexValue();
        },
        registry: async () => ({
          kind: "value",
          schema: 1,
          accounts: [
            entry({ name: "codexone", family: "codex", stateDir: "/home/tester/.codex-one", providerAccountId: "provider-codexone" }),
          ],
        }),
      }),
      codexValue({ accountId: "provider-codexone" }),
    );
    if (stored.kind !== "reading") throw new Error(stored.why);
    expect(stored.accounts.filter((section) => section.family === "codex")).toHaveLength(1);
    expect(registeredCodexReads, "the handed ambient observation was collected again through the registry path").toBe(0);
  });

  /**
   * THE COLLECTOR NEVER SPAWNS A CODEX APP-SERVER FOR THE AMBIENT ACCOUNT.
   *
   * The daemon's existing usage pass already takes that reading every tick and
   * stashes it for the history recorder. Taking it again here would be a second
   * spawn per five minutes and — the part that matters — two independently-taken
   * numbers for one subscription on one page, each undermining the other. So the
   * observation is handed in, and with nothing handed in there is no ambient
   * Codex section at all rather than a freshly collected one.
   */
  it("draws no ambient Codex section when the usage pass produced no observation", async () => {
    const stored = await collectAccountUsage(deps(), null);
    if (stored.kind !== "reading") throw new Error(stored.why);
    expect(stored.accounts.filter((section) => section.family === "codex")).toHaveLength(0);
  });
});

describe("collectAccountUsage keeps one account's failure to itself", () => {
  it("reports the failing account as unknown and still publishes its neighbours", async () => {
    const stored = await collectAccountUsage(
      deps({
        registry: async () => ({
          kind: "value",
          schema: 1,
          accounts: [entry({ name: "mindstone", family: "claude", stateDir: "/home/tester/.claude-mindstone" })],
        }),
        claudeUsage: async (configDir) =>
          configDir === "/home/tester/.claude-mindstone"
            ? { kind: "unknown", configDir, takenAt: "2026-09-10T05:59:00.000Z", why: "usage request failed with HTTP 401", status: 401 }
            : claudeValueFor(configDir),
      }),
    );
    if (stored.kind !== "reading") throw new Error(stored.why);
    const mindstone = stored.accounts.find((section) => section.name === "mindstone");
    const ambient = stored.accounts.find((section) => section.name === "ambient" && section.family === "claude");
    expect(mindstone?.reading).toEqual({ kind: "unknown", why: "usage request failed with HTTP 401" });
    expect(ambient?.reading.kind).toBe("windows");
  });

  it("turns a thrown reader into that account's unknown rather than losing the pass", async () => {
    const stored = await collectAccountUsage(
      deps({
        claudeUsage: async () => {
          throw new Error("socket hang up");
        },
      }),
      AMBIENT_CODEX,
    );
    if (stored.kind !== "reading") throw new Error(stored.why);
    const claude = stored.accounts.find((section) => section.family === "claude");
    expect(claude?.reading).toEqual({ kind: "unknown", why: expect.stringContaining("socket hang up") });
    expect(stored.accounts.find((section) => section.family === "codex")?.reading.kind).toBe("buckets");
  });

  /**
   * A reading that cannot be shown to belong to this account is discarded
   * ENTIRELY, not shown under a caveat. The windows are a real reading of
   * something; what nothing establishes is whose.
   */
  it("discards the windows when the live identity does not match the registry pin", async () => {
    const stored = await collectAccountUsage(
      deps({
        registry: async () => ({
          kind: "value",
          schema: 1,
          accounts: [entry({ name: "mindstone", family: "claude", stateDir: "/home/tester/.claude-mindstone" })],
        }),
        claudeUsage: async (configDir) =>
          claudeValue({
            configDir,
            identity: { providerAccountId: "provider-somebody-else", providerTenantId: "tenant-mindstone", displayEmail: "other@example.com" },
          }),
      }),
    );
    if (stored.kind !== "reading") throw new Error(stored.why);
    const mindstone = stored.accounts.find((section) => section.name === "mindstone");
    expect(mindstone?.reading.kind).toBe("unknown");
    expect(JSON.stringify(mindstone)).not.toContain("utilizationPercent");
    expect(mindstone?.providerAccountId).toBeNull();
  });

  /** The organisation is half of Claude's pin and a mismatch there is a mismatch. */
  it("discards the windows when the organisation does not match either", async () => {
    const stored = await collectAccountUsage(
      deps({
        registry: async () => ({
          kind: "value",
          schema: 1,
          accounts: [entry({ name: "mindstone", family: "claude", stateDir: "/home/tester/.claude-mindstone" })],
        }),
        claudeUsage: async (configDir) =>
          claudeValue({
            configDir,
            identity: {
              providerAccountId: "provider-mindstone",
              providerTenantId: "tenant-somebody-else",
              displayEmail: "greg@mindstone.com",
            },
          }),
      }),
    );
    if (stored.kind !== "reading") throw new Error(stored.why);
    expect(stored.accounts.find((section) => section.name === "mindstone")?.reading).toEqual({
      kind: "unknown",
      why: expect.stringContaining("different organisation"),
    });
  });
});

describe("collectAccountUsage never draws a number under an unproved account", () => {
  it("normalises the provider's real microsecond reset spelling before it reaches strict wire readers", async () => {
    const stored = await collectAccountUsage(
      deps({
        claudeUsage: async (configDir) => claudeValue({
          configDir,
          windows: [{
            kind: "value",
            window: "five_hour",
            utilizationPercent: 12,
            resetsAt: "2026-09-10T09:00:00.549914+00:00",
            resetsAtMs: Date.parse("2026-09-10T09:00:00.549914+00:00"),
            msUntilReset: 10_800_000,
          }],
        }),
      }),
    );
    if (stored.kind !== "reading") throw new Error(stored.why);
    const claude = stored.accounts.find((section) => section.family === "claude");
    if (claude?.family !== "claude" || claude.reading.kind !== "windows") throw new Error("expected Claude windows");
    expect(claude.reading.windows[0]).toMatchObject({ resetsAt: "2026-09-10T09:00:00.549Z" });
  });

  it("refuses persisted numeric arms whose provider identity is null", () => {
    const raw = {
      name: "ambient",
      family: "claude",
      role: "orchestrator",
      origin: "ambient",
      displayEmail: null,
      providerAccountId: null,
      takenAt: NOW.toISOString(),
      reading: {
        kind: "windows",
        windows: [{
          kind: "value",
          window: "five_hour",
          utilizationPercent: 91,
          resetsAt: "2026-09-10T09:00:00.000Z",
        }],
      },
    };
    expect(parseAccountUsageSections([raw])).toBeNull();
  });

  it("refuses persisted percentages outside the provider's 0–100 contract", () => {
    const raw = {
      name: "ambient",
      family: "claude",
      role: "orchestrator",
      origin: "ambient",
      displayEmail: null,
      providerAccountId: "provider-ambient",
      takenAt: NOW.toISOString(),
      reading: {
        kind: "windows",
        windows: [{
          kind: "value",
          window: "five_hour",
          utilizationPercent: 101,
          resetsAt: "2026-09-10T09:00:00.000Z",
        }],
      },
    };
    expect(parseAccountUsageSections([raw])).toBeNull();
  });

  /**
   * The app-server may answer without saying whose numbers these are, and the
   * ambient read supplies no id to pin against — so `enforceExpectedAccount`
   * never sees it. A percentage under a heading saying *ambient Codex* that
   * nothing ties to any subscription is the claim this page may not make.
   * GPT Sol's P1, 2026-09-10.
   */
  it("refuses an ambient Codex reading that does not say which account it is", async () => {
    const stored = await collectAccountUsage(deps(), codexValue({ accountId: null }));
    if (stored.kind !== "reading") throw new Error(stored.why);
    const codex = stored.accounts.find((section) => section.family === "codex");
    expect(codex?.reading).toEqual({ kind: "unknown", why: expect.stringContaining("without saying which account") });
    expect(codex?.providerAccountId).toBeNull();
    expect(JSON.stringify(codex?.reading)).not.toMatch(/usedPercent/);
  });

  it("gives an unknown reading no percentage field of any kind", async () => {
    const stored = await collectAccountUsage(
      deps({ claudeUsage: async (configDir) => ({ kind: "unknown", configDir, takenAt: NOW.toISOString(), why: "access token is unavailable" }) }),
    );
    if (stored.kind !== "reading") throw new Error(stored.why);
    const claude = stored.accounts.find((section) => section.family === "claude");
    // Not "does not equal 0" — a bug producing NaN or undefined would pass that.
    // The claim is that no numeric utilisation field exists on this arm at all.
    expect(JSON.stringify(claude?.reading)).not.toMatch(/utilizationPercent|usedPercent/);
  });

  it("carries an expired window across without its stale percentage", async () => {
    const stored = await collectAccountUsage(deps());
    if (stored.kind !== "reading") throw new Error(stored.why);
    const claude = stored.accounts.find((section) => section.family === "claude");
    if (claude?.family !== "claude" || claude.reading.kind !== "windows") throw new Error("expected windows");
    const expired = claude.reading.windows.find((window) => window.window === "seven_day");
    expect(expired?.kind).toBe("expired");
    expect(expired).not.toHaveProperty("utilizationPercent");
    // The number survives as prose, where it cannot be mistaken for a reading.
    expect(expired && "why" in expired ? expired.why : "").toContain("41%");
  });

  it("dates each section by its own reading rather than by the pass", async () => {
    const stored = await collectAccountUsage(deps(), AMBIENT_CODEX);
    if (stored.kind !== "reading") throw new Error(stored.why);
    const claude = stored.accounts.find((section) => section.family === "claude");
    const codex = stored.accounts.find((section) => section.family === "codex");
    expect(claude?.takenAt).toBe("2026-09-10T05:59:30.000Z");
    expect(codex?.takenAt).toBe("2026-09-10T05:59:45.000Z");
    expect(stored.collectedAt).toBe(NOW.toISOString());
  });
});

describe("collectAccountUsage refuses to show one subscription as two", () => {
  it("refuses two persisted names for one provider subscription", async () => {
    const stored = await collectAccountUsage(deps());
    if (stored.kind !== "reading") throw new Error(stored.why);
    const section = stored.accounts.find((candidate) => candidate.family === "claude");
    if (section === undefined) throw new Error("expected a Claude section");
    expect(parseAccountUsageSections([section, { ...section, name: "alias" }])).toBeNull();
  });

  /**
   * DIRECTORY EQUALITY IS NOT SUBSCRIPTION EQUALITY. Two distinct state
   * directories can hold the same login — a copied home, a symlink, a second
   * `claude login` against the same account — and because the ambient account
   * is absent from the registry, the registry's own uniqueness rules cannot see
   * it. Two sections then imply two subscriptions and twice the headroom.
   * GPT Sol's P1, 2026-09-10.
   */
  it("collapses two sections that turn out to be the same login, and says so loudly", async () => {
    const stored = await collectAccountUsage(
      deps({
        // A registered account and the ambient login, at different paths, both
        // answering with the same provider identity.
        registry: async () => ({
          kind: "value",
          schema: 1,
          accounts: [entry({ name: "mindstone", family: "claude", stateDir: "/home/tester/.claude-copy" })],
        }),
        claudeUsage: async (configDir) => claudeValue({ configDir }),
      }),
    );
    if (stored.kind !== "reading") throw new Error(stored.why);
    expect(stored.accounts.filter((section) => section.family === "claude")).toHaveLength(1);
    expect(stored.accounts[0]?.name).toBe("mindstone");
    expect(stored.problems).toEqual([expect.stringContaining("same claude subscription reached two ways")]);
  });

  /**
   * Two sections nobody could identify are NOT one subscription — they are two
   * unknowns. Merging them would invent exactly the fact that is missing.
   */
  it("keeps two unidentified sections apart rather than merging them", async () => {
    const stored = await collectAccountUsage(
      deps({
        registry: async () => ({
          kind: "value",
          schema: 1,
          accounts: [entry({ name: "mindstone", family: "claude", stateDir: "/home/tester/.claude-mindstone" })],
        }),
        claudeUsage: async (configDir) => ({
          kind: "unknown",
          configDir,
          takenAt: NOW.toISOString(),
          why: "access token is unavailable",
        }),
      }),
    );
    if (stored.kind !== "reading") throw new Error(stored.why);
    expect(stored.accounts.filter((section) => section.family === "claude")).toHaveLength(2);
    expect(stored.problems).toEqual([]);
  });
});

describe("collectAccountUsage refuses to let a short list pass for a complete one", () => {
  it("says so in problems when the registry could not be read", async () => {
    const stored = await collectAccountUsage(
      deps({ registry: async () => ({ kind: "error", why: "registry.json is not valid JSON" }) }),
      AMBIENT_CODEX,
    );
    if (stored.kind !== "reading") throw new Error(stored.why);
    expect(stored.accounts.map((section) => section.name)).toEqual(["ambient", "ambient"]);
    expect(stored.problems).toEqual([expect.stringContaining("registry.json is not valid JSON")]);
  });

  /**
   * A TOTAL FAILURE IS STILL A FULL LIST OF SECTIONS, EACH SAYING WHY.
   *
   * This is the property that makes the empty-reading arm unreachable in
   * practice, and it is the one worth pinning: every target the box knows about
   * produces a row, so "nothing could be read" shows as a page of stated
   * failures rather than as a page of nothing. A collector that dropped failed
   * accounts would shrink the list silently, which is the same lie as the empty
   * one told more quietly.
   */
  it("still lists every account when every single read fails", async () => {
    const stored = await collectAccountUsage(
      deps({
        registry: async () => ({
          kind: "value",
          schema: 1,
          accounts: [
            entry({ name: "mindstone", family: "claude", stateDir: "/home/tester/.claude" }),
            entry({ name: "codexone", family: "codex", stateDir: "/home/tester/.codex" }),
          ],
        }),
        claudeUsage: async () => {
          throw new Error("socket hang up");
        },
        codexUsage: async () => ({ kind: "unknown", why: "codex app-server gave no rate-limit reply", retryable: true }),
      }),
      AMBIENT_CODEX,
    );
    if (stored.kind !== "reading") throw new Error(stored.why);
    // Both ambient logins are covered by the registry entries above, so this is
    // two accounts rather than four — the dedup rule and the failure rule at once.
    expect(stored.accounts.map((section) => section.name)).toEqual(["mindstone", "codexone"]);
    expect(stored.accounts.every((section) => section.reading.kind === "unknown")).toBe(true);
  });
});
