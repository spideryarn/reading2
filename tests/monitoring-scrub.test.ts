/**
 * Nothing the app did not write may reach Sentry.
 *
 * This is docs/plans/260826p-error-boundary.md's sentinel test,
 * narrowed to one egress. The full version — one unmistakable string pushed
 * into every untrusted input at once, then asserted absent from every channel
 * that does not exist to carry it — is still unbuilt and still the cheap half.
 * This is the same idea applied to the egress that was added on 2026-08-27, on
 * the principle that a new leak path gets its guard at the same time as the
 * path and not afterwards.
 *
 * ## What makes these tests worth anything
 *
 * Every one of them puts the sentinel somewhere an event can genuinely carry
 * it, taken from a real leak in this repo's history rather than imagined:
 *
 * - `message` — four rounds of it. See that document's own table.
 * - `cause.message` — the `pg` driver's own error, quoting the offending value,
 *   hanging off Drizzle's.
 * - `stack`'s first line — which repeats the message, so replacing one and not
 *   the other is a leak that looks fixed.
 * - frame `vars` — Sentry's `stackFrameVariables` is **on by default**, and in
 *   this codebase a local is called `html`, `article` or `answer`.
 * - frame `context_line` / `pre_context` / `post_context` — source text read off
 *   disk at capture time.
 * - `request`, `extra`, `contexts`, `breadcrumbs`, `user`, `server_name` — all
 *   attached by default integrations, none of them by us.
 *
 * The event those last ones arrive on does **not** come from `captureFailure`.
 * It comes from `onUncaughtException`, `onUnhandledRejection` or
 * `globalHandlers`, carrying the raw error, having never been near `sanitise`.
 * That is the case `safeEvent` exists for, and it is why the guard is an event
 * *builder* rather than an event cleaner: a cleaner has to anticipate every
 * field a future SDK version adds, and this one drops them by construction.
 */
import type { ErrorEvent } from "@sentry/core";
import { describe, expect, it } from "vitest";

import { UNEXPECTED_FAILURE } from "../src/messages.js";
import { safeEvent, sanitise } from "../src/monitoring-scrub.js";

/** Unmistakable, and nothing like anything the SDK or this repo emits. */
const SENTINEL = "SPYSENTINEL-e7f2a9-do-not-send";

/** Every string anywhere in a value, however deeply nested. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === "object")
    for (const [key, inner] of Object.entries(value)) {
      out.push(key);
      strings(inner, out);
    }
  return out;
}

function assertClean(value: unknown): void {
  const found = strings(value).filter((s) => s.includes(SENTINEL));
  expect(found, `the sentinel survived in: ${JSON.stringify(found)}`).toEqual([]);
}

describe("sanitise", () => {
  it("withholds a message nobody here wrote", () => {
    const { error, withheld } = sanitise(new Error(`Failed query: … params: ${SENTINEL}`));
    expect(withheld).toBe(true);
    expect(error.message).toBe("Error");
    assertClean({ message: error.message, stack: error.stack });
  });

  it("rewrites the stack's first line, not just the message", () => {
    /* The half that is easy to miss and easy to believe is done: `err.stack`
       *begins* with `Name: message`, so replacing `message` alone leaves the
       original sitting in the field Sentry actually parses. */
    const err = new Error(`boom ${SENTINEL}`);
    const { error } = sanitise(err);
    expect(error.stack?.split("\n")[0]).toBe("Error: Error");
    assertClean({ stack: error.stack });
  });

  it("keeps the frames while dropping the message", () => {
    /* The whole trade this design makes. If this assertion ever goes red the
       feature is worthless: an issue with no message AND no frames says
       nothing at all. */
    const err = new Error(`boom ${SENTINEL}`);
    const before = (err.stack ?? "").split("\n").length;
    const { error } = sanitise(err);
    expect((error.stack ?? "").split("\n").length).toBe(before);
    expect(error.stack).toContain("monitoring-scrub.test.ts");
  });

  it("sends a message this project wrote, because it ends in a code we minted", () => {
    const { error, withheld } = sanitise(new Error(UNEXPECTED_FAILURE.message));
    expect(withheld).toBe(false);
    expect(error.message).toBe(UNEXPECTED_FAILURE.message);
  });

  it("withholds a 409 that named its own status but not its own words", () => {
    /* **The counter-example that killed the first design.** `src/term-lookup.ts`
       throws exactly this shape, and `entry.name` is a glossary term lifted out
       of the article. An earlier version of `sanitise` passed any error carrying
       a numeric `status`, on the reasoning that a status is this codebase's mark
       for "I chose this failure and its wording". Choosing a failure's status is
       not choosing every word of its message. GPT Sol's review, 2026-08-27. */
    const err = Object.assign(
      new Error(`"${SENTINEL}" does not appear in this article, so there is no passage to check.`),
      { status: 409 },
    );
    const { error, withheld, props } = sanitise(err);
    expect(withheld).toBe(true);
    assertClean({ message: error.message, stack: error.stack, props });
    // The status itself is a diagnostic and still travels, as a tag.
    expect(props.status).toBe(409);
  });

  it("does not follow `cause`", () => {
    /* src/log.ts walks a cause chain to depth 3 because a log stays on this
       machine. The chain is where the `pg` driver's own message lives, quoting
       the offending value — so it does not travel, and `linkedErrorsIntegration`
       is left out of the integration list for the same reason. */
    const err = new Error("outer", { cause: new Error(`inner ${SENTINEL}`) });
    assertClean(sanitise(err));
  });

  it("says what a non-Error was without stringifying it", () => {
    /* `JSON.stringify` here would move an arbitrary object's contents into a
       message where nothing can reach them — and throws on a circular one, from
       inside a catch, replacing the real failure with its own. */
    const thrown = { apiKey: SENTINEL, self: null as unknown };
    thrown.self = thrown;
    const { error } = sanitise(thrown);
    expect(error.message).toBe("non-Error thrown: Object");
    assertClean(error.message);
  });

  it("carries only the allowlisted diagnostic properties", () => {
    const err = Object.assign(new Error("x"), {
      code: "ECONNRESET",
      url: `https://user:${SENTINEL}@example.com/a?token=${SENTINEL}`,
    });
    const { props } = sanitise(err);
    expect(props.code).toBe("ECONNRESET");
    expect(props.url).toBeUndefined();
    assertClean(props);
  });
});

describe("safeEvent", () => {
  /** Everything a default integration might hang on an event, all at once. */
  function loadedEvent(): ErrorEvent {
    return {
      type: undefined,
      event_id: "abc",
      message: `logentry ${SENTINEL}`,
      server_name: `host-${SENTINEL}`,
      transaction: `GET /read/${SENTINEL}`,
      extra: { body: SENTINEL },
      contexts: { runtime: { name: "node" }, leaked: { value: SENTINEL } },
      user: {
        id: "owner-123",
        email: "reader@example.com",
        /* The two that must not travel: an inferred IP address, and whatever
           else somebody hangs on `User`, which has an index signature. */
        ip_address: "203.0.113.9",
        note: SENTINEL,
      },
      request: { url: `https://x/api/article/${SENTINEL}?token=${SENTINEL}` },
      breadcrumbs: [{ category: "console", message: SENTINEL }],
      tags: { route: "chat" },
      exception: {
        values: [
          {
            type: "DrizzleQueryError",
            value: `Failed query … params: ${SENTINEL}`,
            mechanism: { type: "onuncaughtexception", handled: false, data: { extra: SENTINEL } },
            stacktrace: {
              frames: [
                {
                  filename: `/app/src/routes.ts?v=${SENTINEL}`,
                  abs_path: `/Users/someone/${SENTINEL}/src/routes.ts`,
                  module: SENTINEL,
                  function: "serveApi",
                  lineno: 12,
                  colno: 3,
                  in_app: true,
                  vars: { html: SENTINEL, answer: SENTINEL },
                  context_line: `const article = "${SENTINEL}";`,
                  pre_context: [SENTINEL],
                  post_context: [SENTINEL],
                },
              ],
            },
          },
        ],
      },
    } as ErrorEvent;
  }

  it("drops every field the sentinel was hidden in", () => {
    assertClean(safeEvent(loadedEvent()));
  });

  it("keeps the signed-in reader's id and email, and nothing else about them", () => {
    /* A deliberate reversal, on Greg's ask of 2026-08-28: an issue should say
       who hit it. `user` is the one field allowed through that carries a
       person — reduced to two keys, because `User` has an index signature and
       `ip_address` is inferred by Sentry unless refused. */
    expect(safeEvent(loadedEvent()).user).toEqual({
      id: "owner-123",
      email: "reader@example.com",
    });
  });

  it("keeps what an issue needs to be readable", () => {
    const out = safeEvent(loadedEvent());
    const frame = out.exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(out.exception?.values?.[0]?.type).toBe("DrizzleQueryError");
    expect(out.exception?.values?.[0]?.value).toBe("DrizzleQueryError");
    expect(frame?.function).toBe("serveApi");
    expect(frame?.lineno).toBe(12);
    expect(frame?.in_app).toBe(true);
    expect(out.tags).toEqual({ route: "chat" });
  });

  it("strips a query string off a frame's filename", () => {
    /* A client bundle is fetched with a cache-busting `?v=`, and a filename is
       the one field here a reader's own address bar can reach. It also has to
       stay matchable against an uploaded source map, which is why the path
       survives and only the query does not. */
    const frame = safeEvent(loadedEvent()).exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(frame?.filename).toBe("/app/src/routes.ts");
  });

  it("keeps a message that ends in one of our codes", () => {
    const event = loadedEvent();
    const first = event.exception?.values?.[0];
    if (!first) throw new Error("the fixture lost its exception");
    first.value = UNEXPECTED_FAILURE.message;
    expect(safeEvent(event).exception?.values?.[0]?.value).toBe(UNEXPECTED_FAILURE.message);
  });

  it("drops a field nothing here has heard of", () => {
    /* The property that makes this a builder rather than a cleaner, and the
       only test here that is about the *next* version of the SDK rather than
       this one. */
    const event = { ...loadedEvent(), some_future_field: SENTINEL } as ErrorEvent;
    assertClean(safeEvent(event));
    expect("some_future_field" in safeEvent(event)).toBe(false);
  });
});
