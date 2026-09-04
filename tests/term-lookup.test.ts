/**
 * `lookUpTerm` — the per-entry web lookup, now `src/term-lookup.ts`.
 *
 * It lived in `src/api.ts` until 2026-08-26, reading `glossary.json`,
 * `blocks.json` and `meta.json` off the disk itself, which made it unreachable
 * from a Postgres store. It is store-independent orchestration now, and
 * `src/store/index.ts` builds one out of whichever adapters are live — so most
 * of this file drives it through **that**, which is the wiring a route
 * actually reaches, rather than through a hand-built one that could be right
 * while the wiring is wrong.
 *
 * Three guards are tested here: an unknown slug is a 404, a slug that is not one
 * is refused outright, an unknown term must not reach a model call, and neither
 * must a term the article does not contain. **There were four**, and the fourth
 * — the committed `example/` must not be writable — went with the store it was
 * about; see the note at the end of this header.
 *
 * **What is new is the successful path.** The old tests deliberately stopped
 * short of it because it makes a model call — which is exactly why the review
 * of this step insisted `explain` and the clock be injectable. Without that
 * there is no way to assert the two things that happen *after* the answer
 * arrives and are easy to get silently wrong: the citation filter, and that
 * what the reader selected is a form of the term the article really uses.
 *
 * See docs/project/glossary.md and
 * docs/plans/260826e-postgres-storage-implementation.md § `lookUpTerm` has to move out.
 *
 * ## The guards ran on the filesystem store until 2026-09-04
 *
 * `src/store/index.ts` builds `lookUpTerm` out of whichever adapters are live,
 * so *which* wiring this file drove was decided by `SPIDERYARN_STORE` — and
 * unset meant the four guards were being asserted against the store that does
 * not deploy. They now run against Postgres, over one article seeded out of the
 * committed corpus with an extra glossary entry naming somebody the piece never
 * mentions. docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § B.
 *
 * **One assertion was dropped rather than translated, and this is the record of
 * it.** `lookUpTerm("example", …)` rejecting with `/built-in example/` was the
 * `assertWritable` 403, and `src/store/index.ts` passes `assertWritable` **only
 * when the store is not Postgres** — because the 403 exists to stop a lookup
 * editing the one committed article directory in the repo, and Postgres has no
 * such directory and no such article. Building a Postgres fixture so that a
 * filesystem-shaped guard could go on being tested would be a green test
 * proving nothing. The 404-for-an-unknown-slug half of that case is real under
 * either store and is kept, in a case of its own. Stage G's *enumerate every
 * surviving assertion* pass should find this paragraph rather than a gap.
 *
 * ## The mutation, watched red on 2026-09-04
 *
 * `glossary: { ...glossary, entries }` in `pgArticleReader.loadGlossary`
 * (src/store/pg.ts) replaced by `entries: []` — the line that hands back the
 * terms the revision actually holds, with the stored lookups merged in. *refuses
 * a term the article does not actually contain* fails, its 409 becoming
 * `No glossary term "spya-zzzzzz"`, which is the proof that the entry this file
 * seeds really does come back out of Postgres rather than out of a file.
 *
 * **What it does not cover.** Only the read half, and only the entry list: the
 * lookup merge two lines above it, `stale`, `outdated` and the `blockHashInputs`
 * query are all untouched and nothing here would notice them going wrong. It
 * says nothing at all about the *write* — `pgGlossaryLookupStore.save`, which
 * the successful path below drives through an injected fake rather than through
 * the wiring, so no Postgres write is exercised by this file at any point. And
 * the fourth guard stayed green under the mutation, because "no such term" is
 * exactly what an emptied list produces.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, before **any** import runs — `src/store/live.ts`
 * reads the flag once and imports are hoisted above every statement.
 * `src/store/index.ts` reads it at module load to pick each adapter *and* to
 * decide whether `lookUpTerm` gets an `assertWritable`, so this has to be true
 * before that file is evaluated.
 */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { lookUpTerm, STORE } from "../src/store/index.js";
import { makeLookUpTerm } from "../src/term-lookup.js";
import type { Block, GlossaryLookup, GlossaryResponse } from "../src/types.js";
import type { LookupsByTerm } from "../src/glossary-lookups.js";
import type { Article } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

loadEnvLocal();

const { reachable } = await pgReady({
  suite: "tests/term-lookup.test.ts",
  tables: ["spideryarn.articles", "spideryarn.article_revisions"],
});

const when = reachable ? describe : describe.skip;

/** A throwaway slug, so nothing here is read or written by anybody else. */
const SLUG = "test-term-lookup-guards";

/**
 * The id of the entry added below, and of one that is not there at all.
 *
 * `ABSENT_TERM` names a person the corpus article never mentions, which is what
 * makes the 409 assertable: every entry `writes` ships with is matched by its
 * name or one of its aliases somewhere in the text.
 */
const ABSENT_TERM = "spya-zzzzzz";
const NO_SUCH_TERM = "spya-yyyyyy";

let article: ScratchArticle | undefined;

/**
 * Every call below, as the reader who owns the fixture.
 *
 * **Not optional, and not the same as the process's own owner.** Outside a
 * request `currentOwnerId()` is `environmentOwnerId()`, which reads
 * `SPIDERYARN_OWNER_ID` out of `.env.local` — a different uuid on every box —
 * while the Postgres reader filters every article by owner (`ownedSlug` in
 * src/store/pg.ts). Seeding as one and reading as the other made the third case
 * below fail with *"No article artefacts"*, and — the part worth writing down —
 * left the two 404 cases **passing for the wrong reason**, because a 404 from
 * "this article is not yours" is indistinguishable from a 404 from "there is no
 * such term". `refuses a term the article does not actually contain` is the
 * control that keeps them honest: it can only reach its 409 through a glossary
 * *and* an article this owner can see.
 */
const lookUp = (slug: string, termId: string): Promise<unknown> =>
  runAsOwner(DEV_OWNER_ID, () => lookUpTerm(slug, termId));

/**
 * Put one unmatchable entry into the corpus article's glossary on the way in.
 *
 * `mutate` runs on the **clone**, after the copy and before the load, so what it
 * writes is what goes into Postgres — `ScratchOptions.mutate`. Appending rather
 * than replacing, because the five entries already there are what the other
 * suites over this fixture assert on, and because an entry that *is* matched is
 * the control for the one that is not.
 */
async function addAnUnmatchableTerm(dir: string): Promise<void> {
  const at = path.join(dir, "glossary.json");
  const glossary = JSON.parse(await readFile(at, "utf8")) as { entries: unknown[] };
  glossary.entries = [
    ...glossary.entries,
    {
      id: ABSENT_TERM,
      name: "Barbara Liskov",
      kind: "person",
      aliases: [],
      background: "Somebody the article never mentions.",
      difficulty: 0.2,
      centrality: 0.1,
      blocks: [],
    },
  ];
  await writeFile(at, JSON.stringify(glossary));
}

describe("the store this file's wiring was built from", () => {
  it("is the Postgres one", () => {
    /* Not gated on the database being up, deliberately. A flag that failed to
       take would build `lookUpTerm` out of the filesystem adapters *and* hand it
       an `assertWritable`, which is a different function with a different guard
       — and three of the four cases below would still pass. A control that
       vanishes when Postgres is missing vanishes exactly when it matters. */
    expect(STORE).toBe("postgres");
  });
});

when("the guards, through the store's own wiring", () => {
  beforeAll(async () => {
    /* `DEV_OWNER_ID`, because these calls are made outside a request and
       `currentOwnerId()` is the environment's owner there — an article seeded as
       anybody else is invisible to the reader and every case below would be a
       404 for the wrong reason. */
    article = await scratchArticleInPg(SLUG, {
      ownerId: DEV_OWNER_ID,
      mutate: addAnUnmatchableTerm,
    });
  }, 120_000);

  afterAll(async () => {
    await article?.remove();
    await closeDb();
  }, 60_000);

  it("answers 404 for a slug no article holds", async () => {
    /* A typo is a 404, not a 403 — `articleDir` used to fall through to
       `example/` for any slug with no output of its own, which is what put an
       unknown slug one request away from writing into the committed fixture
       (src/api.ts § `candidateDirs`). This used to be the second half of a case
       whose first half was the `example/` 403; see the note in this file's
       header for why that half is gone and this one is not. */
    await expect(lookUp("no-such-article-slug", "spya-k3m9qt")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("rejects a slug that is not one", async () => {
    // Path traversal, refused where every other read-side entry point refuses
    // it — see docs/project/security.md.
    await expect(lookUp("../../etc", "spya-k3m9qt")).rejects.toThrow();
  });

  it("refuses a term the article does not actually contain", async () => {
    /* Two failures reviewed into one refusal. The anchor used to fall back to
       the article's first block, so a term the model named but the piece never
       uses was announced to the model as a passage the reader had selected in
       an unrelated paragraph. And the quote used to be `entry.name`, while
       `findOccurrences` matches on the name *or an alias* — on the one real
       glossary we have, three entries of five are matched by an alias, so the
       request claimed the reader had selected words that were not on the page.

       Both are refused before any model call, which is what makes this
       assertable without a network. */
    await expect(lookUp(SLUG, ABSENT_TERM)).rejects.toThrow(
      /does not appear in this article/,
    );
  });

  it("refuses a term id that is not in the glossary at all", async () => {
    await expect(lookUp(SLUG, NO_SUCH_TERM)).rejects.toMatchObject({ status: 404 });
  });
});

/* ------------------------------------------------- the successful path -- */

/** A reader, a lookup store and an `explain`, all under this test's control. */
function harness(opts: {
  text: string;
  entry: { id: string; name: string; aliases: string[]; blocks: string[] };
  citations: { url: string; title?: string }[];
}) {
  const block: Block = {
    id: "spya-aaaaaa" as Block["id"],
    kind: "text",
    tag: "p",
    gistable: true,
    html: `<p>${opts.text}</p>`,
    text: opts.text,
    words: opts.text.split(/\s+/).length,
  };
  const article = {
    meta: { slug: "harness", title: "A piece" },
    blocks: [block],
    tree: { rootId: block.id, nodes: {} },
  } as unknown as Article;

  /** What `explain` was asked, so the test can assert on the request. */
  const asked: { blockId: string; quote: string }[] = [];
  const saved: { termId: string; lookup: GlossaryLookup }[] = [];

  const lookUp = makeLookUpTerm({
    reader: {
      loadArticle: async () => article,
      loadGlossary: async () =>
        ({
          glossary: { entries: [{ ...opts.entry, kind: "term", background: "" }] },
          stale: false,
          outdated: false,
        }) as unknown as GlossaryResponse,
    },
    lookups: {
      load: async (): Promise<LookupsByTerm> => ({}),
      save: async (_slug, termId, lookup): Promise<LookupsByTerm> => {
        saved.push({ termId, lookup });
        return { [termId]: lookup };
      },
    },
    explain: async (req) => {
      asked.push({ blockId: req.blockId, quote: req.quote });
      return {
        answer: "An answer.",
        citations: opts.citations,
        searches: 2,
        model: "a-model",
      };
    },
    now: () => "2026-08-26T00:00:00.000Z",
  });

  return { lookUp, asked, saved };
}

describe("what the model is asked, and what is kept from its answer", () => {
  it("quotes the form of the term the article actually uses", async () => {
    /* The block says "JFK" and the entry is called "John F. Kennedy". Telling
       the model the reader selected words that are not in the paragraph is a
       false premise handed to a model asked to reason from it — and it is
       invisible from the outside, because the answer comes back looking fine. */
    const { lookUp, asked } = harness({
      text: "JFK was assassinated in 1963.",
      entry: {
        id: "spya-kennedy",
        name: "John F. Kennedy",
        aliases: ["JFK"],
        blocks: ["spya-aaaaaa"],
      },
      citations: [],
    });
    await lookUp("harness", "spya-kennedy");
    expect(asked).toEqual([{ blockId: "spya-aaaaaa", quote: "JFK" }]);
  });

  it("prefers the longest form present, so a block with both gets the specific one", async () => {
    const { lookUp, asked } = harness({
      text: "John F. Kennedy, known as JFK, was assassinated in 1963.",
      entry: {
        id: "spya-kennedy",
        name: "John F. Kennedy",
        aliases: ["JFK"],
        blocks: ["spya-aaaaaa"],
      },
      citations: [],
    });
    await lookUp("harness", "spya-kennedy");
    expect(asked[0]?.quote).toBe("John F. Kennedy");
  });

  it("drops a citation whose URL is not one a browser should follow", async () => {
    /* This is the moment a model-supplied string stops being a value in flight
       and becomes one the panel will put in an `href`. `safeUrl` is what stands
       between the two, and the only way to watch it work is to drive a
       successful answer through — which is why `explain` is injectable. */
    const { lookUp, saved } = harness({
      text: "JFK was assassinated in 1963.",
      entry: {
        id: "spya-kennedy",
        name: "John F. Kennedy",
        aliases: ["JFK"],
        blocks: ["spya-aaaaaa"],
      },
      citations: [
        { url: "https://example.com/jfk", title: "A page" },
        { url: "javascript:alert(1)" },
      ],
    });
    const { entry } = await lookUp("harness", "spya-kennedy");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.lookup.citations).toEqual([
      { url: "https://example.com/jfk", title: "A page" },
    ]);
    // And what the client is handed is the same answer, not a second one.
    expect(entry.lookup?.citations).toEqual([{ url: "https://example.com/jfk", title: "A page" }]);
    expect(entry.lookup?.at).toBe("2026-08-26T00:00:00.000Z");
  });

  it("stores the answer under the entry's id, because ids are identity", async () => {
    // A later pass may merge or rename this term; `merge` keeps the incumbent's
    // id precisely so a `?term=` link survives, and the lookup survives with it.
    const { lookUp, saved } = harness({
      text: "JFK was assassinated in 1963.",
      entry: {
        id: "spya-kennedy",
        name: "John F. Kennedy",
        aliases: ["JFK"],
        blocks: ["spya-aaaaaa"],
      },
      citations: [],
    });
    await lookUp("harness", "spya-kennedy");
    expect(saved[0]?.termId).toBe("spya-kennedy");
    expect(saved[0]?.lookup.model).toBe("a-model");
    expect(saved[0]?.lookup.searches).toBe(2);
  });
});
