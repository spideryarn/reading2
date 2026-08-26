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
 * docs/plans/postgres-storage-implementation.md § Step 11 for why the seam is
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
import { mintId } from "../ids.js";
import { log } from "../log.js";
import { parseJsonFrom } from "../parse-json.js";
import type { StepName } from "../types.js";
import type {
  ArtifactKind,
  ArtifactMap,
  ArtifactParts,
  ArtifactStore,
  StepStamp,
} from "./artifacts.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

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
 */
export function fsLocations(slug: string): ArtifactLocations {
  return {
    dir: path.join(ROOT, "data", slug),
    htmlFile: path.join(ROOT, "output", `${slug}.html`),
  };
}

/**
 * Every path this project writes a pipeline artefact to. **The one place.**
 *
 * Keyed by step and then by kind, because two kinds share a path and one kind
 * has two paths — see the header. Read it as: *when `toc` produces `blocks`, it
 * goes here*.
 *
 * `blocks` appearing under both `blocks` and `toc` is not a mistake and must
 * not be tidied away. Stage 3's copy is the one stage 3 checks, so that a
 * `{ steps: ["blocks"] }` job can skip itself without `toc` having run; stage
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
  toc: {
    tree: (at) => path.join(at.dir, "tree.json"),
    labels: (at) => path.join(at.dir, "labels.json"),
    blocks: (at) => path.join(at.dir, "blocks.json"),
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
  summary: {
    summary: (at) => path.join(at.dir, "summary.json"),
  },
  ideas: {
    ideas: (at) => path.join(at.dir, "ideas.json"),
  },
};

/**
 * The artefact each step stamps, so `stampFor` knows what to read.
 *
 * Three steps are deliberately absent. `fetch`, `extract` and `blocks` record
 * nothing about what they were made from, so their stamp is `null` and the only
 * question that can be asked of them is presence — which is why the truncation
 * hazard was invisible for them and why `has` had to start parsing.
 *
 * `toc` reads its stamp off **`labels.json`, not `tree.json`**, and that is
 * worth stating because it looks backwards. The tree is the headline artefact,
 * but it carries only `version` and `generator`; `labels.json` is the one that
 * records `sourceHash` — the blocks it was written against — and
 * `structureHash` besides. So it is the only output of stage 4 that can answer
 * "is this still about the current article".
 */
const STAMP_SOURCE: Partial<Record<StepName, ArtifactKind>> = {
  toc: "labels",
  arc: "arc",
  tweets: "tweets",
  glossary: "glossary",
  summary: "summary",
  ideas: "ideas",
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
 * Valid JSON, and an object with the field that says what it is.
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
function json(field: string, isRight: (v: unknown) => boolean): Decoder["decode"] {
  return (text) => {
    // The `source` string is copied into the error as given, so it must carry
    // nothing about the content — see parseJsonFrom's header.
    const parsed: unknown = parseJsonFrom<unknown>(text, "an artefact");
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("not an object");
    }
    if (!isRight((parsed as Record<string, unknown>)[field])) {
      throw new Error(`no usable "${field}"`);
    }
    return parsed;
  };
}

const isArray = (v: unknown): boolean => Array.isArray(v);
/* `!Array.isArray` is the load-bearing half. Without it `{"nodes":[]}` is a
   perfectly good tree and `{"labels":[]}` a perfectly good labels file, which
   is a shape neither writer has ever produced — so the check said yes to the
   one thing it was there to say no to. Found by review, 2026-08-26. */
const isObject = (v: unknown): boolean =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): boolean => typeof v === "string" && v.length > 0;

/** Non-empty text. All we can honestly ask of HTML. */
const text: Decoder["decode"] = (t) => {
  if (t.trim().length === 0) throw new Error("empty");
  return t;
};

const DECODERS: Record<ArtifactKind, Decoder> = {
  /* 32 MiB is src/fetch.ts's own ceiling on a page, so anything bigger did not
     come from us. */
  raw: { maxBytes: 4 * MiB, decode: json("file", isString) },
  extractedHtml: { maxBytes: 32 * MiB, decode: text },
  stampedHtml: { maxBytes: 32 * MiB, decode: text },
  meta: { maxBytes: 4 * MiB, decode: json("slug", isString) },
  blocks: { maxBytes: 32 * MiB, decode: json("blocks", isArray) },
  tree: { maxBytes: 32 * MiB, decode: json("nodes", isObject) },
  labels: { maxBytes: 32 * MiB, decode: json("labels", isObject) },
  arc: { maxBytes: 16 * MiB, decode: json("entries", isArray) },
  tweets: { maxBytes: 16 * MiB, decode: json("tweets", isArray) },
  glossary: { maxBytes: 32 * MiB, decode: json("entries", isArray) },
  /* Far smaller than a glossary in practice — three to ten ideas rather than a
     hundred terms — but the same ceiling, because the cap is a guard against a
     corrupt or hostile file rather than a size estimate. */
  ideas: { maxBytes: 32 * MiB, decode: json("ideas", isArray) },
  summary: { maxBytes: 32 * MiB, decode: json("entries", isArray) },
};

/** The path for one `(step, kind)`, or a clear error rather than `undefined`. */
export function pathFor(at: ArtifactLocations, step: StepName, kind: ArtifactKind): string {
  const where = PATHS[step]?.[kind];
  if (!where) throw new Error(`${step} does not produce ${kind}`);
  return where(at);
}

/**
 * Read one artefact, or `null` for the answers that mean *this cannot be used*.
 *
 * **Absent, over the ceiling and unreadable are `null`; broken is thrown.**
 * That line moved on 2026-08-26 and the old place was wrong: any `stat` failure
 * became a silent `null`, so a permissions error, a failing disk and a file
 * nobody has written yet were one answer. The step then reported not-done and
 * the pipeline paid for a model call to fix a problem no model call can fix —
 * and the metadata page fell through to the `example/` fixture for an article
 * that was there all along. Only `ENOENT` means absent. Everything else
 * propagates, because this project's rule is that a swallowed error is worse
 * than a loud one (docs/reusable/silent-success.md).
 *
 * Corruption is different again, and stays `null`: a file that will not parse
 * is a real state of the world that the next run genuinely does fix by
 * rewriting it. It is logged at `debug` — a missing or half-written artefact is
 * the ordinary state of an article nobody has finished ingesting.
 *
 * **One file handle for the size and the bytes**, so the two describe the same
 * inode. `stat` then `readFile` is two lookups of a name, and an atomic
 * replacement in between meant the ceiling was checked against a file that is
 * no longer the file being read.
 */
async function readOne(
  at: ArtifactLocations,
  slug: string,
  step: StepName,
  kind: ArtifactKind,
): Promise<unknown | null> {
  const file = pathFor(at, step, kind);
  const { maxBytes, decode } = DECODERS[kind];

  let handle: FileHandle;
  try {
    handle = await open(file, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
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
      return null;
    }
    const body = await handle.readFile("utf-8");
    try {
      return decode(body);
    } catch (err) {
      alog.debug(
        { slug, step, kind, size, err: (err as Error).message },
        `artefact unreadable: ${kind} for ${slug}`,
      );
      return null;
    }
  } finally {
    await handle.close();
  }
}

/**
 * Write, then move into place.
 *
 * The same recipe as `writeAtomic` in src/toc.ts and src/labels.ts, which is
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
 * The stamp fields as they are spelled on disk.
 *
 * Every stamped artefact in this project uses the same three names —
 * `sourceHash`, `version`, `generator` — because they all grew out of
 * src/tweets.ts. Reading them in one place is what lets `sameStamp` be one
 * comparison instead of the three near-identical `…IsCurrent` functions.
 */
interface StampedOnDisk {
  sourceHash?: unknown;
  version?: unknown;
  generator?: unknown;
  /** Only `ideas` compares this today — see `StepStamp.profileHash`. */
  profileHash?: unknown;
}

function stampOf(artefact: unknown): StepStamp {
  const a = (artefact ?? {}) as StampedOnDisk;
  const stamp: StepStamp = {};
  if (typeof a.sourceHash === "string") stamp.inputHash = a.sourceHash;
  if (typeof a.version === "string") stamp.promptVersion = a.version;
  if (typeof a.generator === "string") stamp.model = a.generator;
  /* `null` is carried across as `null` rather than dropped: it means "written
     deliberately without a profile", which is a real answer and has to compare
     equal to an expected `null`. Dropping it would make an artefact written
     without a profile look like one written before profiles existed, and the
     step would then regenerate on every run for ever. */
  if (typeof a.profileHash === "string" || a.profileHash === null) {
    stamp.profileHash = a.profileHash;
  }
  return stamp;
}

/**
 * Where the "this step started" markers live: `data/<slug>/steps/<step>.running`.
 *
 * A directory of one file per step rather than one file listing them all,
 * because the alternative is read-modify-write and this has to stay correct
 * once two processes can be advancing the same article — which is exactly what
 * the browser-driven advance endpoint makes possible
 * (docs/plans/job-queue-rethink.md).
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
 * `data/<slug>/` beside `output/<slug>.html` — but src/api.ts's metadata page
 * falls back to `example/` for an article with no directory of its own, and a
 * store that insisted on the default would report every stage of the fixture
 * unfinished. See `candidateDirs` there.
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

/**
 * The stamp a caller passes to `write` must be the stamp inside the artefact.
 *
 * On the filesystem there is nowhere else to put it — `sourceHash`, `version`
 * and `generator` are fields of the artefact itself, and that is what
 * `stampFor` reads back. So the `stamp` argument is not stored here; it is
 * *checked*. An unused parameter would be worse than no parameter: it would
 * read as though the store were recording something, and a caller could pass a
 * stamp that contradicts the file it is writing without anything noticing until
 * the step refused to stay done.
 *
 * Only fields the artefact actually carries are compared. An arc has no
 * `sourceHash`, so a caller declaring an `inputHash` for one is not
 * contradicting anything on disk — there is simply nowhere for it to go, and
 * that is the arc's limitation rather than the caller's mistake.
 */
function assertStampAgrees(
  slug: string,
  step: StepName,
  kind: ArtifactKind,
  value: unknown,
  stamp: StepStamp,
): void {
  if (STAMP_SOURCE[step] !== kind) return;
  const onDisk = stampOf(value);
  /* `profileHash` joined the list on 2026-08-27, with `ideas`. Leaving it out
     was not a deliberate narrowing — it was the field arriving after this
     function was written, which is exactly how a consistency check quietly
     stops covering the thing it was extended for: a caller could pass
     `profileHash: null` while writing an artefact stamped with a real hash, and
     the store would accept the contradiction and then answer freshness
     questions from whichever of the two it happened to read. GPT Sol.

     `!== undefined` rather than a truthiness test, because `null` is a REAL
     value here — "written deliberately without a profile" — and has to be able
     to clash with a hash. */
  const clashes = (["inputHash", "promptVersion", "model", "profileHash"] as const).filter(
    (field) =>
      stamp[field] !== undefined &&
      onDisk[field] !== undefined &&
      stamp[field] !== onDisk[field],
  );
  if (clashes.length > 0) {
    throw new Error(
      `${step} for "${slug}": the stamp passed to write disagrees with the ${kind} itself ` +
        `(${clashes.map((f) => `${f}: ${String(stamp[f])} vs ${String(onDisk[f])}`).join(", ")})`,
    );
  }
}

/** The ordinary store: `data/<slug>/` and `output/<slug>.html`. */
export const fsArtifacts: ArtifactStore = createFsArtifactStore();
