/**
 * **A referee's own placement of a passage, through the real route and the real
 * store, with the minus sign still on it.**
 *
 * Greg, 2026-08-31: *"I'm keen to also include some kind of ranked red, green,
 * and/or red-green-spectrum … perhaps harmonising with the ability for the user
 * to comment (perhaps quantitatively) on things."* The second half of that is
 * the referee's own quantitative judgement, and it is the anchoring antidote in
 * Referee mode: the referee records what *they* think, rather than only reading
 * what the model thought.
 *
 * ## Why this file exists rather than one more case in tests/routes.test.ts
 *
 * `comments.criterion_id` and `comments.valence` were migrated on 2026-08-31 and
 * nothing above the database could read or write either of them for a day —
 * `Comment` had neither field, `NewComment` had neither, the route ignored both,
 * the Postgres writer did not insert them and `toComment` discarded them on
 * every read. GPT Sol's finding 5, docs/plans/260831an-referee-mode-code-review-sol.md.
 * A column an application cannot reach is invisible to every test of that
 * application, which is why nothing said so.
 *
 * The same review named the test that looked like evidence and was not:
 * `tests/db-referee-criteria.test.ts` inserts `comments.valence` with raw SQL, so
 * it proves the *constraint* holds and says nothing at all about the boundary.
 * So everything here goes in through `handleApi` and comes back out through
 * `loadComments`, and nothing in between is mocked.
 *
 * ## The one assertion the feature is for
 *
 * **A negative valence survives.** `SearchHit.confidence` is a 0–100 match
 * strength whose validator clamps negatives to zero (`validateHits`,
 * src/search.ts), so a placement routed through anything shaped like a
 * confidence arrives as `0` — *"no strong feeling"* — with nothing erroring and
 * nothing looking odd. That is the failure the whole design exists to prevent,
 * and it is the failure a passing test suite would not notice.
 *
 * Writes under `data/<throwaway slug>/`, which is gitignored, and removes it.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, before **any** import runs — see the same block
 * in tests/chat-route.test.ts.
 */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import type { Comment } from "../src/types.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-comment-referee-mark";
/** A second article, for the one case about a criterion saved under another. */
const ELSEWHERE = "test-comment-referee-mark-other";

const { reachable } = await pgReady({
  suite: "tests/comment-referee-mark.test.ts",
  tables: ["spideryarn.comments", "spideryarn.referee_criteria"],
});

const { handleApi } = await import("../src/routes.js");
const { commentStore, refereeCriteriaStore, STORE } = await import("../src/store/index.js");

if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    expect(STORE).toBe("postgres");
  });
});

/**
 * The two articles, and the passage every case anchors to.
 *
 * **`BLOCK` and `QUOTE` are read off the fixture rather than written down.**
 * They were `spya-gp3g6s` and `"Berggruen Prize"` — a real block of
 * `example/blocks.json` and a phrase really inside it — and the reason the
 * comment gave for that is exactly why the literals cannot survive a move: the
 * route checks the anchor against the article, so a made-up passage is a 400 and
 * every case below would pass for the wrong reason.
 */
let article: ScratchArticle | undefined;
let elsewhere: ScratchArticle | undefined;
let BLOCK = "";
let QUOTE = "";
const AT = 0;

beforeAll(async () => {
  if (!reachable) return;
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  elsewhere = await scratchArticleInPg(ELSEWHERE, { ownerId: TEST_OWNER });
  expect(article.copied).toContain("blocks");

  /* A block with enough text to quote from — the anchor check compares the
     quote against the block at `AT`, so a short one would fail on length rather
     than on anything this file is about. */
  const block = article.blocks.find((b) => b.text.length > 40);
  if (!block) throw new Error("the fixture has no block long enough to quote");
  BLOCK = block.id;
  QUOTE = block.text.slice(AT, AT + 20);
});

afterAll(async () => {
  await article?.remove();
  await elsewhere?.remove();
  await closeDb();
});

const POST = `/api/comments/${SLUG}`;

interface Reply {
  status: number;
  body: { error?: string; comment?: Comment };
}

/** `handleApi` over a fake request/response pair — tests/routes.test.ts's harness. */
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
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader() {},
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  return { status, body: text ? JSON.parse(text) : {} };
}

/** A criterion of another kind, which has no scale for a placement to sit on. */
async function aScalelessCriterion(): Promise<string> {
  const { row } = await asTestOwner(() =>
    refereeCriteriaStore.begin(SLUG, "Does this cite the relevant prior work?", {
      kind: "literature",
    }),
  );
  return row.id;
}

/** A `diverging` criterion on this article, so a placement has something to be on. */
async function aCriterion(): Promise<string> {
  const { row } = await asTestOwner(() =>
    refereeCriteriaStore.begin(SLUG, "Are the controls adequate?", {
      kind: "diverging",
      poles: { against: "the controls are inadequate", favour: "the controls are adequate" },
      scale: "rg",
    }),
  );
  return row.id;
}

/**
 * The article's own comments and criteria, and nothing a previous case wrote.
 *
 * This used to be a `cp(example/ → data/<slug>/)` per test and an `rm` after —
 * a fresh article every time, which is what wiped both. The article now outlives
 * the file, so what has to go is the reader state written on it.
 */
afterEach(async () => {
  if (!article) return;
  await asTestOwner(async () => {
    for (const c of await commentStore.load(SLUG)) await commentStore.remove(SLUG, c.id);
    for (const c of await refereeCriteriaStore.load(SLUG)) {
      await refereeCriteriaStore.remove(SLUG, c.id);
    }
    for (const c of await refereeCriteriaStore.load(ELSEWHERE)) {
      await refereeCriteriaStore.remove(ELSEWHERE, c.id);
    }
  });
});

when("the referee's own placement crosses the comment API", () => {
  it("keeps a negative valence, in the answer and on disk", async () => {
    const criterionId = await aCriterion();
    const r = await call("POST", POST, {
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
      body: "the randomisation is not described anywhere",
      criterionId,
      valence: -80,
    });

    expect(r.status).toBe(201);
    /* `toBe(-80)`, never `toBeLessThan(0)`. The failure this guards against
       turns −80 into 0, and a test written the loose way would also pass on
       −1 — which is the same feature quietly broken. */
    expect(r.body.comment?.valence).toBe(-80);
    expect(r.body.comment?.criterionId).toBe(criterionId);

    const stored = (await asTestOwner(() => commentStore.load(SLUG)))[0];
    expect(stored?.valence).toBe(-80);
    expect(stored?.criterionId).toBe(criterionId);
    // And it is still a free comment: placing a passage costs no model call.
    expect(stored?.status).toBe("none");
  });

  it("keeps a positive one too, so the sign is carried rather than the magnitude", async () => {
    /* The pair matters. A store that dropped the sign and one that stored the
       absolute value are different bugs, and only +70 beside −80 tells them
       apart: `Math.abs` passes the negative case above on its own. */
    const criterionId = await aCriterion();
    const r = await call("POST", POST, {
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
      criterionId,
      valence: 70,
    });
    expect(r.status).toBe(201);
    expect((await asTestOwner(() => commentStore.load(SLUG)))[0]?.valence).toBe(70);
  });

  it("keeps a valence of zero, which is a real answer and not a missing one", async () => {
    /* Zero means "this passage counts neither way" — a considered placement,
       and the reason `DivergingResult.valence` refuses to default a missing one
       to it. An `if (valence)` anywhere on the path would silently drop this. */
    const criterionId = await aCriterion();
    await call("POST", POST, {
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
      criterionId,
      valence: 0,
    });
    const stored = (await asTestOwner(() => commentStore.load(SLUG)))[0];
    expect(stored?.valence).toBe(0);
    expect("valence" in (stored ?? {})).toBe(true);
  });

  it("takes a criterion with no number — they wrote a sentence and did not score it", async () => {
    const criterionId = await aCriterion();
    const r = await call("POST", POST, {
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
      body: "this is the bit I doubt",
      criterionId,
    });
    expect(r.status).toBe(201);
    const stored = (await asTestOwner(() => commentStore.load(SLUG)))[0];
    expect(stored?.criterionId).toBe(criterionId);
    // Absent, not null and not zero — `exactOptionalPropertyTypes`, and a
    // fabricated neutral is exactly what this feature must never invent.
    expect("valence" in (stored ?? {})).toBe(false);
  });

  it("leaves an ordinary reading note with neither field", async () => {
    await call("POST", POST, { blockId: BLOCK, quote: QUOTE, start: AT, body: "hm" });
    const stored = (await asTestOwner(() => commentStore.load(SLUG)))[0];
    expect("criterionId" in (stored ?? {})).toBe(false);
    expect("valence" in (stored ?? {})).toBe(false);
  });
});

when("what the route refuses, and it refuses rather than rounds", () => {
  /** Every refusal must also leave nothing behind. */
  const refused = async (body: Record<string, unknown>, match: RegExp) => {
    const r = await call("POST", POST, { blockId: BLOCK, quote: QUOTE, start: AT, ...body });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(match);
    expect(await asTestOwner(() => commentStore.load(SLUG))).toEqual([]);
  };

  it("refuses a placement on a criterion that does not exist", async () => {
    await refused({ criterionId: "spya-k3m9qt", valence: -50 }, /not one of your criteria/);
  });

  it("refuses a placement on a criterion belonging to another article", async () => {
    /* `criterionId` comes off a request, so on its own it names any string.
       The criteria are read for THIS slug, so a criterion saved under another
       one is the same refusal as a made-up id.

       **That is all this case proves, and the name says so.** Both articles
       here belong to the same person — every call goes through `asTestOwner` —
       so `other` is a criterion of *theirs*, saved under a different slug, and
       nothing here is evidence about *another referee's* criterion. Owner
       scoping lives in `ownedSlug` (src/store/pg.ts), which the Postgres store
       puts in front of every read, and the test that actually holds it there is
       "a criterion under somebody else's article is not theirs to place on" in
       tests/referee-criteria-store.test.ts — against a real database, with two
       owners in it. GPT Sol's finding 6 named this comment as claiming more
       than the case beneath it checked.

       (The reason given here used to be *"it runs against the filesystem
       store, which has no notion of an owner at all"*, which is simply false:
       this file sets `SPIDERYARN_STORE=postgres` before any import and asserts
       it, in "the store these tests are actually talking to" above. The
       conclusion was right and the reason was wrong, which is the worse of the
       two ways to be wrong in a file whose whole value is that a reader can
       tell what it proves.) */
    const { row: other } = await asTestOwner(() =>
      refereeCriteriaStore.begin(ELSEWHERE, "someone else's question", { kind: "single" }),
    );
    await refused({ criterionId: other.id, valence: -50 }, /not one of your criteria/);
  });

  it("refuses a number with nothing to place it on", async () => {
    // `comments_valence_needs_criterion` says the same thing in the database.
    // A placement against no criterion is a number against nothing.
    await refused({ valence: -50 }, /which criterion/);
  });

  it("refuses a valence past the end of the scale rather than clamping it", async () => {
    /* **Rejecting, not clamping, is the decision.** The referee typed a number;
       silently answering a different one is how a signed judgement becomes
       something nobody chose. And a clamp here would be one edit away from the
       confidence clamp, which is the failure this feature was designed around. */
    const criterionId = await aCriterion();
    await refused({ criterionId, valence: -400 }, /−100 to \+100/);
    await refused({ criterionId, valence: 400 }, /−100 to \+100/);
  });

  it("refuses a fractional placement", async () => {
    const criterionId = await aCriterion();
    await refused({ criterionId, valence: -12.5 }, /whole number/);
  });

  it("refuses a valence that is not a number at all", async () => {
    const criterionId = await aCriterion();
    await refused({ criterionId, valence: "-80" }, /valence must be a number/);
  });

  it("refuses a criterionId that is not an id", async () => {
    await refused({ criterionId: "../../etc/passwd", valence: 0 }, /criterionId/);
  });

  it("refuses a placement on a criterion that has no scale to place it on", async () => {
    /* A `single` or `literature` criterion has no poles, so a signed number
       against one is signed against nothing: the panel has no ends to print it
       between and cannot draw it. The database cannot refuse this — a CHECK
       constraint cannot reach `referee_criteria` to read a kind — so the route
       is the only place it can be refused, and it refuses with `markProblem`
       rather than a rule of its own. GPT Sol's finding 6. */
    const criterionId = await aScalelessCriterion();
    await refused({ criterionId, valence: -80 }, /two ends/);
  });

  it("still takes prose tagged to a criterion with no scale", async () => {
    // The kind rule is about the *number*. A referee writing a sentence about
    // a literature criterion has placed nothing, and nothing is wrong with it.
    const criterionId = await aScalelessCriterion();
    const r = await call("POST", POST, {
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
      body: "no sign of the 2019 replication",
      criterionId,
    });
    expect(r.status).toBe(201);
    expect((await asTestOwner(() => commentStore.load(SLUG)))[0]?.criterionId).toBe(criterionId);
  });
});

when("a second Save under a stored id", () => {
  it("hands the same comment back when the placement has not changed", async () => {
    const criterionId = await aCriterion();
    const made = { blockId: BLOCK, quote: QUOTE, start: AT, criterionId, valence: -80 };
    const first = await call("POST", POST, { id: "spya-k3m9qt", ...made });
    expect(first.status).toBe(201);
    const again = await call("POST", POST, { id: "spya-k3m9qt", ...made });
    expect(again.status).toBe(201);
    expect(again.body.comment?.valence).toBe(-80);
    expect(await asTestOwner(() => commentStore.load(SLUG))).toHaveLength(1);
  });

  /**
   * **This was red on purpose for a day, and it was a production bug rather
   * than a fixture problem.** It passed for as long as this file ran against
   * the filesystem store, and going to Postgres — which is what production runs
   * — is what uncovered it.
   *
   * `pgCommentStore.create` throws `CommentIdTaken`, exactly as
   * `src/comments.ts` does, and `src/routes.ts` answers 409 to it. But every
   * Postgres store is wrapped by `guardDbStore` (src/store/db-errors.ts), whose
   * `mayPassThrough` was an allowlist of five class names that did not include
   * this one — and the class carried no numeric `status`, which is that
   * allowlist's other door. So the throw was scrubbed into a generic
   * `StoreFailure`, the `instanceof` in routes.ts could not match, and the
   * reader got **500 where the route intends 409**.
   *
   * Fixed 2026-09-01 by putting `status = 409` on the class, which is the door
   * the guard already holds open and what every other store-side refusal here
   * uses. `NotAnExplanation` had the same fault and the same fix — its
   * `missing` case was a 500 where routes.ts intends a 404.
   * docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md.
   *
   * **The cheap version of this assertion lives in
   * tests/db-error-scrub.test.ts**, which asks the guard directly rather than
   * paying for a route and an article to find out. This one stays because it is
   * the end-to-end proof: it is the test that found the bug, and it is the only
   * one here that would notice the guard, the route and the store disagreeing.
   */
  it("refuses a re-score, rather than overwriting the judgement already made", async () => {
    /* A second POST carrying a *different* valence is not a retry, and `create`
       taking it would delete a judgement the referee had already recorded —
       which is the same reason a changed body is refused here. Editing a
       placement is an operation this route deliberately does not have yet. */
    const criterionId = await aCriterion();
    const first = await call("POST", POST, {
      id: "spya-k3m9qt",
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
      criterionId,
      valence: -80,
    });
    expect(first.status).toBe(201);
    const clash = await call("POST", POST, {
      id: "spya-k3m9qt",
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
      criterionId,
      valence: 40,
    });
    expect(clash.status).toBe(409);
    expect((await asTestOwner(() => commentStore.load(SLUG)))[0]?.valence).toBe(-80);
  });
});

/* ------------------------------------------- changing a placement already made -- */

/**
 * `PATCH /api/comments/:slug/:id/mark` — the fifth operation.
 *
 * Until 2026-09-01 a placement could be made and never changed: `create`
 * refuses a re-score under a stored id (the 409 above), and there was nothing
 * else that could write the pair. That was correct and unfinished — a referee
 * who mis-clicked had to delete the comment and write it again.
 * docs/plans/260901i-the-referee-places-the-passage-themselves.md § *Overwriting
 * gets an operation of its own*.
 */
const markUrl = (id: string) => `/api/comments/${SLUG}/${id}/mark`;

/** Make a comment through the real route, and hand back the id it got. */
async function madeComment(fields: Record<string, unknown>): Promise<string> {
  const r = await call("POST", POST, { blockId: BLOCK, quote: QUOTE, start: AT, ...fields });
  expect(r.status).toBe(201);
  const id = r.body.comment?.id;
  if (id === undefined) throw new Error("the create route answered 201 with no comment");
  return id;
}

/** What the store holds for one comment — never what the route just said. */
async function fromStore(id: string): Promise<Comment | undefined> {
  return (await asTestOwner(() => commentStore.load(SLUG))).find((c) => c.id === id);
}

when("changing a placement the referee already made", () => {
  it("moves a passage from one end of the scale to the other", async () => {
    const criterionId = await aCriterion();
    const id = await madeComment({ criterionId, valence: -80 });

    const r = await call("PATCH", markUrl(id), { criterionId, valence: 50 });
    expect(r.status).toBe(200);
    expect(r.body.comment?.valence).toBe(50);
    expect(r.body.comment?.criterionId).toBe(criterionId);

    /* Off the store, not off the answer. A route that reported the number it
       was handed and wrote nothing would pass every assertion above. */
    const stored = await fromStore(id);
    expect(stored?.valence).toBe(50);
    expect(stored?.criterionId).toBe(criterionId);
  });

  it("keeps the minus sign, which is the one thing this operation is for", async () => {
    /* `+50 → −70`, and read back as −70. Anything routed through a
       confidence-shaped validator clamps negatives to zero (`validateHits`,
       src/search.ts), and the referee is then shown the opposite of what they
       said with nothing erroring. `toBe(-70)`, never `toBeLessThan(0)`: the
       loose form also passes on −1, which is the same feature quietly broken. */
    const criterionId = await aCriterion();
    const id = await madeComment({ criterionId, valence: 50 });

    const r = await call("PATCH", markUrl(id), { criterionId, valence: -70 });
    expect(r.status).toBe(200);
    expect(r.body.comment?.valence).toBe(-70);
    expect((await fromStore(id))?.valence).toBe(-70);
  });

  it("clears a placement back to a plain reading note", async () => {
    const criterionId = await aCriterion();
    const id = await madeComment({ body: "the randomisation is not described", criterionId, valence: -80 });

    const r = await call("PATCH", markUrl(id), { criterionId: null, valence: null });
    expect(r.status).toBe(200);

    const stored = await fromStore(id);
    // Absent, not null and not zero — `exactOptionalPropertyTypes`, and a
    // fabricated neutral is what this feature must never invent.
    expect("criterionId" in (stored ?? {})).toBe(false);
    expect("valence" in (stored ?? {})).toBe(false);
    // The note and the passage are untouched: clearing a placement is not a delete.
    expect(stored?.body).toBe("the randomisation is not described");
    expect(stored?.blockId).toBe(BLOCK);
    expect(stored?.quote).toBe(QUOTE);
  });

  it("writes the placement and nothing else", async () => {
    /* The allowlist, actually exercised rather than asserted in a comment. A
       spread of the request body would take the anchor with it, and every other
       assertion in this file would still pass. */
    const criterionId = await aCriterion();
    const id = await madeComment({ body: "this is the bit I doubt", criterionId, valence: -80 });
    await asTestOwner(() =>
      commentStore.linkThread(SLUG, id, "spya-thr222", { blockId: BLOCK, quote: QUOTE, start: AT }),
    );
    const before = await fromStore(id);

    const r = await call("PATCH", markUrl(id), { criterionId, valence: 100 });
    expect(r.status).toBe(200);

    const after = await fromStore(id);
    expect(after?.valence).toBe(100);
    for (const field of ["body", "blockId", "quote", "start", "createdAt", "status", "threadId", "id"] as const) {
      expect(after?.[field], `patchMark moved ${field}`).toEqual(before?.[field]);
    }
    // And it does stamp the one field it is allowed to stamp.
    expect(after?.updatedAt).toBeTruthy();
  });

  it("places a passage that had no placement at all", async () => {
    // An ordinary reading note becoming a review comment. The same operation,
    // because "edit" and "place for the first time" are the same write.
    const criterionId = await aCriterion();
    const id = await madeComment({ body: "hm" });

    const r = await call("PATCH", markUrl(id), { criterionId, valence: -50 });
    expect(r.status).toBe(200);
    const stored = await fromStore(id);
    expect(stored?.criterionId).toBe(criterionId);
    expect(stored?.valence).toBe(-50);
  });
});

when("what the placement edit refuses, and it refuses rather than rounds", () => {
  /**
   * Every refusal must also leave the placement that was already there alone.
   *
   * The status **and** the tag, because "it threw" is not evidence: a route
   * that 400s on everything would pass a test that only counted throws.
   */
  const refused = async (
    body: Record<string, unknown>,
    status: number,
    match: RegExp,
  ): Promise<void> => {
    const criterionId = await aCriterion();
    const id = await madeComment({ criterionId, valence: -80 });
    const r = await call("PATCH", markUrl(id), body);
    expect(r.status).toBe(status);
    expect(r.body.error).toMatch(match);
    // The judgement already made is still the judgement.
    expect((await fromStore(id))?.valence).toBe(-80);
  };

  it("refuses a criterion that is not one of yours on this article", async () => {
    await refused({ criterionId: "spya-k3m9qt", valence: -50 }, 400, /not one of your criteria/);
  });

  it("refuses a valence past either end of the scale rather than clamping it", async () => {
    const criterionId = await aCriterion();
    await refused({ criterionId, valence: 101 }, 400, /−100 to \+100\. \[cmt-valence-range\]/);
    await refused({ criterionId, valence: -101 }, 400, /−100 to \+100\. \[cmt-valence-range\]/);
  });

  it("refuses a fractional placement", async () => {
    const criterionId = await aCriterion();
    await refused({ criterionId, valence: -12.5 }, 400, /whole number\. \[cmt-valence-range\]/);
  });

  it("refuses a number with nothing to place it on", async () => {
    await refused({ criterionId: null, valence: -50 }, 400, /which criterion it is placing\. \[cmt-valence-range\]/);
  });

  it("refuses a placement on a criterion that has no scale to place it on", async () => {
    const criterionId = await aScalelessCriterion();
    await refused({ criterionId, valence: -80 }, 400, /two ends\. \[cmt-valence-range\]/);
  });

  it("refuses a body that names only one of the two fields", async () => {
    /* **Both fields, always.** The route deliberately cannot express "leave the
       other one alone": a partial shape means an absent `valence` is either
       *keep it* or *clear it*, and a client one missing branch away from the
       wrong reading would silently destroy a judgement with nothing erroring —
       docs/reusable/silent-success.md. So a half body is a 400 rather than a
       guess. This is the route's own rule and not a second copy of what a
       placement is; `tidyMark` still owns that. */
    const criterionId = await aCriterion();
    await refused({ criterionId }, 400, /both criterionId and valence, .* \[cmt-mark-pair\]/);
    await refused({ valence: 50 }, 400, /both criterionId and valence, .* \[cmt-mark-pair\]/);
  });

  it("refuses a body that is not a bag of fields at all", async () => {
    /* `"key" in raw` is a TypeError on a string or a number, so a route that
       asks whether a key was sent has to ask whether it was sent an object
       first — otherwise a nonsense body is a 500 where a 400 is meant, and a
       500 goes to Sentry as our fault. `fields` in src/routes.ts. */
    const criterionId = await aCriterion();
    const id = await madeComment({ criterionId, valence: -80 });
    for (const sent of ["hello", 12, [1, 2], null]) {
      const r = await call("PATCH", markUrl(id), sent);
      expect(r.status, `${JSON.stringify(sent)} was not refused`).toBe(400);
      expect(r.body.error).toMatch(/\[cmt-mark-pair\]/);
    }
    expect((await fromStore(id))?.valence).toBe(-80);
  });

  it("404s on a comment that is not there", async () => {
    const criterionId = await aCriterion();
    const r = await call("PATCH", markUrl("spya-k3m9qt"), { criterionId, valence: 50 });
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/No comment with the id/);
  });
});
