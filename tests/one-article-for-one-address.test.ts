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
