/**
 * Is this database's corpus in a state the store flip can survive?
 *
 *     npx tsx scripts/db-corpus-readiness.ts
 *     npx tsx scripts/db-corpus-readiness.ts --seed-a-bad-row   # prove both checks can fail
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
 * and the bytes live in the `sources` bucket — and so does **each later page**
 * of a piece split over several, one `article_revision_parts` row apiece (plan
 * 261024p). Both are read the same way; checking only page 1 left a missing
 * continuation page beside a green report (GPT Sol's code review of 261024p,
 * F6). This corpus was written across two
 * stores, so half of it once named objects the reading process could not see —
 * docs/postmortems/260831e-a-write-path-with-no-reader.md. Stage 2c made that
 * loud, so a reference with nothing behind it now refuses `extract` rather than
 * quietly serving a 404.
 *
 * **Check 2 has to be the reading path itself, or it is worthless**, and the
 * first version of it was not. It called `blobStore()`, which falls back to
 * `data/_blobs/` whenever a credential is missing — so it could pass against
 * files on this laptop while the Postgres reader, which uses
 * `postgresBlobStore()` and fails closed, refused every one of them. That is the
 * *exact* divergence the postmortem above is about, reproduced inside the check
 * written to detect it. And it called `head()`, which is not a read: the reader
 * does a bounded `get()` and re-hashes the bytes, so `head()` cannot see an
 * unreadable download, an oversized object, or the wrong bytes under the right
 * key. Both are now the shared implementation — `postgresBlobStore()` and
 * `readRawDocument()` — rather than a second interpretation of them.
 * GPT Sol, 2026-08-31, code review § 2.
 *
 * **Both checks have a negative control**, and `--seed-a-bad-row` fails unless
 * each one names the exact fault planted for it. It used to be decided by a
 * shared counter, so check 1 could miss its seed entirely and the control would
 * still report success on the strength of check 2 having failed for an
 * unrelated reason. Check 2 had no control at all; it has two now — a
 * revision, and a seeded later page, each naming a `raw_sources` row whose
 * object is not in the bucket, which is the shape of
 * docs/postmortems/260831e-a-write-path-with-no-reader.md. Sol's § 4.
 *
 * **An empty corpus is a failure, not a pass.** Both checks are vacuously green
 * over no rows, and no rows is precisely what a botched refetch leaves behind,
 * so zero articles — or zero revisions, or zero source references — is reported
 * as NOT READY. It is still not enough to catch *one* article silently skipped;
 * that needs an expected inventory, and there isn't one yet. Sol's § 3.
 *
 * Both are reported per-article, because a count cannot be acted on: the whole
 * point is knowing *which* article to re-add.
 */

import { postgresBlobStore } from "../src/store/blobs.js";
import { Client } from "pg";

import { readRawDocument } from "../src/store/raw-document.js";
import { controlVerdict, readinessFailures, type Seeds } from "./corpus-verdict.js";
import { isLocalDatabaseUrl, sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import { loadEnvLocal, resolveTargetUrl } from "../src/env.js";

/* Shell beats file, same as db-migrate.ts and db-repair-migration-ledger.ts: the
   target of a check is an argument, not configuration. src/env.ts holds the rule
   and the reasoning for both camps. */
/* Kept explicit even though `resolveTargetUrl` calls it too: this script reads
   other variables out of `.env.local` as well, and the load being visible here
   is what says so. It memoises, so the second call costs nothing. */
loadEnvLocal();
const url = resolveTargetUrl({ shellWins: true });
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

  /* Counted before anything else, because both checks below are green over
     nothing and this is the number that says whether "green" means anything. */
  const counts = (
    await client.query<{ articles: number; revisions: number; refs: number }>(
      `select (select count(*)::int from spideryarn.articles) articles,
              (select count(*)::int from spideryarn.article_revisions) revisions,
              (select count(*)::int from spideryarn.article_revisions
                where raw_source_sha256 is not null) refs`,
    )
  ).rows[0]!;

  /** The sha nothing is stored under. Content-addressed, so this key cannot exist. */
  const DANGLING_SHA = "de1e7ed".padEnd(64, "0");
  /** The same, for the seeded later page — a second key so its arm is told apart. */
  const DANGLING_PART_SHA = "de1e7edba9e".padEnd(64, "0");
  let seeds: Seeds = { orphanedRevision: null, danglingSha: null, danglingPartSha: null };
  if (SEED_BAD) {
    if (!isLocalDatabaseUrl(url!)) {
      console.error("--seed-a-bad-row writes. Refusing against a database that is not local.");
      await client.end();
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
    /* **And a control for check 2**, which used to have none. The bytes cannot
       be deleted out of the bucket and put back by a rollback — but the row half
       of a reference can be repointed at a sha nothing is stored under, which is
       the same dangling reference, undone on the way out.

       Two statements because `article_revisions.raw_source_sha256` has a foreign
       key into `raw_sources`: the reference cannot dangle at the *row* level, so
       the seed has to make a legitimate-looking `raw_sources` row whose object
       is simply not in the bucket. That is the real failure this check is for —
       docs/postmortems/260831e-a-write-path-with-no-reader.md is a corpus of
       exactly that shape. */
    await client.query(
      `insert into spideryarn.raw_sources (sha256, kind, bytes, content_type, verified_at)
       select $1, r.raw_source_kind, 1, 'text/html', now()
         from spideryarn.article_revisions r
        where r.raw_source_sha256 is not null limit 1`,
      [DANGLING_SHA],
    );
    const dangling = await client.query<{ id: string }>(
      `update spideryarn.article_revisions
          set raw_source_sha256 = $1
        where id = (select id from spideryarn.article_revisions
                     where raw_source_sha256 is not null and raw_source_sha256 <> $1 limit 1)
      returning id`,
      [DANGLING_SHA],
    );
    /* **And one for the later pages.** A revision is given one more part —
       the next ordinal after any it has — naming an HTML `raw_sources` row whose
       object is not in the bucket. Referenced from nowhere else, so check 2 can
       only name this sha by reading `article_revision_parts`. */
    await client.query(
      `insert into spideryarn.raw_sources (sha256, kind, bytes, content_type, verified_at)
       values ($1, 'html', 1, 'text/html', now())`,
      [DANGLING_PART_SHA],
    );
    const danglingPart = await client.query<{ revision_id: string }>(
      `insert into spideryarn.article_revision_parts (revision_id, ordinal, url, raw_source_sha256, raw_source_kind)
       select r.id,
              coalesce((select max(p.ordinal) from spideryarn.article_revision_parts p where p.revision_id = r.id), 0) + 1,
              'https://seeded.invalid/next-page', $1, 'html'
         from spideryarn.article_revisions r
        where r.raw_source_sha256 is not null
        limit 1
      returning revision_id`,
      [DANGLING_PART_SHA],
    );
    seeds = {
      orphanedRevision: row.rows[0]?.id ?? null,
      danglingSha: dangling.rows[0] ? DANGLING_SHA : null,
      danglingPartSha: danglingPart.rows[0] ? DANGLING_PART_SHA : null,
    };
    /* **Nothing to seed is a failed control, not a quiet fall-through into the
       ordinary report.** It used to leave `seeded` null and carry on to print
       `✓ ready` and exit 0, which is the most misleading possible answer to
       "show me this check failing". Sol's § 4. */
    if (!seeds.orphanedRevision || !seeds.danglingSha || !seeds.danglingPartSha) {
      const v = controlVerdict(seeds, [], []);
      await client.query("rollback");
      console.error(v.say);
      await client.end();
      process.exit(1);
    }
    console.log(
      `Seeded, inside a transaction that is rolled back before exit:\n` +
        `  check 1 — revision ${seeds.orphanedRevision} now looks importer-written;\n` +
        `  check 2 — one revision's source reference now points at ${seeds.danglingSha},\n` +
        `            and one revision has a later page naming ${seeds.danglingPartSha}.\n` +
        "What is still NOT proved: that check 2 would notice the *wrong bytes* under a\n" +
        "right key. The re-hash in readRawDocument is what would catch that, and no\n" +
        "rollback-able seed can produce it, so it is unproven rather than assumed.\n",
    );
  }

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
    console.log("     ^ these have no input for stage 3 after the flip. Re-add them.");
  }

  /* ── 2. every reference resolves, through the reading path ───────────── */
  /* Page 1 of every revision, and every later page (`article_revision_parts`),
     through the one reader below. `page` only labels the line. */
  const refs = await client.query<{ slug: string; sha: string; kind: string; page: number }>(
    `select a.slug, r.raw_source_sha256 sha, r.raw_source_kind kind, 1 page
       from spideryarn.article_revisions r
       join spideryarn.articles a on a.id = r.article_id
      where r.raw_source_sha256 is not null
     union all
     select a.slug, p.raw_source_sha256 sha, p.raw_source_kind kind, p.ordinal + 1 page
       from spideryarn.article_revision_parts p
       join spideryarn.article_revisions r on r.id = p.revision_id
       join spideryarn.articles a on a.id = r.article_id
      order by slug, page`,
  );
  /* `postgresBlobStore`, not `blobStore()` — the article rows are in Postgres,
     so a filesystem fallback here would be checking a store nothing reads from.
     It throws when the credentials are missing or name a different project, and
     that refusal is the answer, not an error to work around. */
  const blobs = postgresBlobStore("this database's article rows are in Postgres");
  const unreadable: { sha: string; why: string }[] = [];
  for (const r of refs.rows) {
    try {
      /* The reader itself: a bounded `get` and a re-hash of the bytes
         (src/store/raw-document.ts). `head()` would have said yes to an object
         that is too big to read, or to the wrong bytes under the right name. */
      const doc = await readRawDocument(
        r.slug,
        { rawSourceSha256: r.sha, rawSourceKind: r.kind },
        blobs,
      );
      if (!doc) {
        unreadable.push({ sha: r.sha, why: `${r.slug} page ${r.page}  -> ${r.sha} (${r.kind}): the reader returned nothing` });
      }
    } catch (err) {
      unreadable.push({ sha: r.sha, why: `${r.slug} page ${r.page}  -> ${(err as Error).message}` });
    }
  }
  console.log(`\n2. Source references, later pages included — ${refs.rowCount} read back, ${unreadable.length} unreadable`);
  for (const m of unreadable) console.log(`     ${m.why}`);
  if (unreadable.length) {
    console.log("     ^ the row asserts an object the reading path cannot get. Re-add these.");
  }

  /* ── 3. there is a corpus at all ─────────────────────────────────────── */
  console.log(
    `\nCorpus: ${counts.articles} article(s), ${counts.revisions} revision(s), ` +
      `${counts.refs} source reference(s).`,
  );
  const failures = readinessFailures(counts, orphaned.rowCount ?? 0, unreadable.length);
  if (counts.articles === 0 || counts.revisions === 0 || counts.refs === 0) {
    console.log(
      "     ^ an empty corpus passes both checks above by having nothing to fail on,\n" +
        "       and empty is what a botched refetch leaves behind. Not ready.",
    );
  }

  if (SEED_BAD) {
    /* **Tied to the seeded id, not to the failure count.** With `bad` deciding
       it, an unrelated real failure in check 2 made the control "pass" without
       check 1 ever having seen the seed — a negative control that can succeed
       without detecting anything is worse than none, because it is quoted as
       evidence. Sol's § 4. */
    const control = controlVerdict(
      seeds,
      orphaned.rows.map((r) => r.id),
      unreadable.map((u) => u.sha),
    );
    await client.query("rollback");
    console.log("\nRolled back. Every seeded row is as it was.");
    console.log(control.say);
    if (failures.length) {
      console.log(`(The run also reported: ${failures.join("; ")}.)`);
    }
    await client.end();
    /* Deliberately inverted: under --seed-a-bad-row, finding the seeded fault
       is the success and not finding it is the failure. */
    process.exit(control.sawIt ? 0 : 1);
  }

  console.log(failures.length ? `\n✗ NOT READY — ${failures.join("; ")}.` : "\n✓ ready");
  await client.end();
  process.exit(failures.length ? 1 : 0);
}

await main();
