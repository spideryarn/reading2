/**
 * Stage 3a-i — `role`, `treatment` and `noteId` on a `Block`, and every place
 * that has to carry them. docs/plans/footnotes.md § The representation.
 *
 * **Nothing here changes behaviour.** The fields are assigned, persisted and
 * projected; no predicate reads them yet. So what these tests are for is the one
 * thing that can go wrong silently: a field that is assigned in one place and
 * quietly dropped in another, over a corpus where the correct answer looks a lot
 * like doing nothing.
 *
 * ## Three numbers, and conflating any two of them is the bug
 *
 * A note is a **range** of blocks, so *how many notes there are*, *how many
 * blocks carry a role*, and *how many markers cite them* are three different
 * numbers. Gwern has 34 notes across 41 supplement blocks — one of its notes
 * contains a list, and `ownContent` deliberately splits a parent block away from
 * nested list content, so that note is eight blocks. Every fixture row below
 * therefore asserts the distinct-`noteId` count **and** the supplement-block
 * count separately.
 *
 * The classification rule is an **ancestor lookup**, and this is the measurement
 * that forced it: gwern's notes container holds 118 block-level elements while
 * only 34 carry `data-spya-note`. Classifying the stamped elements alone would
 * have left the rest of the footnote prose as argument — summarised, embedded
 * and on the clock — with all four counts still looking plausible.
 *
 * ## The controls are half the file
 *
 * `ar5iv`, `gutenberg` and `constitution` must come out with **zero** blocks
 * carrying any of the three fields. A classifier that returns "supplement" for
 * everything passes every assertion in the first half of this file and fails
 * here, which is the only reason the first half means anything.
 *
 * ## Why the real pipeline and not invented HTML
 *
 * `runExtract` — jsdom, stage 2, Readability, the sanitiser — and then
 * `splitIntoBlocks`, over the committed fixtures. A test written against
 * hand-made post-Readability HTML would stay green if Readability started
 * throwing the notes container away, which is the failure this whole feature is
 * most exposed to. tests/notes-canonical.test.ts makes the same argument at
 * length and this file borrows its harness.
 *
 * ## The five roles, none of which the corpus produces
 *
 * v1 assigns only `"footnote"`. The other four exist in the union, in the CHECK
 * constraint and here — so the tests below drive all five through the
 * filesystem artefact store, the import validator and the public DTO by hand,
 * because the corpus cannot.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { blocksArtefact, splitIntoBlocks } from "../src/blocks.js";
import { runExtract } from "../src/extract.js";
import { NOTE_ID_PATTERN } from "../src/notes.js";
import { publicArticle } from "../src/public/dto.js";
import { createFsArtifactStore } from "../src/store/artifacts-fs.js";
import { checkNoteFields } from "../src/store/import.js";
import type { Block, Tree } from "../src/types.js";

const FIXTURES = path.join(import.meta.dirname, "..", "evals", "extraction", "fixtures");
/** Real extractions of large pages. `gutenberg.html` alone is 852 KB. */
const SLOW = 180_000;

interface Run {
  blocks: Block[];
  /** Distinct notes stage 2 recognised, for comparison against the block counts. */
  notes: number;
}

/** One extraction per fixture for the whole file. */
const runs = new Map<string, Promise<Run>>();

function pipeline(fixture: string): Promise<Run> {
  const existing = runs.get(fixture);
  if (existing) return existing;
  const started = (async (): Promise<Run> => {
    const html = await readFile(path.join(FIXTURES, `${fixture}.html`), "utf-8");
    const dir = await mkdtemp(path.join(tmpdir(), "block-roles-"));
    try {
      const outFile = path.join(dir, `${fixture}.html`);
      const extract = await runExtract({
        html,
        url: `https://example.test/${fixture}`,
        outFile,
        dataDir: dir,
      });
      const split = splitIntoBlocks(await readFile(outFile, "utf-8"));
      return { blocks: split.blocks, notes: extract.notes.notes };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  })();
  runs.set(fixture, started);
  return started;
}

const supplementsIn = (blocks: Block[]): Block[] =>
  blocks.filter((b) => b.treatment === "supplement");

/** Any of the three fields present, which is what a control must have none of. */
const classified = (blocks: Block[]): Block[] =>
  blocks.filter((b) => b.role !== undefined || b.treatment !== undefined || b.noteId !== undefined);

/* -------------------------------------------------------------------------- */
/* 1. The four real fixtures                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Measured 2026-08-28 by running this pipeline, not copied from the plan.
 *
 * `total` is two higher than docs/plans/footnotes.md § Stage 3's input records
 * for each of the four, and the two are the notes container stage 2 appends —
 * the `<section>` and its `<ol>`, which the plan's own stage-2 section counts as
 * "2 minted blocks per article". The plan's table was measured before those
 * existed. The supplement counts are unchanged.
 */
const FIXTURE_TABLE = [
  { fixture: "gwern", notes: 34, supplement: 41, total: 186 },
  { fixture: "wiki_transformer", notes: 121, supplement: 121, total: 358 },
  { fixture: "acx_footnotes", notes: 18, supplement: 18, total: 98 },
  { fixture: "tufte", notes: 5, supplement: 5, total: 70 },
] as const;

/**
 * A sentence from one note in each fixture — because a count is exactly the
 * evidence that failed here before. `stats.retargeted` reported 36 of 36 on a
 * Substack post where half the links landed on a block whose whole text was a
 * digit, so each row below is a claim about the article's *words*: this
 * sentence is apparatus, and it is apparatus because it belongs to a note.
 */
const NOTE_PROSE = [
  {
    fixture: "gwern",
    words: "the arithmetic benchmark appears to greatly understate GPT-3",
  },
  {
    fixture: "wiki_transformer",
    words: "Gated recurrent units (2014) further reduced its complexity.",
  },
  {
    fixture: "acx_footnotes",
    words: "Many footnotes spawn their own footnotes",
  },
  {
    fixture: "tufte",
    words: "See Tufte’s comment in the Tufte book fonts thread.",
  },
] as const;

describe("the four footnote fixtures", () => {
  beforeAll(async () => {
    await Promise.all(FIXTURE_TABLE.map((row) => pipeline(row.fixture)));
  }, SLOW);

  for (const row of FIXTURE_TABLE) {
    describe(row.fixture, () => {
      it("has as many distinct noteIds as stage 2 found notes", async () => {
        const { blocks, notes } = await pipeline(row.fixture);
        const ids = new Set(supplementsIn(blocks).map((b) => b.noteId));
        expect(notes).toBe(row.notes);
        expect(ids.size).toBe(row.notes);
        // Not one of them absent: a supplement block with no note is a block
        // this stage found and could not place.
        expect(ids.has(undefined)).toBe(false);
      });

      it("classifies the whole notes range, not just the stamped elements", async () => {
        const { blocks } = await pipeline(row.fixture);
        expect(supplementsIn(blocks).length).toBe(row.supplement);
        expect(blocks.length).toBe(row.total);
      });

      it("gives every supplement block the same role and treatment", async () => {
        const { blocks } = await pipeline(row.fixture);
        for (const b of supplementsIn(blocks)) {
          expect(b.role).toBe("footnote");
          expect(b.noteId).toMatch(NOTE_ID_PATTERN);
        }
        // And nothing outside the notes carries a role, which is the other half:
        // "every note block is apparatus" is satisfied by marking everything.
        expect(classified(blocks).length).toBe(row.supplement);
      });
    });
  }

  for (const { fixture, words } of NOTE_PROSE) {
    it(`${fixture}: the note that says "${words.slice(0, 40)}…" is apparatus`, async () => {
      const { blocks } = await pipeline(fixture);
      const found = blocks.filter((b) => b.text.includes(words));
      expect(found.length).toBe(1);
      expect(found[0]!.treatment).toBe("supplement");
      expect(found[0]!.role).toBe("footnote");
      expect(found[0]!.noteId).toMatch(NOTE_ID_PATTERN);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* 2. The controls                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Three pages with no footnote our four adapters recognise, and three different
 * reasons for it: `ar5iv` writes real LaTeXML footnotes inline with no id/href
 * pair, which is a shape stage 2 deliberately does not support; `gutenberg`'s
 * three `<sup>` are the abbreviation mark in "Mr."; `constitution` has none at
 * all. All three report a healthy `stats.retargeted` from ordinary
 * cross-references, so "links were rewritten" is not evidence of anything.
 */
const CONTROLS = ["ar5iv", "gutenberg", "constitution"] as const;

describe("the controls stay at zero", () => {
  beforeAll(async () => {
    await Promise.all(CONTROLS.map((f) => pipeline(f)));
  }, SLOW);

  for (const fixture of CONTROLS) {
    it(`${fixture} has no block carrying any of the three fields`, async () => {
      const { blocks, notes } = await pipeline(fixture);
      expect(notes).toBe(0);
      // A real extraction, so "zero" is about the classifier and not about an
      // empty array — the failure mode this whole file is written against.
      expect(blocks.length).toBeGreaterThan(100);
      expect(classified(blocks)).toEqual([]);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* 3. A note is a range                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Gwern's note on hardware overhangs — *"Further, NNs have additional hardware
 * overhangs of their own…"* — is one note and **eight blocks**, because it holds
 * a seven-item list and `ownContent` (src/blocks.ts) removes nested list content
 * when it builds the parent's block.
 *
 * This is the only multi-block note in the four fixtures: the other 33 gwern
 * notes, and all of wikipedia's, Substack's and Tufte's, are one block each.
 * That is why 34 notes give 41 supplement blocks.
 */
const MULTI_BLOCK_NOTE = "Further, NNs have additional hardware overhangs of their own";

describe("a note is a range of blocks", () => {
  it("gives all eight blocks of gwern's hardware-overhang note one noteId", async () => {
    const { blocks } = await pipeline("gwern");
    const first = blocks.find((b) => b.text.startsWith(MULTI_BLOCK_NOTE));
    expect(first).toBeDefined();
    const noteId = first!.noteId;
    expect(noteId).toMatch(NOTE_ID_PATTERN);

    const range = blocks.filter((b) => b.noteId === noteId);
    expect(range.length).toBe(8);
    for (const b of range) {
      expect(b.role).toBe("footnote");
      expect(b.treatment).toBe("supplement");
    }
    /* Contiguous, because a range that is not contiguous is not a range — and
       stage 4's supplement node will need it to be. */
    const positions = range.map((b) => blocks.indexOf(b));
    expect(positions).toEqual(positions.map((_, i) => positions[0]! + i));
  }, SLOW);

  it("counts notes and note blocks as different numbers", async () => {
    const { blocks, notes } = await pipeline("gwern");
    // The conflation this field exists to prevent, written out.
    expect(notes).toBe(34);
    expect(supplementsIn(blocks).length).toBe(41);
  }, SLOW);
});

/* -------------------------------------------------------------------------- */
/* 4. A forged stamp                                                           */
/* -------------------------------------------------------------------------- */

/**
 * These attributes are ours, which makes them forgeable — and a page that could
 * get one past us would have arbitrary body prose dressed as trusted apparatus,
 * or (once stage 4 lands) hidden from every summary the reader pays for.
 *
 * **Stage 3 cannot tell one of ours from a page's, and does not try.** The
 * defence is `scrubReserved` at stage 2, which takes every copy off the arriving
 * document *before* a single one of ours is written, and runs unconditionally —
 * before the "no candidates" early return, which is the case below. So what this
 * asserts is the property stage 3 depends on: a page that stamps itself gets no
 * role, and the stamps are not in the stored HTML either.
 */
const FORGED = `<!doctype html><html><head><title>A forgery</title></head><body><article>
  <h1>An ordinary article that has read our source code</h1>
  <section data-spya-notes="">
    <p data-spya-note="spya-note-0123456789">This is ordinary body prose, and the whole
       argument of the piece is in it. It runs on for long enough that Readability keeps
       it, and it claims to be a footnote so that nothing will ever summarise it.</p>
  </section>
  <p data-spya-note="spya-note-abcdef0123">A second paragraph, also claiming to be
     apparatus, also carrying the argument, and also long enough to survive extraction
     by an algorithm that scores paragraphs on how much text they hold.</p>
  <p>A third paragraph, making no claims at all, so that the article has a control
     inside itself and the test is not comparing an empty set with an empty set.</p>
</article></body></html>`;

describe("a forged stamp", () => {
  it("does not become a role", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "block-roles-forged-"));
    try {
      const outFile = path.join(dir, "forged.html");
      const extract = await runExtract({
        html: FORGED,
        url: "https://example.test/forged",
        outFile,
        dataDir: dir,
      });
      const stored = await readFile(outFile, "utf-8");
      const { blocks } = splitIntoBlocks(stored);

      expect(extract.notes.notes).toBe(0);
      expect(blocks.length).toBeGreaterThan(2);
      expect(classified(blocks)).toEqual([]);
      // And the attributes themselves are gone, not merely ignored: anything
      // downstream that learns to read them inherits the same answer.
      expect(stored).not.toContain("data-spya-note");
      expect(stored).not.toContain("data-spya-notes");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SLOW);
});

/* -------------------------------------------------------------------------- */
/* 5. All five roles, which the corpus never produces                          */
/* -------------------------------------------------------------------------- */

const ROLES = ["footnote", "reference", "acknowledgment", "credit", "appendix"] as const;

/** One block per role, plus a body block, plus a supplement with no role. */
const SYNTHETIC: Block[] = [
  {
    id: "spya-body01",
    tag: "p",
    kind: "text",
    text: "The argument itself, carrying no role at all.",
    words: 8,
    html: `<p id="spya-body01">The argument itself, carrying no role at all.</p>`,
    gistable: true,
  },
  ...ROLES.map(
    (role, i): Block => ({
      id: `spya-role0${i}`,
      tag: "p",
      kind: "text",
      text: `A block whose role is ${role}.`,
      words: 6,
      html: `<p id="spya-role0${i}">A block whose role is ${role}.</p>`,
      gistable: true,
      role,
      /* An appendix may be real prose worth gisting, so it is deliberately
         `role` without `treatment` — the case one closed set could not express
         and the reason there are two axes. */
      ...(role === "appendix" ? {} : { treatment: "supplement" as const }),
      noteId: `spya-note-000000000${i}`,
    }),
  ),
];

describe("all five roles", () => {
  it("survives the filesystem artefact store, field for field", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "block-roles-fs-"));
    try {
      const at = {
        dir: path.join(root, "data", "roles"),
        htmlFile: path.join(root, "output", "roles.html"),
      };
      const { mkdir } = await import("node:fs/promises");
      await mkdir(at.dir, { recursive: true });
      await mkdir(path.dirname(at.htmlFile), { recursive: true });

      const store = createFsArtifactStore(() => at);
      const artefact = blocksArtefact(SYNTHETIC);
      await store.write("roles", "toc", { blocks: artefact }, {});

      const read = await store.read("roles", "toc", "blocks");
      expect(read).toEqual(artefact);
      // Named rather than left to `toEqual`, because a store that dropped all
      // three would still match an expectation built from the same objects if
      // the round trip were ever short-circuited.
      const back = (read as { blocks: Block[] }).blocks;
      expect(back.map((b) => b.role)).toEqual([undefined, ...ROLES]);
      expect(back.map((b) => b.treatment)).toEqual([
        undefined,
        "supplement",
        "supplement",
        "supplement",
        "supplement",
        undefined,
      ]);
      expect(back.filter((b) => b.noteId !== undefined).length).toBe(ROLES.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes the import validator, and a sixth role does not", () => {
    expect(() => checkNoteFields("roles", SYNTHETIC)).not.toThrow();

    const bad = [{ ...SYNTHETIC[1]!, role: "bibliography" as NonNullable<Block["role"]> }];
    expect(() => checkNoteFields("roles", bad)).toThrow(/unrecognised role "bibliography"/);

    const worse = [{ ...SYNTHETIC[1]!, treatment: "hidden" as NonNullable<Block["treatment"]> }];
    expect(() => checkNoteFields("roles", worse)).toThrow(/unrecognised treatment "hidden"/);

    const wrongType = [{ ...SYNTHETIC[1]!, noteId: 7 as unknown as string }];
    expect(() => checkNoteFields("roles", wrongType)).toThrow(/noteId that is not a string/);
  });

  /**
   * **Each field being legal is not the same as the block being coherent.**
   *
   * GPT Sol's review of stage 3: the validator checked the three fields in
   * isolation, so the failure it exists to prevent walked in through the door
   * that left open. Both shapes below pass every single-field check.
   */
  it("refuses a footnote that is not marked as apparatus", () => {
    /* `role: "footnote"` with no treatment. `isBody` reads an absent treatment
       as body, so this block declares itself apparatus in the one column
       nothing reads, and is summarised, embedded, labelled and put on the clock
       as argument — silent reclassification arriving as a well-formed import. */
    const { treatment: _dropped, ...orphan } = SYNTHETIC[1]!;
    expect(orphan.role).toBe("footnote");
    expect(() => checkNoteFields("roles", [orphan])).toThrow(/is a footnote with treatment/);
  });

  it("still allows an appendix without one, which is why there are two axes", () => {
    /* The control for the rule above, and the reason it is stated for
       `"footnote"` alone rather than for every role: an appendix may be real
       prose worth gisting. A rule that read "any role implies supplement" would
       pass the test above and delete the distinction the two axes exist for. */
    const appendix = SYNTHETIC.find((b) => b.role === "appendix")!;
    expect(appendix.treatment).toBeUndefined();
    expect(() => checkNoteFields("roles", [appendix])).not.toThrow();
  });

  it("refuses a noteId stage 2 could not have minted", () => {
    /* Stage 2 mints ten hex digits and stage 3 refuses anything else
       (`noteFieldsFor` gates on `NOTE_ID_PATTERN`), so a value in any other
       shape did not come from this pipeline. Stage 5 resolves a marker to its
       note by this id: an arbitrary string is a hover card resolving to
       nothing, or to the wrong note. */
    for (const bad of ["note-1", "spya-note-zzzzzzzzzz", "spya-note-00ab12cd3", ""]) {
      const forged = [{ ...SYNTHETIC[1]!, noteId: bad }];
      /* The exact message, not an alternation loose enough to also match "not
         a string" — a test that accepts either error is not testing which one
         fired. */
      expect(() => checkNoteFields("roles", forged)).toThrow(/could not have minted/);
    }
  });

  it("refuses a footnote with no noteId, which stage 5 could never open", () => {
    /* Stored but unreachable: removed from the argument by `treatment`, and
       absent from `noteIndex` (src/web/notes-view.ts) because that keys on a
       non-empty `noteId`. The marker would open nothing at all. Stage 3
       deferred a `noteId` rule in the *other* direction; this is the one stage
       5a made load-bearing. GPT Sol's review of stage 4. */
    const { noteId: _dropped, ...mute } = SYNTHETIC[1]!;
    expect(mute.role).toBe("footnote");
    expect(mute.treatment).toBe("supplement");
    expect(() => checkNoteFields("roles", [mute])).toThrow(/footnote with no noteId/);
  });

  it("still allows an appendix with no noteId, which is why the rule names one role", () => {
    /* The control. A rule written as "any supplement needs a noteId" would pass
       the test above and refuse an appendix, which is prose rather than a note
       and has nothing to be a member of. */
    const appendix = SYNTHETIC.find((b) => b.role === "appendix")!;
    const { noteId: _also, ...bare } = appendix;
    expect(() => checkNoteFields("roles", [bare])).not.toThrow();
  });

  it("accepts the two shapes stage 2 really mints", () => {
    /* The control: `NOTE_ID_PATTERN` allows an optional `-<n>` suffix, and a
       validator that rejected it would refuse an ordinary Wikipedia article
       whose one note is cited thirteen times. */
    for (const good of ["spya-note-00ab12cd34", "spya-note-00ab12cd34-2"]) {
      expect(NOTE_ID_PATTERN.test(good)).toBe(true);
      const block = [{ ...SYNTHETIC[1]!, noteId: good }];
      expect(() => checkNoteFields("roles", block)).not.toThrow();
    }
  });

  it("reaches a visitor through the public DTO", () => {
    const tree: Tree = {
      version: "1",
      generator: "test",
      slug: "roles",
      rootId: "n0",
      nodes: {
        n0: {
          id: "n0",
          depth: 0,
          parent: null,
          children: [],
          range: [SYNTHETIC[0]!.id, SYNTHETIC.at(-1)!.id],
          title: "The whole piece",
          gist: "One sentence.",
        },
      },
    };
    const built = publicArticle({
      slug: "roles",
      title: "Roles",
      byline: null,
      siteName: null,
      lang: null,
      excerpt: null,
      headingTitle: "Roles",
      finalUrl: null,
      blocks: SYNTHETIC,
      tree,
      arc: null,
      assets: null,
      /* The four artefacts a synthetic article has never generated. Spelled out
         as `null` rather than omitted because `publicArticle` distinguishes
         present from absent by `!== null`, so an omitted key would take the
         present branch and hand `publicGlossary` an undefined. */
      glossary: null,
      summary: null,
      ideas: null,
      quotes: null,
      tweets: null,
    });
    expect(built.blocks.map((b) => b.role)).toEqual([undefined, ...ROLES]);
    expect(built.blocks.filter((b) => b.treatment === "supplement").length).toBe(4);
    expect(built.blocks.filter((b) => b.noteId !== undefined).length).toBe(ROLES.length);
  });
});
