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

import { collectWithDeadline, type FleetSnapshot } from "./collect.js";
import { parseBinds } from "./config.js";
import { collectHealth, type HealthReport } from "./health.js";
import { applySecurityHeaders } from "./headers.js";
import { broadcast, startHeartbeat, subscribe, subscriberCount } from "./live.js";
import { drainSharedQueues, handleActionRequest } from "./routes-actions.js";
import { refreshOnce } from "./refresh.js";
import { newSessionRoutes } from "./routes-new.js";
import { renameRoute } from "./routes-rename.js";
import { handleSteerRequest } from "./routes-steer.js";
import { handleTranscribeRequest } from "./routes-transcribe.js";
import { fleetState } from "./state.js";
import { readRecentMessages } from "./transcript.js";

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

/**
 * When the loop last STARTED a collection — see `attemptedAt` in state.ts.
 *
 * Separate from `snapshot.collectedAt` on purpose: a collector that has stopped
 * trying and a box that has nothing new to say look identical without it.
 */
let attemptedAt: string | null = null;

/**
 * The wire shape, in one place, so the poll and the stream cannot disagree.
 *
 * The shape itself lives in state.ts, where it can be tested without binding a
 * port — and where the rule that matters is written down: `collectedAt: null`
 * means NEVER COLLECTED, and an empty `rows` is only a claim about the box when
 * `collectedAt` is non-null.
 */
function statePayload(): string {
  // The answering flag is read PER PAYLOAD rather than captured once at
  // startup, for the same reason routes-steer.ts reads it per request: turning
  // it on should be a restart, and the page should learn about it on its next
  // refresh rather than on a reload nobody performs.
  return JSON.stringify(
    fleetState(
      snapshot,
      lastError,
      health,
      REFRESH_MS,
      process.env["FLEET_ANSWER_ENABLED"] !== "0",
      attemptedAt,
    ),
  );
}

/**
 * The box's vitals, refreshed whatever the fleet collection did.
 *
 * IT USED TO BE INSIDE THE SUCCESS BRANCH, and that had it exactly backwards.
 * A fleet collection fails when the box is in trouble — that is when `tmux`
 * times out and when the script gets OOM-killed — so the reading that would
 * *explain* the failure was the one the failure prevented. Greg would have got
 * "collection failed" next to a health block from before whatever went wrong.
 * GPT Astra's A17, 2026-09-08.
 *
 * Still separately guarded, for the original reason: a health reading that
 * throws must not cost us the session list. `collectHealth` is built not to
 * throw — every field of it can say "I could not tell" rather than returning a
 * zero that reads as healthy — so this catch is for the case where that is
 * itself wrong.
 */
function refreshHealth(): void {
  try {
    health = collectHealth({ includeSwapActivity: true });
  } catch (err) {
    console.error(`health failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * One turn of the loop: collect, take the vitals, publish, deliver.
 *
 * **THE ORDER LIVES IN refresh.ts, NOT HERE**, and this function is only the
 * wiring — the module state it writes, the real collector, the real broadcaster,
 * and `drainSharedQueues`, which is the routes' own queue and cannot be anything
 * else. Nothing in this file can be imported by a test (importing it binds port
 * 8787), and the missing line that this whole stage exists to fix was a missing
 * line in exactly this function, so what is left in it is as close to nothing as
 * it can be. tests/fleet-refresh.test.ts drives `refreshOnce` with the real
 * action routes and a fake transport.
 */
async function refresh(): Promise<void> {
  // BEFORE the attempt, not after it, because the whole point of this field is
  // to be moving while a collection is not.
  attemptedAt = new Date().toISOString();
  await refreshOnce({
    collect: collectWithDeadline,
    keep: (result) => {
      if ("snapshot" in result) {
        snapshot = result.snapshot;
        lastError = null;
      } else {
        // Keep the previous snapshot. The page shows the age, so a stale page
        // is legible; a blank one is a lie that looks like an empty box.
        lastError = result.error;
      }
    },
    refreshHealth,
    publish: () => broadcast(statePayload()),
    drain: drainSharedQueues,
    log: (line) => console.log(line),
    logError: (line) => console.error(line),
    subscribers: subscriberCount,
  });
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

  // BEFORE ANYTHING DECIDES WHAT THE RESPONSE IS. There are five response paths
  // here and two of them live in modules built by other agents; a header set at
  // each exit is one that will be missing from the sixth. `setHeader` survives
  // the `writeHead` those routes do, so they need to know nothing about it.
  // Why these headers at all: headers.ts, and GPT Astra's A6 — this page is a
  // privileged renderer of content written by agents processing untrusted input,
  // and it can now type into those same agents.
  applySecurityHeaders(res);

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
  // Recent messages for one session, for the detail pane.
  //
  // ADDRESSED THROUGH THE CURRENT SNAPSHOT, NOT THROUGH THE QUERY STRING. The
  // caller names a tmux handle and we look up the row; it never names a path, a
  // uuid or a directory. So the worst a crafted URL can do is miss — this route
  // can only read a conversation the page is already showing, and there is no
  // traversal question to get wrong because there is no caller-supplied path.
  //
  // Read-only, but not harmless: every string it returns is agent-authored text
  // from a process that may have been handling hostile input. React escapes it;
  // nothing here adds markup.
  if (url.startsWith("/api/messages")) {
    const id = new URL(req.url ?? "/", "http://fleet.invalid").searchParams.get("id");
    const row = snapshot?.rows.find((r) => r.id === id) ?? null;
    if (row === null) {
      res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(
        JSON.stringify({
          kind: "not-found",
          reason: "no-such-session",
          why: "no session with that handle in the current snapshot",
        }),
      );
      return;
    }
    void readRecentMessages({
      claudeSessionId: row.claudeSessionId,
      dir: row.meta.version === 1 ? row.meta.dir : null,
      limit: 12,
    })
      .then((payload) => {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(payload));
      })
      // `readRecentMessages` is built not to reject — every failure is a `kind`
      // — so this is for the case where that is itself wrong. Without it the
      // request hangs until the phone gives up, which is indistinguishable from
      // the box being down.
      .catch((err: unknown) => {
        res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(
          JSON.stringify({
            kind: "unreadable",
            path: null,
            why: `reading the transcript threw: ${err instanceof Error ? err.message : String(err)}`,
          }),
        );
      });
    return;
  }

  // THE ONLY WRITE PATH IN THIS TOOL: it types into live agent sessions.
  // Before serveStatic, so that no file which ever lands under web/dist/ can
  // shadow it — a bundle named `api/steer/message` is absurd and is exactly the
  // kind of absurdity a build step produces once and nobody notices.
  //
  // Everything about whether a keystroke may go out lives in routes-steer.ts
  // and steer.ts. This line is deliberately the whole of the wiring: the server
  // must not acquire opinions about steering that the tested modules do not
  // have, or there will be two places to read and they will diverge.
  if (handleSteerRequest(req, res)) return;

  // The action vocabulary: the catalogue, the per-session queue, the box-health
  // kills and the fleet broadcast. Mounted through `handleActionRequest` rather
  // than through a `makeActionRoutes()` of our own, and that is not a style
  // choice: the queue is STATE, and a second instance would be a second queue —
  // the one the page renders would be the one nothing ever delivers from. When
  // a drainer lands it goes through this same function for the same reason.
  //
  // Enacted actions are off by default (`FLEET_ACT_ENABLED=1`), so what is live
  // here today is the catalogue, the queue and the dry runs.
  if (handleActionRequest(req, res)) return;

  // Dictation. The only route here that takes AUDIO, which is a class of
  // payload nothing else on this server handles — so it is neither logged nor
  // sized in a log, and it is held for one request. routes-transcribe.ts.
  //
  // The snapshot is passed as a FUNCTION rather than a value: it is replaced by
  // the refresh loop, and a closure taken at startup would prime every
  // dictation for whichever fleet existed when the server booted. The words
  // Greg is about to say are the session names on the page in front of him now.
  if (
    handleTranscribeRequest(req, res, () =>
      (snapshot?.rows ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        dir: row.meta.version === 1 ? row.meta.dir : null,
      })),
    )
  )
    return;

  // Renaming a session. A write, but a mild one — it changes a label, not a
  // conversation — and it is the one action here whose *second half* is the
  // part that matters: clearing `GJD_PROVISIONAL`, without which `gjd-remote
  // ls` renames the session straight back to Claude's own title.
  if (renameRoute().handle(req, res)) return;

  // Starting a session, which is the other write. `startsWith` mounts it, but
  // the route 404s any path that is not exactly this one, so the prefix cannot
  // quietly widen into `/api/sessions/new/../…`.
  //
  // `void` because `handle` is async and never rejects — it catches its own
  // failures and answers 500. An unhandled rejection here would be a request
  // that hangs until the client gives up, which on a phone is indistinguishable
  // from the box being down.
  if (url.startsWith("/api/sessions/new")) {
    void newSessionRoutes().handle(req, res);
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
