/**
 * Renaming a session — `POST /api/sessions/rename`.
 *
 * ## `sessionId` is the HANDLE, never the name
 *
 * `row.id` is `$1643`; `row.name` is a word somebody chose. The route refuses a
 * name in that field with a 400, and it is right to: names are reassigned when
 * a session dies, so a request addressed by name can land on whichever session
 * took the name afterwards. That is the same hazard `kill-session`'s gate names
 * in tools/fleet/actions.ts. `renameBody` therefore takes the ROW and reads
 * `id` off it, so there is no call site at which the wrong string can be
 * handed in — and, like everything else in this client, it is a pure function
 * of what was on screen with no fetch in front of it (steer-client.ts § THE
 * RULE THIS FILE EXISTS TO KEEP).
 *
 * ## Renaming to the name it already has is legal, and is not a no-op
 *
 * It also clears the session's *provisional* flag — the thing that otherwise
 * lets `gjd-remote ls` rename it back to Claude's own title later. So the
 * gesture for *keep this name* is to re-submit it unchanged, and **the UI must
 * not disable Save when the text has not been edited.** That is the one rule
 * about this control that is not guessable from looking at it.
 *
 * **What is NOT built, and is not faked:** the payload does not say which
 * sessions are provisional, so nothing on the page can offer *save to keep this
 * name* on the rows where it would actually matter. It would need a field on
 * the row; drawing the hint without one would be a guess dressed as a fact.
 *
 * ## The local check saves a round trip and decides nothing
 *
 * `looksLikeAName` refuses only what the rule plainly refuses, so the common
 * typo never leaves the browser. It is not a second copy of the server's
 * decision: anything it lets through is decided by the server, and when the
 * server refuses, **its sentence is what goes on screen** — it spells the rule
 * out, names the session that already holds a taken name, and knows which of
 * those two it is. Nothing here paraphrases one.
 */
import type { FleetRow } from "./types";

export const RENAME_URL = "api/sessions/rename";

/**
 * Lower-case letters, digits and hyphens; starting with a letter or digit; at
 * most 41 characters. Written as one expression rather than three checks so
 * that it cannot be half-true.
 */
export const NAME_RULE = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** The rule in words, for the box's own hint. The server's `why` outranks it. */
export const NAME_RULE_TEXT =
  "Lower-case letters, digits and hyphens, starting with a letter or a digit, up to 41 characters.";

export function looksLikeAName(name: string): boolean {
  return NAME_RULE.test(name);
}

export type RenameBody = { sessionId: string; name: string };

/** The body. `row.id`, never `row.name` — see the header. */
export function renameBody(row: FleetRow, name: string): RenameBody {
  return { sessionId: row.id, name };
}

/**
 * What became of a rename.
 *
 * `was` is on the success arm because it is the half that makes the confirmation
 * mean anything: *renamed from `worktree-fb1v` to `socratic-eval`* says what
 * happened, and "Renamed." says only that something did.
 */
export type RenameOutcome =
  | { ok: true; name: string; was: string | null }
  | { ok: false; code: string; why: string; status: number | null; from: "server" | "client" };

export type RenameApi = { rename: (row: FleetRow, name: string) => Promise<RenameOutcome> };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "the request failed, and gave no reason";
}

export function makeRenameApi(fetchImpl: typeof fetch = fetch): RenameApi {
  return {
    async rename(row, name): Promise<RenameOutcome> {
      let response: Response;
      try {
        response = await fetchImpl(RENAME_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(renameBody(row, name)),
        });
      } catch (cause) {
        return {
          ok: false,
          code: "unreachable",
          why: `this browser could not reach the dashboard: ${describe(cause)}`,
          status: null,
          from: "client",
        };
      }
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch (cause) {
        return {
          ok: false,
          code: "not-json",
          why: `the server answered ${response.status} and the body was not JSON: ${describe(cause)}`,
          status: response.status,
          from: "client",
        };
      }
      if (isRecord(parsed) && parsed["ok"] === true) {
        /* The name the SERVER says it set, not the one we typed. If it
           normalised it, the box should show what is actually true of the box. */
        const settled = typeof parsed["name"] === "string" ? parsed["name"] : name;
        return { ok: true, name: settled, was: typeof parsed["was"] === "string" ? parsed["was"] : null };
      }
      const why = isRecord(parsed) && typeof parsed["why"] === "string" ? parsed["why"] : null;
      const code = isRecord(parsed) && typeof parsed["code"] === "string" ? parsed["code"] : null;
      return {
        ok: false,
        code: code ?? "unknown",
        why: why ?? `the server answered ${response.status} without saying why`,
        status: response.status,
        from: why === null ? "client" : "server",
      };
    },
  };
}

/** The default instance. Late-bound `fetch`, for the reason in steer-client.ts. */
export const httpRenameApi: RenameApi = {
  rename: (row, name) => makeRenameApi().rename(row, name),
};
