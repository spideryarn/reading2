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
}

/** Thrown when a client-minted id is already taken by a different comment. */
export class CommentIdTaken extends Error {
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
 */
export class NotAnExplanation extends Error {
  constructor(readonly id: string, readonly why: "missing" | "free" | "running") {
    super(
      why === "missing"
        ? `No comment with the id ${id}`
        : why === "running"
          ? `Comment ${id} is already being answered`
          : `Comment ${id} was never a question, so there is nothing to answer`,
    );
    this.name = "NotAnExplanation";
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
        (existing.body ?? undefined) !== input.body
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
export async function beginAnswer(slug: string, id: string): Promise<Comment> {
  let stored!: Comment;
  await update(slug, (comments) => {
    const existing = comments.find((c) => c.id === id);
    if (!existing) throw new NotAnExplanation(id, "missing");
    /* **Claim a *terminal* row, not merely a non-free one.**
       `status !== "none"` was the first version and it is not a claim at all:
       a row already `pending` passes it, so two presses of Try again both
       "succeed", buy two model calls, and race each other's terminal writes.
       Only `done` and `error` are answerable — an abandoned `pending` becomes
       `error` through the sweep in src/routes.ts and can be retried then.
       GPT Sol, reviewing the built code, 2026-08-28. */
    if (existing.status === "none") throw new NotAnExplanation(id, "free");
    if (existing.status === "pending") throw new NotAnExplanation(id, "running");
    stored = {
      id: existing.id,
      blockId: existing.blockId,
      quote: existing.quote,
      start: existing.start,
      createdAt: existing.createdAt,
      ...(existing.body === undefined ? {} : { body: existing.body }),
      ...(existing.updatedAt === undefined ? {} : { updatedAt: existing.updatedAt }),
      ...(existing.threadId === undefined ? {} : { threadId: existing.threadId }),
      status: "pending",
    };
    return comments.map((c) => (c.id === id ? stored : c));
  });
  log("store").info({ slug, id: stored.id, blockId: stored.blockId }, "comment answer begun");
  return stored;
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
  opts: { quiet?: boolean } = {},
): Promise<Comment[]> {
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
