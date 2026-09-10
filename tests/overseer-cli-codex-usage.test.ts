/** The dedicated usage command prints and serialises both subscription readings. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as babelParse } from "@babel/parser";
import type { Node } from "@babel/types";
import { describe, expect, it } from "vitest";

import { runUsageCommand, usageJson, usageLines } from "../scripts/overseer.js";
import type { CodexUsageReading, StoredAccountUsage, UsageReport } from "../tools/fleet/wire.js";
import { collectAccountUsage } from "../tools/overseer/account-usage.js";
import type {
  AccountEntry,
  AccountUsageReading,
  RegistryReading,
} from "../tools/overseer/accounts.js";

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

const TAKEN_AT = "2026-09-10T08:30:00.000Z";

function registeredAccount(
  name: string,
  role: AccountEntry["role"],
  email: string,
  accountUuid: string,
): AccountEntry {
  return {
    name,
    family: "claude",
    role,
    stateDir: `/accounts/${name}`,
    providerAccountId: accountUuid,
    providerTenantId: `org-${name}`,
    displayEmail: email,
    addedAt: "2026-09-09T20:00:00.000Z",
    familyData: {},
  };
}

const MINDSTONE = registeredAccount("mindstone", "pool", "greg@mindstone.com", "894bf540-aaaa-bbbb-cccc-000000000001");
const ORCHESTRATOR = registeredAccount("greg", "orchestrator", "greg@example.test", "12345678-aaaa-bbbb-cccc-000000000002");
const REGISTRY: RegistryReading = { kind: "value", schema: 1, accounts: [MINDSTONE, ORCHESTRATOR] };
/**
 * The CLI's `accounts` seam, driven through the REAL collector.
 *
 * `runUsageCommand` used to take a registry reader and a per-directory usage
 * reader and do the identity pin itself, which was a second implementation of a
 * rule the daemon also holds. It now takes one collector, shared with the
 * daemon — so these tests build that collector out of the same injected leaves
 * and exercise the production pin rather than a copy of it.
 *
 * The ambient directories are pointed at paths no fixture uses, so an ambient
 * section is one more predictable row rather than a surprise: the tests that
 * care assert on named accounts.
 */
function accountsFrom(
  registry: () => Promise<RegistryReading>,
  claudeUsage: (configDir: string) => Promise<AccountUsageReading>,
): () => Promise<StoredAccountUsage> {
  return () =>
    collectAccountUsage({
      registry,
      /* THE AMBIENT DIRECTORY IS ANSWERED HERE, NOT BY THE TEST'S READER.
         Every reader below is a catch-all — `configDir === MINDSTONE.stateDir ?
         … : liveUsage(ORCHESTRATOR)` — so without this the ambient login would
         answer with a REGISTERED account's identity, and the collector would
         quite correctly collapse the two as one subscription. Which is the
         dedup working, and a confusing thing to have every fixture do. */
      claudeUsage: async (configDir) =>
        configDir === AMBIENT_CLAUDE_DIR
          ? {
              kind: "unknown",
              configDir,
              takenAt: "2026-09-10T06:00:00.000Z",
              why: "there is no ambient login in these tests",
            }
          : claudeUsage(configDir),
      codexUsage: async () => {
        throw new Error("these tests register no Codex accounts");
      },
      ambientClaudeDir: () => AMBIENT_CLAUDE_DIR,
      ambientCodexHome: () => "/nowhere/.codex",
      now: () => new Date("2026-09-10T06:00:00.000Z"),
    });
}

/** The one section every fixture below gets for free, and which none of them is about. */
const AMBIENT_CLAUDE_DIR = "/nowhere/.claude";
const AMBIENT_SECTION = {
  name: "ambient",
  family: "claude",
  role: "orchestrator",
  origin: "ambient",
  displayEmail: null,
  providerAccountId: null,
  takenAt: "2026-09-10T06:00:00.000Z",
  reading: { kind: "unknown", why: "there is no ambient login in these tests" },
};

const NO_REGISTERED_ACCOUNTS = {
  accounts: accountsFrom(
    async (): Promise<RegistryReading> => ({ kind: "ambient", accounts: [] }),
    async (): Promise<AccountUsageReading> => {
      throw new Error("no registered account should be read here");
    },
  ),
};

function liveUsage(
  account: AccountEntry,
  fiveHour = 2,
  sevenDay = 3,
): Extract<AccountUsageReading, { kind: "value" }> {
  return {
    kind: "value",
    configDir: account.stateDir,
    takenAt: TAKEN_AT,
    identity: {
      providerAccountId: account.providerAccountId,
      providerTenantId: account.providerTenantId,
      ...(account.displayEmail === undefined ? {} : { displayEmail: account.displayEmail }),
    },
    windows: [
      {
        kind: "value",
        window: "seven_day",
        utilizationPercent: sevenDay,
        resetsAt: "2026-09-17T08:30:00.000Z",
        resetsAtMs: Date.parse("2026-09-17T08:30:00.000Z"),
        msUntilReset: 7 * 24 * 60 * 60_000,
      },
      {
        kind: "value",
        window: "five_hour",
        utilizationPercent: fiveHour,
        resetsAt: "2026-09-10T13:30:00.000Z",
        resetsAtMs: Date.parse("2026-09-10T13:30:00.000Z"),
        msUntilReset: 5 * 60 * 60_000,
      },
    ],
  };
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function containsNamedCall(node: Node, name: string): boolean {
  if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === name) return true;
  return Object.values(node).some((value) =>
    Array.isArray(value)
      ? value.some((child) => isNode(child) && containsNamedCall(child, name))
      : isNode(value) && containsNamedCall(value, name),
  );
}

function usageCaseCallsRunUsageCommand(sourceText: string): boolean {
  const source = babelParse(sourceText, { sourceType: "module", plugins: ["typescript"] });
  let found = false;
  const visit = (node: Node): void => {
    if (
      node.type === "SwitchCase" &&
      node.test?.type === "StringLiteral" &&
      node.test.value === "usage" &&
      containsNamedCall(node, "runUsageCommand")
    ) {
      found = true;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child);
      } else if (isNode(value)) {
        visit(value);
      }
    }
  };
  visit(source);
  return found;
}

describe("overseer usage", () => {
  it("dispatches the production usage case through runUsageCommand", () => {
    const source = readFileSync(fileURLToPath(new URL("../scripts/overseer.ts", import.meta.url)), "utf8");
    expect(usageCaseCallsRunUsageCommand(source)).toBe(true);
  });

  it("prints both accounts and retains the Claude scan's positive control", () => {
    const text = usageLines(CLAUDE, CODEX).join("\n");
    expect(text).toContain("Claude subscription");
    expect(text).toContain("Codex subscription");
    expect(text).toContain("124% used");
    expect(text).toContain("RATE LIMIT REACHED — weekly");
    expect(text).toContain("scanned   4/4 of 4 transcripts, 900 lines");
    expect(text).not.toContain("API credits");
  });

  it.each([
    [
      "unknown spend-control state",
      { spendControlReached: null },
      "spend-control state was reached or unavailable",
    ],
    [
      "an individual spend limit",
      {
        spendControlReached: false,
        individualLimit: { limit: "10", used: "10", remainingPercent: 0, resetsAt: 1_789_473_600 },
      },
      "an individual spend limit was reported",
    ],
  ])("withholds general percentages when the reading carries %s", (_name, over, why) => {
    const general = {
      ...CODEX.buckets[0]!,
      rateLimitReachedType: null,
      ...over,
      windows: [{ ...CODEX.buckets[0]!.windows[0]!, usedPercent: 0 }],
    };
    const text = usageLines(CLAUDE, { ...CODEX, buckets: [general] }).join("\n");
    expect(text).toContain(why);
    expect(text).not.toContain("0% used");
  });

  it("adds Codex to --json rather than leaving the old Claude-only report", async () => {
    /* No per-account pass was run for this call, and the JSON says so with a
       reason rather than with an empty list — an empty list would read as "this
       box has no account-subscriptions", which is a claim. */
    expect(usageJson(CLAUDE, CODEX)).toEqual({
      ...CLAUDE,
      codex: CODEX,
      accounts: { kind: "none", why: expect.stringContaining("no per-account pass"), at: expect.any(String) },
    });
    const output: string[] = [];
    await runUsageCommand(
      { command: "usage", json: true },
      {
        claude: async () => CLAUDE,
        codex: async () => CODEX,
        ...NO_REGISTERED_ACCOUNTS,
        out: (line) => output.push(line),
      },
    );
    expect(JSON.parse(output.join("\n"))).toEqual({
      ...CLAUDE,
      codex: CODEX,
      accounts: { kind: "reading", collectedAt: expect.any(String), problems: [], accounts: [AMBIENT_SECTION] },
    });
  });

  it("prints every registered Claude account with identity, five-hour then seven-day usage, and reading time", async () => {
    const output: string[] = [];
    await runUsageCommand(
      { command: "usage", json: false },
      {
        claude: async () => CLAUDE,
        codex: async () => CODEX,
        accounts: accountsFrom(async () => REGISTRY, async (configDir) => liveUsage(configDir === MINDSTONE.stateDir ? MINDSTONE : ORCHESTRATOR, configDir === MINDSTONE.stateDir ? 2 : 4, configDir === MINDSTONE.stateDir ? 3 : 5)),
        out: (line) => output.push(line),
      },
    );

    const text = output.join("\n");
    expect(text).toContain("Claude accounts (registry)");
    expect(text).toMatch(/mindstone\s+pool\s+greg@mindstone\.com\s+5h 2%\s+7d 3%\s+uuid 894bf540…/);
    expect(text).toMatch(/greg\s+orchestrator\s+greg@example\.test\s+5h 4%\s+7d 5%\s+uuid 12345678…/);
    expect(text).toContain(TAKEN_AT);
    expect(text.indexOf("5h 2%")).toBeLessThan(text.indexOf("7d 3%"));
  });

  it("leaves text output byte-identical when the registry file is absent", async () => {
    const output: string[] = [];
    let accountReads = 0;
    await runUsageCommand(
      { command: "usage", json: false },
      {
        claude: async () => CLAUDE,
        codex: async () => CODEX,
        accounts: accountsFrom(async () => ({ kind: "ambient", accounts: [] }), async () => {
          accountReads += 1;
          throw new Error("must not read an account without a registry");
        }),
        out: (line) => output.push(line),
      },
    );

    expect(output).toEqual([[
      "Claude subscription",
      "account   greg@example.test  max  tier ?  uuid acct-a",
      "verdict   OK",
      "          no limit hit",
      "cache     could not tell: no cache",
      "scanned   4/4 of 4 transcripts, 900 lines, 0 candidates, 40ms",
      "429       none in the scanned window — believable only against the `scanned` line above",
      "took      40ms, at 2026-09-09 12:00 UTC · 13:00 London · 15:00 Athens",
      "",
      "Codex subscription",
      "account   account-redacted",
      "reading   at 2026-09-09 11:59 UTC · 12:59 London · 14:59 Athens",
      "headroom  codex",
      "          RATE LIMIT REACHED — weekly",
      "          7 days: 124% used, resets 2026-09-15 01:23 UTC · 02:23 London · 04:23 Athens",
      "resets    2 full reset credits available",
    ].join("\n")]);
    expect(accountReads).toBe(0);
  });

  /**
   * **A BROKEN REGISTRY IS LOUD AND STILL USEFUL**, which changed on 2026-09-10.
   *
   * This command used to throw before printing anything, so a person whose
   * registry file had a stray comma got no usage reading at all — including the
   * ambient account's, which needs no registry to read. Now everything readable
   * is printed, the fault is printed beside it, and the exit code still says
   * something is wrong. The test pins all three: printing the fault while
   * exiting 0 would be the quiet failure this replaced the loud-but-useless one
   * to avoid.
   */
  it("prints a malformed registry as a loud problem and exits non-zero", async () => {
    const output: string[] = [];
    const code = await runUsageCommand(
      { command: "usage", json: false },
      {
        claude: async () => CLAUDE,
        codex: async () => CODEX,
        accounts: accountsFrom(async () => ({ kind: "error", why: "registry.json is not valid JSON" }), async () => liveUsage(MINDSTONE)),
        out: (line) => output.push(line),
      },
    );
    const text = output.join("\n");
    expect(code).toBe(1);
    expect(text).toMatch(/! .*registry\.json is not valid JSON/);
    /* And the readings it COULD take are still there. */
    expect(text).toContain("Claude subscription");
    expect(text).toContain("Codex subscription");
  });

  it("does not mislabel an unreadable registry as malformed", async () => {
    const output: string[] = [];
    const code = await runUsageCommand(
      { command: "usage", json: false },
      {
        claude: async () => CLAUDE,
        codex: async () => CODEX,
        accounts: accountsFrom(async () => ({ kind: "error", why: "could not read account registry at /accounts/registry.json" }), async () => liveUsage(MINDSTONE)),
        out: (line) => output.push(line),
      },
    );
    expect(code).toBe(1);
    expect(output.join("\n")).toMatch(/! .*could not read account registry at \/accounts\/registry\.json/);
  });

  it("keeps reporting other accounts when one live reading is unknown", async () => {
    const output: string[] = [];
    const code = await runUsageCommand(
      { command: "usage", json: false },
      {
        claude: async () => CLAUDE,
        codex: async () => CODEX,
        accounts: accountsFrom(async () => REGISTRY, async (configDir) =>
          configDir === MINDSTONE.stateDir
            ? {
                kind: "unknown",
                configDir,
                takenAt: TAKEN_AT,
                why: "usage request failed with HTTP 401",
                status: 401,
              }
            : liveUsage(ORCHESTRATOR, 6, 8),
        ),
        out: (line) => output.push(line),
      },
    );

    const text = output.join("\n");
    expect(code).toBe(0);
    expect(text).toMatch(/mindstone.*5h unknown.*7d unknown.*HTTP 401/);
    expect(text).toMatch(/greg.*5h 6%.*7d 8%/);
  });

  it("withholds usage when the live email does not match the registered identity", async () => {
    const output: string[] = [];
    const mismatched = {
      ...liveUsage(MINDSTONE, 91, 92),
      identity: {
        ...liveUsage(MINDSTONE).identity,
        displayEmail: "different@example.test",
      },
    };
    await runUsageCommand(
      { command: "usage", json: false },
      {
        claude: async () => CLAUDE,
        codex: async () => CODEX,
        accounts: accountsFrom(async () => ({ kind: "value", schema: 1, accounts: [MINDSTONE] }), async () => mismatched),
        out: (line) => output.push(line),
      },
    );

    const accountBlock = output.join("\n").split("Claude accounts (registry)")[1]!;
    expect(accountBlock).toContain("live identity does not match the registry pin");
    expect(accountBlock).not.toContain("different@example.test");
    expect(accountBlock).not.toContain("91%");
    expect(accountBlock).not.toContain("92%");
  });

  it("prints an expired window without exposing its stale percentage", async () => {
    const output: string[] = [];
    const expired: AccountUsageReading = {
      ...liveUsage(MINDSTONE),
      windows: [
        {
          kind: "expired",
          window: "five_hour",
          resetsAt: "2026-09-10T08:00:00.000Z",
          resetsAtMs: Date.parse("2026-09-10T08:00:00.000Z"),
          msSinceReset: 30 * 60_000,
          why: "this window reset 30 minutes ago, so 88% is stale",
        },
        liveUsage(MINDSTONE).windows.find((window) => window.window === "seven_day")!,
      ],
    };
    await runUsageCommand(
      { command: "usage", json: false },
      {
        claude: async () => CLAUDE,
        codex: async () => CODEX,
        accounts: accountsFrom(async () => ({ kind: "value", schema: 1, accounts: [MINDSTONE] }), async () => expired),
        out: (line) => output.push(line),
      },
    );

    const accountBlock = output.join("\n").split("Claude accounts (registry)")[1]!;
    expect(accountBlock).toContain("5h expired");
    expect(accountBlock).not.toContain("88%");
  });

  it("adds per-account readings to --json without changing the existing top-level report", async () => {
    const output: string[] = [];
    await runUsageCommand(
      { command: "usage", json: true },
      {
        claude: async () => CLAUDE,
        codex: async () => CODEX,
        accounts: accountsFrom(async () => REGISTRY, async (configDir) => liveUsage(configDir === MINDSTONE.stateDir ? MINDSTONE : ORCHESTRATOR)),
        out: (line) => output.push(line),
      },
    );

    const { accounts, ...existing } = JSON.parse(output.join("\n"));
    expect(existing).toEqual({ ...CLAUDE, codex: CODEX });
    /* The ambient section rides along in the JSON even though the printed block
       filters it out: `--json` is the machine-readable form of everything the
       pass read, and the duplication argument is about what a person reads. */
    expect(accounts.accounts.map((section: { name: string }) => section.name)).toEqual([
      "ambient",
      "greg",
      "mindstone",
    ]);
    expect(accounts.accounts.find((section: { name: string }) => section.name === "mindstone")).toMatchObject({
      family: "claude",
      role: "pool",
      origin: "registered",
      displayEmail: MINDSTONE.displayEmail,
      providerAccountId: MINDSTONE.providerAccountId,
      reading: { kind: "windows" },
    });
  });

  it("still prints Claude and its positive control when the Codex collector rejects", async () => {
    const output: string[] = [];
    await runUsageCommand(
      { command: "usage", json: false },
      {
        claude: async () => CLAUDE,
        codex: async () => { throw new Error("temporary failure"); },
        ...NO_REGISTERED_ACCOUNTS,
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
