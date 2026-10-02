/**
 * **Is a stored thread stale, asked of Postgres the way the band asks it.**
 *
 * `tweets/5` (2026-09-29) sends the article with its block ids, so each post
 * can link back to the passages it came from — and `articleWithIds` prints a
 * `URL:` line that `articleText` never did. So the thread's fingerprint moved
 * from `articleFingerprint` to `articleWithIdsFingerprint`, the Postgres read
 * had to start selecting the final URL (`CITED_FINGERPRINT_COLUMNS`) and hand
 * it over (`citedMetaFingerprintOf`), and every thread written before the
 * change still has to be judged the way it was written (src/tweets.ts §
 * `fingerprintFor`). docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md.
 *
 * The pure half is tests/tweets.test.ts. This is the half only a database can
 * show: that `loadTweets` really selects the URL and really passes it on. A
 * projection that left `finalUrl` out would compute a fingerprint with an
 * empty URL in it — current here, where the fixture has one, only by accident,
 * and stale for ever on every real article. So the three cases are:
 *
 *  1. a `tweets/5` thread stamped over the revision's blocks, tree and cited
 *     head reads `stale: false` — the positive control, without which case 2
 *     would pass on a read that called everything stale;
 *  2. changing **only** the article's final URL makes it `stale: true` — the
 *     case that goes red if the URL is not read or not passed;
 *  3. a `tweets/4` thread stamped with `articleFingerprint` reads
 *     `stale: false` — the old threads are not all suddenly out of date.
 *
 * The article is built through `beginRevision` and `publishRevision`, the way
 * tests/store-carry-forward.test.ts builds its own, because `loadTweets` reads
 * the *published* revision and a hand-inserted row would skip the guard that
 * decides what publishing means.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  revisionBlocks,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintUniqueId } from "../src/ids.js";
import { articleFingerprint, articleWithIdsFingerprint, hashBlocks } from "../src/source-hash.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/artifacts.js";
import { pgArticleReader } from "../src/store/pg.js";
import { beginRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import type { Block, StepName, Tree, TweetThread } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { PROMPT_VERSION as TWEETS_PROMPT_VERSION } from "../src/tweets.js";
import { CAPABLE_MODEL, HIGH_POWER_MODEL } from "../src/models.js";

loadEnvLocal();

const SLUG = "test-tweets-stale";

await pgReady({
  suite: "tests/store-tweets-stale.test.ts",
  tables: ["spideryarn.article_revisions"],
});

/* ------------------------------------------------------------ the article -- */

const MINTED = new Set<string>();

function block(text: string): Block {
  const id = mintUniqueId(MINTED);
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    html: `<p id="${id}">${text}</p>`,
    gistable: true,
  };
}

const BLOCKS: Block[] = [
  block("The opening paragraph of a fixture article about staleness."),
  block("The closing paragraph, which says nothing a thread would miss."),
];

/** The smallest tree `checkTree` accepts: one root over one leaf per block. */
const TREE: Tree = {
  version: "toc/1",
  generator: "fixture",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: {
      id: "n0",
      depth: 0,
      parent: null,
      children: BLOCKS.map((_, i) => `n${i + 1}`),
      range: [BLOCKS[0]?.id ?? "", BLOCKS[BLOCKS.length - 1]?.id ?? ""],
      title: "A fixture article",
      gist: "A fixture built by tests/store-tweets-stale.test.ts and nothing else.",
    },
    ...Object.fromEntries(
      BLOCKS.map((b, i) => [
        `n${i + 1}`,
        {
          id: `n${i + 1}`,
          depth: 1,
          parent: "n0",
          children: [],
          range: [b.id, b.id],
          title: "A paragraph",
          navLabel: "One paragraph of a fixture article that exists only for this test",
        },
      ]),
    ),
  },
} as Tree;

const TITLE = "A fixture article";
const URL1 = "https://example.com/tweets-stale";
const URL2 = "https://example.com/tweets-stale-after-a-redirect";

/**
 * The cited head, spelled the way `citedMetaFingerprintOf` rebuilds it from the
 * revision's columns — title, byline and site name null here, so only the title
 * and the URL are set.
 */
const CITED_META = { title: TITLE, url: URL1 };

const threadFor = (version: string, sourceHash: string): TweetThread => ({
  version,
  generator: "fixture",
  slug: SLUG,
  sourceHash,
  limit: 280,
  tweets: [{ text: "A fixture thread of exactly one post.", chars: 36, blocks: [BLOCKS[0]?.id ?? ""] }],
  generatedAt: "2026-09-29T00:00:00.000Z",
  elapsedMs: 1,
});

let articleId = "";
let revisionId = "";

async function setRevision(values: Partial<typeof articleRevisions.$inferInsert>): Promise<void> {
  await getDb().update(articleRevisions).set(values).where(eq(articleRevisions.id, revisionId));
}

const step = (name: StepName, inputHash = NO_INPUT_HASH) =>
  recordStepRun({
    revisionId,
    stepName: name,
    inputHash,
    implementationVersion: PIPELINE_RUN,
    promptVersion: null,
    model: null,
    status: "done",
    startedAt: new Date(Date.now() - 1_000),
    finishedAt: new Date(),
  });

beforeAll(async () => {
  const begun = await beginRevision({ slug: SLUG });
  articleId = begun.articleId;
  revisionId = begun.revisionId;

  const db = getDb();
  await db
    .insert(blockIdentities)
    .values(BLOCKS.map((b) => ({ articleId, blockId: b.id })))
    .onConflictDoNothing();
  await db.insert(revisionBlocks).values(
    BLOCKS.map((b, i) => ({
      articleId,
      revisionId,
      blockId: b.id,
      ordinal: i,
      tag: b.tag,
      kind: b.kind,
      level: null,
      text: b.text,
      words: b.words,
      html: b.html,
      gistable: b.gistable,
      note: null,
    })),
  );
  await setRevision({
    title: TITLE,
    finalUrl: URL1,
    fetchedAt: new Date("2026-09-29T00:00:00.000Z"),
    extractedHtml: "<p>A fixture article.</p>",
    stampedHtml: BLOCKS.map((b) => b.html).join("\n"),
    tree: TREE,
    tweets: threadFor("tweets/5", articleWithIdsFingerprint(BLOCKS, TREE, CITED_META)),
  });
  for (const name of ["fetch", "extract", "blocks"] as StepName[]) await step(name);
  await step("structure", hashBlocks(BLOCKS));
  await publishRevision({ slug: SLUG, revisionId });
}, 60_000);

afterAll(async () => {
  const db = getDb();
  const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, SLUG));
  const id = rows[0]?.id;
  if (id) {
    // The pointer lets go first, or the revision cannot cascade away —
    // tests/store-carry-forward.test.ts § afterAll.
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
    await db.delete(articles).where(eq(articles.id, id));
  }
  await closeDb();
});

describe("loadTweets on a tweets/5 thread", () => {
  it("reads current when stamped over the blocks, the tree and the cited head", async () => {
    const found = await pgArticleReader.loadTweets(SLUG);
    // The fixture is the thread it was given, or the case below proves nothing.
    expect(found.thread.version).toBe("tweets/5");
    expect(found.stale).toBe(false);
  }, 30_000);

  it("reads stale when only the article's final URL has changed", async () => {
    /* Nothing else moves: same blocks, same tree, same title. The URL is on the
       `URL:` line `articleWithIds` prints, so the prompt the thread was written
       from is not the prompt this article would send now. */
    await setRevision({ finalUrl: URL2 });
    try {
      expect((await pgArticleReader.loadTweets(SLUG)).stale).toBe(true);
    } finally {
      await setRevision({ finalUrl: URL1 });
    }
    // And back, so the flip above was the URL and not the write.
    expect((await pgArticleReader.loadTweets(SLUG)).stale).toBe(false);
  }, 30_000);
});

describe("loadTweets on a thread written before tweets/5", () => {
  it("reads current when stamped with articleFingerprint, the way it was written", async () => {
    /* `articleText`'s head: title, byline, site name — no URL. Asked the newer
       question, every thread stored before 2026-09-29 would read stale. */
    await setRevision({
      tweets: threadFor("tweets/4", articleFingerprint(BLOCKS, TREE, { title: TITLE })),
    });
    const found = await pgArticleReader.loadTweets(SLUG);
    expect(found.thread.version).toBe("tweets/4");
    expect(found.stale).toBe(false);
    /* The old question does not look at the URL, so a redirect alone does not
       make an old thread stale — which is what separates it from the case above. */
    await setRevision({ finalUrl: URL2 });
    try {
      expect((await pgArticleReader.loadTweets(SLUG)).stale).toBe(false);
    } finally {
      await setRevision({ finalUrl: URL1 });
    }
  }, 30_000);
});

/**
 * **Metadata's Tweets row asks about the prompt and the model too** — plan
 * 261001p, GPT Sol's plan review P1-5. Until then `isCurrent`'s `case "tweets"`
 * compared only the article, so a thread written by an older prompt was
 * "current" for ever and the page never offered the rewrite. The positive
 * control is the same thread at today's version and model.
 *
 * **Mutation.** 2026-10-01: `return true || sameStamp(…)` in that arm of
 * src/store/pg.ts turned this block red (the older-prompt case read current),
 * and taking it out turned it green again.
 *
 * **Blind to.** A model from an older generation: every case writes a current
 * Sonnet or Opus, so a `sameStamp` that stopped comparing the model at all
 * would still pass here.
 */
describe("articleMetadata's Tweets row", () => {
  const tweetsDone = async (): Promise<boolean | undefined> =>
    (await pgArticleReader.articleMetadata(SLUG)).stages.find((s) => s.step === "tweets")?.done;

  it("is current at today's prompt in either power tier, and not at an older prompt", async () => {
    const hash = articleWithIdsFingerprint(BLOCKS, TREE, CITED_META);
    await step("tweets", hash);
    await setRevision({ tweets: { ...threadFor(TWEETS_PROMPT_VERSION, hash), generator: CAPABLE_MODEL } });
    expect(await tweetsDone()).toBe(true);
    /* `sameStamp` compares model generations: switching High-powered AI must
       not make an Opus-written thread look stale against the standard-tier
       expectation used by Metadata. */
    await setRevision({ tweets: { ...threadFor(TWEETS_PROMPT_VERSION, hash), generator: HIGH_POWER_MODEL } });
    expect(await tweetsDone()).toBe(true);
    await setRevision({ tweets: { ...threadFor("tweets/5", hash), generator: CAPABLE_MODEL } });
    expect(await tweetsDone()).toBe(false);
  }, 30_000);
});
