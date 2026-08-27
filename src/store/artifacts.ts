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
 *    `threadIsCurrent` / `glossaryIsCurrent` / `summariesAreCurrent` — the same
 *    three lines written three times.
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
