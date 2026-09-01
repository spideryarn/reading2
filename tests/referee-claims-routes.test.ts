/**
 * The two routes behind Referee's Claims — `/api/referee/claims/…` in
 * src/routes.ts.
 *
 * No server and no network: `handleApi` is a plain function over a request and a
 * response, the same harness tests/referee-criteria-routes.test.ts uses.
 * **Nothing here reaches a model**, and that is load-bearing rather than lucky:
 * the POST under test is refused before a single response header is written, so
 * a test that stopped failing would fail *loudly* — the fake response below has
 * no `writeHead` that survives being used for real work — rather than quietly
 * start spending money.
 *
 * What this file is actually for is the sentence *the route is wired to the
 * store and the guard runs before the stream opens*. `claimsProblem` and
 * `validateClaims` are tested as functions elsewhere; a guard nobody calls
 * passes its own tests perfectly.
 *
 * Writes under `data/<throwaway slug>/`, which is gitignored, and removes it.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { beginClaimsRun, loadClaimsRun } from "../src/referee-claims-store.js";
import { handleApi } from "../src/routes.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const SLUG = "test-referee-claims-routes";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
afterEach(() => rm(DIR, { recursive: true, force: true }));

interface Reply {
  status: number;
  body: Record<string, unknown>;
  /** True if anything wrote a response header — i.e. a stream was opened. */
  streamed: boolean;
}

async function call(method: string, url: string, body?: unknown): Promise<Reply> {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  let streamed = false;
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader() {},
    writeHead() {
      streamed = true;
    },
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  return { status, body: text ? JSON.parse(text) : {}, streamed };
}

const URL = `/api/referee/claims/${SLUG}`;

/**
 * An article on disk, with as many blocks as the caller asks for.
 *
 * `loadArticle` reads `blocks.json` **and** `tree.json` and skips the directory
 * unless both are there — so a fixture with only the first is a 404, which is
 * how the first version of this file mistook "the guard did not run" for "the
 * guard ran". Both files, or no test.
 */
async function article(blocks: { id: string; text: string }[]): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(path.join(DIR, "blocks.json"), JSON.stringify({ blocks }), "utf8");
  await writeFile(path.join(DIR, "tree.json"), JSON.stringify({ nodes: [] }), "utf8");
  await writeFile(path.join(DIR, "meta.json"), JSON.stringify({ title: "A paper" }), "utf8");
}

/** Ingestion has not finished: the article is there and has nothing in it. */
const emptyArticle = () => article([]);

/** A paper with something to read. */
const realArticle = () =>
  article([{ id: "spya-anc234", text: "We show that the method halves annotation time." }]);

describe("GET — reading the run back", () => {
  it("answers null for a paper nobody has asked, rather than 404", async () => {
    /* A paper with no claims run is the ordinary state, not a missing resource.
       The panel has a sentence for it and needs the 200 to render it. */
    await emptyArticle();
    const reply = await call("GET", URL);
    expect(reply.status).toBe(200);
    expect(reply.body.run).toBeNull();
  });

  it("returns the stored run and the paper's fingerprint together", async () => {
    /* Both halves in one response and read close together, for the reason
       `readSearches` gives: the paper can be re-extracted between two reads, and
       a run read before a hash read would be compared against an article it was
       never answered about. */
    await realArticle();
    await beginClaimsRun(SLUG);
    const reply = await call("GET", URL);
    expect(reply.status).toBe(200);
    expect(typeof reply.body.sourceHash).toBe("string");
  });

  it("sweeps an abandoned pending run into an error a referee can retry", async () => {
    /* Written before the model is called, precisely so a crash leaves evidence —
       and evidence nothing ever clears is a spinner for ever. This process is not
       running it, so the GET repairs it. */
    await realArticle();
    await beginClaimsRun(SLUG);
    const reply = await call("GET", URL);
    expect((reply.body.run as { status: string }).status).toBe("error");
    expect((await loadClaimsRun(SLUG))?.status).toBe("error");
  });
});

describe("POST — what has to be true before a model is called", () => {
  it("refuses a paper with no text, before a header is written", async () => {
    /* The one guard, and it is above `sse(res)` for the reason every route in
       this file keeps: after a header has gone out there is nowhere to put a
       400. A model asked to find claims in an empty article does not fail — it
       invents. */
    await emptyArticle();
    const reply = await call("POST", URL);
    expect(reply.status).toBe(400);
    expect(reply.streamed).toBe(false);
    expect(String(reply.body.error)).toMatch(/no text/i);
  });

  it("refuses a slug that is not an article at all", async () => {
    const reply = await call("POST", "/api/referee/claims/no-such-article-here");
    expect(reply.status).toBe(404);
    expect(reply.streamed).toBe(false);
  });

  it("writes nothing when it refuses", async () => {
    /* The `pending` row must not survive a request that never reached a model —
       it would sweep into an error the referee never caused, and the panel would
       offer Try again for a failure that did not happen. */
    await emptyArticle();
    await call("POST", URL);
    expect(await loadClaimsRun(SLUG)).toBeNull();
  });
});

describe("the methods it does not have", () => {
  /* One run per article, so there is no row to name, nothing to recolour and
     nothing to delete one of. A second POST replaces the first, which is what
     POST already means. */
  it("has no DELETE", async () => {
    await realArticle();
    expect((await call("DELETE", URL)).status).toBe(404);
  });

  it("has no PATCH", async () => {
    await realArticle();
    expect((await call("PATCH", URL, { colour: 1 })).status).toBe(404);
  });
});
