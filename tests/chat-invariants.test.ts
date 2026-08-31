/**
 * **The seven things that must be true after any sequence of events.**
 *
 * Stage 3 of docs/plans/260828v-chat-operation-model.md, and GPT Sol's list from the
 * very first review of the plan — written before any of this existed, on the
 * grounds that a machine like this is worth having only if you can say what it
 * guarantees rather than what it does in the cases somebody thought of.
 *
 * The difference from tests/chat-reduce.test.ts is the shape of the question.
 * That file asks *what does this transition do*, one sequence at a time. This
 * one asks *what is true afterwards*, over **every order** of a handful of
 * events — because the bugs this directory exists to remove were all orderings:
 * the earlier load answering last, the newer rename committing first, the 409
 * landing after the send it had nothing to do with. A single hand-written
 * sequence cannot tell an invariant from an accident of arrangement.
 *
 * Every check runs **after every step**, not only at the end: the controller
 * tells React after every dispatch, so a reader can see any intermediate state,
 * and an invariant that is briefly false is false.
 *
 * **Each of these was made to fail before it was kept.** The probe is written on
 * the test that names it, saying which clause was disabled and what went red. An
 * invariant nothing can break is not an invariant of this machine; it is a
 * sentence about one, and the difference is the whole point of the exercise —
 * docs/reusable/silent-success.md. Two of the seven are narrower than Sol's
 * wording, and both say so and why.
 *
 * No React, no jsdom, no fetch. This is the payoff for the reducer being pure:
 * asking any of these of the old `useChat.ts` would have meant `createRoot` and
 * `act` and a stubbed `fetch` per ordering, which is why none of them was ever
 * asked.
 */
import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatThread } from "../src/types.js";
import type { ChatEvent, ChatInput, ChatState, OpId } from "../src/web/chat/model.js";
import { asOpId, initialState, writerOf } from "../src/web/chat/model.js";
import { project } from "../src/web/chat/project.js";
import { inEveryOrder, permutations, twice } from "./helpers/chat-reduce.js";

const SLUG = "a-piece";
const AT = "2026-08-27T11:00:00.000Z";

const LOAD = asOpId("spya-load01");
const TURN_A = asOpId("spya-turn01");
const TURN_B = asOpId("spya-turn02");
const RENAME_A = asOpId("spya-name01");
const RENAME_B = asOpId("spya-name02");
const DELETE = asOpId("spya-del001");
const REPAIR = asOpId("spya-fix001");
const RECOVER = asOpId("spya-rec001");
const OTHER_RECOVER = asOpId("spya-rec002");
const WISH = asOpId("spya-wish01");
const OTHER_WISH = asOpId("spya-wish02");

const THREAD = "spya-t1";

function message(m: Partial<ChatMessage> & { id: string }): ChatMessage {
  return { role: "assistant", text: "", createdAt: AT, status: "pending", ...m };
}

function thread(id: string, title: string, messages: ChatMessage[] = []): ChatThread {
  return { id, kind: "chat", title, createdAt: AT, updatedAt: AT, messages };
}

/** A hook that has loaded these conversations and is doing nothing else. */
function loaded(...threads: ChatThread[]): ChatState {
  const started = twice(initialState(SLUG), {
    type: "load.started",
    op: { id: LOAD, kind: "load" },
  }).state;
  return twice(started, { type: "load.succeeded", opId: LOAD, threads }).state;
}

/** One finished turn, which is what most of these start from. */
function conversation(id = THREAD): ChatThread {
  return thread(id, "a conversation", [
    message({ id: "q1", role: "user", text: "why?", status: "done" }),
    message({ id: "a1", text: "because.", status: "done" }),
  ]);
}

function turn(op: {
  id: OpId;
  shape: "send" | "retry" | "edit";
  threadId?: string;
  replyId?: string;
  question?: ChatMessage | null;
  editing?: string | null;
  opening?: ChatThread | null;
  title?: string | null;
}): Extract<ChatInput, { type: "turn.started" }> {
  const replyId = op.replyId ?? "a-new";
  return {
    type: "turn.started",
    op: {
      id: op.id,
      kind: "turn",
      shape: op.shape,
      threadId: op.threadId ?? THREAD,
      replyId,
      reply: message({ id: replyId }),
      question: op.question ?? null,
      editing: op.editing ?? null,
      opening: op.opening ?? null,
      title: op.title ?? null,
      at: AT,
      began: false,
      attempt: null,
    },
    payload: { question: "why?" },
  };
}

function sending(id: OpId, replyId: string, questionId: string, threadId = THREAD) {
  return turn({
    id,
    shape: "send",
    threadId,
    replyId,
    question: message({ id: questionId, role: "user", text: "and?", status: "done" }),
  });
}

const DONE = { text: "an answer", citations: [], searches: 0, model: "m" };

/* ------------------------------------------------------------------------- */

describe("a stale or terminal operation can never change state", () => {
  /**
   * The rule the whole directory is for: an operation that has retired, or that
   * a later one replaced outright, is not in the map, and **every** answer it
   * could give is refused by the same three lines — success, failure, timeout,
   * frame, alike.
   *
   * **Probe: making `withoutOp` a no-op** — so an operation never actually
   * retires — turns this red along with three others. That is the honest probe,
   * and the first one tried was not: the gate's `!op` half cannot be disabled at
   * all, because everything past it is written against an operation that was
   * found, so removing it does not produce a wrong answer, it produces a crash.
   * What that half really rests on is *retirement*, which is what this probe
   * takes away. Deleting `accepts` reddens the crossed-kind case below.
   */
  it("refuses every answer a retired operation could still give", () => {
    const start = loaded(conversation());
    /* Four operations, each driven to the end of its life, so the map is empty
       and every id below names something that no longer exists. */
    let state = twice(start, { type: "rename.started", op: { id: RENAME_A, kind: "rename", threadId: THREAD, title: "renamed" } }).state;
    state = twice(state, { type: "rename.succeeded", opId: RENAME_A }).state;
    state = twice(state, sending(TURN_A, "a-new", "q-new")).state;
    state = twice(state, { type: "turn.done", opId: TURN_A, done: DONE }).state;
    expect(state.operations.size, "the premise: nothing is in flight").toBe(0);

    const late: ChatEvent[] = [
      { type: "load.succeeded", opId: LOAD, threads: [thread("spya-other", "a stale list")] },
      { type: "load.failed", opId: LOAD, error: "late" },
      { type: "rename.succeeded", opId: RENAME_A },
      { type: "rename.failed", opId: RENAME_A, error: "late" },
      { type: "delete.succeeded", opId: DELETE },
      { type: "delete.failed", opId: DELETE, error: "late" },
      { type: "turn.began", opId: TURN_A, begun: { threadId: "srv-t", title: "t", messageId: "srv-a" } },
      { type: "turn.delta", opId: TURN_A, text: "more" },
      { type: "turn.tool", opId: TURN_A, index: 0, run: { name: "search", status: "running" } as never },
      { type: "turn.done", opId: TURN_A, done: DONE },
      { type: "turn.failed", opId: TURN_A, error: "late" },
      { type: "turn.disconnected", opId: TURN_A, error: "late", recovery: { id: RECOVER, until: 1 } },
      { type: "turn.refused", opId: TURN_A, error: "late", repair: { id: REPAIR } },
      { type: "repair.succeeded", opId: REPAIR, thread: thread(THREAD, "a stale copy") },
      { type: "repair.failed", opId: REPAIR, error: "late" },
      { type: "recovery.found", opId: RECOVER, message: message({ id: "a1", status: "done" }) },
      { type: "recovery.givenUp", opId: RECOVER, error: "late" },
      { type: "recovery.stopped", opId: RECOVER },
      { type: "intent.succeeded", opId: WISH },
      { type: "intent.failed", opId: WISH, error: "late" },
    ];

    /* Not permuted, and it does not need to be: nothing here changes the state,
       so every order is the same order. Asserting the **same object** back is
       what says so — the controller's cached projection depends on it. */
    for (const event of late) {
      const after = twice(state, event);
      expect(after.state, `${event.type} was admitted after its operation retired`).toBe(state);
      expect(after.commands, `${event.type} asked for work`).toEqual([]);
    }
  });

  /**
   * And the other half of the gate: ids are minted per article by one
   * `mintId()` and are promised to be unique to nothing, so an answer must also
   * belong to an operation of the **matching kind**.
   *
   * Probe: making `accepts` return `true` turns this red.
   */
  it("refuses an answer aimed at an operation of another kind", () => {
    const start = twice(loaded(conversation()), {
      type: "rename.started",
      op: { id: RENAME_A, kind: "rename", threadId: THREAD, title: "renamed" },
    }).state;
    for (const event of [
      { type: "delete.failed", opId: RENAME_A, error: "no" },
      { type: "load.succeeded", opId: RENAME_A, threads: [] },
      { type: "intent.failed", opId: RENAME_A, error: "no" },
      { type: "turn.delta", opId: RENAME_A, text: "no" },
    ] as ChatEvent[]) {
      expect(twice(start, event).state, `${event.type} crossed kinds`).toBe(start);
    }
  });
});

describe("every pending answer has at most one writer", () => {
  /**
   * **At most one, and that is narrower than Sol's wording on purpose.**
   *
   * "Exactly one" is not true of this machine and should not be: a `pending` row
   * that arrived from a load, or from a hook that has since unmounted, has **no**
   * writer until something starts looking for it — and what starts looking is
   * the scan in `useChat.ts`, which is not the reducer's. So the half that lives
   * here is the half the reducer can break, and it is the half that matters: two
   * writers for one row is two things patching one message from two
   * vocabularies, which is what `owned` and `watched` used to be.
   *
   * Probe: deleting the `writerOf` check from `startRecovery` turns this red.
   * That check is the *only* copy — `turn.disconnected` used to carry a second
   * one, which reddened nothing because this one always ran first.
   */
  const lost: ChatEvent = {
    type: "turn.disconnected",
    opId: TURN_A,
    error: "the stream went quiet",
    recovery: { id: RECOVER, until: 1_000 },
  };
  const scanned: ChatInput = {
    type: "recovery.started",
    op: { id: OTHER_RECOVER, kind: "recovery", threadId: THREAD, messageId: "a-new", until: 2_000, attempt: null },
  };

  /** How many operations claim to be writing this row. */
  function writers(state: ChatState, messageId: string): number {
    let n = 0;
    for (const op of state.operations.values()) {
      if (op.kind === "turn" && op.replyId === messageId) n += 1;
      if (op.kind === "recovery" && op.messageId === messageId) n += 1;
    }
    return n;
  }

  it("never lets two operations claim one row, in any order", () => {
    const start = twice(
      twice(loaded(conversation()), sending(TURN_A, "a-new", "q-new")).state,
      {
        type: "turn.began",
        opId: TURN_A,
        begun: { threadId: THREAD, title: "a conversation", messageId: "a-new", attempt: "att-1" },
      },
    ).state;

    inEveryOrder(start, [lost, scanned, { type: "turn.delta", opId: TURN_A, text: "half" }], (state, story) => {
      expect(writers(state, "a-new"), `two writers for one row after ${story}`).toBeLessThanOrEqual(1);
    });
  });

  /**
   * And the premise, without which the test above passes on a reducer that
   * never starts a recovery at all: a lost stream **does** leave one.
   */
  it("leaves exactly one writer when a named stream is lost", () => {
    const named = twice(
      twice(loaded(conversation()), sending(TURN_A, "a-new", "q-new")).state,
      {
        type: "turn.began",
        opId: TURN_A,
        begun: { threadId: THREAD, title: "a conversation", messageId: "a-new", attempt: "att-1" },
      },
    ).state;
    const after = twice(named, lost).state;
    expect(writers(after, "a-new")).toBe(1);
    expect(writerOf(after, "a-new")?.kind).toBe("recovery");
  });
});

describe("a tombstoned conversation cannot be projected back", () => {
  /**
   * Deletions win over **every** projection, including operations registered
   * after them and answers that arrive long afterwards. The events below are
   * every way this codebase has of putting a conversation on screen.
   *
   * Probe: dropping the tombstone filter from `project` turns this red.
   *
   * **And one probe that reddened nothing, which is worth more than the one that
   * did.** `mergedArrival` has a deletions-win clause of its own, and removing
   * it changes nothing here — because the projection filter above it always
   * holds, whatever reaches `base`. It is not dead: it keeps a deleted
   * conversation out of `base` in the one case this scenario cannot reach, where
   * the reader deletes something the arriving list is the *first* to mention
   * (pinned in tests/chat-reduce.test.ts). But for what the reader sees it is
   * implied, and saying so is better than implying a probe found it load-bearing.
   */
  it("stays gone whatever arrives, in any order", () => {
    const start = twice(
      twice(loaded(conversation()), sending(TURN_A, "a-new", "q-new")).state,
      { type: "delete.started", op: { id: DELETE, kind: "delete", threadId: THREAD } },
    ).state;

    const events: ChatEvent[] = [
      { type: "turn.done", opId: TURN_A, done: DONE },
      /* A list fetched before the delete still has it — the load's own
         `mergedArrival` is what has to refuse it. */
      { type: "load.started", op: { id: asOpId("spya-load09"), kind: "load" } },
      { type: "load.succeeded", opId: asOpId("spya-load09"), threads: [conversation()] },
      { type: "rename.started", op: { id: RENAME_A, kind: "rename", threadId: THREAD, title: "back?" } },
      { type: "thread.begun", thread: conversation() },
    ];

    inEveryOrder(start, events, (state, story) => {
      expect(
        project(state).some((t) => t.id === THREAD),
        `a deleted conversation was projected back after ${story}`,
      ).toBe(false);
    });
  });
});

describe("stop and discard cannot coexist", () => {
  /**
   * **This one is stated more carefully than Sol's line, and the permutation is
   * why.**
   *
   * "One of them fires, ever" was the comment on the two collections in the
   * hook, and it was true of the window they were written for — before the
   * `begin` frame, where a wish waits and a second one replaces it. It is not
   * achievable afterwards: if the reader presses stop and the request goes, then
   * presses cancel, the stop cannot be un-sent. So the machine holds three
   * things instead, and the third is a fix this test found:
   *
   * 1. **at most one wish is live for a row** at any moment — an older one is
   *    superseded the instant a newer arrives, so it has nothing left to say;
   * 2. **a waiting wish is never joined by a second**, which is the window the
   *    old comment was about;
   * 3. **a stop is never issued into a conversation that is going.** `began →
   *    stop → cancel` and `cancel → stop` were two of the six orders here and
   *    neither had ever been asked; both sent a `/stop` naming a row in a
   *    conversation the server was being told to discard, whose failure would
   *    then write "Couldn't stop that answer" over a discard that worked.
   *
   * Probes: removing the replace loop from `startIntent` reddens 2; removing the
   * tombstone check at the top of it reddens 3.
   */
  it("never sends both for one row, in any order", () => {
    const start = twice(loaded(conversation()), sending(TURN_A, "a-new", "q-new")).state;
    const events: ChatEvent[] = [
      { type: "intent.started", op: { id: WISH, intent: "stop", threadId: THREAD, messageId: "a-new" } },
      { type: "intent.started", op: { id: OTHER_WISH, intent: "cancel", threadId: THREAD, messageId: "a-new" } },
      { type: "turn.began", opId: TURN_A, begun: { threadId: THREAD, title: "a conversation", messageId: "a-new", attempt: "att-1" } },
    ];

    for (const order of permutations(events)) {
      let state = start;
      const told: string[] = [];
      let discarding = false;
      for (const event of order) {
        told.push(event.type);
        const out = twice(state, event);
        state = out.state;
        const story = told.join(" → ");

        const wishes = [...state.operations.values()].filter(
          (op) => op.kind === "intent" && op.messageId === "a-new",
        );
        /* 1. One live wish. An older one is still in the map until it answers —
           it was sent and the answer has to retire it — but it is superseded, so
           it has nothing left to say. */
        expect(
          wishes.filter((op) => !op.superseded).length,
          `two live wishes for one row after ${story}`,
        ).toBeLessThanOrEqual(1);
        /* 2. And never two waiting, which is the window the whole mechanism
           exists for: neither has been sent, so a second is pure duplication. */
        expect(
          wishes.filter((op) => op.kind === "intent" && op.waitingOn !== null).length,
          `two wishes waiting on one frame after ${story}`,
        ).toBeLessThanOrEqual(1);

        /* 3. And a stop is never asked for once the conversation is going. */
        for (const c of out.commands) {
          if (c.type !== "intent") continue;
          expect(
            c.intent === "stop" && discarding,
            `a stop was sent into a conversation being discarded, after ${story}`,
          ).toBe(false);
          if (c.intent === "cancel") discarding = true;
        }
        if (state.tombstones.has(THREAD)) discarding = true;
      }
    }
  });
});

describe("turn.began changes every name in one transition", () => {
  /**
   * The thread, the question and the answer — and the two this stage found
   * afterwards, the tombstone and every other operation keyed on the id this tab
   * invented. Two of three shipped once and came back weeks later as "That
   * message is not in this conversation."
   *
   * Asserted as a **whole-state scan for the old names** rather than as a list
   * of fields, because the failure mode is always the field nobody listed.
   *
   * **Every order of the three things that can be in flight, and the frame is
   * always last** — which is a narrowing of what this file's header promises, and
   * it is stated rather than implied because GPT Sol found the words claiming
   * more than the test did, 2026-08-28. It used to sample three of the six orders
   * as well. The frame is last on purpose: the invariant is about names minted
   * *before* the server supplied one, and an event arriving afterwards names the
   * conversation the server named, which is a different sentence and true by
   * construction. What is exercised is therefore permutations of the window, not
   * of the frame's position in it.
   *
   * Probes: each of the three id swaps in `withServerIds`, and each half of
   * `renamed`, turns this red on its own — five probes, one rule. And two more
   * since the scan was widened: `knownAs` made a no-op, so the provisional name
   * stays in `unnamed`; and `startTurn` keeping `opening` on the registered
   * operation, so the thread it invented keeps its old id in a field of its own.
   *
   * **It said "whole-state scan" and was a list of fields, and it missed two of
   * them** — `state.unnamed` and `TurnOperation.opening` — which GPT Sol found on
   * 2026-08-28, the third round running in which a test here claimed more than it
   * checked. So it is no longer a list. It walks the state: every object, every
   * array, every `Map` key and value, every `Set` member, and reports the path of
   * any string equal to the name. A field added next year is scanned the day it
   * is added, and nothing is exempted on the grounds that nothing reads it —
   * "nothing reads it today" is how the id contract gets broken a release later.
   *
   * Ids are `spya-…`-shaped and prose is not, so a walk that compares whole
   * strings cannot collide with a title or an error message.
   */
  interface Hunt {
    name: string;
    /* Every reference once: the state shares objects all over — a repair's `saw`
       is a thread in `base` — and this is also what stops a cycle. */
    seen: Set<unknown>;
    found: string[];
  }

  function walk(value: unknown, path: string, hunt: Hunt): void {
    if (typeof value === "string") {
      if (value === hunt.name) hunt.found.push(path);
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (hunt.seen.has(value)) return;
    hunt.seen.add(value);
    if (value instanceof Map) {
      for (const [key, held] of value) {
        walk(key, `${path} key`, hunt);
        walk(held, `${path}[${String(key)}]`, hunt);
      }
      return;
    }
    if (value instanceof Set) {
      for (const held of value) walk(held, `${path} member`, hunt);
      return;
    }
    /* Arrays come through `Object.entries` as well, keyed by index, so there is
       one branch here rather than two. */
    for (const [key, held] of Object.entries(value)) walk(held, `${path}.${key}`, hunt);
  }

  function mentions(state: ChatState, name: string): string[] {
    const hunt: Hunt = { name, seen: new Set(), found: [] };
    walk(state, "state", hunt);
    return hunt.found;
  }

  it("leaves no provisional name anywhere in the state, whatever else is in flight", () => {
    const opened = twice(
      loaded(),
      turn({
        id: TURN_A,
        shape: "send",
        threadId: "guess-thread",
        replyId: "guess-a",
        question: message({ id: "guess-q", role: "user", text: "why?", status: "done" }),
        opening: thread("guess-thread", "why?"),
      }),
    ).state;

    /* Everything a reader can have started in the window before the frame comes
       back, each of which names the conversation the only way it can. */
    const before: ChatEvent[] = [
      { type: "intent.started", op: { id: WISH, intent: "cancel", threadId: "guess-thread", messageId: "guess-a" } },
      { type: "rename.started", op: { id: RENAME_A, kind: "rename", threadId: "guess-thread", title: "mine" } },
      sending(TURN_B, "a-two", "q-two", "guess-thread"),
    ];
    const begun: ChatEvent = {
      type: "turn.began",
      opId: TURN_A,
      begun: {
        threadId: "spya-real1",
        title: "why?",
        messageId: "srv-a",
        questionId: "srv-q",
        attempt: "att-1",
      },
    };

    for (const window of permutations(before)) {
      const order = [...window, begun];
      let state = opened;
      for (const event of order) state = twice(state, event).state;
      for (const gone of ["guess-thread", "guess-a", "guess-q"]) {
        expect(mentions(state, gone), `${gone} survived the frame`).toEqual([]);
      }
      /* And the server's names are all there, which is what stops this passing
         on a reducer that simply threw the conversation away. */
      expect(state.base.some((t) => t.id === "spya-real1")).toBe(true);
      expect(mentions(state, "srv-a").length).toBeGreaterThan(0);
    }
  });
});

describe("retiring one operation says nothing about another", () => {
  /**
   * Two live operations in one conversation, finishing in either order. Retiring
   * the first must leave the second live, still drawing, and still able to be
   * admitted — the thing that goes wrong when supersession is drawn too wide or
   * when a retirement clears more than its own entry.
   *
   * Probe: widening `startTurn`'s `replaces` from `() => false` to "everything
   * for this conversation" turns this red, and so does making `withoutOp` a
   * no-op, which is the other way to get retirement wrong.
   */
  it("leaves the other one live and drawing, whichever finishes first", () => {
    const start = twice(
      twice(loaded(conversation()), sending(TURN_A, "a-one", "q-one")).state,
      sending(TURN_B, "a-two", "q-two"),
    ).state;

    for (const [first, second] of [
      [TURN_A, TURN_B],
      [TURN_B, TURN_A],
    ] as const) {
      const one = twice(start, { type: "turn.done", opId: first, done: { ...DONE, text: `${first} answered` } }).state;
      expect(one.operations.has(second), "the other operation went with it").toBe(true);

      /* Still drawing: a delta on the survivor still reaches the screen. */
      const moved = twice(one, { type: "turn.delta", opId: second, text: "still here" }).state;
      const rows = project(moved).find((t) => t.id === THREAD)?.messages ?? [];
      expect(rows.find((m) => m.id === (second === TURN_A ? "a-one" : "a-two"))?.text).toBe(
        "still here",
      );
      /* And the reader's own order is untouched by which of them finished. */
      expect(rows.map((m) => m.id)).toEqual(["q1", "a1", "q-one", "a-one", "q-two", "a-two"]);
    }
  });

  /**
   * The same across kinds, which is the case a turn-only test would miss: a
   * rename retiring must not take a delete's tombstone, a recovery, or a wish
   * with it.
   */
  it("retires each kind without disturbing the others", () => {
    let state = loaded(conversation());
    state = twice(state, { type: "rename.started", op: { id: RENAME_A, kind: "rename", threadId: THREAD, title: "renamed" } }).state;
    state = twice(state, sending(TURN_A, "a-new", "q-new")).state;
    state = twice(state, {
      type: "recovery.started",
      op: { id: RECOVER, kind: "recovery", threadId: THREAD, messageId: "a1", until: 1_000, attempt: null },
    }).state;
    expect(state.operations.size).toBe(3);

    const finishing: ChatEvent[] = [
      { type: "rename.succeeded", opId: RENAME_A },
      { type: "turn.done", opId: TURN_A, done: DONE },
      { type: "recovery.stopped", opId: RECOVER },
    ];
    inEveryOrder(state, finishing, (after, story) => {
      /* Whatever has not answered yet is still there. Counted rather than
         named, so a retirement that took a bystander with it shows up here
         however it did it. */
      const gone = finishing.filter((e) => "opId" in e && !after.operations.has(e.opId)).length;
      expect(after.operations.size, `an operation vanished without answering after ${story}`).toBe(
        3 - gone,
      );
    });
  });
});

describe("success and failure are admitted by the same rule", () => {
  /**
   * **The bug this whole directory is for, stated as an invariant.** Twice the
   * same bug shipped because a guard went on the success path and the failure
   * path beside it was a separate place to remember: `loadFailed` first, then
   * `error` in the same function's `catch` a day later. And it happened a third
   * time in stage 2 — a superseded repair's success was silent and its failure
   * still wrote `error`.
   *
   * So: for every kind, take a state where the operation has no standing left,
   * and assert its success and its failure do **the same thing**. Not "both are
   * refused" — the same thing, compared to each other, so a rule that changes
   * cannot drift apart again.
   *
   * Probes, and the second is the one worth having: removing the superseded
   * rule from the gate reddens this, and so does applying it to everything
   * **except** the `.failed` events — which is precisely the code as it stood
   * before this stage, and precisely the shape of bugs 10 and 12.
   *
   * **"Every kind" left the turn out**, which GPT Sol found on 2026-08-28 — the
   * one kind with two endings that write, and the one where a wish can be left
   * waiting. It is in both tables now, retired and superseded. The pair is
   * `turn.done` against `turn.failed`: the *endings*, which is what this
   * invariant is about. `turn.began` is deliberately not paired with anything,
   * because it is the one event a superseded operation is still admitted for —
   * see `names()` in reduce.ts — and it is not an ending.
   *
   * **Watched failing:** exempting `turn.failed` alone from the gate's
   * superseded rule — bugs 10 and 12 aimed at the kind that was missing — reddens
   * exactly one test and one assertion, `b.base` against `a.base`, because the
   * discarded turn's failure writes an error row into a conversation whose
   * success writes nothing at all.
   */
  const pairs: [string, ChatEvent, ChatEvent][] = [
    ["load", { type: "load.succeeded", opId: LOAD, threads: [conversation()] }, { type: "load.failed", opId: LOAD, error: "no" }],
    ["rename", { type: "rename.succeeded", opId: RENAME_B }, { type: "rename.failed", opId: RENAME_B, error: "no" }],
    ["delete", { type: "delete.succeeded", opId: DELETE }, { type: "delete.failed", opId: DELETE, error: "no" }],
    ["repair", { type: "repair.succeeded", opId: REPAIR, thread: conversation() }, { type: "repair.failed", opId: REPAIR, error: "no" }],
    ["recovery", { type: "recovery.found", opId: RECOVER, message: message({ id: "a1", status: "done" }) }, { type: "recovery.givenUp", opId: RECOVER, error: "no" }],
    ["intent", { type: "intent.succeeded", opId: WISH }, { type: "intent.failed", opId: WISH, error: "no" }],
    ["turn", { type: "turn.done", opId: TURN_A, done: DONE }, { type: "turn.failed", opId: TURN_A, error: "no" }],
  ];

  it("treats both endings alike when the operation is gone", () => {
    const start = loaded(conversation());
    for (const [kind, won, lost] of pairs) {
      const a = twice(start, won);
      const b = twice(start, lost);
      expect(a.state, `${kind}'s success was admitted after it retired`).toBe(start);
      expect(b.state, `${kind}'s failure was admitted after it retired`).toBe(start);
      expect(a.commands).toEqual(b.commands);
    }
  });

  /**
   * And when it is **superseded**, which is the harder half: the operation is
   * still in the map, so the gate finds it. It retires and says nothing, and the
   * two endings agree about that.
   */
  it("treats both endings alike when the operation has been superseded", () => {
    /* A rename replaced by a newer one, and a cancel the reader has since
       overtaken with a delete. **The repair is built separately, below**, and it
       used to be named here and not exercised — the docstring said three ways and
       the loop had two, which GPT Sol found on 2026-08-28. A repair is superseded
       only by another repair of the same conversation, and reaching that needs
       two refused turns rather than another line in this sequence. */
    let state = loaded(conversation());
    state = twice(state, { type: "rename.started", op: { id: RENAME_A, kind: "rename", threadId: THREAD, title: "first" } }).state;
    state = twice(state, { type: "intent.started", op: { id: WISH, intent: "cancel", threadId: THREAD, messageId: "a1" } }).state;
    state = twice(state, { type: "rename.started", op: { id: RENAME_B, kind: "rename", threadId: THREAD, title: "second" } }).state;
    state = twice(state, { type: "delete.started", op: { id: DELETE, kind: "delete", threadId: THREAD } }).state;
    const quiet = twice(state, { type: "error.set", error: null }).state;
    expect(quiet.operations.get(RENAME_A)?.superseded, "the premise: it is superseded").toBe(true);
    expect(quiet.operations.get(WISH)?.superseded).toBe(true);

    /* Two turns into one conversation, each refused, so the second repair takes
       the first one's job. That is the case the plan's stage 2 fixed and this
       assertion is the one that was missing: a superseded repair's success was
       silent while its failure still wrote `error`. */
    let refused = twice(loaded(conversation()), sending(TURN_A, "a-one", "q-one")).state;
    refused = twice(refused, sending(TURN_B, "a-two", "q-two")).state;
    refused = twice(refused, { type: "turn.refused", opId: TURN_A, error: "no", repair: { id: REPAIR } }).state;
    refused = twice(refused, {
      type: "turn.refused",
      opId: TURN_B,
      error: "no",
      repair: { id: asOpId("spya-fix002") },
    }).state;
    const settled = twice(refused, { type: "error.set", error: null }).state;
    expect(settled.operations.get(REPAIR)?.superseded, "the premise: the repair is superseded").toBe(
      true,
    );

    /* And a turn, which is the kind that was missing here — GPT Sol, 2026-08-28.
       A turn is superseded by exactly one thing, a delete of its conversation, so
       that is how this state is reached. Both endings must retire it in silence
       and leave the discard alone; a turn is also the only kind with a wish that
       can be waiting on it, which is why the map is compared and not just
       `error`. */
    let discarded = twice(loaded(conversation()), sending(TURN_A, "a-one", "q-one")).state;
    discarded = twice(discarded, { type: "delete.started", op: { id: DELETE, kind: "delete", threadId: THREAD } }).state;
    expect(discarded.operations.get(TURN_A)?.superseded, "the premise: the turn is superseded").toBe(
      true,
    );

    for (const [kind, from, won, lost] of [
      ["rename", quiet, { type: "rename.succeeded", opId: RENAME_A }, { type: "rename.failed", opId: RENAME_A, error: "no" }],
      ["intent", quiet, { type: "intent.succeeded", opId: WISH }, { type: "intent.failed", opId: WISH, error: "no" }],
      ["repair", settled, { type: "repair.succeeded", opId: REPAIR, thread: conversation() }, { type: "repair.failed", opId: REPAIR, error: "no" }],
      ["turn", discarded, { type: "turn.done", opId: TURN_A, done: DONE }, { type: "turn.failed", opId: TURN_A, error: "no" }],
    ] as [string, ChatState, ChatEvent, ChatEvent][]) {
      const a = twice(from, won).state;
      const b = twice(from, lost).state;
      expect(b.error, `${kind}'s superseded failure reported`).toBeNull();
      expect(a.error, `${kind}'s superseded success reported`).toBeNull();
      /* The same state, not merely two states with nothing in `error`: this is
         what stops the two branches drifting apart again. */
      expect([...b.operations.keys()], `${kind}'s two endings left different maps`).toEqual([
        ...a.operations.keys(),
      ]);
      expect([...b.tombstones.entries()]).toEqual([...a.tombstones.entries()]);
      expect(b.base).toEqual(a.base);
    }
  });
});
