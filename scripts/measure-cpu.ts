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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;

const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
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
  private pending = new Map<number, (v: unknown) => void>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener("message", (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown };
      if (msg.id === undefined) return; // an event; nothing here subscribes
      this.pending.get(msg.id)?.(msg.result);
      this.pending.delete(msg.id);
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
    return new Promise<T>((resolve) => {
      this.pending.set(id, resolve as (v: unknown) => void);
      this.ws.send(JSON.stringify({ id, method, params }));
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

  let chrome: ChildProcess | null = null;
  let cdp: Cdp | null = null;
  try {
    chrome = spawn(
      CHROME,
      [
        `--remote-debugging-port=${PORT}`,
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
        url,
      ],
      { stdio: "ignore" },
    );

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

    const first = await read();
    const before = first.total;
    const t0 = Date.now();
    console.log(`measuring ${seconds}s${has("hidden") ? " (tab hidden)" : ""}…`);
    await sleep(seconds * 1000);
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
    };

    console.log(JSON.stringify(result, null, 2));
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
