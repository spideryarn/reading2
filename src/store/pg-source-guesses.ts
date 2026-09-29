/**
 * **An uploaded paper's guessed web address — the claim, and the fenced
 * answer.** One row per article in `upload_source_guesses` (src/db/schema.ts
 * says what each CHECK holds); the orchestration is src/source-guess-run.ts.
 * docs/plans/260929g-canonical-link-for-an-uploaded-paper.md § Decisions 2.
 *
 * ## Why the claim is one statement
 *
 * `insert … on conflict (article_id) do update … where <reclaimable>
 * returning`, the shape `claimTopicScores` (src/store/pg-shelf-terms.ts)
 * already uses. Two concurrent first opens both try the insert; one inserts,
 * the other's conflict waits for it, then evaluates the `where` against the
 * fresh claim — which is not stale — and returns nothing. So exactly one of
 * them is `claimed`, with no lock taken by hand and nothing to forget to
 * release (docs/project/sql.md § `SELECT … FOR UPDATE` cannot lock a row that
 * is not there). The database's clock throughout.
 *
 * ## What may be logged from this file
 *
 * Nothing, and nothing is: the URL is where somebody's upload lives.
 */
import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { uploadSourceGuesses } from "../db/schema.js";
import type { SourceGuess } from "../types.js";
import {
  SOURCE_GUESS_MAX_ATTEMPTS,
  type SourceGuessClaim,
  type SourceGuessOutcome,
  type SourceGuessStore,
} from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned } from "./pg.js";
import { sourceGuessFor } from "./source-guess-row.js";

const t = uploadSourceGuesses;

/** The claim is fenced by this: only the holder of the token may answer or release. */
function holding(articleId: string, token: string) {
  return and(eq(t.articleId, articleId), eq(t.status, "searching"), eq(t.claimToken, token));
}

const rawPgSourceGuessStore: SourceGuessStore = {
  async read(slug: string): Promise<SourceGuess | undefined> {
    return sourceGuessFor(await articleIdForOwned(slug));
  },

  async claim(slug: string, opts: { staleMs: number }): Promise<SourceGuessClaim> {
    const articleId = await articleIdForOwned(slug);
    const token = randomUUID();
    const staleSeconds = opts.staleMs / 1000;
    /* On a reclaim: a row already at the cap settles as `none` instead of being
       claimed a third time; any other stale row is taken with a fresh token. */
    const capped = sql`${t.attempts} >= ${SOURCE_GUESS_MAX_ATTEMPTS}`;
    const rows = await getDb()
      .insert(t)
      .values({ articleId, status: "searching", claimToken: token, attempts: 1, claimedAt: sql`now()` })
      .onConflictDoUpdate({
        target: t.articleId,
        set: {
          status: sql`case when ${capped} then 'none' else 'searching' end`,
          why: sql`case when ${capped} then 'attempts' else null end`,
          claimToken: sql`case when ${capped} then null else excluded.claim_token end`,
          attempts: sql`case when ${capped} then ${t.attempts} else ${t.attempts} + 1 end`,
          claimedAt: sql`case when ${capped} then ${t.claimedAt} else now() end`,
          finishedAt: sql`case when ${capped} then now() else null end`,
        },
        setWhere: sql`${t.status} = 'searching'
          and ${t.claimedAt} <= now() - make_interval(secs => ${staleSeconds}::double precision)`,
      })
      .returning({ status: t.status, claimToken: t.claimToken, attempts: t.attempts });

    const won = rows[0];
    if (won?.status === "searching" && won.claimToken === token) {
      return { kind: "claimed", token, attempt: won.attempts };
    }
    /* Refused (a live claim, or already settled), or just settled by the cap:
       what the row says now is the answer. */
    const now = await sourceGuessFor(articleId);
    if (now?.status === "found" || now?.status === "none") return { kind: "settled", guess: now };
    return { kind: "busy" };
  },

  async finish(slug: string, token: string, outcome: SourceGuessOutcome): Promise<boolean> {
    const articleId = await articleIdForOwned(slug);
    const answer =
      outcome.status === "found"
        ? {
            status: "found" as const,
            url: outcome.url,
            host: outcome.host,
            kind: outcome.kind,
            matchedBy: outcome.matchedBy,
            why: null,
          }
        : { status: "none" as const, url: null, host: null, kind: null, matchedBy: null, why: outcome.why };
    const rows = await getDb()
      .update(t)
      .set({
        ...answer,
        claimToken: null,
        searches: outcome.searches,
        model: outcome.model,
        finishedAt: sql`now()`,
      })
      .where(holding(articleId, token))
      .returning({ articleId: t.articleId });
    return rows.length > 0;
  },

  async release(slug: string, token: string, opts: { refund: boolean }): Promise<boolean> {
    const articleId = await articleIdForOwned(slug);
    const rows = await getDb()
      .update(t)
      .set({
        /* The epoch rather than null: a `searching` row must carry a claim
           time (the CHECK), and this one is older than any staleness. */
        claimedAt: sql`to_timestamp(0)`,
        ...(opts.refund ? { attempts: sql`greatest(${t.attempts} - 1, 0)` } : {}),
      })
      .where(holding(articleId, token))
      .returning({ articleId: t.articleId });
    return rows.length > 0;
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgSourceGuessStore: SourceGuessStore = guardDbStore("source-guesses", rawPgSourceGuessStore);
