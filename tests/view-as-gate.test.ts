/**
 * **The administrator viewing the app as another reader, read-only** —
 * `serveViewingAs` and its allowlist in src/routes.ts, the marker in
 * src/view-as-scope.ts, the backstops it arms, and the read-only pool in
 * src/db/client.ts. docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md
 * § Part 3, with GPT Sol's two plan reviews.
 *
 * What is pinned:
 *
 * - **no header, nothing changes**: the same request without the header is
 *   served as the caller, with no view-as headers on it;
 * - **every refusal**, and that each runs nothing: a caller who is not the
 *   administrator, an ended, expired, unknown or other actor's nonce, a reader
 *   who is an administrator, and every route not on the list — a write, an
 *   unknown path, an admin route and each unlisted GET;
 * - **an allowlisted GET answers with the reader's data**, `private, no-store`
 *   and `Vary` forced — over a handler's own `immutable` too;
 * - **the list itself**, row by row, and that no admin or non-GET row is on it;
 * - **each backstop** refuses from inside a view-as handler, with a positive
 *   control outside it so the test can fail; the database one proves Postgres
 *   itself refused and nothing was written, including the multi-statement,
 *   `set transaction read write` and savepoint escapes Sol's round 2 named;
 * - **sweeps and the jobs settle** do not run while viewing as, and do run
 *   otherwise;
 * - the outer owner after a view-as handler is still the administrator.
 *
 * The Auth Admin API is replaced, as in tests/article-transfer.test.ts: no
 * network, and which accounts exist is this file's to say.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({
  /** Ids the replaced Auth service knows, with their addresses. */
  accounts: new Map<string, string>(),
  noteArrival: vi.fn(async () => {}),
}));

vi.mock("../src/arrivals.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/arrivals.js")>();
  return { ...real, noteArrival: control.noteArrival };
});

vi.mock("../src/store/admin-accounts.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/admin-accounts.js")>();
  return {
    ...real,
    accountEmail: async (id: string) => {
      const email = control.accounts.get(id);
      return email
        ? { kind: "found", email }
        : { kind: "unavailable", reason: "the Auth service answered 404" };
    },
  };
});

import { ADMIN_USER_ID_LOCAL, ADMIN_USER_ID_PROD } from "../src/admin.js";
import { afterResponse } from "../src/after-response.js";
import { beginSpend, collectSpend } from "../src/ai-spend.js";
import type { Verifier } from "../src/auth.js";
import { closeDb, getDb } from "../src/db/client.js";
import { sendEmail } from "../src/email.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { enqueue, listJobs } from "../src/jobs.js";
import { currentOwnerId, type OwnerId, runAsOwner, runInRequest, setRequestOwner } from "../src/owner.js";
import {
  type AuthRoute,
  dispatchAuthRoute,
  handleApi,
  pinViewAsHeaders,
  viewAsRouteInventory,
} from "../src/routes.js";
import { fsBlobs } from "../src/store/blobs-fs.js";
import { supabaseBlobs } from "../src/store/blobs-supabase.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { pgViewAsStore } from "../src/store/pg-view-as.js";
import { VIEW_AS_HEADER, VIEW_AS_READ_ONLY_MESSAGE } from "../src/types.js";
import { RefusedWhileViewingAs, runViewingAs, type ViewingAs, viewingAs } from "../src/view-as-scope.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/view-as-gate.test.ts",
  tables: ["spideryarn.view_as_sessions", "spideryarn.articles", "spideryarn.search_runs"],
  keepPool: true,
  max: 2,
});

/* Minted per run under this file's own stem, so no other file sweeps them. */
const STEM = "0000ea5a-0000-4000-8000-";
const RUN = randomUUID().slice(0, 8);
const ADMIN = ADMIN_USER_ID_LOCAL as OwnerId;
/** The reader the administrator views. */
const ALICE = `${STEM}${randomUUID().slice(-12)}` as OwnerId;
/** Somebody else: the actor of a session that is not the administrator's. */
const BOB = `${STEM}${randomUUID().slice(-12)}` as OwnerId;
/** The production administrator's id, seeded into this private clone only, as a reader an admin cannot view. */
const OTHER_ADMIN = ADMIN_USER_ID_PROD as OwnerId;

const SLUG_STEM = "test-view-as-";
const seededArticles: string[] = [];

/** One published article with one block, owned by `owner`. */
async function seedArticle(name: string, owner: string): Promise<{ id: string; slug: string }> {
  const id = randomUUID();
  const revision = randomUUID();
  const slug = `${SLUG_STEM}${name}-${RUN}`;
  seededArticles.push(id);
  await pool.query(
    `insert into spideryarn.articles (id, owner_id, slug, short_id, visibility, processing)
     values ($1, $2, $3, $4, 'private', 'full')`,
    [id, owner, slug, mintId()],
  );
  await pool.query(
    `insert into spideryarn.article_revisions
       (id, article_id, status, title, word_count, block_count, part_count, section_count)
     values ($1, $2, 'published', $3, 9, 1, 0, 0)`,
    [revision, id, `The ${name} article`],
  );
  await pool.query("update spideryarn.articles set current_revision_id = $2 where id = $1", [id, revision]);
  await pool.query("insert into spideryarn.block_identities (article_id, block_id) values ($1, $2)", [id, mintId()]);
  return { id, slug };
}

let alicesArticle: { id: string; slug: string };
let adminsArticle: { id: string; slug: string };

beforeAll(async () => {
  await seedAuthUser(pool, { id: ALICE, email: `alice-view-as-${RUN}@example.invalid` });
  await seedAuthUser(pool, { id: BOB, email: `bob-view-as-${RUN}@example.invalid` });
  await seedAuthUser(pool, {
    id: OTHER_ADMIN,
    email: `other-admin-view-as-${RUN}@example.invalid`,
    onConflictDoNothing: true,
  });
  control.accounts.set(ALICE, "alice@example.invalid");
  control.accounts.set(BOB, "bob@example.invalid");
  alicesArticle = await seedArticle("alice", ALICE);
  adminsArticle = await seedArticle("admin", ADMIN);
  /* One finished search each: the owner-scoped read the gate tests ask for. */
  for (const [article, owner, criterion] of [
    [alicesArticle.id, ALICE, "alice's search"],
    [adminsArticle.id, ADMIN, "the admin's search"],
  ]) {
    await pool.query(
      "insert into spideryarn.search_runs (article_id, id, owner_id, criterion, status) values ($1, $2, $3, $4, 'done')",
      [article, mintId(), owner, criterion],
    );
  }
});

/** The criteria of a search list's runs. */
function criteria(reply: Reply): string[] {
  return ((reply.body?.runs ?? []) as { criterion: string }[]).map((r) => r.criterion).sort();
}

afterAll(async () => {
  await pool.query("delete from spideryarn.articles where id = any($1::uuid[])", [seededArticles]).catch(() => {});
  await pool.query("delete from auth.users where id = any($1::uuid[])", [[ALICE, BOB, OTHER_ADMIN]]).catch(() => {});
  await pool.end();
  await closeDb();
});

/* ------------------------------------------------------------- driving it */

function signedInAs(owner: string): Verifier {
  return async () => ({ ok: true, claims: { sub: owner, email: `${owner}@example.invalid`, role: "authenticated" } });
}

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: { error?: string; [key: string]: unknown } | null;
}

/** Drive `handleApi`; the administrator unless told otherwise, with the view-as header when given a nonce. */
async function drive(
  method: string,
  url: string,
  opts: { owner?: string; nonce?: string; body?: unknown } = {},
): Promise<Reply> {
  const raw = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const headers: Record<string, string> = { authorization: "Bearer test-token", "content-type": "application/json" };
  if (opts.nonce !== undefined) headers[VIEW_AS_HEADER] = opts.nonce;
  const req = Object.assign(
    (async function* () {
      if (raw) yield Buffer.from(raw);
    })(),
    { method, url, headers },
  ) as unknown as IncomingMessage;
  let status = 0;
  let text = "";
  const sent: Record<string, string> = {};
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    headersSent: false,
    setHeader(name: string, value: string) {
      sent[name.toLowerCase()] = String(value);
      return res;
    },
    end(chunk?: string | Buffer) {
      text = typeof chunk === "string" ? chunk : chunk ? chunk.toString("utf8") : "";
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, signedInAs(opts.owner ?? ADMIN));
  let body: Reply["body"] = null;
  try {
    body = text ? (JSON.parse(text) as Reply["body"]) : null;
  } catch {
    body = null;
  }
  return { status, headers: sent, body };
}

/** A live session of the administrator's, on Alice, straight from the store. */
async function startOnAlice(): Promise<string> {
  return (await pgViewAsStore.start(ADMIN, ALICE, "view-as-gate test")).nonce;
}

/** A session row written by hand, for the states the store will not make. */
async function sessionRow(opts: { actor: string; subject: string; expired?: boolean; ended?: boolean }): Promise<string> {
  const nonce = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(nonce, "utf8").digest("hex");
  await pool.query(
    `insert into spideryarn.view_as_sessions (nonce_hash, actor_id, subject_id, reason, started_at, expires_at, ended_at)
     values ($1, $2, $3, 'view-as-gate test', now() - interval '1 hour',
             case when $4::boolean then now() - interval '1 minute' else now() + interval '30 minutes' end,
             case when $5::boolean then now() else null end)`,
    [hash, opts.actor, opts.subject, opts.expired ?? false, opts.ended ?? false],
  );
  return nonce;
}

const MARKER: ViewingAs = { actorId: ADMIN, subjectId: ALICE, sessionId: randomUUID() };

/** Run `fn` exactly as the gate runs a handler: the marker outside, the reader as owner inside. */
function asViewingAlice<T>(fn: () => Promise<T>): Promise<T> {
  return runViewingAs(MARKER, () => runAsOwner(ALICE, fn));
}

/* ------------------------------------------------------------ the gate */

describe("without the header", () => {
  it("serves the caller exactly as before: the administrator's own, no view-as headers", async () => {
    const own = await drive("GET", `/api/search/${adminsArticle.slug}`);
    expect(own.status).toBe(200);
    expect(criteria(own)).toEqual(["the admin's search"]);
    expect(own.headers.vary).toBeUndefined();
    expect(own.headers["cache-control"]).toBeUndefined();
    /* And a reader's article is not the administrator's: a 404, as ever. */
    expect((await drive("GET", `/api/search/${alicesArticle.slug}`)).status).toBe(404);
  });
});

describe("the four refusals, each before anything runs", () => {
  it("refuses a caller who is not the administrator", async () => {
    const nonce = await startOnAlice();
    const reply = await drive("GET", "/api/library", { owner: BOB, nonce });
    expect(reply.status).toBe(403);
    expect(reply.body?.error).toContain("[view-as-not-admin]");
    expect(reply.headers["cache-control"]).toBe("private, no-store");
  });

  it("answers an ended, an expired, another actor's, an unknown and a malformed nonce as ended", async () => {
    const ended = await startOnAlice();
    expect((await drive("POST", "/api/admin/view-as/end", { nonce: ended })).status).toBe(204);
    const cases = {
      ended,
      expired: await sessionRow({ actor: ADMIN, subject: ALICE, expired: true }),
      endedByHand: await sessionRow({ actor: ADMIN, subject: ALICE, ended: true }),
      someoneElses: await sessionRow({ actor: BOB, subject: ALICE }),
      unknown: randomBytes(32).toString("base64url"),
      malformed: "not-a-nonce",
    };
    for (const [name, nonce] of Object.entries(cases)) {
      const reply = await drive("GET", "/api/library", { nonce });
      expect(reply.status, name).toBe(410);
      expect(reply.body?.error, name).toContain("[view-as-ended]");
    }
  });

  it("refuses a session whose reader is an administrator", async () => {
    const nonce = await sessionRow({ actor: ADMIN, subject: OTHER_ADMIN });
    const reply = await drive("GET", "/api/library", { nonce });
    expect(reply.status).toBe(403);
    expect(reply.body?.error).toContain("[view-as-subject-admin]");

    const current = await drive("GET", "/api/admin/view-as/current", { nonce });
    expect(current.status).toBe(410);
    expect(current.body?.error).toContain("[view-as-ended]");
  });

  it("refuses every route not on the list with the one sentence, and runs none of them", async () => {
    const nonce = await startOnAlice();
    const slug = alicesArticle.slug;
    const refused: [string, string][] = [
      ["POST", `/api/comments/${slug}`],
      ["PATCH", `/api/library/${slug}`],
      ["DELETE", `/api/library/${slug}`],
      ["POST", `/api/library/${slug}/open`],
      ["POST", "/api/jobs"],
      ["GET", "/api/no-such-route"],
      ["GET", "/api/admin/users"],
      ["GET", "/api/admin/costs"],
      ["GET", "/api/library/terms"],
      ["GET", `/api/link-preview?slug=${slug}&url=https%3A%2F%2Fexample.com`],
      ["GET", `/api/link-summary?slug=${slug}&url=https%3A%2F%2Fexample.com`],
      ["GET", `/api/citers/${slug}`],
      ["GET", `/api/article/${slug}/share-link`],
      ["GET", `/api/export/${slug}`],
      ["GET", `/api/export/${slug}/your-words`],
      ["GET", "/api/billing/usage"],
      /* The old aliases, off by F8. */
      ["GET", `/api/debate-claims/${slug}`],
      ["GET", `/api/debate-claims/${slug}/checks`],
      ["GET", `/api/debate/${slug}`],
      ["GET", `/api/citations/${slug}`],
    ];
    const before = await pool.query("select count(*)::int as n from spideryarn.view_as_sessions");
    for (const [method, url] of refused) {
      const reply = await drive(method, url, { nonce, body: method === "GET" ? undefined : {} });
      expect(reply.status, `${method} ${url}`).toBe(403);
      /* The exact sentence: no handler can produce it, so a handler that ran
         would have answered something else. */
      expect(reply.body?.error, `${method} ${url}`).toBe(VIEW_AS_READ_ONLY_MESSAGE);
      expect(reply.headers["cache-control"], `${method} ${url}`).toBe("private, no-store");
    }
    /* And the shelf entry the PATCH and DELETE named is still there. */
    const { rows } = await pool.query("select count(*)::int as n from spideryarn.articles where id = $1", [alicesArticle.id]);
    expect((rows[0] as { n: number }).n).toBe(1);
    expect((await pool.query("select count(*)::int as n from spideryarn.view_as_sessions")).rows).toEqual(before.rows);
  });
});

describe("an allowlisted GET", () => {
  it("answers with the reader's data, private and varying on the header", async () => {
    const nonce = await startOnAlice();
    const reply = await drive("GET", `/api/search/${alicesArticle.slug}`, { nonce });
    expect(reply.status).toBe(200);
    expect(criteria(reply)).toEqual(["alice's search"]);
    expect(reply.headers["cache-control"]).toBe("private, no-store");
    expect(reply.headers.vary).toBe("X-Spideryarn-View-As");
    /* The administrator's own article is not the reader's: a 404 under view as. */
    expect((await drive("GET", `/api/search/${adminsArticle.slug}`, { nonce })).status).toBe(404);
    /* And the shelf, which reads through the same owner box, answers too. */
    expect((await drive("GET", "/api/library", { nonce })).status).toBe(200);
  });

  it("forces the headers on /api/asset too, whatever the answer", async () => {
    const nonce = await startOnAlice();
    const reply = await drive("GET", `/api/asset/${alicesArticle.slug}/${"a".repeat(64)}.png`, { nonce });
    expect(reply.status).not.toBe(403);
    expect(reply.headers["cache-control"]).toBe("private, no-store");
    expect(reply.headers.vary).toBe("X-Spideryarn-View-As");
  });

  it("a handler's own Cache-Control cannot win, by setHeader or by writeHead", () => {
    const res = new ServerResponse(new IncomingMessage(new Socket()));
    pinViewAsHeaders(res);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Vary", "Accept");
    res.removeHeader("cache-control");
    res.appendHeader("Vary", "Origin");
    res.setHeader("Content-Type", "image/png");
    res.writeHead(200, { "Cache-Control": "max-age=31536000, immutable", Vary: "Accept", "X-Kept": "yes" });
    expect(res.getHeader("cache-control")).toBe("private, no-store");
    expect(res.getHeader("vary")).toBe("X-Spideryarn-View-As");
    expect(res.getHeader("content-type")).toBe("image/png");
    expect(res.getHeader("x-kept")).toBe("yes");
  });

  it("the control: without the pin, the same calls do change it", () => {
    const res = new ServerResponse(new IncomingMessage(new Socket()));
    res.setHeader("Cache-Control", "private, no-store");
    res.writeHead(200, { "Cache-Control": "max-age=31536000, immutable" });
    expect(res.getHeader("cache-control")).toBe("max-age=31536000, immutable");
  });
});

describe("the control routes", () => {
  it("start, current and end, as the administrator", async () => {
    const started = await drive("POST", "/api/admin/view-as", { body: { subject: ALICE, reason: "  a support ticket  " } });
    expect(started.status).toBe(200);
    expect(started.headers["cache-control"]).toBe("private, no-store");
    const nonce = started.body?.nonce as string;
    expect(started.body).toMatchObject({ subjectId: ALICE, subjectEmail: "alice@example.invalid" });
    const { rows } = await pool.query(
      "select reason, actor_id, subject_id, expires_at - started_at as span from spideryarn.view_as_sessions where nonce_hash = $1",
      [createHash("sha256").update(nonce).digest("hex")],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "a support ticket", actor_id: ADMIN, subject_id: ALICE });

    const current = await drive("GET", "/api/admin/view-as/current", { nonce });
    expect(current.status).toBe(200);
    expect(current.body).toMatchObject({ subjectId: ALICE, subjectEmail: "alice@example.invalid" });

    expect((await drive("POST", "/api/admin/view-as/end", { nonce })).status).toBe(204);
    expect((await drive("POST", "/api/admin/view-as/end", { nonce })).status).toBe(204);
    const after = await drive("GET", "/api/admin/view-as/current", { nonce });
    expect(after.status).toBe(410);
    expect(after.body?.error).toContain("[view-as-ended]");
  });

  it("refuses an administrator as the subject, an unknown account, and a bad reason", async () => {
    expect((await drive("POST", "/api/admin/view-as", { body: { subject: OTHER_ADMIN, reason: "x" } })).status).toBe(403);
    expect((await drive("POST", "/api/admin/view-as", { body: { subject: ADMIN, reason: "x" } })).status).toBe(403);
    expect((await drive("POST", "/api/admin/view-as", { body: { subject: randomUUID(), reason: "x" } })).status).toBe(404);
    expect((await drive("POST", "/api/admin/view-as", { body: { subject: ALICE, reason: "   " } })).status).toBe(400);
    expect((await drive("POST", "/api/admin/view-as", { body: { subject: ALICE, reason: "x".repeat(301) } })).status).toBe(400);
    expect((await drive("POST", "/api/admin/view-as", { body: { subject: "alice", reason: "x" } })).status).toBe(400);
  });

  it("is the administrator's alone", async () => {
    const reply = await drive("POST", "/api/admin/view-as", { owner: BOB, body: { subject: ALICE, reason: "x" } });
    expect(reply.status).toBe(403);
    expect(reply.body?.error).toContain("[admin-only]");
  });

  it("does not record an administrator arrival from the view-as tab", async () => {
    const nonce = await startOnAlice();
    control.noteArrival.mockClear();

    expect((await drive("GET", "/api/admin/view-as/current", { nonce })).status).toBe(200);
    expect((await drive("POST", "/api/admin/view-as/end", { nonce })).status).toBe(204);

    expect(control.noteArrival).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------- the list */

/** The allowlist, row by row: plan 261019n § The allowlist, minus the old aliases (F8). */
const EXPECTED_ON_THE_LIST = [
  "/api/library",
  "/api/library/search",
  "/api/library/tags",
  "/api/models",
  "/api/feedback",
  "/api/reader",
  "^\\/api\\/article\\/([\\w.%-]+)$",
  "^\\/api\\/source\\/([\\w.%-]+)$",
  "^\\/api\\/asset\\/([\\w.%-]+)\\/([0-9a-f]{64})\\.(png|jpeg|gif)$",
  "^\\/api\\/metadata\\/([\\w.%-]+)$",
  "^\\/api\\/tweets\\/([\\w.%-]+)$",
  "^\\/api\\/glossary\\/([\\w.%-]+)$",
  "^\\/api\\/ideas\\/([\\w.%-]+)$",
  "^\\/api\\/quotes\\/([\\w.%-]+)$",
  "^\\/api\\/timeline\\/([\\w.%-]+)$",
  "^\\/api\\/quiz\\/([\\w.%-]+)$",
  "^\\/api\\/faq\\/([\\w.%-]+)$",
  "^\\/api\\/sources-claims\\/([\\w.%-]+)$",
  "^\\/api\\/situate\\/([\\w.%-]+)$",
  "^\\/api\\/sources-claims\\/([\\w.%-]+)\\/checks$",
  "^\\/api\\/relations\\/([\\w.%-]+)$",
  "^\\/api\\/crossrefs\\/([\\w.%-]+)$",
  "^\\/api\\/simple\\/([\\w.%-]+)$",
  "^\\/api\\/skim\\/([\\w.%-]+)$",
  "^\\/api\\/reception\\/([\\w.%-]+)$",
  "^\\/api\\/related-work\\/([\\w.%-]+)$",
  "^\\/api\\/bibliography\\/([\\w.%-]+)$",
  "^\\/api\\/reading-time\\/([\\w.%-]+)$",
  "^\\/api\\/stale-notices\\/([\\w.%-]+)$",
  "^\\/api\\/sketch\\/([\\w.%-]+)$",
  "^\\/api\\/illustrated\\/([\\w.%-]+)$",
  "^\\/api\\/illustrated\\/([\\w.%-]+)\\/([0-9a-f]{64})\\.(jpeg|png)$",
  "^\\/api\\/arc\\/([\\w.%-]+)$",
  "^\\/api\\/comments\\/([\\w.%-]+)$",
  "^\\/api\\/chat\\/([\\w.%-]+)$",
  "^\\/api\\/search\\/([\\w.%-]+)$",
  "^\\/api\\/referee\\/criteria\\/([\\w.%-]+)$",
  "^\\/api\\/referee\\/promises\\/([\\w.%-]+)$",
  "^\\/api\\/referee\\/scan\\/([\\w.%-]+)$",
  "^\\/api\\/referee\\/hidden-check\\/([\\w.%-]+)$",
  "/api/jobs",
  "^\\/api\\/uploads\\/([\\w-]+)$",
  "^\\/api\\/jobs\\/([\\w.%-]+)$",
];

describe("the allowlist", () => {
  const inventory = viewAsRouteInventory();

  it("is exactly these GET rows, in table order", () => {
    expect(inventory.filter((r) => r.viewAs).map((r) => r.match)).toEqual(EXPECTED_ON_THE_LIST);
    /* The control: the inventory is the whole table, not just the list. */
    expect(inventory.filter((r) => r.method === "GET").length).toBeGreaterThan(EXPECTED_ON_THE_LIST.length);
  });

  it("every listed GET answers a view-as request without a refusal from a backstop", async () => {
    /* A read that turned out to write would come back a 500 here — the
       read-only pool's refusal, or a backstop's. Most of these are 404s or
       `null`s on an article with nothing made yet, which is what this asks:
       not that each has data, but that none trips the net. */
    const nonce = await startOnAlice();
    const slug = alicesArticle.slug;
    const hex = "a".repeat(64);
    const witnesses = EXPECTED_ON_THE_LIST.map((match) =>
      match.startsWith("/")
        ? match
        : match
            .replace(/^\^/, "")
            .replace(/\$$/, "")
            .replace("([\\w.%-]+)\\/([0-9a-f]{64})\\.(png|jpeg|gif)", `${slug}/${hex}.png`)
            .replace("([\\w.%-]+)\\/([0-9a-f]{64})\\.(jpeg|png)", `${slug}/${hex}.png`)
            .replace("\\/api\\/uploads\\/([\\w-]+)", `/api/uploads/${randomUUID()}`)
            .replace("\\/api\\/jobs\\/([\\w.%-]+)", "/api/jobs/no-such-job")
            .replace("([\\w.%-]+)", slug)
            .replaceAll("\\/", "/"),
    );
    const failures: string[] = [];
    for (const url of witnesses) {
      const reply = await drive("GET", url, { nonce });
      if (reply.status >= 500 || reply.status === 403) failures.push(`${url} → ${reply.status} ${reply.body?.error ?? ""}`);
    }
    expect(failures).toEqual([]);
  });

  it("has no non-GET row and no admin row on it", () => {
    expect(inventory.filter((r) => r.viewAs && r.method !== "GET")).toEqual([]);
    expect(inventory.filter((r) => r.viewAs && /admin/.test(r.match))).toEqual([]);
  });

  it("is a type a write or a handler that reads `user` cannot join", () => {
    /* One line, so the directive covers wherever the compiler puts the error. */
    // @ts-expect-error — only a GET row may carry `viewAs`
    const writes: AuthRoute = { kind: "exact", method: "POST", path: "/api/x", article: "none", viewAs: "read", handler: async () => {} };
    /* The control: the same row as a GET compiles. */
    const reads: AuthRoute = { kind: "exact", method: "GET", path: "/api/x", article: "none", viewAs: "read", handler: async () => {} };
    expect(reads.viewAs).toBe("read");
    const readsUser: AuthRoute = {
      kind: "exact",
      method: "GET",
      path: "/api/x",
      article: "none",
      viewAs: "read",
      // @ts-expect-error — a view-as handler is given no `user`
      handler: async ({ user }) => {
        void user;
      },
    };
    expect([writes, readsUser]).toHaveLength(2);
  });
});

/* ------------------------------------------------------------ backstops */

/**
 * One synthetic allowlisted row, run exactly as `serveViewingAs` runs a row:
 * through `dispatchAuthRoute`, inside the marker and the reader's owner box.
 * Returns what the handler threw, or `null`.
 */
async function throughAViewAsRow(body: () => Promise<unknown>, viewing = true): Promise<unknown> {
  let thrown: unknown = null;
  const row: AuthRoute = {
    kind: "exact",
    method: "GET",
    path: "/api/synthetic",
    article: "none",
    viewAs: "read",
    handler: async () => {
      try {
        await body();
      } catch (err) {
        thrown = err;
      }
    },
  };
  const context = {
    user: { id: ADMIN },
    request: {
      req: { method: "GET", headers: {} } as IncomingMessage,
      res: {} as ServerResponse,
      rawUrl: "/api/synthetic",
      path: "/api/synthetic",
      query: new URLSearchParams(),
    },
  } as unknown as Parameters<typeof dispatchAuthRoute>[1];
  const run = () => dispatchAuthRoute([row], context);
  const handled = viewing ? await asViewingAlice(run) : await runAsOwner(ALICE, run);
  expect(handled).toBe(true);
  return thrown;
}

const TAG = `view-as-backstop-${RUN}`;

async function taggedRows(): Promise<number> {
  const { rows } = await pool.query("select count(*)::int as n from spideryarn.view_as_sessions where reason = $1", [TAG]);
  return (rows[0] as { n: number }).n;
}

/** A write any handler could make: one session row, tagged so it can be counted. */
const insertTagged = () =>
  getDb().execute(
    sql`insert into spideryarn.view_as_sessions (nonce_hash, actor_id, subject_id, reason, expires_at)
        values (${randomBytes(16).toString("hex")}, ${ADMIN}, ${ALICE}, ${TAG}, now())`,
  );

/** Whether `err`, or anything in its `cause` chain, is a `kind`. */
function causedBy(err: unknown, kind: new (...args: never[]) => Error): boolean {
  const seen = new Set<unknown>();
  let at: unknown = err;
  while (at && typeof at === "object" && !seen.has(at)) {
    seen.add(at);
    if (at instanceof kind) return true;
    at = (at as { cause?: unknown }).cause;
  }
  return false;
}

/** Postgres's own refusal: 25006 is `read_only_sql_transaction`. */
function isReadOnlyRefusal(err: unknown): boolean {
  const seen = new Set<unknown>();
  let at: unknown = err;
  while (at && typeof at === "object" && !seen.has(at)) {
    seen.add(at);
    if ((at as { code?: unknown }).code === "25006") return true;
    at = (at as { cause?: unknown }).cause;
  }
  return false;
}

describe("the backstops refuse inside a view-as handler, and only there", () => {
  it("a paid model call", async () => {
    const inside = await throughAViewAsRow(async () => {
      await collectSpend(async () => beginSpend("chat", "m"), { attribution: { scopeKind: "request", ownerId: ALICE } });
    });
    expect(inside).toBeInstanceOf(RefusedWhileViewingAs);
    const outside = await throughAViewAsRow(async () => {
      await collectSpend(async () => beginSpend("chat", "m"), { attribution: { scopeKind: "request", ownerId: ALICE } });
    }, false);
    expect(outside).not.toBeInstanceOf(RefusedWhileViewingAs);
  });

  it("an email", async () => {
    const email = { to: "nobody@example.invalid", subject: "s", text: "t" };
    expect(await throughAViewAsRow(() => sendEmail(email, "view-as test"))).toBeInstanceOf(RefusedWhileViewingAs);
    /* Outside it is the ordinary answer, "not production" here. */
    expect(await throughAViewAsRow(() => sendEmail(email, "view-as test"), false)).toBeNull();
  });

  it("work after the response", async () => {
    let ran = false;
    const queue = () => afterResponse("view-as test", async () => {
      ran = true;
    });
    expect(await throughAViewAsRow(queue)).toBeInstanceOf(RefusedWhileViewingAs);
    expect(ran).toBe(false);
    expect(await throughAViewAsRow(queue, false)).toBeNull();
    expect(ran).toBe(true);
  });

  it("starting a job", async () => {
    const ask = () => enqueue({ steps: [] } as unknown as Parameters<typeof enqueue>[0]);
    expect(await throughAViewAsRow(ask)).toBeInstanceOf(RefusedWhileViewingAs);
    /* Outside, the same request reaches `enqueue`'s own first refusal. */
    const outside = await throughAViewAsRow(ask, false);
    expect(outside).not.toBeInstanceOf(RefusedWhileViewingAs);
    expect((outside as { status?: number }).status).toBe(400);
  });

  it("a Storage write, delete or upload grant", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "view-as-blobs-"));
    try {
      const local = fsBlobs(dir);
      const bucket = supabaseBlobs("http://storage.invalid", "no-key");
      const bytes = new Uint8Array([1, 2, 3]);
      expect(await throughAViewAsRow(() => local.putIfAbsent("k1", bytes, "text/plain"))).toBeInstanceOf(RefusedWhileViewingAs);
      expect(await throughAViewAsRow(() => local.remove("k1"))).toBeInstanceOf(RefusedWhileViewingAs);
      expect(await throughAViewAsRow(() => bucket.putIfAbsent("k1", bytes, "text/plain"))).toBeInstanceOf(RefusedWhileViewingAs);
      expect(await throughAViewAsRow(() => bucket.remove("k1"))).toBeInstanceOf(RefusedWhileViewingAs);
      expect(await throughAViewAsRow(() => bucket.sign("k1"))).toBeInstanceOf(RefusedWhileViewingAs);
      /* The control, on the store that needs no network. */
      expect(await throughAViewAsRow(() => local.putIfAbsent("k1", bytes, "text/plain"), false)).toBeNull();
      expect(await local.head("k1")).not.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the database is read-only while viewing as, by Postgres's own refusal", () => {
  it("a read still works", async () => {
    let seen: unknown;
    expect(await throughAViewAsRow(async () => {
      seen = (await getDb().execute(sql`select 41 + 1 as n`)).rows[0];
    })).toBeNull();
    expect(seen).toEqual({ n: 42 });
  });

  it("an insert is refused by Postgres and nothing is written — and the same insert outside succeeds", async () => {
    const before = await taggedRows();
    const inside = await throughAViewAsRow(insertTagged);
    expect(isReadOnlyRefusal(inside), String(inside)).toBe(true);
    expect(await taggedRows()).toBe(before);
    expect(await throughAViewAsRow(insertTagged, false)).toBeNull();
    expect(await taggedRows()).toBe(before + 1);
  });

  it("a multi-statement string is refused, not run as two", async () => {
    const before = await taggedRows();
    const pool$ = (getDb() as unknown as { $client: Pool }).$client;
    const inside = await throughAViewAsRow(() =>
      pool$.query(
        `select 1; insert into spideryarn.view_as_sessions (nonce_hash, actor_id, subject_id, reason, expires_at)
         values ('${randomBytes(16).toString("hex")}', '${ADMIN}', '${ALICE}', '${TAG}', now())`,
      ),
    );
    expect(inside).not.toBeNull();
    expect(String((inside as Error).message)).toMatch(/multiple commands/);
    expect(await taggedRows()).toBe(before);
  });

  it("a lone commit or set transaction read write reaches nothing after it", async () => {
    const before = await taggedRows();
    const pool$ = (getDb() as unknown as { $client: Pool }).$client;
    await throughAViewAsRow(async () => {
      await pool$.query("commit").catch(() => undefined);
      await pool$.query("set transaction read write").catch(() => undefined);
      await insertTagged();
    });
    expect(await taggedRows()).toBe(before);
  });

  it("a transaction is read-only: set transaction read write is refused, and so is the insert", async () => {
    const before = await taggedRows();
    let setFailed: unknown = null;
    const inside = await throughAViewAsRow(() =>
      getDb().transaction(async (tx) => {
        await tx.execute(sql`set transaction read write`).catch((err: unknown) => {
          setFailed = err;
        });
        await tx.execute(
          sql`insert into spideryarn.view_as_sessions (nonce_hash, actor_id, subject_id, reason, expires_at)
              values (${randomBytes(16).toString("hex")}, ${ADMIN}, ${ALICE}, ${TAG}, now())`,
        );
      }),
    );
    expect(setFailed).not.toBeNull();
    expect(inside).not.toBeNull();
    expect(await taggedRows()).toBe(before);
  });

  it.each(["/* outer /* nested */ comment */ ", "-- comment\r", "-- comment\n"])(
    "a comment-prefixed commit cannot desynchronise the wrapper and open autocommit: %j",
    async (prefix) => {
      const before = await taggedRows();
      const inside = await throughAViewAsRow(() =>
        getDb().transaction(async (tx) => {
          await tx.execute(sql.raw(`${prefix}COMMIT`));
          await tx.execute(
            sql`insert into spideryarn.view_as_sessions (nonce_hash, actor_id, subject_id, reason, expires_at)
                values (${randomBytes(16).toString("hex")}, ${ADMIN}, ${ALICE}, ${TAG}, now())`,
          );
        }),
      );
      expect(inside).not.toBeNull();
      expect(await taggedRows()).toBe(before);
    },
  );

  it.each(["commit", "rollback"])("%s and chain pins the replacement transaction read-only too", async (end) => {
    const before = await taggedRows();
    let setFailed: unknown = null;
    const inside = await throughAViewAsRow(() =>
      getDb().transaction(async (tx) => {
        await tx.execute(sql.raw(`${end} and chain`));
        await tx.execute(sql`set transaction read write`).catch((err: unknown) => {
          setFailed = err;
        });
        await tx.execute(
          sql`insert into spideryarn.view_as_sessions (nonce_hash, actor_id, subject_id, reason, expires_at)
              values (${randomBytes(16).toString("hex")}, ${ADMIN}, ${ALICE}, ${TAG}, now())`,
        );
      }),
    );
    expect(setFailed).not.toBeNull();
    expect(inside).not.toBeNull();
    expect(await taggedRows()).toBe(before);
  });

  it("prepare transaction is refused before it can detach or cancel the guarded transaction", async () => {
    const before = await taggedRows();
    const gid = `view-as-${randomUUID()}`;
    const inside = await throughAViewAsRow(() =>
      getDb().transaction(async (tx) => {
        await tx.execute(sql.raw(`/* two-phase */ prepare transaction '${gid}'`)).catch(() => undefined);
        await tx.execute(
          sql`insert into spideryarn.view_as_sessions (nonce_hash, actor_id, subject_id, reason, expires_at)
              values (${randomBytes(16).toString("hex")}, ${ADMIN}, ${ALICE}, ${TAG}, now())`,
        );
      }),
    );
    await pool.query(`rollback prepared '${gid}'`).catch(() => undefined);
    expect(inside).not.toBeNull();
    expect(await taggedRows()).toBe(before);
  });

  it("refuses known read-only transaction side effects explicitly", async () => {
    for (const text of [
      "notify view_as_probe, 'x'",
      "select pg_notify('view_as_probe', 'x')",
      "select pg_catalog.pg_notify /* a comment is whitespace */ ('view_as_probe', 'x')",
      "select pg_try_advisory_lock(42)",
      "set application_name = 'view-as-probe'",
      "copy (select 1) to program 'false'",
    ]) {
      const inside = await throughAViewAsRow(() => getDb().execute(sql.raw(text)));
      expect(causedBy(inside, RefusedWhileViewingAs), text).toBe(true);
    }
  });

  it("a savepoint inside it is read-only too, and an isolation level is kept", async () => {
    const before = await taggedRows();
    let level: unknown;
    const inside = await throughAViewAsRow(() =>
      getDb().transaction(
        async (tx) => {
          level = (await tx.execute(sql`show transaction_isolation`)).rows[0];
          await tx.transaction(async (inner) => {
            await inner.execute(
              sql`insert into spideryarn.view_as_sessions (nonce_hash, actor_id, subject_id, reason, expires_at)
                  values (${randomBytes(16).toString("hex")}, ${ADMIN}, ${ALICE}, ${TAG}, now())`,
            );
          });
        },
        { isolationLevel: "repeatable read" },
      ),
    );
    expect(isReadOnlyRefusal(inside), String(inside)).toBe(true);
    expect(level).toEqual({ transaction_isolation: "repeatable read" });
    expect(await taggedRows()).toBe(before);
  });

  it("an explicit read-write transaction is refused before it starts", async () => {
    const inside = await throughAViewAsRow(() =>
      getDb().transaction(async () => undefined, { accessMode: "read write" }),
    );
    /* Drizzle wraps what the driver threw; the refusal is its cause. */
    expect(causedBy(inside, RefusedWhileViewingAs), String(inside)).toBe(true);
  });

  it("failures do not poison the pool: five refused queries, then an ordinary write", async () => {
    for (let i = 0; i < 5; i += 1) {
      expect(isReadOnlyRefusal(await throughAViewAsRow(insertTagged))).toBe(true);
    }
    for (let i = 0; i < 5; i += 1) {
      expect(await throughAViewAsRow(() => getDb().execute(sql`select nonsense_column_${sql.raw(String(i))}`))).not.toBeNull();
    }
    const before = await taggedRows();
    expect(await throughAViewAsRow(insertTagged, false)).toBeNull();
    expect(await taggedRows()).toBe(before + 1);
    /* And no client was handed back still inside a read-only transaction. */
    await getDb().transaction(async (tx) => {
      await tx.execute(
        sql`insert into spideryarn.view_as_sessions (nonce_hash, actor_id, subject_id, reason, expires_at)
            values (${randomBytes(16).toString("hex")}, ${ADMIN}, ${ALICE}, ${TAG}, now())`,
      );
    });
    expect(await taggedRows()).toBe(before + 2);
  });
});

/* ------------------------------------------------------------- sweeps */

describe("sweeps", () => {
  it("leave a stale pending search pending while viewing as, and sweep it otherwise", async () => {
    const id = mintId();
    await pool.query(
      `insert into spideryarn.search_runs (article_id, id, owner_id, criterion, status)
       values ($1, $2, $3, 'a stale search', 'pending')`,
      [alicesArticle.id, id, ALICE],
    );
    const status = async () =>
      ((await pool.query("select status from spideryarn.search_runs where id = $1", [id])).rows[0] as { status: string }).status;

    const nonce = await startOnAlice();
    const viewed = await drive("GET", `/api/search/${alicesArticle.slug}`, { nonce });
    expect(viewed.status).toBe(200);
    expect(await status()).toBe("pending");

    const own = await drive("GET", `/api/search/${alicesArticle.slug}`, { owner: ALICE });
    expect(own.status).toBe(200);
    expect(await status()).toBe("error");
  });

  it("GET /api/jobs does not settle while viewing as, and does otherwise", async () => {
    const running = [{ id: "j1", status: "running" }] as unknown as Awaited<ReturnType<typeof pgJobStore.list>>;
    const list = vi.spyOn(pgJobStore, "list").mockResolvedValue(running);
    const settle = vi.spyOn(pgJobStore, "settleExpired").mockResolvedValue([]);
    try {
      expect(await asViewingAlice(() => listJobs())).toEqual(running);
      expect(settle).not.toHaveBeenCalled();
      await runAsOwner(ALICE, () => listJobs());
      expect(settle).toHaveBeenCalledTimes(1);
    } finally {
      list.mockRestore();
      settle.mockRestore();
    }
  });
});

describe("whose request it is", () => {
  it("the outer owner is still the administrator after a view-as handler", async () => {
    await runInRequest(async () => {
      setRequestOwner(ADMIN);
      const inner = await runViewingAs(MARKER, () => runAsOwner(ALICE, async () => [currentOwnerId(), viewingAs()]));
      expect(inner).toEqual([ALICE, MARKER]);
      expect(currentOwnerId()).toBe(ADMIN);
      expect(viewingAs()).toBeNull();
    });
  });

  it("the marker is frozen", async () => {
    await runViewingAs({ ...MARKER }, async () => {
      const marker = viewingAs() as { subjectId: string };
      expect(Object.isFrozen(marker)).toBe(true);
      expect(() => {
        marker.subjectId = BOB;
      }).toThrow();
    });
  });
});
