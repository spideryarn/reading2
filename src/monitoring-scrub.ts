/**
 * What may be said about a failure — the half of monitoring that is the same in
 * a browser and on a server.
 *
 * Split out of [monitoring.ts](monitoring.ts) because the two halves import
 * different SDKs (`@sentry/node-core/light` and `@sentry/react`) and **must not
 * import different rules**. This file imports neither: its only Sentry
 * dependency is types, which compile away.
 *
 * The reasoning for all of it — why an event is rebuilt rather than cleaned,
 * why a message is withheld unless it is provably one of ours, what a stack
 * frame is allowed to carry — is in monitoring.ts's header and in the doc
 * comments below. Read docs/plans/260826p-error-boundary.md
 * first if you are wondering why an error tracker needs a file like this at
 * all: four times now, an `Error.message` in this codebase has turned out to
 * contain the article.
 */
import type { ErrorEvent, Exception, StackFrame } from "@sentry/core";

import { kindOfMessage } from "./messages.js";

/**
 * Diagnostic properties an error may carry to Sentry, as tags.
 *
 * Deliberately the same list as `SAFE_ERROR_PROPS` in src/log.ts, and for the
 * reason stated there: an allowlist drops the property nobody thought about,
 * which is always the one that leaks. Its own copy rather than an import,
 * because the two lists answer to different destinations, and the day one needs
 * a member the other must not have is the day a shared constant becomes a bug.
 */
const SAFE_PROPS = ["code", "status", "statusCode", "errno", "syscall", "retryable"] as const;

/** Fields a caller may attach. Keys are ours, never a value off the request. */
export type Fields = Record<string, string | number | boolean | null | undefined>;

/**
 * Whether an error's message is provably one we wrote, and may therefore be
 * sent.
 *
 * **The first version of this also passed any error carrying a numeric
 * `status`**, on the reasoning that a status is this codebase's mark for "I
 * chose this failure and I chose its wording" — the same mark
 * src/store/db-errors.ts treats as an allowlist. GPT Sol's review killed it
 * with one counter-example, and it is worth keeping here because it is the
 * whole argument for allowlists in miniature:
 *
 *     throw Object.assign(new Error(
 *       `"${entry.name}" does not appear in this article, …`), { status: 409 })
 *
 * — src/term-lookup.ts. `entry.name` is a glossary term lifted out of the
 * article. The mark was real and the inference from it was wrong: choosing a
 * failure's *status* is not the same as choosing every *word* of its message.
 *
 * What is left is a genuinely closed set. Every reader-facing sentence in
 * src/messages.ts ends in a bracketed code (`[ai-500]`, `[db-busy]`), and
 * `kindOfMessage` returns non-null for exactly those: the code must be in
 * `CODE_KINDS` or match `ai-NNN`. `tests/messages.test.ts` round-trips every
 * sentence in that file through it, so this is not a guess about the shape of a
 * message — it is the same closed vocabulary the reader-facing copy is built
 * from. The term-lookup message above ends in "if the article has changed." and
 * is withheld.
 */
function authored(message: string | undefined): boolean {
  return Boolean(message && kindOfMessage(message) !== null);
}

/**
 * A stack frame, reduced to what points at a line of code.
 *
 * Everything else a frame may carry is dropped, and the list of what that is
 * makes the case on its own: `vars` (the frame's local variables — in this
 * codebase a local is called `html`, `article`, `answer` or `key`),
 * `context_line`, `pre_context` and `post_context` (source text read off disk
 * at capture time), `module`, `abs_path`, `debug_id`, `addr_mode`, and whatever
 * the next SDK version adds.
 *
 * `filename` is kept because it is what Sentry matches an uploaded source map
 * against, and it is stripped of any query string or fragment first — a client
 * bundle is fetched with a cache-busting `?v=`, and a URL is the one field here
 * that a reader's own address bar can reach.
 */
function safeFrame(frame: StackFrame): StackFrame {
  const filename = typeof frame.filename === "string" ? frame.filename.split(/[?#]/)[0] : undefined;
  return {
    ...(filename !== undefined && { filename }),
    ...(typeof frame.function === "string" && { function: frame.function }),
    ...(typeof frame.lineno === "number" && { lineno: frame.lineno }),
    ...(typeof frame.colno === "number" && { colno: frame.colno }),
    ...(typeof frame.in_app === "boolean" && { in_app: frame.in_app }),
  };
}

/**
 * Who was signed in, and nothing else about them.
 *
 * `User` has an index signature — anything may be hung on it — so this is a
 * reduction rather than a passthrough, exactly like `safeFrame`. Two fields:
 * the owner id, which is what joins an issue to a row, and the email, which is
 * what makes the issue list mean something to a person reading it.
 *
 * **`ip_address` is deliberately not among them.** Sentry infers one from the
 * connection unless told not to; `{{auto}}` is the opt-in and this never sends
 * it. An email is what Greg asked for and a home address is not.
 */
function safeUser(user: NonNullable<ErrorEvent["user"]>): NonNullable<ErrorEvent["user"]> {
  return {
    ...(typeof user.id === "string" && { id: user.id }),
    ...(typeof user.email === "string" && { email: user.email }),
  };
}

/**
 * The whole event, rebuilt from an allowlist. **Rule 3.**
 *
 * Note what this has to defend against, because none of it comes from
 * `captureFailure` and all of it arrives anyway. Even with the integration list
 * cut to three, an event can reach here from `onUncaughtException` or
 * `onUnhandledRejection` carrying the *raw* error, having never passed through
 * `sanitise` at all. That is the case this function exists for; the sanitised
 * path is the easy one.
 *
 * Dropped by construction, every time: `request` (the RequestData integration
 * attaches the full request URL and there is no `dataCollection` switch that
 * turns it off), `extra`, `contexts` (the SystemError integration copies an
 * error's enumerable own properties into it), `breadcrumbs`, `message`,
 * `logentry`, `transaction`, `threads`, `server_name`, `modules`.
 *
 * **`user` is the one exception, and it is a deliberate reversal.** Greg asked
 * on 2026-08-28 for the signed-in reader's email address on every error:
 *
 * > Make sure we send up the user's email address (if logged-in) as part of
 * > every error.
 * >
 * > — Greg, 2026-08-28
 *
 * So it passes — but reduced to `id` and `email` and nothing else, by the same
 * rule as everything else here. The distinction that keeps this honest is that
 * the field is *set by us*, at one seam, from the gate's own `VerifiedUser`
 * (src/auth.ts) — it is not `dataCollection.userInfo`, which stays `false`,
 * because that lets *instrumentation* populate `user.*` from whatever it finds
 * and there is no telling in advance what it would find.
 *
 * `debug_meta` is kept, and it is the one entry here that is *not* obviously
 * safe-by-inspection — it carries the debug ids that match an event to an
 * uploaded source map, and without it the client half of this is a column
 * number. That is an accepted disclosure, and the bigger half of the same
 * disclosure is the source-map upload itself: **Sentry gets this project's
 * source, client and server.** Written down here rather than discovered later.
 */
export function safeEvent(event: ErrorEvent): ErrorEvent {
  const values: Exception[] = (event.exception?.values ?? []).map((value) => {
    const type = typeof value.type === "string" ? value.type : "Error";
    return {
      type,
      value: authored(value.value) ? (value.value as string) : type,
      ...(value.mechanism && {
        // Rebuilt rather than passed through: `mechanism.data` is free-form.
        mechanism: {
          type: value.mechanism.type,
          ...(typeof value.mechanism.handled === "boolean" && { handled: value.mechanism.handled }),
        },
      }),
      ...(value.stacktrace && {
        stacktrace: { frames: (value.stacktrace.frames ?? []).map(safeFrame) },
      }),
    };
  });

  /* Every key is spread conditionally rather than assigned `undefined`, because
     `exactOptionalPropertyTypes` is on in this repo's tsconfig and the two are
     not the same thing to it. That is a happy constraint here: it means the
     object literally does not have a key unless there was a value for it, which
     is the property this function is claiming to have. */
  return {
    /* `ErrorEvent` declares this as a required `undefined` — it is what
       distinguishes an error event from a transaction one on the wire. */
    type: undefined,
    ...(event.event_id !== undefined && { event_id: event.event_id }),
    ...(event.timestamp !== undefined && { timestamp: event.timestamp }),
    ...(event.platform !== undefined && { platform: event.platform }),
    ...(event.environment !== undefined && { environment: event.environment }),
    ...(event.release !== undefined && { release: event.release }),
    ...(event.sdk !== undefined && { sdk: event.sdk }),
    ...(event.debug_meta !== undefined && { debug_meta: event.debug_meta }),
    ...(event.fingerprint !== undefined && { fingerprint: event.fingerprint }),
    ...(event.user === undefined ? {} : { user: safeUser(event.user) }),
    level: event.level ?? "error",
    tags: event.tags ?? {},
    exception: { values },
  };
}

/**
 * What Sentry is allowed to know about a failure, decided at capture time.
 *
 * Returns a **fresh `Error`** rather than the original, so that what reaches
 * `captureException` is a value this function built field by field. `safeEvent`
 * would catch a leak here anyway — that is the point of having both — but the
 * cheapest place to not send something is to not put it in the object.
 *
 * The stack survives in full. Sentry's parser reads `err.stack` and ignores its
 * first line, so rewriting the message costs no frames; the first line is
 * rewritten anyway, because a first line still quoting the original message
 * would be the leak wearing a hat.
 *
 * **What this costs, said out loud:** an issue reading `TypeError` with no
 * message is a worse issue than `TypeError: x.map is not a function`. The
 * frames still name the file and the line, which is most of the way there but
 * not all of it. Anybody reading this in six months should know the trade was
 * deliberate rather than assume messages went missing by accident — hence the
 * `message_withheld` tag, so an issue that looks bare says why.
 */
export function sanitise(err: unknown): { error: Error; withheld: boolean; props: Fields } {
  if (!(err instanceof Error)) {
    /* Never `String(err)` and never `JSON.stringify`. src/log.ts's `describe`
       explains both: one moves an arbitrary object's contents into a string
       where nothing can reach them, the other throws on a circular reference
       from inside a catch and replaces the real failure with its own. */
    const name =
      typeof err === "object" && err !== null ? (err.constructor?.name ?? "Object") : typeof err;
    return { error: new Error(`non-Error thrown: ${name}`), withheld: true, props: {} };
  }

  const withheld = !authored(err.message);
  const safe = new Error(withheld ? err.name : err.message);
  safe.name = err.name;
  if (typeof err.stack === "string") {
    const frames = err.stack.split("\n").slice(1).join("\n");
    safe.stack = `${safe.name}: ${safe.message}\n${frames}`;
  }
  /* `cause` is deliberately not followed. src/log.ts walks it to depth 3 because
     a log stays here; the LinkedErrors integration would walk it to Sentry, with
     each link's message, which is why that integration is not in the list. */

  const props: Fields = {};
  for (const key of SAFE_PROPS) {
    const value = (err as unknown as Record<string, unknown>)[key];
    const kind = typeof value;
    if (kind === "string" || kind === "number" || kind === "boolean") props[key] = value as string;
  }

  return { error: safe, withheld, props };
}
