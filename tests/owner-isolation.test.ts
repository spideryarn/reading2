/**
 * **Two readers, two shelves.** The test that would have caught the thing GPT
 * Sol led its review of the built auth code with, 2026-08-27:
 *
 * > any person who can create a Supabase account can see and change the same
 * > library, profile, chats, searches and reader state, and can run paid model
 * > operations
 *
 * The gate proved somebody existed and then threw the identity away. Every
 * store read went on using the process-wide `SPIDERYARN_OWNER_ID`, and
 * `articles.slug` is globally unique — so a second account did not get an empty
 * library, it got Greg's.
 *
 * ## Three kinds of test, and only one of them needs a database
 *
 * 1. **The scope** (`currentOwnerId` under AsyncLocalStorage) — pure, always
 *    runs. This is the half that decides *whose* id the queries are handed.
 * 2. **The static guard** — no file under `src/store/` may write
 *    `eq(articles.slug, …)` outside `pg.ts`. This is the half that stops the
 *    thirteenth lookup being written without an owner, months from now, by
 *    somebody who never read any of this.
 * 3. **The queries themselves**, against real Postgres, which skips when there
 *    is no database. Two owners, one slug each, and each one asked for the
 *    other's.
 *
 * ## What "red first" meant here
 *
 * Before the fix, (3) failed on every case and (1) could not be written at all.
 * The one worth recording is (2): run it against the code as it stood on
 * 2026-08-26 and it names seven files. That is the check having been seen to
 * fail — docs/reusable/silent-success.md, and the habit in this repo of never
 * trusting a check that has only ever been green.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Verifier } from "../src/auth.js";
import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  readerProfiles,
  revisionBlocks,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import {
  currentOwnerId,
  inRequest,
  type OwnerId,
  runInRequest,
  setRequestOwner,
} from "../src/owner.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/**
 * **Postgres, and set before `src/routes.ts` is ever imported.**
 *
 * `STORE` is read once at module load in src/store/live.ts, so this has to
 * happen above the dynamic import of `handleApi` below — which is why that one
 * import is dynamic while everything else in this file is not.
 *
 * The default is the filesystem store, and the first version of section 4 ran
 * against it and **failed**: person B was handed person A's profile. That is
 * not a bug in the gate, it is the filesystem store having no owner column and
 * nowhere to put one — one directory per slug under `data/`, one profile file,
 * no second reader. It is why src/store/index.ts now refuses to boot on
 * `files` in production, and why that refusal is a throw rather than a warning.
 */
process.env.SPIDERYARN_STORE = "postgres";

const ALICE = "00000000-0000-4000-8000-0000000000a1" as OwnerId;
const BOB = "00000000-0000-4000-8000-0000000000b2" as OwnerId;

/* ------------------------------------------------------ 1. the owner scope -- */

describe("whose id the store is handed", () => {
  it("is the environment's, outside a request", () => {
    expect(inRequest()).toBe(false);
    expect(currentOwnerId()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is the signed-in user's, inside one", () => {
    runInRequest(() => {
      setRequestOwner(ALICE);
      expect(currentOwnerId()).toBe(ALICE);
    });
  });

  /**
   * **The one that would have made the whole mechanism decorative.**
   *
   * `SPIDERYARN_OWNER_ID` used to win outright, and docs/project/deployment.md
   * tells you to set it on Vercel. Had the environment kept priority, deploying
   * exactly as documented would have handed every signed-in stranger Greg's own
   * owner id — every `ownedSlug` would have matched, every query would have
   * looked correct, and the isolation would have been dead code.
   */
  it("is the signed-in user's even when SPIDERYARN_OWNER_ID is set", () => {
    const before = process.env.SPIDERYARN_OWNER_ID;
    process.env.SPIDERYARN_OWNER_ID = BOB;
    try {
      runInRequest(() => {
        setRequestOwner(ALICE);
        expect(currentOwnerId()).toBe(ALICE);
      });
    } finally {
      if (before === undefined) delete process.env.SPIDERYARN_OWNER_ID;
      else process.env.SPIDERYARN_OWNER_ID = before;
    }
  });

  /**
   * A store read before the gate is a bug, and the tempting fallback — the
   * environment's owner — is a real person's data. So it throws.
   */
  it("throws inside a request that has not been authenticated yet", () => {
    runInRequest(() => {
      expect(() => currentOwnerId()).toThrow(/before the request was authenticated/);
    });
  });

  it("refuses to name an owner outside a request scope", () => {
    expect(() => setRequestOwner(ALICE)).toThrow(/outside a request scope/);
  });

  /**
   * **The keep-alive case, which is why this is `run()` and not `enterWith()`.**
   *
   * Several HTTP requests can arrive on one socket and share a calling async
   * context. `enterWith` mutates that context, so request two could read
   * request one's owner in the window before its own gate ran — one reader
   * served another's shelf, invisibly, and never in testing because test
   * connections are not reused.
   *
   * Two scopes interleaved across an await is the smallest thing that would
   * catch it.
   */
  it("keeps two overlapping requests apart", async () => {
    const seen: string[] = [];
    const one = runInRequest(async () => {
      setRequestOwner(ALICE);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(currentOwnerId());
    });
    const two = runInRequest(async () => {
      setRequestOwner(BOB);
      seen.push(currentOwnerId());
      await new Promise((r) => setTimeout(r, 10));
      seen.push(currentOwnerId());
    });
    await Promise.all([one, two]);
    expect(seen).toEqual([BOB, ALICE, BOB]);
  });

  /** And the scope does not outlive the request that opened it. */
  it("is closed again afterwards", () => {
    runInRequest(() => setRequestOwner(ALICE));
    expect(inRequest()).toBe(false);
  });
});

/* ----------------------------------------------------- 2. the static guard -- */

describe("every article lookup names an owner", () => {
  /**
   * `eq(articles.slug, …)` finds anybody's article, because the slug column is
   * globally unique. There are exactly **three** sanctioned lookups in the repo,
   * each in its own one-function leaf:
   *
   * | file | what it is for |
   * |---|---|
   * | `owned-slug.ts` | `ownedSlug` — slug **and owner**, the reader's own article |
   * | `public-slug.ts` | `publicSlug` — slug **and `visibility = 'public'`**, ownerless on purpose |
   * | `slug-is-taken.ts` | `slugIsTaken` — the one deliberately unfiltered one, and it returns a boolean |
   *
   * **Exempting a file is not trusting it.** GPT Sol, 2026-08-28: *"Extend the
   * guard to three exemptions, but do not trust three whole files."* The first
   * version of this did trust them, and `pg.ts` was one — fourteen hundred lines
   * exempted to protect six, so a *fourth* unfiltered lookup added anywhere in
   * it would have passed. That is why `slugIsTaken` now has its own file: the
   * exemption existed for that function alone, so moving the function removed
   * the exemption rather than merely narrowing it.
   *
   * What is left is a rule with no file-sized holes: each exempt file must
   * contain **exactly one** bare lookup, and it must be inside the function the
   * file is named for. A second one anywhere in any of them fails, whether it is
   * above the function, below it, or in a helper beside it.
   *
   * A grep rather than a type: there is no type that can distinguish "the right
   * `where`" from "a `where`", and the failure mode this guards is somebody
   * writing a perfectly well-typed query.
   */
  const BARE_LOOKUP = /eq\(\s*articles\.slug\s*,/g;

  /** Comments stripped, because several of these files quote the forbidden
      expression while explaining the rule — and a guard that fires on its own
      documentation teaches people to delete the documentation. */
  const codeOf = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  /** The three, and what each is allowed to contain. */
  const SANCTIONED = [
    { file: "owned-slug.ts", fn: "ownedSlug" },
    { file: "public-slug.ts", fn: "publicSlug" },
    { file: "slug-is-taken.ts", fn: "slugIsTaken" },
  ];
  const EXEMPT = SANCTIONED.map((one) => one.file);

  it("so no store module resolves a slug without one", async () => {
    const dir = fileURLToPath(new URL("../src/store/", import.meta.url));
    const offenders: string[] = [];
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".ts") || EXEMPT.includes(name)) continue;
      const source = await readFile(dir + name, "utf8");
      /* Comments are stripped first. Several of these files explain the rule in
         prose that quotes the forbidden expression, and a guard that fires on
         its own documentation teaches people to weaken the guard. */
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/eq\(\s*articles\.slug\s*,/.test(code)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  /** And the predicate itself really does mention the owner. */
  it("and the predicate they all call filters on owner_id", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../src/store/owned-slug.ts", import.meta.url)),
      "utf8",
    );
    const body = /export function ownedSlug[\s\S]*?\n}/.exec(source)?.[0] ?? "";
    expect(body).toContain("articles.slug");
    expect(body).toContain("articles.ownerId");
    /* The owner may now be supplied — the AI ledger knows whose row it is
       writing — but the *default* has to stay the ambient one, or a caller that
       forgets the argument gets an unfiltered query. */
    expect(body).toContain("currentOwnerId()");
    expect(body).toMatch(/ownerId \?\? currentOwnerId\(\)/);
    /* And `pg.ts` still hands the same function out, so nothing has two. */
    const pg = await readFile(
      fileURLToPath(new URL("../src/store/pg.ts", import.meta.url)),
      "utf8",
    );
    expect(pg).toContain('export { ownedSlug } from "./owned-slug.js"');
  });

  /**
   * **The second exemption, inspected for what makes it safe.**
   *
   * `publicSlug` is allowed to resolve a slug without an owner precisely
   * because it resolves it by `visibility = 'public'` instead. Strip that
   * clause and the file is still exempt from the grep above and is now a bare
   * unfiltered lookup — which is the one way this exemption becomes the hole it
   * was added to avoid.
   *
   * The `owner.ts` half is the other reason the file exists at all: a public
   * leaf that could reach `currentOwnerId` is one edit from being an owner
   * predicate again. tests/public-imports.test.ts says the same thing about the
   * whole graph; this says it about the source, which is where somebody would
   * be typing.
   */
  it("and the public predicate filters on visibility, with no owner in the file", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../src/store/public-slug.ts", import.meta.url)),
      "utf8",
    );
    const body = /export function publicSlug[\s\S]*?\n}/.exec(source)?.[0] ?? "";
    expect(body).toContain("articles.slug");
    expect(body).toMatch(/eq\(\s*articles\.visibility\s*,\s*"public"\s*\)/);
    /* Comments stripped, because the header explains at length *why* the owner
       is not here — and a guard that fires on its own documentation teaches
       people to delete the documentation. */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("owner.js");
    expect(code).not.toContain("currentOwnerId");
  });

  /**
   * **And each exempt file contains exactly one bare lookup, inside the function
   * it is named for.**
   *
   * This is the half GPT Sol's finding 4 was about. The sweep above skips three
   * files; without this, skipping them means trusting them, and "trusting" a
   * file is trusting every line anybody adds to it later.
   *
   * Two assertions per file and they catch different things: the **count**
   * catches a second lookup added anywhere in the file, and the **containment**
   * catches the one that is there being moved out of the function into a helper
   * that nothing else vouches for.
   */
  it("and each sanctioned file holds exactly one, inside the function it is named for", async () => {
    const dir = fileURLToPath(new URL("../src/store/", import.meta.url));
    for (const { file, fn } of SANCTIONED) {
      const code = codeOf(await readFile(dir + file, "utf8"));

      const occurrences = code.match(BARE_LOOKUP) ?? [];
      expect(occurrences.length, `${file} should hold exactly one bare slug lookup`).toBe(1);

      const body =
        new RegExp(`export (?:async )?function ${fn}[\\s\\S]*?\\n\\}`).exec(code)?.[0] ?? "";
      expect(body, `${file} has no ${fn} to hold it`).not.toBe("");
      expect(
        (body.match(BARE_LOOKUP) ?? []).length,
        `${file}'s lookup is outside ${fn}`,
      ).toBe(1);
    }
  });

  /**
   * **The one unfiltered lookup still returns nothing but a boolean.**
   *
   * `slugIsTaken` is allowed to resolve a slug without an owner for exactly one
   * reason: it selects an id and answers yes or no, so it can say *"is this slug
   * spoken for"* and nothing else. If it ever grew a second column, its
   * exemption would be covering a real leak.
   */
  it("and the one unfiltered lookup still returns nothing but a boolean", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../src/store/slug-is-taken.ts", import.meta.url)),
      "utf8",
    );
    const body = /export async function slugIsTaken[\s\S]*?\n}/.exec(source)?.[0] ?? "";
    expect(body).toMatch(/Promise<boolean>/);
    expect(body).toMatch(/\.select\(\{\s*id:\s*articles\.id\s*\}\)/);
    expect(body).toMatch(/return rows\.length > 0;/);
  });

  /**
   * And `pg.ts` is no longer exempt at all, which is the point of the move —
   * asserted rather than assumed, because "we removed the exemption" is exactly
   * the kind of claim that survives the exemption being quietly put back.
   */
  it("and pg.ts is swept like every other store module", () => {
    expect(EXEMPT).not.toContain("pg.ts");
  });

  /**
   * **The other direction: a query that groups by owner is looking at everybody.**
   *
   * `group by owner_id` is the shape of a question asked *across* owners rather
   * than within one, and there is exactly one place in this repo that is
   * allowed to ask it — `pg-admin.ts`, behind the `/api/admin` gate
   * (docs/project/admin.md). Anywhere else it would be a route quietly
   * aggregating over other people's rows.
   *
   * Narrow on purpose. This is not "find every query missing a `where`", which
   * no grep can do and which would overclaim; it is one syntactic shape with
   * one legitimate home. GPT Sol asked for exactly that distinction, 2026-08-27.
   */
  it("and only the admin store groups by owner, because only it may", async () => {
    const dir = fileURLToPath(new URL("../src/store/", import.meta.url));
    const offenders: string[] = [];
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".ts") || name === "pg-admin.ts") continue;
      const source = await readFile(dir + name, "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/groupBy\([^)]*\.ownerId/.test(code)) offenders.push(name);
    }
    expect(offenders).toEqual([]);

    /* And the exemption really does contain what it is exempted for — a rule
       whose one allowed case has silently moved is a rule that now protects
       nothing. */
    const admin = await readFile(dir + "pg-admin.ts", "utf8");
    expect(admin).toMatch(/groupBy\([^)]*\.ownerId/);
  });
});

/* ------------------------------------------------- 3. the queries, for real -- */

/**
 * **Alice is the seeded development owner; Bob owns nothing.**
 *
 * `owner_id` really does reference `auth.users(id)` (drizzle/0001), so a made-up
 * owner cannot be given an article — seeding a second one means driving GoTrue's
 * admin API, and this suite would then fail whenever auth was down rather than
 * whenever isolation broke.
 *
 * It does not need one. The property under test is "Bob sees nothing of
 * Alice's", and Bob having no rows anywhere is the strongest possible version of
 * his half: every assertion below is about Alice's article being invisible, and
 * none of them would pass by accident.
 */
const OUTSIDER = "00000000-0000-4000-8000-0000000000b1" as OwnerId;

/* Probes for `owner_id` and not merely for the schema: the migration that
   added it is what this suite is about, and a database one behind should be
   told to migrate rather than fail with a column error. */
const { reachable } = await pgReady({
  suite: "tests/owner-isolation.test.ts",
  columns: [{ table: "spideryarn.articles", column: "owner_id" }],
});

const when = reachable ? describe : describe.skip;

const SLUG = "test-owner-isolation";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000f7";
const REVISION_ID = "00000000-0000-4000-8000-0000000000f8";
const BLOCK_ID = "spya-wnaaqa";
/** Distinctive enough that a hit on it cannot be a coincidence. */
const RARE = "thaumaturgical";

when("one owner's article, asked for by another", { timeout: 20_000 }, () => {
  beforeAll(async () => {
    await clean();
    const db = getDb();
    await db.insert(articles).values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG });
    await db.insert(articleRevisions).values({
      id: REVISION_ID,
      articleId: ARTICLE_ID,
      status: "published",
      title: "A private article",
      fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
      /* The library's scalars, which every published revision has: both writers
         set them in the transaction that publishes. The shelf reads them since
         2026-08-28, and a fixture without them sends `listArticles` down its
         recompute-and-warn fallback — which would still pass this file's
         assertions while making a different suite's statement count wrong. */
      wordCount: 6,
      blockCount: 1,
      partCount: 0,
      sectionCount: 0,
      rootGist: "A private article nobody else may see.",
      // A tree and at least one block, or `listArticles` skips the row and the
      // positive control below would pass for the wrong reason.
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
            range: [BLOCK_ID, BLOCK_ID],
            title: "Root",
            gist: "Something private.",
          },
        },
      },
    });
    await db
      .update(articles)
      .set({ currentRevisionId: REVISION_ID })
      .where(eq(articles.id, ARTICLE_ID));
    await db.insert(blockIdentities).values([{ articleId: ARTICLE_ID, blockId: BLOCK_ID }]);
    await db.insert(revisionBlocks).values([
      {
        articleId: ARTICLE_ID,
        revisionId: REVISION_ID,
        blockId: BLOCK_ID,
        ordinal: 0,
        tag: "p",
        kind: "text",
        text: `A ${RARE} account of nothing at all.`,
        words: 7,
        html: `<p>A ${RARE} account of nothing at all.</p>`,
        gistable: true,
      },
    ]);
  });

  afterAll(async () => {
    await clean();
    await closeDb();
  });

  /**
   * **404, not 403.** "There is no such article" is all a stranger should learn
   * about a slug they do not own; a 403 confirms it exists. And it falls out of
   * the design rather than being a second decision — the row simply does not
   * match the `where`.
   */
  it("is not found", async () => {
    const { pgArticleReader } = await import("../src/store/pg.js");
    await expect(
      runInRequest(async () => {
        setRequestOwner(OUTSIDER);
        return pgArticleReader.loadArticle(SLUG);
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("is not in their library", async () => {
    const { pgArticleReader } = await import("../src/store/pg.js");
    const theirs = await runInRequest(async () => {
      setRequestOwner(OUTSIDER);
      return pgArticleReader.listArticles();
    });
    expect(theirs.map((a) => a.slug)).not.toContain(SLUG);
  });

  /**
   * **The positive control, and the suite is worthless without it.**
   *
   * Every other test here passes if `ownedSlug` matches nothing at all — a
   * predicate that is simply broken looks exactly like one that is working.
   * This is the one that fails in that case.
   */
  it("is still in the owner's own library", async () => {
    const { pgArticleReader } = await import("../src/store/pg.js");
    const mine = await runInRequest(async () => {
      setRequestOwner(theEnvironmentsOwner);
      return pgArticleReader.listArticles();
    });
    expect(mine.map((a) => a.slug)).toContain(SLUG);
  });

  it("cannot be renamed by them", async () => {
    const { pgShelfStore } = await import("../src/store/pg-shelf.js");
    await expect(
      runInRequest(async () => {
        setRequestOwner(OUTSIDER);
        return pgShelfStore.patch(SLUG, { title: "mine now" });
      }),
    ).rejects.toMatchObject({ status: 404 });

    const [row] = await getDb()
      .select({ title: articles.titleOverride })
      .from(articles)
      .where(eq(articles.id, ARTICLE_ID));
    expect(row?.title ?? null).toBeNull();
  });

  it("cannot be opened by them", async () => {
    const { pgShelfStore } = await import("../src/store/pg-shelf.js");
    await expect(
      runInRequest(async () => {
        setRequestOwner(OUTSIDER);
        return pgShelfStore.recordOpen(SLUG);
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("cannot have its shelf record read by them", async () => {
    const { pgShelfStore } = await import("../src/store/pg-shelf.js");
    await expect(
      runInRequest(async () => {
        setRequestOwner(OUTSIDER);
        return pgShelfStore.read(SLUG);
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  /**
   * Chat's `search_library` tool reaches this, so without the filter a model
   * answering your question could quote a stranger's article back at you.
   */
  it("is not in their library search", async () => {
    const { pgLibrarySearch } = await import("../src/store/pg-shelf.js");
    const hits = await runInRequest(async () => {
      setRequestOwner(OUTSIDER);
      return pgLibrarySearch.searchLibrary(RARE, 10);
    });
    expect(hits.hits.map((h) => h.slug)).not.toContain(SLUG);
  });

  /**
   * **The reader's own PDF, which the first version of this work walked past.**
   *
   * `GET /api/source/:slug` was authenticated and not authorised: it took a
   * slug, went straight to `data/<slug>/raw.pdf` and returned it, never asking
   * the store whose article it was. Every other route was covered because every
   * other route resolves a slug through `ownedSlug()`; this one did not resolve
   * a slug at all. GPT Sol, 2026-08-27.
   *
   * The fixture has no PDF, so the honest reading of this test is narrow: it
   * pins that the *ownership* check happens, and that it happens **before** the
   * file is looked for. Both readers would get a 404 either way — what this
   * asserts is that the outsider's 404 is refused rather than not-found, which
   * is exactly the distinction that was missing.
   */
  it("does not hand a stranger the reader's original file", async () => {
    const { pgShelfStore } = await import("../src/store/pg-shelf.js");
    /* The check `sendSource` now performs, at the seam it performs it. As the
       owner it resolves; as anybody else it is a 404 before a byte is read. */
    await expect(
      runInRequest(async () => {
        setRequestOwner(OUTSIDER);
        return pgShelfStore.read(SLUG);
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      runInRequest(async () => {
        setRequestOwner(theEnvironmentsOwner);
        return pgShelfStore.read(SLUG);
      }),
    ).resolves.toBeTruthy();
  });

  /**
   * And the route really does ask, rather than the check merely existing.
   *
   * **The second half of this moved on 2026-08-31 and the property did not.**
   * It used to read *before `fsLocations(slug)`*, because `sendSource` fetched
   * the bytes off the disk itself; it now reads *before
   * `sourceStore.readPdf(slug)`*, because that read went through the store
   * (docs/plans/finish-the-database-move.md, stage 1). The thing being pinned is
   * unchanged — **authorise, then move bytes** — and it is worth being explicit
   * that this is the same assertion at a new seam rather than a weakened one:
   * the store call is the *only* way this function can now obtain a byte, so
   * anything after it is after the check.
   *
   * `indexOf` on a name that is no longer in the file returns `-1`, and `x < -1`
   * is false for every real index, so the rename could not have slipped past
   * silently — this test went red on it. tests/source-store.test.ts restates
   * the ordering outside this suite's `describe`, which is `describe.skip` when
   * there is no database; a security ordering that only holds when Postgres is
   * up is not a property anybody wants to depend on.
   */
  it("and the route asks before it goes for the bytes", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const source = await readFile(
      fileURLToPath(new URL("../src/routes.ts", import.meta.url)),
      "utf8",
    );
    /* Comments stripped, like the store sweep above: `sendSource`'s own comment
       explains what it used to do, and quotes both names while doing it. */
    const body =
      /async function sendSource\([\s\S]*?\n}/.exec(
        source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
      )?.[0] ?? "";
    expect(body).toContain("shelfStore.read(slug)");
    expect(body.indexOf("shelfStore.read(slug)")).toBeLessThan(
      body.indexOf("sourceStore.readPdf(slug)"),
    );
  });

  /** The reader profile is keyed on owner directly, rather than through a slug. */
  it("does not share a reader profile", async () => {
    const { pgReaderStore } = await import("../src/store/pg-reader.js");
    await runInRequest(async () => {
      setRequestOwner(theEnvironmentsOwner);
      await pgReaderStore.writeProfile("reads for the argument rather than the news");
    });
    const theirs = await runInRequest(async () => {
      setRequestOwner(OUTSIDER);
      return pgReaderStore.readProfile();
    });
    expect(theirs).toBeNull();
  });
});

/** Read once, out here, where `currentOwnerId()` still answers from the environment. */
const theEnvironmentsOwner = currentOwnerId();

/* ------------------------------- 4. the gate, through to the store, over HTTP -- */

/**
 * **The seam Sol said was untested, tested at the seam.**
 *
 * Everything above proves the scope works and the queries filter. Neither
 * proves the *gate* is what fills the scope — and that one line
 * (`setRequestOwner(user.id)` in src/routes.ts) is the whole join between them.
 * Delete it and every test above this point still passes.
 *
 * So: two HTTP requests to the same route, differing only in whose token the
 * verifier vouches for, and they must not see each other's profile.
 */
when("the same route asked by two different people", { timeout: 20_000 }, () => {
  /**
   * The one who writes has to be the seeded development owner: `owner_id`
   * references `auth.users(id)` (drizzle/0001), and only that one exists. The
   * other never writes anything, so it never needs to.
   */
  const SEEDED = theEnvironmentsOwner as string;
  const STRANGER = "00000000-0000-4000-8000-0000000000c2";

  /** A verifier that vouches for exactly one person. src/auth.ts § `Verifier`. */
  const asPerson = (sub: string): Verifier => async () => ({
    ok: true,
    claims: { sub, email: `${sub}@example.test`, role: "authenticated", is_anonymous: false },
  });

  async function reader(sub: string, method: string, body?: unknown) {
    const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
    const req = Object.assign(
      (async function* () {
        yield* payload;
      })(),
      { method, url: "/api/reader", headers: { authorization: "Bearer whatever" } },
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
    const { handleApi } = await import("../src/routes.js");
    await handleApi(req, res, asPerson(sub));
    return { status, body: text ? (JSON.parse(text) as { profile: string | null }) : { profile: null } };
  }

  afterAll(async () => {
    const db = getDb();
    await db.delete(readerProfiles).where(eq(readerProfiles.ownerId, SEEDED as OwnerId));
  });

  it("gives each of them their own profile", async () => {
    const written = await reader(SEEDED, "PATCH", { profile: "the first person" });
    expect(written.status).toBe(200);

    /* 200 with nothing in it, not 403 — a stranger is a reader with no profile,
       which is a perfectly ordinary state and not an error. */
    const theirs = await reader(STRANGER, "GET");
    expect(theirs.status).toBe(200);
    expect(theirs.body.profile).toBeNull();

    const mine = await reader(SEEDED, "GET");
    expect(mine.body.profile).toBe("the first person");
  });

  /**
   * And the identity really came off the token rather than out of the
   * environment — `SPIDERYARN_OWNER_ID` set to one of them changes nothing.
   */
  it("and does not consult SPIDERYARN_OWNER_ID to decide", async () => {
    const before = process.env.SPIDERYARN_OWNER_ID;
    process.env.SPIDERYARN_OWNER_ID = SEEDED;
    try {
      const theirs = await reader(STRANGER, "GET");
      expect(theirs.body.profile).toBeNull();
    } finally {
      if (before === undefined) delete process.env.SPIDERYARN_OWNER_ID;
      else process.env.SPIDERYARN_OWNER_ID = before;
    }
  });
});


async function clean() {
  const db = getDb();
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, ARTICLE_ID));
  await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, ARTICLE_ID));
  await db.delete(blockIdentities).where(eq(blockIdentities.articleId, ARTICLE_ID));
  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, ARTICLE_ID));
  await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
  await db.delete(readerProfiles).where(eq(readerProfiles.ownerId, OUTSIDER));
}
