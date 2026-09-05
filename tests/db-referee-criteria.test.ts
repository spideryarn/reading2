/**
 * **What `referee_criteria` and the two new `comments` columns promise, asserted
 * against a real Postgres.**
 *
 * A file of its own rather than more cases in tests/db-schema.test.ts, for one
 * reason worth saying out loud: this landed in a tree thirteen sessions were
 * editing at once, and a new file cannot collide with anybody. The helpers are
 * the same ones, copied deliberately — a rollback wrapper and a savepoint per
 * expected failure — and the reasoning behind both is in that file's header,
 * not repeated here.
 *
 * The cases are not tests of Postgres. Each pins a decision drizzle/0042 argues
 * for in prose and that a later tidy-up could quietly undo. The one to read
 * first is **the pair about `comments_criterion_fk`**: `no action` rather than
 * `restrict` is a distinction nothing in the code makes visible, and the two
 * tests together are the only thing that says it was chosen rather than left.
 *
 * **These skip when there is no database.** A skipped test protects nothing;
 * run `npm run db:start && npm run db:migrate` before trusting a green run.
 *
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md, stage 2.
 */

import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";

import { loadEnvLocal } from "../src/env.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/db-referee-criteria.test.ts",
  tables: ["spideryarn.referee_criteria"],
  keepPool: true,
});

afterAll(async () => {
  await pool?.end();
});

async function inRollback(body: (c: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool!.connect();
  try {
    await client.query("begin");
    await body(client);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

/** One expected failure, on its own savepoint, so the next one still runs. */
async function expectViolation(
  c: PoolClient,
  constraint: RegExp,
  run: () => Promise<unknown>,
): Promise<void> {
  await c.query("savepoint attempt");
  await expect(run()).rejects.toThrow(constraint);
  await c.query("rollback to savepoint attempt");
}

/* Random, not the next number in the block — tests/db-schema.test.ts held
   this file's previous id and both seed `auth.users` under it.
   docs/project/testing.md § Mint a fixture id randomly, not by counting. */
const OWNER = "7ac042a4-7c19-44a6-ab6d-448acc5909b8";
const ART = "cccccccc-0000-0000-0000-000000000001";
const BLOCK = "spya-aaaaaa";
const CRIT = "spya-bbbbbb";

/** An article with one block identity and one diverging criterion on it. */
async function seed(c: PoolClient): Promise<void> {
  await seedAuthUser(c, {
    id: OWNER,
    email: "referee-schema-test@example.invalid",
    onConflictDoNothing: true,
  });
  await c.query(`insert into spideryarn.articles (id, owner_id, slug) values ($1,$2,'referee-schema-test')`, [
    ART,
    OWNER,
  ]);
  await c.query(`insert into spideryarn.block_identities (article_id, block_id) values ($1,$2)`, [
    ART,
    BLOCK,
  ]);
  await c.query(
    `insert into spideryarn.referee_criteria
       (article_id, id, owner_id, kind, criterion, pole_against, pole_favour, scale, status)
     values ($1,$2,$3,'diverging','are the controls adequate?','the controls are weak',
             'the controls are pre-registered','rg','done')`,
    [ART, CRIT, OWNER],
  );
}

/** A comment, optionally carrying the referee's own mark. */
async function addComment(
  c: PoolClient,
  id: string,
  criterionId: string | null,
  valence: number | null,
): Promise<void> {
  await c.query(
    `insert into spideryarn.comments
       (article_id, id, owner_id, block_id, quote, start, body, status, criterion_id, valence)
     values ($1,$2,$3,$4,'hello',0,'my own view','none',$5,$6)`,
    [ART, id, OWNER, BLOCK, criterionId, valence],
  );
}

describe("referee_criteria", () => {
  it("takes a diverging criterion with both poles and a scale", async () => {
    await inRollback(async (c) => {
      await seed(c);
      const { rows } = await c.query(
        `select kind, pole_against, pole_favour, scale, results
           from spideryarn.referee_criteria where article_id=$1 and id=$2`,
        [ART, CRIT],
      );
      expect(rows[0].scale).toBe("rg");
      // `results` defaults to an empty array rather than null, so a pending run
      // reads as "nothing yet" rather than as a missing field.
      expect(rows[0].results).toEqual([]);
    });
  });

  it("refuses half a diverging criterion, in every direction", async () => {
    await inRollback(async (c) => {
      await seed(c);
      const insert = (id: string, cols: string, vals: string) =>
        c.query(
          `insert into spideryarn.referee_criteria (article_id, id, owner_id, criterion, status${cols})
           values ($1,$2,$3,'x','done'${vals})`,
          [ART, id, OWNER],
        );
      // Diverging with no poles: a signed number pointing at nothing.
      await expectViolation(c, /referee_criteria_diverging_shape/, () =>
        insert("spya-cccccc", ", kind", ", 'diverging'"),
      );
      // Diverging with one pole: the panel could print one direction in words.
      await expectViolation(c, /referee_criteria_diverging_shape/, () =>
        insert("spya-dddddd", ", kind, pole_against, scale", ", 'diverging', 'weak', 'rg'"),
      );
      // Diverging with poles and no scale: nothing to draw it with.
      await expectViolation(c, /referee_criteria_diverging_shape/, () =>
        insert("spya-eeeeee", ", kind, pole_against, pole_favour", ", 'diverging','a','b'"),
      );
      // Poles on a kind that has no ends: two fields nothing would ever read.
      await expectViolation(c, /referee_criteria_diverging_shape/, () =>
        insert("spya-ffffff", ", kind, pole_against, pole_favour, scale", ", 'single','a','b','rg'"),
      );
    });
  });

  it("refuses a scale that names no stylesheet block", async () => {
    await inRollback(async (c) => {
      await seed(c);
      /* TIGHT on purpose, unlike `referee_criteria_colour` two cases below. A
         scale is the name of a block of custom properties that either exists in
         styles/colourscales.css or does not, and an unrecognised one draws
         nothing at all — there is no safe fallback to be wrong into. */
      await expectViolation(c, /referee_criteria_scale/, () =>
        c.query(
          `insert into spideryarn.referee_criteria
             (article_id, id, owner_id, kind, criterion, pole_against, pole_favour, scale, status)
           values ($1,'spya-gggggg',$2,'diverging','x','a','b','purple','done')`,
          [ART, OWNER],
        ),
      );
    });
  });

  it("accepts a colour slot past the end of today's palette", async () => {
    await inRollback(async (c) => {
      await seed(c);
      /* LOOSE on purpose, copied from `search_runs_colour` (drizzle/0016). The
         database does not know what colour a slot is; a value past the palette
         falls back to the row's automatic hue, which is the safe way to be
         wrong, while a check pinned at 8 would refuse a reader's choice on the
         day the palette grows. */
      await c.query(
        `insert into spideryarn.referee_criteria
           (article_id, id, owner_id, kind, criterion, status, colour)
         values ($1,'spya-hhhhhh',$2,'single','x','done',40)`,
        [ART, OWNER],
      );
      await expectViolation(c, /referee_criteria_colour/, () =>
        c.query(
          `insert into spideryarn.referee_criteria
             (article_id, id, owner_id, kind, criterion, status, colour)
           values ($1,'spya-jjjjjj',$2,'single','x','done',64)`,
          [ART, OWNER],
        ),
      );
    });
  });

  it("refuses half an attempt fence", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await expectViolation(c, /referee_criteria_attempt_both/, () =>
        c.query(
          `insert into spideryarn.referee_criteria
             (article_id, id, owner_id, kind, criterion, status, attempt_id)
           values ($1,'spya-kkkkkk',$2,'single','x','pending','a')`,
          [ART, OWNER],
        ),
      );
    });
  });
});

describe("the referee's own mark on a comment", () => {
  it("stores a negative valence unchanged — the whole point of the feature", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await addComment(c, "spya-mmmmmm", CRIT, -70);
      const { rows } = await c.query(
        `select valence, criterion_id from spideryarn.comments where article_id=$1 and id=$2`,
        [ART, "spya-mmmmmm"],
      );
      /* If this ever reads 0, something between here and the reader has
         confused a signed valence with a 0–100 confidence, which is the exact
         failure src/referee-criteria.ts was written to prevent. */
      expect(rows[0].valence).toBe(-70);
      expect(rows[0].criterion_id).toBe(CRIT);
    });
  });

  it("lets a comment answer a criterion without scoring it", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await addComment(c, "spya-nnnnnn", CRIT, null);
      const { rows } = await c.query(
        `select valence from spideryarn.comments where article_id=$1 and id=$2`,
        [ART, "spya-nnnnnn"],
      );
      expect(rows[0].valence).toBeNull();
    });
  });

  it("leaves an ordinary reading note exactly as it was", async () => {
    await inRollback(async (c) => {
      await seed(c);
      /* The additive guarantee, at the database: a comment written the way
         every comment has been written since 2026-08-28 still inserts, with
         both new columns absent from the statement. */
      await c.query(
        `insert into spideryarn.comments
           (article_id, id, owner_id, block_id, quote, start, body, status)
         values ($1,'spya-pppppp',$2,$3,'hello',0,'a reading note','none')`,
        [ART, OWNER, BLOCK],
      );
      const { rows } = await c.query(
        `select criterion_id, valence from spideryarn.comments where article_id=$1 and id=$2`,
        [ART, "spya-pppppp"],
      );
      expect(rows[0]).toEqual({ criterion_id: null, valence: null });
    });
  });

  it("refuses a placement with nothing to place it on", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await expectViolation(c, /comments_valence_needs_criterion/, () =>
        addComment(c, "spya-qqqqqq", null, -70),
      );
    });
  });

  it("refuses a placement outside −100…+100, at both ends", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await expectViolation(c, /comments_valence_range/, () =>
        addComment(c, "spya-rrrrrr", CRIT, -101),
      );
      await expectViolation(c, /comments_valence_range/, () =>
        addComment(c, "spya-ssssss", CRIT, 101),
      );
    });
  });

  it("refuses a criterion belonging to another article", async () => {
    await inRollback(async (c) => {
      await seed(c);
      /* What the COMPOSITE key buys beyond the reference itself, and the same
         trick `comments_identity_fk` plays: the article id travels in both
         halves, so a comment cannot answer somebody else's criterion. */
      await c.query(
        `insert into spideryarn.articles (id, owner_id, slug)
         values ('cccccccc-0000-0000-0000-000000000002',$1,'referee-schema-test-two')`,
        [OWNER],
      );
      await c.query(
        `insert into spideryarn.block_identities (article_id, block_id)
         values ('cccccccc-0000-0000-0000-000000000002',$1)`,
        [BLOCK],
      );
      await expectViolation(c, /comments_criterion_fk/, () =>
        c.query(
          `insert into spideryarn.comments
             (article_id, id, owner_id, block_id, quote, start, status, criterion_id, valence)
           values ('cccccccc-0000-0000-0000-000000000002','spya-tttttt',$1,$2,'hello',0,'none',$3,10)`,
          [OWNER, BLOCK, CRIT],
        ),
      );
    });
  });
});

/* ------------------------------------------------------------------ */
/* The pair that says `no action` was chosen, not left                 */
/* ------------------------------------------------------------------ */

describe("deleting a criterion, and deleting the article under it", () => {
  it("refuses to delete a criterion the referee has written against", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await addComment(c, "spya-uuuuuu", CRIT, -70);
      /* `cascade` here would delete the referee's own sentences about the
         paper, which are theirs and are not derived from anything. So the
         delete fails and the UI has to offer to detach the marks first. */
      await expectViolation(c, /comments_criterion_fk/, () =>
        c.query(`delete from spideryarn.referee_criteria where article_id=$1 and id=$2`, [
          ART,
          CRIT,
        ]),
      );
    });
  });

  it("still deletes the whole article, which is why it is not `restrict`", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await addComment(c, "spya-vvvvvv", CRIT, -70);
      /* THE REASON FOR `no action`. Deleting the article cascades into both
         `comments` and `referee_criteria` in an order Postgres does not
         promise. `restrict` is checked row by row as that happens, so it could
         fire while the comment rows are still there and refuse a delete that is
         entirely legitimate; `no action` is the same rule checked at the end of
         the statement, by which time neither row exists.
         If this goes red, somebody has changed the FK to `restrict` and
         deleting an article with referee marks on it now fails in production. */
      await c.query(`delete from spideryarn.articles where id=$1`, [ART]);
      const { rows } = await c.query(
        `select count(*)::int as n from spideryarn.comments where article_id=$1`,
        [ART],
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe("the owner key", () => {
  it("exists, and drizzle-kit does not know about it", async () => {
    /* drizzle/0043, by hand, for the reason drizzle/0040 sets out: a future
       generated migration that drops and recreates this table takes the
       constraint with it and says nothing. This is the alarm. */
    const { rows } = await pool!.query(
      `select conname from pg_constraint where conname = 'referee_criteria_owner_fk'`,
    );
    expect(rows.map((r) => r.conname)).toEqual(["referee_criteria_owner_fk"]);
  });
});
