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
 * **Mutation.** `glossary: { ...glossary, entries }` in
 * `pgArticleReader.loadGlossary` (src/store/pg.ts) replaced by `entries: []` —
 * the line that hands back the terms the revision actually holds, with the
 * stored lookups merged in. Re-run 2026-09-04: *1 failed | 8 passed (9)*,
 * *refuses a term the article does not actually contain*, `expected [Function]
 * to throw error matching /does not appear in this article/ but got 'No
 * glossary term "spya-zzzzzz" in "te…'`. That is the proof the entry this file
 * seeds comes back out of Postgres rather than out of a file.
 *
 * **Blind to.** Only the read half, and only the entry list: the lookup merge
 * two lines above it, `stale`, `outdated` and the `blockHashInputs` query are
 * all untouched and nothing here would notice them going wrong. It
 * says nothing at all about the *write* — `pgGlossaryLookupStore.save`, which
 * the successful path below drives through an injected fake rather than through
 * the wiring, so no Postgres write is exercised by this file at any point. And
 * the fourth guard stayed green under the mutation, because "no such term" is
 * exactly what an emptied list produces.
 *
 * ## The sentence that guard matched on is gone
 *
 * The mutation above quotes `/does not appear in this article/`, which was the
 * one sentence three different refusals shared until a reader reported reading
 * it as a denial that their glossary entry existed. It is two sentences and two
 * codes now, and this file matches the codes —
 * docs/postmortems/260904c-the-glossary-said-the-term-was-not-there.md, and
 * tests/glossary-lookup-refusals.test.ts for which fact goes with which.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { lookUpTerm } from "../src/store/index.js";
import { makeLookUpTerm } from "../src/term-lookup.js";
import type { Block, GlossaryLookup, GlossaryResponse } from "../src/types.js";
import type { LookupsByTerm } from "../src/glossary-lookups.js";
import type { Article } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";


loadEnvLocal();

await pgReady({
  suite: "tests/term-lookup.test.ts",
  tables: ["spideryarn.articles", "spideryarn.article_revisions"],
});

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

describe("the guards, through the store's own wiring", () => {
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
    /* **Matched on the code, not the sentence** — docs/project/copy.md § The
       bracketed code. It matched `/does not appear in this article/` until
       2026-09-04, which pinned the wording of the very sentence a reader
       reported as unreadable, and would have gone red for the fix rather than
       for a regression.

       **Either code, and that is not vagueness.** Which of the two fires
       depends on whether this fixture's glossary reads as `stale`, and that is
       a property of the corpus this box happens to hold: `sourceHash` was
       written against the full article and a worktree carries a cut of it, so
       the same seeding is stale here and need not be elsewhere. Pinning one
       would be pinning the checkout. What this case is *for* — a term the
       article does not contain never reaches a model call — is true of both,
       and `tests/glossary-lookup-refusals.test.ts` drives `stale` itself to
       assert which sentence goes with which fact. */
    await expect(lookUp(SLUG, ABSENT_TERM)).rejects.toThrow(/\[gl-(not-quoted|stale)\]/);

    /* The reported bug, asserted against the real wiring: whichever branch
       fires, the reader is not told the term they are looking at does not
       exist. */
    await expect(lookUp(SLUG, ABSENT_TERM)).rejects.not.toThrow(/Barbara Liskov/);
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
