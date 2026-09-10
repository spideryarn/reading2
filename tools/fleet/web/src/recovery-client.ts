/**
 * The recovery inventory — `GET /api/recovery`.
 *
 * The server has five arms. This client adds `no-answer`: this browser timed
 * out, could not reach the box, or received bytes it cannot understand. That is
 * kept apart from `absent` and `unreadable` so a phone's own network trouble
 * never appears in the server's voice (the rule decisions-client.ts states).
 *
 * The factory takes its request leaf, so this module's tests exercise the real
 * timeout, JSON and strict-parser path without stubbing global `fetch`.
 *
 * **The parser is strict and fails whole.** A record that does not parse makes
 * the whole answer `no-answer`, never a shorter list: a record dropped here is
 * interrupted work nobody is shown.
 *
 * **And the answer must agree with itself** (Sol's F30). Every field can parse
 * and the whole still be a contradiction — a row classified `interrupted` under
 * a view that says nothing has been checked yet, or more unresolved rows than
 * the counts say exist — and drawn as it is, the page would state both halves
 * side by side. `contradiction` holds the server's cross-field contract
 * (recovery-feed.ts § the projection); a violation is `no-answer`.
 */
import type {
  RecoveryFeed,
  RecoveryWireClass,
  RecoveryWireEvidence,
  RecoveryWireLiveRow,
  RecoveryWireRecord,
  RecoveryWireRecordState,
  RecoveryWireResolution,
  RecoveryWireTranscript,
} from "../../wire";

export const RECOVERY_URL = "api/recovery";
export const RECOVERY_FETCH_TIMEOUT_MS = 10_000;

export type RecoveryView = RecoveryFeed | { kind: "no-answer"; why: string };
export type RecoveryApi = { fetch(signal?: AbortSignal): Promise<RecoveryView> };
export type RecoveryRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function iso(value: unknown): value is string {
  return typeof value === "string" && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

function text(value: unknown): value is string {
  return typeof value === "string";
}

function nonBlank(value: unknown): value is string {
  return text(value) && value.trim() !== "";
}

function textOrNull(value: unknown): value is string | null {
  return value === null || text(value);
}

function isoOrNull(value: unknown): value is string | null {
  return value === null || iso(value);
}

function whole(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

function resolution(value: unknown): value is Exclude<RecoveryWireResolution, { disposition: "unresolved" }> {
  if (!isRecord(value) || !iso(value["at"]) || !isRecord(value["evidence"])) return false;
  const e = value["evidence"];
  switch (value["disposition"]) {
    case "resumed":
      return nonBlank(e["previousToken"]) && nonBlank(e["token"]) && nonBlank(e["conversationId"]);
    case "superseded":
      return nonBlank(e["by"]);
    case "dismissed":
      return nonBlank(e["requestId"]) && text(e["why"]);
    default:
      return false;
  }
}

function liveRow(value: unknown): value is RecoveryWireLiveRow {
  return (
    isRecord(value) &&
    nonBlank(value["tmuxId"]) &&
    text(value["name"]) &&
    nonBlank(value["statusKey"]) &&
    textOrNull(value["dir"]) &&
    textOrNull(value["claimedConversationId"]) &&
    textOrNull(value["executionToken"]) &&
    textOrNull(value["conversationId"])
  );
}

function classification(value: unknown): value is RecoveryWireClass {
  if (!isRecord(value) || !nonBlank(value["why"])) return false;
  switch (value["kind"]) {
    case "unknown":
    case "interrupted":
      return true;
    case "ended-before-reboot":
      return nonBlank(value["statusKey"]) && iso(value["observedAt"]);
    case "already-live":
      return (value["sameRun"] === null || typeof value["sameRun"] === "boolean") && liveRow(value["row"]);
    case "present-but-unmatched":
      return liveRow(value["row"]);
    default:
      return false;
  }
}

function transcript(value: unknown): value is RecoveryWireTranscript {
  if (!isRecord(value)) return false;
  switch (value["kind"]) {
    case "found":
      return nonBlank(value["conversationId"]) && nonBlank(value["path"]) && oneOf(value["via"], ["slug-guess", "scan"]) && isoOrNull(value["mtime"]);
    case "found-under-claim":
      return nonBlank(value["claimedConversationId"]) && nonBlank(value["path"]) && isoOrNull(value["mtime"]) && text(value["why"]);
    case "not-found":
      return (
        oneOf(value["under"], ["verified", "claim"]) &&
        nonBlank(value["conversationId"]) &&
        oneOf(value["reason"], ["no-claude-session-id", "malformed-claude-session-id", "no-projects-directory", "no-transcript-file"]) &&
        text(value["why"])
      );
    case "cannot-tell":
      return oneOf(value["under"], ["verified", "claim"]) && nonBlank(value["conversationId"]) && nonBlank(value["why"]);
    case "no-conversation":
      return text(value["why"]);
    default:
      return false;
  }
}

function evidence(value: unknown): value is RecoveryWireEvidence {
  if (!isRecord(value)) return false;
  if (value["kind"] === "unavailable") return nonBlank(value["why"]);
  if (value["kind"] !== "checked") return false;
  const dir = value["dir"];
  const worktree = value["worktree"];
  const resume = value["resume"];
  const activity = value["lastActivity"];
  const dirOk =
    isRecord(dir) &&
    ((dir["kind"] === "exists" && nonBlank(dir["path"])) ||
      (dir["kind"] === "missing" && nonBlank(dir["path"]) && text(dir["why"])) ||
      (dir["kind"] === "not-recorded" && text(dir["why"])) ||
      (dir["kind"] === "cannot-tell" && nonBlank(dir["path"]) && text(dir["why"])));
  const worktreeOk =
    isRecord(worktree) &&
    (worktree["kind"] === "none" ||
      (worktree["kind"] === "recorded" && nonBlank(worktree["name"]) && nonBlank(worktree["dir"])) ||
      (worktree["kind"] === "not-recorded" && nonBlank(worktree["name"]) && text(worktree["why"])));
  const resumeOk =
    isRecord(resume) &&
    ((resume["kind"] === "supported" && nonBlank(resume["conversationId"]) && nonBlank(resume["transcriptPath"])) ||
      (resume["kind"] === "not-supported" && nonBlank(resume["why"])) ||
      (resume["kind"] === "manual" && nonBlank(resume["host"]) && textOrNull(resume["dir"]) && text(resume["why"])));
  const activityOk = isRecord(activity) && iso(activity["at"]) && oneOf(activity["source"], ["transcript", "register-floor"]);
  return dirOk && worktreeOk && resumeOk && activityOk && transcript(value["transcript"]);
}

function state(value: unknown): value is RecoveryWireRecordState {
  if (!isRecord(value)) return false;
  switch (value["kind"]) {
    case "resolved":
      return resolution(value["resolution"]);
    case "unchecked":
      return nonBlank(value["why"]);
    case "classified":
      return classification(value["classification"]) && evidence(value["evidence"]);
    default:
      return false;
  }
}

function record(value: unknown): value is RecoveryWireRecord {
  if (!isRecord(value)) return false;
  if (!nonBlank(value["id"]) || !nonBlank(value["key"]) || !text(value["name"]) || !iso(value["at"])) return false;
  if (!oneOf(value["origin"], ["journal", "legacy"]) || typeof value["oversize"] !== "boolean") return false;
  const entry = value["entry"];
  if (
    entry !== null &&
    !(isRecord(entry) && textOrNull(entry["dir"]) && textOrNull(entry["worktree"]) && iso(entry["lastSeenAlive"]) && nonBlank(entry["lastStatusKey"]))
  ) {
    return false;
  }
  const seen = value["lastSeen"];
  if (seen !== null && !(isRecord(seen) && nonBlank(seen["statusKey"]) && textOrNull(seen["title"]) && textOrNull(seen["harness"]) && iso(seen["collectedAt"]))) {
    return false;
  }
  const gone = value["disappearance"];
  if (
    gone !== null &&
    !(
      isRecord(gone) &&
      nonBlank(gone["goneWhy"]) &&
      oneOf(gone["generation"], ["same", "changed", "unverifiable"]) &&
      oneOf(gone["producerRun"], ["same", "changed", "cannot-tell"]) &&
      typeof gone["watched"] === "boolean" &&
      typeof gone["bootChanged"] === "boolean"
    )
  ) {
    return false;
  }
  return state(value["state"]);
}

function view(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value["kind"]) {
    case "not-yet-checked":
    case "unreadable":
      return nonBlank(value["why"]);
    case "checked": {
      const inv = value["inventory"];
      return (
        iso(value["checkedAt"]) &&
        isRecord(inv) &&
        ((inv["kind"] === "trusted" && iso(inv["collectedAt"]) && whole(inv["rows"])) || (inv["kind"] === "untrusted" && nonBlank(inv["why"])))
      );
    }
    default:
      return false;
  }
}

function replay(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value["kind"] === "not-run") return text(value["why"]);
  return value["kind"] === "ran" && whole(value["worldChanges"]) && whole(value["derived"]) && whole(value["scannedBytes"]);
}

function noAnswer(why: string): Extract<RecoveryView, { kind: "no-answer" }> {
  return { kind: "no-answer", why };
}

type Published = Extract<RecoveryFeed, { kind: "published" }>;

/** The largest first page the server sends (recovery-feed.ts § `RECOVERY_FIRST_PAGE`). */
export const RECOVERY_FIRST_PAGE_MAX = 100;

/** What makes a published answer contradict itself, or null. Called only once every field has parsed. */
function contradiction(feed: Published): string | null {
  const { records, view } = feed;
  if (records.length > RECOVERY_FIRST_PAGE_MAX) return `${records.length} records, over the first page of ${RECOVERY_FIRST_PAGE_MAX}`;
  const ids = new Set<string>();
  for (const r of records) {
    if (ids.has(r.id)) return `record ${r.id} appears twice`;
    ids.add(r.id);
  }
  if (feed.unresolved > feed.total) return `${feed.unresolved} unresolved of only ${feed.total} records`;
  const shownUnresolved = records.filter((r) => r.state.kind !== "resolved").length;
  const shownResolved = records.length - shownUnresolved;
  if (shownUnresolved > feed.unresolved) return `${shownUnresolved} unresolved rows shown, of ${feed.unresolved} unresolved`;
  if (shownResolved > feed.total - feed.unresolved) return `${shownResolved} resolved rows shown, of ${feed.total - feed.unresolved} resolved`;
  // The first page takes every unresolved record before any resolved one.
  if (shownResolved > 0 && shownUnresolved < feed.unresolved) return "a resolved row is shown while an unresolved record is not";
  for (const r of records) {
    // An oversize stub keeps its address and nothing else (recovery-feed.ts § parseRecord).
    if (r.oversize) {
      if (r.entry !== null || r.lastSeen !== null || r.disappearance !== null) return `${r.id} is an oversize stub that carries the facts a stub drops`;
    } else {
      if (r.disappearance === null) return `${r.id} is no stub and has no disappearance`;
      if (r.entry === null && r.origin !== "legacy") return `${r.id} is a journal record with no entry`;
    }
    if (r.state.kind === "classified") {
      if (view.kind !== "checked") return `${r.id} is classified, under a view that is ${view.kind}`;
      if (view.inventory.kind === "untrusted" && r.state.classification.kind !== "unknown") {
        return `${r.id} is ${r.state.classification.kind} against an inventory that cannot be trusted`;
      }
    }
  }
  return null;
}

/** A recursively checked server payload, or this browser's refusal to guess. */
export function parseRecoveryFeed(body: unknown): RecoveryView {
  if (!isRecord(body)) return noAnswer("this browser received something that is not the recovery API");
  if (body["schema"] !== 1) {
    return noAnswer(`this browser can read version 1 of the recovery API; the server sent ${JSON.stringify(body["schema"])}`);
  }
  if (!iso(body["composedAt"])) return noAnswer("this browser received a recovery answer without a valid composition time");
  switch (body["kind"]) {
    case "absent":
      return nonBlank(body["path"]) && nonBlank(body["why"]) ? (body as RecoveryFeed) : noAnswer("this browser received a malformed absent answer");
    case "unreadable":
      return nonBlank(body["why"]) ? (body as RecoveryFeed) : noAnswer("this browser received an unreadable answer with no reason");
    case "unsupported-schema":
      return nonBlank(body["path"]) && text(body["saw"]) && whole(body["known"]) && nonBlank(body["why"])
        ? (body as RecoveryFeed)
        : noAnswer("this browser received a malformed unsupported-schema answer");
    case "oversized":
      return nonBlank(body["path"]) && whole(body["sizeBytes"]) && whole(body["limitBytes"]) && nonBlank(body["why"])
        ? (body as RecoveryFeed)
        : noAnswer("this browser received a malformed oversized answer");
    case "published":
      break;
    default:
      return noAnswer("this browser received a recovery answer with an unknown kind");
  }
  if (!nonBlank(body["path"]) || !isoOrNull(body["writtenAt"])) return noAnswer("this browser received a malformed recovery envelope");
  if (!view(body["view"]) || !replay(body["replay"])) return noAnswer("this browser received a malformed recovery view or replay state");
  if (!whole(body["overflow"]) || !whole(body["total"]) || !whole(body["unresolved"]) || !whole(body["olderCount"])) {
    return noAnswer("this browser received malformed recovery counts");
  }
  const records = body["records"];
  if (!Array.isArray(records)) return noAnswer("this browser received recovery records that are not a list");
  const badIndex = records.findIndex((item) => !record(item));
  if (badIndex !== -1) return noAnswer(`this browser could not read recovery record ${badIndex + 1}, so it shows none rather than a shorter list`);
  if (body["olderCount"] !== body["total"] - records.length) {
    return noAnswer(`this browser received ${records.length} records and an older count of ${body["olderCount"]}, which do not add up to ${body["total"]}`);
  }
  const feed = body as Published;
  const why = contradiction(feed);
  if (why !== null) return noAnswer(`this browser received a recovery answer that contradicts itself: ${why}`);
  return feed;
}

/** Build the seam against an injectable request leaf. */
export function makeRecoveryApi(request: RecoveryRequest = (input, init) => fetch(input, init)): RecoveryApi {
  return {
    async fetch(signal): Promise<RecoveryView> {
      const controller = new AbortController();
      let abortReason: "caller" | "timeout" | null = signal?.aborted === true ? "caller" : null;
      const timer = setTimeout(() => {
        abortReason ??= "timeout";
        controller.abort();
      }, RECOVERY_FETCH_TIMEOUT_MS);
      const onAbort = (): void => {
        abortReason ??= "caller";
        controller.abort();
      };
      signal?.addEventListener("abort", onAbort);
      if (signal?.aborted) controller.abort();
      try {
        const response = await request(RECOVERY_URL, {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return noAnswer(`this browser received ${response.status} from the dashboard, but its answer was not JSON`);
        }
        const parsed = parseRecoveryFeed(body);
        if (parsed.kind === "no-answer") return noAnswer(`this browser could not read the dashboard's ${response.status} answer: ${parsed.why}`);
        return parsed;
      } catch (cause) {
        return noAnswer(
          abortReason === "caller"
            ? "this browser cancelled the recovery request before it answered"
            : abortReason === "timeout"
              ? `this browser got no answer within ${RECOVERY_FETCH_TIMEOUT_MS / 1000}s; what was on screen may be stale`
              : `this browser could not reach the dashboard: ${String(cause)}`,
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

/** Stable default object for a React effect dependency. */
export const httpRecoveryApi: RecoveryApi = makeRecoveryApi();
