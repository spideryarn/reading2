/**
 * Make every stored outside title plain text — the rows written before the
 * rule existed.
 *
 * ## Why this exists
 *
 * Since 2026-09-29 an outside title is made plain where it is written
 * (`plainTitle` in src/html.ts, and the seams in
 * docs/plans/260929e-outside-titles-become-plain-text-at-ingest.md). Rows
 * written before then still hold what the web gave us — a Debate source reading
 * `Physics - <i>Landmarks</i>—Millikan…`, drawn with its tags showing. Nothing
 * re-writes a stored Debate or a stored chat answer on its own, so without this
 * those rows stay wrong for good.
 *
 * ## What it touches
 *
 * `TARGETS` below, and nothing else: the text columns that hold an outside
 * title, and every `title` key anywhere inside the JSON columns that hold
 * search results or cited works. It applies exactly the function the seams
 * apply, so a row it rewrites is the row a fresh run would have written.
 *
 * **Article titles are reported, never written.** An HTML article's title is
 * also in its extracted page's `<h1>`, and so in a heading block and in the
 * stamped HTML; rewriting `article_revisions.title` alone would leave those
 * disagreeing with it. The slugs it lists want re-extracting, which moves the
 * title, the blocks and the source hash together (and so re-runs the steps
 * whose prompt quoted the old title — correctly, since that prompt changed).
 * GPT Sol's plan review, F4.
 *
 * **Compare-and-swap.** Each write is conditional on the column still holding
 * exactly what was read, so a Debate or a chat answer written between the read
 * and the write is left alone and counted as a conflict rather than overwritten
 * with a stale copy. Run it again to pick those up. GPT Sol, F2.
 *
 * ## Usage
 *
 * ```
 * npx tsx scripts/backfill-plain-titles.ts            # report, change nothing
 * npx tsx scripts/backfill-plain-titles.ts --write    # rewrite the rows it reports
 * ```
 *
 * Read the `Target:` line before `--write`. **Production is Greg's to run.**
 * A second run finds nothing, except for a doubly-encoded title
 * (`&amp;lt;i&amp;gt;`), which each run decodes one level further —
 * `plainTitle`'s comment says why.
 */
import { Pool } from "pg";

import { sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import { resolveTargetUrl } from "../src/env.js";
import { plainTitle } from "../src/html.js";
import { isMain } from "../src/is-main.js";

interface Target {
  table: string;
  column: string;
  /** `text`: the column is the title. `json`: every `title` key inside it. */
  kind: "text" | "json";
  key: readonly string[];
}

const TARGETS: readonly Target[] = [
  { table: "jobs", column: "title", kind: "text", key: ["id"] },
  { table: "citation_finds", column: "title", kind: "text", key: ["article_id", "entry_id"] },
  { table: "link_previews", column: "title", kind: "text", key: ["target"] },
  { table: "article_revisions", column: "debate", kind: "json", key: ["id"] },
  { table: "article_revisions", column: "citations", kind: "json", key: ["id"] },
  { table: "chat_messages", column: "citations", kind: "json", key: ["article_id", "thread_id", "id"] },
  { table: "comments", column: "citations", kind: "json", key: ["article_id", "id"] },
  { table: "glossary_lookups", column: "citations", kind: "json", key: ["article_id", "entry_id"] },
  { table: "referee_criteria", column: "results", kind: "json", key: ["article_id", "id"] },
];

/** A copy of `value` with every string under a `title` key made plain; what changed goes into `changes`. */
export function plainTitlesIn(value: unknown, changes: [string, string][] = []): unknown {
  if (Array.isArray(value)) return value.map((v) => plainTitlesIn(v, changes));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "title" && typeof v === "string") {
      const plain = plainTitle(v);
      if (plain !== v) changes.push([v, plain]);
      out[k] = plain;
    } else {
      out[k] = plainTitlesIn(v, changes);
    }
  }
  return out;
}

async function reportArticleTitles(pool: Pool): Promise<number> {
  const rows = (
    await pool.query(
      `select a.slug, r.id, r.title from spideryarn.article_revisions r
         join spideryarn.articles a on a.id = r.article_id
        where r.title is not null order by a.slug`,
    )
  ).rows as { slug: string; id: string; title: string }[];
  const marked = rows.filter((r) => plainTitle(r.title) !== r.title);
  for (const r of marked) {
    console.log(`  article_revisions.title ${r.slug} (revision ${r.id})\n    - ${r.title}\n    + ${plainTitle(r.title)}`);
  }
  console.log(
    `article_revisions.title: ${marked.length} revision(s) whose title needs normalising — never written here; re-extract these articles`,
  );
  return marked.length;
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  /* Shell wins: a URL on the command line names the database, and must not be
     buried by `.env.local`. docs/project/database.md. */
  const url = resolveTargetUrl({ shellWins: true });
  if (!url) {
    console.error("DATABASE_URL is not set. Local: npm run db:start. See docs/project/supabase-local.md.");
    process.exit(1);
  }
  console.log(`Target: ${withoutPassword(url) ?? "(a DATABASE_URL that is not a parsable URL)"}`);
  console.log(write ? "Mode: --write (rows below are rewritten)" : "Mode: dry run (nothing is changed; --write to apply)");

  const ssl = sslDecisionFor(url);
  const pool = new Pool({ connectionString: url, max: 1, ssl: ssl.ssl, application_name: "spideryarn backfill-plain-titles" });

  let total = 0;
  let conflicts = 0;
  try {
    for (const t of TARGETS) {
      const keys = t.key.map((k) => `"${k}"`).join(", ");
      const rows = (
        /* Do not prefilter on `<`/`&`: `plainTitle` also normalises whitespace,
           controls and bidi characters, none of which needs either marker. */
        await pool.query(
          `select ${keys}, "${t.column}" as v from spideryarn."${t.table}" where "${t.column}" is not null`,
        )
      ).rows as Record<string, unknown>[];
      let changed = 0;
      for (const row of rows) {
        const changes: [string, string][] = [];
        let next: unknown;
        if (t.kind === "text") {
          const before = row.v as string;
          next = plainTitle(before);
          if (next !== before) changes.push([before, next as string]);
        } else {
          next = plainTitlesIn(row.v, changes);
        }
        if (changes.length === 0) continue;
        const id = t.key.map((k) => `${k}=${String(row[k])}`).join(" ");
        for (const [before, after] of changes) console.log(`  ${t.table}.${t.column} ${id}\n    - ${before}\n    + ${after}`);
        if (!write) {
          changed++;
          continue;
        }
        /* Compare-and-swap on the value we read: `$2` is the old value, the
           keys follow. jsonb compares by value, so key order does not matter. */
        const cast = t.kind === "json" ? "::jsonb" : "";
        const where = t.key.map((k, i) => `"${k}" = $${i + 3}`).join(" and ");
        const encode = (v: unknown) => (t.kind === "json" ? JSON.stringify(v) : v);
        const result = await pool.query(
          `update spideryarn."${t.table}" set "${t.column}" = $1${cast}
            where ${where} and "${t.column}" = $2${cast}`,
          [encode(next), encode(row.v), ...t.key.map((k) => row[k])],
        );
        if (result.rowCount === 1) changed++;
        else {
          conflicts++;
          console.log(`    ! changed since it was read — left alone`);
        }
      }
      console.log(
        `${t.table}.${t.column}: ${changed} row(s) ${write ? "rewritten" : "would change"}, of ${rows.length} scanned`,
      );
      total += changed;
    }
    await reportArticleTitles(pool);
  } finally {
    await pool.end();
  }
  console.log(`\n${total} row(s) ${write ? "rewritten" : "would change"}${conflicts ? `, ${conflicts} left alone because they changed underneath` : ""}.`);
}

if (isMain(import.meta.url)) await main();
