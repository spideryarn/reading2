/**
 * **HOW LONG DOES A FLEET COLLECTION HOLD THE DASHBOARD SHUT?**
 *
 * The fleet dashboard is one Node process. It serves `/api/state` out of module
 * variables, so the data is already cached — but the same thread runs the
 * collection, and a synchronous child process stops the event loop for its whole
 * duration. A cached answer behind a blocked loop is not a cached answer. This
 * script is the instrument for that claim, and for the claim that it got better:
 * docs/plans/260910c-responsive-collection-….md says no speed improvement may be
 * claimed without before/after output from here.
 *
 * **THE LATENCY IS MEASURED FROM ANOTHER PROCESS, AND THAT IS THE WHOLE POINT.**
 * An in-process client cannot measure a blocked event loop, because it is
 * blocked too: it would time a request it could not have sent, and report a
 * comfortable number for a server that was answering nothing. So this binds a
 * real HTTP server on an ephemeral port with the same handler shape `server.ts`
 * uses for `/api/state` (`res.end(cachedString)`), forks a plain-node child that
 * requests it every 25 ms, and reads the child's timings back at the end.
 *
 * **AND EVENT-LOOP LAG BESIDE IT**, from a 5 ms interval measuring its own
 * drift. It is the same fact seen from inside, and it shares no machinery with
 * the HTTP measurement — so a surprising number in one can be checked against
 * the other rather than believed. docs/reusable/silent-success.md.
 *
 * Usage:
 *   npx tsx scripts/fleet-collect-bench.ts --mode=real [--runs=3]
 *   npx tsx scripts/fleet-collect-bench.ts --mode=slow-probe --probe-ms=30000 --style=sync
 *   npx tsx scripts/fleet-collect-bench.ts --mode=fixture --sessions=25 --probe-ms=30000
 *
 * Nothing here writes to the live dashboard, the daemon, or any session. The
 * `real` mode runs read-only probes (`tmux list-panes`, `capture-pane -p`, `ps`,
 * `uptime`) against this box, which is what the collector already does once a
 * minute.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { promisify } from "node:util";
import { hrtime } from "node:process";

import { buildSessionScript, parseSessions, type Session } from "../scripts/gjd-remote-tmux.js";
import { collect, panesBySession, toRows, type FleetRow, type FleetSnapshot, type PaneInfo } from "../tools/fleet/collect.js";
import { collectHealth, type HealthReport } from "../tools/fleet/health.js";
import { readCheckpointFeeds } from "../tools/fleet/overseer-status.js";
import { capturePane } from "../tools/fleet/pane.js";
import { statePayload as composeStatePayload } from "../tools/fleet/state.js";
import { statusesOf } from "../tools/fleet/status.js";
import { probeProcessTable } from "../tools/overseer/work-probe.js";

const run = promisify(execFile);

// ---------------------------------------------------------------------------
// Percentiles. Nearest-rank on a sorted copy — no interpolation, so every
// number reported is a number that was actually measured.
// ---------------------------------------------------------------------------

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? Number.NaN;
}

export type Summary = { n: number; median: number; p95: number; max: number };

export function summarise(samples: readonly number[]): Summary {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.length === 0 ? Number.NaN : (sorted[sorted.length - 1] ?? Number.NaN),
  };
}

const ms = (n: number): string => (Number.isNaN(n) ? "—" : `${n.toFixed(1)} ms`);

// ---------------------------------------------------------------------------
// The two instruments.
// ---------------------------------------------------------------------------

/**
 * Event-loop lag, from inside: a 5 ms interval that records how late it was.
 *
 * A blocked loop cannot fire a timer, so every millisecond of block shows up as
 * drift on the first tick after it. `unref` so it can never hold the process up.
 */
function lagMeter(): { stop(): number[] } {
  const samples: number[] = [];
  const every = 5;
  let last = hrtime.bigint();
  const timer = setInterval(() => {
    const now = hrtime.bigint();
    const elapsed = Number(now - last) / 1e6;
    last = now;
    samples.push(Math.max(0, elapsed - every));
  }, every);
  timer.unref();
  return {
    stop: () => {
      clearInterval(timer);
      return samples;
    },
  };
}

/**
 * **HOW MANY REQUESTS MAY BE OUTSTANDING AT ONCE.**
 *
 * The first version had no bound, which turned a 30-second measurement into a
 * ten-minute hang and would have made every percentile a fiction. At 40 requests
 * a second against a server blocked for thirty seconds, roughly 1,200 sockets
 * pile up — well past the listen backlog, and beyond it Linux (with
 * `tcp_abort_on_overflow` at its default 0) silently drops the client's ACK and
 * leaves the socket retransmitting for minutes. What that measures is the
 * kernel's accept queue, not the server's latency.
 *
 * Sixty-four is more than a dashboard ever has open and small enough that every
 * one of them is a real sample of a real server.
 */
const MAX_FLIGHT = 64;

/** What the poller saw, with every request it issued accounted for. */
export type PollResult = {
  /** Requests that came back, in milliseconds. */
  latencies: number[];
  /** Requests that errored outright — a different fact from a slow one, never averaged in. */
  failures: number;
  /**
   * Requests still in flight when the drain deadline expired, with how long each
   * had already been waiting. **These are LOWER BOUNDS**, and they are the
   * slowest requests in the run by construction, so dropping them would flatter
   * every percentile.
   */
  pending: number[];
  /** Everything the poller started. `issued === latencies.length + failures + pending.length`. */
  issued: number;
};

/**
 * A server that answers `/api/state` the way the real one does, and a child
 * process that asks it 40 times a second.
 *
 * THE CHILD IS PLAIN NODE, not tsx: it must start in milliseconds and must not
 * share anything with the process under measurement.
 *
 * **IT ACCOUNTS FOR EVERY REQUEST IT ISSUED, AND THE FIRST VERSION DID NOT.**
 * That version issued a request every 25 ms and then `SIGKILL`ed the child 300 ms
 * after the phase, so whatever was still in flight was simply gone: a 30-second
 * run recorded 641 completions out of roughly 1,200 issued. The baseline survived
 * it — the dropped requests were issued *during* the block and would have been at
 * least as slow — but a future p95 could pass by omitting exactly the requests
 * that would have failed it, which is the shape docs/reusable/silent-success.md
 * is about. GPT Sol's P1 on this plan, 2026-09-10.
 *
 * So the parent tells the child to STOP ISSUING, the child drains what is in
 * flight, and anything still outstanding at the drain deadline is reported as
 * `pending` with the time it had already waited. `report` then refuses to print
 * a summary whose parts do not add up to `issued`.
 *
 * **AND THE PAYLOAD IS BUILT PER REQUEST, from a function**, rather than served
 * from a fixed string. The plan's whole diagnosis is that the data is already
 * collected and only the loop is blocked; a bench that serves a constant cannot
 * notice the day that stops being true. The real `server.ts` calls
 * `statePayload()` on every request, and so does this.
 */
async function pollerAgainst(payload: () => string): Promise<{
  server: Server;
  stop(): Promise<PollResult>;
}> {
  const server = createServer((req, res) => {
    if ((req.url ?? "/").startsWith("/api/state")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(payload());
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the bench server did not bind a port");
  const url = `http://127.0.0.1:${address.port}/api/state`;

  /* The child's protocol, in three line kinds: `L <ms>` completed, `E` failed,
     `P <ms>` still pending at the drain deadline (a lower bound). It stops
     issuing when anything arrives on stdin, and exits once the flight is empty
     or the drain deadline passes — so the parent never has to guess. */
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const http=require('node:http');
       const url=${JSON.stringify(url)};
       const DRAIN_MS=60000, REQ_MS=90000, MAX_FLIGHT=${MAX_FLIGHT};
       let issuing=true, inFlight=new Map(), seq=0, done=false;
       function finish(){
         if(done) return; done=true;
         for(const [id,t] of inFlight){
           if(settled.has(id)) continue; settled.add(id);
           process.stdout.write("P "+(Number(process.hrtime.bigint()-t)/1e6)+"\\n");
         }
         process.stdout.write("END "+seq+"\\n");
         process.stdout.end(()=>process.exit(0));
       }
       // EXACTLY ONE LINE PER REQUEST, ever. A client-side timeout prints its
       // lower bound and then destroys the socket, which makes the request emit
       // 'error' -- so without this guard one request would be reported twice
       // and the accounting in the parent would go NEGATIVE, which reads as a
       // poller bug rather than as the double-count it is.
       const settled=new Set();
       function settle(id,line){
         if(settled.has(id)) return; settled.add(id);
         process.stdout.write(line);
         inFlight.delete(id);
         if(!issuing && inFlight.size===0) finish();
       }
       function once(){
         // NEVER MORE THAN MAX_FLIGHT AT ONCE. Beyond the listen backlog the
         // kernel silently drops the client's ACK and the socket waits minutes
         // on TCP retransmission -- which is the accept queue's behaviour, not
         // the server's latency, and it wedged a 30-second run for ten minutes.
         if(inFlight.size>=MAX_FLIGHT) return;
         const id=++seq, t=process.hrtime.bigint();
         const since=()=>Number(process.hrtime.bigint()-t)/1e6;
         inFlight.set(id,t);
         const req=http.get(url,{agent:false},res=>{res.resume();res.on('end',()=>settle(id,"L "+since()+"\\n"));});
         req.on('error',()=>settle(id,"E\\n"));
         // A request that outlasts this is reported as a LOWER BOUND, not lost
         // and not called a failure: it is the slowest kind of sample there is.
         req.setTimeout(REQ_MS,()=>{ settle(id,"P "+since()+"\\n"); req.destroy(); });
       }
       const timer=setInterval(once,25);
       process.stdin.resume();
       process.stdin.on('data',()=>{
         if(!issuing) return;
         issuing=false; clearInterval(timer);
         if(inFlight.size===0) finish(); else setTimeout(finish,DRAIN_MS);
       });`,
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );

  const latencies: number[] = [];
  const pending: number[] = [];
  let failures = 0;
  let issued = 0;
  let buffered = "";
  const ended = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") continue;
      /* **`issued` COMES FROM THE CHILD'S OWN COUNTER, not from adding up what
         arrived.** Counting the lines we received would make the accounting
         below a tautology — it would balance however many results went missing,
         which is precisely the failure it exists to catch. */
      if (line.startsWith("END ")) {
        issued = Number(line.slice(4));
        continue;
      }
      if (line === "E") {
        failures += 1;
        continue;
      }
      const value = Number(line.slice(2));
      if (!Number.isFinite(value)) continue;
      if (line.startsWith("L ")) latencies.push(value);
      else if (line.startsWith("P ")) pending.push(value);
    }
  });

  // Let the child start and take a few samples of an idle server, so the
  // baseline in the output is this machine's, not an assumption.
  await new Promise((resolve) => setTimeout(resolve, 500));

  return {
    server,
    stop: async () => {
      child.stdin.write("stop\n");
      /* **BOUNDED, so a poller that will not finish is a reported fault rather
         than a hung bench.** If it does not exit, `issued` stays 0 and the
         accounting in `report` fails loudly — which is the right outcome: a run
         whose sampler had to be killed is not evidence. */
      const gaveUp = await Promise.race([
        ended.then(() => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 90_000)),
      ]);
      if (gaveUp) {
        console.error("the poller did not finish draining within 90s and was killed — the accounting below will not balance, and that is the point");
        child.kill("SIGKILL");
        await ended;
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      /* Any socket still held open by a killed child would keep this process
         alive after `main()` returns — the same handle-leak `subagent-cli.ts`
         records. `unref` on the server is not enough; the connections are. */
      server.closeAllConnections?.();
      return { latencies, failures, pending, issued };
    },
  };
}

/** One phase: run it, and say what it cost and what it cost everybody else. */
async function timed<T>(name: string, body: () => T | Promise<T>): Promise<{ name: string; tookMs: number; lag: Summary; value: T }> {
  const meter = lagMeter();
  const started = hrtime.bigint();
  const value = await body();
  const tookMs = Number(hrtime.bigint() - started) / 1e6;
  /* **DRAIN BEFORE STOPPING, OR THE METER READS EMPTY EXACTLY WHEN IT MATTERS.**
     A wholly synchronous phase gives the interval no chance to fire, so a
     `stop()` on the next line clears a timer whose one meaningful callback —
     the late one carrying the whole block as drift — is still pending. The
     first version of this did that and reported "—" for a 5-second block: a
     check answering a weaker question than the one asked
     (docs/reusable/silent-success.md). One turn of the timer phase is enough. */
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { name, tookMs, lag: summarise(meter.stop()), value };
}

// ---------------------------------------------------------------------------
// Fixture rows, for the controlled measurement.
// ---------------------------------------------------------------------------

/**
 * N sessions that look enough like the real thing for the passes that read
 * them, and are not the real thing in any way that could touch a live session.
 *
 * The pane ids are `%9000…`, which tmux will refuse — fixture mode injects
 * synthetic commands into the capture seam rather than asking tmux. A pane id
 * that cannot exist means a wiring bug shows up as an error rather than as a
 * capture of somebody's terminal.
 */
export function fixtureRows(n: number): FleetRow[] {
  const sessions: Session[] = Array.from({ length: n }, (_, i) => ({
    id: `$${9000 + i}`,
    name: `bench-${i}`,
    created: new Date(Date.now() - 60_000 * (i + 1)),
    attached: false,
    windows: 1,
    title: `bench session ${i}`,
    provisional: false,
    claudeId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    proc: { kind: "claude" },
    meta: { version: 1, kind: "claude", repo: "gregdetre/spideryarn2", dir: `/home/greg/bench/${i}` },
    role: { kind: "none" },
  }));
  const listing = new Map<string, PaneInfo>(sessions.map((s, i) => [s.id, { paneId: `%${9000 + i}`, panePid: null }]));
  /* **THE AGENTS MAP IS NOT OPTIONAL HERE, AND THE FIRST VERSION LEFT IT NULL.**
     Without it every row's status is `unknown`, `modeApplicability` settles it
     without reading anything, and `readPanes` skips all 25 — so the fixture ran
     in 0.2 ms and reported a comfortable p95 for a pass that never captured a
     pane. A bench that measures nothing looks exactly like a fast one
     (docs/reusable/silent-success.md). `busy` makes every row `working`, which
     is the arm that says read-the-pane. */
  const agents = new Map(sessions.map((s) => [s.claudeId ?? "", "busy"]));
  const status = new Map(statusesOf({ sessions, agents, agentsWhy: null }).map((r) => [r.id, r.status]));
  const rows = toRows(sessions, status, listing);
  const reading = rows.filter((r) => r.status.kind === "working").length;
  if (reading !== n) throw new Error(`fixtureRows built ${n} rows but only ${reading} would have their pane read — the fixture would measure nothing`);
  return rows;
}

// ---------------------------------------------------------------------------
// Modes.
// ---------------------------------------------------------------------------

type Row = { phase: string; tookMs: number; lag: Summary; note?: string };

/**
 * The thing the bench's `/api/state` serves: the **real** `statePayload()` over
 * whatever the run has collected so far, recomputed per request exactly as
 * `server.ts` does.
 *
 * A fixed string would have been simpler and would have measured a weaker claim
 * — it cannot notice the day the composition starts doing real work, which is
 * the assumption this whole plan rests on. GPT Sol's P1.
 */
function livePayload(initial: FleetSnapshot, health: HealthReport | null): { render(): string; keep(s: FleetSnapshot, h: HealthReport | null): void } {
  let snapshot = initial;
  let report = health;
  return {
    render: () =>
      composeStatePayload({
        snapshot,
        error: null,
        health: report,
        refreshMs: 60_000,
        answeringEnabled: true,
        attemptedAt: new Date().toISOString(),
        readCheckpoint: readCheckpointFeeds,
      }),
    keep: (s, h) => {
      snapshot = s;
      report = h;
    },
  };
}

/** A snapshot over the given rows, for a bench that has not collected one yet. */
function snapshotOf(rows: FleetRow[]): FleetSnapshot {
  return { rows, collectedAt: new Date().toISOString(), tookMs: 0, tmuxServerPid: null };
}

/**
 * The summary — **and the accounting, which is the part that keeps it honest.**
 *
 * Percentiles are taken over completions *and* the lower bounds of anything
 * still pending, because the pending ones are the slowest requests in the run
 * by construction and leaving them out is how a bad p95 passes. If the parts do
 * not add up to what the child says it issued, this prints the discrepancy in
 * the loudest terms it has and sets a non-zero exit code: a benchmark that has
 * lost track of its own requests is not evidence of anything.
 */
function report(title: string, rows: readonly Row[], http: PollResult, context: readonly string[]): void {
  console.log(`\n## ${title}\n`);
  for (const line of context) console.log(`- ${line}`);
  console.log("");
  console.log("| phase | wall | loop lag median | loop lag p95 | loop lag max |");
  console.log("|---|---|---|---|---|");
  for (const row of rows) {
    console.log(`| ${row.phase}${row.note === undefined ? "" : ` (${row.note})`} | ${ms(row.tookMs)} | ${ms(row.lag.median)} | ${ms(row.lag.p95)} | ${ms(row.lag.max)} |`);
  }
  const accounted = http.latencies.length + http.failures + http.pending.length;
  const all = summarise([...http.latencies, ...http.pending]);
  console.log("");
  console.log(
    `\`/api/state\` from another process at 40/s — **median ${ms(all.median)}, p95 ${ms(all.p95)}, max ${ms(all.max)}**` +
      ` over ${all.n} requests (completions plus the lower bound of anything still pending).`,
  );
  console.log(
    `Accounting: ${http.issued} issued = ${http.latencies.length} completed + ${http.failures} failed + ${http.pending.length} still pending at the drain deadline.`,
  );
  if (accounted !== http.issued) {
    console.log(
      `\n**THIS RUN IS NOT EVIDENCE.** ${http.issued - accounted} of the ${http.issued} requests it issued are unaccounted for, ` +
        `and the ones a run like this loses are its slowest — so every percentile above is flattered by an unknown amount. ` +
        `Fix the poller before quoting anything from here.`,
    );
    process.exitCode = 3;
  }
}

async function boxContext(): Promise<string[]> {
  const lines: string[] = [];
  lines.push(`measured ${new Date().toISOString()} on ${process.platform}, node ${process.version}`);
  try {
    lines.push(`load: ${execFileSync("uptime", { encoding: "utf8", timeout: 5_000 }).trim()}`);
  } catch {
    lines.push("load: could not read `uptime`");
  }
  try {
    const out = execFileSync("tmux", ["list-panes", "-a", "-F", "#{session_id} #{pane_id} #{pane_pid} #{pid}"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    lines.push(`${panesBySession(out).size} tmux sessions with a pane on this box`);
  } catch {
    lines.push("could not list tmux panes");
  }
  return lines;
}

async function modeReal(runs: number): Promise<void> {
  const live = livePayload(snapshotOf([]), null);
  const poller = await pollerAgainst(live.render);
  const rows: Row[] = [];
  for (let i = 0; i < runs; i += 1) {
    const inventory = await timed("bash -c sessionScript() [already async]", () =>
      run("bash", ["-c", buildSessionScript({ agents: true })], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 }),
    );
    const parsed = parseSessions(inventory.value.stdout);
    rows.push({ phase: inventory.name, tookMs: inventory.tookMs, lag: inventory.lag, note: `${parsed.sessions.length} sessions` });

    const generation = await timed("tmux display-message [sync]", () =>
      execFileSync("tmux", ["display-message", "-p", "#{pid}"], { encoding: "utf8", timeout: 5_000 }),
    );
    rows.push({ phase: generation.name, tookMs: generation.tookMs, lag: generation.lag });

    const panes = await timed("tmux list-panes -a [sync]", () =>
      execFileSync("tmux", ["list-panes", "-a", "-F", "#{session_id} #{pane_id} #{pane_pid} #{pid}"], { encoding: "utf8", timeout: 10_000 }),
    );
    rows.push({ phase: panes.name, tookMs: panes.tookMs, lag: panes.lag });

    const paneIds = [...panesBySession(panes.value).values()].map((p) => p.paneId);
    const captures = await timed("tmux capture-pane × every pane [sync]", () => {
      let ok = 0;
      for (const id of paneIds) {
        try {
          capturePane(id);
          ok += 1;
        } catch {
          /* a pane that went away is not this measurement's problem */
        }
      }
      return ok;
    });
    rows.push({ phase: captures.name, tookMs: captures.tookMs, lag: captures.lag, note: `${captures.value}/${paneIds.length} captured` });

    const executions = await timed("ps × 2 (readExecutions' probe) [sync]", () => {
      probeProcessTable();
      probeProcessTable();
    });
    rows.push({ phase: executions.name, tookMs: executions.tookMs, lag: executions.lag });

    const health = await timed("collectHealth({includeSwapActivity:true}) [sync]", () => collectHealth({ includeSwapActivity: true }));
    rows.push({ phase: health.name, tookMs: health.tookMs, lag: health.lag, note: health.value.verdict.level });

    const healthQuick = await timed("collectHealth({includeSwapActivity:false}) [sync]", () => collectHealth({ includeSwapActivity: false }));
    rows.push({ phase: healthQuick.name, tookMs: healthQuick.tookMs, lag: healthQuick.lag });

    /* **STAGE 2's AFTER, BESIDE ITS BEFORE, IN ONE RUN.** The same seven
       commands through the owned-child helper. The WALL time is expected to
       stay about the same — `vmstat 1 2` still has to wait out its sampling
       interval — and that is not the claim. The claim is the LOOP LAG column:
       the thread that answers `/api/state` should be free while it happens.

       An owner per iteration rather than one for the process, which the server
       must not do: a bench iteration that leaves a stuck child is a bench bug
       to see, not a condition to carry into the next one. */
    const { collectHealthAsync } = await import("../tools/fleet/health.js");
    const { probeOwner } = await import("../tools/fleet/child.js");
    const owner = probeOwner();
    const healthAsync = await timed("collectHealthAsync({includeSwapActivity:true}) [owned, async]", () =>
      collectHealthAsync({ owner, includeSwapActivity: true }),
    );
    rows.push({
      phase: healthAsync.name,
      tookMs: healthAsync.tookMs,
      lag: healthAsync.lag,
      note: `${healthAsync.value.verdict.level}; ${owner.live().length} children still live after`,
    });

    const whole = await timed("collect() end to end", () => collect(owner));
    rows.push({ phase: whole.name, tookMs: whole.tookMs, lag: whole.lag, note: `${whole.value.rows.length} rows` });
    // From here on the bench's own `/api/state` serves a real snapshot, so the
    // per-request cost the poller pays is the one the dashboard pays.
    live.keep(whole.value, health.value);

    /* **WHAT ONE REQUEST COSTS, SEPARATELY FROM WHAT BLOCKS IT.** The claim
       this whole plan rests on is that the *data* is already cached, so the
       only thing standing between a request and its answer is a blocked loop.
       That claim is false if `statePayload()` does real work per request — and
       it does some: `readCheckpointFeeds` reads and projects the Overseer's
       checkpoint file on every call. Measured here so the claim is checked
       rather than asserted. 200 calls, because one would measure a cold page
       cache and nothing else. */
    const payload = await timed("statePayload() × 200 — the per-request cost", () => {
      let bytes = 0;
      for (let n = 0; n < 200; n += 1) {
        bytes += composeStatePayload({
          snapshot: whole.value,
          error: null,
          health: health.value,
          refreshMs: 60_000,
          answeringEnabled: true,
          attemptedAt: new Date().toISOString(),
          readCheckpoint: readCheckpointFeeds,
        }).length;
      }
      return bytes / 200;
    });
    rows.push({
      phase: payload.name,
      tookMs: payload.tookMs,
      lag: payload.lag,
      note: `${(payload.tookMs / 200).toFixed(2)} ms each, ${(payload.value / 1024).toFixed(0)} KiB`,
    });
  }
  report(`Real box, ${runs} run(s)`, rows, await poller.stop(), await boxContext());
}

async function modeSlowProbe(probeMs: number, style: string): Promise<void> {
  const poller = await pollerAgainst(livePayload(snapshotOf(fixtureRows(25)), null).render);
  const seconds = String(Math.round(probeMs / 1000));
  const rows: Row[] = [];
  if (style === "sync") {
    const t = await timed(`execFileSync("sleep", ["${seconds}"]) — what a probe does today`, () => {
      try {
        execFileSync("sleep", [seconds], { encoding: "utf8", timeout: probeMs + 60_000 });
      } catch {
        /* the point is the block, not the result */
      }
    });
    rows.push({ phase: t.name, tookMs: t.tookMs, lag: t.lag });
  } else {
    const t = await timed(`await execFile("sleep", ["${seconds}"]) — the same probe, not on the loop`, async () => {
      try {
        await run("sleep", [seconds], { timeout: probeMs + 60_000 });
      } catch {
        /* ditto */
      }
    });
    rows.push({ phase: t.name, tookMs: t.tookMs, lag: t.lag });
  }
  report(`A ${seconds}-second probe, style=${style}`, rows, await poller.stop(), await boxContext());
}

async function modeFixture(sessions: number, probeMs: number): Promise<void> {
  const rows = fixtureRows(sessions);
  const poller = await pollerAgainst(livePayload(snapshotOf(rows), null).render);
  const out: Row[] = [];
  const { readPanes } = await import("../tools/fleet/collect.js");

  /* **THE FIXTURE ASSERTS WHAT IT EXERCISED.** A pass that skipped every row
     would report a wonderful p95 and an empty measurement — which is what the
     first version of `fixtureRows` actually did. `fixtureRows` refuses rows
     that would not be read; these counters check the other end, that the passes
     below really made N cheap probes and exactly one slow one. GPT Sol's P1. */
  let cheapProbes = 0;
  let syncSlowProbes = 0;

  /* **WHICH PASSES RUN, AND WHY THE ACCEPTANCE RUN NEEDS `--variant=owned`.**
     `both` (the default) is the before and the after in one run. But the HTTP
     poller summarises every phase together, so under `both` the synchronous
     30-second pass decides the p95 on its own and the owned pass's `/api/state`
     latency is never isolated. The stage's acceptance sentence — a 30-second
     probe must not hold `/api/state` open — is measured with `--variant=owned`,
     where the owned pass is the only thing the poller sees. */
  const variant = arg("variant", "both");
  if (variant !== "both" && variant !== "sync" && variant !== "owned") {
    throw new Error(`unknown --variant=${variant}; one of both, sync, owned`);
  }
  const seconds = String(Math.round(probeMs / 1000));

  if (variant !== "owned") {
    /* A capture that costs what a real one costs: an actual child process, not a
       busy-wait. `execFileSync("true")` is ~2–4 ms here, which is the same order
       as `tmux capture-pane`, and it is a real spawn — so the fixture measures
       spawn cost rather than a number somebody chose. */
    const fast = await timed(`readPanes over ${sessions} rows, each capture a real child [sync]`, () =>
      readPanes(rows, async () => {
        cheapProbes += 1;
        execFileSync("true", { encoding: "utf8", timeout: 5_000 });
        return "";
      }),
    );
    out.push({ phase: fast.name, tookMs: fast.tookMs, lag: fast.lag, note: `${cheapProbes} probes` });
    if (cheapProbes !== sessions) throw new Error(`the cheap pass ran ${cheapProbes} probes over ${sessions} rows — it measured something other than what it claims`);

    const before = cheapProbes;
    const slow = await timed(`readPanes over ${sessions} rows, ONE capture sleeps ${seconds}s [sync]`, () => {
      let first = true;
      return readPanes(rows, async () => {
        cheapProbes += 1;
        if (first) {
          first = false;
          syncSlowProbes += 1;
          execFileSync("sleep", [seconds], { encoding: "utf8", timeout: probeMs + 60_000 });
        }
        return "";
      });
    });
    out.push({ phase: slow.name, tookMs: slow.tookMs, lag: slow.lag, note: `${cheapProbes - before} probes, ${syncSlowProbes} of them slow` });
    if (cheapProbes - before !== sessions || syncSlowProbes !== 1) {
      throw new Error(`the synchronous slow pass ran ${cheapProbes - before} probes (${syncSlowProbes} slow) over ${sessions} rows — not the fixture it claims to be`);
    }
  }

  if (variant !== "sync") {
    /* **THE AFTER USES THE REAL OWNER.** A Promise.race around a fake capture
       would prove only that this function can race promises. The acceptance
       failure is a real `sleep 30` child, started and stopped by `owner.run`, so
       this phase exercises the same spawn, deadline, signalling and ownership
       path as production without touching a tmux pane. */
    const { probeOwner } = await import("../tools/fleet/child.js");
    const owner = probeOwner();
    let ownedProbes = 0;
    let ownedSlowProbes = 0;
    let ownedOk = 0;
    let ownedTimedOut = 0;
    /* **THE SLOW CHILD LIVES ITS WHOLE DURATION BY DEFAULT.** The first version
       of this phase killed it at 250 ms. That proves the owner *bounds* a probe —
       true, and worth keeping as `--owned-deadline-ms=250` — but it is not the
       acceptance sentence, which is that `/api/state` keeps answering WHILE a
       30-second probe is alive. A child killed at a quarter of a second never
       tests that. So the default deadline is the probe's length plus five
       seconds, the slow capture ends `ok`, and the assertions below follow
       whichever deadline was chosen. */
    const ownedDeadlineMs = Number(arg("owned-deadline-ms", String(probeMs + 5_000)));
    const slowShouldTimeOut = ownedDeadlineMs < probeMs;
    const owned = await timed(`readPanes over ${sessions} rows, ONE capture sleeps ${seconds}s [owned, async, deadline ${ownedDeadlineMs}ms]`, () => {
      let first = true;
      return readPanes(rows, async (paneId) => {
        ownedProbes += 1;
        const isSlow = first;
        first = false;
        if (isSlow) ownedSlowProbes += 1;
        const outcome = await owner.run({
          key: `capture-pane:${paneId}`,
          cmd: isSlow ? "sleep" : "true",
          args: isSlow ? [seconds] : [],
          timeoutMs: ownedDeadlineMs,
          graceMs: 100,
          maxBytes: 4 * 1024 * 1024,
        });
        if (outcome.kind === "ok") {
          ownedOk += 1;
          return outcome.stdout;
        }
        if (outcome.kind === "timed-out") ownedTimedOut += 1;
        throw new Error(outcome.why);
      });
    });
    /* Node can deliver the real child's exit event just after the owner's bounded
       result. Give that event a short turn before asserting the registry is
       empty; an owner still tracking a child immediately after timeout is doing
       its job, while one still tracking this killable `sleep` two seconds later
       means the fixture did not clean up what it started. */
    const drainDeadline = Date.now() + 2_000;
    while (owner.live().length > 0 && Date.now() < drainDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const liveAfter = owner.live().length;
    out.push({
      phase: owned.name,
      tookMs: owned.tookMs,
      lag: owned.lag,
      note:
        `${ownedProbes} probes, ${ownedSlowProbes} slow, ${ownedOk} ok, ${ownedTimedOut} timed out; ` +
        `${liveAfter} children still live after`,
    });
    const expectedOk = slowShouldTimeOut ? sessions - 1 : sessions;
    const expectedTimedOut = slowShouldTimeOut ? 1 : 0;
    if (
      ownedProbes !== sessions || ownedSlowProbes !== 1 || ownedOk !== expectedOk ||
      ownedTimedOut !== expectedTimedOut || liveAfter !== 0
    ) {
      throw new Error(
        `the owned slow pass ran ${ownedProbes} probes (${ownedSlowProbes} slow, ${ownedOk} ok, ` +
        `${ownedTimedOut} timed out, ${liveAfter} children still live) over ${sessions} rows, with a ` +
        `${ownedDeadlineMs}ms deadline against a ${probeMs}ms probe — not the fixture it claims to be`,
      );
    }
  }

  report(`Controlled fixture: ${sessions} sessions, one ${seconds}s probe`, out, await poller.stop(), [
    `${sessions} synthetic rows from fixtureRows(); no tmux session is touched`,
    ...(await boxContext()),
  ]);
}

// ---------------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

async function main(): Promise<void> {
  const mode = arg("mode", "real");
  switch (mode) {
    case "real":
      await modeReal(Number(arg("runs", "1")));
      return;
    case "slow-probe":
      await modeSlowProbe(Number(arg("probe-ms", "30000")), arg("style", "sync"));
      return;
    case "fixture":
      await modeFixture(Number(arg("sessions", "25")), Number(arg("probe-ms", "30000")));
      return;
    default:
      console.error(`unknown --mode=${mode}; one of real, slow-probe, fixture`);
      process.exitCode = 2;
  }
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith("fleet-collect-bench.ts");
if (invokedDirectly) {
  await main();
}
