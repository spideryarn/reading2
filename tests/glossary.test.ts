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
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BATCH_SIZE,
  buildGlossary,
  dedupe,
  findOccurrences,
  glossaryIsCurrent,
  inDocumentOrder,
  isStale,
  normaliseTerm,
  richness,
  safeUrl,
  suggestedCount,
} from "../src/glossary.js";
import { formsOf, termPattern, termSpans } from "../src/term-match.js";
import { hashBlocks } from "../src/source-hash.js";
import { MODEL } from "../src/models.js";
import { scoreShown, sortEntries } from "../src/web/GlossaryPanel.js";
import type { Block, Glossary, GlossaryEntry } from "../src/types.js";

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
    gloss: `What ${over.name} means here.`,
    blocks: [],
    ...over,
  };
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

describe("isStale / glossaryIsCurrent", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  async function scratch(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "spya-gloss-"));
    dirs.push(dir);
    return dir;
  }

  function glossary(over: Partial<Glossary> = {}): Glossary {
    return {
      version: "glossary/1",
      generator: MODEL,
      slug: "a-slug",
      sourceHash: hashBlocks(BLOCKS),
      entries: [entry({ name: "Seth" })],
      passes: 1,
      generatedAt: "2026-08-25T12:00:00.000Z",
      elapsedMs: 4000,
      ...over,
    };
  }

  it("notices when the blocks it was written from have moved", () => {
    expect(isStale(glossary(), BLOCKS)).toBe(false);
    expect(isStale(glossary(), [...BLOCKS, block("spya-dddddd", "A new paragraph.")])).toBe(true);
  });

  it("is current when the blocks, the prompt and the model all still hold", async () => {
    const dir = await scratch();
    await writeFile(path.join(dir, "blocks.json"), JSON.stringify({ blocks: BLOCKS }));
    await writeFile(path.join(dir, "glossary.json"), JSON.stringify(glossary()));
    expect(await glossaryIsCurrent(dir)).toBe(true);
  });

  it("is not current when the prompt version or the model changed", async () => {
    const dir = await scratch();
    await writeFile(path.join(dir, "blocks.json"), JSON.stringify({ blocks: BLOCKS }));
    await writeFile(path.join(dir, "glossary.json"), JSON.stringify(glossary({ version: "glossary/0" })));
    expect(await glossaryIsCurrent(dir)).toBe(false);
    await writeFile(
      path.join(dir, "glossary.json"),
      JSON.stringify(glossary({ generator: "some-other-model" })),
    );
    expect(await glossaryIsCurrent(dir)).toBe(false);
  });

  it("answers false for anything it cannot read", async () => {
    // Not-current is the safe way to be wrong: the cost is one model call,
    // where the other way round is a stale glossary served for ever.
    const dir = await scratch();
    expect(await glossaryIsCurrent(dir)).toBe(false);
    await writeFile(path.join(dir, "glossary.json"), "{ not json");
    expect(await glossaryIsCurrent(dir)).toBe(false);
  });
});

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

describe("scoreShown", () => {
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
    expect(scoreShown(e, null)).toBeUndefined();
    expect(scoreShown(e, "document")).toBeUndefined();
  });

  it("shows the one the list is actually ordered by", () => {
    expect(scoreShown(e, "difficulty")).toBe(0.7);
    expect(scoreShown(e, "centrality")).toBe(0.3);
  });

  it("shows nothing for an entry the model declined to score", () => {
    expect(scoreShown(entry({ name: "bare" }), "difficulty")).toBeUndefined();
  });
});
