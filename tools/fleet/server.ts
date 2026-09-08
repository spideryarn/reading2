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
import { createServer } from "node:http";

import { collect, type FleetSnapshot } from "./collect.js";
import { broadcast, startHeartbeat, subscribe, subscriberCount } from "./live.js";
import { page } from "./page.js";

const PORT = Number(process.env.FLEET_PORT ?? 8787);

/**
 * Addresses to listen on, comma-separated. Never a wildcard.
 *
 * TWO ON PURPOSE. The tailnet address is how a phone reaches this, and
 * `127.0.0.1` is how an ssh forward does — and the ssh forward is the fallback
 * that depends on nothing, so it stays even once Tailscale works. Node binds one
 * address per server, so this is a list and we create one server per entry
 * rather than reaching for `0.0.0.0`; the Hetzner firewall would refuse public
 * traffic anyway, but a wildcard bind is the habit that eventually gets it wrong
 * on a box that has no firewall.
 */
const BINDS = (process.env.FLEET_BIND ?? "127.0.0.1").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * 60s, not 30s. One collection costs ~12s of grepping, so at 30s this process
 * spends 40% of its life churning the page cache — and on 2026-09-08 this box
 * hit load average 391 with the OOM killer firing, which is not a moment to be
 * a background contributor. Raise it further, don't lower it.
 */
const REFRESH_MS = Number(process.env.FLEET_REFRESH_MS ?? 60_000);

let snapshot: FleetSnapshot | null = null;
let lastError: string | null = null;

/** The wire shape, in one place, so the poll and the stream cannot disagree. */
function statePayload(): string {
  return JSON.stringify({ ...(snapshot ?? { rows: [], collectedAt: null, tookMs: 0 }), error: lastError });
}

function refresh(): void {
  try {
    snapshot = collect();
    lastError = null;
    console.log(
      `collected ${snapshot.rows.length} sessions in ${snapshot.tookMs}ms` +
        (subscriberCount() ? ` → ${subscriberCount()} live` : ""),
    );
    broadcast(statePayload());
  } catch (err) {
    // Keep the previous snapshot. The page shows the age, so a stale page is
    // legible; a blank one is a lie that looks like an empty box.
    lastError = err instanceof Error ? err.message : String(err);
    console.error(`collection failed: ${lastError}`);
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
  if (url === "/" || url.startsWith("/?")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(page(snapshot, lastError));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found\n");
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
refresh();
setInterval(refresh, REFRESH_MS).unref();

// Keeps an idle SSE connection from being dropped by anything in between. Its
// own timer is unref'd, so it cannot hold the process open by itself — the
// listening sockets are what do that.
startHeartbeat(Number(process.env.FLEET_HEARTBEAT_MS ?? 15_000));
