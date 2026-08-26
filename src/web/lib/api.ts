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
 */

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
