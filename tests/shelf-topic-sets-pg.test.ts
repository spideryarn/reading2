/**
 * **The model's topic set, through Postgres** — the `shelf_topic_sets` row and
 * `topicShelf` in src/store/pg-shelf-terms.ts, driven through the wired store
 * object. docs/plans/261003f-shelf-topics-named-by-a-model-as-concepts-not-phrases.md.
 *
 * 1. **No row** reads as `null`; **a claim creates it**, and a second claim
 *    while the first is live is refused.
 * 2. **A write is fenced by the claim id**: a stale id writes nothing, the
 *    right one stores the whole result and clears the claim — and an expired
 *    lease that somebody else re-claimed fences the first claimant out.
 * 3. **A filing merges** over the stored members, is fenced the same way, and
 *    **refuses when there is no stored result**.
 * 4. **A failure backs off** on the scores' schedule and a claim inside the
 *    backoff is refused; a success resets it.
 * 5. **A release** gives the claim back without counting a failure.
 * 6. **Another owner** can neither read, block, write, file into, fail nor
 *    release this owner's row.
 * 7. **`topicShelf`**: active and archived, newest first, the title / gist /
 *    text-hash fallbacks, and nothing from outside the shelf boundary.
 *
 * Two owners of this file's own. No model is called.
 */
import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, revisionPhraseRuns, shelfTopicSets } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { runAsOwner, type OwnerId } from "../src/owner.js";
import { EXTRACTOR_VERSION } from "../src/shelf-terms/extract.js";
import type { TopicSetResult } from "../src/store/contracts.js";
import {
  pgShelfTermsStore as store,
  SCORE_BACKOFF_FIRST_SECONDS,
} from "../src/store/pg-shelf-terms.js";
import type { Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

await pgReady({
  suite: "tests/shelf-topic-sets-pg.test.ts",
  tables: ["spideryarn.shelf_topic_sets", "spideryarn.revision_phrase_runs"],
});

const OWNER_A = "00000000-0000-4000-8000-0000000075a1" as OwnerId;
const OWNER_B = "00000000-0000-4000-8000-0000000075b2" as OwnerId;
const BOTH = [OWNER_A, OWNER_B];
const PREFIX = "test-shelf-topic-sets-pg-";
const LEASE_MS = 10 * 60_000;

const db = () => getDb();
const asA = <T>(fn: () => Promise<T>) => runAsOwner(OWNER_A, fn);
const asB = <T>(fn: () => Promise<T>) => runAsOwner(OWNER_B, fn);

const RESULT: TopicSetResult = {
  model: "openai/gpt-test",
  promptVersion: 3,
  profileHash: "a".repeat(64),
  topics: [
    { id: "t1", key: "memory", label: "Memory", parent: null, depth: 0 },
    { id: "t2", key: "memory/sleep", label: "Sleep and memory", parent: "t1", depth: 1 },
  ],
  members: { "article-one": ["t1"], "article-two": ["t1", "t2"], "article-three": [] },
  works: 3,
  unplaced: 1,
};

/** The row as the database has it, whoever is asking. */
async function rawRow(owner: OwnerId) {
  const [r] = await db().select().from(shelfTopicSets).where(eq(shelfTopicSets.ownerId, owner));
  return r;
}

/** Seconds from now until `at`, by this process's clock — the assertions leave half a minute of slack. */
function secondsUntil(at: Date | null | undefined): number {
  if (!at) throw new Error("no timestamp");
  return (at.getTime() - Date.now()) / 1000;
}

async function mustClaim(as: typeof asA = asA): Promise<string> {
  const id = await as(() => store.claimTopicSet(LEASE_MS));
  if (!id) throw new Error("the claim was refused");
  return id;
}

/** As if the backoff had passed. */
async function passBackoff(owner: OwnerId): Promise<void> {
  await db()
    .update(shelfTopicSets)
    .set({ retryAfter: new Date(Date.now() - 60_000) })
    .where(eq(shelfTopicSets.ownerId, owner));
}

beforeAll(async () => {
  await seedAuthUser(db(), { id: OWNER_A, email: "a-shelf-topic-sets-pg@example.invalid", onConflictDoNothing: true });
  await seedAuthUser(db(), { id: OWNER_B, email: "b-shelf-topic-sets-pg@example.invalid", onConflictDoNothing: true });
});

afterAll(async () => {
  await db().delete(shelfTopicSets).where(inArray(shelfTopicSets.ownerId, BOTH));
  await db().delete(articles).where(inArray(articles.ownerId, BOTH));
  await closeDb();
});

describe("the shelf_topic_sets row", () => {
  beforeEach(async () => {
    await db().delete(shelfTopicSets).where(inArray(shelfTopicSets.ownerId, BOTH));
  });

  it("reads null when there is no row, and a claim creates it", async () => {
    expect(await asA(() => store.readTopicSet())).toBeNull();

    const claimId = await mustClaim();
    const got = await asA(() => store.readTopicSet());
    expect(got).not.toBeNull();
    expect(got?.result).toBeNull();
    expect(got?.failures).toBe(0);
    expect(got?.retryAfter).toBeNull();
    const until = secondsUntil(got?.claim?.until);
    expect(until).toBeGreaterThan(LEASE_MS / 1000 - 30);
    expect(until).toBeLessThan(LEASE_MS / 1000 + 30);

    const raw = await rawRow(OWNER_A);
    expect(raw?.claimId).toBe(claimId);
    expect(raw?.createdAt).toBeInstanceOf(Date);
  });

  it("refuses a second claim while the first is live", async () => {
    const first = await mustClaim();
    expect(await asA(() => store.claimTopicSet(LEASE_MS))).toBeNull();
    /* The refusal changed nothing: the first claimant still holds it. */
    expect((await rawRow(OWNER_A))?.claimId).toBe(first);
    expect(await asA(() => store.writeTopicSet(first, RESULT))).toBe(true);
  });

  it("fences a write on the claim id", async () => {
    const claimId = await mustClaim();

    expect(await asA(() => store.writeTopicSet(randomUUID(), RESULT))).toBe(false);
    const untouched = await asA(() => store.readTopicSet());
    expect(untouched?.result).toBeNull();
    expect(untouched?.claim).not.toBeNull();

    expect(await asA(() => store.writeTopicSet(claimId, RESULT))).toBe(true);
    const got = await asA(() => store.readTopicSet());
    expect(got?.claim).toBeNull();
    expect(got?.failures).toBe(0);
    expect(got?.retryAfter).toBeNull();
    expect(got?.result).toMatchObject({ ...RESULT, filedAt: null });
    expect(got?.result?.profileHash).toBe(RESULT.profileHash);
    expect((await rawRow(OWNER_A))?.profileHash).toBe(RESULT.profileHash);
    expect(Math.abs(secondsUntil(got?.result?.rethoughtAt))).toBeLessThan(30);

    /* The claim was spent by the write: the same id does not land twice. */
    const again: TopicSetResult = { ...RESULT, model: "second-write", topics: [], members: {} };
    expect(await asA(() => store.writeTopicSet(claimId, again))).toBe(false);
    expect((await asA(() => store.readTopicSet()))?.result?.model).toBe(RESULT.model);
  });

  it("refuses to store an empty topic tree and leaves its claim to the caller", async () => {
    const claimId = await mustClaim();
    await expect(asA(() => store.writeTopicSet(claimId, { ...RESULT, topics: [] }))).rejects.toThrow();
    expect((await rawRow(OWNER_A))?.claimId).toBe(claimId);
    await asA(() => store.releaseTopicSet(claimId, 0));
  });

  it("fences out a claimant whose lease expired and was re-claimed", async () => {
    const dead = await asA(() => store.claimTopicSet(1));
    expect(dead).not.toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    const live = await mustClaim();
    expect(live).not.toBe(dead);

    expect(await asA(() => store.writeTopicSet(dead ?? "", { ...RESULT, model: "from-the-dead" }))).toBe(false);
    expect((await asA(() => store.readTopicSet()))?.result).toBeNull();
    expect(await asA(() => store.writeTopicSet(live, RESULT))).toBe(true);
    expect((await asA(() => store.readTopicSet()))?.result?.model).toBe(RESULT.model);
  });

  it("files new memberships into the stored set, fenced, and merges them over the old", async () => {
    expect(await asA(async () => store.writeTopicSet(await mustClaim(), RESULT))).toBe(true);
    const claimId = await mustClaim();
    const filing = { "article-two": ["t2"], "article-four": ["t1"], "article-five": [] };

    expect(await asA(() => store.fileIntoTopicSet(randomUUID(), filing))).toBe(false);
    const untouched = await asA(() => store.readTopicSet());
    expect(untouched?.result?.members).toEqual(RESULT.members);
    expect(untouched?.result?.filedAt).toBeNull();
    expect(untouched?.claim).not.toBeNull();

    expect(await asA(() => store.fileIntoTopicSet(claimId, filing))).toBe(true);
    const got = await asA(() => store.readTopicSet());
    expect(got?.result?.members).toEqual({
      "article-one": ["t1"],
      /* Filed twice: the newer answer, whole. */
      "article-two": ["t2"],
      "article-three": [],
      "article-four": ["t1"],
      "article-five": [],
    });
    /* A filing changes the memberships and nothing else of the result. */
    expect(got?.result?.topics).toEqual(RESULT.topics);
    expect(got?.result?.works).toBe(RESULT.works);
    expect(Math.abs(secondsUntil(got?.result?.filedAt))).toBeLessThan(30);
    expect(got?.claim).toBeNull();

    /* A filing leaves the profile fingerprint alone. */
    expect(got?.result?.profileHash).toBe(RESULT.profileHash);

    /* A re-think after a filing starts the filing clock again — and stores
       the fingerprint it was given, `""` (no profile) included. */
    expect(await asA(async () => store.writeTopicSet(await mustClaim(), { ...RESULT, profileHash: "" }))).toBe(true);
    const rethought = await asA(() => store.readTopicSet());
    expect(rethought?.result?.profileHash).toBe("");
    expect((await rawRow(OWNER_A))?.profileHash).toBe("");
    expect(rethought?.result?.filedAt).toBeNull();
    expect(rethought?.result?.members).toEqual(RESULT.members);
  });

  it("clears a backoff when a filing lands", async () => {
    expect(await asA(async () => store.writeTopicSet(await mustClaim(), RESULT))).toBe(true);
    await asA(async () => store.failTopicSet(await mustClaim()));
    await passBackoff(OWNER_A);
    expect(await asA(async () => store.fileIntoTopicSet(await mustClaim(), { x: [] }))).toBe(true);
    const got = await asA(() => store.readTopicSet());
    expect(got?.failures).toBe(0);
    expect(got?.retryAfter).toBeNull();
  });

  it("refuses a filing when there is no stored result", async () => {
    const claimId = await mustClaim();
    expect(await asA(() => store.fileIntoTopicSet(claimId, { "article-one": ["t1"] }))).toBe(false);
    const raw = await rawRow(OWNER_A);
    expect(raw?.members).toBeNull();
    expect(raw?.filedAt).toBeNull();
    /* The claim is still the caller's to give back. */
    expect(raw?.claimId).toBe(claimId);
  });

  it("backs off after a failure, and refuses a claim inside the backoff", async () => {
    const first = await mustClaim();

    await asA(() => store.failTopicSet(randomUUID()));
    expect((await rawRow(OWNER_A))?.claimId).toBe(first);
    expect((await rawRow(OWNER_A))?.failures).toBe(0);

    await asA(() => store.failTopicSet(first));
    let got = await asA(() => store.readTopicSet());
    expect(got?.claim).toBeNull();
    expect(got?.failures).toBe(1);
    expect(secondsUntil(got?.retryAfter)).toBeGreaterThan(SCORE_BACKOFF_FIRST_SECONDS - 30);
    expect(secondsUntil(got?.retryAfter)).toBeLessThan(SCORE_BACKOFF_FIRST_SECONDS + 30);
    expect(await asA(() => store.claimTopicSet(LEASE_MS))).toBeNull();

    await passBackoff(OWNER_A);
    await asA(async () => store.failTopicSet(await mustClaim()));
    got = await asA(() => store.readTopicSet());
    expect(got?.failures).toBe(2);
    expect(secondsUntil(got?.retryAfter)).toBeGreaterThan(SCORE_BACKOFF_FIRST_SECONDS * 4 - 30);
    expect(secondsUntil(got?.retryAfter)).toBeLessThan(SCORE_BACKOFF_FIRST_SECONDS * 4 + 30);

    /* A success resets it. */
    await passBackoff(OWNER_A);
    expect(await asA(async () => store.writeTopicSet(await mustClaim(), RESULT))).toBe(true);
    got = await asA(() => store.readTopicSet());
    expect(got?.failures).toBe(0);
    expect(got?.retryAfter).toBeNull();
  });

  it("releases a claim without counting a failure", async () => {
    const claimId = await mustClaim();

    await asA(() => store.releaseTopicSet(randomUUID(), 60_000));
    expect((await rawRow(OWNER_A))?.claimId).toBe(claimId);
    expect((await rawRow(OWNER_A))?.retryAfter).toBeNull();

    await asA(() => store.releaseTopicSet(claimId, 60_000));
    const got = await asA(() => store.readTopicSet());
    expect(got?.claim).toBeNull();
    expect(got?.failures).toBe(0);
    expect(secondsUntil(got?.retryAfter)).toBeGreaterThan(30);
    expect(secondsUntil(got?.retryAfter)).toBeLessThan(90);
    expect(await asA(() => store.claimTopicSet(LEASE_MS))).toBeNull();
  });

  it("keeps one owner out of another's row", async () => {
    expect(await asA(async () => store.writeTopicSet(await mustClaim(), RESULT))).toBe(true);
    const aClaim = await mustClaim();
    const before = await rawRow(OWNER_A);

    /* B has no row: a read that forgot the owner could only find A's. */
    expect(await asB(() => store.readTopicSet())).toBeNull();

    /* A's claim id, in B's hands, moves nothing. */
    expect(await asB(() => store.writeTopicSet(aClaim, { ...RESULT, model: "b-wrote-this" }))).toBe(false);
    expect(await asB(() => store.fileIntoTopicSet(aClaim, { "b-article": ["t1"] }))).toBe(false);
    await asB(() => store.failTopicSet(aClaim));
    await asB(() => store.releaseTopicSet(aClaim, 60_000));
    expect(await rawRow(OWNER_A)).toEqual(before);
    expect(await rawRow(OWNER_B)).toBeUndefined();

    /* A's live claim does not block B, and B's claim lands on B's own row. */
    const bClaim = await mustClaim(asB);
    expect(await rawRow(OWNER_A)).toEqual(before);
    expect((await rawRow(OWNER_B))?.claimId).toBe(bClaim);
    expect((await asB(() => store.readTopicSet()))?.result).toBeNull();

    /* And the other way round: B's id does nothing to A's row. */
    expect(await asA(() => store.writeTopicSet(bClaim, { ...RESULT, model: "a-wrote-this" }))).toBe(false);
    expect((await rawRow(OWNER_B))?.model).toBeNull();
    expect(await asA(() => store.writeTopicSet(aClaim, RESULT))).toBe(true);
    expect((await rawRow(OWNER_B))?.claimId).toBe(bClaim);
  });
});

/* ---------------------------------------------------------- topicShelf -- */

interface Seed {
  owner: OwnerId;
  slug: string;
  day: number;
  title?: string | null;
  titleOverride?: string;
  rootGist?: string;
  abstract?: string;
  archived?: boolean;
  /** `false`: a current revision with no tree and no blocks — outside the shelf boundary. */
  readable?: boolean;
  /** `false`: no revision at all. */
  revision?: boolean;
  /** Stored phrase runs, as `[extractorVersion, textHash]`. */
  runs?: [number, string][];
}

async function seed(s: Seed): Promise<string> {
  const [a] = await db()
    .insert(articles)
    .values({
      ownerId: s.owner,
      slug: s.slug,
      titleOverride: s.titleOverride ?? null,
      archivedAt: s.archived ? new Date() : null,
    })
    .returning({ id: articles.id });
  if (!a) throw new Error("no article");
  if (s.revision === false) return a.id;
  const [rev] = await db()
    .insert(articleRevisions)
    .values({
      articleId: a.id,
      status: "published",
      title: s.title === undefined ? s.slug : s.title,
      fetchedAt: new Date(Date.UTC(2026, 0, 1 + s.day)),
      rootGist: s.rootGist ?? null,
      abstract: s.abstract ?? null,
      ...(s.readable === false
        ? {}
        : {
            tree: { rootId: "r", nodes: { r: { id: "r", depth: 0 } } } as unknown as Tree,
            wordCount: 10,
            blockCount: 1,
            partCount: 0,
            sectionCount: 0,
          }),
    })
    .returning({ id: articleRevisions.id });
  if (!rev) throw new Error("no revision");
  await db().update(articles).set({ currentRevisionId: rev.id }).where(eq(articles.id, a.id));
  for (const [extractorVersion, textHash] of s.runs ?? [])
    await db()
      .insert(revisionPhraseRuns)
      .values({ revisionId: rev.id, articleId: a.id, extractorVersion, words: 10, textHash, candidates: [] });
  return a.id;
}

describe("topicShelf", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await db().delete(articles).where(inArray(articles.ownerId, BOTH));
    /* Renamed, gisted, with a run at this extractor version (and a decoy at another). */
    ids.renamed = await seed({
      owner: OWNER_A,
      slug: `${PREFIX}renamed`,
      day: 5,
      title: "The revision's title",
      titleOverride: "The reader's rename",
      rootGist: "the root gist",
      abstract: "an abstract that loses to the gist",
      runs: [
        [EXTRACTOR_VERSION, "hash-current"],
        [EXTRACTOR_VERSION + 1, "hash-of-another-version"],
      ],
    });
    /* No rename, no gist: the revision's title and the abstract. A run at another version only. */
    ids.plain = await seed({
      owner: OWNER_A,
      slug: `${PREFIX}plain`,
      day: 4,
      title: "A plain title",
      abstract: "only an abstract",
      runs: [[EXTRACTOR_VERSION + 1, "hash-of-another-version"]],
    });
    /* Archived, with no title anywhere and no gist or abstract. */
    ids.archived = await seed({ owner: OWNER_A, slug: `${PREFIX}archived`, day: 3, title: null, archived: true });
    /* Three that are not on the shelf, each newer than everything above. */
    ids.hidden = await seed({ owner: OWNER_A, slug: `_${PREFIX}hidden`, day: 9 });
    ids.bare = await seed({ owner: OWNER_A, slug: `${PREFIX}no-revision`, day: 8, revision: false });
    ids.unreadable = await seed({ owner: OWNER_A, slug: `${PREFIX}unreadable`, day: 7, readable: false });
    /* And somebody else's. */
    ids.theirs = await seed({
      owner: OWNER_B,
      slug: `${PREFIX}theirs`,
      day: 6,
      runs: [[EXTRACTOR_VERSION, "hash-theirs"]],
    });
  });

  it("returns active and archived, newest first, with each fallback", async () => {
    expect(await asA(() => store.topicShelf())).toEqual([
      {
        articleId: ids.renamed,
        slug: `${PREFIX}renamed`,
        archived: false,
        title: "The reader's rename",
        gist: "the root gist",
        textHash: "hash-current",
      },
      {
        articleId: ids.plain,
        slug: `${PREFIX}plain`,
        archived: false,
        title: "A plain title",
        gist: "only an abstract",
        textHash: null,
      },
      {
        articleId: ids.archived,
        slug: `${PREFIX}archived`,
        archived: true,
        title: `${PREFIX}archived`,
        gist: null,
        textHash: null,
      },
    ]);
  });

  it("is the asking owner's shelf and nobody else's", async () => {
    expect(await asB(() => store.topicShelf())).toEqual([
      {
        articleId: ids.theirs,
        slug: `${PREFIX}theirs`,
        archived: false,
        title: `${PREFIX}theirs`,
        gist: null,
        textHash: "hash-theirs",
      },
    ]);
  });
});
