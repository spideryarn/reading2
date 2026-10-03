/**
 * The typing-session rules for quick search-as-you-type — src/web/quick-session.ts,
 * plan 261002h (Sol F1, F5; Opus's blur and inert-text points).
 */
import { describe, expect, it } from "vitest";
import {
  IDLE,
  type QuickEffect,
  type QuickEvent,
  type QuickSession,
  stepQuickSession,
} from "../src/web/quick-session.js";

/** Run events in order, collecting effects; an `ask` is answered with `ids` in turn. */
function play(
  events: QuickEvent[],
  { ids = ["spya-row002"], from = IDLE }: { ids?: (string | null)[]; from?: QuickSession } = {},
): { state: QuickSession; effects: QuickEffect[] } {
  let state = from;
  const effects: QuickEffect[] = [];
  const queue = [...events];
  const minted = [...ids];
  while (queue.length > 0) {
    const event = queue.shift()!;
    const out = stepQuickSession(state, event);
    state = out.state;
    if (out.effect) {
      effects.push(out.effect);
      if (out.effect.type === "ask") queue.unshift({ type: "asked", id: minted.shift() ?? null });
    }
  }
  return { state, effects };
}

const edit = (text: string): QuickEvent => ({ type: "edit", text });
const pause: QuickEvent = { type: "pause", loaded: true };
const flush = (text: string): QuickEvent => ({ type: "flush", loaded: true, text });

describe("a typing session", () => {
  it("asks on the first pause, then revises that same row on every later one", () => {
    const { effects, state } = play([edit("why"), pause, edit("why repl"), pause, edit("why replication"), pause]);
    expect(effects).toEqual([
      { type: "ask", words: "why" },
      { type: "revise", id: "spya-row002", words: "why repl" },
      { type: "revise", id: "spya-row002", words: "why replication" },
    ]);
    expect(state.open).toBe(true);
  });

  it("asks nothing for fewer than three characters, or for words unchanged since the last ask", () => {
    const { effects } = play([edit("wh"), pause, edit("why"), pause, edit("why "), pause, pause]);
    expect(effects).toEqual([{ type: "ask", words: "why" }]);
  });

  it("carries a pause that arrived before the saved list did, and asks when it lands (F1)", () => {
    const early = play([edit("why replication"), { type: "pause", loaded: false }]);
    expect(early.effects).toEqual([]);
    expect(early.state.due).toBe(true);
    const later = play([{ type: "loaded" }], { from: early.state });
    expect(later.effects).toEqual([{ type: "ask", words: "why replication" }]);
    // And only once.
    expect(play([{ type: "loaded" }], { from: later.state }).effects).toEqual([]);
  });

  it("asks the latest words when the list lands, not the words at the time of the pause", () => {
    const { effects } = play([edit("why"), { type: "pause", loaded: false }, edit("why replication"), { type: "loaded" }]);
    expect(effects).toEqual([{ type: "ask", words: "why replication" }]);
  });

  it("follows a row that begin renamed", () => {
    const { effects } = play([
      edit("why"),
      pause,
      { type: "renamed", from: "spya-row002", to: "spya-new002" },
      edit("why not"),
      pause,
    ]);
    expect(effects.at(-1)).toEqual({ type: "revise", id: "spya-new002", words: "why not" });
  });

  it("asks again on the next pause when the first ask was refused", () => {
    const { effects } = play([edit("why"), pause, edit("why "), pause], { ids: [null, "spya-row002"] });
    expect(effects).toEqual([
      { type: "ask", words: "why" },
      { type: "ask", words: "why" },
    ]);
  });
});

describe("Enter and find", () => {
  it("flush changed words into the row, then end the session", () => {
    const { effects, state } = play(
      [edit("why"), pause, edit("why replication"), flush("why replication"), edit("why replication fails"), pause],
      { ids: ["spya-row002", "spya-two002"] },
    );
    expect(effects).toEqual([
      { type: "ask", words: "why" },
      { type: "revise", id: "spya-row002", words: "why replication" },
      // A new session, so a new row.
      { type: "ask", words: "why replication fails" },
    ]);
    expect(state.rowId).toBe("spya-two002");
  });

  it("ask nothing when the words are unchanged, and still end the session", () => {
    const { effects, state } = play([edit("why replication"), pause, flush("why replication")]);
    expect(effects).toEqual([{ type: "ask", words: "why replication" }]);
    expect(state.open).toBe(false);
    expect(state.text).toBe("why replication");
  });

  it("ask short words too, skipping the pause's three-character floor", () => {
    expect(play([edit("ai"), flush("ai")]).effects).toEqual([{ type: "ask", words: "ai" }]);
  });

  it("with no session open, ask a fresh search as they always did", () => {
    const sealed = play([edit("why"), pause, flush("why")]).state;
    expect(play([flush("why")], { from: sealed, ids: ["spya-two002"] }).effects).toEqual([
      { type: "ask", words: "why" },
    ]);
  });

  it("ask the words in the box, even ones that arrived without an edit (a matcher switch, ↺)", () => {
    expect(play([flush("carried across")]).effects).toEqual([
      { type: "ask", words: "carried across" },
    ]);
  });

  it("wait for the saved list, as find always has", () => {
    const { effects, state } = play([edit("why"), { type: "flush", loaded: false, text: "why" }]);
    expect(effects).toEqual([]);
    expect(state.open).toBe(false);
    expect(play([{ type: "loaded" }], { from: state }).effects).toEqual([
      { type: "ask", words: "why" },
    ]);
  });
});

describe("what ends a session", () => {
  const opened = () => play([edit("why"), pause]).state;

  it.each([
    ["the box emptied", edit("")],
    ["a matcher switch, ↺, a long blur, leaving the mode", { type: "end" } as QuickEvent],
    ["its row deleted or fleshed out", { type: "rowGone", id: "spya-row002" } as QuickEvent],
  ])("%s", (_name, event) => {
    const { state, effects } = play([event, edit("why not"), pause], {
      from: opened(),
      ids: ["spya-two002"],
    });
    expect(effects).toEqual([{ type: "ask", words: "why not" }]);
    expect(state.rowId).toBe("spya-two002");
  });

  it("not another row going", () => {
    const { effects } = play([{ type: "rowGone", id: "spya-thr002" }, edit("why not"), pause], {
      from: opened(),
    });
    expect(effects).toEqual([{ type: "revise", id: "spya-row002", words: "why not" }]);
  });

  it("leaves the words inert: a pause or the list landing asks nothing until the next edit", () => {
    const sealed = play([{ type: "end" }], { from: opened() }).state;
    expect(sealed.text).toBe("why");
    expect(play([pause, { type: "loaded" }], { from: sealed }).effects).toEqual([]);
    // And a remount starts from IDLE, which has nothing to ask either.
    expect(play([pause, { type: "loaded" }]).effects).toEqual([]);
  });

  it("drops a carried pause when the session ends before the list lands", () => {
    const due = play([edit("why"), { type: "pause", loaded: false }, { type: "end" }, { type: "loaded" }]);
    expect(due.effects).toEqual([]);
  });
});
