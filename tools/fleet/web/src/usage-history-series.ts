/**
 * **Turning 24 hours of usage records into something drawable, without claiming
 * more than was observed.**
 *
 * Pure: no React, no clock of its own, no fetch. Everything the chart shows is
 * decided here and tested here, because every rule below is a way a usage chart
 * can be confidently wrong.
 *
 * ## The three absences, kept apart
 *
 * 1. **Within a window** — value, expired, or unknown. The producer's own arm,
 *    adjudicated at the reading's instant and **never re-adjudicated here**.
 * 2. **Within a scan** — was this scan's failure to find a rejection believable?
 *    That is `absenceGapReason`'s question, answered by the server and carried on
 *    the record as `scan.conclusive`.
 * 3. **Between records** — nothing was recorded. Derived only from source
 *    instants and each record's own `nextDueMs`.
 *
 * Collapsing (2) and (3) is the tempting mistake: they share the word absence
 * and answer different questions. A complete scan at 10:00 establishes "no 429
 * found" and says **nothing** about an hour in which no record arrived. Joining
 * the line across that hour would claim continuous observation of a period
 * nobody observed.
 *
 * ## Validity is never recomputed
 *
 * A reading of 70% taken at 10:00 for a window resetting at 12:00 is a true
 * observation. Re-deciding at 18:00 whether that window has expired would delete
 * it — and on a five-hour window that erases most of the day. The live card
 * re-derives expiry because it describes *now*; a chart describes *then*, and
 * the two need different clocks. So the stored arm is drawn as it stands, and
 * points are labelled *as observed*.
 *
 * ## Utilisation is per-account. Rejections are not attributed at all.
 *
 * A cached percentage belongs to the account the cache named. A transcript 429
 * carries **no account id**, and the scan looks back eight days, which may span
 * a `/login` swap — 27 such rejections were live on this box while this was
 * written. So incidents are drawn on a shared axis as observed window clusters,
 * never split by account, and never given one.
 */
import { mergeIncidents, type IncidentSighting } from "../../usage-incident-merge.js";
import { isGeneralCodexBucket } from "./codex-buckets";
import type { CodexRecordedObservationView, UsageHistorySample, UsageHistoryView } from "./usage-history-client";

export type Span = { fromMs: number; toMs: number };
export type Point = { atMs: number; value: number };

/** One drawable line. Breaks are where the line must not join. */
export type Line = {
  points: Point[];
  /** Where the line is cut, and why — rendered as a gap, never interpolated. */
  breaks: (Span & { why: string })[];
  /**
   * The points already split into drawable runs — **one polyline each, and
   * never joined across a break.**
   *
   * The renderer used to derive these itself by comparing timestamps, which is
   * wrong the moment the clock goes backwards: for file-order points 10:05 then
   * 10:00 its "is there a cut between these" predicate asked `10:05 < 10:00`,
   * got false, and drew one line straight across the regression it had just
   * shaded in alarm colours. GPT Sol H7. Splitting here puts it under the tests
   * that already describe when a line must break.
   */
  runs: Point[][];
};

/** One Claude window's line for one account. */
export type WindowSeries = Line & { window: string };

/**
 * One Codex window's line: one account, one bucket, one window **duration**.
 *
 * Keyed by duration and not by `slot`, because `primary` and `secondary` are
 * positions in the provider's payload, and the same position can carry five
 * hours in one bucket and seven days in another (usage-history.md § The Codex
 * subscription reading).
 */
export type CodexSeries = Line & {
  family: "codex";
  accountId: string;
  limitId: string;
  limitName: string | null;
  /** The bucket about the whole subscription rather than one model. */
  general: boolean;
  windowMinutes: number;
};

export type CodexUnknownWindow = {
  limitId: string;
  limitName: string | null;
  windowMinutes: number | null;
  slot: "primary" | "secondary" | null;
  why: string;
};

/**
 * The Codex observation each record carries beside its Claude pass — of the one
 * login the daemon reads, not of every registered account.
 */
export type CodexPlot = {
  series: CodexSeries[];
  /** Windows that could not be drawn, named with the reason. Never zero. */
  unknownWindows: CodexUnknownWindow[];
  /** Records whose Codex arm carried no drawable, attributed window. */
  notObserved: number;
};

export type AccountSeries = {
  accountUuid: string;
  windows: WindowSeries[];
};

/**
 * A rejection cluster placed at **when it happened**, not when history saw it.
 *
 * `fromMs`/`toMs` are the real first and last hit instants. `beganBeforeWindow`
 * says the cluster started before the visible period — the scan looks back eight
 * days, so this is common, and clipping it to the left edge would claim it began
 * there.
 *
 * `unplaced` is a cluster whose hits carried no timestamp at all. It is listed
 * and not drawn on the axis: pinning it to scan time would claim the rejection
 * happened when we happened to look.
 */
export type PlacedIncident = {
  id: string;
  window: string;
  resetsAt: string;
  fromMs: number | null;
  toMs: number | null;
  rejections: number;
  conversations: number;
  /** False when the count came only from scans that did not finish. */
  fromConclusiveScan: boolean;
  beganBeforeWindow: boolean;
  unplaced: boolean;
  /**
   * Two sightings disagreed about this incident's window or reset instant, so
   * neither label can be published.
   *
   * The shared merge has always marked this; `placeIncidents` used to drop the
   * field, so the check existed and never reached the page — which is the same
   * shape as the bug it was written to prevent.
   */
  unreadable: boolean;
  why: string | null;
};

export type UsagePlot = {
  fromMs: number;
  toMs: number;
  accounts: AccountSeries[];
  codex: CodexPlot;
  incidents: PlacedIncident[];
  /** Windows the producer could not read, with its own reason. Named, never dropped, never zero. */
  unknownWindows: { window: string; why: string }[];
  /** Nothing was recorded here. Derived from source instants and each record's own cadence. */
  recorderGaps: (Span & { why: string })[];
  /** The source clock went backwards between two records. Reported, never sorted away. */
  clockRegressions: Span[];
  /** Before the first record we hold — its own region, distinct from a hole. */
  beforeHistory: Span | null;
  unsupportedLines: number;
  unreadableLines: number;
};

function sourceMs(sample: UsageHistorySample): number | null {
  return sample.kind === "unsupported" ? null : sample.sourceAtMs;
}

/**
 * How long after a record the next one was due, from **that record's own**
 * declared cadence.
 *
 * Never a constant. A daemon on a different interval would otherwise have every
 * ordinary gap drawn as a failure, which is a monitor alarming at its own
 * configuration.
 */
const GAP_SLACK = 1.5;

function dueWithinMs(sample: UsageHistorySample): number | null {
  if (sample.kind !== "sample") return null;
  return sample.line.nextDueMs * GAP_SLACK;
}

export function plotUsageHistory(view: Extract<UsageHistoryView, { kind: "history" }>): UsagePlot {
  const byAccount = new Map<string, Map<string, WindowSeries>>();
  const sightings: IncidentSighting[] = [];
  const unknownWindows = new Map<string, string>();
  const recorderGaps: (Span & { why: string })[] = [];
  const clockRegressions: Span[] = [];

  let previousAtMs: number | null = null;
  let previousDue: number | null = null;
  /* The series that had a real point on the LAST record, so a record that
     stops carrying one cuts its line rather than joining across.

     THE SERIES OBJECTS THEMSELVES, not `${account} ${window}` keys. That key
     was joined and split on a separator that turned out to be a literal NUL
     byte rather than the space it looked like — it worked, because both ends
     used the same byte, and `no-raw-nul-bytes.test.ts` was the only thing that
     could see it. `seriesFor` already caches one object per pair, so identity
     is the key and there is nothing to parse. */
  let live = new Set<Line>();
  const codexSeries = new Map<string, CodexSeries>();
  const codexUnknown = new Map<string, CodexUnknownWindow>();
  let codexNotObserved = 0;

  for (const sample of view.samples) {
    const atMs = sourceMs(sample);

    /* An unsupported record has no time and cannot be placed — but it breaks
       every series, because this build cannot say what was in it. */
    if (atMs === null || sample.kind === "unsupported") {
      for (const series of live) cut(series, previousAtMs, null, "a record this build cannot read");
      live = new Set();
      continue;
    }

    if (previousAtMs !== null) {
      /* A LINE THE STORE COULD NOT PARSE IS A HOLE, and the series must break
         across it. `view.holes` was carried faithfully from the store, through
         the route, into the client — and then ignored here, so the chart drew
         straight over bytes this build could not read. GPT Sol H6. */
      const hole = view.holes.find(
        (h) => h.afterAt !== null && Date.parse(h.afterAt) === previousAtMs,
      );
      if (hole !== undefined) {
        for (const series of live) cut(series, previousAtMs, atMs, "a line that could not be read");
        live = new Set();
      }
      if (atMs < previousAtMs) {
        /* The source clock went backwards. Preserve file order, break the
           series, and report it — sorting it into plausibility would hide the
           one condition worth seeing. */
        clockRegressions.push({ fromMs: atMs, toMs: previousAtMs });
        for (const series of live) cut(series, previousAtMs, atMs, "the clock went backwards between records");
        live = new Set();
      } else if (previousDue !== null && atMs - previousAtMs > previousDue) {
        recorderGaps.push({
          fromMs: previousAtMs,
          toMs: atMs,
          why: `nothing was recorded for ${Math.round((atMs - previousAtMs) / 60_000)} minutes`,
        });
        for (const series of live) cut(series, previousAtMs, atMs, "nothing was recorded");
        live = new Set();
      }
    }

    if (sample.kind === "omitted") {
      for (const series of live) cut(series, previousAtMs, atMs, "a record too large to write");
      live = new Set();
      previousAtMs = atMs;
      previousDue = null;
      continue;
    }

    const pass = sample.line.pass;
    const nowLive = new Set<Line>();

    /* THE CODEX READING RIDES IN THE SAME RECORD, so every record-level cut
       above has already cut its lines. What it does NOT share is the Claude
       pass's fate: a Claude collector failure says nothing about the Codex
       fetch made beside it, and that record still carries its own observation. */
    if (!codexInto(sample.line.codex, atMs, codexSeries, codexUnknown, nowLive)) codexNotObserved += 1;

    if (pass.kind !== "pass") {
      /* A collector failure is a real event and breaks the Claude lines: we did
         not observe the account during it. */
      for (const series of live) {
        if (!nowLive.has(series)) {
          cut(series, previousAtMs, atMs, isCodex(series) ? "no Codex reading for this window" : "the usage pass failed");
        }
      }
      live = nowLive;
      previousAtMs = atMs;
      previousDue = dueWithinMs(sample);
      continue;
    }

    if (pass.cache.kind === "attributed") {
      for (const window of pass.cache.windows) {
        if (window.kind === "unknown") {
          unknownWindows.set(window.window, window.why);
          continue;
        }
        if (window.kind === "expired") continue;
        /* ONLY positively attributed, non-null uuids form a series. */
        const series = seriesFor(byAccount, pass.cache.accountUuid, window.window);
        const point = { atMs, value: window.utilizationPercent };
        series.points.push(point);
        (series.runs.at(-1) ?? series.runs[series.runs.push([]) - 1])?.push(point);
        nowLive.add(series);
      }
    }
    /* An `unattributed` or `unknown` cache carries no windows at all, so every
       live line simply stops — a break, never a zero. */
    for (const series of live) {
      if (!nowLive.has(series)) {
        cut(series, previousAtMs, atMs, isCodex(series) ? "no Codex reading for this window" : "no reading for this window");
      }
    }
    live = nowLive;

    /* THE MERGE RULE IS NOT REIMPLEMENTED HERE. Sightings are collected and
       handed to the one shared `mergeIncidents`, so the chart and the store
       cannot disagree about what an incident is. They DID disagree in shape for
       a few hours on 2026-09-09: this file had a hand-written copy while the
       server's tested one had no caller at all. */
    sightings.push({ conclusive: pass.scan.conclusive, incidents: pass.scan.incidents });

    previousAtMs = atMs;
    previousDue = dueWithinMs(sample);
  }

  const firstAtMs = view.samples.map(sourceMs).find((v): v is number => v !== null) ?? null;
  return {
    fromMs: view.fromMs,
    toMs: view.toMs,
    accounts: [...byAccount.entries()].map(([accountUuid, windows]) => ({
      accountUuid,
      windows: [...windows.values()],
    })),
    codex: { series: [...codexSeries.values()], unknownWindows: [...codexUnknown.values()], notObserved: codexNotObserved },
    incidents: placeIncidents(mergeIncidents(sightings), view.fromMs, view.toMs),
    unknownWindows: [...unknownWindows.entries()].map(([window, why]) => ({ window, why })),
    recorderGaps,
    clockRegressions,
    /* "Before history began" is its own region and NOT a hole: one says nothing
       was ever recorded then, the other says something was and we lost it. */
    beforeHistory:
      view.predecessor === null && firstAtMs !== null && firstAtMs > view.fromMs
        ? { fromMs: view.fromMs, toMs: firstAtMs }
        : null,
    unsupportedLines: view.unsupportedLines,
    unreadableLines: view.unreadableLines,
  };
}

function seriesFor(
  byAccount: Map<string, Map<string, WindowSeries>>,
  accountUuid: string,
  window: string,
): WindowSeries {
  let windows = byAccount.get(accountUuid);
  if (windows === undefined) {
    windows = new Map();
    byAccount.set(accountUuid, windows);
  }
  let series = windows.get(window);
  if (series === undefined) {
    series = { window, points: [], breaks: [], runs: [[]] };
    windows.set(window, series);
  }
  return series;
}

function isCodex(line: Line): line is CodexSeries {
  return "family" in line && line.family === "codex";
}

/**
 * Add one record's Codex observation to its lines. Returns false when the record
 * said nothing drawable about Codex at all.
 *
 * - **unknown, or a legacy line with none**, draws nothing, so every live Codex
 *   line stops there — a break, never a zero.
 * - **No account named** forms no series, as an unattributed Claude cache forms
 *   none: a line keyed on "some account" would join across a login swap.
 * - **An unknown window** is a named row, never a point.
 * - **Ambiguity draws nothing**, as the live card refuses to choose: two buckets
 *   with one id, two windows in one slot, or two windows of one duration.
 * - **The general bucket under a spend control** is withheld, as the live card
 *   withholds it: its percentage is not the headroom while that control holds.
 *
 * Anything withheld is simply not in `nowLive`, so a line it would have
 * continued is cut there by the caller.
 *
 * The point sits at the RECORD's source instant — the pass time, the same
 * instant the Claude points and every cut use — not the observation's
 * `readAt`, which is when the Codex reply arrived. A point on a second clock
 * could land on the far side of a cut computed on the first. Validity is not
 * re-decided against either: the stored arm is drawn as it stands.
 */
function codexInto(
  observation: CodexRecordedObservationView | undefined,
  atMs: number,
  seriesByKey: Map<string, CodexSeries>,
  unknown: Map<string, CodexUnknownWindow>,
  nowLive: Set<Line>,
): boolean {
  if (observation === undefined || observation.kind !== "value" || observation.accountId === null) return false;
  const accountId = observation.accountId;
  const name = (
    bucket: { limitId: string; limitName: string | null },
    window: { windowMinutes: number | null; slot: "primary" | "secondary" | null },
    why: string,
  ): void => {
    unknown.set(JSON.stringify([bucket.limitId, window.slot, window.windowMinutes, why]), {
      limitId: bucket.limitId,
      limitName: bucket.limitName,
      windowMinutes: window.windowMinutes,
      slot: window.slot,
      why,
    });
  };
  const bucketCount = new Map<string, number>();
  for (const bucket of observation.buckets) bucketCount.set(bucket.limitId, (bucketCount.get(bucket.limitId) ?? 0) + 1);
  let drewAny = false;

  for (const bucket of observation.buckets) {
    if ((bucketCount.get(bucket.limitId) ?? 0) > 1) {
      name(bucket, { windowMinutes: null, slot: null }, `the reading carried duplicate ${bucket.limitId} buckets, so neither was drawn`);
      continue;
    }
    if (isGeneralCodexBucket(bucket.limitId) && (bucket.spendControlReached !== false || bucket.individualLimit !== null)) {
      name(
        bucket,
        { windowMinutes: null, slot: null },
        bucket.spendControlReached !== false
          ? "general usage is not drawn while spend-control state was reached or unavailable"
          : "general usage is not drawn while an individual spend limit was reported",
      );
      continue;
    }
    const slotCount = new Map<string, number>();
    const durationCount = new Map<number, number>();
    for (const window of bucket.windows) {
      slotCount.set(window.slot, (slotCount.get(window.slot) ?? 0) + 1);
      /* An unknown arm can still name its duration. It makes a value arm of
         that duration ambiguous too; counting only values would draw across it. */
      if (window.windowMinutes !== null) {
        durationCount.set(window.windowMinutes, (durationCount.get(window.windowMinutes) ?? 0) + 1);
      }
    }
    const valuesByMinutes = new Map<number, number[]>();
    for (const window of bucket.windows) {
      if ((slotCount.get(window.slot) ?? 0) > 1) {
        name(bucket, { windowMinutes: null, slot: window.slot }, `this record carried duplicate ${window.slot} windows, so neither was drawn`);
        continue;
      }
      if (window.kind === "unknown") {
        name(bucket, window, window.why);
        continue;
      }
      const values = valuesByMinutes.get(window.windowMinutes) ?? [];
      values.push(window.usedPercent);
      valuesByMinutes.set(window.windowMinutes, values);
    }
    for (const [windowMinutes, values] of valuesByMinutes) {
      const value = values[0];
      if (durationCount.get(windowMinutes) !== 1 || values.length !== 1 || value === undefined) {
        name(
          bucket,
          { windowMinutes, slot: null },
          `this record carried two ${windowMinutes}-minute windows for this bucket, so neither was drawn`,
        );
        continue;
      }
      /* A JSON tuple as the key, so no separator byte can collide with an id. */
      const key = JSON.stringify([accountId, bucket.limitId, windowMinutes]);
      let series = seriesByKey.get(key);
      if (series === undefined) {
        series = {
          family: "codex",
          accountId,
          limitId: bucket.limitId,
          limitName: bucket.limitName,
          general: isGeneralCodexBucket(bucket.limitId),
          windowMinutes,
          points: [],
          breaks: [],
          runs: [[]],
        };
        seriesByKey.set(key, series);
      }
      const point = { atMs, value };
      series.points.push(point);
      (series.runs.at(-1) ?? series.runs[series.runs.push([]) - 1])?.push(point);
      nowLive.add(series);
      drewAny = true;
    }
  }
  return drewAny;
}

function cut(series: Line, fromMs: number | null, toMs: number | null, why: string): void {
  if (fromMs === null) return;
  series.breaks.push({ fromMs, toMs: toMs ?? fromMs, why });
  /* And start a fresh run, so the renderer cannot rejoin what this just cut. */
  if ((series.runs.at(-1)?.length ?? 0) > 0) series.runs.push([]);
}

/**
 * Put a merged incident on the time axis, or refuse to.
 *
 * The two refusals are the point. **`unplaced`** is a cluster whose hits carried
 * no timestamp: it is listed and left off the axis, because pinning it to scan
 * time would claim the rejection happened when we happened to look.
 * **`beganBeforeWindow`** is a cluster that started before the visible period —
 * common, since the scan looks back eight days — and it must read as beginning
 * earlier rather than being clipped to the left edge, which would claim it
 * started there.
 */
function placeIncidents(
  merged: ReturnType<typeof mergeIncidents>,
  windowFromMs: number,
  windowToMs: number,
): PlacedIncident[] {
  return merged
    .filter((incident) => {
      /* AN INCIDENT THAT ENDED BEFORE THE WINDOW IS NOT IN THE WINDOW. They were
         all kept, and the renderer clamped a negative start to zero while
         computing width from two negative coordinates — drawing a visible bar at
         the left edge for rejections that happened before the chart begins, and
         listing them under "the last 24 hours". GPT Sol H8.

         An unplaced incident (no hit ever carried a time) is kept: it is listed
         rather than drawn, and dropping it would lose a rejection entirely. */
      if (incident.firstHitAt === null) return true;
      const endMs = Date.parse(incident.lastHitAt ?? incident.firstHitAt);
      return !Number.isFinite(endMs) || endMs >= windowFromMs;
    })
    .filter((incident) => {
      /* And one that begins after the window ends is not in it either. */
      if (incident.firstHitAt === null) return true;
      const startMs = Date.parse(incident.firstHitAt);
      return !Number.isFinite(startMs) || startMs <= windowToMs;
    })
    .map((incident) => {
      const fromMs = incident.firstHitAt === null ? null : Date.parse(incident.firstHitAt);
      const toMs = incident.lastHitAt === null ? null : Date.parse(incident.lastHitAt);
      return {
        id: incident.id,
        window: incident.window,
        resetsAt: incident.resetsAt,
        fromMs,
        toMs,
        rejections: incident.rejections,
        conversations: incident.conversations,
        fromConclusiveScan: incident.fromConclusiveScan,
        beganBeforeWindow: fromMs !== null && fromMs < windowFromMs,
        unplaced: fromMs === null,
        unreadable: incident.unreadable,
        why: incident.why,
      };
    })
    .sort((a, b) => (b.fromMs ?? 0) - (a.fromMs ?? 0));
}
