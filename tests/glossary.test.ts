/**
 * The deterministic half of stage 5d — src/glossary.ts and src/term-match.ts.
 *
 * Nothing here calls a model. What is pinned is everything that happens either
 * side of the call, and two of those things exist **because the version this
 * was borrowed from got them wrong** — see
 * docs/project/original-version/glossary.md:
 *
 *  - `dedupe` keeps the richer name. Theirs kept whichever came first in the
 *    document, which systematically deleted the more specific phrase.
 *  - `findOccurrences` is computed here rather than asked of the model, which
 *    is what turns the prompt's alias instruction into something measurable.
 *
 * Same split as stages 4 and 5c, and for the same reason: the genuinely
 * nondeterministic part is one function call, and everything around it has a
 * right answer. See docs/project/testing.md.
 */
import { describe, expect, it } from "vitest";
import {
  BATCH_SIZE,
  buildGlossary,
  dedupe,
  findOccurrences,
  PROMPT_VERSION,
  inDocumentOrder,
  isStale,
  normaliseTerm,
  richness,
  safeUrl,
  existingFor,
  idsByTerm,
  suggestedCount,
} from "../src/glossary.js";
import { formsOf, termPattern, termSpans } from "../src/term-match.js";
import { articleFingerprint } from "../src/source-hash.js";
import { CAPABLE_MODEL } from "../src/models.js";
import {
  GATE_STEP,
  PRIORITY_GATE,
  canPrioritise,
  countAbove,
  effectiveSort,
  gateMax,
  gateNote,
  groupEntries,
  priorityOf,
  rowScores,
  sortEntries,
  splitsOnPriority,
  entryProse,
} from "../src/web/GlossaryPanel.js";
import { gateParam } from "../src/web/params.js";
import type { Block, Glossary, GlossaryEntry, Tree } from "../src/types.js";

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

function entry(over: Partial<GlossaryEntry> & { name: string }): GlossaryEntry {
  return {
    id: `spya-${over.name.slice(0, 6).padEnd(6, "a").replace(/[^a-z0-9]/g, "a")}`,
    kind: "concept",
    aliases: [],
    /* `senseHere` and not `gloss`, since glossary/2. The old field still exists
       on the type for artefacts written before the split, and a few tests below
       set it deliberately to exercise that path — but the default shape a test
       gets should be the shape the pipeline now writes. */
    senseHere: `What ${over.name} means here.`,
    blocks: [],
    ...over,
  };
}

/**
 * The same fixture with one prose field removed.
 *
 * `entry({ senseHere: undefined })` would be the obvious spelling and the
 * typecheck refuses it: `exactOptionalPropertyTypes` draws a distinction
 * between "absent" and "present and undefined", and for these two fields that
 * distinction is the feature — an absent `senseHere` is what a person simply
 * quoted is supposed to have (src/glossary.ts § WHAT AN ENTRY SUPPLIES).
 */
function without(e: GlossaryEntry, key: "senseHere" | "background"): GlossaryEntry {
  const copy = { ...e };
  delete copy[key];
  return copy;
}

const BLOCKS = [
  block("spya-aaaaaa", "Seth argues that consciousness is metabolic."),
  block("spya-bbbbbb", "A nonreductive explanation is not the same as no explanation."),
  block("spya-cccccc", "Nonreductive accounts have their own problems."),
];

describe("termPattern", () => {
  it("matches a whole word and not part of one", () => {
    const p = termPattern(["Seth"])!;
    expect(termSpans("Seth argues", p)).toHaveLength(1);
    // `Sethian` must not match. `\b` would agree here; the next test is where
    // `\b` stops agreeing.
    expect(termSpans("Sethian cosmology", p)).toHaveLength(0);
  });

  it("gets both ends right at a non-ASCII letter, where `\\b` gets both wrong", () => {
    /* The whole reason the boundary is a Unicode lookaround rather than `\b`.
       `\b` is defined against [A-Za-z0-9_] even with the `u` flag, so an
       accented letter is a *non*-word character to it — and that breaks in both
       directions at once:

         - it refuses a real match: `/\bcafé\b/` does not find "a café here",
           because there is no ASCII-word boundary after `é`;
         - and it invents one: `/\bco\b/` matches inside "coöperate", cutting
           the word in half. */
    const cafe = termPattern(["café"])!;
    expect(termSpans("a café here", cafe)).toHaveLength(1);
    expect(/\bcafé\b/u.test("a café here")).toBe(false);

    const co = termPattern(["co"])!;
    expect(termSpans("coöperate", co)).toHaveLength(0);
    expect(/\bco\b/u.test("coöperate")).toBe(true);
  });

  it("finds the plural and the possessive", () => {
    const p = termPattern(["attention head"])!;
    expect(termSpans("two attention heads", p)).toHaveLength(1);
    expect(termSpans("the attention head's job", p)).toHaveLength(1);
  });

  it("prefers the longer form where two overlap", () => {
    // The exact pair that broke theirs. JavaScript's alternation takes the
    // FIRST branch that matches, not the longest, so the ordering inside
    // termPattern is the whole of this behaviour.
    const p = termPattern(["nonreductive", "nonreductive explanation"])!;
    const [span] = termSpans("a nonreductive explanation of it", p);
    expect(span && "a nonreductive explanation of it".slice(span.start, span.end)).toBe(
      "nonreductive explanation",
    );
  });

  it("matches a term containing regex punctuation as text", () => {
    const p = termPattern(["C++"])!;
    expect(termSpans("written in C++ mostly", p)).toHaveLength(1);
  });

  it("is null when there is nothing to match", () => {
    expect(termPattern([])).toBeNull();
    expect(termPattern(["", "   "])).toBeNull();
  });

  it("does not carry lastIndex from one search into the next", () => {
    // The pattern is global and is reused across blocks and across renders. A
    // stale lastIndex shows up as "the first paragraph never highlights".
    const p = termPattern(["Seth"])!;
    expect(termSpans("Seth and Seth", p)).toHaveLength(2);
    expect(termSpans("Seth and Seth", p)).toHaveLength(2);
  });
});

describe("dedupe", () => {
  it("keeps the RICHER name and demotes the poorer one to an alias", () => {
    // Their bug, in one test. `nonreductive` is introduced first, so first-wins
    // keeps it and throws away `nonreductive explanation` — which is not a
    // random choice between the two, it is reliably the vaguer one, because a
    // general term is nearly always introduced before the phrase built on it.
    const out = dedupe([
      entry({ name: "nonreductive", aliases: ["nonreductive explanation"] }),
      entry({ name: "nonreductive explanation" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("nonreductive explanation");
    expect(out[0]?.aliases).toContain("nonreductive");
  });

  it("keeps the id of the entry that was already there", () => {
    // A `?term=` link addresses an entry by id. An id that changed when a later
    // pass found a better name for the same thing would break the reader's
    // link to say the word slightly differently. Names are display; ids are
    // identity.
    const first = entry({ name: "America", id: "spya-keeper" });
    const out = dedupe([first, entry({ name: "United States of America", aliases: ["America"] })]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("spya-keeper");
    expect(out[0]?.name).toBe("United States of America");
  });

  it("merges when a name matches an existing alias", () => {
    const out = dedupe([
      entry({ name: "Large Language Model", aliases: ["LLM"] }),
      entry({ name: "LLM" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("Large Language Model");
  });

  it("does NOT merge two entries that merely share an alias", () => {
    // Their first attempt did, and silently lost legitimate entries. Both
    // directions of this bug fail quietly, so both need a test.
    const out = dedupe([
      entry({ name: "Attention", aliases: ["focus"] }),
      entry({ name: "Salience", aliases: ["focus"] }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("treats case, curly quotes and stray punctuation as the same term", () => {
    const out = dedupe([entry({ name: "the Enlightenment" }), entry({ name: "The Enlightenment," })]);
    expect(out).toHaveLength(1);
  });

  it("carries fromOutside across a merge in the safe direction", () => {
    const out = dedupe([
      entry({ name: "Gödel" }),
      entry({ name: "Kurt Gödel", aliases: ["Gödel"], fromOutside: true }),
    ]);
    expect(out[0]?.fromOutside).toBe(true);
  });

  it("leaves genuinely different terms alone", () => {
    const out = dedupe([entry({ name: "qualia" }), entry({ name: "quale" })]);
    // Deliberately NOT merged: `normaliseTerm` does not stem or singularise,
    // because an over-eager normaliser is its own bug. Two entries a person
    // would have merged is visible; a lost entry is not.
    expect(out).toHaveLength(2);
  });
});

describe("richness", () => {
  it("counts words first, then characters", () => {
    expect(richness("United States of America")[0]).toBe(4);
    expect(richness("America")).toEqual([1, 7]);
  });
});

describe("normaliseTerm", () => {
  it("is a comparison key and never a stored value", () => {
    expect(normaliseTerm("  The Enlightenment,  ")).toBe("the enlightenment");
    expect(normaliseTerm("O’Brien")).toBe("o'brien");
    expect(normaliseTerm("attention   head")).toBe("attention head");
  });
});

describe("safeUrl", () => {
  it("keeps an ordinary web link", () => {
    expect(safeUrl("https://en.wikipedia.org/wiki/Qualia")).toContain("wikipedia.org");
  });

  it("drops a javascript: URL", () => {
    // A security check, not a tidy-up: this string came out of a language model
    // and the panel renders it as an href. Zod's `.url()`, which is what theirs
    // validated with, accepts this.
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
  });

  it("drops anything that is not a URL at all", () => {
    expect(safeUrl("see wikipedia")).toBeUndefined();
    expect(safeUrl(42)).toBeUndefined();
    expect(safeUrl(undefined)).toBeUndefined();
  });
});

describe("findOccurrences", () => {
  it("finds the term under its name and its aliases", () => {
    const found = findOccurrences(
      entry({ name: "nonreductive explanation", aliases: ["nonreductive"] }),
      BLOCKS,
    );
    expect(found).toEqual(["spya-bbbbbb", "spya-cccccc"]);
  });

  it("returns an empty list rather than pretending, when the words are not there", () => {
    // Stored, not smoothed over: it means the model named a term this article
    // does not use in those words, and the panel says so. It is the one signal
    // we have about whether the alias instruction landed.
    expect(findOccurrences(entry({ name: "panpsychism" }), BLOCKS)).toEqual([]);
  });

  it("agrees with what the reading view will underline", () => {
    // The two halves share src/term-match.ts precisely so they cannot disagree.
    // A block in this list that the client then fails to underline is the
    // silent-success failure this arrangement exists to prevent.
    const term = entry({ name: "Seth" });
    const found = findOccurrences(term, BLOCKS);
    const pattern = termPattern(formsOf(term))!;
    for (const id of found) {
      const b = BLOCKS.find((x) => x.id === id)!;
      expect(termSpans(b.text, pattern).length).toBeGreaterThan(0);
    }
  });
});

describe("inDocumentOrder", () => {
  it("orders by first use, and puts the unmatched last", () => {
    const ordered = inDocumentOrder(
      [
        entry({ name: "ghost", blocks: [] }),
        entry({ name: "second", blocks: ["spya-cccccc"] }),
        entry({ name: "first", blocks: ["spya-aaaaaa"] }),
      ],
      BLOCKS,
    );
    expect(ordered.map((e) => e.name)).toEqual(["first", "second", "ghost"]);
  });
});

describe("buildGlossary", () => {
  const opts = { slug: "a-slug", blocks: BLOCKS, sourceHash: "deadbeefdeadbeef", elapsedMs: 1234 };

  it("keeps only what it can render, and degrades the rest", () => {
    const g = buildGlossary(
      {
        entries: [
          { name: "Seth", kind: "person", gloss: "The author.", centrality: 0.9 },
          { name: "", gloss: "no name" },
          { name: "no gloss" },
          { name: "Qualia", kind: "philosophy", gloss: "Raw feels.", difficulty: 7 },
        ],
      },
      opts,
    );
    expect(g.entries.map((e) => e.name)).toEqual(["Seth", "Qualia"]);
    // An invented kind becomes `other` rather than failing the batch, and a
    // score outside 0–1 is dropped rather than clamped: a clamp would turn a
    // model error into a plausible number nobody could question.
    expect(g.entries.find((e) => e.name === "Qualia")?.kind).toBe("other");
    expect(g.entries.find((e) => e.name === "Qualia")?.difficulty).toBeUndefined();
  });

  it("fills in the occurrences itself", () => {
    const g = buildGlossary({ entries: [{ name: "Seth", gloss: "The author." }] }, opts);
    expect(g.entries[0]?.blocks).toEqual(["spya-aaaaaa"]);
  });

  it("throws rather than writing an empty glossary", () => {
    // Nothing to say is not a degenerate success — it is a model call that
    // produced nothing, and writing it would make the step report done for ever.
    expect(() => buildGlossary({ entries: [] }, opts)).toThrow(/no terms/i);
    expect(() => buildGlossary({}, opts)).toThrow(/no terms/i);
  });

  it("appends on a second pass instead of replacing", () => {
    const first = buildGlossary({ entries: [{ name: "Seth", gloss: "The author." }] }, opts);
    const second = buildGlossary({ entries: [{ name: "Qualia", gloss: "Raw feels." }] }, {
      ...opts,
      existing: first,
    });
    expect(second.entries.map((e) => e.name).sort()).toEqual(["Qualia", "Seth"]);
    expect(second.passes).toBe(2);
    // Elapsed is cumulative, so "what did this list cost" stays answerable
    // after a second call rather than being overwritten by the cheaper one.
    expect(second.elapsedMs).toBe(first.elapsedMs + opts.elapsedMs);
  });

  it("keeps a second pass's entries even when the model returns nothing new", () => {
    const first = buildGlossary({ entries: [{ name: "Seth", gloss: "The author." }] }, opts);
    const second = buildGlossary({ entries: [] }, { ...opts, existing: first });
    expect(second.entries).toHaveLength(1);
    expect(second.passes).toBe(2);
  });
});

describe("suggestedCount", () => {
  it("scales with the article and never exceeds one batch", () => {
    expect(suggestedCount(400)).toBe(6);
    expect(suggestedCount(4000)).toBe(10);
    // The ceiling is the whole point: their extraction 504'd on OUTPUT tokens,
    // because every entry carries two explanations.
    expect(suggestedCount(100_000)).toBe(BATCH_SIZE);
  });
});

describe("isStale", () => {
  /* The three inputs this stage's prompt reads — `renderPrompt` builds the
     skeleton out of the tree and `articleText` writes the metadata head — so
     all three are in the fingerprint. src/source-hash.ts § `articleFingerprint`. */
  const STALE_TREE: Tree = {
    version: "toc/2",
    generator: CAPABLE_MODEL,
    slug: "a-slug",
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        parent: null,
        range: [BLOCKS[0]!.id, BLOCKS[BLOCKS.length - 1]!.id],
        title: "The whole thing",
        gist: "One sentence.",
        children: [],
      },
    },
  } as unknown as Tree;
  const STALE_META = { title: "A title", byline: "Seth", siteName: "Somewhere" };

  function glossary(over: Partial<Glossary> = {}): Glossary {
    return {
      version: PROMPT_VERSION,
      generator: CAPABLE_MODEL,
      slug: "a-slug",
      sourceHash: articleFingerprint(BLOCKS, STALE_TREE, STALE_META),
      entries: [entry({ name: "Seth" })],
      passes: 1,
      generatedAt: "2026-08-25T12:00:00.000Z",
      elapsedMs: 4000,
      ...over,
    };
  }

  it("notices when the blocks it was written from have moved", () => {
    expect(isStale(glossary(), BLOCKS, STALE_TREE, STALE_META)).toBe(false);
    expect(
      isStale(
        glossary(),
        [...BLOCKS, block("spya-dddddd", "A new paragraph.")],
        STALE_TREE,
        STALE_META,
      ),
    ).toBe(true);
  });

  /* Red before 2026-08-31, when this compared the blocks alone: the prompt
     shows the model the skeleton, so a re-cut article is a different question
     at byte-identical blocks. docs/plans/finish-the-database-move.md § stage 1. */
  it("notices when the sections have been re-cut under it", () => {
    const recut = {
      ...STALE_TREE,
      nodes: { n0: { ...STALE_TREE.nodes.n0!, gist: "A different sentence." } },
    } as Tree;
    expect(isStale(glossary(), BLOCKS, recut, STALE_META)).toBe(true);
  });

  /* Red before the same date. The extracted title is stage 2's, so a
     re-extraction moves it, and it goes straight into the head of this prompt.
     Not the reader's own rename — that is a shelf override no generator sees. */
  it("notices when the article has been renamed under it", () => {
    expect(isStale(glossary(), BLOCKS, STALE_TREE, { ...STALE_META, title: "Renamed" })).toBe(true);
  });
});

/* The three `glossaryIsCurrent` cases that stood here were deleted with the
   function on 2026-08-28. It had no caller outside this file: the pipeline
   moved to `stamp` and src/pipeline.ts kept a comment saying the CLI still used
   it, which was not true. The conditions those tests covered — blocks, prompt
   version, model — are asserted against the live path in
   tests/pipeline-artifact-store.test.ts. See docs/plans/simplification-wave-2.md § 0.5. */

describe("sortEntries", () => {
  const list = [
    entry({ name: "first", difficulty: 0.2, centrality: 0.9 }),
    entry({ name: "second", difficulty: 0.8, centrality: 0.1 }),
    entry({ name: "unscored" }),
  ];

  it("leaves document order alone", () => {
    expect(sortEntries(list, "document").map((e) => e.name)).toEqual(["first", "second", "unscored"]);
  });

  it("sorts descending, because nobody wants the easiest word first", () => {
    expect(sortEntries(list, "difficulty").map((e) => e.name)).toEqual([
      "second",
      "first",
      "unscored",
    ]);
    expect(sortEntries(list, "centrality").map((e) => e.name)).toEqual([
      "first",
      "second",
      "unscored",
    ]);
  });

  it("puts an unscored entry last rather than treating it as zero", () => {
    // An entry the model declined to score is not one it scored as trivial, and
    // treating the two the same is the small lie that makes a sort untrustworthy.
    expect(sortEntries(list, "difficulty").at(-1)?.name).toBe("unscored");
  });

  it("does not mutate the list it was given", () => {
    const before = list.map((e) => e.name);
    sortEntries(list, "difficulty");
    expect(list.map((e) => e.name)).toEqual(before);
  });
});

describe("rowScores", () => {
  const e = entry({ name: "term", difficulty: 0.7, centrality: 0.3 });

  it("shows nothing at all when the list is in document order", () => {
    /* The regression this exists for, found in a browser. The call site used to
       be `showScore === "difficulty" ? entry.difficulty : entry.centrality`, so
       the default — `null`, meaning document order — fell through to the
       centrality branch and printed the model's ranking beside every term in a
       list that was not ranked by it.

       That is exactly what the condition on keeping these scores forbids: the
       objection was never to the numbers existing, it was to the model's
       prioritising arriving unasked. See docs/project/glossary.md § The scores. */
    expect(rowScores(e, null)).toEqual([]);
    expect(rowScores(e, "document")).toEqual([]);
  });

  it("shows the one the list is actually ordered by", () => {
    expect(rowScores(e, "difficulty")).toEqual([{ key: "difficulty", value: 0.7 }]);
    expect(rowScores(e, "centrality")).toEqual([{ key: "centrality", value: 0.3 }]);
  });

  it("shows both under prioritised, and never the product", () => {
    // The composite is our arithmetic dressed as the model's judgment — a
    // number the reader can neither interpret nor check. The two the gate was
    // computed from are the honest thing to put on the row.
    expect(rowScores(e, "prioritised")).toEqual([
      { key: "difficulty", value: 0.7 },
      { key: "centrality", value: 0.3 },
    ]);
  });

  it("shows nothing for an entry the model declined to score", () => {
    expect(rowScores(entry({ name: "bare" }), "difficulty")).toEqual([]);
  });

  it("shows neither number under prioritised when only one of them is there", () => {
    // A row shows exactly the numbers its position was decided on. This entry's
    // position could not be decided on them — it cannot clear a gate that needs
    // both — so showing the one it has would suggest a basis that isn't there.
    expect(rowScores(entry({ name: "half", difficulty: 0.9 }), "prioritised")).toEqual([]);
    expect(rowScores(entry({ name: "half", centrality: 0.9 }), "prioritised")).toEqual([]);
  });
});

describe("priorityOf", () => {
  it("multiplies the two scores rather than adding them", () => {
    /* The whole design, in one assertion. What the reader wants ordered is the
       cost of not knowing a term — how likely it is to stop them, times how
       much of the argument stops with it. A sum gets both ends wrong, and these
       two entries are the two ends: a central-but-easy word nobody needs
       flagged, and a hard-but-peripheral one that is exactly the distraction a
       priority list exists to keep off the top. Both must come out low. */
    expect(priorityOf(entry({ name: "easy-central", difficulty: 0.1, centrality: 0.9 }))).toBeCloseTo(0.09);
    expect(priorityOf(entry({ name: "hard-fringe", difficulty: 0.9, centrality: 0.1 }))).toBeCloseTo(0.09);
    // And the one that is both comes out far above them, on the same scores.
    expect(priorityOf(entry({ name: "both", difficulty: 0.7, centrality: 0.7 }))).toBeCloseTo(0.49);
  });

  it("is nothing at all when either score is missing", () => {
    expect(priorityOf(entry({ name: "d-only", difficulty: 0.9 }))).toBeUndefined();
    expect(priorityOf(entry({ name: "c-only", centrality: 0.9 }))).toBeUndefined();
    expect(priorityOf(entry({ name: "bare" }))).toBeUndefined();
  });
});

describe("prioritised order", () => {
  const hard = entry({ name: "hard", difficulty: 0.8, centrality: 0.8 }); // 0.64, in
  const easy = entry({ name: "easy", difficulty: 0.1, centrality: 0.9 }); // 0.09, out
  const fringe = entry({ name: "fringe", difficulty: 0.9, centrality: 0.1 }); // 0.09, out
  const alsoHard = entry({ name: "also-hard", difficulty: 0.6, centrality: 0.7 }); // 0.42, in
  const bare = entry({ name: "bare" });
  const list = [easy, hard, fringe, alsoHard, bare];

  it("puts the hard-and-central terms first and everything else after", () => {
    const groups = groupEntries(list, "prioritised");
    expect(groups.map((g) => g.label)).toEqual(["worth knowing first", "the rest"]);
    expect(groups[0]?.entries.map((e) => e.name)).toEqual(["hard", "also-hard"]);
    expect(groups[1]?.entries.map((e) => e.name)).toEqual(["easy", "fringe", "bare"]);
  });

  it("keeps first use as the order inside each group", () => {
    // The third thing Greg asked for, and where it actually lives. `easy` is
    // first in the document and stays first in its group; `hard` precedes
    // `also-hard` for the same reason and not because it scored higher.
    const [top, rest] = groupEntries(list, "prioritised");
    const docIndex = (name: string) => list.findIndex((e) => e.name === name);
    for (const group of [top, rest]) {
      const order = group!.entries.map((e) => docIndex(e.name));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it("gates on the product, so a high single score is not enough", () => {
    // 0.95 difficulty and 0.3 centrality is 0.285 — under the gate, and under
    // it on purpose. This is the assertion that a sum would fail.
    const nearly = entry({ name: "nearly", difficulty: 0.95, centrality: 0.3 });
    expect(priorityOf(nearly)!).toBeLessThan(PRIORITY_GATE);
    const groups = groupEntries([hard, nearly], "prioritised");
    expect(groups[0]?.entries.map((e) => e.name)).toEqual(["hard"]);
  });

  it("draws no divider when the gate divides nothing", () => {
    /* The self-cancelling half. An old glossary with no scores, or one where
       everything is above the gate, or one where nothing is — all three are
       first-use order in a single unheaded group, which is exactly what the
       list did before this order existed. A label over any of those would be
       claiming a judgment nothing supports. */
    for (const undividable of [
      [bare, entry({ name: "bare2" })],
      [hard, alsoHard],
      [easy, fringe],
    ]) {
      expect(splitsOnPriority(undividable)).toBe(false);
      const groups = groupEntries(undividable, "prioritised");
      expect(groups).toHaveLength(1);
      expect(groups[0]?.label).toBeNull();
      expect(groups[0]?.entries).toEqual(undividable);
    }
  });

  it("leaves the order in force only when there is nothing at all to gate", () => {
    /* The line the slider moved, 2026-08-26, and the reason to have it in a
       test rather than only in a docstring. A list with no scores cannot be
       prioritised by anything, so it falls back to first use and the control is
       not offered. A list *with* scores that the current bar happens not to
       divide stays in prioritised order — because the bar is now on screen and
       one drag from dividing it, and cancelling the mode would take the slider
       away with it and strand the reader at the setting they were adjusting. */
    expect(effectiveSort([bare, entry({ name: "bare2" })], "prioritised")).toBe("document");
    expect(effectiveSort([hard, alsoHard], "prioritised")).toBe("prioritised");
    expect(effectiveSort([easy, fringe], "prioritised")).toBe("prioritised");
    // And a single term is not a list to prioritise, whatever it scored.
    expect(effectiveSort([hard], "prioritised")).toBe("document");
  });

  it("leaves the other three orders alone", () => {
    expect(splitsOnPriority(list)).toBe(true);
    for (const sort of ["document", "difficulty", "centrality"] as const) {
      expect(effectiveSort(list, sort)).toBe(sort);
      expect(groupEntries(list, sort)).toHaveLength(1);
      expect(groupEntries(list, sort)[0]?.label).toBeNull();
    }
  });

  it("flattens to the same thing sortEntries returns", () => {
    // Two ways of asking what order the list is in must not be able to
    // disagree, so one is defined as the other.
    expect(sortEntries(list, "prioritised").map((e) => e.name)).toEqual(
      groupEntries(list, "prioritised").flatMap((g) => g.entries.map((e) => e.name)),
    );
  });

  it("does not mutate the list it was given", () => {
    const before = list.map((e) => e.name);
    groupEntries(list, "prioritised");
    sortEntries(list, "prioritised");
    expect(list.map((e) => e.name)).toEqual(before);
  });
});

describe("the threshold slider", () => {
  /* Greg, 2026-08-26: "Add a small threshold-slider to the Glossary UI (set to
     a sensible default)". The slider itself is a native range input and has no
     logic worth testing; what is tested here is everything it reads — where its
     track ends, what it counts, and what it says when it has divided nothing. */
  const hard = entry({ name: "hard", difficulty: 0.8, centrality: 0.8 }); // 0.64
  const mid = entry({ name: "mid", difficulty: 0.6, centrality: 0.5 }); // 0.30
  const low = entry({ name: "low", difficulty: 0.2, centrality: 0.2 }); // 0.04
  const bare = entry({ name: "bare" });
  const list = [hard, mid, low, bare];

  it("moves the boundary, which is the whole point of it", () => {
    const names = (gate: number) =>
      groupEntries(list, "prioritised", gate)[0]?.entries.map((e) => e.name);
    expect(names(0.5)).toEqual(["hard"]);
    expect(names(0.64)).toEqual(["hard"]);
    expect(names(0.3)).toEqual(["hard", "mid"]);
    expect(names(0.01)).toEqual(["hard", "mid", "low"]);
    // `bare` never clears any bar: an entry the model declined to score is not
    // one it scored as trivial, and no position of the slider promotes it.
    expect(names(0)).toEqual(["hard", "mid", "low"]);
    // Pushed past the top term there is nothing left to divide, so the divider
    // goes rather than a group of nothing being drawn under a label. That is
    // the state `gateNote` exists to put into words.
    expect(groupEntries(list, "prioritised", 0.7)).toHaveLength(1);
    expect(groupEntries(list, "prioritised", 0.7)[0]?.label).toBeNull();
  });

  it("defaults to the constant when nobody has set it", () => {
    // Two callers, one default, and the gate the URL leaves out. If these ever
    // disagree the panel and its own heading are describing different lists.
    expect(groupEntries(list, "prioritised")).toEqual(
      groupEntries(list, "prioritised", PRIORITY_GATE),
    );
    expect(sortEntries(list, "prioritised")).toEqual(
      sortEntries(list, "prioritised", PRIORITY_GATE),
    );
    expect(splitsOnPriority(list)).toBe(splitsOnPriority(list, PRIORITY_GATE));
  });

  it("counts what clears the bar, inclusively", () => {
    // `mid` is exactly 0.30 and is in at 0.30. The gate is a floor, not a
    // fence: the heading says "0.30 or more" and this is that.
    expect(countAbove(list, 0.3)).toBe(2);
    expect(countAbove(list, 0.31)).toBe(1);
    expect(countAbove([], 0.3)).toBe(0);
  });

  it("ends the track at the top term's own score, rounded down", () => {
    /* 0.8 × 0.8 is 0.6400000000000001 in binary floating point. Rounding the
       track's end *up* would put it above every product in the list, so the
       far right of the slider would promote nothing — the one thing that end
       must not mean. Down, and the far right promotes exactly the costliest
       term, which is the most useful thing it can mean. */
    const max = gateMax(list, PRIORITY_GATE);
    expect(max).toBeCloseTo(0.64);
    expect(countAbove(list, max)).toBe(1);
  });

  it("keeps the thumb on the track when a URL asks for more than the data holds", () => {
    // `?gate=0.90` on a glossary whose best term is 0.64. The value stands —
    // nothing is promoted, which is a true answer — but the track has to reach
    // it or the thumb sits pinned at a number it does not hold.
    expect(gateMax(list, 0.9)).toBeCloseTo(0.9);
    // And a glossary with nothing scored still gets a track rather than a
    // zero-width one, though the slider is not shown for it.
    expect(gateMax([bare], 0)).toBe(GATE_STEP);
  });

  it("says so when the bar has stopped dividing anything", () => {
    /* The silent-success guard — docs/reusable/silent-success.md. A slider that
       has merged the two groups looks exactly like a slider that has stopped
       working, and the difference has to be in words rather than in the
       absence of a divider. */
    expect(gateNote(list, 0.3)).toBeNull();
    expect(gateNote(list, 0.9)).toMatch(/^No term clears/);
    expect(gateNote([hard, mid], 0.01)).toMatch(/^Every term clears/);
    // Nothing to say about a list with nothing in it.
    expect(gateNote([], 0.3)).toBeNull();
  });

  it("offers the order whenever there is anything to gate", () => {
    /* Deliberately looser than `splitsOnPriority`, and the looseness is the
       slider's doing. A list the default bar does not divide is one drag from
       being divided, so refusing to offer the order would hide the fix along
       with the problem — and the option would appear and vanish under the
       reader's hand mid-drag. */
    expect(canPrioritise(list)).toBe(true);
    expect(canPrioritise([hard, mid])).toBe(true);
    expect(splitsOnPriority([hard, mid], 0.01)).toBe(false);
    expect(canPrioritise([bare, entry({ name: "bare2" })])).toBe(false);
    expect(canPrioritise([hard])).toBe(false);
    expect(canPrioritise([])).toBe(false);
  });

  it("reads and writes the gate as two decimal places", () => {
    // What you drag to is what the URL says, and what the URL says comes back
    // as the same number — a slider whose value drifted through a reload would
    // regroup the list for no visible reason.
    expect(gateParam.parse("0.45")).toBe(0.45);
    expect(gateParam.parse("0.30")).toBe(0.3);
    expect(gateParam.serialize(0.3)).toBe("0.30");
    expect(gateParam.serialize(0.6400000000000001)).toBe("0.64");
  });

  it("refuses a gate that is not a threshold at all", () => {
    // Same rule as every other parser in params.ts: a mangled or hostile link
    // degrades to the default rather than throwing or grouping on NaN.
    for (const bad of ["", "high", "-0.2", "1.5", "NaN", "Infinity"]) {
      expect(gateParam.parse(bad)).toBeNull();
    }
    expect(gateParam.parse("0")).toBe(0);
    expect(gateParam.parse("1")).toBe(1);
  });
});

describe("what an entry says — the glossary/2 field split", () => {
  /* The rewrite of 2026-08-26. Greg, on the entry for a person the article
     quotes once — "Computer scientist quoted for the line '...', which the
     article uses to argue writing and thinking are inseparable":

     > it's pretty weak! It adds almost nothing to the user's knowledge of
     > Leslie Lamport, nor does it add any useful explanatory gloss

     The diagnosis is that the entry is the model obeying a prompt that had no
     good answer for an allusion, and the fix is two fields whose names carry
     their provenance. What is testable is the plumbing that shape needs; the
     prose itself is a model call and is not. See
     docs/plans/glossary-entries-worth-reading.md. */
  const opts = { slug: "a-slug", blocks: BLOCKS, sourceHash: "deadbeefdeadbeef", elapsedMs: 1234 };

  it("keeps an entry with only one of the two prose fields", () => {
    /* The whole point. A coinage needs no background; a person simply quoted
       needs no senseHere — and being forced to write one is what produced the
       sentence that started this. Both must survive the drop rule. */
    const g = buildGlossary(
      {
        entries: [
          { name: "write-nots", senseHere: "Graham's coinage for those who will not write." },
          { name: "Leslie Lamport", background: "Turing Award-winning computer scientist." },
          { name: "both", senseHere: "Narrowed here.", background: "Ordinarily wider." },
        ],
      },
      opts,
    );
    expect(g.entries.map((e) => e.name)).toEqual(["write-nots", "Leslie Lamport", "both"]);
    expect(g.entries[0]?.background).toBeUndefined();
    expect(g.entries[1]?.senseHere).toBeUndefined();
  });

  it("survives a malformed member of the entries array", () => {
    /* The salvage this function advertises only ever covered malformed *fields
       inside* an object — a `null` or a bare string in the array threw on the
       first property read and took every good entry with it. Found in review,
       and it is the failure the docstring promises does not happen. */
    const g = buildGlossary(
      {
        entries: [
          { name: "good", background: "b" },
          null,
          "not an object",
          42,
          { name: "also good", background: "b" },
        ],
      },
      opts,
    );
    expect(g.entries.map((e) => e.name)).toEqual(["good", "also good"]);
  });

  it("throws away an entry that has a name and nothing else", () => {
    // The new drop rule. A name on its own is not an entry, it is a word.
    const g = buildGlossary(
      {
        entries: [
          { name: "silent" },
          { name: "blank", senseHere: "   " },
          { name: "kept", background: "Something." },
        ],
      },
      opts,
    );
    expect(g.entries.map((e) => e.name)).toEqual(["kept"]);
  });

  it("folds a glossary/1 answer into background rather than dropping it", () => {
    /* The model is asked for the new fields and sometimes writes the old ones —
       the name it was trained on is a strong prior. `background` and not
       `senseHere` on purpose: the old `gloss` blended the two, and the panel
       labels senseHere "in this piece", so putting a blend there would
       attribute the model's own knowledge to the article. That is the one
       direction of error this design exists to prevent. */
    const g = buildGlossary(
      { entries: [{ name: "Seth", gloss: "The author.", detail: "Wrote a book." }] },
      opts,
    );
    expect(g.entries[0]?.background).toBe("The author. Wrote a book.");
    expect(g.entries[0]?.senseHere).toBeUndefined();
    expect(g.entries[0]?.gloss).toBeUndefined();
  });

  it("no longer emits fromOutside, because the field it flagged is gone", () => {
    // The boolean was a flag over a blob: no dose, no location. It fired on the
    // Lamport entry, which contained nothing from outside at all.
    const g = buildGlossary(
      { entries: [{ name: "Seth", background: "The author.", fromOutside: true }] },
      opts,
    );
    expect(g.entries[0]?.fromOutside).toBeUndefined();
  });

  it("takes the winner's prose as a bundle, never one field from each", () => {
    /* The third rule this line has had, and the one two reviewers argued for.
       Field-by-field `winner.x ?? loser.x` threw nothing away and broke the
       design twice over: it filled gaps the winner had left ON PURPOSE — the
       prompt now says an absent field is a real answer — and it could pair the
       loser's `senseHere` with the winner's `background`, so the "in this
       piece" section described a different entry from its own heading.

       The cost is visible here and is the reason it was argued about: the
       loser's `senseHere` is dropped. It is dropped because the alternative is
       claiming the article means something, in a section labelled as coming
       from the article, on the authority of a name that lost. */
    const out = dedupe([
      without(entry({ name: "nonreductive", senseHere: "The loser's reading." }), "background"),
      without(
        entry({
          name: "nonreductive explanation",
          aliases: ["nonreductive"],
          background: "The ordinary philosophical use.",
        }),
        "senseHere",
      ),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("nonreductive explanation");
    expect(out[0]?.background).toBe("The ordinary philosophical use.");
    expect(out[0]?.senseHere).toBeUndefined();
  });

  it("falls back to the loser's bundle when the winner has no prose at all", () => {
    // Having nothing to say is not the same as judging that nothing needed
    // saying. An entry with neither field is not overriding anything.
    const out = dedupe([
      entry({ name: "nonreductive", senseHere: "The only reading there is." }),
      without(
        without(entry({ name: "nonreductive explanation", aliases: ["nonreductive"] }), "senseHere"),
        "background",
      ),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("nonreductive explanation");
    expect(out[0]?.senseHere).toBe("The only reading there is.");
  });
});

describe("entryProse", () => {
  it("leads with what the article means, and falls back to background", () => {
    /* The one line that makes the split self-correcting. Told to leave out a
       senseHere that would only restate the page, the model writes background
       only for a person simply quoted — so the informative sentence is the one
       that reaches the closed row, and the panel never has to know what kind of
       term it is looking at. */
    expect(entryProse(entry({ name: "a", senseHere: "Here.", background: "Out there." })).lead).toBe(
      "Here.",
    );
    expect(
      entryProse(without(entry({ name: "b", background: "Out there." }), "senseHere")).lead,
    ).toBe("Out there.");
  });

  it("labels each section with where it came from", () => {
    const prose = entryProse(entry({ name: "a", senseHere: "Here.", background: "Out there." }));
    expect(prose.sections.map((s) => [s.key, s.label])).toEqual([
      ["senseHere", "in this piece"],
      ["background", "background"],
    ]);
    expect(prose.legacy).toBe(false);
  });

  it("renders a glossary/1 entry the old way rather than labelling a blend", () => {
    /* There is no honest label for a blended field. Putting the old `gloss`
       under "in this piece" would attribute the model's own knowledge to the
       article; putting it under "background" would deny the article the half
       that came from it. So it stays unlabelled until somebody regenerates —
       which the version bump is already prompting them to do. */
    const old = entryProse(without(entry({ name: "a", gloss: "A blend of both." }), "senseHere"));
    expect(old.legacy).toBe(true);
    expect(old.lead).toBe("A blend of both.");
    expect(old.sections).toEqual([]);
  });
});

describe("which prose a merge puts in front of the reader", () => {
  /* Raised in review, and the test was the reviewer's point rather than the
     rule: the existing merge test asserts both fields survive but never asserts
     **which one the reader sees first**, and the lead is the thing that matters.

     The rule here is `winner.x ?? loser.x` per field, so nothing is thrown away
     — and the cost, stated rather than discovered later, is that a merge can
     resurrect a `senseHere` the winner deliberately omitted. The prompt now
     treats an absent field as a real answer, so that omission may have been a
     judgment, and this fills it from the other entry anyway.

     Kept because the two failures are not equally visible. A resurrected weak
     line is on screen where a reader can see it is weak. A deleted good one is
     invisible, and there is nothing anywhere that would ever surface it. Prefer
     the error somebody can catch. */
  it("takes the winner's senseHere when it has one", () => {
    const out = dedupe([
      entry({ name: "Lamport", aliases: ["Leslie Lamport"], senseHere: "The loser's line." }),
      entry({ name: "Leslie Lamport", senseHere: "The winner's line." }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("Leslie Lamport");
    expect(entryProse(out[0]!).lead).toBe("The winner's line.");
  });

  it("cannot resurrect a senseHere the winner deliberately left out", () => {
    /* The failure both reviewers named, and the reason the rule changed. The
       model is told to omit `senseHere` for a person simply quoted; a second
       entry under a shorter name might not have obeyed. Field-by-field merging
       took the disobedient one and `entryProse` put it on the closed row —
       which is the exact entry this whole rewrite exists to eliminate,
       arriving through the merge path. */
    const out = dedupe([
      without(
        entry({
          name: "Lamport",
          aliases: ["Leslie Lamport"],
          senseHere: "Quoted for the line about writing and thinking.",
        }),
        "background",
      ),
      without(entry({ name: "Leslie Lamport", background: "Turing Award." }), "senseHere"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.senseHere).toBeUndefined();
    expect(entryProse(out[0]!).lead).toBe("Turing Award.");
  });
});

describe("replacing a glossary/1 list, and keeping its ids", () => {
  /* The regression test for the data-loss bug, at the level where it happened.
     `buildGlossary` takes `existing` and needs no model call, so the whole
     append path is assertable here.

     What went wrong: refusing to append across a version boundary meant
     `existing` arrived null, `taken` was empty, and every id was re-minted —
     killing every `?term=` link the reader held — while the file was
     overwritten and `passes` reset to 1. The button that did it said "Find more
     terms". */
  const opts = { slug: "a-slug", blocks: BLOCKS, sourceHash: "deadbeefdeadbeef", elapsedMs: 1 };

  const v1: Glossary = {
    version: "glossary/1",
    generator: CAPABLE_MODEL,
    slug: "a-slug",
    sourceHash: "deadbeefdeadbeef",
    entries: [without(entry({ name: "Seth", gloss: "The author." }), "senseHere")],
    passes: 1,
    generatedAt: "2026-08-25T12:00:00.000Z",
    elapsedMs: 1,
  };

  it("refuses to append across a prompt-version boundary", () => {
    /* Both halves of `existingFor` matter, and the second was argued about
       twice. A moved article makes the old entries claims about a piece that no
       longer exists. An older prompt makes them answers to a different
       question, and appending would hand the model a FORBIDDEN list naming
       every one of them — so it never rewrites them, and the result is stamped
       with the current version while the old weak entries survive under labels
       that do not describe them. */
    expect(existingFor(v1, "deadbeefdeadbeef")).toBeNull();
    expect(existingFor({ ...v1, version: PROMPT_VERSION }, "deadbeefdeadbeef")).not.toBeNull();
    expect(existingFor({ ...v1, version: PROMPT_VERSION }, "a-different-hash")).toBeNull();
    expect(existingFor(null, "deadbeefdeadbeef")).toBeNull();
  });

  it("refuses to append across a change of reader profile", () => {
    /* **The gate is here, not in `isStale`.** Folding the profile into `isStale`
       and stopping would have left this path untouched: the top-up would append
       terms written for a physicist to terms written for nobody in particular,
       and stamp the whole list with the new hash. A lie about provenance,
       written by us, into a file. docs/project/reader-profile.md.

       Note this is stricter than `profileIsStale`, where `null` never counts —
       there the question is "should we warn them", here it is "may these two
       lists be merged". */
    const current = { ...v1, version: PROMPT_VERSION };
    const HASH = "0123456789abcdef";
    const OTHER = "fedcba9876543210";

    // Written without a profile, and none now: mergeable.
    expect(existingFor(current, "deadbeefdeadbeef")).not.toBeNull();
    expect(existingFor(current, "deadbeefdeadbeef", null)).not.toBeNull();
    // A list written before the field existed compares equal to one written
    // without a profile. Neither was written for anybody in particular.
    expect(existingFor({ ...current, profileHash: null }, "deadbeefdeadbeef", null)).not.toBeNull();

    // Same profile: mergeable.
    expect(
      existingFor({ ...current, profileHash: HASH }, "deadbeefdeadbeef", HASH),
    ).not.toBeNull();

    // Every mismatch refuses, including in both directions across `null`.
    expect(existingFor({ ...current, profileHash: HASH }, "deadbeefdeadbeef", OTHER)).toBeNull();
    expect(existingFor({ ...current, profileHash: HASH }, "deadbeefdeadbeef", null)).toBeNull();
    expect(existingFor({ ...current, profileHash: null }, "deadbeefdeadbeef", HASH)).toBeNull();
    expect(existingFor(current, "deadbeefdeadbeef", HASH)).toBeNull();
  });

  it("carries the ids across the rewrite, which is what refusing forgot", () => {
    /* The data-loss bug, and the shape of its real fix. Refusing to append was
       right; doing it without inheriting ids was not. `taken` was empty, every
       id was re-minted, and with them went every `?term=` link the reader held
       and every lookup they had paid for — all behind a button that said "Find
       more terms". */
    const before = v1.entries[0]!.id;
    const g = buildGlossary(
      { entries: [{ name: "Seth", background: "Rewritten properly." }] },
      { ...opts, existing: null, inherit: idsByTerm(v1) },
    );
    expect(g.entries[0]?.id).toBe(before);
    // And the prose IS new, which is the thing appending could never do.
    expect(g.entries[0]?.background).toBe("Rewritten properly.");
    expect(g.entries[0]?.gloss).toBeUndefined();
  });

  it("inherits by alias too, and never gives one id to two terms", () => {
    const twoNames: Glossary = {
      ...v1,
      entries: [without(entry({ name: "Leslie Lamport", aliases: ["Lamport"] }), "senseHere")],
    };
    const ids = idsByTerm(twoNames);
    const g = buildGlossary(
      {
        entries: [
          { name: "Lamport", background: "First claimant, by alias." },
          { name: "Leslie Lamport", background: "Second, wants the same id." },
        ],
      },
      { ...opts, existing: null, inherit: ids },
    );
    const inherited = twoNames.entries[0]!.id;
    const got = g.entries.map((e) => e.id);
    expect(got).toContain(inherited);
    // Two entries, two ids. An id is identity; handing one to two terms would
    // make a `?term=` link ambiguous and a stored lookup attach to the wrong row.
    expect(new Set(got).size).toBe(g.entries.length);
  });

  it("does not mint a fresh id that an inherited one is about to take", () => {
    // The collision `taken` exists to prevent, now that ids arrive from two
    // places rather than one.
    const ids = idsByTerm(v1);
    const g = buildGlossary(
      { entries: [{ name: "Qualia", background: "Unrelated." }, { name: "Seth", background: "New." }] },
      { ...opts, existing: null, inherit: ids },
    );
    expect(new Set(g.entries.map((e) => e.id)).size).toBe(g.entries.length);
    expect(g.entries.find((e) => e.name === "Seth")?.id).toBe(v1.entries[0]!.id);
  });
});

