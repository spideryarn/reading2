/**
 * **The last thing that happens to a bug report before it leaves this machine.**
 *
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md. src/feedback.ts
 * builds `SendFeedbackParams` field by field and hands `captureFeedback` two
 * clean scopes. This file exists because **that is not enough**, and the proof
 * is in tests/feedback-mirror.test.ts.
 *
 * ## What the two clean scopes miss
 *
 * `prepareEvent` starts from the **global** scope and merges the isolation and
 * current scopes *into* it (`getCombinedScopeData`), so replacing two of the
 * three leaves the first one untouched. Reproduced against the installed SDK,
 * 2026-08-31, on the final fake-transport envelope, every one of these arriving
 * from the global scope or from a hook that runs after it:
 *
 * | seeded | reached the envelope |
 * |---|---|
 * | `getGlobalScope().setExtra("articleProse", …)` | **yes** — `extra` |
 * | `getGlobalScope().setContext("provider", {body}) ` | **yes** — `contexts.provider` |
 * | `getGlobalScope().setUser({ip_address})` | **yes**, unreduced |
 * | `getGlobalScope().addAttachment({filename, data})` | **yes** — a whole extra envelope item |
 * | an **event processor** rewriting `extra`, `tags`, `server_name` | **yes**, all three |
 * | a **client** event processor adding a context | **yes** |
 *
 * "Nobody currently writes the global scope" is not an allowlist, and an event
 * processor is a mutation point that runs after every scope has been merged —
 * so a scope-level defence is defending the wrong seam. GPT Sol's code review,
 * 2026-08-31, which called this a blocker and was right.
 *
 * ## So the guard is at the envelope, and it *builds* rather than cleans
 *
 * Two designs were on the table: wrap the transport factory in
 * `initMonitoring`, or give feedback its own Sentry client with its own
 * transport. This is the first one, taken through the SDK's own
 * **`beforeEnvelope`** hook rather than by replacing the transport factory —
 * `Client.sendEnvelope` emits it on the line before `this._transport.send(envelope)`
 * (`@sentry/core/build/esm/client.js`), so it is the same boundary, after scope
 * merging and after every event processor.
 *
 * It is the better of the two for one reason that matters more than tidiness:
 * **the guard installs itself on whatever client `mirrorFeedback` finds**, so
 * the test's client and the production client run the identical code. A guard
 * wired into `initMonitoring` would have to be re-wired by hand in the test,
 * and then the test would be evidence about the test.
 *
 * ## The rule, in the same words `safeEvent` uses
 *
 * *Build the payload, do not clean it.* The feedback item is not filtered —
 * it is **rebuilt from what src/feedback.ts registered before capturing**, so
 * the only things taken off the event are its `event_id` and `timestamp`, both
 * shape-checked. Nothing an ambient scope or an event processor put there can
 * survive, including things nothing here has heard of.
 *
 * The attachment items are held to the same rule and then some: they are
 * **written from the registration**, bytes included, and the ones in the
 * envelope are not read at all. So a global-scope attachment wearing our own
 * filename is not filtered out, it is never copied — which a filename allowlist
 * would not have managed, since a filename is whatever the thing that added it
 * decided to call itself.
 *
 * A feedback envelope carrying a `report_id` nothing registered is **emptied**,
 * not repaired: it is not ours, and there is no version of "clean it up a bit"
 * that is safe here. An empty envelope makes `createTransport` resolve `{}`
 * without sending, which is also what stops `mirrored_at` being written for it.
 *
 * Envelopes with no feedback item — every error `safeEvent` has already built —
 * are not touched at all.
 */
import type { Client } from "@sentry/core";

/**
 * One attachment `mirrorFeedback` passed — **the bytes included**.
 *
 * The bytes are here rather than merely described here because the guard writes
 * them back into the envelope from this object. Matching what arrived against a
 * description would still be forwarding somebody else's payload if the
 * description happened to match; writing ours means it cannot be anybody's but
 * ours.
 */
export interface AllowedAttachment {
  filename: string;
  contentType: string;
  data: string | Uint8Array;
}

/**
 * **The tag keys a feedback event may carry.** src/feedback.ts's `tagsFor`
 * builds exactly these, and its return type is pinned to this list so that a
 * tag added there without being added here is a compile error rather than a tag
 * that silently stops arriving.
 */
export const FEEDBACK_TAG_KEYS = [
  "report_id",
  "url",
  "kind",
  "consented",
  "has_screenshot",
  "slug",
  "build_commit",
  "vercel_id",
  "diagnostics_version",
] as const;

export type FeedbackTagKey = (typeof FEEDBACK_TAG_KEYS)[number];

/** A tag value. Anything else is not a tag we set. */
export type FeedbackTagValue = string | number | boolean;

/**
 * Everything the guard will write into the envelope, registered **before** the
 * event is captured and consumed when it goes out.
 */
export interface FeedbackExpectation {
  /** The three answers, glued. */
  message: string;
  /** `contexts.feedback.contact_email` — the gate's, not the browser's. */
  contactEmail: string;
  source: string;
  user: { id: string; email: string };
  tags: Partial<Record<FeedbackTagKey, FeedbackTagValue>>;
  attachments: AllowedAttachment[];
}

/**
 * What is expected to go out, by report id.
 *
 * Module state, and bounded: an entry is deleted the moment its envelope is
 * seen, and `mirrorFeedback` deletes its own in a `finally` whatever happens.
 * The cap is the third mechanism, for the case where an event is dropped before
 * it is ever built — the map must not be able to grow because Sentry was down.
 */
const expectations = new Map<string, FeedbackExpectation>();
const MAX_EXPECTATIONS = 32;

/**
 * Say what one report is allowed to send, and get back the function that
 * forgets it.
 */
export function expectFeedbackEnvelope(
  reportId: string,
  expectation: FeedbackExpectation,
): () => void {
  while (expectations.size >= MAX_EXPECTATIONS) {
    /* Oldest first — `Map` iterates in insertion order. */
    const oldest = expectations.keys().next();
    if (oldest.done) break;
    expectations.delete(oldest.value);
  }
  expectations.set(reportId, expectation);
  return () => expectations.delete(reportId);
}

/** Clients this guard is already on. A `WeakSet` so a client can be collected. */
const guarded = new WeakSet<object>();

/**
 * Put the guard on this client, once.
 *
 * Called by `mirrorFeedback` rather than by `initMonitoring`, so that there is
 * no client anywhere — production, a test, a script — that can file feedback
 * without it. Idempotent: `Client.on` appends, and a guard that ran twice would
 * rebuild an already-rebuilt envelope, which is harmless but is not something
 * to rely on.
 */
export function installFeedbackEnvelopeGuard(client: Client): void {
  if (guarded.has(client)) return;
  guarded.add(client);
  client.on("beforeEnvelope", (envelope) => {
    guardFeedbackEnvelope(envelope as unknown as RawEnvelope);
  });
}

/* ------------------------------------------------------------ the shapes -- */

/** An envelope, as loosely as this file needs one: a header and item pairs. */
type RawEnvelope = [Record<string, unknown>, [Record<string, unknown>, unknown][]];

const HEX32 = /^[0-9a-f]{32}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]{8,12}Z$/;
const SDK_NAME = /^[a-z][a-z0-9._-]{0,63}$/;
const SDK_VERSION = /^[0-9][0-9a-zA-Z.+-]{0,31}$/;
const RUNTIME_NAME = /^[a-z][a-z0-9-]{0,15}$/;
const RUNTIME_VERSION = /^v?[0-9][0-9a-zA-Z.+-]{0,31}$/;
/** `production`, `preview`, `development`, `test` — src/types.ts's list, shaped. */
const ENVIRONMENT = /^[A-Za-z0-9_-]{1,32}$/;
/** A commit sha, or whatever `VERCEL_GIT_COMMIT_SHA` held. */
const RELEASE = /^[A-Za-z0-9._-]{1,64}$/;

function str(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Present keys only, so `exactOptionalPropertyTypes` and Sentry both stay happy. */
function withoutUndefined(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/* ------------------------------------------------------------- the guard -- */

/**
 * Rebuild a feedback envelope in place. **Exported for the test**, which calls
 * it directly as well as through the client hook.
 */
export function guardFeedbackEnvelope(envelope: RawEnvelope): void {
  const items = envelope[1];
  if (!Array.isArray(items)) return;
  const feedback = items.find(([header]) => header?.type === "feedback");
  /* Not a feedback envelope. An error has already been through `safeEvent`, and
     a session or a client report carries nothing of anybody's. */
  if (!feedback) return;

  const event = object(feedback[1]);
  const reportId = event ? object(event.tags)?.report_id : undefined;
  const expected = typeof reportId === "string" ? expectations.get(reportId) : undefined;
  if (typeof reportId === "string") expectations.delete(reportId);

  if (!event || !expected) {
    /* Nothing registered this. It is not ours, so nothing goes: emptied rather
       than repaired, and an envelope with no items is never sent. */
    items.length = 0;
    return;
  }

  envelope[0] = header(envelope[0]);
  items.length = 0;
  items.push([{ type: "feedback" }, rebuildEvent(event, expected)]);
  for (const item of attachments(expected)) items.push(item);
}

/**
 * The envelope header, rebuilt.
 *
 * `trace` is dropped: it is the dynamic sampling context, and it carries a
 * transaction *name* — which in this app is a route, which is a thing we would
 * rather decide than inherit. Tracing is off anyway (src/monitoring.ts), so
 * this only matters if it is ever turned on, which is exactly when nobody would
 * be looking at this file.
 */
function header(source: Record<string, unknown>): Record<string, unknown> {
  return withoutUndefined({
    event_id: str(source.event_id, HEX32),
    sent_at: str(source.sent_at, ISO),
    sdk: sdk(source.sdk),
    /* Present only when the envelope is tunnelled; a URL we configured. */
    dsn: typeof source.dsn === "string" ? source.dsn : undefined,
  });
}

function sdk(value: unknown): Record<string, unknown> | undefined {
  const source = object(value);
  if (!source) return undefined;
  const name = str(source.name, SDK_NAME);
  const version = str(source.version, SDK_VERSION);
  return name && version ? { name, version } : undefined;
}

/**
 * The feedback event, **built from the registration** rather than filtered from
 * what arrived.
 *
 * Only two fields come off the event, and both are checked: `event_id`, which
 * `markMirrored` stores and which nothing else can supply, and `timestamp`.
 * Everything else — the message, the email, the user, every tag — is what
 * src/feedback.ts registered before it captured.
 *
 * `server_name` is deliberately **not** carried, and that reverses a line in
 * the plan. It said the hostname rides along as "a fact about the server"; it
 * is also a free-form string an event processor can write, and the guard cannot
 * tell a hostname from a paragraph. `contexts.runtime` stays because it can be
 * rebuilt from two shape-checked fields, and `vercel_id` already names the
 * invocation better than a hostname would.
 */
function rebuildEvent(
  event: Record<string, unknown>,
  expected: FeedbackExpectation,
): Record<string, unknown> {
  const runtime = object(object(event.contexts)?.runtime);
  const runtimeName = str(runtime?.name, RUNTIME_NAME);
  const runtimeVersion = str(runtime?.version, RUNTIME_VERSION);
  return withoutUndefined({
    type: "feedback",
    level: "info",
    platform: "node",
    event_id: str(event.event_id, HEX32),
    timestamp: typeof event.timestamp === "number" ? event.timestamp : undefined,
    /* Ours, from `initMonitoring`'s options — not off the wire and not off a
       scope, but written by the SDK from what we configured. Shape-checked all
       the same, because a processor can reach them. */
    environment: str(event.environment, ENVIRONMENT),
    release: str(event.release, RELEASE),
    sdk: sdk(event.sdk),
    user: { id: expected.user.id, email: expected.user.email },
    tags: tags(expected.tags),
    contexts: withoutUndefined({
      feedback: {
        message: expected.message,
        contact_email: expected.contactEmail,
        source: expected.source,
      },
      runtime:
        runtimeName && runtimeVersion ? { name: runtimeName, version: runtimeVersion } : undefined,
    }),
  });
}

/** The eight tag keys, and nothing else, with values coerced to what a tag is. */
function tags(source: Partial<Record<FeedbackTagKey, FeedbackTagValue>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of FEEDBACK_TAG_KEYS) {
    const value = source[key];
    if (value === undefined) continue;
    out[key] = String(value).slice(0, 200);
  }
  return out;
}

/**
 * The attachment items, **written from the registration** and never read off
 * the envelope.
 *
 * So nothing the caller did not pass can be here, whatever it is called. That
 * matters because scope attachments are appended *after* `hint.attachments` and
 * carry whatever filename they like — a global-scope attachment named
 * `diagnostics.json` would satisfy any allowlist of names, and this is not one.
 */
function attachments(expected: FeedbackExpectation): [Record<string, unknown>, unknown][] {
  return expected.attachments.map((allowed) => {
    const bytes =
      typeof allowed.data === "string" ? new TextEncoder().encode(allowed.data) : allowed.data;
    return [
      {
        type: "attachment",
        length: bytes.length,
        filename: allowed.filename,
        content_type: allowed.contentType,
      },
      bytes,
    ];
  });
}
