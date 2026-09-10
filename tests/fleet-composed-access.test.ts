/**
 * The fleet dashboard's access guards, proved on the REAL composed server.
 *
 * Plan 260910f. Every guard here was already tested at the unit — the header
 * values, each route's origin function, `parseBinds` — and none of those tests
 * starts the server. So `applySecurityHeaders` could be deleted from `handler()`
 * and every one of them would stay green. This file asks `tools/fleet/server.ts`
 * itself, over real HTTP, through tests/helpers/fleet-child-server.ts — whose
 * header is the isolation contract, and says why every variable is set.
 *
 * THE ROUTES ARE REAL, SO NOTHING HERE MAY GET PAST VALIDATION (Sol's F9). Every
 * request that passes an origin gate carries `INERT_BODY`, which is not JSON,
 * and each route answers it 400 at its `JSON.parse` — before any receipt, tmux
 * call, launch or fetch. The last test reads the child's whole log for the
 * lines a launch or a provider call would print, so a body that got further
 * than intended fails the file rather than passing quietly.
 *
 * Every refusal below has a positive control beside it, so no property can
 * pass by the server refusing everything — or by it not being there.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SECURITY_HEADERS } from "../tools/fleet/headers.js";
import { FLEET_DIST, type FleetChild, freePort, spawnFleetChild, startFleetChild } from "./helpers/fleet-child-server.js";

// The safe harness deliberately has no arbitrary environment escape hatch.
// This is compile-time evidence: before F14's fix the directive is unused and
// `npm run typecheck` fails; after it, removing the restriction fails instead.
function helperIsolationTypeWitness(): void {
  // @ts-expect-error live-state isolation variables are not caller-overridable
  void spawnFleetChild({ env: { HOME: "/home/greg", FLEET_ACT_ENABLED: "1" } });
}
void helperIsolationTypeWitness;

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };

type Req = { method?: string; path: string; headers?: Record<string, string>; body?: string; host?: string };

/**
 * One request, answered IN FULL — so a response that never ends (a stream
 * where a refusal was expected) is a timeout failure, not a pass. `setHost:
 * false` so a test chooses the Host; it defaults to the one we listen on.
 */
async function request(port: number, opts: Req): Promise<Reply> {
  // An explicit Content-Length whenever there is a body. Node's client chunks a
  // POST body by default but NOT a DELETE's: it writes the bytes after the head
  // with no framing header at all, so the server rightly reads a bodyless
  // DELETE followed by a malformed second request, and resets the socket.
  const length = opts.body === undefined ? {} : { "content-length": String(Buffer.byteLength(opts.body)) };
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: opts.method ?? "GET",
        path: opts.path,
        setHost: false,
        headers: { host: opts.host ?? `127.0.0.1:${port}`, ...length, ...opts.headers },
      },
      (res) => {
        let body = "";
        res.on("data", (b: Buffer) => {
          body += b.toString("utf8");
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error(`no complete answer: ${opts.method ?? "GET"} ${opts.path}`)));
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/** The status and headers of a stream, then hang up — the SSE never ends. */
async function headersOnly(port: number, pathname: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, setHost: false, headers: { host: `127.0.0.1:${port}` } },
      (res) => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: "" });
        res.destroy();
        req.destroy();
      },
    );
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error(`timed out: GET ${pathname}`)));
    req.end();
  });
}

/**
 * Raw bytes in, the response head out. HTTP/1.0 is the only way to send no
 * Host at all: over HTTP/1.1 Node's own parser answers a Host-less request 400
 * before `handler()` runs, so that case never reaches our code — this does.
 */
async function rawHead(port: number, bytes: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    let got = "";
    sock.setTimeout(10_000, () => sock.destroy(new Error("timed out waiting for a response head")));
    sock.on("data", (b: Buffer) => {
      got += b.toString("latin1");
      const end = got.indexOf("\r\n\r\n");
      if (end === -1) return;
      const [statusLine = "", ...lines] = got.slice(0, end).split("\r\n");
      const headers: http.IncomingHttpHeaders = {};
      for (const line of lines) {
        const colon = line.indexOf(":");
        if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
      }
      resolve({ status: Number(statusLine.split(" ")[1] ?? 0), headers, body: got.slice(end + 4) });
      sock.destroy();
    });
    sock.on("error", reject);
    sock.on("connect", () => sock.write(bytes));
  });
}

async function connectOutcome(host: string, port: number): Promise<"connected" | string> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    sock.setTimeout(5_000, () => {
      sock.destroy();
      resolve("timeout");
    });
    sock.once("connect", () => {
      sock.destroy();
      resolve("connected");
    });
    sock.once("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
  });
}

function expectSecurityHeaders(reply: Reply, what: string): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(reply.headers[name], `${what}: ${name}`).toBe(value);
  }
}

/**
 * A body no route can act on: not JSON. Every route answers it 400 at its
 * `JSON.parse`, before anything that costs or changes. Never replace it with a
 * valid body to get a "better" positive control: a valid new-session body
 * starts an agent, and a valid transcribe body calls a provider.
 */
const INERT_BODY = "this is not json";

/* ------------------------------------------------------------------ *
 * One server for the file
 * ------------------------------------------------------------------ */

let server: FleetChild;
let PORT = 0;
let ASSET = "";

beforeAll(async () => {
  // startFleetChild FAILS without a build rather than skipping; this is the
  // same rule for the asset the header tests need.
  const asset = readdirSync(path.join(FLEET_DIST, "assets")).find((f) => f.endsWith(".js"));
  if (asset === undefined) throw new Error(`no .js under ${FLEET_DIST}/assets — run \`npm run build:fleet\``);
  ASSET = `/assets/${asset}`;
  server = await startFleetChild();
  PORT = server.port;
}, 90_000);

afterAll(async () => {
  await server?.stop();
}, 20_000);

/* ------------------------------------------------------------------ *
 * Bind
 * ------------------------------------------------------------------ */

describe("bind: it listens on the configured address and nowhere else", () => {
  it("answers on 127.0.0.1 and refuses the same port on 127.0.0.2", async () => {
    // The positive half first: without it, a server that never started would
    // pass the refusal below.
    expect(await connectOutcome("127.0.0.1", PORT)).toBe("connected");

    // THE WITNESS, PROVED USABLE BEFORE IT IS BELIEVED (Sol's F5). 127.0.0.2 is
    // local on Linux, but a socket bound to 127.0.0.1 does not answer it — so a
    // refusal there means "not bound here", but only once a listener that IS
    // bound there has been reached. Where that fails the environment cannot
    // tell a private bind from a wildcard one, and the test FAILS rather than
    // passing on nothing.
    const control = net.createServer();
    const controlPort = await freePort();
    await new Promise<void>((resolve, reject) => {
      control.once("error", reject);
      control.listen(controlPort, "127.0.0.2", () => resolve());
    });
    try {
      expect(await connectOutcome("127.0.0.2", controlPort), "127.0.0.2 is not usable as a witness here").toBe("connected");
    } finally {
      await new Promise<void>((r) => control.close(() => r()));
    }
    expect(await connectOutcome("127.0.0.2", PORT)).toBe("ECONNREFUSED");
  });

  it("FLEET_BIND=0.0.0.0 exits non-zero without ever listening", async () => {
    const child = await spawnFleetChild({ bind: "0.0.0.0" });
    try {
      const deadline = Date.now() + 60_000;
      while (child.exited() === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      const exit = child.exited();
      expect(exit, `still running after 60s:\n${child.output()}`).not.toBeNull();
      expect(exit?.code).not.toBe(0);
      expect(exit?.code).not.toBeNull();
      expect(child.output()).not.toContain("fleet on http://");
      // It said why, rather than dying quietly.
      expect(child.output()).toMatch(/wildcard/);
    } finally {
      await child.stop();
    }
  }, 90_000);
});

/* ------------------------------------------------------------------ *
 * Security headers
 * ------------------------------------------------------------------ */

describe("security headers are on every class of response", () => {
  it("the static shell", async () => {
    const r = await request(PORT, { path: "/" });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expectSecurityHeaders(r, "GET /");
  });

  it("a real static asset", async () => {
    const r = await request(PORT, { path: ASSET });
    expect(r.status).toBe(200);
    expectSecurityHeaders(r, "GET /assets/*.js");
  });

  it("a 404", async () => {
    const r = await request(PORT, { path: "/no-such-file-composed-access" });
    expect(r.status).toBe(404);
    expectSecurityHeaders(r, "404");
  });

  it("the poll, /api/state", async () => {
    const r = await request(PORT, { path: "/api/state" });
    expect(r.status).toBe(200);
    expectSecurityHeaders(r, "/api/state");
  });

  it("the stream, /api/live", async () => {
    const r = await headersOnly(PORT, "/api/live");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/event-stream/);
    expectSecurityHeaders(r, "/api/live");
  });

  it("a route module's GET, /api/readiness", async () => {
    const r = await request(PORT, { path: "/api/readiness" });
    // Any answer from the route itself; the point is that it passed through
    // handler()'s header line on the way.
    expect(r.headers["content-type"]).toMatch(/application\/json/);
    expectSecurityHeaders(r, "/api/readiness");
  });

  it("a write route's refusal", async () => {
    const r = await request(PORT, {
      method: "POST",
      path: "/api/steer/message",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: INERT_BODY,
    });
    expect(r.status).toBe(403);
    expectSecurityHeaders(r, "403 from steer");
  });

  it("a 405", async () => {
    const r = await request(PORT, { path: "/api/steer/message" });
    expect(r.status).toBe(405);
    expectSecurityHeaders(r, "405 from steer");
  });
});

/* ------------------------------------------------------------------ *
 * Host — DNS rebinding, refused before any route
 * ------------------------------------------------------------------ */

/**
 * Every class of request, as a rebinding page would send it: Host AND Origin
 * both naming the attacker's domain, agreeing with each other perfectly. That
 * agreement is the whole trick, and it is why this is refused on the NAME, once,
 * in handler(), rather than by each route's same-origin comparison.
 */
const HOST_MATRIX: readonly { what: string; method: string; path: () => string; body?: string }[] = [
  { what: "the static shell", method: "GET", path: () => "/" },
  { what: "a built asset", method: "GET", path: () => ASSET },
  { what: "the poll", method: "GET", path: () => "/api/state" },
  { what: "a transcript", method: "GET", path: () => "/api/messages?id=x" },
  { what: "the stream", method: "GET", path: () => "/api/live" },
  { what: "a route module's GET", method: "GET", path: () => "/api/readiness" },
  { what: "a write route", method: "POST", path: () => "/api/steer/message", body: INERT_BODY },
  { what: "an unknown path", method: "GET", path: () => "/no-such-path-composed-access" },
];

describe("host: a request addressed by a name this dashboard is never reached by gets 421", () => {
  for (const row of HOST_MATRIX) {
    it(`${row.method} ${row.what} with Host and Origin evil.example`, async () => {
      // `request` waits for the END of the response, so for the stream this is
      // also the proof that no subscriber was registered: a subscribed
      // response never ends, and this would time out.
      const r = await request(PORT, {
        method: row.method,
        path: row.path(),
        host: "evil.example",
        headers: { origin: "http://evil.example", "content-type": "application/json" },
        ...(row.body === undefined ? {} : { body: row.body }),
      });
      expect(r.status, r.body.slice(0, 200)).toBe(421);
      expect(r.headers["content-type"]).toMatch(/text\/plain/);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.body).toContain("evil.example");
      expectSecurityHeaders(r, `421 ${row.what}`);
    });

    it(`${row.method} ${row.what} with no Host at all (HTTP/1.0)`, async () => {
      const body = row.body ?? "";
      const head = row.method === "POST" ? `Content-Type: application/json\r\nContent-Length: ${body.length}\r\n` : "";
      const r = await rawHead(PORT, `${row.method} ${row.path()} HTTP/1.0\r\n${head}\r\n${body}`);
      expect(r.status).toBe(421);
      expectSecurityHeaders(r, `421 no-Host ${row.what}`);
    });
  }

  it("the names it IS reached by still get answered", async () => {
    // The positive control: without it, a server refusing every Host passes.
    // `spideryarn-box` is the MagicDNS short name a phone may have bookmarked.
    for (const host of [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`, `spideryarn-box:${PORT}`]) {
      const r = await request(PORT, { path: "/api/state", host });
      expect(r.status, host).toBe(200);
    }
  });

  for (const host of [
    "localhost/path",
    "localhost?query",
    "localhost#fragment",
    "evil.example@localhost",
    "%6cocalhost",
    "localhost.",
    "evil.ts.net.",
    "[::1%25lo]",
  ]) {
    it(`refuses a Host that is URL syntax rather than one authority: ${host}`, async () => {
      const r = await rawHead(PORT, `GET /api/state HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
      expect(r.status).toBe(421);
      expectSecurityHeaders(r, `421 malformed Host ${host}`);
    });
  }

  for (const hosts of [
    ["localhost", "evil.example"],
    ["evil.example", "localhost"],
  ]) {
    it(`refuses duplicate Host fields in this order: ${hosts.join(", ")}`, async () => {
      const fields = hosts.map((host) => `Host: ${host}\r\n`).join("");
      const r = await rawHead(PORT, `GET /api/state HTTP/1.1\r\n${fields}Connection: close\r\n\r\n`);
      expect(r.status).toBe(421);
      expectSecurityHeaders(r, `421 duplicate Host ${hosts.join(", ")}`);
    });
  }

  it("does not route an absolute-form request target by its embedded path", async () => {
    const r = await rawHead(
      PORT,
      `GET http://evil.example/api/state HTTP/1.1\r\nHost: localhost:${PORT}\r\nConnection: close\r\n\r\n`,
    );
    expect(r.status).toBe(404);
    expectSecurityHeaders(r, "absolute-form request target");
  });

  it("still applies the hostile Host guard to an absolute-form request target", async () => {
    const r = await rawHead(
      PORT,
      "GET http://evil.example/api/state HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n",
    );
    expect(r.status).toBe(421);
    expectSecurityHeaders(r, "hostile absolute-form request target");
  });
});

/* ------------------------------------------------------------------ *
 * Origin, on every write route
 * ------------------------------------------------------------------ */

/**
 * Every route that writes. Enumerated from server.ts's handler() and the route
 * modules' own path matches — a write route added and not listed here is one
 * this file does not know about, which is the gap a test like this has; the
 * list is short so it can be read.
 */
const WRITE_ROUTES: readonly { method: "POST" | "DELETE"; path: string }[] = [
  { method: "POST", path: "/api/steer/message" },
  { method: "POST", path: "/api/steer/answer" },
  { method: "POST", path: "/api/sessions/new" },
  { method: "POST", path: "/api/sessions/rename" },
  { method: "POST", path: "/api/actions/session" },
  { method: "POST", path: "/api/actions/box" },
  { method: "POST", path: "/api/actions/cancel" },
  { method: "DELETE", path: "/api/actions/cancel" },
  { method: "POST", path: "/api/actions/clear" },
  { method: "POST", path: "/api/actions/hold/release" },
  { method: "POST", path: "/api/actions/revive" },
  { method: "POST", path: "/api/actions/abandon" },
  { method: "POST", path: "/api/broadcast" },
  { method: "POST", path: "/api/transcribe" },
];

function write(method: "POST" | "DELETE", pathname: string, origin: string | null): Promise<Reply> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin !== null) headers.origin = origin;
  return request(PORT, { method, path: pathname, headers, body: INERT_BODY });
}

function post(pathname: string, origin: string | null): Promise<Reply> {
  return write("POST", pathname, origin);
}

describe("origin: every write route refuses a cross-origin write over real HTTP", () => {
  // The Host stays legitimate throughout, so these get past handler()'s Host
  // check and exercise each route's OWN origin gate.
  for (const route of WRITE_ROUTES) {
    it(`${route.method} ${route.path}: a foreign, missing and null Origin are 403; same-origin is not`, async () => {
      const foreign = await write(route.method, route.path, "http://evil.example");
      expect(foreign.status, `foreign: ${foreign.body}`).toBe(403);
      const missing = await write(route.method, route.path, null);
      expect(missing.status, `missing: ${missing.body}`).toBe(403);
      const literalNull = await write(route.method, route.path, "null");
      expect(literalNull.status, `null: ${literalNull.body}`).toBe(403);

      // THE POSITIVE CONTROL. Past the origin gate, refused for the body — 400
      // in every route. Exactly 400 rather than "not 403", so a 404 (route not
      // mounted) or a 415 cannot stand in for it.
      const same = await write(route.method, route.path, `http://127.0.0.1:${PORT}`);
      expect(same.status, `same-origin: ${same.body}`).toBe(400);
    });
  }
});

/* ------------------------------------------------------------------ *
 * Child ownership
 * ------------------------------------------------------------------ */

describe("child ownership: the server dies with the process that asked for it", () => {
  it("closes the random listener when its helper parent is SIGKILLed", async () => {
    const repo = path.resolve(import.meta.dirname, "..");
    const fixture = path.join(import.meta.dirname, "helpers", "fleet-child-orphan-parent.ts");
    // ONE process, loaded with `--import tsx`, never the tsx CLI: the CLI runs
    // the script in a node grandchild, and that grandchild — not the pid we
    // hold — is what calls startFleetChild() and holds the owner's IPC pipe.
    // SIGKILLing the CLI would leave it alive and the listener with it, which
    // proves nothing about the owner. The fixture checks this itself.
    const parent = spawn(process.execPath, ["--import", "tsx", fixture], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    parent.stdout.on("data", (b: Buffer) => {
      output += b.toString("utf8");
    });
    parent.stderr.on("data", (b: Buffer) => {
      output += b.toString("utf8");
    });
    const deadline = Date.now() + 60_000;
    let match: RegExpMatchArray | null = null;
    while (match === null && parent.exitCode === null && Date.now() < deadline) {
      match = output.match(/fleet-orphan-parent port=(\d+) owner=(\d+) pid=(\d+)/);
      if (match === null) await new Promise((r) => setTimeout(r, 50));
    }
    expect(match, `fixture did not become ready:\n${output}`).not.toBeNull();
    const port = Number(match?.[1]);
    const owner = Number(match?.[2]);
    try {
      // The process we are about to kill is the one that asked for the server.
      expect(Number(match?.[3]), "the fixture runs in a process other than the one this test kills").toBe(parent.pid);
      expect(await connectOutcome("127.0.0.1", port)).toBe("connected");
      // The fixture waited for the server to go quiet before saying ready, so
      // nothing reaches the owner's stdout after this and its EPIPE fallback
      // cannot fire: the IPC disconnect alone must close the listener. Without
      // that wait, deleting the disconnect handler left this green.
      parent.kill("SIGKILL");
      await new Promise<void>((resolve) => parent.once("exit", () => resolve()));
      let outcome = await connectOutcome("127.0.0.1", port);
      const goneBy = Date.now() + 10_000;
      while (outcome === "connected" && Date.now() < goneBy) {
        await new Promise((r) => setTimeout(r, 50));
        outcome = await connectOutcome("127.0.0.1", port);
      }
      expect(outcome).toBe("ECONNREFUSED");
    } finally {
      // Makes the deliberately failing, pre-fix run safe too.
      try {
        process.kill(-owner, "SIGKILL");
      } catch {
        /* already gone */
      }
      if (parent.exitCode === null) parent.kill("SIGKILL");
    }
  }, 90_000);
});

/* ------------------------------------------------------------------ *
 * Audit source
 * ------------------------------------------------------------------ */

describe("audit source: a refused action's log line names the real peer", () => {
  // This proves the listener hands the route a real peer address, and that it
  // reaches the log. It is NOT receipt or speaker attribution — that needs a
  // request that creates a receipt, which needs a real target.
  it("logs from=127.0.0.1, not from=-", async () => {
    const r = await post("/api/actions/session", "http://evil.example");
    expect(r.status).toBe(403);
    // Written before the refusal is sent, but it crosses a pipe; give it a
    // moment rather than racing it.
    const pattern = /action: refused code=forbidden-origin [^\n]* from=127\.0\.0\.1 origin=http:\/\/evil\.example/;
    const deadline = Date.now() + 5_000;
    while (!pattern.test(server.output()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(server.output()).toMatch(pattern);
  });
});

/* ------------------------------------------------------------------ *
 * The four inline routes match exactly, by path and by method
 * ------------------------------------------------------------------ */

describe("inline routes: an exact path and a read method, or not this route", () => {
  // `/api/live` is GET only: a HEAD through `subscribe()` would be held open as
  // a subscriber nobody can write to. The other three take a finite HEAD.
  const ROUTES = [
    { path: "/api/live", allow: "GET" },
    { path: "/api/state", allow: "GET, HEAD" },
    { path: "/api/agents", allow: "GET, HEAD" },
    { path: "/api/messages", allow: "GET, HEAD" },
  ] as const;

  for (const route of ROUTES) {
    it(`${route.path}: the exact path answers`, async () => {
      if (route.path === "/api/live") {
        const r = await headersOnly(PORT, route.path);
        expect(r.status).toBe(200);
        expect(r.headers["content-type"]).toMatch(/text\/event-stream/);
      } else if (route.path === "/api/messages") {
        // No session is named, so the ROUTE's own not-found — JSON, from the
        // messages clause, not the static fallback's text/plain.
        const r = await request(PORT, { path: `${route.path}?id=x` });
        expect(r.status).toBe(404);
        expect(r.headers["content-type"]).toMatch(/application\/json/);
        expect(r.body).toContain("no-such-session");
      } else {
        const r = await request(PORT, { path: `${route.path}?x=1` });
        expect(r.status).toBe(200);
        expect(r.headers["content-type"]).toMatch(/application\/json/);
      }
    });

    it(`${route.path}X: a longer path is not this route`, async () => {
      // The static fallback's plain 404, finite — not the stream, not the poll,
      // and not the messages route's JSON.
      const r = await request(PORT, { path: `${route.path}X?id=x` });
      expect(r.status).toBe(404);
      expect(r.headers["content-type"]).toMatch(/text\/plain/);
    });

    for (const method of ["POST", "DELETE", ...(route.allow === "GET" ? ["HEAD"] : [])]) {
      it(`${method} ${route.path} is a 405 naming ${route.allow}`, async () => {
        const r = await request(PORT, { method, path: route.path, ...(method === "HEAD" ? {} : { body: "" }) });
        expect(r.status).toBe(405);
        expect(r.headers.allow).toBe(route.allow);
        expectSecurityHeaders(r, `405 ${method} ${route.path}`);
      });
    }

    if (route.allow === "GET, HEAD") {
      it(`HEAD ${route.path} is answered, finitely`, async () => {
        const target = route.path === "/api/messages" ? `${route.path}?id=x` : route.path;
        const head = await request(PORT, { method: "HEAD", path: target });
        const get = await request(PORT, { path: target });
        expect(head.status).toBe(get.status);
        expect(head.body).toBe("");
      });
    }
  }
});

/* ------------------------------------------------------------------ *
 * The sentinel — last, over everything the child said
 * ------------------------------------------------------------------ */

describe("sentinel: nothing in this file got far enough to launch or to call a provider", () => {
  it("the child's log has no launch line and no provider line", () => {
    const out = server.output();
    // routes-new.ts logs `new-session <id> starting:` immediately before it
    // runs the launcher; routes-transcribe.ts's only lines past the parse are
    // a provider result or an exception at the boundary.
    expect(out).not.toMatch(/new-session \S+ starting:/);
    expect(out).not.toMatch(/transcribe: (?!refused a request)/);
    expect(out).not.toMatch(/describe: \d+ eligible/);
    // And the log is really this child's: it listened, and it refused things.
    expect(out).toContain(`fleet on http://127.0.0.1:${PORT}`);
    expect(out).toMatch(/action: refused code=forbidden-origin/);
  });
});
