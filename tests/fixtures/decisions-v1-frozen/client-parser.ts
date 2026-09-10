/**
 * **FROZEN.** The dashboard's decisions-payload parser as it stood before the
 * `/api/decisions` schema bump, so a test can prove what an OLD BROWSER does
 * with a NEW payload. Do not edit it to match the current client.
 *
 * Copied on 2026-09-10 from `git show HEAD:tools/fleet/web/src/decisions-client.ts`
 * at f9d4b584 (`parseDecisionsFeed` and the checks it calls), with the wire
 * types loosened to plain objects so it depends on nothing that can change.
 * The one import kept is the execution-token check, a leaf whose format is not
 * what these tests are about.
 *
 * Why it matters (plan 260910e, GPT Sol's WR-P2): the old browser ignores
 * extra record fields, so if the payload schema had stayed 1 it would draw a
 * session's decision as "recorded by overseer". The bump makes it refuse
 * instead, and this copy is how a test sees that refusal.
 */
import { isExecutionTokenText } from "../../../tools/fleet/execution-token.js";

type Json = Record<string, unknown>;
export type FrozenV1View = { kind: string; why?: string } & Json;

function isRecord(value: unknown): value is Json {
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
function actor(value: unknown): boolean {
  return value === "greg" || value === "overseer";
}
function execution(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value["kind"] === "not-found") return true;
  if (value["kind"] === "unavailable") return nonBlank(value["why"]);
  return value["kind"] === "verified" && isExecutionTokenText(value["token"]) && iso(value["since"]);
}
function checkpoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value["kind"] === "current") return true;
  return value["kind"] === "unavailable" && nonBlank(value["why"]);
}
function aggregates(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value["kind"] === "unavailable") return nonBlank(value["why"]);
  if (value["kind"] !== "counts" || !whole(value["notYetReviewed"])) return false;
  const trailing = value["trailingSevenDays"];
  return isRecord(trailing) && whole(trailing["decisions"]) && whole(trailing["reviews"]) && whole(trailing["reversals"]);
}
function problem(value: unknown): boolean {
  if (!isRecord(value) || !nonBlank(value["why"]) || !nullableText(value["eventId"])) return false;
  return [
    "unreadable-line",
    "unauthorized-review",
    "duplicate-decision",
    "unknown-decision",
    "duplicate-event",
    "command-conflict",
    "invalid-supersession",
    "illegal-transition",
  ].includes(String(value["kind"]));
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
  return isRecord(value) && nonBlank(value["option"]) && nullableText(value["note"]) && options.includes(value["option"].trim());
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
function record(value: unknown): value is Json {
  if (!isRecord(value)) return false;
  if (!text(value["id"]) || !DECISION_ID.test(value["id"]) || !actor(value["recordedBy"])) return false;
  if (value["class"] !== "assumption" && value["class"] !== "decision" && value["class"] !== "decline") return false;
  if (!nonBlank(value["question"]) || !nonBlank(value["why"]) || !iso(value["decidedAt"])) return false;
  if (!nullableDecisionId(value["supersedes"]) || !nullableDecisionId(value["supersededBy"])) return false;
  if (typeof value["reviewed"] !== "boolean" || !nullableIso(value["reviewedAt"])) return false;
  if (!nullableText(value["reviewNote"]) || typeof value["reversed"] !== "boolean") return false;
  if (!nullableIso(value["reversedAt"]) || !nullableText(value["reversedWhy"])) return false;
  const options = optionNames(value["options"]);
  if (options === null || !choice(value["chose"], options)) return false;
  if (!advisers(value["advisers"]) || !bearsOn(value["bearsOn"])) return false;
  const touches = value["touches"];
  if (
    !Array.isArray(touches) ||
    !touches.every(
      (touch) =>
        isRecord(touch) &&
        (touch["kind"] === "decided" || touch["kind"] === "reviewed" || touch["kind"] === "reversed") &&
        iso(touch["at"]) &&
        actor(touch["by"]) &&
        text(touch["what"]),
    )
  ) {
    return false;
  }
  const hasGregReviewTouch = touches.some(
    (touch) => touch["by"] === "greg" && (touch["kind"] === "reviewed" || touch["kind"] === "reversed"),
  );
  const hasGregReversalTouch = touches.some((touch) => touch["by"] === "greg" && touch["kind"] === "reversed");
  if (value["reviewed"] && (value["reviewedAt"] === null || !hasGregReviewTouch)) return false;
  if (value["reversed"] && (!value["reviewed"] || !hasGregReversalTouch)) return false;
  return true;
}
function sessionState(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value["kind"] === "same-run-as-last-verified") return iso(value["since"]);
  if (value["kind"] === "ended-or-replaced") return true;
  if (value["kind"] !== "unavailable" || !isRecord(value["why"])) return false;
  const why = value["why"];
  return why["kind"] === "checkpoint-unavailable" || (why["kind"] === "execution-unavailable" && nonBlank(why["detail"]));
}
function row(value: unknown): boolean {
  if (!isRecord(value) || !record(value["record"])) return false;
  if (!finiteNonNegative(value["ageMs"]) || typeof value["pendingReview"] !== "boolean") return false;
  const expectedPending = !value["record"]["reviewed"] && value["record"]["supersededBy"] === null;
  if (value["pendingReview"] !== expectedPending) return false;
  const sessions = value["sessions"];
  return (
    Array.isArray(sessions) &&
    sessions.every((session) => isRecord(session) && nonBlank(session["name"]) && sessionState(session["state"]))
  );
}
function noAnswer(why: string): FrozenV1View {
  return { kind: "no-answer", why };
}

/** The v1 browser's verdict on one `/api/decisions` body. */
export function frozenV1ParseDecisionsFeed(body: unknown): FrozenV1View {
  if (!isRecord(body)) return noAnswer("this browser received something that is not the decisions API");
  if (body["schema"] !== 1) {
    return noAnswer(`this browser can read version 1 of the decisions API; the server sent ${JSON.stringify(body["schema"])}`);
  }
  if (!iso(body["composedAt"])) return noAnswer("this browser received a decisions answer without a valid composition time");
  if (body["kind"] === "never-written" || body["kind"] === "unreadable") {
    return nonBlank(body["why"]) ? (body as FrozenV1View) : noAnswer("this browser received a decisions silence with no readable reason");
  }
  if (body["kind"] === "oversized-unreviewed") {
    return nonBlank(body["why"]) && whole(body["unreviewedCount"]) && whole(body["limitBytes"])
      ? (body as FrozenV1View)
      : noAnswer("this browser received a malformed oversized-unreviewed answer");
  }
  if (body["kind"] === "oversized-file") {
    return nonBlank(body["why"]) && whole(body["sizeBytes"]) && whole(body["limitBytes"])
      ? (body as FrozenV1View)
      : noAnswer("this browser received a malformed oversized-file answer");
  }
  if (body["kind"] !== "decisions") return noAnswer("this browser received a decisions answer with an unknown kind");
  if (!nonBlank(body["version"]) || !nonBlank(body["path"])) return noAnswer("this browser received a malformed decisions envelope");
  if (!checkpoint(body["checkpoint"]) || !aggregates(body["aggregates"])) {
    return noAnswer("this browser received malformed decision context or aggregates");
  }
  if (!whole(body["historyWithheld"]) || !Array.isArray(body["rows"]) || !body["rows"].every(row)) {
    return noAnswer("this browser received malformed decision rows or history count");
  }
  if (!Array.isArray(body["problems"]) || !body["problems"].every(problem)) {
    return noAnswer("this browser received malformed decision-record problems");
  }
  const counts = body["aggregates"] as Json;
  if (counts["kind"] === "counts") {
    const pendingRows = (body["rows"] as Json[]).filter((item) => item["pendingReview"] === true).length;
    if ((body["problems"] as unknown[]).length > 0) {
      return noAnswer("this browser received decision counts despite unresolved record problems");
    }
    if (counts["notYetReviewed"] !== pendingRows) {
      return noAnswer(
        `this browser received a not-yet-reviewed count of ${String(counts["notYetReviewed"])}, ` +
          `but ${pendingRows} row(s) carry that state`,
      );
    }
  }
  return body as FrozenV1View;
}
