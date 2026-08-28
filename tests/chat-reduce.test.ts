/**
 * **The one gate, watched refusing things.**
 *
 * `src/web/chat/reduce.ts` exists because `useChat.ts` collected twelve
 * concurrency bugs in three days, and two of them were the same bug: a
 * superseded load writing something it was not entitled to write. The first was
 * `loadFailed`, the second was `error` in the `catch` of the same function,
 * found the next day — because the guard had been added to every success path
 * and the failure path was a separate place to remember.
 *
 * So every asynchronous result now carries the id of the operation it belongs
 * to and passes one admission rule, and these tests are that rule seen working:
 * a stale load's **success** and its **failure** refused by the same three
 * lines, and a rename failure that arrives after the reader has moved on unable
 * to say so. Nothing in the repo pins that last one today — `write` in
 * useChat.ts sets `error` from a `catch` with no guard at all.
 *
 * **No React, no jsdom, no fetch.** `tests/chat-arrival-race.test.ts` spins up
 * `createRoot` and `act` to exercise what is nearly a pure function; this is the
 * pure function. Every test here is a state, an event and an assertion.
 *
 * Each transition is also run **twice** against a deep-frozen state whose `Map`
 * and `Set` throw if anything calls `set`, `add`, `delete` or `clear` on them.
 * React invokes an updater twice under `StrictMode`, and this file's ancestor
 * has been bitten by an impure one. `Object.freeze` alone would not catch it:
 * freezing a `Map` does nothing at all to `map.set`.
 */
import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatThread } from "../src/types.js";
import type { ChatEvent, ChatInput, ChatState, OpId } from "../src/web/chat/model.js";
import { asOpId, initialState } from "../src/web/chat/model.js";
import { project } from "../src/web/chat/project.js";
import { reduce } from "../src/web/chat/reduce.js";

const SLUG = "a-piece";

function thread(id: string, title: string, messages: ChatThread["messages"] = []): ChatThread {
  return {
    id,
    kind: "chat",
    title,
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
    messages,
  };
}

const LOAD = asOpId("spya-load01");
const OTHER_LOAD = asOpId("spya-load02");
const RENAME_A = asOpId("spya-name01");
const RENAME_B = asOpId("spya-name02");
const DELETE = asOpId("spya-del001");
/** Not an operation — a cancel's own name for the tombstone it lays. */
const CANCEL = "spya-cancel1";

/**
 * A `Map` or a `Set` that screams if the reducer writes to it.
 *
 * `Object.freeze` is no help here — a frozen `Map` accepts `set` happily — so
 * the mutating methods are replaced with ones that throw. Everything else is
 * bound to the real collection, including `Symbol.iterator`, so
 * `new Map(booby-trapped)` still copies it.
 */
function sealed<T extends object>(collection: T, what: string): T {
  const guarded = new Set(["set", "add", "delete", "clear"]);
  return new Proxy(collection, {
    get(target, prop) {
      if (typeof prop === "string" && guarded.has(prop)) {
        return () => {
          throw new Error(`the reducer called ${what}.${prop}() — it must not mutate its input`);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Frozen all the way down, so an in-place edit throws rather than passing.
 *
 * Sealed **in place** rather than copied, so that a transition which changes
 * nothing can be asserted to hand back the object it was given — the
 * controller's cached projection depends on exactly that.
 */
function seal(state: ChatState): ChatState {
  if (Object.isFrozen(state)) return state;
  for (const t of state.base) {
    for (const m of t.messages) Object.freeze(m);
    Object.freeze(t.messages);
    Object.freeze(t);
  }
  Object.freeze(state.base);
  for (const op of state.operations.values()) Object.freeze(op);
  const mutable = state as {
    operations: ChatState["operations"];
    tombstones: ChatState["tombstones"];
  };
  mutable.operations = sealed(state.operations, "operations");
  mutable.tombstones = sealed(state.tombstones, "tombstones");
  return Object.freeze(state);
}

/**
 * Apply one event twice, and insist the two answers agree.
 *
 * The second run is the point: it is handed the *same* input as the first, so
 * anything the first run wrote into that input shows up as a difference here.
 */
function twice(state: ChatState, event: ChatEvent): ReturnType<typeof reduce> {
  const sealedState = seal(state);
  const sealedEvent = Object.freeze({ ...event }) as ChatEvent;
  const first = reduce(sealedState, sealedEvent);
  const second = reduce(sealedState, sealedEvent);
  expect(spread(second.state), "the same event twice gave two different states").toEqual(
    spread(first.state),
  );
  expect(second.commands, "the same event twice asked for different work").toEqual(first.commands);
  return first;
}

/**
 * The state as something two of can be compared.
 *
 * The `Map` and the `Set` are laid out flat because the booby-trapped ones
 * above are `Proxy` objects, and vitest's deep equality reads a `Set` through
 * its internal slots — which a proxy does not have, so it reports two
 * references to the *same* sealed set as unequal, with "no visual difference".
 */
function spread(state: ChatState): unknown {
  return {
    ...state,
    operations: [...state.operations.entries()],
    tombstones: [...state.tombstones],
  };
}

/** Everything the projection shows, by title. */
function titles(state: ChatState): string[] {
  return project(state).map((t) => t.title);
}

/** A hook that has loaded one conversation and is doing nothing else. */
function loaded(...threads: ChatThread[]): ChatState {
  const started = twice(initialState(SLUG), {
    type: "load.started",
    op: { id: LOAD, kind: "load" },
  }).state;
  return twice(started, { type: "load.succeeded", opId: LOAD, threads }).state;
}

function renaming(state: ChatState, id: OpId, threadId: string, title: string): ChatState {
  return twice(state, { type: "rename.started", op: { id, kind: "rename", threadId, title } })
    .state;
}

const TURN_A = asOpId("spya-turn01");
const TURN_B = asOpId("spya-turn02");
const REPAIR = asOpId("spya-fix001");
const RECOVER = asOpId("spya-rec001");

const AT = "2026-08-27T11:00:00.000Z";

function message(m: Partial<ChatMessage> & { id: string }): ChatMessage {
  return { role: "assistant", text: "", createdAt: AT, status: "pending", ...m };
}

/** One turn's registration, with every field the three shapes share. */
function starting(
  op: Partial<Parameters<typeof turnOp>[0]> & { id: OpId; shape: "send" | "retry" | "edit" },
): Extract<ChatInput, { type: "turn.started" }> {
  return { type: "turn.started", op: turnOp(op), payload: { question: "why?" } };
}

function turnOp(op: {
  id: OpId;
  shape: "send" | "retry" | "edit";
  threadId?: string;
  replyId?: string;
  reply?: ChatMessage;
  question?: ChatMessage | null;
  editing?: string | null;
  opening?: ChatThread | null;
  title?: string | null;
  namesThread?: boolean;
}): Extract<ChatInput, { type: "turn.started" }>["op"] {
  const replyId = op.replyId ?? "a-new";
  return {
    id: op.id,
    kind: "turn",
    shape: op.shape,
    threadId: op.threadId ?? "spya-t1",
    replyId,
    reply: op.reply ?? message({ id: replyId }),
    question: op.question ?? null,
    editing: op.editing ?? null,
    opening: op.opening ?? null,
    title: op.title ?? null,
    namesThread: op.namesThread ?? false,
    at: AT,
    began: false,
    attempt: null,
  };
}

/** An edit of the first question, which renames the conversation with it. */
function editing(threadId: string, title: string): Extract<ChatInput, { type: "turn.started" }> {
  return starting({
    id: TURN_A,
    shape: "edit",
    threadId,
    editing: "q1",
    question: message({ id: "q1", role: "user", text: title, status: "done" }),
    title,
    namesThread: true,
  });
}

/** A conversation with one finished turn in it. */
function conversation(id = "spya-t1", title = "a conversation"): ChatThread {
  return thread(id, title, [
    message({ id: "q1", role: "user", text: "why?", status: "done" }),
    message({ id: "a1", text: "because.", status: "done" }),
  ]);
}

describe("the admission gate", () => {
  /**
   * The case the whole exercise is for. `StrictMode` starts two loads of one
   * article on every mount, and the earlier one can answer last with the older
   * snapshot; production reaches it by leaving an article and coming back.
   */
  it("refuses a superseded load's success", () => {
    const one = twice(initialState(SLUG), {
      type: "load.started",
      op: { id: LOAD, kind: "load" },
    }).state;
    const two = twice(one, { type: "load.started", op: { id: OTHER_LOAD, kind: "load" } }).state;

    const stale = twice(two, {
      type: "load.succeeded",
      opId: LOAD,
      threads: [thread("spya-t1", "the older snapshot")],
    });

    expect(titles(stale.state)).toEqual([]);
    expect(stale.state.loadPhase).toBe("loading");
    // Nothing happened, and the same object says so — the controller's cached
    // projection depends on it.
    expect(stale.state).toBe(two);

    // The premise: the current load is admitted by the same code.
    const fresh = twice(two, {
      type: "load.succeeded",
      opId: OTHER_LOAD,
      threads: [thread("spya-t1", "the current one")],
    });
    expect(titles(fresh.state)).toEqual(["the current one"]);
  });

  /**
   * And the failure path, which is where this file's ancestor was bitten
   * twice — the guard was on the success path and the `catch` was a separate
   * place to remember. Here it is the same three lines.
   */
  it("refuses a superseded load's failure", () => {
    const one = twice(initialState(SLUG), {
      type: "load.started",
      op: { id: LOAD, kind: "load" },
    }).state;
    const two = twice(one, { type: "load.started", op: { id: OTHER_LOAD, kind: "load" } }).state;
    const worked = twice(two, {
      type: "load.succeeded",
      opId: OTHER_LOAD,
      threads: [thread("spya-t1", "the current one")],
    }).state;

    const late = twice(worked, {
      type: "load.failed",
      opId: LOAD,
      error: "the abandoned one, failing late",
    });

    expect(late.state.error).toBeNull();
    expect(late.state.loadPhase).toBe("ready");
    expect(titles(late.state)).toEqual(["the current one"]);
    expect(late.state).toBe(worked);
  });

  /* The control for the two above: a load that is still the current one says
     both of its answers. A gate that refused everything would pass every test
     in this describe block without it. */
  it("admits the load that is still the one being waited for", () => {
    const started = twice(initialState(SLUG), {
      type: "load.started",
      op: { id: LOAD, kind: "load" },
    }).state;
    const failed = twice(started, { type: "load.failed", opId: LOAD, error: "the network" });
    expect(failed.state.error).toBe("the network");
    /* Still counts as having asked: `loaded` means "we have asked", and
       `loadFailed` is the difference. */
    expect(failed.state.loadPhase).toBe("failed");
  });

  /**
   * **A late rename failure, after the reader has moved on.**
   *
   * Nothing pins this today: `write` in useChat.ts sets `error` from a `catch`
   * with no guard of any kind, so a rename that fails after the reader has left
   * the article puts "Couldn't rename that conversation" over the next one.
   * Moving on is a new controller, which is a state with no operations in it —
   * and the same gate refuses the answer.
   */
  it("refuses a rename that fails after the reader has moved on", () => {
    const before = renaming(loaded(thread("spya-t1", "as it was")), RENAME_A, "spya-t1", "renamed");
    const elsewhere = initialState("another-piece");

    const late = twice(elsewhere, {
      type: "rename.failed",
      opId: RENAME_A,
      error: "the network is down",
    });

    expect(late.state.error).toBeNull();
    expect(late.state).toBe(elsewhere);

    /* The premise, on the state that *is* still waiting for it: the message is
       written, and it stays on screen un-reverted, which is what a failed
       rename does today and must go on doing. */
    const heard = twice(before, {
      type: "rename.failed",
      opId: RENAME_A,
      error: "the network is down",
    });
    expect(heard.state.error).toBe("Couldn't rename that conversation: the network is down");
    expect(titles(heard.state)).toEqual(["renamed"]);
  });

  it("refuses a result aimed at an operation of another kind", () => {
    const state = renaming(loaded(thread("spya-t1", "as it was")), RENAME_A, "spya-t1", "renamed");
    /* Ids are minted per article by one `mintId()` and are not promised to be
       unique across anything; the kind check is what stops a delete's answer
       being admitted against a rename that happens to share one. */
    const crossed = twice(state, { type: "delete.failed", opId: RENAME_A, error: "no" });
    expect(crossed.state).toBe(state);
  });
});

describe("two renames of one conversation", () => {
  /**
   * **Reverse order, which is the case supersession exists for.**
   *
   * Commit B, retire it, and A — still live, still older — goes on projecting,
   * so the reader watches the title they replaced come back. GPT Sol found this
   * in the plan rather than in the code, 2026-08-28.
   */
  it("leaves the newer title on screen when the older one answers last", () => {
    const start = loaded(thread("spya-t1", "as it was"));
    const first = renaming(start, RENAME_A, "spya-t1", "first name");
    const second = renaming(first, RENAME_B, "spya-t1", "second name");

    /* The older one stopped drawing the moment the newer one was registered,
       not when it answered. */
    expect(titles(second)).toEqual(["second name"]);

    const b = twice(second, { type: "rename.succeeded", opId: RENAME_B }).state;
    expect(titles(b)).toEqual(["second name"]);

    const a = twice(b, { type: "rename.succeeded", opId: RENAME_A }).state;
    expect(titles(a)).toEqual(["second name"]);
    expect(a.operations.size).toBe(0);
  });

  /**
   * **A rename that was replaced says nothing when it fails.**
   *
   * It is still admitted — the gate finds it, because it is still in the map —
   * but the reader is looking at the newer title, and a newer rename that
   * succeeded or is still in flight must not be reported as failed by the one
   * it replaced. This asserted the opposite until GPT Sol's review of stage 1
   * caught it, 2026-08-28.
   */
  it("says nothing when the rename that failed had already been replaced", () => {
    const start = loaded(thread("spya-t1", "as it was"));
    const first = renaming(start, RENAME_A, "spya-t1", "first name");
    const second = renaming(first, RENAME_B, "spya-t1", "second name");

    const a = twice(second, { type: "rename.failed", opId: RENAME_A, error: "the network" }).state;

    expect(a.error).toBeNull();
    expect(titles(a)).toEqual(["second name"]);

    /* And the one the reader is actually waiting on still speaks. Without this
       the test above would pass on a reducer that never reported anything. */
    const b = twice(a, { type: "rename.failed", opId: RENAME_B, error: "the network" }).state;
    expect(b.error).toBe("Couldn't rename that conversation: the network");
  });

  it("keeps the title when a rename succeeds and the operation retires", () => {
    const start = loaded(thread("spya-t1", "as it was"));
    const renamed = renaming(start, RENAME_A, "spya-t1", "the new name");
    /* In `base` from the moment the reader asked, not drawn by the operation —
       see the note on `rename.started`. */
    expect(renamed.base.map((t) => t.title)).toEqual(["the new name"]);

    const done = twice(renamed, { type: "rename.succeeded", opId: RENAME_A }).state;
    expect(done.operations.size).toBe(0);
    expect(titles(done)).toEqual(["the new name"]);
  });

  /**
   * **The regression, at the reducer's own level.**
   *
   * An edit of the first question renames the conversation — `editTurn` on the
   * server says so. So this is the sequence in
   * tests/chat-title-ownership.test.ts with React taken out of it: rename, then
   * an edit carrying another title, then the rename answering. The last writer
   * must win, and neither operation is a writer once it is registered.
   */
  it("does not put a rename's title back over a later edit's", () => {
    const start = loaded(thread("spya-t1", "as it was"));
    const renamed = renaming(start, RENAME_A, "spya-t1", "renamed from the list");
    const edited = twice(renamed, editing("spya-t1", "the question, rewritten")).state;
    expect(titles(edited)).toEqual(["the question, rewritten"]);

    const done = twice(edited, { type: "rename.succeeded", opId: RENAME_A }).state;
    expect(titles(done)).toEqual(["the question, rewritten"]);

    /* And the failure path, which is the one that had two ways of being wrong:
       it committed the title *and* reported an error. */
    const failed = twice(edited, {
      type: "rename.failed",
      opId: RENAME_A,
      error: "the network",
    }).state;
    expect(titles(failed)).toEqual(["the question, rewritten"]);
    expect(failed.error).toBe("Couldn't rename that conversation: the network");
  });
});

describe("deleting a conversation", () => {
  it("hides it before the request leaves, and supersedes a rename of it", () => {
    const start = loaded(thread("spya-t1", "as it was"), thread("spya-t2", "another"));
    const renamed = renaming(start, RENAME_A, "spya-t1", "renamed");
    const removed = twice(renamed, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "spya-t1" },
    });

    expect(titles(removed.state)).toEqual(["another"]);
    expect(removed.commands).toEqual([
      { type: "delete", opId: DELETE, slug: SLUG, threadId: "spya-t1" },
    ]);

    /* A refused rename now has nothing to draw either — the conversation is
       gone and a title over a tombstone is not a thing. */
    const failed = twice(removed.state, {
      type: "rename.failed",
      opId: RENAME_A,
      error: "the network",
    }).state;
    expect(titles(failed)).toEqual(["another"]);
  });

  it("does not put it back when the DELETE fails, and says so", () => {
    const start = loaded(thread("spya-t1", "as it was"));
    const removed = twice(start, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "spya-t1" },
    }).state;

    const failed = twice(removed, { type: "delete.failed", opId: DELETE, error: "a 500" }).state;

    expect(titles(failed)).toEqual([]);
    expect(failed.error).toBe("Couldn't delete that conversation: a 500");
  });

  it("keeps a deleted conversation out of a list that still has it", () => {
    const started = twice(initialState(SLUG), {
      type: "load.started",
      op: { id: LOAD, kind: "load" },
    }).state;
    const removed = twice(started, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "spya-t1" },
    }).state;

    /* The server heard about this conversation before the delete, so a list
       fetched earlier still has it. Deletions win over every projection. */
    const arrived = twice(removed, {
      type: "load.succeeded",
      opId: LOAD,
      threads: [thread("spya-t1", "deleted while the fetch was out"), thread("spya-t2", "kept")],
    }).state;

    expect(titles(arrived)).toEqual(["kept"]);
  });

  it("puts a cancelled conversation back when the server refuses the cancel", () => {
    const start = loaded(thread("spya-t1", "as it was"));
    const cancelled = twice(start, { type: "tombstone.added", threadId: "spya-t1", by: CANCEL }).state;
    expect(titles(cancelled)).toEqual([]);

    /* The tombstone is the whole of the optimistic removal — the conversation
       never left `base` — so removing it is the rollback, and there is no copy
       to keep anywhere. That is what let the `latest` ref go. */
    const back = twice(cancelled, { type: "tombstone.removed", threadId: "spya-t1", by: CANCEL }).state;
    expect(titles(back)).toEqual(["as it was"]);
  });
});

describe("the local edits", () => {
  it("begins and discards a conversation without asking anybody", () => {
    const start = loaded();
    const begun = twice(start, { type: "thread.begun", thread: thread("spya-new", "New chat") });
    expect(begun.commands).toEqual([]);
    expect(titles(begun.state)).toEqual(["New chat"]);

    const gone = twice(begun.state, { type: "thread.discarded", threadId: "spya-new" }).state;
    expect(titles(gone)).toEqual([]);
  });

  it("will not discard a conversation somebody has said something in", () => {
    const said = thread("spya-t1", "a real one", [
      { id: "m1", role: "user", text: "why?", createdAt: "2026-08-27T10:00:00.000Z", status: "done" },
    ]);
    const start = loaded(said);
    const after = twice(start, { type: "thread.discarded", threadId: "spya-t1" });
    expect(after.state).toBe(start);
    expect(titles(after.state)).toEqual(["a real one"]);
  });
});


/**
 * **The turn, which is what stage 2 of docs/plans/chat-operation-model.md is
 * for.** Four of these are the tests that plan names as having to exist before
 * the stage ships; the rest are the transitions they lean on.
 */
describe("a turn", () => {
  /** Everything on screen in the one conversation, by message id. */
  function rows(state: ChatState, id = "spya-t1"): string[] {
    return project(state).find((t) => t.id === id)?.messages.map((m) => m.id) ?? [];
  }

  /** And what the answer row currently says. */
  function answer(state: ChatState, replyId: string, id = "spya-t1"): ChatMessage | undefined {
    return project(state)
      .find((t) => t.id === id)
      ?.messages.find((m) => m.id === replyId);
  }

  function sending(op: OpId, replyId: string, questionId: string) {
    return starting({
      id: op,
      shape: "send",
      replyId,
      question: message({ id: questionId, role: "user", text: "and?", status: "done" }),
    });
  }

  it("puts a send's two rows in `base`, and accumulates the answer on the operation", () => {
    const start = loaded(conversation());
    const sent = twice(start, sending(TURN_A, "a-new", "q-new"));
    expect(sent.commands).toEqual([
      { type: "turn", opId: TURN_A, slug: SLUG, threadId: "spya-t1", payload: { question: "why?" } },
    ]);
    /* **In `base`, not drawn**, and that is the rule rather than an
       optimisation: nothing withdraws the reader's own words, `mergedArrival`
       has to be able to see the conversation, and two sends keep the reader's
       order however they finish. */
    expect(sent.state.base[0]?.messages.map((m) => m.id)).toEqual(["q1", "a1", "q-new", "a-new"]);

    const streaming = twice(sent.state, { type: "turn.delta", opId: TURN_A, text: "Because " });
    expect(answer(streaming.state, "a-new")?.text).toBe("Because ");
    /* The words are on the operation, not written down: `base` is untouched
       until the turn ends. Two deltas in one tick would otherwise each append to
       the same stale copy of the row. */
    expect(streaming.state.base[0]?.messages.at(-1)?.text).toBe("");

    const more = twice(streaming.state, { type: "turn.delta", opId: TURN_A, text: "of that." });
    expect(answer(more.state, "a-new")?.text).toBe("Because of that.");

    const finished = twice(more.state, {
      type: "turn.done",
      opId: TURN_A,
      done: { text: "Because of that.", citations: [], searches: 0, model: "m" },
    });
    expect(finished.state.operations.size).toBe(0);
    expect(finished.state.base[0]?.messages.at(-1)).toMatchObject({
      id: "a-new",
      text: "Because of that.",
      status: "done",
    });
    expect(answer(finished.state, "a-new")?.status).toBe("done");
  });

  /**
   * **All three ids in one transition**, which is the shape that shipped once
   * half-done and surfaced weeks later as "That message is not in this
   * conversation." — the answer's id was swapped and the question's was not.
   */
  it("takes the server's names for the thread, the question and the answer at once", () => {
    const start = loaded();
    const sent = twice(
      start,
      starting({
        id: TURN_A,
        shape: "send",
        threadId: "guess-thread",
        replyId: "guess-a",
        question: message({ id: "guess-q", role: "user", text: "why?", status: "done" }),
        opening: thread("guess-thread", "why?"),
        namesThread: true,
      }),
    );
    expect(rows(sent.state, "guess-thread")).toEqual(["guess-q", "guess-a"]);

    const named = twice(sent.state, {
      type: "turn.began",
      opId: TURN_A,
      begun: {
        threadId: "spya-real1",
        title: "why? — the server's cut",
        messageId: "srv-a",
        questionId: "srv-q",
        attempt: "att-1",
      },
    });
    const shown = project(named.state);
    expect(shown.map((t) => t.id)).toEqual(["spya-real1"]);
    expect(shown[0]?.title).toBe("why? — the server's cut");
    expect(shown[0]?.messages.map((m) => m.id)).toEqual(["srv-q", "srv-a"]);
    // Nothing is left holding an invented name, on the operation either.
    const op = named.state.operations.get(TURN_A);
    expect(op).toMatchObject({ kind: "turn", threadId: "spya-real1", replyId: "srv-a", began: true });
    /* And the one command it asks for is what tells the panel to move
       `?thread=`, and what lets a waiting stop or cancel finally be sent. */
    expect(named.commands).toEqual([
      {
        type: "named",
        opId: TURN_A,
        wasThreadId: "guess-thread",
        wasReplyId: "guess-a",
        threadId: "spya-real1",
        replyId: "srv-a",
        attempt: "att-1",
      },
    ]);
  });

  /**
   * **The payoff.** An edit destroys — it rewrites a question and discards every
   * turn under it — and the discard is something the operation *draws*, so
   * refusing it is dropping one entry from a map. The turns come back because
   * they never left.
   */
  it("draws an edit's discard, and gives it all back when the server refuses", () => {
    const long = thread("spya-t1", "a conversation", [
      message({ id: "q1", role: "user", text: "first", status: "done" }),
      message({ id: "a1", text: "one", status: "done" }),
      message({ id: "q2", role: "user", text: "second", status: "done" }),
      message({ id: "a2", text: "two", status: "done" }),
    ]);
    const start = loaded(long);
    const edited = twice(
      start,
      starting({
        id: TURN_A,
        shape: "edit",
        editing: "q1",
        replyId: "a-new",
        question: message({ id: "q1", role: "user", text: "first, rewritten", status: "done" }),
        title: "first, rewritten",
        namesThread: true,
      }),
    );
    expect(rows(edited.state)).toEqual(["q1", "a-new"]);
    // Nothing was taken away: `base` still has every turn.
    expect(edited.state.base[0]?.messages.map((m) => m.id)).toEqual(["q1", "a1", "q2", "a2"]);

    const refused = twice(edited.state, {
      type: "turn.refused",
      opId: TURN_A,
      error: "Someone else has moved this on.",
      repair: { id: REPAIR },
    });
    /* Dropping the operation is the whole of putting it back — no fetch, no
       merge rule, no timing argument. */
    expect(rows(refused.state)).toEqual(["q1", "a1", "q2", "a2"]);
    expect(refused.state.error).toBe("Someone else has moved this on.");
    /* **And the repair is registered in the same transition**, because they are
       one decision. Split apart, there is a moment where neither is true and
       the repair's answer arrives with nothing to admit it. */
    expect(refused.commands).toEqual([
      { type: "repair", opId: REPAIR, slug: SLUG, threadId: "spya-t1" },
    ]);
    expect(refused.state.operations.get(REPAIR)).toMatchObject({ kind: "repair" });
  });

  it("gives a refused retry back the answer it had blanked", () => {
    const start = loaded(conversation());
    const retried = twice(
      start,
      starting({
        id: TURN_A,
        shape: "retry",
        replyId: "a1",
        reply: message({ id: "a1" }),
      }),
    );
    expect(answer(retried.state, "a1")).toMatchObject({ text: "", status: "pending" });
    expect(retried.state.base[0]?.messages.at(-1)).toMatchObject({ text: "because.", status: "done" });

    const refused = twice(retried.state, {
      type: "turn.refused",
      opId: TURN_A,
      error: "no",
      repair: { id: REPAIR },
    }).state;
    expect(answer(refused, "a1")).toMatchObject({ text: "because.", status: "done" });
  });

  /** The gate, on the path stage 2 added. A repair nobody registered is nobody's. */
  it("refuses a repair's answer that belongs to no operation", () => {
    const start = loaded(conversation());
    const stale = twice(start, {
      type: "repair.succeeded",
      opId: REPAIR,
      thread: thread("spya-t1", "an older copy"),
    });
    expect(stale.state).toBe(start);
  });

  /**
   * The argument is `refreshThread`'s own and it is about age rather than
   * tidiness: anything a turn is writing into this conversation is newer than
   * the snapshot the server just answered with.
   */
  it("does not land a repair over a conversation another turn is still writing into", () => {
    const start = loaded(conversation());
    const sent = twice(start, sending(TURN_B, "b-new", "q-new")).state;
    const edited = twice(
      sent,
      starting({ id: TURN_A, shape: "edit", editing: "q1", replyId: "a-new" }),
    ).state;
    const refused = twice(edited, {
      type: "turn.refused",
      opId: TURN_A,
      error: "no",
      repair: { id: REPAIR },
    }).state;

    const repaired = twice(refused, {
      type: "repair.succeeded",
      opId: REPAIR,
      thread: thread("spya-t1", "the server's older copy"),
    }).state;
    /* The server's older copy is not written down, and the other send's rows
       are still on screen. */
    expect(titles(repaired)).toEqual(["a conversation"]);
    expect(rows(repaired)).toContain("b-new");
    expect(repaired.operations.has(REPAIR)).toBe(false);
  });

  /**
   * **Exactly one recovery writer**, which is one of the four the plan names.
   *
   * Two places want to start one for the same row: the scan of what is on
   * screen, which runs on every render and twice under `StrictMode`, and the
   * turn handing its own row over as it retires.
   */
  it("hands a disconnected row to one recovery, and refuses a second for it", () => {
    const start = loaded(conversation());
    const sent = twice(start, sending(TURN_A, "a-new", "q-new")).state;
    const named = twice(sent, {
      type: "turn.began",
      opId: TURN_A,
      begun: { threadId: "spya-t1", title: "a conversation", messageId: "a-new", attempt: "att-1" },
    }).state;
    const half = twice(named, { type: "turn.delta", opId: TURN_A, text: "Half an " }).state;

    const lost = twice(half, {
      type: "turn.disconnected",
      opId: TURN_A,
      error: "the stream went quiet",
      recovery: { id: RECOVER, until: 1_000 },
    });
    // The turn is gone and its row is written down as it stood — still pending,
    // with the words that did arrive.
    expect(lost.state.operations.has(TURN_A)).toBe(false);
    expect(lost.state.base[0]?.messages.at(-1)).toMatchObject({
      id: "a-new",
      text: "Half an ",
      status: "pending",
    });
    expect(lost.commands).toEqual([
      {
        type: "recover",
        opId: RECOVER,
        slug: SLUG,
        threadId: "spya-t1",
        messageId: "a-new",
        until: 1_000,
      },
    ]);
    // And the attempt went with the row, so a stop pressed during the recovery
    // still names the answer the reader was watching.
    expect(lost.state.operations.get(RECOVER)).toMatchObject({ attempt: "att-1" });

    const again = twice(lost.state, {
      type: "recovery.started",
      op: {
        id: OTHER_LOAD,
        kind: "recovery",
        threadId: "spya-t1",
        messageId: "a-new",
        until: 2_000,
        attempt: null,
      },
    });
    expect(again.state, "a second recovery was started for one row").toBe(lost.state);
    expect(again.commands).toEqual([]);
  });

  /**
   * Until the `begin` frame the only name the row has is one this client
   * invented, and no amount of asking the server will find it. That branch used
   * to fall through with the rest, and the watcher then spent two and a half
   * minutes politely asking about an invented id.
   */
  it("fails a turn the server never named rather than going looking for it", () => {
    const start = loaded(conversation());
    const sent = twice(start, sending(TURN_A, "a-new", "q-new")).state;
    const lost = twice(sent, {
      type: "turn.disconnected",
      opId: TURN_A,
      error: "the connection ended early",
      recovery: { id: RECOVER, until: 1_000 },
    });
    expect(lost.commands).toEqual([]);
    expect(lost.state.operations.size).toBe(0);
    expect(lost.state.base[0]?.messages.at(-1)).toMatchObject({
      status: "error",
      error: "the connection ended early",
    });
  });

  /**
   * **Two operations in one conversation, completing in reverse order.** Testing
   * only concurrent operations in *different* conversations would skip the hard
   * case, and this is the one drawing the rows rather than writing them would
   * get wrong: the second to finish would land first.
   */
  it("keeps two sends in the reader's order however they finish", () => {
    const start = loaded(conversation());
    const first = twice(start, sending(TURN_A, "a-one", "q-one")).state;
    const second = twice(first, sending(TURN_B, "a-two", "q-two")).state;
    expect(rows(second)).toEqual(["q1", "a1", "q-one", "a-one", "q-two", "a-two"]);

    // The second one answers first.
    const later = twice(second, {
      type: "turn.done",
      opId: TURN_B,
      done: { text: "the second answer", citations: [], searches: 0, model: "m" },
    }).state;
    const earlier = twice(later, {
      type: "turn.done",
      opId: TURN_A,
      done: { text: "the first answer", citations: [], searches: 0, model: "m" },
    }).state;

    expect(rows(earlier)).toEqual(["q1", "a1", "q-one", "a-one", "q-two", "a-two"]);
    expect(answer(earlier, "a-one")?.text).toBe("the first answer");
    expect(answer(earlier, "a-two")?.text).toBe("the second answer");
  });

  it("will not discard a conversation a turn is drawing into", () => {
    const start = loaded(thread("spya-t1", "New chat"));
    const edited = twice(
      start,
      starting({ id: TURN_A, shape: "retry", replyId: "a1" }),
    ).state;
    const after = twice(edited, { type: "thread.discarded", threadId: "spya-t1" });
    expect(after.state).toBe(edited);
  });
});

describe("a superseded operation has nothing left to write", () => {
  /**
   * Supersession stops an operation *drawing* the moment the newer one is
   * registered. These two are the other half of that, and they are here because
   * a probe found nothing else reaching them: a delete supersedes everything for
   * its conversation, and the answers those operations were waiting on can still
   * arrive afterwards. Today the tombstone hides whatever they write, so no
   * reader can see the difference — which is exactly the argument that stops
   * being true the first time something lifts a tombstone it did not lay.
   */
  it("does not let a recovery adopt an answer for a conversation that has been deleted", () => {
    const start = loaded(conversation());
    const looking = twice(start, {
      type: "recovery.started",
      op: {
        id: RECOVER,
        kind: "recovery",
        threadId: "spya-t1",
        messageId: "a1",
        until: 1_000,
        attempt: null,
      },
    }).state;
    const removed = twice(looking, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "spya-t1" },
    }).state;

    const found = twice(removed, {
      type: "recovery.found",
      opId: RECOVER,
      message: message({ id: "a1", text: "the answer that landed too late", status: "done" }),
    }).state;
    expect(found.operations.has(RECOVER)).toBe(false);
    expect(found.base[0]?.messages.at(-1)?.text).toBe("because.");

    const gaveUp = twice(removed, {
      type: "recovery.givenUp",
      opId: RECOVER,
      error: "[ai-cut-off]",
    }).state;
    expect(gaveUp.base[0]?.messages.at(-1)?.status).toBe("done");
  });

  it("does not let a repair write a conversation that has been deleted", () => {
    const start = loaded(conversation());
    const edited = twice(
      start,
      starting({ id: TURN_A, shape: "edit", editing: "q1", replyId: "a-new" }),
    ).state;
    const refused = twice(edited, {
      type: "turn.refused",
      opId: TURN_A,
      error: "no",
      repair: { id: REPAIR },
    }).state;
    const removed = twice(refused, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "spya-t1" },
    }).state;

    const repaired = twice(removed, {
      type: "repair.succeeded",
      opId: REPAIR,
      thread: thread("spya-t1", "the server's copy"),
    }).state;
    expect(repaired.operations.has(REPAIR)).toBe(false);
    expect(titles({ ...repaired, tombstones: new Map() })).toEqual(["a conversation"]);
  });
});

describe("who may lift a tombstone", () => {
  const OTHER_CANCEL = "spya-cancel2";

  /**
   * cancel → delete → the cancel's failure. The refusal must not take the
   * delete's tombstone off with it: deletions win over every projection, and
   * here one used to lose to an unrelated request failing.
   */
  it("does not let a refused cancel lift a delete's", () => {
    const start = loaded(conversation());
    const cancelled = twice(start, {
      type: "tombstone.added",
      threadId: "spya-t1",
      by: CANCEL,
    }).state;
    const removed = twice(cancelled, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "spya-t1" },
    }).state;
    expect(titles(removed)).toEqual([]);

    const refused = twice(removed, {
      type: "tombstone.removed",
      threadId: "spya-t1",
      by: CANCEL,
    });
    expect(refused.state, "a deleted conversation came back").toBe(removed);
    expect(titles(refused.state)).toEqual([]);
  });

  /** And the other order, which is where the delete arrives on top. */
  it("does not let a cancel that arrived after a delete lift it either", () => {
    const start = loaded(conversation());
    const removed = twice(start, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "spya-t1" },
    }).state;
    const cancelled = twice(removed, {
      type: "tombstone.added",
      threadId: "spya-t1",
      by: CANCEL,
    }).state;
    const refused = twice(cancelled, {
      type: "tombstone.removed",
      threadId: "spya-t1",
      by: CANCEL,
    }).state;
    expect(titles(refused)).toEqual([]);
  });

  /**
   * **And nothing lifts a delete's, not even something carrying its own name.**
   *
   * The rule the two tests above rest on, stated on its own: a deletion wins
   * over every projection, so its tombstone is `final` and the owner check is
   * not the only thing standing between a deleted conversation and the screen.
   * Nothing in the hook sends this event today — a probe found the flag
   * unreachable through the code — which is the reason to pin the rule here
   * rather than leave it to be rediscovered.
   */
  it("refuses to lift a delete's tombstone even under the delete's own name", () => {
    const start = loaded(conversation());
    const removed = twice(start, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "spya-t1" },
    }).state;
    const after = twice(removed, { type: "tombstone.removed", threadId: "spya-t1", by: DELETE });
    expect(after.state).toBe(removed);
    expect(titles(after.state)).toEqual([]);
  });

  /** And somebody else's cancel cannot lift this one's, which is the same rule. */
  it("takes only its own off", () => {
    const start = loaded(conversation());
    const cancelled = twice(start, {
      type: "tombstone.added",
      threadId: "spya-t1",
      by: CANCEL,
    }).state;
    expect(twice(cancelled, {
      type: "tombstone.removed",
      threadId: "spya-t1",
      by: OTHER_CANCEL,
    }).state).toBe(cancelled);
    expect(titles(twice(cancelled, {
      type: "tombstone.removed",
      threadId: "spya-t1",
      by: CANCEL,
    }).state)).toEqual(["a conversation"]);
  });
});

describe("the projection", () => {
  it("hands back the same array when nothing is in flight", () => {
    const start = loaded(thread("spya-t1", "one"), thread("spya-t2", "two"));
    expect(project(start)).toBe(start.base);
  });

  /**
   * A chat delta re-renders the conversation band and the article is underneath
   * it, so changing one thread must not rebuild every thread and message.
   */
  it("rebuilds only the conversation an operation touches", () => {
    const start = loaded(thread("spya-t1", "one"), thread("spya-t2", "two"));
    const renamed = renaming(start, RENAME_A, "spya-t1", "one, renamed");
    const before = project(start);
    const after = project(renamed);

    expect(after[1]).toBe(before[1]);
    expect(after[0]).not.toBe(before[0]);
    expect(after[0]?.messages).toBe(before[0]?.messages);
  });

  /**
   * **A delta rebuilds one message in one thread**, which is a requirement
   * rather than an optimisation: a chat delta re-renders the conversation band
   * and the article is underneath it.
   */
  it("rebuilds one message in one thread on every word of an answer", () => {
    const long = thread("spya-t1", "a conversation", [
      { id: "q1", role: "user", text: "why?", createdAt: AT, status: "done" },
      { id: "a1", role: "assistant", text: "because.", createdAt: AT, status: "done" },
      { id: "q2", role: "user", text: "and?", createdAt: AT, status: "done" },
      { id: "a2", role: "assistant", text: "", createdAt: AT, status: "pending" },
    ]);
    const start = loaded(long, thread("spya-t2", "another"));
    const sending = twice(start, {
      type: "turn.started",
      op: turnOp({ id: TURN_A, shape: "retry", replyId: "a2" }),
      payload: {},
    }).state;
    const before = project(sending);
    const after = project(
      twice(sending, { type: "turn.delta", opId: TURN_A, text: "Because " }).state,
    );

    // The other conversation, and every message in this one but the answer.
    expect(after[1]).toBe(before[1]);
    expect(after[0]).not.toBe(before[0]);
    for (const i of [0, 1, 2]) expect(after[0]?.messages[i]).toBe(before[0]?.messages[i]);
    expect(after[0]?.messages[3]?.text).toBe("Because ");
  });

  it("draws nothing for a conversation that is not there", () => {
    const start = loaded(thread("spya-t1", "one"));
    const renamed = renaming(start, RENAME_A, "spya-missing", "a name for nothing");
    expect(project(renamed)).toBe(project(start));
  });
});

describe("the commands", () => {
  it("asks for exactly one request per operation, carrying its id", () => {
    const started = twice(initialState(SLUG), {
      type: "load.started",
      op: { id: LOAD, kind: "load" },
    });
    expect(started.commands).toEqual([{ type: "load", opId: LOAD, slug: SLUG }]);

    const renamed = twice(started.state, {
      type: "rename.started",
      op: { id: RENAME_A, kind: "rename", threadId: "spya-t1", title: "a name" },
    });
    expect(renamed.commands).toEqual([
      { type: "rename", opId: RENAME_A, slug: SLUG, threadId: "spya-t1", title: "a name" },
    ]);

    /* And a result asks for nothing. Every command in this stage is started by
       the reader or by the mount, which is what makes the gate's job the only
       job. */
    expect(twice(renamed.state, { type: "rename.succeeded", opId: RENAME_A }).commands).toEqual([]);
  });
});
