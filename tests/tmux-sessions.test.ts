import { describe, expect, it } from "vitest";
import { classify, type Signals } from "../scripts/tmux-sessions";

const base: Signals = {
  isMe: false,
  busy: false,
  sleeping: false,
  hasSid: true,
  hasAgent: true,
  idleMin: 300,
  owns: [],
  asksYou: false,
  claimed: [],
  landed: [],
};
const at = (o: Partial<Signals>) => classify({ ...base, ...o }).verdict;

describe("which tmux sessions are safe to reap", () => {
  it("reaps an idle session whose commits are in HEAD", () => {
    expect(at({ claimed: ["2280ee2"], landed: ["2280ee2"] })).toBe("done");
  });

  it("reaps an idle session that produced nothing to commit", () => {
    expect(at({})).toBe("done");
  });

  // The dangerous cases: each of these ends on an assistant message at an idle
  // prompt, which is exactly what a finished session looks like.
  it("spares a session with a scheduled wake-up", () => {
    expect(at({ sleeping: true })).toBe("asleep");
  });

  it("spares a session holding uncommitted work", () => {
    expect(at({ owns: ["src/web/BlockGutter.tsx"] })).toBe("dirty");
  });

  it("spares a session that claims a commit which never landed", () => {
    expect(at({ claimed: ["deadbee"], landed: [] })).toBe("dirty");
  });

  it("spares a session waiting on an answer from Greg", () => {
    expect(at({ asksYou: true })).toBe("waiting");
  });

  it("spares a session that is mid-generation", () => {
    expect(at({ busy: true })).toBe("busy");
  });

  it("spares itself", () => {
    expect(at({ isMe: true, landed: ["2280ee2"] })).toBe("self");
  });

  it("spares a codex or restarted session it cannot identify", () => {
    expect(at({ hasSid: false })).toBe("unknown");
  });

  it("flags, but does not reap, the empty shell a finished agent leaves behind", () => {
    expect(at({ hasSid: false, hasAgent: false })).toBe("shell");
  });

  it("spares a session that was active in the last half hour", () => {
    expect(at({ idleMin: 5 })).toBe("recent");
  });

  it("puts every keep-alive test ahead of the reap", () => {
    // A sleeping session that also looks finished must still be spared.
    expect(at({ sleeping: true, claimed: ["2280ee2"], landed: ["2280ee2"] })).toBe("asleep");
  });
});
