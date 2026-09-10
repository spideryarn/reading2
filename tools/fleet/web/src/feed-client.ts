/**
 * The cross-agent feed — `GET /api/feed`.
 *
 * ## THE SAME DISCIPLINE AS `messages-client.ts`, AND FOR A SHARPER REASON
 *
 * That file's header is the argument and it is not repeated here. The short
 * version: every scalar off the wire is `X | null` where null means *the server
 * did not say*, because a `0` invented for a missing count is a positive claim
 * that nothing was skipped; and the server's three arms come across intact with
 * a fourth of this client's own, `no-answer`, for *this page never got an answer
 * it could read* — the browser's own network trouble must not appear on screen
 * in the server's voice.
 *
 * What is sharper here is the consequence of getting it wrong. The detail pane
 * shows one session, chosen by the reader, who usually knows what it was doing.
 * **This feed shows sessions the reader was never watching**, so a message that
 * is misattributed, or a session quietly missing from the list, has nothing on
 * screen to contradict it. Hence `attribution` on every message and
 * `mayBeMissing` on the payload, and hence neither of them has a default.
 *
 * ## NEWEST FIRST, AND THE SERVER ALREADY DID IT
 *
 * `/api/messages` returns turns newest LAST; this route returns them newest
 * FIRST. The inversion lives in `routes-recent-feed.ts` so it has one home and
 * one test. **Nothing here re-sorts**, and a client that "helpfully" sorted
 * again would be a second opinion about ordering with nothing keeping the two
 * in step.
 *
 * ## Untrusted, all of it
 *
 * Every string in a message is agent-authored text from a process that may have
 * been handling hostile input. Nothing here interprets it, and nothing that
 * renders it may add markup.
 */
import { executionTokenText } from "../../execution-token.js";
import type {
  FeedAttribution,
  FeedCoverage,
  FeedCoverageReason,
  FeedMessage,
  FeedSessionRead,
} from "../../wire.js";
import type { MessageSpeaker, MessageTurn } from "./messages-client";
import { questionSafetyKey, shiftMsToBrowserClock, type ClockSkew, type FleetRow } from "./types";

export const FEED_URL = "api/feed";

/** Where to ask. The only thing the URL carries is a number. */
export function feedUrl(limit: number): string {
  return `${FEED_URL}?limit=${encodeURIComponent(String(limit))}`;
}

/**
 * The speakers this build knows, for rounding an unfamiliar one.
 *
 * Deliberately the same list as `messages-client.ts` holds, because it is the
 * same question — and `Turn.tsx`'s `SPEAKERS` map is keyed by `MessageSpeaker`,
 * so a speaker that did not round to one of these could not be drawn at all.
 */
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

/**
 * One message: a turn, plus which session it was read for and how much we may
 * claim about that.
 *
 * `turn` is a `MessageTurn` so that `Turn.tsx` can draw it unchanged — the same
 * nine-arm speaker discrimination, with its two landmines, in one place.
 */
export type FeedRow = {
  sessionId: string;
  sessionName: string;
  sessionTitle: string | null;
  attribution: FeedAttribution;
  turn: MessageTurn;
};

/** One session in the feed's census of the fleet, readable or not. */
export type FeedSessionView = {
  sessionId: string;
  name: string;
  title: string | null;
  read: FeedSessionRead;
};

export type FeedView =
  | {
      kind: "feed";
      /** What the server actually served, after its own clamp — not what we asked for. */
      limit: number | null;
      /** **Newest first**, as the server sent them. Never re-sorted here. */
      messages: FeedRow[];
      /** Messages with no placeable timestamp. Never dropped, never interleaved. */
      undated: FeedRow[];
      sessions: FeedSessionView[];
      /**
       * Whether there was a `sessions` array at all. An empty census and a
       * server that sent no census are opposite claims, and only one of them
       * means "no sessions on the box".
       */
      sessionsOffered: boolean;
      /** Entries this page could not read. Counted, never silently dropped. */
      unreadableRows: number;
      /**
       * Whether this really is the last N messages. **The panel may not draw
       * the list without meeting this**, and a server that did not send it is
       * `indeterminate` with a reason saying so — never `complete`, which is a
       * claim only the server is in a position to make.
       */
      coverage: FeedCoverage;
      collectedAt: string | null;
      readStartedAt: string | null;
      readFinishedAt: string | null;
      servedAt: string | null;
      /**
       * Which tmux server the `sessionId`s in this answer belong to — wire.ts
       * § `FeedPayload.tmuxServerPid`.
       *
       * `null` for a server that did not send it as well as for a collector
       * that could not read it, and the page treats both the same way: it
       * withholds the join to the session list rather than guessing that two
       * sets of handles name one world.
       */
      tmuxServerPid: number | null;
    }
  | { kind: "unreadable"; why: string }
  /** This page never got an answer it could read. **Our sentence, not the server's.** */
  | { kind: "no-answer"; why: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function speakerOf(v: unknown): MessageSpeaker {
  return typeof v === "string" && SPEAKERS.includes(v) ? (v as MessageSpeaker) : "unrecognised";
}

function parseToolCalls(v: unknown): { name: string; detail: string | null }[] {
  if (!Array.isArray(v)) return [];
  const out: { name: string; detail: string | null }[] = [];
  for (const call of v) {
    if (!isRecord(call)) continue;
    const name = str(call["name"]);
    if (name === null) continue;
    out.push({ name, detail: str(call["detail"]) });
  }
  return out;
}

/**
 * How much the server said it may claim about who said this.
 *
 * **An unrecognised arm becomes `claimed-only`, never `verified`.** Same
 * discipline as rounding an unknown speaker to `unrecognised`: the failure to
 * avoid is inventing confidence. A build that meets a `verified` it does not
 * understand should under-claim, not over-claim.
 */
function parseAttribution(v: unknown): FeedAttribution {
  const fallback: FeedAttribution = {
    kind: "claimed-only",
    why: "the dashboard did not say how much it could verify about this message's session, so this page will not claim it was checked",
  };
  if (!isRecord(v)) return fallback;
  const kind = v["kind"];
  if (kind === "verified") return { kind: "verified" };
  const why = str(v["why"]);
  if (kind === "suspect") {
    return { kind: "suspect", why: why ?? "the dashboard flagged this session's transcript and did not say why" };
  }
  if (kind === "claimed-only") return { kind: "claimed-only", why: why ?? fallback.why };
  return fallback;
}

/**
 * One row, or null when it is not an object at all.
 *
 * `text` defaults to `""`, which is a REAL turn rather than a broken one — an
 * agent turn that only called tools has exactly that. A row dropped for want of
 * a string would be an agent that appeared to sit silent.
 */
function parseRow(v: unknown): FeedRow | null {
  if (!isRecord(v)) return null;
  const sessionId = str(v["sessionId"]);
  /* **THE ONE FIELD WITH NO HONEST DEFAULT.** Every other gap can be drawn as
     "the server did not say"; a message with no session is a message this feed
     cannot attribute at all, and putting it on screen under a blank name is the
     misattribution the whole payload is shaped to prevent. */
  if (sessionId === null) return null;
  const turn: MessageTurn = {
    speaker: speakerOf(v["speaker"]),
    /* The server's own string, on the box's clock, NOT shifted — the same rule
       as `MessageTurn.at` in messages-client.ts, and for the same reason:
       shifting it would assert an absolute instant nothing happened at. */
    at: str(v["at"]),
    text: typeof v["text"] === "string" ? v["text"] : "",
    truncated: v["truncated"] === true,
    fullChars: num(v["fullChars"]),
    toolCalls: parseToolCalls(v["toolCalls"]),
    uuid: str(v["uuid"]),
  };
  return {
    sessionId,
    sessionName: str(v["sessionName"]) ?? sessionId,
    sessionTitle: str(v["sessionTitle"]),
    attribution: parseAttribution(v["attribution"]),
    turn,
  };
}

function parseRows(v: unknown): { rows: FeedRow[]; unreadable: number } {
  if (!Array.isArray(v)) return { rows: [], unreadable: 0 };
  const rows: FeedRow[] = [];
  let unreadable = 0;
  for (const item of v) {
    const row = parseRow(item);
    if (row === null) unreadable += 1;
    else rows.push(row);
  }
  return { rows, unreadable };
}

/**
 * One session's read. An arm this build does not know becomes `unreadable` with
 * a sentence saying so — **never a `read` with zero turns**, which would claim
 * we looked and the session was quiet.
 */
function parseRead(v: unknown): FeedSessionRead {
  if (!isRecord(v)) {
    return { kind: "unreadable", path: null, why: "the dashboard did not say what happened when it read this session" };
  }
  const kind = v["kind"];
  if (kind === "not-found") {
    return {
      kind: "not-found",
      reason: str(v["reason"]) ?? "unstated",
      why: str(v["why"]) ?? "the dashboard said there is no transcript for this session and did not say why",
    };
  }
  if (kind === "read") {
    return {
      kind: "read",
      turns: num(v["turns"]) ?? 0,
      /* **DEFAULTS TO FALSE, WHICH IS THE UNDER-CLAIM.** `complete` is a
         positive assertion that this session's newest turns were all read; a
         server that did not say has not made it, and inventing `true` would
         silence the one warning that stops a truncated session reading as a
         quiet one. */
      complete: v["complete"] === true,
      lastModified: str(v["lastModified"]) ?? "",
      bytesRead: num(v["bytesRead"]) ?? 0,
      fileBytes: num(v["fileBytes"]) ?? 0,
      toolResultsSkipped: num(v["toolResultsSkipped"]) ?? 0,
      /* Both default to the value that raises no alarm, because a server that
         did not send them has made no claim and this page must not invent one
         in the alarming direction either. `copies` of 1 and 0 unparseable lines
         are the ordinary case. */
      copies: num(v["copies"]) ?? 1,
      recordsUnparseable: num(v["recordsUnparseable"]) ?? 0,
    };
  }
  if (kind === "unreadable") {
    return {
      kind: "unreadable",
      path: str(v["path"]),
      why: str(v["why"]) ?? "the dashboard said it could not read this session's transcript and did not say why",
    };
  }
  return {
    kind: "unreadable",
    path: null,
    why: "this build does not understand what the dashboard said about reading this session",
  };
}

function parseSessions(v: unknown): FeedSessionView[] {
  if (!Array.isArray(v)) return [];
  const out: FeedSessionView[] = [];
  for (const item of v) {
    if (!isRecord(item)) continue;
    const sessionId = str(item["sessionId"]);
    if (sessionId === null) continue;
    out.push({
      sessionId,
      name: str(item["name"]) ?? sessionId,
      title: str(item["title"]),
      read: parseRead(item["read"]),
    });
  }
  return out;
}

const COVERAGE_KINDS: readonly string[] = [
  "byte-budget",
  "unreadable",
  "no-transcript",
  "undated",
  "out-of-order",
  "duplicate-conversation",
];

/**
 * Whether the server was able to claim this really is the last N messages.
 *
 * **A MISSING OR UNRECOGNISED ANSWER IS `indeterminate`, NEVER `complete`.**
 * This is the one field where the under-claim and the over-claim are not
 * symmetric: `complete` is a positive assertion that four premises held, and a
 * build that met an arm it did not understand and rounded it to `complete`
 * would put a confident "the last 50 messages" over a feed with a hole in it.
 */
function parseCoverage(v: unknown): FeedCoverage {
  const unknown: FeedCoverage = {
    kind: "indeterminate",
    reasons: [
      {
        sessionId: "",
        name: "",
        kind: "unreadable",
        why: "the dashboard did not say whether this is really the last N messages, so this page will not claim that it is",
      },
    ],
  };
  if (!isRecord(v)) return unknown;
  if (v["kind"] === "complete") return { kind: "complete" };
  if (v["kind"] !== "indeterminate") return unknown;
  const raw = v["reasons"];
  if (!Array.isArray(raw)) return unknown;
  const reasons: FeedCoverageReason[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const kind = item["kind"];
    reasons.push({
      sessionId: str(item["sessionId"]) ?? "",
      name: str(item["name"]) ?? "",
      /* An unfamiliar reason is still a reason: it is kept as `unreadable` —
         the vaguest arm — rather than dropped, because dropping the last one
         would turn an indeterminate feed into an empty-reasons one, which reads
         as complete. */
      kind: typeof kind === "string" && COVERAGE_KINDS.includes(kind) ? (kind as FeedCoverageReason["kind"]) : "unreadable",
      why: str(item["why"]) ?? "the dashboard did not say why",
    });
  }
  return reasons.length === 0 ? unknown : { kind: "indeterminate", reasons };
}

/**
 * The reply, whatever it is. **Never throws and never returns null** — an
 * answer it cannot classify is `no-answer` with a sentence, because a caller
 * left holding a null would have to write that sentence itself and there would
 * then be two of them.
 */
export function parseFeed(raw: unknown): FeedView {
  if (!isRecord(raw)) {
    return { kind: "no-answer", why: "the dashboard server answered something that is not this API" };
  }
  const kind = raw["kind"];
  if (kind === "unreadable") {
    return {
      kind: "unreadable",
      why: str(raw["why"]) ?? "the dashboard said it could not build the feed and did not say why",
    };
  }
  if (kind !== "feed") {
    return { kind: "no-answer", why: "the dashboard server answered something that is not this API" };
  }

  /**
   * **THE REQUIRED FIELDS ARE REQUIRED, AND A MISSING ONE IS `no-answer`.**
   *
   * Until GPT Sol's P1 on the code review, an absent array parsed as a
   * successfully empty one — so `{ kind: "feed", coverage: { kind: "complete" } }`
   * came back as a **confidently complete feed with no messages, no sessions and
   * no caveat**: the exact "we looked and the fleet was silent" lie this whole
   * payload is shaped to prevent, produced by a body that said almost nothing.
   *
   * `schema` is checked for the same reason. A later build's payload is not
   * this one, and guessing at it would render some of it and drop the rest
   * silently — better to say plainly that this page cannot read the answer.
   */
  if (raw["schema"] !== 1) {
    return {
      kind: "no-answer",
      why: "the dashboard server answered with a feed this build does not know how to read — its schema is not the one this page was written for, so the page will not guess at it",
    };
  }
  for (const required of ["messages", "undated", "sessions"]) {
    if (!Array.isArray(raw[required])) {
      return {
        kind: "no-answer",
        why: `the dashboard server answered a feed with no \`${required}\` list, so this page cannot tell an empty fleet from a broken answer and will not claim either`,
      };
    }
  }

  const messages = parseRows(raw["messages"]);
  const undated = parseRows(raw["undated"]);
  const rawSessions = raw["sessions"];
  return {
    kind: "feed",
    limit: num(raw["limit"]),
    messages: messages.rows,
    undated: undated.rows,
    sessions: parseSessions(rawSessions),
    sessionsOffered: Array.isArray(rawSessions),
    unreadableRows: messages.unreadable + undated.unreadable,
    coverage: parseCoverage(raw["coverage"]),
    collectedAt: str(raw["collectedAt"]),
    readStartedAt: str(raw["readStartedAt"]),
    readFinishedAt: str(raw["readFinishedAt"]),
    servedAt: str(raw["servedAt"]),
    /* A pid is a positive integer or it is nothing. `num` alone would accept a
       0 or a float and hand it to a comparison that would then quietly say
       "different world" for ever. */
    tmuxServerPid:
      typeof raw["tmuxServerPid"] === "number" &&
      Number.isSafeInteger(raw["tmuxServerPid"]) &&
      raw["tmuxServerPid"] > 0
        ? raw["tmuxServerPid"]
        : null,
  };
}

/* ------------------------------------------------------------------ *
 * The filters. Pure, so the panel holds no filtering logic of its own.
 * ------------------------------------------------------------------ */

/**
 * What the reader has narrowed the feed to.
 *
 * All four live in the URL hash (mode.ts § the hash), so a filtered view
 * survives the reload iOS performs whenever it reclaims the tab.
 */
export type FeedFilters = {
  /** Session handles to keep. Empty means every session — never "no sessions". */
  sessions: string[];
  /** Speakers to keep. Empty means every speaker. */
  speakers: MessageSpeaker[];
  /** Plain substring, case-insensitive. Never a regex — a reader typing `(` must not get an error. */
  text: string;
  /** Hide turns whose only content was tool calls. */
  hideToolCalls: boolean;
};

export const NO_FILTERS: FeedFilters = { sessions: [], speakers: [], text: "", hideToolCalls: false };

/**
 * Is this row a tool call and nothing else?
 *
 * **`text === ""` is the test, not `toolCalls.length > 0`.** A turn that says
 * something AND calls a tool is a message, and hiding it would drop the agent's
 * own words — which is the failure mode of every "hide noise" toggle that was
 * ever regretted.
 */
export function isToolCallOnly(row: FeedRow): boolean {
  return row.turn.text === "" && row.turn.toolCalls.length > 0;
}

/** Apply the filters. Pure, order-preserving, and it never re-sorts. */
export function applyFilters(rows: FeedRow[], filters: FeedFilters): FeedRow[] {
  const needle = filters.text.trim().toLowerCase();
  const sessions = new Set(filters.sessions);
  const speakers = new Set<string>(filters.speakers);
  return rows.filter((row) => {
    if (sessions.size > 0 && !sessions.has(row.sessionId)) return false;
    if (speakers.size > 0 && !speakers.has(row.turn.speaker)) return false;
    if (filters.hideToolCalls && isToolCallOnly(row)) return false;
    if (needle !== "") {
      /* The session's name is searched as well as the text, so typing a
         session name is a quick way to narrow without opening the picker. */
      const hay = `${row.turn.text}\n${row.sessionName}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * The filters, in the URL.
 * ------------------------------------------------------------------ */

/**
 * The hash keys. Prefixed `m` so they cannot collide with `order`, `sel` or
 * whatever a later tab adds — mode.ts carries unrecognised parameters through
 * untouched, which only works if two tabs do not pick the same name.
 */
export const FILTER_KEYS = {
  text: "mq",
  sessions: "ms",
  speakers: "mw",
  hideToolCalls: "mt",
  limit: "mn",
} as const;

/**
 * The filters a hash names.
 *
 * **Every field falls back to "no filter" rather than to an error.** A hash is
 * a thing people edit, bookmark and send each other, and one written by a later
 * build must degrade to showing more than was meant — never to showing nothing,
 * and never to a blank page.
 */
export function filtersFromParams(params: Readonly<Record<string, string>>): FeedFilters {
  const split = (v: string | undefined): string[] =>
    v === undefined || v === "" ? [] : v.split(",").filter((s) => s !== "");
  return {
    sessions: split(params[FILTER_KEYS.sessions]),
    /* A speaker this build does not know is dropped from the filter rather than
       kept: keeping it would narrow the list by a name nothing can match, and
       the reader would see an empty feed with no way to tell why. */
    speakers: split(params[FILTER_KEYS.speakers]).filter((s): s is MessageSpeaker =>
      [...SPEAKERS, "unrecognised"].includes(s),
    ),
    text: params[FILTER_KEYS.text] ?? "",
    hideToolCalls: params[FILTER_KEYS.hideToolCalls] === "1",
  };
}

/**
 * The hash parameters for a set of filters.
 *
 * **A default writes `null`, which mode.ts turns into a removed key** — so
 * "back to showing everything" leaves no trace in the URL rather than a trail
 * of empty parameters.
 */
export function paramsFromFilters(filters: FeedFilters): Record<string, string | null> {
  return {
    [FILTER_KEYS.sessions]: filters.sessions.length > 0 ? filters.sessions.join(",") : null,
    [FILTER_KEYS.speakers]: filters.speakers.length > 0 ? filters.speakers.join(",") : null,
    [FILTER_KEYS.text]: filters.text.trim() === "" ? null : filters.text,
    [FILTER_KEYS.hideToolCalls]: filters.hideToolCalls ? "1" : null,
  };
}

/** How many messages the hash asks for, clamped to the sizes the picker offers. */
export const FEED_LIMITS = [25, 50, 100, 200] as const;

export function limitFromParams(params: Readonly<Record<string, string>>): number {
  const raw = Number(params[FILTER_KEYS.limit]);
  return (FEED_LIMITS as readonly number[]).includes(raw) ? raw : 50;
}

/* ------------------------------------------------------------------ *
 * Scanning a row: what the session is doing, and how long ago it spoke.
 * ------------------------------------------------------------------ */

/**
 * What this page can say about the session a message came from.
 *
 * > can we make "Recent messages" … scannable (e.g. to see at a glance the
 * > status and human-readable timing of each)
 * >
 * > — Greg, 2026-09-09
 *
 * **The status is the LIVE session list's, not a second reading.** The feed
 * route says nothing about what a session is doing now, and adding a field to
 * it would be a second answer to a question `/api/state` already answers, on a
 * different cadence, kept in step by nothing. `App` already holds the rows the
 * Sessions tab draws, so a row here is looked up in exactly those and drawn
 * with exactly that component — which is what makes the two tabs structurally
 * unable to disagree (overseer-direction.md § `idle` is the bug).
 *
 * **The two ways there is no status are two different sentences, and neither is
 * calm.** The feed's census was taken before the session list's, so a session
 * genuinely can have gone; and before the first payload nothing has been read
 * at all. Drawing nothing for either — or worse, `idle` — is the failure this
 * whole tab is shaped against.
 */
export type FeedSessionStatus =
  /** No state payload has arrived at all. Nothing has been read, so nothing may be claimed. */
  | { kind: "not-arrived" }
  /**
   * A state payload arrived, but no census has finished — `collectedAt` is null
   * for the first seconds after a restart while a collection runs.
   *
   * **A separate arm from `not-arrived` because it is a different fact**, and
   * from `not-listed` because an unfinished census lists nobody: reading "not in
   * the session list" off it would call every session on the box absent. It is
   * the same distinction `SessionsPanel` draws between "No sessions." and
   * "Collecting…".
   */
  | { kind: "not-collected" }
  /**
   * **ONE OF THE TWO ANSWERS DID NOT SAY WHICH TMUX SERVER IT READ**, so the
   * handles cannot be shown to name the same world — but nothing says they do
   * not, either.
   *
   * No status: an unverified join is a guess, and this page does not print
   * guesses as facts. **The way in stays**, and the asymmetry is deliberate.
   * A server that predates `tmuxServerPid` answers like this for every row, and
   * treating ignorance as proof would switch the whole feature off against it —
   * "a warning that never clears, and one nobody reads", which
   * fleet-recent-messages.md already names as this tab's characteristic
   * failure. The cost of being wrong is bounded and visible: the destination
   * pane prints the session's own name and handle, and `SessionsPanel` already
   * draws `MissingSession` for a handle it cannot find.
   */
  | { kind: "unverifiable"; why: string }
  /**
   * **THE TWO ANSWERS NAME DIFFERENT TMUX SERVERS**, which is not ignorance but
   * proof: the tmux server has restarted since this feed was read, so every
   * handle in it now belongs to somebody else.
   *
   * No status and **no way in** — a click would open a real, wrong conversation
   * with nothing on screen to say so.
   */
  | { kind: "different-world"; why: string }
  /**
   * A finished census that holds no row with this id.
   *
   * `unreadableRows` decides whether this is a *claim* or a *maybe*: a payload
   * whose rows the page could not all parse cannot say the session is absent,
   * only that it is not in the part that was readable.
   */
  | { kind: "not-listed"; unreadableRows: number }
  | { kind: "listed"; row: FleetRow };

/**
 * The last session list this page received, in the only shape that can tell its
 * three states apart.
 *
 * **`rows: []` IS NOT AN ABSENCE OF ROWS.** It is a measurement — *we read the
 * fleet and it holds nobody* — and there are two other things a page can be
 * holding: no payload, and a payload whose collection has not finished. `App`
 * builds this arm by arm; nothing here defaults.
 *
 * "Last good", not "live": a failed poll deliberately leaves the previous rows
 * on screen (useFleetState.ts), and the masthead qualifies their staleness for
 * the whole page rather than per row.
 */
export type SessionListReading =
  | { kind: "not-arrived" }
  | { kind: "not-collected" }
  | {
      kind: "collected";
      rows: readonly FleetRow[];
      /** Rows the payload held and this page could not parse. `0` is a measurement. */
      unreadableRows: number;
      /** Which tmux server these handles belong to. `null` when the collector could not say. */
      tmuxServerPid: number | null;
    };

/**
 * **WHAT THE SESSION LIST SAYS THAT COULD MEAN THE FEED IS OUT OF DATE** — the
 * evidence `useFeed` re-reads on, as one comparable string. GPT Sol's F6 on
 * docs/plans/260910c, and its wording is the spec.
 *
 * `tmuxServerPid`, then every row sorted by id, each as `[id, claudeSessionId,
 * status.kind, questionSafetyKey(rawQuestion), last verified token]`. A session
 * appearing or going, changing status, getting or losing a dialog, claiming a
 * different conversation, or having its run replaced changes the string;
 * nothing else does.
 *
 * **NO `why`, ANYWHERE IN IT.** The unverifiable arms reword their sentence
 * between collections on a loaded box, and a digest that carried one would
 * change on every snapshot — the feed would become the poll it is designed not
 * to be. The same goes for `waiting`'s countdown, which is why a status is its
 * `kind` alone.
 *
 * **THE EXECUTION IS THE LAST TOKEN THAT WAS VERIFIED — never the reading's
 * kind, cause or harness.** A row flips `verified` ↔ `unknown` for a
 * collection or two at a time as the box's ordinary weather (continuity.ts's
 * header has the history), and no transcript moves when the box merely fails
 * to name a process. Counting the flip re-read the feed about once a
 * collection for nothing — the plan's own ruling, *absence of confirmation is
 * not evidence*, applied here. So an unverified reading contributes whatever
 * `lastVerified` holds for that row, a row that has never verified contributes
 * `null` for ever, and only a *different verified token* — a real replacement —
 * moves it. The harness and the observed conversation are left out too: both
 * are read off one process's command line, which that process cannot change,
 * so neither can move without the token moving. The conversation *claim*
 * (`claudeSessionId`) stays in, because a changed claim is a fact.
 *
 * `null` for the two arms with no census: there is nothing to compare, and a
 * page that has not heard from the box has no evidence of anything.
 *
 * **It depends on `/api/state` and nothing else**, which is what stops the
 * re-read from looping: a feed answer, and the time it arrived, cannot change it.
 */
export type FeedEvidence = { digest: string; tmuxServerPid: number | null };

/** This reading's token as text, or null for every arm that names no run. */
function verifiedToken(execution: FleetRow["execution"]): string | null {
  return execution.kind === "verified" ? executionTokenText(execution.token) : null;
}

/**
 * `lastVerified` is row id → the last verified token seen for it, as
 * {@link rememberVerified} keeps it. Defaulted to empty, which is right for a
 * single snapshot on its own: every unverified row then contributes `null`.
 */
export function feedEvidence(
  list: SessionListReading,
  lastVerified: ReadonlyMap<string, string> = new Map(),
): FeedEvidence | null {
  if (list.kind !== "collected") return null;
  const rows = [...list.rows]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((row) => [
      row.id,
      row.claudeSessionId,
      row.status.kind,
      questionSafetyKey(row.rawQuestion),
      verifiedToken(row.execution) ?? lastVerified.get(row.id) ?? null,
    ]);
  return { digest: JSON.stringify([list.tmuxServerPid, rows]), tmuxServerPid: list.tmuxServerPid };
}

/**
 * The memory `feedEvidence` reads: each current row's newest verified token,
 * carried across the collections in which it could not be verified.
 *
 * **Rebuilt from the current rows**, so a session that has gone takes its entry
 * with it and the map stays the size of the fleet for the life of the tab. A
 * row that went and came back has lost its memory — but its going and coming
 * already changed the digest, so nothing is missed. A list with no census
 * leaves the memory as it was: it is no news about any row.
 */
export function rememberVerified(
  list: SessionListReading,
  previous: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  if (list.kind !== "collected") return previous;
  const next = new Map<string, string>();
  for (const row of list.rows) {
    const token = verifiedToken(row.execution) ?? previous.get(row.id);
    if (token !== undefined) next.set(row.id, token);
  }
  return next;
}

/**
 * The status of the session a message came from.
 *
 * Pure, and it takes the feed's own `tmuxServerPid` beside the list's: the join
 * is only sound when both name the same tmux server, and neither a missing pid
 * nor a mismatched one may be rounded to "close enough".
 */
export function sessionStatusOf(
  list: SessionListReading,
  feedTmuxServerPid: number | null,
  sessionId: string,
): FeedSessionStatus {
  if (list.kind === "not-arrived") return { kind: "not-arrived" };
  if (list.kind === "not-collected") return { kind: "not-collected" };
  /* **THE GATE, BEFORE ANY LOOKUP.** A `$1643` from a feed read before a tmux
     restart is a different session from the `$1643` in this snapshot, and the
     handles are identical either way — so the check has to happen before the
     `find`, not as a caveat on its result. */
  if (feedTmuxServerPid === null || list.tmuxServerPid === null) {
    return {
      kind: "unverifiable",
      why: `${feedTmuxServerPid === null ? "these messages" : "the session list"} did not say which tmux server they were read from, so this page cannot check that the handle in the message means the same session as the one in the list. It usually does; it stops being true when the tmux server restarts.`,
    };
  }
  if (feedTmuxServerPid !== list.tmuxServerPid) {
    return {
      kind: "different-world",
      why: `these messages were read from tmux server ${feedTmuxServerPid} and the session list came from ${list.tmuxServerPid}, so the handles belong to different worlds — the tmux server has restarted since this feed was read. Read the feed again.`,
    };
  }
  const row = list.rows.find((r) => r.id === sessionId);
  return row === undefined
    ? { kind: "not-listed", unreadableRows: list.unreadableRows }
    : { kind: "listed", row };
}

/**
 * When a turn was written, as an age — or as the reason there is no age.
 *
 * **THE AGE IS SHIFTED AND THE TIMESTAMP IS NOT**, and the two halves of that
 * come from the same `at`. An age is a SUBTRACTION between the box's clock and
 * this device's, which is exactly what `ClockSkew` exists to correct
 * (types.ts § `ClockSkew`). Printing the instant is not: `withClockSkew` in
 * messages-client.ts carries GPT Sol's K4 on precisely this — shifting a string
 * that is drawn as a wall clock asserts an absolute instant nothing happened
 * at. So the row prints `zonedLine(turn.at)` unshifted beside an age computed
 * through here, the same split `UsagePanel` makes.
 */
export type TurnAge =
  /** How long ago, in this browser's terms. */
  | { kind: "aged"; ms: number }
  /**
   * The turn is stamped **ahead of this device's clock** by more than the page's
   * own noticing threshold.
   *
   * A separate arm rather than a clamp to zero. Clamping is right for `uptime`,
   * where the two numbers come from one clock; here they come from two, so a
   * real minute of disagreement is a fact about the clocks and "0s ago" would
   * hide it behind the most reassuring answer available.
   */
  | { kind: "ahead"; ms: number }
  /** No timestamp, or one this page cannot parse. There is nothing to print. */
  | { kind: "unplaceable" };

/**
 * How far ahead a turn may be stamped before it is reported rather than rounded
 * to now.
 *
 * **ITS OWN CONSTANT, and small.** This was `CLOCK_SKEW_NOTICE_MS` for a review
 * round, and GPT Sol was right that borrowing it is not the same argument: that
 * threshold governs whether the masthead mentions a *measured* device-clock
 * disagreement, and at 60 seconds it made a turn stamped 59 seconds in the
 * future read "0s ago" — on a row whose own formatter prints seconds for
 * anything under five minutes. The slack this actually wants is the round trip
 * that produced the number: `readClockSkew` understates the skew by one-way
 * latency, which on a box talking to itself is milliseconds, plus the one-second
 * tick of `useNow`. Five seconds is generous for both and small enough that a
 * real clock disagreement still shows up as one.
 */
export const TURN_AHEAD_TOLERANCE_MS = 5_000;

/**
 * A timestamp that came out of `toISOString()`, or null.
 *
 * **`Date.parse` IS NOT A VALIDATOR**, and this is the trap types.ts already
 * documents for `servedAt`: `Date.parse("0")` is January 2000, not a refusal,
 * so a junk `at` would be drawn as a confident age twenty-six years old rather
 * than as the unreadable thing it is. The feed's parser accepts any string into
 * `turn.at` deliberately — the server said something and dropping it would hide
 * that — so the check belongs here, where the string is about to become a
 * number. GPT Sol's P2.
 *
 * The cost is strictness: a timestamp without milliseconds would be refused and
 * drawn as its raw string. That is the safe direction, and every transcript
 * timestamp this reads is written by `toISOString()`.
 */
function canonicalIso(v: string): number | null {
  const at = new Date(v);
  const ms = at.getTime();
  return Number.isNaN(ms) || at.toISOString() !== v ? null : ms;
}

export function turnAge(at: string | null, now: number, skew: ClockSkew): TurnAge {
  if (at === null) return { kind: "unplaceable" };
  const parsed = canonicalIso(at);
  if (parsed === null) return { kind: "unplaceable" };
  const ms = now - shiftMsToBrowserClock(parsed, skew);
  if (ms < -TURN_AHEAD_TOLERANCE_MS) return { kind: "ahead", ms: -ms };
  return { kind: "aged", ms: Math.max(0, ms) };
}

/* ------------------------------------------------------------------ *
 * The seam.
 * ------------------------------------------------------------------ */

/**
 * The injection point, the same shape as `MessagesApi` and `ActionsApi`.
 *
 * **THE SIGNAL IS PART OF THE SEAM** (GPT Sol's F5 on docs/plans/260910c): an
 * `AbortController` in a hook that does not make the fetch aborts nothing, so
 * the hook hands its signal through here and the client hands it to `fetch`.
 * `useFeed` does not *depend* on an api honouring it — it keeps its own
 * deadline and discards late answers — but a real read it has given up on
 * should stop costing the box.
 */
export type FeedApi = { recent: (limit: number, signal?: AbortSignal) => Promise<FeedView> };

/** A thrown thing, as a sentence. Never "[object Object]". */
function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "the request failed, and gave no reason";
}

/**
 * **The HTTP status is not consulted**, for the reason messages-client.ts
 * gives: the route answers every failure with the same union the 200 carries,
 * so branching on the code as well as the body would be a second copy of the
 * server's decision kept in step by nothing. The body decides; the status only
 * appears in the sentence this file writes when the body was no use.
 */
export function makeFeedApi(fetchImpl: typeof fetch = fetch): FeedApi {
  return {
    async recent(limit, signal): Promise<FeedView> {
      let response: Response;
      try {
        response = await fetchImpl(feedUrl(limit), { cache: "no-store", ...(signal === undefined ? {} : { signal }) });
      } catch (cause) {
        return { kind: "no-answer", why: `this browser could not reach the dashboard: ${describe(cause)}` };
      }
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch (cause) {
        return {
          kind: "no-answer",
          why: `the dashboard server answered ${response.status} and the body was not JSON: ${describe(cause)}`,
        };
      }
      return parseFeed(parsed);
    },
  };
}

/** The default instance. Late-bound `fetch`, for the reason steer-client.ts gives. */
export const httpFeedApi: FeedApi = { recent: (limit, signal) => makeFeedApi().recent(limit, signal) };

/** What `FeedMessage` looks like on the wire, re-exported so a test can build one. */
export type { FeedMessage };
