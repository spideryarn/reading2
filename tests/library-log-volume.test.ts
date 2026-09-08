/**
 * How many lines one homepage load can put in the log — `listArticles`, wired in
 * [`src/store/index.ts`](../src/store/index.ts) and implemented in
 * [`src/store/pg.ts`](../src/store/pg.ts).
 *
 * **The rule this defends is about shape, not volume:** if the number of lines a
 * piece of code emits grows with the data, the caller says it once instead
 * (docs/project/logging.md § Vercel). Vercel keeps **256 lines per request** and
 * drops the rest, so a walk that logs per article does not merely make noise —
 * it deletes the end of that request's logs, including whatever else the request
 * wanted to say. The line you needed is the one that got dropped.
 *
 * Measured at 300 articles because that is past Vercel's cap, and because the
 * failure is invisible below it — at ten articles a line each looks fine.
 *
 * ## What this measured until 2026-09-05, and why the property outlived it
 *
 * It drove `listArticles` in `src/api.ts` over 300 corrupt **directories**: that
 * shelf called `readJson` three times per directory inside a `Promise.all`, and
 * `readJson` warned once per unreadable file. `src/api.ts` was the filesystem
 * article reader and was deleted with the filesystem store
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § G), so there are no directories to walk and that particular hazard is gone.
 *
 * **The property is not.** `scalarsForShelf` in `src/store/pg.ts` is the one
 * place the surviving shelf can speak per row: the five library scalars are
 * nullable columns, and a published revision with none of them sends the shelf
 * back to its blocks. That started life as *"two queries and a `warn` each"* —
 * `2 + 2M` statements and `M` log lines — and was aggregated into one query and
 * one `{ count, slugs, of }` line for exactly the reason above. It is also the
 * **only** `log(…)` call in the whole of `src/store/pg.ts`, checked rather than
 * assumed, so this file is measuring the one surviving hazard rather than a
 * sample of several.
 *
 * So the fixture changed shape and the three questions did not: 300 rows that
 * can each provoke a warning must produce a bounded number of lines, the lines
 * must still name what is wrong, and the names must not move between loads.
 *
 * ## Why a database, and why a child process
 *
 * The database because the shelf is Postgres now — this file is in the
 * `private-postgres` lane (`TEST_LANES` in tests/store-migration-registry.ts),
 * so the rows below go into a database minted for this run alone and no peer's
 * suite can see them.
 *
 * The child because [`src/log.ts`](../src/log.ts) builds its logger at import
 * time, is `silent` when `NODE_ENV=test`, and writes to file descriptor 1 with
 * `fs.writeSync` rather than through `process.stdout.write`. Stubbing
 * `process.stdout` in-process would capture nothing and prove nothing, and a
 * silent logger would make a wall of 300 lines and a clean single line
 * indistinguishable — both zero.
 *
 * **The child reaches this run's private database and not the developer's**,
 * and the mechanism is worth knowing before somebody "simplifies" it: it
 * inherits `process.env`, which the lane's setup has already pointed at the
 * minted database, and it inherits `SPIDERYARN_ENV_PINNED` too, which is what
 * stops `.env.local` handing the shared one straight back inside the child
 * ([`src/env.ts`](../src/env.ts) § `PINNED`). `tests/request-spend.test.ts` is
 * the same arrangement for the same reasons.
 *
 * This file **appends `SPIDERYARN_OWNER_ID` to that pin**, and it is not
 * decoration: `.env.local` names that variable too, so without the pin the child
 * lists the developer's shelf instead of the 300 rows below. Watched on
 * 2026-09-05 — dropping the append turns the two assertions about the warning
 * from red-on-a-wrong-number into *no warning line at all*, which is the shape of
 * a test that has quietly stopped measuring anything.
 *
 * ## One child, two loads
 *
 * The child is spawned **once for the whole file**, in `beforeAll`, and runs
 * `listArticles()` twice. Every test here asks a question about the log of a
 * homepage load, and two loads answer all three. The cost is the cold `tsx`
 * start and the import of `src/store/index.ts`'s graph — about a second, and
 * paid per process rather than per article — so a child per test would pay it
 * four times over to buy a few milliseconds of the thing under test.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal, PINNED, pinnedNames } from "../src/env.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/**
 * The four scalar columns are what the branch under test reads, so they are
 * named rather than left to a bare table check: a database migrated to before
 * docs/plans/260828c-library-read-latency.md would fail inside the store with a
 * bare `42703`. tests/helpers/pg-ready.ts § what to name.
 */
await pgReady({
  suite: "tests/library-log-volume.test.ts",
  tables: ["spideryarn.articles", "spideryarn.article_revisions", "auth.users"],
  columns: [
    { table: "spideryarn.article_revisions", column: "word_count" },
    { table: "spideryarn.article_revisions", column: "block_count" },
    { table: "spideryarn.article_revisions", column: "part_count" },
    { table: "spideryarn.article_revisions", column: "section_count" },
  ],
});

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Past Vercel's 256-line ceiling, which is the whole point of the number. */
const ARTICLES = 300;

/** This file's rows and nobody else's — a prefix nothing in the fixtures uses. */
const SLUG_PREFIX = "logvol-";

/**
 * **An owner of this file's own, and that is the difference between an exact
 * assertion and a flaky one.**
 *
 * The lane gives the run its own database, but not a database per file: the
 * suites before this one in the serialised lane share it, and a shelf listing is
 * the whole of *one owner's* library. Under the ambient owner, a fixture article
 * a peer left behind would land in `of`, could land in `count`, and — being
 * newer than these rows by `fetched_at` — could take one of the five slots the
 * capped list reports. All three assertions below would then be about the run
 * rather than about the code.
 *
 * So this file seeds its own `auth.users` row (`articles.owner_id` needs one)
 * and tells the child to be that person. `OWNER_AUDIT` in
 * tests/store-migration-registry.ts carries the verdict.
 */
const OWNER = "00000000-0000-4000-8000-00000000106f";

/**
 * A tree with a root and nothing else.
 *
 * `hasTree` is a presence check in the shelf's projection and a revision with
 * no tree is dropped before `scalarsForShelf` is reached, so the column has to
 * hold *something*. Nothing here reads its shape: the recompute derives zero
 * parts and zero sections from it, which is the correct answer for a tree with
 * one node.
 */
const TREE = JSON.stringify({ rootId: "r", nodes: { r: { id: "r", depth: 0 } } });

/**
 * What the shared setup below is allowed to take — three statements, and the
 * one child.
 *
 * Not a performance guard, and it must not be read as one. The cost here is a
 * cold `tsx` start plus the import of `src/store/index.ts`'s graph, which is
 * per process rather than per article; the guard against per-article work is
 * the assertion in the first test, that the line count does not grow with the
 * shelf.
 *
 * The size of the number is for a busy machine, and only that. This suite runs
 * on a box where ten worktrees compete for the same cores, and the
 * `private-postgres` lane is serialised besides.
 */
const SETUP_MS = 180_000;

/**
 * Written to fd 1 by the child after each load, so one child's output can be
 * cut back into one array of lines per load.
 */
const BOUNDARY = "---spideryarn-load-boundary---";

/**
 * Run `listArticles()` `loads` times **in one child**, and give back the lines
 * it put on fd 1 for each.
 *
 * `src/store/index.ts` rather than `src/store/pg.js` directly: that file is
 * what `src/routes.ts` imports, so this is the seam a homepage load actually
 * crosses — guard and all — rather than the adapter underneath it.
 */
function runLoads(loads: number): string[][] {
  const body = `void (async () => {
    const { writeSync } = await import("node:fs");
    const { listArticles } = await import(${JSON.stringify(path.join(ROOT, "src", "store", "index.ts"))});
    for (let i = 0; i < ${loads}; i++) {
      await listArticles();
      /* fs.writeSync to fd 1, and NOT console.log: the logger is a pino
         destination with sync: true, which writes straight to the descriptor,
         while process.stdout is asynchronous over a pipe. Two mechanisms means
         the boundary can land on the wrong side of the lines it separates, and
         a boundary that moves would silently hand the second load's warning to
         the first. Same call, same ordering. */
      writeSync(1, ${JSON.stringify(`${BOUNDARY}\n`)});
    }
    /* The pool holds the event loop open, and a child that never exits is a
       spawnSync that sits there until SETUP_MS. */
    const { closeDb } = await import(${JSON.stringify(path.join(ROOT, "src", "db", "client.ts"))});
    await closeDb();
  })();`;

  const env: NodeJS.ProcessEnv = { ...process.env };
  // Neither the suite's own LOG_LEVEL nor NODE_ENV=test may decide what this
  // measures: "test" makes the logger silent, which would make a wall of 300
  // lines and a clean single line indistinguishable — both zero.
  delete env.LOG_LEVEL;
  env.NODE_ENV = "development";
  /* Nobody is signed in out here, so `currentOwnerId()` answers
     `environmentOwnerId()` — which is this, and so the shelf the child lists is
     exactly the 300 rows seeded below. src/owner.ts. */
  env.SPIDERYARN_OWNER_ID = OWNER;
  /* **And the assignment above does not survive the spawn on its own.**
     `.env.local` names `SPIDERYARN_OWNER_ID`, and `src/env.ts` lets the file beat
     the shell for everything the process did not set *for itself* — a test which
     cannot be told apart from a shell export once it has crossed a `spawn`, since
     the child's own snapshot already contains it. Unpinned, the child would list
     the developer's shelf instead of this one's and every assertion below would
     be about somebody else's articles. `PINNED` is the documented answer, and it
     is appended to rather than replaced: the lane's setup has already pinned
     `DATABASE_URL` there, which is what keeps the child on the run's private
     database. src/env.ts § `PINNED`. */
  env[PINNED] = [...pinnedNames(env[PINNED]), "SPIDERYARN_OWNER_ID"].join(",");

  /* The timeout goes here, not only on `beforeAll`. `spawnSync` blocks the
     worker's event loop, so vitest's own timeout cannot fire while it waits —
     a wedged child would hang past SETUP_MS and past anything else, and the
     run would sit there looking busy. Found by GPT Sol, 2026-08-28. */
  const child = spawnSync(TSX, ["-e", body], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: SETUP_MS,
  });
  /* Reported before `status`, because a killed child has `status === null` and
     would otherwise be described as "exited null" — which reads like a crash
     rather than like the one thing that did not happen: finishing. */
  if (child.error !== undefined || child.signal !== null) {
    throw new Error(
      `shelf child did not finish (signal ${child.signal}, ${child.error?.message ?? "no error"}) ` +
        `after ${SETUP_MS}ms:\n${child.stderr}`,
    );
  }
  if (child.status !== 0) {
    throw new Error(`shelf child exited ${child.status}:\n${child.stderr}`);
  }

  /* One boundary written per load, so one more chunk than loads. Checked rather
     than sliced blind: a child that died half way through would otherwise hand
     back fewer loads than were asked for, and comparing a load against itself —
     or against nothing — is how this test would pass while measuring one call. */
  const chunks = child.stdout.split(BOUNDARY);
  if (chunks.length !== loads + 1) {
    throw new Error(
      `expected ${loads} completed loads, saw ${chunks.length - 1}:\n${child.stdout}\n${child.stderr}`,
    );
  }
  return chunks.slice(0, loads).map((c) => c.split("\n").filter((l) => l.trim() !== ""));
}

/**
 * The two loads, from the single child, shared by all three tests below.
 *
 * Every test here asks a question about the log of a homepage load, and two
 * loads answer all three of them: the first two tests are about what one load
 * says, and the last is about the two agreeing.
 */
let loads: string[][] = [];

/** One of the shared loads, or a clear failure if the child never produced it. */
function load(i: number): string[] {
  const lines = loads[i];
  if (!lines) throw new Error(`no load ${i}: the shared child in beforeAll did not produce one`);
  return lines;
}

/**
 * Anything an earlier run left, so what the child sees is this run's.
 *
 * By owner rather than by slug prefix: the owner is this file's alone, so this
 * cannot reach a peer's article, and it does catch a row left under a slug an
 * older version of this file used. `article_revisions` goes with it —
 * `article_id` is `on delete cascade`.
 */
async function forgetArticles(): Promise<void> {
  await getDb().execute(sql`delete from spideryarn.articles where owner_id = ${OWNER}::uuid`);
}

beforeAll(async () => {
  await forgetArticles();
  await seedAuthUser(getDb(), {
    id: OWNER,
    email: "library-log-volume@spideryarn.test",
    onConflictDoNothing: true,
  });

  /* Three statements rather than one with CTEs, and that is not a style
     preference: a data-modifying CTE is invisible to the statement's own
     snapshot, so an `update spideryarn.articles ... from <inserted rows>` in
     the same statement matches nothing at all and reports success. */
  await getDb().execute(sql`
    insert into spideryarn.articles (owner_id, slug)
    select ${OWNER}::uuid, ${SLUG_PREFIX} || lpad(g::text, 4, '0')
      from generate_series(0, ${ARTICLES - 1}) g`);

  /* **Published, with a tree, and with all five scalar columns left null** —
     which is the state `scalarsForShelf` warns about. Fixed-width slugs and one
     second of `fetched_at` between neighbours, so the shelf's `order by
     coalesce(fetched_at, created_at) desc` is a total order rather than 300 ties
     resolved however Postgres feels: the "same names every load" assertion below
     is a claim about the code, and it needs the ordering to be decidable before
     it can be one. */
  await getDb().execute(sql`
    insert into spideryarn.article_revisions (article_id, status, tree, fetched_at)
    select a.id, 'published', ${TREE}::jsonb,
           now() - (split_part(a.slug, '-', 2)::int || ' seconds')::interval
      from spideryarn.articles a
     where a.owner_id = ${OWNER}::uuid`);

  await getDb().execute(sql`
    update spideryarn.articles a
       set current_revision_id = r.id
      from spideryarn.article_revisions r
     where r.article_id = a.id
       and a.owner_id = ${OWNER}::uuid`);

  loads = runLoads(2);
}, SETUP_MS);

afterAll(async () => {
  await forgetArticles();
  await closeDb();
});

describe("one homepage load over a shelf of revisions with no library scalars", () => {
  it("says it once, rather than once per article", () => {
    const lines = load(0);
    /* The ceiling is deliberately loose. Pinning an exact count would make this
       a test of today's line-by-line wording, which is not the property — the
       property is that the number does not grow with the shelf. 300 articles
       producing single figures proves that; 300 producing 300 is the bug. */
    expect(lines.length, lines.join("\n")).toBeLessThanOrEqual(5);
  });

  it("still names the articles it had to recompute, rather than going quiet", () => {
    // Bounding the count by dropping the warning would pass the test above and
    // be strictly worse than the bug: a published revision with no scalars is a
    // real problem and this line is what makes it findable.
    const line = load(0).find((l) => l.includes("no library scalars"));
    expect(line, "no line mentioned the recomputed revisions at all").toBeDefined();

    const obj = JSON.parse(line ?? "{}") as { count?: number; slugs?: string[]; of?: number };
    expect(obj.count).toBe(ARTICLES);
    expect(obj.of).toBe(ARTICLES);
    // A capped list, not the whole shelf: the names are what make it actionable,
    // but all of them would be a line that grows with the library, and a long
    // line is the one most likely to be truncated by whatever collects it.
    expect(obj.slugs?.length).toBeLessThanOrEqual(5);
    expect(obj.slugs?.length).toBeGreaterThan(0);
    /* Slugs, and nothing else. The rows this line is about are somebody's
       articles; a title or a blurb here would be article prose in a log.
       src/store/pg.ts § `scalarsForShelf`. */
    for (const slug of obj.slugs ?? []) expect(slug.startsWith(SLUG_PREFIX)).toBe(true);
  });

  it("names the same articles on every load", () => {
    /* The names used to be whichever async reads happened to resolve first, so
       the same broken shelf accused different articles on different loads — and
       a name that moves is one you cannot search for twice. Two real loads
       rather than one, because a single call cannot disagree with itself. */
    const warning = (lines: string[]) => lines.find((l) => l.includes("no library scalars"));
    const slugs = (l?: string) => (JSON.parse(l ?? "{}") as { slugs?: string[] }).slugs;
    // Asserted before the comparison, because two absent lists are equal and
    // that would make this pass on code that logs nothing at all.
    expect(slugs(warning(load(0)))).toBeDefined();
    expect(slugs(warning(load(1)))).toBeDefined();
    expect(slugs(warning(load(0)))).toEqual(slugs(warning(load(1))));
  });
});
