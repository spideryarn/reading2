/**
 * Is this database's corpus in a state the store flip can survive?
 *
 *     npx tsx scripts/db-corpus-readiness.ts
 *     npx tsx scripts/db-corpus-readiness.ts --seed-a-bad-row   # prove it can fail
 *
 * Stage 2.5 of docs/plans/260831b-finish-the-database-move.md says what "ready"
 * means and why, and its own words are the reason this is a script rather than
 * two queries somebody remembers to paste: *"proved by running them, not by a
 * command having reported success. A refetch that silently skipped an article
 * looks exactly like one that worked."* It is also the check production needs
 * before its own flip, and there is nobody to paste anything there.
 *
 * **It reads and reports. It changes nothing** — except under
 * `--seed-a-bad-row`, which exists so the checks can be watched failing; see
 * the bottom of this file.
 *
 * ## The two things it establishes
 *
 * **1. No revision has stamped HTML and no extracted HTML.** That pair is the
 * importer's signature: src/store/import.ts writes `extractedHtml: null` while
 * setting `stampedHtml`, and draft creation carries both columns forward. After
 * the flip a `blocks`-only job over such a revision copies `extractedHtml =
 * null` and has **no `BLOCKS_INPUT_HTML` to run from at all** — not a degraded
 * result, no input. It also contradicts src/blocks.ts, which claims no such
 * state exists. It does; the importer makes it.
 *
 * **2. Every stored source reference resolves to an object we can actually
 * read.** A revision names its source by `raw_source_sha256` + `raw_source_kind`
 * and the bytes live in the `sources` bucket. `blobStore()` follows the
 * credentials, and this corpus was written across two stores, so half of it once
 * named objects the reading process could not see —
 * docs/postmortems/260831e-a-write-path-with-no-reader.md. Stage 2c made that
 * loud, so a reference with nothing behind it now refuses `extract` rather than
 * quietly serving a 404.
 *
 * Both are reported per-article, because a count cannot be acted on: the whole
 * point is knowing *which* article to re-add.
 */

import { Client } from "pg";

import { blobStore, CONTENT_TYPE } from "../src/store/blobs.js";
import { canonicalKey } from "../src/source.js";
import { isLocalDatabaseUrl, sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import { loadEnvLocal } from "../src/env.js";

/* Shell beats file, same as db-migrate.ts and db-repair-migration-ledger.ts: the
   target of a check is an argument, not configuration. */
const fromShell = process.env.DATABASE_URL;
loadEnvLocal();
const url = fromShell ?? process.env.DATABASE_URL;
const SEED_BAD = process.argv.includes("--seed-a-bad-row");

if (!url) {
  console.error("No DATABASE_URL.");
  process.exit(1);
}

async function main() {
  const ssl = sslDecisionFor(url!);
  const client = new Client({ connectionString: url!, ssl: ssl.ssl });
  await client.connect();

  const where = (await client.query<{ db: string }>("select current_database() db")).rows[0];
  console.log(`Target: ${withoutPassword(url!)}  (database=${where?.db})`);
  console.log(`        ${isLocalDatabaseUrl(url!) ? "local" : "REMOTE"}\n`);

  let seeded: string | null = null;
  if (SEED_BAD) {
    if (!isLocalDatabaseUrl(url!)) {
      console.error("--seed-a-bad-row writes. Refusing against a database that is not local.");
      process.exit(1);
    }
    /* **The negative control, inside a transaction that is always rolled back.**
       A check nobody has watched fail is not evidence
       (docs/reusable/silent-success.md), and both checks below are of the kind
       that pass trivially on an empty corpus — which is exactly what a botched
       refetch leaves behind. So this makes one real row bad, runs the checks
       against it, and undoes it: the proof costs nothing and the corpus is not
       damaged to obtain it. An earlier version of this left the row broken,
       which would have made the next green run meaningless. */
    await client.query("begin");
    const row = await client.query<{ id: string }>(
      `update spideryarn.article_revisions
          set stamped_html = coalesce(stamped_html, '<p>seeded</p>'), extracted_html = null
        where id = (select id from spideryarn.article_revisions limit 1)
      returning id`,
    );
    seeded = row.rows[0]?.id ?? null;
    console.log(
      seeded
        ? `Seeded a bad row inside a transaction: revision ${seeded}.\n` +
            "**Check 1 only.** This seed makes a revision look importer-written; it does\n" +
            "not corrupt a source reference, so check 2 stays green and is NOT proved by\n" +
            "this flag. Check 2's control would mean deleting an object out of the bucket,\n" +
            "which a rollback cannot undo — so it is honestly unproven rather than\n" +
            "quietly assumed. The transaction is rolled back before exit.\n"
        : "Nothing to seed — the corpus is empty, so this proves nothing.\n",
    );
  }

  let bad = 0;

  /* ── 1. the importer's signature ─────────────────────────────────────── */
  const orphaned = await client.query<{ slug: string; id: string }>(
    `select a.slug, r.id from spideryarn.article_revisions r
       join spideryarn.articles a on a.id = r.article_id
      where r.stamped_html is not null and r.extracted_html is null
      order by a.slug`,
  );
  console.log(`1. Revisions with stamped HTML and no extracted HTML — ${orphaned.rowCount}`);
  for (const r of orphaned.rows) console.log(`     ${r.slug}  (revision ${r.id})`);
  if (orphaned.rowCount) {
    bad++;
    console.log("     ^ these have no input for stage 3 after the flip. Re-add them.");
  }

  /* ── 2. every reference resolves ─────────────────────────────────────── */
  const refs = await client.query<{ slug: string; sha: string; kind: string }>(
    `select a.slug, r.raw_source_sha256 sha, r.raw_source_kind kind
       from spideryarn.article_revisions r
       join spideryarn.articles a on a.id = r.article_id
      where r.raw_source_sha256 is not null
      order by a.slug`,
  );
  /* The same `blobStore()` the reading path uses, rather than a hand-built URL —
     the fault this check exists for was two processes selecting *different*
     stores, so a probe that picked its own would be able to miss it entirely. */
  const blobs = blobStore();
  const missing: string[] = [];
  for (const r of refs.rows) {
    const key = canonicalKey(r.sha, r.kind as keyof typeof CONTENT_TYPE);
    const head = await blobs.head(key).catch(() => null);
    if (!head) missing.push(`${r.slug}  -> ${key}`);
  }
  console.log(`\n2. Source references — ${refs.rowCount} checked, ${missing.length} unreadable`);
  for (const m of missing) console.log(`     ${m}`);
  if (missing.length) {
    bad++;
    console.log("     ^ the row asserts an object that is not there. Re-add these.");
  }

  const total = await client.query<{ n: number }>(
    `select count(*)::int n from spideryarn.articles`,
  );
  console.log(`\nCorpus: ${total.rows[0]?.n ?? 0} article(s).`);

  if (seeded) {
    await client.query("rollback");
    console.log(`\nRolled back. Revision ${seeded} is as it was.`);
    console.log(
      bad
        ? "The checks saw the seeded fault, so they can fail. That is what this flag is for."
        : "⚠ THE CHECKS DID NOT SEE THE SEEDED FAULT. They cannot fail, so a green run\n" +
            "  from them means nothing. Fix the check before trusting it.",
    );
    await client.end();
    /* Deliberately inverted: under --seed-a-bad-row, finding the fault is the
       success and a clean report is the failure. */
    process.exit(bad ? 0 : 1);
  }

  console.log(bad ? `\n✗ NOT READY — ${bad} of 2 checks failed.` : "\n✓ ready");
  await client.end();
  process.exit(bad ? 1 : 0);
}

await main();
