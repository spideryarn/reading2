/**
 * **The "still arriving" state, through the store and out of both DTOs.**
 *
 * `article_revisions.nav_label_status` is a column added by
 * docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md § stage 1, and
 * stage 1 changes nothing anybody can see — everything writes `ready`. This
 * file is what will notice when stage 2 makes that stop being true, and what
 * says the wiring existed at all: a column nothing selects, nothing writes and
 * neither DTO carries would pass a typecheck and every other test in the suite.
 *
 * ## What each case is really guarding
 *
 * - **The write.** `writeArtefacts` sets the status beside the artefacts, in the
 *   one `UPDATE`, whenever a step writes `labels`. That is the seam stage 2
 *   edits rather than invents, and it has to be atomic with the artefact: a
 *   revision that publishes saying `ready` over labels that never landed is
 *   exactly the half-written state the single statement exists to prevent.
 * - **The read.** `loadArticle` names the field, so the reading view can
 *   withhold the paragraph label layer instead of drawing a run of blank cells
 *   (src/web/nav-labels.ts). The projection is what makes the column reachable
 *   at all, and a missing grant is silent: the field would arrive `undefined`
 *   and the client's `=== "ready"` would read it as *not ready* on every
 *   article — the layer gone everywhere, with nothing anywhere saying why.
 * - **Both DTOs.** The public one is the one that can lose it quietly:
 *   `publicArticle` rebuilds its result field by field, so a field nobody adds
 *   is dropped without a word (src/public/dto.ts § the allowlist).
 * - **The carry.** A `pending` revision that mints a draft must not have the
 *   draft say `ready`, or a job that never touched the labels would publish a
 *   revision claiming labels it did not get. `REVISION_CARRY_POLICY` says
 *   `carry`; this is the case that makes it true rather than declared.
 * - **The CHECK.** A fourth value is refused by the database, which is the only
 *   thing that can refuse it — the column is `text`.
 *
 * ## Why it seeds through the real loader
 *
 * `scratchArticleInPg` puts a corpus article into Postgres through
 * `pgArtifactsIn` → `writeArtefacts`, with every guard that path has. So the
 * first case below is a genuine round trip rather than an assertion about an
 * `INSERT` this file wrote: the fixture carries `labels.json`, the store writes
 * it, and the column is whatever the store decided. Seeding by hand would have
 * proved only that a column accepts a string.
 *
 * tests/nav-label-status.test.ts is the static half — the CHECK against the
 * union, the policy, and the client's rule — and needs no database.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { beginRevision } from "../src/store/pg-revisions.js";
import { pgPublicReader } from "../src/store/public-reader.js";
import { loadArticle } from "../src/store/index.js";
import type { NavLabelStatus } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/nav-label-status-pg.test.ts",
  /* The column, not just the table: this file's whole subject is the migration
     that added it, and a database one behind would otherwise fail with a
     confusing 42703 instead of "run npm run db:migrate". */
  columns: [{ table: "spideryarn.article_revisions", column: "nav_label_status" }],
});

/** One run's suffix, so two processes running this file cannot collide. */
const RUN = randomUUID().slice(0, 8);
const SLUG = `test-nav-label-status-${RUN}`;

let article: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  /* **The seed is asserted, not assumed.** Every case below is about what
     happens when the `labels` artefact is written, so a fixture that did not
     bring one would make the whole file green about nothing — the shape
     docs/reusable/silent-success.md is written against. */
  expect(article.copied).toContain("hierarchy");
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

/** The column, as the database currently holds it. */
async function column(): Promise<string | null> {
  const [row] = await getDb()
    .select({ status: articleRevisions.navLabelStatus, current: articles.currentRevisionId })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(eq(articles.slug, SLUG))
    .limit(1);
  return row?.status ?? null;
}

/** Set the column on the current revision, the way stage 2's labels step will. */
async function setColumn(status: NavLabelStatus | string): Promise<void> {
  const [row] = await getDb()
    .select({ id: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.slug, SLUG))
    .limit(1);
  if (!row?.id) throw new Error(`no current revision for ${SLUG}`);
  await getDb()
    .update(articleRevisions)
    .set({ navLabelStatus: status as NavLabelStatus })
    .where(eq(articleRevisions.id, row.id));
}

/** Let anyone read it, so the public projection has something to answer about. */
async function share(): Promise<void> {
  await getDb()
    .update(articles)
    .set({ visibility: "public", publicAt: new Date() })
    .where(eq(articles.slug, SLUG));
}

describe("writing the labels writes where the labels are", () => {
  it("says ready after a step wrote them, without anybody setting it", () => {
    /* The fixture went in through `writeArtefacts` with a `labels` part, so this
       is the store's own answer rather than the column default. The two are the
       same string today and that is the point of stage 1; the case that tells
       them apart is the next one. */
    return expect(column()).resolves.toBe("ready");
  });

  it("moves a pending revision to ready when the labels arrive", async () => {
    /* **The one case that cannot pass on the column default**, and the two
       halves are what make it so. The current revision is put into the state
       stage 2 will write, and then the *same slug* is loaded again — a second
       pass, which mints a draft off that revision. `carry` brings the `pending`
       into the draft (the case further down), so the only thing that can make
       this `ready` again is `writeArtefacts` writing it beside the labels.
       Delete that rule and the article stays `pending` for ever and the reader
       never gets their labels back, with nothing anywhere saying why. */
    await setColumn("pending");
    expect(await column()).toBe("pending");

    /* Same slug and same owner, so this reuses the article row rather than
       refusing it — `lockOrCreateArticle` only turns a slug away when it
       belongs to somebody else. Not `remove()`d: it *is* the file's article, and
       `afterAll` takes it away once. */
    await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
    expect(await column()).toBe("ready");
  }, 60_000);
});

describe("reading it back", () => {
  it("reaches the owner's reading view", async () => {
    /* The projection grant and the named field in `loadArticle`, both. Without
       either, this is `undefined` — and the client reads that as *not ready*, so
       the paragraph layer would be gone from every article with nothing saying
       so. */
    await setColumn("ready");
    await runAsOwner(DEV_OWNER_ID, async () => {
      expect((await loadArticle(SLUG)).navLabelStatus).toBe("ready");
    });
  });

  it("reports the state the column is actually in", async () => {
    /* Both of the other two, so the read is carrying the value rather than a
       constant that happens to match today. A hardwired `"ready"` passes the
       case above and fails here — the positive-control shape
       tests/store-carry-forward.test.ts uses for `stale`. */
    for (const status of ["pending", "failed"] as const) {
      await setColumn(status);
      await runAsOwner(DEV_OWNER_ID, async () => {
        expect((await loadArticle(SLUG)).navLabelStatus).toBe(status);
      });
    }
    await setColumn("ready");
  });

  it("crosses the public boundary, where a rebuilt field is easiest to lose", async () => {
    /* `publicArticle` constructs its result field by field, so an added field is
       silently dropped unless somebody names it — the property that makes the
       allowlist safe and the one that makes an omission here quiet. A visitor
       without it draws the same run of blank cells the owner would.
       Both non-`ready` values, so a hardwired constant fails. */
    await share();
    for (const status of ["ready", "pending", "failed"] as const) {
      await setColumn(status);
      const shared = await pgPublicReader.loadArticle(SLUG);
      expect(shared.navLabelStatus, status).toBe(status);
    }
    await setColumn("ready");
  });
});

describe("a new draft", () => {
  it("carries the status forward with the labels it is about", async () => {
    /* `beginRevision` copies the current published revision column by column,
       from `carriedColumns()`. Classified `mint` this would reset to `ready`,
       and a `{ steps: ["blocks"] }` job would publish a revision claiming labels
       that are still owed. */
    await setColumn("pending");
    /* `runAsOwner`, because `lockOrCreateArticle` reads the current owner and
       refuses a slug that belongs to somebody else — outside one, this call is
       a different reader looking at the fixture. */
    const draftId = await runAsOwner(
      DEV_OWNER_ID,
      async () => (await beginRevision({ slug: SLUG })).revisionId,
    );
    const [draft] = await getDb()
      .select({ status: articleRevisions.navLabelStatus })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, draftId))
      .limit(1);
    expect(draft?.status).toBe("pending");
    await setColumn("ready");
  });
});

describe("the CHECK", () => {
  it("refuses a value that is not one of the three", async () => {
    /* The column is `text`, so this constraint is the only thing between a
       hand-run UPDATE or a restored dump and a client `switch` with no arm for
       what it finds. `23514` is the check violation. */
    await setColumn("ready");
    await expect(setColumn("arriving")).rejects.toThrow(/nav_label_status|check/i);
    expect(await column()).toBe("ready");
  });
});
