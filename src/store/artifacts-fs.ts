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
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { log } from "../log.js";
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
    raw: (at) => path.join(at.dir, "raw.html"),
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

/** Valid JSON, and an object with the field that says what it is. */
function json(field: string, isRight: (v: unknown) => boolean): Decoder["decode"] {
  return (text) => {
    const parsed: unknown = JSON.parse(text);
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
const isObject = (v: unknown): boolean => typeof v === "object" && v !== null;
const isString = (v: unknown): boolean => typeof v === "string" && v.length > 0;

/** Non-empty text. All we can honestly ask of HTML. */
const text: Decoder["decode"] = (t) => {
  if (t.trim().length === 0) throw new Error("empty");
  return t;
};

const DECODERS: Record<ArtifactKind, Decoder> = {
  /* 32 MiB is src/fetch.ts's own ceiling on a page, so anything bigger did not
     come from us. */
  raw: { maxBytes: 32 * MiB, decode: text },
  extractedHtml: { maxBytes: 32 * MiB, decode: text },
  stampedHtml: { maxBytes: 32 * MiB, decode: text },
  meta: { maxBytes: 4 * MiB, decode: json("slug", isString) },
  blocks: { maxBytes: 32 * MiB, decode: json("blocks", isArray) },
  tree: { maxBytes: 32 * MiB, decode: json("nodes", isObject) },
  labels: { maxBytes: 32 * MiB, decode: json("labels", isObject) },
  arc: { maxBytes: 16 * MiB, decode: json("entries", isArray) },
  tweets: { maxBytes: 16 * MiB, decode: json("tweets", isArray) },
  glossary: { maxBytes: 32 * MiB, decode: json("entries", isArray) },
  summary: { maxBytes: 32 * MiB, decode: json("entries", isArray) },
};

/** The path for one `(step, kind)`, or a clear error rather than `undefined`. */
export function pathFor(at: ArtifactLocations, step: StepName, kind: ArtifactKind): string {
  const where = PATHS[step]?.[kind];
  if (!where) throw new Error(`${step} does not produce ${kind}`);
  return where(at);
}

/**
 * Read one artefact, or `null` for every unhappy answer.
 *
 * Missing, over the ceiling, unparseable, the wrong shape — all `null`. They
 * are different problems and they have the same right response here: this
 * artefact cannot be used, so the step that makes it is not done. Only the
 * distinguishable ones are logged, and only at `debug`, because a missing file
 * is the ordinary state of an article nobody has finished ingesting.
 */
async function readOne(
  at: ArtifactLocations,
  slug: string,
  step: StepName,
  kind: ArtifactKind,
): Promise<unknown | null> {
  const file = pathFor(at, step, kind);
  const { maxBytes, decode } = DECODERS[kind];

  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return null;
  }

  if (size > maxBytes) {
    /* Warn rather than debug: this one does not resolve itself. `has` will keep
       answering not-done, so the step re-runs every job, for ever, and the only
       visible symptom is a stage that will not stay finished. */
    alog.warn(
      { slug, step, kind, size, maxBytes },
      `artefact over its ceiling: ${kind} for ${slug} is ${size} bytes`,
    );
    return null;
  }

  try {
    return decode(await readFile(file, "utf-8"));
  } catch (err) {
    alog.debug(
      { slug, step, kind, size, err: (err as Error).message },
      `artefact unreadable: ${kind} for ${slug}`,
    );
    return null;
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
  if (kind === "raw" || kind === "extractedHtml" || kind === "stampedHtml") {
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
}

function stampOf(artefact: unknown): StepStamp {
  const a = (artefact ?? {}) as StampedOnDisk;
  const stamp: StepStamp = {};
  if (typeof a.sourceHash === "string") stamp.inputHash = a.sourceHash;
  if (typeof a.version === "string") stamp.promptVersion = a.version;
  if (typeof a.generator === "string") stamp.model = a.generator;
  return stamp;
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
        await writeAtomic(pathFor(at, step, kind), serialise(kind, value));
      }
    },

    async stampFor(slug, step) {
      const kind = STAMP_SOURCE[step];
      if (!kind) return null;
      const artefact = await readOne(locate(slug), slug, step, kind);
      if (artefact === null) return null;
      return stampOf(artefact);
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
  const clashes = (["inputHash", "promptVersion", "model"] as const).filter(
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
