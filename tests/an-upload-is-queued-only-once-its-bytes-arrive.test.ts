/**
 * **The readiness gate: no object, no job.**
 *
 * `POST /api/jobs { uploadId }` never had to ask whether the file was there.
 * It could not not be: the shelf ran the transfer and navigated to
 * `/add/upload/<id>` only when the last byte had landed, so the address did not
 * exist until the object did.
 *
 * That changed on 2026-09-03. The reader gets the address at byte **zero** now,
 * so they can walk away from a slow upload
 * (docs/plans/260903j-background-pdf-upload-so-add-does-not-wait.md) — and three
 * ordinary gestures then point the queue at a file that has not arrived:
 *
 *  - reload `/add/upload/<id>` while it is still going;
 *  - open the same address in a second tab;
 *  - press Stop, and then reload.
 *
 * Each of those used to queue a job. `acquireUpload` (src/pipeline.ts) answers a
 * missing staging object with `refuse("missing")`, which is **terminal** — the
 * record goes to `rejected` and the reader is told the file never finished
 * arriving. So a reader's own reload destroyed an upload that was moving
 * perfectly. GPT Sol found it reviewing the plan, and it is the finding the
 * gate exists for.
 *
 * ## Why a `head` and not a `ready` column
 *
 * A column needs a writer, and the only candidate is the browser saying *I have
 * finished* — a claim by the party being checked, and a second source of truth
 * that can disagree with the bucket. The object is the fact itself.
 *
 * It is also a true test rather than a proxy: measured on 2026-09-03 against the
 * local Supabase stack, a PUT aborted at 320 KB of 5 MB leaves **no object at
 * all**, so there is no half-written object for `head` to mistake for a whole
 * one. The table is in the plan.
 *
 * ## Watched red
 *
 * With the `uploadHasArrived` call deleted from the route, 2026-09-03: the three
 * cases below that expect 409 all returned 202 and queued a job, which is
 * exactly the bug. `npx vitest run tests/an-upload-is-queued-only-once-its-bytes-arrive.test.ts`.
 *
 * The blob store here is the **Supabase** one, against the local stack:
 * importing `src/routes.js` loads `.env.local`, and `blobStore()` follows the
 * credentials rather than `SPIDERYARN_STORE` (src/store/blobs.ts). So `land()`
 * below writes a real object to the real `sources` bucket and the gate reads it
 * back over HTTP, which is the adapter production uses. Worth knowing before
 * changing anything here: these tests need the local Supabase up.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { handleApi } from "../src/routes.js";
import { UPLOAD_STILL_ARRIVING } from "../src/messages.js";
import { stagingKey } from "../src/source.js";
import { blobStore, CONTENT_TYPE } from "../src/store/blobs.js";
import { inArray } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { jobs as jobsTable } from "../src/db/schema.js";
import { forgetUpload } from "../src/upload-records.js";
import { pgUploadStore } from "../src/store/pg-uploads.js";
import { acceptAny, AUTHED_HEADERS, TEST_SUB } from "./helpers/authed.js";

/** The reader `AUTHED_HEADERS` is. Records written straight to the store need it. */
const OWNER = TEST_SUB;

/** A minimal but genuine PDF, so nothing downstream refuses it for its bytes. */
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

/** Ids this file minted, and the staging keys it wrote. Only ever its own. */
const minted: string[] = [];
const wrote: string[] = [];
const queued: string[] = [];

afterEach(async () => {
  /* **Jobs first, and by SQL rather than through `forgetJob`.**
     `jobs.upload_id` is a foreign key into `uploads`, so an upload cannot go
     while a job names it — and `pgJobStore.forget` only deletes a **terminal**
     job. Every job here is left `queued`, on purpose (`VERCEL=1` stops the
     pump), so the polite route cannot clean up after these. Only ids this
     file's own responses named. It went through the filesystem queue until
     2026-09-05, where nothing had a foreign key. */
  if (queued.length > 0) {
    await getDb().delete(jobsTable).where(inArray(jobsTable.id, queued.splice(0)));
  }
  for (const id of minted.splice(0)) await forgetUpload(id);
  for (const key of wrote.splice(0)) await blobStore().remove(key);
});

afterAll(async () => {
  await closeDb();
});

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
    /* Worth seeing in the failure message rather than swallowing. */
  }
  if (typeof parsed.uploadId === "string") minted.push(parsed.uploadId);
  if (typeof parsed.id === "string" && pathname === "/api/jobs") queued.push(parsed.id);
  return { status: res.statusCode, body: parsed };
}

/**
 * Mint a grant the way the shelf does, and hand back the id.
 *
 * **It takes `VERCEL` off for its own duration**, which was load-bearing until
 * 2026-09-05 and is now belt and braces. The flag the tests below set to stop
 * the worker *also* stopped minting: `recordsSurviveTheRequest` refused a grant
 * on a host whose **filesystem** could not carry the record to the next
 * request, and asked for with the flag on this answered 503 *"Uploading isn't
 * switched on here"* — a whole run of `tests/uploads-api.test.ts` lost to what
 * read like a broken environment. There is one store and it is durable
 * everywhere, so that answer is now `true` unconditionally
 * ([`src/upload-records.ts`](../src/upload-records.ts)). Left in place: the
 * cases below are about the readiness gate, not about which host they are on,
 * and taking the flag off keeps them saying so.
 */
async function mint(filename: string): Promise<string> {
  const was = process.env.VERCEL;
  delete process.env.VERCEL;
  try {
    const reply = await call("POST", "/api/uploads", {
      filename,
      bytes: PDF.byteLength,
      sha256: "c".repeat(64),
    });
    expect(reply.status, `minting refused: ${String(reply.body.error)}`).toBe(201);
    return String(reply.body.uploadId);
  } finally {
    if (was !== undefined) process.env.VERCEL = was;
  }
}

/** What the browser's PUT would have done. */
async function land(uploadId: string): Promise<void> {
  const key = stagingKey(uploadId);
  await blobStore().putIfAbsent(key, PDF, CONTENT_TYPE.pdf);
  wrote.push(key);
}

/**
 * **`VERCEL`, so `enqueue` does not start driving what it queues.** `pump`
 * returns immediately when it is set (src/jobs.ts). Without it the ingest runs
 * here, in the test process, and reaches conclusions of its own about a fixture
 * PDF — none of which is what any of this is about.
 */
async function withoutTheWorker<T>(body: () => Promise<T>): Promise<T> {
  const was = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    return await body();
  } finally {
    if (was === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = was;
  }
}

describe("POST /api/jobs { uploadId } before the bytes have landed", () => {
  it("refuses, and leaves the upload exactly as it found it", async () => {
    await withoutTheWorker(async () => {
      const uploadId = await mint("still-arriving.pdf");

      const reply = await call("POST", "/api/jobs", { uploadId });
      expect(reply.status).toBe(409);
      expect(String(reply.body.error)).toBe(UPLOAD_STILL_ARRIVING.message);

      /* **The claim is the thing that must not have been spent.** A refusal
         that took it would leave the upload `claimed` with no job — reachable
         only by choosing the file again, which is precisely what this whole
         piece of work exists to avoid making people do. Asserted through the
         API rather than the store, because the API is what the waiting page
         reads. */
      const after = await call("GET", `/api/uploads/${uploadId}`);
      expect(after.status).toBe(200);
      expect(after.body.status).toBe("pending");
    });
  });

  it("takes it once the object is there, from the very same request", async () => {
    /* The control. A gate with no positive case passes just as well when
       everything is refused, which is the shape this repo keeps writing up
       (docs/reusable/silent-success.md). */
    await withoutTheWorker(async () => {
      const uploadId = await mint("arrives-eventually.pdf");

      const early = await call("POST", "/api/jobs", { uploadId });
      expect(early.status).toBe(409);

      await land(uploadId);

      const late = await call("POST", "/api/jobs", { uploadId });
      expect(late.status, `refused with: ${String(late.body.error)}`).toBe(202);
      expect(late.body.upload).toMatchObject({ id: uploadId });
    });
  });

  it("says the same thing however many times the page is reloaded", async () => {
    /* The reload loop, which is the reader's actual gesture: the page posts,
       waits, and posts again. Each one must be free — no claim, no job — or the
       second one answers something different from the first about a file that
       has not changed. */
    await withoutTheWorker(async () => {
      const uploadId = await mint("reloaded-thrice.pdf");
      for (let i = 0; i < 3; i += 1) {
        const reply = await call("POST", "/api/jobs", { uploadId });
        expect(reply.status, `attempt ${i + 1}`).toBe(409);
      }
      expect(queued, "a reload queued a job over a file that is not there").toHaveLength(0);
    });
  });

  it("never queues a cancelled transfer, however long the address is left open", async () => {
    /* Cancelling tells the server nothing — the record stays `pending` and the
       object is never written (src/web/uploadEngine.ts, and the plan's *What
       this does not fix*). The gate is what makes that silence safe: there is
       no object, so there is nothing to queue, for ever. Before it, pressing
       Stop and then reloading the address turned the cancelled upload into a
       job that failed terminally. */
    await withoutTheWorker(async () => {
      const uploadId = await mint("stopped-half-way.pdf");
      expect((await call("POST", "/api/jobs", { uploadId })).status).toBe(409);
      expect((await call("POST", "/api/jobs", { uploadId })).status).toBe(409);
      expect(queued).toHaveLength(0);
    });
  });

  it("says on the record whether the bytes are there, so a waiting page can poll a GET", async () => {
    /* The other half of the gate, and the reason it is a `GET`. A tab that
       reloaded mid-transfer holds no `File` and no XHR — it cannot know when the
       other tab has finished — so it watches this rather than re-POSTing
       `/api/jobs` on a timer, which would be a mutation on a loop.

       Both states in one case on purpose: `arrived: false` alone passes just as
       well against a field hardcoded to false. */
    const uploadId = await mint("watched-from-another-tab.pdf");

    const before = await call("GET", `/api/uploads/${uploadId}`);
    expect(before.status).toBe(200);
    expect(before.body.arrived).toBe(false);

    await land(uploadId);

    const after = await call("GET", `/api/uploads/${uploadId}`);
    expect(after.body.arrived).toBe(true);
    /* Still `pending`: watching is not claiming, and a poll that moved the
       record would make a reload of the waiting page a write. */
    expect(after.body.status).toBe("pending");
  });

  it("is not the answer for an id that was never minted", async () => {
    /* 404, not the gate's 409. They are different questions and a reader acts
       on them differently: one is "wait", the other is "that is not yours".
       The check that says so has to run *before* the `head`, or an id belonging
       to somebody else would be told to keep waiting. */
    const { status } = await call("POST", "/api/jobs", {
      uploadId: "99999999-2222-4333-8444-555555555555",
    });
    expect(status).toBe(404);
  });
});

describe("a grant that has run out, over bytes we are holding", () => {
  it("still queues, because the object is there", async () => {
    /* **The plan ticked this box before the test existed**, which GPT Sol caught
       reviewing the built code — the worst kind of error, a plan claiming
       evidence it had not got. Here it is.

       The grant's two-hour expiry exists to stop us claiming an upload whose
       bytes never came. A successful `head` answers that question better, from
       the authoritative place, so `claimUpload` is passed `arrived: true` and
       drops the expiry predicate (`UploadStore.claim`). Without it a reader
       refused on quota, who upgrades three hours later, is told their file
       expired while we are holding it — and a very slow PUT that starts inside
       the window and finishes outside it lands in the same dead end.

       The record is written straight through the store, because there is no way
       to ask the API for a grant that is already old. Watched red by restoring
       the expiry clause: 410, *"That file never finished arriving."* */
    await withoutTheWorker(async () => {
      const id = randomUUID();
      const longAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      await pgUploadStore.create({
        id,
        owner: OWNER,
        filename: "held-past-its-grant.pdf",
        claimedBytes: PDF.byteLength,
        claimedSha256: "e".repeat(64),
        status: "pending",
        mintedAt: longAgo,
        grantExpiresAt: longAgo,
      });
      minted.push(id);
      await land(id);

      const reply = await call("POST", "/api/jobs", { uploadId: id });
      expect(reply.status, `refused with: ${String(reply.body.error)}`).toBe(202);
    });
  });

  it("and refuses when there is nothing at the key after all", async () => {
    /* The control, and the half the expiry still does. An expired grant with no
       object is an upload that never arrived and never will — the gate answers
       first, so the reader is told to wait rather than told it expired, and
       either way nothing is claimed. */
    await withoutTheWorker(async () => {
      const id = randomUUID();
      const longAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      await pgUploadStore.create({
        id,
        owner: OWNER,
        filename: "never-came.pdf",
        claimedBytes: PDF.byteLength,
        claimedSha256: "f".repeat(64),
        status: "pending",
        mintedAt: longAgo,
        grantExpiresAt: longAgo,
      });
      minted.push(id);

      const reply = await call("POST", "/api/jobs", { uploadId: id });
      expect(reply.status).toBe(409);
      expect(queued).toHaveLength(0);
    });
  });
});

describe("the reader pressed Stop", () => {
  it("is answered rather than polled at, however often the address is opened", async () => {
    /* **Found in a browser on 2026-09-03, not by a review.** Stop was a fact
       this tab knew and nobody else did, so a reload of `/add/upload/<id>` found
       a `pending` record with no object and settled into *"That file is still on
       its way"* — polling for the two hours of the grant, about a transfer that
       had been cancelled a second earlier.

       `DELETE /api/uploads/:id` moves it `pending → expired`, which is a
       transition the state machine already had. 410 with the server's own
       sentence, and nothing queued, for ever. */
    await withoutTheWorker(async () => {
      const uploadId = await mint("stopped-and-told.pdf");

      const stopped = await call("DELETE", `/api/uploads/${uploadId}`);
      expect(stopped.status).toBe(200);
      expect(stopped.body.cancelled).toBe(true);

      const reply = await call("POST", "/api/jobs", { uploadId });
      expect(reply.status, "a cancelled upload was not refused outright").toBe(410);
      expect(String(reply.body.error)).not.toBe(UPLOAD_STILL_ARRIVING.message);

      const seen = await call("GET", `/api/uploads/${uploadId}`);
      expect(seen.body.status, "the waiting page had nothing to stop on").toBe("expired");
      expect(queued).toHaveLength(0);
    });
  });

  it("loses to a queue request that got there first", async () => {
    /* The race `cancelUpload` documents. A Stop that arrives after the claim is
       a Stop that arrived too late, and the honest answer is to let the ingest
       stand — the reader is about to be shown the running job. `cancelled:
       false` says which happened without making it an error. */
    await withoutTheWorker(async () => {
      const uploadId = await mint("stopped-too-late.pdf");
      await land(uploadId);

      const first = await call("POST", "/api/jobs", { uploadId });
      expect(first.status, `refused with: ${String(first.body.error)}`).toBe(202);

      const late = await call("DELETE", `/api/uploads/${uploadId}`);
      expect(late.status).toBe(200);
      expect(late.body.cancelled, "a claimed upload was cancelled out from under its job").toBe(
        false,
      );
    });
  });
});

describe("a repeat claim, once the ingest exists", () => {
  it("hands back the same job rather than making a second one", async () => {
    /* The recovery `tests/uploads-api.test.ts` covers in depth. Here only for
       the ordering the gate introduced: the repeat is resolved **before**
       `uploadHasArrived` and before the quota slot, so an upload whose staging
       object has been swept, or whose grant is long dead, still finds its own
       ingest. Reversing those two lines makes this red. */
    await withoutTheWorker(async () => {
      const uploadId = await mint("repeat-after-arrival.pdf");
      await land(uploadId);

      const first = await call("POST", "/api/jobs", { uploadId });
      expect(first.status, `refused with: ${String(first.body.error)}`).toBe(202);

      /* The object goes, exactly as a sweep would eventually take it. */
      await blobStore().remove(stagingKey(uploadId));
      wrote.splice(wrote.indexOf(stagingKey(uploadId)), 1);

      const again = await call("POST", "/api/jobs", { uploadId });
      expect(again.status, `refused with: ${String(again.body.error)}`).toBe(202);
      expect(again.body.id).toBe(first.body.id);
    });
  });
});
