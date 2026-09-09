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
  /** Stable identity, so two runs in the same millisecond are two runs. */
  runId: string;
  atMs: number;
  state: ReadinessStateView;
  check: string;
  scope: "full" | "narrowed" | "unknown";
  /**
   * **Three arms, not two.** An unrecognised source used to become `tmux-log`,
   * which is conservative about authority and dishonest about provenance — the
   * panel then labelled it "reconstructed from a log", which was simply untrue.
   * `unknown` cannot vote either, and says what it is.
   */
  source: "wrapper" | "tmux-log" | "unknown";
  commandLine: string | null;
  durationMs: number | null;
  /**
   * **Both ends, because one end cannot say whether a run counts.** The client
   * used to keep only `treeAtStart`, so a run whose checkout moved or went
   * dirty mid-way — which the server's verdict correctly refuses — was drawn
   * with the "this one counts" treatment.
   */
  treeAtStart: TreeView;
  treeAtEnd: TreeView;
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

const SHA = /^[0-9a-f]{40}$/;

/**
 * A tree stamp, or a stated absence.
 *
 * **`dirty` must be an explicit boolean and the sha must be a sha.** Defaulting
 * a missing `dirty` to `false` reads a record that says nothing as one that says
 * *clean*, and clean is the half that lets a run count. The server's own parser
 * enforces the same two rules; this is the browser-side copy, and it is not
 * redundant — a build from before that rule shipped may have written the bytes.
 */
function parseTree(v: unknown): TreeView {
  if (!isRecord(v)) return { kind: "unknown", why: "the server sent no commit for this run" };
  if (v["kind"] === "known") {
    const sha = str(v["sha"]);
    if (sha !== null && SHA.test(sha) && typeof v["dirty"] === "boolean") {
      return { kind: "known", sha, branch: str(v["branch"]), dirty: v["dirty"] };
    }
    return { kind: "unknown", why: "the commit this run reports is not one this build can read" };
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
    runId: str(record["runId"]) ?? `${check}-${atMs}`,
    atMs,
    state,
    check,
    scope: scope === "full" || scope === "narrowed" ? scope : "unknown",
    source: source === "wrapper" ? "wrapper" : source === "tmux-log" ? "tmux-log" : "unknown",
    commandLine: str(record["commandLine"]),
    durationMs: num(record["durationMs"]),
    treeAtStart: parseTree(record["treeAtStart"]),
    /* A run still going has no end stamp yet, and that is not a fault — it is
       simply not a run that can count, which `provenanceOf` decides. */
    treeAtEnd: parseTree(record["treeAtEnd"]),
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
  const rawSha = str(raw["sha"]);
  /* **A `ready` arm carrying "yes" for a sha is not a ready verdict.** The
     recognised arms were accepted on any string, which is the hole in "anything
     unrecognised becomes a stated unknown": the unrecognised ARM was handled and
     the malformed CONTENTS of a recognised one were not. */
  const sha = rawSha !== null && SHA.test(rawSha) ? rawSha : null;
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
  /* **The schema is checked, and it was not.** A payload stamped `schema: 2` —
     a server deployed under this page while it sat open on a phone — was being
     read field by field by a parser written for schema 1, and a `ready` verdict
     in it rendered green. Refusing the whole envelope is the only safe move: we
     do not know what the fields mean any more. */
  if (raw["schema"] !== 1) {
    return {
      kind: "unavailable",
      why: `the server is speaking readiness schema ${JSON.stringify(raw["schema"])} and this page reads 1 — reload to get a matching build`,
    };
  }
  /* **Absent is not empty.** `readings: undefined` used to become `[]` and a
     missing `diagnostics` became "0 checkouts; nothing unreadable or skipped" —
     a reassuring sentence manufactured out of nothing at all. */
  if (!Array.isArray(raw["readings"]) || !isRecord(raw["diagnostics"])) {
    return {
      kind: "unavailable",
      why: "the server's answer was missing its readings or its diagnostics, so what is absent from it cannot be told from what is empty",
    };
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
