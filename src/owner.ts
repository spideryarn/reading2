/**
 * Who owns a row.
 *
 * Every table that a **person** owns carries `owner_id uuid not null references
 * auth.users(id)`, decided before there was any auth to populate it —
 * docs/project/database.md. Not every table: six of the thirteen carry it, and
 * `article_revisions`, `revision_blocks`, `block_identities`,
 * `revision_step_runs`, `ai_calls`, `chat_messages` and `queue_state` do not —
 * each belongs to a row that does (an article, a revision, a thread), and
 * carrying the owner twice is a second copy to disagree with the first.
 *
 * This file is where the value comes from. Today it is a constant; when the
 * beta gate lands (docs/plans/deploy-and-repo-move.md#the-beta-gate) it becomes
 * the session user, and this is the only file that has to know *who* the owner
 * is.
 *
 * **It is not the only file that changes when a second person arrives**, and an
 * earlier version of this comment said it was. Nothing in src/store/pg.ts
 * filters on `owner_id` — with one owner there is nothing to filter — so a
 * second user would see the first one's library until those queries are
 * written. `articles.slug` is globally unique as well, deliberately, because it
 * is the URL contract; two people ingesting the same URL is a question the beta
 * gate has to answer rather than a bug to fix here. GPT Sol raised both in
 * review, 2026-08-26; docs/plans/postgres-storage-review-sol.md.
 *
 * **`not null` on purpose**: a row with no owner is not a state this system
 * has. So there is no "anonymous" fallback here and there should never be one —
 * an unset owner in production must fail loudly at the boundary rather than
 * write a row nobody can be shown to have made.
 */

/**
 * A `auth.users(id)`, distinguishable by the type system from the other uuids
 * flying around.
 *
 * `ArticleId`, `RevisionId` and `OwnerId` are all `uuid` in the database and
 * all `string` in TypeScript, so nothing but a brand stops one being passed
 * where another is wanted — and the compiler is the only thing that would ever
 * notice, because a wrong-but-well-formed uuid produces "no rows" rather than
 * an error. That reads as "not found" and sends you looking in the wrong place.
 */
export type OwnerId = string & { readonly __brand: "OwnerId" };

/**
 * The fixed local development owner, created by `npm run db:seed-owner`.
 *
 * A valid v4-shaped uuid that no generator will mint, so it cannot collide with
 * a real user. Fixed rather than random so that it survives `npm run db:reset`
 * and is identical on a fresh clone — see scripts/db-seed-owner.ts for why the
 * random alternative rots.
 */
export const DEV_OWNER_ID = "00000000-0000-4000-8000-000000000001" as OwnerId;

/**
 * Deliberately not a real address. Nothing logs in locally, so this value is
 * never used for anything but telling one seeded row from another, and a
 * personal email in committed source earns nothing. Override with
 * `SPIDERYARN_OWNER_EMAIL` if you want the local Studio to show yours.
 */
export const DEV_OWNER_EMAIL = process.env.SPIDERYARN_OWNER_EMAIL ?? "dev@spideryarn.local";

/** Narrow a string to an `OwnerId`, checking it is uuid-shaped. */
function asOwnerId(value: string): OwnerId {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`not a uuid: ${value}`);
  }
  return value as OwnerId;
}

/**
 * The owner to stamp on rows written by this process.
 *
 * `SPIDERYARN_OWNER_ID` wins if set, so the local default can be overridden
 * without editing code — and so production, which has no `.env.local`, cannot
 * silently inherit a development constant it was never told about.
 *
 * When the gate lands this gains a request argument and the constant goes; the
 * signature is already shaped for it, which is the whole reason it is a
 * function rather than an exported value.
 */
export function currentOwnerId(): OwnerId {
  const fromEnv = process.env.SPIDERYARN_OWNER_ID;
  if (fromEnv) return asOwnerId(fromEnv);

  /**
   * **In production, an unconfigured owner is an error, not a default.**
   *
   * The first version of this function fell back to `DEV_OWNER_ID`
   * unconditionally — which contradicted the paragraph at the top of this file
   * saying an unset owner "must fail loudly at the boundary". It would have
   * failed, eventually, as an `auth.users` foreign key violation, because the
   * development user does not exist in the production project. That reads as a
   * database bug and sends you to the schema, which is the wrong place: the
   * actual fault is one missing environment variable, and it is three layers
   * away by the time anything complains.
   *
   * Caught by Fable in review, 2026-08-26.
   */
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    throw new Error(
      "SPIDERYARN_OWNER_ID is not set, and there is no development owner in " +
        "production. Set it, or wire up the beta gate so the session user " +
        "supplies it. See src/owner.ts.",
    );
  }

  return DEV_OWNER_ID;
}
