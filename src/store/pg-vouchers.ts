/**
 * **Gift vouchers** — extra free articles, given by the administrator to an
 * email address, and bound to an account the first time a reader with that
 * confirmed address asks for their plan.
 * docs/plans/261001m-gift-vouchers-for-free-articles.md, and
 * docs/project/billing.md § *Gift vouchers*.
 *
 * Three kinds of thing live here, and only the first is reachable by a reader:
 *
 * 1. **The claim** (`claimVouchersFor`) — the one reader-triggered write. It can
 *    only stamp *the caller's own id* onto a voucher *already addressed to the
 *    caller's address*, and only after the Auth service's own record agrees the
 *    address is theirs and confirmed. Any doubt and it does not claim; failing
 *    to claim is the safe direction, and the next visit tries again.
 * 2. **What a reader is told** (`giftsFor`) — the active gifts, with the
 *    article count and the date. Never the note, the creator or the address.
 * 3. **The administrator's** list, create and update, called only from the
 *    routes under `/api/admin/vouchers`, behind the namespace gate.
 *
 * ## The lock order, and why a revoke takes the billing lock
 *
 * The bonus is part of the allowance the wall enforces, so lowering it must
 * serialise with admission exactly as an unshare does: **every change to a
 * claimed voucher locks the claimant's `billing_accounts` row first**
 * (`lockBillingAccount`, the house order in src/store/pg-billing.ts), and only
 * then the voucher. Admission reads the bonus in a statement *after* it takes
 * that lock, so a revoke that commits while an admission waits is seen by it,
 * and one that waits behind an admission lands after the slot was taken against
 * the old allowance — which is the same as revoking a second later.
 *
 * The claim takes no billing lock. It only ever *raises* an allowance, and a
 * raise that an in-progress admission misses refuses one ingest that a reload
 * would admit — the cheap direction.
 */

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { budgetFor, privateHeadroom } from "../billing/half-units.js";
import type { Gift } from "../billing-plan.js";
import { getDb } from "../db/client.js";
import { billingAccounts, billingVouchers } from "../db/schema.js";
import { log } from "../log.js";
import type { AccountConfirmation, AccountEmail } from "./admin-accounts.js";
import { accountEmail, confirmedAccountEmail } from "./admin-accounts.js";
import {
  accountSnapshot,
  entitlementFromRow,
  halfUnitsUsed,
  hasLapsed,
  ingestsUsed,
  lockBillingAccount,
  usageFor,
} from "./pg-billing.js";
import { allTiers } from "./pg-tiers.js";
import { READ_COMMITTED } from "./isolation.js";

const logger = log("store");

/** The largest gift one voucher may carry. The table's check says the same. */
export const VOUCHER_MAX_ARTICLES = 1000;
/** The longest private note. The table's check says the same. */
export const VOUCHER_NOTE_MAX = 500;

/**
 * **An address as the table stores it**: trimmed and lower-cased. The check
 * constraint `billing_vouchers_email_normalised` refuses anything else, so a
 * writer that forgets this fails loudly rather than storing an address the
 * claim can never match.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** A shape check, not a deliverability check: something, an @, something. */
export function looksLikeEmail(normalised: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(normalised) && normalised.length <= 320;
}

/* ------------------------------------------------------------- the claim -- */

/** A seam for tests; defaults to the Auth Admin API. */
export interface ClaimDeps {
  readonly lookup?: (ownerId: string) => Promise<AccountConfirmation>;
}

/**
 * **Bind every waiting voucher addressed to this reader to this reader.**
 * Returns how many were claimed by this call; zero is the ordinary answer.
 *
 * Called from `GET /api/billing/usage` before the plan is read — an
 * intentional, idempotent write in a GET, documented there.
 *
 * 1. **The cheap question first**: is there an unclaimed, unrevoked voucher for
 *    this address at all? Almost never, and then nothing else happens — no
 *    network call, no transaction.
 * 2. **The address is verified twice.** The JWT's `email` is signed, but
 *    whether an unconfirmed address can sign in rests on a dashboard setting
 *    (docs/project/admin.md), so the Auth service's own record must have the
 *    same address **and** `email_confirmed_at`. Outside any transaction, because
 *    it is a network call.
 * 3. **One transaction**: the billing anchor (`on conflict do nothing`) — the
 *    voucher's foreign key points at it, and it is what makes the bonus visible
 *    to every read that treats "no row" as plain Free — then one `UPDATE … WHERE
 *    claimed_by IS NULL AND revoked_at IS NULL AND email = $1`. A voucher is
 *    claimed by exactly one statement, so two concurrent reads cannot claim it
 *    twice, and an administrator who changed the address or revoked it a moment
 *    earlier wins.
 *
 * **Throws only on a database error**; the route catches that and serves the
 * plan anyway, because a failed claim is retried on the next visit.
 */
export async function claimVouchersFor(
  user: { readonly id: string; readonly email: string | null | undefined },
  deps: ClaimDeps = {},
): Promise<number> {
  if (!user.email) return 0;
  const email = normaliseEmail(user.email);
  if (!looksLikeEmail(email)) return 0;

  const db = getDb();
  const [waiting] = await db
    .select({ id: billingVouchers.id })
    .from(billingVouchers)
    .where(
      and(eq(billingVouchers.email, email), isNull(billingVouchers.claimedBy), isNull(billingVouchers.revokedAt)),
    )
    .limit(1);
  if (!waiting) return 0;

  const confirmation = await (deps.lookup ?? confirmedAccountEmail)(user.id);
  if (confirmation.kind !== "confirmed" || normaliseEmail(confirmation.email) !== email) {
    /* The kind and nothing else: never the address. */
    logger.info(
      { ownerId: user.id, lookup: confirmation.kind },
      "a gift voucher is waiting for this address, and the Auth service did not confirm it is theirs — not claimed",
    );
    return 0;
  }

  const claimed = await db.transaction(
    async (tx) => {
      await tx.insert(billingAccounts).values({ ownerId: user.id }).onConflictDoNothing({
        target: billingAccounts.ownerId,
      });
      return await tx
        .update(billingVouchers)
        .set({ claimedBy: user.id, claimedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            isNull(billingVouchers.claimedBy),
            isNull(billingVouchers.revokedAt),
            eq(billingVouchers.email, email),
          ),
        )
        .returning({ id: billingVouchers.id });
    },
    /* Pinned, for the reason `reserveIngest` gives: `on conflict do nothing` is
       only an escape from a concurrent writer at read committed. */
    READ_COMMITTED,
  );
  if (claimed.length > 0) {
    logger.info({ ownerId: user.id, vouchers: claimed.length }, "gift vouchers claimed");
  }
  return claimed.length;
}

/* ------------------------------------------------- what the reader sees -- */

/**
 * **The gifts this reader holds**, oldest first — claimed and not revoked.
 * Empty for almost everybody, and the summary then leaves the field off
 * altogether, so no surface can mention vouchers to somebody without one.
 *
 * The voucher id goes out as `noticeKey`, an opaque string the homepage keys
 * its dismissal on; it grants nothing, since every write is admin-only.
 */
export async function giftsFor(ownerId: string): Promise<Gift[]> {
  const rows = await getDb()
    .select({ id: billingVouchers.id, articles: billingVouchers.articles, claimedAt: billingVouchers.claimedAt })
    .from(billingVouchers)
    .where(and(eq(billingVouchers.claimedBy, ownerId), isNull(billingVouchers.revokedAt)))
    .orderBy(asc(billingVouchers.claimedAt), asc(billingVouchers.id));
  return rows.flatMap((row) =>
    row.claimedAt ? [{ articles: row.articles, claimedAt: row.claimedAt.toISOString(), noticeKey: row.id }] : [],
  );
}

/* -------------------------------------------------- the administrator's -- */

/**
 * The claimant's standing, for the admin table's *how used* column.
 *
 * `free` is the only state in which the gift is doing anything; `paid` says it
 * is bound and waiting for them to be back on Free; `unknown` is a stored
 * period that does not contain now, as `/profile` says it.
 */
export type ClaimantUsage =
  | {
      readonly kind: "free";
      /** Ingests counted against the allowance, as `/profile`'s `used`. */
      readonly used: number;
      /** The whole Free allowance, gifts included. */
      readonly limit: number;
      /** Further private articles the wall would admit — `privateHeadroom`. */
      readonly remaining: number;
      /** Back on Free after a subscription ended. */
      readonly lapsed: boolean;
    }
  | { readonly kind: "paid"; readonly tierId: string }
  | { readonly kind: "unknown" };

/** One voucher as `/admin/vouchers` draws it. Admin-only: it carries the note. */
export interface AdminVoucher {
  readonly id: string;
  readonly email: string;
  readonly articles: number;
  readonly note: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly claimedBy: string | null;
  readonly claimedAt: string | null;
  readonly revokedAt: string | null;
  /** The claimant's current address, from the Auth service; null when it could not say. */
  readonly claimantEmail: string | null;
  /** Present only for a claimed voucher. */
  readonly claimant?: ClaimantUsage;
}

/** A seam for tests; defaults to the Auth Admin API. */
export interface ListDeps {
  readonly lookupEmail?: (ownerId: string) => Promise<AccountEmail>;
}

/**
 * **Every voucher, newest first**, with each claimant's current address and
 * standing. Not owner-scoped — the admin routes are its only caller.
 *
 * The address and the usage are asked once per *claimant*, not per voucher.
 * The address is the Auth service's (`accountEmail`, the same lookup the upgrade
 * notice uses), because the voucher's own address is only what it was sent to.
 */
export async function listVouchers(deps: ListDeps = {}): Promise<AdminVoucher[]> {
  const rows = await getDb().select().from(billingVouchers).orderBy(desc(billingVouchers.createdAt));
  const claimants = [...new Set(rows.flatMap((r) => (r.claimedBy ? [r.claimedBy] : [])))];
  const tiers = claimants.length > 0 ? await allTiers() : [];
  const lookupEmail = deps.lookupEmail ?? accountEmail;
  const facts = new Map(
    await Promise.all(
      claimants.map(async (owner) => {
        const [found, usage] = await Promise.all([lookupEmail(owner), claimantUsage(owner, tiers)]);
        return [owner, { email: found.kind === "found" ? found.email : null, usage }] as const;
      }),
    ),
  );
  return rows.map((row) => {
    const claimant = row.claimedBy ? facts.get(row.claimedBy) : undefined;
    return {
      id: row.id,
      email: row.email,
      articles: row.articles,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
      updatedAt: row.updatedAt.toISOString(),
      claimedBy: row.claimedBy,
      claimedAt: row.claimedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      claimantEmail: claimant?.email ?? null,
      ...(claimant ? { claimant: claimant.usage } : {}),
    };
  });
}

/** One claimant's standing, decided by `entitlementFromRow` like every other surface. */
async function claimantUsage(ownerId: string, tiers: Awaited<ReturnType<typeof allTiers>>): Promise<ClaimantUsage> {
  const row = await accountSnapshot(ownerId);
  const entitlement = entitlementFromRow(row, tiers, new Date());
  if ("kind" in entitlement) return { kind: "unknown" };
  if (entitlement.tier === "paid") return { kind: "paid", tierId: entitlement.tierId };
  const usage = await usageFor(ownerId, entitlement);
  return {
    kind: "free",
    used: ingestsUsed(usage),
    limit: entitlement.limit,
    remaining: privateHeadroom(halfUnitsUsed(usage), budgetFor(entitlement.limit)),
    lapsed: hasLapsed(row),
  };
}

/** What `/admin/vouchers` may create. Validated by the route before it arrives. */
export interface NewVoucher {
  readonly email: string;
  readonly articles: number;
  readonly note: string | null;
}

/** Make one voucher. It waits, unclaimed, until its address asks for a plan. */
export async function createVoucher(input: NewVoucher, createdBy: string): Promise<{ id: string }> {
  const [row] = await getDb()
    .insert(billingVouchers)
    .values({ email: normaliseEmail(input.email), articles: input.articles, note: input.note, createdBy })
    .returning({ id: billingVouchers.id });
  if (!row) throw new Error("creating a gift voucher returned no row");
  return row;
}

/** A parsed request body, or the sentence a 400 says. */
export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/**
 * **What `POST /api/admin/vouchers` may carry, checked strictly** — the
 * administrator is trusted, but this number raises what an account may spend,
 * so a typo should be a 400 rather than a thousand articles. Unknown keys are
 * refused too, so a misspelt `artcles` does not become a voucher with a default.
 */
export function parseNewVoucher(body: unknown): Parsed<NewVoucher> {
  if (!isPlainObject(body)) return { ok: false, message: "Expected a JSON object." };
  const unknown = Object.keys(body).filter((key) => !["email", "articles", "note"].includes(key));
  if (unknown.length > 0) return { ok: false, message: `Unexpected field: ${unknown.join(", ")}.` };
  const email = parseEmail(body.email);
  if (!email.ok) return email;
  const articles = parseArticles(body.articles);
  if (!articles.ok) return articles;
  const note = parseNote(body.note ?? null);
  if (!note.ok) return note;
  return { ok: true, value: { email: email.value, articles: articles.value, note: note.value } };
}

/** What `PATCH /api/admin/vouchers/:id` may carry: any of four fields, at least one. */
export function parseVoucherPatch(body: unknown): Parsed<VoucherPatch> {
  if (!isPlainObject(body)) return { ok: false, message: "Expected a JSON object." };
  const keys = Object.keys(body);
  const unknown = keys.filter((key) => !["email", "articles", "note", "revoked"].includes(key));
  if (unknown.length > 0) return { ok: false, message: `Unexpected field: ${unknown.join(", ")}.` };
  if (keys.length === 0) return { ok: false, message: "Nothing to change." };
  const patch: { -readonly [K in keyof VoucherPatch]: VoucherPatch[K] } = {};
  if ("email" in body) {
    const email = parseEmail(body.email);
    if (!email.ok) return email;
    patch.email = email.value;
  }
  if ("articles" in body) {
    const articles = parseArticles(body.articles);
    if (!articles.ok) return articles;
    patch.articles = articles.value;
  }
  if ("note" in body) {
    const note = parseNote(body.note);
    if (!note.ok) return note;
    patch.note = note.value;
  }
  if ("revoked" in body) {
    if (typeof body.revoked !== "boolean") return { ok: false, message: "revoked must be true or false." };
    patch.revoked = body.revoked;
  }
  return { ok: true, value: patch };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseEmail(value: unknown): Parsed<string> {
  if (typeof value !== "string") return { ok: false, message: "email must be a string." };
  const email = normaliseEmail(value);
  return looksLikeEmail(email) ? { ok: true, value: email } : { ok: false, message: "That is not an email address." };
}

function parseArticles(value: unknown): Parsed<number> {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= VOUCHER_MAX_ARTICLES
    ? { ok: true, value }
    : { ok: false, message: `articles must be a whole number from 1 to ${VOUCHER_MAX_ARTICLES}.` };
}

/** A blank note is no note. */
function parseNote(value: unknown): Parsed<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, message: "note must be a string or null." };
  const note = value.trim();
  if (note.length > VOUCHER_NOTE_MAX) {
    return { ok: false, message: `note must be at most ${VOUCHER_NOTE_MAX} characters.` };
  }
  return { ok: true, value: note === "" ? null : note };
}

/** A change to one voucher. Every field optional; validated by the route. */
export interface VoucherPatch {
  readonly articles?: number;
  readonly note?: string | null;
  /** Only while unclaimed — once claimed the voucher belongs to the account. */
  readonly email?: string;
  /** True revokes (keeping the row); false restores. */
  readonly revoked?: boolean;
}

export type VoucherUpdate =
  | { readonly kind: "updated" }
  | { readonly kind: "not-found" }
  /** The address of a claimed voucher cannot change: it already belongs to an account. */
  | { readonly kind: "claimed" };

/**
 * **Change one voucher, in the house lock order.**
 *
 * A claimed voucher's claimant cannot change — nothing unclaims — so the
 * claimant is read unlocked first, their `billing_accounts` row is locked, and
 * only then the voucher. If the unlocked read saw it unclaimed and the locked
 * read finds it claimed (a claim landed in between), this transaction holds the
 * voucher without the billing lock, so it gives up and starts again; the second
 * attempt sees the claimant on the unlocked read. Two attempts are enough —
 * nothing claims a voucher twice — and a third is a bug, said loudly.
 */
export async function updateVoucher(id: string, patch: VoucherPatch): Promise<VoucherUpdate> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = await updateOnce(id, patch);
    if (answer !== "retry") return answer;
  }
  throw new Error(`updating gift voucher ${id} kept racing its claim`);
}

async function updateOnce(id: string, patch: VoucherPatch): Promise<VoucherUpdate | "retry"> {
  const db = getDb();
  const [seen] = await db
    .select({ claimedBy: billingVouchers.claimedBy })
    .from(billingVouchers)
    .where(eq(billingVouchers.id, id))
    .limit(1);
  if (!seen) return { kind: "not-found" };

  return await db.transaction(
    async (tx): Promise<VoucherUpdate | "retry"> => {
      /* Billing first, then the voucher — the order admission and the
         visibility switch take. See the header. */
      if (seen.claimedBy) await lockBillingAccount(tx, seen.claimedBy);
      const [current] = await tx
        .select({ claimedBy: billingVouchers.claimedBy, revokedAt: billingVouchers.revokedAt })
        .from(billingVouchers)
        .where(eq(billingVouchers.id, id))
        .for("update")
        .limit(1);
      if (!current) return { kind: "not-found" };
      if (current.claimedBy !== seen.claimedBy) return "retry";
      if (patch.email !== undefined && current.claimedBy) return { kind: "claimed" };

      await tx
        .update(billingVouchers)
        .set({
          ...(patch.articles === undefined ? {} : { articles: patch.articles }),
          ...(patch.note === undefined ? {} : { note: patch.note }),
          ...(patch.email === undefined ? {} : { email: normaliseEmail(patch.email) }),
          /* Revoking an already revoked voucher keeps its first date. */
          ...(patch.revoked === undefined
            ? {}
            : patch.revoked
              ? { revokedAt: current.revokedAt ?? sql`now()` }
              : { revokedAt: null }),
          updatedAt: sql`now()`,
        })
        .where(eq(billingVouchers.id, id));
      return { kind: "updated" };
    },
    READ_COMMITTED,
  );
}
