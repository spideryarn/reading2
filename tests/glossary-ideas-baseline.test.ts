/**
 * **Stages 5d and 5f get their previous artefact from the store, not from a
 * path** — and the four states they have to tell apart.
 *
 * This is the sibling of tests/blocks-baseline.test.ts, for the other two of the
 * three stages docs/plans/260827aa-delete-the-importer.md § *Three stages carry identity
 * in a file* names. The glossary reads `glossary.json` to decide whether to
 * **append** to the list and to **inherit** its entry ids; `ideas` reads
 * `ideas.json` for ids alone. Landing D takes the files away, and after it both
 * reads fail on every run while looking exactly like a first pass: "find more
 * terms" silently becomes "replace the glossary", `passes` resets to 1, and
 * every `?term=` and `?idea=` link a reader holds stops naming anything. Nothing
 * throws.
 *
 * ## Four states, not three
 *
 * Stage 3 wants its baseline unconditionally, so absent-and-there-was-history is
 * the only refusal it needs. These two are gated on a `sourceHash` match, and a
 * mismatch is a **correct** reason not to inherit — the text moved, so the old
 * ids describe paragraphs that are gone. So:
 *
 * | | what it means | what happens |
 * |---|---|---|
 * | no previous artefact | a first run | mint, quietly |
 * | one whose `sourceHash` differs | the text moved | mint, quietly |
 * | one the store cannot read | we cannot tell which of those two it was | **fail** |
 * | the store read throws | an infrastructure fault | **propagate** |
 *
 * Confusing the third with either of the first two is the bug a review found in
 * the blocks version of this on 2026-08-28, arriving through a different door.
 *
 * ## Each of these was watched failing, and against what
 *
 * A check that has never been red is not evidence
 * (docs/reusable/silent-success.md), and every mutation below was applied to the
 * real source, run, and reverted.
 *
 * | mutation | what fails |
 * |---|---|
 * | `previousGlossaryFrom` returns `null` instead of reading | *keeps every entry id across a re-run*, *appends to the list a second time* (both stores) |
 * | `previousIdeasFrom` returns `null` instead of reading | *keeps every idea id across a re-run* (both stores) |
 * | either one flattens `unusable` to `null` | *refuses when the previous … is there and cannot be read* |
 * | either one throws on `absent` as well | *mints quietly on a first run*, and *…when the text has moved* |
 * | `generateGlossary` ignores `opts.previous` for `existingFor` only | *appends to the list a second time* — and **nothing else**, which is the whole reason that test exists |
 *
 * That last row is the point of the append half. A change that preserved every
 * id and quietly turned "find more terms" into "replace the glossary" passes
 * every id assertion in this file.
 *
 * ## The model is stubbed; the stages are not
 *
 * `streamMessage` is replaced by one that answers from a script, so the real
 * `generateGlossary` and `generateIdeas` run end to end over a real article —
 * which is the only way `previous` reaching `existingFor` **and** `idsByTerm`
 * gets exercised. The scripted answers are plain data, not promises resolved by
 * the test at a convenient moment.
 *
 * ## The first half is a store, not a filesystem, since 2026-09-05
 *
 * It ran over `createFsArtifactStore` until the filesystem store was deleted
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § G), and its subject was never files. The section's own header says what
 * changed, which of the four states each mechanism now stands for, and the one
 * case that keeps a file on disk on purpose.
 *
 * ## The Postgres half needs a database and says so out loud
 *
 * Same probe and same `process.stderr.write` as tests/blocks-baseline.test.ts,
 * and for the reason written there at length: vitest's default reporter
 * swallows `console.warn` from anything that is not failing, so a suite that
 * skipped in silence reads exactly like one that passed.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

import type { Block, Glossary, Ideas, OwnerId } from "../src/types.js";
import type { ArtifactStore } from "../src/store/artifacts.js";
import type { JobDraftRef } from "../src/store/artifacts-pg.js";
import type { Db } from "../src/db/client.js";
import { type MemoryArtifactStore, memoryArtefacts } from "./helpers/memory-artefacts.js";
import { mintId } from "../src/ids.js";
import { pgReady } from "./helpers/pg-ready.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import { mintAttempt } from "../src/store/jobs.js";
import { type AstNode, parseSource, walkAst } from "./helpers/ts-ast.js";

/* ------------------------------------------------------- the stubbed model -- */

/**
 * What the next call will answer, in order. A stage that calls once takes one.
 *
 * An array rather than a function per test, because the two halves of the
 * glossary's append behaviour are two *consecutive* calls whose answers must
 * differ — a single canned reply cannot tell "appended" from "returned the same
 * thing twice".
 */
const answers: string[] = [];
/** Every request that went out, so a test can prove the call really happened. */
const calls: unknown[] = [];

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: (_task: string, body: unknown) => {
      calls.push(body);
      const text = answers.shift();
      if (text === undefined) throw new Error("the stub ran out of scripted answers");
      /* A whole message, built here and now. Nothing about it is decided by
         when the test awaits it — an answer that arrives out of a closure the
         test can still change is a mock that manufactures its own green. */
      const message = {
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: "stub",
        content: [{ type: "text", text, citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return {
        onText: () => undefined,
        aborted: () => false,
        finalMessage: () => Promise.resolve(message),
      };
    },
  };
});

/* --------------------------------------------------------------- the article -- */

const ROOT = path.resolve(import.meta.dirname, "..");

/** The fixture article, copied so a stage writing into it cannot touch `example/`. */
async function anArticle(prefix: string): Promise<{ root: string; dir: string; blocks: Block[] }> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const dir = path.join(root, "data");
  await cp(path.join(ROOT, "example"), dir, { recursive: true });
  const { blocks } = JSON.parse(await readFile(path.join(dir, "blocks.json"), "utf-8")) as {
    blocks: Block[];
  };
  return { root, dir, blocks };
}

/**
 * The three files a stage is handed instead of a path —
 * tests/helpers/article-from-dir.ts.
 *
 * Imported here rather than at the top because everything else in this file
 * that touches `src/` is, and the reason is `vi.mock` above: one import style
 * throughout is one fewer thing to reason about when a stub does not take.
 */
const articleIn = async (dir: string) =>
  (await import("./helpers/article-from-dir.js")).readArticleFromDir(dir);

/**
 * A glossary answer naming these terms.
 *
 * `senseHere` on every entry because `toEntries` drops an entry with a name and
 * no prose at all, and that would silently shrink the list this file counts.
 */
function glossaryAnswer(...names: string[]): string {
  return JSON.stringify({
    entries: names.map((name) => ({
      name,
      kind: "other",
      aliases: [],
      senseHere: `What ${name} means in this piece.`,
    })),
  });
}

/**
 * An ideas answer, anchored to a real block so `validateOccurrences` keeps it.
 *
 * `provenance: "introduced"`, because an *assumed* idea must also say what fails
 * without it and per-occurrence reasoning — real rules, and not what this file
 * is about. The quote is a slice of the block's own text, so `findQuote` finds
 * it for the same reason the browser will.
 */
function ideasAnswer(block: Block, ...names: string[]): string {
  const quote = block.text.split(/\s+/).slice(0, 6).join(" ");
  return JSON.stringify({
    ideas: names.map((name) => ({
      name,
      provenance: "introduced",
      statement: `${name}, stated as a claim you could carry elsewhere.`,
      occurrences: [{ blockId: block.id, quote }],
    })),
  });
}

/** The first block with enough words in it to quote. */
const quotable = (blocks: Block[]): Block => {
  const found = blocks.find((b) => b.text.split(/\s+/).length > 8);
  if (!found) throw new Error("the fixture has no block long enough to quote");
  return found;
};

const idOf = (g: Glossary, name: string): string | undefined =>
  g.entries.find((e) => e.name === name)?.id;

/* ------------------------------------------- what a baseline has to carry -- */

/**
 * **Every way a baseline can be there and still be no use, derived from the
 * decision rather than from the validator.**
 *
 * The first version of this file had two "wrong shape" cases and they only
 * asked whether `entries` / `ideas` was an array — which is
 * `SHAPE.glossary`'s own question, written out a second time. A test derived
 * from the implementation tests that the implementation is itself, and this one
 * stayed green over a silent-data-loss path for exactly that reason. GPT Sol,
 * 2026-08-28.
 *
 * So this table is derived from **what the code has to read in order to
 * decide**, and there are only two such things:
 *
 * - *is this artefact stale?* is `onDisk.sourceHash === sourceHash`. Without a
 *   comparable hash that question has no answer — and the answer it gets
 *   instead is `false`, which is indistinguishable from a genuine mismatch and
 *   sends the stage down the mint-everything path reporting success.
 * - *whose id does this entry inherit?* is `idsByTerm` / `idsByName`, which
 *   need an id that is there, an id no other entry claims, and a name to be
 *   looked up by.
 *
 * Each row is a way one of those two is unanswerable. Nothing about prose,
 * aliases, occurrences or scores is here, because none of them is read by
 * either decision and a stage that refused over a missing `background` would be
 * refusing over something it is about to rewrite.
 */
interface Breakage {
  why: string;
  apply: (artefact: Record<string, unknown>, items: string) => unknown;
}

/** Everything but one field — the honest way to say "this key is absent". */
function without(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

/** Replace the nth item, so a row can break one entry and leave the rest good. */
function withItem(
  a: Record<string, unknown>,
  items: string,
  i: number,
  make: (item: Record<string, unknown>) => unknown,
): unknown {
  const list = [...(a[items] as Record<string, unknown>[])];
  list[i] = make(list[i] as Record<string, unknown>) as Record<string, unknown>;
  return { ...a, [items]: list };
}

const BREAKAGES: Breakage[] = [
  /* The hash: five ways the staleness comparison cannot be made. The first
     three are what a partial write, an older writer, or a hand-edit leaves. */
  { why: "no sourceHash at all", apply: (a) => without(a, "sourceHash") },
  { why: "a null sourceHash", apply: (a) => ({ ...a, sourceHash: null }) },
  { why: "a sourceHash that is a number", apply: (a) => ({ ...a, sourceHash: 12345 }) },
  { why: "an empty sourceHash", apply: (a) => ({ ...a, sourceHash: "" }) },
  {
    /* `"  " === "abc"` is false, exactly as a stale hash is false. A hash never
       contains whitespace, so this one has been truncated or edited. */
    why: "a sourceHash that is only whitespace",
    apply: (a) => ({ ...a, sourceHash: "   " }),
  },

  /* Identity: four ways an id cannot be carried forward. */
  {
    why: "an entry with no id",
    apply: (a, items) => withItem(a, items, 0, (e) => without(e, "id")),
  },
  {
    why: "an entry with an empty id",
    apply: (a, items) => withItem(a, items, 0, (e) => ({ ...e, id: "" })),
  },
  {
    /* The quiet one. Both matchers are first-writer-wins, so the second holder
       of a repeated id silently loses it — and every link that meant the second
       now resolves to the first. Landing on the wrong entry is worse than
       landing on nothing. */
    why: "two entries sharing one id",
    apply: (a, items) => {
      const list = a[items] as Record<string, unknown>[];
      return withItem(a, items, 1, (e) => ({ ...e, id: list[0]!.id }));
    },
  },
  {
    /* An id with no key cannot be looked up, and `normaliseTerm(undefined)`
       throws from inside the matcher — loud, but a `TypeError` rather than a
       sentence saying which file to restore. */
    why: "an entry with no name to be matched by",
    apply: (a, items) => withItem(a, items, 0, (e) => without(e, "name")),
  },
  {
    why: "a null where an entry should be",
    apply: (a, items) => ({ ...a, [items]: [null, ...(a[items] as unknown[])] }),
  },
];

/** The row every "it refuses" table needs, or refusal is a fact about the harness. */
const CONTROL = { why: "the artefact exactly as the stage wrote it", apply: (a: unknown) => a };

/**
 * What a baseline read did, **named** — and the naming is the whole of it.
 *
 * `.rejects` alone would let a row pass on a `TypeError` thrown from inside the
 * classifier, which is not a refusal: it is a crash that happens to reject, it
 * carries no sentence a person can act on, and in Postgres it would come out of
 * the store looking like an infrastructure fault. That is not hypothetical —
 * deleting the *item is an object* clause left this table green until this
 * function reported the error's name instead of a boolean.
 *
 * So the two good answers are the stage's own error and a value, and everything
 * else reports what it actually was.
 */
async function outcomeOf(read: () => Promise<unknown>): Promise<string> {
  try {
    await read();
    return "accepted";
  } catch (err) {
    const name = (err as Error).name;
    return name === "GlossaryBaselineUnusable" || name === "IdeasBaselineUnusable"
      ? "refused"
      : `threw ${name}`;
  }
}

/** Every breakage refused by name, and the control accepted. */
const REFUSED_BUT_THE_CONTROL = [
  ...BREAKAGES.map(({ why }) => ({ why, got: "refused" })),
  { why: CONTROL.why, got: "accepted" },
];


afterEach(() => {
  answers.length = 0;
  calls.length = 0;
});

/* ------------------------------------------------- a store beside the files -- */

/**
 * **`createFsArtifactStore` over a copy of `example/` until 2026-09-05**, when
 * the filesystem store was deleted
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § G). Nothing here was ever asking about files: these cases need a store that
 * can hold the previous run's glossary or ideas so `previousGlossaryFrom` and
 * `previousIdeasFrom` have something to read, and something that can hold one
 * which is *there and unusable*, which on a disk was a truncated file and is
 * `plant` now (helpers/memory-artefacts.ts).
 *
 * **The directory stays, and one case is the reason.** `articleIn(dir)` reads
 * the blocks the stages are run over, and *asks the store, and does not fall
 * back to reading the file itself* needs the artefact to be sitting on disk
 * exactly where the old code read it from while the store says there is none.
 * So the two helpers below write the file **and** put the artefact in the
 * store; the file is the decoy, and the store is the answer.
 */
describe("the previous artefact, as the store answers it", () => {
  const cleanUp: string[] = [];
  afterAll(async () => {
    for (const root of cleanUp) await rm(root, { recursive: true, force: true });
  });

  /** A copy of the fixture with a store beside it, cleaned up afterwards. */
  async function workspace(prefix: string) {
    const a = await anArticle(prefix);
    cleanUp.push(a.root);
    return { ...a, store: memoryArtefacts() };
  }

  /**
   * The stage, and then the write the stage no longer does itself.
   *
   * `generateGlossary` hands its glossary back and writes nothing — the caller
   * stores it, through the artefact store in the pipeline, which since
   * 2026-09-01 is the only caller there is
   * (docs/plans/260831b-finish-the-database-move.md § stage 2, § sub-stage I).
   * So everything below that reads the previous glossary back is still reading
   * what a real caller put there rather than a fixture this file invented for
   * itself. The file beside it is the decoy described above.
   */
  async function glossaryInto(
    store: MemoryArtifactStore,
    dir: string,
    opts: { previous: Glossary | null; profile?: string | null },
  ) {
    const { generateGlossary } = await import("../src/glossary.js");
    const run = await generateGlossary({ article: await articleIn(dir), ...opts });
    await writeFile(
      path.join(dir, "glossary.json"),
      JSON.stringify(run.glossary, null, 2),
      "utf-8",
    );
    store.plant("a", "glossary", "glossary", run.glossary);
    return run;
  }

  /**
   * The same for the ideas, and it is a *new* write rather than a moved one.
   *
   * `generateIdeas` wrote `<dir>/ideas.json` itself until stage 2 took the
   * directory away from it — there is no path inside a stage any more, so the
   * caller stores the artefact, through the artefact store in the pipeline.
   */
  async function ideasInto(
    store: MemoryArtifactStore,
    dir: string,
    opts: { previous: Ideas | null },
  ) {
    const { generateIdeas } = await import("../src/ideas.js");
    const run = await generateIdeas({ article: await articleIn(dir), ...opts });
    await writeFile(path.join(dir, "ideas.json"), JSON.stringify(run.ideas, null, 2), "utf-8");
    store.plant("a", "ideas", "ideas", run.ideas);
    return run;
  }

  /* ------------------------------------------------------------- glossary -- */

  it("keeps every entry id across a re-run the article's text has not changed under", async () => {
    const { dir, store } = await workspace("spya-gloss-carry-");
    const { previousGlossaryFrom } = await import("../src/glossary.js");

    answers.push(glossaryAnswer("Corrigibility", "Noema"));
    const first = await glossaryInto(store, dir, { previous: null });
    expect(first.glossary.passes).toBe(1);
    const before = first.glossary.entries.map((e) => `${e.name}=${e.id}`).sort();

    /* The rewrite path, which is the one where the ids have to be *inherited*
       rather than merely carried through: a different reader profile makes
       `existingFor` refuse to append while `sourceHash` still matches, so the
       prose is regenerated and only `idsByTerm` keeps the reader's links alive.
       src/glossary.ts § `idsByTerm`. */
    const previous = await previousGlossaryFrom(store, "a");
    expect(previous?.entries).toHaveLength(2);
    answers.push(glossaryAnswer("Corrigibility", "Noema"));
    const second = await glossaryInto(store, dir, { previous, profile: "a physicist" });

    expect(second.glossary.passes).toBe(1);
    /* The exact ids against the exact names, not a count of survivors: two runs
       that each produced two entries and share neither id would pass a count. */
    expect(second.glossary.entries.map((e) => `${e.name}=${e.id}`).sort()).toEqual(before);
  });

  it("appends to the list a second time, rather than replacing it", async () => {
    const { dir, store } = await workspace("spya-gloss-append-");
    const { previousGlossaryFrom } = await import("../src/glossary.js");

    answers.push(glossaryAnswer("Corrigibility"));
    const first = await glossaryInto(store, dir, { previous: null });

    /* The second half of the file's job, and the one every id assertion above
       is blind to. "Find more terms" is a re-run of this step, and a change
       that kept the ids while quietly turning it into "replace the glossary"
       would pass all of them. docs/project/glossary.md § Finding more. */
    answers.push(glossaryAnswer("Noema"));
    const second = await glossaryInto(store, dir, {
      previous: await previousGlossaryFrom(store, "a"),
    });

    expect(second.glossary.passes).toBe(2);
    expect(second.glossary.entries.map((e) => e.name).sort()).toEqual(["Corrigibility", "Noema"]);
    expect(second.added).toBe(1);
    // And the term that was already there kept the id it was minted with.
    expect(idOf(second.glossary, "Corrigibility")).toBe(idOf(first.glossary, "Corrigibility"));
    /* The model was told what it already has, which is what stops a top-up
       repeating itself — the append is a real append and not two lists glued
       together afterwards. */
    expect(JSON.stringify(calls[1])).toContain("Corrigibility");
  });

  it("refuses when the previous glossary is there and cannot be read", async () => {
    const { dir, store } = await workspace("spya-gloss-corrupt-");
    const { GlossaryBaselineUnusable, previousGlossaryFrom } = await import(
      "../src/glossary.js"
    );

    answers.push(glossaryAnswer("Corrigibility"));
    const first = await glossaryInto(store, dir, { previous: null });

    /* Cut off halfway, which is what a `writeFile` killed in the middle left.
       Every entry id the reader's `?term=` links name is still in those
       characters — that is the point: the artefact is unusable, not empty, and
       somebody with a backup can put it back.

       **The half-written file is gone and the state it produced is not.** No
       store left can hand back a fragment of an artefact — a JSONB column
       cannot be half-written, and the memory fake serialises whole values — so
       what this plants is a value of entirely the wrong type where an artefact
       was expected, which is the same `whyUnusable` answer the truncated bytes
       produced and the same `unusable` the stage has to tell apart from
       `absent`. `plant`, because `write` refuses a bad shape and that is what
       `write` is for. */
    const whole = JSON.stringify(first.glossary);
    store.plant("a", "glossary", "glossary", whole.slice(0, whole.length >> 1));

    await expect(previousGlossaryFrom(store, "a")).rejects.toBeInstanceOf(
      GlossaryBaselineUnusable,
    );
  });

  it("refuses when the previous glossary is of the wrong shape", async () => {
    const { store } = await workspace("spya-gloss-shape-");
    const { GlossaryBaselineUnusable, previousGlossaryFrom } = await import("../src/glossary.js");

    /* A perfectly good value, and `SHAPE.glossary` says no. This is the *only*
       shape of unusable Postgres can have — a JSONB column cannot be
       half-written — so it is the case that keeps every store honest about the
       same rule. */
    store.plant("a", "glossary", "glossary", { entries: "not an array" });

    await expect(previousGlossaryFrom(store, "a")).rejects.toBeInstanceOf(
      GlossaryBaselineUnusable,
    );
  });

  it("mints quietly when the article's text has moved under the glossary", async () => {
    const { dir, store } = await workspace("spya-gloss-moved-");
    const { previousGlossaryFrom } = await import("../src/glossary.js");

    answers.push(glossaryAnswer("Corrigibility"));
    const first = await glossaryInto(store, dir, { previous: null });

    /* A `sourceHash` from a different article. The entries describe text that
       is no longer there, so refusing to inherit is **correct** — and it must
       not go down the same road as an artefact that cannot be read. */
    store.plant("a", "glossary", "glossary", {
      ...first.glossary,
      sourceHash: "a-hash-from-somewhere-else",
    });

    const previous = await previousGlossaryFrom(store, "a");
    expect(previous?.sourceHash).toBe("a-hash-from-somewhere-else");

    answers.push(glossaryAnswer("Corrigibility"));
    const second = await glossaryInto(store, dir, { previous });
    // A fresh list: not appended to, and not inheriting the old identity.
    expect(second.glossary.passes).toBe(1);
    expect(idOf(second.glossary, "Corrigibility")).not.toBe(
      idOf(first.glossary, "Corrigibility"),
    );
  });

  it("mints quietly on a first run, where there is no glossary at all", async () => {
    const { store } = await workspace("spya-gloss-first-");
    const { previousGlossaryFrom } = await import("../src/glossary.js");
    await expect(previousGlossaryFrom(store, "a")).resolves.toBeNull();
  });

  it("lets an infrastructure fault through, rather than calling it a first run", async () => {
    const { store } = await workspace("spya-gloss-fault-");
    const { previousGlossaryFrom } = await import("../src/glossary.js");
    const broken: ArtifactStore = {
      ...store,
      readBaseline: () => Promise.reject(new Error("connection terminated unexpectedly")),
    };
    await expect(previousGlossaryFrom(broken, "a")).rejects.toThrow(/connection terminated/);
  });

  it("asks the store, and does not fall back to reading the file itself", async () => {
    const { dir, store } = await workspace("spya-gloss-seam-");
    const { previousGlossaryFrom } = await import("../src/glossary.js");

    answers.push(glossaryAnswer("Corrigibility"));
    await glossaryInto(store, dir, { previous: null });

    /* The glossary is sitting on disk exactly where the old code read it from —
       which is what `glossaryInto`'s file write is for and the only reason it
       still happens. A store that says there is none must win, or the seam is
       decorative and the files could go without anything noticing. They did go,
       on 2026-09-05, and this is what said in advance that it was safe. */
    const empty: ArtifactStore = {
      ...store,
      readBaseline: () => Promise.resolve({ state: "absent" as const }),
    };
    await expect(previousGlossaryFrom(empty, "a")).resolves.toBeNull();
    expect(JSON.parse(await readFile(path.join(dir, "glossary.json"), "utf-8")).entries).toHaveLength(1);
  });

  /* ---------------------------------------------------------------- ideas -- */

  it("keeps every idea id across a re-run the article's text has not changed under", async () => {
    const { dir, blocks, store } = await workspace("spya-ideas-carry-");
    const { previousIdeasFrom } = await import("../src/ideas.js");
    const block = quotable(blocks);

    answers.push(ideasAnswer(block, "Writing is a test of thought"));
    const first = await ideasInto(store, dir, { previous: null });
    const before = first.ideas.ideas[0]?.id;
    expect(before).toBeTruthy();

    const previous = await previousIdeasFrom(store, "a");
    expect(previous?.ideas).toHaveLength(1);

    answers.push(ideasAnswer(block, "Writing is a test of thought"));
    const second = await ideasInto(store, dir, { previous });
    /* The same name, so `idsByName` can match it — which is exactly as far as
       this stage's promise goes, and src/ideas.ts § `idsByName` says why it
       deliberately goes no further. */
    expect(second.ideas.ideas[0]?.id).toBe(before);
  });

  it("refuses when the previous ideas are there and cannot be read", async () => {
    const { dir, blocks, store } = await workspace("spya-ideas-corrupt-");
    const { IdeasBaselineUnusable, previousIdeasFrom } = await import(
      "../src/ideas.js"
    );

    answers.push(ideasAnswer(quotable(blocks), "Writing is a test of thought"));
    const first = await ideasInto(store, dir, { previous: null });

    /* The same substitution as the glossary's, for the same reason: half an
       artefact is a thing only a file could be, and what it produced —
       *present and unusable* — is planted directly. */
    const whole = JSON.stringify(first.ideas);
    store.plant("a", "ideas", "ideas", whole.slice(0, whole.length >> 1));

    await expect(previousIdeasFrom(store, "a")).rejects.toBeInstanceOf(IdeasBaselineUnusable);
  });

  it("refuses when the previous ideas are of the wrong shape", async () => {
    const { store } = await workspace("spya-ideas-shape-");
    const { IdeasBaselineUnusable, previousIdeasFrom } = await import("../src/ideas.js");
    store.plant("a", "ideas", "ideas", { ideas: { one: true } });
    await expect(previousIdeasFrom(store, "a")).rejects.toBeInstanceOf(IdeasBaselineUnusable);
  });

  it("mints quietly when the article's text has moved under the ideas", async () => {
    const { dir, blocks, store } = await workspace("spya-ideas-moved-");
    const { previousIdeasFrom } = await import("../src/ideas.js");
    const block = quotable(blocks);

    answers.push(ideasAnswer(block, "Writing is a test of thought"));
    const first = await ideasInto(store, dir, { previous: null });

    store.plant("a", "ideas", "ideas", {
      ...first.ideas,
      sourceHash: "a-hash-from-somewhere-else",
    });

    const previous = await previousIdeasFrom(store, "a");
    expect(previous?.sourceHash).toBe("a-hash-from-somewhere-else");

    answers.push(ideasAnswer(block, "Writing is a test of thought"));
    const second = await ideasInto(store, dir, { previous });
    expect(second.ideas.ideas[0]?.id).not.toBe(first.ideas.ideas[0]?.id);
  });

  it("mints quietly on a first run, where there are no ideas at all", async () => {
    const { store } = await workspace("spya-ideas-first-");
    const { previousIdeasFrom } = await import("../src/ideas.js");
    await expect(previousIdeasFrom(store, "a")).resolves.toBeNull();
  });

  /* ------------------------------ what a baseline has to carry, in a store -- */

  /**
   * One assertion over the whole table rather than a line of `expect` each,
   * because a sequence stops at the first failure and these ten are ten
   * separate ways to be wrong. Reading three of them only after fixing the
   * first is how a rewrite fixes one and calls it done.
   *
   * Each row was a `writeFile` over the artefact's file until 2026-09-05 and is
   * a `plant` now — the same act, and the hatch exists precisely because `write`
   * refuses nine of these ten.
   */
  async function refusals(
    store: MemoryArtifactStore,
    kind: "glossary" | "ideas",
    items: "entries" | "ideas",
    artefact: Record<string, unknown>,
    read: (s: ArtifactStore, slug: string) => Promise<unknown>,
  ): Promise<{ why: string; got: string }[]> {
    const out: { why: string; got: string }[] = [];
    for (const { why, apply } of [...BREAKAGES, CONTROL]) {
      store.plant("a", kind, kind, apply(artefact, items));
      out.push({ why, got: await outcomeOf(() => read(store, "a")) });
    }
    return out;
  }

  it("refuses a glossary that cannot answer either question it is read for", async () => {
    const { dir, store } = await workspace("spya-gloss-carries-");
    const { previousGlossaryFrom } = await import("../src/glossary.js");

    /* Built by the stage, then broken one field at a time — so the control is a
       real artefact rather than one hand-written to satisfy the reader, and
       every row differs from a passing case by exactly the thing named. */
    answers.push(glossaryAnswer("Corrigibility", "Noema"));
    const real = (await glossaryInto(store, dir, { previous: null })).glossary;

    expect(
      await refusals(store, "glossary", "entries", { ...real }, previousGlossaryFrom),
    ).toEqual(REFUSED_BUT_THE_CONTROL);
  });

  it("refuses ideas that cannot answer the question they are read for", async () => {
    const { dir, blocks, store } = await workspace("spya-ideas-carries-");
    const { previousIdeasFrom } = await import("../src/ideas.js");

    answers.push(ideasAnswer(quotable(blocks), "Writing is a test of thought", "Prose is a tool"));
    const real = (await ideasInto(store, dir, { previous: null })).ideas;
    expect(real.ideas).toHaveLength(2);

    expect(
      await refusals(store, "ideas", "ideas", { ...real }, previousIdeasFrom),
    ).toEqual(REFUSED_BUT_THE_CONTROL);
  });

  /**
   * **Refused before the model call and before the write**, which is the half a
   * refusal is worth nothing without.
   *
   * A guard that stops the stage *after* it has spent a model call and
   * overwritten the artefact has destroyed the thing it was protecting. The
   * assertion is three-part on purpose: it threw, no request went out, and what
   * the store holds is what it held — because any one of those alone is
   * satisfiable by a stage that failed for some other reason. The third part
   * read the bytes back off the file until 2026-09-05 and asks the store now,
   * which is the same question of the thing that now holds the answer.
   */
  it("refuses a broken glossary before the model call and before the write", async () => {
    const { dir, store } = await workspace("spya-gloss-before-");
    const { GlossaryBaselineUnusable, previousGlossaryFrom } = await import(
      "../src/glossary.js"
    );

    answers.push(glossaryAnswer("Corrigibility", "Noema"));
    const real = (await glossaryInto(store, dir, { previous: null })).glossary;

    const before = without({ ...real }, "sourceHash");
    store.plant("a", "glossary", "glossary", before);
    calls.length = 0;

    /* The pipeline's own order: read the baseline, and only then call the
       stage. `answers` is left empty, so a run that got past the guard would
       fail on the stub instead — and that is a different error, which is why
       the type is asserted rather than merely "it threw". */
    await expect(previousGlossaryFrom(store, "a")).rejects.toBeInstanceOf(
      GlossaryBaselineUnusable,
    );
    expect(calls).toHaveLength(0);
    expect(await store.read("a", "glossary", "glossary")).toEqual(before);
  });

  it("refuses broken ideas before the model call and before the write", async () => {
    const { dir, blocks, store } = await workspace("spya-ideas-before-");
    const { IdeasBaselineUnusable, previousIdeasFrom } = await import(
      "../src/ideas.js"
    );

    answers.push(ideasAnswer(quotable(blocks), "Writing is a test of thought", "Prose is a tool"));
    const real = (await ideasInto(store, dir, { previous: null })).ideas;

    const artefact: Record<string, unknown> = { ...real };
    const list = artefact.ideas as Record<string, unknown>[];
    const broken = withItem(artefact, "ideas", 1, (e) => ({ ...e, id: list[0]!.id }));
    store.plant("a", "ideas", "ideas", broken);
    calls.length = 0;

    await expect(previousIdeasFrom(store, "a")).rejects.toBeInstanceOf(IdeasBaselineUnusable);
    expect(calls).toHaveLength(0);
    expect(await store.read("a", "ideas", "ideas")).toEqual(broken);
  });

  /**
   * **The deeper rule reaches `readBaseline` and nothing else**, which is the
   * half that keeps it from breaking the kinds that legitimately have no hash.
   *
   * `arc.json` carries no `sourceHash` at all — `STAMP_SOURCE`'s own note says
   * so — so a rule applied inside `SHAPE` would have made every arc on every
   * shelf unreadable, and `stepIsDone` would have re-run stage 5b for ever. The
   * arc here is the real shape: entries, no hash.
   */
  it("leaves an ordinary read of a kind that has no sourceHash alone", async () => {
    const { store } = await workspace("spya-arc-untouched-");
    const arc = { version: "arc/1", generator: "test", entries: [{ id: "one" }] };
    store.plant("a", "arc", "arc", arc);

    expect(await store.read("a", "arc", "arc")).toMatchObject({ entries: [{ id: "one" }] });
    expect(await store.has("a", "arc", ["arc"])).toBe(true);
  });

  /**
   * **A kind nobody has declared a baseline for cannot be read as one.**
   *
   * The alternative — answering `ok` for an undeclared kind — is a check that
   * silently covers nothing, which is the entire family of bug this rule was
   * added to close. Throwing means a third identity-carrying stage has to write
   * down what its baseline is before it can ask for one, which is the moment to
   * think about it.
   */
  it("refuses to answer a baseline question for a kind with no rule", async () => {
    const { store } = await workspace("spya-no-rule-");
    /* Planted rather than absent, deliberately: `readBaseline` reaches the rule
       only for an artefact it actually has, so an empty store would answer
       `absent` and this row would pass without asking anything. */
    store.plant("a", "arc", "arc", { version: "arc/1", entries: [] });
    await expect(store.readBaseline("a", "arc", "arc")).rejects.toThrow(/BASELINE/);
  });

  it("lets an infrastructure fault through the ideas read too", async () => {
    const { store } = await workspace("spya-ideas-fault-");
    const { previousIdeasFrom } = await import("../src/ideas.js");
    const broken: ArtifactStore = {
      ...store,
      readBaseline: () => Promise.reject(new Error("connection terminated unexpectedly")),
    };
    await expect(previousIdeasFrom(broken, "a")).rejects.toThrow(/connection terminated/);
  });
});

/* ---------------------------------------------------------------- Postgres -- */

const { loadEnvLocal } = await import("../src/env.js");
loadEnvLocal();

/**
 * Whether the Postgres half can run, and — if not — a sentence saying so that
 * the reporter will actually print. See tests/blocks-baseline.test.ts for the
 * six mechanisms that were measured before `process.stderr.write` was chosen.
 */
/**
 * **The two columns this file reads and writes, by name.** A database missing
 * either fails every assertion below for a reason that has nothing to do with
 * the baseline — which is what `pgReady`'s `columns` is for. Forty lines of
 * hand-rolled probe until 2026-09-05; it refuses now rather than skipping,
 * because there is one store. tests/helpers/pg-ready.ts.
 */
await pgReady({
  suite: "tests/glossary-ideas-baseline.test.ts",
  tables: ["spideryarn.article_revisions"],
  columns: [
    { table: "spideryarn.article_revisions", column: "glossary" },
    { table: "spideryarn.article_revisions", column: "ideas" },
  ],
});

/** The transaction type, derived the way src/store/artifacts-pg.ts derives it. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Thrown to unwind a fixture transaction; never an error anybody has to see. */
class RollBack extends Error {}

describe("the previous artefact, over the Postgres store", () => {
  const SLUG = "test-gloss-ideas-baseline";
  const FRESH_SLUG = "test-gloss-ideas-baseline-new";

  let db: Awaited<ReturnType<typeof importDb>>["db"];
  let mod: Awaited<ReturnType<typeof importDb>>;

  async function importDb() {
    const client = await import("../src/db/client.js");
    const schema = await import("../src/db/schema.js");
    const pg = await import("../src/store/artifacts-pg.js");
    const revisions = await import("../src/store/pg-revisions.js");
    const admin = await import("../src/admin.js");
    const owner = await import("../src/owner.js");
    return { db: client.getDb(), client, schema, pg, revisions, admin, owner };
  }

  let articleId = "";
  let publishedId = "";
  const roots: string[] = [];

  async function wipe(slug: string): Promise<void> {
    const { schema } = mod;
    const rows = await db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.slug, slug));
    for (const { id } of rows) {
      await db.execute(
        sql`update ${schema.articles} set current_revision_id = null where id = ${id}::uuid`,
      );
      await db.delete(schema.revisionBlocks).where(eq(schema.revisionBlocks.articleId, id));
      await db.delete(schema.articleRevisions).where(eq(schema.articleRevisions.articleId, id));
      await db.delete(schema.blockIdentities).where(eq(schema.blockIdentities.articleId, id));
      await db.delete(schema.articles).where(eq(schema.articles.id, id));
    }
  }

  beforeAll(async () => {
    mod = await importDb();
    db = mod.db;
    const { schema, admin } = mod;
    await wipe(SLUG);
    await wipe(FRESH_SLUG);

    const [article] = await db
      .insert(schema.articles)
      .values({ ownerId: admin.ADMIN_USER_ID_LOCAL, slug: SLUG })
      .returning();
    if (!article) throw new Error("could not create the fixture article");
    articleId = article.id;

    const [revision] = await db
      .insert(schema.articleRevisions)
      .values({ articleId, status: "published" })
      .returning();
    if (!revision) throw new Error("could not create the fixture revision");
    publishedId = revision.id;
    await db.execute(
      sql`update ${schema.articles} set current_revision_id = ${publishedId}::uuid where id = ${articleId}::uuid`,
    );

    await db
      .insert(schema.articles)
      .values({ ownerId: admin.ADMIN_USER_ID_LOCAL, slug: FRESH_SLUG })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    if (mod) {
      await wipe(SLUG);
      await wipe(FRESH_SLUG);
      await mod.client.closeDb();
    }
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });

  /** Put a value straight into the published revision's column, shape and all. */
  async function publishColumn(column: "glossary" | "ideas", value: unknown): Promise<void> {
    const { schema } = mod;
    await db
      .update(schema.articleRevisions)
      .set({ [column]: value })
      .where(eq(schema.articleRevisions.id, publishedId));
  }

  /**
   * A draft based on the published revision, and a store bound to it — every
   * row it touches rolled back.
   *
   * **No job row, and no `insertWhenSlotFree`.** tests/blocks-baseline.test.ts
   * needs both because it calls `store.write`, which goes through
   * `requireLiveJobOwnsDraft` — this job, this attempt, still running. The read
   * path takes no claim: `readBaseline` is `readArtefactOutcome`, whose only
   * gate is `requireBound`. So inserting a `running` job here would buy nothing
   * and would put every one of these assertions behind the database's single
   * running slot, which is contended by every other suite on the laptop. It
   * cost four failures in a full-suite run before it came out.
   *
   * The honest limit that leaves: this exercises the **read** side of the
   * Postgres seam and not the write. The write is what blocks-baseline and
   * tests/store-artefacts-pg.test.ts are for, and neither of these two stages
   * writes anything through the store that the other stages do not.
   *
   * **`runAsOwner`, explicitly.** `lockArticle` filters by `currentOwnerId()`,
   * which outside a request falls back to `SPIDERYARN_OWNER_ID` — and
   * `vite.config.ts` loads `.env.local` into vitest, so a suite that relied on
   * that would pass on this laptop and fail on one where the variable names
   * somebody else.
   */
  async function withStore(
    slug: string,
    /* `tx` and `ref` as well as the store, so a case can put a value into the
       draft's **own** column and read it straight back. Writing the draft
       rather than the published revision is the same column and the same read
       path, needs one draft instead of one per row, and stays inside the
       transaction that is about to be rolled back. That the *carry* from the
       published revision happens at all is what the two carry cases above
       prove; these are about what the read makes of what it finds. */
    body: (store: ArtifactStore, tx: Tx, ref: JobDraftRef) => Promise<void>,
  ): Promise<void> {
    const { pg, revisions, admin, owner } = mod;
    const begun = await owner.runAsOwner(admin.ADMIN_USER_ID_LOCAL as OwnerId, () =>
      revisions.beginRevision({ slug }),
    );
    const ref: JobDraftRef = {
      slug,
      articleId: begun.articleId,
      revisionId: begun.revisionId,
      /* Never read on this path — `pgArtifactsIn` only passes them to
         `beginStep`/`finishStep`/`write`, none of which these tests call. Real
         values rather than empty strings so that a future test which does call
         one fails on the fence rather than on a malformed uuid. */
      jobId: mintId(),
      attemptId: mintAttempt(),
    };
    try {
      await db.transaction(async (tx: Tx) => {
        await body(pg.pgArtifactsIn(ref, tx), tx, ref);
        throw new RollBack();
      });
    } catch (err) {
      if (!(err instanceof RollBack)) throw err;
    }
  }

  it("carries the glossary's entry ids out of the column the draft inherited", async () => {
    const a = await anArticle("spya-gloss-pg-");
    roots.push(a.root);
    const { generateGlossary, previousGlossaryFrom } = await import("../src/glossary.js");

    /* Written through the real stage first, so the artefact in the column is
       one this code actually produces rather than a hand-built object that
       happens to satisfy the reader. */
    answers.push(glossaryAnswer("Corrigibility", "Noema"));
    const first = await generateGlossary({ article: await articleIn(a.dir), previous: null });
    await publishColumn("glossary", first.glossary);

    await withStore(SLUG, async (store) => {
      const previous = await previousGlossaryFrom(store, SLUG);
      expect(previous?.entries.map((e) => e.name).sort()).toEqual(["Corrigibility", "Noema"]);

      answers.push(glossaryAnswer("Corrigibility", "Noema"));
      const second = await generateGlossary({
        article: await articleIn(a.dir),
        previous,
        profile: "a physicist",
      });
      /* The rewrite path again, on this side of the seam: `existingFor` refuses
         to append across a profile change, so only `idsByTerm` can be what
         keeps these two ids. */
      expect(second.glossary.entries.map((e) => `${e.name}=${e.id}`).sort()).toEqual(
        first.glossary.entries.map((e) => `${e.name}=${e.id}`).sort(),
      );
    });
  }, 60_000);

  it("appends to the carried glossary rather than replacing it", async () => {
    const a = await anArticle("spya-gloss-pg-append-");
    roots.push(a.root);
    const { generateGlossary, previousGlossaryFrom } = await import("../src/glossary.js");

    answers.push(glossaryAnswer("Corrigibility"));
    const first = await generateGlossary({ article: await articleIn(a.dir), previous: null });
    await publishColumn("glossary", first.glossary);

    await withStore(SLUG, async (store) => {
      answers.push(glossaryAnswer("Noema"));
      const second = await generateGlossary({
        article: await articleIn(a.dir),
        previous: await previousGlossaryFrom(store, SLUG),
      });
      expect(second.glossary.passes).toBe(2);
      expect(second.glossary.entries.map((e) => e.name).sort()).toEqual([
        "Corrigibility",
        "Noema",
      ]);
    });
  }, 60_000);

  it("refuses when the carried glossary column holds something it cannot read", async () => {
    const { GlossaryBaselineUnusable, previousGlossaryFrom } = await import("../src/glossary.js");
    /* Valid JSONB and the wrong shape — the only corruption this store can
       have, since a column cannot be half-written. Left behind by an older
       writer or a hand-edit, and the ids that *should* be in it are exactly
       what minting over it would throw away. */
    await publishColumn("glossary", { entries: "not an array" });

    await withStore(SLUG, async (store) => {
      await expect(previousGlossaryFrom(store, SLUG)).rejects.toBeInstanceOf(
        GlossaryBaselineUnusable,
      );
    });
  }, 60_000);

  it("mints quietly for an article whose draft carried no glossary", async () => {
    const { previousGlossaryFrom } = await import("../src/glossary.js");
    await withStore(FRESH_SLUG, async (store) => {
      await expect(previousGlossaryFrom(store, FRESH_SLUG)).resolves.toBeNull();
    });
  }, 60_000);

  it("carries the ideas' ids out of the column the draft inherited", async () => {
    const a = await anArticle("spya-ideas-pg-");
    roots.push(a.root);
    const { generateIdeas, previousIdeasFrom } = await import("../src/ideas.js");
    const block = quotable(a.blocks);

    answers.push(ideasAnswer(block, "Writing is a test of thought"));
    const first = await generateIdeas({ article: await articleIn(a.dir), previous: null });
    await publishColumn("ideas", first.ideas);

    await withStore(SLUG, async (store) => {
      const previous = await previousIdeasFrom(store, SLUG);
      expect(previous?.ideas).toHaveLength(1);

      answers.push(ideasAnswer(block, "Writing is a test of thought"));
      const second = await generateIdeas({ article: await articleIn(a.dir), previous });
      expect(second.ideas.ideas[0]?.id).toBe(first.ideas.ideas[0]?.id);
    });
  }, 60_000);

  it("refuses when the carried ideas column holds something it cannot read", async () => {
    const { IdeasBaselineUnusable, previousIdeasFrom } = await import("../src/ideas.js");
    await publishColumn("ideas", { ideas: { one: true } });

    await withStore(SLUG, async (store) => {
      await expect(previousIdeasFrom(store, SLUG)).rejects.toBeInstanceOf(IdeasBaselineUnusable);
    });
  }, 60_000);

  it("mints quietly for an article whose draft carried no ideas", async () => {
    const { previousIdeasFrom } = await import("../src/ideas.js");
    await withStore(FRESH_SLUG, async (store) => {
      await expect(previousIdeasFrom(store, FRESH_SLUG)).resolves.toBeNull();
    });
  }, 60_000);

  /**
   * **The same table, against a JSONB column**, and it is not a formality.
   *
   * A JSONB column cannot be half-written, so every one of these ten arrives
   * here as *valid JSON of a shape the shallow check accepts* — which is
   * precisely the state `SHAPE` could not see and precisely the state a hand-fix
   * or an older writer leaves behind in a database. The filesystem has parse
   * failures and a ceiling to catch some of its corruption; this store has only
   * the rules, so this is where they carry the whole weight.
   *
   * The value goes into the **draft's** column rather than the published one:
   * same column, same read path, and one draft for the whole table instead of
   * one per row. That the carry from the published revision happens at all is
   * what the two cases above prove.
   */
  async function pgRefusals(
    column: "glossary" | "ideas",
    items: "entries" | "ideas",
    artefact: Record<string, unknown>,
    read: (s: ArtifactStore, slug: string) => Promise<unknown>,
  ): Promise<{ why: string; got: string }[]> {
    const { schema } = mod;
    const out: { why: string; got: string }[] = [];
    await withStore(SLUG, async (store, tx, ref) => {
      for (const { why, apply } of [...BREAKAGES, CONTROL]) {
        await tx
          .update(schema.articleRevisions)
          .set({ [column]: apply(artefact, items) })
          .where(eq(schema.articleRevisions.id, ref.revisionId));
        out.push({ why, got: await outcomeOf(() => read(store, SLUG)) });
      }
    });
    return out;
  }

  it("refuses a glossary column that cannot answer either question", async () => {
    const a = await anArticle("spya-gloss-pg-carries-");
    roots.push(a.root);
    const { generateGlossary, previousGlossaryFrom } = await import("../src/glossary.js");

    answers.push(glossaryAnswer("Corrigibility", "Noema"));
    const real = (await generateGlossary({ article: await articleIn(a.dir), previous: null })).glossary;

    expect(
      await pgRefusals("glossary", "entries", { ...real }, previousGlossaryFrom),
    ).toEqual(REFUSED_BUT_THE_CONTROL);
  }, 60_000);

  it("refuses an ideas column that cannot answer the question", async () => {
    const a = await anArticle("spya-ideas-pg-carries-");
    roots.push(a.root);
    const { generateIdeas, previousIdeasFrom } = await import("../src/ideas.js");

    answers.push(
      ideasAnswer(quotable(a.blocks), "Writing is a test of thought", "Prose is a tool"),
    );
    const real = (await generateIdeas({ article: await articleIn(a.dir), previous: null })).ideas;
    expect(real.ideas).toHaveLength(2);

    expect(await pgRefusals("ideas", "ideas", { ...real }, previousIdeasFrom)).toEqual(
      REFUSED_BUT_THE_CONTROL,
    );
  }, 60_000);

  /**
   * **Read the baseline, then write through the store, in one transaction.**
   *
   * The review's third note: the cases above exercise baseline reads and the
   * ids that come back, so they say nothing about what happens when the stage
   * *writes*. This is the round trip — carried column in, `previousGlossaryFrom`,
   * the real stage, `store.write` inside the job's transaction, and the ids read
   * back out of the column the write put them in. An id that survived the match
   * and then failed to survive the write would be invisible from the other
   * cases.
   *
   * **This one takes the running slot**, because `writeArtefacts` calls
   * `requireLiveJobOwnsDraft` — this job, this attempt, still `running` — so it
   * cannot be faked. It is one test rather than nine for that reason:
   * `insertWhenSlotFree` waits on a database-wide unique index that every other
   * suite on the laptop is also claiming, and putting all nine behind it cost
   * four failures in a full-suite run.
   */
  it("writes the carried ids back through the store, inside the job's transaction", async () => {
    const a = await anArticle("spya-gloss-pg-write-");
    roots.push(a.root);
    const { schema, pg, revisions, admin, owner } = mod;
    const { generateGlossary, previousGlossaryFrom } = await import("../src/glossary.js");

    answers.push(glossaryAnswer("Corrigibility", "Noema"));
    const first = (await generateGlossary({ article: await articleIn(a.dir), previous: null })).glossary;
    await publishColumn("glossary", first);

    const begun = await owner.runAsOwner(admin.ADMIN_USER_ID_LOCAL as OwnerId, () =>
      revisions.beginRevision({ slug: SLUG }),
    );
    await insertWhenSlotFree(SLUG, async () => {
      const id = mintId();
      const attemptId = mintAttempt();
      try {
        await db.transaction(async (tx: Tx) => {
          await tx.insert(schema.jobs).values({
            id,
            ownerId: admin.ADMIN_USER_ID_LOCAL,
            slug: SLUG,
            steps: [{ name: "glossary", label: "Finding the terms", status: "pending" }],
            status: "running",
            attemptId,
            leaseExpiresAt: new Date(Date.now() + 600_000),
            workKey: `wk-${id}`,
            draftRevisionId: begun.revisionId,
          });
          const ref: JobDraftRef = {
            slug: SLUG,
            articleId: begun.articleId,
            revisionId: begun.revisionId,
            jobId: id,
            attemptId,
          };
          const store = pg.pgArtifactsIn(ref, tx);

          answers.push(glossaryAnswer("Corrigibility", "Noema"));
          const previous = await previousGlossaryFrom(store, SLUG);
          const second = await generateGlossary({
            article: await articleIn(a.dir),
            previous,
            profile: "a physicist",
          });

          await store.beginStep(SLUG, "glossary");
          /* The stamp has to agree with the artefact — `assertStampAgrees`
             compares the two and refuses a write where they disagree, so this
             also exercises that the stage's own stamp is the artefact's. */
          await store.write(
            SLUG,
            "glossary",
            { glossary: second.glossary },
            {
              inputHash: second.glossary.sourceHash,
              promptVersion: second.glossary.version,
              model: second.glossary.generator,
            },
          );

          const readBack = await store.read(SLUG, "glossary", "glossary");
          /* The exact ids against the exact names, out of the column the write
             put them in — not a count, and not the object the stage returned. */
          expect(readBack?.entries.map((e) => `${e.name}=${e.id}`).sort()).toEqual(
            first.entries.map((e) => `${e.name}=${e.id}`).sort(),
          );
          /* **And something the carried column did not already say.** The ids
             alone cannot tell a write that preserved them from a write that did
             nothing at all — the column arrived holding exactly those ids. The
             second run was made for a profile and the first was not, so this is
             the field that only the write can have put there. */
          expect(readBack?.profileHash).toBe(second.glossary.profileHash);
          expect(first.profileHash).toBeNull();
          expect(second.glossary.profileHash).not.toBeNull();
          throw new RollBack();
        });
      } catch (err) {
        if (!(err instanceof RollBack)) throw err;
      }
    });
  }, 60_000);
});

/* ------------------------------------------------ the wiring in the pipeline -- */

/**
 * **Each step must pass its own baseline, from the store, to its own
 * generator.**
 *
 * The required `previous` argument closes the strong half: a call that drops it
 * does not compile. What it cannot see is a caller that supplies the *wrong*
 * baseline. `previous: await readGlossary(ctx.dir)` compiles today and does
 * exactly what this change was made to stop, right up until landing D deletes
 * `ctx.dir`; and `generateIdeas({ previous: await previousGlossaryFrom(…) })`
 * compiles **for ever**, because both helpers return an object and the two
 * stages would each be handed a plausible artefact of the wrong kind.
 *
 * The first version of this check was a set of the names called anywhere in the
 * file, which cannot see either crossing — GPT Sol, 2026-08-28. This one follows
 * the value: for each generator call it reads the `previous` property, and
 * either the call that produced it directly or the declarator that bound it,
 * scoped to the enclosing function so that two `const previous = …` in two
 * different `run` methods cannot be confused.
 *
 * **The honest limit.** One file, one hop. A baseline built in a helper this
 * file imports, or reassigned through a second variable, is invisible — and the
 * required argument is what makes that acceptable, since somebody would have to
 * write the wrong thing deliberately. The analyser is exercised on every shape
 * below rather than only on a directory that happens to be clean.
 */
describe("the pipeline's wiring", () => {
  /** The generator each step calls, and the helper its baseline must come from. */
  const EXPECTED: Record<string, string> = {
    generateGlossary: "previousGlossaryFrom",
    generateIdeas: "previousIdeasFrom",
  };

  const FUNCTIONS = new Set([
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
    "ObjectMethod",
    "ClassMethod",
  ]);

  /** `f(…)` and `mod.f(…)` alike; anything else is not a call by name. */
  function calleeName(callee: unknown): string | null {
    const c = callee as AstNode | undefined;
    if (c?.type === "Identifier") return c.name as string;
    if (c?.type === "MemberExpression" && c.computed !== true) {
      const property = c.property as AstNode | undefined;
      if (property?.type === "Identifier") return property.name as string;
    }
    return null;
  }

  /** `await f(…)` and `f(…)` are the same thing to this question. */
  const unwrapAwait = (n: AstNode | undefined): AstNode | undefined =>
    n?.type === "AwaitExpression" ? (n.argument as AstNode) : n;

  /**
   * For every `generateGlossary` / `generateIdeas` call in this source: where
   * its `previous` came from, or a phrase saying why that cannot be told.
   *
   * The phrase is deliberately not `null`. "It came from the wrong helper" and
   * "there is no `previous` here at all" are different mistakes and the message
   * has to say which.
   */
  function baselineSources(source: string): { generator: string; from: string }[] {
    const program = parseSource(source).program;
    const parents = new Map<AstNode, AstNode | null>();
    walkAst(program, (n, parent) => parents.set(n, parent));

    const enclosing = (n: AstNode): AstNode | null => {
      for (let at = parents.get(n) ?? null; at; at = parents.get(at) ?? null) {
        if (FUNCTIONS.has(at.type as string)) return at;
      }
      return null;
    };

    const found: { generator: string; from: string }[] = [];
    walkAst(program, (node) => {
      if (node.type !== "CallExpression") return;
      const generator = calleeName(node.callee);
      if (!generator || !(generator in EXPECTED)) return;

      const arg = (node.arguments as AstNode[])[0];
      const property = (arg?.properties as AstNode[] | undefined)?.find(
        (p) => ((p.key as AstNode | undefined)?.name as string) === "previous",
      );
      if (!property) {
        found.push({ generator, from: "no previous property" });
        return;
      }
      const value = unwrapAwait(property.value as AstNode);

      // Written inline — `previous: await previousGlossaryFrom(store, slug)`.
      if (value?.type === "CallExpression") {
        found.push({ generator, from: calleeName(value.callee) ?? "an unnamed call" });
        return;
      }
      if (value?.type !== "Identifier") {
        found.push({ generator, from: `a ${value?.type ?? "missing"}, not a store read` });
        return;
      }

      /* Bound to a name — so find where, inside this function and no other.
         Two `const previous = …` in two `run` methods is the ordinary shape of
         src/pipeline.ts, and a file-wide search would pick whichever came
         first and call the crossover correct. */
      const scope = enclosing(node);
      let from = `"${value.name}" is not bound in this function`;
      if (scope) {
        walkAst(scope, (n) => {
          if (n.type !== "VariableDeclarator") return;
          if (((n.id as AstNode | undefined)?.name as string) !== value.name) return;
          const init = unwrapAwait(n.init as AstNode | undefined);
          from =
            init?.type === "CallExpression"
              ? (calleeName(init.callee) ?? "an unnamed call")
              : `a ${init?.type ?? "missing"}, not a store read`;
        });
      }
      found.push({ generator, from });
    });
    return found;
  }

  it("gives each generator the baseline its own helper read from the store", async () => {
    const source = await readFile(path.join(ROOT, "src", "pipeline.ts"), "utf-8");
    /* Sorted, because the order of the steps in the file is not the subject and
       moving one should not redden this. */
    expect(baselineSources(source).sort((a, b) => a.generator.localeCompare(b.generator))).toEqual([
      { generator: "generateGlossary", from: "previousGlossaryFrom" },
      { generator: "generateIdeas", from: "previousIdeasFrom" },
    ]);
  });

  it("does not read either artefact's file", async () => {
    const source = await readFile(path.join(ROOT, "src", "pipeline.ts"), "utf-8");
    const called = new Set<string>();
    walkAst(parseSource(source).program, (node) => {
      if (node.type === "CallExpression") {
        const name = calleeName(node.callee);
        if (name) called.add(name);
      }
    });
    expect({
      readsTheGlossaryFile: called.has("readGlossary"),
      readsTheIdeasFile: called.has("readIdeas"),
    }).toEqual({ readsTheGlossaryFile: false, readsTheIdeasFile: false });
  });

  /**
   * Every shape the analyser has to get right, in one table and one assertion.
   *
   * A scan over a file that happens to be correct is not evidence that the scan
   * works — the first version of this check passed against a correct
   * `src/pipeline.ts` while being unable to see the crossover at all.
   */
  const SHAPES: { why: string; source: string; expect: { generator: string; from: string }[] }[] = [
    {
      why: "the real shape: bound in the step's own run method",
      source: `const steps = {
        glossary: { async run(ctx, store) {
          const previous = await previousGlossaryFrom(store, ctx.slug);
          return generateGlossary({ dir: ctx.dir, previous });
        } },
        ideas: { async run(ctx, store) {
          const previous = await previousIdeasFrom(store, ctx.slug);
          return generateIdeas({ dir: ctx.dir, previous });
        } },
      };`,
      expect: [
        { generator: "generateGlossary", from: "previousGlossaryFrom" },
        { generator: "generateIdeas", from: "previousIdeasFrom" },
      ],
    },
    {
      /* **The crossover the old check could not see.** Two `const previous`,
         one per method, and a file-wide name set says both helpers are called
         and both generators are called — which is true, and useless. */
      why: "crossed over: each step hands the other's baseline on",
      source: `const steps = {
        glossary: { async run(ctx, store) {
          const previous = await previousIdeasFrom(store, ctx.slug);
          return generateGlossary({ dir: ctx.dir, previous });
        } },
        ideas: { async run(ctx, store) {
          const previous = await previousGlossaryFrom(store, ctx.slug);
          return generateIdeas({ dir: ctx.dir, previous });
        } },
      };`,
      expect: [
        { generator: "generateGlossary", from: "previousIdeasFrom" },
        { generator: "generateIdeas", from: "previousGlossaryFrom" },
      ],
    },
    {
      why: "read from the file instead of the store",
      source: `async function run(ctx) {
        const previous = await readGlossary(ctx.dir);
        return generateGlossary({ dir: ctx.dir, previous });
      }`,
      expect: [{ generator: "generateGlossary", from: "readGlossary" }],
    },
    {
      why: "written inline rather than bound, which is correct and must pass",
      source:
        "generateIdeas({ dir: ctx.dir, previous: await previousIdeasFrom(store, ctx.slug) });",
      expect: [{ generator: "generateIdeas", from: "previousIdeasFrom" }],
    },
    {
      why: "a literal, which compiles and silently mints",
      source: "generateGlossary({ dir: ctx.dir, previous: null });",
      expect: [{ generator: "generateGlossary", from: "a NullLiteral, not a store read" }],
    },
    {
      why: "bound outside the function it is used in",
      source: `const previous = await previousGlossaryFrom(store, slug);
        function run() { return generateGlossary({ dir, previous }); }`,
      expect: [
        { generator: "generateGlossary", from: '"previous" is not bound in this function' },
      ],
    },
    {
      why: "a mention in a comment is not a call",
      source: "// generateGlossary({ previous }) would be wrong here\nconst x = 1;",
      expect: [],
    },
  ];

  it("would notice each shape a real miswiring could take", () => {
    expect(SHAPES.map(({ why, source }) => ({ why, found: baselineSources(source) }))).toEqual(
      SHAPES.map(({ why, expect: found }) => ({ why, found })),
    );
  });
});
