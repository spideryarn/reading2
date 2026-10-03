/**
 * What one scroll costs, frame by frame — **what is painted, why, and on which thread.**
 *
 * `measure-cpu.ts` answers "how much main-thread time is script, style and
 * layout"; it cannot answer the rest, because `Performance.getMetrics` has no
 * bucket for paint, compositing, raster or hit-testing. On 2026-09-12 that rest
 * was ~40 points of a desktop core while scrolling
 * (docs/project/performance.md § "What is left, and it is not script"). This
 * takes a Chrome **trace** over a fixed scroll instead and reads it back:
 *
 *   - self time by trace-event name, per thread (renderer main, compositor,
 *     raster workers, GPU/viz) — the attribution `getMetrics` cannot give;
 *   - frames: BeginFrame / DrawFrame / BeginMainThreadFrame / Commit, and the
 *     `PipelineReporter` frame states;
 *   - **how often the paint lifecycle runs**: `Paint` events by node. Their
 *     `clip` is a *cull rect* and their `layerId` is always 0 in this Chrome, so
 *     neither is painted area (Sol review F1, 261003a); actual damage per
 *     composited layer comes from `LayerTree.layerPainted` and `paintCount`,
 *     with each layer's node and compositing reasons;
 *   - **why**: each `Paint` and style recalc classed, exclusively, by the
 *     tracked invalidations since the previous one — mixed causes are their own
 *     class — with node ids resolved through `DOM.describeNode`;
 *   - which input reaches the main thread (`EventDispatch` by type) and which
 *     listeners on window/document are not passive;
 *   - the JavaScript that ran: `FunctionCall` grouped by source location
 *     (mapped through the build's sourcemaps when `dist/` has them), timers
 *     and animation frames;
 *   - whole-process and per-thread CPU from `/proc` for the same windows,
 *     which is the only clock here that sees every thread at once.
 *
 * The page writes `console.timeStamp` marks (`trace-scroll:start`/`:end`)
 * around the gesture, and everything is clipped to them, to the renderer and
 * main thread that wrote them, and to the main frame. The `HEADLINE` line gives
 * gesture seconds, delivered px, and CPU seconds (trace main-thread busy, and
 * `/proc` for the renderer process and its main thread) — also per 1000px,
 * because the touch gesture's pacing stretches with load.
 *
 * Then 30 seconds at rest, traced and marked the same way, to show what keeps
 * running.
 *
 * ## Usage (production build — see performance.md for why)
 *
 *     npx vite build --sourcemap && npx vite preview --port 5391 --strictPort
 *     npx vite --port 5392 --strictPort      # only to sign in; see --sign-in-via
 *     npx tsx scripts/trace-scroll.ts --local-sign-in --email <owner> \
 *       --sign-in-via http://localhost:5392/ \
 *       --url "http://localhost:5391/read/<slug>?mode=summary" \
 *       --device ipad --out /tmp/x/m-ipad-summary-1
 *
 *     npx tsx scripts/trace-scroll.ts --analyze /tmp/x/m-ipad-summary-1.scroll.trace.json
 *
 * `--device desktop` (1280×800, DPR 1, mouse wheel) or `--device ipad`
 * (1194×834, DPR 2, mobile, touch emulation, iPad Safari UA, `hover: none`,
 * `pointer: coarse` — the emulation 260912a used). The gesture is **fixed** so
 * two runs are comparable, and it reverses direction three times because the
 * bars' hide/show (`data-bars`, scroll.ts) only fires on a reversal:
 *
 *   - desktop: wheel events every 60ms, 120px each: +60, −30, +60, −30 events
 *     (180 events, 21,600px, ~10.8s) — the same pacing as measure-cpu.ts;
 *   - ipad: raw `Input.dispatchTouchEvent` swipes (see `swipe`), 600px each in
 *     20 moves 16ms apart, held before lifting so nothing flings: 8 down, 4 up, 8 down,
 *     4 up (24 swipes, 14,400px). A real finger flings; this does not.
 *
 * **Headless Chrome on the box has no GPU**, so raster and compositing are in
 * software and their times are not an iPad's. Counts also depend on delivered
 * frames and input pacing: the touch runs repeated closely, but desktop wheel
 * events coalesced differently under load. Compare the delivered scroll events too.
 *
 * `--mutations` adds a page-side `MutationObserver` that counts attribute,
 * `<style>` text and class writes during the scroll, by element. It is JS in
 * the measured window, so use it in its own run, not in a timing run.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { localMagicLink } from "./seed-local-session.js";

const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith("--") ? fallback : next;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const CHROME =
  process.env.SPIDERYARN_CHROME ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/usr/bin/google-chrome-stable");

const CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.invalidationTracking",
  "disabled-by-default-devtools.timeline.stack",
  "blink",
  "blink.user_timing",
  "cc",
  "gpu",
  "viz",
  "toplevel",
  "input",
  "benchmark",
  "latencyInfo",
  "v8.execute",
];

/* ------------------------------------------------------------------ CDP --- */

type Handler = (params: Record<string, unknown>) => void;

/** measure-cpu.ts's client, plus events — tracing and LayerTree need them. */
class Cdp {
  private next = 1;
  private pending = new Map<number, { ok(v: unknown): void; fail(e: Error): void }>();
  private handlers = new Map<string, Handler[]>();
  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        result?: unknown;
        error?: { message?: string };
      };
      if (msg.id === undefined) {
        for (const h of this.handlers.get(msg.method ?? "") ?? []) h(msg.params ?? {});
        return;
      }
      const w = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (!w) return;
      if (msg.error) w.fail(new Error(`CDP: ${msg.error.message ?? "unknown"}`));
      else w.ok(msg.result);
    });
    ws.addEventListener("close", () => {
      for (const w of this.pending.values()) w.fail(new Error("CDP: connection closed"));
      this.pending.clear();
    });
  }
  static async open(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => {
      ws.addEventListener("open", () => res(), { once: true });
      ws.addEventListener("error", () => rej(new Error(`could not open ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }
  on(method: string, h: Handler): void {
    this.handlers.set(method, [...(this.handlers.get(method) ?? []), h]);
  }
  send<T = unknown>(method: string, params: object = {}): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        ok: resolve as (v: unknown) => void,
        fail: (e) => reject(new Error(`${method}: ${e.message}`)),
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval<T>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value: T }; exceptionDetails?: unknown }>(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
    );
    if (r.exceptionDetails) throw new Error(`page threw: ${JSON.stringify(r.exceptionDetails)}`);
    return r.result.value;
  }
  close(): void {
    this.ws.close();
  }
}

function assertLocalOrigin(u: string, name: string): void {
  const { hostname } = new URL(u);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new Error(`${name} points at ${u} — a session may only be carried between local origins`);
  }
}

async function readDebugPort(profile: string): Promise<number> {
  const file = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 130; i++) {
    try {
      const n = Number(readFileSync(file, "utf8").split("\n")[0]?.trim());
      if (Number.isInteger(n) && n > 0) return n;
    } catch {
      /* not yet */
    }
    await sleep(150);
  }
  throw new Error(`Chrome never wrote ${file}`);
}

/* ---------------------------------------------------------------- /proc --- */

const CLK = 100; // USER_HZ; 100 on every Linux this runs on

interface ProcSnap {
  /** pid → {label, ticks}; threads of the renderer(s) keyed `pid/tid`. */
  procs: Map<string, { label: string; ticks: number }>;
}

function statTicks(path: string): number {
  try {
    const s = readFileSync(path, "utf8");
    const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
    return Number(f[11]) + Number(f[12]); // utime + stime (fields 14, 15)
  } catch {
    return 0;
  }
}

function descendants(root: number): number[] {
  const kids = new Map<number, number[]>();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const s = readFileSync(`/proc/${d}/stat`, "utf8");
      const ppid = Number(s.slice(s.lastIndexOf(")") + 2).split(" ")[1]);
      kids.set(ppid, [...(kids.get(ppid) ?? []), Number(d)]);
    } catch {
      /* gone */
    }
  }
  const out: number[] = [];
  const walk = (p: number) => {
    out.push(p);
    for (const k of kids.get(p) ?? []) walk(k);
  };
  walk(root);
  return out;
}

function procSnap(root: number): ProcSnap {
  const procs = new Map<string, { label: string; ticks: number }>();
  for (const pid of descendants(root)) {
    let cmd = "";
    try {
      cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    } catch {
      continue;
    }
    const type = /--type=([\w-]+)/.exec(cmd)?.[1] ?? "browser";
    if (!cmd.includes("chrome")) continue;
    procs.set(String(pid), { label: type, ticks: statTicks(`/proc/${pid}/stat`) });
    if (type === "renderer" || type === "gpu-process") {
      try {
        for (const tid of readdirSync(`/proc/${pid}/task`)) {
          let comm = "?";
          try {
            comm = readFileSync(`/proc/${pid}/task/${tid}/comm`, "utf8").trim();
          } catch {
            /* gone */
          }
          procs.set(`${pid}/${tid}`, {
            label: `${type}:${comm}`,
            ticks: statTicks(`/proc/${pid}/task/${tid}/stat`),
          });
        }
      } catch {
        /* gone */
      }
    }
  }
  return { procs };
}

/** % of one core by process type, and by renderer/GPU thread name. */
function procDiff(a: ProcSnap, b: ProcSnap, seconds: number) {
  const byType: Record<string, number> = {};
  const byThread: Record<string, number> = {};
  for (const [k, v] of b.procs) {
    const before = a.procs.get(k)?.ticks ?? 0;
    const pct = ((v.ticks - before) / CLK / seconds) * 100;
    if (k.includes("/")) byThread[v.label] = (byThread[v.label] ?? 0) + pct;
    else byType[v.label] = (byType[v.label] ?? 0) + pct;
  }
  const round = (o: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(o)
        .filter(([, v]) => v >= 0.05)
        .sort((x, y) => y[1] - x[1])
        .map(([k, v]) => [k, Number(v.toFixed(1))]),
    );
  return { byType: round(byType), byThread: round(byThread) };
}

/** CPU seconds in the window: the target renderer process (all threads), its
 *  main thread (tid == pid), and the GPU process. Not a %, so it can be divided
 *  by distance scrolled. */
function procSeconds(a: ProcSnap, b: ProcSnap, rendererPid: number) {
  const d = (k: string) => ((b.procs.get(k)?.ticks ?? 0) - (a.procs.get(k)?.ticks ?? 0)) / CLK;
  let gpu = 0;
  for (const [k, v] of b.procs) if (!k.includes("/") && v.label === "gpu-process") gpu += d(k);
  const r = (n: number) => Number(n.toFixed(2));
  return { process: r(d(String(rendererPid))), main: r(d(`${rendererPid}/${rendererPid}`)), gpu: r(gpu) };
}

/* --------------------------------------------------------------- trace --- */

interface TraceEvent {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  id?: string | number;
  id2?: { local?: string; global?: string };
  args?: Record<string, any>;
}

async function startTrace(cdp: Cdp): Promise<void> {
  await cdp.send("Tracing.start", {
    transferMode: "ReturnAsStream",
    traceConfig: { recordMode: "recordAsMuchAsPossible", includedCategories: CATEGORIES },
  });
}

async function stopTrace(cdp: Cdp, file: string): Promise<void> {
  const done = new Promise<string>((res) =>
    cdp.on("Tracing.tracingComplete", (p) => res(String(p.stream))),
  );
  await cdp.send("Tracing.end");
  const stream = await done;
  const parts: string[] = [];
  for (;;) {
    const r = await cdp.send<{ data: string; eof: boolean; base64Encoded?: boolean }>("IO.read", {
      handle: stream,
      size: 4 << 20,
    });
    parts.push(r.base64Encoded ? Buffer.from(r.data, "base64").toString("utf8") : r.data);
    if (r.eof) break;
  }
  await cdp.send("IO.close", { handle: stream });
  writeFileSync(file, parts.join(""));
}

function loadTrace(file: string): TraceEvent[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { traceEvents?: TraceEvent[] } | TraceEvent[];
  return Array.isArray(raw) ? raw : (raw.traceEvents ?? []);
}

function quadArea(q: number[] | undefined): number {
  if (!q || q.length < 8) return 0;
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const x1 = q[2 * i]!,
      y1 = q[2 * i + 1]!,
      x2 = q[(2 * i + 2) % 8]!,
      y2 = q[(2 * i + 3) % 8]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

interface Interval {
  e: TraceEvent;
  start: number;
  end: number;
  self: number;
  depth: number;
  top: number; // index of top-level ancestor
  parent: number; // index of the direct parent, -1 at top level
}

/** Self time per event, per thread, from X events and B/E pairs. */
function intervals(events: TraceEvent[]): Map<string, Interval[]> {
  const byThread = new Map<string, Interval[]>();
  const open = new Map<string, TraceEvent[]>();
  for (const e of events) {
    const key = `${e.pid}:${e.tid}`;
    if (e.ph === "X" && typeof e.dur === "number") {
      const list = byThread.get(key) ?? [];
      list.push({ e, start: e.ts, end: e.ts + e.dur, self: e.dur, depth: 0, top: -1, parent: -1 });
      byThread.set(key, list);
    } else if (e.ph === "B") {
      open.set(key, [...(open.get(key) ?? []), e]);
    } else if (e.ph === "E") {
      const st = open.get(key);
      const b = st?.pop();
      if (b) {
        const list = byThread.get(key) ?? [];
        list.push({ e: b, start: b.ts, end: e.ts, self: e.ts - b.ts, depth: 0, top: -1, parent: -1 });
        byThread.set(key, list);
      }
    }
  }
  for (const list of byThread.values()) {
    list.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    const stack: number[] = [];
    list.forEach((iv, i) => {
      while (stack.length && list[stack[stack.length - 1]!]!.end <= iv.start) stack.pop();
      const parent = stack.length ? list[stack[stack.length - 1]!]! : null;
      if (parent) {
        const overlap = Math.min(iv.end, parent.end) - iv.start;
        parent.self -= Math.max(0, overlap);
        iv.depth = parent.depth + 1;
        iv.top = parent.top;
        iv.parent = stack[stack.length - 1]!;
      } else {
        iv.top = i;
      }
      stack.push(i);
    });
    for (const iv of list) if (iv.self < 0) iv.self = 0;
  }
  return byThread;
}

/** The page writes these with `console.timeStamp` (and `performance.mark`)
 *  immediately before and after the gesture, so the analysis has the gesture's
 *  own boundaries — not the trace's, which async frame events stretch by tens of
 *  seconds (Sol review F2, 261003a). */
const MARK = { start: "trace-scroll:start", end: "trace-scroll:end" } as const;

interface MeasureWindow {
  start: number; // trace µs
  end: number;
  /** "marks" when both were found; otherwise the whole trace, and say so. */
  source: "marks" | "whole trace (no marks found)";
}

/** One cause class: the tracked invalidations since the previous event of the
 *  same kind. `causes` is the full set, so a mixed class is visible as one. */
export interface CauseRow {
  causes: string; // "inline style", "inline style + other: attr aria-current", "none", …
  mixed: boolean;
  count: number;
  ms: number;
  elements: number;
  /** backend node id → invalidations on it, for the style-type invalidations. */
  nodes: [number, number][];
}

export interface Analysis {
  window: MeasureWindow & { ms: number };
  rendererPid: number;
  frame: string;
  mainBusyMs: number;
  threads: Record<string, { busyMs: number; topSelf: [string, number, number][] }>;
  frames: Record<string, number>;
  frameStates: Record<string, number>;
  /** `Paint` trace events on the renderer main thread, main frame. Their
   *  `clip` is a CULL RECT, not painted or rasterised area, and `layerId` is
   *  always 0 in this Chrome (F1) — so neither is reported as "painted area". */
  paint: {
    events: number;
    tasksWithPaint: number;
    cullRectViewportsPerTaskMedian: number;
    byNode: [number, number][]; // nodeId, Paint events
  };
  raster: { tasks: number; ms: number; imageDecodes: number };
  /** `StyleEngine::scheduleInvalidationsForRuleSets` on the main thread — one
   *  per stylesheet text swap (OnScreenLinksStyle's `<style>`). */
  styleSwaps: { count: number; ms: number };
  styleByCause: CauseRow[];
  paintByCause: CauseRow[];
  /** Paints whose preceding invalidations include an inline-style write:
   *  only that (exclusive) or with something else (mixed). */
  inlinePaints: { exclusive: number; mixed: number };
  /** HitTest by what asked for it: [caller, count, ms]. */
  hitTestByCaller: [string, number, number][];
  invalidations: { byKind: Record<string, number>; top: [string, number][]; nodeIds: number[] };
  eventDispatch: [string, number, number][];
  /** `scroll` events dispatched to the page in the window. */
  scrollEventsDispatched: number;
  functionCalls: [string, number, number][];
  timers: { installs: [string, number][]; fires: number; animationFrames: number; rafRequests: number };
  scrollEvents: [string, number][];
  mainThreadScrollHints: string[];
}

const markName = (e: TraceEvent): string | null => {
  if (e.name === "TimeStamp") {
    const m = e.args?.data?.message;
    return typeof m === "string" ? m : null;
  }
  return e.cat.includes("user_timing") ? e.name : null;
};

/** The frame an event belongs to, when it says. */
const frameOf = (e: TraceEvent): string | undefined =>
  e.args?.data?.frame ?? e.args?.beginData?.frame ?? undefined;

function analyze(events: TraceEvent[], viewportArea: number): Analysis {
  const threadNames = new Map<string, string>();
  for (const e of events) {
    if (e.ph === "M" && e.name === "thread_name") {
      threadNames.set(`${e.pid}:${e.tid}`, String(e.args?.name ?? "?"));
    }
  }

  /* The renderer, its main thread and the main frame are the ones that wrote
     the start mark. Without marks (an old trace), fall back to the browser's
     own record of the outermost main frame, then to the busiest renderer. */
  const timeStamps = events.filter((e) => e.ph !== "M" && markName(e) !== null);
  const startMark = timeStamps.find((e) => markName(e) === MARK.start && e.name === "TimeStamp") ??
    timeStamps.find((e) => markName(e) === MARK.start);
  const endMark = [...timeStamps].reverse().find((e) => markName(e) === MARK.end && e.name === "TimeStamp") ??
    [...timeStamps].reverse().find((e) => markName(e) === MARK.end);
  let mainKey = "";
  let frame = "";
  if (startMark && startMark.name === "TimeStamp") {
    mainKey = `${startMark.pid}:${startMark.tid}`;
    frame = String(frameOf(startMark) ?? "");
  }
  if (!mainKey) {
    const started = events.find((e) => e.name === "TracingStartedInBrowser");
    const outer = (started?.args?.data?.frames ?? []).filter(
      (f: { isOutermostMainFrame?: boolean; url?: string }) => f.isOutermostMainFrame && /^https?:/.test(f.url ?? ""),
    );
    const f = outer[0] as { frame?: string; processId?: number } | undefined;
    if (f?.processId) {
      const k = [...threadNames].find(([key, n]) => n === "CrRendererMain" && key.startsWith(`${f.processId}:`));
      if (k) mainKey = k[0];
      frame = String(f.frame ?? "");
    }
  }
  if (!mainKey) {
    const mains = [...threadNames].filter(([, n]) => n === "CrRendererMain").map(([k]) => k);
    const count = new Map<string, number>();
    for (const e of events) {
      const k = `${e.pid}:${e.tid}`;
      if (mains.includes(k)) count.set(k, (count.get(k) ?? 0) + 1);
    }
    mainKey = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }
  const rendererPid = Number(mainKey.split(":")[0]);
  const inFrame = (e: TraceEvent): boolean => {
    if (!frame) return true;
    const f = frameOf(e);
    return f === undefined || f === frame;
  };

  let win: MeasureWindow;
  if (startMark && endMark && endMark.ts > startMark.ts) {
    win = { start: startMark.ts, end: endMark.ts, source: "marks" };
  } else {
    let t0 = Infinity,
      t1 = -Infinity;
    for (const e of events) {
      if (e.ph === "M" || !(e.ts > 0)) continue;
      if (e.ts < t0) t0 = e.ts;
      if (e.ts + (e.dur ?? 0) > t1) t1 = e.ts + (e.dur ?? 0);
    }
    win = { start: t0, end: t1, source: "whole trace (no marks found)" };
  }
  const inWin = (ts: number) => ts >= win.start && ts <= win.end;
  const overlap = (a: number, b: number) => Math.max(0, Math.min(b, win.end) - Math.max(a, win.start));

  const ivs = intervals(events);
  const threads: Analysis["threads"] = {};
  for (const [key, list] of ivs) {
    const pid = Number(key.split(":")[0]);
    const tname = threadNames.get(key) ?? "?";
    const label = (pid === rendererPid ? "renderer:" : `pid${pid}:`) + tname.replace(/\d+$/, "");
    threads[label] ??= { busyMs: 0, topSelf: [] };
    const t = threads[label];
    const self = new Map<string, [number, number]>();
    for (const iv of list) {
      if (iv.depth === 0) t.busyMs += overlap(iv.start, iv.end) / 1000;
      if (!inWin(iv.start)) continue;
      const s = self.get(iv.e.name) ?? [0, 0];
      s[0] += iv.self / 1000;
      s[1] += 1;
      self.set(iv.e.name, s);
    }
    const merged = new Map(t.topSelf.map(([n, ms, c]) => [n, [ms, c] as [number, number]]));
    for (const [n, [ms, c]] of self) {
      const m = merged.get(n) ?? [0, 0];
      merged.set(n, [m[0] + ms, m[1] + c]);
    }
    t.topSelf = [...merged]
      .map(([n, [ms, c]]) => [n, Number(ms.toFixed(1)), c] as [string, number, number])
      .sort((a, b) => b[1] - a[1]);
  }
  for (const t of Object.values(threads)) {
    t.busyMs = Number(t.busyMs.toFixed(1));
    t.topSelf = t.topSelf.slice(0, 30);
  }
  const main = (ivs.get(mainKey) ?? []);
  let mainBusy = 0;
  for (const iv of main) if (iv.depth === 0) mainBusy += overlap(iv.start, iv.end);

  /* Everything below is clipped to the window, and — except the viz/GPU frame
     counters — to the target renderer. */
  const w = events.filter((e) => e.ph !== "M" && inWin(e.ts));
  const frames: Record<string, number> = {};
  for (const n of [
    "BeginFrame",
    "DrawFrame",
    "BeginMainThreadFrame",
    "Commit",
    "ActivateLayerTree",
    "DroppedFrame",
    "NeedsBeginFrameChanged",
    "FireAnimationFrame",
    "UpdateLayoutTree",
    "Layout",
    "PrePaint",
    "Paint",
    "Layerize",
    "UpdateLayer",
    "ScrollLayer",
    "HitTest",
  ]) {
    frames[n] = w.filter(
      (e) => e.name === n && e.ph !== "E" && e.ph !== "e" && (e.pid === rendererPid || n === "DrawFrame" || n === "BeginFrame"),
    ).length;
  }
  const frameStates: Record<string, number> = {};
  for (const e of w) {
    if (e.name === "PipelineReporter" && (e.ph === "b" || e.ph === "X")) {
      const st = String(e.args?.chrome_frame_reporter?.state ?? "?");
      frameStates[st] = (frameStates[st] ?? 0) + 1;
    }
  }

  const paintByTop = new Map<number, number>();
  const byNode = new Map<number, number>();
  let paintEvents = 0;
  for (const iv of main) {
    if (iv.e.name !== "Paint" || !inWin(iv.start) || !inFrame(iv.e)) continue;
    paintEvents++;
    const d = iv.e.args?.data ?? {};
    paintByTop.set(iv.top, (paintByTop.get(iv.top) ?? 0) + quadArea(d.clip as number[] | undefined));
    const nk = Number(d.nodeId ?? 0);
    byNode.set(nk, (byNode.get(nk) ?? 0) + 1);
  }
  const perTask = [...paintByTop.values()].map((a) => a / viewportArea).sort((a, b) => a - b);

  let rasterTasks = 0,
    rasterMs = 0,
    imageDecodes = 0;
  for (const e of w) {
    if (e.pid !== rendererPid) continue;
    if (e.name === "RasterTask" && e.ph === "X") {
      rasterTasks++;
      rasterMs += (e.dur ?? 0) / 1000;
    }
    if ((e.name === "Decode Image" || e.name === "ImageDecodeTask") && e.ph === "X") imageDecodes++;
  }

  let swaps = 0,
    swapMs = 0;
  for (const iv of main) {
    if (iv.e.name === "StyleEngine::scheduleInvalidationsForRuleSets" && inWin(iv.start)) {
      swaps++;
      swapMs += (iv.end - iv.start) / 1000;
    }
  }

  const inv = new Map<string, number>();
  const invKinds: Record<string, number> = {};
  const invNodes = new Map<number, number>();
  for (const e of w) {
    if (!e.name.endsWith("InvalidationTracking") || e.pid !== rendererPid || !inFrame(e)) continue;
    invKinds[e.name] = (invKinds[e.name] ?? 0) + 1;
    const d = e.args?.data ?? {};
    const reason = d.reason ?? d.invalidationList?.[0]?.classes ?? d.changedClass ?? d.changedAttribute ?? d.changedPseudo ?? "";
    const key = `${e.name.replace("InvalidationTracking", "")} | ${String(d.nodeName ?? "?").slice(0, 90)} | ${typeof reason === "string" ? reason : JSON.stringify(reason).slice(0, 80)}`;
    inv.set(key, (inv.get(key) ?? 0) + 1);
    if (typeof d.nodeId === "number") invNodes.set(d.nodeId, (invNodes.get(d.nodeId) ?? 0) + 1);
  }

  const ed = new Map<string, [number, number]>();
  const fc = new Map<string, [number, number]>();
  const installs = new Map<string, number>();
  let fires = 0,
    afs = 0,
    rafReq = 0;
  for (const iv of main) {
    if (!inWin(iv.start)) continue;
    const d = iv.e.args?.data ?? {};
    if (iv.e.name === "EventDispatch") {
      const k = String(d.type);
      const v = ed.get(k) ?? [0, 0];
      ed.set(k, [v[0] + 1, v[1] + (iv.end - iv.start) / 1000]);
    }
    if (iv.e.name === "FunctionCall") {
      const k = `${d.functionName || "(anon)"} @ ${String(d.url ?? "").replace(/^https?:\/\/[^/]+/, "")}:${d.lineNumber}:${d.columnNumber}`;
      const v = fc.get(k) ?? [0, 0];
      fc.set(k, [v[0] + 1, v[1] + (iv.end - iv.start) / 1000]);
    }
    if (iv.e.name === "TimerFire") fires++;
    if (iv.e.name === "FireAnimationFrame") afs++;
  }
  for (const e of w) {
    if (e.pid !== rendererPid) continue;
    const d = e.args?.data ?? {};
    if (e.name === "TimerInstall") {
      const top = d.stackTrace?.[0];
      const k = `${d.singleShot ? "once" : "repeat"} ${d.timeout}ms ${top ? `${top.functionName || "(anon)"} @ ${String(top.url).replace(/^https?:\/\/[^/]+/, "")}:${top.lineNumber}:${top.columnNumber}` : ""}`;
      installs.set(k, (installs.get(k) ?? 0) + 1);
    }
    if (e.name === "RequestAnimationFrame") rafReq++;
  }

  const scroll = new Map<string, number>();
  const hints = new Set<string>();
  for (const e of w) {
    if (/scroll/i.test(e.name) && e.ph !== "E") {
      const k = `${e.name} [${threadNames.get(`${e.pid}:${e.tid}`) ?? "?"}]`;
      scroll.set(k, (scroll.get(k) ?? 0) + 1);
    }
    const s = e.args ? JSON.stringify(e.args) : "";
    const m = s.match(/"(main_thread_scrolling_reasons|main_thread_scroll_reasons|mainThreadScrollingReasons|scroll_on_main|[a-z_]*main_thread[a-z_]*)":("[^"]*"|[^,}\]]*)/gi);
    if (m) for (const x of m) hints.add(`${e.name}: ${x}`.slice(0, 160));
  }

  const top = <K>(m: Map<K, [number, number]>, n: number) =>
    [...m]
      .map(([k, [c, ms]]) => [k, c, Number(ms.toFixed(1))] as [K, number, number])
      .sort((a, b) => b[2] - a[2] || b[1] - a[1])
      .slice(0, n);

  const mainEvents = events.filter((e) => `${e.pid}:${e.tid}` === mainKey && e.ph !== "M");
  const paintByCause = byCause(mainEvents, "Paint", inWin, inFrame);
  const inlinePaints = { exclusive: 0, mixed: 0 };
  for (const r of paintByCause) {
    if (!r.causes.split(" + ").includes("inline style")) continue;
    if (r.mixed) inlinePaints.mixed += r.count;
    else inlinePaints.exclusive += r.count;
  }

  return {
    window: { ...win, ms: Number(((win.end - win.start) / 1000).toFixed(0)) },
    rendererPid,
    frame,
    mainBusyMs: Number((mainBusy / 1000).toFixed(1)),
    threads,
    frames,
    frameStates,
    paint: {
      events: paintEvents,
      tasksWithPaint: paintByTop.size,
      cullRectViewportsPerTaskMedian: Number((perTask[Math.floor(perTask.length / 2)] ?? 0).toFixed(2)),
      byNode: [...byNode].sort((a, b) => b[1] - a[1]).slice(0, 12),
    },
    raster: { tasks: rasterTasks, ms: Number(rasterMs.toFixed(1)), imageDecodes },
    styleSwaps: { count: swaps, ms: Number(swapMs.toFixed(1)) },
    styleByCause: byCause(mainEvents, "UpdateLayoutTree", inWin, inFrame),
    paintByCause,
    inlinePaints,
    hitTestByCaller: (() => {
      const m = new Map<string, [number, number]>();
      main.forEach((iv) => {
        if (iv.e.name !== "HitTest" || !inWin(iv.start)) return;
        let k = "script or other";
        for (let p = iv.parent; p >= 0; p = main[p]!.parent) {
          const n = main[p]!.e.name;
          if (n === "WidgetBaseInputHandler::OnHandleInputEvent") { k = "input event targeting"; break; }
          if (/AdDetector/.test(n)) { k = "Chrome ad heuristics (headless artefact?)"; break; }
          if (n === "FunctionCall" || n === "FireAnimationFrame") { k = "script (elementFromPoint etc.)"; break; }
        }
        const v = m.get(k) ?? [0, 0];
        m.set(k, [v[0] + 1, v[1] + (iv.end - iv.start) / 1000]);
      });
      return [...m].map(([k, [c, ms]]) => [k, c, Number(ms.toFixed(1))] as [string, number, number]);
    })(),
    invalidations: {
      byKind: invKinds,
      top: [...inv].sort((a, b) => b[1] - a[1]).slice(0, 30),
      nodeIds: [...invNodes].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k]) => k),
    },
    eventDispatch: top(ed, 20),
    scrollEventsDispatched: ed.get("scroll")?.[0] ?? 0,
    functionCalls: top(fc, 30),
    timers: {
      installs: [...installs].sort((a, b) => b[1] - a[1]).slice(0, 15),
      fires,
      animationFrames: afs,
      rafRequests: rafReq,
    },
    scrollEvents: [...scroll].sort((a, b) => b[1] - a[1]).slice(0, 30),
    mainThreadScrollHints: [...hints].slice(0, 30),
  };
}

/* Map minified `url:line:col` through dist/*.map, when the build has them. */
async function sourceMapper(): Promise<(s: string) => string> {
  const dir = "dist/assets";
  if (!existsSync(dir)) return (s) => s;
  let TraceMap: any, originalPositionFor: any;
  try {
    ({ TraceMap, originalPositionFor } = await import("@jridgewell/trace-mapping"));
  } catch {
    return (s) => s;
  }
  const cache = new Map<string, any>();
  return (s: string) =>
    s.replace(/\/assets\/([\w.-]+\.js):(\d+):(\d+)/g, (all, file: string, line: string, col: string) => {
      const p = join(dir, `${file}.map`);
      if (!existsSync(p)) return all;
      let m = cache.get(p);
      if (!m) {
        m = new TraceMap(readFileSync(p, "utf8"));
        cache.set(p, m);
      }
      /* The trace's lineNumber/columnNumber are 1-based; try both column bases
         and keep whichever resolves. */
      for (const c of [Number(col) - 1, Number(col)]) {
        const o = originalPositionFor(m, { line: Number(line), column: Math.max(0, c) });
        if (o.source) {
          return `${String(o.source).replace(/^.*?(src\/|node_modules\/)/, "$1")}:${o.line}${o.name ? ` (${o.name})` : ""}`;
        }
      }
      return all;
    });
}

function printAnalysis(label: string, a: Analysis, map: (s: string) => string, nodes: Record<number, string> = {}): void {
  const out: string[] = [];
  const p = (s: string) => out.push(s);
  const nodeList = (ns: [number, number][]) =>
    ns.map(([id, c]) => `${nodes[id] ?? `node${id}`}×${c}`).join(", ");
  p(
    `\n=== ${label}: ${a.window.ms}ms window (${a.window.source}), renderer pid ${a.rendererPid}, ` +
      `main frame ${a.frame || "?"}; renderer main thread busy ${a.mainBusyMs}ms`,
  );
  p(`frames: ${JSON.stringify(a.frames)}`);
  p(`frame states: ${JSON.stringify(a.frameStates)}`);
  p(
    `paint: ${a.paint.events} Paint events in ${a.paint.tasksWithPaint} main-thread tasks ` +
      `(cull rects, median ${a.paint.cullRectViewportsPerTaskMedian} viewports per task — a cull rect is ` +
      `what Paint may walk, NOT what was repainted or rasterised; see LayerTree below for damage)`,
  );
  p(`  Paint events by node: ${nodeList(a.paint.byNode)}`);
  p(`raster: ${a.raster.tasks} RasterTasks, ${a.raster.ms}ms; ${a.raster.imageDecodes} image decodes`);
  p(`stylesheet swaps (StyleEngine::scheduleInvalidationsForRuleSets): ${a.styleSwaps.count}, ${a.styleSwaps.ms}ms`);
  p(
    `paints temporally associated with inline-style invalidations: ${a.inlinePaints.exclusive} exclusive, ` +
      `${a.inlinePaints.mixed} mixed with another cause`,
  );
  const causes = (title: string, rows: CauseRow[]) => {
    p(`${title} (classes are exclusive; "a + b" is a mixed class — tracked invalidations only):`);
    for (const r of rows) {
      p(`  ${r.count.toString().padStart(5)}× ${r.ms.toFixed(1).padStart(8)}ms ${String(r.elements).padStart(7)} el  ${r.causes}${r.mixed ? "  [MIXED]" : ""}`);
      if (r.nodes.length) p(`        nodes: ${nodeList(r.nodes)}`);
    }
  };
  causes("style recalcs by cause", a.styleByCause);
  causes("paints by cause", a.paintByCause);
  p(`HitTest by caller (caller, count, ms): ${JSON.stringify(a.hitTestByCaller)}`);
  for (const [name, t] of Object.entries(a.threads).sort((x, y) => y[1].busyMs - x[1].busyMs)) {
    if (t.busyMs < 20) continue;
    p(`thread ${name}: busy ${t.busyMs}ms (${((t.busyMs / Math.max(1, a.window.ms)) * 100).toFixed(1)}% of window)`);
    for (const [n, ms, c] of t.topSelf.slice(0, name.endsWith("CrRendererMain") ? 30 : 10)) {
      if (ms < 1) continue;
      p(`    ${ms.toFixed(1).padStart(8)}ms self  ${String(c).padStart(6)}×  ${n}`);
    }
  }
  p(`invalidations: ${JSON.stringify(a.invalidations.byKind)}`);
  for (const [k, c] of a.invalidations.top) p(`  ${String(c).padStart(6)}  ${k}`);
  p(`EventDispatch (type, count, ms): ${JSON.stringify(a.eventDispatch)}`);
  p("FunctionCall (count, inclusive ms):");
  for (const [k, c, ms] of a.functionCalls) p(`  ${String(c).padStart(6)}× ${ms.toFixed(1).padStart(8)}ms  ${map(k)}`);
  p(`timers: fired ${a.timers.fires}, rAF fired ${a.timers.animationFrames}, rAF requested ${a.timers.rafRequests}`);
  for (const [k, c] of a.timers.installs) p(`  install ${String(c).padStart(4)}× ${map(k)}`);
  p("scroll-named events:");
  for (const [k, c] of a.scrollEvents) p(`  ${String(c).padStart(6)}  ${k}`);
  p(`main-thread scroll hints: ${a.mainThreadScrollHints.length ? "" : "none found in args"}`);
  for (const h of a.mainThreadScrollHints) p(`  ${h}`);
  console.log(out.join("\n"));
}

/* -------------------------------------------------------------- gestures --- */

/**
 * Class each `UpdateLayoutTree` (or `Paint`) on the target renderer's main
 * thread by the style-type invalidation-tracking events, in the main frame,
 * since the previous one of its kind. The classes are **exclusive**: the full
 * set of causes is the key, so "inline style + other: …" is its own, mixed,
 * row and never counted as inline-only (Sol review F3). Causes:
 *
 *   - `data-bars flip`: the bars' attribute on <html>;
 *   - `:has()`: a `:has()` re-match (on <html>/.reader in practice);
 *   - `inline style`: an inline style declaration mutated (the spine's
 *     per-frame `top`, React's style props) — the nodes say whose;
 *   - `other: …`: any other root cause, named (`attr aria-current`, …).
 *
 * See `invalidationCause` for which events are consequences rather than
 * causes. Layout invalidations are consequences too; a set of only those is
 * `layout invalidation only`. This is temporal association with tracked
 * invalidations, not proof that nothing else caused the paint.
 */
/**
 * The root cause one style invalidation-tracking event records, or null when
 * it is a consequence of another event already counted: a
 * `StyleInvalidatorInvalidationTracking` (an invalidation set being applied)
 * or a recalc for a "Related style rule" both follow a
 * `ScheduleStyleInvalidationTracking`, which names what changed. Counting the
 * consequences as "other" made nearly every frame look mixed.
 */
function invalidationCause(name: string, d: Record<string, any>): string | null {
  if (name === "StyleInvalidatorInvalidationTracking") return null;
  if (name === "ScheduleStyleInvalidationTracking") {
    if (d.changedAttribute === "data-bars") return "data-bars flip";
    if (d.changedPseudo === "has") return ":has()";
    if (d.changedAttribute) return `other: attr ${d.changedAttribute}`;
    if (d.changedClass) return "other: class change";
    if (d.changedId) return "other: id change";
    if (d.changedPseudo) return `other: :${d.changedPseudo}`;
    return "other: scheduled";
  }
  if (name === "StyleRecalcInvalidationTracking") {
    if (d.reason === "Related style rule") return null;
    if (d.reason === "Affected by :has()") return ":has()";
    if (d.reason === "Inline CSS style declaration was mutated") return "inline style";
    return `other: ${String(d.reason ?? "recalc")}`;
  }
  return `other: ${name.replace("InvalidationTracking", "")}`;
}

function byCause(
  mainEvents: TraceEvent[],
  target: string,
  inWin: (ts: number) => boolean,
  inFrame: (e: TraceEvent) => boolean,
): CauseRow[] {
  const ev = mainEvents.filter((e) => e.ts > 0).sort((a, b) => a.ts - b.ts);
  const cls = new Map<string, { count: number; ms: number; el: number; mixed: boolean; nodes: Map<number, number> }>();
  let prev = 0;
  let j = 0;
  for (const e of ev) {
    if (e.name !== target || typeof e.dur !== "number") continue;
    const causes = new Set<string>();
    let layout = false;
    const nodes = new Map<number, number>();
    for (; j < ev.length && ev[j]!.ts <= e.ts; j++) {
      const x = ev[j]!;
      if (x.ts < prev || !x.name.endsWith("InvalidationTracking") || !inFrame(x)) continue;
      const d = x.args?.data ?? {};
      if (x.name === "LayoutInvalidationTracking") {
        layout = true;
        continue;
      }
      const c = invalidationCause(x.name, d);
      if (!c) continue;
      causes.add(c);
      if (typeof d.nodeId === "number") nodes.set(d.nodeId, (nodes.get(d.nodeId) ?? 0) + 1);
    }
    prev = e.ts + e.dur;
    if (!inWin(e.ts) || !inFrame(e)) continue;
    const k = causes.size ? [...causes].sort().join(" + ") : layout ? "layout invalidation only" : "no tracked invalidation";
    const v = cls.get(k) ?? { count: 0, ms: 0, el: 0, mixed: causes.size > 1, nodes: new Map<number, number>() };
    v.count++;
    v.ms += e.dur / 1000;
    v.el += Number(e.args?.elementCount ?? 0);
    for (const [n, c] of nodes) v.nodes.set(n, (v.nodes.get(n) ?? 0) + c);
    cls.set(k, v);
  }
  return [...cls]
    .map(([causes, v]) => ({
      causes,
      mixed: v.mixed,
      count: v.count,
      ms: Number(v.ms.toFixed(1)),
      elements: v.el,
      nodes: [...v.nodes].sort((a, b) => b[1] - a[1]).slice(0, 6),
    }))
    .sort((a, b) => b.ms - a.ms);
}

const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";

async function emulate(cdp: Cdp, device: string): Promise<{ w: number; h: number; dpr: number }> {
  if (device === "ipad") {
    const m = { w: 1194, h: 834, dpr: 2 };
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: m.w,
      height: m.h,
      deviceScaleFactor: m.dpr,
      mobile: true,
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: IPAD_UA, platform: "iPad" });
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "hover", value: "none" },
        { name: "pointer", value: "coarse" },
        { name: "any-hover", value: "none" },
        { name: "any-pointer", value: "coarse" },
      ],
    });
    return m;
  }
  const m = { w: 1280, h: 800, dpr: 1 };
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: m.w,
    height: m.h,
    deviceScaleFactor: m.dpr,
    mobile: false,
  });
  return m;
}

interface GestureStats {
  kind: string;
  events: number;
  requestedPx: number;
  movedPx: number;
  reversals: number;
  wallMs: number;
  /** What the gesture lands on — a band or panel over the prose scrolls itself, not the page. */
  target: string;
}

async function targetAt(cdp: Cdp, x: number, y: number): Promise<string> {
  return cdp.eval<string>(`(() => { const el = document.elementFromPoint(${x}, ${y}); if (!el) return 'nothing';
    const path = []; for (let n = el; n && n !== document.body && path.length < 5; n = n.parentElement)
      path.push(n.localName + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''));
    return path.join(' < '); })()`);
}

/** Where the gesture goes across the page: `--gesture-x` as a fraction of the width. */
const GX = (w: number): number => Math.round(w * Number(flag("gesture-x", "0.55")));

async function scrollY(cdp: Cdp): Promise<number> {
  return cdp.eval<number>("window.scrollY");
}

type Mark = (name: string) => Promise<unknown>;

/* Both gestures write MARK.start immediately before their first input and
   MARK.end after the last scroll position is read; the analysis is clipped to
   those. Pacing is unchanged from the first runs (so touch still waits for each
   CDP acknowledgement and stretches under load — compare per 1000px, F2). */

async function wheelGesture(cdp: Cdp, w: number, h: number, mark: Mark): Promise<GestureStats> {
  const STEP = 60;
  const target = await targetAt(cdp, GX(w), Math.round(h * 0.5));
  const segments = [60, -30, 60, -30];
  let i = 0;
  let moved = 0;
  let last = await scrollY(cdp);
  await mark(MARK.start);
  const start = Date.now();
  const inFlight: Promise<unknown>[] = [];
  for (const seg of segments) {
    const dy = seg > 0 ? 120 : -120;
    for (let k = 0; k < Math.abs(seg); k++) {
      inFlight.push(
        cdp.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: GX(w),
          y: Math.round(h * 0.5),
          deltaX: 0,
          deltaY: dy,
          pointerType: "mouse",
        }),
      );
      i++;
      const wait = start + i * STEP - Date.now();
      if (wait > 0) await sleep(wait);
    }
    await sleep(150);
    const y = await scrollY(cdp);
    moved += Math.abs(y - last);
    last = y;
  }
  await Promise.all(inFlight);
  const wallMs = Date.now() - start;
  await mark(MARK.end);
  return {
    kind: "wheel 120px/60ms",
    events: i,
    requestedPx: i * 120,
    movedPx: Math.round(moved),
    reversals: segments.length - 1,
    wallMs,
    target,
  };
}

/**
 * One finger swipe of `dy` CSS px (negative = finger moves up = page scrolls
 * down), as raw touch events: 20 moves 16ms apart (~1200px/s for 600px), then a
 * pause before lifting so the browser sees no velocity and does not fling.
 *
 * Raw `Input.dispatchTouchEvent` rather than `Input.synthesizeScrollGesture`,
 * because the latter **does not scroll the page** under headless + mobile
 * emulation on this box: 24 swipes, `window.scrollY` unchanged, while the trace
 * filled with frames — a scroll measurement of a page standing still. The
 * browser turns these touches into GestureScroll* itself, which is the iPad's
 * own path (touch → gesture → compositor scroll).
 */
async function swipe(cdp: Cdp, x: number, y0: number, dy: number): Promise<void> {
  const STEPS = 20;
  const pt = (y: number) => [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(y0) });
  for (let i = 1; i <= STEPS; i++) {
    await sleep(16);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(y0 + (dy * i) / STEPS) });
  }
  await sleep(120);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(60);
}

async function touchGesture(cdp: Cdp, w: number, h: number, mark: Mark): Promise<GestureStats> {
  const segments = [8, -4, 8, -4];
  const target = await targetAt(cdp, GX(w), Math.round(h * 0.5));
  let n = 0;
  let moved = 0;
  let last = await scrollY(cdp);
  await mark(MARK.start);
  const start = Date.now();
  for (const seg of segments) {
    for (let k = 0; k < Math.abs(seg); k++) {
      await swipe(cdp, GX(w), Math.round(h * 0.5), seg > 0 ? -600 : 600);
      n++;
    }
    const y = await scrollY(cdp);
    moved += Math.abs(y - last);
    last = y;
  }
  const wallMs = Date.now() - start;
  await mark(MARK.end);
  return {
    kind: "touch swipe 600px in 20 moves x 16ms, held before lift (no fling)",
    events: n,
    requestedPx: n * 600,
    movedPx: Math.round(moved),
    reversals: segments.length - 1,
    wallMs,
    target,
  };
}

/* -------------------------------------------------------------- layers --- */

interface LayerInfo {
  layerId: string;
  parentLayerId?: string;
  backendNodeId?: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  paintCount?: number;
  drawsContent: boolean;
  invisible?: boolean;
}

/** Backend node ids of the first element matching each selector. */
async function backendIds(cdp: Cdp, selectors: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  const doc = await cdp.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: 0 });
  for (const sel of selectors) {
    try {
      const q = await cdp.send<{ nodeId: number }>("DOM.querySelector", { nodeId: doc.root.nodeId, selector: sel });
      if (!q.nodeId) {
        out[sel] = null;
        continue;
      }
      const d = await cdp.send<{ node: { backendNodeId: number } }>("DOM.describeNode", { nodeId: q.nodeId });
      out[sel] = d.node.backendNodeId;
    } catch {
      out[sel] = null;
    }
  }
  return out;
}

function printLayers(
  on: boolean,
  events: number,
  before: Map<string, number>,
  after: LayerInfo[],
  damage: Map<string, { paints: number; area: number }>,
  reasons: Map<string, string[]>,
  nodes: Record<number, string>,
  spineIds: Record<string, number | null>,
  viewportArea: number,
): void {
  if (!on || !events) {
    console.log(`composited layers (LayerTree): ${on ? "enabled, but no layerTreeDidChange event" : "LayerTree.enable refused"}`);
    return;
  }
  const painted = [...damage.values()].reduce((n, d) => n + d.paints, 0);
  console.log(
    `composited layers (LayerTree): ${after.length}. Per layer during the gesture: paintCount delta (how many ` +
      `times Chrome repainted that layer's content), and layerPainted events with their summed damage rects in ` +
      `viewports${painted ? "" : " — this Chrome emitted NO layerPainted events, so there is no damage area; paintCount is the evidence"}:`,
  );
  const byNode = new Map(after.filter((l) => l.backendNodeId).map((l) => [l.backendNodeId!, l]));
  for (const l of after) {
    const dmg = damage.get(l.layerId);
    console.log(
      `  layer ${l.layerId.padEnd(5)} parent ${String(l.parentLayerId ?? "-").padEnd(5)} ` +
        `${(l.backendNodeId ? (nodes[l.backendNodeId] ?? `node${l.backendNodeId}`) : "(no node)").padEnd(34)} ` +
        `${Math.round(l.width)}x${Math.round(l.height)}${l.drawsContent ? "" : " no-content"}  ` +
        `paints Δ${(l.paintCount ?? 0) - (before.get(l.layerId) ?? 0)}, layerPainted ${dmg?.paints ?? 0} ` +
        `(${((dmg?.area ?? 0) / viewportArea).toFixed(1)} vp)  reasons ${JSON.stringify(reasons.get(l.layerId) ?? [])}`,
    );
  }
  for (const [sel, id] of Object.entries(spineIds)) {
    const own = id ? byNode.get(id) : undefined;
    console.log(
      `  ${sel}: ${id === null ? "not in the page" : own ? `OWN LAYER ${own.layerId}` : "no layer of its own (painted into an ancestor's)"}`,
    );
  }
}

/* ------------------------------------------------------------------ main --- */

async function describeNodes(cdp: Cdp, ids: number[]): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  await cdp.send("DOM.getDocument", { depth: 0 });
  for (const id of ids) {
    if (!id) continue;
    try {
      const r = await cdp.send<{ node: { localName: string; nodeName: string; attributes?: string[] } }>(
        "DOM.describeNode",
        { backendNodeId: id },
      );
      const a = r.node.attributes ?? [];
      const attr = (n: string) => {
        const i = a.indexOf(n);
        return i >= 0 ? a[i + 1] : undefined;
      };
      const cls = attr("class");
      const idv = attr("id");
      out[id] = `${r.node.localName || r.node.nodeName}${idv ? `#${idv}` : ""}${cls ? `.${cls.trim().split(/\s+/).slice(0, 4).join(".")}` : ""}${attr("data-block") ? `[data-block]` : ""}`;
    } catch {
      out[id] = "(gone)";
    }
  }
  return out;
}

async function main(): Promise<void> {
  if (has("analyze")) {
    const file = flag("analyze", "");
    const a = analyze(loadTrace(file), Number(flag("viewport-area", String(1280 * 800))));
    printAnalysis(file, a, await sourceMapper());
    return;
  }
  const url = flag("url", "");
  if (!url) throw new Error("--url is required");
  const device = flag("device", "desktop");
  const settle = Number(flag("settle", "20"));
  const restSeconds = Number(flag("rest", "30"));
  const out = flag("out", join(tmpdir(), `trace-scroll-${device}-${Date.now()}`));
  const via = flag("sign-in-via", "");
  const link = has("local-sign-in") ? await localMagicLink(via || url) : null;
  const profile = mkdtempSync(join(tmpdir(), "spya-trace-"));

  let chrome: ChildProcess | null = null;
  let cdp: Cdp | null = null;
  try {
    chrome = spawn(
      CHROME,
      [
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1400,1000",
        link ? new URL(via || url).origin : "about:blank",
      ],
      { stdio: "ignore" },
    );
    const port = await readDebugPort(profile);
    let page: { webSocketDebuggerUrl?: string; type: string } | undefined;
    for (let i = 0; i < 50 && !page; i++) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
          type: string;
          webSocketDebuggerUrl?: string;
        }[];
        page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      } catch {
        /* not yet */
      }
      if (!page) await sleep(200);
    }
    if (!page?.webSocketDebuggerUrl) throw new Error("no page target");
    cdp = await Cdp.open(page.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    if (link) {
      await sleep(3000);
      const said = await cdp.eval<string>(`(async () => {
        try {
          const m = await import('/src/web/lib/supabase.ts');
          const r = await m.supabase.auth.verifyOtp({ type: 'magiclink', token_hash: ${JSON.stringify(link.hashedToken)} });
          if (r.error) return 'error: ' + r.error.message;
          return r.data.session ? 'ok:' + (r.data.user?.email ?? '?') : 'no session';
        } catch (e) { return 'threw: ' + (e && e.message); }
      })()`);
      if (!said.startsWith("ok:")) throw new Error(`local sign-in failed — ${said}`);
      console.log(`signed in locally (${said.slice(3)})`);
      const target = new URL(url).origin;
      if (via && target !== new URL(via).origin) {
        assertLocalOrigin(via, "--sign-in-via");
        assertLocalOrigin(url, "--url");
        const carried = JSON.parse(
          await cdp.eval<string>(`JSON.stringify(Object.fromEntries(Object.entries(localStorage)
            .filter(([k]) => k.startsWith('sb-') || k === 'spideryarn.lastUser')))`),
        ) as Record<string, string>;
        if (!Object.keys(carried).length) throw new Error("nothing to carry");
        await cdp.send("Page.navigate", { url: `${target}/favicon.ico` });
        for (let i = 0; i < 75; i++) {
          if ((await cdp.eval<string>("location.origin")) === target) break;
          await sleep(200);
        }
        await cdp.send("Runtime.evaluate", {
          expression: `(() => { const s = ${JSON.stringify(JSON.stringify(carried))};
            for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); })()`,
        });
        console.log(`carried ${Object.keys(carried).length} storage keys to ${target}`);
      }
    }

    const vp = await emulate(cdp, device);
    await cdp.send("Page.navigate", { url });
    console.log(`device ${device} ${vp.w}x${vp.h}@${vp.dpr}; settling ${settle}s…`);
    await sleep(settle * 1000);

    const state = await cdp.eval<{ rows: number; nodes: number; h: number; text: string; bars: string | null }>(`(() => {
      const t = document.querySelector('table.zoom');
      return { rows: t ? t.querySelectorAll('tr[data-block]').length : 0,
        nodes: document.querySelectorAll('*').length,
        h: document.documentElement.scrollHeight,
        text: (document.body.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 70),
        bars: document.documentElement.dataset.bars ?? null };
    })()`);
    console.log(`page: ${state.rows} rows, ${state.nodes} nodes, ${state.h}px tall — "${state.text}"`);
    if (state.rows === 0) throw new Error("no article rows on screen — NOT a reading-view measurement");
    const build = await cdp.eval<string>(
      `[...document.scripts].map(s => s.src).filter(Boolean).map(s => s.split('/').pop()).join(',')`,
    );
    console.log(`bundle: ${build}`);

    /* Non-passive input listeners on the scroller's ancestors: these are what
       make the compositor wait for the main thread. */
    const scriptUrls = new Map<string, string>();
    cdp.on("Debugger.scriptParsed", (p) => scriptUrls.set(String(p.scriptId), String(p.url)));
    await cdp.send("Debugger.enable");
    await sleep(500);
    const map0 = await sourceMapper();
    const listeners: string[] = [];
    for (const expr of ["window", "document", "document.documentElement", "document.body"]) {
      const obj = await cdp.send<{ result: { objectId: string } }>("Runtime.evaluate", { expression: expr });
      const r = await cdp.send<{ listeners: { type: string; passive: boolean; useCapture: boolean; scriptId: string; lineNumber: number; columnNumber: number }[] }>(
        "DOMDebugger.getEventListeners",
        { objectId: obj.result.objectId },
      );
      for (const l of r.listeners) {
        if (/^(wheel|mousewheel|touchstart|touchmove|touchend|scroll|pointermove|pointerdown|resize)$/.test(l.type)) {
          listeners.push(`${expr} ${l.type}${l.passive ? " passive" : " NOT-passive"}${l.useCapture ? " capture" : ""} ${map0(`${(scriptUrls.get(l.scriptId) ?? `script${l.scriptId}`).replace(/^https?:\/\/[^/]+/, "")}:${l.lineNumber + 1}:${l.columnNumber + 1}`)}`);
        }
      }
    }
    await cdp.send("Debugger.disable");
    console.log(`scroll/touch/wheel listeners on window/document/html/body:\n  ${listeners.join("\n  ") || "(none)"}`);

    /* A diagnostic, not a fix: inject CSS after the page has settled, to see
       what a rule would remove (e.g. `.spine{display:none}`). Says so loudly,
       because a run with this is not a measurement of the product. */
    const inject = flag("inject-css", "");
    if (inject) {
      await cdp.eval(`(() => { const s = document.createElement('style'); s.dataset.traceScroll = '1';
        s.textContent = ${JSON.stringify(inject)}; document.head.appendChild(s); })()`);
      console.log(
        `⚠ DIAGNOSTIC: injected CSS ${JSON.stringify(inject)} — not the product. Hiding with CSS removes ` +
          `layout and paint, but the components stay mounted and their scroll handlers still run (F7)`,
      );
      await sleep(1000);
    }

    if (has("mutations")) {
      await cdp.eval(`(() => {
        const label = (n) => n.nodeType !== 1 ? n.nodeName : n.localName + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\\s+/).slice(0,3).join('.') : '');
        const c = window.__mut = {};
        const add = (k) => { c[k] = (c[k] || 0) + 1; };
        new MutationObserver((recs) => { for (const r of recs) {
          if (r.type === 'attributes') add('attr ' + r.attributeName + ' on ' + label(r.target));
          else if (r.type === 'characterData') add('text in ' + label(r.target.parentNode || r.target));
          else add('childList on ' + label(r.target) + ' +' + r.addedNodes.length + '/-' + r.removedNodes.length);
        } }).observe(document, { subtree: true, attributes: true, characterData: true, childList: true });
      })()`);
    }

    /* LayerTree: which elements are composited layers, why, and how often each
       is actually painted (`layerPainted` carries the damage rect, unlike the
       trace's `Paint`, whose clip is a cull rect and whose layerId is 0 — F1). */
    let layerList: LayerInfo[] = [];
    let layerEvents = 0;
    let counting = false;
    const damage = new Map<string, { paints: number; area: number }>();
    cdp.on("LayerTree.layerTreeDidChange", (p) => {
      const l = p.layers as LayerInfo[] | undefined;
      if (l) {
        layerList = l;
        layerEvents++;
      }
    });
    cdp.on("LayerTree.layerPainted", (p) => {
      if (!counting) return;
      const id = String(p.layerId);
      const c = p.clip as { width?: number; height?: number } | undefined;
      const v = damage.get(id) ?? { paints: 0, area: 0 };
      v.paints++;
      v.area += (c?.width ?? 0) * (c?.height ?? 0);
      damage.set(id, v);
    });
    const layerTreeOn = await cdp.send("LayerTree.enable").then(
      () => true,
      () => false,
    );
    await sleep(500);
    const spineIds = await backendIds(cdp, [".spine", ".spine-viewport", ".mode-band", ".spine-here"]);

    const root = chrome.pid ?? 0;
    const area = vp.w * vp.h; // CSS px²; Paint cull rects are compared against this
    const mark = (name: string) =>
      cdp!.eval(`(() => { console.timeStamp(${JSON.stringify(name)}); performance.mark(${JSON.stringify(name)}); return 0; })()`);

    // ---- scroll window: everything is clipped to the two marks
    await startTrace(cdp);
    await sleep(300);
    const layersBefore = new Map(layerList.map((l) => [l.layerId, l.paintCount ?? 0]));
    const p0 = procSnap(root);
    counting = true;
    const g = device === "ipad" ? await touchGesture(cdp, vp.w, vp.h, mark) : await wheelGesture(cdp, vp.w, vp.h, mark);
    counting = false;
    const p1 = procSnap(root);
    const layersAfter = layerList;
    await sleep(300);
    const scrollFile = `${out}.scroll.trace.json`;
    await stopTrace(cdp, scrollFile);
    const scrollCpu = procDiff(p0, p1, g.wallMs / 1000);
    const mut = has("mutations")
      ? await cdp.eval<[string, number][]>("Object.entries(window.__mut || {}).sort((a,b)=>b[1]-a[1]).slice(0,40)")
      : [];
    const reasons = new Map<string, string[]>();
    for (const l of layersAfter) {
      const r = await cdp
        .send<{ compositingReasons?: string[]; compositingReasonIds?: string[] }>("LayerTree.compositingReasons", { layerId: l.layerId })
        .catch(() => ({}) as { compositingReasons?: string[]; compositingReasonIds?: string[] });
      reasons.set(l.layerId, r.compositingReasonIds ?? r.compositingReasons ?? []);
    }

    // ---- rest window
    await sleep(2000);
    if (has("mutations")) await cdp.eval("(() => { for (const k in window.__mut) delete window.__mut[k]; })()");
    await startTrace(cdp);
    await sleep(300);
    const r0 = procSnap(root);
    await mark(MARK.start);
    await sleep(restSeconds * 1000);
    await mark(MARK.end);
    const r1 = procSnap(root);
    await sleep(300);
    const restFile = `${out}.rest.trace.json`;
    await stopTrace(cdp, restFile);
    const restCpu = procDiff(r0, r1, restSeconds);
    const restMut = has("mutations")
      ? await cdp.eval<[string, number][]>("Object.entries(window.__mut || {}).sort((a,b)=>b[1]-a[1]).slice(0,20)")
      : [];
    const anims = await cdp.eval<number>("document.getAnimations().filter(a => a.playState === 'running').length");

    const map = await sourceMapper();
    const sa = analyze(loadTrace(scrollFile), area);
    const ra = analyze(loadTrace(restFile), area);
    const causeNodes = (a: Analysis) => [...a.styleByCause, ...a.paintByCause].flatMap((r) => r.nodes.map(([id]) => id));
    const nodeIds = [
      ...new Set([
        ...sa.invalidations.nodeIds,
        ...sa.paint.byNode.map(([id]) => id),
        ...ra.paint.byNode.map(([id]) => id),
        ...causeNodes(sa),
        ...causeNodes(ra),
        ...layersAfter.map((l) => l.backendNodeId ?? 0),
      ]),
    ];
    const nodes = await describeNodes(cdp, nodeIds);

    /* The headline numbers, normalised by distance so runs whose pacing the
       box's load changed still compare (F2). */
    const px = Math.max(1, g.movedPx);
    const cpu = procSeconds(p0, p1, sa.rendererPid);
    const traceGestureS = sa.window.ms / 1000;
    const head = {
      gestureS: Number((g.wallMs / 1000).toFixed(2)),
      gestureSFromMarks: Number(traceGestureS.toFixed(2)),
      windowSource: sa.window.source,
      deliveredPx: g.movedPx,
      scrollEventsDispatched: sa.scrollEventsDispatched,
      mainBusyS: Number((sa.mainBusyMs / 1000).toFixed(2)),
      procRendererS: cpu.process,
      procRendererMainS: cpu.main,
      procGpuS: cpu.gpu,
      per1000px: {
        mainBusyS: Number(((sa.mainBusyMs / 1000 / px) * 1000).toFixed(3)),
        procRendererS: Number(((cpu.process / px) * 1000).toFixed(3)),
        procRendererMainS: Number(((cpu.main / px) * 1000).toFixed(3)),
      },
      paints: sa.paint.events,
      inlinePaintsExclusive: sa.inlinePaints.exclusive,
      inlinePaintsMixed: sa.inlinePaints.mixed,
      rasterTasks: sa.raster.tasks,
      styleRecalcs: sa.frames.UpdateLayoutTree,
      styleSwaps: sa.styleSwaps.count,
    };

    console.log(`\ngesture: ${JSON.stringify(g)}`);
    console.log(`HEADLINE: ${JSON.stringify(head)}`);
    console.log(
      `  gesture ${head.gestureS}s (marks ${head.gestureSFromMarks}s), ${head.deliveredPx}px delivered, ${head.scrollEventsDispatched} scroll events; ` +
        `CPU: main-thread busy ${head.mainBusyS}s, /proc renderer ${head.procRendererS}s (main thread ${head.procRendererMainS}s); ` +
        `per 1000px: busy ${head.per1000px.mainBusyS}s, /proc renderer ${head.per1000px.procRendererS}s, /proc main ${head.per1000px.procRendererMainS}s`,
    );
    printLayers(layerTreeOn, layerEvents, layersBefore, layersAfter, damage, reasons, nodes, spineIds, area);
    console.log(`/proc CPU during scroll, % of one core: ${JSON.stringify(scrollCpu)}`);
    console.log(`/proc CPU at rest (${restSeconds}s): ${JSON.stringify(restCpu)}`);
    console.log(`running animations after rest: ${anims}`);
    console.log(`nodes: ${JSON.stringify(nodes)}`);
    if (has("mutations")) {
      console.log("mutations during scroll:");
      for (const [k, c] of mut) console.log(`  ${String(c).padStart(6)}  ${k}`);
      console.log("mutations at rest:");
      for (const [k, c] of restMut) console.log(`  ${String(c).padStart(6)}  ${k}`);
    }
    printAnalysis("SCROLL", sa, map, nodes);
    printAnalysis("REST", ra, map, nodes);
    writeFileSync(
      `${out}.summary.json`,
      JSON.stringify(
        {
          url, device, viewport: vp, page: state, bundle: build, listeners, gesture: g, headline: head,
          layers: layersAfter.map((l) => ({ ...l, node: nodes[l.backendNodeId ?? 0], reasons: reasons.get(l.layerId), damage: damage.get(l.layerId), paintCountDelta: (l.paintCount ?? 0) - (layersBefore.get(l.layerId) ?? 0) })),
          spineIds, scrollCpu, restCpu, anims, nodes, mutations: mut, restMutations: restMut, scroll: sa, rest: ra,
        },
        null,
        1,
      ),
    );
    console.log(`\nwrote ${scrollFile}, ${restFile}, ${out}.summary.json`);
  } finally {
    cdp?.close();
    chrome?.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
