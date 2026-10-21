/**
 * **Getting a gift's article ready for its recipient**, inside the transaction
 * that makes the gift — docs/plans/261021j-gift-articles-on-opus-and-with-their-main-modes.md
 * § D2–D3.
 *
 * Called by `ensureAuthorGift` (src/store/pg-author-gifts.ts) when its insert
 * wins, by `createVoucher` (src/store/pg-vouchers.ts) when a new voucher with a
 * starter is inserted, and by `POST /api/admin/author-gifts/:id/high-power`
 * (src/routes.ts) for a draft made without it. All three are the
 * administrator's: the routes are under `/api/admin/`.
 *
 * ## What it does
 *
 * 1. **Locks the article row first** and re-checks it is still the current
 *    owner's, still serves a revision and is `full`. Otherwise it does nothing
 *    and says so: the gift is still made, because preparing the article is a
 *    bonus, not a precondition. A `minimal` paper cannot reach here (starter
 *    resolution refuses it, src/store/voucher-starter.ts), so that half of the
 *    check is a guard.
 * 2. **With `highPower`, switches the article to Opus** — the administrator's
 *    uncharged write (`switchOnHighPowerIn`, src/store/pg-high-power.ts), on
 *    this transaction. An article already on keeps its first `since`.
 * 3. **Queues the main-mode jobs, unforced** (`enqueueMainModesIn`,
 *    src/store/pg-main-modes.ts) with the owner's rendered profile, so the work
 *    keys are the import's. The owner's *Generate the main modes* switch is
 *    **not** read. A mode already current is a skipped step and costs nothing;
 *    a job identical to one already waiting collapses onto it.
 *
 * Because the switch commits with the jobs, every job reads it as it starts
 * (`readStepPower`) and runs on Opus: what is still to be made is made on
 * Opus, and what Sonnet already made stays as it is (§ D3).
 *
 * ## Lock order
 *
 * **The article before anything else this transaction writes** — the gift,
 * the voucher, the jobs. That is the repository's order: the claim locks
 * starters before vouchers (`claimVouchersFor`), the share-link switch locks
 * the article and then the gift, and the transfer (src/store/pg-article-transfer.ts)
 * locks the article before it reads the jobs on it. So a caller that inserts
 * a row first calls `lockGiftArticleIn` **before** its insert, and this takes
 * the same lock again for free. The lock is also what keeps a concurrent
 * transfer from moving the article between the owner check and the inserts.
 *
 * ## No charge, and no `notBefore`
 *
 * Nothing here writes a billing row: the jobs are successors
 * (`enqueueSuccessorIn` carries no ingest event), and the switch is the
 * administrator's. The jobs need no `notBefore` — unlike an import's, they
 * have no predecessor job of their own to sort after, and anything already on
 * the article claims first by its earlier `created_at`.
 */

import { eq } from "drizzle-orm";

import { isAdmin } from "../admin.js";
import type { getDb } from "../db/client.js";
import { articles } from "../db/schema.js";
import { currentOwnerId } from "../owner.js";
import { switchOnHighPowerIn } from "./pg-high-power.js";
import { enqueueMainModesIn, readerProfileOf } from "./pg-main-modes.js";
import type { SuccessorOutcome } from "./pg-successor.js";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The article row as the preparation reads it, under its lock. */
export interface LockedGiftArticle {
  readonly id: string;
  readonly ownerId: string;
  readonly slug: string;
  readonly purpose: string | null;
  readonly currentRevisionId: string | null;
  readonly processing: string;
}

/**
 * What preparing did, for the caller's one log line after its commit. Ids and
 * counts only: never the slug or the title.
 *
 * - `skipped`: the article is gone, not the current owner's, or has nothing to
 *   read. Nothing was written.
 * - `prepared`: `switchedOn` is whether *this* call turned High-powered AI on
 *   (false when not asked, or already on); `modes` is one outcome per main-mode
 *   request, `alreadyQueued` being the ordinary collapse onto a waiting job.
 */
export type GiftPrep =
  | { readonly kind: "skipped"; readonly reason: "absent" | "not-owner" | "unpublished" }
  | { readonly kind: "prepared"; readonly switchedOn: boolean; readonly modes: readonly SuccessorOutcome[] };

/** Lock the article row `FOR UPDATE`, and read what the preparation checks. */
export async function lockGiftArticleIn(tx: Tx, articleId: string): Promise<LockedGiftArticle | undefined> {
  const [row] = await tx
    .select({
      id: articles.id,
      ownerId: articles.ownerId,
      slug: articles.slug,
      purpose: articles.purpose,
      currentRevisionId: articles.currentRevisionId,
      processing: articles.processing,
    })
    .from(articles)
    .where(eq(articles.id, articleId))
    .for("update")
    .limit(1);
  return row;
}

/**
 * **Prepare one gift's article, on the caller's transaction.** See the file's
 * head for the three steps and the lock order. Throws only on a database error
 * — which rolls the gift back with it, the point of doing this inside — or if
 * asked for `highPower` by somebody who is not an administrator, which no
 * route can do.
 */
export async function prepareGiftArticleIn(
  tx: Tx,
  articleId: string,
  options: { readonly highPower: boolean },
): Promise<GiftPrep> {
  const owner = currentOwnerId();
  /* Checked before any write, though only the admin routes call this: the
     switch below is uncharged, and an uncharged switch-on is the
     administrator's alone (as `switchOnForAdmin` checks). */
  if (options.highPower && !isAdmin(owner)) {
    throw Object.assign(new Error("Only an administrator may switch on without a charge."), { status: 403 });
  }
  const article = await lockGiftArticleIn(tx, articleId);
  if (!article) return { kind: "skipped", reason: "absent" };
  if (article.ownerId !== owner) return { kind: "skipped", reason: "not-owner" };
  if (article.currentRevisionId === null || article.processing !== "full") {
    return { kind: "skipped", reason: "unpublished" };
  }

  /* The switch first, so it commits with the jobs and each reads it as it starts. */
  const switchedOn = options.highPower ? await switchOnHighPowerIn(tx, eq(articles.id, article.id)) : false;
  const reader = await readerProfileOf(tx, article.ownerId);
  const modes = await enqueueMainModesIn(tx, article, reader?.profile ?? null);
  return { kind: "prepared", switchedOn, modes };
}

/** The fields of a `GiftPrep` a log line may carry: kinds and counts, no ids of anybody's prose. */
export function giftPrepLogFields(prep: GiftPrep): Record<string, unknown> {
  if (prep.kind === "skipped") return { prep: "skipped", reason: prep.reason };
  return {
    prep: "prepared",
    switchedOn: prep.switchedOn,
    modesQueued: prep.modes.filter((m) => m.kind === "queued").length,
    modesAlreadyQueued: prep.modes.filter((m) => m.kind === "alreadyQueued").length,
    modesBoundToOlderBase: prep.modes.filter((m) => m.kind === "boundToOlderBase").length,
  };
}
