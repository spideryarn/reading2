/**
 * Chat threads on disk — `data/<slug>/chat.json`.
 *
 * The sibling of src/comments.ts, and deliberately the same shape: reader state
 * beside the article rather than in it, one JSON file, an atomic write, and a
 * serialised read-modify-write queue. Where the two differ is said out loud
 * below; everything else is the same because a second good way to store reader
 * state would be one way too many.
 *
 * **Why several threads and not one.** Greg chose it, 2026-08-25, over both a
 * single thread per article and no persistence at all. The cost is real and
 * worth naming: the original version of this app rewrote its chat persistence
 * three times (`250605a_chat_database_integration`,
 * `250608a_simplify_chat_persistence`,
 * `250629a_chat_architecture_database_first_redesign`) and every one of those
 * rewrites was about where the threads live. What keeps this from becoming the
 * fourth is that a thread here is **not a first-class object with a life of its
 * own** — no sharing, no cross-article list, no server-side ordering. It is a
 * list inside the article's own file, and the article owns it.
 *
 * See docs/plans/chat-mode.md, and docs/project/database.md for what happens to
 * this file when storage moves to Postgres — the answer is "one table, one row
 * per message", and nothing in this module's interface has to change.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ChatAnchor,
  ChatMessage,
  ChatThread,
  ReviewStance,
  ThreadKind,
  ToolRun,
} from "./types.js";
import { isSpideryarnId, mintUniqueId } from "./ids.js";
import { errorFields, log } from "./log.js";
import { parseJsonFrom } from "./parse-json.js";
import { assertSlug } from "./slug.js";

/**
 * What may be logged from this file: ids, slugs, counts, statuses.
 *
 * **Never a message's `text`, never a thread's `title`.** The title is the
 * reader's first sentence, so it is prose too — it just does not look like it,
 * which is exactly how it would end up in a log line that felt harmless. Same
 * rule as src/comments.ts, and the same reason: `redact` in log.ts matches key
 * paths, never message strings, so the only thing keeping prose out of the log
 * is not putting it in.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

const fileFor = (slug: string) => path.join(ROOT, "data", slug, "chat.json");

/**
 * Read-modify-write serialised per process — see src/comments.ts for the full
 * reasoning.
 *
 * It matters more here than it does there. A chat answer is written to this
 * file **twice** — once when the reader sends, once when the model finishes —
 * and a streamed answer means those two writes are tens of seconds apart with
 * the reader free to type again in between. Without the chain, sending a second
 * message while the first is still streaming reads the file as it was before
 * the first user turn landed, and the second write puts it back that way. Both
 * writes succeed. One turn is simply gone.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

/**
 * A stored thread written before review mode existed has no `kind`. Give it one.
 *
 * **`ChatThread.kind` is required**, deliberately — an optional field would mean
 * a `?? "chat"` at every read site, and one of those would eventually be missed,
 * which is a review answered with chat's prompt and nothing on screen
 * disagreeing (GPT Sol's review of docs/plans/review-mode.md, finding 5). The
 * price of "required" is exactly this function, and its twin in
 * src/store/pg-chat.ts. Two places hold the default instead of twenty.
 *
 * It reads the field off a value the type says always has it, which is the one
 * honest way to write this: the type describes what the rest of the program may
 * assume, and JSON on disk is not bound by it.
 */
function normaliseKind(thread: ChatThread): ChatThread {
  return thread.kind === "review" || thread.kind === "chat"
    ? thread
    : { ...thread, kind: "chat" };
}

export async function loadThreads(slug: string): Promise<ChatThread[]> {
  assertSlug(slug);
  try {
    /* `parseJsonFrom`, not `JSON.parse`: V8's own parse error quotes the first
       characters of the malformed input back, and those characters are the
       reader's conversation. The `error` line below keeps `message` and
       `stack`, so it would have been written down twice. src/parse-json.ts, and
       the same change in src/comments.ts and src/searches.ts. */
    const parsed = parseJsonFrom<{ threads?: ChatThread[] }>(
      await readFile(fileFor(slug), "utf8"),
      `chat.json for ${slug}`,
    );
    return (parsed.threads ?? []).map(normaliseKind);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    // No file yet is normal. A file that will not parse means every
    // conversation about this article is unreadable at once — the same
    // highest-stakes line src/comments.ts carries, and for the same reason.
    log("store").error({ slug, ...errorFields(err) }, "chat file unreadable");
    throw err;
  }
}

/**
 * Write the file so a reader never sees a half-written one.
 *
 * `writeFile` truncates before it writes, so there is a window where the file
 * is empty or cut off mid-object; land in it and every later read throws,
 * wedging every thread rather than losing the one being written. Writing a
 * neighbour and renaming over the top makes the swap atomic. The temp file goes
 * in the same directory because `rename` is only atomic within one filesystem.
 */
async function save(slug: string, threads: ChatThread[]): Promise<void> {
  const file = fileFor(slug);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temp, JSON.stringify({ threads }, null, 2), "utf8");
    await rename(temp, file);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}

/** Apply `mutate` to the stored threads and write the result back. */
export function update(
  slug: string,
  mutate: (threads: ChatThread[]) => ChatThread[],
): Promise<ChatThread[]> {
  assertSlug(slug);
  return serialised(async () => {
    const next = mutate(await loadThreads(slug));
    await save(slug, next);
    return next;
  });
}

/**
 * A thread's name, taken from the first thing the reader typed.
 *
 * Cut on a word boundary, and only when there is something to cut — a short
 * question is its own title and does not need an ellipsis it has not earned.
 * Newlines collapse first, because a pasted paragraph would otherwise put a
 * line break in the middle of a list item.
 */
export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length === 0) return "New chat";
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${space > 20 ? cut.slice(0, space) : cut}…`;
}

/** Every id in use for this article, so a new one cannot collide with one. */
function taken(threads: ChatThread[]): Set<string> {
  const ids = new Set<string>();
  for (const t of threads) {
    ids.add(t.id);
    for (const m of t.messages) ids.add(m.id);
  }
  return ids;
}

/* There is deliberately no `createThread` here.

   There was one — exported, and called by nothing — and it wrote an empty
   thread to disk. It is gone because it contradicted the rule the rest of this
   file and src/web/useChat.ts both depend on: **an empty conversation exists
   only in the tab that started it.** That rule is what lets the panel throw one
   away without asking the server, and what stops "New chat" rows accumulating
   in the list for every time somebody pressed the button and changed their
   mind — which is the bug Greg reported on 2026-08-26. One live caller of a
   server-side create and `withoutEmpty` in useChat.ts becomes a deletion that
   does not delete: gone from the screen, back on the next reload.

   A conversation starts existing when its first question is asked. That is
   `beginTurn`, which creates the thread if it is missing. */

export async function renameThread(
  slug: string,
  threadId: string,
  title: string,
): Promise<ChatThread[]> {
  // The title is prose the reader wrote, so it is not logged — only that a
  // rename happened, which is the part an operator could act on.
  const next = await update(slug, (threads) =>
    threads.map((t) => (t.id === threadId ? { ...t, title: titleFrom(title) } : t)),
  );
  log("store").info({ slug, threadId }, "chat thread renamed");
  return next;
}

export async function deleteThread(slug: string, threadId: string): Promise<ChatThread[]> {
  const remaining = await update(slug, (threads) => threads.filter((t) => t.id !== threadId));
  // Destructive with no undo, so it is logged — and `remaining` is the count, so
  // a delete that removed nothing (a stale id from a second tab) can be told
  // apart from one that did.
  log("store").info({ slug, threadId, remaining: remaining.length }, "chat thread deleted");
  return remaining;
}

export interface Turn {
  /** The reader's message. */
  question: string;
  /** The thread it belongs to. Created if it does not exist yet. */
  threadId: string;
  /**
   * The passage this conversation is about — **only meaningful when this turn
   * creates the thread**, which is the only branch `withTurn` applies it on.
   *
   * The route rejects an anchor sent for a thread that already exists rather
   * than letting it fall through and be ignored here.
   */
  anchor?: ChatAnchor;
  /**
   * Chat or review — **only meaningful when this turn creates the thread**,
   * which is the only branch `withTurn` applies it on, exactly like `anchor`
   * above.
   *
   * A kind that contradicts an existing thread is refused here rather than
   * ignored: silently answering a review with chat's prompt because a stale tab
   * said so is a transcript half in one voice and half in another, with nothing
   * anywhere disagreeing. The route refuses it first, with a 409 and a sentence
   * a person can act on; this is the backstop, and it is inside the Postgres
   * transaction because `inTurnOrder` is only per-process.
   *
   * Absent means `"chat"`, which is what every caller written before review
   * mode meant.
   */
  kind?: ThreadKind;
  /**
   * How much the answer should say, for a review turn.
   *
   * Written onto the **pending** reply, not onto the finished one — see
   * `ChatMessage.stance`. An answer that never finished still has to say which
   * instruction produced it.
   */
  stance?: ReviewStance;
}

/**
 * Store the reader's message **and** a `pending` assistant message, before the
 * model is called.
 *
 * Both rows, and in one write. That ordering is the whole reason this function
 * exists rather than the route appending as it goes:
 *
 *  - if the process dies mid-answer, the thread still holds the question and an
 *    unfinished answer, so the reader sees a turn that never completed and can
 *    ask again — rather than a question that vanished with the process;
 *  - and the assistant row has its id from the first frame, so the stream has
 *    somewhere to land and the client has something to render into without
 *    swapping an optimistic row for a real one when the answer arrives.
 *
 * The thread is created here if it is missing, so a reader typing into a fresh
 * chat does not need a round trip before they can send.
 */
/**
 * The new turn, as a value. **Pure — no clock, no disk, no id but the ones it
 * mints.**
 *
 * Lifted out of `beginTurn`'s `update` callback so that both stores can share
 * it: everything here is an invariant (which ids are free, when a thread takes
 * its title, whether the client's thread id is honoured), and an invariant with
 * two implementations is an invariant with two behaviours. The Postgres store
 * calls this inside its transaction and writes the difference; the filesystem
 * store calls it inside the mutex and writes the file. Neither owns the rule.
 *
 * `at` rather than a `now()` — the caller resolves the clock once, exactly as
 * `withRetry` and `withEdit` already do, so every row in one turn carries the
 * same timestamp. That matters more than it looks: the user message and its
 * pending reply are written together and sort by `ordinal` precisely because
 * their `createdAt` collides.
 */
export function withTurn(
  threads: ChatThread[],
  { threadId, question, anchor, kind, stance }: Turn,
  at: string,
): { threads: ChatThread[]; thread: ChatThread; user: ChatMessage; reply: ChatMessage } {
  const ids = taken(threads);
  const existing = threads.find((t) => t.id === threadId);
  /* **A thread is one kind for life.** Refused rather than ignored, and refused
     here rather than only in the route, because the route's `inTurnOrder` is a
     per-process convenience and this runs inside the Postgres transaction. See
     `Turn.kind`, and docs/plans/review-mode.md § `kind` belongs to the thread.

     An *identical* kind passes, so a retried send — the same request arriving
     twice — is harmless rather than a 409 the reader has to understand. Same
     rule as the anchor check in the route. */
  if (existing && kind && existing.kind !== kind) {
    throw new ChatConflict("That conversation is already a different kind.");
  }
  const user: ChatMessage = {
    id: mintUniqueId(ids),
    role: "user",
    text: question,
    createdAt: at,
    status: "done",
  };
  const reply: ChatMessage = {
    id: mintUniqueId(ids),
    role: "assistant",
    text: "",
    createdAt: at,
    status: "pending",
    /* On the pending row, before a word of the answer exists. `ChatMessage.stance`
       says why: an answer that crashed, errored, was stopped or was swept still
       has to say which instruction produced the words that did arrive, and a
       retry of it has to have something to inherit. */
    ...(stance ? { stance } : {}),
  };
  const base: ChatThread = existing ?? {
    /* The client mints the thread id so `?thread=` can be in the URL before
       the first message is sent — the same trick createComment allows for a
       comment id, and for the same reason: nothing has to be swapped when the
       answer lands.

       Accepted only if it is one of ours and free. A caller who sends
       something else gets a minted id rather than an error, and gets it back
       in the response, so the client's job is to believe the response rather
       than to assume its guess was taken. That is what makes a duplicate
       send harmless instead of a way to append to a stranger's thread. */
    id: isSpideryarnId(threadId) && !ids.has(threadId) ? threadId : mintUniqueId(ids),
    title: "New chat",
    createdAt: at,
    updatedAt: at,
    /* **Only on this branch**, which is the branch that builds a new thread.
       A conversation is about what it started as — the same rule `title` follows
       just below, and for a sharper reason: the anchor draws a mark in the
       prose, so a thread that re-anchored itself would move its mark to a
       paragraph the reader is not looking at.

       An anchor arriving for a thread that already exists is not silently
       dropped here — that would append a question about passage B to a thread
       the database says is about passage A, with nothing anywhere disagreeing.
       The route refuses it before we are reached. See `answerChat` in
       src/routes.ts and docs/plans/chat-as-gateway.md § Set once.

       Conditional spread, never `anchor: undefined`: `exactOptionalPropertyTypes`
       is on and the two stores are compared field for field, where an explicit
       undefined and an absent key are not the same thing. */
    ...(anchor ? { anchor } : {}),
    /* **Only on this branch**, the same rule and the same reason as `anchor`
       just above, sharpened: the kind chooses the system prompt, so a thread
       that changed kind halfway would have a first half answered by one set of
       instructions and a second half by another. Unlike `anchor` it is not
       optional on the type, so it is written unconditionally with its default
       rather than spread. */
    kind: kind ?? "chat",
    messages: [],
  };
  const thread: ChatThread = {
    ...base,
    // The first question names the thread. Later ones do not — a conversation
    // is about what it started as, and renaming it under the reader as it
    // wanders would lose them the entry they were looking for in the list.
    title: base.messages.length === 0 ? titleFrom(question) : base.title,
    updatedAt: at,
    messages: [...base.messages, user, reply],
  };
  return {
    threads: existing
      ? threads.map((t) => (t.id === thread.id ? thread : t))
      : [...threads, thread],
    thread,
    user,
    reply,
  };
}

/**
 * One spoken exchange, both halves known, ready to append.
 *
 * Deliberately not a `Turn`: that type describes a question **about to be
 * answered**, and half its fields (`stance`, and the pending row `beginTurn`
 * writes) only make sense while an answer is still coming.
 */
export interface SpokenTurn {
  threadId: string;
  /** What the reader said. May be empty if the transcription failed. */
  question: string;
  /** What the companion said. */
  answer: string;
  passages?: { blockIds: string[]; why: string }[];
  tools?: ToolRun[];
  /** The reader talked over it, so the text may run past what they heard. */
  interrupted?: boolean;
  model?: string;
  /**
   * **The message this caller believes is last, or `null` for "this thread is
   * empty".**
   *
   * Required, not optional, and that is the difference from `edit`'s version of
   * the same guard. There it is a safety net over a destructive operation; here
   * it is the *only* thing standing between a replayed request and a duplicated
   * turn, so a caller with no opinion must not be able to skip it by omission.
   *
   * It buys idempotency for free, which is why there is no exchange-id column:
   * a POST that is retried after succeeding presents a tail the first one has
   * already moved, so it conflicts instead of appending twice. Two *different*
   * exchanges racing present the same tail, and the loser conflicts and retries
   * with the new one — which is correct, because they have to be ordered.
   *
   * `null` rather than absent for the empty thread, so "I think this is new"
   * and "I forgot to say" stay different states. A reader can press Live before
   * typing anything, and that case is real.
   */
  expectedTailId: string | null;
}

/**
 * **Append a finished exchange — both rows, `done`, in one write.**
 *
 * Live conversation's counterpart to `withTurn`, and pure for the same reason:
 * this is an invariant, and an invariant with two implementations is an
 * invariant with two behaviours. The filesystem store calls it inside its
 * mutex, the Postgres store inside its transaction, and neither owns the rule.
 *
 * ## Why not `beginTurn` then `finishTurn`
 *
 * Because both halves are already known, so the pending row `beginTurn` exists
 * to create has nothing to be pending for — and a crash between the two calls
 * would leave a false unfinished answer in a conversation nobody is answering.
 * There is also a concrete obstacle: the Postgres store's `finish` refuses
 * without the attempt token `begin` returned (src/store/pg-chat.ts), so the
 * pair is not two free-function calls. GPT Sol's review of
 * docs/plans/live-conversation-in-chat.md, finding 4.
 *
 * ## The rows are ordinary
 *
 * `status: "done"` on both, no attempt, no stance. A spoken turn is a turn: the
 * renderer, the retry path and the prompt builder all treat it exactly as they
 * treat a typed one, which is the whole point of putting it in the same thread.
 * The only two fields it can carry that a typed turn cannot are `passages` and
 * `interrupted`, and both are absent unless there is something to say.
 */
export function withSpokenTurn(
  threads: ChatThread[],
  spoken: SpokenTurn,
  at: string,
): { threads: ChatThread[]; thread: ChatThread; user: ChatMessage; reply: ChatMessage } {
  const { threadId, expectedTailId } = spoken;
  const existing = threads.find((t) => t.id === threadId);

  /* **The guard, and it runs before anything is minted.** `null` means the
     caller believes there is nothing here yet — which is true both for a thread
     that does not exist and for one created but never spoken into. */
  const tail = existing?.messages.at(-1)?.id ?? null;
  if (tail !== expectedTailId) {
    throw new ChatConflict(
      "This conversation has moved on since the live session started. Reload and try again.",
    );
  }

  const ids = taken(threads);
  const user: ChatMessage = {
    id: mintUniqueId(ids),
    role: "user",
    text: spoken.question,
    createdAt: at,
    status: "done",
  };
  const reply: ChatMessage = {
    id: mintUniqueId(ids),
    role: "assistant",
    text: spoken.answer,
    createdAt: at,
    status: "done",
    /* Conditional spreads throughout, never `x: undefined`. The two stores are
       compared field for field by tests/store-roundtrip.test.ts, where an
       absent key and an explicit undefined are not the same thing. */
    ...(spoken.passages && spoken.passages.length > 0 ? { passages: spoken.passages } : {}),
    ...(spoken.tools && spoken.tools.length > 0 ? { tools: spoken.tools } : {}),
    ...(spoken.interrupted ? { interrupted: true } : {}),
    ...(spoken.model ? { model: spoken.model } : {}),
  };

  const base: ChatThread = existing ?? {
    /* Same rule as `withTurn`: the client's id is honoured only if it is one of
       ours and free, so a duplicate cannot append to a stranger's thread. */
    id: isSpideryarnId(threadId) && !ids.has(threadId) ? threadId : mintUniqueId(ids),
    title: "New chat",
    createdAt: at,
    updatedAt: at,
    /* Always `chat`. Live conversation has no review stance and no anchor —
       and a spoken review is a mode nobody has designed, so inventing one here
       by passing a kind through would be deciding it by accident. */
    kind: "chat",
    messages: [],
  };
  const thread: ChatThread = {
    ...base,
    /* The first thing said names the thread, exactly as the first typed
       question does. A spoken opener whose transcription failed leaves the
       default rather than titling the conversation with the empty string. */
    title:
      base.messages.length === 0 && spoken.question.trim() !== ""
        ? titleFrom(spoken.question)
        : base.title,
    updatedAt: at,
    messages: [...base.messages, user, reply],
  };

  return {
    threads: existing
      ? threads.map((t) => (t.id === thread.id ? thread : t))
      : [...threads, thread],
    thread,
    user,
    reply,
  };
}

export async function beginTurn(
  slug: string,
  turn: Turn,
  now: () => string = () => new Date().toISOString(),
): Promise<{ thread: ChatThread; user: ChatMessage; reply: ChatMessage }> {
  let out!: { thread: ChatThread; user: ChatMessage; reply: ChatMessage };
  await update(slug, (threads) => {
    const { threads: next, ...rest } = withTurn(threads, turn, now());
    out = rest;
    return next;
  });
  log("store").info(
    { slug, threadId: out.thread.id, messageId: out.reply.id, turns: out.thread.messages.length },
    "chat turn started",
  );
  return out;
}

/**
 * Write the finished (or failed) answer over the `pending` row.
 *
 * Never appends. The row is already there — `beginTurn` put it there — and
 * appending on completion would leave the pending one behind as a permanent
 * spinner nothing can clear.
 */
export async function finishTurn(
  slug: string,
  threadId: string,
  messageId: string,
  patch: Partial<ChatMessage>,
  now: () => string = () => new Date().toISOString(),
): Promise<ChatThread[]> {
  const next = await update(slug, (threads) =>
    threads.map((t) =>
      t.id !== threadId
        ? t
        : {
            ...t,
            updatedAt: now(),
            messages: t.messages.map((m) =>
              m.id === messageId ? { ...m, ...patch, id: m.id, role: m.role } : m,
            ),
          },
    ),
  );
  /* The reader can see this — the turn shows as failed — so it is not silent to
     them. It is silent to whoever is running the server, who is the one who can
     tell a bad API key from a model that timed out.

     **The stored `error` string is deliberately NOT logged.** This line used to
     carry it as `reason`, on the grounds that it is "the stored error string,
     never the answer" — which is true and is not the point. That string is
     whatever `converse` threw, and one of the things `converse` throws is
     `OpenRouter ${status}: ${detail.slice(0, 400)}` (src/converse.ts) — four
     hundred characters of a provider's response body. A provider that echoes
     the request back in an error puts the reader's question, and the article
     prose sent as context with it, into that string. Redaction could never have
     caught it: it is path-based, and `reason` is not a path anyone would think
     to list.

     Nothing is lost by dropping it. src/converse.ts logs its own failure line
     for every one of these — model, HTTP status, elapsed time, whether the
     deadline fired, how much the reader had already watched arrive — and that
     is what actually distinguishes a bad key from a slow model.

     This is the same bug as the one in src/comments.ts, which was found by
     GPT/Codex and fixed there first; this file was written by copying that one
     and brought the bug back with it. Keep the two in step.

     **The throw site is fixed now (2026-08-26).** src/converse.ts no longer puts
     any of the provider's body in the message — `ProviderRefused` in
     src/ai-call.ts — so the string this line declines to log is safe
     today. It still declines, because a rule that holds only while every call
     site stays careful is not a rule, and because what a reader of this line
     needs is the status and the model, which are already on it. */
  if (patch.status === "error") {
    log("store").warn({ slug, threadId, messageId }, "chat answer failed");
  }
  return next;
}

/**
 * A retry or an edit that the stored conversation will not accept.
 *
 * Its own class so the route can answer 409 rather than 500, because every one
 * of these is a *stale client*, not a broken server: two tabs open on one
 * thread, a Back button, a retry pressed on a turn that a moment ago was the
 * last one. The right answer to all of them is "reload and look again", and a
 * 500 would send whoever is running the server hunting for a bug that is not
 * there.
 */
export class ChatConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatConflict";
  }
}

/**
 * Blank an answer so the model can have another go at the same question.
 *
 * **The row is reused, id and all**, rather than deleted and re-appended. That
 * is the difference between a retry and a new turn, and it is what keeps
 * everything pointing at the answer still pointing at it — the client's
 * optimistic patches, `?thread=`, the `streaming` key the route builds from
 * `slug/threadId/messageId`. A fresh id would have meant a second row appearing
 * under the first, which is precisely the permanent-spinner bug `finishTurn`
 * exists to avoid.
 *
 * **Only the last answer may be retried**, and that restriction is doing real
 * work. Regenerating a turn in the middle leaves every later turn answering a
 * question about words that no longer exist — the conversation reads as a
 * non-sequitur and nothing says why. The products that allow it all pay for it
 * with a message tree and a branch pager; docs/plans/chat-mode.md § What a
 * retry may touch says why we are not buying that for a four-turn conversation
 * in a 400px panel. Retry the last one, or edit the question.
 */
export function withRetry(
  threads: ChatThread[],
  threadId: string,
  messageId: string,
  at: string,
): { threads: ChatThread[]; thread: ChatThread; reply: ChatMessage; user: ChatMessage } {
  const existing = threads.find((t) => t.id === threadId);
  if (!existing) throw new ChatConflict("That conversation is not there any more.");
  const last = existing.messages.at(-1);
  if (!last || last.id !== messageId) {
    throw new ChatConflict("Only the most recent answer can be retried.");
  }
  if (last.role !== "assistant") throw new ChatConflict("That is not an answer.");
  if (last.status === "pending") {
    // The route settles a live stream before it gets here, so reaching this
    // means somebody's client is a step behind — a second tab, a double press.
    throw new ChatConflict("That answer is still arriving.");
  }
  const question = existing.messages.at(-2);
  if (question?.role !== "user") {
    throw new ChatConflict("That answer has no question above it.");
  }
  /* Rebuilt field by field rather than spread-and-overwrite. A spread would
     carry `citations`, `searches`, `model`, `error` and `stopped` from the
     attempt being replaced, and the ones the new answer does not set would
     survive it — a retry that runs no web search would keep the old answer's
     sources, sitting under text that never mentions them. */
  const reply: ChatMessage = {
    id: last.id,
    role: "assistant",
    text: "",
    createdAt: at,
    status: "pending",
    /* **Carried over by name, and it is the one field that is.**
       Everything else the old attempt had is deliberately dropped — that is what
       the note above is about. The stance is different in kind: it is not a
       result of the answer, it is the INSTRUCTION that produced it, and "have
       another go at that" has to mean another go at the same question asked the
       same way.
       If it took the reader's current picker instead, moving the picker and
       then pressing retry would silently rewrite the instruction attached to a
       stored turn — a button that says "have another go" changing what was
       asked. GPT Sol's review of docs/plans/review-mode.md, finding 4. */
    ...(last.stance ? { stance: last.stance } : {}),
  };
  const thread: ChatThread = {
    ...existing,
    updatedAt: at,
    messages: [...existing.messages.slice(0, -1), reply],
  };
  /* The whole message rather than its text, so that all three of `beginTurn`,
     `retryTurn` and `withEdit` hand back the same pair — the question and the
     answer beneath it — and the route can name both in its first frame without
     asking which kind of turn this was. The client needs the question's id to
     edit it later; see `withServerIds` in src/web/useChat.ts. */
  return {
    threads: threads.map((t) => (t.id === thread.id ? thread : t)),
    thread,
    reply,
    user: question,
  };
}

export async function retryTurn(
  slug: string,
  threadId: string,
  messageId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<{ thread: ChatThread; reply: ChatMessage; user: ChatMessage }> {
  let out!: { thread: ChatThread; reply: ChatMessage; user: ChatMessage };
  await update(slug, (threads) => {
    const next = withRetry(threads, threadId, messageId, now());
    out = { thread: next.thread, reply: next.reply, user: next.user };
    return next.threads;
  });
  log("store").info(
    { slug, threadId: out.thread.id, messageId: out.reply.id, turns: out.thread.messages.length },
    "chat answer retried",
  );
  return out;
}

/**
 * Rewrite one of the reader's questions and ask it again.
 *
 * Everything after the edited message is **discarded** — the answer it had, and
 * every turn that followed. There is no branch kept behind a pager. Two
 * reasons, and the second is the one that decided it:
 *
 *  - a hidden branch is the single most complained-about thing in the products
 *    that have one, because a conversation that is still there but not on
 *    screen is indistinguishable from one that was deleted;
 *  - and this panel is four hundred pixels wide beside an article the reader is
 *    supposed to be reading. A branch pager is a second navigation problem in a
 *    column that already has one.
 *
 * So the panel warns before it discards — it says how many turns will go — and
 * that warning is the whole safety mechanism. It is deliberately not a modal:
 * see docs/plans/chat-mode.md § Editing a question.
 *
 * The old text is not kept either. `editedAt` records only *that* it happened,
 * which is what stops a reader reading an answer that no longer matches the
 * question above it and thinking the model wandered.
 */
/**
 * The stance on an assistant row, if it has one.
 *
 * A named function rather than `m?.stance` at the call site because the call
 * site is already a conditional spread and the interesting part — *which* row —
 * would be lost inside it.
 */
function stanceOf(message: ChatMessage | undefined): ReviewStance | undefined {
  return message?.role === "assistant" ? message.stance : undefined;
}

export function withEdit(
  threads: ChatThread[],
  threadId: string,
  messageId: string,
  question: string,
  at: string,
  /**
   * Where the new answer's id comes from. Injectable for the same reason
   * `mintId` and `mintUniqueId` take one (src/ids.ts): the rule below is *which
   * ids are off limits*, and with a real generator that rule can only be tested
   * by hoping a 771-million-to-one collision does not happen — which is a test
   * that passes whether or not the rule is there.
   */
  random?: () => number,
): {
  threads: ChatThread[];
  thread: ChatThread;
  user: ChatMessage;
  reply: ChatMessage;
  discarded: number;
} {
  const existing = threads.find((t) => t.id === threadId);
  if (!existing) throw new ChatConflict("That conversation is not there any more.");
  const index = existing.messages.findIndex((m) => m.id === messageId);
  if (index < 0) throw new ChatConflict("That message is not in this conversation.");
  const target = existing.messages[index];
  if (target?.role !== "user") throw new ChatConflict("Only your own questions can be edited.");
  const user: ChatMessage = { ...target, text: question, editedAt: at };
  const reply: ChatMessage = {
    /* Minted against **every** id in the file, including the ones this edit is
       about to discard.

       Minting against only the survivors would be tidier, and the reason not to
       is a late write landing on a reused id: `finishTurn` finds its row by id
       and nothing else, so a stream still finishing would put a stopped
       half-sentence under a question nobody asked.

       Be exact about how much this buys, because the obvious version of the
       claim is too strong. *In this process* the route already awaits
       `settleThread` before it gets here, so no aborted write can be in flight
       — that path is closed twice over. What is left is the second server on
       the same `data/` directory, which cannot see this one's `streaming` map
       at all; that is the unfixed problem in docs/plans/chat-mode.md § What was
       deliberately not fixed, and this is one of the few places it is cheap to
       be robust against. Note also that the guarantee is only within one call:
       a discarded id leaves the file, so the *next* mint may hand it back. Ids
       are cheap, and this is the narrow win it is rather than a rule. */
    id: mintUniqueId(taken(threads), random),
    role: "assistant",
    text: "",
    createdAt: at,
    status: "pending",
    /* **From the answer being REPLACED, not from the tail of the thread.**
       An edit to question 2 discards turns 3, 4 and 5, which may have had three
       different stances between them; the reader's picker at that moment is
       seeded from turn 5's. Inheriting that would answer a rewritten early
       question in the voice of a later turn that no longer exists.
       `index + 1` is the answer that sat under the question being rewritten. It
       may not exist — a question whose answer was never stored — in which case
       there is nothing to inherit and `balanced` applies downstream. */
    ...(stanceOf(existing.messages[index + 1])
      ? { stance: stanceOf(existing.messages[index + 1]) as ReviewStance }
      : {}),
  };
  const thread: ChatThread = {
    ...existing,
    // The first question names the thread, so rewriting the first question
    // renames it. Rewriting a later one does not — same rule as `beginTurn`.
    title: index === 0 ? titleFrom(question) : existing.title,
    updatedAt: at,
    messages: [...existing.messages.slice(0, index), user, reply],
  };
  return {
    threads: threads.map((t) => (t.id === thread.id ? thread : t)),
    thread,
    user,
    reply,
    discarded: existing.messages.length - index - 1,
  };
}
