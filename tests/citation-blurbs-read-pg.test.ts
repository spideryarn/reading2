/**
 * **A cited work's note, read back — the owner's and a visitor's, in
 * Postgres.** Plan 261017h stage 3c (docs/plans/261017h-stage-3-design-citation-blurbs.md
 * § 7 item 8, and the design review's G5 and G8).
 *
 * The rules are `shownBlurb` (src/citation-blurbs-identity.ts); what only the
 * real composition can show is that both reads apply them to what is in the
 * column: the owner's `loadBibliography` (`attachBlurbs`) and a visitor's
 * `pgPublicReader.loadArticle` (the public query, then `publicCitedWork`),
 * which never goes through the owner's read.
 *
 * 1. A note whose identity matches its row as stored, under today's checks,
 *    is on the row for both — and a newer prompt or model does not hide it.
 * 2. A list made again that changes a row's title or link hides that row's
 *    note, for both; the other row keeps its own.
 * 3. A row that vanished from the list shows nothing, and an entry for it
 *    attaches to nothing.
 * 4. An entry that passed older checks (G8) is hidden for both.
 * 5. The owner's *Find it* turns a searched row into a `web` one on read; the
 *    note, fingerprinted on the stored row, stays.
 *
 * No model, no network: the column is written directly.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CITATION_BLURBS_VALIDATION_VERSION, rowIdentity } from "../src/citation-blurbs-identity.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { PUBLIC_ONLY } from "../src/store/public-access.js";
import type { Bibliography, BlockId, CitationBlurbEntry, CitationBlurbs, CitedWork } from "../src/types.js";
import { asTestOwner, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-citation-blurbs-read";
/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. */
const DOI_ROW = "spya-bwrd2a";
const SEARCH_ROW = "spya-bwrd2b";

await pgReady({
  suite: "tests/citation-blurbs-read-pg.test.ts",
  tables: ["spideryarn.revision_blocks", "spideryarn.citation_finds"],
  columns: [{ table: "spideryarn.article_revisions", column: "citation_blurbs" }],
});

const { citationFindStore, loadBibliography } = await import("../src/store/index.js");
const { pgPublicReader } = await import("../src/store/public-reader.js");

let article: ScratchArticle | undefined;
let revisionId = "";
let first: BlockId;

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
    url: "https://doi.org/10.1000/given",
    linkFrom: "doi",
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

function note(row: CitedWork, text: string, over: Partial<CitationBlurbEntry> = {}): CitationBlurbEntry {
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
      url: "https://stored-address-never-shown.example",
      host: "doi.org",
      readAt: "2026-10-18T08:00:00.000Z",
      evidenceHash: "0123456789abcdef",
    },
    ...over,
  } as CitationBlurbEntry;
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

async function store(bibliography: Bibliography, citationBlurbs: CitationBlurbs): Promise<void> {
  await getDb().update(articleRevisions).set({ bibliography, citationBlurbs }).where(eq(articleRevisions.id, revisionId));
}

/** Each row's note text, by id, as the owner's read and a visitor's read have it. */
async function notes(): Promise<{ owner: Record<string, string | null>; visitor: Record<string, string | null> }> {
  const owned = await asTestOwner(() => loadBibliography(SLUG));
  const shared = await pgPublicReader.loadArticle(SLUG, PUBLIC_ONLY);
  const text = (ws: readonly { id: string; blurb?: { sentences: { text: string }[] } }[]) =>
    Object.fromEntries(ws.map((w) => [w.id, w.blurb?.sentences.map((s) => s.text).join(" ") ?? null]));
  return { owner: text(owned.bibliography.citations), visitor: text(shared.bibliography?.citations ?? []) };
}

let DOI_WORK: CitedWork;
let SEARCH_WORK: CitedWork;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  first = article.blocks[0]?.id as BlockId;
  DOI_WORK = work({ id: DOI_ROW, title: "Scaling Laws for Neural Language Models" });
  SEARCH_WORK = work({
    id: SEARCH_ROW,
    title: "Attention Is All You Need",
    url: "https://scholar.google.com/scholar?q=attention",
    linkFrom: "search",
  });
  const [row] = await getDb()
    .select({ revision: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, article.articleId));
  if (!row?.revision) throw new Error("the scratch article has no current revision");
  revisionId = row.revision;
  await getDb().update(articles).set({ visibility: "public", publicAt: new Date() }).where(eq(articles.id, article.articleId));
}, 120_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

describe("a cited work's note, read back by the owner and by a visitor", () => {
  it("is on its row while it matches the row as stored; a newer prompt or model does not hide it", async () => {
    await store(
      list([DOI_WORK, SEARCH_WORK]),
      blurbs({
        [DOI_ROW]: note(DOI_WORK, "It measures how loss falls as models grow."),
        [SEARCH_ROW]: note(SEARCH_WORK, "It proposes a model built on attention alone.", {
          promptVersion: "citation-blurbs/99",
          model: "some-newer-model",
        }),
      }),
    );
    const got = await notes();
    const both = {
      [DOI_ROW]: "It measures how loss falls as models grow.",
      [SEARCH_ROW]: "It proposes a model built on attention alone.",
    };
    expect(got.owner).toEqual(both);
    expect(got.visitor).toEqual(both);
    /* The address is code's, from the DOI — never the stored one. */
    const owned = await asTestOwner(() => loadBibliography(SLUG));
    expect(owned.bibliography.citations[0]?.blurb?.url).toBe("https://doi.org/10.1000/given");
    expect(JSON.stringify(owned)).not.toContain("stored-address-never-shown");
  });

  it("is hidden for a row whose title or link a new list changed, and the other row keeps its own", async () => {
    const entries = {
      [DOI_ROW]: note(DOI_WORK, "It measures how loss falls as models grow."),
      [SEARCH_ROW]: note(SEARCH_WORK, "It proposes a model built on attention alone."),
    };
    await store(list([{ ...DOI_WORK, title: "Scaling Laws, Revisited" }, SEARCH_WORK]), blurbs(entries));
    let got = await notes();
    expect(got.owner).toEqual({ [DOI_ROW]: null, [SEARCH_ROW]: "It proposes a model built on attention alone." });
    expect(got.visitor).toEqual(got.owner);

    await store(list([DOI_WORK, { ...SEARCH_WORK, url: "https://arxiv.org/abs/1706.03762", linkFrom: "arxiv" }]), blurbs(entries));
    got = await notes();
    expect(got.owner).toEqual({ [DOI_ROW]: "It measures how loss falls as models grow.", [SEARCH_ROW]: null });
    expect(got.visitor).toEqual(got.owner);
  });

  it("shows nothing for a row that left the list, and an orphaned entry attaches to nothing", async () => {
    await store(
      list([DOI_WORK]),
      blurbs({
        [DOI_ROW]: note(DOI_WORK, "It measures how loss falls as models grow."),
        [SEARCH_ROW]: note(SEARCH_WORK, "It proposes a model built on attention alone."),
      }),
    );
    const got = await notes();
    expect(got.owner).toEqual({ [DOI_ROW]: "It measures how loss falls as models grow." });
    expect(got.visitor).toEqual(got.owner);
  });

  it("hides a note that passed older checks (G8), for both", async () => {
    await store(
      list([DOI_WORK, SEARCH_WORK]),
      blurbs({
        [DOI_ROW]: note(DOI_WORK, "It measures how loss falls as models grow.", {
          validationVersion: "citation-blurbs-checks/0",
        }),
        [SEARCH_ROW]: note(SEARCH_WORK, "It proposes a model built on attention alone."),
      }),
    );
    const got = await notes();
    expect(got.owner).toEqual({ [DOI_ROW]: null, [SEARCH_ROW]: "It proposes a model built on attention alone." });
    expect(got.visitor).toEqual(got.owner);
  });

  it("keeps a searched row's note when the owner's Find it upgraded its link on read", async () => {
    await store(
      list([DOI_WORK, SEARCH_WORK]),
      blurbs({ [SEARCH_ROW]: note(SEARCH_WORK, "It proposes a model built on attention alone.") }),
    );
    await asTestOwner(() =>
      citationFindStore.save(SLUG, SEARCH_ROW, {
        url: "https://example.org/attention",
        title: "Attention Is All You Need",
        host: "example.org",
        searches: 1,
        model: "test",
        at: new Date().toISOString(),
      }),
    );
    const owned = await asTestOwner(() => loadBibliography(SLUG));
    const row = owned.bibliography.citations.find((w) => w.id === SEARCH_ROW);
    expect(row?.linkFrom, "the find was attached").toBe("web");
    expect(row?.blurb?.sentences[0]?.text).toBe("It proposes a model built on attention alone.");
  });
});
