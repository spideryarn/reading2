/**
 * Read one article's artefacts **off a fixture directory**, so that a test can
 * put it into Postgres without the filesystem store existing.
 *
 * ## What this is, and the thing it is deliberately not
 *
 * It is the **source** half of `copyArtefacts` and nothing else: `read` and
 * `stampFor`, over a committed `data/` + `output/` tree. The **destination**
 * stays `pgArtifactsIn`, so every byte a fixture puts into the database still
 * goes through the production write path — `beginStep` → `write` → `finishStep`,
 * inside the job's transaction.
 *
 * Both [`./load-article.ts`](load-article.ts) and
 * [`./scratch-article.ts`](scratch-article.ts) warn, at length, against
 * *"a second files → Postgres implementation, exercised only by tests and free
 * to drift"* — that is why `db:import` was deleted
 * (docs/plans/260827aa-delete-the-importer.md). **This is not that, and the
 * distinction is load-bearing rather than a form of words.** A second importer
 * would be a second *write* path into Postgres, free to write rows the real one
 * would not. This writes nothing. It is a reader of a fixed on-disk layout, and
 * the only path into the database is still the one production uses.
 *
 * ## Why it exists at all: one import in one helper
 *
 * Until 2026-09-05 `load-article.ts` built a `createFsArtifactStore` over the
 * fixture root and handed it to `copyArtefacts` as the source. Measured by
 * [`scripts/store-migration-witness.ts`](../../scripts/store-migration-witness.ts)
 * on 2026-09-04, **56 test files executed `createFsArtifactStore` and only 14
 * of them named it**: the other ~42 inherited it from that single line, through
 * `scratchArticleInPg`. It was the largest single thing keeping
 * `src/store/artifacts-fs.ts` alive at run time, and therefore the thing
 * standing between the plan and deleting ~3,900 lines of filesystem store —
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § D.
 *
 * ## `LAYOUT` below is a copy that is about to become the original
 *
 * The `(step, kind) → path` table is `PATHS` in
 * [`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts), and while both
 * files exist the fact is written down twice. **That is a scheduled overlap, not
 * a duplication we are living with**: stage G of the same plan deletes
 * `artifacts-fs.ts`, and this table is then the only place that says where a
 * fixture article's files are. Whoever arrives during the overlap should edit
 * `PATHS` for anything about the *pipeline's* on-disk layout and this table for
 * anything about the *fixture corpus*, and expect the first of the two to
 * vanish.
 *
 * **Seventeen of this table's eighteen rows are guarded by nine test files, and
 * the eighteenth is guarded by nothing.** Those nine assert on
 * `LoadedArticle.copied` — the exact set of steps the loader reported copying —
 * so a path this table got wrong makes a step's artefacts unreadable, shortens
 * `copied`, and reddens them by name: `chat-library-exclusion`, `chat-route`,
 * `comment-referee-mark`, `helpers-load-article`, `referee-routes-postgres`,
 * `remember-route`, `routes`, `store-block-roles-pg`, `store-parity`. See
 * `LoadedArticle.copied` in `./load-article.ts` for why that return value exists.
 *
 * **But an assertion can only reach a row the corpus populates**, and that is a
 * narrower claim than the one this paragraph made until the cross-family review
 * read it. Measured across all five corpus articles, 2026-09-05: seventeen rows
 * are populated by at least one of them — `fetch/raw` by 2, `assets`, `quotes`,
 * `timeline`, `quiz` and `sketch` by 1 each, the rest by 3 to 5 —
 * and **`illustrated/illustrated` by none**
 * (`find tests/fixtures/data-root/data -name illustrated.json` finds nothing).
 * So a wrong `LAYOUT.illustrated.illustrated` is invisible to every one of the
 * nine, and would surface only when somebody first loads an illustrated fixture.
 *
 * **Two ways to close it, neither built, both with a real cost.** An
 * `illustrated.json` in the committed corpus would close it the way the other
 * seventeen are closed, and costs a real artefact plus its plate images in the
 * blob store. A synthetic parity assertion — for every `(step, kind)`, this
 * table and `PATHS` produce the same path — would be exact and cheap, but it
 * makes whichever file holds it *call into `artifacts-fs`*, which adds an entry
 * to the migration registry and a file to stage G's cohort at the moment the
 * stage is removing them. Worth doing if `illustrated` gains a second reader
 * before stage G lands; not worth it for one row that is about to be the only
 * definition anyway.
 *
 * **Nine, not the twelve the plan lists**, re-counted 2026-09-05: that list
 * carries `corpus-materialise`, whose `copied` is a different function's
 * (`["data/", "output/"]`), `hierarchy-structure-eval`, which asserts on
 * `copiedHeadings`, and `scratch-article.ts` itself, which passes the value
 * through as `ScratchArticle.copied` rather than asserting on it. Three false
 * positives from grepping a common word, and the correction is here rather than
 * only in the plan because this is the file the claim is about.
 *
 * ## It is louder than the filesystem store was, on purpose
 *
 * `createFsArtifactStore` answers `null` for an artefact it cannot parse, and
 * that is right for the pipeline: a corrupt file means *run the step again*, and
 * the step rewrites it. There is no step to re-run here. A fixture file that
 * will not parse, or that is the wrong shape, is a **broken corpus**, and the
 * quiet answer would drop the step out of `copied` and fail three assertions
 * later in whatever suite happened to need it. So this throws, naming the file.
 * Absent stays absent: most steps legitimately have no artefact —
 * `data/constitution` has no `raw.json` at all.
 */
import { open } from "node:fs/promises";
import path from "node:path";

import { STAMP_SOURCE, stampOf, whyUnusable } from "../../src/store/artifacts.js";
import type {
  ArtifactKind,
  ArtifactMap,
  ArtifactSource,
  StepStamp,
} from "../../src/store/artifacts.js";
import type { StepName } from "../../src/types.js";

/**
 * The two places one fixture article's files live.
 *
 * `ArtifactLocations` in `src/store/artifacts-fs.ts` is the same shape and dies
 * with it; this is declared here so that nothing in `tests/helpers/` imports a
 * condemned module for a type.
 */
interface FixtureLocations {
  /** `<root>/data/<slug>` — where the durable artefacts live. */
  readonly dir: string;
  /** `<root>/output/<slug>.html` — stage 2's page, with stage 3's ids in it. */
  readonly htmlFile: string;
}

/**
 * Where one article's files are, under a fixture root.
 *
 * **The root is always passed in, never derived.** `fsLocations` calls
 * `dataRoot()`, and `dataRoot()` on a laptop is the *repository* root — the
 * working `data/` a reader has been reading out of, not the committed corpus a
 * suite is supposed to be testing against. Every "the suite is green against the
 * corpus" claim was once a claim about one laptop's `data/`;
 * docs/plans/260901b-committed-fixture-corpus.md is that story.
 */
function fixtureLocations(root: string, slug: string): FixtureLocations {
  return {
    dir: path.join(root, "data", slug),
    htmlFile: path.join(root, "output", `${slug}.html`),
  };
}

/**
 * Where each `(step, kind)` is on disk. **The one place, after stage G.**
 *
 * Keyed by step and then by kind, because two kinds share a path and one kind
 * has two paths. `blocks` appearing under both `blocks` and `hierarchy` is not a
 * mistake: stage 3 writes `output/<slug>.blocks.json` and stage 4 writes
 * `data/<slug>/blocks.json`, and `copyArtefacts` carries both. `extractedHtml`
 * and `stampedHtml` are one file for the same reason — stage 3 overwrites stage
 * 2's page in place. `./load-article.ts` § *`extractedHtml` is still stage 3's
 * HTML* records what that costs and why nothing is done about it.
 */
const LAYOUT: {
  [S in StepName]: Partial<Record<ArtifactKind, (at: FixtureLocations) => string>>;
} = {
  fetch: { raw: (at) => path.join(at.dir, "raw.json") },
  extract: {
    extractedHtml: (at) => at.htmlFile,
    meta: (at) => path.join(at.dir, "meta.json"),
  },
  blocks: {
    blocks: (at) => at.htmlFile.replace(/\.html$/, ".blocks.json"),
    stampedHtml: (at) => at.htmlFile,
  },
  hierarchy: {
    tree: (at) => path.join(at.dir, "tree.json"),
    labels: (at) => path.join(at.dir, "labels.json"),
    blocks: (at) => path.join(at.dir, "blocks.json"),
  },
  assets: { assets: (at) => path.join(at.dir, "assets.json") },
  arc: { arc: (at) => path.join(at.dir, "arc.json") },
  tweets: { tweets: (at) => path.join(at.dir, "tweets.json") },
  glossary: { glossary: (at) => path.join(at.dir, "glossary.json") },
  ideas: { ideas: (at) => path.join(at.dir, "ideas.json") },
  quotes: { quotes: (at) => path.join(at.dir, "quotes.json") },
  timeline: { timeline: (at) => path.join(at.dir, "timeline.json") },
  quiz: { quiz: (at) => path.join(at.dir, "quiz.json") },
  sketch: { sketch: (at) => path.join(at.dir, "sketch.json") },
  illustrated: { illustrated: (at) => path.join(at.dir, "illustrated.json") },
  debate: { debate: (at) => path.join(at.dir, "debate.json") },
};

/** The two kinds that are text on disk rather than JSON. */
function isText(kind: ArtifactKind): boolean {
  return kind === "extractedHtml" || kind === "stampedHtml";
}

/**
 * **The largest fixture this reader will read: 4 MiB, one number for every
 * kind.** Over it is a throw, never a skip.
 *
 * ## Why there is a bound here at all
 *
 * Because the store this replaced had one, and without it the replacement
 * **copies an artefact the old source refused**. Reproduced 2026-09-05 against a
 * fixture whose shared `output/<slug>.html` was 33 MiB: the filesystem store
 * returned `null` for `extract/extractedHtml` and `blocks/stampedHtml`, so
 * `copyArtefacts` refused both steps as half-present and copied `["hierarchy"]`;
 * this reader handed back all 34,603,015 characters and copied
 * `["extract", "blocks", "hierarchy"]`. That is the equivalence this whole stage
 * rests on, broken. Found by the stage's cross-family review, and **the
 * five-corpus-article probe could not have caught it** — every fixture in the
 * corpus is under 154 KB, so nothing in it is near any ceiling.
 *
 * ## Why one number rather than `DECODERS`' seventeen
 *
 * `DECODERS` in [artifacts-fs.ts](../../src/store/artifacts-fs.ts) gives each
 * kind its own 4, 16 or 32 MiB, and copying that table here was the review's
 * suggested fix. It is the wrong shape for this file, for a reason worth stating
 * rather than a preference:
 *
 * **the per-kind spread exists to keep a two-sided contract, and this file has
 * only one side.** There, `write` refuses what `read` could not read back — the
 * failure being avoided is a step that writes a perfectly good artefact, reports
 * success, and is then permanently not-done because nothing can read it again.
 * A *reader over a committed fixture* has no write side and no step to re-run,
 * so there is no contract to keep consistent. What survives is a single
 * requirement: **this source must not accept what the old one refused.**
 *
 * ## Why the tightest of the old values and not the loosest
 *
 * A single bound at 32 MiB — the table's maximum — would leave a 4-to-32 MiB
 * window for `raw`, `meta`, `assets`, `sketch` and `illustrated` in which this
 * reader accepts a fixture the filesystem store refused. That is the finding
 * above, narrower and still silent. A bound at the **minimum** makes that window
 * empty by construction, which is the only property that has to hold.
 *
 * What it costs is real and is the other direction: a fixture between 4 and
 * 32 MiB of a kind whose old ceiling was higher is refused here where the old
 * store accepted it. That refusal is **loud, names the file and both numbers,
 * and is one constant to change** — where the failure it replaces is silent. The
 * corpus's largest file today is 154 KB (`noema-…/blocks.json`, measured
 * 2026-09-05), so the headroom is about 27×.
 *
 * **This is not the pipeline's ceiling and must not be read as one.** The
 * adapter's own table is still the adapter's, and the one test whose subject is
 * that table — `blocks-baseline.test.ts` § *refuses when stage 4's copy is over
 * the size this store can read* — reads `DECODERS` through the real store rather
 * than anything here. That is why that file was left unconverted.
 */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * One artefact off the disk, or `null` when the fixture does not have it.
 *
 * Absent is an answer; anything else is a throw. See the header for why this is
 * stricter than the store it replaces.
 */
async function readArtefact(
  at: FixtureLocations,
  step: StepName,
  kind: ArtifactKind,
): Promise<unknown | null> {
  const where = LAYOUT[step][kind];
  if (!where) throw new Error(`${step} does not produce ${kind}`);
  const file = where(at);

  /* **One handle for the size and the bytes**, so the two describe the same
     inode — `stat` then `readFile` is two lookups of a name, and `mutate` in
     ./scratch-article.ts rewrites a fixture immediately before it is read. The
     filesystem store opens this way for the same reason; it is the pattern that
     is worth copying, not the table. */
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(file, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  let body: string;
  try {
    const { size } = await handle.stat();
    /* **Refused before the bytes are read, and refused loudly.** The store this
       replaced answered `null` here, which drops the step out of `copied` and
       fails somewhere else entirely; see `MAX_BYTES` for why that answer is
       wrong for a fixture and why this bound is the number it is. */
    if (size > MAX_BYTES) {
      throw new Error(
        `the fixture at ${file} is ${size} bytes, over this reader's ${MAX_BYTES}-byte ceiling. ` +
          "A fixture is committed, so either it is not the file somebody meant to commit, or the " +
          "ceiling in tests/helpers/fixture-artefacts.ts needs raising — that constant's docstring " +
          "says what it is protecting and why it is one number rather than one per kind.",
      );
    }
    body = await handle.readFile("utf8");
    /* **And again on what actually came back**, because the check above is a
       promise about a `stat`, not about the read. One handle means `stat` and
       `readFile` address the same inode; it does not stop that inode *growing*
       between the two calls, so an in-place rewrite could still hand back more
       than the bound. Not reachable today — `scratchArticleInPg` awaits `mutate`
       and its rewrites before the source is built, and nothing writes to the
       committed corpus while a suite reads it — which is why this is the second
       check rather than the only one. **Both are kept on purpose**: the
       pre-check is what stops a huge file being read into memory at all, and
       this is what makes the ceiling true rather than likely. */
    const bytes = Buffer.byteLength(body, "utf8");
    if (bytes > MAX_BYTES) {
      throw new Error(
        `the fixture at ${file} read back ${bytes} bytes, over this reader's ${MAX_BYTES}-byte ` +
          "ceiling, having stat'd smaller a moment earlier — something is writing to it while " +
          "this reads. See MAX_BYTES in tests/helpers/fixture-artefacts.ts.",
      );
    }
  } finally {
    await handle.close();
  }

  let value: unknown;
  if (isText(kind)) {
    value = body;
  } else {
    try {
      value = JSON.parse(body);
    } catch (err) {
      /* The parse error, not the text. V8 puts the first characters of the
         input into a `SyntaxError` message, and an artefact is article prose —
         docs/project/logging.md forbids that outright. `(err as Error).message`
         can carry a fragment of it, so it is deliberately not included; the
         path is what tells somebody which file to look at. */
      throw new Error(
        `the fixture at ${file} is not valid JSON (${(err as Error).name}). ` +
          "Most likely truncated, or a half-written copy. Rebuild the corpus: " +
          "npx tsx tests/fixtures/data-root/build-corpus.ts",
      );
    }
  }

  /* The same shape rules the real stores apply, from the same table — so a
     fixture that would be refused on the way into Postgres is refused here
     rather than three assertions later. */
  const why = whyUnusable(kind, value);
  if (why) {
    throw new Error(
      `the fixture at ${file} is not a usable ${kind}: ${why}. ` +
        "A fixture is committed, so this is a broken corpus rather than a step to re-run.",
    );
  }
  return value;
}

/**
 * A read-only artefact source over the fixture tree at `root`.
 *
 * `root` is a directory with `data/` and `output/` under it: the committed
 * corpus (`FIXTURE_ROOT` in `./require-fixture.ts`), or a scratch clone of one
 * article from it (`./scratch-article.ts`).
 *
 * **`ArtifactSource`, which is two methods** — `read` and `stampFor`, everything
 * `copyArtefacts` asks of the store it copies *from* (src/store/artifacts.ts).
 * Declared there rather than here so that there is one name for it: this reader
 * and the real adapters are the same kind of thing to the copy, and two spellings
 * of one type is how they stop being.
 */
export function fixtureArtefacts(root: string): ArtifactSource {
  return {
    async read<K extends ArtifactKind>(
      slug: string,
      step: StepName,
      kind: K,
    ): Promise<ArtifactMap[K] | null> {
      const value = await readArtefact(fixtureLocations(root, slug), step, kind);
      return value as ArtifactMap[K] | null;
    },

    /**
     * What the fixture records about this step's last run.
     *
     * The stamp lives *inside* the artefact on disk — `sourceHash`, `version`,
     * `generator` — which is why this reads the artefact rather than a separate
     * record, exactly as the filesystem store did. A step whose `STAMP_SOURCE`
     * row is `null` stamps nothing and answers `null`; so does a step whose
     * artefact is not there.
     */
    async stampFor(slug: string, step: StepName): Promise<StepStamp | null> {
      const kind = STAMP_SOURCE[step];
      if (!kind) return null;
      const artefact = await readArtefact(fixtureLocations(root, slug), step, kind);
      if (artefact === null) return null;
      return stampOf(artefact);
    },
  };
}
