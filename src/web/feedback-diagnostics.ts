/**
 * The opt-in half of a bug report, assembled at the moment the reader presses
 * Send.
 *
 * `POST /api/feedback` takes a `FeedbackDiagnosticsV1`
 * (src/feedback-payload.ts) and **rebuilds it from an allowlist**, dropping
 * anything that is the wrong shape for the slot it is in. This file is the
 * other end of that: it builds the same shape out of named fields, from three
 * sources and no others.
 *
 * - **The device** — the window, the browser, the clock and two media queries.
 * - **`api` and `errors`** — the ring buffer in [`log-buffer.ts`](log-buffer.js),
 *   which redacted and truncated every entry at write time.
 * - **`article` and `job`** — the module state in
 *   [`feedback-context.ts`](feedback-context.js), published by the reading view.
 *
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md
 * § What a report carries.
 *
 * ## Two allowlists, and this is the first one
 *
 * The plan's rule for this seam is **build the payload, do not clean it**, and
 * it asks for the check at both ends: *"the client builds it from named fields,
 * and the server validates against the same named list and drops the rest. Two
 * independent mechanisms, the same argument `dataCollection` gets in
 * `initMonitoring`: redundant, and free."*
 *
 * So `article` is shape-checked here as well as there, against the **same
 * predicates the rest of the app uses** — `isSpideryarnId`, `isSlug`, `MODES`,
 * `ARTICLE_VIEWS` — rather than against a private copy of them. The point is
 * not that the publisher is untrusted today; it is that the publisher is an
 * effect deep in `Reader`, and the day somebody puts a *title* where a slug was
 * meant is the day this is the only thing between an article's own words and a
 * third party. The server would catch it too. Neither end is allowed to be the
 * only one that does.
 *
 * The device fields are deliberately *not* shape-checked here. They are strings
 * the browser wrote — a user agent, a BCP 47 tag, an IANA zone — and no line of
 * this app ever touches them, so there is no path by which article prose
 * reaches one. Second-guessing the browser's own spelling of `en-GB` would drop
 * real values to look busy; the server holds them to a shape on arrival, which
 * is where a claim off the wire belongs.
 *
 * ## It must not throw
 *
 * Every read below is individually guarded. This function runs inside a dialog
 * a reader opened *because something was already broken*, and a collector that
 * throws there loses the bug report — the same rule both halves of
 * `monitoring.ts` keep, one seam over. `null` is a real answer everywhere in
 * the wire shape, which is what makes that affordable.
 */
import { isSpideryarnId } from "../ids.js";
import { isSlug } from "../ingest.js";
import { MODES } from "../modes.js";
import { ARTICLE_VIEWS } from "../read-address.js";
import type {
  FeedbackApiCall,
  FeedbackArticleState,
  FeedbackClientError,
  FeedbackDevice,
  FeedbackDiagnosticsV1,
  FeedbackJobState,
} from "../feedback-payload.js";
import { readFeedbackArticleContext, readFeedbackJobContext } from "./feedback-context.js";
import { readLogBuffer, type ApiLogEntry, type ClientErrorLogEntry } from "./log-buffer.js";

/**
 * The ceilings in src/feedback-payload.ts, copied.
 *
 * Copied rather than imported because that module deliberately does not export
 * them — they are its own enforcement, and a client that could read them could
 * also be written to assume them. The copies are pinned **behaviourally**, the
 * way `STEPS` is pinned over there: tests/feedback-diagnostics.test.ts fills the
 * buffer past each of these and asserts the round trip keeps exactly this many,
 * so a change on the server side turns into a red line rather than into fifty
 * entries silently becoming twenty.
 *
 * They matter for a reason beyond tidiness. `parseFeedbackDiagnostics` takes the
 * **first** N of each array, and the buffer hands them over oldest-first — so
 * sending more than N would quietly file the oldest calls and throw away the
 * seconds before the thing the reader is complaining about, which is the only
 * part anybody wants.
 */
const MAX_API_CALLS = 50;
const MAX_ERRORS = 20;
const MAX_BLOCK_IDS = 200;

/** `article_revisions.id` — src/db/schema.ts. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `lhr1::abcde-1234567890-0123456789ab` — the same shape src/feedback-payload.ts
 * holds it to, and the one field on this side that needs a copy of a pattern.
 *
 * It is here because `vercelId` is the only value in the buffer that came off
 * **a response header**: `apiFetch` reads `x-vercel-id` and stores whatever was
 * in it. Everything else the buffer holds is something this app wrote. The plan
 * already made this mistake once at the other end — *"`requestVercelId` was
 * truncated and never shape-checked, then made a Sentry tag — relying on Vercel
 * to overwrite the header rather than establishing the invariant"* — and a
 * header is a header at both ends.
 */
const VERCEL_ID = /^[A-Za-z0-9]{1,12}(:[A-Za-z0-9]{1,12}){0,3}::[A-Za-z0-9-]{1,64}$/;

/**
 * A pipeline step or a job status: **one short lowercase word**.
 *
 * A *shape*, deliberately, where the server uses a closed list. `STEP_ORDER`
 * lives in src/pipeline.ts, which the browser may not import, and
 * src/feedback-payload.ts already keeps the second copy of it and says so — a
 * third copy here would be one more list for a new step to be missing from.
 * This is the same trade `SEGMENT` makes over there: a shape that no sentence
 * passes, backed by the real vocabulary one hop later.
 */
const WORD = /^[a-z][a-z0-9]{0,23}$/;

/**
 * One reading, or `null` if it threw or was not there.
 *
 * Every device fact goes through this **separately**, rather than one `try`
 * around the block: a browser that refuses `devicePixelRatio` should cost us
 * `devicePixelRatio` and not the user agent, the viewport and the timezone as
 * well. Facts about a machine are exactly where the unexpected refusal lives —
 * a privacy extension, a locked-down embed, a `matchMedia` that is not there.
 */
function safely<T>(read: () => T): T | null {
  try {
    const value = read();
    return value === undefined ? null : value;
  } catch {
    return null;
  }
}

/** A finite number, or `null`. `NaN` and `Infinity` are not sizes. */
function finite(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Whether a media query matches, `null` where `matchMedia` cannot be asked. */
function matches(query: string): boolean | null {
  return safely(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
    return window.matchMedia(query).matches;
  });
}

/**
 * Epoch milliseconds as the instant the server will accept.
 *
 * `parseFeedbackDiagnostics` holds `at` to `2026-08-31T12:00:00.000Z` exactly,
 * parses it and writes it out again — so a timestamp in any other spelling does
 * not arrive late or wrong, it **disappears**, and the report loses the ordering
 * that was the whole reason for keeping the buffer. The buffer stamps `at` with
 * `Date.now()`, so this is the one conversion between the two.
 */
function instant(at: number): string | null {
  return safely(() => (Number.isFinite(at) ? new Date(at).toISOString() : null));
}

/**
 * `prefers-color-scheme`, as one of the three answers the wire shape has.
 *
 * Asked as two queries rather than one, because "not dark" and "light" are
 * different facts: a browser with no preference matches neither, and reporting
 * that as `light` would put a reader's stated setting and a browser's default
 * into one bucket in the one place we would go looking for a theme bug.
 */
function colourScheme(): string | null {
  if (matches("(prefers-color-scheme: dark)") === true) return "dark";
  if (matches("(prefers-color-scheme: light)") === true) return "light";
  /* Neither matched. Either there is genuinely no preference, or `matchMedia`
     is not there at all — and those are told apart by asking whether the query
     could be run rather than by what it answered. */
  return matches("(prefers-color-scheme: dark)") === null ? null : "no-preference";
}

function device(): FeedbackDevice | null {
  return {
    viewportW: finite(safely(() => window.innerWidth)),
    viewportH: finite(safely(() => window.innerHeight)),
    devicePixelRatio: finite(safely(() => window.devicePixelRatio)),
    userAgent: safely(() => navigator.userAgent),
    language: safely(() => navigator.language),
    online: safely(() => navigator.onLine),
    timezone: safely(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    colorScheme: colourScheme(),
    reducedMotion: matches("(prefers-reduced-motion: reduce)"),
  };
}

/**
 * The requests, **most recent last and never more than the server will keep**.
 *
 * A call with no method says nothing and the server drops it
 * (src/feedback-payload.ts § `apiCalls`), so it is dropped here instead of
 * spending one of the fifty slots on a row of nulls.
 */
/** The server's own caps, so that what we send is what it keeps. */
const MAX_PATH_SEGMENTS = 8;
const MAX_PATH_CHARS = 120;

function statablePath(path: string): string {
  if (!path.startsWith("/")) return "/:x";
  const segments = path.split("/").slice(1).filter(Boolean);
  if (segments.length > MAX_PATH_SEGMENTS) return "/:x";
  return path.length > MAX_PATH_CHARS ? "/:x" : path;
}

function apiCalls(entries: ApiLogEntry[]): FeedbackApiCall[] {
  const usable = entries.filter(
    (entry): entry is ApiLogEntry & { method: string } => entry.method !== null,
  );
  return usable.slice(-MAX_API_CALLS).map((entry) => ({
    method: entry.method,
    /* **A path we cannot state must not take the rest of the row with it.**
       The server drops a whole call when `path()` returns null — more than eight
       segments, more than 120 templated characters, or an empty string, which is
       what `safePath()` leaves behind for an address it could not parse. Dropped
       with it go the status, the timing and the **`x-vercel-id`**, which is the
       one field in this whole blob that ties the browser to a line in a Vercel
       log. Losing that on the one request weird enough to be unparseable is
       losing it exactly when it was worth having.

       `/:x` is the server's own word for "a segment we will not repeat", so this
       says the true thing — a call was made, we are not telling you where — in
       the vocabulary already on the wire. It is checked here rather than only in
       `feedback-payload.ts` for the same reason everything else in this file is:
       the two ends agreeing is what stops a field vanishing in silence. */
    path: statablePath(entry.path),
    status: entry.status,
    ms: entry.ms,
    vercelId: entry.vercelId !== null && VERCEL_ID.test(entry.vercelId) ? entry.vercelId : null,
    at: instant(entry.at),
  }));
}

/**
 * The failures, **by name only**.
 *
 * There is nowhere in `FeedbackClientError` to put a message, which is the
 * decision rather than an omission — src/feedback-payload.ts says why, and the
 * buffer has already held the name to an identifier shape on the way in, so a
 * call site that passed `err.message` where `err.name` was meant has already
 * been turned into `"Error"` by `log-buffer.ts` before this file sees it.
 */
function clientErrors(entries: ClientErrorLogEntry[]): FeedbackClientError[] {
  return entries.slice(-MAX_ERRORS).map((entry) => ({
    name: entry.name,
    at: instant(entry.at),
  }));
}

function article(): FeedbackArticleState | null {
  const context = readFeedbackArticleContext();
  if (context === null) return null;
  return {
    slug: isSlug(context.slug) ? context.slug : null,
    revisionId:
      typeof context.revisionId === "string" && UUID.test(context.revisionId)
        ? context.revisionId
        : null,
    view: (ARTICLE_VIEWS as readonly string[]).includes(context.view) ? context.view : null,
    mode: (MODES as readonly string[]).includes(context.mode) ? context.mode : null,
    level: finite(context.level),
    blockCount: finite(context.blockCount),
    rootBlockId: isSpideryarnId(context.rootBlockId) ? context.rootBlockId : null,
    blockIds: context.blockIds.filter(isSpideryarnId).slice(0, MAX_BLOCK_IDS),
  };
}

/**
 * The job in flight, or `null` — which is every report today; see
 * `setFeedbackJobContext` for why nothing publishes yet.
 *
 * `step` and `status` are held to `WORD` rather than to a list; see `WORD` for
 * why a third copy of `STEP_ORDER` would be worse than a shape.
 */
function job(): FeedbackJobState | null {
  const context = readFeedbackJobContext();
  if (context === null) return null;
  return {
    id: isSpideryarnId(context.id) ? context.id : null,
    step: context.step !== null && WORD.test(context.step) ? context.step : null,
    status: context.status !== null && WORD.test(context.status) ? context.status : null,
  };
}

/**
 * Everything the tick-box promises, in the shape the route takes.
 *
 * No arguments: the three sources are module state and the browser, and passing
 * them in would mean the dialog knowing about all three. It cannot throw, and
 * the worst it can return is a blob of nulls and empty arrays — which
 * `parseFeedbackDiagnostics` recognises as empty and stores as no blob at all.
 */
export function collectFeedbackDiagnostics(): FeedbackDiagnosticsV1 {
  const entries = safely(readLogBuffer) ?? [];
  return {
    device: safely(device),
    api: safely(() => apiCalls(entries.filter((e): e is ApiLogEntry => e.kind === "api"))) ?? [],
    errors:
      safely(() =>
        clientErrors(entries.filter((e): e is ClientErrorLogEntry => e.kind === "client-error")),
      ) ?? [],
    article: safely(article),
    job: safely(job),
  };
}
