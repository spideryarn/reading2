/**
 * What a pipeline step produces, named by **what the thing is** rather than by
 * where it lands.
 *
 * ## Why this exists
 *
 * Today a step declares `outputs(ctx): string[]` — a list of file paths — and
 * the pipeline decides the step is done by asking whether those paths exist.
 * Both halves are wrong once the artefacts live in Postgres: there are no
 * paths, and existence is not the question.
 *
 * So a step declares `produces: ArtifactKind[]`, and a *store* answers the two
 * questions separately (docs/plans/postgres-storage-implementation.md § Step 11,
 * half B):
 *
 * 1. **Present** — does the store hold every kind this step produces? The store
 *    answers, from the declaration. Never the step.
 * 2. **Current** — was it made from this article, by this prompt, by this
 *    model? A comparison of the recorded `StepStamp` against the stamp the step
 *    would produce now. That comparison is `sameStamp`, once, rather than
 *    `threadIsCurrent` / `summariesAreCurrent` and the `glossaryIsCurrent` that
 *    used to sit beside them — the same three lines written three times.
 *    `glossaryIsCurrent` was deleted on 2026-08-28 once `stamp` had replaced it;
 *    the other two are still their steps' `isDone` and are next.
 *
 * This file is types and one pure function. The file-backed adapter is
 * src/store/artifacts-fs.ts; the Postgres one is not written yet.
 *
 * ## The key is `(step, kind)`, not `kind`
 *
 * The obvious shape — `Record<ArtifactKind, path>` — cannot reproduce what the
 * pipeline writes today, and it took a review to notice. `blocks` has **two**
 * destinations: `output/<slug>.blocks.json`, written by the `blocks` step, and
 * `data/<slug>/blocks.json`, written by `toc` so the tree and the blocks it was
 * built from sit together. Keyed by kind alone, one of those disappears and
 * four stages lose the file they read. So every lookup in the adapter takes a
 * step *and* a kind. The same applies to the HTML, which `extract` writes and
 * `blocks` then rewrites with the ids stamped into it — one path, two kinds,
 * two owners.
 */
import type {
  Arc,
  Block,
  Glossary,
  Ideas,
  Meta,
  StepName,
  Summaries,
  Tree,
  TweetThread,
} from "../types.js";
import type { LabelsFile } from "../labels.js";
import type { RawManifest } from "../fetch.js";

/**
 * Every kind of thing the pipeline durably produces.
 *
 * Named for the thing, not the file. `extractedHtml` and `stampedHtml` are the
 * same path on disk and deliberately two kinds: the first is Readability's
 * output, the second is that HTML after stage 3 has written the block ids into
 * it, and a step that finds the first where it wanted the second has found the
 * wrong artefact even though the bytes are at the right address.
 *
 * Not here: `comments.json`, `chat.json`, `searches.json`,
 * `glossary-lookups.json`, `shelf.json`. Those are the **reader's**, not the
 * pipeline's — they survive re-extraction and are keyed by article rather than
 * by revision. tests/store-artefact-manifest.test.ts is the list of all of them.
 */
export type ArtifactKind =
  | "raw"
  | "meta"
  | "extractedHtml"
  | "blocks"
  | "stampedHtml"
  | "tree"
  | "labels"
  | "arc"
  | "tweets"
  | "glossary"
  | "summary"
  | "ideas";

/**
 * Each kind, and the TypeScript type of the thing itself.
 *
 * The real types out of src/types.ts, so `read` hands back something the caller
 * can use without a cast. `blocks` is `{ blocks: Block[] }` rather than
 * `Block[]` because that is the shape on disk, and inventing a tidier one here
 * would mean every reader and writer disagreeing with every file.
 */
export interface ArtifactMap {
  /**
   * **The manifest, not the bytes** — and it said `string` until 2026-08-27,
   * which was a lie nothing had caught because nothing calls `read` yet.
   *
   * `raw.json` holds a `RawManifest` (src/fetch.ts): the kind, the name of the
   * file beside it that holds the payload, the two URLs, the content type, the
   * byte count and the hash. The filesystem decoder has always checked exactly
   * that — `json("file", isString)`, an object with a string `file` field — so
   * the declaration and the adapter disagreed, and `read(slug, "fetch", "raw")`
   * would have handed back an object cast to `string`, whose `.length` is
   * `undefined`. No error anywhere: [silent success](docs/reusable/silent-success.md).
   *
   * **This is not the whole fix**, and the honest note matters more than the
   * type. GPT Sol's review of docs/plans/transactional-stage-runner.md: a
   * manifest names a *file*, and `article_revisions.raw_bytes` needs the bytes
   * themselves, so a Postgres adapter cannot fill that column from this. What
   * `fetch` eventually returns has to carry provenance **and** payload. That is
   * that plan's landing B; this is the declaration ceasing to be false.
   */
  raw: RawManifest;
  meta: Meta;
  extractedHtml: string;
  blocks: { blocks: Block[] };
  stampedHtml: string;
  tree: Tree;
  labels: LabelsFile;
  arc: Arc;
  tweets: TweetThread;
  glossary: Glossary;
  summary: Summaries;
  ideas: Ideas;
}

/** Some or all of one step's artefacts, handed to `write` in one call. */
export type ArtifactParts = Partial<{ [K in ArtifactKind]: ArtifactMap[K] }>;

/* ------------------------------------------------- what a usable one looks like -- */

/**
 * The one shallow shape check per kind, shared by **both** adapters.
 *
 * ## Why it lives here rather than in the file adapter that grew it
 *
 * These rules were written in src/store/artifacts-fs.ts, where they answer
 * *"did this file survive being written?"*. The Postgres adapter has to answer
 * the same question about a JSONB column, and the whole claim it makes is that
 * the two stores agree about what a usable artefact is. Two copies of the rules
 * cannot make that claim: they would agree on the day they were written and
 * drift silently afterwards, which is the shape of bug this repo keeps writing
 * postmortems about ([silent-success.md](docs/reusable/silent-success.md)).
 *
 * So there is one table, in the leaf module both adapters already import.
 *
 * ## Shallow, on purpose, and it is not the same check in both stores
 *
 * On the filesystem the real work is done before this runs: a truncated
 * document fails at `JSON.parse`, and this catches the other cheap case —
 * valid JSON of entirely the wrong shape. In Postgres a JSONB column cannot be
 * half-written, so this is the *whole* check, and it is doing less. That is a
 * difference in what the two stores can be corrupted by rather than a
 * difference in the rule, and it is worth saying out loud: the filesystem
 * needs a parse it can fail, and Postgres needs a transaction it can roll back.
 *
 * Running a 360-entry glossary through a full schema on every skip check of
 * every step of every job would buy precision nobody asked for.
 */
export interface ShapeCheck {
  /**
   * The field that says what this is, or `null` for the kinds that are text
   * rather than objects.
   *
   * The name is used in the failure message, which is why it is a string here
   * and not folded into `ok`.
   */
  readonly field: string | null;
  /** Is that field (or, for `field: null`, the value itself) usable? */
  readonly ok: (value: unknown) => boolean;
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
const isText = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;

export const SHAPE: Record<ArtifactKind, ShapeCheck> = {
  /** The **manifest**, whose `file` names the bytes beside it — see `ArtifactMap`. */
  raw: { field: "file", ok: isString },
  meta: { field: "slug", ok: isString },
  extractedHtml: { field: null, ok: isText },
  stampedHtml: { field: null, ok: isText },
  blocks: { field: "blocks", ok: isArray },
  tree: { field: "nodes", ok: isObject },
  labels: { field: "labels", ok: isObject },
  arc: { field: "entries", ok: isArray },
  tweets: { field: "tweets", ok: isArray },
  glossary: { field: "entries", ok: isArray },
  ideas: { field: "ideas", ok: isArray },
  summary: { field: "entries", ok: isArray },
};

/**
 * Why this value is not a usable artefact of this kind, or `null` when it is.
 *
 * A reason rather than a boolean, because the two adapters do different things
 * with it: the file one puts it in a thrown error that its own caller logs at
 * `debug`, and the Postgres one logs it directly. Neither may put the *value*
 * anywhere near a log line — it is article prose, which
 * docs/project/logging.md forbids outright — so the reason names the field and
 * never quotes what was in it.
 */
export function whyUnusable(kind: ArtifactKind, value: unknown): string | null {
  const { field, ok } = SHAPE[kind];
  if (field === null) return ok(value) ? null : "empty";
  if (!isObject(value)) return "not an object";
  return ok((value as Record<string, unknown>)[field]) ? null : `no usable "${field}"`;
}

/* ------------------------------------------------------ the two constants -- */
/**
 * What `revision_step_runs.implementation_version` says for a row this seam
 * wrote, and it is load-bearing that it is **not** `"imported"`.
 *
 * The importer withdraws inferred rows by deleting everything stamped
 * `imported` whose artefact has gone (src/store/import.ts), scoped that way
 * precisely so that *a migration tool cannot delete a pipeline record*. A row
 * from here carrying that marker would be inside the blast radius of every
 * `npm run db:import`.
 *
 * There is no real implementation version to write yet — no step declares one
 * (see `StepStamp.implementationVersion` in artifacts.ts) — so this says where
 * the row came from and nothing it cannot back up.
 */
export const PIPELINE_RUN = "pipeline";

/**
 * The `input_hash` for a step that records nothing about its input.
 *
 * `fetch`, `extract` and `blocks` write no `sourceHash` anywhere, so their
 * stamp is `null` in every store (artifacts.ts § `STAMP_SOURCE`) — and the
 * column is `not null`. A sentinel that can never equal a hash is the honest
 * filler: **it must not be the draft's block hash**, which would claim the step
 * ran against blocks it has never seen, and would make the metadata page report
 * a stale stage as current.
 */
export const NO_INPUT_HASH = "unstamped";

/**
 * What a step's output was made from, and by what.
 *
 * Every field is optional and that is the honest shape, not a convenience:
 * `tree.json` and `arc.json` carry no `sourceHash` at all (verified — see
 * docs/plans/postgres-storage-implementation.md § Staleness stays computable),
 * so a stamp read off an arc can only ever answer two of the three questions.
 * Pretending otherwise by giving the field a default would make a stale arc
 * report itself current, which is exactly the
 * [silent success](docs/reusable/silent-success.md) the split exists to stop.
 *
 * `sameStamp` therefore refuses to say "current" when the *expected* stamp
 * declares nothing to compare.
 */
export interface StepStamp {
  /**
   * A fingerprint of what went in — `hashBlocks` today (src/source-hash.ts),
   * stored on disk as `sourceHash`.
   *
   * **One hash is not right for every step**, and this field is where that will
   * bite. `arc`, `tweets`, `glossary` and `summary` all read the *tree* as well
   * as the blocks, and src/labels.ts already keeps a separate `structureHash`
   * precisely because section boundaries can move without a single block
   * changing. Making the input hash step-specific is a stage-5 job for each
   * step's owner; this type does not stand in the way of it.
   */
  inputHash?: string;
  /**
   * The version of the *code* that wrote it, for a step whose output can change
   * without its prompt or its model changing.
   *
   * Nothing writes one yet — no artefact on disk carries such a field — so it
   * is here as the place for it rather than as something to read today.
   */
  implementationVersion?: string;
  /** The prompt that wrote it. On disk: `version`, e.g. `"glossary/2"`. */
  promptVersion?: string;
  /** The model that ran. On disk: `generator`, e.g. `"claude-sonnet-5"`. */
  model?: string;
  /**
   * The **reader's profile** the artefact was written for. On disk:
   * `profileHash`.
   *
   * Added 2026-08-26 for `ideas`, and it is worth saying why it was not here
   * before and why that was a real hole rather than a simplification.
   *
   * Several artefacts have recorded a `profileHash` since the profile existed,
   * and the read path reports a changed profile so a panel can offer to
   * regenerate. **Nothing put it in the stamp**, so `stepIsDone` never saw it:
   * edit your profile and the glossary stays "current" for ever, and the only
   * thing that says otherwise is a banner the reader has to act on.
   *
   * For the glossary that is a defensible gap — a profile changes which terms
   * are worth an entry. For `ideas` it is close to fatal, because the profile
   * changes what the artefact *means*: "what you need to bring" is defined by
   * who is reading, and a list written for last month's profile is answering a
   * different question rather than being merely old.
   *
   * **Only stages that opt in are affected**, because `sameStamp` compares the
   * keys the *expected* stamp declares. A stage whose `stamp()` omits this
   * behaves exactly as it did — so this is a field `ideas` uses and the others
   * may adopt when somebody decides they should, not a silent invalidation of
   * every artefact on every shelf.
   *
   * Three states, matching the artefacts' own: `undefined` for "written before
   * this existed", `null` for "written deliberately without a profile", and a
   * hash. `null` is a real answer and must compare equal to `null` — which it
   * does, because it is compared with `===` like every other key.
   */
  profileHash?: string | null;
}

/**
 * The artefact each step stamps, so `stampFor` knows what to read.
 *
 * Shared by both adapters. In Postgres the artefact is a JSONB column rather
 * than a file, and the stamp fields are read out of it exactly the same way —
 * see `stampOf` below and src/store/artifacts-pg.ts.
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
export const STAMP_SOURCE: Partial<Record<StepName, ArtifactKind>> = {
  toc: "labels",
  arc: "arc",
  tweets: "tweets",
  glossary: "glossary",
  summary: "summary",
  ideas: "ideas",
};

/**
 * The stamp fields as they are spelled inside the artefact itself.
 *
 * Every stamped artefact in this project uses the same three names —
 * `sourceHash`, `version`, `generator` — because they all grew out of
 * src/tweets.ts. Reading them in one place is what lets `sameStamp` be one
 * comparison instead of the three near-identical `…IsCurrent` functions.
 */
interface StampedArtefact {
  sourceHash?: unknown;
  version?: unknown;
  generator?: unknown;
  /** Only `ideas` compares this today — see `StepStamp.profileHash`. */
  profileHash?: unknown;
}

export function stampOf(artefact: unknown): StepStamp {
  const a = (artefact ?? {}) as StampedArtefact;
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
 * Is the recorded stamp one we would write again today?
 *
 * One comparison, in one place. `expected` is what the step would produce now;
 * `recorded` is what the store has. Every field the caller *declares* in
 * `expected` has to match — and a caller that declares nothing gets `false`,
 * not `true`.
 *
 * That last rule is the whole point. An all-undefined expected stamp compared
 * field-by-field against an all-undefined recorded one is trivially equal, and
 * the answer "yes, current" would then mean "nobody checked anything". The
 * safe way to be wrong here is not-current: the cost is one model call, where
 * the other way round is a stale artefact served for ever.
 */
export function sameStamp(recorded: StepStamp | null, expected: StepStamp): boolean {
  if (!recorded) return false;
  const keys = (Object.keys(expected) as (keyof StepStamp)[]).filter(
    (k) => expected[k] !== undefined,
  );
  if (keys.length === 0) return false;
  return keys.every((k) => recorded[k] === expected[k]);
}

/**
 * Where artefacts live, behind one interface, so the pipeline can stop knowing.
 *
 * Two implementations are planned and the seam is the point: the file adapter
 * (src/store/artifacts-fs.ts) writes `data/<slug>/…` exactly as the stages do
 * today, and the Postgres one writes columns on a draft revision. Landing the
 * seam file-backed first means nothing on disk changes and the swap really is
 * one adapter.
 *
 * `slug` identifies the article in both; the Postgres adapter resolves it to
 * the draft revision the current job owns.
 */
export interface ArtifactStore {
  /**
   * Does the store hold **all** of `kinds` for this step, in a state that can
   * actually be read back?
   *
   * All of them, never any of them: `extract` writes the HTML *and*
   * `meta.json`, and a crash between the two must not report a finished step
   * whose successor then consumes the missing half.
   *
   * **It parses; it does not `stat`.** A plain `writeFile` killed halfway
   * leaves a file that exists and will not parse, and an existence check calls
   * that step done. Parsing is the fix, and the review measured the cost:
   * 0.381 ms for a 354 KB `blocks.json`.
   */
  has(slug: string, step: StepName, kinds: readonly ArtifactKind[]): Promise<boolean>;
  /** The artefact, or `null` if it is absent or unreadable. */
  read<K extends ArtifactKind>(
    slug: string,
    step: StepName,
    kind: K,
  ): Promise<ArtifactMap[K] | null>;
  /**
   * Write everything this step produced, in one call.
   *
   * One call rather than one per artefact, so that an adapter which *can* be
   * atomic across the set — Postgres, in one `UPDATE` inside the job's
   * transaction — is given the chance to be. The file adapter cannot: it
   * renames each part into place separately, so a kill between two renames
   * leaves one artefact present and the other missing. That state is
   * well-formed and incomplete, and `has` is what catches it.
   */
  write(
    slug: string,
    step: StepName,
    parts: ArtifactParts,
    stamp: StepStamp,
  ): Promise<void>;
  /**
   * What the store recorded about this step's last run, or `null` when this
   * step records nothing (`fetch`, `extract`, `blocks`) or has not run.
   */
  stampFor(slug: string, step: StepName): Promise<StepStamp | null>;

  /**
   * This step has started. Nothing it has written is to be believed until
   * `finishStep`.
   *
   * **Why the store needs this at all**, since it looks like the queue's job:
   * per-file atomic renames are not atomicity across a step. `extract` writes
   * the HTML *and* `meta.json`; `toc` writes three files. A rerun that replaces
   * one of them with a perfectly valid new one and then dies leaves every path
   * present, parsing, and describing two different generations — and `has`
   * cannot tell, because each artefact is individually fine. A review found
   * exactly that (docs/plans/postgres-storage-implementation.md § What the
   * review of the *built* seam found).
   *
   * So the store records the *attempt*, not just the output. A marker that is
   * still there is a run that did not finish, and a run that did not finish is
   * not done however good its files look.
   *
   * On the filesystem this is a small file; in Postgres it is
   * `revision_step_runs.status = 'running'`, which already exists. Same
   * concept, and that is the point of putting it here rather than in the queue.
   *
   * **Returns an attempt token, and `finishStep` will not accept another's.**
   * The first version returned nothing and cleared a shared marker, which a
   * review took apart in six steps: two runners both start, the second
   * overwrites the first's marker, the first finishes and removes *the
   * second's*, the second then dies half-way through its writes, and the step
   * reports done holding two generations with no marker to say so. Ownership is
   * what closes that. It is the same token
   * `docs/plans/postgres-migration.md#the-traps` fences the Postgres output
   * write with, and it should end up being literally the same value.
   *
   * **This is not a lock, and must not be read as one.** It does not stop a
   * second runner starting — that is the queue's job, and in Postgres the
   * `jobs_only_one_running` index's. What it stops is one runner's `finishStep`
   * speaking for another runner's attempt.
   */
  beginStep(slug: string, step: StepName): Promise<string>;
  /**
   * This step finished, and what it wrote can be believed.
   *
   * Called only on success, and only with the token `beginStep` returned. A
   * step that threw leaves its marker behind on purpose: the next run re-runs
   * it rather than trusting whatever half of its output landed.
   *
   * Clearing a marker that is not there, or that belongs to somebody else, is
   * not an error and is not a no-op worth logging: a step can complete without
   * this store having seen it start — which is every artefact written before
   * this existed, and every stage run from its own CLI.
   */
  finishStep(slug: string, step: StepName, attempt: string): Promise<void>;
  /** Did a run of this step start and never finish? */
  interrupted(slug: string, step: StepName): Promise<boolean>;
}

/**
 * The stamp a caller passes to `write` must be the stamp inside the artefact.
 *
 * On the filesystem there is nowhere else to put it — `sourceHash`, `version`
 * and `generator` are fields of the artefact itself, and that is what
 * `stampFor` reads back. So the `stamp` argument is not stored there; it is
 * *checked*. An unused parameter would be worse than no parameter: it would
 * read as though the store were recording something, and a caller could pass a
 * stamp that contradicts the file it is writing without anything noticing until
 * the step refused to stay done.
 *
 * **Postgres has somewhere else to put it — and still checks.** The stamp goes
 * into `revision_step_runs`, so the two really can disagree there, which is
 * worse rather than better: `stampFor` would then have to pick one. Rejecting
 * the write is the only answer that keeps the row and the artefact meaning the
 * same thing. GPT Sol, 2026-08-28.
 *
 * Only fields the artefact actually carries are compared. An arc has no
 * `sourceHash`, so a caller declaring an `inputHash` for one is not
 * contradicting anything on disk — there is simply nowhere for it to go, and
 * that is the arc's limitation rather than the caller's mistake.
 */
export function assertStampAgrees(
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
