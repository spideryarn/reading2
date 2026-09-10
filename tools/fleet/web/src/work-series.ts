/**
 * Turn the work readings carried by health samples into rows on the health
 * chart's existing window, without React and without inventing continuity.
 *
 * **AN EVENT IS KEYED BY ITS SOURCE DISCRIMINANT AND SOURCE TIMESTAMP.**
 * Repeated copies of one `scannedAt`, or one `attemptedAt`, are one
 * observation, never several. A daemon that has stopped producing fresh scans
 * leaves the same checkpoint reading on every later health sample; keying by
 * the carrier sample would turn that single stale observation into an hour of
 * apparent activity. The carrier clocks survive only as evidence that the
 * reading was stale or repeated. Nothing downstream can repair this once rows
 * have been made, so the rule lives and is enforced here.
 *
 * The health client owns validation at the wire boundary. This leaf receives
 * its parsed `HealthSampleView`, so it can project the persisted union without
 * acquiring a second, subtly different validator.
 */
import type { StoredWork, StoredWorkGroup } from "../../wire.js";
import type { HealthSampleView, HistoryView } from "./health-history-client";

/**
 * One five-minute persistence interval, plus a minute for the sequential
 * health survey and ordinary scheduling drift. Reaching farther would make a
 * convenient association look like concurrency; stopping just past one work
 * interval lets either adjacent scan be named with its honest delta.
 */
export const NEARBY_WORK_MS = 6 * 60_000;

/** A phone needs the causes, not an unbounded copy of `ps`'s summary. */
export const PEAK_ATTRIBUTION_GROUPS = 4;

/** The client-side sample after the work envelope has crossed its boundary. */
export type WorkHistorySample = HealthSampleView;

/**
 * Named counterpart of the history arm, so callers need not repeat an
 * `Extract` and no component-specific type leaks into the parser.
 */
export type WorkHistoryView = Extract<HistoryView, { kind: "history" }>;

/** Only the geometry and load finding this projection consumes. */
export type WorkHistoryGeometry = {
  fromMs: number;
  toMs: number;
  series: readonly {
    spec: { key: string };
    worst: { atMs: number; value: number } | null;
  }[];
};

export type WorkScan = {
  /** The work producer's clock. This is where the mark belongs. */
  atMs: number;
  /** Every health sample which carried this one source observation. */
  carrierAtMs: number[];
  firstCarrierAtMs: number;
  panes: { work: number; none: number; cannotTell: number };
  groupsDropped: number;
};

export type WorkGroupObservation = {
  /** `scannedAt`, never the health sample's `atMs`. */
  atMs: number;
  firstCarrierAtMs: number;
  carrierAtMs: number[];
  jobs: number;
  timing: StoredWorkGroup["timing"];
};

export type WorkRow = {
  session: string;
  /** Human label for the recogniser; unknown future ids remain visible verbatim. */
  label: string;
  recogniser: string;
  observations: WorkGroupObservation[];
  /**
   * The observation with the longest producer-measured `ranForMs`. Keeping the
   * complete timing arm means partial evidence stays partial and no measured
   * duration is manufactured for `unknown`.
   */
  longest: { jobs: number; timing: StoredWorkGroup["timing"] };
  /** Null is could-not-tell, not zero milliseconds. */
  observedDurationMs: number | null;
  /** One-based position after sorting by observed duration. */
  rank: number;
};

export type UnavailableWorkObservation = {
  source: Exclude<StoredWork["kind"], "scan">;
  /** That source arm's timestamp, not a sample timestamp. */
  atMs: number;
  why: string;
  firstCarrierAtMs: number;
  carrierAtMs: number[];
};

export type UnavailableReason =
  | { kind: "source"; why: string; observations: number }
  | { kind: "record"; why: string; records: number };

export type PeakAttribution =
  | { kind: "value"; groups: { kind: string; procs: number; rssKiB: number }[]; groupsDropped: number }
  | { kind: "unknown"; why: string };

export type PeakWork =
  | { kind: "none" }
  | {
      kind: "peak";
      /** Timestamp and value of the LOAD sample itself. */
      loadAtMs: number;
      load: number;
      nearestWork:
        | { kind: "nearby"; atMs: number; deltaMs: number; scan: WorkScan }
        | { kind: "none" };
      /** Memory attribution from the same health survey turn, not "at that moment". */
      attribution: PeakAttribution;
    };

type Common = {
  fromMs: number;
  toMs: number;
  peak: PeakWork;
  /** Samples from before the work envelope existed. */
  legacyCarrierSamples: number;
  /** Samples carrying either `not-due` or `due`. */
  trackedCarrierSamples: number;
};

export type WorkHistoryProjection = Common &
  (
    | {
        kind: "no-records";
        reason:
          | "no-health-samples-in-window"
          | "work-retention-newer-than-window"
          | "no-due-turn-in-window"
          | "no-source-events-in-window";
      }
    | {
        kind: "all-unavailable";
        observations: UnavailableWorkObservation[];
        reasons: UnavailableReason[];
      }
    | {
        kind: "empty-scan";
        scans: WorkScan[];
        unavailable: UnavailableWorkObservation[];
        reasons: UnavailableReason[];
        unchangedReadings: UnchangedReading[];
      }
    | {
        kind: "groups";
        rows: WorkRow[];
        scans: WorkScan[];
        emptyScans: WorkScan[];
        unavailable: UnavailableWorkObservation[];
        reasons: UnavailableReason[];
        unchangedReadings: UnchangedReading[];
      }
  );

export type UnchangedReading = {
  /** Source timestamp of the one observation that was carried repeatedly. */
  atMs: number;
  /** Total copies, including the first. */
  copies: number;
  /** Copies immediately following an identical source event. */
  consecutiveCopies: number;
};

type Source =
  | { key: string; kind: "scan"; atMs: number; value: Extract<StoredWork, { kind: "scan" }> }
  | {
      key: string;
      kind: "unavailable";
      atMs: number;
      source: Exclude<StoredWork["kind"], "scan">;
      value: Exclude<StoredWork, { kind: "scan" }>;
    };

type AccumulatedScan = WorkScan & {
  value: Extract<StoredWork, { kind: "scan" }>;
  consecutiveCopies: number;
};

type AccumulatedUnavailable = UnavailableWorkObservation;

function sourceOf(value: StoredWork): Source {
  switch (value.kind) {
    case "scan": {
      const atMs = Date.parse(value.scannedAt);
      return { key: `scan:${atMs}`, kind: "scan", atMs, value };
    }
    case "not-yet-run": {
      const atMs = Date.parse(value.asOf);
      return { key: `not-yet-run:${atMs}`, kind: "unavailable", atMs, source: value.kind, value };
    }
    case "probe-failed": {
      const atMs = Date.parse(value.attemptedAt);
      return { key: `probe-failed:${atMs}`, kind: "unavailable", atMs, source: value.kind, value };
    }
    case "checkpoint-unavailable": {
      const atMs = Date.parse(value.checkedAt);
      return {
        key: `checkpoint-unavailable:${atMs}`,
        kind: "unavailable",
        atMs,
        source: value.kind,
        value,
      };
    }
  }
}

function isInWindow(atMs: number, geometry: WorkHistoryGeometry): boolean {
  return Number.isFinite(atMs) && atMs >= geometry.fromMs && atMs <= geometry.toMs;
}

function durationOf(timing: StoredWorkGroup["timing"]): number | null {
  return timing.kind === "unknown" ? null : timing.longestRanForMs;
}

/** The classifier's deliberately small vocabulary, in reader-facing words. */
export function recogniserLabel(recogniser: string): string {
  switch (recogniser) {
    case "codex-exec":
      return "GPT review or task";
    case "claude-headless":
      return "Headless Claude";
    case "vitest":
      return "Test suite";
    default:
      /* A newer producer must not make its work disappear on an older page. */
      return recogniser;
  }
}

function unavailableReasons(observations: UnavailableWorkObservation[]): UnavailableReason[] {
  const counts = new Map<string, number>();
  for (const item of observations) counts.set(item.why, (counts.get(item.why) ?? 0) + 1);
  return [...counts].map(([why, count]) => ({ kind: "source", why, observations: count }));
}

function readAttribution(sample: WorkHistorySample | undefined): PeakAttribution {
  if (sample === undefined || sample.kind !== "reading") {
    return { kind: "unknown", why: "the peak health sample is not available to read its attribution" };
  }
  const raw = sample.report.attribution;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { kind: "unknown", why: "the peak sample had no attribution reading" };
  }
  const reading = raw as Record<string, unknown>;
  if (reading.kind === "unknown") {
    return {
      kind: "unknown",
      why: typeof reading.why === "string" && reading.why !== ""
        ? reading.why
        : "the collector could not attribute memory and gave no reason",
    };
  }
  if (reading.kind !== "value" || !Array.isArray(reading.groups)) {
    return { kind: "unknown", why: "the peak sample's attribution has a shape this page does not understand" };
  }

  const groups: { kind: string; procs: number; rssKiB: number }[] = [];
  for (const rawGroup of reading.groups) {
    if (typeof rawGroup !== "object" || rawGroup === null || Array.isArray(rawGroup)) {
      return { kind: "unknown", why: "one memory group at the peak has a shape this page does not understand" };
    }
    const group = rawGroup as Record<string, unknown>;
    if (
      typeof group.kind !== "string" ||
      typeof group.procs !== "number" ||
      !Number.isFinite(group.procs) ||
      typeof group.rssKiB !== "number" ||
      !Number.isFinite(group.rssKiB)
    ) {
      return { kind: "unknown", why: "one memory group at the peak has a shape this page does not understand" };
    }
    groups.push({ kind: group.kind, procs: group.procs, rssKiB: group.rssKiB });
  }
  groups.sort((a, b) => b.rssKiB - a.rssKiB || a.kind.localeCompare(b.kind));
  return {
    kind: "value",
    groups: groups.slice(0, PEAK_ATTRIBUTION_GROUPS),
    groupsDropped: Math.max(groups.length - PEAK_ATTRIBUTION_GROUPS, 0),
  };
}

function peakOf(
  view: WorkHistoryView,
  geometry: WorkHistoryGeometry,
  scans: WorkScan[],
): PeakWork {
  const load = geometry.series.find((series) => series.spec.key === "load")?.worst ?? null;
  if (load === null) return { kind: "none" };

  let nearest: WorkScan | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const scan of scans) {
    const distance = Math.abs(scan.atMs - load.atMs);
    /* On an exact tie, the earlier scan wins: it makes the conservative order
       visible in the signed delta and never implies knowledge from the future. */
    if (
      distance < nearestDistance ||
      (distance === nearestDistance && nearest !== null && scan.atMs < nearest.atMs)
    ) {
      nearest = scan;
      nearestDistance = distance;
    }
  }

  const sample = view.samples.find((candidate) => candidate.atMs === load.atMs);
  return {
    kind: "peak",
    loadAtMs: load.atMs,
    load: load.value,
    nearestWork:
      nearest !== null && nearestDistance <= NEARBY_WORK_MS
        ? { kind: "nearby", atMs: nearest.atMs, deltaMs: nearest.atMs - load.atMs, scan: nearest }
        : { kind: "none" },
    attribution: readAttribution(sample),
  };
}

function rowsOf(scans: AccumulatedScan[]): WorkRow[] {
  type Accumulator = Omit<WorkRow, "rank">;
  const rows = new Map<string, Accumulator>();
  for (const scan of scans) {
    for (const group of scan.value.groups) {
      const key = JSON.stringify([group.session, group.recogniser]);
      const observation: WorkGroupObservation = {
        atMs: scan.atMs,
        firstCarrierAtMs: scan.firstCarrierAtMs,
        carrierAtMs: [...scan.carrierAtMs],
        jobs: group.jobs,
        timing: group.timing,
      };
      const found = rows.get(key);
      if (found === undefined) {
        rows.set(key, {
          session: group.session,
          label: recogniserLabel(group.recogniser),
          recogniser: group.recogniser,
          observations: [observation],
          longest: { jobs: group.jobs, timing: group.timing },
          observedDurationMs: durationOf(group.timing),
        });
        continue;
      }
      found.observations.push(observation);
      const duration = durationOf(group.timing);
      if (
        duration !== null &&
        (found.observedDurationMs === null || duration > found.observedDurationMs)
      ) {
        found.longest = { jobs: group.jobs, timing: group.timing };
        found.observedDurationMs = duration;
      }
    }
  }

  const ranked = [...rows.values()];
  /* This is observed duration, not cost. `ranForMs` is the only duration the
     producer measured; the box does not measure per-job CPU or memory at all,
     and the number of sparse sightings is not continuous time either. */
  ranked.sort((a, b) => {
    if (a.observedDurationMs === null || b.observedDurationMs === null) {
      if (a.observedDurationMs === b.observedDurationMs) {
        return b.observations.length - a.observations.length ||
          a.session.localeCompare(b.session) ||
          a.recogniser.localeCompare(b.recogniser);
      }
      return a.observedDurationMs === null ? 1 : -1;
    }
    if (a.observedDurationMs !== null) {
      const duration = b.observedDurationMs - a.observedDurationMs;
      if (duration !== 0) return duration;
    }
    return b.observations.length - a.observations.length ||
      a.session.localeCompare(b.session) ||
      a.recogniser.localeCompare(b.recogniser);
  });
  return ranked.map((row, index) => ({ ...row, rank: index + 1 }));
}

type CollectedEvents = {
  scansBySource: Map<string, AccumulatedScan>;
  unavailableBySource: Map<string, AccumulatedUnavailable>;
  legacyCarrierSamples: number;
  trackedCarrierSamples: number;
  dueTurns: number;
  sourceEventsOutsideWindow: number;
  unreadableRecords: Map<string, number>;
};

function collectEvents(
  samples: WorkHistorySample[],
  geometry: WorkHistoryGeometry,
): CollectedEvents {
  const collected: CollectedEvents = {
    scansBySource: new Map(),
    unavailableBySource: new Map(),
    legacyCarrierSamples: 0,
    trackedCarrierSamples: 0,
    dueTurns: 0,
    sourceEventsOutsideWindow: 0,
    unreadableRecords: new Map(),
  };
  /* `not-due` is an explicit carrier record, not a new source observation.
     Work reads normally have several of these between them, so repetition is
     measured across consecutive SOURCE events rather than adjacent health
     samples. Otherwise the stale-reading warning would disappear at the real
     five-minute cadence and only work in artificially adjacent fixtures. */
  let previousSourceKey: string | null = null;

  for (const sample of samples) {
    const turn = sample.workTurn;
    if (turn === undefined) {
      collected.legacyCarrierSamples += 1;
      previousSourceKey = null;
      continue;
    }
    collected.trackedCarrierSamples += 1;
    if (turn.kind === "not-due") {
      continue;
    }
    if (turn.kind === "unreadable") {
      collected.unreadableRecords.set(
        turn.why,
        (collected.unreadableRecords.get(turn.why) ?? 0) + 1,
      );
      previousSourceKey = null;
      continue;
    }
    collected.dueTurns += 1;
    const source = sourceOf(turn.result);
    const consecutive = previousSourceKey === source.key;
    previousSourceKey = source.key;
    if (!isInWindow(source.atMs, geometry)) {
      collected.sourceEventsOutsideWindow += 1;
      continue;
    }

    if (source.kind === "scan") {
      const found = collected.scansBySource.get(source.key);
      if (found === undefined) {
        collected.scansBySource.set(source.key, {
          atMs: source.atMs,
          firstCarrierAtMs: sample.atMs,
          carrierAtMs: [sample.atMs],
          panes: source.value.panes,
          groupsDropped: source.value.groupsDropped,
          value: source.value,
          consecutiveCopies: 0,
        });
      } else {
        found.carrierAtMs.push(sample.atMs);
        if (consecutive) found.consecutiveCopies += 1;
      }
      continue;
    }

    const found = collected.unavailableBySource.get(source.key);
    if (found === undefined) {
      collected.unavailableBySource.set(source.key, {
        source: source.source,
        atMs: source.atMs,
        why: source.value.why,
        firstCarrierAtMs: sample.atMs,
        carrierAtMs: [sample.atMs],
      });
    } else {
      found.carrierAtMs.push(sample.atMs);
    }
  }
  return collected;
}

/** Project one already-parsed history window. Pure: no clock, DOM or I/O. */
export function projectWorkHistory(
  view: WorkHistoryView,
  geometry: WorkHistoryGeometry,
): WorkHistoryProjection {
  const collected = collectEvents(view.samples, geometry);

  const accumulatedScans = [...collected.scansBySource.values()].sort((a, b) => a.atMs - b.atMs);
  const scans: WorkScan[] = accumulatedScans.map(({ value: _value, consecutiveCopies: _copies, ...scan }) => scan);
  const unavailable: UnavailableWorkObservation[] = [...collected.unavailableBySource.values()]
    .sort((a, b) => a.atMs - b.atMs);
  const reasons: UnavailableReason[] = [
    ...unavailableReasons(unavailable),
    ...[...collected.unreadableRecords].map(([why, records]) => ({
      kind: "record" as const,
      why,
      records,
    })),
  ];
  const unchangedReadings: UnchangedReading[] = [
    ...accumulatedScans
      .filter((scan) => scan.carrierAtMs.length > 1)
      .map((scan) => ({
        atMs: scan.atMs,
        copies: scan.carrierAtMs.length,
        consecutiveCopies: scan.consecutiveCopies,
      })),
  ].sort((a, b) => a.atMs - b.atMs);
  const common: Common = {
    fromMs: geometry.fromMs,
    toMs: geometry.toMs,
    peak: peakOf(view, geometry, scans),
    legacyCarrierSamples: collected.legacyCarrierSamples,
    trackedCarrierSamples: collected.trackedCarrierSamples,
  };

  if (scans.length === 0 && unavailable.length === 0 && collected.unreadableRecords.size === 0) {
    return {
      ...common,
      kind: "no-records",
      reason:
        view.samples.length === 0
          ? "no-health-samples-in-window"
          : collected.sourceEventsOutsideWindow > 0
          ? "no-source-events-in-window"
          : collected.dueTurns === 0 && collected.trackedCarrierSamples > 0
            ? "no-due-turn-in-window"
            : "work-retention-newer-than-window",
    };
  }
  if (scans.length === 0) {
    return { ...common, kind: "all-unavailable", observations: unavailable, reasons };
  }

  const rows = rowsOf(accumulatedScans);
  if (rows.length === 0) {
    return { ...common, kind: "empty-scan", scans, unavailable, reasons, unchangedReadings };
  }
  return {
    ...common,
    kind: "groups",
    rows,
    scans,
    emptyScans: accumulatedScans
      .filter((scan) => scan.value.groups.length === 0)
      .map(({ value: _value, consecutiveCopies: _copies, ...scan }) => scan),
    unavailable,
    reasons,
    unchangedReadings,
  };
}
