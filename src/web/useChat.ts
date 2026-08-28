/**
 * The client half of chat — see docs/plans/chat-mode.md.
 *
 * The sibling of useComments.ts, with one difference that shapes the whole
 * file: **the POST is a stream, not an answer.** A comment's POST returns the
 * finished comment and there is nothing to poll; here the response body arrives
 * a few words at a time and the reply is assembled on this side as it comes.
 *
 * Which means `fetch` and a `ReadableStream` reader rather than `EventSource`.
 * `EventSource` is the obvious tool for server-sent events and cannot be used:
 * it only issues GETs, and the question does not belong in a URL — it is
 * arbitrary length and it is the reader's private text, which would then be in
 * every access log between here and the server.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatAnchor,
  ChatMessage,
  ChatThread,
  Citation,
  ReviewStance,
  ThreadKind,
  ToolRun,
} from "../types.js";
import { mintId } from "../ids.js";
import { readEvents, StreamStalled, STREAM_STALL_MS } from "./lib/sse.js";
import { ENDED_UNFINISHED, NO_RESPONSE } from "../messages.js";
import { describeFetchFailure } from "./useComments.js";
import { apiFetch, failure, readJson } from "./lib/api.js";

export interface ChatApi {
  threads: ChatThread[];
  /**
   * Has the first fetch come back?
   *
   * The caller opens a new conversation when there are none, and "none" is
   * indistinguishable from "not asked yet" without this — so every visit to
   * chat mode would create a thread before the reader's real ones had arrived,
   * and then not create one when they legitimately had none.
   */
  loaded: boolean;
  /**
   * Did that first fetch fail?
   *
   * **`loaded` says we have asked, not that it worked, and the panel's empty
   * state needs the difference.** Without this the list falls straight from the
   * spinner into "Nothing asked yet." the moment the request gives up — the
   * same false claim the spinner was added to stop, one beat later. GPT Sol,
   * reviewing that first fix, 2026-08-27.
   *
   * Not `error !== null`. `error` carries any failure of any request in this
   * hook — a stop, a delete, an answer that would not start — and outlives the
   * one that caused it. This is about the one fetch that fills the list, and
   * only the effect below ever sets it.
   */
  loadFailed: boolean;
  /**
   * Answers whose stream this client has lost, and is now asking the server
   * about. See `watch` — the row is still `pending`, but nothing is arriving
   * and the panel should say so rather than go on claiming to be thinking.
   */
  recovering: Set<string>;
  /* No `streaming` flag here, and its absence is deliberate.
     One was exported and nothing used it — the composer takes its `busy` state
     from the *message* it is waiting on, which is the honest source: sends can
     overlap across threads, and a single boolean would have been set false by
     whichever finished first while another was still arriving. A wrong answer
     nobody was asking for. Removed after a GPT-5.6 review, 2026-08-26. */
  /**
   * Send a question. Returns the thread id it went to — minted here when the
   * reader is starting a new conversation, so `?thread=` can point at something
   * from the first frame rather than after the round trip.
   */
  send(
    threadId: string | null,
    question: string,
    at: string | null,
    /**
     * Whether this answer should be written for the reader's profile.
     *
     * Per turn, not per thread, and composer-only: a chat answer is not an
     * artefact anybody rewrites, so there is nothing to store a preference
     * against and nothing to flip back to. A reader may reasonably want one
     * plain answer in the middle of a conversation that is otherwise theirs.
     * Absent means yes. docs/project/reader-profile.md.
     */
    useProfile?: boolean,
    /**
     * Called if the server gave the thread a different id than the one sent.
     * See the `begin` frame below — it lets the caller correct `?thread=`
     * rather than leaving the URL pointing at a conversation that is not there.
     */
    onThreadId?: (id: string) => void,
    /**
     * The passage this conversation is about — **only on the send that creates
     * the thread**. The server 409s an anchor for a thread that already has a
     * different one, rather than quietly ignoring it.
     */
    anchor?: ChatAnchor,
    /**
     * Chat or review — **only on the send that creates the thread**, and the
     * server 409s one that contradicts a thread that already exists.
     *
     * Deliberately absent from `retry` and `edit` below: their thread already
     * has a kind, and a field a stale tab could send wrongly is a field worth
     * not having. The server refuses one sent with either.
     */
    kind?: ThreadKind,
    /**
     * How much this answer should say — review turns only, and the reader's
     * current picker.
     *
     * Also absent from `retry` and `edit`, and that one is not symmetry: a
     * retry re-asks a **stored** question, so it must be asked the way it was
     * asked. `withRetry` on the server carries the stance over from the answer
     * it is replacing; `withEdit` takes it from the answer being replaced. If
     * this rode along instead, moving the picker and then pressing retry would
     * silently rewrite the instruction attached to a stored turn.
     */
    stance?: ReviewStance,
    /**
     * The comment this conversation is being started from — **only on the send
     * that creates the thread**, and passed straight through to the server.
     *
     * The link is written *there*, once the real thread id exists, because the
     * id this function returns is minted optimistically and the client only
     * hears about an overrule when there is one. See
     * docs/plans/comments-and-bookmarks.md § the Save & ask choreography.
     */
    sourceCommentId?: string,
  ): string;
  /**
   * Answer the same question again, replacing the answer in place.
   *
   * Only the last answer in a thread — the server refuses anything else with a
   * 409, and the panel only offers the button there. See `retryTurn` in
   * src/chat.ts for why a conversation with a rewritten middle is worse than
   * one you cannot rewrite.
   */
  retry(threadId: string, messageId: string): void;
  /**
   * Rewrite one of the reader's questions and ask it again.
   *
   * **Discards every turn after it.** `discardedAfter` below is how the panel
   * says so before the reader commits.
   */
  edit(threadId: string, messageId: string, question: string, at: string | null): void;
  /**
   * Stop an answer that is still arriving. What has already appeared is kept.
   *
   * Needs the *server's* id for the message, which arrives in the `begin`
   * frame — so a stop pressed in the moment before that is remembered and sent
   * as soon as there is an id to send it with, rather than posting an id the
   * server has never heard of and quietly doing nothing.
   */
  stop(threadId: string, messageId: string): void;
  /**
   * Stop the first answer of a conversation and throw the conversation away.
   *
   * For the reader who selected a sentence, saw an answer start, and changed
   * their mind — Greg's call, 2026-08-26. Not the same button as `stop`, and
   * deliberately not the same word in the panel either: `✕ Cancel` against
   * `⏹ Stop`, because one destroys and one does not.
   *
   * One request. Stopping and then deleting is a race that eats a question
   * arriving in the gap — see `cancelChat` in src/routes.ts.
   */
  cancelAndDiscard(threadId: string, messageId: string): void;
  /** Start an empty conversation locally. Nothing is stored until you send. */
  begin(kind?: ThreadKind): string;
  /**
   * Forget an empty conversation. Local only, and a no-op on anything that has
   * a message in it — see `withoutEmpty`.
   */
  discard(threadId: string): void;
  rename(threadId: string, title: string): void;
  remove(threadId: string): void;
  /** A failure of the *transport*. Model failures live on the message. */
  error: string | null;
}

/**
 * What the `begin` frame carries: the ids the server actually minted.
 *
 * The client guesses all of them — a thread id so `?thread=` can be in the URL
 * before anything is sent, and two message ids so the reader's words and the
 * empty answer beneath them can be on screen the instant Enter is pressed. Then
 * the server writes the turn to disk under ids of its own, and every guess that
 * is still on screen is a name for a row that does not exist anywhere else.
 */
export interface Begun {
  threadId: string;
  title: string;
  /** The assistant row the answer streams into. */
  messageId: string;
  /** The question above it. Absent from older servers; see `withServerIds`. */
  questionId?: string;
  /**
   * Which attempt at that row this is.
   *
   * A retry writes into the same row, so the id alone does not say *which*
   * answer a stop was pressed on. Sent back with the stop so the server can
   * refuse one aimed at an answer that has already finished — see `Live.attempt`
   * in src/routes.ts.
   */
  attempt?: string;
}

/**
 * Replace this turn's provisional ids with the server's.
 *
 * Pure, and exported, for the reason `withRetry` and `withEdit` are in
 * src/chat.ts: it is a rule about ids that nothing renders, so a mistake in it
 * is invisible until something else needs one of those ids for real. That is
 * exactly how the question id came to be missed — the assistant row was swapped
 * from the first version and the user row was not, nothing on screen changed,
 * and it surfaced weeks later as "That message is not in this conversation."
 * the first time a reader edited a question without reloading first.
 *
 * The question is found by position rather than by id, because its id is the
 * one thing here that is not trustworthy: it is the row immediately above the
 * pending answer, which is what a turn *is*.
 */
export function withServerIds(
  threads: ChatThread[],
  current: string,
  pendingId: string,
  begun: Begun,
): ChatThread[] {
  return threads.map((t) =>
    t.id !== current
      ? t
      : {
          ...t,
          id: begun.threadId,
          // The title is cut on a word boundary on the server; the optimistic
          // one is a blunt 60-character slice that would otherwise stay on
          // screen until the next reload. Only the first turn names a thread,
          // so only the first turn takes it.
          title: t.messages.length <= 2 ? begun.title : t.title,
          messages: t.messages.map((m, i) => {
            if (m.id === pendingId) return { ...m, id: begun.messageId };
            if (begun.questionId && m.role === "user" && t.messages[i + 1]?.id === pendingId) {
              return { ...m, id: begun.questionId };
            }
            return m;
          }),
        },
  );
}

/**
 * Drop a conversation that never had anything said in it.
 *
 * The guard is the whole function, and it leans on an invariant that has to
 * hold on the other side of the wire: **an empty thread exists only in the tab
 * that started it.** Given that, dropping it costs nothing and touches no
 * server. A thread with a message in it is on disk, and removing it here would
 * take it off the screen while leaving it in the file — a deletion that did not
 * delete, undone by the next reload. That is why the id alone is not enough to
 * authorise this, and why `remove` (which does talk to the server) stays a
 * separate call.
 *
 * The invariant is not free: src/chat.ts had an unused `createThread` that
 * wrote an empty thread straight to disk, and one caller of it would have made
 * this function exactly the deletion-that-does-not-delete above. It was deleted
 * rather than left lying there, and the note in its place says why. Found by a
 * GPT-5.6 review, 2026-08-26.
 */
export function withoutEmpty(threads: ChatThread[], id: string): ChatThread[] {
  return threads.filter((t) => !(t.id === id && t.messages.length === 0));
}

/**
 * The list the server has just handed us, on top of what this tab already
 * knows — used only for the load on arrival.
 *
 * The arriving list used to be written straight over `threads`, on the
 * reasoning that there is nothing on screen when a panel has only just mounted.
 * That is true for exactly as long as the fetch takes, and no longer: on a slow
 * connection the reader can press `+`, type a question, send it and watch the
 * answer arrive, all before the response to a request made at mount lands.
 * Every one of those is in the list the snapshot then replaced, and the send is
 * the one that costs — its rows go, and each later frame of the answer patches
 * a row that is not there, so the answer arrives nowhere and the reader is
 * looking at a list with no sign they ever asked. Greg hit the visible half of
 * this on a slow connection, 2026-08-27; GPT Sol found this half while
 * reviewing the composer under the list, which made it easy to reach.
 *
 * So the server's list is **added to** what is on screen and never applied over
 * it. Two rules:
 *
 * - **A row already on screen wins.** Not "unless the server's is newer",
 *   because ours is newer by construction: the mount effect empties the list
 *   before it fetches, so everything in `prev` was put there afterwards, by
 *   this tab, from a send this tab is watching. The server's copy of the same
 *   conversation is at best equal and at worst the half-written one it had when
 *   it answered — the question stored, the answer still streaming — and a
 *   response that crawls back over a slow connection can be that stale even
 *   after the send it is behind has finished. Preferring ours needs no timing
 *   argument at all, which is what makes it right; a narrower rule that only
 *   protected conversations with a send **still running** left exactly that
 *   window open.
 * - **Deletions win**, which `put` has always said and the arriving list did
 *   not. A conversation the reader deleted while the fetch was out is still in
 *   the snapshot, because the send that created it told the server; putting it
 *   back reads as the delete button not working.
 *
 * Both rules are the arrival load's alone. Neither is safe for `refresh(only)`,
 * where the screen is the thing known to be wrong and a thread the server does
 * not have is one somebody else deleted — which is why that branch takes the
 * server's copy, and deletes on its absence.
 *
 * `deleted` is passed in rather than read from `gone` here, so this stays a
 * pure function of its arguments: it runs inside a `setThreads` updater, which
 * React invokes twice under `StrictMode`, and this file has been bitten by an
 * impure updater before.
 */
export function mergedArrival(
  prev: ChatThread[],
  fresh: ChatThread[],
  deleted: ReadonlySet<string>,
): ChatThread[] {
  const ours = new Set(prev.map((t) => t.id));
  /* Appended rather than merged into place, because nothing downstream reads
     this order: ThreadList sorts by `updatedAt`, and the panel finds the open
     conversation by id. */
  return [...prev, ...fresh.filter((t) => !ours.has(t.id) && !deleted.has(t.id))];
}

/**
 * A lost stream goes back and looks for its answer before it gives up.
 *
 * The server does not stop working when a reader's connection dies — see the
 * note on `stopChat` in src/routes.ts, where letting an abandoned answer finish
 * is a deliberate choice — so by the time the client has noticed the silence,
 * the answer it was watching is usually already on disk, complete. Declaring a
 * failure and offering a retry would make the reader pay twice for something
 * they have already bought.
 *
 * So: ask again every `RECOVER_GAP_MS`, until the server's own turn deadline
 * has passed with room to spare, and only then call it a failure.
 */
const RECOVER_GAP_MS = 3_000;

/**
 * The server's deadline for one turn, which is `CHAT_TIMEOUT_MS` in
 * src/converse.ts.
 *
 * **Copied rather than imported**, and not by preference: importing it would
 * pull src/converse.ts — and with it the OpenRouter client, the tool
 * definitions and jsdom — into the browser bundle, which is what
 * tests/client-imports.test.ts exists to prevent. A copied constant that drifts
 * is exactly the silent failure this repo keeps writing up
 * (docs/reusable/silent-success.md): watching would stop while the server was
 * still legitimately writing, and the reader would be told their answer failed
 * moments before it landed. tests/use-chat-recovery.test.ts imports both and
 * asserts they are equal, which a test may do and the client may not.
 */
export const SERVER_TURN_MS = 120_000;

/**
 * How much longer than the server's own deadline a watch keeps looking.
 *
 * It has to cover **two** server numbers, not one: the turn deadline above, and
 * `CHAT_ORPHAN_GRACE_MS` — 150 seconds, after which a sweep turns an abandoned
 * `pending` row into a failure the watch can then adopt. Stopping first would
 * mean declaring a failure over a row the server was seconds from settling, and
 * the reader would see the answer only on their next reload. A test asserts the
 * sum clears the grace period, because the two numbers live in different files
 * and drifting apart is invisible from either side. Found by a GPT-5.6 review,
 * 2026-08-26.
 */
export const RECOVER_MARGIN_MS = 40_000;

/**
 * A clock on each individual look.
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
 * strand a row: `run` claims the row before the POST, so a `fetch` that hangs
 * before the headers leaves it `pending`, owned for ever, and therefore skipped
 * by the watcher that exists to rescue exactly that. A spinner with no clock
 * and no owner. Found by a GPT-5.6 review, 2026-08-26.
 *
 * Three minutes because a retry or an edit legitimately waits on `settleThread`
 * in src/routes.ts, which finishes a superseded answer before starting the new
 * one — and that can take the server's whole turn deadline. A long wait is not
 * an infinite one.
 */
export const OPEN_TIMEOUT_MS = 180_000;

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
async function settledAnswer(
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

/* Outside the component on purpose: as functions defined in the hook body they
   were new objects on every render, and the only honest thing to do with that
   is list them as dependencies of `run` — which would then be new on every
   render too, and so would `send`, `retry` and `edit` under it. A `useCallback`
   with an empty list would work and would be one more thing to be right about. */
function claim(owned: Map<string, number>, id: string): void {
  owned.set(id, (owned.get(id) ?? 0) + 1);
}

function release(owned: Map<string, number>, id: string): void {
  const left = (owned.get(id) ?? 1) - 1;
  if (left > 0) owned.set(id, left);
  else owned.delete(id);
}

interface TurnSink {
  /** Rewrite the assistant row this turn is writing into. */
  patch(patch: Partial<ChatMessage>): void;
  /** The server has named the thread and the row. */
  begin(begun: Begun): void;
}

/**
 * The frames of one turn, and the four kinds of them.
 *
 * Lifted out of `run` because the two are different jobs that happened to be
 * written in one place: this one turns frames into patches and knows nothing
 * about ids, ownership, deadlines or what a lost stream means, all of which is
 * `run`'s business. A five-branch loop nested inside a `try` inside an async
 * IIFE inside a callback also made `run` far and away the most complicated
 * function in the file, and the two accumulators the loop needs — `text` and
 * `tools` — sat in `run`'s scope where nothing else could reach them anyway.
 *
 * `begin` is handed back rather than handled here for the opposite reason: it
 * is *entirely* about ids, and every line of it reassigns something `run`
 * owns. `sink.begin` is also what records that the row has been named — a flag
 * in `run` rather than a return value from here, because the stream can throw
 * after that frame and the answer to "was it ever named?" has to survive the
 * throw.
 */
async function drainTurn(body: ReadableStream<Uint8Array>, sink: TurnSink): Promise<void> {
  /* Accumulated here rather than read back off the row, because the row is
     React state: a patch is not visible to the next frame's read, and two
     deltas arriving in one tick would each append to the same stale text. */
  let text = "";
  /** What the tools have done so far, kept here for the same reason `text` is. */
  let tools: ToolRun[] = [];
  for await (const event of readEvents(body, { stallMs: STREAM_STALL_MS })) {
    if (event.name === "begin") {
      sink.begin(event.data as Begun);
      continue;
    }
    if (event.name === "delta") {
      text += (event.data as { text: string }).text;
      sink.patch({ text });
      continue;
    }
    /* A tool starting, or the same tool finishing. **Assigned by index
       rather than appended**, which is what makes the row that says
       "searching your library…" become the row that says what it found,
       in place, rather than a second row underneath it.

       `tools.slice()` because the array on the row is the one React has
       already rendered; mutating it and handing back the same reference
       is the classic way to make a list that updates on the next
       unrelated render and not before. */
    if (event.name === "tool") {
      const { index, run } = event.data as { index: number; run: ToolRun };
      tools = tools.slice();
      tools[index] = run;
      sink.patch({ tools });
      continue;
    }
    if (event.name === "done") {
      const done = event.data as {
        text: string;
        citations: Citation[];
        searches: number;
        tools?: ToolRun[];
        truncated?: boolean;
        model: string;
        stopped?: boolean;
      };
      /* `stopped: false` explicitly, not left off. This row may be a
         retry of one that *was* stopped, and a patch that omits the
         field leaves the old `true` sitting under new text — a complete
         answer wearing "Stopped" underneath it. */
      /* `stopped` and `tools` are both defaulted *before* the spread,
         for one reason: the server omits each of them when there is
         nothing to say, so a spread alone cannot clear a stale one. A
         retry of an answer that ran three tools would otherwise keep
         that answer's tool strip sitting above text those tools had
         nothing to do with. */
      sink.patch({ stopped: false, truncated: false, tools: [], ...done, status: "done" });
      continue;
    }
    if (event.name === "error") {
      const failed = event.data as { error: string; text: string };
      // The partial answer is kept — the reader watched it appear, and
      // taking it away on failure is more confusing than leaving it
      // there with the failure attached. The server stores it too.
      sink.patch({ text: failed.text || text, status: "error", error: failed.error });
    }
  }
}

export function useChat(slug: string): ChatApi {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * What is on screen right now, readable from an event handler.
   *
   * One thing needs it: an edit has to tell the server which message this tab
   * believes is last, so the server can refuse an edit whose discard set has
   * changed underneath it. Without that guard a stale tab editing an old
   * question silently deletes every turn added since it last looked, and
   * nothing notices — see `expectedTailId` in src/store/contracts.ts.
   *
   * A ref written from an effect rather than a value closed over by `edit`,
   * because `edit` deliberately has an empty-ish dependency list and closing
   * over `threads` would make it a new function on every delta of every
   * streaming answer. The effect runs at commit, and a click happens after a
   * commit, so what this holds is exactly what the reader was looking at.
   */
  const onScreen = useRef<ChatThread[]>([]);
  useEffect(() => {
    onScreen.current = threads;
  }, [threads]);

  /**
   * Threads the reader deleted while an answer was still arriving.
   *
   * The same tombstone useComments.ts keeps, and needed for a longer window: an
   * answer streams for tens of seconds and the reader can delete the thread it
   * is landing in at any point during that. Without this, the next frame of the
   * stream puts the thread back — and it comes back one message shorter than it
   * was, which looks like corruption rather than a race.
   *
   * A ref, not state: nothing renders from it, and a stale closure would defeat
   * the point of it.
   */
  const gone = useRef(new Set<string>());

  /**
   * The current `threads`, readable outside a render.
   *
   * Only `cancelAndDiscard` needs it, and it needs it for one reason: to keep a
   * copy of the conversation it is optimistically removing, so a 409 can put it
   * back. Reading that from inside a `setThreads` updater would be the obvious
   * alternative and is forbidden — an updater must be pure, React StrictMode
   * invokes it twice, and this file has already been bitten by exactly that.
   */
  const latest = useRef<ChatThread[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — switching article is exactly when the tombstones stop meaning anything, and the effect deliberately reads nothing
  useEffect(() => {
    const forgotten = gone.current;
    return () => forgotten.clear();
  }, [slug]);

  /**
   * Which article's conversations these are.
   *
   * Read by `refresh` after its `await`, so a load that comes back for the
   * article the reader has just left cannot write its threads over the new
   * one's. The effect below sets it synchronously, before anything is fetched.
   */
  const showing = useRef(slug);

  /**
   * How many streams are writing into each conversation right now.
   *
   * Only `refresh` reads it, and only to answer one question: is anything on
   * screen for this conversation newer than what the server is about to say?
   * See the note there.
   */
  const running = useRef(new Map<string, number>());

  /**
   * Which load on arrival is the current one.
   *
   * Bumped by every `refresh()` that asks for the whole list, and read again
   * after the await: a response whose number is no longer the latest belongs to
   * a load something has already superseded, and it may not write.
   *
   * `showing.current` does not cover this, and the difference is the same one
   * `loadFailed` was bitten by — see the note in the mount effect. That ref
   * distinguishes **articles**; this distinguishes **loads of one article**, of
   * which `StrictMode` deliberately starts two.
   *
   * **Two loads of one article is a development-only state**, and worth saying
   * so rather than leaving the guard looking broader than it is: `Reader` is
   * keyed on the slug in App.tsx, so changing article remounts this hook rather
   * than re-running its effect, and nothing else starts a second arrival load.
   * `StrictMode` is the case, and a dev-only wrong state is still worth two
   * lines — the `loadFailed` bug this is modelled on was exactly that, and it
   * cost a day of believing a panel that said it could not load a list it was
   * displaying.
   *
   * Merging is only half a defence, which is why the number is here at all: a
   * stale snapshot answering *after* the current one finds the fuller list
   * already on screen and loses to it, but one answering *first* puts its
   * shorter copy on an empty screen, and then it is the current response that
   * loses. Found by GPT Sol reviewing the composer under the list, 2026-08-27.
   */
  const load = useRef(0);

  /**
   * Ask the server what this article's conversations actually are.
   *
   * Two callers, and they want different amounts of it. On arrival the answer
   * is merged over what is already there rather than written across it — see
   * `mergedArrival`, which says what the fetch's own duration lets the reader do
   * in the meantime. After a 409 the screen is not merely out of date, it is
   * *wrong* — it is showing an edit that did not happen, with the turns it would
   * have discarded already gone — but only for **one conversation**, and that is
   * all that gets replaced.
   *
   * That narrowing is not tidiness. Replacing the whole list put a snapshot
   * taken before an unrelated send over the top of that send's optimistic rows,
   * and every later frame of it then patched a row that was not there any more:
   * an answer that arrives nowhere, or a spinner that never clears. A 409 in one
   * conversation has nothing to say about another. Found by a GPT-5.6 review,
   * 2026-08-26.
   *
   * The same argument applies *within* one conversation, so a thread another
   * stream is still writing into is left alone too — there is nothing the server
   * can tell us about it that is not already older than the screen.
   */
  /**
   * Returns whether the list came back. The mount effect below is the only
   * caller that cares — a per-thread refresh failing later says nothing about
   * whether the list itself ever arrived. See `loadFailed`.
   */
  const refresh = useCallback(
    async (only?: string): Promise<boolean> => {
      const mine = slug;
      /* Claimed before anything is awaited, so two loads of one article are
         ordered by when they were *asked*, not by when they answered. */
      const generation = only === undefined ? (load.current += 1) : load.current;
      try {
        const body = await readJson<{ threads?: ChatThread[]; error?: string }>(
          await apiFetch(`/api/chat/${encodeURIComponent(mine)}`),
        );
        if (showing.current !== mine) return false;
        if (only === undefined && generation !== load.current) return false;
        if (body.error) {
          setError(body.error);
          return false;
        }
        const fresh = body.threads ?? [];
        if (only === undefined) {
          /* Read here, outside the updater, so what it is handed is a value
             rather than a ref — see `mergedArrival`. */
          const deleted = new Set(gone.current);
          setThreads((prev) => mergedArrival(prev, fresh, deleted));
          return true;
        }
        // More than one means somebody else is still writing here — this run is
        // counted too, and it is the one that failed.
        if ((running.current.get(only) ?? 0) > 1) return true;
        const server = fresh.find((t) => t.id === only);
        setThreads((prev) =>
          server
            ? prev.map((t) => (t.id === only ? server : t))
            : // The server does not have it at all: it was deleted, or it was
              // never written down. Either way it is not a conversation.
              prev.filter((t) => t.id !== only),
        );
        return true;
      } catch (e) {
        /* The same two guards the success path uses, and the second one for the
           same reason `loadFailed` needed it: a superseded load failing after
           the current one succeeded put a failure message over a list that was
           on the screen and correct. Guarding only the writes and not the
           errors would have left exactly that bug in a quieter form. GPT Sol,
           2026-08-28. */
        if (showing.current !== mine) return false;
        if (only === undefined && generation !== load.current) return false;
        setError(describeFetchFailure(e as Error));
        return false;
      }
    },
    [slug],
  );

  useEffect(() => {
    showing.current = slug;
    setThreads([]);
    setLoaded(false);
    setLoadFailed(false);
    // `loaded` even when the fetch failed. It means "we have asked", not "it
    // worked" — a reader whose server is down should still be able to open a
    // conversation and see the send fail with a reason, rather than face a
    // panel that never resolves into anything. What it *may not* do is let the
    // panel then say the reader has asked nothing, which is what `loadFailed`
    // is for.
    /**
     * **`live`, not `showing.current`, and the difference is a real bug.**
     *
     * `showing.current` distinguishes *slugs*, and what has to be
     * distinguished here is *runs of this effect*. Under `StrictMode` React
     * mounts, unmounts and mounts again, so two fetches for the same article
     * are in flight at once — and the first one failing after the second one
     * succeeded set `loadFailed` back to true, leaving the panel saying it
     * could not load a list it was displaying. Same slug, so the ref guard let
     * it straight through. GPT Sol found it on the second pass, 2026-08-27.
     *
     * A `let` closed over by the cleanup below is the same shape useComments.ts
     * and useSearch.ts already use, and it is per-run by construction.
     */
    let live = true;
    void refresh()
      // `refresh` catches its own failures, so this only guards against it
      // being changed later into something that does not — `loaded` must flip
      // on every path or the panel waits for ever.
      .catch(() => false)
      .then((ok) => {
        if (!live || showing.current !== slug) return;
        setLoadFailed(!ok);
        setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [slug, refresh]);

  /** Rewrite one thread in place, or append it if it is new. Deletions win. */
  const put = useCallback((id: string, edit: (t: ChatThread) => ChatThread) => {
    setThreads((prev) => {
      if (gone.current.has(id)) return prev;
      const found = prev.find((t) => t.id === id);
      if (!found) return prev;
      return prev.map((t) => (t.id === id ? edit(t) : t));
    });
  }, []);

  /**
   * A new, empty conversation — local only.
   *
   * Nothing is written to disk until the reader actually sends something, so
   * pressing "New chat" and changing your mind leaves no empty thread behind to
   * clean up. The server's `beginTurn` accepts this id when the first message
   * arrives, which is what makes the optimistic id safe.
   */
  const begin = useCallback((kind: ThreadKind = "chat") => {
    const id = mintId();
    const at = new Date().toISOString();
    setThreads((prev) => [
      ...prev,
      {
        id,
        /* A review's placeholder title says what it is, because the list is
           shared: "New chat" sitting in a list the reader reached by pressing
           Review is a small lie, and it is the row they are about to type
           into. The real title arrives with the first thing they say. */
        title: kind === "review" ? "New review" : "New chat",
        createdAt: at,
        updatedAt: at,
        /* An empty thread exists only in this tab, so this kind is a promise
           rather than a record — the send that follows is what tells the
           server, and the server's answer is what makes it true. But the panel
           filters and tags on it in the meantime, so it has to be right now. */
        kind,
        messages: [],
      },
    ]);
    return id;
  }, []);

  /**
   * Forget an empty conversation the reader changed their mind about.
   *
   * No tombstone in `gone`, unlike `remove`: nothing is in flight for a thread
   * with no messages — a send inserts its two rows before the request leaves —
   * so there is no late frame that could put this one back.
   */
  const discard = useCallback((threadId: string) => {
    setThreads((prev) => withoutEmpty(prev, threadId));
  }, []);

  /**
   * Ids of assistant rows the reader pressed stop on before the server had
   * named them.
   *
   * The `begin` frame is what tells the client the real message id, and it is
   * the only id `/stop` will accept. It arrives fast — it is written before the
   * model is called — but "fast" is not "first", and a stop that lands in that
   * window used to post a provisional id, get `{stopped: false}`, and stop
   * nothing while the button reported that it had. So the wish is written down
   * here and honoured the moment there is an id for it.
   */
  const stopWanted = useRef(new Set<string>());

  /**
   * The same wish, for the button that throws the whole conversation away.
   *
   * A separate set from `stopWanted` rather than a flag on it, because the two
   * do different things to the same row and running both would stop an answer
   * and then delete the thread it was in — which is the stop-then-delete race
   * a GPT-5.6 review took apart. One of them fires, ever.
   */
  const cancelWanted = useRef(new Set<string>());

  /**
   * Which attempt each assistant row is currently on, from its `begin` frame.
   *
   * A retry reuses the row, so the id names a place rather than an answer. Sent
   * with the stop so the server can tell "stop the answer I am watching" from
   * "stop whatever happens to be there when this arrives" — see `Live.attempt`
   * in src/routes.ts. Missing means the server did not say, and the stop then
   * behaves as it always did.
   */
  const attempts = useRef(new Map<string, string>());

  /* Cleared when the article changes, like the tombstones above. The tokens
     name streams in *this* server for *these* conversations; carrying them into
     another article's threads is at best dead weight and at worst a stop that
     names something real by accident. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect reads a ref, and changing article is when the tokens in it stop meaning anything
  useEffect(() => {
    const stale = attempts.current;
    return () => stale.clear();
  }, [slug]);

  /**
   * Ask the server to stop one answer.
   *
   * The reply is `{ stopped }`, and `false` is not a failure — it means the
   * answer had already finished, or another tab got there first. Only a
   * transport failure or a non-2xx is worth telling the reader about, and it is
   * told rather than swallowed: a stop button that silently does nothing is the
   * exact shape docs/reusable/silent-success.md is about.
   */
  const askToStop = useCallback(
    async (threadId: string, messageId: string) => {
      try {
        const r = await apiFetch(`/api/chat/${encodeURIComponent(slug)}/${encodeURIComponent(threadId)}/stop`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageId, attempt: attempts.current.get(messageId) }),
          },
        );
        if (!r.ok) throw await failure(r);
      } catch (e) {
        setError(`Couldn't stop that answer: ${describeFetchFailure(e as Error)}`);
      }
    },
    [slug],
  );

  /**
   * The reader pressed stop.
   *
   * The wish is recorded *before* the request goes out, so that a stop landing
   * in the window before the `begin` frame is not lost — see `stopWanted`. The
   * row is not touched here: the server answers the still-open stream with a
   * `done` frame carrying whatever had arrived, and letting that frame be the
   * one thing that ends a turn is what keeps the screen and the file agreeing.
   */
  const stop = useCallback(
    (threadId: string, messageId: string) => {
      stopWanted.current.add(messageId);
      void askToStop(threadId, messageId);
    },
    [askToStop],
  );

  /**
   * Stop the first answer of a conversation, and throw the conversation away.
   *
   * Greg's call, 2026-08-26: a reader who selects a sentence, watches an answer
   * start and changes their mind wants the whole thing gone — panel, mark and
   * all. Distinct from `stop`, which keeps what arrived and is what they mean
   * further into a real conversation. The two are labelled differently in the
   * panel for that reason: `✕ Cancel` against `⏹ Stop`.
   *
   * **One request, not two.** Calling `/stop` and then `DELETE` was the first
   * design and it is a destructive race: `DELETE` has no expected-tail guard,
   * so a second question arriving in the gap is deleted along with the first.
   * The server does the check and the delete together — see `cancelChat` in
   * src/routes.ts.
   *
   * The row is tombstoned in `gone` **before** the request leaves. That is what
   * stops the still-open stream's frames from putting the conversation back on
   * screen while the delete is in flight: `setThreads` and the frame loop both
   * already consult it. Removing it from `threads` alone would not — the reader
   * would watch the answer they just cancelled carry on typing itself.
   */
  const askToCancel = useCallback(
    async (threadId: string, messageId: string, restore: ChatThread | undefined) => {
      try {
        const r = await apiFetch(`/api/chat/${encodeURIComponent(slug)}/${encodeURIComponent(threadId)}/cancel`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messageId,
              attempt: attempts.current.get(messageId),
              /* The client names the answer it believes is last. The server
                 refuses if the conversation has moved on since — which is the
                 whole point of doing this in one request. */
              expectedTailId: messageId,
            }),
          },
        );
        if (!r.ok) throw await failure(r);
      } catch (e) {
        /* **Put it back.** A 409 means the server refused because the
           conversation has moved on — another tab asked something else — and
           the reader must not be left believing they discarded a conversation
           that is still there. This is the one place in this hook that reverts
           an optimistic change, and it does so because the server said the
           premise was wrong, not merely because a request failed. */
        gone.current.delete(threadId);
        if (restore) {
          setThreads((prev) => (prev.some((t) => t.id === threadId) ? prev : [...prev, restore]));
        }
        setError(`Couldn't discard that conversation: ${describeFetchFailure(e as Error)}`);
      }
    },
    [slug],
  );

  const cancelAndDiscard = useCallback(
    (threadId: string, messageId: string) => {
      cancelWanted.current.add(messageId);
      gone.current.add(threadId);
      const before = latest.current.find((t) => t.id === threadId);
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      void askToCancel(threadId, messageId, before);
    },
    [askToCancel],
  );

  /**
   * Assistant rows a stream **in this hook** is currently writing into.
   *
   * The one question the watcher below has to answer, and it cannot be answered
   * from the row: `pending` on screen means "somebody is answering this", and
   * says nothing about whether that somebody is still here. A stream in another
   * tab, a stream in a hook that has since unmounted, and this hook's own live
   * stream all look identical.
   *
   * Server ids and provisional ones both, because a row is claimed before the
   * request leaves and again when `begin` names it.
   *
   * **Counted rather than a set.** Two streams can be writing into one row id —
   * the panel does not offer a retry on a `pending` row, so it takes some doing,
   * but a `Set` makes the first of them to finish announce that nobody is
   * writing while the second still is, and the watcher then says "connection
   * lost" over an answer whose words are arriving. A count cannot say that.
   * Found by a GPT-5.6 review, 2026-08-26.
   */
  const owned = useRef(new Map<string, number>());

  /**
   * Bumped whenever a stream lets go of a row, purely to make the effect below
   * look again.
   *
   * `owned` is a ref, so removing an id from it changes nothing React can see —
   * and the case that matters most releases a row without touching `threads`
   * either: the stream stalls, the row stays exactly as it was, and the only
   * thing that has changed is that nobody is writing to it any more. Without
   * this the scan would not run again until the reader happened to type
   * something, which is to say the spinner would still be there for ever. Cost
   * one afternoon of a test that was right about the code.
   */
  const [released, setReleased] = useState(0);

  /**
   * Rows being polled for, so the panel can say what it is doing.
   *
   * State rather than a ref, because something renders from it — and a `Set`
   * rebuilt on each change rather than mutated, because React compares by
   * identity. Deliberately *not* a field on `ChatMessage`: this is what the
   * client is doing, not what the server recorded, and putting it in the stored
   * shape would mean writing "we are looking for this" to disk.
   */
  const [recovering, setRecovering] = useState<Set<string>>(() => new Set());

  /**
   * Watches that have not finished, each under a token of its own.
   *
   * A token rather than a bare id, so that a watch can tell "I am still the one
   * watching this row" from "somebody else is". Clearing the map — which
   * changing article does — lets a second watch start for a row the first is
   * still looping over, and with a plain `Set` the first would then read the
   * second's entry as its own and both would run. Two loops writing the same
   * answer is harmless today and is the kind of thing that stops being harmless
   * quietly. Found by a GPT-5.6 review, 2026-08-26.
   */
  const watched = useRef(new Map<string, object>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect reads a ref, and leaving the article is when a watch stops being anybody's business
  useEffect(() => {
    const open = watched.current;
    return () => open.clear();
  }, [slug]);

  /**
   * Go and find out whether an answer nobody is streaming ever finished.
   *
   * **This is the whole recovery mechanism, and it has exactly one trigger:** a
   * `pending` assistant row that no local stream owns. That covers the case it
   * was written for — a stream this hook lost — and the one that was originally
   * reported and that an earlier design missed entirely: the hook *remounts*
   * (Vite Fast Refresh in development, and StrictMode on every mount), the old
   * hook's stream dies with it, and the new hook loads a `pending` row from the
   * server with no clock and no stream. That spins for ever, exactly as before,
   * unless something notices the row is nobody's. Found by a GPT-5.6 review,
   * 2026-08-26.
   *
   * It ends in one of three ways: the row settles on the server and is adopted;
   * the reader deletes the conversation or leaves the article; or the server's
   * own deadline passes and the row becomes a failure the reader can retry.
   */
  const watch = useCallback(
    async (threadId: string, messageId: string): Promise<void> => {
      if (watched.current.has(messageId)) return;
      const token = {};
      watched.current.set(messageId, token);
      setRecovering((prev) => new Set(prev).add(messageId));
      const mine = slug;
      /* Measured from **now**, not from the row's `createdAt`, and that is a fix
         rather than a simplification. The client stamps `createdAt` when the
         reader presses Enter, and the server may then spend its whole turn
         deadline in `settleThread` finishing a superseded answer before this
         turn starts at all — so a deadline anchored to the stamp can already be
         spent by the time the first word arrives. Anchoring here is also what
         lets the window cover the server's orphan sweep for a row inherited
         from a process that is no longer running; see `RECOVER_MARGIN_MS`.
         Found by a GPT-5.6 review, 2026-08-26. */
      const until = Date.now() + SERVER_TURN_MS + RECOVER_MARGIN_MS;
      /** Is this still the watch on this row, or has another one taken over? */
      const stillOurs = () => watched.current.get(messageId) === token;
      try {
        for (;;) {
          /* Checked after the await as well as before it, which is the rule this
             file already follows for `showing`. A watch outlives several round
             trips, and the reader can delete the conversation or leave the
             article in any of them. */
          if (!stillOurs() || gone.current.has(threadId)) return;
          if (showing.current !== mine) return;
          const settled = await settledAnswer(mine, threadId, messageId);
          if (!stillOurs() || gone.current.has(threadId)) return;
          if (showing.current !== mine) return;
          if (settled) {
            /* Only this row, and only by patching it. Replacing the whole
               thread with the server's copy is the mistake `refresh` documents
               at length: it puts a snapshot taken before an unrelated send over
               the top of that send's optimistic rows. */
            put(threadId, (t) => ({
              ...t,
              messages: t.messages.map((m) =>
                m.id === messageId
                  ? /* Defaulted before the spread, the same rule the `done`
                       frame follows: the stored row omits a field it has
                       nothing to say about, so a spread alone cannot clear one
                       left over from the attempt this watch is recovering. */
                    { ...m, stopped: false, truncated: false, tools: [], error: "", ...settled }
                  : m,
              ),
            }));
            return;
          }
          if (Date.now() >= until) break;
          await new Promise((r) => setTimeout(r, RECOVER_GAP_MS));
        }
        put(threadId, (t) => ({
          ...t,
          messages: t.messages.map((m) =>
            m.id === messageId ? { ...m, status: "error" as const, error: ENDED_UNFINISHED.message } : m,
          ),
        }));
      } finally {
        // Only if it is still ours — a watch that was superseded must not take
        // its successor's registration down with it.
        if (stillOurs()) watched.current.delete(messageId);
        setRecovering((prev) => {
          if (watched.current.has(messageId)) return prev;
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    },
    [slug, put],
  );

  /**
   * Every `pending` answer with nobody behind it gets a watch.
   *
   * One scan of what is on screen, on every change to it. Cheap, and it is the
   * only place a watch starts — a row that arrived from a load, from a lost
   * stream, or from a remount is the same row and gets the same treatment,
   * rather than three code paths that have to agree.
   *
   * `watch` is idempotent on the message id, which is what makes StrictMode's
   * double-invoked effect harmless.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — `released` is read by nothing and is in the list precisely so that a stream letting go of a row re-runs this scan; see the note on it above
  useEffect(() => {
    for (const thread of threads) {
      for (const message of thread.messages) {
        if (message.role !== "assistant" || message.status !== "pending") continue;
        if (owned.current.has(message.id)) continue;
        void watch(thread.id, message.id);
      }
    }
  }, [threads, released, watch]);

  /**
   * Open the stream, and keep one assistant row in step with it.
   *
   * All three of `send`, `retry` and `edit` end up here, because from the
   * moment the POST leaves they are the same thing: a body, one row to write
   * the arriving words into, and the four ways it can end. What differs is only
   * what the caller put on screen first and what it puts in `payload`.
   */
  const run = useCallback(
    (
      threadId: string,
      payload: Record<string, unknown>,
      /** The row the words land in. Provisional until the `begin` frame. */
      replyId: string,
      onThreadId?: (id: string) => void,
    ): void => {
      const id = threadId;
      /* Cleared on the way in as well as on the way out.

         A stop that fires *after* a run's `finally` — the reader clicks in the
         frame between the last token and the row repainting as `done` — leaves
         its wish in the set with nothing left to consume it. Harmless on its
         own, and not harmless at all once `retryTurn` started reusing the
         message id: the retry's `begin` frame would find the stale wish, stop
         the new answer before its first token, and leave a retry button that
         looks broken. Found in review, 2026-08-26. */
      stopWanted.current.delete(replyId);
      /* The id this send is writing into, which is NOT necessarily `id`.
         `beginTurn` on the server may overrule a thread id it cannot accept, and
         every patch after that has to follow it. A `let` closed over by
         `patchReply` rather than a second argument threaded through five call
         sites — and it must not be `id` itself, because the optimistic rows
         above were inserted under that one. */
      let current = id;
      /* And the same for the *message* id, which used not to be followed at all:
         the `begin` frame carried one and the client kept its own, so the two
         disagreed until the next reload. Nothing rendered from it, so nothing
         showed — until `stop` needed to name the row it wanted stopped, and
         found the only name it had was one the server had never heard of. */
      let pendingId = replyId;
      /* Claimed **now**, under the name the caller invented, and again under the
         server's name when `begin` arrives.

         Not an optimisation. `send` puts a `pending` assistant row on screen
         before this function is called, and the watcher effect runs on the very
         next render — so without this the watcher would immediately start
         hunting for a row the server has not been told about yet, fail to find
         it every time, and error a perfectly live answer out from under its own
         stream about fifteen seconds in. Caught by tests/use-chat-recovery.test.ts
         while it was being written for a different case entirely. */
      claim(owned.current, replyId);
      /* Counted for `refresh` alone — see the note there. Incremented before
         the request leaves and decremented in the `finally` below, so a 409 can
         tell "nothing else is happening here" from "there is a live answer in
         this conversation whose rows the server has not heard about yet". */
      running.current.set(id, (running.current.get(id) ?? 0) + 1);

      /** Rewrite the assistant row this send is responsible for. */
      const patchReply = (patch: Partial<ChatMessage>) =>
        put(current, (t) => ({
          ...t,
          messages: t.messages.map((m) => (m.id === pendingId ? { ...m, ...patch } : m)),
        }));

      /* Whether the server ever named this row. Until it has, `pendingId` is
         a name this client invented and no amount of looking on the server
         will find it — so a stream lost before `begin` cannot be recovered
         and goes straight to a failure. */
      let began = false;

      /* The `begin` frame's whole job, kept out of the loop that delivers it.

         Named and lifted here rather than written inline in the sink because it
         is the one frame that is not about the answer at all: it is the server
         telling this client the real names of the two rows it invented, and
         every line below reassigns something declared above. Beside
         `patchReply` it reads as what it is; inline it was forty lines of
         reassignment inside an object literal inside a call.

         That is a readability argument and not a complexity one — moving it
         changed the measured score by nothing, since Biome scores a nested
         function on its own. The 86 → 46 came from `drainTurn`. */
      const nameRow = (begun: Begun): void => {
        began = true;
        /* Claimed before anything else in this frame. From here on the
           watcher must leave this row alone: it is `pending` and it has
           somebody. Released in the `finally` below, whatever happens. */
        claim(owned.current, begun.messageId);
        /* Both ids read into `const`s **before** the updater is handed
           over, and that is a bug fix rather than a style. React runs a
           functional updater during the next render, not at the call —
           and the four lines below this one reassign both `current` and
           `pendingId`, which the closure would then see. So
           `withServerIds` was being asked to find a thread under the id
           the server had just moved it to, and a row under the id it
           was about to be renamed to; it found neither and returned the
           list untouched.
           Invisible in the ordinary case, because the server accepts
           the client's thread id and neither variable changes. It bites
           on exactly the path this frame exists for — a thread id the
           server overrules — leaving the panel holding invented names
           for both rows, which is the "That message is not in this
           conversation." failure this file already describes once.
           Found by tests/use-chat-recovery.test.ts, 2026-08-26. */
        const wasThread = current;
        const wasReply = pendingId;
        setThreads((prev) => withServerIds(prev, wasThread, wasReply, begun));
        const wanted =
          stopWanted.current.delete(pendingId) || stopWanted.current.delete(begun.messageId);
        if (begun.attempt !== undefined) {
          attempts.current.set(begun.messageId, begun.attempt);
        }
        pendingId = begun.messageId;
        if (begun.threadId !== current) {
          current = begun.threadId;
          // The URL is pointing at an id the server did not accept. Tell
          // the caller so `?thread=` can follow, or a reload lands on a
          // conversation that does not exist.
          onThreadId?.(begun.threadId);
        }
        /* A cancel pressed before this frame arrived. Checked FIRST and
           returns: cancel and stop must never both fire at the same row, and
           the cancel is the stronger wish — it stops the answer and removes
           the conversation, so a stop as well would be aborting something
           that is about to cease to exist. `cancelAndDiscard` cannot have
           sent anything real yet, because until this frame there was no id
           the server would accept. */
        if (
          cancelWanted.current.delete(pendingId) ||
          cancelWanted.current.delete(begun.messageId)
        ) {
          stopWanted.current.delete(begun.messageId);
          void askToCancel(current, begun.messageId, undefined);
          return;
        }
        // A stop pressed before this frame arrived. Now there is an id
        // for it, so it happens rather than being dropped on the floor.
        if (wanted) void askToStop(current, pendingId);
      };

      void (async () => {
        /* A deadline on the *response*, cleared the moment the headers arrive —
           see `OPEN_TIMEOUT_MS`. It must not outlive the `await` below, or it
           would abort the answer itself three minutes in. */
        const opening = new AbortController();
        const openBy = setTimeout(
          () => opening.abort(new Error(NO_RESPONSE.message)),
          OPEN_TIMEOUT_MS,
        );
        try {
          let response: Response;
          try {
            response = await apiFetch(`/api/chat/${encodeURIComponent(slug)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ threadId: id, ...payload }),
              signal: opening.signal,
            });
          } catch (e) {
            /* Asked of the controller rather than of the rejection. What a
               `fetch` rejects with when its signal fires is an `AbortError`
               whose text varies by engine, and reading a reader-facing sentence
               off it would be reading whichever one this browser happens to
               use. The controller is ours and it knows. */
            if (opening.signal.aborted) throw new Error(NO_RESPONSE.message);
            throw e;
          } finally {
            clearTimeout(openBy);
          }
          if (!response.ok || !response.body) {
            // A failure *before* the stream starts is ordinary JSON — a bad
            // slug, a question over the size cap. After it starts, failures
            // arrive as an `error` frame inside a 200, and are handled below.
            const why = (await failure(response)).message;
            /* **409 is the one status the screen cannot survive being wrong
               about.** It means the server refused a retry or an edit that this
               client had already performed on screen — and an edit performs by
               *destroying*: the question is rewritten and every turn below it is
               gone. Left alone, the panel shows a conversation that does not
               exist, and it looks exactly like a successful edit until the next
               reload puts the missing turns back.

               So the server's copy is fetched and replaces it. The reader gets
               their conversation back and a line saying why nothing happened,
               which is the only honest pair. Found by a GPT-5.6 review,
               2026-08-26. */
            if (response.status === 409) {
              setError(why);
              await refresh(current);
              return;
            }
            throw new Error(why);
          }

          try {
            await drainTurn(response.body, {
              patch: patchReply,
              begin: nameRow,
            });
            /* The stream ended without saying how — the server always sends
               `done` or `error` before it ends the response. Usually nothing is
               done about it here, and that is the point: the row is left
               `pending`, this run lets go of it in the `finally` below, and the
               watcher effect picks it up on the next render. See `watch`.

               Unless the row was never named, in which case there is nothing to
               pick up. This branch used to fall through with the rest, and the
               watcher would then spend two and a half minutes politely asking
               the server about a message id this client invented — showing
               "connection lost, checking…" the whole time for an answer that
               could never be found. The thrown case already guarded on `began`;
               a clean close had been left out of it. Found by a GPT-5.6 review,
               2026-08-26. */
            if (!began) throw new Error(ENDED_UNFINISHED.message);
          } catch (streamErr) {
            /* Three ways to lose a stream, one response to all of them.

               `StreamStalled` is the one that had no answer at all before: the
               stream stopped *without* ending — no bytes, no close, no error —
               and only `readEvents`' own clock can see it, because it watches
               bytes rather than frames. An ordinary network `TypeError` mid-read
               is the same situation with a louder name. Both leave the server
               working, so both are the watcher's business rather than a failure
               to report. Adding the second one was a GPT-5.6 note, 2026-08-26.

               A failure *before* the server named this row is different, and it
               is the one case the watcher cannot help with: `pendingId` is a
               name this client invented and no amount of looking will find it.
               That is a plain failure. */
            if (!began) throw streamErr;
            if (!(streamErr instanceof StreamStalled) && !(streamErr instanceof TypeError)) {
              throw streamErr;
            }
          }
        } catch (e) {
          patchReply({ status: "error", error: describeFetchFailure(e as Error) });
        } finally {
          // Whatever happened, nobody is waiting to stop this any more.
          for (const thread of new Set([id, current])) {
            const left = (running.current.get(thread) ?? 1) - 1;
            if (left > 0) running.current.set(thread, left);
            else running.current.delete(thread);
          }
          stopWanted.current.delete(replyId);
          stopWanted.current.delete(pendingId);
          /* Let go of the row. If it is still `pending` — the stream stalled,
             the connection dropped, the read threw — the watcher effect sees an
             unowned pending row on the next render and goes looking for the
             answer. That is the whole handoff. */
          release(owned.current, replyId);
          if (pendingId !== replyId) release(owned.current, pendingId);
          // And make the watcher effect look again — see `released`.
          setReleased((n) => n + 1);
          /* The attempt number outlives the stream on purpose. A stop pressed
             in the frame between the last token and the row repainting still
             has to name the right attempt, and the next `begin` for this row
             overwrites it anyway. */
        }
      })();
    },
    [slug, put, askToStop, refresh],
  );

  const send = useCallback(
    (
      threadId: string | null,
      question: string,
      at: string | null,
      useProfile = true,
      onThreadId?: (id: string) => void,
      anchor?: ChatAnchor,
      kind?: ThreadKind,
      stance?: ReviewStance,
      sourceCommentId?: string,
    ): string => {
      const id = threadId ?? mintId();
      const now = new Date().toISOString();
      const pendingId = mintId();

      /* Both rows go in optimistically, before the request leaves. The reader's
         own words appearing the instant they press Enter is the difference
         between a composer that feels attached to anything and one that does
         not — and the empty assistant row beneath is what the arriving text
         streams into.

         Their ids are provisional: the server mints its own and says so in the
         `begin` frame, and the ids are swapped there. */
      setThreads((prev) => {
        const user: ChatMessage = {
          id: mintId(),
          role: "user",
          text: question,
          createdAt: now,
          status: "done",
        };
        const reply: ChatMessage = {
          id: pendingId,
          role: "assistant",
          text: "",
          createdAt: now,
          status: "pending",
          /* The optimistic row's own copy. The server writes the authoritative
             one onto its pending row in the same write as the question, but the
             client does not read that back until the next load — so without
             this the stance tag on an answer appeared only after a reload,
             which is precisely the state a reader is never in while they are
             watching the answer arrive. Found in a browser pass, 2026-08-28.

             A guess, like the ids and the thread's kind beside it, and
             harmless in the same way: the refresh that follows replaces this
             row with the stored one. */
          ...(stance ? { stance } : {}),
        };
        const existing = prev.find((t) => t.id === id);
        const thread: ChatThread = existing
          ? { ...existing, updatedAt: now, messages: [...existing.messages, user, reply] }
          : {
              id,
              title: question.slice(0, 60),
              createdAt: now,
              updatedAt: now,
              /* The optimistic row's own guess, and it has to be right rather
                 than defaulted: this thread is rendered — and filtered by kind
                 in the panel — in the frame before the server answers. A `?? "chat"`
                 here would flash a new review into the list as a chat. */
              kind: kind ?? "chat",
              messages: [user, reply],
            };
        return existing ? prev.map((t) => (t.id === id ? thread : t)) : [...prev, thread];
      });

      /* The anchor rides only on the request, never into the optimistic thread
         above. The row on screen is a guess until the `begin` frame replaces it
         with the server's, and inventing an `anchor` for it would put a mark in
         the prose for a conversation that might yet be minted under another id.
         The mark is drawn from `useChatAnchors`, which is told once the server
         has agreed. */
      run(
        id,
        {
          question,
          at,
          ...(useProfile ? {} : { useProfile: false }),
          ...(anchor ? { anchor } : {}),
          /* Sent only when it is a review. A body with no `kind` means chat,
             which is what every caller written before this feature meant, and
             what keeps an old tab working. */
          ...(kind === "review" ? { kind } : {}),
          ...(stance ? { stance } : {}),
          ...(sourceCommentId ? { sourceCommentId } : {}),
        },
        pendingId,
        onThreadId,
      );
      return id;
    },
    [run],
  );

  const retry = useCallback(
    (threadId: string, messageId: string) => {
      /* Blanked field by field, for the same reason `retryTurn` rebuilds the
         stored row rather than spreading it: `citations`, `searches`, `tools`
         and the old `error` all belong to the answer being replaced, and any one
         of them left behind sits under text that never mentioned it. A stale
         tool strip is the loudest of them — it claims a web page was read for an
         answer that never saw one. */
      put(threadId, (t) => ({
        ...t,
        messages: t.messages.map((m) =>
          m.id === messageId
            ? {
                id: m.id,
                role: m.role,
                text: "",
                createdAt: new Date().toISOString(),
                status: "pending" as const,
                /* **The one field carried across**, mirroring `withRetry` on
                   the server exactly — see the note there. Everything else
                   belongs to the attempt being replaced; this is the
                   instruction that produced it, and a retry re-asks the same
                   question the same way.
                   Without it the row loses its stance for as long as the tab
                   lives, which then seeds the picker with `balanced` and makes
                   the *next* turn quietly change voice. GPT Sol's review of the
                   built code, finding 2. */
                ...(m.stance ? { stance: m.stance } : {}),
              }
            : m,
        ),
      }));
      // No `at`: a retry re-asks the stored question, and where the reader has
      // scrolled to since is not part of it.
      run(threadId, { retry: messageId }, messageId);
    },
    [put, run],
  );

  const edit = useCallback(
    (threadId: string, messageId: string, question: string, at: string | null) => {
      const now = new Date().toISOString();
      const pendingId = mintId();
      /* Read **before** the optimistic rewrite below, which is the whole point:
         this is what the reader was looking at when they pressed save, and the
         server refuses the edit if the conversation has moved past it. Absent
         only for a thread this tab has never seen the server's version of, in
         which case there is nothing after the question to be lost. */
      const expectedTailId = onScreen.current
        .find((t) => t.id === threadId)
        ?.messages.at(-1)?.id;
      put(threadId, (t) => {
        const index = t.messages.findIndex((m) => m.id === messageId);
        if (index < 0) return t;
        const target = t.messages[index];
        if (!target) return t;
        const replaced = t.messages[index + 1];
        return {
          ...t,
          // The same rule the server applies in `editTurn`: the first question
          // names the thread, so rewriting it renames the thread.
          title: index === 0 ? question.slice(0, 60) : t.title,
          updatedAt: now,
          messages: [
            ...t.messages.slice(0, index),
            { ...target, text: question, editedAt: now },
            {
              id: pendingId,
              role: "assistant" as const,
              text: "",
              createdAt: now,
              status: "pending" as const,
              /* From the answer being **replaced** — `t.messages[index + 1]` —
                 not from the tail of the thread, mirroring `withEdit` on the
                 server. An edit discards later turns whose stances may differ,
                 so taking the last one would answer a rewritten early question
                 in the voice of a turn that no longer exists. */
              ...(replaced?.role === "assistant" && replaced.stance
                ? { stance: replaced.stance }
                : {}),
            },
          ],
        };
      });
      run(
        threadId,
        { edit: messageId, question, at, ...(expectedTailId ? { expectedTailId } : {}) },
        pendingId,
      );
    },
    [put, run],
  );

  /**
   * A write whose only job is to stick — checked, not assumed.
   *
   * `fetch` resolves for a 404 or a 500; only a transport failure rejects. So a
   * bare `.catch()` on these calls reported success for every error the server
   * could return: the rename or the delete happened on screen, the server said
   * no, and the next reload put the old state back. This app has been bitten by
   * exactly that before — see the note on `forget` in useComments.ts, where a
   * DELETE that 500'd removed a comment from the screen and said nothing.
   * Found again here by a GPT-5.6 review, 2026-08-26.
   */
  const write = useCallback(
    async (threadId: string, init: RequestInit, what: string) => {
      try {
        const r = await apiFetch(`/api/chat/${encodeURIComponent(slug)}/${encodeURIComponent(threadId)}`,
          init,
        );
        if (!r.ok) throw await failure(r);
      } catch (e) {
        // The optimistic change stays on screen. Reverting it would be a second
        // surprise on top of the first, and the message says what happened —
        // the reader can reload to see the truth.
        setError(`Couldn't ${what}: ${describeFetchFailure(e as Error)}`);
      }
    },
    [slug],
  );

  const rename = useCallback(
    (threadId: string, title: string) => {
      put(threadId, (t) => ({ ...t, title }));
      void write(
        threadId,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        },
        "rename that conversation",
      );
    },
    [put, write],
  );

  const remove = useCallback(
    (threadId: string) => {
      gone.current.add(threadId);
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      void write(threadId, { method: "DELETE" }, "delete that conversation");
    },
    [write],
  );

  /* Mirrored on every render rather than written at each `setThreads`. There
     are a dozen of those and one of this, and a mirror that is updated at
     twelve call sites is a mirror that is stale at the thirteenth. */
  latest.current = threads;

  return {
    threads,
    loaded,
    loadFailed,
    recovering,
    send,
    cancelAndDiscard,
    retry,
    edit,
    stop,
    begin,
    discard,
    rename,
    remove,
    error,
  };
}
