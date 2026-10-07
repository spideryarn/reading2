/**
 * **Fill the DOI, the journal and the publication day or year** on articles
 * imported before the registry step existed.
 *
 *     npx tsx scripts/backfill-registry-facts.ts                        # dry run, LOCAL
 *     npx tsx scripts/backfill-registry-facts.ts --apply <plan.json>    # write that plan, LOCAL
 *
 *     npx tsx scripts/backfill-registry-facts.ts --prod                       # dry run, PRODUCTION (read-only)
 *     npx tsx scripts/backfill-registry-facts.ts --prod --apply <plan.json>   # write that plan to PRODUCTION
 *
 * Optional: `--out <file>` names the plan file; `--only <slug>` plans one article.
 *
 * ## The dry run is what you get with no flag
 *
 * It opens one connection, runs `BEGIN READ ONLY`, and never commits, so
 * Postgres itself would refuse a write. It reads every article that has a
 * current revision, finds its own identifiers without a model (a PDF's first
 * two pages; a page's meta tags and address), asks Crossref and DataCite, and
 * keeps a record only when its title and an author are the article's. It
 * prints a table and saves a plan file. It makes real requests to the
 * registries, a few per article, spaced as the app spaces them.
 *
 * ## Apply takes the plan file, and asks no registry
 *
 * So what was read is what is written. It refuses the whole plan when it was
 * made against a different database, or when it fills a year and this database
 * has no `published_year` column yet (deploy first). Then, in one transaction
 * and per article: lock the article, check the plan's revision is still
 * current, refuse if a draft is unfinished, and fill only empty columns. A
 * second run reports every row as `already` and changes nothing. It exits
 * non-zero when it wrote nothing and found nothing already there.
 *
 * ## Which database
 *
 * With no flag: the one in `.env.local`, and it must be local. A
 * `DATABASE_URL` in the shell is not read. **`--prod` is the only way to
 * production**: it reads `DATABASE_URL`, `SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY` together from `.env.prod` (this checkout's, then
 * the primary's), because the database and the bucket holding the stored
 * documents have to be the same project. The `Target:` line is printed before
 * anything else happens; read it rather than the success line.
 * docs/project/database.md.
 *
 * The logic is src/backfill-registry-facts.ts; this file chooses the target,
 * connects, and prints.
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

import {
  applyPlan,
  applySucceeded,
  backfillTargetOf,
  dryRun,
  parsePlan,
  PLAN_COLUMNS,
  PlanRefused,
  registryLookup,
  targetLabel,
  type Plan,
  type PlanRow,
} from "../src/backfill-registry-facts.js";
import { isLocalDatabaseUrl, sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import { loadEnvLocal, parseEnvFile, readEnvProd } from "../src/env.js";
import { postgresBlobStore } from "../src/store/blobs.js";
import { readRawDocument } from "../src/store/raw-document.js";
import { whyNotProduction } from "./stripe-target.js";

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/* ------------------------------------------------------------- arguments -- */

interface Args {
  prod: boolean;
  apply: string | null;
  out: string | null;
  only: string | null;
}

/** Strict: a flag this does not know is refused, because `--prodd` would otherwise be a quiet local run. */
function parseArgs(argv: readonly string[]): Args {
  const args: Args = { prod: false, apply: null, out: null, only: null };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--prod") {
      args.prod = true;
    } else if (flag === "--apply" || flag === "--out" || flag === "--only") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) fail(`${flag} needs a value.`);
      args[flag.slice(2) as "apply" | "out" | "only"] = value;
    } else {
      fail(`unknown argument: ${flag}. Known: --prod, --apply <plan.json>, --out <file>, --only <slug>.`);
    }
  }
  if (args.apply !== null && (args.out !== null || args.only !== null)) {
    fail("--apply writes exactly the plan file it is given; --out and --only belong to the dry run.");
  }
  return args;
}

/* ---------------------------------------------------------------- target -- */

/** The database URL, and where it came from. Refuses rather than falling back. */
function chooseTarget(args: Args): { url: string; from: string; values?: Record<string, string> } {
  if (!args.prod) {
    /* The file, not the shell: without `--prod` the only valid target is local. */
    const file = path.resolve(import.meta.dirname, "../.env.local");
    const url = fs.existsSync(file) ? parseEnvFile(fs.readFileSync(file, "utf8")).DATABASE_URL : undefined;
    if (!url) fail("DATABASE_URL is not set. Locally: npm run db:start, then it comes from .env.local.");
    if (!isLocalDatabaseUrl(url)) {
      fail(
        `DATABASE_URL in .env.local is not a local database (${withoutPassword(url) ?? "unparsable"}). ` +
          "Without --prod this command only reads and writes the local one. For production, pass --prod.",
      );
    }
    return { url, from: ".env.local" };
  }
  const found = readEnvProd();
  if (!found) fail("--prod needs a .env.prod, and there is none in this checkout or the primary one.");
  /* The dry run reads stored documents, so it needs the bucket's credentials
     too; apply reads no document and needs only the database. */
  const needed = args.apply === null ? ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] : ["DATABASE_URL"];
  const missing = needed.filter((name) => !found.values[name]);
  if (missing.length > 0) fail(`--prod: ${found.file} has no ${missing.join(" and no ")}.`);
  const url = found.values.DATABASE_URL as string;
  const notProd = whyNotProduction(url);
  if (notProd) fail(`--prod: DATABASE_URL in ${found.file} is not a production database — ${notProd}.`);
  /* `postgresBlobStore` reads these three from the environment and checks the
     database and the bucket name one project. Assigned after `loadEnvLocal`,
     which memoises, so `.env.local` cannot put its own back. */
  return { url, from: found.file, values: found.values };
}

/* -------------------------------------------------------------- printing -- */

function cut(value: string, width: number): string {
  return value.length <= width ? value.padEnd(width) : `${value.slice(0, width - 1)}…`;
}

function printPlan(plan: Plan): void {
  const published = (row: PlanRow) => row.write.published_at ?? (row.write.published_year !== undefined ? String(row.write.published_year) : "");
  console.log(
    `\n${cut("outcome", 17)} ${cut("kind", 4)} ${cut("asked", 5)} ${cut("doi", 28)} ${cut("journal", 28)} ${cut("published", 10)} TL DR  slug / title`,
  );
  for (const row of plan.rows) {
    console.log(
      `${cut(row.outcome, 17)} ${cut(row.sourceKind ?? "-", 4)} ${cut(`${row.asked.length}/${row.candidates.length}`, 5)} ` +
        `${cut(row.write.doi ?? "", 28)} ${cut(row.write.journal ?? "", 28)} ${cut(published(row), 10)} ` +
        `${row.hasTimeline ? "y " : "- "} ${row.hasDraft ? "y " : "- "}  ${row.slug}`,
    );
    console.log(`${" ".repeat(103)}${cut(row.title, 90).trimEnd()}${row.note ? `  [${row.note}]` : ""}`);
  }
  const t = plan.totals;
  console.log(`\n${t.articles} article(s) with a current revision.`);
  console.log(`  outcomes: ${Object.entries(t.byOutcome).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  console.log(`  ${t.rowsWithAWrite} would be written: ${PLAN_COLUMNS.map((c) => `${c} ${t.byColumn[c]}`).join(", ")}`);
  console.log(`  ${t.timelinesMadeStale} gain a published_at and have a Timeline, which will then show as out of date.`);
  if (t.rowsWithAWriteAndADraft > 0) {
    console.log(`  ${t.rowsWithAWriteAndADraft} of those have an unfinished draft today; apply refuses an article while it has one.`);
  }
  if (t.lookupsUnanswered > 0) {
    console.log(
      `\n⚠ ${t.lookupsUnanswered} lookup(s) got no answer from a registry (see "unavailable" in the plan file).\n` +
        "  A none-agreed row may only mean nobody answered. Run the dry run again before applying.",
    );
  }
  if (!plan.publishedYearColumn) {
    console.log(
      "\n⚠ This database has no published_year column yet (the migration has not been deployed).\n" +
        `  The years above are what would be written. Apply refuses this plan until the column exists${t.byColumn.published_year === 0 ? " — it carries no year, so it can be applied now" : ""}.`,
    );
  }
}

/* ------------------------------------------------------------------ main -- */

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const { url, from, values } = chooseTarget(args);
  const target = backfillTargetOf(url);
  const local = isLocalDatabaseUrl(url);

  console.log(`Target: ${targetLabel(target)}`);
  console.log(`        ${local ? "local" : "REMOTE — PRODUCTION"}, from ${from}`);
  console.log(`        ${args.apply === null ? "dry run: BEGIN READ ONLY, nothing is written" : `APPLY: writing ${args.apply}`}\n`);
  loadEnvLocal();
  /* Set the selected database explicitly even when .env.local is pinned.
     Production's bucket credentials must come from the same file. */
  process.env.DATABASE_URL = url;
  if (values) {
    for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
      if (values[name]) process.env[name] = values[name];
    }
  }
  const client = new Client({ connectionString: url, ssl: sslDecisionFor(url).ssl });
  /* pg emits fatal idle errors outside any query promise. A listener keeps
     a read-only session's death from discarding a plan being built in memory.
     During apply a dead connection makes the next query/commit reject. */
  client.on("error", () => {
    console.warn("Database connection ended unexpectedly. Apply cannot commit on it; a dry-run plan can still be saved.");
  });
  await client.connect();
  try {
    if (args.apply !== null) {
      const plan = parsePlan(JSON.parse(fs.readFileSync(args.apply, "utf8")));
      const result = await applyPlan(client, plan, target);
      for (const row of result.rows) {
        const detail =
          row.outcome === "written"
            ? row.columns.join(", ")
            : row.outcome === "refused"
              ? `${row.reason}${row.columns ? ` (${row.columns.join(", ")})` : ""}`
              : "";
        console.log(`${cut(row.outcome, 8)} ${row.slug}${detail ? `  — ${detail}` : ""}`);
      }
      console.log(`\nwritten ${result.written}, already as the plan says ${result.already}, refused ${result.refused}.`);
      if (!applySucceeded(result)) {
        console.error("✗ Nothing was written and nothing was already there. This run changed nothing.");
        process.exitCode = 1;
      } else {
        console.log(result.written > 0 ? "✓ committed" : "✓ nothing to do: every row was already as the plan says");
      }
      return;
    }

    const blobs = postgresBlobStore("the backfill reads each article's stored document");
    const plan = await dryRun(client, target, {
      lookup: registryLookup(),
      readSource: (row) => readRawDocument(row.slug, row, blobs),
      ...(args.only !== null ? { only: (row) => row.slug === args.only } : {}),
      onRow: (row, index, of) => console.log(`[${index + 1}/${of}] ${cut(row.outcome, 17)} ${row.slug}`),
    });
    printPlan(plan);

    const stamp = plan.madeAt.replace(/[-:]/g, "").replace(/\..*$/, "");
    const out = path.resolve(args.out ?? path.join("logs", `backfill-registry-facts-${local ? "local" : "prod"}-${stamp}.json`));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(`\nPlan for ${targetLabel(target)} saved to ${out}`);
    console.log("Nothing was written to the database. To write exactly this plan:");
    console.log(`  npx tsx scripts/backfill-registry-facts.ts ${local ? "" : "--prod "}--apply ${out}`);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  if (err instanceof PlanRefused) fail(`${err.message}\n  Nothing was written.`);
  console.error(err);
  process.exit(1);
});
