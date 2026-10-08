/** Transport boundaries which do not need a database or a listening socket. */
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { Writable } from "node:stream";

import { afterEach, expect, it, vi } from "vitest";

import { ADMIN_EMAIL_LOCAL, ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { requireUser, type Verifier } from "../src/auth.js";
import { inProcessApi, serveRemoteMcp } from "../src/mcp/remote.js";
import { handleApi } from "../src/routes.js";
import { siteOrigin } from "../src/site-origin.js";

afterEach(() => vi.unstubAllEnvs());

it("the ordinary API catch preserves MCP's WWW-Authenticate header on its real 401 response", async () => {
  vi.stubEnv("MCP_OAUTH_CLIENT_ID", "test-client");
  const req = new IncomingMessage(new Socket());
  req.method = "POST";
  req.url = "/api/mcp";
  const res = new ServerResponse(req);
  let wire = "";
  const sink = new Writable({ write(chunk: Buffer, _encoding, done) {
    wire += chunk.toString("utf8");
    done();
  } });
  res.assignSocket(sink as unknown as Socket);
  await expect(handleApi(req, res, async () => ({ ok: false, kind: "bad-token" }))).resolves.toBe(true);
  expect(res.statusCode).toBe(401);
  expect(res.getHeader("WWW-Authenticate")).toBe(
    `Bearer resource_metadata="${siteOrigin()}/.well-known/oauth-protected-resource/api/mcp"`,
  );
  expect(wire).toContain("HTTP/1.1 401 Unauthorized");
  expect(wire).toContain("[auth-none]");
});

it("an oversized body can still receive its 413 without destroying the request socket", async () => {
  vi.stubEnv("MCP_OAUTH_CLIENT_ID", "test-client");
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = "POST";
  req.url = "/api/mcp";
  req.headers = { authorization: "Bearer verified" };
  req.push(Buffer.alloc(1024 * 1024 + 1));
  req.push(null);
  const res = new ServerResponse(req);
  try {
    await expect(serveRemoteMcp({
      req, res, method: "POST", path: "/api/mcp",
      verify: async () => ({ ok: true, claims: {
        sub: ADMIN_USER_ID_LOCAL, email: ADMIN_EMAIL_LOCAL,
        role: "authenticated", client_id: "test-client",
      } }),
      handleApi: async () => { throw new Error("No tool should run"); },
    })).rejects.toMatchObject({ status: 413 });
    expect(req.destroyed, "the 413 must not destroy the HTTP transport before the catch can send it").toBe(false);
    expect(socket.destroyed).toBe(false);
  } finally {
    req.destroy();
    socket.destroy();
  }
});

it("the sentinel accepts only its synthetic token and cannot authenticate after the exchange ends", async () => {
  const lifetime = new AbortController();
  let token = "";
  let verifier: Verifier | undefined;
  const api = inProcessApi({
    sub: ADMIN_USER_ID_LOCAL, email: ADMIN_EMAIL_LOCAL,
    role: "authenticated", client_id: "test-client",
  }, async (req, res, verify) => {
    token = req.headers.authorization?.slice("Bearer ".length) ?? "";
    verifier = verify;
    expect(token).not.toBe("oauth-token");
    expect(await requireUser(req, verify)).toEqual({ id: ADMIN_USER_ID_LOCAL, email: ADMIN_EMAIL_LOCAL });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }, lifetime.signal);
  expect(await api.call("GET", "/api/library")).toEqual({ ok: true });
  if (!verifier) throw new Error("No verifier was passed to the inner route");
  expect(await verifier("oauth-token")).toEqual({ ok: false, kind: "bad-token" });
  expect(await verifier(`${token}extra`)).toEqual({ ok: false, kind: "bad-token" });
  lifetime.abort();
  expect(await verifier(token)).toEqual({ ok: false, kind: "bad-token" });
  await expect(api.call("GET", "/api/library")).rejects.toThrow(/request has ended/);
});
