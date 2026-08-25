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
import type { ChatMessage, ChatThread } from "./types.js";
import { isSpideryarnId, mintUniqueId } from "./ids.js";
import { errorFields, log } from "./log.js";
import { parseJsonFrom } from "./parse-json.js";

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

/** A slug is a path segment. Anything else is refused rather than sanitised. */
function assertSlug(slug: string): void {
  if (!/^[\w.-]+$/.test(slug) || slug === "." || slug === "..") {
    throw new Error(`Not a valid slug: ${JSON.stringify(slug)}`);
  }
}

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
    return parsed.threads ?? [];
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

export async function createThread(
  slug: string,
  now: () => string = () => new Date().toISOString(),
): Promise<ChatThread> {
  let stored!: ChatThread;
  await update(slug, (threads) => {
    const at = now();
    stored = { id: mintUniqueId(taken(threads)), title: "New chat", createdAt: at, updatedAt: at, messages: [] };
    return [...threads, stored];
  });
  log("store").info({ slug, threadId: stored.id }, "chat thread created");
  return stored;
}

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
export async function beginTurn(
  slug: string,
  { threadId, question }: Turn,
  now: () => string = () => new Date().toISOString(),
): Promise<{ thread: ChatThread; user: ChatMessage; reply: ChatMessage }> {
  let out!: { thread: ChatThread; user: ChatMessage; reply: ChatMessage };
  await update(slug, (threads) => {
    const at = now();
    const ids = taken(threads);
    const existing = threads.find((t) => t.id === threadId);
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
    out = { thread, user, reply };
    return existing ? threads.map((t) => (t.id === thread.id ? thread : t)) : [...threads, thread];
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
     and brought the bug back with it. Keep the two in step. */
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
export async function retryTurn(
  slug: string,
  threadId: string,
  messageId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<{ thread: ChatThread; reply: ChatMessage; question: string }> {
  let out!: { thread: ChatThread; reply: ChatMessage; question: string };
  await update(slug, (threads) => {
    const at = now();
    const existing = threads.find((t) => t.id === threadId);
    if (!existing) throw new ChatConflict("That conversation is not there any more.");
    const last = existing.messages.at(-1);
    if (!last || last.id !== messageId) {
      throw new ChatConflict("Only the most recent answer can be retried.");
    }
    if (last.role !== "assistant") throw new ChatConflict("That is not an answer.");
    const question = existing.messages.at(-2);
    if (!question || question.role !== "user") {
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
    };
    const thread: ChatThread = {
      ...existing,
      updatedAt: at,
      messages: [...existing.messages.slice(0, -1), reply],
    };
    out = { thread, reply, question: question.text };
    return threads.map((t) => (t.id === thread.id ? thread : t));
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
export async function editTurn(
  slug: string,
  threadId: string,
  messageId: string,
  question: string,
  now: () => string = () => new Date().toISOString(),
): Promise<{ thread: ChatThread; user: ChatMessage; reply: ChatMessage; discarded: number }> {
  let out!: { thread: ChatThread; user: ChatMessage; reply: ChatMessage; discarded: number };
  await update(slug, (threads) => {
    const at = now();
    const existing = threads.find((t) => t.id === threadId);
    if (!existing) throw new ChatConflict("That conversation is not there any more.");
    const index = existing.messages.findIndex((m) => m.id === messageId);
    if (index < 0) throw new ChatConflict("That message is not in this conversation.");
    const target = existing.messages[index];
    if (target?.role !== "user") throw new ChatConflict("Only your own questions can be edited.");
    const user: ChatMessage = { ...target, text: question, editedAt: at };
    const reply: ChatMessage = {
      // Minted against the ids that SURVIVE the edit, not against the ones
      // being discarded — an id freed by the truncation is free.
      id: mintUniqueId(taken(threads.map((t) => (t.id === threadId ? { ...t, messages: existing.messages.slice(0, index) } : t)))),
      role: "assistant",
      text: "",
      createdAt: at,
      status: "pending",
    };
    const thread: ChatThread = {
      ...existing,
      // The first question names the thread, so rewriting the first question
      // renames it. Rewriting a later one does not — same rule as `beginTurn`.
      title: index === 0 ? titleFrom(question) : existing.title,
      updatedAt: at,
      messages: [...existing.messages.slice(0, index), user, reply],
    };
    out = { thread, user, reply, discarded: existing.messages.length - index - 1 };
    return threads.map((t) => (t.id === thread.id ? thread : t));
  });
  log("store").info(
    {
      slug,
      threadId: out.thread.id,
      messageId: out.reply.id,
      // The number is the point of the line: an edit is the only thing in this
      // file that destroys stored turns, and this is how many it took.
      discarded: out.discarded,
      turns: out.thread.messages.length,
    },
    "chat question edited",
  );
  return out;
}
