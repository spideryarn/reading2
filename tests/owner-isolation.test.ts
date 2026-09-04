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
 * ## Kinds of test, and only some of them need a database
 *
 * 1. **The scope** (`currentOwnerId` under AsyncLocalStorage) — pure, always
 *    runs. This is the half that decides *whose* id the queries are handed.
 * 2. **The static guard** — no file under `src/store/` may write
 *    `eq(articles.slug, …)` outside the three one-function leaves. This is the
 *    half that stops the thirteenth lookup being written without an owner,
 *    months from now, by somebody who never read any of this.
 * 2b. **The static guard for *lists***, added 2026-09-04 and pure as well.
 *    Section 2 greps for a slug, and the query that enumerates every public
 *    article has no slug in it — so it sails past while answering a question
 *    nobody had to know a slug to ask. That section inventories every
 *    `.from(articles)` in the public import graph, reads the listing's
 *    generated SQL and pins its columns.
 * 3. **The queries themselves**, against real Postgres, which skips when there
 *    is no database. Two owners, one slug each, and each one asked for the
 *    other's.
 * 4. **The gate, over HTTP**, which is the one line joining (1) to (3).
 * 5. **The listing, against real rows** — two owners, five rows, and the
 *    sharing switch thrown while the test watches. The behavioural half of 2b.
 *
 * ## What "red first" meant here
 *
 * Before the fix, (3) failed on every case and (1) could not be written at all.
 * The one worth recording is (2): run it against the code as it stood on
 * 2026-08-26 and it names seven files. That is the check having been seen to
 * fail — docs/reusable/silent-success.md, and the habit in this repo of never
 * trusting a check that has only ever been green.
 *
 * (2b) and (5) were made to fail ten ways on the day they were written, and
 * each case says at its own docstring what it caught. The list is in
 * docs/plans/260904b-pricing-page-and-public-showcase.md § Log.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { eq, inArray, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Verifier } from "../src/auth.js";
import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articleVisibilityChanges,
  articles,
  blockIdentities,
  readerProfiles,
  revisionBlocks,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import {
  currentOwnerId,
  inRequest,
  type OwnerId,
  runInRequest,
  setRequestOwner,
} from "../src/owner.js";
import { PUBLIC_CARD_CHARS, publicLibraryQuery } from "../src/store/public-library.js";
import {
  articleTableUses,
  modulesUsedIn,
  parse as parseSource,
  preAuthRegion,
} from "./helpers/article-queries.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";
import { publicEntryImporters, publicFiles, ROOT } from "./helpers/import-graph.js";
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
   * **The two files allowed to ask a question across owners**, and why each one
   * is.
   *
   * - `pg-admin.ts` is the admin page's counts, behind the `/api/admin` gate —
   *   docs/project/admin.md is the whole argument.
   * - `ai-calls-spend-pg.ts` is the per-owner spend aggregate, added 2026-09-02.
   *   It has the same shape and the same justification: `/admin/users` reads it
   *   through that same gate, and `npm run cost -- --owners` reads it from a CLI
   *   Greg runs on his own machine. It returns **money and an owner id and
   *   nothing else** — no title, no URL, no slug, no sentence of anybody's
   *   reading — which is the rule admin.md states for the page and the reason
   *   this second entry is a widening rather than a hole.
   *
   * Adding a third is a decision about who may see across owners, which is why
   * it is a list here rather than a per-file opt-out somewhere quieter.
   */
  const ACROSS_OWNERS = ["pg-admin.ts", "ai-calls-spend-pg.ts"];

  /**
   * **The other direction: a query that groups by owner is looking at everybody.**
   *
   * `group by owner_id` is the shape of a question asked *across* owners rather
   * than within one, and there are exactly two places in this repo allowed to
   * ask it. Anywhere else it would be a route quietly aggregating over other
   * people's rows.
   *
   * Narrow on purpose. This is not "find every query missing a `where`", which
   * no grep can do and which would overclaim; it is one syntactic shape with a
   * named home. GPT Sol asked for exactly that distinction, 2026-08-27.
   */
  it("and only the two cross-owner readers group by owner, because only they may", async () => {
    const dir = fileURLToPath(new URL("../src/store/", import.meta.url));
    const offenders: string[] = [];
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".ts") || ACROSS_OWNERS.includes(name)) continue;
      const source = await readFile(dir + name, "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/groupBy\([^)]*\.ownerId/.test(code)) offenders.push(name);
    }
    expect(offenders).toEqual([]);

    /* And each exemption really does contain what it is exempted for — a rule
       whose allowed case has silently moved is a rule that now protects
       nothing. */
    for (const name of ACROSS_OWNERS) {
      expect(await readFile(dir + name, "utf8")).toMatch(/groupBy\([^)]*\.ownerId/);
    }
  });
});

/* -------------------------------------- 2b. the static guard, for LISTS -- */

/**
 * **The guard above cannot see this one, and this one is the more dangerous.**
 *
 * Section 2 greps for `eq(articles.slug, …)`. A listing query has no slug in it
 * at all, so it sails straight past — while answering a question nobody had to
 * know a slug to ask. `publicSlug` hands one article to somebody who already
 * named it, and every slug minted since 2026-08-31 ends in an unguessable short
 * id; `publicLibraryQuery` hands back *what is there* to somebody who named
 * nothing. Get its `where` wrong and you do not leak an article to the person
 * looking for it, you publish the shelf.
 *
 * GPT Sol raised exactly this reviewing
 * docs/plans/260904b-pricing-page-and-public-showcase.md § 5, and it was right:
 * every guard in this file and in tests/public-imports.test.ts was built around
 * *lookups*. So this section is about **enumeration**, and it asks six questions
 * the others cannot:
 *
 * 1. Which queries in the public import graph name the `articles` table at all?
 *    Exactly two are permitted, each inside the function it is named for.
 * 2. **Which modules open those doors**, and is an anonymous request's own code
 *    — the transport's, above and around the hand-off — free of any query of
 *    its own?
 * 3. Does the listing's **generated SQL** carry `visibility = 'public'` in its
 *    `where`? Read off the statement, not off a constant beside it.
 * 4. Are the selected columns exactly the eight a card needs?
 * 5. Is every text column bounded, so 200 rows is a bound on bytes too?
 * 6. Is the answer bounded and totally ordered?
 *
 * The behavioural half — two owners, five kinds of row, an oversized one, and
 * the switch being thrown — is section 5 below, against real Postgres.
 *
 * ## What (2) is, and why it is not a second list of roots
 *
 * Added 2026-09-04 on GPT Sol's review of the built code
 * (docs/plans/260904b-stage3a-code-review-sol.md, finding 2), which caught the
 * hole one level above everything else here: the import graph roots at
 * `src/public/routes.ts` and `src/public/page.ts`, but **a real request runs the
 * transport first**. A query added to `src/routes.ts`'s pre-auth dispatch, or to
 * `src/vercel.ts`'s wrapper, would be reachable by a stranger and invisible to a
 * graph that starts on the other side of it.
 *
 * Sol offered two remedies: move the pre-auth branch into a module and root the
 * graph there, or assert over the transports directly. **The extraction was
 * tried on paper and is worse**, and the reason is worth writing down because it
 * is not obvious: the two transports' anonymous regions are not the same code
 * and are not shareable. `src/vercel.ts`'s holds URL restoration, `/api/health`,
 * the compiled shell and the `runInRequest` that src/vercel.ts § the read page
 * deliberately keeps *outside* the closed room — moving that into a module
 * either drags transport concerns into `src/public/`, which that directory's
 * header forbids, or pulls `src/owner.ts` into the public import graph, which
 * tests/public-imports.test.ts exists to keep out. And it would leave a residue
 * in the transport regardless, so the assertion below would still be needed —
 * one more module, and not one fewer moving part.
 *
 * What makes this not "a second list of roots that will be wrong again" is that
 * **the list is derived**: `publicEntryImporters()` asks the repo which modules
 * import a public entry point, and the guard asserts the answer. A third
 * transport fails it rather than escaping it.
 *
 * ## What was made to fail before any of this was believed
 *
 * Each case was watched going red against a deliberately bad query — (1), (3),
 * (4) and (6) on 2026-09-04 when they were written, and (1), (2) and (5) again
 * the same day when Sol's review widened them. What each one caught is recorded
 * at the case. A check nobody has seen fail is not evidence
 * (docs/reusable/silent-success.md).
 */
describe("the one query that lists articles for nobody in particular", () => {
  /**
   * **Naming the `articles` table at all, which is the shape of a question
   * about everybody's articles.**
   *
   * Not `eq(articles.slug, …)`, which section 2 owns — the two guards catch
   * different things and neither subsumes the other. A query on `articles` with
   * a slug in its `where` is a lookup and is covered there; one *without* a slug
   * is either owner-filtered or it is an enumeration, and inside the public
   * import graph there is no owner to filter on.
   *
   * **This was the regex `/\.from\(\s*articles\s*\)/` until 2026-09-04**, and
   * Sol's review said what that could not see: a table alias, a relational
   * query, or raw SQL. So it parses instead —
   * [helpers/article-queries.ts](helpers/article-queries.ts) has the four shapes
   * and the reason, which is the same conclusion `tests/fixture-ids.test.ts`
   * reached the same week after a Sol review found a live collision its narrower
   * pattern was blind to. *Parse them all.*
   */
  const usesOf = async (file: string) =>
    articleTableUses(parseSource(file, await readFile(path.join(ROOT, file), "utf8")));

  /** Comments stripped, for section 2's reason: a guard that fires on its own
      documentation teaches people to delete the documentation. (The parser
      above needs none of this — a comment is not a node.) */
  const codeOf = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  /**
   * **The two queries in the whole public surface that may name `articles`**,
   * and what makes each one safe.
   *
   * - `public-reader.ts` → `publicCurrentRevisionQuery`, whose `where` is
   *   `publicSlug(slug)` — slug **and** visibility, section 2's second
   *   exemption.
   * - `public-library.ts` → `publicLibraryQuery`, the listing, whose `where` is
   *   visibility **and** the readability bar, and whose SQL is read below.
   *
   * A third entry here is a decision about what a stranger may enumerate, which
   * is why it is a list in a test rather than a comment in whichever file grew
   * the query.
   */
  const LISTING = { file: "src/store/public-library.ts", fn: "publicLibraryQuery" };
  /**
   * **Named sites, not a count** — and the difference was found by the guard
   * itself, on a merge, the day it was written.
   *
   * The first version asserted each permitted file named the table *exactly
   * once*. That went red when `src/store/public-reader.ts` grew a second,
   * entirely legitimate reference: `publicCommentsQuery` joins back to
   * `articles` precisely so that `publicSlug` is re-applied to a comments read
   * (see the comment above it — "named columns, a join back to `articles`, and
   * `publicSlug` repeated"). A count cannot tell that apart from a smuggled
   * enumeration, so it called a correct query an offence.
   *
   * The count was standing in for the thing actually worth asserting, which is
   * that **every site is one somebody named on purpose**. So each permitted file
   * lists its functions, and a query appearing in a function not on this list
   * fails — which still catches a second query added anywhere in the file, and
   * still catches the existing one being moved into a helper nothing vouches
   * for, without forbidding a file from holding two queries that are both fine.
   *
   * Adding a function here is the deliberate edit. That is the point: it is one
   * line, and it cannot be done by accident, which is what the count was for.
   */
  const PERMITTED = [
    {
      file: "src/store/public-reader.ts",
      fns: [
        "publicCurrentRevisionQuery",
        "publicCommentsQuery",
        /* Added 2026-09-04, and for the identical reason as the line above it:
           the join back to `articles` exists so that `publicSlug` is re-applied
           to a `search_runs` read rather than an article id being trusted from
           an earlier statement.
           docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 4. */
        "publicSearchesQuery",
      ],
    },
    { file: LISTING.file, fns: [LISTING.fn] },
  ];

  /**
   * **The two wrappers a stranger's request runs before it reaches either door**
   * — and, for each, the call at which it stops being a stranger's request.
   *
   * `serveApi` hands off at `serveAuthenticatedApi`, whose one parameter is a
   * `VerifiedUser`, a type only the gate can produce (src/auth.ts). `serve`
   * hands off at `handleApi`, whose own anonymous half is the first of these.
   * Everything else in those two functions — the dispatches at the top, the
   * `catch` and the `finally` at the bottom — runs for somebody with no session.
   *
   * `mayUse` is what that code is allowed to reach for, and the list is short on
   * purpose. It is not a convenience: it is the only thing standing between this
   * guard and a pre-auth `pgAdminReader.counts()`, which would name no table and
   * so slip past every other case here.
   *
   * The `file` list itself is checked against `publicEntryImporters()` below
   * rather than trusted, because a hand-written roster of transports is exactly
   * the thing that goes stale.
   */
  const TRANSPORTS = [
    {
      file: "src/routes.ts",
      fn: "serveApi",
      handsOffTo: "serveAuthenticatedApi",
      mayUse: [
        "./auth.js",
        "./billing/webhook.js",
        "./chat.js",
        "./comments.js",
        "./monitoring.js",
        "./public/routes.js",
      ],
    },
    {
      file: "src/vercel.ts",
      fn: "serve",
      handsOffTo: "handleApi",
      mayUse: [
        "./log.js",
        "./messages.js",
        "./monitoring.js",
        "./owner.js",
        "./public/page.js",
        "./vercel-health.js",
      ],
    },
  ] as const;

  /**
   * **Every query on the `articles` table the closed room can reach,
   * enumerated.**
   *
   * The same walk tests/public-imports.test.ts makes — both doors, transitively,
   * runtime imports only — so this covers a query added to a file nobody thinks
   * of as public but which the namespace happens to import. That is the case a
   * grep over `src/store/` would miss in the other direction: it would miss
   * `src/public/`, and it would flag every legitimate owner query in the repo.
   *
   * What it does **not** cover is the corridor: the transport runs before either
   * door, and the two cases after this one are that half.
   *
   * **Red first:** adding a second `.from(articles)` to `src/public/routes.ts`
   * on 2026-09-04 named that file here and failed. So did moving
   * `publicLibraryQuery`'s body into a helper beside it — the containment half.
   * After the detector was widened the same day, an **aliased** query —
   * `const shelf = alias(articles, "shelf")`, then `.from(shelf)` — failed it
   * too, naming both the alias and the table it aliases; the regex this replaced
   * was green on exactly that.
   */
  it("names the articles table in exactly two places, each inside its own function", async () => {
    const offenders: string[] = [];
    const permittedFiles = PERMITTED.map((one) => one.file);

    for (const file of publicFiles()) {
      const uses = await usesOf(file);
      if (uses.length === 0) continue;
      if (!permittedFiles.includes(file)) {
        offenders.push(
          `${file} names the articles table and is not one of the two permitted: ` +
            uses.map((u) => `line ${u.line} (${u.how}) ${u.text}`).join("; "),
        );
      }
    }
    expect(offenders).toEqual([]);

    /* And each permitted file holds **exactly one**, inside the function it is
       named for — section 2's rule, applied to the same files from the other
       side. The count catches a second query added anywhere in the file; the
       containment catches the one that is there being moved into a helper
       nothing vouches for. The enclosing function comes off the parse tree
       rather than a `function <name>[\s\S]*?\n}` slice, so a nested closure or a
       brace in a string cannot mislead it. */
    for (const { file, fns } of PERMITTED) {
      const uses = await usesOf(file);
      expect(uses.length, `${file} names the articles table nowhere`).toBeGreaterThan(0);
      const stray = uses
        /* `fn` is `string | null` — null is a use at the top level of the
           module, outside any function at all. That is a stray by definition:
           the rule is that every query sits in a function somebody named on
           purpose, and a top-level one names none. Written as an explicit
           `null` arm rather than left to `includes(null)` being false, which
           was the same answer reached by accident and typed wrong. */
        .filter((u) => u.fn === null || !fns.includes(u.fn))
        .map((u) => `line ${u.line} in ${u.fn ?? "no function"} (${u.how}) ${u.text}`);
      expect(
        stray,
        `${file} names the articles table outside ${fns.join(" and ")} — ` +
          "add the function to PERMITTED if the query is meant to be there, " +
          "and say why beside it",
      ).toEqual([]);
    }
  });

  /* -------------------------------- the code an anonymous request runs first -- */

  /**
   * **The two transports, and the guard finds them rather than remembering
   * them.**
   *
   * Everything above walks *out* from the public modules. This asks the opposite
   * question — who walks *in* — because that is where the hole was: a request
   * runs `src/routes.ts` or `src/vercel.ts` before either public door, and a
   * query written there is a stranger's to reach.
   *
   * Derived from the repo, so a third caller of `servePublicApi` or
   * `servePublicReadPage` fails here and gets read, rather than joining the
   * surface unnoticed. That is the whole answer to *"a guard that needs a second
   * list of roots is a guard that will be wrong again."*
   *
   * **Red first:** adding an import of `./public/routes.js` to a third module on
   * 2026-09-04 named that module here and failed.
   */
  it("and only two modules in the repo open a public door", () => {
    expect(publicEntryImporters()).toEqual(TRANSPORTS.map((t) => t.file));
  });

  /**
   * **Nothing an anonymous request executes queries the articles table itself.**
   *
   * The public modules are a closed room, and the room is watched. The corridor
   * to it was not: `serveApi` runs its public dispatch, its webhook branch, its
   * `catch` and its `finally` for somebody with no session, and so does
   * `serve` in src/vercel.ts. A `select` written in any of those is precisely
   * the ownerless enumeration this whole section exists for, one level up.
   *
   * The region is the dispatcher **minus the hand-off to the authenticated
   * half**, not the prefix above the gate — the error paths at the bottom run
   * for a stranger too, and a lookup in a `catch` is an ordinary thing to write.
   * helpers/article-queries.ts § `preAuthRegion`.
   *
   * **Red first:** an ownerless `db.select({ slug: articles.slug }).from(articles)`
   * planted in `serveApi`'s public-namespace branch on 2026-09-04 failed this,
   * naming the line. The same query planted in `serve`'s `catch` failed it too,
   * which is what the hole rather than a prefix buys.
   */
  it("and neither transport's anonymous half touches the articles table", async () => {
    for (const { file, fn, handsOffTo } of TRANSPORTS) {
      const parsed = parseSource(file, await readFile(path.join(ROOT, file), "utf8"));
      const region = preAuthRegion(parsed, fn, handsOffTo);
      const uses = articleTableUses(parsed, region);
      expect(
        uses.map((u) => `${file}:${u.line} (${u.how}) ${u.text}`),
        `${file} § ${fn} runs before anybody is known`,
      ).toEqual([]);
    }
  });

  /**
   * **And it reaches for nothing but these modules.**
   *
   * The other half, and the one that catches the query written somewhere else.
   * A table reference is easy to see; `pgAdminReader.counts()` in the pre-auth
   * dispatch names no table at all — it would hand a stranger a count across
   * every owner, and the case above would be green. What it cannot do without is
   * an **import**, used inside the region, which is a thing a parser can see.
   *
   * So the set is pinned. It is short, it is readable, and each entry is a
   * decision: `./billing/webhook.js` is Stripe's signed callback, which has no
   * session and never will; `./owner.js` is the `runInRequest` that gives the
   * public page an *empty* owner box rather than the environment's; the rest are
   * logging, monitoring and the two error types the `catch` names.
   *
   * **Nothing under `src/store/` is in either list**, which is the sentence this
   * case exists to be able to say.
   *
   * **Red first:** adding `import { pgAdminReader } from "./store/pg-admin.js"`
   * and a call to it inside the public-namespace branch on 2026-09-04 failed
   * this with `./store/pg-admin.js` in the diff.
   */
  it("and reaches for nothing an anonymous request has no business in", async () => {
    for (const { file, fn, handsOffTo, mayUse } of TRANSPORTS) {
      const parsed = parseSource(file, await readFile(path.join(ROOT, file), "utf8"));
      const region = preAuthRegion(parsed, fn, handsOffTo);
      expect(modulesUsedIn(parsed, region), `${file} § ${fn}`).toEqual(mayUse);
    }
  });

  /**
   * **And the listing file names no owner at all**, which is `public-slug.ts`'s
   * own rule applied to the second ownerless module. A file that could reach
   * `currentOwnerId` is a file one edit from an owner predicate — and on a
   * *listing* an owner predicate would not leak, it would silently empty the
   * shelf, which is the failure nobody reports.
   */
  it("and the listing module cannot reach an owner", async () => {
    const code = codeOf(await readFile(path.join(ROOT, LISTING.file), "utf8"));
    expect(code).not.toContain("owner.js");
    expect(code).not.toContain("currentOwnerId");
    expect(code).not.toContain("ownerId");
  });

  /* ------------------------------------------- the statement it generates -- */

  /**
   * The SQL this server will send, built with no connection at all.
   *
   * `QueryBuilder`, the same instrument tests/public-reads.test.ts uses on the
   * article read, and for the reason `publicCurrentRevisionQuery`'s docstring
   * gives: a projection can be perfectly correct while the query using it says
   * `.select()`, and the one place the `where` is visible is the statement.
   */
  const listing = publicLibraryQuery(new QueryBuilder() as never, 7).toSQL();

  /**
   * **The `where`, cut out of the statement**, so a case about the predicate is
   * about the predicate.
   *
   * From the `where` that follows the top-level `from … inner join` to the last
   * `order by` in the statement. Both anchors need saying: the `<h1>` subselect
   * in the projection has a `where` **and** an `order by` of its own, and they
   * come first, so `indexOf` from the join and `lastIndexOf` are what pick the
   * outer ones. The `exists (…)` subquery's `where` is inside this slice, which
   * is right — it is part of the predicate.
   */
  const JOIN = ' from "spideryarn"."articles" inner join';
  const whereClause = (() => {
    const join = listing.sql.indexOf(JOIN);
    const where = listing.sql.indexOf(" where ", join);
    const order = listing.sql.lastIndexOf(" order by ");
    /* Each cut found something. A `-1` here would silently slice the whole
       statement or none of it, and either way every assertion below would be
       about the wrong text — docs/reusable/silent-success.md. */
    expect(join).toBeGreaterThan(0);
    expect(where).toBeGreaterThan(join);
    expect(order).toBeGreaterThan(where);
    return listing.sql.slice(where, order);
  })();

  /**
   * **The clause the whole route rests on, in the `where` and nowhere else.**
   *
   * The value as well as the column, because Drizzle binds `'public'` rather
   * than inlining it — a test asserting the string `visibility = 'public'` would
   * be asserting a spelling Drizzle does not use, and would be green with the
   * clause deleted.
   *
   * **And the parameter is followed to its slot**, which is what changed on
   * 2026-09-04. The first version asked whether `visibility` appeared *somewhere*
   * in the statement and whether `"public"` was *somewhere* in the parameters —
   * two questions that a projection selecting `visibility` and an unrelated
   * `'public'` string could answer together while the `where` said something
   * else entirely. GPT Sol's finding 2. Now: the comparison is inside the
   * `where`, and the `$n` it binds is read out and looked up.
   *
   * **Red first:** deleting `eq(articles.visibility, "public")` from the `where`
   * on 2026-09-04 failed this; so did moving `visibility` into the projection
   * and leaving the `where` without it, which the first version passed.
   */
  it("filters on visibility, in SQL, in the where, on the parameter it binds", () => {
    const bound = /"spideryarn"\."articles"\."visibility" = \$(\d+)/.exec(whereClause);
    expect(bound, "no visibility comparison in the where clause").not.toBeNull();
    const slot = Number(bound?.[1]);
    expect(listing.params[slot - 1]).toBe("public");
  });

  /**
   * **And no owner anywhere in it.** On a lookup an owner clause would merely
   * narrow the answer; here it would be a shelf that shows the owner their own
   * articles and everybody else nothing — and it would look like it worked for
   * as long as the owner was the one testing it, which is the whole shape of the
   * bug this file was written for.
   *
   * **Red first:** adding `eq(articles.ownerId, …)` to the `where` failed this.
   */
  it("does not mention owner_id at all", () => {
    expect(listing.sql).not.toContain("owner_id");
  });

  /**
   * **The readability bar, in the `where` rather than in a filter afterwards.**
   *
   * `loadArticle` and `loadHead` both refuse a revision with no tree or no
   * blocks, so without the same two questions here a damaged or half-published
   * revision becomes a card whose destination 404s the instant anybody presses
   * it. In the `where` and not after the read, so `limit` counts rows a reader
   * could actually open.
   */
  it("and asks the same two questions of a revision that the article read does", () => {
    expect(whereClause).toMatch(/"article_revisions"\."tree" is not null/);
    expect(whereClause).toMatch(/exists \(\s*select 1 from "spideryarn"\."revision_blocks"/);
  });

  /**
   * **An archived article is off this shelf too.**
   *
   * Visibility decides whether the *link* works; archiving decides whether the
   * article is *listed*. Without this clause an owner who archives something
   * they had shared loses sight of it on their own shelf while strangers go on
   * finding it here — and the payload carries no `archived_at`, so nothing on
   * either end would ever show that it had. GPT Sol, 2026-09-04.
   *
   * In the `where` for the same reason the readability bar is: `limit` should
   * count rows a visitor is actually going to be shown.
   *
   * **Red first:** deleting `isNull(articles.archivedAt)` from the `where` on
   * 2026-09-04 failed this.
   */
  it("and leaves out an article its owner has archived", () => {
    expect(whereClause).toMatch(/"spideryarn"\."articles"\."archived_at" is null/);
  });

  /**
   * **Exactly eight columns, spelled out.**
   *
   * The danger `publicCurrentRevisionQuery` names is a public query that one day
   * does `select({ article: articles })` and picks up `owner_id`,
   * `title_override` and `purpose` in one careless line. On a listing that line
   * would hand every one of those over for every shared article at once.
   *
   * Read off the statement's select clause rather than off the projection
   * object, so it is the query that is pinned rather than a constant the query
   * might not use.
   *
   * **The split counts parentheses**, which it did not have to until the length
   * caps landed on 2026-09-04: `left(col, 300)` contains a comma, and a naive
   * `split(",")` turned seven items into eleven. The old version said out loud
   * that it would need this the first time an expression held a comma — so this
   * is that day, rather than a surprise.
   *
   * **Red first:** adding `ownerId: articles.ownerId` to the projection failed
   * this with the extra column named in the diff.
   */
  const selectItems = (): string[] => {
    const join = listing.sql.indexOf(JOIN);
    expect(join).toBeGreaterThan(0);
    const clause = listing.sql.slice("select ".length, join);
    const items: string[] = [];
    let depth = 0;
    let at = 0;
    for (let i = 0; i < clause.length; i += 1) {
      const ch = clause[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      else if (ch === "," && depth === 0) {
        items.push(clause.slice(at, i).trim());
        at = i + 1;
      }
    }
    items.push(clause.slice(at).trim());
    return items;
  };

  it("selects exactly the eight columns a card needs, and nothing else", () => {
    expect(selectItems()).toEqual([
      '"spideryarn"."articles"."slug"',
      '"spideryarn"."articles"."public_at"',
      `left("spideryarn"."article_revisions"."title", ${PUBLIC_CARD_CHARS.title}) as "title"`,
      /* The `<h1>` fallback, which is a `case` expression rather than a column —
         matched loosely because its body is multi-line SQL, tightly on the alias
         because that is the name the row comes back under. */
      expect.stringMatching(/^case[\s\S]*end as "heading_title"$/),
      /* **The eighth, added 2026-09-04**, and it is a fact about the document
         rather than about its owner: `article_revisions.byline` is what stage 2
         read off the publisher's page. There is still no column here naming the
         reader who shared it, and the reason that matters is in
         src/public-library-types.ts § `byline`. */
      `left("spideryarn"."article_revisions"."byline", ${PUBLIC_CARD_CHARS.byline}) as "byline"`,
      `left("spideryarn"."article_revisions"."root_gist", ${PUBLIC_CARD_CHARS.gist}) as "root_gist"`,
      `left("spideryarn"."article_revisions"."site_name", ${PUBLIC_CARD_CHARS.siteName}) as "site_name"`,
      '"spideryarn"."article_revisions"."word_count"',
    ]);
  });

  /**
   * **And every one of them that could be long is bounded, in the statement.**
   *
   * The row cap says nothing about bytes: nothing constrains a document's title
   * or an `<h1>`'s text, and a fetched document may be 32 MB, so one enormous
   * public heading makes an anonymous request allocate and serialise it. GPT
   * Sol's finding 1 on stage 3a.
   *
   * Asserted as *"every item that is not one of the three known-bounded ones
   * carries a `left(`"*, rather than as a list of three `left`s — a list would
   * be satisfied by a fourth text column arriving uncapped beside them, which is
   * the failure this is for. `slug` is bounded at 60 by `isSlug`, `public_at` is
   * a timestamp and `word_count` an integer; nothing else may be unbounded.
   *
   * The `<h1>` case is capped *inside* its subselect, so it is matched loosely.
   *
   * **Red first:** dropping the `left()` from `root_gist` on 2026-09-04 failed
   * this, naming the item. So did adding an uncapped eighth text column.
   */
  it("and caps every text column it hands out", () => {
    const BOUNDED_ALREADY = [
      '"spideryarn"."articles"."slug"',
      '"spideryarn"."articles"."public_at"',
      '"spideryarn"."article_revisions"."word_count"',
    ];
    const uncapped = selectItems().filter(
      (item) => !BOUNDED_ALREADY.includes(item) && !item.includes("left("),
    );
    expect(uncapped, "a text column leaves this query with no length bound").toEqual([]);
  });

  /**
   * **Bounded, and totally ordered.**
   *
   * The bound is what stops an anonymous request being a `select … from
   * articles` with no ceiling; the total order is what stops the shelf
   * reshuffling between two reloads, since `public_at` can tie and a tie left to
   * the planner comes back one way locally and another in production.
   */
  /**
   * **And the detector itself, against the four shapes it is for.**
   *
   * Every case above is a *negative*: nothing was found, therefore nothing is
   * there. A negative from a detector that silently stopped detecting looks
   * exactly the same, and that is not a theory — the regex this replaced was
   * green for a day while an alias, a relational query and raw SQL all walked
   * past it (GPT Sol's finding 2). So the positives are pinned here, on
   * synthetic sources, and the column reference is pinned as a **non**-match,
   * because a detector that fires on `articles.slug` would make the
   * "exactly one per file" rule above meaningless and somebody would then
   * loosen the rule rather than the detector.
   */
  it("and the detector sees each of the four ways to name the table", () => {
    const found = (body: string) =>
      articleTableUses(parseSource("probe.ts", `import { articles } from "./schema.js";\n${body}`));

    expect(found("const q = db.select({}).from(articles);").map((u) => u.how)).toEqual([
      "table reference",
    ]);
    expect(
      found('const shelf = alias(articles, "shelf");\nconst q = db.select({}).from(shelf);').map(
        (u) => u.how,
      ),
    ).toEqual(["table reference", "alias"]);
    expect(found("const q = db.query.articles.findMany();").map((u) => u.how)).toEqual([
      "relational query",
    ]);
    expect(found("const q = db.execute(sql`select 1 from spideryarn.articles`);")).toHaveLength(1);
    /* A renamed import, which is the evasion nobody has to mean. */
    expect(
      articleTableUses(
        parseSource("probe.ts", 'import { articles as rows } from "./s.js";\ndb.select({}).from(rows);'),
      ),
    ).toHaveLength(1);

    /* And the negative: columns are not the table. */
    expect(
      found("const where = eq(articles.visibility, 'public') && articles.slug;"),
    ).toEqual([]);
  });

  it("is bounded, and ordered by something that cannot tie", () => {
    expect(listing.sql).toMatch(/limit \$\d+$/);
    expect(listing.params).toContain(7);
    expect(listing.sql).toMatch(
      /order by "spideryarn"\."articles"\."public_at" desc nulls last, "spideryarn"\."articles"\."slug" asc/,
    );
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
   * (docs/plans/260831b-finish-the-database-move.md, stage 1b). The thing being
   * pinned is unchanged — **authorise, then move bytes** — and it is worth being
   * explicit that this is the same assertion at a new seam rather than a
   * weakened one: the store call is the *only* way this function can now obtain
   * a byte, so anything after it is after the check.
   *
   * **It reads code, not comments, and that distinction is the whole reason
   * this note is long.**
   *
   * The first rewrite of this route left a comment in `sendSource` explaining
   * what it used to do — *"This used to be `fsLocations(slug)` plus a
   * `readFile`"* — and the regex matches the function's whole text, prose
   * included. So the test went on passing while asserting an ordering between a
   * live call and a sentence about a call that no longer exists. GPT Sol read
   * the diff and predicted a failure; the suite stayed green. One predicted the
   * wrong outcome, the other reported the right outcome for the wrong reason.
   * docs/reusable/silent-success.md.
   *
   * So the body has its comments stripped first, and then both operands are
   * asserted present before their order is compared — because two `-1`s also
   * satisfy `<`, which is the other way this assertion can go quiet.
   *
   * tests/source-store.test.ts restates the ordering outside this suite's
   * `describe`, which is `describe.skip` when there is no database; a security
   * ordering that only holds when Postgres is up is not a property anybody wants
   * to depend on.
   */
  it("and the route asks before it fetches the bytes", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const source = await readFile(
      fileURLToPath(new URL("../src/routes.ts", import.meta.url)),
      "utf8",
    );
    const whole = /async function sendSource\([\s\S]*?\n}/.exec(source)?.[0] ?? "";
    /* Comments out, so a sentence *about* a call cannot stand in for one. Crude
       — it would eat a `//` inside a string literal — and there are none in this
       function, which is a thing to re-check rather than assume if it ever
       fails oddly. */
    const body = whole.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    /* Both present, asserted separately: two `-1`s satisfy `<` perfectly well,
       so the ordering below proves nothing on its own. */
    expect(body).toContain("shelfStore.read(slug)");
    expect(body).toContain("sourceStore.readPdf(slug)");
    /* And the comment-stripping does something, or the two lines above are
       being satisfied by prose again. `sendSource`'s own comment still names the
       filesystem read it replaced, which is what makes this a live control. */
    expect(body).not.toContain("fsLocations(slug)");
    expect(whole).toContain("fsLocations(slug)");

    /* Before the read, not after. A check that runs after the bytes have been
       fetched is not a check, and the order is the whole of it. */
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


/* ------------------------------- 5. the listing, against real rows -- */

/**
 * **The behavioural half of section 2b: what `GET /api/public/library` actually
 * returns, with two owners' rows in the table.**
 *
 * The static guard reads the statement. This runs it, through the route, in an
 * **ownerless** request scope — the real shape of an anonymous visit — against
 * five rows chosen so that every one of them would be a different bug:
 *
 * | row | owner | visibility | readable | expected |
 * |---|---|---|---|---|
 * | `…mine-public` | the seeded owner | public | yes | **listed** |
 * | `…mine-private` | the seeded owner | private | yes | absent |
 * | `…theirs-public` | a second account | public | yes | **listed** |
 * | `…theirs-noblocks` | a second account | public | tree, no blocks | absent |
 * | `…mine-notree` | the seeded owner | public | blocks, no tree | absent |
 *
 * **Two owners rather than one, and that is the point of the second account.**
 * With one owner, a listing that had quietly acquired `eq(articles.ownerId,
 * currentOwnerId())` would still pass every case — the only rows in the fixture
 * would be that owner's. `…theirs-public` is the row that cannot be returned by
 * an owner-filtered query on an ownerless request at all, so it is what makes
 * "ownerless" a fact rather than a claim. It is a real `auth.users` row because
 * `articles.owner_id` references that table (drizzle/0001) — the reason section
 * 3 above does *not* seed one is that its property is Bob seeing nothing, which
 * an owner with no rows states more strongly.
 *
 * **The two unreadable rows are not padding.** `loadArticle` and `loadHead`
 * refuse a revision with no tree or no blocks, so a listing without the same bar
 * puts a card on the shelf whose destination 404s the instant anybody presses
 * it: an advertised dead end, which nothing would report because both halves are
 * behaving exactly as written.
 *
 * **And the switch is thrown at the end**, through `pgVisibilityStore` — the
 * real write path, the one that stamps `public_at` and appends the
 * `article_visibility_changes` row — rather than a raw `update`. A listing that
 * ignored `visibility` altogether would pass every case above if the fixture
 * happened to be right; it cannot pass a row that changes its mind.
 */
/**
 * **Every id this fixture writes is minted per run**, and none of it is a
 * literal anybody else could pick.
 *
 * The first version wrote them out longhand — five article uuids, five revision
 * uuids and a second account — and three of them were already claimed by other
 * files. `tests/fixture-ids.test.ts` caught that, and its header says why the
 * remedy is minting rather than picking unused constants: a fixed id also
 * collides with **itself** when one file runs in two processes, which no static
 * guard can see, and the symptom either way is somebody else's suite 404ing
 * halfway through for reasons that look like a race.
 *
 * So: `randomUUID` for the rows and the second account, `mintId` for
 * `articles.short_id` — which is `.unique()` table-wide — and the run's own
 * suffix in every slug, because `slug` is unique per owner and two processes
 * running this file share the seeded owner. The block ids are fixed and safe to
 * be, for `export-route`'s reason: `block_identities` is keyed by
 * `(article_id, block_id)` and `revision_blocks` by the revision, so both are
 * already scoped by a minted id above.
 */
const LIST_RUN = randomUUID().slice(0, 8);
const LIST_OWNER_B = randomUUID() as OwnerId;

type ListedKey =
  | "mine-public"
  | "mine-private"
  | "theirs-public"
  | "theirs-noblocks"
  | "mine-notree"
  | "oversized"
  | "headed"
  | "big-heading";

/** A heading block after the opening paragraph, for the `<h1>` fallback rows. */
interface Heading {
  level: 1 | 2;
  text: string;
}

interface ListedSpec {
  key: ListedKey;
  block: string;
  tree: boolean;
  blocks: boolean;
  /** Absent means the ordinary fixture title; `null` means the column is null. */
  title?: string | null;
  gist?: string;
  siteName?: string;
  byline?: string;
  headings?: readonly Heading[];
}

/**
 * **Something far longer than any card could show**, which is the point.
 *
 * Nothing in the pipeline bounds a title or an `<h1>` — extraction takes what
 * the document had, and a fetched document may be 32 MB — so the only thing
 * standing between a hostile publisher and a very large anonymous response is
 * the `left()` in the listing's projection. These rows are what make that a
 * measured fact rather than a claim. GPT Sol's finding 1 on stage 3a.
 */
const OVERSIZED = 5_000;

/** The eight rows, and what each is for. */
const LISTED: readonly (ListedSpec & { article: string; revision: string; shortId: string })[] = (
  [
    { key: "mine-public", block: "spya-wsaaab", tree: true, blocks: true },
    { key: "mine-private", block: "spya-wsaaac", tree: true, blocks: true },
    { key: "theirs-public", block: "spya-wsaaad", tree: true, blocks: true },
    { key: "theirs-noblocks", block: "spya-wsaaae", tree: true, blocks: false },
    { key: "mine-notree", block: "spya-wsaaaf", tree: false, blocks: true },
    /* Every capped column at once, each far over its cap. */
    {
      key: "oversized",
      block: "spya-wsaaag",
      tree: true,
      blocks: true,
      title: "T".repeat(OVERSIZED),
      gist: "G".repeat(OVERSIZED),
      siteName: "S".repeat(OVERSIZED),
      byline: "B".repeat(OVERSIZED),
    },
    /* **The `<h1>` fallback, with two ways to get it wrong beside it.** No title
       at all, an `<h2>` *before* the `<h1>` so a predicate that lost its
       `level = 1` picks the wrong one, and a second `<h1>` *after* it so one
       that lost its `order by ordinal` can pick the wrong one too. What the card
       says is then compared with what `loadHead` says, which is the check the
       listing's own docstring claimed and nothing performed. */
    {
      key: "headed",
      block: "spya-wsaaah",
      tree: true,
      blocks: true,
      title: null,
      headings: [
        { level: 2, text: "A section that is not the title" },
        { level: 1, text: "The heading that names it" },
        { level: 1, text: "A later heading that is not it" },
      ],
    },
    /* The same fallback, oversized: the cap is inside the subselect, so a
       version that trimmed only the stored `title` column would miss it. */
    {
      key: "big-heading",
      block: "spya-wsaaaj",
      tree: true,
      blocks: true,
      title: null,
      headings: [{ level: 1, text: "H".repeat(OVERSIZED) }],
    },
  ] satisfies readonly ListedSpec[]
).map((row) => ({
  ...row,
  article: randomUUID(),
  revision: randomUUID(),
  shortId: mintId(),
}));

const listSlug = (key: ListedKey) => `test-listing-${key}-${LIST_RUN}`;

when("the shelf of public articles, asked for by nobody", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    await cleanListing();
    const db = getDb();
    /* A real `auth.users` row, through the one helper allowed to write one —
       four of that table's columns are nullable with no default and GoTrue 500s
       the whole database on a row that leaves them null.
       tests/helpers/seed-auth-user.ts. */
    await seedAuthUser(db, {
      id: LIST_OWNER_B,
      /* `users_email_partial_key` is unique, so the run's own suffix goes here
         too — tests/helpers/seed-auth-user.ts asks for a per-run address. */
      email: `listing-${LIST_RUN}@example.test`,
      onConflictDoNothing: true,
    });

    for (const row of LISTED) {
      const mine = row.key.startsWith("mine");
      await db.insert(articles).values({
        id: row.article,
        ownerId: mine ? currentOwnerId() : LIST_OWNER_B,
        slug: listSlug(row.key),
        /* Minted, not left null: the column is `.unique()` table-wide, and a
           null would be legal but would also make this fixture the one row in
           the table that has no handle. See `LISTED`. */
        shortId: row.shortId,
      });
      await db.insert(articleRevisions).values({
        id: row.revision,
        articleId: row.article,
        status: "published",
        /* Absent means the ordinary title; `null` means the row genuinely has
           none, which is what sends the query down its `<h1>` fallback. */
        title: row.title === undefined ? `A shared piece (${row.key})` : row.title,
        fetchedAt: new Date("2026-03-01T00:00:00.000Z"),
        wordCount: 7,
        blockCount: row.blocks ? 1 + (row.headings?.length ?? 0) : 0,
        partCount: 0,
        sectionCount: 0,
        rootGist: row.gist ?? `What ${row.key} is about.`,
        siteName: row.siteName ?? "example.test",
        byline: row.byline ?? "A. Writer",
        /* The bar the article read sets, put under this row's control: a
           revision with no tree is not a readable article, and neither is one
           with no blocks. */
        ...(row.tree
          ? {
              tree: {
                version: "1",
                generator: "test",
                slug: listSlug(row.key),
                rootId: "n0",
                nodes: {
                  n0: {
                    id: "n0",
                    depth: 0,
                    parent: null,
                    children: [],
                    range: [row.block, row.block],
                    title: "Root",
                    gist: "Something shared.",
                  },
                },
              },
            }
          : {}),
      });
      await db
        .update(articles)
        .set({ currentRevisionId: row.revision })
        .where(eq(articles.id, row.article));
      if (row.blocks) {
        /* The opening paragraph, then whatever headings this row is for — in
           the order they are listed, which is what `order by ordinal` reads. */
        const blocks = [
          {
            blockId: row.block,
            ordinal: 0,
            tag: "p",
            kind: "text",
            level: null as number | null,
            text: "A shared account of something.",
            html: "<p>A shared account of something.</p>",
          },
          ...(row.headings ?? []).map((heading, i) => ({
            blockId: mintId(),
            ordinal: i + 1,
            tag: `h${heading.level}`,
            kind: "heading",
            level: heading.level as number | null,
            text: heading.text,
            html: `<h${heading.level}>${heading.text}</h${heading.level}>`,
          })),
        ];
        await db
          .insert(blockIdentities)
          .values(blocks.map((b) => ({ articleId: row.article, blockId: b.blockId })));
        await db.insert(revisionBlocks).values(
          blocks.map((b) => ({
            articleId: row.article,
            revisionId: row.revision,
            blockId: b.blockId,
            ordinal: b.ordinal,
            tag: b.tag,
            kind: b.kind,
            level: b.level,
            text: b.text,
            words: 5,
            html: b.html,
            gistable: b.kind === "text",
          })),
        );
      }
    }

    /* **Shared through the real switch**, not a raw `update`: `pgVisibilityStore`
       is what stamps `public_at` — which the listing orders by — and appends the
       rights row, so a fixture built any other way would be testing an ordering
       against a column production fills in and this test did not. */
    for (const key of [
      "mine-public",
      "theirs-public",
      "theirs-noblocks",
      "mine-notree",
      "oversized",
      "headed",
      "big-heading",
    ] as const) {
      await share(key, "public");
    }
  });

  afterAll(async () => {
    await cleanListing();
    await closeDb();
  });

  it("lists a public article, whoever owns it", async () => {
    const shelf = await shelfNow();
    expect(shelf.map((e) => e.slug)).toContain(listSlug("mine-public"));
    /* **The one that cannot be explained away.** An owner-filtered listing on an
       ownerless request returns nothing at all, and an owner-filtered one that
       somehow had an owner would still not return this row. */
    expect(shelf.map((e) => e.slug)).toContain(listSlug("theirs-public"));
  });

  it("and never a private one", async () => {
    const shelf = await shelfNow();
    expect(shelf.map((e) => e.slug)).not.toContain(listSlug("mine-private"));
  });

  /**
   * **The readability bar, from the other side of it.**
   *
   * Both of these are `visibility = 'public'` and both would be cards. Neither
   * has a page: `loadArticle` refuses a revision with no tree and one with no
   * blocks, so each would be a card that 404s. Asserted separately from each
   * other so a failure names which half of the bar went.
   */
  it("and never one whose revision has no tree or no blocks", async () => {
    const slugs = (await shelfNow()).map((e) => e.slug);
    expect(slugs, "a public revision with a tree and no blocks").not.toContain(
      listSlug("theirs-noblocks"),
    );
    expect(slugs, "a public revision with blocks and no tree").not.toContain(
      listSlug("mine-notree"),
    );
  });

  /**
   * **The card carries what a card needs and nothing about a person.**
   *
   * The projection guard in section 2b reads the SQL; this reads the JSON that
   * left the route, which is the only place a key added by a DTO rather than by
   * a `select` would show up.
   */
  it("and a card is seven values, none of them about the owner", async () => {
    const card = (await shelfNow()).find((e) => e.slug === listSlug("theirs-public"));
    expect(card).toBeDefined();
    expect(Object.keys(card ?? {}).sort()).toEqual([
      /* `byline` is the *article's* author, off the publisher's page. The owner
         of this row is `LIST_OWNER_B` and the line below is what says so. */
      "byline",
      "gist",
      "publicAt",
      "siteName",
      "slug",
      "title",
      "words",
    ]);
    expect(JSON.stringify(card)).not.toContain(LIST_OWNER_B);
  });

  /**
   * **The switch, thrown while the test watches.**
   *
   * Every case above would pass against a listing that ignored `visibility`
   * entirely, provided the fixture's other columns happened to line up. This one
   * cannot: the same row is asked for twice, and the only thing that changed
   * between the two answers is the column the predicate reads.
   *
   * Through `pgVisibilityStore.set`, the route the owner's own toggle takes, so
   * what is exercised is the pair rather than two halves that agree on paper.
   */
  it("and a private article that is shared appears, and disappears again", async () => {
    expect((await shelfNow()).map((e) => e.slug)).not.toContain(listSlug("mine-private"));

    await share("mine-private", "public");
    expect((await shelfNow()).map((e) => e.slug)).toContain(listSlug("mine-private"));

    await share("mine-private", "private");
    expect((await shelfNow()).map((e) => e.slug)).not.toContain(listSlug("mine-private"));
  });

  /**
   * **The caps, measured on what actually left the route.**
   *
   * `left()` is in the statement, so this reads the JSON — the only place a cap
   * that was written and then not applied would show up. Asserted as an exact
   * length rather than "shorter than the source", because a truncation to some
   * other number is the same bug with a different symptom.
   *
   * **Red first:** removing the `left()` from `title` on 2026-09-04 failed this
   * at 5000 against 300.
   */
  it("and cuts an enormous title, gist, site name and byline down to the card's size", async () => {
    const card = (await shelfNow()).find((e) => e.slug === listSlug("oversized"));
    expect(card).toBeDefined();
    expect(card?.title).toHaveLength(PUBLIC_CARD_CHARS.title);
    expect(card?.gist).toHaveLength(PUBLIC_CARD_CHARS.gist);
    expect(card?.siteName).toHaveLength(PUBLIC_CARD_CHARS.siteName);
    expect(card?.byline).toHaveLength(PUBLIC_CARD_CHARS.byline);
  });

  /**
   * **And the `<h1>` fallback is capped where it is computed**, inside the
   * subselect rather than on the way out — a version that trimmed only the
   * stored `title` column would hand back the whole heading here.
   */
  it("and an enormous <h1> too, which is the column nobody stores", async () => {
    const card = (await shelfNow()).find((e) => e.slug === listSlug("big-heading"));
    expect(card).toBeDefined();
    expect(card?.title).toHaveLength(PUBLIC_CARD_CHARS.title);
  });

  /**
   * **The card and the page it opens agree about what this article is called.**
   *
   * The listing computes its own `<h1>` in SQL — src/store/public-library.ts
   * says why it is written twice rather than imported — and its docstring
   * claimed the two were checked together. Nothing checked them. GPT Sol's
   * finding 4 on stage 3a: *"changing the listing predicate to H2 appears
   * capable of passing the current static projection test"*, which was exactly
   * right.
   *
   * So this loads the card and then asks `loadHead` — the same function the
   * served HTML's `<title>` comes from — for the same article, and compares. The
   * fixture has an `<h2>` before the `<h1>` and a second `<h1>` after it, so
   * losing `level = 1` or losing `order by ordinal` each make the two disagree.
   *
   * **Red first:** changing `level = 1` to `level = 2` in
   * `PUBLIC_LIBRARY_HEADING_TITLE` on 2026-09-04 failed this, with the card
   * saying "A section that is not the title" and the head saying "The heading
   * that names it". The second `<h1>` is there for the `order by`, which was not
   * separately watched failing — Postgres is free to return the rows of an
   * unordered `limit 1` in insertion order, so that mutation may or may not
   * show. Said out loud rather than claimed.
   */
  it("and the card's title is the same <h1> the article's own head chooses", async () => {
    const card = (await shelfNow()).find((e) => e.slug === listSlug("headed"));
    expect(card?.title).toBe("The heading that names it");

    const { pgPublicReader } = await import("../src/store/public-reader.js");
    const head = await runInRequest(() => pgPublicReader.loadHead(listSlug("headed")));
    expect(head.title, "the shelf and the tab disagree about the same article").toBe(card?.title);
  });

  /** Ask the route, exactly as `handleApi` does, with nobody signed in. */
  async function shelfNow(): Promise<
    {
      slug: string;
      title: string;
      byline: string | null;
      gist: string | null;
      siteName: string | null;
    }[]
  > {
    const { servePublicApi } = await import("../src/public/routes.js");
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
        text = chunk ?? "";
      },
    } as unknown as ServerResponse;

    await runInRequest(async () => {
      /* No `setRequestOwner`. The box stays empty, which is what an anonymous
         request really looks like — and any owner reached for in here throws
         rather than quietly answering as somebody. */
      expect(() => currentOwnerId()).toThrow(/before the request was authenticated/);
      await servePublicApi({ res, path: "/api/public/library", method: "GET" });
    });

    expect(status).toBe(200);
    const body = JSON.parse(text) as {
      entries: {
        slug: string;
        title: string;
        byline: string | null;
        gist: string | null;
        siteName: string | null;
      }[];
      truncated: boolean;
    };
    /* The cap is 200 and this fixture is eight rows, so a `true` here means the
       shelf is being trimmed and every assertion below it is about a partial
       list. Cheap, and it is the difference between "not listed" and "not
       reached". The boundary itself is the describe below this one. */
    expect(body.truncated).toBe(false);
    return body.entries;
  }

  /** The owner's own switch, run as the owner it belongs to. */
  async function share(key: ListedKey, to: "public" | "private"): Promise<void> {
    const { pgVisibilityStore } = await import("../src/store/pg-visibility.js");
    const mine = key.startsWith("mine");
    await runInRequest(async () => {
      setRequestOwner(mine ? (theEnvironmentsOwner as OwnerId) : LIST_OWNER_B);
      await pgVisibilityStore.set(listSlug(key), to, true);
    });
  }
});

/* ------------------------------------- 6. the cap, at its exact boundary -- */

/**
 * **Two hundred rows and two hundred and one, which is the only place the cap
 * can be wrong.**
 *
 * `listPublic` asks for `PUBLIC_LIBRARY_LIMIT + 1`, reports
 * `rows.length > PUBLIC_LIBRARY_LIMIT`, and returns the first
 * `PUBLIC_LIBRARY_LIMIT`. That is correct by inspection, and GPT Sol's finding 4
 * on stage 3a was that inspection is all it had: nothing anywhere ran the route
 * against enough rows to make `truncated` say either thing. A `>=` for a `>`, an
 * off-by-one in the slice, or an honest `limit` of 200 with no way to tell a
 * full shelf from a trimmed one — all three pass every other test in this file.
 *
 * **It can be exact because this file runs in the private lane**
 * (tests/store-migration-registry.ts), so it owns a cloned database and nothing
 * else writes to it while it runs. Whatever public rows the clone already holds
 * are counted first and made up to exactly 200; on a shared database this would
 * be a race rather than a boundary.
 *
 * The rows are inserted with `visibility` set directly rather than through
 * `pgVisibilityStore` — two hundred round trips through the real switch to build
 * a volume fixture, when the switch is exercised properly by the case above that
 * throws it while the test watches. What is under test here is a count.
 */
const CAP_RUN = randomUUID().slice(0, 8);
const CAP = 200;
const CAP_ROWS = Array.from({ length: CAP + 1 }, (_, i) => ({
  index: i,
  article: randomUUID(),
  revision: randomUUID(),
  shortId: mintId(),
  block: mintId(),
  slug: `test-cap-${String(i).padStart(3, "0")}-${CAP_RUN}`,
}));

when("two hundred cards, and the two hundred and first", { timeout: 60_000 }, () => {
  /** How many public readable articles the cloned database already had. */
  let others = 0;

  beforeAll(async () => {
    await cleanCap();
    others = (await capShelf()).entries.length;
    /* If the clone already holds two hundred, there is no room to build a
       boundary and the assertions below would be about somebody else's rows. */
    expect(others).toBeLessThan(CAP);
    await insertCap(CAP - others);
  });

  afterAll(async () => {
    await cleanCap();
    await closeDb();
  });

  /**
   * **Both sides of the line, in one case**, because the second depends on the
   * first having been observed — two `it`s would be an ordering somebody could
   * break by adding a third between them.
   *
   * **Red first:** changing `rows.length > PUBLIC_LIBRARY_LIMIT` to `>=` on
   * 2026-09-04 failed the first half (a full shelf reported as trimmed);
   * changing `listPublic`'s request from `PUBLIC_LIBRARY_LIMIT + 1` to
   * `PUBLIC_LIBRARY_LIMIT` failed the second (a trimmed shelf reported as
   * whole).
   */
  it("is not truncated at two hundred, and is at two hundred and one", async () => {
    const full = await capShelf();
    expect(full.entries).toHaveLength(CAP);
    expect(full.truncated, "a shelf of exactly the cap is not a trimmed one").toBe(false);

    await insertCap(1, CAP - others);
    const over = await capShelf();
    expect(over.entries, "one row past the cap still returns the cap").toHaveLength(CAP);
    expect(over.truncated, "a shelf with more behind it must say so").toBe(true);
  });

  /** The route, ownerless, the same way `shelfNow` above asks it. */
  async function capShelf(): Promise<{ entries: { slug: string }[]; truncated: boolean }> {
    const { servePublicApi } = await import("../src/public/routes.js");
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
        text = chunk ?? "";
      },
    } as unknown as ServerResponse;
    await runInRequest(() => servePublicApi({ res, path: "/api/public/library", method: "GET" }));
    expect(status).toBe(200);
    return JSON.parse(text) as { entries: { slug: string }[]; truncated: boolean };
  }

  /** `count` rows from `CAP_ROWS`, starting at `from`, public and readable. */
  async function insertCap(count: number, from = 0): Promise<void> {
    const rows = CAP_ROWS.slice(from, from + count);
    if (rows.length === 0) return;
    const db = getDb();
    await db.insert(articles).values(
      rows.map((row) => ({
        id: row.article,
        ownerId: currentOwnerId(),
        slug: row.slug,
        shortId: row.shortId,
        visibility: "public",
        publicAt: new Date("2026-02-01T00:00:00.000Z"),
      })),
    );
    await db.insert(articleRevisions).values(
      rows.map((row) => ({
        id: row.revision,
        articleId: row.article,
        status: "published",
        title: `Card ${row.index}`,
        fetchedAt: new Date("2026-02-01T00:00:00.000Z"),
        wordCount: 5,
        blockCount: 1,
        partCount: 0,
        sectionCount: 0,
        tree: capTree(row.slug, row.block),
      })),
    );
    /* One statement rather than two hundred: the pointer cannot be set on the
       insert above, because the composite FK wants the revision to exist first. */
    await db.execute(
      sql`update spideryarn.articles a set current_revision_id = r.id
          from spideryarn.article_revisions r
          where r.article_id = a.id and a.id in ${sql.raw(
            `(${rows.map((row) => `'${row.article}'`).join(",")})`,
          )}`,
    );
    await db
      .insert(blockIdentities)
      .values(rows.map((row) => ({ articleId: row.article, blockId: row.block })));
    await db.insert(revisionBlocks).values(
      rows.map((row) => ({
        articleId: row.article,
        revisionId: row.revision,
        blockId: row.block,
        ordinal: 0,
        tag: "p",
        kind: "text",
        text: "One of many.",
        words: 3,
        html: "<p>One of many.</p>",
        gistable: true,
      })),
    );
  }
});

/**
 * The smallest tree that clears the readability bar, named rather than inlined:
 * inside a `.map()` there is no contextual type to keep `parent: null` from
 * widening, and the annotation is where that is fixed.
 */
function capTree(slug: string, block: string): typeof articleRevisions.$inferInsert.tree {
  return {
    version: "1",
    generator: "test",
    slug,
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: [],
        range: [block, block],
        title: "Root",
        gist: "One of many.",
      },
    },
  };
}

async function cleanCap(): Promise<void> {
  const db = getDb();
  const ids = CAP_ROWS.map((row) => row.article);
  await db.update(articles).set({ currentRevisionId: null }).where(inArray(articles.id, ids));
  await db.delete(revisionBlocks).where(inArray(revisionBlocks.articleId, ids));
  await db.delete(blockIdentities).where(inArray(blockIdentities.articleId, ids));
  await db.delete(articleRevisions).where(inArray(articleRevisions.articleId, ids));
  await db.delete(articles).where(inArray(articles.id, ids));
}

async function cleanListing(): Promise<void> {
  const db = getDb();
  for (const row of LISTED) {
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, row.article));
    await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, row.article));
    await db.delete(blockIdentities).where(eq(blockIdentities.articleId, row.article));
    await db.delete(articleVisibilityChanges).where(eq(articleVisibilityChanges.articleId, row.article));
    await db.delete(articleRevisions).where(eq(articleRevisions.articleId, row.article));
    await db.delete(articles).where(eq(articles.id, row.article));
  }
  /* The second account goes last, after every row that references it. Left
     behind it would be an `auth.users` row nothing owns, which the next run's
     `on conflict do nothing` would silently reuse — harmless, and still worth
     not doing. */
  await db.execute(sql`delete from auth.users where id = ${LIST_OWNER_B}`);
}

async function clean() {
  const db = getDb();
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, ARTICLE_ID));
  await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, ARTICLE_ID));
  await db.delete(blockIdentities).where(eq(blockIdentities.articleId, ARTICLE_ID));
  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, ARTICLE_ID));
  await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
  await db.delete(readerProfiles).where(eq(readerProfiles.ownerId, OUTSIDER));
}
