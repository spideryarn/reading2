/**
 * The Stripe webhook: verify the bytes, then act on what Stripe says.
 *
 * The route is an **exact** pre-auth path, `POST /api/webhooks/stripe`, matched
 * inside `serveApi`'s `try` and before `requireUser` — Stripe has no session and
 * never will. Exact, not a namespace: `/api/webhooks/anything-else` must stay
 * unavailable rather than becoming a place a future handler is added without
 * anybody re-reading this file.
 * docs/plans/260902i-stripe-payments-and-subscription-tiers.md.
 *
 * ## Everything here is written to fail closed
 *
 * This is the one route on the server that no human is signed in to, and it is
 * the one that grants entitlement. So:
 *
 * - **The raw bytes are verified before anything parses them.** A body that is
 *   parsed and re-encoded is a *different* byte string — key order, whitespace,
 *   number formatting — and its signature will not match. That is why this
 *   module takes a `Buffer` and never a parsed object, and why `readBody` in
 *   src/routes.ts (which always `JSON.parse`s) cannot be reused here.
 * - **An unconfigured secret is a refusal, not a bypass.** No
 *   `STRIPE_WEBHOOK_SECRET` means every delivery is rejected. The tempting
 *   alternative — skip verification when unconfigured, "for local development" —
 *   turns one missing environment variable in production into an endpoint that
 *   grants subscriptions to anyone who can POST JSON.
 * - **`currentOwnerId()` is never called.** There is no request owner in webhook
 *   scope; the owner comes from the customer→owner mapping in the database,
 *   which is authoritative. Metadata on the Stripe object is recovery data and
 *   an assertion, never a source of truth — anyone who can forge a request can
 *   put any owner id in it, and the only reason they cannot is the signature.
 * - **The event type is allowlisted.** Stripe can send ~250 event shapes and we
 *   act on four.
 * - **A body larger than the cap is refused before it is read into memory.**
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type Stripe from "stripe";

import { errorFields, log } from "../log.js";
import { assertLivemode, stripeClient } from "./stripe.js";
import { type SyncResult, syncSubscriptionFromStripe } from "./sync.js";

/* `http`, because this is a request handler and its lines sit beside the
   ordinary request log. Not `store` — nothing here writes anything; the sync it
   calls does its own logging under `store`. */
const logger = log("http");

/**
 * The one path, exactly.
 *
 * Exported so `src/routes.ts` matches on the same string this module documents,
 * and so a test can assert that a sibling path is not reachable.
 */
export const WEBHOOK_PATH = "/api/webhooks/stripe";

/**
 * The four events that mean "this customer's subscription state may have
 * changed", and nothing else.
 *
 * All four do the same thing — resync from Stripe — because the payload is
 * never trusted for state. That is the whole point of the pattern: events can
 * arrive out of order, and a handler that applies each payload's contents
 * builds a picture that no single event ever described.
 *
 * `invoice.payment_failed` is deliberately absent. `past_due` is an entitled
 * status (src/billing/tiers.ts), and the transition into and out of it arrives
 * on `customer.subscription.updated` anyway — so handling the invoice event
 * would be a second path to the same conclusion, free to disagree with the
 * first.
 */
export const HANDLED_EVENTS: readonly string[] = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

/**
 * The most a Stripe webhook body may be.
 *
 * Stripe's own payloads are a few kilobytes; a subscription with many items is
 * still well inside this. Generous enough never to refuse a real delivery, small
 * enough that an unauthenticated endpoint cannot be used to buy memory.
 */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

/** Why a delivery was refused, in a form the route can turn into a status. */
export class WebhookRefused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "WebhookRefused";
    this.status = status;
  }
}

/**
 * Read the exact bytes that arrived, refusing anything oversized.
 *
 * A deliberate near-copy of `readBody` in src/routes.ts with the `JSON.parse`
 * removed, rather than a refactor of it into a shared helper. The duplication is
 * six lines; the coupling would be a shared function whose *other* caller has
 * every reason to keep parsing, and whose signature would then have to carry a
 * "give me the bytes instead" flag on the one path where getting it wrong means
 * a signature check that passes on rewritten input.
 */
export async function readRawBody(
  req: AsyncIterable<Buffer | string>,
  limit = MAX_WEBHOOK_BODY_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > limit) throw new WebhookRefused(413, "Webhook body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * The configured signing secret, or a refusal.
 *
 * Locally this is minted per machine by `stripe listen`, which is why it is not
 * on the `gjd-remote push-env` allowlist — one machine's value is wrong on
 * another's. In production it is the dashboard endpoint's secret, set on Vercel.
 */
function signingSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new WebhookRefused(
      503,
      "STRIPE_WEBHOOK_SECRET is not set, so no webhook delivery can be verified",
    );
  }
  return secret;
}

/**
 * Verify a delivery and return the event, or throw.
 *
 * @param raw the exact bytes that arrived — never a re-encoding of them.
 * @param signature the `stripe-signature` header, verbatim.
 *
 * The signature covers a timestamp as well as the payload, and the SDK enforces
 * a tolerance window, so a captured delivery cannot be replayed indefinitely.
 */
export function verifyEvent(raw: Buffer, signature: string | undefined): Stripe.Event {
  if (!signature) throw new WebhookRefused(400, "No stripe-signature header");
  const secret = signingSecret();

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    /* The reason is never echoed to the caller. "No signatures found matching
       the expected signature" and "timestamp outside the tolerance zone" are
       both useful to us and both a hint to somebody probing the endpoint. It
       goes to the log, not to the response. */
    throw new WebhookRefused(400, `Webhook signature verification failed: ${(err as Error).message}`);
  }

  /* Belt and braces over the key check in stripe.ts: a webhook endpoint left
     pointed at the wrong deployment is the one way a live event reaches a test
     deployment, and then the payload is the only thing that knows. */
  assertLivemode(event.livemode, `the ${event.type} event`);
  return event;
}

/** Is this an event we act on? Everything else is acknowledged and ignored. */
export function isHandled(type: string): boolean {
  return HANDLED_EVENTS.includes(type);
}

/**
 * The Stripe customer this event concerns, or null if it names none.
 *
 * Every handled event carries a customer, and it is the *only* thing taken from
 * the payload: it is a lookup key into our own mapping, not a fact we store.
 * Everything else — status, price, period — is fetched fresh from Stripe by the
 * sync function, because an out-of-order event's payload describes a moment that
 * may already be over.
 */
export function customerOf(event: Stripe.Event): string | null {
  const object = event.data.object as { customer?: string | { id: string } | null };
  const customer = object.customer;
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

/** The whole response this route ever sends. Never a Stripe message. */
function answer(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/**
 * Serve `POST /api/webhooks/stripe`.
 *
 * ## What each status means to Stripe, which is the only reader
 *
 * **2xx is a promise**, not an acknowledgement: it tells Stripe this delivery
 * never needs sending again. So it is returned only when the customer's row now
 * matches Stripe, or when the event is one we deliberately ignore. Anything
 * else — an unknown customer, a Stripe failure, a database failure — is 5xx, so
 * the delivery is retried. Getting that backwards is how a cancelled
 * subscription keeps its entitlement for ever: one 200 over a failed write and
 * the event is gone.
 *
 * **An unmapped customer is 503 rather than 200**, and the window it covers is
 * real: Checkout completes, Stripe fires immediately, and our own success
 * callback has not yet written the mapping. A retry a few seconds later finds
 * it. For a customer created by hand in the dashboard the retries eventually
 * stop, which is the right end for an event about somebody who is not a reader
 * here.
 *
 * **The response body never carries a reason.** Stripe does not read it, and
 * the one other party who might is somebody probing the endpoint — for whom
 * "signature verification failed: timestamp outside the tolerance zone" is a
 * hint. Reasons go to the log.
 *
 * @param sync a seam, so tests exercise every branch without a database. The
 * default is the real thing, so forgetting to inject cannot make a production
 * build inert — the same reasoning as `verify` on `handleApi`.
 */
export async function serveStripeWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  sync: (customerId: string) => Promise<SyncResult> = syncSubscriptionFromStripe,
): Promise<void> {
  if (method !== "POST") {
    res.setHeader("Allow", "POST");
    answer(res, 405, { error: "Method not allowed" });
    return;
  }

  let event: Stripe.Event;
  try {
    const raw = await readRawBody(req);
    const signature = req.headers["stripe-signature"];
    event = verifyEvent(raw, Array.isArray(signature) ? signature[0] : signature);
  } catch (err) {
    const status = err instanceof WebhookRefused ? err.status : 400;
    /* Logged with the reason, answered without it. */
    logger.warn({ status, ...errorFields(err) }, "refused a Stripe webhook delivery");
    answer(res, status, { error: "Webhook refused" });
    return;
  }

  if (!isHandled(event.type)) {
    /* 200: we are certain we do not want it, so a retry would be pure cost. */
    return answer(res, 200, { received: true, handled: false });
  }

  const customer = customerOf(event);
  if (!customer) {
    /* A handled event with no customer is malformed rather than unlucky, and a
       retry would send the same malformed thing again. */
    logger.error({ type: event.type, event: event.id }, "a handled Stripe event named no customer");
    answer(res, 400, { error: "Webhook refused" });
    return;
  }

  try {
    const result = await sync(customer);
    if (result.kind === "unmapped") {
      logger.warn(
        { type: event.type, customerId: customer },
        "no billing account maps to this Stripe customer yet — asking Stripe to retry",
      );
      answer(res, 503, { error: "Not ready" });
      return;
    }
    logger.info(
      { type: event.type, ownerId: result.ownerId, status: result.status },
      "synced a customer from Stripe",
    );
    answer(res, 200, { received: true, handled: true });
  } catch (err) {
    /* **5xx, so Stripe retries.** The handler awaits a durable write and
       returns 2xx only when one happened; a 200 here would silently drop the
       one event that said this subscription had changed. */
    logger.error({ type: event.type, customerId: customer, ...errorFields(err) }, "webhook sync failed");
    answer(res, 500, { error: "Sync failed" });
  }
}
