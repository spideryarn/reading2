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

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
    throw Object.assign(new Error("Expected { blockId, quote, start }"), { status: 400 });
  }

  const comment = await createComment(slug, {
    blockId,
    quote,
    start,
    ...(typeof id === "string" ? { id } : {}),
  });
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
  }
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
      send(res, 200, await loadArticle(decodeURIComponent(article[1])));
      return true;
    }
    if (comments && req.method === "GET") {
      send(res, 200, { comments: await loadComments(decodeURIComponent(comments[1])) });
      return true;
    }
    if (comments && req.method === "POST") {
      send(res, 200, await answer(decodeURIComponent(comments[1]), await readBody(req)));
      return true;
    }
    if (one && req.method === "DELETE") {
      const [slug, id] = [decodeURIComponent(one[1]), decodeURIComponent(one[2])];
      send(res, 200, { comments: await deleteComment(slug, id) });
      return true;
    }
  } catch (err) {
    // 404 is the default because the overwhelmingly common failure here is
    // "no artefacts for that slug"; anything that knows better says so.
    send(res, (err as { status?: number }).status ?? 404, { error: (err as Error).message });
    return true;
  }
  return false;
}
