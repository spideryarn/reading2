/**
 * **A spoken exchange as an operation, not a second writer.**
 *
 * The plan for live conversation was reviewed and refused once on exactly this
 * point: `src/web/chat/` holds one invariant — every asynchronous action has an
 * identity, a projection it alone may update, and a rule for when it stops
 * being entitled to write — and a spoken POST beside it is that invariant
 * quietly ending. So the spoken append is an operation, and this file is the
 * three things that makes true.
 *
 * **It draws rather than writes**, unlike a send. A send's rows go into `base`
 * at registration because nothing takes a typed question back; these are taken
 * back by exactly one thing, and that thing happens — the server refuses an
 * append behind a conversation that has moved on. Drawing them makes the
 * refusal a dropped map entry instead of a repair race.
 *
 * **The success is where the ids change hands.** The server may create the
 * conversation, and may overrule the id this tab invented for it. The reader
 * would never see the difference; the *next* append would, because it has to
 * name the tail.
 *
 * **And the reducer stays pure.** Every transition here runs twice against a
 * deep-frozen state whose `Map`s throw on `set` — see helpers/chat-reduce.ts.
 *
 * docs/plans/260831l-live-conversation-in-chat.md § 1.
 */
import { describe, expect, it } from "vitest";

import type { ChatMessage, ChatThread } from "../src/types.js";
import type { ChatInput, ChatState } from "../src/web/chat/model.js";
import { asOpId, initialState } from "../src/web/chat/model.js";
import { project, storedSpoken } from "../src/web/chat/project.js";
import { twice } from "./helpers/chat-reduce.js";

const SLUG = "a-piece";
const SPOKEN = asOpId("spya-spok01");
const REPAIR = asOpId("spya-rep001");
const AT = "2026-08-31T12:00:00.000Z";

function message(id: string, role: ChatMessage["role"], text: string): ChatMessage {
  return { id, role, text, createdAt: AT, status: "done" };
}

function thread(id: string, messages: ChatMessage[] = []): ChatThread {
  return {
    id,
    kind: "chat",
    title: "New chat",
    createdAt: AT,
    updatedAt: AT,
    messages,
  };
}

/** A state with one conversation in `base`, holding one typed turn. */
function withTypedTurn(): ChatState {
  return {
    ...initialState(SLUG),
    base: [
      thread("spya-thra01", [
        message("spya-msgu01", "user", "typed question"),
        message("spya-msga01", "assistant", "typed answer"),
      ]),
    ],
    loadPhase: "ready",
  };
}

const started = (over: Record<string, unknown> = {}): ChatInput => ({
  type: "spoken.started",
  op: {
    id: SPOKEN,
    kind: "spoken",
    threadId: "spya-thra01",
    question: message("spya-locq01", "user", "spoken question"),
    reply: message("spya-loca01", "assistant", "spoken answer"),
    expectedTailId: "spya-msga01",
    at: AT,
    ...over,
  } as ChatInput extends { type: "spoken.started"; op: infer O } ? O : never,
});

/** What the server hands back: the same conversation, under its own ids. */
const stored = thread("spya-thra01", [
  message("spya-msgu01", "user", "typed question"),
  message("spya-msga01", "assistant", "typed answer"),
  message("spya-srvq01", "user", "spoken question"),
  message("spya-srva01", "assistant", "spoken answer"),
]);

describe("registering one", () => {
  it("draws the two rows and writes NOTHING into base", () => {
    /* The distinction this whole design turns on. If these went into `base`,
       the 409 below could only be undone by fetching the conversation and
       hoping nothing else was happening in it. */
    const { state, commands } = twice(withTypedTurn(), started());
    expect(state.base[0]?.messages).toHaveLength(2);
    expect(project(state)[0]?.messages.map((m) => m.text)).toEqual([
      "typed question",
      "typed answer",
      "spoken question",
      "spoken answer",
    ]);
    expect(commands).toEqual([
      expect.objectContaining({ type: "spoken", opId: SPOKEN, threadId: "spya-thra01" }),
    ]);
  });

  it("sends a null tail as a null, not as an absent key", () => {
    /* "I believe this conversation is empty" and "I forgot to say" are
       different claims, and the server refuses the second. A command that
       dropped the key would turn the guard into a 400 nobody could act on. */
    const { commands } = twice(withTypedTurn(), started({ expectedTailId: null }));
    expect(commands[0]).toHaveProperty("expectedTailId", null);
  });

  it("carries passages, tools and interrupted only when there is something to say", () => {
    const bare = twice(withTypedTurn(), started()).commands[0] as Record<string, unknown>;
    expect(bare).not.toHaveProperty("passages");
    expect(bare).not.toHaveProperty("tools");
    expect(bare).not.toHaveProperty("interrupted");

    const full = twice(
      withTypedTurn(),
      started({
        reply: {
          ...message("spya-loca01", "assistant", "spoken answer"),
          passages: [{ blockIds: ["spya-aaa222"], why: "the rainstorm" }],
          interrupted: true,
        },
      }),
    ).commands[0] as Record<string, unknown>;
    expect(full.passages).toHaveLength(1);
    expect(full.interrupted).toBe(true);
  });

  it("supersedes nothing, so two exchanges both stay on screen", () => {
    /* Two spoken exchanges in one conversation are two appends, like two sends.
       They are ordered rather than raced, because the second one's tail is the
       first one's *stored* answer — which does not exist until the first has
       landed. */
    const one = twice(withTypedTurn(), started()).state;
    const two = twice(
      one,
      started({
        id: asOpId("spya-spok02"),
        question: message("spya-locq02", "user", "second question"),
        reply: message("spya-loca02", "assistant", "second answer"),
      }),
    ).state;
    expect([...two.operations.values()].every((op) => !op.superseded)).toBe(true);
    expect(project(two)[0]?.messages).toHaveLength(6);
  });
});

describe("when it lands", () => {
  it("replaces the drawn rows with the ones the server actually minted", () => {
    /* The reader sees no difference. The *next* append does: it has to name the
       tail, and a name this tab invented is one the server has never heard of. */
    const registered = twice(withTypedTurn(), started()).state;
    const { state } = twice(registered, {
      type: "spoken.succeeded",
      opId: SPOKEN,
      thread: stored,
    });
    expect(state.operations.size).toBe(0);
    expect(state.base[0]?.messages.map((m) => m.id)).toEqual([
      "spya-msgu01",
      "spya-msga01",
      "spya-srvq01",
      "spya-srva01",
    ]);
    /* And nothing is drawn over the top of it any more. */
    expect(project(state)).toEqual(state.base);
  });

  it("adds a conversation this tab did not have", () => {
    /* Pressing Live on a thread the controller has no record of — discarded, or
       started before this controller existed. Appending it beats dropping the
       reader's words on the floor. */
    const empty = { ...initialState(SLUG), loadPhase: "ready" as const };
    const registered = twice(empty, started({ expectedTailId: null })).state;
    const { state } = twice(registered, {
      type: "spoken.succeeded",
      opId: SPOKEN,
      thread: stored,
    });
    expect(state.base).toHaveLength(1);
    expect(state.base[0]?.messages).toHaveLength(4);
  });

  it("stops the conversation being one the server has not named", () => {
    const begun = twice(
      { ...initialState(SLUG), loadPhase: "ready" as const },
      { type: "thread.begun", thread: thread("spya-thra01") },
    ).state;
    expect(begun.unnamed.has("spya-thra01")).toBe(true);

    const registered = twice(begun, started({ expectedTailId: null })).state;
    const { state } = twice(registered, {
      type: "spoken.succeeded",
      opId: SPOKEN,
      thread: stored,
    });
    /* A rename or a delete of this conversation can now be addressed. Left in
       `unnamed`, both would be held for ever waiting on a `begin` frame that a
       spoken turn never sends. */
    expect(state.unnamed.has("spya-thra01")).toBe(false);
  });

  it("keeps a row this tab has that the server has not written down", () => {
    /* A send registered a moment ago has its optimistic pair in `base` under
       ids the server has never heard of. The design says one modality at a time
       and Send awaits the handoff, so this overlap should not happen — and
       "should not" is the sentence this repo keeps having to retract. Merging
       costs one `Set`; being wrong costs the reader watching a question they
       typed vanish with a live stream still writing into it. */
    const registered = twice(withTypedTurn(), started()).state;
    const withSend: ChatState = {
      ...registered,
      base: registered.base.map((t) => ({
        ...t,
        messages: [...t.messages, message("spya-optq01", "user", "just typed")],
      })),
    };
    const { state } = twice(withSend, {
      type: "spoken.succeeded",
      opId: SPOKEN,
      thread: stored,
    });
    expect(state.base[0]?.messages.map((m) => m.id)).toContain("spya-optq01");
    expect(state.base[0]?.messages).toHaveLength(5);
  });

  it("takes the server's title for a conversation this write created", () => {
    /* The first thing said names a thread, exactly as the first typed question
       does — and the optimistic side has nothing but "New chat" to show. */
    const begun = twice(
      { ...initialState(SLUG), loadPhase: "ready" as const },
      { type: "thread.begun", thread: thread("spya-thra01") },
    ).state;
    const registered = twice(begun, started({ expectedTailId: null })).state;
    const { state } = twice(registered, {
      type: "spoken.succeeded",
      opId: SPOKEN,
      thread: { ...stored, title: "Why does he reject it?" },
    });
    expect(state.base[0]?.title).toBe("Why does he reject it?");
  });

  it("NEVER takes the server's title over one the reader typed", () => {
    /* The same rule `readerNamed` enforces for a turn, arriving from the other
       direction. A rename on a conversation the server has not written down is
       *held* — nothing has been sent — so its title sits in `base` with nothing
       to defend it but this. The reader watched their own name be replaced by a
       slice of a sentence, once, and it took a while to find. */
    const begun = twice(
      { ...initialState(SLUG), loadPhase: "ready" as const },
      { type: "thread.begun", thread: thread("spya-thra01") },
    ).state;
    const renamed = twice(begun, {
      type: "rename.started",
      op: { id: asOpId("spya-name01"), kind: "rename", threadId: "spya-thra01", title: "Rainstorms" },
    }).state;
    const registered = twice(renamed, started({ expectedTailId: null })).state;
    const { state } = twice(registered, {
      type: "spoken.succeeded",
      opId: SPOKEN,
      thread: { ...stored, title: "Why does he reject it?" },
    });
    expect(state.base[0]?.title, "the reader's own name was overwritten").toBe("Rainstorms");
  });

  it("leaves an established conversation's title alone", () => {
    /* It is not in `unnamed`, so the server wrote it down long ago and this
       write did not name it. Taking the stored title here would undo a rename
       made in this tab and not yet reloaded. */
    const registered = twice(withTypedTurn(), started()).state;
    const { state } = twice(registered, {
      type: "spoken.succeeded",
      opId: SPOKEN,
      thread: { ...stored, title: "something the server thinks" },
    });
    expect(state.base[0]?.title).toBe("New chat");
  });

  it("tells the URL when the server overruled the conversation's id", () => {
    const registered = twice(withTypedTurn(), started()).state;
    const { commands } = twice(registered, {
      type: "spoken.succeeded",
      opId: SPOKEN,
      thread: { ...stored, id: "spya-srvt01" },
    });
    expect(commands).toEqual([
      { type: "named", opId: SPOKEN, wasThreadId: "spya-thra01", threadId: "spya-srvt01" },
    ]);
  });

  it("says nothing about the id when it did not move", () => {
    /* `named` is what the panel's `?thread=` follows. Firing it for an id that
       did not change would repoint the URL at itself on every spoken turn. */
    const registered = twice(withTypedTurn(), started()).state;
    const { commands } = twice(registered, {
      type: "spoken.succeeded",
      opId: SPOKEN,
      thread: stored,
    });
    expect(commands).toEqual([]);
  });
});

describe("when the server refuses it", () => {
  it("keeps provisional rows while it goes and checks whether the write landed", () => {
    /* A 409 has three causes and only the server can say which: somebody typed
       into this conversation, somebody edited a turn away, or *this very
       request already succeeded* and its response was lost. The third is why
       the repair matters — the reader's words are on disk and have to come
       back. */
    const registered = twice(withTypedTurn(), started()).state;
    expect(project(registered)[0]?.messages).toHaveLength(4);

    const { state, commands } = twice(registered, {
      type: "spoken.refused",
      opId: SPOKEN,
      error: "This conversation has moved on",
      repair: { id: REPAIR },
    });
    expect(project(state)[0]?.messages, "the repair owns the provisional copy").toHaveLength(4);
    expect(state.error).toBeNull();
    expect(commands).toEqual([
      { type: "repair", opId: REPAIR, slug: SLUG, threadId: "spya-thra01" },
    ]);
  });

  it("does not repair twice for one conversation", () => {
    /* Repairs supersede each other, or an older snapshot lands over a newer
       one — the rule `turn.refused` already follows. */
    const registered = twice(withTypedTurn(), started()).state;
    const refused = twice(registered, {
      type: "spoken.refused",
      opId: SPOKEN,
      error: "moved on",
      repair: { id: REPAIR },
    }).state;
    const second = twice(refused, started({ id: asOpId("spya-spok02") })).state;
    const { state } = twice(second, {
      type: "spoken.refused",
      opId: asOpId("spya-spok02"),
      error: "moved on again",
      repair: { id: asOpId("spya-rep002") },
    });
    const repairs = [...state.operations.values()].filter(
      (op) => op.kind === "repair" && !op.superseded,
    );
    expect(repairs).toHaveLength(1);
  });
});

describe("when it never reaches the server", () => {
  it("drops the rows rather than leaving a lie on screen", () => {
    /* Harsh, and still right: rows that survive on screen and vanish on the
       next reload are a lie the reader has no way to detect. The sentence they
       get is what tells them. */
    const registered = twice(withTypedTurn(), started()).state;
    const { state, commands } = twice(registered, {
      type: "spoken.failed",
      opId: SPOKEN,
      error: "Couldn't reach the server",
    });
    expect(project(state)[0]?.messages).toHaveLength(2);
    expect(state.error).toBe("Couldn't reach the server");
    expect(commands).toEqual([]);
  });
});

describe("the gate", () => {
  it("refuses a spoken result aimed at an operation of another kind", () => {
    /* The whole point of the directory: one place an obsolete or misaddressed
       result is refused, so it cannot be missing from a path. */
    const loaded: ChatState = {
      ...withTypedTurn(),
      operations: new Map([
        [
          SPOKEN,
          {
            id: SPOKEN,
            kind: "load" as const,
            seq: 0,
            superseded: false,
          },
        ],
      ]) as ChatState["operations"],
    };
    const { state, commands } = twice(loaded, {
      type: "spoken.succeeded",
      opId: SPOKEN,
      thread: stored,
    });
    expect(state.base[0]?.messages, "a load was answered with a spoken write").toHaveLength(2);
    expect(commands).toEqual([]);
  });

  it("refuses a result for an operation that has already retired", () => {
    const registered = twice(withTypedTurn(), started()).state;
    const done = twice(registered, {
      type: "spoken.succeeded",
      opId: SPOKEN,
      thread: stored,
    }).state;
    const { state, commands } = twice(done, {
      type: "spoken.refused",
      opId: SPOKEN,
      error: "late",
      repair: { id: REPAIR },
    });
    expect(state.base[0]?.messages).toHaveLength(4);
    expect(commands).toEqual([]);
  });
});


describe("confirming an uncertain spoken append", () => {
  const operation = () => {
    const op = twice(withTypedTurn(), started()).state.operations.get(SPOKEN);
    if (op?.kind !== "spoken") throw new Error("Missing spoken operation");
    return op;
  };

  it("requires the exact adjacent pair after the claimed tail, including metadata", () => {
    const op = operation();
    expect(storedSpoken(stored, op)).toBeTruthy();
    expect(storedSpoken(stored, { ...op, expectedTailId: "spya-absent" })).toBeNull();
    expect(storedSpoken(stored, { ...op, expectedTailId: null })).toBeNull();
    for (const patch of [
      { text: "Different answer" }, { role: "user" as const }, { status: "pending" as const },
      { interrupted: true }, { passages: [{ blockIds: ["spya-aaa222"], why: "different" }] },
      { tools: [{ name: "search_web", label: "looked elsewhere", status: "done" as const }] },
    ]) {
      const changed = { ...stored, messages: stored.messages.map((m, i) => i === 3 ? { ...m, ...patch } : m) };
      expect(storedSpoken(changed, op), JSON.stringify(patch)).toBeNull();
    }
  });

  it("compares the metadata the route stores, including bounded labels and discarded timing", () => {
    const op = operation();
    const long = "x".repeat(450);
    const reply = { ...op.reply, interrupted: true,
      passages: [{ blockIds: ["spya-aaa222"], why: long }],
      tools: [{ name: "search_web", label: long, detail: long, status: "done" as const, ms: 20 }],
    };
    const persisted = { ...stored, messages: stored.messages.map((m, i) => i === 3 ? { ...m,
      interrupted: true,
      passages: [{ why: long.slice(0, 400), blockIds: ["spya-aaa222"] }],
      tools: [{ status: "done" as const, detail: long.slice(0, 400), label: long.slice(0, 400), name: "search_web" }],
    } : m) };
    expect(storedSpoken(persisted, { ...op, reply })).toBeTruthy();
  });

  it("hands provisional rows over atomically and keeps the existing stale-read guard", () => {
    const registered = twice(withTypedTurn(), started()).state;
    const refused = twice(registered, {
      type: "spoken.refused", opId: SPOKEN, error: "Moved on", repair: { id: REPAIR },
    }).state;
    expect(project(refused)[0]?.messages).toHaveLength(4);
    const landed = twice(refused, { type: "repair.succeeded", opId: REPAIR, thread: stored }).state;
    expect(project(landed)[0]?.messages.map((m) => m.id)).toEqual(stored.messages.map((m) => m.id));
    expect(landed.error).toBeNull();
    const touched = { ...refused, base: refused.base.map((t) => ({ ...t, title: "My newer name" })) };
    const ignored = twice(touched, { type: "repair.succeeded", opId: REPAIR, thread: stored }).state;
    expect(ignored.base).toBe(touched.base);
    expect(ignored.operations.size).toBe(0);
  });
});
