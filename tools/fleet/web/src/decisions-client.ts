/**
 * The decisions record — `GET /api/decisions`.
 *
 * The server has four arms. This client adds `no-answer`: this browser timed
 * out, could not reach the box, or received bytes it cannot understand. That
 * is kept apart from `never-written` and `unreadable` so a phone's own network
 * trouble never appears in the server's voice.
 *
 * `DecisionsApi` is the injectable seam Stage 3b's panel will receive. The
 * factory also accepts its request leaf, so this module's own tests exercise
 * the real timeout, JSON, and strict-parser path without stubbing global
 * `fetch`. The default request resolves `fetch` when called, not at import time.
 */
import type {
  DecisionRow,
  DecisionsFeed,
  DecisionWireAggregates,
  DecisionWireCheckpoint,
  DecisionWireExecution,
  DecisionWireProblem,
  DecisionWireRecord,
  DecisionWireSessionState,
} from "../../wire";
import { isExecutionTokenText } from "../../execution-token";

export const DECISIONS_URL = "api/decisions";
export const DECISIONS_FETCH_TIMEOUT_MS = 10_000;

export type DecisionsView = DecisionsFeed | { kind: "no-answer"; why: string };
export type DecisionsApi = { fetch(signal?: AbortSignal): Promise<DecisionsView> };
export type DecisionsRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string";
}

function nonBlank(value: unknown): value is string {
  return text(value) && value.trim() !== "";
}

function nullableText(value: unknown): value is string | null {
  return value === null || text(value);
}

function nullableIso(value: unknown): value is string | null {
  return value === null || iso(value);
}

function whole(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const DECISION_ID = /^dec-[23456789abcdefghjkmnpqrstvwxyz]{8}$/;

function iso(value: unknown): value is string {
  return text(value) && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

function nullableDecisionId(value: unknown): value is string | null {
  return value === null || (text(value) && DECISION_ID.test(value));
}

function actor(value: unknown): value is "greg" | "overseer" {
  return value === "greg" || value === "overseer";
}

function execution(value: unknown): value is DecisionWireExecution {
  if (!isRecord(value)) return false;
  if (value["kind"] === "not-found") return true;
  if (value["kind"] === "unavailable") return nonBlank(value["why"]);
  return value["kind"] === "verified" && isExecutionTokenText(value["token"]) && iso(value["since"]);
}

function checkpoint(value: unknown): value is DecisionWireCheckpoint {
  if (!isRecord(value)) return false;
  if (value["kind"] === "current") return true;
  return value["kind"] === "unavailable" && nonBlank(value["why"]);
}

function aggregates(value: unknown): value is DecisionWireAggregates {
  if (!isRecord(value)) return false;
  if (value["kind"] === "unavailable") return nonBlank(value["why"]);
  if (value["kind"] !== "counts" || !whole(value["notYetReviewed"])) return false;
  const trailing = value["trailingSevenDays"];
  return (
    isRecord(trailing) &&
    whole(trailing["decisions"]) &&
    whole(trailing["reviews"]) &&
    whole(trailing["reversals"])
  );
}

function problem(value: unknown): value is DecisionWireProblem {
  if (!isRecord(value) || !nonBlank(value["why"]) || !nullableText(value["eventId"])) return false;
  switch (value["kind"]) {
    case "unreadable-line":
    case "unauthorized-review":
    case "duplicate-decision":
    case "unknown-decision":
    case "duplicate-event":
    case "command-conflict":
    case "invalid-supersession":
    case "illegal-transition":
      return true;
    default:
      return false;
  }
}

function optionNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const names: string[] = [];
  const distinct = new Set<string>();
  for (const option of value) {
    if (!isRecord(option) || !nonBlank(option["name"]) || !nonBlank(option["tradeoffs"])) return null;
    const comparable = option["name"].trim();
    if (distinct.has(comparable)) return null;
    distinct.add(comparable);
    names.push(comparable);
  }
  return names;
}

function choice(value: unknown, options: readonly string[]): boolean {
  return (
    isRecord(value) &&
    nonBlank(value["option"]) &&
    nullableText(value["note"]) &&
    options.includes(value["option"].trim())
  );
}

function advisers(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  const seen = new Set<string>();
  for (const adviser of value) {
    if (adviser !== "sol" && adviser !== "fable" && adviser !== "nobody") return false;
    if (seen.has(adviser)) return false;
    seen.add(adviser);
  }
  return !seen.has("nobody") || seen.size === 1;
}

function bearsOn(value: unknown): boolean {
  if (!isRecord(value) || !nullableText(value["plan"]) || !Array.isArray(value["sessions"])) return false;
  const names = new Set<string>();
  for (const session of value["sessions"]) {
    if (!isRecord(session) || !nonBlank(session["name"]) || !execution(session["execution"])) return false;
    if (names.has(session["name"])) return false;
    names.add(session["name"]);
  }
  return true;
}

function record(value: unknown): value is DecisionWireRecord {
  if (!isRecord(value)) return false;
  if (!text(value["id"]) || !DECISION_ID.test(value["id"]) || !actor(value["recordedBy"])) return false;
  if (value["class"] !== "assumption" && value["class"] !== "decision" && value["class"] !== "decline") {
    return false;
  }
  if (!nonBlank(value["question"]) || !nonBlank(value["why"]) || !iso(value["decidedAt"])) return false;
  if (!nullableDecisionId(value["supersedes"]) || !nullableDecisionId(value["supersededBy"])) return false;
  if (typeof value["reviewed"] !== "boolean" || !nullableIso(value["reviewedAt"])) return false;
  if (!nullableText(value["reviewNote"]) || typeof value["reversed"] !== "boolean") return false;
  if (!nullableIso(value["reversedAt"]) || !nullableText(value["reversedWhy"])) return false;

  const options = optionNames(value["options"]);
  if (options === null || !choice(value["chose"], options)) return false;
  if (!advisers(value["advisers"]) || !bearsOn(value["bearsOn"])) return false;
  const touches = value["touches"];
  return (
    Array.isArray(touches) &&
    touches.every(
      (touch) =>
        isRecord(touch) &&
        (touch["kind"] === "decided" || touch["kind"] === "reviewed" || touch["kind"] === "reversed") &&
        iso(touch["at"]) &&
        actor(touch["by"]) &&
        text(touch["what"]),
    )
  );
}

function sessionState(value: unknown): value is DecisionWireSessionState {
  if (!isRecord(value)) return false;
  if (value["kind"] === "live" || value["kind"] === "ended-or-replaced") return true;
  if (value["kind"] !== "unavailable" || !isRecord(value["why"])) return false;
  const why = value["why"];
  return (
    why["kind"] === "checkpoint-unavailable" ||
    (why["kind"] === "execution-unavailable" && nonBlank(why["detail"]))
  );
}

function row(value: unknown): value is DecisionRow {
  if (!isRecord(value) || !record(value["record"])) return false;
  if (!finiteNonNegative(value["ageMs"]) || typeof value["pendingReview"] !== "boolean") return false;
  const expectedPending = !value["record"].reviewed && value["record"].supersededBy === null;
  if (value["pendingReview"] !== expectedPending) return false;
  const sessions = value["sessions"];
  return (
    Array.isArray(sessions) &&
    sessions.every((session) => isRecord(session) && nonBlank(session["name"]) && sessionState(session["state"]))
  );
}

function noAnswer(why: string): Extract<DecisionsView, { kind: "no-answer" }> {
  return { kind: "no-answer", why };
}

/** A recursively checked server payload, or this browser's refusal to guess. */
export function parseDecisionsFeed(body: unknown): DecisionsView {
  if (!isRecord(body)) return noAnswer("this browser received something that is not the decisions API");
  if (body["schema"] !== 1) {
    return noAnswer(
      `this browser can read version 1 of the decisions API; the server sent ${JSON.stringify(body["schema"])}`,
    );
  }
  if (body["kind"] === "never-written" || body["kind"] === "unreadable") {
    return nonBlank(body["why"])
      ? (body as DecisionsFeed)
      : noAnswer("this browser received a decisions silence with no readable reason");
  }
  if (body["kind"] === "oversized-unreviewed") {
    return nonBlank(body["why"]) && whole(body["unreviewedCount"]) && whole(body["limitBytes"])
      ? (body as DecisionsFeed)
      : noAnswer("this browser received a malformed oversized-unreviewed answer");
  }
  if (body["kind"] !== "decisions") {
    return noAnswer("this browser received a decisions answer with an unknown kind");
  }
  if (!nonBlank(body["version"]) || !nonBlank(body["path"]) || !iso(body["composedAt"])) {
    return noAnswer("this browser received a malformed decisions envelope");
  }
  if (!checkpoint(body["checkpoint"]) || !aggregates(body["aggregates"])) {
    return noAnswer("this browser received malformed decision context or aggregates");
  }
  if (!whole(body["reviewedWithheld"]) || !Array.isArray(body["rows"]) || !body["rows"].every(row)) {
    return noAnswer("this browser received malformed decision rows or history count");
  }
  if (!Array.isArray(body["problems"]) || !body["problems"].every(problem)) {
    return noAnswer("this browser received malformed decision-record problems");
  }
  const answer = body as Extract<DecisionsFeed, { kind: "decisions" }>;
  if (answer.aggregates.kind === "counts") {
    const pendingRows = answer.rows.filter((item) => item.pendingReview).length;
    if (answer.problems.length > 0) {
      return noAnswer("this browser received decision counts despite unresolved record problems");
    }
    if (answer.aggregates.notYetReviewed !== pendingRows) {
      return noAnswer(
        `this browser received a not-yet-reviewed count of ${answer.aggregates.notYetReviewed}, ` +
          `but ${pendingRows} row(s) carry that state`,
      );
    }
  }
  return answer;
}

/** Build the seam against an injectable request leaf. */
export function makeDecisionsApi(
  request: DecisionsRequest = (input, init) => fetch(input, init),
): DecisionsApi {
  return {
    async fetch(signal): Promise<DecisionsView> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DECISIONS_FETCH_TIMEOUT_MS);
      const onAbort = (): void => controller.abort();
      signal?.addEventListener("abort", onAbort);
      if (signal?.aborted) controller.abort();
      try {
        const response = await request(DECISIONS_URL, {
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
        const parsed = parseDecisionsFeed(body);
        if (parsed.kind === "no-answer") {
          return noAnswer(`this browser could not read the dashboard's ${response.status} answer: ${parsed.why}`);
        }
        return parsed;
      } catch (cause) {
        return noAnswer(
          controller.signal.aborted
            ? `this browser got no answer within ${DECISIONS_FETCH_TIMEOUT_MS / 1000}s; what was on screen may be stale`
            : `this browser could not reach the dashboard: ${String(cause)}`,
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

/** Stable default object for a React effect dependency in Stage 3b. */
export const httpDecisionsApi: DecisionsApi = makeDecisionsApi();
