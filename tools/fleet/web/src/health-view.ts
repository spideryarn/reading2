/**
 * The four or five numbers on Box health that are worth reading first, and the
 * colour each one earns.
 *
 * > Make the Box Health a bit easier for me to read. Perhaps highlight key
 * > stats clearly at the top, and colour stats red/amber/green.
 * >
 * > — Greg, 2026-09-08
 *
 * ## The thresholds are NOT a copy any more, since 2026-09-10
 *
 * They were, and the reason was good: every cutoff is `computeVerdict`'s in
 * tools/fleet/health.ts, and that file opens with `node:child_process`, so even
 * a type-only import makes TypeScript walk a module this browser project has no
 * node types for. The cost was named honestly — *a tile coloured amber beside a
 * badge that says `ok`, because one of the two moved* — and the mitigation was
 * to keep the numbers together in one `THRESHOLDS` object here.
 *
 * **The mitigation did not work, and could not have.** This header used to say
 * "tests/fleet-web.test.tsx pins each boundary; if health.ts's cutoffs change,
 * that test is what should go red". That test pins the *tile* at the literal
 * `0.15` and never calls `computeVerdict` — the name appears in it only in
 * comments — so moving health.ts's literal left the suite green and the page
 * contradicting itself.
 *
 * The premise is what has changed rather than the reasoning:
 * `tools/fleet/resource-policy.ts` is a **leaf with no imports at all**, so it
 * costs this project nothing to import, the way `zones.ts`,
 * `attempt-clock.ts` and `overseer-claim.ts` already do. `THRESHOLDS` is now
 * that module, re-exported under the name every reader here already uses, and
 * `tests/fleet-resource-policy.test.ts` drives `computeVerdict` at boundaries
 * computed from it — so the two genuinely cannot drift.
 *
 * ## What a tile must never do
 *
 * **Render a reading nobody could take as a healthy zero.** Each of health.ts's
 * readings is a union with an explicit "I could not tell" arm carrying the
 * tool's own words, and that arm is the whole reason the module exists —
 * *"a missing reading must never collapse into looking healthy"*. So an
 * unreadable stat is violet and says why, a stat that is not in the payload at
 * all produces no tile rather than a zero, and **a reading with no number gets
 * no bar** — an empty track beside a dash is a drawn zero wearing a different
 * shape.
 *
 * ## One direction, and it is "used"
 *
 * > always show X% used rather than 100-X% free
 * >
 * > — Greg, 2026-09-09
 *
 * This page used to mix them: four readings said *used* and memory said *free*,
 * and it was the one whose colour ran the other way. `readHealthStats` now
 * flips memory at the point of display. Its colour is still decided on the
 * collector's original available fraction, which is the whole risk in that
 * flip — see `MEMORY_USED_PERCENT`.
 */

import { LOAD_BAR_CEILING, MEMORY_USED_PERCENT, RESOURCE_POLICY as THRESHOLDS } from "../../resource-policy.js";
import type { Tip } from "./Tooltip";
import type { Tone } from "./view";

/**
 * The cutoffs — **`resource-policy.ts`'s, under the name this file's readers
 * already use.**
 *
 * Read as: at or above `strained` is amber, at or above `critical` is red —
 * except `memoryAvailable`, where the scale runs the other way and *less* is
 * worse. That inversion is exactly the kind of thing a shared constant hides,
 * so the memory reader below states its comparison out loud rather than looping
 * over this table.
 *
 * An alias rather than a rename because a dozen call sites and three tooltip
 * strings say `THRESHOLDS`, and a rename would have made the diff that removes
 * a duplication look like a diff that moves a feature. The evidence for each
 * number is on the policy module, which is the only place it now lives.
 */
export { LOAD_BAR_CEILING, MEMORY_USED_PERCENT, THRESHOLDS };

/**
 * The little track under a tile's number: how full or busy this one is, at a
 * glance, with the cutoffs drawn on it.
 *
 * > if possible show something like a progress bar to indicate visually how
 * > full/busy things are
 * >
 * > — Greg, 2026-09-09
 *
 * **The ticks are not decoration.** Swap at 37% looks half full and is nowhere
 * near its 90% cutoff; a bare bar invites exactly that misread, so every bar
 * carries the same warning boundaries the chart below it draws as bands, from
 * the same constants. IO wait has only amber because its critical state also
 * requires active swapping, which one tick on one numeric axis cannot express.
 */
export type StatBar = {
  /** How far along the track the fill goes, 0–1. Already clipped. */
  fill: number;
  /** The value ran off the end of the track, and the track must say so. */
  over: boolean;
  /** Where amber and (if the reading has one) red begin, 0–1 along the track. */
  marks: number[];
};

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
  /**
   * **ABSENT WHENEVER THERE IS NO NUMBER**, which is not the same as a bar at
   * zero: a reading that could not be taken, and a box with no swap at all,
   * both get a tile with no track under it rather than an empty one.
   */
  bar?: StatBar;
};

/** A bar out of 100%, with its cutoffs as fractions of the same track. */
function percentBar(percent: number, marks: number[]): StatBar {
  return { fill: Math.min(Math.max(percent, 0), 100) / 100, over: percent > 100, marks: marks.map((m) => m / 100) };
}

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
      how: `Equal to the core count is busy, not broken. Amber past ${THRESHOLDS.loadRatio.strained}× the cores and red past ${THRESHOLDS.loadRatio.critical}× — the same cutoffs the collector's verdict uses. The bar runs to ${LOAD_BAR_CEILING}× the cores, which is the chart's axis below, so the two are read the same way.`,
    };
    if (load["kind"] === "value") {
      const load1 = numberAt(load, "load1");
      const ratio = numberAt(load, "ratio1");
      const cores = numberAt(load, "cores");
      out.push({
        key: "load",
        label: "Load",
        /* Ratio is the number that earns the tone and the one the bar measures.
           Keeping raw load as the headline made a 6%-full bar sit under "8.0":
           both true, but not the one-number glance Greg asked the bar to be. */
        value: ratio === null ? "—" : `${ratio.toFixed(1)}×`,
        sub: load1 === null || cores === null ? "raw load or cores unknown" : `${load1.toFixed(1)} across ${cores} cores`,
        tone:
          ratio === null
            ? "unknown"
            : ratio > THRESHOLDS.loadRatio.critical
              ? "alarm"
              : ratio > THRESHOLDS.loadRatio.strained
                ? "needs"
                : "work",
        tip,
        /* The one bar that is not a percentage of anything: load has no
           ceiling, so the track borrows the chart's fixed axis rather than
           inventing a second one. `ratio === null` and there is no bar — a
           tile that could not read its ratio must not draw a floor. */
        ...(ratio === null
          ? {}
          : {
              bar: percentBar((ratio / LOAD_BAR_CEILING) * 100, [
                (THRESHOLDS.loadRatio.strained / LOAD_BAR_CEILING) * 100,
                (THRESHOLDS.loadRatio.critical / LOAD_BAR_CEILING) * 100,
              ]),
            }),
      });
    } else {
      out.push(unreadable("load", "Load", String(load["why"] ?? "no reason given"), tip));
    }
  }

  const memory = health["memory"];
  if (isRecord(memory)) {
    const tip: Tip = {
      head: "Memory used",
      what: "How much RAM is in use or unavailable, as a share of the total — the complement of what Linux estimates it could still hand out.",
      how: `The other side of this number is 'available', not simply 'free': Linux estimates how much memory it could give a new process without swapping, including reclaimable cache. Amber around ${MEMORY_USED_PERCENT.strained}% and red around ${MEMORY_USED_PERCENT.critical}% — the exact cutoffs use the collector's measured available fraction, so its judgement cannot drift when this displayed number is rounded.`,
    };
    if (memory["kind"] === "value") {
      const fraction = numberAt(memory, "availableFraction");
      const availableBytes = numberAt(memory, "availableBytes");
      const totalBytes = numberAt(memory, "totalBytes");
      /* **THE FLIP IS FOR THE EYE, NOT FOR THE VERDICT.** `usedPercent` is what
         is drawn; `fraction` is what is judged, in the collector's own
         direction — see MEMORY_USED_PERCENT for the exact number where those
         two stop agreeing. */
      const usedPercent = fraction === null ? null : 100 - fraction * 100;
      out.push({
        key: "memory",
        label: "Memory used",
        value: usedPercent === null ? "—" : `${Math.round(usedPercent)}%`,
        sub:
          availableBytes === null || totalBytes === null
            ? "in use or unavailable"
            : `${formatBytes(totalBytes - availableBytes)} of ${formatBytes(totalBytes)} in use`,
        tone:
          fraction === null
            ? "unknown"
            : fraction < THRESHOLDS.memoryAvailable.critical
              ? "alarm"
              : fraction < THRESHOLDS.memoryAvailable.strained
                ? "needs"
                : "work",
        tip,
        ...(usedPercent === null
          ? {}
          : { bar: percentBar(usedPercent, [MEMORY_USED_PERCENT.strained, MEMORY_USED_PERCENT.critical]) }),
      });
    } else {
      out.push(unreadable("memory", "Memory used", String(memory["why"] ?? "no reason given"), tip));
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
           of one thing to read. And no bar — an empty track under "none" is a
           swap file that is 0% full, which is a different claim. */
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
        ...(fraction === null
          ? {}
          : {
              bar: percentBar(fraction * 100, [
                THRESHOLDS.swapUsed.strained * 100,
                THRESHOLDS.swapUsed.critical * 100,
              ]),
            }),
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
      const usedKiB = numberAt(disk, "usedKiB");
      const totalKiB = numberAt(disk, "totalKiB");
      out.push({
        key: "disk",
        label: "Disk used",
        value: percent === null ? "—" : `${Math.round(percent)}%`,
        /* Used of total, not free of total: Greg's rule applies to the sub-line
           as much as to the number, and a tile that said "52%" over "139 GiB
           free" made the reader hold both directions at once. `df`'s own
           percent and its used/total do not always agree to the digit —
           reserved blocks — so the percent stays the collector's and this is
           only the size beside it. */
        sub:
          usedKiB === null || totalKiB === null
            ? "on /"
            : `${formatKiB(usedKiB)} of ${formatKiB(totalKiB)} on /`,
        tone:
          percent === null
            ? "unknown"
            : percent >= THRESHOLDS.diskUsed.critical
              ? "alarm"
              : percent >= THRESHOLDS.diskUsed.strained
                ? "needs"
                : "work",
        tip,
        ...(percent === null
          ? {}
          : { bar: percentBar(percent, [THRESHOLDS.diskUsed.strained, THRESHOLDS.diskUsed.critical]) }),
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
        /* **THE BAR ALWAYS MEASURES THE BIG NUMBER — so this tile loses its bar
           on the turns when the big number is a word.**
           The two facts here are a percentage and an event, and only one has a
           length. Drawn together, a box swapping hard with 0% IO wait showed an
           empty track under an amber "swapping", which reads as *nothing is
           wrong* in the one shape a glance takes at face value. GPT Sol raised
           it as ambiguous; an empty bar beside an alarm is worse than no bar.
           The cutoff it carries is thrashing alone: the red on this reading
           needs the event as well, which a mark on one axis cannot say — the
           chart's IO-wait series stops at amber for the same reason. */
        ...(wa === null || swapping ? {} : { bar: percentBar(wa, [THRESHOLDS.ioWait.thrashing]) }),
      });
    } else if (activity["kind"] === "skipped") {
      out.push({ key: "swapActivity", label: "Swap & IO", value: "—", sub: "not sampled", tone: "idle", tip });
    } else {
      out.push(unreadable("swapActivity", "Swap & IO", String(activity["why"] ?? "no reason given"), tip));
    }
  }

  return out;
}
