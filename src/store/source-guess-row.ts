/**
 * **One `upload_source_guesses` row, as the owner's reading view sees it** — a
 * leaf, so src/store/pg.ts can put it on the article payload without importing
 * the claim-and-finish store (src/store/pg-source-guesses.ts), which itself
 * imports pg.ts. docs/plans/260929g-canonical-link-for-an-uploaded-paper.md.
 *
 * Callers are owner-scoped before they get here: `articleId` has come from an
 * owned lookup.
 */
import { eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { uploadSourceGuesses } from "../db/schema.js";
import type { SourceGuess } from "../types.js";

export type SourceGuessRow = typeof uploadSourceGuesses.$inferSelect;

/**
 * The row as the payload's union. The table's CHECKs make `found` carry all
 * four columns; a row that somehow did not is drawn as *searching* — the state
 * that draws nothing and asks the server again — rather than as a link.
 */
export function toSourceGuess(row: SourceGuessRow): SourceGuess {
  switch (row.status) {
    case "found":
      if (row.url && row.host && row.kind && row.matchedBy) {
        return { status: "found", url: row.url, host: row.host, kind: row.kind, matchedBy: row.matchedBy };
      }
      return { status: "searching" };
    case "none":
      return { status: "none" };
    case "searching":
      return { status: "searching" };
    default: {
      const never: never = row.status;
      return never;
    }
  }
}

/** The article's guess, or `undefined` when nobody has looked. */
export async function sourceGuessFor(
  articleId: string,
  db: Pick<ReturnType<typeof getDb>, "select"> = getDb(),
): Promise<SourceGuess | undefined> {
  const rows = await db
    .select()
    .from(uploadSourceGuesses)
    .where(eq(uploadSourceGuesses.articleId, articleId))
    .limit(1);
  return rows[0] ? toSourceGuess(rows[0]) : undefined;
}
