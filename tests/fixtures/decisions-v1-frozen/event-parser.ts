/**
 * **FROZEN.** The decision-event parser as it stood before schema 2, so a test
 * can prove what an OLD reader does with a NEW line. Do not edit it to match
 * the current code — its whole value is that it does not move.
 *
 * Copied on 2026-09-10 from `git show HEAD:tools/overseer/decisions.ts` at
 * f9d4b584 (`parseEvent`, `parseDecided` and the helpers they call), trimmed to
 * what those two need and typed loosely so it depends on nothing that can
 * change. Plan 260910e, GPT Sol's WR-P2: both boundaries are bumped, and a
 * frozen copy of each old parser pins that the bump is actually seen.
 */

const V1_SCHEMA = 1;
const ID_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";
const ID_RULE = new RegExp(`^dec-[${ID_ALPHABET}]{8}$`);
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID_RULE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function asActor(value: unknown): string | null {
  return value === "greg" || value === "overseer" ? value : null;
}

function asClass(value: unknown): string | null {
  return value === "assumption" || value === "decision" || value === "decline" ? value : null;
}

function asIso(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function asOptions(value: unknown): Json[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const options: Json[] = [];
  const names = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate) || !isNonBlank(candidate["name"]) || !isNonBlank(candidate["tradeoffs"])) return null;
    const comparable = candidate["name"].trim();
    if (names.has(comparable)) return null;
    names.add(comparable);
    options.push({ name: candidate["name"], tradeoffs: candidate["tradeoffs"] });
  }
  return options;
}

function asChoice(value: unknown, options: readonly Json[]): Json | null {
  if (!isRecord(value) || !isNonBlank(value["option"]) || !("note" in value)) return null;
  const note = asNullableString(value["note"]);
  if (note === undefined) return null;
  const comparable = value["option"].trim();
  if (!options.some((option) => String(option["name"]).trim() === comparable)) return null;
  return { option: value["option"], note };
}

function asAdvisers(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const advisers: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (candidate !== "sol" && candidate !== "fable" && candidate !== "nobody") return null;
    if (seen.has(candidate)) return null;
    seen.add(candidate);
    advisers.push(candidate);
  }
  if (seen.has("nobody") && seen.size !== 1) return null;
  return advisers;
}

function asExecution(value: unknown): Json | null {
  if (!isRecord(value)) return null;
  switch (value["kind"]) {
    case "verified": {
      const since = asIso(value["since"]);
      return isNonBlank(value["token"]) && since !== null ? { kind: "verified", token: value["token"], since } : null;
    }
    case "not-found":
      return { kind: "not-found" };
    case "unavailable":
      return isNonBlank(value["why"]) ? { kind: "unavailable", why: value["why"] } : null;
    default:
      return null;
  }
}

function asBearsOn(value: unknown): Json | null {
  if (!isRecord(value) || !Array.isArray(value["sessions"]) || !("plan" in value)) return null;
  const plan = asNullableString(value["plan"]);
  if (plan === undefined) return null;
  const sessions: Json[] = [];
  const names = new Set<string>();
  for (const candidate of value["sessions"]) {
    if (!isRecord(candidate) || !isNonBlank(candidate["name"]) || !("execution" in candidate)) return null;
    const execution = asExecution(candidate["execution"]);
    if (execution === null) return null;
    if (names.has(candidate["name"])) return null;
    names.add(candidate["name"]);
    sessions.push({ name: candidate["name"], execution });
  }
  return { sessions, plan };
}

function parseDecided(json: Json, envelope: Json, id: string): Json | null {
  const decidedAt = asIso(json["decidedAt"]);
  const decisionClass = asClass(json["class"]);
  if (decidedAt === null || decisionClass === null) return null;
  if (!isNonBlank(json["question"]) || !isNonBlank(json["why"])) return null;
  const options = asOptions(json["options"]);
  if (options === null) return null;
  const chose = asChoice(json["chose"], options);
  const advisers = asAdvisers(json["advisers"]);
  const bearsOn = asBearsOn(json["bearsOn"]);
  if (!("supersedes" in json)) return null;
  const supersedes = asNullableString(json["supersedes"]);
  if (chose === null || advisers === null || bearsOn === null || supersedes === undefined) return null;
  if (supersedes !== null && !ID_RULE.test(supersedes)) return null;
  return {
    ...envelope,
    kind: "decided",
    id,
    decidedAt,
    class: decisionClass,
    question: json["question"],
    options,
    chose,
    why: json["why"],
    advisers,
    bearsOn,
    supersedes,
  };
}

/** The v1 reader's verdict on one JSONL line: a v1 event, or null. */
export function frozenV1ParseEvent(line: string): Json | null {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(json) || json["schema"] !== V1_SCHEMA || "decidedBy" in json) return null;
  const eventId = json["eventId"];
  const commandId = asNullableString(json["commandId"]);
  const at = asIso(json["at"]);
  const by = asActor(json["by"]);
  const id = json["id"];
  if (typeof eventId !== "string" || !UUID_RULE.test(eventId)) return null;
  if (!("commandId" in json) || commandId === undefined || at === null || by === null) return null;
  if (typeof id !== "string" || !ID_RULE.test(id)) return null;
  const envelope: Json = { schema: V1_SCHEMA, eventId, commandId, at, by };

  switch (json["kind"]) {
    case "decided":
      return parseDecided(json, envelope, id);
    case "reviewed": {
      if (!("note" in json)) return null;
      const note = asNullableString(json["note"]);
      return note === undefined ? null : { ...envelope, kind: "reviewed", id, note };
    }
    case "reversed": {
      if (!("why" in json)) return null;
      const why = asNullableString(json["why"]);
      return why === undefined ? null : { ...envelope, kind: "reversed", id, why };
    }
    default:
      return null;
  }
}
