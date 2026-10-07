/**
 * **A new slug's random id never equals one an article already has**, and when
 * the database has to refuse one anyway, the refusal is a sentence.
 *
 * Every new slug ends in a short id (`why-trees-spya-k3m9qt`), and
 * `articles.short_id` is unique across every owner. Until 2026-10-07 nothing
 * looked before minting, so an id that happened to equal an existing article's
 * reached the insert in `lockOrCreateArticle` and came back as a raw unique
 * violation, before any step ran. A retry keeps the failed name, so it failed
 * the same way. Rare for one import; it grows with the library (plan 261007f,
 * E10).
 *
 * Two halves:
 *
 * - **the minter** (`mintSlug`, src/jobs.ts) asks whether the id is taken and
 *   mints again. Driven with a stand-in for the lookup, so no database is
 *   needed to say "taken, then free";
 * - **the insert** (`lockOrCreateArticle`, src/store/pg-revisions.ts) against
 *   Postgres, for the collision the minter cannot prevent: two imports that
 *   mint one id at the same moment, where both lookups say "free".
 *
 * Outside this oracle: that the three places `enqueue` mints all go through
 * `mintSlug`. That is a grep (`slugWithShortId(` has no caller left in
 * src/jobs.ts but `mintSlug` itself), not something this file can see.
 *
 * ## Watched red, 2026-10-07
 *
 * The minter, with `mintSlug` minting once and never asking:
 *
 * ```
 *   × mints again when the first id is taken, and uses the second
 *     → expected [] to have a length of 2 but got +0
 * ```
 *
 * The insert, before the constraint was caught by name:
 *
 * ```
 *   × is refused in words when another article already has the id
 *     → expected Error: Failed query: insert into "spidery… { …(2) } to be an
 *       instance of PublishRefused
 * ```
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { shortIdInSlug } from "../src/ingest.js";
import { advanceJob, enqueue, freeSlug, getJob, mintSlug } from "../src/jobs.js";
import { currentOwnerId } from "../src/owner.js";
import { lockOrCreateArticle, PublishRefused } from "../src/store/pg-revisions.js";
import { shortIdIsTaken } from "../src/store/short-id-is-taken.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* ------------------------------------------------------------ the minter -- */

describe("minting a slug for a new article", () => {
  it("mints again when the first id is taken, and uses the second", async () => {
    const asked: string[] = [];
    const slug = await mintSlug("why-trees", async (id) => {
      asked.push(id);
      return asked.length === 1;
    });
    expect(asked).toHaveLength(2);
    expect(asked[1]).not.toBe(asked[0]);
    expect(shortIdInSlug(slug)).toBe(asked[1]);
    expect(slug).toBe(`why-trees-${asked[1]}`);
  });

  /* One lookup per import is what this costs when nothing is wrong, which is
     nearly always. A minter that asked twice to be sure would pass the case
     above. */
  it("asks exactly once when the id is free", async () => {
    const asked: string[] = [];
    const slug = await mintSlug("why-trees", async (id) => {
      asked.push(id);
      return false;
    });
    expect(asked).toHaveLength(1);
    expect(shortIdInSlug(slug)).toBe(asked[0]);
  });

  /* A lookup that says "taken" for ever must not hang the import. The third id
     goes out unasked and the database has the last word. */
  it("gives up asking after three ids, and still answers", async () => {
    const asked: string[] = [];
    const slug = await mintSlug("why-trees", async (id) => {
      asked.push(id);
      return true;
    });
    expect(asked).toHaveLength(2);
    const used = shortIdInSlug(slug);
    expect(used).toBeDefined();
    expect(asked).not.toContain(used);
  });

  /* `freeSlug` is one of the three places that mint, and the only one with a
     seam: the same lookup, handed through. */
  it("is what freeSlug mints with, for an address nothing holds", async () => {
    const asked: string[] = [];
    const got = await freeSlug(
      "why-trees",
      "https://example.com/why-trees",
      async () => undefined,
      async (id) => {
        asked.push(id);
        return asked.length === 1;
      },
    );
    expect(got.kind).toBe("minted");
    expect(asked).toHaveLength(2);
    expect(shortIdInSlug(got.slug)).toBe(asked[1]);
  });
});

/* ------------------------------------------------- the insert, for real -- */

await pgReady({
  suite: "tests/short-id-collision.test.ts",
  tables: ["spideryarn.articles"],
});

describe("an article row whose short id another article already has", { timeout: 20_000 }, () => {
  afterAll(async () => {
    await closeDb();
  });

  type Tx = Parameters<typeof lockOrCreateArticle>[0];

  /**
   * One transaction holding an article with short id `held`, then `run`, then
   * rolled back whatever happens. Nothing is left behind, so this cannot
   * collide with a peer's run on the shared database.
   */
  const ROLLED_BACK = Symbol("rolled back");
  async function besideAnArticleHolding<T>(held: string, run: (tx: Tx) => Promise<T>): Promise<T> {
    let answer: T | undefined;
    try {
      await getDb().transaction(async (tx) => {
        await tx.insert(articles).values({
          id: randomUUID(),
          ownerId: currentOwnerId(),
          slug: `holder-${held}`,
          shortId: held,
        });
        answer = await run(tx as unknown as Tx);
        throw ROLLED_BACK;
      });
    } catch (err) {
      if (err !== ROLLED_BACK) throw err;
    }
    return answer as T;
  }

  it("is refused in words when another article already has the id", async () => {
    const held = mintId();
    const refusal = await besideAnArticleHolding(held, (tx) =>
      lockOrCreateArticle(tx, `other-base-${held}`, { askedUrl: null }),
    ).then(
      () => null,
      (err: unknown) => err,
    );
    expect(refusal).toBeInstanceOf(PublishRefused);
    const refused = refusal as PublishRefused;
    /* No Retry: a retry keeps the name, so it would stop in the same place. */
    expect(refused.failureKind).toBe("bug");
    /* The reason tells the reader what to do, and is ours from end to end: no
       statement, no bound values, no constraint name. */
    expect(refused.reasons.join(" ")).toMatch(/add the article again/i);
    expect(refused.message).not.toMatch(/insert into|articles_short_id_unique|Failed query/i);
  });

  /* The control: beside the same holder, a slug with an id of its own is
     created as usual. Without it, a `lockOrCreateArticle` that refused every
     insert would pass the case above. */
  it("while a slug with an id nobody has is created as usual", async () => {
    const held = mintId();
    const fresh = mintId();
    const row = await besideAnArticleHolding(held, (tx) =>
      lockOrCreateArticle(tx, `other-base-${fresh}`, { askedUrl: null }),
    );
    expect(row.shortId).toBe(fresh);
  });

  /**
   * **What the job itself does about it, pinned as it is and not as it should
   * be.** The refusal comes while the claim opens its draft. The recovery
   * opens a draft too, meets the same refusal, and so records nothing: the
   * advance rejects with the refusal and the job stays `running` under its
   * claim, with no error on it. Nothing ends it but the lease
   * (src/jobs.ts § *When it fails too, the original goes out*).
   *
   * The holder is inserted after the job is queued, with the id the job's own
   * slug ends in. That is the simultaneous mint the minter cannot see.
   */
  it("leaves the job running under its claim, with the refusal as the advance's answer", async () => {
    const job = await enqueue({ slug: "collide", url: "https://collide.example/a", pump: false });
    const held = shortIdInSlug(job.slug) as string;
    await getDb()
      .insert(articles)
      .values({ id: randomUUID(), ownerId: currentOwnerId(), slug: `holder-${held}`, shortId: held });
    try {
      await expect(advanceJob(job.id)).rejects.toBeInstanceOf(PublishRefused);
      const after = await getJob(job.id);
      expect(after?.status).toBe("running");
      expect(after?.error).toBeUndefined();
    } finally {
      await getDb().delete(jobsTable).where(eq(jobsTable.id, job.id));
      await getDb().delete(articles).where(eq(articles.slug, `holder-${held}`));
    }
  });

  /* The lookup the minter asks, against the real column. */
  it("and the lookup says taken for an id an article has, free for one none has", async () => {
    const held = mintId();
    const slug = `holder-${held}`;
    await getDb()
      .insert(articles)
      .values({ id: randomUUID(), ownerId: currentOwnerId(), slug, shortId: held });
    try {
      expect(await shortIdIsTaken(held)).toBe(true);
      expect(await shortIdIsTaken(mintId())).toBe(false);
    } finally {
      await getDb().delete(articles).where(eq(articles.slug, slug));
    }
  });
});
