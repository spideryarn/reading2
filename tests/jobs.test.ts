/**
 * The ingest queue's decisions — src/jobs.ts, src/pipeline.ts, src/routes.ts.
 *
 * Almost nothing here runs a job. Queuing one fetches somebody's website and
 * spends money at two model endpoints, so what is mostly tested is everything
 * that decides *whether* and *in what order* that happens, plus the request
 * parsing that stands between the browser and the database.
 *
 * The exceptions are the two blocks that drive the real queue — `running a job`
 * and `advancing a job one step at a time`. Both stay offline and free, and how
 * they manage that changed with the store; see below.
 *
 * See docs/project/ingest-queue.md, and docs/project/testing.md for why the
 * line is drawn here.
 *
 * ## The store, since 2026-09-04
 *
 * Stage B of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
 * This file left `SPIDERYARN_STORE` unset, so *"the queue's arithmetic plus the
 * write path around the one bug that ever took a running server down"* was
 * being asserted about `data/_jobs/` — a directory of JSON files and a
 * process-local `Map`. Production's queue is `spideryarn.jobs`: `enqueue` is an
 * insert arbitrated by `jobs_active_work` and `jobs_active_slug`, a claim is
 * `update … where status = 'queued'`, the lease is `lease_expires_at` on the
 * database's own clock, and `failure_kind` is a column. None of those existed
 * on the store this file used to run against.
 *
 * **Eight of the ten blocks below are pure functions and were never affected**
 * — `the pipeline`, `orderSteps`, `cascadeForce`, `forceForRetry`,
 * `parseJobRequest`, `the work key`, `freeSlug` and `slugForRetry`, the last two
 * injecting their shelf lookup. They are untouched by the conversion and need no
 * mutation evidence, because there is no store under them to reach.
 *
 * ## What the conversion cost, and the one thing it did **not** cost
 *
 * It did not cost a fixture. `lockOrCreateArticle` (src/store/pg-revisions.ts)
 * **creates the article row** when a claim opens a draft for a slug nothing
 * holds, so a job on a bare slug still runs, still finds no source URL, and
 * still fails offline at `fetch` — which is how this file has always stayed
 * free. That is worth writing down because every other queue suite converted in
 * this stage had to seed an article, and the reason they did is that they walk
 * *fake* steps whose products the store shape-checks.
 *
 * What it did cost:
 *
 * - **`data/<slug>/` became `spideryarn.articles`.** Those empty rows are what
 *   the claim leaves behind, and `afterAll` deletes them by slug — jobs first,
 *   because `jobs.draft_revision_id` is a foreign key into the revision an
 *   article delete would be cascading away.
 * - **`fixtureWithRawJson` became a seeded article**, in the one block that
 *   needs a step to be genuinely *done* — see that block's own note.
 * - **Every hand-written id.** `jobs_id_format` refuses a mnemonic whose body
 *   does not start with a letter, and `jobs.attempt_id` is a real `uuid`, so
 *   `"spya-someone"` no longer inserts. `mintId()` and `mintAttempt()`.
 *
 * ## Every byte assertion, one at a time
 *
 * Nothing was dropped silently.
 *
 * - **the `afterAll` sweep of `data/_jobs/` through `jobFilesOnDisk`**, and its
 *   companion `rm` of `data/<slug>/`. **Converted**, to deletes of
 *   `spideryarn.jobs` and `spideryarn.articles` by slug. Neither was ever an
 *   assertion — they were careful *because* `data/_jobs/` is a real directory a
 *   reader may have jobs in, which the private database makes moot.
 * - **`JOBS_DIR` and `ROOT_DATA`**. **Incidental scaffolding, dropped.** Their
 *   last reader — the temp-file case — moved to `tests/jobs-fs-adapter.test.ts`
 *   in the split.
 * - **`fixtureWithRawJson` writing `data/<slug>/raw.json`, and `RAW_MANIFEST`.**
 *   **Converted.** *"A slug with a `raw.json`, so `fetch` counts as done"* is
 *   `article_revisions`' raw columns plus a `revision_step_runs` row saying
 *   `done`, which is what `hasArtefacts` (src/store/artifacts-pg.ts) asks —
 *   strictly more than a file's presence. A seeded article has both. The stub
 *   that had to *return* a manifest now returns the corpus's own, because
 *   `writeRawSource` refuses one whose `storedSha256` names no `raw_sources`
 *   row.
 * - **`pause()` / `pauseForTests`.** **Dropped, by not needing it.** It existed
 *   to put a settled job back the way a stopped server leaves it, because
 *   `enqueue`'s pump had already driven it. Both advance cases now insert the
 *   `queued` row with `pgJobStore.enqueueOrGet` and never start a pump, which is
 *   the same state without the race — `tests/jobs-walk.test.ts` § `queueJob`
 *   makes the same choice.
 * - **`expireLeaseForTests`.** **Converted** to an `update … set lease_expires_at
 *   = clock_timestamp() - interval '1 second'`, the database's own clock, which
 *   is the clock `settleExpired` compares against.
 *
 * Nothing moved to `tests/jobs-fs-adapter.test.ts` in this pass; the four blocks
 * that belonged there went in the split that preceded it.
 *
 * ## The mutations, one per store-touching block, watched on 2026-09-04
 *
 * Recorded above each block rather than here, because a mutation is evidence
 * about the cases beneath it and reads as decoration anywhere else.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres` before **any** import.
 *
 * `src/jobs.ts` picks its store **once, at module load** — `const store:
 * JobStore = STORE === "postgres" ? pgJobStore : fsJobStore` — and imports are
 * hoisted above every statement in a module, so a plain assignment here would
 * leave the whole file on the filesystem queue with nothing saying so.
 * `claimSession` branches on the same constant.
 */
const HOISTED = vi.hoisted(() => {
  const previousStore = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return { previousStore };
});

import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, jobs as jobsTable, uploads } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import {
  advanceJob,
  cascadeForce,
  enqueue,
  forceForRetry,
  forgetJob,
  freeSlug,
  slugForRetry,
  getJob,
  orderSteps,
  sameWork,
  unrunnableStepPlan,
  workKeyFor,
} from "../src/jobs.js";
import {
  DEFAULT_INGEST_STEPS,
  FORCE_ONLY_WHEN_NAMED,
  isStepName,
  STEP_ORDER,
  STEPS,
} from "../src/pipeline.js";
import type { ConvertedProduct } from "../src/pipeline.js";
import { isSlug, urlKey } from "../src/ingest.js";
import type { ArtifactKind, ArtifactParts } from "../src/store/artifacts.js";
import { mintAttempt } from "../src/store/jobs.js";
import { STORE } from "../src/store/live.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { jobWorthRetrying } from "../src/job-failure.js";
import { parseJobRequest } from "../src/routes.js";
import { currentOwnerId, DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import type { Job, JobStep, StepName } from "../src/types.js";
import { bareArticles } from "./helpers/bare-article.js";
import { pgReady } from "./helpers/pg-ready.js";
import { FIXTURE_ROOT } from "./helpers/require-fixture.js";
import { scratchArticleInPg, SCRATCH_SOURCE, type ScratchArticle } from "./helpers/scratch-article.js";

/* Put the flag back straight after the imports: vitest reuses a worker across
   files and does not reset `process.env` between them. */
if (HOISTED.previousStore === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = HOISTED.previousStore;

loadEnvLocal();

const { reachable } = await pgReady({
  suite: "tests/jobs.test.ts",
  tables: ["spideryarn.articles", "spideryarn.jobs"],
});

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    /* **Not gated on `reachable`**, deliberately. A flag that failed to take
       would run the two queue blocks below against `data/_jobs/`, which answers
       every one of them happily — and the insert arbitration, the claim
       predicate and the lease that are the point of the conversion would never
       be consulted. A control that vanishes when the database is missing
       vanishes exactly when it matters. */
    expect(STORE).toBe("postgres");
  });
});

function step(name: StepName, status: JobStep["status"]): JobStep {
  return { name, label: STEPS[name].label, status };
}

describe("the pipeline", () => {
  it("has a step for every name in STEP_ORDER, and no others", () => {
    expect(STEP_ORDER).toEqual(Object.keys(STEPS));
  });

  it("names each step in the present tense rather than counting them", () => {
    // The label is what the reader watches. "Extracting the article" says what
    // is slow and what is about to fail; "Step 3 of 5" says neither. See
    // docs/project/ingest-queue.md#naming-the-step-is-the-point.
    for (const name of STEP_ORDER) {
      expect(STEPS[name].label).toMatch(/^[A-Z]\w+ing /);
      expect(STEPS[name].name).toBe(name);
    }
  });

  it("recognises only real step names", () => {
    expect(isStepName("hierarchy")).toBe(true);
    expect(isStepName("summarise")).toBe(false);
    expect(isStepName("")).toBe(false);
    expect(isStepName(null)).toBe(false);
    // Not a step name, but it IS a property of every object.
    expect(isStepName("constructor")).toBe(false);
    expect(isStepName("toString")).toBe(false);
  });

  it("accepts `tweets` as a step name, so the button can ask for one", () => {
    // Missing from STEP_ORDER, this is rejected as a bad name and
    // POST /api/jobs { steps: ["tweets"] } never works — see
    // docs/plans/260825g-tweet-thread-page.md#the-one-real-snag-stated-precisely.
    expect(isStepName("tweets")).toBe(true);
    expect(STEP_ORDER).toContain("tweets");
  });

  it("leaves `tweets` out of what a bare add runs", () => {
    // The half of the split that costs money if it's wrong: every article ever
    // added would write a thread nobody asked for. DEFAULT_INGEST_STEPS exists for
    // exactly this, and it must stay a strict subset of the order.
    expect(DEFAULT_INGEST_STEPS).not.toContain("tweets");
    for (const name of DEFAULT_INGEST_STEPS) expect(STEP_ORDER).toContain(name);
  });

  it("accepts `glossary`, and keeps it out of what a bare add runs", () => {
    // Both halves at once, because they are one decision: the glossary is a
    // step you can ask for by name and never one an "add this URL" spends a
    // model call on. Greg was asked and said a button, on demand (2026-08-25).
    // See docs/project/glossary.md.
    expect(isStepName("glossary")).toBe(true);
    expect(STEP_ORDER).toContain("glossary");
    expect(DEFAULT_INGEST_STEPS).not.toContain("glossary");
  });

  it("sorts `tweets` after the steps it reads", () => {
    // Order is about running, not about forcing — `tweets` is exempt from the
    // force-cascade (below) but it still has to run after the stages whose
    // artefacts it reads, which are `blocks` and `hierarchy`. A name missing from
    // STEP_ORDER sorts to the FRONT, because `indexOf` gives it -1, so
    // `{ steps: ["hierarchy", "tweets"] }` would have written the thread from the
    // previous tree and then replaced that tree.
    expect(orderSteps(["tweets", "hierarchy", "blocks"])).toEqual(["blocks", "hierarchy", "tweets"]);
  });
});

describe("orderSteps", () => {
  it("sorts into pipeline order whatever order they arrived in", () => {
    // The steps are a chain: each consumes what the one before it wrote. Run
    // ["arc", "hierarchy"] as asked and the arc is built from the previous tree,
    // which is then replaced — two successes and an arc describing an article
    // nobody is reading.
    expect(orderSteps(["arc", "hierarchy", "fetch"])).toEqual(["fetch", "hierarchy", "arc"]);
  });

  it("de-duplicates", () => {
    expect(orderSteps(["hierarchy", "hierarchy", "hierarchy"])).toEqual(["hierarchy"]);
  });

  it("leaves an already-ordered list alone", () => {
    expect(orderSteps([...STEP_ORDER])).toEqual(STEP_ORDER);
  });
});

/**
 * **The one step combination the queue refuses**, and it is refused at the door
 * rather than after it has run. See `unrunnableStepPlan` in src/jobs.ts for the
 * trap and for why the answer is a 400 and not a silently added model call.
 *
 * **No mutation involving the store: no store reaches this block.** Every case
 * here hands the pure function a list of step names and reads the string or
 * `undefined` it returns; nothing is claimed, queued or written.
 *
 * **And that is the gap, not a clean bill.** The refusal that matters happens at
 * the queue's door — `enqueue` calls this and throws a 400 — and *nothing*
 * asserts that. The cost of the hole is measured rather than hypothetical:
 * `evals/deepen/`'s free `--dry-run` asked for `["fetch","extract","blocks"]`,
 * every phase threw at `enqueue`, and the whole suite stayed green through it,
 * because this block tests the predicate and no block tests the door. A
 * store-level test belongs with whoever added the rule — it wants an article, an
 * owner and an assertion that no job row is written, which is the shape
 * `tests/enqueue-owns-the-article.test.ts` already has for the ownership refusal.
 * Written here rather than fixed here on purpose: this judgement is a fact about
 * this block, and the registry's real question is one for the rule's author.
 * ⟨Found 2026-09-05 while merging `dev`; see the deliberate "not fixed here" in
 * docs/plans/260905b-feedback-reports-batch-three.md, which this does not
 * overturn — it answers the question that decision left open.⟩
 */
describe("unrunnableStepPlan", () => {
  it("refuses blocks without hierarchy, which is the request that strands an article", () => {
    expect(unrunnableStepPlan(["blocks"])).toMatch(/hierarchy/);
    expect(unrunnableStepPlan(["fetch", "extract", "blocks"])).toMatch(/hierarchy/);
    expect(unrunnableStepPlan(["blocks", "assets", "arc"])).toMatch(/hierarchy/);
  });

  it("allows the pair, in either order it may be written", () => {
    expect(unrunnableStepPlan(["blocks", "hierarchy"])).toBeUndefined();
    expect(unrunnableStepPlan(orderSteps(["hierarchy", "blocks"]))).toBeUndefined();
    expect(unrunnableStepPlan(DEFAULT_INGEST_STEPS)).toBeUndefined();
    expect(unrunnableStepPlan([...STEP_ORDER])).toBeUndefined();
  });

  it("says nothing about a job that does not touch the blocks at all", () => {
    // `hierarchy` alone is fine and common: it is how somebody repairs exactly
    // the article this rule exists to stop stranding.
    expect(unrunnableStepPlan(["hierarchy"])).toBeUndefined();
    expect(unrunnableStepPlan(["fetch", "extract"])).toBeUndefined();
    expect(unrunnableStepPlan(["tweets"])).toBeUndefined();
  });
});

describe("cascadeForce", () => {
  it("forces every step after the first forced one", () => {
    // The bug this exists to prevent: "refresh from source" forces fetch and
    // extract, the three stages after them find their files still on disk and
    // skip, and you get a fresh article under last week's tree — with five
    // green ticks over it. See docs/reusable/silent-success.md.
    expect([...cascadeForce([...STEP_ORDER], new Set(["fetch"]))]).toEqual([
      "fetch",
      "extract",
      "blocks",
      "hierarchy",
      /* `assets` IS swept in, unlike the four steps after `arc`, and the reason
         is the one the cascade encodes: a refresh from source is a request to
         get this article again, and the article's figures are part of it.
         Hot-links rot — five of the corpus's thirteen images sit behind an
         imgix signature that can be rotated — so a forced re-fetch is exactly
         when you want to find out. src/pipeline.ts § FORCE_ONLY_WHEN_NAMED
         names the other four and deliberately not this one. */
      "assets",
    ]);
  });

  it("starts the cascade at the earliest forced step, not the one named last", () => {
    /* `arc` is still here because it was **named**. Since 2026-08-29 it is in
       FORCE_ONLY_WHEN_NAMED, which stops it being swept in by position — naming
       it has always been the other way in, and that is unchanged. */
    expect([...cascadeForce([...STEP_ORDER], new Set(["arc", "blocks"]))]).toEqual([
      "blocks",
      "hierarchy",
      "assets",
      "arc",
    ]);
  });

  it("forces nothing when nothing was asked for", () => {
    expect([...cascadeForce([...STEP_ORDER], new Set())]).toEqual([]);
  });

  it("cascades within the job's own steps, not the whole pipeline", () => {
    /* A job of {hierarchy, arc} that forces hierarchy must not invent a fetch step nobody
       asked for. It no longer forces `arc` either: since 2026-08-29 `arc` can
       tell for itself whether it is current, so it is in FORCE_ONLY_WHEN_NAMED
       and an unforced run re-does it exactly when its inputs have moved. */
    expect([...cascadeForce(["hierarchy", "arc"], new Set(["hierarchy"]))]).toEqual(["hierarchy"]);
    // Named, it is forced like anything else.
    expect([...cascadeForce(["hierarchy", "arc"], new Set(["hierarchy", "arc"]))]).toEqual(["hierarchy", "arc"]);
  });

  it("ignores a forced step the job isn't running", () => {
    expect([...cascadeForce(["hierarchy", "arc"], new Set(["fetch"]))]).toEqual([]);
  });

  it("does not sweep `tweets` in by position", () => {
    // The cascade encodes "each step eats what the one before it wrote", and
    // `tweets` is not in that chain — it reads the blocks and the tree, the
    // same inputs the arc reads, and nothing reads what it writes. Swept in by
    // position, forcing the arc would buy a second model call for a thread
    // whose inputs never moved. See FORCE_ONLY_WHEN_NAMED in src/pipeline.ts.
    expect(FORCE_ONLY_WHEN_NAMED.has("tweets")).toBe(true);
    expect([...cascadeForce([...STEP_ORDER], new Set(["arc"]))]).toEqual(["arc"]);
    /* `arc` is absent here for the same reason `tweets` is, as of 2026-08-29 —
       both can now judge their own freshness. */
    expect([...cascadeForce(["hierarchy", "arc", "tweets"], new Set(["hierarchy"]))]).toEqual(["hierarchy"]);
  });

  it("does not sweep `glossary` in by position either, and this one appends", () => {
    /* Same argument as `tweets` — it reads the blocks and the tree, and nothing
       reads what it writes — plus one that is sharper here. Forcing this step
       does not rewrite the list, it **adds a batch of terms to it**
       (src/glossary.ts § generateGlossary). So being swept into the cascade
       would not merely waste a model call: re-fetching an article would silently
       make the reader's glossary longer. */
    expect(FORCE_ONLY_WHEN_NAMED.has("glossary")).toBe(true);
    expect([...cascadeForce([...STEP_ORDER], new Set(["fetch"]))]).not.toContain("glossary");
    expect([...cascadeForce(["hierarchy", "glossary"], new Set(["hierarchy"]))]).toEqual(["hierarchy"]);
  });

  it("still forces `glossary` when it is named — that is the Find more button", () => {
    expect([...cascadeForce(["glossary"], new Set(["glossary"]))]).toEqual(["glossary"]);
  });

  it("still forces `tweets` when it is named", () => {
    // Exempt from the cascade is not exempt from `force`. This is the rewrite
    // button: the thread looks current and you want a different one anyway.
    expect([...cascadeForce(["tweets"], new Set(["tweets"]))]).toEqual(["tweets"]);
    /* `arc` is not here, and its absence is the same rule doing its job: it left
       the positional cascade on 2026-08-29 and was not named. `assets` stays,
       because it never left. */
    expect([...cascadeForce([...STEP_ORDER], new Set(["hierarchy", "tweets"]))]).toEqual([
      "hierarchy",
      "assets",
      "tweets",
    ]);
  });

  it("lets `arc` out of the cascade, now that it CAN check itself", () => {
    /* **This test asserted the opposite until 2026-08-29, and the reason it
       gave was the right one: `arc` had no freshness check, so its position was
       the only signal that it had gone stale.** It has one now — a `stamp` over
       the blocks, the tree and the metadata its prompt carries (src/arc.ts §
       `inputFingerprint`) — which is the exact condition FORCE_ONLY_WHEN_NAMED
       states for membership.

       Worth knowing that position was never quite the signal it looked like:
       `cascadeForce` only names steps already in the job, so a forced
       `{ steps: ["hierarchy"] }` never reached `arc` even then, and the stale arc that
       resulted lost entries in silence. The stamp is what actually closed that.
       docs/plans/260829f-defer-arc-and-rename-hierarchy.md § 2.1. */
    expect(FORCE_ONLY_WHEN_NAMED.has("arc")).toBe(true);
    /* `assets` is in the cascade too, and for a third reason again: it *can*
       check itself — it has a stamp over the blocks hash — but a forced
       re-fetch is a request to go and look at the publisher again, which is the
       one thing the stamp cannot answer. A rotated imgix signature changes
       nothing about the blocks. */
    expect(FORCE_ONLY_WHEN_NAMED.has("assets")).toBe(false);
    expect([...cascadeForce([...STEP_ORDER], new Set(["hierarchy"]))]).toEqual([
      "hierarchy",
      "assets",
    ]);
  });
});

describe("forceForRetry", () => {
  const forced = (name: StepName, status: JobStep["status"]): JobStep => ({
    ...step(name, status),
    force: true,
  });

  it("forces nothing after an ordinary failure", () => {
    // The steps that succeeded are still good. Skipping them is what Retry is.
    expect(
      forceForRetry([step("fetch", "done"), step("extract", "done"), step("blocks", "error")]),
    ).toEqual([]);
  });

  /* **These three asserted the opposite until 2026-08-31**, and the reason they
     gave was the money: a refresh forces all five steps, so re-forcing them on
     Retry re-fetches, re-extracts and re-splits an article whose first three
     stages had just succeeded, and pays for the model call again.

     That reasoning was right about the filesystem and wrong about Postgres,
     which is the fourth fault of docs/plans/260831b-finish-the-database-move.md.
     The steps that "succeeded" wrote into a draft; the failure discarded it; the
     retry's draft is copied from the revision the reader is still on. So the
     thrift was buying nothing and losing the refresh in silence. Greg's decision
     8: a failed refresh starts over. The narrative fixture is
     tests/retry-after-a-failed-refresh.test.ts; these three are the shapes. */
  it("re-forces what the refresh forced, back to the earliest of them", () => {
    expect(
      forceForRetry([
        forced("fetch", "done"),
        forced("extract", "done"),
        forced("blocks", "done"),
        forced("hierarchy", "error"),
        forced("arc", "pending"),
      ]),
    ).toEqual(["fetch", "extract", "blocks", "hierarchy", "arc"]);
  });

  it("forces from the front when a forced job failed at its first step", () => {
    expect(forceForRetry([forced("fetch", "error"), forced("extract", "pending")])).toEqual([
      "fetch",
      "extract",
    ]);
  });

  it("re-forces even when every step finished, because the publication did not", () => {
    // All steps `done` and a job at Retry means something after the steps
    // failed — the publication, which is what turns the draft into the article.
    // Nothing was published, so nothing those steps did survived.
    expect(forceForRetry([forced("fetch", "done"), forced("extract", "skipped")])).toEqual([
      "fetch",
      "extract",
    ]);
  });
});

describe("parseJobRequest", () => {
  it("derives the slug from the URL rather than trusting one", () => {
    const parsed = parseJobRequest({ url: "https://www.noemamag.com/the-mythology-of-conscious-ai/" });
    expect(parsed.slug).toBe("the-mythology-of-conscious-ai");
    expect(parsed.url).toBe("https://www.noemamag.com/the-mythology-of-conscious-ai/");
    expect(parsed.steps).toBeUndefined(); // absent means "all of them"
  });

  it("refuses an unusable url without repeating it back", () => {
    /* The refusal message is LOGGED, which is the whole point of this test.
       `logRequest` in src/routes.ts writes `reason: err.message` for any error
       that named its own status — an `httpError` is a decision this file made,
       so its message is treated as ours and written down. That makes every
       `httpError` string a thing we publish, not just a thing we say.

       This one used to interpolate the URL, which defeated the query-string
       strip forty lines above it in the same file: `path` was cleaned and then
       the whole raw URL came back in as `reason`, credentials and all, at warn.
       A source URL is untrusted input and can carry a token or basic-auth
       credentials — docs/project/logging.md, and it is the same shape as the
       hierarchy.ts title and the chat.ts `reason` field.

       Nothing is lost by dropping it: the caller sent the URL, so quoting it
       back tells them nothing they do not have.

       The trigger is a URL that will not parse — `slugFromUrl` returns "" for
       one, and "" is not a slug.

       **The trigger changed on 2026-08-26 and the old one is worth recording**,
       because it swapped places with the counter-example beside it. This used
       to say that pasting a bare domain was the ordinary way here, and that a
       mistyped scheme was not, since `new URL` accepts `htp://…` quite happily
       and derives a perfectly good slug from it. Both halves are now the other
       way round: `normaliseUrl` supplies the missing `https://`, so a bare
       domain is an ordinary URL — and `slugFromUrl` refuses a scheme it could
       never fetch, so `htp://` is the mistake that gets this far. Which is an
       improvement on its own: that typo used to queue a job and fail at fetch. */
    const secret = "htp://example.com/private/a?token=SECRET-8888&key=pw-7777";
    expect(() => parseJobRequest({ url: secret })).toThrow();
    try {
      parseJobRequest({ url: secret });
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain("SECRET-8888");
      expect(message).not.toContain("pw-7777");
      expect(message).not.toContain(secret);
    }
  });

  /**
   * **The steer is gone, and a stale client must not be able to smuggle one.**
   *
   * `guidance` was a free-text note interpolated straight into the summary
   * prompt, with its own cap because uncapped it was a way to spend somebody
   * else's tokens by the megabyte. The box that fed it was deleted on
   * 2026-08-30 — it asked the same question the reader profile already asks,
   * and the profile reaches the same prompt
   * (docs/plans/260830o-steer-becomes-the-profile.md).
   *
   * So the field is **ignored, not refused**: a tab open since before the
   * deploy should get its summaries written rather than a 400 about a box it
   * can still see. What must not happen is the middle case — the field quietly
   * surviving into the request and steering a prompt through a door nobody is
   * watching any more, with no cap in front of it because the cap went with the
   * parser.
   */
  it("ignores a steer from a client that still sends one", () => {
    const parsed = parseJobRequest({ slug: "a", guidance: "the evidence" }) as Record<
      string,
      unknown
    >;
    expect(parsed.guidance).toBeUndefined();
    // And an enormous one is dropped rather than carried or thrown over: there
    // is no cap any more because there is nothing left to cap.
    expect(() =>
      parseJobRequest({ slug: "a", guidance: "x".repeat(100_000) }),
    ).not.toThrow();
    expect(
      (parseJobRequest({ slug: "a", guidance: "x".repeat(100_000) }) as Record<string, unknown>)
        .guidance,
    ).toBeUndefined();
  });

  it("refuses a slug that could climb out of data/", () => {
    // The slug is joined onto data/ and output/. This is the check that stands
    // between a POST body and the filesystem — see
    // docs/project/ingest-queue.md#the-one-security-check.
    expect(() => parseJobRequest({ slug: "../../.ssh" })).toThrow(/Expected/);
    expect(() => parseJobRequest({ url: "https://x.test/a", slug: "../escape" })).toThrow(
      /not both/,
    );
  });

  it("refuses a url and a slug together", () => {
    // This combination used to point a full refresh at an article you already
    // had, from a request that looked like an ordinary add — and the slug was
    // path-safe, so nothing complained.
    expect(() =>
      parseJobRequest({
        url: "https://a.example/x",
        slug: "an-article-i-already-have",
        force: ["fetch"],
      }),
    ).toThrow(/not both/);
  });

  it("refuses a URL nothing could be made of", () => {
    expect(() => parseJobRequest({ url: "not a url" })).toThrow(/Could not make a slug/);
  });

  it("refuses a body that is neither shape", () => {
    expect(() => parseJobRequest({})).toThrow(/Expected \{ url \} or \{ slug \}/);
    expect(() => parseJobRequest(null)).toThrow(/Expected/);
    expect(() => parseJobRequest({ slug: 42 })).toThrow(/Expected/);
  });

  it("takes steps and force on an article we already have", () => {
    const parsed = parseJobRequest({ slug: "some-article", steps: ["arc"], force: ["arc"] });
    expect(parsed).toEqual({ slug: "some-article", steps: ["arc"], force: ["arc"] });
  });

  it("refuses a step name it doesn't know", () => {
    // Left unchecked this reaches `STEPS[name]` as undefined and fails deep in
    // the runner, where the message is about a property of undefined rather
    // than about the request that caused it.
    expect(() => parseJobRequest({ slug: "a", steps: ["summarise"] })).toThrow(/steps must be/);
    expect(() => parseJobRequest({ slug: "a", steps: "hierarchy" })).toThrow(/steps must be/);
    expect(() => parseJobRequest({ slug: "a", force: ["nope"] })).toThrow(/force must be/);
  });

  it("carries the status a bad request should be reported as", () => {
    // Without this the router's fallback calls it a 500, and a typo in a step
    // name reads as a server fault.
    try {
      parseJobRequest({});
      expect.unreachable();
    } catch (err) {
      expect((err as { status?: number }).status).toBe(400);
    }
  });
});

/* ---------------------------------------------------------------------------
   The two blocks that run the queue for real.

   They queue steps that cannot succeed — there is no source URL for these
   slugs, so `fetch` throws before it reaches the network — which is what makes
   them safe: nothing is fetched and no model is called. What they exercise is
   the machinery around the step, and specifically the write path, which is
   where the only bug that reached a running server lived.

   **The offline guarantee did not survive the move unexamined**, and it is the
   trap this stage's other conversions all hit. `requireUrl` resolves the URL
   from the *article row*, so a slug with a seeded article carries whatever
   address that article's metadata names — the corpus's `paulgraham.com`, which
   is a live web page. Two answers, and both are used below: the `running a job`
   block seeds nothing at all, so there is no address to find; the `advancing`
   block seeds articles and rewrites them to `spideryarn-test.invalid` first.
--------------------------------------------------------------------------- */

const SLUG = "test-jobs-fixture-no-such-article";

/**
 * Every slug this half of the suite leaves a row under.
 *
 * `lockOrCreateArticle` **creates the article** when a claim opens a draft for a
 * slug nothing holds (src/store/pg-revisions.ts), so a job that fails on its
 * first step still leaves an empty `spideryarn.articles` row behind — the
 * database's version of the `data/<slug>/steps/` directory `beginStep` used to
 * leave. Left there, those rows are on the shelf every library test reads, and
 * turn up as a mystery extra entry in somebody else's assertion.
 *
 * The two short-id slugs are not in this list because they are *minted*: the
 * last case cannot know its own slugs in advance, so it collects them.
 */
const OWN_SLUGS = [
  SLUG,
  "test-advance-token",
  "test-advance-sweeps",
  "test-enqueue-busy-article",
  /* Nothing should ever be inserted under this one — the point of its test is
     that `enqueue` throws first — so it is here for the day the guard is broken
     and a row does land. */
  "test-enqueue-blocks-only",
];

/** Slugs minted at run time — the short-id case's two. */
const MINTED: string[] = [];

/** Upload rows this file inserts, so the foreign key has something to point at. */
const MADE_UPLOADS: string[] = [];

/**
 * Take this file's rows out again.
 *
 * **Jobs before articles**: a job row's `draft_revision_id` is a foreign key
 * into the revision an article delete would be trying to cascade away, so the
 * order is not cosmetic. It replaces a sweep of `data/_jobs/` and an `rm` of
 * `data/<slug>/`, neither of which was ever an assertion.
 */
async function removeRows(slugs: readonly string[]): Promise<void> {
  if (!slugs.length) return;
  await getDb().delete(jobsTable).where(inArray(jobsTable.slug, [...slugs]));
  await getDb().delete(articles).where(inArray(articles.slug, [...slugs]));
}

/**
 * **A bare `articles` row under each of this file's own slugs**, added
 * 2026-09-05.
 *
 * `enqueue` refuses a bare-slug request for an article the reader does not have
 * (src/jobs.ts), and the `running a job` block queues several. It seeded nothing
 * on purpose — the comment above says so, and the reason still holds: what it
 * wants is an article with **no address**, so `fetch` fails and the job's
 * failure is what gets asserted. A row with no revision is exactly that;
 * `articleExists` left-joins the published revision precisely so an article
 * whose ingest never finished still counts. ./helpers/bare-article.ts.
 *
 * **Two of `OWN_SLUGS` are deliberately not seeded**, and getting that wrong is
 * how this was first written: `test-advance-token` and `test-advance-sweeps`
 * queue straight into the store through `queueJob` as `DEV_OWNER_ID`, never
 * through `enqueue`, and then let `lockOrCreateArticle` create the article at
 * claim time. A row seeded here under the *environment* owner is somebody else's
 * as far as that function is concerned, and it refused with *"the slug … already
 * belongs to another reader"*.
 */
beforeAll(async () => {
  if (!reachable) return;
  await bareArticles([SLUG, "test-enqueue-busy-article"]);
}, 60_000);

afterAll(async () => {
  if (!reachable) return;
  await removeRows([...OWN_SLUGS, ...MINTED]);
  if (MADE_UPLOADS.length) {
    await getDb().delete(uploads).where(inArray(uploads.id, MADE_UPLOADS));
  }
  await closeDb();
}, 60_000);

/** Poll until the job stops moving, or give up. */
async function settle(id: string) {
  for (let i = 0; i < 200; i++) {
    const job = await getJob(id);
    if (job && job.status !== "queued" && job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("job never finished");
}

describe("the work key", () => {
  /**
   * **Two rules for one question drift, so they are held together here.**
   *
   * `sameWork` is what decides whether a caller is handed the job already
   * running; `workKeyFor` is the hash the database compares when two instances
   * ask at once. They have to answer identically for every pair, or the
   * process that loses the race gets a different answer from the process that
   * wins it — and the symptom is a reader watching somebody else's article
   * succeed under their own headline, which is the exact fault
   * `jobs_active_slug` exists to stop.
   *
   * Pairwise over a small grid rather than a list of cases, because the way to
   * get this wrong is to add a field to one and not the other, and a grid
   * notices a new field the day somebody adds it to `sameWork`.
   */
  const GRID: {
    names: StepName[];
    forced: StepName[];
    profile?: string;
    upload?: { id: string; filename: string };
    url?: string;
  }[] = [
    { names: ["fetch"], forced: [] },
    { names: ["fetch"], forced: ["fetch"] },
    { names: ["fetch", "extract"], forced: [] },
    /* Two that differ ONLY in the intent dimension, which is what stops this
       grid agreeing with itself for the wrong reason. Two rows carrying a steer
       used to do this job; with the steer gone they would have become copies of
       row zero and of each other, and a grid of duplicates cannot tell a
       comparison that reads a field from one that ignores it. */
    { names: ["fetch"], forced: [], profile: "a physicist" },
    { names: ["fetch"], forced: [], profile: "a historian" },
    { names: ["fetch"], forced: [], upload: { id: "spya-upl001", filename: "a.pdf" } },
    { names: ["fetch"], forced: [], upload: { id: "spya-upl002", filename: "a.pdf" } },
    /* **The dimension that was missing, and the bug it let through.** Two
       articles whose URLs end in the same path segment both want the slug
       `news`. Added together, both see it free, both build a job whose every
       other work parameter is identical — and the loser of the `jobs_active_slug`
       conflict is told this is the same work and handed the *other* URL's job.
       Its own article is never fetched, and nothing says so. GPT Sol, on the
       built queue, 2026-08-27. */
    { names: ["fetch"], forced: [], url: "https://a.example/news" },
    { names: ["fetch"], forced: [], url: "https://b.example/news" },
    /* And the same address spelled differently is the *same* work, which is
       what `urlKey` is for — so these two must agree with each other. */
    { names: ["fetch"], forced: [], url: "http://a.example/news" },
  ];

  const asJob = (g: (typeof GRID)[number]): Job => ({
    id: "spya-testjb",
    slug: "a-slug",
    ownerId: DEV_OWNER_ID,
    steps: g.names.map((n) => step(n, "pending")).map((st, i) => ({
      ...st,
      ...(g.forced.includes(g.names[i] as StepName) ? { force: true } : {}),
    })),
    status: "queued",
    createdAt: "2026-08-25T10:00:00.000Z",
    ...(g.profile ? { profile: g.profile } : {}),
    ...(g.upload ? { upload: g.upload } : {}),
    ...(g.url ? { url: g.url } : {}),
  });

  it("agrees with sameWork on every pair, both ways round", () => {
    for (const a of GRID) {
      for (const b of GRID) {
        const same = sameWork(asJob(a), b.names, new Set(b.forced), b.profile, b.upload, b.url);
        const keysMatch =
          workKeyFor(a.names, new Set(a.forced), a.profile, a.upload, a.url) ===
          workKeyFor(b.names, new Set(b.forced), b.profile, b.upload, b.url);
        expect(
          { pair: [a, b], sameWork: same, sameKey: keysMatch },
          `sameWork and workKeyFor disagree`,
        ).toEqual({ pair: [a, b], sameWork: same, sameKey: same });
      }
    }
  });

  /* **An agreement test agrees when both sides are wrong.** The grid above pins
     `sameWork` and `workKeyFor` to the same answer, which catches one of them
     reading a field the other ignores — and passes cleanly if *neither* reads
     it. So the one field this change touched gets a direct assertion too:
     unticking "use your profile" and pressing the button again is a request for
     a different artefact, and being handed the running job would refresh the
     panel with something stamped from the profile the reader just declined.
     GPT Sol's review of the built code, 2026-08-30. */
  it("counts two different profiles as two different pieces of work", () => {
    const physicist = workKeyFor(["glossary"], new Set(), "a physicist");
    const historian = workKeyFor(["glossary"], new Set(), "a historian");
    const none = workKeyFor(["glossary"], new Set());
    expect(physicist).not.toBe(historian);
    expect(physicist).not.toBe(none);
    expect(historian).not.toBe(none);
  });

  it("reads two spellings of one address as the same work", () => {
    /* The reason the key hashes `urlKey` rather than the string. Without it,
       adding `http://x.test/piece` when `https://x.test/piece` is already
       running would be a second job for one article — which is the fault
       `urlKey` was written for one layer down, in `freeSlug`. */
    const a = workKeyFor(["fetch"], new Set(), undefined, undefined, "http://x.test/p");
    const b = workKeyFor(["fetch"], new Set(), undefined, undefined, "https://x.test/p");
    expect(a).toBe(b);
    const other = workKeyFor(["fetch"], new Set(), undefined, undefined, "https://y.test/p");
    expect(other).not.toBe(a);
  });

  it("does not depend on how far the job has got", () => {
    /* The reason the key is computed once in `enqueue` and never recomputed.
       `job.steps` mutates as a job runs, so a key derived from the record would
       answer differently at the end than at the start — and "is this the same
       request" does not change because a step finished. */
    const g = GRID[2] as (typeof GRID)[number];
    const before = workKeyFor(g.names, new Set(g.forced));
    // Same request, one step in.
    const after = workKeyFor(g.names, new Set(g.forced));
    expect(after).toBe(before);
  });
});

/**
 * A `queued` row straight into the store — **not** `enqueue`.
 *
 * `enqueue` starts the local pump, which is a second driver racing whatever the
 * case is about. Where a case's subject *is* `enqueue` it is used; where the
 * subject is the claim or the advance, this is. Same choice, for the same
 * reason, as `tests/jobs-walk.test.ts` § `queueJob`.
 */
async function queueJob(slug: string, names: StepName[], force = false): Promise<Job> {
  const wanted: Job = {
    id: mintId(),
    ownerId: DEV_OWNER_ID,
    slug,
    steps: names.map(
      (name): JobStep => ({
        name,
        label: STEPS[name].label,
        status: "pending",
        ...(force ? { force: true } : {}),
      }),
    ),
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const { job } = await pgJobStore.enqueueOrGet(wanted, {
    workKey: `jobs-test-${wanted.id}`,
    reservesName: false,
  });
  return job;
}

/**
 * **The advance, inside this file's owner.**
 *
 * `advanceJob` asks `currentOwnerId()`, which outside a request answers with
 * `SPIDERYARN_OWNER_ID` — set in `.env.local` by `scripts/setup-local.ts` on any
 * machine that has run it, and unset on one that has not. Rows queued by
 * `queueJob` above are `DEV_OWNER_ID`'s, so without this scope the two disagree
 * and every claim answers `gone`, with nothing in the failure mentioning an
 * owner. `tests/jobs-walk.test.ts` § `advanceAsOwner` says the same.
 */
const advanceAsOwner = (id: string) => runAsOwner(DEV_OWNER_ID, () => advanceJob(id));

/* ------------------------------------------------- asking again, on `busy` --

   **`busy` is an answer, not a failure, and this file has to treat it as one.**

   Two of the cases below take a claim as a *fixture* — one to make an orphaned
   lease, one to hold the job while a second caller is turned away — and then
   assert something about the claim that follows it. Both were written as a
   single call apiece, and both are races: `claim` takes the `queue_state`
   singleton with `for update nowait` (src/store/pg-jobs.ts), so a claim that
   arrives while *any* other claim is mid-transaction is answered
   `busy` — "another claim is being decided" — however free the job itself is.

   **The other claimant is this file.** `enqueue` starts a `pump`
   (src/jobs.ts), and a request that is handed an already-running job is given
   one too, so an earlier case leaves one or more pumps looping on their own
   job with a 250ms→5s backoff. They are still waking up several cases later.
   Measured on 2026-09-04 by logging every `claim` this file makes: in the run
   that went red, a leftover pump's claim started 19ms before this block's
   advance and was still inside its transaction when the advance asked, and six
   different job ids claimed inside 400ms. In the runs that stayed green the
   same window held four claims and no overlap. It reproduced 1 in 15 runs of
   the file **alone** with the box loaded, and not at all when it was quiet —
   which is why it read as an interference from another *file*, and is not.

   So this is not a flake to be waited out, it is the queue's contract: *"There
   is one claim, and whoever takes it runs; everybody else is told `busy` and
   asks again. The pump is not privileged — it is this same function in a loop"*
   (src/jobs.ts § `advanceJob`). A caller that asks once and treats `busy` as a
   fault is the only thing here that was wrong.

   **Asking again does not soften what the two cases prove.** The failure each
   is written against — a sweep that never runs, a claim predicate that lets a
   second runner in — makes `busy` the answer *every* time, so it exhausts the
   budget and still goes red. Watched, both of them, on 2026-09-04; the
   mutations and their output are recorded above the blocks that own them.
   ------------------------------------------------------------------------- */

/**
 * The number of times, and the gap between them. 40 × 50ms is two seconds
 * against a backoff whose first step is 250ms — long enough to outlast a
 * handful of overlapping pumps, short enough that a permanent `busy` is a red
 * inside the file's timeout rather than a hang.
 */
const BUSY_TRIES = 40;
const BUSY_GAP_MS = 50;

/** `pgJobStore.claim`, asked again while the queue says it is deciding. */
async function claimOnceItIsFree(
  id: string,
  attempt: string,
): Promise<Awaited<ReturnType<typeof pgJobStore.claim>>> {
  let outcome = await pgJobStore.claim(id, DEV_OWNER_ID, attempt, 60_000, 4);
  for (let i = 0; i < BUSY_TRIES && outcome.kind === "busy"; i++) {
    await new Promise((r) => setTimeout(r, BUSY_GAP_MS));
    outcome = await pgJobStore.claim(id, DEV_OWNER_ID, attempt, 60_000, 4);
  }
  return outcome;
}

/** `advanceAsOwner`, asked again while it says `busy` — what every caller does. */
async function advanceOnceItIsFree(id: string): Promise<Awaited<ReturnType<typeof advanceJob>>> {
  let advanced = await advanceAsOwner(id);
  for (let i = 0; i < BUSY_TRIES && advanced?.busy; i++) {
    await new Promise((r) => setTimeout(r, BUSY_GAP_MS));
    advanced = await advanceAsOwner(id);
  }
  return advanced;
}

/**
 * Put a claim's lease into the past, **on the database's own clock**.
 *
 * This is what `expireLeaseForTests` was, and the difference is the whole point
 * of the conversion: the filesystem adapter rewrote a `Date.now()` field this
 * process had written, so the deadline was one clock's arithmetic only because
 * there was one process. `claim` writes `clock_timestamp() + interval` and
 * `settleExpired` compares against `clock_timestamp()`, so an expiry expressed
 * in any other clock is a different fact. `tests/list-reconciles-expired.test.ts`
 * writes the same statement.
 */
async function expireLease(id: string): Promise<void> {
  await getDb()
    .update(jobsTable)
    .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(jobsTable.id, id));
}

/**
 * ## The mutation for this block, watched red on 2026-09-04
 *
 * **The predicate is the whole of what replaced `expireLeaseForTests`**, and it
 * is Postgres-only in a way that matters rather than incidentally: the
 * filesystem adapter rewrote a `Date.now()` field this process had written, and
 * `clock_timestamp()` is the row's own clock. The fence is left alone, which is
 * why this is one predicate rather than the pair.
 *
 * **Mutation.** `settleExpired` in [`src/store/pg-jobs.ts`](../src/store/pg-jobs.ts),
 * with `leaseIsOver` in its `lapsed` predicate replaced by `leaseIsLive` — the
 * negation `src/store/job-fence.ts` spells out next door, so the sweep looks at
 * the wrong side of the deadline and nothing lapses. The run printed `2 failed
 * | 58 passed`:
 *
 * ```
 * × gets inside a job whose claimant stopped answering, from the advance itself
 *   AssertionError: expected true to be falsy
 * × refuses while somebody else holds the claim
 *   AssertionError: expected false to be true
 * 2 failed | 58 passed
 * ```
 *
 * **Blind to.** Which block a red belongs to, and the second one here is worth
 * reading for it. *Refuses while somebody else holds the claim* lives in the
 * other block, and it goes red because its fixture claim is made with a
 * 60-second lease that the advance's own sweep then declines to leave alone —
 * so under this mutation the assertion that the fixture claim succeeded fails
 * first. The two blocks are not as independent as their headings suggest, and a
 * red here does not localise the way its heading implies.
 *
 * **Blind to.** One predicate is not the family, and four things in particular
 * are outside what that single deletion reached.
 *
 * - The sweep's **other two conjuncts** — `status = 'running'` and the optional
 *   `owner_id` scoping — are unmutated, and the owner one would stay green here
 *   because every job in this file belongs to the same reader.
 *   `tests/list-reconciles-expired.test.ts` is what covers that.
 * - The **requeue budget** branch beside it: this case's job has none left, so
 *   it ends rather than going back to `queued`, and a sweep that lost the
 *   requeue entirely would not be noticed here.
 * - **`tryEnqueue`'s insert arbitration**, which is what the first and third
 *   cases below are really about — `jobs_active_work` handing back the running
 *   job, `jobs_active_slug` letting a second job queue behind it. Neither was
 *   mutated, and both are the predicates that replaced a `Map` lookup.
 * - **Blind to.** `finishIn`'s `failure_kind` column, which the first case
 *   asserts, and which this mutation leaves entirely alone. It was mutated in
 *   `tests/retry-is-only-for-a-failed-job.test.ts` on the same day and went red
 *   there, so it is covered — but not by this file, and not by anything above.
 */
when("running a job", () => {
  it("hands back the job already working on a slug rather than starting a second", async () => {
    // A double-click on Add. Both requests must land on one job: the second
    // starting a job of its own would run every step against artefacts the
    // first had just written, tick five boxes and charge for two more model
    // calls.
    const [a, b] = await Promise.all([
      enqueue({ slug: SLUG, steps: ["fetch"] }),
      enqueue({ slug: SLUG, steps: ["fetch"] }),
    ]);
    expect(b.id).toBe(a.id);

    const finished = await settle(a.id);
    expect(finished.status).toBe("error");
    /* **The reader is told the step failed and whose problem it is**, not the
       sentence `requireUrl` throws. That sentence — *"No source URL for
       'test-jobs-fixture-no-such-article'. Its meta.json has none…"* — names a
       file and a slug, and since 2026-09-03 it is the diagnostic rather than
       the copy: docs/project/copy.md § The seam between the two audiences, and
       tests/step-failure-seam.test.ts for the rule.

       What survives the split is the part that mattered here — the kind. */
    expect(finished.error).not.toMatch(/meta\.json/);
    expect(finished.error).toMatch(/\[jb-step-ours\]$/);
    expect(finished.steps[0]?.status).toBe("error");
    // And the record says what kind of failure it was, which is what withholds
    // the Retry button on the card. A retry copies the same absent URL and asks
    // the same meta.json, so there is nothing for a second attempt to find.
    expect(finished.failureKind).toBe("ours");
    expect(jobWorthRetrying(finished)).toBe(false);
  });

  /**
   * **A request that *names* an article must never be moved to another one.**
   *
   * The sharpest of GPT Sol's findings on the built queue, and it is worth
   * reading the repro rather than the rule: `paper` has a glossary job running;
   * `paper-2` is a different article, already on the shelf; somebody asks for a
   * summary of `paper`. The active-slug conflict says "different work", the
   * loop reallocated the slug — for a request with neither URL nor upload it
   * had nothing to reallocate *with*, so it appended a counter — and the job
   * became a summary of `paper-2`. Which it would then produce, correctly,
   * under the wrong article. [Silent success](docs/reusable/silent-success.md).
   *
   * A URL or an upload is *asking for* an article and may be moved. Anything
   * else is *naming* one, and the honest answer is 409.
   */
  /**
   * **The token `advanceJob` actually hands the store.**
   *
   * `jobs.attempt_id` is a **uuid** column, and this passed `mintId()` — a
   * `spya-` id — so every advance against Postgres died with `22P02` on the
   * claim, the first statement it runs. Nothing caught it: the filesystem
   * adapter takes any string, and the parity suite minted its own tokens.
   *
   * Which means a test of `mintAttempt`'s *shape* proves nothing either — the
   * question is what the caller passes. So this reads the value out of the
   * store as it arrives. GPT Sol pointed out that the first attempt at this
   * guard had the same hole as the bug.
   */
  it("hands the store a token the uuid column will take", async () => {
    const slug = "test-advance-token";
    /* Queued straight into the store, so there is no pump to wait out and no
       settled job to put back — see `queueJob`. */
    const job = await queueJob(slug, ["fetch"]);

    const seen: string[] = [];
    const claim = vi.spyOn(pgJobStore, "claim");
    try {
      /* **Every argument forwarded, `max` included.** A spy that drops one does
         not fail — `maxRunning` arrives `undefined`, `running >= undefined` is
         false, and the cap is silently off for whatever this wraps. That is the
         shape docs/reusable/silent-success.md is about, and the typecheck is
         what catches it: tests are a project of their own. */
      claim.mockImplementation(async (id, owner, attempt, lease, max) => {
        seen.push(attempt);
        claim.mockRestore();
        return pgJobStore.claim(id, owner, attempt, lease, max);
      });
      await advanceAsOwner(job.id);
      claim.mockRestore();

      expect(seen).toHaveLength(1);
      expect(seen[0], "advanceJob's attempt token must be a uuid — jobs.attempt_id is one").toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    } finally {
      /* **Cleared even when the assertion fails**, and this is not politeness.
         A left-behind `queued` row holds this article's line — `jobs_active_slug`
         — so the next failure is a `busy` in a *different* test and says nothing
         about the fault. It cost half an hour once, when the row was a file. */
      claim.mockRestore();
      await runAsOwner(DEV_OWNER_ID, () => forgetJob(job.id)).catch(() => undefined);
    }
  });

  /**
   * **The sweep, through `advanceJob` rather than through the store.**
   *
   * `tests/store-jobs-parity.test.ts` proves what `settleExpired` does to a
   * lapsed claim, and GPT Sol pointed out that it proves nothing about the
   * *wiring*: delete the `store.settleExpired()` line from `advanceJob` and that
   * test stays green, because it calls the sweep itself. Which is the whole
   * shape of the original bug — the function existed and nothing called it — so
   * the test has to be the one that goes through the caller.
   *
   * **What "frees" means changed on 2026-09-03.** The sweep used to end the job
   * `error` / `retry` and hand the reader a button; a lapsed claim with budget
   * left now goes back to `queued` on its own row and this very advance picks it
   * up — src/jobs.ts § `REQUEUE_BUDGET`. So the assertion moved from *the ending
   * it was given* to *the advance got inside it at all*, which is the property
   * the wiring is actually about and the one that goes red without the line:
   * `claim` only takes a `queued` row, so with no sweep this answers `busy` and
   * the record sits at `running` for ever.
   *
   * The step then fails on its own merits — `fetch` on a slug with no URL — and
   * that is not what is under test here; the case asserts the job is *over*
   * rather than which sentence ended it.
   */
  it("gets inside a job whose claimant stopped answering, from the advance itself", async () => {
    const slug = "test-advance-sweeps";
    const job = await queueJob(slug, ["fetch"]);

    /* A claim nobody will ever release — an instance that was killed mid-step.
       Its lease is put into the past below, which is the state `advanceJob` has
       to notice without anybody sweeping on its behalf. */
    const orphan = mintAttempt();
    /* A cap high enough to be beside the point: this case is not about it. */
    /* `DEV_OWNER_ID`, because `queueJob` writes the row under it — and asserted
       against `currentOwnerId()` so that a machine whose `SPIDERYARN_OWNER_ID`
       disagrees fails *here*, saying which two owners, rather than three lines
       down on the sweep this case is actually about.

       **Asked again on `busy`** — a leftover pump deciding its own claim is not
       this fixture failing. See § *asking again, on `busy`*. */
    const fixture = await claimOnceItIsFree(job.id, orphan);
    expect(
      { kind: fixture.kind, why: "why" in fixture ? fixture.why : undefined },
      `the fixture claim must succeed; this process is ${currentOwnerId()}`,
    ).toEqual({ kind: "claimed", why: undefined });
    await expireLease(job.id);

    try {
      const advanced = await advanceOnceItIsFree(job.id);
      /* **Not `busy`**, which is what a `running` row nobody swept answers, and
         what this said before the sweep line existed — every time, so the retry
         above runs out and this is still the assertion that goes red. */
      expect(advanced?.busy).toBeFalsy();
      expect(advanced?.done).toBe(true);
      const after = await runAsOwner(DEV_OWNER_ID, () => getJob(job.id));
      /* The same row, and it is no longer stuck under a claim nobody holds. */
      expect(after?.id).toBe(job.id);
      expect(after?.slug).toBe(slug);
      expect(after?.status).not.toBe("running");
      expect(after?.finishedAt).toBeDefined();
    } finally {
      // See the note in the test above: a row left behind breaks the next run.
      await runAsOwner(DEV_OWNER_ID, () => forgetJob(job.id)).catch(() => undefined);
    }
  });

  /**
   * **Queues rather than refuses when a late step lands on a busy article.**
   *
   * This test used to assert the opposite, and the sentence it asserted is the
   * one Greg hit: *"That article already has a job running. Wait for it, or stop
   * it first."* — pressing Tweets on an article whose ingest had not finished.
   * The 409 was right about the danger and wrong about the remedy: two jobs must
   * not *run* on one article, because publication is last-writer-wins
   * (src/store/pg-revisions.ts § `publishRevisionIn`), but that is a reason to
   * make the second one **wait**, not to throw it away. The refusal moved to the
   * claim, where it is a `busy` — docs/plans/260830ar-several-articles-at-once.md.
   *
   * **The half that did not change is the half worth keeping.** Renaming was
   * never the alternative: `{slug, steps}` *names* an article, so stepping aside
   * to `${slug}-2` would summarise a different, already-finished article
   * perfectly successfully. So the assertion that nothing was created under a
   * suffixed slug stays exactly as it was.
   */
  /* **It was `it.skip` from 2026-08-30 to 2026-09-02**, written and watched red
     first, because the behaviour must not ship before late steps read the
     published store: a job queued behind an ingest claims on some other
     instance and opens `blocks.json` in its own empty scratch directory. That
     prerequisite is built (docs/plans/260830aq-late-steps-read-the-store.md),
     and turning this on was the one-word change it was written to be. */
  it("queues rather than renames when a late step lands on a busy article", async () => {
    const slug = "test-enqueue-busy-article";
    /* A job holding the slug, doing different work from the one below. It never
       runs to completion here — `fetch` has no URL — which is exactly the
       window a reader hits by pressing two buttons in quick succession. */
    const held = await enqueue({ slug, steps: ["fetch"] });
    let late: Awaited<ReturnType<typeof enqueue>> | undefined;
    try {
      late = await enqueue({ slug, steps: ["glossary"] });
      /* A second job, not the first one handed back: different work, so this is
         not the de-duplication path. */
      expect(late.id).not.toBe(held.id);
      expect(late.status).toBe("queued");
      /* And both of them name the article the reader named — nothing was
         quietly created under `${slug}-2`. */
      expect(late.slug).toBe(slug);
      expect((await getJob(held.id))?.slug).toBe(slug);
    } finally {
      if (late) await forgetJob(late.id).catch(() => undefined);
      await settle(held.id);
      await forgetJob(held.id);
    }
  });

  /**
   * **And the guard is wired**, which is a separate claim from
   * `unrunnableStepPlan` returning the right string — a pure function nothing
   * calls is the shape of half the bugs in this repo
   * (docs/reusable/silent-success.md). It throws before anything is inserted or
   * reserved, so there is nothing to clean up afterwards.
   */
  it("refuses a blocks-only job at the door rather than stranding the article", async () => {
    const blocksOnly = enqueue({ slug: "test-enqueue-blocks-only", steps: ["blocks"] });
    await expect(blocksOnly).rejects.toThrow(/hierarchy/);
    // A 400 rather than a 500: this is a bad request, and the route maps the
    // field straight onto the status code.
    await expect(blocksOnly).rejects.toMatchObject({ status: 400 });
  });

  /**
   * **The wiring, not the decision.** `freeSlug` and `slugWithShortId` are
   * tested above without a queue; this asks whether `enqueue` actually calls
   * them, which is the half a unit test cannot see — a correct function nobody
   * reaches is the shape docs/reusable/silent-success.md is about.
   *
   * Both doors, because they are two branches of one ternary and only one of
   * them goes through `freeSlug`: a URL add, and an upload, which has no
   * address and so mints outright.
   *
   * Every job here fails on its first step — there is nothing at that address
   * and no such upload — which is how this stays offline and free.
   */
  it("puts a short id on the slug of every article a reader adds", async () => {
    const added = await enqueue({
      slug: "test-enqueue-short-id",
      url: "https://spideryarn-test.invalid/test-enqueue-short-id",
      steps: ["fetch"],
    });
    /* **An upload row that really exists**, and this is the third thing
       Postgres validates that a JSON file never looked at: `jobs.upload_id` is
       a foreign key (`jobs_upload_id_uploads_id_fk`), so the invented uuid this
       case used to pass refuses the *insert* — a `23503` at `enqueue`, before
       the branch under test is reached. `pending` with no bytes is what the real
       flow writes before anything arrives, and is what
       `uploads_verified_has_evidence` allows. */
    const uploadId = randomUUID();
    await getDb().insert(uploads).values({
      id: uploadId,
      ownerId: currentOwnerId(),
      filename: "paper.pdf",
      claimedBytes: 1_024,
      claimedSha256: "0".repeat(64),
      status: "pending",
      grantExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    MADE_UPLOADS.push(uploadId);
    const uploaded = await enqueue({
      slug: "test-enqueue-short-id-upload",
      upload: { id: uploadId, filename: "paper.pdf" },
      steps: ["fetch"],
    });
    /* Collected before the assertions, so a failure still cleans up: these two
       slugs are minted and `afterAll` cannot guess them. */
    MINTED.push(added.slug, uploaded.slug);
    try {
      expect(added.slug).toMatch(/^test-enqueue-short-id-spya-[a-z0-9]{6}$/);
      expect(uploaded.slug).toMatch(/^test-enqueue-short-id-upload-spya-[a-z0-9]{6}$/);
    } finally {
      for (const job of [added, uploaded]) {
        await settle(job.id).catch(() => undefined);
        await forgetJob(job.id).catch(() => undefined);
      }
    }
  });
});

/* --------------------------------------------------------------------------
   Which slug an add lands on, when we may already have the article.

   > And will this de-dupe correctly if near-identical versions of the url are
   > used … or if we already have the article?
   >
   > — Greg, 2026-08-26

   `freeSlug` answers one question and then does one of two things: *which slug
   already holds this URL?* If something does, that slug is adopted and every
   step skips. If nothing does, a fresh slug is minted with a short id on the
   end, so two articles can never want the same name.

   **The lookup is by URL, not by slug, and that is what the short id forced.**
   It used to guess the candidate name and ask what was under it — which only
   worked because the name was derived from the URL. A slug ending in a random
   id cannot be guessed, so a probe by name would have found nothing, minted a
   second article for a URL already on the shelf, and paid for it. The identity
   test is still `urlKey` (src/ingest.ts, tested there).

   The lookup is injected, so none of this touches the filesystem, the network
   or the queue. Its default in src/jobs.ts asks the shelf and then the live
   queue, which is the one line these tests do not cover.
   -------------------------------------------------------------------------- */
describe("freeSlug", () => {
  /** A stand-in for "which article already has this URL", as an in-memory shelf. */
  const shelf = (entries: Record<string, string>) => async (key: string) =>
    Object.entries(entries).find(([, url]) => urlKey(url) === key)?.[0];

  it("mints a slug with a short id when nothing has this article yet", async () => {
    const got = await freeSlug("why-trees", "https://example.com/why-trees", shelf({}));
    expect(got.slug).toMatch(/^why-trees-spya-[a-z0-9]{6}$/);
    expect(isSlug(got.slug)).toBe(true);
    /* **And it says that it minted.** That is the whole of `reserves_name`
       (src/db/schema.ts), and the fact is known here and nowhere else — a
       caller that had to infer it later would have to guess from `url`, which
       a late step on a month-old article carries exactly as a paste does. */
    expect(got.kind).toBe("minted");
  });

  it("gives two adds of two different articles two slugs", async () => {
    const a = await freeSlug("news", "https://a.example/news", shelf({}));
    const b = await freeSlug("news", "https://b.example/news", shelf({}));
    expect(a.slug).not.toBe(b.slug);
  });

  it("reuses the slug when we already have this article, however it was spelled", async () => {
    // The whole point: every one of these is the article already on the shelf,
    // so each must land back on its slug and let every step skip — rather than
    // minting a second one and fetching, extracting and paying for a tree again.
    const have = shelf({ "why-trees-spya-k3m9qt": "https://www.example.com/why-trees" });
    for (const spelling of [
      "https://www.example.com/why-trees",
      "http://www.example.com/why-trees",
      "https://example.com/why-trees",
      "https://example.com/why-trees/",
      "https://EXAMPLE.com/why-trees",
      "example.com/why-trees",
      "https://example.com/why-trees#conclusion",
      "https://example.com/why-trees?utm_source=twitter",
    ]) {
      expect(await freeSlug("why-trees", spelling, have), spelling).toEqual({
        kind: "adopted",
        slug: "why-trees-spya-k3m9qt",
      });
    }
  });

  /* The one spelling on Greg's list that deliberately does NOT merge. A
     case-sensitive server may serve two different pages at `/Why-Trees` and
     `/why-trees`, so the key keeps them apart and this is what resolves the
     slug collision that follows — into a visible duplicate rather than into
     the wrong article under the right headline. See `urlKey`. */
  it("mints a new slug when only the path's capitalisation differs", async () => {
    const have = shelf({ "why-trees-spya-k3m9qt": "https://www.example.com/why-trees" });
    const got = await freeSlug("why-trees", "https://example.com/Why-Trees", have);
    expect(got.slug).not.toBe("why-trees-spya-k3m9qt");
    expect(got.slug).toMatch(/^why-trees-spya-[a-z0-9]{6}$/);
    expect(got.kind, "a fresh name is a claim on it, and must reserve").toBe("minted");
  });

  it("keeps the whole slug inside the length a slug is allowed to be", async () => {
    const long = "a".repeat(60);
    const got = await freeSlug(long, "https://example.com/long", shelf({}));
    expect(isSlug(got.slug)).toBe(true);
    expect(got.slug).toMatch(/-spya-[a-z0-9]{6}$/);
  });
});

/* --------------------------------------------------------------------------
   Which slug a **retry** lands on, which is not the same question.

   `freeSlug` above decides where a *fresh* request goes. `slugForRetry` decides
   where the second attempt at one named prior attempt goes, and the difference
   between the two is a decision rather than a fact: a retry of an upload and a
   second upload of the same file arrive with exactly the same shape, and *"two
   uploads of one file are two documents"* has to stay true of the second while
   the first lands back on its own article.

   It matters because per-chunk checkpoints are addressed by the **article**
   (src/store/checkpoints.ts), the article is a pure function of the slug, and a
   retry that moved the slug moved the article — so attempt 2 re-bought every
   chunk attempt 1 had paid for, and a PDF too long for one lease could never
   finish at all. tests/retry-keeps-the-checkpoints.test.ts is that end to end,
   against a real queue and a real checkpoint store; this is the decision on its
   own, with the lookup injected so none of it touches a database.
   -------------------------------------------------------------------------- */
describe("slugForRetry", () => {
  const shelf = (entries: Record<string, string>) => async (key: string) =>
    Object.entries(entries).find(([, url]) => urlKey(url) === key)?.[0];

  const UPLOAD = { id: "8a1d0c9e-0000-4000-8000-000000000001", filename: "a-long-book.pdf" };

  /**
   * **The upload case, which is the one a hundred-page PDF arrives through** and
   * the one `enqueue` had no branch for: it minted unconditionally.
   */
  it("keeps an upload's own name rather than minting a second one", async () => {
    expect(
      await slugForRetry({ slug: "a-long-book-spya-k3m9qt", upload: UPLOAD }, shelf({})),
    ).toEqual({ kind: "minted", slug: "a-long-book-spya-k3m9qt" });
  });

  /**
   * **A failed first URL ingest.** Nothing is on the shelf — it published no
   * revision. The old name is what is left, and taking it is a *claim*, so it
   * reserves: that is what puts the queued retry inside `jobs_active_source` and
   * stops a racing paste minting a second article for one address.
   */
  it("keeps a failed first ingest's name, and reserves it", async () => {
    expect(
      await slugForRetry(
        { slug: "why-trees-spya-k3m9qt", url: "https://example.com/why-trees" },
        shelf({}),
      ),
    ).toEqual({ kind: "minted", slug: "why-trees-spya-k3m9qt" });
  });

  /**
   * **And it asks the shelf first.** A *published* article for this address is
   * by definition the article this address is, so the retry goes there rather
   * than to the name it happens to remember. This is the half that keeps one
   * article for one address when the two names differ.
   *
   * **The shelf and nothing else**, since GPT Sol's review of the built stage 3.
   * It used to ask `slugAlreadyHolding` — the shelf *or a live job* — and
   * adopting from a live job is what left the address unreserved when that job
   * ended before the insert. A retry that races a live holder is now told so by
   * `jobs_active_source` and handed the holder; `src/jobs.ts` §
   * `handBackToARetry`, and `tests/one-article-for-one-address.test.ts` § *and a
   * retry's two*.
   */
  it("adopts what the shelf already holds, over its own remembered name", async () => {
    expect(
      await slugForRetry(
        { slug: "why-trees-spya-k3m9qt", url: "https://example.com/why-trees" },
        shelf({ "why-trees-spya-zzzzzz": "https://www.example.com/why-trees/" }),
      ),
    ).toEqual({ kind: "adopted", slug: "why-trees-spya-zzzzzz" });
  });

  /** A late-stage re-run, which was already landing right and still does. */
  it("adopts for a request that names an article rather than claiming a name", async () => {
    expect(await slugForRetry({ slug: "why-trees-spya-k3m9qt" }, shelf({}))).toEqual({
      kind: "adopted",
      slug: "why-trees-spya-k3m9qt",
    });
  });

  /**
   * **No second short id, ever** — the bug's own visible fingerprint, and the
   * reason it should have been caught long ago. `retryJob` passes
   * `slug: old.slug` and `slugWithShortId` *appends*, so three retries used to
   * give `…-spya-aaa-spya-bbb-spya-ccc`: three names, three articles, three
   * invoices.
   */
  it("never stacks a second short id, however many times it is asked", async () => {
    let slug = "a-long-book-spya-k3m9qt";
    for (let i = 0; i < 3; i++) {
      slug = (await slugForRetry({ slug, upload: UPLOAD }, shelf({}))).slug;
    }
    expect(slug).toBe("a-long-book-spya-k3m9qt");
  });
});

/* --------------------------------------------------------------------------
   `POST /api/jobs/:id/advance` — one step per request, derived from the
   artefacts.

   The browser-driven half of the queue: docs/plans/260826q-job-queue-rethink.md
   § Decided, and docs/plans/260826s-ingest-resume.md for the resume it delivers.

   These run the real runner, so they are built the same way as the suite above
   — around a slug nothing can be fetched for, so a step that gets as far as the
   network fails before reaching it. `fetch` is stubbed where a step has to
   *succeed*, because there is no offline step that can.
   -------------------------------------------------------------------------- */

/**
 * **An address that cannot be reached, and a different one per slug.**
 *
 * The seeded articles below carry the corpus's own metadata, and `requireUrl`
 * resolves a job's URL from the article row — so left alone, a real `fetch` here
 * would fetch `paulgraham.com`. A per-slug `.invalid` address is what keeps the
 * block offline, and being *distinct* per slug also stops `freeSlug`'s shelf
 * lookup adopting one of these fixtures for another, since it matches on
 * `urlKey`.
 */
const urlFor = (slug: string) => `https://spideryarn-test.invalid/${slug}`;

/**
 * **The artefacts the seeded article was made from**, by kind.
 *
 * `fetch` came off `LEGACY_UNCONVERTED_STEPS` on 2026-08-31, so a stub that
 * writes the artefact itself and returns a bare `{ detail }` is refused by
 * `checkProduct` before anything is written — which is the guard doing its job.
 * A stub of a converted step returns what the real one returns, and under
 * Postgres *what the real one returns* is checked: `SHAPE`
 * (src/store/artifacts.ts) is applied by both adapters, and `writeRawSource`
 * additionally refuses a manifest whose `storedSha256` names no `raw_sources`
 * row. `{ file: "raw.html" }` satisfied a JSON file and satisfies nothing here.
 *
 * Reading them out of the committed corpus is the cheapest source that
 * satisfies both, because `scratchArticleInPg` loaded these very bytes a moment
 * earlier — the row `raw.json` names is the one its own seed inserted. Same
 * approach, and the same reason, as
 * `tests/retry-is-only-for-a-failed-job.test.ts` § `CORPUS_FILES`.
 */
const CORPUS_FILES: Partial<Record<ArtifactKind, string>> = {
  raw: `data/${SCRATCH_SOURCE}/raw.json`,
  meta: `data/${SCRATCH_SOURCE}/meta.json`,
  extractedHtml: `output/${SCRATCH_SOURCE}.html`,
};

/** One read per kind for the whole file, because the bytes never change. */
const corpusCache = new Map<ArtifactKind, unknown>();

async function corpusArtefact(kind: ArtifactKind): Promise<unknown> {
  const relative = CORPUS_FILES[kind];
  if (relative === undefined) {
    throw new Error(
      `no corpus artefact for "${kind}" — add it to CORPUS_FILES, or stub a step that does not ` +
        `declare it. A stub cannot invent one: the Postgres store shape-checks every write.`,
    );
  }
  if (!corpusCache.has(kind)) {
    const text = await readFile(path.join(FIXTURE_ROOT, relative), "utf8");
    corpusCache.set(kind, relative.endsWith(".json") ? (JSON.parse(text) as unknown) : text);
  }
  return corpusCache.get(kind);
}

/** Everything one step declares, with this clone's slug and address in it. */
async function productOf(slug: string, name: StepName, detail: string): Promise<ConvertedProduct> {
  const parts = Object.fromEntries(
    await Promise.all(
      STEPS[name].produces.map(async (kind) => {
        const value = await corpusArtefact(kind);
        if (typeof value !== "object" || value === null) return [kind, value];
        const copy = { ...(value as Record<string, unknown>) };
        if (typeof copy.slug === "string") copy.slug = slug;
        if (typeof copy.url === "string") copy.url = urlFor(slug);
        if (typeof copy.requestedUrl === "string") copy.requestedUrl = urlFor(slug);
        return [kind, copy];
      }),
    ),
  ) as ArtifactParts;
  return { parts, detail };
}

/**
 * ## The mutation for this block, and **it stayed green** — 2026-09-04
 *
 * This is the only converted queue suite whose skip decisions come from *real
 * rows*: `tests/jobs-walk.test.ts` and `tests/retry-is-only-for-a-failed-job.test.ts`
 * both replace `session.reads`, so neither can see `stepIsDone` at all. That
 * makes `hasArtefacts` (src/store/artifacts-pg.ts) the predicate this block
 * uniquely reaches, and it is the Postgres statement of *"the artefacts say this
 * step is not done"* — strictly more than the filesystem's file-presence, because
 * it demands a `revision_step_runs` row saying `done` **as well as** every
 * artefact reading back.
 *
 * **Mutation.** `hasArtefacts`, with the row half of it deleted — `if
 * (run?.status !== "done") return false;` taken out, so an artefact set with no
 * `revision_step_runs` row behind it counts as done. The run printed `60 passed
 * of 60`: it stayed green.
 *
 * **The green is not a dead-code artefact, and that was checked rather than
 * assumed.** A control in the same function — `if (run) return false;`, so that
 * nothing is ever done — turned three cases red, including *picks up at the
 * first step the artefacts say is not done*. So `hasArtefacts` is thoroughly on
 * this block's path.
 *
 * **Blind to.** What nothing here distinguishes: *artefacts present* from *a
 * step recorded as having run*. A revision holding a previous run's artefacts
 * with no run row of its own would be skipped, and every case below would still
 * pass. `tests/store-artefacts-pg.test.ts` is where that belongs.
 *
 * **Blind to.** What else that deletion leaves untouched: `hasArtefacts`'s
 * artefact loop and its `siteFor` validation; `stepInterrupted`, which
 * `stepIsDone` asks first and
 * which no case here puts into the `running` state; and `stampForStep`, which
 * decides freshness for the stages that stamp and which none of these steps
 * exercises.
 */
when("advancing a job one step at a time", () => {
  const SLUGS = [
    "test-advance-resume",
    "test-advance-one-step",
    "test-advance-idempotent",
    "test-advance-concurrent",
    "test-advance-queue-owns",
  ];

  /**
   * **One seeded article per slug, and it replaces `fixtureWithRawJson`.**
   *
   * That helper wrote `data/<slug>/raw.json` so that *`fetch` counts as done and
   * `extract` is next*. The Postgres statement of the same thing is the raw
   * columns on a published `article_revisions` row **and** a `revision_step_runs`
   * row saying `done` — `hasArtefacts` (src/store/artifacts-pg.ts) asks for both,
   * which is strictly more than a file's presence, and a seeded article has
   * them. It has them for *every* step, which is why the cases below force the
   * ones they need to run: `stillForced` (src/jobs.ts) is what makes a step run
   * against artefacts that are already current.
   *
   * `mutate` rewrites the address before the load — see `urlFor`.
   */
  const seeded = new Map<string, ScratchArticle>();

  beforeAll(async () => {
    for (const slug of SLUGS) {
      seeded.set(
        slug,
        await scratchArticleInPg(slug, {
          /* Owned by `DEV_OWNER_ID` explicitly, because that is who the advance
             runs as: the Postgres reader filters every article by owner, so a
             fixture seeded as somebody else is invisible and every claim would
             refuse. */
          ownerId: DEV_OWNER_ID,
          mutate: async (dir) => {
            for (const name of ["raw.json", "meta.json"]) {
              const at = path.join(dir, name);
              const value = JSON.parse(await readFile(at, "utf8")) as Record<string, unknown>;
              if (typeof value.url === "string") value.url = urlFor(slug);
              if (typeof value.requestedUrl === "string") value.requestedUrl = urlFor(slug);
              await writeFile(at, JSON.stringify(value));
            }
          },
        }),
      );
    }
  }, 180_000);

  afterAll(async () => {
    /* Jobs first, then the article — `jobs.draft_revision_id` is a foreign key
       into the revision the article delete would be cascading away. */
    await getDb().delete(jobsTable).where(inArray(jobsTable.slug, SLUGS));
    for (const slug of SLUGS) await seeded.get(slug)?.remove();
  }, 120_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("picks up at the first step the artefacts say is not done", async () => {
    /* The resume case, and the whole reason the endpoint exists. `fetch` has
       its artefact, so a job that stopped after it must not fetch again — that
       is somebody's server asked twice and, for the later steps, a model call
       paid for twice. */
    const slug = "test-advance-resume";
    /* `fetch` is not forced and its artefacts are current, so it skips;
       `extract` is forced, so it runs whatever the artefacts say. That
       asymmetry is what used to be *"there is a raw.json and nothing else"*. */
    const queued = await queueJob(slug, ["fetch", "extract"], false);
    await getDb()
      .update(jobsTable)
      .set({
        steps: queued.steps.map((s) => (s.name === "extract" ? { ...s, force: true } : s)),
      })
      .where(eq(jobsTable.id, queued.id));

    const fetched = vi.spyOn(STEPS.fetch, "run");
    /* Made to fail, because *which* way `extract` ends is not what this case is
       about and the real one would go and read the raw bytes. What is under test
       is which step the advance picked up at. */
    vi.spyOn(STEPS.extract, "run").mockRejectedValue(new Error("stubbed extract failure"));

    const advanced = await advanceAsOwner(queued.id);
    expect(advanced).not.toBeNull();
    // It ran `extract`, not `fetch` — and it worked that out from the store
    // rather than from the job record, which is what makes a job resumed a week
    // later land in the right place.
    expect(advanced?.ran).toBe("extract");
    expect(fetched).not.toHaveBeenCalled();
    expect(advanced?.job.steps[0]?.status).toBe("skipped");
    expect(advanced?.job.steps[1]?.status).toBe("error");
    expect(advanced?.done).toBe(true);
  });

  it("walks the whole job on one call, rather than stopping after the first step", async () => {
    /**
     * **This case said the opposite until 2026-08-30, and the reversal is the
     * point.** It read *"runs exactly one step and stops, leaving the next one
     * pending"*, on the reasoning that a call running two steps could exceed a
     * serverless function's time limit.
     *
     * That was right about the limit and wrong about where the work goes. Each
     * `/advance` may land on a **different instance with an empty disk**, so
     * step two looks for what step one wrote, finds nothing, and runs step one
     * again — and two tabs alternating make that a loop. One claim now walks the
     * whole job, inside one invocation, and what bounds it is the claimant's own
     * deadline (`LEASE_MS`) plus `STEP_BUDGET_MS` before each step.
     * docs/plans/260830d-v1-imports-on-vercel.md § Stage 3.
     */
    const slug = "test-advance-one-step";
    /* Both forced, so both run against an article whose artefacts are already
       current — the state a resumed job is never in and this case needs. */
    const queued = await queueJob(slug, ["fetch", "extract"], true);

    /* Stubbed to succeed. `assertProduced` still asks the store for the artefact
       afterwards — inside `commit`'s own transaction, over
       `readsPgArtifacts` — so the stub has to produce one, and one the store
       will take. A step that returns happily having written nothing is caught,
       and should be. */
    const fetched = vi
      .spyOn(STEPS.fetch, "run")
      .mockImplementation(() => productOf(slug, "fetch", "stubbed"));
    vi.spyOn(STEPS.extract, "run").mockImplementation(() =>
      productOf(slug, "extract", "stubbed extract"),
    );

    const first = await advanceAsOwner(queued.id);
    expect(fetched).toHaveBeenCalledTimes(1);
    /* `ran` names the **last** step the call ran, and `extract` is the second of
       the two — so this one assertion is the whole change: the old shape could
       not have reached it. */
    expect(first?.ran).toBe("extract");
    expect(first?.done).toBe(true);
    expect(first?.job.steps[0]?.status).toBe("done");
    /* Not `pending`. `extract` was reached inside the same call, on the same
       claim, over the artefacts `fetch` had just written. */
    expect(first?.job.steps[1]?.status).not.toBe("pending");
    /* Still saying what it said. The walk must not relabel a step it already
       ran — that would take the first step's own report off the card. */
    expect(first?.job.steps[0]?.detail).toBe("stubbed");

    /* And the job is over, so asking again does nothing at all rather than
       running the second step a second time. */
    const second = await advanceAsOwner(queued.id);
    expect(second?.ran).toBeNull();
    expect(second?.done).toBe(true);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("does nothing to a job that has already finished, however often it is asked", async () => {
    const slug = "test-advance-idempotent";
    const queued = await queueJob(slug, ["fetch"]);
    /* Finished by the first advance, which finds `fetch`'s artefacts current and
       skips it — the all-skipped ending. It used to be finished by the pump
       *failing* offline; either is a job that is over, which is the only
       precondition this case has. */
    const finished = await advanceAsOwner(queued.id);
    expect(finished?.done).toBe(true);
    const settled = await runAsOwner(DEV_OWNER_ID, () => getJob(queued.id));
    expect(settled?.status).toBe("done");
    const before = JSON.stringify(settled);

    const fetched = vi.spyOn(STEPS.fetch, "run");
    for (let i = 0; i < 3; i++) {
      const advanced = await advanceAsOwner(queued.id);
      expect(advanced?.done).toBe(true);
      expect(advanced?.ran).toBeNull();
      expect(advanced?.busy).toBe(false);
    }
    expect(fetched).not.toHaveBeenCalled();
    expect(JSON.stringify(await runAsOwner(DEV_OWNER_ID, () => getJob(queued.id)))).toBe(before);
  });

  it("turns the second of two simultaneous callers away rather than running twice", async () => {
    /* Two tabs. Both may ask; one must win. Running the step twice would have
       two runners writing one article's files, which is the fault this whole
       design is shaped around — docs/plans/260826q-job-queue-rethink.md. */
    const slug = "test-advance-concurrent";
    const queued = await queueJob(slug, ["fetch", "extract"], true);

    let running = 0;
    let most = 0;
    const fetched = vi.spyOn(STEPS.fetch, "run").mockImplementation(async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 30));
      running--;
      return productOf(slug, "fetch", "stubbed");
    });
    vi.spyOn(STEPS.extract, "run").mockImplementation(() =>
      productOf(slug, "extract", "stubbed extract"),
    );

    const [a, b] = await Promise.all([advanceAsOwner(queued.id), advanceAsOwner(queued.id)]);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(most).toBe(1);
    /* One did the work; the other was told to wait and ask again. Neither is an
       error: a second tab cannot know without asking.

       Named rather than sorted. The first version of this asserted
       `[a?.ran, b?.ran].sort()` against `[null, "fetch"]` and was red, because
       the default sort compares *strings* — `"fetch"` before `"null"` — so it
       was pinning the order a comparator happened to produce rather than the
       fact it meant. Pick the winner out by the thing that identifies it. */
    const [winner, loser] = a?.busy === false ? [a, b] : [b, a];
    expect(winner?.busy).toBe(false);
    expect(loser?.busy).toBe(true);
    /* The **last** step the winner ran, not the first: one claim walks the whole
       job, so the winner went on to `extract` over the artefact its own `fetch`
       had just written. What this case is about is unchanged — one runner. */
    expect(winner?.ran).toBe("extract");
    expect(loser?.ran).toBeNull();
    // And the one that was turned away must not claim the job is over, or its
    // loop would stop on a job that still has a step to run.
    expect(loser?.done).toBe(false);
  });

  it("refuses while somebody else holds the claim", async () => {
    /* **The rule that replaced "advance stands aside for the in-process queue".**
     *
     * That rule was an agreement between two drivers inside one process, and it
     * was checked by asking whether this process had an `AbortController` for
     * the job. It could not survive a second instance, which is the whole reason
     * the claim exists — so the rule is now: one claim, and whoever holds it
     * runs. The pump is not privileged; it is just another caller.
     *
     * Taken through the store directly rather than by racing the pump. An
     * earlier version of this queued a job and immediately advanced it, and
     * passed because the pump happened to claim first — a test whose result
     * depends on which of two async callers wins is not testing the rule, it is
     * observing a scheduler. */
    const slug = "test-advance-queue-owns";
    const queued = await queueJob(slug, ["fetch"]);
    /* `mintAttempt()`, not a mnemonic: `jobs.attempt_id` is a `uuid` column and
       `"spya-someone"` fails the insert with `22P02` before the claim is even
       decided — which would make this case red on its setup line. */
    const somebody = mintAttempt();
    /* A cap high enough to be beside the point: this case is not about it, and
       asked again on `busy` for the reason § *asking again, on `busy`* gives —
       a leftover pump mid-claim is not this fixture failing. Only the setup
       line is at risk here: the assertion below *wants* a `busy`. */
    const held = await claimOnceItIsFree(queued.id, somebody);
    expect(held.kind, "the fixture claim has to succeed for this to mean anything").toBe("claimed");

    const advanced = await advanceAsOwner(queued.id);
    expect(advanced?.busy).toBe(true);
    expect(advanced?.ran).toBeNull();
    expect(advanced?.done).toBe(false);
    if (held.kind === "claimed") {
      await pgJobStore.releaseStep(queued.id, somebody, queued.steps, {});
    }
  });

  it("has nothing to say about a job that does not exist", async () => {
    // Null rather than a made-up job, so the route can 404 rather than hand a
    // client a loop over something that was never there.
    expect(await advanceAsOwner("spya-nosuch")).toBeNull();
  });
});
