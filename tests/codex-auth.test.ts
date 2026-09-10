import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCodexAuth, readCodexAuth } from "../tools/overseer/codex-auth.js";

const roots: string[] = [];
const AUTH_CLAIM = "https://api.openai.com/auth";

function token(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

function auth(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const payload = {
    email: "pool1@example.test",
    exp: 1_800_000_000,
    [AUTH_CLAIM]: {
      chatgpt_account_id: "account-pool1",
      chatgpt_plan_type: "pro",
      chatgpt_user_id: "user-greg",
      organizations: [
        { id: "org-pool1", is_default: true, role: "owner", title: "Personal" },
      ],
    },
  };
  return {
    auth_mode: "chatgpt",
    tokens: { account_id: "account-pool1", id_token: token(payload) },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex auth identity", () => {
  it("parses a ChatGPT credential and its workspaces", () => {
    expect(parseCodexAuth(auth(), "/home/test/.codex-pool1")).toEqual({
      kind: "value",
      stateDir: "/home/test/.codex-pool1",
      identity: {
        accountId: "account-pool1",
        email: "pool1@example.test",
        planType: "pro",
        chatgptUserId: "user-greg",
        workspaces: [
          { id: "org-pool1", isDefault: true, role: "owner", title: "Personal" },
        ],
        expiresAt: new Date(1_800_000_000 * 1000).toISOString(),
      },
    });
  });

  it("rejects an API-key credential as not being a subscription", () => {
    expect(parseCodexAuth(auth({ auth_mode: "apikey" }), "/state")).toMatchObject({
      kind: "unknown",
      why: expect.stringMatching(/auth_mode.*apikey/i),
    });
  });

  it.each([undefined, ""])('rejects tokens.account_id=%s', (accountId) => {
    const value = auth();
    value.tokens = { ...(value.tokens as object), account_id: accountId };
    expect(parseCodexAuth(value, "/state")).toMatchObject({
      kind: "unknown",
      why: expect.stringMatching(/tokens\.account_id/i),
    });
  });

  it("rejects a disagreement between the token envelope and id-token account ids", () => {
    const value = auth();
    value.tokens = {
      account_id: "account-pool2",
      id_token: (value.tokens as Record<string, unknown>).id_token,
    };
    expect(parseCodexAuth(value, "/state")).toMatchObject({
      kind: "unknown",
      why: expect.stringMatching(/account.*mismatch|does not match/i),
    });
  });

  it.each([
    ["not three segments", "only.two"],
    ["non-JSON payload", `header.${Buffer.from("not json").toString("base64url")}.signature`],
    ["non-base64url payload", `header.${Buffer.from(JSON.stringify({ [AUTH_CLAIM]: { chatgpt_account_id: "account-pool1" } })).toString("base64url")}!.signature`],
  ])("rejects an id_token with %s", (_case, idToken) => {
    const value = auth();
    value.tokens = { account_id: "account-pool1", id_token: idToken };
    expect(parseCodexAuth(value, "/state")).toMatchObject({ kind: "unknown", why: expect.stringMatching(/id_token/i) });
  });

  it.each([
    ["absent", undefined, []],
    ["empty", [], []],
    ["populated", [{ id: "org-pool1", is_default: false, role: "member", title: null }], [
      { id: "org-pool1", isDefault: false, role: "member", title: null },
    ]],
  ])("accepts an organizations array that is %s", (_case, organizations, expected) => {
    const claim: Record<string, unknown> = {
      chatgpt_account_id: "account-pool1",
      chatgpt_plan_type: "pro",
      chatgpt_user_id: "user-greg",
    };
    if (organizations !== undefined) claim.organizations = organizations;
    const value = auth({
      tokens: {
        account_id: "account-pool1",
        id_token: token({ [AUTH_CLAIM]: claim }),
      },
    });
    const parsed = parseCodexAuth(value, "/state");
    expect(parsed).toMatchObject({ kind: "value" });
    if (parsed.kind === "value") expect(parsed.identity.workspaces).toEqual(expected);
  });

  it("reports an expired exp without refusing the credential", () => {
    const value = auth({
      tokens: {
        account_id: "account-pool1",
        id_token: token({
          exp: 1,
          [AUTH_CLAIM]: { chatgpt_account_id: "account-pool1" },
        }),
      },
    });
    expect(parseCodexAuth(value, "/state")).toMatchObject({
      kind: "value",
      identity: { expiresAt: "1970-01-01T00:00:01.000Z" },
    });
  });

  it("distinguishes a missing auth file from malformed JSON", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-auth-test-"));
    roots.push(root);
    const missing = await readCodexAuth(root);
    await writeFile(path.join(root, "auth.json"), "not json\n");
    const malformed = await readCodexAuth(root);
    expect(missing).toMatchObject({ kind: "unknown", why: expect.stringMatching(/missing|does not exist/i) });
    expect(malformed).toMatchObject({ kind: "unknown", why: expect.stringMatching(/malformed|valid JSON/i) });
    if (missing.kind === "unknown" && malformed.kind === "unknown") expect(missing.why).not.toBe(malformed.why);
  });

  it("returns unknown rather than throwing when auth.json is absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-auth-missing-test-"));
    roots.push(root);
    await mkdir(path.join(root, "still-empty"));
    await expect(readCodexAuth(path.join(root, "still-empty"))).resolves.toMatchObject({ kind: "unknown" });
  });
});
