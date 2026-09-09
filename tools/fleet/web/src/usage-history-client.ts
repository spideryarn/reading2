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

export type UsageHistorySample =
  | { kind: "sample"; sourceAtMs: number; line: { nextDueMs: number; recordedAt: string; pass: UsagePassView } }
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
  return {
    kind: "sample",
    sourceAtMs,
    line: { nextDueMs: num(line["nextDueMs"]) ?? 300_000, recordedAt: str(line["recordedAt"]) ?? "", pass },
  };
}

export function parseUsageHistory(raw: unknown): UsageHistoryView {
  const r = obj(raw);
  if (r === null) return { kind: "unreadable", why: "the server's answer was not an object" };
  if (r["kind"] === "unreadable") {
    return { kind: "unreadable", why: str(r["why"]) ?? "the server did not say why" };
  }
  const fromMs = num(r["fromMs"]);
  const toMs = num(r["toMs"]);
  if (r["kind"] !== "history" || fromMs === null || toMs === null) {
    /* NOT an empty history. A payload we cannot read and a day in which nothing
       happened are different answers, and only one of them is the page's fault. */
    return { kind: "unreadable", why: "the server's answer had no readable window" };
  }
  const recorder = obj(r["recorder"]);
  return {
    kind: "history",
    windowHours: num(r["windowHours"]) ?? 24,
    fromMs,
    toMs,
    samples: (Array.isArray(r["samples"]) ? r["samples"] : [])
      .map(parseSample)
      .filter((s): s is UsageHistorySample => s !== null),
    predecessor: parseSample(r["predecessor"]),
    holes: (Array.isArray(r["holes"]) ? r["holes"] : []).map((h) => ({
      afterAt: str(obj(h)?.["afterAt"]),
      beforeAt: str(obj(h)?.["beforeAt"]),
    })),
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
