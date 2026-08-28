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
import type { ChatThread } from "../src/types.js";
import type { ChatEvent, ChatState, OpId } from "../src/web/chat/model.js";
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

  it("still hears the superseded one fail, and still does not let it draw", () => {
    const start = loaded(thread("spya-t1", "as it was"));
    const first = renaming(start, RENAME_A, "spya-t1", "first name");
    const second = renaming(first, RENAME_B, "spya-t1", "second name");

    const a = twice(second, { type: "rename.failed", opId: RENAME_A, error: "the network" }).state;

    /* Admitted — its failure has something to say — with nothing left to draw. */
    expect(a.error).toBe("Couldn't rename that conversation: the network");
    expect(titles(a)).toEqual(["second name"]);
  });

  it("keeps the title when a rename succeeds and the operation retires", () => {
    const start = loaded(thread("spya-t1", "as it was"));
    const renamed = renaming(start, RENAME_A, "spya-t1", "the new name");
    expect(titles(renamed)).toEqual(["the new name"]);

    const done = twice(renamed, { type: "rename.succeeded", opId: RENAME_A }).state;
    expect(done.operations.size).toBe(0);
    /* Committed to `base` on the way out. An operation that retired without
       committing would take the title off the screen with it. */
    expect(titles(done)).toEqual(["the new name"]);
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
    const cancelled = twice(start, { type: "tombstone.added", threadId: "spya-t1" }).state;
    expect(titles(cancelled)).toEqual([]);

    /* The tombstone is the whole of the optimistic removal — the conversation
       never left `base` — so removing it is the rollback, and there is no copy
       to keep anywhere. That is what let the `latest` ref go. */
    const back = twice(cancelled, { type: "tombstone.removed", threadId: "spya-t1" }).state;
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
