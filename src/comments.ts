/**
 * Reader comments on disk — `data/<slug>/comments.json`.
 *
 * Reader state, so it goes beside the article rather than into it, in the slot
 * architecture.md § Storage already reserves for progress/highlights/notes. It
 * is written to `data/<slug>/` even when the article itself was served from the
 * `example/` fixture: the fixture is committed and shared, a reader's questions
 * are neither, and `data/` is gitignored. `loadArticle` requires *both*
 * blocks.json and tree.json before it will accept a directory, so a lone
 * comments.json cannot make an empty `data/<slug>/` shadow the fixture.
 *
 * Transport-free on purpose, like src/api.ts — the routes in vite.config.ts are
 * a thin wrapper, and a standalone server would wrap the same functions.
 *
 * See docs/project/comments.md.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Comment } from "./types.js";
import { isSpideryarnId, mintUniqueId } from "./ids.js";
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

/**
 * Read-modify-write serialised per process.
 *
 * Selecting two passages in quick succession is the *normal* way to use this,
 * and each one is a slow request that ends in a whole-file write. Without the
 * chain the second read starts before the first write lands and the first
 * comment vanishes — with no error anywhere, since both writes succeeded.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

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
    // app can currently cause. It wedges every comment for the article at once
    // — see the note on `save` below for how one gets into that state. Without
    // this the only symptom is a failed request.
    log("store").error({ slug, ...errorFields(err) }, "comments file unreadable");
    throw err;
  }
}

/**
 * Write the file so a reader never sees a half-written one.
 *
 * `writeFile` truncates first and then writes, so there is a window in which
 * `comments.json` is empty or cut off mid-object. Land in it — the process is
 * killed, `npm run dev` restarts mid-write — and every later read throws on the
 * JSON, which wedges every comment for that article rather than losing the one
 * that was being written. Writing a neighbour and renaming over the top makes
 * the swap atomic: a reader gets the whole old file or the whole new one.
 *
 * The temp file goes in the same directory on purpose. `rename` is only atomic
 * within a filesystem, and /tmp is routinely a different one.
 */
async function save(slug: string, comments: Comment[]): Promise<void> {
  const file = fileFor(slug);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temp, JSON.stringify({ comments }, null, 2), "utf8");
    await rename(temp, file);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}

/** Apply `mutate` to the stored list and write the result back. */
export function update(
  slug: string,
  mutate: (comments: Comment[]) => Comment[],
): Promise<Comment[]> {
  assertSlug(slug);
  return serialised(async () => {
    const next = mutate(await loadComments(slug));
    await save(slug, next);
    return next;
  });
}

export interface NewComment {
  blockId: string;
  quote: string;
  start: number;
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

/** Is this the same passage? The three fields that may never be rewritten. */
function sameAnchor(a: Comment, b: NewComment): boolean {
  return a.blockId === b.blockId && a.quote === b.quote && a.start === b.start;
}

/**
 * Is this the same referee mark? Part of what "the same Save arriving twice"
 * means, for the same reason the body is.
 *
 * A second POST under a stored id carrying a **different** placement is not a
 * retry — it is a re-score, and letting it through `create` would silently
 * overwrite a judgement the referee already made. It gets `CommentIdTaken` and
 * a 409, exactly as a changed body does.
 */
function sameMark(a: Comment, b: NewComment): boolean {
  return (a.criterionId ?? undefined) === b.criterionId && (a.valence ?? undefined) === b.valence;
}

/**
 * Store a free comment — the reader's mark on a passage. **No model call, ever.**
 *
 * `status: "none"` says exactly that, and it is what keeps a bookmark out of
 * `sweepOrphaned`, which turns an abandoned `pending` row into an error: a
 * bookmark is not an answer that never arrived.
 *
 * ## Idempotent means *return the one you have*, not *overwrite it*
 *
 * This function used to reset the row a colliding id named, because the only
 * caller was a retry of the model call and resetting was the point. Reopening
 * creation makes that destructive: a new bookmark carrying an id that already
 * exists is indistinguishable from a retry, so the reset would silently
 * overwrite a comment the reader made earlier in another tab, anchor and all.
 * Found by GPT Sol reviewing this plan, 2026-08-28.
 *
 * So: same id and the same anchor and the same body ⇒ hand back the stored row,
 * which makes a double-clicked Save and a retried POST harmless. Anything else
 * under that id ⇒ `CommentIdTaken`, which the route turns into a 409.
 */
export async function createComment(
  slug: string,
  input: NewComment,
  now: () => string = () => new Date().toISOString(),
): Promise<Comment> {
  let stored!: Comment;
  let repeat = false;
  await update(slug, (comments) => {
    const existing = input.id === undefined ? undefined : comments.find((c) => c.id === input.id);
    if (existing) {
      // The body is compared too, so re-sending a *changed* body under a stored
      // id is refused rather than quietly ignored. Editing goes through
      // `patchBody`, which is the operation allowed to move that field.
      /* **`status === "none"` is part of what "the same Save" means.** Anchor
         and body alone are not enough: a legacy explanation commonly has no
         body, so a reused id and anchor would hand one back as though it were
         a free comment just created — and the caller would then treat an
         answered row as its own new bookmark. GPT Sol, reviewing the built
         code, 2026-08-28. */
      if (
        existing.status !== "none" ||
        !sameAnchor(existing, input) ||
        (existing.body ?? undefined) !== input.body ||
        !sameMark(existing, input)
      ) {
        throw new CommentIdTaken(existing.id);
      }
      stored = existing;
      repeat = true;
      return comments;
    }
    const taken = new Set(comments.map((c) => c.id));
    stored = {
      id:
        input.id !== undefined && isSpideryarnId(input.id)
          ? input.id
          : mintUniqueId(taken),
      blockId: input.blockId,
      quote: input.quote,
      start: input.start,
      createdAt: now(),
      ...(input.body === undefined ? {} : { body: input.body }),
      /* The referee's own mark, absent when there is none. Written here rather
         than through a later patch because a placement is part of what the
         referee saved, not a fact about a model call — nothing in `AnswerPatch`
         may reach it. */
      ...(input.criterionId === undefined ? {} : { criterionId: input.criterionId }),
      ...(input.valence === undefined ? {} : { valence: input.valence }),
      status: "none",
    };
    return [...comments, stored];
  });
  // After the write, so the line means "this is on disk" rather than "this was
  // attempted". Ids and a flag only — the quote and the body are the reader's
  // and never go to stdout.
  log("store").info({ slug, id: stored.id, blockId: stored.blockId, repeat }, "comment created");
  return stored;
}

/**
 * **The attempts this process began and has not finished**, as `slug/id`.
 *
 * The filesystem store's whole answer to "is an answer actually coming?", and
 * it can be this small because there is one process on one disk: an attempt is
 * live exactly while the request that began it is still running here. Postgres
 * cannot use a set — its readers are on different machines — so it stamps a
 * deadline on the row instead (`COMMENT_ANSWER_LEASE_MS`,
 * src/store/pg-comments.ts) and every machine reads the database's clock.
 *
 * Keyed `slug/id` because comment ids are unique **per article**, not globally,
 * exactly as `answering` in src/routes.ts is. That map is the same fact seen
 * from the request side, and it is what `sweepPending`'s `keep` is built from;
 * this one is the store's own, so that `beginAnswer` — which is handed a slug
 * and an id and nothing else — can ask the question too.
 *
 * Emptied by a restart, which is the point: nothing was in flight before this
 * process started, so every `pending` row it finds is abandoned.
 *
 * **That is true of a restart and not of a reload, and the difference is not
 * academic here.** Saving any server module makes Vite re-evaluate all of them
 * inside the *same* process without cancelling the request in flight
 * ([src/process-state.ts](process-state.ts)), so this set comes back empty while
 * an answer is still being written — and the guard below, which is the only
 * thing stopping a second paid model call on a comment that already has one,
 * stops holding. The line below that says *"a property of having one process,
 * not a shrug"* is the assumption at issue: one process can hold two copies of
 * this module.
 *
 * **Not fixed here, deliberately.** This is the filesystem store, reached only
 * when `SPIDERYARN_STORE` is not `postgres` (`guarded`, src/store/index.ts), and
 * [260831b](../docs/plans/260831b-finish-the-database-move.md) Stage 4 deletes
 * this module outright. The Postgres store never had the problem: it cannot use
 * a set at all, as the paragraph above says, so it stamps
 * `COMMENT_ANSWER_LEASE_MS` on the row. Recorded rather than patched so that
 * whoever works on this file before it goes knows the fence has a hole in dev.
 * docs/plans/260903d-improve-the-codebase-second-sweep.md § T2.1.
 */
const begun = new Set<string>();

const attemptKey = (slug: string, id: string) => `${slug}/${id}`;

/**
 * Reset a *legacy explanation* for another attempt at the model call.
 *
 * The other half of what `createComment` used to be, and split from it because
 * one function cannot safely mean both "make this" and "redo this" once making
 * one is free — see the note on `createComment`.
 *
 * **It takes an id and nothing else.** The anchor is read from the stored row
 * rather than accepted from the request, which closes the hole where a retry
 * could quietly move a comment to a different passage. Everything the reader
 * owns survives: the anchor, `createdAt`, `body`, `updatedAt`, `threadId`. Only
 * the answer fields go, because they belong to the attempt being replaced.
 *
 * Refuses `status: "none"`. A bookmark was never a question, and the retired
 * explanation path must not be reachable from one.
 */
export async function beginAnswer(
  slug: string,
  id: string,
): Promise<{ comment: Comment; attempt: undefined }> {
  let stored!: Comment;
  await update(slug, (comments) => {
    const existing = comments.find((c) => c.id === id);
    if (!existing) throw new NotAnExplanation(id, "missing");
    /* **Claim a *terminal* row, not merely a non-free one.**
       `status !== "none"` was the first version and it is not a claim at all:
       a row already `pending` passes it, so two presses of Try again both
       "succeed", buy two model calls, and race each other's terminal writes.
       Only `done` and `error` are answerable — and a `pending` row that no
       attempt in this process is writing, which is the reclaim below.
       GPT Sol, reviewing the built code, 2026-08-28. */
    if (existing.status === "none") throw new NotAnExplanation(id, "free");
    /* **A `pending` row nobody here is writing has been abandoned, and is
       claimed rather than refused.** Otherwise a reader whose server died
       mid-answer gets 409 from every press of Try again until they reload the
       page — the sweep is the only thing that heals the row, and the sweep runs
       only on the comments `GET`. GPT Sol, 2026-09-01.

       The Postgres half asks a clock — is the lease over? — because on Vercel
       the machine taking this request cannot see the memory of the one that
       began the attempt. Here there is one process on one disk, so "an attempt
       is live" is *exactly* "this process began it and has not finished it",
       which `begun` knows without a clock and without waiting one out. Simpler,
       and in one respect stronger: a restart empties `begun`, so a comment left
       `pending` by the process that died is answerable on the very next press
       rather than two and a half minutes later.

       That is a property of having one process, not a shrug. It is also why
       `patchComment` needs no attempt token: a live attempt here cannot be
       superseded, because this line refuses to hand its row to anybody until it
       finishes or the sweep buries it. */
    if (existing.status === "pending" && begun.has(attemptKey(slug, id))) {
      throw new NotAnExplanation(id, "running");
    }
    /* Inside the mutation, which `update` serialises, so the row and the set
       cannot disagree about whether this attempt exists. */
    begun.add(attemptKey(slug, id));
    stored = {
      id: existing.id,
      blockId: existing.blockId,
      quote: existing.quote,
      start: existing.start,
      createdAt: existing.createdAt,
      ...(existing.body === undefined ? {} : { body: existing.body }),
      ...(existing.updatedAt === undefined ? {} : { updatedAt: existing.updatedAt }),
      ...(existing.threadId === undefined ? {} : { threadId: existing.threadId }),
      /* **Carried, like everything else the reader owns.** This row is built
         from named fields rather than spread, which is what keeps the answer
         path away from the anchor — and it is also how a new field comes to be
         quietly dropped by a retry. A referee's placement is theirs and has
         nothing to do with the model call being replaced. */
      ...(existing.criterionId === undefined ? {} : { criterionId: existing.criterionId }),
      ...(existing.valence === undefined ? {} : { valence: existing.valence }),
      status: "pending",
    };
    return comments.map((c) => (c.id === id ? stored : c));
  });
  log("store").info({ slug, id: stored.id, blockId: stored.blockId }, "comment answer begun");
  /* `attempt: undefined` rather than a token this store would then have to
     check. See the reclaim above for why one process needs no fence — and
     `CommentStore.patch` in src/store/contracts.ts for why the Postgres store
     refuses a terminal write that arrives without one. */
  return { comment: stored, attempt: undefined };
}

/**
 * The reader edited their words. Sets `body` and `updatedAt`, and nothing else.
 *
 * `null` clears the body — a comment becoming a bare bookmark again — and is
 * how the dialog's box empties. There is no third state: `""` never reaches
 * here, because the route trims once and turns it into `null`.
 */
export async function patchCommentBody(
  slug: string,
  id: string,
  body: string | null,
  now: () => string = () => new Date().toISOString(),
): Promise<Comment> {
  let stored!: Comment;
  await update(slug, (comments) =>
    comments.map((c) => {
      if (c.id !== id) return c;
      const { body: _old, ...rest } = c;
      stored = { ...rest, ...(body === null ? {} : { body }), updatedAt: now() };
      return stored;
    }),
  );
  if (!stored) throw new NotAnExplanation(id, "missing");
  // Length rather than the text. Whether somebody wrote three words or three
  // hundred is a fact about the app; what they wrote is theirs.
  log("store").info({ slug, id, chars: body?.length ?? 0 }, "comment body edited");
  return stored;
}

/**
 * The referee changed where they put the passage. Sets `criterionId`, `valence`
 * and `updatedAt`, and nothing else.
 *
 * `{ criterionId: null, valence: null }` clears the placement, and the comment
 * is a plain reading note again — the referee's words and their passage are
 * untouched, because clearing a placement is not deleting a comment.
 *
 * **The pair is written as a pair.** Both halves are removed from the stored
 * row and both are written back, so there is no path on which a comment ends up
 * holding a criterion from one request and a number from another. Everything
 * they may be was checked by the route: `markProblem` (src/referee-criteria.ts)
 * for the number, and the owner's own criteria for the id. Nothing here clamps
 * anything — see `Comment.valence` in src/types.ts for why a clamp on this path
 * is the failure the whole feature was designed around.
 *
 * A named allowlist and never a spread of what it was handed, exactly as the
 * other four operations are: `CommentStore` in src/store/contracts.ts says
 * which field each of the five may write.
 */
export async function patchCommentMark(
  slug: string,
  id: string,
  mark: MarkPatch,
  now: () => string = () => new Date().toISOString(),
): Promise<Comment> {
  let stored!: Comment;
  await update(slug, (comments) =>
    comments.map((c) => {
      if (c.id !== id) return c;
      /* Both fields off the stored row first, then back on only when there is
         one — the same move `patchCommentBody` makes with `body`. Absent rather
         than `null`, because `exactOptionalPropertyTypes` is on and
         tests/store-parity-referee.test.ts compares the two stores
         structurally. */
      const { criterionId: _wasOn, valence: _wasAt, ...rest } = c;
      stored = {
        ...rest,
        ...(mark.criterionId === null ? {} : { criterionId: mark.criterionId }),
        ...(mark.valence === null ? {} : { valence: mark.valence }),
        updatedAt: now(),
      };
      return stored;
    }),
  );
  if (!stored) throw new NotAnExplanation(id, "missing");
  /* The criterion is an id and `placed` is a flag, in the spirit of the `chars`
     above: whether a referee scored a passage is a fact about the app, and the
     number they chose is their judgement of somebody's paper. It costs nothing
     to leave it out and a log is a durable copy nobody chose to keep. */
  log("store").info(
    { slug, id, criterionId: mark.criterionId, placed: mark.valence !== null },
    "comment placement edited",
  );
  return stored;
}

/**
 * Point a comment at the conversation it started. **Compare-and-set from absent.**
 *
 * A second call with the same id is a no-op, which is what makes the link
 * survivable when the client retries; a call with a *different* id is refused,
 * because a comment starts one conversation and re-pointing it would silently
 * orphan the first.
 *
 * The id must be the one the **server** confirmed. `useChat.send` mints an
 * optimistic id and the store may hand back a different one, so linking the
 * guess is a link to a thread that does not exist.
 */
export async function linkCommentThread(
  slug: string,
  id: string,
  threadId: string,
  expect: { blockId: string; quote: string; start: number },
): Promise<Comment> {
  let stored!: Comment;
  let already = false;
  await update(slug, (comments) =>
    comments.map((c) => {
      if (c.id !== id) return c;
      /* **The comment has to be the one this conversation is about.**
         `sourceCommentId` comes off a request, so on its own it names *any*
         comment this reader owns on this article — a stale id from another tab,
         or a made-up one, would attach the conversation to an unrelated mark.
         Checked here rather than in the caller so it is one statement rather
         than a read, a check and a write with a gap in the middle. GPT Sol,
         reviewing the built code, 2026-08-28. */
      if (c.status !== "none" || !sameAnchor(c, expect)) throw new CommentIdTaken(c.id);
      if (c.threadId !== undefined && c.threadId !== threadId) {
        throw new CommentIdTaken(c.id);
      }
      already = c.threadId === threadId;
      stored = { ...c, threadId };
      return stored;
    }),
  );
  if (!stored) throw new NotAnExplanation(id, "missing");
  if (!already) log("store").info({ slug, id, threadId }, "comment linked to a conversation");
  return stored;
}

/**
 * Replace one comment's fields, leaving the rest of the file alone.
 *
 * `quiet` suppresses the failure line below, for a caller patching a *batch* of
 * comments to `error` at once — the orphan sweep in src/routes.ts, which can
 * touch every pending comment on an article in one request. One line each is
 * bounded by nothing, and Vercel allows 256 for the whole request. The sweep
 * says it once, with a count. Raised by GPT/Codex in review.
 */
export async function patchComment(
  slug: string,
  id: string,
  patch: AnswerPatch,
  /**
   * **Accepted and ignored**, and the ignoring is the interesting part.
   *
   * `CommentStore.patch` carries the token `beginAnswer` returned so the
   * Postgres store can refuse a write from an attempt that a sweep on another
   * machine already buried. This store has no such attempt to refuse: with one
   * process, `begun` (above) hands the row to nobody else while this attempt is
   * running, so the write that arrives here is always the live one. The
   * parameter is in the signature so the two stores are called identically —
   * a caller that had to remember which store it was talking to is the shape
   * that lets a fence quietly go missing.
   */
  _attempt?: string,
  opts: { quiet?: boolean } = {},
): Promise<Comment[]> {
  /* The attempt is over whatever the patch says, so the row goes back to being
     claimable. Terminal statuses only: a patch that left it `pending` and
     released it would be handing a live attempt's row away. */
  if (patch.status === "done" || patch.status === "error") {
    begun.delete(attemptKey(slug, id));
  }
  /* **Built field by field, never spread.** It used to be
     `{ ...c, ...patch, id: c.id }`, which protected the id and nothing else —
     so a caller could rewrite the anchor, `createdAt`, the reader's body or the
     linked conversation through the function whose whole job is to record how a
     model call went. `AnswerPatch` says which six may move; this says it again
     where the write happens, so neither can drift alone. GPT Sol, reviewing the
     built code, 2026-08-28. */
  const next = await update(slug, (comments) =>
    comments.map((c) =>
      c.id === id
        ? {
            ...c,
            ...(patch.status === undefined ? {} : { status: patch.status }),
            ...(patch.answer === undefined ? {} : { answer: patch.answer }),
            ...(patch.citations === undefined ? {} : { citations: patch.citations }),
            ...(patch.searches === undefined ? {} : { searches: patch.searches }),
            ...(patch.model === undefined ? {} : { model: patch.model }),
            ...(patch.error === undefined ? {} : { error: patch.error }),
          }
        : c,
    ),
  );
  /* A question that failed to get an answer. The reader sees this — the comment
     shows as errored — so it is not silent to them; it is silent to whoever is
     running the server.

     **The stored `error` string is deliberately NOT logged**, and the reasoning
     is worth keeping because the first version did log it and it looked
     harmless. That string is whatever `explain` threw, and one of the things
     `explain` throws is `OpenRouter ${status}: ${body.slice(0, 400)}` — four
     hundred characters of a provider's response body. A provider that echoes
     the request back in an error puts the reader's selected quote, and the
     article prose around it, into that string. It would have arrived here as a
     field called `reason` on a line that reads like a status code.

     Nothing is lost by dropping it: src/explain.ts logs its own failure line
     with the model, the HTTP status, the elapsed time and whether the deadline
     fired, which is what actually tells a bad key from a slow model. Found by
     GPT/Codex reviewing this change.
     **The throw site is fixed now (2026-08-26).** `src/explain.ts` no longer puts any of
     the provider's body in the message — see `ProviderRefused` in
     src/ai-call.ts — so the string this line declines to log is safe
     today. The line still declines to log it, because a rule that holds only
     while six call sites stay careful is not a rule; and because what a reader
     of this log line needs is the status and the model, which are already on
     it. */
  if (patch.status === "error" && !opts.quiet) {
    log("store").warn({ slug, id }, "comment answer failed");
  }
  return next;
}

export async function deleteComment(slug: string, id: string): Promise<Comment[]> {
  const remaining = await update(slug, (comments) => comments.filter((c) => c.id !== id));
  // Logged because it is destructive and there is no undo: the file is rewritten
  // without that comment. `remaining` is the count, so a delete that removed
  // nothing (a stale id from a second tab) can be told apart from one that did.
  log("store").info({ slug, id, remaining: remaining.length }, "comment deleted");
  return remaining;
}

/**
 * What both comment sweeps write. One constant, so they cannot drift.
 *
 * The words are the ones `sweepOrphaned` in src/routes.ts wrote before the rule
 * moved into the stores, unchanged: the reader has seen this sentence and there
 * is nothing wrong with it. `CHAT_SWEPT` in src/chat.ts and `SEARCH_SWEPT` in
 * src/store/fs.ts are its siblings.
 */
export const COMMENT_SWEPT = "The server stopped before this was answered.";

/**
 * Turn abandoned `pending` comments into `error`, so they can be retried.
 *
 * **`keep` alone, and only because there is exactly one process.** The Postgres
 * half (`pgCommentStore.sweepPending`) needs a second guard — a lease on the
 * row — because on Vercel a `GET` lands on a machine that knows nothing about
 * the machine streaming the answer, and `keep` is a fact about *this* process.
 * Here there is one server on one disk, so a `pending` comment this process is
 * not writing has no answer coming: the server restarted, or the request was
 * cut off.
 *
 * The asymmetry is written down rather than left to be noticed, because "the
 * filesystem one is allowed to be weaker" is precisely what hid a production
 * bug for four days — docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md.
 * Weaker is fine *when the reason is a property of the filesystem store*, as it
 * is here; it is not fine as a shrug.
 */
export async function sweepPendingComments(
  slug: string,
  keep: ReadonlySet<string>,
): Promise<Comment[]> {
  const orphaned = (c: Comment) => c.status === "pending" && !keep.has(c.id);
  const comments = await loadComments(slug);
  // The pre-check exists to avoid rewriting the file for nothing. The Postgres
  // store deliberately drops it: an UPDATE matching no rows is free. Same split
  // as `fsChatStore.sweepPending`.
  const orphans = comments.filter(orphaned).length;
  if (orphans === 0) return comments;
  const next = await update(slug, (current) =>
    current.map((c) => {
      if (!orphaned(c)) return c;
      /* The sweep has declared this attempt dead, so it stops counting as one
         — otherwise `begun` keeps a row that `beginAnswer` would then refuse to
         reclaim, and the comment is stuck 409ing for the life of the process.
         `pgCommentStore.sweepPending` clears the row's `attempt_id` for exactly
         this reason. */
      begun.delete(attemptKey(slug, c.id));
      return { ...c, status: "error" as const, error: COMMENT_SWEPT };
    }),
  );
  /* One line for the batch, never one per orphan. Every orphan gets the same
     patch for the same reason, so a line each would say one thing N times — and
     N is unbounded while Vercel allows 256 lines for the whole request. */
  log("store").warn({ slug, orphans }, `swept ${orphans} abandoned comment(s) for ${slug}`);
  return next;
}
