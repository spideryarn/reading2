/**
 * **What a bug report is allowed to carry, decided once, for both ends.**
 *
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md. The three
 * answers, the route kind and the slug are columns and live in src/db/schema.ts;
 * this file owns the two parts of a report that are *shaped* rather than named —
 * the opt-in diagnostics blob and the pasted screenshot.
 *
 * ## Why it is its own module, and what it may import
 *
 * The client builds the blob and the server validates it, and the rule the plan
 * states for this whole seam is **build the payload, do not clean it** — the
 * same rule `safeEvent` follows in src/monitoring-scrub.ts. Two independent
 * allowlists, one at each end, from one declaration: that is the
 * `dataCollection` argument in src/monitoring.ts (redundant, and free).
 *
 * So it imports **only vocabularies, and only from modules that themselves
 * import nothing heavy**: src/ids.ts, src/modes.ts, src/read-address.ts.
 * Nothing under `src/web/` may reach a server module
 * (tests/client-imports.test.ts), and a shared shape that pulls `pg` or
 * `node:fs` behind it is a shape only one end can have. The screenshot used to
 * be here too and is not any more — it needs `node:zlib`, so it moved to
 * src/feedback-image.ts, which only the server imports.
 *
 * ## Three things this file refuses, and they are the point of it
 *
 * 1. **A field nobody named.** `parseFeedbackDiagnostics` builds its answer key
 *    by key. Anything else the browser sent is dropped without being looked at,
 *    including the field a future version of the client adds and this version
 *    has never heard of.
 * 2. **A query string.** Every path is cut at `?` and `#` before it is kept.
 *    `apiFetch("/api/library/search?q=…")` carries reader-typed search text, and
 *    that is the same leak as sending `location.href` one layer down — the plan
 *    missed it twice, so it is enforced here rather than remembered.
 * 3. **A value that is the wrong *shape* for the slot it is in.** This is the
 *    correction GPT Sol's code review forced, 2026-08-31: the first version
 *    length-capped these fields and nothing else, so
 *
 *    > `blockIds` accepts 200 arbitrary 64-character strings … A caller can
 *    > place article prose or a provider body inside those named slots.
 *
 *    which is exactly true, and 12,800 characters of prose in a field called
 *    `blockIds` is no better than 12,800 characters of prose in a field called
 *    `prose`. So every field here is now an **identifier, a closed vocabulary,
 *    a number in range, or a timestamp** — never a capped string, except the
 *    user-agent, which is noted where it is defined.
 *
 * ## The vocabularies that are copied rather than imported
 *
 * `STEP_ORDER` lives in src/pipeline.ts and `JobStatus` is a type rather than an
 * array, so `STEPS` and `JOB_STATUSES` below are second copies. That is the
 * same trade src/db/schema.ts makes for its CHECK constraints, and it is pinned
 * the same way — behaviourally, by tests/feedback-payload.test.ts, which feeds
 * every value of the real `STEP_ORDER` through this file and watches it survive.
 * A step added to the pipeline and not to the list here does not break a report;
 * it makes one field of one blob go null, which the test turns into a red line
 * before anybody has to notice.
 */
import { isSpideryarnId } from "./ids.js";
import { MODES } from "./modes.js";
import { ARTICLE_VIEWS } from "./read-address.js";

/** Which shape `FeedbackDiagnostics.payload` has. Stored in its own column. */
export const FEEDBACK_DIAGNOSTICS_VERSION = 1;

/** Facts about the reader's machine. Behind the tick-box: these fingerprint. */
export interface FeedbackDevice {
  viewportW: number | null;
  viewportH: number | null;
  devicePixelRatio: number | null;
  userAgent: string | null;
  language: string | null;
  online: boolean | null;
  timezone: string | null;
  colorScheme: string | null;
  reducedMotion: boolean | null;
}

/**
 * One request the browser made, as **structured fields and never text**.
 *
 * `vercelId` is the whole reason this exists: `x-vercel-id` is the request id
 * Vercel logs under, it is readable because these are same-origin requests, and
 * nothing else in this repo ties a browser to a line in a server log.
 */
export interface FeedbackApiCall {
  method: string;
  /** A route template — `/api/chat/:x/live`. Cut at `?`, then templated; see `path`. */
  path: string;
  status: number | null;
  ms: number | null;
  vercelId: string | null;
  at: string | null;
}

/**
 * An uncaught error or a rejected promise, **by name only** in v1.
 *
 * No message. `Error.message` in this codebase has four times turned out to
 * contain the article (src/monitoring-scrub.ts), so a name is what may travel —
 * and only a name on the closed list `safeDiagnosticName` below holds it to.
 * The plan's larger `safeDiagnosticError()`, which would also return an
 * authored message and parsed allowlisted frames, is still unbuilt; the name
 * half of it is here because GPT Sol's second review showed that an identifier
 * *shape* is not a check when `Error.name` is writable.
 */
export interface FeedbackClientError {
  name: string;
  at: string | null;
}

/**
 * Which article, at which revision, seen how. **Ids, never prose.**
 *
 * docs/project/block-ids.md is why an id is enough: an id is the address of a
 * passage, every feature already addresses text that way, and we have the text
 * in our own Postgres. Greg's own question contains the argument — *"presumably
 * we already have it in our database"*.
 */
export interface FeedbackArticleState {
  slug: string | null;
  revisionId: string | null;
  view: string | null;
  mode: string | null;
  level: number | null;
  blockCount: number | null;
  rootBlockId: string | null;
  blockIds: string[];
}

/** An ingest job in flight. The 2026-08-28 outage was failing ingests. */
export interface FeedbackJobState {
  id: string | null;
  step: string | null;
  status: string | null;
}

export interface FeedbackDiagnosticsV1 {
  device: FeedbackDevice | null;
  api: FeedbackApiCall[];
  errors: FeedbackClientError[];
  article: FeedbackArticleState | null;
  job: FeedbackJobState | null;
}

/* The ceilings. Each is a bound on how much of anything can ride to a third
   party, and each is enforced here rather than trusted to the client, because
   client-side truncation is not validation. */
const MAX_API_CALLS = 50;
const MAX_ERRORS = 20;
const MAX_BLOCK_IDS = 200;

/** The methods this app's own client uses. A closed set, like every other. */
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

/** `prefers-color-scheme` has three answers and this is all of them. */
const COLOUR_SCHEMES = ["light", "dark", "no-preference"] as const;

/**
 * `STEP_ORDER` in src/pipeline.ts, copied. See the header for why it is copied
 * and what keeps the copy honest.
 */
const STEPS = [
  "fetch",
  "extract",
  "blocks",
  "hierarchy",
  "assets",
  "arc",
  "tweets",
  "glossary",
  "quotes",
  "ideas",
  "timeline",
  "quiz",
  "sketch",
] as const;

/** `JobStatus` in src/types.ts, which is a type and so cannot be imported as one. */
const JOB_STATUSES = ["queued", "running", "done", "error", "cancelled"] as const;

/* ------------------------------------------------------------ the shapes -- */

/**
 * **Every error name a report may carry, and nothing else.**
 *
 * `Error.name` is a writable string, so an identifier *shape* is not a check —
 * `PROVIDER_BODY_MARKER` and `reader_search_term` are both syntactically
 * perfect identifiers, and both are data. GPT Sol's second review, 2026-08-31:
 *
 * > I would insist on an explicit vocabulary of built-in and authored error
 * > names, with everything unknown reduced to `"Error"`, at both ends.
 *
 * So this is a **list, not a pattern**, and it is the same call `SAFE_PROPS`
 * makes in src/monitoring-scrub.ts and the rebuild-don't-filter rule makes in
 * src/public/dto.ts: an allowlist drops the value nobody thought about, which
 * is always the one that leaks.
 *
 * Three groups, and the reason each is safe to keep is that **every string in
 * it is a constant somebody wrote down** — a spec's name or this repo's own —
 * so none of them can carry a character the reader or the article supplied.
 * That is also why the DOM group is the *whole* `DOMException` name table
 * rather than the handful we have met so far: a name with no information
 * content costs nothing to keep, and a short list is a list that turns a real
 * `ConstraintError` into `"Error"` the first time IndexedDB has an opinion.
 *
 * The authored group is the useful one, and it is short because only three
 * classes under `src/web/` set a `name`. A server-side class (`FetchFailure`,
 * `ProviderRefused`, …) is deliberately absent: those never reach a browser as
 * a thrown `Error` — they arrive as a JSON body and become `HttpError` — so
 * listing them would be listing names that can only arrive by forgery.
 *
 * **Adding to this list is the intended way to keep a name.** If a new client
 * error class sets `this.name`, put it here in the same commit; the cost of
 * forgetting is one `"Error"` in a report, not a broken build.
 */
const DIAGNOSTIC_ERROR_NAMES: ReadonlySet<string> = new Set([
  /* ECMAScript's own constructors. `InternalError` is Firefox-only and not in
     the language, and it is here because "too much recursion" is a real bug a
     reader would file and it has no other name. */
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "AggregateError",
  "InternalError",

  /* `DOMException`'s name table, whole — WebIDL § exception names, both the
     legacy list and the modern additions — plus `OverconstrainedError`, which
     is its own interface rather than a `DOMException` and is what
     `getUserMedia` rejects with in src/web/useDictation.ts. */
  "DOMException",
  "IndexSizeError",
  "HierarchyRequestError",
  "WrongDocumentError",
  "InvalidCharacterError",
  "NoModificationAllowedError",
  "NotFoundError",
  "NotSupportedError",
  "InUseAttributeError",
  "InvalidStateError",
  "InvalidModificationError",
  "NamespaceError",
  "InvalidAccessError",
  "TypeMismatchError",
  "SecurityError",
  "NetworkError",
  "AbortError",
  "URLMismatchError",
  "QuotaExceededError",
  "TimeoutError",
  "InvalidNodeTypeError",
  "DataCloneError",
  "EncodingError",
  "NotReadableError",
  "UnknownError",
  "ConstraintError",
  "DataError",
  "TransactionInactiveError",
  "ReadOnlyError",
  "VersionError",
  "OperationError",
  "NotAllowedError",
  "OptOutError",
  "OverconstrainedError",

  /* Ours, and every one of them is a `class … extends Error` under `src/web/`
     that assigns `this.name`. Nobody has to remember to add the next one:
     tests/feedback-payload.test.ts sweeps `src/web/` for `this.name =` and goes
     red naming any assignment this list has not heard of — the same way that
     file pins `STEPS` against the real `STEP_ORDER`. */
  "HttpError",
  "StreamStalled",
  "MarkStopped",
]);

/**
 * A name from the vocabulary, and `"Error"` for everything else.
 *
 * **Reduced, never dropped.** A failure that happened is worth a row in the
 * timeline even when its name is one we will not repeat: the `at` beside it is
 * half of what the buffer is for, and an error that vanishes looks exactly like
 * an error that never happened.
 *
 * Used at both ends — src/web/log-buffer.ts applies it at write time, and
 * `clientErrors` below applies it again to whatever arrives off the wire — so
 * neither end is trusting the other. It also settles a silent-drop mismatch the
 * earlier length-capped expression had: a 65-character name the client kept and
 * the server quietly discarded is now `"Error"` on both sides.
 */
export function safeDiagnosticName(value: unknown): string {
  return typeof value === "string" && DIAGNOSTIC_ERROR_NAMES.has(value) ? value : "Error";
}
/** The same expression `isSlug` uses in src/ingest.ts, which cannot be imported here. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;
/** A revision id is `uuid` — src/db/schema.ts § article_revisions. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `lhr1::abcde-1234567890-0123456789ab`, and its two- and three-region forms. */
const VERCEL_ID = /^[A-Za-z0-9]{1,12}(:[A-Za-z0-9]{1,12}){0,3}::[A-Za-z0-9-]{1,64}$/;

/**
 * The request id if it is one, and `null` if it is not.
 *
 * Exported for the same reason `safeDiagnosticName` is: `x-vercel-id` is the
 * only value the client log buffer holds that came off **a response header**,
 * and src/web/log-buffer.ts's first rule is *redact and truncate at write time,
 * not at send time* — a header held raw in a ring for two hundred entries is
 * exactly the live reference that rule exists to refuse. GPT Sol, 2026-08-31:
 * *"I would validate it while recording and retain the collector/server checks
 * as redundancy."*
 *
 * So there are three checks on one value and only two definitions of its shape:
 * this one, used by the buffer at write time and by `apiCalls` below on
 * arrival, and the deliberate copy in src/web/feedback-diagnostics.ts, which is
 * the redundant middle layer and says so.
 */
export function safeVercelId(value: unknown): string | null {
  return shaped(value, VERCEL_ID);
}
/** BCP 47, as loosely as a browser writes one: `en`, `en-GB`, `zh-Hans-CN`. */
const LANGUAGE = /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8}){0,3}$/;
/** `Europe/London`, `UTC`, `America/Argentina/Buenos_Aires`. */
const TIMEZONE = /^[A-Za-z][A-Za-z0-9_+-]{0,23}(\/[A-Za-z0-9_+-]{1,24}){0,2}$/;
/**
 * **The one capped string left**, and it is named rather than hidden.
 *
 * A user-agent is free text by specification, so no shape says what it is. It is
 * kept because it is the single most useful line in a bug report, and it is held
 * to printable ASCII on one line and 300 characters — which is a channel, and a
 * small one, and the smallest this field can be made without dropping it. The
 * reader's own browser writes it, and the reader consented to sending it.
 */
const USER_AGENT = /^[\x20-\x7e]{1,300}$/;

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A string matching a shape, or null. Never a coercion, never a truncation. */
function shaped(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return pattern.test(trimmed) ? trimmed : null;
}

/** One of a closed list, or null. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/** A finite number in range, or null. `NaN` and `Infinity` are not sizes. */
function num(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** The window a timestamp in a bug report can sensibly be in. */
const EARLIEST = Date.UTC(2020, 0, 1);
const LATEST = Date.UTC(2100, 0, 1);
/** `2026-08-31T12:00:00.000Z`, and nothing else. */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * An instant, **normalised by us**.
 *
 * Not a capped string: `at` is a 200-character slot in a named field, and a
 * named slot is exactly where prose goes when everything else is closed. Parsed,
 * range-checked and written out again, so the value that is stored is one this
 * function produced.
 */
function instant(value: unknown): string | null {
  const raw = shaped(value, ISO);
  if (raw === null) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms) || ms < EARLIEST || ms > LATEST) return null;
  return new Date(ms).toISOString();
}

/**
 * A path, **cut at the first `?` or `#`, then reduced to a route template**.
 *
 * The cut is the same reduction `safeFrame` makes on a stack frame's
 * `filename`, for the same reason and against the same hazard. The templating
 * after it is GPT Sol's, 2026-08-31: a 200-character path with arbitrary
 * segments in it is a 200-character free-text field wearing a slash.
 *
 * So each segment is either **a single lowercase word** — which is what every
 * endpoint in this app is called: `article`, `chat`, `comments`, `glossary`,
 * `blocks`, `visibility`, `search`, `advance` — or it is replaced by `:x`.
 * `/api/chat/why-trees-spya-k3m9qt/live` becomes `/api/chat/:x/live`, which
 * says which endpoint went wrong and carries nothing the `slug` column does not
 * already carry.
 *
 * **What this does not claim.** A caller could still spell a paragraph as
 * `/four/score/and/seven`, eight words per call and fifty calls in a blob. That
 * is not the risk this is for, and it is worth being plain about why: the
 * reader's own three answers are 12,000 characters of free text that this
 * feature forwards to Sentry **on purpose**, so somebody who wants prose in
 * Sentry types it into the boxes. What a shape check is actually for is *our own
 * client* putting reader or article data into a named slot by accident and
 * nobody noticing because the slot was merely length-capped — and a path that
 * has stopped being a path is exactly what that looks like.
 */
const SEGMENT = /^[a-z][a-z0-9]{0,23}$/;
const MAX_SEGMENTS = 8;
const MAX_PATH_CHARS = 120;

function path(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw.startsWith("/")) return null;
  const cut = raw.split(/[?#]/)[0] ?? "";
  const segments = cut.split("/").slice(1).filter(Boolean);
  if (segments.length === 0) return "/";
  if (segments.length > MAX_SEGMENTS) return null;
  const built = `/${segments.map((one) => (SEGMENT.test(one) ? one : ":x")).join("/")}`;
  return built.length > MAX_PATH_CHARS ? null : built;
}

function device(value: unknown): FeedbackDevice | null {
  const source = asObject(value);
  if (!source) return null;
  return {
    viewportW: num(source.viewportW, 0, 100_000),
    viewportH: num(source.viewportH, 0, 100_000),
    devicePixelRatio: num(source.devicePixelRatio, 0, 100),
    userAgent: shaped(source.userAgent, USER_AGENT),
    language: shaped(source.language, LANGUAGE),
    online: bool(source.online),
    timezone: shaped(source.timezone, TIMEZONE),
    colorScheme: oneOf(source.colorScheme, COLOUR_SCHEMES),
    reducedMotion: bool(source.reducedMotion),
  };
}

function apiCalls(value: unknown): FeedbackApiCall[] {
  if (!Array.isArray(value)) return [];
  const out: FeedbackApiCall[] = [];
  for (const entry of value.slice(0, MAX_API_CALLS)) {
    const source = asObject(entry);
    if (!source) continue;
    const method = oneOf(
      typeof source.method === "string" ? source.method.toUpperCase() : source.method,
      METHODS,
    );
    const where = path(source.path);
    /* A call with no method or no path says nothing and would only be a row of
       nulls in whatever reads this later. Dropped rather than kept as one. */
    if (method === null || where === null) continue;
    out.push({
      method,
      path: where,
      status: num(source.status, 100, 599),
      ms: num(source.ms, 0, 24 * 60 * 60 * 1000),
      vercelId: safeVercelId(source.vercelId),
      at: instant(source.at),
    });
  }
  return out;
}

function clientErrors(value: unknown): FeedbackClientError[] {
  if (!Array.isArray(value)) return [];
  const out: FeedbackClientError[] = [];
  for (const entry of value.slice(0, MAX_ERRORS)) {
    const source = asObject(entry);
    if (!source) continue;
    /* A missing name is not an error record at all, so that entry is dropped.
       A *present* one is reduced rather than dropped — see
       `safeDiagnosticName`, and note that the client has already done this
       once, at write time, in src/web/log-buffer.ts. */
    if (typeof source.name !== "string") continue;
    out.push({ name: safeDiagnosticName(source.name), at: instant(source.at) });
  }
  return out;
}

function article(value: unknown): FeedbackArticleState | null {
  const source = asObject(value);
  if (!source) return null;
  /* **Block ids, held to the one contract everything else here is held to.**
     `isSpideryarnId` is the same predicate the router, the citations and the
     internal links use — AGENTS.md § The one contract that matters. Two hundred
     of these is 2,200 characters of `spya-` and nothing else. */
  const ids = Array.isArray(source.blockIds)
    ? source.blockIds
        .slice(0, MAX_BLOCK_IDS)
        .filter((id): id is string => typeof id === "string" && isSpideryarnId(id))
    : [];
  return {
    slug: shaped(source.slug, SLUG),
    revisionId: shaped(source.revisionId, UUID),
    view: oneOf(source.view, ARTICLE_VIEWS),
    mode: oneOf(source.mode, MODES),
    /* The granularity ladder is short. 100 was a cap on nothing. */
    level: num(source.level, 0, 20),
    blockCount: num(source.blockCount, 0, 1_000_000),
    rootBlockId:
      typeof source.rootBlockId === "string" && isSpideryarnId(source.rootBlockId)
        ? source.rootBlockId
        : null,
    blockIds: ids,
  };
}

function job(value: unknown): FeedbackJobState | null {
  const source = asObject(value);
  if (!source) return null;
  return {
    /* A job id is a minted Spideryarn id — src/db/schema.ts § `jobs_id_format`. */
    id: typeof source.id === "string" && isSpideryarnId(source.id) ? source.id : null,
    step: oneOf(source.step, STEPS),
    status: oneOf(source.status, JOB_STATUSES),
  };
}

/**
 * **The largest this blob can be as JSON, derived rather than guessed.**
 *
 * src/routes.ts builds `MAX_FEEDBACK_BODY_BYTES` out of this, so that the outer
 * byte cap cannot refuse a body the validator below would have accepted — which
 * it did, by about 30 KB, until GPT Sol constructed one. The point is not the
 * number; it is that the number is computed from the same constants the
 * validator enforces, so the two cannot drift.
 *
 * Six bytes per character is the worst case `JSON.stringify` can produce for one
 * UTF-16 unit: a control character becomes `\u0001`, and a character outside the
 * BMP is two units and at most twelve bytes. Generous on purpose — everything it
 * bounds is separately capped by shape, so the headroom cannot be spent.
 */
const WORST_BYTES_PER_CHAR = 6;
const DEVICE_BYTES = (300 + 35 + 64 + 16 + 200) * WORST_BYTES_PER_CHAR;
const API_CALL_BYTES = (10 + 200 + 8 + 12 + 80 + 24 + 120) * WORST_BYTES_PER_CHAR;
const ERROR_BYTES = (64 + 24 + 40) * WORST_BYTES_PER_CHAR;
const ARTICLE_BYTES =
  (200 + 36 + 16 + 32 + 16 + 12 + 11 + 200) * WORST_BYTES_PER_CHAR +
  MAX_BLOCK_IDS * 16 * WORST_BYTES_PER_CHAR;
const JOB_BYTES = (11 + 16 + 12 + 60) * WORST_BYTES_PER_CHAR;

export const MAX_FEEDBACK_DIAGNOSTICS_JSON_BYTES =
  DEVICE_BYTES +
  MAX_API_CALLS * API_CALL_BYTES +
  MAX_ERRORS * ERROR_BYTES +
  ARTICLE_BYTES +
  JOB_BYTES +
  /* The wrapper: five keys, their braces and their commas. */
  512;

/**
 * The blob, **rebuilt from an allowlist**, or `null` if there was nothing in it.
 *
 * Returning `null` for an empty result is what keeps the database's
 * `feedback_diagnostics_version` constraint something nobody has to think about:
 * a version standing beside an absent blob is a row this schema does not have.
 */
export function parseFeedbackDiagnostics(value: unknown): FeedbackDiagnosticsV1 | null {
  const source = asObject(value);
  if (!source) return null;
  const built: FeedbackDiagnosticsV1 = {
    device: device(source.device),
    api: apiCalls(source.api),
    errors: clientErrors(source.errors),
    article: article(source.article),
    job: job(source.job),
  };
  const empty =
    built.device === null &&
    built.article === null &&
    built.job === null &&
    built.api.length === 0 &&
    built.errors.length === 0;
  return empty ? null : built;
}
