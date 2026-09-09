/**
 * Reading `/api/usage/history` in the browser.
 *
 * **Tolerant on the way in, typed on the way out.** These bytes crossed a
 * version boundary — the page may be older or newer than the server, and after a
 * rollback it will be — so nothing here trusts a field's presence. A record it
 * cannot understand becomes an *unsupported* sample that keeps its position
 * rather than disappearing, because a series that silently closes over data it
 * could not read claims continuous observation of a period it never saw.
 *
 * Mirrors `health-history-client.ts`. The one thing to know that is different:
 * there is no `retention` here. Health's writer and route share a process, so
 * its page can be told how the writer is doing; ours are two processes, and the
 * route answers the weaker honest question — *is anything still being recorded*
 * — from the records themselves. See `routes-usage-history.ts`.
 */
export const USAGE_HISTORY_URL = "api/usage/history";

export type UsageWindowView =
  | { kind: "value"; window: string; utilizationPercent: number; resetsAt: string; resetsAtMs: number }
  | { kind: "expired"; window: string; resetsAt: string | null; why: string }
  | { kind: "unknown"; window: string; why: string };

export type UsageCacheView =
  | { kind: "attributed"; accountUuid: string; fetchedAt: string; windows: UsageWindowView[] }
  | { kind: "unattributed"; why: string }
  | { kind: "unknown"; why: string };

export type UsageIncidentView = {
  id: string;
  window: string;
  resetsAt: string;
  firstHitAt: string | null;
  lastHitAt: string | null;
  rejections: number;
  unidentifiedRejections: number;
  conversations: number;
};

export type UsagePassView =
  | {
      kind: "pass";
      collectedAt: string;
      accountUuid: string | null;
      cache: UsageCacheView;
      scan: { conclusive: boolean; why: string | null; incidents: UsageIncidentView[] };
      publication: { decision: "take-fresh" | "keep-stored"; why: string };
    }
  | { kind: "collector-failed"; at: string; why: string }
  | { kind: "omitted"; at: string; why: string };

export type CodexWindowView =
  | {
      kind: "value";
      /** Source position is provenance only; duration names the window. */
      slot: "primary" | "secondary";
      windowMinutes: number;
      usedPercent: number;
      resetsAt: string;
      resetsAtMs: number;
    }
  | { kind: "unknown"; slot: "primary" | "secondary"; windowMinutes: number | null; why: string };

export type CodexBucketView = {
  limitId: string;
  limitName: string | null;
  windows: CodexWindowView[];
  planType: string | null;
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
  individualLimit: { limit: string; used: string; remainingPercent: number; resetsAt: number } | null;
  spendControlReached: boolean | null;
  rateLimitReachedType: string | null;
};

export type CodexRecordedObservationView =
  | { kind: "value"; accountId: string | null; readAt: string; buckets: CodexBucketView[]; resetCredits: number | null }
  | { kind: "unknown"; why: string; retryable: boolean };

/**
 * The latest attempt as the card sees it. `absent` is deliberately not the
 * persisted `unknown` arm: it means the record came from a writer predating
 * Codex collection, not that this writer tried and failed.
 */
export type CodexObservationView =
  | CodexRecordedObservationView
  | { kind: "absent"; why: string };

export type UsageHistorySample =
  | {
      kind: "sample";
      sourceAtMs: number;
      line: { nextDueMs: number; recordedAt: string; pass: UsagePassView; codex?: CodexRecordedObservationView };
    }
  | { kind: "omitted"; sourceAtMs: number; why: string }
  | { kind: "unsupported"; summarySchema: number | null; why: string };

export type RecorderView = {
  lastRecordedAt: string | null;
  expectedEveryMs: number | null;
  overdueByMs: number | null;
};

export type UsageHistoryView =
  | {
      kind: "history";
      windowHours: number;
      fromMs: number;
      toMs: number;
      samples: UsageHistorySample[];
      predecessor: UsageHistorySample | null;
      holes: { afterAt: string | null; beforeAt: string | null }[];
      earliestAt: string | null;
      rotated: boolean;
      unreadableLines: number;
      unsupportedLines: number;
      recorder: RecorderView;
      refreshMs: number;
      /** Parsed from every raw record in file order, including unreadable markers. */
      latestCodex: CodexObservationView;
    }
  | { kind: "unreadable"; why: string };

function obj(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}
function str(raw: unknown): string | null {
  return typeof raw === "string" ? raw : null;
}
function num(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function bool(raw: unknown): boolean | null {
  return typeof raw === "boolean" ? raw : null;
}

function instant(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? raw : null;
}

function nullableString(raw: unknown): string | null | undefined {
  return raw === null || typeof raw === "string" ? raw : undefined;
}

function malformedCodex(why: string): CodexRecordedObservationView {
  return { kind: "unknown", why: `the Codex observation was malformed: ${why}`, retryable: false };
}

function parseCodexWindow(raw: unknown, readAtMs: number): CodexWindowView | null {
  const w = obj(raw);
  const slot = w?.["slot"];
  if (w === null || (slot !== "primary" && slot !== "secondary")) return null;
  const rawWindowMinutes = w["windowMinutes"];
  const windowMinutes = rawWindowMinutes === null ? null : num(rawWindowMinutes);
  if (w["kind"] === "unknown") {
    const why = str(w["why"]);
    if (
      why === null || why.length === 0 ||
      (rawWindowMinutes !== null && windowMinutes === null) ||
      (windowMinutes !== null && (!Number.isSafeInteger(windowMinutes) || windowMinutes <= 0))
    ) return null;
    return { kind: "unknown", slot, windowMinutes, why };
  }
  if (w["kind"] !== "value" || windowMinutes === null || !Number.isSafeInteger(windowMinutes) || windowMinutes <= 0) {
    return null;
  }
  const usedPercent = num(w["usedPercent"]);
  const resetsAt = instant(w["resetsAt"]);
  const resetsAtMs = num(w["resetsAtMs"]);
  const latestPossible = readAtMs + windowMinutes * 60_000;
  if (
    usedPercent === null || usedPercent < 0 || resetsAt === null || resetsAtMs === null ||
    !Number.isSafeInteger(resetsAtMs) || !Number.isSafeInteger(latestPossible) ||
    Date.parse(resetsAt) !== resetsAtMs || resetsAtMs <= readAtMs || resetsAtMs > latestPossible
  ) return null;
  return { kind: "value", slot, windowMinutes, usedPercent, resetsAt, resetsAtMs };
}

function parseCodexBucket(raw: unknown, readAtMs: number): CodexBucketView | null {
  const b = obj(raw);
  const limitId = str(b?.["limitId"]);
  const limitName = nullableString(b?.["limitName"]);
  const planType = nullableString(b?.["planType"]);
  const reached = nullableString(b?.["rateLimitReachedType"]);
  const spend = b?.["spendControlReached"] === null ? null : bool(b?.["spendControlReached"]);
  if (b === null || limitId === null || limitId.length === 0 || limitName === undefined || planType === undefined || reached === undefined || spend === null && b["spendControlReached"] !== null) return null;

  const rawCredits = b["credits"];
  let credits: CodexBucketView["credits"] = null;
  if (rawCredits !== null) {
    const c = obj(rawCredits);
    const hasCredits = bool(c?.["hasCredits"]);
    const unlimited = bool(c?.["unlimited"]);
    const balance = nullableString(c?.["balance"]);
    if (c === null || hasCredits === null || unlimited === null || balance === undefined) return null;
    credits = { hasCredits, unlimited, balance };
  }

  const rawIndividual = b["individualLimit"];
  let individualLimit: CodexBucketView["individualLimit"] = null;
  if (rawIndividual !== null) {
    const i = obj(rawIndividual);
    const limit = str(i?.["limit"]);
    const used = str(i?.["used"]);
    const remainingPercent = num(i?.["remainingPercent"]);
    const resetsAt = num(i?.["resetsAt"]);
    if (i === null || limit === null || used === null || remainingPercent === null || !Number.isInteger(remainingPercent) || resetsAt === null || !Number.isSafeInteger(resetsAt)) return null;
    individualLimit = { limit, used, remainingPercent, resetsAt };
  }

  if (!Array.isArray(b["windows"])) return null;
  const windows = b["windows"].map((w) => parseCodexWindow(w, readAtMs));
  if (windows.some((w) => w === null)) return null;
  return {
    limitId,
    limitName,
    windows: windows as CodexWindowView[],
    planType,
    credits,
    individualLimit,
    spendControlReached: spend,
    rateLimitReachedType: reached,
  };
}

function parseCodex(raw: unknown): CodexRecordedObservationView {
  const c = obj(raw);
  if (c === null) return malformedCodex("it was not an object");
  if (c["kind"] === "unknown") {
    const why = str(c["why"]);
    const retryable = bool(c["retryable"]);
    return why !== null && why.length > 0 && retryable !== null
      ? { kind: "unknown", why, retryable }
      : malformedCodex("its unknown arm had no reason or retryability");
  }
  if (c["kind"] !== "value") return malformedCodex("it had an unknown kind");
  const readAt = instant(c["readAt"]);
  const accountId = nullableString(c["accountId"]);
  const resetCredits = c["resetCredits"] === null ? null : num(c["resetCredits"]);
  if (readAt === null || accountId === undefined || (typeof accountId === "string" && accountId.length === 0)) {
    return malformedCodex("its identity or readAt was invalid");
  }
  if (resetCredits === null ? c["resetCredits"] !== null : !Number.isSafeInteger(resetCredits) || resetCredits < 0) {
    return malformedCodex("its reset-credit count was invalid");
  }
  if (!Array.isArray(c["buckets"])) return malformedCodex("its buckets were not an array");
  const buckets = c["buckets"].map((b) => parseCodexBucket(b, Date.parse(readAt)));
  if (buckets.some((b) => b === null)) return malformedCodex("one of its buckets or windows was invalid");
  return { kind: "value", accountId, readAt, buckets: buckets as CodexBucketView[], resetCredits };
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

function codexAttempt(raw: unknown): CodexObservationView {
  const sample = obj(raw);
  if (sample === null) return { kind: "unknown", why: "the newest history sample was unreadable", retryable: false };
  if (sample["kind"] === "unsupported") {
    return { kind: "unknown", why: "the newest history sample was written by an unsupported build", retryable: false };
  }
  if (sample["kind"] === "omitted") {
    return { kind: "unknown", why: `the newest history sample was omitted: ${str(sample["why"]) ?? "no reason was recorded"}`, retryable: false };
  }
  const line = obj(sample["line"]);
  if (sample["kind"] !== "sample" || line === null) {
    return { kind: "unknown", why: "the newest history sample was unreadable", retryable: false };
  }
  if (!hasOwn(line, "codex")) {
    return { kind: "absent", why: "this history record predates Codex usage collection" };
  }
  return parseCodex(line["codex"]);
}

function parseWindow(raw: unknown): UsageWindowView | null {
  const w = obj(raw);
  const window = str(w?.["window"]);
  if (w === null || window === null) return null;
  if (w["kind"] === "value") {
    const pct = num(w["utilizationPercent"]);
    const resetsAt = str(w["resetsAt"]);
    const resetsAtMs = num(w["resetsAtMs"]);
    if (pct === null || resetsAt === null || resetsAtMs === null) return null;
    return { kind: "value", window, utilizationPercent: pct, resetsAt, resetsAtMs };
  }
  if (w["kind"] === "expired") {
    return { kind: "expired", window, resetsAt: str(w["resetsAt"]), why: str(w["why"]) ?? "" };
  }
  return { kind: "unknown", window, why: str(w["why"]) ?? "" };
}

function parseCache(raw: unknown): UsageCacheView {
  const c = obj(raw);
  if (c === null) return { kind: "unknown", why: "the record carried no cache reading" };
  if (c["kind"] === "attributed") {
    const accountUuid = str(c["accountUuid"]);
    if (accountUuid === null) {
      /* A cache claiming attribution with no uuid is not attributed. Believing
         it would put an unknown account's headroom on a named account's line. */
      return { kind: "unattributed", why: "the record claimed an account and named none" };
    }
    const windows = Array.isArray(c["windows"]) ? c["windows"] : [];
    return {
      kind: "attributed",
      accountUuid,
      fetchedAt: str(c["fetchedAt"]) ?? "",
      windows: windows.map(parseWindow).filter((w): w is UsageWindowView => w !== null),
    };
  }
  if (c["kind"] === "unattributed") return { kind: "unattributed", why: str(c["why"]) ?? "" };
  return { kind: "unknown", why: str(c["why"]) ?? "" };
}

function parseIncident(raw: unknown): UsageIncidentView | null {
  const i = obj(raw);
  const id = str(i?.["id"]);
  const window = str(i?.["window"]);
  const resetsAt = str(i?.["resetsAt"]);
  if (i === null || id === null || window === null || resetsAt === null) return null;
  return {
    id,
    window,
    resetsAt,
    firstHitAt: str(i["firstHitAt"]),
    lastHitAt: str(i["lastHitAt"]),
    rejections: num(i["rejections"]) ?? 0,
    unidentifiedRejections: num(i["unidentifiedRejections"]) ?? 0,
    conversations: num(i["conversations"]) ?? 0,
  };
}

function parsePass(raw: unknown): UsagePassView | null {
  const p = obj(raw);
  if (p === null) return null;
  if (p["kind"] === "collector-failed" || p["kind"] === "omitted") {
    const at = str(p["at"]);
    if (at === null) return null;
    return { kind: p["kind"], at, why: str(p["why"]) ?? "" };
  }
  if (p["kind"] !== "pass") return null;
  const collectedAt = str(p["collectedAt"]);
  if (collectedAt === null) return null;
  const scan = obj(p["scan"]);
  const publication = obj(p["publication"]);
  const decision = publication?.["decision"];
  return {
    kind: "pass",
    collectedAt,
    accountUuid: str(p["accountUuid"]),
    cache: parseCache(p["cache"]),
    scan: {
      conclusive: scan?.["conclusive"] === true,
      why: str(scan?.["why"]),
      incidents: (Array.isArray(scan?.["incidents"]) ? scan["incidents"] : [])
        .map(parseIncident)
        .filter((i): i is UsageIncidentView => i !== null),
    },
    publication: {
      decision: decision === "keep-stored" ? "keep-stored" : "take-fresh",
      why: str(publication?.["why"]) ?? "",
    },
  };
}

export function parseSample(raw: unknown): UsageHistorySample | null {
  const s = obj(raw);
  if (s === null) return null;
  if (s["kind"] === "unsupported") {
    return { kind: "unsupported", summarySchema: num(s["summarySchema"]), why: str(s["why"]) ?? "" };
  }
  const sourceAtMs = num(s["sourceAtMs"]);
  if (sourceAtMs === null) return null;
  if (s["kind"] === "omitted") return { kind: "omitted", sourceAtMs, why: str(s["why"]) ?? "" };
  const line = obj(s["line"]);
  const pass = parsePass(line?.["pass"]);
  if (line === null || pass === null) return null;
  const codex = hasOwn(line, "codex") ? parseCodex(line["codex"]) : undefined;
  return {
    kind: "sample",
    sourceAtMs,
    line: {
      nextDueMs: num(line["nextDueMs"]) ?? 300_000,
      recordedAt: str(line["recordedAt"]) ?? "",
      pass,
      ...(codex === undefined ? {} : { codex }),
    },
  };
}

/**
 * The newest Codex ATTEMPT, never the greatest `readAt`.
 *
 * The route is already oldest-first, including the predecessor. A newer
 * unknown, legacy, omitted, unreadable or unsupported record therefore wins:
 * keeping an older percentage would present a known-old value as current
 * merely because the latest attempt failed.
 */
export function newestCodexObservation(view: UsageHistoryView): CodexObservationView {
  if (view.kind === "unreadable") {
    return { kind: "unknown", why: `Codex usage history could not be read: ${view.why}`, retryable: true };
  }
  return view.latestCodex;
}

export function parseUsageHistory(raw: unknown): UsageHistoryView {
  const r = obj(raw);
  if (r === null) return { kind: "unreadable", why: "the server's answer was not an object" };
  if (r["kind"] === "unreadable") {
    return { kind: "unreadable", why: str(r["why"]) ?? "the server did not say why" };
  }
  /* THE ENVELOPE'S OWN VERSION, checked before anything is read out of it.
     Ignoring it defeated the whole point of the tolerant parser: an old cached
     client handed `{schema: 2}` accepted it as current, and if schema 2 had
     moved the sample fields it would drop them all and say nothing was
     recorded — the version boundary failing silently in the one direction it
     exists to catch. GPT Sol H13. */
  const schema = num(r["schema"]);
  if (schema !== null && schema !== 1) {
    return {
      kind: "unreadable",
      why: `this page reads usage history schema 1 and the server sent ${schema}. Reload to get the matching page.`,
    };
  }
  const fromMs = num(r["fromMs"]);
  const toMs = num(r["toMs"]);
  if (r["kind"] !== "history" || fromMs === null || toMs === null) {
    /* NOT an empty history. A payload we cannot read and a day in which nothing
       happened are different answers, and only one of them is the page's fault. */
    return { kind: "unreadable", why: "the server's answer had no readable window" };
  }
  const recorder = obj(r["recorder"]);
  const rawSamples = Array.isArray(r["samples"]) ? r["samples"] : [];
  const rawPredecessor = r["predecessor"];
  const attempts = [...(rawPredecessor === null || rawPredecessor === undefined ? [] : [rawPredecessor]), ...rawSamples];
  const holes = (Array.isArray(r["holes"]) ? r["holes"] : []).map((h) => ({
    afterAt: str(obj(h)?.["afterAt"]),
    beforeAt: str(obj(h)?.["beforeAt"]),
  }));
  /* A trailing unreadable physical line is newer than the last decodable
     sample even though it has no sample object of its own. The null right edge
     is the route's positional marker for exactly that case. */
  const trailingUnreadable = holes.some((hole) => hole.beforeAt === null);
  return {
    kind: "history",
    windowHours: num(r["windowHours"]) ?? 24,
    fromMs,
    toMs,
    samples: rawSamples
      .map(parseSample)
      .filter((s): s is UsageHistorySample => s !== null),
    predecessor: parseSample(rawPredecessor),
    holes,
    earliestAt: str(r["earliestAt"]),
    rotated: r["rotated"] === true,
    unreadableLines: num(r["unreadableLines"]) ?? 0,
    unsupportedLines: num(r["unsupportedLines"]) ?? 0,
    recorder: {
      lastRecordedAt: str(recorder?.["lastRecordedAt"]),
      expectedEveryMs: num(recorder?.["expectedEveryMs"]),
      overdueByMs: num(recorder?.["overdueByMs"]),
    },
    refreshMs: num(r["refreshMs"]) ?? 60_000,
    latestCodex: trailingUnreadable
      ? { kind: "unknown", why: "the newest usage-history line could not be read", retryable: false }
      : attempts.length === 0
        ? { kind: "absent", why: "no Codex usage attempt has been recorded yet" }
        : codexAttempt(attempts.at(-1)),
  };
}

export type UsageHistoryApi = { window: (hours: number) => Promise<UsageHistoryView> };

export function makeUsageHistoryApi(fetchImpl: typeof fetch = fetch): UsageHistoryApi {
  return {
    async window(hours: number): Promise<UsageHistoryView> {
      try {
        const res = await fetchImpl(`${USAGE_HISTORY_URL}?hours=${encodeURIComponent(String(hours))}`);
        if (!res.ok) return { kind: "unreadable", why: `the server answered ${res.status}` };
        return parseUsageHistory(await res.json());
      } catch (err) {
        return { kind: "unreadable", why: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export const httpUsageHistoryApi: UsageHistoryApi = {
  window: (hours) => makeUsageHistoryApi().window(hours),
};
