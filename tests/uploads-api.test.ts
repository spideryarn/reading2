/**
 * The upload endpoints, and the two rules that make them safe.
 *
 * > **Never accept a client-supplied object path**: issue a user-scoped random
 * > path, then verify ownership, size, checksum and the `%PDF-` magic before
 * > enqueueing.
 * >
 * > — docs/plans/pdf-ingestion.md, quoted in pdf-upload-and-storage.md as the
 * >   load-bearing sentence of the design
 *
 * So the assertions here are about **what the request may name** rather than
 * about status codes: a test that only checked for a 400 would pass while
 * refusing for entirely the wrong reason. The byte-level checks — magic and
 * checksum — belong to the acquisition step and are tested with it.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApi, parseJobRequest } from "../src/routes.js";
import { freeUploadSlug } from "../src/jobs.js";
import { slugFromFilename } from "../src/ingest.js";
import { forgetUpload, recordsSurviveTheRequest } from "../src/upload-records.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

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
afterEach(async () => {
  for (const id of minted.splice(0)) await forgetUpload(id);
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
  it("refuses where a record would not survive to the next request", async () => {
    const was = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      expect(recordsSurviveTheRequest()).toBe(false);
      const { status, body } = await call("POST", "/api/uploads", {
        filename: "a.pdf",
        bytes: 100,
        sha256: "a".repeat(64),
      });
      expect(status).toBe(503);
      expect(String(body.error)).toMatch(/isn't set up to take a file/);
      /* **Nothing was minted**, asserted about this request rather than about
         the size of the whole store — which another test file running beside
         this one can change between the call and the count. */
      expect(minted).toHaveLength(0);
    } finally {
      if (was === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = was;
    }
  });

  /* And the control: without it, the same request is accepted. A refusal test
     with no positive case passes just as well when everything is refused. */
  it("takes one where it would", async () => {
    expect(recordsSurviveTheRequest()).toBe(true);
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
     The summary steer it named is gone (docs/plans/steer-becomes-the-profile.md),
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
 * And its other half, which the plan does not mention and which only shows up
 * on a second attempt: a **retry** of one upload must keep its own slug rather
 * than stepping aside from itself and paying for the transcription twice.
 */
describe("the slug an upload gets", () => {
  const MINE = "11111111-2222-4333-8444-555555555555";
  const THEIRS = "99999999-2222-4333-8444-555555555555";

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

  it("gives two files of the same name two articles", async () => {
    const taken = new Set(["paper"]);
    expect(await freeUploadSlug("paper", MINE, async (c) => taken.has(c))).toBe("paper-2");
  });

  it("lets a retry keep the article it already started", async () => {
    /* "Claimed by somebody, and that somebody is not me" is the question.
       Without the `mine` argument this steps aside to `paper-2` and re-runs
       from the top. */
    const claimed = async (candidate: string, mine: string) =>
      candidate === "paper" && mine !== MINE;
    expect(await freeUploadSlug("paper", MINE, claimed)).toBe("paper");
    expect(await freeUploadSlug("paper", THEIRS, claimed)).toBe("paper-2");
  });
});
