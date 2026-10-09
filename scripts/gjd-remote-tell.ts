/**
 * `gjd-remote tell-overseer` — one line from the laptop to the Overseer.
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
 * No ssh or process. `scripts/gjd-remote.ts` does the I/O.
 */
import { claimFromSnapshot, describeClaim } from "../tools/fleet/overseer-claim.js";
import { escapeName, printableName } from "./gjd-remote-tmux.js";

/**
 * Where the dashboard listens on the box when its unit sets no `FLEET_PORT` —
 * the default compiled into tools/fleet/server.ts. A copy, like
 * `DEFAULT_PORT` in scripts/fleet-restart-plan.ts; `--port` overrides it.
 */
export const DEFAULT_FLEET_PORT = 8787;

/** How old a snapshot may be before its answer about the claim is not believed. Same as `overseer tick`. */
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

/** The request body `/api/steer/message` takes — the shape `steerMessageBody` builds in the web client. */
export type TellBody = {
  paneId: string | null;
  sessionId: string;
  claudeSessionId: string | null;
  panePid: number | null;
  status: unknown;
  text: string;
  speaker: "greg";
};

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
export function overseerTarget(snapshot: unknown, text: string, nowMs?: number): TellTarget {
  const served = isRecord(snapshot) && typeof snapshot["servedAt"] === "string" ? Date.parse(snapshot["servedAt"]) : Number.NaN;
  const now = nowMs ?? (Number.isFinite(served) ? served : Date.now());
  const claim = claimFromSnapshot(snapshot, { nowMs: now, maxAgeMs: CLAIM_MAX_AGE_MS });
  if (claim.kind !== "one") return { ok: false, why: escapeName(describeClaim(claim, escapeName)) };

  const rows = isRecord(snapshot) && Array.isArray(snapshot["rows"]) ? snapshot["rows"] : [];
  const row = rows.find((r): r is Record<string, unknown> => isRecord(r) && r["id"] === claim.id);
  if (row === undefined) return { ok: false, why: `the snapshot named ${printableName(claim.name)} as the Overseer and then had no row for it` };

  const paneId = row["paneId"];
  const claudeSessionId = row["claudeSessionId"];
  const panePid = row["panePid"];
  return {
    ok: true,
    name: claim.name,
    body: {
      // Passed through as they arrived, nulls included, exactly as the card
      // does: the server refuses a null pane or conversation id with a better
      // sentence than this file could write.
      paneId: typeof paneId === "string" ? paneId : null,
      sessionId: claim.id,
      claudeSessionId: typeof claudeSessionId === "string" ? claudeSessionId : null,
      panePid: typeof panePid === "number" ? panePid : null,
      status: row["status"],
      text,
      speaker: "greg",
    },
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
