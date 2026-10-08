/**
 * **The imports production recorded — the door a developer debugs through.**
 *
 *     npx tsx scripts/import-records.ts                  # the last 20 that failed
 *     npx tsx scripts/import-records.ts --all            # successes and stops too
 *     npx tsx scripts/import-records.ts --limit 50
 *     npx tsx scripts/import-records.ts spya-xxxxxx      # one in full: address, file, error, every step
 *
 * Reads `spideryarn.import_records`, one row per import that ended, written by
 * the `jobs_record_import` trigger and never trimmed (src/db/schema.ts §
 * `importRecords`). The job id is what a failed import's *Report this* names.
 * Greg, 2026-10-08 (spya-f9c9pe): *"let's just make sure that we are making it
 * possible for the dev agent to access, find, debug whatever it needs to solve
 * problems from production after the fact."* Plan
 * docs/plans/261008j-a-failed-import-report-carries-the-address-and-a-record-of-every-import.md
 * § Stage 3.
 *
 * **A listing does not print the address or the error sentence** — the
 * address's host only — because a listing is the thing that gets pasted into a
 * log or a note. One job in full prints everything, for the import somebody is
 * about to debug. An address can carry a reader's private token; do not copy
 * one anywhere public.
 *
 * **Production, read-only**, the same path as scripts/feedback-reporter.ts:
 * `.env.prod`, verified TLS, one transaction opened `begin read only` and
 * rolled back, never a `SET` (docs/project/database.md § Which host), and a
 * `Target:` line. Exit 0: printed (possibly an empty list). Exit 1: no record
 * under that id. Exit 2: production could not be read, or does not have the
 * table yet — which is **not** "nothing failed".
 */
import { CannotTell, isMainModule, productionClient } from "./feedback-reporter.js";

/** The part of a `pg` client this needs, so a test can hand it its own connection. */
export interface Queryable {
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

export interface RecordRow {
  job_id: string;
  owner_id: string;
  slug: string;
  status: string;
  failure_kind: string | null;
  failed_step: string | null;
  error: string | null;
  url: string | null;
  upload_id: string | null;
  upload_filename: string | null;
  ingest_event_id: string | null;
  steps: unknown;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  recorded_at: Date;
}

export type Ask = { kind: "list"; all: boolean; limit: number } | { kind: "one"; jobId: string };

const COLUMNS = `job_id, owner_id, slug, status, failure_kind, failed_step, error, url, upload_id,
  upload_filename, ingest_event_id, steps, created_at, started_at, finished_at, recorded_at`;

/**
 * The one read-only transaction. Asks first whether the table exists, because
 * before the deploy that carries it "no rows" would be a lie.
 */
export async function readRecords(client: Queryable, ask: Ask): Promise<RecordRow[]> {
  await client.query("begin read only");
  try {
    const present = await client.query<{ present: boolean }>(
      "select to_regclass('spideryarn.import_records') is not null as present",
    );
    if (present.rows[0]?.present !== true) {
      throw new CannotTell("this database has no spideryarn.import_records yet (not deployed?)");
    }
    if (ask.kind === "one") {
      const result = await client.query<RecordRow>(
        `select ${COLUMNS} from spideryarn.import_records where job_id = $1`,
        [ask.jobId],
      );
      return result.rows;
    }
    const result = await client.query<RecordRow>(
      `select ${COLUMNS} from spideryarn.import_records
        ${ask.all ? "" : "where status = 'error'"}
        order by finished_at desc nulls last, recorded_at desc
        limit $1`,
      [ask.limit],
    );
    return result.rows;
  } finally {
    await client.query("rollback");
  }
}

const iso = (d: Date | null): string => (d === null ? "-" : d.toISOString().replace(/\.\d{3}Z$/, "Z"));

/** Where it came from, as a listing shows it: a host, or that it was an upload. */
export function origin(row: Pick<RecordRow, "url" | "upload_filename">): string {
  if (row.url !== null) {
    try {
      return new URL(row.url).host;
    } catch {
      return "(unparseable address)";
    }
  }
  return row.upload_filename !== null ? "(upload)" : "-";
}

/** One line per record, newest first. Never the address, slug or error sentence. */
export function formatList(rows: RecordRow[]): string[] {
  if (rows.length === 0) return ["  (none)"];
  return rows.map((r) =>
    [
      iso(r.finished_at),
      r.status.padEnd(9),
      (r.failed_step ?? "-").padEnd(10),
      (r.failure_kind ?? "-").padEnd(12),
      r.job_id,
      origin(r),
    ].join("  "),
  );
}

/** One record in full. */
export function formatOne(r: RecordRow): string[] {
  const lines = [
    `job:          ${r.job_id}`,
    `owner:        ${r.owner_id}`,
    `article slug: ${r.slug}`,
    `status:       ${r.status}`,
    `failure kind: ${r.failure_kind ?? "-"}`,
    `failed step:  ${r.failed_step ?? "-"}`,
    `error:        ${r.error ?? "-"}`,
    `address:      ${r.url ?? "-"}`,
    `upload:       ${r.upload_filename === null ? "-" : `${r.upload_filename} (${r.upload_id ?? "upload row gone"})`}`,
    `reservation:  ${r.ingest_event_id ?? "-"}`,
    `added:        ${iso(r.created_at)}`,
    `started:      ${iso(r.started_at)}`,
    `ended:        ${iso(r.finished_at)}`,
    "steps:",
  ];
  const steps = Array.isArray(r.steps) ? (r.steps as Record<string, unknown>[]) : [];
  for (const step of steps) {
    const times = [step.startedAt, step.finishedAt].filter((t) => typeof t === "string").join(" → ");
    lines.push(`  ${String(step.name).padEnd(12)} ${String(step.status).padEnd(8)} ${times}`);
    if (typeof step.error === "string") lines.push(`               ${step.error}`);
  }
  return lines;
}

export function parseArgs(argv: string[]): Ask | string {
  let all = false;
  let limit = 20;
  let jobId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--all") all = true;
    else if (arg === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isSafeInteger(n) || n < 1 || n > 1000) return "--limit takes a whole number from 1 to 1000";
      limit = n;
    } else if (/^spya-[a-z0-9]+$/.test(arg) && jobId === undefined) jobId = arg;
    else return `not understood: ${arg}`;
  }
  if (jobId !== undefined) return all ? "a job id and --all do not go together" : { kind: "one", jobId };
  return { kind: "list", all, limit };
}

const USAGE = "usage: npx tsx scripts/import-records.ts [--all] [--limit N] | <job id>";

async function main(argv: string[]): Promise<number> {
  const ask = parseArgs(argv);
  if (typeof ask === "string") {
    console.error(`${ask}\n${USAGE}`);
    return 2;
  }
  let target: string;
  let rows: RecordRow[];
  try {
    const prod = productionClient();
    target = prod.target;
    await prod.client.connect();
    try {
      rows = await readRecords(prod.client as unknown as Queryable, ask);
    } finally {
      await prod.client.end();
    }
  } catch (error) {
    if (error instanceof CannotTell) {
      console.error(`Cannot tell: ${error.message}`);
      return 2;
    }
    /* Database errors can carry connection details; the code alone is safe. */
    const code = (error as { code?: unknown } | null)?.code;
    const safe = typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? ` [${code}]` : "";
    console.error(`Cannot tell: reading production failed${safe} (other details withheld)`);
    return 2;
  }
  console.log(`Target: ${target} (read-only)`);
  if (ask.kind === "one") {
    const [row] = rows;
    if (row === undefined) {
      console.log(`no import record for ${ask.jobId} — not an import, not ended yet, or its article was deleted`);
      return 1;
    }
    for (const line of formatOne(row)) console.log(line);
    return 0;
  }
  console.log(ask.all ? `the last ${ask.limit} imports:` : `the last ${ask.limit} failed imports:`);
  for (const line of formatList(rows)) console.log(line);
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
