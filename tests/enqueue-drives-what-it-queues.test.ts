/**
 * **`enqueue` drives what it queues, unless the caller says it will.**
 *
 * `enqueue` ends by calling `pump`, which advances the job in this process until
 * there is nothing left to do. That is what a reader pressing Add wants, and it
 * is exactly wrong for a caller that runs its own `advanceJob` loop: the pump
 * wins the claim synchronously, runs the step with the **production** step
 * registry, and the caller's loop is told `busy` and backs off — so an eval's
 * fixture overlay never executes and `scripts/stage.ts` never sees the step's
 * own report.
 *
 * ## Why this file exists at all
 *
 * Because the defence used to be a lie and nothing tested the lie's effect. Both
 * callers set `VERCEL=1` around the `enqueue` call, because `pump` returns
 * immediately when it is set — a process on a laptop claiming to be on Vercel to
 * make one `if` go the other way, copied to a third place before anybody
 * objected. `evals/cost/harness.ts` wrapped it as `withoutTheInProcessPump` and
 * tests/cost-eval.test.ts checked that the wrapper put `process.env` back
 * afterwards, which is a test of a `try/finally` and says nothing about whether
 * the pump was actually stopped.
 *
 * `pump: false` on the request replaced all of it in stage E of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * and **this asserts the effect rather than the mechanism**: queue a job and
 * look, a moment later, at whether anything moved it.
 *
 * ## Why `fetch` on a seeded article, of all steps
 *
 * Because it costs nothing either way. The scratch article arrives with its raw
 * source already in Postgres, so `fetch` is *done* and the only thing the pump
 * can do with this job is skip it and settle. The positive control asserts
 * exactly that — `done`, with the step `skipped` — so a day when the step stops
 * being a skip fails this file loudly rather than quietly buying something.
 *
 * Skips loudly when there is no database; see tests/helpers/pg-ready.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { getDb } from "../src/db/client.js";
import { jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { enqueue, getJob } from "../src/jobs.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";


loadEnvLocal();

await pgReady({
  suite: "tests/enqueue-drives-what-it-queues.test.ts",
  tables: ["spideryarn.articles", "spideryarn.jobs"],
});

const SLUG = "test-enqueue-pump-flag";

/** One owner for the article, the jobs and every read of them. See `as` below. */
const OWNER = DEV_OWNER_ID;

let article: ScratchArticle | undefined;
let vercel: string | undefined;

beforeAll(async () => {
  /* **`VERCEL` off for this whole file**, which is the opposite of what every
     other queue suite does — and it has to be, because the thing under test is
     whether the pump runs. With it set, both cases below would look identical
     and both would pass. */
  vercel = process.env.VERCEL;
  delete process.env.VERCEL;
  article = await scratchArticleInPg(SLUG, { ownerId: OWNER });
}, 180_000);

afterAll(async () => {
  if (vercel !== undefined) process.env.VERCEL = vercel;
  await getDb().delete(jobsTable).where(eq(jobsTable.slug, SLUG));
  await article?.remove();
});

/** How long to give a pump that is running. A skip-and-settle is milliseconds. */
const LOOK_AFTER_MS = 2_000;

/**
 * **Everything here runs as one owner, reads included**, and forgetting that is
 * how the first version of this file failed — usefully.
 *
 * `getJob` is owner-scoped (`store.get(id, currentOwnerId())`, src/jobs.ts), and
 * outside a `runAsOwner` the answer is the *environment* owner, which is not
 * `DEV_OWNER_ID`. So both cases read `gone` for a job that was sitting there
 * perfectly happily, and the one that made that legible was the positive
 * control: a file whose only case is *"the job did not move"* would have gone
 * green on a lookup that could never find it.
 */
const as = <T>(fn: () => Promise<T>): Promise<T> => runAsOwner(OWNER, fn);

async function statusAfterAMoment(id: string): Promise<string> {
  await new Promise((r) => setTimeout(r, LOOK_AFTER_MS));
  return (await as(() => getJob(id)))?.status ?? "gone";
}

describe("enqueue and the in-process pump", () => {
  it("drives the job it queued, by default", async () => {
    /* **The positive control, and it is the half that can rot.** If this stopped
       being a skip — a step that fails, or a claim this process cannot take —
       the case below would pass for a reason that has nothing to do with
       `pump: false`, which is precisely the shape stage D of the plan was about.
       So it asserts *what* the pump did, not only that something happened. */
    const job = await as(() => enqueue({ slug: SLUG, steps: ["fetch"] }));
    expect(await statusAfterAMoment(job.id)).toBe("done");
    const after = await as(() => getJob(job.id));
    expect(after?.steps.find((s) => s.name === "fetch")?.status).toBe("skipped");
  }, 30_000);

  it("leaves it alone when the caller says it will drive", async () => {
    const job = await as(() => enqueue({ slug: SLUG, steps: ["fetch"], pump: false }));
    /* Still where `enqueue` left it: nothing in this process picked it up. */
    expect(await statusAfterAMoment(job.id)).toBe("queued");
  }, 30_000);
});
