/**
 * The privacy-bearing shape of the cited-candidate query, without opening a
 * database connection. The Postgres suite proves the rows this query returns;
 * this pins the SQL gates themselves in the ordinary unit lane, where a
 * missing database cannot turn a privacy mutation into an untested one.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import { citedCandidatesQuery } from "../src/store/pg-cited-in-spideryarn.js";

const OWNER = "owner-under-test";

function query(): { sql: string; params: unknown[] } {
  return citedCandidatesQuery(drizzle.mock(), OWNER).toSQL();
}

describe("the cited-candidate query's privacy boundary", () => {
  it("admits mine, or listed public articles, before applying both readability bars", () => {
    const { sql, params } = query();
    const where = sql.slice(sql.indexOf(" where "));
    expect(where).toMatch(
      /\("spideryarn"\."articles"\."owner_id" = \$\d+ or \("spideryarn"\."articles"\."visibility" = \$\d+ and "spideryarn"\."articles"\."archived_at" is null\)\) and "spideryarn"\."article_revisions"\."tree" is not null and exists/,
    );
    expect(where).toContain('"spideryarn"."revision_blocks"."revision_id" = "spideryarn"."article_revisions"."id"');
    expect(params).toContain(OWNER);
    expect(params).toContain("public");
  });

  it("keeps owner-only addresses, renames, and upload guesses behind SQL cases", () => {
    const { sql } = query();
    const projection = sql.slice(0, sql.indexOf(" from "));
    expect(projection).toMatch(
      /case when "spideryarn"\."articles"\."owner_id" = \$\d+\s+then left\("spideryarn"\."article_revisions"\."requested_url", 2048\) end as "requested_url"/,
    );
    expect(projection).toMatch(
      /case when "spideryarn"\."articles"\."owner_id" = \$\d+\s+then coalesce\("spideryarn"\."articles"\."title_override", "spideryarn"\."article_revisions"\."title"\)\s+else "spideryarn"\."article_revisions"\."title" end/,
    );
    expect(projection).toMatch(
      /case when "spideryarn"\."articles"\."owner_id" = \$\d+\s+and "spideryarn"\."upload_source_guesses"\."status" = 'found' and "spideryarn"\."upload_source_guesses"\."kind" = 'canonical'\s+then left\("spideryarn"\."upload_source_guesses"\."url", 2048\) end as "guessed_url"/,
    );
  });

  it("left-joins the one guess row by article, without making it an admission condition", () => {
    const { sql } = query();
    expect(sql).toContain(
      'left join "spideryarn"."upload_source_guesses" on "spideryarn"."upload_source_guesses"."article_id" = "spideryarn"."articles"."id"',
    );
    const where = sql.slice(sql.indexOf(" where "));
    expect(where).not.toContain("upload_source_guesses");
  });
});
