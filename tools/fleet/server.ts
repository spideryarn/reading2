/**
 * v0.1 of the fleet dashboard: one read-only page listing session titles.
 *
 *   npx tsx tools/fleet/server.ts
 *
 * Direction and constraints: docs/project/orchestrator-direction.md.
 * Stages: docs/plans/260907e-agent-fleet-dashboard.md.
 *
 * BINDS 127.0.0.1 BY DEFAULT, and that is the whole of the access control in
 * this slice. There is no authentication here on purpose: reachability is the
 * boundary, the way it is in the system Greg showed us. `FLEET_BIND` is how it
 * reaches a Tailscale address later, and it should never be set to `0.0.0.0`
 * on this box — the Hetzner firewall would still refuse the traffic, but the
 * habit is the thing that eventually gets it wrong.
 *
 * THE SNAPSHOT IS CACHED, AND THAT IS NOT AN OPTIMISATION. One collection takes
 * about 13 seconds on this box, because the underlying script greps whole
 * transcripts (tens of megabytes each, 35 sessions) for Claude's own title. A
 * request must never wait for that, and the box must not run it once per
 * viewer. So a background loop refreshes, every request is served from the last
 * good snapshot, and the page always says how old it is. A failed refresh keeps
 * the previous snapshot and marks it stale rather than blanking the page: an
 * empty fleet is the reading least likely to make anyone look.
 *
 * `console.log` rather than src/log.ts, deliberately: docs/project/logging.md's
 * rule is for the product's request path, and this tool is a box utility that
 * must not depend on anything under src/ (orchestrator-direction.md § Principles).
 * Worth revisiting if it grows.
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collect, type FleetSnapshot } from "./collect.js";
import { parseBinds } from "./config.js";
import { collectHealth, type HealthReport } from "./health.js";
import { broadcast, startHeartbeat, subscribe, subscriberCount } from "./live.js";

/** Where the built React client lives. */
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "web", "dist");

const PORT = Number(process.env.FLEET_PORT ?? 8787);

/**
 * Addresses to listen on, comma-separated. Never a wildcard, never empty —
 * `parseBinds` in config.ts enforces both and says why.
 *
 * TWO ON PURPOSE. The tailnet address is how a phone reaches this, and
 * `127.0.0.1` is how an ssh forward does — and the ssh forward is the fallback
 * that depends on nothing, so it stays even once Tailscale works. Node binds one
 * address per server, so this is a list and we create one server per entry.
 */
const parsedBinds = parseBinds(process.env.FLEET_BIND);
if (!parsedBinds.ok) {
  console.error(`✗ ${parsedBinds.why}`);
  process.exit(2);
}
const BINDS = parsedBinds.binds;

/**
 * REFUSE TO START WITHOUT A BUILT CLIENT.
 *
 * There used to be a hand-written HTML page here that rendered the same
 * snapshot with no build step, and it served as the fallback when `web/dist/`
 * was missing. Greg removed it on 2026-09-08 — one renderer, not two.
 *
 * That leaves a gap worth closing rather than inheriting: without the fallback,
 * forgetting `npm run build:fleet` means the server starts, logs two cheerful
 * "fleet on http://…" lines, collects happily, and answers 404 to the only
 * person who ever visits it. Failing here instead turns a mystery you meet on
 * your phone into one line in the terminal you started it from.
 */
if (!existsSync(path.join(DIST, "index.html"))) {
  console.error(`✗ no built client at ${DIST} — run \`npm run build:fleet\` first`);
  process.exit(2);
}

/**
 * 60s, not 30s. One collection costs ~12s of grepping, so at 30s this process
 * spends 40% of its life churning the page cache — and on 2026-09-08 this box
 * hit load average 391 with the OOM killer firing, which is not a moment to be
 * a background contributor. Raise it further, don't lower it.
 */
const REFRESH_MS = Number(process.env.FLEET_REFRESH_MS ?? 60_000);

let snapshot: FleetSnapshot | null = null;
let lastError: string | null = null;

/**
 * The box's own vital signs, refreshed alongside the fleet.
 *
 * Null until the first reading, and null again only if a reading throws — which
 * `collectHealth` is built not to do: every field of it can say "I could not
 * tell" rather than returning a zero that reads as healthy.
 */
let health: HealthReport | null = null;

/** The wire shape, in one place, so the poll and the stream cannot disagree. */
function statePayload(): string {
  return JSON.stringify({
    ...(snapshot ?? { rows: [], collectedAt: null, tookMs: 0 }),
    error: lastError,
    health,
  });
}

async function refresh(): Promise<void> {
  try {
    snapshot = await collect();
    lastError = null;
    console.log(
      `collected ${snapshot.rows.length} sessions in ${snapshot.tookMs}ms` +
        (subscriberCount() ? ` → ${subscriberCount()} live` : ""),
    );
    // Cheap next to the fleet collection (~200ms without the vmstat sample,
    // which is the one command with a real wait), and separately guarded: a
    // health reading that throws must not cost us the session list.
    try {
      health = collectHealth({ includeSwapActivity: true });
    } catch (err) {
      console.error(`health failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    broadcast(statePayload());
  } catch (err) {
    // Keep the previous snapshot. The page shows the age, so a stale page is
    // legible; a blank one is a lie that looks like an empty box.
    lastError = err instanceof Error ? err.message : String(err);
    console.error(`collection failed: ${lastError}`);
    // AND BROADCAST THE FAILURE. This used to return without one, so a stream
    // subscriber saw nothing at all when a collection failed — silence, which
    // is exactly what a healthy quiet box looks like. A poller could see
    // `error` in the payload and a subscriber could not, which is the two
    // shapes disagreeing after the trouble was taken to build them from one
    // function. The Overseer (tools/overseer/, another session) consumes this
    // stream to record fleet history, so a failure it cannot see is a gap in
    // that history with no explanation in it.
    broadcast(statePayload());
  }
}

/**
 * Refresh, then wait, then refresh — rather than a fixed-rate interval.
 *
 * A `setInterval` cannot overlap a synchronous call, but once a collection
 * approaches the interval every tick is immediately due and the box collects
 * continuously. Chaining from the *end* of each run guarantees a real gap
 * whatever the box is doing, which matters on a machine that hit load average
 * 391 today. A failure waits longer, so a broken box is not also hammered.
 */
async function refreshLoop(): Promise<void> {
  for (;;) {
    await refresh();
    const wait = lastError === null ? REFRESH_MS : Math.min(REFRESH_MS * 5, 300_000);
    await new Promise((r) => setTimeout(r, wait).unref?.());
  }
}

function handler(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void {
  const url = req.url ?? "/";

  // The stream. A new subscriber gets the cached snapshot at once rather than
  // waiting up to a minute for the next refresh, so a phone opening the page is
  // never briefly blank.
  if (url.startsWith("/api/live")) {
    subscribe(req, res, snapshot ? statePayload() : null);
    return;
  }

  // The poll. Same bytes as the stream by construction — both call
  // statePayload() — because two shapes that are meant to be identical and are
  // built in two places will differ eventually, and the client would be the
  // thing that found out.
  if (url.startsWith("/api/state") || url.startsWith("/api/agents")) {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(statePayload());
    return;
  }
  // The React client. There is no second renderer behind it — see the startup
  // check below, which is what replaced one.
  if (serveStatic(url, res)) return;

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found\n");
}


const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

/**
 * The built React client, or false if this request is not for it.
 *
 * PATH TRAVERSAL IS THE WHOLE RISK HERE, and it is the first code in this tool
 * that turns a string from the network into a filesystem read. `resolve` then a
 * prefix check on the resolved path, rather than looking for `..` in the URL:
 * an encoded, doubled or unicode-normalised `..` is somebody else's bug list,
 * and "is the answer inside the directory I meant" is a question with one right
 * answer. The separator is appended to the prefix so that a sibling directory
 * named `dist-secrets` cannot pass a `startsWith("…/dist")` test.
 *
 * Modes live in the URL fragment, which never reaches a server, so there is no
 * route table to keep: anything that is not a real file is a 404.
 */
function serveStatic(url: string, res: import("node:http").ServerResponse): boolean {
  const clean = (url.split("?")[0] ?? "/").replace(/\/+$/, "") || "/";
  const rel = clean === "/" ? "index.html" : clean.slice(1);
  const file = path.resolve(DIST, rel);
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return false;
  let body: Buffer;
  try {
    body = readFileSync(file);
  } catch {
    return false;
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    // Asset names are content-hashed, so they can be cached hard — but
    // index.html must never be, or a browser goes on asking for a bundle that
    // was deleted by the next build and the page simply stops working.
    "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable",
  });
  res.end(body);
  return true;
}

// One listener per address. A bind that fails is FATAL rather than logged and
// survived: a half-bound server is one that answers on the address you tested
// and not on the one you actually use, which is a bug you find from a phone.
for (const bind of BINDS) {
  const server = createServer(handler);
  server.on("error", (err) => {
    console.error(`could not bind ${bind}:${PORT} — ${err.message}`);
    process.exit(1);
  });
  server.listen(PORT, bind, () => console.log(`fleet on http://${bind}:${PORT}`));
}

console.log(`refreshing every ${REFRESH_MS / 1000}s`);
void refreshLoop();

// Keeps an idle SSE connection from being dropped by anything in between. Its
// own timer is unref'd, so it cannot hold the process open by itself — the
// listening sockets are what do that.
startHeartbeat(Number(process.env.FLEET_HEARTBEAT_MS ?? 15_000));
