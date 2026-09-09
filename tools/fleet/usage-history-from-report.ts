/**
 * **Turn one usage pass into one history line.**
 *
 * The seam between what the Overseer's collector produces (`UsageReport`) and
 * what the history store keeps (`UsageHistoryLine`). It is a pure function with
 * no I/O and no clock beyond what it is handed, so it can be tested on its own
 * and composed in `scripts/overseer.ts` — which is where it *is* composed,
 * because that file already straddles `tools/overseer` ↔ `tools/fleet` and
 * neither module should acquire the other.
 *
 * **Its input is structural on purpose.** The daemon's `UsagePassOutcome` would
 * be the obvious parameter type, but importing it would drag `daemon.ts` — and
 * behind it `store.ts` and the whole Overseer graph — into a `tools/fleet/`
 * module, which is exactly the import the seam forbids. So this declares the
 * shape it needs and the composition root hands over something that fits.
 *
 * ## The three facts a pass produces, and why they are separate
 *
 * `chooseUsage` decides whether the *checkpoint* publishes a report. That is a
 * publication decision, and it is **not** a statement about what the pass
 * observed. A pass whose transcript scan came back incomplete still read the
 * cache, and that reading is perfectly good — it comes from a different source
 * and cannot be spoiled by an unreadable transcript.
 *
 * So a line carries the cache observation, the scan result, and the publication
 * decision as three independent things. An earlier draft folded them together
 * and would have dropped a real, attributed utilisation point off the chart
 * every time a single transcript could not be opened.
 *
 * ## Absence is asked once, of the shared helper
 *
 * Whether a scan's failure to find a rejection is believable is
 * `absenceGapReason`'s question — the same one the card asks, pinned against the
 * producer by its own test. This file must not re-derive it, or the chart and
 * the card would answer it differently from the same bytes.
 *
 * Note what that helper canNOT answer: why the *next* record never arrived. That
 * is a gap between samples, derived from source instants and `nextDueMs`, and it
 * belongs to the reader.
 */
import { absenceGapReason } from "./usage-absence.js";
import { groupUsageIncidents, type IncidentInput } from "./usage-feed.js";
import type {
  CacheObservation,
  CodexObservation,
  HistoryIncident,
  ScanObservation,
  UsageHistoryLine,
  UsagePass,
  WindowObservation,
} from "./usage-history-record.js";
import { LINE_SCHEMA, SUMMARY_SCHEMA } from "./usage-history-record.js";
import type { CodexUsageReading, RateLimitScan, UsageAccount, UsageCacheReading, UsageReport } from "./wire.js";

/**
 * What one pass did, structurally.
 *
 * Compatible with `daemon.ts`'s `UsagePassOutcome` by shape rather than by
 * import — see the header.
 */
export type PassInput =
  | { kind: "take-fresh"; report: UsageReport; why: string; at: string }
  | { kind: "keep-stored"; report: UsageReport; why: string; at: string }
  | { kind: "collector-failed"; why: string; at: string };

function accountUuidOf(account: UsageAccount): string | null {
  return account.kind === "value" ? account.accountUuid : null;
}

function mapWindow(reading: {
  kind: string;
  window: string;
  utilizationPercent?: number;
  resetsAt?: string;
  resetsAtMs?: number;
  why?: string;
}): WindowObservation {
  if (reading.kind === "value" && reading.resetsAt !== undefined && reading.resetsAtMs !== undefined) {
    return {
      kind: "value",
      window: reading.window,
      utilizationPercent: reading.utilizationPercent ?? 0,
      resetsAt: reading.resetsAt,
      resetsAtMs: reading.resetsAtMs,
    };
  }
  if (reading.kind === "expired") {
    return {
      kind: "expired",
      window: reading.window,
      resetsAt: reading.resetsAt ?? null,
      why: reading.why ?? "the window had already reset when this reading was taken",
    };
  }
  return { kind: "unknown", window: reading.window, why: reading.why ?? "no reason given" };
}

/**
 * **A cache reading with no account is `unattributed`, not `unknown`.**
 *
 * They are different failures and the distinction is the whole reason the arm
 * exists: `unknown` means we could not read the cache at all, while
 * `unattributed` means we read it fine and cannot say whose it is — the
 * `/login`-swap case. A chart may plot neither, but only the second is evidence
 * that an account switch happened.
 *
 * Note that the unattributed arm carries **no windows**. Publishing percentages
 * we cannot attribute would put another account's headroom on this account's
 * line, which is worse than showing nothing.
 */
export function cacheObservationOf(cache: UsageCacheReading): CacheObservation {
  if (cache.kind === "unknown") return { kind: "unknown", why: cache.why };
  const accountUuid = cache.accountUuid;
  if (accountUuid === null) {
    return {
      kind: "unattributed",
      why: "the cache carried no account uuid, so these percentages cannot be tied to an account",
    };
  }
  return {
    kind: "attributed",
    accountUuid,
    fetchedAt: new Date(cache.fetchedAtMs).toISOString(),
    windows: cache.windows.map((w) => mapWindow(w)),
  };
}

/**
 * Narrower than the UI's incident: a conversation COUNT rather than the uuid
 * list, which the chart does not need repeated every five minutes and which is
 * the bulk of the payload.
 */
export function scanObservationOf(scan: RateLimitScan): ScanObservation {
  if (scan.kind === "unknown") {
    return { conclusive: false, why: scan.why, incidents: [] };
  }
  const gap = absenceGapReason(scan.coverage);
  const hits: IncidentInput[] =
    scan.kind === "hits"
      ? scan.hits.map((h) => ({
          window: h.window,
          resetsAtMs: h.resetsAtMs,
          hitAtMs: h.hitAtMs,
          claudeSessionId: h.claudeSessionId,
        }))
      : [];
  const incidents: HistoryIncident[] = groupUsageIncidents(hits).map((i) => ({
    id: i.id,
    window: i.window,
    resetsAt: i.resetsAt,
    firstHitAt: i.firstHitAt,
    lastHitAt: i.lastHitAt,
    rejections: i.rejections,
    unidentifiedRejections: i.unidentifiedRejections,
    conversations: i.conversations.length,
  }));
  return { conclusive: gap === null, why: gap, incidents };
}

/**
 * Keep the already-adjudicated Codex reading, but copy it field by field into
 * the independently owned history shape. The explicit mapping keeps the
 * persisted choice visible here, and its focused test pins the fields that a
 * projection could otherwise silently drop.
 */
export function codexObservationOf(reading: CodexUsageReading): CodexObservation {
  if (reading.kind === "unknown") {
    return { kind: "unknown", why: reading.why, retryable: reading.retryable };
  }
  return {
    kind: "value",
    accountId: reading.accountId,
    readAt: reading.readAt,
    buckets: reading.buckets.map((bucket) => ({
      limitId: bucket.limitId,
      limitName: bucket.limitName,
      windows: bucket.windows.map((window) =>
        window.kind === "value"
          ? {
              kind: "value",
              slot: window.slot,
              windowMinutes: window.windowMinutes,
              usedPercent: window.usedPercent,
              resetsAt: window.resetsAt,
              resetsAtMs: window.resetsAtMs,
            }
          : {
              kind: "unknown",
              slot: window.slot,
              windowMinutes: window.windowMinutes,
              why: window.why,
            },
      ),
      planType: bucket.planType,
      credits:
        bucket.credits === null
          ? null
          : {
              hasCredits: bucket.credits.hasCredits,
              unlimited: bucket.credits.unlimited,
              balance: bucket.credits.balance,
            },
      individualLimit:
        bucket.individualLimit === null
          ? null
          : {
              limit: bucket.individualLimit.limit,
              used: bucket.individualLimit.used,
              remainingPercent: bucket.individualLimit.remainingPercent,
              resetsAt: bucket.individualLimit.resetsAt,
            },
      spendControlReached: bucket.spendControlReached,
      rateLimitReachedType: bucket.rateLimitReachedType,
    })),
    resetCredits: reading.resetCredits,
  };
}

export function usageHistoryLineFrom(
  input: PassInput,
  options: { nextDueMs: number; recordedAt: string; codex: CodexUsageReading },
): UsageHistoryLine {
  const pass: UsagePass =
    input.kind === "collector-failed"
      ? { kind: "collector-failed", at: input.at, why: input.why }
      : {
          kind: "pass",
          collectedAt: input.report.collectedAt,
          accountUuid: accountUuidOf(input.report.account),
          cache: cacheObservationOf(input.report.cache),
          scan: scanObservationOf(input.report.rateLimits),
          publication: { decision: input.kind, why: input.why },
        };
  return {
    lineSchema: LINE_SCHEMA,
    summarySchema: SUMMARY_SCHEMA,
    recordedAt: options.recordedAt,
    nextDueMs: options.nextDueMs,
    pass,
    codex: codexObservationOf(options.codex),
  };
}
