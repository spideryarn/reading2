/**
 * `base`, minus the tombstoned, with every live operation laid over it.
 *
 * `threads` — the array the panel renders — is **derived**. It is never
 * assigned, which is the whole difference between this and the eleven
 * `setThreads` call sites it replaces: each of those had its own merge rule and
 * its own idea of who was entitled to write.
 *
 * The payoff is the 409 path. An edit destroys — it rewrites a question and
 * discards every turn under it — and that used to be performed on screen, so a
 * refusal could only be undone by re-fetching the conversation and hoping
 * nothing else was happening in it. As a projection the discard is something
 * the *operation* does, and refusing it is dropping one entry from a map: the
 * discarded turns come back because they never left, and any other conversation
 * with a send running in it re-projects untouched.
 *
 * **What each operation draws is decided by one rule**, and it is worth stating
 * once here because every branch below is an instance of it: **an operation
 * projects what can still be withdrawn.** A rename's title is never taken back,
 * even when the PATCH fails, so it belongs in `base` and is drawn by nothing. A
 * send's two rows are never taken back either. A retry's blanking and an edit's
 * discard are taken back the moment the server refuses them, so they are drawn.
 */
import type { ChatMessage, ChatThread } from "../../types.js";
import { shortenedSpokenLabel } from "../../spoken-label.js";
import type { ChatState, Operation, SpokenOperation, TurnOperation } from "./model.js";

/**
 * One turn's rows, laid over the messages already there.
 *
 * Exported because **the reducer commits a turn by calling this**, with the
 * operation's final state, over `base`. That is deliberate: what the reader was
 * looking at and what gets written down are then the same function of the same
 * data, rather than two pieces of code that have to agree. The two used to be
 * an optimistic `setThreads` and a `patchReply`, and they disagreed twice.
 */
export function turnMessages(messages: ChatMessage[], op: TurnOperation): ChatMessage[] {
  if (op.shape === "edit") {
    /* The rewritten question, and everything under it gone. Found by id
       because the server keeps a rewritten question's id — `withEdit` builds
       `{ ...target, text, editedAt }` — so this is the same row, not a new one. */
    const at = messages.findIndex((m) => m.id === op.editing);
    if (at < 0 || !op.question) return messages;
    return [...messages.slice(0, at), op.question, op.reply];
  }
  /* A send and a retry both replace exactly one row: the send's own empty
     answer, which went into `base` at registration, and the retry's blanked
     copy of the answer it is replacing. Rebuilt in place rather than appended,
     which is what keeps two sends in one conversation in the reader's order
     however they finish. */
  const at = messages.findIndex((m) => m.id === op.replyId);
  if (at < 0) return messages;
  if (messages[at] === op.reply) return messages;
  const next = messages.slice();
  next[at] = op.reply;
  return next;
}

/**
 * One spoken exchange's two rows, on the end of what is already there.
 *
 * Exported for the same reason `turnMessages` is: **the reducer does not call
 * it.** A spoken append commits by taking the server's copy of the whole
 * conversation, which is a different thing from what was drawn — the ids are
 * the server's — so there is deliberately no `commit` that reuses this. It is
 * exported so a test can assert what the reader saw before the answer came
 * back, which is the half a 409 has to put right.
 */
export function spokenMessages(
  messages: readonly ChatMessage[],
  op: SpokenOperation,
): ChatMessage[] {
  return [...messages, op.question, op.reply];
}

/**
 * The attempted pair, immediately after the tail it claimed. Server ids and
 * timestamps differ from provisional rows; every field the spoken request
 * actually writes must agree. Matching prose elsewhere is not proof of this
 * append, and metadata equality must not depend on JSON object key order.
 */
export function storedSpoken(thread: ChatThread | null | undefined, op: SpokenOperation): ChatMessage | null {
  if (!thread) return null;
  const tail = op.expectedTailId === null ? -1 : thread.messages.findIndex((m) => m.id === op.expectedTailId);
  if (op.expectedTailId !== null && tail < 0) return null;
  const question = thread.messages[tail + 1];
  const answer = thread.messages[tail + 2];
  if (!question || !answer || question.role !== "user" || answer.role !== "assistant" ||
      question.status !== "done" || answer.status !== "done" ||
      question.text !== op.question.text || answer.text !== op.reply.text ||
      Boolean(answer.interrupted) !== Boolean(op.reply.interrupted)) return null;
  const label = (text: string, requested: boolean) => requested ? shortenedSpokenLabel(text) : text;
  const passages = (message: ChatMessage, requested = false) => (message.passages ?? []).map((p) => [p.blockIds, label(p.why, requested)]);
  // The route stores done tools and discards client timing and call ids.
  const tools = (message: ChatMessage, requested = false) => (message.tools ?? []).map((t) => [
    t.name, label(t.label, requested), label(t.detail ?? "", requested), requested ? "done" : t.status,
  ]);
  return JSON.stringify(passages(answer)) === JSON.stringify(passages(op.reply, true)) &&
    JSON.stringify(tools(answer)) === JSON.stringify(tools(op.reply, true)) ? answer : null;
}

/**
 * Lay one operation over the list.
 *
 * **Structural sharing is a requirement, not an optimisation.** A chat delta
 * re-renders the conversation band and the article is underneath it, so
 * changing one thread must not rebuild every thread and every message. Each
 * branch either hands back the array it was given or rebuilds exactly the one
 * thread it touches, leaving every other thread — and every message in the
 * touched thread but the one that moved — at the same reference.
 */
function draw(threads: readonly ChatThread[], op: Operation): readonly ChatThread[] {
  switch (op.kind) {
    case "turn": {
      const at = threads.findIndex((t) => t.id === op.threadId);
      /* The conversation is not there: deleted, discarded, or belonging to an
         article this hook has left. Nothing to draw on. */
      if (at < 0) return threads;
      const thread = threads[at] as ChatThread;
      const messages = turnMessages(thread.messages, op);
      if (messages === thread.messages) return threads;
      const next = threads.slice();
      next[at] = { ...thread, updatedAt: op.at, messages };
      return next;
    }
    case "spoken": {
      /* **Appended rather than written into `base`, and that is the whole of
         the 409 path.** The server refuses an append behind a conversation that
         has moved on; its repair keeps drawing these provisional rows until
         it learns whether they were already saved by a lost first response. A send may write its rows into `base` instead, because
         nothing takes a typed question back; this one is taken back by exactly
         one thing, and that thing happens. */
      const at = threads.findIndex((t) => t.id === op.threadId);
      if (at < 0) return threads;
      const thread = threads[at] as ChatThread;
      const next = threads.slice();
      next[at] = {
        ...thread,
        updatedAt: op.at,
        messages: spokenMessages(thread.messages, op),
      };
      return next;
    }
    case "repair": {
      const spoken = op.spoken?.operation;
      if (!spoken || storedSpoken(threads.find((t) => t.id === op.threadId), spoken)) return threads;
      return draw(threads, spoken);
    }
    /* **A rename draws nothing**, and that is the rule rather than an
       exception: an operation projects what can still be **withdrawn**. A
       refused edit's discarded turns come back because the operation never
       really took them away; a rename's optimistic title is deliberately never
       taken back, even when the PATCH fails, so it belongs in `base` from the
       moment the reader asks for it.
       Drawing it instead was a regression — an edit of the first question
       renames the conversation too, and the operation drew over it and then
       committed on top. tests/chat-title-ownership.test.ts, and the note in
       reduce.ts on `rename.started`. */
    case "rename":
    /* The load writes through `base` when it is admitted rather than drawing
       while it is in flight: what it has to say is the server's list, and until
       it answers it has nothing. A typed turn's repair is the same. */
    case "load":
    /* A delete draws by its tombstone, which is in the state and is filtered
       out below — deletions have to win over every projection, including ones
       registered after them. */
    case "delete":
    /* A recovery draws nothing either, and it is the third instance of the same
       rule: the row it is looking for is already `pending` in `base`, put there
       by the turn that handed it over or by the load that found it, and nothing
       about it is withdrawn. What the recovery has to say arrives when it finds
       the answer, and that goes into `base` like every other admitted result.
       The panel is told the row is being chased through `recovering`, which is
       derived from this operation existing at all. */
    case "recovery":
    /* A stop draws nothing — the answer's own `done` frame is what ends it. A
       cancel draws by its tombstone, like a delete, which is in the state and
       filtered out below: it has to be off the screen before the request leaves
       and stay off while it is out, which is not something a projection over
       `base` could express. */
    case "intent":
      return threads;
  }
}

/**
 * What the reader sees.
 *
 * Pure, and called only by the controller, which caches the result: React calls
 * `getSnapshot` on every render and must be handed the same reference when
 * nothing has moved.
 */
export function project(state: ChatState): readonly ChatThread[] {
  let threads: readonly ChatThread[] = state.tombstones.size
    ? state.base.filter((t) => !state.tombstones.has(t.id))
    : state.base;
  /* Creation order, which is the defined order for two operations in one
     conversation, and the reason `seq` exists: a `Map` keeps insertion order
     only for as long as nothing is deleted and re-added, and retiring an
     operation does exactly that.
     Superseded operations are skipped **the moment the newer one is
     registered**, not when it answers. Without that, two renames finishing in
     reverse order put the replaced title back on screen. */
  const live = [...state.operations.values()]
    .filter((op) => !op.superseded)
    .sort((a, b) => a.seq - b.seq);
  for (const op of live) threads = draw(threads, op);
  return threads;
}
