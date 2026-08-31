/**
 * `data/` → Postgres → `data/` loses nothing.
 *
 * The exporter is the rollback (src/store/export.ts), and a rollback nobody has
 * ever run is not a rollback. This runs it: import every article, export it to
 * a temporary directory, and compare every artefact against the original.
 *
 * ## Semantic equality, not byte equality, and why that is the right bar
 *
 * The files do NOT come back byte-identical, and they cannot. `tree`, `arc`,
 * `tweets`, `glossary`, `summary` and `labels` are stored as **JSONB**, and
 * JSONB does not preserve key order — it is a parsed representation, not the
 * text you handed it. So a round trip reorders keys inside objects while
 * changing nothing about what they mean.
 *
 * That is worth stating rather than working around, because the obvious
 * "improvement" — storing these as `text` to keep the bytes — would cost every
 * query that ever wants to look inside one, to buy a `git diff` that is tidier
 * during a rollback nobody expects to run. So: keys are sorted before
 * comparison, and everything else must match exactly.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { and, eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articles } from "../src/db/schema.js";
import { currentOwnerId } from "../src/owner.js";
import { loadEnvLocal } from "../src/env.js";
import { isSpideryarnId } from "../src/ids.js";
import { SANITIZER_VERSION } from "../src/sanitize-policy.js";
import { exportArticle, rawFileName } from "../src/store/export.js";
import { sniffKind } from "../src/fetch.js";
import { releaseCorpusLock, takeCorpusLock } from "./helpers/corpus-lock.js";
import { forgetRevisions } from "./helpers/forget-revisions.js";
import { loadArticleIntoPg } from "./helpers/load-article.js";
import { seedReaderStateFromFiles } from "./helpers/seed-reader-state.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Every **JSON** artefact a round trip should preserve.
 *
 * The raw document and its manifest are deliberately not here — they are bytes
 * and a name, not a document to compare — and have two tests of their own
 * below. Until 2026-08-27 they had neither, and this comment said "every
 * artefact", which is how losing the whole source document came to be something
 * this file would pass.
 */
const ARTEFACTS = [
  "meta.json",
  "blocks.json",
  "tree.json",
  "assets.json",
  "arc.json",
  "tweets.json",
  "glossary.json",
  "summary.json",
  "ideas.json",
  "quotes.json",
  "sketch.json",
  "labels.json",
  "comments.json",
  "chat.json",
  "searches.json",
  "glossary-lookups.json",
  "shelf.json",
] as const;

/** Sort every object's keys, recursively. See the header for why. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sorted(v)]),
    );
  }
  return value;
}

/**
 * Put the reader-state lists in one known order, on both sides.
 *
 * A table has no array order, so a round trip cannot promise to return
 * `comments.json`'s. It usually did, by the accident of Postgres handing back
 * rows in the order they were written — and the accident ran out the day
 * src/store/import.ts started deleting and re-inserting reader state. Nor was
 * the accident ever right: data/noema-.../comments.json has a hand-written
 * comment sitting out of date order, so the file's order is *insertion* order,
 * and no column records it.
 *
 * That is fine, and worth saying why rather than just sorting and moving on.
 * Nothing reads the array order: src/web/comment-nav.ts sorts comments into
 * document order before the reader sees any of them, breaking ties on
 * `createdAt` then `id` — the same chain used here and in src/store/export.ts.
 * So the promise this test makes is "every row comes back, unchanged", not
 * "the file is byte-identical", which is the same bar the JSONB key order
 * already set. GPT Sol raised it in review, 2026-08-26.
 *
 * Chat MESSAGES are deliberately not reordered: `chat_messages.ordinal` does
 * record their position, so their order is a real promise and sorting them here
 * would hide the day it breaks.
 */
function canonical(artefact: string, value: unknown): unknown {
  /* `blocks.json` carries a `sanitizer` stamp saying which version of the
     policy cleaned it (docs/project/security.md). The export re-stamps, because
     it writes the blocks through `blocksArtefact` and therefore has genuinely
     just cleaned them — so an artefact that went into Postgres before the stamp
     existed comes back out with one. That is the export doing its job, not
     content changing, and it is the only key here that is *about* the file
     rather than *in* it.
     Dropped from both sides so the comparison stays about the blocks. The stamp
     itself is not thereby untested — "stamps the blocks it exports" below
     asserts it positively, which is the half a normalisation like this would
     otherwise quietly delete. */
  if (artefact === "blocks.json" && value && typeof value === "object") {
    const { sanitizer: _ignored, ...rest } = value as Record<string, unknown>;
    return rest;
  }

  /* **`meta.json`'s two stage-1 fields, which a round trip through Postgres
     does not preserve and cannot.**

     `url` and `fetchedAt` are what stage 1 recorded, and `article_revisions`
     takes them from `raw.json`. `meta.json` has its own copies: `src/extract.ts`
     writes `fetchedAt: new Date()` on every run, so the filesystem's number is
     when *extraction* last happened, and the two are minutes apart across most
     of `data/`. An export therefore writes the fetch time where the original
     said the extraction time — and for an article with no manifest at all it
     writes neither, because there was no stage 1 to have recorded them.

     `db:import` hid this by writing `meta.fetchedAt` into
     `article_revisions.fetched_at`, which is the column `META_COLUMNS`
     deliberately does not let `extract` touch (src/store/artifacts-pg.ts).

     Dropped from both sides so the comparison stays about the extraction, and
     asserted positively by "exports the fetch time and the final URL from the
     manifest" below — which is the half a normalisation like this would
     otherwise quietly delete. */
  if (artefact === "meta.json" && value && typeof value === "object") {
    const { fetchedAt: _fetchedAt, url: _url, ...rest } = value as Record<string, unknown>;
    return rest;
  }

  const key = { "comments.json": "comments", "searches.json": "runs", "chat.json": "threads" }[
    artefact
  ];
  if (!key || !value || typeof value !== "object") return value;
  const raw = (value as Record<string, unknown>)[key];
  if (!Array.isArray(raw)) return value;
  /* A comment whose anchor is not a block id cannot exist in Postgres —
     `block_identities` has a format check and `comments.json` does not, and
     something wrote one on `data/writes` anchored to `zzzz00`. The importer
     skips it and says so, so it cannot come back, and dropping it from the
     original is the honest comparison rather than a lowered bar. Delete the
     corrupt row and this stops matching anything. */
  const list: unknown[] =
    key === "comments"
      ? raw.filter((c) => isSpideryarnId((c as { blockId?: string }).blockId ?? ""))
      : /* **A thread with no `kind` IS a chat**, by the definition both stores
           implement — `normaliseKind` in src/chat.ts on the way in, and
           `not null default 'chat'` on the column. So a `chat.json` written
           before review mode existed and an export of the same conversation
           differ by one key that means the same thing, and normalising it here
           is the honest comparison rather than a lowered bar.
           It is transitional: the filesystem store writes the field on the next
           update of any thread it loads, so these files converge on their own.
           The default itself is not thereby untested — tests/review-store.test.ts
           asserts it positively, which is the half a normalisation like this
           would otherwise quietly delete. */
        key === "threads"
        ? raw.map((t) => ({ kind: "chat", ...(t as Record<string, unknown>) }))
        : raw;
  const rank = (x: unknown) => {
    const o = x as { createdAt?: string; id?: string };
    return `${o.createdAt ?? ""}|${o.id ?? ""}`;
  };
  return {
    ...value,
    [key]: [...list].sort((a, b) => rank(a).localeCompare(rank(b))),
  };
}

/**
 * The raw document beside an article, whatever it is called, as bytes.
 *
 * Bytes rather than text on purpose: `raw.pdf` is not text, and a comparison
 * that decoded first would pass on two files that differ.
 */
async function readRawIfPresent(
  dir: string,
): Promise<{ file: string; bytes: Buffer } | undefined> {
  for (const file of ["raw.pdf", "raw.html"]) {
    try {
      return { file, bytes: await readFile(path.join(dir, file)) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return undefined;
}

async function readJsonIfPresent(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

let slugs: readonly string[] = [];
/** Articles in `data/` the publication gate refuses — see the scan below. */
const unpublishable: string[] = [];

/* The ten-second connect timeout and the warning both live in the helper. */
const { reachable } = await pgReady({
  suite: "tests/store-roundtrip.test.ts",
  tables: ["spideryarn.revision_blocks"],
});

if (reachable) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(path.join(ROOT, "data"), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    // `_` is the queue's; `test-` is another test file's fixture, created and
    // removed concurrently — see tests/store-parity.test.ts for the full note.
    if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith("test-")) {
      continue;
    }
    const files: string[] = await readdir(path.join(ROOT, "data", entry.name)).catch(
      () => [] as string[],
    );
    if (!files.includes("blocks.json") || !files.includes("tree.json")) continue;
    /* **An article that cannot be published cannot be exported**, and there is
       one in `data/`. `labels.json` is stage 4's output, and one written
       before it recorded a `sourceHash` gives the publication gate nothing to
       check the ToC against — so `publishRevision` refuses, correctly, and
       `exportArticle` then finds no current revision. `db:import` never met
       this because it wrote `hashBlocks(blocks)` into every step row whether
       or not the artefact could support the claim.

       Excluded by asking the question rather than by naming `constitution`,
       so a regenerated fixture rejoins the corpus on its own. What was
       excluded, and why, is asserted below. */
    /* **A missing `labels.json` is a different fact from a legacy one**, and
       collapsing them would report an accidental deletion as "predates
       sourceHash". An article with a tree and no labels file is broken and
       should fail loudly rather than be quietly dropped from the corpus, so
       it stays in and whatever reads it says so. GPT Sol, 2026-08-28. */
    if (!files.includes("labels.json")) {
      found.push(entry.name);
      continue;
    }
    const labels = (await readJsonIfPresent(
      path.join(ROOT, "data", entry.name, "labels.json"),
    )) as { sourceHash?: string } | undefined;
    if (!labels?.sourceHash) {
      unpublishable.push(entry.name);
      continue;
    }
    found.push(entry.name);
  }
  slugs = found;
}

const when = reachable ? describe : describe.skip;

let out = "";

when("a round trip through Postgres", () => {
  beforeAll(async () => {
    /* This suite loads every real article in `data/`, and so does
       tests/store-parity.test.ts. One at a time — see the helper for the
       interleaving that made parity fail on a green codebase. */
    await takeCorpusLock();
    /* **From nothing, the same as parity, and for the same reason.** Loading
       over a published revision means `beginDraftIn` carries its columns,
       blocks and step rows into the draft — so an artefact this path never
       wrote can be exported and compared and match, because it came from
       whatever loaded the article last time. The result was a round trip that
       looked complete and was measuring `db:import`. GPT Sol, 2026-08-28: the
       advisory lock stops two suites overlapping, and does nothing at all about
       contamination. */
    await forgetRevisions(slugs);
    out = await mkdtemp(path.join(tmpdir(), "spideryarn-rollback-"));
    for (const slug of slugs) {
      /* **The artefact half goes through the production write path**, and the
         reader's own state is seeded beside it. `db:import` did both in one
         call and is being deleted (docs/plans/delete-the-importer.md § C7);
         `ArtifactStore` owns artefacts and deliberately owns nothing a reader
         made, so the round trip's two claims are now made by two things.

         `createdAt` mirrors the filesystem's own rule for when an article
         arrived — `meta.fetchedAt` where stage 2 recorded one, the blocks
         file's mtime otherwise — because a draft minted today would date every
         exported directory today. */
      const meta = (await readJsonIfPresent(
        path.join(ROOT, "data", slug, "meta.json"),
      )) as { fetchedAt?: string } | undefined;
      const mtime = (await stat(path.join(ROOT, "data", slug, "blocks.json"))).mtime;
      const loaded = await loadArticleIntoPg(slug, {
        createdAt: meta?.fetchedAt ? new Date(meta.fetchedAt) : mtime,
      });
      /* Asserted here rather than in a test of its own, because everything
         below depends on it and a `beforeAll` that carried an article forward
         should stop the suite rather than colour eighty assertions. */
      if (loaded.basedOn !== null) {
        throw new Error(
          `${slug} was loaded on top of revision ${loaded.basedOn} — the round trip would be ` +
            "measuring whatever published that one. Something wrote it between the wipe above " +
            "and here; the corpus lock is meant to prevent exactly that.",
        );
      }
      await seedReaderStateFromFiles(slug);
      await exportArticle(slug, {
        dataRoot: path.join(out, "data"),
        // Inside the temp directory, explicitly. See ExportTarget.
        outputRoot: path.join(out, "output"),
      });
    }
  }, 300_000);

  afterAll(async () => {
    if (out) await rm(out, { recursive: true, force: true });
    await releaseCorpusLock();
    await closeDb();
  });

  it("has something to round-trip", () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  it("excluded only articles whose labels file predates sourceHash", async () => {
    /* The exclusion above is a filter, and a filter nobody checks is how a
       corpus quietly empties. Each excluded article has to have the one defect
       that justifies it. */
    for (const slug of unpublishable) {
      const labels = (await readJsonIfPresent(path.join(ROOT, "data", slug, "labels.json"))) as
        | { sourceHash?: string }
        | undefined;
      // The file must EXIST and lack the field. A deleted labels file is a
      // broken article, not a legacy one, and must not be excluded quietly.
      expect(labels, `${slug} was excluded but has no labels.json at all`).toBeDefined();
      expect(labels?.sourceHash, `${slug} was excluded but its labels file is stamped`).toBeUndefined();
    }
  });

  /**
   * **Does this suite actually exercise a review at all?**
   *
   * The chat.json comparison below is what would catch `kind` or `stance` going
   * missing from src/store/export.ts — the way `tools` once did, which that
   * file's own comment records. But it can only catch it if some article's
   * conversations include a review, and `data/` is gitignored working data that
   * varies per machine. On a laptop with none, every assertion below passes
   * while covering nothing, and nothing says so.
   *
   * So the coverage is asserted rather than assumed. A skip here is a *warning*,
   * not a pass: it is reported through the test name so somebody reading the
   * output can see the difference between "the round trip preserved a review"
   * and "there was no review to preserve". docs/reusable/silent-success.md.
   *
   * To create one: open an article in review mode and say something.
   */
  it("includes at least one review with a stance, or says it could not", async () => {
    let reviews = 0;
    let stances = 0;
    for (const slug of slugs) {
      const file = (await readJsonIfPresent(path.join(ROOT, "data", slug, "chat.json"))) as
        | { threads?: { kind?: string; messages?: { stance?: string }[] }[] }
        | undefined;
      for (const t of file?.threads ?? []) {
        if (t.kind !== "review") continue;
        reviews += 1;
        stances += (t.messages ?? []).filter((m) => m.stance).length;
      }
    }
    if (reviews === 0) {
      console.warn(
        "store-roundtrip: no review thread in data/ — kind/stance export is NOT covered by this run",
      );
      return;
    }
    expect(stances).toBeGreaterThan(0);
  });

  /**
   * **The reader's own "why you're reading this one", which nothing in `data/`
   * has — so nothing caught it going missing.**
   *
   * `ShelfState.purpose` is the per-article half of the reader profile
   * (docs/plans/reader-profile.md) and lives on `articles.purpose`, deliberately
   * off the revision so a re-extraction cannot undo it. `db:export` wrote four
   * of the five shelf columns and not that one, and decided *whether to write
   * the file at all* from the same four — so an article whose only shelf state
   * is a purpose exported no `shelf.json`, and one with other state exported a
   * file with the purpose quietly missing.
   *
   * It has no fixture because no `shelf.json` in `data/` carries one, which is
   * exactly why the round trip above cannot see it: every assertion in this file
   * compares against the corpus, and the corpus is silent about this field.
   * `db:import` did not import it either — that one goes with the importer.
   *
   * Both halves are checked here: the file is written for an article with
   * nothing else on its card, and the value comes back.
   */
  it("exports the reader's purpose, and writes a shelf file for it alone", async () => {
    const slug = slugs[0];
    if (!slug) throw new Error("no article to test with");
    const db = getDb();
    const mine = and(eq(articles.ownerId, currentOwnerId()), eq(articles.slug, slug));
    const purpose = "because I keep arguing about it and losing";
    const [before] = await db
      .select({
        archivedAt: articles.archivedAt,
        titleOverride: articles.titleOverride,
        opens: articles.opens,
        lastOpenedAt: articles.lastOpenedAt,
        purpose: articles.purpose,
      })
      .from(articles)
      .where(mine);
    if (!before) throw new Error(`${slug} is not in Postgres`);

    const dir = await mkdtemp(path.join(tmpdir(), "spideryarn-purpose-"));
    try {
      /* Nothing on the card but the purpose — the case that decided whether a
         file was written at all. */
      await db
        .update(articles)
        .set({ archivedAt: null, titleOverride: null, opens: 0, lastOpenedAt: null, purpose })
        .where(mine);
      await exportArticle(slug, {
        dataRoot: path.join(dir, "data"),
        outputRoot: path.join(dir, "output"),
      });
      const shelf = await readJsonIfPresent(path.join(dir, "data", slug, "shelf.json"));
      expect(shelf, "no shelf.json was written for an article whose only state is a purpose").toBeDefined();
      expect(shelf).toMatchObject({ purpose });
    } finally {
      await db.update(articles).set(before).where(mine);
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe.each(slugs)("%s", (slug) => {
    it.each(ARTEFACTS)("preserves %s exactly", async (artefact) => {
      const original = await readJsonIfPresent(path.join(ROOT, "data", slug, artefact));
      const returned = await readJsonIfPresent(path.join(out, "data", slug, artefact));

      if (original === undefined) {
        /* Absent must stay absent. An exporter that invents an empty
           `comments.json` where there was none would look harmless and would
           mean every article came back with a file the pipeline never wrote —
           and `stepIsDone` is an existence check, so an invented file makes a
           step report itself finished. */
        expect(returned).toBeUndefined();
        return;
      }

      expect(returned).toBeDefined();
      expect(sorted(canonical(artefact, returned))).toEqual(
        sorted(canonical(artefact, original)),
      );
    });

    /**
     * **The raw document, which `ARTEFACTS` above does not list** — and that
     * list calls itself "every artefact a round trip should preserve", so the
     * omission reads as a decision rather than as the gap it is. The
     * consequence is the alarming part: **losing the entire source document
     * passes this file today**, because nothing here ever looks at one. Found
     * by GPT Sol reviewing docs/plans/raw-bytes-in-storage.md, 2026-08-27.
     *
     * It is not the loss that is happening, though. It is worse and quieter:
     * `src/store/export.ts` writes `revision.rawBytes` to **`raw.html`
     * unconditionally**, so a PDF article round-trips to a file named
     * `raw.html` holding PDF bytes. The name is the only thing that says which
     * decoder to use, and it now says the wrong one.
     *
     * Bytes, not JSON, so this cannot join `it.each(ARTEFACTS)`.
     */
    it("exports the fetch time and the final URL from the manifest", async () => {
      /* The price of dropping those two keys above. Whatever the export writes
         has to be traceable to `raw.json`, and an article with no manifest has
         to come back with neither rather than with something invented. */
      const manifest = (await readJsonIfPresent(path.join(ROOT, "data", slug, "raw.json"))) as
        | { url?: string; fetchedAt: string }
        | undefined;
      const returned = (await readJsonIfPresent(path.join(out, "data", slug, "meta.json"))) as
        | { url?: string; fetchedAt?: string }
        | undefined;

      expect(returned).toBeDefined();
      expect(returned?.fetchedAt).toBe(manifest?.fetchedAt);
      expect(returned?.url).toBe(manifest?.url);
    });

    it("preserves the raw document under its own name", async () => {
      const original = await readRawIfPresent(path.join(ROOT, "data", slug));
      const returned = await readRawIfPresent(path.join(out, "data", slug));

      if (original === undefined) {
        expect(returned).toBeUndefined();
        return;
      }

      /* **A document with no manifest beside it does not survive the round
         trip, and saying so is the point.**

         The `raw` step's artefact *is* the manifest: `raw.json` names the object
         in the bucket by `storedSha256`, and that reference is what the
         revision stores. An article with a bare `raw.html` and no `raw.json` —
         `noema-mythology-of-conscious-ai` is one, hand-assembled before
         manifests — therefore copies no `fetch` step at all, and the export has
         no object to write.

         `db:import` read the bare file into `article_revisions.raw_bytes`, and
         C6 dropped that column, so this is a loss the migration makes rather
         than one it found. It is confined to legacy filesystem data: no path
         today writes a raw document without a manifest, and the two acquisition
         paths in src/pipeline.ts both call `storeRawSource` before writing one.

         Asserted rather than skipped, so the day something starts exporting it
         this goes red and somebody has to decide what happened. */
      const manifest = await readJsonIfPresent(path.join(ROOT, "data", slug, "raw.json"));
      if (manifest === undefined) {
        expect(returned, `${slug} has no raw.json, so nothing names its document`).toBeUndefined();
        return;
      }

      expect(returned).toBeDefined();
      /* The filename first, and separately, because it is the failure worth
         reading in the output: `raw.pdf` becoming `raw.html` is a different
         bug from the bytes changing, and asserting them together would report
         either as "buffers differ". */
      expect(returned?.file).toBe(original.file);
      expect(returned?.bytes.equals(original.bytes)).toBe(true);
    });

    /**
     * `raw.json` is stage 1's manifest — the kind, the two URLs, the content
     * type, the encoding, the byte count and the hash (src/fetch.ts). Nothing
     * else records any of it, so an export without it is a source document
     * whose provenance is gone: `src/store/import.ts` falls back to *"no
     * manifest means assume HTML"*, which is right for an article old enough to
     * predate manifests and wrong for one we exported ten seconds ago.
     *
     * Its own test rather than a line in `ARTEFACTS`, because a manifest that
     * comes back with a *different* `file` field than the file actually written
     * is the interesting failure, and the list above only knows about equality.
     */
    it("preserves the raw manifest", async () => {
      const original = (await readJsonIfPresent(
        path.join(ROOT, "data", slug, "raw.json"),
      )) as { file?: string } | undefined;
      const returned = (await readJsonIfPresent(
        path.join(out, "data", slug, "raw.json"),
      )) as { file?: string } | undefined;

      /* **Not "absent stays absent"**, which is the rule every JSON artefact
         above follows and the one this cannot. Nothing in Postgres records
         whether stage 1 wrote a manifest: `data/writes` has one and
         `data/constitution` does not, and both arrive as the same all-null
         columns. So an export that only wrote `raw.json` "when there was one"
         would be guessing, and would drop a real manifest as readily as it
         skipped an absent one.
         What it writes instead is a reconstruction that says so — see the
         `backfilled` assertion below — which is a shape this repo already has
         and `readRaw` already handles. The absence this test does still hold
         onto is the one that is knowable: no raw bytes, no manifest. */
      if (original === undefined && returned === undefined) return;

      expect(returned).toBeDefined();
      /* The manifest must name the file that is actually there. A manifest
         saying `raw.pdf` beside a `raw.html` is worse than no manifest, because
         every reader downstream believes it. */
      const beside = await readRawIfPresent(path.join(out, "data", slug));
      expect(returned?.file).toBe(beside?.file);
      /* Stamped, always. Without this the test above passes just as well for an
         export that rebuilt a manifest and presented it as stage 1's own — and
         a re-import would then take null provenance for measured fact. */
      expect((returned as { backfilled?: string }).backfilled).toEqual(
        expect.stringContaining("db:export"),
      );

      /* **The fields, not just the name.** Asserting the filename and the stamp
         leaves everything that matters untested: an export writing the wrong
         content type, the wrong encoding, the wrong hash or the wrong URLs
         passes both. GPT Sol, reviewing the fix, 2026-08-27.

         Compared against the original manifest, because every one of these has
         a column and therefore a round trip to survive. Where the original is
         itself a backfilled manifest its values are null, the importer stores
         null, and null coming back is the correct answer rather than a gap. */
      if (original === undefined) return;
      const both = returned as Record<string, unknown>;
      for (const field of ["contentType", "encoding", "sha256", "requestedUrl", "url"]) {
        expect(both[field] ?? null, `${slug}: ${field}`).toEqual(
          (original as Record<string, unknown>)[field] ?? null,
        );
      }

      /* `bytes` is not compared to the original — it is compared to the file,
         which is the stronger statement and the one a reader acts on. A
         manifest whose byte count disagrees with the document beside it is how
         a truncated write gets accepted downstream. */
      const beside2 = await readRawIfPresent(path.join(out, "data", slug));
      expect(both.bytes).toBe(beside2?.bytes.byteLength);
    });
  });

  it("stamps the blocks it exports", async () => {
    /* The other half of dropping `sanitizer` in `canonical`. An export that
       wrote the key away entirely would sail through the comparison above and
       leave every exported article looking like it predates the sanitiser — so
       the read seam would re-clean all of them on every load and warn about it
       forever (docs/project/security.md § The stamp was written to a file
       nobody reads, which is that mistake made once already). */
    const returned = (await readJsonIfPresent(
      path.join(out, "data", slugs[0] ?? "", "blocks.json"),
    )) as { sanitizer?: number } | undefined;

    expect(returned?.sanitizer).toBe(SANITIZER_VERSION);
  });

  it("puts the id-stamped HTML back in output/, not beside the article", async () => {
    // Stage 3 reads and writes ids into `output/<slug>.html`, NOT into
    // `data/<slug>/` — docs/plans/postgres-migration.md § Stage 3 recovers ids
    // from output/. Exporting it beside the article would put it somewhere
    // nothing reads, and the next `npm run blocks` would re-mint every id.
    const beside = await readJsonIfPresent(path.join(out, "data", slugs[0] ?? "", "stamped.html"));
    expect(beside).toBeUndefined();
  });
});

describe("naming the raw file on the way out", () => {
  /**
   * **Export must classify a document the same way stage 1 did.**
   *
   * The first fix for "every export was named `raw.html`" reached for
   * `looksLikePdf` (src/source.ts), which requires `%PDF-` at byte **zero**.
   * `sniffKind` (src/fetch.ts) deliberately does not: *"Real files sometimes
   * carry a little junk in front, so a header further in is still believed."*
   * So stage 1 accepts a PDF with a couple of stray bytes on the front, and the
   * export would have written that same file out as `raw.html` — the identical
   * bug, one layer along, and invisible because no fixture here has one.
   *
   * Two classifiers for one question is the shape to distrust. Found by GPT
   * Sol, reviewing the fix rather than the plan, 2026-08-27.
   */
  const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n");
  const withJunk = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a, ...PDF]);

  it("agrees with stage 1 about a PDF whose header is at byte zero", () => {
    expect(sniffKind(null, PDF)).toBe("pdf");
    expect(rawFileName(null, PDF)).toBe("raw.pdf");
  });

  it("agrees with stage 1 about a PDF with junk in front of the header", () => {
    expect(sniffKind(null, withJunk)).toBe("pdf");
    expect(rawFileName(null, withJunk)).toBe("raw.pdf");
  });

  it("does not call a page about PDFs a PDF", () => {
    /* sniffKind's own rule: a `%PDF-1.7` in the middle of something the server
       called HTML is text about PDFs, not a PDF. Export must inherit that too,
       which is the other half of using one classifier rather than two. */
    const page = new TextEncoder().encode("<!doctype html><p>the %PDF-1.7 header</p>");
    expect(rawFileName("text/html", page)).toBe("raw.html");
  });

  it("falls back to HTML when nothing can be told", () => {
    /* `sniffKind` returns null for bytes it cannot place. The file still has to
       be called something, and `raw.html` is what every article predating
       manifests already is. */
    expect(sniffKind(null, new TextEncoder().encode("just words"))).toBeNull();
    expect(rawFileName(null, new TextEncoder().encode("just words"))).toBe("raw.html");
  });
});
