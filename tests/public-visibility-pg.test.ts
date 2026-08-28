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
  revisionBlocks,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId, type OwnerId, runInRequest } from "../src/owner.js";

loadEnvLocal();

/**
 * **Postgres, and set before `src/routes.ts` is ever imported.** `STORE` is read
 * once at module load in src/store/live.ts, which is why every import of the
 * route layer in this file is dynamic and everything else is not.
 */
process.env.SPIDERYARN_STORE = "postgres";

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
let reachable = false;
if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  let why = "";
  try {
    const probe = await pool.query(
      `select exists (
         select 1 from information_schema.columns
         where table_schema = 'spideryarn'
           and table_name = 'articles'
           and column_name = 'visibility'
       ) as ready`,
    );
    reachable = probe.rows[0]?.ready === true;
    if (!reachable) why = "spideryarn.articles.visibility is missing — run npm run db:migrate";
  } catch (err) {
    reachable = false;
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();
  if (!reachable) console.warn(`\n  ⚠ DATABASE_URL is set but these tests are skipping: ${why}\n`);
}

const when = reachable ? describe : describe.skip;

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
when("sharing one article", { timeout: 60_000 }, () => {
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
  });

  /**
   * **The metadata endpoint is 404 before publication too**, and until 2026-08-28
   * nothing said so.
   *
   * The suite only ever asked for metadata *after* the article was public, so
   * `loadMetadata` losing its visibility clause would have been invisible here —
   * and it was invisible in the SQL test as well, because that test exercised a
   * helper the real query did not use. Two checks, one blind spot, and the
   * article endpoint's own 404 covering for both. GPT Sol's finding 3.
   */
  it("and its metadata is 404 as well, not just its prose", async () => {
    expect((await articleRow())?.visibility).toBe("private");
    const r = await call("GET", `/api/public/metadata/${SLUG}`);
    expect(r.status).toBe(404);
    /* The same sentence the article endpoint gives, so a visitor cannot tell
       "not shared" from "no such article" by comparing the two. */
    expect(r.body.error).toMatch(/No article artefacts/);
    expect(r.headers["Cache-Control"]).toBe("no-store");
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

  it("carries none of the four canaries", async () => {
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
    /* And the extracted title *is* there — otherwise the four lines above would
       pass on an empty response. */
    expect(r.text).toContain(EXTRACTED_TITLE);
  });

  it("shows the metadata page which artefacts exist, and nothing about the pipeline", async () => {
    const r = await call("GET", `/api/public/metadata/${SLUG}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      slug: SLUG,
      title: EXTRACTED_TITLE,
      available: { arc: false, tweets: false, glossary: false, summary: false, ideas: false },
    });
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

  /** And Bob still cannot reach it through the owner's route. */
  it("and the owned route still refuses everybody else", async () => {
    const r = await call("GET", `/api/article/${SLUG}`, { as: OUTSIDER });
    expect(r.status).toBe(404);
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
          /* **Every route in the inventory, not two paths typed here.** The
             dispatcher walks the same list, so "the whole public surface spends
             nothing" is a claim about whatever routes exist — including the four
             slice 1b adds. GPT Sol's finding 5. Plus a miss and an unknown path,
             because the error paths run code too. */
          expect(PUBLIC_ROUTES.length).toBeGreaterThan(0);
          for (const path of [
            ...PUBLIC_ROUTES.map((route) => route.path(SLUG)),
            ...PUBLIC_ROUTES.map((route) => route.path("no-such-article-anywhere")),
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

async function clean() {
  const db = getDb();
  await db.delete(articleVisibilityChanges).where(eq(articleVisibilityChanges.articleId, ARTICLE_ID));
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, ARTICLE_ID));
  await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, ARTICLE_ID));
  await db.delete(blockIdentities).where(eq(blockIdentities.articleId, ARTICLE_ID));
  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, ARTICLE_ID));
  await db.delete(articles).where(and(eq(articles.id, ARTICLE_ID), eq(articles.slug, SLUG)));
}
