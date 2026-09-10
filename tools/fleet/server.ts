/**
 * v0.1 of the fleet dashboard: one read-only page listing session titles.
 *
 *   npx tsx tools/fleet/server.ts
 *
 * Direction and constraints: docs/project/overseer-direction.md.
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
 * must not depend on anything under src/ (overseer-direction.md § Principles).
 * Worth revisiting if it grows.
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collect, COLLECT_DEADLINE_MS, type FleetSnapshot } from "./collect.js";
import { probeOwner } from "./child.js";
import { makeAdmission } from "./admission-wiring.js";
import { makeSchedule } from "./schedule-wiring.js";
import { makeOccurrences } from "./occurrences-wiring.js";
import { parseBinds } from "./config.js";
import { collectHealthAsync, type HealthReport } from "./health.js";
import { type HealthTurn } from "./health-history.js";
import { makeDeploys } from "./deploys-wiring.js";
import { makeHealthRetention } from "./health-wiring.js";
import { makeReadinessRetention, WINDOW_HOURS as READINESS_WINDOW_HOURS } from "./readiness-wiring.js";
import { readinessRoute } from "./routes-readiness.js";
import { usageHistoryRoute } from "./routes-usage-history.js";
import { defaultUsageHistoryDir, openUsageHistoryForRead } from "./usage-history.js";
import { applySecurityHeaders } from "./headers.js";
import { broadcast, startHeartbeat, subscribe, subscriberCount } from "./live.js";
import { PublicationLedger, serverInstanceId } from "./instance.js";
import { readStartRevision } from "./revision.js";
import { readCheckpointFeeds } from "./overseer-status.js";
import { openFleetActionStores } from "./action-stores.js";
import { drainSharedQueues, enqueueSharedMessage, handleActionRequest } from "./routes-actions.js";
import { handleBroadcastRequest } from "./routes-broadcast.js";
import { nextWaitMs, refreshOnce, singleFlightCollect } from "./refresh.js";
import { configureNewSessionNotifier, newSessionRoutes } from "./routes-new.js";
import { makeDecisionsRoute } from "./routes-decisions.js";
import { makeRecoveryRoute } from "./routes-recovery.js";
import { reportsApiRoute } from "./routes-reports.js";
import { ideaQueueRoute } from "./routes-idea-queue.js";
import { recentFeedRoute } from "./routes-recent-feed.js";
import { renameRoute } from "./routes-rename.js";
import { handleSteerRequest } from "./routes-steer.js";
import { handleTranscribeRequest } from "./routes-transcribe.js";
import { describeOne } from "./describe.js";
import { describeBreakdownBalances, runDescribePass, type SessionToDescribe } from "./describe-pass.js";
import {
  descriptionsRoot,
  readDescriptionMemory,
  writeDescriptionMemory,
  EMPTY_DESCRIPTIONS,
  type DescriptionMemory,
} from "./describe-store.js";
import { openRouterKey } from "./transcribe.js";
import { readOpeningMessages } from "./transcript.js";
import { notifyLine, notifyOverseer, promptExcerpt } from "./notify-overseer.js";
import { claimFromSnapshot } from "./overseer-claim.js";
import { initialFramePayload, statePayload as composePayload } from "./state.js";
import { readRecentMessages } from "./transcript.js";

/**
 * Where the built React client lives: beside this file, unless `FLEET_DIST`
 * names another directory.
 *
 * The override exists so a test can start this server as a real process
 * against a missing or broken client build without touching the real one
 * (tests/fleet-server-process.test.ts). It must be absolute, for the store
 * roots' reason: a relative path resolves against whichever directory the
 * command was typed in, which is a different client for systemd and for a
 * person in a worktree. Empty counts as unset, as `FLEET_READINESS_DIR` does.
 */
const DIST_OVERRIDE = (process.env.FLEET_DIST ?? "").trim();
if (DIST_OVERRIDE !== "" && !path.isAbsolute(DIST_OVERRIDE)) {
  console.error(`✗ FLEET_DIST must be an absolute path; got ${JSON.stringify(DIST_OVERRIDE)}`);
  process.exit(2);
}
const DIST =
  DIST_OVERRIDE !== ""
    ? path.resolve(DIST_OVERRIDE)
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "web", "dist");

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
const publicationLedger = new PublicationLedger(serverInstanceId());
/** The revision this process started from — read once, here, never again: tools/fleet/revision.ts says why. */
const startRevision = readStartRevision(fileURLToPath(new URL("../..", import.meta.url)));
// Read by the diagnostics route, Stage 3 (docs/plans/260910f).
void startRevision;

/**
 * The box's own vital signs, refreshed alongside the fleet.
 *
 * Null until the first reading, and null again only if a reading throws — which
 * `collectHealthAsync` is built not to do: every field of it can say "I could not
 * tell" rather than returning a zero that reads as healthy.
 */
let health: HealthReport | null = null;

/**
 * One owner for every fleet probe over the process lifetime. Building this
 * inside either health or collection would forget a stuck child every minute
 * and start it a new sibling, which is the multiplication the owned-child
 * registry exists to prevent. Health and tmux use disjoint probe-key prefixes.
 */
const fleetProbeOwner = probeOwner();

/**
 * When the loop last STARTED a collection — see `attemptedAt` in state.ts.
 *
 * Separate from `snapshot.collectedAt` on purpose: a collector that has stopped
 * trying and a box that has nothing new to say look identical without it.
 *
 * **Written by the latch's `onStart`, not by `refresh()`, and that is the whole
 * point.** With a single-flight latch a turn can decline to start a child,
 * because the previous one is still running; setting this at the top of the
 * turn would have made it mean *the loop took a turn* instead — and five
 * consumers read it as a child's start time (`web/src/Header.tsx`,
 * `attempt-clock.ts`, and the Overseer's `daemon.ts`, `observation.ts`,
 * `notes.ts`). The page would have said *a collection was started 0s ago* over
 * a child wedged for seven minutes. GPT Sol's P1, 2026-09-08.
 *
 * So the field keeps its meaning and the consumers keep working. What a wedged
 * collector looks like is: this frozen at the wedged child's start, the page
 * saying *started 7 minutes ago*, and `lastError` saying why. All three true.
 */
let attemptedAt: string | null = null;

/**
 * The last day of vitals: the store, the route and the retain hook, composed.
 *
 * **ONE CALL, DELIBERATELY.** The store and the route must be the same store
 * and the same route, and this file cannot be imported by a test — so the
 * composition lives in `health-wiring.ts` where a test drives the identical
 * function, and what is left here is the call and the log lines. See that
 * file's header for the version of this that looked tested and was not.
 *
 * **A STORE THAT WILL NOT OPEN IS NOT FATAL, AND IS NOT SILENT EITHER.** A
 * read-only home directory or a relative `FLEET_HEALTH_DIR` must not stop the
 * dashboard, because the live page is worth more than its history — but the
 * route then answers `unreadable` with a sentence, so the panel says nothing is
 * being recorded rather than drawing an empty day.
 */
const retention = makeHealthRetention({
  dir: process.env["FLEET_HEALTH_DIR"],
  refreshMs: REFRESH_MS,
});
const admission = makeAdmission();
// The scheduler's preview, as the Overseer daemon last wrote it. A store that
// cannot be resolved answers `unreadable` rather than stopping the dashboard.
const schedule = makeSchedule();
// What the scheduler has launched, and each occurrence's answer. The same store
// and the same trade as the preview's.
const occurrences = makeOccurrences();
for (const line of retention.lines.log) console.log(line);
for (const line of retention.lines.error) console.error(line);

/**
 * **THE HOLDS AND ACTION RECEIPTS FROM THE LAST RUN, READ BACK BEFORE THIS ONE
 * CAN BE ASKED TO TYPE.**
 *
 * A session held after a send nobody could account for may still have half a
 * sentence in its input box, and a tmux server does not restart just because
 * this process did. Until Stage 4b a restart built an empty book, `next()` saw
 * no hold, and keystrokes were admitted again with nobody told.
 *
 * **THE POSITION OF THIS LINE IS THE WHOLE GUARANTEE**: it is synchronous, and
 * it is above `createServer` and every route mounted in `handler`, so there is
 * no window in which this server can be asked to send while it is still
 * reading either store. tests/fleet-hold-restart.test.ts reads this file and
 * fails if the call goes missing or drifts below the listener — the same kind
 * of source guard health-wiring.ts describes, and for the same reason: nothing
 * can import this file without binding port 8787.
 *
 * A store that will not open is NOT fatal, exactly like the health store: the
 * dashboard is the thing you reach for when other things are broken, so it
 * opens both stores here, falls back in memory where needed, and says so loudly.
 */
const actionStores = openFleetActionStores({ log: (line) => console.error(line) });
for (const line of actionStores.lines.log) console.log(line);
for (const line of actionStores.lines.error) console.error(line);

/**
 * Readiness: whether dev is green, and the day behind that answer.
 *
 * **The snapshot is computed on the refresh loop and served from memory.** Its
 * inputs are git, a scan of every checkout's `logs/tmux-jobs/`, and `tmux ls` —
 * none of which may happen inside a request on a single-threaded server that has
 * to stay up when the box is at load 391. `readiness-wiring.ts` § the timer.
 *
 * Like health retention, a store that will not open does not stop the
 * dashboard: the payload then reports that nothing is being recorded, which the
 * verdict turns into `unknown` rather than into a quiet green.
 */
const readiness = makeReadinessRetention({ primary: process.cwd() });
for (const line of readiness.lines.log) console.log(line);
for (const line of readiness.lines.error) console.error(line);

let readinessSnapshot: import("./readiness-wiring.js").ReadinessSnapshot | null = null;

/**
 * Recompute it, never throwing into the loop.
 *
 * A readiness collection that failed must leave the PREVIOUS snapshot in place
 * — the page shows how old it is, so a stale answer is legible, where a blank
 * one is a lie that looks like an empty box. Same rule as `health` above.
 */
function refreshReadiness(): void {
  try {
    readinessSnapshot = readiness.collect();
  } catch (err) {
    console.error(`readiness collection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
refreshReadiness();

/** How often readiness is recomputed. See the loop for why it is not REFRESH_MS. */
const READINESS_REFRESH_MS = Number(process.env["FLEET_READINESS_REFRESH_MS"] ?? 120_000);
let lastReadinessMs = Date.now();

const readinessApi = readinessRoute({
  snapshot: () => readinessSnapshot,
  windowHours: READINESS_WINDOW_HOURS,
  /* **READINESS_REFRESH_MS, not REFRESH_MS.** The page polls at whatever this
     says, so advertising the fleet's 60s cadence for a snapshot recomputed every
     two minutes had it fetching the same answer twice for every new one. */
  refreshMs: READINESS_REFRESH_MS,
});

/**
 * The cross-agent feed. **The snapshot is passed as a function, not a value** —
 * it is replaced wholesale by every collection, and a route holding the one it
 * was built with would serve the fleet as it was at startup for ever. Same
 * reason the actions routes take it that way below.
 */
const feedRoute = recentFeedRoute({ snapshot: () => snapshot, nowMs: () => Date.now() });

/**
 * Usage history, read from the Overseer's store.
 *
 * **Built once and holding only a reader.** The store is written by the daemon;
 * this process opens it read-only, takes no lock, and cannot take one — the
 * reader is a separate function with no lock code in it. So two dashboards, or a
 * dashboard and a daemon, coexist without any election to lose.
 *
 * A relative `OVERSEER_STORE_DIR` throws (it means two stores that cannot see
 * each other), so this is caught and turned into a route that answers
 * `unreadable` with the reason, rather than taking the whole server down over a
 * chart.
 */
const usageHistoryStore = (() => {
  try {
    return openUsageHistoryForRead(defaultUsageHistoryDir());
  } catch (err) {
    console.error(`✗ usage history: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
})();
const usageHistoryRouteHandler = usageHistoryRoute({
  store: usageHistoryStore,
  refreshMs: REFRESH_MS,
  nowMs: () => Date.now(),
});

/**
 * The queue of ideas. Built once, at module scope, like the feed route above —
 * it holds no state, but a route rebuilt per request is a habit that becomes a
 * second queue the first time one of them does.
 *
 * Reads `~/.overseer/queue.jsonl` fresh on every request rather than caching:
 * it is tens of kilobytes at most, it is the answer to *what is authorised*,
 * and a stale answer to that question is worse than a slow one.
 */
const queueRoute = ideaQueueRoute();

/** Read fresh on request: this is the review record, not refresh-loop state. */
const decisionsApiRoute = makeDecisionsRoute();
const recoveryApiRoute = makeRecoveryRoute();

/**
 * The Deploys tab's record and its probe.
 *
 * Cheap enough to build unconditionally: it opens nothing at startup and spawns
 * anything only per request. The composition is in deploys-wiring.ts rather than
 * here for the reason health-wiring.ts states at length — a test that assembles
 * its own route proves the route works, and stays green if this file mounts a
 * different one.
 */
const deploys = makeDeploys();
for (const line of deploys.lines.log) console.log(line);

/**
 * The wire shape, in one place, so the poll and the stream cannot disagree.
 *
 * The shape itself lives in state.ts, where it can be tested without binding a
 * port — and where the rule that matters is written down: `collectedAt: null`
 * means NEVER COLLECTED, and an empty `rows` is only a claim about the box when
 * `collectedAt` is non-null.
 */
/**
 * **TELLING THE OVERSEER A SESSION WAS STARTED FROM THE WEB UI.**
 *
 * This lives here and not in `routes-new.ts` because it needs two things that
 * module deliberately does not have: the live fleet snapshot, to resolve who
 * holds the `overseer` role, and the shared steering queue to reach them.
 *
 * **IT QUEUES; IT DOES NOT SEND.** Since `send-coordinator.ts`, every producer
 * of keystrokes goes through one coordinator whose point is that the quarantine
 * check and the transport call are adjacent. Sending from here — in a child
 * process, as first planned, to keep a synchronous 60-second worst case off the
 * event loop — would have carried its **own** quarantine book: `holding()` would
 * answer null for the whole box and this notice could type a second sentence
 * into a session already held behind half of one. Queueing dissolves that
 * instead of mitigating it, because `enqueueSharedMessage` makes no tmux calls
 * at all, and the drain then delivers through the coordinator with the hold
 * check in-process where it belongs.
 *
 * **THE SHARED QUEUE, NEVER A SECOND ONE.** Two queues would mean the one the
 * page renders is not the one anything delivers from.
 *
 * **The claim is read through `claimFromSnapshot`**, over this server's own
 * payload, rather than by picking `role === "overseer"` out of the rows: that
 * function carries the staleness and failed-collection checks, and a hand-rolled
 * read gets them wrong. Serialising the payload for one launch is affordable —
 * the route allows one launch at a time behind a cooldown.
 */
function tellOverseer(input: {
  sessionName: string | null;
  startedDir: string | null;
  origin: string | null;
  prompt: string;
}): ReturnType<typeof notifyOverseer> {
  const claim = claimFromSnapshot(JSON.parse(statePayload()), {
    nowMs: Date.now(),
    /* Deliberately short. A stale snapshot means we do not know who holds the
       role NOW, and `cannot-tell` is the honest answer — the alternative is
       addressing whoever held it minutes ago. */
    maxAgeMs: 120_000,
  });
  return notifyOverseer(
    {
      claim,
      rows: (snapshot?.rows ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        paneId: row.paneId,
        panePid: row.panePid,
        claudeSessionId: row.claudeSessionId,
        status: row.status,
      })),
      /* RAW TEXT AND A SPEAKER. `enqueueMessage` renders, and `drain.ts` renders
         again at delivery; handing over a prefixed string prefixes it twice. */
      enqueue: (target, text, speaker) => enqueueSharedMessage(target, text, speaker),
    },
    notifyLine({
      sessionName: input.sessionName,
      origin: input.origin,
      dir: input.startedDir,
      promptFirstLine: promptExcerpt(input.prompt),
    }),
  );
}

configureNewSessionNotifier(tellOverseer);

function statePayload(): string {
  /* **THE COMPOSITION ITSELF IS IN state.ts, and only the wiring is here.**
     This file binds ports at import time, so nothing can import this function
     and call it — which meant the join test had to rebuild the edge inside
     itself and stayed green when production stopped making it. `composePayload`
     is the same function production goes through, and a test drives it.

     Two things are read PER PAYLOAD rather than captured once, and for the same
     reason routes-steer.ts reads its flag per request. The answering flag:
     turning it on should be a restart, and the page should learn about it on
     its next refresh rather than on a reload nobody performs. The attention
     inbox AND the Overseer's own status, which are one read of
     `~/.overseer/current.json` — ~10KB, replaced by atomic rename, so a read is
     cheap and always current, while caching it would put a list regenerated
     every two minutes on this loop's 55–60s clock. One read rather than two
     because the page prints the inbox's clock and the checkpoint's clock in one
     sentence, and two reads can straddle a write. */
  return composePayload({
    snapshot,
    error: lastError,
    health,
    refreshMs: REFRESH_MS,
    answeringEnabled: process.env["FLEET_ANSWER_ENABLED"] !== "0",
    attemptedAt,
    producer: publicationLedger.stamp(),
    readCheckpoint: readCheckpointFeeds,
  });
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
 * throws must not cost us the session list. `collectHealthAsync` is built not to
 * throw — every field of it can say "I could not tell" rather than returning a
 * zero that reads as healthy — so this catch is for the case where that is
 * itself wrong.
 */
async function refreshHealth(): Promise<HealthTurn> {
  try {
    const report = await collectHealthAsync({
      owner: fleetProbeOwner,
      includeSwapActivity: true,
    });
    health = report;
    return { kind: "reading", report };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.error(`health failed: ${why}`);
    /* **`health` IS DELIBERATELY LEFT HOLDING THE PREVIOUS REPORT** — the live
       page showing the last thing we knew is better than it showing nothing —
       **and that is exactly why this returns rather than being read back.** A
       retention layer that read the variable would append that stale report
       under a fresh timestamp, which is a reading nobody took wearing a clock.
       The turn is the truth about this turn; the variable is the best thing we
       have to draw. They are different, and now they are separate. */
    return { kind: "collector-failed", why: `collectHealthAsync threw: ${why}` };
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
/**
 * **ONE COLLECTION AT A TIME, AND THE DEADLINE BELONGS TO THIS LOOP.**
 *
 * Module scope rather than inside `refresh()`, because a latch built per call
 * latches nothing. `collectWithDeadline` used to be passed straight in, and it
 * abandons the *caller* without cancelling the *child* — so a wedged `bash -c`
 * grepping thirty-five transcripts was met, one backoff later, by a second one.
 * The latch is in refresh.ts, where a test can drive it; this is the wiring.
 */
const collector = singleFlightCollect({
  run: () => collect(fleetProbeOwner),
  deadlineMs: COLLECT_DEADLINE_MS,
  now: Date.now,
  // BEFORE the child is awaited, and only when one is actually started — see
  // `attemptedAt` above for why the distinction is load-bearing.
  onStart: () => {
    attemptedAt = new Date().toISOString();
  },
  // A child that came back after we gave up on it. `console.error` rather than
  // `lastError`: it is an answer to a question asked minutes ago, and the page
  // must not go stale twice for one attempt.
  onLate: (line) => console.error(line),
});

async function refresh(): Promise<void> {
  /* `attemptedAt` is NOT set here. It used to be, on a "before the attempt, not
     after it" argument that the latch invalidated: a turn is not an attempt any
     more. The latch's `onStart` sets it, so it still moves exactly when a child
     is actually started. */
  await refreshOnce({
    collect: collector.collect,
    keep: (result) => {
      if ("snapshot" in result) {
        snapshot = result.snapshot;
        lastError = null;
      } else {
        // Keep the previous snapshot. The page shows the age, so a stale page
        // is legible; a blank one is a lie that looks like an empty box.
        lastError = result.error;
      }
      publicationLedger.record("snapshot" in result ? "success" : "failure");
    },
    refreshHealth,
    // A no-op when the store would not open, rather than a branch in the loop:
    // whether history is being kept is a startup fact, and the route is where
    // it is reported.
    retainHealth: retention.retainHealth,
    refreshMs: REFRESH_MS,
    now: () => new Date(),
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
/**
 * HOW OFTEN TO DESCRIBE. Far slower than the collector, because a description is
 * about a session's opening and an opening does not change — the only work a
 * steady-state pass does is notice a session it has not seen before.
 */
const DESCRIBE_MS = Number(process.env.FLEET_DESCRIBE_MS ?? 5 * 60_000);

/**
 * How many model calls one pass may make.
 *
 * A cold fleet catches up over several passes rather than paying for thirty at
 * once, and what the budget drops is reported rather than hidden.
 */
const DESCRIBE_MAX_CALLS = Number(process.env.FLEET_DESCRIBE_MAX_CALLS ?? 8);

/**
 * DESCRIBING THE FLEET, BESIDE THE COLLECTOR RATHER THAN INSIDE IT.
 *
 * A collection has a deadline (`COLLECT_DEADLINE_MS`) and a gateway does not
 * respect it, so no model call may happen on the collector's clock. This runs on
 * its own, writes a file, and `readDescriptions` in `collect.ts` joins that file
 * onto the rows — the cheap half — on the next collection.
 *
 * **It costs nothing when there is no key.** `openRouterKey()` reads the
 * environment and then one variable out of `.env.local`; without one, the pass
 * does not run and every row keeps saying `not-yet-described`, which is true.
 *
 * **And nothing when nothing is eligible**, which is every row until the
 * dashboard and the daemon have been restarted onto execution readings. Before
 * that this loop reads no transcripts and makes no calls.
 */
/**
 * The describer's memory, held in process — F22.
 *
 * A pass whose write fails used to log and discard, so the next pass reread the
 * unchanged file and **paid for the same sessions again**, every five minutes.
 * Keeping the result here means a persistence failure costs a stale file rather
 * than a repeated bill, and the next write retries with everything still in hand.
 */
let describeMemory: DescriptionMemory | null = null;

async function describeOnce(): Promise<void> {
  const key = openRouterKey();
  if (key === null) return;
  const rows = snapshot?.rows ?? [];
  if (rows.length === 0) return;

  const root = descriptionsRoot();
  /* WHAT THIS PROCESS ALREADY HOLDS WINS over what is on disk: a write that
     failed must not make us pay again. The file is only read to seed the first
     pass after a restart. */
  let memory = describeMemory;
  if (memory === null) {
    const read = readDescriptionMemory(root);
    /* An unusable file is REPLACED, not repaired — everything in it is
       recoverable by asking again, and carrying a memory across a gap we cannot
       vouch for is the mistake this neighbourhood keeps repairing. */
    memory = read.kind === "memory" ? read.memory : EMPTY_DESCRIPTIONS;
  }

  const sessions: SessionToDescribe[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    claudeSessionId: row.claudeSessionId,
    dir: row.meta.version === 1 ? row.meta.dir : null,
    execution: row.execution,
  }));

  const result = await runDescribePass({
    sessions,
    memory,
    maxCalls: DESCRIBE_MAX_CALLS,
    readOpening: async (session) => {
      const opening = await readOpeningMessages({ claudeSessionId: session.claudeSessionId, dir: session.dir });
      if (opening.kind !== "found") {
        return { ok: false, why: `${opening.kind}: ${"why" in opening ? opening.why : ""}` };
      }
      if (opening.turns.length === 0) return { ok: false, why: "the transcript opens with no turns" };
      /* Flattened to text here rather than in the pass, so the pass stays pure
         and the shape of a turn does not reach the prompt builder. */
      return {
        ok: true,
        text: opening.turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n\n"),
      };
    },
    describe: async (text) => (await describeOne(text, { apiKey: key })).verdict,
    now: () => new Date(),
  });

  /* HELD BEFORE IT IS WRITTEN, so a failing write costs a stale file rather
     than a repeated bill. */
  describeMemory = result.memory;
  if (!describeBreakdownBalances(result.breakdown)) {
    /* The self-check runs in production rather than only in tests — F25. A pass
       whose numbers do not add up has quietly dropped somebody, and a fleet list
       missing one row looks exactly like a fleet with one fewer session. */
    console.log(`describe: BOOKKEEPING DOES NOT BALANCE: ${JSON.stringify(result.breakdown)}`);
  }
  try {
    writeDescriptionMemory(root, result.memory);
  } catch (err) {
    console.log(`describe: could not write the memory: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (result.breakdown.called > 0 || result.breakdown.overBudget > 0) {
    console.log(
      `describe: ${result.breakdown.described} eligible, ${result.breakdown.called} call(s), ` +
        `${result.breakdown.cached} cached, ${result.breakdown.overBudget} over budget, ` +
        `${result.breakdown.notEligible} not eligible`,
    );
  }
}

/**
 * Its own loop, so a slow gateway cannot delay a collection.
 *
 * **Never throws out of here.** A describer that took the server down would be a
 * monitoring tool failing at the same time as the thing it monitors, which is
 * the failure this whole tool is written against.
 */
async function describeLoop(): Promise<void> {
  for (;;) {
    try {
      await describeOnce();
    } catch (err) {
      console.log(`describe: the pass threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((r) => setTimeout(r, DESCRIBE_MS).unref?.());
  }
}

async function refreshLoop(): Promise<void> {
  for (;;) {
    await refresh();
    /* **Readiness on its own, slower cadence.** It spawns several subprocesses
       and scans every checkout — measured at ~50 ms in total, but on a box that
       reaches load 391 the right instinct is to do that as rarely as the answer
       needs. What it is about — which commit dev is on, and what has been run
       against it — changes on the scale of minutes, not seconds. */
    if (Date.now() - lastReadinessMs >= READINESS_REFRESH_MS) {
      lastReadinessMs = Date.now();
      refreshReadiness();
    }
    /* `nextWaitMs` in refresh.ts, not the expression that used to be here: the
       same number is recorded in every health sample as what the next reading
       was expected at, and two copies of this rule would draw a legitimate
       backoff as an outage the first time one of them moved. */
    const wait = nextWaitMs(REFRESH_MS, lastError !== null);
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
    subscribe(req, res, initialFramePayload(publicationLedger.stamp(), statePayload));
    return;
  }

  // The poll. Same bytes as the stream by construction — both call
  // statePayload() — because two shapes that are meant to be identical and are
  // built in two places will differ eventually, and the client would be the
  // thing that found out.
  //
  // **`/api/agents` IS THE ORIGINAL NAME, KEPT AS AN ALIAS, AND NOTHING IN THIS
  // REPO CALLS IT.** The page polls `/api/state` (web/src/transport.ts) and so
  // does the Overseer (tools/overseer/source.ts). It is retained rather than deleted
  // because it costs one clause and something outside this repo — a note, a
  // bookmark, a curl in somebody's shell history — may still name it; removing
  // a working endpoint to tidy a name is the worse trade. What was actually
  // wrong was the prose in live.ts, which named it five times as "the poll";
  // see there, and instance 10 of docs/postmortems/260908b.
  if (url.startsWith("/api/state") || url.startsWith("/api/agents")) {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(statePayload());
    return;
  }
  // The last day of box health, for the chart on Box health. Read-only, and it
  // reads nothing but this process's own append-only file.
  if (retention.route.handle(req, res)) return;
  if (admission.route.handle(req, res)) return;
  // What the Overseer's scheduler would run next. Read-only: one bounded read of
  // the file the daemon writes each tick, and nothing computed here.
  if (schedule.route.handle(req, res)) return;
  // What it has launched, and the answer link. Read-only; the answer's path is
  // built from the validated id alone (routes-occurrences.ts).
  if (occurrences.route.handle(req, res)) return;

  // Whether dev is green, and the day behind it. Read-only, and it serves the
  // snapshot the refresh loop built rather than computing anything here.
  if (readinessApi.handle(req, res)) return;

  /* The last day of usage limits, for the chart on Usage limits.
     **Read-only and lock-free, and it reads a file THIS PROCESS DOES NOT
     WRITE** — the Overseer daemon does, on its own 300-second pass. That is why
     there is a reader-only opener rather than a flag on the writer: this process
     must be structurally incapable of claiming the store. See
     usage-history.ts § "No writer lock". */
  if (usageHistoryRouteHandler.handle(req, res)) return;

  // The last N messages across EVERY session, for the Recent messages tab.
  // Read-only, and deliberately not on the collection loop: it is a fan-out of
  // byte-bounded tail reads (~250 ms and ~10 MB of page cache for the whole
  // fleet, measured), asked for only when somebody is looking at that tab.
  // Everything it decides lives in routes-recent-feed.ts.
  if (feedRoute.handle(req, res)) return;

  // The most recent production deploys, for the Deploys tab. Read-only twice
  // over: it reads one committed file and asks three read-only questions of the
  // checkout. It never fetches, never calls Vercel — this box has no token —
  // and cannot deploy anything. routes-deploys.ts says why for each.
  if (deploys.route.handle(req, res)) return;

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
          /* A current server's answer, not an old unstamped wire shape. The
             absence of a row means it resolved no conversation claim. */
          claudeSessionId: null,
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
            /* The read threw, but which claim it attempted is still known and
               must not be accepted under a different browser snapshot. */
            claudeSessionId: row.claudeSessionId,
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

  // One free-text line to every live Claude session — the Overseer tab's
  // broadcast. A SECOND write path, mounted beside the first two rather than
  // folded into either: the steer route's per-pane rate limiter is calibrated
  // for a person typing at one session and would refuse a fan-out at its sixth
  // recipient, and the action vocabulary's broadcast carries a reviewed
  // sentence rather than arbitrary prose. routes-broadcast.ts § the header says
  // which of those two this is eventually meant to absorb, and where the
  // authority boundary between them has to stay.
  if (handleBroadcastRequest(req, res)) return;

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

  // The queue of ideas, for the Queued ideas tab. READ-ONLY, and that is a
  // security decision rather than an unfinished one: the queue is gate 3's
  // authorisation record and this server has no authentication, so a write
  // route here would let anything able to reach the port append an item
  // attributed to Greg. routes-idea-queue.ts § read-only says what a write path
  // would need first. Writes go through `scripts/overseer-queue.ts`.
  if (queueRoute.handle(req, res)) return;

  // Things done in Greg's name, for later review. READ-ONLY because this
  // dashboard has no authenticated identity; only the CLI may write reviews.
  if (decisionsApiRoute.handle(req, res)) return;
  if (recoveryApiRoute.handle(req, res)) return;
  if (reportsApiRoute.handle(req, res)) return;

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
/* Beside the collector, never inside it: a model call must not run on a
   clock that has a deadline. */
void describeLoop();

// Keeps an idle SSE connection from being dropped by anything in between. Its
// own timer is unref'd, so it cannot hold the process open by itself — the
// listening sockets are what do that.
startHeartbeat(Number(process.env.FLEET_HEARTBEAT_MS ?? 15_000));
