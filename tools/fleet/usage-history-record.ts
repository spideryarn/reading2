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

/*
 * THE INCIDENT AND ITS MERGE RULE LIVE NEXT DOOR, and are re-exported here so
 * this module stays the one place a reader looks for "what is in a record".
 *
 * They were defined HERE until 2026-09-09, and the browser's series layer had
 * grown a second hand-written copy of the same rule while this one had no
 * production caller at all. Two implementations of one contract is how they
 * drift; the split is so both sides import the same function. It could not
 * simply stay here because the browser has to import it and this module reaches
 * for `Buffer` to enforce the line-size ceiling.
 */
export {
  mergeIncidents,
  type HistoryIncident,
  type IncidentSighting,
  type MergedIncident,
} from "./usage-incident-merge.js";

/**
 * The envelope. Bumped if the LINE's shape changes incompatibly. An additive
 * optional field with explicit absence semantics is not a breaking change.
 */
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

/**
 * The largest epoch milliseconds `Date` will accept — ECMA-262's ±100,000,000
 * days from the epoch.
 *
 * **Finite is not the same as in range**, and this is the check that gets
 * skipped. `new Date(1e100)` is a perfectly ordinary Invalid Date, and
 * `.toISOString()` on it **throws** — so a `resetsAtMs` that passed a
 * `Number.isFinite` guard at the boundary detonates later, in a renderer,
 * somewhere with no idea where the number came from. `tools/overseer/usage.ts`
 * had the same gap on external epochs; the fix in both places is to validate at
 * the boundary rather than in each reader.
 */
export const MAX_EPOCH_MS = 8.64e15;

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

import type { HistoryIncident } from "./usage-incident-merge.js";

export type ScanObservation = {
  /** Whether the transcript scan finished. An incomplete scan's counts are floors, not totals. */
  conclusive: boolean;
  why: string | null;
  incidents: HistoryIncident[];
};

export type CodexWindowObservation =
  | {
      kind: "value";
      slot: "primary" | "secondary";
      windowMinutes: number;
      usedPercent: number;
      resetsAt: string;
      resetsAtMs: number;
    }
  | {
      kind: "unknown";
      slot: "primary" | "secondary";
      windowMinutes: number | null;
      why: string;
    };

export type CodexBucketObservation = {
  limitId: string;
  limitName: string | null;
  windows: CodexWindowObservation[];
  planType: string | null;
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string | null;
  } | null;
  individualLimit: {
    limit: string;
    used: string;
    remainingPercent: number;
    resetsAt: number;
  } | null;
  spendControlReached: boolean | null;
  rateLimitReachedType: string | null;
};

/**
 * The Codex observation made concurrently with the Claude pass.
 *
 * Absence of the top-level key is reserved for lines written before this field
 * existed. Every current writer supplies one of these two arms. Facts a source
 * could not observe remain nullable inside the value arm; they are never
 * manufactured as zeroes.
 */
export type CodexObservation =
  | {
      kind: "value";
      accountId: string | null;
      readAt: string;
      buckets: CodexBucketObservation[];
      resetCredits: number | null;
    }
  | { kind: "unknown"; why: string; retryable: boolean };

export type UsagePass =
  | {
      kind: "pass";
      collectedAt: string;
      accountUuid: string | null;
      cache: CacheObservation;
      scan: ScanObservation;
      publication: { decision: "take-fresh" | "keep-stored"; why: string };
    }
  | { kind: "collector-failed"; at: string; why: string }
  /**
   * A record the store could not write, standing where it would have been.
   *
   * Distinct from `collector-failed` on purpose: the collector **worked** and
   * produced a reading, and it was the persistence that refused it — a record
   * over `MAX_LINE_BYTES`. Folding the two together would tell a reader the
   * usage pass had failed when it had not, and the two want different
   * investigations. What must never happen is the third option: dropping the
   * line, which leaves the chart to join straight across a reading that existed.
   */
  | { kind: "omitted"; at: string; why: string };

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
  /** Absent only on legacy lines whose writer predates Codex collection. */
  codex?: CodexObservation;
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

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSlot(value: unknown): value is CodexWindowObservation["slot"] {
  return value === "primary" || value === "secondary";
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function codexWindowValidationError(
  rawWindow: unknown,
  location: string,
  readAtMs: number,
): string | null {
  const window = recordOf(rawWindow);
  if (window === null) return `${location} was not an object`;
  if (!isSlot(window.slot)) return `${location} had an invalid slot`;
  if (window.kind === "unknown") {
    if (!(window.windowMinutes === null || (Number.isFinite(window.windowMinutes) && (window.windowMinutes as number) > 0))) {
      return `${location} had invalid windowMinutes`;
    }
    return typeof window.why === "string" && window.why.length > 0 ? null : `${location} had no reason`;
  }
  if (window.kind !== "value") return `${location} had an unknown kind`;
  if (!Number.isFinite(window.windowMinutes) || (window.windowMinutes as number) <= 0) {
    return `${location} had invalid windowMinutes`;
  }
  if (!Number.isFinite(window.usedPercent) || (window.usedPercent as number) < 0) {
    return `${location} had invalid usedPercent`;
  }
  if (!isInstant(window.resetsAt)) return `${location} had an invalid resetsAt`;
  if (
    !Number.isFinite(window.resetsAtMs) ||
    Math.abs(window.resetsAtMs as number) > MAX_EPOCH_MS ||
    Date.parse(window.resetsAt) !== window.resetsAtMs ||
    (window.resetsAtMs as number) <= readAtMs
  ) {
    return `${location} had an invalid resetsAtMs`;
  }
  return null;
}

function codexCreditsValidationError(value: unknown, location: string): string | null {
  if (value === null) return null;
  const credits = recordOf(value);
  if (
    credits === null ||
    typeof credits.hasCredits !== "boolean" ||
    typeof credits.unlimited !== "boolean" ||
    !isNullableString(credits.balance)
  ) {
    return `${location} had invalid credits`;
  }
  return null;
}

function codexIndividualLimitValidationError(value: unknown, location: string): string | null {
  if (value === null) return null;
  const limit = recordOf(value);
  if (
    limit === null ||
    typeof limit.limit !== "string" ||
    typeof limit.used !== "string" ||
    !Number.isInteger(limit.remainingPercent) ||
    !Number.isSafeInteger(limit.resetsAt)
  ) {
    return `${location} had an invalid individualLimit`;
  }
  return null;
}

function codexBucketValidationError(rawBucket: unknown, bucketIndex: number, readAtMs: number): string | null {
  const location = `bucket ${bucketIndex}`;
  const bucket = recordOf(rawBucket);
  if (bucket === null) return `${location} was not an object`;
  if (typeof bucket.limitId !== "string" || bucket.limitId.length === 0) return `${location} had no limitId`;
  if (!isNullableString(bucket.limitName)) return `${location} had an invalid limitName`;
  if (!isNullableString(bucket.planType)) return `${location} had an invalid planType`;
  if (!isNullableString(bucket.rateLimitReachedType)) return `${location} had an invalid rateLimitReachedType`;
  if (!(bucket.spendControlReached === null || typeof bucket.spendControlReached === "boolean")) {
    return `${location} had an invalid spendControlReached`;
  }
  const creditsWhy = codexCreditsValidationError(bucket.credits, location);
  if (creditsWhy !== null) return creditsWhy;
  const limitWhy = codexIndividualLimitValidationError(bucket.individualLimit, location);
  if (limitWhy !== null) return limitWhy;
  if (!Array.isArray(bucket.windows)) return `${location} windows was not an array`;
  for (const [windowIndex, window] of bucket.windows.entries()) {
    const why = codexWindowValidationError(window, `${location} window ${windowIndex}`, readAtMs);
    if (why !== null) return why;
  }
  return null;
}

function codexValidationError(value: unknown): string | null {
  const observation = recordOf(value);
  if (observation === null) return "not an object";
  if (observation.kind === "unknown") {
    if (typeof observation.why !== "string" || observation.why.length === 0) return "unknown arm without a reason";
    return typeof observation.retryable === "boolean" ? null : "unknown arm without retryability";
  }
  if (observation.kind !== "value") return `unknown kind ${JSON.stringify(observation.kind)}`;
  if (!isInstant(observation.readAt)) return "value arm without a valid readAt";
  if (!(observation.accountId === null || (typeof observation.accountId === "string" && observation.accountId.length > 0))) {
    return "accountId was not a non-empty string or null";
  }
  if (!(observation.resetCredits === null || (Number.isSafeInteger(observation.resetCredits) && (observation.resetCredits as number) >= 0))) {
    return "resetCredits was not a non-negative integer or null";
  }
  if (!Array.isArray(observation.buckets)) return "buckets was not an array";
  const readAtMs = Date.parse(observation.readAt);
  for (const [bucketIndex, bucket] of observation.buckets.entries()) {
    const why = codexBucketValidationError(bucket, bucketIndex, readAtMs);
    if (why !== null) return why;
  }
  return null;
}

function bounded(pass: UsagePass): UsagePass {
  if (pass.kind === "collector-failed" || pass.kind === "omitted") {
    return { ...pass, why: truncateWhy(pass.why) };
  }
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

function boundedCodex(codex: CodexObservation): CodexObservation {
  if (codex.kind === "unknown") return { ...codex, why: truncateWhy(codex.why) };
  return {
    ...codex,
    buckets: codex.buckets.map((bucket) => ({
      ...bucket,
      windows: bucket.windows.map((window) =>
        window.kind === "unknown" ? { ...window, why: truncateWhy(window.why) } : window,
      ),
    })),
  };
}

function codexForEncoding(line: UsageHistoryLine): CodexObservation | undefined {
  if (line.codex !== undefined || line.pass.kind !== "omitted") return line.codex;
  /* An omitted marker created by the CURRENT writer must not look like a legacy
     line merely because the store had to rebuild it. Retrying collection cannot
     repair this historical position, so the explicit unknown is non-retryable. */
  return {
    kind: "unknown",
    why: "the Codex observation was not retained because this usage-history record was omitted",
    retryable: false,
  };
}

/**
 * Serialise one line, or throw. Validation is at the WRITE side deliberately —
 * the health precedent types its writer and loosens only bytes coming back from
 * disk, and a record that cannot be placed in time is worse than an absent one
 * because it still occupies a position on the chart.
 */
export function encodeUsageHistoryLine(line: UsageHistoryLine): string {
  const codex = codexForEncoding(line);
  if (!Number.isFinite(line.nextDueMs) || line.nextDueMs <= 0) {
    throw new Error(`usage history: nextDueMs must be finite and positive, got ${String(line.nextDueMs)}`);
  }
  requireInstant(line.recordedAt, "recordedAt");
  if (codex !== undefined) {
    const why = codexValidationError(codex);
    if (why !== null) throw new Error(`usage history: codex ${why}`);
  }
  if (line.pass.kind === "collector-failed" || line.pass.kind === "omitted") requireInstant(line.pass.at, "at");
  else {
    requireInstant(line.pass.collectedAt, "collectedAt");
    if (line.pass.cache.kind === "attributed") {
      for (const window of line.pass.cache.windows) {
        if (window.kind !== "value") continue;
        if (!Number.isFinite(window.resetsAtMs) || Math.abs(window.resetsAtMs) > MAX_EPOCH_MS) {
          throw new Error(
            `usage history: resetsAtMs for ${window.window} is not a representable epoch (${String(window.resetsAtMs)})`,
          );
        }
      }
    }
  }

  const encoded = `${JSON.stringify({
    ...line,
    pass: bounded(line.pass),
    ...(codex === undefined ? {} : { codex: boundedCodex(codex) }),
  })}\n`;
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
  if (pass.kind === "collector-failed" || pass.kind === "omitted") {
    if (!isInstant(pass.at)) return { kind: "unreadable", why: `${pass.kind} without an instant` };
  } else if (pass.kind === "pass") {
    if (!isInstant(pass.collectedAt)) return { kind: "unreadable", why: "pass without a collectedAt" };
  } else {
    return { kind: "unreadable", why: `unknown pass kind ${JSON.stringify((pass as { kind?: unknown }).kind)}` };
  }

  if (!Object.hasOwn(record, "codex")) {
    return { kind: "line", line: record as unknown as UsageHistoryLine };
  }
  const codexWhy = codexValidationError(record.codex);
  if (codexWhy === null) return { kind: "line", line: record as unknown as UsageHistoryLine };

  return {
    kind: "line",
    line: {
      ...(record as unknown as UsageHistoryLine),
      codex: {
        kind: "unknown",
        why: truncateWhy(`the persisted Codex observation was malformed: ${codexWhy}`),
        retryable: false,
      },
    },
  };
}

// The merge contract and its types live in `usage-incident-merge.ts` - see the
// re-export near the top of this file for why.
