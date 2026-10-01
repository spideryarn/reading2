/**
 * **Is this account new?** Asked once per account per server instance. The
 * database gives one request at a time the right to announce it; a failed
 * announcement gives that right back.
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
 * **A mail that did not go out gives the claim back.** `sendEmail` never
 * throws, so a Resend outage arrives as a `failed` value; the row this request
 * inserted is deleted and the account forgotten here, so the reader's next
 * request tries again. That permits duplicates (a send that timed out after
 * Resend accepted it can be sent twice), and the retry is best-effort: another
 * instance that lost the insert race keeps the account in its cache, and a
 * release that itself fails may leave the row. SPIDERYARN-READING2-79,
 * docs/plans/261001b-sign-up-mail-retried-when-a-send-fails.md.
 *
 * docs/plans/260930i-email-admin-on-sign-up-and-plan-upgrade.md.
 */

import { eq } from "drizzle-orm";

import { getDb } from "./db/client.js";
import { readerArrivals } from "./db/schema.js";
import { notifyAdmin, oneLine, type SendResult } from "./email.js";
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

/** A seam, for tests. All three default to the real thing. */
export interface ArrivalDeps {
  /** True if this call created the row, false if it was already there. */
  readonly record?: (ownerId: string) => Promise<boolean>;
  readonly announce?: (ownerId: string, email: string) => Promise<SendResult>;
  /** Undo `record`, after an announcement that did not go out. */
  readonly release?: (ownerId: string) => Promise<void>;
}

async function recordArrival(ownerId: string): Promise<boolean> {
  const inserted = await getDb()
    .insert(readerArrivals)
    .values({ ownerId })
    .onConflictDoNothing({ target: readerArrivals.ownerId })
    .returning({ ownerId: readerArrivals.ownerId });
  return inserted.length > 0;
}

async function releaseArrival(ownerId: string): Promise<void> {
  await getDb().delete(readerArrivals).where(eq(readerArrivals.ownerId, ownerId));
}

/**
 * Did the admin's mail go out, or was it deliberately not sent? A laptop is
 * not a lost announcement; a production process with no key is. Exhaustive, so
 * a new `SkipReason` has to be decided here.
 */
function announced(result: SendResult): boolean {
  switch (result.kind) {
    case "sent":
      return true;
    case "failed":
      return false;
    case "skipped": {
      const reason = result.reason;
      switch (reason) {
        case "not production":
          return true;
        case "no RESEND_API_KEY":
          return false;
        default: {
          const unhandled: never = reason;
          return unhandled;
        }
      }
    }
    default: {
      const unhandled: never = result;
      return unhandled;
    }
  }
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

export async function announceArrival(ownerId: string, email: string): Promise<SendResult> {
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
  let ok: boolean;
  try {
    ok = announced(await (deps.announce ?? announceArrival)(ownerId, email));
  } catch (err) {
    logger.error(errorFields(err), "announcing a sign-up failed");
    ok = false;
  }
  if (ok) return;
  /* `sendEmail` has already logged why. */
  try {
    await (deps.release ?? releaseArrival)(ownerId);
  } catch (err) {
    logger.error(errorFields(err), "could not release an unannounced arrival; that sign-up may not be announced");
  }
  /* Keep overlapping requests behind the cache until the row is gone. If the
     release failed (including with an ambiguous outcome), forget it anyway so
     the next request asks the ledger what actually happened. */
  known.delete(ownerId);
}

/** Tests only: forget what this instance has seen. */
export function forgetKnownArrivals(): void {
  known.clear();
}
