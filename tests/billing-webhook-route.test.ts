/**
 * The Stripe webhook as the dispatcher actually serves it — through
 * `handleApi`, not by calling the handler directly.
 *
 * Two things can only be tested here rather than in
 * `tests/billing-webhook.test.ts`. **That the route runs before the
 * authentication gate**, which is what makes it reachable by Stripe at all; and
 * **that its neighbours do not**, which is what makes an exact path worth
 * having over a namespace.
 *
 * The third is the status contract, and it is the one that costs money to get
 * wrong: to Stripe a 2xx is a promise that this delivery never needs sending
 * again. One 200 returned over a failed write and the event that said a
 * subscription had been cancelled is gone for good.
 *
 * No database and no network: the sync is injected. See src/billing/webhook.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetStripeClientForTests } from "../src/billing/stripe.js";
import { WEBHOOK_PATH, serveStripeWebhook } from "../src/billing/webhook.js";
import type { SyncResult } from "../src/billing/sync.js";
import { handleApi } from "../src/routes.js";

const SECRET = "whsec_testsecretfortestsonly000000000";
const KEY = "sk_test_notarealkey000000000000000";
/**
 * A fake owner id, and **its own** rather than shared with
 * `tests/billing-quota-race.test.ts`.
 *
 * It was that file's id until `tests/fixture-ids.test.ts` caught the copy. It
 * happens to be safe here — this value never reaches the database, only the
 * inside of an injected `SyncResult` — so `NOT_A_ROW` would have been the other
 * legitimate answer. A distinct id is better: it is one character of work, and
 * it stays correct if somebody later makes this suite write a row, whereas a
 * "nothing here is a row" declaration would quietly become a lie.
 */
const OWNER = "0b111a99-0000-4000-8000-00000000c0db";

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

function eventBody(over: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      id: "evt_1",
      object: "event",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", object: "subscription", customer: "cus_1" } },
      ...over,
    },
    null,
    2,
  );
}

interface Reply {
  handled: boolean;
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** Drive `handleApi`, the way tests/routes.test.ts does. */
async function post(
  url: string,
  raw: string,
  headers: Record<string, string> = {},
  method = "POST",
): Promise<Reply> {
  const req = Object.assign(
    (async function* () {
      yield Buffer.from(raw);
    })(),
    { method, url, headers },
  ) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  const sent: Record<string, string> = {};
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader(k: string, v: string) {
      sent[k.toLowerCase()] = v;
    },
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  /* **No verifier is injected**, so the real `requireUser` is in play. Any test
     below that reaches a 2xx has therefore proved it did so *without* being
     signed in, which is the whole point of the route. */
  const handled = await handleApi(req, res, undefined);
  return { handled, status, body: text ? JSON.parse(text) : {}, headers: sent };
}

function sign(payload: string): Record<string, string> {
  return { "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) };
}

describe("it runs before the gate, and its neighbours do not", () => {
  it("accepts a signed delivery with no Authorization header at all", async () => {
    const payload = eventBody({ type: "charge.succeeded" });
    const reply = await post(WEBHOOK_PATH, payload, sign(payload));
    expect(reply.handled).toBe(true);
    /* 200 and not 401: a 401 here would mean the gate got it, and Stripe would
       retry for three days against a route that can never answer. */
    expect(reply.status).toBe(200);
  });

  /**
   * The reason this is an exact path rather than a `/api/webhooks/` namespace.
   * A namespace is an invitation to add a second provider without re-reading
   * any of the reasoning in src/billing/webhook.ts, and everything under it
   * would be pre-auth from the moment it was added.
   */
  it("leaves sibling webhook paths behind the gate", async () => {
    for (const path of [
      "/api/webhooks/stripe/",
      "/api/webhooks/stripe/extra",
      "/api/webhooks/paypal",
      "/api/webhooks",
    ]) {
      const payload = eventBody();
      const reply = await post(path, payload, sign(payload));
      expect(reply.status, path).toBe(401);
    }
  });

  it("refuses a GET, and says what it takes", async () => {
    const reply = await post(WEBHOOK_PATH, "", {}, "GET");
    expect(reply.status).toBe(405);
    expect(reply.headers.allow).toBe("POST");
  });
});

describe("what Stripe is told, which decides whether it retries", () => {
  const synced: SyncResult = { kind: "synced", ownerId: OWNER, status: "active" };

  it("200 once the customer's row matches Stripe", async () => {
    const sync = vi.fn(async () => synced);
    const payload = eventBody();
    const reply = await serve(payload, sync);
    expect(sync).toHaveBeenCalledWith("cus_1");
    expect(reply.status).toBe(200);
  });

  it("200 without syncing for an event type we deliberately ignore", async () => {
    const sync = vi.fn(async () => synced);
    const payload = eventBody({ type: "invoice.payment_failed" });
    const reply = await serve(payload, sync);
    /* `past_due` is an entitled status and its transitions arrive on
       `subscription.updated`, so acting on the invoice event would be a second
       path to the same conclusion. Retrying it would be pure cost. */
    expect(sync).not.toHaveBeenCalled();
    expect(reply.status).toBe(200);
    expect(reply.body.handled).toBe(false);
  });

  /**
   * The window this covers is real and short: Checkout completes, Stripe fires
   * immediately, and our own success callback has not yet written the mapping.
   * A 200 here would throw away the only event that said so.
   */
  it("503 when no billing account maps to the customer yet, so Stripe retries", async () => {
    const sync = vi.fn(async (): Promise<SyncResult> => ({ kind: "unmapped", customerId: "cus_1" }));
    const reply = await serve(eventBody(), sync);
    expect(reply.status).toBe(503);
  });

  it("500 when the sync throws, rather than swallowing it", async () => {
    const sync = vi.fn(async (): Promise<SyncResult> => {
      throw new Error("the database was unreachable");
    });
    const reply = await serve(eventBody(), sync);
    expect(reply.status).toBe(500);
    /* And the reason never travels. Stripe does not read the body, and the
       other party who might is somebody probing the endpoint. */
    expect(JSON.stringify(reply.body)).not.toContain("unreachable");
  });

  it("400 on a bad signature, and does not reach the sync at all", async () => {
    const sync = vi.fn(async () => synced);
    const payload = eventBody();
    const reply = await serve(payload, sync, { "stripe-signature": "t=1,v1=nonsense" });
    expect(reply.status).toBe(400);
    expect(sync).not.toHaveBeenCalled();
  });

  it("400 on a handled event that names no customer", async () => {
    const sync = vi.fn(async () => synced);
    const payload = eventBody({ data: { object: { id: "sub_1" } } });
    const reply = await serve(payload, sync);
    expect(reply.status).toBe(400);
    expect(sync).not.toHaveBeenCalled();
  });

  it("503 when no signing secret is configured, rather than trusting the body", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const sync = vi.fn(async () => synced);
    const payload = eventBody();
    /* Signed with the secret we would have used, so the only thing wrong is
       the configuration. */
    const reply = await serve(payload, sync, {
      "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }),
    });
    expect(reply.status).toBe(503);
    expect(sync).not.toHaveBeenCalled();
  });
});

/** The handler directly, so the sync seam can be injected. */
async function serve(
  raw: string,
  sync: (customerId: string) => Promise<SyncResult>,
  headers?: Record<string, string>,
): Promise<Reply> {
  const req = Object.assign(
    (async function* () {
      yield Buffer.from(raw);
    })(),
    { method: "POST", url: WEBHOOK_PATH, headers: headers ?? sign(raw) },
  ) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  const sent: Record<string, string> = {};
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader(k: string, v: string) {
      sent[k.toLowerCase()] = v;
    },
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  await serveStripeWebhook(req, res, "POST", sync);
  return { handled: true, status, body: text ? JSON.parse(text) : {}, headers: sent };
}
