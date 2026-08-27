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
   * Minted by the client, so the dialog and `?note=` have a real id from the
   * first frame and nothing has to be swapped when the answer lands. Refused if
   * it collides, and re-minted here if absent.
   */
  id?: string;
}

/**
 * Store a comment as `pending`, **before** the model is called.
 *
 * That ordering is the point. If the process dies mid-answer, the record is
 * still there and still says `pending`, so the reader sees a question that never
 * got answered and can retry — rather than a selection that quietly evaporated.
 *
 * **Idempotent on `input.id`.** A retry sends the id it already has, and that
 * must reset the existing comment rather than append a second one: a new row
 * would leave the failed original in the file, drawing a second mark over the
 * same words that nothing can clear. It also makes a duplicated POST — React
 * StrictMode double-invoking an effect, a reader double-clicking — harmless
 * instead of a way to spend two model calls and orphan one of them.
 */
export async function createComment(
  slug: string,
  input: NewComment,
  now: () => string = () => new Date().toISOString(),
): Promise<Comment> {
  let stored!: Comment;
  let reset = false;
  await update(slug, (comments) => {
    const existing = comments.find((c) => c.id === input.id);
    reset = existing !== undefined;
    // Reset in place: the answer, citations, searches and error all go, because
    // they belong to the attempt being replaced. `createdAt` stays — the reader
    // asked the question once.
    if (existing) {
      stored = {
        id: existing.id,
        blockId: input.blockId,
        quote: input.quote,
        start: input.start,
        createdAt: existing.createdAt,
        status: "pending",
      };
      return comments.map((c) => (c.id === stored.id ? stored : c));
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
      status: "pending",
    };
    return [...comments, stored];
  });
  // After the write, so the line means "this is on disk" rather than "this was
  // attempted". `reset` is worth a field: a duplicate POST and a genuine retry
  // look identical from here, and both land as a reset rather than a second
  // row, so a run of them is the signal that something upstream is repeating
  // itself. Ids only — the quote is the reader's, and it never goes to stdout.
  log("store").info({ slug, id: stored.id, blockId: stored.blockId, reset }, "comment created");
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
  patch: Partial<Comment>,
  opts: { quiet?: boolean } = {},
): Promise<Comment[]> {
  const next = await update(slug, (comments) =>
    comments.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c)),
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
