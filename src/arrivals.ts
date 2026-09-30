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
import { notifyAdmin } from "./email.js";
import { errorFields, log } from "./log.js";

const logger = log("store");

/**
 * Accounts this instance already knows have arrived. A cache, so a reader's
 * hundredth request costs a lookup rather than an insert; only ever added to
 * **after** the database has answered, so a failed insert is retried.
 */
const known = new Set<string>();

/** A seam, for tests. Both default to the real thing. */
export interface ArrivalDeps {
  /** True if this call created the row, false if it was already there. */
  readonly record?: (ownerId: string) => Promise<boolean>;
  readonly announce?: (ownerId: string) => Promise<unknown>;
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
 * The mail itself. **No address**, deliberately: a copy of it in Resend's log,
 * the forwarder and an inbox would be three more places an erasure has to
 * reach, and `/admin` already shows who the account is. GPT Sol, plan review.
 */
export async function announceArrival(ownerId: string): Promise<unknown> {
  return await notifyAdmin(
    {
      subject: "New sign-up on Spideryarn",
      text: [
        "Somebody new has signed up and signed in for the first time.",
        "",
        `Account id: ${ownerId}`,
        "",
        "Who it is: https://www.spideryarn.com/admin",
      ].join("\n"),
    },
    "sign-up",
  );
}

/** Note that this account has made a request, and announce it if it is the first. Never throws. */
export async function noteArrival(ownerId: string, deps: ArrivalDeps = {}): Promise<void> {
  if (known.has(ownerId)) return;
  let isNew: boolean;
  try {
    isNew = await (deps.record ?? recordArrival)(ownerId);
  } catch (err) {
    logger.error(errorFields(err), "could not record an account's arrival");
    return;
  }
  known.add(ownerId);
  if (!isNew) return;
  try {
    await (deps.announce ?? announceArrival)(ownerId);
  } catch (err) {
    logger.error(errorFields(err), "announcing a sign-up failed");
  }
}

/** Tests only: forget what this instance has seen. */
export function forgetKnownArrivals(): void {
  known.clear();
}
