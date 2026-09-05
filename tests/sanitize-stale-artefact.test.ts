/**
 * An article stored before the sanitiser existed is still on disk, and still
 * dirty.
 *
 * docs/project/security.md carried this as a known gap for a day: *"`blocks.json`
 * files written before this change are trusted as-is. Re-run stage 3 to clean
 * them."* The trouble with that remedy is that **nothing anywhere says the
 * re-run is needed**. A stale artefact reads exactly like a current one — same
 * shape, same fields, serves fine — so the check anybody would run comes back
 * clean. That is the [silent-success](docs/reusable/silent-success.md) shape,
 * applied to the fix rather than to the bug.
 *
 * The answer is a **stamp**, and re-sanitising only what the stamp says is
 * stale. Re-sanitising every read was measured rather than argued about: 33ms
 * and roughly 130MB of jsdom retention for the 141-block Noema article, on every
 * article load, forever. Comparing an integer costs nothing, and the article
 * that needs the work is the rare one.
 *
 * Two halves, and they fail independently:
 *
 *   stage 3 writes the stamp            src/blocks.ts
 *   the read seam acts on it            src/sanitize.ts, called from loadArticle
 *
 * A stamp nothing checks is decoration; a check on a stamp nobody writes never
 * fires. Both are pinned below.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { blocksArtefact } from "../src/blocks.js";
import { STEPS } from "../src/pipeline.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";
import { SANITIZER_VERSION } from "../src/sanitize-policy.js";
import { sanitizeStoredBlocks } from "../src/sanitize.js";
import { loadArticle } from "../src/api.js";
import type { Block } from "../src/types.js";

/**
 * An artefact of the kind this is all about: written before the sanitiser, so
 * the handler is sitting in the stored `html`. The `onerror` fires on load,
 * because the src cannot resolve.
 */
const DIRTY_HTML = `<p id="spya-k3m9qt">a <img src="/x.png" onerror="alert('STOREDPAYLOAD')"> b</p>`;

const dirtyBlock = (): Block => ({
  id: "spya-k3m9qt",
  tag: "p",
  kind: "text",
  text: "a b",
  words: 2,
  html: DIRTY_HTML,
  gistable: true,
});

/**
 * **This ran the real command line in a subprocess until 2026-09-05, and now
 * runs the real step.**
 *
 * The history is worth two paragraphs, because both moves were forced and both
 * were about the same thing: *what actually writes the artefact*.
 *
 * Until 2026-08-31 `runBlocks` read a file and wrote two, so calling it from a
 * test exercised the writing. It stopped writing — the step hands its return
 * value to the artefact store — and `main()` in src/blocks.ts became the one
 * caller left that touched a disk. So the test moved to `npx tsx src/blocks.ts`
 * in a child process, because a test that called `runBlocks` could no longer say
 * anything about what lands in a `blocks.json`: it would pass just as well
 * against a `main()` that had quietly dropped `blocksArtefact`.
 *
 * On 2026-09-05 that `main()` went too — the stage CLIs moved onto the queue
 * (`scripts/stage.ts`), and nothing in the repo writes a `blocks.json` from
 * stage 3 any more. **So the subject moved again, to `STEPS.blocks.run`**, which
 * is the one caller that turns `runBlocks`'s answer into the thing a store is
 * handed. The claim is unchanged and is now made one layer closer to where it
 * matters: the artefact that leaves stage 3 carries a stamp, and the stamp is
 * true. Same mutation as before — drop `blocksArtefact` from the step's return
 * and this goes red — with no subprocess and no 60-second timeout.
 */
describe("the stamp stage 3 writes", () => {
  const stage3 = async (store: ReturnType<typeof memoryArtefacts>) => {
    const dir = await mkdtemp(path.join(tmpdir(), "spya-stamp-"));
    try {
      const out = await STEPS.blocks.run(
        {
          slug: "a-slug",
          dir,
          htmlFile: path.join(dir, "a-slug.html"),
          report: () => {},
          signal: new AbortController().signal,
          cacheArticle: false,
        },
        store,
        nullCheckpointStore(),
      );
      return out.parts?.blocks as { sanitizer?: number; blocks: Block[] };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it("puts the sanitiser version it used into the blocks artefact", async () => {
    const store = memoryArtefacts();
    store.plant(
      "a-slug",
      "extract",
      "extractedHtml",
      `<!doctype html><html><body>${DIRTY_HTML}</body></html>`,
    );

    const written = await stage3(store);

    expect(written.sanitizer).toBe(SANITIZER_VERSION);
    // And it really did sanitise, so the stamp is a claim about this artefact
    // rather than a number copied in beside dirty content.
    expect(JSON.stringify(written.blocks)).not.toContain("onerror");
  });

  it("is how an artefact from before the stamp becomes stamped", async () => {
    // The migration, and there is deliberately no other one: re-running stage 3
    // rewrites the blocks anyway, so the existing remedy now also records that
    // it happened. `npm run blocks -- <slug> --force` is how somebody does it.
    const store = memoryArtefacts();
    store.plant(
      "a-slug",
      "extract",
      "extractedHtml",
      `<!doctype html><html><body>${DIRTY_HTML}</body></html>`,
    );
    /* The unstamped artefact *is* the baseline stage 3 reads, which is what
       makes this the migration rather than a fresh ingest: the block keeps its
       id (it is in the HTML too) and what comes back is stamped. Planted at
       `("blocks", "blocks")`, which is where `previousBlocksFrom` looks — and
       getting that wrong is loud rather than quiet, because an empty baseline
       beside `hasEarlierBlocks` answering yes is `BaselineMissing`. */
    store.plant("a-slug", "blocks", "blocks", { blocks: [dirtyBlock()] });

    const written = await stage3(store);

    expect(written.sanitizer).toBe(SANITIZER_VERSION);
    expect(written.blocks[0]?.id).toBe("spya-k3m9qt");
    expect(JSON.stringify(written.blocks)).not.toContain("onerror");
  });
});

describe("every writer of a blocks.json stamps it", () => {
  /**
   * **The half of this that was nearly missed.** Stage 3 stamped
   * `output/<slug>.blocks.json`. The file the server actually opened was
   * `data/<slug>/blocks.json`, and that one was written by **stage 4**, from
   * scratch — so a plain `{ blocks }` there silently dropped the stamp and every
   * article in the library read back as stale. Not unsafe: stale means
   * re-sanitise, and re-sanitising is correct. Useless, and worse than useless,
   * because the warning that is supposed to mean "this artefact predates the
   * sanitiser" would then fire on every article ever loaded.
   *
   * Which is the same shape as the bug this whole file is about: the thing looks
   * like it is working, and the check you would naturally run — is the stamp
   * being written? — says yes, because it is, into a different file.
   *
   * So this reads the source. A behavioural test cannot reach stage 4 without a
   * model call, and a test that only exercises `runBlocks` is exactly the one
   * that missed this.
   *
   * **There is one writer left in `src/`, and it is not a stage.** Both stages
   * stopped writing files (2026-08-31), and their command lines — the last
   * callers that did — went on 2026-09-05 with the move onto the queue
   * (`scripts/stage.ts`). What remains is `db:export` in src/store/export.ts,
   * writing rows out of Postgres into a directory, which is precisely the case
   * the next test is about: a writer that has *not* sanitised anything and must
   * not be allowed to certify that it has.
   */
  /* Comment lines are dropped first, or this file's own prose about writing a
     blocks.json counts as a writer of one. */
  const writers = (source: string): string[] =>
    source
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .filter((line) => /["'`]blocks\.json["'`]/.test(line) && /write\w*\(|\bput\(/.test(line));

  it("goes through blocksArtefact, wherever the file is written", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const root = new URL("../src/", import.meta.url);
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) =>
      f.endsWith(".ts"),
    );

    /**
     * **What counts as stamped, and why the third alternative is not a
     * loophole.**
     *
     * `blocksArtefact(...)` and a literal `sanitizer:` are the two ways to
     * build the payload at the write itself. `parts.blocks` is the third, and
     * it arrived when stage 4 stopped writing its own files (2026-08-31): the
     * stage returns `HierarchyArtefacts`, whose `blocks` field is typed
     * `ReturnType<typeof blocksArtefact>`, and `main()` writes that field out.
     * The value provably went through `blocksArtefact` — one function away, in
     * the same file — and a line-by-line reading of the source cannot see it.
     *
     * It is not a hole, because the *type* is what closes it: a bare `Block[]`
     * will not assign to that field, and the only other way to satisfy it is an
     * object literal carrying `sanitizer`, which this expression already
     * catches wherever it is written. What would be a hole is a field named
     * `parts.blocks` on something that is not `HierarchyArtefacts` — so if a second
     * one is ever introduced, narrow this.
     */
    const stamped = /blocksArtefact|sanitizer|parts\.blocks/;
    const unstamped: string[] = [];
    for (const file of files) {
      const source = readFileSync(new URL(file, root), "utf8");
      for (const line of writers(source)) {
        if (!stamped.test(line)) unstamped.push(`src/${file}: ${line.trim()}`);
      }
    }

    expect(
      unstamped,
      "These write a blocks.json without the sanitiser stamp, so anything reading it\n" +
        "will treat a perfectly clean artefact as stale — re-sanitising it on every load\n" +
        "and firing the 'predates the sanitiser' warning forever. Wrap the payload in\n" +
        "`blocksArtefact(blocks)` from src/blocks.ts.",
    ).toEqual([]);
  });

  it("cannot stamp something it has not cleaned", () => {
    /**
     * **The stamp has to be true, not just present.** Only stage 3 has actually
     * sanitised the blocks it is about to write. Stage 4 writes whatever
     * `blocks.json` it was pointed at, and the Postgres export writes rows
     * imported from a file of unknown age — so a helper that only attached the
     * number would take content predating the sanitiser and certify it clean,
     * at the exact seam that then trusts the certificate.
     *
     * That is worse than the gap it closes: before, an old artefact was
     * re-sanitised on read; after, it would be waved through. A stamp that can
     * be wrong is not a weaker version of this feature, it is the opposite of
     * one.
     */
    const artefact = blocksArtefact([dirtyBlock()]);

    expect(artefact.sanitizer).toBe(SANITIZER_VERSION);
    expect(artefact.blocks[0]?.html).not.toContain("onerror");
    expect(artefact.blocks[0]?.html).toContain(`id="spya-k3m9qt"`);

    // And the certificate is one the read seam then accepts, which is the whole
    // point of making it true here.
    expect(sanitizeStoredBlocks(artefact.blocks, artefact.sanitizer).stale).toBe(false);
  });

  it("finds the writers at all", async () => {
    /* The control. The assertion above passes trivially against a regex that
       matches nothing, which is precisely how it would come to be believed.
       It watched `src/hierarchy.ts` until 2026-09-05, when stage 4's command
       line went and took the last `writeAtomic(path.join(outDir,
       "blocks.json"), …)` with it — the control went red, correctly, and
       naming the writer that is actually left is the repair. If this ever goes
       red again, the question to ask first is whether *anything* still writes a
       blocks.json: a rule with nothing to say is not the same as a rule being
       obeyed. */
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../src/store/export.ts", import.meta.url), "utf8");
    expect(writers(source).length).toBeGreaterThan(0);
  });
});

describe("every reader of stored html guards it", () => {
  /**
   * **There are two stores, and a fix that guards one of them passes every
   * test.** `loadArticle` exists twice: the filesystem reader in src/api.ts and
   * the Postgres reader in src/store/pg.ts, whose `blocksFor` hands back
   * `html: row.html`. Guard only the first and the fs half is genuinely
   * protected, the suite is green, and the store that is in the middle of
   * *replacing* the filesystem serves old HTML unchecked.
   *
   * That is the same shape as everything else in this file — the check you would
   * run comes back clean because it shares an assumption with the code, here
   * that there is one reader. Raised by review rather than found by a test,
   * which is why the test now exists.
   *
   * Kept as a source read for the same reason as the writers above: the
   * Postgres reader needs a live database, so a behavioural test for it skips on
   * most machines — and a security guard whose test skips is not a guard.
   */
  const READERS = ["api.ts", "store/pg.ts"];

  it("calls sanitizeStoredBlocks in every loadArticle", async () => {
    const { readFileSync } = await import("node:fs");
    const unguarded = READERS.filter((file) => {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      /* A *call*, not a mention. `includes("sanitizeStoredBlocks")` was
         satisfied by the comment beside the call explaining why it is there —
         so deleting the call and leaving the prose kept this green. Comments
         naming the thing they guard are the norm in this codebase, which makes
         that the likely accident rather than an exotic one. */
      return !/sanitizeStoredBlocks\s*\(/.test(source);
    });

    expect(
      unguarded,
      "These build an Article from stored blocks without checking the sanitiser stamp,\n" +
        "so an artefact written before the sanitiser is served as-is. Call\n" +
        "`sanitizeStoredBlocks(blocks, stamp)` from src/sanitize.ts — pass `undefined`\n" +
        "for the stamp if the store has nowhere to keep one yet, which reads as stale\n" +
        "and is the safe direction.",
    ).toEqual([]);
  });

  it("is looking at files that really do build an Article", async () => {
    // The control. The assertion above passes just as well against a list of
    // filenames that do not exist or do not read blocks, which is exactly how a
    // guard like this rots into decoration.
    const { readFileSync } = await import("node:fs");
    for (const file of READERS) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      expect(source, `${file} no longer has a loadArticle`).toMatch(/loadArticle\s*\(/);
      expect(source, `${file} no longer reads block html`).toMatch(/html/);
    }
  });
});

describe("sanitizeStoredBlocks", () => {
  it("cleans an artefact with no stamp at all", () => {
    const { blocks, stale } = sanitizeStoredBlocks([dirtyBlock()], undefined);
    expect(stale).toBe(true);
    expect(blocks[0]?.html).not.toContain("onerror");
    expect(blocks[0]?.html).toContain(`id="spya-k3m9qt"`);
  });

  it("cleans an artefact stamped with a version it does not recognise", () => {
    // Not "older than", just "different from". A newer stamp means a build we
    // are not — a rollback, or a branch — and re-sanitising is idempotent, so
    // there is nothing to buy by reasoning about which way the difference goes.
    const { blocks, stale } = sanitizeStoredBlocks([dirtyBlock()], SANITIZER_VERSION + 1);
    expect(stale).toBe(true);
    expect(blocks[0]?.html).not.toContain("onerror");
  });

  it("hands back the very same array when the stamp is current", () => {
    const stored = [dirtyBlock()];
    const { blocks, stale } = sanitizeStoredBlocks(stored, SANITIZER_VERSION);

    expect(stale).toBe(false);
    // Identity, not equality. This is the assertion that says the common path
    // costs nothing — a version that mapped over the blocks and happened to
    // return the same strings would pass a `toEqual` and would still be paying
    // 33ms and a jsdom parse per block on every article load.
    expect(blocks).toBe(stored);

    /* The control. Without it this test passes just as well against a function
       that never sanitises anything, because the stored html is dirty either
       way — the whole point is that the stamp is what suppressed the work. */
    expect(sanitizeStoredBlocks([dirtyBlock()], undefined).blocks[0]?.html).not.toContain(
      "onerror",
    );
  });

  it("leaves block.text alone", () => {
    // `text` is never rendered as markup — it goes to the model, and it is the
    // offset space comments and search hits are anchored in (src/quote-match.ts).
    // Rewriting it here would move every anchor in the article for no gain.
    const before = dirtyBlock();
    const { blocks } = sanitizeStoredBlocks([before], undefined);
    expect(blocks[0]?.text).toBe(before.text);
    expect(blocks[0]?.words).toBe(before.words);
  });
});

describe("loadArticle, over an artefact from before the sanitiser", () => {
  /* The behavioural test, through the real read seam. The two above prove the
     helper works and that stage 3 stamps; neither would notice `loadArticle`
     forgetting to call it, which is the mistake that reopens the gap. */
  const slug = "test-stale-sanitiser-artefact";
  const dir = path.join(process.cwd(), "data", slug);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("does not serve the stored payload", async () => {
    await mkdir(dir, { recursive: true });
    // No `sanitizer` key: exactly what a file written before the stamp looks
    // like, which is also what a file written before DOMPurify looks like.
    await writeFile(path.join(dir, "blocks.json"), JSON.stringify({ blocks: [dirtyBlock()] }));
    await writeFile(
      path.join(dir, "tree.json"),
      JSON.stringify({
        rootId: "n1",
        nodes: { n1: { id: "n1", parentId: null, childIds: [], range: ["spya-k3m9qt", "spya-k3m9qt"], depth: 0 } },
      }),
    );

    const article = await loadArticle(slug);
    expect(JSON.stringify(article.blocks)).not.toContain("onerror");
    expect(JSON.stringify(article.blocks)).not.toContain("STOREDPAYLOAD");
    // Not by serving nothing: the block is still there, id intact.
    expect(article.blocks[0]?.id).toBe("spya-k3m9qt");
    expect(article.blocks[0]?.html).toContain("<img");
  });
});
