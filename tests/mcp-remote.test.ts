/**
 * **The MCP tools at an address, `POST /api/mcp`, for an AI app signed in with
 * OAuth** — plan docs/plans/261007p-mcp-remote-sign-in-with-oauth.md, stage 1.
 *
 * Driven through `handleApi`, the function production runs, with a fake
 * `Verifier` standing in for Supabase's signature check (as every route suite
 * does; tests/helpers/authed.ts). What is real: the gate on `/api/mcp`, the
 * SDK's own client and server talking Streamable HTTP, the in-process `Api`
 * the tools call the site through, the routes those calls reach, and the local
 * Postgres those routes read.
 *
 * The cases, and why each is here:
 *
 * - **The gate**: no token is a 401 that says where to sign in; a browser's
 *   token (no `client_id`), another app's token, and any token at all while
 *   `MCP_OAUTH_CLIENT_ID` is unset are 401s; a reader who is not the
 *   administrator is a 403; a hostile or `null` `Origin` is a 403 and an absent
 *   one is fine (Sol F7). `GET` and `DELETE` are 405 (stateless, F5).
 * - **Through the tools**: `list_articles` answers the administrator's own
 *   shelf and not somebody else's article (F9), via the very library route
 *   the web app calls; an admin tool reaches the admin namespace; the asking
 *   tools refuse with the page to use and write nothing (F8).
 * - **Two overlapping requests** as two different people each get their own
 *   answer (F5: a fresh server, transport and identity per request).
 * - **The token stays at `/api/mcp`**: the same OAuth token on an ordinary
 *   route is the gate's `[auth-oauth-token]` 401.
 * - **The metadata document** answers without a token (RFC 9728).
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { Client as McpClient, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ADMIN_EMAIL_LOCAL, ADMIN_USER_ID_LOCAL, ADMIN_USER_ID_PROD } from "../src/admin.js";
import type { Verifier, VerifyResult } from "../src/auth.js";
import { getDb } from "../src/db/client.js";
import { articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import type { OwnerId } from "../src/owner.js";
import { handleApi } from "../src/routes.js";
import { siteOrigin } from "../src/site-origin.js";
import { pgReady } from "./helpers/pg-ready.js";
import { type ScratchArticle, scratchArticleInPg } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

await pgReady({ suite: "tests/mcp-remote.test.ts", tables: ["spideryarn.articles"] });

const CLIENT = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const OTHER_CLIENT = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const READER = "00000000-0000-4000-8000-00000000b0b0";
const RUN = randomUUID().slice(0, 8);

const person = (sub: string, email: string) => ({ sub, email, role: "authenticated", is_anonymous: false });

/** Each token this suite can send, and what a real verifier would have found in it. */
const TOKENS: Record<string, Record<string, unknown>> = {
  "admin-app": { ...person(ADMIN_USER_ID_LOCAL, ADMIN_EMAIL_LOCAL), client_id: CLIENT },
  "admin-prod-app": { ...person(ADMIN_USER_ID_PROD, "prod-admin@spideryarn.test"), client_id: CLIENT },
  "admin-browser": person(ADMIN_USER_ID_LOCAL, ADMIN_EMAIL_LOCAL),
  "admin-other-app": { ...person(ADMIN_USER_ID_LOCAL, ADMIN_EMAIL_LOCAL), client_id: OTHER_CLIENT },
  "admin-odd-app": { ...person(ADMIN_USER_ID_LOCAL, ADMIN_EMAIL_LOCAL), client_id: 42 },
  "reader-app": { ...person(READER, "reader@example.test"), client_id: CLIENT },
};

const verify: Verifier = async (token) => {
  const claims = TOKENS[token];
  return claims ? ({ ok: true, claims } as VerifyResult) : { ok: false, kind: "bad-token" };
};

interface Reply {
  status: number;
  headers: Record<string, string>;
  text: string;
}

/** One request through `handleApi`, exactly as Vercel's function hands it over. */
async function call(
  method: string,
  url: string,
  opts: { token?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = {
    ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    ...(opts.headers ?? {}),
  };
  const req = Object.assign(Readable.from(opts.body ? [Buffer.from(opts.body)] : []), {
    method,
    url,
    headers,
  }) as unknown as IncomingMessage;

  let status = 200;
  const out: Record<string, string> = {};
  const chunks: Buffer[] = [];
  let ended = false;
  const res = {
    get statusCode() {
      return status;
    },
    set statusCode(v: number) {
      status = v;
    },
    get headersSent() {
      return ended;
    },
    get writableEnded() {
      return ended;
    },
    destroyed: false,
    setHeader(name: string, value: unknown) {
      out[name.toLowerCase()] = String(value);
    },
    getHeader(name: string) {
      return out[name.toLowerCase()];
    },
    removeHeader(name: string) {
      delete out[name.toLowerCase()];
    },
    writeHead(code: number, hs?: Record<string, string>) {
      status = code;
      for (const [k, v] of Object.entries(hs ?? {})) out[k.toLowerCase()] = v;
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.from(chunk as never));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.from(chunk as never));
      ended = true;
    },
    on() {},
    once() {},
    off() {},
  } as unknown as ServerResponse;

  await handleApi(req, res, verify);
  return { status, headers: out, text: Buffer.concat(chunks).toString("utf8") };
}

/** The SDK client's `fetch`, going into `handleApi` in this process rather than over a socket. */
const inProcessFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = await request.text();
  const reply = await call(request.method, `${url.pathname}${url.search}`, { headers, body });
  return new Response(reply.text === "" ? null : reply.text, { status: reply.status, headers: reply.headers });
};

async function connect(token: string): Promise<McpClient> {
  const transport = new StreamableHTTPClientTransport(new URL(`${siteOrigin()}/api/mcp`), {
    fetch: inProcessFetch,
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new McpClient({ name: "remote-test", version: "0" });
  await client.connect(transport);
  return client;
}

const textOf = (r: unknown): string =>
  ((r as { content: { type: string; text: string }[] }).content[0]?.text ?? "") as string;

const INIT = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
});
const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

let previousClient: string | undefined;
let mine: ScratchArticle;
let theirs: ScratchArticle;

beforeAll(async () => {
  previousClient = process.env.MCP_OAUTH_CLIENT_ID;
  process.env.MCP_OAUTH_CLIENT_ID = CLIENT;
  await seedAuthUser(getDb(), { id: READER, email: `mcp-remote-${READER}@spideryarn.local`, onConflictDoNothing: true });
  mine = await scratchArticleInPg(`test-mcp-remote-mine-${RUN}`, { ownerId: ADMIN_USER_ID_LOCAL as OwnerId });
  theirs = await scratchArticleInPg(`test-mcp-remote-theirs-${RUN}`, { ownerId: READER as OwnerId });
}, 60_000);

afterAll(async () => {
  if (previousClient === undefined) delete process.env.MCP_OAUTH_CLIENT_ID;
  else process.env.MCP_OAUTH_CLIENT_ID = previousClient;
  await mine?.remove();
  await theirs?.remove();
});

describe("the gate on /api/mcp", () => {
  const metadataUrl = () => `${siteOrigin()}/.well-known/oauth-protected-resource/api/mcp`;

  it("no token: 401, and the header that says where to sign in", async () => {
    const r = await call("POST", "/api/mcp", { headers: MCP_HEADERS, body: INIT });
    expect(r.status).toBe(401);
    expect(r.headers["www-authenticate"]).toBe(`Bearer resource_metadata="${metadataUrl()}"`);
  });

  it("a token that does not verify: 401, with the same header", async () => {
    const r = await call("POST", "/api/mcp", { token: "nonsense", headers: MCP_HEADERS, body: INIT });
    expect(r.status).toBe(401);
    expect(r.headers["www-authenticate"]).toBe(`Bearer resource_metadata="${metadataUrl()}"`);
  });

  it("a browser's token (no client_id) is refused", async () => {
    const r = await call("POST", "/api/mcp", { token: "admin-browser", headers: MCP_HEADERS, body: INIT });
    expect(r.status).toBe(401);
  });

  it("another app's token, or an odd client_id, is refused", async () => {
    for (const token of ["admin-other-app", "admin-odd-app"]) {
      const r = await call("POST", "/api/mcp", { token, headers: MCP_HEADERS, body: INIT });
      expect(r.status, token).toBe(401);
    }
  });

  it("with MCP_OAUTH_CLIENT_ID unset or empty, everyone is refused: it ships dark", async () => {
    for (const value of [undefined, ""]) {
      if (value === undefined) delete process.env.MCP_OAUTH_CLIENT_ID;
      else process.env.MCP_OAUTH_CLIENT_ID = value;
      try {
        const r = await call("POST", "/api/mcp", { token: "admin-app", headers: MCP_HEADERS, body: INIT });
        expect(r.status, JSON.stringify(value)).toBe(401);
      } finally {
        process.env.MCP_OAUTH_CLIENT_ID = CLIENT;
      }
    }
  });

  it("a reader who is not the administrator: 403", async () => {
    const r = await call("POST", "/api/mcp", { token: "reader-app", headers: MCP_HEADERS, body: INIT });
    expect(r.status).toBe(403);
  });

  it("a hostile or null Origin: 403; the site's own, Claude's, or none: served", async () => {
    for (const origin of ["https://evil.example", "null", "https://claude.ai.evil.example"]) {
      const r = await call("POST", "/api/mcp", {
        token: "admin-app",
        headers: { ...MCP_HEADERS, origin },
        body: INIT,
      });
      expect(r.status, origin).toBe(403);
    }
    for (const origin of [siteOrigin(), "https://claude.ai", undefined]) {
      const r = await call("POST", "/api/mcp", {
        token: "admin-app",
        headers: { ...MCP_HEADERS, ...(origin ? { origin } : {}) },
        body: INIT,
      });
      expect(r.status, String(origin)).toBe(200);
      expect(JSON.parse(r.text).result.serverInfo.name).toBe("spideryarn");
    }
  });

  it("GET and DELETE are 405: there is no session and no stream", async () => {
    for (const method of ["GET", "DELETE"]) {
      const r = await call(method, "/api/mcp", { token: "admin-app", headers: MCP_HEADERS });
      expect(r.status, method).toBe(405);
    }
  });

  it("the app's token on an ordinary route is the gate's [auth-oauth-token] 401", async () => {
    const r = await call("GET", "/api/library", { token: "admin-app" });
    expect(r.status).toBe(401);
    expect(JSON.parse(r.text).error).toMatch(/\[auth-oauth-token\]$/);
    /* And the browser's token still opens it: the gate's change refused only the app. */
    expect((await call("GET", "/api/library", { token: "admin-browser" })).status).toBe(200);
  });
});

describe("the tools, through the SDK's client", () => {
  it("lists the tools, and list_articles is this administrator's shelf from the library route", async () => {
    const client = await connect("admin-app");
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("list_articles");

      const result = await client.callTool({ name: "list_articles", arguments: {} });
      expect(result.isError, textOf(result)).toBeFalsy();
      const slugs = (JSON.parse(textOf(result)) as { articles: { slug: string }[] }).articles.map((a) => a.slug);
      expect(slugs).toContain(mine.slug);
      expect(slugs).not.toContain(theirs.slug);

      /* The same answer the web app gets from the same route, as the same person. */
      const direct = JSON.parse((await call("GET", "/api/library", { token: "admin-browser" })).text) as {
        articles: { slug: string }[];
      };
      expect(slugs.sort()).toEqual(direct.articles.map((a) => a.slug).sort());
    } finally {
      await client.close();
    }
  });

  it("whoami is the verified person, and an admin tool reaches the admin namespace", async () => {
    const client = await connect("admin-app");
    try {
      const who = await client.callTool({ name: "whoami", arguments: {} });
      expect(who.isError, textOf(who)).toBeFalsy();
      expect(textOf(who)).toContain(ADMIN_EMAIL_LOCAL);

      const users = await client.callTool({ name: "list_users", arguments: {} });
      expect(users.isError, textOf(users)).toBeFalsy();
    } finally {
      await client.close();
    }
  });

  it("an asking tool refuses with the page to use, and writes nothing", async () => {
    const client = await connect("admin-app");
    try {
      const pub = await client.callTool({ name: "make_article_public", arguments: { slug: mine.slug } });
      expect(pub.isError).toBe(true);
      expect(textOf(pub)).toMatch(/article's page/);

      const link = await client.callTool({ name: "create_private_link", arguments: { slug: mine.slug } });
      expect(link.isError).toBe(true);

      const gift = await client.callTool({
        name: "create_gift_voucher",
        arguments: { email: "someone@example.test", articles: 5, idempotency_key: `k-${RUN}` },
      });
      expect(gift.isError).toBe(true);
      expect(textOf(gift)).toMatch(/\/admin\/vouchers/);

      const [row] = await getDb()
        .select({ visibility: articles.visibility, shareToken: articles.shareToken })
        .from(articles)
        .where(eq(articles.id, mine.articleId));
      expect(row).toEqual({ visibility: "private", shareToken: null });
    } finally {
      await client.close();
    }
  });

  it("two overlapping requests as two people each get their own answer", async () => {
    const [a, b] = await Promise.all([connect("admin-app"), connect("admin-prod-app")]);
    try {
      const answers = await Promise.all(
        Array.from({ length: 4 }, (_, i) => (i % 2 === 0 ? a : b).callTool({ name: "whoami", arguments: {} })),
      );
      answers.forEach((answer, i) => {
        expect(textOf(answer)).toContain(i % 2 === 0 ? ADMIN_EMAIL_LOCAL : "prod-admin@spideryarn.test");
      });
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });
});

describe("the resource metadata, RFC 9728", () => {
  it("answers without a token, and is not cached", async () => {
    const r = await call("GET", "/api/mcp/resource-metadata");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(r.text)).toEqual({
      resource: `${siteOrigin()}/api/mcp`,
      authorization_servers: [`${process.env.SUPABASE_URL?.replace(/\/$/, "")}/auth/v1`],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "email", "profile"],
    });
  });
});
