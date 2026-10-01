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
import { articleRevisions, articles, blockIdentities, revisionBlocks, uploadSourceGuesses } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { type OwnerId, runInRequest, setRequestOwner } from "../src/owner.js";
import { citedCandidatesQuery, pgCitedInSpideryarnStore } from "../src/store/pg-cited-in-spideryarn.js";
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
  /** An upload: no address at all, and this `upload_source_guesses` row (plan 261001i). */
  upload?: { status: "found"; kind: "canonical" | "matching"; url: string };
}

/** The DOI our guess found for an upload — never any fixture's own address. */
const GUESSED = "https://doi.org/10.1038/nature14539";
const MATCHING = "https://example.org/a-page-that-looks-like-it";

const FIXTURES: Fixture[] = [
  /* The reader's own: private, renamed. A candidate, shown under their rename. */
  { n: 1, owner: READER, slug: "cited-pg-mine-private", visibility: "private", readable: true, archived: false, title: "Own extracted", titleOverride: "Own rename" },
  /* The reader's own, archived: off the shelf but still theirs to open by link, so a
     candidate that says it is archived (plan 261001i). */
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
  /* The reader's own upload, with a canonical guess: matchable by the DOI we found. */
  { n: 9, owner: READER, slug: "cited-pg-mine-upload", visibility: "private", readable: true, archived: false, title: "Own upload", upload: { status: "found", kind: "canonical", url: GUESSED } },
  /* The reader's own upload whose guess is only a page that looks like it: not an identifier. */
  { n: 10, owner: READER, slug: "cited-pg-mine-upload-matching", visibility: "private", readable: true, archived: false, title: "Own upload matching", upload: { status: "found", kind: "matching", url: MATCHING } },
  /* A stranger's public upload with a canonical guess: the guess is owner-only, so never matched by. */
  { n: 11, owner: OTHER, slug: "cited-pg-other-public-upload", visibility: "public", readable: true, archived: false, title: "Other upload", upload: { status: "found", kind: "canonical", url: GUESSED } },
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

/** An upload has no address at all; anything else was fetched from one. */
function addressesOf(f: Fixture): { requestedUrl: string | null; finalUrl: string | null } {
  if (f.upload) return { requestedUrl: null, finalUrl: null };
  return { requestedUrl: f.finalUrl ?? PAPER, finalUrl: f.finalUrl ?? "https://arxiv.org/pdf/2001.08361v1" };
}

/** A settled `upload_source_guesses` row, as src/store/pg-source-guesses.ts writes one. */
async function insertGuess(n: number, upload: NonNullable<Fixture["upload"]>): Promise<void> {
  await getDb()
    .insert(uploadSourceGuesses)
    .values({
      articleId: articleId(n),
      status: upload.status,
      url: upload.url,
      host: new URL(upload.url).hostname,
      kind: upload.kind,
      matchedBy: upload.kind === "canonical" ? "doi" : "content",
      attempts: 1,
      finishedAt: new Date("2026-09-03T00:00:00Z"),
    });
}

function asReader<T>(owner: OwnerId, fn: () => Promise<T>): Promise<T> {
  return runInRequest(async () => {
    setRequestOwner(owner);
    return fn();
  });
}

const ours = (slug: string) => slug.startsWith("cited-pg-");
const citedCandidates = pgCitedInSpideryarnStore.citedCandidates.bind(pgCitedInSpideryarnStore);

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
        ...addressesOf(f),
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
      if (f.upload) await insertGuess(f.n, f.upload);
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

  it("are the reader's own, archived or not, and the public ones on the shelf, readable, and nothing else", async () => {
    const candidates = (await asReader(READER, () => citedCandidates("x"))).filter((c) => ours(c.slug));
    expect(candidates.map((c) => c.slug).sort()).toEqual([
      "cited-pg-mine-archived",
      "cited-pg-mine-private",
      "cited-pg-mine-upload",
      "cited-pg-mine-upload-matching",
      "cited-pg-other-public",
      "cited-pg-other-public-signed",
      "cited-pg-other-public-upload",
    ]);
    const archived = candidates.filter((c) => c.archived).map((c) => c.slug);
    expect(archived).toEqual(["cited-pg-mine-archived"]);
  });

  it("carries an upload's canonical guess for the reader's own article only (plan 261001i)", async () => {
    const candidates = await asReader(READER, () => citedCandidates("x"));
    const bySlug = new Map(candidates.map((c) => [c.slug, c]));
    expect(bySlug.get("cited-pg-mine-upload")).toMatchObject({ guessedUrl: GUESSED, urls: [] });
    /* A page that merely looks like the PDF is not an identifier. */
    expect(bySlug.get("cited-pg-mine-upload-matching")?.guessedUrl).toBeNull();
    /* A stranger's guess is owner-only data their public page does not publish. */
    expect(bySlug.get("cited-pg-other-public-upload")?.guessedUrl).toBeNull();
    expect(bySlug.get("cited-pg-mine-private")?.guessedUrl).toBeNull();
    const strangers = candidates.filter((c) => !c.mine);
    expect(JSON.stringify(strangers)).not.toContain("nature14539");

    const doiWork: CitedWork = { ...CITING, id: "spya-c7exq4", key: "doi:10.1038/nature14539", url: GUESSED, linkFrom: "doi", title: "Deep learning" };
    expect(matchCited([doiWork], candidates.filter((c) => ours(c.slug))).get(doiWork.id)).toEqual({
      slug: "cited-pg-mine-upload",
      whose: "yours",
      matchedBy: "guessed-id",
      title: "Own upload",
    });
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
      "cited-pg-other-public-archived",
      "cited-pg-other-public-signed",
      "cited-pg-other-public-upload",
    ]);
    /* Their own guess is theirs to be matched by. */
    expect(theirs.find((c) => c.slug === "cited-pg-other-public-upload")?.guessedUrl).toBe(GUESSED);
    expect(theirs.find((c) => c.slug === "cited-pg-other-public")?.displayTitle).toBe("Other secret rename");
  });

  it("asks whose in the where, as one grouped clause, beside the shelf and readability bars", () => {
    const { sql, params } = citedCandidatesQuery(getDb(), READER).toSQL();
    const where = sql.slice(sql.indexOf(" where "));
    /* Theirs, archived or not; or public and on the public shelf (plan 261001i). */
    expect(where).toMatch(
      /\("spideryarn"\."articles"\."owner_id" = \$\d+ or \("spideryarn"\."articles"\."visibility" = \$\d+ and "spideryarn"\."articles"\."archived_at" is null\)\)/,
    );
    expect(where).toContain('"spideryarn"."article_revisions"."tree" is not null');
    expect(where).toContain("exists (");
    expect(params).toContain(READER);
    expect(params).toContain("public");
    /* The owner is compared, never selected. */
    const projection = sql.slice(0, sql.indexOf(" from "));
    expect(projection).not.toMatch(/"owner_id"(?! =)/);
  });
});
