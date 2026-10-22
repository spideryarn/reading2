/**
 * **A gift's article, prepared as the gift is made** — the main-mode jobs
 * queued, and High-powered AI switched on when asked, in the transaction that
 * makes the gift. docs/plans/261021j-gift-articles-on-opus-and-with-their-main-modes.md,
 * stage 1; the function is `prepareGiftArticleIn` (src/store/pg-gift-prep.ts).
 *
 * What is pinned:
 *
 * - a new author gift queues the jobs of `autoModePosts`, unforced, with the
 *   owner's rendered profile, **even with the owner's import switch off**;
 * - an existing gift queues nothing;
 * - a new voucher with a starter queues them; a replay of the same id does
 *   not, and does not switch on, whatever its `highPower`;
 * - `highPower` switches on in the same transaction: a throw after it takes
 *   the switch and the jobs down with it;
 * - an article already on keeps its first `high_power_since`;
 * - `POST /api/admin/author-gifts/:id/high-power` is 404, 409 or 200, and the
 *   list says `highPower`.
 *
 * **No email leaves and no model is called**: the voucher's audience is a
 * seam, its email is only queued, and nothing drives the queued jobs — they
 * are swept after every case. This file's own owner stem and slug prefix.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/store/admin-accounts.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/admin-accounts.js")>();
  return {
    ...real,
    confirmedAccountEmail: async () => ({ kind: "unavailable", reason: "not asked in this test" }),
    accountEmail: async () => ({ kind: "unavailable", reason: "not asked in this test" }),
    confirmedAccountByEmail: async () => ({ kind: "none" }),
  };
});

vi.mock("../src/author-lookup-start.js", () => ({ startAuthorLookup: async () => {} }));

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import type { AdminAuthorGift } from "../src/admin-author-gifts.js";
import type { Verifier } from "../src/auth.js";
import { getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import { renderProfile } from "../src/profile.js";
import { handleApi } from "../src/routes.js";
import { workKeyFor } from "../src/store/jobs.js";
import { type EnsureOptions, ensureAuthorGift } from "../src/store/pg-author-gifts.js";
import { prepareGiftArticleIn } from "../src/store/pg-gift-prep.js";
import { type NewVoucher, createVoucher } from "../src/store/pg-vouchers.js";
import { resolveStarter as realResolveStarter } from "../src/store/voucher-starter.js";
import type { StepName } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/gift-prep.test.ts",
  tables: [
    "spideryarn.author_gifts",
    "spideryarn.billing_vouchers",
    "spideryarn.billing_voucher_emails",
    "spideryarn.jobs",
    "spideryarn.reader_profiles",
  ],
  columns: [
    { table: "spideryarn.reader_profiles", column: "auto_modes_off_at" },
    { table: "spideryarn.articles", column: "high_power_since" },
  ],
  keepPool: true,
  max: 4,
});

const STEM = "0000c0a5-0000-4000-8000-";
const RUN = randomUUID().slice(0, 8);
const ADMIN = ADMIN_USER_ID_LOCAL as OwnerId;
/** A reader who has switched *Generate the main modes* off, and has an "about you". Not an administrator. */
const OPTED_OUT = `${STEM}${randomUUID().slice(-12)}` as OwnerId;
const SLUG_STEM = "test-gift-prep-";
const addressOf = (n: string) => `gprep-${n}-${RUN}@example.invalid`;
const ABOUT = "A fixture reader who studies bridges.";
const PURPOSE = "To see whether the gift's modes are written for this.";

/**
 * **The jobs, written out again on purpose**, as
 * tests/publication-queues-the-main-modes.test.ts does: a second copy of
 * src/auto-mode-steps.ts, so a change there is made twice.
 */
const EXPECTED: StepName[][] = [
  /* Not `tweets`, Summary's thread, since 2026-10-22: written when pressed (plan 261022b). */
  ["glossary"],
  ["quotes"],
  ["ideas"],
  ["simple"],
  ["bibliography"],
  ["crossrefs"],
  ["quotes", "ideas", "skim"],
];

interface Seeded {
  readonly id: string;
  readonly slug: string;
}

const seeded: string[] = [];

/** One public, published article of `owner`'s, with a purpose so the profile is not vacuous. */
async function seed(name: string, owner: OwnerId = ADMIN): Promise<Seeded> {
  const id = randomUUID();
  const revision = randomUUID();
  const slug = `${SLUG_STEM}${name}-${RUN}`;
  seeded.push(id);
  await pool.query(
    `insert into spideryarn.articles (id, owner_id, slug, short_id, visibility, public_at, purpose)
     values ($1, $2, $3, $4, 'public', now(), $5)`,
    [id, owner, slug, mintId(), PURPOSE],
  );
  await pool.query(
    `insert into spideryarn.article_revisions
       (id, article_id, status, title, word_count, block_count, part_count, section_count)
     values ($1, $2, 'published', 'A gift', 9, 0, 0, 0)`,
    [revision, id],
  );
  await pool.query("update spideryarn.articles set current_revision_id = $2 where id = $1", [id, revision]);
  return { id, slug };
}

async function jobsOf(slug: string) {
  const { rows } = await pool.query(
    `select owner_id, steps, status, profile, work_key, ingest_event_id
       from spideryarn.jobs where slug = $1 order by created_at, id`,
    [slug],
  );
  return rows as {
    owner_id: string;
    steps: { name: StepName }[];
    status: string;
    profile: string | null;
    work_key: string;
    ingest_event_id: string | null;
  }[];
}

async function powerOf(id: string): Promise<{ since: Date | null; updatedAt: Date }> {
  const { rows } = await pool.query("select high_power_since, updated_at from spideryarn.articles where id = $1", [id]);
  const row = rows[0] as { high_power_since: Date | null; updated_at: Date };
  return { since: row.high_power_since, updatedAt: row.updated_at };
}

/** An agent's draft: no link, no lookup, nothing filled in. */
const draft = (highPower: boolean): EnsureOptions => ({ makeLink: false, lookup: false, draft: {}, highPower });

function voucherFor(article: Seeded, n: string, highPower: boolean): NewVoucher {
  return {
    id: randomUUID(),
    email: addressOf(n),
    articles: 5,
    note: null,
    recipientNote: null,
    recipientName: null,
    starterSlug: article.slug,
    highPower,
  };
}

const INVITE = { audience: async () => ({ kind: "invite" }) as const };

async function sweep(): Promise<void> {
  await pool.query("delete from spideryarn.jobs where slug like $1", [`${SLUG_STEM}%`]);
  await pool.query("delete from spideryarn.billing_vouchers where email like $1", ["gprep-%@example.invalid"]);
  for (const id of seeded.splice(0)) {
    await pool.query("update spideryarn.articles set current_revision_id = null where id = $1", [id]);
    await pool.query("delete from spideryarn.article_revisions where article_id = $1", [id]);
    await pool.query("delete from spideryarn.articles where id = $1", [id]);
  }
}

beforeAll(async () => {
  await sweep();
  await seedAuthUser(pool, { id: OPTED_OUT, email: `${OPTED_OUT}@example.invalid` });
  await pool.query(
    `insert into spideryarn.reader_profiles (owner_id, profile, auto_modes_off_at) values ($1, $2, now())
     on conflict (owner_id) do update set profile = excluded.profile, auto_modes_off_at = excluded.auto_modes_off_at`,
    [OPTED_OUT, ABOUT],
  );
});

afterEach(sweep);

afterAll(async () => {
  await sweep();
  await pool.query("delete from spideryarn.reader_profiles where owner_id = $1", [OPTED_OUT]).catch(() => {});
  await pool.query("delete from auth.users where id = $1", [OPTED_OUT]).catch(() => {});
  await pool.end();
});

/* ------------------------------------------------------------ author gift -- */

describe("a new author gift", () => {
  it("queues the main-mode jobs, free, with the owner's profile, even with the owner's import switch off", async () => {
    const mine = await seed("opted-out", OPTED_OUT);
    const made = await runAsOwner(OPTED_OUT, () => ensureAuthorGift(mine.slug, OPTED_OUT, draft(false)));
    expect(made.kind).toBe("created");

    const jobs = await jobsOf(mine.slug);
    expect(jobs.map((j) => j.steps.map((s) => s.name))).toEqual(EXPECTED);
    const profile = renderProfile({ profile: ABOUT, purpose: PURPOSE });
    expect(profile).not.toBeNull();
    for (const job of jobs) {
      expect(job).toMatchObject({ owner_id: OPTED_OUT, status: "queued", profile, ingest_event_id: null });
      /* The import's work key, so a press or the import's own job collapses onto it. */
      expect(job.work_key).toBe(workKeyFor(job.steps.map((s) => s.name), new Set(), profile ?? undefined));
    }
    expect((await powerOf(mine.id)).since).toBeNull();
  });

  it("queues nothing for an article that already has a gift", async () => {
    const mine = await seed("existing");
    expect((await runAsOwner(ADMIN, () => ensureAuthorGift(mine.slug, ADMIN, draft(false)))).kind).toBe("created");
    await pool.query("delete from spideryarn.jobs where slug = $1", [mine.slug]);

    const again = await runAsOwner(ADMIN, () => ensureAuthorGift(mine.slug, ADMIN, draft(true)));
    expect(again.kind).toBe("existing");
    expect(await jobsOf(mine.slug)).toEqual([]);
    /* Nor is it switched on by the second ask. */
    expect((await powerOf(mine.id)).since).toBeNull();
  });

  it("queues nothing when a concurrent ensure wins the insert", async () => {
    const mine = await seed("lost-insert");
    /* The other ensure lands after this one's existence check and before its
       insert: the seam runs exactly between the two. */
    const resolveStarter = async (slug: string) => {
      await pool.query("insert into spideryarn.author_gifts (article_id, starter_slug, created_by) values ($1, $2, $3)", [
        mine.id,
        slug,
        ADMIN,
      ]);
      return await realResolveStarter(slug);
    };
    const lost = await runAsOwner(ADMIN, () => ensureAuthorGift(mine.slug, ADMIN, draft(true), { resolveStarter }));
    expect(lost.kind).toBe("existing");
    expect(await jobsOf(mine.slug)).toEqual([]);
    expect((await powerOf(mine.id)).since).toBeNull();
  });

  it("refuses instead of claiming preparation succeeded when the article changed owner before its lock", async () => {
    const mine = await seed("moved-before-gift-lock");
    const resolveStarter = async (slug: string) => {
      const resolved = await realResolveStarter(slug);
      await pool.query("update spideryarn.articles set owner_id = $2 where id = $1", [mine.id, OPTED_OUT]);
      return resolved;
    };
    const made = await runAsOwner(ADMIN, () =>
      ensureAuthorGift(mine.slug, ADMIN, draft(true), { resolveStarter }),
    );
    expect(made).toEqual({ kind: "refused", reason: "absent" });
    const gifts = await pool.query("select id from spideryarn.author_gifts where article_id = $1", [mine.id]);
    expect(gifts.rows).toEqual([]);
    expect(await jobsOf(mine.slug)).toEqual([]);
    expect((await powerOf(mine.id)).since).toBeNull();
  });

  it("queues a scoped replacement when an identical mode job already owns an older draft", async () => {
    const mine = await seed("older-mode-draft", OPTED_OUT);
    const { rows } = await pool.query("select current_revision_id from spideryarn.articles where id = $1", [mine.id]);
    const older = String((rows[0] as { current_revision_id: string }).current_revision_id);
    const draftRevision = randomUUID();
    const currentRevision = randomUUID();
    await pool.query(
      `insert into spideryarn.article_revisions (id, article_id, status, based_on_revision_id, title)
       values ($1, $2, 'draft', $3, 'Old mode draft'), ($4, $2, 'published', $3, 'New current revision')`,
      [draftRevision, mine.id, older, currentRevision],
    );
    await pool.query("update spideryarn.articles set current_revision_id = $2 where id = $1", [mine.id, currentRevision]);
    const profile = renderProfile({ profile: ABOUT, purpose: PURPOSE });
    const holder = mintId();
    const plainKey = workKeyFor(["glossary"], new Set(), profile ?? undefined);
    await pool.query(
      `insert into spideryarn.jobs
         (id, owner_id, slug, steps, status, work_key, reserves_name, url_key, ingest_event_id, profile, draft_revision_id)
       values ($1, $2, $3, $4::jsonb, 'queued', $5, false, null, null, $6, $7)`,
      [holder, OPTED_OUT, mine.slug, JSON.stringify([{ name: "glossary", label: "Glossary", status: "pending" }]), plainKey, profile, draftRevision],
    );

    expect((await runAsOwner(OPTED_OUT, () => ensureAuthorGift(mine.slug, OPTED_OUT, draft(false)))).kind).toBe(
      "created",
    );
    const jobs = await jobsOf(mine.slug);
    expect(jobs).toHaveLength(EXPECTED.length + 1);
    const glossary = jobs.filter((job) => job.steps.map((step) => step.name).join(",") === "glossary");
    expect(glossary).toHaveLength(2);
    expect(glossary.some((job) => job.work_key !== plainKey), "no scoped replacement was queued").toBe(true);
  });

  it("switches the article on with highPower, and keeps the first `since` of one already on", async () => {
    const off = await seed("switch-on");
    await runAsOwner(ADMIN, () => ensureAuthorGift(off.slug, ADMIN, draft(true)));
    expect((await powerOf(off.id)).since).not.toBeNull();
    expect(await jobsOf(off.slug)).toHaveLength(EXPECTED.length);

    const on = await seed("already-on");
    const first = new Date("2026-10-01T09:00:00.000Z");
    await pool.query("update spideryarn.articles set high_power_since = $2 where id = $1", [on.id, first]);
    const before = await powerOf(on.id);
    await runAsOwner(ADMIN, () => ensureAuthorGift(on.slug, ADMIN, draft(true)));
    expect(await powerOf(on.id)).toEqual(before);
    expect(await jobsOf(on.slug)).toHaveLength(EXPECTED.length);
  });
});

/* ---------------------------------------------------------------- voucher -- */

describe("a voucher with a starter", () => {
  it("queues the main modes when it is made, and a replay of its id does nothing, whatever its highPower", async () => {
    const mine = await seed("voucher");
    const input = voucherFor(mine, "v", false);
    const made = await runAsOwner(ADMIN, () => createVoucher(input, ADMIN, INVITE));
    expect(made.kind).toBe("created");
    expect(await jobsOf(mine.slug)).toHaveLength(EXPECTED.length);
    expect((await powerOf(mine.id)).since).toBeNull();

    await pool.query("delete from spideryarn.jobs where slug = $1", [mine.slug]);
    const replay = await runAsOwner(ADMIN, () => createVoucher({ ...input, highPower: true }, ADMIN, INVITE));
    expect(replay).toEqual({ kind: "replayed", id: input.id });
    expect(await jobsOf(mine.slug)).toEqual([]);
    expect((await powerOf(mine.id)).since).toBeNull();
  });

  it("switches the starter on with highPower", async () => {
    const mine = await seed("voucher-on");
    expect((await runAsOwner(ADMIN, () => createVoucher(voucherFor(mine, "von", true), ADMIN, INVITE))).kind).toBe(
      "created",
    );
    expect((await powerOf(mine.id)).since).not.toBeNull();
    expect(await jobsOf(mine.slug)).toHaveLength(EXPECTED.length);
  });

  it("refuses instead of sending when the starter changed owner before its lock", async () => {
    const mine = await seed("voucher-moved");
    const input = voucherFor(mine, "moved", true);
    const resolveStarter = async (slug: string) => {
      const resolved = await realResolveStarter(slug);
      await pool.query("update spideryarn.articles set owner_id = $2 where id = $1", [mine.id, OPTED_OUT]);
      return resolved;
    };
    const made = await runAsOwner(ADMIN, () => createVoucher(input, ADMIN, { ...INVITE, resolveStarter }));
    expect(made).toEqual({ kind: "starter-refused", reason: "absent" });
    const vouchers = await pool.query("select id from spideryarn.billing_vouchers where id = $1", [input.id]);
    expect(vouchers.rows).toEqual([]);
    expect(await jobsOf(mine.slug)).toEqual([]);
    expect((await powerOf(mine.id)).since).toBeNull();
  });
});

/* ------------------------------------------------------- one transaction -- */

describe("prepareGiftArticleIn", () => {
  it("switches on and queues inside the caller's transaction, so a throw after it undoes both", async () => {
    const mine = await seed("rollback");
    const thrown = new Error("the gift's insert failed after the preparation");
    await expect(
      runAsOwner(ADMIN, () =>
        getDb().transaction(async (tx) => {
          const prep = await prepareGiftArticleIn(tx, mine.id, { highPower: true });
          expect(prep).toMatchObject({ kind: "prepared", switchedOn: true });
          throw thrown;
        }),
      ),
    ).rejects.toBe(thrown);
    expect((await powerOf(mine.id)).since).toBeNull();
    expect(await jobsOf(mine.slug)).toEqual([]);
  });

  it("does nothing to an article that is not the current owner's", async () => {
    const theirs = await seed("not-mine", OPTED_OUT);
    const prep = await runAsOwner(ADMIN, () =>
      getDb().transaction((tx) => prepareGiftArticleIn(tx, theirs.id, { highPower: true })),
    );
    expect(prep).toEqual({ kind: "skipped", reason: "not-owner" });
    expect((await powerOf(theirs.id)).since).toBeNull();
    expect(await jobsOf(theirs.slug)).toEqual([]);
  });
});

/* ----------------------------------------------------------------- routes -- */

describe("POST /api/admin/author-gifts/:id/high-power", () => {
  it("is 404 for no such gift, 200 for a draft, and 409 once it is not a draft; the list says highPower", async () => {
    expect((await drive("POST", `/api/admin/author-gifts/${randomUUID()}/high-power`, null)).status).toBe(404);

    const mine = await seed("route");
    const made = await drive("POST", "/api/admin/author-gifts", { slug: mine.slug, makeLink: false, lookup: false });
    expect(made.status).toBe(201);
    const id = String(made.body.id);
    expect(await jobsOf(mine.slug)).toHaveLength(EXPECTED.length);
    expect(giftIn(await drive("GET", "/api/admin/author-gifts", null), id).highPower).toBe(false);

    const on = await drive("POST", `/api/admin/author-gifts/${id}/high-power`, null);
    expect(on.status).toBe(200);
    /* Every job was already waiting from the gift's own create. */
    expect(on.body).toEqual({ highPower: true, queued: 0 });
    expect((await powerOf(mine.id)).since).not.toBeNull();
    expect(await jobsOf(mine.slug)).toHaveLength(EXPECTED.length);
    expect(giftIn(await drive("GET", "/api/admin/author-gifts", null), id).highPower).toBe(true);

    await pool.query("update spideryarn.author_gifts set discarded_at = now() where id = $1", [id]);
    expect((await drive("POST", `/api/admin/author-gifts/${id}/high-power`, null)).status).toBe(409);
  });

  it("is refused to anybody but the administrator, and switches nothing", async () => {
    const mine = await seed("gate");
    const made = await drive("POST", "/api/admin/author-gifts", { slug: mine.slug, makeLink: false, lookup: false });
    const reply = await drive("POST", `/api/admin/author-gifts/${String(made.body.id)}/high-power`, null, OPTED_OUT);
    expect(reply.status).toBe(403);
    expect((await powerOf(mine.id)).since).toBeNull();
  });

  it("takes highPower on both create bodies as a boolean, and refuses anything else", async () => {
    const mine = await seed("parse");
    const gift = { slug: mine.slug, makeLink: false, lookup: false };
    expect((await drive("POST", "/api/admin/author-gifts", { ...gift, highPower: "yes" })).status).toBe(400);
    const voucher = { ...voucherFor(mine, "p", false), highPower: 1 };
    expect((await drive("POST", "/api/admin/vouchers", voucher)).status).toBe(400);
    expect(await jobsOf(mine.slug)).toEqual([]);

    expect((await drive("POST", "/api/admin/author-gifts", { ...gift, highPower: true })).status).toBe(201);
    expect((await powerOf(mine.id)).since).not.toBeNull();
  });
});

/* ---------------------------------------------------------------- driving -- */

function giftIn(reply: Reply, id: string): AdminAuthorGift {
  const gift = (reply.body.gifts as AdminAuthorGift[]).find((g) => g.id === id);
  if (!gift) throw new Error(`gift ${id} not listed`);
  return gift;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
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
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader() {},
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, signedInAs(owner));
  return { status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}
