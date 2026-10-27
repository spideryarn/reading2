/**
 * **An article passing from one account to another** —
 * src/store/pg-article-transfer.ts and the routes under `/api/admin/articles`.
 * docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md § D2,
 * D4; Tests 1 and 3.
 *
 * What is pinned:
 *
 * - the move: the new owner reads it through `ownedSlug` and the old one gets
 *   a 404; it is private with no key; the old owner's state on the row is gone;
 * - **every reader-state kind**, seeded one row each, is deleted and counted,
 *   while what the article *is* and the history stay;
 * - the ledger rows are frozen at the visibility they had and unlinked, in the
 *   one statement the database's CHECK and trigger allow;
 * - each refusal changes nothing: stale owner, same owner, a live job, an
 *   unsettled slot, abstract only;
 * - **the classification scan**: every table in the database with an
 *   `article_id` or `starter_article_id`, or an owner and a slug, is in
 *   `ARTICLE_TABLES`, and the reader-state half of it is `READER_STATE`;
 * - the routes: 403 to anybody but the administrator, another reader's title
 *   and slug absent from the list, 409 on a stale `expectedFrom`, 400 on a
 *   non-uuid id or an unknown field, and an unconfirmed account refused.
 *
 * The Auth Admin API is replaced (as in tests/author-gifts.test.ts): no
 * network, and which accounts are confirmed is this file's to say.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({
  /** Ids the replaced Auth service says are live with a confirmed address. */
  confirmed: new Set<string>(),
  /** The account listing `/api/admin/articles` reads the addresses from. */
  accounts: [] as { id: string; email: string }[],
}));

vi.mock("../src/store/admin-accounts.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/admin-accounts.js")>();
  return {
    ...real,
    authAdminEndpoint: () => ({ url: "http://auth.invalid", key: "test-key" }),
    listAccounts: async () =>
      control.accounts.map((a) => ({
        id: a.id,
        email: a.email,
        createdAt: null,
        lastSignInAt: null,
        emailConfirmedAt: null,
        providers: [],
      })),
    confirmedAccountEmail: async (id: string) =>
      control.confirmed.has(id) ? { kind: "confirmed", email: `${id}@example.invalid` } : { kind: "unconfirmed" },
  };
});

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { READER_STATE, ownWordsIn, type AdminArticle, type ReaderStateTable } from "../src/admin-articles.js";
import type { Verifier } from "../src/auth.js";
import { getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import { handleApi } from "../src/routes.js";
import {
  ARTICLE_TABLES,
  READER_STATE_TABLES,
  previewTransfer,
  transferArticle,
  transferBetween,
} from "../src/store/pg-article-transfer.js";
import { pgShelfStore } from "../src/store/pg-shelf.js";
import { pgSkimBriefStore } from "../src/store/pg-skim-briefs.js";
import * as ownedArticle from "../src/store/pg.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/article-transfer.test.ts",
  tables: ["spideryarn.articles", "spideryarn.ingest_events", "spideryarn.link_summaries", "spideryarn.article_tags", "spideryarn.skim_briefs"],
  columns: [{ table: "spideryarn.articles", column: "skim_profile_notice_dismissed_for" }],
  keepPool: true,
  max: 4,
});

/* Minted per run under this file's own stem, so no other file sweeps them. */
const STEM = "0000a7f1-0000-4000-8000-";
const RUN = randomUUID().slice(0, 8);
const ADMIN = ADMIN_USER_ID_LOCAL;
/** The old owner. */
const ALICE = `${STEM}${randomUUID().slice(-12)}`;
/** The new owner. */
const BOB = `${STEM}${randomUUID().slice(-12)}`;
/** An account with no confirmed address. */
const CAROL = `${STEM}${randomUUID().slice(-12)}`;
const SLUG_STEM = "test-article-transfer-";

let keys = 0;
/** Twenty-two base64url characters, distinct, as `articles.share_token` wants. */
function nextKey(): string {
  keys += 1;
  return `ATRANSxKEYxxx${String(keys).padStart(9, "0")}`;
}

interface Seeded {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly block: string;
}

const seeded: string[] = [];

/** One published article with one block, private with no link unless told otherwise. */
async function seed(
  name: string,
  opts: { owner?: string; visibility?: "private" | "public"; linkOn?: boolean; processing?: "minimal" | "full" } = {},
): Promise<Seeded> {
  const id = randomUUID();
  const revision = randomUUID();
  const slug = `${SLUG_STEM}${name}-${RUN}`;
  const title = `The ${name} article`;
  const key = opts.linkOn ? nextKey() : null;
  const block = mintId();
  seeded.push(id);
  await pool.query(
    `insert into spideryarn.articles (id, owner_id, slug, short_id, visibility, public_at, share_token, share_token_at, processing)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      opts.owner ?? ALICE,
      slug,
      mintId(),
      opts.visibility ?? "private",
      opts.visibility === "public" ? new Date() : null,
      key,
      key === null ? null : new Date(),
      opts.processing ?? "full",
    ],
  );
  await pool.query(
    `insert into spideryarn.article_revisions
       (id, article_id, status, title, word_count, block_count, part_count, section_count)
     values ($1, $2, 'published', $3, 9, 1, 0, 0)`,
    [revision, id, title],
  );
  await pool.query("update spideryarn.articles set current_revision_id = $2 where id = $1", [id, revision]);
  await pool.query("insert into spideryarn.block_identities (article_id, block_id) values ($1, $2)", [id, block]);
  return { id, slug, title, block };
}

/**
 * **One row of every reader-state kind**, by hand, so a kind the transfer
 * forgot is a row left behind here. `READER_STATE` is the list; this is a
 * second, independent spelling of it on purpose, and the test below fails if
 * the two disagree on which kinds there are.
 */
async function seedReaderState(a: Seeded, owner: string): Promise<Set<ReaderStateTable>> {
  const thread = mintId();
  const message = mintId();
  const criterion = mintId();
  const q = (text: string, values: unknown[]) => pool.query(text, values);
  await q(
    `insert into spideryarn.referee_criteria (article_id, id, owner_id, kind, criterion, status)
     values ($1, $2, $3, 'single', 'Is it rigorous?', 'done')`,
    [a.id, criterion, owner],
  );
  await q(
    `insert into spideryarn.comments (article_id, id, owner_id, block_id, status, body, criterion_id)
     values ($1, $2, $3, $4, 'none', 'my own note', $5)`,
    [a.id, mintId(), owner, a.block, criterion],
  );
  await q(
    "insert into spideryarn.chat_threads (article_id, id, owner_id, title) values ($1, $2, $3, 'a chat')",
    [a.id, thread, owner],
  );
  await q(
    `insert into spideryarn.chat_messages (article_id, thread_id, id, ordinal, role, text, status)
     values ($1, $2, $3, 0, 'user', 'my question', 'done')`,
    [a.id, thread, message],
  );
  await q(
    `insert into spideryarn.chat_mentions (article_id, thread_id, message_id, position, mentioned_article_id, title)
     values ($1, $2, $3, 0, null, 'an article I brought in')`,
    [a.id, thread, message],
  );
  await q(
    `insert into spideryarn.quiz_attempts (article_id, batch_id, question_id, question, answer, reply)
     values ($1, 'b1', 'q1', 'What?', 'my answer', 'a reply')`,
    [a.id],
  );
  await q("insert into spideryarn.referee_promises (article_id, owner_id, status) values ($1, $2, 'done')", [a.id, owner]);
  await q(
    `insert into spideryarn.referee_hidden_checks (article_id, owner_id, judgments, unanswered, not_sent, model, finished_at)
     values ($1, $2, '[]', 0, 0, 'm', now())`,
    [a.id, owner],
  );
  await q(
    `insert into spideryarn.sources_claim_checks (article_id, id, owner_id, status, list_source_hash, prompt_version, targets)
     values ($1, $2, $3, 'error', 'h', 'v1', '[]')`,
    [a.id, mintId(), owner],
  );
  await q(
    "insert into spideryarn.search_runs (article_id, id, owner_id, criterion, status) values ($1, $2, $3, 'my search', 'done')",
    [a.id, mintId(), owner],
  );
  /* An added Skim brief, with a route, so a transfer is seen deleting the
     sentence and the route together (plan 261027d, Sol F1). */
  await q(
    `insert into spideryarn.skim_briefs (article_id, id, brief, skim, planned_at)
     values ($1, $2, 'my own skim brief', '{"stops":[]}'::jsonb, now())`,
    [a.id, mintId()],
  );
  await q("insert into spideryarn.article_tags (article_id, tag) values ($1, 'to-read')", [a.id]);
  await q("insert into spideryarn.glossary_hidden_entries (article_id, entry_id) values ($1, $2)", [a.id, mintId()]);
  await q(
    `insert into spideryarn.glossary_lookups (article_id, entry_id, owner_id, answer, searches, model, at, added_name)
     values ($1, $2, $3, 'an answer', 0, 'm', now(), 'my term')`,
    [a.id, mintId(), owner],
  );
  await q(
    `insert into spideryarn.citation_finds (article_id, entry_id, owner_id, url, host, model, found_at)
     values ($1, $2, $3, 'https://example.com/paper', 'example.com', 'm', now())`,
    [a.id, mintId(), owner],
  );
  await q(
    `insert into spideryarn.citation_investigations
       (article_id, entry_id, owner_id, answer, extracts_read, longest_extract_words, searches_from, model, context_hash, prompt_version, at)
     values ($1, $2, $3, 'an answer', 1, 10, 'title', 'm', 'h', 'v1', now())`,
    [a.id, mintId(), owner],
  );
  await q(
    `insert into spideryarn.citation_web_notes
       (article_id, entry_id, owner_id, identity, state, why, checked_at, model, prompt_version, validation_version)
     values ($1, $2, $3, 'i', 'none', 'none-picked', now(), 'm', 'p', 'v')`,
    [a.id, mintId(), owner],
  );
  await q("insert into spideryarn.reading_time (article_id, block_id, seconds) values ($1, $2, 42)", [a.id, a.block]);
  await q(
    "insert into spideryarn.stale_notice_dismissals (article_id, mode, dismissed_for) values ($1, 'glossary', array['x1'])",
    [a.id],
  );
  await q(
    `insert into spideryarn.command_suggestion_dismissals (article_id, read_from, dismissed)
     values ($1, '0123456789abcdef', array['0123456789abcdef'])`,
    [a.id],
  );
  await q(
    `insert into spideryarn.link_summaries
       (owner_id, article_id, target, status, summary, dest_hash, context_hash, profile_hash, prompt_version, model, expires_at, block_id)
     values ($1, $2, 'https://example.com/elsewhere', 'ready', 'a summary', 'd', 'c', 'p', 1, 'm', now() + interval '1 day', $3)`,
    [owner, a.id, a.block],
  );
  return new Set<ReaderStateTable>([
    "referee_criteria", "comments", "chat_threads", "skim_briefs", "chat_mentions", "chat_messages", "quiz_attempts", "referee_promises",
    "referee_hidden_checks", "sources_claim_checks", "search_runs", "article_tags", "glossary_hidden_entries",
    "glossary_lookups", "citation_finds", "citation_investigations", "citation_web_notes", "reading_time", "stale_notice_dismissals",
    "command_suggestion_dismissals", "link_summaries",
  ]);
}

async function countOn(table: ReaderStateTable, articleId: string): Promise<number> {
  const { rows } = await pool.query(`select count(*)::int as n from spideryarn.${table} where article_id = $1`, [articleId]);
  return (rows[0] as { n: number }).n;
}

async function articleRow(id: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query("select * from spideryarn.articles where id = $1", [id]);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`no article ${id}`);
  return row;
}

async function deleteArticle(id: string): Promise<void> {
  await pool.query("delete from spideryarn.comments where article_id = $1", [id]);
  await pool.query("delete from spideryarn.ai_calls where article_id = $1", [id]);
  await pool.query("update spideryarn.articles set current_revision_id = null where id = $1", [id]);
  await pool.query("delete from spideryarn.article_revisions where article_id = $1", [id]);
  await pool.query("delete from spideryarn.articles where id = $1", [id]);
}

async function sweep(): Promise<void> {
  const owners = [ALICE, BOB, CAROL];
  await pool.query("delete from spideryarn.jobs where slug like $1", [`${SLUG_STEM}%`]);
  await pool.query("delete from spideryarn.import_records where slug like $1", [`${SLUG_STEM}%`]);
  await pool.query("delete from spideryarn.article_visibility_changes where slug like $1", [`${SLUG_STEM}%`]);
  await pool.query("delete from spideryarn.article_share_link_events where slug like $1", [`${SLUG_STEM}%`]);
  for (const id of seeded.splice(0)) await deleteArticle(id);
  await pool.query("delete from spideryarn.ingest_events where owner_id = any($1::uuid[])", [owners]);
  await pool.query("delete from spideryarn.billing_accounts where owner_id = any($1::uuid[])", [owners]);
}

beforeAll(async () => {
  await sweep();
  await seedAuthUser(pool, { id: ALICE, email: `alice-article-transfer-${RUN}@example.invalid` });
  await seedAuthUser(pool, { id: BOB, email: `bob-article-transfer-${RUN}@example.invalid` });
  await seedAuthUser(pool, { id: CAROL, email: `carol-article-transfer-${RUN}@example.invalid` });
  control.confirmed = new Set([ALICE, BOB, ADMIN]);
  control.accounts = [
    { id: ALICE, email: "alice@example.invalid" },
    { id: BOB, email: "bob@example.invalid" },
    { id: ADMIN, email: "admin@example.invalid" },
  ];
});

afterEach(async () => {
  await sweep();
});

afterAll(async () => {
  await sweep();
  await pool.query("delete from auth.users where id = any($1::uuid[])", [[ALICE, BOB, CAROL]]).catch(() => {});
  await pool.end();
});

/** The shelf's read, as `owner` — the owner-scoped way in that every route uses. */
async function readsAs(owner: string, slug: string): Promise<"ok" | number> {
  try {
    await runAsOwner(owner as OwnerId, () => pgShelfStore.read(slug));
    return "ok";
  } catch (err) {
    return (err as { status?: number }).status ?? -1;
  }
}

/* --------------------------------------------------------------- the move -- */

describe("transferArticle — the move", () => {
  it.each(["list", "get"] as const)("does not leak the new owner's briefs when %s crosses a transfer", async (method) => {
    const a = await seed(`brief-${method}-transfer-race`);
    const original = ownedArticle.articleIdForOwned;
    const lookup = vi.spyOn(ownedArticle, "articleIdForOwned").mockImplementationOnce(async (...args) => {
      const id = await original(...args);
      /* Pause at the exact gap between authorising the article and reading
         its child rows. The new owner's private text must remain private. */
      await pool.query("update spideryarn.articles set owner_id = $2 where id = $1", [a.id, BOB]);
      await pool.query("insert into spideryarn.skim_briefs (article_id, id, brief) values ($1, $2, $3)",
        [a.id, "spya-race2a", "The new owner's private sentence"]);
      return id;
    });
    try {
      if (method === "list") {
        expect(await runAsOwner(ALICE as OwnerId, () => pgSkimBriefStore.list(a.slug))).toEqual([]);
      } else {
        await expect(runAsOwner(ALICE as OwnerId, () => pgSkimBriefStore.get(a.slug, "spya-race2a")))
          .rejects.toMatchObject({ status: 404 });
      }
      expect(lookup).toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
    }
  });

  it("refuses a brief create that waited behind an ownership transfer", async () => {
    const a = await seed("brief-create-transfer-race");
    const mover = await pool.connect();
    let writing: Promise<unknown> | undefined;
    let settled = false;
    try {
      await mover.query("begin");
      const pid = (await mover.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      await mover.query("update spideryarn.articles set owner_id = $2 where id = $1", [a.id, BOB]);
      /* The old owner still sees their committed ownership. Their write must
         wait, then recheck it, rather than insert after the transfer's cleanup. */
      writing = runAsOwner(ALICE as OwnerId, () =>
        pgSkimBriefStore.create(a.slug, "spya-race2a", "The old owner's private sentence"),
      ).then(
        (value) => { settled = true; return value; },
        (error: unknown) => { settled = true; return error; },
      );
      const deadline = Date.now() + 10_000;
      let blocked = false;
      while (!settled && Date.now() < deadline) {
        const waiting = await pool.query<{ blocked: boolean }>(
          "select exists (select 1 from pg_stat_activity where $1::integer = any(pg_blocking_pids(pid))) as blocked",
          [pid],
        );
        if (waiting.rows[0]?.blocked) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked, "the brief write actually waited for the article lock").toBe(true);
      await mover.query("commit");
      expect(await writing).toMatchObject({ status: 404 });
      const rows = await pool.query("select id from spideryarn.skim_briefs where article_id = $1", [a.id]);
      expect(rows.rows).toEqual([]);
    } finally {
      await mover.query("rollback");
      mover.release();
      await writing;
    }
  });

  it("re-owns the article, makes it private, resets the row and deletes every kind of the old owner's state", async () => {
    const a = await seed("full", { visibility: "public", linkOn: true });
    await pool.query(
      `update spideryarn.articles set purpose = 'why I read it', title_override = 'My title', archived_at = now(),
         opens = 3, last_opened_at = now(), skim_profile_notice_dismissed_for = 'k', skim_profile_notice_dismissed_at = now(),
         asked_url = 'https://example.com/?token=secret', high_power_since = now(), updated_at = now()
       where id = $1`,
      [a.id],
    );
    await pool.query(
      `update spideryarn.article_revisions
          set requested_url = 'https://alice:secret@example.com/private',
              final_url = 'https://example.com/piece?sig=ALICE_SECRET',
              raw_filename = 'alice-private-draft.pdf',
              illustrated = $2::jsonb
        where article_id = $1`,
      [
        a.id,
        JSON.stringify({
          version: "illustrated/test",
          note: "Alice's private direction",
          style: "A private direction copied into the painting",
          plates: [],
        }),
      ],
    );
    const kinds = await seedReaderState(a, ALICE);
    /* The seed and READER_STATE are two spellings of one list. */
    expect([...kinds].sort()).toEqual(READER_STATE.map((k) => k.table).sort());
    /* What the article is, and the history: both stay. */
    await pool.query(
      "insert into spideryarn.checkpoints (article_id, namespace, key, value) values ($1, 'pdf-chunk', 'k', '{}')",
      [a.id],
    );
    /* An Illustrated brief may repeat the old reader's steering note (round-2 R1): it goes. */
    await pool.query(
      "insert into spideryarn.checkpoints (article_id, namespace, key, value) values ($1, 'illustrated-brief', 'k', '{}')",
      [a.id],
    );
    await pool.query(
      `insert into spideryarn.jobs (id, owner_id, slug, steps, status, work_key) values ($1, $2, $3, '[]', 'done', 'w')`,
      [mintId(), ALICE, a.slug],
    );
    /* The old owner's charges: the ingest and the High-powered one. */
    await pool.query(
      "insert into spideryarn.ingest_events (owner_id, article_id, succeeded_at) values ($1, $2, now())",
      [ALICE, a.id],
    );
    await pool.query(
      `insert into spideryarn.ingest_events (owner_id, article_id, kind, reserved_at, succeeded_at)
       values ($1, $2, 'high_power', now(), now())`,
      [ALICE, a.id],
    );

    const preview = await previewTransfer(a.id);
    expect(preview).toMatchObject({ articleId: a.id, ownerId: ALICE, visibility: "public", privateLink: true, blocked: null });
    for (const kind of READER_STATE) expect(preview?.counts[kind.table], kind.table).toBe(1);
    expect(ownWordsIn(preview!.counts)).toBe(READER_STATE.filter((k) => k.ownWords).length);

    expect(await readsAs(ALICE, a.slug)).toBe("ok");
    expect(await readsAs(BOB, a.slug)).toBe(404);

    const answer = await transferBetween({ articleId: a.id, from: ALICE, to: BOB, actor: ADMIN });
    expect(answer).toMatchObject({ kind: "transferred", madePrivate: true, slug: a.slug });
    if (answer.kind !== "transferred") throw new Error("unreachable");
    for (const kind of READER_STATE) {
      expect(answer.deleted[kind.table], kind.table).toBe(1);
      expect(await countOn(kind.table, a.id), kind.table).toBe(0);
    }

    /* The new owner reads it as theirs; the old one gets the 404 everybody else does. */
    expect(await readsAs(BOB, a.slug)).toBe("ok");
    expect(await readsAs(ALICE, a.slug)).toBe(404);

    expect(await articleRow(a.id)).toMatchObject({
      owner_id: BOB,
      visibility: "private",
      public_at: null,
      share_token: null,
      share_token_at: null,
      purpose: null,
      title_override: null,
      archived_at: null,
      opens: 0,
      last_opened_at: null,
      skim_profile_notice_dismissed_for: null,
      skim_profile_notice_dismissed_at: null,
      asked_url: null,
      high_power_since: null,
      updated_at: null,
    });
    const { rows: revisions } = await pool.query(
      "select requested_url, final_url, raw_filename, illustrated from spideryarn.article_revisions where article_id = $1",
      [a.id],
    );
    expect(revisions).toEqual([{ requested_url: null, final_url: null, raw_filename: "document", illustrated: null }]);

    /* The ledger: unlinked and priced at what it was, public, in one statement. */
    const { rows: ledger } = await pool.query(
      "select kind, article_id, article_visibility_at_delete from spideryarn.ingest_events where owner_id = $1 order by kind",
      [ALICE],
    );
    expect(ledger).toEqual([
      { kind: "high_power", article_id: null, article_visibility_at_delete: "public" },
      { kind: "ingest", article_id: null, article_visibility_at_delete: "public" },
    ]);

    /* The takedown log says it was unshared, and by whom; the key is in neither. */
    const { rows: changes } = await pool.query(
      "select actor_owner_id, from_visibility, to_visibility, rights_confirmed from spideryarn.article_visibility_changes where article_id = $1",
      [a.id],
    );
    expect(changes).toEqual([{ actor_owner_id: ADMIN, from_visibility: "public", to_visibility: "private", rights_confirmed: false }]);
    const { rows: linkEvents } = await pool.query(
      "select actor_owner_id, event from spideryarn.article_share_link_events where article_id = $1",
      [a.id],
    );
    expect(linkEvents).toEqual([{ actor_owner_id: ADMIN, event: "turned-off" }]);

    /* What moves, moved; what is history, stayed the old owner's. */
    const { rows: blocks } = await pool.query("select count(*)::int as n from spideryarn.block_identities where article_id = $1", [a.id]);
    expect(blocks[0]).toEqual({ n: 1 });
    const { rows: checkpoints } = await pool.query("select count(*)::int as n from spideryarn.checkpoints where article_id = $1", [a.id]);
    expect(checkpoints[0]).toEqual({ n: 1 });
    const { rows: jobs } = await pool.query("select owner_id from spideryarn.jobs where slug = $1", [a.slug]);
    expect(jobs).toEqual([{ owner_id: ALICE }]);
  });

  it("writes no audit rows for an article that was already private with no link", async () => {
    const a = await seed("quiet");
    const answer = await transferBetween({ articleId: a.id, from: ALICE, to: BOB, actor: ADMIN });
    expect(answer).toMatchObject({ kind: "transferred", madePrivate: false });
    if (answer.kind !== "transferred") throw new Error("unreachable");
    expect(ownWordsIn(answer.deleted)).toBe(0);
    const { rows } = await pool.query(
      `select (select count(*)::int from spideryarn.article_visibility_changes where article_id = $1) as v,
              (select count(*)::int from spideryarn.article_share_link_events where article_id = $1) as l`,
      [a.id],
    );
    expect(rows[0]).toEqual({ v: 0, l: 0 });
  });

  it("keeps safe public provenance and an illustration that has no reader note", async () => {
    const a = await seed("safe-revision-state");
    const illustrated = {
      version: "illustrated/test",
      style: "A model-made painting",
      plates: [],
    };
    await pool.query(
      `update spideryarn.article_revisions
          set requested_url = 'https://example.com/original',
              final_url = 'https://www.example.org/final#section',
              illustrated = $2::jsonb
        where article_id = $1`,
      [a.id, JSON.stringify(illustrated)],
    );
    expect(await transferBetween({ articleId: a.id, from: ALICE, to: BOB, actor: ADMIN })).toMatchObject({
      kind: "transferred",
    });
    const { rows } = await pool.query(
      "select requested_url, final_url, illustrated from spideryarn.article_revisions where article_id = $1",
      [a.id],
    );
    expect(rows).toEqual([
      {
        requested_url: "https://example.com/original",
        final_url: "https://www.example.org/final",
        illustrated,
      },
    ]);
  });

  it("runs inside a caller's savepoint, as the voucher claim will (D3)", async () => {
    const a = await seed("savepoint");
    const answer = await getDb().transaction((tx) =>
      tx.transaction((sp) => transferArticle(sp, { articleId: a.id, from: ALICE, to: BOB, actor: BOB })),
    );
    expect(answer.kind).toBe("transferred");
    expect((await articleRow(a.id)).owner_id).toBe(BOB);
  });
});

/* -------------------------------------------------------------- refusals -- */

describe("transferArticle — refusals change nothing", () => {
  /** Each refusal must leave the row and its reader state exactly as they were. */
  async function unchanged(a: Seeded, act: () => Promise<unknown>): Promise<unknown> {
    await seedReaderState(a, ALICE);
    const before = await articleRow(a.id);
    const answer = await act();
    expect(await articleRow(a.id)).toEqual(before);
    for (const kind of READER_STATE) expect(await countOn(kind.table, a.id), kind.table).toBe(1);
    return answer;
  }

  it("refuses a stale owner, saying who has it now", async () => {
    const a = await seed("stale", { visibility: "public" });
    const answer = await unchanged(a, () => transferBetween({ articleId: a.id, from: BOB, to: CAROL, actor: ADMIN }));
    expect(answer).toEqual({ kind: "refused", reason: "stale", ownerId: ALICE });
  });

  it("refuses moving it to the owner it already has", async () => {
    const a = await seed("same");
    const answer = await unchanged(a, () => transferBetween({ articleId: a.id, from: ALICE, to: ALICE, actor: ADMIN }));
    expect(answer).toEqual({ kind: "refused", reason: "same-owner" });
  });

  it("refuses while a job is queued on its slug", async () => {
    const a = await seed("queued");
    await pool.query(
      `insert into spideryarn.jobs (id, owner_id, slug, steps, status, work_key) values ($1, $2, $3, '[]', 'queued', 'w')`,
      [mintId(), ALICE, a.slug],
    );
    expect((await previewTransfer(a.id))?.blocked).toBe("busy");
    const answer = await unchanged(a, () => transferBetween({ articleId: a.id, from: ALICE, to: BOB, actor: ADMIN }));
    expect(answer).toEqual({ kind: "refused", reason: "busy" });
  });

  it("refuses while a slot reserved on it is unsettled", async () => {
    const a = await seed("unsettled");
    await pool.query("insert into spideryarn.ingest_events (owner_id, article_id) values ($1, $2)", [ALICE, a.id]);
    const answer = await unchanged(a, () => transferBetween({ articleId: a.id, from: ALICE, to: BOB, actor: ADMIN }));
    expect(answer).toEqual({ kind: "refused", reason: "busy" });
    const { rows } = await pool.query("select article_id from spideryarn.ingest_events where owner_id = $1", [ALICE]);
    expect(rows).toEqual([{ article_id: a.id }]);
  });

  it("refuses an article with only its abstract read", async () => {
    const a = await seed("minimal", { processing: "minimal" });
    expect((await previewTransfer(a.id))?.blocked).toBe("minimal");
    const answer = await unchanged(a, () => transferBetween({ articleId: a.id, from: ALICE, to: BOB, actor: ADMIN }));
    expect(answer).toEqual({ kind: "refused", reason: "minimal" });
  });

  it("answers absent for an article that does not exist, and the preview null", async () => {
    const id = randomUUID();
    expect(await transferBetween({ articleId: id, from: ALICE, to: BOB, actor: ADMIN })).toEqual({ kind: "absent" });
    expect(await previewTransfer(id)).toBeNull();
  });
});

/* -------------------------------------------------------- classification -- */

describe("the classification map", () => {
  it("names every table that touches an article, and nothing that is not a table", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select distinct c.table_name
         from information_schema.columns c
         join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'spideryarn'
          and t.table_type = 'BASE TABLE'
          and (c.column_name in ('article_id', 'starter_article_id')
               or (c.column_name in ('slug', 'article_slug')
                   and exists (select 1 from information_schema.columns o
                                where o.table_schema = c.table_schema and o.table_name = c.table_name
                                  and o.column_name = 'owner_id')))`,
    );
    const live = new Set(rows.map((r) => r.table_name));
    /* The scan found the obvious ones, so it is not vacuously passing. */
    for (const known of ["comments", "jobs", "billing_vouchers", "ingest_events"]) expect(live.has(known), known).toBe(true);
    const unclassified = [...live].filter((t) => !(t in ARTICLE_TABLES)).sort();
    expect(unclassified, "a table touching an article that the transfer has not been told about").toEqual([]);

    const { rows: base } = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'spideryarn' and table_type = 'BASE TABLE'",
    );
    const tables = new Set(base.map((r) => r.table_name));
    const stale = Object.keys(ARTICLE_TABLES).filter((t) => !tables.has(t)).sort();
    expect(stale, "a name in ARTICLE_TABLES that is no table").toEqual([]);
  });

  it("deletes exactly the tables it classes as reader state", () => {
    const readerState = Object.entries(ARTICLE_TABLES)
      .filter(([, c]) => c === "reader-state")
      .map(([t]) => t)
      .sort();
    expect(READER_STATE.map((k) => k.table).sort()).toEqual(readerState);
    expect(Object.keys(READER_STATE_TABLES).sort()).toEqual(readerState);
  });
});

/* ----------------------------------------------------------------- routes -- */

describe("/api/admin/articles", () => {
  it("refuses every route to anybody but the administrator, and moves nothing", async () => {
    const a = await seed("gate");
    for (const [method, url, body] of [
      ["GET", "/api/admin/articles", null],
      ["GET", `/api/admin/articles/${a.id}/transfer`, null],
      ["POST", `/api/admin/articles/${a.id}/transfer`, { to: BOB, expectedFrom: ALICE }],
    ] as const) {
      expect((await drive(method, url, body, ALICE)).status, `${method} ${url}`).toBe(403);
    }
    expect((await articleRow(a.id)).owner_id).toBe(ALICE);
  });

  it("lists every article, with a title and slug only for the administrator's own and public ones", async () => {
    const theirs = await seed("private-theirs", { owner: ALICE });
    const open = await seed("public-theirs", { owner: BOB, visibility: "public" });
    const mine = await seed("mine", { owner: ADMIN });
    /* One known amount and one unknown amount, both tied by opaque id. This
       proves the list wires the aggregate onto another owner's private row;
       an assertion on a zero default alone would pass if every row were
       accidentally hard-coded to zero. */
    await pool.query(
      `insert into spideryarn.ai_calls
         (id, run_id, scope_kind, owner_id, article_id, article_slug, wire, purpose, requested_model,
          started_at, finished_at, duration_ms, outcome, provider_account, cost_source, credits_used_nanos, is_byok)
       values
         ($1, $2, 'request', $3, $4, $5, 'messages', 'chat', 'test/model', now(), now(), 1, 'ok', 'openrouter', 'provider', 420000000, false),
         ($6, $7, 'request', $3, $4, $5, 'messages', 'chat', 'test/model', now(), now(), 1, 'ok', 'openrouter', 'none', null, false)`,
      [randomUUID(), randomUUID(), ALICE, theirs.id, theirs.slug, randomUUID(), randomUUID()],
    );
    /* An import of the administrator's that never published (spya-zt7u0h). */
    const failed = await seed("mine-failed", { owner: ADMIN });
    await pool.query("update spideryarn.articles set current_revision_id = null where id = $1", [failed.id]);
    const reply = await drive("GET", "/api/admin/articles", null);
    expect(reply.status).toBe(200);
    expect(reply.headers["cache-control"]).toBe("private, no-store");
    expect(reply.body.emailsAvailable).toBe(true);
    const rows = reply.body.articles as AdminArticle[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(theirs.id)).toMatchObject({ ownerId: ALICE, ownerEmail: "alice@example.invalid", title: null, slug: null, mine: false, published: null });
    expect(byId.get(open.id)).toMatchObject({ ownerId: BOB, title: open.title, slug: open.slug, visibility: "public", published: true });
    expect(byId.get(mine.id)).toMatchObject({ mine: true, title: mine.title, slug: mine.slug, published: true });
    expect(byId.get(failed.id)).toMatchObject({ mine: true, title: null, slug: failed.slug, published: false });
    /* The other owner's private row carries money and counts, but still no
       title or slug; an article with no ledger rows gets the zero default. */
    expect(byId.get(theirs.id)?.cost).toEqual({ nanos: 420_000_000, calls: 2, unpricedCalls: 1 });
    expect(byId.get(open.id)?.cost).toEqual({ nanos: 0, calls: 0, unpricedCalls: 0 });
    /* Nowhere on the wire, not merely not in its field. */
    const text = JSON.stringify(reply.body);
    expect(text).not.toContain(theirs.title);
    expect(text).not.toContain(theirs.slug);
    /* Newest first. */
    const order = rows.map((r) => r.createdAt);
    expect([...order].sort().reverse()).toEqual(order);
  });

  it("previews a transfer, and refuses an id that is not a uuid or names nothing", async () => {
    const a = await seed("preview", { linkOn: true });
    const reply = await drive("GET", `/api/admin/articles/${a.id}/transfer`, null);
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ articleId: a.id, ownerId: ALICE, privateLink: true, blocked: null });
    expect(JSON.stringify(reply.body)).not.toContain("ATRANSxKEY");
    expect((await drive("GET", "/api/admin/articles/not-a-uuid/transfer", null)).status).toBe(400);
    expect((await drive("GET", `/api/admin/articles/${randomUUID()}/transfer`, null)).status).toBe(404);
  });

  it("transfers, and answers 409 to a stale expectedFrom, 400 to a bad id, body or account", async () => {
    const a = await seed("route");
    const path = `/api/admin/articles/${a.id}/transfer`;
    expect((await drive("POST", "/api/admin/articles/nope/transfer", { to: BOB, expectedFrom: ALICE })).status).toBe(400);
    expect((await drive("POST", path, { to: BOB, expectedFrom: ALICE, extra: 1 })).status).toBe(400);
    expect((await drive("POST", path, { to: "bob", expectedFrom: ALICE })).status).toBe(400);
    /* Live, but no confirmed address. */
    const carol = await drive("POST", path, { to: CAROL, expectedFrom: ALICE });
    expect(carol.status).toBe(400);
    expect(carol.body.error ?? carol.body.message).toMatch(/confirmed address/);
    const stale = await drive("POST", path, { to: BOB, expectedFrom: BOB });
    expect(stale.status).toBe(409);
    expect((await articleRow(a.id)).owner_id).toBe(ALICE);

    const done = await drive("POST", path, { to: BOB, expectedFrom: ALICE });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ articleId: a.id, from: ALICE, to: BOB, madePrivate: false });
    expect((await articleRow(a.id)).owner_id).toBe(BOB);
    /* And pressed again with the old owner: the owner has changed. */
    expect((await drive("POST", path, { to: BOB, expectedFrom: ALICE })).status).toBe(409);
  });
});

/* ---------------------------------------------------------------- driving -- */

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function signedInAs(owner: string): Verifier {
  return async () => ({ ok: true, claims: { sub: owner, email: `${owner}@example.invalid`, role: "authenticated" } });
}

/** Drive `handleApi`, as tests/author-gifts.test.ts does; the administrator unless told otherwise. */
async function drive(method: string, url: string, body: unknown, owner: string = ADMIN): Promise<Reply> {
  const raw = body === null ? "" : JSON.stringify(body);
  const req = Object.assign(
    (async function* () {
      if (raw) yield Buffer.from(raw);
    })(),
    { method, url, headers: { authorization: "Bearer test-token", "content-type": "application/json" } },
  ) as unknown as IncomingMessage;
  let status = 0;
  let text = "";
  const headers: Record<string, string> = {};
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, signedInAs(owner));
  return { status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {}, headers };
}
