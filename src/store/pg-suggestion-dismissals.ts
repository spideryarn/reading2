/**
 * The command bar's suggestions an owner dismissed, on one article —
 * docs/plans/261010u-bar-suggestions-capped-dismissable-collapsible-and-the-guide-at-the-top.md
 * (report `spya-yf23zk`). The table is `command_suggestion_dismissals`, one row
 * per article; the shape is src/store/pg-stale-notices.ts's: ownership first,
 * through `articleIdForOwned`, so a slug the caller does not own is a 404 here
 * as everywhere.
 *
 * **What is stored is identities, never words** (src/command-suggest.ts §
 * `suggestionIdentity`), and they belong to one `readFrom` fingerprint: a
 * dismissal under a different fingerprint replaces the row, and the read hands
 * back nothing unless the fingerprint matches (GPT Sol's plan review, F2, F6).
 *
 * **One statement, so two dismissals at once cannot lose one.** The upsert's
 * `do update` runs against the row as it stands after any concurrent writer
 * committed — Postgres locks the conflicting row and re-reads it — so each
 * append sees the other's.
 *
 * ## What may be logged from this file
 *
 * Nothing, and nothing is. Which suggestions a reader turned down is theirs.
 */

import { and, eq, sql } from "drizzle-orm";

import { MAX_DISMISSED_SUGGESTIONS } from "../command-suggest.js";
import { getDb } from "../db/client.js";
import { commandSuggestionDismissals } from "../db/schema.js";
import type { SuggestionDismissalStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned } from "./pg.js";

const rawPgSuggestionDismissalStore: SuggestionDismissalStore = {
  async dismiss(slug: string, readFrom: string, identity: string): Promise<void> {
    const articleId = await articleIdForOwned(slug);
    /* Under the same fingerprint: append if absent, keep the newest
       `MAX_DISMISSED_SUGGESTIONS` (the slice drops from the front, which is
       the oldest). Under another: start again with this one. `created_at`
       remains when this article first acquired a dismissal row; the later
       action is `dismissed_at` (docs/project/sql.md § Store when it happened). */
    await getDb().execute(sql`
      insert into spideryarn.command_suggestion_dismissals as d (article_id, read_from, dismissed)
      values (${articleId}, ${readFrom}, array[${identity}]::text[])
      on conflict (article_id) do update set
        dismissed = case
          when d.read_from <> excluded.read_from then excluded.dismissed
          when ${identity} = any(d.dismissed) then d.dismissed
          else (d.dismissed || excluded.dismissed)[
            greatest(1, cardinality(d.dismissed) + 2 - ${MAX_DISMISSED_SUGGESTIONS}::int):
          ]
        end,
        read_from = excluded.read_from,
        dismissed_at = now()
    `);
  },

  async forFingerprint(slug: string, readFrom: string): Promise<ReadonlySet<string>> {
    const articleId = await articleIdForOwned(slug);
    const rows = await getDb()
      .select({ dismissed: commandSuggestionDismissals.dismissed })
      .from(commandSuggestionDismissals)
      .where(
        and(eq(commandSuggestionDismissals.articleId, articleId), eq(commandSuggestionDismissals.readFrom, readFrom)),
      )
      .limit(1);
    return new Set(rows[0]?.dismissed ?? []);
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgSuggestionDismissalStore: SuggestionDismissalStore = guardDbStore(
  "suggestion-dismissals",
  rawPgSuggestionDismissalStore,
);
