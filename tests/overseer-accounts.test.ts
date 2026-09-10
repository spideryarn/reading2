import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseLiveUsageResponse,
  parseAccountRegistry,
  poolAccounts,
  readAccountRegistry,
  readProfile,
  readUsage,
  resolveAccount,
  type AccountEntry,
} from "../tools/overseer/accounts.js";

const tempDirs: string[] = [];
const NOW = Date.parse("2026-09-09T20:00:00.000Z");

const main: AccountEntry = {
  name: "main",
  family: "claude",
  role: "orchestrator",
  stateDir: "/home/test/.claude",
  providerAccountId: "account-main",
  providerTenantId: "org-main",
  displayEmail: "main@example.test",
  addedAt: "2026-09-09T19:00:00.000Z",
  familyData: {},
};

const pool: AccountEntry = {
  name: "pool-a",
  family: "claude",
  role: "pool",
  stateDir: "/home/test/.claude-pool-a",
  providerAccountId: "account-pool",
  providerTenantId: "org-pool",
  displayEmail: "pool@example.test",
  addedAt: "2026-09-09T19:01:00.000Z",
  familyData: {},
};

function registry(accounts: unknown[]): unknown {
  return { schema: 1, accounts };
}

async function configDir(token = "credential-that-must-never-escape"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "spideryarn-accounts-"));
  tempDirs.push(dir);
  await writeFile(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: "never-use-this" } }));
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("account registry parsing", () => {
  it("rejects an unknown role", () => {
    expect(parseAccountRegistry(registry([{ ...main, role: "worker" }]))).toMatchObject({ kind: "error", why: expect.stringContaining("role") });
  });

  it("rejects an unknown family", () => {
    expect(parseAccountRegistry(registry([{ ...main, family: "gemini" }]))).toMatchObject({ kind: "error", why: expect.stringContaining("family") });
  });

  it("rejects duplicate names", () => {
    expect(parseAccountRegistry(registry([main, { ...pool, name: main.name }]))).toMatchObject({ kind: "error", why: expect.stringContaining("duplicate") });
  });

  it("rejects an account name that cannot safely cross the launcher shell boundary", () => {
    expect(parseAccountRegistry(registry([{ ...pool, name: "pool one" }]))).toMatchObject({
      kind: "error",
      why: expect.stringContaining("name"),
    });
  });

  it.each(["auto", "ambient"])("rejects the reserved launcher name %s", (name) => {
    expect(parseAccountRegistry(registry([{ ...pool, name }]))).toMatchObject({
      kind: "error",
      why: expect.stringContaining("reserved"),
    });
  });

  it("rejects a relative stateDir", () => {
    expect(parseAccountRegistry(registry([{ ...main, stateDir: ".claude" }]))).toMatchObject({ kind: "error", why: expect.stringContaining("absolute") });
  });

  it("rejects a trailing slash on stateDir", () => {
    expect(parseAccountRegistry(registry([{ ...main, stateDir: "/home/test/.claude/" }]))).toMatchObject({ kind: "error", why: expect.stringContaining("trailing slash") });
  });

  it.each((Object.keys(main) as (keyof AccountEntry)[]).filter((field) => field !== "displayEmail"))(
    "rejects a missing required %s field",
    (field) => {
    const incomplete: Record<string, unknown> = { ...main };
    delete incomplete[field];
    expect(parseAccountRegistry(registry([incomplete]))).toMatchObject({ kind: "error", why: expect.stringContaining(field) });
    },
  );

  it("rejects more than one orchestrator in one family", () => {
    expect(parseAccountRegistry(registry([main, { ...pool, role: "orchestrator" }]))).toMatchObject({ kind: "error", why: expect.stringContaining("orchestrator") });
  });

  it("allows one orchestrator in each family", () => {
    const codex = {
      ...main,
      name: "codex-main",
      family: "codex",
      stateDir: "/home/test/.codex",
      providerAccountId: "codex-account-main",
      providerTenantId: "codex-org-main",
      displayEmail: undefined,
    };
    expect(parseAccountRegistry(registry([main, codex]))).toMatchObject({ kind: "value" });
  });

  it("requires an explicit nullable tenant for Codex and accepts null", () => {
    const codex = {
      ...pool,
      family: "codex",
      stateDir: "/home/test/.codex-pool-a",
      providerTenantId: null,
      familyData: { workspaces: [] },
    };
    expect(parseAccountRegistry(registry([codex]))).toMatchObject({
      kind: "value",
      accounts: [{ providerTenantId: null }],
    });

    const missing: Record<string, unknown> = { ...codex };
    delete missing.providerTenantId;
    expect(parseAccountRegistry(registry([missing]))).toMatchObject({
      kind: "error",
      why: expect.stringContaining("providerTenantId"),
    });
  });

  it("still rejects a Claude entry without a non-empty tenant", () => {
    expect(parseAccountRegistry(registry([{ ...pool, providerTenantId: null }]))).toMatchObject({
      kind: "error",
      why: expect.stringContaining("providerTenantId"),
    });
  });

  it("filters pool accounts by family while keeping Claude as the default", () => {
    const codex = {
      ...pool,
      name: "codex-pool",
      family: "codex" as const,
      stateDir: "/home/test/.codex-pool",
      providerAccountId: "account-codex-pool",
      providerTenantId: null,
    };
    const parsed = parseAccountRegistry(registry([main, pool, codex]));
    expect(poolAccounts(parsed)).toEqual([pool]);
    expect(poolAccounts(parsed, "codex")).toEqual([codex]);
  });

  it.each([
    ["stateDir", { ...pool, name: "pool-b", providerAccountId: "account-b", stateDir: "/home/test/x/../.claude" }],
    ["providerAccountId", { ...pool, name: "pool-b", stateDir: "/home/test/.claude-pool-b", providerAccountId: main.providerAccountId }],
  ])("rejects duplicate %s values", (field, duplicate) => {
    expect(parseAccountRegistry(registry([main, duplicate]))).toMatchObject({
      kind: "error",
      why: expect.stringContaining(field),
    });
  });

  it("rejects an unknown top-level schema", () => {
    expect(parseAccountRegistry({ schema: 2, accounts: [] })).toMatchObject({ kind: "error", why: expect.stringContaining("schema") });
  });

  it("returns a typed ambient reading when the registry file is missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spideryarn-accounts-missing-"));
    tempDirs.push(dir);
    expect(await readAccountRegistry(path.join(dir, "registry.json"))).toEqual({ kind: "ambient", accounts: [] });
  });

  it("resolves an account or returns a typed refusal", () => {
    const parsed = parseAccountRegistry(registry([main, pool]));
    expect(resolveAccount(parsed, "pool-a")).toEqual({ kind: "value", account: pool });
    expect(resolveAccount(parsed, "missing")).toMatchObject({ kind: "refused", why: expect.stringContaining("missing") });
  });

  it("never returns the orchestrator as a pool account", () => {
    expect(poolAccounts(parseAccountRegistry(registry([main, pool])))).toEqual([pool]);
  });
});

describe("live account identity and usage", () => {
  it("parses a live response with the observation identity rather than a fabricated cache identity", () => {
    const result = parseLiveUsageResponse(
      { five_hour: { utilization: 18, resets_at: "2026-09-09T21:00:00.000Z" } },
      {
        takenAt: "2026-09-09T20:00:00.000Z",
        identity: {
          providerAccountId: "account-a",
          providerTenantId: "org-a",
          displayEmail: "a@example.test",
        },
      },
    );
    expect(result).toMatchObject({
      kind: "value",
      takenAt: "2026-09-09T20:00:00.000Z",
      identity: { providerAccountId: "account-a", providerTenantId: "org-a" },
    });
  });

  // Red before the fix on 2026-09-10: the parser identified windows by
  // EXCLUDING two known non-window keys, so `member_dashboard_available` — a
  // bool the live endpoint really sends — made the whole body "malformed".
  // Every account then read `unknown`, and `auto` silently fell back to
  // least-recently-launched forever with the ranking inert. Shape copied from
  // the real 20-key response.
  it("reads a live body carrying non-window fields, including a scalar one", () => {
    const result = parseLiveUsageResponse(
      {
        five_hour: { utilization: 0, resets_at: "2026-09-10T04:49:59.549914+00:00" },
        seven_day: { utilization: 3, resets_at: "2026-09-15T01:59:59.549954+00:00" },
        seven_day_opus: null,
        nimbus_quill: { utilization: 0, resets_at: null },
        extra_usage: { is_enabled: false },
        limits: [{ kind: "session", percent: 0 }],
        spend: { some: "object that is not a window" },
        member_dashboard_available: true,
        seven_day_breakdown: null,
      },
      {
        takenAt: "2026-09-10T00:05:00.000Z",
        identity: { providerAccountId: "account-a", providerTenantId: "org-a", displayEmail: "a@example.test" },
      },
    );
    expect(result.kind).toBe("value");
    if (result.kind !== "value") return;
    const names = result.windows.map((w) => w.window);
    // The real windows are read...
    expect(names).toContain("five_hour");
    expect(names).toContain("seven_day");
    expect(names).toContain("nimbus_quill");
    // ...and the non-windows are not mistaken for any, which the old
    // exclusion-list approach would have done to `spend`.
    expect(names).not.toContain("spend");
    expect(names).not.toContain("member_dashboard_available");
    expect(names).not.toContain("limits");
    const sevenDay = result.windows.find((w) => w.window === "seven_day");
    expect(sevenDay).toMatchObject({ kind: "value", utilizationPercent: 3 });
  });

  it("treats an empty live usage body as unknown", () => {
    expect(parseLiveUsageResponse({}, {
      takenAt: "2026-09-09T20:00:00.000Z",
      identity: { providerAccountId: "account-a", providerTenantId: "org-a" },
    })).toMatchObject({ kind: "unknown" });
  });
  it("reads profile identity with the account and observation time attached", async () => {
    const dir = await configDir();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ account: { uuid: "account-a", email_address: "a@example.test" }, organization: { uuid: "org-a" } }), { status: 200 }),
    );
    const result = await readProfile(dir, { fetch: fetchImpl, now: () => NOW });

    expect(result).toEqual({
      kind: "value",
      configDir: dir,
      takenAt: "2026-09-09T20:00:00.000Z",
      accountUuid: "account-a",
      email: "a@example.test",
      orgId: "org-a",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.anthropic.com/api/oauth/profile",
      expect.objectContaining({
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: "Bearer credential-that-must-never-escape",
          "Content-Type": "application/json",
          "anthropic-beta": "oauth-2025-04-20",
          "User-Agent": expect.any(String),
        }),
      }),
    );
  });

  it("uses one token snapshot for profile and usage", async () => {
    const dir = await configDir("token-a");
    const seen: string[] = [];
    const result = await readUsage(dir, {
      fetch: async (url, init) => {
        const headers = init?.headers as Record<string, string> | undefined;
        seen.push(String(headers?.Authorization));
        if (String(url).endsWith("/profile")) {
          await writeFile(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "token-b" } }));
          return new Response(JSON.stringify({
            account: { uuid: "account-a", email_address: "a@example.test" },
            organization: { uuid: "org-a" },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          five_hour: { utilization: 18, resets_at: "2026-09-09T21:00:00.000Z" },
        }), { status: 200 });
      },
      now: () => NOW,
    });
    expect(seen).toEqual(["Bearer token-a", "Bearer token-a"]);
    expect(result).toMatchObject({
      kind: "value",
      identity: { providerAccountId: "account-a", providerTenantId: "org-a" },
    });
  });

  it.each(["profile", "usage"] as const)("treats a 401 from %s as unknown, not zero or an exception", async (endpoint) => {
    const token = "credential-that-must-never-escape";
    const dir = await configDir(token);
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const result = endpoint === "profile" ? await readProfile(dir, { fetch: fetchImpl, now: () => NOW }) : await readUsage(dir, { fetch: fetchImpl, now: () => NOW });

    expect(result).toMatchObject({ kind: "unknown", configDir: dir, takenAt: "2026-09-09T20:00:00.000Z" });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("0%");
  });

  it("retries profile once when another Claude process rotated the access token after a 401", async () => {
    const dir = await configDir("expired-token");
    const seen: string[] = [];
    const result = await readProfile(dir, {
      fetch: async (_url, init) => {
        const headers = init?.headers as Record<string, string> | undefined;
        const authorization = String(headers?.Authorization);
        seen.push(authorization);
        if (authorization === "Bearer expired-token") {
          await writeFile(path.join(dir, ".credentials.json"), JSON.stringify({
            claudeAiOauth: { accessToken: "rotated-token", refreshToken: "must-stay-unused" },
          }));
          return new Response("expired", { status: 401 });
        }
        return new Response(JSON.stringify({
          account: { uuid: "account-a", email_address: "a@example.test" },
          organization: { uuid: "org-a" },
        }), { status: 200 });
      },
      now: () => NOW,
    });

    expect(seen).toEqual(["Bearer expired-token", "Bearer rotated-token"]);
    expect(result).toMatchObject({ kind: "value", accountUuid: "account-a" });
    expect(JSON.stringify(result)).not.toContain("expired-token");
    expect(JSON.stringify(result)).not.toContain("rotated-token");
    expect(JSON.stringify(result)).not.toContain("must-stay-unused");
  });

  it.each(["profile", "usage"] as const)("treats a malformed %s body as unknown without leaking the token", async (endpoint) => {
    const token = "credential-that-must-never-escape";
    const dir = await configDir(token);
    const fetchImpl = vi.fn(async () => new Response(`not-json-${token}`, { status: 200 }));
    const result = endpoint === "profile" ? await readProfile(dir, { fetch: fetchImpl, now: () => NOW }) : await readUsage(dir, { fetch: fetchImpl, now: () => NOW });

    expect(result.kind).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("treats a structurally malformed JSON usage body as a top-level unknown", async () => {
    const dir = await configDir();
    let call = 0;
    const result = await readUsage(dir, {
      fetch: async () => {
        call += 1;
        return new Response(JSON.stringify(call === 1
          ? { account: { uuid: "account-a", email_address: "a@example.test" }, organization: { uuid: "org-a" } }
          : { five_hour: "not-an-object" }), { status: 200 });
      },
      now: () => NOW,
    });

    expect(result).toMatchObject({ kind: "unknown", why: "usage response was malformed" });
  });

  it("reuses usage window parsing, including expired windows with no percentage", async () => {
    const dir = await configDir();
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      new Response(JSON.stringify(String(url).endsWith("/profile")
        ? { account: { uuid: "account-a", email_address: "a@example.test" }, organization: { uuid: "org-a" } }
        : {
          five_hour: { utilization: 18, resets_at: "2026-09-09T21:00:00.000Z" },
          seven_day: { utilization: 85, resets_at: "2026-09-08T21:00:00.000Z" },
          nimbus_quill: { utilization: 0, resets_at: null },
          extra_usage: { utilization: 99 },
        }), { status: 200 }),
    );
    const result = await readUsage(dir, { fetch: fetchImpl, now: () => NOW });

    expect(result.kind).toBe("value");
    if (result.kind !== "value") throw new Error("expected value");
    expect(result.windows.find((window) => window.window === "five_hour")).toMatchObject({ kind: "value", utilizationPercent: 18 });
    const expired = result.windows.find((window) => window.window === "seven_day");
    expect(expired).toMatchObject({ kind: "expired" });
    expect(expired).not.toHaveProperty("utilizationPercent");
    expect(result.windows.find((window) => window.window === "nimbus_quill")).toMatchObject({ kind: "unknown" });
    expect(result.windows.some((window) => window.window === "extra_usage")).toBe(false);
  });

  it("does not expose a credential when the injected transport throws it", async () => {
    const token = "credential-that-must-never-escape";
    const dir = await configDir(token);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await readUsage(dir, { fetch: async () => Promise.reject(new Error(token)), now: () => NOW });

    expect(result.kind).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain(token);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("redacts the credential if a malformed response echoes it", async () => {
    const token = "credential-that-must-never-escape";
    const dir = await configDir(token);
    const result = await readUsage(dir, {
      fetch: async () =>
        new Response(JSON.stringify({ five_hour: { utilization: 12, resets_at: token } }), { status: 200 }),
      now: () => NOW,
    });

    expect(JSON.stringify(result)).not.toContain(token);
  });
});
