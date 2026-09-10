/**
 * `POST /api/recovery/resume` — the recovery panel's one control: ask the
 * Overseer to resume one interrupted Claude session.
 *
 * docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md
 * § 4, as the review dispositions amend it (Sol's G9: there is no GET here; the
 * page reads the projection from `/api/recovery`).
 *
 * ## IT WRITES ONE REQUEST FILE, AND THAT IS ALL IT DOES
 *
 * It never launches anything, and it never reads tmux or the launch store. The
 * daemon does both, after the gates, the pace rule and a revalidation against
 * the state of the world at that moment — never the view the person saw. This
 * route writes one nonce-named request through the leaf
 * `tools/overseer/recovery-resume-request.ts`, the single definition of the
 * format, which the CLI also uses.
 *
 * ## The CSRF defence comes first
 *
 * The dashboard has no authentication; reachability is the boundary. So the
 * request passes `routes-new.ts`'s `checkRequest` (a JSON content type, a
 * same-origin `Origin`, `sec-fetch-site`) **before a byte of the body is read or
 * the store is touched**, exactly as the route that starts sessions does.
 *
 * ## "Already" is a courtesy, not a guarantee (Sol's G10)
 *
 * A second tap would write a second file, and that would be harmless: **the
 * launch occurrence is the duplicate guarantee**, and the daemon settles every
 * request for a candidate against that one occurrence. So the checks below are
 * only there so the page can say something plain:
 *
 *  - the projection in `recovery.json` (read through `recovery-feed.ts`, the
 *    same reader `/api/recovery` uses) shows the candidate's occurrence already
 *    exists → `already-launched`, and nothing is written;
 *  - the projection or `pending/` shows a request waiting → `already-requested`,
 *    and nothing is written.
 *
 * An index that cannot be read stops nothing: the daemon revalidates anyway.
 *
 * ## Asynchronous
 *
 * `handle` answers `true` at once and does its work on a promise that never
 * rejects: every failure is answered, 500 with the reason.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { CANDIDATE_ID_PATTERN, pendingFor, writeResumeRequest } from "../overseer/recovery-resume-request.js";
import { isRecord, storeRoot } from "./attention.js";
import { loadRecoveryFile, projectRecovery } from "./recovery-feed.js";
import { checkRequest, readBody } from "./routes-new.js";
import type { RecoveryResumePostAnswer, RecoveryResumePostBody, RecoveryResumeRequestState } from "./wire.js";

export const RECOVERY_RESUME_PATH = "/api/recovery/resume";

/** A body is an id, a timestamp, a uuid and a path. 4 KiB is ten times that. */
export const MAX_RESUME_BODY_BYTES = 4 * 1024;

export type RecoveryResumeRouteDeps = {
  /** The Overseer's store. Production resolves it as `recovery-feed.ts` does, through `storeRoot`, at call time. */
  root(): string;
  /** The server's clock owns `requestedAt`. */
  now(): Date;
  pendingFor: typeof pendingFor;
  writeResumeRequest: typeof writeResumeRequest;
};

function realDeps(): RecoveryResumeRouteDeps {
  return { root: () => storeRoot(), now: () => new Date(), pendingFor, writeResumeRequest };
}

const HEADERS = { "content-type": "application/json", "cache-control": "no-store" } as const;

/**
 * Every state that says the candidate's launch occurrence exists. A new request
 * would only be settled against it, so the page is told so instead.
 */
const OCCURRENCE_EXISTS: ReadonlySet<RecoveryResumeRequestState["kind"]> = new Set(["launched", "ended-unverified", "needs-greg", "disposed", "resumed"]);

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function send(res: ServerResponse, status: number, answer: RecoveryResumePostAnswer): void {
  res.writeHead(status, HEADERS);
  res.end(JSON.stringify(answer));
}

/** The body, strictly: the candidate id against the leaf's own pattern, and what the person saw. */
export function parseResumePostBody(text: string): { ok: true; value: RecoveryResumePostBody } | { ok: false; why: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, why: "the body is not JSON" };
  }
  if (!isRecord(json)) return { ok: false, why: "the body is not a JSON object" };
  const { candidateId, seen } = json;
  if (typeof candidateId !== "string" || !CANDIDATE_ID_PATTERN.test(candidateId)) {
    return { ok: false, why: "candidateId is not a recovery candidate id (rc-… or rl-… with 20 hex digits)" };
  }
  if (!isRecord(seen)) return { ok: false, why: "seen is not an object" };
  const { checkedAt, conversationId, dir } = seen;
  if (typeof checkedAt !== "string" || !ISO_INSTANT.test(checkedAt) || !Number.isFinite(Date.parse(checkedAt))) return { ok: false, why: "seen.checkedAt is not a timestamp" };
  if (typeof conversationId !== "string" || conversationId.trim() === "") return { ok: false, why: "seen.conversationId is missing" };
  if (typeof dir !== "string" || !dir.startsWith("/")) return { ok: false, why: "seen.dir is not an absolute path" };
  return { ok: true, value: { candidateId, seen: { checkedAt, conversationId, dir } } };
}

/** The projection's state for this candidate, or undefined when there is none or it cannot be read. */
async function projectedState(root: string, candidateId: string, now: Date): Promise<RecoveryResumeRequestState | undefined> {
  const feed = projectRecovery(await loadRecoveryFile(root), now.toISOString());
  if (feed.kind !== "published" || feed.resume.kind !== "published") return undefined;
  return feed.resume.projection.requests.find((r) => r.candidateId === candidateId)?.state;
}

async function respond(deps: RecoveryResumeRouteDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const allowed = checkRequest(req.headers);
  if (!allowed.ok) return send(res, allowed.status, { ok: false, why: allowed.why });
  const body = await readBody(req, MAX_RESUME_BODY_BYTES);
  if (!body.ok) return send(res, body.status, { ok: false, why: body.why });
  const parsed = parseResumePostBody(body.value);
  if (!parsed.ok) return send(res, 400, { ok: false, why: parsed.why });
  const { candidateId, seen } = parsed.value;

  const root = deps.root();
  const now = deps.now();
  const known = await projectedState(root, candidateId, now);
  if (known !== undefined && OCCURRENCE_EXISTS.has(known.kind)) return send(res, 200, { ok: true, outcome: "already-launched", candidateId });
  // `cannot-tell` from the leaf is not "pending": the courtesy is skipped, and
  // the occurrence still stops a second launch.
  if (known?.kind === "pending" || deps.pendingFor(root, candidateId).kind === "pending") {
    return send(res, 200, { ok: true, outcome: "already-requested", candidateId });
  }
  const written = deps.writeResumeRequest(root, { candidateId, actor: "dashboard", seen, now });
  if (written.kind === "refused") return send(res, 409, { ok: false, why: written.why });
  return send(res, 202, { ok: true, outcome: "queued", candidateId });
}

/** The exact production composition. Tests inject the store root and the clock, and keep the real leaf. */
export function makeRecoveryResumeRoute(overrides: Partial<RecoveryResumeRouteDeps> = {}): {
  handle(req: IncomingMessage, res: ServerResponse): boolean;
} {
  const deps: RecoveryResumeRouteDeps = { ...realDeps(), ...overrides };
  return {
    handle(req, res): boolean {
      const bare = (req.url ?? "/").split("?")[0] ?? "";
      // EXACTLY ITS OWN PATH. `/api/recovery` and anything under this one stay
      // the inventory route's, which 404s what it does not know.
      if (bare !== RECOVERY_RESUME_PATH) return false;
      if (req.method !== "POST") {
        res.writeHead(405, { ...HEADERS, allow: "POST" });
        res.end(
          req.method === "HEAD"
            ? undefined
            : JSON.stringify({ ok: false, why: "this route only takes a POST; the recovery panel reads its state from /api/recovery" } satisfies RecoveryResumePostAnswer),
        );
        return true;
      }
      void respond(deps, req, res).catch((cause: unknown) => {
        try {
          send(res, 500, { ok: false, why: `queuing the resume request threw: ${cause instanceof Error ? cause.message : String(cause)}` });
        } catch {
          /* The answer was already on its way out. */
        }
      });
      return true;
    },
  };
}
