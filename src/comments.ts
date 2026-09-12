/**
 * **What a comment *is*** — the shapes, the refusals and the swept sentence
 * that `pgCommentStore` (src/store/pg-comments.ts) is written against.
 *
 * Every write went to Postgres on 2026-09-05, and the file-writing half of this
 * module went with `src/store/fs.ts`
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § G).
 * What is left is the vocabulary — `NewComment`, `MarkPatch`, `AnswerPatch`,
 * `CommentIdTaken`, `NotAnExplanation`, `COMMENT_SWEPT` — plus `loadComments`,
 * which now has exactly one caller: `tests/helpers/seed-reader-state.ts`, which
 * reads a fixture's `data/<slug>/comments.json` into Postgres rows. It is a
 * fixture reader, not a store.
 *
 * See docs/project/comments.md.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Comment, CommentAnchor } from "./types.js";
import { errorFields, log } from "./log.js";
import { parseJsonFrom } from "./parse-json.js";
import { assertSlug } from "./slug.js";

/**
 * What may be logged from this file: ids, slugs, counts, statuses.
 *
 * **Never `quote`, never `answer`, never the block's text.** A comment is the
 * reader's private note about what they were reading, and a log is the one place
 * in this app where private text turns into a durable copy nobody chose to keep.
 * `redact` in log.ts matches key names rather than values, so it cannot help
 * here — the only thing that keeps prose out of the log is not putting it in.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

const fileFor = (slug: string) => path.join(ROOT, "data", slug, "comments.json");

export async function loadComments(slug: string): Promise<Comment[]> {
  assertSlug(slug);
  try {
    /* `parseJsonFrom`, not `JSON.parse`: V8's own parse error quotes the first
       characters of the malformed input back, and those characters are the
       reader's own questions. The `error` line below keeps `message` and
       `stack`, so it would have been written down twice. src/parse-json.ts. */
    const parsed = parseJsonFrom<{ comments?: Comment[] }>(
      await readFile(fileFor(slug), "utf8"),
      `comments.json for ${slug}`,
    );
    return parsed.comments ?? [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    // **error, and the highest-stakes line in this file.** No file yet is
    // normal; a file that exists and will not parse means the reader's
    // questions and answers are unreadable, which is the worst data loss this
    // app can currently cause. Without this the only symptom is a failed
    // request. It is also one of the four drivers in tests/parse-json.test.ts:
    // the line below must name the file without quoting a byte of it.
    log("store").error({ slug, ...errorFields(err) }, "comments file unreadable");
    throw err;
  }
}

/**
 * A free comment as the route hands it to the store: words in a block, or —
 * with no `quote` and no `start` — the whole block. `CommentAnchor` in
 * src/types.ts.
 */
export type NewComment = NewCommentFields & CommentAnchor;

interface NewCommentFields {
  blockId: string;
  /**
   * The reader's own words, already trimmed by the route.
   *
   * Absent for a bare bookmark. **Never `""`** — the route drops an empty
   * string rather than passing one down, so there is one representation of
   * "they wrote nothing" and not two that compare unequal.
   */
  body?: string;
  /**
   * Minted by the client, so the dialog and `?note=` have a real id from the
   * first frame and nothing has to be swapped when the answer lands. Refused if
   * it collides with a *different* comment, and re-minted here if absent.
   */
  id?: string;
  /**
   * **The referee's mark on a passage, when there is one** — which of their
   * criteria this note answers, and where they placed the passage on it.
   *
   * Absent on an ordinary reading note. Both are the reader's own, already
   * checked by the route: `criterionId` names a criterion this reader has on
   * this article, and `valence` has been through `markProblem`
   * (src/referee-criteria.ts) rather than through anything that clamps a
   * confidence. **Never `""` and never a fractional or out-of-range number** —
   * the route refuses those rather than passing them down, so the two stores
   * cannot disagree about what a placement is.
   *
   * A `valence` without a `criterionId` is refused for the same reason
   * `comments_valence_needs_criterion` refuses it: a placement with nothing to
   * place it on is a number against nothing.
   */
  criterionId?: string;
  valence?: number;
}

/**
 * A placement as `patchMark` writes it — **both halves, and `null` for none**.
 *
 * Not `Pick<NewComment, "criterionId" | "valence">`, and the difference is the
 * whole point. `NewComment` says "there is no placement" by leaving the fields
 * off, because `exactOptionalPropertyTypes` is on and the two stores are
 * compared structurally, so a `null` on one side against an absent key on the
 * other is a real failure. An *edit* cannot say "clear this" with an absent
 * key — absent would have to mean either *leave it* or *remove it*, and a
 * client one missing branch away from the wrong reading would destroy a
 * judgement with nothing erroring. So a patch says it with `null`.
 *
 * The two halves travel together because they are one value: a `valence` with
 * no `criterionId` is a number against nothing. `tidyMark` (src/routes.ts) is
 * the one validator, and it hands this shape to the store and the absent-key
 * shape to `create`.
 */
export interface MarkPatch {
  criterionId: string | null;
  valence: number | null;
}

/**
 * Thrown when a client-minted id is already taken by a different comment.
 *
 * **The `status` is the whole of it, and it is here because of a live 500.**
 * Both comment stores throw this, but only the Postgres one — which is what
 * production runs — sits behind `guardDbStore` (src/store/db-errors.ts), and
 * that wrapper replaces every error it has not been told to keep. So the
 * `instanceof` in src/routes.ts never matched, and an ordinary "somebody
 * already has that id" conflict reached the reader as a 500. It went unseen for
 * as long as the suite covering it ran against the *filesystem* store, where
 * nothing wraps the throw. docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md.
 *
 * A numeric `status` is the door that wrapper already holds open, and it is
 * what every other store-side refusal in this codebase uses —
 * `PublishRefused`, `NotTheLiveAttempt`, `StepRunNotHeld` and
 * `NoStoredDocument`. The rejected alternative was a sixth `instanceof` line in
 * `mayPassThrough`: it works, and it leaves the trap exactly where it was,
 * because that list is an allowlist of *classes* and every new refusal type has
 * to remember to join it. This one did not, and it is the second not to.
 *
 * src/routes.ts still has a matching `instanceof` branch. It is a second door
 * to the same number and is now unreachable — the `status` line above it wins —
 * but the number lives here, so the two cannot disagree about the answer.
 *
 * **The message may contain only words we chose**, which is the test
 * src/store/db-errors.ts sets for anything it lets through. This one is a fixed
 * sentence and an id: no quote, no body, no title. Both callers gate the id
 * with `isSpideryarnId` before the store sees it (`createFree` and `answer` in
 * src/routes.ts), so `spya-k3m9qt` is the most it can ever be.
 */
export class CommentIdTaken extends Error {
  readonly status = 409;
  constructor(readonly id: string) {
    super(`A different comment already has the id ${id}`);
    this.name = "CommentIdTaken";
  }
}

/**
 * Thrown by `beginAnswer` for an id that cannot be answered.
 *
 * Three reasons, and they are three different answers to the reader: `missing`
 * is a 404, `free` is a bookmark that was never a question, and `running` is an
 * answer already on its way. Collapsing them would make a deleted comment read
 * as "you cannot answer that".
 *
 * **So `status` is computed rather than fixed**, and it is on the class for the
 * same reason `CommentIdTaken`'s is — read the note there; behind Postgres this
 * class was answering 500 where the route means 404. Assigned in the body from
 * the parameter rather than as a field initialiser, because the order in which
 * TypeScript emits parameter properties and field initialisers is not something
 * a reader of this file should have to know.
 */
export class NotAnExplanation extends Error {
  readonly status: number;
  constructor(readonly id: string, readonly why: "missing" | "free" | "running") {
    super(
      why === "missing"
        ? `No comment with the id ${id}`
        : why === "running"
          ? `Comment ${id} is already being answered`
          : `Comment ${id} was never a question, so there is nothing to answer`,
    );
    this.name = "NotAnExplanation";
    this.status = why === "missing" ? 404 : 409;
  }
}

/**
 * The only fields the legacy answer path may write.
 *
 * Deliberately **not** `Partial<Comment>`: that shape is what let one generic
 * patch reach the anchor, the reader's words and the linked conversation, which
 * is exactly what the named operations exist to prevent.
 */
export type AnswerPatch = Pick<Partial<Comment>, "status" | "answer" | "citations" | "searches" | "model" | "error">;

/**
 * What both comment sweeps write. One constant, so they cannot drift.
 *
 * The words are the ones `sweepOrphaned` in src/routes.ts wrote before the rule
 * moved into the stores, unchanged: the reader has seen this sentence and there
 * is nothing wrong with it. `CHAT_SWEPT` in src/chat.ts is its sibling;
 * `SEARCH_SWEPT` lives in src/store/pg-searches.ts.
 */
export const COMMENT_SWEPT = "The server stopped before this was answered.";
