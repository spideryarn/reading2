/**
 * **Is this account new?** Asked once per account per server instance, and
 * answered yes exactly once across all of them — and when it is, the admin
 * hears about it.
 *
 * The server never sees a sign-up. Sign-up is Supabase Auth in the browser
 * (email and password, or Google), so the first the server knows of a reader
 * is their first authenticated request. For an email sign-up that is after
 * they confirmed their address, so an account created and never confirmed is
 * never announced — which is the better signal anyway.
 *
 * The ledger is `spideryarn.reader_arrivals` (src/db/schema.ts): `insert … on
 * conflict do nothing returning` gives a row back to exactly one request in
 * the fleet, and that request sends the mail. The migration that made the
 * table backfilled every account that already existed.
 *
 * **It can never fail a request.** Every path returns; a database error is
 * logged and the account is *not* remembered, so the next request asks again.
 *
 * docs/plans/260930i-email-admin-on-sign-up-and-plan-upgrade.md.
 */

import { getDb } from "./db/client.js";
import { readerArrivals } from "./db/schema.js";
import { notifyAdmin, oneLine } from "./email.js";
import { errorFields, log } from "./log.js";
import { ADMIN_USERS_URL } from "./urls.js";

const logger = log("store");

/**
 * Accounts this instance already knows have arrived. A cache, so a reader's
 * hundredth request costs a lookup rather than an insert; only ever added to
 * **after** the database has answered, so a failed insert is retried.
 */
const known = new Set<string>();
/* A long-lived box must not retain one string for every account for ever. Ten
   thousand UUIDs are a small cache; evicting the oldest is harmless because
   the ledger answers the next request with one indexed conflict/no-op. */
const MAX_KNOWN_ARRIVALS = 10_000;

function remember(ownerId: string): void {
  if (known.size >= MAX_KNOWN_ARRIVALS) {
    const oldest = known.values().next().value as string | undefined;
    if (oldest !== undefined) known.delete(oldest);
  }
  known.add(ownerId);
}

/** A seam, for tests. Both default to the real thing. */
export interface ArrivalDeps {
  /** True if this call created the row, false if it was already there. */
  readonly record?: (ownerId: string) => Promise<boolean>;
  readonly announce?: (ownerId: string, email: string) => Promise<unknown>;
}

async function recordArrival(ownerId: string): Promise<boolean> {
  const inserted = await getDb()
    .insert(readerArrivals)
    .values({ ownerId })
    .onConflictDoNothing({ target: readerArrivals.ownerId })
    .returning({ ownerId: readerArrivals.ownerId });
  return inserted.length > 0;
}

/**
 * The mail itself: the address, the account id, and the page that lists every
 * account.
 *
 * **The address is in it since 2026-10-01, at Greg's request**, reversing GPT
 * Sol's plan-review call to leave it out (each copy — Resend's log, the
 * forwarder, an inbox — is one more place an erasure has to reach). /privacy
 * says so. It is the reader's own text, so it goes through `oneLine` and never
 * into the subject. docs/plans/261001b-admin-sign-up-email-carries-the-address.md.
 */
export function arrivalMessage(ownerId: string, email: string): { subject: string; text: string } {
  return {
    subject: "New sign-up on Spideryarn",
    text: [
      "Somebody new has signed up and signed in for the first time.",
      "",
      `Email: ${oneLine(email)}`,
      `Account id: ${ownerId}`,
      "",
      `All users: ${ADMIN_USERS_URL}`,
    ].join("\n"),
  };
}

export async function announceArrival(ownerId: string, email: string): Promise<unknown> {
  return await notifyAdmin(arrivalMessage(ownerId, email), "sign-up");
}

/**
 * Note that this account has made a request, and announce it if it is the
 * first. Never throws. `email` is the verified token's (`requireUser`).
 */
export async function noteArrival(ownerId: string, email: string, deps: ArrivalDeps = {}): Promise<void> {
  if (known.has(ownerId)) return;
  let isNew: boolean;
  try {
    isNew = await (deps.record ?? recordArrival)(ownerId);
  } catch (err) {
    logger.error(errorFields(err), "could not record an account's arrival");
    return;
  }
  remember(ownerId);
  if (!isNew) return;
  try {
    await (deps.announce ?? announceArrival)(ownerId, email);
  } catch (err) {
    logger.error(errorFields(err), "announcing a sign-up failed");
  }
}

/** Tests only: forget what this instance has seen. */
export function forgetKnownArrivals(): void {
  known.clear();
}
