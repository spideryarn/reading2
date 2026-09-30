/**
 * **Which articles a cited work may be matched to** — the `where` in
 * src/store/pg-cited-in-spideryarn.ts, against a real database.
 *
 * The one rule (docs/plans/260930b-citations-say-when-a-cited-work-is-already-in-spideryarn.md):
 * the reader's own articles and public ones, and **never another reader's
 * private article, not even its existence**. Every fixture carries the same
 * arXiv address, so if any excluded one leaked into the candidates, a work
 * citing that paper would be matched to it. The assertions that matter are the
 * absences.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { matchCited } from "../src/cited-in-spideryarn.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, blockIdentities, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { type OwnerId, runInRequest, setRequestOwner } from "../src/owner.js";
import { citedCandidates, citedCandidatesQuery } from "../src/store/pg-cited-in-spideryarn.js";
import type { BlockId, CitedWork } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

await pgReady({
  suite: "tests/cited-in-spideryarn-pg.test.ts",
  tables: ["spideryarn.articles", "spideryarn.revision_blocks"],
});

const READER = "00000000-0000-4000-8000-00000c17e0a1" as OwnerId;
const OTHER = "00000000-0000-4000-8000-00000c17e0b2" as OwnerId;
const PAPER = "https://arxiv.org/abs/2001.08361";
const SIGNED = "https://arxiv.org/pdf/2001.08361v1?sig=SECRETSIGNATURE";
const BLOCK = "spya-c7ebq2" as BlockId;

interface Fixture {
  n: number;
  owner: OwnerId;
  slug: string;
  visibility: "private" | "public";
  readable: boolean;
  archived: boolean;
  title: string;
  titleOverride?: string;
  finalUrl?: string;
}

const FIXTURES: Fixture[] = [
  /* The reader's own: private, renamed. A candidate, shown under their rename. */
  { n: 1, owner: READER, slug: "cited-pg-mine-private", visibility: "private", readable: true, archived: false, title: "Own extracted", titleOverride: "Own rename" },
  /* The reader's own, archived: off the shelf, so not a candidate. */
  { n: 2, owner: READER, slug: "cited-pg-mine-archived", visibility: "private", readable: true, archived: true, title: "Own archived" },
  /* The reader's own, half-made: the owner's reader 404s it, so not a candidate. */
  { n: 3, owner: READER, slug: "cited-pg-mine-unreadable", visibility: "private", readable: false, archived: false, title: "Own unreadable" },
  /* Somebody else's private article: must never appear. */
  { n: 4, owner: OTHER, slug: "cited-pg-other-private", visibility: "private", readable: true, archived: false, title: "Other private" },
  /* Somebody else's public, readable article: a candidate, under its extracted title only. */
  { n: 5, owner: OTHER, slug: "cited-pg-other-public", visibility: "public", readable: true, archived: false, title: "Other public extracted", titleOverride: "Other secret rename" },
  /* Public but unreadable — its link would 404 — so not a candidate. */
  { n: 6, owner: OTHER, slug: "cited-pg-other-public-unreadable", visibility: "public", readable: false, archived: false, title: "Other unreadable" },
  /* Public but archived by its owner, off the public shelf, so not a candidate. */
  { n: 7, owner: OTHER, slug: "cited-pg-other-public-archived", visibility: "public", readable: true, archived: true, title: "Other archived" },
  /* Public, readable, but fetched through a signed address: a candidate that must not be matchable by it. */
  { n: 8, owner: OTHER, slug: "cited-pg-other-public-signed", visibility: "public", readable: true, archived: false, title: "Other signed", finalUrl: SIGNED },
];

const hex = (n: number) => n.toString(16).padStart(2, "0");
const articleId = (n: number) => `00000000-0000-4000-8000-00000c17e1${hex(n)}`;
const revisionId = (n: number) => `00000000-0000-4000-8000-00000c17e2${hex(n)}`;

async function cleanUp(): Promise<void> {
  const db = getDb();
  const ids = FIXTURES.map((f) => articleId(f.n));
  await db.update(articles).set({ currentRevisionId: null }).where(inArray(articles.id, ids));
  await db.delete(articleRevisions).where(inArray(articleRevisions.articleId, ids));
  await db.delete(articles).where(inArray(articles.id, ids));
}

function asReader<T>(owner: OwnerId, fn: () => Promise<T>): Promise<T> {
  return runInRequest(async () => {
    setRequestOwner(owner);
    return fn();
  });
}

const ours = (slug: string) => slug.startsWith("cited-pg-");

const CITING: CitedWork = {
  id: "spya-c7ewq3",
  key: "arxiv:2001.08361",
  title: "Scaling Laws for Neural Language Models",
  why: "x",
  mentions: [],
  citedAt: [BLOCK],
  firstCited: BLOCK,
  citedInBody: true,
  url: PAPER,
  linkFrom: "arxiv",
};

describe("the articles a cited work may be matched to", { timeout: 20_000 }, () => {
  beforeAll(async () => {
    const db = getDb();
    await seedAuthUser(db, { id: READER, email: "reader-cited-in-spideryarn@example.invalid", onConflictDoNothing: true });
    await seedAuthUser(db, { id: OTHER, email: "other-cited-in-spideryarn@example.invalid", onConflictDoNothing: true });
    await cleanUp();
    for (const f of FIXTURES) {
      await db.insert(articles).values({
        id: articleId(f.n),
        ownerId: f.owner,
        slug: f.slug,
        visibility: f.visibility,
        ...(f.visibility === "public" ? { publicAt: new Date("2026-09-01T00:00:00Z") } : {}),
        ...(f.archived ? { archivedAt: new Date("2026-09-02T00:00:00Z") } : {}),
        ...(f.titleOverride ? { titleOverride: f.titleOverride } : {}),
      });
      await db.insert(articleRevisions).values({
        id: revisionId(f.n),
        articleId: articleId(f.n),
        status: "published",
        title: f.title,
        requestedUrl: f.finalUrl ?? PAPER,
        finalUrl: f.finalUrl ?? "https://arxiv.org/pdf/2001.08361v1",
        ...(f.readable
          ? {
              tree: {
                version: "1",
                generator: "test",
                slug: f.slug,
                rootId: "n0",
                nodes: {
                  n0: { id: "n0", depth: 0, parent: null, children: [], range: [BLOCK, BLOCK], title: "Root", gist: "x" },
                },
              },
            }
          : {}),
      });
      await db.update(articles).set({ currentRevisionId: revisionId(f.n) }).where(eq(articles.id, articleId(f.n)));
      if (f.readable) {
        await db.insert(blockIdentities).values({ articleId: articleId(f.n), blockId: BLOCK });
        await db.insert(revisionBlocks).values({
          articleId: articleId(f.n),
          revisionId: revisionId(f.n),
          blockId: BLOCK,
          ordinal: 0,
          tag: "p",
          kind: "text",
          text: "A paragraph.",
          words: 2,
          html: "<p>A paragraph.</p>",
          gistable: true,
        });
      }
    }
  });

  afterAll(async () => {
    await cleanUp();
    await closeDb();
  });

  it("are the reader's own and the public ones, readable and on a shelf, and nothing else", async () => {
    const candidates = (await asReader(READER, () => citedCandidates("x"))).filter((c) => ours(c.slug));
    expect(candidates.map((c) => c.slug).sort()).toEqual([
      "cited-pg-mine-private",
      "cited-pg-other-public",
      "cited-pg-other-public-signed",
    ]);
  });

  it("never carries a stranger's rename or requested address, and does carry the reader's own", async () => {
    const candidates = await asReader(READER, () => citedCandidates("x"));
    const bySlug = new Map(candidates.map((c) => [c.slug, c]));
    expect(bySlug.get("cited-pg-mine-private")).toMatchObject({
      mine: true,
      matchTitle: "Own extracted",
      displayTitle: "Own rename",
      urls: [PAPER, "https://arxiv.org/pdf/2001.08361v1"],
    });
    expect(bySlug.get("cited-pg-other-public")).toMatchObject({
      mine: false,
      matchTitle: "Other public extracted",
      displayTitle: "Other public extracted",
      urls: ["https://arxiv.org/pdf/2001.08361v1"],
    });
    expect(JSON.stringify(candidates)).not.toContain("Other secret rename");
  });

  it("drops a stranger's address the public page would not publish", async () => {
    const candidates = await asReader(READER, () => citedCandidates("x"));
    const signed = candidates.find((c) => c.slug === "cited-pg-other-public-signed");
    expect(signed?.urls).toEqual([]);
    expect(JSON.stringify(candidates)).not.toContain("SECRETSIGNATURE");
  });

  it("leaves out the article being read", async () => {
    const candidates = await asReader(READER, () => citedCandidates("cited-pg-mine-private"));
    expect(candidates.map((c) => c.slug)).not.toContain("cited-pg-mine-private");
  });

  it("so a work citing the paper matches the reader's own copy first, and never a private one", async () => {
    const mine = (await asReader(READER, () => citedCandidates("x"))).filter((c) => ours(c.slug));
    expect(matchCited([CITING], mine).get(CITING.id)).toEqual({
      slug: "cited-pg-mine-private",
      whose: "yours",
      matchedBy: "arxiv",
      title: "Own rename",
    });

    /* Without the reader's own copy, the public one — never the private one. */
    const withoutMine = mine.filter((c) => !c.mine);
    expect(matchCited([CITING], withoutMine).get(CITING.id)).toMatchObject({
      slug: "cited-pg-other-public",
      whose: "public",
      title: "Other public extracted",
    });

    /* The other reader, asking the same question, gets their own private copy
       (theirs to see) and the public ones, and never the first reader's. */
    const theirs = (await asReader(OTHER, () => citedCandidates("x"))).filter((c) => ours(c.slug));
    expect(theirs.map((c) => c.slug).sort()).toEqual([
      "cited-pg-other-private",
      "cited-pg-other-public",
      "cited-pg-other-public-signed",
    ]);
    expect(theirs.find((c) => c.slug === "cited-pg-other-public")?.displayTitle).toBe("Other secret rename");
  });

  it("asks whose in the where, as one grouped clause, beside the shelf and readability bars", () => {
    const { sql, params } = citedCandidatesQuery(getDb(), READER).toSQL();
    const where = sql.slice(sql.indexOf(" where "));
    expect(where).toMatch(
      /\("spideryarn"\."articles"\."owner_id" = \$\d+ or "spideryarn"\."articles"\."visibility" = \$\d+\)/,
    );
    expect(where).toContain('"spideryarn"."articles"."archived_at" is null');
    expect(where).toContain('"spideryarn"."article_revisions"."tree" is not null');
    expect(where).toContain("exists (");
    expect(params).toContain(READER);
    expect(params).toContain("public");
    /* The owner is compared, never selected. */
    const projection = sql.slice(0, sql.indexOf(" from "));
    expect(projection).not.toMatch(/"owner_id"(?! =)/);
  });
});
