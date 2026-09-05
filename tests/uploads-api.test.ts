/**
 * The upload endpoints, and the two rules that make them safe.
 *
 * > **Never accept a client-supplied object path**: issue a user-scoped random
 * > path, then verify ownership, size, checksum and the `%PDF-` magic before
 * > enqueueing.
 * >
 * > — docs/plans/260826c-pdf-ingestion.md, quoted in 260826u-pdf-upload-and-storage.md as the
 * >   load-bearing sentence of the design
 *
 * So the assertions here are about **what the request may name** rather than
 * about status codes: a test that only checked for a 400 would pass while
 * refusing for entirely the wrong reason. The byte-level checks — magic and
 * checksum — belong to the acquisition step and are tested with it.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApi, parseJobRequest } from "../src/routes.js";
import { slugFromFilename, slugWithShortId } from "../src/ingest.js";
import { forgetUpload, recordsSurviveTheRequest } from "../src/upload-records.js";
import { blobStore, CONTENT_TYPE } from "../src/store/blobs.js";
import { eq, inArray } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { jobs as jobsTable } from "../src/db/schema.js";
import { bareArticles, removeBareArticles } from "./helpers/bare-article.js";
import { mintAttempt } from "../src/store/jobs.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { stagingKey } from "../src/source.js";
import { runAsOwner, type OwnerId } from "../src/owner.js";
import type { JobStep } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_SUB } from "./helpers/authed.js";

/** The reader `AUTHED_HEADERS` is, which is who these jobs belong to. */
const OWNER = TEST_SUB as OwnerId;

/**
 * **The ids this file minted, and only those.**
 *
 * It used to snapshot every upload at module load and delete anything new in
 * `afterEach` — which reads as tidy and is not, because vitest runs test files
 * in parallel against one store. "New since I started" swept up records
 * `tests/upload-acquire.test.ts` had just created and was about to read, and
 * that file then failed with `No record of upload …` while passing perfectly on
 * its own. The same trap `tests/fixture-ids.test.ts` exists for, one layer over.
 *
 * Collected from the responses rather than by diffing the store, so it is a
 * list of things this file actually caused.
 */
const minted: string[] = [];
/** Staging objects this file wrote, so `land` can be undone. */
const landed: string[] = [];
/** Job ids this file's requests queued. See the note on the delete below. */
const queued: string[] = [];
/** Article rows this file seeded so that `enqueue` would accept a mode job. */
const seededSlugs: string[] = [];
afterEach(async () => {
  /* **Jobs first, and by SQL rather than through `forgetJob`.**
     `jobs.upload_id` is a foreign key into `uploads`, so an upload cannot go
     while a job names it — and `pgJobStore.forget` only deletes a **terminal**
     job. Every job here is left `queued`, on purpose: `VERCEL=1` stops the pump
     so that the second request in each case is not racing an ingest. So the
     polite route cannot clean up after these and a direct delete has to.
     Only ids this file's own responses named. */
  if (queued.length > 0) {
    await getDb()
      .delete(jobsTable)
      .where(inArray(jobsTable.id, queued.splice(0)));
  }
  for (const id of minted.splice(0)) await forgetUpload(id);
  for (const key of landed.splice(0)) await blobStore().remove(key);
  if (seededSlugs.length > 0) {
    await runAsOwner(OWNER, () => removeBareArticles(seededSlugs.splice(0), OWNER));
  }
});

afterAll(async () => {
  await closeDb();
});

/**
 * **Put the bytes where the browser would have put them.**
 *
 * Needed from 2026-09-03, and the reason is the point of the readiness gate:
 * `POST /api/jobs { uploadId }` now HEADs the staging object before it claims
 * anything, so a test that mints a grant and queues a job without ever
 * uploading is describing a sequence the route no longer allows. It never
 * should have — that sequence is a reader reloading `/add/upload/<id>` mid
 * transfer, and it used to destroy their upload. See
 * `tests/an-upload-is-queued-only-once-its-bytes-arrive.test.ts`.
 *
 * The three recovery cases below are about what happens *after* an ingest
 * exists, so they need a real one, so they need bytes.
 */
async function land(uploadId: string): Promise<void> {
  const key = stagingKey(uploadId);
  await blobStore().putIfAbsent(
    key,
    new TextEncoder().encode("%PDF-1.4\ntrailer\n<<>>\n%%EOF\n"),
    CONTENT_TYPE.pdf,
  );
  landed.push(key);
}

async function call(
  method: string,
  pathname: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url: pathname, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(code: number) {
      (this as { statusCode: number }).statusCode = code;
    },
    flushHeaders() {},
    on() {},
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(written) as Record<string, unknown>;
  } catch {
    /* Some routes stream; none of the ones here do, and an unparseable body is
       itself worth seeing in the failure message rather than swallowing. */
  }
  /* Anything that came back with an id is an upload this file caused, and is
     this file's to clean up. Nothing else is. */
  if (typeof parsed.uploadId === "string") minted.push(parsed.uploadId);
  return { status: res.statusCode, body: parsed };
}

describe("what POST /api/jobs will accept as an origin", () => {
  /**
   * The dangerous shape, and the reason there is no precedence rule: `{ slug,
   * uploadId }` is a request to write somebody else's bytes into an article the
   * caller named. Refusing the combination outright means there is no rule to
   * get wrong later.
   */
  it("refuses two origins in one request", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    for (const body of [
      { url: "https://x.test/a", uploadId: id },
      { slug: "an-article-i-already-have", uploadId: id },
    ]) {
      expect(() => parseJobRequest(body), JSON.stringify(body)).toThrow(/not two of them/);
    }
  });

  it("refuses an upload id that is not one of ours", () => {
    for (const uploadId of ["", "not-a-uuid", "../../etc/passwd", "1".repeat(36), 42]) {
      expect(() => parseJobRequest({ uploadId }), String(uploadId)).toThrow();
    }
  });

  it("carries a good one through, and derives no slug from it", () => {
    const uploadId = "11111111-2222-4333-8444-555555555555";
    const parsed = parseJobRequest({ uploadId });
    expect(parsed.uploadId).toBe(uploadId);
    /* Empty on purpose: the slug comes from the record's filename and is
       allocated inside `enqueue`, which is the only place with no gap between
       deciding and inserting. */
    expect(parsed.slug).toBe("");
  });
});

/**
 * The gap between minting a grant and queueing the job is **two HTTP requests**,
 * and the record has to survive it. On a serverless function's filesystem it
 * does not — neither durable nor shared — so the second request answers "no
 * such upload" for a file that uploaded perfectly.
 *
 * Refused at the door rather than discovered three minutes into an 11 MB
 * upload, which is the whole difference between a limitation and a silent
 * success. The check is on the *platform*, deliberately not on "is the
 * filesystem writable": it is writable there, and that is exactly what makes
 * this fail quietly.
 */
describe("whether this installation can take an upload at all", () => {
  /**
   * **It always can, since 2026-09-05, and this is the case that used to say
   * otherwise.**
   *
   * `recordsSurviveTheRequest` was `STORE === "postgres" || !process.env.VERCEL`
   * and this block asserted both arms: `VERCEL=1` on the filesystem store
   * answered `false`, and `POST /api/uploads` refused with 503 — because a
   * serverless function's disk is neither durable nor shared, so the second
   * request answers "no such upload" for a file that uploaded perfectly.
   *
   * There is one store and it is durable wherever it runs, so the `false` arm
   * cannot be reached and the 503 is unreachable with it. The refusal itself is
   * still in `src/routes.ts` and still right — the question *"can a record
   * written by one request be read by the next"* is a real precondition — so
   * what is asserted is the answer, on Vercel too, which is the half that used
   * to be the control.
   */
  it("takes one on a serverless host too, because the store outlives the request", async () => {
    const was = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      expect(recordsSurviveTheRequest()).toBe(true);
      const { status } = await call("POST", "/api/uploads", {
        filename: "a.pdf",
        bytes: 100,
        sha256: "a".repeat(64),
      });
      expect(status).toBe(201);
    } finally {
      if (was === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = was;
    }
  });
});

describe("POST /api/uploads", () => {
  it("refuses a body that is missing any of the three claims", async () => {
    for (const body of [
      {},
      { filename: "a.pdf", bytes: 10 },
      { filename: "a.pdf", bytes: 10, sha256: "nope" },
      { filename: "a.pdf", bytes: -1, sha256: "a".repeat(64) },
      { filename: "", bytes: 10, sha256: "a".repeat(64) },
    ]) {
      const { status } = await call("POST", "/api/uploads", body);
      expect(status, JSON.stringify(body)).toBe(400);
    }
  });

  /**
   * `NaN` and `1e21` are the two that get through the obvious check. Every
   * comparison with `NaN` is false, so a cap test written as `bytes > MAX`
   * waves it straight past — and then the record claims a size that is not a
   * number.
   */
  it("refuses a size that is not a whole number of bytes", async () => {
    for (const bytes of [Number.NaN, 1.5, 1e21, Number.POSITIVE_INFINITY]) {
      const { status } = await call("POST", "/api/uploads", {
        filename: "a.pdf",
        bytes,
        sha256: "a".repeat(64),
      });
      expect(status, String(bytes)).toBe(400);
    }
  });

  /**
   * **Before anything is minted**, which is the point: a reader with a 60 MB
   * scan is told so in a second rather than after a 60 MB transfer that the
   * bucket then refuses.
   */
  it("refuses an over-cap file before minting a grant", async () => {
    const { status, body } = await call("POST", "/api/uploads", {
      filename: "huge.pdf",
      bytes: 60 * 1024 * 1024,
      sha256: "a".repeat(64),
    });
    expect(status).toBe(413);
    expect(String(body.error)).toMatch(/limit is/i);
    expect(minted).toHaveLength(0);
  });

  it("refuses a file that is not a PDF by name or type", async () => {
    const { status } = await call("POST", "/api/uploads", {
      filename: "notes.txt",
      bytes: 100,
      sha256: "a".repeat(64),
    });
    expect(status).toBe(413);
  });
});

/**
 * **The claim is the scarce thing, and a request that cannot succeed must not
 * spend it.**
 *
 * `{ uploadId, steps: [] }` used to take the one-and-only claim and *then* get
 * a 400 from `enqueue` for having no steps, leaving the attempt stuck `claimed`
 * with no job and no way to reach it. `steps: ["arc"]` was worse: it claimed,
 * skipped acquisition entirely, and would have run a model stage over an
 * article that did not exist. An upload is always the default ingest, which is
 * what the documented `{ uploadId }` shape already said. GPT Sol, 2026-08-27.
 */
describe("what an upload request may carry besides the id", () => {
  const ID = "11111111-2222-4333-8444-555555555555";

  it("refuses step controls rather than claiming and then failing", () => {
    for (const extra of [{ steps: [] }, { steps: ["arc"] }, { force: ["fetch"] }]) {
      expect(() => parseJobRequest({ uploadId: ID, ...extra }), JSON.stringify(extra)).toThrow(
        /default steps/,
      );
    }
  });

  /* **`guidance` was a fourth thing on that list and is now ignored instead.**
     The summary steer it named is gone (docs/plans/260830o-steer-becomes-the-profile.md),
     and the two behaviours are not interchangeable: refusing is right for a
     field that would *change what runs*, because claiming an upload and then
     400-ing strands the attempt; ignoring is right for a field that now changes
     nothing, because a tab open since before the deploy should get its upload
     ingested rather than a 400 about a box it can still see. What must not
     happen is the third thing — the field surviving into the request. */
  it("ignores a steer on an upload rather than refusing it", () => {
    const parsed = parseJobRequest({ uploadId: ID, guidance: "x" }) as Record<string, unknown>;
    expect(parsed.guidance).toBeUndefined();
  });
});

describe("GET /api/uploads/:id", () => {
  it("is a 404 for an id nothing minted", async () => {
    const { status } = await call("GET", "/api/uploads/11111111-2222-4333-8444-555555555555");
    expect(status).toBe(404);
  });
});

/**
 * The collision rule, which is the one the plan writes a test for by name:
 *
 * > Two uploads both named `paper.pdf` get two articles, not one directory.
 *
 * **Answered by minting rather than by searching, since 2026-08-31.** Every new
 * slug ends in a globally unique short id (src/ingest.ts § `slugWithShortId`),
 * so two uploads of one filename cannot want one name and there is nothing to
 * step aside from. `freeUploadSlug` and `slugIsSpokenFor` walked a `-2`…`-99`
 * counter and read the fetch manifest to ask *is this article this upload's
 * own*; both are gone, and with them the retry bug that question existed to
 * avoid — a retry now mints a fresh id and takes a fresh slug, which costs a
 * name and no money, because the artefacts are keyed by content.
 * docs/plans/260831b-finish-the-database-move.md § Stage 3 item 0.
 */
describe("the slug an upload gets", () => {

  it("reads a filename the way a person would", () => {
    expect(slugFromFilename("Bergson — Matter & Memory (1911).pdf")).toBe(
      "bergson-matter-memory-1911",
    );
    expect(slugFromFilename("../../etc/passwd.pdf")).toBe("passwd");
    /* Nothing left after kebab-casing. The caller substitutes a default rather
       than this inventing one — a function that always succeeds cannot be asked
       whether it did. */
    expect(slugFromFilename("文档.pdf")).toBe("");
  });

  it("gives two files of the same name two articles", () => {
    const first = slugWithShortId(slugFromFilename("paper.pdf"));
    const second = slugWithShortId(slugFromFilename("paper.pdf"));
    expect(first).not.toBe(second);
    expect(first).toMatch(/^paper-spya-[a-z0-9]{6}$/);
    expect(second).toMatch(/^paper-spya-[a-z0-9]{6}$/);
  });

  it("keeps the reader's filename in the name they will see", () => {
    /* The short id is a suffix, not a replacement: the shelf card, the address
       bar and the metadata page all still read as the document. */
    expect(slugWithShortId("bergson-matter-memory-1911")).toMatch(
      /^bergson-matter-memory-1911-spya-[a-z0-9]{6}$/,
    );
  });
});

/**
 * **Reloading `/add/upload/<id>` hands back *this upload's* job.**
 *
 * The recovery: the claim on an upload is create-only, so a double-click or a
 * reload arrives after the first request has taken it. That is the same request
 * twice rather than a conflict, so the route looks for the job the first claim
 * produced and returns it.
 *
 * It looked for it **by slug**, over every status — `all.find(j => j.slug ===
 * slug)`. That was one answer while an article could hold one job. An article
 * holds a *line* now, so the reader who imported a PDF and then pressed
 * Glossary could reload their import page and be handed the **glossary run**,
 * presented as their import: `listJobs` is newest first, and the glossary job is
 * newer. It also depended on `noteSlug` having landed, where the upload id is on
 * the job record from the moment `enqueue` returns.
 *
 * So it matches `job.upload.id === uploadId`, which is the thing it means.
 * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 1h.
 *
 * **Watched red on 2026-09-02** with the slug lookup put back: *"the reload was
 * handed a later mode job on the same article: expected 'spya-…' to be
 * 'spya-…'"*.
 */
describe("the job a repeat claim finds", () => {
  it("matches the upload rather than the article, so a later mode job cannot stand in", async () => {
    const minted = await call("POST", "/api/uploads", {
      filename: "repeat-claim.pdf",
      bytes: 1024,
      sha256: "b".repeat(64),
    });
    expect(minted.status).toBe(201);
    const uploadId = String(minted.body.uploadId);
    /* The transfer, which the readiness gate now requires before anything
       may be queued from this id. */
    await land(uploadId);

    /* **`VERCEL`, so `enqueue` does not start driving what it queues.** `pump`
       returns immediately when it is set (src/jobs.ts); without it the ingest
       runs, fails looking for bytes nobody uploaded, and the job this case is
       about is terminal before the second request arrives. The recovery has to
       work either way, but a race is not what is being tested here. */
    const was = process.env.VERCEL;
    process.env.VERCEL = "1";
    const made: string[] = [];
    try {
      const first = await call("POST", "/api/jobs", { uploadId });
      expect(first.status, `refused with: ${String(first.body.error)}`).toBe(202);
      const ingest = String(first.body.id);
      const slug = String(first.body.slug);
      made.push(ingest);
      queued.push(ingest);

      /* **The article row, because the ingest is not going to make one.**
         `VERCEL=1` keeps the pump from running, so the slug the mint reserved
         has no `articles` row behind it — and `enqueue` refuses a request that
         names a slug and nothing else unless one exists ("No such article.",
         src/jobs.ts). That check used to be gated on the store flag and this
         file ran with it unset, so the fixture never had to be honest about it;
         since 2026-09-05 it does. */
      seededSlugs.push(slug);
      await runAsOwner(OWNER, () => bareArticles([slug], OWNER));

      /* A mode job on the article the upload became, **queued afterwards** — so
         it is the newer of the two and sorts first in the list the route reads.
         This is what a reader produces by pressing Glossary and then reloading
         the tab their import was in. */
      const later = await call("POST", "/api/jobs", {
        slug,
        steps: ["glossary"],
        useProfile: false,
      });
      expect(later.status, `refused with: ${String(later.body.error)}`).toBe(202);
      made.push(String(later.body.id));
      queued.push(String(later.body.id));
      expect(later.body.id).not.toBe(ingest);

      /* The reload. The claim is already taken, so this is the recovery path. */
      const again = await call("POST", "/api/jobs", { uploadId });
      expect(again.status, `refused with: ${String(again.body.error)}`).toBe(202);
      expect(again.body.id, "the reload was handed a later mode job on the same article").toBe(
        ingest,
      );
    } finally {
      if (was === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = was;
      await getDb().delete(jobsTable).where(inArray(jobsTable.id, made));
    }
  });

  /**
   * **An ingest that is over is still the answer**, which is the half the case
   * above cannot see: it keeps its ingest `queued` on purpose, so a `jobForUpload`
   * narrowed to the active statuses would pass it.
   *
   * The reader who imported a PDF, watched it finish, and then reloaded the tab
   * it happened in must be shown *that* job — the page navigates to the article
   * off a `done` job (src/web/AddPage.tsx) — rather than a 409 saying somebody
   * else has their file. The earlier review asked for this case and it did not
   * land.
   *
   * Watched red on 2026-09-02 with `jobForUpload` narrowed to
   * `queued`/`running`: *"a finished ingest was not found: expected 409 to be
   * 202"*.
   */
  it("hands back an ingest that has already finished, rather than refusing the reload", async () => {
    const minted = await call("POST", "/api/uploads", {
      filename: "finished-claim.pdf",
      bytes: 1024,
      sha256: "c".repeat(64),
    });
    expect(minted.status).toBe(201);
    const uploadId = String(minted.body.uploadId);
    /* The transfer, which the readiness gate now requires before anything
       may be queued from this id. */
    await land(uploadId);

    const was = process.env.VERCEL;
    process.env.VERCEL = "1";
    const made: string[] = [];
    try {
      const first = await call("POST", "/api/jobs", { uploadId });
      expect(first.status, `refused with: ${String(first.body.error)}`).toBe(202);
      const ingest = String(first.body.id);
      made.push(ingest);
      queued.push(ingest);

      /* Ended the way a real one ends — claimed, then finished under its own
         token — rather than by writing `done` into the record, so the job is
         terminal in every account the store keeps of it. */
      /* **A uuid, because `jobs.attempt_id` is one in the database.** Drizzle
         declares it `text` (src/db/schema.ts) and a custom migration made the
         column `uuid`, so a readable string is a `22P02` rather than a row —
         which the store scrubs to "this app asked its database for something it
         would not do". It was a readable string until 2026-09-05, when this
         claim went from `fsJobStore` (a Map, which took anything) to
         `pgJobStore`. `mintAttempt` is what production uses. */
      const attempt = mintAttempt();
      const claimed = await pgJobStore.claim(ingest, OWNER, attempt, 600_000, 4);
      expect(claimed.kind).toBe("claimed");
      await pgJobStore.finish(ingest, attempt, {
        status: "done",
        steps: (first.body.steps as JobStep[]).map((step) => ({ ...step, status: "done" })),
      });

      const again = await call("POST", "/api/jobs", { uploadId });
      expect(again.status, "a finished ingest was not found").toBe(202);
      expect(again.body.id).toBe(ingest);
      expect(again.body.status).toBe("done");
    } finally {
      if (was === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = was;
      await getDb().delete(jobsTable).where(inArray(jobsTable.id, made));
    }
  });

  /**
   * **And when the job record has gone, the upload record answers.**
   *
   * Finished jobs are trimmed to fifty per reader (`KEEP_FINISHED`,
   * src/jobs.ts). Modes are jobs now — a glossary, a set of ideas, a quiz are
   * three more rows on one article — so fifty is a fortnight rather than a year,
   * and after it the upload is still `claimed`, the article is still on the
   * shelf, and the reader reloading `/add/upload/<id>` was told *"That upload is
   * already being turned into an article."* about an article they finished
   * reading. GPT Sol, reviewing the built stage 1, finding 5.
   *
   * The upload record outlives the job by design — uploads are swept on their
   * grant, never trimmed by count — and it has carried the slug since the moment
   * `enqueue` returned. So the recovery asks it, and answers with the article
   * rather than with a job that no longer exists.
   *
   * `forgetForTests` is retention, done by hand: what the reader is left with is
   * a claimed upload, an article, and no job row.
   *
   * Watched red on 2026-09-02: *"the reader was refused their own article:
   * expected 409 to be 200"*.
   */
  it("answers from the upload record once the ingest job has been trimmed away", async () => {
    const minted = await call("POST", "/api/uploads", {
      filename: "trimmed-claim.pdf",
      bytes: 1024,
      sha256: "d".repeat(64),
    });
    expect(minted.status).toBe(201);
    const uploadId = String(minted.body.uploadId);
    /* The transfer, which the readiness gate now requires before anything
       may be queued from this id. */
    await land(uploadId);

    const was = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      const first = await call("POST", "/api/jobs", { uploadId });
      expect(first.status, `refused with: ${String(first.body.error)}`).toBe(202);
      const slug = String(first.body.slug);

      // Retention, arriving.
      await getDb().delete(jobsTable).where(eq(jobsTable.id, String(first.body.id)));

      const again = await call("POST", "/api/jobs", { uploadId });
      expect(again.status, "the reader was refused their own article").toBe(200);
      expect(again.body.article, "the answer has to name the article to be worth anything").toBe(
        slug,
      );
    } finally {
      if (was === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = was;
    }
  });
});
