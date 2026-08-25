/**
 * The HTTP surface: article reads, and the comment endpoints.
 *
 * Connect-shaped (`req`, `res`) but not Vite-specific — vite.config.ts mounts
 * this as dev middleware today, and the standalone Node server that
 * architecture.md § Server and client defers will mount the same function. The
 * actual work stays in src/api.ts, src/comments.ts and src/explain.ts; this file
 * is only routing, parsing and status codes.
 *
 *   GET    /api/library         every article on the shelf, for the homepage
 *   GET    /api/article/:slug    meta + blocks + tree, one payload
 *   GET    /api/metadata/:slug   what the pipeline wrote, and whether any of it is stale
 *   GET    /api/tweets/:slug     the article as a numbered thread, and whether it is stale
 *   GET    /api/glossary/:slug   the terms this piece uses, and whether they are stale
 *   DELETE /api/glossary/:slug   throw the list away, so the next run starts over
 *   GET    /api/summary/:slug    the piece at more than one length, and whether it is stale
 *   GET    /api/comments/:slug   every stored comment for the article
 *   POST   /api/comments/:slug   { blockId, quote, start } → the answered comment
 *   DELETE /api/comments/:slug/:id
 *   GET    /api/chat/:slug       every stored conversation for the article
 *   POST   /api/chat/:slug       { threadId, question, at? } → **a stream**, see `streamChat`
 *   PATCH  /api/chat/:slug/:threadId   { title }
 *   DELETE /api/chat/:slug/:threadId
 *   GET    /api/search/:slug     every saved meaning-search for the article
 *   POST   /api/search/:slug     { id?, criterion } → the finished run
 *   DELETE /api/search/:slug/:id
 *   GET    /api/jobs             every ingest job this server knows about
 *   POST   /api/jobs             { url } | { slug, steps?, force? } → the queued job
 *   GET    /api/jobs/:id         one job, for the progress indicator to poll
 *   DELETE /api/jobs/:id         forget a finished job's record
 *   POST   /api/jobs/:id/cancel
 *   POST   /api/jobs/:id/retry   the same steps again, skipping what succeeded
 *
 * The job routes return immediately; the work happens on the queue in
 * src/jobs.ts. See docs/project/comments.md, docs/project/library.md and
 * docs/project/ingest-queue.md.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  articleMetadata,
  deleteGlossary,
  listArticles,
  loadArticle,
  loadGlossary,
  loadSummaries,
  loadTweets,
} from "./api.js";
import {
  beginTurn,
  deleteThread,
  finishTurn,
  loadThreads,
  renameThread,
  update as updateThreads,
} from "./chat.js";
import { beginRun, deleteRun, finishRun, loadRuns, update as updateRuns } from "./searches.js";
import { findPassages } from "./search.js";
import { createComment, deleteComment, loadComments, patchComment } from "./comments.js";
import { converse } from "./converse.js";
import { explain } from "./explain.js";
import { isSlug, slugFromUrl } from "./ingest.js";
import { cancelJob, enqueue, forgetJob, getJob, listJobs, retryJob } from "./jobs.js";
import { errorFields, log, since } from "./log.js";
import { isStepName, type StepName } from "./pipeline.js";
import type { ChatThread, Comment, SearchRun } from "./types.js";

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
  // `quiet`, then one line for the batch. Every orphan gets the same patch for
  // the same reason, so a line each would say one thing N times — and N is
  // unbounded while Vercel allows 256 lines for the whole request.
  for (const orphan of orphans) latest = await patchComment(slug, orphan.id, patch, { quiet: true });
  log("store").warn(
    { slug, orphans: orphans.length },
    `swept ${orphans.length} abandoned comment(s) for ${slug}`,
  );
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

/* ----------------------------------------------------------------- chat --
   The one endpoint in this file that does not answer with JSON.

   See docs/plans/chat-mode.md. Everything here mirrors the comment endpoints
   above — a `pending` row written before the model call, an orphan sweep on
   read, a terminal state written before the reply — with the differences that
   streaming forces, each called out where it happens. */

/**
 * The assistant messages this process is streaming right now, as
 * `slug/threadId/messageId`.
 *
 * Exactly the job `answering` does for comments, and for exactly the same
 * reason: `pending` on disk does not mean "an answer is coming", because it is
 * written *before* the model call so that a crash leaves evidence. Only the
 * running process can tell an answer in flight from one that died with the
 * process that was writing it.
 */
const streaming = new Set<string>();

/**
 * How long a `pending` answer is left alone before a sweep calls it abandoned.
 *
 * **The `streaming` Set only knows about this process.** Two `npm run dev`
 * servers on one `data/` directory is not hypothetical — it happened during
 * this feature's own development, when a second Vite picked port 5275 — and
 * server B's sweep cannot see that server A is mid-answer, so it marks A's live
 * message `error` while the reader is watching the words arrive.
 *
 * A grace period does not make that correct, and nothing short of a lock would:
 * see docs/plans/chat-mode.md § What is still open. What it does is make the
 * window small enough to matter rarely and recover cleanly — an answer younger
 * than this is assumed to be in flight *somewhere*, and if it really did die,
 * the next read after two minutes releases it. Longer than any answer the
 * deadline in converse.ts permits (120s), plus room for the write.
 */
const CHAT_ORPHAN_GRACE_MS = 150_000;

/** Turn abandoned `pending` answers into `error`, so the reader can ask again. */
async function sweepChat(slug: string, threads: ChatThread[]): Promise<ChatThread[]> {
  const now = Date.now();
  const orphaned = (t: ChatThread, m: { id: string; createdAt: string }) => {
    if (streaming.has(`${slug}/${t.id}/${m.id}`)) return false; // this process is on it
    // A timestamp we cannot read is treated as old rather than as young: the
    // alternative is a message that can never be swept, which is the state this
    // whole function exists to prevent.
    const started = Date.parse(m.createdAt);
    return Number.isNaN(started) || now - started > CHAT_ORPHAN_GRACE_MS;
  };
  const stale = threads.some((t) =>
    t.messages.some((m) => m.status === "pending" && orphaned(t, m)),
  );
  if (!stale) return threads;
  return updateThreads(slug, (current) =>
    current.map((t) => ({
      ...t,
      messages: t.messages.map((m) =>
        m.status === "pending" && orphaned(t, m)
          ? {
              ...m,
              status: "error" as const,
              /* The text stays. A half-written answer the reader watched appear
                 is the most confusing thing to lose on reload — they know they
                 read something, and it is gone. Keeping it with the failure
                 attached says what actually happened. */
              error: "The server stopped before this answer finished.",
            }
          : m,
      ),
    })),
  );
}

/**
 * Answer a question, streaming the words out as they arrive.
 *
 * **Server-sent events**, so the frames are `event: <name>` + `data: <json>`.
 * Three event names, and the contract is the same one src/converse.ts offers:
 * any number of `delta`, then exactly one of `done` or `error`.
 *
 * Four things here are not obvious:
 *
 * 1. **`X-Accel-Buffering: no`.** A reverse proxy that buffers a response
 *    defeats the entire feature *without failing* — the answer still arrives,
 *    all at once, at the end. That is indistinguishable from a slow model, so
 *    nobody would ever file it as a bug. Vite's dev middleware does not buffer;
 *    this is for wherever this is deployed.
 *
 * 2. **Headers are flushed before the model is called.** Otherwise Node holds
 *    them until the first write, and the first write is however long the model
 *    thinks for — so the browser sits on an unresolved `fetch` and the panel
 *    cannot even show that it is waiting.
 *
 * 3. **A reader who leaves does not cancel the answer.** The model call runs to
 *    completion and the answer is stored, so coming back to the thread finds it
 *    waiting. The alternative — abort on disconnect — throws away a nearly
 *    finished answer that has already been paid for, and switching threads
 *    while the model is thinking is a completely ordinary thing to do. What the
 *    disconnect does stop is *writing*: `alive()` is checked before every frame,
 *    because writing to a closed socket throws EPIPE and would take down the
 *    turn that is otherwise about to succeed.
 *
 * 4. **A stream that breaks keeps its words.** src/converse.ts hands back the
 *    text so far when it throws, and that partial answer is stored with the
 *    error on it rather than discarded. See the note in `sweepChat`.
 */
async function streamChat(slug: string, body: unknown, res: ServerResponse): Promise<void> {
  const { threadId, question, at } = (body ?? {}) as Record<string, unknown>;
  if (typeof question !== "string" || question.trim() === "") {
    throw httpError(400, "Expected { threadId, question }");
  }
  if (typeof threadId !== "string") {
    throw httpError(400, "Expected { threadId, question }");
  }
  if (question.length > MAX_QUESTION_CHARS) {
    throw httpError(413, `A question may be at most ${MAX_QUESTION_CHARS} characters`);
  }
  // Loaded before anything is written, so a bad slug is still an ordinary JSON
  // 404 rather than an `error` frame inside a 200 stream.
  const article = await loadArticle(slug);

  const { thread, reply } = await beginTurn(slug, { threadId, question: question.trim() });
  const key = `${slug}/${thread.id}/${reply.id}`;

  /* Everything from here is inside one try/finally, and the `streaming` key is
     added on the first line of it rather than just before it.

     The key used to be added ahead of the try, with the header flush and the
     `begin` frame outside too. A throw from either — a socket that died between
     `beginTurn` and the first write — leaked the key for the life of the
     process, and a leaked key is not inert: `sweepChat` reads it as "this
     process is still answering", so that message stayed `pending` on disk for
     ever and no sweep would ever release it. Found by a GPT-5.6 review,
     2026-08-26. */
  /* Has the reader gone?

     `res.on("close")`, **not** `req.on("close")`, and the difference is a real
     trap rather than a preference. Node documents the request's `close` as
     "the request has been completed, **or** its underlying connection was
     terminated" — and `readBody` above consumes the request stream to its end,
     so "completed" is already true before the model is ever called. Listening
     there means that on any Node version which takes the first reading, every
     frame is dropped and the reader watches a spinner while a perfectly good
     answer is written to disk behind them. The response's `close` has one
     meaning: this connection is finished. */
  let open = true;
  res.on("close", () => {
    open = false;
  });
  const frame = (event: string, data: unknown) => {
    if (!open || res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let text = "";
  try {
    streaming.add(key);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    /* The ids first, before a single word of the answer. The client minted the
       thread id optimistically and beginTurn may have overruled it (a collision,
       or an id that was not one of ours), so this frame is what the client
       believes rather than its own guess. It also gives the panel the message id
       to render the incoming text into. */
    frame("begin", { threadId: thread.id, title: thread.title, messageId: reply.id });

    for await (const event of converse({
      meta: article.meta,
      blocks: article.blocks,
      history: thread.messages.slice(0, -2), // everything before this turn
      question: question.trim(),
      at: typeof at === "string" ? at : undefined,
    })) {
      if (event.type === "delta") {
        text += event.text;
        frame("delta", { text: event.text });
        continue;
      }
      await finishTurn(slug, thread.id, reply.id, {
        text: event.text,
        status: "done",
        citations: event.citations,
        searches: event.searches,
        model: event.model,
      });
      frame("done", {
        text: event.text,
        citations: event.citations,
        searches: event.searches,
        model: event.model,
      });
    }
  } catch (err) {
    /* **Nothing in here may throw**, and that is why it is wrapped again.

       Once the headers are on the wire this function owns the response, and the
       route's outer catch cannot help: its `send()` sets `res.statusCode` and
       then throws from `setHeader` on an already-sent response, which both
       mislabels the request in the log (500, when 200 went out) and leaves an
       unhandled rejection for Vite's middleware to trip over. So a failure to
       *record* the failure is swallowed, having been logged where it happened.
       Found by a GPT-5.6 review, 2026-08-26. */
    const message = (err as Error).message;
    try {
      // The partial answer is kept, not dropped — see the header note.
      await finishTurn(slug, thread.id, reply.id, { text, status: "error", error: message });
    } catch (storeErr) {
      log("store").error(
        { ...errorFields(storeErr), slug, threadId: thread.id, messageId: reply.id },
        "could not record a failed chat answer",
      );
    }
    frame("error", { error: message, text });
  } finally {
    streaming.delete(key);
    if (!res.writableEnded) res.end();
  }
}

/** Long enough for a paragraph of context, short enough that nothing runs away. */
const MAX_QUESTION_CHARS = 4000;

/* --------------------------------------------------------------- search --
   Finding a passage by what it says. See docs/project/search.md.

   Shaped on the *comment* endpoints above rather than on the chat one, and the
   choice is worth a sentence: a search result is a list, not prose, so there is
   nothing to watch arrive and streaming would buy the reader a progress bar
   they cannot read. One POST, one answer, the same three writes — `pending`
   before the model call so a crash leaves evidence, the terminal state written
   before the reply so the disk and the response can never disagree. */

/**
 * The searches this process is running right now, as `slug/runId`.
 *
 * The same job `answering` and `streaming` do above, for the same reason:
 * `pending` on disk does not mean "an answer is coming", because it is written
 * *before* the model call precisely so a crash leaves evidence. Only the
 * running process can tell a search in flight from one that died with the
 * process that was writing it.
 */
const searching = new Set<string>();

/** Turn abandoned `pending` searches into `error`, so they can be run again. */
async function sweepSearches(slug: string, runs: SearchRun[]): Promise<SearchRun[]> {
  const orphaned = (r: SearchRun) => r.status === "pending" && !searching.has(`${slug}/${r.id}`);
  if (!runs.some(orphaned)) return runs;
  const swept = await updateRuns(slug, (current) =>
    current.map((r) =>
      orphaned(r)
        ? { ...r, status: "error" as const, error: "The server stopped before this search finished." }
        : r,
    ),
  );
  // One line for the batch, not one per run: they all get the same patch for
  // the same reason, and the count is the only part that varies.
  log("store").warn(
    { slug, orphans: swept.filter((r) => r.status === "error").length },
    `swept abandoned search(es) for ${slug}`,
  );
  return swept;
}

/**
 * Run a search, store the result, and answer with it.
 *
 * A model failure comes back as HTTP **200** carrying a run whose status is
 * `error`, exactly as `answer` does for comments: the request succeeded at what
 * it was for, which was recording what the reader asked for. The panel shows
 * the failure and offers to try again.
 *
 * The one case that is not shared with comments is the last `if`: the reader
 * can delete a search while the model is still thinking, and `finishRun`
 * deliberately does not resurrect a run that is no longer there. Answering with
 * the run anyway would put it back on screen, so a delete that happened mid
 * search is reported as a 404 and the client — which already removed it — does
 * nothing.
 */
async function search(slug: string, body: unknown): Promise<SearchRun> {
  const { id, criterion } = (body ?? {}) as Record<string, unknown>;
  if (typeof criterion !== "string" || criterion.trim() === "") {
    throw httpError(400, "Expected { criterion }");
  }
  // The whole article goes in the prompt, so a criterion is not the expensive
  // part — but an unbounded one is still a way to push the article out of the
  // context window from the outside.
  if (criterion.length > 500) {
    throw httpError(400, "A criterion must be 500 characters or fewer");
  }

  const run = await beginRun(slug, criterion.trim(), typeof id === "string" ? id : undefined);
  const key = `${slug}/${run.id}`;
  searching.add(key);
  let patch: Partial<SearchRun>;
  try {
    const article = await loadArticle(slug);
    const result = await findPassages({
      meta: article.meta,
      blocks: article.blocks,
      criterion: run.criterion,
    });
    patch = { status: "done", hits: result.hits, model: result.model };
  } catch (err) {
    patch = { status: "error", error: (err as Error).message };
  } finally {
    searching.delete(key);
  }
  const stored = (await finishRun(slug, run.id, patch)).find((r) => r.id === run.id);
  if (!stored) throw httpError(404, "That search was deleted while it was running");
  return stored;
}

/* ------------------------------------------------ reading the path apart --
   TWO functions, and picking the wrong one is a path traversal.

   `part` for a capture that is only ever an *identifier* — a comment id, a job
   id. Those are looked up in a list or a map; nothing joins them onto a path.

   `slugPart` for every capture that becomes a **directory name**. That is
   `:slug` on /api/article, /api/metadata, /api/tweets, /api/glossary,
   /api/summary and /api/comments.

   The next person to add a route will copy whichever line they happen to read
   first, so the rule is written here rather than left to be inferred: **if the
   value reaches the filesystem, it goes through `slugPart`.** */

/**
 * One capture group of a route match, URL-decoded.
 *
 * No group in the patterns below is optional, so the `?? ""` never fires — it
 * is there because a regex match types every group as possibly absent, and an
 * empty value would 404 rather than reach a lookup as "undefined".
 *
 * **Not for anything that becomes a path.** See `slugPart`.
 */
function part(m: RegExpExecArray, group: number): string {
  return decodeURIComponent(m[group] ?? "");
}

/**
 * The same, validated as a slug — **the fix for a real path traversal**.
 *
 * The route patterns allow `%` and `.`, and `part` percent-decodes. So
 * `/api/article/..%2F..%2F…` arrived at `loadArticle` as `../../…`, and
 * `path.join(ROOT, "data", slug)` normalises those segments straight out of the
 * repo. Demonstrated on 2026-08-25 by planting a `blocks.json` under `/tmp` and
 * reading it back through the endpoint: HTTP 200, with the planted text in the
 * body.
 *
 * **The thing that made it survive review is how a shallow attempt fails.**
 * `../../etc` finds no `blocks.json`, so `candidateDirs` falls through to
 * `example/` and serves the fixture — which looks exactly like a refusal. You
 * have to traverse all the way to a directory you control before anything
 * differs, and a test that stops short reports the endpoint safe. Textbook
 * docs/reusable/silent-success.md, and it is why this is written up in
 * docs/project/security.md rather than filed as a bug fix.
 *
 * The knowledge was already in this file. `parseJobRequest` validates its slug
 * and says why: *"it is joined onto `data/` and `output/`, so an unchecked one
 * is a path traversal."* It just never reached the read routes.
 *
 * 400 rather than 404: the request is malformed, and saying "not found" would
 * send whoever sent it looking for a missing article.
 */
function slugPart(m: RegExpExecArray, group: number): string {
  const value = part(m, group);
  if (!isSlug(value)) throw httpError(400, `Not a slug: ${JSON.stringify(value)}`);
  return value;
}

/**
 * Turn a POST body into a job request, or explain what was wrong with it.
 *
 * Two shapes, and they are **mutually exclusive**. `{ url }` means "add this
 * article", and the slug is derived rather than accepted — the client shows the
 * same derivation (src/ingest.ts) so the two agree by construction rather than
 * by trust. `{ slug, steps }` means "run these stages on the article I already
 * have", which is how a re-run after a prompt change and a refresh from source
 * are both expressed. Sending both is refused; see the note below for what that
 * combination used to let you do.
 *
 * The slug is validated even in the second shape, and especially there: it is
 * joined onto `data/` and `output/`, so an unchecked one is a path traversal.
 */
export function parseJobRequest(body: unknown): {
  slug: string;
  url?: string;
  steps?: StepName[];
  force?: StepName[];
} {
  const { url, slug, steps, force } = (body ?? {}) as Record<string, unknown>;

  const stepList = (value: unknown, field: string): StepName[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || !value.every(isStepName)) {
      throw httpError(400, `${field} must be an array of step names`);
    }
    return value;
  };
  const parsedSteps = stepList(steps, "steps");
  const parsedForce = stepList(force, "force");

  if (typeof url === "string" && url.trim() !== "") {
    // **The slug is derived, never accepted.** It used to fall back to a
    // caller-supplied one, which quietly made this the most dangerous shape in
    // the API: `{ url: "https://a.example/x", slug: "an-article-i-already-have",
    // force: ["fetch"] }` pointed a full refresh at somebody else's article and
    // overwrote it, from a request that looked like an ordinary add. The slug
    // was path-safe, so nothing complained. Refuse the combination outright —
    // there is no honest reason to send both.
    if (slug !== undefined) {
      throw httpError(400, "Send a url or a slug, not both — the slug comes from the url");
    }
    const derived = slugFromUrl(url);
    if (!isSlug(derived)) {
      // **Not the URL.** This message is logged — `logRequest` writes an
      // `httpError`'s message as `reason`, because an error that named its own
      // status is one this file chose to raise. So it is published, not just
      // said, and a source URL is untrusted input: it can carry basic-auth
      // credentials or a `?token=`. Interpolating it here would have undone the
      // query-string strip in `handleApi` below — `path` cleaned, and then the
      // whole raw URL back in through the side door. Nothing is lost by leaving
      // it out, because the caller is the one who sent it.
      throw httpError(400, "Could not make a slug from that url");
    }
    return {
      slug: derived,
      url: url.trim(),
      ...(parsedSteps ? { steps: parsedSteps } : {}),
      ...(parsedForce ? { force: parsedForce } : {}),
    };
  }

  if (!isSlug(slug)) {
    throw httpError(400, "Expected { url } or { slug }");
  }
  return {
    slug,
    ...(parsedSteps ? { steps: parsedSteps } : {}),
    ...(parsedForce ? { force: parsedForce } : {}),
  };
}

/**
 * One line per request, on the way out, at a level the status decides.
 *
 * **The level is the status, and that is the whole rule.** A 4xx is the
 * client's fault — a bad slug, a typo'd endpoint — and an alarm on it trains
 * you to ignore alarms. A 5xx is ours.
 *
 * The path goes in the **message as well as** the object. Vercel's log search
 * matches the raw line reliably; its indexing of structured fields is not
 * something to rely on (their own docs disagree with each other about it), so
 * the one field you always search by is duplicated where grep can see it.
 *
 * Nothing from the request body is here, deliberately. A comment POST carries
 * `quote` — a passage the reader selected out of the article — and the log is a
 * reading history already (src/log.ts, on why `url` is not redacted) without
 * putting the reading itself in it.
 */
function logRequest(
  method: string,
  path: string,
  status: number,
  started: number,
  err?: unknown,
): void {
  /* **A stack only where a stack tells you something.**
   *
   * `httpError(400, …)` is a *decision this file made* — a bad slug, both a url
   * and a slug, a body that is not JSON. Its stack is the four frames between
   * here and the `throw` two hundred lines up, which nobody has ever needed,
   * and in dev they are frames of Vite's bundled temp copy of this file, which
   * is worse than nothing. An error with no `status` of its own is the case
   * this logging exists for: something threw that we did not plan for, and the
   * stack is the only record of where.
   *
   * So the test is not the status code but whether the error *named* one. A
   * `throw new Error(…)` that happens to be mapped to 400 still keeps its
   * stack, because nobody chose that 400 on purpose.
   *
   * **The invariant this rests on, stated because it is easy to break from far
   * away:** every `httpError` message in this file is written to a log, so it
   * must contain nothing but words we chose. Not the URL, not the body, not the
   * offending value. One of them interpolated the source URL and put
   * credentials and a query string into `reason` at warn — cleanly defeating
   * the query strip in `handleApi`, forty lines from the code that did it.
   * `tests/jobs.test.ts` pins that one. See docs/project/logging.md. */
  const expected = err !== undefined && typeof (err as { status?: number }).status === "number";
  const fields = {
    method,
    path,
    status,
    ms: since(started),
    ...(err === undefined
      ? {}
      : expected
        ? { reason: (err as Error).message }
        : errorFields(err)),
  };
  const line = log("http");
  const msg = `${method} ${path} ${status}`;
  if (status >= 500) line.error(fields, msg);
  else if (status >= 400) line.warn(fields, msg);
  else line.info(fields, msg);
}

/** Returns false if the request was not ours, so the caller can fall through. */
export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url ?? "";
  // Before the clock starts, and before anything can log: a request that is not
  // ours must produce **no line at all**. In dev this function sees every
  // stylesheet, module and source map Vite serves, and a line each would bury
  // the ones about the API.
  if (!url.startsWith("/api/")) return false;

  const started = Date.now();
  const method = req.method ?? "";
  /* **The path without the query string, for logging only.** The routes below
     still match against `url` itself; nothing here changes what is served.

     `req.url` carries the query string, and `logRequest` writes its argument
     into the message as well as the object — where redaction, which matches
     key paths and never text, can never reach it. No route reads a query
     string today, so this costs nothing and stops a future `?token=…`, or one
     sent by mistake, from being written down twice. Raised by GPT/Codex in
     review. */
  const path = url.split("?")[0] ?? url;

  // Exact match, not a prefix: a stray `/api/library/anything` should 404 rather
  // than quietly serve the whole shelf.
  const library = url === "/api/library";
  const article = /^\/api\/article\/([\w.%-]+)$/.exec(url);
  // Its own endpoint rather than a field on the article payload: that one is
  // ~150KB and is fetched on every page, and stat-ing every file for it would
  // charge every reader for a page almost nobody opens.
  const metadata = /^\/api\/metadata\/([\w.%-]+)$/.exec(url);
  /* Its own endpoint too, and for a sharper reason than the metadata one: a
     thread does not exist for most articles, and putting it on the article
     payload would mean every reader of every article downloads a `null` for a
     page almost none of them open. GET only — *writing* a thread is a job, not
     a request, because it is a model call that takes half a minute
     (docs/plans/tweet-thread-page.md#generation-on-demand-through-the-queue-we-already-have).
     POST /api/jobs { slug, steps: ["tweets"] } is how you ask for one. */
  const tweets = /^\/api\/tweets\/([\w.%-]+)$/.exec(url);
  /* Same shape and same reasoning as the thread's — most articles have no
     glossary, so putting one on the article payload would make every reader of
     every article download a `null`.

     GET *and* DELETE, which the thread does not have. Asking for the step again
     appends terms rather than replacing them (src/glossary.ts), so "start over"
     needs a way to say so — see `deleteGlossary` in src/api.ts for why that is
     two acts rather than one flag. There is still no POST: *finding* terms is a
     model call that takes tens of seconds, which is a job, not a request.
     POST /api/jobs { slug, steps: ["glossary"] } is how you ask. */
  const glossary = /^\/api\/glossary\/([\w.%-]+)$/.exec(url);
  const summary = /^\/api\/summary\/([\w.%-]+)$/.exec(url);
  const comments = /^\/api\/comments\/([\w.%-]+)$/.exec(url);
  const one = /^\/api\/comments\/([\w.%-]+)\/([\w.%-]+)$/.exec(url);
  const chat = /^\/api\/chat\/([\w.%-]+)$/.exec(url);
  const oneThread = /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)$/.exec(url);
  const searches = /^\/api\/search\/([\w.%-]+)$/.exec(url);
  const oneRun = /^\/api\/search\/([\w.%-]+)\/([\w.%-]+)$/.exec(url);
  const allJobs = url === "/api/jobs";
  const job = /^\/api\/jobs\/([\w.%-]+)$/.exec(url);
  const jobAction = /^\/api\/jobs\/([\w.%-]+)\/(cancel|retry)$/.exec(url);

  /* Every response leaves by one of the ~14 `send` calls below, the catch, or
     the 404 at the end — so the log line lives in a single `finally` rather
     than at each of them. A branch added later cannot forget it, and there is
     no set of call sites to keep in step. It reads `res.statusCode`, which
     `send` has just set, so the exit points do not have to report anything. */
  let failure: unknown;
  try {
    if (library && req.method === "GET") {
      send(res, 200, { articles: await listArticles() });
      return true;
    }
    if (article && req.method === "GET") {
      send(res, 200, await loadArticle(slugPart(article, 1)));
      return true;
    }
    if (metadata && req.method === "GET") {
      send(res, 200, await articleMetadata(slugPart(metadata, 1)));
      return true;
    }
    if (tweets && req.method === "GET") {
      send(res, 200, await loadTweets(slugPart(tweets, 1)));
      return true;
    }
    if (glossary && req.method === "GET") {
      send(res, 200, await loadGlossary(slugPart(glossary, 1)));
      return true;
    }
    if (glossary && req.method === "DELETE") {
      send(res, 200, await deleteGlossary(slugPart(glossary, 1)));
      return true;
    }
    /* Read only. There is no DELETE beside this one, unlike the glossary's:
       running the step again replaces the artefact rather than appending to it,
       so "start over" already has a spelling and a second one would only be a
       way to lose the summaries without getting new ones. See `loadSummaries`
       in src/api.ts. Asking for them is
       POST /api/jobs { slug, steps: ["summary"] }. */
    if (summary && req.method === "GET") {
      send(res, 200, await loadSummaries(slugPart(summary, 1)));
      return true;
    }
    if (comments && req.method === "GET") {
      const slug = slugPart(comments, 1);
      send(res, 200, { comments: await sweepOrphaned(slug, await loadComments(slug)) });
      return true;
    }
    if (comments && req.method === "POST") {
      send(res, 200, await answer(slugPart(comments, 1), await readBody(req)));
      return true;
    }
    if (one && req.method === "DELETE") {
      // The slug becomes a directory; the id is only ever matched against a list.
      const [slug, id] = [slugPart(one, 1), part(one, 2)];
      send(res, 200, { comments: await deleteComment(slug, id) });
      return true;
    }
    if (chat && req.method === "GET") {
      const slug = slugPart(chat, 1);
      send(res, 200, { threads: await sweepChat(slug, await loadThreads(slug)) });
      return true;
    }
    if (chat && req.method === "POST") {
      /* The one branch that does not call `send`. It writes its own headers and
         ends the response itself, so there is nothing for `send` to do — but
         `res.statusCode` is still set, which is all the logging in `finally`
         reads. A stream that fails *before* the headers go out throws, and the
         catch below answers it as ordinary JSON; after that, the failure is an
         `error` frame inside a 200, because the status line is long gone. */
      await streamChat(slugPart(chat, 1), await readBody(req), res);
      return true;
    }
    if (oneThread && req.method === "PATCH") {
      // Slug becomes a directory; the thread id is only ever matched in a list.
      const [slug, id] = [slugPart(oneThread, 1), part(oneThread, 2)];
      const { title } = (await readBody(req)) as Record<string, unknown>;
      if (typeof title !== "string") throw httpError(400, "Expected { title }");
      send(res, 200, { threads: await renameThread(slug, id, title) });
      return true;
    }
    if (oneThread && req.method === "DELETE") {
      const [slug, id] = [slugPart(oneThread, 1), part(oneThread, 2)];
      send(res, 200, { threads: await deleteThread(slug, id) });
      return true;
    }
    if (searches && req.method === "GET") {
      const slug = slugPart(searches, 1);
      send(res, 200, { runs: await sweepSearches(slug, await loadRuns(slug)) });
      return true;
    }
    if (searches && req.method === "POST") {
      send(res, 200, await search(slugPart(searches, 1), await readBody(req)));
      return true;
    }
    if (oneRun && req.method === "DELETE") {
      // The slug becomes a directory; the id is only ever matched against a list.
      const [slug, id] = [slugPart(oneRun, 1), part(oneRun, 2)];
      send(res, 200, { runs: await deleteRun(slug, id) });
      return true;
    }
    if (allJobs && req.method === "GET") {
      send(res, 200, { jobs: await listJobs() });
      return true;
    }
    if (allJobs && req.method === "POST") {
      // 202, not 200: the work has been accepted and has not been done. The
      // body is the receipt to poll, which is the only thing there is to say
      // about a job that has not started.
      send(res, 202, await enqueue(parseJobRequest(await readBody(req))));
      return true;
    }
    if (job && req.method === "GET") {
      const found = await getJob(part(job, 1));
      if (!found) throw httpError(404, "No such job");
      send(res, 200, found);
      return true;
    }
    if (job && req.method === "DELETE") {
      if (!(await forgetJob(part(job, 1)))) throw httpError(404, "No such job");
      send(res, 200, { forgotten: part(job, 1) });
      return true;
    }
    if (jobAction && req.method === "POST") {
      const [id, action] = [part(jobAction, 1), part(jobAction, 2)];
      const result = action === "cancel" ? await cancelJob(id) : await retryJob(id);
      if (!result) throw httpError(404, "No such job");
      send(res, action === "cancel" ? 200 : 202, result);
      return true;
    }

    /**
     * Anything else under `/api/` is a 404 **from us**, not a fall-through.
     *
     * Returning false here handed the request back to Vite, whose SPA fallback
     * answered it with `index.html` and a cheerful 200. So a typo'd endpoint,
     * or a client built against a route that has since been renamed, came back
     * as `Unexpected token '<'` from `r.json()` — a parse error, pointing at
     * the client, for a server route that simply is not there. Textbook
     * docs/reusable/silent-success.md: the request succeeded, loudly, at
     * nothing. That is also why the line it logs is a `warn`: a request for a
     * route nobody has usually means a client built against an older one.
     *
     * Only `/api/`, and only after every pattern above has had its turn. A path
     * that is not ours at all still falls through, which is what makes this
     * function mountable as middleware.
     */
    send(res, 404, { error: `No API route for ${req.method} ${url}` });
    return true;
  } catch (err) {
    // Anything that knows its own status says so. What is left is either a
    // missing artefact or a genuine fault, and telling those apart matters: a
    // blanket 404 made a corrupt comments.json and a bad request both read as
    // "no such article", which is the wrong thing to go and investigate.
    const status =
      (err as { status?: number }).status ??
      ((err as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500);
    // Handed to `logRequest`, which decides how much of it to write down — the
    // message for a failure this file chose, the whole stack for one it did
    // not. That is the point of the exercise: an unexpected throw used to be
    // mapped to a status, handed to the client and forgotten, so a production
    // 500 left nothing behind to read.
    failure = err;
    send(res, status, { error: (err as Error).message });
    return true;
  } finally {
    logRequest(method, path, res.statusCode, started, failure);
  }
}
