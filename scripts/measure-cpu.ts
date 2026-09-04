/**
 * What a page costs, measured in a Chrome that is doing nothing else.
 *
 * ## Why this exists, when `scripts/chrome-cpu.ts` already samples CPU
 *
 * That one reads `ps` against the browser you are already using, and on a real
 * machine that turned out to be unusable: this laptop had 76 renderer
 * processes alive, four of them over 80% of a core from unrelated tabs, and
 * nothing in `ps` says which renderer is which tab. Worse, the numbers moved
 * under us — five renderers appeared and vanished inside one 25-second window
 * because somebody was browsing in another window. A measurement that noisy
 * cannot support a before-and-after claim, which is the only kind of claim
 * worth making about performance.
 *
 * So this launches its **own** Chrome, with its own profile, one tab, and
 * nothing else running in it, and asks the browser directly rather than
 * inferring from the process table.
 *
 * ## And it asks a better question
 *
 * `ps` gives one number: CPU. The DevTools Protocol's `Performance.getMetrics`
 * gives that number broken into the parts that tell you what to fix —
 * `ScriptDuration`, `LayoutDuration`, `RecalcStyleDuration`, and the counts
 * beside them. "6% of a core" is a complaint; "5.1% of it is script inside a
 * cross-origin iframe" is a bug report. These are cumulative totals, so every
 * figure below is a difference between two reads over a known window, for the
 * same reason `chrome-cpu.ts` differences `ps`.
 *
 * ## Usage
 *
 *     npx tsx scripts/measure-cpu.ts --url http://localhost:5273/ --seconds 60
 *     npx tsx scripts/measure-cpu.ts --url … --settle 25 --seconds 60 --json out.json
 *     npx tsx scripts/measure-cpu.ts --url … --hidden      # measure a background tab
 *
 * ## Measuring anything behind the sign-in gate
 *
 * A throwaway profile is not signed in, and every route including
 * `/api/health` answers 401 ([auth.md](../docs/project/auth.md)) — so by
 * default this can measure the sign-in screen and nothing past it. `--profile`
 * points at a directory that is kept instead of deleted:
 *
 *     npx tsx scripts/measure-cpu.ts --profile ~/.spideryarn-measure --sign-in
 *     # sign in in the window that opens, then close it. Once, ever.
 *     npx tsx scripts/measure-cpu.ts --profile ~/.spideryarn-measure \
 *       --url http://localhost:5273/read/some-slug --settle 25 --seconds 60
 *
 * `--sign-in` just opens the browser and waits for you rather than measuring.
 * The session lives in that profile's `localStorage` and survives, so this is a
 * one-time step. Keep the directory out of the repo — it holds a real session.
 *
 * `--settle` is not optional in spirit. A page's first seconds are its load —
 * fetches, first paint, the mount cascade — and folding that into an "idle"
 * figure is the single easiest way to measure the wrong thing. It happened
 * here: a 14-second window that was supposed to be idle contained nine
 * page-load fetches, and its render count was four times the true one.
 *
 * ## Every frame, not just the top one
 *
 * A cross-origin iframe gets its own renderer process under site isolation,
 * and its work is **not** in the host page's metrics. The first version of this
 * script measured only the top frame, and reported a page carrying a YouTube
 * embed as costing **0.0%** — a confident, precise, wrong answer, and exactly
 * the [silent-success](../docs/reusable/silent-success.md) shape, because the
 * number looked like the good news you were hoping for.
 *
 * So it attaches to every page and iframe target and sums them, and prints the
 * per-target split underneath — which is the interesting half, since "the page
 * is idle and the embed is not" is a different bug from the reverse.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { localMagicLink } from "./seed-local-session.js";

/**
 * Which Chrome, and it is not the same one on every machine.
 *
 * This was the macOS path as a bare constant until 2026-09-03, which made the
 * whole instrument unrunnable on the remote box — where there is exactly one
 * browser, system Chrome at `/usr/bin/google-chrome-stable`, and the reason
 * [browser-control.md](../docs/project/browser-control.md) says the mechanism
 * is decided by the machine rather than by preference. The failure was at
 * least loud (`ENOENT`), which is more than most of the traps on
 * [performance.md](../docs/project/performance.md) manage.
 *
 * `SPIDERYARN_CHROME` wins, so a machine with Chrome somewhere else needs no
 * edit here.
 */
const CHROME =
  process.env.SPIDERYARN_CHROME ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/usr/bin/google-chrome-stable");

/**
 * A headless box has no screen, and a tab with no screen is not a fair test.
 *
 * Chrome will not start at all without one, and the two ways out are not
 * equivalent for our purpose. `--headless=new` composites for real but is
 * still its own rendering path; an **X server** — the box has Xvfb, and
 * `:99` is the one noVNC shows — gives an ordinary visible tab, which matters
 * more here than anywhere else: `document.visibilityState` drives the pauses
 * in `useJobs` and `useNow`, `requestAnimationFrame` does not run at all in a
 * hidden document, and the single most repeated trap on
 * [performance.md](../docs/project/performance.md) is a harness that could not
 * produce a genuinely-visible reading and concluded the renderer was frozen.
 *
 * So: an inherited `DISPLAY` is used as-is, and otherwise we go headless and
 * say so. `--display :99` forces one.
 */
const display = (() => {
  const i = process.argv.indexOf("--display");
  return i === -1 ? process.env.DISPLAY : process.argv[i + 1];
})();
const HEADLESS = process.platform !== "darwin" && !display;
/**
 * Chrome's debugging port, chosen by Chrome rather than by us.
 *
 * **It used to be the constant 9333, and that was a silent-success bug of the
 * exact kind this file exists to catch.** Two measurements running at once —
 * a before and an after, say — both spawned a Chrome, and the second one's
 * `--remote-debugging-port=9333` quietly lost the race and exited that
 * listener. The second script then connected to the port anyway, found the
 * *first* browser's targets, and measured somebody else's tab. It never
 * errored. It reported plausible numbers for a page it had never opened, and
 * the tell was a blank-page reading for a URL that renders fine.
 *
 * `0` asks the OS for a free port; Chrome writes the one it got into
 * `DevToolsActivePort` in the profile directory. Reading it back is the only
 * way to know which browser we are talking to.
 */
let PORT = 0;

/** First line of `DevToolsActivePort` is the port; the second is a WS path. */
async function readDebugPort(profile: string, deadlineMs = 20_000): Promise<number> {
  const file = join(profile, "DevToolsActivePort");
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const first = readFileSync(file, "utf8").split("\n")[0]?.trim();
      const n = Number(first);
      if (Number.isInteger(n) && n > 0) return n;
    } catch {
      /* not written yet */
    }
    await sleep(150);
  }
  throw new Error(`Chrome never wrote ${file} — did it fail to start?`);
}

/**
 * A flag's value, where **another flag is not a value**.
 *
 * `--cpu-profile --scroll` used to mean "write the profile to a file called
 * `--scroll`", and because `has("scroll")` is a separate lookup the run still
 * scrolled — so the only symptom was a strangely-named file. GPT Sol,
 * 2026-09-03. A following `--…` now means "no value given".
 */
const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith("--") ? fallback : next;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

/**
 * The metrics worth printing, and what each one means when it is the big one.
 *
 * **`TaskDuration` is not CPU, and this file used to say it was.** Without a
 * `timeDomain`, Chromium reports these in wall-clock `timeTicks`, so
 * `TaskDuration` is *elapsed time inside main-thread tasks* — a task that
 * spends most of its time waiting still counts in full. `ThreadTime` and
 * `ProcessTime` are the actual CPU counters, and they are what
 * `percentOfOneCore` is now built from; the durations stay because the split
 * between script, layout and style is the half that names a cause.
 *
 * `ProcessTime` is the honest headline: it is the whole renderer process, so
 * it includes compositor, raster and worker threads that no main-thread figure
 * can see. GPT Sol's finding, 2026-08-27 — and worth stating loudly, because
 * "0.4% of a core" was quoted in a doc before anybody checked which clock it
 * came off.
 */
const INTERESTING = [
  "ProcessTime", // CPU seconds for the whole renderer process — the headline
  "ThreadTime", // CPU seconds for the main thread alone
  "TaskDuration", // WALL-CLOCK time inside main-thread tasks. Not CPU.
  "ScriptDuration", // JavaScript
  "LayoutDuration", // reflow
  "RecalcStyleDuration", // selector matching and style resolution
  "LayoutCount",
  "RecalcStyleCount",
  "Nodes",
  "JSEventListeners",
] as const;

type Metrics = Record<string, number>;

/**
 * Refuse to carry a real session anywhere but this machine.
 *
 * Checked on the parsed hostname rather than a substring, for the reason
 * `seed-local-session.ts` gives: `http://localhost.attacker.example/` contains
 * "localhost" and is not it.
 */
function assertLocalOrigin(u: string, flagName: string): void {
  const { hostname, protocol } = new URL(u);
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (!local || (protocol !== "http:" && protocol !== "https:")) {
    throw new Error(
      `${flagName} points at ${u} — a session may only be carried between local origins`,
    );
  }
}

/** Wait until the page is actually standing on `origin`, or say so and stop. */
async function waitForOrigin(cdp: Cdp, origin: string, deadlineMs = 15_000): Promise<void> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    const at = await cdp.send<{ result: { value: string } }>("Runtime.evaluate", {
      expression: "location.origin",
      returnByValue: true,
    });
    if (at.result.value === origin) return;
    await sleep(200);
  }
  throw new Error(`the browser never reached ${origin} — nothing was written`);
}

/** The shape `Profiler.stop` returns. Only the fields we read are named. */
interface CpuProfile {
  nodes: {
    id: number;
    callFrame: { functionName: string; url: string; lineNumber: number };
    children?: number[];
  }[];
  /** One entry per sample: the id of the node that was on top of the stack. */
  samples?: number[];
  /** Deltas in microseconds, one per sample. */
  timeDeltas?: number[];
}

/**
 * Turn a sampling profile into the only two lists worth reading.
 *
 * **Self time, not total time.** A flame graph's fat frame is usually
 * `performSyncWorkOnRoot`, which tells you React was busy and nothing about
 * why. Self time is where the samples actually landed, so the answer is a
 * function you can go and open.
 *
 * Frames are grouped by `functionName @ file:line`, because the same name in
 * two files is two functions and summing them would invent a hotspot that is
 * not there. Our own code is separated from `node_modules` and the browser's
 * own frames, since "46% of script is ours" and "46% is React's reconciler"
 * point at completely different fixes.
 *
 * **That split is a dev-server fact and says nothing in production.** Vite
 * serves our modules at `/src/…` in dev; a production build is one
 * `/assets/main-*.js` containing our code *and* React, and a raw CDP profile is
 * not source-map-resolved — so every frame looks foreign and the split would
 * read "0% of it in src/" no matter what was hot. GPT Sol, 2026-09-03. It is
 * therefore printed only when the frames can carry it, and the ranking — which
 * is the useful half — is printed either way. Load the `.cpuprofile` in
 * DevTools to get names back, since DevTools applies the source map.
 */
function reportProfile(profile: CpuProfile, out: string): void {
  if (out) {
    writeFileSync(out, JSON.stringify(profile));
    console.log(`cpu profile written to ${out} (load it in DevTools → Performance)`);
  }
  const { nodes, samples, timeDeltas } = profile;
  if (!samples?.length || !timeDeltas?.length) {
    console.log("  ⚠ profile has no samples — did the window contain any script at all?");
    return;
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const self = new Map<string, { ms: number; ours: boolean }>();
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    const node = byId.get(samples[i] as number);
    /* `timeDeltas[i]` is the gap *before* sample i, which is the interval the
       sample stands for. Microseconds. */
    const ms = (timeDeltas[i] ?? 0) / 1000;
    if (!node || ms <= 0) continue;
    const f = node.callFrame;
    const name = f.functionName || "(anonymous)";
    /* Chrome's synthetic frames — (program), (idle), (garbage collector) —
       carry no url. (idle) is not cost and must not be totalled with the rest,
       or every percentage below is quietly diluted by however long the page
       spent doing nothing. */
    if (name === "(idle)" || name === "(program)") continue;
    const where = f.url ? `${f.url.replace(/^https?:\/\/[^/]+/, "")}:${f.lineNumber + 1}` : "";
    const ours = where.startsWith("/src/") || where.startsWith("/scripts/");
    const key = where ? `${name} @ ${where}` : name;
    const prev = self.get(key);
    if (prev) prev.ms += ms;
    else self.set(key, { ms, ours });
    total += ms;
  }
  if (total <= 0) {
    console.log("  ⚠ profile totalled no script time — the page was idle, or the sampler missed");
    return;
  }
  const ranked = [...self.entries()].sort((a, b) => b[1].ms - a[1].ms);
  const ourMs = ranked.reduce((n, [, v]) => n + (v.ours ? v.ms : 0), 0);
  /* Only a dev server can tell our frames from React's; see the docstring. A
     bundle says so rather than reporting a meaningless 0%. */
  const bundled = ranked.some(([key]) => key.includes("/assets/"));
  console.log(
    `\ncpu profile: ${total.toFixed(0)}ms of script in ${samples.length} samples` +
      (bundled
        ? " — built bundle, so src/ cannot be told from node_modules here"
        : ` — ${((ourMs / total) * 100).toFixed(0)}% of it in src/`),
  );
  const show = (label: string, rows: [string, { ms: number }][]) => {
    if (rows.length === 0) return;
    console.log(`  ${label}`);
    for (const [key, v] of rows.slice(0, 12)) {
      console.log(`    ${v.ms.toFixed(0).padStart(6)}ms ${((v.ms / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
    }
  };
  if (bundled) {
    show("hottest (self time):", ranked);
  } else {
    show("hottest in src/ (self time):", ranked.filter(([, v]) => v.ours));
    show("hottest elsewhere (self time):", ranked.filter(([, v]) => !v.ours));
  }
}

/**
 * One CDP connection, with request ids and a promise per outstanding call.
 *
 * Hand-rolled rather than `chrome-remote-interface`, and on **Node's own
 * `WebSocket`** rather than the `ws` package — which is not in this tree, and
 * adding a dependency to a measurement script would be a poor trade against
 * the repo's rule about dependencies
 * (docs/reusable/third-party-library-selection.md). Node has had a global
 * `WebSocket` since 22; this needs three commands and no event subscriptions,
 * so the browser-shaped API is enough. If it ever needs events, take the
 * library rather than growing this.
 */
class Cdp {
  private ws: WebSocket;
  private next = 1;
  private pending = new Map<number, { ok(v: unknown): void; fail(e: Error): void }>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener("message", (ev: MessageEvent) => {
      /* **A CDP failure is `{id, error}`, not a rejected socket.** This modelled
         only `{id, result}` and resolved unconditionally, so a command the
         browser refused looked exactly like one it ran — and `undefined` then
         flowed on to whatever read the result. It made the wheel loop's
         `failed` counter a lie: it could only ever see a synchronous
         `WebSocket.send` throw, never a command the browser rejected, while
         reporting zero. GPT Sol, 2026-09-04; the counter is the sort of check
         docs/reusable/silent-success.md is about, and it was one itself. */
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        result?: unknown;
        error?: { code?: number; message?: string };
      };
      if (msg.id === undefined) return; // an event; nothing here subscribes
      const waiting = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (!waiting) return;
      if (msg.error) waiting.fail(new Error(`CDP: ${msg.error.message ?? "unknown error"}`));
      else waiting.ok(msg.result);
    });
    /* A socket that closes with commands outstanding used to leave their
       promises pending for ever, so the run hung rather than failing. */
    this.ws.addEventListener("close", () => {
      for (const waiting of this.pending.values()) {
        waiting.fail(new Error("CDP: the browser closed the connection"));
      }
      this.pending.clear();
    });
  }

  static async open(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error(`could not open ${url}`)), {
        once: true,
      });
    });
    return new Cdp(ws);
  }

  send<T = unknown>(method: string, params: object = {}): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        ok: resolve as (v: unknown) => void,
        fail: (e) => reject(new Error(`${method}: ${e.message}`)),
      });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  close(): void {
    this.ws.close();
  }
}

/** Chrome's own list of debuggable targets, which is also how we find the page
 *  and prove whether a cross-origin embed spawned one of its own. */
async function targets(): Promise<{ type: string; url: string; webSocketDebuggerUrl?: string }[]> {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return (await r.json()) as { type: string; url: string; webSocketDebuggerUrl?: string }[];
}

/** Wait for the debugging port to answer. Chrome takes a second or two to
 *  start, and a fixed sleep is either too short on a busy machine or wasted
 *  time on an idle one. */
async function waitForPort(deadlineMs = 20_000): Promise<void> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`Chrome's debugging port ${PORT} never opened`);
}

/**
 * A connection to the top frame and to every out-of-process frame under it.
 *
 * Chrome exposes a cross-origin iframe at `/json/list` as its own target with
 * its own debugger URL, so this is a second connection rather than anything
 * clever. `Performance.enable` per connection, because the metrics are
 * per-target and a target that was never enabled reports an empty list —
 * which sums to zero and reads as "this frame is idle".
 *
 * The top frame is passed in already-open rather than re-derived, so its
 * visibility override is not lost to a second connection.
 */
async function attachFrames(topUrl: string, top: Cdp): Promise<Map<string, Cdp>> {
  const frames = new Map<string, Cdp>([["top", top]]);
  for (const t of await targets()) {
    if (!t.webSocketDebuggerUrl || t.webSocketDebuggerUrl === topUrl) continue;
    /* **`iframe` only, never another `page`.** A second page is a second tab,
       and adding its numbers to this one would silently inflate the total —
       the script opens exactly one tab, so any other page target is something
       Chrome opened for itself. Restricting to `iframe` also means every
       target added here is an out-of-process frame of the page under test,
       which is what makes summing them legitimate rather than double-counting:
       an in-process frame has no target of its own and is already inside the
       top frame's figures. GPT Sol raised the duplication risk; this is the
       narrowing that answers it. */
    if (t.type !== "iframe") continue;
    // Chrome's own UI surfaces are not the page under test.
    if (t.url.startsWith("chrome://") || t.url.startsWith("chrome-extension://")) continue;
    try {
      const conn = await Cdp.open(t.webSocketDebuggerUrl);
      await conn.send("Performance.enable");
      frames.set(`${t.type} ${t.url.slice(0, 70)}`, conn);
    } catch {
      /* A frame can go away between listing and attaching. One missing frame
         is worth a smaller number, not a failed run — and it is named in the
         output by its absence from `byFrame`. */
    }
  }
  return frames;
}

function pick(list: { name: string; value: number }[]): Metrics {
  const out: Metrics = {};
  for (const m of list) if ((INTERESTING as readonly string[]).includes(m.name)) out[m.name] = m.value;
  return out;
}

/**
 * Scroll the page the way a reader does, for `ms`.
 *
 * **A real wheel event, not `window.scrollTo`.** The two take different paths:
 * `scrollTo` is a script-driven scroll, while a wheel goes in at the top of the
 * input pipeline, hits the compositor, and runs every passive listener the app
 * has registered. Only the second one measures what a reader's finger costs.
 *
 * 60ms apart rather than every frame: a trackpad delivers wheel events at
 * roughly that rate, and firing one per frame measures a scroll nobody
 * performs. `deltaY` is a plausible notch rather than a fling, and the sign
 * flips at the bottom so a long window keeps moving instead of measuring a page
 * pinned against its end — which is a *stationary* page, and would quietly turn
 * a scrolling measurement back into an idle one.
 */
interface PageState {
  title: string;
  nodes: number;
  rows: number;
  prose: number;
  text: string;
  scrollHeight: number;
}

/* A window is 600-1000px tall here; anything shorter than this cannot scroll,
   whatever the wheel events say. Deliberately a round guess rather than a real
   measurement — it only has to catch "the page is one screen". */
const window$innerHeightGuess = 800;

/**
 * Where the synthetic pointer sits while it scrolls.
 *
 * It was `400, 400` as a bare constant, which is **over `table.zoom`** on the
 * reading view — and every `<tr>` there carries an `onMouseEnter`. That made
 * "does hover fire during a scroll?" a question the harness could not be used
 * to ask, because it had already answered it one way. It can now be moved off
 * the table (`--wheel-x 5`, the spine rail), and the run prints where the point
 * actually landed, because a "pointer away" run that was secretly still over
 * the table looks exactly like a null result.
 *
 * The answer, 2026-09-04, for anyone who does not want to re-run it: 77-79
 * `TableView` renders over the table against 74-76 off it, which is noise, and
 * a capture-phase listener saw **0** `mouseenter` events from 60 synthetic
 * wheels against 12 from three real `mouse.move`s. Chrome does not recompute
 * hover from a compositor scroll under a stationary synthetic pointer.
 */
const WHEEL_X = Number(flag("wheel-x", "400"));
const WHEEL_Y = Number(flag("wheel-y", "400"));

/**
 * What the wheel loop actually managed to do — and it is not a detail.
 *
 * This used to `await` each `Input.dispatchMouseEvent` **before** sleeping, so a
 * page whose main thread was busy acknowledged more slowly and therefore
 * received *fewer wheel events*. The slower side of every comparison was being
 * asked to do less work, which biases every before/after on this harness in the
 * flattering direction: the 2026-09-03 dev runs dispatched 90 events against the
 * static clone's 370, and production 325-335 against 370.
 *
 * So the send is no longer awaited, and the loop runs on a **fixed schedule**
 * against its own start time rather than accumulating each iteration's drift.
 * Both sides of a comparison now get the same number of events. `sendMs*` is
 * kept, because how long the browser takes to acknowledge input is a real signal
 * about main-thread load — it is simply no longer allowed to change the input.
 */
interface WheelStats {
  /** How many events went out. Should equal `ms / STEP_MS` on any page now. */
  dispatched: number;
  wallMs: number;
  /** Ack latency, measured but no longer gating the loop. */
  sendMsTotal: number;
  sendMsMax: number;
  /** Acks that alone took longer than the step — main-thread congestion. */
  sendMsOverStep: number;
  /** Sends that failed outright. Never seen; here so a silent zero is not one. */
  failed: number;
}

async function wheel(cdp: Cdp, ms: number): Promise<WheelStats> {
  const STEP_MS = 60;
  const start = Date.now();
  const until = start + ms;
  let deltaY = 120;
  let sinceFlip = 0;
  const s: WheelStats = {
    dispatched: 0,
    wallMs: 0,
    sendMsTotal: 0,
    sendMsMax: 0,
    sendMsOverStep: 0,
    failed: 0,
  };
  const inFlight: Promise<void>[] = [];
  while (Date.now() < until) {
    const t0 = Date.now();
    /* Deliberately not awaited — see `WheelStats`. Collected so the run cannot
       finish with sends still outstanding, and so a rejection is counted rather
       than becoming an unhandled promise. */
    inFlight.push(
      cdp
        .send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: WHEEL_X,
          y: WHEEL_Y,
          deltaX: 0,
          deltaY,
          pointerType: "mouse",
        })
        .then(
          () => {
            const took = Date.now() - t0;
            s.sendMsTotal += took;
            if (took > s.sendMsMax) s.sendMsMax = took;
            if (took > STEP_MS) s.sendMsOverStep += 1;
          },
          () => {
            s.failed += 1;
          },
        ),
    );
    s.dispatched += 1;
    sinceFlip += 1;
    // ~15 seconds in one direction, then back, so we never park at an end.
    if (sinceFlip > 250) {
      deltaY = -deltaY;
      sinceFlip = 0;
    }
    /* Against `start`, not against now: sleeping a flat `STEP_MS` after
       whatever the iteration cost is how the old loop drifted. */
    const nextAt = start + s.dispatched * STEP_MS;
    const wait = nextAt - Date.now();
    if (wait > 0) await sleep(wait);
  }
  await Promise.all(inFlight);
  s.wallMs = Date.now() - start;
  return s;
}

/**
 * How smooth the scroll actually was, which is the number a reader feels.
 *
 * Everything else here is CPU, and CPU is a budget rather than an experience: a
 * page can sit at 49% of a core and still miss one frame in fourteen, which is
 * exactly what the reading view was doing on 2026-09-04 while the same document
 * with its scripts stripped missed one in three hundred. Nobody had looked,
 * because nothing measured it.
 *
 * An rAF loop in the page, recording inter-frame deltas and `scrollY`. It costs
 * one callback a frame, which is inside the noise of the thing it measures — but
 * it is *in* both sides of any comparison, so read a difference rather than an
 * absolute.
 *
 * `totalDistance` is the other half of why this exists: it is `dispatched x
 * deltaY` when every wheel event landed, and less when they did not, which is
 * how the harness's old ack-gated pacing was caught. See `WheelStats`.
 */
async function startFrameProbe(cdp: Cdp): Promise<void> {
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      window.__scrollProbe = { deltas: [], scrollYs: [], running: true };
      let last = null;
      function tick(t) {
        const p = window.__scrollProbe;
        if (!p || !p.running) return;
        if (last !== null) p.deltas.push(t - last);
        last = t;
        p.scrollYs.push(window.scrollY || document.documentElement.scrollTop || 0);
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    })()`,
  });
}

interface FrameStats {
  frames: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  /**
   * rAF intervals longer than 32ms — **not** a count of missed refreshes.
   *
   * A 133ms gap is roughly seven missed 60Hz opportunities and increments this
   * once, and the denominator is the intervals that were delivered rather than
   * the ones that should have been. So it is a comparative jank signal and not
   * a frame-drop rate, and calling it "one dropped frame in fourteen" is wrong
   * in both the numerator and the denominator. GPT Sol, 2026-09-04.
   */
  longFramesOver32ms: number;
  /** Every pixel travelled, up and down. `dispatched x 120` when nothing was lost. */
  totalDistance: number;
  netDistance: number;
}

async function stopFrameProbe(cdp: Cdp): Promise<FrameStats> {
  const r = await cdp.send<{ result: { value: FrameStats } }>("Runtime.evaluate", {
    expression: `(() => {
      const p = window.__scrollProbe;
      if (!p) return { frames: 0, medianMs: 0, p95Ms: 0, maxMs: 0, longFramesOver32ms: 0, totalDistance: 0, netDistance: 0 };
      p.running = false;
      const deltas = p.deltas.slice().sort((a, b) => a - b);
      const ys = p.scrollYs;
      let totalDistance = 0;
      for (let i = 1; i < ys.length; i++) totalDistance += Math.abs(ys[i] - ys[i - 1]);
      const pct = (q) => deltas.length ? deltas[Math.min(deltas.length - 1, Math.floor(q * deltas.length))] : 0;
      return {
        frames: deltas.length + 1,
        medianMs: pct(0.5),
        p95Ms: pct(0.95),
        maxMs: deltas.length ? deltas[deltas.length - 1] : 0,
        longFramesOver32ms: deltas.filter(d => d > 32).length,
        totalDistance,
        netDistance: ys.length ? Math.abs(ys[ys.length - 1] - ys[0]) : 0,
      };
    })()`,
    returnByValue: true,
  });
  return r.result.value;
}

async function main(): Promise<void> {
  const url = flag("url", "http://localhost:5273/");
  const seconds = Number(flag("seconds", "60"));
  const settle = Number(flag("settle", "20"));
  const json = has("json") ? flag("json", "") : "";
  /* A named directory is kept; an unnamed one is a fresh temp dir deleted at
     the end. Kept is what makes a signed-in measurement possible at all, and
     temp is the right default because a profile that accumulates state stops
     being the clean browser this script exists to provide. */
  const kept = has("profile") ? flag("profile", "") : "";
  const profile = kept || mkdtempSync(join(tmpdir(), "spya-cpu-"));

  /* Signed in without a human, against the local Supabase only. See
     seed-local-session.ts for why this is a `verifyOtp` and not a magic-link
     redirect: the app is on PKCE, and a browser that did not start the flow has
     no code verifier to finish it with. Start on the origin so the module graph
     is loaded and the app's own SDK instance is importable. */
  /* Where the signing-in happens, which is not always where the measuring
     happens. Empty unless `--sign-in-via` is passed; see the carry below. */
  const via = flag("sign-in-via", "");
  const link = has("local-sign-in") ? await localMagicLink(via || url) : null;
  const startUrl = link ? new URL(via || url).origin : url;

  let chrome: ChildProcess | null = null;
  let cdp: Cdp | null = null;
  try {
    chrome = spawn(
      CHROME,
      [
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        // A fresh profile with none of the machine's extensions, sync, or
        // startup tabs — the whole point is a browser doing nothing else.
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        // Background tabs are frozen and their timers throttled after a few
        // minutes, which silently turns a "hidden tab" measurement into a
        // measurement of a frozen tab. Off, so --hidden measures the thing we
        // ship rather than Chrome's rescue of it. (The freezing is real and
        // good; it is just not what is being measured.)
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        // No screen on this machine. See HEADLESS above for why an X display
        // is preferred when there is one: a headless tab is honest about its
        // visibility, but an ordinary visible tab is what we ship.
        ...(HEADLESS ? ["--headless=new", "--disable-gpu"] : []),
        startUrl,
      ],
      // `--display` has to reach the child as an env var; Chrome has no flag
      // for it. An inherited DISPLAY already arrives this way.
      { stdio: "ignore", env: display ? { ...process.env, DISPLAY: display } : process.env },
    );

    PORT = await readDebugPort(profile);
    await waitForPort();

    if (has("sign-in")) {
      // No measuring, no deadline the human has to beat. The browser stays up
      // until Ctrl-C, they sign in, and the session lands in `--profile`.
      console.log(
        `signed-in setup: sign in in the window that opened, then press Ctrl-C.\n` +
          `the session is kept in ${profile}`,
      );
      await new Promise(() => {});
    }

    const page = (await targets()).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!page?.webSocketDebuggerUrl) throw new Error("no page target — did Chrome open the URL?");
    cdp = await Cdp.open(page.webSocketDebuggerUrl);
    await cdp.send("Performance.enable");

    if (link) {
      /* Handed to the app's own client rather than to a second one built here,
         so the session is stored under the key that client reads, in the format
         that client's version writes. Vite serves the module by its source
         path, which is what makes this possible in dev and impossible against a
         built bundle. */
      await sleep(3000);
      const signIn = await cdp.send<{ result: { value: string } }>("Runtime.evaluate", {
        expression: `(async () => {
          try {
            const m = await import('/src/web/lib/supabase.ts');
            const r = await m.supabase.auth.verifyOtp({
              type: 'magiclink', token_hash: ${JSON.stringify(link.hashedToken)} });
            if (r.error) return 'error: ' + r.error.message;
            return r.data.session ? 'ok:' + (r.data.user?.email ?? '?') : 'no session';
          } catch (e) { return 'threw: ' + (e && e.message); }
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      const said = signIn.result.value;
      if (!said.startsWith("ok:")) throw new Error(`local sign-in failed — ${said}`);
      console.log(`signed in locally (${said.slice(3)})`);

      /* Carry that session to another origin, which is the only way to measure
         a **production build** signed in.

         The trick above needs `import('/src/web/lib/supabase.ts')`, and only a
         dev server serves a module at its source path — so against `vite
         preview` it throws, and "nothing here has been measured on a
         production build" stayed an open item on performance.md for a week.
         `--sign-in-via <dev origin>` signs in there and copies the stored
         token across, which is not the same thing as writing the session
         ourselves: the string moved is the one the SDK wrote, in whatever
         format that version of the SDK writes, so it cannot drift out of step
         with the client that has to read it. Only the *origin* changes, and
         both are localhost.

         `sb-…-auth-token` is the SDK's own key and its name follows the
         Supabase URL's host, so it is matched by prefix rather than spelled
         out here. `spideryarn.lastUser` rides along because the app reads it
         on boot. */
      const target = new URL(url).origin;
      if (via && target !== new URL(via).origin) {
        /* **Both ends, before anything is minted or moved.** GPT Sol's finding,
           2026-09-03: `seed-local-session.ts` checks `SUPABASE_URL` and nothing
           else, so without this a `--url https://elsewhere/` would have copied a
           live bearer token into a stranger's `localStorage` and then run their
           JavaScript — and a hostile `--sign-in-via` could serve its own
           `/src/web/lib/supabase.ts` and be handed the magic-link hash. Both
           origins are asked separately because they are separately dangerous. */
        assertLocalOrigin(via, "--sign-in-via");
        assertLocalOrigin(url, "--url");
        const dump = await cdp.send<{ result: { value: string } }>("Runtime.evaluate", {
          /* The session, and the one key the app reads on boot — named, not a
             namespace sweep, so a future `spideryarn.*` key holding something
             that should not travel does not start travelling silently. */
          expression: `JSON.stringify(Object.fromEntries(Object.entries(localStorage)
            .filter(([k]) => k.startsWith('sb-') || k === 'spideryarn.lastUser')))`,
          returnByValue: true,
        });
        const carried = JSON.parse(dump.result.value) as Record<string, string>;
        const keys = Object.keys(carried);
        if (keys.length === 0) throw new Error("nothing to carry — the SDK stored no session");
        /* Navigate first: `localStorage` is per origin, so this has to be
           written while the browser is standing on the origin that will read
           it. Blank rather than the article, so the app does not boot signed
           out and cache a 401 before the token lands. */
        await cdp.send("Page.navigate", { url: `${target}/favicon.ico` });
        /* **Wait for the origin, not for a guess at how long it takes.** A
           fixed sleep that expires early writes the token back into the origin
           it came from and measures a signed-out page — which renders fine and
           costs almost nothing, so it reads as a good result. */
        await waitForOrigin(cdp, target);
        await cdp.send("Runtime.evaluate", {
          expression: `(() => { const s = ${JSON.stringify(JSON.stringify(carried))};
            for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); })()`,
        });
        console.log(`carried ${keys.length} storage keys to ${target}`);
      }
      await cdp.send("Page.navigate", { url });
    }

    if (has("hidden")) {
      // Genuinely hidden, told to the page rather than faked around it: this
      // is the same signal a real background tab gets, so every
      // `visibilitychange` listener in the app runs exactly as it would.
      await cdp.send("Emulation.setPageVisibilityOverride", { visibility: "hidden" });
    }

    console.log(`settling ${settle}s (page load is not idle)…`);
    await sleep(settle * 1000);

    /* Attached after the settle, because an embed's own frame does not exist
       until the embed has loaded — connecting earlier finds the top frame
       alone and silently measures a fraction of the page. */
    const frames = await attachFrames(page.webSocketDebuggerUrl, cdp);

    const read = async (): Promise<{ total: Metrics; byFrame: Record<string, Metrics> }> => {
      const byFrame: Record<string, Metrics> = {};
      const total: Metrics = {};
      for (const [label, conn] of frames) {
        const got = pick(
          (await conn.send<{ metrics: { name: string; value: number }[] }>("Performance.getMetrics"))
            .metrics,
        );
        byFrame[label] = got;
        for (const [k, v] of Object.entries(got)) total[k] = (total[k] ?? 0) + v;
      }
      return { total, byFrame };
    };

    /* What is actually on screen, reported with every run.
       
       **A number from a page that never rendered looks exactly like a number
       from a fast one** — and it looks *better*, because a blank page is
       genuinely cheap. The first signed-in run here reported 345 DOM nodes for
       an article and a beautifully low cost, which is the
       docs/reusable/silent-success.md pattern with a profiler on it. So every
       result now carries the evidence that the thing being measured is the
       thing we meant. */
    const page$ = await cdp.send<{ result: { value: PageState } }>("Runtime.evaluate", {
      expression: `(() => {
        const t = document.querySelector('table.zoom');
        return {
          title: document.title,
          nodes: document.querySelectorAll('*').length,
          rows: t ? t.querySelectorAll('tr[data-block]').length : 0,
          prose: document.querySelectorAll('.prose').length,
          text: (document.body.innerText || '').trim().slice(0, 80),
          scrollHeight: document.documentElement.scrollHeight,
        };
      })()`,
      returnByValue: true,
    });
    const state = page$.result.value;
    console.log(
      `page: ${state.rows} rows, ${state.prose} prose blocks, ${state.nodes} nodes, ` +
        `${state.scrollHeight}px tall — "${state.text.replace(/\s+/g, " ").slice(0, 60)}"`,
    );
    if (state.rows === 0) {
      console.log("  ⚠ no article rows on screen — this is NOT a reading-view measurement");
    }
    if (state.scrollHeight <= window$innerHeightGuess) {
      console.log("  ⚠ page is not taller than a viewport — a scroll measurement would be idle");
    }

    /* Zeroed here so the counts below describe the measured window rather than
       the window plus the page load that preceded it. */
    await cdp.send("Runtime.evaluate", { expression: "window.__perf && window.__perf.reset()" });

    const first = await read();
    const before = first.total;
    const t0 = Date.now();
    const scrolling = has("scroll");
    console.log(
      `measuring ${seconds}s${has("hidden") ? " (tab hidden)" : ""}${scrolling ? " while scrolling" : ""}…`,
    );
    /* A sampling profile of the measured window, when asked for.

       **`ScriptDuration` says how much; only this says what.** The split into
       script / layout / style names a *kind* of work — enough to know whether
       to look at React or at CSS, and no further. Every scroll investigation
       on performance.md so far has had to close that last gap by reasoning
       about the code instead of by measuring it, which is how the diagram
       memo's `atRow` dependency survived two rounds, and how a grep over the
       wrong set of files came to read exactly like a grep that found
       everything.

       Off unless `--cpu-profile` is passed, because the sampler is not free —
       it perturbs the very number the rest of this script reports. A run that
       profiles is a run for *finding* the cost; a run that does not is the one
       whose percentage you quote. Never the same run. */
    /* Where the wheel pointer actually landed, printed unconditionally when
       scrolling — because a "pointer away from the table" run that was secretly
       still over it looks exactly like a null result, and that is the shape
       docs/reusable/silent-success.md is about. */
    if (scrolling) {
      const at = await cdp.send<{ result: { value: unknown } }>("Runtime.evaluate", {
        expression: `(() => {
          const t = document.querySelector('table.zoom');
          const el = document.elementFromPoint(${WHEEL_X}, ${WHEEL_Y});
          return {
            x: ${WHEEL_X}, y: ${WHEEL_Y},
            insideTable: !!(t && el && t.contains(el)),
            over: el ? el.tagName + (el.className ? '.' + String(el.className).slice(0, 40) : '') : null,
          };
        })()`,
        returnByValue: true,
      });
      console.log(`wheel pointer: ${JSON.stringify(at.result.value)}`);
    }
    const profiling = has("cpu-profile");
    if (profiling) {
      await cdp.send("Profiler.enable");
      /* 100µs rather than the 1ms default: a scroll's work is thousands of
         short frame callbacks, and at 1ms most of them fall between samples. */
      await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
      await cdp.send("Profiler.start");
    }
    let wheelStats: WheelStats | null = null;
    let frameStats: FrameStats | null = null;
    if (scrolling) {
      await startFrameProbe(cdp);
      wheelStats = await wheel(cdp, seconds * 1000);
      frameStats = await stopFrameProbe(cdp);
    } else await sleep(seconds * 1000);
    if (profiling) {
      const prof = await cdp.send<{ profile: CpuProfile }>("Profiler.stop");
      reportProfile(prof.profile, flag("cpu-profile", ""));
    }
    /* The in-page probe's render counts, when the URL asked for it (`?perf=1`).
       CPU is the number that matters, but it is noisy and it does not say
       *which component* spent it. A render count is exact, causal, and answers
       "did this change stop that subtree re-rendering?" directly. See perf.ts. */
    const renders = await cdp.send<{ result: { value: string } }>("Runtime.evaluate", {
      expression: `(() => {
        const p = window.__perf; if (!p) return '';
        const r = p.report();
        return (r.topRenders || []).slice(0, 6)
          .map(x => x[0] + '=' + x[1]).join(' ');
      })()`,
      returnByValue: true,
    });
    if (renders.result.value) console.log(`renders: ${renders.result.value}`);

    const second = await read();
    const after = second.total;
    const elapsed = (Date.now() - t0) / 1000;

    // Durations are cumulative seconds; counts are cumulative counts. Both
    // difference the same way, and only the durations become a percentage.
    const delta: Metrics = {};
    for (const k of Object.keys(after)) delta[k] = (after[k] ?? 0) - (before[k] ?? 0);

    const asPercent = (v: number) => Math.round((v / elapsed) * 1000) / 10;
    const result = {
      url,
      page: state,
      hidden: has("hidden"),
      elapsed,
      /** Real CPU, from Chromium's own CPU counters. `process` is the number to
       *  quote: it covers every thread the renderer runs, so unlike anything
       *  main-thread-only it can see compositing and raster. */
      cpuPercentOfOneCore: {
        process: asPercent(delta.ProcessTime ?? 0),
        mainThread: asPercent(delta.ThreadTime ?? 0),
      },
      /** Wall-clock time spent inside main-thread tasks, split by what the task
       *  was doing. **Not CPU** — a task that waits counts in full — but this is
       *  the split that says which of script, layout or style to go and look
       *  at. Read it for the shape, and `cpuPercentOfOneCore` for the size. */
      mainThreadBusyPercent: {
        total: asPercent(delta.TaskDuration ?? 0),
        script: asPercent(delta.ScriptDuration ?? 0),
        layout: asPercent(delta.LayoutDuration ?? 0),
        style: asPercent(delta.RecalcStyleDuration ?? 0),
      },
      counts: {
        layouts: delta.LayoutCount ?? 0,
        styleRecalcs: delta.RecalcStyleCount ?? 0,
        nodes: after.Nodes ?? 0,
        listeners: after.JSEventListeners ?? 0,
      },
      /* The same split per frame, so a page that is quiet while its embed is
         not says so. This is usually the line that names the culprit. */
      byFrame: Object.fromEntries(
        Object.entries(second.byFrame).map(([label, m]) => [
          label,
          {
            cpu: asPercent((m.ProcessTime ?? 0) - (first.byFrame[label]?.ProcessTime ?? 0)),
            busy: asPercent((m.TaskDuration ?? 0) - (first.byFrame[label]?.TaskDuration ?? 0)),
          },
        ]),
      ),
      /* Null unless `--scroll`. `wheel.dispatched` belongs beside every CPU
         figure it sits next to: two runs are only comparable if they were given
         the same input, and until 2026-09-04 the busier one silently got less
         of it. `frames.longFramesOver32ms` is the closest thing here to what a
         reader feels — read its own docstring before quoting it, because it is
         a count of long rAF intervals and not of missed refreshes. */
      wheel: wheelStats,
      frames: frameStats,
    };

    console.log(JSON.stringify(result, null, 2));
    if (frameStats && wheelStats) {
      const jank = frameStats.frames
        ? Math.round((frameStats.longFramesOver32ms / frameStats.frames) * 1000) / 10
        : 0;
      console.log(
        `scroll: ${wheelStats.dispatched} wheels → ${frameStats.totalDistance}px, ` +
          `p95 frame ${frameStats.p95Ms}ms, worst ${frameStats.maxMs}ms, ` +
          `${frameStats.longFramesOver32ms}/${frameStats.frames} rAF intervals over 32ms (${jank}%)`,
      );
    }
    if (json) {
      writeFileSync(json, JSON.stringify(result, null, 2));
      console.log(`wrote ${json}`);
    }
  } finally {
    cdp?.close();
    chrome?.kill();
    // Never the kept one — that is somebody's signed-in session, and deleting
    // it would turn a one-time setup step into a step before every run.
    if (!kept) {
      // Best-effort otherwise: a Chrome that has not finished exiting still
      // holds files in here, and failing to delete a temp directory must not
      // fail the run.
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* it is in the OS temp directory; the OS will get it */
      }
    }
  }
}

void main();
