/**
 * **Author gifts** — the draft of a gift voucher for the author of one of the
 * administrator's own articles, and the web-search lookups that fill it in.
 * docs/plans/261009u-author-gift-draft-voucher-from-the-add-page.md; the
 * tables are `author_gifts` and `author_lookups` (src/db/schema.ts).
 *
 * Called only from the routes under `/api/admin/author-gifts`, behind the
 * namespace gate, through `pgAuthorGiftStore` at the bottom (`guardDbStore`,
 * for pg-vouchers.ts's reason: a failed write must not carry an address or a
 * note into a log line), and from the after-response lookup
 * (src/author-lookup-start.ts), which uses `claimLookup` and `finishLookup`.
 *
 * ## A draft is not a voucher
 *
 * Nothing here writes `billing_vouchers` except through `createVoucher`, and
 * only from `sendAuthorGift`. So the claim, the entitlement, the gift-audience
 * sum and the email queue never see a draft (D1).
 *
 * ## Lock order
 *
 * **The gift, then its lookup.** `beginLookup` and `finishLookup` both lock the
 * gift row first (R2-F5), so a finish and a begin, or a finish and a PATCH,
 * serialise on one row. *Send* freezes with one conditional `UPDATE` on the
 * gift, and PATCH refuses a frozen row inside its own conditional `UPDATE`, so
 * an edit and a send cannot interleave (Sol's F1). `createVoucher` runs after
 * the freeze has committed, outside any transaction here, and takes its own
 * locks (pg-vouchers.ts).
 */

import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import {
  AUTHOR_GIFT_NOTES_MAX,
  AUTHOR_LOOKUP_STALE_MINUTES,
  type AdminAuthorGift,
  type AdminAuthorLookup,
  type AuthorGiftStatus,
  type AuthorLookupOutcome,
} from "../admin-author-gifts.js";
import { RECIPIENT_NAME_MAX, cleanRecipientName } from "../admin-vouchers.js";
import { getDb } from "../db/client.js";
import { articleRevisions, articles, authorGifts, authorLookups, billingVouchers } from "../db/schema.js";
import { isSlug } from "../ingest.js";
import { log } from "../log.js";
import { type OwnerId, runAsOwner } from "../owner.js";
import { spendByRun } from "./ai-calls-spend-pg.js";
import { guardDbStore } from "./db-errors.js";
import { READ_COMMITTED } from "./isolation.js";
import { ownedSlug } from "./owned-slug.js";
import { pgShareLinkStore } from "./pg-share-link.js";
import { latestVoucherEmails } from "./pg-voucher-emails.js";
import {
  type CreateVoucherAnswer,
  type NewVoucher,
  type Parsed,
  type StarterRefusal,
  createVoucher,
  isPlainObject,
  looksLikeEmail,
  normaliseEmail,
  parseArticles,
  parseEmail,
  parseName,
  parseNote,
} from "./pg-vouchers.js";
import { type StarterResolution, resolveStarter } from "./voucher-starter.js";

const logger = log("store");

/**
 * **The voucher's private note for every author gift** — a constant, so that a
 * title change between two presses of *Send* is still the same create
 * (R2-F4). The page shows the title from the gift row instead.
 */
export const AUTHOR_GIFT_VOUCHER_NOTE = "Author gift";

/** The status, from the two timestamps and whether the voucher exists (D1). */
function statusOf(row: {
  readonly sendStartedAt: Date | null;
  readonly discardedAt: Date | null;
  readonly voucherExists: boolean;
}): AuthorGiftStatus {
  if (row.voucherExists) return "sent";
  if (row.sendStartedAt !== null) return "sending";
  if (row.discardedAt !== null) return "discarded";
  return "draft";
}

/** `exists (a voucher with this gift's voucher_id)`, for the selects below. */
const VOUCHER_EXISTS = sql<boolean>`exists (select 1 from ${billingVouchers} where ${billingVouchers.id} = ${authorGifts.voucherId})`;

/* ---------------------------------------------------------------- ensure -- */

export type EnsureAnswer =
  /** A new gift, its private link if it needed one, and its first lookup, pending. */
  | { readonly kind: "created"; readonly id: string; readonly lookupId: string }
  /** The article already had one. Nothing was touched — not the link, not the lookups (R2-F2). */
  | { readonly kind: "existing"; readonly id: string; readonly status: AuthorGiftStatus }
  /**
   * The article cannot be a gift's: `absent` (not theirs, or not there),
   * `unpublished`, or `link-off` — its link was turned off again between this
   * call making it and reading it back, a race with the owner.
   */
  | { readonly kind: "refused"; readonly reason: StarterRefusal };

/** Seams for tests; each defaults to the real thing. */
export interface EnsureDeps {
  readonly resolveStarter?: (slug: string) => Promise<StarterResolution>;
}

/**
 * **Find this article's gift, or make it** — `POST /api/admin/author-gifts`.
 * As the current owner throughout: the article must be theirs and published.
 *
 * 1. The article, by `ownedSlug`. Somebody else's is the same answer as none.
 * 2. **An existing gift is answered as it stands** — before anything about the
 *    link is looked at, so a late replay cannot turn a link back on that was
 *    turned off since, nor buy another search (R2-F2).
 * 3. Otherwise the starter is resolved exactly as the voucher's will be
 *    (`resolveStarter`, src/store/voucher-starter.ts — one rule for "own,
 *    published, linkable", not two). A private article with its link off has
 *    one made, with `keepExisting` under the share-link store's lock, so a link
 *    somebody made a moment ago is never replaced. A public article needs no
 *    link and gets none.
 * 4. One transaction: the gift (`on conflict (article_id) do nothing`) and, if
 *    this call inserted it, its first pending lookup. A concurrent ensure that
 *    lost the insert answers `existing`; the link either made is the same
 *    link, by `keepExisting`.
 *
 * Not one transaction overall: the link is the share-link store's own write,
 * under its own lock, and is wanted whether or not this call wins the insert.
 */
export async function ensureAuthorGift(slug: string, createdBy: string, deps: EnsureDeps = {}): Promise<EnsureAnswer> {
  const db = getDb();
  const [article] = await db.select({ id: articles.id }).from(articles).where(ownedSlug(slug)).limit(1);
  if (!article) return { kind: "refused", reason: "absent" };

  const existing = await giftOfArticle(article.id);
  if (existing) return { kind: "existing", ...existing };

  const resolve = deps.resolveStarter ?? resolveStarter;
  let resolved = await resolve(slug);
  if (resolved.kind === "link-off") {
    await pgShareLinkStore.create(slug, { keepExisting: true });
    resolved = await resolve(slug);
  }
  if (resolved.kind !== "ready") return { kind: "refused", reason: resolved.kind };
  /* The slug can have been freed and taken by another article between the
     reads; the gift is for the one this call found first. */
  if (resolved.starter.articleId !== article.id) return { kind: "refused", reason: "absent" };

  const made = await db.transaction(async (tx) => {
    const [gift] = await tx
      .insert(authorGifts)
      .values({ articleId: article.id, starterSlug: slug, createdBy })
      .onConflictDoNothing({ target: authorGifts.articleId })
      .returning({ id: authorGifts.id });
    if (!gift) return null;
    const [lookup] = await tx
      .insert(authorLookups)
      .values({ authorGiftId: gift.id })
      .returning({ id: authorLookups.id });
    if (!lookup) throw new Error("inserting an author lookup returned no row");
    return { id: gift.id, lookupId: lookup.id };
  }, READ_COMMITTED);
  if (made) {
    logger.info({ giftId: made.id, lookupId: made.lookupId }, "author gift made");
    return { kind: "created", ...made };
  }
  const winner = await giftOfArticle(article.id);
  if (!winner) throw new Error("an author gift lost its insert and then could not be found");
  return { kind: "existing", ...winner };
}

async function giftOfArticle(articleId: string): Promise<{ id: string; status: AuthorGiftStatus } | null> {
  const [row] = await getDb()
    .select({
      id: authorGifts.id,
      sendStartedAt: authorGifts.sendStartedAt,
      discardedAt: authorGifts.discardedAt,
      voucherExists: VOUCHER_EXISTS,
    })
    .from(authorGifts)
    .where(eq(authorGifts.articleId, articleId))
    .limit(1);
  return row ? { id: row.id, status: statusOf(row) } : null;
}

/**
 * **What `POST /api/admin/author-gifts` may carry**: `{ slug, rightsConfirmed:
 * true }` and nothing else. The tick is the private link's rights tick-box,
 * which the share-link route asks for too; an unknown key is a 400, so a
 * misspelt field is not silently a default.
 */
export function parseEnsureAuthorGift(body: unknown): Parsed<{ readonly slug: string }> {
  if (!isPlainObject(body)) return { ok: false, message: "Expected a JSON object." };
  const unknown = Object.keys(body).filter((key) => !["slug", "rightsConfirmed"].includes(key));
  if (unknown.length > 0) return { ok: false, message: `Unexpected field: ${unknown.join(", ")}.` };
  if (body.rightsConfirmed !== true) {
    return { ok: false, message: "Confirm you have the right to share this article by private link (rightsConfirmed: true)." };
  }
  if (!isSlug(body.slug)) return { ok: false, message: "slug must be an article's slug." };
  return { ok: true, value: { slug: body.slug } };
}

/* --------------------------------------------------------------- lookups -- */

export type BeginLookupAnswer =
  | { readonly kind: "started"; readonly lookupId: string }
  | { readonly kind: "not-found" }
  /** One started under `AUTHOR_LOOKUP_STALE_MINUTES` ago is unfinished. */
  | { readonly kind: "running" }
  /** Sent, sending or discarded: a lookup could change nothing. */
  | { readonly kind: "not-draft" };

/**
 * **Start a lookup on a draft** (D4, Sol's F2) — `POST …/:id/lookups`. One
 * short transaction: lock the gift, refuse if it is not a draft, mark any
 * unfinished lookup older than the stale limit `failed / stale`, refuse if one
 * is still unfinished, insert a pending row. A concurrent begin waits on the
 * gift's lock and then sees this one's row; `author_lookups_one_pending` is the
 * backstop.
 */
export async function beginLookup(giftId: string): Promise<BeginLookupAnswer> {
  return await getDb().transaction(async (tx): Promise<BeginLookupAnswer> => {
    const [gift] = await tx
      .select({ sendStartedAt: authorGifts.sendStartedAt, discardedAt: authorGifts.discardedAt })
      .from(authorGifts)
      .where(eq(authorGifts.id, giftId))
      .for("update")
      .limit(1);
    if (!gift) return { kind: "not-found" };
    if (gift.sendStartedAt !== null || gift.discardedAt !== null) return { kind: "not-draft" };

    await tx
      .update(authorLookups)
      .set({ outcome: "failed", failure: "stale", finishedAt: sql`now()` })
      .where(
        and(
          eq(authorLookups.authorGiftId, giftId),
          isNull(authorLookups.outcome),
          lt(authorLookups.createdAt, sql`now() - make_interval(mins => ${AUTHOR_LOOKUP_STALE_MINUTES})`),
        ),
      );
    const [running] = await tx
      .select({ id: authorLookups.id })
      .from(authorLookups)
      .where(and(eq(authorLookups.authorGiftId, giftId), isNull(authorLookups.outcome)))
      .limit(1);
    if (running) return { kind: "running" };

    const [lookup] = await tx.insert(authorLookups).values({ authorGiftId: giftId }).returning({ id: authorLookups.id });
    if (!lookup) throw new Error("inserting an author lookup returned no row");
    return { kind: "started", lookupId: lookup.id };
  }, READ_COMMITTED);
}

/** Whose article a lookup is about, and which: what the after-response run needs to read it. */
export interface LookupSubject {
  readonly giftId: string;
  readonly articleId: string;
  /** The gift's `created_by` — the administrator, and the article's owner. */
  readonly createdBy: OwnerId;
  /** The article's slug now, not the one the gift was made under. */
  readonly slug: string;
}

/**
 * **The lookup's gift and article** — for src/author-lookup-start.ts, which
 * reads the article as `createdBy` through the owner's own reads. Null when the
 * lookup, its gift or its article is gone. Not owner-scoped itself: the id is
 * one a route has just committed, and nothing here returns article content.
 */
export async function lookupSubject(lookupId: string): Promise<LookupSubject | null> {
  const [row] = await getDb()
    .select({
      giftId: authorGifts.id,
      articleId: authorGifts.articleId,
      createdBy: authorGifts.createdBy,
      slug: articles.slug,
    })
    .from(authorLookups)
    .innerJoin(authorGifts, eq(authorGifts.id, authorLookups.authorGiftId))
    .innerJoin(articles, eq(articles.id, authorGifts.articleId))
    .where(eq(authorLookups.id, lookupId))
    .limit(1);
  return row ? { ...row, createdBy: row.createdBy as OwnerId } : null;
}

/**
 * **Claim a pending lookup for one run, before spending anything** (R2-F5,
 * R2-F6). True when this call set `run_id`; false when the row is finished,
 * already claimed, or gone — and then the caller makes no call at all.
 * `runId` is the fresh collector's own id, so `ai_calls.run_id` names exactly
 * this run's calls.
 */
export async function claimLookup(lookupId: string, runId: string): Promise<boolean> {
  const claimed = await getDb()
    .update(authorLookups)
    .set({ runId })
    .where(and(eq(authorLookups.id, lookupId), isNull(authorLookups.outcome), isNull(authorLookups.runId)))
    .returning({ id: authorLookups.id });
  return claimed.length === 1;
}

/**
 * **What a lookup came back with**, after stage 2's rules (D4): only URLs that
 * were among the results, only an address seen exactly in one. `notes` is the
 * dated block for the gift's notes, or null for none. The outcome is derived
 * here, not passed: `address` when an address is kept, `author` when only a
 * name is, `nothing` otherwise.
 */
export type LookupResult =
  | {
      readonly kind: "found";
      readonly authorName: string | null;
      readonly authorSourceUrl: string | null;
      readonly email: string | null;
      readonly emailSourceUrl: string | null;
      readonly suggestedEmail: string | null;
      readonly contactUrl: string | null;
      readonly searches: number | null;
      readonly model: string | null;
      readonly notes: string | null;
    }
  | {
      readonly kind: "failed";
      /** A reason — a status code, an error name — never the provider's prose. */
      readonly failure: string;
      readonly searches?: number | null;
      readonly model?: string | null;
      readonly notes?: string | null;
    };

export type FinishLookupAnswer =
  | { readonly kind: "not-found" }
  /** Already finished — by `stale`, or by another finish. Nothing written. */
  | { readonly kind: "lost" }
  | {
      readonly kind: "finished";
      readonly outcome: AuthorLookupOutcome;
      /** What reached the gift. All false when it was no longer a draft. */
      readonly applied: { readonly email: boolean; readonly name: boolean; readonly notes: boolean };
    };

/** The ceiling the lookup's text columns hold; a longer value is cut rather than failing the finish. */
const LOOKUP_TEXT_MAX = 2000;

function bounded(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const points = [...value];
  return points.length > LOOKUP_TEXT_MAX ? points.slice(0, LOOKUP_TEXT_MAX).join("") : value;
}

/** An address the draft may take: normalised and address-shaped, or null. */
function fillableEmail(raw: string | null): string | null {
  if (raw === null) return null;
  const email = normaliseEmail(raw);
  return looksLikeEmail(email) ? email : null;
}

/** A name the draft may take: one line of at most `RECIPIENT_NAME_MAX`, as the voucher's rule; else null. */
function fillableName(raw: string | null): string | null {
  if (raw === null || [...raw].length > RECIPIENT_NAME_MAX) return null;
  return cleanRecipientName(raw);
}

/**
 * **Finish a lookup, and fill the draft's empty fields from it** (D4, R2-F5).
 *
 * One transaction, in the lock order: the gift, then the lookup. The lookup is
 * updated only `where outcome is null`, so a run marked stale meanwhile, or
 * finished by another, writes nothing (`lost`). Then, **only while the gift is
 * still a draft** — not sending, not sent, not discarded:
 *
 * - an empty address takes the lookup's, with `email_lookup_id` set to it;
 * - an empty name takes the lookup's, with `name_lookup_id`;
 * - the notes block is appended, cut to fit `AUTHOR_GIFT_NOTES_MAX` with a line
 *   saying so (R2-F7), so a full field never leaves the lookup pending.
 *
 * A field the administrator or an earlier lookup filled is never overwritten;
 * what this run found is kept on its own row, which is how the page shows
 * *found, not applied*.
 */
export async function finishLookup(lookupId: string, result: LookupResult): Promise<FinishLookupAnswer> {
  const db = getDb();
  const [seen] = await db
    .select({ giftId: authorLookups.authorGiftId })
    .from(authorLookups)
    .where(eq(authorLookups.id, lookupId))
    .limit(1);
  if (!seen) return { kind: "not-found" };

  return await db.transaction(async (tx): Promise<FinishLookupAnswer> => {
    const [gift] = await tx
      .select({
        email: authorGifts.email,
        recipientName: authorGifts.recipientName,
        notes: authorGifts.notes,
        sendStartedAt: authorGifts.sendStartedAt,
        discardedAt: authorGifts.discardedAt,
      })
      .from(authorGifts)
      .where(eq(authorGifts.id, seen.giftId))
      .for("update")
      .limit(1);
    if (!gift) return { kind: "not-found" };
    const [current] = await tx
      .select({ outcome: authorLookups.outcome })
      .from(authorLookups)
      .where(eq(authorLookups.id, lookupId))
      .for("update")
      .limit(1);
    if (!current) return { kind: "not-found" };
    if (current.outcome !== null) return { kind: "lost" };

    const found = result.kind === "found" ? result : null;
    const email = fillableEmail(found?.email ?? null);
    const name = found?.authorName ?? null;
    const outcome: AuthorLookupOutcome =
      found === null ? "failed" : email !== null ? "address" : name !== null && name.trim() !== "" ? "author" : "nothing";

    const finished = await tx
      .update(authorLookups)
      .set({
        outcome,
        finishedAt: sql`now()`,
        failure: result.kind === "failed" ? bounded(result.failure) : null,
        authorName: bounded(found?.authorName),
        authorSourceUrl: bounded(found?.authorSourceUrl),
        email,
        emailSourceUrl: bounded(found?.emailSourceUrl),
        suggestedEmail: bounded(found?.suggestedEmail),
        contactUrl: bounded(found?.contactUrl),
        searches: result.searches ?? null,
        model: bounded(result.model),
      })
      .where(and(eq(authorLookups.id, lookupId), isNull(authorLookups.outcome)))
      .returning({ id: authorLookups.id });
    if (finished.length === 0) return { kind: "lost" };

    const none = { email: false, name: false, notes: false } as const;
    if (gift.sendStartedAt !== null || gift.discardedAt !== null) return { kind: "finished", outcome, applied: none };

    const fillName = gift.recipientName === null ? fillableName(name) : null;
    const block = result.notes?.trim() ? result.notes.trim() : null;
    const notes = block === null ? null : appendNotes(gift.notes, block);
    const applied = { email: gift.email === null && email !== null, name: fillName !== null, notes: notes !== null };
    if (applied.email || applied.name || applied.notes) {
      await tx
        .update(authorGifts)
        .set({
          ...(applied.email ? { email, emailLookupId: lookupId } : {}),
          ...(applied.name ? { recipientName: fillName, nameLookupId: lookupId } : {}),
          ...(applied.notes ? { notes, notesUpdatedAt: sql`now()` } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(authorGifts.id, seen.giftId));
    }
    return { kind: "finished", outcome, applied };
  }, READ_COMMITTED);
}

/** The line that ends a block cut to fit. */
const CUT_LINE = "\n[Cut to fit the 20,000-character limit on notes.]";

/**
 * **The notes with `block` appended under a blank line**, cut to fit `max`
 * code points (Postgres' `char_length`, not UTF-16 `.length`). A block that
 * does not fit is shortened and ends with a line saying it was cut; with no
 * room even for that, null — nothing is appended, and the lookup still
 * finishes.
 */
export function appendNotes(existing: string | null, block: string, max: number = AUTHOR_GIFT_NOTES_MAX): string | null {
  const head = existing === null || existing === "" ? "" : `${existing}\n\n`;
  const whole = `${head}${block}`;
  if ([...whole].length <= max) return whole;
  const room = max - [...head].length - [...CUT_LINE].length;
  if (room <= 0) return null;
  return `${head}${[...block].slice(0, room).join("")}${CUT_LINE}`;
}

/* ------------------------------------------------------------------ list -- */

/**
 * **Every author gift, newest first**, with its derived status, its lookups
 * newest first, and what each lookup cost from the ledger (D5: summed by
 * `run_id`, with the unpriced count beside it). Not owner-scoped — the admin
 * routes are its only caller. Never the private link: the article is read by
 * named columns, and its key is not one of them.
 */
export async function listAuthorGifts(): Promise<AdminAuthorGift[]> {
  const db = getDb();
  const gifts = await db
    .select({
      gift: authorGifts,
      title: articleRevisions.title,
      articleThere: articles.id,
      voucherExists: VOUCHER_EXISTS,
    })
    .from(authorGifts)
    .leftJoin(articles, eq(articles.id, authorGifts.articleId))
    .leftJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .orderBy(desc(authorGifts.createdAt), desc(authorGifts.id));
  if (gifts.length === 0) return [];

  const lookups = await db
    .select()
    .from(authorLookups)
    .where(
      inArray(
        authorLookups.authorGiftId,
        gifts.map((g) => g.gift.id),
      ),
    )
    .orderBy(desc(authorLookups.createdAt), desc(authorLookups.id));
  const spend = await spendByRun(lookups.flatMap((l) => (l.runId === null ? [] : [l.runId])));

  const byGift = new Map<string, AdminAuthorLookup[]>();
  for (const l of lookups) {
    const runSpend = l.runId === null ? null : (spend.get(l.runId) ?? { nanos: 0, calls: 0, unpricedCalls: 0 });
    const wire: AdminAuthorLookup = {
      id: l.id,
      createdAt: l.createdAt.toISOString(),
      finishedAt: l.finishedAt?.toISOString() ?? null,
      outcome: (l.outcome as AuthorLookupOutcome | null) ?? null,
      failure: l.failure,
      authorName: l.authorName,
      authorSourceUrl: l.authorSourceUrl,
      email: l.email,
      emailSourceUrl: l.emailSourceUrl,
      suggestedEmail: l.suggestedEmail,
      contactUrl: l.contactUrl,
      searches: l.searches,
      model: l.model,
      cost: runSpend,
    };
    byGift.set(l.authorGiftId, [...(byGift.get(l.authorGiftId) ?? []), wire]);
  }

  return gifts.map(({ gift, title, articleThere, voucherExists }) => {
    const status = statusOf({ ...gift, voucherExists });
    return {
      id: gift.id,
      status,
      starter: { slug: gift.starterSlug, title: articleThere === null ? null : (title ?? gift.starterSlug) },
      email: gift.email,
      recipientName: gift.recipientName,
      recipientNote: gift.recipientNote,
      articles: gift.articles,
      notes: gift.notes,
      notesUpdatedAt: gift.notesUpdatedAt?.toISOString() ?? null,
      emailLookupId: gift.emailLookupId,
      nameLookupId: gift.nameLookupId,
      createdAt: gift.createdAt.toISOString(),
      createdBy: gift.createdBy,
      updatedAt: gift.updatedAt.toISOString(),
      sendStartedAt: gift.sendStartedAt?.toISOString() ?? null,
      discardedAt: gift.discardedAt?.toISOString() ?? null,
      voucherId: status === "sent" ? gift.voucherId : null,
      lookups: byGift.get(gift.id) ?? [],
    };
  });
}

/* ----------------------------------------------------------------- patch -- */

/** A change to one gift. Every field optional, at least one present. */
export interface AuthorGiftPatch {
  /** Null clears it: a draft may have no address. */
  readonly email?: string | null;
  readonly recipientName?: string | null;
  readonly recipientNote?: string | null;
  readonly articles?: number;
  /** **Always allowed**, even after *Send* (R2-F7). */
  readonly notes?: string | null;
  /** True discards (keeping the row); false restores. */
  readonly discarded?: boolean;
}

/** The fields the voucher carries, frozen once *Send* has started. Everything but the notes. */
const VOUCHER_BOUND: readonly (keyof AuthorGiftPatch)[] = ["email", "recipientName", "recipientNote", "articles", "discarded"];

/**
 * **What `PATCH /api/admin/author-gifts/:id` may carry, checked strictly** —
 * with the voucher's own field rules (src/store/pg-vouchers.ts), so a draft
 * can never hold something *Send* would then refuse. Unknown keys are a 400.
 */
export function parseAuthorGiftPatch(body: unknown): Parsed<AuthorGiftPatch> {
  if (!isPlainObject(body)) return { ok: false, message: "Expected a JSON object." };
  const keys = Object.keys(body);
  const unknown = keys.filter((key) => !["email", "recipientName", "recipientNote", "articles", "notes", "discarded"].includes(key));
  if (unknown.length > 0) return { ok: false, message: `Unexpected field: ${unknown.join(", ")}.` };
  if (keys.length === 0) return { ok: false, message: "Nothing to change." };
  const patch: { -readonly [K in keyof AuthorGiftPatch]: AuthorGiftPatch[K] } = {};
  if ("email" in body) {
    if (body.email === null || body.email === "") patch.email = null;
    else {
      const email = parseEmail(body.email);
      if (!email.ok) return email;
      patch.email = email.value;
    }
  }
  if ("recipientName" in body) {
    const name = parseName(body.recipientName);
    if (!name.ok) return name;
    patch.recipientName = name.value;
  }
  if ("recipientNote" in body) {
    const note = parseNote(body.recipientNote, "recipientNote");
    if (!note.ok) return note;
    patch.recipientNote = note.value;
  }
  if ("articles" in body) {
    const articles = parseArticles(body.articles);
    if (!articles.ok) return articles;
    patch.articles = articles.value;
  }
  if ("notes" in body) {
    if (body.notes !== null && typeof body.notes !== "string") return { ok: false, message: "notes must be a string or null." };
    const notes = body.notes === null ? "" : body.notes.trim();
    if ([...notes].length > AUTHOR_GIFT_NOTES_MAX) {
      return { ok: false, message: `notes must be at most ${AUTHOR_GIFT_NOTES_MAX} characters.` };
    }
    patch.notes = notes === "" ? null : notes;
  }
  if ("discarded" in body) {
    if (typeof body.discarded !== "boolean") return { ok: false, message: "discarded must be true or false." };
    patch.discarded = body.discarded;
  }
  return { ok: true, value: patch };
}

export type PatchAnswer =
  | { readonly kind: "updated" }
  | { readonly kind: "not-found" }
  /** *Send* has started, and the patch touched a field the voucher carries. */
  | { readonly kind: "frozen" };

/**
 * **Change one gift, in one conditional `UPDATE`.** A patch that touches any
 * field the voucher carries applies only `where send_started_at is null`, so
 * it cannot interleave with *Send*'s freeze (Sol's F1); a notes-only patch
 * applies to any gift (R2-F7).
 *
 * **An edit to the address or the name clears its provenance** (Sol's F7) —
 * only a real edit, in SQL (`is distinct from`), so a replayed PATCH with the
 * same value keeps the lookup as the source. `notes_updated_at` is stamped the
 * same way.
 */
export async function patchAuthorGift(id: string, patch: AuthorGiftPatch): Promise<PatchAnswer> {
  const touchesVoucher = VOUCHER_BOUND.some((key) => patch[key] !== undefined);
  const db = getDb();
  const updated = await db
    .update(authorGifts)
    .set({
      ...(patch.email === undefined
        ? {}
        : {
            email: patch.email,
            emailLookupId: sql`case when ${authorGifts.email} is distinct from ${patch.email} then null else ${authorGifts.emailLookupId} end`,
          }),
      ...(patch.recipientName === undefined
        ? {}
        : {
            recipientName: patch.recipientName,
            nameLookupId: sql`case when ${authorGifts.recipientName} is distinct from ${patch.recipientName} then null else ${authorGifts.nameLookupId} end`,
          }),
      ...(patch.recipientNote === undefined ? {} : { recipientNote: patch.recipientNote }),
      ...(patch.articles === undefined ? {} : { articles: patch.articles }),
      ...(patch.notes === undefined
        ? {}
        : {
            notes: patch.notes,
            notesUpdatedAt: sql`case when ${authorGifts.notes} is distinct from ${patch.notes} then now() else ${authorGifts.notesUpdatedAt} end`,
          }),
      /* Discarding an already discarded gift keeps its first date. */
      ...(patch.discarded === undefined
        ? {}
        : { discardedAt: patch.discarded ? sql`coalesce(${authorGifts.discardedAt}, now())` : null }),
      updatedAt: sql`now()`,
    })
    .where(touchesVoucher ? and(eq(authorGifts.id, id), isNull(authorGifts.sendStartedAt)) : eq(authorGifts.id, id))
    .returning({ id: authorGifts.id });
  if (updated.length === 1) return { kind: "updated" };
  const [there] = await db.select({ id: authorGifts.id }).from(authorGifts).where(eq(authorGifts.id, id)).limit(1);
  return there ? { kind: "frozen" } : { kind: "not-found" };
}

/* ------------------------------------------------------------------ send -- */

export type SendAnswer =
  /** This press made the voucher; `delivery` is its gift email, queued and committed with it. */
  | { readonly kind: "created"; readonly voucherId: string; readonly delivery: string }
  /**
   * The voucher already existed. `delivery` is its gift email **if that is
   * still queued** — a process that died after the create committed and before
   * its after-response send ran — so the route schedules it again; the email's
   * atomic reservation makes a duplicate schedule harmless (R2-F1).
   */
  | { readonly kind: "replayed"; readonly voucherId: string; readonly delivery: string | null }
  | { readonly kind: "not-found" }
  | { readonly kind: "no-address" }
  | { readonly kind: "discarded" }
  /** The article can no longer be linked. The freeze was released, if it was still this attempt's. */
  | { readonly kind: "starter-refused"; readonly reason: StarterRefusal }
  /** This caller's freeze was released or replaced before the voucher transaction began. */
  | { readonly kind: "superseded" }
  /** `createVoucher` said the id is a different voucher. Cannot happen; the row stays frozen. */
  | { readonly kind: "conflict" };

/** Seams for tests; each defaults to the real thing. */
export interface SendDeps {
  readonly createVoucher?: (
    input: NewVoucher,
    createdBy: string,
    deps: Parameters<typeof createVoucher>[2],
  ) => Promise<CreateVoucherAnswer>;
}

/**
 * **Send: freeze, then create** (D3, with R2-F1, F3, F4).
 *
 * 1. One conditional `UPDATE` sets `send_started_at` and a fresh
 *    `send_attempt` on a draft with an address, and returns the frozen row. No
 *    match: a gift already frozen carries on from its stored values (a replay,
 *    or a send that died part-way); otherwise the refusal says why.
 * 2. `createVoucher` with every field from the frozen row: `voucher_id`, the
 *    constant note, the gift's own `created_by` and `starter_slug` — so another
 *    administrator pressing, or a rename since, is still the same create, and a
 *    repeat is its replay, which queues nothing. Run as the gift's creator,
 *    because the starter is resolved through that owner's reads.
 * 3. `starter-refused` releases the freeze **only if it is still this
 *    attempt's and no voucher exists**, so a slow refusal cannot unfreeze a
 *    newer attempt (R2-F3).
 */
export async function sendAuthorGift(id: string, deps: SendDeps = {}): Promise<SendAnswer> {
  const db = getDb();
  const [frozen] = await db
    .update(authorGifts)
    .set({ sendStartedAt: sql`now()`, sendAttempt: sql`gen_random_uuid()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(authorGifts.id, id),
        isNull(authorGifts.sendStartedAt),
        isNull(authorGifts.discardedAt),
        sql`${authorGifts.email} is not null`,
      ),
    )
    .returning();
  let gift = frozen;
  if (!gift) {
    const [row] = await db.select().from(authorGifts).where(eq(authorGifts.id, id)).limit(1);
    if (!row) return { kind: "not-found" };
    if (row.sendStartedAt === null) return row.discardedAt !== null ? { kind: "discarded" } : { kind: "no-address" };
    gift = row;
  }
  /* The CHECKs `author_gifts_send_has_email` and `…_send_attempt_together`
     make these unreachable on a frozen row. */
  if (gift.email === null || gift.sendAttempt === null) throw new Error(`author gift ${id} is frozen without its address or attempt`);

  const input: NewVoucher = {
    id: gift.voucherId,
    email: gift.email,
    articles: gift.articles,
    note: AUTHOR_GIFT_VOUCHER_NOTE,
    recipientNote: gift.recipientNote,
    recipientName: gift.recipientName,
    starterSlug: gift.starterSlug,
  };
  const create = deps.createVoucher ?? createVoucher;
  const createdBy = gift.createdBy;
  const attempt = gift.sendAttempt;
  const answer = await runAsOwner(createdBy as OwnerId, () =>
    create(input, createdBy, {
      beforeCreate: async (tx) => {
        /* Lock the gift through the voucher insert's commit. A concurrent
           starter-refusal unfreeze then waits and sees the voucher; if it won
           first, this stale snapshot is refused before anything is inserted. */
        const [current] = await tx
          .select({ sendAttempt: authorGifts.sendAttempt })
          .from(authorGifts)
          .where(eq(authorGifts.id, id))
          .for("update")
          .limit(1);
        return current?.sendAttempt === attempt;
      },
    }),
  );
  switch (answer.kind) {
    case "created":
      logger.info({ giftId: id, voucherId: answer.id }, "author gift sent: voucher made");
      return { kind: "created", voucherId: answer.id, delivery: answer.delivery };
    case "replayed": {
      const latest = (await latestVoucherEmails([answer.id])).get(answer.id)?.gift ?? null;
      return { kind: "replayed", voucherId: answer.id, delivery: latest?.status === "queued" ? latest.id : null };
    }
    case "starter-refused": {
      await db
        .update(authorGifts)
        .set({ sendStartedAt: null, sendAttempt: null, updatedAt: sql`now()` })
        .where(
          and(
            eq(authorGifts.id, id),
            eq(authorGifts.sendAttempt, attempt),
            sql`not exists (select 1 from ${billingVouchers} where ${billingVouchers.id} = ${authorGifts.voucherId})`,
          ),
        );
      return { kind: "starter-refused", reason: answer.reason };
    }
    case "create-refused":
      return { kind: "superseded" };
    case "conflict":
      logger.error({ giftId: id }, "author gift send: its voucher id belongs to a different voucher");
      return { kind: "conflict" };
    default: {
      const never: never = answer;
      throw new Error(`unknown create answer ${String(never)}`);
    }
  }
}

/**
 * **The routes' entry points, behind the database-error guard** — for
 * pgVoucherStore's reason: a failed write here can carry an address, a note or
 * a rendered gift email into a driver's message. The bare functions stay
 * exported for tests and for the after-response lookup.
 */
export const pgAuthorGiftStore = guardDbStore("author-gifts", {
  ensureAuthorGift,
  listAuthorGifts,
  patchAuthorGift,
  sendAuthorGift,
  beginLookup,
  lookupSubject,
  claimLookup,
  finishLookup,
});
