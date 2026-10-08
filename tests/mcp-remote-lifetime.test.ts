/** The Node disconnect must close the SDK exchange and retire its identity. */
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { afterEach, expect, it, vi } from "vitest";
import type { Api } from "../src/mcp/api.js";
import type { ServerOptions } from "../src/mcp/server.js";
import { withAfterResponseTasks } from "../src/after-response.js";

const pending = vi.hoisted(() => ({
  api: null as Api | null,
  started: () => {},
  resume: Promise.resolve(),
  closed: 0,
}));

vi.mock("../src/mcp/server.js", async (original) => {
  const real = await original<typeof import("../src/mcp/server.js")>();
  const { z } = await import("zod");
  return {
    ...real,
    buildServer(options: ServerOptions) {
      pending.api = options.api;
      const server = real.buildServer({ ...options, tools: [{
        name: "paused", title: "Paused tool", description: "Wait before reaching the API",
        input: z.strictObject({}), annotations: {},
        handler: async (api) => {
          pending.started();
          await pending.resume;
          return api.call("GET", "/api/library");
        },
      }] });
      const close = server.close.bind(server);
      server.close = async () => { pending.closed++; await close(); };
      return server;
    },
  };
});

it("keeps accepted inner work alive after disconnect, while retiring further access immediately", async () => {
  vi.stubEnv("MCP_OAUTH_CLIENT_ID", "test-client");
  pending.closed = 0;
  pending.started = () => {};
  pending.resume = Promise.resolve();
  let release!: () => void;
  const acceptedWork = new Promise<void>((resolve) => { release = resolve; });
  let accepted!: () => void;
  const started = new Promise<void>((resolve) => { accepted = resolve; });
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.complete = true;
  req.headers = {
    authorization: "Bearer verified", "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  req.push(Buffer.from(JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "paused", arguments: {} },
  })));
  req.push(null);
  const res = new ServerResponse(req);
  let completed = false;
  let settled = false;
  const exchange = withAfterResponseTasks(() => serveRemoteMcp({
    req, res, method: "POST", path: "/api/mcp",
    handleApi: async (_req, innerRes) => {
      accepted();
      await acceptedWork;
      completed = true;
      innerRes.end(JSON.stringify({ ok: true }));
      return true;
    },
    verify: async () => ({ ok: true, claims: {
      sub: ADMIN_USER_ID_LOCAL, email: ADMIN_EMAIL_LOCAL,
      role: "authenticated", client_id: "test-client",
    } }),
  })).catch(() => {}).finally(() => { settled = true; });
  try {
    await Promise.race([started, exchange.then(() => { throw new Error("Exchange ended before inner work started"); })]);
    res.emit("close");
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
    expect(pending.closed).toBeGreaterThan(0);
    if (!pending.api) throw new Error("No request API was constructed");
    await expect(pending.api.call("GET", "/api/library")).rejects.toThrow(/ended|closed|abort/i);
    expect(settled, "the Vercel invocation must await already accepted inner work").toBe(false);
    release();
    await exchange;
    expect(completed).toBe(true);
  } finally {
    release();
    await exchange;
    req.destroy();
    socket.destroy();
  }
});

const { serveRemoteMcp } = await import("../src/mcp/remote.js");
const { ADMIN_USER_ID_LOCAL, ADMIN_EMAIL_LOCAL } = await import("../src/admin.js");

afterEach(() => vi.unstubAllEnvs());

it("a disconnected response retires its API and settles even while a tool is paused", async () => {
  vi.stubEnv("MCP_OAUTH_CLIENT_ID", "test-client");
  pending.closed = 0;
  let release!: () => void;
  pending.resume = new Promise((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { pending.started = resolve; });
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.complete = true;
  req.headers = {
    authorization: "Bearer verified", "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  req.push(Buffer.from(JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "paused", arguments: {} },
  })));
  req.push(null);
  const res = new ServerResponse(req);
  const handleApi = vi.fn(async () => true);
  let settled = false;
  const exchange = serveRemoteMcp({
    req, res, method: "POST", path: "/api/mcp", handleApi,
    verify: async () => ({ ok: true, claims: {
      sub: ADMIN_USER_ID_LOCAL, email: ADMIN_EMAIL_LOCAL,
      role: "authenticated", client_id: "test-client",
    } }),
  }).catch(() => {}).finally(() => { settled = true; });
  try {
    await Promise.race([started, exchange.then(() => { throw new Error("Exchange ended before its tool started"); })]);
    // The socket's response-close event, without needing a listening socket.
    res.emit("close");
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
    expect(settled, "disconnect must settle handleRequest rather than leave its JSON resolver pending").toBe(true);
    expect(pending.closed).toBeGreaterThan(0);
    if (!pending.api) throw new Error("No request API was constructed");
    await expect(pending.api.call("GET", "/api/library")).rejects.toThrow(/ended|closed|abort/i);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(handleApi).not.toHaveBeenCalled();
  } finally {
    release();
    await exchange;
    req.destroy();
    socket.destroy();
  }
});
