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
 *                                `?archived=1` for the other half
 *   GET    /api/library/search   `?q=…&limit=…` → passages from every article at once
 *   PATCH  /api/library/:slug    { archived?: boolean, title?: string | null }
 *   POST   /api/library/:slug/open   one more open, for the shelf's tooltip
 *   GET    /api/article/:slug    meta + blocks + tree, one payload
 *   GET    /api/metadata/:slug   what the pipeline wrote, and whether any of it is stale
 *   GET    /api/tweets/:slug     the article as a numbered thread, and whether it is stale
 *   GET    /api/glossary/:slug   the terms this piece uses, and whether they are stale
 *   DELETE /api/glossary/:slug   throw the list away, so the next run starts over
 *   POST   /api/glossary/:slug/:id/lookup   check one term on the web, and keep the sources
 *   GET    /api/summary/:slug    the piece at more than one length, and whether it is stale
 *   GET    /api/comments/:slug   every stored comment for the article
 *   POST   /api/comments/:slug   { blockId, quote, start } → the answered comment
 *   DELETE /api/comments/:slug/:id
 *   GET    /api/chat/:slug       every stored conversation for the article
 *   POST   /api/chat/:slug       → **a stream**, see `streamChat`. Three bodies:
 *                                  { threadId, question, at? }      ask
 *                                  { threadId, retry: messageId }   answer again
 *                                  { threadId, edit: messageId, question, at? }
 *   POST   /api/chat/:slug/:threadId/stop  { messageId } → { stopped }
 *   PATCH  /api/chat/:slug/:threadId   { title }
 *   DELETE /api/chat/:slug/:threadId
 *   GET    /api/search/:slug     every saved meaning-search for the article
 *   POST   /api/search/:slug     { id?, criterion } → the finished run
 *   DELETE /api/search/:slug/:id
 *   GET    /api/jobs             every ingest job this server knows about
 *   POST   /api/jobs             { url } | { slug, steps?, force?, guidance? } → the queued job
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
/* From the store rather than from src/api.ts directly, so that
   SPIDERYARN_STORE=postgres swaps every article read at once and no route has
   to know which store it is talking to. `files` is the default and is exactly
   src/api.ts, so nothing changes for anyone who has not opted in.
   docs/plans/postgres-storage-implementation.md */
import {
  articleMetadata,
  deleteGlossary,
  librarySearch,
  listArticles,
  shelfStore,
  loadArticle,
  loadGlossary,
  lookUpTerm,
  loadSummaries,
  loadTweets,
} from "./store/index.js";
import {
  beginTurn,
  ChatConflict,
  deleteThread,
  editTurn,
  finishTurn,
  loadThreads,
  renameThread,
  retryTurn,
  update as updateThreads,
  withEdit,
  withRetry,
} from "./chat.js";
import { beginRun, deleteRun, finishRun, loadRuns, update as updateRuns } from "./searches.js";
import { findPassages } from "./search.js";
/* Through the store, so SPIDERYARN_STORE moves comments and articles together.
   They cannot be split: a comment anchors to a block id, and leaving the
   questions on disk while the paragraphs they point at come from Postgres puts
   the two halves in stores nothing keeps in step. */
import { commentStore } from "./store/index.js";
import { converse } from "./converse.js";
import { explainStream } from "./explain.js";
import { isSlug, slugFromUrl } from "./ingest.js";
import { cancelJob, enqueue, forgetJob, getJob, listJobs, retryJob } from "./jobs.js";
import { errorFields, log, since } from "./log.js";
import { isStepName, type StepName } from "./pipeline.js";
import type {
  ChatThread,
  Comment,
  LibraryEntry,
  LibrarySearchResponse,
  SearchRun,
} from "./types.js";

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
const answering = new Map<string, number>();

/**
 * Mark a comment as being answered right now, and hand back the release.
 *
 * **A count rather than a flag, and that is not defensive padding.** It was a
 * `Set` while the only way to re-answer a comment was the "Try again" link on a
 * failed one, so two requests for the same id could not overlap. The deep-search
 * button removed that guarantee: it sits on an answered comment, and the obvious
 * way to press it twice is to press it twice. With a `Set`, the first request to
 * finish deletes the key while the second is still streaming, and the next
 * `GET /api/comments` sees a `pending` row nobody is working on and sweeps it —
 * telling the reader "the server stopped before this was answered" about an
 * answer that is arriving as they read it.
 *
 * Chat needed `Live` and `settleThread` for the same problem. This is the small
 * version: nothing here can stop or supersede anything, it only stops the sweep
 * from lying.
 */
function beganAnswering(key: string): () => void {
  answering.set(key, (answering.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return; // a double release must not decrement someone else's
    released = true;
    const left = (answering.get(key) ?? 1) - 1;
    if (left > 0) answering.set(key, left);
    else answering.delete(key);
  };
}

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
  for (const orphan of orphans) latest = await commentStore.patch(slug, orphan.id, patch, { quiet: true });
  log("store").warn(
    { slug, orphans: orphans.length },
    `swept ${orphans.length} abandoned comment(s) for ${slug}`,
  );
  return latest;
}

/**
 * Server-sent events on a response that is otherwise a plain Node one.
 *
 * Shared by chat and by comments, which are the only two things in this app a
 * reader waits on. Extracted from `streamChat`, where every line of it was
 * already written — see the note on `res.on("close")` there for the one trap it
 * carries.
 */
function sse(res: ServerResponse): {
  frame(event: string, data: unknown): void;
  alive(): boolean;
} {
  /* Has the reader gone?

     `res.on("close")`, **not** `req.on("close")`, and the difference is a real
     trap rather than a preference. Node documents the request's `close` as
     "the request has been completed, **or** its underlying connection was
     terminated" — and `readBody` consumes the request stream to its end, so
     "completed" is already true before the model is ever called. Listening
     there means that on any Node version which takes the first reading, every
     frame is dropped and the reader watches a spinner while a perfectly good
     answer is written to disk behind them. The response's `close` has one
     meaning: this connection is finished. */
  let open = true;
  res.on("close", () => {
    open = false;
  });
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Nginx and friends buffer a response body by default, which for a stream
    // means the reader gets everything at once at the end — i.e. exactly the
    // spinner this feature exists to remove, with none of the symptoms.
    "X-Accel-Buffering": "no",
  });
  // Before the model call, so the browser's `fetch` resolves immediately and
  // the client is reading the stream while the first token is still being
  // thought about.
  res.flushHeaders?.();
  return {
    frame(event, data) {
      if (!open || res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    alive: () => open && !res.writableEnded && !res.destroyed,
  };
}

/**
 * Create a comment, answer it a few words at a time, and store the answer.
 *
 * **Validation happens before a single header is written**, so a bad request is
 * still an ordinary JSON 400 — the thrown `httpError` never reaches a
 * half-opened stream. Everything after `sse(res)` is frames, including failure.
 *
 * Three writes, deliberately: `pending` lands before the model call so a crash
 * leaves evidence, and the terminal state is written before the last frame so
 * the disk and the reader can never disagree. A model failure is a `done` frame
 * carrying a comment whose status is `error` — the request *did* succeed at what
 * it was for, which was recording the question; the dialog shows the failure and
 * offers a retry.
 *
 * Frames: one `begin`, then any number of `delta`, then exactly one `done`.
 *
 * **`begin` carries the whole comment, and that is the point of it.**
 * `commentStore.create` re-mints the id when the client's is malformed or
 * collides, and with a stream there is no response body to carry the real one
 * back. Without this frame the client would stream an answer into a row the
 * server has never heard of, and a reload would show a different comment.
 * src/web/useChat.ts § Begun is the write-up of that exact bug happening in
 * chat, weeks after the ids stopped matching.
 */
async function answer(slug: string, body: unknown, res: ServerResponse): Promise<void> {
  const { id, blockId, quote, start, deep } = (body ?? {}) as Record<string, unknown>;
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
  /* Anything other than `true` is not deep. A 400 here would be a validation
     message built from the request body, which is the one thing `httpError`
     messages must never be — they are logged as `reason`, and redaction is
     path-based and cannot reach a string. See the note on `httpError` below. */
  const deeper = deep === true;

  // Before the comment is created, so a slug that is not an article is a clean
  // 404 with nothing written, rather than a stored comment whose only content is
  // the error we could have known about first.
  const article = await loadArticle(slug);

  const comment = await commentStore.create(slug, {
    blockId,
    quote,
    start,
    ...(typeof id === "string" ? { id } : {}),
  });
  const key = `${slug}/${comment.id}`;
  const release = beganAnswering(key);

  const { frame } = sse(res);
  frame("begin", comment);

  let text = "";
  try {
    for await (const event of explainStream({
      meta: article.meta,
      blocks: article.blocks,
      blockId,
      quote,
      deep: deeper,
    })) {
      if (event.type === "delta") {
        text += event.text;
        frame("delta", { text: event.text });
        continue;
      }
      const patch = {
        status: "done" as const,
        answer: event.answer,
        citations: event.citations,
        searches: event.searches,
        model: event.model,
      };
      await commentStore.patch(slug, comment.id, patch);
      frame("done", { ...comment, ...patch });
    }
  } catch (err) {
    /* The partial answer is kept, exactly as chat keeps one. Half an
       explanation and a reason beats a spinner that turns into nothing, and the
       reader has already read the half. */
    const patch = {
      status: "error" as const,
      error: (err as Error).message,
      ...(text.trim() ? { answer: text.trim() } : {}),
    };
    /* **Nothing past `sse(res)` may throw.** The headers are gone, so an escaped
       error would reach the outer handler, which would try to `send` a JSON 500
       onto a response that is already an open event stream — and the reader
       would see the stream simply stop. A store that cannot record the failure
       is a worse thing than a failure, and it is worth its own line. */
    try {
      await commentStore.patch(slug, comment.id, patch);
    } catch (storeErr) {
      log("store").error(
        { ...errorFields(storeErr), slug, id: comment.id },
        `could not record a failed explanation for ${slug}`,
      );
    }
    frame("done", { ...comment, ...patch });
  } finally {
    release();
    res.end();
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
interface Live {
  /**
   * Fired when the reader presses stop, and when an edit or a retry supersedes
   * this answer. src/converse.ts tells it apart from its own deadline and stall
   * signals and finishes the turn normally rather than throwing.
   */
  stop: AbortController;
  /**
   * Resolves when this stream has finished writing — not when it was aborted.
   *
   * The reason it exists is a race that only shows up under a retry.
   * `retryTurn` reuses the answer's row, id and all, so an aborted stream whose
   * `finishTurn` lands *after* the reset would put the stopped half-answer back
   * over the fresh `pending` row — and then nothing would ever clear it, because
   * the retry's own stream is writing to the same id and will simply overwrite
   * a row it thinks it owns. Aborting is not enough; the supersede has to wait
   * for the writer to let go. See `settleThread`.
   */
  done: Promise<void>;
  /**
   * Which *attempt* at this row this is.
   *
   * The key of `streaming` names a row, and a retry deliberately reuses the
   * row — see `withRetry` in src/chat.ts. So the key alone cannot tell one
   * attempt from the next, and a stop is a request about one particular
   * attempt: the reader pressed it while watching *those* words arrive. Press
   * stop, have the answer finish before the request lands, press retry, and the
   * stop would arrive to find a different answer under the name it was given
   * and abort that one instead. Rare in one tab, ordinary across two.
   *
   * So `/stop` carries the number back and `stopChat` refuses a mismatch. A
   * request with no number at all still stops whatever is there, which is what
   * a client older than this field would send.
   */
  attempt: number;
}

const streaming = new Map<string, Live>();
/** Counts every attempt this process starts. Never reused, never reset. */
let attempts = 0;

/**
 * One turn at a time per conversation, across deciding *and* writing it.
 *
 * `settleThread` below stops the streams a retry or an edit is about to write
 * over, and waits for them. What it could not do is stop a *new* turn arriving
 * during that wait — and one that did was appended by `beginTurn`, streamed
 * happily, and was then truncated away by the edit that had been waiting. Its
 * `finishTurn` found no row and, by design, wrote nothing at all; the tab that
 * asked watched a complete answer arrive that was not anywhere. Found by a
 * GPT-5.6 review, 2026-08-26.
 *
 * The lock is held for the settle and the write and **released before the model
 * is called**, so two conversations never wait on each other and a long answer
 * blocks nothing. It cannot deadlock against `settleThread`: the streams that
 * wait for are past this lock already.
 *
 * Per process, like everything else here. Two servers on one `data/` directory
 * remains the unfixed problem in docs/plans/chat-mode.md § What is still open.
 */
const turnOrder = new Map<string, Promise<void>>();

async function inTurnOrder<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const before = turnOrder.get(key) ?? Promise.resolve();
  /* `fn` runs whether the turn in front succeeded or failed. A rejection must
     not break the chain — every later turn in this conversation would reject
     with a stranger's error — so the tail swallows both outcomes and only the
     caller sees what happened to its own. */
  const mine = before.then(fn, fn);
  const tail = mine.then(
    () => {},
    () => {},
  );
  turnOrder.set(key, tail);
  try {
    return await mine;
  } finally {
    // Only the last writer clears the key, or the map grows one entry per
    // conversation for the life of the process.
    if (turnOrder.get(key) === tail) turnOrder.delete(key);
  }
}

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

/**
 * Stop whatever this process is streaming into a thread, and wait for it to
 * finish writing.
 *
 * Called before an edit or a retry, both of which rewrite rows a live stream
 * may be about to write to. Aborting alone leaves the interleaving open — see
 * `Live.done` — so this awaits.
 *
 * **Nothing here bounds that wait**, and an earlier version of this comment
 * claimed otherwise. What bounds it in practice is inside the answer being
 * waited for: converse.ts gives every stream a 120s deadline and a 45s stall
 * timer, and `streamChat`'s `finally` resolves `done` on every path out. A body
 * that neither yields nor errors would hang the reader's stop or edit here with
 * nothing to say why. A timeout would not fix it — proceeding anyway is exactly
 * the interleaving this function exists to prevent — so the honest answer is
 * that this depends on those two timers, and they are where to look if a stop
 * ever hangs.
 *
 * Like `streaming` itself this only knows about **this process**; a second
 * server streaming into the same file is the unfixed problem recorded in
 * docs/plans/chat-mode.md § What is still open, and it is the same problem, not
 * a new one.
 */
async function settleThread(slug: string, threadId: string): Promise<void> {
  const prefix = `${slug}/${threadId}/`;
  const live = [...streaming.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  if (live.length === 0) return;
  for (const l of live) l.stop.abort(new Error("superseded"));
  await Promise.all(live.map((l) => l.done));
}

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
  const { threadId, question, at, retry, edit } = (body ?? {}) as Record<string, unknown>;
  if (typeof threadId !== "string") throw httpError(400, "Expected { threadId, … }");
  /* Three ways to start a turn, one endpoint, one stream.

     A retry and an edit could each have had a route of their own, and each
     would then have needed its own copy of the header flush, the `begin` frame,
     the delta loop, the two terminal frames and the four things that must not
     throw after the headers are gone. That code is the hard part and it is
     identical in all three cases; what actually differs is one question — which
     rows does the model answer *from*, and which row does it write *into*. So
     that is the only thing branched on, and it is branched on before a byte
     goes out. */
  const wantsRetry = typeof retry === "string";
  const wantsEdit = typeof edit === "string";
  if (wantsRetry && wantsEdit) throw httpError(400, "Send retry or edit, not both");
  if (!wantsRetry && (typeof question !== "string" || question.trim() === "")) {
    throw httpError(400, "Expected { threadId, question }");
  }
  if (typeof question === "string" && question.length > MAX_QUESTION_CHARS) {
    throw httpError(413, `A question may be at most ${MAX_QUESTION_CHARS} characters`);
  }
  // Loaded before anything is written, so a bad slug is still an ordinary JSON
  // 404 rather than an `error` frame inside a 200 stream.
  const article = await loadArticle(slug);

  /* Deciding and writing the turn happen together, under the conversation's
     turn order — see `inTurnOrder`. Everything after it is one answer streaming
     and needs no lock at all. */
  const begun = await inTurnOrder(`${slug}/${threadId}`, async () => {
    if (wantsRetry || wantsEdit) {
      /* **Refuse a stale request before anything is aborted.**

         `settleThread` below stops the live answer in this conversation, and it
         used to run first — so a second tab retrying a turn that is no longer
         the last one aborted the answer the reader in the *first* tab was
         watching, stored it as stopped, and only then answered 409. That reader
         pressed nothing and was told they had stopped it, and no replacement
         came. Found by a GPT-5.6 review, 2026-08-26.

         The check is the real rule rather than a copy of it: `withRetry` and
         `withEdit` are pure, so they can be run against a snapshot and thrown
         away. Whatever they would refuse, they refuse here, for free, before
         the destructive part. The authoritative run is still the one inside
         `retryTurn` / `editTurn` — this is a gate, not a substitute. */
      const snapshot = await loadThreads(slug);
      if (wantsRetry) withRetry(snapshot, threadId, retry as string, "");
      else withEdit(snapshot, threadId, edit as string, (question as string).trim(), "");

      /* Both of these rewrite rows that a live answer in this thread may be
         halfway through writing, so the live one is stopped and *waited for*
         first. Not needed for an ordinary send: that appends, and appending
         beside a stream is already ordered correctly by the serialised queue in
         src/chat.ts. */
      await settleThread(slug, threadId);
    }
    return wantsRetry
      ? await retryTurn(slug, threadId, retry as string)
      : wantsEdit
        ? await editTurn(slug, threadId, edit as string, (question as string).trim())
        : await beginTurn(slug, { threadId, question: (question as string).trim() });
  });
  const { thread, reply, user } = begun;
  /* **The question that was stored is the question that gets asked** — one rule
     for all three kinds of turn, rather than "the request's text, except on a
     retry". A retry has no question in its request at all, and taking one from
     there would let a stale tab retry one question and store the answer under
     another: the row above saying one thing and the answer below it being to
     something else, with nothing on screen to show the two had parted. */
  const asked = user.text;
  const key = `${slug}/${thread.id}/${reply.id}`;
  const attempt = ++attempts;
  const stop = new AbortController();
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });

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
    streaming.set(key, { stop, done, attempt });
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
    frame("begin", {
      threadId: thread.id,
      title: thread.title,
      messageId: reply.id,
      /* The *question's* id as well as the answer's, and leaving it out was a
         real bug rather than an omission.

         On an ordinary send the client has invented a name for the question —
         it puts the reader's words on screen the instant Enter is pressed,
         before this server has seen them — and only the answer's id was ever
         corrected here. Nothing renders an id, so nothing looked wrong, until
         the reader edited a question without reloading first and posted a name
         this server had never heard of: "That message is not in this
         conversation." Reported by Greg, 2026-08-26.

         Sent on all three kinds of turn even though only a send needs it. A
         retry and an edit both reuse a row this server already named, so the
         id is usually one the client has, and "usually" is the problem: the
         client may still be holding an invented name from a send earlier in
         the same session. One rule — the frame always says what both rows are
         called — is cheaper to be sure of than three. */
      questionId: user.id,
      /* Which attempt at that row this is, so a stop can name the answer it was
         pressed on rather than whatever is under the id when it arrives. See
         `Live.attempt`. */
      attempt,
    });

    for await (const event of converse({
      meta: article.meta,
      blocks: article.blocks,
      history: thread.messages.slice(0, -2), // everything before this turn
      question: asked,
      at: typeof at === "string" ? at : undefined,
      signal: stop.signal,
    })) {
      if (event.type === "delta") {
        text += event.text;
        frame("delta", { text: event.text });
        continue;
      }
      /* A stopped answer is stored `done`, with a flag. It is not a failure —
         see the `stopped` field in src/types.ts — and `...(x ? {x} : {})` rather
         than `stopped: event.stopped` so an ordinary answer does not carry a
         `false` into the file for every turn ever written. */
      const finished = {
        text: event.text,
        status: "done" as const,
        citations: event.citations,
        searches: event.searches,
        model: event.model,
        ...(event.stopped ? { stopped: true } : {}),
      };
      await finishTurn(slug, thread.id, reply.id, finished);
      frame("done", finished);
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
    // After the delete, so a supersede that was waiting on this cannot see the
    // key again and abort a stream that has already let go of the row.
    release();
    if (!res.writableEnded) res.end();
  }
}

/**
 * Stop an answer the reader has read enough of.
 *
 * A route rather than a socket close, and that is the whole design. Closing the
 * connection is what happens when a reader switches thread or shuts the tab,
 * and `streamChat` deliberately lets the answer finish in that case — they will
 * want it when they come back, and it has already been paid for. The two are
 * indistinguishable from this end, so the deliberate one has to say so in a
 * request of its own. See the header note on `streamChat`, point 3.
 *
 * Waits for the writer, so a reader who presses stop and immediately reloads
 * sees the partial answer rather than a spinner that a sweep clears two minutes
 * later.
 */
async function stopChat(
  slug: string,
  threadId: string,
  body: unknown,
): Promise<{ stopped: boolean }> {
  const { messageId, attempt } = (body ?? {}) as Record<string, unknown>;
  if (typeof messageId !== "string") throw httpError(400, "Expected { messageId }");
  const live = streaming.get(`${slug}/${threadId}/${messageId}`);
  /* Not an error. The answer finished a moment ago, or the other dev server is
     writing it, or this is a second tab pressing stop on something already
     stopped. `false` says "there was nothing to stop", which is all the client
     needs and is true in every one of those cases. */
  if (!live) return { stopped: false };
  /* And the same answer for a stop that names an attempt this row has moved on
     from — see `Live.attempt`. It is "there was nothing to stop" in the only
     sense the reader cares about: the words they were watching are already
     finished. Aborting what is there instead would stop an answer nobody asked
     to stop. */
  if (typeof attempt === "number" && attempt !== live.attempt) return { stopped: false };
  live.stop.abort(new Error("stopped by the reader"));
  await live.done;
  return { stopped: true };
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
 * The most passages one search will return.
 *
 * A cap, and the response says when it bit. A list that is silently cut reads
 * as "that is everything", which is the failure mode this repo keeps writing
 * up (docs/reusable/silent-success.md).
 */
const MAX_LIBRARY_HITS = 30;

/**
 * `GET /api/library/search?q=…&limit=…` — every article at once.
 *
 * The query is read from the URL rather than a body because this is a read, and
 * a read that cannot be linked to or retried is a read that has given something
 * up for nothing.
 *
 * **Nothing here logs `q`.** It is what the reader typed, which is as much their
 * own text as a comment is — and `redact` in src/log.ts matches key names, not
 * values, so the only thing keeping it out of the log is not putting it in. The
 * `finally` in `handleApi` logs `path`, which is already stripped of its query
 * string for exactly this reason. See docs/project/logging.md.
 */
async function searchTheLibrary(url: string): Promise<LibrarySearchResponse> {
  const params = new URL(url, "http://x").searchParams;
  const query = params.get("q") ?? "";

  const asked = Number(params.get("limit") ?? MAX_LIBRARY_HITS);
  /* Clamped rather than refused. A limit is a hint from a client we wrote, and
     a 400 here would be a broken search box rather than a corrected one — but
     an unbounded one is a client asking the server to read every paragraph it
     owns. `Number.isFinite` catches `?limit=abc`, which is `NaN`, which passes
     every comparison you would write instead. */
  const limit = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), MAX_LIBRARY_HITS) : MAX_LIBRARY_HITS;

  const { hits, capped } = await librarySearch.searchLibrary(query, limit);
  return {
    // Echoed so a client can drop a response that arrived after it moved on.
    // Debounced typing produces out-of-order responses as a matter of course.
    query,
    hits,
    articles: new Set(hits.map((h) => h.slug)).size,
    capped,
  };
}

/**
 * `PATCH /api/library/:slug` — archive it, put it back, rename it.
 *
 * One route for both because they are one act from the reader's side: they
 * edited the shelf record. Sending neither field is refused rather than treated
 * as a no-op — a PATCH with nothing in it is a client bug, and answering 200
 * would hide it.
 *
 * `title: null` is meaningful and is NOT the same as omitting it: null clears
 * the reader's override and restores whatever the extractor last found. So this
 * tests `in`, not truthiness.
 *
 * **Everything is validated before anything is written, and the write is one
 * call.** An earlier version validated and wrote each field in turn, so
 * `{ title: "Changed", archived: "no" }` renamed the article and then answered
 * 400 — a request that reports failure and changes your data, which is the
 * worst available combination. Caught by a cross-family review, 2026-08-26.
 * `ShelfStore.patch` exists so that both fields land in one serialised file
 * edit or one `UPDATE`, rather than as two writes a reader can land between.
 */
async function patchShelf(slug: string, body: unknown): Promise<{ entry: LibraryEntry }> {
  /* A JSON body that is not an object at all — `"hello"`, `42`, `null` — must
     be a 400 rather than a 500. `in` throws on a primitive, so this cannot be
     folded into the checks below. */
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw httpError(400, "Expected a JSON object");
  }
  const patch = body as Record<string, unknown>;
  const hasArchived = "archived" in patch;
  const hasTitle = "title" in patch;
  if (!hasArchived && !hasTitle) {
    throw httpError(400, "Nothing to change: expected archived, title, or both");
  }

  const change: { archived?: boolean; title?: string | null } = {};

  if (hasTitle) {
    const title = patch.title;
    if (title !== null && typeof title !== "string") {
      throw httpError(400, "title must be a string or null");
    }
    change.title = title;
  }
  if (hasArchived) {
    const archived = patch.archived;
    // Not truthiness: `"false"` is the shape a hand-written client produces,
    // and treating it as true would archive an article somebody was un-archiving.
    if (typeof archived !== "boolean") throw httpError(400, "archived must be true or false");
    change.archived = archived;
  }

  return { entry: await shelfStore.patch(slug, change) };
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
  guidance?: string;
} {
  const { url, slug, steps, force, guidance } = (body ?? {}) as Record<string, unknown>;

  const stepList = (value: unknown, field: string): StepName[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || !value.every(isStepName)) {
      throw httpError(400, `${field} must be an array of step names`);
    }
    return value;
  };
  const parsedSteps = stepList(steps, "steps");
  const parsedForce = stepList(force, "force");
  const parsedGuidance = readGuidance(guidance);

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
      ...(parsedGuidance ? { guidance: parsedGuidance } : {}),
    };
  }

  if (!isSlug(slug)) {
    throw httpError(400, "Expected { url } or { slug }");
  }
  return {
    slug,
    ...(parsedSteps ? { steps: parsedSteps } : {}),
    ...(parsedForce ? { force: parsedForce } : {}),
    ...(parsedGuidance ? { guidance: parsedGuidance } : {}),
  };
}

/**
 * The reader's steer for a step that takes one, checked at the boundary.
 *
 * Three things, and the third is the one that matters. It must be a string;
 * blank is the same as absent, so a box the reader cleared does not become an
 * empty instruction; and it is **capped**, because this string is interpolated
 * into a model prompt. Uncapped, it is a way to spend somebody else's tokens by
 * the megabyte, and a long enough one would push the article itself out of the
 * context the summaries are supposed to be of.
 *
 * Refused rather than truncated. A silently shortened instruction is one the
 * reader believes they gave and did not — see docs/reusable/silent-success.md.
 * The message says the limit, so the fix is obvious from the response alone.
 *
 * The *text* is deliberately not in the error message: `httpError`'s message is
 * logged as `reason` (see `logRequest` below), and this is the reader's own
 * words about what they are reading for.
 */
export const MAX_GUIDANCE_CHARS = 600;

function readGuidance(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw httpError(400, "guidance must be a string");
  const text = value.trim();
  if (text === "") return undefined;
  if (text.length > MAX_GUIDANCE_CHARS) {
    throw httpError(400, `guidance must be ${MAX_GUIDANCE_CHARS} characters or fewer`);
  }
  return text;
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

  /* Matched on `path` rather than `url`, because the shelf now takes a query
     string (`?archived=1`). It stays an EXACT match on the path — a stray
     `/api/library/anything` must still 404 rather than quietly serve the whole
     shelf, which is what this line has always been for. */
  const library = path === "/api/library";
  /* Before the `:slug` pattern below, and it has to be: `search` is a valid
     slug shape, so the two patterns overlap and the specific one must win.
     Putting them the other way round would make `/api/library/search` a
     perfectly plausible request to rename an article called "search". */
  const librarySearchRoute = path === "/api/library/search";
  const shelfEntry = /^\/api\/library\/([\w.%-]+)$/.exec(path);
  const shelfOpen = /^\/api\/library\/([\w.%-]+)\/open$/.exec(path);
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
  /* The one POST the glossary has, and the exception that proves the rule above:
     *finding* terms is a job because it is one call over a whole article, but
     checking **one** term is a single question with a reader sitting in front of
     it — the same shape as a comment, and it reuses the same call. It can take
     the better part of a minute if the model searches, so the client's fetch
     needs a patient deadline; `explain` has its own. */
  const lookup = /^\/api\/glossary\/([\w.%-]+)\/([\w.%-]+)\/lookup$/.exec(url);
  const summary = /^\/api\/summary\/([\w.%-]+)$/.exec(url);
  const comments = /^\/api\/comments\/([\w.%-]+)$/.exec(url);
  const one = /^\/api\/comments\/([\w.%-]+)\/([\w.%-]+)$/.exec(url);
  const chat = /^\/api\/chat\/([\w.%-]+)$/.exec(url);
  const oneThread = /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)$/.exec(url);
  const chatStop = /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)\/stop$/.exec(url);
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
      /* `=== "1"`, not truthiness. `?archived=0` is a thing somebody will write
         meaning "no", and a loose check would hand them the archive. */
      const archived = new URL(url, "http://x").searchParams.get("archived") === "1";
      send(res, 200, { articles: await listArticles({ archived }) });
      return true;
    }
    if (librarySearchRoute && req.method === "GET") {
      send(res, 200, await searchTheLibrary(url));
      return true;
    }
    /* PATCH rather than PUT: both fields are optional and the client sends
       whichever the reader changed. A PUT would mean "here is the whole shelf
       record", and a client that forgot one field would silently clear it. */
    if (shelfEntry && req.method === "PATCH") {
      send(res, 200, await patchShelf(slugPart(shelfEntry, 1), await readBody(req)));
      return true;
    }
    /* POST, not GET, because it writes — and it is its own route rather than a
       side effect inside `GET /api/article/:slug` for the same reason. A GET
       that counts is a GET that a prefetch, a retry or a health check inflates
       without anybody deciding to. */
    if (shelfOpen && req.method === "POST") {
      await shelfStore.recordOpen(slugPart(shelfOpen, 1));
      // 204: there is nothing worth reading back, and a body would invite
      // somebody to render a counter that is one behind.
      res.statusCode = 204;
      res.end();
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
    if (lookup && req.method === "POST") {
      send(res, 200, await lookUpTerm(slugPart(lookup, 1), slugPart(lookup, 2)));
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
      send(res, 200, { comments: await sweepOrphaned(slug, await commentStore.load(slug)) });
      return true;
    }
    if (comments && req.method === "POST") {
      /* The second endpoint in this file that does not answer with JSON — see
         `answer`, which writes its own headers and ends the response. It is
         still reached through `send` for its *failures*: validation throws
         before a header is written, so a bad request is an ordinary 400. */
      await answer(slugPart(comments, 1), await readBody(req), res);
      return true;
    }
    if (one && req.method === "DELETE") {
      // The slug becomes a directory; the id is only ever matched against a list.
      const [slug, id] = [slugPart(one, 1), part(one, 2)];
      send(res, 200, { comments: await commentStore.remove(slug, id) });
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
    if (chatStop && req.method === "POST") {
      // The slug becomes a directory; the ids are only ever matched in a Map.
      const [slug, id] = [slugPart(chatStop, 1), part(chatStop, 2)];
      send(res, 200, await stopChat(slug, id, await readBody(req)));
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
      /* A retry or an edit the stored conversation will not accept — a stale
         tab, a second window, a Back button. 409 rather than 500, because
         nothing here is broken and the client's job is to reload and look
         again. See `ChatConflict` in src/chat.ts. */
      (err instanceof ChatConflict ? 409 : null) ??
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
