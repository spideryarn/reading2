/**
 * The four routes behind Referee's Criteria — `/api/referee/criteria/…` in
 * src/routes.ts.
 *
 * No server and no network: `handleApi` is a plain function over a request and
 * a response, which is the same harness tests/routes.test.ts uses. **Nothing
 * here reaches a model**, and that is load-bearing rather than lucky: every
 * request under test is refused by validation, and validation happens before a
 * single response header is written. A POST that got past it would open a
 * stream and try to call OpenRouter, so a test that stopped failing would fail
 * loudly rather than quietly start spending money.
 *
 * What this file is actually for is the sentence *the validators are wired to
 * the routes*. `criterionProblem` and the kind and scale guards are all tested
 * as functions elsewhere (tests/referee-criteria.test.ts); a validator nobody
 * calls passes its own tests perfectly.
 *
 * ## It ran on the filesystem store until 2026-09-04, and that is the point
 *
 * The fixture was a `data/<slug>/` directory and every read-back went through
 * `loadCriteria` (src/referee-criteria-store.ts), which reads the data root and
 * never consults `src/store/` — so this file had the same exposure as its
 * Claims sibling, the one that shipped filesystem-only and answered 501 in
 * production for four hours
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § B). It now pins `postgres` before any import, seeds through
 * `scratchArticleInPg`, and goes through `refereeCriteriaStore` — the same
 * object the route holds, so a store that read somewhere else could not satisfy
 * both ends.
 *
 * ### One assertion was dropped rather than translated
 *
 * The GET case used to end `expect("sourceHash" in reply.body).toBe(false)`,
 * and that was only ever true because the fixture had no `blocks.json` at all:
 * the store answered `undefined` and `JSON.stringify` deleted the key. Under
 * Postgres `refereeCriteria.articleId` is a NOT NULL foreign key and
 * `sourceHashFor` answers `undefined` only for a revision with **zero**
 * `revision_blocks` rows — a state the seeder cannot produce, because
 * `reasonsNotToPublish` refuses to publish a revision with no blocks. Rather
 * than manufacture a row so a filesystem-shaped guard could keep being tested,
 * the assertion is gone and its positive twin is in its place: the fingerprint
 * *is* a string, which is what a referee's criteria are dated against. What the
 * client makes of a missing key belongs to
 * tests/referee-criteria-panel.test.tsx § "answered about an older paper", as
 * the old comment already said.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, before **any** import runs — `src/store/live.ts`
 * reads the flag once and imports are hoisted above every statement. Same
 * block, same reason, as tests/referee-routes-postgres.test.ts.
 */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { CRITERION_ORPHAN_GRACE_MS } from "../src/routes.js";
import type { SavedCriterion } from "../src/saved-criteria.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-referee-criteria-routes";

const { reachable } = await pgReady({
  suite: "tests/referee-criteria-routes.test.ts",
  tables: ["spideryarn.referee_criteria", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { refereeCriteriaStore, STORE } = await import("../src/store/index.js");

if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  /* The positive control. Every assertion below passes just as happily against
     the filesystem store, which is how Claims — this sub-mode's twin — shipped
     with no Postgres store at all and a full route suite in front of it. */
  it("is the Postgres one", () => {
    expect(STORE).toBe("postgres");
  });
});

interface Reply {
  status: number;
  body: { error?: string; criteria?: { id: string; colour?: number }[]; [k: string]: unknown };
  /** True if anything wrote a response header — i.e. a stream was opened. */
  streamed: boolean;
}

/**
 * Drive `handleApi` with a fake request/response pair.
 *
 * The response deliberately has **no** `write` or `on`, exactly as
 * tests/routes.test.ts's `call` does: a request that got as far as streaming
 * would throw here rather than pass, which is what makes "validation happens
 * before a header" a property this file can actually check.
 */
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

const POST = `/api/referee/criteria/${SLUG}`;

/** Everything stored for this paper, as the reader the requests ran as. */
const stored = (): Promise<SavedCriterion[]> =>
  asTestOwner(() => refereeCriteriaStore.load(SLUG));

/** One criterion, begun through the store the route writes through. */
const begin = (criterion: string): Promise<SavedCriterion> =>
  asTestOwner(async () => (await refereeCriteriaStore.begin(SLUG, criterion, { kind: "single" })).row);

when("Referee's criteria routes", { timeout: 60_000 }, () => {
  let article: ScratchArticle;

  beforeAll(async () => {
    /* `ownerId: TEST_OWNER` and not the default: a request authenticated by
       ./helpers/authed.ts runs as `TEST_SUB`, and the Postgres reader filters
       every article by owner, so an article seeded as anybody else answers 404
       to everything — ./helpers/scratch-article.ts § `ScratchOptions.ownerId`. */
    article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  });

  /**
   * The criteria, and nothing a previous case wrote.
   *
   * Where the filesystem version threw the whole `data/<slug>/` directory away
   * after every case, which took the criteria with it. Deleting the rows and
   * keeping the article is the same reset: nothing here writes to the article,
   * and a published revision is not editable anyway.
   */
  beforeEach(async () => {
    if (!article) return;
    await asTestOwner(async () => {
      for (const row of await refereeCriteriaStore.load(SLUG)) {
        await refereeCriteriaStore.remove(SLUG, row.id);
      }
    });
  });

  afterAll(async () => {
    await article?.remove();
    await closeDb();
  });

  describe("POST — what a criterion has to be before a model is called", () => {
    it("refuses a body that is not an object at all", async () => {
      // `readBody` will happily return a bare JSON `null`; destructuring one is a
      // `TypeError` the generic handler turns into a 500, which is the one thing
      // validation must never do.
      const reply = await call("POST", POST, null);
      expect(reply.status).toBe(400);
      expect(reply.streamed).toBe(false);
    });

    it("refuses an empty criterion", async () => {
      const reply = await call("POST", POST, { criterion: "   ", kind: "single" });
      expect(reply.status).toBe(400);
      expect(reply.body.error).toMatch(/criterion/);
    });

    it("refuses a criterion long enough to push the paper out of the context window", async () => {
      const reply = await call("POST", POST, { criterion: "x".repeat(501), kind: "single" });
      expect(reply.status).toBe(400);
      expect(reply.body.error).toMatch(/500 characters/);
    });

    it("refuses a kind that is not one of the three", async () => {
      const reply = await call("POST", POST, { criterion: "Controls?", kind: "verdict" });
      expect(reply.status).toBe(400);
      expect(reply.body.error).toMatch(/single, diverging or literature/);
    });

    it("refuses a missing kind rather than guessing one", async () => {
      const reply = await call("POST", POST, { criterion: "Controls?" });
      expect(reply.status).toBe(400);
    });

    /* The rule the database also holds (`referee_criteria_diverging_shape`): a
       two-ended criterion with one pole has a signed number pointing at nothing,
       and the panel could not print the direction in words — which
       docs/project/colour-scales.md requires. */
    it("refuses a diverging criterion with no poles", async () => {
      const reply = await call("POST", POST, { criterion: "Controls?", kind: "diverging" });
      expect(reply.status).toBe(400);
      expect(reply.body.error).toMatch(/poles/);
    });

    it("refuses a diverging criterion with one pole", async () => {
      const reply = await call("POST", POST, {
        criterion: "Controls?",
        kind: "diverging",
        poles: { against: "missing" },
      });
      expect(reply.status).toBe(400);
    });

    it("refuses a diverging criterion whose poles are blank, saying which half", async () => {
      const reply = await call("POST", POST, {
        criterion: "Controls?",
        kind: "diverging",
        poles: { against: "  ", favour: "  " },
      });
      expect(reply.status).toBe(400);
      // `criterionProblem`'s own sentence, so the reason travels from the module
      // that owns the rule rather than being reworded at the route.
      expect(reply.body.error).toMatch(/a word for each end/);
    });

    it("refuses a scale that names no ramp we have", async () => {
      const reply = await call("POST", POST, {
        criterion: "Controls?",
        kind: "diverging",
        poles: { against: "missing", favour: "settled" },
        scale: "rainbow",
      });
      expect(reply.status).toBe(400);
      expect(reply.body.error).toMatch(/rg or br/);
    });

    it("writes nothing at all when a request is refused", async () => {
      await call("POST", POST, { criterion: "Controls?", kind: "diverging" });
      /* Not "the file does not exist" any more — the row does not exist, which
         is the same statement one store along: a refused request that leaves
         state behind is the shape docs/reusable/silent-success.md is about, one
         level down.

         **What this cannot tell you** is whether the read was scoped to this
         article: deleting `where article_id = …` from `criteriaFor` leaves this
         case green, because in a private database there is no other article's
         criterion for it to find. `tests/owner-isolation.test.ts` is what
         speaks for the predicate. */
      expect(await stored()).toEqual([]);
    });
  });

  describe("PATCH — the colour and nothing else", () => {
    it("refuses a colour neither store would write", async () => {
      const begun = await begin("Controls?");
      const reply = await call("PATCH", `${POST}/${begun.id}`, { colour: 1.5 });
      expect(reply.status).toBe(400);
      expect(reply.body.error).toMatch(/small whole number/);
    });

    it("takes slot 0, which every `if (!colour)` in this app would have refused", async () => {
      const begun = await begin("Controls?");
      const reply = await call("PATCH", `${POST}/${begun.id}`, { colour: 0 });
      expect(reply.status).toBe(200);
      expect((await stored())[0]?.colour).toBe(0);
    });

    it("takes null, which is how the referee asks for automatic", async () => {
      const begun = await begin("Controls?");
      await call("PATCH", `${POST}/${begun.id}`, { colour: 3 });
      const reply = await call("PATCH", `${POST}/${begun.id}`, { colour: null });
      expect(reply.status).toBe(200);
      const back = (await stored())[0];
      /* Absent, not `null`: Postgres hands back a null where the file simply
         had no key, and `toCriterion`'s conditional spread is what keeps the
         two wire forms the same. A `"colour": null` is a third state for a
         field with two. */
      expect(back && "colour" in back).toBe(false);
    });

    /* **`{ colour }` and nothing else.** Changing the question is what POST does,
       because a changed question needs a fresh model call and this route makes
       none — a PATCH that quietly rewrote the criterion would leave results on
       screen that answer a question nobody asked. */
    it("ignores everything but the colour", async () => {
      const begun = await begin("Controls?");
      await call("PATCH", `${POST}/${begun.id}`, {
        colour: 2,
        criterion: "something else entirely",
        kind: "diverging",
      });
      const back = (await stored())[0];
      expect(back?.criterion).toBe("Controls?");
      expect(back?.config).toEqual({ kind: "single" });
      expect(back?.colour).toBe(2);
    });

    it("refuses a bare JSON null body with a 400 rather than a 500", async () => {
      const begun = await begin("Controls?");
      const reply = await call("PATCH", `${POST}/${begun.id}`, null);
      expect(reply.status).toBe(400);
    });
  });

  describe("DELETE", () => {
    it("removes the criterion and answers with what is left", async () => {
      const a = await begin("Controls?");
      await begin("Prior work?");
      const reply = await call("DELETE", `${POST}/${a.id}`);
      expect(reply.status).toBe(200);
      expect(reply.body.criteria).toHaveLength(1);
      expect(reply.body.criteria?.[0]?.id).not.toBe(a.id);
    });
  });

  describe("GET", () => {
    it("lists the criteria and the fingerprint to judge them against", async () => {
      await begin("Controls?");
      const reply = await call("GET", POST);
      expect(reply.status).toBe(200);
      expect(reply.body.criteria).toHaveLength(1);
      /* **The fingerprint, and it is a string here.** The filesystem fixture had
         no blocks at all, so this used to assert the key was *absent*; see the
         header for why that state cannot exist in Postgres and why the
         assertion was dropped rather than propped up. What must never happen is
         a hash that dates the criteria to an article nobody read — hence the
         read of both halves in one response. */
      expect(typeof reply.body.sourceHash).toBe("string");
    });

    it("sweeps a pending criterion no process is running, so it can be run again", async () => {
      const begun = await begin("Controls?");

      /* **The clock is moved, not the row.** The filesystem store swept a
         pending criterion the instant anybody looked, because `beginCriterion`
         there records no attempt at all and `sweepPending` treats a row with no
         attempt as abandoned outright. Postgres stamps `attempt_started_at`
         with `clock_timestamp()` and leaves the row alone for
         `CRITERION_ORPHAN_GRACE_MS` — 150 seconds, sized for a `literature` run
         that goes to the web — because on Vercel the process being asked is not
         the process that is running the criterion.

         So the state this case is about is *time having passed*, and that is
         what is faked: only `Date`, so the pg driver's own timers still run,
         and the row's timestamp is still the database's own. Doctoring
         `attempt_started_at` with an `UPDATE` would be the alternative, and
         tests/store-parity-referee.test.ts § `staleStart` records what that
         cost when it was tried. */
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date(Date.now() + CRITERION_ORPHAN_GRACE_MS + 60_000));
        const reply = await call("GET", POST);
        const row = reply.body.criteria?.find((c) => c.id === begun.id) as
          | { status?: string }
          | undefined;
        expect(row?.status).toBe("error");
      } finally {
        vi.useRealTimers();
      }
    });

    it("leaves a criterion this process just started alone", async () => {
      /* The other half of the sweep, and it did not exist while this file ran
         on files: there is no grace window in that store to get wrong. Without
         it, a sweep that ignored `attempt_started_at` would pass every test
         here while erroring, on Vercel, every criterion another lambda was
         halfway through answering. */
      const begun = await begin("Controls?");
      const reply = await call("GET", POST);
      const row = reply.body.criteria?.find((c) => c.id === begun.id) as
        | { status?: string }
        | undefined;
      expect(row?.status).toBe("pending");
    });
  });
});
