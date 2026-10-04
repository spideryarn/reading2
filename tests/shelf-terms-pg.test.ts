/**
 * **The shelf's filter terms, through Postgres** — src/store/pg-shelf-terms.ts
 * and `GET /api/library/terms`. docs/plans/260928a-shelf-facet-terms.md
 * § Stage 2.
 *
 * 1. **A fill is written once and reused**: a sentinel written over a stored
 *    row survives the next shelf load, which it could not if anything
 *    re-extracted.
 * 2. **Concurrent same-version fills** both succeed and leave one row each.
 * 3. **A v1 and a v2 row coexist**, and each version reads only its own.
 * 4. **A new current revision gets its own row, and the superseded one goes.**
 * 5. **A stale writer after republication** deletes itself without deleting a
 *    current-revision row written by another extractor version.
 * 6. **The budget** leaves `pending > 0`, and a second call finishes.
 * 7. **Reader A's request creates no row for B, returns no B slug, and no
 *    B-only phrase** — with the control that B's own request does return it,
 *    so the absence is not the phrase merely failing to be a topic.
 * 8. **Archived scope**, in and out.
 * 9. **Shelf parity**: an unreadable published revision is absent from both
 *    the library and the terms set, and receives no cache row.
 * 10. **The route**: auth as `/api/library`, `private, no-store`, the shape.
 *
 * Two owners of this file's own, seeded here, so the shelves under test hold
 * exactly what this file put on them.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  revisionBlocks,
  revisionPhraseRuns,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { runAsOwner, type OwnerId } from "../src/owner.js";
import { EXTRACTOR_VERSION } from "../src/shelf-terms/extract.js";
import {
  currentShelfRevisions,
  extractRevision,
  fillPhraseRuns,
  missingRuns,
  readPhraseRuns,
  shelfTerms,
  writePhraseRun,
} from "../src/store/pg-shelf-terms.js";
import { listArticles } from "../src/store/index.js";
import type { LibraryTermsResponse, Tree } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

await pgReady({
  suite: "tests/shelf-terms-pg.test.ts",
  tables: ["spideryarn.revision_phrase_runs", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");

const OWNER_A = "00000000-0000-4000-8000-0000000057a1" as OwnerId;
const OWNER_B = "00000000-0000-4000-8000-0000000057b2" as OwnerId;
const PREFIX = "test-shelf-terms-pg-";

/** Two-word topics, each landing in three or four of A's ten articles — inside the band. */
const A_TOPICS = [
  "coral reef",
  "neural network",
  "medieval castle",
  "quantum computer",
  "jazz trumpet",
  "desert irrigation",
];
/** B's shelf, with one phrase A never uses. */
const B_ONLY = "zanzibar marmalade";
const B_TOPICS = [B_ONLY, "copper kettle", "violin bow", "glacier moraine", "tidal estuary", "paper lantern"];
/** One made-up word per article, so no two share a text hash. */
const UNIQUE = ["amberwick", "bramblefen", "cindermoss", "dovecrest", "emberlyn", "fernhollow", "gildenrow", "hazelmere", "ivorygate", "junipersk", "kestrelby"];

const ALPHABET = "abcdefghjkmnpqrstuvwxyz023456789";
/** The `n`th well-formed block id with this lead letter (src/ids.ts). */
function blockId(lead: string, n: number): string {
  let body = "";
  for (let i = 0, rest = n; i < 5; i++, rest = Math.floor(rest / 32)) body = ALPHABET.charAt(rest % 32) + body;
  return `spya-${lead}${body}`;
}

function paragraphs(topics: readonly string[], unique: string): string[] {
  return topics.flatMap((t) => [
    `The ${t} is the subject of this piece, and the ${t} is what the ${unique} keeps coming back to.`,
    `In the end it is the ${t} that matters to the ${unique}, and it is not a small thing to have seen.`,
  ]);
}

const db = () => getDb();
let blockCounter = 0;

/** A published revision with these paragraphs; returns its id. */
async function addRevision(
  articleId: string,
  title: string,
  paras: string[],
  fetchedAt: Date,
  readable = true,
): Promise<string> {
  const [rev] = await db()
    .insert(articleRevisions)
    .values({
      articleId,
      status: "published",
      title,
      fetchedAt,
      ...(readable
        ? {
            /* Presence is the shelf boundary under test. All cached scalars
               are supplied, so listArticles never interprets this minimal
               legacy-shaped fixture. */
            tree: { rootId: "r", nodes: { r: { id: "r", depth: 0 } } } as unknown as Tree,
            wordCount: paras.join(" ").split(/\s+/).length,
            blockCount: paras.length,
            partCount: 0,
            sectionCount: 0,
          }
        : {}),
    })
    .returning({ id: articleRevisions.id });
  if (!rev) throw new Error("no revision");
  const ids = paras.map(() => blockId("t", blockCounter++));
  await db().insert(blockIdentities).values(ids.map((id) => ({ articleId, blockId: id }))).onConflictDoNothing();
  await db()
    .insert(revisionBlocks)
    .values(
      paras.map((text, i) => ({
        articleId,
        revisionId: rev.id,
        blockId: ids[i] ?? "",
        ordinal: i,
        tag: "p",
        kind: "text" as const,
        text,
        words: text.split(/\s+/).length,
        html: `<p>${text}</p>`,
        gistable: true,
      })),
    );
  return rev.id;
}

interface Made {
  slug: string;
  articleId: string;
  revisionId: string;
}

async function makeArticle(
  owner: OwnerId,
  slug: string,
  paras: string[],
  opts: { archived?: boolean; day: number; readable?: boolean },
): Promise<Made> {
  const [a] = await db()
    .insert(articles)
    .values({ ownerId: owner, slug, archivedAt: opts.archived ? new Date() : null })
    .returning({ id: articles.id });
  if (!a) throw new Error("no article");
  const fetchedAt = new Date(Date.UTC(2026, 0, 1 + opts.day));
  const revisionId = await addRevision(a.id, slug, paras, fetchedAt, opts.readable ?? true);
  await db().update(articles).set({ currentRevisionId: revisionId }).where(eq(articles.id, a.id));
  return { slug, articleId: a.id, revisionId };
}

async function cleanUp(): Promise<void> {
  await db().delete(articles).where(like(articles.slug, `${PREFIX}%`));
}

async function rowsFor(articleIds: readonly string[]) {
  if (!articleIds.length) return [];
  return db().select().from(revisionPhraseRuns).where(inArray(revisionPhraseRuns.articleId, [...articleIds]));
}

async function clearRows(articleIds: readonly string[]): Promise<void> {
  await db().delete(revisionPhraseRuns).where(inArray(revisionPhraseRuns.articleId, [...articleIds]));
}

const asA = <T>(fn: () => Promise<T>) => runAsOwner(OWNER_A, fn);
const asB = <T>(fn: () => Promise<T>) => runAsOwner(OWNER_B, fn);

let aActive: Made[] = [];
let aArchived: Made | undefined;
let bArticles: Made[] = [];
const allA = () => [...aActive, ...(aArchived ? [aArchived] : [])];

beforeAll(async () => {
  await seedAuthUser(db(), { id: OWNER_A, email: "a-shelf-terms-pg@example.invalid", onConflictDoNothing: true });
  await seedAuthUser(db(), { id: OWNER_B, email: "b-shelf-terms-pg@example.invalid", onConflictDoNothing: true });
  await cleanUp();

  aActive = [];
  for (let i = 0; i < 10; i++) {
    const topics = [A_TOPICS[i % 6] ?? "", A_TOPICS[(i + 1) % 6] ?? ""];
    aActive.push(await makeArticle(OWNER_A, `${PREFIX}a-${i}`, paragraphs(topics, UNIQUE[i] ?? ""), { day: i }));
  }
  aArchived = await makeArticle(
    OWNER_A,
    `${PREFIX}a-archived`,
    paragraphs([A_TOPICS[0] ?? "", A_TOPICS[3] ?? ""], UNIQUE[10] ?? ""),
    { archived: true, day: 20 },
  );

  bArticles = [];
  for (let i = 0; i < 10; i++) {
    const topics = [B_TOPICS[i % 6] ?? "", B_TOPICS[(i + 1) % 6] ?? ""];
    bArticles.push(await makeArticle(OWNER_B, `${PREFIX}b-${i}`, paragraphs(topics, `b${UNIQUE[i] ?? ""}`), { day: i }));
  }
}, 120_000);

afterAll(async () => {
  await cleanUp();
  await closeDb();
});

describe("the shelf's filter terms in Postgres", () => {
  it("fills every current revision once, and a second load reuses the rows rather than re-extracting", async () => {
    const ids = aActive.map((a) => a.articleId);
    await clearRows(ids);
    const first = await asA(() => shelfTerms({ archived: false }));
    expect(first.pending).toBe(0);
    expect(first.scope.articles).toBe(10);
    expect(first.terms.length).toBeGreaterThan(0);

    const rows = await rowsFor(ids);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.revisionId))).toEqual(new Set(aActive.map((a) => a.revisionId)));
    expect(rows.every((r) => r.extractorVersion === EXTRACTOR_VERSION)).toBe(true);

    /* A sentinel over one stored row, which the answer can see. The row is not
       enough on its own: a load that re-extracted would meet the stored row,
       conflict, do nothing and leave it untouched. So the sentinel says the
       article was *skipped* — something the extractor would never say about
       this English prose — and the answer's `skipped` count can only be 1 if
       the stored row, not a fresh extraction, is what the chooser was given. */
    const target = aActive[0];
    if (!target) throw new Error("no article");
    expect(first.scope.skipped).toBe(0);
    const before = rows.find((r) => r.revisionId === target.revisionId);
    await db()
      .update(revisionPhraseRuns)
      .set({ skipped: "no-text", candidates: [] })
      .where(eq(revisionPhraseRuns.revisionId, target.revisionId));

    const set = await asA(() => currentShelfRevisions({ archived: false }));
    const runs = await asA(() => readPhraseRuns(set));
    expect(missingRuns(set, runs)).toEqual([]);
    expect(runs.get(target.revisionId)?.skipped).toBe("no-text");

    const second = await asA(() => shelfTerms({ archived: false }));
    expect(second.pending).toBe(0);
    expect(second.scope.articles).toBe(10);
    expect(second.scope.works).toBe(9);
    expect(second.scope.skipped).toBe(1);
    const after = await rowsFor(ids);
    expect(after).toHaveLength(10);
    const again = after.find((r) => r.revisionId === target.revisionId);
    expect(again?.skipped).toBe("no-text");
    expect(again?.computedAt.getTime()).toBe(before?.computedAt.getTime());
  });

  it("lets two concurrent fills of the same version both succeed, leaving one row per revision", async () => {
    const ids = aActive.map((a) => a.articleId);
    await clearRows(ids);
    const set = await asA(() => currentShelfRevisions({ archived: false }));
    const missing = missingRuns(set, await asA(() => readPhraseRuns(set)));
    expect(missing).toHaveLength(10);
    const [x, y] = await asA(() =>
      Promise.all([
        fillPhraseRuns(missing, { budgetMs: 60_000 }),
        fillPhraseRuns(missing, { budgetMs: 60_000 }),
      ]),
    );
    expect(x?.pending).toBe(0);
    expect(y?.pending).toBe(0);
    const rows = await rowsFor(ids);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.revisionId)).size).toBe(10);
  });

  it("keeps a row of another extractor version beside this one's, and each version reads only its own", async () => {
    const target = aActive[1];
    if (!target) throw new Error("no article");
    const other = EXTRACTOR_VERSION + 1;
    const future = [{ key: "future phrase", label: "future phrase", count: 3, bodyCount: 3, score: 3 }];
    await db()
      .insert(revisionPhraseRuns)
      .values({
        revisionId: target.revisionId,
        articleId: target.articleId,
        extractorVersion: other,
        words: 1,
        textHash: "future",
        skipped: null,
        candidates: future,
      })
      .onConflictDoNothing();

    await asA(() => shelfTerms({ archived: false }));
    const rows = (await rowsFor([target.articleId])).filter((r) => r.revisionId === target.revisionId);
    expect(rows.map((r) => r.extractorVersion).sort()).toEqual([EXTRACTOR_VERSION, other]);

    const set = await asA(() => currentShelfRevisions({ archived: false }));
    const mine = await asA(() => readPhraseRuns(set));
    expect(mine.get(target.revisionId)?.textHash).not.toBe("future");
    const theirs = await asA(() => readPhraseRuns(set, other));
    expect([...theirs.keys()]).toEqual([target.revisionId]);
    expect(theirs.get(target.revisionId)?.candidates).toEqual(future);
  });

  it("gives a new current revision its own row, and deletes the superseded revision's rows", async () => {
    const target = aActive[2];
    if (!target) throw new Error("no article");
    await asA(() => shelfTerms({ archived: false }));
    const oldRows = (await rowsFor([target.articleId])).filter((r) => r.revisionId === target.revisionId);
    expect(oldRows.length).toBeGreaterThan(0);

    const newRevision = await addRevision(
      target.articleId,
      target.slug,
      paragraphs([A_TOPICS[2] ?? "", A_TOPICS[4] ?? ""], "republished"),
      new Date(Date.UTC(2026, 0, 3)),
    );
    await db().update(articles).set({ currentRevisionId: newRevision }).where(eq(articles.id, target.articleId));
    target.revisionId = newRevision;

    const res = await asA(() => shelfTerms({ archived: false }));
    expect(res.pending).toBe(0);
    const rows = await rowsFor([target.articleId]);
    /* Only the new revision's, of every version: the v2 row the previous case
       left on the old revision went with it. */
    expect(rows.map((r) => r.revisionId)).toEqual([newRevision]);
  });

  it("makes a stale post-publication writer delete itself without deleting the current revision's other version", async () => {
    const target = aActive[3];
    if (!target) throw new Error("no article");
    await clearRows([target.articleId]);
    const oldEntry = (await asA(() => currentShelfRevisions({ archived: false }))).find(
      (entry) => entry.articleId === target.articleId,
    );
    if (!oldEntry) throw new Error("old revision is not on the shelf");
    const oldRun = await asA(() => extractRevision(oldEntry));

    const newRevision = await addRevision(
      target.articleId,
      target.slug,
      paragraphs([A_TOPICS[1] ?? "", A_TOPICS[5] ?? ""], "concurrent-republication"),
      /* Older than every fixture, so this republication does not become the
         shelf's newest article and move the budget case's "newest first". */
      new Date(Date.UTC(2025, 11, 1)),
    );
    await db().update(articles).set({ currentRevisionId: newRevision }).where(eq(articles.id, target.articleId));
    target.revisionId = newRevision;
    const newEntry = (await asA(() => currentShelfRevisions({ archived: false }))).find(
      (entry) => entry.articleId === target.articleId,
    );
    if (!newEntry) throw new Error("new revision is not on the shelf");
    const newRun = await asA(() => extractRevision(newEntry));

    const otherVersion = EXTRACTOR_VERSION + 1;
    await asA(() => writePhraseRun(newEntry, newRun, otherVersion));
    await asA(() => writePhraseRun(oldEntry, oldRun));
    expect((await rowsFor([target.articleId])).map((r) => [r.revisionId, r.extractorVersion])).toEqual([
      [newRevision, otherVersion],
    ]);

    await asA(() => writePhraseRun(newEntry, newRun));
    expect(
      (await rowsFor([target.articleId])).map((r) => r.extractorVersion).sort((a, b) => a - b),
    ).toEqual([EXTRACTOR_VERSION, otherVersion]);
  });

  it("stops at the budget with pending > 0, and a second call finishes", async () => {
    const ids = aActive.map((a) => a.articleId);
    await clearRows(ids);
    const first = await asA(() => shelfTerms({ archived: false }, { budgetMs: 0 }));
    /* At least one per call, so the loop cannot spin; with a zero budget, exactly one. */
    expect(first.pending).toBe(9);
    expect(await rowsFor(ids)).toHaveLength(1);
    /* The newest article first. */
    const newest = [...aActive].sort((x, y) => y.slug.localeCompare(x.slug))[0];
    expect((await rowsFor(ids))[0]?.articleId).toBe(newest?.articleId);

    const second = await asA(() => shelfTerms({ archived: false }));
    expect(second.pending).toBe(0);
    expect(await rowsFor(ids)).toHaveLength(10);
  });

  it("reader A's request writes no row for B, returns no B slug, and no B-only phrase", async () => {
    const bIds = bArticles.map((b) => b.articleId);
    await clearRows(bIds);
    const a = await asA(() => shelfTerms({ archived: true }));
    expect(a.pending).toBe(0);
    expect(await rowsFor(bIds)).toHaveLength(0);

    const bSlugs = new Set(bArticles.map((b) => b.slug));
    const aSlugs = new Set(allA().map((x) => x.slug));
    for (const t of a.terms) {
      for (const art of t.articles) {
        expect(bSlugs.has(art.slug)).toBe(false);
        expect(aSlugs.has(art.slug)).toBe(true);
      }
    }
    const said = JSON.stringify(a).toLowerCase();
    expect(said).not.toContain("zanzibar");
    expect(said).not.toContain("marmalade");

    /* The control: on B's own shelf the phrase IS a topic, so its absence
       above is isolation and not the phrase failing to qualify. */
    const b = await asB(() => shelfTerms({ archived: false }));
    expect(b.terms.map((t) => t.key)).toContain(B_ONLY);
    expect(await rowsFor(bIds)).toHaveLength(10);
  });

  it("leaves archived articles out by default, and takes them in with archived: true", async () => {
    if (!aArchived) throw new Error("no archived article");
    await clearRows([aArchived.articleId]);

    const active = await asA(() => shelfTerms({ archived: false }));
    expect(active.scope.articles).toBe(10);
    expect(await rowsFor([aArchived.articleId])).toHaveLength(0);
    expect(JSON.stringify(active)).not.toContain(aArchived.slug);

    const both = await asA(() => shelfTerms({ archived: true }));
    expect(both.scope.articles).toBe(11);
    expect(both.pending).toBe(0);
    expect(await rowsFor([aArchived.articleId])).toHaveLength(1);
    expect(JSON.stringify(both)).toContain(aArchived.slug);
  });

  it("uses the same readable-revision set as the library shelf", async () => {
    const hidden = await makeArticle(
      OWNER_A,
      `${PREFIX}a-no-tree`,
      paragraphs([A_TOPICS[0] ?? "", A_TOPICS[1] ?? ""], "treeless"),
      { day: 30, readable: false },
    );
    try {
      const [set, shelf] = await asA(() =>
        Promise.all([currentShelfRevisions({ archived: false }), listArticles({ archived: false })]),
      );
      expect(set.some((a) => a.slug === hidden.slug)).toBe(false);
      expect(shelf.some((a) => a.slug === hidden.slug)).toBe(false);
      expect(await rowsFor([hidden.articleId])).toHaveLength(0);
    } finally {
      await db().delete(articles).where(eq(articles.id, hidden.articleId));
    }
  });
});

/* ------------------------------------------------------------------ route -- */

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

async function request(url: string, headers: Record<string, string>): Promise<Reply> {
  const req = Object.assign(
    (async function* () {})(),
    { method: "GET", url, headers },
  ) as unknown as IncomingMessage;
  let written = "";
  const set: Record<string, string> = {};
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader(name: string, value: string) {
      set[name.toLowerCase()] = String(value);
    },
    getHeader(name: string) {
      return set[name.toLowerCase()];
    },
    writeHead(s: number) {
      (this as { statusCode: number }).statusCode = s;
    },
    flushHeaders() {},
    on() {},
    write(piece: string) {
      written += piece;
      return true;
    },
    end(piece?: string) {
      if (piece) written += piece;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return {
    status: (res as unknown as { statusCode: number }).statusCode,
    headers: set,
    body: written ? JSON.parse(written) : null,
  };
}

describe("GET /api/library/terms", () => {
  it("refuses an unauthenticated request exactly as /api/library does", async () => {
    const terms = await request("/api/library/terms", {});
    const library = await request("/api/library", {});
    expect(terms.status).toBe(401);
    expect(terms.status).toBe(library.status);
  });

  it("answers the signed-in reader with the envelope, sent private and no-store", async () => {
    for (const url of ["/api/library/terms", "/api/library/terms?archived=1"]) {
      const reply = await request(url, AUTHED_HEADERS);
      expect(reply.status).toBe(200);
      expect(reply.headers["cache-control"]).toBe("private, no-store");
      const body = reply.body as LibraryTermsResponse;
      expect(Array.isArray(body.terms)).toBe(true);
      expect(typeof body.scope.articles).toBe("number");
      expect(typeof body.scope.works).toBe("number");
      expect(typeof body.scope.skipped).toBe("number");
      expect(typeof body.pending).toBe("number");
    }
  });

  it("neither returns nor writes anything of this file's owners for the route's reader", async () => {
    const ids = [...allA(), ...bArticles].map((x) => x.articleId);
    await clearRows(ids);
    const reply = await request("/api/library/terms?archived=1", AUTHED_HEADERS);
    expect(reply.status).toBe(200);
    expect(JSON.stringify(reply.body)).not.toContain(PREFIX);
    expect(await rowsFor(ids)).toHaveLength(0);
  });
});
