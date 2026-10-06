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
 * unreachable. See docs/postmortems/260826g-first-vercel-deploy-silent-failures.md.
 *
 * ## And nothing was written down
 *
 * The second half of the same report: **no `console.error` was logged**, so a
 * server failure showed the reader a JavaScript parser message and left no
 * trace in devtools. So every failure goes through `logFailure` below, once,
 * with the status, the URL and the first of the body. The reader gets a short
 * sentence; whoever is debugging gets the rest.
 *
 * ## There is a client-side logger now, and this file used to say there must not be
 *
 * Until 2026-08-31 the paragraph above ended: *"There is no client-side logger
 * here and there should not be one — docs/project/logging.md is about the
 * server, and a browser already has a console."*
 *
 * **That reason is true for a developer sitting at the machine and false for a
 * reader on their own laptop, whose console we will never see.** That gap is
 * the whole thing the Feedback button exists to close: on 2026-08-28 every
 * ingest on the live site had been failing and the way we found out was Greg
 * trying to read an article. So `recordLog` below writes each request into
 * [`../log-buffer.ts`](../log-buffer.ts) — a two-hundred-entry ring that is
 * normally thrown away and can be attached to a bug report the reader chooses
 * to send. Corrected here rather than quietly contradicted; see
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md
 * § It reverses a written decision, and that is deliberate.
 *
 * **The rule underneath it survives intact, and gains a clause:** a response
 * body never becomes a user-facing message, and now also never becomes a log
 * entry. What is recorded is the status, the path with its query string
 * removed, the duration and `x-vercel-id` — never a body, never a query, never
 * an error's message.
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
 * them. docs/plans/260826w-auth-supabase.md.
 */

import {
  cachedSlugs,
  forgetUser,
  invalidate,
  lastKnownUser,
  readCached,
  rememberUser,
  reserveTicket,
  type Ticket,
  writeCached,
} from "./offline-store.js";
import { noteNoConnection, noteReachedServer, noteServedCopy } from "../offline.js";
import { recordLog } from "../log-buffer.js";
import { setClientMonitoringUser } from "../monitoring.js";
import { markUnreachable, ReaderFacingError } from "./reader-facing.js";
import { heldReader, heldToken, onSession, sessionObserved, sessionRevision, tokenOwnerOf } from "./session.js";
import { supabase } from "./supabase.js";
import { noteRequest } from "./writes.js";
import type { QuizResponse } from "../../types.js";

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
  /* Public reads may carry a private link's key, including an expected 409
     while importing. Redact here too: the buffer's safePath does not protect
     the console output. */
  const url = (res.url || "(no url)").split(/[?#]/)[0];
  console.error(`[api] ${res.status} ${url}${parsed ? "" : " — reply was not JSON"}`, {
    status: res.status,
    contentType: header(res, "content-type"),
    bytes: text.length,
    body: text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text,
  });

  /* **The body stays in the console and goes no further.** What the buffer gets
     is how big it was and what it claimed to be — which is the pair that
     actually identifies the commonest failure here, Vercel's single-page
     fallback answering a request the API should have had: four kilobytes of
     `text/html` with a 200 on it. Three hundred characters of somebody's
     article with a stack trace in it is not a row anybody can pivot on, and it
     is the thing `src/web/monitoring.ts` locks breadcrumbs off three ways to
     keep out.

     `attempt` has already written a `response` row for the same request; this
     one is not a duplicate of it, because only here is it known whether the
     body parsed and what it weighed. */
  recordLog({
    kind: "api",
    outcome: parsed ? "error-body" : "not-json",
    /* A `Response` does not carry the method that produced it, and guessing is
       worse than saying so. */
    method: null,
    path: res.url ?? "",
    status: res.status,
    ms: null,
    vercelId: header(res, "x-vercel-id"),
    bytes: text.length,
    contentType: mediaType(res),
    error: null,
  });
}

/** `application/json`, `text/html` — the media type with its parameters cut off. */
function mediaType(res: Response): string | null {
  const type = (header(res, "content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  return type ? type : null;
}

/**
 * A response header, or `null` — and **never a throw**.
 *
 * `recordLog` swallows its own failures, and that turned out not to be enough:
 * the *arguments* to it are evaluated first, and not every `Response` this code
 * meets is a real one. A hand-built stub with no `headers` made
 * `res.headers.get("x-vercel-id")` throw **inside `attempt`'s `try`**, where the
 * catch reported a perfectly good 200 as a transport failure and served a
 * cached copy instead — a diagnostic silently changing the behaviour it was
 * added to observe, which is the worst possible way for one to fail.
 *
 * Twelve tests in `tests/use-search.test.ts` and `tests/use-chat-recovery.test.ts`
 * went red on it, 2026-08-31.
 *
 * **Every header read in this file goes through here — not only the ones read
 * for the log buffer.** That was the original rule and it was too narrow:
 * `logFailure` kept one direct `res.headers.get("content-type")` for its
 * `console.error`, so the same accepted stub turned `failure()` — the one
 * function whose whole job is to *build* an error — into a `TypeError`. The
 * module has decided to accept incomplete `Response`s, and a decision that
 * holds in most of a file holds in none of it. GPT Sol, 2026-09-02:
 * docs/plans/260902o-adding-a-mode-wave1-a-code-review-sol.md § 2, and
 * `tests/web-api.test.ts` § survives a response with no headers at all.
 */
function header(res: Response, name: string): string | null {
  try {
    return res.headers?.get(name) ?? null;
  } catch {
    return null;
  }
}

/**
 * A failure the server chose, carrying **the status it chose it with**.
 *
 * The message is unchanged — it is still the server's own sentence, and every
 * existing `catch` that reads `.message` keeps working. What is new is that a
 * caller can now tell *which* refusal it was without reading prose, which
 * `src/web/jobEngine.ts` needs: the engine stops on a final 401 and keeps
 * polling through a 500, and those two are the same string as far as
 * `Error.message` goes.
 *
 * Added 2026-09-01 with the job engine. The alternative was inspecting
 * `Response.status` at each call site before handing the body to `readJson`,
 * which puts the same two lines back in every caller and gets forgotten in
 * exactly one of them.
 */
export class HttpError extends ReaderFacingError {
  readonly status: number;
  /**
   * **What the server sent beside `error`**, or `{}` when it sent nothing.
   *
   * Added 2026-09-01 for a 409 `POST /api/jobs` no longer answers — the article
   * already had a job in flight, and the refusal carried the blocking job so the
   * reader was not told to stop something the interface never showed them. That
   * refusal went on 2026-09-02, when a second job on one article started queuing
   * instead (docs/project/ingest-queue.md), and **this field stayed**: it
   * belongs to the error type rather than to that case, and what it fixed is
   * general — `readJson` kept the sentence and dropped every other field, which
   * made *any* structured refusal unusable however carefully the server wrote
   * one. Nothing on the server puts a field beside `error` today.
   *
   * **Whatever brings one back must match one declared class and read one
   * declared field**, never spread an error's own enumerable properties: a
   * Drizzle failure's message carries bound parameters and a provider's carries
   * its own words (docs/project/copy.md rule 4).
   *
   * **A second parsing path was the alternative and is worse.** A caller could
   * read `Response.status`, decide it is the interesting one, and parse the body
   * itself — which puts the same four lines back at every call site and gets
   * forgotten at exactly one of them, the same argument that produced this
   * class in the first place.
   *
   * `error` is deliberately **not** repeated in here. This means *what came
   * beside the sentence*, so nothing reading it needs to know which key the
   * prose lives under.
   */
  readonly details: Readonly<Record<string, unknown>>;
  constructor(message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

/**
 * The HTTP status a thrown error carries, or null if it carries none.
 *
 * **Duck-typed rather than `instanceof`**, and deliberately: a test that mocks
 * `lib/api.js` supplies its own `readJson`, and a second copy of this module in
 * the graph would make `instanceof HttpError` false for an object that is one
 * in every way that matters. A number on `.status` is the whole contract.
 */
export function statusOf(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/**
 * The structured fields a thrown error carries, or `{}` if it carries none.
 *
 * Duck-typed for the same reason `statusOf` is — see above. `{}` rather than
 * `null` so that a caller reads one key and gets `undefined`, instead of having
 * to test for absence first and forgetting once.
 */
export function detailsOf(err: unknown): Readonly<Record<string, unknown>> {
  const details = (err as { details?: unknown } | null)?.details;
  return typeof details === "object" && details !== null && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : {};
}

/** Log it, then say it in one sentence a reader can act on. */
function errorFor(res: Response, text: string): Error {
  let said: unknown;
  let parsed = false;
  /* Everything the server sent except the sentence. An array or a bare string
     is not a record of fields, so it contributes nothing rather than being
     coerced into one. See `details` on `HttpError`. */
  let details: Record<string, unknown> = {};
  try {
    const body: unknown = JSON.parse(text);
    parsed = true;
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      const { error: _said, ...rest } = body as Record<string, unknown>;
      said = _said;
      details = rest;
    }
  } catch {
    /* Deliberately swallowed. Whether it parsed is the interesting fact, and it
       is captured in `parsed`; the parser's own message describes the first
       character of somebody else's HTML and is never worth showing anyone. */
  }

  logFailure(res, text, parsed);

  /* The server's own words when it gave them, and only then. See the header:
     an unparsed body is not ours to quote. */
  if (typeof said === "string" && said.trim() !== "") {
    return new HttpError(said, res.status, details);
  }

  return new HttpError(
    `${statusLabel(res)} — the server's reply wasn't JSON, so the browser console has more.`,
    res.status,
    details,
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
  /* A body that dies mid-read — a connection cut after the headers — rejects
     here, and it is a lost connection, not a bug: marked so
     `describeFetchFailure` can tell the two apart (lib/reader-facing.ts). */
  const text = await res.text().catch((e: unknown) => {
    throw e instanceof TypeError ? markUnreachable(e) : e;
  });

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
    throw new ReaderFacingError(
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
export async function apiFetch(
  input: string,
  init: RequestInit = {},
  /**
   * **The reader this request was made for**, when it must not go out as
   * anybody else — see `NotThisReader` below. `null`, which is every caller
   * that names nobody, means the reader this tab held as the call was made
   * (`apiFetchOwned` § *Bound when it is made*).
   */
  madeFor: string | null = null,
): Promise<Response> {
  return (await apiFetchOwned(input, init, madeFor)).response;
}

/**
 * **A request made for one reader was about to be sent as another, and was
 * not sent.** docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md § 2.
 *
 * Some requests are owed by a reader rather than by a page: the add page's
 * purpose session sends its last words after the page has gone, its
 * High-powered intent retries each second, and a job engine's POST can sit
 * waiting for its token. If the reader changes meanwhile (another tab signs in
 * as somebody else), the token that arrives is the new reader's, and reader
 * A's sentence is written onto reader B's article of the same slug. Resetting
 * the screen does not stop that; only a check where the token goes on does.
 *
 * So a caller that knows who a request is for passes them as `apiFetch`'s
 * third argument, and gets this instead of a response when the credential is
 * somebody else's. **A caller that names nobody gets the same, for the reader
 * the tab held as the call was made** (`apiFetchOwned` § *Bound when it is
 * made*), so naming a reader is only for a request made after its page or its
 * reader may have gone: a retry loop, a retirement flush, a module-level
 * service.
 *
 * **No HTTP status**, so `statusOf` answers `null`: nothing was asked, and a
 * caller that retries on a 404 or pauses on a 401 does neither.
 *
 * **It never fires for the reader's own request**, and `tokenOwner` on
 * `Credential` is why: the comparison is with the reader named by the very
 * session object the token came out of, and with nothing else. No token is
 * nobody's: the request is sent, and the server refuses it in its own words. A
 * token from a session that names nobody is not known to be another reader's,
 * so it is sent too. **Not `owner`**, the cache drawer, which falls back to
 * the reader this tab last saw: that is a second lookup, and it can be a
 * reader behind the token beside it.
 *
 * **A third argument and not a second function**, because of the tests: over a
 * hundred suites replace `apiFetch` in this module and leave the rest real, and
 * a sibling export would go round every one of them to the network (§ *A call
 * whose test intercepts `apiFetch`*, further down).
 */
export class NotThisReader extends Error {
  constructor() {
    super("This was for another account, so it was not sent.");
    this.name = "NotThisReader";
  }
}

/** Whether a token is known to belong to somebody other than `madeFor`. */
function notTheirs(tokenOwner: string | null, madeFor: string | null): boolean {
  return madeFor !== null && tokenOwner !== null && tokenOwner !== madeFor;
}

/**
 * `apiFetch`, and **whose session actually answered** — the owner of the
 * credential the returned response was sent with, the retry's when there was
 * one.
 *
 * For the article preload (prefetch-article.ts), which holds a response for
 * later and must hand it only to the same reader. Asking `accessToken()` again
 * beside the request would be the cross-account race the comment on `owner`
 * below describes: two lookups a moment apart can straddle a sign-in, and B's
 * article would be filed as A's. GPT Sol's P0 on
 * docs/plans/261003d-preload-recent-shelf-articles.md.
 *
 * **And every write is counted here, sent and finished** (writes.ts), which is
 * what tells a held read it may have gone stale.
 */
export async function apiFetchOwned(
  input: string,
  init: RequestInit = {},
  madeFor: string | null = null,
): Promise<Owned> {
  /**
   * **Bound when it is made.** A caller that names nobody is making the
   * request for whoever this tab holds right now, so that reader is read here,
   * synchronously, before anything is awaited: the token lookup below can wait
   * across a change of account, and what it answers with is then the next
   * reader's. `heldReader()` is what the SDK last told this tab, and it is
   * the same answer the screen was drawn from: `useSession` and this file
   * both read lib/session.ts, which makes the one subscription. So the
   * reader bound here is the reader whose screen made the call.
   *
   * **Nobody is not a reader.** Before the SDK has said anything, or signed
   * out, this is `null` and the request is unfenced, as it always was: a
   * request made by nobody and sent as the reader who then signed in carries
   * nobody else's words.
   *
   * A named reader is believed over the tab: the callers that name one are
   * the ones whose request is made long after the reader's gesture.
   * docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md.
   */
  const boundTo = madeFor ?? heldReader();
  noteRequest(input, init.method);
  try {
    return await sendOwned(input, init, boundTo);
  } finally {
    noteRequest(input, init.method);
  }
}

/** A response, and the reader whose credential it was sent with. */
export interface Owned {
  response: Response;
  owner: string | null;
}

async function sendOwned(
  input: string,
  init: RequestInit,
  madeFor: string | null,
): Promise<Owned> {
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
    /* A `TypeError` out of `fetch` itself is the transport failing, and this is
       the one place that knows it came from `fetch` rather than from a bug —
       marked for `describeFetchFailure` (lib/reader-facing.ts). An abort is not
       a lost connection and is left alone. */
    return fetch(input, { ...init, headers }).catch((e: unknown) => {
      throw e instanceof TypeError ? markUnreachable(e) : e;
    });
  };

  /**
   * **The token, and whose it is, out of the same answer.**
   *
   * Every cache read and every cache write below used to call `lastKnownUser()`
   * at the moment it ran — which is *after* the round trip. A direct A→B sign-in
   * (`rememberUser(B)` with no `forgetUser(A)`, because that only runs on a null
   * session) landing inside that window put **A's response into B's partition**,
   * and from there onto B's screen. Harmless-ish while the cache was read only
   * when the network was gone; the shelf now reads it on every repeat visit, so
   * it is a wrong reader's titles rather than a rare offline oddity.
   *
   * Capturing it before the request instead was the obvious repair and was still
   * not right, which is GPT Sol's second finding and a better rule than the one
   * it replaced: **the drawer belongs to whoever's token the server is about to
   * check**, so the id has to come out of the same session object as the token
   * rather than from a second lookup that can have moved on. `accessToken`
   * returns the pair for that reason. See § Stage 5 of
   * docs/plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md,
   * 2026-09-03.
   */
  const { token, owner, tokenOwner } = await accessToken();
  /* Here and not before the lookup: a lookup that was waiting while the
     reader changed answers with the new reader's token (`NotThisReader`). */
  if (notTheirs(tokenOwner, madeFor)) {
    /* Said where a bug report can see it: to the caller this is one more
       failed request, and nothing else would tell it from the network. */
    recordLog({
      kind: "api",
      outcome: "not-sent",
      method: (init.method ?? "GET").toUpperCase(),
      path: input,
      status: null,
      ms: null,
      vercelId: null,
      bytes: null,
      contentType: null,
      error: "NotThisReader",
    });
    throw new NotThisReader();
  }
  /**
   * **The queue place, taken before the request goes out.**
   *
   * Which of two answers to the same question is fresher has to be decided by
   * the order they were *asked* in, and the only place that order exists is
   * here, before `send`. See `reserveTicket` in
   * [offline-store.ts](./offline-store.js).
   *
   * **After the token, not alongside it**, which costs one IndexedDB round trip
   * on a cacheable GET. Reserving concurrently would need the owner before
   * `accessToken()` has answered — a second `lastKnownUser()` lookup, which is
   * precisely the cross-account race the comment above describes having fixed.
   * GPT Sol's F12.
   */
  const ticket = await ticketFor(input, init, owner);
  const first = await attempt(input, init, () => send(token), owner);
  if (first.status !== 401) return { response: saving(input, init, first, owner, ticket), owner };

  /* **Nobody was signed in, so there is nothing to refresh.** Without this the
     sign-in screen's own requests would each provoke a pointless refresh call,
     and — worse — `refreshSession()` on a signed-out client is a shape this
     code then has to guess at. A 401 for an anonymous request is not a race, it
     is the correct answer. */
  if (!token) return { response: first, owner };

  /* One refresh, one retry. Not a loop: if a fresh token is also refused then
     the answer really is no, and a client that keeps asking turns a refusal
     into a denial-of-service against our own server.
     The `catch` is not decoration — a refresh is a network call, and a throw
     here would replace a perfectly good 401 (which callers know how to report)
     with a `TypeError` about `fetch`. */
  let refreshed: string | undefined;
  /* The refresh answers with a whole session, so the retry's drawer comes from
     that one rather than from the session the first attempt used. */
  let refreshedOwner = owner;
  let refreshedTokenOwner: string | null = null;
  try {
    /* Offline this cannot succeed, and the SDK will spend around twenty-five
       seconds finding that out — see `accessToken` below. A 401 we already have
       is a better answer than the same 401 half a minute later. */
    if (!probablyOnline()) return { response: first, owner };
    const { data } = await supabase.auth.refreshSession();
    refreshed = data?.session?.access_token;
    refreshedOwner = data?.session?.user?.id ?? owner;
    refreshedTokenOwner = tokenOwnerOf(data?.session);
  } catch {
    return { response: first, owner };
  }
  if (!refreshed) return { response: first, owner };
  /* **The retry is the same request, so it goes out as the same reader or not
     at all**, for every caller. A refresh that comes back as somebody else is
     a change of account that landed between the two attempts, and sending
     reader A's write again with reader B's token is the thing `NotThisReader`
     exists to stop. The first 401 is the answer. An owner nobody knows is not
     a different one. Plan 261006e § 2. */
  if (notTheirs(refreshedTokenOwner, tokenOwner) || notTheirs(refreshedTokenOwner, madeFor)) {
    return { response: first, owner };
  }
  /* **A fresh ticket, not the one above.** The retry is a newly issued request:
     it may belong to a refreshed owner, and it has to see any mutation that
     happened between the two attempts. Reusing the first ticket would let the
     retry commit a body from before an invalidation that ran while we were
     refreshing. */
  const retryTicket = await ticketFor(input, init, refreshedOwner);
  return {
    response: saving(
      input,
      init,
      await attempt(input, init, () => send(refreshed), refreshedOwner),
      refreshedOwner,
      retryTicket,
    ),
    owner: refreshedOwner,
  };
}

/**
 * A place in the cache's queue for this request, or `null` if it will not be
 * cached anyway.
 *
 * The two conditions are `saving`'s own, asked early so that a request that
 * could never be kept — a POST, an uncacheable path — does not pay for a
 * reservation. What is cached is still decided in `saving`; this only declines
 * to reserve for what plainly is not.
 */
async function ticketFor(
  input: string,
  init: RequestInit,
  owner: string | null,
): Promise<Ticket | null> {
  if ((init.method ?? "GET").toUpperCase() !== "GET") return null;
  if (!cacheable(input)) return null;
  return await reserveTicket(input, owner);
}

/**
 * `apiFetch`, and the response only if the server said yes.
 *
 *     await fetchOk(`/api/comments/${slug}/${id}`, { method: "DELETE" });
 *
 * The same two lines as `const r = await apiFetch(…); if (!r.ok) throw await
 * failure(r);` — and the point is not the line. **It makes asking and checking
 * one act**, so the failure it exists to stop cannot be reached by forgetting.
 * That failure has already happened twice here, from the same omission in two
 * hooks: a DELETE that 500'd took the row off the screen and said nothing, and
 * the reader found it back after a reload (`forget` in useComments.ts, `forget`
 * in useSearch.ts). `readJson` has that property for a call whose body you go on
 * to read; this is it for the calls whose body you do not.
 *
 * ## What it is not for
 *
 * - **A response you are about to stream.** `if (!r.ok || !r.body)` asks a
 *   second question, and a stream can end by simply stopping, which looks
 *   exactly like finishing — a different failure from a status code, and not one
 *   this helper knows anything about. useComments.ts § `answer`, useSearch.ts §
 *   `run` and chat/effects.ts keep their own check for that reason.
 * - **A status that is an answer rather than a failure.** A 404 from
 *   `/api/ideas/:slug` means nobody has asked for ideas yet; a 409 from the chat
 *   stream means somebody else is already answering; `/api/public/…` answers 404
 *   for a piece that is simply not shared. Those callers read the status
 *   *before* deciding, and throwing there would report an ordinary state as a
 *   fault. useIdeas.ts, useSummaries.ts, useGlossary.ts, public-api.ts,
 *   App.tsx.
 * - **A fetch that is not ours.** `apiFetch` refuses anything outside `/api/`,
 *   so the Wikipedia summary in link-facts.ts and the Supabase settings probe in
 *   lib/supabase.ts cannot come through here — and both of them treat a non-2xx
 *   as *nothing to show*, which is not a thing to tell anybody about.
 * - **A call whose test intercepts `apiFetch`.** This one is not about the
 *   request at all, and it is the reason `writeThread` in chat/effects.ts is
 *   still hand-rolled after a review asked why. A suite that mocks this module
 *   with `importActual` and overrides `apiFetch` does not reach the `apiFetch`
 *   that `fetchOk` calls, because that one is resolved inside the module — so
 *   the writes it counts stop arriving and it goes red for a reason unrelated to
 *   what it tests. Production behaviour is identical; the seam moves.
 *
 * Worth keeping in front of a `readJson` that reads the body afterwards, rather
 * than leaving `readJson` to make the same check: `failure` tolerates a body
 * that dies mid-read and `readJson` does not, so a 500 on a cut connection keeps
 * its status message instead of surfacing as a `TypeError` about the network.
 */
export async function fetchOk(
  input: string,
  init: RequestInit = {},
  /** As `apiFetch`'s: the reader a request made late is for. */
  madeFor: string | null = null,
): Promise<Response> {
  const res = await apiFetch(input, init, madeFor);
  if (!res.ok) throw await failure(res);
  return res;
}

/**
 * Run a request, and fall back to a saved copy if the *transport* failed.
 *
 * The distinction this function exists to hold is between **no answer** and
 * **an answer you did not want**. A `TypeError` from `fetch` means the request
 * never happened — no network, no DNS, a dead Wi-Fi captive portal — and a copy
 * we saved earlier is strictly better than an error. A 401, a 404 or a 500 is
 * the server speaking, and dressing an answer up as a network failure so we can
 * show older data is how a reader ends up trusting something untrue.
 *
 * Two more things are deliberately not fallbacks:
 *
 * - **An abort.** A caller that cancelled its own request is not offline, and
 *   several hooks here cancel on every keystroke. Answering those from cache
 *   would resurrect requests the caller had already decided it did not want.
 * - **Anything that is not a GET.** A failed write has not happened, and the
 *   reader has to be told. See
 *   docs/plans/260827r-offline-reading.md for why there
 *   is no write queue.
 */
async function attempt(
  input: string,
  init: RequestInit,
  run: () => Promise<Response>,
  /** Whose cache to look in, from when the request went out — see `apiFetch`. */
  owner: string | null,
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const started = Date.now();
  try {
    const res = await run();
    /* A reply of any status means the server was reachable — a 404 is not a
       network problem, and treating it as one would leave the strip saying
       "no connection" to somebody whose connection is fine. */
    noteReachedServer();
    /* **Every reply, not only the bad ones.** "Recent API calls" is a timeline,
       and a timeline made only of failures cannot show that the three requests
       before the broken one were fine — which is most of what makes it worth
       reading. `x-vercel-id` is read here because this is where a `Response` is
       first in hand: it is the request id Vercel logs under, it is readable
       because these are same-origin requests, and it is the only thing in this
       repo that ties a browser to a server log line. */
    recordLog({
      kind: "api",
      outcome: "response",
      method,
      path: input,
      status: res.status,
      ms: Date.now() - started,
      vercelId: header(res, "x-vercel-id"),
      bytes: null,
      contentType: null,
      error: null,
    });
    return res;
  } catch (e) {
    /* The transport failed — there is no status, and there never will be one
       for this request. Its `name` and nothing else: a browser's network
       message is its own words (*"Failed to fetch"*, *"NetworkError when
       attempting to fetch resource"*), and the buffer refuses a sentence
       anyway. */
    recordLog({
      kind: "api",
      outcome: "transport-failed",
      method,
      path: input,
      status: null,
      ms: Date.now() - started,
      vercelId: null,
      bytes: null,
      contentType: null,
      error: e instanceof Error ? e.name : "Error",
    });
    if (method !== "GET") throw e;
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    if (init.signal?.aborted) throw e;
    if (!cacheable(input)) throw e;

    const saved = await readCached(input, owner);
    if (!saved) {
      noteNoConnection();
      throw e;
    }
    noteServedCopy(saved.savedAt);

    const body = input.split("?")[0] === "/api/library"
      ? await onlyWhatWeHave(saved.body, owner)
      : saved.body;

    /* A real `Response`, so every caller downstream — `readJson`, the hooks,
       the panels — carries on unchanged. The two headers are how the UI can
       say *this is a copy, and this is when we got it* without any of those
       call sites having to know about the cache. */
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-spideryarn-offline": "copy",
        "x-spideryarn-saved-at": String(saved.savedAt),
      },
    });
  }
}

/**
 * Keep a good answer, and hand the caller back an untouched one.
 *
 * `res.clone()` is the load-bearing part: a `Response` body can be read exactly
 * once, so reading it here to save it would hand every caller an empty stream —
 * a bug that would look like the server returning nothing.
 *
 * Saving is fire-and-forget on purpose. It is bookkeeping, and a reader waiting
 * for their article should not also wait for a database write; a quota error
 * must cost them nothing at all.
 */
function saving(
  input: string,
  init: RequestInit,
  res: Response,
  /** Whose cache to write, from when the request went out — see `apiFetch`. */
  owner: string | null,
  /** This request's place in that reader's queue, reserved before it went out. */
  ticket: Ticket | null,
): Response {
  if ((init.method ?? "GET").toUpperCase() !== "GET") {
    /* **A successful write makes our copy of that thing wrong.** Deleting a
       chat thread and then going offline must not bring the thread back, which
       is what a cache kept past the delete would do — and it would look exactly
       like the delete having failed. See `invalidate`. */
    if (res.ok && !leavesCachedResourceCurrent(input)) {
      const prefix = resourceOf(input);
      if (owner && prefix) void invalidate(prefix, owner);
      /* **One write makes two of our copies wrong, and only one of them is
         named in the URL.**

         `PATCH /api/library/<slug>` carries the reader's "why you're reading
         this one", which is half of what `GET /api/reader?slug=<slug>` answers
         — so a purpose saved on the metadata page left a cached reader record
         still describing the old one. Offline, `apiFetch` then serves that
         stale body as a synthetic 200 and nothing on screen looks wrong: the
         profile panel presents last week's sentence as current. (It also let
         `hasProfile` go on saying `false` to a reader who had just written
         their first purpose, hiding every "Use your profile" tick from them —
         until that checkbox was removed on 2026-09-13.)

         Not fixable inside `resourceOf`, which maps a URL to *its own*
         resource and is right to: this is a second resource the write affects,
         and it has to be named. GPT Sol's review of the built code,
         2026-08-30; docs/plans/260830c-profile-panel.md. */
      if (owner && prefix.startsWith("/api/library/")) void invalidate("/api/reader", owner);
      /* **A tag edit is the same shape, twice over** (plan 261003d, GPT Sol's
         plan review 7): its URL names neither the shelf listing that carries
         every card's tags nor the Metadata page that shows this article's. */
      const tagged = /^\/api\/library\/([^/?]+)\/tags$/.exec(input.split("?")[0] ?? input);
      if (owner && tagged) {
        void invalidate("/api/library", owner);
        void invalidate(`/api/metadata/${tagged[1]}`, owner);
      }
    }
    return res;
  }
  if (!res.ok || res.status !== 200) return res;
  if (!cacheable(input)) return res;
  /* Through `header`, which cannot throw — the rule this file already learned
     once and this line was outside. `saving` is called *after* `attempt`
     returns, so a throw here is not caught anywhere and comes out of `apiFetch`
     as a failed request; a hand-built stub `Response` with no `headers` is
     enough to do it, which is how four tests in tests/quiz-mark-stream.test.tsx
     went red the moment `/api/quiz/` joined `CACHEABLE` and this branch became
     reachable for them. See § A response header, or `null`. */
  if (header(res, "x-spideryarn-offline") === "copy") return res;
  /* Only JSON, and the media type parsed rather than searched. An HTML body
     with a 200 is Vercel's SPA fallback or a captive portal's sign-in page, and
     freezing either into the cache would poison the article rather than save
     it. A substring test would also have to be right about
     `application/json; charset=utf-8`, so it is split on `;` instead. */
  if (!isJson(res)) return res;

  if (!owner) return res;

  try {
    /* `clone()` before anything reads the body. A `Response` body can be read
       once, so saving the real one would hand the caller an empty stream — a
       bug that looks exactly like the server returning nothing. `clone()` can
       itself throw if the body is already disturbed, hence the `try`. */
    const copy = res.clone();
    void copy
      .json()
      .then(async (body) => {
        /* **"Not made yet" is not kept** — the `200 null` the three
           always-mounted reads ask for (`NONE_YET_AS_NULL_HEADER`, src/types.ts).
           A copy is filed under reader and URL and replayed as a 200 whatever
           the request's headers, so a kept `null` would reach, offline, a tab
           opened before the deploy, which never asked for one and reads
           `loaded.quiz` off it. Returning here is what the 404 it replaces did
           (`res.status !== 200`, above): nothing written, and an earlier copy
           of a real artefact neither replaced nor thrown away. GPT Sol's F1 on
           plan 261006g. */
        if (body === null && NONE_YET_AS_NULL.test(input)) return;
        /* "Could not read" must not replace a complete copy of this batch.
           Leave the existing record untouched: copying its answers into this
           newer ticket could overwrite a full read that commits meanwhile.
           The live response remains null for useQuizRead to handle. */
        if (/^\/api\/quiz\/[^/?]+$/.test(input)) {
          const quiz = body as Partial<QuizResponse> | null;
          if (quiz?.attempts === null && typeof quiz.quiz?.batchId === "string") {
            const previous = (await readCached(input, owner))?.body as Partial<QuizResponse> | undefined;
            if (
              previous?.quiz?.batchId === quiz.quiz.batchId &&
              Array.isArray(previous.attempts)
            ) return;
          }
        }
        await writeCached(input, body, ticket, slugOf(input));
      })
      .catch(() => {
        /* A body that dies after its headers arrived. Nothing to save, and the
           previous copy — if any — is left alone rather than replaced by half
           a document. */
      });
  } catch {
    /* Not worth failing a good response over. */
  }
  return res;
}

/** The three reads that may answer `200 null` for "not made yet" — see `saving`. */
const NONE_YET_AS_NULL = /^\/api\/(?:quiz|crossrefs|citations)\/[^/?]+$/;

/** `application/json`, whatever parameters follow it. */
function isJson(res: Response): boolean {
  return mediaType(res) === "application/json";
}

/**
 * Which article a request belongs to, or `""`.
 *
 * Eviction works in whole articles, so every cached record has to say which one
 * it is part of — see `evict` in [offline-store.ts](./offline-store.ts). The
 * shelf and the reader profile belong to no article and get `""`.
 */
function slugOf(input: string): string {
  const path = input.split("?")[0] ?? input;
  const parts = path.split("/").filter(Boolean); // ["api", "glossary", "<slug>", …]
  if (parts[0] !== "api" || parts.length < 3) return "";
  return decodeURIComponent(parts[2] ?? "");
}

/**
 * Which reads are worth keeping.
 *
 * Everything the reader already paid a model for, plus the article and the
 * shelf — Greg's ask was that *"stuff that has already been computed (e.g.
 * existing ToC, glossary, summary, ideas, chat history, etc etc)"* survive
 * losing the connection. The ToC needs no entry of its own: it arrives inside
 * the article payload — and since 2026-08-31 so does everything summary mode
 * draws, which is why there is no `/api/summary/` here any more
 * (docs/plans/260831s-gist-only-summaries.md). Cached responses under that key are
 * unreachable and expire through ordinary eviction.
 *
 * **Every per-article artefact GET is here**, and until 2026-09-02 four of them
 * were not: `/api/arc/`, `/api/quiz/`, `/api/sketch/` and `/api/timeline/` each
 * had a route and a hook and no line here, so the offline store kept a quotes
 * list and dropped a timeline for no stated reason. Nothing paired the list
 * with the routes; `tests/cacheable-covers-artefact-routes.test.ts` now does,
 * deriving the routes from `SHAPE` and src/routes.ts rather than retyping them.
 * docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md § T0.1.
 *
 * What is missing is as deliberate. `/api/jobs` describes work in flight and a
 * stale copy of it would be a lie about the present; `/api/library/search`
 * spends a model call per query, so a cached answer to one question would be
 * served for a different one; `/api/models` is configuration nobody reads
 * offline.
 *
 * And a fourth omission, which is a **decision** rather than a policy:
 * `/api/referee/criteria/:slug` and `/api/referee/claims/:slug` are stored
 * reads a referee would want offline, and they are left out because their paths
 * are nested one segment deeper than every other artefact's. `slugOf` reads
 * path segment 3, so it would file them under the slug `"criteria"`, and
 * `resourceOf` would map `POST /api/referee/criteria/:slug` to
 * `/api/referee/criteria` and invalidate every article's criteria at once.
 * Caching them means both of those growing a route-aware case, which is a
 * follow-up rather than a line here — and the derived test asserts their
 * absence explicitly, so this stays a decision somebody made rather than a gap
 * the test quietly defined out of scope.
 */
const CACHEABLE = [
  "/api/article/",
  "/api/arc/",
  "/api/glossary/",
  "/api/ideas/",
  "/api/quotes/",
  "/api/timeline/",
  "/api/relations/",
  "/api/quiz/",
  /* Here with the route rather than with the panel, as `/api/debate/` is: the
     derived test asks for it the moment the route exists. */
  "/api/faq/",
  /* With the route rather than with the panel, as `/api/faq/` is —
     docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md. */
  "/api/skim/",
  /* With the route, as `/api/faq/` is: the owner's offline cache (Sol F1) —
     docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md. */
  "/api/crossrefs/",
  /* With the route, as `/api/faq/` is —
     docs/plans/260930i-simple-summaries-eli15-sub-mode.md. */
  "/api/simple/",
  "/api/sketch/",
  /* **The artefact, and the plates' bytes ride along.** A URL under this prefix
     is either `/api/illustrated/<slug>` — JSON, cached like its neighbours — or
     `/api/illustrated/<slug>/<hash>.jpeg`, which `apiFetch` never fetches: the
     panel pulls a plate through `apiFetch` and makes a blob URL from it
     (src/web/IllustratedView.tsx), and only 200 JSON responses are written to
     the offline store. So the prefix is one line and covers both.
     tests/cacheable-covers-artefact-routes.test.ts derives this list. */
  "/api/illustrated/",
  /* **The one artefact whose offline copy is worth more than its neighbours',
     and the one that costs most to lose.** It is up to $0.27 a run, the rows
     link out to pages a reader will want to open, and it is the only artefact
     here that will not simply be the same next time — the web moves. This line
     is the second and last thing the debate step touches in `src/web/`, and it
     is here rather than with the panel because the derived test asks for it the
     moment the route exists. */
  "/api/debate/",
  "/api/citations/",
  "/api/metadata/",
  "/api/tweets/",
  "/api/chat/",
  "/api/comments/",
  "/api/search/",
  "/api/reader",
];

/**
 * **One path under a kept prefix that is never kept: a private link's state.**
 *
 * `GET /api/article/<slug>/share-link` begins `/api/article/` and answers with
 * the link's key (plan 261005e). Kept, the key would sit in this browser's
 * IndexedDB, and with no connection the owner's card would draw a link from a
 * copy when the link may have been turned off since. So it is neither written
 * nor read back: offline, the request fails and the card says it could not
 * check. The server marks the answer `no-store` for the same reason.
 */
const NEVER_KEPT = /^\/api\/article\/[^/]+\/share-link$/;

function cacheable(input: string): boolean {
  const path = input.split("?")[0] ?? input;
  if (path === "/api/library") return true;
  if (NEVER_KEPT.test(path)) return false;
  return CACHEABLE.some((prefix) => path.startsWith(prefix));
}

/**
 * **The writes that leave our copy still correct**, so that answering a
 * question does not throw away the questions.
 *
 * A non-GET is assumed to have changed the thing it names, which is right for
 * every route but one: `POST /api/quiz/<slug>/mark` sends one answer and
 * streams the marking back. **It changes nothing about the questions**, and
 * the questions are what a reader with no network needs from the copy.
 *
 * **Since 2026-10-05 it does change what `GET /api/quiz/<slug>` answers**: a
 * mark that finishes is stored, and the read returns it under `attempts`
 * (plan 261005b). Until then this comment said the copy was "still current"
 * after a mark, and it was. The exemption stays anyway, because the two ways
 * of being wrong are not equal: throwing the copy away here happens when the
 * response *headers* arrive, before anybody knows whether the mark will
 * finish — so a mark that then failed would have cost the reader every
 * question for the sake of an answer that was never stored. Instead the copy
 * is kept and **brought up to date by a read**: `useQuiz.mark` reads the quiz
 * again after a mark the server said it stored, and a successful GET rewrites
 * the copy with the answer in it. In between, the copy is one answer behind,
 * which is the same thing a second device is.
 *
 * Marking also makes a model call, whose spend goes through the request's
 * collector to an `ai_calls` ledger row; nothing the offline store holds is
 * affected by that. The first version of this exemption was reviewed by GPT
 * Sol, 2026-09-02: docs/plans/260902o-adding-a-mode-wave1-a-code-review-sol.md § 3;
 * this one in docs/plans/261005b-quiz-answers-plan-review-sol.md, F1.
 *
 * Exempted here rather than inside `resourceOf`, which answers a different
 * question — *which* resource a URL is about — and would still be right if it
 * answered it for this one.
 *
 * Exact, anchored patterns, and a list so that a second one is a line: the same
 * last segment on `PATCH /api/comments/<slug>/<id>/mark` is a real write — the
 * referee's placement on a criterion — and must keep invalidating.
 * tests/api-fetch-offline.test.ts § marking an answer keeps the quiz it did not
 * change asserts both directions.
 */
const LEAVE_CACHED_RESOURCE_CURRENT = [/^\/api\/quiz\/[^/]+\/mark$/];

function leavesCachedResourceCurrent(input: string): boolean {
  const path = input.split("?")[0] ?? input;
  return LEAVE_CACHED_RESOURCE_CURRENT.some((shape) => shape.test(path));
}

/**
 * The resource a mutation touches, as a URL prefix — or `""` if we cannot tell.
 *
 * `POST /api/chat/<slug>` and `DELETE /api/chat/<slug>/<threadId>` both make our
 * copy of `GET /api/chat/<slug>` wrong, so both map to `/api/chat/<slug>`. The
 * two-segment paths (`/api/reader`) map to themselves.
 */
function resourceOf(input: string): string {
  const path = input.split("?")[0] ?? input;
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "api") return "";
  if (parts.length === 2) return `/api/${parts[1]}`;
  if (parts.length < 3) return "";
  return `/api/${parts[1]}/${parts[2]}`;
}

/**
 * The shelf, less every article we could not actually open.
 *
 * **A library page that lists articles it cannot open is worse than a short
 * one.** Offline, every card is a promise, and one that opens to an error is a
 * promise broken at the moment the reader is least able to do anything about
 * it. So the cached shelf is filtered through what is really in the cache —
 * derived by asking the database, never from a remembered flag, because the
 * cache evicts on its own schedule and a flag would go on saying yes.
 *
 * **The envelope is kept.** `GET /api/library` sends `{ articles: [...] }`, and
 * `readJson` only parses — so everything downstream reads `.articles` off this
 * object. Unwrapping to a bare list here would hand the shelf a shape no
 * caller knows. This filter got that backwards for a fortnight: it tested
 * `Array.isArray(body)` against a payload that has never been an array, so it
 * returned the shelf untouched every time and offline readers were offered
 * articles that could not open.
 * docs/postmortems/260903e-offline-shelf-filter-never-ran.md.
 *
 * Shape-tolerant on purpose: anything that is not an object carrying an
 * `articles` array is returned unchanged rather than emptied. Showing too much
 * is a disappointment; showing nothing looks like the shelf is gone.
 */
async function onlyWhatWeHave(body: unknown, user: string | null): Promise<unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
  const { articles } = body as { articles?: unknown };
  if (!Array.isArray(articles)) return body;
  const have = await cachedSlugs(user);
  return {
    ...body,
    articles: articles.filter((entry) => {
      const slug = (entry as { slug?: unknown } | null)?.slug;
      return typeof slug === "string" ? have.has(slug) : true;
    }),
  };
}

/**
 * Whether it is worth waiting on the network at all.
 *
 * `navigator.onLine` is famously unreliable in one direction — it says `true`
 * on a captive portal, and on a LAN with no route out — so it is never trusted
 * to mean *online*. It is trusted for the other direction only: when the
 * browser says there is no network interface at all, there is no network
 * interface at all, and a token refresh that would spend twenty-five seconds
 * discovering that should not be started.
 */
function probablyOnline(): boolean {
  try {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  } catch {
    return true;
  }
}

/**
 * The current access token, or `undefined`.
 *
 * `undefined` rather than a throw: an unauthenticated request should be refused
 * by the server, with the server's own message, rather than by a client-side
 * error the reader cannot act on. It also means the sign-in screen's own calls
 * do not need a special case.
 */
async function accessToken(): Promise<Credential> {
  /* **No network, no wait.** `getSession()` refreshes a token it thinks has
     expired, and offline that refresh is a retry loop the SDK bounds at its own
     thirty-second tick. Skipping it here is the difference between a reader
     seeing a saved copy at once and a reader watching nothing happen for
     twenty-five seconds and then being told their credentials are bad. */
  if (!probablyOnline()) return fromCache();

  /* Online, the same hang is still possible — a captive portal accepts the
     connection and never answers — so the wait has a deadline as well as a
     condition. The fallback is the token the SDK last told us about: possibly
     expired, in which case the server says 401 and the existing refresh-and-
     retry below handles it. Being refused quickly is recoverable. Hanging is
     not. */
  /* What this tab held as the lookup went out: see `sessionObserved` below. */
  const before = sessionRevision();
  return await Promise.race([
    supabase.auth.getSession().then((r) => {
      /* **The lookup knows something the tab does not.** It answered as a
         different reader from the one held: storage has moved on and the
         SDK's event has not arrived. Tell the store, so the screen redraws
         for the reader this token belongs to. The request that noticed is
         still refused by its caller's check, since it was made for the
         earlier reader. Not if an event arrived while this was out: then the
         tab has newer news than this answer. lib/session.ts § `sessionObserved`. */
      if (r.data.session) sessionObserved(r.data.session, before);
      return r;
    }).then((r) => ({
      token: r.data.session?.access_token,
      /* **Out of the same session object as the token**, so the two cannot
         disagree. `lastKnownUser()` behind it is for a session shape with no
         user on it, which the SDK does not produce and a test stub does. */
      owner: r.data.session?.user?.id ?? lastKnownUser(),
      tokenOwner: tokenOwnerOf(r.data.session),
    })),
    after(SESSION_DEADLINE_MS).then(fromCache),
  ]);
}

/**
 * A token and the reader it belongs to, which must travel together.
 *
 * Two lookups a moment apart can straddle an account switch, and then a
 * response is filed in the wrong reader's drawer. One type, so a caller cannot
 * take the token and go and ask somebody else who it is for.
 */
interface Credential {
  token: string | undefined;
  /** An id, never a token: it selects a drawer and authorises nothing. */
  owner: string | null;
  /**
   * **Whose the token is, said by the session it came out of**, or `null`
   * when that session named nobody or there is no token. Usually `owner`, and
   * kept apart from it because `owner` has a fallback (the reader this tab
   * last saw) that suits choosing a drawer and would make `NotThisReader`
   * refuse a reader's own request.
   */
  tokenOwner: string | null;
}

/**
 * The pair this tab last heard.
 *
 * Safe as a pair because the token is replaced in lib/session.ts before its
 * subscribers are told, and the subscriber at the bottom of this file calls
 * `rememberUser` in that same pass, so these two never disagree.
 */
function fromCache(): Credential {
  return { token: heldToken(), owner: lastKnownUser(), tokenOwner: heldReader() };
}

/**
 * How long a request will wait to be told which token to use.
 *
 * Long enough that an ordinary cold start — where the SDK is still reading
 * `localStorage` and settling — is never cut short, and short enough that a
 * reader does not sit looking at a blank panel wondering. It is a deadline on
 * *our* patience, not a timeout on the SDK: the refresh carries on, and the
 * next request gets the benefit of it.
 */
const SESSION_DEADLINE_MS = 1_500;

/**
 * A promise that resolves after `ms`.
 *
 * `unref`-free and deliberately not cancelled: the timer is a millisecond of
 * nothing in the worst case, and a cancellation path here would be more code
 * than the thing it saves.
 */
const after = (ms: number) => new Promise<void>((go) => setTimeout(go, ms));

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
 *
 * **Answers with a promise that settles when the request does, and never
 * rejects** — whether it was stored, refused, lost or never sent. Nobody may
 * wait on it before the page goes; it is for a page that turns out to survive
 * (an unmount, a bfcache restore) and has something to throw away once the
 * write has landed: src/web/useProfile.ts § `leaveProfile`. Most callers
 * ignore it.
 */
export function leavingFetch(
  input: string,
  init: RequestInit = {},
  /**
   * **The reader this write is for**, as `apiFetch`'s third argument. The
   * token below is the one this tab last saw, so nothing is sent when that is
   * known to be somebody else's, or when there is none: a write for a reader
   * has no use for no token. `null` is unfenced.
   */
  madeFor: string | null = null,
): Promise<void> {
  if (!input.startsWith("/api/")) return Promise.resolve();
  if (madeFor !== null && (heldToken() === undefined || notTheirs(heldReader(), madeFor))) {
    return Promise.resolve();
  }

  /* **Browsers cap the total body of all in-flight `keepalive` requests at
     about 64KiB, and reject over it.** None of the current callers — reader
     profile, reading time and comment drafts — comes close, but this function
     is generic and swallows its own failures by design, so a future caller
     sending something large would fail completely silently. Better to say so
     in the console than to be that silent. GPT Sol, 2026-08-27. */
  const method = (init.method ?? "GET").toUpperCase();
  const body = init.body;
  if (typeof body === "string" && body.length > KEEPALIVE_LIMIT) {
    console.error(
      `[api] not sending ${input} on page exit: ${body.length} bytes is over the ~${KEEPALIVE_LIMIT} keepalive budget.`,
    );
    /* Its own failure path, and its own outcome. A `pagehide` can be a bfcache
       suspend rather than a close, so the page — and this buffer — may well
       still be here afterwards; and a save that never left is exactly the sort
       of thing a reader files a report about half a minute later. */
    recordLog({
      kind: "api",
      outcome: "not-sent",
      method,
      path: input,
      status: null,
      ms: null,
      vercelId: null,
      bytes: body.length,
      contentType: null,
      error: null,
    });
    return Promise.resolve();
  }

  const headers = new Headers(init.headers);
  const token = heldToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  /* `keepalive` lets the request outlive the page. Deliberately unawaited: there
     is no one left to tell — but the buffer is not a person, and if the page
     turns out to survive (a bfcache suspend rather than a close) the row is
     there. */
  /* Counted like any other write, sent and finished (writes.ts): a purpose
     saved on the way out is a `PATCH /api/library/<slug>`, which may change
     what an article preload is holding. */
  noteRequest(input, method);
  return fetch(input, { ...init, headers, keepalive: true })
    .finally(() => noteRequest(input, method))
    .then(
      () => undefined,
      (e: unknown) => {
        recordLog({
          kind: "api",
          outcome: "transport-failed",
          method,
          path: input,
          status: null,
          ms: null,
          vercelId: null,
          bytes: null,
          contentType: null,
          error: e instanceof Error ? e.name : "Error",
        });
      },
    );
}

/** The browser's keepalive body budget, less a little for headers. */
const KEEPALIVE_LIMIT = 60 * 1024;

/**
 * **What this file does when the tab's session changes.**
 *
 * The token `leavingFetch` uses, and whose it is, are no longer kept here:
 * they are lib/session.ts § `heldToken` and `heldReader`, the one place in
 * the client that holds a session in a variable, so that the request fence
 * and the screen cannot hold different readers. Registered at import, so it
 * hears the first event.
 */
onSession((session) => {
  /* **Whose cache to read, kept beside the token and for the same reason.** A
     request needs to know which reader's copies to look in before it knows
     whether the network works, and asking the SDK would be the very wait this
     file just stopped doing. Note this is an id, never a token: it selects a
     drawer and authorises nothing.

     Signing out drops that reader's copies. Not the database — somebody else
     may share this iPad, and their saved articles are not ours to throw away. */
  const id = session?.user?.id ?? null;

  /* **And the same identity to the error tracker**, so a Sentry issue says who
     hit it. Here rather than inside src/web/monitoring.ts, and that placement
     is load-bearing rather than convenient — that module is in the entry chunk,
     so a `supabase` import from it would evaluate this file before Sentry is
     armed and undo the whole point of boot.tsx. Its doc comment has the rest.

     `null` on sign-out, deliberately: somebody else may pick this iPad up, and
     an email left on the scope would ride out on their error. */
  const signedIn = session?.user;
  setClientMonitoringUser(
    signedIn
      ? { id: signedIn.id, ...(signedIn.email !== undefined && { email: signedIn.email }) }
      : null,
  );

  if (id) {
    rememberUser(id);
  } else {
    const previous = lastKnownUser();
    rememberUser(null);
    if (previous) void forgetUser(previous);
  }
});
