/**
 * Make the seeded local account **ready to use** — experimental features on, and
 * a few articles on the shelf.
 *
 *     npm run db:seed-dev
 *
 * ## What this is not
 *
 * It is **not** an account seed. `npm run db:seed-owner` writes the two
 * `auth.users` rows and this needs one of them to exist already; run that first,
 * or just run `npm run setup`, which runs both in order. The two are separate
 * commands because they talk to different things and fail in different ways:
 * that one talks to GoTrue's admin API and prints a generated password once,
 * this one talks to Postgres and the committed fixture corpus.
 *
 * It is **not** a third account either. The account is the one
 * [`scripts/seed-accounts.ts`](seed-accounts.ts) already writes —
 * `greg@gregdetre.com` at `ADMIN_USER_ID_LOCAL`, with a password generated per
 * machine into `~/.config/spideryarn/local-admin-password`. There is no Google
 * step on a local stack and there never was; `npm run db:admin-password` prints
 * the credentials and [`scripts/browser-sign-in.ts`](browser-sign-in.ts) types
 * them in. docs/plans/260902d-a-dev-account-that-is-ready-to-use-on-every-box.md
 * has the argument against adding one, which comes down to `/api/admin/*` gating
 * on a **uuid allowlist** in [`src/admin.ts`](../src/admin.ts): a new account is
 * not an administrator until its id is published in git, which is a worse
 * version of the hardcoded password this repo already talked itself out of.
 *
 * ## And it is not an importer
 *
 * `src/store/import.ts` and `npm run db:import` were deleted on 2026-09-01
 * (docs/plans/260827aa-delete-the-importer.md) because a **second**
 * files → Postgres implementation, exercised only by tests, drifts from the path
 * production runs. So this does not write articles itself. It calls
 * `loadArticleIntoPg` from [`tests/helpers/load-article.ts`](../tests/helpers/load-article.ts),
 * which is the survivor of that deletion and drives the real write path —
 * `storeRawSource`, a running `jobs` row, `openOrBeginJobDraft`, `copyArtefacts`,
 * `publishRevision`, guards and all.
 *
 * **A `scripts/` command importing from `tests/` is a new precedent here** and is
 * named as one rather than slipped in. It is the inverse of what the deletion
 * rejected: one implementation gaining a second caller, so the path a fixture
 * takes is the path production takes, and more exercise rather than less. The
 * alternatives were promoting the loader into `src/` — where it does not belong,
 * since it deliberately wraps the whole copy in one transaction while production
 * commits step by step — or running the real pipeline over the fixture HTML,
 * which costs AI calls and a network on every box, when the corpus was committed
 * precisely so that no box needs either.
 *
 * ## Re-run it after `npm test`
 *
 * `tests/owner-isolation.test.ts` deletes the environment owner's
 * `reader_profiles` row in an `afterAll`, which on a machine configured the way
 * every doc here tells you to configure it is **this account's row**. So a full
 * test run turns Experimental Features off, and the only symptom is the "since"
 * date moving the next time this runs. Re-running fixes it and costs a second.
 *
 * ## Idempotent, and the predicate is the interesting part
 *
 * Run it as often as you like. Each slug is skipped when it is **on the shelf**,
 * loaded when it is present but not, and left alone when it belongs to somebody
 * else — [`seed-dev-rules.ts`](seed-dev-rules.ts) § `planSlug` is the rule and
 * the reasoning, and it is pure so a test can drive every state.
 *
 * ## It reports what it read back, not what it did
 *
 * The last thing it prints is the length of `listArticles()` — **the library's
 * own read**, run as the account that will sign in, rather than a count written
 * here. `setup-local.ts` used to print "one shelf" on the strength of an
 * environment variable and was caught doing it (GPT Sol, 260901j review); the
 * answer then and here is that a claim about the shelf has to be a question
 * asked of the shelf.
 *
 * The first version of this line *was* a `count(*)` over `onTheShelf()` and was
 * wrong by two on the box it was written on — see § the verdict, below.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { styleText } from "node:util";

import { eq, sql } from "drizzle-orm";

import { ADMIN_EMAIL, ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articles } from "../src/db/schema.js";
import { isLocalDatabaseUrl, withoutPassword } from "../src/db/ssl.js";
import { loadEnvLocal } from "../src/env.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import { postgresBlobStore } from "../src/store/blobs.js";
import { pgArticleReader } from "../src/store/pg.js";
import { pgReaderStore } from "../src/store/pg-reader.js";
import { loadArticleIntoPg } from "../tests/helpers/load-article.js";
import { refuseUnlessOurDatabase } from "./db-reown-rules.js";
import { parseStatusEnv } from "./seed-accounts.js";
import { DEV_SHELF_SLUGS, missingFromShelf, planSlug, storeVerdict } from "./seed-dev-rules.js";

loadEnvLocal();

const bold = (s: string) => styleText("bold", s);
const dim = (s: string) => styleText("dim", s);
const green = (s: string) => styleText("green", s);
const yellow = (s: string) => styleText("yellow", s);

function die(message: string): never {
  console.error(styleText("red", `✗ ${message}`));
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  die(
    "DATABASE_URL must be set.\n" +
      "  Local: npm run db:start, then it comes from .env.local.\n" +
      "  See docs/project/supabase-local.md.",
  );
}

/* **Before anything connects.** `.env.local` beats a `DATABASE_URL` exported on
   the command line, because `loadEnvLocal()` above overrides the environment —
   so `DATABASE_URL=… npm run db:seed-dev` does not do what it looks like, and the
   only honest answer is to print the address actually being used.
   docs/project/database.md § `DATABASE_URL=… npm run db:migrate`, and
   scripts/db-reown.ts prints the same line for the same reason. */
console.log(bold(`Target: ${withoutPassword(url) ?? "(a DATABASE_URL that is not a parsable URL)"}`));

if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
  die(
    "refusing to seed: this process thinks it is production (NODE_ENV/VERCEL).\n" +
      "  These are development fixtures on a development account.",
  );
}
if (!isLocalDatabaseUrl(url)) {
  die(
    "DATABASE_URL does not point at a local host.\n" +
      "  This puts fixture articles on an account whose password is a file on this machine,\n" +
      "  and it must only ever run against the local Docker stack.",
  );
}

/**
 * **Ask a second source which database this is.**
 *
 * A loopback address proves nothing: an `ssh -L` forwarding a remote Postgres
 * onto 127.0.0.1 satisfies `isLocalDatabaseUrl` exactly as the container does,
 * and every other check in this run reads the same `DATABASE_URL`, so all of
 * them agree with each other whatever is on the far end. `supabase status` reads
 * the Docker containers belonging to *this repo's* project instead, and a tunnel
 * cannot make the CLI describe itself. GPT Sol raised this against `db-reown`,
 * having run it; the rule is shared rather than re-implemented.
 *
 * Resolved from this file's own location rather than `process.cwd()`, so running
 * it from a subdirectory cannot silently describe a different project.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
let statusEnv: string;
try {
  /* `supabase`, not `npx supabase`: on a machine without the CLI installed npx
     would go and *fetch* an unpinned one, at the moment we are trying to
     establish what is trustworthy. Sol's third finding on db:seed-owner. */
  statusEnv = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
} catch (err) {
  const detail = (err as { stderr?: Buffer | string }).stderr?.toString().trim() ?? "";
  die(
    "could not run `supabase status` to confirm which stack this is.\n" +
      "  Run: npm run db:start — see docs/project/supabase-local.md.\n" +
      "  Refusing rather than trusting DATABASE_URL, which is the value in doubt." +
      (detail ? `\n  The CLI said: ${detail.split("\n").slice(0, 3).join(" / ")}` : ""),
  );
}
const notOurs = refuseUnlessOurDatabase(url, parseStatusEnv(statusEnv), withoutPassword);
if (notOurs) die(notOurs);

/* Lower-cased for the same reason `planSlug` lower-cases: Postgres renders a
   uuid canonically lower-cased, and a constant that did not match its own row
   would report the administrator's own articles as somebody else's. */
const owner = ADMIN_USER_ID_LOCAL.toLowerCase() as OwnerId;

const db = getDb();
let failed = false;

try {
  /* The account has to exist first. `owner_id` is a foreign key into
     `auth.users`, and the violation it would otherwise raise names a constraint
     rather than the command that fixes it.

     Raw SQL because `auth.users` is deliberately absent from src/db/schema.ts —
     declaring Supabase's own table would make our migrations think they owned
     it (see that file's header). */
  const account = await db.execute(sql`select email from auth.users where id = ${owner}`);
  if (account.rows.length === 0) {
    die(
      `no auth.users row for ${owner} (${ADMIN_EMAIL}).\n` +
        "  Run: npm run db:seed-owner — it makes the account and this puts articles on its shelf.\n" +
        "  Or npm run setup, which runs both in order.",
    );
  }

  /* ------------------------------------------------------- experimental -- */

  console.log(bold("\nExperimental features"));
  /* **Through the production store, not a hand-written upsert.** `coalesce` so a
     re-run never moves an existing date — the column answers *since when*, and
     turning something on that is already on is not a change of mind
     (docs/project/experimental-features.md). Writing the SQL here would be a
     second spelling of `writeExperimental`, free to drift from the one the
     /profile page uses. */
  const since = await runAsOwner(owner, () => pgReaderStore.writeExperimental(true));
  /* Read back rather than trust the return: the write and the read are the two
     halves that a wrong owner id, or an `on conflict do nothing`, would let
     disagree — and disagreeing silently is the only way this fails. */
  const readBack = await runAsOwner(owner, () => pgReaderStore.readExperimental());
  if (!readBack) die("wrote experimental features on and read back nothing — the switch is still off");
  console.log(`  on since ${readBack}${since === readBack ? "" : ` (write said ${since})`}`);

  /* ------------------------------------------------------------ articles -- */

  console.log(bold("\nFixture articles"));

  /**
   * **The bucket has to belong to the same project as the database**, and this
   * is where that is settled rather than discovered later.
   *
   * `loadArticleIntoPg` calls `storeRawSource`, whose default `blobStore()`
   * **falls back to `data/_blobs/` when a Supabase credential is missing**
   * (src/store/blobs.ts). So a run with a good `DATABASE_URL` and no
   * `SUPABASE_SERVICE_ROLE_KEY` would write revision rows naming source objects
   * that live only on this machine's disk, where the reading path — which fails
   * closed — cannot see them. The article would be on the shelf and its original
   * unreadable, which is docs/postmortems/260831e-a-write-path-with-no-reader.md
   * happening again.
   *
   * Constructing the store is the check: its constructor refuses a missing
   * credential *and* a `SUPABASE_URL` naming a different project from
   * `DATABASE_URL`. The value is deliberately unused — the loader builds its own
   * — so this is a fence, and it is placed before the first write rather than
   * beside it. GPT Sol raised the case, 2026-09-02.
   *
   * `npm run setup` happens to run `db:seed-owner` first, which would have caught
   * a missing Supabase; a standalone `npm run db:seed-dev` has nothing else.
   */
  postgresBlobStore("npm run db:seed-dev is loading articles into Postgres");

  /** Slugs this run says should be readable at the end. See `missingFromShelf`. */
  const expected: string[] = [];

  /**
   * **What is on the shelf, asked of the shelf** — `listArticles()`, the read
   * `/api/library` performs, as the account that will sign in.
   *
   * Not `onTheShelf()`, which is the SQL-expressible **half** of the rule and
   * says so in its own comment: `listArticles` additionally drops a revision with
   * no tree and one with no blocks, per row in TypeScript, and a database a test
   * suite has been pointed at has both. Deciding with the half-rule would skip an
   * article the browser cannot see and call it seeded — the exact failure this
   * command exists to make impossible, one level up.
   */
  const shelfBefore = new Set(
    (await runAsOwner(owner, () => pgArticleReader.listArticles())).map((entry) => entry.slug),
  );

  for (const slug of DEV_SHELF_SLUGS) {
    /* Unscoped by owner, deliberately, and the only query here that is.
       `articles.slug` is globally unique across the install (src/owner.ts), so
       "not on MY shelf" and "free to load" are different questions — and the
       second is the one that decides whether `publishRevision` is about to raise
       *"the slug already belongs to another reader"*. */
    const [row] = await db
      .select({ ownerId: articles.ownerId, archivedAt: articles.archivedAt })
      .from(articles)
      .where(eq(articles.slug, slug))
      .limit(1);

    const plan = planSlug(
      slug,
      row
        ? { ownerId: row.ownerId, onTheShelf: shelfBefore.has(slug), archived: row.archivedAt !== null }
        : undefined,
      owner,
    );
    if (plan.action === "skip") {
      /* An archived article is skipped and is legitimately NOT expected back on
         the shelf — `listArticles()` answers the unarchived half. Every other
         skip is an article that is already there and must still be there at the
         end. */
      if (!row?.archivedAt) expected.push(slug);
      console.log(`  ${dim("·")} ${slug} — ${dim(plan.why)}`);
      continue;
    }
    if (plan.action === "refuse") {
      failed = true;
      console.log(`  ${yellow("!")} ${slug} — ${yellow(plan.why)}`);
      continue;
    }
    expected.push(slug);
    /* `serialise: true` because the slugs are fixed and `npm test` loads the same
       ones: without it two processes race on `jobs_active_slug`. See
       tests/helpers/run-lock.ts. */
    /* No `copied.length` or `published` assertion here any more. Both were
       redundant — the loader throws on a copy that moved nothing, and a default
       `publish: true` throws on a refusal — and both asked about the write when
       the question that matters is whether the article is *readable* afterwards.
       That is the postcondition below. GPT Sol, 2026-09-02. */
    const loaded = await loadArticleIntoPg(slug, { ownerId: owner, serialise: true });
    console.log(`  ${green("+")} ${slug} — ${loaded.copied.length} steps, published`);
  }

  /* -------------------------------------------------------- the verdict -- */

  /**
   * **The library's own read, as the account that will sign in.**
   *
   * Not a `count(*)` over `onTheShelf()`, which was the first version of this and
   * was wrong by two on the box it was written on: that predicate is the
   * **SQL-expressible half** of the rule and says so in its own comment
   * (src/store/pg.ts § `onTheShelf`). `listArticles` additionally drops, per row
   * in TypeScript, a revision with no tree and one with no blocks — and a
   * database that has had a test suite pointed at it has both. So the count said
   * 13 while the browser's `/api/library` said 11, which is a report about the
   * shelf that the shelf disagrees with.
   *
   * Calling the store means the number printed here is the number `/api/library`
   * returns, by construction rather than by two implementations agreeing. Caught
   * by running `scripts/browser-sign-in.ts` against the seeded database, which is
   * the whole argument for having run it.
   */
  const shelf = await runAsOwner(owner, () => pgArticleReader.listArticles());
  const shelfSlugs = shelf.map((entry) => entry.slug);

  console.log(bold(`\n${shelf.length} article${shelf.length === 1 ? "" : "s"} on ${ADMIN_EMAIL}'s shelf`));

  /* **The named slugs, not the total.** A count is satisfied by eleven old
     articles while all three fixtures failed — which is exactly the state a
     shared development database gets into. GPT Sol, 2026-09-02. */
  const missing = missingFromShelf(expected, shelfSlugs);
  if (missing.length > 0) {
    failed = true;
    console.log(yellow(`  ${missing.join(", ")} — seeded, and NOT on the shelf the library returns.`));
    console.log(dim("  A published revision with no tree or no blocks looks exactly like this."));
  } else if (expected.length > 0) {
    console.log(dim(`  including ${expected.join(", ")}`));
  }

  /* **After the durable work, never before it.** Everything above is committed
     by the time this can fail the run, so a re-run after fixing the variable is
     three skips and a second of work. Sol's ordering, 2026-09-02. */
  const store = storeVerdict(process.env.SPIDERYARN_STORE);
  console.log("");
  for (const [i, line] of store.lines.entries()) {
    console.log(store.ok ? green(`✓ ${line}`) : i === 0 ? yellow(`⚠ ${line}`) : dim(line));
  }
  if (!store.ok) {
    /* **Non-zero, not just a warning**, and this is a deliberate change of mind:
       the plan said warn-only, because several agents share this checkout and a
       failing `npm run setup` is disruptive. Sol's answer is the right one — the
       promise of this command is "ready to use", and with the filesystem store
       selected neither the articles nor the experimental switch reaches the
       application at all. `npm run setup` reporting completion over that is the
       silent success this whole file is built against. The seed itself is done
       and durable; what failed is the machine's configuration. */
    failed = true;
    console.log(dim("  The seed itself succeeded and is durable — nothing above needs doing again."));
  }

  console.log(dim("\n  npm run db:admin-password              the email and password for this machine"));
  console.log(dim("  npx tsx scripts/browser-sign-in.ts --at /read/writes"));
  console.log(dim("                                        signs a browser in and opens one, no human"));
} finally {
  await closeDb();
}

/* Non-zero when a slug was refused or the shelf came back empty. `npm run setup`
   stops at the first failing step, and a shelf nobody can open is worth stopping
   for — the whole point of this command is that the next thing you do is sign in
   and look at something. */
if (failed) process.exit(1);
