/**
 * **`spideryarn-mcp serve` puts nothing but protocol on stdout, and no token
 * anywhere** — plan docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md
 * § Stages, stage 1.
 *
 * The real script, spawned the way an AI app spawns it, against a small local
 * HTTP server that plays both Spideryarn and Supabase Auth. The session it
 * starts with is already expired, so the child refreshes over the network
 * before its first call: the run crosses the session file, the lock, the
 * refresh, the Bearer header, the tool layer and the stdio transport, and every
 * byte the child writes is kept and searched.
 *
 * Spawning rather than importing is the point: a stray `console.log` at
 * module load in anything the script imports would corrupt the protocol, and
 * only a real process shows that.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sessionFileFor, writeSessionFile } from "../src/mcp/session.js";

const SCRIPT = fileURLToPath(new URL("../scripts/spideryarn-mcp.ts", import.meta.url));
const OLD_REFRESH = "SENTINEL-OLD-REFRESH-0a7b";
const NEW_REFRESH = "SENTINEL-NEW-REFRESH-c3d9";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const OLD_ACCESS = `${b64({ alg: "none" })}.${b64({ sub: "user-a", session_id: "sess-a" })}.SENTINEL-OLD-SIG-44e1`;
const NEW_ACCESS = `${b64({ alg: "none" })}.${b64({ sub: "user-a", session_id: "sess-a" })}.SENTINEL-NEW-SIG-5f`;
const SENTINELS = [OLD_ACCESS, "SENTINEL-OLD-SIG-44e1", OLD_REFRESH, NEW_REFRESH, "SENTINEL-NEW-SIG-5f"];

let server: Server;
let site: string;
let home: string;
const received: { method: string; url: string; auth: string | undefined }[] = [];

async function bodyOf(req: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text;
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await bodyOf(req);
    received.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/auth/v1/token?grant_type=refresh_token")) {
      if ((JSON.parse(body) as { refresh_token?: string }).refresh_token !== OLD_REFRESH) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error_description: "Invalid Refresh Token: Already Used" }));
        return;
      }
      res.end(
        JSON.stringify({
          access_token: NEW_ACCESS,
          refresh_token: NEW_REFRESH,
          expires_in: 3600,
          user: { id: "user-a", email: "a@example.com" },
        }),
      );
      return;
    }
    if (req.headers.authorization !== `Bearer ${NEW_ACCESS}`) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Sign in again." }));
      return;
    }
    if (req.url === "/api/library") {
      res.end(JSON.stringify({ articles: [{ slug: "on-tools", title: "On Tools", addedAt: "2026-10-01", words: 9 }] }));
      return;
    }
    res.statusCode = 403;
    res.end(JSON.stringify({ error: `Admins only (you sent ${req.headers.authorization}).` }));
  });
  await new Promise<void>((resolve, reject) => {
    const failed = (err: Error) => reject(err);
    server.once("error", failed);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", failed);
      resolve();
    });
  });
  site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  home = await fs.mkdtemp(path.join(os.tmpdir(), "spideryarn-mcp-stdio-"));
  await writeSessionFile(sessionFileFor(site, home), {
    site,
    supabaseUrl: site,
    supabaseKey: "anon",
    accessToken: OLD_ACCESS,
    refreshToken: OLD_REFRESH,
    expiresAt: Math.floor(Date.now() / 1000) - 5,
    userId: "user-a",
    email: "a@example.com",
  });
});

afterAll(async () => {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  if (home) await fs.rm(home, { recursive: true, force: true });
});

describe("serve over stdio", () => {
  it("answers in JSON-RPC lines only, refreshes once, and leaks no token", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", SCRIPT, "serve", "--site", site], {
      env: { ...process.env, SPIDERYARN_MCP_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    const responses = new Map<number, Record<string, unknown>>();
    const waiters = new Map<number, () => void>();
    child.stdout.on("data", (c) => {
      stdout += c;
      for (const line of stdout.split("\n").slice(0, -1)) {
        try {
          const msg = JSON.parse(line) as { id?: number };
          if (typeof msg.id === "number" && !responses.has(msg.id)) {
            responses.set(msg.id, msg as Record<string, unknown>);
            waiters.get(msg.id)?.();
          }
        } catch {
          /* Asserted below, over the whole of stdout. */
        }
      }
    });
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    const request = (id: number, method: string, params: unknown) => {
      const answered = new Promise<void>((resolve) => waiters.set(id, resolve));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return answered;
    };

    await request(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    await request(2, "tools/list", {});
    await request(3, "tools/call", { name: "list_articles", arguments: {} });
    await request(4, "tools/call", { name: "list_gift_vouchers", arguments: {} });
    child.stdin.end();
    expect(await exited).toBe(0);

    /* Every byte on stdout is a JSON-RPC message, one per line. */
    const lines = stdout.split("\n");
    expect(lines.pop()).toBe("");
    for (const line of lines) {
      expect((JSON.parse(line) as { jsonrpc?: string }).jsonrpc).toBe("2.0");
    }

    const tools = ((responses.get(2)?.result ?? { tools: [] }) as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(tools).toContain("create_gift_voucher");
    const listed = responses.get(3)?.result as { content: { text: string }[]; isError?: boolean };
    expect(listed.isError).not.toBe(true);
    expect(listed.content[0]?.text).toContain(`${site}/read/on-tools`);
    const refused = responses.get(4)?.result as { content: { text: string }[]; isError?: boolean };
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain("Spideryarn refused: Admins only");

    expect(received.filter((r) => r.url.includes("grant_type=refresh_token"))).toHaveLength(1);
    expect(received.filter((r) => r.url.startsWith("/api/")).every((r) => r.auth === `Bearer ${NEW_ACCESS}`)).toBe(
      true,
    );

    /* The server echoed the Bearer header into its 403; it must not come out. */
    for (const sentinel of SENTINELS) {
      expect(stdout).not.toContain(sentinel);
      expect(stderr).not.toContain(sentinel);
    }
    expect(stdout).toContain("[redacted]");
  }, 60_000);
});
