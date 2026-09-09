/**
 * `GET /api/readiness`, turned into something the panel can draw.
 *
 * **Validated per arm, never cast.** These bytes crossed a persistence boundary
 * and a version boundary: the server may be a build from before this bundle was
 * loaded — the dashboard is a long-lived page on a phone and a deploy happens
 * under it — so a `fetch().json()` result is `unknown` until something has
 * looked at it. The same discipline `health-history-client.ts` uses, for the
 * same reason.
 *
 * Anything unrecognised becomes a **stated** unknown rather than a default. A
 * field this build does not understand must not silently become a green tick.
 */

export type ReadinessStateView = "pass" | "fail" | "void" | "running";

export type TreeView =
  | { kind: "known"; sha: string; branch: string | null; dirty: boolean }
  | { kind: "unknown"; why: string };

export type ReadingView = {
  atMs: number;
  state: ReadinessStateView;
  check: string;
  scope: "full" | "narrowed" | "unknown";
  source: "wrapper" | "tmux-log";
  commandLine: string | null;
  durationMs: number | null;
  tree: TreeView;
  logPath: string | null;
  why: string | null;
  /** Whatever numbers the check reported, unvalidated beyond its arm. */
  counts: unknown;
};

export type EvidenceView = {
  check: string;
  state: "pass" | "fail" | "void" | "running" | "missing";
  why: string;
};

export type VerdictView =
  | { kind: "ready"; sha: string; evidence: EvidenceView[]; caveat: string }
  | { kind: "not-ready"; sha: string; failing: EvidenceView[]; evidence: EvidenceView[]; caveat: string }
  | { kind: "unknown"; why: string; sha: string | null; evidence: EvidenceView[] };

export type DevView =
  | {
      kind: "known";
      devSha: string;
      primarySha: string | null;
      primaryBehind: number | null;
      trunkGap: number | null;
      observedAt: string;
      caveat: string;
    }
  | { kind: "unknown"; why: string; observedAt: string };

export type DiagnosticsView = {
  unreadableRecords: number;
  unreadableLogs: number;
  unreadableRoots: { root: string; why: string }[];
  scanTruncated: boolean;
  rootsTruncated: boolean;
  logsSkippedForBudget: number;
  checkoutsScanned: number;
  storeRefused: string | null;
  tmuxWhy: string | null;
};

export type ReadinessView =
  | {
      kind: "readiness";
      collectedAtMs: number;
      windowHours: number;
      refreshMs: number;
      readings: ReadingView[];
      verdict: VerdictView;
      dev: DevView;
      diagnostics: DiagnosticsView;
    }
  /** We could not get an answer at all — distinct from an answer of "unknown". */
  | { kind: "unavailable"; why: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseTree(v: unknown): TreeView {
  if (!isRecord(v)) return { kind: "unknown", why: "the server sent no commit for this run" };
  if (v["kind"] === "known") {
    const sha = str(v["sha"]);
    if (sha !== null) {
      return { kind: "known", sha, branch: str(v["branch"]), dirty: v["dirty"] === true };
    }
  }
  return { kind: "unknown", why: str(v["why"]) ?? "no reason was given" };
}

function parseReading(raw: unknown): ReadingView | null {
  if (!isRecord(raw)) return null;
  const record = raw["record"];
  if (!isRecord(record)) return null;
  const atMs = num(raw["atMs"]);
  const state = raw["state"];
  const check = str(record["check"]);
  if (atMs === null || check === null) return null;
  if (state !== "pass" && state !== "fail" && state !== "void" && state !== "running") return null;
  const scope = record["scope"];
  const source = record["source"];
  return {
    atMs,
    state,
    check,
    scope: scope === "full" || scope === "narrowed" ? scope : "unknown",
    /* An unrecognised source reads as the WEAKER one, which cannot vote. A
       reading we cannot place must not be promoted by accident. */
    source: source === "wrapper" ? "wrapper" : "tmux-log",
    commandLine: str(record["commandLine"]),
    durationMs: num(record["durationMs"]),
    tree: parseTree(record["treeAtStart"]),
    logPath: str(record["logPath"]),
    why: str(raw["why"]),
    counts: record["counts"],
  };
}

function parseEvidence(raw: unknown): EvidenceView[] {
  if (!Array.isArray(raw)) return [];
  const out: EvidenceView[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const check = str(item["check"]);
    const state = item["state"];
    if (check === null) continue;
    if (state !== "pass" && state !== "fail" && state !== "void" && state !== "running" && state !== "missing") {
      continue;
    }
    out.push({ check, state, why: str(item["why"]) ?? "" });
  }
  return out;
}

function parseVerdict(raw: unknown): VerdictView {
  if (!isRecord(raw)) {
    return { kind: "unknown", why: "the server sent no verdict", sha: null, evidence: [] };
  }
  const evidence = parseEvidence(raw["evidence"]);
  const sha = str(raw["sha"]);
  const caveat = str(raw["caveat"]) ?? "";
  if (raw["kind"] === "ready" && sha !== null) return { kind: "ready", sha, evidence, caveat };
  if (raw["kind"] === "not-ready" && sha !== null) {
    return { kind: "not-ready", sha, failing: parseEvidence(raw["failing"]), evidence, caveat };
  }
  /* **Anything else is unknown, including a `kind` this build does not know.**
     Falling back to `ready` for an unrecognised arm is the one mistake here
     that would matter. */
  return {
    kind: "unknown",
    why: str(raw["why"]) ?? "this build does not understand the verdict the server sent",
    sha,
    evidence,
  };
}

function parseDev(raw: unknown): DevView {
  const observedAt = (isRecord(raw) ? str(raw["observedAt"]) : null) ?? "";
  if (!isRecord(raw)) return { kind: "unknown", why: "the server sent nothing about dev", observedAt };
  if (raw["kind"] === "known") {
    const devSha = str(raw["devSha"]);
    if (devSha !== null) {
      return {
        kind: "known",
        devSha,
        primarySha: str(raw["primarySha"]),
        primaryBehind: num(raw["primaryBehind"]),
        trunkGap: num(raw["trunkGap"]),
        observedAt,
        caveat: str(raw["caveat"]) ?? "",
      };
    }
  }
  return { kind: "unknown", why: str(raw["why"]) ?? "no reason was given", observedAt };
}

function parseDiagnostics(raw: unknown): DiagnosticsView {
  const rec = isRecord(raw) ? raw : {};
  const roots: { root: string; why: string }[] = [];
  if (Array.isArray(rec["unreadableRoots"])) {
    for (const item of rec["unreadableRoots"]) {
      if (!isRecord(item)) continue;
      const root = str(item["root"]);
      if (root !== null) roots.push({ root, why: str(item["why"]) ?? "" });
    }
  }
  const count = (v: unknown): number => (Array.isArray(v) ? v.length : (num(v) ?? 0));
  return {
    unreadableRecords: count(rec["unreadableRecords"]),
    unreadableLogs: count(rec["unreadableLogs"]),
    unreadableRoots: roots,
    scanTruncated: rec["scanTruncated"] === true,
    rootsTruncated: rec["rootsTruncated"] === true,
    logsSkippedForBudget: num(rec["logsSkippedForBudget"]) ?? 0,
    checkoutsScanned: num(rec["checkoutsScanned"]) ?? 0,
    storeRefused: str(rec["storeRefused"]),
    tmuxWhy: str(rec["tmuxWhy"]),
  };
}

export function parseReadiness(raw: unknown): ReadinessView {
  if (!isRecord(raw)) {
    return { kind: "unavailable", why: "the server's answer was not an object" };
  }
  if (raw["kind"] === "unavailable") {
    return { kind: "unavailable", why: str(raw["why"]) ?? "no reason was given" };
  }
  if (raw["kind"] !== "readiness") {
    return { kind: "unavailable", why: "this build does not understand the answer the server sent" };
  }
  const collectedAtMs = Date.parse(str(raw["collectedAt"]) ?? "");
  if (Number.isNaN(collectedAtMs)) {
    /* **Never `Date.now()` here.** Substituting our own clock for a stamp the
       server did not send would draw a stale answer as a fresh one, which is
       the specific thing `collectedAt` exists to prevent. */
    return { kind: "unavailable", why: "the server's answer carried no usable collection time" };
  }
  const readings: ReadingView[] = [];
  if (Array.isArray(raw["readings"])) {
    for (const item of raw["readings"]) {
      const parsed = parseReading(item);
      if (parsed !== null) readings.push(parsed);
    }
  }
  return {
    kind: "readiness",
    collectedAtMs,
    windowHours: num(raw["windowHours"]) ?? 24,
    refreshMs: num(raw["refreshMs"]) ?? 60_000,
    readings,
    verdict: parseVerdict(raw["verdict"]),
    dev: parseDev(raw["dev"]),
    diagnostics: parseDiagnostics(raw["diagnostics"]),
  };
}

export const READINESS_URL = "api/readiness";

export type ReadinessApi = { fetch: () => Promise<ReadinessView> };

export function makeReadinessApi(fetchImpl: typeof fetch = fetch): ReadinessApi {
  return {
    async fetch(): Promise<ReadinessView> {
      try {
        const res = await fetchImpl(READINESS_URL, { headers: { accept: "application/json" } });
        if (!res.ok) return { kind: "unavailable", why: `the server answered ${res.status}` };
        return parseReadiness(await res.json());
      } catch (err) {
        return {
          kind: "unavailable",
          why: `could not reach the server: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

export const httpReadinessApi: ReadinessApi = {
  fetch: () => makeReadinessApi().fetch(),
};
