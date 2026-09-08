/**
 * The four or five numbers on Box health that are worth reading first, and the
 * colour each one earns.
 *
 * > Make the Box Health a bit easier for me to read. Perhaps highlight key
 * > stats clearly at the top, and colour stats red/amber/green.
 * >
 * > — Greg, 2026-09-08
 *
 * ## The thresholds are a COPY, and that is a deliberate cost
 *
 * Every cutoff below is `computeVerdict`'s in tools/fleet/health.ts, restated
 * rather than imported — that file opens with `node:child_process`, so a
 * type-only import still makes TypeScript walk a module this browser project
 * has no node types for. It is the same trade view.ts already makes with
 * `triageRank`, and its header says the same thing: *the duplication is the
 * price of the client not importing node modules.*
 *
 * **The failure it buys is specific and worth naming**: a tile coloured amber
 * beside a badge that says `ok`, because one of the two moved. So the numbers
 * are all in `THRESHOLDS` below rather than scattered through the readers, and
 * tests/fleet-web.test.tsx pins each boundary. If health.ts's cutoffs change,
 * that test is what should go red.
 *
 * ## What a tile must never do
 *
 * **Render a reading nobody could take as a healthy zero.** Each of health.ts's
 * readings is a union with an explicit "I could not tell" arm carrying the
 * tool's own words, and that arm is the whole reason the module exists —
 * *"a missing reading must never collapse into looking healthy"*. So an
 * unreadable stat is violet and says why, and a stat that is not in the payload
 * at all produces no tile rather than a zero.
 */

import type { Tip } from "./Tooltip";
import type { Tone } from "./view";

/**
 * The cutoffs, in one place, mirroring `computeVerdict`.
 *
 * Read as: at or above `strained` is amber, at or above `critical` is red —
 * except `memoryAvailable`, where the scale runs the other way and *less* is
 * worse. That inversion is exactly the kind of thing a shared constant hides,
 * so the memory reader states its comparison out loud rather than looping over
 * this table.
 */
export const THRESHOLDS = {
  /** load1 / cores. health.ts: ">2x strained, >4x critical", and the doc names no exact multiplier. */
  loadRatio: { strained: 2, critical: 4 },
  /** availableKiB / totalKiB. health.ts's own cutoffs; the doc only says "near zero". */
  memoryAvailable: { strained: 0.15, critical: 0.05 },
  /** usedKiB / totalKiB. A step function, not a ramp: "swap is a cliff, not a slope". */
  swapUsed: { strained: 0.9, critical: 0.98 },
  /** `df` percent on `/`. Ordinary sysadmin defaults rather than anything from the doc. */
  diskUsed: { strained: 90, critical: 97 },
  /** Percent of CPU time waiting on IO. health.ts treats >=50 with swapping as thrashing. */
  ioWait: { thrashing: 50 },
} as const;

export type Stat = {
  /** React key, and the field it was read from. */
  key: string;
  label: string;
  /** The big number. `—` when it could not be read. */
  value: string;
  /** The line under it: what the number is out of, or why there isn't one. */
  sub: string;
  tone: Tone;
  tip: Tip;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numberAt(source: Record<string, unknown>, key: string): number | null {
  const v = source[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** KiB as the largest unit that leaves a number a person can hold in their head. */
export function formatKiB(kib: number | null): string {
  if (kib === null) return "—";
  if (kib < 1024) return `${Math.round(kib)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${Math.round(mib)} MiB`;
  const gib = mib / 1024;
  return gib < 10 ? `${gib.toFixed(1)} GiB` : `${Math.round(gib)} GiB`;
}

/**
 * Bytes as the largest unit that leaves a number a person can hold in their head.
 *
 * SEPARATE FROM `formatKiB` ON PURPOSE, rather than one function with a unit
 * argument. This panel reads four size fields from two commands that genuinely
 * disagree: `free -b` and `swapon --bytes` give bytes, `df -k` and `ps` give
 * KiB. A single formatter taking a unit is a formatter somebody eventually
 * calls with the wrong one, and the result is not an error — it is
 * "10089 GiB of 31337 GiB" on a box with 32 GB of RAM, drawn confidently.
 *
 * That is not hypothetical: it is what this panel drew on 2026-09-08, because
 * the collector's fields were NAMED `totalKiB` while holding bytes. They are
 * `totalBytes` and `usedBytes` now, so each call site picks its formatter by
 * reading the field name, which is the only check that scales.
 */
export function formatBytes(bytes: number | null): string {
  return formatKiB(bytes === null ? null : bytes / 1024);
}

/** The violet tile a reading that could not be taken gets. */
function unreadable(key: string, label: string, why: string, tip: Tip): Stat {
  return {
    key,
    label,
    value: "—",
    sub: why,
    tone: "unknown",
    /* The card says what the dash means, because a dash beside three coloured
       numbers is the one thing on this panel a reader might take for a zero. */
    tip: { ...tip, how: `This reading could not be taken, which is NOT the same as it being fine. ${tip.how}` },
  };
}

/**
 * The stats, in the order they are worth reading.
 *
 * A field that is absent from the payload produces **no tile**, rather than an
 * empty one: this panel does not own the schema (health.ts does), so a reading
 * that has been renamed should cost a tile and leave the generic view below it
 * telling the truth.
 */
export function readHealthStats(health: unknown): Stat[] {
  if (!isRecord(health)) return [];
  const out: Stat[] = [];

  const load = health["load"];
  if (isRecord(load)) {
    const tip: Tip = {
      head: "Load",
      what: "How many processes are runnable, averaged over the last minute, against the number of cores.",
      how: `Equal to the core count is busy, not broken. Amber past ${THRESHOLDS.loadRatio.strained}× the cores and red past ${THRESHOLDS.loadRatio.critical}× — the same cutoffs the verdict above uses.`,
    };
    if (load["kind"] === "value") {
      const load1 = numberAt(load, "load1");
      const ratio = numberAt(load, "ratio1");
      const cores = numberAt(load, "cores");
      out.push({
        key: "load",
        label: "Load",
        value: load1 === null ? "—" : load1.toFixed(1),
        sub: ratio === null || cores === null ? "cores unknown" : `${ratio.toFixed(1)}× of ${cores} cores`,
        tone:
          ratio === null
            ? "unknown"
            : ratio > THRESHOLDS.loadRatio.critical
              ? "alarm"
              : ratio > THRESHOLDS.loadRatio.strained
                ? "needs"
                : "work",
        tip,
      });
    } else {
      out.push(unreadable("load", "Load", String(load["why"] ?? "no reason given"), tip));
    }
  }

  const memory = health["memory"];
  if (isRecord(memory)) {
    const tip: Tip = {
      head: "Memory available",
      what: "How much RAM the box could hand out right now, as a share of the total.",
      how: `This is 'available', not 'free' — Linux spends idle RAM on cache and hands it back on demand, so 'free' near zero is normal and would be a confidently wrong number. Amber below ${THRESHOLDS.memoryAvailable.strained * 100}%, red below ${THRESHOLDS.memoryAvailable.critical * 100}%.`,
    };
    if (memory["kind"] === "value") {
      const fraction = numberAt(memory, "availableFraction");
      const availableBytes = numberAt(memory, "availableBytes");
      const totalBytes = numberAt(memory, "totalBytes");
      out.push({
        key: "memory",
        label: "Memory free",
        value: fraction === null ? "—" : `${Math.round(fraction * 100)}%`,
        sub:
          availableBytes === null || totalBytes === null
            ? "available, not merely unused"
            : `${formatBytes(availableBytes)} of ${formatBytes(totalBytes)} available`,
        /* Less is worse here, which is why this is spelled out rather than run
           through the same comparison as the others. */
        tone:
          fraction === null
            ? "unknown"
            : fraction < THRESHOLDS.memoryAvailable.critical
              ? "alarm"
              : fraction < THRESHOLDS.memoryAvailable.strained
                ? "needs"
                : "work",
        tip,
      });
    } else {
      out.push(unreadable("memory", "Memory free", String(memory["why"] ?? "no reason given"), tip));
    }
  }

  const swap = health["swap"];
  if (isRecord(swap)) {
    const tip: Tip = {
      head: "Swap used",
      what: "How full the swap files are.",
      how: `Swap is a cliff, not a slope: some swap in use is normal, and ALL of it in use means the next allocation fails and the OOM killer picks a victim. So nothing below ${THRESHOLDS.swapUsed.strained * 100}% counts at all, and ${THRESHOLDS.swapUsed.critical * 100}% is red.`,
    };
    if (swap["kind"] === "none") {
      out.push({
        key: "swap",
        label: "Swap",
        value: "none",
        sub: "no swap configured",
        /* Grey, not green: no swap is not a health reading, it is the absence
           of one thing to read. */
        tone: "idle",
        tip,
      });
    } else if (swap["kind"] === "value") {
      const fraction = numberAt(swap, "usedFraction");
      const usedBytes = numberAt(swap, "usedBytes");
      const totalBytes = numberAt(swap, "totalBytes");
      const areas = numberAt(swap, "areas");
      out.push({
        key: "swap",
        label: "Swap used",
        value: fraction === null ? "—" : `${Math.round(fraction * 100)}%`,
        sub:
          usedBytes === null || totalBytes === null
            ? `across ${areas ?? "?"} swap file${areas === 1 ? "" : "s"}`
            : `${formatBytes(usedBytes)} of ${formatBytes(totalBytes)}`,
        tone:
          fraction === null
            ? "unknown"
            : fraction >= THRESHOLDS.swapUsed.critical
              ? "alarm"
              : fraction >= THRESHOLDS.swapUsed.strained
                ? "needs"
                : "work",
        tip,
      });
    } else {
      out.push(unreadable("swap", "Swap used", String(swap["why"] ?? "no reason given"), tip));
    }
  }

  const disk = health["disk"];
  if (isRecord(disk)) {
    const tip: Tip = {
      head: "Disk used",
      what: "How full the root filesystem is.",
      how: `Amber at ${THRESHOLDS.diskUsed.strained}% and red at ${THRESHOLDS.diskUsed.critical}% — ordinary sysadmin defaults rather than anything measured about this box.`,
    };
    if (disk["kind"] === "value") {
      const percent = numberAt(disk, "usePercent");
      const availableKiB = numberAt(disk, "availableKiB");
      out.push({
        key: "disk",
        label: "Disk used",
        value: percent === null ? "—" : `${Math.round(percent)}%`,
        sub: `${formatKiB(availableKiB)} free on /`,
        tone:
          percent === null
            ? "unknown"
            : percent >= THRESHOLDS.diskUsed.critical
              ? "alarm"
              : percent >= THRESHOLDS.diskUsed.strained
                ? "needs"
                : "work",
        tip,
      });
    } else {
      out.push(unreadable("disk", "Disk used", String(disk["why"] ?? "no reason given"), tip));
    }
  }

  const activity = health["swapActivity"];
  if (isRecord(activity)) {
    const tip: Tip = {
      head: "IO wait",
      what: "The share of CPU time spent waiting on disk, and whether pages are moving to or from swap right now.",
      how: `High IO wait with load means the box is disk-bound rather than CPU-bound. Swapping AND ${THRESHOLDS.ioWait.thrashing}%+ IO wait together is thrashing, which is the state the OOM killer follows.`,
    };
    if (activity["kind"] === "value") {
      const wa = numberAt(activity, "waPercent");
      const si = numberAt(activity, "siKBs");
      const so = numberAt(activity, "soKBs");
      const swapping = activity["activelySwapping"] === true;
      const thrashing = wa !== null && wa >= THRESHOLDS.ioWait.thrashing;
      const waText = wa === null ? "IO wait unknown" : `${Math.round(wa)}% IO wait`;
      out.push({
        key: "swapActivity",
        label: "Swap & IO",
        /* **The headline is whichever fact earned the colour**, and this tile is
           the only one where that is not always the same number. Found in a
           browser pass: the box was swapping with 0% IO wait, so the tile drew
           an amber "0%" over the words "swapping now" — which reads as an alarm
           about a zero. Pages of numbers are read by their big text; when a tile
           goes amber for a reason the big text does not state, the big text is
           what has to change. */
        value: swapping ? "swapping" : wa === null ? "—" : `${Math.round(wa)}%`,
        sub: swapping ? `${waText} · in ${si ?? "?"} / out ${so ?? "?"} KB/s` : `${waText}, not swapping`,
        tone: swapping && thrashing ? "alarm" : swapping || thrashing ? "needs" : "work",
        tip,
      });
    } else if (activity["kind"] === "skipped") {
      out.push({ key: "swapActivity", label: "Swap & IO", value: "—", sub: "not sampled", tone: "idle", tip });
    } else {
      out.push(unreadable("swapActivity", "Swap & IO", String(activity["why"] ?? "no reason given"), tip));
    }
  }

  return out;
}
