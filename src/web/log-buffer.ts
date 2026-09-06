/**
 * A bounded log of what the client just did, normally thrown away.
 *
 * Two hundred entries in a fixed ring. Nothing reads it, nothing sends it, and
 * almost every entry is overwritten unread — until a reader files a bug report
 * and ticks *Send extra diagnostics*, at which point the last two hundred rows
 * are the run-up to whatever they are complaining about.
 *
 * > perhaps we could add some logging library that stores local state
 * > ephemerally that normally just gets thrown away (or has a fixed FIFO
 * > length), but could be included in the error message as a rich log of what
 * > happened in the runup to the problem?
 * >
 * > — Greg, 2026-08-31
 *
 * The design, the libraries measured and rejected, and the evidence behind each
 * of the four rules below are in
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md
 * § The client log buffer.
 *
 * ## Why this is not a `console.*` interceptor
 *
 * Because **we write the log calls**, so the buffer is an allowlist by
 * construction: it contains what we decided to put in it and nothing else. A
 * console scraper collects what *other* code chose to print, and in this
 * codebase that is a leak with two names —
 * [`lib/api.ts`](lib/api.ts)'s `logFailure` prints 300 characters of the
 * server's response body, [`upload.ts`](upload.ts) prints 400 characters of an
 * upstream one. Both are named *by name* in [`monitoring.ts`](monitoring.ts) as
 * the reason Sentry breadcrumbs are locked off three separate ways. A scraper
 * behind a tick-box would be that decision undone through a side door.
 *
 * ## The four rules, each load-bearing
 *
 * 1. **Redact and truncate at write time.** Not on the way out. Redacting on
 *    the way out means the sensitive value sat in memory, live, for its whole
 *    life — strictly worse, and the OWASP logging guidance calls the other way
 *    round minimisation at the source. So `recordLog` is the only door and it
 *    does the work before anything is stored.
 * 2. **Never store a raw object, an `Error`, or a DOM node.** A retained
 *    reference keeps that object *and everything it reaches* alive until it is
 *    evicted, which for a DOM node is a detached subtree and for an `Error` is
 *    every closure its stack captured. Call sites extract the fields they need;
 *    what lands here is flat and already short. The types below enforce it —
 *    there is nowhere to put an object.
 * 3. **Named fields, never `Record<string, unknown>`.** The same argument
 *    `SAFE_PROPS` in [`monitoring-scrub.ts`](../monitoring-scrub.ts) makes: an
 *    allowlist drops the property nobody thought about, which is always the one
 *    that leaks. The key-name denylist below is a **second, redundant**
 *    mechanism — it cannot fire today, because no field in the union is called
 *    `token`, and that is exactly what a tripwire looks like before it goes
 *    off.
 * 4. **Lazy serialisation, eager redaction.** Plain redacted objects go in;
 *    `JSON.stringify` runs once, when the report is being built. Stringifying
 *    on every call would pay the cost on the hot path for entries that are
 *    almost all evicted unread — and `JSON.stringify` throws on a circular
 *    reference, from inside a `catch`, which is the failure
 *    [`src/log.ts`](../log.ts)'s `describe` already warns about. Hence the
 *    `try` in `serialiseLogBuffer`.
 *
 * ## Module state, the shape `offline.ts` already uses
 *
 * Module-level state and a narrow set of functions, like
 * [`offline.ts`](offline.ts). **No listener set and no `useSyncExternalStore`**:
 * nothing renders from this buffer and nothing should — a component that
 * re-rendered on every API call would be a performance bug wearing a
 * diagnostic's hat. If a panel ever needs to watch it, `offline.ts` is the
 * pattern to copy, whole.
 */

/**
 * The one import, and it is the closed vocabularies this file holds its two
 * name fields and its one header field to. Shared with the server on purpose:
 * `src/feedback-payload.ts` is what `POST /api/feedback` validates an arriving
 * report against, and a browser copy of the same list would be a second
 * allowlist with the looser one winning (tests/client-imports.test.ts § SHARED).
 */
import { safeDiagnosticName, safeVercelId } from "../feedback-payload.js";

/**
 * How many entries are kept. Two hundred covers minutes of ordinary reading and
 * the seconds before a reader reaches for the Feedback button, which is the
 * window that matters.
 */
export const LOG_BUFFER_CAPACITY = 200;

/**
 * The longest any single string may be. Everything stored here is a path, a
 * status or a media type — none of which is legitimately long — so this is a
 * backstop rather than a budget. An error's *name* never reaches it: a closed
 * vocabulary has already replaced anything unrecognised with `"Error"`.
 */
export const LOG_MAX_CHARS = 300;

/**
 * What became of a request.
 *
 * A closed vocabulary rather than free text, so a future reader of a report can
 * `filter` on it. `not-json` is the one worth explaining: a reply arrived, and
 * its body would not parse — in this app that is usually Vercel's single-page
 * fallback answering a request the API should have had, which is a completely
 * different bug from a 404 and used to be indistinguishable from one.
 */
export type ApiOutcome =
  /** A reply arrived, with a status. Any status, including a good one. */
  | "response"
  /** A reply arrived, its status was not OK, and its body parsed as JSON. */
  | "error-body"
  /** A reply arrived and its body would not parse. */
  | "not-json"
  /** `fetch` threw: no network, no DNS, a captive portal. There is no status. */
  | "transport-failed"
  /** We chose not to send it — `leavingFetch` over the keepalive budget. */
  | "not-sent";

/** One request to our own API. */
export interface ApiLogEntry {
  kind: "api";
  /** When, in epoch milliseconds. Stamped here, never by the caller. */
  at: number;
  outcome: ApiOutcome;
  /** `GET`, `POST`, … or `null` where only a `Response` was to hand. */
  method: string | null;
  /**
   * The path, **with the query string and fragment already removed** — see
   * `safePath`. This is the field the whole file is careful about.
   */
  path: string;
  status: number | null;
  /** How long it took, in milliseconds, where we timed it. */
  ms: number | null;
  /**
   * `x-vercel-id`, the request id Vercel logs under. Same-origin, so readable,
   * and it is the only thing in this repo that ties a browser to a server log
   * line. Greg's *"anything else that will help us correlate it with our Vercel
   * logs"*, answered.
   *
   * **The only field here whose value came off a response header**, so it is
   * held to its shape by `clean` at write time rather than on the way out; see
   * `safeVercelId`. Anything else that header contained is `null`.
   */
  vercelId: string | null;
  /** How many characters the reply body had. **Never any of them.** */
  bytes: number | null;
  /** The reply's media type, without parameters. */
  contentType: string | null;
  /**
   * The failure's `name` — `TypeError`, `AbortError` — from the same closed
   * vocabulary `name` below is held to. **Never its message**: a browser's
   * network message is its own words, and one of ours can be an article (see
   * `monitoring-scrub.ts`, which withholds a message for exactly this reason).
   */
  error: string | null;
}

/**
 * A stage of a PDF upload. Its own variant because
 * [`upload.ts`](upload.ts) uses `XMLHttpRequest` and never touches `apiFetch` —
 * the plan's claim that three seams saw every failure was wrong, and this is
 * one of the misses.
 */
export interface UploadLogEntry {
  kind: "upload";
  at: number;
  phase: "start" | "done" | "failed" | "aborted" | "transport-failed";
  /** What Storage actually meant, per `realStatus` in `upload.ts`. */
  status: number | null;
  /** The file's size in bytes. */
  bytes: number | null;
  ms: number | null;
}

/**
 * Where a caught client-side failure came from. Closed, and extended
 * deliberately — a free-text source is a free-text field.
 */
export type ClientErrorSource =
  /**
   * A React error boundary's `componentDidCatch` — a subtree was torn down.
   * There are two: [`AppBoundary.tsx`](AppBoundary.tsx) and the one inside
   * [`LazyPage.tsx`](LazyPage.tsx) that catches a route chunk failing to
   * arrive. Which of them is a Sentry tag, not a variant here.
   */
  | "boundary"
  /** `Tweets.tsx`, which catches its own failure and so reaches neither of the others. */
  | "tweets"
  /** `window.onerror` — a throw nothing caught. See `watchUncaughtErrors`. */
  | "window"
  /** `unhandledrejection` — a promise nobody was waiting on. */
  | "rejection";

/**
 * A failure the app caught itself.
 *
 * **There is no message field, and that is the decision rather than an
 * omission.** An `Error.message` in this codebase has four times turned out to
 * contain the article, and the one function allowed to decide whether a message
 * is provably ours is `authored()` in `monitoring-scrub.ts`, which is private on
 * purpose. When the diagnostics stage adds the shared `safeDiagnosticError()`
 * that plan calls for, a message can be admitted here through that and nothing
 * else — its name half already exists, as `safeDiagnosticName` in
 * [`feedback-payload.ts`](../feedback-payload.js). Until then the name, the
 * source and the timestamp are what a run-up needs: the throw itself is already
 * going to Sentry with its stack.
 */
export interface ClientErrorLogEntry {
  kind: "client-error";
  at: number;
  source: ClientErrorSource;
  /**
   * `Error.name`, **held to the closed vocabulary** in
   * [`feedback-payload.ts`](../feedback-payload.js) — `name` is writable, so it
   * is a value off a caller rather than a fact, and everything not on the list
   * is stored as `"Error"`.
   */
  name: string;
}

export type LogEntry = ApiLogEntry | UploadLogEntry | ClientErrorLogEntry;

/** What a call site hands in: an entry, less the timestamp the buffer stamps. */
export type LogInput =
  | Omit<ApiLogEntry, "at">
  | Omit<UploadLogEntry, "at">
  | Omit<ClientErrorLogEntry, "at">;

/**
 * Key names whose value is dropped whatever it is.
 *
 * Matched as a substring of the lower-cased key, so `accessToken`, `authHeader`
 * and `sessionId` all catch. It is a **second** mechanism: the field types
 * above are the first, and none of them is on this list, so in a correct
 * program this never fires. It is here because the day somebody widens the
 * union is the day the first mechanism stops being complete, and that day will
 * not announce itself.
 */
const DENIED_KEYS = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "auth",
  "credential",
  "cookie",
  "session",
] as const;

const REDACTED = "[redacted]";

/**
 * Fields that hold the *name* of a failure, and may hold nothing else.
 *
 * `error` and `name` are the two places a message could get in by a call site
 * passing `err.message` where `err.name` was meant — a one-word slip, and the
 * one-word slip is how an `Error.message` in this codebase has four times
 * turned out to contain the article. So the value is checked here rather than
 * trusted there, exactly as `safeEvent` checks an exception's `type` rather
 * than trusting whatever built it.
 *
 * It used to be a *shape* check — an identifier expression — and GPT Sol's
 * second review, 2026-08-31, was right that a shape is not a check here:
 * `Error.name` is writable, and `PROVIDER_BODY_MARKER` and
 * `reader_search_term` are both perfectly good identifiers. So both fields now
 * go through `safeDiagnosticName`, the **closed vocabulary** in
 * [`feedback-payload.ts`](../feedback-payload.js), which is the same list the
 * server holds an arriving report to. Anything not on it becomes `"Error"` —
 * reduced rather than dropped, because a failure that happened is worth a row
 * in the timeline even when its name is one we will not repeat.
 *
 * Found by the prose fixture in `tests/log-buffer.test.ts` going red, which is
 * what that test is for.
 */
const ERROR_NAME_FIELDS = new Set(["error", "name"]);

/* A pre-allocated fixed-capacity ring: `head` is where the next entry goes,
   `count` is how many are live. Overwrite in place, no allocation per write, no
   copying on overflow. Notably Sentry's own breadcrumb buffer is *not* one — it
   is `push` then `slice(-max)` on every add — and a real ring is both cheaper
   and easier to reason about. */
const ring: (LogEntry | undefined)[] = new Array<LogEntry | undefined>(LOG_BUFFER_CAPACITY);
let head = 0;
let count = 0;

/**
 * A path with nothing on it but the path.
 *
 * **The single most important function in this file.** `/api/library/search?q=…`
 * carries text the reader typed into a box, `?find=` carries more of it, and an
 * absolute URL carries an origin as well. This is the same leak class as
 * sending `location.href` — which the plan proposed, and which was killed for
 * exactly this — one layer down. Stripping it at the thirty call sites would be
 * stripping it twenty-nine times and forgetting once, so it happens here, where
 * no caller can skip it.
 *
 * Deliberately does not try to be clever about what a query parameter *is*. A
 * parameter added a year from now will not know about this file, and an
 * allowlist of safe parameter names is a list somebody has to keep.
 */
function safePath(raw: string): string {
  const withoutQuery = raw.split(/[?#]/)[0] ?? "";
  if (!withoutQuery.includes("://")) return withoutQuery;
  /* An absolute URL — `Response.url` is always one. Everything before the path
     is dropped too: for our own API the origin says nothing, and for anything
     else it is a host we have no business writing down. */
  try {
    return new URL(withoutQuery).pathname;
  } catch {
    /* Not parseable. Returning the raw string would be returning whatever this
       was, which is the one thing this function exists to refuse. */
    return "";
  }
}

/** Short enough that nothing here can hold a paragraph. */
function truncate(value: string): string {
  return value.length > LOG_MAX_CHARS ? `${value.slice(0, LOG_MAX_CHARS)}…` : value;
}

/**
 * The entry as it will be stored: strings shortened, denied keys dropped.
 *
 * Rebuilt key by key rather than mutated, the same way `safeEvent` rebuilds an
 * event, so what is stored is an object this function made. The cast is the
 * price of the redundant mechanism — a denied key cannot exist in `LogEntry`,
 * so writing `REDACTED` into one is by definition writing outside the type.
 */
function clean(entry: LogEntry): LogEntry {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (DENIED_KEYS.some((denied) => key.toLowerCase().includes(denied))) {
      out[key] = REDACTED;
      continue;
    }
    if (typeof value === "string") {
      if (key === "path") out[key] = truncate(safePath(value));
      else if (ERROR_NAME_FIELDS.has(key)) out[key] = safeDiagnosticName(value);
      /* **The one value in here that came off a response header.** `apiFetch`
         reads `x-vercel-id` and hands over whatever was in it, and rule 1 says
         a value is made safe on the way in rather than on the way out — a raw
         header held live in the ring for two hundred entries, and exposed by
         `serialiseLogBuffer`, is precisely what that rule refuses. The
         collector and the route check it again; those are redundancy and are
         meant to stay. */
      else if (key === "vercelId") out[key] = safeVercelId(value);
      else out[key] = truncate(value);
      continue;
    }
    /* Numbers, booleans and `null` pass. Anything else — an object, an `Error`,
       a DOM node — is refused rather than stored, because storing it by
       reference is rule 2's retention leak and stringifying it here would be
       rule 4's stringify on the hot path. The types make this unreachable; it
       is here because "unreachable" is a claim about today's callers. */
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    out[key] = REDACTED;
  }
  return out as unknown as LogEntry;
}

/**
 * Write one entry. **The only door into the buffer.**
 *
 * One narrow function rather than three, so the redaction, the truncation, the
 * path stripping and the timestamp happen once, in one place, for every seam
 * that ever records anything.
 *
 * It cannot throw. A diagnostic that can break the thing it is diagnosing is
 * worse than no diagnostic — the same rule the two `monitoring.ts` files keep.
 */
export function recordLog(input: LogInput): void {
  try {
    ring[head] = clean({ ...input, at: Date.now() } as LogEntry);
    head = (head + 1) % LOG_BUFFER_CAPACITY;
    if (count < LOG_BUFFER_CAPACITY) count += 1;
  } catch {
    /* Nothing to do and nobody to tell. */
  }
}

/**
 * A thrown value's `name`, and `"Error"` for everything else.
 *
 * `event.error` is whatever was thrown, which need not be an `Error` at all: a
 * string, a number, `null` on a cross-origin script failure, or an object whose
 * `name` getter throws. So the read is guarded and the answer is a constant
 * rather than a coercion — `String(thrown)` is exactly how an article ends up in
 * a diagnostic, and `clean` would only turn it back into `"Error"` one step
 * later anyway.
 *
 * **It is also the one way a boundary turns a caught value into a log name**,
 * which is why it is exported. React declares `componentDidCatch(error: Error,
 * …)` and the runtime does not enforce a word of it — the handler is handed the
 * thrown value unchanged, exactly as `window.onerror` is. So a boundary that
 * reads `.name` itself throws a *second* time, out of the handler, and there may
 * be nothing above it to catch that: the reader gets an empty page instead of
 * the fallback the boundary exists to draw. Two of the three boundaries had
 * hand-rolled a guard of their own and the third had none, because this one was
 * private and nothing outside this file could point at it. No call site should
 * read `.name` off a caught value again. Sol, 2026-09-06, F15;
 * tests/every-boundary-contains-a-throw-that-is-not-an-error.test.tsx and
 * tests/no-boundary-reads-the-caught-value.test.ts.
 */
export function nameOfThrown(thrown: unknown): string {
  try {
    if (typeof thrown === "object" && thrown !== null) {
      /* `safeDiagnosticName` and not the raw string: `name` is writable, so
         `{ name: "PROVIDER_BODY_MARKER" }` is a thing a caller can throw and
         `err.name = "reader_search_term"` is a thing a caller can assign.
         `clean` would reduce both a step later; doing it here as well makes
         this function's own contract true rather than conditional on the door
         it happens to be walked through. */
      return safeDiagnosticName((thrown as { name?: unknown }).name);
    }
  } catch {
    /* A getter threw. There is nothing to learn from it. */
  }
  return "Error";
}

/**
 * Record the throws and the rejections nothing caught.
 *
 * Called once, from the client entry point, beside `watchConnection` — the
 * shape [`offline.ts`](offline.js) establishes, where the module that owns the
 * state also owns the listener that fills it.
 *
 * **Sentry already sees both of these**, globally and with the stack
 * (src/web/monitoring.ts), so this is not a second reporter. It is here so that
 * a failure is *ordered against the API calls around it* — "the GET returned
 * 500 and four hundred milliseconds later something threw" is the sentence a
 * report needs and the one thing Sentry cannot show, because breadcrumbs are
 * locked off three separate ways and for good reasons that have not changed.
 *
 * The name only, and it goes through `safeDiagnosticName` twice — once in
 * `nameOfThrown` and once in `clean` — because `Error.name` is writable, so a
 * name is a claim rather than a fact and is checked against the vocabulary
 * rather than trusted.
 */
export function watchUncaughtErrors(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event: ErrorEvent) => {
    recordLog({ kind: "client-error", source: "window", name: nameOfThrown(event.error) });
  });
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    recordLog({ kind: "client-error", source: "rejection", name: nameOfThrown(event.reason) });
  });
}

/** What is in the buffer, oldest first. A fresh array; the entries are shared. */
export function readLogBuffer(): LogEntry[] {
  const out: LogEntry[] = [];
  const start = (head - count + LOG_BUFFER_CAPACITY) % LOG_BUFFER_CAPACITY;
  for (let i = 0; i < count; i++) {
    const entry = ring[(start + i) % LOG_BUFFER_CAPACITY];
    if (entry !== undefined) out.push(entry);
  }
  return out;
}

/**
 * The buffer as one JSON string, for a report that is being built.
 *
 * **This is the only `JSON.stringify` in the file**, and rule 4 is the reason:
 * it runs once, for the handful of buffers a reader ever sends, rather than two
 * hundred times for the ones nobody reads. The `try` is not decoration — see
 * `describe` in `src/log.ts`, which exists because a stringify inside a `catch`
 * replaced a real failure with its own complaint about a circular structure.
 * Nothing stored here can be circular; that is what "cannot happen" looked like
 * the last four times.
 */
export function serialiseLogBuffer(): string {
  try {
    return JSON.stringify(readLogBuffer());
  } catch {
    return "[]";
  }
}

/** Empty it. For tests, and for a sign-out if that ever becomes a thing we want. */
export function clearLogBuffer(): void {
  ring.fill(undefined);
  head = 0;
  count = 0;
}
