/**
 * `base`, minus the tombstoned, with every live operation laid over it.
 *
 * `threads` — the array the panel renders — is **derived**. It is never
 * assigned, which is the whole difference between this and the eleven
 * `setThreads` call sites it replaces: each of those had its own merge rule and
 * its own idea of who was entitled to write.
 *
 * The payoff is the 409 path, and it lands in stage 2. An edit destroys — it
 * rewrites a question and discards every turn under it — and today that is
 * performed on screen, so a refusal can only be undone by re-fetching the
 * conversation and hoping nothing else was happening in it. As a projection the
 * discard is something the *operation* does, and refusing it is dropping one
 * entry from a map: the discarded turns come back because they never left, and
 * any other conversation with a send running in it re-projects untouched.
 *
 * In stage 1 only rename draws anything. The rest are here so that the shape is
 * the plan's and stage 2 fills them in rather than re-deciding.
 */
import type { ChatThread } from "../../types.js";
import type { ChatState, Operation } from "./model.js";

/**
 * Lay one operation over the list.
 *
 * **Structural sharing is a requirement, not an optimisation.** A chat delta
 * re-renders the conversation band and the article is underneath it, so
 * changing one thread must not rebuild every thread and every message. Each
 * branch either hands back the array it was given or rebuilds exactly the one
 * thread it touches, leaving every other thread — and the touched thread's
 * `messages` array — at the same reference.
 */
function draw(threads: readonly ChatThread[], op: Operation): readonly ChatThread[] {
  switch (op.kind) {
    case "rename": {
      const found = threads.find((t) => t.id === op.threadId);
      if (!found || found.title === op.title) return threads;
      return threads.map((t) => (t === found ? { ...t, title: op.title } : t));
    }
    /* The load writes through `base` when it is admitted rather than drawing
       while it is in flight: what it has to say is the server's list, and until
       it answers it has nothing. */
    case "load":
    /* A delete draws by its tombstone, which is in the state and is filtered
       out below — deletions have to win over every projection, including ones
       registered after them. */
    case "delete":
    /* Stage 2's, all three. A turn projects its pending row and the words
       accumulating in it; a recovery projects the answer it went looking for; a
       repair projects nothing and commits when it lands. */
    case "turn":
    case "recovery":
    case "repair":
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
