/**
 * Reading an API response, for every `fetch` in the client.
 *
 * ## The bug this exists to stop
 *
 * Twelve call sites had independently written the same four lines:
 *
 *     const body = await r.json();
 *     if (!r.ok) throw new Error(body.error ?? r.statusText);
 *
 * which is careful, and wrong in the one case it was written for. `r.json()`
 * runs **first**, so when the failing response is not JSON it throws a
 * `SyntaxError` and the line that turns a server error into a readable message
 * never runs at all. The reader gets the parser's complaint about the first
 * character of a stack trace:
 *
 *     Unexpected token 'A', "A server e"... is not valid JSON
 *
 * That is what the whole homepage said on 2026-08-26 when the deployed function
 * was crashing — "A server error has occurred" is Vercel's plain-text 500, and
 * `The page c…` is its 404. The error handling was not missing; it was
 * unreachable. See docs/postmortems/first-vercel-deploy-silent-failures.md.
 *
 * ## And nothing was written down
 *
 * The second half of the same report: **no `console.error` was logged**, so a
 * server failure showed the reader a JavaScript parser message and left no
 * trace in devtools. There is no client-side logger here and there should not
 * be one — docs/project/logging.md is about the server, and a browser already
 * has a console. But something has to reach it, and nothing did.
 *
 * So every failure goes through `logFailure` below, once, with the status, the
 * URL and the first of the body. The reader gets a short sentence; whoever is
 * debugging gets the rest.
 *
 * ## The rule about the body
 *
 * **A response body never becomes a user-facing message.** Only the server's own
 * `{ error }` string does. An unparsed body is somebody else's HTML — Vercel's,
 * a proxy's, a captive portal's — and putting it on screen is how you get a
 * stack trace, or a login page, rendered as an error message.
 *
 * ## And, since 2026-08-26, making the request as well as reading it
 *
 * `apiFetch` below is the other half. Every request to our API carries an
 * `Authorization: Bearer` header now, and there are thirty-one call sites in
 * fourteen files — so the one thing that must not happen is thirty-one
 * independent decisions about how to get a token. Same argument as above, one
 * layer up, which is why it lives in this file rather than in a new one.
 *
 * **A header rather than a cookie**, and that was a free choice rather than a
 * clever one: nothing in this app uses `EventSource`, which cannot set headers.
 * useChat.ts says in its own comment why it reads SSE off a `fetch` body
 * instead, and that decision — made for other reasons — is what leaves a
 * bearer token available here. Cookies would have brought a CSRF surface with
 * them. docs/plans/auth-supabase.md.
 */

import { supabase } from "./supabase.js";

/** How much of an unexpected body reaches the console. Enough to recognise it. */
const SNIPPET = 300;

/**
 * `Not Found (404)`, or `Request failed (503)` when there is no reason phrase.
 *
 * HTTP/2 has no status text at all — it was removed from the protocol — so
 * `res.statusText` is reliably empty in production and reliably populated
 * against a local dev server. A message built from it alone reads fine on this
 * laptop and reads as `" (500)"` once deployed, which is exactly the kind of
 * difference nobody sees until a user reports it.
 */
function statusLabel(res: Response): string {
  return res.statusText ? `${res.statusText} (${res.status})` : `Request failed (${res.status})`;
}

/**
 * One line in the browser console, for a failure the reader is about to be told
 * about in one sentence.
 *
 * `console.error` rather than `console.warn`: this is always a request that did
 * not do what it was for.
 */
function logFailure(res: Response, text: string, parsed: boolean): void {
  console.error(`[api] ${res.status} ${res.url || "(no url)"}${parsed ? "" : " — reply was not JSON"}`, {
    status: res.status,
    contentType: res.headers.get("content-type"),
    bytes: text.length,
    body: text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text,
  });
}

/** Log it, then say it in one sentence a reader can act on. */
function errorFor(res: Response, text: string): Error {
  let said: unknown;
  let parsed = false;
  try {
    const body: unknown = JSON.parse(text);
    parsed = true;
    if (typeof body === "object" && body !== null) said = (body as { error?: unknown }).error;
  } catch {
    /* Deliberately swallowed. Whether it parsed is the interesting fact, and it
       is captured in `parsed`; the parser's own message describes the first
       character of somebody else's HTML and is never worth showing anyone. */
  }

  logFailure(res, text, parsed);

  /* The server's own words when it gave them, and only then. See the header:
     an unparsed body is not ours to quote. */
  if (typeof said === "string" && said.trim() !== "") return new Error(said);

  return new Error(
    `${statusLabel(res)} — the server's reply wasn't JSON, so the browser console has more.`,
  );
}

/**
 * The error for a response the caller has **already** decided is a failure.
 *
 *     if (!r.ok) throw await failure(r);
 *
 * For the call sites that never wanted the success body — a DELETE, a PATCH
 * whose answer is ignored. They used to write
 * `(await r.json().catch(() => ({}))).error ?? r.statusText`, which is safe from
 * the parse crash but has its own quiet failure: **HTTP/2 removed the status
 * text from the protocol**, so `r.statusText` is empty in production and
 * populated against the local dev server. On a 500 with no `error` field that
 * produced `new Error("")` — a thrown error with nothing in it, which surfaces
 * as an empty red box.
 *
 * Consumes the body, so it must be called before anything else reads it.
 */
export async function failure(res: Response): Promise<Error> {
  /* `.catch`, because a body can fail mid-read — a connection cut after the
     headers arrived. There is still a status worth reporting, and throwing from
     the function whose job is to build an error would replace a useful message
     with a useless one. */
  const text = await res.text().catch(() => "");
  return errorFor(res, text);
}

/**
 * The parsed body, or a thrown `Error` whose message is safe to show a reader.
 *
 * Replaces `await res.json()` plus the `!res.ok` check, and does them in the
 * order that works: **read the text once, then decide.** `Response.json()` can
 * only be called on a body that has not been read, and it conflates "the server
 * said no" with "the body would not parse" — which are the two things a caller
 * most needs to tell apart.
 *
 * Throws rather than returning a result type, because every existing call site
 * already ends in a `catch` that sets an error message, and a rule the compiler
 * enforces is worth less here than twelve call sites that keep working.
 */
export async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();

  if (!res.ok) throw errorFor(res, text);

  /* An empty body with a successful status is `204 No Content`, which several
     routes in src/routes.ts answer with — a DELETE has nothing to say. "No
     body" is not "malformed body", so it is not an error, and the callers that
     used to write `.catch(() => ({}))` for exactly this keep working. */
  if (text === "") return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    /* A 200 that is not JSON. Usually the single-page-app fallback answering a
       request the API should have had: `/api/…` fell through to index.html and
       the reply is the whole client. Worth its own sentence, because a "not
       found" would send you looking in the wrong place entirely. */
    logFailure(res, text, false);
    throw new Error(
      `The server replied ${res.status} but not with JSON — the browser console has more.`,
    );
  }
}


/* ------------------------------------------------------------------------- *
 *  Making the request
 * ------------------------------------------------------------------------- */

/**
 * `fetch`, with the reader's access token on it.
 *
 * A drop-in for `fetch` at every `/api/…` call site: same arguments, same
 * `Response`, same streaming body, same `AbortSignal`. The differences are all
 * on the way out.
 *
 * ## Same-origin `/api/` only
 *
 * The cheapest line in this file, and it stops the expensive mistake: a future
 * absolute URL quietly posting somebody's bearer token to another host. There
 * is no legitimate cross-origin call in this app, so the check costs nothing
 * and refuses rather than warns.
 *
 * ## The token is fetched, not remembered
 *
 * `getSession()` on **every** request, never a token cached in React state.
 * The SDK refreshes inside a 90-second margin and single-flights concurrent
 * refreshes, so this is close to free — and it is what makes a page restored
 * from the bfcache, a tab that has been in the background for an hour, and a
 * refresh already in flight all behave without any of them being special-cased.
 *
 * ## A 401 is not "the session is gone"
 *
 * Refresh once, retry once, and then report the failure. **Do not sign the
 * reader out.** A 401 can be a refresh race or a momentary verifier failure,
 * and dropping somebody out of the article they are reading because one request
 * lost a race is a worse bug than the one it would be preventing. Session state
 * belongs to the SDK's own auth events; useSession.ts subscribes to them.
 *
 * Retrying is safe for what this app sends — every body is a string or absent,
 * so there is no consumed stream to replay. A `ReadableStream` body would break
 * that assumption, and there are none.
 *
 * ## A stream does not die when its token expires
 *
 * The token is an admission check. Once the server has accepted the request
 * there is nothing to re-check per SSE frame, so a chat answer that runs past
 * the hour simply keeps arriving. Worth stating because it is the first
 * question anyone asks about this design.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!input.startsWith("/api/")) {
    throw new Error(`apiFetch is for our own API only, and this is not: ${input}`);
  }

  const send = async (token: string | undefined): Promise<Response> => {
    /* `Headers` rather than object spread, because a caller may pass headers as
       an array of pairs or as a `Headers` instance, and spreading either of
       those silently produces `{}` — a class of bug where the request goes out
       looking almost right. */
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  const token = await accessToken();
  const first = await send(token);
  if (first.status !== 401) return first;

  /* **Nobody was signed in, so there is nothing to refresh.** Without this the
     sign-in screen's own requests would each provoke a pointless refresh call,
     and — worse — `refreshSession()` on a signed-out client is a shape this
     code then has to guess at. A 401 for an anonymous request is not a race, it
     is the correct answer. */
  if (!token) return first;

  /* One refresh, one retry. Not a loop: if a fresh token is also refused then
     the answer really is no, and a client that keeps asking turns a refusal
     into a denial-of-service against our own server.
     The `catch` is not decoration — a refresh is a network call, and a throw
     here would replace a perfectly good 401 (which callers know how to report)
     with a `TypeError` about `fetch`. */
  let refreshed: string | undefined;
  try {
    const { data } = await supabase.auth.refreshSession();
    refreshed = data?.session?.access_token;
  } catch {
    return first;
  }
  if (!refreshed) return first;
  return send(refreshed);
}

/**
 * The current access token, or `undefined`.
 *
 * `undefined` rather than a throw: an unauthenticated request should be refused
 * by the server, with the server's own message, rather than by a client-side
 * error the reader cannot act on. It also means the sign-in screen's own calls
 * do not need a special case.
 */
async function accessToken(): Promise<string | undefined> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

/**
 * The token we already have, without waiting to find out if it is fresh.
 *
 * **For `pagehide` and nothing else.** A page being torn down can be killed
 * inside the `await` that `apiFetch` does before it starts the request, which
 * turns a best-effort save into a save that often never leaves. This reads the
 * SDK's synchronous in-memory copy and starts the request immediately.
 *
 * The trade is explicit: a token that expired in the last few seconds will be
 * refused, and the save is lost. That is strictly better than the request never
 * being made — and the real fix is not to arrive here with unsaved work, which
 * is why useProfile.ts also flushes on `visibilitychange`. GPT Sol, 2026-08-26.
 */
export function leavingFetch(input: string, init: RequestInit = {}): void {
  if (!input.startsWith("/api/")) return;

  /* **Browsers cap the total body of all in-flight `keepalive` requests at
     about 64KiB, and reject over it.** Nothing here comes close — the only
     caller is the reader profile, capped near 1,500 characters — but this
     function is generic and swallows its own failures by design, so a future
     caller sending something large would fail completely silently. Better to
     say so in the console than to be that silent. GPT Sol, 2026-08-27. */
  const body = init.body;
  if (typeof body === "string" && body.length > KEEPALIVE_LIMIT) {
    console.error(
      `[api] not sending ${input} on page exit: ${body.length} bytes is over the ~${KEEPALIVE_LIMIT} keepalive budget.`,
    );
    return;
  }

  const headers = new Headers(init.headers);
  const token = cachedToken;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  /* `keepalive` lets the request outlive the page. Deliberately unawaited and
     unhandled: there is no one left to tell. */
  void fetch(input, { ...init, headers, keepalive: true }).catch(() => {});
}

/** The browser's keepalive body budget, less a little for headers. */
const KEEPALIVE_LIMIT = 60 * 1024;

/**
 * The last token we saw, kept for `leavingFetch`.
 *
 * Updated from the SDK's own auth events rather than polled, so it is exactly
 * as fresh as the SDK is. This is the one place in the client that holds a
 * token in a variable, and it exists solely because `pagehide` has no time to
 * await anything.
 */
let cachedToken: string | undefined;
supabase.auth.onAuthStateChange((_event, session) => {
  cachedToken = session?.access_token;
});
