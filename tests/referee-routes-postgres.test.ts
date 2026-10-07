/**
 * **Referee mode's routes, driven against the store that actually deploys.**
 *
 * Claims shipped on 2026-08-31 with a filesystem store and no Postgres one, so
 * under `SPIDERYARN_STORE=postgres` — which production has run since
 * 2026-08-27 — `GET` and `POST /api/referee/claims/:slug` both answered 501 and
 * *"Pull the paper's claims"* could not load, start or persist a run for
 * anybody. **No route test noticed**, because `SPIDERYARN_STORE` unset meant
 * `files` and every route suite in this directory ran on the default.
 * docs/postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md;
 * stage 3 of docs/plans/260901f-referee-mode-on-the-database-and-the-parity-that-would-have-caught-it.md.
 *
 * ## Why a separate suite rather than pinning the existing ones
 *
 * Three options were open, and this is the argument for the one taken. Written
 * 2026-09-01; the two suites named below were converted to Postgres on
 * 2026-09-04 and the filesystem store went on 2026-09-05, so the rest of this
 * section is history.
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
 * `STORE` was read once at module load, deliberately — "a store that could
 * change under a running request is a much worse thing to debug than one that
 * needs a restart". One process was one store. So "twice" meant a
 * second vitest project with a different env, which is real infrastructure and
 * doubles the runtime of every suite in it to cover two that needed it.
 *
 * **So: a small suite of its own.** The existing suites kept their fixtures,
 * their speed and their no-model guarantee; this one owns the sentence *these
 * routes work under Postgres*, needs a database, and fails rather than skips
 * without one (tests/helpers/pg-ready.ts).
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

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { asc, eq, inArray, sql } from "drizzle-orm";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { refereeCriteria } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import type { Claim } from "../src/referee-claims.js";
import type { RefereeResult } from "../src/referee-criteria.js";
import {
  CRITERIA_AT_CEILING,
  CRITERION_HAS_COMMENTS,
  CRITERION_NOT_ON_ARTICLE,
} from "../src/referee-criteria-store.js";
import { MAX_CRITERIA, type SavedCriterion } from "../src/saved-criteria.js";
import type { BlockId, Comment } from "../src/types.js";
import { hashBlocks } from "../src/source-hash.js";
import { runAsOwner, type OwnerId } from "../src/owner.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/** The one claim the mocked run answers with, anchored to the fixture at setup. */
let CLAIM: Claim;
/** The one result the mocked criterion run answers with, likewise. */
let RESULT: RefereeResult;

/**
 * Run by the mocked claims call before it answers, so a case can have a second
 * run begin — or begin and finish — while the first is still "at the model".
 * Null for every case that is not about two runs.
 */
let duringClaimsRun: (() => Promise<void>) | null = null;

vi.mock("../src/referee-claims-run.js", async () => ({
  ...(await vi.importActual<typeof import("../src/referee-claims-run.js")>(
    "../src/referee-claims-run.js",
  )),
  runClaimsStream: async function* () {
    /* What another tab does while this run's model call is out. */
    if (duringClaimsRun) await duringClaimsRun();
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

await pgReady({
  suite: "tests/referee-routes-postgres.test.ts",
  tables: ["spideryarn.referee_criteria", "spideryarn.referee_claims"],
  max: 2,
});

const { CLAIMS_SUPERSEDED, handleApi } = await import("../src/routes.js");
const { commentStore, refereeClaimsStore, refereeCriteriaStore } = await import("../src/store/index.js");


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

describe("Referee's routes, against Postgres", { timeout: 60_000 }, () => {
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
       `refereeClaimsStore.sweep` and `.sourceHash`, both of which refused with
       a 501. A paper nobody has asked is a 200 with `run: null`
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

  /* Two tabs, sweep 5's X4
     (docs/plans/261003h-referee-answers-are-not-lost-or-overwritten.md). The
     older run's answer used to be written over the newer run's row. It is now
     refused by the store, and these two say what the older tab is told instead
     of its stream simply stopping. */
  it("tells an older run that a newer one is still out, and keeps the newer run's row", async () => {
    duringClaimsRun = async () => {
      await asTestOwner(() => refereeClaimsStore.begin(SLUG, "feedfacefeedface"));
    };
    try {
      const posted = await call("POST", `/api/referee/claims/${SLUG}`);
      const done = frame(posted.text, "done");
      expect(done?.status).toBe("error");
      expect(done?.error).toBe(CLAIMS_SUPERSEDED);
    } finally {
      duringClaimsRun = null;
    }
    /* The row is the newer run's, untouched: still waiting, no claims, and the
       sentence above was never stored. */
    const stored = await asTestOwner(() => refereeClaimsStore.load(SLUG));
    expect(stored?.status).toBe("pending");
    expect(stored?.claims).toEqual([]);
    expect(stored?.error).toBeUndefined();
  });

  it("hands an older run the newer run's finished answer rather than its own", async () => {
    duringClaimsRun = async () => {
      const { attempt } = await asTestOwner(() => refereeClaimsStore.begin(SLUG, hashBlocks(article.blocks)));
      await asTestOwner(() =>
        refereeClaimsStore.finish(SLUG, { status: "done", claims: [], model: "the-newer-run" }, attempt),
      );
    };
    try {
      const posted = await call("POST", `/api/referee/claims/${SLUG}`);
      const done = frame(posted.text, "done");
      expect(done?.status).toBe("done");
      expect(done?.model).toBe("the-newer-run");
    } finally {
      duringClaimsRun = null;
    }
    const stored = await asTestOwner(() => refereeClaimsStore.load(SLUG));
    expect(stored?.model).toBe("the-newer-run");
    expect(stored?.claims).toEqual([]);
  });

  it("asks an older tab to reload instead of handing it an answer about different blocks", async () => {
    const newerHash = "feedfacefeedface";
    expect(hashBlocks(article.blocks)).not.toBe(newerHash);
    duringClaimsRun = async () => {
      /* The new revision's fingerprint is enough to reproduce the handoff:
         this request still holds the original blocks, and the newer answer
         must stay in the store until the tab reloads its article too. */
      const { attempt } = await asTestOwner(() => refereeClaimsStore.begin(SLUG, newerHash));
      await asTestOwner(() =>
        refereeClaimsStore.finish(SLUG, { status: "done", claims: [CLAIM], model: "the-newer-revision" }, attempt),
      );
    };
    try {
      const posted = await call("POST", `/api/referee/claims/${SLUG}`);
      const done = frame(posted.text, "done");
      expect(done?.status).toBe("error");
      expect(done?.error).toBe(CLAIMS_SUPERSEDED);
      expect(done?.claims).toEqual([]);
    } finally {
      duringClaimsRun = null;
    }
    const stored = await asTestOwner(() => refereeClaimsStore.load(SLUG));
    expect(stored?.status).toBe("done");
    expect(stored?.sourceHash).toBe(newerHash);
    expect(stored?.claims).toEqual([CLAIM]);
    expect(stored?.model).toBe("the-newer-revision");
    expect(stored?.error).toBeUndefined();
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

  /* ------------------------------------- a criterion with comments on it -- */

  /**
   * **`comments_criterion_fk` refusing, said to the referee instead of thrown at
   * them** — sweep 7, cluster C5
   * (docs/plans/261007b-seventh-sweep-referee-criteria-with-notes-are-refused-not-failed.md).
   * A comment placed on a criterion points at it, and the key refuses to leave
   * that pointer dangling. It always did; what reached the reader was a 500
   * `[db-failed]` and a Sentry report, from three directions: deleting such a
   * criterion, placing a comment on one another tab had just deleted, and
   * adding a criterion when the trim wanted such a one gone. The third has no
   * trim to come from since 2026-10-07: the cases under *nothing dropped, a
   * ceiling* below replaced it.
   *
   * Through the route and against Postgres, because both halves are needed to
   * see it: the constraint name lives on the driver's error underneath
   * Drizzle's, and `guardDbStore` drops it on the way out.
   *
   * Each refusal was **watched red** before its `catch` existed (500
   * where the case asks for 409 or 400), and again afterwards by renaming
   * `COMMENTS_CRITERION_FK` (src/referee-criteria-store.ts) to a constraint
   * that does not exist: the refusal cases went red and the controls stayed
   * green. *"does not take the comment table's other foreign key"* is the
   * retreat rule the other way round — it goes red if `violatesForeignKey`
   * stops asking for the name.
   */
  describe("a criterion with the referee's own comments placed on it", () => {
    /** A criterion that has finished, made through the store rather than the paying route. */
    async function criterion(text: string, at?: () => string): Promise<string> {
      return asTestOwner(async () => {
        const { row, attempt } = await refereeCriteriaStore.begin(
          SLUG,
          hashBlocks(article.blocks),
          text,
          { kind: "single" },
          undefined,
          at,
        );
        await refereeCriteriaStore.finish(SLUG, row.id, { status: "done", results: [] }, attempt);
        return row.id;
      });
    }

    /** A comment on the fixture's quoted passage, placed on `criterionId`. */
    function place(criterionId: string): Promise<Reply> {
      return call("POST", `/api/comments/${SLUG}`, {
        blockId: RESULT.blockId,
        quote: RESULT.quote,
        start: RESULT.start,
        criterionId,
      });
    }

    const criteriaIds = async () =>
      (await asTestOwner(() => refereeCriteriaStore.load(SLUG))).map((c: SavedCriterion) => c.id);

    // Also compare storage-only fields, including attempt ids, across rollback.
    const criteriaRows = () => getDb().select().from(refereeCriteria)
      .where(eq(refereeCriteria.articleId, article.articleId)).orderBy(asc(refereeCriteria.id));

    /** Every comment and criterion this block made, gone — comments first, for the key. */
    async function clear(): Promise<void> {
      await asTestOwner(async () => {
        for (const c of await commentStore.load(SLUG)) await commentStore.remove(SLUG, c.id);
        for (const c of await refereeCriteriaStore.load(SLUG)) {
          await refereeCriteriaStore.remove(SLUG, c.id);
        }
      });
    }

    afterEach(async () => {
      vi.restoreAllMocks();
      await clear();
    });

    it("refuses the delete with a 409 and a sentence, and keeps both rows", async () => {
      const id = await criterion("Are the controls adequate?");
      const placed = await place(id);
      // The control half of the retreat rule: a placement on a live criterion still lands.
      expect(placed.status, placed.text.slice(0, 300)).toBe(201);
      const comment = placed.body.comment as Comment;
      expect(comment.criterionId).toBe(id);

      const deleted = await call("DELETE", `/api/referee/criteria/${SLUG}/${id}`);
      expect(deleted.status, deleted.text.slice(0, 300)).toBe(409);
      expect(deleted.body.error).toBe(CRITERION_HAS_COMMENTS);

      // Nothing was detached and nothing was deleted: the refusal is the whole of it.
      expect(await criteriaIds()).toEqual([id]);
      const kept = await asTestOwner(() => commentStore.load(SLUG));
      expect(kept.map((c) => [c.id, c.criterionId])).toEqual([[comment.id, id]]);

      /* And the sentence's own way out works: clear the placement, then delete. */
      const cleared = await call("PATCH", `/api/comments/${SLUG}/${comment.id}/mark`, {
        criterionId: null,
        valence: null,
      });
      expect(cleared.status).toBe(200);
      const again = await call("DELETE", `/api/referee/criteria/${SLUG}/${id}`);
      expect(again.status).toBe(200);
      expect(again.body.criteria).toEqual([]);
      // The referee's words outlive the criterion they were once placed on.
      expect((await asTestOwner(() => commentStore.load(SLUG))).map((c) => c.id)).toEqual([
        comment.id,
      ]);
    });

    it("still deletes a criterion nothing is placed on", async () => {
      const [noted, bare] = [await criterion("with a comment"), await criterion("without one")];
      expect((await place(noted)).status).toBe(201);
      const deleted = await call("DELETE", `/api/referee/criteria/${SLUG}/${bare}`);
      expect(deleted.status).toBe(200);
      expect(await criteriaIds()).toEqual([noted]);
    });

    /**
     * The race (SVR1): `tidyMark` reads the criterion, the write is a separate
     * statement, and another tab deletes the criterion — which nothing is
     * placed on yet, so the delete succeeds — in between. Reproduced by having
     * the route's own read answer and *then* letting the other tab in.
     */
    function deletedBetweenTheCheckAndTheWrite(id: string): void {
      const read = refereeCriteriaStore.load;
      vi.spyOn(refereeCriteriaStore, "load").mockImplementationOnce(async (slug) => {
        const seen = await read(slug);
        await refereeCriteriaStore.remove(slug, id);
        return seen;
      });
    }

    /** What the early check says of a criterion that was never there — the words to match. */
    async function neverThere(): Promise<Reply> {
      const reply = await place("spya-zzzzzz");
      expect(reply.status).toBe(400);
      return reply;
    }

    it("answers a new comment whose criterion went mid-request as the early check would", async () => {
      const early = await neverThere();
      const id = await criterion("deleted in another tab");
      deletedBetweenTheCheckAndTheWrite(id);

      const placed = await place(id);
      expect(placed.status, placed.text.slice(0, 300)).toBe(400);
      expect(placed.body).toEqual(early.body);
      expect(placed.body.error).toBe(CRITERION_NOT_ON_ARTICLE);
      expect(await asTestOwner(() => commentStore.load(SLUG))).toEqual([]);
    });

    it("answers a placement moved onto a criterion that went mid-request the same way", async () => {
      const early = await neverThere();
      const [first, second] = [await criterion("where it is"), await criterion("where it is going")];
      const comment = (await place(first)).body.comment as Comment;
      // The control: moving a placement between two live criteria still works.
      const moved = await call("PATCH", `/api/comments/${SLUG}/${comment.id}/mark`, {
        criterionId: second,
        valence: null,
      });
      expect(moved.status, moved.text.slice(0, 300)).toBe(200);
      expect((moved.body.comment as Comment).criterionId).toBe(second);

      deletedBetweenTheCheckAndTheWrite(first);
      const back = await call("PATCH", `/api/comments/${SLUG}/${comment.id}/mark`, {
        criterionId: first,
        valence: null,
      });
      expect(back.status, back.text.slice(0, 300)).toBe(400);
      expect(back.body).toEqual(early.body);
      // The refused move changed nothing: the comment is where it was.
      const kept = await asTestOwner(() => commentStore.load(SLUG));
      expect(kept.map((c) => [c.id, c.criterionId])).toEqual([[comment.id, second]]);
    });

    /* -------------------------------------- nothing dropped, a ceiling -- */

    /**
     * **An add never deletes a criterion; at `MAX_CRITERIA` it is refused.**
     * Greg's two answers of 2026-10-07
     * (docs/plans/261007f-referee-criteria-are-never-dropped-a-ceiling-of-200-refuses-instead.md).
     * Until then an add past twenty deleted the oldest finished criterion, and
     * when that one had comments on it the key refused the delete and the add
     * failed every time. The first case below pinned that refusal as
     * *OPEN QUESTION 3a* and was turned over, red first.
     */
    const START = Date.parse("2026-08-01T00:00:00.000Z");
    const at = (i: number) => () => new Date(START + i * 60_000).toISOString();
    const add = (criterion = "one more") =>
      call("POST", `/api/referee/criteria/${SLUG}`, { criterion, kind: "single" });
    /** An add that went through: a stream, a `done`, and the id it was given. */
    async function added(criterion: string): Promise<string> {
      const reply = await add(criterion);
      expect(reply.streamed, `${criterion}: ${reply.status} ${reply.text.slice(0, 300)}`).toBe(true);
      const done = frame(reply.text, "done");
      expect(done?.status).toBe("done");
      return done?.id as string;
    }
    /** An add that was refused at the ceiling, before any stream, and wrote nothing. */
    async function refused(criterion: string): Promise<void> {
      const rowsBefore = await criteriaRows();
      const reply = await add(criterion);
      expect(reply.status, reply.text.slice(0, 300)).toBe(409);
      expect(reply.streamed, "a refusal must be JSON, before any header").toBe(false);
      expect(reply.body.error).toBe(CRITERIA_AT_CEILING);
      expect(await criteriaRows()).toEqual(rowsBefore);
    }
    /** `n` finished criteria, oldest first, through the store. */
    async function fill(n: number, from = 0): Promise<string[]> {
      const ids: string[] = [];
      for (let i = from; i < from + n; i++) ids.push(await criterion(`criterion ${i}`, at(i)));
      return ids;
    }

    it("adds past the old cap of twenty and keeps every criterion, the commented oldest included", async () => {
      const ids = await fill(20);
      const oldest = ids[0] as string;
      const comment = (await place(oldest)).body.comment as Comment;
      const before = await criteriaRows();

      // This is the request that was refused, every time, with the oldest commented.
      const first = await added("one more");
      const second = await added("and another");
      expect(await criteriaIds()).toEqual([...ids, first, second]);

      // No surviving row was rewritten on the way, and nothing was detached.
      const after = new Map((await criteriaRows()).map((r) => [r.id, r]));
      for (const row of before) expect(after.get(row.id)).toEqual(row);
      expect((await asTestOwner(() => commentStore.load(SLUG))).map((c) => [c.id, c.criterionId]))
        .toEqual([[comment.id, oldest]]);
    });

    it("drops nothing when nothing has comments either", async () => {
      const ids = await fill(25);
      const before = await criteriaRows();
      const more = [await added("twenty-six"), await added("twenty-seven")];
      expect(await criteriaIds()).toEqual([...ids, ...more]);
      const after = new Map((await criteriaRows()).map((r) => [r.id, r]));
      for (const row of before) expect(after.get(row.id)).toEqual(row);
    });

    it("accepts the two-hundredth, refuses the next with a sentence, and lets a failed one run again", async () => {
      expect(MAX_CRITERIA).toBe(200);
      /* What the ceiling counts is every row: one still running and one that
         failed are in the 199 below, and one carries a comment. */
      const running = await asTestOwner(() => refereeCriteriaStore.begin(
        SLUG, hashBlocks(article.blocks), "still running", { kind: "single" }, undefined, at(0),
      ));
      const failed = await asTestOwner(async () => {
        const b = await refereeCriteriaStore.begin(
          SLUG, hashBlocks(article.blocks), "it failed", { kind: "single" }, undefined, at(1),
        );
        await refereeCriteriaStore.finish(SLUG, b.row.id, { status: "error", error: "the provider refused" }, b.attempt);
        return b.row.id;
      });
      const rest = await fill(MAX_CRITERIA - 3, 2);
      expect((await place(rest[0] as string)).status).toBe(201);
      expect(await criteriaIds()).toHaveLength(MAX_CRITERIA - 1);

      const last = await added("the two-hundredth");
      expect(await criteriaIds()).toEqual([running.row.id, failed, ...rest, last]);

      await refused("one too many");
      await refused("one too many"); // and again: a refusal is not a state that wears off

      /* A retry of the failed one is not an add: the same row, run again. */
      const retried = await call("POST", `/api/referee/criteria/${SLUG}`, {
        id: failed, criterion: "it failed", kind: "single",
      });
      expect(frame(retried.text, "done"), retried.text.slice(0, 300)).toMatchObject({ id: failed, status: "done" });
      expect(await criteriaIds()).toHaveLength(MAX_CRITERIA);

      // The sentence's way out works: delete one, and the add goes through.
      expect((await call("DELETE", `/api/referee/criteria/${SLUG}/${last}`)).status).toBe(200);
      await added("in its place");
      expect(await criteriaIds()).toHaveLength(MAX_CRITERIA);
      // The running one was never touched, and can still land its answer.
      const landed = await asTestOwner(() => refereeCriteriaStore.finish(
        SLUG, running.row.id, { status: "done", results: [] }, running.attempt,
      ));
      expect(landed?.status).toBe("done");
    });

    /**
     * **Two adds at once at 199 make 200, not 201.** The count and the insert
     * are one transaction under the article lock, so the second add counts
     * after the first has written. Four at once, through the route, on a pool
     * of five.
     *
     * With `lockArticleRow` removed from `begin` this went red, three runs of
     * three (the plan's § Evidence).
     */
    it("lets one of several simultaneous adds at 199 through, and refuses the rest", async () => {
      await fill(MAX_CRITERIA - 1);
      const replies = await Promise.all(["a", "b", "c", "d"].map((x) => add(`simultaneous ${x}`)));
      const through = replies.filter((r) => r.streamed);
      expect(through, replies.map((r) => `${r.status} ${r.text.slice(0, 120)}`).join("\n")).toHaveLength(1);
      for (const r of replies.filter((x) => !x.streamed)) {
        expect(r.status).toBe(409);
        expect(r.body.error).toBe(CRITERIA_AT_CEILING);
      }
      expect(await criteriaIds()).toHaveLength(MAX_CRITERIA);
    });

    it("counts this article's criteria and nobody else's", async () => {
      /* Another article of this reader's, and another owner's, each with a
         criterion under the id this article's oldest has. Neither counts here,
         neither is touched by this article's refusal, and this article's
         ceiling does not stop the other one adding. */
      const SHARED = "spya-shrd22";
      const finished = async (slug: string, hash: string, text: string, id?: string) => {
        const b = await refereeCriteriaStore.begin(slug, hash, text, { kind: "single" }, id, at(0));
        await refereeCriteriaStore.finish(slug, b.row.id, { status: "done", results: [] }, b.attempt);
        return b.row.id;
      };
      /* A random owner rather than a fixed one: a seeded row in `auth.users`
         for the length of this case, and nothing for OWNER_AUDIT to account for. */
      const other = randomUUID() as OwnerId;
      await seedAuthUser(getDb(), { id: other, email: `other-referee-routes-postgres-${other}@example.invalid` });
      const mine = await scratchArticleInPg(`${SLUG}-same-owner`, { ownerId: TEST_OWNER });
      const theirs = await scratchArticleInPg(`${SLUG}-other-owner`, { ownerId: other });
      try {
        await asTestOwner(() => finished(mine.slug, hashBlocks(mine.blocks), "mine, elsewhere", SHARED));
        await runAsOwner(other, () => finished(theirs.slug, hashBlocks(theirs.blocks), "somebody else's", SHARED));
        const elsewhere = () => getDb().select().from(refereeCriteria)
          .where(inArray(refereeCriteria.articleId, [mine.articleId, theirs.articleId]))
          .orderBy(asc(refereeCriteria.articleId), asc(refereeCriteria.id));
        const untouched = await elsewhere();
        expect(untouched.filter((r) => r.id === SHARED)).toHaveLength(2);
        expect(new Set(untouched.map((r) => r.ownerId))).toEqual(new Set([TEST_OWNER, other]));

        expect(await asTestOwner(() => finished(SLUG, hashBlocks(article.blocks), "criterion 0", SHARED)))
          .toBe(SHARED);
        await fill(MAX_CRITERIA - 2, 1);
        await added("the two-hundredth, with two more elsewhere");
        await refused("past the ceiling here");
        expect(await elsewhere()).toEqual(untouched);

        // The other article is counted on its own.
        const there = await call("POST", `/api/referee/criteria/${mine.slug}`, { criterion: "fine there", kind: "single" });
        expect(frame(there.text, "done")?.status, there.text.slice(0, 300)).toBe("done");
      } finally {
        await mine.remove();
        await theirs.remove();
        await getDb().execute(sql`delete from auth.users where id = ${other}`);
      }
    });

    it("does not take the comment table's other foreign key for this one", async () => {
      /* `comments_identity_fk`: a comment on a block the article does not have.
         The route refuses that long before the store, so this goes to the store
         directly — the point is what the store does with a 23503 that is *not*
         about a criterion. It must stay the failure it is: the comment names
         a block identity the database has never heard of. */
      const id = await criterion("a live criterion");
      const error = await asTestOwner(() =>
        commentStore
          .create(SLUG, { blockId: "spya-zzzzzz" as BlockId, criterionId: id })
          .then(
            () => null,
            (e: unknown) => e as Error & { status?: number; code?: string },
          ),
      );
      expect(error?.name).toBe("StoreFailure");
      expect(error?.code).toBe("23503");
      expect(error?.status).toBeUndefined();
      expect(error?.message).not.toBe(CRITERION_NOT_ON_ARTICLE);
      expect(await asTestOwner(() => commentStore.load(SLUG))).toEqual([]);
    });

    // Review additions below are unrun here: this sandbox cannot connect to Postgres.
    it("does not treat a live criterion on another article as a placement target here", async () => {
      const elsewhere = await scratchArticleInPg(`${SLUG}-other-article`, { ownerId: TEST_OWNER });
      try {
        const { row } = await asTestOwner(() => refereeCriteriaStore.begin(
          elsewhere.slug, hashBlocks(elsewhere.blocks), "on another article", { kind: "single" }, "spya-zzzzzz",
        ));
        const placed = await place(row.id);
        expect(placed.status).toBe(400);
        expect(placed.body.error).toBe(CRITERION_NOT_ON_ARTICLE);
        expect(await asTestOwner(() => commentStore.load(SLUG))).toEqual([]);
        const deleted = await call("DELETE", `/api/referee/criteria/${SLUG}/${row.id}`);
        expect(deleted.status).toBe(200); // Absent here, as before; no new refusal.
        expect((await asTestOwner(() => refereeCriteriaStore.load(elsewhere.slug))).map((c) => c.id))
          .toEqual([row.id]);
      } finally {
        await elsewhere.remove();
      }
    });

    it("keeps another owner's access as a 404 before any foreign-key translation", async () => {
      const id = await criterion("owned by the fixture reader");
      const outsider = "07852712-f444-4aec-bd4a-b70403c8c03d" as OwnerId;
      await expect(runAsOwner(outsider, () => refereeCriteriaStore.remove(SLUG, id)))
        .rejects.toMatchObject({ status: 404 });
      await expect(runAsOwner(outsider, () => commentStore.create(SLUG, {
        blockId: RESULT.blockId, criterionId: id,
      }))).rejects.toMatchObject({ status: 404 });
      expect(await criteriaIds()).toEqual([id]);
      expect(await asTestOwner(() => commentStore.load(SLUG))).toEqual([]);
    });
  });
});
