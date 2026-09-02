/**
 * Move every row one owner holds to another owner, on a **local** database.
 *
 *     npm run db:reown                 # dry run: does the work, rolls it back
 *     npm run db:reown -- --apply
 *     npm run db:reown -- --from <uuid> --to <uuid> --apply
 *
 * ## Why this exists
 *
 * `SPIDERYARN_OWNER_ID` decides who owns rows written **outside** a request —
 * the CLI, the pipeline, `db:import` (src/owner.ts). Unset, that is the seeded
 * row-owner `dev@spideryarn.local`, which nobody signs in as, so the library you
 * see after signing in is empty however much has been ingested. `.env.example`
 * and docs/project/supabase-local.md have recommended setting it to the
 * administrator's id since 2026-08-31 and refused to actually do it, because on
 * a database that already has rows it turns eight test files red: the shelf
 * reads empty and globally-unique slugs report your own articles as another
 * reader's.
 *
 * Moving the rows first is the missing half. Greg's call, 2026-09-01, asked as
 * a question and answered "move the rows".
 *
 * A fresh box never needs this — it is correct from its first ingest, because
 * `SPIDERYARN_OWNER_ID` is on `gjd-remote push-env`'s allowlist and arrives with
 * the environment. This is for the machines that already have a corpus.
 *
 * ## Which database, established rather than assumed
 *
 * It prints a password-stripped `Target:` line before it connects, because
 * **which database a command actually reaches is not always the one on its
 * command line**: `loadEnvLocal()` lets `.env.local` override a `DATABASE_URL`
 * exported in the shell, so `DATABASE_URL=… npm run db:reown` does not do what
 * it looks like. That is the same trap as
 * docs/project/database.md § `DATABASE_URL=… npm run db:migrate`, and the
 * `Target:` line is the same answer scripts/db-migrate.ts already prints.
 *
 * And a loopback address is **not** proof of a local database — an `ssh -L`
 * forwarding a remote port onto 127.0.0.1 satisfies `isLocalDatabaseUrl` exactly
 * as the real thing does. GPT Sol's first finding on this file, 2026-09-01, with
 * the tunnel case run. So the identity is settled against a *different source*:
 * the Supabase CLI's `DB_URL`, which describes this repo's Docker containers and
 * which no amount of port forwarding can change. `db:seed-owner` asks the same
 * question the same way, of the API endpoint rather than the database.
 *
 * ## The tables are read out of the database, not listed here
 *
 * Every **base table** in `spideryarn` with an `owner_id`. A list in this file
 * would be right on the day it was written and quietly short after the next
 * migration — and a re-own that misses a table leaves rows stranded under an
 * owner nobody signs in as, which looks exactly like nothing being wrong until
 * someone opens the feature that reads them.
 *
 * **`article_visibility_changes.actor_owner_id` is deliberately left alone.** It
 * records who pressed publish, not who owns something; rewriting it would be
 * editing a log of acts. Nothing reads it to build a shelf, and it is not an
 * `owner_id`, so the discovery query does not see it either.
 *
 * **And the things an `owner_id` column cannot see were checked rather than
 * assumed**, because an owned thing addressed some other way would be silently
 * stranded by this and the symptom would arrive weeks later:
 *
 * - **Supabase Storage.** No object key carries an owner, and every row in
 *   `storage.objects` has a null `owner` — checked on the box, 2026-09-01.
 *   Canonical objects are content-addressed and *shared* between owners by
 *   design (`sha256/<hex>`, src/store/blobs.ts); staging objects are
 *   `staging/<upload id>` from an id we minted (src/source.ts), and the `uploads`
 *   row that names one is moved by this script. So there is nothing to move in
 *   Storage — but note that is because of the null owner and the `uploads` row,
 *   not because every key is a hash. An earlier version of this comment said the
 *   latter and it was wrong; GPT Sol caught it.
 * - **The tables that carry no `owner_id` on purpose** — `article_revisions`,
 *   `revision_blocks`, `block_identities`, `revision_step_runs`, `chat_messages`,
 *   `queue_state`. Each reaches its owner through a row that has one, so moving
 *   the parent moves them (src/owner.ts § the header).
 * - **The filesystem store under `data/`** is not touched and cannot be: it has
 *   no owner at all. Anything still on it is out of scope, which is fine — new
 *   work goes to Postgres (docs/project/database.md).
 *
 * ## The dry run is the real write, rolled back
 *
 * Not a simulation and not a `select count(*)`. It runs every `update` inside a
 * transaction and then rolls it back, so the counts are the counts and a unique
 * violation is found by Postgres rather than predicted by us — which matters,
 * because the queue's unique indexes on `jobs` are **partial** — four of them,
 * src/db/schema.ts — and any prediction written here would have to
 * re-implement four predicates to avoid crying wolf.
 *
 * ## It can still leave rows behind, and it says so rather than claiming not to
 *
 * The transaction is atomic for the rows it saw. It takes no table lock, so a
 * pipeline that commits a *new* row for the old owner while this runs is not
 * moved and not noticed — Sol's second finding. Two answers, and neither is a
 * lock, because locking every owned table on a shared development database to
 * fix a fixture problem is worse than the problem:
 *
 * - **Stop the writers and set `SPIDERYARN_OWNER_ID` first**, so anything that
 *   starts up afterwards is already writing to the destination. The docs say
 *   this in that order now.
 * - **It re-counts after committing** and prints what is still there. A residual
 *   line is the difference between "nothing was left behind" and "nothing was
 *   left behind that we looked for".
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { loadEnvLocal } from "../src/env.js";
import { isLocalDatabaseUrl, withoutPassword } from "../src/db/ssl.js";
import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import { refuseUnlessOurDatabase } from "./db-reown-rules.js";
import { parseStatusEnv } from "./seed-accounts.js";

loadEnvLocal();

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Our own schema's names, so this is a fence against a surprise, not a parser. */
const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

function die(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/* **Lower-cased, because Postgres returns uuids canonically lower-cased.** An
   uppercase `--from` would pass the shape check, come back from `auth.users` in
   lower case, and be reported as an account that does not exist. Sol's finding
   7c. */
const from = (flag("from") ?? DEV_OWNER_ID).toLowerCase();
const to = (flag("to") ?? ADMIN_USER_ID_LOCAL).toLowerCase();
const apply = has("apply");

if (!UUID.test(from)) die(`--from is not a uuid: ${from}`);
if (!UUID.test(to)) die(`--to is not a uuid: ${to}`);
if (from === to) die("--from and --to are the same owner; there is nothing to move");

const url = process.env.DATABASE_URL;
if (!url) die("DATABASE_URL is not set — is .env.local present?");

/* **Before anything else, and before connecting.** See the header: a shell
   `DATABASE_URL` loses to `.env.local`, so the only honest way to say which
   database this is about to rewrite is to print the one it resolved. */
console.log(`Target: ${withoutPassword(url) ?? "(a DATABASE_URL that is not a parsable URL)"}`);

if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
  die("this process thinks it is production. Re-owning rows is a development fixture operation.");
}
/* The cheap outer fence, by the same function the migrator's guard uses —
   "local" must not mean one thing there and another here. It fails closed on a
   URL it cannot parse and survives a loopback address hidden in a password. */
if (!isLocalDatabaseUrl(url)) {
  die(
    "DATABASE_URL does not point at a local database.\n" +
      "  This rewrites who owns every row in the schema and there is no --allow-remote.\n" +
      "  In production the owner is the signed-in user, resolved per request (src/owner.ts).",
  );
}

/**
 * Ask the Supabase CLI, which reads this repo's containers rather than our
 * environment. A tunnel cannot make it describe itself.
 *
 * Resolved from this file's own location rather than `process.cwd()`: the CLI
 * finds `supabase/config.toml` relative to where it is run, so running this from
 * a subdirectory would otherwise describe a different project, or none.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
let statusEnv: string;
try {
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

/* The rule itself is in scripts/db-reown-rules.ts, pure and tested — this file
   does its work at import time, so nothing could drive the decision here. */
const notOurs = refuseUnlessOurDatabase(url, parseStatusEnv(statusEnv), withoutPassword);
if (notOurs) die(notOurs);

const pg = (await import("pg")).default;
const client = new pg.Client({ connectionString: url });
await client.connect();

/** Every base table in `spideryarn` with an `owner_id`. */
async function ownedTables(): Promise<string[]> {
  /* Joined to `information_schema.tables` for `BASE TABLE`, so a view over an
     owned table is not updated as if it were one. Sol's finding 7a. */
  const rows = await client.query<{ table_name: string }>(
    `select c.table_name
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'spideryarn'
        and c.column_name = 'owner_id'
        and t.table_type = 'BASE TABLE'
      order by c.table_name`,
  );
  return rows.rows.map((r) => r.table_name);
}

/** How many rows each table still holds for `owner`. Only the non-zero ones. */
async function residue(tables: string[], owner: string): Promise<{ table: string; n: number }[]> {
  const out: { table: string; n: number }[] = [];
  for (const table of tables) {
    const r = await client.query<{ n: string }>(
      `select count(*)::text as n from spideryarn."${table}" where owner_id = $1`,
      [owner],
    );
    const n = Number(r.rows[0]?.n ?? 0);
    if (n > 0) out.push({ table, n });
  }
  return out;
}

try {
  /* Both ends have to exist, because `owner_id` is a foreign key into
     `auth.users` and the violation it would otherwise raise names a constraint
     rather than the missing account. `npm run db:seed-owner` is the fix and this
     is where to say so. */
  const known = await client.query<{ id: string; email: string | null }>(
    "select id, email from auth.users where id = any($1::uuid[])",
    [[from, to]],
  );
  const seen = new Map(known.rows.map((r) => [r.id.toLowerCase(), r.email ?? "(no address)"]));
  for (const [label, id] of [["--from", from], ["--to", to]] as const) {
    if (!seen.has(id)) {
      die(
        `no auth.users row for ${label} ${id}.\n` +
          "  Run: npm run db:seed-owner — see docs/project/supabase-local.md.",
      );
    }
  }

  const tables = await ownedTables();
  if (tables.length === 0) {
    die("no base table in the `spideryarn` schema has an owner_id — has `npm run db:migrate` run?");
  }

  console.log(`from  ${from}  ${seen.get(from)}`);
  console.log(`to    ${to}  ${seen.get(to)}`);
  console.log(`${tables.length} owned tables\n`);

  await client.query("begin");
  let moved = 0;
  const lines: string[] = [];
  for (const table of tables) {
    if (!SAFE_IDENT.test(table)) die(`refusing to touch a table named ${JSON.stringify(table)}`);
    const result = await client.query(
      `update spideryarn."${table}" set owner_id = $1 where owner_id = $2`,
      [to, from],
    );
    const n = result.rowCount ?? 0;
    moved += n;
    if (n > 0) lines.push(`  ${String(n).padStart(6)}  ${table}`);
  }

  if (lines.length === 0) console.log("  nothing to move");
  else console.log(lines.join("\n"));

  if (!apply) {
    await client.query("rollback");
    console.log(`\n· dry run — ${moved} rows would move, and nothing was written.`);
    console.log("  Re-run with --apply.");
  } else {
    await client.query("commit");
    console.log(`\n✓ moved ${moved} rows`);

    /* **Counted again, after committing.** Not decoration: this transaction took
       no table lock, so a writer that committed a new old-owner row while it ran
       is neither moved nor noticed, and "✓ moved 111 rows" would be a true
       sentence next to a false impression. See the header. */
    const left = await residue(tables, from);
    if (left.length === 0) {
      console.log(`  nothing is left under ${from}.`);
    } else {
      const total = left.reduce((sum, t) => sum + t.n, 0);
      console.log(`\n⚠ ${total} row(s) arrived under ${from} while this ran, in:`);
      for (const t of left) console.log(`  ${String(t.n).padStart(6)}  ${t.table}`);
      console.log("  Something is still writing as the old owner. Stop it, set");
      console.log("  SPIDERYARN_OWNER_ID to the --to id, restart it, and run this again.");
    }
    console.log("\n  Set SPIDERYARN_OWNER_ID to the --to id so new CLI work lands there too.");
    console.log("  docs/project/supabase-local.md § One shelf, and how to get there");
  }
} catch (err) {
  await client.query("rollback").catch(() => {});
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e.code === "23505") {
    die(
      `both owners hold a row that the unique index ${e.constraint ?? "(unnamed)"} will not let ` +
        `sit together, so nothing was moved.\n` +
        "  Decide which to keep and delete the other, then re-run. `reader_profiles` is one row\n" +
        "  per owner, so that is the likely one — keep the destination's, which is the account\n" +
        "  somebody actually signs in as.",
    );
  }
  die(e.message ?? String(err));
} finally {
  await client.end();
}
