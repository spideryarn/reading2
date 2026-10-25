/**
 * **A web note on one cited work, kept and read back — in Postgres.** Plan
 * 261018o stage 2 (docs/plans/261018o-citation-notes-web-search-for-the-clicked-work-and-registry-keys.md
 * § Where it is kept, R4; § Tests, red first, item 3).
 *
 * The rules are `shownWebNote` / `attachWebNotes` (src/citation-web-note-shown.ts);
 * what only the real composition can show is that the store keeps one row per
 * `(article, entry)` in both states, that it is the owner's alone, and that
 * the owner's `loadBibliography` applies those rules to what is in the table:
 *
 * 1. A note saved is read back as saved, with the row as the list stores it.
 * 2. A *none*, then a note, is one row: the note, with nothing of the *none*.
 * 3. An entry the list does not have reads as null; another owner's slug is a 404.
 * 4. The owner's read attaches a stored note whose identity is the stored
 *    row's, hides it when the identity differs, and never shows it on a row
 *    that has an abstract note.
 *
 * No model, no network: the store is called directly.
 */
import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CITATION_BLURBS_VALIDATION_VERSION, rowIdentity } from "../src/citation-blurbs-identity.js";
import { CITATION_WEB_NOTE_PROMPT_VERSION, CITATION_WEB_NOTE_VALIDATION_VERSION } from "../src/citation-web-note-shown.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, citationWebNotes } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import type { Bibliography, BlockId, CitationBlurbEntry, CitationBlurbs, CitationWebNote, CitedWork } from "../src/types.js";
import { asTestOwner, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-citation-web-notes";
/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. */
const ROW_A = "spya-wbnt2a";
const ROW_B = "spya-wbnt2b";
const NOT_IN_LIST = "spya-wbnt2c";

await pgReady({
  suite: "tests/citation-web-notes-pg.test.ts",
  tables: ["spideryarn.revision_blocks", "spideryarn.citation_web_notes"],
  columns: [{ table: "spideryarn.article_revisions", column: "citation_blurbs" }],
});

const { citationWebNoteStore, loadBibliography } = await import("../src/store/index.js");

let article: ScratchArticle | undefined;
let revisionId = "";
let first: BlockId;
let WORK_A: CitedWork;
let WORK_B: CitedWork;

function work(over: Partial<CitedWork> & Pick<CitedWork, "id" | "title">): CitedWork {
  return {
    key: `work:${over.id}`,
    authors: "Kaplan, J.",
    year: "2020",
    why: "The curve the piece extrapolates from.",
    mentions: [],
    citedAt: [first],
    firstCited: first,
    citedInBody: true,
    url: "https://scholar.google.com/scholar?q=x",
    linkFrom: "search",
    ...over,
  };
}

function list(citations: CitedWork[]): Bibliography {
  return {
    version: "citations/6",
    generator: "test",
    slug: SLUG,
    sourceHash: "test",
    citations,
    capped: false,
    generatedAt: "2026-10-18T00:00:00.000Z",
    elapsedMs: 1,
  };
}

function webNote(row: CitedWork, text: string, over: Partial<CitationWebNote> = {}): CitationWebNote {
  return {
    identity: rowIdentity(row),
    validationVersion: CITATION_WEB_NOTE_VALIDATION_VERSION,
    promptVersion: CITATION_WEB_NOTE_PROMPT_VERSION,
    model: "anthropic/claude-haiku-5.5",
    searches: 1,
    checkedAt: "2026-10-19T09:00:00.000Z",
    state: "note",
    sentences: [{ text, quote: "We study empirical scaling laws for language model performance" }],
    url: "https://www.example.org/papers/scaling",
    host: "example.org",
    title: "Scaling Laws for Neural Language Models",
    readAt: "2026-10-19T09:00:00.000Z",
    pageKind: "looks-like",
    ...over,
  } as CitationWebNote;
}

function none(row: CitedWork): CitationWebNote {
  return {
    identity: rowIdentity(row),
    validationVersion: CITATION_WEB_NOTE_VALIDATION_VERSION,
    promptVersion: CITATION_WEB_NOTE_PROMPT_VERSION,
    model: "anthropic/claude-haiku-5.5",
    searches: null,
    checkedAt: "2026-10-19T08:00:00.000Z",
    state: "none",
    why: "none-picked",
  };
}

function blurbs(entries: Record<string, CitationBlurbEntry>): CitationBlurbs {
  return {
    version: "citation-blurbs/1",
    generator: "anthropic/claude-haiku-5.5",
    slug: SLUG,
    sourceHash: "test",
    entries,
    counts: {},
    generatedAt: "2026-10-18T09:00:00.000Z",
    elapsedMs: 1,
  };
}

function abstractNote(row: CitedWork, text: string): CitationBlurbEntry {
  return {
    identity: rowIdentity(row),
    validationVersion: CITATION_BLURBS_VALIDATION_VERSION,
    promptVersion: "citation-blurbs/1",
    model: "anthropic/claude-haiku-5.5",
    at: "2026-10-18T09:00:00.000Z",
    state: "blurb",
    sentences: [{ text, quote: "We study empirical scaling laws for language model performance" }],
    evidence: {
      kind: "author-abstract",
      source: "crossref",
      via: "id",
      workId: "doi:10.1000/given",
      url: "https://doi.org/10.1000/given",
      host: "doi.org",
      readAt: "2026-10-18T08:00:00.000Z",
      evidenceHash: "0123456789abcdef",
    },
  } as CitationBlurbEntry;
}

async function storeList(bibliography: Bibliography, citationBlurbs: CitationBlurbs | null = null): Promise<void> {
  await getDb().update(articleRevisions).set({ bibliography, citationBlurbs }).where(eq(articleRevisions.id, revisionId));
}

async function clearNotes(): Promise<void> {
  if (article) await getDb().delete(citationWebNotes).where(eq(citationWebNotes.articleId, article.articleId));
}

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  first = article.blocks[0]?.id as BlockId;
  WORK_A = work({ id: ROW_A, title: "Scaling Laws for Neural Language Models", url: "https://doi.org/10.1000/given", linkFrom: "doi" });
  WORK_B = work({ id: ROW_B, title: "Attention Is All You Need" });
  const [row] = await getDb()
    .select({ revision: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, article.articleId));
  if (!row?.revision) throw new Error("the scratch article has no current revision");
  revisionId = row.revision;
}, 120_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

describe("citationWebNoteStore", () => {
  it("reads back a saved note, beside the row as the list stores it", async () => {
    await clearNotes();
    await storeList(list([WORK_A, WORK_B]));
    const saved = webNote(WORK_A, "It measures how loss falls as models grow.");
    await asTestOwner(() => citationWebNoteStore.save(SLUG, ROW_A, saved));
    const got = await asTestOwner(() => citationWebNoteStore.read(SLUG, ROW_A));
    expect(got?.row).toEqual(WORK_A);
    expect(got?.note).toEqual(saved);
    /* A row with nothing kept reads as no note, not as null. */
    expect(await asTestOwner(() => citationWebNoteStore.read(SLUG, ROW_B))).toEqual({ row: WORK_B, note: null });
  });

  it("keeps one row per entry: a none overwritten by a note leaves nothing of the none, and keeps created_at", async () => {
    await clearNotes();
    await storeList(list([WORK_A, WORK_B]));
    await asTestOwner(() => citationWebNoteStore.save(SLUG, ROW_B, none(WORK_B)));
    expect((await asTestOwner(() => citationWebNoteStore.read(SLUG, ROW_B)))?.note).toEqual(none(WORK_B));
    const where = and(eq(citationWebNotes.articleId, article?.articleId ?? ""), eq(citationWebNotes.entryId, ROW_B));
    const [before] = await getDb().select({ createdAt: citationWebNotes.createdAt }).from(citationWebNotes).where(where);

    const note = webNote(WORK_B, "It proposes a model built on attention alone.", { title: null });
    await asTestOwner(() => citationWebNoteStore.save(SLUG, ROW_B, note));
    const rows = await getDb().select().from(citationWebNotes).where(where);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.why).toBeNull();
    expect(rows[0]?.state).toBe("note");
    expect(rows[0]?.ownerId).toBe(TEST_OWNER);
    expect(rows[0]?.createdAt?.toISOString()).toBe(before?.createdAt?.toISOString());
    expect((await asTestOwner(() => citationWebNoteStore.read(SLUG, ROW_B)))?.note).toEqual(note);
  });

  it("reads an entry the list does not have as null", async () => {
    await storeList(list([WORK_A, WORK_B]));
    expect(await asTestOwner(() => citationWebNoteStore.read(SLUG, NOT_IN_LIST))).toBeNull();
  });

  it("answers 404 to another owner, reading or writing", async () => {
    const stranger = randomUUID() as OwnerId;
    await expect(runAsOwner(stranger, () => citationWebNoteStore.read(SLUG, ROW_A))).rejects.toMatchObject({ status: 404 });
    await expect(
      runAsOwner(stranger, () => citationWebNoteStore.save(SLUG, ROW_A, webNote(WORK_A, "Theirs."))),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses at the database a note without its page, and a none without its reason", async () => {
    const base = {
      articleId: article?.articleId ?? "",
      ownerId: TEST_OWNER,
      identity: "x",
      model: "m",
      promptVersion: "p",
      validationVersion: "v",
      checkedAt: new Date(),
    };
    await expect(getDb().insert(citationWebNotes).values({ ...base, entryId: NOT_IN_LIST, state: "note" })).rejects.toThrow();
    await expect(getDb().insert(citationWebNotes).values({ ...base, entryId: NOT_IN_LIST, state: "none" })).rejects.toThrow();
    await expect(
      getDb().insert(citationWebNotes).values({ ...base, entryId: NOT_IN_LIST, state: "none", why: "made-up" }),
    ).rejects.toThrow();
    /* 261025d: a page kind only beside a note, and only one of the two. */
    await expect(
      getDb().insert(citationWebNotes).values({ ...base, entryId: NOT_IN_LIST, state: "none", why: "not-the-work", pageKind: "own" }),
    ).rejects.toThrow();
    const page = { sentences: [{ text: "t", quote: "q" }], url: "https://doi.org/10.1/x", host: "doi.org", readAt: new Date() };
    await expect(
      getDb().insert(citationWebNotes).values({ ...base, entryId: NOT_IN_LIST, state: "note", ...page, pageKind: "certain" }),
    ).rejects.toThrow();
  });

  it("reads a note from before the page kind as own, and keeps the page kind a later press writes", async () => {
    const page = { sentences: [{ text: "t", quote: "q" }], url: "https://doi.org/10.1/x", host: "doi.org", readAt: new Date() };
    /* The writer deployed before this column names no page kind; it must still be able to write. */
    const columns = {
      identity: "stale",
      model: "m",
      promptVersion: "p",
      validationVersion: "v",
      checkedAt: new Date(),
      state: "note",
      why: null,
      title: null,
      ...page,
    };
    await getDb()
      .insert(citationWebNotes)
      .values({ articleId: article?.articleId ?? "", ownerId: TEST_OWNER, entryId: ROW_B, ...columns })
      .onConflictDoUpdate({ target: [citationWebNotes.articleId, citationWebNotes.entryId], set: { ...columns, pageKind: null } });
    const old = await asTestOwner(() => citationWebNoteStore.read(SLUG, ROW_B));
    expect(old?.note).toMatchObject({ state: "note", pageKind: "own" });
    /* A stale identity, so the later tests' lists still show nothing on this row. */
    await asTestOwner(() => citationWebNoteStore.save(SLUG, ROW_B, webNote(WORK_B, "t", { identity: "stale" })));
    const later = await asTestOwner(() => citationWebNoteStore.read(SLUG, ROW_B));
    expect(later?.note).toMatchObject({ state: "note", pageKind: "looks-like" });
  });
});

describe("the owner's loadBibliography and a stored web note", () => {
  const shown = async (): Promise<Record<string, string | null>> => {
    const owned = await asTestOwner(() => loadBibliography(SLUG));
    return Object.fromEntries(
      owned.bibliography.citations.map((w) => [w.id, w.webNote?.sentences.map((s) => s.text).join(" ") ?? null]),
    );
  };

  it("attaches a note whose identity is the stored row's", async () => {
    await clearNotes();
    await storeList(list([WORK_A, WORK_B]));
    await asTestOwner(() => citationWebNoteStore.save(SLUG, ROW_A, webNote(WORK_A, "It measures how loss falls as models grow.")));
    expect(await shown()).toEqual({ [ROW_A]: "It measures how loss falls as models grow.", [ROW_B]: null });
    const owned = await asTestOwner(() => loadBibliography(SLUG));
    expect(owned.bibliography.citations[0]?.webNote?.host).toBe("example.org");
  });

  it("hides it when the list made again changed the row", async () => {
    await clearNotes();
    await storeList(list([WORK_A, WORK_B]));
    await asTestOwner(() => citationWebNoteStore.save(SLUG, ROW_A, webNote(WORK_A, "It measures how loss falls as models grow.")));
    await storeList(list([{ ...WORK_A, title: "Scaling Laws, Revisited" }, WORK_B]));
    expect(await shown()).toEqual({ [ROW_A]: null, [ROW_B]: null });
  });

  it("does not show it on a row that has an abstract note", async () => {
    await clearNotes();
    await storeList(list([WORK_A, WORK_B]), blurbs({ [ROW_A]: abstractNote(WORK_A, "From the abstract.") }));
    await asTestOwner(() => citationWebNoteStore.save(SLUG, ROW_A, webNote(WORK_A, "From the web.")));
    await asTestOwner(() => citationWebNoteStore.save(SLUG, ROW_B, webNote(WORK_B, "From the web, for B.")));
    const owned = await asTestOwner(() => loadBibliography(SLUG));
    const a = owned.bibliography.citations.find((w) => w.id === ROW_A);
    expect(a?.blurb?.sentences[0]?.text, "the abstract note is attached").toBe("From the abstract.");
    expect(a?.webNote).toBeUndefined();
    expect(await shown()).toEqual({ [ROW_A]: null, [ROW_B]: "From the web, for B." });
  });
});
