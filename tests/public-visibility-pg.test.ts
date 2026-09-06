/**
 * **The switch and what it switches**, against a real Postgres.
 *
 * Three of GPT Sol's five 1a scenarios, 2026-08-28, in one file because they
 * share one fixture and because two of them are only meaningful together:
 *
 * 2. *Real-Postgres visibility lifecycle.* Default private; `NULL` and
 *    `"world"` refused; owner publishes; the public read becomes 200; repeated
 *    publish is a no-op; unpublish makes the next read 404; one event per
 *    transition. **The positive control is the same fixture observed as both
 *    404 and 200 in one run** — a predicate that matches nothing looks exactly
 *    like one that is working.
 * 3. *Owner authorization and anonymous equivalence.* Bob cannot change Alice's
 *    visibility; Alice can. An anonymous response and a signed-in stranger's
 *    are byte-identical, while Alice's own owned response deliberately differs
 *    through a private-title canary. That difference is the control.
 * 5. *Ownerless and zero-spend public execution.* The whole public surface run
 *    inside an empty request-owner scope: `currentOwnerId()` stays unusable and
 *    nothing reaches the gateway.
 *
 * ## Why a real database
 *
 * `NOT NULL DEFAULT 'private'` and the CHECK are the fail-closed half of this
 * feature, and neither exists anywhere but in Postgres. A mocked query builder
 * would agree with whatever the code believed. The plan says so:
 * *"Prove it against a real Postgres, not a mocked query builder."*
 *
 * Skips loudly when there is no database, for the reason
 * tests/owner-isolation.test.ts gives at length: a suite that silently checks
 * nothing is worse than one that is not there.
 */

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { collectSpend } from "../src/ai-spend.js";
import type { Verifier } from "../src/auth.js";
import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articleVisibilityChanges,
  articles,
  blockIdentities,
  comments,
  refereeCriteria,
  revisionBlocks,
  searchRuns,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { pgReady } from "./helpers/pg-ready.js";
import { pgPublicReader } from "../src/store/public-reader.js";
import { documentTitle } from "../src/title-text.js";
import { safePublicCanonical } from "../src/urls.js";
import { currentOwnerId, type OwnerId, runInRequest } from "../src/owner.js";
import type { Glossary, Ideas, TweetThread } from "../src/types.js";

loadEnvLocal();

/**
 * **Postgres, and set before `src/routes.ts` is ever imported.** `STORE` is read
 * once at module load in src/store/live.ts, which is why every import of the
 * route layer in this file is dynamic and everything else is not.
 */

const SLUG = "test-public-visibility";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000ea";
const REVISION_ID = "00000000-0000-4000-8000-0000000000eb";
const BLOCK_ID = "spya-wpvvqa";
const HEADING_ID = "spya-wpvvqb";

/**
 * **The canaries.** Each is a field the owner's read returns and the public one
 * must not, planted in the fixture so that an assertion about its absence is an
 * assertion about something that was really there.
 *
 * A test that checks a private field is missing from a row that never had one
 * passes on any code at all.
 */
const PRIVATE_TITLE = "My own name for this — nobody else's business";
const PRIVATE_NOTE = "ungistable: repeats the pull quote";
const PRIVATE_PURPOSE = "reading it to argue with a colleague on Thursday";
const SIGNED_URL = "https://example.test/piece?sig=SECRETSIGNATURE";
const EXTRACTED_TITLE = "A piece somebody shared";

/**
 * **Slice 1b's canaries**, and they are the same idea one artefact deeper.
 *
 * The four canaries above are fields of the article row. These four are fields
 * *inside* the JSONB documents the four new columns hold — so they are the ones
 * that would cross if the reader selected the column (which it now must) and
 * the projection copied it wholesale (which it must not).
 *
 * `PRIVATE_LOOKUP` is the sharpest: `glossary_lookups` is a table the public
 * graph cannot reach at all, but a *stored* lookup inside the glossary document
 * comes across the wire from Postgres whatever the table guard says, and only
 * the projection in src/public/dto.ts drops it.
 */
const PRIVATE_LOOKUP = "what the owner asked the web and what it said back";
const PRIVATE_PROFILE_HASH = "profilehash-nobodyelsesbusiness";
/** And what a visitor *must* see, so the absences above are not absence of everything. */
const PUBLIC_TERM = "Integrated information theory";
const PUBLIC_IDEA = "You cannot theorise about what you have no way to measure.";
const PUBLIC_TWEET = "The first post of the thread.";

/* ── The owner's own work, which crosses since 2026-09-04 ────────────────────
   Four strings a visitor must see and six rows they must not. Real prose in
   both directions: a suite where the things that should cross are empty proves
   only that nothing crossed, which is what the payload looks like when the
   whole feature is broken.
   docs/plans/260904c-more-modes-on-a-shared-link.md § Stages 3 and 4. */
const PUBLIC_NOTE = "The bit I keep coming back to.";
const PUBLIC_COMMENT_ANSWER = "Because the example is doing the arguing.";
const PUBLIC_CRITERION = "anywhere the argument turns on a number";
const PUBLIC_HIT_REASON = "It is the sentence the claim rests on.";
/** A referee's placement, a failed run's message, an unfinished one's words. */
const REFEREE_NOTE = "Overstated for the evidence given — a peer review, not a reading note.";
const PENDING_NOTE = "Asked a moment ago and still out.";
const FAILED_ERROR = "the model refused";
const FAILED_CRITERION = "a question whose model call failed";
const PENDING_CRITERION = "a question still out with the model";
/** The palette slot the owner pinned, so the visitor's marks wear their colour. */
const PINNED_COLOUR = 3;

/* ── A second article, private, with work of its own on it ───────────────────
   The whole case for widening `tests/public-imports.test.ts`'s table allowlist
   was that the two new queries **repeat `publicSlug` in their own `where`**
   rather than reading a child table by an article id an earlier statement
   found. Nothing else in this suite can tell those apart: with one article in
   the fixture, a query filtering on nothing at all returns the same rows as one
   filtering correctly.

   So there is a neighbour. It is never published, it has a comment and a saved
   search, and the assertions on the *shared* article's payload look for its
   words. Delete either predicate and this is what goes red. */
const NEIGHBOUR_ID = "00000000-0000-4000-8000-0000000000ed";
const NEIGHBOUR_SLUG = "test-public-visibility-neighbour";
const NEIGHBOUR_BLOCK = "spya-nbrqaa";
const NEIGHBOUR_NOTE = "A note on an article that was never shared with anybody.";
const NEIGHBOUR_CRITERION = "a question asked of a piece nobody else can read";

/**
 * **The artefacts slice 1b carries**, each stuffed with the provenance it
 * must not carry.
 *
 * A module constant rather than an object literal in `beforeAll`, because one
 * case below deliberately replaces them all to test `personalised` and has to
 * put them back afterwards. Restoring them to `null` — which is what it did
 * when nothing read them — leaves every later case
 * in this file reading an article with no artefacts on it, and the failure
 * lands wherever vitest happens to order things rather than here.
 */
const ARTEFACTS: {
  glossary: Glossary;
  ideas: Ideas;
  tweets: TweetThread;
} = {
  glossary: {
    version: "glossary/2",
    generator: "test",
    slug: SLUG,
    sourceHash: "abc",
    profileHash: PRIVATE_PROFILE_HASH,
    passes: 2,
    generatedAt: "2026-02-02T00:00:00.000Z",
    elapsedMs: 1,
    entries: [
      {
        id: "spya-wpvvqc",
        name: PUBLIC_TERM,
        kind: "concept",
        aliases: ["IIT"],
        senseHere: "The author's narrowed use of it.",
        blocks: [BLOCK_ID],
        lookup: {
          answer: PRIVATE_LOOKUP,
          citations: [],
          searches: 3,
          model: "a-search-model",
          at: "2026-02-02T00:00:00.000Z",
        },
      },
    ],
  },
  ideas: {
    version: "ideas/1",
    generator: "test",
    slug: SLUG,
    sourceHash: "abc",
    profileHash: PRIVATE_PROFILE_HASH,
    generatedAt: "2026-02-02T00:00:00.000Z",
    elapsedMs: 1,
    ideas: [
      {
        id: "spya-wpvvqd",
        name: "Measurement first",
        provenance: "assumed",
        statement: PUBLIC_IDEA,
        occurrences: [
          { blockId: BLOCK_ID, quote: "The prose a visitor", reasoning: "It is offered as one." },
        ],
      },
    ],
  },
  tweets: {
    version: "tweets/1",
    generator: "test",
    slug: SLUG,
    sourceHash: "abc",
    profileHash: PRIVATE_PROFILE_HASH,
    limit: 280,
    tweets: [{ text: PUBLIC_TWEET, chars: 29 }],
    generatedAt: "2026-02-02T00:00:00.000Z",
    elapsedMs: 1,
  },
};

/**
 * The seeded development owner writes; a second uuid never writes anything.
 *
 * `owner_id` really does reference `auth.users(id)` (drizzle/0001), so a made-up
 * owner cannot be *given* an article — but they can perfectly well ask for one,
 * which is the whole of Bob's part here.
 */
const OUTSIDER = "00000000-0000-4000-8000-0000000000ec" as OwnerId;

/** Read out here, where `currentOwnerId()` still answers from the environment. */
const OWNER = currentOwnerId();

/**
 * The probe runs at MODULE LOAD so the skip is a real vitest skip, and it asks
 * for **the column this suite is about** rather than for the schema in general
 * — an unmigrated database would otherwise fail every case with a confusing
 * 42703 instead of saying what to run.
 */
/**
 * **The column this suite is about**, rather than the schema in general: an
 * unmigrated database would otherwise fail every case with a confusing 42703
 * instead of saying what to run. Hand-rolled until 2026-09-05, and a skip until
 * then too. tests/helpers/pg-ready.ts.
 */
await pgReady({
  suite: "tests/public-visibility-pg.test.ts",
  columns: [{ table: "spideryarn.articles", column: "visibility" }],
});

/** A verifier that vouches for exactly one person. src/auth.ts § `Verifier`. */
const asPerson = (sub: string): Verifier => async () => ({
  ok: true,
  claims: { sub, email: `${sub}@example.test`, role: "authenticated", is_anonymous: false },
});

interface Reply {
  status: number;
  headers: Record<string, string>;
  /** The raw JSON text, so two responses can be compared **byte for byte**. */
  text: string;
  body: Record<string, unknown>;
}

/** Drive `handleApi` with a fake request/response pair. */
async function call(
  method: string,
  url: string,
  opts: { body?: unknown; as?: string } = {},
): Promise<Reply> {
  const payload = opts.body === undefined ? [] : [Buffer.from(JSON.stringify(opts.body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    {
      method,
      url,
      /* No header at all when nobody is named — an anonymous request, which is
         the only case that matters and the one a developer signed in through
         `apiFetch` would never exercise. */
      headers: opts.as === undefined ? {} : { authorization: "Bearer whatever" },
    },
  ) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  const headers: Record<string, string> = {};
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(chunk: string) {
      text = chunk ?? "";
    },
  } as unknown as ServerResponse;

  const { handleApi } = await import("../src/routes.js");
  await handleApi(req, res, opts.as === undefined ? undefined : asPerson(opts.as));
  return { status, headers, text, body: text ? JSON.parse(text) : {} };
}

/**
 * One request, over a real TCP socket, reporting what actually arrived.
 *
 * Deliberately `node:http` rather than `fetch`: `fetch` discards a HEAD body
 * before anybody can count it, so it cannot tell "the server sent nothing" from
 * "the client threw it away" — and that is the whole question here.
 */
function overTheWire(
  port: number,
  method: string,
  path: string,
): Promise<{ status: number; headers: Record<string, string | undefined>; bytes: number; text: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const req = httpRequest({ port, host: "127.0.0.1", method, path, timeout: 20_000 }, (res) => {
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers as Record<string, string | undefined>,
          bytes: body.length,
          text: body.toString("utf8"),
        });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`${method} ${path} timed out`));
    });
    req.on("error", reject);
    req.end();
  });
}

async function events() {
  return getDb()
    .select()
    .from(articleVisibilityChanges)
    .where(eq(articleVisibilityChanges.articleId, ARTICLE_ID));
}

async function articleRow() {
  const [row] = await getDb()
    .select({ visibility: articles.visibility, publicAt: articles.publicAt })
    .from(articles)
    .where(eq(articles.id, ARTICLE_ID));
  return row;
}

/**
 * **60 seconds, and it is a wait rather than a limit.**
 *
 * `getDb()`'s pool is five connections with no acquire timeout (src/db/client.ts),
 * so under a full `npm test` — where a dozen Postgres suites run in parallel
 * against one local database — a query can sit waiting for a connection for
 * tens of seconds. At 30s this file timed out in two full runs out of four
 * while passing every time it was run alone, which reads as a broken test and
 * is a queue. The same exposure every pg suite here has; see
 * tests/store-shelf-pg.test.ts on why two seconds was not enough either.
 */
describe("sharing one article", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await clean();
    const db = getDb();
    await db.insert(articles).values({
      id: ARTICLE_ID,
      ownerId: OWNER,
      slug: SLUG,
      /* Two canaries on the article row itself. Both are the owner's, both are
         read by the owner's own endpoints, and neither may cross. */
      titleOverride: PRIVATE_TITLE,
      purpose: PRIVATE_PURPOSE,
    });
    await db.insert(articleRevisions).values({
      id: REVISION_ID,
      articleId: ARTICLE_ID,
      status: "published",
      title: EXTRACTED_TITLE,
      /* The FINAL fetched URL, with a signed query parameter on it — the exact
         hazard the payload table names. */
      finalUrl: SIGNED_URL,
      fetchedAt: new Date("2026-02-02T00:00:00.000Z"),
      note: "extraction note, ours rather than the article's",
      wordCount: 12,
      blockCount: 2,
      partCount: 0,
      sectionCount: 0,
      rootGist: "A short piece about nothing.",
      tree: {
        version: "1",
        generator: "test",
        slug: SLUG,
        rootId: "n0",
        nodes: {
          n0: {
            id: "n0",
            depth: 0,
            parent: null,
            children: [],
            range: [HEADING_ID, BLOCK_ID],
            title: "Root",
            gist: "A short piece about nothing.",
          },
        },
      },
      ...ARTEFACTS,
    });
    await db
      .update(articles)
      .set({ currentRevisionId: REVISION_ID })
      .where(eq(articles.id, ARTICLE_ID));
    await db
      .insert(blockIdentities)
      .values([
        { articleId: ARTICLE_ID, blockId: HEADING_ID },
        { articleId: ARTICLE_ID, blockId: BLOCK_ID },
      ]);
    await db.insert(revisionBlocks).values([
      {
        articleId: ARTICLE_ID,
        revisionId: REVISION_ID,
        blockId: HEADING_ID,
        ordinal: 0,
        tag: "h1",
        kind: "heading",
        level: 1,
        text: "A piece somebody shared",
        words: 4,
        html: "<h1>A piece somebody shared</h1>",
        gistable: true,
      },
      {
        articleId: ARTICLE_ID,
        revisionId: REVISION_ID,
        blockId: BLOCK_ID,
        ordinal: 1,
        tag: "p",
        kind: "text",
        text: "The prose a visitor is here for.",
        words: 7,
        html: "<p>The prose a visitor is here for.</p>",
        gistable: true,
        /* The third canary: the owner's `blocksQuery` selects this column, and
           the public query must never fetch it. */
        note: PRIVATE_NOTE,
      },
    ]);

    /* **The reader's own work on the piece**, in both directions. Four rows a
       visitor must be shown and six they must not, on one article, so that the
       filters are exercised against rows sitting beside the ones that pass —
       a fixture holding only the forbidden kind cannot tell a working predicate
       from a broken read.
       docs/plans/260904c-more-modes-on-a-shared-link.md § Stages 3 and 4. */
    await db.insert(refereeCriteria).values({
      articleId: ARTICLE_ID,
      id: "spya-crt2aa",
      ownerId: OWNER,
      kind: "single",
      criterion: "is the evidence proportionate to the claim",
      status: "done",
    });
    await db.insert(comments).values([
      {
        articleId: ARTICLE_ID,
        id: "spya-cmt23z",
        ownerId: OWNER,
        blockId: BLOCK_ID,
        quote: "The prose a visitor is here for.",
        start: 0,
        body: PUBLIC_NOTE,
        status: "done",
        answer: PUBLIC_COMMENT_ANSWER,
        /* Two citations, one of which the public URL policy must refuse. */
        citations: [
          { url: "https://example.com/paper?id=7", title: "The paper" },
          { url: "http://localhost:5273/private" },
        ],
        /* Operational columns, set so that a widened projection would show. */
        model: "some-model",
        searches: 3,
      },
      {
        /* **A referee's placement.** Its `body` is a peer review, and dropping
           `criterionId` from the DTO would publish it with its context removed
           rather than not publish it. The row has to go. */
        articleId: ARTICLE_ID,
        id: "spya-cmt24z",
        ownerId: OWNER,
        blockId: BLOCK_ID,
        quote: "The prose a visitor is here for.",
        start: 0,
        body: REFEREE_NOTE,
        status: "done",
        criterionId: "spya-crt2aa",
        valence: -50,
      },
      {
        /* A model call still in flight: nothing a visitor could act on. */
        articleId: ARTICLE_ID,
        id: "spya-cmt25z",
        ownerId: OWNER,
        blockId: BLOCK_ID,
        quote: "The prose a visitor is here for.",
        start: 0,
        body: PENDING_NOTE,
        status: "pending",
      },
      {
        /* And one that failed, whose only content is our error. */
        articleId: ARTICLE_ID,
        id: "spya-cmt26z",
        ownerId: OWNER,
        blockId: BLOCK_ID,
        quote: "The prose a visitor is here for.",
        start: 0,
        status: "error",
        error: FAILED_ERROR,
      },
    ]);

    /* **The fingerprint the owner's own read computes**, so that `stale: false`
       below means *the visitor and the owner agree about this article* rather
       than *the derivation returned false*. Taken from `sourceHashFor` rather
       than from `hashBlocks` here, deliberately: the claim worth pinning is
       that the two reads hash the same rows in the same order, and a test
       computing it a second way would be pinning its own arithmetic.

       **Imported dynamically**, for the reason this file's header gives about
       the route layer: `STORE` is read once at module load, and a static import
       of `store/pg.js` at the top of this file reaches it before
       `process.env.SPIDERYARN_STORE` is set two lines down — which turns every
       request in the suite into a 501. Found by doing it. */
    const { sourceHashFor } = await import("../src/store/pg.js");
    const fingerprint = await sourceHashFor(ARTICLE_ID);
    await db.insert(searchRuns).values([
      {
        articleId: ARTICLE_ID,
        id: "spya-run23z",
        ownerId: OWNER,
        criterion: PUBLIC_CRITERION,
        status: "done",
        colour: PINNED_COLOUR,
        sourceHash: fingerprint ?? null,
        hits: [
          {
            blockId: BLOCK_ID,
            quote: "The prose a visitor is here for.",
            confidence: 88,
            reasoning: PUBLIC_HIT_REASON,
            start: 0,
          },
        ],
        model: "some-model",
      },
      {
        /* Answered against a text that has since moved. Same shape, one
           different hash — which is the whole of what `stale` is. */
        articleId: ARTICLE_ID,
        id: "spya-run24z",
        ownerId: OWNER,
        criterion: "a question answered before the article changed",
        status: "done",
        sourceHash: "0123456789abcdef",
        hits: [],
      },
      {
        /* Imported before runs recorded what they answered — no hash at all,
           and *cannot tell* has to fall on the side that says so. */
        articleId: ARTICLE_ID,
        id: "spya-run25z",
        ownerId: OWNER,
        criterion: "a question from before we recorded fingerprints",
        status: "done",
        hits: [],
      },
      {
        articleId: ARTICLE_ID,
        id: "spya-run26z",
        ownerId: OWNER,
        criterion: PENDING_CRITERION,
        status: "pending",
        hits: [],
      },
      {
        articleId: ARTICLE_ID,
        id: "spya-run27z",
        ownerId: OWNER,
        criterion: FAILED_CRITERION,
        status: "error",
        error: FAILED_ERROR,
        hits: [],
      },
    ]);

    /* **The neighbour**, private for the whole of this suite. No revision and
       no blocks: nothing reads them, and a comment needs only an article and a
       `block_identities` row to point at. See its constants above. */
    await db.insert(articles).values({
      id: NEIGHBOUR_ID,
      ownerId: OWNER,
      slug: NEIGHBOUR_SLUG,
    });
    await db.insert(blockIdentities).values({
      articleId: NEIGHBOUR_ID,
      blockId: NEIGHBOUR_BLOCK,
    });
    await db.insert(comments).values({
      articleId: NEIGHBOUR_ID,
      id: "spya-cmt77z",
      ownerId: OWNER,
      blockId: NEIGHBOUR_BLOCK,
      quote: "a passage of the other piece",
      start: 0,
      body: NEIGHBOUR_NOTE,
      status: "done",
    });
    await db.insert(searchRuns).values({
      articleId: NEIGHBOUR_ID,
      id: "spya-run77z",
      ownerId: OWNER,
      criterion: NEIGHBOUR_CRITERION,
      status: "done",
      hits: [],
    });
  });

  afterAll(async () => {
    await clean();
    await closeDb();
  });

  /* ------------------------------------------- the lifecycle, in order -- */

  it("starts private, so a stranger gets 404", async () => {
    expect((await articleRow())?.visibility).toBe("private");
    const r = await call("GET", `/api/public/article/${SLUG}`);
    expect(r.status).toBe(404);
    /* And it must not confirm the article exists — 404, never 403, and the
       message is the same one an unknown slug gets. */
    expect(r.body.error).toMatch(/No article artefacts/);
    expect(r.headers["Cache-Control"]).toBe("no-store");
    /* **And the four artefacts are not readable either**, which is the whole of
       slice 1b's exposure. They are on this row *now* — the fixture wrote them
       before this case ran — so a public read that fetched the columns without
       the visibility predicate would put a private article's glossary,
       ideas and thread at a public URL, and the assertions further
       down would not notice, because they all run after publication. */
    for (const canary of [PUBLIC_TERM, PUBLIC_IDEA, PUBLIC_TWEET]) {
      expect(r.text, canary).not.toContain(canary);
    }
  });

  /**
   * **The deleted metadata endpoint is 404 whatever the article's visibility
   * is** — and it is 404 for the *other* reason, which is the assertion.
   *
   * There was a second public route until 2026-09-02
   * (docs/plans/260902j-public-read-only-access-audit-and-improvements.md
   * § Cluster B). A deletion is the one edit that can quietly open the hole the
   * closed room exists to prevent: a path the dispatcher no longer matches has
   * to end *inside* `/api/public/`, and the way it would fail is by falling
   * through to the authenticated gate and answering 401, which reads as *sign
   * in and you may see it*. So the sentence is read, not just the status —
   * `No public API route` rather than `No article artefacts`.
   *
   * Over HTTP against the real dispatcher, because that is the only place the
   * fallthrough could happen; tests/public-dispatch.test.ts makes the same
   * claim without a database.
   */
  it("and the deleted metadata path 404s from inside the closed room, not at the gate", async () => {
    expect((await articleRow())?.visibility).toBe("private");
    const r = await call("GET", `/api/public/metadata/${SLUG}`);
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/No public API route/);
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });

  /**
   * **And the head is 404 too**, which is the surface stage 2 adds and the one
   * with no endpoint yet to hide behind.
   *
   * Called directly rather than over HTTP because the route is a later slice.
   * That is exactly why it is worth asserting now: a reader function with no
   * caller is where a missing visibility clause sits undisturbed until the day
   * something calls it. The article read had a version of that problem too: its
   * SQL test exercised a helper that one of the reads did not actually use.
   */
  it("and its head is 404 as well, so a preview cannot name it", async () => {
    expect((await articleRow())?.visibility).toBe("private");
    await expect(pgPublicReader.loadHead(SLUG)).rejects.toThrow(/No article artefacts/);
  });

  it("refuses to be published without the rights confirmation", async () => {
    const r = await call("PUT", `/api/article/${SLUG}/visibility`, {
      body: { visibility: "public" },
      as: OWNER,
    });
    expect(r.status).toBe(400);
    expect((await articleRow())?.visibility).toBe("private");
    expect(await events()).toHaveLength(0);
  });

  it("refuses a visibility that is not one of the two", async () => {
    for (const visibility of ["world", "published", null, 1, ""]) {
      const r = await call("PUT", `/api/article/${SLUG}/visibility`, {
        body: { visibility, rightsConfirmed: true },
        as: OWNER,
      });
      expect({ visibility, status: r.status }).toEqual({ visibility, status: 400 });
    }
    expect((await articleRow())?.visibility).toBe("private");
  });

  it("refuses a body carrying a field it has never heard of", async () => {
    const r = await call("PUT", `/api/article/${SLUG}/visibility`, {
      body: { visibility: "public", rightsConfirmed: true, alsoIndexIt: true },
      as: OWNER,
    });
    expect(r.status).toBe(400);
    expect((await articleRow())?.visibility).toBe("private");
  });

  it("refuses rightsConfirmed on an unpublish, because nobody confirms a takedown", async () => {
    const r = await call("PUT", `/api/article/${SLUG}/visibility`, {
      body: { visibility: "private", rightsConfirmed: true },
      as: OWNER,
    });
    expect(r.status).toBe(400);
  });

  /**
   * **Bob cannot change Alice's document**, and the refusal is a 404 rather than
   * a 403 — a 403 would confirm the article is there.
   */
  it("cannot be published by somebody who does not own it", async () => {
    const r = await call("PUT", `/api/article/${SLUG}/visibility`, {
      body: { visibility: "public", rightsConfirmed: true },
      as: OUTSIDER,
    });
    expect(r.status).toBe(404);
    expect((await articleRow())?.visibility).toBe("private");
    expect(await events()).toHaveLength(0);
  });

  it("is published by its owner, and the next anonymous read is 200", async () => {
    const put = await call("PUT", `/api/article/${SLUG}/visibility`, {
      body: { visibility: "public", rightsConfirmed: true },
      as: OWNER,
    });
    expect(put.status).toBe(200);
    expect(put.body.visibility).toBe("public");
    expect(typeof put.body.publicAt).toBe("string");

    /* **The positive control for the whole file**: the same fixture, seen as
       404 above and 200 here, in one run. Every other assertion passes if
       `publicSlug` simply matches nothing. */
    const r = await call("GET", `/api/public/article/${SLUG}`);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain("The prose a visitor is here for");
  });

  /**
   * The same fixture, refused above and served here — the positive control that
   * makes the 404 mean something rather than `publicSlug` matching nothing.
   */
  it("and now the head has the four values a preview is built from", async () => {
    const head = await pgPublicReader.loadHead(SLUG);
    expect(head.slug).toBe(SLUG);
    /* Whatever the fixture's title is, it is a string rather than the absence
       of one — the composer's clamping and escaping are unit-tested in
       tests/head-text.test.ts and are not what this is about. */
    expect(typeof head.title).toBe("string");
    /* **The two fields that exist only on this read.** `gist` is the
       description, and `canonical` is `final_url`, which the article read is
       forbidden to select at all — so this is also the assertion that says the
       two projections really are different, in a database rather than in a
       generated string. */
    expect(head).toHaveProperty("gist");
    /* **The candidate canonical arrives raw, and is refused downstream.** This
       fixture's `final_url` carries a signed query parameter on purpose, which
       is the hazard: publishing it would hand out the signature, and stripping
       the query and publishing the rest would name a different page. So the
       reader hands the value across untouched and `safePublicCanonical` says
       no — and this assertion is the seam between the two, which neither the
       SQL test nor tests/head-text.test.ts can see on its own. */
    expect(head.canonical).toBe(SIGNED_URL);
    expect(safePublicCanonical(head.canonical as string)).toBeNull();
    /* And nothing that renders came with it. A head read that quietly grew a
       `blocks` or a `tree` key is the failure this whole projection exists to
       make impossible, and it would not show up in any assertion above. */
    expect(Object.keys(head).sort()).toEqual(["canonical", "gist", "slug", "title"]);
  });

  it("wrote exactly one event, saying who and from what to what", async () => {
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slug: SLUG,
      actorOwnerId: OWNER,
      fromVisibility: "private",
      toVisibility: "public",
      rightsConfirmed: true,
    });
  });

  it("is idempotent: publishing again changes nothing and logs nothing", async () => {
    const before = await articleRow();
    const again = await call("PUT", `/api/article/${SLUG}/visibility`, {
      body: { visibility: "public", rightsConfirmed: true },
      as: OWNER,
    });
    expect(again.status).toBe(200);
    expect(again.body.visibility).toBe("public");
    const after = await articleRow();
    /* `public_at` must not move. It answers "how long has this been up", and a
       button pressed twice has not restarted that. */
    expect(after?.publicAt?.toISOString()).toBe(before?.publicAt?.toISOString());
    expect(again.body.publicAt).toBe(before?.publicAt?.toISOString());
    expect(await events()).toHaveLength(1);
  });

  /* ------------------------- what the stranger actually gets, and does not -- */

  it("serves the prose, the tree and the blocks — the point of the feature", async () => {
    const r = await call("GET", `/api/public/article/${SLUG}`);
    const article = r.body as {
      meta: { title: string };
      blocks: { html: string }[];
      tree: { nodes: Record<string, unknown> };
    };
    expect(article.blocks).toHaveLength(2);
    expect(article.blocks[1]?.html).toContain("The prose a visitor is here for");
    expect(Object.keys(article.tree.nodes)).toEqual(["n0"]);
  });

  it("carries none of the eight canaries", async () => {
    const r = await call("GET", `/api/public/article/${SLUG}`);
    /* Each one is asserted to be *in the fixture* first, so the absence below
       is an absence of something that was really there. */
    const [row] = await getDb()
      .select({ title: articles.titleOverride, purpose: articles.purpose })
      .from(articles)
      .where(eq(articles.id, ARTICLE_ID));
    expect(row?.title).toBe(PRIVATE_TITLE);
    expect(row?.purpose).toBe(PRIVATE_PURPOSE);

    expect(r.text).not.toContain(PRIVATE_TITLE);
    expect(r.text).not.toContain(PRIVATE_PURPOSE);
    expect(r.text).not.toContain(PRIVATE_NOTE);
    expect(r.text).not.toContain("SECRETSIGNATURE");
    /* And the ones inside the artefacts, which slice 1b put on the wire. */
    expect(r.text).not.toContain(PRIVATE_LOOKUP);
    expect(r.text).not.toContain(PRIVATE_PROFILE_HASH);
    expect(r.text).not.toContain("a-search-model");
    /* And the extracted title *is* there — otherwise the lines above would
       pass on an empty response. */
    expect(r.text).toContain(EXTRACTED_TITLE);
  });

  /**
   * **The artefacts really are served**, which is what slice 1b is for and
   * what makes the absences above absences of something rather than of
   * everything.
   *
   * Every canary line in the case above passes just as happily against a
   * response that dropped every column — the exact failure this repo keeps
   * writing up. So the same response is read for the things a visitor came
   * here to get.
   */
  it("serves the glossary, the ideas and the thread", async () => {
    const r = await call("GET", `/api/public/article/${SLUG}`);
    const body = r.body as {
      glossary?: { entries: { name: string }[] };
      ideas?: { ideas: { statement: string }[] };
      tweets?: { limit: number; tweets: { text: string }[] };
    };
    expect(body.glossary?.entries[0]?.name).toBe(PUBLIC_TERM);
    expect(body.ideas?.ideas[0]?.statement).toBe(PUBLIC_IDEA);
    expect(body.tweets?.tweets[0]?.text).toBe(PUBLIC_TWEET);
    expect(body.tweets?.limit).toBe(280);
  });

  /**
   * **The owner's comments, over a real table, with the rows that must not
   * cross sitting beside them.**
   *
   * The three filters this exercises are all in SQL rather than in a `map`
   * (`PUBLIC_COMMENTS_WHERE`), and every one of them is invisible from the
   * client: a referee's note, an unfinished model call and a failed one all
   * look like ordinary comments in a projection. The fixture has one of each,
   * on the same article as the one that should cross, so a broken predicate is
   * a wrong list rather than an empty one.
   * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3.
   */
  it("serves the owner's finished comments, and none of the three kinds that must not go", async () => {
    const r = await call("GET", `/api/public/article/${SLUG}`);
    const body = r.body as { comments: { id: string; body?: string; answer?: string;
      citations?: { url: string }[] }[] };

    /* Exactly one, named — not "at least one", which four rows in a table make
       easy to satisfy by accident. */
    expect(body.comments.map((c) => c.id)).toEqual(["spya-cmt23z"]);
    expect(body.comments[0]?.body).toBe(PUBLIC_NOTE);
    expect(body.comments[0]?.answer).toBe(PUBLIC_COMMENT_ANSWER);

    /* And the three by their own words, so a failure names which filter broke
       rather than only that the count was wrong. */
    expect(r.text, "the referee's placement").not.toContain(REFEREE_NOTE);
    expect(r.text, "the unfinished call").not.toContain(PENDING_NOTE);
    expect(r.text, "our own error message").not.toContain(FAILED_ERROR);

    /* The citation policy, over the wire this time: the ordinary address
       survives with its query string, and the loopback one is dropped rather
       than blanked. */
    expect(body.comments[0]?.citations?.map((c) => c.url)).toEqual([
      "https://example.com/paper?id=7",
    ]);

    /* **And nothing from the article next door**, which is what the join back
       to `articles` and the repeated `publicSlug` are for. Without them this
       read is *"every finished comment in the database"*, and the count above
       would not notice. */
    expect(r.text, "the neighbour's note").not.toContain(NEIGHBOUR_NOTE);
  });

  /**
   * **The owner's saved searches, and the two run states that must not cross.**
   *
   * The same shape as the comments case, and one thing more that no other test
   * in this feature can reach: **`stale` is computed against the fingerprint of
   * the blocks this very read fetched**, so this is where the visitor's answer
   * and the owner's are checked to agree.
   *
   * All three arms of that are here, and the first is the one that matters:
   * a run whose hash matches must come back **not stale**. Get the hash inputs
   * wrong — the sanitised blocks instead of the raw rows, the wrong order, the
   * wrong revision — and every arm returns `true`, every saved search on every
   * shared article wears *older version*, and nothing anywhere goes red. There
   * is no symptom except a warning that reads as a fact about the article.
   * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 4.
   */
  it("serves the owner's finished searches, with staleness worked out both ways", async () => {
    const r = await call("GET", `/api/public/article/${SLUG}`);
    const body = r.body as { searches: { id: string; criterion: string; stale: boolean;
      colour?: number; hits: { quote: string; reasoning: string }[] }[] };

    expect(body.searches.map((s) => s.id)).toEqual(["spya-run23z", "spya-run24z", "spya-run25z"]);

    const [fresh, moved, unknown] = body.searches;
    /* **The positive control.** Without this line a derivation hardwired to
       `true` passes the two below it. */
    expect(fresh?.stale, "a run answered against these very blocks").toBe(false);
    expect(moved?.stale, "a run answered against a different text").toBe(true);
    expect(unknown?.stale, "a run that never recorded what it answered").toBe(true);

    /* The reader's own question and the passage it found really are there. */
    expect(fresh?.criterion).toBe(PUBLIC_CRITERION);
    expect(fresh?.hits[0]?.reasoning).toBe(PUBLIC_HIT_REASON);
    expect(fresh?.hits[0]?.quote).toBe("The prose a visitor is here for.");
    /* And the colour the owner pinned, so the visitor's marks are the colours
       the owner chose rather than whatever the hash gives them. */
    expect(fresh?.colour).toBe(PINNED_COLOUR);

    /* The two states that must not cross, by their own words. */
    expect(r.text, "a run still out with the model").not.toContain(PENDING_CRITERION);
    expect(r.text, "a run whose model call failed").not.toContain(FAILED_CRITERION);
    /* And the fingerprint itself stops at the mapping — it was selected, it was
       used, and it does not leave. tests/public-reads.test.ts is the other half
       and asserts the column *is* fetched. */
    expect(r.text, "the fingerprint").not.toContain("0123456789abcdef");
    /* And the neighbour's, for the reason the comments case gives. */
    expect(r.text, "the neighbour's question").not.toContain(NEIGHBOUR_CRITERION);
  });

  /**
   * **And the deleted metadata path is still 404 for an article that *is*
   * shared** — which is the control on the case above.
   *
   * There the article was private, so a 404 could have been the visibility
   * predicate doing the work; here the same fixture is public and its own
   * article route answers 200 two cases up. The only thing that can refuse this
   * path now is that no route matches it, and the error sentence says which.
   * The artefacts this route used to list are asserted off the article payload
   * in the case above it.
   */
  it("and the deleted metadata path 404s for a shared article too, by route and not by predicate", async () => {
    const r = await call("GET", `/api/public/metadata/${SLUG}`);
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/No public API route/);
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });

  /* --------------------------------------------- anonymous equivalence -- */

  /**
   * **The signed-in stranger, who is the likeliest first use of this feature.**
   *
   * `ownedSlug` matches on owner, so the friend Greg sends a link to — who
   * happens to have an account — hit exactly the same wall as a stranger and
   * got the worse experience for having signed up. The fix is the rule that the
   * public routes ignore `Authorization` entirely, and this is what says they do.
   */
  it("answers a signed-in stranger byte for byte what it answers a stranger", async () => {
    const anonymous = await call("GET", `/api/public/article/${SLUG}`);
    const bob = await call("GET", `/api/public/article/${SLUG}`, { as: OUTSIDER });
    /* And the owner too: same URL, same bytes. One public URL must not return
       personalised responses, or it could never be cached without a `Vary`. */
    const alice = await call("GET", `/api/public/article/${SLUG}`, { as: OWNER });
    expect(bob.text).toBe(anonymous.text);
    expect(alice.text).toBe(anonymous.text);
  });

  /**
   * **And the control that makes the line above mean something.**
   *
   * If the public route were quietly served through the owned path, the three
   * responses above would still be identical to each other — and identical to
   * this one. The owner's own endpoint deliberately differs: it runs the meta
   * through `titleFor()`, so it shows the private rename.
   */
  it("while the owner's OWN endpoint deliberately differs", async () => {
    const owned = await call("GET", `/api/article/${SLUG}`, { as: OWNER });
    expect(owned.status).toBe(200);
    expect(owned.text).toContain(PRIVATE_TITLE);
    const anonymous = await call("GET", `/api/public/article/${SLUG}`);
    expect(owned.text).not.toBe(anonymous.text);
  });

  /**
   * **The one place the tab is allowed to change at mount, written down as a
   * decision rather than left as a surprise.**
   *
   * Everything else in this body of work exists to stop the server-composed
   * `<title>` being replaced by a different one when React mounts — five
   * divergences, docs/project/page-titles.md. This is the sixth, and it is not
   * a bug: the public head must never carry `articles.title_override`, because
   * that is the owner's private name for the piece and the head is served to
   * strangers. The owner's own payload deliberately applies it (`titleFor`), so
   * an **owner** hard-loading their own renamed public article sees the
   * extracted title for a moment and then their own name for it.
   *
   * Nobody else can see this. A stranger, a signed-in stranger and the owner all
   * get byte-identical *public* responses (the case above), so the change is
   * visible only to the one person who already knows both strings.
   *
   * GPT Sol raised it, 2026-08-30, as something needing "an explicit accepted
   * exception and test, or different tab semantics — never disclosure of the
   * private rename in the public head". This is the exception, accepted: the
   * disclosure is the thing that must not move, and it is asserted first.
   */
  it("changes the owner's tab at mount, which is the accepted cost of hiding the rename", async () => {
    const head = await pgPublicReader.loadHead(SLUG);

    /* **The property that must never regress, first.** Everything above an
       assertion is a lid on it, and this is the one worth the whole case. */
    expect(head.title, "the public head must not carry the private rename").not.toBe(PRIVATE_TITLE);
    expect(JSON.stringify(head)).not.toContain(PRIVATE_TITLE);
    expect(documentTitle(head.title)).not.toContain(PRIVATE_TITLE);

    /* What it says instead — the extracted title, spelled out. */
    expect(head.title).toBe(EXTRACTED_TITLE);
    expect(documentTitle(head.title)).toBe(`${EXTRACTED_TITLE} · Spideryarn`);

    /* And what the owner's client will put there a moment later, from their own
       endpoint. The two differ, and that difference is the exception. */
    const owned = await call("GET", `/api/article/${SLUG}`, { as: OWNER });
    const ownerTitle = (owned.body as { meta: { title: string | null } }).meta.title;
    expect(ownerTitle).toBe(PRIVATE_TITLE);
    expect(documentTitle(ownerTitle)).not.toBe(documentTitle(head.title));
  });

  /** And Bob still cannot reach it through the owner's route. */
  it("and the owned route still refuses everybody else", async () => {
    const r = await call("GET", `/api/article/${SLUG}`, { as: OUTSIDER });
    expect(r.status).toBe(404);
  });

  /**
   * **The owner can read their own document's visibility**, which until
   * 2026-08-28 nothing could.
   *
   * A real hole in 1a rather than a nicety. The Access & Sharing card had
   * nothing owner-facing to read, so it was asking the public metadata endpoint
   * anonymously — the only non-mutating question available to it — and that
   * endpoint **could not tell private from absent**, because both are 404 by
   * design. The card was drawing "we could not check" because it could not
   * honestly draw anything else. (That endpoint was deleted on 2026-09-02; this
   * field is what replaced its misuse.)
   *
   * Asserted through `handleApi` as the owner, at the moment the article is
   * public, so it is the round trip the card makes rather than a store call.
   */
  it("tells the owner their own article is shared, and when", async () => {
    expect((await articleRow())?.visibility).toBe("public");
    const r = await call("GET", `/api/metadata/${SLUG}`, { as: OWNER });
    expect(r.status).toBe(200);
    /* **The same `VisibilityState` the PUT answers with**, nested rather than
       two flat fields, so the sharing card reads the toggle's reply and the
       page load with one line and the two cannot drift. */
    expect(r.body.sharing).toEqual({
      visibility: "public",
      publicAt: (await articleRow())?.publicAt?.toISOString(),
      /* All of them, because slice 1b's fixture plants a `profileHash` on every
         artefact — it is the canary for the field that must not reach a
         visitor, so it has to be on all of them to prove none carries it.
         The order is `STEP_ORDER`'s, which is what the store walks.
         The case below plants a mixed set, and asserts the empty reading too,
         so this is not the only shape this field is ever seen in. */
      personalised: ["tweets", "glossary", "ideas"],
      /**
       * **What a shared link would carry, against a real Postgres** — and the
       * only place that claim is checked end to end.
       *
       * `shareableArtefacts` (src/store/pg.ts) reads presence off the revision
       * row, and the fixture plants three artefacts and not the other two — so
       * this asymmetry is the assertion. A unit test cannot make it: the whole
       * question is whether the columns the projection publishes are the
       * columns this field reports, and only a row answers that.
       *
       * The owner's sharing dialog lists them
       * (docs/plans/260902n-the-sharing-dialog-lists-what-goes-out-and-what-stays.md),
       * and the `false`s are the half that matters — an inventory that said
       * *arc* here would name a rung of Outline this article does not have.
       *
       * **Not a count.** This said *"these five"* while `PublicArtefacts` held
       * seven, because timeline and sketch arrived on 2026-09-04 and a number
       * written into prose does not move with the type. The object below does
       * have to move with it, and does — it is a whole-value assertion, so a
       * new artefact fails here rather than passing with the field ignored.
       */
      available: {
        arc: false,
        tweets: true,
        glossary: true,
        ideas: true,
        quotes: false,
        timeline: false,
        sketch: false,
      },
    });
  });

  /**
   * **And the GET and the PUT answer in the same shape**, which is the reason
   * they share a type rather than each having their own.
   *
   * Asserted by comparing the two responses rather than by comparing each to a
   * literal: a test that checked both against the same hand-written object
   * would still pass if they drifted together away from it, and drifting
   * together is not the failure — drifting apart is.
   */
  it("and answers the GET in the same shape as the PUT", async () => {
    const put = await call("PUT", `/api/article/${SLUG}/visibility`, {
      body: { visibility: "public", rightsConfirmed: true },
      as: OWNER,
    });
    const get = await call("GET", `/api/metadata/${SLUG}`, { as: OWNER });
    expect(put.status).toBe(200);
    /* The PUT answers `VisibilityState`; the GET's block **extends** it, so the
       two agree on every field the switch owns and the block adds one the
       switch has no business knowing. Compared field by field against the PUT's
       own body rather than against a literal, because drifting together is not
       the failure — drifting apart is. */
    const sharing = get.body.sharing as Record<string, unknown>;
    for (const key of Object.keys(put.body as Record<string, unknown>)) {
      expect({ key, value: sharing[key] }).toEqual({
        key,
        value: (put.body as Record<string, unknown>)[key],
      });
    }
    expect(sharing).toHaveProperty("personalised");
  });

  /**
   * **`personalised` names the artefacts written for a profile, and only the
   * ones that exist.**
   *
   * GPT Sol's improvement on the plan, 2026-08-27: the confirmation dialog
   * should name *which* artefacts were personalised rather than warn in general,
   * which turns a sentence nobody reads into a specific fact about the thing
   * being shared.
   *
   * Three artefacts are planted and they are deliberately different from each
   * other, because a test where every case points the same way proves one thing
   * rather than three:
   *
   * - a **glossary with a `profileHash`** — must be listed;
   * - a **list of ideas with `profileHash: null`**, which means *written
   *   deliberately without a profile* (src/types.ts) and is a different thing
   *   from personalised — must NOT be listed, and is what a truthy test or a
   *   `!== undefined` test would get wrong;
   * - **`tweets` absent entirely** — must not be listed, which is the "only
   *   artefacts that exist" guarantee. An artefact never generated cannot have
   *   been personalised, and listing one would have the dialog name a thread
   *   that is not there.
   */
  it("names the personalised artefacts, and only ones that were really built", async () => {
    const db = getDb();
    /* **Empty first, and it is a real answer rather than a gap** — the field
       being present and empty is the store saying it looked and found none.
       This reading used to come free from a fixture with no `profileHash` on
       it anywhere; slice 1b's fixture plants one on every artefact as a
       canary, so it is asserted deliberately here instead of being lost. */
    await db
      .update(articleRevisions)
      .set({ glossary: null, ideas: null, tweets: null })
      .where(eq(articleRevisions.id, REVISION_ID));
    const none = await call("GET", `/api/metadata/${SLUG}`, { as: OWNER });
    expect((none.body.sharing as { personalised: string[] }).personalised).toEqual([]);

    await db
      .update(articleRevisions)
      .set({
        /* Whole artefacts rather than casts, because the *shape* is part of what
           is being tested: `profileHash` is one optional field among ten, and a
           partial literal behind an `as` would compile past a rename of it. */
        glossary: {
          version: "1",
          generator: "test",
          slug: SLUG,
          sourceHash: "s1",
          entries: [],
          passes: 1,
          generatedAt: "2026-08-28T00:00:00.000Z",
          elapsedMs: 1,
          profileHash: "abc123",
        },
        ideas: {
          version: "1",
          generator: "test",
          slug: SLUG,
          sourceHash: "s1",
          ideas: [],
          generatedAt: "2026-08-28T00:00:00.000Z",
          elapsedMs: 1,
          /* **Null, not absent**, and that is the case this fixture exists for:
             null means *written deliberately without a profile*, which is a
             different thing from personalised. */
          profileHash: null,
        },
        /* Nulled with the rest: this case's whole claim is about which
           artefacts are listed, and a thread left over from the fixture — which
           carries a `profileHash` — would put another name in the list. */
        tweets: null,
      })
      .where(eq(articleRevisions.id, REVISION_ID));
    try {
      const r = await call("GET", `/api/metadata/${SLUG}`, { as: OWNER });
      const sharing = r.body.sharing as { personalised: string[] };
      expect(sharing.personalised).toEqual(["glossary"]);
      /* Said separately, because `toEqual` above would pass a list that happened
         to be right for the wrong reason if the ordering ever changed. */
      expect(sharing.personalised).not.toContain("ideas");
      expect(sharing.personalised).not.toContain("tweets");
      /* And never a step that has no model call to personalise. */
      for (const step of ["fetch", "extract", "blocks", "hierarchy", "arc"]) {
        expect(sharing.personalised, step).not.toContain(step);
      }
    } finally {
      /* **The fixture back, not four nulls.** See `ARTEFACTS`. */
      await db
        .update(articleRevisions)
        .set(ARTEFACTS)
        .where(eq(articleRevisions.id, REVISION_ID));
    }
  });

  /**
   * **And a stranger cannot ask the same question**, which is what makes the
   * field safe to put on this response at all.
   *
   * The owned metadata route is owner-only by construction — `ownedSlug` — so
   * this is really a check that adding a field did not change who may read it.
   * Bob gets the same 404 he got before, and gets it whether or not the article
   * is public: a public *article* does not make its owner's metadata page
   * public.
   */
  it("but a stranger asking the owned route still gets nothing", async () => {
    expect((await articleRow())?.visibility).toBe("public");
    for (const who of [OUTSIDER, undefined]) {
      const r = await call("GET", `/api/metadata/${SLUG}`, who ? { as: who } : {});
      /* 404 for Bob, 401 for nobody at all — different refusals, and neither
         carries the field. */
      expect([401, 404]).toContain(r.status);
      expect(r.text).not.toContain("publicAt");
      expect(r.body.sharing).toBeUndefined();
    }
  });

  /* ----------------------------------- ownerless, and spending nothing -- */

  /**
   * Sol's scenario 5. The whole public surface, run inside an empty request-owner
   * scope, with the collector `handleApi` uses opened around it.
   *
   * Two independent spies, because they catch different mistakes: the collector
   * catches a call made *through* the gateway, and the `fetch` spy catches an
   * outbound request of any kind — including one that bypassed the ledger,
   * which is precisely the thing a ledger cannot see.
   */
  it("runs the whole public surface ownerless, and spends nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const { report } = await collectSpend(async () => {
        await runInRequest(async () => {
          /* No `setRequestOwner`. The box stays empty and this is what the
             public path really looks like. */
          expect(() => currentOwnerId()).toThrow(/before the request was authenticated/);
          const { servePublicApi, PUBLIC_ROUTES } = await import("../src/public/routes.js");
          const { pathOf } = await import("../src/public/route-names.js");
          /* **Every route in the inventory, not two paths typed here.** The
             dispatcher walks the same list, so "the whole public surface spends
             nothing" is a claim about whatever routes exist — including the four
             slice 1b adds. GPT Sol's finding 5. Plus a miss and an unknown path,
             because the error paths run code too. */
          expect(PUBLIC_ROUTES.length).toBeGreaterThan(0);
          /* **Both kinds**, since 2026-09-04. `pathOf` hands back the collection
             route's one path and the slug routes' per-slug ones, so the claim
             stays *"the whole public surface"* rather than *"the routes that
             happen to take a slug"*. The set is asserted so a sweep cannot go on
             passing over an inventory that has quietly lost a kind. */
          /* Three since 2026-09-06, when `asset` landed. `pathOf` fills its
             hash in with sixty-four zeros, so what this sweep proves about it is
             that reaching it spends nothing and needs no owner — not that it
             serves anything, which no sweep can know a hash for.
             tests/public-asset-route.test.ts is where that is checked. */
          expect(new Set(PUBLIC_ROUTES.map((r) => r.kind))).toEqual(
            new Set(["slug", "collection", "asset"]),
          );
          for (const path of [
            ...PUBLIC_ROUTES.map((route) => pathOf(route, SLUG)),
            ...PUBLIC_ROUTES.map((route) => pathOf(route, "no-such-article-anywhere")),
            "/api/public/nothing",
          ]) {
            const res = {
              statusCode: 0,
              setHeader() {},
              end() {},
            } as unknown as ServerResponse;
            await servePublicApi({ res, path, method: "GET" }).catch((err: Error) => {
              /* The two misses throw a 404, which is an answer rather than a
                 fault. Anything else is a real failure and must surface. */
              if ((err as { status?: number }).status !== 404) throw err;
            });
          }
          /* Still unusable on the way out — nothing in there set an owner. */
          expect(() => currentOwnerId()).toThrow(/before the request was authenticated/);
        });
      });
      expect(report.calls).toEqual([]);
      expect(report.pending).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  /**
   * **The positive control for the spy**, which Sol asked for in exactly these
   * words: *"temporarily invoke the gateway from one public handler and watch
   * the spy fail."* Doing it by hand each time is how a spy stops being
   * believed, so it is done here, in the same scope, on every run.
   */
  it("and the fetch spy really would have noticed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    try {
      await runInRequest(async () => {
        await fetch("https://openrouter.ai/api/v1/chat/completions");
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  /**
   * **HEAD over a real socket**, which is the only place the wire can be read.
   *
   * Every other case in this file drives `handleApi` with a hand-built `res`
   * that records whatever `end()` is given. That is right for asserting our own
   * code and useless for asserting Node's: a fake response has none of the body
   * suppression a real `ServerResponse` applies to a HEAD, so "no body reached
   * the client" is a claim only a socket can settle.
   *
   * What must hold, and all of it is checked against the GET rather than against
   * a constant, so the two cannot drift:
   *
   * - the same status,
   * - the same `Cache-Control` and `Content-Type`,
   * - a `Content-Length` **equal to the GET's**, which is what makes a HEAD a
   *   truthful preview — Node drops the header entirely unless it is set, so
   *   this is the assertion that would go red if `send`'s branch were removed,
   * - and zero bytes of body.
   *
   * The unfurler this is for is stage 2's, and it HEADs before it GETs.
   */
  it("answers a real HEAD over a socket with the GET's headers and no body", async () => {
    const { handleApi } = await import("../src/routes.js");
    const server = createServer((req, res) => {
      void handleApi(req, res).then((handled) => {
        if (!handled) {
          res.statusCode = 404;
          res.end();
        }
      });
    });
    try {
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;

      const get = await overTheWire(port, "GET", `/api/public/article/${SLUG}`);
      const head = await overTheWire(port, "HEAD", `/api/public/article/${SLUG}`);

      /* The GET first, as the control: if the article were not being served at
         all, every claim about the HEAD below would hold vacuously. */
      expect(get.status).toBe(200);
      expect(get.bytes).toBeGreaterThan(100);
      expect(get.text).toContain("The prose a visitor is here for");

      expect(head.status).toBe(200);
      expect(head.headers["cache-control"]).toBe(get.headers["cache-control"]);
      expect(head.headers["content-type"]).toBe(get.headers["content-type"]);
      expect(head.headers["content-length"]).toBe(get.headers["content-length"]);
      expect(head.bytes).toBe(0);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  /* ------------------------------------------------------- unpublishing -- */

  it("is unpublished by its owner, and the next anonymous read is 404 again", async () => {
    const put = await call("PUT", `/api/article/${SLUG}/visibility`, {
      body: { visibility: "private" },
      as: OWNER,
    });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ visibility: "private", publicAt: null });
    /* Cleared, not kept. `public_at` says "how long has this been up", which has
       no answer for a private document — and a stale one would read as "was
       public once", which is a different question and the log's job. */
    expect((await articleRow())?.publicAt).toBeNull();

    const r = await call("GET", `/api/public/article/${SLUG}`);
    expect(r.status).toBe(404);
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });

  it("and the log now has both transitions, in order, and no more", async () => {
    const rows = (await events()).sort((a, b) => a.at.getTime() - b.at.getTime());
    expect(rows.map((r) => `${r.fromVisibility}→${r.toVisibility}`)).toEqual([
      "private→public",
      "public→private",
    ]);
    /* Nobody confirms rights to take something down, and the row says so. */
    expect(rows.map((r) => r.rightsConfirmed)).toEqual([true, false]);
    expect(rows.every((r) => r.actorOwnerId === OWNER)).toBe(true);
  });

  /**
   * **The listing, in both of the states it has, and neither costs anything.**
   *
   * The ownerless sweep above visits `/api/public/library` once, with the
   * fixture public. That is one of two shapes this route has, and the other is
   * the one that would be easy to get wrong: an **empty** shelf. A listing that
   * answered a 404, or threw, or fell back to *something* when there was nothing
   * to list would pass every case in this file that runs while the fixture is
   * shared.
   *
   * So the same route is asked twice with the switch thrown in between:
   *
   * - **private** → a 200 with an empty list, not a 404 and not an error.
   *   *"Nobody has shared anything"* is an answer about the world, and a 404
   *   would make it read as a missing route.
   * - **public** → the article is on the shelf.
   *
   * Both inside `collectSpend` and under the `fetch` spy, because the point of
   * that section is that a stranger cannot cost us money — and *"the shelf is
   * empty, let me go and work something out"* is exactly the shape that would.
   *
   * **It lives down here, after the log assertion, and that is not filing.**
   * Flipping the switch appends to `article_visibility_changes`, and *"the log
   * now has both transitions, in order, and no more"* above counts every row in
   * it. Two extra transitions from this test made that one red — which is the
   * guard working, so the test moved rather than the guard being loosened. The
   * race case below clears the table before it runs, so nothing after this
   * counts rows either. The fixture is left private, which is how this test
   * found it.
   */
  it("and the listing answers both a full shelf and an empty one, spending nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const shelf = async (): Promise<string[]> => {
      const { servePublicApi } = await import("../src/public/routes.js");
      let text = "";
      let status = 0;
      const res = {
        set statusCode(v: number) {
          status = v;
        },
        get statusCode() {
          return status;
        },
        setHeader() {},
        end(chunk: string) {
          text = chunk ?? "";
        },
      } as unknown as ServerResponse;
      await runInRequest(async () => {
        /* Ownerless, like every other visit to this namespace. */
        expect(() => currentOwnerId()).toThrow(/before the request was authenticated/);
        await servePublicApi({ res, path: "/api/public/library", method: "GET" });
      });
      expect(status).toBe(200);
      return (JSON.parse(text) as { entries: { slug: string }[] }).entries.map((e) => e.slug);
    };

    try {
      expect((await articleRow())?.visibility).toBe("private");
      const { report } = await collectSpend(async () => {
        /* A 200 with nothing in it — the empty case, asserted as an empty answer
           rather than as an absence of failure. */
        expect(await shelf()).not.toContain(SLUG);

        await call("PUT", `/api/article/${SLUG}/visibility`, {
          body: { visibility: "public", rightsConfirmed: true },
          as: OWNER,
        });
        expect(await shelf()).toContain(SLUG);
      });
      expect(report.calls).toEqual([]);
      expect(report.pending).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await call("PUT", `/api/article/${SLUG}/visibility`, {
        body: { visibility: "private" },
        as: OWNER,
      });
      fetchSpy.mockRestore();
    }
  });

  /**
   * **The database refuses what the code refuses**, which is the point of
   * writing the rule down twice.
   *
   * The route validates and the CHECK constrains, and neither can drift alone.
   * Asserted here rather than in a migration test because this is the database
   * the rest of the file is talking to.
   */
  it("cannot be given a third visibility, even below the route", async () => {
    await expect(
      getDb()
        .update(articles)
        .set({ visibility: "world" })
        .where(eq(articles.id, ARTICLE_ID)),
    ).rejects.toThrow();
    expect((await articleRow())?.visibility).toBe("private");
  });

  /**
   * **And it cannot be given none**, which this file's own header claimed was
   * tested and which nothing tested.
   *
   * GPT Sol's finding 6. The case above covers the CHECK; this covers the `NOT
   * NULL`, and they are different constraints failing with different SQLSTATEs.
   * It has to be raw SQL: Drizzle's types will not let `visibility: null`
   * through, which is a good property of Drizzle and the exact reason the claim
   * went unchecked — the thing that would stop me writing the bug also stopped
   * me testing for it.
   *
   * `NOT NULL` is the half that matters most, because it is what makes the
   * default fail-closed for every row that already existed when 0024 ran.
   */
  it("cannot be given no visibility at all", async () => {
    const failed = await getDb()
      .execute(sql`update spideryarn.articles set visibility = null where id = ${ARTICLE_ID}`)
      .then(() => null)
      .catch((err: unknown) => err);
    expect(failed, "a NULL visibility was accepted").not.toBeNull();

    /* **Read off the `cause` chain, not off the error.** Drizzle's wrapper
       carries neither the SQLSTATE nor the column — from the top this failure
       looks like nothing at all — so `failed.code` is `undefined` and a test
       asserting it would have been red for the right reason and then "fixed"
       by deleting the assertion. src/store/db-errors.ts is emphatic about this
       and I walked into it anyway; the first version of this test did exactly
       that. 23502 is not_null_violation, asserted by code rather than by
       message so a Postgres release rewording its errors does not fail it. */
    const chain: { code?: string; column?: string }[] = [];
    for (let link: unknown = failed, depth = 0; link && depth < 4; depth += 1) {
      chain.push(link as { code?: string; column?: string });
      link = (link as { cause?: unknown }).cause;
    }
    const violation = chain.find((link) => link.code === "23502");
    expect(violation, `no not-null violation in the chain: ${JSON.stringify(chain)}`).toBeDefined();
    /* And it is *this* column, not some other not-null one further along. */
    expect(violation?.column).toBe("visibility");
    expect((await articleRow())?.visibility).toBe("private");
  });

  /**
   * **Two publishes at once produce one event, and that is the row lock's job.**
   *
   * Sol's finding 6, and it caught a real gap: removing `.for("update")` from
   * pg-visibility.ts left the whole suite green, so the lock this feature's
   * comment makes a point of explaining was untested.
   *
   * Both requests are started before either is awaited, so they are genuinely
   * in flight together rather than one after the other — the mistake that makes
   * most "concurrent" tests sequential and green on broken code
   * (docs/reusable/silent-success.md, and the note on async test mocks).
   *
   * Both must answer 200: the loser of the race is not an error, it is somebody
   * asking for a state that by then already holds, which is the idempotent case.
   * What must be exactly one is the **event**, because the log is a history and
   * "Alice pressed the button twice" is not a fact about the document.
   */
  it("writes one event when two publishes race", async () => {
    /* From private, so there is a real transition for the two to contend over. */
    await call("PUT", `/api/article/${SLUG}/visibility`, {
      body: { visibility: "private" },
      as: OWNER,
    });
    await getDb()
      .delete(articleVisibilityChanges)
      .where(eq(articleVisibilityChanges.articleId, ARTICLE_ID));
    expect((await articleRow())?.visibility).toBe("private");

    /**
     * **The window is forced open from outside, rather than hoped for.**
     *
     * The first version of this test just fired both `PUT`s with `Promise.all`
     * and asserted one event. It passed — and it passed with `.for("update")`
     * deleted, which is the mutation it was written to catch. Measured on this
     * laptop: two requests over a local socket do not overlap, the first
     * transaction finishes before the second reads, and the concurrency the
     * test is named for never happens. A concurrency test that has to be lucky
     * is the shape docs/reusable/silent-success.md keeps describing, and the
     * note on async test mocks names this exact variant.
     *
     * So a third connection takes the row's write lock first and holds it. Both
     * requests then reach their own read with the row already locked, and what
     * happens next is precisely the difference the code is making:
     *
     * - **with `for update`** — both block on the *read*. Releasing lets one
     *   through; it sees `private`, writes, commits. The other then reads
     *   `public` and no-ops. One event.
     * - **without it** — neither read blocks, so both see `private` before the
     *   release, and both then write and both insert. Two events.
     *
     * Deterministic rather than timing-dependent, and it is the lock's own
     * semantics doing the work rather than a `setTimeout`.
     */
    const { Pool } = await import("pg");
    const holder = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const client = await holder.connect();
    const body = { visibility: "public", rightsConfirmed: true };
    let race: Promise<[Reply, Reply]>;
    try {
      await client.query("begin");
      await client.query("select id from spideryarn.articles where id = $1 for update", [
        ARTICLE_ID,
      ]);

      race = Promise.all([
        call("PUT", `/api/article/${SLUG}/visibility`, { body, as: OWNER }),
        call("PUT", `/api/article/${SLUG}/visibility`, { body, as: OWNER }),
      ]);

      /* Long enough for both requests to have reached the database and be
         waiting on the row. If either had *not* got that far, the release below
         would simply let them run one after the other — which is the old,
         useless version of this test, so the wait is what makes it the new one. */
      await new Promise((r) => setTimeout(r, 300));
      await client.query("commit");
    } finally {
      client.release();
      await holder.end();
    }

    const [first, second] = await race;

    /* Both 200: the loser of the race is not an error, it is somebody asking for
       a state that by then already holds, which is the idempotent case. */
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.visibility).toBe("public");
    expect(second.body.visibility).toBe("public");

    /* **The assertion.** Exactly one, because the log is a history and "Alice
       pressed the button twice" is not a fact about the document. */
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromVisibility: "private", toVisibility: "public" });

    /* And both callers were told the same `public_at`, rather than one of them
       being handed a stamp that was overwritten a millisecond later. */
    expect(first.body.publicAt).toBe(second.body.publicAt);
  });

  /**
   * **The whole transaction rolls back, including the update.**
   *
   * Sol's finding 6 again. The code updates the row and then inserts the event,
   * and nothing checked that a failure in the second undoes the first — which
   * is the failure that matters, because it leaves an article publicly readable
   * with no record of anyone having shared it. That is precisely the state the
   * audit log exists to make impossible.
   *
   * Forced from the database rather than by stubbing the store: the constraint
   * that fires is `article_visibility_changes_moved`, a real rule on the real
   * table, and it fires during the real insert. A mocked rejection would prove
   * the `await` chain propagates and nothing about Postgres's transaction.
   *
   * The trigger is dropped in a `finally` whatever happens, so a failure here
   * cannot leave the table booby-trapped for the rest of the file.
   */
  it("rolls the visibility back when the audit insert fails", async () => {
    const db = getDb();
    await call("PUT", `/api/article/${SLUG}/visibility`, {
      body: { visibility: "private" },
      as: OWNER,
    });
    expect((await articleRow())?.visibility).toBe("private");
    const before = await events();

    await db.execute(sql`
      create or replace function spideryarn.test_break_visibility_log()
      returns trigger language plpgsql as $$
      begin
        raise exception 'forced failure for the rollback test';
      end $$`);
    await db.execute(sql`
      create trigger test_break_visibility_log
      before insert on spideryarn.article_visibility_changes
      for each row execute function spideryarn.test_break_visibility_log()`);
    try {
      const r = await call("PUT", `/api/article/${SLUG}/visibility`, {
        body: { visibility: "public", rightsConfirmed: true },
        as: OWNER,
      });
      /* A 500, and the reader is told nothing about the database — the message
         is the fixed one from src/messages.ts, because `guardDbStore` wraps this
         store. What matters here is the row, not the wording. */
      expect(r.status).toBe(500);

      /* **The assertion.** Still private: the update was rolled back with the
         insert, so there is no publicly readable article with no record of it. */
      expect((await articleRow())?.visibility).toBe("private");
      expect((await articleRow())?.publicAt).toBeNull();
      expect(await events()).toHaveLength(before.length);

      /* And the public read agrees, which is the reader-facing version of the
         same fact. */
      expect((await call("GET", `/api/public/article/${SLUG}`)).status).toBe(404);
    } finally {
      await db.execute(
        sql`drop trigger if exists test_break_visibility_log on spideryarn.article_visibility_changes`,
      );
      await db.execute(sql`drop function if exists spideryarn.test_break_visibility_log()`);
    }
  });

  /**
   * **The audit trail outlives the article**, which is the whole point of it.
   *
   * 0024 gave this table the `on delete cascade` every other child of `articles`
   * has, and GPT Sol's finding 2 caught it the same day: the log exists for the
   * complaint that arrives *after* a takedown, so cascade erased the record at
   * exactly the moment somebody would need it. The comment defending the cascade
   * also claimed nothing deletes an article, which was false at the time —
   * `src/store/import.ts` deleted orphans, until it went on 2026-09-01. Nothing
   * outside tests deletes one today, which makes this case the only place the
   * destructive path is exercised at all.
   *
   * Deleted for real here rather than archived, because archiving is not the
   * case: the shelf's `archived_at` leaves the row in place and nothing about
   * the log changes. What had to be proved is the destructive path.
   *
   * A separate article, so the file's own fixture and its `afterAll` are not
   * disturbed by deleting the thing every other case reads.
   */
  it("keeps the visibility log after the article itself is deleted", async () => {
    const db = getDb();
    const DOOMED = "00000000-0000-4000-8000-0000000000fb";
    const DOOMED_SLUG = "test-public-visibility-doomed";
    await db.delete(articleVisibilityChanges).where(eq(articleVisibilityChanges.slug, DOOMED_SLUG));
    await db.delete(articles).where(eq(articles.id, DOOMED));
    try {
      await db.insert(articles).values({ id: DOOMED, ownerId: OWNER, slug: DOOMED_SLUG });
      await db.insert(articleVisibilityChanges).values({
        articleId: DOOMED,
        slug: DOOMED_SLUG,
        actorOwnerId: OWNER,
        fromVisibility: "private",
        toVisibility: "public",
        rightsConfirmed: true,
      });

      await db.delete(articles).where(eq(articles.id, DOOMED));
      /* The article really is gone — otherwise everything below is vacuous. */
      const left = await db.select().from(articles).where(eq(articles.id, DOOMED));
      expect(left).toHaveLength(0);

      const [record] = await db
        .select()
        .from(articleVisibilityChanges)
        .where(eq(articleVisibilityChanges.slug, DOOMED_SLUG));
      expect(record, "the audit row went with the article").toBeDefined();
      /* Every field a complaint would ask about, still there. `articleId` is the
         one that goes, and null now means exactly one thing: it was deleted. */
      expect(record).toMatchObject({
        articleId: null,
        slug: DOOMED_SLUG,
        actorOwnerId: OWNER,
        fromVisibility: "private",
        toVisibility: "public",
        rightsConfirmed: true,
      });
      expect(record?.at).toBeInstanceOf(Date);
    } finally {
      await db
        .delete(articleVisibilityChanges)
        .where(eq(articleVisibilityChanges.slug, DOOMED_SLUG));
      await db.delete(articles).where(eq(articles.id, DOOMED));
    }
  });

  /** And the log will not take a row that records no movement. */
  it("and the change log refuses a row that did not move", async () => {
    await expect(
      getDb().insert(articleVisibilityChanges).values({
        articleId: ARTICLE_ID,
        slug: SLUG,
        actorOwnerId: OWNER,
        fromVisibility: "private",
        toVisibility: "private",
        rightsConfirmed: false,
      }),
    ).rejects.toThrow();
  });
});

/**
 * **A public article with a tree and no blocks**, which both public reads
 * refuse — by two different mechanisms, which is why both are asserted.
 *
 * `loadArticle` refuses it after fetching the block rows and finding none;
 * `loadHead` never fetches them, so it asks Postgres in SQL (`has_blocks`). A
 * head that answered 200 would put a title and a description on a link to a
 * blank screen, which is worse than no preview because a preview is a claim.
 *
 * **There was a third read that only checked the tree and served this
 * article**, and until 2026-09-02 the disagreement was written down here rather
 * than fixed. It went with its route
 * (docs/plans/260902j-public-read-only-access-audit-and-improvements.md
 * § Cluster B), so the two reads left agree, and this fixture is now what says
 * so rather than what documents the gap.
 *
 * **It needs its own fixture, and that is the point.** The main fixture above
 * has blocks, so deleting `hasBlocks` from the guard leaves every assertion in
 * this file green: the bar is unreachable from the corpus that exists. A guard
 * no fixture can redden is a comment. docs/reusable/silent-success.md.
 */
/* **Not the ...00ec/...00ed pair this fixture was first written with.**
   `tests/public-dispatch.test.ts` already declares ...00ed as a user id, and
   `tests/fixture-ids.test.ts` refuses a uuid claimed by two test files — vitest
   runs them in parallel against one database, so whichever tears down first can
   delete the other's row while both pass when run alone. The two ids here are
   in a block nothing else touches. */
const BONELESS_ID = "00000000-0000-4000-8000-0000000b04e0";
const BONELESS_REVISION = "00000000-0000-4000-8000-0000000b04e1";
const BONELESS_SLUG = "test-public-head-no-blocks";

describe("a public article whose revision has no blocks", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    const db = getDb();
    await cleanBoneless();
    await db.insert(articles).values({
      id: BONELESS_ID,
      ownerId: OWNER,
      slug: BONELESS_SLUG,
      visibility: "public",
    });
    await db.insert(articleRevisions).values({
      id: BONELESS_REVISION,
      articleId: BONELESS_ID,
      status: "published",
      title: "A piece with a tree and nothing under it",
      /* A tree, so `hasTree` is true and only `hasBlocks` can refuse this. */
      tree: { version: "test", generator: "test", slug: BONELESS_SLUG, rootId: "n0", nodes: {} },
    });
    await db
      .update(articles)
      .set({ currentRevisionId: BONELESS_REVISION })
      .where(eq(articles.id, BONELESS_ID));
  });

  afterAll(cleanBoneless);

  it("is refused by the head read, though it is genuinely public", async () => {
    /* The control on the control: it really is public and it really has a
       tree, so a refusal here cannot be the visibility clause or the tree bar
       doing the work. */
    const [row] = await getDb()
      .select({ visibility: articles.visibility })
      .from(articles)
      .where(eq(articles.id, BONELESS_ID));
    expect(row?.visibility).toBe("public");

    await expect(pgPublicReader.loadHead(BONELESS_SLUG)).rejects.toThrow(/No article artefacts/);
  });

  /**
   * **And the article read refuses it too**, by the other mechanism.
   *
   * This is the half that used to be a disagreement: a third read checked only
   * the tree and served this article, and the case here asserted that it did.
   * With that read gone, what is worth pinning is that the two survivors agree
   * — and that they are not simply the same check twice, since one counts rows
   * it fetched and the other asks in SQL.
   */
  it("and by the article read as well, which counts the blocks it fetched", async () => {
    await expect(pgPublicReader.loadArticle(BONELESS_SLUG)).rejects.toThrow(/No article artefacts/);
  });
});

/**
 * **An article with no title of its own, which is where the two sides said
 * different things.**
 *
 * `/read/<slug>` is served with a `<title>` composed from `loadHead`, and React
 * then sets `document.title` from the article payload's `meta.title`. Those come
 * from two different fallback chains:
 *
 *   loadHead   `title ?? headingTitle`               → then `Untitled`
 *   metaFrom   `title ?? headingTitle ?? slug`       (src/public/dto.ts)
 *
 * They agree for every article that has a title or an `<h1>`, which is nearly
 * all of them, and that is exactly why nothing caught it: **the corpus could not
 * reach the disagreement.** For an article with neither, the tab said
 * `Untitled · Spideryarn` and then changed to the slug a second later. GPT Sol
 * found it while reviewing the fix for the *other* divergence between these two
 * (whitespace and bidi normalising, src/title-text.ts), minutes before its
 * 45-minute budget ran out.
 *
 * It needs its own fixture for the reason the boneless one above does: the main
 * fixture has both a title and an `<h1>`, so the bug is unreachable from it and
 * every assertion in this file stays green with the fault in place.
 *
 * Blocks, so `hasBlocks` passes and the head is served at all — but not one of
 * them is a level-1 heading, which is what `PUBLIC_HEADING_TITLE` looks for.
 */
const TITLELESS_ID = "00000000-0000-4000-8000-0000000b04f0";
const TITLELESS_REVISION = "00000000-0000-4000-8000-0000000b04f1";
const TITLELESS_SLUG = "test-public-head-no-title";
/* The id alphabet excludes i, l, o and 1 (src/ids.ts), and `block_identities`
   has a check constraint on it — "notitl" is refused for three of those four. */
const TITLELESS_BLOCK = "spya-ntxhqz";

describe("a public article with neither a title nor an <h1>", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    const db = getDb();
    await cleanTitleless();
    await db.insert(articles).values({
      id: TITLELESS_ID,
      ownerId: OWNER,
      slug: TITLELESS_SLUG,
      visibility: "public",
    });
    await db.insert(articleRevisions).values({
      id: TITLELESS_REVISION,
      articleId: TITLELESS_ID,
      status: "published",
      /* The whole point of the fixture. */
      title: null,
      wordCount: 7,
      blockCount: 1,
      tree: {
        version: "test",
        generator: "test",
        slug: TITLELESS_SLUG,
        rootId: "n0",
        nodes: {
          n0: { id: "n0", depth: 0, parent: null, children: [], range: [TITLELESS_BLOCK, TITLELESS_BLOCK], title: "Root", gist: "Prose with no heading above it." },
        },
      },
    });
    /* `revision_blocks` has a foreign key into `block_identities` — an id is
       minted once for an article and every later revision points at it
       (docs/project/block-ids.md). Without this row the insert below fails with
       `revision_blocks_identity_fk`, and vitest reports the whole suite's tests
       as **skipped** rather than failed, which is how a broken fixture reads as
       green in a filtered summary. */
    await db.insert(blockIdentities).values({ articleId: TITLELESS_ID, blockId: TITLELESS_BLOCK });
    await db.insert(revisionBlocks).values([
      {
        articleId: TITLELESS_ID,
        revisionId: TITLELESS_REVISION,
        blockId: TITLELESS_BLOCK,
        ordinal: 0,
        /* `p`, not `h1`. A heading here would give the fallback something to
           find and the fixture would stop being able to show the bug. */
        tag: "p",
        kind: "text",
        text: "Prose with no heading above it.",
        words: 6,
        html: "<p>Prose with no heading above it.</p>",
        gistable: true,
      },
    ]);
    await db
      .update(articles)
      .set({ currentRevisionId: TITLELESS_REVISION })
      .where(eq(articles.id, TITLELESS_ID));
  });

  afterAll(cleanTitleless);

  it("gives the head the same title the client is about to set", async () => {
    const head = await pgPublicReader.loadHead(TITLELESS_SLUG);
    const r = await call("GET", `/api/public/article/${TITLELESS_SLUG}`);
    /* A precondition rather than a claim: without a payload there is no client
       title to disagree with, and the failure below would be about the wrong
       thing. */
    expect(r.status, "the fixture must be served at all").toBe(200);
    const client = (r.body as { meta: { title: string | null } }).meta.title;

    /* **The assertion this test is named for, and it goes first.** Everything
       above an assertion is a lid on it — a failing `expect` ends the case, so a
       fault caught by a later line proves nothing about this one. */
    expect(head.title, "loadHead and metaFrom must agree").toBe(client);

    /* And what they agree *on*, spelled out, because two sides agreeing on the
       wrong answer is the other way this passes while broken. The slug is the
       fallback the owner's side has always used; `Untitled` was only ever the
       head's. */
    expect(head.title).toBe(TITLELESS_SLUG);
    expect(documentTitle(head.title)).toBe(`${TITLELESS_SLUG} · Spideryarn`);
    expect(documentTitle(head.title)).not.toContain("Untitled");
  });

  /**
   * The control on the fixture: it really does have neither of the two things
   * the fallback prefers. If a later edit gave it a title or an `<h1>`, the case
   * above would pass with the bug back in place, and nothing would say so.
   */
  it("and the fixture really is titleless — no stored title, no level-1 heading", async () => {
    const db = getDb();
    const [rev] = await db
      .select({ title: articleRevisions.title })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, TITLELESS_REVISION));
    expect(rev?.title).toBeNull();

    const headings = await db
      .select({ blockId: revisionBlocks.blockId })
      .from(revisionBlocks)
      .where(and(eq(revisionBlocks.revisionId, TITLELESS_REVISION), eq(revisionBlocks.kind, "heading")));
    expect(headings).toEqual([]);
  });
});

/**
 * **The `<h1>` rung of the same fallback, which has two implementations.**
 *
 * `loadHead` finds the first level-1 heading **in SQL** (`PUBLIC_HEADING_TITLE`,
 * src/store/public-reader.ts); the article payload finds it **in TypeScript**
 * (`headingTitleOf`, src/library-scalars.ts, over the blocks it already has in
 * memory). Two implementations of one rule, and the tab is composed from the
 * first and then overwritten from the second.
 *
 * The fixture above covers only the last rung, the slug. This one covers the
 * rung above it, and it is built to be **awkward on the two axes each
 * implementation could get wrong on its own**:
 *
 *  - an `h2` sits before the first `h1`, so anything that takes the first
 *    *heading* rather than the first level-1 heading picks the wrong one;
 *  - there are two `h1`s, and the rows are **inserted in the wrong order**, so
 *    an implementation that leans on insertion order rather than `ordinal`
 *    picks the second.
 *
 * GPT Sol asked for this, 2026-08-30: the two agree today, but nothing paired
 * them, so a mutation like `level = 2` or a reversed `order by` in the SQL would
 * have survived every test in the repo.
 */
const HEADED_ID = "00000000-0000-4000-8000-0000000b0500";
const HEADED_REVISION = "00000000-0000-4000-8000-0000000b0501";
const HEADED_SLUG = "test-public-head-h1-fallback";
/** What both implementations must find: the first `h1` *by ordinal*. */
const HEADED_H1 = "The first level-one heading";

describe("a public article whose only title is its first <h1>", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    const db = getDb();
    await cleanHeaded();
    await db.insert(articles).values({
      id: HEADED_ID,
      ownerId: OWNER,
      slug: HEADED_SLUG,
      visibility: "public",
    });
    await db.insert(articleRevisions).values({
      id: HEADED_REVISION,
      articleId: HEADED_ID,
      status: "published",
      title: null,
      wordCount: 12,
      blockCount: 3,
      tree: {
        version: "test",
        generator: "test",
        slug: HEADED_SLUG,
        rootId: "n0",
        nodes: {
          n0: {
            id: "n0",
            depth: 0,
            parent: null,
            children: [],
            range: ["spya-hdgaaa", "spya-hdgccc"],
            title: "Root",
            gist: "A piece whose title is its heading.",
          },
        },
      },
    });
    for (const id of ["spya-hdgaaa", "spya-hdgbbb", "spya-hdgccc"]) {
      await db.insert(blockIdentities).values({ articleId: HEADED_ID, blockId: id });
    }
    /* **Deliberately not in ordinal order.** An implementation that takes the
       first row it is handed rather than the lowest `ordinal` gets the second
       `h1`, and that is the whole point of writing them this way round. */
    await db.insert(revisionBlocks).values([
      {
        articleId: HEADED_ID,
        revisionId: HEADED_REVISION,
        blockId: "spya-hdgccc",
        ordinal: 2,
        tag: "h1",
        kind: "heading",
        level: 1,
        text: "A second level-one heading, later in the document",
        words: 8,
        html: "<h1>A second level-one heading, later in the document</h1>",
        gistable: true,
      },
      {
        articleId: HEADED_ID,
        revisionId: HEADED_REVISION,
        blockId: "spya-hdgaaa",
        ordinal: 0,
        /* An `h2` above the first `h1`, so "first heading" and "first level-1
           heading" are different answers. */
        tag: "h2",
        kind: "heading",
        level: 2,
        text: "A subheading that comes first",
        words: 5,
        html: "<h2>A subheading that comes first</h2>",
        gistable: true,
      },
      {
        articleId: HEADED_ID,
        revisionId: HEADED_REVISION,
        blockId: "spya-hdgbbb",
        ordinal: 1,
        tag: "h1",
        kind: "heading",
        level: 1,
        text: HEADED_H1,
        words: 4,
        html: `<h1>${HEADED_H1}</h1>`,
        gistable: true,
      },
    ]);
    await db
      .update(articles)
      .set({ currentRevisionId: HEADED_REVISION })
      .where(eq(articles.id, HEADED_ID));
  });

  afterAll(cleanHeaded);

  it("finds the same <h1> in SQL that the payload finds in TypeScript", async () => {
    const head = await pgPublicReader.loadHead(HEADED_SLUG);
    const r = await call("GET", `/api/public/article/${HEADED_SLUG}`);
    expect(r.status, "the fixture must be served at all").toBe(200);
    const client = (r.body as { meta: { title: string | null } }).meta.title;

    /* The assertion this case is named for, first. */
    expect(head.title, "PUBLIC_HEADING_TITLE and headingTitleOf must agree").toBe(client);

    /* And what they agree on, spelled out — not derived from either, or the
       pair could agree on the subheading, on the second `h1`, or on the slug
       and this would still pass. */
    expect(head.title).toBe(HEADED_H1);
    expect(head.title).not.toBe(HEADED_SLUG);
    expect(documentTitle(head.title)).toBe(`${HEADED_H1} · Spideryarn`);
  });

  it("and the fixture really is awkward — an h2 first, and two h1s out of order", async () => {
    /* The control on the control. If a later edit tidied these rows into
       ordinal order or dropped the `h2`, the case above would pass with either
       implementation broken and nothing would say so. */
    const rows = await getDb()
      .select({ ordinal: revisionBlocks.ordinal, level: revisionBlocks.level })
      .from(revisionBlocks)
      .where(eq(revisionBlocks.revisionId, HEADED_REVISION));
    expect(rows.filter((r) => r.level === 1)).toHaveLength(2);
    const first = rows.find((r) => r.ordinal === 0);
    expect(first?.level, "an h2 must come before the first h1").toBe(2);
  });
});

async function cleanHeaded() {
  const db = getDb();
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, HEADED_ID));
  await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, HEADED_ID));
  await db.delete(blockIdentities).where(eq(blockIdentities.articleId, HEADED_ID));
  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, HEADED_ID));
  await db.delete(articles).where(eq(articles.id, HEADED_ID));
}

async function cleanTitleless() {
  const db = getDb();
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, TITLELESS_ID));
  await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, TITLELESS_ID));
  await db.delete(blockIdentities).where(eq(blockIdentities.articleId, TITLELESS_ID));
  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, TITLELESS_ID));
  await db.delete(articles).where(eq(articles.id, TITLELESS_ID));
}

async function cleanBoneless() {
  const db = getDb();
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, BONELESS_ID));
  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, BONELESS_ID));
  await db.delete(articles).where(eq(articles.id, BONELESS_ID));
}

async function clean() {
  const db = getDb();
  await db.delete(articleVisibilityChanges).where(eq(articleVisibilityChanges.articleId, ARTICLE_ID));
  /* **Before the blocks**, because a comment points at a `block_identities` row
     and a criterion is pointed at by a comment. Deleting in the other order
     leaves the suite red on a foreign key rather than on anything it is about. */
  for (const id of [ARTICLE_ID, NEIGHBOUR_ID]) {
    await db.delete(searchRuns).where(eq(searchRuns.articleId, id));
    await db.delete(comments).where(eq(comments.articleId, id));
    await db.delete(refereeCriteria).where(eq(refereeCriteria.articleId, id));
  }
  await db.delete(blockIdentities).where(eq(blockIdentities.articleId, NEIGHBOUR_ID));
  await db.delete(articles).where(eq(articles.id, NEIGHBOUR_ID));
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, ARTICLE_ID));
  await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, ARTICLE_ID));
  await db.delete(blockIdentities).where(eq(blockIdentities.articleId, ARTICLE_ID));
  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, ARTICLE_ID));
  await db.delete(articles).where(and(eq(articles.id, ARTICLE_ID), eq(articles.slug, SLUG)));
}
