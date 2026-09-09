/**
 * Recent fleet messages for a terminal.
 *
 * The dashboard client already owns the four-arm response parser. Its module
 * cannot cross into the root NodeNext project: a Vite-valid extensionless
 * import becomes TS2835 there. The parser below therefore preserves those same
 * arms locally; the rest is the two CLI concerns, resolving a name through
 * `/api/state` and rendering untrusted turns as short plain-text lines.
 */
export type MessageSpeaker =
  | "human"
  | "assistant"
  | "peer"
  | "notification"
  | "compact-summary"
  | "injected"
  | "api-error"
  | "system"
  | "unrecognised";

export type MessageTurn = {
  readonly speaker: MessageSpeaker;
  readonly at: string | null;
  readonly text: string;
  readonly truncated: boolean;
  readonly fullChars: number | null;
  readonly toolCalls: readonly { readonly name: string; readonly detail: string | null }[];
  readonly uuid: string | null;
};

export type MessagesView =
  | {
      readonly kind: "found";
      readonly turns: readonly MessageTurn[];
      readonly turnsOffered: boolean;
      readonly unreadableTurns: number;
    }
  | { readonly kind: "not-found"; readonly reason: string; readonly why: string }
  | { readonly kind: "unreadable"; readonly path: string | null; readonly why: string }
  | { readonly kind: "no-answer"; readonly why: string };

const SPEAKERS: readonly string[] = [
  "human",
  "assistant",
  "peer",
  "notification",
  "compact-summary",
  "injected",
  "api-error",
  "system",
];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function messageSpeaker(value: unknown): MessageSpeaker {
  return typeof value === "string" && SPEAKERS.includes(value) ? value as MessageSpeaker : "unrecognised";
}

function toolCalls(value: unknown): MessageTurn["toolCalls"] {
  if (!Array.isArray(value)) return [];
  const parsed: { name: string; detail: string | null }[] = [];
  for (const item of value) {
    const call = record(item);
    const name = stringOrNull(call?.["name"]);
    if (name !== null) parsed.push({ name, detail: stringOrNull(call?.["detail"]) });
  }
  return parsed;
}

function messageTurn(value: unknown): MessageTurn | null {
  const turn = record(value);
  if (turn === null) return null;
  return {
    speaker: messageSpeaker(turn["speaker"]),
    at: stringOrNull(turn["at"]),
    text: typeof turn["text"] === "string" ? turn["text"] : "",
    truncated: turn["truncated"] === true,
    fullChars: finiteOrNull(turn["fullChars"]),
    toolCalls: toolCalls(turn["toolCalls"]),
    uuid: stringOrNull(turn["uuid"]),
  };
}

/** The browser core could not cross NodeNext's boundary, so this keeps its four arms byte-for-byte in meaning. */
export function parseRecentMessages(raw: unknown): MessagesView {
  const answer = record(raw);
  if (answer === null) return { kind: "no-answer", why: "the dashboard server answered something that is not this API" };
  if (answer["kind"] === "not-found") {
    return {
      kind: "not-found",
      reason: stringOrNull(answer["reason"]) ?? "unstated",
      why: stringOrNull(answer["why"]) ?? "the server said there is no transcript for this session and did not say why",
    };
  }
  if (answer["kind"] === "unreadable") {
    return {
      kind: "unreadable",
      path: stringOrNull(answer["path"]),
      why: stringOrNull(answer["why"]) ?? "the server said it could not read the transcript and did not say why",
    };
  }
  if (answer["kind"] !== "found") {
    return { kind: "no-answer", why: "the dashboard server answered something that is not this API" };
  }
  const turns: MessageTurn[] = [];
  let unreadableTurns = 0;
  const offered = Array.isArray(answer["turns"]);
  if (offered) {
    for (const item of answer["turns"] as unknown[]) {
      const turn = messageTurn(item);
      if (turn === null) unreadableTurns += 1;
      else turns.push(turn);
    }
  }
  return { kind: "found", turns, turnsOffered: offered, unreadableTurns };
}

export const MESSAGE_FETCH_TIMEOUT_MS = 5_000;
export const TURN_TEXT_LIMIT = 220;

export type SnapshotRow = { readonly name: string; readonly id: string };

export type DashboardSnapshot = {
  readonly raw: unknown;
  readonly rows: readonly SnapshotRow[];
};

export type DashboardSnapshotRead =
  | { readonly kind: "snapshot"; readonly snapshot: DashboardSnapshot }
  | { readonly kind: "no-answer"; readonly why: string };

type JsonAnswer =
  | { readonly kind: "answer"; readonly status: number; readonly ok: boolean; readonly body: unknown }
  | { readonly kind: "no-answer"; readonly why: string };

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "the request failed, and gave no reason";
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

/**
 * The one function in this module that touches the network. Status codes are
 * returned with the body because `/api/messages` carries useful not-found and
 * unreadable union arms on non-200 replies.
 */
async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<JsonAnswer> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(MESSAGE_FETCH_TIMEOUT_MS),
    });
  } catch (cause) {
    return { kind: "no-answer", why: `the dashboard could not be reached at ${url} (${describe(cause)})` };
  }
  try {
    return { kind: "answer", status: response.status, ok: response.ok, body: await response.json() as unknown };
  } catch (cause) {
    return {
      kind: "no-answer",
      why: `the dashboard answered ${response.status} and the body was not JSON (${describe(cause)})`,
    };
  }
}

/** Parse only the two row fields this CLI addresses; a dropped row is not a complete register. */
export function snapshotRows(raw: unknown): { ok: true; rows: readonly SnapshotRow[] } | { ok: false; why: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, why: "the dashboard answered something that is not a fleet snapshot" };
  }
  const record = raw as Record<string, unknown>;
  if (record["schema"] !== 1) {
    return { ok: false, why: `the snapshot says schema ${JSON.stringify(record["schema"])} and this build reads schema 1` };
  }
  if (record["error"] !== null) {
    return {
      ok: false,
      why:
        typeof record["error"] === "string"
          ? `the dashboard's last collection failed (${record["error"]}), so its rows are not current`
          : "the snapshot has no readable collection result",
    };
  }
  if (typeof record["collectedAt"] !== "string") {
    return { ok: false, why: "the dashboard has never completed a collection" };
  }
  const rawRows = record["rows"];
  if (!Array.isArray(rawRows)) {
    return { ok: false, why: "the snapshot carries no list of sessions, which is not the same as having none" };
  }
  const rows: SnapshotRow[] = [];
  for (const rawRow of rawRows) {
    if (typeof rawRow !== "object" || rawRow === null || Array.isArray(rawRow)) {
      return { ok: false, why: "a row in the fleet snapshot is not an object, so the register is incomplete" };
    }
    const row = rawRow as Record<string, unknown>;
    if (typeof row["name"] !== "string" || typeof row["id"] !== "string" || !/^\$\d+$/.test(row["id"])) {
      return { ok: false, why: "a row in the fleet snapshot has no usable name and tmux session id, so the register is incomplete" };
    }
    rows.push({ name: row["name"], id: row["id"] });
  }
  return { ok: true, rows };
}

/** One current dashboard snapshot, shared by claim, name resolution and tick annotation. */
export async function fetchDashboardSnapshot(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DashboardSnapshotRead> {
  const answer = await fetchJson(endpoint(baseUrl, "/api/state"), fetchImpl);
  if (answer.kind === "no-answer") return answer;
  if (!answer.ok) return { kind: "no-answer", why: `the dashboard answered ${answer.status} for /api/state` };
  const parsed = snapshotRows(answer.body);
  if (!parsed.ok) return { kind: "no-answer", why: parsed.why };
  return { kind: "snapshot", snapshot: { raw: answer.body, rows: parsed.rows } };
}

/**
 * The only place the tmux `$` is encoded. A raw dollar produces the dashboard's
 * empty error arm, so callers receive a complete URL and cannot forget it.
 */
export function messagesUrl(baseUrl: string, sessionId: string): string {
  return endpoint(baseUrl, `/api/messages?id=${encodeURIComponent(sessionId)}`);
}

/** Fetch by the stable tmux id after a caller has resolved the human name. */
export async function fetchRecentMessages(
  baseUrl: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MessagesView> {
  const answer = await fetchJson(messagesUrl(baseUrl, sessionId), fetchImpl);
  if (answer.kind === "no-answer") return { kind: "no-answer", why: answer.why };
  return parseRecentMessages(answer.body);
}

/** Control characters do not become terminal controls; whitespace becomes one visible line. */
export function plainTurnText(text: string, limit: number = TURN_TEXT_LIMIT): string {
  const printable = [...text].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? " " : character;
  }).join("");
  const oneLine = printable.replace(/\s+/g, " ").trim();
  if (oneLine.length <= limit) return oneLine;
  return `${oneLine.slice(0, Math.max(0, limit - 1))}…`;
}

function turnText(turn: MessageTurn): string {
  if (turn.text !== "") return plainTurnText(turn.text);
  if (turn.toolCalls.length > 0) return `[tool calls: ${turn.toolCalls.map((call) => plainTurnText(call.name, 40)).join(", ")}]`;
  return "[no text]";
}

/** HH:MM is UTC, matching the ISO instants the dashboard returns. */
export function renderTurn(turn: MessageTurn): string {
  const at = turn.at === null || !Number.isFinite(Date.parse(turn.at)) ? "??:??" : turn.at.slice(11, 16);
  return `${at} ${turn.speaker.padEnd(10)} ${turnText(turn)}`;
}

export function recentLines(
  view: MessagesView,
  turns: number,
  speaker?: MessageTurn["speaker"],
): string[] {
  switch (view.kind) {
    case "found": {
      const candidates = speaker === undefined ? view.turns : view.turns.filter((turn) => turn.speaker === speaker);
      const chosen = candidates.slice(-turns);
      if (chosen.length > 0) return chosen.map(renderTurn);
      return [speaker === undefined ? "no turns returned" : `no ${speaker} turns returned`];
    }
    case "not-found":
      return [`not found — ${view.why}`];
    case "unreadable":
      return [`unreadable — ${view.why}`];
    case "no-answer":
      return [`could not read messages — ${view.why}`];
    default: {
      const never: never = view;
      throw new Error(String(never));
    }
  }
}

/** Resolve a mutable name once, then address the messages route by tmux id. */
export async function fetchLastLines(
  baseUrl: string,
  sessionName: string,
  turns: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const read = await fetchDashboardSnapshot(baseUrl, fetchImpl);
  if (read.kind === "no-answer") return [`${sessionName} — not resolved: ${read.why}`];
  const matches = read.snapshot.rows.filter((row) => row.name === sessionName);
  const row = matches[0];
  if (row === undefined) return [`${sessionName} — NOT IN THE FLEET SNAPSHOT`];
  if (matches.length > 1) return [`${sessionName} — ambiguous: ${matches.length} snapshot rows have this name`];
  return recentLines(await fetchRecentMessages(baseUrl, row.id, fetchImpl), turns);
}
