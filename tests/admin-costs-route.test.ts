/**
 * `GET /api/admin/costs` — the cost cube, for `/admin/costs`.
 * docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md.
 *
 * The stores are stubbed; the SQL is held in tests/admin-costs-store.test.ts.
 * What this pins is the route's own decisions:
 *
 * - it is behind the `/api/admin` gate, so nobody else reaches either store;
 * - it asks the cube **as the administrator**, which is what keeps other
 *   owners' slugs out of the answer;
 * - a bound that is not a UTC instant is a 400, never a quietly wider window;
 * - every row is categorised, every owner in the rows is listed — with
 *   `email: null` when the Auth service has no such account — and the answer
 *   says `no-store`.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Verifier } from "../src/auth.js";
import type { AdminCosts, CostCubeGroup } from "../src/cost-cube.js";
import { acceptAny, AUTHED_HEADERS, TEST_EMAIL, TEST_SUB } from "./helpers/authed.js";

const KNOWN = "00000000-0000-4000-8000-0000c0b70a01";
const NO_ACCOUNT = "00000000-0000-4000-8000-0000c0b70a02";
const BYSTANDER = "00000000-0000-4000-8000-0000c0b70a03";

const seen = vi.hoisted(() => ({
  calls: [] as string[],
  tooLarge: false,
}));

function group(over: Partial<CostCubeGroup>): CostCubeGroup {
  return {
    day: "2033-05-10",
    ownerId: TEST_SUB,
    articleId: null,
    articleSlug: null,
    recordedSlugHash: null,
    scopeKind: "job_step",
    job: "glossary",
    stepName: "glossary",
    wire: "messages",
    requestedModel: "vendor/asked",
    answeredModel: "vendor/asked",
    upstream: "Vendor",
    providerAccount: "openrouter",
    costSource: "provider",
    isByok: false,
    outcome: "ok",
    calls: 2,
    creditsNanos: 30_000_000,
    byokNanos: 0,
    computedNanos: 0,
    unpricedCalls: 0,
    computedCalls: 0,
    settledCalls: 2,
    ...over,
  };
}

vi.mock("../src/store/ai-calls-spend-pg.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/ai-calls-spend-pg.js")>(
    "../src/store/ai-calls-spend-pg.js",
  );
  return {
    ...actual,
    spendCube: async (since: string | undefined, until: string | undefined, asker: string) => {
      seen.calls.push(`spendCube(${since}, ${until}, ${asker})`);
      if (seen.tooLarge) throw new actual.SpendCubeTooLarge(actual.SPEND_CUBE_MAX_GROUPS);
      return [
        group({}),
        group({ ownerId: KNOWN, scopeKind: "request", job: "chat", stepName: null, wire: "chat" }),
        group({ ownerId: NO_ACCOUNT, scopeKind: "eval", job: "eval", stepName: null }),
        group({ ownerId: KNOWN, job: "summarise", stepName: "summary" }),
      ];
    },
  };
});

vi.mock("../src/store/admin-accounts.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/admin-accounts.js")>(
    "../src/store/admin-accounts.js",
  );
  const account = (id: string, email: string | null) => ({
    id,
    email,
    createdAt: null,
    lastSignInAt: null,
    emailConfirmedAt: null,
    providers: [],
  });
  return {
    ...actual,
    authAdminEndpoint: () => ({ url: "http://auth.invalid", key: "not-a-key" }),
    gotruePages: () => async () => {
      throw new Error("the stubbed listing never fetches a page");
    },
    listAccounts: async () => {
      seen.calls.push("listAccounts()");
      return [
        account(TEST_SUB, TEST_EMAIL),
        account(KNOWN, "known-reader@example.test"),
        account(BYSTANDER, "no-ledger-rows@example.test"),
      ];
    },
  };
});

const { handleApi } = await import("../src/routes.js");

const acceptSomebodyElse: Verifier = async () => ({
  ok: true,
  claims: {
    sub: randomUUID(),
    email: "somebody-else@example.test",
    role: "authenticated",
    is_anonymous: false,
  },
});

async function request(
  urlPath: string,
  verify: Verifier = acceptAny,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const req = Object.assign((async function* () {})(), {
    method: "GET",
    url: urlPath,
    headers: AUTHED_HEADERS,
  }) as unknown as IncomingMessage;
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  let status = 0;
  const res = {
    get statusCode() {
      return status;
    },
    set statusCode(v: number) {
      status = v;
    },
    writableEnded: false,
    destroyed: false,
    setHeader(name: string, value: unknown) {
      headers[name.toLowerCase()] = String(value);
    },
    flushHeaders() {},
    on() {},
    writeHead(code: number) {
      status = code;
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.from(chunk as never));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.from(chunk as never));
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, verify);
  return { status, headers, body: Buffer.concat(chunks).toString("utf8") };
}

const PATH = "/api/admin/costs";
const SINCE = "2033-05-01T00:00:00.000Z";
const UNTIL = "2033-06-01T00:00:00.000Z";

beforeEach(() => {
  seen.calls.length = 0;
  seen.tooLarge = false;
});

describe("the cost cube, for the administrator", () => {
  it("answers the window's rows, categorised, and says no-store", async () => {
    const sent = await request(`${PATH}?since=${SINCE}&until=${UNTIL}`);
    expect(sent.status).toBe(200);
    expect(sent.headers["cache-control"]).toBe("private, no-store");
    /* Asked as the administrator — the argument the slug rule keys on. */
    expect(seen.calls).toContain(`spendCube(${SINCE}, ${UNTIL}, ${TEST_SUB})`);
    const costs = JSON.parse(sent.body) as AdminCosts;
    expect(costs.since).toBe(SINCE);
    expect(costs.until).toBe(UNTIL);
    expect(costs.label).toContain("2033-05-01");
    expect(costs.rows.map((r) => [r.job, r.category])).toEqual([
      ["glossary", "on-demand enrichment"],
      ["chat", "interactive request work"],
      ["eval", "non-product"],
      ["summarise", "unknown"],
    ]);
    expect(costs.rows[0]).toMatchObject({ day: "2033-05-10", calls: 2, creditsNanos: 30_000_000 });
  });

  it("lists every owner in the rows, and one with no account has no email", async () => {
    const costs = JSON.parse((await request(PATH)).body) as AdminCosts;
    const byId = new Map(costs.owners.map((o) => [o.id, o.email]));
    expect(byId.get(TEST_SUB)).toBe(TEST_EMAIL);
    expect(byId.get(KNOWN)).toBe("known-reader@example.test");
    expect(byId.has(NO_ACCOUNT)).toBe(true);
    expect(byId.get(NO_ACCOUNT)).toBeNull();
    /* An account with no ledger rows is nobody this page is about. */
    expect(byId.has(BYSTANDER)).toBe(false);
    expect(costs.owners).toHaveLength(3);
  });

  it("means everything when neither bound is given", async () => {
    const sent = await request(PATH);
    expect(sent.status).toBe(200);
    expect(seen.calls).toContain(`spendCube(undefined, undefined, ${TEST_SUB})`);
    expect(JSON.parse(sent.body)).toMatchObject({ since: null, until: null });
  });

  it("refuses a bound it cannot read, before any store is asked", async () => {
    for (const query of [
      "since=last-week",
      "since=2033-05-01",
      `until=${encodeURIComponent("2033-05-01T00:00:00+01:00")}`,
      `since=${UNTIL}&until=${SINCE}`,
      "since=",
    ]) {
      const sent = await request(`${PATH}?${query}`);
      expect(sent.status, query).toBe(400);
      expect(JSON.parse(sent.body).error, query).toMatch(/since|until/);
    }
    expect(seen.calls).toEqual([]);
  });

  it("says so when the window has too many groups, rather than answering part of it", async () => {
    seen.tooLarge = true;
    const sent = await request(PATH);
    expect(sent.status).toBe(400);
    expect(JSON.parse(sent.body).error).toMatch(/shorter period/);
  });

  it("is refused to anybody else by the namespace gate, which reaches no store", async () => {
    const sent = await request(`${PATH}?since=${SINCE}`, acceptSomebodyElse);
    expect(sent.status).toBe(403);
    expect(seen.calls).toEqual([]);
  });

  it("is an exact path", async () => {
    expect((await request(`${PATH}/anything`)).status).toBe(404);
    expect(seen.calls).toEqual([]);
  });
});
