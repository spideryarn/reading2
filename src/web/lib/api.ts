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
  writeCached,
} from "./offline-store.js";
import { noteNoConnection, noteReachedServer, noteServedCopy } from "../offline.js";
import { recordLog } from "../log-buffer.js";
import { setClientMonitoringUser } from "../monitoring.js";
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
export class HttpError extends Error {
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
  const first = await attempt(input, init, () => send(token));
  if (first.status !== 401) return saving(input, init, first);

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
    /* Offline this cannot succeed, and the SDK will spend around twenty-five
       seconds finding that out — see `accessToken` below. A 401 we already have
       is a better answer than the same 401 half a minute later. */
    if (!probablyOnline()) return first;
    const { data } = await supabase.auth.refreshSession();
    refreshed = data?.session?.access_token;
  } catch {
    return first;
  }
  if (!refreshed) return first;
  return saving(input, init, await attempt(input, init, () => send(refreshed)));
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
export async function fetchOk(input: string, init: RequestInit = {}): Promise<Response> {
  const res = await apiFetch(input, init);
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

    const user = lastKnownUser();
    const saved = await readCached(input, user);
    if (!saved) {
      noteNoConnection();
      throw e;
    }
    noteServedCopy(saved.savedAt);

    const body = input.split("?")[0] === "/api/library"
      ? await onlyWhatWeHave(saved.body, user)
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
function saving(input: string, init: RequestInit, res: Response): Response {
  if ((init.method ?? "GET").toUpperCase() !== "GET") {
    /* **A successful write makes our copy of that thing wrong.** Deleting a
       chat thread and then going offline must not bring the thread back, which
       is what a cache kept past the delete would do — and it would look exactly
       like the delete having failed. See `invalidate`. */
    if (res.ok && !leavesCachedResourceCurrent(input)) {
      const user = lastKnownUser();
      const prefix = resourceOf(input);
      if (user && prefix) void invalidate(prefix, user);
      /* **One write makes two of our copies wrong, and only one of them is
         named in the URL.**

         `PATCH /api/library/<slug>` carries the reader's "why you're reading
         this one", which is half of what `GET /api/reader?slug=<slug>` answers
         — so a purpose saved on the metadata page left a cached reader record
         still describing the old one. Offline, `apiFetch` then serves that
         stale body as a synthetic 200 and nothing on screen looks wrong: the
         profile panel presents last week's sentence as current, and
         `hasProfile` can go on saying `false` to a reader who has just written
         their first purpose, hiding every "Use your profile" tick from them.

         Not fixable inside `resourceOf`, which maps a URL to *its own*
         resource and is right to: this is a second resource the write affects,
         and it has to be named. GPT Sol's review of the built code,
         2026-08-30; docs/plans/260830c-profile-panel.md. */
      if (user && prefix.startsWith("/api/library/")) void invalidate("/api/reader", user);
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

  const user = lastKnownUser();
  if (!user) return res;

  try {
    /* `clone()` before anything reads the body. A `Response` body can be read
       once, so saving the real one would hand the caller an empty stream — a
       bug that looks exactly like the server returning nothing. `clone()` can
       itself throw if the body is already disturbed, hence the `try`. */
    const copy = res.clone();
    void copy
      .json()
      .then((body) => writeCached(input, body, user, slugOf(input)))
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
  "/api/quiz/",
  "/api/sketch/",
  "/api/metadata/",
  "/api/tweets/",
  "/api/chat/",
  "/api/comments/",
  "/api/search/",
  "/api/reader",
];

function cacheable(input: string): boolean {
  const path = input.split("?")[0] ?? input;
  if (path === "/api/library") return true;
  return CACHEABLE.some((prefix) => path.startsWith(prefix));
}

/**
 * **The writes that leave our copy still correct**, so that answering a
 * question does not throw away the questions.
 *
 * A non-GET is assumed to have changed the thing it names, which is right for
 * every route but one: `POST /api/quiz/<slug>/mark` sends one answer and
 * streams the marking back. **It stores no quiz state** — no attempt, no score,
 * no answer, no change to the questions — so `GET /api/quiz/<slug>` answers
 * exactly what it answered before and the cached copy is still current.
 *
 * **It is not literally a write that writes nothing**, which is what this used
 * to be called. Marking makes a model call, and that call's spend goes through
 * the request's collector to an `ai_calls` ledger row — the route says so
 * itself, of the article it attaches to *"every row this request writes"*.
 * Accounting is recorded; nothing the offline store holds is affected by it.
 * That distinction is the whole name: the test is not *did the server write*,
 * it is *did the thing we cached change*. GPT Sol, 2026-09-02:
 * docs/plans/260902o-adding-a-mode-wave1-a-code-review-sol.md § 3.
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
 * Shape-tolerant on purpose: if the payload is not what we expect, the whole
 * list is returned unfiltered rather than emptied. Showing too much is a
 * disappointment; showing nothing looks like the shelf is gone.
 */
async function onlyWhatWeHave(body: unknown, user: string | null): Promise<unknown> {
  if (!Array.isArray(body)) return body;
  const have = await cachedSlugs(user);
  return body.filter((entry) => {
    const slug = (entry as { slug?: unknown } | null)?.slug;
    return typeof slug === "string" ? have.has(slug) : true;
  });
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
async function accessToken(): Promise<string | undefined> {
  /* **No network, no wait.** `getSession()` refreshes a token it thinks has
     expired, and offline that refresh is a retry loop the SDK bounds at its own
     thirty-second tick. Skipping it here is the difference between a reader
     seeing a saved copy at once and a reader watching nothing happen for
     twenty-five seconds and then being told their credentials are bad. */
  if (!probablyOnline()) return cachedToken;

  /* Online, the same hang is still possible — a captive portal accepts the
     connection and never answers — so the wait has a deadline as well as a
     condition. The fallback is the token the SDK last told us about: possibly
     expired, in which case the server says 401 and the existing refresh-and-
     retry below handles it. Being refused quickly is recoverable. Hanging is
     not. */
  return await Promise.race([
    supabase.auth.getSession().then((r) => r.data.session?.access_token),
    after(SESSION_DEADLINE_MS).then(() => cachedToken),
  ]);
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
 */
export function leavingFetch(input: string, init: RequestInit = {}): void {
  if (!input.startsWith("/api/")) return;

  /* **Browsers cap the total body of all in-flight `keepalive` requests at
     about 64KiB, and reject over it.** Nothing here comes close — the only
     caller is the reader profile, capped near 1,500 characters — but this
     function is generic and swallows its own failures by design, so a future
     caller sending something large would fail completely silently. Better to
     say so in the console than to be that silent. GPT Sol, 2026-08-27. */
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
    return;
  }

  const headers = new Headers(init.headers);
  const token = cachedToken;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  /* `keepalive` lets the request outlive the page. Deliberately unawaited: there
     is no one left to tell — but the buffer is not a person, and if the page
     turns out to survive (a bfcache suspend rather than a close) the row is
     there. */
  void fetch(input, { ...init, headers, keepalive: true }).catch((e: unknown) => {
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
  });
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
