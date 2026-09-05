/**
 * **The summary cache: never stale, never paid for twice, never somebody
 * else's.**
 *
 * Every property here fails silently rather than loudly. A stale summary reads
 * perfectly well and is about a paragraph that no longer exists; a duplicate
 * generation costs money and looks identical to one; a cache that stopped being
 * per-reader shows one person's personalised answer to another and nothing
 * anywhere raises.
 *
 * 1. **The four fingerprints are compared, all of them.** `(owner, article,
 *    target)` alone never changes when the reader edits their profile or the
 *    article is re-extracted, and both are prompt inputs — so a personalised
 *    summary would be stale for ever. GPT Sol, 2026-09-05, P1-3.
 * 2. **Single-flight.** Two cold hovers of one link must not both call the
 *    model. A unique row prevents duplicate *storage* and never duplicate
 *    *spend*, so an upsert on its own would have both of them paying. P1-4.
 * 3. **A loser cannot destroy a winner.** `fill` and `release` are both fenced on
 *    the claim token, because a claimant that stalled past its lease and woke up
 *    would otherwise write its stale answer over its successor's — a summary
 *    about an older profile, presented as current.
 * 4. **It is another reader's article or it is nothing.** The store resolves the
 *    slug through `articleIdForOwned`, so a slug that is not this reader's is
 *    not found rather than answered.
 *
 * Skips loudly when there is no database; tests/helpers/pg-ready.ts.
 */

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, linkSummaries } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_ID, type OwnerId, runAsOwner } from "../src/owner.js";
import type { SummaryInputs } from "../src/store/contracts.js";
import { pgLinkSummaryStore } from "../src/store/pg-link-summaries.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

await pgReady({
  suite: "tests/link-summary-cache.test.ts",
  tables: ["spideryarn.link_summaries"],
});

/** One run's suffix, so two processes running this file cannot collide. */
const RUN = randomUUID().slice(0, 8);
const MINE = `test-link-summary-${RUN}`;
const THEIRS = `test-link-summary-theirs-${RUN}`;
const OTHER_OWNER = randomUUID() as OwnerId;

const LEASE_MS = 40_000;
const TARGET = "https://destination.example/paper";
const ONE_FORTNIGHT = () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

/** The inputs a fresh, unchanged question would produce. */
const INPUTS: SummaryInputs = {
  destHash: "dddddddddddddddd",
  contextHash: "cccccccccccccccc",
  profileHash: "pppppppppppppppp",
  promptVersion: 1,
  model: "openai/gpt-5.6-luna",
};

const key = { slug: MINE, target: TARGET };

beforeAll(async () => {
  const db = getDb();
  /* A per-file address: `users_email_partial_key` is unique and
     `onConflictDoNothing` is `on conflict (id)`, so two suites sharing one
     address fail on the email rather than being deduplicated. */
  await seedAuthUser(db, { id: OTHER_OWNER, email: `link-summary-${RUN}@example.invalid` });
  await db.insert(articles).values({ ownerId: DEV_OWNER_ID, slug: MINE });
  await db.insert(articles).values({ ownerId: OTHER_OWNER, slug: THEIRS });
});

/* One key is used by every case, so each has to start from an empty table — and
   emptying it wholesale is why this file is on the private lane. */
afterEach(async () => {
  await getDb().delete(linkSummaries);
});

afterAll(async () => {
  const db = getDb();
  await db.delete(articles).where(eq(articles.slug, MINE));
  await db.delete(articles).where(eq(articles.slug, THEIRS));
  await closeDb();
});

/** Take the claim and fill it, which is what one successful call does. */
async function store(inputs: SummaryInputs, summary: string): Promise<void> {
  const claim = await pgLinkSummaryStore.claim(key, inputs, LEASE_MS);
  if (claim.kind !== "claimed") throw new Error(`expected to win the claim, got ${claim.kind}`);
  await pgLinkSummaryStore.fill(key, claim.claimId, summary, ONE_FORTNIGHT());
}

describe("the link-summary cache", () => {
  it("hands back what it stored when nothing has moved", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      await store(INPUTS, "It is the paper the claim rests on.");
      expect(await pgLinkSummaryStore.read(key, INPUTS)).toBe(
        "It is the paper the claim rests on.",
      );
    });
  });

  it("forgets it when the reader edits their profile", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      await store(INPUTS, "Written for a physicist.");
      /* The summary is written from the reader's own description, so a changed
         profile is a changed question. Without this the reader edits their box
         and every link on the shelf goes on answering the old one — for a
         fortnight, invisibly. */
      const edited = { ...INPUTS, profileHash: "qqqqqqqqqqqqqqqq" };
      expect(await pgLinkSummaryStore.read(key, edited)).toBeNull();
      /* And the old one is still there for the old profile, which is what says
         the *comparison* is doing the work rather than a delete. */
      expect(await pgLinkSummaryStore.read(key, INPUTS)).toBe("Written for a physicist.");
    });
  });

  it("forgets it when the article is re-extracted", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      await store(INPUTS, "About the paragraph as it was.");
      /* `contextHash` is a hash of the title, the gist, the link's own words and
         the passage it sits in — so a re-extraction that moves the paragraph
         moves this. A summary about a paragraph that no longer exists is the
         stale answer nobody would ever notice. */
      const reExtracted = { ...INPUTS, contextHash: "0000000000000000" };
      expect(await pgLinkSummaryStore.read(key, reExtracted)).toBeNull();
    });
  });

  it("forgets it when the destination, the prompt or the model moves", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      await store(INPUTS, "The old answer.");
      for (const changed of [
        { ...INPUTS, destHash: "1111111111111111" },
        { ...INPUTS, promptVersion: INPUTS.promptVersion + 1 },
        { ...INPUTS, model: "anthropic/claude-sonnet-5" },
      ]) {
        expect(await pgLinkSummaryStore.read(key, changed)).toBeNull();
      }
    });
  });

  it("hands the claim to one caller and tells the other to wait", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      /* Sequential rather than raced, for the reason the preview cache's
         equivalent gives: `Promise.all` through a lazily-opening pool can
         serialise anyway, which would make a broken lock pass. The second claim
         must see the first's `pending` row, and it will only do that if the
         first wrote one. */
      const first = await pgLinkSummaryStore.claim(key, INPUTS, LEASE_MS);
      const second = await pgLinkSummaryStore.claim(key, INPUTS, LEASE_MS);
      expect(first).toMatchObject({ kind: "claimed" });
      expect(second).toEqual({ kind: "pending" });
    });
  });

  it("gives the loser the winner's answer once it has landed", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      const first = await pgLinkSummaryStore.claim(key, INPUTS, LEASE_MS);
      if (first.kind !== "claimed") throw new Error("expected the claim");
      await pgLinkSummaryStore.fill(key, first.claimId, "The winner's answer.", ONE_FORTNIGHT());
      expect(await pgLinkSummaryStore.claim(key, INPUTS, LEASE_MS)).toEqual({
        kind: "hit",
        summary: "The winner's answer.",
      });
    });
  });

  it("lets the next caller take an abandoned claim once its lease has run out", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      expect(await pgLinkSummaryStore.claim(key, INPUTS, LEASE_MS)).toMatchObject({
        kind: "claimed",
      });
      /* The process holding it died mid-answer. A lease rather than a flag is
         the whole reason this link is not wedged until somebody notices. */
      await getDb()
        .update(linkSummaries)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(linkSummaries.target, TARGET));
      expect(await pgLinkSummaryStore.claim(key, INPUTS, LEASE_MS)).toMatchObject({
        kind: "claimed",
      });
    });
  });

  it("will not let a stalled loser write over its successor", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      const stalled = await pgLinkSummaryStore.claim(key, INPUTS, LEASE_MS);
      if (stalled.kind !== "claimed") throw new Error("expected the claim");
      await getDb()
        .update(linkSummaries)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(linkSummaries.target, TARGET));
      const successor = await pgLinkSummaryStore.claim(key, INPUTS, LEASE_MS);
      if (successor.kind !== "claimed") throw new Error("expected the second claim");
      await pgLinkSummaryStore.fill(key, successor.claimId, "The current answer.", ONE_FORTNIGHT());

      /* The first one wakes up and writes. Fenced on the token, so it lands on
         nothing — otherwise the reader gets a summary written from an older
         profile, or an older version of the article, presented as current. */
      await pgLinkSummaryStore.fill(key, stalled.claimId, "The stale answer.", ONE_FORTNIGHT());
      expect(await pgLinkSummaryStore.read(key, INPUTS)).toBe("The current answer.");

      /* And its release lands on nothing either, rather than deleting the
         successor's row. */
      await pgLinkSummaryStore.release(key, stalled.claimId);
      expect(await pgLinkSummaryStore.read(key, INPUTS)).toBe("The current answer.");
    });
  });

  it("gives a claim back so the next caller may try at once", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      const mine = await pgLinkSummaryStore.claim(key, INPUTS, LEASE_MS);
      if (mine.kind !== "claimed") throw new Error("expected the claim");
      /* The allowance was refused, or the reader left. A `pending` row wedging
         this link for the rest of the lease would be the reader's other tab
         seeing nothing for forty seconds for no reason. */
      await pgLinkSummaryStore.release(key, mine.claimId);
      expect(await pgLinkSummaryStore.claim(key, INPUTS, LEASE_MS)).toMatchObject({
        kind: "claimed",
      });
    });
  });

  it("reads an expired answer as nothing at all", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      await store(INPUTS, "A fortnight ago.");
      await getDb()
        .update(linkSummaries)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(linkSummaries.target, TARGET));
      /* In the WHERE rather than compared in TypeScript, so no caller can serve
         a stale answer by forgetting a date. */
      expect(await pgLinkSummaryStore.read(key, INPUTS)).toBeNull();
    });
  });

  it("cannot be asked about somebody else's article", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      /* Owner-scoped at the store, through `articleIdForOwned` — a slug that is
         not this reader's is not found rather than answered, which is the same
         property `loadArticle` gives the route. Two locks, one door. */
      await expect(
        pgLinkSummaryStore.read({ slug: THEIRS, target: TARGET }, INPUTS),
      ).rejects.toThrow();
    });
  });
});
