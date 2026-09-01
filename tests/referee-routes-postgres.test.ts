/**
 * **Referee mode's routes, driven against the store that actually deploys.**
 *
 * Claims shipped on 2026-08-31 with a filesystem store and no Postgres one, so
 * under `SPIDERYARN_STORE=postgres` — which production has run since
 * 2026-08-27 — `GET` and `POST /api/referee/claims/:slug` both answered 501 and
 * *"Pull the paper's claims"* could not load, start or persist a run for
 * anybody. **No route test noticed**, because `SPIDERYARN_STORE` unset means
 * `files` (src/store/live.ts) and every route suite in this directory runs on
 * the default.
 * docs/postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md;
 * stage 3 of docs/plans/260901f-referee-mode-on-the-database-and-the-parity-that-would-have-caught-it.md.
 *
 * ## Why a separate suite rather than pinning the existing ones
 *
 * Three options were open, and this is the argument for the one taken.
 *
 * **Pinning `tests/referee-claims-routes.test.ts` and
 * `tests/referee-criteria-routes.test.ts` to `postgres`** would have cost the
 * property the first of those states in its own header — *nothing here reaches a
 * model, and that is load-bearing rather than lucky* — because both files build
 * their fixture as `data/<slug>/blocks.json` and then read the result back
 * through `loadClaimsRun` and friends, which are the **filesystem** functions.
 * Pinning them means rewriting every fixture and every assertion, in two files
 * several sessions are inside, and the rewrite is where that property would have
 * been dropped.
 *
 * **Running them twice, once per store**, cannot be done inside one file at all:
 * `STORE` is read once at module load, deliberately (src/store/live.ts — "a
 * store that could change under a running request is a much worse thing to debug
 * than one that needs a restart"). One process is one store. So "twice" means a
 * second vitest project with a different env, which is real infrastructure and
 * doubles the runtime of every suite in it to cover two that needed it.
 *
 * **So: a small suite that pins the flag and says so.** The existing suites keep
 * their fixtures, their speed and their no-model guarantee; this one owns the
 * sentence *these routes work under Postgres*, needs a database, and fails
 * rather than skips under `REQUIRE_POSTGRES=1`. The cost is honest and worth
 * writing down: **the route logic is asserted on files and the store wiring is
 * asserted here**, so a guard added to a route without a case here is still only
 * tested on the store that does not deploy.
 *
 * ## Nothing here reaches a model either, and it is bought differently
 *
 * The two POSTs are the paying routes, so `runClaimsStream` and
 * `runCriterionStream` are mocked — the move
 * `tests/referee-claims-omitted.test.ts` makes, and for its reason: mocking them
 * *there* would have taken the no-model sentence away from the file that states
 * it, so the mock lives in the file whose header says it is there.
 *
 * `importActual` and spread, never a bare object: `src/store/pg-referee-claims.ts`
 * imports `CLAIMS_TIMEOUT_MS` from `referee-claims-run.js`, and replacing the
 * whole module leaves that store with an undefined constant and the import graph
 * falls over before a single test runs.
 *
 * ## What it covers
 *
 * Every `/api/referee/criteria/…` and `/api/referee/claims/…` method — the two
 * sub-modes with a store seam each. `/api/referee/mirror` and
 * `/api/referee/scan` are deliberately out: neither stores anything, so neither
 * has a store to be missing.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, before **any** import runs — the same block, for
 * the same reason, as tests/comment-referee-mark.test.ts and
 * tests/chat-route.test.ts. `STORE` is read once at module load, so setting it
 * after the first import of `src/store/index.js` would set nothing and the
 * suite would quietly test the filesystem again — which is the whole bug.
 */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import type { Claim } from "../src/referee-claims.js";
import type { RefereeResult } from "../src/referee-criteria.js";
import type { SavedCriterion } from "../src/saved-criteria.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

/** The one claim the mocked run answers with, anchored to the fixture at setup. */
let CLAIM: Claim;
/** The one result the mocked criterion run answers with, likewise. */
let RESULT: RefereeResult;

vi.mock("../src/referee-claims-run.js", async () => ({
  ...(await vi.importActual<typeof import("../src/referee-claims-run.js")>(
    "../src/referee-claims-run.js",
  )),
  runClaimsStream: async function* () {
    yield {
      type: "done" as const,
      outcome: {
        claims: [CLAIM],
        model: "a-test-model",
        dropped: { malformed: 0, unknownIds: 0, unquoted: 0, truncated: 0 },
        withheld: [],
      },
    };
  },
}));

vi.mock("../src/referee-criteria-run.js", async () => ({
  ...(await vi.importActual<typeof import("../src/referee-criteria-run.js")>(
    "../src/referee-criteria-run.js",
  )),
  runCriterionStream: async function* () {
    yield {
      type: "done" as const,
      outcome: {
        results: [RESULT],
        model: "a-test-model",
        dropped: { malformed: 0, unknownIds: 0, unquoted: 0, uncited: 0, clampedValence: 0 },
      },
    };
  },
}));

const SLUG = "test-referee-routes-postgres";
const ABSENT = "test-referee-routes-postgres-no-such-article";

const { reachable } = await pgReady({
  suite: "tests/referee-routes-postgres.test.ts",
  tables: ["spideryarn.referee_criteria", "spideryarn.referee_claims"],
  max: 2,
});

const { handleApi } = await import("../src/routes.js");
const { refereeClaimsStore, refereeCriteriaStore, STORE } = await import("../src/store/index.js");

if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  /* **The positive control, and it is not decoration.** Every assertion below
     passes just as happily against the filesystem store, which is exactly how
     the 501 survived a full route suite. If this line goes red, nothing else in
     this file means what it says. */
  it("is the Postgres one", () => {
    expect(STORE).toBe("postgres");
  });
});

interface Reply {
  status: number;
  /** The JSON body, for the routes that send one. */
  body: Record<string, unknown>;
  /** The raw text, which for the two streaming routes is the SSE frames. */
  text: string;
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
    setHeader: () => {},
    writeHead: (code: number) => {
      status = code;
      streamed = true;
      return res;
    },
    write: (chunk: unknown) => {
      text += String(chunk);
      return true;
    },
    end: (chunk?: unknown) => {
      if (chunk !== undefined) text += String(chunk);
    },
    on: () => res,
    once: () => res,
    removeListener: () => res,
    emit: () => false,
    flushHeaders: () => {},
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* An SSE body is not JSON. `text` is the assertion for those routes. */
  }
  return { status, body: parsed, text, streamed };
}

/** The `data:` payload of the last frame with this event name. */
function frame(text: string, event: string): Record<string, unknown> | undefined {
  const found = [...text.matchAll(new RegExp(`event: ${event}\\ndata: (.*)\\n\\n`, "g"))].at(-1);
  return found?.[1] ? (JSON.parse(found[1]) as Record<string, unknown>) : undefined;
}

when("Referee's routes under SPIDERYARN_STORE=postgres", { timeout: 60_000 }, () => {
  let article: ScratchArticle;

  beforeAll(async () => {
    /* `ownerId: TEST_OWNER` and not the default. A request authenticated by
       ./helpers/authed.ts runs as `TEST_SUB`, and the Postgres reader filters
       every article by owner — so an article seeded as the environment's owner
       is invisible and every route answers 404, which looks exactly like a
       broken route. ./helpers/scratch-article.ts § `ScratchOptions.ownerId`. */
    article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
    expect(article.copied).toContain("blocks");

    const block = article.blocks.find((b) => b.text.length > 40);
    if (!block) throw new Error("the fixture has no block long enough to quote");
    const quote = block.text.slice(0, 20);

    CLAIM = {
      id: `${block.id}:0`,
      claim: "The paper claims something about itself.",
      blockId: block.id,
      quote,
      start: 0,
      passages: [{ blockId: block.id, quote, start: 0, reasoning: "where it says so" }],
      discarded: 0,
    };
    RESULT = {
      kind: "single",
      blockId: block.id,
      quote,
      start: 0,
      confidence: 80,
      reasoning: "bears on the criterion",
    };
  });

  afterAll(async () => {
    await article?.remove();
    await closeDb();
  });

  /* --------------------------------------------------------------- claims -- */

  it("reads a claims run back, where it used to answer 501", async () => {
    /* The exact call that was broken in production: `GET` reaches
       `refereeClaimsStore.sweep` and `.sourceHash`, both of which refused
       through `notMigrated`. A paper nobody has asked is a 200 with `run: null`
       — the ordinary state, which the panel has a sentence for. */
    const reply = await call("GET", `/api/referee/claims/${SLUG}`);
    expect(reply.status, `GET answered ${reply.status}: ${reply.text.slice(0, 300)}`).toBe(200);
    expect(reply.body.run).toBeNull();
    expect(typeof reply.body.sourceHash).toBe("string");
  });

  it("starts a run, stores it in Postgres, and reads it back through the route", async () => {
    /* `POST` reaches `begin` **and** `finish`, which is the write half of the
       seam and the half a read-only test cannot see. The model is mocked; see
       the header. */
    const posted = await call("POST", `/api/referee/claims/${SLUG}`);
    expect(posted.streamed, `the POST never opened a stream: ${posted.text.slice(0, 300)}`).toBe(
      true,
    );
    expect(frame(posted.text, "done")?.status).toBe("done");

    /* Out of the **Postgres** store, by name rather than through whatever the
       route happens to hold: a route that wrote a file and read it back would
       satisfy the round trip above and lose the data in production. */
    const stored = await asTestOwner(() => refereeClaimsStore.load(SLUG));
    expect(stored?.status).toBe("done");
    expect(stored?.claims).toHaveLength(1);
    expect(stored?.model).toBe("a-test-model");

    const reply = await call("GET", `/api/referee/claims/${SLUG}`);
    expect((reply.body.run as { status: string }).status).toBe("done");
  });

  it("refuses a slug that is not an article, before a header is written", async () => {
    /* Under Postgres this 404 comes out of `ownedSlug` rather than out of a
       missing directory, which is a different code path answering the same way.
       `streamed` is the assertion that matters: after a header has gone out
       there is nowhere to put a 404. */
    const reply = await call("POST", `/api/referee/claims/${ABSENT}`);
    expect(reply.status).toBe(404);
    expect(reply.streamed).toBe(false);
  });

  /* ------------------------------------------------------------- criteria -- */

  it("lists criteria, where the sweep and the fingerprint both run", async () => {
    const reply = await call("GET", `/api/referee/criteria/${SLUG}`);
    expect(reply.status, `GET answered ${reply.status}: ${reply.text.slice(0, 300)}`).toBe(200);
    expect(reply.body.criteria).toEqual([]);
    expect(typeof reply.body.sourceHash).toBe("string");
  });

  it("saves a criterion, recolours it and deletes it, all in Postgres", async () => {
    const id = "spya-rtp234";
    const posted = await call("POST", `/api/referee/criteria/${SLUG}`, {
      id,
      criterion: "Are the controls adequate?",
      kind: "single",
    });
    expect(posted.streamed, `the POST never opened a stream: ${posted.text.slice(0, 300)}`).toBe(
      true,
    );
    expect(frame(posted.text, "done")?.status).toBe("done");

    const stored = await asTestOwner(() => refereeCriteriaStore.load(SLUG));
    expect(stored.map((c: SavedCriterion) => c.id)).toEqual([id]);
    expect(stored[0]?.results).toHaveLength(1);

    /* PATCH and DELETE are the two Referee routes with no model behind them at
       all, and they are the two most likely to be forgotten when a store is
       written — `recolour` and `remove` are the last methods anybody implements. */
    const patched = await call("PATCH", `/api/referee/criteria/${SLUG}/${id}`, { colour: 3 });
    expect(patched.status).toBe(200);
    expect((patched.body.criteria as SavedCriterion[])[0]?.colour).toBe(3);

    const cleared = await call("PATCH", `/api/referee/criteria/${SLUG}/${id}`, { colour: null });
    expect(cleared.status).toBe(200);
    // Absent, not `null`: a `"colour": null` on the wire is a third state for a
    // field with two, and Postgres is where that near-miss comes from.
    expect("colour" in ((cleared.body.criteria as SavedCriterion[])[0] ?? {})).toBe(false);

    const deleted = await call("DELETE", `/api/referee/criteria/${SLUG}/${id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.criteria).toEqual([]);
    expect(await asTestOwner(() => refereeCriteriaStore.load(SLUG))).toEqual([]);
  });
});
