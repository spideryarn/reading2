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
import { page } from "./page.js";

const PORT = Number(process.env.FLEET_PORT ?? 8787);
const BIND = process.env.FLEET_BIND ?? "127.0.0.1";
const REFRESH_MS = Number(process.env.FLEET_REFRESH_MS ?? 30_000);

let snapshot: FleetSnapshot | null = null;
let lastError: string | null = null;

function refresh(): void {
  try {
    snapshot = collect();
    lastError = null;
    console.log(`collected ${snapshot.rows.length} sessions in ${snapshot.tookMs}ms`);
  } catch (err) {
    // Keep the previous snapshot. The page shows the age, so a stale page is
    // legible; a blank one is a lie that looks like an empty box.
    lastError = err instanceof Error ? err.message : String(err);
    console.error(`collection failed: ${lastError}`);
  }
}

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/api/agents")) {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ...(snapshot ?? { rows: [], collectedAt: null }), error: lastError }, null, 2));
    return;
  }
  if (url === "/" || url.startsWith("/?")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(page(snapshot, lastError));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found\n");
});

server.listen(PORT, BIND, () => {
  console.log(`fleet v0.1 on http://${BIND}:${PORT} — refreshing every ${REFRESH_MS / 1000}s`);
  refresh();
  setInterval(refresh, REFRESH_MS).unref();
});
