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

import { type Articles, type Points, articles as articlesOf, budgetFor, ingestHeadroom } from "../billing/points.js";
import type { Gift } from "../billing-plan.js";
import { getDb } from "../db/client.js";
import { billingAccounts, billingVouchers } from "../db/schema.js";
import { noteText } from "../email.js";
import { log } from "../log.js";
import type { AccountByEmail, AccountConfirmation, AccountEmail } from "./admin-accounts.js";
import { accountEmail, confirmedAccountByEmail, confirmedAccountEmail } from "./admin-accounts.js";
import {
  accountSnapshot,
  entitlementFromRow,
  hasLapsed,
  ingestsUsed,
  lockBillingAccount,
  usageFor,
  wallUsed,
} from "./pg-billing.js";
import { allTiers } from "./pg-tiers.js";
import { READ_COMMITTED } from "./isolation.js";
import {
  type GiftAudience,
  latestVoucherEmails,
  queueClaimedEmail,
  queueGiftEmail,
  skipQueuedGifts,
} from "./pg-voucher-emails.js";
import type { AdminVoucher, ClaimantUsage } from "../admin-vouchers.js";
import { isUuid } from "../ids.js";

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

/** Seams for tests; each defaults to the real thing. */
export interface ClaimDeps {
  readonly lookup?: (ownerId: string) => Promise<AccountConfirmation>;
  /** The creator's notice, queued inside the claim's transaction. */
  readonly queueClaimed?: typeof queueClaimedEmail;
}

/**
 * What a claim did: how many vouchers it bound, and the creator notices it
 * queued — one per voucher — **committed**, so the caller may hand each to
 * `afterResponse`. Never register those tasks inside the transaction: a task
 * queued there would still run after a rollback, against a row that never was.
 */
export interface ClaimResult {
  readonly claimed: number;
  readonly deliveries: readonly string[];
}

const NOTHING_CLAIMED: ClaimResult = { claimed: 0, deliveries: [] };

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
 * 4. **And, in that same transaction, one creator notice per claimed voucher**
 *    (src/store/pg-voucher-emails.ts), rendered from the `UPDATE … RETURNING`.
 *    **The claim and its notices commit together**: if queueing one fails,
 *    neither the claim nor any notice commits, the route still serves the plan,
 *    and the next visit claims again. The lock order is the voucher (the
 *    `UPDATE`) and then its delivery (the insert).
 *
 * **Throws only on a database error**; the route catches that and serves the
 * plan anyway, because a failed claim is retried on the next visit.
 */
export async function claimVouchersFor(
  user: { readonly id: string; readonly email: string | null | undefined },
  deps: ClaimDeps = {},
): Promise<ClaimResult> {
  if (!user.email) return NOTHING_CLAIMED;
  const email = normaliseEmail(user.email);
  if (!looksLikeEmail(email)) return NOTHING_CLAIMED;

  const db = getDb();
  const [waiting] = await db
    .select({ id: billingVouchers.id })
    .from(billingVouchers)
    .where(
      and(eq(billingVouchers.email, email), isNull(billingVouchers.claimedBy), isNull(billingVouchers.revokedAt)),
    )
    .limit(1);
  if (!waiting) return NOTHING_CLAIMED;

  const confirmation = await (deps.lookup ?? confirmedAccountEmail)(user.id);
  if (confirmation.kind !== "confirmed" || normaliseEmail(confirmation.email) !== email) {
    /* The kind and nothing else: never the address. */
    logger.info(
      { ownerId: user.id, lookup: confirmation.kind },
      "a gift voucher is waiting for this address, and the Auth service did not confirm it is theirs — not claimed",
    );
    return NOTHING_CLAIMED;
  }

  const queueClaimed = deps.queueClaimed ?? queueClaimedEmail;
  const answer = await db.transaction(
    async (tx): Promise<ClaimResult> => {
      await tx.insert(billingAccounts).values({ ownerId: user.id }).onConflictDoNothing({
        target: billingAccounts.ownerId,
      });
      const claimed = await tx
        .update(billingVouchers)
        .set({ claimedBy: user.id, claimedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            isNull(billingVouchers.claimedBy),
            isNull(billingVouchers.revokedAt),
            eq(billingVouchers.email, email),
          ),
        )
        .returning({
          id: billingVouchers.id,
          email: billingVouchers.email,
          articles: billingVouchers.articles,
          createdAt: billingVouchers.createdAt,
          claimedAt: billingVouchers.claimedAt,
        });
      const deliveries: string[] = [];
      for (const voucher of claimed) {
        const delivery = await queueClaimed(tx, voucher.id, {
          claimantEmail: voucher.email,
          ownerId: user.id,
          articles: voucher.articles,
          createdAt: voucher.createdAt,
          /* Set by this very statement, so never null here. */
          claimedAt: voucher.claimedAt ?? new Date(),
        });
        if (delivery) deliveries.push(delivery);
      }
      return { claimed: claimed.length, deliveries };
    },
    /* Pinned, for the reason `reserveIngest` gives: `on conflict do nothing` is
       only an escape from a concurrent writer at read committed. */
    READ_COMMITTED,
  );
  if (answer.claimed > 0) {
    logger.info({ ownerId: user.id, vouchers: answer.claimed }, "gift vouchers claimed");
  }
  return answer;
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
  const emails = await latestVoucherEmails(rows.map((r) => r.id));
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
      recipientNote: row.recipientNote,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
      updatedAt: row.updatedAt.toISOString(),
      claimedBy: row.claimedBy,
      claimedAt: row.claimedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      claimantEmail: claimant?.email ?? null,
      ...(claimant ? { claimant: claimant.usage } : {}),
      emails: emails.get(row.id) ?? { gift: null, claimed: null },
    };
  });
}

/** One account's standing, decided by `entitlementFromRow` like every other surface. */
async function standingOf(
  ownerId: string,
  tiers: Awaited<ReturnType<typeof allTiers>>,
): Promise<
  | { readonly kind: "unknown" }
  | { readonly kind: "paid"; readonly tierId: string }
  | { readonly kind: "free"; readonly used: number; readonly limit: Articles; readonly wallUsed: Points; readonly lapsed: boolean }
> {
  const row = await accountSnapshot(ownerId);
  const entitlement = entitlementFromRow(row, tiers, new Date());
  if ("kind" in entitlement) return { kind: "unknown" };
  if (entitlement.tier === "paid") return { kind: "paid", tierId: entitlement.tierId };
  const usage = await usageFor(ownerId, entitlement);
  return {
    kind: "free",
    used: ingestsUsed(usage),
    limit: entitlement.limit,
    wallUsed: wallUsed(usage),
    lapsed: hasLapsed(row),
  };
}

/** One claimant's standing, for the admin table's *how used* column. */
async function claimantUsage(ownerId: string, tiers: Awaited<ReturnType<typeof allTiers>>): Promise<ClaimantUsage> {
  const standing = await standingOf(ownerId, tiers);
  if (standing.kind !== "free") return standing;
  return {
    kind: "free",
    used: standing.used,
    limit: standing.limit,
    remaining: ingestHeadroom(standing.wallUsed, budgetFor(standing.limit)),
    lapsed: standing.lapsed,
  };
}

/** Seams for tests; each defaults to the real thing. */
export interface VoucherWriteDeps {
  /** Who the recipient's email is written for. */
  readonly audience?: (normalisedEmail: string) => Promise<GiftAudience>;
}

/**
 * **Who the recipient's email is written for**: an existing reader — exactly
 * one account with this address confirmed — with their plan as of now, or
 * anybody else, who is invited. Asked **before** the event's transaction,
 * because it is a network call, and frozen into the queued email with the rest.
 * docs/plans/261002a-fb99-voucher-email-for-existing-user.md.
 *
 * **Never throws.** A failed lookup, or a failed read of the reader's plan,
 * falls back: the first to the invitation (true for anybody), the second to the
 * reader's email without numbers. Logged by label, never with the address.
 */
export async function giftAudienceFor(
  normalisedEmail: string,
  deps: {
    readonly lookup?: (email: string) => Promise<AccountByEmail>;
    readonly standing?: (ownerId: string) => Promise<Awaited<ReturnType<typeof standingOf>>>;
  } = {},
): Promise<GiftAudience> {
  let found: AccountByEmail;
  try {
    found = await (deps.lookup ?? confirmedAccountByEmail)(normalisedEmail);
  } catch (err) {
    /* The real lookup returns `unavailable`, but keep the fallback at this
       boundary too: an Auth/listing failure must not fail the voucher write. */
    logger.warn(
      { error: err instanceof Error ? err.name : "unknown error" },
      "voucher email: account lookup failed, inviting",
    );
    return { kind: "invite" };
  }
  if (found.kind !== "one") {
    if (found.kind === "unavailable") {
      /* `reason` is deliberately not repeated: a future lookup must not be
         able to put an address or provider response into a log line. */
      logger.warn("voucher email: account lookup unavailable, inviting");
    }
    return { kind: "invite" };
  }
  try {
    const standing = await (deps.standing ?? (async (owner: string) => standingOf(owner, await allTiers())))(found.id);
    if (standing.kind !== "free") return { kind: "reader", plan: { kind: standing.kind } };
    /* **Gifts already waiting at this address** are claimed with this one, by
       the same `UPDATE` the next visit makes, so the *after* counts them too
       (Sol, 261002a F5). This voucher is not among them: on create it is not
       inserted yet, and on a readdress it is still at its old address. */
    const [waiting] = await getDb()
      .select({ articles: sql<number>`coalesce(sum(${billingVouchers.articles}), 0)::int`.mapWith(Number) })
      .from(billingVouchers)
      .where(
        and(
          eq(billingVouchers.email, normalisedEmail),
          isNull(billingVouchers.claimedBy),
          isNull(billingVouchers.revokedAt),
        ),
      );
    return {
      kind: "reader",
      plan: {
        kind: "free",
        limit: standing.limit,
        wallUsed: standing.wallUsed,
        waiting: articlesOf(waiting?.articles ?? 0),
      },
    };
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.name : "unknown error" },
      "voucher email: reader's plan unreadable, writing without numbers",
    );
    return { kind: "reader", plan: { kind: "unknown" } };
  }
}

/** What `/admin/vouchers` may create. Validated by the route before it arrives. */
export interface NewVoucher {
  /**
   * **Minted by the browser** (`crypto.randomUUID()`), so a replayed create —
   * a proxy's retry, a double submit — is the same create rather than a second
   * voucher and a second email (Sol F2).
   */
  readonly id: string;
  readonly email: string;
  readonly articles: number;
  readonly note: string | null;
  /** The note to the recipient, put in their email. Plan 261002b. */
  readonly recipientNote: string | null;
}

export type CreateVoucherAnswer =
  /** `delivery` is the recipient's email, queued and committed with the voucher. */
  | { readonly kind: "created"; readonly id: string; readonly delivery: string }
  /** The same body under the same id: the original, and nothing queued. */
  | { readonly kind: "replayed"; readonly id: string }
  /** That id is a different voucher. */
  | { readonly kind: "conflict" };

/**
 * **Make one voucher, and queue its recipient's email in the same
 * transaction.** It then waits, unclaimed, until its address asks for a plan.
 *
 * `on conflict (id) do nothing`: a replay under the same id finds the original,
 * and is `replayed` only if the stored address, articles, note and creator are
 * exactly what it carries; anything else under that id is a `conflict`. The
 * email is queued only when this call's insert is the one that inserted.
 */
export async function createVoucher(
  input: NewVoucher,
  createdBy: string,
  deps: VoucherWriteDeps = {},
): Promise<CreateVoucherAnswer> {
  const email = normaliseEmail(input.email);
  /* Before the transaction: a network call does not belong inside one. */
  const audience = await giftAudienceOrInvite(email, deps.audience ?? giftAudienceFor);
  return await getDb().transaction(
    async (tx): Promise<CreateVoucherAnswer> => {
      const [row] = await tx
        .insert(billingVouchers)
        .values({
          id: input.id,
          email,
          articles: input.articles,
          note: input.note,
          recipientNote: input.recipientNote,
          createdBy,
        })
        .onConflictDoNothing({ target: billingVouchers.id })
        .returning({ id: billingVouchers.id });
      if (row) {
        const delivery = await queueGiftEmail(tx, row.id, email, input.articles, audience, input.recipientNote);
        return { kind: "created", id: row.id, delivery };
      }
      const [existing] = await tx
        .select({
          email: billingVouchers.email,
          articles: billingVouchers.articles,
          note: billingVouchers.note,
          recipientNote: billingVouchers.recipientNote,
          createdBy: billingVouchers.createdBy,
        })
        .from(billingVouchers)
        .where(eq(billingVouchers.id, input.id))
        .limit(1);
      const same =
        existing !== undefined &&
        existing.email === email &&
        existing.articles === input.articles &&
        existing.note === input.note &&
        existing.recipientNote === input.recipientNote &&
        existing.createdBy === createdBy;
      return same ? { kind: "replayed", id: input.id } : { kind: "conflict" };
    },
    /* A concurrent replay waits on the first insert's key, then does nothing
       and reads the committed original — which needs a fresh snapshot per
       statement, as `reserveIngest` explains. */
    READ_COMMITTED,
  );
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
  const unknown = Object.keys(body).filter(
    (key) => !["id", "email", "articles", "note", "recipientNote"].includes(key),
  );
  if (unknown.length > 0) return { ok: false, message: `Unexpected field: ${unknown.join(", ")}.` };
  if (typeof body.id !== "string" || !isUuid(body.id)) return { ok: false, message: "id must be a uuid." };
  const email = parseEmail(body.email);
  if (!email.ok) return email;
  const articles = parseArticles(body.articles);
  if (!articles.ok) return articles;
  const note = parseNote(body.note ?? null);
  if (!note.ok) return note;
  const recipientNote = parseNote(body.recipientNote ?? null, "recipientNote");
  if (!recipientNote.ok) return recipientNote;
  return {
    ok: true,
    value: {
      id: body.id.toLowerCase(),
      email: email.value,
      articles: articles.value,
      note: note.value,
      recipientNote: recipientNote.value,
    },
  };
}

/** What `PATCH /api/admin/vouchers/:id` may carry: any of five fields, at least one. */
export function parseVoucherPatch(body: unknown): Parsed<VoucherPatch> {
  if (!isPlainObject(body)) return { ok: false, message: "Expected a JSON object." };
  const keys = Object.keys(body);
  const unknown = keys.filter((key) => !["email", "articles", "note", "recipientNote", "revoked"].includes(key));
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
  if ("recipientNote" in body) {
    const recipientNote = parseNote(body.recipientNote, "recipientNote");
    if (!recipientNote.ok) return recipientNote;
    patch.recipientNote = recipientNote.value;
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

/**
 * A blank note is no note. The same rule for the private note and the note to
 * the recipient, which have the same limit in the table.
 *
 * **Counted in code points**, as Postgres' `char_length` counts, not in UTF-16
 * units as `.length` does — so an emoji-heavy note the table would take is not
 * refused here, and one it would refuse is a 400 rather than a 500.
 */
function parseNote(value: unknown, field: "note" | "recipientNote" = "note"): Parsed<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, message: `${field} must be a string or null.` };
  /* The note to the recipient reaches a stranger's inbox, so its line breaks
     and control characters are made plain before it is stored (`noteText`). */
  const note = field === "recipientNote" ? noteText(value) : value.trim();
  if ([...note].length > VOUCHER_NOTE_MAX) {
    return { ok: false, message: `${field} must be at most ${VOUCHER_NOTE_MAX} characters.` };
  }
  return { ok: true, value: note === "" ? null : note };
}

/** A change to one voucher. Every field optional; validated by the route. */
export interface VoucherPatch {
  readonly articles?: number;
  readonly note?: string | null;
  /**
   * The note to the recipient. **Changing it sends nothing**: an email is
   * frozen when it is queued. A new address in the same patch is sent with it.
   */
  readonly recipientNote?: string | null;
  /** Only while unclaimed — once claimed the voucher belongs to the account. */
  readonly email?: string;
  /** True revokes (keeping the row); false restores. */
  readonly revoked?: boolean;
}

export type VoucherUpdate =
  /**
   * `giftDelivery` is present only when the address really changed on an
   * unclaimed, unrevoked voucher: the recipient's email to the new address,
   * queued and committed with the change, for the caller to send after its
   * response.
   */
  | { readonly kind: "updated"; readonly giftDelivery?: string }
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
export async function updateVoucher(id: string, patch: VoucherPatch, deps: VoucherWriteDeps = {}): Promise<VoucherUpdate> {
  /* Asked only when the address is being set, and before any transaction: it
     is a network call. Whether it is a *real* change is decided inside. */
  const audience =
    patch.email === undefined
      ? undefined
      : await giftAudienceOrInvite(normaliseEmail(patch.email), deps.audience ?? giftAudienceFor);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = await updateOnce(id, patch, audience);
    if (answer !== "retry") return answer;
  }
  throw new Error(`updating gift voucher ${id} kept racing its claim`);
}

/** The write's last fail-open boundary: audience enrichment never owns the voucher event. */
async function giftAudienceOrInvite(
  normalisedEmail: string,
  resolve: (email: string) => Promise<GiftAudience>,
): Promise<GiftAudience> {
  try {
    return await resolve(normalisedEmail);
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.name : "unknown error" },
      "voucher email: audience unavailable, inviting",
    );
    return { kind: "invite" };
  }
}

async function updateOnce(
  id: string,
  patch: VoucherPatch,
  audience: GiftAudience | undefined,
): Promise<VoucherUpdate | "retry"> {
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
        .select({
          claimedBy: billingVouchers.claimedBy,
          revokedAt: billingVouchers.revokedAt,
          email: billingVouchers.email,
          articles: billingVouchers.articles,
          recipientNote: billingVouchers.recipientNote,
        })
        .from(billingVouchers)
        .where(eq(billingVouchers.id, id))
        .for("update")
        .limit(1);
      if (!current) return { kind: "not-found" };
      if (current.claimedBy !== seen.claimedBy) return "retry";
      if (patch.email !== undefined && current.claimedBy) return { kind: "claimed" };

      /* **A real change only**: the same address again — a replayed PATCH, or a
         concurrent one that committed first — sends nothing (Sol, review 2 F3). */
      const newEmail = patch.email === undefined ? undefined : normaliseEmail(patch.email);
      const readdressed = newEmail !== undefined && newEmail !== current.email;
      const revokedAfter = patch.revoked === undefined ? current.revokedAt !== null : patch.revoked;

      await tx
        .update(billingVouchers)
        .set({
          ...(patch.articles === undefined ? {} : { articles: patch.articles }),
          ...(patch.note === undefined ? {} : { note: patch.note }),
          ...(patch.recipientNote === undefined ? {} : { recipientNote: patch.recipientNote }),
          ...(newEmail === undefined ? {} : { email: newEmail }),
          /* Revoking an already revoked voucher keeps its first date. */
          ...(patch.revoked === undefined
            ? {}
            : patch.revoked
              ? { revokedAt: current.revokedAt ?? sql`now()` }
              : { revokedAt: null }),
          updatedAt: sql`now()`,
        })
        .where(eq(billingVouchers.id, id));

      /* Voucher locked above, then its deliveries — the house order
         (src/store/pg-voucher-emails.ts § Lock order). A revoke cancels the
         gift emails that have not started; a new address cancels the ones
         still waiting for the old one, and queues its own. */
      if (patch.revoked === true) await skipQueuedGifts(tx, id, "voucher revoked");
      if (readdressed && newEmail !== undefined && !revokedAfter) {
        await skipQueuedGifts(tx, id, "address changed");
        const giftDelivery = await queueGiftEmail(
          tx,
          id,
          newEmail,
          patch.articles ?? current.articles,
          audience ?? { kind: "invite" },
          /* The note as it stands after this patch. */
          patch.recipientNote === undefined ? current.recipientNote : patch.recipientNote,
        );
        return { kind: "updated", giftDelivery };
      }
      return { kind: "updated" };
    },
    READ_COMMITTED,
  );
}
