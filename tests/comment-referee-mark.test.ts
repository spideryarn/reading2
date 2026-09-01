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

import { cp, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadComments } from "../src/comments.js";
import { beginCriterion } from "../src/referee-criteria-store.js";
import { handleApi } from "../src/routes.js";
import type { Comment } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const SLUG = "test-comment-referee-mark";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
const EXAMPLE = path.resolve(import.meta.dirname, "..", "example");

/* A real block and a quote really inside it — `example/blocks.json`. The route
   checks the anchor against the article, so a made-up passage would be a 400
   and every case below would pass for the wrong reason. */
const BLOCK = "spya-gp3g6s";
const QUOTE = "Berggruen Prize";
const AT = 30;

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
  const row = await beginCriterion(SLUG, "Does this cite the relevant prior work?", {
    kind: "literature",
  });
  return row.id;
}

/** A `diverging` criterion on this article, so a placement has something to be on. */
async function aCriterion(): Promise<string> {
  const row = await beginCriterion(SLUG, "Are the controls adequate?", {
    kind: "diverging",
    poles: { against: "the controls are inadequate", favour: "the controls are adequate" },
    scale: "rg",
  });
  return row.id;
}

beforeEach(() => cp(EXAMPLE, DIR, { recursive: true }));
afterEach(() => rm(DIR, { recursive: true, force: true }));

describe("the referee's own placement crosses the comment API", () => {
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

    const stored = (await loadComments(SLUG))[0];
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
    expect((await loadComments(SLUG))[0]?.valence).toBe(70);
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
    const stored = (await loadComments(SLUG))[0];
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
    const stored = (await loadComments(SLUG))[0];
    expect(stored?.criterionId).toBe(criterionId);
    // Absent, not null and not zero — `exactOptionalPropertyTypes`, and a
    // fabricated neutral is exactly what this feature must never invent.
    expect("valence" in (stored ?? {})).toBe(false);
  });

  it("leaves an ordinary reading note with neither field", async () => {
    await call("POST", POST, { blockId: BLOCK, quote: QUOTE, start: AT, body: "hm" });
    const stored = (await loadComments(SLUG))[0];
    expect("criterionId" in (stored ?? {})).toBe(false);
    expect("valence" in (stored ?? {})).toBe(false);
  });
});

describe("what the route refuses, and it refuses rather than rounds", () => {
  /** Every refusal must also leave nothing behind. */
  const refused = async (body: Record<string, unknown>, match: RegExp) => {
    const r = await call("POST", POST, { blockId: BLOCK, quote: QUOTE, start: AT, ...body });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(match);
    expect(await loadComments(SLUG)).toEqual([]);
  };

  it("refuses a placement on a criterion that does not exist", async () => {
    await refused({ criterionId: "spya-k3m9qt", valence: -50 }, /not one of your criteria/);
  });

  it("refuses a placement on a criterion belonging to another article", async () => {
    /* `criterionId` comes off a request, so on its own it names any string.
       The criteria are read for THIS slug, so a criterion saved under another
       one is the same refusal as a made-up id.

       **That is all this case proves, and the name says so.** It runs against
       the filesystem store, which has no notion of an owner at all, so it is
       not evidence about *another referee's* criterion. Owner scoping lives in
       `ownedSlug` (src/store/pg.ts), which the Postgres store puts in front of
       every read, and the test that actually holds it there is "a criterion
       under somebody else's article is not theirs to place on" in
       tests/referee-criteria-store.test.ts — against a real database, with two
       owners in it. GPT Sol's finding 6 named this comment as claiming more
       than the case beneath it checked. */
    const elsewhere = "test-comment-referee-mark-other";
    const other = await beginCriterion(elsewhere, "someone else's question", { kind: "single" });
    try {
      await refused({ criterionId: other.id, valence: -50 }, /not one of your criteria/);
    } finally {
      await rm(path.resolve(import.meta.dirname, "..", "data", elsewhere), {
        recursive: true,
        force: true,
      });
    }
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
    expect((await loadComments(SLUG))[0]?.criterionId).toBe(criterionId);
  });
});

describe("a second Save under a stored id", () => {
  it("hands the same comment back when the placement has not changed", async () => {
    const criterionId = await aCriterion();
    const made = { blockId: BLOCK, quote: QUOTE, start: AT, criterionId, valence: -80 };
    const first = await call("POST", POST, { id: "spya-k3m9qt", ...made });
    expect(first.status).toBe(201);
    const again = await call("POST", POST, { id: "spya-k3m9qt", ...made });
    expect(again.status).toBe(201);
    expect(again.body.comment?.valence).toBe(-80);
    expect(await loadComments(SLUG)).toHaveLength(1);
  });

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
    expect((await loadComments(SLUG))[0]?.valence).toBe(-80);
  });
});
