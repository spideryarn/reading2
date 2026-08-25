/**
 * The HTTP surface: article reads, and the comment endpoints.
 *
 * Connect-shaped (`req`, `res`) but not Vite-specific — vite.config.ts mounts
 * this as dev middleware today, and the standalone Node server that
 * architecture.md § Server and client defers will mount the same function. The
 * actual work stays in src/api.ts, src/comments.ts and src/explain.ts; this file
 * is only routing, parsing and status codes.
 *
 *   GET    /api/article/:slug    meta + blocks + tree, one payload
 *   GET    /api/comments/:slug   every stored comment for the article
 *   POST   /api/comments/:slug   { blockId, quote, start } → the answered comment
 *   DELETE /api/comments/:slug/:id
 *
 * See docs/project/comments.md.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadArticle } from "./api.js";
import { createComment, deleteComment, loadComments, patchComment } from "./comments.js";
import { explain } from "./explain.js";
import type { Comment } from "./types.js";

/** Big enough for any selection, small enough that nothing can wedge the server. */
const MAX_BODY_BYTES = 64 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** An error carrying the HTTP status it should be reported as. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw httpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    // Without this the client is told 404, and goes looking for a missing
    // article instead of the malformed body it actually sent.
    throw httpError(400, "Request body is not valid JSON");
  }
}

/**
 * The comments this process is answering right now, as `slug/id`.
 *
 * `pending` on disk does not mean "an answer is coming" — it is written
 * *before* the model call precisely so a crash leaves evidence. Which means the
 * two cases look identical on disk: an answer genuinely in flight, and one that
 * died with the process that was writing it. The reader sees the same spinner
 * for both, and for the dead one it spins for ever.
 *
 * Only the running process can tell them apart, so it keeps the list.
 */
const answering = new Set<string>();

/**
 * Turn abandoned `pending` comments into `error`, so they can be retried.
 *
 * Run on read rather than at startup: it is the same answer either way, and a
 * read is the only moment anyone cares. Anything `pending` that this process is
 * not working on has no answer coming — the server restarted, or the request
 * was cut off — and saying so out loud is the whole point. The retry path for
 * `error` already exists, so nothing in the client changes.
 */
async function sweepOrphaned(slug: string, comments: Comment[]): Promise<Comment[]> {
  const orphans = comments.filter(
    (c) => c.status === "pending" && !answering.has(`${slug}/${c.id}`),
  );
  if (orphans.length === 0) return comments;
  const patch = {
    status: "error" as const,
    error: "The server stopped before this was answered.",
  };
  let latest = comments;
  for (const orphan of orphans) latest = await patchComment(slug, orphan.id, patch);
  return latest;
}

/**
 * Create a comment, answer it, and store the answer.
 *
 * Three writes, deliberately: `pending` lands before the model call so a crash
 * leaves evidence, and the terminal state is written before the response so the
 * disk and the reply can never disagree. A model failure comes back as HTTP 200
 * carrying a comment whose status is `error` — the request *did* succeed at what
 * it was for, which was recording the question; the dialog shows the failure and
 * offers a retry.
 */
async function answer(slug: string, body: unknown): Promise<Comment> {
  const { id, blockId, quote, start } = (body ?? {}) as Record<string, unknown>;
  if (typeof blockId !== "string" || typeof quote !== "string" || typeof start !== "number") {
    throw httpError(400, "Expected { blockId, quote, start }");
  }
  // `start` indexes into the block's rendered text, so anything that is not a
  // whole non-negative number is meaningless. A negative one is worse than
  // meaningless: `resolveMark`'s fast path returns it unchanged, and the mark is
  // drawn a few characters to the left of the words it belongs to — wrong, and
  // wrong in a way that looks like a styling glitch rather than bad data.
  if (!Number.isInteger(start) || start < 0) {
    throw httpError(400, `start must be a non-negative integer, got ${start}`);
  }

  const comment = await createComment(slug, {
    blockId,
    quote,
    start,
    ...(typeof id === "string" ? { id } : {}),
  });
  const key = `${slug}/${comment.id}`;
  answering.add(key);
  try {
    const article = await loadArticle(slug);
    const result = await explain({
      meta: article.meta,
      blocks: article.blocks,
      blockId,
      quote,
    });
    const patch = {
      status: "done" as const,
      answer: result.answer,
      citations: result.citations,
      searches: result.searches,
      model: result.model,
    };
    await patchComment(slug, comment.id, patch);
    return { ...comment, ...patch };
  } catch (err) {
    const patch = { status: "error" as const, error: (err as Error).message };
    await patchComment(slug, comment.id, patch);
    return { ...comment, ...patch };
  } finally {
    answering.delete(key);
  }
}

/**
 * One capture group of a route match, URL-decoded. No group in the patterns
 * below is optional, so the `?? ""` never fires — it is there because a regex
 * match types every group as possibly absent, and an empty slug would 404
 * rather than reach the filesystem as "undefined".
 */
function part(m: RegExpExecArray, group: number): string {
  return decodeURIComponent(m[group] ?? "");
}

/** Returns false if the request was not ours, so the caller can fall through. */
export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url ?? "";
  if (!url.startsWith("/api/")) return false;

  const article = /^\/api\/article\/([\w.%-]+)$/.exec(url);
  const comments = /^\/api\/comments\/([\w.%-]+)$/.exec(url);
  const one = /^\/api\/comments\/([\w.%-]+)\/([\w.%-]+)$/.exec(url);

  try {
    if (article && req.method === "GET") {
      send(res, 200, await loadArticle(part(article, 1)));
      return true;
    }
    if (comments && req.method === "GET") {
      const slug = part(comments, 1);
      send(res, 200, { comments: await sweepOrphaned(slug, await loadComments(slug)) });
      return true;
    }
    if (comments && req.method === "POST") {
      send(res, 200, await answer(part(comments, 1), await readBody(req)));
      return true;
    }
    if (one && req.method === "DELETE") {
      const [slug, id] = [part(one, 1), part(one, 2)];
      send(res, 200, { comments: await deleteComment(slug, id) });
      return true;
    }
  } catch (err) {
    // Anything that knows its own status says so. What is left is either a
    // missing artefact or a genuine fault, and telling those apart matters: a
    // blanket 404 made a corrupt comments.json and a bad request both read as
    // "no such article", which is the wrong thing to go and investigate.
    const status =
      (err as { status?: number }).status ??
      ((err as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500);
    send(res, status, { error: (err as Error).message });
    return true;
  }
  return false;
}
