/**
 * **The usage-history record: one line of `~/.overseer/usage.jsonl`, and the
 * contract for merging what several lines say about the same incident.**
 *
 * The Overseer's checkpoint keeps only the LATEST usage reading, overwritten in
 * place, and the cache it reads is a point-in-time hint that is overwritten too.
 * So usage history cannot be reconstructed after the fact — this file is the
 * only reason the last 24 hours exists at all.
 *
 * The specification is
 * `docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md`; the four
 * designs that were tried and abandoned first are in
 * `docs/research/260909a-usage-history-the-dead-ends-and-how-the-plan-was-wrong-twice.md`.
 * Two GPT Sol plan reviews, eleven P0s, nothing overruled. The rules below each
 * exist because one of those findings described a chart that would have lied.
 *
 * ## Why this is not the card's projection
 *
 * The obvious move is to store whatever `projectUsage` hands the UI. It was
 * refused twice, and the reasons generalise: a UI type is not versioned
 * independently of the component that renders it, it carries what the card needs
 * (every conversation uuid, re-serialised every five minutes) rather than what a
 * chart needs, and it has no answer to the question a log must answer — what to
 * do when the same fact arrives twice, differently.
 *
 * Storing the RAW report was refused too, and that one is a privacy argument
 * rather than a size one: a raw hit carries `transcriptPath` and the API's error
 * prose, so a raw history copies project and worktree names into a long-lived
 * file that nothing prunes. Measured 2026-09-09 on the live checkpoint: the
 * `usage` blob is 61,122 bytes, 96% of it `rateLimits`, and 140 hits collapse to
 * 9 incident clusters — a 14x reduction with the identifying material dropped.
 *
 * ## Three clocks, kept apart
 *
 * A record has more than one time in it and they answer different questions.
 * Collapsing them is how a chart ends up confidently wrong.
 *
 *  - **The source instant** — when the thing happened. It is `collectedAt` on a
 *    pass and `at` on a collector failure, and there is deliberately **no
 *    universal field**: the daemon's throw arm has no `collectedAt` anywhere in
 *    it. Requiring one would have meant collapsing every failure into the first,
 *    dropping them all, or falling back to the checkpoint's `writtenAt` and
 *    writing the same failure every thirty seconds.
 *  - **`recordedAt`** — when the line was appended. Kept separate so the gap
 *    between observing and recording is visible.
 *  - **Event instants** — `firstHitAt` / `lastHitAt` belong to the rejections
 *    themselves, so an incident is drawn when it HAPPENED rather than when
 *    history first noticed it.
 *
 * Note that `recordedAt` does not by itself detect a clock regression: an NTP
 * step backwards moves it and the source instant together. Detecting that is the
 * reader's job, and it is a separate test over a series.
 *
 * ## Validity is adjudicated once, at the collection instant
 *
 * The live card re-derives expiry against the viewer's clock, correctly — a
 * stale "still valid" would be a live lie. **A historical point must not.** A
 * cache reading of 70% taken at 10:00 for a window resetting at 12:00 is a true
 * observation; re-adjudicating it when the chart is opened at 18:00 turns it into
 * "expired" and it vanishes, which on a five-hour window erases most of the day.
 *
 * And the instant is the COLLECTION one, not the append one. A scan takes 30-45
 * seconds, so a pass can start at 11:59:50 and be written at 12:00:30 —
 * validating at append time would expire an observation that was valid when it
 * was made. So the producer's already-adjudicated arm is what gets stored, with
 * the raw ingredients beside it, and nothing here recomputes expiry.
 *
 * A historical point still visible after its reset is therefore CORRECT. It is
 * an observation at 11:59:50, not a claim that the window is still current, and
 * the UI labels it as observed.
 *
 * ## A publication decision is not an observation
 *
 * `chooseUsage` keeps a complete 10:00 report over an incomplete 10:05 one,
 * because a rejection whose window resets on Friday is still in force. That is a
 * decision about which report the CHECKPOINT should publish. It says nothing
 * about the 10:05 **cache** reading, which is independent of the transcript
 * scan and may be perfectly good.
 *
 * So a pass records its cache observation, its scan result and its publication
 * decision as three separate facts. An earlier draft treated `keep-stored` as
 * "no reading was taken" and tested that such a line contributed no utilisation
 * point — which would have silently dropped real, attributed observations off
 * the chart every time a single transcript was unreadable.
 */

/** The envelope. Bumped if the LINE's shape changes. */
export const LINE_SCHEMA = 1;

/**
 * The payload, versioned **independently of the Overseer's checkpoint**.
 *
 * There is deliberately no `checkpointSchema` here. The record is built from an
 * in-memory `UsageReport`; any checkpoint envelope constructed in
 * `scripts/overseer.ts` to feed a projection is synthetic, so storing its schema
 * would be provenance for something that was never on disk. Worse, the two
 * version independently: a projection can rename or reinterpret a field without
 * the checkpoint schema moving at all, after which two lines both claiming
 * `checkpointSchema: 2` hold incompatible shapes and nothing can tell them apart.
 */
export const SUMMARY_SCHEMA = 1;

/**
 * The legal ceiling for one serialised line, newline included.
 *
 * Kept at health's 64 KiB rather than narrowed to the ~6.8 KB a real record
 * measures, because the rotation invariant in the store is stated against the
 * MAXIMUM legal size and a ceiling that tracks today's typical record is a
 * ceiling that breaks the day a record grows. A line over this throws; the store
 * turns that into a positional omission marker, because a dropped line that
 * leaves no trace is the one outcome a history must never produce.
 */
export const MAX_LINE_BYTES = 64 * 1024;

/** Prose from the producer is bounded, and says when it was cut. */
export const MAX_WHY_CHARS = 2000;

export type WindowObservation =
  | {
      kind: "value";
      window: string;
      utilizationPercent: number;
      resetsAt: string;
      resetsAtMs: number;
    }
  | { kind: "expired"; window: string; resetsAt: string | null; why: string }
  | { kind: "unknown"; window: string; why: string };

/**
 * `window` is an open string, never a closed union.
 *
 * A closed union lets an exhaustive `switch` compile while silently dropping a
 * real window — and there are three unknown ones on this box today
 * (`nimbus_quill`, `spend`, `member_dashboard_available`), all with no
 * `resets_at`. An unrecognised window is a named row in the unknown state; it is
 * never dropped, and never plotted from its unvalidated `utilizationPercent: 0`.
 */
export type CacheObservation =
  | { kind: "attributed"; accountUuid: string; fetchedAt: string; windows: WindowObservation[] }
  /** The `/login`-swap case. Carries no windows at all — this is a gap, not a zero. */
  | { kind: "unattributed"; why: string }
  | { kind: "unknown"; why: string };

/**
 * Narrower than the UI's `UsageIncident`: a conversation COUNT rather than the
 * uuid list, which the chart does not need repeated every five minutes.
 *
 * `id` is the producer's derived `` `${window}@${resetsAt}` `` — stable across
 * passes, which is what makes merging possible at all.
 */
export type HistoryIncident = {
  id: string;
  window: string;
  resetsAt: string;
  firstHitAt: string | null;
  lastHitAt: string | null;
  rejections: number;
  unidentifiedRejections: number;
  conversations: number;
};

export type ScanObservation = {
  /** Whether the transcript scan finished. An incomplete scan's counts are floors, not totals. */
  conclusive: boolean;
  why: string | null;
  incidents: HistoryIncident[];
};

export type UsagePass =
  | {
      kind: "pass";
      collectedAt: string;
      accountUuid: string | null;
      cache: CacheObservation;
      scan: ScanObservation;
      publication: { decision: "take-fresh" | "keep-stored"; why: string };
    }
  | { kind: "collector-failed"; at: string; why: string };

export type UsageHistoryLine = {
  lineSchema: number;
  summarySchema: number;
  recordedAt: string;
  /**
   * Expected ms until the next pass, on EVERY arm including failures.
   *
   * Without it a reader assuming 300 s marks every interval of an injected or
   * changed cadence as a recorder failure — and adding the field later is a
   * persisted-format change, which is the expensive kind.
   */
  nextDueMs: number;
  pass: UsagePass;
};

export type DecodedLine =
  | { kind: "line"; line: UsageHistoryLine }
  /**
   * A line this build cannot interpret, kept **positionally**.
   *
   * If a schema-1 reader silently removed twelve schema-2 samples, the chart
   * would join the point before them to the point after and claim continuous
   * observation across an hour it explicitly could not read. So this survives as
   * a sample, breaks every affected series, and is counted.
   */
  | { kind: "unsupported"; summarySchema: number | null; why: string }
  | { kind: "unreadable"; why: string };

export type MergedIncident = HistoryIncident & {
  /**
   * Whether `rejections`/`conversations` came from a scan that finished.
   *
   * Counts from disjoint incomplete scans cannot be unioned exactly without raw
   * hit ids, which this format does not store. That is only acceptable because
   * the UI can say what the number means — "most seen in one complete scan",
   * never "rejections in these 24 hours". This flag is what lets it.
   */
  fromConclusiveScan: boolean;
  /** Two records disagreed about an invariant, so neither can be published. */
  unreadable: boolean;
  why: string | null;
};

function truncateWhy(why: string): string {
  return why.length <= MAX_WHY_CHARS ? why : `${why.slice(0, MAX_WHY_CHARS)}… (truncated for the history)`;
}

function requireInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`usage history: ${field} must be a parseable instant, got ${JSON.stringify(value)}`);
  }
  return value;
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function bounded(pass: UsagePass): UsagePass {
  if (pass.kind === "collector-failed") return { ...pass, why: truncateWhy(pass.why) };
  const cache: CacheObservation =
    pass.cache.kind === "attributed"
      ? {
          ...pass.cache,
          windows: pass.cache.windows.map((w) => (w.kind === "value" ? w : { ...w, why: truncateWhy(w.why) })),
        }
      : { ...pass.cache, why: truncateWhy(pass.cache.why) };
  return {
    ...pass,
    cache,
    scan: { ...pass.scan, why: pass.scan.why === null ? null : truncateWhy(pass.scan.why) },
    publication: { ...pass.publication, why: truncateWhy(pass.publication.why) },
  };
}

/**
 * Serialise one line, or throw. Validation is at the WRITE side deliberately —
 * the health precedent types its writer and loosens only bytes coming back from
 * disk, and a record that cannot be placed in time is worse than an absent one
 * because it still occupies a position on the chart.
 */
export function encodeUsageHistoryLine(line: UsageHistoryLine): string {
  if (!Number.isFinite(line.nextDueMs) || line.nextDueMs <= 0) {
    throw new Error(`usage history: nextDueMs must be finite and positive, got ${String(line.nextDueMs)}`);
  }
  requireInstant(line.recordedAt, "recordedAt");
  if (line.pass.kind === "collector-failed") requireInstant(line.pass.at, "at");
  else requireInstant(line.pass.collectedAt, "collectedAt");

  const encoded = `${JSON.stringify({ ...line, pass: bounded(line.pass) })}\n`;
  const bytes = Buffer.byteLength(encoded, "utf8");
  if (bytes > MAX_LINE_BYTES) {
    throw new Error(`usage history: a record serialised to ${bytes} bytes, over MAX_LINE_BYTES (${MAX_LINE_BYTES})`);
  }
  return encoded;
}

/** Never throws. Every failure is a value the reader can render as a break in the series. */
export function decodeUsageHistoryLine(raw: string): DecodedLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { kind: "unreadable", why: `not JSON: ${String(error)}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "unreadable", why: "not a JSON object" };
  }
  const record = parsed as Record<string, unknown>;

  /* Checked BEFORE the shape, because a newer line is expected to have a shape
     this build does not recognise — reporting it as corrupt would be a lie, and
     the two need different handling downstream. */
  if (typeof record.summarySchema !== "number") {
    return { kind: "unreadable", why: "no numeric summarySchema" };
  }
  if (record.summarySchema !== SUMMARY_SCHEMA) {
    return {
      kind: "unsupported",
      summarySchema: record.summarySchema,
      why: `written by summarySchema ${record.summarySchema}; this build reads ${SUMMARY_SCHEMA}`,
    };
  }

  if (!isInstant(record.recordedAt)) return { kind: "unreadable", why: "recordedAt is not an instant" };
  if (typeof record.nextDueMs !== "number" || !Number.isFinite(record.nextDueMs) || record.nextDueMs <= 0) {
    return { kind: "unreadable", why: "nextDueMs is not finite and positive" };
  }
  const pass = record.pass as UsagePass | undefined;
  if (typeof pass !== "object" || pass === null) return { kind: "unreadable", why: "no pass" };
  if (pass.kind === "collector-failed") {
    if (!isInstant(pass.at)) return { kind: "unreadable", why: "collector-failed without an instant" };
  } else if (pass.kind === "pass") {
    if (!isInstant(pass.collectedAt)) return { kind: "unreadable", why: "pass without a collectedAt" };
  } else {
    return { kind: "unreadable", why: `unknown pass kind ${JSON.stringify((pass as { kind?: unknown }).kind)}` };
  }

  return { kind: "line", line: record as unknown as UsageHistoryLine };
}

type Counts = Pick<HistoryIncident, "rejections" | "unidentifiedRejections" | "conversations">;

/**
 * Which of two sightings of one incident supplies the counts.
 *
 * The rule is not "the larger number wins", because the numbers are not
 * comparable across scans of different completeness: **a scan that stopped early
 * saw fewer rejections, not a corrected number.** So a conclusive sighting always
 * displaces an inconclusive one even if its count is lower, two sightings of the
 * same completeness take the maximum, and an inconclusive sighting never
 * overwrites a conclusive one.
 */
function mergeCounts(seen: MergedIncident, incident: HistoryIncident, sampleConclusive: boolean): Counts {
  if (sampleConclusive && !seen.fromConclusiveScan) return incident;
  if (sampleConclusive !== seen.fromConclusiveScan) return seen;
  return {
    rejections: Math.max(seen.rejections, incident.rejections),
    unidentifiedRejections: Math.max(seen.unidentifiedRejections, incident.unidentifiedRejections),
    conversations: Math.max(seen.conversations, incident.conversations),
  };
}

function earlier(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * **The merge contract. A stable id is not one on its own.**
 *
 * The same rejection sits in every five-minute scan until it expires or leaves
 * the eight-day scan window, and the incident gets RICHER as more of it is seen
 * — the card's own committed test constructs exactly that: one rejection on the
 * first pass, two rejections and another conversation on the second, same id.
 *
 * So neither "first wins" nor "last wins" is safe. First-wins permanently
 * under-reports and truncates the span; last-wins lets an incomplete scan
 * replace richer evidence with poorer. The rules instead:
 *
 *  - the span widens to the earliest and latest instants ever observed;
 *  - the counts are the largest seen in a **conclusive** scan, falling back to
 *    the largest inconclusive one with `fromConclusiveScan: false` so the UI can
 *    say which it is;
 *  - `window` and `resetsAt` must agree across occurrences. If they do not, one
 *    of the records is lying about what it observed and the incident is
 *    `unreadable` rather than resolved by picking a side.
 *
 * An incident with no known hit time is kept, **unplaced**. Pinning it to scan
 * time would claim the rejection happened when we happened to look.
 */
export function mergeIncidents(
  samples: readonly { conclusive: boolean; incidents: readonly HistoryIncident[] }[],
): MergedIncident[] {
  const merged = new Map<string, MergedIncident>();
  for (const sample of samples) {
    for (const incident of sample.incidents) {
      const seen = merged.get(incident.id);
      if (seen === undefined) {
        merged.set(incident.id, {
          ...incident,
          fromConclusiveScan: sample.conclusive,
          unreadable: false,
          why: null,
        });
        continue;
      }
      if (seen.window !== incident.window || seen.resetsAt !== incident.resetsAt) {
        merged.set(incident.id, {
          ...seen,
          unreadable: true,
          why: `two records disagree about this incident: window ${seen.window}/${incident.window}, resets ${seen.resetsAt}/${incident.resetsAt}`,
        });
        continue;
      }
      if (seen.unreadable) continue;
      merged.set(incident.id, {
        ...seen,
        ...mergeCounts(seen, incident, sample.conclusive),
        firstHitAt: earlier(seen.firstHitAt, incident.firstHitAt),
        lastHitAt: later(seen.lastHitAt, incident.lastHitAt),
        fromConclusiveScan: seen.fromConclusiveScan || sample.conclusive,
      });
    }
  }
  return [...merged.values()];
}
