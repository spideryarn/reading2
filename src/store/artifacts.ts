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
 * questions separately (docs/plans/260826e-postgres-storage-implementation.md § Step 11,
 * half B):
 *
 * 1. **Present** — does the store hold every kind this step produces? The store
 *    answers, from the declaration. Never the step.
 * 2. **Current** — was it made from this article, by this prompt, by this
 *    model? A comparison of the recorded `StepStamp` against the stamp the step
 *    would produce now. That comparison is `sameStamp`, once, rather than the
 *    `glossaryIsCurrent` / `threadIsCurrent` that used to sit beside each
 *    other — the same three lines written twice over. Both are gone:
 *    `glossaryIsCurrent` on 2026-08-28, `threadIsCurrent` in D0 on 2026-08-29
 *    (docs/plans/260827aa-delete-the-importer.md).
 *
 * This file is types and one pure function. The file-backed adapter was
 * src/store/artifacts-fs.ts, deleted 2026-09-05 along with the
 * `SPIDERYARN_STORE` flag that chose between the two; the Postgres one,
 * src/store/artifacts-pg.ts — which src/store/pg-session.ts imports — is what
 * every claimed job runs on now, the only store there is. See the header of
 * src/store/revisions.ts. (It said "nothing in production imports yet" until
 * 2026-09-02, which stopped being true at commit c42c940.)
 *
 * ## The key is `(step, kind)`, not `kind`
 *
 * The obvious shape — `Record<ArtifactKind, path>` — cannot reproduce what the
 * pipeline writes today, and it took a review to notice. `blocks` has **two**
 * destinations: `output/<slug>.blocks.json`, written by the `blocks` step, and
 * `data/<slug>/blocks.json`, written by `hierarchy` so the tree and the blocks it was
 * built from sit together. Keyed by kind alone, one of those disappears and
 * four stages lose the file they read. So every lookup in the adapter takes a
 * step *and* a kind. The same applies to the HTML, which `extract` writes and
 * `blocks` then rewrites with the ids stamped into it — one path, two kinds,
 * two owners.
 */
import type {
  Arc,
  Block,
  Debate,
  Glossary,
  Ideas,
  Meta,
  Quotes,
  StepName,
  Quiz,
  Timeline,
  Tree,
  TweetThread,
} from "../types.js";
import { isDebateDocument } from "../types.js";
import type { LabelsFile } from "../labels.js";
import type { RawManifest } from "../fetch.js";
import type { Assets } from "../assets.js";
import type { Sketch } from "../sketch-scene.js";
import type { Illustrated } from "../illustrated-plate.js";

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
  | "assets"
  | "arc"
  | "tweets"
  | "glossary"
  | "ideas"
  | "quotes"
  | "timeline"
  | "quiz"
  | "sketch"
  | "illustrated"
  | "debate";

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
   * type. GPT Sol's review of docs/plans/260827j-transactional-stage-runner.md: a
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
  /**
   * The article's own images and what became of each — src/assets.ts.
   *
   * The **manifest**, never the bytes: those are content-addressed objects in
   * the `sources` bucket, written through `storeRawSource`, and this is the
   * list saying which of them are this article's. That is deliberately not a
   * folder per article — docs/plans/260829b-hosting-the-articles-images.md § Where the
   * bytes go.
   */
  assets: Assets;
  arc: Arc;
  tweets: TweetThread;
  glossary: Glossary;
  ideas: Ideas;
  quotes: Quotes;
  /**
   * When the piece says things happened, and how sure it is — `Timeline`,
   * src/types.ts, written by the `timeline` step. docs/project/timeline.md.
   */
  timeline: Timeline;
  /**
   * The questions the piece can ask you back — `Quiz`, src/types.ts, written by
   * the `quiz` step. docs/plans/260831al-review-quiz-sub-mode.md.
   */
  quiz: Quiz;
  sketch: Sketch;
  /**
   * The same argument painted — `Illustrated`, src/illustrated-plate.ts,
   * written by the `illustrated` step. docs/project/diagram.md § Illustrated.
   *
   * **The brief and where the pictures are, never the pictures.** Each plate
   * holds an `IllustratedImage` — a sha256, an extension and the dimensions —
   * and the bytes themselves are content-addressed objects in the blob store,
   * put there by `storePlateImage` (src/illustrated-image.ts). Base64 in here
   * would be about 200 KB a plate dragged along by every read of the revision
   * that named this column, which is the same call `assets` made one field up
   * and for the same reason.
   */
  illustrated: Illustrated;
  /**
   * What the rest of the web says about this piece — `Debate`, src/types.ts,
   * written by the `debate` step.
   * docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md.
   *
   * **The only artefact here whose content is not in the article**, and the
   * only one built from two model calls that are one atomic step: two groups,
   * each with its own rows and its own counts, and a failure of either pass
   * writes none of it.
   */
  debate: Debate;
}

/** Some or all of one step's artefacts, handed to `write` in one call. */
export type ArtifactParts = Partial<{ [K in ArtifactKind]: ArtifactMap[K] }>;

/**
 * What a read found, with **"there is no artefact" kept apart from "there is
 * one I cannot use"**.
 *
 * One definition, in the leaf module both adapters already import, for the same
 * reason `SHAPE` lives here: the whole claim the seam makes is that the two
 * stores agree about what a usable artefact is, and two copies of a three-state
 * enum agree on the day they are written and drift silently afterwards.
 *
 * The two states are not the same *thing* in the two stores, and that is a
 * difference in what each can be corrupted by rather than a difference in the
 * rule. On the filesystem `unusable` is a file that will not parse, is of
 * entirely the wrong shape, or is past the ceiling this store can read back. In
 * Postgres a JSONB column cannot be half-written, so it is only the shape check
 * — a value some older code path wrote that no reader can use.
 *
 * There is deliberately no reason string on `unusable`: the adapters already
 * log one, and a second copy carried up here would have nothing reading it.
 * Neither may go near the *value* — that is article prose, which
 * docs/project/logging.md forbids outright.
 */
export type ArtifactOutcome<T> =
  | { state: "ok"; value: T }
  | { state: "absent" }
  | { state: "unusable" };

/* ------------------------------------------------- what a usable one looks like -- */

/**
 * The one shallow shape check per kind, shared by **both** adapters.
 *
 * ## Why it lives here rather than in the file adapter that grew it
 *
 * These rules were written in src/store/artifacts-fs.ts (deleted 2026-09-05),
 * where they answered *"did this file survive being written?"*. The Postgres
 * adapter has to answer
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
  /**
   * Ask `ok` about the **whole document** rather than about `field`, which then
   * names only what the failure message should say.
   *
   * One kind uses it, `debate`, and it is here rather than in a second table
   * because its usability genuinely spans two fields: an artefact with a
   * `direct` group and no `claims` group is half a document, and a check that
   * reads one field cannot see that. Adding a second such kind is a fine reason
   * to keep this; adding a fifth is a reason to give `ok` the document and the
   * field name and be done with it.
   */
  readonly whole?: boolean;
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
  /* An `entries` array, like the arc — and an EMPTY one is perfectly usable:
     an article with no images has a manifest that says so, which is a different
     fact from having no manifest at all (src/assets.ts). */
  assets: { field: "entries", ok: isArray },
  arc: { field: "entries", ok: isArray },
  tweets: { field: "tweets", ok: isArray },
  glossary: { field: "entries", ok: isArray },
  ideas: { field: "ideas", ok: isArray },
  /* A `quotes` array. An EMPTY one is not usable, like the sketch below and
     unlike the assets manifest: `buildQuotes` throws rather than write one,
     because a quote list with nothing in it is a model call that produced
     nothing and storing it would make the step report done for ever. */
  quotes: { field: "quotes", ok: (v) => isArray(v) && (v as unknown[]).length > 0 },
  /* An `events` array, and **an EMPTY one is usable** — the opposite call from
     `quotes` directly above and from `sketch` below, so it is worth saying why.
     Most articles are not chronological: an essay about a concept may hold two
     incidental dates and narrate nothing, and a timeline with no events is the
     correct, expected answer for it (docs/plans/260831i-timeline-mode.md § Most
     articles are not chronological). `buildTimeline` writes one rather than
     throwing, and the panel has a sentence for it. Refusing it here would make
     the commonest correct outcome unstorable, so the step would re-run and pay
     for the same empty answer on every open. */
  timeline: { field: "events", ok: isArray },
  /* A `questions` array, and **an EMPTY one is NOT usable** — the opposite call
     from `timeline` directly above, and worth saying why they differ. An
     article with no chronology is an ordinary article; an article with no
     questions is not a thing, so `buildQuiz` throws rather than write one. An
     empty quiz is indistinguishable from a working one until a reader opens the
     panel and finds nothing to answer, which is
     docs/reusable/silent-success.md exactly. This is the shallow half of that
     rule, at the store boundary, so a hand-written or imported file cannot get
     round it either. */
  quiz: { field: "questions", ok: (v) => isArray(v) && (v as unknown[]).length > 0 },
  /* **`scenes`, and an empty one is NOT usable**, unlike the assets manifest
     two rows up. An article with no images legitimately has an empty list; a
     picture with no scenes is not a picture, and `accept` in
     src/sketch-scene.ts refuses to write one. This is the shallow half of that
     rule, at the store boundary, so a hand-written or imported file cannot get
     round it either. */
  sketch: { field: "scenes", ok: (v) => isArray(v) && (v as unknown[]).length > 0 },
  /* **`plates`, and an empty one is NOT usable**, for the same reason as
     `sketch` directly above: a set of pictures with no pictures in it is not a
     thing, and the step throws rather than write one. Note this checks the
     plates rather than the images — a plate whose own image call failed is
     still a plate, carrying its brief and its `failed` sentence so the panel
     can say which picture is missing (plan § Two hazards). A run where every
     plate failed is a usable artefact that honestly reports four failures, and
     collapsing that into "no artefact" would make the reader press the button
     again and pay for the brief a second time. */
  illustrated: { field: "plates", ok: (v) => isArray(v) && (v as unknown[]).length > 0 },
  /* **`direct`, the group-one container — and an empty `rows` inside it is not
     merely usable, it is the commonest CORRECT answer.** Most articles have no
     critical reception at all, and Greg asked for that state by name: *"If no
     one (or few people) have written about this piece, let's just say so."* So
     this is `timeline`'s call rather than `quotes`' or `quiz`'s, and for a
     stronger reason than timeline has — refusing an empty group one would make
     the expected outcome unstorable, so the step would re-run and pay up to
     $0.27 for the same honest answer on every open.

     What it checks is that the document has the two-group shape at all, which
     is what tells a half-written or hand-edited file from an artefact — **both
     groups' rows, which is why this is the one `whole` row in the table**. It
     asked only whether `direct` was an object until 2026-09-05, so `{direct:{}}`
     passed here while `readDebate` refused it and Postgres served it unchecked:
     three answers to one question (Sol's F29). `isDebateDocument` (src/types.ts)
     is now the only one, and all three readers ask it. */
  debate: { field: "direct", ok: isDebateDocument, whole: true },
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
  const { field, ok, whole } = SHAPE[kind];
  if (field === null) return ok(value) ? null : "empty";
  if (!isObject(value)) return "not an object";
  if (whole) return ok(value) ? null : `no usable "${field}"`;
  return ok((value as Record<string, unknown>)[field]) ? null : `no usable "${field}"`;
}

/* ------------------------------------------- and what a *baseline* needs -- */

/**
 * What a kind needs before it may be believed as an **identity baseline**.
 *
 * ## Why this is not `SHAPE` with more fields in it
 *
 * `SHAPE` answers *did this artefact survive being written* and is asked on
 * every read, by `has`, by `read` and by the metadata page. This answers a
 * different question — *can this artefact carry identity forward* — and it is
 * asked only by `readBaseline`. Folding the two together would make an `arc`,
 * which carries no `sourceHash` at all, refuse to be read.
 *
 * ## The rule that made it necessary, which is the general one
 *
 * **The check that decides "unusable" cannot be shallower than the decision it
 * protects.** `SHAPE.glossary` is `{ field: "entries", ok: isArray }`, so
 * `{entries: [...]}` with no `sourceHash` was classified `ok`. The helper handed
 * it back as a valid baseline, the ordinary `onDisk.sourceHash === sourceHash`
 * comparison then failed the way a genuinely stale artefact fails, and the stage
 * minted every id, reset `passes` and overwrote the baseline **reporting
 * success**. That is the forbidden *unusable → looks like an ordinary mismatch →
 * mint quietly* path, arriving by the one door the four-state table did not
 * cover. GPT Sol, 2026-08-28.
 *
 * Staleness is judged on the hash, so a classifier that never reads the hash
 * cannot tell a stale artefact from a broken one. Identity is carried by the
 * item ids, so an artefact whose ids are missing or duplicated is not a usable
 * baseline either, hash or no hash.
 *
 * ## What it deliberately does not check
 *
 * **Not the whole schema** — only what the two decisions read. The prose
 * fields, the aliases, the occurrences and the scores can all be wrong without
 * making the *identity* unreadable, and a stage that refused over a missing
 * `background` would be refusing over something it is about to rewrite anyway.
 *
 * **And not the hash's shape.** `hashBlocks` is 16 hex characters today and
 * `inputFingerprint` is two of them with a dot between; pinning either here
 * would mean that the day the digest changes, every artefact on every shelf
 * becomes "unusable" and every one of these stages stops — turning a routine
 * staleness into a hard failure across the whole corpus. An old hash from a
 * scheme we no longer compute is *stale*, which is row two of the table and
 * correct. So the test is only that the comparison **can be made at all**: a
 * string, not empty, and with no whitespace in it, because a hash never
 * contains whitespace and a value that does has been hand-edited or truncated
 * rather than written by an older us.
 */
export interface BaselineRule {
  /**
   * The field the staleness comparison reads, or `null` for a kind that has no
   * such comparison and must not be made to require one.
   *
   * `STAMP_SOURCE`'s own note says `fetch`, `extract` and `blocks` write no
   * `sourceHash`, and that `tree.json` and `arc.json` carry none at all.
   */
  readonly hashField: string | null;
  /** The array whose elements carry the identity. */
  readonly itemsField: string;
  /** The field on each element that **is** the identity. */
  readonly idField: string;
  /**
   * The field each element is looked up *by* when identity is inherited —
   * `idsByTerm` and `idsByName` both key on `name` — or `null` for a stage
   * whose key is not a field.
   *
   * Included because an element with an id and no key cannot lend that id to
   * anything, and because both of those functions call `normalise…(entry.name)`
   * on it, which throws on an absent one. Loud rather than silent, so this is
   * not the data-loss class — it is a `TypeError` from inside a matcher turned
   * into a sentence that says which artefact to restore.
   *
   * **`null` is `timeline`, and it is a real case rather than an escape hatch.**
   * That stage cannot key on a name: it was measured, and only 7 of 26 labels
   * survived a regeneration of the same article by the same prompt, so keying on
   * one would have orphaned nineteen `?event=` links in a single re-run. It keys
   * on the two things that were actually *validated* — the cited block ids and
   * the parsed date — which is `evidenceKey` in src/timeline.ts and is two
   * fields rather than one. A row naming `label` here would compile, pass, and
   * be a lie about which field carries identity. What `null` costs is the check
   * below, and it costs nothing this stage needs: `idsByEvidence` skips an event
   * it cannot key instead of throwing, because the artefact it is reading was
   * written by whatever version of that file was current at the time.
   */
  readonly keyField: string | null;
}

/**
 * Every kind that may be read as an identity baseline, and what one needs.
 *
 * **A kind absent from this table cannot be read as a baseline at all** —
 * `readBaseline` throws rather than skipping the check. That is the point of
 * the shape: the alternative, returning `ok` for an undeclared kind, is a
 * check that silently covers nothing, which is the whole family of bug this
 * table was added to close. Adding a third identity-carrying stage therefore
 * means writing down what its baseline is, which is exactly the moment to think
 * about it.
 *
 * `blocks` is not here because stage 3 does not come through this door: its
 * second question is `hasEarlierBlocks`, asked of a *different* artefact,
 * because its own artefact is the baseline. If it ever moves over, its row is
 * `{ hashField: null, itemsField: "blocks", idField: "id", keyField: "text" }`
 * — and `hashField: null` is why that field is nullable.
 */
export const BASELINE: Partial<Record<ArtifactKind, BaselineRule>> = {
  glossary: {
    hashField: "sourceHash",
    itemsField: "entries",
    idField: "id",
    keyField: "name",
  },
  ideas: { hashField: "sourceHash", itemsField: "ideas", idField: "id", keyField: "name" },
  /* `keyField: "text"` because a quote HAS no name — its identity is the
     author's own words, which is also why this key is the most reliable of the
     three: unlike a term's gloss or an idea's statement, the prose does not get
     rewritten between runs. src/quotes.ts § `idsByText`. */
  quotes: { hashField: "sourceHash", itemsField: "quotes", idField: "id", keyField: "text" },
  /* `keyField: null` — the only one, and `BaselineRule.keyField` has the
     measurement that made it null rather than `"label"`. The other three fields
     are the ordinary ones: ids must be present and unique, or an id handed out
     twice sends a reader's `?event=` link to the wrong event, which is worse
     than sending it nowhere. */
  timeline: { hashField: "sourceHash", itemsField: "events", idField: "id", keyField: null },
};

/** A hash we could compare — see `BaselineRule` for why the test is this weak. */
function isComparableHash(v: unknown): boolean {
  return typeof v === "string" && v.length > 0 && !/\s/.test(v);
}

/**
 * Why this value cannot be believed as a baseline for this kind, or `null` when
 * it can.
 *
 * Shared by both adapters, like `whyUnusable`, and for the identical reason:
 * the claim the seam makes is that the two stores agree about what a usable
 * baseline is, and two copies of the rule agree on the day they are written.
 *
 * **The reason never quotes the value.** It names a field and an index — that
 * is article prose in there (docs/project/logging.md).
 *
 * **It reports the first fault, not all of them.** A baseline is restored
 * whole; a list of six broken entries and a list of one are the same action.
 */
export function whyUnusableAsBaseline(kind: ArtifactKind, value: unknown): string | null {
  const shape = whyUnusable(kind, value);
  if (shape) return shape;

  const rule = BASELINE[kind];
  if (!rule) {
    /* Not a silent pass. A caller asking for a baseline of a kind nobody has
       said what a baseline means for is a programming error, and answering
       "fine" would be a check that covers nothing. */
    throw new Error(
      `"${kind}" has no BaselineRule, so it cannot be read as an identity baseline ` +
        "(src/store/artifacts.ts § BASELINE). Add a row saying which field carries the " +
        "staleness hash, which array carries the identity, and what its id and key are.",
    );
  }

  const record = value as Record<string, unknown>;
  if (rule.hashField !== null && !isComparableHash(record[rule.hashField])) {
    return `no comparable "${rule.hashField}"`;
  }

  const items = record[rule.itemsField] as unknown[];
  const seen = new Set<string>();
  for (const [i, item] of items.entries()) {
    if (!item || typeof item !== "object") return `${rule.itemsField}[${i}] is not an object`;
    const row = item as Record<string, unknown>;
    const id = row[rule.idField];
    if (typeof id !== "string" || id.length === 0) {
      return `${rule.itemsField}[${i}] has no "${rule.idField}"`;
    }
    /* Duplicates are the quiet half. `idsByTerm` and `idsByName` are both
       first-writer-wins, so the second holder of a repeated id loses it and
       mints a fresh one — and every `?term=` link that meant the second now
       resolves to the first. A link that lands on the wrong entry is worse
       than one that lands on nothing. */
    if (seen.has(id)) return `two ${rule.itemsField} share one "${rule.idField}"`;
    seen.add(id);
    if (rule.keyField !== null) {
      const key = row[rule.keyField];
      if (typeof key !== "string" || key.trim().length === 0) {
        return `${rule.itemsField}[${i}] has no "${rule.keyField}" to be matched by`;
      }
    }
  }
  return null;
}

/* ----------------------------------------- one column, two different facts -- */
/**
 * `Meta.rawSha256` rebuilt from a revision's columns — **the PDF's hash, or
 * nothing at all.**
 *
 * `article_revisions.raw_sha256` and `Meta.rawSha256` have the same name and
 * are not the same fact, which is the whole reason this function exists:
 *
 * - **The column is stage 1's**, written from `RawManifest.sha256` by the `raw`
 *   write, and it is populated for *every* fetch. An HTML page has one.
 * - **The field is stage 2's, and PDFs only.** src/types.ts calls it "PDFs
 *   only. Absent on everything Readability extracted", and src/pdf-read.ts is
 *   the only thing that writes it — in the same object literal as
 *   `source: "pdf"`.
 *
 * So `source` is what this reads, and deliberately not the raw document's kind:
 * the question is *did stage 2 put this in `meta.json`*, and `source: "pdf"`
 * and `rawSha256` come from one producer in one literal. The two can never
 * disagree, which a kind sniffed from the bytes could.
 *
 * Handing the column straight to `Meta` puts a PDF-only field on every HTML
 * article that has been fetched since the raw manifest landed. That was true in
 * all three places that rebuild a `Meta` from columns — `readMeta`
 * (src/store/artifacts-pg.ts), `metaFrom` (src/store/pg.ts) and the `meta.json`
 * the exporter writes (src/store/export.ts) — and invisible until 2026-08-28,
 * because until then no HTML article in `data/` had a `raw.json` at all and so
 * every row with a hash really was a PDF. One rule in one place rather than the
 * same condition spelled three times, because it has already survived being
 * copied three times.
 */
export function metaRawSha256(row: {
  source: string | null;
  rawSha256: string | null;
}): string | null {
  return row.source === "pdf" ? row.rawSha256 : null;
}

/* ------------------------------------------------------ the two constants -- */
/**
 * What `revision_step_runs.implementation_version` says for a row this seam
 * wrote, and it is load-bearing that it is **not** `"imported"`.
 *
 * The importer withdrew inferred rows by deleting everything stamped `imported`
 * whose artefact had gone (src/store/import.ts, deleted 2026-09-01), scoped that
 * way precisely so that *a migration tool cannot delete a pipeline record*. A row
 * from here carrying that marker would have been inside the blast radius of every
 * `npm run db:import`.
 *
 * The importer is gone and nothing in `src/` writes `"imported"` any more. The
 * distinction is kept because it is the reason this constant has a name and a
 * comment rather than being a bare string, and the next bulk tool inherits it.
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
 * docs/plans/260826e-postgres-storage-implementation.md § Staleness stays computable),
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
   * A fingerprint of what went in, stored on disk as `sourceHash`.
   *
   * **One hash is not right for every step**, and this field said so as a
   * warning until 2026-08-31. It is now a fact about two groups rather than a
   * hazard:
   *
   * - `assets` hashes the blocks alone (`hashBlocks`, src/source-hash.ts),
   *   because a list of images to fetch is all it is built from.
   * - Every stage whose prompt reads the article hashes the blocks, the tree
   *   **and its own prompt head** — and there are two heads, so there are two
   *   functions (src/source-hash.ts). `arc`, `tweets`, `glossary` and
   *   `quotes` send `articleText` and use `articleFingerprint`; `ideas` and
   *   `sketch` send `articleWithIds`, whose head also prints a `URL:` line and
   *   falls back to a synthetic title, and use `articleWithIdsFingerprint`.
   *   Most of them hashed the blocks alone, and the ones that did not still
   *   missed the head — so the sections could be re-cut, or the page
   *   re-extracted under a different headline, and every one of them reported
   *   itself current.
   *
   * Harmless only while the pipeline's artefact reads answer `null` and the
   * stage re-runs regardless — which is what made it invisible.
   * docs/plans/260831b-finish-the-database-move.md § stage 1.
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
 * **Total, and three rows are an explicit `null`.** `fetch`, `extract` and
 * `blocks` record nothing about what they were made from, so their stamp is
 * `null` and the only question that can be asked of them is presence — which is
 * why the truncation hazard was invisible for them and why `has` had to start
 * parsing. They are written down rather than left out so that the two cases can
 * be told apart: see the note on the table itself.
 *
 * `hierarchy` reads its stamp off **`labels.json`, not `tree.json`**, and that is
 * worth stating because it looks backwards. The tree is the headline artefact,
 * but it carries only `version` and `generator`; `labels.json` is the one that
 * records `sourceHash` — the blocks it was written against — and
 * `structureHash` besides. So it is the only output of stage 4 that can answer
 * "is this still about the current article".
 */
export const STAMP_SOURCE: Record<StepName, ArtifactKind | null> = {
  /* The three that stamp nothing — stated, not omitted. `stampFor` reads a
     `null` here exactly as it read a missing key before, so behaviour is
     unchanged; what changed is that "we decided this step has no stamp" and
     "somebody forgot a row" are now different things on the page. */
  fetch: null,
  extract: null,
  blocks: null,
  hierarchy: "labels",
  assets: "assets",
  arc: "arc",
  tweets: "tweets",
  glossary: "glossary",
  ideas: "ideas",
  quotes: "quotes",
  timeline: "timeline",
  /* **A row here is no longer optional: leave one out and `npm run typecheck`
     names the step.** It used to be a `Partial`, and a missing row made
     `stampFor` answer `null` silently — so the step was never current and
     re-ran on every job for ever, writing a perfectly good artefact each time
     with nothing going red, because the artefact parses and every id resolves.
     The compiler now catches the omission; what it cannot catch is a *wrong*
     answer, so `null` still means "this step stamps nothing", and writing it
     for a step that does stamp something buys back the whole failure. That is
     the same failure as spelling the artefact's stamp fields
     `inputHash`/`promptVersion`/`model`, one door along, and
     tests/quiz-step-registration.test.ts asks for this row by name and value.

     **And deliberately NO `BASELINE` row.** There is no id inheritance across
     runs (src/pipeline.ts § the `quiz` step), and `readBaseline` throws for a
     kind with no row precisely so that nothing can half-inherit. */
  quiz: "quiz",
  sketch: "sketch",
  illustrated: "illustrated",
  /* **And deliberately NO `BASELINE` row**, like `quiz` above and for the same
     reason: there is no id inheritance across runs, marks in the prose are not
     in v1, and `readBaseline` throws for a kind with no row precisely so that
     nothing can half-inherit. */
  debate: "debate",
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
 * There were two implementations, and the seam was the point: the file
 * adapter (src/store/artifacts-fs.ts) wrote `data/<slug>/…`, and the Postgres
 * one (src/store/artifacts-pg.ts) writes columns on a draft revision. The file
 * adapter was deleted 2026-09-05, so Postgres is the only one now — but every
 * stage still returns a product and calls `write()` rather than writing a file
 * itself (docs/project/database.md), and this interface is still where that
 * happens.
 *
 * `slug` identifies the article; the Postgres adapter resolves it to
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
  /**
   * Has an **earlier run** of this article already produced blocks — so that
   * stage 3 reading no baseline means something is wrong rather than that this
   * is a first ingest?
   *
   * The one question stage 3 cannot answer from its own artefact, and the
   * reason it needs asking is that the two states look identical from there:
   * `read(slug, "blocks", "blocks")` returns `null` for a brand-new article,
   * where minting every id is the only correct thing to do, and `null` again
   * when a baseline that should have been carried forward is not there, where
   * minting every id destroys every anchor into the article and reports
   * success. See `previousBlocksFrom` in src/blocks.ts.
   *
   * **It is deliberately not `has`.** In Postgres `beginDraftIn` copies the
   * published revision's completion rows into a new draft along with its
   * blocks, so `has(slug, "blocks", …)` answers *"did an earlier run finish"* —
   * true of a draft whose block rows have since been deleted.
   *
   * Each store answers with the thing it actually knows, and neither can
   * usefully imitate the other:
   *
   * - **Postgres** — does `articles.current_revision_id` point at a published
   *   revision? If it does, `beginDraftIn` copied that revision's blocks into
   *   this draft, and a publication cannot happen without blocks.
   * - **The filesystem** — has stage 4 ever written `data/<slug>/blocks.json`
   *   for this article? There are no revisions on disk, so the previous full
   *   run is the closest true statement, and it is the same pair of files the
   *   warning this replaced used to count.
   *
   * **A file it cannot read answers `true`**, which is the half this got wrong
   * until 2026-08-28 and is worth the paragraph. The filesystem adapter used to
   * read through `readOne`, where absent and corrupt and over-the-ceiling are
   * one answer — `null` — so a half-written `data/<slug>/blocks.json` said *no
   * earlier run* and stage 3 minted a whole new identity set, quietly. The
   * comment here defended that: nothing left to carry, so nothing lost. It is
   * the wrong question. Whether the ids are recoverable is not whether to
   * proceed — a person with a backup can put the file back, and minting removes
   * that possibility while reporting success. So the question this method really
   * asks is *is there earlier block history*, usable or not, and the adapter
   * answers it from `readOutcome`. Postgres has no equivalent state: a uuid
   * column is there or it is not.
   */
  hasEarlierBlocks(slug: string): Promise<boolean>;
  /** The artefact, or `null` if it is absent or unreadable. */
  read<K extends ArtifactKind>(
    slug: string,
    step: StepName,
    kind: K,
  ): Promise<ArtifactMap[K] | null>;
  /**
   * The same read, with **"there is none" kept apart from "there is one I
   * cannot use"** — for the callers where those are opposite answers.
   *
   * `read` flattens both to `null`, which is right for every caller deciding
   * whether to re-run a step: both mean *do the work again*, and the work
   * rewrites the artefact either way.
   *
   * It is wrong for the two stages that read their **own previous artefact to
   * keep identity across runs**. `glossary` inherits its entry ids from the
   * previous list, and `ideas` inherits its idea ids; a `null` there means
   * *first run, mint everything*, and that is correct exactly when there was
   * nothing to inherit. A `glossary.json` truncated by a kill mid-write is not
   * that case: every id the reader's `?term=` links name is still in those
   * bytes, somebody with a backup can put the file back, and minting over it
   * takes that possibility away while reporting success. So those two ask this
   * instead, and refuse on `unusable` — see `previousGlossaryFrom` in
   * src/glossary.ts and `previousIdeasFrom` in src/ideas.ts.
   *
   * **This is the same distinction `hasEarlierBlocks` makes and deliberately
   * not the same question.** Stage 3 cannot ask it of its own artefact, because
   * its own artefact *is* the baseline and a missing one could only ever report
   * that it is missing; it has to ask a second source — stage 4's copy on the
   * filesystem, the published-revision pointer in Postgres. Glossary and ideas
   * have one copy each, so the honest second question is about that same copy,
   * and it is this one. Two shapes of question, because there are two shapes of
   * artefact, and collapsing them would mean one of the two lying.
   *
   * Errors are **not** an outcome here: a connection that dropped or a
   * permission Postgres refused propagates, exactly as it does through `read`.
   * Turning an infrastructure fault into an answer is how a database hiccup
   * becomes permanent identity loss.
   *
   * **`unusable` here is a deeper question than `read`'s**, and that is the
   * whole reason this is a separate method rather than a wrapper. It runs
   * `whyUnusableAsBaseline`, not just `SHAPE`: an artefact with a usable array
   * and no `sourceHash` passes the shape check, and then the staleness
   * comparison fails exactly the way a genuinely stale one fails — so the stage
   * mints every id and reports success. Only `readBaseline` asks the deeper
   * question, so nothing that merely reads an artefact changes behaviour.
   *
   * **A kind with no `BaselineRule` throws.** There are two callers and two
   * rows in `BASELINE`; a third stage has to say what its baseline is before it
   * can ask for one.
   */
  readBaseline<K extends ArtifactKind>(
    slug: string,
    step: StepName,
    kind: K,
  ): Promise<ArtifactOutcome<ArtifactMap[K]>>;
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
   * the HTML *and* `meta.json`; `hierarchy` writes three files. A rerun that replaces
   * one of them with a perfectly valid new one and then dies leaves every path
   * present, parsing, and describing two different generations — and `has`
   * cannot tell, because each artefact is individually fine. A review found
   * exactly that (docs/plans/260826e-postgres-storage-implementation.md § What the
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
   * `docs/plans/260825f-postgres-migration.md#the-traps` fences the Postgres output
   * write with, and it should end up being literally the same value.
   *
   * **This is not a lock, and must not be read as one.** It does not stop a
   * second runner starting — that is the queue's job, and in Postgres the
   * article's line and the counted cap, both inside `claim`. What it stops is one
   * runner's `finishStep` speaking for another runner's attempt.
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
 * Everything the **run phase** of a step may ask, and nothing it may do.
 *
 * A stage decides what to make by reading; it should not be able to write while
 * it decides. Handing `run` the whole `ArtifactStore` let it, and under Postgres
 * that means a write landing outside the transaction that is supposed to hold
 * the step together — so the seam is a type rather than a rule anybody has to
 * remember. `ArtifactStore` is assignable to this, so a caller with the real
 * thing passes it unchanged.
 *
 * **The six are what the stages actually ask for**, checked rather than
 * guessed: `read` and `hasEarlierBlocks` (src/blocks.ts § `previousBlocksFrom`),
 * `readBaseline` (src/glossary.ts, src/ideas.ts), and `has`, `interrupted` and
 * `stampFor`, which are `stepIsDone`'s three questions (src/pipeline.ts) — the
 * preflight that decides whether `run` is called at all.
 *
 * **Not the same thing as `ReadOnlyArtifactStore`** (src/store/artifacts-pg.ts),
 * which names four, and the difference is deliberate on both sides. That one is
 * a *view a Postgres executor can serve outside a transaction*, and it stops at
 * four because `readBaseline` and `hasEarlierBlocks` have no caller out there:
 * the two stages that inherit ids from their own previous artefact run inside
 * the job's transaction. This one is a *capability the run phase is given*, and
 * it has to cover every read those stages make, transaction or not. So the
 * Postgres session's `reads` is the four-method view **plus** those two, and
 * naming them separately is what keeps "what an executor can serve" from
 * quietly becoming "what a stage may ask".
 */
export type ArtifactReads = Pick<
  ArtifactStore,
  "has" | "hasEarlierBlocks" | "read" | "readBaseline" | "stampFor" | "interrupted"
>;

/**
 * Everything `copyArtefacts` asks of the store it copies **from** — two
 * methods, checked rather than assumed (src/store/copy-artefacts.ts).
 *
 * A third narrowing of `ArtifactStore`, and the header on `ArtifactReads`
 * argues why these are not folded together: each names a *capability somebody
 * is given*, and a type that is the union of three jobs is a type that stops
 * refusing anything. This one exists so that a **source that cannot write** —
 * `tests/helpers/fixture-artefacts.ts`, a reader over the committed corpus —
 * can be a source without seven throwing stubs standing in for methods the copy
 * never calls. `ArtifactStore` is assignable to it, so every existing caller
 * passes unchanged.
 */
export type ArtifactSource = Pick<ArtifactStore, "read" | "stampFor">;

/**
 * Refused before the write: this product is not one a commit may act on.
 *
 * **Its own type so that it survives `guardDbStore`.** The transactional
 * session returns its object through that wrapper (src/store/db-errors.ts),
 * which replaces every error not on its allowlist with *"this app asked its
 * database for something it would not do"* — and none of these four refusals
 * ever reaches a database. Scrubbed, the one sentence saying **which** rule was
 * broken and **which** artefact was missing is gone, the guard logs
 * `database call failed` for a call nobody made, and whoever is converting a
 * stage is sent to the store. Measured, 2026-08-30, by asking for the message.
 *
 * **It lives here rather than beside `checkProduct` in src/store/session.ts**, and
 * that is a cycle rather than a preference: `db-errors.ts` has to import the
 * class to recognise it, `session.ts` imports src/pipeline.ts for real, and
 * pipeline → src/jobs.ts → pg-jobs.ts → db-errors.ts closes the loop. `npm run
 * check` gates on cycles. This module imports nothing at runtime, which is what
 * makes it the place.
 *
 * It qualifies for that allowlist on the test the allowlist states: the type is
 * closed and its message is built from values *we* chose — a `StepName` and
 * `ArtifactKind`s, both closed unions declared in this repo. Nothing a reader,
 * a page or a model wrote can reach it. Exactly the argument
 * `CheckpointRequestError` is on the list for.
 */
export class ProductRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductRefused";
  }
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
