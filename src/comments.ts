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

const ROOT = path.resolve(import.meta.dirname, "..");

const fileFor = (slug: string) => path.join(ROOT, "data", slug, "comments.json");

/**
 * A slug is a path segment. Anything that isn't one is refused outright rather
 * than sanitised, because sanitising invites arguing about whether it worked.
 */
function assertSlug(slug: string): void {
  if (!/^[\w.-]+$/.test(slug) || slug === "." || slug === "..") {
    throw new Error(`Not a valid slug: ${JSON.stringify(slug)}`);
  }
}

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
    const parsed = JSON.parse(await readFile(fileFor(slug), "utf8")) as { comments?: Comment[] };
    return parsed.comments ?? [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
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
  await update(slug, (comments) => {
    const existing = comments.find((c) => c.id === input.id);
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
  return stored;
}

/** Replace one comment's fields, leaving the rest of the file alone. */
export function patchComment(
  slug: string,
  id: string,
  patch: Partial<Comment>,
): Promise<Comment[]> {
  return update(slug, (comments) =>
    comments.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c)),
  );
}

export function deleteComment(slug: string, id: string): Promise<Comment[]> {
  return update(slug, (comments) => comments.filter((c) => c.id !== id));
}
