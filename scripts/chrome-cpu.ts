/**
 * What Chrome's renderer actually costs, sampled from outside the page.
 *
 * The in-page probe (src/web/perf.ts) can say *why* the page is busy — which
 * timer, which component — but it cannot say how much CPU that adds up to,
 * because a page cannot measure its own process. Worse, the two biggest
 * background costs leave no JavaScript trace at all: compositing a CSS
 * animation, and rasterising whatever it animates. So the probe can read a
 * clean zero on a tab that is spinning a core.
 *
 * Hence this: `ps` against Chrome's renderer processes, sampled on a timer,
 * printed as a table. It is the ground truth the probe gets checked against,
 * and the two disagreeing is information rather than a fault.
 *
 * Usage — leave it running while you drive the tab:
 *
 *     npx tsx scripts/chrome-cpu.ts --seconds 60
 *     npx tsx scripts/chrome-cpu.ts --seconds 60 --json out.json
 *
 * ## Reading the number
 *
 * `ps` reports `%cpu` as a percentage of **one** core, so 100 means one core
 * saturated and a 10-core machine tops out near 1000. An idle background tab
 * should be under about 1.
 *
 * ## The trap, and it is a bad one
 *
 * **macOS `ps` gives a lifetime average, not an instantaneous rate.** A process
 * up for an hour that spent the first minute at 100% and has been asleep since
 * still reports about 1.7, and no amount of sampling makes that number move.
 * Reading it directly would say "the fix worked" about a fix that did nothing.
 *
 * So every figure here is a **delta**: total CPU-seconds consumed between two
 * samples, divided by the wall time between them. That is a real rate over a
 * real window, and it is why the tool takes a duration rather than printing
 * once and exiting. The lifetime average is printed too, in its own column,
 * clearly labelled — it is useful for spotting a process that used to be busy,
 * and useless for anything else.
 *
 * ## Which process is the tab
 *
 * Chrome runs a renderer per site-instance, so `localhost:5273` gets its own,
 * but nothing in `ps` says which one — and "the busiest renderer is the one you
 * are driving" is a heuristic that dies on any real machine. This one had 74
 * renderers alive and four of them over 80% of a core, none of them ours.
 *
 * So the tab identifies itself, by **burning CPU on purpose**: call
 * `window.__perf.spin(4000)` in the tab while a window is being sampled, and
 * the renderer whose CPU-seconds jump by about four is this tab.
 *
 *     npx tsx scripts/chrome-cpu.ts --seconds 6      # then spin in the tab
 *     npx tsx scripts/chrome-cpu.ts --seconds 60 --pid 12345
 *
 * `--pid` then narrows every later measurement to that process, which is what
 * makes a before/after number mean anything. Every renderer is still printed
 * without it, so a misattribution stays visible rather than silent.
 */

import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

/** One process at one instant. `cpuSeconds` is the cumulative total the kernel
 *  has charged it, which is the only field here that can be differenced. */
type Sample = { pid: number; cpuSeconds: number; lifetimePercent: number; label: string };

/** `ps` prints elapsed CPU time as `[[dd-]hh:]mm:ss`, and every one of those
 *  shapes shows up on a machine that has been awake a while. Parsed
 *  right-to-left, which is the only reading that handles all four without a
 *  branch per shape. */
function cpuSeconds(time: string): number {
  const [head = "0", rest = ""] = time.includes("-") ? time.split("-") : ["0", time];
  const parts = rest.split(":").map(Number).reverse();
  const [s = 0, m = 0, h = 0] = parts;
  return Number(head) * 86_400 + h * 3600 + m * 60 + s;
}

/**
 * Every Chrome renderer, with the tab it is hosting where Chrome says so.
 *
 * Helpers are matched on `--type=renderer` rather than on the executable name:
 * the GPU process, the network service and the utility processes all share the
 * same "Google Chrome Helper" binary, and lumping them in would attribute the
 * GPU process's steady hum to the page.
 */
async function sample(): Promise<Sample[]> {
  const { stdout } = await run("ps", ["-Ao", "pid=,pcpu=,time=,command="]);
  const out: Sample[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.includes("--type=renderer")) continue;
    const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d:.-]+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, pcpu, time, command] = m;
    // Chrome labels renderers it considers extension hosts; everything else is
    // a page. The label is best-effort and only ever used for display.
    const ext = /--extension-process/.test(command ?? "");
    out.push({
      pid: Number(pid),
      cpuSeconds: cpuSeconds(time ?? "0"),
      lifetimePercent: Number(pcpu),
      label: ext ? "renderer (extension)" : "renderer",
    });
  }
  return out;
}

const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

async function main(): Promise<void> {
  const seconds = Number(flag("seconds", "30"));
  const json = process.argv.includes("--json") ? flag("json", "") : "";
  // Zero rather than NaN when absent, so the filter below is a plain equality
  // and there is no third state to reason about.
  const only = Number(flag("pid", "0"));

  const first = await sample();
  const startedAt = Date.now();
  console.log(`sampling ${first.length} Chrome renderers for ${seconds}s…`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const second = await sample();
  const elapsed = (Date.now() - startedAt) / 1000;

  const before = new Map(first.map((s) => [s.pid, s]));
  const rows = second
    // A renderer that appeared mid-window has no baseline to difference
    // against, and charging its whole lifetime to this window would invent a
    // spike. Dropped, and said so below.
    .filter((s) => before.has(s.pid))
    .map((s) => {
      const was = before.get(s.pid);
      const busyPercent = was ? ((s.cpuSeconds - was.cpuSeconds) / elapsed) * 100 : 0;
      return {
        pid: s.pid,
        label: s.label,
        busyPercent: Math.round(busyPercent * 10) / 10,
        lifetimePercent: s.lifetimePercent,
      };
    })
    .filter((s) => only === 0 || s.pid === only)
    .sort((a, b) => b.busyPercent - a.busyPercent);

  // Only meaningful when every renderer is in play; with --pid the difference
  // is almost entirely "renderers we filtered out", which is not news.
  const appeared = only === 0 ? second.length - rows.length : 0;
  if (only !== 0 && rows.length === 0) {
    console.log(`no renderer with pid ${only} — it exited, or the tab was reloaded into a new one`);
    return;
  }
  console.log(`\nover ${elapsed.toFixed(1)}s (busy% is of ONE core, and is a real rate):\n`);
  console.log("   pid  busy%  lifetime%  what");
  // A machine with 74 renderers prints 60 lines of zeroes otherwise, and the
  // rows that matter scroll off the top of whatever is reading this.
  const shown = only === 0 ? rows.filter((r) => r.busyPercent > 0.05).slice(0, 15) : rows;
  for (const r of shown) {
    console.log(
      `${String(r.pid).padStart(6)}  ${String(r.busyPercent).padStart(5)}  ${String(r.lifetimePercent).padStart(9)}  ${r.label}`,
    );
  }
  if (only === 0 && rows.length > shown.length) {
    console.log(`  … ${rows.length - shown.length} more, all under 0.05%`);
  }
  const busiest = rows[0];
  if (busiest) {
    console.log(
      only === 0
        ? `\nbusiest renderer: pid ${busiest.pid} at ${busiest.busyPercent}% of one core`
        : `\npid ${busiest.pid}: ${busiest.busyPercent}% of one core over ${elapsed.toFixed(1)}s`,
    );
  }
  if (appeared > 0) console.log(`(${appeared} renderer(s) started mid-window, omitted)`);

  if (json) {
    writeFileSync(json, JSON.stringify({ elapsed, rows }, null, 2));
    console.log(`wrote ${json}`);
  }
}

void main();
