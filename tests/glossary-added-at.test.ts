/**
 * **Every glossary entry says when it was added, and keeps saying the same
 * thing.** `GlossaryEntry.addedAt`, src/glossary.ts § `buildGlossary`,
 * § `merge` and § `InheritedEntry`. The twin of tests/quotes-added-at.test.ts.
 *
 * Greg, 2026-10-03: *"Store when it happened."* The list's `generatedAt` is
 * re-stamped by every *Find more*, so without a time of its own an entry from
 * pass 1 cannot be told from one added in pass 3.
 *
 * Four things have to hold, and each fails silently — nothing reads the field
 * yet, so a wrong time would sit in the column unnoticed:
 *
 * - a pass's new entries carry **the pass's one time**, the same value the
 *   list's `generatedAt` gets;
 * - an entry the list **already had** is never re-stamped by an append;
 * - nor by a **merge**, whichever name or prose wins — `merge` builds its
 *   result field by field, so the field has to be carried on purpose;
 * - nor by a **rewrite** that hands it its old id; and an entry stored
 *   **before the field existed stays without one** through all three.
 *   Filling the gap would invent a time for something that was already there.
 *
 * docs/plans/261003j-store-when-it-happened-timestamp-audit.md § stage 3.
 */
import { describe, expect, it } from "vitest";
import { buildGlossary, dedupe, idsByTerm, PROMPT_VERSION, renderPrompt } from "../src/glossary.js";
import { CAPABLE_MODEL } from "../src/models.js";
import type { Block, Glossary, GlossaryEntry, Tree } from "../src/types.js";

function block(id: string, text: string): Block {
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html: `<p>${text}</p>`, gistable: true };
}

const BLOCKS: Block[] = [
  block("spya-aaaaaa", "Seth argues that qualia are a controlled hallucination."),
  block("spya-bbbbbb", "A nonreductive explanation is what Lamport would ask for."),
];

const MONDAY = "2026-09-28T09:10:00.000Z";
const TUESDAY = "2026-09-29T14:02:00.000Z";

const opts = { slug: "a-slug", blocks: BLOCKS, sourceHash: "deadbeefdeadbeef", elapsedMs: 10, power: "standard" as const };

function entry(over: Partial<GlossaryEntry> & Pick<GlossaryEntry, "id" | "name">): GlossaryEntry {
  return { kind: "term", aliases: [], background: "Something worth knowing.", blocks: [], ...over };
}

function stored(entries: GlossaryEntry[], over: Partial<Glossary> = {}): Glossary {
  return {
    version: PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    slug: "a-slug",
    sourceHash: "deadbeefdeadbeef",
    profileHash: null,
    entries,
    passes: 1,
    generatedAt: MONDAY,
    elapsedMs: 100,
    ...over,
  };
}

const byName = (g: Glossary, name: string): GlossaryEntry => {
  const found = g.entries.find((e) => e.name === name);
  if (!found) throw new Error(`no entry named ${name}`);
  return found;
};

describe("a first pass", () => {
  it("stamps every entry with the pass's one time, which is also the list's generatedAt", () => {
    const g = buildGlossary(
      { entries: [{ name: "Seth", background: "The author." }, { name: "qualia", background: "Raw feels." }] },
      { ...opts, now: TUESDAY },
    );
    expect(g.generatedAt).toBe(TUESDAY);
    expect(g.entries.map((e) => e.addedAt)).toEqual([TUESDAY, TUESDAY]);
  });

  it("without a time handed in, still shares one clock read with the list", () => {
    const g = buildGlossary(
      { entries: [{ name: "Seth", background: "The author." }, { name: "qualia", background: "Raw feels." }] },
      opts,
    );
    expect(Number.isNaN(Date.parse(g.generatedAt))).toBe(false);
    expect(g.entries.map((e) => e.addedAt)).toEqual([g.generatedAt, g.generatedAt]);
  });

  it("gives two fresh entries that merge into one the pass's time", () => {
    const g = buildGlossary(
      { entries: [{ name: "Seth", background: "The author." }, { name: "seth", background: "Again." }] },
      { ...opts, now: TUESDAY },
    );
    expect(g.entries).toHaveLength(1);
    expect(g.entries[0]?.addedAt).toBe(TUESDAY);
  });
});

describe("Find more terms — an append", () => {
  it("keeps the time an entry already had, and stamps only what it adds", () => {
    const g = buildGlossary(
      { entries: [{ name: "qualia", background: "Raw feels." }] },
      { ...opts, existing: stored([entry({ id: "spya-keep01", name: "Seth", addedAt: MONDAY })]), now: TUESDAY },
    );
    expect(byName(g, "Seth").addedAt).toBe(MONDAY);
    expect(byName(g, "qualia").addedAt).toBe(TUESDAY);
    /* The list's own time moves, which is exactly why the entry needs its own. */
    expect(g.generatedAt).toBe(TUESDAY);
    expect(g.passes).toBe(2);
  });

  it("leaves an entry from before the field existed without one", () => {
    const g = buildGlossary(
      { entries: [{ name: "qualia", background: "Raw feels." }] },
      { ...opts, existing: stored([entry({ id: "spya-keep01", name: "Seth" })]), now: TUESDAY },
    );
    const old = byName(g, "Seth");
    expect(old.id).toBe("spya-keep01");
    expect("addedAt" in old).toBe(false);
    expect(byName(g, "qualia").addedAt).toBe(TUESDAY);
  });

  it("a pass that finds nothing new changes no entry's time", () => {
    const g = buildGlossary(
      { entries: [] },
      {
        ...opts,
        existing: stored([
          entry({ id: "spya-keep01", name: "Seth", addedAt: MONDAY }),
          entry({ id: "spya-keep02", name: "qualia" }),
        ]),
        now: TUESDAY,
      },
    );
    expect(byName(g, "Seth").addedAt).toBe(MONDAY);
    expect("addedAt" in byName(g, "qualia")).toBe(false);
  });
});

describe("a fresh entry that collides with one already there", () => {
  /* The FORBIDDEN list asks the model not to, and it does anyway. */

  it("same name: the incumbent's time survives", () => {
    const g = buildGlossary(
      { entries: [{ name: "seth", background: "Said again." }] },
      { ...opts, existing: stored([entry({ id: "spya-keep01", name: "Seth", addedAt: MONDAY })]), now: TUESDAY },
    );
    expect(g.entries).toHaveLength(1);
    expect(g.entries[0]?.id).toBe("spya-keep01");
    expect(g.entries[0]?.addedAt).toBe(MONDAY);
  });

  it("same name, untimed incumbent: it stays untimed — absence is kept, not filled", () => {
    const g = buildGlossary(
      { entries: [{ name: "seth", background: "Said again." }] },
      { ...opts, existing: stored([entry({ id: "spya-keep01", name: "Seth" })]), now: TUESDAY },
    );
    expect(g.entries).toHaveLength(1);
    expect(g.entries[0]?.id).toBe("spya-keep01");
    expect("addedAt" in g.entries[0]!).toBe(false);
  });

  it("fresh name matches the incumbent's alias: the incumbent's time survives", () => {
    const g = buildGlossary(
      { entries: [{ name: "Lamport", background: "Short form." }] },
      {
        ...opts,
        existing: stored([entry({ id: "spya-keep01", name: "Leslie Lamport", aliases: ["Lamport"], addedAt: MONDAY })]),
        now: TUESDAY,
      },
    );
    expect(g.entries).toHaveLength(1);
    expect(g.entries[0]?.addedAt).toBe(MONDAY);
  });

  it("fresh alias matches the incumbent's name, untimed: stays untimed", () => {
    const g = buildGlossary(
      { entries: [{ name: "Anil Seth", aliases: ["Seth"], background: "The author, in full." }] },
      { ...opts, existing: stored([entry({ id: "spya-keep01", name: "Seth" })]), now: TUESDAY },
    );
    expect(g.entries).toHaveLength(1);
    expect(g.entries[0]?.id).toBe("spya-keep01");
    expect("addedAt" in g.entries[0]!).toBe(false);
  });
});

describe("a richer fresh name that takes the entry over", () => {
  it("wins the name, and the incumbent's id and time survive", () => {
    const g = buildGlossary(
      { entries: [{ name: "nonreductive explanation", aliases: ["nonreductive"], background: "The fuller phrase." }] },
      {
        ...opts,
        existing: stored([entry({ id: "spya-keep01", name: "nonreductive", addedAt: MONDAY })]),
        now: TUESDAY,
      },
    );
    expect(g.entries).toHaveLength(1);
    const merged = g.entries[0]!;
    expect(merged.name).toBe("nonreductive explanation");
    expect(merged.background).toBe("The fuller phrase.");
    expect(merged.id).toBe("spya-keep01");
    expect(merged.addedAt).toBe(MONDAY);
  });

  it("wins the name over an untimed incumbent, which stays untimed", () => {
    const g = buildGlossary(
      { entries: [{ name: "nonreductive explanation", aliases: ["nonreductive"], background: "The fuller phrase." }] },
      { ...opts, existing: stored([entry({ id: "spya-keep01", name: "nonreductive" })]), now: TUESDAY },
    );
    const merged = g.entries[0]!;
    expect(merged.name).toBe("nonreductive explanation");
    expect(merged.id).toBe("spya-keep01");
    expect("addedAt" in merged).toBe(false);
  });

  it("dedupe on its own: the first entry's time, or its absence, is the merged entry's", () => {
    const timed = dedupe([
      entry({ id: "spya-first1", name: "nonreductive", addedAt: MONDAY }),
      entry({ id: "spya-secnd1", name: "nonreductive explanation", aliases: ["nonreductive"], addedAt: TUESDAY }),
    ]);
    expect(timed).toHaveLength(1);
    expect(timed[0]?.addedAt).toBe(MONDAY);

    const untimed = dedupe([
      entry({ id: "spya-first1", name: "nonreductive" }),
      entry({ id: "spya-secnd1", name: "nonreductive explanation", aliases: ["nonreductive"], addedAt: TUESDAY }),
    ]);
    expect(untimed).toHaveLength(1);
    expect("addedAt" in untimed[0]!).toBe(false);
  });
});

describe("a rewrite that inherits an id", () => {
  /* A prompt bump or a profile change: `existingFor` refuses to append, and
     `idsByTerm` lends the old ids. The prose is new; the entry is not. */

  it("inherits the time with it: added on Monday is still added on Monday", () => {
    const before = stored([entry({ id: "spya-oldold", name: "Seth", addedAt: MONDAY })], { version: "glossary/1" });
    const g = buildGlossary(
      { entries: [{ name: "Seth", background: "Rewritten." }, { name: "qualia", background: "Raw feels." }] },
      { ...opts, existing: null, inherit: idsByTerm(before), now: TUESDAY },
    );
    const kept = byName(g, "Seth");
    expect(kept.id).toBe("spya-oldold");
    expect(kept.background).toBe("Rewritten.");
    expect(kept.addedAt).toBe(MONDAY);
    /* A term the old list did not have is this run's. */
    expect(byName(g, "qualia").addedAt).toBe(TUESDAY);
  });

  it("inherits the absence too: an untimed entry is not given the rewrite's time", () => {
    const before = stored([entry({ id: "spya-oldold", name: "Seth" })], { profileHash: "0123456789abcdef" });
    const g = buildGlossary(
      { entries: [{ name: "Seth", background: "Rewritten." }, { name: "qualia", background: "Raw feels." }] },
      { ...opts, existing: null, inherit: idsByTerm(before), now: TUESDAY },
    );
    const kept = byName(g, "Seth");
    expect(kept.id).toBe("spya-oldold");
    expect("addedAt" in kept).toBe(false);
    expect(byName(g, "qualia").addedAt).toBe(TUESDAY);
  });

  it("inherits by alias, with the time of the entry that owned the alias", () => {
    const before = stored([
      entry({ id: "spya-oldold", name: "Leslie Lamport", aliases: ["Lamport"], addedAt: MONDAY }),
    ]);
    const g = buildGlossary(
      { entries: [{ name: "Lamport", background: "Rewritten." }] },
      { ...opts, existing: null, inherit: idsByTerm(before), now: TUESDAY },
    );
    expect(g.entries[0]?.id).toBe("spya-oldold");
    expect(g.entries[0]?.addedAt).toBe(MONDAY);
  });

  it("when two fresh entries want one old id, only the one that gets it gets its time", () => {
    const before = stored([
      entry({ id: "spya-oldold", name: "Leslie Lamport", aliases: ["Lamport"], addedAt: MONDAY }),
    ]);
    const g = buildGlossary(
      {
        entries: [
          { name: "Lamport", background: "First claimant, by alias." },
          { name: "Leslie Lamport Award", aliases: ["Leslie Lamport"], background: "A second thing." },
        ],
      },
      { ...opts, existing: null, inherit: idsByTerm(before), now: TUESDAY },
    );
    expect(g.entries).toHaveLength(2);
    const times = Object.fromEntries(g.entries.map((e) => [e.id === "spya-oldold" ? "old" : "new", e.addedAt]));
    expect(times).toEqual({ old: MONDAY, new: TUESDAY });
  });

  /* GPT Sol's code review, F8. Inheritance used to run before the fresh entries
     were merged with each other, so an earlier fresh entry could absorb the
     later one that had just been handed the old id — and the old id and its
     time went with the loser. */
  for (const [label, addedAt] of [
    ["timed", MONDAY],
    ["untimed", undefined],
  ] as const) {
    it(`two fresh entries that merge into one still inherit the old id (${label} incumbent)`, () => {
      const before = stored([
        entry({ id: "spya-oldold", name: "Seth", ...(addedAt === undefined ? {} : { addedAt }) }),
      ]);
      const g = buildGlossary(
        {
          entries: [
            { name: "Anil Seth", background: "Full name." },
            { name: "Seth", aliases: ["Anil Seth"], background: "Same person." },
          ],
        },
        { ...opts, existing: null, inherit: idsByTerm(before), now: TUESDAY },
      );
      expect(g.entries).toHaveLength(1);
      expect(g.entries[0]?.id).toBe("spya-oldold");
      expect(g.entries[0]?.addedAt).toBe(addedAt);
    });
  }
});

describe("the field stays out of the prompt", () => {
  it("renderPrompt's ALREADY list is names and aliases, with no time in it", () => {
    const tree = {
      version: "toc/test",
      generator: "test",
      slug: "a-slug",
      rootId: "root",
      nodes: {
        root: {
          id: "root",
          depth: 0,
          parent: null,
          children: [],
          title: "root",
          gist: "the gist",
          range: ["spya-aaaaaa", "spya-bbbbbb"],
        },
      },
    } as unknown as Tree;
    const prompt = renderPrompt({
      tree,
      count: 6,
      existing: [entry({ id: "spya-keep01", name: "Seth", aliases: ["Anil Seth"], addedAt: MONDAY })],
      profile: null,
    });
    expect(prompt).toContain("- Seth / Anil Seth");
    expect(prompt).not.toContain(MONDAY);
    expect(prompt).not.toContain("addedAt");
  });
});
