/**
 * The one route on this server nobody is signed in to, and the one that grants
 * entitlement. Every test here is about refusing.
 *
 * **Real signatures, no network.** The SDK's `generateTestHeaderString` signs a
 * payload offline with a secret we choose, so these are the actual bytes going
 * through the actual verifier — not a mock agreeing with itself. Nothing here
 * touches `api.stripe.com`, and `tests/setup/provider-guard.ts` now refuses it
 * outright so a future test cannot start doing so by accident.
 *
 * See src/billing/webhook.ts.
 */
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HANDLED_EVENTS,
  MAX_WEBHOOK_BODY_BYTES,
  WebhookRefused,
  customerOf,
  isHandled,
  readRawBody,
  verifyEvent,
} from "../src/billing/webhook.js";
import { resetStripeClientForTests } from "../src/billing/stripe.js";

const SECRET = "whsec_testsecretfortestsonly000000000";
const KEY = "sk_test_notarealkey000000000000000";

const SAVED = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = KEY;
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  delete process.env.VERCEL_ENV;
  resetStripeClientForTests();
});

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetStripeClientForTests();
});

/**
 * An event body of the shape Stripe actually sends, in test mode.
 *
 * **Pretty-printed on purpose**, because Stripe's own webhook payloads are, and
 * because a compact one makes the re-encoding test below vacuous: `JSON.parse`
 * then `JSON.stringify` of a body this function had already compacted returns
 * the identical string, so the test would pass without proving anything. That
 * is how the first version of it passed.
 */
function eventBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      id: "evt_test_1",
      object: "event",
      api_version: "2026-08-26.dahlia",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", object: "subscription", customer: "cus_1" } },
      ...overrides,
    },
    null,
    2,
  );
}

/** The header Stripe would send for these exact bytes. */
function sign(payload: string, secret = SECRET): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

/** A fake request body stream, the shape `readRawBody` consumes. */
async function* stream(...chunks: Array<Buffer | string>): AsyncGenerator<Buffer | string> {
  for (const c of chunks) yield c;
}

describe("verifying the bytes that arrived", () => {
  it("accepts a genuine delivery", async () => {
    const payload = eventBody();
    const event = await verifyEvent(Buffer.from(payload), sign(payload));
    expect(event.type).toBe("customer.subscription.updated");
    expect(event.livemode).toBe(false);
  });

  /**
   * **The test this module's whole shape exists for.** `JSON.parse` then
   * `JSON.stringify` produces a *different byte string* — and it is the one
   * mistake that would look completely fine in review, because the object is
   * identical. If this ever passes, the handler is verifying a signature over
   * bytes the sender never sent, which is the same as not verifying it.
   */
  it("rejects the same event re-encoded, because the bytes are what is signed", async () => {
    const payload = eventBody();
    const signature = sign(payload);
    const reEncoded = JSON.stringify(JSON.parse(payload));
    /* The two really are different, or this test proves nothing. */
    expect(reEncoded).not.toBe(payload);
    await expect(verifyEvent(Buffer.from(reEncoded), signature)).rejects.toThrow(WebhookRefused);
  });

  it("rejects a body signed with somebody else's secret", async () => {
    const payload = eventBody();
    await expect(
      verifyEvent(Buffer.from(payload), sign(payload, "whsec_someoneelses")),
    ).rejects.toThrow(/signature verification failed/i);
  });

  it("rejects a tampered payload under a valid-looking signature", async () => {
    const payload = eventBody();
    const signature = sign(payload);
    const tampered = payload.replace("cus_1", "cus_someone_elses");
    await expect(verifyEvent(Buffer.from(tampered), signature)).rejects.toThrow(WebhookRefused);
  });

  it("rejects a delivery with no signature header at all", async () => {
    const payload = eventBody();
    await expect(verifyEvent(Buffer.from(payload), undefined)).rejects.toThrow(
      /No stripe-signature/,
    );
  });

  /**
   * The failure that would matter most in production: one missing environment
   * variable must not turn this endpoint into one that grants subscriptions to
   * anyone who can POST JSON. It refuses rather than skipping verification.
   */
  it("refuses every delivery when no signing secret is configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const payload = eventBody();
    /* Signed correctly for the secret we *would* have used — so the only reason
       this fails is the missing configuration, not the signature. */
    await expect(verifyEvent(Buffer.from(payload), sign(payload))).rejects.toThrow(
      /STRIPE_WEBHOOK_SECRET is not set/,
    );
    await expect(verifyEvent(Buffer.from(payload), sign(payload))).rejects.toThrow(
      expect.objectContaining({ status: 503 }),
    );
  });

  it("treats a blank secret as no secret", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "   ";
    const payload = eventBody();
    await expect(verifyEvent(Buffer.from(payload), sign(payload))).rejects.toThrow(/is not set/);
  });

  /**
   * A live event reaching a test deployment means a webhook endpoint is pointed
   * at the wrong place, and at that moment the payload is the only thing that
   * knows. Refusing is the only safe answer: acting on it would write live
   * subscription state into a test database, or the reverse.
   */
  it("refuses a live-mode event on a deployment that expects test mode", async () => {
    const payload = eventBody({ livemode: true });
    await expect(verifyEvent(Buffer.from(payload), sign(payload))).rejects.toThrow(/live-mode/);
  });
});

describe("reading the raw body", () => {
  it("returns exactly the bytes that arrived, across chunks", async () => {
    const raw = await readRawBody(stream("{\"a\":", "1}"));
    expect(raw.toString("utf8")).toBe('{"a":1}');
  });

  it("is a Buffer, not a string, so multi-byte characters survive a split", async () => {
    /* A single é split across two chunks. A string-concatenating reader would
       corrupt it and the signature would fail for a reason nobody could find. */
    const bytes = Buffer.from('{"t":"é"}', "utf8");
    const raw = await readRawBody(stream(bytes.subarray(0, 6), bytes.subarray(6)));
    expect(raw.equals(bytes)).toBe(true);
  });

  it("refuses a body over the cap with 413, rather than buffering it", async () => {
    const big = Buffer.alloc(MAX_WEBHOOK_BODY_BYTES + 1, 0x61);
    await expect(readRawBody(stream(big))).rejects.toThrow(/too large/);
    await expect(readRawBody(stream(big))).rejects.toThrow(
      expect.objectContaining({ status: 413 }),
    );
  });

  it("refuses a body that only exceeds the cap partway through", async () => {
    const half = Buffer.alloc(MAX_WEBHOOK_BODY_BYTES, 0x61);
    await expect(readRawBody(stream(half, Buffer.from("more")))).rejects.toThrow(/too large/);
  });

  /* An empty body is not this reader's business to refuse — it returns zero
     bytes and lets verification say no, which it does even for a signature that
     is genuinely correct for those zero bytes, because an empty payload is not
     an event. One refusal, in the place that owns refusing. */
  it("returns an empty buffer for an empty body, which verification then refuses", async () => {
    const raw = await readRawBody(stream());
    expect(raw.length).toBe(0);
    await expect(verifyEvent(raw, sign(""))).rejects.toThrow(WebhookRefused);
  });
});

describe("which events are acted on", () => {
  it("handles the four state-changing subscription events and nothing else", () => {
    expect([...HANDLED_EVENTS].sort()).toEqual([
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.deleted",
      "customer.subscription.updated",
    ]);
  });

  /* Deliberately absent: `past_due` is entitled, and the transitions into and
     out of it arrive on `subscription.updated`. A second path to the same
     conclusion is a second path that can disagree. */
  it("does not act on invoice events", () => {
    expect(isHandled("invoice.payment_failed")).toBe(false);
    expect(isHandled("invoice.paid")).toBe(false);
  });

  it("ignores the other two hundred event types", () => {
    for (const type of ["charge.succeeded", "customer.created", "payout.paid", ""]) {
      expect(isHandled(type)).toBe(false);
    }
  });
});

describe("the customer an event names", () => {
  it("reads a string customer", async () => {
    const payload = eventBody();
    expect(customerOf(await verifyEvent(Buffer.from(payload), sign(payload)))).toBe("cus_1");
  });

  it("reads an expanded customer object", async () => {
    const payload = eventBody({
      data: { object: { id: "sub_1", customer: { id: "cus_expanded", object: "customer" } } },
    });
    expect(customerOf(await verifyEvent(Buffer.from(payload), sign(payload)))).toBe("cus_expanded");
  });

  it("returns null rather than guessing when an event names none", async () => {
    const payload = eventBody({ data: { object: { id: "sub_1" } } });
    expect(customerOf(await verifyEvent(Buffer.from(payload), sign(payload)))).toBeNull();
    const nulled = eventBody({ data: { object: { id: "sub_1", customer: null } } });
    expect(customerOf(await verifyEvent(Buffer.from(nulled), sign(nulled)))).toBeNull();
  });
});
