/**
 * Box health, for a "Box health" mode on the fleet dashboard.
 *
 * WHY THIS EXISTS. On 2026-09-08 this box hit load average 391 on 16 cores,
 * RAM 28/30Gi, swap 100% full, and the OOM killer fired — caused by 18
 * concurrent test suites holding ~14.3GB. Nobody saw it coming because nobody
 * was looking. This module is the looking. The survey and its reading rules
 * are docs/reusable/diagnose-box-resources.md; do not restate its reasoning
 * here, cite it.
 *
 * THE SPLIT IS THE WHOLE TESTABILITY STORY. `collectHealth` shells out and
 * does nothing else; every `parse*` function is pure — string in, typed
 * reading out — so it can be tested against fixtures captured from the real
 * box (tests/fixtures/fleet-health/) without a shell in the test run. Follow
 * the pattern in tools/fleet/pane.ts (`parsePane` vs `capturePane`), not a
 * mock of `execFileSync`.
 *
 * NO IMPORT SIDE EFFECTS: nothing at module scope runs a command. Only calling
 * `collectHealth()` does.
 *
 * A ZERO MUST NEVER MEAN "HEALTHY". Every reading is a discriminated union
 * with a `kind: "unknown"` arm carrying why, so a command that fails or a
 * format that shifts becomes a visible "could not tell" rather than a 0 that
 * renders as calm — the exact collapse docs/reusable/silent-success.md is
 * about, and the reason `collect.ts` and `status.ts` in this same directory
 * do it for sessions and status.
 */
import { execFileSync } from "node:child_process";

import { RESOURCE_POLICY } from "./resource-policy.js";

// ---------------------------------------------------------------------------
// Readings: one discriminated union per measurement, each with an explicit
// "I could not tell" arm. `why` is always the tool's own words (a caught
// error's message, or a description of what did not parse), because "could
// not say: swapon: not found" is something a person can act on and "unknown"
// alone is a shrug — the same rule status.ts follows for `agentsWhy`.
// ---------------------------------------------------------------------------

export type LoadReading =
  | {
      kind: "value";
      /** 1-, 5- and 15-minute load averages, straight from `uptime`. */
      load1: number;
      load5: number;
      load15: number;
      /** From `nproc`, so the caller does not have to divide twice. */
      cores: number;
      /** load1 / cores. Below 1 is idle-ish, above 1 is busy, several times over is oversubscribed. */
      ratio1: number;
    }
  | { kind: "unknown"; why: string };

/**
 * BYTES, and the name says so — it did not, and the page drew "10298 GiB of
 * 31337 GiB" on a 32 GB box.
 *
 * The source is `free -b` and `swapon --bytes`, chosen so no unit suffix has to
 * be parsed; the fields were then named `…KiB` anyway, and a renderer that
 * multiplied by 1024 was doing the only sensible thing with the name it was
 * given. Disk really is KiB (`df -k`) and `rssKiB` really is KiB (`ps`), which
 * is why this could not be fixed by picking one convention: two of the four
 * readings genuinely disagree with the other two, so each one carries its unit
 * in its name. Found in a browser, 2026-09-08 — no test could have, because
 * every test asserted the parse against the same wrong name.
 */
export type MemoryReading =
  | {
      kind: "value";
      totalBytes: number;
      /**
       * `available`, NOT `free`. The doc is emphatic: Linux spends idle RAM on
       * cache and hands it back on demand, so `free` near zero is normal and
       * `available` is the number that means something. Using `free` here
       * would be exactly the kind of "confidently wrong number" the doc warns
       * about — the box would look starved when it is merely caching well.
       */
      availableBytes: number;
      /** availableBytes / totalBytes, for the verdict and for a bar on the page. */
      availableFraction: number;
    }
  | { kind: "unknown"; why: string };

export type SwapReading =
  | {
      kind: "value";
      totalBytes: number;
      usedBytes: number;
      /** usedBytes / totalBytes. "Swap is a cliff, not a slope" — see the verdict. */
      usedFraction: number;
      /** Per-file breakdown from `swapon --show`, e.g. two swap files after mitigation. */
      areas: number;
    }
  /** `swapon --show` printed nothing: no swap is configured. Not the same as unknown. */
  | { kind: "none" }
  | { kind: "unknown"; why: string };

/** KiB, genuinely: the source is `df -k`. Not a slip; see MemoryReading above. */
export type DiskReading =
  | { kind: "value"; totalKiB: number; usedKiB: number; availableKiB: number; usePercent: number }
  | { kind: "unknown"; why: string };

export type SwapActivityReading =
  | {
      kind: "value";
      /** KiB/s swapped in / out, from the last real sample (the first vmstat line is a since-boot average, and is discarded). */
      siKBs: number;
      soKBs: number;
      /** Percent of CPU time waiting on IO. High `wa` alongside load means disk-bound, not CPU-bound — see the doc. */
      waPercent: number;
      /** true when si or so is non-zero on the sampled line: pages are moving to/from swap right now. */
      activelySwapping: boolean;
    }
  /** The caller opted out (see `collectHealth`'s `includeSwapActivity`) — not a failure. */
  | { kind: "skipped" }
  | { kind: "unknown"; why: string };

export type MemoryGroupKind = "vitest" | "vite" | "chrome" | "node" | "other";

export type MemoryGroup = { kind: MemoryGroupKind; procs: number; rssKiB: number };

export type AttributionReading =
  | {
      kind: "value";
      /** Sorted by rssKiB descending, so the page can show the biggest cause first. */
      groups: MemoryGroup[];
    }
  | { kind: "unknown"; why: string };

export type HealthLevel = "ok" | "strained" | "critical" | "unknown";

/**
 * The verdict. `unknown` is a fourth arm beyond the three the caller asked
 * for, and that is deliberate, not scope creep: this module's own rule is
 * that a missing reading must never collapse into looking healthy, and a
 * three-arm verdict computed while every underlying reading failed would do
 * exactly that — "ok" would be a lie of the same shape as the zero this file
 * exists to refuse. `reasons` always has at least one entry explaining the
 * level, including for `ok` ("load, memory and swap all look fine").
 */
export type Verdict = { level: HealthLevel; reasons: string[] };

export type HealthReport = {
  load: LoadReading;
  memory: MemoryReading;
  swap: SwapReading;
  disk: DiskReading;
  swapActivity: SwapActivityReading;
  attribution: AttributionReading;
  verdict: Verdict;
  collectedAt: string;
  tookMs: number;
};

// ---------------------------------------------------------------------------
// Pure parsers. No `execFileSync`, no `Date.now()`, no I/O — string in, a
// Reading out. Tested against tests/fixtures/fleet-health/ in
// tests/fleet-health.test.ts.
// ---------------------------------------------------------------------------

/**
 * `uptime`'s load averages, joined with `nproc`'s core count.
 *
 * Takes `cores` already parsed rather than re-parsing `nproc` output itself,
 * so this function has exactly one job. The regex looks for "load average:"
 * rather than splitting on commas from the end, because `uptime`'s prefix
 * ("up 2 days, 1:02, 4 users,") varies in comma count across boxes and
 * uptimes, and splitting from the end would silently pick up the wrong
 * numbers on a box that has been up under a minute.
 */
export function parseLoad(uptimeOut: string, cores: number): LoadReading {
  if (!Number.isFinite(cores) || cores <= 0) {
    return { kind: "unknown", why: `nproc did not report a usable core count: ${JSON.stringify(cores)}` };
  }
  const m = uptimeOut.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  if (!m) return { kind: "unknown", why: `uptime output had no "load average:" section: ${uptimeOut.trim()}` };
  const [load1, load5, load15] = [m[1], m[2], m[3]].map(Number) as [number, number, number];
  if (![load1, load5, load15].every(Number.isFinite)) {
    return { kind: "unknown", why: `uptime's load average numbers did not parse: ${m[0]}` };
  }
  return { kind: "value", load1, load5, load15, cores, ratio1: load1 / cores };
}

/** `nproc`'s stdout to a core count, or `unknown` for anything that is not a positive integer. */
export function parseNproc(nprocOut: string): number | null {
  const n = Number(nprocOut.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * `free -b`'s Mem row to totals and `available`.
 *
 * Uses `-b` (exact bytes) rather than the doc's survey-friendly `-h`, because
 * a collector needs a number to divide, not a human-rounded string with a
 * unit suffix to re-parse (`16Gi` vs `16G` is its own small trap). The
 * *column* read is still exactly the doc's point: `available`, never `free`.
 */
export function parseMemory(freeOut: string): MemoryReading {
  const line = freeOut.split("\n").find((l) => l.startsWith("Mem:"));
  if (!line) return { kind: "unknown", why: `free -b output had no "Mem:" line: ${freeOut.trim()}` };
  const cols = line.trim().split(/\s+/).slice(1).map(Number);
  // total used free shared buff/cache available — `available` is the 6th column.
  const totalBytes = cols[0];
  const availableBytes = cols[5];
  if (
    totalBytes === undefined ||
    availableBytes === undefined ||
    ![totalBytes, availableBytes].every(Number.isFinite)
  ) {
    return { kind: "unknown", why: `free -b's Mem line did not have 6 numeric columns: ${line.trim()}` };
  }
  if (totalBytes <= 0) return { kind: "unknown", why: `free -b reported a non-positive total: ${line.trim()}` };
  return { kind: "value", totalBytes, availableBytes, availableFraction: availableBytes / totalBytes };
}

/**
 * `swapon --show --bytes` to total, used and area count.
 *
 * Empty output is a real answer ("no swap configured"), distinct from a
 * failure — a box that never had swap should not render the same as a box
 * whose `swapon` broke. `--bytes` avoids the same unit-suffix trap as
 * `parseMemory`.
 */
export function parseSwap(swaponOut: string): SwapReading {
  const lines = swaponOut
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("NAME"));
  if (lines.length === 0) return { kind: "none" };
  let totalBytes = 0;
  let usedBytes = 0;
  for (const line of lines) {
    const cols = line.split(/\s+/);
    // NAME TYPE SIZE USED PRIO
    const size = Number(cols[2]);
    const used = Number(cols[3]);
    if (!Number.isFinite(size) || !Number.isFinite(used)) {
      return { kind: "unknown", why: `swapon --show --bytes had a non-numeric SIZE/USED column: ${line}` };
    }
    totalBytes += size;
    usedBytes += used;
  }
  if (totalBytes <= 0) return { kind: "unknown", why: `swapon --show --bytes summed to a non-positive total` };
  return { kind: "value", totalBytes, usedBytes, usedFraction: usedBytes / totalBytes, areas: lines.length };
}

/** `df -k /` to totals. `-k` for the same reason as `-b` above: exact numbers, no suffix to re-parse. */
export function parseDisk(dfOut: string): DiskReading {
  const lines = dfOut.split("\n").filter((l) => l.trim().length > 0);
  const line = lines[1]; // header, then exactly one filesystem line for a single `df -k /`
  if (!line) return { kind: "unknown", why: `df -k / had no data line: ${dfOut.trim()}` };
  const cols = line.trim().split(/\s+/);
  const totalKiB = Number(cols[1]);
  const usedKiB = Number(cols[2]);
  const availableKiB = Number(cols[3]);
  const usePercent = cols[4] ? Number(cols[4].replace("%", "")) : Number.NaN;
  if (![totalKiB, usedKiB, availableKiB, usePercent].every(Number.isFinite)) {
    return { kind: "unknown", why: `df -k / line did not have the expected numeric columns: ${line}` };
  }
  return { kind: "value", totalKiB, usedKiB, availableKiB, usePercent };
}

/**
 * `vmstat 1 N`'s last sample to si/so/wa.
 *
 * The FIRST data row is an average since boot, not a current reading — using
 * it would be exactly the kind of "confidently wrong number" the doc's traps
 * section is about, just not one it happens to name. Every row after the
 * first is a real 1-second sample, and this takes the last one, which is the
 * freshest.
 */
export function parseSwapActivity(vmstatOut: string): SwapActivityReading {
  const lines = vmstatOut.split("\n").filter((l) => l.trim().length > 0);
  // Two header lines, then N data lines. Need at least one real (non-first) sample.
  const dataLines = lines.slice(2);
  if (dataLines.length < 2) {
    return {
      kind: "unknown",
      why: `vmstat produced ${dataLines.length} data line(s), need at least 2 (the first is a since-boot average): ${vmstatOut.trim()}`,
    };
  }
  const lastLine = dataLines[dataLines.length - 1];
  if (lastLine === undefined) {
    return { kind: "unknown", why: "vmstat's last data line was unexpectedly missing" };
  }
  const cols = lastLine.trim().split(/\s+/).map(Number);
  // r b swpd free buff cache si so bi bo in cs us sy id wa st gu — 18 columns,
  // 0-indexed here. Verified against a real capture rather than trusted from
  // memory: `awk 'NR==2{for(i=1;i<=NF;i++) print i,$i}'` on the header line,
  // because miscounting this list by one silently swaps `wa` for `id` and
  // every reading would still look plausible — the exact shape of trap this
  // module exists to refuse elsewhere.
  const si = cols[6];
  const so = cols[7];
  const wa = cols[15];
  if (si === undefined || so === undefined || wa === undefined || ![si, so, wa].every(Number.isFinite)) {
    return { kind: "unknown", why: `vmstat's last data line did not have the expected 18 numeric columns: ${lastLine}` };
  }
  return { kind: "value", siKBs: si, soKBs: so, waPercent: wa, activelySwapping: si > 0 || so > 0 };
}

/**
 * `ps -eo rss,args --no-headers` grouped by kind, mirroring the doc's own
 * `awk` one-liner (load average vs cores § "Attribute before you touch
 * anything") and extended from its two buckets (vitest/vite/other) to the
 * five this module reports.
 *
 * ORDER MATTERS, in two ways:
 *
 * 1. `vitest` is checked before `vite`, because the string "vitest" contains
 *    "vite" — checking `vite` first would put every vitest worker in the
 *    wrong bucket. Same reasoning as the doc's own one-liner.
 * 2. This groups by matching a keyword ANYWHERE IN THE COMMAND LINE, which
 *    inherits the imprecision the traps section names for `pgrep -f`: a
 *    process whose *arguments* mention a name is not necessarily that
 *    program. Measured on this box while building this fixture —
 *    `npm exec @playwright/mcp … --browser chrome --executable-path
 *    /usr/bin/google-chrome-stable` is an MCP server, not a browser, and it
 *    lands in the `chrome` bucket here for the same reason the doc's
 *    `pgrep -f chrome` overcounted browsers. That is an accepted imprecision
 *    for *attribution* (which asks "what is chrome-flavoured", not "how many
 *    browsers"), not a bug — the doc's own one-liner has the identical
 *    property for "vite"/"vitest". Do not "fix" this by trying to be
 *    precise about program identity; that is a much bigger job (see the
 *    `-C`/`-e` and `ppid == 1` traps) that this attribution pass does not
 *    need.
 *
 * `ps -eo … --no-headers` is used rather than `ps -eo … -C <name>`, so the
 * `-C`-is-silently-ignored-by-`-e` trap does not apply here: there is no
 * `-C` in this command to be overridden.
 */
export function parseAttribution(psOut: string): AttributionReading {
  const lines = psOut.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { kind: "unknown", why: "ps -eo rss,args --no-headers produced no lines" };
  const totals = new Map<MemoryGroupKind, { procs: number; rssKiB: number }>();
  let parsedAny = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const sp = trimmed.indexOf(" ");
    const rssStr = sp === -1 ? trimmed : trimmed.slice(0, sp);
    const args = sp === -1 ? "" : trimmed.slice(sp + 1);
    const rssKiB = Number(rssStr);
    if (!Number.isFinite(rssKiB)) continue; // one bad line does not sink the whole reading; see below
    parsedAny = true;
    const kind: MemoryGroupKind = /vitest/.test(args)
      ? "vitest"
      : /vite/.test(args)
        ? "vite"
        : /chrome/.test(args)
          ? "chrome"
          : /\bnode\b/.test(args)
            ? "node"
            : "other";
    const cur = totals.get(kind) ?? { procs: 0, rssKiB: 0 };
    cur.procs += 1;
    cur.rssKiB += rssKiB;
    totals.set(kind, cur);
  }
  if (!parsedAny) {
    return { kind: "unknown", why: `ps -eo rss,args --no-headers had no line with a numeric rss column: ${lines[0]}` };
  }
  const groups = [...totals.entries()]
    .map(([kind, v]) => ({ kind, procs: v.procs, rssKiB: v.rssKiB }))
    .sort((a, b) => b.rssKiB - a.rssKiB);
  return { kind: "value", groups };
}

// ---------------------------------------------------------------------------
// Verdict.
// ---------------------------------------------------------------------------

/**
 * Turn the six readings into one level and a list of reasons.
 *
 * Thresholds are this module's own judgement call where the doc gives a rule
 * ("a cliff, not a slope") rather than a number, and are named as such below
 * so a future reader can tell "the doc says this" from "we picked this".
 *
 * NEVER "ok" ON SILENCE. If load, memory and swap are all `unknown` — the
 * three the doc treats as the core survey — there is nothing to base "ok" on,
 * and saying "ok" anyway would be the exact zero-reads-as-healthy collapse
 * this whole module exists to prevent. That case reports `unknown`, with a
 * reason for each reading that could not be read. Any other reading
 * (`disk`, `swapActivity`, `attribution`) that failed on its own does not
 * force `unknown` — it appends a "could not measure" reason so the gap is
 * visible without hiding a verdict the other data can still support.
 */
export function computeVerdict(input: {
  load: LoadReading;
  memory: MemoryReading;
  swap: SwapReading;
  disk: DiskReading;
  swapActivity: SwapActivityReading;
}): Verdict {
  const reasons: string[] = [];
  let level: HealthLevel = "ok";
  /**
   * Every level anything asked for, kept because the final answer needs to know
   * whether `critical` was ever *measured* — and asking `level` cannot tell it.
   *
   * `raise` assigns `level` from inside a closure, so TypeScript's control-flow
   * analysis still believes `level` is the literal `"ok"` it was initialised to
   * and calls a later `level === "critical"` impossible. An array of
   * `HealthLevel` has no such narrowing, and it is the more honest record
   * anyway: `level` is a summary, this is what was actually observed.
   */
  const raised: HealthLevel[] = [];
  const raise = (next: HealthLevel, reason: string) => {
    const order: HealthLevel[] = ["ok", "strained", "critical", "unknown"];
    if (order.indexOf(next) > order.indexOf(level)) level = next;
    raised.push(next);
    reasons.push(reason);
  };

  const coreReadable = input.load.kind === "value" || input.memory.kind === "value" || input.swap.kind === "value";

  if (input.load.kind === "unknown") {
    reasons.push(`could not measure load: ${input.load.why}`);
  } else {
    // "Equal to cores is busy; several times cores is oversubscribed." — the
    // doc's own wording, read as a multiplier in `RESOURCE_POLICY.loadRatio`,
    // which is also what the tile and the chart's bands compare against.
    const { strained, critical } = RESOURCE_POLICY.loadRatio;
    if (input.load.ratio1 > critical) raise("critical", `load average ${input.load.load1.toFixed(1)} is over ${critical}x the ${input.load.cores} cores (ratio ${input.load.ratio1.toFixed(1)})`);
    else if (input.load.ratio1 > strained) raise("strained", `load average ${input.load.load1.toFixed(1)} is over ${strained}x the ${input.load.cores} cores (ratio ${input.load.ratio1.toFixed(1)})`);
  }

  if (input.memory.kind === "unknown") {
    reasons.push(`could not measure memory: ${input.memory.why}`);
  } else {
    // "available near zero" per the doc. The exact fractions are this project's
    // own and live in `RESOURCE_POLICY.memoryAvailable`, which is the same
    // object the tile and the chart colour themselves from.
    //
    // **THE COMPARISON IS ON `availableFraction`; ONLY THE SENTENCE FLIPPED.**
    // Greg, 2026-09-09: *"always show X% used rather than 100-X% free"* — and
    // these reasons are read on the dashboard's verdict card, beside five tiles
    // that now all say "used", so a reason phrased as what is left was the last
    // place on that page a reader had to turn a number round in their head. The
    // available figure stays in brackets because it is the measured one and the
    // one the cutoff is written against.
    if (input.memory.availableFraction < RESOURCE_POLICY.memoryAvailable.critical) raise("critical", `memory is ${(100 - input.memory.availableFraction * 100).toFixed(1)}% used — only ${(input.memory.availableFraction * 100).toFixed(1)}% available, near zero`);
    else if (input.memory.availableFraction < RESOURCE_POLICY.memoryAvailable.strained) raise("strained", `memory is ${(100 - input.memory.availableFraction * 100).toFixed(1)}% used — ${(input.memory.availableFraction * 100).toFixed(1)}% available`);
  }

  if (input.swap.kind === "unknown") {
    reasons.push(`could not measure swap: ${input.swap.why}`);
  } else if (input.swap.kind === "value") {
    // "Swap is a cliff, not a slope. Some swap used is normal. ALL of it used
    // means the next allocation fails and the OOM killer picks a victim." —
    // the doc, verbatim in spirit. So this is a step function, not a ramp:
    // nothing below `RESOURCE_POLICY.swapUsed.strained` raises the level on
    // swap fill alone. (This comment said "95%" until 2026-09-10, against code
    // that has compared 90% since it was written — a number in prose beside the
    // number it describes, drifting where nothing could see it. That is the
    // whole argument for the constants being somewhere a comment can cite.)
    if (input.swap.usedFraction >= RESOURCE_POLICY.swapUsed.critical) raise("critical", `swap is ${(input.swap.usedFraction * 100).toFixed(0)}% full — at the cliff the doc warns about, next allocation can trigger the OOM killer`);
    else if (input.swap.usedFraction >= RESOURCE_POLICY.swapUsed.strained) raise("strained", `swap is ${(input.swap.usedFraction * 100).toFixed(0)}% full — approaching the cliff`);
  }
  // swap.kind === "none" contributes nothing: no swap configured is not itself a strain signal.

  if (input.swapActivity.kind === "value") {
    // Actively swapping is a live signal independent of how full swap is —
    // pages are moving right now. Combined with high `wa` (doc: "high wa =
    // thrashing"), that is a stronger signal than either alone.
    const thrashing = input.swapActivity.waPercent >= RESOURCE_POLICY.ioWait.thrashing;
    if (input.swapActivity.activelySwapping && thrashing) {
      raise("critical", `actively swapping (si ${input.swapActivity.siKBs}, so ${input.swapActivity.soKBs} KB/s) with ${input.swapActivity.waPercent}% IO wait — thrashing`);
    } else if (input.swapActivity.activelySwapping) {
      raise("strained", `actively swapping (si ${input.swapActivity.siKBs}, so ${input.swapActivity.soKBs} KB/s)`);
    } else if (thrashing) {
      raise("strained", `${input.swapActivity.waPercent}% IO wait with no swap movement — likely disk-bound, not CPU-bound (see the doc's load-vs-wa reading rule)`);
    }
  } else if (input.swapActivity.kind === "unknown") {
    reasons.push(`could not measure swap activity: ${input.swapActivity.why}`);
  }
  // swapActivity.kind === "skipped" contributes nothing: the caller opted out, not a failure.

  if (input.disk.kind === "unknown") {
    reasons.push(`could not measure disk: ${input.disk.why}`);
  } else {
    // The doc's survey lists disk but gives no numeric reading rule for it;
    // `RESOURCE_POLICY.diskUsed` is ordinary sysadmin defaults, not from the doc.
    if (input.disk.usePercent >= RESOURCE_POLICY.diskUsed.critical) raise("critical", `/ is ${input.disk.usePercent}% full`);
    else if (input.disk.usePercent >= RESOURCE_POLICY.diskUsed.strained) raise("strained", `/ is ${input.disk.usePercent}% full`);
  }

  if (!coreReadable) {
    // Load, memory AND swap all failed: there is no basis for any of "ok",
    // "strained" or "critical", so say so rather than default to the first.
    //
    // BUT UNCERTAINTY MAY ADD DOUBT AND MAY NEVER ERASE A BAD READING SOMEBODY
    // MANAGED TO TAKE. The disk comes from `df`, a different command that can
    // succeed while all three of these fail — and this used to relabel a
    // known-critical disk as `unknown`, which the new-session route then read
    // as "no reason not to start another agent". GPT Sol's F12.
    //
    // `measured` is a separate binding rather than a test on `level` because
    // the two are different questions and were sharing one variable: `level`
    // holds HOW BAD IT IS, and this block is about WHETHER WE COULD TELL. That
    // conflation is also why `raise`'s order array puts `unknown` above
    // `critical` — harmless while nothing raises to unknown, and exactly the
    // wrong ranking the moment something does.
    reasons.unshift("could not establish the core reading (load, memory and swap all failed) — this is not the same as the box being fine");
    return { level: raised.includes("critical") ? "critical" : "unknown", reasons };
  }
  if (reasons.length === 0) {
    reasons.push("load, memory and swap all look fine");
  }

  return { level, reasons };
}

// ---------------------------------------------------------------------------
// Shelling out. Everything above this line is pure and tested against
// fixtures; everything below is the one place that runs a command.
// ---------------------------------------------------------------------------

/** Runs one command, returning its stdout or an `unknown`-shaped reason. Never throws. */
function run(cmd: string, args: string[]): { ok: true; out: string } | { ok: false; why: string } {
  try {
    const out = execFileSync(cmd, args, { encoding: "utf8", timeout: 5_000, maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, out };
  } catch (err) {
    // Covers: binary missing (ENOENT), non-zero exit, and the 5s timeout —
    // all indistinguishable to the caller and all "I could not tell", never a
    // reading of 0.
    const why = err instanceof Error ? err.message : String(err);
    return { ok: false, why };
  }
}

export type CollectHealthOptions = {
  /**
   * `vmstat 1 3` takes ~3 seconds (the doc's own number) because it has to
   * wait out two 1-second sampling intervals — it is not a fixed cost like
   * every other command here, which all return in well under 100ms. That is
   * fine for an on-demand check; on a box that is ALREADY thrashing and is
   * being polled every minute by a dashboard, 3 extra seconds of a synchronous
   * child process is a cost worth being able to turn off. Default true
   * (correctness first); a per-minute poller can pass `false` and fall back to
   * the load/memory/swap-fullness signals, which are all sub-100ms.
   */
  includeSwapActivity?: boolean;
};

/**
 * Run the whole survey and return a typed report plus a verdict.
 *
 * Each command is run and parsed independently — one failing (missing
 * binary, non-zero exit, a format that shifted) never prevents the others
 * from being read, and never becomes a 0 in the one that failed. This
 * function is the only place in the module that touches the outside world;
 * everything it calls above is pure and importable without side effects.
 */
export function collectHealth(options: CollectHealthOptions = {}): HealthReport {
  const startedAt = Date.now();
  const includeSwapActivity = options.includeSwapActivity ?? true;

  const uptimeRes = run("uptime", []);
  const nprocRes = run("nproc", []);
  const cores = nprocRes.ok ? parseNproc(nprocRes.out) : null;
  const load: LoadReading = !uptimeRes.ok
    ? { kind: "unknown", why: `uptime failed: ${uptimeRes.why}` }
    : !nprocRes.ok
      ? { kind: "unknown", why: `nproc failed: ${nprocRes.why}` }
      : cores === null
        ? { kind: "unknown", why: `nproc's output did not parse as a positive integer: ${JSON.stringify(nprocRes.out)}` }
        : parseLoad(uptimeRes.out, cores);

  const freeRes = run("free", ["-b"]);
  const memory: MemoryReading = freeRes.ok ? parseMemory(freeRes.out) : { kind: "unknown", why: `free failed: ${freeRes.why}` };

  const swaponRes = run("swapon", ["--show", "--bytes"]);
  const swap: SwapReading = swaponRes.ok ? parseSwap(swaponRes.out) : { kind: "unknown", why: `swapon failed: ${swaponRes.why}` };

  const dfRes = run("df", ["-k", "/"]);
  const disk: DiskReading = dfRes.ok ? parseDisk(dfRes.out) : { kind: "unknown", why: `df failed: ${dfRes.why}` };

  let swapActivity: SwapActivityReading;
  if (!includeSwapActivity) {
    swapActivity = { kind: "skipped" };
  } else {
    // "1 2" (one second apart, two samples): the first line is a since-boot
    // average and is discarded by parseSwapActivity, so two samples are the
    // minimum that yields one real reading — about 1s, not the doc survey's
    // 3s from "1 3". Cheaper for a per-minute poll; still a live sample.
    const vmstatRes = run("vmstat", ["1", "2"]);
    swapActivity = vmstatRes.ok ? parseSwapActivity(vmstatRes.out) : { kind: "unknown", why: `vmstat failed: ${vmstatRes.why}` };
  }

  const psRes = run("ps", ["-eo", "rss,args", "--no-headers"]);
  const attribution: AttributionReading = psRes.ok
    ? parseAttribution(psRes.out)
    : { kind: "unknown", why: `ps failed: ${psRes.why}` };

  const verdict = computeVerdict({ load, memory, swap, disk, swapActivity });

  return {
    load,
    memory,
    swap,
    disk,
    swapActivity,
    attribution,
    verdict,
    collectedAt: new Date().toISOString(),
    tookMs: Date.now() - startedAt,
  };
}
