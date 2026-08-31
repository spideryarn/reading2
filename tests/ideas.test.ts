/**
 * The deterministic half of stage 5f — src/ideas.ts.
 *
 * Nothing here calls a model. What is pinned is everything either side of the
 * call, and the interesting half is **the validation**, because this is the
 * first pipeline stage that lets the model name block ids.
 *
 * Every other artefact that points into the article computes its pointers
 * itself: a glossary entry's `blocks` come from matching the term's own text,
 * so the model is never shown an id and cannot invent one. An idea has no name
 * to match, so the ids come back from the model — and every one of the drops
 * below is a way it can be wrong that **looks identical, from outside, to the
 * model simply not mentioning that passage**. That is the whole reason these
 * are counted rather than silently skipped, and the reason they are tested.
 *
 * See docs/plans/260826ac-ideas-mode.md and docs/project/testing.md.
 */
import { describe, expect, it } from "vitest";
import {
  buildIdeas,
  type Dropped,
  idsByName,
  inputFingerprint,
  inReadingOrder,
  isStale,
  MAX_IDEAS,
  MAX_OCCURRENCES,
  normaliseName,
  PROMPT_VERSION,
  renderPrompt,
  suggestedIdeas,
  toIdeas,
  validateOccurrences,
} from "../src/ideas.js";
import { CAPABLE_MODEL } from "../src/models.js";
import type { Block, Idea, Ideas, Tree, TreeNode } from "../src/types.js";

function block(id: string, text: string): Block {
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.split(/\s+/).length,
    html: `<p>${text}</p>`,
    gistable: true,
  };
}

const BLOCKS: Block[] = [
  block("spya-aaaaaa", "Writing is thinking, and there is no way round that."),
  block("spya-bbbbbb", "Most people never had to write anything at all."),
  block("spya-cccccc", "So the pressure to learn it simply went away."),
];

function node(over: Partial<TreeNode> & { id: string }): TreeNode {
  return {
    depth: 1,
    parent: "n0",
    children: [],
    range: ["spya-aaaaaa", "spya-cccccc"],
    title: "A part",
    ...over,
  } as TreeNode;
}

function tree(parts: TreeNode[] = [node({ id: "n1", title: "All of it", gist: "A gist." })]): Tree {
  return {
    version: "toc/1",
    generator: "test",
    slug: "test",
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: parts.map((p) => p.id),
        range: ["spya-aaaaaa", "spya-cccccc"],
        title: "The whole thing",
      },
      ...Object.fromEntries(parts.map((p) => [p.id, p])),
    },
  } as Tree;
}

function fresh(): Dropped {
  return {
    unknownIds: 0,
    unquoted: 0,
    truncated: 0,
    overCap: 0,
    malformed: 0,
    unargued: 0,
    unanchored: 0,
  };
}

/** A well-formed **assumed** idea, which has to carry its argument. */
function rawAssumed(over: Record<string, unknown> = {}): Record<string, unknown> {
  return raw({
    provenance: "assumed",
    whyYouNeedIt: "The step from the quoted line to the conclusion needs it and is never argued.",
    ...over,
  });
}

/** One well-formed raw idea, as the model would return it. */
function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Writing is thinking",
    provenance: "introduced",
    statement: "Prose is where thought gets made, not where it gets recorded.",
    occurrences: [
      { blockId: "spya-aaaaaa", quote: "Writing is thinking", reasoning: "States it." },
    ],
    ...over,
  };
}

describe("suggestedIdeas", () => {
  it("floors at three, because a short piece still rests on something", () => {
    expect(suggestedIdeas(100)).toBe(3);
    expect(suggestedIdeas(0)).toBe(3);
  });

  it("ceilings at MAX_IDEAS however long the piece is", () => {
    expect(suggestedIdeas(500_000)).toBe(MAX_IDEAS);
  });

  it("is far sparser than the glossary's one-per-400-words", () => {
    // The point of the number: asking for more does not produce weaker ideas
    // the reader can skip, it produces themes. 8,000 words is ten, not twenty.
    expect(suggestedIdeas(8_000)).toBe(10);
  });
});

describe("validateOccurrences", () => {
  it("keeps an occurrence whose block exists and whose quote is really there", () => {
    const d = fresh();
    const out = validateOccurrences(
      [{ blockId: "spya-aaaaaa", quote: "Writing is thinking", reasoning: "why" }],
      BLOCKS,
      d,
      false,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.start).toBe(0);
    expect(d).toEqual(fresh());
  });

  it("drops an invented block id and counts it", () => {
    const d = fresh();
    const out = validateOccurrences(
      [{ blockId: "spya-zzzzzz", quote: "Writing is thinking", reasoning: "why" }],
      BLOCKS,
      d,
      false,
    );
    expect(out).toEqual([]);
    expect(d.unknownIds).toBe(1);
  });

  it("drops a quote that is not in the block the model named, even though it is in another", () => {
    /* The sharp case, and the reason the check is per-block rather than
       per-article: these words ARE in the piece, just not where the model said.
       Marking them where it said would underline the wrong paragraph, which is
       worse than marking nothing. */
    const d = fresh();
    const out = validateOccurrences(
      [{ blockId: "spya-bbbbbb", quote: "Writing is thinking", reasoning: "why" }],
      BLOCKS,
      d,
      false,
    );
    expect(out).toEqual([]);
    expect(d.unquoted).toBe(1);
  });

  it("survives a null or a bare string in the array", () => {
    /* Per element, before any field is read. This is the bug src/glossary.ts
       had: the salvage covered malformed fields inside an object and threw on a
       malformed element, which is the failure its docstring promised not to
       have. */
    const d = fresh();
    const out = validateOccurrences(
      [null, "nonsense", { blockId: "spya-aaaaaa", quote: "Writing is thinking", reasoning: "" }],
      BLOCKS,
      d,
      false,
    );
    expect(out).toHaveLength(1);
    expect(d.malformed).toBe(2);
  });

  it("caps at MAX_OCCURRENCES and counts what it cut", () => {
    const d = fresh();
    const many = Array.from({ length: MAX_OCCURRENCES + 3 }, () => ({
      blockId: "spya-aaaaaa",
      quote: "Writing is thinking",
      reasoning: "why",
    }));
    const out = validateOccurrences(many, BLOCKS, d, false);
    expect(out).toHaveLength(MAX_OCCURRENCES);
    expect(d.truncated).toBe(3);
  });

  it("keeps two occurrences in the SAME block as two", () => {
    /* One idea can be needed twice in one paragraph, and the stepper counts
       occurrences rather than blocks. Collapsing them here would make the
       panel say "3 of 5" and step through four. */
    const d = fresh();
    const out = validateOccurrences(
      [
        { blockId: "spya-aaaaaa", quote: "Writing is thinking", reasoning: "a" },
        { blockId: "spya-aaaaaa", quote: "no way round that", reasoning: "b" },
      ],
      BLOCKS,
      d,
      false,
    );
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.blockId)).toEqual(["spya-aaaaaa", "spya-aaaaaa"]);
  });

  it("is forgiving about whitespace and case, because findQuote is", () => {
    const d = fresh();
    const out = validateOccurrences(
      [{ blockId: "spya-aaaaaa", quote: "writing   is  THINKING", reasoning: "why" }],
      BLOCKS,
      d,
      false,
    );
    expect(out).toHaveLength(1);
    expect(d.unquoted).toBe(0);
  });
});

describe("toIdeas", () => {
  it("drops an idea whose every occurrence failed, and counts it as unanchored", () => {
    /* **The rule this stage does not share with the glossary.** An unmatched
       glossary entry is still a definition you can read; an idea with no
       occurrence is a claim with no evidence and no way back to the page. It is
       also the failure to expect — a topic rather than a proposition — so the
       count is the one quality signal the stage gives. */
    const d = fresh();
    const out = toIdeas(
      [raw({ occurrences: [{ blockId: "spya-nope00", quote: "x" }] })],
      BLOCKS,
      new Set(),
      d,
    );
    expect(out).toEqual([]);
    expect(d.unanchored).toBe(1);
    expect(d.unknownIds).toBe(1);
  });

  it("drops an idea with no statement, and one with an unusable provenance", () => {
    const d = fresh();
    const out = toIdeas(
      [raw({ statement: "" }), raw({ provenance: "both" }), raw()],
      BLOCKS,
      new Set(),
      d,
    );
    expect(out).toHaveLength(1);
    expect(d.malformed).toBe(2);
  });

  it("salvages the good ideas around a malformed one", () => {
    const d = fresh();
    const out = toIdeas([raw({ name: "One" }), null, raw({ name: "Two" })], BLOCKS, new Set(), d);
    expect(out.map((i) => i.name)).toEqual(["One", "Two"]);
    expect(d.malformed).toBe(1);
  });

  it("omits whyYouNeedIt and analogy rather than storing empty strings", () => {
    const d = fresh();
    const [idea] = toIdeas([raw({ whyYouNeedIt: "   ", analogy: "" })], BLOCKS, new Set(), d);
    expect(idea).toBeDefined();
    expect("whyYouNeedIt" in idea!).toBe(false);
    expect("analogy" in idea!).toBe(false);
  });

  it("accepts a provenance the model shouted", () => {
    const d = fresh();
    const [idea] = toIdeas([rawAssumed({ provenance: "ASSUMED" })], BLOCKS, new Set(), d);
    expect(idea?.provenance).toBe("assumed");
  });

  it("drops an ASSUMED idea that never says what fails without it", () => {
    /* **The highest finding of the built-code review.** An assumed idea's whole
       claim is that the piece does not go through without it. The passage alone
       cannot establish that — it only proves the passage exists — so an assumed
       idea with no `whyYouNeedIt` is a block id lending the appearance of
       evidence to an assertion nobody has argued for. That is the failure this
       mode is shaped against, and it was getting through. */
    const d = fresh();
    const out = toIdeas([rawAssumed({ whyYouNeedIt: "  " })], BLOCKS, new Set(), d);
    expect(out).toEqual([]);
    expect(d.unargued).toBe(1);
    /* Not `malformed`: we could read it perfectly well. Two different facts
       needing two different counters, exactly as `stale` and `outdated` are. */
    expect(d.malformed).toBe(0);
  });

  it("drops an ASSUMED occurrence with no reasoning, and counts it", () => {
    const d = fresh();
    const out = toIdeas(
      [
        rawAssumed({
          occurrences: [
            { blockId: "spya-aaaaaa", quote: "Writing is thinking", reasoning: "" },
            { blockId: "spya-bbbbbb", quote: "Most people", reasoning: "names the step that fails" },
          ],
        }),
      ],
      BLOCKS,
      new Set(),
      d,
    );
    expect(out[0]!.occurrences).toHaveLength(1);
    expect(d.unargued).toBe(1);
  });

  it("does NOT hold an INTRODUCED idea to either rule", () => {
    /* The asymmetry is the point. An introduced idea's passage *states* the
       thing, so a reader can check it by reading; a missing line costs them
       nothing they could not get themselves. */
    const d = fresh();
    const out = toIdeas(
      [
        raw({
          whyYouNeedIt: "",
          occurrences: [{ blockId: "spya-aaaaaa", quote: "Writing is thinking", reasoning: "" }],
        }),
      ],
      BLOCKS,
      new Set(),
      d,
    );
    expect(out).toHaveLength(1);
    expect(d.unargued).toBe(0);
  });

  it("enforces MAX_IDEAS rather than trusting the model to obey the prompt", () => {
    /* `suggestedIdeas` only ASKS for at most ten. Everything else in this file
       believes as little as possible of what came back, and this was the one
       place that took the model's word for it — with a second effect nobody
       would look for: the band synthesises a per-idea `createdAt` from the
       index, and `#10` sorts before `#2`, so an eleventh idea would quietly
       reshuffle the palette. */
    const d = fresh();
    const many = Array.from({ length: MAX_IDEAS + 3 }, (_, i) => raw({ name: `Idea number ${i}` }));
    const out = toIdeas(many, BLOCKS, new Set(), d);
    expect(out).toHaveLength(MAX_IDEAS);
    expect(d.overCap).toBe(3);
  });
});

describe("inReadingOrder", () => {
  const at = (name: string, provenance: "assumed" | "introduced", blockId: string): Idea => ({
    id: `spya-${name}`,
    name,
    provenance,
    statement: "s",
    occurrences: [{ blockId, quote: "q", reasoning: "r" }],
  });

  it("puts everything assumed before everything introduced", () => {
    // A prerequisite is worth having before you read; a takeaway is not.
    const out = inReadingOrder(
      [at("a", "introduced", "spya-aaaaaa"), at("b", "assumed", "spya-cccccc")],
      BLOCKS,
    );
    expect(out.map((i) => i.name)).toEqual(["b", "a"]);
  });

  it("orders within a group by FIRST occurrence, in blocks.json order", () => {
    /* Never by block id — the warning at the top of src/web/comment-nav.ts.
       Sorting by the id string compiles, runs, and is meaningless. */
    const out = inReadingOrder(
      [at("late", "assumed", "spya-cccccc"), at("early", "assumed", "spya-aaaaaa")],
      BLOCKS,
    );
    expect(out.map((i) => i.name)).toEqual(["early", "late"]);
  });

  it("takes the earliest of several occurrences, not the first one listed", () => {
    const spread: Idea = {
      id: "spya-spread",
      name: "spread",
      provenance: "assumed",
      occurrences: [
        { blockId: "spya-cccccc", quote: "q", reasoning: "r" },
        { blockId: "spya-aaaaaa", quote: "q", reasoning: "r" },
      ],
      statement: "s",
    };
    const out = inReadingOrder([spread, at("mid", "assumed", "spya-bbbbbb")], BLOCKS);
    expect(out.map((i) => i.name)).toEqual(["spread", "mid"]);
  });

  it("is stable for two ideas first needed in the same block", () => {
    const out = inReadingOrder(
      [at("first", "assumed", "spya-aaaaaa"), at("second", "assumed", "spya-aaaaaa")],
      BLOCKS,
    );
    expect(out.map((i) => i.name)).toEqual(["first", "second"]);
  });
});

describe("buildIdeas", () => {
  const opts = () => ({
    slug: "test",
    blocks: BLOCKS,
    sourceHash: "abc.def",
    elapsedMs: 10,
    dropped: fresh(),
  });

  it("stamps the version, the model and a null profileHash", () => {
    const built = buildIdeas({ ideas: [raw()] }, opts());
    expect(built.version).toBe(PROMPT_VERSION);
    expect(built.generator).toBe(CAPABLE_MODEL);
    /* `null`, never absent. Absent means "written before profiles existed";
       null means "written deliberately without one", and the stamp comparison
       has to be able to tell those apart. */
    expect(built.profileHash).toBeNull();
  });

  it("throws when nothing could be anchored, and says what was dropped", () => {
    /* The bare "nothing to write" version of this message cost a debugging
       round trip: it reads as "the model said nothing" when the actual cause
       was a prompt asking for block ids against a renderer that omits them. */
    const o = opts();
    expect(() => buildIdeas({ ideas: [raw({ occurrences: [] })] }, o)).toThrow(
      /1 with no usable passage/,
    );
  });

  it("throws rather than writing an empty artefact", () => {
    // An empty file would make the step report itself done for ever after.
    expect(() => buildIdeas({ ideas: [] }, opts())).toThrow();
  });
});

describe("idsByName and normaliseName", () => {
  const stored = (names: string[]): Ideas => ({
    version: PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    slug: "test",
    sourceHash: "abc.def",
    ideas: names.map((n, i) => ({
      id: `spya-old${i}`,
      name: n,
      provenance: "assumed" as const,
      statement: "s",
      occurrences: [{ blockId: "spya-aaaaaa", quote: "q", reasoning: "r" }],
    })),
    generatedAt: "2026-08-26T00:00:00.000Z",
    elapsedMs: 1,
  });

  it("matches across case, curly quotes and whitespace runs", () => {
    expect(normaliseName("Writing  is  “thinking”")).toBe(normaliseName('writing is "thinking"'));
  });

  it("gives a regenerated idea the id the old list used for the same name", () => {
    const built = buildIdeas({ ideas: [raw({ name: "Writing IS thinking" })] }, {
      slug: "test",
      blocks: BLOCKS,
      sourceHash: "abc.def",
      elapsedMs: 1,
      dropped: fresh(),
      inherit: idsByName(stored(["Writing is thinking"])),
    });
    expect(built.ideas[0]!.id).toBe("spya-old0");
  });

  it("does NOT inherit across a paraphrase — and that is the documented limit", () => {
    /* The honest weakness of this feature versus the glossary's. A term comes
       back spelled the same way; a sentence does not. The alternative — fuzzy
       matching — is worse: a link that lands on nothing is a dead end the
       reader can see, and one that lands on a DIFFERENT idea is a dead end that
       looks like it worked. */
    const built = buildIdeas({ ideas: [raw({ name: "Prose is where thinking is tested" })] }, {
      slug: "test",
      blocks: BLOCKS,
      sourceHash: "abc.def",
      elapsedMs: 1,
      dropped: fresh(),
      inherit: idsByName(stored(["Writing is thinking"])),
    });
    expect(built.ideas[0]!.id).not.toBe("spya-old0");
  });

  it("never hands one old id to two fresh ideas", () => {
    const built = buildIdeas(
      { ideas: [raw({ name: "Writing is thinking" }), raw({ name: "writing is thinking!" })] },
      {
        slug: "test",
        blocks: BLOCKS,
        sourceHash: "abc.def",
        elapsedMs: 1,
        dropped: fresh(),
        inherit: idsByName(stored(["Writing is thinking"])),
      },
    );
    const ids = built.ideas.map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("inputFingerprint and isStale", () => {
  /* The head this stage's prompt carries — `articleWithIds` writes `TITLE:`,
     `BY:` and `PUBLISHED IN:` — so the fingerprint covers it too, since
     2026-08-31. src/source-hash.ts § `articleFingerprint`. */
  const META = { title: "A title", byline: "Somebody", siteName: "Somewhere" };

  it("changes when a block changes", () => {
    const moved = [...BLOCKS.slice(0, 2), block("spya-cccccc", "Different words entirely.")];
    expect(inputFingerprint(BLOCKS, tree(), META)).not.toBe(
      inputFingerprint(moved, tree(), META),
    );
  });

  /* Red before 2026-08-31: the extracted title is stage 2's and a
     re-extraction moves it, and it goes into the head of the prompt these ideas
     were found from. Not the reader's own rename — a shelf override the
     generators never read. */
  it("changes when only the article's name moves", () => {
    expect(inputFingerprint(BLOCKS, tree(), META)).not.toBe(
      inputFingerprint(BLOCKS, tree(), { ...META, title: "Renamed since" }),
    );
  });

  it("changes when only the TREE moves — the whole reason this is not hashBlocks", () => {
    /* `StepStamp` in src/store/artifacts.ts has flagged this since it was
       written: section boundaries can move without a single block changing.
       This stage shows the model the skeleton before the article precisely so
       that it judges what the argument rests on, so a re-cut article is a
       different question — and a blocks-only hash reports no change at all. */
    const recut = tree([
      node({ id: "n1", title: "First half", gist: "A gist.", range: ["spya-aaaaaa", "spya-bbbbbb"] }),
      node({ id: "n2", title: "Second half", gist: "Another.", range: ["spya-cccccc", "spya-cccccc"] }),
    ]);
    expect(inputFingerprint(BLOCKS, tree(), META)).not.toBe(
      inputFingerprint(BLOCKS, recut, META),
    );
  });

  it("reports an artefact stale when the tree alone has moved", () => {
    const built = buildIdeas({ ideas: [raw()] }, {
      slug: "test",
      blocks: BLOCKS,
      sourceHash: inputFingerprint(BLOCKS, tree(), META),
      elapsedMs: 1,
      dropped: fresh(),
    });
    expect(isStale(built, BLOCKS, tree(), META)).toBe(false);
    const recut = tree([
      node({ id: "n1", title: "Half", gist: "A gist.", range: ["spya-aaaaaa", "spya-bbbbbb"] }),
      node({ id: "n2", title: "Other half", gist: "B.", range: ["spya-cccccc", "spya-cccccc"] }),
    ]);
    expect(isStale(built, BLOCKS, recut, META)).toBe(true);
    expect(isStale(built, BLOCKS, tree(), { ...META, title: "Renamed since" })).toBe(true);
  });
});

describe("renderPrompt", () => {
  it("carries the profile when there is one", () => {
    const out = renderPrompt({ tree: tree(), count: 5, profile: "I am a physicist." });
    expect(out).toContain("I am a physicist.");
  });

  it("leaves no trace at all when there is not", () => {
    /* Not merely "does not contain the profile" — no empty heading, no stray
       blank section. An absent profile has to produce the bytes an article with
       no profile has always produced, or every unprofiled reader gets a second
       cache entry. */
    const out = renderPrompt({ tree: tree(), count: 5, profile: null });
    expect(out).not.toMatch(/READER|profile/i);
    expect(out).toBe(renderPrompt({ tree: tree(), count: 5, profile: "" }));
  });

  it("shows the skeleton, which is why the tree is in the fingerprint", () => {
    const out = renderPrompt({ tree: tree(), count: 5, profile: null });
    expect(out).toContain("All of it");
  });
});
