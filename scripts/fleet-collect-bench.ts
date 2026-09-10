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
import { collect, panesBySession, toRows, type FleetRow, type PaneInfo } from "../tools/fleet/collect.js";
import { collectHealth } from "../tools/fleet/health.js";
import { capturePane } from "../tools/fleet/pane.js";
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
 * A server that answers `/api/state` from a cached string, and a child process
 * that asks it 40 times a second.
 *
 * THE CHILD IS PLAIN NODE, not tsx: it must start in milliseconds and must not
 * share anything with the process under measurement. It prints one number per
 * line — the milliseconds that request took — and `-1` for a request that
 * failed outright, which is a different fact from a slow one and must not be
 * averaged in with it.
 */
async function pollerAgainst(payloadBytes: number): Promise<{
  server: Server;
  stop(): Promise<{ latencies: number[]; failures: number }>;
}> {
  const payload = JSON.stringify({ pad: "x".repeat(Math.max(0, payloadBytes - 12)) });
  const server = createServer((req, res) => {
    if ((req.url ?? "/").startsWith("/api/state")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(payload);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the bench server did not bind a port");
  const url = `http://127.0.0.1:${address.port}/api/state`;

  const child = spawn(
    process.execPath,
    [
      "-e",
      `const http=require('node:http');
       const url=${JSON.stringify(url)};
       function once(){
         const t=process.hrtime.bigint();
         const req=http.get(url,{agent:false},res=>{res.resume();res.on('end',()=>{
           process.stdout.write(String(Number(process.hrtime.bigint()-t)/1e6)+"\\n");});});
         req.on('error',()=>process.stdout.write("-1\\n"));
         req.setTimeout(120000,()=>{req.destroy();});
       }
       setInterval(once,25);`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );

  const latencies: number[] = [];
  let failures = 0;
  let buffered = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      const value = Number(line);
      if (!Number.isFinite(value)) continue;
      if (value < 0) failures += 1;
      else latencies.push(value);
    }
  });

  // Let the child start and take a few samples of an idle server, so the
  // baseline in the output is this machine's, not an assumption.
  await new Promise((resolve) => setTimeout(resolve, 500));

  return {
    server,
    stop: async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return { latencies, failures };
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
 * The pane ids are `%9000…`, which tmux will refuse — every capture in fixture
 * mode goes through an injected fake rather than to tmux, and a pane id that
 * cannot exist means a bug in the wiring shows up as an error rather than as a
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

function report(title: string, rows: readonly Row[], http: { latencies: number[]; failures: number }, context: readonly string[]): void {
  console.log(`\n## ${title}\n`);
  for (const line of context) console.log(`- ${line}`);
  console.log("");
  console.log("| phase | wall | loop lag median | loop lag p95 | loop lag max |");
  console.log("|---|---|---|---|---|");
  for (const row of rows) {
    console.log(`| ${row.phase}${row.note === undefined ? "" : ` (${row.note})`} | ${ms(row.tookMs)} | ${ms(row.lag.median)} | ${ms(row.lag.p95)} | ${ms(row.lag.max)} |`);
  }
  const l = summarise(http.latencies);
  console.log("");
  console.log(`\`/api/state\` from another process, ${l.n} requests at 40/s: median ${ms(l.median)}, p95 ${ms(l.p95)}, **max ${ms(l.max)}**${http.failures > 0 ? `, ${http.failures} failed outright` : ""}`);
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
  const poller = await pollerAgainst(64 * 1024);
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

    const whole = await timed("collect() end to end", () => collect());
    rows.push({ phase: whole.name, tookMs: whole.tookMs, lag: whole.lag, note: `${whole.value.rows.length} rows` });
  }
  report(`Real box, ${runs} run(s)`, rows, await poller.stop(), await boxContext());
}

async function modeSlowProbe(probeMs: number, style: string): Promise<void> {
  const poller = await pollerAgainst(64 * 1024);
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
  const poller = await pollerAgainst(64 * 1024);
  const rows = fixtureRows(sessions);
  const out: Row[] = [];
  const { readPanes } = await import("../tools/fleet/collect.js");

  /* A capture that costs what a real one costs: an actual child process, not a
     busy-wait. `execFileSync("true")` is ~2–4 ms here, which is the same order
     as `tmux capture-pane`, and it is a real spawn — so the fixture measures
     spawn cost rather than a number somebody chose. */
  const fast = await timed(`readPanes over ${sessions} rows, each capture a real child [sync]`, () =>
    readPanes(rows, () => {
      execFileSync("true", { encoding: "utf8", timeout: 5_000 });
      return "";
    }),
  );
  out.push({ phase: fast.name, tookMs: fast.tookMs, lag: fast.lag });

  const seconds = String(Math.round(probeMs / 1000));
  const slow = await timed(`readPanes over ${sessions} rows, ONE capture sleeps ${seconds}s [sync]`, () => {
    let first = true;
    return readPanes(rows, () => {
      if (first) {
        first = false;
        try {
          execFileSync("sleep", [seconds], { encoding: "utf8", timeout: probeMs + 60_000 });
        } catch {
          /* the block is the measurement */
        }
      }
      return "";
    });
  });
  out.push({ phase: slow.name, tookMs: slow.tookMs, lag: slow.lag });

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
