/**
 * **The MCP server's one way to reach Spideryarn**: the same `/api/…` routes
 * the web app calls, with the same Bearer token — plan 261007j § The decision.
 *
 * Nothing here decides what anyone may do. The route does, and its refusal
 * comes back as an `ApiError` carrying the status and the server's own
 * `{ error }` sentence, which the tool layer turns into a readable tool error.
 *
 * A 401 is answered by refreshing once and trying once more, because an
 * access token can expire between the check and the call; a second 401 is
 * the answer.
 */

import type { FetchLike } from "./session.js";

/** Where the tokens come from. `Session` is one; a test supplies another. */
export interface TokenSource {
  accessToken(): Promise<string>;
  refreshAfterRejection(rejected: string): Promise<string>;
}

/** A refusal or failure from the site, with the server's own words. Never carries a token. */
export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    /** The HTTP status, or 0 when the site could not be reached at all. */
    readonly status: number,
    /** The server's `{ error }` text, or a sentence of ours when there was none. */
    readonly serverMessage: string,
  ) {
    super(status === 0 ? serverMessage : `${status}: ${serverMessage}`);
  }
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Api {
  /** The site's origin, for building the links a result carries. */
  readonly site: string;
  call<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<T>;
}

export function makeApi(options: { site: string; tokens: TokenSource; fetch?: FetchLike }): Api {
  const site = options.site.replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;

  const scrub = (text: string, secrets: readonly string[]) => {
    let safe = text;
    for (const secret of secrets) if (secret) safe = safe.split(secret).join("[redacted]");
    return safe;
  };

  async function once(
    method: HttpMethod,
    path: string,
    body: unknown,
    token: string,
    attemptedTokens: readonly string[],
  ): Promise<Response> {
    try {
      return await doFetch(`${site}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      /* fetch's own message names the address, not the headers. Scrubbed
         anyway: this is the one place a token and outside text meet. */
      const said = scrub(String((err as Error)?.message ?? err), attemptedTokens);
      throw new ApiError(0, `Could not reach ${site} (${said}).`);
    }
  }

  return {
    site,
    async call<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
      let token = await options.tokens.accessToken();
      const attemptedTokens = [token];
      let res = await once(method, path, body, token, attemptedTokens);
      if (res.status === 401) {
        token = await options.tokens.refreshAfterRejection(token);
        attemptedTokens.push(token);
        res = await once(method, path, body, token, attemptedTokens);
      }
      /* A route should never echo Authorization, but this is the boundary that
         promises no token reaches a tool result. Scrub every attempted token,
         including the rejected one after a 401, before either parsing a success
         or choosing text for an error. */
      const text = scrub(await res.text(), attemptedTokens);
      let json: unknown;
      try {
        json = text === "" ? undefined : JSON.parse(text);
      } catch {
        json = undefined;
      }
      if (!res.ok) {
        const said =
          json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
            ? (json as { error: string }).error
            : `the site answered ${res.status} without saying why`;
        throw new ApiError(res.status, said);
      }
      if (json === undefined && text !== "") {
        throw new ApiError(res.status, `the site answered ${res.status} with something that is not JSON`);
      }
      return json as T;
    },
  };
}
