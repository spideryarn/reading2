/**
 * The tail of one session's conversation — `GET /api/messages?id=`.
 *
 * ## What this file is, and what it is not
 *
 * `tools/fleet/transcript.ts` is the reader, it is tested, and this is the
 * first thing that ever calls it. Nothing here re-implements any part of it:
 * the server locates the file, walks it backwards, classifies the speakers and
 * writes the sentence for every way it can fail. This module's whole job is to
 * read that answer **without softening it**.
 *
 * ## FOUR ARMS, BECAUSE THE SERVER HAS THREE AND THE WIRE CAN FAIL TOO
 *
 * `RecentMessages` in transcript.ts is a three-armed union, and its header says
 * why: *"There is deliberately no arm that returns turns and an error, and no
 * arm whose emptiness has to be interpreted."* Those three come across intact.
 * The fourth is this client's, and it is the same distinction actions-client.ts
 * draws with its `…Offered` flags — *an empty catalogue and a server that sent
 * no catalogue are opposite claims*:
 *
 *  - **`unreadable`** is *the server tried and could not*. Its `why` is the
 *    server's, and it knows the path.
 *  - **`no-answer`** is *this page never got an answer it could read* — the
 *    fetch threw, the body was not JSON, or it was JSON that is not this API.
 *    Its sentence is ours and says so.
 *
 * Collapsing those two would put the browser's own network trouble on screen
 * in the server's voice, and there is nowhere else the difference is recorded.
 *
 * ## THE THREE FIELDS THAT ARE NOT DECORATION
 *
 * transcript.ts documents them at length and each one is a requirement on
 * whatever renders this:
 *
 *  - **`reachedStartOfFile`** is *"what stops '3 turns' from being
 *    ambiguous"*. `false` means the walk stopped on the limit and there is more
 *    above; `true` means the session really has said this much and no more. So
 *    it is `boolean | null` here: a server that did not send it has made **no
 *    claim**, and defaulting it either way invents one — see `NO CLAIM` below.
 *  - **`lastModified`** is the one check on the hazard the reader cannot see
 *    from inside. `claudeSessionId` comes from a tmux env var set once at
 *    session creation and never updated, so a re-used pane resolves to the
 *    *previous* conversation: real messages, well formed, correctly attributed,
 *    and not the conversation on screen. `transcriptAge` below is what turns
 *    that into something a person can see.
 *  - **`toolResultsSkipped`** exists *"so the client can say 'and 40 tool
 *    results' rather than implying the agent sat silent between two
 *    messages"*.
 *
 * ## NO CLAIM, AND WHY EVERY NUMBER HERE IS NULLABLE
 *
 * Every scalar off the wire is `X | null`, where null means *the server did not
 * say*. That is not defensiveness for its own sake: this page's entire value is
 * that it does not quietly fill gaps in, and a `0` invented for a missing
 * `toolResultsSkipped` is a positive claim that nothing was skipped.
 *
 * ## AN UNKNOWN SPEAKER IS `unrecognised`, NEVER `assistant`
 *
 * Same discipline as `parseAction`'s fourth arm, with a sharper edge: rounding
 * an unfamiliar speaker to `assistant` would MISATTRIBUTE a message. transcript.ts
 * names the hazard — a `compact-summary` is machine-written text wearing
 * `role: "user"` and *"is the single most convincing wrong answer this module
 * could give"* — and the client half of not making that mistake is to draw a
 * speaker it cannot name as one it cannot name.
 *
 * ## Untrusted, all of it
 *
 * Every string in a turn is agent-authored text from a process that may have
 * been handling hostile input. Nothing here interprets it, and nothing that
 * renders it may add markup — no raw-HTML escape hatch, no markdown renderer,
 * no linkifier. The same rule as the pane capture, stated in server.ts at the
 * route and in types.ts. **Naming React's raw-HTML prop even in a comment is
 * itself a failure here:** a test globs this directory for the string, so the
 * rule is enforced rather than remembered.
 */
import { shiftToBrowserClock, type ClockSkew, type FleetRow, type FleetStatus } from "./types";

export const MESSAGES_URL = "api/messages";

/**
 * Where to ask, for the row the person tapped.
 *
 * `row.id` — the tmux session handle — and nothing else. The route looks the
 * row up in its own current snapshot and reads `claudeSessionId` and `dir` off
 * it there, so the URL never carries a path, a uuid or a directory: *the worst
 * a crafted URL can do is miss*. That property is the server's, and this
 * function's job is not to spoil it by helpfully sending more.
 */
export function messagesUrl(row: FleetRow): string {
  return `${MESSAGES_URL}?id=${encodeURIComponent(row.id)}`;
}

/**
 * Who said it. `TurnSpeaker` in transcript.ts, plus this client's fourth-arm
 * habit for a name this build has never heard of.
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

export type MessageToolCall = { name: string; detail: string | null };

/** One turn, as this page will draw it. `TranscriptTurn` off the wire. */
export type MessageTurn = {
  speaker: MessageSpeaker;
  /**
   * **THE SERVER'S OWN STRING, NEVER SHIFTED**, because RecentMessages prints
   * it as the absolute instant it is. Moving it would not say *the phone's wall
   * clock*, it would assert a UTC time nothing happened at — types.ts §
   * `shiftToBrowserClock` has the rule and `withClockSkew` below has the other
   * end of it.
   *
   * **SO DO NOT SUBTRACT IT FROM A BROWSER CLOCK.** It is on the box's, and
   * `now - Date.parse(at)` puts the whole device skew into the answer — the
   * mistake `lastModified` made on this very route before v0.4j. Correct it
   * first with `shiftMsToBrowserClock`. A pre-corrected `atMs` was carried here
   * for one commit to make that impossible, and was deleted: nothing read it,
   * and a field with a producer, a test and no consumer is Class A out of
   * docs/postmortems/260908b — built, that time, while fixing an instance of
   * Class A. The warning belongs on the field somebody would actually reach
   * for, which is this one.
   */
  at: string | null;
  /**
   * Plain, untrusted, possibly truncated, **never markup**. An assistant turn
   * that only called tools has `""` here and a non-empty `toolCalls`; that is a
   * real state and the renderer must draw it as one.
   */
  text: string;
  truncated: boolean;
  fullChars: number | null;
  toolCalls: MessageToolCall[];
  uuid: string | null;
};

/** The answer, as four arms. See the header for why there are four and not three. */
export type MessagesView =
  | {
      kind: "found";
      path: string | null;
      via: "slug-guess" | "scan" | null;
      /** Newest last, so the page renders top-to-bottom. */
      turns: MessageTurn[];
      /**
       * Whether there was a `turns` array at all. `false` with an empty
       * `turns` is *the server sent no turns field*, which is a different claim
       * from *this conversation has no turns in it*.
       */
      turnsOffered: boolean;
      /** Entries in `turns` this page could not read. Counted, never dropped. */
      unreadableTurns: number;
      /** `true` whole conversation, `false` more above, `null` the server did not say. */
      reachedStartOfFile: boolean | null;
      lastModified: string | null;
      bytesRead: number | null;
      fileBytes: number | null;
      copies: number | null;
      recordsParsed: number | null;
      recordsUnparseable: number | null;
      toolResultsSkipped: number | null;
      readOf: ReadOf;
    }
  | { kind: "not-found"; reason: string; why: string; readOf: ReadOf }
  | { kind: "unreadable"; path: string | null; why: string; readOf: ReadOf }
  /** This page never got an answer it could read. **Our sentence, not the server's.** */
  | { kind: "no-answer"; why: string }
  /**
   * **An answer, about a different conversation from the one this page asked
   * about.** The server's stamp said so; `ofTheClaimAsked` noticed. Never drawn
   * as this row's transcript — and never drawn as silence either.
   */
  | { kind: "moved"; asked: string | null; read: string | null };

/**
 * **WHICH CONVERSATION THE SERVER SAYS IT READ.** transcript.ts §
 * `RecentMessagesOf` stamps every arm with the claim it was handed, because
 * `/api/messages` resolves that claim off the server's current row and the row
 * can have moved on since this page's snapshot.
 *
 * `unstamped` is a server from before the stamp, and it is **accepted exactly
 * as before**: the page and the server ship together, and refusing an old
 * server's every answer would blank the panel for the minutes of a partial
 * deploy. A stamp of `null` is a real claim — *I read under no conversation id*
 * — and is not the same as no stamp.
 */
export type ReadOf = { kind: "stamped"; claudeSessionId: string | null } | { kind: "unstamped" };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function speakerOf(v: unknown): MessageSpeaker {
  return typeof v === "string" && SPEAKERS.includes(v) ? (v as MessageSpeaker) : "unrecognised";
}

function parseToolCalls(v: unknown): MessageToolCall[] {
  if (!Array.isArray(v)) return [];
  const out: MessageToolCall[] = [];
  for (const call of v) {
    if (!isRecord(call)) continue;
    const name = str(call["name"]);
    if (name === null) continue;
    out.push({ name, detail: str(call["detail"]) });
  }
  return out;
}

/**
 * One turn, or null when it is not an object at all.
 *
 * **`text` is the only field with no honest default, and its default is `""`**
 * — which is a real turn rather than a broken one, so a record whose text did
 * not survive is drawn as a turn with no words in it and its tool calls beside.
 * A turn dropped for want of a string would be an agent that appeared to sit
 * silent, which is exactly what `toolResultsSkipped` exists to prevent.
 */
function parseTurn(v: unknown): MessageTurn | null {
  if (!isRecord(v)) return null;
  return {
    speaker: speakerOf(v["speaker"]),
    at: str(v["at"]),
    /* NOT computed here. The wire boundary has no clock to correct against —
       `withClockSkew` is the only thing that holds one — and a `Date.parse` of
       the raw string here would be the server's instant wearing a field that
       promises the browser's. */
    text: typeof v["text"] === "string" ? v["text"] : "",
    truncated: v["truncated"] === true,
    fullChars: num(v["fullChars"]),
    toolCalls: parseToolCalls(v["toolCalls"]),
    uuid: str(v["uuid"]),
  };
}

/**
 * The reply, whatever it is. **This never throws and never returns null**: an
 * answer it cannot classify is `no-answer` with a sentence saying so, because
 * a caller left holding a null would have to write that sentence itself and
 * there would then be two of them.
 */
export function parseRecentMessages(raw: unknown): MessagesView {
  if (!isRecord(raw)) {
    return { kind: "no-answer", why: "the dashboard server answered something that is not this API" };
  }
  const kind = raw["kind"];
  const readOf = readOfWire(raw);
  if (readOf === null) {
    return {
      kind: "no-answer",
      why: "the dashboard server's answer named the conversation it read in a form this page cannot read",
    };
  }

  if (kind === "not-found") {
    return {
      readOf,
      kind: "not-found",
      /* The reason CODE, kept even when unfamiliar: it is what a person greps
         for in transcript.ts when the sentence is not enough. */
      reason: str(raw["reason"]) ?? "unstated",
      why:
        str(raw["why"]) ??
        "the server said there is no transcript for this session and did not say which of the four reasons it was",
    };
  }

  if (kind === "unreadable") {
    return {
      readOf,
      kind: "unreadable",
      path: str(raw["path"]),
      why: str(raw["why"]) ?? "the server said it could not read the transcript and did not say why",
    };
  }

  if (kind !== "found") {
    return { kind: "no-answer", why: "the dashboard server answered something that is not this API" };
  }

  const rawTurns = raw["turns"];
  const turns: MessageTurn[] = [];
  let unreadableTurns = 0;
  if (Array.isArray(rawTurns)) {
    for (const item of rawTurns) {
      const turn = parseTurn(item);
      if (turn === null) unreadableTurns += 1;
      else turns.push(turn);
    }
  }
  const via = raw["via"];
  return {
    kind: "found",
    path: str(raw["path"]),
    via: via === "slug-guess" || via === "scan" ? via : null,
    turns,
    turnsOffered: Array.isArray(rawTurns),
    unreadableTurns,
    reachedStartOfFile: boolOrNull(raw["reachedStartOfFile"]),
    lastModified: str(raw["lastModified"]),
    bytesRead: num(raw["bytesRead"]),
    fileBytes: num(raw["fileBytes"]),
    copies: num(raw["copies"]),
    recordsParsed: num(raw["recordsParsed"]),
    recordsUnparseable: num(raw["recordsUnparseable"]),
    toolResultsSkipped: num(raw["toolResultsSkipped"]),
    readOf,
  };
}

/**
 * The stamp off the wire. Absent is `unstamped` — an old server, accepted as
 * before. `null` and a string are real stamps (`""` is the reader's own "no
 * id", so it reads as `null`). Anything else is not this API, and is `null`
 * here so the caller can say so rather than guess.
 */
function readOfWire(raw: Record<string, unknown>): ReadOf | null {
  if (!("claudeSessionId" in raw)) return { kind: "unstamped" };
  const v = raw["claudeSessionId"];
  if (v === null || v === "") return { kind: "stamped", claudeSessionId: null };
  if (typeof v === "string") return { kind: "stamped", claudeSessionId: v };
  return null;
}

/**
 * **IS THIS ANSWER ABOUT THE CONVERSATION THE PAGE ASKED ABOUT?**
 *
 * `askedClaim` is the `claudeSessionId` of the row the request was made for —
 * the claim as the page saw it when it asked. A stamp that names a different
 * conversation turns the answer into the `moved` arm: the server's row had
 * changed hands between this page's snapshot and the read, and the turns it
 * read belong to the conversation it names, not to the one on screen. An
 * unstamped answer passes through untouched; so do the two arms this page
 * wrote itself.
 */
export function ofTheClaimAsked(view: MessagesView, askedClaim: string | null): MessagesView {
  if (view.kind === "no-answer" || view.kind === "moved") return view;
  if (view.readOf.kind === "unstamped") return view;
  const asked = askedClaim === "" ? null : askedClaim;
  if (view.readOf.claudeSessionId === asked) return view;
  return { kind: "moved", asked, read: view.readOf.claudeSessionId };
}

/* ------------------------------------------------------------------ *
 * The one check on the hazard transcript.ts cannot see from inside.
 * ------------------------------------------------------------------ */

/**
 * How long a working session may write nothing before it is worth asking why.
 *
 * **Thirty minutes, and the number is a trade rather than a fact.** The false
 * alarm to avoid is a genuine long tool call: the full gate on this box takes
 * 24 minutes and writes nothing to the transcript while it runs, so anything
 * under half an hour would fire on a healthy session doing the most ordinary
 * expensive thing it does. The case this exists to catch is the one
 * transcript.ts names — *"a transcript last written hours ago, against a row
 * the collector calls `working`"* — and hours clear thirty minutes easily.
 */
export const STALE_TRANSCRIPT_MS = 30 * 60 * 1000;

/**
 * What the transcript's own timestamp says about the row beside it.
 *
 * `quiet` rather than `ok` for the not-working case, because the answer there
 * is *this comparison does not apply*, not *this is fine*. **Only `working`
 * is checked**, and `needs-you` is deliberately not: a session parked on a
 * dialog writes nothing until somebody answers it, which is routinely hours,
 * so including it would put the warning on the very rows Greg opens this page
 * to look at — and a warning that is usually wrong is one nobody reads.
 *
 * **`lastModified` MUST ALREADY BE IN BROWSER-CLOCK TERMS**, which is what
 * `withClockSkew` below is for. This subtracts it from `nowMs` directly, and
 * before v0.4j the two came off different clocks: a phone half an hour fast put
 * *"this may not be this session's conversation"* on every working row. The
 * conversion is not done here because this function is also handed a `null` and
 * a `"not a date"` and has no business knowing about the wire.
 */
export type TranscriptAge =
  | { kind: "unstated" }
  | { kind: "quiet" }
  | { kind: "recent"; ms: number }
  | { kind: "suspect"; ms: number };

export function transcriptAge(lastModified: string | null, status: FleetStatus, nowMs: number): TranscriptAge {
  if (lastModified === null) return { kind: "unstated" };
  const at = Date.parse(lastModified);
  if (!Number.isFinite(at)) return { kind: "unstated" };
  if (status.kind !== "working") return { kind: "quiet" };
  const ms = nowMs - at;
  return ms >= STALE_TRANSCRIPT_MS ? { kind: "suspect", ms } : { kind: "recent", ms };
}

/* ------------------------------------------------------------------ *
 * The seam.
 * ------------------------------------------------------------------ */

/** The injection point, the same shape as `SteerApi` and `ActionsApi`. */
export type MessagesApi = { recent: (row: FleetRow) => Promise<MessagesView> };

/** A thrown thing, as a sentence. Never "[object Object]". */
function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "the request failed, and gave no reason";
}

/**
 * **The HTTP status is not consulted, and that is on purpose.**
 *
 * The route answers 404 with a `not-found` body and 500 with an `unreadable`
 * one, both of them the same union the 200 carries — so branching on the code
 * as well as the body would be a second copy of the server's decision, kept in
 * step by nothing. The body decides; the status only appears in the sentence
 * this file writes when the body was no use.
 */
export function makeMessagesApi(fetchImpl: typeof fetch = fetch): MessagesApi {
  return {
    async recent(row): Promise<MessagesView> {
      let response: Response;
      try {
        response = await fetchImpl(messagesUrl(row), { cache: "no-store" });
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
      return parseRecentMessages(parsed);
    },
  };
}

/** The default instance. Late-bound `fetch`, for the reason in steer-client.ts. */
export const httpMessagesApi: MessagesApi = {
  recent: (row) => makeMessagesApi().recent(row),
};

/**
 * **THE SECOND BOUNDARY, WEARING THE FIRST ONE'S CLOCK.**
 *
 * `lastModified` is the server's, and `transcriptAge` subtracts it from the
 * browser's — so before v0.4j a phone thirty minutes fast put *"this may not be
 * this session's conversation"* on every working row. The threshold is 30
 * minutes (`STALE_TRANSCRIPT_MS`), which is a lot of skew, but `LastWrote` in
 * SessionDetail.tsx prints the same subtraction in the header with no threshold
 * at all, and it was simply wrong by the skew.
 *
 * **A WRAPPER RATHER THAN A `servedAt` ON THIS ROUTE TOO.** The route could
 * carry its own clock and this could measure its own skew, and that was
 * rejected: it is a second measurement of one fact, the two would disagree by a
 * few milliseconds of latency, and a page whose transcript ages and snapshot
 * ages were corrected by different numbers would be harder to reason about than
 * one corrected by the same number. `/api/state` and `/api/messages` are the
 * same process on the same box — one skew is the truth about both.
 *
 * **A FUNCTION rather than a value**, because the skew is re-measured on every
 * poll and a wrapper holding the one it was built with would go stale the
 * moment the page had been open for a cycle. App.tsx reads it out of a ref, so
 * the correction applied is the freshest one the page has.
 *
 * The alternative to all of this was drilling a `skew` prop through
 * SessionsPanel → SessionDetail → RecentMessages → `Found`, four components
 * that have no business knowing about clocks, to reach two subtractions.
 */
export function withClockSkew(api: MessagesApi, skew: () => ClockSkew): MessagesApi {
  return {
    async recent(row): Promise<MessagesView> {
      const view = await api.recent(row);
      if (view.kind !== "found") return view;
      const at = skew();
      return {
        ...view,
        lastModified: shiftToBrowserClock(view.lastModified, at),
        /* **THE TURNS KEEP THEIR OWN STRINGS.** This shifted them for one
           round, on the belief that they were printed as wall-clock times.
           They are not: `Turn` in RecentMessages.tsx prints `turn.at` verbatim,
           so the shift turned `12:00:00Z` into `12:05:00Z` — not a phone's
           clock, but an assertion about an absolute instant nothing happened
           at, and wrong about the reader's timezone either way. GPT Sol's K4.
           The correction is carried beside it as a number instead, for whatever
           wants to measure an age from it. */
      };
    },
  };
}

