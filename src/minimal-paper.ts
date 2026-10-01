/**
 * **A minimal paper, on the server**: the duplicate rule, the upload claim
 * under the billing lock, and the questions the guards ask about an article's
 * `processing`. Plan
 * docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md, Stage 3;
 * docs/project/ingest-queue.md § A minimal upload, and Read this.
 *
 * ## The duplicate rule
 *
 * A file is **already on your shelf** when, for this owner and these bytes,
 *
 * - **(a)** an article of theirs — archived ones too, so re-dropping a folder
 *   does not bring back what you archived — has a revision whose `raw_sha256`
 *   is the hash; or
 * - **(b)** another upload of theirs with this `claimed_sha256` is `claimed` or
 *   `verified`, and either its job has not ended, a retry has reserved its next
 *   minimal attempt but has not inserted that job yet, or it has **no job at
 *   all**, never had one (`uploads.slug` is null — `noteSlug` writes it the
 *   moment `enqueue` returns), and its grant (`minted_at`, `GRANT_TTL_MS`, two
 *   hours) has not run out.
 *
 * (b)'s second half is Sol's P0 on the build plan: a crash between the claim and
 * the enqueue leaves a claimed upload with no job, and without a rule it is
 * either a duplicate for ever or no duplicate at all. Two hours is the bound,
 * and a durable claim table that would close it was passed over (the plan says
 * why). A deleted article has no revisions, and its upload's job has ended or
 * gone with it — and that upload names the article it became, so it is not
 * mistaken for a crash — so deleting a paper frees its bytes to be added again.
 * `never had one` is what tells those two apart: the first version of this
 * rule asked only *no job*, and a paper deleted inside two hours of being
 * added could not be added back until they had passed.
 *
 * **The hash is the browser's claim**, `uploads.claimed_sha256`, because the
 * bytes have not been read when this is asked. That is safe here and nowhere
 * else: the check is scoped to the owner, so a lie can only make a reader's own
 * paper a duplicate of their own paper. It is never identity.
 *
 * **Asked twice.** Unlocked at the grant (`POST /api/uploads`), so a duplicate
 * is refused before eleven megabytes are sent; and under the owner's billing
 * lock at the job (`POST /api/jobs`), in the same transaction as the upload's
 * claim and the minimal reservation (`withMinimalSlot`'s `inLock`), which is
 * what makes two tabs dropping one folder one paper rather than two: every
 * minimal admission for this owner waits on that lock, so the second sees the
 * first's claimed upload.
 */
import { and, eq, sql } from "drizzle-orm";

import { isAdmin } from "./admin.js";
import { admitsMinimal, budgetFor, minimalHeadroom } from "./billing/points.js";
import { getDb } from "./db/client.js";
import { articles } from "./db/schema.js";
import { ALREADY_ON_ITS_WAY, alreadyOnYourShelf, minimalQuotaReached } from "./messages.js";
import type { OwnerId } from "./owner.js";
import { GRANT_TTL_MS } from "./source.js";
import { accountSnapshot, entitlementFromRow, usageFor, wallUsed } from "./store/pg-billing.js";
import type { BillingTx } from "./store/pg-billing.js";
import { allTiers } from "./store/pg-tiers.js";
import { claimUploadIn } from "./store/pg-uploads.js";
import type { UploadRecord } from "./store/uploads.js";
import type { StepName } from "./types.js";

/** The whole of a minimal paper's job. */
export const MINIMAL_STEPS: readonly StepName[] = ["fetch", "metadata"];

/**
 * **Is this exactly the job a minimal upload queues** — one `fetch`, then one
 * `metadata`, and nothing else? `enqueue` refuses `metadata` in any other list,
 * and a claim of such a job creates its article `'minimal'`.
 */
export function isMinimalJob(steps: readonly StepName[]): boolean {
  return steps.length === MINIMAL_STEPS.length && steps.every((step, at) => step === MINIMAL_STEPS[at]);
}

/** What is in the way, when something is. */
export type Duplicate =
  | { readonly kind: "on-shelf"; readonly slug: string; readonly archived: boolean }
  | { readonly kind: "on-its-way" };

/** A plain-SQL executor: the pool, or the billing lock's transaction. */
type Exec = Pick<ReturnType<typeof getDb>, "execute">;

/**
 * **(a) then (b)**, against whatever executor the caller holds. `uploadId` is
 * the upload asking, left out of (b) so a repeat of the same request is not its
 * own duplicate.
 *
 * (a) is served by `article_revisions_raw_sha256` (the hash leads, then the
 * article to join on) — tests/minimal-paper-duplicates.test.ts asks the planner
 * for it with `EXPLAIN`. (b) by `uploads_owner_claimed_sha256`.
 */
export async function findDuplicate(
  exec: Exec,
  input: { readonly ownerId: string; readonly sha256: string; readonly uploadId?: string },
): Promise<Duplicate | null> {
  const shelved = await exec.execute(duplicateOnShelfSql(input.ownerId, input.sha256));
  const hit = (shelved.rows as { slug?: unknown; archived?: unknown }[])[0];
  if (hit && typeof hit.slug === "string") {
    return { kind: "on-shelf", slug: hit.slug, archived: hit.archived === true };
  }
  const live = await exec.execute(sql`
    select 1
      from spideryarn.uploads u
     where u.owner_id = ${input.ownerId}::uuid
       and u.claimed_sha256 = ${input.sha256}
       and u.status in ('claimed', 'verified')
       ${input.uploadId ? sql`and u.id <> ${input.uploadId}::uuid` : sql``}
       and (
         exists (
           select 1 from spideryarn.jobs j
            where j.upload_id = u.id and j.status in ('queued', 'running')
         )
         or exists (
           /* withRetrySlot commits the fresh reservation before it calls
              retryJob — holding a database lock across that enqueue would
              deadlock the pool. In that small gap there is no queued job yet,
              so the reservation is the only durable fact that the same bytes
              are on their way again. A retry reservation carries the old
              job's slug; the original minimal reservation does not, which
              keeps this branch specific to retries. */
           select 1
             from spideryarn.jobs old
             join spideryarn.ingest_events retry
               on retry.owner_id = old.owner_id
              and retry.kind = 'minimal'
              and retry.slug = old.slug
              and retry.succeeded_at is null
              and retry.released_at is null
            where old.upload_id = u.id
         )
         or (
           not exists (select 1 from spideryarn.jobs j where j.upload_id = u.id)
           and u.slug is null
           and u.minted_at > now() - make_interval(secs => ${GRANT_TTL_MS / 1000})
         )
       )
     limit 1`);
  return live.rows.length > 0 ? { kind: "on-its-way" } : null;
}

/**
 * (a), as one statement — exported so the `EXPLAIN` test plans exactly the
 * query this runs. Any revision, not only the current one: a failed or
 * superseded revision with these bytes still means the reader has this paper.
 * Every revision of a deleted article went with it (`on delete cascade`).
 */
export function duplicateOnShelfSql(ownerId: string, sha256: string) {
  return sql`
    select a.slug, a.archived_at is not null as archived
      from spideryarn.article_revisions r
      join spideryarn.articles a on a.id = r.article_id
     where r.raw_sha256 = ${sha256}
       and a.owner_id = ${ownerId}::uuid
       and a.current_revision_id is not null
     order by a.created_at
     limit 1`;
}

/**
 * **The refusal a duplicate gets**: 409, the plain sentence, and the existing
 * article's slug when there is one. A declared class so the route's catch can
 * put `article` on the wire as `{ error, code: "duplicate", article? }` without
 * reading an error's own properties (src/routes.ts).
 */
export class DuplicateUpload extends Error {
  readonly status = 409;
  readonly code = "duplicate";
  /** The article these bytes already are, when they are one; absent while the other copy is on its way. */
  readonly article: string | undefined;

  constructor(readonly duplicate: Duplicate) {
    super(
      (duplicate.kind === "on-shelf" ? alreadyOnYourShelf({ archived: duplicate.archived }) : ALREADY_ON_ITS_WAY)
        .message,
    );
    this.name = "DuplicateUpload";
    this.article = duplicate.kind === "on-shelf" ? duplicate.slug : undefined;
  }
}

export function duplicateRefusal(duplicate: Duplicate): DuplicateUpload {
  return new DuplicateUpload(duplicate);
}

/**
 * **The duplicate check and the claim, in the billing lock's transaction** —
 * what `withMinimalSlot`'s `inLock` runs for `POST /api/jobs {uploadId,
 * level: "minimal"}`. Throws to decline, which rolls back the reservation and
 * the claim together. Uses `tx` and only `tx`, and touches no network: the
 * locked section's rule.
 *
 * Returns the claimed record through `onClaimed` rather than a value, because
 * `InLock` returns nothing.
 */
export function claimMinimalUploadInLock(
  upload: { readonly id: string; readonly sha256: string },
  onClaimed: (record: UploadRecord) => void,
) {
  return async (tx: BillingTx, context: { readonly ownerId: string }): Promise<void> => {
    const duplicate = await findDuplicate(tx, {
      ownerId: context.ownerId,
      sha256: upload.sha256,
      uploadId: upload.id,
    });
    if (duplicate) throw duplicateRefusal(duplicate);
    const claim = await claimUploadIn(tx, upload.id, { owner: context.ownerId, arrived: true });
    if (!claim.ok) throw new UploadNotClaimed(claim.why);
    onClaimed(claim.record);
  };
}

/**
 * The claim lost — somebody else took this upload, or it is gone. Thrown out of
 * the locked section so the reservation rolls back, and turned back into the
 * route's ordinary answer for the repeat or the race (`resolveExistingUpload`).
 */
export class UploadNotClaimed extends Error {
  constructor(readonly why: "unknown" | "taken" | "expired") {
    super(`the upload could not be claimed: ${why}`);
    this.name = "UploadNotClaimed";
  }
}

/**
 * **`POST /api/uploads {level: "minimal"}`'s door**: refuse an account a
 * minimal paper would not fit, and bytes this reader already has — before the
 * file is sent. **Not the gate**, and reserves nothing: `withMinimalSlot` at
 * `POST /api/jobs` decides, under the lock. The shape of
 * `refuseUploadWithoutQuota` (src/billing/admission.ts), asking the minimal
 * wall rather than the ingest one: `admitsMinimal` over the same usage, and
 * the same `[pay-minimal]` sentence saying how many still fit. A `stale`
 * subscription does not stop the upload, for that function's reason.
 *
 * The administrator is exempt from the quota, as everywhere, and not from the
 * duplicate check: two copies of one paper are a nuisance whoever pays.
 */
export async function refuseMinimalUploadAtTheDoor(owner: OwnerId, sha256: string): Promise<void> {
  if (!isAdmin(owner)) {
    const row = await accountSnapshot(owner);
    const entitlement = entitlementFromRow(row, await allTiers(), new Date());
    if (!("kind" in entitlement)) {
      const usage = await usageFor(owner, entitlement);
      const used = wallUsed(usage);
      const budget = budgetFor(entitlement.limit);
      if (!admitsMinimal(used, budget)) {
        throw Object.assign(
          new Error(
            minimalQuotaReached({
              fits: minimalHeadroom(used, budget),
              ...(entitlement.tier === "paid" ? { resetAt: entitlement.periodEnd } : {}),
            }).message,
          ),
          { status: 402 },
        );
      }
    }
  }
  const duplicate = await findDuplicate(getDb(), { ownerId: owner, sha256 });
  if (duplicate) throw duplicateRefusal(duplicate);
}

/**
 * **This owner's article's `processing`**, or `undefined` when the slug is not
 * theirs. One indexed read; the guards ask it before they spend.
 */
export async function processingOf(
  slug: string,
  ownerId: OwnerId,
): Promise<{ readonly id: string; readonly processing: "minimal" | "full" } | undefined> {
  const [row] = await getDb()
    .select({ id: articles.id, processing: articles.processing })
    .from(articles)
    .where(and(eq(articles.slug, slug), eq(articles.ownerId, ownerId)))
    .limit(1);
  return row ? { id: row.id, processing: row.processing === "minimal" ? "minimal" : "full" } : undefined;
}

/**
 * **Is this reservation the admitted *Read this* for this article?** An
 * unsettled `'ingest'` row whose `article_id` is the article — the shape
 * `reserveUpgrade` writes and nothing else does (src/store/pg-billing.ts §
 * `reservationShapeOf`). `enqueue` asks it before it lets a job onto a minimal
 * article; the publication asks it again (`requirePaidUpgrade`).
 */
export async function isReadThisFor(ingestEventId: string, articleId: string): Promise<boolean> {
  const found = await getDb().execute(sql`
    select 1 from spideryarn.ingest_events
     where id = ${ingestEventId}::uuid
       and kind = 'ingest'
       and article_id = ${articleId}::uuid
       and succeeded_at is null and released_at is null
     limit 1`);
  return found.rows.length > 0;
}
