/**
 * The browser's half of `POST /api/broadcast`.
 *
 * ## The seam
 *
 * `BroadcastApi` is the injection point, the same shape as `SteerApi` next door
 * and for the same reason: a test drives the card without a network, and it
 * exercises the extension point rather than a stub of `fetch`. `httpBroadcastApi`
 * is what the browser gets, and it is a getter rather than a module-scope
 * instance — binding `fetch` at import time makes it unstubbable in any suite
 * that imports this module first, and the failure then looks like a real network
 * call in a test that has none.
 *
 * ## What this file is careful about
 *
 * **It does not decide who gets the message.** The rows go up as the page had
 * them and the server does the classifying, so the count in the confirmation
 * comes back from the same function that will do the sending. A client that
 * made its own cut would show a number the fan-out then disagreed with, and the
 * two would differ exactly when the box is changing fastest.
 *
 * **It does not describe a delivery in its own words.** An `attempted` recipient
 * is turned into a `SteerOutcome` — steer-client.ts's type, read with
 * steer-client.ts's `parseVerified` and `parseDelivery` — so the receipt for one
 * recipient of a fan-out is the same reading as the receipt for a message typed
 * at one session. Three delivery vocabularies have had to be removed from this
 * dashboard; this is not a fourth.
 */
import { parseDelivery, parseVerified, type SteerOutcome } from "./steer-client";
import type { FleetRow } from "./types";

export const BROADCAST_URL = "api/broadcast";

/** The five fields that say who the page was looking at, plus the status it drew. */
export type BroadcastRecipientBody = {
  paneId: string | null;
  sessionId: string;
  claudeSessionId: string | null;
  panePid: number | null;
  status: unknown;
};

export function recipientBody(row: FleetRow): BroadcastRecipientBody {
  return {
    paneId: row.paneId,
    sessionId: row.id,
    claudeSessionId: row.claudeSessionId,
    panePid: row.panePid,
    // The server's own object, not `row.status`: the page sends back what it
    // was given rather than its own reading of it.
    status: row.rawStatus,
  };
}

export type BroadcastBody = {
  text: string;
  speaker: "greg";
  mode: "dry-run" | "run";
  confirm: boolean;
  recipients: BroadcastRecipientBody[];
};

export function broadcastBody(rows: readonly FleetRow[], text: string, dryRun: boolean): BroadcastBody {
  return {
    text,
    /* `speaker` for the reason steer-client.ts sends one: the server's prefix is
       what tells the receiving agent whether it is reading Greg or an automated
       coordinator, and an absent field defaults to the weaker claim — so leaving
       it out would label a line a person typed as the Overseer's. */
    speaker: "greg",
    mode: dryRun ? "dry-run" : "run",
    /* A dry run needs no confirmation because it sends nothing. A real one is
       confirmed by definition here: this function is only called with
       `dryRun: false` from behind the confirm step. */
    confirm: !dryRun,
    recipients: rows.map(recipientBody),
  };
}

/**
 * What the fan-out did about one row.
 *
 * **The outer arm is scheduling; the inner one is delivery.** Only `attempted`
 * carries a `SteerOutcome`, and it is the server's own steer response read with
 * steer-client.ts's parsers rather than rebuilt here. `later`, a dry-run row and
 * a deadline are things the orchestrator did, and giving them a delivery reading
 * would be inventing a second vocabulary — routes-broadcast.ts §
 * `BroadcastRecipient` has the argument in full.
 */
export type RecipientOutcome = { sessionId: string; paneId: string } & (
  | { kind: "would-send" }
  | { kind: "would-queue" }
  | { kind: "attempted"; outcome: SteerOutcome }
  | { kind: "queued"; position: number | null }
  | { kind: "skipped"; code: string; why: string }
  | { kind: "not-reached"; why: string }
  /** A row the server answered with something this build cannot read. */
  | { kind: "unreadable"; why: string }
);

export type BroadcastCounts = {
  asked: number;
  submitted: number;
  queued: number;
  skipped: number;
  notReached: number;
};

export type BroadcastResult = {
  counts: BroadcastCounts;
  recipients: RecipientOutcome[];
  /** The exact line one recipient would receive. Preview only. */
  sample: string | null;
};

/**
 * How a whole broadcast ended.
 *
 * **`unknown` IS NOT `failed`, AND THAT IS THE POINT.** If the response is lost
 * after the server has typed at fifteen sessions, this browser has no
 * per-recipient receipts and **must not manufacture them** — nor say nothing
 * happened. GPT Sol's P1. A page that reported a dropped connection as "nothing
 * was sent" would invite exactly the retry that says everything twice.
 */
export type BroadcastOutcome =
  | { kind: "ran"; op: "broadcast" | "broadcast-preview"; result: BroadcastResult }
  /** The server refused before doing anything. Its own sentence, and any per-row detail. */
  | { kind: "refused"; code: string; why: string; status: number; result: BroadcastResult | null }
  /** No answer came back. What reached the fleet is not known from here. */
  | { kind: "unknown"; why: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * The tmux argv, shape-checked.
 *
 * This is the one thing here that duplicates something private to
 * steer-client.ts, and it is a shape check rather than a reading — it decides
 * nothing about what happened, only that the array is an array of arrays of
 * strings. If that file ever exports its own, delete this and use it.
 */
function parseSent(v: unknown): string[][] {
  if (!Array.isArray(v)) return [];
  const out: string[][] = [];
  for (const call of v) {
    if (!Array.isArray(call)) continue;
    out.push(call.filter((a): a is string => typeof a === "string"));
  }
  return out;
}

/**
 * One recipient, off the wire.
 *
 * An arm this build does not recognise becomes `unreadable` rather than being
 * dropped: a shorter list would read as a smaller fleet, and the row most likely
 * to be malformed is as likely as any to be the interesting one.
 */
function parseRecipient(v: unknown, at: number): RecipientOutcome {
  /* **A ROW THIS BUILD CANNOT READ IS KEPT, NOT DROPPED**, and until GPT Sol's
     P2 the comment said so while the code returned `null` and the caller threw
     it away. A shorter list reads as a smaller fleet, and the row most likely to
     be malformed is as likely as any to be the interesting one — so it keeps its
     place, with whatever identity survived, and says it could not be read. */
  const known = isRecord(v) ? v : {};
  const sessionId = typeof known["sessionId"] === "string" ? known["sessionId"] : `(row ${at + 1})`;
  const paneId = typeof known["paneId"] === "string" ? known["paneId"] : `(row ${at + 1})`;
  if (!isRecord(v) || typeof v["sessionId"] !== "string" || typeof v["paneId"] !== "string") {
    return { sessionId, paneId, kind: "unreadable", why: "the server sent a recipient with no session or pane id" };
  }
  const where = { sessionId, paneId };
  switch (v["kind"]) {
    case "would-send":
      return { ...where, kind: "would-send" };
    case "would-queue":
      return { ...where, kind: "would-queue" };
    case "queued": {
      /* **`null`, NOT `0`, FOR A POSITION THAT DID NOT ARRIVE.** Zero is a
         place in a queue and would render as one; the honest answer is that
         this build was not told where it landed. */
      const at = v["position"];
      return { ...where, kind: "queued", position: typeof at === "number" && Number.isFinite(at) ? at : null };
    }
    case "skipped":
      return {
        ...where,
        kind: "skipped",
        code: str(v["code"], "unknown"),
        why: str(v["why"], "the server did not say why"),
      };
    case "not-reached":
      return { ...where, kind: "not-reached", why: str(v["why"], "the server did not say why") };
    case "attempted": {
      const a = v["attempt"];
      if (!isRecord(a)) return { ...where, kind: "unreadable", why: "the server sent an attempt with no body" };
      const status = num(a["status"]);
      if (a["ok"] === true) {
        return {
          ...where,
          kind: "attempted",
          outcome: { ok: true, op: "message", sent: parseSent(a["sent"]), verified: parseVerified(a["verified"]) },
        };
      }
      return {
        ...where,
        kind: "attempted",
        outcome: {
          ok: false,
          code: str(a["code"], "unknown"),
          why: str(a["why"], "the server refused without saying why"),
          status: status === 0 ? null : status,
          /* `server`, because this object IS the server's answer about that
             recipient. The `client` arm belongs to a failure this browser saw
             itself, and there is no such thing inside a fan-out's row. */
          from: "server",
          delivery: parseDelivery(a["delivery"]),
        },
      };
    }
    default:
      return { ...where, kind: "unreadable", why: `the server described this row as ${JSON.stringify(v["kind"])}` };
  }
}

function parseResult(v: unknown): BroadcastResult {
  if (!isRecord(v)) return { counts: { asked: 0, submitted: 0, queued: 0, skipped: 0, notReached: 0 }, recipients: [], sample: null };
  const counts = isRecord(v["counts"]) ? v["counts"] : {};
  const rows = Array.isArray(v["recipients"]) ? v["recipients"] : [];
  // Every row survives — see `parseRecipient`. The index is passed so a row
  // with no identity at all can still be pointed at.
  const recipients: RecipientOutcome[] = rows.map((row, at) => parseRecipient(row, at));
  return {
    counts: {
      asked: num(counts["asked"]),
      submitted: num(counts["submitted"]),
      queued: num(counts["queued"]),
      skipped: num(counts["skipped"]),
      notReached: num(counts["notReached"]),
    },
    recipients,
    sample: typeof v["sample"] === "string" ? v["sample"] : null,
  };
}

export type BroadcastApi = {
  send: (rows: readonly FleetRow[], text: string, dryRun: boolean) => Promise<BroadcastOutcome>;
};

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "the request failed, and gave no reason";
}

export function makeBroadcastApi(fetchImpl: typeof fetch = fetch): BroadcastApi {
  return {
    async send(rows, text, dryRun) {
      let response: Response;
      try {
        response = await fetchImpl(BROADCAST_URL, {
          method: "POST",
          // Required by the server, and half the CSRF defence: a cross-site
          // HTML form cannot set this header. The browser adds `Origin`.
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(broadcastBody(rows, text, dryRun)),
        });
      } catch (cause) {
        /* THE REQUEST MAY WELL HAVE ARRIVED. A fetch that throws has failed to
           read a RESPONSE; it has not established that nothing was sent. On a
           fan-out that is the worst possible moment to guess, because the guess
           scales: "nothing happened" invites a retry that says everything
           twice, to everybody. */
        return { kind: "unknown", why: `this browser could not reach the dashboard: ${describe(cause)}` };
      }

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch (cause) {
        return {
          kind: "unknown",
          why: `the server answered ${response.status} and the body was not readable: ${describe(cause)}`,
        };
      }

      if (isRecord(parsed) && parsed["ok"] === true) {
        /**
         * **THE ANSWER'S OPERATION MUST BE THE ONE THAT WAS ASKED FOR, AND A
         * MISMATCH IS `unknown` RATHER THAN EITHER.**
         *
         * This used to map anything that was not `broadcast-preview` onto
         * `broadcast`, so a version-skewed or mismatched response to a DRY RUN
         * could be a real fan-out that had already gone out — and the card
         * would have drawn it as a confirmation and invited a second Send. GPT
         * Sol's P1-5.
         *
         * `unknown` and not `refused`, because the response itself is evidence
         * that something ran: the honest reading of *I asked for a preview and
         * was told about a broadcast* is that the fleet may already have it.
         */
        const op = parsed["op"];
        const wanted = dryRun ? "broadcast-preview" : "broadcast";
        if (op !== wanted) {
          return {
            kind: "unknown",
            why:
              `this was a ${dryRun ? "dry run" : "real broadcast"} and the server answered ${JSON.stringify(op)}. ` +
              "The two do not match, so what reached the fleet cannot be read off this answer — look at the queue and at a session before sending anything else.",
          };
        }
        return { kind: "ran", op: wanted, result: parseResult(parsed["result"]) };
      }
      return {
        kind: "refused",
        code: isRecord(parsed) && typeof parsed["code"] === "string" ? parsed["code"] : "unknown",
        why:
          isRecord(parsed) && typeof parsed["why"] === "string"
            ? parsed["why"]
            : `the server answered ${response.status} without saying why`,
        status: response.status,
        // A `not-steerable` refusal carries the per-session reasons, which are
        // the only thing that makes it actionable.
        result: isRecord(parsed) && parsed["result"] !== undefined ? parseResult(parsed["result"]) : null,
      };
    },
  };
}

/** The default instance. A getter, for the reason in the header. */
export const httpBroadcastApi: BroadcastApi = {
  send: (rows, text, dryRun) => makeBroadcastApi().send(rows, text, dryRun),
};
