/**
 * **What a bug report is allowed to carry, decided once, for both ends.**
 *
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md. The three
 * answers, the route kind and the slug are columns and live in src/db/schema.ts;
 * this file owns the two parts of a report that are *shaped* rather than named —
 * the opt-in diagnostics blob and the pasted screenshot.
 *
 * ## Why it is its own module, and why it imports nothing
 *
 * The client builds the blob and the server validates it, and the rule the plan
 * states for this whole seam is **build the payload, do not clean it** — the
 * same rule `safeEvent` follows in src/monitoring-scrub.ts. Two independent
 * allowlists, one at each end, from one declaration: that is the
 * `dataCollection` argument in src/monitoring.ts (redundant, and free).
 *
 * So it imports nothing at all. Nothing under `src/web/` may reach a server
 * module (tests/client-imports.test.ts), and a shared shape that pulls `pg` or
 * `node:fs` behind it is a shape only one end can have.
 *
 * ## Two things this file refuses, and they are the point of it
 *
 * 1. **A field nobody named.** `parseFeedbackDiagnostics` builds its answer key
 *    by key. Anything else the browser sent is dropped without being looked at,
 *    including the field a future version of the client adds and this version
 *    has never heard of.
 * 2. **A query string.** Every path is cut at `?` and `#` before it is kept.
 *    `apiFetch("/api/library/search?q=…")` carries reader-typed search text, and
 *    that is the same leak as sending `location.href` one layer down — the plan
 *    missed it twice, so it is enforced here rather than remembered.
 */

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
  /** Cut at `?` — see the header. */
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
 * contain the article (src/monitoring-scrub.ts), and the decided answer — a
 * shared `safeDiagnosticError()` that returns an identifier-shaped type, an
 * authored message and parsed allowlisted frames — belongs to the stage that
 * builds the client log buffer. Until it exists, a name is what may travel.
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
/** Long enough for a path with a slug in it, short enough that nothing hides. */
const MAX_SHORT = 200;
/** A user-agent string, which is the longest of these by some way. */
const MAX_LONG = 500;

/** The methods this app's own client uses. A closed set, like every other. */
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A bounded string, or null. Never a coercion: a number is not a language. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
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

/**
 * A path, **cut at the first `?` or `#`**.
 *
 * The same reduction `safeFrame` makes on a stack frame's `filename`, for the
 * same reason and against the same hazard. Anything that is not an absolute
 * path is dropped rather than repaired: a full URL here would be
 * `location.href` arriving by another door.
 */
function path(value: unknown): string | null {
  const raw = text(value, MAX_SHORT);
  if (raw === null || !raw.startsWith("/")) return null;
  const cut = raw.split(/[?#]/)[0] ?? "";
  return cut === "" ? null : cut;
}

function device(value: unknown): FeedbackDevice | null {
  const source = asObject(value);
  if (!source) return null;
  return {
    viewportW: num(source.viewportW, 0, 100_000),
    viewportH: num(source.viewportH, 0, 100_000),
    devicePixelRatio: num(source.devicePixelRatio, 0, 100),
    userAgent: text(source.userAgent, MAX_LONG),
    language: text(source.language, MAX_SHORT),
    online: bool(source.online),
    timezone: text(source.timezone, MAX_SHORT),
    colorScheme: text(source.colorScheme, MAX_SHORT),
    reducedMotion: bool(source.reducedMotion),
  };
}

function apiCalls(value: unknown): FeedbackApiCall[] {
  if (!Array.isArray(value)) return [];
  const out: FeedbackApiCall[] = [];
  for (const entry of value.slice(0, MAX_API_CALLS)) {
    const source = asObject(entry);
    if (!source) continue;
    const method = text(source.method, 10)?.toUpperCase() ?? null;
    const where = path(source.path);
    /* A call with no method or no path says nothing and would only be a row of
       nulls in whatever reads this later. Dropped rather than kept as one. */
    if (method === null || !METHODS.includes(method) || where === null) continue;
    out.push({
      method,
      path: where,
      status: num(source.status, 100, 599),
      ms: num(source.ms, 0, 24 * 60 * 60 * 1000),
      vercelId: text(source.vercelId, MAX_SHORT),
      at: text(source.at, MAX_SHORT),
    });
  }
  return out;
}

/**
 * `TypeError`, `SpideryarnError` — an identifier and nothing else.
 *
 * `Error.name` is writable, so this is checked rather than assumed: a name that
 * is not identifier-shaped is a message wearing a hat.
 */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$.]{0,63}$/;

function clientErrors(value: unknown): FeedbackClientError[] {
  if (!Array.isArray(value)) return [];
  const out: FeedbackClientError[] = [];
  for (const entry of value.slice(0, MAX_ERRORS)) {
    const source = asObject(entry);
    if (!source) continue;
    const name = text(source.name, 64);
    if (name === null || !IDENTIFIER.test(name)) continue;
    out.push({ name, at: text(source.at, MAX_SHORT) });
  }
  return out;
}

function article(value: unknown): FeedbackArticleState | null {
  const source = asObject(value);
  if (!source) return null;
  const ids = Array.isArray(source.blockIds)
    ? source.blockIds
        .slice(0, MAX_BLOCK_IDS)
        .map((id) => text(id, 64))
        .filter((id): id is string => id !== null)
    : [];
  return {
    slug: text(source.slug, MAX_SHORT),
    revisionId: text(source.revisionId, MAX_SHORT),
    view: text(source.view, MAX_SHORT),
    mode: text(source.mode, MAX_SHORT),
    level: num(source.level, 0, 100),
    blockCount: num(source.blockCount, 0, 1_000_000),
    rootBlockId: text(source.rootBlockId, 64),
    blockIds: ids,
  };
}

function job(value: unknown): FeedbackJobState | null {
  const source = asObject(value);
  if (!source) return null;
  return {
    id: text(source.id, MAX_SHORT),
    step: text(source.step, MAX_SHORT),
    status: text(source.status, MAX_SHORT),
  };
}

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

/**
 * What a screenshot is stored and forwarded as — **our words, not the
 * caller's**.
 *
 * `filename` and `contentType` are chosen here from the bytes. A client-supplied
 * MIME type or filename is never forwarded to Sentry and never stored: the
 * schema has no column for either, and this is why.
 */
export interface FeedbackScreenshot {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

/**
 * Is this actually a picture? **The magic bytes, not a header the caller wrote.**
 *
 * Two formats, because those are the two a browser produces: a PrtScn paste is a
 * PNG, and the dialog's downscale step is a JPEG. Anything else is refused, and
 * that refusal is doing real work rather than being tidy — without it the
 * screenshot field is a 400 KB hole through which any bytes at all, an article
 * included, reach a third party as an attachment.
 */
export function sniffScreenshot(bytes: Uint8Array): FeedbackScreenshot | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, i) => bytes[i] === byte)) {
    return { bytes, contentType: "image/png", filename: "screenshot.png" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { bytes, contentType: "image/jpeg", filename: "screenshot.jpg" };
  }
  return null;
}
