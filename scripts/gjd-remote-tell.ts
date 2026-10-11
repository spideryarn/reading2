/**
 * `gjd-remote tell-overseer` and `gjd-remote tell <name>` — one line from the
 * laptop to the Overseer, or to any session.
 *
 * **NOT A SECOND WAY TO TYPE INTO A PANE.** The fleet dashboard on the box
 * already has the one audited write path, `POST /api/steer/message`, and its
 * "Message the Overseer" card is a client of it: pick the row holding the claim,
 * post the row's identity plus the text as speaker `greg`, and render whatever
 * the server says. This module is the same client, for a terminal. Every check
 * that matters — the pane is still that conversation, the input box is empty,
 * no dialog is open, the text is one line, the quarantine hold — happens on the
 * server, and nothing here repeats or weakens one. A `tmux send-keys` from here
 * would have been shorter and would have skipped all of them; see the header of
 * tools/fleet/steer.ts for what each one is there for.
 *
 * Who the Overseer is comes from `claimFromSnapshot`, which is the one way a
 * program asks the dashboard's snapshot that question — it refuses a stale
 * snapshot, a failed collection and a contested claim rather than picking.
 *
 * The same caveat as the card (docs/plans/260909b-messaging-the-overseer-…
 * § D2): the server verifies the ADDRESS, not the ROLE, so a message can reach
 * the session that held the claim when the snapshot was taken. The window is
 * one collection interval, and the success line names the session it went to.
 *
 * **WHO IS SPEAKING FOLLOWS WHO RAN IT** (plan 261011e). Greg at his own
 * terminal posts as `greg`, as the card does. A Claude Code or Codex session
 * running this posts as `agent`, naming its tmux session, or as `overseer` if
 * it is the claim's holder — because on 2026-10-10 an Overseer request sent
 * through here arrived as `[Greg, via the fleet dashboard]` and was obeyed as
 * Greg's. One command rather than a `tell-from-agent` beside it: an agent
 * choosing the wrong one of two is the failure. `voiceFor` decides.
 *
 * No ssh or process. `scripts/gjd-remote.ts` does the I/O.
 */
import { isSenderName } from "../tools/fleet/actions.js";
import { claimFromSnapshot, describeClaim } from "../tools/fleet/overseer-claim.js";
import { escapeName, printableName } from "./gjd-remote-tmux.js";

/**
 * Where the dashboard listens on the box when its unit sets no `FLEET_PORT` —
 * the default compiled into tools/fleet/server.ts. A copy, like
 * `DEFAULT_PORT` in scripts/fleet-restart-plan.ts; `--port` overrides it.
 */
export const DEFAULT_FLEET_PORT = 8787;

/** How old a snapshot may be before its target is not believed. Same as `overseer tick`. */
export const CLAIM_MAX_AGE_MS = 5 * 60_000;

/**
 * The remote shell command, kept separate from its stdin body. Disable curl's
 * config so a trace or retry in ~/.curlrc cannot log or send the message again,
 * and bypass proxies so this request stays on the box's loopback interface.
 * `port` is validated by the CLI before it gets here.
 */
export function tellPostCommand(port: number): string {
  const base = `http://127.0.0.1:${port}`;
  return `curl --disable --noproxy '*' -sS --max-time 90 -w '\\n%{http_code}' ` +
    `-H 'content-type: application/json' -H 'origin: ${base}' ` +
    `--data-binary @- '${base}/api/steer/message'`;
}

/**
 * Who a `tell` speaks as: the three `Speaker` arms it can be, with `agent`
 * carrying the sender's name (null for "an unnamed session").
 */
export type TellVoice = { speaker: "greg" } | { speaker: "overseer" } | { speaker: "agent"; from: string | null };

export const GREG: TellVoice = { speaker: "greg" };

/**
 * The request body `/api/steer/message` takes — the shape `steerMessageBody`
 * builds in the web client, plus `from` when an agent is speaking.
 */
export type TellBody = {
  paneId: string | null;
  sessionId: string;
  claudeSessionId: string | null;
  panePid: number | null;
  status: unknown;
  text: string;
} & TellVoice;

/** The sending session's own tmux session, as `tmux display-message` names it. */
export type OwnSession = { name: string; id: string };

function nonEmpty(v: string | undefined): v is string {
  return v !== undefined && v !== "";
}

/**
 * Whether an agent, not a person, is running this. Claude Code sets
 * `CLAUDECODE=1` in its Bash tool's environment, and Codex sets
 * `CODEX_THREAD_ID` in the commands it runs (both checked on the box,
 * 2026-10-11). Neither is a security boundary — a shell that unsets them is
 * sent as Greg — but an honest agent no longer has to remember to say so.
 */
export function runByAgent(env: NodeJS.ProcessEnv): boolean {
  return nonEmpty(env["CLAUDECODE"]) || nonEmpty(env["CODEX_THREAD_ID"]);
}

/**
 * The `tmux` argv that names the session this process is running in, or null
 * when it is not in tmux at all. `-t $TMUX_PANE` asks about this pane rather
 * than whichever client tmux thinks is current.
 */
export function ownSessionQuery(env: NodeJS.ProcessEnv): string[] | null {
  if (!nonEmpty(env["TMUX"])) return null;
  const pane = env["TMUX_PANE"];
  return ["display-message", "-p", ...(nonEmpty(pane) ? ["-t", pane] : []), "#{session_name}\t#{session_id}"];
}

/** `ownSessionQuery`'s answer, or null for anything that is not one name and one `$N` id. */
export function parseOwnSession(stdout: string): OwnSession | null {
  const line = stdout.replace(/\r?\n$/, "");
  const cut = line.lastIndexOf("\t");
  if (cut <= 0) return null;
  const id = line.slice(cut + 1);
  return /^\$\d+$/.test(id) ? { name: line.slice(0, cut), id } : null;
}

/** The snapshot's own word for "now", which a claim's age is measured against. */
function snapshotNow(snapshot: unknown): number {
  const served = isRecord(snapshot) && typeof snapshot["servedAt"] === "string" ? Date.parse(snapshot["servedAt"]) : Number.NaN;
  return Number.isFinite(served) ? served : Date.now();
}

/**
 * Who this `tell` speaks as. Not an agent: Greg. An agent whose tmux session
 * has the claim's id AND name: the Overseer. Any other agent: `agent`, named
 * when its session name is one the prefix can carry (`isSenderName`).
 *
 * Every wrong guess here lands on a label that says "not Greg" — the Overseer
 * called `agent`, or the reverse (on the Mac, whose tmux ids are not the
 * box's, an Overseer match is near impossible and would be harmless). The one
 * guess that matters, an agent called Greg, needs both variables gone.
 */
export function voiceFor(snapshot: unknown, env: NodeJS.ProcessEnv, own: OwnSession | null): TellVoice {
  if (!runByAgent(env)) return GREG;
  if (own !== null) {
    const claim = claimFromSnapshot(snapshot, { nowMs: snapshotNow(snapshot), maxAgeMs: CLAIM_MAX_AGE_MS });
    if (claim.kind === "one" && claim.id === own.id && claim.name === own.name) return { speaker: "overseer" };
  }
  return { speaker: "agent", from: own !== null && isSenderName(own.name) ? own.name : null };
}

/** The end of the success line, so the sender sees how it went out. */
export function describeVoice(voice: TellVoice): string {
  switch (voice.speaker) {
    case "greg":
      return "as Greg";
    case "overseer":
      return "as the Overseer";
    case "agent":
      return voice.from === null ? "as an agent (unnamed session)" : `as agent '${voice.from}'`;
    default: {
      const never: never = voice;
      return never;
    }
  }
}

export type TellTarget = { ok: true; name: string; body: TellBody } | { ok: false; why: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The Overseer's row, as a ready-to-post body, or why there is not one.
 *
 * `nowMs` defaults to the snapshot's own `servedAt` rather than the laptop's
 * clock: the snapshot was fetched a moment ago, so the box's word for "now" is
 * the right one to measure its age against, and it cannot be skewed against
 * the laptop's.
 */
export function overseerTarget(snapshot: unknown, text: string, nowMs?: number, voice: TellVoice = GREG): TellTarget {
  const now = nowMs ?? snapshotNow(snapshot);
  const claim = claimFromSnapshot(snapshot, { nowMs: now, maxAgeMs: CLAIM_MAX_AGE_MS });
  if (claim.kind !== "one") return { ok: false, why: escapeName(describeClaim(claim, escapeName)) };

  const rows = isRecord(snapshot) && Array.isArray(snapshot["rows"]) ? snapshot["rows"] : [];
  const row = rows.find((r): r is Record<string, unknown> => isRecord(r) && r["id"] === claim.id);
  if (row === undefined) return { ok: false, why: `the snapshot named ${printableName(claim.name)} as the Overseer and then had no row for it` };

  return { ok: true, name: claim.name, body: rowBody(row, claim.id, text, voice) };
}

/**
 * Any session's row, by its EXACT name, as a ready-to-post body. `tell <name>`,
 * borrowed from `mindstone-fleet session tell`.
 *
 * A failed collection serves its LAST GOOD rows, which may name a session
 * that has gone. Refuse those and readings older than the claim's limit.
 * The route checks pane/session ids, pane pid and the conversation uuid in
 * Claude's launch argv, not the live session name (nor an in-process /resume).
 * A rename after collection can still send to the session that had the name;
 * freshness bounds that window, it does not eliminate it.
 *
 * A name that matches only when case is ignored is refused, naming the session
 * it probably meant — the same rule as mindstone's. Typing to `overseer` when
 * the session is `Overseer` is probably right, and "probably" is not the bar
 * for keystrokes in somebody's pane.
 */
export function sessionTarget(snapshot: unknown, name: string, text: string, voice: TellVoice = GREG): TellTarget {
  if (!isRecord(snapshot) || snapshot["schema"] !== 1) return { ok: false, why: "the dashboard answered something that is not a snapshot this build reads" };
  if (snapshot["error"] !== null) {
    return { ok: false, why: "the dashboard's last collection failed, so its list of sessions may not be current — try again in a minute" };
  }
  const collected = typeof snapshot["collectedAt"] === "string" ? Date.parse(snapshot["collectedAt"]) : Number.NaN;
  const served = typeof snapshot["servedAt"] === "string" ? Date.parse(snapshot["servedAt"]) : Number.NaN;
  if (!Number.isFinite(collected) || !Number.isFinite(served)) {
    return { ok: false, why: "the dashboard's snapshot has no usable collection or served time" };
  }
  const age = served - collected;
  if (age < 0 || age > CLAIM_MAX_AGE_MS) {
    return { ok: false, why: "the dashboard's snapshot is stale or stamped in the future — try again after it refreshes" };
  }
  if (!Array.isArray(snapshot["rows"])) return { ok: false, why: "the dashboard's snapshot carries no list of sessions" };
  const rows = snapshot["rows"].filter(isRecord);
  const exact = rows.filter((r) => r["name"] === name);
  const row = exact[0];
  if (exact.length === 1 && row !== undefined) {
    if (typeof row["id"] !== "string" || !/^\$\d+$/.test(row["id"])) {
      return { ok: false, why: `the dashboard's row for ${printableName(name)} has no usable tmux session id` };
    }
    return { ok: true, name, body: rowBody(row, row["id"], text, voice) };
  }
  if (exact.length > 1) return { ok: false, why: `${exact.length} sessions are called ${printableName(name)}` };
  const near = rows.filter((r) => typeof r["name"] === "string" && r["name"].toLowerCase() === name.toLowerCase());
  const guess = near[0];
  if (near.length === 1 && guess !== undefined) {
    return { ok: false, why: `no session is called ${printableName(name)} — did you mean ${printableName(String(guess["name"]))}?` };
  }
  return {
    ok: false,
    why: `the dashboard has no session called ${printableName(name)}. It refreshes about once a minute, so one started a moment ago may not be in it yet`,
  };
}

/** One dashboard row as the steer route's body — the shape `steerMessageBody` builds in the web client. */
function rowBody(row: Record<string, unknown>, sessionId: string, text: string, voice: TellVoice): TellBody {
  const paneId = row["paneId"];
  const claudeSessionId = row["claudeSessionId"];
  const panePid = row["panePid"];
  return {
    // Passed through as they arrived, nulls included, exactly as the card
    // does: the server refuses a null pane or conversation id with a better
    // sentence than this file could write.
    paneId: typeof paneId === "string" ? paneId : null,
    sessionId,
    claudeSessionId: typeof claudeSessionId === "string" ? claudeSessionId : null,
    panePid: typeof panePid === "number" ? panePid : null,
    status: row["status"],
    text,
    // `speaker`, and `from` only when the voice is `agent`: the route refuses a
    // name on any other speaker, and Greg's body stays the card's shape.
    ...voice,
  };
}

/**
 * `curl -w '\n%{http_code}'` output, split back into the status and the body.
 * A missing or malformed HTTP status comes back as 0, which `readTellAnswer` reports
 * rather than reading as a success.
 */
export function splitStatus(out: string): { httpStatus: number; body: string } {
  const trimmed = out.replace(/\n$/, "");
  const cut = trimmed.lastIndexOf("\n");
  const status = trimmed.slice(cut + 1);
  return { httpStatus: cut !== -1 && /^[1-5]\d{2}$/.test(status) ? Number(status) : 0, body: cut === -1 ? "" : trimmed.slice(0, cut) };
}

export type TellOutcome = { ok: true } | { ok: false; why: string; textMayBeInTheBox: boolean };

/**
 * What the server's answer means for the person at the terminal.
 *
 * The server's `why` is escaped for the terminal, never paraphrased — it knows
 * things this file cannot. The one thing added is the `delivery` word turned into
 * advice, because `partial` or `unknown` means the text may have arrived or be
 * sitting in the Overseer's input box, and "try again" could send it twice.
 * The success body's `sent` holds the message itself and is not printed.
 */
export function readTellAnswer(httpStatus: number, raw: string): TellOutcome {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      // An error page can echo the submitted text. No response dump here.
      why: `the dashboard answered ${httpStatus} and the body was not JSON`,
      textMayBeInTheBox: true,
    };
  }
  if (httpStatus === 200 && isRecord(body) && body["ok"] === true && body["op"] === "message" &&
    Array.isArray(body["sent"]) && body["sent"].length > 0 &&
    body["sent"].every((call: unknown) => Array.isArray(call) && call.length > 0 && call.every((a: unknown) => typeof a === "string"))) {
    return { ok: true };
  }
  if (!isRecord(body) || body["ok"] !== false || typeof body["code"] !== "string" || typeof body["why"] !== "string") {
    return { ok: false, why: `the dashboard answered ${httpStatus} with something that is not this API`, textMayBeInTheBox: true };
  }
  const code = escapeName(body["code"]);
  const why = escapeName(body["why"]);
  // Only an explicit `none` licenses "nothing arrived". An absent field is not
  // evidence of non-delivery.
  return { ok: false, why: `${code}: ${why}`, textMayBeInTheBox: body["delivery"] !== "none" };
}
