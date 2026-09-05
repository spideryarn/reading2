/**
 * **One pipeline stage, run on its own, against Postgres** — and the ingest that
 * makes an article to run one against.
 *
 * ```
 * npx tsx scripts/stage.ts ingest <url> [--force]
 * npx tsx scripts/stage.ts ingest <file.pdf>
 * npx tsx scripts/stage.ts <step> <slug> [--force]
 * ```
 *
 * `package.json` keeps the familiar names: `npm run ingest`, `npm run extract`,
 * `npm run blocks`, `npm run hierarchy`.
 *
 * ## Why the command line had to leave the stage modules
 *
 * Every artefact write under Postgres is fenced on a running `jobs` row and a
 * draft revision (`requireLiveJobOwnsDraft`, src/store/pg-session.ts), so a
 * standalone stage run has to go through `enqueue` + `advanceJob`. But
 * `src/jobs.ts` imports `src/pipeline.ts`, which imports `src/blocks.ts` — so a
 * `main()` inside `blocks.ts` reaching for the queue would close an import
 * cycle, and `npm run cycles` is a gate rather than advice. **So the stage CLIs
 * became one script that takes a step name**, and five `main()`s went — `fetch`,
 * `extract`, `blocks`, `hierarchy` and `labels`. Stage E of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
 *
 * Reusing the queue is also what keeps *one code path per stage* true, and it
 * hands us the owner scope, the draft, the publication guards, the checkpoints
 * and the AI cost ledger for free. In particular the CLI needs no
 * `withLedger("cli", …)`: the step runs inside the job's own
 * `scopeKind: "job_step"` collector, and wrapping the whole run in a second
 * `"cli"` scope would scope the same money twice.
 *
 * ## The contract, in five lines
 *
 * - **Which article** — by slug, and only one that is already yours. `enqueue`
 *   refuses the rest with *"No such article."*, whether it is somebody else's or
 *   nobody's (src/jobs.ts). `ingest` is the exception, because it is the command
 *   that creates one.
 * - **Whose** — the environment owner: `SPIDERYARN_OWNER_ID`, else
 *   `DEV_OWNER_ID`, and a throw in production (src/owner.ts). `npm run setup`
 *   writes it.
 * - **Which revision** — a new draft each run, off the current published one,
 *   published when the job settles, in one transaction. Nothing is edited in
 *   place, so a re-run that goes wrong leaves the reader on the revision they
 *   were already reading. The block-id contract survives because this is the
 *   same code the queue runs: `beginDraftIn` carries the published revision's
 *   block rows into the draft and `assertIdsCarried` stops the stage if the run
 *   shares no ids with them (docs/project/block-ids.md).
 * - **A re-run without `--force` does nothing, and says so.** Freshness is the
 *   step's own `isDone`, asked of Postgres. It still opens a draft and publishes
 *   an identical revision when the job settles — the skip is the *step's*, not
 *   the job's. `--force` is not *start over*: it is the ordinary idempotent path,
 *   and it keeps its ids.
 * - **No auto-chaining.** Naming one step runs one step; `--force` cascades only
 *   over the steps *in this job*, which for a one-step job is that step. Running
 *   several is `POST /api/jobs` with several steps. `fetch` is refused outright —
 *   see `oneStage`.
 *
 * ## Resume, and the thing `--force` does not do
 *
 * These commands **do** resume now, which is new and was not what this file
 * first claimed. The per-chunk and per-batch caches are `checkpoints` rows keyed
 * on an `articles` row; the old file-writing CLIs had no article and passed
 * `nullCheckpointStore()`, so a killed run paid again. Going through the queue
 * gives every run the article's own checkpoints, so a killed run does not.
 *
 * **And that has a second consequence, measured 2026-09-05 and pointed at by
 * GPT Sol before it was measured: `--force` on `hierarchy` does not buy a fresh
 * answer from the model.** `force` is a *step* flag — it makes the step run
 * again rather than skip — and the step then finds its structure and label
 * batches already in `checkpoints` and replays them. Two consecutive
 * `npm run hierarchy -- <slug> --force` runs on an unchanged article: the first
 * bought two model calls, the second bought **none**, and both printed
 * `13 sections over 19 blocks`.
 *
 * So `--force` re-runs the *step* and not the *purchase*. That matters most
 * where the plan leaned on it: **re-labelling after a prompt change is not
 * `hierarchy --force`**, because the labels come back out of the checkpoint. It
 * is the same behaviour a reader's Refresh gets from the browser, so it is a
 * property of the queue rather than of this script — which is exactly why this
 * script does not work round it. Changing what `force` means to a checkpoint is
 * Greg's call and belongs with the queue, not here.
 *
 * ## Startup
 *
 * Importing `src/jobs.ts` pulls in most of the graph, so this starts noticeably
 * slower than `tsx src/blocks.ts` did — a few seconds on an idle machine, and
 * measured at 47 s wall against 26 s on a box at load 100. That is import time,
 * not work; do not file it as a regression.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadEnvLocal } from "../src/env.js";

/* **Before the dynamic imports below, and that is the point.** `src/store/live.ts`
   reads `SPIDERYARN_STORE` once, at first import, and `src/store/blobs.ts` picks
   between Supabase Storage and `data/_blobs/` from two credentials — so a module
   graph loaded before `.env.local` has been applied makes a *different* storage
   selection from the server, writes bytes nothing else can find, and reports
   success (docs/postmortems/260831e-a-write-path-with-no-reader.md). Static
   imports are hoisted above every statement in a module, so the only way to put
   a call before them is to make them dynamic. */
loadEnvLocal();

const { sql } = await import("drizzle-orm");
const { getDb } = await import("../src/db/client.js");
const { slugFromFilename, slugFromUrl } = await import("../src/ingest.js");
const { advanceJob, enqueue, getJob } = await import("../src/jobs.js");
const { environmentOwnerId } = await import("../src/owner.js");
const { isStepName, STEP_ORDER } = await import("../src/pipeline.js");
const { looksLikePdf, stagingKey } = await import("../src/source.js");
const { CONTENT_TYPE, postgresBlobStore } = await import("../src/store/blobs.js");
const { claimUpload, mintUpload, noteSlug, readUpload } = await import(
  "../src/upload-records.js"
);
const { MAX_UPLOAD_BYTES } = await import("../src/uploads.js");
const { STORE } = await import("../src/store/live.js");

type Job = Awaited<ReturnType<typeof enqueue>>;

const USAGE =
  "Usage:\n" +
  "  npm run ingest    -- <url> [--force]      make an article from an address\n" +
  "  npm run ingest    -- <file.pdf>           make an article from a PDF on this disk\n" +
  "  npm run extract   -- <slug> [--force]     re-run one stage on an article you have\n" +
  "  npm run blocks    -- <slug> [--force]\n" +
  "  npm run hierarchy -- <slug> [--force]\n" +
  `\n  any step: ${STEP_ORDER.join(", ")}\n`;

function die(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/**
 * **The owner row, checked before anything is queued.**
 *
 * `articles.owner_id` and `jobs.owner_id` are foreign keys into `auth.users`, so
 * an environment naming an account that is not on this database surfaces as a
 * constraint violation from inside `enqueue` — which reads as a database bug and
 * sends whoever hit it to the schema, three layers from the missing row. The
 * same check `evals/cost/run.ts` makes, for the same reason.
 */
async function assertOwnerReady(owner: string): Promise<void> {
  const found = await getDb().execute(sql`select 1 from auth.users where id = ${owner}::uuid`);
  if (found.rows.length > 0) return;
  die(
    `The owner ${owner} is not in auth.users on this database.\n` +
      "  Run `npm run setup`, which seeds the local accounts and writes SPIDERYARN_OWNER_ID.\n" +
      "  Without the row, every job this command queues fails a foreign key from inside enqueue.",
  );
}

/**
 * Drive one job to a standstill, then print what each step did.
 *
 * `advanceJob` rather than `pump`, because this process *is* the driver: the
 * request carries `pump: false` so there is only one loop asking, and `busy`
 * means another agent's dev server holds the single running slot rather than
 * that we are racing ourselves.
 */
/**
 * How long to keep asking before giving up on a `busy` that never clears.
 *
 * **Bounded rather than forever**, and the case is real ⟨GPT Sol, 2026-09-05⟩:
 * `claim` refuses while an *older* active job holds the same article, and a job
 * queued with `pump: false` and then abandoned — this command interrupted, say —
 * is exactly such a holder with nobody driving it. The loop below advances its
 * own job and only its own, so it would sit there until somebody noticed. Ten
 * minutes is longer than any single step takes and short enough to be a
 * command that ends.
 */
const BUSY_GIVE_UP_MS = 10 * 60_000;

async function drive(job: Job): Promise<Job> {
  console.log(`Job:       ${job.id}\n`);
  let final = job;
  const startedAt = Date.now();
  for (;;) {
    const advanced = await advanceJob(job.id);
    if (!advanced) break;
    final = advanced.job;
    if (advanced.done) break;
    if (advanced.busy) {
      if (Date.now() - startedAt > BUSY_GIVE_UP_MS) {
        die(
          `Job ${job.id} on "${job.slug}" has been told "busy" for ` +
            `${BUSY_GIVE_UP_MS / 60_000} minutes and has not started.\n` +
            "  Something older is holding this article's line, or the single running slot.\n" +
            "  `GET /api/jobs` lists them; a stopped job is `npm run dev` away from being retried,\n" +
            "  and the job queued here is still there to drive when it clears.",
        );
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return (await getJob(job.id)) ?? final;
}

/**
 * What happened, and the exit code.
 *
 * The step's own `detail` is the interesting line — *"19 blocks, 0 new ids (19
 * kept)"* — and its `error` is the **reader's** sentence, which on a command
 * line is not enough on its own: *"something about how this app is set up"* is
 * what a missing upstream artefact reads as. The developer's sentence is in the
 * `step failed:` log line this process has already printed to stdout, with the
 * stack in it (src/jobs.ts § `errorFields`), so the pointer is what this adds.
 */
function reportAndExit(job: Job, extra: string[] = []): never {
  for (const s of job.steps) {
    const note = s.detail ?? s.error ?? "";
    console.log(`  ${s.name.padEnd(12)} ${s.status.padEnd(9)} ${note}`);
  }
  console.log("");
  for (const line of extra) console.log(line);
  console.log(`Article:   ${job.slug}`);
  console.log(`Job:       ${job.status}`);
  if (job.status === "done") process.exit(0);
  if (job.error) console.log(`Error:     ${job.error}`);
  console.log(
    "\n  That sentence is the one a reader would see. The developer's — with the stack —\n" +
      '  is the `step failed:` line above, in the JSON log this command printed as it ran.',
  );
  process.exit(1);
}

/* ------------------------------------------------------------ one stage -- */

async function oneStage(step: string, slug: string, force: boolean): Promise<never> {
  if (!isStepName(step)) die(`"${step}" is not a pipeline step.\n\n${USAGE}`);
  /* **`fetch` is refused here, and refusing it is the whole point of the
     rename** ⟨GPT Sol, 2026-09-05⟩. Deleting `npm run fetch` from `package.json`
     removed the *name*; this interface takes any `StepName`, so
     `scripts/stage.ts fetch <slug> --force` was still the fetch-only job that
     `ingestUrl` below explains at length — new raw bytes published beside
     carried-forward derived artefacts, reported as a success. A rule stated only
     in `package.json` is a rule the next argument list walks round. */
  if (step === "fetch") {
    die(
      "`fetch` cannot be run on its own: the queue publishes once, when the job settles,\n" +
        "  so a fetch-only run on an article you already have would publish new raw bytes\n" +
        "  beside its old blocks and tree — a revision that is not coherent, reported as a\n" +
        "  success. `npm run ingest -- <url> --force` re-fetches and re-runs what follows.",
    );
  }
  const owner = environmentOwnerId();
  await assertOwnerReady(owner);

  console.log(`Article:   ${slug}`);
  console.log(`Owner:     ${owner}`);
  console.log(`Step:      ${step}${force ? "  (forced)" : ""}`);

  let job: Job;
  try {
    job = await enqueue({
      slug,
      steps: [step],
      ...(force ? { force: [step] } : {}),
      /* This process drives; see `drive`. Without it `enqueue`'s own pump would
         race the loop for the claim and take the step's report with it. */
      pump: false,
    });
  } catch (err) {
    /* **The 404 as a sentence, not a stack trace**, which is what the spike
       produced. `enqueue` refuses a bare-slug request for an article this owner
       does not have — deliberately indistinguishable from somebody else's, which
       is the privacy rule (src/jobs.ts) — and on a command line that is nearly
       always a typo. */
    if ((err as { status?: number }).status === 404) {
      die(
        `No article "${slug}" on ${owner}'s shelf.\n` +
          "  This command re-runs a stage on an article that is already there; it does not add one.\n" +
          "  `npm run ingest -- <url|file.pdf>` is the one that adds one.",
      );
    }
    throw err;
  }
  return reportAndExit(await drive(job));
}

/* --------------------------------------------------------------- ingest -- */

/**
 * **`ingest` runs the whole ingest, and that is a correction rather than a
 * convenience.**
 *
 * `npm run fetch` was a fetch-only command, and the queue cannot express one:
 * publication happens once, when the job settles, and `reasonsNotToPublish`
 * refuses a draft with no blocks and no tree (src/store/pg-revisions.ts). So a
 * fetch-only job on a **new** article fetches, pays, and fails at publication.
 * On an **existing** one it is worse, because it *succeeds*: the draft carries
 * the published revision's blocks and tree, so it publishes new raw bytes beside
 * stale derived content and reports that as a success. Measured on the same day
 * for the PDF path — `--steps=fetch,extract` made its paid model call and then
 * threw `PublishRefused: … it has no blocks; it has no tree`, and the
 * transcription went out with the draft.
 *
 * The workflow being given up — *write the fetch output now, let another process
 * continue later* — worked only because a file was a durable handoff between two
 * processes, and Postgres has no such handoff. The honest v1 is that re-fetching
 * cascades, which is what `cascadeForce` already does for every other step.
 *
 * **Renamed rather than aliased.** `npm run fetch` failing with *"Missing
 * script"* is better than it quietly doing something else.
 *
 * ## `--force`, which is what makes it a *re*-fetch
 *
 * **A URL already on the shelf is adopted, and without `--force` every step is
 * skipped.** `freeSlug` hands a second paste of one address back onto the
 * article it already made (src/jobs.ts), and each step then answers `isDone`
 * from what is stored — measured 2026-09-05, on an address the local database
 * already held: five steps, four `skipped`, nothing re-fetched. So the first
 * version of this command could not do the one thing `npm run fetch` was for,
 * and said in its own docstring that re-fetching cascades ⟨GPT Sol⟩.
 *
 * `--force` forces `fetch`, and `cascadeForce` (src/jobs.ts) then forces every
 * step after it in the job — which for the default ingest is all of them. That
 * is the refresh, and it is the same thing `POST /api/jobs { url, force:
 * ["fetch"] }` does from the add box.
 *
 * **Not forced by default**, deliberately: a bare `npm run ingest -- <url>` on
 * an address you already have should cost nothing and say so, which is what a
 * row of `skipped` is.
 */
async function ingestUrl(url: string, force: boolean): Promise<never> {
  const slug = slugFromUrl(url);
  if (!slug) die(`"${url}" is not an address I can make a slug from.\n\n${USAGE}`);
  const owner = environmentOwnerId();
  await assertOwnerReady(owner);
  console.log(`Source:    ${url}`);
  console.log(`Owner:     ${owner}`);
  console.log(`Steps:     the default ingest${force ? ", forced from `fetch` down" : ""}\n`);
  const job = await enqueue({ slug, url, pump: false, ...(force ? { force: ["fetch"] } : {}) });
  return reportAndExit(await drive(job));
}

/**
 * **A PDF off this machine's disk, ingested as an upload.**
 *
 * The order is `queueAnUpload`'s (src/routes.ts) and it is copied rather than
 * summarised, because two of its five moves are the ones that go wrong quietly:
 *
 * 1. **mint** the record;
 * 2. **put** the bytes at the staging key;
 * 3. **claim** it — and this is the one the spike's first two runs skipped.
 *    `settleUpload(…, "verified")` runs only `if (record.status === "claimed")`
 *    (src/pipeline.ts), so without the claim the record stays `pending` for ever
 *    with no slug. **The article is fine and the record silently is not**, which
 *    is why those runs looked like successes;
 * 4. **enqueue**, which mints a slug for the article;
 * 5. **`noteSlug`**, so the record says which article this file became.
 *
 * **No grant issuer.** Signed grants exist so a *browser* can write; this process
 * holds the service key and puts the bytes itself. `mintUpload` still wants a
 * grant function because the browser path's ordering argument depends on one —
 * an issuer that refuses must leave no record behind — so it is given one that
 * issues nothing and expires when the browser's would.
 *
 * **`postgresBlobStore`, not `blobStore()`.** The latter falls back to
 * `data/_blobs/` when either Supabase credential is missing, cheerfully, and
 * rows in Postgres pointing at bytes on one laptop's disk is a split brain
 * rather than a degraded configuration (src/store/blobs.ts).
 *
 * **`--force` is meaningless here**, so it is refused rather than ignored:
 * `enqueue` gives every upload a freshly minted slug unconditionally, so two
 * runs of one file are two articles — Greg's decision, in src/jobs.ts.
 */
async function ingestFile(file: string): Promise<never> {
  const owner = environmentOwnerId();
  await assertOwnerReady(owner);
  const bytes = new Uint8Array(await readFile(file));
  /* **Every refusal that can be made before anything durable exists, is** ⟨GPT
     Sol, 2026-09-05⟩. The route checks the name, the type and a positive size
     before it mints; this checked only the cap, so an empty file or a `.txt`
     minted a record and put bytes into Storage before the pipeline refused it —
     rubble for a mistake that costs four bytes to catch. `looksLikePdf` is the
     same function `acquireUpload` uses, so the two cannot disagree about what a
     PDF is. */
  if (bytes.byteLength === 0) die(`${file} is empty.`);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    die(
      `${file} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB, over the ` +
        `${MAX_UPLOAD_BYTES / 1024 / 1024} MB upload cap (src/uploads.ts).`,
    );
  }
  if (!looksLikePdf(bytes)) {
    die(
      `${file} does not start with %PDF, so nothing here can read it.\n` +
        "  A PDF is the only kind of file this takes; a web page is `npm run ingest -- <url>`.",
    );
  }
  const filename = path.basename(file);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const store = postgresBlobStore("npm run ingest");

  const minted = await mintUpload(
    { filename, bytes: bytes.byteLength, sha256, owner },
    /* The issuer that issues nothing — see the note above. Two hours is what
       `uploadGrants()` gives a browser, and the record carries what the issuer
       said rather than our own arithmetic. */
    async () => ({
      url: "(none — this process wrote the bytes itself)",
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    }),
    stagingKey,
  );
  const id = minted.record.id;
  await store.putIfAbsent(stagingKey(id), bytes, CONTENT_TYPE.pdf);

  const claim = await claimUpload(id, { owner, arrived: true });
  if (!claim.ok) die(`Could not claim the upload we had just minted: ${claim.why}.`);

  console.log(`Source:    ${path.resolve(file)}`);
  console.log(`Owner:     ${owner}`);
  console.log(`Upload:    ${id}  (${(bytes.byteLength / 1024).toFixed(1)} KB)`);
  console.log("Steps:     the default ingest\n");

  const job = await enqueue({
    slug: slugFromFilename(filename) || "document",
    upload: { id, filename },
    pump: false,
  });
  /* **A warning, not a throw, and the difference is liveness** ⟨GPT Sol,
     2026-09-05⟩. The job is queued and this process is its only driver — the
     request carried `pump: false` — so a throw between here and `drive` below
     strands a job nothing will ever advance. The route can throw here because
     its `enqueue` started a pump of its own. And the slug is written a second
     time by `settleUpload(…, "verified")` when the fetch step acquires the
     upload (src/pipeline.ts), so a miss here is recoverable rather than
     permanent. */
  try {
    await noteSlug(id, job.slug);
  } catch (err) {
    console.error(
      `\n  Could not note the article on upload ${id}: ${err instanceof Error ? err.message : String(err)}` +
        "\n  Carrying on — the fetch step writes it again when it verifies the bytes.\n",
    );
  }

  const final = await drive(job);
  /* **Read back, because this is the half that fails silently — measured, not
     reasoned.** With the claim above deleted, the same run printed five green
     steps and a published article, and left the record `pending` with `bytes`
     and `sha256` null (2026-09-05). Nothing else in the output would say so.
     The slug *is* written either way, because `noteSlug` does not care; the
     status and the verified size are what the claim buys. */
  const record = await readUpload(id, owner);
  return reportAndExit(final, [
    `Upload:    ${record?.status ?? "gone"}` +
      `${record?.slug ? `, article ${record.slug}` : ", no article"}` +
      `${record?.reason ? ` (${record.reason})` : ""}`,
  ]);
}

/* ----------------------------------------------------------------- main -- */

const args = process.argv.slice(2);
const force = args.includes("--force");
const [first, second] = args.filter((a) => !a.startsWith("--"));

if (!first) die(USAGE.trim());

if (STORE !== "postgres") {
  die(
    `This command runs the pipeline against Postgres and SPIDERYARN_STORE is "${STORE}".\n` +
      "  The npm scripts set it; the flag is read once at module load (src/store/live.ts),\n" +
      "  so setting it inside this process would be too late.",
  );
}

if (first === "ingest") {
  if (!second) die(`\`ingest\` wants a URL or a path to a PDF.\n\n${USAGE}`);
  /* http/https is a URL; anything else is a path on this machine. Nothing else
     is ambiguous — `slugFromUrl` refuses a bare filename, and a URL is not a
     file that opens. */
  if (/^https?:\/\//i.test(second)) {
    await ingestUrl(second, force);
  } else {
    /* **`--force` is refused for a file and accepted for a URL**, which is not
       an inconsistency: `enqueue` gives every upload a freshly minted slug
       unconditionally, so two runs of one file are two articles and there is
       nothing to force onto — Greg's decision, in src/jobs.ts. A URL is adopted
       onto the article it already made, so forcing is the only way to re-fetch
       it. The first version refused both and said "two runs of one source are
       two articles", which is true of half of what it was refusing ⟨GPT Sol,
       2026-09-05⟩. */
    if (force) {
      die(
        "`--force` means nothing when the source is a file: every upload mints a fresh\n" +
          "  slug, so running one twice is two articles rather than one re-done.",
      );
    }
    await ingestFile(second);
  }
} else {
  if (!second) die(`\`${first}\` wants the slug of an article you already have.\n\n${USAGE}`);
  await oneStage(first, second, force);
}
