/**
 * The event columns — stage 2 of
 * docs/plans/261003j-store-when-it-happened-timestamp-audit.md (G6–G16).
 *
 * None of them has a database default: the store writes each one, so each is
 * only as good as the write sites that name it. For every column this asks four
 * things of the real store functions and a real Postgres:
 *
 * 1. **The event stamps it.**
 * 2. **The neighbouring events do not** — an open is not an edit, a recolour is
 *    not a rewrite, a rename does not move the clock the panel sorts by.
 * 3. **A return to `pending` nulls every `finished_at`**: a new attempt has not
 *    finished, and a stale time under a spinner would say it had.
 * 4. **A finish that loses its fence stamps nothing.** Each `finished_at` is
 *    written inside the attempt-fenced update, and a stale attempt's late write
 *    changes neither the row nor its time.
 *
 * The columns are read straight out of SQL: no domain type carries them (stored,
 * not shown), so there is no mapping to read them through.
 *
 * Every id is minted per run (tests/fixture-ids.test.ts says why).
 */

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { TierRow } from "../src/billing/tiers.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, blockIdentities, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import { mintAttempt } from "../src/store/jobs.js";
import { switchOnHighPower } from "../src/store/pg-billing.js";
import { pgChatStore } from "../src/store/pg-chat.js";
import { pgCommentStore } from "../src/store/pg-comments.js";
import { pgHighPowerStore } from "../src/store/pg-high-power.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { pgLinkSummaryStore } from "../src/store/pg-link-summaries.js";
import { pgRefereeClaimsStore } from "../src/store/pg-referee-claims.js";
import { pgRefereeCriteriaStore } from "../src/store/pg-referee-criteria.js";
import { pgSearchStore } from "../src/store/pg-searches.js";
import { pgShelfStore } from "../src/store/pg-shelf.js";
import { pgVisibilityStore } from "../src/store/pg-visibility.js";
import type { Job } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/* `vi.hoisted`, because `vi.mock` is hoisted above the imports and its factory
   cannot close over a `const` declared down here. */
const { ADMIN } = vi.hoisted(() => ({ ADMIN: crypto.randomUUID() }));

/* `switchOnForAdmin` is the only way into pg-high-power.ts's "on" write, and it
   refuses anybody `isAdmin` does not know. The real list is two fixed uuids that
   belong to real accounts; this adds one minted here and changes nothing else. */
vi.mock("../src/admin.js", async (original) => {
  const actual = await original<typeof import("../src/admin.js")>();
  return { ...actual, isAdmin: (id: string | undefined | null) => id === ADMIN || actual.isAdmin(id) };
});

loadEnvLocal();

await pgReady({
  suite: "tests/event-times.test.ts",
  columns: [
    { table: "spideryarn.articles", column: "updated_at" },
    { table: "spideryarn.comments", column: "finished_at" },
    { table: "spideryarn.comments", column: "colour_at" },
    { table: "spideryarn.chat_messages", column: "finished_at" },
    { table: "spideryarn.chat_threads", column: "renamed_at" },
    { table: "spideryarn.search_runs", column: "finished_at" },
    { table: "spideryarn.search_runs", column: "colour_at" },
    { table: "spideryarn.referee_criteria", column: "finished_at" },
    { table: "spideryarn.referee_criteria", column: "colour_at" },
    { table: "spideryarn.referee_claims", column: "finished_at" },
    { table: "spideryarn.jobs", column: "cancel_requested_at" },
    { table: "spideryarn.link_summaries", column: "finished_at" },
  ],
});

const OWNER = randomUUID() as OwnerId;
const ADMIN_OWNER = ADMIN as OwnerId;
const STRANGER = randomUUID() as OwnerId;
const RUN = OWNER.slice(0, 8);

const ARTICLE_ID = randomUUID();
const REVISION_ID = randomUUID();
const SLUG = `event-times-${RUN}`;
/** A second article, so the High-powered AI cases start from a clean row. */
const POWER_ID = randomUUID();
const POWER_SLUG = `event-times-power-${RUN}`;
const ADMIN_ARTICLE_ID = randomUUID();
const ADMIN_SLUG = `event-times-admin-${RUN}`;
const BLOCK = mintId();

const NO_TIERS: readonly TierRow[] = [];
/** A time no clock in this file can produce, to prove a column was overwritten. */
const EARLIER = "2026-08-01T00:00:00.000Z";
const NONE: ReadonlySet<string> = new Set();
/** A grace window in the future, so every `pending` row is past it. */
const SWEEP_ALL = { keep: NONE, graceMs: -60_000 };

const mine = <T>(body: () => Promise<T>): Promise<T> => runAsOwner(OWNER, body);
const pause = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const startedAt = Date.now();

type Cells = Record<string, string | null>;

/**
 * Named columns of one row, timestamps as ISO. `to_jsonb` so that a timestamp,
 * a status and a number all come back as something `toEqual` can compare, and
 * so a whole row can be compared before and after a write that must not land.
 */
async function rowOf(table: string, where: ReturnType<typeof sql>): Promise<Record<string, unknown>> {
  const result = await getDb().execute(
    sql`select to_jsonb(t) as row from ${sql.raw(`spideryarn.${table}`)} t where ${where}`,
  );
  expect(result.rows, `${table}: exactly one row`).toHaveLength(1);
  return (result.rows[0] as { row: Record<string, unknown> }).row;
}

async function cells(table: string, where: ReturnType<typeof sql>, columns: string[]): Promise<Cells> {
  const row = await rowOf(table, where);
  const out: Cells = {};
  for (const column of columns) {
    expect(Object.keys(row), `${table} has no column ${column}`).toContain(column);
    const v = row[column];
    out[column] = v === null || v === undefined ? null : new Date(String(v)).toISOString();
  }
  return out;
}

/** A time the database has just written, give or take this suite's running time. */
function expectRecent(iso: string | null | undefined, what: string): void {
  expect(iso, `${what} was not stamped`).toEqual(expect.any(String));
  const t = new Date(iso ?? 0).getTime();
  expect(t, `${what} is older than this run`).toBeGreaterThan(startedAt - 60_000);
  expect(t, `${what} is in the future`).toBeLessThan(Date.now() + 60_000);
}

const articleWhere = (id: string) => sql`id = ${id}`;
const inArticle = (id: string) => sql`article_id = ${ARTICLE_ID} and id = ${id}`;

async function set(table: string, where: ReturnType<typeof sql>, assignment: ReturnType<typeof sql>) {
  await getDb().execute(sql`update ${sql.raw(`spideryarn.${table}`)} set ${assignment} where ${where}`);
}

beforeAll(async () => {
  const db = getDb();
  for (const [id, tag] of [
    [OWNER, "owner"],
    [ADMIN_OWNER, "admin"],
    [STRANGER, "stranger"],
  ] as const) {
    await seedAuthUser(db, { id, email: `event-times-${tag}-${id}@example.invalid` });
  }
  await db.insert(articles).values([
    { id: ARTICLE_ID, ownerId: OWNER, slug: SLUG },
    { id: POWER_ID, ownerId: OWNER, slug: POWER_SLUG },
    { id: ADMIN_ARTICLE_ID, ownerId: ADMIN_OWNER, slug: ADMIN_SLUG },
  ]);
  await db.insert(blockIdentities).values({ articleId: ARTICLE_ID, blockId: BLOCK });
  /* A published revision with a tree: `pgShelfStore.patch` answers with the
     shelf entry, and the shelf skips an article that has neither. */
  await db.insert(articleRevisions).values({
    id: REVISION_ID,
    articleId: ARTICLE_ID,
    status: "published",
    title: "Event times",
    fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
    tree: {
      version: "1",
      generator: "test",
      slug: SLUG,
      rootId: "n0",
      nodes: {
        n0: { id: "n0", depth: 0, parent: null, children: [], range: [BLOCK, BLOCK], title: "Root", gist: "A fixture." },
      },
    },
  });
  await db.insert(revisionBlocks).values({
    articleId: ARTICLE_ID,
    revisionId: REVISION_ID,
    blockId: BLOCK,
    ordinal: 0,
    tag: "p",
    kind: "text",
    html: "<p>Some words to put a note on.</p>",
    text: "Some words to put a note on.",
    words: 7,
    gistable: true,
  });
  await db.update(articles).set({ currentRevisionId: REVISION_ID }).where(eq(articles.id, ARTICLE_ID));
}, 60_000);

afterAll(async () => {
  const db = getDb();
  const owners = [OWNER, ADMIN_OWNER, STRANGER];
  await db.execute(sql`delete from spideryarn.jobs where slug = ${SLUG}`);
  for (const owner of owners) {
    await db.execute(sql`delete from spideryarn.ingest_events where owner_id = ${owner}`);
    await db.execute(sql`delete from spideryarn.article_visibility_changes where actor_owner_id = ${owner}`);
    await db.execute(sql`delete from spideryarn.articles where owner_id = ${owner}`);
    await db.execute(sql`delete from spideryarn.billing_accounts where owner_id = ${owner}`);
    await db.execute(sql`delete from auth.users where id = ${owner}`);
  }
  await closeDb();
});

/* -------------------------------------------------------------- articles -- */

describe("articles.updated_at", () => {
  const TIMES = ["updated_at", "archived_at", "last_opened_at", "public_at", "high_power_since", "created_at"];
  const read = (id = ARTICLE_ID) => cells("articles", articleWhere(id), TIMES);

  it("is stamped by a rename, a purpose edit, an archive and an un-archive", async () => {
    expect((await read()).updated_at).toBeNull();

    await mine(() => pgShelfStore.patch(SLUG, { title: "What I call it" }));
    const renamed = await read();
    expectRecent(renamed.updated_at, "updated_at after a rename");

    await pause();
    await mine(() => pgShelfStore.patch(SLUG, { purpose: "For the seminar." }));
    const purposed = await read();
    expect(Date.parse(purposed.updated_at ?? "")).toBeGreaterThan(Date.parse(renamed.updated_at ?? ""));

    await pause();
    await mine(() => pgShelfStore.patch(SLUG, { archived: true }));
    const archived = await read();
    expect(Date.parse(archived.updated_at ?? "")).toBeGreaterThan(Date.parse(purposed.updated_at ?? ""));
    expectRecent(archived.archived_at, "archived_at");

    await pause();
    await mine(() => pgShelfStore.patch(SLUG, { archived: false }));
    const back = await read();
    /* The reason the column exists: un-archiving leaves nothing else behind. */
    expect(back.archived_at).toBeNull();
    expect(Date.parse(back.updated_at ?? "")).toBeGreaterThan(Date.parse(archived.updated_at ?? ""));
    expect(back.created_at).toBe(renamed.created_at);
  });

  it("is not moved by an open or by a visibility change, which have their own times", async () => {
    await mine(() => pgShelfStore.patch(SLUG, { title: "Named before the open" }));
    const before = await read();

    await pause();
    await mine(() => pgShelfStore.recordOpen(SLUG));
    const opened = await read();
    expectRecent(opened.last_opened_at, "last_opened_at");
    expect(opened.updated_at).toBe(before.updated_at);

    await mine(() => pgVisibilityStore.set(SLUG, "public", true));
    const published = await read();
    expectRecent(published.public_at, "public_at");
    expect(published.updated_at).toBe(before.updated_at);
    await mine(() => pgVisibilityStore.set(SLUG, "private", true));
    expect((await read()).updated_at).toBe(before.updated_at);
  });

  it("is stamped when the charged switch turns High-powered AI on, and not when it is already on", async () => {
    expect((await read(POWER_ID)).updated_at).toBeNull();

    expect(await switchOnHighPower(OWNER, POWER_SLUG, NO_TIERS)).toMatchObject({ kind: "on" });
    const on = await read(POWER_ID);
    expectRecent(on.high_power_since, "high_power_since");
    expectRecent(on.updated_at, "updated_at after switching on");

    await pause();
    expect(await switchOnHighPower(OWNER, POWER_SLUG, NO_TIERS)).toMatchObject({ kind: "on" });
    expect(await read(POWER_ID), "a repeat of a switch already made moved a clock").toEqual(on);
  });

  it("is stamped when High-powered AI goes off, which keeps nothing else, and not by a second off", async () => {
    await set("articles", articleWhere(POWER_ID), sql`high_power_since = now(), updated_at = ${EARLIER}`);

    await mine(() => pgHighPowerStore.switchOff(POWER_SLUG));
    const off = await read(POWER_ID);
    expect(off.high_power_since).toBeNull();
    expectRecent(off.updated_at, "updated_at after switching off");

    await pause();
    await mine(() => pgHighPowerStore.switchOff(POWER_SLUG));
    expect(await read(POWER_ID), "switching off what is already off moved a clock").toEqual(off);
  });

  it("is stamped by the administrator's uncharged switch, and not when it is already on", async () => {
    expect((await read(ADMIN_ARTICLE_ID)).updated_at).toBeNull();

    await runAsOwner(ADMIN_OWNER, () => pgHighPowerStore.switchOnForAdmin(ADMIN_SLUG));
    const on = await read(ADMIN_ARTICLE_ID);
    expectRecent(on.high_power_since, "high_power_since");
    expectRecent(on.updated_at, "updated_at after the admin switch");

    await pause();
    await runAsOwner(ADMIN_OWNER, () => pgHighPowerStore.switchOnForAdmin(ADMIN_SLUG));
    expect(await read(ADMIN_ARTICLE_ID), "a repeat of a switch already made moved a clock").toEqual(on);
  });
});

/* -------------------------------------------------------------- comments -- */

describe("comments.finished_at and comments.colour_at", () => {
  const TIMES = ["finished_at", "colour_at", "updated_at", "created_at"];
  const read = (id: string) => cells("comments", inArticle(id), TIMES);

  /** A highlight the reader made, with no model call behind it. */
  async function highlight(): Promise<string> {
    const id = mintId();
    await mine(() => pgCommentStore.create(SLUG, { id, blockId: BLOCK, quote: "the words", start: 3 }));
    return id;
  }

  /** The same, asked about: `pending`, with the attempt that may answer it. */
  async function asked(): Promise<{ id: string; attempt: string }> {
    const id = await highlight();
    /* `beginAnswer` takes a terminal row, and no store method makes one from a
       free comment; a finished time is planted too, so the null below is a write. */
    await set("comments", inArticle(id), sql`status = 'error', error = 'fell over', finished_at = ${EARLIER}`);
    const { attempt } = await mine(() => pgCommentStore.beginAnswer(SLUG, id));
    if (attempt === undefined) throw new Error("beginAnswer handed back no attempt");
    return { id, attempt };
  }

  it("has no finished time on a comment nobody asked the model about", async () => {
    const id = await highlight();
    expect(await read(id)).toMatchObject({ finished_at: null, colour_at: null, updated_at: null });
  });

  it("is nulled when an answer begins, stamped when it lands, and nulled by the next attempt", async () => {
    const { id, attempt } = await asked();
    expect((await read(id)).finished_at, "a new attempt kept the last one's finish").toBeNull();

    await mine(() => pgCommentStore.patch(SLUG, id, { status: "done", answer: "An answer." }, attempt));
    const done = await read(id);
    expectRecent(done.finished_at, "finished_at after the answer landed");
    expect(done.updated_at, "an answer landing read as the reader editing their words").toBeNull();

    await mine(() => pgCommentStore.beginAnswer(SLUG, id));
    expect((await read(id)).finished_at, "Try again kept the last answer's finish").toBeNull();
  });

  it("is stamped when an attempt fails", async () => {
    const { id, attempt } = await asked();
    await mine(() => pgCommentStore.patch(SLUG, id, { status: "error", error: "no" }, attempt, { quiet: true }));
    expectRecent((await read(id)).finished_at, "finished_at after a failed answer");
  });

  it("is left alone, with the whole row, by a stale attempt's late answer", async () => {
    const { id } = await asked();
    const before = await rowOf("comments", inArticle(id));

    const stale = await mine(() =>
      pgCommentStore.patch(SLUG, id, { status: "done", answer: "Too late." }, randomUUID()),
    );
    expect(stale, "a write with the wrong attempt was accepted").toBeUndefined();
    const after = await rowOf("comments", inArticle(id));
    expect(after).toEqual(before);
    expect(after.finished_at).toBeNull();
  });

  it("is stamped by the sweep that declares an attempt abandoned", async () => {
    const { id } = await asked();
    await set("comments", inArticle(id), sql`lease_expires_at = clock_timestamp() - interval '1 second'`);
    await mine(() => pgCommentStore.sweepPending(SLUG, NONE));
    const swept = await rowOf("comments", inArticle(id));
    expect(swept.status).toBe("error");
    expectRecent((await read(id)).finished_at, "finished_at after the sweep");
  });

  it("times a recolour and a cleared colour, and neither touches updated_at", async () => {
    const id = await highlight();
    await mine(() => pgCommentStore.patchColour(SLUG, id, "yellow"));
    const coloured = await read(id);
    expectRecent(coloured.colour_at, "colour_at after a recolour");
    expect(coloured.updated_at, "a recolour read as an edit of the words").toBeNull();
    expect(coloured.finished_at).toBeNull();

    await pause();
    await mine(() => pgCommentStore.patchColour(SLUG, id, null));
    const cleared = await read(id);
    expect(Date.parse(cleared.colour_at ?? "")).toBeGreaterThan(Date.parse(coloured.colour_at ?? ""));
    expect(cleared.updated_at).toBeNull();
    expect(cleared.created_at).toBe(coloured.created_at);
  });

  it("does not time an edit of the words as a recolour", async () => {
    const id = await highlight();
    await mine(() => pgCommentStore.patchBody(SLUG, id, "My note."));
    const edited = await read(id);
    expectRecent(edited.updated_at, "updated_at after an edit");
    expect(edited.colour_at).toBeNull();
  });
});

/* ------------------------------------------------------------------ chat -- */

describe("chat_messages.finished_at and chat_threads.renamed_at", () => {
  const message = (threadId: string, id: string) =>
    sql`article_id = ${ARTICLE_ID} and thread_id = ${threadId} and id = ${id}`;
  const readMessage = (threadId: string, id: string) =>
    cells("chat_messages", message(threadId, id), ["finished_at", "created_at", "edited_at"]);
  const readThread = (threadId: string) =>
    cells("chat_threads", inArticle(threadId), ["renamed_at", "updated_at", "created_at"]);

  it("gives the question its own time and leaves the pending reply null", async () => {
    const threadId = mintId();
    const { user, reply } = await mine(() => pgChatStore.begin(SLUG, { threadId, question: "What is it?" }));
    const asked = await readMessage(threadId, user.id);
    expect(asked.finished_at, "a question is whole when it is written").toBe(asked.created_at);
    expect((await readMessage(threadId, reply.id)).finished_at).toBeNull();
  });

  it("is stamped when the reply finishes, nulled by a retry, and stamped again", async () => {
    const threadId = mintId();
    const first = await mine(() => pgChatStore.begin(SLUG, { threadId, question: "Why?" }));
    await mine(() =>
      pgChatStore.finish(SLUG, threadId, first.reply.id, { status: "error", error: "no" }, {
        attempt: first.attempt,
      }),
    );
    const failed = await readMessage(threadId, first.reply.id);
    expectRecent(failed.finished_at, "finished_at after a failed reply");

    const again = await mine(() => pgChatStore.retry(SLUG, threadId, first.reply.id));
    expect((await readMessage(threadId, first.reply.id)).finished_at, "a retry kept the last finish").toBeNull();

    await pause();
    await mine(() =>
      pgChatStore.finish(SLUG, threadId, first.reply.id, { status: "done", text: "Because." }, {
        attempt: again.attempt,
      }),
    );
    const done = await readMessage(threadId, first.reply.id);
    expectRecent(done.finished_at, "finished_at after the retried reply");
    expect(Date.parse(done.finished_at ?? "")).toBeGreaterThan(Date.parse(failed.finished_at ?? ""));
  });

  it("is left alone, with the whole message, by a stale attempt's late answer", async () => {
    const threadId = mintId();
    const { reply } = await mine(() => pgChatStore.begin(SLUG, { threadId, question: "When?" }));
    const before = await rowOf("chat_messages", message(threadId, reply.id));

    await mine(() =>
      pgChatStore.finish(SLUG, threadId, reply.id, { status: "done", text: "Too late." }, {
        attempt: randomUUID(),
      }),
    );
    const after = await rowOf("chat_messages", message(threadId, reply.id));
    expect(after).toEqual(before);
    expect(after.finished_at).toBeNull();
  });

  it("is stamped by the sweep that declares a reply abandoned", async () => {
    const threadId = mintId();
    const { reply } = await mine(() => pgChatStore.begin(SLUG, { threadId, question: "Who?" }));
    await mine(() => pgChatStore.sweepPending(SLUG, SWEEP_ALL));
    const swept = await rowOf("chat_messages", message(threadId, reply.id));
    expect(swept.status).toBe("error");
    expectRecent((await readMessage(threadId, reply.id)).finished_at, "finished_at after the sweep");
  });

  it("gives both halves of a spoken exchange the time they arrived, because they are born finished", async () => {
    const threadId = mintId();
    const at = "2026-09-01T10:00:00.000Z";
    const { user, reply } = await mine(() =>
      pgChatStore.appendSpoken(SLUG, { threadId, expectedTailId: null, question: "Said aloud?", answer: "Answered aloud." }, () => at),
    );
    expect((await readMessage(threadId, user.id)).finished_at).toBe(at);
    expect((await readMessage(threadId, reply.id)).finished_at).toBe(at);
  });

  it("leaves an edited question's time alone and starts its new reply null", async () => {
    const threadId = mintId();
    const first = await mine(() => pgChatStore.begin(SLUG, { threadId, question: "The first wording?" }));
    await mine(() =>
      pgChatStore.finish(SLUG, threadId, first.reply.id, { status: "done", text: "A." }, {
        attempt: first.attempt,
      }),
    );
    const before = await readMessage(threadId, first.user.id);

    const edited = await mine(() => pgChatStore.edit(SLUG, threadId, first.user.id, "The second wording?"));
    const after = await readMessage(threadId, first.user.id);
    expect(after.finished_at).toBe(before.finished_at);
    expect(after.edited_at).not.toBeNull();
    expect((await readMessage(threadId, edited.reply.id)).finished_at).toBeNull();
  });

  it("times a rename without moving the clock the panel sorts by", async () => {
    const threadId = mintId();
    await mine(() => pgChatStore.begin(SLUG, { threadId, question: "A thread to rename?" }));
    const before = await readThread(threadId);
    expect(before.renamed_at, "a thread was born renamed").toBeNull();

    await pause();
    await mine(() => pgChatStore.rename(SLUG, threadId, "My name for it"));
    const renamed = await readThread(threadId);
    expectRecent(renamed.renamed_at, "renamed_at");
    expect(renamed.updated_at, "a rename jumped the conversation up the list").toBe(before.updated_at);
    expect(renamed.created_at).toBe(before.created_at);
  });

  it("does not time a new turn as a rename", async () => {
    const threadId = mintId();
    await mine(() => pgChatStore.begin(SLUG, { threadId, question: "One?" }));
    await mine(() => pgChatStore.sweepPending(SLUG, SWEEP_ALL));
    await mine(() => pgChatStore.begin(SLUG, { threadId, question: "Two?" }));
    expect((await readThread(threadId)).renamed_at).toBeNull();
    await mine(() => pgChatStore.sweepPending(SLUG, SWEEP_ALL));
  });
});

/* -------------------------------------------------------------- searches -- */

describe("search_runs.finished_at and search_runs.colour_at", () => {
  const TIMES = ["finished_at", "colour_at", "created_at"];
  const read = (id: string) => cells("search_runs", inArticle(id), TIMES);

  it("is stamped when the hits land, and nulled when an errored run is retried", async () => {
    const criterion = `finish and retry ${mintId()}`;
    const { run, attempt } = await mine(() => pgSearchStore.begin(SLUG, criterion, "meaning"));
    expect((await read(run.id)).finished_at).toBeNull();

    await mine(() => pgSearchStore.finish(SLUG, run.id, { status: "error", error: "no" }, attempt));
    const failed = await read(run.id);
    expectRecent(failed.finished_at, "finished_at after a failed search");

    const again = await mine(() => pgSearchStore.begin(SLUG, criterion, "meaning", run.id));
    expect(again.run.id).toBe(run.id);
    const reset = await read(run.id);
    expect(reset.finished_at, "a retried search kept the failed attempt's finish").toBeNull();
    expect(reset.created_at, "a retry re-dated the question").toBe(failed.created_at);

    await mine(() => pgSearchStore.finish(SLUG, run.id, { status: "done", hits: [] }, again.attempt));
    expectRecent((await read(run.id)).finished_at, "finished_at after the hits landed");
  });

  it("is nulled when a quick search is revised in place", async () => {
    const { run, attempt } = await mine(() => pgSearchStore.begin(SLUG, `quick ${mintId()}`, "quick"));
    await mine(() => pgSearchStore.finish(SLUG, run.id, { status: "done", hits: [] }, attempt));
    expectRecent((await read(run.id)).finished_at, "finished_at after a quick search");

    const revised = await mine(() =>
      pgSearchStore.begin(SLUG, `quick revised ${mintId()}`, "quick", run.id, undefined, { revises: true }),
    );
    expect(revised.run.id).toBe(run.id);
    expect((await read(run.id)).finished_at, "a revised search kept the old answer's finish").toBeNull();
    await mine(() => pgSearchStore.finish(SLUG, run.id, { status: "done", hits: [] }, revised.attempt));
  });

  it("is left alone, with the whole run, by a stale attempt's late answer", async () => {
    const { run } = await mine(() => pgSearchStore.begin(SLUG, `stale ${mintId()}`, "meaning"));
    const before = await rowOf("search_runs", inArticle(run.id));

    await mine(() => pgSearchStore.finish(SLUG, run.id, { status: "done", hits: [] }, randomUUID()));
    const after = await rowOf("search_runs", inArticle(run.id));
    expect(after).toEqual(before);
    expect(after.finished_at).toBeNull();
    await mine(() => pgSearchStore.sweepPending(SLUG, SWEEP_ALL));
  });

  it("is stamped by the sweep that declares a run abandoned", async () => {
    const { run } = await mine(() => pgSearchStore.begin(SLUG, `swept ${mintId()}`, "meaning"));
    await mine(() => pgSearchStore.sweepPending(SLUG, SWEEP_ALL));
    expect((await rowOf("search_runs", inArticle(run.id))).status).toBe("error");
    expectRecent((await read(run.id)).finished_at, "finished_at after the sweep");
  });

  it("times a recolour and a cleared colour, and neither moves the other two clocks", async () => {
    const { run, attempt } = await mine(() => pgSearchStore.begin(SLUG, `colour ${mintId()}`, "meaning"));
    await mine(() => pgSearchStore.finish(SLUG, run.id, { status: "done", hits: [] }, attempt));
    const before = await read(run.id);
    expect(before.colour_at).toBeNull();

    await pause();
    await mine(() => pgSearchStore.recolour(SLUG, run.id, 2));
    const coloured = await read(run.id);
    expectRecent(coloured.colour_at, "colour_at after a recolour");
    expect(coloured).toMatchObject({ finished_at: before.finished_at, created_at: before.created_at });

    await pause();
    await mine(() => pgSearchStore.recolour(SLUG, run.id, null));
    const cleared = await read(run.id);
    expect(Date.parse(cleared.colour_at ?? "")).toBeGreaterThan(Date.parse(coloured.colour_at ?? ""));
    expect(cleared).toMatchObject({ finished_at: before.finished_at, created_at: before.created_at });
  });
});

/* ------------------------------------------------------ referee criteria -- */

describe("referee_criteria.finished_at and referee_criteria.colour_at", () => {
  const TIMES = ["finished_at", "colour_at", "created_at"];
  const read = (id: string) => cells("referee_criteria", inArticle(id), TIMES);
  const begin = (criterion: string, id?: string) =>
    mine(() => pgRefereeCriteriaStore.begin(SLUG, criterion, { kind: "single" }, id));

  it("is stamped when the results land, and nulled when an errored criterion is retried", async () => {
    const criterion = `Finish and retry ${mintId()}`;
    const { row, attempt } = await begin(criterion);
    expect(attempt).toEqual(expect.any(String));
    expect((await read(row.id)).finished_at).toBeNull();

    await mine(() => pgRefereeCriteriaStore.finish(SLUG, row.id, { status: "error", error: "no" }, attempt));
    const failed = await read(row.id);
    expectRecent(failed.finished_at, "finished_at after a failed criterion");

    const again = await begin(criterion, row.id);
    expect(again.row.id).toBe(row.id);
    expect((await read(row.id)).finished_at, "a retried criterion kept the failed finish").toBeNull();

    await mine(() =>
      pgRefereeCriteriaStore.finish(SLUG, row.id, { status: "done", results: [] }, again.attempt),
    );
    expectRecent((await read(row.id)).finished_at, "finished_at after the results landed");
  });

  it("is left alone, with the whole row, by a stale attempt's late answer", async () => {
    const { row } = await begin(`Stale ${mintId()}`);
    const before = await rowOf("referee_criteria", inArticle(row.id));

    await mine(() =>
      pgRefereeCriteriaStore.finish(SLUG, row.id, { status: "done", results: [] }, randomUUID()),
    );
    const after = await rowOf("referee_criteria", inArticle(row.id));
    expect(after).toEqual(before);
    expect(after.finished_at).toBeNull();
    await mine(() => pgRefereeCriteriaStore.sweepPending(SLUG, SWEEP_ALL));
  });

  it("is stamped by the sweep that declares a criterion abandoned", async () => {
    const { row } = await begin(`Swept ${mintId()}`);
    await mine(() => pgRefereeCriteriaStore.sweepPending(SLUG, SWEEP_ALL));
    expect((await rowOf("referee_criteria", inArticle(row.id))).status).toBe("error");
    expectRecent((await read(row.id)).finished_at, "finished_at after the sweep");
  });

  it("times a recolour and a cleared colour, and neither moves the other two clocks", async () => {
    const { row, attempt } = await begin(`Colour ${mintId()}`);
    await mine(() => pgRefereeCriteriaStore.finish(SLUG, row.id, { status: "done", results: [] }, attempt));
    const before = await read(row.id);
    expect(before.colour_at).toBeNull();

    await pause();
    await mine(() => pgRefereeCriteriaStore.recolour(SLUG, row.id, 3));
    const coloured = await read(row.id);
    expectRecent(coloured.colour_at, "colour_at after a recolour");
    expect(coloured).toMatchObject({ finished_at: before.finished_at, created_at: before.created_at });

    await pause();
    await mine(() => pgRefereeCriteriaStore.recolour(SLUG, row.id, null));
    const cleared = await read(row.id);
    expect(Date.parse(cleared.colour_at ?? "")).toBeGreaterThan(Date.parse(coloured.colour_at ?? ""));
    expect(cleared).toMatchObject({ finished_at: before.finished_at, created_at: before.created_at });
  });
});

/* -------------------------------------------------------- referee claims -- */

describe("referee_claims.finished_at", () => {
  const where = sql`article_id = ${ARTICLE_ID}`;
  const read = () => cells("referee_claims", where, ["finished_at", "created_at"]);
  const HASH = "event-times-source-hash";

  it("is stamped when the claims land, and nulled by the next run", async () => {
    const first = await mine(() => pgRefereeClaimsStore.begin(SLUG, HASH));
    expect((await read()).finished_at).toBeNull();

    await mine(() => pgRefereeClaimsStore.finish(SLUG, { status: "done", claims: [] }, first.attempt));
    expectRecent((await read()).finished_at, "finished_at after the claims landed");

    await mine(() => pgRefereeClaimsStore.begin(SLUG, HASH));
    expect((await read()).finished_at, "a re-run kept the last run's finish").toBeNull();
  });

  it("is left alone, with the whole run, by a stale attempt's late answer", async () => {
    await mine(() => pgRefereeClaimsStore.begin(SLUG, HASH));
    const before = await rowOf("referee_claims", where);

    const stale = await mine(() =>
      pgRefereeClaimsStore.finish(SLUG, { status: "done", claims: [] }, randomUUID()),
    );
    expect(stale).toBeNull();
    const after = await rowOf("referee_claims", where);
    expect(after).toEqual(before);
    expect(after.finished_at).toBeNull();
  });

  it("is stamped by the sweep that declares a run abandoned", async () => {
    /* The sweep's clock is `created_at`, so the run is begun an hour ago. */
    const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    await mine(() => pgRefereeClaimsStore.begin(SLUG, HASH, () => anHourAgo));
    expect((await read()).finished_at).toBeNull();

    const swept = await mine(() => pgRefereeClaimsStore.sweep(SLUG, false));
    expect(swept?.status).toBe("error");
    const after = await read();
    expectRecent(after.finished_at, "finished_at after the sweep");
    expect(after.created_at, "the sweep re-dated the run's start").toBe(anHourAgo);
  });
});

/* ------------------------------------------------------------------ jobs -- */

describe("jobs.cancel_requested_at", () => {
  const TIMES = ["cancel_requested_at", "finished_at", "created_at"];
  const read = (id: string) => cells("jobs", sql`id = ${id}`, TIMES);

  async function queued(): Promise<Job> {
    const wanted: Job = {
      id: mintId(),
      ownerId: OWNER,
      slug: SLUG,
      status: "queued",
      createdAt: new Date().toISOString(),
      steps: [{ name: "glossary", label: "Finding the terms", status: "pending" }],
    };
    const { job } = await mine(() =>
      pgJobStore.enqueueOrGet(wanted, { workKey: `event-times-${wanted.id}`, reservesName: false }),
    );
    expect(job.id).toBe(wanted.id);
    return job;
  }

  it("is stamped when Stop ends a queued job on the spot", async () => {
    const job = await queued();
    expect((await read(job.id)).cancel_requested_at).toBeNull();

    const stopped = await mine(() => pgJobStore.requestCancel(job.id, OWNER));
    expect(stopped?.status).toBe("cancelled");
    const after = await read(job.id);
    expectRecent(after.cancel_requested_at, "cancel_requested_at on a queued job");
    expectRecent(after.finished_at, "finished_at on a job Stop ended");
  });

  it("is stamped when Stop only asks a live claimant, which has not finished", async () => {
    const job = await queued();
    await mine(() => pgJobStore.claim(job.id, OWNER, mintAttempt(), 600_000, 1_000));
    expect((await rowOf("jobs", sql`id = ${job.id}`)).status, "the fixture job was not claimed").toBe("running");

    const asked = await mine(() => pgJobStore.requestCancel(job.id, OWNER));
    expect(asked?.status).toBe("running");
    expect(asked?.cancelling).toBe(true);
    const after = await read(job.id);
    expectRecent(after.cancel_requested_at, "cancel_requested_at on a running job");
    expect(after.finished_at, "asking is not ending").toBeNull();
  });

  it("is not written by a refused request: somebody else's job, or one already over", async () => {
    const job = await queued();
    expect(await runAsOwner(STRANGER, () => pgJobStore.requestCancel(job.id, STRANGER))).toBeUndefined();
    expect((await read(job.id)).cancel_requested_at, "a stranger's Stop was recorded").toBeNull();

    await mine(() => pgJobStore.requestCancel(job.id, OWNER));
    const stopped = await rowOf("jobs", sql`id = ${job.id}`);
    expect(stopped.status).toBe("cancelled");

    await pause();
    expect(await mine(() => pgJobStore.requestCancel(job.id, OWNER))).toBeUndefined();
    expect(await rowOf("jobs", sql`id = ${job.id}`), "a Stop on a finished job changed it").toEqual(stopped);
  });
});

/* -------------------------------------------------------- link summaries -- */

describe("link_summaries.finished_at", () => {
  const INPUTS = {
    destHash: "dddddddddddddddd",
    contextHash: "cccccccccccccccc",
    profileHash: "pppppppppppppppp",
    promptVersion: 1,
    model: "a-model",
  };
  const LEASE_MS = 40_000;
  const later = () => new Date(Date.now() + 14 * 24 * 3600 * 1000);
  const keyFor = (target: string) => ({ slug: SLUG, target, blockId: BLOCK });
  const where = (target: string) => sql`article_id = ${ARTICLE_ID} and target = ${target}`;
  const read = (target: string) => cells("link_summaries", where(target), ["finished_at", "created_at"]);

  async function claimed(target: string, inputs = INPUTS): Promise<string> {
    const claim = await mine(() => pgLinkSummaryStore.claim(keyFor(target), inputs, LEASE_MS));
    if (claim.kind !== "claimed") throw new Error(`expected to win the claim, got ${claim.kind}`);
    return claim.claimId;
  }

  it("is null on a claim, stamped when the answer lands, and nulled by a reclaim", async () => {
    const target = `https://destination.example/${mintId()}`;
    const claimId = await claimed(target);
    expect((await read(target)).finished_at).toBeNull();

    await pause();
    expect(await mine(() => pgLinkSummaryStore.fill(keyFor(target), claimId, "The answer.", later()))).toBe(true);
    const filled = await read(target);
    expectRecent(filled.finished_at, "finished_at after the summary landed");
    expect(Date.parse(filled.finished_at ?? ""), "the answer landed before it was asked for").toBeGreaterThan(
      Date.parse(filled.created_at ?? ""),
    );

    /* The reader's profile changed: the ready row is stale and is claimed over. */
    await claimed(target, { ...INPUTS, profileHash: "qqqqqqqqqqqqqqqq" });
    expect((await read(target)).finished_at, "a reclaim kept the stale answer's finish").toBeNull();
  });

  it("is left alone, with the answer, by a claimant that lost its claim", async () => {
    const target = `https://destination.example/${mintId()}`;
    const stalled = await claimed(target);
    await set("link_summaries", where(target), sql`expires_at = now() - interval '1 second'`);
    const successor = await claimed(target);
    await mine(() => pgLinkSummaryStore.fill(keyFor(target), successor, "The current answer.", later()));
    const before = await rowOf("link_summaries", where(target));
    expect(before.finished_at).not.toBeNull();

    await pause();
    expect(await mine(() => pgLinkSummaryStore.fill(keyFor(target), stalled, "The stale answer.", later()))).toBe(false);
    expect(await rowOf("link_summaries", where(target))).toEqual(before);
  });

  it("is left null by a stale fill on a row still being generated", async () => {
    const target = `https://destination.example/${mintId()}`;
    await claimed(target);
    const before = await rowOf("link_summaries", where(target));
    expect(await mine(() => pgLinkSummaryStore.fill(keyFor(target), randomUUID(), "Not mine.", later()))).toBe(false);
    const after = await rowOf("link_summaries", where(target));
    expect(after).toEqual(before);
    expect(after.finished_at).toBeNull();
  });
});
