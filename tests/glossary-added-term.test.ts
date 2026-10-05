/**
 * **A term the reader looked up, added to their own glossary** — through
 * Postgres: `pgGlossaryLookupStore.addTerm` (src/store/pg-lookups.ts), the
 * owner's read (`loadGlossary`, src/store/pg.ts), hide (src/store/pg-glossary-hidden.ts)
 * and the public read (src/store/public-reader.ts).
 * docs/plans/261002f-glossary-add-a-looked-up-term.md.
 *
 * 1. **Added, then drawn**: the next owner's read has the entry, marked
 *    `added`, with the answer as its `lookup` and its blocks found.
 * 2. **Already there is not added again** — by the model's entry, by an
 *    earlier added one (the plural folds), and the hidden flag says which.
 * 3. **Two tabs at once make one entry**, even when their names differ.
 * 4. **Hide works on an added term.**
 * 5. **A later model entry for the same words wins**, and takes the reader's
 *    explanation when it has none of its own.
 * 6. **A stranger's slug is a 404 and writes nothing.**
 * 7. **No glossary, nothing added.**
 * 8. **A visitor to the shared article sees none of it.**
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, glossaryLookups } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { EVAL_OWNER_ID, runAsOwner } from "../src/owner.js";
import type { Glossary, GlossaryEntry, GlossaryLookup } from "../src/types.js";
import { TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-glossary-added-term";
const STRANGERS = "test-glossary-added-term-strangers";
const BARE = "test-glossary-added-term-bare";

/* Well-formed ids in the id alphabet, used by no other test file. */
const MODEL = "spya-adt2kp";
const LATER = "spya-adt3wq";

await pgReady({
  suite: "tests/glossary-added-term.test.ts",
  tables: ["spideryarn.glossary_lookups", "spideryarn.glossary_hidden_entries"],
});

const { pgArticleReader } = await import("../src/store/pg.js");
const { pgGlossaryLookupStore } = await import("../src/store/pg-lookups.js");
const { pgGlossaryHiddenStore } = await import("../src/store/pg-glossary-hidden.js");
const { pgPublicReader } = await import("../src/store/public-reader.js");
const { PUBLIC_ONLY } = await import("../src/store/public-access.js");

let article: ScratchArticle | undefined;
let strangers: ScratchArticle | undefined;
let bare: ScratchArticle | undefined;

/** A word from the article's own prose, and the block it is in — so the added term has somewhere to be. */
let word = "";
let wordBlock = "";

function entry(id: string, name: string): GlossaryEntry {
  return { id, name, kind: "concept", aliases: [], senseHere: `What ${name} means here.`, blocks: [] };
}

async function setEntries(which: ScratchArticle | undefined, entries: GlossaryEntry[] | null) {
  if (!which) throw new Error("no scratch article");
  const db = getDb();
  const [row] = await db
    .select({ revisionId: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, which.articleId));
  if (!row?.revisionId) throw new Error(`${which.slug} has no current revision`);
  const glossary =
    entries === null
      ? null
      : {
          version: "glossary/3",
          generator: "test",
          sourceHash: "f".repeat(64),
          passes: 1,
          generatedAt: "2026-10-02T00:00:00.000Z",
          elapsedMs: 1,
          slug: which.slug,
          entries,
        };
  await db
    .update(articleRevisions)
    .set({ glossary: glossary as unknown as Glossary })
    .where(eq(articleRevisions.id, row.revisionId));
}

const lookup = (answer: string): GlossaryLookup => ({
  answer,
  citations: [],
  searches: 0,
  model: "a-model",
  at: "2026-10-02T00:00:00.000Z",
});

const asOwner = <T>(work: () => Promise<T>) => runAsOwner(TEST_OWNER, work);

async function addedRows(which: ScratchArticle | undefined) {
  if (!which) throw new Error("no scratch article");
  return getDb()
    .select({ entryId: glossaryLookups.entryId, addedName: glossaryLookups.addedName })
    .from(glossaryLookups)
    .where(and(eq(glossaryLookups.articleId, which.articleId), isNotNull(glossaryLookups.addedName)));
}

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  strangers = await scratchArticleInPg(STRANGERS, { ownerId: EVAL_OWNER_ID });
  bare = await scratchArticleInPg(BARE, { ownerId: TEST_OWNER });
  /* The first all-letter word of six or more, so it cannot be a fragment the
     model entry below also names. */
  for (const block of article.blocks) {
    const found = block.text?.match(/\b[A-Za-z]{6,}\b/);
    if (found) {
      word = found[0];
      wordBlock = block.id;
      break;
    }
  }
  if (!word) throw new Error("the fixture has no word to look up");
  await setEntries(article, [entry(MODEL, "Zzyzx protocol")]);
  await setEntries(strangers, [entry(MODEL, "Zzyzx protocol")]);
  await setEntries(bare, null);
}, 120_000);

afterAll(async () => {
  await article?.remove();
  await strangers?.remove();
  await bare?.remove();
  await closeDb();
});

describe("adding a looked-up term", () => {
  it("adds it, and the owner's next read draws it with its answer and its blocks", async () => {
    const result = await asOwner(() =>
      pgGlossaryLookupStore.addTerm(SLUG, { name: word.toLowerCase(), quote: word, lookup: lookup("The answer.") }),
    );
    expect(result.kind).toBe("added");
    if (result.kind !== "added") return;
    expect(result.entryId).not.toBe(MODEL);

    const { glossary } = await asOwner(() => pgArticleReader.loadGlossary(SLUG));
    const added = glossary.entries.find((e) => e.id === result.entryId);
    expect(added).toMatchObject({ name: word.toLowerCase(), added: true, kind: "term" });
    expect(added?.lookup?.answer).toBe("The answer.");
    expect(added?.blocks).toContain(wordBlock);
    expect(added?.hidden).toBeUndefined();
    /* The model's entry is still there, untouched, and not marked as added. */
    expect(glossary.entries.find((e) => e.id === MODEL)?.added).toBeUndefined();
  });

  it("does not add it twice: the plural is the same term", async () => {
    const before = await addedRows(article);
    const again = await asOwner(() =>
      pgGlossaryLookupStore.addTerm(SLUG, { name: `${word}s`, quote: `${word}s`, lookup: lookup("Again.") }),
    );
    expect(again).toEqual({ kind: "existing", entryId: before[0]?.entryId, hidden: false });
    expect(await addedRows(article)).toEqual(before);
  });

  it("does not add a term the model's list already names, and says when that entry is hidden", async () => {
    const shown = await asOwner(() =>
      pgGlossaryLookupStore.addTerm(SLUG, { name: "zzyzx protocol", quote: "Zzyzx Protocol", lookup: lookup("x") }),
    );
    expect(shown).toEqual({ kind: "existing", entryId: MODEL, hidden: false });

    await asOwner(() => pgGlossaryHiddenStore.hide(SLUG, MODEL));
    const hidden = await asOwner(() =>
      pgGlossaryLookupStore.addTerm(SLUG, { name: "zzyzx protocol", quote: "Zzyzx Protocol", lookup: lookup("x") }),
    );
    expect(hidden).toEqual({ kind: "existing", entryId: MODEL, hidden: true });
    await asOwner(() => pgGlossaryHiddenStore.unhide(SLUG, MODEL));
  });

  it("does not mint an id already used by an entry in the glossary document", async () => {
    const collision = "spya-aaaaaa";
    await setEntries(article, [entry(MODEL, "Zzyzx protocol"), entry(collision, "Another term")]);
    let calls = 0;
    const random = vi.spyOn(Math, "random").mockImplementation(() => (calls++ < 6 ? 0 : 0.1));
    try {
      const result = await asOwner(() =>
        pgGlossaryLookupStore.addTerm(SLUG, {
          name: "collision target",
          quote: "collision target",
          lookup: lookup("An answer."),
        }),
      );
      expect(result.kind).toBe("added");
      if (result.kind === "added") expect(result.entryId).not.toBe(collision);
    } finally {
      random.mockRestore();
      await setEntries(article, [entry(MODEL, "Zzyzx protocol")]);
    }
  });

  it("makes one entry when two tabs add the same words at once, even under different names", async () => {
    /* **Made deterministic rather than raced.** `Promise.all` over two adds
       passed with the lock deleted, three runs in three — the two
       transactions simply did not overlap — so it proved nothing. Here the
       other tab is a transaction that holds the article row and inserts
       *quokka hop*; this add of *quokka hops* must wait for it, then see it.
       Without the lock it would read before the commit and add a second. */
    if (!article) throw new Error("no scratch article");
    const articleId = article.articleId;
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const otherTab = getDb().transaction(async (tx) => {
      await tx.select({ id: articles.id }).from(articles).where(eq(articles.id, articleId)).for("update");
      await tx.insert(glossaryLookups).values({
        articleId,
        entryId: "spya-adt4yz",
        ownerId: TEST_OWNER,
        answer: "a",
        citations: [],
        searches: 0,
        model: "a-model",
        at: new Date(),
        addedName: "quokka hop",
      });
      locked();
      await released;
    });
    await isLocked;
    let settled = false;
    const mine = asOwner(() =>
      pgGlossaryLookupStore.addTerm(SLUG, { name: "quokka hops", quote: "quokka hops", lookup: lookup("b") }),
    ).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled, "the add did not wait for the article row").toBe(false);
    release();
    await otherTab;
    expect(await mine).toEqual({ kind: "existing", entryId: "spya-adt4yz", hidden: false });
    const rows = (await addedRows(article)).filter((r) => r.addedName?.startsWith("quokka"));
    expect(rows).toHaveLength(1);
  });

  it("hides and unhides an added term like any other", async () => {
    const [row] = await addedRows(article);
    if (!row) throw new Error("nothing was added");
    await asOwner(() => pgGlossaryHiddenStore.hide(SLUG, row.entryId));
    let { glossary } = await asOwner(() => pgArticleReader.loadGlossary(SLUG));
    expect(glossary.entries.find((e) => e.id === row.entryId)?.hidden).toBe(true);
    await asOwner(() => pgGlossaryHiddenStore.unhide(SLUG, row.entryId));
    ({ glossary } = await asOwner(() => pgArticleReader.loadGlossary(SLUG)));
    expect(glossary.entries.find((e) => e.id === row.entryId)?.hidden).toBeUndefined();
  });

  it("gives way to a later model entry for the same words, which takes the reader's answer", async () => {
    const [row] = (await addedRows(article)).filter((r) => r.addedName === word.toLowerCase());
    if (!row) throw new Error("nothing was added");
    /* A *Find more* that found the same term: a model entry with no lookup.
       The old hide deliberately stays on the added id rather than following. */
    await asOwner(() => pgGlossaryHiddenStore.hide(SLUG, row.entryId));
    const { senseHere: _none, ...model } = entry(LATER, word);
    await setEntries(article, [entry(MODEL, "Zzyzx protocol"), model]);
    const { glossary } = await asOwner(() => pgArticleReader.loadGlossary(SLUG));
    expect(glossary.entries.some((e) => e.id === row.entryId)).toBe(false);
    const winner = glossary.entries.find((e) => e.id === LATER);
    expect(winner?.added).toBeUndefined();
    expect(winner?.hidden).toBeUndefined();
    expect(winner?.lookup?.answer).toBe("The answer.");
    /* The row is kept: it is still the reader's. */
    expect((await addedRows(article)).some((r) => r.entryId === row.entryId)).toBe(true);
    await asOwner(() => pgGlossaryHiddenStore.unhide(SLUG, row.entryId));
    await setEntries(article, [entry(MODEL, "Zzyzx protocol")]);
  });
});

describe("what it will not do", () => {
  it("refuses a stranger's article with a 404 and writes nothing", async () => {
    const outcome = await asOwner(() =>
      pgGlossaryLookupStore.addTerm(STRANGERS, { name: word, quote: word, lookup: lookup("x") }),
    ).then(
      () => undefined,
      (err: Error & { status?: number }) => err.status,
    );
    expect(outcome).toBe(404);
    expect(await addedRows(strangers)).toEqual([]);
  });

  it("adds nothing to an article with no glossary", async () => {
    const result = await asOwner(() =>
      pgGlossaryLookupStore.addTerm(BARE, { name: word, quote: word, lookup: lookup("x") }),
    );
    expect(result).toEqual({ kind: "no-glossary" });
    expect(await addedRows(bare)).toEqual([]);
  });

  it("shows a visitor to the shared article none of the reader's added terms", async () => {
    if (!article) throw new Error("no scratch article");
    const added = await addedRows(article);
    expect(added.length).toBeGreaterThan(0);
    await getDb().update(articles).set({ visibility: "public" }).where(eq(articles.id, article.articleId));
    try {
      const shared = await pgPublicReader.loadArticle(SLUG, PUBLIC_ONLY);
      const ids = (shared.glossary?.entries ?? []).map((e) => e.id);
      expect(ids).toContain(MODEL);
      for (const row of added) expect(ids).not.toContain(row.entryId);
      expect(JSON.stringify(shared)).not.toContain("The answer.");
    } finally {
      await getDb().update(articles).set({ visibility: "private" }).where(eq(articles.id, article.articleId));
    }
  });
});
