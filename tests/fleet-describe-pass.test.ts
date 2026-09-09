/**
 * One pass over the fleet, describing what each session is for.
 *
 * **Nothing here reads a transcript or calls a gateway.** `readOpening`,
 * `describe` and `now` are injected, so every arm — including the ones a real box
 * would only produce on a bad day — is reachable from a fixture.
 *
 * The test that matters most is the gate. `CLAUDE_SESSION_ID` is set once when a
 * tmux session is created and never updated, so a pane re-used for a second
 * conversation still names the first; without the gate, conversation A's opening
 * is described and rendered on conversation B's row. Well formed, correctly
 * attributed, about this repo, and about the wrong session.
 */
import { describe, expect, it } from "vitest";

import {
  describeBreakdownBalances,
  describeKey,
  openingFingerprint,
  runDescribePass,
  type SessionToDescribe,
} from "../tools/fleet/describe-pass.js";
import { EMPTY_DESCRIPTIONS } from "../tools/fleet/describe-store.js";
import type { ExecutionReading } from "../tools/fleet/wire.js";

const VERIFIED: ExecutionReading = {
  kind: "verified",
  token: { boot: "boot-a", pid: 4242, startTicks: 99 },
  harness: "claude-code",
  conversation: { kind: "verified", id: "conv-1" },
};

function session(over: Partial<SessionToDescribe> = {}): SessionToDescribe {
  return {
    id: "$1",
    name: "fix-the-toc",
    claudeSessionId: "conv-1",
    dir: "/home/greg/code/spideryarn2",
    execution: VERIFIED,
    ...over,
  };
}

function pass(over: Partial<Parameters<typeof runDescribePass>[0]> = {}) {
  return runDescribePass({
    sessions: [session()],
    memory: EMPTY_DESCRIPTIONS,
    maxCalls: 10,
    readOpening: async () => ({ ok: true, text: "please fix the nested toc" }),
    describe: async () => ({
      kind: "described",
      described: { title: "Fix the toc", description: "Repair the nested table of contents." },
    }),
    now: () => new Date("2026-09-09T03:00:00.000Z"),
    ...over,
  });
}

describe("who may be described at all", () => {
  it("describes a session whose process and conversation are both verified", async () => {
    const out = await pass();
    expect(out.breakdown.described).toBe(1);
    expect(out.memory.records.size).toBe(1);
  });

  /**
   * THE P1. Without this, a re-used pane gets the previous conversation's
   * description — and every other field on the row agrees with it.
   */
  it("refuses a session whose conversation is not verified", async () => {
    for (const conversation of [
      { kind: "not-claimed" } as const,
      { kind: "unverifiable", claimed: "conv-1", why: "the process could not be named" } as const,
      { kind: "conflicting", claimed: "conv-1", observed: "conv-2" } as const,
    ]) {
      const out = await pass({ sessions: [session({ execution: { ...VERIFIED, conversation } })] });
      expect(out.breakdown.notEligible).toBe(1);
      expect(out.memory.records.size).toBe(0);
    }
  });

  it("refuses a session whose process is not verified, which is every row before a restart", async () => {
    const out = await pass({
      sessions: [
        session({ execution: { kind: "unknown", cause: "not-reported", why: "this producer is too old" } }),
      ],
    });
    expect(out.breakdown.notEligible).toBe(1);
    expect(out.memory.records.size).toBe(0);
  });

  it("never calls the gateway for a session it will not describe", async () => {
    let calls = 0;
    await pass({
      sessions: [session({ execution: { kind: "unknown", cause: "not-reported", why: "old" } })],
      describe: async () => {
        calls += 1;
        return { kind: "cannot-tell", why: "should not happen" };
      },
    });
    expect(calls).toBe(0);
  });

  it("does not read an opening for an ineligible session either", async () => {
    let reads = 0;
    await pass({
      sessions: [session({ execution: { kind: "unknown", cause: "not-reported", why: "old" } })],
      readOpening: async () => {
        reads += 1;
        return { ok: true, text: "x" };
      },
    });
    expect(reads).toBe(0);
  });
});

describe("the key, and why the token is in it", () => {
  it("keys on the session, the conversation and the execution token together", () => {
    const k = describeKey(session());
    expect(k?.key).toContain("$1");
    expect(k?.key).toContain("conv-1");
    expect(k?.key).toContain("boot-a:4242:99");
  });

  /**
   * The stale record becomes UNREACHABLE rather than merely unrendered. Gating
   * alone would leave a correct-looking entry in the file waiting for some later
   * code path to find it.
   */
  it("gives a re-executed session a different key, so it cannot hit the old record", () => {
    const before = describeKey(session());
    const after = describeKey(
      session({ execution: { ...VERIFIED, token: { boot: "boot-a", pid: 5555, startTicks: 120 } } }),
    );
    expect(before?.key).not.toBe(after?.key);
  });
});

describe("what a pass costs", () => {
  it("costs nothing when the opening is already described", async () => {
    const first = await pass();
    let calls = 0;
    const second = await pass({
      memory: first.memory,
      describe: async () => {
        calls += 1;
        return { kind: "cannot-tell", why: "should not have been asked" };
      },
    });
    expect(calls).toBe(0);
    expect(second.breakdown.cached).toBe(1);
    expect(second.breakdown.called).toBe(0);
  });

  it("collapses two sessions with identical openings into one call", async () => {
    let calls = 0;
    const out = await pass({
      sessions: [session({ id: "$1" }), session({ id: "$2", execution: { ...VERIFIED, conversation: { kind: "verified", id: "conv-2" } } })],
      describe: async () => {
        calls += 1;
        return { kind: "described", described: { title: "t", description: "d" } };
      },
    });
    expect(calls).toBe(1);
    /* Both sessions still get a record — the call was shared, not the row. */
    expect(out.memory.records.size).toBe(2);
  });

  it("reports what the budget would not stretch to", async () => {
    const out = await pass({
      sessions: [
        session({ id: "$1" }),
        session({ id: "$2", execution: { ...VERIFIED, conversation: { kind: "verified", id: "c2" } } }),
      ],
      readOpening: async (s) => ({ ok: true, text: `opening for ${s.id}` }),
      maxCalls: 1,
    });
    expect(out.breakdown.called).toBe(1);
    expect(out.breakdown.overBudget).toBe(1);
  });

  /** A memory that only grows outlives the box it describes. */
  it("forgets a session that is no longer on the fleet", async () => {
    const first = await pass();
    expect(first.memory.records.size).toBe(1);
    const second = await pass({ sessions: [], memory: first.memory });
    expect(second.memory.records.size).toBe(0);
  });
});

describe("when it cannot tell", () => {
  it("counts an unreadable opening without describing anything", async () => {
    const out = await pass({ readOpening: async () => ({ ok: false, why: "no transcript on disk" }) });
    expect(out.breakdown.unreadable).toBe(1);
    expect(out.memory.records.size).toBe(0);
    expect(out.unreadable[0]).toContain("no transcript on disk");
  });

  it("counts a refused description without storing an empty one", async () => {
    const out = await pass({ describe: async () => ({ kind: "cannot-tell", why: "the opening is only machinery" }) });
    expect(out.breakdown.couldNotDescribe).toBe(1);
    expect(out.memory.records.size).toBe(0);
  });
});

/**
 * TWO IDENTITIES, NOT ONE. Sessions divide one way and distinct openings divide
 * another, and a single "it all adds up" check over both has to be fudged with an
 * inequality — which is a check that cannot fail. The first draft of this file
 * shipped exactly that, and these are what replaced it.
 */
describe("the numbers add up, both ways", () => {
  it("balances over a mixed fleet", async () => {
    const out = await pass({
      sessions: [
        session({ id: "$1" }),
        session({ id: "$2", execution: { ...VERIFIED, conversation: { kind: "verified", id: "c2" } } }),
        session({ id: "$3", execution: { kind: "unknown", cause: "not-reported", why: "old" } }),
      ],
      readOpening: async (s) => (s.id === "$2" ? { ok: false, why: "gone" } : { ok: true, text: `o-${s.id}` }),
    });
    expect(describeBreakdownBalances(out.breakdown)).toBe(true);
    expect(out.breakdown.notEligible).toBe(1);
    expect(out.breakdown.unreadable).toBe(1);
    expect(out.breakdown.described).toBe(1);
  });

  /** The check must be capable of failing, or it is not a check. */
  it("says so when the numbers do not add up", () => {
    expect(
      describeBreakdownBalances({
        sessions: 5,
        notEligible: 1,
        unreadable: 1,
        described: 1,
        openings: 1,
        cached: 0,
        called: 1,
        overBudget: 0,
        couldNotDescribe: 0,
      }),
    ).toBe(false);
  });
});

describe("the fingerprint", () => {
  it("is the same for the same opening and different for a different one", () => {
    expect(openingFingerprint("abc")).toBe(openingFingerprint("abc"));
    expect(openingFingerprint("abc")).not.toBe(openingFingerprint("abd"));
  });
});
