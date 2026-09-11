/**
 * **What "Check the web" says when it cannot run**, and which of two different
 * facts it is saying.
 *
 * Written after a reader reported that the button *"said that the phrase in the
 * glossary … didn't exist even though it clearly did, because there was a
 * glossary entry for it and I can see it right there on the page"*
 * (2026-09-04). It did. `lookUpTerm` collapsed three unrelated situations into
 * one sentence that named the term and said it *"does not appear in this
 * article"*, and the reader read that as a claim about the entry they were
 * looking at.
 *
 * What the article actually supports saying is one question — **does the piece
 * use this term anywhere?** — and, when it does not, one more:
 *
 * 1. **The list fits the article and the article never quotes the term.**
 *    `[gl-not-quoted]`. Ordinary and permanent: 5 of the 141 glossary entries in
 *    the local corpus on 2026-09-04, where the model named a person or a debate
 *    the piece alludes to rather than spells out. Nothing to do.
 * 2. **The list was written for an older version of the article.**
 *    `[gl-stale]` — *find the terms again*, and the panel is already showing the
 *    banner with that button.
 *
 * Two things this file pins that the first version of the fix got wrong, both
 * found by GPT Sol reviewing it:
 *
 * - **An empty `entry.blocks` is not evidence about the current article.** A
 *   glossary is *carried* into every new revision (`glossary: "carry"`,
 *   src/store/pg-revisions.ts), so a carried entry can say "used nowhere" about
 *   an article that now quotes the term in every paragraph. Reading it as
 *   *the article never quotes this* is the reported bug wearing a new sentence.
 * - **The anchor is found in the article, not in `entry.blocks`.** It was
 *   `entry.blocks[0]` and nothing else, so a term used in five places was
 *   refused the moment the first of them changed.
 * - **Staleness is computed here from the two objects in hand**, not taken off
 *   the glossary response — `loadGlossary` and `loadArticle` are two reads
 *   through `articles.current_revision_id` and a publish can move it between
 *   them. So the harness below drives the `sourceHash` and deliberately reports
 *   the *opposite* flag, and a `lookUpTerm` that trusts the flag fails three
 *   cases here.
 *
 * **Matched on the bracketed code, never on the sentence** — docs/project/copy.md
 * § The bracketed code. Rewriting this copy should not turn this file red; the
 * branch it fired from should.
 *
 * Driven through `makeLookUpTerm` with an injected reader rather than through a
 * store, because every case here is decided *before* the model call, which is
 * the whole point of it — see tests/term-lookup.test.ts for the cases that need
 * the real Postgres wiring.
 */
import { describe, expect, it } from "vitest";

import { articleFingerprint } from "../src/source-hash.js";
import { makeLookUpTerm } from "../src/term-lookup.js";
import type { LookupsByTerm } from "../src/glossary-lookups.js";
import type { Article, Block, GlossaryResponse, Tree } from "../src/types.js";

/** One paragraph, with an id a test can name. */
function para(id: string, text: string): Block {
  return {
    id: id as Block["id"],
    kind: "text",
    tag: "p",
    gistable: true,
    html: `<p>${text}</p>`,
    text,
    words: text.split(/\s+/).length,
  };
}

/**
 * An article, a one-entry glossary and an `explain` that records what it was
 * asked — the same shape as tests/term-lookup.test.ts's harness, widened to
 * several blocks because that is what the anchor rule is about, and to a
 * settable staleness because that is what the two refusals turn on.
 */
function harness(opts: {
  blocks: Block[];
  entry: { id: string; name: string; aliases: string[]; blocks: string[] };
  stale?: boolean;
}) {
  const meta = { slug: "harness", title: "A piece" };
  const tree = { rootId: opts.blocks[0]?.id, nodes: {} } as unknown as Tree;
  const article = { meta, blocks: opts.blocks, tree } as unknown as Article;

  /* **The `sourceHash`, not a `stale` flag on the response.** `lookUpTerm`
     computes staleness itself, with `isStale` over the glossary and the article
     it is actually holding — because `loadGlossary` and `loadArticle` are two
     reads and the revision pointer can move between them, so the flag off the
     first describes a revision the second need not have returned. Setting the
     flag here would drive a field the code no longer reads, and every case
     below would pass whatever the code did with it. */
  const sourceHash = opts.stale
    ? "spya-not-this-article"
    : articleFingerprint(opts.blocks, tree, meta);

  const asked: { blockId: string; quote: string }[] = [];

  const prepare = makeLookUpTerm({
    reader: {
      loadArticle: async () => article,
      loadGlossary: async () =>
        ({
          glossary: { sourceHash, entries: [{ ...opts.entry, kind: "term", background: "" }] },
          /* Deliberately the **wrong** answer on both branches, so that a
             version of `lookUpTerm` that trusts this field rather than the two
             objects it holds fails every stale case in this file. */
          stale: !opts.stale,
          outdated: false,
        }) as unknown as GlossaryResponse,
    },
    lookups: {
      load: async (): Promise<LookupsByTerm> => ({}),
      save: async (_slug, termId, lookup): Promise<LookupsByTerm> => ({ [termId]: lookup }),
    },
    explainStream: async function* (req) {
      asked.push({ blockId: req.blockId, quote: req.quote });
      yield {
        type: "done",
        ending: "finished",
        answer: "An answer.",
        citations: [],
        searches: 1,
        model: "a-model",
      };
    },
    now: () => "2026-09-04T00:00:00.000Z",
  });

  /* Refuse, or drain the stream to its one `done` — what the JSON route used
     to hand back. Every case here is about the refusals, which happen before
     the stream exists. */
  const lookUp = async (slug: string, termId: string) => {
    for await (const event of (await prepare(slug, termId)).stream()) {
      if (event.type === "done") return { entry: event.entry };
    }
    throw new Error("the stream ended without a done");
  };

  return { lookUp, asked };
}

/**
 * The failure, with its status.
 *
 * **Settled into a value before anything is thrown, and that is not
 * fussiness.** The obvious version wraps the call in `try`, throws its own
 * `Error` when it succeeds, and then catches that error two lines later — so a
 * lookup that wrongly *answers* is reported as a refusal whose message happens
 * not to contain whatever the case was checking for. A green test over a broken
 * feature, and exactly the shape docs/reusable/silent-success.md is about. GPT
 * Sol found it here.
 */
async function refusal(work: Promise<unknown>): Promise<{ status?: number; message: string }> {
  const outcome = await work.then(
    () => ({ refused: false }) as const,
    (err: Error & { status?: number }) => ({ refused: true, err }) as const,
  );
  if (!outcome.refused) throw new Error("expected a refusal and got an answer");
  return {
    ...(outcome.err.status === undefined ? {} : { status: outcome.err.status }),
    message: outcome.err.message,
  };
}

describe("a term the article names but never quotes", () => {
  const entry = {
    id: "spya-liskov",
    name: "Barbara Liskov",
    aliases: [],
    /* Empty because `findOccurrences` found nothing, which is a real and
       permanent state of a glossary entry rather than damage. */
    blocks: [],
  };
  const blocks = [para("spya-aaaaaa", "A paragraph about types.")];

  it("is refused with the not-quoted code, not the out-of-date one", async () => {
    const { lookUp } = harness({ blocks, entry });
    const { status, message } = await refusal(lookUp("harness", "spya-liskov"));
    expect(status).toBe(409);
    expect(message).toMatch(/\[gl-not-quoted\]/);
  });

  it("does not name the term, because the reader is looking straight at it", async () => {
    /* The whole of the reported bug. The sentence said `"Barbara Liskov" does
       not appear in this article`, under a row headed *Barbara Liskov* — so it
       read as a denial that the entry existed. The failure is rendered inside
       the selected entry's own row (src/web/GlossaryPanel.tsx § `Looked`), so
       repeating the name buys nothing and costs exactly this. */
    const { lookUp } = harness({ blocks, entry });
    const { message } = await refusal(lookUp("harness", "spya-liskov"));
    expect(message).not.toContain("Barbara Liskov");
  });

  it("refuses before spending anything", async () => {
    /* Stated everywhere and asserted nowhere until now: a refusal that calls the
       model first and then throws the right code passes every other case in this
       file, and costs real money on every press of a button that cannot work. */
    const { lookUp, asked } = harness({ blocks, entry });
    await refusal(lookUp("harness", "spya-liskov"));
    expect(asked).toEqual([]);
  });
});

describe("a glossary that no longer fits the article", () => {
  it("says it is out of date rather than blaming the term", async () => {
    /* Written against an extraction whose blocks are gone. Every draft revision
       carries the glossary column forward (src/store/pg-revisions.ts), so a
       glossary outliving the blocks it was written against is the ordinary way
       this happens rather than a corruption. */
    const { lookUp, asked } = harness({
      blocks: [para("spya-bbbbbb", "A paragraph that no longer names anybody.")],
      entry: {
        id: "spya-liskov",
        name: "Barbara Liskov",
        aliases: [],
        blocks: ["spya-gonegone"],
      },
      stale: true,
    });
    const { status, message } = await refusal(lookUp("harness", "spya-liskov"));
    expect(status).toBe(409);
    expect(message).toMatch(/\[gl-stale\]/);
    expect(asked).toEqual([]);
  });

  it("does not claim the article never quotes a term when it cannot know", async () => {
    /* **The regression that matters most in this file.** A carried entry says
       `blocks: []` about the extraction it was written for. Read as *the article
       never quotes this term* it is the reported bug one revision along: the
       words are on the page, underlined, and the app says they are not there.
       Here the current article does not contain the term either — so the
       *refusal* is right and only the *reason* is in question. `[gl-stale]`,
       because a stale list is not evidence about this article. */
    const { lookUp } = harness({
      blocks: [para("spya-bbbbbb", "A paragraph about something else entirely.")],
      entry: { id: "spya-liskov", name: "Barbara Liskov", aliases: [], blocks: [] },
      stale: true,
    });
    const { message } = await refusal(lookUp("harness", "spya-liskov"));
    expect(message).toMatch(/\[gl-stale\]/);
  });
});

describe("the anchor comes from the article, not from the stored occurrences", () => {
  it("finds the term even when the entry recorded no occurrence at all", async () => {
    /* The other half of the carried-glossary case, and the one that used to be
       refused outright: the list is stale and empty for this term, *and* the
       article now quotes it. The reader can see the words. The lookup must
       work — and it must not be decided by `entry.blocks`. */
    const { lookUp, asked } = harness({
      blocks: [
        para("spya-bbbbbb", "An opening paragraph."),
        para("spya-cccccc", "A paragraph about Barbara Liskov's substitution rule."),
      ],
      entry: { id: "spya-liskov", name: "Barbara Liskov", aliases: [], blocks: [] },
      stale: true,
    });
    await lookUp("harness", "spya-liskov");
    expect(asked).toEqual([{ blockId: "spya-cccccc", quote: "Barbara Liskov" }]);
  });

  it("uses a later occurrence rather than refusing when the first has gone", async () => {
    /* The brittleness behind the report. A term used in three places was
       refused outright the moment the first of them changed, and the reader was
       told the term was not in the article — while the other two occurrences
       were still on the page in front of them, underlined. */
    const { lookUp, asked } = harness({
      blocks: [
        para("spya-bbbbbb", "A paragraph that no longer names anybody."),
        para("spya-cccccc", "A later paragraph about Barbara Liskov's substitution rule."),
      ],
      entry: {
        id: "spya-liskov",
        name: "Barbara Liskov",
        aliases: [],
        blocks: ["spya-gonegone", "spya-bbbbbb", "spya-cccccc"],
      },
    });
    await lookUp("harness", "spya-liskov");
    expect(asked).toEqual([{ blockId: "spya-cccccc", quote: "Barbara Liskov" }]);
  });

  it("takes the term's first use, which is where selecting it put the reader", async () => {
    /* The control, and the guarantee that scanning the article rather than the
       recorded list changes nothing for a healthy glossary: `findOccurrences`
       walks the blocks in document order under the same rule, so the first block
       that matches *is* `entry.blocks[0]`. */
    const { lookUp, asked } = harness({
      blocks: [
        para("spya-bbbbbb", "An early paragraph about Barbara Liskov."),
        para("spya-cccccc", "A later paragraph about Barbara Liskov's substitution rule."),
      ],
      entry: {
        id: "spya-liskov",
        name: "Barbara Liskov",
        aliases: [],
        blocks: ["spya-bbbbbb", "spya-cccccc"],
      },
    });
    await lookUp("harness", "spya-liskov");
    expect(asked[0]?.blockId).toBe("spya-bbbbbb");
  });

  it("quotes the form the article uses, not the entry's name", async () => {
    /* The rule `quoteIn` has always encoded, re-asserted here because the scan
       moved: an alias-only occurrence must still produce a truthful quote, and
       the block the alias is in must be the anchor. */
    const { lookUp, asked } = harness({
      blocks: [
        para("spya-bbbbbb", "An opening paragraph about nothing in particular."),
        para("spya-cccccc", "MLK said so in 1963."),
      ],
      entry: {
        id: "spya-king",
        name: "Martin Luther King Jr.",
        aliases: ["MLK"],
        blocks: [],
      },
    });
    await lookUp("harness", "spya-king");
    expect(asked).toEqual([{ blockId: "spya-cccccc", quote: "MLK" }]);
  });
});
