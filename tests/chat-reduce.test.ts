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
import type { ChatInput, ChatState, OpId } from "../src/web/chat/model.js";
import { asOpId, initialState } from "../src/web/chat/model.js";
import { project } from "../src/web/chat/project.js";
/* The purity harness lives in a helper because tests/chat-invariants.test.ts
   needs the same one, and a `seal`/`twice` pair that exists twice is a pair one
   of whose copies quietly stops being run. */
import { twice } from "./helpers/chat-reduce.js";

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
/**
 * A cancel registered under the **delete's own id**, which nothing real can do —
 * `mintId()` gives every operation its own. It is how the `final` flag gets
 * probed at all: with the ids equal, the owner check passes and `final` is the
 * only thing left holding the tombstone down.
 */
const DELETE_NAME = asOpId("spya-del001");

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
const OTHER_REPAIR = asOpId("spya-fix002");
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
   * An edit of the first question renames the conversation — `withEdit` on the
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
    const cancelled = twice(start, {
      type: "intent.started",
      op: { id: asOpId("spya-wish21"), intent: "cancel", threadId: "spya-t1", messageId: "a1" },
    }).state;
    expect(titles(cancelled)).toEqual([]);

    /* The tombstone is the whole of the optimistic removal — the conversation
       never left `base` — so removing it is the rollback, and there is no copy
       to keep anywhere. That is what let the `latest` ref go. */
    const back = twice(cancelled, {
      type: "intent.failed",
      opId: asOpId("spya-wish21"),
      error: "Someone else has moved this on.",
    }).state;
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
 * **The turn, which is what stage 2 of docs/plans/260828v-chat-operation-model.md is
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
    /* **And the one command it asks for is now only the panel's `?thread=`.**
       It used to carry the row's two names and the attempt as well, because the
       hook consumed a waiting stop or cancel off it through a callback — which
       is the callback that went with the hook on unmount and lost the request
       altogether. A wish is an `IntentOperation` now and the reducer emits its
       own `intent` command for it beside this one, addressed to the operation
       rather than to a row id; there is nothing left for this to carry. GPT
       Sol's finding 1 on stage 2, and the reason this assertion changed. */
    expect(named.commands).toEqual([
      { type: "named", opId: TURN_A, wasThreadId: "guess-thread", threadId: "spya-real1" },
    ]);
  });

  /**
   * **An edit of the first question renames the conversation, so the frame's
   * title is that turn's to take** — even though the conversation is one the
   * server has known about all along.
   *
   * `withEdit` on the server applies the same rule, and the optimistic title
   * written at registration is a blunt 60-character slice where the server's is
   * cut on a word boundary; without this the blunt one stays on screen until the
   * next reload. **Written because nothing could redden the clause that says
   * so:** `namesThread` moved into the reducer on 2026-08-28 and the probe that
   * dropped its `op.title !== null` half left all 67 tests in this file green,
   * which is a rule nothing was checking — the hook had been deciding this as
   * `index === 0` and no test at this level ever asked.
   */
  it("takes the server's cut of the title when an edit renames the conversation", () => {
    const start = loaded(conversation());
    const edited = twice(start, editing("spya-t1", "the question, rewritten at some length")).state;
    expect(titles(edited)).toEqual(["the question, rewritten at some length"]);

    const named = twice(edited, {
      type: "turn.began",
      opId: TURN_A,
      begun: {
        threadId: "spya-t1",
        title: "the question, rewritten at some…",
        messageId: "srv-a",
        questionId: "q1",
      },
    }).state;
    expect(titles(named)).toEqual(["the question, rewritten at some…"]);
  });

  /**
   * And **not** when the reader has renamed it themselves, which is the same
   * rule as for a conversation the server has not named yet: a live rename takes
   * the naming right away from the turn beside it, whichever of the two the
   * reader did first.
   */
  it("leaves a reader's rename alone when an edit's frame comes back", () => {
    const start = loaded(conversation());
    const renamed = renaming(start, RENAME_A, "spya-t1", "mine");
    const edited = twice(renamed, editing("spya-t1", "the question, rewritten")).state;
    /* The edit's own title still lands — it is the later writer to `base`, and a
       title is never withdrawn. What must not happen is the *server's* cut
       arriving afterwards and overwriting the reader's rename. */
    const named = twice(edited, {
      type: "turn.began",
      opId: TURN_A,
      begun: {
        threadId: "spya-t1",
        title: "the question, rewritten — the server's cut",
        messageId: "srv-a",
        questionId: "q1",
      },
    }).state;
    expect(titles(named)).toEqual(["the question, rewritten"]);
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
   * A snapshot is older than anything a turn is still writing, so it must take
   * nothing away from one.
   *
   * **It used to do that by being thrown away entirely**, which is the half that
   * changed on 2026-08-28: it now lands and merges, so the server's own turns
   * arrive as well — see "lands the server's newer turns" below. What this pins
   * is the part that did not change: whatever the snapshot lacks and this tab
   * has, this tab keeps.
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
   * **A repair is a snapshot, and a snapshot is old the moment it is taken.**
   *
   * These four are GPT Sol's finding 3 on stage 2
   * (docs/plans/260828v-chat-operation-model-stage2-review-sol.md): `repair.succeeded`
   * used to replace the whole conversation, guarded only against a turn that was
   * live at the instant it landed. Everything that finished in the meantime was
   * overwritten by a copy of the conversation as it stood before it happened.
   */
  /** A retry of the stored answer, refused, leaving a repair in flight. */
  function repairing(state: ChatState): ChatState {
    const retried = twice(
      state,
      starting({ id: TURN_A, shape: "retry", replyId: "a1", reply: message({ id: "a1" }) }),
    ).state;
    return twice(retried, {
      type: "turn.refused",
      opId: TURN_A,
      error: "no",
      repair: { id: REPAIR },
    }).state;
  }

  it("does not put a repair's older title back over a rename that has succeeded", () => {
    const refused = repairing(loaded(conversation()));
    const named = renaming(refused, RENAME_A, "spya-t1", "what the reader called it");
    const stuck = twice(named, { type: "rename.succeeded", opId: RENAME_A }).state;

    /* The snapshot was taken before the PATCH landed, so it carries the old
       title. A title is never withdrawn and the last writer to `base` wins,
       which is the reader's own order — and this is not it. */
    const repaired = twice(stuck, {
      type: "repair.succeeded",
      opId: REPAIR,
      thread: thread("spya-t1", "a conversation", [message({ id: "q1", role: "user", status: "done" })]),
    }).state;

    expect(titles(repaired)).toEqual(["what the reader called it"]);
  });

  it("does not remove a send that finished while the repair was out", () => {
    const refused = repairing(loaded(conversation()));
    const sent = twice(refused, sending(TURN_B, "a-new", "q-new")).state;
    const done = twice(sent, {
      type: "turn.done",
      opId: TURN_B,
      done: { text: "an answer the reader watched arrive", citations: [], searches: 0, model: "m" },
    }).state;
    /* Finished, so nothing is live for the old guard to notice — and the rows
       are in `base`, which is exactly what the snapshot is about to replace. */
    expect(rows(done)).toEqual(["q1", "a1", "q-new", "a-new"]);

    const repaired = twice(done, {
      type: "repair.succeeded",
      opId: REPAIR,
      thread: conversation(),
    }).state;

    expect(rows(repaired)).toEqual(["q1", "a1", "q-new", "a-new"]);
    expect(answer(repaired, "a-new")?.text).toBe("an answer the reader watched arrive");
  });

  /**
   * **The other half, and the reason a repair exists at all.** It used to be
   * thrown away outright when a turn was live in the conversation, so the
   * external turns that provoked the 409 stayed missing until the next reload.
   * They arrive, and the live send's rows stay where they are.
   */
  it("lands the server's newer turns even while another send is streaming", () => {
    const start = loaded(conversation());
    const sent = twice(start, sending(TURN_B, "a-new", "q-new")).state;
    const edited = twice(
      sent,
      starting({ id: TURN_A, shape: "edit", editing: "q1", replyId: "a-edit" }),
    ).state;
    const refused = twice(edited, {
      type: "turn.refused",
      opId: TURN_A,
      error: "no",
      repair: { id: REPAIR },
    }).state;

    /* What the server has: the stored turn, plus the turn from another tab that
       made this client's edit stale in the first place. */
    const elsewhere = thread("spya-t1", "a conversation", [
      message({ id: "q1", role: "user", text: "why?", status: "done" }),
      message({ id: "a1", text: "because.", status: "done" }),
      message({ id: "q2", role: "user", text: "and in another tab?", status: "done" }),
      message({ id: "a2", text: "this.", status: "done" }),
    ]);
    const repaired = twice(refused, {
      type: "repair.succeeded",
      opId: REPAIR,
      thread: elsewhere,
    }).state;

    expect(rows(repaired), "the turns that caused the 409 are still missing").toEqual([
      "q1",
      "a1",
      "q2",
      "a2",
      "q-new",
      "a-new",
    ]);
    expect(repaired.operations.has(REPAIR)).toBe(false);
    expect(repaired.operations.has(TURN_B), "the live send was retired").toBe(true);
  });

  /**
   * **The same bug for the third time, and the reason a fourth narrowing is not
   * the answer.**
   *
   * Snapshot-over-newer-projection is the class this whole refactor exists to
   * remove. It was in `refreshThread`; then in the repair replacing the
   * conversation; and then in the repair's *merge*, which kept only rows the
   * snapshot did not have. Every operation that rewrites a row **keeps its id** —
   * a retry answers into the row it replaces, an edit keeps the question's id,
   * a recovery patches the row it was chasing — so a merge keyed on "absent from
   * the snapshot" protects a later *send* (which mints ids) and nothing else.
   * The three tests below are the three that were left. GPT Sol, 2026-08-28.
   */
  it("does not put a retry's old answer back when the retry finished while it was out", () => {
    const refused = repairing(loaded(conversation()));
    /* The reader retries the stored answer while the repair is out, and it
       finishes first. `a1` is in the snapshot, saying what it said before. */
    const retried = twice(
      refused,
      starting({ id: TURN_B, shape: "retry", replyId: "a1", reply: message({ id: "a1" }) }),
    ).state;
    const done = twice(retried, {
      type: "turn.done",
      opId: TURN_B,
      done: { text: "a better answer", citations: [], searches: 0, model: "m" },
    }).state;
    expect(answer(done, "a1")?.text).toBe("a better answer");

    const repaired = twice(done, {
      type: "repair.succeeded",
      opId: REPAIR,
      thread: conversation(),
    }).state;
    expect(rows(repaired)).toEqual(["q1", "a1"]);
    expect(answer(repaired, "a1")?.text, "the snapshot put the replaced answer back").toBe(
      "a better answer",
    );
  });

  it("does not put an edited question back when the edit finished while it was out", () => {
    const long = thread("spya-t1", "a conversation", [
      message({ id: "q1", role: "user", text: "why?", status: "done" }),
      message({ id: "a1", text: "because.", status: "done" }),
    ]);
    const refused = repairing(loaded(long));
    const edited = twice(
      refused,
      starting({
        id: TURN_B,
        shape: "edit",
        editing: "q1",
        replyId: "a-edit",
        /* The server keeps a rewritten question's id — `withEdit` builds
           `{ ...target, text, editedAt }` — so this row is in the snapshot too,
           still carrying the words the reader replaced. */
        question: message({ id: "q1", role: "user", text: "why, really?", status: "done" }),
      }),
    ).state;
    const done = twice(edited, {
      type: "turn.done",
      opId: TURN_B,
      done: { text: "a new answer", citations: [], searches: 0, model: "m" },
    }).state;

    /* **The server's copy still has the turn the edit threw away**, which is the
       half the first version of this test never asked about: it checked the
       question's text and not the row set, so it passed on
       `q1, a1, a-edit` — the rewritten question with the discarded answer still
       under it. An edit *truncates*, and a merge that only replaces rows cannot
       express that. GPT Sol, 2026-08-28. */
    const repaired = twice(done, {
      type: "repair.succeeded",
      opId: REPAIR,
      thread: long,
    }).state;
    expect(rows(repaired), "the snapshot undid the edit's discard").toEqual(["q1", "a-edit"]);
    expect(
      answer(repaired, "q1")?.text,
      "the snapshot put the question the reader rewrote back",
    ).toBe("why, really?");
  });

  it("does not undo a recovery that adopted an answer while it was out", () => {
    const pendingRow = thread("spya-t1", "a conversation", [
      message({ id: "q1", role: "user", text: "why?", status: "done" }),
      message({ id: "a1", status: "pending" }),
    ]);
    const refused = repairing(loaded(pendingRow));
    const looking = twice(refused, {
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
    const found = twice(looking, {
      type: "recovery.found",
      opId: RECOVER,
      message: message({ id: "a1", text: "it finished after all", status: "done" }),
    }).state;
    expect(answer(found, "a1")?.status).toBe("done");

    /* The snapshot was taken while the row was still `pending`, which is the
       state the recovery existed to get out of. */
    const repaired = twice(found, {
      type: "repair.succeeded",
      opId: REPAIR,
      thread: pendingRow,
    }).state;
    expect(rows(repaired)).toEqual(["q1", "a1"]);
    expect(answer(repaired, "a1")?.status, "the snapshot put the spinner back").toBe("done");
    expect(answer(repaired, "a1")?.text).toBe("it finished after all");
  });

  /**
   * **And the half none of the four narrowings ever reached.** A repair whose
   * answer is `null` — the server does not have this conversation — removes it
   * outright, and did so without consulting anything. A send started after the
   * question was asked went with it, live or finished, and a live operation
   * cannot re-project over a thread that is no longer there. GPT Sol, 2026-08-28.
   *
   * One check covers this and the three above, because it asks about the
   * conversation rather than about rows: nothing may have happened here since we
   * asked.
   */
  it("does not remove a conversation the reader has added to since asking", () => {
    const refused = repairing(loaded(conversation()));
    const sent = twice(refused, sending(TURN_B, "a-new", "q-new")).state;

    const gone = twice(sent, { type: "repair.succeeded", opId: REPAIR, thread: null }).state;
    expect(rows(gone), "a conversation with a live send in it was removed").toEqual([
      "q1",
      "a1",
      "q-new",
      "a-new",
    ]);

    /* And the premise, without which "never remove anything" would pass: when
       nothing has happened since, the server's `null` is believed. */
    const quiet = twice(repairing(loaded(conversation())), {
      type: "repair.succeeded",
      opId: REPAIR,
      thread: null,
    }).state;
    expect(quiet.base).toEqual([]);
  });

  it("does not let an older repair land over a newer one", () => {
    const first = repairing(loaded(conversation()));
    const second = twice(first, sending(TURN_B, "a-new", "q-new")).state;
    const again = twice(second, {
      type: "turn.refused",
      opId: TURN_B,
      error: "no again",
      repair: { id: OTHER_REPAIR },
    }).state;

    /* The newer repair answers first, with what the server has now. */
    const newer = twice(again, {
      type: "repair.succeeded",
      opId: OTHER_REPAIR,
      thread: thread("spya-t1", "a conversation", [
        message({ id: "q1", role: "user", text: "why?", status: "done" }),
        message({ id: "a1", text: "because.", status: "done" }),
        message({ id: "q2", role: "user", text: "and?", status: "done" }),
        message({ id: "a2", text: "this.", status: "done" }),
      ]),
    }).state;
    expect(rows(newer)).toEqual(["q1", "a1", "q2", "a2"]);

    /* **And its failure is silent too**, which the success being silent did not
       make true. The superseded check was written on one branch and not the one
       beside it — bug 10 and bug 12's shape, and the shape the gate exists to
       make impossible. Reporting here would tell the reader a repair failed
       moments after a newer one succeeded. */
    /* Cleared first, because the 409 that started these repairs wrote its own
       reason into `error` and this test is about what the repair adds to it. */
    const quiet = twice(newer, { type: "error.set", error: null }).state;
    const failedOld = twice(quiet, {
      type: "repair.failed",
      opId: REPAIR,
      error: "the network is down",
    }).state;
    expect(failedOld.error, "a superseded repair reported its failure").toBeNull();
    expect(failedOld.operations.has(REPAIR), "it did not retire either").toBe(false);

    // And the older one, still out, answers with the conversation as it was.
    const older = twice(newer, {
      type: "repair.succeeded",
      opId: REPAIR,
      thread: conversation(),
    }).state;
    expect(rows(older), "an older repair overwrote a newer one").toEqual(["q1", "a1", "q2", "a2"]);
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

  /**
   * **`thread.discarded` refuses here and `delete.started` must not**, and the
   * two are one word apart in `ChatApi`, so both halves are asserted against the
   * same state.
   *
   * A retry writes nothing to `base`, so a conversation whose only turn is being
   * rewritten has no stored messages at all — `withoutEmpty` alone would take it
   * off the screen while the reader was watching the answer arrive. That is what
   * the local forget refuses. The **delete** is the reader asking the server to
   * throw the conversation away, and a delete that quietly did nothing because
   * something happened to be streaming would be the same silent success as the
   * cancel that was never sent. It always goes.
   */
  it("will not discard a conversation a turn is drawing into, and still deletes it", () => {
    const start = loaded(thread("spya-t1", "New chat"));
    const edited = twice(
      start,
      starting({ id: TURN_A, shape: "retry", replyId: "a1" }),
    ).state;
    const after = twice(edited, { type: "thread.discarded", threadId: "spya-t1" });
    expect(after.state).toBe(edited);

    const removed = twice(edited, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "spya-t1" },
    });
    expect(removed.commands, "a delete was suppressed by a live turn").toEqual([
      { type: "delete", opId: DELETE, slug: SLUG, threadId: "spya-t1" },
    ]);
    expect(titles(removed.state)).toEqual([]);
    /* And the turn cannot bring it back, whatever its stream does next: the
       tombstone is `final` and a tombstoned conversation is projected away
       whatever is laid over it. */
    const arriving = twice(removed.state, {
      type: "turn.delta",
      opId: TURN_A,
      text: "still writing",
    }).state;
    expect(titles(arriving), "a frame put a deleted conversation back").toEqual([]);
    const finished = twice(arriving, {
      type: "turn.done",
      opId: TURN_A,
      done: { text: "still writing", citations: [], searches: 0, model: "m" },
    }).state;
    expect(titles(finished)).toEqual([]);
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

/**
 * **A stop and a cancel are operations**, and this is what that bought.
 *
 * They were a `Set` and a `Map` of row ids in `useChat`, consumed by a callback
 * the hook installed on the controller — which React cleared on unmount, so the
 * one lifecycle production actually has (press cancel, panel closes, `begin`
 * frame arrives) sent no request at all. GPT Sol's finding 1 on stage 2. Pulling
 * the wish into the state moved the decision here, where it can be tested
 * without a DOM, and brought two things with it that the refs could not have:
 * the admission gate in front of the answer, and supersession.
 *
 * The lifecycle itself is tests/chat-unmounted-turn.test.ts; these are the
 * transitions underneath it.
 */
describe("a stop or a cancel", () => {
  const WISH = asOpId("spya-wish01");
  const OTHER_WISH = asOpId("spya-wish02");

  function pending(shape: "send" | "retry"): ChatState {
    const start = loaded(conversation());
    return twice(
      start,
      starting(
        shape === "send"
          ? {
              id: TURN_A,
              shape,
              replyId: "a-new",
              question: message({ id: "q-new", role: "user", text: "and?", status: "done" }),
            }
          : { id: TURN_A, shape, replyId: "a1", reply: message({ id: "a1" }) },
      ),
    ).state;
  }

  function wishing(state: ChatState, intent: "stop" | "cancel", messageId: string, id = WISH) {
    return twice(state, {
      type: "intent.started",
      op: { id, intent, threadId: "spya-t1", messageId },
    });
  }

  it("waits for the begin frame when the row has no name the server would know", () => {
    const sent = pending("send");
    const wished = wishing(sent, "stop", "a-new");
    expect(wished.commands, "a stop went out under an invented id").toEqual([]);
    expect(wished.state.operations.get(WISH)).toMatchObject({ waitingOn: TURN_A });

    const named = twice(wished.state, {
      type: "turn.began",
      opId: TURN_A,
      begun: {
        threadId: "spya-t1",
        title: "a conversation",
        messageId: "srv-a",
        attempt: "att-1",
      },
    });
    /* Sent **once**, at the instant there is an id the server minted, with the
       attempt it minted with it — and by the reducer, so nothing outside the
       state has to be alive to do it. */
    expect(named.commands).toContainEqual({
      type: "intent",
      opId: WISH,
      slug: SLUG,
      intent: "stop",
      threadId: "spya-t1",
      messageId: "srv-a",
      attempt: "att-1",
    });
    expect(named.state.operations.get(WISH)).toMatchObject({ waitingOn: null, messageId: "srv-a" });
  });

  /**
   * **`began` is not a sound predicate for a retry** — finding 2. A retry writes
   * into a row the server named long ago, so a cancel of one has an id to send
   * today. A stop still waits, because a stop is aimed at one *attempt* and the
   * attempt is what the frame carries.
   */
  it("cancels a retry at once and still makes a stop of one wait", () => {
    const retried = pending("retry");
    const cancelled = wishing(retried, "cancel", "a1");
    expect(cancelled.commands).toEqual([
      {
        type: "intent",
        opId: WISH,
        slug: SLUG,
        intent: "cancel",
        threadId: "spya-t1",
        messageId: "a1",
        attempt: null,
      },
    ]);
    // And the conversation left the screen the moment the button was pressed.
    expect(titles(cancelled.state)).toEqual([]);

    const stopped = wishing(retried, "stop", "a1", OTHER_WISH);
    expect(stopped.commands, "a stop was sent without an attempt to aim it at").toEqual([]);
  });

  /**
   * **A wish its turn leaves behind is dropped, not left lying.** The stranded
   * one used to sit in a `Set` under a row id that the *next* retry re-uses, so
   * that attempt's `begin` frame fired it and stopped an answer the reader had
   * just asked for.
   */
  it("drops a wish whose turn dies before the server names it", () => {
    const retried = pending("retry");
    const wished = wishing(retried, "stop", "a1").state;
    expect(wished.operations.has(WISH)).toBe(true);

    const failed = twice(wished, {
      type: "turn.failed",
      opId: TURN_A,
      error: "the model is busy",
    });
    expect(failed.commands, "a stop was sent for a turn that never started").toEqual([]);
    expect(failed.state.operations.has(WISH), "a wish outlived the turn it waited on").toBe(false);
  });

  it("drops one a refused turn leaves behind too, and keeps the tombstone", () => {
    const sent = pending("send");
    const wished = wishing(sent, "cancel", "a-new").state;
    const refused = twice(wished, {
      type: "turn.refused",
      opId: TURN_A,
      error: "no",
      repair: { id: REPAIR },
    }).state;

    expect(refused.operations.has(WISH)).toBe(false);
    /* The tombstone stays. The reader pressed a destructive button, and nothing
       this tab can say to the server would name a row the server never wrote. */
    expect(titles(refused)).toEqual([]);
  });

  /** One of them fires, ever — which used to be a comment and is now the type. */
  it("replaces a waiting stop when the reader cancels the same row", () => {
    const sent = pending("send");
    const stopped = wishing(sent, "stop", "a-new").state;
    const cancelled = wishing(stopped, "cancel", "a-new", OTHER_WISH).state;
    expect(cancelled.operations.has(WISH), "the stop was left to fire as well").toBe(false);

    const named = twice(cancelled, {
      type: "turn.began",
      opId: TURN_A,
      begun: { threadId: "spya-t1", title: "a conversation", messageId: "srv-a" },
    });
    expect(named.commands.filter((c) => c.type === "intent")).toEqual([
      {
        type: "intent",
        opId: OTHER_WISH,
        slug: SLUG,
        intent: "cancel",
        threadId: "spya-t1",
        messageId: "srv-a",
        attempt: null,
      },
    ]);
  });

  /**
   * **A refused cancel lifts its tombstone and says so in one transition** —
   * there is no moment where the conversation is back with nothing to explain
   * it, and no second place to remember one of the two.
   */
  it("puts the conversation back and reports it, together", () => {
    const start = loaded(conversation());
    const cancelled = wishing(start, "cancel", "a1").state;
    expect(titles(cancelled)).toEqual([]);

    const refused = twice(cancelled, {
      type: "intent.failed",
      opId: WISH,
      error: "This conversation has moved on since you looked",
    }).state;
    expect(titles(refused)).toEqual(["a conversation"]);
    expect(refused.error).toBe(
      "Couldn't discard that conversation: This conversation has moved on since you looked",
    );
  });

  /**
   * **Finding 4.** Cancel, then delete the conversation outright while the
   * cancel is out, then the cancel comes back refused. The delete supersedes
   * everything for that conversation, so the obsolete refusal lifts nothing and
   * says nothing — it used to write "Couldn't discard…" over a delete that had
   * succeeded, from a `catch` with no gate in front of it.
   */
  it("says nothing when the reader has since deleted the conversation", () => {
    const start = loaded(conversation());
    const cancelled = wishing(start, "cancel", "a1").state;
    const removed = twice(cancelled, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "spya-t1" },
    }).state;
    const done = twice(removed, { type: "delete.succeeded", opId: DELETE }).state;

    const refused = twice(done, {
      type: "intent.failed",
      opId: WISH,
      error: "This conversation has moved on since you looked",
    }).state;

    expect(titles(refused), "a deleted conversation came back").toEqual([]);
    expect(refused.error, "an obsolete cancel reported over a successful delete").toBeNull();
  });

  /**
   * **A second cancel inherits the first one's tombstone.**
   *
   * Only the operation that laid a tombstone may lift it, and the first cancel
   * is dropped when the second replaces it — so without this the tombstone would
   * have no owner left and a refusal could never put the conversation back. The
   * screen and the server would disagree, which is exactly what the one-request
   * rule exists to stop.
   */
  it("lets a second cancel of one row lift the tombstone the first laid", () => {
    const sent = pending("send");
    const first = wishing(sent, "cancel", "a-new").state;
    const second = wishing(first, "cancel", "a-new", OTHER_WISH).state;
    expect(second.operations.has(WISH)).toBe(false);
    expect(titles(second)).toEqual([]);

    const named = twice(second, {
      type: "turn.began",
      opId: TURN_A,
      begun: { threadId: "spya-t1", title: "a conversation", messageId: "srv-a" },
    }).state;
    const refused = twice(named, {
      type: "intent.failed",
      opId: OTHER_WISH,
      error: "This conversation has moved on since you looked",
    }).state;
    expect(titles(refused), "nothing was left that could lift the tombstone").toEqual([
      "a conversation",
    ]);
  });

  /**
   * **And a second cancel that had already been *sent* inherits it too.**
   *
   * Supersession and replacement are different: a wish still waiting is replaced
   * outright, and one already in flight is superseded so that its answer says
   * nothing. Inheritance covered only the first, so two cancels that both went
   * out and both failed left the conversation hidden for ever — the first's
   * refusal was silenced for being superseded, and the second's could not lift a
   * tombstone it did not own. GPT Sol, 2026-08-28, on exactly this test's gap.
   */
  it("lets a second cancel lift the tombstone of one already sent", () => {
    const start = loaded(conversation());
    /* Both go out at once: `a1` is the server's own name for the row, so
       neither of these waits for anything. */
    const first = wishing(start, "cancel", "a1").state;
    expect(first.operations.get(WISH)).toMatchObject({ waitingOn: null });
    const second = wishing(first, "cancel", "a1", OTHER_WISH).state;
    expect(second.operations.get(WISH)?.superseded, "the first was superseded").toBe(true);

    const firstFailed = twice(second, {
      type: "intent.failed",
      opId: WISH,
      error: "the network",
    }).state;
    expect(titles(firstFailed), "a superseded wish spoke").toEqual([]);

    const bothFailed = twice(firstFailed, {
      type: "intent.failed",
      opId: OTHER_WISH,
      error: "This conversation has moved on since you looked",
    }).state;
    expect(titles(bothFailed), "both cancels failed and the conversation stayed hidden").toEqual([
      "a conversation",
    ]);
  });

  /**
   * A wish the reader has overtaken is dropped at the frame rather than sent.
   *
   * Deleting the conversation supersedes everything for it, the cancel
   * included — and a wish that is neither sent nor dropped is an operation that
   * never retires.
   */
  it("sends nothing at the frame for a wish something newer has taken over", () => {
    const sent = pending("send");
    const cancelled = wishing(sent, "cancel", "a-new").state;
    const removed = twice(cancelled, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "spya-t1" },
    }).state;

    const named = twice(removed, {
      type: "turn.began",
      opId: TURN_A,
      begun: { threadId: "spya-t1", title: "a conversation", messageId: "srv-a" },
    });
    expect(named.commands.filter((c) => c.type === "intent")).toEqual([]);
    expect(named.state.operations.has(WISH), "a wish was left waiting for ever").toBe(false);
  });

  /**
   * **The tombstone has to be renamed with everything else.**
   *
   * `turn.began` swaps the thread, the question and the answer in one
   * transition, and the tombstone was the fourth name for the same thing and was
   * left behind. So a cancel pressed before the frame laid one under the id this
   * client invented, the server then answered with an id of its own, and the
   * conversation the reader had just discarded reappeared — the projection
   * filters by key, and the key no longer matched. Its refusal could not find it
   * either, so nothing could put it right afterwards. GPT Sol, twice: the
   * blocker was reported against stage 2 and survived the first round of fixes
   * because every test used the same thread id on both sides of the frame.
   */
  it("renames the tombstone when the server overrules the thread id", () => {
    const sent = twice(
      loaded(),
      starting({
        id: TURN_A,
        shape: "send",
        threadId: "guess-thread",
        replyId: "a-new",
        question: message({ id: "q-new", role: "user", text: "why?", status: "done" }),
        opening: thread("guess-thread", "why?"),
      }),
    ).state;
    const cancelled = twice(sent, {
      type: "intent.started",
      op: { id: WISH, intent: "cancel", threadId: "guess-thread", messageId: "a-new" },
    }).state;
    expect(titles(cancelled)).toEqual([]);

    const named = twice(cancelled, {
      type: "turn.began",
      opId: TURN_A,
      begun: {
        threadId: "spya-real1",
        title: "why?",
        messageId: "srv-a",
        questionId: "srv-q",
        attempt: "att-1",
      },
    });
    expect(titles(named.state), "a discarded conversation came back with a new name").toEqual([]);
    /* And the wish goes out naming the conversation the server named, so its
       refusal can find the tombstone it is being asked to lift. */
    expect(named.commands).toContainEqual({
      type: "intent",
      opId: WISH,
      slug: SLUG,
      intent: "cancel",
      threadId: "spya-real1",
      messageId: "srv-a",
      attempt: "att-1",
    });

    const refused = twice(named.state, {
      type: "intent.failed",
      opId: WISH,
      error: "Someone else has moved this on.",
    }).state;
    expect(refused.tombstones.size, "the tombstone could not be found to lift").toBe(0);
    expect(titles(refused)).toEqual(["why?"]);
  });

  /**
   * **A delete of a conversation the server has not named yet.**
   *
   * `delete.started` supersedes everything for the conversation, the live turn
   * included — and the single "a superseded operation does nothing" rule then
   * threw away that turn's `begin` frame, which is the one event carrying the
   * server's real name for it. So the tombstone and the delete operation both
   * stayed on the id this tab invented.
   *
   * And the DELETE had already gone out under that name. `deleteThread` on the
   * server answers happily for a conversation it has never heard of, so the
   * reader is told it worked and the real one comes back on their next reload —
   * the same silent success as the cancel that was never sent. GPT Sol,
   * 2026-08-28.
   *
   * **This test's two command assertions changed on purpose**, and the change is
   * the finding rather than a way of making the suite pass. It was written
   * against the first answer — send the doomed request, then send a second one
   * under the real name — and Sol found two holes in that on the next round: the
   * doomed request can answer first, and in the common case the id does not
   * change at all, so there was never a second request. Nothing is sent into
   * that window now; the DELETE leaves at the frame, once. What this test still
   * pins, unchanged, is the half that was right: the tombstone and the operation
   * both follow the server's name, and the superseded turn still retires without
   * drawing.
   */
  it("holds a delete of a conversation the server had not named, and sends it at the frame", () => {
    const opened = twice(
      loaded(),
      starting({
        id: TURN_A,
        shape: "send",
        threadId: "guess-thread",
        replyId: "guess-a",
        question: message({ id: "guess-q", role: "user", text: "why?", status: "done" }),
        opening: thread("guess-thread", "why?"),
      }),
    ).state;
    const removed = twice(opened, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "guess-thread" },
    });
    expect(removed.commands, "a DELETE named a conversation the server never had").toEqual([]);
    expect(removed.state.operations.get(TURN_A)?.superseded, "the premise").toBe(true);

    const named = twice(removed.state, {
      type: "turn.began",
      opId: TURN_A,
      begun: { threadId: "spya-real1", title: "why?", messageId: "srv-a", questionId: "srv-q" },
    });

    /* The tombstone and the delete both followed the server's name... */
    expect([...named.state.tombstones.keys()], "the tombstone stayed on a name nobody has").toEqual([
      "spya-real1",
    ]);
    expect(named.state.operations.get(DELETE)).toMatchObject({
      threadId: "spya-real1",
      held: false,
    });
    /* ...and this is where the one request goes: the frame is the server saying
       the conversation is on disk, so it is the first moment a DELETE has
       anything to name. */
    expect(named.commands, "the DELETE was never sent under the real id").toContainEqual({
      type: "delete",
      opId: DELETE,
      slug: SLUG,
      threadId: "spya-real1",
    });
    /* The superseded turn still retires, and still draws nothing. */
    expect(named.state.operations.has(TURN_A)).toBe(false);
    expect(titles(named.state)).toEqual([]);
  });

  /**
   * Everything else keyed on the provisional id follows too, for the same
   * reason: a name this client invented stops existing at the frame.
   */
  it("renames every operation that was keyed on the provisional thread id", () => {
    const first = twice(
      loaded(),
      starting({
        id: TURN_A,
        shape: "send",
        threadId: "guess-thread",
        replyId: "a-one",
        question: message({ id: "q-one", role: "user", text: "why?", status: "done" }),
        opening: thread("guess-thread", "why?"),
      }),
    ).state;
    /* A second question typed into the same new conversation before the first
       one's frame came back. Its operation names the conversation the only way
       it can — by the id this tab invented. */
    const second = twice(
      first,
      starting({
        id: TURN_B,
        shape: "send",
        threadId: "guess-thread",
        replyId: "a-two",
        question: message({ id: "q-two", role: "user", text: "and?", status: "done" }),
      }),
    ).state;

    const named = twice(second, {
      type: "turn.began",
      opId: TURN_A,
      begun: { threadId: "spya-real1", title: "why?", messageId: "srv-a", questionId: "srv-q" },
    }).state;

    expect(named.operations.get(TURN_B)).toMatchObject({ threadId: "spya-real1" });
    // And it can still draw, which is the thing that stops being true otherwise.
    const arriving = twice(named, { type: "turn.delta", opId: TURN_B, text: "Because " }).state;
    expect(
      project(arriving)
        .find((t) => t.id === "spya-real1")
        ?.messages.find((m) => m.id === "a-two")?.text,
      "the second answer arrived nowhere",
    ).toBe("Because ");
  });

  /** And the gate, on the path this adds: a wish nobody registered is nobody's. */
  it("refuses an answer to a wish that belongs to no operation", () => {
    const start = loaded(conversation());
    const stale = twice(start, { type: "intent.failed", opId: WISH, error: "too late" });
    expect(stale.state).toBe(start);
  });

  /** `{ stopped: false }` arrives here, and it is not a failure. */
  it("writes nothing when the stop lands", () => {
    const retried = pending("retry");
    const named = twice(retried, {
      type: "turn.began",
      opId: TURN_A,
      begun: { threadId: "spya-t1", title: "a conversation", messageId: "a1", attempt: "att-1" },
    }).state;
    const wished = wishing(named, "stop", "a1").state;
    const landed = twice(wished, { type: "intent.succeeded", opId: WISH }).state;
    expect(landed.operations.has(WISH)).toBe(false);
    expect(landed.error).toBeNull();
    expect(rows(landed)).toEqual(["q1", "a1"]);
  });

  /** Everything on screen in the one conversation, by message id. */
  function rows(state: ChatState, id = "spya-t1"): string[] {
    return project(state).find((t) => t.id === id)?.messages.map((m) => m.id) ?? [];
  }
});

/**
 * **Who may lift a tombstone**, asked of the path a reader can actually reach.
 *
 * These used to dispatch `tombstone.added` and `tombstone.removed` directly.
 * Those two events went on 2026-08-28 with the last thing that sent them: a
 * cancel is an operation now, so it lays its tombstone as it registers and lifts
 * it as it is refused, both inside one transition. Keeping the events would have
 * left a second, unreachable vocabulary for the same rule — with the *tested*
 * copy over there and the reachable copy untested, which is the shape this
 * directory exists to remove.
 */
describe("who may lift a tombstone", () => {
  const WISH = asOpId("spya-wish11");
  const OTHER_WISH = asOpId("spya-wish12");

  function cancelling(state: ChatState, id = WISH): ChatState {
    return twice(state, {
      type: "intent.started",
      op: { id, intent: "cancel", threadId: "spya-t1", messageId: "a1" },
    }).state;
  }

  function deleting(state: ChatState): ChatState {
    return twice(state, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "spya-t1" },
    }).state;
  }

  function refusing(state: ChatState, id = WISH) {
    return twice(state, {
      type: "intent.failed",
      opId: id,
      error: "This conversation has moved on since you looked",
    });
  }

  /**
   * cancel → delete → the cancel's failure. The refusal must not take the
   * delete's tombstone off with it: deletions win over every projection, and
   * here one used to lose to an unrelated request failing.
   */
  it("does not let a refused cancel lift a delete's", () => {
    const removed = deleting(cancelling(loaded(conversation())));
    expect(titles(removed)).toEqual([]);

    const refused = refusing(removed);
    expect(titles(refused.state), "a deleted conversation came back").toEqual([]);
    /* And it says nothing either — the delete superseded it. Two halves of one
       finding, and only the first of them used to hold. */
    expect(refused.state.error).toBeNull();
  });

  /** And the other order, which is where the delete arrives on top. */
  it("does not let a cancel that arrived after a delete lift it either", () => {
    const cancelled = cancelling(deleting(loaded(conversation())));
    expect(titles(refusing(cancelled).state)).toEqual([]);
  });

  /**
   * **And nothing lifts a delete's, not even something carrying its own name.**
   *
   * The rule the two tests above rest on, stated on its own: a deletion wins
   * over every projection, so its tombstone is `final` and the owner check is
   * not the only thing standing between a deleted conversation and the screen.
   * A cancel cannot mint a delete's id, so this reaches `final` through an
   * `intent.failed` whose operation was registered with the delete's own name —
   * which nothing in the hook can do, and which is the reason to pin the rule
   * here rather than leave it to be rediscovered.
   */
  it("refuses to lift a delete's tombstone even under the delete's own name", () => {
    const removed = deleting(loaded(conversation()));
    const impostor = twice(removed, {
      type: "intent.started",
      op: { id: DELETE_NAME, intent: "cancel", threadId: "spya-t1", messageId: "a1" },
    }).state;
    const after = refusing(impostor, DELETE_NAME).state;
    expect(titles(after)).toEqual([]);
  });

  /** And somebody else's cancel cannot lift this one's, which is the same rule. */
  it("takes only its own off", () => {
    const cancelled = cancelling(loaded(conversation()));
    /* A second cancel of the same row would *inherit* the tombstone — see the
       test for that — so this is a cancel of another row in the conversation,
       which lays nothing and therefore owns nothing. */
    const elsewhere = twice(cancelled, {
      type: "intent.started",
      op: { id: OTHER_WISH, intent: "cancel", threadId: "spya-t1", messageId: "q1" },
    }).state;
    expect(titles(refusing(elsewhere, OTHER_WISH).state)).toEqual([]);

    // And the one that laid it still can.
    expect(titles(refusing(elsewhere, WISH).state)).toEqual(["a conversation"]);
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

/**
 * **A mutation of a conversation the server has not named yet is held, not sent.**
 *
 * The window is small and it is the one this file keeps coming back to: the
 * reader has a conversation on screen, the server has never heard of it, and
 * every name in it is one this tab invented. A send is what closes the window —
 * `beginTurn` writes the thread and the `begin` frame is the server saying so —
 * and until that frame arrives a PATCH or a DELETE names nothing.
 *
 * **It used to be sent anyway, and then compensated for.** `deleteThread` and
 * `renameThread` in src/chat.ts are a `filter` and a `map` over the stored list,
 * so a request naming a conversation that is not there changes nothing and
 * answers `200` — the reader is told the delete worked and the real conversation
 * comes back on their next reload. The compensation was `outstanding + 1` and a
 * fresh command emitted from `renamed()`, and GPT Sol found two holes in it on
 * 2026-08-28:
 *
 * - the doomed request can answer **first**. Its operation retires, and
 *   `renamed()` only reissues what is still in the map, so it emits nothing;
 * - and in the **common case there is no rename at all.** `beginTurn` accepts the
 *   client's thread id when it is free, so `from === to` and `renamed()` returned
 *   at its first line — the compensation only ever ran on the rarer branch where
 *   the server minted an id of its own.
 *
 * So the window is closed rather than compensated for: nothing is sent into it,
 * and the request goes out in the same transition as the frame that supplies a
 * name the server can match. That deletes the doomed request, `outstanding`, and
 * the reissue with it. 2026-08-28.
 */
describe("a mutation of a conversation the server has not named", () => {
  const REAL = "spya-real1";

  /** A send that had to invent the conversation, still waiting for its frame. */
  function opening(threadId = "guess-thread"): ChatState {
    return twice(
      loaded(),
      starting({
        id: TURN_A,
        shape: "send",
        threadId,
        replyId: "guess-a",
        question: message({ id: "guess-q", role: "user", text: "why?", status: "done" }),
        opening: thread(threadId, "why?"),
      }),
    ).state;
  }

  function begun(threadId: string, title = "why?") {
    return {
      type: "turn.began" as const,
      opId: TURN_A,
      begun: { threadId, title, messageId: "srv-a", questionId: "srv-q", attempt: "att-1" },
    };
  }

  /**
   * **The common case, and the one the old compensation could not reach.** The
   * server keeps the id this tab guessed, so nothing is renamed — and the whole
   * question is *when* the request goes, not what it is addressed to.
   */
  it("holds the DELETE until the frame says the conversation is on disk", () => {
    const removed = twice(opening(), {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "guess-thread" },
    });
    expect(removed.commands, "a DELETE went out for a conversation the server has never had")
      .toEqual([]);
    /* Gone from the screen from the moment the reader pressed it, exactly as
       before: the tombstone is what the reader sees, and it does not wait. */
    expect(titles(removed.state)).toEqual([]);

    const named = twice(removed.state, begun("guess-thread"));
    expect(named.commands, "the DELETE was never sent").toEqual([
      { type: "delete", opId: DELETE, slug: SLUG, threadId: "guess-thread" },
    ]);
    expect(titles(named.state)).toEqual([]);
  });

  /**
   * **And the hold ends**, which is the half a test of the holding alone cannot
   * see: once the frame has named the conversation, a mutation goes out at the
   * moment the reader asks for it, exactly as it always did. A hold that never
   * lifts is a delete button that does nothing — the same silent success from
   * the other direction.
   */
  it("sends a mutation made after the frame at once", () => {
    const named = twice(opening(), begun(REAL)).state;
    expect(named.unnamed.has("guess-thread"), "the conversation is still waiting for a name").toBe(
      false,
    );
    const removed = twice(named, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: REAL },
    });
    expect(removed.commands, "a delete of a named conversation was held").toEqual([
      { type: "delete", opId: DELETE, slug: SLUG, threadId: REAL },
    ]);
    /* And its answer is admitted, which a held operation's is not. */
    expect(twice(removed.state, { type: "delete.succeeded", opId: DELETE }).state.operations.has(DELETE)).toBe(false);
  });

  /** And when the server does mint an id of its own, it is sent once, to that. */
  it("sends it once, under the name the server minted", () => {
    const removed = twice(opening(), {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "guess-thread" },
    });
    expect(removed.commands).toEqual([]);

    const named = twice(removed.state, begun(REAL));
    expect(named.commands.filter((c) => c.type === "delete")).toEqual([
      { type: "delete", opId: DELETE, slug: SLUG, threadId: REAL },
    ]);
    expect([...named.state.tombstones.keys()]).toEqual([REAL]);
  });

  /**
   * **Sol's own reproduction, and it cannot happen any more — which is why the
   * assertion is that it changes nothing.**
   *
   * The DELETE answered before the frame, its operation retired, and the frame
   * then had nothing left to reissue: `commands: []`. There is no first request
   * to answer now, so a `delete.succeeded` arriving here belongs to nothing. It
   * is refused at the gate rather than allowed to retire a request that has not
   * left the tab — an operation that has not asked cannot be answered.
   */
  it("cannot be retired by an answer to a request that never went out", () => {
    const held = twice(opening(), {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "guess-thread" },
    }).state;

    const stray = twice(held, { type: "delete.succeeded", opId: DELETE });
    expect(stray.state, "an answer to nothing retired the delete").toBe(held);
    const strayFailure = twice(held, { type: "delete.failed", opId: DELETE, error: "a 500" });
    expect(strayFailure.state, "and its failure was admitted").toBe(held);

    const named = twice(held, begun(REAL));
    expect(named.commands.filter((c) => c.type === "delete")).toEqual([
      { type: "delete", opId: DELETE, slug: SLUG, threadId: REAL },
    ]);
  });

  /**
   * **A reader's rename takes the naming right away from the opening turn.**
   *
   * `namesThread` used to be decided in the hook when the turn registered, which
   * cannot know about a rename that has not happened yet — so the `begin` frame's
   * title, which is a slice of the question, landed over the name the reader had
   * just typed. That is `withServerIds` taking `namesThread` as an argument
   * because guessing it was a bug, and then being handed a guess that went stale.
   * GPT Sol, 2026-08-28. It is decided in `startTurn` now, from `unnamed` and the
   * live renames, so there is no longer a guess to go stale — and this test says
   * the same thing either way, which is why it did not change.
   */
  it("keeps the reader's title, and is the title the server is told", () => {
    const renamed = twice(opening(), {
      type: "rename.started",
      op: { id: RENAME_A, kind: "rename", threadId: "guess-thread", title: "mine" },
    });
    expect(renamed.commands, "the PATCH named a conversation the server has never had").toEqual([]);
    expect(titles(renamed.state)).toEqual(["mine"]);

    const named = twice(renamed.state, begun(REAL, "why?"));
    expect(titles(named.state), "the begin frame overwrote the reader's own name").toEqual(["mine"]);
    expect(named.commands.filter((c) => c.type === "rename")).toEqual([
      { type: "rename", opId: RENAME_A, slug: SLUG, threadId: REAL, title: "mine" },
    ]);
  });

  /**
   * And the other order, which is the same rule from the other side: a
   * conversation renamed before anything has been asked in it. The turn is
   * registered *after* the rename, so `startTurn` asks the same question at
   * registration that `readerNamed` asks when the rename arrives second.
   */
  it("keeps a title given before the first question was even asked", () => {
    const empty = twice(loaded(), { type: "thread.begun", thread: thread("new-1", "New chat") }).state;
    const renamed = twice(empty, {
      type: "rename.started",
      op: { id: RENAME_A, kind: "rename", threadId: "new-1", title: "mine" },
    });
    expect(renamed.commands).toEqual([]);
    const sent = twice(renamed.state, starting({
      id: TURN_A,
      shape: "send",
      threadId: "new-1",
      replyId: "guess-a",
      question: message({ id: "guess-q", role: "user", text: "why?", status: "done" }),
    })).state;

    const named = twice(sent, begun(REAL, "why?"));
    expect(titles(named.state)).toEqual(["mine"]);
    expect(named.commands.filter((c) => c.type === "rename")).toEqual([
      { type: "rename", opId: RENAME_A, slug: SLUG, threadId: REAL, title: "mine" },
    ]);
  });

  /**
   * **A superseded held mutation is dropped rather than sent**, which is the
   * same rule `wishesNamed` states for a waiting stop or cancel: a request that
   * is neither sent nor dropped is an operation that never retires. A delete
   * supersedes everything for its conversation, the rename included, and there
   * is nothing to rename in a conversation that is going.
   */
  it("drops what a delete took over, and sends only the delete", () => {
    const renamed = twice(opening(), {
      type: "rename.started",
      op: { id: RENAME_A, kind: "rename", threadId: "guess-thread", title: "mine" },
    }).state;
    const removed = twice(renamed, {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "guess-thread" },
    }).state;
    expect(removed.operations.get(RENAME_A)?.superseded, "the premise").toBe(true);

    const named = twice(removed, begun(REAL));
    expect(named.commands.filter((c) => c.type === "rename" || c.type === "delete")).toEqual([
      { type: "delete", opId: DELETE, slug: SLUG, threadId: REAL },
    ]);
    expect(named.state.operations.has(RENAME_A), "a held rename was left in the map").toBe(false);
  });

  /**
   * **The residue, named rather than left to be found.** A turn that dies before
   * its frame leaves the mutation held and unsent — and that is right, because a
   * conversation the server never wrote down has nothing to delete or rename.
   * The reader sees what they asked for either way: the tombstone is `final` and
   * the title is in `base`.
   *
   * It is held rather than dropped so that a *later* turn into the same
   * conversation still carries it — the rename the reader made while their first
   * question was failing is still theirs. The one case this cannot cover is a
   * stream lost **after** `beginTurn` wrote the thread and before the frame was
   * read; there the conversation exists on the server under a name this tab
   * never learned, and it arrives on the next load. Sending early did not cover
   * it either — that request raced the same write.
   */
  it("stays held, and silent, when the turn dies before it is named", () => {
    const removed = twice(opening(), {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: "guess-thread" },
    });
    const held = removed.state;
    const dead = twice(held, { type: "turn.failed", opId: TURN_A, error: "the network" });
    /* Every command the whole sequence asked for, not only the last transition's
       — the request that must not exist is the one sent at the moment the reader
       pressed the button. */
    expect(
      [...removed.commands, ...dead.commands].filter((c) => c.type === "delete"),
      "a request went out for a conversation that was never written",
    ).toEqual([]);
    expect(titles(dead.state)).toEqual([]);
    expect(dead.state.operations.has(DELETE), "the delete was dropped, so a later send cannot carry it").toBe(true);
    expect(dead.state.error, "a delete that was never sent reported a failure").toBeNull();
  });
});
