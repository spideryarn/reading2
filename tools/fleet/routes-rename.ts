/**
 * Renaming a session — `POST /api/sessions/rename`.
 *
 * Greg, 2026-09-08: *"add a way to rename sessions"*. The names on this page are
 * how he tells thirty-six agents apart, and a good half of them are whatever
 * Claude decided to call the conversation — accurate, and often not what he
 * would have called it.
 *
 * **RENAMING IS TWO OPERATIONS AND DOING ONE IS WORSE THAN DOING NEITHER.**
 * `gjd-remote ls` runs `adoptTitles`, which renames any session still marked
 * *provisional* to Claude's own title for the work. So a rename that does not
 * also clear `GJD_PROVISIONAL` is a rename that gets silently overwritten the
 * next time anybody lists the fleet — the name is right on the page, right
 * until it isn't, with nothing to say what happened. The CLI already knows
 * this: `adoptTitles`' comment says *"a name you chose is yours, and having a
 * tool quietly rename it under you would be worse than a dull name."* This
 * route makes that true of a name chosen through the page as well.
 *
 * Both happen in ONE tmux invocation (`rename-session … ; set-environment …`)
 * rather than two, so there is no window in which the session is renamed and
 * still provisional.
 *
 * ADDRESSED BY SESSION HANDLE, NEVER BY NAME. `-t` will happily resolve a name,
 * and a name is exactly what is about to change; a rename addressed by name is
 * a rename that can hit the wrong session when two are similarly named. The
 * handle comes out of the request body, verbatim from the row the person
 * tapped, for the reason `routes-steer.ts` sets out at length: the client's
 * claims are the input, and the server checks them rather than looking them up.
 *
 * NO IMPORT SIDE EFFECTS — nothing at module scope runs a command or reads the
 * environment, the same rule every other module here follows.
 */
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

import { processProbeOwner, type OwnedOutcome, type ProbeOwner } from "./child.js";
import { addressableHost } from "./origin.js";

/**
 * tmux/gjd-remote's own name rule, restated rather than imported.
 *
 * The original is `SLUG` in `scripts/gjd-remote.ts`, which is a CLI with a
 * `main()` — importing it to borrow one regex would drag the whole command-line
 * tool into a web server. `tests/fleet-rename-route.test.ts` reads that file and
 * asserts the two are the same text, so the copy cannot drift in silence.
 */
export const NAME_RULE = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** tmux session handle: `$` and digits, and nothing else is an address. */
const SESSION_HANDLE = /^\$\d{1,10}$/;

const MAX_BODY_BYTES = 8 * 1024;

export type RenameRequest = { sessionId: string; name: string };

export type RenameResponse =
  | { ok: true; sessionId: string; name: string; was: string | null }
  | { ok: false; code: RenameErrorCode; why: string };

export type RenameErrorCode =
  | "bad-request"
  | "bad-name"
  | "name-taken"
  | "no-such-session"
  | "forbidden-origin"
  | "unsupported-media-type"
  | "body-too-large"
  | "method-not-allowed"
  | "rename-failed"
  | "internal";

/** Status per code. A `Record`, so a new code fails to compile rather than inheriting a guess. */
export const RENAME_STATUS: Record<RenameErrorCode, number> = {
  "bad-request": 400,
  // The caller's fault and re-sending it unchanged will fail again.
  "bad-name": 400,
  // The world, not the request: another session has that name. 409, so a client
  // knows that looking again and picking differently is the move.
  "name-taken": 409,
  "no-such-session": 409,
  "forbidden-origin": 403,
  "unsupported-media-type": 415,
  "body-too-large": 413,
  "method-not-allowed": 405,
  "rename-failed": 409,
  internal: 500,
};

/* ------------------------------------------------------------------ *
 * The seam, so a test never touches tmux.
 * ------------------------------------------------------------------ */

export type RenameIo = {
  /** `tmux list-sessions -F "#{session_id} #{session_name}"`. Throws when tmux cannot be asked. */
  listSessions(): Promise<string>;
  /**
   * Renames and clears the provisional flag, in one invocation. Throws when
   * tmux refuses, and a `RenameUnsettled` when what happened is not known.
   */
  rename(sessionId: string, name: string): Promise<void>;
};

/**
 * A rename that did not end with tmux's own answer. `message` is a sentence
 * written here, with no argv in it, so the route may show it as it stands.
 */
export class RenameUnsettled extends Error {}

/** The sentence for a child this owner would not start. Shared by both calls. */
function notStarted(outcome: Extract<OwnedOutcome, { kind: "refused" }>): string {
  return (
    `an earlier tmux command from this page (pid ${outcome.pid}) has still not exited after ` +
    `${Math.round(outcome.liveForMs / 1000)} s, so a second one was not started`
  );
}

/**
 * Both calls go through the process's one child owner rather than
 * `execFileSync`, whose `timeout` only signals and then goes on waiting — with
 * every other request to this single-threaded server waiting behind it
 * (docs/postmortems/260910a-a-timeout-that-signals-and-then-waits-is-not-a-bound.md).
 * The owner stops waiting at the deadline plus one grace, and refuses to start
 * a second child under a key whose first is still unaccounted for.
 */
export function realIo(owner: ProbeOwner = processProbeOwner(), timeoutMs = 10_000): RenameIo {
  return {
    listSessions: async () => {
      const outcome = await owner.run({
        key: "rename:tmux-list-sessions",
        cmd: "tmux",
        args: ["list-sessions", "-F", "#{session_id} #{session_name}"],
        timeoutMs,
      });
      if (outcome.kind === "ok") return outcome.stdout;
      throw new Error(outcome.kind === "refused" ? notStarted(outcome) : outcome.why);
    },
    rename: async (sessionId, name) => {
      const outcome = await owner.run({
        key: "rename:tmux-rename-session",
        cmd: "tmux",
        // `;` is tmux's own command separator, passed as its own argument — no
        // shell is involved anywhere, so neither the handle nor the name can
        // become a command however they are spelled. Both have already been
        // checked against a regex, and this is the belt to that's braces.
        args: ["rename-session", "-t", sessionId, name, ";", "set-environment", "-t", sessionId, "GJD_PROVISIONAL", "0"],
        timeoutMs,
      });
      if (outcome.kind === "ok") return;
      if (outcome.kind === "refused") {
        throw new RenameUnsettled(`${notStarted(outcome)}: nothing was renamed — try again in a moment`);
      }
      if (outcome.kind === "timed-out" || outcome.kind === "overflowed") {
        // Signalled, and no longer waited for. Whether tmux renamed first is
        // not known here, and saying it failed would be a guess.
        throw new RenameUnsettled(
          `tmux did not finish within ${Math.round(timeoutMs / 1000)} s and I stopped waiting: ` +
            "the rename MAY have happened — look at the session's name before trying again",
        );
      }
      throw new Error(outcome.why);
    },
  };
}

/** `$1643 some-name` lines to a handle → name map. Malformed lines are skipped. */
export function parseSessionNames(out: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const line of out.split("\n")) {
    const at = line.indexOf(" ");
    if (at <= 0) continue;
    const id = line.slice(0, at);
    const name = line.slice(at + 1).trim();
    if (!SESSION_HANDLE.test(id) || name === "") continue;
    names.set(id, name);
  }
  return names;
}

/**
 * Why this name cannot be used, or null.
 *
 * Renaming a session to the name it already has is **allowed and is not a
 * no-op**: it also clears `GJD_PROVISIONAL`, which is how somebody pins a name
 * Claude happened to choose and which they now want to keep. Refusing it as
 * "taken by yourself" would refuse the one case where the second half of the
 * operation is the whole point.
 */
export function checkName(name: unknown, sessionId: string, names: ReadonlyMap<string, string>): {
  code: RenameErrorCode;
  why: string;
} | null {
  if (typeof name !== "string") return { code: "bad-name", why: "name must be a string" };
  const want = name.trim();
  if (want === "") return { code: "bad-name", why: "a name cannot be empty" };
  if (!NAME_RULE.test(want)) {
    return {
      code: "bad-name",
      why:
        `'${want}' is not a session name: lower-case letters, digits and hyphens, ` +
        `starting with a letter or digit, at most 41 characters`,
    };
  }
  if (!names.has(sessionId)) {
    return { code: "no-such-session", why: `there is no session ${sessionId} on this box any more` };
  }
  for (const [id, existing] of names) {
    if (existing === want && id !== sessionId) {
      return { code: "name-taken", why: `'${want}' is already the name of session ${id}` };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The HTTP skin. Same shape as routes-steer.ts, deliberately.
 * ------------------------------------------------------------------ */

/** Origin, content type, and the hostname allowlist that closes DNS rebinding. */
export function checkRequest(headers: IncomingHttpHeaders): { code: RenameErrorCode; why: string } | null {
  const ctype = String(headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (ctype !== "application/json") {
    return { code: "unsupported-media-type", why: `this route takes application/json, not ${ctype || "an unstated type"}` };
  }
  const host = headers.host;
  if (typeof host !== "string" || host === "") {
    return { code: "bad-request", why: "the request had no Host header, so I cannot tell what same-origin means" };
  }
  const origin = headers.origin;
  if (typeof origin !== "string" || origin === "" || origin === "null") {
    return { code: "forbidden-origin", why: "this route needs a same-origin Origin header; it has no authentication" };
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return { code: "forbidden-origin", why: `Origin ${origin} is not a URL` };
  }
  if (parsed.host !== host) {
    return { code: "forbidden-origin", why: `Origin ${origin} is not this server (${host})` };
  }
  // Host === Origin is not enough on its own: a page at evil.example whose DNS
  // re-resolves here sends both headers saying evil.example and they agree.
  if (!addressableHost(parsed.hostname)) {
    return { code: "forbidden-origin", why: `this dashboard is not reached by the name '${parsed.hostname}'` };
  }
  return null;
}

async function readBody(req: Pick<IncomingMessage, typeof Symbol.asyncIterator>): Promise<string | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function respond(res: ServerResponse, status: number, body: RenameResponse): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

export type RenameDeps = { io: RenameIo; log: (line: string) => void };

export function makeRenameRoute(over: Partial<RenameDeps> = {}): {
  handle(req: IncomingMessage, res: ServerResponse): boolean;
} {
  const deps: RenameDeps = { io: over.io ?? realIo(), log: over.log ?? ((l) => console.log(l)) };
  // One rename at a time. list → check → rename was one synchronous stretch
  // until the tmux calls became awaited; without this, two requests can both
  // be told a name is free. A flag and a refusal, not a queue.
  let inFlight = false;

  return {
    handle(req, res) {
      const url = (req.url ?? "/").split("?")[0] ?? "/";
      if (url !== "/api/sessions/rename") return false;

      if (req.method !== "POST") {
        respond(res, 405, { ok: false, code: "method-not-allowed", why: "renaming is POST only" });
        return true;
      }
      const bad = checkRequest(req.headers);
      if (bad) {
        respond(res, RENAME_STATUS[bad.code], { ok: false, ...bad });
        return true;
      }

      void (async () => {
        let mine = false;
        try {
          const raw = await readBody(req);
          if (raw === null) {
            respond(res, 413, { ok: false, code: "body-too-large", why: "the body was larger than 8 KiB" });
            return;
          }
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {
            respond(res, 400, { ok: false, code: "bad-request", why: "the body was not JSON" });
            return;
          }
          const o = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
          const sessionId = o === null ? null : o["sessionId"];
          if (typeof sessionId !== "string" || !SESSION_HANDLE.test(sessionId)) {
            respond(res, 400, {
              ok: false,
              code: "bad-request",
              why: "sessionId must be a tmux session handle like $1643 — a name is not an address",
            });
            return;
          }

          // Checked and set with no await between, and before the first tmux
          // call; cleared in the `finally` below, whichever way this ends.
          if (inFlight) {
            respond(res, 409, {
              ok: false,
              code: "rename-failed",
              why: "another rename is in flight on this dashboard, so this one was not started — try again in a moment",
            });
            return;
          }
          inFlight = mine = true;

          let names: Map<string, string>;
          try {
            names = parseSessionNames(await deps.io.listSessions());
          } catch (err) {
            respond(res, 409, {
              ok: false,
              code: "rename-failed",
              why: `could not ask tmux what is running: ${err instanceof Error ? err.message : String(err)}`,
            });
            return;
          }

          const nameProblem = checkName(o?.["name"], sessionId, names);
          if (nameProblem) {
            deps.log(`rename: refused ${sessionId} code=${nameProblem.code}`);
            respond(res, RENAME_STATUS[nameProblem.code], { ok: false, ...nameProblem });
            return;
          }
          const want = String(o?.["name"]).trim();
          const was = names.get(sessionId) ?? null;

          try {
            await deps.io.rename(sessionId, want);
          } catch (err) {
            respond(res, 409, {
              ok: false,
              code: "rename-failed",
              // Sanitised: tmux's own message, not the thrown Error's, which
              // carries argv. The argv here is not secret, but the habit is —
              // see routes-steer.ts, where it was a privacy hole. A
              // `RenameUnsettled` is our own sentence, and "refused" would be
              // false of it: tmux was not asked, or was not waited for.
              why:
                err instanceof RenameUnsettled
                  ? err.message
                  : `tmux refused the rename${err instanceof Error && err.message.includes("can't find session") ? ": that session is gone" : ""}`,
            });
            return;
          }

          deps.log(`rename: ${sessionId} ${was ?? "?"} → ${want}`);
          respond(res, 200, { ok: true, sessionId, name: want, was });
        } catch (err) {
          respond(res, 500, {
            ok: false,
            code: "internal",
            why: `the rename route threw: ${err instanceof Error ? err.message : String(err)}`,
          });
        } finally {
          if (mine) inFlight = false;
        }
      })();
      return true;
    },
  };
}

let shared: ReturnType<typeof makeRenameRoute> | null = null;

/** Built on first use, so importing this file starts nothing. */
export function renameRoute(): ReturnType<typeof makeRenameRoute> {
  shared ??= makeRenameRoute();
  return shared;
}
