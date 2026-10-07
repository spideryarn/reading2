/**
 * Delete the article rows whose first import never finished — **a pinned,
 * reviewed list of them, once, and a dry run unless told otherwise**.
 *
 *     npx tsx scripts/never-published-tidy.ts                       # local, dry run
 *     npx tsx scripts/never-published-tidy.ts --prod                # production, dry run (read-only)
 *     npx tsx scripts/never-published-tidy.ts --prod --delete \
 *       --ids <file of article ids> --backup-dir <dir outside the repo>
 *     npx tsx scripts/never-published-tidy.ts --restore <backup file>  # the undo (add --prod only to undo the real run)
 *
 * `beginRevision`/`lockOrCreateArticle` write the `articles` row before there
 * is anything in it, so a first import that fails leaves a row no reader can
 * see (every shelf read inner-joins the current revision) and nothing removes
 * it. Greg, 2026-10-07, relayed by the Overseer: *"yes, tidy them"*.
 * docs/plans/261007f-tidy-the-never-published-production-articles.md is the
 * plan, the evidence and the rule; read it before running `--delete`.
 *
 * **The dry run cannot write.** One `begin read only`, checked with
 * `transaction_read_only` before anything is read, as
 * scripts/draft-sweep-backlog.ts does. Never a `SET`: `.env.prod` is the
 * transaction pooler, where a `SET` outlives the connection
 * (docs/project/database.md § Which host).
 *
 * **The delete is the store's own `pgShelfStore.destroy`, one article per
 * transaction**, run as that article's owner (`runAsOwner`). So the billing
 * lock, the article lock, the refusal of a live job or a stranded reservation,
 * the terminal-job delete and the cascade are the same code a reader's Delete
 * button runs (src/store/pg-shelf.ts). Nothing here writes SQL that deletes.
 *
 * **It acts only on a list it has proved twice and you have pinned.** The
 * candidates come from one query; a second, hand-written one re-asks every
 * protection of exactly those ids and must agree. `--delete` then refuses
 * unless the eligible set equals the ids in `--ids` exactly, is no larger than
 * `MAX_PER_RUN`, and a backup of every row that will go has been written. Each
 * article is then decided again **inside `destroy`'s own transaction, after its
 * locks** (`DestroyOptions.beforeDelete`): the pinned id, the whole rule, and
 * the rows about to go against the rows the backup holds. Anything changed, and
 * that article is refused and the run stops (GPT Sol's R1).
 *
 * **It prints ids, short ids, counts and timestamps** — never a slug (made
 * from a title), a URL or any content. The backup file holds content (a
 * checkpoint is a transcription of the reader's document), so it is written
 * `0600` to a directory outside this repository and must never be committed.
 *
 * `console.log`, not `log()` — this is a CLI. CLAUDE.md § Writing code.
 */
import { chmodSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { Db } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { isLocalDatabaseUrl, sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import { loadEnvLocal } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import type { DestroyOptions } from "../src/store/contracts.js";
import { pgShelfStore } from "../src/store/pg-shelf.js";
import { draftBacklogTarget } from "./draft-sweep-backlog.js";

/** The most articles one `--delete` will touch. The reviewed set was 13. */
export const MAX_PER_RUN = 20;

/** Nothing attached may have moved for this long. The plan says why seven. */
export const DEFAULT_QUIET_DAYS = 7;

/** Why a never-published article is left alone. Empty means eligible. */
export type HoldReason =
  | "has-revisions"
  | "has-jobs"
  | "has-reservations"
  | "has-reader-state"
  | "recent";

export interface Attached {
  readonly revisions: number;
  readonly blockIdentities: number;
  readonly checkpoints: number;
  readonly aiCalls: number;
  readonly jobs: number;
  readonly reservations: number;
  readonly uploadsBySlug: number;
  /** Every reader-made row or shelf setting, summed: comments, chat, notes, tags, title… */
  readonly readerState: number;
}

export interface Candidate {
  readonly articleId: string;
  readonly shortId: string | null;
  readonly ownerId: string;
  /** Internal only: `destroy` takes a slug. Never printed. */
  readonly slug: string;
  readonly createdAt: Date;
  readonly newestActivity: Date;
  readonly attached: Attached;
  readonly hold: readonly HoldReason[];
}

/** What the second query found among the eligible ids. All but `seen` must be zero. */
export interface EligibleProof {
  readonly seen: number;
  readonly published: number;
  readonly revisions: number;
  readonly jobs: number;
  readonly reservations: number;
  readonly readerState: number;
  readonly recent: number;
}

export interface NeverPublishedSurvey {
  readonly candidates: readonly Candidate[];
  readonly eligible: readonly Candidate[];
  readonly proof: EligibleProof;
  readonly proven: boolean;
  readonly role: string;
  readonly quietDays: number;
}

export interface SurveyOptions {
  readonly quietDays?: number;
  /** Restrict to one owner. For tests, so a peer's rows can never join the set. */
  readonly ownerId?: string;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const when = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

/**
 * **The reader-made tables**, written out once and used by both queries. Every
 * table with an `article_id` foreign key that a reader's own action fills.
 * A never-published article cannot be opened, so each should be zero; one that
 * is not is held back rather than deleted, because the reader made it.
 */
const READER_TABLES = [
  "comments", "chat_threads", "search_runs", "referee_criteria", "referee_claims",
  "glossary_lookups", "glossary_hidden_entries", "citation_finds", "citation_investigations",
  "reading_time", "quiz_attempts", "link_summaries", "article_tags", "upload_source_guesses",
  /* **And the history that outlives the article** (`on delete set null`): a
     share link made and turned off, a publish and unpublish, a spoken
     conversation. The delete would only null their `article_id`, and the
     backup does not record those links, so a restore could not put them back.
     `turnOff` clears both share columns without stamping `updated_at`, so these
     rows are the only trace that an article was ever shared. GPT Sol's
     round-2 D2. */
  "article_share_link_events", "article_visibility_changes", "realtime_sessions",
] as const;

function readerRowsOf(alias: string) {
  return sql.raw(
    READER_TABLES.map((t) => `(select count(*) from spideryarn.${t} x where x.article_id = ${alias}.id)`).join(" + "),
  );
}

/**
 * Shelf state a reader set by hand: a title, a purpose, archiving, sharing
 * (now or ever), an open, the high-powered-AI switch. The survey's spelling;
 * `proveEligible` has its own, and tests/never-published-tidy.test.ts § "the
 * two queries protect the same things" fails if they part.
 */
function shelfStateOf(alias: string) {
  return sql.raw(
    `(case when ${alias}.title_override is not null or ${alias}.purpose is not null or ` +
      `${alias}.archived_at is not null or ${alias}.share_token is not null or ${alias}.share_token_at is not null or ` +
      `${alias}.visibility <> 'private' or ${alias}.public_at is not null or ${alias}.opens > 0 or ` +
      `${alias}.last_opened_at is not null or ${alias}.high_power_since is not null ` +
      `then 1 else 0 end)`,
  );
}

/**
 * Every never-published article, what is attached to it, and whether the rule
 * admits it. Read-only: it opens its own `begin read only` and refuses to go on
 * if the transaction is anything else.
 */
export async function surveyNeverPublished(
  db: Db,
  opts: SurveyOptions = {},
): Promise<NeverPublishedSurvey> {
  const quietDays = opts.quietDays ?? DEFAULT_QUIET_DAYS;
  return await db.transaction(
    async (tx) => {
      const [ro] = (await tx.execute(sql`select current_setting('transaction_read_only') as ro`)).rows as Row[];
      if (ro?.ro !== "on") throw new Error(`refusing to go on: the transaction is not read-only (${String(ro?.ro)})`);
      const [who] = (await tx.execute(sql`select current_user::text as role`)).rows as Row[];

      /* Never published: no current revision, and no revision that ever was
         published (a status other than draft/failed, or a publication time). */
      const rows = (
        await tx.execute(sql`
          select a.id, a.short_id, a.owner_id, a.slug, a.created_at,
            (select count(*) from spideryarn.article_revisions r where r.article_id = a.id) as revisions,
            (select count(*) from spideryarn.block_identities b where b.article_id = a.id) as block_identities,
            (select count(*) from spideryarn.checkpoints c where c.article_id = a.id) as checkpoints,
            (select count(*) from spideryarn.ai_calls c where c.article_id = a.id) as ai_calls,
            (select count(*) from spideryarn.jobs j where j.slug = a.slug) as jobs,
            (select count(*) from spideryarn.ingest_events e
               where e.article_id = a.id or e.slug = a.slug) as reservations,
            (select count(*) from spideryarn.uploads u where u.slug = a.slug) as uploads_by_slug,
            ${readerRowsOf("a")} + ${shelfStateOf("a")} as reader_state,
            greatest(a.created_at, a.updated_at, a.last_opened_at,
              (select max(greatest(j.created_at, j.started_at, j.finished_at)) from spideryarn.jobs j where j.slug = a.slug),
              (select max(greatest(c.created_at, c.last_used_at)) from spideryarn.checkpoints c where c.article_id = a.id),
              (select max(greatest(c.created_at, c.started_at, c.finished_at)) from spideryarn.ai_calls c where c.article_id = a.id),
              (select max(u.minted_at) from spideryarn.uploads u where u.slug = a.slug),
              (select max(r.created_at) from spideryarn.article_revisions r where r.article_id = a.id),
              (select max(b.first_seen_at) from spideryarn.block_identities b where b.article_id = a.id)
            ) as newest,
            now() as now
          from spideryarn.articles a
          where a.current_revision_id is null
            and not exists (select 1 from spideryarn.article_revisions r
                            where r.article_id = a.id and (r.status not in ('draft', 'failed') or r.published_at is not null))
            ${opts.ownerId === undefined ? sql`` : sql`and a.owner_id = ${opts.ownerId}::uuid`}
          order by a.created_at, a.id`)
      ).rows as Row[];

      const candidates: Candidate[] = rows.map((row) => {
        const attached: Attached = {
          revisions: num(row.revisions),
          blockIdentities: num(row.block_identities),
          checkpoints: num(row.checkpoints),
          aiCalls: num(row.ai_calls),
          jobs: num(row.jobs),
          reservations: num(row.reservations),
          uploadsBySlug: num(row.uploads_by_slug),
          readerState: num(row.reader_state),
        };
        const newestActivity = when(row.newest);
        const ageMs = when(row.now).getTime() - newestActivity.getTime();
        const hold: HoldReason[] = [];
        if (attached.revisions > 0) hold.push("has-revisions");
        if (attached.jobs > 0) hold.push("has-jobs");
        if (attached.reservations > 0) hold.push("has-reservations");
        if (attached.readerState > 0) hold.push("has-reader-state");
        if (ageMs < quietDays * 86_400_000) hold.push("recent");
        return {
          articleId: String(row.id),
          shortId: row.short_id === null ? null : String(row.short_id),
          ownerId: String(row.owner_id),
          slug: String(row.slug),
          createdAt: when(row.created_at),
          newestActivity,
          attached,
          hold,
        };
      });
      const eligible = candidates.filter((c) => c.hold.length === 0);
      const proof = await proveEligible(tx, eligible.map((c) => c.articleId), quietDays);
      return {
        candidates,
        eligible,
        proof,
        proven: proofIsClean(proof, eligible.length),
        role: String(who?.role ?? "(unknown)"),
        quietDays,
      };
    },
    { accessMode: "read only" },
  );
}

const NOTHING_SEEN: EligibleProof = {
  seen: 0, published: 0, revisions: 0, jobs: 0, reservations: 0, readerState: 0, recent: 0,
};

export function proofIsClean(proof: EligibleProof, expected: number): boolean {
  return proof.seen === expected && proof.published === 0 && proof.revisions === 0 &&
    proof.jobs === 0 && proof.reservations === 0 && proof.readerState === 0 && proof.recent === 0;
}

/**
 * **The second query.** It shares the reader-table list with the first and
 * nothing else: no candidate predicate, its own spelling of the shelf settings,
 * and every clock the survey reads asked one by one with `exists` rather than
 * folded into one `greatest`. Disagreement is the only way agreement means
 * anything — docs/reusable/silent-success.md. **Independent in shape, the same
 * in what it protects**: GPT Sol's R4 found this one missing three clocks and
 * the high-power switch, and tests/never-published-tidy.test.ts § "the two
 * queries protect the same things" now sets each protected column alone and
 * asks both. It is also the check `refusalUnderTheLock` runs inside `destroy`.
 */
export async function proveEligible(
  tx: Pick<Tx, "execute">,
  ids: readonly string[],
  quietDays: number,
): Promise<EligibleProof> {
  if (ids.length === 0) return NOTHING_SEEN;
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const days = sql.raw(`interval '${Math.floor(quietDays)} days'`);
  const [row] = (
    await tx.execute(sql`
      select
        count(*)::int as seen,
        count(*) filter (where a.current_revision_id is not null
          or exists (select 1 from spideryarn.article_revisions r where r.article_id = a.id and r.status = 'published'))::int as published,
        count(*) filter (where exists (select 1 from spideryarn.article_revisions r where r.article_id = a.id))::int as revisions,
        count(*) filter (where exists (select 1 from spideryarn.jobs j where j.slug = a.slug))::int as jobs,
        count(*) filter (where exists (select 1 from spideryarn.ingest_events e where e.article_id = a.id or e.slug = a.slug))::int as reservations,
        count(*) filter (where ${readerRowsOf("a")} > 0
          or coalesce(a.title_override, a.purpose, a.share_token) is not null
          or num_nonnulls(a.archived_at, a.share_token_at, a.public_at, a.last_opened_at, a.high_power_since) > 0
          or a.visibility is distinct from 'private' or a.opens <> 0)::int as reader_state,
        count(*) filter (where a.created_at >= now() - ${days}
          or a.updated_at >= now() - ${days}
          or a.last_opened_at >= now() - ${days}
          or exists (select 1 from spideryarn.jobs j where j.slug = a.slug
                     and (j.created_at >= now() - ${days} or j.started_at >= now() - ${days} or j.finished_at >= now() - ${days}))
          or exists (select 1 from spideryarn.checkpoints c where c.article_id = a.id
                     and (c.created_at >= now() - ${days} or c.last_used_at >= now() - ${days}))
          or exists (select 1 from spideryarn.ai_calls c where c.article_id = a.id
                     and (c.created_at >= now() - ${days} or c.started_at >= now() - ${days} or c.finished_at >= now() - ${days}))
          or exists (select 1 from spideryarn.uploads u where u.slug = a.slug and u.minted_at >= now() - ${days})
          or exists (select 1 from spideryarn.article_revisions r where r.article_id = a.id and r.created_at >= now() - ${days})
          or exists (select 1 from spideryarn.block_identities b where b.article_id = a.id and b.first_seen_at >= now() - ${days}))::int as recent
      from spideryarn.articles a
      where a.id in (${list})`)
  ).rows as Row[];
  return {
    seen: num(row?.seen),
    published: num(row?.published),
    revisions: num(row?.revisions),
    jobs: num(row?.jobs),
    reservations: num(row?.reservations),
    readerState: num(row?.reader_state),
    recent: num(row?.recent),
  };
}

export class TidySafetyError extends Error {}

/** The ids in a pinned file: one uuid per line, `#` comments and blanks ignored. */
export function parseIdsFile(text: string): string[] {
  const ids = text
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter((line) => line !== "");
  const bad = ids.filter((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id));
  if (bad.length > 0) throw new TidySafetyError(`--ids: ${bad.length} line(s) are not article ids`);
  if (new Set(ids).size !== ids.length) throw new TidySafetyError("--ids: an id appears twice");
  return ids;
}

/**
 * Everything `--delete` checks before it opens a deleting transaction. Throws
 * `TidySafetyError` with the reason; returns the articles to destroy, in order.
 */
export function checkDeletion(survey: NeverPublishedSurvey, pinned: readonly string[]): Candidate[] {
  if (survey.quietDays < DEFAULT_QUIET_DAYS) {
    throw new TidySafetyError(`refusing: a survey at ${survey.quietDays} quiet days; deleting needs at least ${DEFAULT_QUIET_DAYS}`);
  }
  if (!survey.proven || !proofIsClean(survey.proof, survey.eligible.length)) {
    throw new TidySafetyError("refusing: the two queries disagree about the eligible set");
  }
  if (survey.eligible.length > MAX_PER_RUN) {
    throw new TidySafetyError(`refusing: ${survey.eligible.length} eligible is more than the cap of ${MAX_PER_RUN}`);
  }
  const eligible = new Set(survey.eligible.map((c) => c.articleId));
  const pin = new Set(pinned);
  const missing = [...pin].filter((id) => !eligible.has(id));
  const extra = [...eligible].filter((id) => !pin.has(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new TidySafetyError(
      `refusing: the eligible set is not the pinned list — ${missing.length} pinned id(s) not eligible ` +
        `(${missing.join(", ") || "none"}), ${extra.length} eligible id(s) not pinned (${extra.join(", ") || "none"})`,
    );
  }
  return [...survey.eligible];
}

/** What the backup file holds besides its header: one array per table, rows as `row_to_json` gave them. */
export interface BackupRows {
  readonly articles: Row[];
  readonly block_identities: Row[];
  readonly checkpoints: Row[];
  readonly ai_calls_unlinked: Row[];
  readonly uploads_left_with_a_stale_slug: Row[];
}

export interface Backup extends BackupRows {
  readonly written_at: string;
  readonly ids: string[];
}

/**
 * **Every row the delete removes, and the ids of every row it unlinks**, as
 * `row_to_json` gives them. One function for both readers — the backup, and the
 * comparison under the lock — so "the rows match the backup" is a comparison of
 * like with like.
 */
async function dumpRows(tx: Pick<Tx, "execute">, ids: readonly string[]): Promise<BackupRows> {
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = async (q: ReturnType<typeof sql>) => ((await tx.execute(q)).rows as Row[]).map((r) => r.j as Row);
  return {
    articles: await rows(sql`select row_to_json(t) as j from spideryarn.articles t where t.id in (${list}) order by t.id`),
    block_identities: await rows(sql`select row_to_json(t) as j from spideryarn.block_identities t where t.article_id in (${list}) order by t.article_id, t.block_id`),
    checkpoints: await rows(sql`select row_to_json(t) as j from spideryarn.checkpoints t where t.article_id in (${list}) order by t.article_id, t.namespace, t.key`),
    ai_calls_unlinked: await rows(sql`select json_build_object('id', t.id, 'article_id', t.article_id) as j from spideryarn.ai_calls t where t.article_id in (${list}) order by t.id`),
    uploads_left_with_a_stale_slug: await rows(sql`select json_build_object('id', u.id, 'article_id', a.id) as j from spideryarn.uploads u join spideryarn.articles a on a.slug = u.slug where a.id in (${list}) order by u.id`),
  };
}

/** The part of a backup that is about one article, in the backup's own order. */
function backupOf(backup: BackupRows, articleId: string): BackupRows {
  const mine = (key: string) => (r: Row) => r[key] === articleId;
  return {
    articles: backup.articles.filter(mine("id")),
    block_identities: backup.block_identities.filter(mine("article_id")),
    checkpoints: backup.checkpoints.filter(mine("article_id")),
    ai_calls_unlinked: backup.ai_calls_unlinked.filter(mine("article_id")),
    uploads_left_with_a_stale_slug: backup.uploads_left_with_a_stale_slug.filter(mine("article_id")),
  };
}

/**
 * **The backup: every row the delete removes, and the ids of every row it
 * unlinks**, read in one read-only transaction and written as one JSON file.
 * Restoring is inserting these back (articles, then block_identities and
 * checkpoints) and re-pointing `ai_calls.article_id`; the plan has the order.
 * Refuses a directory inside this repository, because the file holds content.
 * Returns the file and what it holds, read back from the file.
 */
export async function writeBackup(
  db: Db,
  ids: readonly string[],
  dir: string,
): Promise<{ file: string; backup: Backup }> {
  /* Lexically first, so a directory inside the repository is never even
     created; then by real path, once it exists, so a symlink from outside
     that points in is caught too (Sol's R7). */
  const repo = realpathSync(path.resolve(import.meta.dirname, ".."));
  const inside = (p: string) => p === repo || p.startsWith(repo + path.sep);
  const refuseInside = () => {
    throw new TidySafetyError("refusing: --backup-dir is inside the repository, and the backup holds content");
  };
  if (inside(path.resolve(dir))) refuseInside();
  mkdirSync(path.resolve(dir), { recursive: true, mode: 0o700 });
  const abs = realpathSync(path.resolve(dir));
  if (inside(abs)) refuseInside();

  const dump = await db.transaction(async (tx) => await dumpRows(tx, ids), { accessMode: "read only" });
  if (dump.articles.length !== ids.length) {
    throw new TidySafetyError(`refusing: the backup would hold ${dump.articles.length} article rows for ${ids.length} ids`);
  }
  const file = path.join(abs, `never-published-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ written_at: new Date().toISOString(), ids, ...dump }), { mode: 0o600, flag: "wx" });
  chmodSync(file, 0o600);

  /* **Verified from the disk, not from memory**: read back, parsed, and every
     table's count and every article id checked against what was read from the
     database. The copy the delete compares against under the lock is this
     one, the file. */
  if ((statSync(file).mode & 0o777) !== 0o600) throw new TidySafetyError(`refusing: ${file} is not 0600`);
  const backup = readBackup(file);
  const wrong = (Object.keys(dump) as (keyof BackupRows)[]).filter((k) => backup[k].length !== dump[k].length);
  const sameIds = [...ids].sort().join() === backup.articles.map((r) => String(r.id)).sort().join() &&
    [...ids].sort().join() === [...backup.ids].sort().join();
  if (wrong.length > 0 || !sameIds) {
    throw new TidySafetyError(`refusing: the backup read back from ${file} does not match what was written (${wrong.join(", ") || "article ids"})`);
  }
  return { file, backup };
}

/** A backup file, parsed, with its shape checked. Throws `TidySafetyError` on anything else. */
export function readBackup(file: string): Backup {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Backup>;
  const tables: (keyof BackupRows)[] = ["articles", "block_identities", "checkpoints", "ai_calls_unlinked", "uploads_left_with_a_stale_slug"];
  if (!Array.isArray(parsed.ids) || typeof parsed.written_at !== "string" || tables.some((t) => !Array.isArray(parsed[t]))) {
    throw new TidySafetyError(`refusing: ${file} is not a never-published backup`);
  }
  return parsed as Backup;
}

export interface Restored {
  readonly articles: number;
  readonly blockIdentities: number;
  readonly checkpoints: number;
  readonly aiCallsRelinked: number;
}

/**
 * **The undo**: the backed-up `articles`, `block_identities` and `checkpoints`
 * rows inserted back exactly as `row_to_json` wrote them
 * (`json_populate_recordset` over each table's own row type, so every column
 * comes back), and each unlinked `ai_calls` row pointed at its article again —
 * only where its `article_id` is still null. One transaction, and every count
 * must match the file or it all rolls back. Refuses if any article is already
 * there. The `uploads` rows were never changed, so there is nothing to put
 * back for them.
 *
 * Exercised on throwaway local data by tests/never-published-tidy.test.ts §
 * "restore". It has not been, and is not to be, run against production
 * except to undo this plan's delete, by somebody cleared to write there.
 */
export async function restoreBackup(db: Db, backup: Backup): Promise<Restored> {
  return await db.transaction(async (tx) => {
    const ids = backup.articles.map((r) => String(r.id));
    if (ids.length === 0) throw new TidySafetyError("refusing: the backup holds no articles");
    const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    const [present] = (await tx.execute(sql`select count(*)::int as n from spideryarn.articles where id in (${list})`)).rows as Row[];
    if (num(present?.n) > 0) throw new TidySafetyError(`refusing: ${num(present?.n)} of the backed-up articles are already there`);

    const put = async (table: "articles" | "block_identities" | "checkpoints", rows: Row[]) => {
      if (rows.length === 0) return 0;
      const done = await tx.execute(sql`
        insert into ${sql.raw(`spideryarn.${table}`)}
        select * from json_populate_recordset(null::${sql.raw(`spideryarn.${table}`)}, ${JSON.stringify(rows)}::json)`);
      if (done.rowCount !== rows.length) {
        throw new TidySafetyError(`refusing: ${table} put back ${done.rowCount} of ${rows.length}`);
      }
      return rows.length;
    };
    const restored = {
      articles: await put("articles", backup.articles),
      blockIdentities: await put("block_identities", backup.block_identities),
      checkpoints: await put("checkpoints", backup.checkpoints),
      aiCallsRelinked: 0,
    };
    if (backup.ai_calls_unlinked.length > 0) {
      const relinked = await tx.execute(sql`
        update spideryarn.ai_calls c set article_id = x.article_id
        from json_to_recordset(${JSON.stringify(backup.ai_calls_unlinked)}::json) as x(id uuid, article_id uuid)
        where c.id = x.id and c.article_id is null`);
      if (relinked.rowCount !== backup.ai_calls_unlinked.length) {
        throw new TidySafetyError(`refusing: ${relinked.rowCount} of ${backup.ai_calls_unlinked.length} ai_calls rows could be re-linked`);
      }
      restored.aiCallsRelinked = backup.ai_calls_unlinked.length;
    }
    return restored;
  });
}

export interface Destroyed {
  readonly articleId: string;
  readonly shortId: string | null;
  readonly attached: Attached;
}

export type DestroyFn = (slug: string, opts: DestroyOptions) => Promise<unknown>;

/**
 * **The decision, taken again where nothing can move** — inside `destroy`'s
 * transaction, after it holds the owner's billing row and the article row.
 * Returns why to refuse, or `undefined`.
 *
 * Three questions: is the slug still the article that was proved (the pinned
 * id, not a successor that took the name); does the full rule still admit it
 * (`proveEligible`, at READ COMMITTED, so it sees everything committed before
 * the locks were granted); and are the rows about to go exactly the rows the
 * backup holds. A title or purpose saved between the preliminary proof and the
 * lock is caught by the second; a checkpoint or model call written in that
 * window by the third. GPT Sol's R1.
 */
export async function refusalUnderTheLock(
  tx: Pick<Tx, "execute">,
  target: Candidate,
  lockedId: string,
  quietDays: number,
  backup: BackupRows,
): Promise<string | undefined> {
  if (lockedId !== target.articleId) return `its slug now names a different article (${lockedId})`;
  const proof = await proveEligible(tx, [target.articleId], quietDays);
  if (!proofIsClean(proof, 1)) return `it is no longer eligible (${JSON.stringify(proof)})`;
  const now = await dumpRows(tx, [target.articleId]);
  const then = backupOf(backup, target.articleId);
  const differ = (Object.keys(now) as (keyof BackupRows)[]).filter((k) => !isDeepStrictEqual(now[k], then[k]));
  if (differ.length > 0) {
    return `its rows are not the rows the backup holds (${differ.map((k) => `${k}: ${now[k].length} now, ${then[k].length} backed up`).join("; ")})`;
  }
  return undefined;
}

/**
 * One `destroy` per article, stopping at the first refusal. Each is re-proved
 * read-only first (a cheap early refusal), and then **decided again inside
 * `destroy`'s own transaction, under its locks** (`refusalUnderTheLock`), which
 * is the check that counts. `destroy` opens its transaction through `getDb()`,
 * so the caller must have aimed `getDb()` at the same database `db` reads (see
 * `main`).
 */
export async function destroyEach(
  db: Db,
  targets: readonly Candidate[],
  quietDays: number,
  backup: BackupRows,
  destroy: DestroyFn = (slug, opts) => pgShelfStore.destroy(slug, opts),
  onDestroyed: (d: Destroyed) => void = () => {},
): Promise<Destroyed[]> {
  const done: Destroyed[] = [];
  for (const c of targets) {
    const proof = await db.transaction(async (tx) => await proveEligible(tx, [c.articleId], quietDays), {
      accessMode: "read only",
    });
    if (!proofIsClean(proof, 1)) {
      throw new TidySafetyError(`refusing ${c.articleId}: it is no longer eligible; ${done.length} already deleted`);
    }
    /* The refusal is kept here as well as thrown: `pgShelfStore` is guarded
       (src/store/db-errors.ts), and what comes out of it is a scrubbed error,
       not ours. */
    let refusal: string | undefined;
    let checked = false;
    const beforeDelete: DestroyOptions["beforeDelete"] = async (tx, article) => {
      refusal = await refusalUnderTheLock(tx, c, article.id, quietDays, backup);
      if (refusal !== undefined) throw new TidySafetyError(refusal);
      checked = true;
    };
    try {
      await runAsOwner(c.ownerId as OwnerId, () => destroy(c.slug, { beforeDelete }));
    } catch (err) {
      if (refusal !== undefined) {
        throw new TidySafetyError(`refusing ${c.articleId} under the lock: ${refusal}; ${done.length} already deleted`);
      }
      throw err;
    }
    if (!checked) {
      /* A `destroy` that ignored the hook: the article is gone unchecked. Loud. */
      throw new TidySafetyError(`${c.articleId} was deleted without the check under the lock; stopping`);
    }
    const d = { articleId: c.articleId, shortId: c.shortId, attached: c.attached };
    done.push(d);
    onDestroyed(d);
  }
  return done;
}

const days = (ms: number) => `${Math.floor(ms / 86_400_000)}d`;

function printSurvey(survey: NeverPublishedSurvey, out: (line: string) => void): void {
  out(`Role:   ${survey.role}`);
  out(`Rule:   never published; no revision, job or reservation; no reader state; nothing moved for ${survey.quietDays} days`);
  out(`\nNever-published articles: ${survey.candidates.length}, eligible: ${survey.eligible.length}`);
  out("  article id                            short id     created     quiet  ids    ckpt  calls  uploads  held because");
  const now = Date.now();
  for (const c of survey.candidates) {
    const a = c.attached;
    out(
      `  ${c.articleId}  ${(c.shortId ?? "-").padEnd(11)}  ${c.createdAt.toISOString().slice(0, 10)}  ` +
        `${days(now - c.newestActivity.getTime()).padStart(5)}  ${String(a.blockIdentities).padStart(5)}  ` +
        `${String(a.checkpoints).padStart(4)}  ${String(a.aiCalls).padStart(5)}  ${String(a.uploadsBySlug).padStart(7)}  ` +
        `${c.hold.length === 0 ? "(eligible)" : c.hold.join(", ")}`,
    );
  }
  const sum = (k: keyof Attached) => survey.eligible.reduce((n, c) => n + c.attached[k], 0);
  out(
    `\nThe eligible ${survey.eligible.length} would delete: ${sum("blockIdentities")} block identities, ` +
      `${sum("checkpoints")} checkpoints, ${sum("revisions")} revisions, ${sum("jobs")} jobs (cascade / destroy);` +
      ` and unlink ${sum("aiCalls")} ai_calls (kept, article_id set null) and ${sum("uploadsBySlug")} uploads (kept, stale slug).`,
  );
  const p = survey.proof;
  out(`\nThe second query, over those ${survey.eligible.length} ids:`);
  out(`  found ${p.seen}; published ${p.published}; revisions ${p.revisions}; jobs ${p.jobs}; ` +
    `reservations ${p.reservations}; reader state ${p.readerState}; recent ${p.recent}`);
  out(survey.proven ? `✓ all ${p.seen} found, none protected` : "✗ the two queries disagree. Nothing should be deleted.");
}

/**
 * **What `main` reaches the world through**, so a test can run the real
 * orchestration — every refusal in its real order — against its own database
 * and a `destroy` it can watch. `realDeps` is what the command line gets.
 */
export interface MainDeps {
  /** Where `--prod` (or its absence) points: `draftBacklogTarget`. */
  readonly target: (prod: boolean) => { url: string | undefined; file: string };
  readonly connect: (url: string, doDelete: boolean) => { db: Db; end: () => Promise<void> };
  readonly readText: (file: string) => string;
  readonly writeBackup: typeof writeBackup;
  readonly destroy: DestroyFn;
  /** Aim `getDb()`, which `destroy` uses, at the target. */
  readonly aimStore: (url: string) => void;
  /** Tests only: one owner's rows, so a peer's can never join the set. */
  readonly ownerId?: string;
  readonly out: (line: string) => void;
}

export function realDeps(): MainDeps {
  return {
    target: draftBacklogTarget,
    connect: (url, doDelete) => {
      const pool = new Pool({
        connectionString: url,
        max: 1,
        ssl: sslDecisionFor(url).ssl,
        application_name: `spideryarn never-published-tidy (${doDelete ? "delete" : "dry run"})`,
      });
      return { db: drizzle(pool, { schema }), end: () => pool.end() };
    },
    readText: (file) => readFileSync(file, "utf8"),
    writeBackup,
    destroy: (slug, opts) => pgShelfStore.destroy(slug, opts),
    /* `destroy` reaches the database through `getDb()`, which reads
       `process.env.DATABASE_URL` after `loadEnvLocal()`. Load the file first,
       then assign, so `.env.local` cannot replace the target afterwards; nothing
       in this process has called `getDb()` yet, so its pool is built from this. */
    aimStore: (url) => {
      loadEnvLocal();
      process.env.DATABASE_URL = url;
    },
    out: (line) => console.log(line),
  };
}

/**
 * The command. Returns the exit code; throws `TidySafetyError` for every
 * refusal, so nothing is deleted after one.
 */
export async function main(args: readonly string[], deps: MainDeps = realDeps()): Promise<number> {
  const out = deps.out;
  const flag = (name: string) => args.includes(name);
  const value = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const known = new Set(["--prod", "--delete", "--ids", "--backup-dir", "--quiet-days", "--restore"]);
  const unknown = args.filter((arg, i) => arg.startsWith("--") ? !known.has(arg) : !["--ids", "--backup-dir", "--quiet-days", "--restore"].includes(args[i - 1] ?? ""));
  if (unknown.length > 0) {
    throw new TidySafetyError("Unknown arguments. This takes --prod, --delete, --ids <file>, --backup-dir <dir>, --quiet-days <n>, --restore <backup file>.");
  }
  const prod = flag("--prod");
  const doDelete = flag("--delete");
  const restoreFile = value("--restore");
  if (flag("--restore") && (!restoreFile || doDelete)) {
    throw new TidySafetyError("--restore takes one backup file, and not --delete as well.");
  }
  const quietDays = value("--quiet-days") === undefined ? DEFAULT_QUIET_DAYS : Number(value("--quiet-days"));
  if (!Number.isInteger(quietDays) || quietDays < 1) {
    throw new TidySafetyError("--quiet-days must be a whole number of days, at least 1.");
  }
  /* A shorter look is fine for a dry run; deleting is held to the reviewed
     rule. GPT Sol's R3. `checkDeletion` asks again of the survey itself. */
  if (doDelete && quietDays < DEFAULT_QUIET_DAYS) {
    throw new TidySafetyError(`refusing: --delete needs --quiet-days of at least ${DEFAULT_QUIET_DAYS} (the reviewed rule); it was ${quietDays}`);
  }

  /* `.env.prod` read directly with --prod, `.env.local` without; a shell
     `DATABASE_URL` aims nothing. The same resolution as draft-sweep-backlog. */
  const { url, file } = deps.target(prod);
  if (!url) {
    throw new TidySafetyError(prod ? "--prod needs a .env.prod with a DATABASE_URL." : "DATABASE_URL is not set in .env.local.");
  }
  out(`Target: ${withoutPassword(url) ?? "(a DATABASE_URL that is not a parsable URL)"}`);
  out(`Env:    ${file}`);
  out(`Mode:   ${restoreFile ? "RESTORE" : doDelete ? "DELETE" : "dry run (read-only transaction; see the header for --delete)"}`);
  /* **Production only when asked for by name.** Without this, a production URL
     pasted into `.env.local` is reached with no `--prod` on the command line
     at all. Before connecting. GPT Sol's R2. */
  if (!prod && !isLocalDatabaseUrl(url)) {
    throw new TidySafetyError(`refusing: ${file} points at a database that is not local, and --prod was not given`);
  }

  if (restoreFile) {
    /* Read and checked before connecting: a file that is not a backup is
       refused without touching the database. */
    const backup = readBackup(restoreFile);
    const { db, end } = deps.connect(url, true);
    try {
      const r = await restoreBackup(db, backup);
      out(`Restored from ${restoreFile}: ${r.articles} articles, ${r.blockIdentities} block identities, ` +
        `${r.checkpoints} checkpoints; ${r.aiCallsRelinked} ai_calls re-linked.`);
      return 0;
    } finally {
      await end();
    }
  }

  const { db, end } = deps.connect(url, doDelete);
  try {
    const surveyOpts = { quietDays, ...(deps.ownerId === undefined ? {} : { ownerId: deps.ownerId }) };
    const before = await surveyNeverPublished(db, surveyOpts);
    printSurvey(before, out);
    if (!before.proven) return 1;
    if (!doDelete) {
      out("\nNothing deleted.");
      return 0;
    }

    const idsFile = value("--ids");
    const backupDir = value("--backup-dir");
    if (!idsFile || !backupDir) {
      throw new TidySafetyError("--delete needs --ids <file> (the reviewed list) and --backup-dir <dir>");
    }
    const targets = checkDeletion(before, parseIdsFile(deps.readText(idsFile)));
    if (targets.length === 0) {
      out("\nNothing to delete.");
      return 0;
    }
    const { file: backupFile, backup } = await deps.writeBackup(db, targets.map((t) => t.articleId), backupDir);
    out(`\nBackup: ${backupFile} (0600; holds content — never commit it)`);

    deps.aimStore(url);

    out("\nDeleting, by pgShelfStore.destroy, one transaction each (counts as surveyed):");
    await destroyEach(db, targets, quietDays, backup, deps.destroy, (d) => {
      out(`    ${d.articleId}  ${(d.shortId ?? "-").padEnd(11)}  ${d.attached.blockIdentities} ids, ${d.attached.checkpoints} checkpoints`);
    });

    const after = await surveyNeverPublished(db, surveyOpts);
    const gone = targets.filter((t) => !after.candidates.some((c) => c.articleId === t.articleId));
    const unlinkedIds = backup.ai_calls_unlinked.map((r) => String(r.id));
    const kept = unlinkedIds.length === 0 ? 0 : num(((
      await db.execute(sql`select count(*)::int as n from spideryarn.ai_calls where article_id is null and id in (${sql.join(unlinkedIds.map((id) => sql`${id}::uuid`), sql`, `)})`)
    ).rows as Row[])[0]?.n);
    const unlinked = targets.reduce((n, t) => n + t.attached.aiCalls, 0);
    out(`  ${gone.length} of ${targets.length} gone; ${after.candidates.length} never-published left (${after.eligible.length} eligible)`);
    out(`  ai_calls kept with article_id null: ${kept} of ${unlinked}`);
    return gone.length !== targets.length || kept !== unlinked ? 1 : 0;
  } finally {
    await end();
  }
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    // Driver errors can carry query text and parameters.
    console.error(err instanceof TidySafetyError ? err.message :
      `Never-published tidy failed (${err instanceof Error ? err.name : typeof err}); any article listed above as deleted is deleted.`);
    process.exitCode = 1;
  } finally {
    const { closeDb } = await import("../src/db/client.js");
    await closeDb();
  }
}
