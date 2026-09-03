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
  noGlossaryScoreDrops,
  suggestedCount,
} from "../src/glossary.js";
import { formsOf, termPattern, termSpans } from "../src/term-match.js";
import { articleFingerprint } from "../src/source-hash.js";
import { CAPABLE_MODEL } from "../src/models.js";
import {
  GATE_STEP,
  PRIORITY_GATE,
  canPrioritise,
  effectiveSort,
  gateMax,
  gateTop,
  gateNote,
  gateToReveal,
  priorityOf,
  rowScores,
  sortEntries,
  visibleEntries,
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

/**
 * The foot line the panel would print, composed the way `GateSlider` composes
 * it: one `visibleEntries` pass, and the counts out of it handed to `gateNote`.
 *
 * A helper rather than a call to `gateNote(list, gate)`, because `gateNote`
 * deliberately takes counts and not a list — that is what keeps the sentence
 * and the `N of M` above it from being two passes that could disagree.
 */
function noteFor(entries: GlossaryEntry[], gate: number): string {
  return gateNote(visibleEntries(entries, gate).hiddenCount, entries.length);
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

/**
 * **The scores the prompt requires, and what happened when they did not come.**
 *
 * The glossary prompt requires `difficulty` and `centrality` on every entry, so
 * a missing one is the model disobeying rather than a permitted omission — and
 * until these counters existed nothing anywhere said so. A model that started
 * writing `centrality: "high"` would have quietly stopped offering prioritised
 * order and no log line would have moved. docs/reusable/silent-success.md, and
 * docs/plans/260903c-threshold-sliders-hide-below-threshold-items.md § Stage 1.
 *
 * **Absent and rejected are counted apart** because they are different
 * failures: absent is a field the model never wrote, rejected is one it wrote
 * wrong. A counter that only fired inside `score()` would never see the first.
 */
describe("buildGlossary score accounting", () => {
  const opts = { slug: "a-slug", blocks: BLOCKS, sourceHash: "deadbeefdeadbeef", elapsedMs: 1234 };

  it("counts nothing when both scores arrive in range", () => {
    const scores = noGlossaryScoreDrops();
    const g = buildGlossary(
      { entries: [{ name: "Seth", gloss: "The author.", difficulty: 0.4, centrality: 0.9 }] },
      { ...opts, scores },
    );
    expect(scores).toEqual({
      difficultyAbsent: 0,
      difficultyRejected: 0,
      centralityAbsent: 0,
      centralityRejected: 0,
    });
    // Unchanged from today: a good entry keeps both numbers exactly.
    expect(g.entries[0]?.difficulty).toBe(0.4);
    expect(g.entries[0]?.centrality).toBe(0.9);
  });

  it("counts a score the model simply left out", () => {
    const scores = noGlossaryScoreDrops();
    const g = buildGlossary(
      { entries: [{ name: "Seth", gloss: "The author.", difficulty: 0.4 }] },
      { ...opts, scores },
    );
    expect(scores.centralityAbsent).toBe(1);
    expect(scores.centralityRejected).toBe(0);
    expect(scores.difficultyAbsent).toBe(0);
    // Unchanged from today: the entry survives with the half it has.
    expect(g.entries[0]?.difficulty).toBe(0.4);
    expect(g.entries[0]?.centrality).toBeUndefined();
  });

  it("counts a score that was present and refused, separately", () => {
    const scores = noGlossaryScoreDrops();
    const g = buildGlossary(
      { entries: [{ name: "Qualia", gloss: "Raw feels.", difficulty: 7, centrality: "high" }] },
      { ...opts, scores },
    );
    expect(scores.difficultyRejected).toBe(1);
    expect(scores.centralityRejected).toBe(1);
    expect(scores.difficultyAbsent).toBe(0);
    expect(scores.centralityAbsent).toBe(0);
    // Unchanged from today: out of range is dropped, never clamped.
    expect(g.entries[0]?.difficulty).toBeUndefined();
    expect(g.entries[0]?.centrality).toBeUndefined();
  });

  it("counts nothing for an entry it threw away, and nothing for a previous pass", () => {
    /* An entry with no name never becomes a row, so it has no missing score —
       and the entries a second pass inherits were parsed by the run that
       counted them. Counting either would inflate the number this exists to
       watch. */
    const first = buildGlossary(
      { entries: [{ name: "Seth", gloss: "The author." }] },
      { ...opts, scores: noGlossaryScoreDrops() },
    );
    const scores = noGlossaryScoreDrops();
    buildGlossary(
      { entries: [{ name: "", gloss: "no name" }, null, "a bare string"] },
      { ...opts, existing: first, scores },
    );
    expect(scores).toEqual({
      difficultyAbsent: 0,
      difficultyRejected: 0,
      centralityAbsent: 0,
      centralityRejected: 0,
    });
  });

  it("counts what the model returned, before dedupe can borrow a score", () => {
    /* `dedupe` does `winner.difficulty ?? loser.difficulty`, so two half-scored
       duplicates merge into one fully-scored entry. Counting after that would
       report zero for a run in which the model omitted two scores — the exact
       silence these counters exist to break. */
    const scores = noGlossaryScoreDrops();
    const g = buildGlossary(
      {
        entries: [
          { name: "Seth", gloss: "The author.", difficulty: 0.4 },
          { name: "Seth", senseHere: "The author, again.", centrality: 0.9 },
        ],
      },
      { ...opts, scores },
    );
    expect(g.entries).toHaveLength(1);
    expect(scores.centralityAbsent).toBe(1);
    expect(scores.difficultyAbsent).toBe(1);
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
     at byte-identical blocks. docs/plans/260831b-finish-the-database-move.md § stage 1. */
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
   tests/pipeline-artifact-store.test.ts. See docs/plans/260828aj-simplification-wave-2.md § 0.5. */

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
  /* Rewritten 2026-09-03. These used to pin the two-group version — a "worth
     knowing first" heading over the survivors and "the rest" under them. Greg
     looked at the built thing and said hiding would be clearer, so what they
     protect now is the same three properties in the new shape: the *rule* is
     the product and not a sum, the order within what is shown is first use, and
     the mode cancels itself rather than offering a control that does nothing.
     docs/plans/260903c-threshold-sliders-hide-below-threshold-items.md. */
  const hard = entry({ name: "hard", difficulty: 0.8, centrality: 0.8 }); // 0.64, in
  const easy = entry({ name: "easy", difficulty: 0.1, centrality: 0.9 }); // 0.09, out
  const fringe = entry({ name: "fringe", difficulty: 0.9, centrality: 0.1 }); // 0.09, out
  const alsoHard = entry({ name: "also-hard", difficulty: 0.6, centrality: 0.7 }); // 0.42, in
  const bare = entry({ name: "bare" });
  const list = [easy, hard, fringe, alsoHard, bare];

  it("shows the hard-and-central terms and hides everything scored below", () => {
    expect(sortEntries(list, "prioritised").map((e) => e.name)).toEqual([
      "hard",
      "also-hard",
      // Unscored, and therefore shown at every position of the bar.
      "bare",
    ]);
  });

  it("keeps first use as the order of what it shows", () => {
    // The third thing Greg asked for, and where it actually lives. `hard`
    // precedes `also-hard` because the article introduces it first, not
    // because it scored higher — 0.64 and 0.42 would sort the same way here,
    // so the assertion uses a list where the two disagree.
    const byUse = [alsoHard, hard];
    expect(sortEntries(byUse, "prioritised").map((e) => e.name)).toEqual(["also-hard", "hard"]);
  });

  it("gates on the product, so a high single score is not enough", () => {
    // 0.95 difficulty and 0.3 centrality is 0.285 — under the gate, and under
    // it on purpose. This is the assertion that a sum would fail.
    const nearly = entry({ name: "nearly", difficulty: 0.95, centrality: 0.3 });
    expect(priorityOf(nearly)!).toBeLessThan(PRIORITY_GATE);
    expect(sortEntries([hard, nearly], "prioritised").map((e) => e.name)).toEqual(["hard"]);
  });

  it("shows the whole list, unheaded, when the gate hides nothing", () => {
    /* The self-cancelling half, and what replaced "draws no divider". An old
       glossary with no scores, or one where everything is above the gate — both
       are plainly the whole list in first-use order, which is exactly what it
       did before this order existed. The foot line is what says so now, in
       words, rather than the absence of a heading. */
    for (const whole of [
      [bare, entry({ name: "bare2" })],
      [hard, alsoHard],
    ]) {
      expect(sortEntries(whole, "prioritised")).toEqual(whole);
      expect(noteFor(whole, PRIORITY_GATE)).toBe("Nothing is hidden by this threshold.");
    }
  });

  it("hides everything scored and still shows the unscored", () => {
    /* Greg's interim rule, at the one bar that tests it: "In the interim,
       always show them." An entry the model declined to score is not one it
       scored as trivial, and no position of the slider hides it. */
    const out = visibleEntries([hard, bare], 1);
    expect(out.visible.map((e) => e.name)).toEqual(["bare"]);
    expect(out.hiddenCount).toBe(1);
    expect(out.unscoredCount).toBe(1);
  });

  it("stays in prioritised order even when the current gate hides nothing", () => {
    /* The line the slider moved, 2026-08-26, and the reason to have it in a
       test rather than only in a docstring. A glossary no position of the bar
       could filter cannot be prioritised at all, so it falls back to first use
       and the control is not offered. A glossary that *can* be filtered but
       whose current bar happens to hide nothing stays in prioritised order —
       because the bar is on screen and one drag from hiding something, and
       cancelling the mode would take the slider away with it and strand the
       reader at the setting they were adjusting. */
    expect(effectiveSort([bare, entry({ name: "bare2" })], "prioritised")).toBe("document");
    expect(effectiveSort([hard, alsoHard], "prioritised")).toBe("prioritised");
    expect(sortEntries([hard, alsoHard], "prioritised", 0)).toHaveLength(2);
    // Two entries with the *same* product: no bar divides them, so no order.
    expect(effectiveSort([easy, fringe], "prioritised")).toBe("document");
    // And a single term is not a list to prioritise, whatever it scored.
    expect(effectiveSort([hard], "prioritised")).toBe("document");
  });

  it("leaves the other three orders alone", () => {
    for (const sort of ["document", "difficulty", "centrality"] as const) {
      expect(effectiveSort(list, sort)).toBe(sort);
      // And returns every entry: only `prioritised` filters.
      expect(sortEntries(list, sort)).toHaveLength(list.length);
    }
  });

  it("does not mutate the list it was given", () => {
    const before = list.map((e) => e.name);
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
    const names = (gate: number) => sortEntries(list, "prioritised", gate).map((e) => e.name);
    /* `bare` is in every one of these: an entry the model declined to score is
       not one it scored as trivial, so no position of the slider hides it.
       Greg, 2026-09-03 — "in the interim, always show them". */
    expect(names(0.5)).toEqual(["hard", "bare"]);
    expect(names(0.64)).toEqual(["hard", "bare"]);
    expect(names(0.3)).toEqual(["hard", "mid", "bare"]);
    expect(names(0.01)).toEqual(["hard", "mid", "low", "bare"]);
    expect(names(0)).toEqual(["hard", "mid", "low", "bare"]);
    // Pushed past the top term, every scored entry goes and the foot line says
    // so — this is the state that used to collapse into one unheaded group.
    expect(names(0.7)).toEqual(["bare"]);
    expect(noteFor(list, 0.7)).toBe(
      "3 terms are hidden by this threshold. Drag the slider left to show them.",
    );
  });

  it("defaults to the constant when nobody has set it", () => {
    // Two callers, one default, and the gate the URL leaves out. If these ever
    // disagree the panel and the line under it are describing different lists.
    expect(sortEntries(list, "prioritised")).toEqual(
      sortEntries(list, "prioritised", PRIORITY_GATE),
    );
    expect(noteFor(list, PRIORITY_GATE)).toBe(
      "1 term is hidden by this threshold. Drag the slider left to show it.",
    );
  });

  it("counts the survivors and the hidden from one pass, inclusively", () => {
    /* `mid` is exactly 0.30 and is in at 0.30. The gate is a floor, not a
       fence: the row shows the numbers and a term that vanished at its own
       score would read as a bug.

       Asserted as an identity between the parts rather than as three separate
       numbers, because **a count that disagrees with the list under it** is
       this feature's worst failure. */
    const out = visibleEntries(list, 0.3);
    expect(out.visible.map((e) => e.name)).toEqual(["hard", "mid", "bare"]);
    expect(out.hiddenCount).toBe(1);
    expect(out.visible.length + out.hiddenCount).toBe(list.length);
    expect(visibleEntries(list, 0.31).visible.map((e) => e.name)).toEqual(["hard", "bare"]);
    expect(visibleEntries([], 0.3)).toEqual({ visible: [], hiddenCount: 0, unscoredCount: 0 });
  });

  it("ends the track at the top term's own score, rounded down", () => {
    /* 0.8 × 0.8 is 0.6400000000000001 in binary floating point. Rounding the
       track's end *up* would put it above every product in the list, so the far
       right of the slider would hide the costliest term too — the one thing
       that end must not do, and the property `canPrioritise` leans on. */
    const max = gateMax(list, PRIORITY_GATE);
    expect(max).toBeCloseTo(0.64);
    expect(visibleEntries(list, max).visible.map((e) => e.name)).toEqual(["hard", "bare"]);
  });

  it("keeps the thumb on the track when a URL asks for more than the data holds", () => {
    // `?gate=0.90` on a glossary whose best term is 0.64. The value stands —
    // every scored term is hidden, which is a true answer — but the track has to reach
    // it or the thumb sits pinned at a number it does not hold.
    expect(gateMax(list, 0.9)).toBeCloseTo(0.9);
    // And a glossary with nothing scored still gets a track rather than a
    // zero-width one, though the slider is not shown for it.
    expect(gateMax([bare], 0)).toBe(GATE_STEP);
  });

  it("says how many it is holding back, in every state", () => {
    /* The silent-success guard — docs/reusable/silent-success.md. A slider that
       has stopped hiding anything looks exactly like a slider that has stopped
       working, so the foot line is present wherever the slider is rather than
       only at the two ends. The copy is asserted verbatim: it is the reader's
       one route back, and "clears" is deliberately not in it. */
    expect(noteFor(list, 0.3)).toBe(
      "1 term is hidden by this threshold. Drag the slider left to show it.",
    );
    expect(noteFor(list, 0.9)).toBe(
      "3 terms are hidden by this threshold. Drag the slider left to show them.",
    );
    expect(noteFor([hard, mid], 0.01)).toBe("Nothing is hidden by this threshold.");
    expect(noteFor([hard, mid], 0.9)).toBe(
      "All 2 terms are hidden by this threshold. Drag the slider left to show them.",
    );
    // Nothing to hide in a list with nothing in it, and it says so rather than
    // going quiet — the panel does not draw a slider there anyway.
    expect(noteFor([], 0.3)).toBe("Nothing is hidden by this threshold.");
  });

  it("offers the order only when some position of the bar would hide something", () => {
    /* **Two distinct scored priorities**, which is stricter than the old rule
       and had to become so when the bar started hiding rather than grouping.
       With one distinct score every position of the track shows the same list:
       the track ends at the top term's own product, which therefore always
       survives, and an unscored entry survives everywhere. `[hard, bare]` is
       the case the old rule got wrong — it was true then, because `bare` formed
       "the rest".

       Still deliberately looser than "does the *current* bar hide anything": a
       bar that hides nothing right now is one drag from hiding something, and
       the option must not appear and vanish under the reader's hand mid-drag. */
    expect(canPrioritise(list)).toBe(true);
    expect(canPrioritise([hard, mid])).toBe(true);
    expect(visibleEntries([hard, mid], 0.01).hiddenCount).toBe(0);
    expect(canPrioritise([hard, bare])).toBe(false);
    expect(canPrioritise([hard, entry({ name: "twin", difficulty: 0.8, centrality: 0.8 })])).toBe(
      false,
    );
    expect(canPrioritise([bare, entry({ name: "bare2" })])).toBe(false);
    expect(canPrioritise([hard])).toBe(false);
    expect(canPrioritise([])).toBe(false);
  });

  it("keeps the grid honest through binary floating point", () => {
    /* The slider moves in hundredths, so both ends of the track and every gate
       written to the URL have to land on one. `x / 0.01` does not: `0.58 / 0.01`
       is `57.99999999999999`, so a naive floor loses a whole step and answers
       `0.57`, and `0.57 / 0.01` is `56.99999999999999`, which answers `0.56`.

       Off by a step is not cosmetic at either end. In `gateMax` it shortens the
       track, and in `gateToReveal` it lowers the gate further than the reader
       asked; and the two must agree, because `canPrioritise` is derived from
       the first. */
    const e58 = entry({ name: "e58", difficulty: 0.58, centrality: 1 });
    const e57 = entry({ name: "e57", difficulty: 0.57, centrality: 1 });
    const e30 = entry({ name: "e30", difficulty: 0.3, centrality: 1 });
    for (const [e, want] of [
      [e58, 0.58],
      [e57, 0.57],
      [e30, 0.3],
      /* 0.8 x 0.8 is 0.6400000000000001, which must floor *down* to 0.64 — a
         track ending a whisker above the top term would hide it. */
      [hard, 0.64],
    ] as const) {
      expect(gateMax([e], 0)).toBe(want);
      /* `low` is along only so the list can be prioritised at all — a glossary
         with one scored term has no gate to lower, and `gateToReveal` says so
         by answering null. */
      expect(gateToReveal([e, low], e.id, "prioritised", 1)).toBe(want);
      /* The property under both numbers: whatever the grid answers, the term it
         was computed from survives it. */
      expect(visibleEntries([e], gateMax([e], 0)).visible).toHaveLength(1);
    }
  });

  it("does not offer an order whose slider could not act on the difference", () => {
    /* The blocker GPT Sol found on the built code. Two distinct scores is not
       enough on its own, because the *slider* cannot reach between them: the
       track moves in hundredths and ends at the top score floored to one, so
       `[0.501, 0.509]` gives a track ending at 0.50 on which every position —
       0, 0.25, 0.50 — shows both terms. The old rule offered a prioritised
       order there whose slider visibly did nothing, which is the exact state
       this predicate exists to prevent.

       So the question is the top of the track, not the raw scores: does the
       highest position the reader can reach hide anything. */
    const closeA = entry({ name: "closeA", difficulty: 0.501, centrality: 1 });
    const closeB = entry({ name: "closeB", difficulty: 0.509, centrality: 1 });
    expect(canPrioritise([closeA, closeB])).toBe(false);
    expect(visibleEntries([closeA, closeB], gateMax([closeA, closeB], 0)).hiddenCount).toBe(0);
    /* One hundredth apart is reachable, and is offered. */
    expect(canPrioritise([closeA, entry({ name: "closeC", difficulty: 0.52, centrality: 1 })])).toBe(
      true,
    );
    /* Scores under one hundredth are the same case from the other end: they all
       floor to 0.00, so the data-derived top of the track is 0.00 and every
       position shows everything. The rendered track still gets its one-step
       floor (`gateMax`) so the input has a width — that floor is about drawing
       a slider and must not be what decides the order exists, or a glossary
       whose scores all round to zero would be offered a bar that can only show
       all or hide all. */
    const tiny = entry({ name: "tiny", difficulty: 0.005, centrality: 1 });
    const tinier = entry({ name: "tinier", difficulty: 0.009, centrality: 1 });
    expect(canPrioritise([tiny, tinier])).toBe(false);
    expect(gateTop([tiny, tinier])).toBe(0);
    expect(gateMax([tiny, tinier], 0)).toBe(GATE_STEP);
    /* And the same answer for two terms that tie, wherever they tie. */
    expect(canPrioritise([entry({ name: "z1", difficulty: 0, centrality: 1 }), entry({ name: "z2", difficulty: 0, centrality: 1 })])).toBe(false);
  });

  it("holds the same property over every list this file offers the order for", () => {
    /* The invariant the predicate is now written against, asserted rather than
       described: if the order is offered, the far right of the track hides at
       least one term. Whatever else changes, this is what "there is something
       to gate" has to mean. */
    const lists: GlossaryEntry[][] = [
      list,
      [hard, mid],
      [hard, bare],
      [hard],
      [],
      [
        entry({ name: "closeA", difficulty: 0.501, centrality: 1 }),
        entry({ name: "closeB", difficulty: 0.509, centrality: 1 }),
      ],
      [
        entry({ name: "tiny", difficulty: 0.005, centrality: 1 }),
        entry({ name: "tinier", difficulty: 0.009, centrality: 1 }),
      ],
    ];
    for (const candidate of lists) {
      const hides = visibleEntries(candidate, gateTop(candidate)).hiddenCount > 0;
      expect(canPrioritise(candidate)).toBe(hides);
    }
  });

  it("leaves a dormant gate alone in the orders that have no slider", () => {
    /* "In the glossary" lowers the gate so the term it opens is on screen. In
       any other order there is no gate on screen to lower: `?sort=document`
       with a stale `?gate=0.80` hides nothing, and rewriting it to 0.04 would
       set a threshold the reader never chose and never saw — which they would
       then meet on picking prioritised later. */
    for (const quiet of ["document", "difficulty", "centrality"] as const) {
      expect(gateToReveal(list, low.id, quiet, 0.8)).toBeNull();
    }
    expect(gateToReveal(list, low.id, "prioritised", 0.8)).toBeCloseTo(0.04);
    /* And nothing to lower when the list cannot be prioritised at all: the
       order in the URL is not the order in force (`effectiveSort`), so there is
       no slider here either. */
    expect(gateToReveal([hard, bare], hard.id, "prioritised", 0.9)).toBeNull();
    /* A term the panel has never heard of leaves it alone too. */
    expect(gateToReveal(list, "spya-nosuch", "prioritised", 0.8)).toBeNull();
  });

  it("answers the gate that would put a hidden term back on screen", () => {
    /* "In the glossary" on a prose hover card is a deliberate request to reveal
       a term, and it writes `?term=`. Without lowering the gate first, pressing
       it on a below-bar term opens the band on nothing at all. */
    expect(gateToReveal(list, low.id, "prioritised", PRIORITY_GATE)).toBeCloseTo(0.04);
    // Floored to the step, never rounded — a gate above the term it was set to
    // reveal is the one value it must not be. `gateParam` writes two decimals.
    const p = priorityOf(low)!;
    const lowered = gateToReveal(list, low.id, "prioritised", PRIORITY_GATE)!;
    expect(lowered).toBeLessThanOrEqual(p);
    expect(visibleEntries([low], lowered).visible).toHaveLength(1);
    // Null when nothing needs doing: the term is already on screen, or it has
    // no score and is therefore never hidden.
    expect(gateToReveal(list, hard.id, "prioritised", PRIORITY_GATE)).toBeNull();
    expect(gateToReveal(list, bare.id, "prioritised", 1)).toBeNull();
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
     docs/plans/260826d-glossary-entries-worth-reading.md. */
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

