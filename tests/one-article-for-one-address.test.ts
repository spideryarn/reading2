/**
 * **One address, one article — through `enqueue`, which is where the repair
 * lives.**
 *
 * `jobs_active_source` catches the race that every other key in the schema
 * misses: two pastes of one URL at the same instant each mint their own random
 * slug, so nothing that contains the slug can see that they are one article.
 * The index refuses the second insert; **the repair is what happens next**, and
 * it is in `enqueue` rather than in either store adapter.
 *
 * ## Why this file exists at all
 *
 * `tests/store-jobs-parity.test.ts` § *makes one article out of two simultaneous
 * requests for one address* proves the **index**: it calls `enqueueOrGet`
 * directly with two preconstructed slugs and looks at `created` / `sourceTaken`.
 * That is worth having and it is not this. It never calls `enqueue`, never runs
 * the repair branch, and would stay green if that branch were deleted — GPT
 * Sol, reviewing the built stage 1, finding 3.
 *
 * ## What the repair has to get right
 *
 * The loser's first allocation is **stale the moment it is refused**, and the
 * dangerous half is not the slug — it is `reservesName`. Rewriting the
 * allocation to an adoption by hand puts the loser *outside*
 * `jobs_active_source` on the strength of a holder it has only been told about:
 *
 *   1. holder H wins the source index;
 *   2. loser L is told `sourceTaken`;
 *   3. H fails, or the reader stops it, before it publishes anything;
 *   4. a third request C sees no article and no active holder, so it mints and
 *      reserves a *new* slug;
 *   5. L inserts its non-reserving job on H's dead slug.
 *
 * Two active jobs, one owner, one URL, two slugs, and both can publish. So the
 * repair re-runs the whole allocation instead — `freeSlug`, which asks the
 * shelf and then the queue — and takes whatever that says now: the holder's
 * slug if the holder is still there, a fresh reserved one if it is not.
 *
 * ## The filesystem store, deliberately
 *
 * The branch under test is in `src/jobs.ts` and is the same code under either
 * adapter; what differs is only which store refuses the insert. This file is
 * about the repair, so it runs where there is no database to be unavailable —
 * the Postgres side of the same arbitration is
 * `tests/store-jobs-parity.test.ts` and `tests/enqueue-owns-the-article.test.ts`.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { enqueue } from "../src/jobs.js";
import { currentOwnerId, DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { forgetForTests, fsJobStore } from "../src/store/jobs-fs.js";
import { mintId } from "../src/ids.js";
import { urlKey } from "../src/ingest.js";
import type { Job } from "../src/types.js";

/** Job ids this file made, removed whatever happened — see `second-job-queues`. */
const made: string[] = [];

/**
 * **`VERCEL`, so `enqueue` does not start driving what it queues.** `pump`
 * returns immediately when it is set (src/jobs.ts). Without it the ingest runs
 * for real — a fetch of a URL that does not exist — and races every assertion
 * below.
 */
let wasVercel: string | undefined;
beforeEach(() => {
  wasVercel = process.env.VERCEL;
  process.env.VERCEL = "1";
});
afterEach(async () => {
  if (wasVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = wasVercel;
  vi.restoreAllMocks();
  await forgetForTests(made.splice(0));
});

/** An address nobody else's test could also be adding. */
function anAddress(): string {
  return `https://one-address.test/${mintId()}`;
}

it("makes one article out of two simultaneous pastes of one address", async () => {
  const url = anAddress();
  const [a, b] = await runAsOwner(DEV_OWNER_ID, () =>
    Promise.all([
      enqueue({ slug: "race", url, steps: ["fetch"] }),
      enqueue({ slug: "race", url, steps: ["fetch"] }),
    ]),
  );
  made.push(a.id, b.id);

  /* The whole assertion, and it is about the *article* rather than about which
     of the two answers came back. Two jobs is fine and expected — they are two
     requests. Two slugs is the reader paying twice for one address. */
  expect(b.slug, "one address became two articles").toBe(a.slug);
});

/**
 * **The holder has gone by the time the loser looks again.**
 *
 * Forced rather than raced: the first `enqueueOrGet` is answered `sourceTaken`
 * naming a holder that is not in the store at all, which is exactly what a
 * holder that failed or was stopped between the refusal and the repair looks
 * like from inside the loop. Every later call is the real store.
 *
 * The two assertions are the two halves of the repair, and the second is the
 * one that matters: it is not enough for the loser to land on a different slug,
 * it has to land **inside `jobs_active_source`**, or the next request for this
 * address mints a second article and nothing catches it.
 *
 * Watched red on 2026-09-02, against the allocation being rewritten by hand:
 * *"the loser adopted a slug whose holder had gone: expected 'gone-spya-…' not
 * to be 'gone-spya-…'"*, and with that assertion removed, *"the loser is
 * outside jobs_active_source, so a later request for this address mints a
 * second article: expected 'created' to be 'sourceTaken'"*.
 */
it("does not adopt the slug of a holder that has since gone", async () => {
  const url = anAddress();
  const ghost = `gone-${mintId()}`;

  const real = fsJobStore.enqueueOrGet.bind(fsJobStore);
  let first = true;
  vi.spyOn(fsJobStore, "enqueueOrGet").mockImplementation(async (job, ticket) => {
    if (!first) return real(job, ticket);
    first = false;
    return {
      kind: "sourceTaken",
      job: { ...job, slug: ghost, status: "queued" } as Job,
    };
  });

  const loser = await runAsOwner(DEV_OWNER_ID, () =>
    enqueue({ slug: "ghosted", url, steps: ["fetch"] }),
  );
  made.push(loser.id);

  expect(loser.slug, "the loser adopted a slug whose holder had gone").not.toBe(ghost);

  /* Is the loser reserving? Ask the index rather than the ticket: a second
     reserving request for this same address must be turned away by the loser's
     own row. `urlKey` normalises the address, and this passes the same one
     `enqueue` derived. */
  const probe = await runAsOwner(DEV_OWNER_ID, async () => {
    const id = mintId();
    made.push(id);
    return fsJobStore.enqueueOrGet(
      {
        id,
        ownerId: currentOwnerId(),
        slug: `probe-${id}`,
        url,
        steps: [{ name: "fetch", label: "Fetching the page", status: "pending" }],
        status: "queued",
        createdAt: new Date().toISOString(),
      },
      { workKey: `probe-${id}`, reservesName: true, urlKey: urlKey(url) },
    );
  });
  expect(
    probe.kind,
    "the loser is outside jobs_active_source, so a later request for this address mints a second article",
  ).toBe("sourceTaken");
});

/* ------------------------------------------------------- and a retry's two -- */

/**
 * **The two repairs a *retry* takes, and the hole a holder's death opened in
 * both.** GPT Sol, reviewing the built stage 3, finding 1.
 *
 * `tests/retry-keeps-the-checkpoints.test.ts` § *the queued retry reserves its
 * address* proves the steady state: a retry that **minted** its old name is
 * inside `jobs_active_source`, so a blind paste is refused. It cannot see
 * either failure below, because in both of them the retry ends up **adopted**
 * — outside that index — and the row that was reserving on its behalf is gone
 * by the time the insert lands.
 *
 * ## Why `enqueue({ retryOf })` rather than `retryJob`
 *
 * `retryOf` is the whole of what a retry is to allocation (`src/jobs.ts` §
 * `EnqueueRequest.retryOf`): `retryJob` reads the failed job, refuses what is
 * not retryable, and then calls `enqueue` with the old job's slug, url and this
 * field. Everything under test is downstream of that call, so building the
 * request directly tests the same code with no queue fixture in the way — and
 * the id it repeats is never looked up.
 *
 * ## The interleaving, and why it needs a spy
 *
 * Both failures live in the gap between the repair's *lookup* and the insert it
 * then makes, which no amount of racing real requests can be relied on to hit.
 * So the first `enqueueOrGet` is answered by hand — the refusal a racing paste
 * would have produced — and the holder is settled terminal on the way into the
 * second, which is the real store.
 */

/** A queued, reserving job in the store, exactly as a racing paste would leave one. */
async function aLiveHolder(slug: string, url?: string): Promise<Job> {
  const id = mintId();
  made.push(id);
  const holder: Job = {
    id,
    ownerId: currentOwnerId(),
    slug,
    ...(url ? { url } : {}),
    steps: [{ name: "fetch", label: "Fetching the page", status: "pending" }],
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const outcome = await fsJobStore.enqueueOrGet(holder, {
    workKey: `holder-${id}`,
    reservesName: true,
    ...(url ? { urlKey: urlKey(url) } : {}),
  });
  if (outcome.kind !== "created") throw new Error(`the holder fixture was refused: ${outcome.kind}`);
  return outcome.job;
}

/**
 * A paste whose own lookup came back empty — the one thing no lookup can rule
 * out — handed straight to the store. `sourceTaken` is the only safe answer.
 */
async function aBlindPaste(url: string): Promise<string> {
  const id = mintId();
  made.push(id);
  const outcome = await fsJobStore.enqueueOrGet(
    {
      id,
      ownerId: currentOwnerId(),
      slug: `blind-${id}`,
      url,
      steps: [{ name: "fetch", label: "Fetching the page", status: "pending" }],
      status: "queued",
      createdAt: new Date().toISOString(),
    },
    { workKey: `blind-${id}`, reservesName: true, urlKey: urlKey(url) },
  );
  return outcome.kind;
}

/** Every slug this owner has an active job on for `url`. One, or the bug. */
async function activeSlugsFor(url: string): Promise<string[]> {
  const jobs = await fsJobStore.list(currentOwnerId());
  return [
    ...new Set(
      jobs
        .filter(
          (j) =>
            (j.status === "queued" || j.status === "running") &&
            j.url !== undefined &&
            urlKey(j.url) === urlKey(url),
        )
        .map((j) => j.slug),
    ),
  ].sort();
}

/**
 * **`sourceTaken`: the retry adopts a holder that dies before the insert.**
 *
 * 1. the retry mints its old name and reserves the address;
 * 2. a fresh paste gets there first and reserves it — `sourceTaken`;
 * 3. the retry re-asks `slugForRetry`, sees the holder, and **adopts** it;
 * 4. the holder ends before the retry's insert lands;
 * 5. the retry's row goes in reserving nothing, and a blind paste mints a
 *    second article for the same address.
 */
it("a retry told sourceTaken does not leave the address unreserved", async () => {
  const url = anAddress();
  const holder = await runAsOwner(DEV_OWNER_ID, () => aLiveHolder(`holder-${mintId()}`, url));

  const real = fsJobStore.enqueueOrGet.bind(fsJobStore);
  let calls = 0;
  vi.spyOn(fsJobStore, "enqueueOrGet").mockImplementation(async (job, ticket) => {
    calls += 1;
    /* Call 1 is the retry's minted insert: refuse it the way `jobs_active_source`
       would, naming the holder that is really there. */
    if (calls === 1) return { kind: "sourceTaken", job: holder };
    /* Call 2 is the retry's *repaired* insert. The holder ends here — the reader
       stopped it, or it failed — which is the gap no lookup can close. */
    if (calls === 2) await fsJobStore.requestCancel(holder.id, DEV_OWNER_ID);
    return real(job, ticket);
  });

  const retry = await runAsOwner(DEV_OWNER_ID, () =>
    enqueue({ slug: `old-${mintId()}`, url, steps: ["fetch"], retryOf: mintId() }),
  );
  made.push(retry.id);
  vi.restoreAllMocks();

  await runAsOwner(DEV_OWNER_ID, async () => {
    const blind = await aBlindPaste(url);
    /* The slugs first, because that is the invariant in the plainest form the
       failure output can carry: one address, one active article. */
    expect(await activeSlugsFor(url), "one address, two active articles").toHaveLength(1);
    /* And here — where the holder is the address's own live ingest — the retry
       inserted nothing and the holder is still reserving, so the blind paste is
       refused by the index rather than by anybody's lookup. */
    expect(
      blind,
      "nothing is reserving the address, so a paste that cannot see it mints a second article",
    ).toBe("sourceTaken");
  });
  expect(retry.id, "the retry inserted a second row instead of taking the holder").toBe(holder.id);
});

/**
 * **`nameTaken`: the same hole, through the repair that did not revalidate at
 * all.**
 *
 * The name-holder reserves the retry's own slug without reserving its address —
 * it has to, since a holder reserving *both* would have been answered
 * `sourceTaken`, which both adapters ask first. An upload's retry racing a URL
 * retry on one article is the shape of it. So the retry used to adopt its own
 * name with nothing checked at all, the holder ended, and the address was left
 * with an active job and no reservation.
 *
 * **The blind paste is not asserted here**, and the difference is the point: the
 * repair now inserts no row, so there is no active job for this address at all
 * and a paste is *right* to mint one. What has to hold either way is the count
 * below.
 */
it("a retry told nameTaken does not leave the address unreserved", async () => {
  const url = anAddress();
  const slug = `old-${mintId()}`;
  const holder = await runAsOwner(DEV_OWNER_ID, () => aLiveHolder(slug));

  const real = fsJobStore.enqueueOrGet.bind(fsJobStore);
  let calls = 0;
  vi.spyOn(fsJobStore, "enqueueOrGet").mockImplementation(async (job, ticket) => {
    calls += 1;
    if (calls === 1) return { kind: "nameTaken", job: holder };
    if (calls === 2) await fsJobStore.requestCancel(holder.id, DEV_OWNER_ID);
    return real(job, ticket);
  });

  const retry = await runAsOwner(DEV_OWNER_ID, () =>
    enqueue({ slug, url, steps: ["fetch"], retryOf: mintId() }),
  );
  made.push(retry.id);
  vi.restoreAllMocks();

  await runAsOwner(DEV_OWNER_ID, async () => {
    await aBlindPaste(url);
    expect(await activeSlugsFor(url), "one address, two active articles").toHaveLength(1);
  });
  expect(retry.id, "the retry inserted a second row instead of taking the holder").toBe(holder.id);
});
