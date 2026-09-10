/**
 * **The runtime parser for `GET /api/diagnostics`** — one copy, used by the
 * browser (`web/src/diagnostics-client.ts`) and by `overseer diagnose`, which
 * reads the same route over HTTP (plan 260910f, Sol's F4).
 *
 * Pure and dependency-free on purpose: the browser bundle imports it, so it
 * may not reach `revision.ts` (which spawns git) or anything else with a Node
 * import. Its revision rules are `revision.ts`'s `parseStartRevision`, restated:
 * a full lowercase sha, a boolean `dirty`, and an instant that round-trips
 * through `toISOString`. tests/fleet-diagnostics-route.test.ts sends every
 * answer the real route composes through this parser, so the two cannot drift
 * apart silently.
 *
 * **Strict, and fails whole.** Every field is checked and the value rebuilt
 * from the checked parts; one field that does not parse makes the whole answer
 * `unreadable` with the path of the field, never a partial summary with a hole
 * the page would draw as "nothing to report". Unknown is its own arm in every
 * field of the wire type, so nothing here ever has to default one.
 */
import type {
  BuildStamp,
  BuildStampReading,
  DiagnosticsDaemonStart,
  DiagnosticsInstant,
  DiagnosticsStorePath,
  DiagnosticsSummary,
  StartRevision,
  StoreFileProbe,
} from "./wire.js";

export type DiagnosticsParse = { kind: "summary"; summary: DiagnosticsSummary } | { kind: "unreadable"; why: string };

const SHA = /^[0-9a-f]{40}$/;

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === "object" && u !== null && !Array.isArray(u);
}

/** `revision.ts`'s `isIsoInstant`: a string that is exactly its own `toISOString`. */
function iso(u: unknown): u is string {
  if (typeof u !== "string") return false;
  const parsed = new Date(u);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === u;
}

const text = (u: unknown): u is string => typeof u === "string";

class Refused extends Error {}

/** Throws a `Refused` naming the field; caught once, at the top. */
function need<T>(value: T | null, where: string): T {
  if (value === null) throw new Refused(where);
  return value;
}

export function parseStartRevision(u: unknown): StartRevision | null {
  if (!isRecord(u) || !iso(u["readAt"])) return null;
  const readAt = u["readAt"];
  if (u["kind"] === "known") {
    const sha = u["sha"];
    const dirty = u["dirty"];
    return text(sha) && SHA.test(sha) && typeof dirty === "boolean" ? { kind: "known", sha, dirty, readAt } : null;
  }
  if (u["kind"] === "unknown") return text(u["why"]) ? { kind: "unknown", why: u["why"], readAt } : null;
  return null;
}

/** A build stamp — `__FLEET_BUILD__` or `dist/build-stamp.json` — or null. */
export function parseBuildStamp(u: unknown): BuildStamp | null {
  const revision = parseStartRevision(u);
  if (revision === null || !isRecord(u) || !iso(u["builtAt"])) return null;
  return { ...revision, builtAt: u["builtAt"] };
}

function buildStampReading(u: unknown): BuildStampReading | null {
  if (!isRecord(u)) return null;
  if (u["kind"] === "stamp") {
    const stamp = parseBuildStamp(u["stamp"]);
    return stamp === null ? null : { kind: "stamp", stamp };
  }
  return u["kind"] === "unknown" && text(u["why"]) ? { kind: "unknown", why: u["why"] } : null;
}

function instant(u: unknown): DiagnosticsInstant | null {
  if (!isRecord(u)) return null;
  if (u["kind"] === "at") return iso(u["at"]) ? { kind: "at", at: u["at"] } : null;
  return u["kind"] === "never" && text(u["why"]) ? { kind: "never", why: u["why"] } : null;
}

function storePath(u: unknown): DiagnosticsStorePath | null {
  if (!isRecord(u)) return null;
  const kind = u["kind"];
  if (kind === "default" || kind === "override") {
    return text(u["label"]) && text(u["path"]) ? { kind, label: u["label"], path: u["path"] } : null;
  }
  return kind === "unknown" && text(u["why"]) ? { kind: "unknown", why: u["why"] } : null;
}

function probe(u: unknown): StoreFileProbe | null {
  if (!isRecord(u) || !text(u["name"])) return null;
  const name = u["name"];
  switch (u["state"]) {
    case "absent":
      return { name, state: "absent" };
    case "unreadable":
      return text(u["why"]) ? { name, state: "unreadable", why: u["why"] } : null;
    case "present": {
      const { bytes, mtimeAgeMs, format, schema, schemaUnread, tornTail, lastLineAt } = u;
      if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) return null;
      if (typeof mtimeAgeMs !== "number" || !Number.isFinite(mtimeAgeMs)) return null;
      if (format !== "json" && format !== "jsonl" && format !== "other") return null;
      if (!(schema === null || schema === "none-declared" || (typeof schema === "number" && Number.isFinite(schema)))) return null;
      // `schemaUnread` is the reason for a null schema, and there only.
      if (schema === null ? !text(schemaUnread) : schemaUnread !== null) return null;
      if (!(tornTail === null || typeof tornTail === "boolean")) return null;
      if (lastLineAt !== undefined && !text(lastLineAt)) return null;
      return {
        name,
        state: "present",
        bytes,
        mtimeAgeMs,
        format,
        schema,
        schemaUnread: schemaUnread as string | null,
        tornTail,
        ...(lastLineAt === undefined ? {} : { lastLineAt }),
      };
    }
    default:
      return null;
  }
}

function daemonStart(u: unknown): DiagnosticsDaemonStart | null {
  if (!isRecord(u)) return null;
  if (u["kind"] === "unknown") return text(u["why"]) ? { kind: "unknown", why: u["why"] } : null;
  const instanceId = u["instanceId"];
  const at = u["at"];
  if (!text(instanceId) || !text(at)) return null;
  if (u["kind"] === "not-stamped") return { kind: "not-stamped", instanceId, at };
  if (u["kind"] !== "stamped") return null;
  const revision = parseStartRevision(u["revision"]);
  return revision === null ? null : { kind: "stamped", instanceId, at, revision };
}

function summary(body: Record<string, unknown>): DiagnosticsSummary {
  const composedAt = body["composedAt"];
  if (!iso(composedAt)) throw new Refused("composedAt");
  const dashboard = need(isRecord(body["dashboard"]) ? body["dashboard"] : null, "dashboard");
  const collector = need(isRecord(body["collector"]) ? body["collector"] : null, "collector");
  const store = need(isRecord(body["store"]) ? body["store"] : null, "store");
  const lastErrorRaw = need(isRecord(collector["lastError"]) ? collector["lastError"] : null, "collector.lastError");
  const lastError: DiagnosticsSummary["collector"]["lastError"] =
    lastErrorRaw["kind"] === "none"
      ? { kind: "none" }
      : lastErrorRaw["kind"] === "error" && text(lastErrorRaw["message"])
        ? { kind: "error", message: lastErrorRaw["message"] }
        : need<never>(null, "collector.lastError");
  const filesRaw = need(isRecord(store["files"]) ? store["files"] : null, "store.files");
  let files: DiagnosticsSummary["store"]["files"];
  if (filesRaw["kind"] === "unknown" && text(filesRaw["why"])) {
    files = { kind: "unknown", why: filesRaw["why"] };
  } else if (filesRaw["kind"] === "probed" && Array.isArray(filesRaw["files"])) {
    files = { kind: "probed", files: filesRaw["files"].map((f, i) => need(probe(f), `store.files[${i}]`)) };
  } else {
    throw new Refused("store.files");
  }
  const instance = dashboard["instance"];
  if (!text(instance)) throw new Refused("dashboard.instance");
  return {
    schema: 1,
    composedAt,
    dashboard: {
      instance,
      start: need(parseStartRevision(dashboard["start"]), "dashboard.start"),
      bundleAtStart: need(buildStampReading(dashboard["bundleAtStart"]), "dashboard.bundleAtStart"),
      bundleOnDisk: need(buildStampReading(dashboard["bundleOnDisk"]), "dashboard.bundleOnDisk"),
    },
    collector: {
      attempted: need(instant(collector["attempted"]), "collector.attempted"),
      collected: need(instant(collector["collected"]), "collector.collected"),
      lastError,
    },
    health: need(instant(body["health"]), "health"),
    store: { path: need(storePath(store["path"]), "store.path"), files },
    daemon: need(daemonStart(body["daemon"]), "daemon"),
  };
}

/** A checked summary, or the reason this reader will not guess. */
export function parseDiagnosticsSummary(body: unknown): DiagnosticsParse {
  if (!isRecord(body)) return { kind: "unreadable", why: "the answer is not a JSON object" };
  if (body["schema"] !== 1) return { kind: "unreadable", why: `this reader knows version 1 of the diagnostics answer; it received ${JSON.stringify(body["schema"]) ?? "none"}` };
  if (body["kind"] === "error") {
    return { kind: "unreadable", why: `the dashboard could not compose its diagnostics: ${text(body["why"]) ? body["why"] : "no reason given"}` };
  }
  try {
    return { kind: "summary", summary: summary(body) };
  } catch (cause) {
    if (cause instanceof Refused) return { kind: "unreadable", why: `the diagnostics answer's ${cause.message} does not have the shape this reader knows` };
    throw cause;
  }
}
