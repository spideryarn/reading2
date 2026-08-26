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
 * The four guards were tested before and still are: the fixture must not be
 * writable, an unknown slug is not a slug, an unknown term must not reach a
 * model call, and neither must a term the article does not contain.
 *
 * **What is new is the successful path.** The old tests deliberately stopped
 * short of it because it makes a model call — which is exactly why the review
 * of this step insisted `explain` and the clock be injectable. Without that
 * there is no way to assert the two things that happen *after* the answer
 * arrives and are easy to get silently wrong: the citation filter, and that
 * what the reader selected is a form of the term the article really uses.
 *
 * See docs/project/glossary.md and
 * docs/plans/postgres-storage-implementation.md § `lookUpTerm` has to move out.
 */

import { afterAll, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { lookUpTerm } from "../src/store/index.js";
import { makeLookUpTerm } from "../src/term-lookup.js";
import { PROMPT_VERSION } from "../src/glossary.js";
import { hashBlocks } from "../src/source-hash.js";
import type { Block, GlossaryLookup, GlossaryResponse } from "../src/types.js";
import type { LookupsByTerm } from "../src/glossary-lookups.js";
import type { Article } from "../src/types.js";

const slugs: string[] = [];

afterAll(async () => {
  for (const slug of slugs) {
    await rm(path.join(process.cwd(), "data", slug), { recursive: true, force: true });
  }
});

/** One paragraph, one term, on disk under `data/`. Returns the slug. */
async function fixture(opts: {
  suffix: string;
  text: string;
  entry: Record<string, unknown>;
}): Promise<string> {
  const slug = `zz-test-lookup-${process.pid}-${opts.suffix}`;
  slugs.push(slug);
  const dir = path.join(process.cwd(), "data", slug);
  await mkdir(dir, { recursive: true });
  const blocks: Block[] = [
    {
      id: "spya-aaaaaa" as Block["id"],
      kind: "text",
      tag: "p",
      gistable: true,
      html: `<p>${opts.text}</p>`,
      text: opts.text,
      words: opts.text.split(/\s+/).length,
    },
  ];
  await writeFile(path.join(dir, "blocks.json"), JSON.stringify({ blocks }));
  await writeFile(path.join(dir, "tree.json"), JSON.stringify({ rootId: "spya-aaaaaa", nodes: {} }));
  await writeFile(
    path.join(dir, "glossary.json"),
    JSON.stringify({
      version: PROMPT_VERSION,
      generator: "a-model",
      slug,
      sourceHash: hashBlocks(blocks),
      entries: [opts.entry],
      passes: 1,
      generatedAt: "2026-08-25T12:00:00.000Z",
      elapsedMs: 1,
    }),
  );
  return slug;
}

describe("the guards, through the store's own wiring", () => {
  it("refuses to write into the built-in example", async () => {
    /* `articleDir` falls through to `example/` for any slug with no output of
       its own — including a slug that does not exist — so without this guard a
       lookup on a typo would edit the one committed directory in the repo. The
       same guard `deleteGlossary` carries, for the same reason. It is the one
       piece of this that is genuinely filesystem-shaped: Postgres has no
       fixture to fall into and 404s an unknown slug instead. */
    await expect(lookUpTerm("no-such-article-slug", "spya-k3m9qt")).rejects.toThrow(
      /built-in example/,
    );
    await expect(lookUpTerm("example", "spya-k3m9qt")).rejects.toThrow(/built-in example/);
  });

  it("rejects a slug that is not one", async () => {
    // Path traversal, refused where every other read-side entry point refuses
    // it — see docs/project/security.md.
    await expect(lookUpTerm("../../etc", "spya-k3m9qt")).rejects.toThrow();
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
    const slug = await fixture({
      suffix: "unmatched",
      text: "Nothing relevant here.",
      entry: {
        id: "spya-zzzzzz",
        name: "Leslie Lamport",
        kind: "person",
        aliases: [],
        background: "Somebody the article never mentions.",
        blocks: [],
      },
    });
    await expect(lookUpTerm(slug, "spya-zzzzzz")).rejects.toThrow(/does not appear in this article/);
  });

  it("refuses a term id that is not in the glossary at all", async () => {
    const slug = await fixture({
      suffix: "unknown-term",
      text: "Nothing relevant here.",
      entry: {
        id: "spya-zzzzzz",
        name: "Leslie Lamport",
        kind: "person",
        aliases: [],
        background: "Somebody the article never mentions.",
        blocks: [],
      },
    });
    await expect(lookUpTerm(slug, "spya-yyyyyy")).rejects.toMatchObject({ status: 404 });
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
