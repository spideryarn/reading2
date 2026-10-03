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
 *   - **what is painted**: every `Paint` event's clip area, summed per
 *     main-thread frame and compared with the viewport, by layer and node;
 *   - **why**: `*InvalidationTracking` events grouped by node and reason, with
 *     node ids resolved through `DOM.describeNode` while the page is still up;
 *   - which input reaches the main thread (`EventDispatch` by type) and which
 *     listeners on window/document are not passive;
 *   - the JavaScript that ran: `FunctionCall` grouped by source location
 *     (mapped through the build's sourcemaps when `dist/` has them), timers
 *     and animation frames;
 *   - whole-process and per-thread CPU from `/proc` for the same windows,
 *     which is the only clock here that sees every thread at once.
 *
 * Then 30 seconds at rest, traced the same way, to show what keeps running.
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
 * software and their times are not an iPad's. The counts — frames, paints,
 * painted area, invalidations, raster tasks — do not depend on that, or on load.
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

export interface Analysis {
  windowMs: number;
  rendererPid: number;
  threads: Record<string, { busyMs: number; topSelf: [string, number, number][] }>;
  frames: Record<string, number>;
  frameStates: Record<string, number>;
  paint: {
    events: number;
    framesWithPaint: number;
    areaPerPaintFrameMedian: number;
    areaPerPaintFrameP90: number;
    areaTotal: number;
    byLayer: [string, number, number][];
    byNode: [number, number, number][];
  };
  raster: { tasks: number; ms: number; imageDecodes: number };
  /** Style recalcs and paints, each classed by the invalidations recorded since
   *  the previous one of its kind: [class, count, ms, elements]. */
  styleByCause: [string, number, number, number][];
  paintByCause: [string, number, number, number][];
  /** HitTest by what asked for it: [caller, count, ms]. */
  hitTestByCaller: [string, number, number][];
  invalidations: { byKind: Record<string, number>; top: [string, number][]; nodeIds: number[] };
  eventDispatch: [string, number, number][];
  functionCalls: [string, number, number][];
  timers: { installs: [string, number][]; fires: number; animationFrames: number; rafRequests: number };
  scrollEvents: [string, number][];
  mainThreadScrollHints: string[];
}

function analyze(events: TraceEvent[], viewportArea: number): Analysis {
  const threadNames = new Map<string, string>();
  for (const e of events) {
    if (e.ph === "M" && e.name === "thread_name") {
      threadNames.set(`${e.pid}:${e.tid}`, String(e.args?.name ?? "?"));
    }
  }
  /* The renderer is the process whose main thread ran the most tasks — under
     site isolation with one tab there is exactly one with our origin. */
  const mains = [...threadNames].filter(([, n]) => n === "CrRendererMain").map(([k]) => k);
  const count = new Map<string, number>();
  for (const e of events) {
    const k = `${e.pid}:${e.tid}`;
    if (mains.includes(k)) count.set(k, (count.get(k) ?? 0) + 1);
  }
  const mainKey = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const rendererPid = Number(mainKey.split(":")[0]);

  const timed = events.filter((e) => e.ph !== "M" && e.ts > 0);
  let t0 = Infinity,
    t1 = -Infinity;
  for (const e of timed) {
    if (e.ts < t0) t0 = e.ts;
    if (e.ts + (e.dur ?? 0) > t1) t1 = e.ts + (e.dur ?? 0);
  }

  const ivs = intervals(events);
  const threads: Analysis["threads"] = {};
  for (const [key, list] of ivs) {
    const pid = Number(key.split(":")[0]);
    const tname = threadNames.get(key) ?? "?";
    const label = (pid === rendererPid ? "renderer:" : `pid${pid}:`) + tname.replace(/\d+$/, "");
    const t = (threads[label] ??= { busyMs: 0, topSelf: [] });
    const self = new Map<string, [number, number]>();
    for (const iv of list) {
      if (iv.depth === 0) t.busyMs += (iv.end - iv.start) / 1000;
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
    frames[n] = events.filter(
      (e) => e.name === n && e.ph !== "E" && e.ph !== "e" && (e.pid === rendererPid || n === "DrawFrame" || n === "BeginFrame"),
    ).length;
  }
  const frameStates: Record<string, number> = {};
  for (const e of events) {
    if (e.name === "PipelineReporter" && (e.ph === "b" || e.ph === "X")) {
      const st = String(e.args?.chrome_frame_reporter?.state ?? "?");
      frameStates[st] = (frameStates[st] ?? 0) + 1;
    }
  }

  // Paint: area per main-thread top-level task (≈ one frame's paint).
  const main = ivs.get(mainKey) ?? [];
  const paintByTop = new Map<number, number>();
  const byLayer = new Map<string, [number, number]>();
  const byNode = new Map<number, [number, number]>();
  let paintEvents = 0;
  let areaTotal = 0;
  for (const iv of main) {
    if (iv.e.name !== "Paint") continue;
    paintEvents++;
    const d = iv.e.args?.data ?? {};
    const a = quadArea(d.clip as number[] | undefined);
    areaTotal += a;
    paintByTop.set(iv.top, (paintByTop.get(iv.top) ?? 0) + a);
    const lk = String(d.layerId ?? "?");
    const l = byLayer.get(lk) ?? [0, 0];
    byLayer.set(lk, [l[0] + 1, l[1] + a]);
    const nk = Number(d.nodeId ?? 0);
    const n = byNode.get(nk) ?? [0, 0];
    byNode.set(nk, [n[0] + 1, n[1] + a]);
  }
  const perFrame = [...paintByTop.values()].map((a) => a / viewportArea).sort((a, b) => a - b);
  const q = (p: number) => perFrame[Math.min(perFrame.length - 1, Math.floor(p * perFrame.length))] ?? 0;

  let rasterTasks = 0,
    rasterMs = 0,
    imageDecodes = 0;
  for (const e of events) {
    if (e.name === "RasterTask" && e.ph === "X") {
      rasterTasks++;
      rasterMs += (e.dur ?? 0) / 1000;
    }
    if ((e.name === "Decode Image" || e.name === "ImageDecodeTask") && e.ph === "X") imageDecodes++;
  }

  const inv = new Map<string, number>();
  const invKinds: Record<string, number> = {};
  const invNodes = new Map<number, number>();
  for (const e of events) {
    if (!e.name.endsWith("InvalidationTracking")) continue;
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
  for (const e of events) {
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
  for (const e of events) {
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

  return {
    windowMs: Number(((t1 - t0) / 1000).toFixed(0)),
    rendererPid,
    threads,
    frames,
    frameStates,
    paint: {
      events: paintEvents,
      framesWithPaint: paintByTop.size,
      areaPerPaintFrameMedian: Number(q(0.5).toFixed(3)),
      areaPerPaintFrameP90: Number(q(0.9).toFixed(3)),
      areaTotal: Math.round(areaTotal),
      byLayer: [...byLayer]
        .map(([k, [c, a]]) => [k, c, Number((a / viewportArea).toFixed(2))] as [string, number, number])
        .sort((a, b) => b[2] - a[2])
        .slice(0, 12),
      byNode: [...byNode]
        .map(([k, [c, a]]) => [k, c, Number((a / viewportArea).toFixed(2))] as [number, number, number])
        .sort((a, b) => b[2] - a[2])
        .slice(0, 12),
    },
    raster: { tasks: rasterTasks, ms: Number(rasterMs.toFixed(1)), imageDecodes },
    styleByCause: byCause(events, "UpdateLayoutTree"),
    paintByCause: byCause(events, "Paint"),
    hitTestByCaller: (() => {
      const m = new Map<string, [number, number]>();
      main.forEach((iv) => {
        if (iv.e.name !== "HitTest") return;
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
      if (!m) cache.set(p, (m = new TraceMap(readFileSync(p, "utf8"))));
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

function printAnalysis(label: string, a: Analysis, map: (s: string) => string): void {
  const out: string[] = [];
  const p = (s: string) => out.push(s);
  p(`\n=== ${label}: ${a.windowMs}ms traced, renderer pid ${a.rendererPid}`);
  p(`frames: ${JSON.stringify(a.frames)}`);
  p(`frame states: ${JSON.stringify(a.frameStates)}`);
  p(
    `paint: ${a.paint.events} Paint events in ${a.paint.framesWithPaint} main-thread tasks; ` +
      `area per painting task / viewport: median ${a.paint.areaPerPaintFrameMedian}, p90 ${a.paint.areaPerPaintFrameP90}; ` +
      `total ${(a.paint.areaTotal).toLocaleString()} px²`,
  );
  p(`  by layer (layerId, paints, viewports): ${JSON.stringify(a.paint.byLayer)}`);
  p(`  by node (nodeId, paints, viewports): ${JSON.stringify(a.paint.byNode)}`);
  p(`raster: ${a.raster.tasks} RasterTasks, ${a.raster.ms}ms; ${a.raster.imageDecodes} image decodes`);
  p("style recalcs by cause (cause, count, ms, elements):");
  for (const r of a.styleByCause) p(`  ${JSON.stringify(r)}`);
  p("paints by cause (cause, count, ms):");
  for (const r of a.paintByCause) p(`  ${JSON.stringify(r.slice(0, 3))}`);
  p(`HitTest by caller (caller, count, ms): ${JSON.stringify(a.hitTestByCaller)}`);
  for (const [name, t] of Object.entries(a.threads).sort((x, y) => y[1].busyMs - x[1].busyMs)) {
    if (t.busyMs < 20) continue;
    p(`thread ${name}: busy ${t.busyMs}ms (${((t.busyMs / a.windowMs) * 100).toFixed(1)}% of window)`);
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
 * Class each `UpdateLayoutTree` (or `Paint`) by the invalidation-tracking events
 * since the previous one: the bars' `data-bars` flip on <html>; a `:has()`
 * re-match on <html>/.reader; inline-style writes only (the spine's per-frame
 * `top`, and React's style props); anything else. First match wins, in that
 * order, so a frame with a flip is a flip whatever else it had.
 */
function byCause(events: TraceEvent[], target: string): [string, number, number, number][] {
  const ev = events.filter((e) => e.ph !== "M" && e.ts > 0).sort((a, b) => a.ts - b.ts);
  const cls = new Map<string, [number, number, number]>();
  let prev = 0;
  let j = 0;
  for (const e of ev) {
    if (e.name !== target || typeof e.dur !== "number") continue;
    let bars = false,
      hasM = false,
      inline = false,
      other = false;
    for (; j < ev.length && ev[j]!.ts <= e.ts; j++) {
      const x = ev[j]!;
      if (x.ts < prev || !x.name.endsWith("InvalidationTracking")) continue;
      const d = x.args?.data ?? {};
      if (d.changedAttribute === "data-bars") bars = true;
      else if (d.reason === "Affected by :has()") hasM = true;
      else if (d.reason === "Inline CSS style declaration was mutated") inline = true;
      else if (x.name !== "LayoutInvalidationTracking") other = true;
    }
    const k = bars
      ? "data-bars flip"
      : hasM
        ? ":has() re-match on html/.reader"
        : inline
          ? "inline style writes only"
          : other
            ? "other invalidation"
            : "no tracked invalidation";
    const v = cls.get(k) ?? [0, 0, 0];
    cls.set(k, [v[0] + 1, v[1] + e.dur / 1000, v[2] + Number(e.args?.elementCount ?? 0)]);
    prev = e.ts + e.dur;
  }
  return [...cls]
    .map(([k, [c, ms, el]]) => [k, c, Number(ms.toFixed(1)), el] as [string, number, number, number])
    .sort((a, b) => b[2] - a[2]);
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

async function wheelGesture(cdp: Cdp, w: number, h: number): Promise<GestureStats> {
  const STEP = 60;
  const target = await targetAt(cdp, GX(w), Math.round(h * 0.5));
  const segments = [60, -30, 60, -30];
  const start = Date.now();
  let i = 0;
  let moved = 0;
  let last = await scrollY(cdp);
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
  return {
    kind: "wheel 120px/60ms",
    events: i,
    requestedPx: i * 120,
    movedPx: Math.round(moved),
    reversals: segments.length - 1,
    wallMs: Date.now() - start,
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

async function touchGesture(cdp: Cdp, w: number, h: number): Promise<GestureStats> {
  const segments = [8, -4, 8, -4];
  const target = await targetAt(cdp, GX(w), Math.round(h * 0.5));
  const start = Date.now();
  let n = 0;
  let moved = 0;
  let last = await scrollY(cdp);
  for (const seg of segments) {
    for (let k = 0; k < Math.abs(seg); k++) {
      await swipe(cdp, GX(w), Math.round(h * 0.5), seg > 0 ? -600 : 600);
      n++;
    }
    const y = await scrollY(cdp);
    moved += Math.abs(y - last);
    last = y;
  }
  return {
    kind: "touch swipe 600px in 20 moves x 16ms, held before lift (no fling)",
    events: n,
    requestedPx: n * 600,
    movedPx: Math.round(moved),
    reversals: segments.length - 1,
    wallMs: Date.now() - start,
    target,
  };
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
      console.log(`⚠ DIAGNOSTIC: injected CSS ${JSON.stringify(inject)} — not the product`);
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

    // LayerTree, if headless will give it.
    let layers = -1;
    cdp.on("LayerTree.layerTreeDidChange", (p) => {
      const l = p.layers as unknown[] | undefined;
      if (l) layers = l.length;
    });
    await cdp.send("LayerTree.enable").catch(() => {});

    const root = chrome.pid ?? 0;
    const area = vp.w * vp.h; // CSS px²; Paint clips are compared against this

    // ---- scroll window
    await startTrace(cdp);
    await sleep(300);
    const p0 = procSnap(root);
    const g = device === "ipad" ? await touchGesture(cdp, vp.w, vp.h) : await wheelGesture(cdp, vp.w, vp.h);
    const p1 = procSnap(root);
    await sleep(300);
    const scrollFile = `${out}.scroll.trace.json`;
    await stopTrace(cdp, scrollFile);
    const scrollCpu = procDiff(p0, p1, g.wallMs / 1000);
    const mut = has("mutations")
      ? await cdp.eval<[string, number][]>("Object.entries(window.__mut || {}).sort((a,b)=>b[1]-a[1]).slice(0,40)")
      : [];

    // ---- rest window
    await sleep(2000);
    if (has("mutations")) await cdp.eval("(() => { for (const k in window.__mut) delete window.__mut[k]; })()");
    await startTrace(cdp);
    const r0 = procSnap(root);
    await sleep(restSeconds * 1000);
    const r1 = procSnap(root);
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
    const nodeIds = [
      ...new Set([...sa.invalidations.nodeIds, ...sa.paint.byNode.map(([id]) => id), ...ra.paint.byNode.map(([id]) => id)]),
    ];
    const nodes = await describeNodes(cdp, nodeIds);

    console.log(`\ngesture: ${JSON.stringify(g)}`);
    console.log(`composited layers (LayerTree): ${layers < 0 ? "no layerTreeDidChange event" : layers}`);
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
    printAnalysis("SCROLL", sa, map);
    printAnalysis("REST", ra, map);
    writeFileSync(
      `${out}.summary.json`,
      JSON.stringify(
        { url, device, viewport: vp, page: state, bundle: build, listeners, gesture: g, layers, scrollCpu, restCpu, anims, nodes, mutations: mut, restMutations: restMut, scroll: sa, rest: ra },
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
