/**
 * Everything in chat that touches the network, and nothing that decides.
 *
 * The controller holds the state and says what should happen; this is where it
 * happens. The split is what lets `tests/chat-reduce.test.ts` and a controller
 * test run the whole machine with no `fetch` in it at all — the effects are an
 * argument, not an import (see `ChatEffects` in controller.ts).
 *
 * **Nothing here throws, and nothing here writes.** Every function maps every
 * way its request can end — a body that says `error`, a non-2xx, a dead
 * network, a stream that stops mid-word — onto one outcome or one call on a
 * sink, because to a reader they are the same thing and used to be handled in
 * three places. That is what lets the decision about whether an answer is still
 * wanted be taken once, at the gate in reduce.ts, instead of having a second
 * copy in a `catch`. The two guards this file's ancestor lost had both been
 * missing from exactly such a second copy.
 *
 * Lifted out of useChat.ts by docs/plans/chat-operation-model.md's stage 2. The
 * hook cannot keep them: the controller runs the turn now, the controller is
 * imported *by* the hook, and a module that imports the module importing it is
 * a cycle — `npm run cycles` would have caught it.
 */
import type { ChatMessage, ChatThread, ToolRun } from "../../types.js";
import { ENDED_UNFINISHED, NO_RESPONSE } from "../../messages.js";
import { apiFetch, failure, readJson } from "../lib/api.js";
import { readEvents, StreamStalled, STREAM_STALL_MS } from "../lib/sse.js";
import { describeFetchFailure } from "../useComments.js";
import type { Begun, ThreadsOutcome, TurnDone, WriteOutcome } from "./model.js";

/**
 * A clock on each individual look for a lost answer.
 *
 * `fetch` has no timeout of its own, so one hung request would stall the whole
 * watch — a recovery from a hang that can itself hang. Pointed out by a GPT-5.6
 * review, 2026-08-26.
 */
const POLL_TIMEOUT_MS = 10_000;

/**
 * How long to wait for the *response* to a send before giving up on it.
 *
 * Not a deadline on the answer — it is cleared the moment the headers arrive,
 * and the stream that follows may run for as long as it likes. It is a deadline
 * on the request never being answered at all, which was the last way left to
 * strand a row: the turn owns the row before the POST, so a `fetch` that hangs
 * before the headers leaves it `pending` with an owner for ever, and therefore
 * skipped by the recovery that exists to rescue exactly that. A spinner with no
 * clock and no owner. Found by a GPT-5.6 review, 2026-08-26.
 *
 * Three minutes because a retry or an edit legitimately waits on `settleThread`
 * in src/routes.ts, which finishes a superseded answer before starting the new
 * one — and that can take the server's whole turn deadline. A long wait is not
 * an infinite one.
 */
export const OPEN_TIMEOUT_MS = 180_000;

/**
 * The frames of one turn, told to a sink, and the five ways it can end.
 *
 * Knows nothing about ids, ownership, deadlines or what a lost stream means:
 * all of that is the reducer's, and the sink here is one dispatch per frame.
 * The accumulation that used to live in this function's local variables — the
 * words and the tool runs — is on the operation now, which is the same reason
 * it was local before: a row is state a later frame cannot read back in time.
 *
 * Hands back **whether the stream said how it ended**. A `done` or an `error`
 * frame is an ending; running out of bytes is not, and the caller has to be
 * able to tell those apart because only one of them is the recovery's business.
 */
async function drainTurn(body: ReadableStream<Uint8Array>, sink: TurnSink): Promise<boolean> {
  for await (const event of readEvents(body, { stallMs: STREAM_STALL_MS })) {
    if (event.name === "begin") {
      sink.began(event.data as Begun);
      continue;
    }
    if (event.name === "delta") {
      sink.delta((event.data as { text: string }).text);
      continue;
    }
    if (event.name === "tool") {
      const { index, run } = event.data as { index: number; run: ToolRun };
      sink.tool(index, run);
      continue;
    }
    if (event.name === "done") {
      sink.done(event.data as TurnDone);
      return true;
    }
    if (event.name === "error") {
      const failed = event.data as { error: string; text: string };
      sink.failed(failed.error, failed.text);
      return true;
    }
  }
  return false;
}

/** What one turn's stream can say. Every one of these becomes one event. */
export interface TurnSink {
  began(begun: Begun): void;
  delta(text: string): void;
  tool(index: number, run: ToolRun): void;
  done(done: TurnDone): void;
  /**
   * It is over and there is nothing to recover — the `error` frame, a request
   * that never opened, a refusal that is not a 409. `text` is the partial
   * answer where the server sent one back.
   */
  failed(error: string, text?: string): void;
  /** A 409: the server refused a turn this client had already performed. */
  refused(error: string): void;
  /**
   * The stream stopped without ending, or ended without saying how.
   *
   * Deliberately not a failure. The server does not stop working when a
   * reader's connection dies — see `stopChat` in src/routes.ts, where letting
   * an abandoned answer finish is a choice — so the answer is usually already
   * on disk, finished, and declaring a failure would make the reader pay twice
   * for something they have already bought. Whether it can be looked for at all
   * depends on whether the row has a server name yet, and that is a fact about
   * the operation, so the reducer decides it and this does not.
   */
  disconnected(error: string): void;
}

/**
 * Open the stream for one turn, and read it to whichever end it reaches.
 *
 * All three of `send`, `retry` and `edit` come through here, because from the
 * moment the POST leaves they are the same thing: a body, one row for the
 * arriving words, and five ways it can finish. What differs is only what the
 * caller drew first and what it put in `payload`.
 */
export async function runTurn(
  slug: string,
  threadId: string,
  payload: Record<string, unknown>,
  sink: TurnSink,
): Promise<void> {
  /* A deadline on the *response*, cleared the moment the headers arrive — see
     `OPEN_TIMEOUT_MS`. It must not outlive the `await` below, or it would abort
     the answer itself three minutes in. */
  const opening = new AbortController();
  const openBy = setTimeout(() => opening.abort(new Error(NO_RESPONSE.message)), OPEN_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await apiFetch(`/api/chat/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, ...payload }),
        signal: opening.signal,
      });
    } catch (e) {
      /* Asked of the controller rather than of the rejection. What a `fetch`
         rejects with when its signal fires is an `AbortError` whose text varies
         by engine, and reading a reader-facing sentence off it would be reading
         whichever one this browser happens to use. The controller is ours and
         it knows. */
      if (opening.signal.aborted) throw new Error(NO_RESPONSE.message);
      throw e;
    } finally {
      clearTimeout(openBy);
    }
    if (!response.ok || !response.body) {
      // A failure *before* the stream starts is ordinary JSON — a bad slug, a
      // question over the size cap. After it starts, failures arrive as an
      // `error` frame inside a 200, and `drainTurn` handles those.
      const why = (await failure(response)).message;
      /* **409 is the one status the screen cannot survive being wrong about.**
         It means the server refused a retry or an edit this client had already
         performed on screen — and an edit performs by *destroying*: the
         question is rewritten and every turn below it is gone. The refusal
         drops the operation, which is the whole of putting it back. */
      if (response.status === 409) {
        sink.refused(why);
        return;
      }
      throw new Error(why);
    }
    try {
      /* The stream ended without saying how — the server always sends `done` or
         `error` before it ends the response. Not a failure on its own: the row
         stays `pending` and the recovery adopts it, unless the row was never
         named, in which case there is nothing to adopt and the reducer says so. */
      if (!(await drainTurn(response.body, sink))) sink.disconnected(ENDED_UNFINISHED.message);
    } catch (streamErr) {
      /* Two ways to lose a stream, one response to both.

         `StreamStalled` is the one that had no answer at all before: the stream
         stopped *without* ending — no bytes, no close, no error — and only
         `readEvents`' own clock can see it, because it watches bytes rather than
         frames. An ordinary network `TypeError` mid-read is the same situation
         with a louder name. Both leave the server working, so both are the
         recovery's business rather than a failure to report. Adding the second
         one was a GPT-5.6 note, 2026-08-26. */
      if (streamErr instanceof StreamStalled || streamErr instanceof TypeError) {
        sink.disconnected(describeFetchFailure(streamErr as Error));
        return;
      }
      throw streamErr;
    }
  } catch (e) {
    sink.failed(describeFetchFailure(e as Error));
  }
}

/**
 * The server's copy of one answer, but only once it has stopped moving.
 *
 * `null` covers four different things on purpose — the request failed, it timed
 * out, the row is not there, or it is there and still `pending` — because the
 * caller does the same thing with all of them: wait a moment and ask again. The
 * one it must *not* do is adopt a `pending` row, which would put a spinner on
 * screen with no stream behind it and nothing left to end it. That is strictly
 * worse than the failure this whole path is trying to avoid, and it is why the
 * status is checked here rather than left to the caller to remember.
 */
export async function settledAnswer(
  slug: string,
  threadId: string,
  messageId: string,
): Promise<ChatMessage | null> {
  /* An `AbortController` and a `setTimeout` rather than `AbortSignal.timeout`,
     which would say the same thing in one line. The one line is not testable:
     `AbortSignal.timeout` runs on a timer the test runner's fake clock does not
     patch, so the only way to watch it fire is to wait ten real seconds. This
     way the hung-poll case is a test rather than a paragraph. */
  const giveUp = new AbortController();
  const timer = setTimeout(() => giveUp.abort(new Error("poll timed out")), POLL_TIMEOUT_MS);
  try {
    const body = await readJson<{ threads?: ChatThread[]; error?: string }>(
      await apiFetch(`/api/chat/${encodeURIComponent(slug)}`, { signal: giveUp.signal }),
    );
    const found = body.threads
      ?.find((t) => t.id === threadId)
      ?.messages.find((m) => m.id === messageId);
    return found && found.status !== "pending" ? found : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the server for this article's conversations.
 *
 * **It writes nothing, and it does not throw** — a body that says `error`, a
 * non-2xx and a dead network all come back as the same `{ ok: false }`, because
 * to a reader waiting for a list they are the same thing and used to be handled
 * in three places.
 */
export async function askForThreads(slug: string): Promise<ThreadsOutcome> {
  try {
    const body = await readJson<{ threads?: ChatThread[]; error?: string }>(
      await apiFetch(`/api/chat/${encodeURIComponent(slug)}`),
    );
    if (body.error) return { ok: false, error: body.error };
    return { ok: true, threads: body.threads ?? [] };
  } catch (e) {
    return { ok: false, error: describeFetchFailure(e as Error) };
  }
}

/**
 * A write whose only job is to stick — checked, not assumed.
 *
 * `fetch` resolves for a 404 or a 500; only a transport failure rejects. So a
 * bare `.catch()` on these calls reported success for every error the server
 * could return: the rename or the delete happened on screen, the server said
 * no, and the next reload put the old state back. This app has been bitten by
 * exactly that before — see the note on `forget` in useComments.ts, where a
 * DELETE that 500'd removed a comment from the screen and said nothing. Found
 * again here by a GPT-5.6 review, 2026-08-26.
 *
 * The reader-facing wording is put on the front of it in reduce.ts — the
 * reducer knows which operation this was, and the message has to name it.
 */
async function writeThread(
  slug: string,
  threadId: string,
  init: RequestInit,
): Promise<WriteOutcome> {
  try {
    const r = await apiFetch(
      `/api/chat/${encodeURIComponent(slug)}/${encodeURIComponent(threadId)}`,
      init,
    );
    if (!r.ok) throw await failure(r);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeFetchFailure(e as Error) };
  }
}

export function renameThread(slug: string, threadId: string, title: string): Promise<WriteOutcome> {
  return writeThread(slug, threadId, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export function deleteThread(slug: string, threadId: string): Promise<WriteOutcome> {
  return writeThread(slug, threadId, { method: "DELETE" });
}
