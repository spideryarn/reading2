/**
 * What agents claimed — `GET /api/reports` (plan 260910e, Stage 3a).
 *
 * The server has four arms. This client adds `no-answer`, for the reason
 * `decisions-client.ts` gives: this browser timed out, could not reach the
 * box, or received bytes it cannot understand, and that must never appear in
 * the server's voice.
 *
 * **Strict, because the panel builds links.** Every artefact goes through
 * `parseCheckedArtefacts`, the one shared shape check, so `artefactHref` is
 * only ever handed a reference that passed it. Every other field is checked
 * for type and enum, and the few cross-field rules a build could get wrong —
 * a session's latest claim is that session's, an execution comparison exists
 * only for a session — are refused rather than drawn.
 */
import type {
  ReportsFeed,
  ReportWireActor,
  ReportWireClaim,
  ReportWireClaimed,
  ReportWireProblem,
  ReportWireSession,
} from "../../wire";
import { parseCheckedArtefacts } from "../../artefact-ref";

export const REPORTS_URL = "api/reports";
export const REPORTS_FETCH_TIMEOUT_MS = 10_000;

export type ReportsView = ReportsFeed | { kind: "no-answer"; why: string };
export type ReportsApi = { fetch(signal?: AbortSignal): Promise<ReportsView> };
export type ReportsRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSION_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const DECISION_ID = /^dec-[23456789abcdefghjkmnpqrstvwxyz]{8}$/;
const QUEUE_ID = /^qi-[23456789abcdefghjkmnpqrstvwxyz]{8}$/;
const SHA = /^[0-9a-f]{7,40}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function iso(value: unknown): value is string {
  return typeof value === "string" && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function whole(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function oneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

function actor(value: unknown): value is ReportWireActor {
  if (!isRecord(value)) return false;
  if (value["kind"] === "overseer" || value["kind"] === "greg") return true;
  return value["kind"] === "session" && typeof value["name"] === "string" && SESSION_NAME.test(value["name"]);
}

function execution(value: unknown, by: ReportWireActor): boolean {
  if (by.kind !== "session") return value === null;
  if (value === "same-verified-run" || value === "different-verified-run") return true;
  return isRecord(value) && nonBlank(value["unverifiable"]);
}

function job(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value["plan"] !== null && !nonBlank(value["plan"])) return false;
  if (value["queueItem"] !== null && !(typeof value["queueItem"] === "string" && QUEUE_ID.test(value["queueItem"]))) {
    return false;
  }
  const occurrence = value["occurrence"];
  return occurrence === null || (isRecord(occurrence) && nonBlank(occurrence["jobId"]) && iso(occurrence["scheduledAt"]));
}

function shas(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && SHA.test(entry));
}

function body(value: Record<string, unknown>): boolean {
  switch (value["kind"]) {
    case "progress":
      return true;
    case "blocked":
      return oneOf(value["on"], ["greg", "peer", "review", "environment", "other"]) && nonBlank(value["needs"]);
    case "completed": {
      const revisions = value["revisions"];
      return (
        oneOf(value["ending"], ["finished", "done-enough", "important-work-left"]) &&
        isRecord(revisions) &&
        shas(revisions["reviewed"]) &&
        shas(revisions["tested"]) &&
        shas(revisions["merged"])
      );
    }
    case "decision":
      return typeof value["decisionId"] === "string" && DECISION_ID.test(value["decisionId"]);
    default:
      return false;
  }
}

function claim(value: unknown): value is ReportWireClaim {
  if (!isRecord(value) || !uuid(value["eventId"]) || !actor(value["claimedBy"])) return false;
  if (!iso(value["submittedAt"]) || !iso(value["receivedAt"])) return false;
  if (!execution(value["execution"], value["claimedBy"]) || !job(value["job"]) || !nonBlank(value["summary"])) return false;
  if (parseCheckedArtefacts(value["artefacts"]) === null) return false;
  const corrects = value["corrects"];
  if (corrects !== null && (!uuid(corrects) || corrects === value["eventId"])) return false;
  const correctedBy = value["correctedBy"];
  if (correctedBy !== null && !(isRecord(correctedBy) && uuid(correctedBy["eventId"]) && actor(correctedBy["actor"]) && iso(correctedBy["at"]))) {
    return false;
  }
  if (value["laterClaim"] !== null && !uuid(value["laterClaim"])) return false;
  return body(value);
}

/** A session's latest claim: made by that session, and with nothing later than it. */
function claimed(value: unknown, name: string): value is ReportWireClaimed {
  if (!isRecord(value) || value["kind"] !== "claimed" || !whole(value["claims"]) || value["claims"] < 1) return false;
  const latest = value["latest"];
  return (
    claim(latest) &&
    latest.claimedBy.kind === "session" &&
    latest.claimedBy.name === name &&
    latest.laterClaim === null
  );
}

function sessionName(value: unknown, seen: Set<string>): value is string {
  if (typeof value !== "string" || !SESSION_NAME.test(value) || seen.has(value)) return false;
  seen.add(value);
  return true;
}

function sessionRow(value: unknown, seen: Set<string>): value is ReportWireSession {
  if (!isRecord(value) || !sessionName(value["name"], seen)) return false;
  const latest = value["latest"];
  if (value["register"] === "in-register") {
    return (isRecord(latest) && latest["kind"] === "unreported") || claimed(latest, value["name"]);
  }
  // A session outside the register is only listed because it said something.
  return value["register"] === "not-in-register" && claimed(latest, value["name"]);
}

function sessions(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const seen = new Set<string>();
  if (value["kind"] === "joined-with-register") {
    return Array.isArray(value["rows"]) && value["rows"].every((row) => sessionRow(row, seen));
  }
  if (value["kind"] !== "register-unavailable" || !nonBlank(value["why"]) || !Array.isArray(value["reported"])) return false;
  return value["reported"].every(
    (row) => isRecord(row) && sessionName(row["name"], seen) && claimed(row["latest"], row["name"]),
  );
}

function problem(value: unknown): value is ReportWireProblem {
  return (
    isRecord(value) &&
    oneOf(value["kind"], ["unreadable-line", "duplicate-event", "invalid-correction"]) &&
    nonBlank(value["why"]) &&
    (value["eventId"] === null || typeof value["eventId"] === "string")
  );
}

function noAnswer(why: string): Extract<ReportsView, { kind: "no-answer" }> {
  return { kind: "no-answer", why };
}

/** A recursively checked server payload, or this browser's refusal to guess. */
export function parseReportsFeed(input: unknown): ReportsView {
  if (!isRecord(input)) return noAnswer("this browser received something that is not the reports API");
  if (input["schema"] !== 1) {
    return noAnswer(`this browser can read version 1 of the reports API; the server sent ${JSON.stringify(input["schema"])}`);
  }
  if (!iso(input["composedAt"])) return noAnswer("this browser received a reports answer without a valid composition time");
  switch (input["kind"]) {
    case "never-written":
      return nonBlank(input["why"]) && whole(input["inFlight"]) && whole(input["refused"])
        ? (input as ReportsFeed)
        : noAnswer("this browser received a malformed never-written answer");
    case "unreadable":
      return nonBlank(input["why"]) ? (input as ReportsFeed) : noAnswer("this browser received a reports silence with no readable reason");
    case "oversized-file":
      return nonBlank(input["why"]) && whole(input["sizeBytes"]) && whole(input["limitBytes"])
        ? (input as ReportsFeed)
        : noAnswer("this browser received a malformed oversized-file answer");
    case "reports":
      break;
    default:
      return noAnswer("this browser received a reports answer with an unknown kind");
  }
  if (!nonBlank(input["path"]) || !whole(input["inFlight"]) || !whole(input["refused"]) || !whole(input["recentWithheld"])) {
    return noAnswer("this browser received a malformed reports envelope");
  }
  if (!sessions(input["sessions"])) return noAnswer("this browser received malformed session rows");
  if (!Array.isArray(input["recent"]) || !input["recent"].every(claim)) {
    return noAnswer("this browser received malformed claims");
  }
  if (!Array.isArray(input["problems"]) || !input["problems"].every(problem)) {
    return noAnswer("this browser received malformed reports-log problems");
  }
  return input as ReportsFeed;
}

/**
 * Case-insensitive, over what a person would remember a claim by: the
 * summary, what a block needs, who claimed it, and the plan. A blank query
 * matches everything.
 */
export function claimMatchesSearch(item: ReportWireClaim, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = [
    item.summary,
    item.kind === "blocked" ? item.needs : "",
    item.claimedBy.kind === "session" ? item.claimedBy.name : item.claimedBy.kind,
    item.job.plan ?? "",
  ];
  return haystack.some((text) => text.toLowerCase().includes(needle));
}

/** Build the seam against an injectable request leaf. */
export function makeReportsApi(request: ReportsRequest = (input, init) => fetch(input, init)): ReportsApi {
  return {
    async fetch(signal): Promise<ReportsView> {
      const controller = new AbortController();
      let abortReason: "caller" | "timeout" | null = signal?.aborted === true ? "caller" : null;
      const timer = setTimeout(() => {
        abortReason ??= "timeout";
        controller.abort();
      }, REPORTS_FETCH_TIMEOUT_MS);
      const onAbort = (): void => {
        abortReason ??= "caller";
        controller.abort();
      };
      signal?.addEventListener("abort", onAbort);
      if (signal?.aborted) controller.abort();
      try {
        const response = await request(REPORTS_URL, {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        let parsedBody: unknown;
        try {
          parsedBody = await response.json();
        } catch {
          return noAnswer(`this browser received ${response.status} from the dashboard, but its answer was not JSON`);
        }
        const parsed = parseReportsFeed(parsedBody);
        return parsed.kind === "no-answer"
          ? noAnswer(`this browser could not read the dashboard's ${response.status} answer: ${parsed.why}`)
          : parsed;
      } catch (cause) {
        return noAnswer(
          abortReason === "caller"
            ? "this browser cancelled the reports request before it answered"
            : abortReason === "timeout"
              ? `this browser got no answer within ${REPORTS_FETCH_TIMEOUT_MS / 1000}s; what was on screen may be stale`
              : `this browser could not reach the dashboard: ${String(cause)}`,
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

/** Stable default object for the panel's effect dependency. */
export const httpReportsApi: ReportsApi = makeReportsApi();
