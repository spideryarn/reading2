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
 *   PATCH  /api/library/:slug    { archived?: boolean, title?: string | null, purpose?: string | null }
 *                                 → { entry, purpose } — see `patchShelf` for why purpose is beside it
 *   POST   /api/library/:slug/open   one more open, for the shelf's tooltip
 *   GET    /api/models           which model writes what — { tasks: [{ task, model, effort? }] }
 *   GET    /api/reader           `?slug=` → { profile: string | null, hasProfile: boolean }
 *   PATCH  /api/reader           { profile: string | null } → the same shape
 *   GET    /api/article/:slug    meta + blocks + tree, one payload
 *   GET    /api/source/:slug     the PDF an article was made from, for a reader to check it
 *   GET    /api/metadata/:slug   what the pipeline wrote, and whether any of it is stale
 *   GET    /api/tweets/:slug     the article as a numbered thread, and whether it is stale
 *   GET    /api/glossary/:slug   the terms this piece uses, and whether they are stale
 *   DELETE /api/glossary/:slug   throw the list away, so the next run starts over
 *   POST   /api/glossary/:slug/:id/lookup   check one term on the web, and keep the sources
 *   GET    /api/summary/:slug    the piece at more than one length, and whether it is stale
 *   GET    /api/ideas/:slug      the propositions the piece needs you to hold, and staleness
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
 *   POST   /api/search/:slug     { id?, criterion } → **a stream**, see `search`
 *   DELETE /api/search/:slug/:id
 *   POST   /api/uploads          { filename, bytes, sha256 } → where to PUT a PDF, and for how long
 *   GET    /api/uploads/:id      what became of one upload
 *   GET    /api/jobs             every ingest job this server knows about
 *   POST   /api/jobs             { url } | { uploadId } | { slug, steps?, force?, guidance? }
 *   GET    /api/jobs/:id         one job, for the progress indicator to poll
 *   DELETE /api/jobs/:id         forget a finished job's record
 *   POST   /api/jobs/:id/cancel
 *   POST   /api/jobs/:id/retry   the same steps again, skipping what succeeded
 *   POST   /api/jobs/:id/advance run the next step this job has not done yet
 *
 * The job routes return immediately; the work happens on the queue in
 * src/jobs.ts. See docs/project/comments.md, docs/project/library.md and
 * docs/project/ingest-queue.md.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
/* From the store rather than from src/api.ts directly, so that
   SPIDERYARN_STORE=postgres swaps every article read at once and no route has
   to know which store it is talking to. `files` is the default and is exactly
   src/api.ts, so nothing changes for anyone who has not opted in.
   docs/plans/postgres-storage-implementation.md */
import {
  articleMetadata,
  chatStore,
  deleteGlossary,
  librarySearch,
  listArticles,
  readerStore,
  searchStore,
  shelfStore,
  loadArticle,
  loadGlossary,
  lookUpTerm,
  loadIdeas,
  loadSummaries,
  loadTweets,
} from "./store/index.js";
/* **Pure functions only**, and that is the whole reason this import survived
   step 10 while the writes beside it did not. `withRetry` and `withEdit` take a
   snapshot and return what the result would be, so they can be run as a gate
   here and thrown away; `ChatConflict` is what they throw and what this file
   turns into a 409. Nothing here touches a file, so nothing here has to know
   which store is live. Every write goes through `chatStore` above. */
import { ChatConflict, withEdit, withRetry } from "./chat.js";
import { findPassagesStream, SEARCH_TIMEOUT_MS } from "./search.js";
/* Through the store, so SPIDERYARN_STORE moves comments and articles together.
   They cannot be split: a comment anchors to a block id, and leaving the
   questions on disk while the paragraphs they point at come from Postgres puts
   the two halves in stores nothing keeps in step. */
import { fsLocations } from "./store/artifacts-fs.js";
import { commentStore } from "./store/index.js";
import { CHAT_TIMEOUT_MS, converse } from "./converse.js";
import type { ToolRun } from "./chat-tools.js";
import { explainStream } from "./explain.js";
import { readRaw } from "./fetch.js";
import { isSpideryarnId } from "./ids.js";
import { isSlug, normaliseUrl, slugFromFilename, slugFromUrl } from "./ingest.js";
import { advanceJob, cancelJob, enqueue, forgetJob, getJob, listJobs, retryJob } from "./jobs.js";
import { requireUser, type Verifier } from "./auth.js";
import { UPLOAD_MISSING, UPLOAD_UNAVAILABLE } from "./messages.js";
import { currentOwnerId } from "./owner.js";
import { stagingKey } from "./source.js";
import { uploadGrants } from "./store/blobs.js";
import { uploadProblem } from "./uploads.js";
import {
  asOf,
  claimUpload,
  isUploadId,
  mintUpload,
  noteSlug,
  readUpload,
  recordsSurviveTheRequest,
  type UploadRecord,
} from "./upload-records.js";
import { errorFields, log, since } from "./log.js";
import { isStepName, type StepName } from "./pipeline.js";
import { hashProfile, profileIsStale, renderProfile } from "./profile.js";
import { CAPABLE_MODEL, STAGE_EFFORT, TASK_TIER, modelForOpenRouter } from "./models.js";
import type {
  Block,
  ChatAnchor,
  ChatThread,
  Comment,
  LibraryEntry,
  GlossaryResponse,
  Job,
  LibrarySearchResponse,
  ShelfState,
  IdeasResponse,
  SummariesResponse,
  ThreadResponse,
  ThreadSummary,
  SearchHit,
  SearchRun,
} from "./types.js";

/** Big enough for any selection, small enough that nothing can wedge the server. */
const MAX_BODY_BYTES = 64 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * **The document this article was made from** — today, only a PDF.
 *
 * It exists for one reason, and it is the reason a scan is shown at all: a
 * transcription of a photographed page has nothing to check it against, so the
 * only real verification available is a person looking at the ink. Every record
 * carries its page number even though v1's reader does not show it, and the raw
 * file is kept, so handing the reader the original costs one route. A second
 * machine's opinion would have cost a page-reconstruction aligner and would
 * still not have been verification. docs/plans/pdf-ingestion.md.
 *
 * `inline`, not `attachment`: the browser's own PDF viewer is the point. And
 * `X-Content-Type-Options: nosniff` because this is a stranger's file being
 * served from our origin — the one place a wrong content type becomes script.
 */
async function sendSource(res: ServerResponse, slug: string): Promise<void> {
  /* `fsLocations`, not a path built here — the store is the layer allowed to
     know where an article's files are, and a second copy of that knowledge is
     how one of them ends up pointing somewhere else. src/store/artifacts-fs.ts. */
  const { dir } = fsLocations(slug);
  const manifest = await readRaw(dir);
  if (manifest?.kind !== "pdf") throw httpError(404, "That article did not come from a PDF.");
  const bytes = await readFile(path.join(dir, manifest.file));
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${slug}.pdf"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Length", String(bytes.byteLength));
  res.end(bytes);
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
 * How often an open stream says something even when it has nothing to say.
 *
 * The number is chosen against the client's clock rather than on its own: the
 * reader's side (`readEvents` in src/web/lib/sse.ts) gives up after
 * `STREAM_STALL_MS`, so this has to be comfortably shorter than that or a
 * healthy stream would be killed for being quiet. Three beats of headroom.
 */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * Keep an open stream making noise, so that silence means something.
 *
 * Nothing on the reader's side can tell a stream that is thinking from a stream
 * that is dead — a TCP connection that has gone away without being closed
 * delivers no bytes and no error, and `reader.read()` simply never settles. The
 * only fix is for the live case to keep proving it is live, which is what this
 * does: an SSE **comment** (`: ping`) every `SSE_HEARTBEAT_MS`, which the spec
 * says a client must ignore and which `parseFrame` on our side duly drops. The
 * bytes are the message.
 *
 * That matters more here than in most streaming apps, because the silences on a
 * *healthy* chat stream are long and legitimate: a tool can run for 45 seconds
 * (`MEANING_TIMEOUT_MS` in src/chat-tools.ts) between its two `tool` frames, and
 * a round can spend ten seconds thinking before its first word. Without a
 * heartbeat the client's clock would have to be longer than the longest of
 * those, which means a dead connection is not noticed for a minute and a half.
 *
 * It also stops an idle-timeout proxy — thirty or sixty seconds is a common
 * default — closing a stream that was about to deliver.
 *
 * `unref()` so a stray interval cannot hold the process open, and the interval
 * is cleared on `close` as well as by the returned function, because the two
 * callers reach the end by different routes.
 */
export function heartbeat(
  res: ServerResponse,
  alive: () => boolean,
  /* Only a test passes this. It is here because the alternative is a
     fifteen-second test, and a heartbeat that silently never fires is exactly
     the failure docs/reusable/silent-success.md is about — the answer still
     arrives, and only the dead connections take a minute longer to notice. */
  everyMs: number = SSE_HEARTBEAT_MS,
): () => void {
  const timer = setInterval(() => {
    if (!alive()) return;
    try {
      res.write(": ping\n\n");
    } catch {
      // The socket went away between the guard and the write. Nothing to do
      // and nobody to tell: the stream is over either way.
    }
  }, everyMs);
  timer.unref?.();
  const stop = () => clearInterval(timer);
  res.on("close", stop);
  return stop;
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
  const alive = () => open && !res.writableEnded && !res.destroyed;
  // Started here rather than left to the caller, so that every stream this
  // helper opens is one the reader can tell apart from a dead one.
  heartbeat(res, alive);
  return {
    frame(event, data) {
      if (!alive()) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    alive,
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
  const { id, blockId, quote, start, deep, useProfile } = (body ?? {}) as Record<
    string,
    unknown
  >;
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
  /* `!== false`, the mirror of the line above and deliberately not the same
     rule. Deep search is an extra the reader asks for, so absent means no;
     the profile is the default this app now writes with, so absent means yes
     and only an explicit refusal turns it off. */
  const wantsProfile = useProfile !== false;

  // Before the comment is created, so a slug that is not an article is a clean
  // 404 with nothing written, rather than a stored comment whose only content is
  // the error we could have known about first.
  const article = await loadArticle(slug);

  /* **This route no longer creates explanations.**
   *
   * Since 2026-08-26 a selection opens a chat rather than buying an answer
   * (docs/plans/chat-as-gateway.md), and Greg's call was that the explanation
   * panel becomes a museum: it can show the ones you already made, and retry
   * and deepen them, but there is no way to make a new one.
   *
   * Deleting `useComments.ask` closes the React path and **nothing else**. A
   * stale tab left open in another window, or a direct request, would still
   * land here and `create` would happily mint a row. "There is no way to make a
   * new one" is then a fact about the current build rather than a rule, which
   * is the kind of thing that quietly stops being true. So the rule lives here,
   * where the writing happens.
   *
   * Retry and deepen both send the id they already have, so requiring one costs
   * them nothing. `create` stays idempotent on that id and is still what resets
   * the row — see the note on `CommentStore.create`. */
  if (typeof id !== "string") throw httpError(400, "Expected { id }");
  const known = (await commentStore.load(slug)).some((c) => c.id === id);
  if (!known) {
    throw httpError(
      404,
      "Selecting text starts a conversation now; there is no explanation to answer",
    );
  }

  const comment = await commentStore.create(slug, { blockId, quote, start, id });
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
      profile: wantsProfile ? await resolveProfile(slug) : null,
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
   * So `/stop` carries the token back and `stopChat` refuses a mismatch.
   *
   * **A random token rather than a counter**, and the first version of this was
   * a counter with a comment claiming it was never reused. It is not reused
   * *within one process*, which is not the claim that matters: two servers on
   * one `data/` directory both start at 1, so A's stale stop for attempt 1
   * matches B's live attempt 1 exactly and aborts an answer nobody asked to
   * stop — the same failure this field exists to prevent, wearing the fix as a
   * disguise. A token nobody can guess cannot collide with another process's.
   * Found by a GPT-5.6 review, 2026-08-26.
   *
   * A request with no token at all still stops whatever is there, and that is
   * deliberate rather than an oversight: a tab that reloaded mid-answer has
   * seen no `begin` frame and so has no token for the row, and it must still be
   * able to stop the answer it is watching. The hole that leaves — an old
   * client aborting a replacement — needs both a tokenless client and a live
   * replacement, and is smaller than a stop button that does nothing after a
   * reload.
   */
  attempt: string;
}

const streaming = new Map<string, Live>();

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
 * is called**, so a long answer blocks nothing. It cannot deadlock against
 * `settleThread`: the streams it waits for are past this lock already.
 *
 * It does *not* make two conversations independent, and an earlier version of
 * this comment said it did. The store's own `update` in src/chat.ts is one
 * queue for the whole process, so every write to every article still lines up
 * behind every other. This lock is narrower than that queue, not wider: it
 * holds a conversation still across *several* of those writes, which is the
 * thing the queue cannot do.
 *
 * Per process, like everything else here. Two servers on one `data/` directory
 * remains the unfixed problem in docs/plans/chat-mode.md § What is still open.
 *
 * Exported for its tests and for nothing else. The wiring — that every write in
 * `streamChat` and the thread DELETE go through it — is checked by reading;
 * what tests/turn-order.test.ts checks is that the thing they go through
 * actually excludes, actually keeps its order, and actually survives a throw.
 */
const turnOrder = new Map<string, Promise<void>>();

export async function inTurnOrder<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const before = turnOrder.get(key) ?? Promise.resolve();
  /* **The tail is what keeps the chain alive**, and it is worth being exact
     about which line does the work. `mine` rejects when `fn` does, and that
     rejection belongs to the caller and nobody else; what the *next* turn waits
     on is `tail`, which swallows both outcomes. Without that, one refused
     request would reject every later turn in this conversation with a
     stranger's error for the life of the process.

     This was first written as `before.then(fn, fn)` with a comment saying the
     second handler was what saved the chain. It was dead code — `before` is a
     tail and a tail never rejects — and the comment was pointing at the wrong
     line for a property the code did genuinely have. */
  const mine = before.then(fn);
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
/**
 * How long an abandoned `pending` answer is left alone before a sweep calls it
 * a failure.
 *
 * Exported for one test, which asserts that the client watches for at least
 * this long — see `RECOVER_MARGIN_MS` in src/web/useChat.ts. A client that gave
 * up first would declare a failure over a row this server was about to turn
 * into an answer, and the two numbers drifting apart is invisible from either
 * side on its own.
 */
export const CHAT_ORPHAN_GRACE_MS = 150_000;

/**
 * The window must outlive the longest a model call can legally take, and here
 * is where that is checked rather than assumed.
 *
 * **There is no heartbeat.** An attempt is written once when it starts and
 * once when it ends, and nothing in between says "still going". So the grace
 * window is the *only* thing standing between another process's live answer
 * and a sweep that buries it — and an attempt that outlives the window is
 * buried while it is still running, with the reader watching the words arrive.
 *
 * `CHAT_TIMEOUT_MS` is 120s (src/converse.ts), which is the hard deadline on
 * the whole turn including every tool round. 150s leaves 30s for the write and
 * for a clock the two processes do not share exactly. If that deadline ever
 * goes up, this has to go up with it, which is what this assertion is for: it
 * fails at import, on every machine, rather than turning into a rare answer
 * that disappears.
 */
if (CHAT_ORPHAN_GRACE_MS <= CHAT_TIMEOUT_MS) {
  throw new Error(
    `CHAT_ORPHAN_GRACE_MS (${CHAT_ORPHAN_GRACE_MS}ms) must be longer than CHAT_TIMEOUT_MS ` +
      `(${CHAT_TIMEOUT_MS}ms), or a sweep buries answers that are still being written. ` +
      "There is no heartbeat, so this window is the only thing protecting them.",
  );
}

/**
 * The same number for a meaning-search, and it is a different number because
 * the deadline it has to clear is a different deadline.
 *
 * `SEARCH_TIMEOUT_MS` is 60s (src/search.ts) — a search is one call with no
 * tool rounds, so it is bounded much tighter than a chat turn. 90s leaves the
 * same 30s of room for the article read that happens after `begin`, the write
 * that happens after the model, and two processes' clocks.
 *
 * **The filesystem store ignores it entirely**, and that is today's behaviour
 * rather than an oversight: it errors any `pending` run this process did not
 * start, immediately. Only Postgres has other processes to be wrong about.
 */
export const SEARCH_ORPHAN_GRACE_MS = 90_000;

if (SEARCH_ORPHAN_GRACE_MS <= SEARCH_TIMEOUT_MS) {
  throw new Error(
    `SEARCH_ORPHAN_GRACE_MS (${SEARCH_ORPHAN_GRACE_MS}ms) must be longer than SEARCH_TIMEOUT_MS ` +
      `(${SEARCH_TIMEOUT_MS}ms), or a sweep buries searches that are still running.`,
  );
}

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

/**
 * What this process is answering *in this article*, as bare message ids.
 *
 * `streaming` is keyed `slug/threadId/messageId` because that is what a stop
 * request names; `SweepOptions.keep` is a set of message ids because that is
 * what a row is called. Converting here rather than changing either is
 * deliberate — the key has to stay unique across articles, and the store must
 * not be handed a composite it would then have to take apart.
 *
 * **Filtered by slug.** Handing over every live id in the process would spare a
 * row in *this* article that happens to share an id with one being written in
 * another, which is possible: ids are unique per article, not globally.
 */
function liveMessages(slug: string): Set<string> {
  const prefix = `${slug}/`;
  const ids = new Set<string>();
  for (const key of streaming.keys()) {
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(key.lastIndexOf("/") + 1);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Turn abandoned `pending` answers into `error`, so the reader can ask again.
 *
 * The rule itself lives in the store now — `fsChatStore.sweepPending` for the
 * filesystem, an `UPDATE … WHERE` for Postgres — and what is left here is the
 * half only a running server knows: which rows this process is writing, and
 * how long another process's row is allowed to be silent. See `SweepOptions`
 * in src/store/contracts.ts for why neither half is sufficient alone.
 */
function sweepChat(slug: string): Promise<ChatThread[]> {
  return chatStore.sweepPending(slug, {
    keep: liveMessages(slug),
    graceMs: CHAT_ORPHAN_GRACE_MS,
  });
}

/**
 * Answer a question, streaming the words out as they arrive.
 *
 * **Server-sent events**, so the frames are `event: <name>` + `data: <json>`.
 * The contract is the same one src/converse.ts offers: one `begin`, then any
 * number of `delta` and `tool` in whatever order they happen, then exactly one
 * of `done` or `error`.
 *
 * A `tool` frame is `{ index, run }` and is sent **twice per tool** — once when
 * it starts and once when it finishes, both under the same `index`, so the
 * client assigns into an array rather than matching a start to an end. See
 * docs/project/chat-tools.md.
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
  const { threadId, question, at, retry, edit, expectedTailId, useProfile, anchor } = (body ??
    {}) as Record<string, unknown>;
  if (typeof threadId !== "string") throw httpError(400, "Expected { threadId, … }");
  /* Absent means yes, as it does everywhere the profile is offered. Per turn
     rather than per thread, because the composer's checkbox is per turn — a
     reader may reasonably want one answer written plainly in the middle of a
     conversation that is otherwise theirs. */
  const wantsProfile = useProfile !== false;
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
  /* **An anchor belongs to a turn that creates a thread, and to no other.**
     `withRetry` and `withEdit` do not go through `withTurn` at all, so an
     anchor sent with either would be dropped without a word — and the reader
     would have a conversation the database says is about a passage they never
     chose. Refused rather than ignored. */
  if (anchor !== undefined && (wantsRetry || wantsEdit)) {
    throw httpError(400, "An anchor can only be sent with a new question");
  }
  const wanted = parseAnchor(anchor);
  // Loaded before anything is written, so a bad slug is still an ordinary JSON
  // 404 rather than an `error` frame inside a 200 stream.
  const article = await loadArticle(slug);
  /* Checked against the real article, not just against itself. The three column
     checks in the schema let a malformed id, an empty quote and an offset past
     the end of the block through, and the foreign key only catches the first of
     those. This is where the rest is caught — and it is done after
     `loadArticle` because it needs the blocks. */
  if (wanted) checkAnchor(wanted, article.blocks);

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
      const snapshot = await chatStore.load(slug);
      if (wantsRetry) withRetry(snapshot, threadId, retry as string, "");
      else withEdit(snapshot, threadId, edit as string, (question as string).trim(), "");

      /* Both of these rewrite rows that a live answer in this thread may be
         halfway through writing, so the live one is stopped and *waited for*
         first. Not needed for an ordinary send: that appends, and appending
         beside a stream is already ordered correctly by the serialised queue in
         src/chat.ts. */
      await settleThread(slug, threadId);
    }
    /* **A thread is anchored once.** Reached only for an ordinary send, and
       only when one was offered — `withTurn` applies an anchor solely on the
       branch that builds a new thread, so without this the second question of
       an anchored conversation could carry a different passage and be accepted
       in silence. What the reader would then have is a conversation the
       database says is about passage A holding a question about passage B, with
       nothing anywhere disagreeing.

       Read under `inTurnOrder`, so the thread cannot be created between the
       look and the write.

       An identical anchor is allowed through, which is what makes a retried
       send — the same request arriving twice — harmless rather than a 409 the
       reader has to understand. */
    if (wanted) {
      const existing = (await chatStore.load(slug)).find((t) => t.id === threadId);
      if (existing && !sameAnchor(existing.anchor, wanted)) {
        throw httpError(409, "That conversation is already about a different passage");
      }
    }
    return wantsRetry
      ? await chatStore.retry(slug, threadId, retry as string)
      : wantsEdit
        ? await chatStore.edit(slug, threadId, edit as string, (question as string).trim(), {
            /* **The guard is only as good as the client's willingness to send
               it**, which is why it is optional in the contract and not
               optional here in spirit: an edit that names no tail is an
               unguarded edit, and a stale tab can then delete every turn added
               since it last looked. src/web/useChat.ts sends the id of the
               message it believes is last. A body without one still works —
               an old tab mid-session, a curl — and is simply not protected. */
            ...(typeof expectedTailId === "string" ? { expectedTailId } : {}),
          })
        : await chatStore.begin(slug, {
            threadId,
            question: (question as string).trim(),
            ...(wanted ? { anchor: wanted } : {}),
          });
  });
  const { thread, reply, user } = begun;
  /* **Which model call this is**, as far as storage is concerned, and it is
     NOT the same thing as `attempt` below.

     `Live.attempt` is a token this process invents so a reader's stop can name
     the answer they were watching; it never leaves this process. This one comes
     out of the store and goes back into `finish`, and it is what stops a call
     some *other* process's sweep already declared dead from landing on top of
     the retry the reader is now watching. `undefined` from the filesystem
     store, which has no attempts — see `Turn` in src/store/contracts.ts. */
  const storeAttempt = begun.attempt;
  /* **The question that was stored is the question that gets asked** — one rule
     for all three kinds of turn, rather than "the request's text, except on a
     retry". A retry has no question in its request at all, and taking one from
     there would let a stale tab retry one question and store the answer under
     another: the row above saying one thing and the answer below it being to
     something else, with nothing on screen to show the two had parted. */
  const asked = user.text;
  const key = `${slug}/${thread.id}/${reply.id}`;
  const attempt = randomUUID();
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
  const alive = () => open && !res.writableEnded && !res.destroyed;
  const frame = (event: string, data: unknown) => {
    if (!alive()) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  /* Cleared in the `finally`. This route does not go through `sse(res)` — it
     writes its headers itself, inside the try, so that a socket dying between
     `beginTurn` and the first write cannot leak the `streaming` key — so it
     needs its own beat. See `heartbeat` for why an idle chat stream needs one
     more than most: a tool round is 45 seconds of legitimate silence. */
  let stopBeating = () => {};

  let text = "";
  /** What the tools did, kept so a turn that fails still records them. */
  const tools: ToolRun[] = [];
  try {
    streaming.set(key, { stop, done, attempt });
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    stopBeating = heartbeat(res, alive);

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
      // The tools need to know which article the reader has open; the prompt
      // does not, and does not get it. src/chat-tools.ts § ToolContext.
      slug,
      /* Resolved per turn rather than once per thread, so a reader who edits
         their profile mid-conversation gets the next answer written to the new
         one. The opposite of the job path, which freezes it — and the reason
         they differ is that a turn resolves this **once** and hands the same
         string to every round of it, so there is no window in which half an
         artefact could be written to each. (That used to read "a turn is one
         call", which stopped being true the day chat grew a tool loop. The
         conclusion held; the reason had rotted. Found by a GPT Sol review,
         2026-08-26.) */
      profile: wantsProfile ? await resolveProfile(slug) : null,
      signal: stop.signal,
    })) {
      if (event.type === "delta") {
        text += event.text;
        frame("delta", { text: event.text });
        continue;
      }
      /* A tool starting, or the same tool finishing — one frame either way, and
         the client assigns by `index`. Held here as well as sent, because the
         connection may close mid-turn: the answer still finishes and is still
         stored (see point 3 in the header), and it should be stored with the
         tools it actually ran rather than with an empty list because nobody was
         watching. That copy is what makes a *failed* turn keep them too. */
      if (event.type === "tool") {
        tools[event.index] = event.run;
        frame("tool", { index: event.index, run: event.run });
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
        /* Omitted rather than stored empty, the same rule `stopped` follows on
           the next line: most answers use no tools, and a `"tools": []` on every
           one of them is noise in a file a person may well open. */
        ...(event.tools.length > 0 ? { tools: event.tools } : {}),
        // Same rule again: a flag only when it is true, so an ordinary answer
        // does not carry two `false`s into the file for the life of the thread.
        ...(event.truncated ? { truncated: true } : {}),
        ...(event.stopped ? { stopped: true } : {}),
      };
      await chatStore.finish(slug, thread.id, reply.id, finished, { attempt: storeAttempt });
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
      await chatStore.finish(
        slug,
        thread.id,
        reply.id,
        {
          text,
          status: "error",
          error: message,
          // A failed turn keeps what its tools found, for the same reason it
          // keeps its half-written text: the reader watched both happen.
          ...(tools.length > 0 ? { tools } : {}),
        },
        // The same attempt as the success path. A failure is this call
        // reporting, and a call whose fence has been taken away by a sweep may
        // no longer report at all — which is the point of the fence.
        { attempt: storeAttempt },
      );
    } catch (storeErr) {
      log("store").error(
        { ...errorFields(storeErr), slug, threadId: thread.id, messageId: reply.id },
        "could not record a failed chat answer",
      );
    }
    frame("error", { error: message, text });
  } finally {
    stopBeating();
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
  if (typeof attempt === "string" && attempt !== live.attempt) return { stopped: false };
  live.stop.abort(new Error("stopped by the reader"));
  await live.done;
  return { stopped: true };
}

/**
 * **Stop the first answer of a conversation, and throw the conversation away.**
 *
 * Greg's call, 2026-08-26: a reader who selects a sentence, sees the answer
 * start, and changes their mind wants the whole thing gone — panel, mark and
 * all, "as if you had never selected the text". Distinct from `stopChat` above,
 * which keeps what arrived and is what a reader means further into a real
 * conversation.
 *
 * ## Why this is one route and not `stop` followed by `DELETE`
 *
 * That was the first plan, and a GPT-5.6 review took it apart. `stopChat`'s
 * `await live.done` genuinely does what it says — the *named* writer has
 * finished when it returns — but it does not make the pair atomic:
 *
 *     Tab A                          Tab B
 *     POST …/stop
 *       aborts, awaits, returns
 *                                    sends a second question
 *                                    (the thread now has two turns)
 *     DELETE …/<threadId>
 *       deletes BOTH turns
 *
 * `DELETE` has no expected-tail guard, so B's question dies with A's. Four more
 * ways through, all of them from the same review:
 *
 *  - a stop pressed before the `begin` frame names a provisional id, so it
 *    stops nothing and the delete then races a live stream;
 *  - `{stopped:false}` conflates "already finished", "wrong attempt" and "the
 *    writer is in another process", and only the first is safe to act on;
 *  - two filesystem servers can interleave `A load → B delete+save → A stale
 *    save` and resurrect the thread;
 *  - a concurrent sweep is not a cancellation fence.
 *
 * So the check and the delete happen together, here, with the tail named.
 *
 * ## What it does not promise
 *
 * **Aborting the model call is best-effort across processes.** `streaming` is
 * this process's map; another server's call cannot be reached, so it runs to
 * the end and is paid for, and its `finish` then updates zero rows because the
 * thread is gone. Deletion is the part that is guaranteed, and it is the part
 * that matters.
 */
async function cancelChat(
  slug: string,
  threadId: string,
  body: unknown,
): Promise<{ cancelled: boolean }> {
  const { messageId, attempt, expectedTailId } = (body ?? {}) as Record<string, unknown>;
  if (typeof messageId !== "string") throw httpError(400, "Expected { messageId }");

  return inTurnOrder(`${slug}/${threadId}`, async () => {
    const thread = (await chatStore.load(slug)).find((t) => t.id === threadId);
    /* Already gone. Not an error: a second tab, a double-press, or a reader who
       cancelled and reloaded. The client wants to close the panel either way. */
    if (!thread) return { cancelled: true };

    /* **Exactly one turn**, which is what "the first answer" means. Anything
       else is a conversation the reader has been having, and deleting it
       because they pressed a button labelled for the other case is the outcome
       this whole route exists to prevent. */
    if (thread.messages.length !== 2) {
      throw httpError(409, "That conversation has more in it than the answer you stopped");
    }
    const tail = thread.messages[thread.messages.length - 1];
    if (tail?.id !== messageId) {
      throw httpError(409, "That is not the answer at the end of this conversation");
    }
    /* The client sends what it believes is last; a body without one is simply
       unguarded, the same deliberate looseness `edit`'s `expectedTailId` has. */
    if (typeof expectedTailId === "string" && expectedTailId !== tail.id) {
      throw httpError(409, "This conversation has moved on since you looked");
    }

    /* Abort and **wait**, before the delete rather than after it. A writer still
       running would otherwise `finish` into rows we are about to remove — on
       Postgres that updates nothing, but the filesystem store would write the
       whole thread list back from a snapshot taken before the delete, and the
       conversation would be there again on the next read. */
    const live = streaming.get(`${slug}/${threadId}/${messageId}`);
    if (live && (typeof attempt !== "string" || attempt === live.attempt)) {
      live.stop.abort(new Error("cancelled by the reader"));
      await live.done;
    }

    await chatStore.remove(slug, threadId);
    log("store").info({ slug, threadId }, "chat cancelled and discarded");
    return { cancelled: true };
  });
}

/**
 * A thread with its transcript replaced by the two facts a hover needs.
 *
 * `turns` counts the reader's questions rather than all messages, because that
 * is what "three turns" means to a person looking at a tooltip.
 *
 * `lastLine` is the opening of the most recent **finished** answer. Deliberately
 * not the pending one: a half-written answer is not a summary of anything, and
 * an empty string in a tooltip reads as a bug. It is omitted rather than
 * blanked when there is nothing to show, so the client's test is `if
 * (lastLine)` rather than a length check on a string that might be whitespace.
 *
 * **Never carries the anchor quote into a log**, because nothing here logs. The
 * quote is article prose, which docs/project/logging.md forbids; it travels in
 * this response body and nowhere else.
 */
function summarise(thread: ChatThread): ThreadSummary {
  const answers = thread.messages.filter((m) => m.role === "assistant" && m.status === "done");
  const last = answers[answers.length - 1]?.text.trim().split(/\n/)[0]?.trim();
  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    ...(thread.anchor ? { anchor: thread.anchor } : {}),
    turns: thread.messages.filter((m) => m.role === "user").length,
    ...(last ? { lastLine: last } : {}),
  };
}

/** Long enough for a paragraph of context, short enough that nothing runs away. */
const MAX_QUESTION_CHARS = 4000;

/**
 * How long a selection may be, in characters.
 *
 * **Its own limit, not the question's**, and that is not tidiness. A question is
 * something a reader types; an anchor quote is a passage of somebody else's
 * prose that they dragged across, and a long paragraph goes past 4,000
 * characters without trying. Sharing one limit meant selecting a long passage
 * opened a thread optimistically and then took a 413 with the panel already on
 * screen. Found by a GPT-5.6 review, 2026-08-26.
 *
 * Generous, because the cost of a big quote is tokens rather than risk, and the
 * client refuses over-long selections before it mints a thread anyway. The
 * ceiling that actually bites first is `MAX_BODY_BYTES`.
 */
const MAX_ANCHOR_CHARS = 20_000;

/**
 * The `anchor` field of a chat request, as a `ChatAnchor` or nothing.
 *
 * Shape only — whether the block exists and whether the quote is really at that
 * offset are `checkAnchor`'s job, because those need the article.
 *
 * **No part of the quote reaches a thrown message.** `httpError` messages are
 * logged as `reason`, redaction is path-based and cannot reach inside a string,
 * and the quote is article prose — which docs/project/logging.md says must
 * never be logged. The same rule `answer()` states for `deep` a few hundred
 * lines up, and the reason every message here describes the shape rather than
 * quoting the value.
 */
function parseAnchor(anchor: unknown): ChatAnchor | undefined {
  if (anchor === undefined || anchor === null) return undefined;
  if (typeof anchor !== "object") throw httpError(400, "anchor must be an object");
  const { blockId, quote, start } = anchor as Record<string, unknown>;
  if (typeof blockId !== "string" || !isSpideryarnId(blockId)) {
    throw httpError(400, "anchor.blockId must be a block id");
  }
  /* Both or neither. Half an anchor is not an error anybody sees — it is a mark
     drawn a few characters to the left of the words it belongs to, which reads
     as a styling glitch rather than as bad data. The database says the same
     thing in `chat_threads_anchor_both`; this says it before the write. */
  const hasQuote = quote !== undefined;
  const hasStart = start !== undefined;
  if (hasQuote !== hasStart) {
    throw httpError(400, "anchor needs both quote and start, or neither");
  }
  if (!hasQuote) return { blockId };
  if (typeof quote !== "string" || quote.trim() === "") {
    throw httpError(400, "anchor.quote must be a non-empty string");
  }
  if (quote.length > MAX_ANCHOR_CHARS) {
    throw httpError(413, `A selection may be at most ${MAX_ANCHOR_CHARS} characters`);
  }
  if (typeof start !== "number" || !Number.isInteger(start) || start < 0) {
    throw httpError(400, "anchor.start must be a non-negative integer");
  }
  return { blockId, quote, start };
}

/**
 * Are these the same anchor?
 *
 * A thread with no anchor is **not** the same as one with any anchor: a send
 * offering a passage for an unanchored conversation is still trying to change
 * what that conversation is about, and it is refused. `undefined` on both sides
 * cannot reach here — the caller only asks when it has one.
 */
function sameAnchor(stored: ChatAnchor | undefined, wanted: ChatAnchor): boolean {
  if (!stored) return false;
  if (stored.blockId !== wanted.blockId) return false;
  const a = "quote" in stored ? stored : null;
  const b = "quote" in wanted ? wanted : null;
  if (!a || !b) return a === b; // both block-only, or one of each
  return a.quote === b.quote && a.start === b.start;
}

/**
 * The anchor against the article it claims to be part of.
 *
 * Three things the schema cannot check, in the order they matter:
 *
 *  - **the block is one of this article's.** The foreign key would catch it too,
 *    but as a 500 out of a transaction rather than as a 400 anybody can read;
 *  - **the offset is inside the block**, rather than past the end of it;
 *  - **the quote is really the text at that offset.** Not required to match —
 *    the client measures in the *rendered* offset space and the server has the
 *    block's `text`, and the two can differ by whitespace — so a mismatch is
 *    allowed through. `resolveMark` re-finds the quote in the rendered text
 *    rather than trusting the offset, exactly as src/quote-match.ts does for a
 *    search hit, so a drifted offset costs nothing. What is refused is a quote
 *    that is not in the block **at all**, which is the case that means the
 *    client is anchoring to something else entirely.
 */
function checkAnchor(anchor: ChatAnchor, blocks: Block[]): void {
  const block = blocks.find((b) => b.id === anchor.blockId);
  if (!block) throw httpError(400, "anchor.blockId is not a block of this article");
  if (!("quote" in anchor)) return;
  if (anchor.start > block.text.length) {
    throw httpError(400, "anchor.start is past the end of that block");
  }
  /* Whitespace-folded on both sides, because the rendered text the client
     measured collapses runs of space that `block.text` may keep. Comparing them
     literally rejected perfectly good selections. */
  const fold = (t: string) => t.replace(/\s+/g, " ").trim();
  if (!fold(block.text).includes(fold(anchor.quote))) {
    throw httpError(400, "anchor.quote is not in that block");
  }
}

/* --------------------------------------------------------------- search --
   Finding a passage by what it says. See docs/project/search.md.

   Streams now, and it is worth saying what this comment used to argue and why
   that turned out to be wrong. It said a search result is a list, not prose,
   so there is nothing to watch arrive and streaming would buy the reader a
   progress bar they cannot read. That mistook "not prose" for "nothing worth
   showing as it arrives". A hit is a complete, self-contained object —
   blockId, quote, confidence, reasoning — and src/search.ts's prompt already
   asks the model to return them best-match-first. The moment a hit's closing
   brace has arrived in the model's output, src/search-hits-stream.ts's
   `hitExtractor` can hand it over, so the strongest match highlights the
   article while the model is still composing its tenth-best guess, instead of
   the reader watching a spinner for the whole pass. Nothing about the prompt
   or the ranking changed to make this true — `findPassagesStream` is still one
   call asked for one JSON object, and the eventual `done` is still the
   authoritative, strictly-parsed answer. See that file's module docstring
   § Streaming. */

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

/**
 * What this process is searching *in this article*, as bare run ids.
 *
 * The same conversion `liveMessages` does, and for the same two reasons: the
 * set's key has to stay unique across articles, and the store's `keep` is a
 * set of row ids rather than of composites it would have to take apart.
 */
function liveRuns(slug: string): Set<string> {
  const prefix = `${slug}/`;
  const ids = new Set<string>();
  for (const key of searching) {
    if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
  }
  return ids;
}

/**
 * Turn abandoned `pending` searches into `error`, so they can be run again.
 *
 * As with `sweepChat`, the rule is the store's and only the two things a
 * running server knows are here: what this process is writing, and how long
 * another process's row may stay silent. The filesystem store ignores the
 * grace window — it has no other processes to be wrong about, and giving it
 * one would be an improvement smuggled in under a migration.
 */
function sweepSearches(slug: string): Promise<SearchRun[]> {
  return searchStore.sweepPending(slug, {
    keep: liveRuns(slug),
    graceMs: SEARCH_ORPHAN_GRACE_MS,
  });
}

/**
 * Run a search, streaming hits as they arrive, and store the result.
 *
 * Shaped on `answer` above — see its docstring for the reasoning behind each
 * decision, repeated here rather than reinvented:
 *
 * - **Validation happens before `beginRun`**, so a bad request is still an
 *   ordinary JSON 400 — the thrown `httpError` never reaches a half-opened
 *   stream.
 * - `beginRun` writes the `pending` row **before** a header goes out, exactly
 *   as `commentStore.create` does, so a crash mid-search leaves evidence.
 * - Frames: one `begin` (the whole run — `beginRun` may reset an existing id
 *   rather than mint one, see `withRun` in src/searches.ts, and `?runs=` has
 *   to be able to name the real one from the first frame), then any number of
 *   `hit`, then exactly one `done` — **unless the run was deleted while the
 *   model was thinking**, see below.
 * - A model failure is a `done` frame carrying a run whose status is `error`,
 *   not an HTTP error: the request *did* succeed at what it was for, which was
 *   recording the criterion. The panel shows the failure and offers to try
 *   again.
 * - **Nothing past `sse(res)` may throw.** The store write after the loop is
 *   wrapped for the same reason `answer`'s is: a store that cannot record the
 *   result is a worse thing than a failed search, and it deserves its own log
 *   line rather than an escaped exception landing on a response whose headers
 *   are long gone.
 *
 * **What's different from `answer`: the deleted-mid-search case cannot be a
 * 404 any more.** The old JSON version threw one when `finishRun` reported the
 * run gone — the reader had deleted it while the model was still thinking, and
 * `finishRun` deliberately does not resurrect a row that is no longer there
 * (see its docstring in src/searches.ts). With a stream the headers are
 * already sent, so there is no status code left to change. The client already
 * knows: deleting a run is a purely local act (the `deleted` tombstone in
 * src/web/useSearch.ts), and the row is off screen before this response is
 * even being watched. So the server's half of the contract is simply to stay
 * quiet about a run that is not there any more — no `done` frame, just the
 * stream ending — and the client's half is to treat a stream that ends
 * without `done` as *expected* for a run it has already forgotten, rather than
 * as the broken-connection failure it is for any other run.
 */
async function search(slug: string, body: unknown, res: ServerResponse): Promise<void> {
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

  const { run, attempt } = await searchStore.begin(
    slug,
    criterion.trim(),
    typeof id === "string" ? id : undefined,
  );
  const key = `${slug}/${run.id}`;
  searching.add(key);

  const { frame } = sse(res);
  frame("begin", run);

  let patch: Partial<SearchRun>;
  try {
    const article = await loadArticle(slug);
    let hits: SearchHit[] = [];
    let model = "";
    for await (const event of findPassagesStream({
      meta: article.meta,
      blocks: article.blocks,
      criterion: run.criterion,
    })) {
      if (event.type === "hit") {
        frame("hit", { hit: event.hit });
        continue;
      }
      hits = event.result.hits;
      model = event.result.model;
    }
    patch = { status: "done", hits, model };
  } catch (err) {
    patch = { status: "error", error: (err as Error).message };
  } finally {
    searching.delete(key);
  }

  try {
    /* The attempt goes back with the answer, and the Postgres store refuses a
       `finish` without one rather than falling back to identity. A run keeps
       its id across a retry — that is what makes it the same question — so
       identity alone cannot say which model call is reporting, and a call a
       sweep already buried would otherwise land on top of the retry the reader
       is watching. `undefined` on the filesystem, which has no attempts. */
    const stored = await searchStore.finish(slug, run.id, patch, attempt);
    /* `undefined` now means one of two things and both are silence. The reader
       deleted this run while the model was thinking — see the docstring above,
       the client has already forgotten the row — or this attempt is no longer
       the live one, in which case there is a newer answer on its way and
       saying anything about this one would only overwrite it on screen. */
    if (stored) frame("done", stored);
  } catch (storeErr) {
    log("store").error(
      { ...errorFields(storeErr), slug, id: run.id },
      `could not record a search result for ${slug}`,
    );
  } finally {
    res.end();
  }
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
 * `PATCH /api/library/:slug` — archive it, put it back, rename it, or say why
 * you're reading it.
 *
 * One route for all three because they are one act from the reader's side:
 * they edited the shelf record. Sending none of the accepted fields is
 * refused rather than treated as a no-op — a PATCH with nothing in it is a
 * client bug, and answering 200 would hide it.
 *
 * `title: null` and `purpose: null` are both meaningful and NOT the same as
 * omitting the key: `title: null` clears the reader's override and restores
 * whatever the extractor last found; `purpose: null` clears "why you're
 * reading this one" (docs/plans/reader-profile.md). So this tests `in`, not
 * truthiness.
 *
 * **Everything is validated before anything is written, and the write is one
 * call.** An earlier version validated and wrote each field in turn, so
 * `{ title: "Changed", archived: "no" }` renamed the article and then answered
 * 400 — a request that reports failure and changes your data, which is the
 * worst available combination. Caught by a cross-family review, 2026-08-26.
 * `ShelfStore.patch` exists so that every field lands in one serialised file
 * edit or one `UPDATE`, rather than as separate writes a reader can land
 * between.
 */
async function patchShelf(
  slug: string,
  body: unknown,
): Promise<{ entry: LibraryEntry; purpose: string | null }> {
  /* A JSON body that is not an object at all — `"hello"`, `42`, `null` — must
     be a 400 rather than a 500. `in` throws on a primitive, so this cannot be
     folded into the checks below. */
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw httpError(400, "Expected a JSON object");
  }
  const patch = body as Record<string, unknown>;
  const hasArchived = "archived" in patch;
  const hasTitle = "title" in patch;
  const hasPurpose = "purpose" in patch;
  if (!hasArchived && !hasTitle && !hasPurpose) {
    throw httpError(400, "Nothing to change: expected archived, title, purpose, or some of them");
  }

  const change: { archived?: boolean; title?: string | null; purpose?: string | null } = {};

  if (hasTitle) {
    const title = patch.title;
    if (title !== null && typeof title !== "string") {
      throw httpError(400, "title must be a string or null");
    }
    change.title = title;
  }
  if (hasPurpose) {
    const purpose = patch.purpose;
    if (purpose !== null && typeof purpose !== "string") {
      throw httpError(400, "purpose must be a string or null");
    }
    change.purpose = purpose;
  }
  if (hasArchived) {
    const archived = patch.archived;
    // Not truthiness: `"false"` is the shape a hand-written client produces,
    // and treating it as true would archive an article somebody was un-archiving.
    if (typeof archived !== "boolean") throw httpError(400, "archived must be true or false");
    change.archived = archived;
  }

  const entry = await shelfStore.patch(slug, change);
  /* **`purpose` is answered beside the entry, not on it.** `LibraryEntry` is the
     shelf card, and it already refuses to carry the superseded title for the
     reason that a string nothing renders should not be on the wire for every
     card on the homepage. The reader's note about why they are reading one
     article is that argument one field further on: only the metadata page shows
     it, and putting it on the card would send it with all thirty.

     But the caller does need it back, and needs it as the *store* holds it
     rather than as they sent it — the value is trimmed and its line endings
     settled on the way in, and a box showing one string while every prompt
     carries another is the failure this whole feature is arranged around. So
     one extra read, on a write, on this route only. */
  const { purpose } = await shelfStore.read(slug);
  return { entry, purpose: purpose ?? null };
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
/**
 * A request naming an upload names **nothing else**, and this throws if it does.
 *
 * `{ url, uploadId }` and `{ slug, uploadId }` are both requests whose author
 * believed something false about what they were asking for, and the second is
 * the shape that would have been dangerous: an upload's bytes written into an
 * article the caller named. There is no honest reason to send two origins, so
 * there is deliberately no precedence rule — and therefore none to get wrong
 * later.
 *
 * Asserting the id's shape here too, so that the two checks a caller has to
 * pass are in one place rather than one here and one three lines down.
 */
function checkUploadOrigin(
  uploadId: unknown,
  others: { url: unknown; slug: unknown; steps: unknown; force: unknown; guidance: unknown },
): asserts uploadId is string {
  if (others.url !== undefined || others.slug !== undefined) {
    throw httpError(400, "Send a url, a slug, or an uploadId — not two of them");
  }
  /* **And no step controls either**, which is not tidiness. Claiming happens
     before `enqueue` validates anything, so `{ uploadId, steps: [] }` takes the
     one-and-only claim and *then* gets a 400 for having no steps — leaving an
     attempt stuck `claimed` with no job and no way to reach it. `steps:
     ["arc"]` is worse: it claims, skips acquisition entirely, and runs a model
     stage over an article that does not exist. An upload is always the default
     ingest, which is what the documented `{ uploadId }` shape already said.
     GPT Sol, 2026-08-27. */
  for (const [name, value] of [
    ["steps", others.steps],
    ["force", others.force],
    ["guidance", others.guidance],
  ] as const) {
    if (value !== undefined) {
      throw httpError(400, `An upload runs the default steps — ${name} is not accepted with one`);
    }
  }
  if (!isUploadId(uploadId)) throw httpError(400, "That is not an upload id");
}

export function parseJobRequest(body: unknown): {
  slug: string;
  url?: string;
  steps?: StepName[];
  force?: StepName[];
  guidance?: string;
  /**
   * Whether this run should use the reader's profile. Default true.
   *
   * A boolean rather than the profile itself, because **the caller must not get
   * to say who the reader is.** The text is resolved server-side from the
   * store, by `resolveProfile` below; all a client may do is decline it. Any
   * other arrangement would make "who is reading" a request parameter, which is
   * a way to spend tokens on a string of your choosing and a way to put
   * arbitrary text into a prompt that writes an artefact.
   */
  useProfile?: boolean;
  /**
   * An upload to make an article from, instead of a URL.
   *
   * **Only the id.** The filename, the size and the claimed hash all live on
   * the record we wrote when we minted the grant, and the object key is derived
   * from the id by `stagingKey` — so there is nothing here for a caller to
   * point at somebody else's bytes with. That is the rule the plan calls
   * load-bearing: *never accept a client-supplied object path*.
   */
  uploadId?: string;
} {
  const { url, slug, steps, force, guidance, useProfile, uploadId } = (body ?? {}) as Record<
    string,
    unknown
  >;

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
  /* Absent means yes. Not truthiness on the raw value: `useProfile: "false"` is
     the shape a hand-written client produces, and reading it as true would
     write a profiled artefact for somebody who asked for a plain one — the same
     trap `archived` names two hundred lines up. */
  if (useProfile !== undefined && typeof useProfile !== "boolean") {
    throw httpError(400, "useProfile must be true or false");
  }
  const parsedUseProfile = useProfile;

  /* The four optional fields, spelled once. They were written out at each of
     the three `return`s, which is three chances for one of them to be quietly
     dropped from a branch — and `exactOptionalPropertyTypes` means the spread
     has to be conditional rather than `steps: parsedSteps`, so each one is four
     lines rather than one. */
  const rest = {
    ...(parsedSteps ? { steps: parsedSteps } : {}),
    ...(parsedForce ? { force: parsedForce } : {}),
    ...(parsedGuidance ? { guidance: parsedGuidance } : {}),
    ...(parsedUseProfile !== undefined ? { useProfile: parsedUseProfile } : {}),
  };

  /* Before the URL branch. `checkUploadOrigin` refuses every combination rather
     than picking a winner — see its own note. */
  if (uploadId !== undefined) {
    checkUploadOrigin(uploadId, { url, slug, steps, force, guidance });
    return {
      /* A placeholder the caller must replace. The real slug comes from the
         upload record's filename and is allocated inside `enqueue`, which is
         the only place with no gap between deciding and inserting. */
      slug: "",
      uploadId,
      ...rest,
    };
  }

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
    /* Normalised before anything else looks at it, so the URL that is fetched,
       the URL stored in meta.json and the URL `freeSlug` compares against the
       shelf are one string rather than three spellings of one. See
       `normaliseUrl` in src/ingest.ts. */
    const source = normaliseUrl(url);
    const derived = slugFromUrl(source);
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
      url: source,
      ...rest,
    };
  }

  if (!isSlug(slug)) {
    throw httpError(400, "Expected { url } or { slug }");
  }
  return {
    slug,
    ...rest,
  };
}

/* ------------------------------------------------------------- uploads --
   docs/plans/pdf-upload-and-storage.md. Three small handlers, and between them
   they move no file bytes at all — which is the entire design. Everything this
   server handles is a few hundred bytes of JSON, so the 4.5 MB Vercel body
   limit never applies to anything on the critical path and `MAX_BODY_BYTES`
   above stays exactly as it is.
   ------------------------------------------------------------------------- */

/** What the browser claims about the file it is about to send. All three are checked. */
function parseUploadRequest(body: unknown): { filename: string; bytes: number; sha256: string } {
  const { filename, bytes, sha256 } = (body ?? {}) as Record<string, unknown>;
  if (typeof filename !== "string" || filename.trim() === "") {
    throw httpError(400, "An upload needs a filename");
  }
  /* A whole number of bytes, and a positive one. `Number.isSafeInteger` rather
     than `typeof === "number"` because `1e21`, `NaN` and `1.5` all pass that
     and none of them is a file size — and the cap comparison below would wave
     `NaN` straight through, since every comparison with it is false. */
  if (!Number.isSafeInteger(bytes) || (bytes as number) <= 0) {
    throw httpError(400, "An upload needs its size in bytes");
  }
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw httpError(400, "An upload needs a lower-case hex SHA-256 of its contents");
  }
  return { filename, bytes: bytes as number, sha256 };
}

/**
 * `POST /api/uploads` — a place to put a file, and permission to put it there.
 *
 * The checks here are **the cheap ones, and deliberately the same ones the file
 * picker already ran** (`uploadProblem`, src/uploads.ts, imported by both). A
 * browser refusing a file the server would have taken is a confusing bug; the
 * other way round is a reader watching 50 MB upload and then being told no.
 *
 * What it cannot check is what is actually in the file, because the file has
 * not been sent yet. That is the acquisition step's job, over the bytes, and
 * nothing here should ever be mistaken for it.
 */
async function mintAnUpload(body: unknown): Promise<{
  uploadId: string;
  url: string;
  expiresAt: string;
  slug: string;
}> {
  const grants = uploadGrants();
  /* 503 rather than 500: the request was fine and the server is not broken, it
     simply has not got the thing this needs. The sentence says which. */
  if (!grants) throw httpError(503, UPLOAD_UNAVAILABLE.message);
  /* **The other half of "not switched on here", and it is a harder one to
     admit.** Storage is configured and grants would mint perfectly; what will
     not work is the *next* request finding the record this one writes, because
     a serverless function's filesystem is neither durable nor shared. Refused
     here rather than discovered as a 404 three minutes into an 11 MB upload.
     See `recordsSurviveTheRequest`. */
  if (!recordsSurviveTheRequest()) throw httpError(503, UPLOAD_UNAVAILABLE.message);

  /* Resolved **after** the two guards above, not passed in by the dispatcher.
     `currentOwnerId()` throws on a production host with no owner configured, and
     as an argument it was evaluated before this function ran at all — so an
     installation that cannot take uploads answered 500 about an owner rather
     than 503 about uploads. Caught by the test that pins the 503. */
  const owner = currentOwnerId();
  const claim = parseUploadRequest(body);
  /* **`type: ""`, not `"application/pdf"`.** The browser's MIME guess does not
     cross the wire and we must not supply one on its behalf: writing the answer
     we want into the input makes `looksLikePdf` return true for `notes.txt`,
     because it accepts *either* the type or the name and the type was ours. The
     empty string is what `uploadProblem` documents as "no guess, and that is
     not a refusal", so the name is what decides here — which is all the server
     has to go on before the bytes arrive. Caught by the test below it. */
  const wrong = uploadProblem({ name: claim.filename, type: "", size: claim.bytes });
  if (wrong) throw httpError(413, wrong);

  const minted = await mintUpload({ ...claim, owner }, (key) => grants.sign(key), stagingKey);
  return {
    uploadId: minted.record.id,
    url: minted.url,
    expiresAt: minted.expiresAt,
    /* The slug this *will* get, if nothing else has taken it — a preview, for
       the same reason the add box previews one for a URL. `enqueue` decides for
       real, and may add a number; the job card shows what it decided. */
    slug: slugFromFilename(minted.record.filename) || "document",
  };
}

/** An upload record as a client may see it. Our hash is included; the claimed one is not. */
function publicUpload(record: UploadRecord): Record<string, unknown> {
  return {
    uploadId: record.id,
    filename: record.filename,
    status: record.status,
    ...(record.sha256 ? { sha256: record.sha256 } : {}),
    ...(record.bytes !== undefined ? { bytes: record.bytes } : {}),
    ...(record.reason ? { reason: record.reason } : {}),
    ...(record.slug ? { slug: record.slug } : {}),
  };
}

/**
 * `POST /api/jobs { uploadId }` — take ownership of an upload and queue it.
 *
 * The order is the whole of it: **claim, then enqueue.** Claiming is a
 * create-only file, so two tabs racing produce one winner and one `taken`; if
 * enqueueing then throws, the upload is stuck `claimed` and the reader chooses
 * the file again, which is cheap and correct. Enqueue-then-claim would be the
 * other way round — two jobs, two articles, two transcriptions paid for.
 *
 * A repeat of the *same* request is not a race, though, and must not read like
 * one. A double-clicked button, or a reload of `/add/upload/<id>`, arrives
 * after the claim has been taken by the first one — so `taken` looks for the
 * article that claim produced and hands back its job. Only a claim with nothing
 * to show for it is an error.
 */
async function queueAnUpload(uploadId: string): Promise<Job> {
  const owner = currentOwnerId();
  const record = await readUpload(uploadId, owner);
  if (!record) throw httpError(404, "No such upload");

  const claim = await claimUpload(uploadId, { owner });
  if (!claim.ok) {
    if (claim.why === "expired") throw httpError(410, UPLOAD_MISSING.message);
    /* `taken`. If the first claim got as far as a job, that job is the answer —
       this is the same request arriving twice, not a conflict. */
    const already = record.slug ? await jobForSlug(record.slug) : null;
    if (already) return already;
    throw httpError(409, "That upload is already being turned into an article.");
  }

  const candidate = slugFromFilename(claim.record.filename) || "document";
  const job = await enqueue({
    slug: candidate,
    upload: { id: uploadId, filename: claim.record.filename },
  });
  /* **Immediately, and this line is what makes the paragraph above true.** The
     record's slug used to be written only by the acquisition step, on success —
     so a reload of `/add/upload/<id>` while the job was still queued behind
     another one found a claimed upload with no slug, could not find its job,
     and answered 409. Every reload, for ever, if acquisition never began. The
     doc claimed the recovery worked while the field it recovers through was
     never set. GPT Sol, 2026-08-27. */
  await noteSlug(uploadId, job.slug);
  return job;
}

/** The job currently working on this article, if there is one. For the repeat-claim case above. */
async function jobForSlug(slug: string): Promise<Job | null> {
  const all = await listJobs();
  return all.find((j) => j.slug === slug) ?? null;
}

/**
 * Decorate an artefact response with "your profile changed since this".
 *
 * **In the route rather than in the store adapters**, and that placement is not
 * tidiness. Answering it needs the reader's current profile, which lives behind
 * `readerStore` in src/store/index.ts — and that module imports the filesystem
 * artefact reader, so a store adapter reaching back for it would be an import
 * cycle. The routes are already the layer that knows about both.
 *
 * It also keeps the adapters answering only questions about the article, which
 * is what they are for: `stale` and `outdated` are properties of the artefact
 * against the piece, and this one is a property of the artefact against the
 * person.
 */
async function withProfileChanged<R extends { profileChanged: boolean }>(
  slug: string,
  found: Omit<R, "profileChanged">,
  artefact: { profileHash?: string | null },
): Promise<R> {
  const now = await resolveProfile(slug);
  return {
    ...found,
    profileChanged: profileIsStale(artefact.profileHash, now ? hashProfile(now) : null),
  } as R;
}

/**
 * A job as the client may see it — **without the reader's profile**.
 *
 * The frozen profile has to live on the job: that is what makes it survive a
 * restart and what stops a summary run split across two profiles
 * (`Job.profile`, src/types.ts). But the job record is also what
 * `GET /api/jobs` returns on **every poll**, every eight seconds, for the life
 * of the panel — and it is the reader's own description of themselves. There is
 * nothing on the client that renders it and no question it answers there.
 *
 * So it is stripped on the way out. Not a leak in the sense of crossing a trust
 * boundary — it is the reader's own text going back to the reader's own browser
 * — but `docs/project/logging.md`'s rule about the reader's prose is the same
 * instinct, and a field nothing renders should not be on the wire at all.
 * GPT Sol's review of the built code, 2026-08-26.
 *
 * `guidance` deliberately stays: the summary panel puts it back in the box.
 */
function publicJob(job: Job): Omit<Job, "profile"> {
  const { profile: _hidden, ...rest } = job;
  return rest;
}

/**
 * Which model writes what — a read of the table in src/models.ts, nothing more.
 *
 * A route rather than an import, and that is the whole reason it exists. The
 * profile page wants to show this and **nothing under src/web/ may import a
 * server module** (tests/client-imports.test.ts): src/models.ts reads
 * `process.env`, so bundling it would ship configuration names to the browser
 * and put one more file on the allowlist's slippery slope. One tiny GET is
 * cheaper than that argument.
 *
 * Names, never keys. `TASK_TIER` and `STAGE_EFFORT` hold model ids and effort
 * levels, which are facts about how this server is configured and not secrets —
 * but note what is deliberately absent: no environment variable names, no
 * provider ordering, and nothing read from `process.env` at all. What a reader
 * gets is what the code says, not what the machine is set to.
 */
function modelsInUse(): {
  tasks: { task: string; model: string; effort?: string }[];
} {
  const tasks = (Object.keys(TASK_TIER) as (keyof typeof TASK_TIER)[]).map((task) => {
    /* The pipeline stages talk to the Anthropic SDK directly and so use
       `CAPABLE_MODEL`; only the three request-path tasks go through
       `modelFor`'s OpenRouter spelling. Showing the wrong one of those two
       would be a page that quietly lies about what ran — src/models.ts § the
       two spellings. */
    const requestPath = task === "explain" || task === "chat" || task === "search";
    const stage = task in STAGE_EFFORT ? STAGE_EFFORT[task as keyof typeof STAGE_EFFORT] : undefined;
    return {
      task,
      model: requestPath ? modelForOpenRouter(task) : CAPABLE_MODEL,
      ...(stage ? { effort: stage } : {}),
    };
  });
  return { tasks };
}

/**
 * Who is reading this article, as one string, resolved from the store.
 *
 * The two halves live apart — the global one on the reader, the per-article one
 * on the shelf — and this is the only place in the request path that joins
 * them. `renderProfile` returns `null` when both are empty, which is what every
 * caller downstream tests for.
 *
 * **Resolved here rather than inside the step that uses it**, and for a job the
 * result is then frozen onto the job. See `Job.profile` in src/types.ts: a
 * summary run is several batches at once, and a reader who edits their box
 * mid-run would otherwise get one artefact written from two profiles.
 *
 * Never reads the client's word for it. See `useProfile` above.
 */
async function resolveProfile(slug: string): Promise<string | null> {
  /* **The shelf read is allowed to fail, and the global half still counts.**
     Under `postgres` an article with no row throws not-found here, and under
     `files` a slug that is not an article is simply empty. Neither is a reason
     to answer a question about the *reader* with an error — and a caller that
     got one would fail a whole job over a purpose nobody had written.
     Found by GPT Sol's review of the built code, 2026-08-26. */
  const [profile, shelf] = await Promise.all([
    readerStore.readProfile(),
    shelfStore.read(slug).catch((): ShelfState => ({ opens: 0 })),
  ]);
  return renderProfile({ profile, purpose: shelf.purpose ?? null });
}

/**
 * The reader's global profile — "about you", the half that is true on every
 * article.
 *
 * Its own route rather than a field on the shelf, because it is not about an
 * article: `PATCH /api/library/:slug` needs a slug and this has none. The
 * per-article half lives there, as `purpose`, and the two are joined into one
 * prompt string by `renderProfile` in src/profile.ts — which is the only place
 * that knows there were two.
 *
 * `profile: null` clears it. Absent is a 400 rather than a no-op: this body has
 * exactly one field, so a request without it is a request that meant something
 * else, and answering 200 to it would report a save that did not happen.
 *
 * The **cap is enforced in the store, not here**, unlike `readGuidance` below.
 * That looks inconsistent and is not: guidance is validated at the boundary
 * because it goes straight into a prompt and never lands anywhere, while this
 * is stored, so the rule has to hold for every writer rather than for this one
 * route. src/profile.ts § saveReaderProfile throws with `status: 400`, which
 * `httpErrorFrom` below turns into the same answer this would have given.
 */
async function patchReader(body: unknown): Promise<{ profile: string | null }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw httpError(400, "Expected a JSON object");
  }
  const patch = body as Record<string, unknown>;
  if (!("profile" in patch)) throw httpError(400, "Nothing to change: expected profile");
  const profile = patch.profile;
  if (profile !== null && typeof profile !== "string") {
    throw httpError(400, "profile must be a string or null");
  }
  return { profile: await readerStore.writeProfile(profile) };
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
export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  /**
   * How to check a token. Injected only by tests; see the gate below and
   * src/auth.ts. Left alone it is the real thing.
   */
  verify?: Verifier,
): Promise<boolean> {
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
  /* No slug, and that is the whole shape of it: this one is about the reader
     rather than about an article. Matched on `path` like the rest, so a query
     string cannot smuggle a request past it. */
  const readerRoute = path === "/api/reader";
  // Static as far as a request is concerned — a read of two constants. No slug
  // and no store behind it.
  const modelsRoute = path === "/api/models";
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
  /* Read only, and no DELETE beside it — for the same reason the summary has
     none, plus one of its own: `ideas` replaces rather than appends, so
     re-running the step already *is* "start again". The glossary needs a delete
     precisely because running it again would add to the list it is trying to
     throw away. Asking for these is
     POST /api/jobs { slug, steps: ["ideas"] }. */
  const ideas = /^\/api\/ideas\/([\w.%-]+)$/.exec(url);
  const source = /^\/api\/source\/([\w.%-]+)$/.exec(url);
  const comments = /^\/api\/comments\/([\w.%-]+)$/.exec(url);
  const one = /^\/api\/comments\/([\w.%-]+)\/([\w.%-]+)$/.exec(url);
  const chat = /^\/api\/chat\/([\w.%-]+)$/.exec(url);
  const oneThread = /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)$/.exec(url);
  const chatStop = /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)\/stop$/.exec(url);
  const chatCancel = /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)\/cancel$/.exec(url);
  const searches = /^\/api\/search\/([\w.%-]+)$/.exec(url);
  const oneRun = /^\/api\/search\/([\w.%-]+)\/([\w.%-]+)$/.exec(url);
  const allJobs = url === "/api/jobs";
  const uploads = url === "/api/uploads";
  const upload = /^\/api\/uploads\/([\w-]+)$/.exec(url);
  const job = /^\/api\/jobs\/([\w.%-]+)$/.exec(url);
  const jobAction = /^\/api\/jobs\/([\w.%-]+)\/(cancel|retry)$/.exec(url);
  const jobAdvance = /^\/api\/jobs\/([\w.%-]+)\/advance$/.exec(url);

  /* Every response leaves by one of the ~14 `send` calls below, the catch, or
     the 404 at the end — so the log line lives in a single `finally` rather
     than at each of them. A branch added later cannot forget it, and there is
     no set of call sites to keep in step. It reads `res.statusCode`, which
     `send` has just set, so the exit points do not have to report anything. */
  let failure: unknown;
  try {
    /* **The gate, and it is inside the `try` — that is the whole of this
       comment's content.** An earlier plan put it just after the `/api/` prefix
       check, eighty-five lines above, on the theory that this `try` would turn
       its thrown `httpError` into the right status. It would not: a throw up
       there escapes to the outer handler, which answers 500 with the message in
       dev and a blank 500 on Vercel — and the `finally` below never runs, so
       **the refusal is never logged at all**. It still fails closed, which is
       the one mercy, but every word we have written about 401s and 403s would
       have been false. GPT Sol found it; confirmed by reading the line numbers.

       Before any body is read and before any route matches, so a malformed
       request from a stranger is a 401 rather than a 400. We owe an
       unauthenticated caller no diagnosis of their JSON.

       `verify` is a seam rather than a hard call because six test files drive
       this function with hand-built requests and none of them can mint a real
       ES256 token. The default is the real verifier, so forgetting to inject
       cannot make a production build permissive. src/auth.ts. */
    await requireUser(req, verify);

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
    if (modelsRoute && req.method === "GET") {
      send(res, 200, modelsInUse());
      return true;
    }
    if (readerRoute && req.method === "GET") {
      /* **`?slug=` answers a different question, and the panels need that one.**
         Without it this says only whether the *global* box is written, and a
         reader who has filled in "why you're reading this one" and nothing else
         has a profile as far as every prompt is concerned — `renderProfile`
         joins the two — while every control that offered to turn it off has
         disappeared. They could not opt out of something they could not see.

         So `profile` is the global text, which is what /profile edits, and
         `hasProfile` is the real answer to "is anything being taken into
         account here", resolved the same way the prompts resolve it. One
         request, right in every state, including the ones with no artefact to
         hang a flag on. GPT Sol's review, 2026-08-26. */
      const at = new URL(url, "http://x").searchParams.get("slug");
      const [profile, effective] = await Promise.all([
        readerStore.readProfile(),
        at && isSlug(at) ? resolveProfile(at) : readerStore.readProfile(),
      ]);
      send(res, 200, { profile, hasProfile: effective !== null });
      return true;
    }
    /* PATCH rather than PUT, for the same reason the shelf's is: the body names
       what changed. Here that is one field, so the two spellings would mean the
       same thing today — and PUT would start meaning "here is the whole reader
       record" the moment a second field arrives, which is exactly when a client
       that had not been updated would silently clear it. */
    if (readerRoute && req.method === "PATCH") {
      send(res, 200, await patchReader(await readBody(req)));
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
    if (source && req.method === "GET") {
      await sendSource(res, slugPart(source, 1));
      return true;
    }
    if (metadata && req.method === "GET") {
      send(res, 200, await articleMetadata(slugPart(metadata, 1)));
      return true;
    }
    if (tweets && req.method === "GET") {
      {
        const at = slugPart(tweets, 1);
        const found = await loadTweets(at);
        send(res, 200, await withProfileChanged<ThreadResponse>(at, found, found.thread));
      }
      return true;
    }
    if (glossary && req.method === "GET") {
      {
        const at = slugPart(glossary, 1);
        const found = await loadGlossary(at);
        send(res, 200, await withProfileChanged<GlossaryResponse>(at, found, found.glossary));
      }
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
      {
        const at = slugPart(summary, 1);
        const found = await loadSummaries(at);
        send(res, 200, await withProfileChanged<SummariesResponse>(at, found, found.summaries));
      }
      return true;
    }
    if (ideas && req.method === "GET") {
      {
        const at = slugPart(ideas, 1);
        const found = await loadIdeas(at);
        send(res, 200, await withProfileChanged<IdeasResponse>(at, found, found.ideas));
      }
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
      const threads = await sweepChat(slug);
      /* **`?summary=1` is the reading view's version of this list**, and it is a
         parameter rather than a route because it is the same question with the
         transcripts left off — same sweep, same order, same ids.

         The reading view needs one thing from chat: which conversations are
         anchored to which passage, so it can draw a mark and say something on
         hover. Handing it the transcripts as well is not merely wasteful. Chat
         state changes on every streamed token, so holding threads above
         `TableView` would re-render — and re-`annotateHtml` — every paragraph
         of the article, hundreds of times, while an answer arrives. Found by a
         GPT-5.6 review, 2026-08-26; docs/plans/chat-as-gateway.md § summaries. */
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.searchParams.get("summary") === "1") {
        send(res, 200, { threads: threads.map(summarise) });
        return true;
      }
      send(res, 200, { threads });
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
    if (chatCancel && req.method === "POST") {
      const [slug, id] = [slugPart(chatCancel, 1), part(chatCancel, 2)];
      send(res, 200, await cancelChat(slug, id, await readBody(req)));
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
      send(res, 200, { threads: await chatStore.rename(slug, id, title) });
      return true;
    }
    if (oneThread && req.method === "DELETE") {
      const [slug, id] = [slugPart(oneThread, 1), part(oneThread, 2)];
      /* Under the conversation's turn order, like the writes in `streamChat`.
         A retry or an edit checks that it will be accepted, then aborts the live
         answer, then writes — and a delete landing between the check and the
         write puts the abort-then-refuse bug back in a narrower window. There is
         no reason a delete needs to interleave with a turn, so it does not. */
      send(res, 200, {
        threads: await inTurnOrder(`${slug}/${id}`, () => chatStore.remove(slug, id)),
      });
      return true;
    }
    if (searches && req.method === "GET") {
      const slug = slugPart(searches, 1);
      send(res, 200, { runs: await sweepSearches(slug) });
      return true;
    }
    if (searches && req.method === "POST") {
      /* The third endpoint in this file that does not answer with JSON — see
         `answer`, which writes its own headers and ends the response. It is
         still reached through `send` for its *failures*: validation throws
         before a header is written, so a bad request is an ordinary 400. */
      await search(slugPart(searches, 1), await readBody(req), res);
      return true;
    }
    if (oneRun && req.method === "DELETE") {
      // The slug becomes a directory; the id is only ever matched against a list.
      const [slug, id] = [slugPart(oneRun, 1), part(oneRun, 2)];
      send(res, 200, { runs: await searchStore.remove(slug, id) });
      return true;
    }
    if (allJobs && req.method === "GET") {
      send(res, 200, { jobs: (await listJobs()).map(publicJob) });
      return true;
    }
    if (uploads && req.method === "POST") {
      // 201: a record now exists that did not before, and the body says where
      // to put the bytes. Nothing has been queued and nothing has been read.
      send(res, 201, await mintAnUpload(await readBody(req)));
      return true;
    }
    /* `GET /api/uploads/:id` — for a browser that lost its tab, and for the
       picker to confirm what landed. Read-only in the strict sense: an expired
       grant is *reported* as expired without the record being rewritten, so a
       poll cannot be a mutation. See `asOf`. */
    if (upload && req.method === "GET") {
      const found = await readUpload(part(upload, 1), currentOwnerId());
      if (!found) throw httpError(404, "No such upload");
      send(res, 200, publicUpload(asOf(found)));
      return true;
    }
    if (allJobs && req.method === "POST") {
      // 202, not 200: the work has been accepted and has not been done. The
      // body is the receipt to poll, which is the only thing there is to say
      // about a job that has not started.
      const request = parseJobRequest(await readBody(req));
      if (request.uploadId !== undefined) {
        /* No other field survives `checkUploadOrigin`, so there is nothing to
           forward: an upload is always the default ingest. */
        send(res, 202, publicJob(await queueAnUpload(request.uploadId)));
        return true;
      }
      /* **Not for the `{ url }` shape**, and that is a correctness fix rather
         than an economy. The slug this resolves against is the one *derived*
         from the URL, and `enqueue` may not use it: `freeSlug` renames on a
         collision. So resolving here would read the purpose of *another
         article* and stamp a new one's artefacts with it — and under `postgres`
         it would simply throw, because the article does not exist yet.

         Nothing is lost. A new ingest runs `DEFAULT_INGEST_STEPS`, which stops
         at `arc`, and no step in it takes a profile. The reader asks for a
         glossary or a summary later, by slug, and that request resolves
         correctly. GPT Sol's review of the built code, 2026-08-26.

         `=== false`, so absent means yes: a client that has never heard of this
         field gets the profiled run, which is the default the panel offers. */
      const profile =
        request.url !== undefined || request.useProfile === false
          ? null
          : await resolveProfile(request.slug);
      const { useProfile: _asked, ...work } = request;
      send(res, 202, publicJob(await enqueue({ ...work, ...(profile ? { profile } : {}) })));
      return true;
    }
    if (job && req.method === "GET") {
      const found = await getJob(part(job, 1));
      if (!found) throw httpError(404, "No such job");
      send(res, 200, publicJob(found));
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
      send(res, action === "cancel" ? 200 : 202, publicJob(result));
      return true;
    }
    /**
     * Run one step of this job, here, now, and answer when it is finished.
     *
     * Its own branch rather than a third name in `jobAction` above, because it
     * is the one job action that does not answer with a bare `Job`: the caller
     * is a loop, and a loop needs to be told whether to come back — see
     * `Advanced` in src/jobs.ts and docs/plans/job-queue-rethink.md.
     *
     * **A long request on purpose.** One step can be a minute of model calls,
     * and that is the design: the browser holds the request open so the work
     * happens inside an invocation somebody is waiting on, rather than in a
     * floating promise a serverless runtime is free to freeze. `vercel.json`
     * caps a function at 300 seconds, which is the real ceiling on a step.
     *
     * **200, not 409, when somebody else has it.** A second tab asking to
     * advance a job that is already advancing is a correct thing for a correct
     * client to do — it cannot know without asking — so it is an answer, not an
     * error. `readJson` in src/web/lib/api.ts throws on any non-2xx, so a 409
     * would turn the ordinary case into a message on the reader's screen.
     */
    if (jobAdvance && req.method === "POST") {
      const advanced = await advanceJob(part(jobAdvance, 1));
      if (!advanced) throw httpError(404, "No such job");
      send(res, 200, advanced);
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
