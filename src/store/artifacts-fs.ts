/**
 * The artefact store, backed by the filesystem — the layout the stages already
 * write, behind the interface they will write through.
 *
 * Nothing on disk changes. `data/<slug>/tree.json` is still
 * `data/<slug>/tree.json`; what changes is that **this file is the only place
 * that says so**. Today the same knowledge is spelt out in eight `outputs`
 * closures in src/pipeline.ts, again inside each stage module's own
 * `writeFile`, and a third time as `STEP_STORAGE` in src/store/pg.ts. Three
 * copies of one fact, free to drift, and drift is invisible until an artefact
 * quietly isn't where something looked.
 *
 * See docs/project/database.md for the layout itself and
 * docs/plans/260826e-postgres-storage-implementation.md § Step 11 for why the seam is
 * shaped this way.
 *
 * ## The two things that are easy to get wrong here
 *
 * **`has` parses; it does not `stat`.** A plain `writeFile` killed halfway
 * leaves a file that exists and will not parse. Under an existence check the
 * step reports itself done, the pipeline skips it, and the stage after it
 * reads half a JSON document. That is the exact shape of
 * docs/reusable/silent-success.md, and parsing is what fixes it. It is not
 * free and it is not expensive: a review measured 0.381 ms to parse a 354 KB
 * `blocks.json`.
 *
 * **Paths are keyed by `(step, kind)`.** `blocks` lands in two places —
 * `output/<slug>.blocks.json` from stage 3 and `data/<slug>/blocks.json` from
 * stage 4 — and the HTML is written twice, by `extract` and again by `blocks`
 * with the ids stamped in. A `Record<ArtifactKind, path>` cannot express
 * either. See the note in src/store/artifacts.ts.
 */
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { readRawBytes } from "../fetch.js";
import { mintId } from "../ids.js";
import { log } from "../log.js";
import { parseJsonFrom } from "../parse-json.js";
import type { StepName } from "../types.js";
import { dataRoot } from "./data-root.js";
import {
  STAMP_SOURCE,
  assertStampAgrees,
  stampOf,
  whyUnusable,
  whyUnusableAsBaseline,
} from "./artifacts.js";
import type {
  ArtifactKind,
  ArtifactMap,
  ArtifactOutcome,
  ArtifactParts,
  ArtifactStore,
} from "./artifacts.js";
import type { SourceStore } from "./contracts.js";

/* `"store"` because that is what this is — src/log.ts keeps the component list
   closed on purpose, and every line here carries `step` and `kind` besides. */
const alog = log("store");

/** The two directories one article's artefacts are split across. */
export interface ArtifactLocations {
  /** `data/<slug>` — where the durable artefacts live. */
  dir: string;
  /** `output/<slug>.html` — the debug page, and what stage 3 writes ids into. */
  htmlFile: string;
}

/**
 * Where an article's files are, by slug.
 *
 * The definition `contextPaths` in src/pipeline.ts delegates to, rather than a
 * second copy of it. It lives down here because the store is the layer that is
 * allowed to know about paths at all, and because a pipeline that imports the
 * store must not also be the thing the store imports.
 *
 * **`dataRoot()` is called here, on every call, and must not be hoisted into a
 * module-level `const`.** It used to be one —
 * `path.resolve(import.meta.dirname, "..", "..")` — which is the repository
 * root from `src/store/` and `/var` from the bundle this file ends up in, so
 * every deployed import failed at step 1 with `mkdir '/var/data'`. Deployed,
 * the answer also depends on which job is running, and that is not knowable at
 * import. src/store/data-root.ts has the whole argument.
 */
export function fsLocations(slug: string): ArtifactLocations {
  const root = dataRoot();
  return {
    dir: path.join(root, "data", slug),
    htmlFile: path.join(root, "output", `${slug}.html`),
  };
}

/**
 * Every path this project writes a pipeline artefact to. **The one place.**
 *
 * Keyed by step and then by kind, because two kinds share a path and one kind
 * has two paths — see the header. Read it as: *when `hierarchy` produces `blocks`, it
 * goes here*.
 *
 * `blocks` appearing under both `blocks` and `hierarchy` is not a mistake and must
 * not be tidied away. Stage 3's copy is the one stage 3 checks, so that a
 * `{ steps: ["blocks"] }` job can skip itself without `hierarchy` having run; stage
 * 4's copy is the one the later stages read, so that the tree and the blocks it
 * was built from are guaranteed to be a pair. Removing either breaks something
 * that is currently right.
 */
export const PATHS: {
  [S in StepName]: Partial<Record<ArtifactKind, (at: ArtifactLocations) => string>>;
} = {
  fetch: {
    /**
     * **The manifest, and the bytes are named inside it.**
     *
     * Not `raw.html`, since 2026-08-26. Stage 1 can fetch a web page or a PDF,
     * so the file holding the bytes is `raw.html` or `raw.pdf` and its name is
     * not knowable until the fetch has happened — which makes it useless as the
     * answer to "is this step done?". `raw.json` is written after every fetch,
     * says which kind arrived and which file holds it, and carries the final
     * URL, content type, encoding, byte count and hash that the pipeline used
     * to throw away.
     *
     * That is also closer to what Postgres will do, not further from it: there
     * the fetched document is one row — `raw_bytes`, `raw_content_type`,
     * `raw_encoding`, `requested_url`, `final_url` — and this is that row.
     */
    raw: (at) => path.join(at.dir, "raw.json"),
  },
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
  /* Beside the article, not in a folder of its own: the bytes are
     content-addressed objects in the `sources` bucket and this is only the list
     saying which of them belong here. docs/plans/260829b-hosting-the-articles-images.md. */
  assets: {
    assets: (at) => path.join(at.dir, "assets.json"),
  },
  arc: {
    arc: (at) => path.join(at.dir, "arc.json"),
  },
  tweets: {
    tweets: (at) => path.join(at.dir, "tweets.json"),
  },
  glossary: {
    glossary: (at) => path.join(at.dir, "glossary.json"),
  },
  ideas: {
    ideas: (at) => path.join(at.dir, "ideas.json"),
  },
  quotes: {
    quotes: (at) => path.join(at.dir, "quotes.json"),
  },
  timeline: {
    timeline: (at) => path.join(at.dir, "timeline.json"),
  },
  quiz: {
    quiz: (at) => path.join(at.dir, "quiz.json"),
  },
  sketch: {
    sketch: (at) => path.join(at.dir, "sketch.json"),
  },
};


/**
 * How to turn bytes back into an artefact, per kind, with a ceiling.
 *
 * A blanket `JSON.parse` would be wrong three times over: `raw`,
 * `extractedHtml` and `stampedHtml` are not JSON at all, and a decoder that
 * throws on them would report every fetched page unreadable. So each kind says
 * how big it is allowed to be and how to read it.
 *
 * **The shape checks are shallow on purpose.** `has` runs on every skip check
 * of every step of every job, and validating a 360-entry glossary against a
 * full schema on each one buys precision nobody asked for. What it has to
 * catch is the half-written file, and a truncated JSON document fails at the
 * parse, before any field is looked at. The field check on top of it catches
 * the other cheap case: valid JSON of the wrong shape entirely.
 *
 * **The text kinds can only be checked for emptiness, and that is a real
 * limit.** Truncated HTML is still valid text; nothing about the bytes says
 * so. Atomic writes are what protect those, not this.
 */
const MiB = 1024 * 1024;

interface Decoder {
  maxBytes: number;
  decode(text: string): unknown;
}

/**
 * Bytes to artefact, checked against the **shared** rules in artifacts.ts.
 *
 * The shape rules used to live here, and moving them was not tidying: the
 * Postgres adapter has to apply the same ones to a JSONB column or its parity
 * claim is a claim about two lists that happen to agree today. `whyUnusable`
 * is now the single table — src/store/artifacts.ts § SHAPE.
 *
 * What stays here is the half that is genuinely about files: the parse.
 *
 * **`parseJsonFrom`, not `JSON.parse`**, and the difference is a privacy rule
 * rather than a nicety. V8 puts the first characters of the offending input
 * into the `SyntaxError` message — `Unexpected token 'S', "SECRET art"... is
 * not valid JSON` — and the caller below logs that message. The text being
 * parsed here is an article's own artefact, so a truncated one would have put
 * article prose into a log line, which docs/project/logging.md forbids
 * outright. `parseJsonFrom` says how it broke (empty, cut off, breaks at
 * position N of M characters) without saying what it said. Found by review
 * 2026-08-26; this was the one JSON boundary in the repo still doing it by
 * hand.
 */
function json(kind: ArtifactKind): Decoder["decode"] {
  return (text) => {
    // The `source` string is copied into the error as given, so it must carry
    // nothing about the content — see parseJsonFrom's header.
    const parsed: unknown = parseJsonFrom<unknown>(text, "an artefact");
    const why = whyUnusable(kind, parsed);
    if (why) throw new Error(why);
    return parsed;
  };
}

/** Text kinds never get parsed; the shared check is the whole of it. */
function plain(kind: ArtifactKind): Decoder["decode"] {
  return (body) => {
    const why = whyUnusable(kind, body);
    if (why) throw new Error(why);
    return body;
  };
}

const DECODERS: Record<ArtifactKind, Decoder> = {
  /* 32 MiB is src/fetch.ts's own ceiling on a page, so anything bigger did not
     come from us. */
  raw: { maxBytes: 4 * MiB, decode: json("raw") },
  extractedHtml: { maxBytes: 32 * MiB, decode: plain("extractedHtml") },
  stampedHtml: { maxBytes: 32 * MiB, decode: plain("stampedHtml") },
  meta: { maxBytes: 4 * MiB, decode: json("meta") },
  blocks: { maxBytes: 32 * MiB, decode: json("blocks") },
  tree: { maxBytes: 32 * MiB, decode: json("tree") },
  labels: { maxBytes: 32 * MiB, decode: json("labels") },
  /* Two hundred entries at most (`MAX_IMAGES` in src/collect-assets.ts), each a
     URL and five short fields — tens of kilobytes in practice. The ceiling is a
     guard against a corrupt or hostile file, not an estimate. */
  assets: { maxBytes: 4 * MiB, decode: json("assets") },
  arc: { maxBytes: 16 * MiB, decode: json("arc") },
  tweets: { maxBytes: 16 * MiB, decode: json("tweets") },
  glossary: { maxBytes: 32 * MiB, decode: json("glossary") },
  /* Four scenes of coordinates and short strings — the largest drawn so far is
     46KB. The ceiling is a guard against a corrupt file, not an estimate, and
     it is well under the others because a picture that needs a megabyte of
     geometry is not a picture anybody can read. */
  sketch: { maxBytes: 4 * MiB, decode: json("sketch") },
  /* Far smaller than a glossary in practice — three to ten ideas rather than a
     hundred terms — but the same ceiling, because the cap is a guard against a
     corrupt or hostile file rather than a size estimate. */
  ideas: { maxBytes: 32 * MiB, decode: json("ideas") },
  /* At most sixteen quotes of at most 400 characters each, so a real one is a
     few KB — but the same ceiling as its neighbours, because the cap is a
     guard against a corrupt or hostile file rather than a size estimate. */
  quotes: { maxBytes: 32 * MiB, decode: json("quotes") },
  /* Forty events at most (`MAX_EVENTS` in src/timeline.ts), each a short label,
     an interval and up to six quoted passages — the real one on the test
     article is 40KB. The same ceiling as its neighbours all the same, because
     the cap is a guard against a corrupt or hostile file rather than a size
     estimate. */
  timeline: { maxBytes: 32 * MiB, decode: json("timeline") },
  /* Twelve questions at most (`MAX_QUESTIONS` in src/quiz.ts), each a sentence,
     a two-or-three-sentence reference answer and up to three quoted passages —
     a real one is a few tens of KB. The same ceiling as its neighbours all the
     same, because the cap is a guard against a corrupt or hostile file rather
     than a size estimate. */
  quiz: { maxBytes: 32 * MiB, decode: json("quiz") },
};

/** The path for one `(step, kind)`, or a clear error rather than `undefined`. */
export function pathFor(at: ArtifactLocations, step: StepName, kind: ArtifactKind): string {
  const where = PATHS[step]?.[kind];
  if (!where) throw new Error(`${step} does not produce ${kind}`);
  return where(at);
}

/**
 * What a read found, with **"there is no file" kept apart from "there is a file
 * I cannot use"**.
 *
 * `readOne` below flattens the two into `null`, which is right for every caller
 * that is deciding whether to re-run a step: both answers mean *do the work
 * again*, and the work rewrites the file either way.
 *
 * Three callers need them apart. `hasEarlierBlocks` is asking whether this
 * article has an identity from an earlier run, and a corrupt
 * `data/<slug>/blocks.json` says **yes, and I cannot read it** — which has to
 * stop the run. Flattened to `null` it said *no earlier run*, and stage 3 minted
 * a fresh identity set over an article that already had one, quietly. GPT Sol,
 * 2026-08-28. `readBaseline` is the other two: the glossary and the ideas
 * inherit their entry ids from their own previous artefact, and a truncated one
 * still holds every id a reader's `?term=` or `?idea=` link names.
 *
 * **The type is `ArtifactOutcome` in src/store/artifacts.ts**, not a local one,
 * because the Postgres adapter has to answer the same three-state question and
 * two copies of an enum drift.
 */
type ReadOutcome = ArtifactOutcome<unknown>;

/**
 * Read one artefact, saying which of the three things happened.
 *
 * **Absent, over the ceiling and unreadable are answers; broken is thrown.**
 * That line moved on 2026-08-26 and the old place was wrong: any `stat` failure
 * became a silent `null`, so a permissions error, a failing disk and a file
 * nobody has written yet were one answer. The step then reported not-done and
 * the pipeline paid for a model call to fix a problem no model call can fix —
 * and the metadata page fell through to the `example/` fixture for an article
 * that was there all along. Only `ENOENT` means absent. Everything else
 * propagates, because this project's rule is that a swallowed error is worse
 * than a loud one (docs/reusable/silent-success.md).
 *
 * Corruption is different again, and is `unusable` rather than an error: a file
 * that will not parse is a real state of the world that the next run genuinely
 * does fix by rewriting it. It is logged at `debug` — a missing or half-written
 * artefact is the ordinary state of an article nobody has finished ingesting.
 *
 * **One file handle for the size and the bytes**, so the two describe the same
 * inode. `stat` then `readFile` is two lookups of a name, and an atomic
 * replacement in between meant the ceiling was checked against a file that is
 * no longer the file being read.
 */
async function readOutcome(
  at: ArtifactLocations,
  slug: string,
  step: StepName,
  kind: ArtifactKind,
): Promise<ReadOutcome> {
  const file = pathFor(at, step, kind);
  const { maxBytes, decode } = DECODERS[kind];

  let handle: FileHandle;
  try {
    handle = await open(file, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { state: "absent" };
    throw err;
  }

  try {
    const { size } = await handle.stat();
    if (size > maxBytes) {
      /* Warn rather than debug: this one does not resolve itself. `has` will
         keep answering not-done, so the step re-runs every job, for ever, and
         the only visible symptom is a stage that will not stay finished. */
      alog.warn(
        { slug, step, kind, size, maxBytes },
        `artefact over its ceiling: ${kind} for ${slug} is ${size} bytes`,
      );
      return { state: "unusable" };
    }
    const body = await handle.readFile("utf-8");
    try {
      return { state: "ok", value: decode(body) };
    } catch (err) {
      alog.debug(
        { slug, step, kind, size, err: (err as Error).message },
        `artefact unreadable: ${kind} for ${slug}`,
      );
      return { state: "unusable" };
    }
  } finally {
    await handle.close();
  }
}

/**
 * The same read, flattened to *the artefact or nothing* — what every caller
 * wants except `hasEarlierBlocks`. See `ReadOutcome` for why that one is
 * different.
 */
async function readOne(
  at: ArtifactLocations,
  slug: string,
  step: StepName,
  kind: ArtifactKind,
): Promise<unknown | null> {
  const outcome = await readOutcome(at, slug, step, kind);
  return outcome.state === "ok" ? outcome.value : null;
}

/**
 * Write, then move into place.
 *
 * The same recipe as `writeAtomic` in src/hierarchy.ts and src/labels.ts, which is
 * where it was written first — copied rather than reinvented, and the reason
 * this file exists is so it stops being copied a third time. `rename` within a
 * directory is atomic on every filesystem we care about, so a reader sees
 * either the old file or the whole new one and never a half of either.
 *
 * The pid in the temp name keeps two processes writing the same article from
 * fighting over one temp file. It does not make the *pair* of files `extract`
 * writes atomic, and nothing on a filesystem can: a kill between two renames
 * leaves one artefact. `has` requiring all of a step's kinds is what turns that
 * into an honest not-done.
 */
async function writeAtomic(file: string, body: string): Promise<void> {
  /* **The directory, first.** `write` had no production caller until landing D
     of docs/plans/260827j-transactional-stage-runner.md, and every stage `mkdir`s for
     itself before its own `writeFile` — src/fetch.ts and src/extract.ts both do.
     So the one method that has to own this is the one that never had to prove
     it could, and writing the first artefact of a new article through the seam
     failed with ENOENT on the temp file.

     `beginStep` has always done it, twenty lines down. That asymmetry is the
     whole bug: the method with a caller learned, the method without one did
     not. Found by tests/artefact-copy.test.ts, 2026-08-27. */
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, body, "utf-8");
  await rename(tmp, file);
}

/** JSON gets two-space indent and a trailing newline; text goes as it is. */
function serialise(kind: ArtifactKind, value: unknown): string {
  if (kind === "extractedHtml" || kind === "stampedHtml") {
    return value as string;
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}


/**
 * Where the "this step started" markers live: `data/<slug>/steps/<step>.running`.
 *
 * A directory of one file per step rather than one file listing them all,
 * because the alternative is read-modify-write and this has to stay correct
 * once two processes can be advancing the same article — which is exactly what
 * the browser-driven advance endpoint makes possible
 * (docs/plans/260826q-job-queue-rethink.md).
 *
 * Under `data/<slug>/` rather than somewhere central so that deleting an
 * article deletes its markers with it. It is not an artefact and has no home in
 * Postgres of its own: there this is `revision_step_runs.status`, which the
 * schema already has. tests/store-artefact-manifest.test.ts records that.
 */
function markerFile(at: ArtifactLocations, step: StepName): string {
  return path.join(at.dir, "steps", `${step}.running`);
}

/**
 * An artefact store over the filesystem.
 *
 * `locate` is how the fixture gets served. Most callers want the default —
 * `data/<slug>/` beside `output/<slug>.html` — but src/api.ts resolves the
 * fixture's own slug to `example/`, and a store that insisted on the default
 * would report every stage of the fixture unfinished. See `candidateDirs`
 * there.
 *
 * **Not a fallback for any other slug**, and this comment said it was until
 * 2026-08-31. `candidateDirs` used to append `example/` to every slug that had
 * no `blocks.json` + `tree.json` of its own, so an article mid-ingest was
 * answered with the fixture's prose under the reader's name. It now offers
 * `example/` for `example` and for nothing else; a missing article is a 404.
 */
export function createFsArtifactStore(
  locate: (slug: string) => ArtifactLocations = fsLocations,
): ArtifactStore {
  return {
    async has(slug, step, kinds) {
      if (kinds.length === 0) return false;
      const at = locate(slug);
      /* Sequentially, and stopping at the first missing one. The common case in
         a re-run is that the first artefact is absent, and there is no reason
         to parse three more files to find that out. */
      for (const kind of kinds) {
        if ((await readOne(at, slug, step, kind)) === null) return false;
      }
      return true;
    },

    async read(slug, step, kind) {
      const value = await readOne(locate(slug), slug, step, kind);
      return value as ArtifactMap[typeof kind] | null;
    },

    /**
     * The same read as `read`, unflattened — one call to `readOutcome`, whose
     * three states this store has had since 2026-08-28 and which only
     * `hasEarlierBlocks` could see — **and then the deeper question**.
     *
     * `read` above is `readOne` is `readOutcome`, so the two cannot answer
     * differently about the file itself: there is one parse, one ceiling and
     * one shape check underneath both.
     *
     * `whyUnusableAsBaseline` on top of that is the fix for the hole a review
     * found on 2026-08-28: `SHAPE.glossary` only asks whether `entries` is an
     * array, so a glossary with no `sourceHash` read back as `ok`, failed the
     * ordinary staleness comparison, and made the stage mint every id quietly.
     * It runs **only here** — `read` and `has` are untouched, because a
     * half-formed artefact is still a perfectly good answer to *is this step
     * done* and *what does the panel draw*.
     */
    async readBaseline(slug, step, kind) {
      const outcome = await readOutcome(locate(slug), slug, step, kind);
      if (outcome.state !== "ok") return outcome;
      const why = whyUnusableAsBaseline(kind, outcome.value);
      if (why) {
        /* `debug` and a *reason*, never the value — that is article prose
           (docs/project/logging.md). The reason reaches a person through the
           stage's own error, which says what to restore; this line is for
           somebody reading the log afterwards. */
        alog.debug({ slug, step, kind, why }, `baseline unusable: ${kind} for ${slug}`);
        return { state: "unusable" };
      }
      return { state: "ok", value: outcome.value as ArtifactMap[typeof kind] };
    },

    /**
     * **Stage 4's copy, not stage 3's** — `data/<slug>/blocks.json`, which is
     * exactly the second file `previousBlockCount` in src/pipeline.ts used to
     * read for the same reason.
     *
     * There are no revisions on disk, so the closest true statement is *has
     * this article ever been through a full run*. Asking stage 3's own copy
     * would be circular: that file **is** the baseline, so it could only ever
     * report that a missing baseline is missing.
     *
     * block-ids.md calls this copy a source artefact rather than a cache
     * precisely because losing it loses the ids for good. So the case it now
     * catches — stage 3's copy gone while stage 4's still lists every id that
     * used to exist — stops the stage instead of warning about it after the
     * fact. The recovery is to put the file back, or to delete both if the
     * article really is being started again from nothing.
     *
     * **A file that will not parse counts as an earlier run**, and the whole
     * point of `readOutcome` is being able to say so. Until 2026-08-28 this read
     * through `readOne`, where a corrupt or over-the-ceiling file is `null`, the
     * same as no file — so a half-written stage-4 copy answered *first ingest*
     * and stage 3 minted a new id for every paragraph. The argument that this
     * was harmless, because in that state there is nothing left to carry, is
     * answering a different question: whether the ids are recoverable is not
     * whether we should proceed. A person with a backup or a Dropbox history can
     * put the file back; minting takes that away silently and reports success.
     * The one thing this must not do is guess. GPT Sol, 2026-08-28.
     */
    async hasEarlierBlocks(slug) {
      const outcome = await readOutcome(locate(slug), slug, "hierarchy", "blocks");
      if (outcome.state === "absent") return false;
      if (outcome.state === "unusable") return true;
      const blocks = (outcome.value as ArtifactMap["blocks"]).blocks;
      return blocks !== undefined && blocks.length > 0;
    },

    async write(slug, step, parts: ArtifactParts, stamp) {
      const at = locate(slug);
      for (const [kind, value] of Object.entries(parts) as [
        ArtifactKind,
        ArtifactMap[ArtifactKind],
      ][]) {
        if (value === undefined) continue;
        assertStampAgrees(slug, step, kind, value, stamp);
        const body = serialise(kind, value);
        /* Enforced here as well as on the way back in, and this is the side
           that matters. The ceiling used to be checked only by `readOne`, so a
           step could write an artefact too big to read and report success —
           and then be permanently not-done, re-running on every job with no
           symptom but a stage that will not stay finished. The pipeline writes
           decoded text back as UTF-8, which can be *larger* than the bytes
           `fetch` capped, so this is reachable rather than theoretical. */
        const bytes = Buffer.byteLength(body, "utf-8");
        const { maxBytes } = DECODERS[kind];
        if (bytes > maxBytes) {
          throw new Error(
            `${step} for "${slug}": the ${kind} is ${bytes} bytes, over the ${maxBytes}-byte ` +
              `ceiling this store can read back. Writing it would produce a step that never ` +
              `reports itself done.`,
          );
        }
        await writeAtomic(pathFor(at, step, kind), body);
      }
    },

    async stampFor(slug, step) {
      const kind = STAMP_SOURCE[step];
      if (!kind) return null;
      const artefact = await readOne(locate(slug), slug, step, kind);
      if (artefact === null) return null;
      return stampOf(artefact);
    },

    async beginStep(slug, step) {
      const file = markerFile(locate(slug), step);
      await mkdir(path.dirname(file), { recursive: true });
      const attempt = mintId();
      /* The timestamp and pid are for whoever is looking at a stuck article;
         nothing reads them back. The **attempt** is read back, by `finishStep`,
         and is the whole reason this file has contents at all.

         Deliberately not a lease: a pid and a timestamp invite "it has been an
         hour, it must be dead", and that guess is how two runs end up writing
         one article. */
      await writeFile(
        file,
        `${JSON.stringify({ attempt, startedAt: new Date().toISOString(), pid: process.pid })}\n`,
        "utf-8",
      );
      return attempt;
    },

    async finishStep(slug, step, attempt) {
      const file = markerFile(locate(slug), step);
      let held: string | undefined;
      try {
        held = (JSON.parse(await readFile(file, "utf-8")) as { attempt?: string }).attempt;
      } catch (err) {
        // Absent, or unreadable. Neither is an error. A step can finish without
        // this store having seen it start — every artefact written before
        // markers existed is in that state, and so is a stage run from its own
        // CLI.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        if (!(err instanceof SyntaxError)) throw err;
      }
      /* **Somebody else's attempt is left alone.** Clearing it is what let one
         runner's success speak for another runner's half-finished writes — the
         first critical of the 2026-08-26 review, in six steps.

         Honest limit: read-then-unlink is not atomic, so a marker overwritten
         in the gap is still removed by the wrong owner. Narrower than before
         and not zero, and a filesystem has nothing better; the Postgres adapter
         does this as one fenced `UPDATE … WHERE attempt_id = $attempt`. */
      if (held !== undefined && held !== attempt) return;
      try {
        await unlink(file);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    },

    async interrupted(slug, step) {
      try {
        await stat(markerFile(locate(slug), step));
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw err;
      }
    },
  };
}

/** The ordinary store: `data/<slug>/` and `output/<slug>.html`. */
export const fsArtifacts: ArtifactStore = createFsArtifactStore();

/**
 * **The reader's own file, off the disk** — the filesystem half of
 * `GET /api/source/:slug`.
 *
 * It is here rather than in [fs.ts](fs.ts), where the other filesystem adapters
 * are assembled, because this is the module that is allowed to know where an
 * article's files are, and the whole of this answer is one path: the manifest
 * says which file holds the bytes, and the bytes are beside it. `fs.ts`
 * delegates to code that already does the job and adds no behaviour; there was
 * no such code for this — it was written out inline in `sendSource`, which is
 * exactly the problem.
 *
 * **Through `fsArtifacts.read`, not a second `readRaw`.** The manifest is
 * already an artefact of the `fetch` step, with a path in `PATHS` and a shape
 * check in `SHAPE`; reaching for `raw.json` again here would be a second copy
 * of where it is and of what a usable one looks like.
 *
 * The bytes are **not** an artefact and deliberately are not becoming one: an
 * `ArtifactKind` is a JSON value both stores can hold in a column, and up to
 * 32 MiB of somebody's scan is not that. Postgres keeps it as a reference to an
 * object in a bucket — see [pg-source.ts](pg-source.ts).
 */
export const fsSourceStore: SourceStore = {
  async readPdf(slug) {
    const manifest = await fsArtifacts.read(slug, "fetch", "raw");
    /* Absent, unreadable, or a web page — all three are "no PDF here", and the
       route says one sentence for all three. */
    if (manifest?.kind !== "pdf") return null;
    /* **By content address, not `path.join(dir, manifest.file)`.** Since
       2026-08-31 stage 1 leaves nothing on disk: it puts the document in the
       content-addressed `sources` bucket and returns the manifest that names
       it (docs/plans/260831b-finish-the-database-move.md § Stage 2c). So a PDF fetched
       after that has no `raw.pdf` beside its manifest and the old read
       404'd — a route quietly failing for new articles while going on working
       for the ones a developer already had, which is the worst way for it to
       break.

       **A refusal here is a throw, not a `null`.** The manifest is stage 1
       saying the object exists; an assertion that turns out false is a fault
       somebody should see, not an article that never had a scan.
       `RawDocumentUnavailable` carries the reason and the key. routes.ts
       answers 404 on `err.code === "ENOENT"`, which the filesystem blob store
       still raises for a missing object, so the route's behaviour is
       unchanged. */
    const bytes = await readRawBytes(manifest, { slug });
    /* **The reader's own name for the file, and only when it is theirs.** A
       fetched document has no name anybody chose, and `manifest.filename` is
       absent for it; `origin` is what tells the two apart, and it is absent —
       meaning `"url"` — on every manifest written before uploads existed
       (src/fetch.ts § `RawManifest.origin`). The route falls back to the slug.
       Carried across when `sendSource` moved to this seam on 2026-08-31: the
       Postgres half reads the same fact out of `raw_filename`. */
    return {
      bytes,
      filename: manifest.origin === "upload" ? (manifest.filename ?? null) : null,
    };
  },
};
