/**
 * **Is GPT-Live owing the reader a reply** — the pure rule behind the notice.
 * src/web/live/gpt-live/stall.ts.
 *
 * As in tests/live-stall.test.ts, the cases that must *not* fire matter as
 * much as the ones that must: a notice on a working conversation teaches the
 * reader to ignore it. The orderings are from the spike (the run where the
 * backend answered and the voice said nothing) and from GPT Sol's plan review
 * (F7: filler, then the final, then silence).
 */
import { describe, expect, it } from "vitest";

import {
  GPT_LIVE_DELEGATION_MS,
  GPT_LIVE_NO_REPLY_MS,
  gptLiveStallOf,
  replyOwedSince,
  sessionZero,
  TIMELINE_LAG_CAP_MS,
  timelineOrigin,
  type GptLiveStallFacts,
} from "../src/web/live/gpt-live/stall.js";

const T = 1_000_000;

function facts(over: Partial<GptLiveStallFacts> = {}): GptLiveStallFacts {
  return {
    now: T,
    readerLastAt: null,
    /* A real sentence unless a case says otherwise: more than four words. */
    readerWords: 12,
    companionLastBeganAt: null,
    delegations: [],
    delegationEndedAt: null,
    ...over,
  };
}

describe("an ordinary conversation is not a stall", () => {
  it("says nothing before anybody has spoken", () => {
    expect(gptLiveStallOf(facts())).toBeNull();
  });

  it("says nothing when the companion answered the reader, however long ago", () => {
    expect(
      gptLiveStallOf(facts({ readerLastAt: T - 600_000, companionLastBeganAt: T - 590_000 })),
    ).toBeNull();
  });

  it("says nothing through a long answer the reader is listening to", () => {
    expect(gptLiveStallOf(facts({ readerLastAt: T - 90_000, companionLastBeganAt: T - 200 }))).toBeNull();
  });

  it("gives a reply its full window", () => {
    expect(gptLiveStallOf(facts({ readerLastAt: T - GPT_LIVE_NO_REPLY_MS + 1 }))).toBeNull();
    expect(
      gptLiveStallOf(
        facts({
          delegations: [{ id: "d1", startedAt: T - GPT_LIVE_NO_REPLY_MS + 1 - 2_000, finalAt: T - GPT_LIVE_NO_REPLY_MS + 1 }],
          delegationEndedAt: T - GPT_LIVE_NO_REPLY_MS + 1,
        }),
      ),
    ).toBeNull();
  });

  it("does not call a slow tool a missing reply", () => {
    expect(
      gptLiveStallOf(
        facts({
          readerLastAt: T - 5 * GPT_LIVE_NO_REPLY_MS,
          /* Filler, then a long search. */
          companionLastBeganAt: T - 5 * GPT_LIVE_NO_REPLY_MS + 1_000,
          delegations: [{ id: "d1", startedAt: T - 10_000, finalAt: null }],
        }),
      ),
    ).toBeNull();
    /* And with no filler at all: the running delegation suspends the reader's clock. */
    expect(
      gptLiveStallOf(
        facts({ readerLastAt: T - 5 * GPT_LIVE_NO_REPLY_MS, delegations: [{ id: "d1", startedAt: T - 10_000, finalAt: null }] }),
      ),
    ).toBeNull();
  });

  it("says nothing once the answer has begun after the final", () => {
    expect(
      gptLiveStallOf(
        facts({
          readerLastAt: T - 60_000,
          delegations: [{ id: "d1", startedAt: T - 50_000 - 2_000, finalAt: T - 50_000 }],
          delegationEndedAt: T - 50_000,
          companionLastBeganAt: T - 49_000,
        }),
      ),
    ).toBeNull();
  });
});

describe("a reply that is owed", () => {
  it("the reader spoke, there is no delegation, and nothing came back", () => {
    expect(gptLiveStallOf(facts({ readerLastAt: T - GPT_LIVE_NO_REPLY_MS }))).toBe("no-reply");
    /* The companion's earlier speech does not count. */
    expect(
      gptLiveStallOf(facts({ readerLastAt: T - GPT_LIVE_NO_REPLY_MS, companionLastBeganAt: T - 60_000 })),
    ).toBe("no-reply");
  });

  it("the backend finished and the voice never said anything (the spike's eleventh run)", () => {
    const final = T - GPT_LIVE_NO_REPLY_MS;
    const f = facts({ delegations: [{ id: "d1", startedAt: final - 2_000, finalAt: final }], delegationEndedAt: final });
    expect(replyOwedSince(f)).toBe(final);
    expect(gptLiveStallOf(f)).toBe("no-reply");
  });

  it("filler before the final pays nothing (F7)", () => {
    const final = T - GPT_LIVE_NO_REPLY_MS;
    expect(
      gptLiveStallOf(
        facts({
          readerLastAt: final - 9_000,
          /* "One moment", after the tool and before the backend's final answer. */
          companionLastBeganAt: final - 500,
          delegations: [{ id: "d1", startedAt: final - 2_000, finalAt: final }],
          delegationEndedAt: final,
        }),
      ),
    ).toBe("no-reply");
  });

  it("a delegation with no tools owes its answer like any other", () => {
    /* Created and completed in one response: the hook only ever lists it with its final. */
    const final = T - GPT_LIVE_NO_REPLY_MS;
    expect(
      gptLiveStallOf(
        facts({
          readerLastAt: final - 2_000,
          delegations: [{ id: "d1", startedAt: final - 2_000, finalAt: final }],
          delegationEndedAt: final,
        }),
      ),
    ).toBe("no-reply");
  });

  it("counts from the final, not from the reader's words, after a long tool", () => {
    const final = T - 5_000;
    const f = facts({
      readerLastAt: T - 60_000,
      delegations: [{ id: "d1", startedAt: final - 2_000, finalAt: final }],
      delegationEndedAt: final,
    });
    expect(replyOwedSince(f)).toBe(final);
    expect(gptLiveStallOf(f)).toBeNull();
    expect(gptLiveStallOf({ ...f, now: final + GPT_LIVE_NO_REPLY_MS })).toBe("no-reply");
  });

  it("a delegation that failed leaves the reader owed a reply from the failure", () => {
    const failedAt = T - 5_000;
    /* The hook has removed the failed delegation and kept only when it ended. */
    const f = facts({
      readerLastAt: T - 60_000,
      companionLastBeganAt: T - 58_000,
      delegationEndedAt: failedAt,
    });
    expect(replyOwedSince(f)).toBe(failedAt);
    expect(gptLiveStallOf({ ...f, now: failedAt + GPT_LIVE_NO_REPLY_MS })).toBe("no-reply");
    expect(gptLiveStallOf({ ...f, companionLastBeganAt: failedAt + 1_000, now: failedAt + 60_000 })).toBeNull();
  });
});

describe("a few words are not a question (decided after the reducer was built)", () => {
  it("\"right, thanks\" followed by silence is not a stall", () => {
    expect(gptLiveStallOf(facts({ readerLastAt: T - 5 * GPT_LIVE_NO_REPLY_MS, readerWords: 2 }))).toBeNull();
    /* Four is still an interjection; five is a sentence. The same line `interrupted` draws. */
    expect(gptLiveStallOf(facts({ readerLastAt: T - GPT_LIVE_NO_REPLY_MS, readerWords: 4 }))).toBeNull();
    expect(gptLiveStallOf(facts({ readerLastAt: T - GPT_LIVE_NO_REPLY_MS, readerWords: 5 }))).toBe("no-reply");
  });

  it("still owes the answer of a delegation those few words started", () => {
    const final = T - GPT_LIVE_NO_REPLY_MS;
    expect(
      gptLiveStallOf(
        facts({
          readerLastAt: final - 3_000,
          readerWords: 3,
          delegations: [{ id: "d1", startedAt: final - 2_000, finalAt: final }],
          delegationEndedAt: final,
        }),
      ),
    ).toBe("no-reply");
  });

  it("and is still owed a reply when the delegation they started failed", () => {
    const failedAt = T - GPT_LIVE_NO_REPLY_MS;
    expect(
      gptLiveStallOf(facts({ readerLastAt: failedAt - 3_000, readerWords: 3, delegationEndedAt: failedAt })),
    ).toBe("no-reply");
  });
});

describe("a backend that hangs", () => {
  it("a delegation still running after a minute is a stall", () => {
    const f = facts({
      readerLastAt: T - GPT_LIVE_DELEGATION_MS - 2_000,
      delegations: [{ id: "d1", startedAt: T - GPT_LIVE_DELEGATION_MS, finalAt: null }],
    });
    expect(gptLiveStallOf(f)).toBe("no-reply");
    expect(gptLiveStallOf({ ...f, now: T - 1 })).toBeNull();
  });

  it("is not excused by filler spoken while it hangs", () => {
    expect(
      gptLiveStallOf(
        facts({
          companionLastBeganAt: T - 1_000,
          delegations: [{ id: "d1", startedAt: T - GPT_LIVE_DELEGATION_MS, finalAt: null }],
        }),
      ),
    ).toBe("no-reply");
  });

  it("a delegation that finished, however slowly, is not hanging", () => {
    expect(
      gptLiveStallOf(
        facts({
          delegations: [{ id: "d1", startedAt: T - 5 * GPT_LIVE_DELEGATION_MS, finalAt: T - 30_000 }],
          delegationEndedAt: T - 30_000,
          companionLastBeganAt: T - 29_000,
        }),
      ),
    ).toBeNull();
  });
});

describe("two delegations at once", () => {
  it("speech for the first does not clear the second, which finished afterwards", () => {
    const f = facts({
      readerLastAt: T - 40_000,
      delegations: [
        { id: "d1", startedAt: T - 30_000 - 2_000, finalAt: T - 30_000 },
        { id: "d2", startedAt: T - 20_000 - 2_000, finalAt: T - 20_000 },
      ],
      delegationEndedAt: T - 20_000,
      /* The first delegation's answer, spoken before the second finished. */
      companionLastBeganAt: T - 28_000,
    });
    expect(replyOwedSince(f)).toBe(T - 20_000);
    expect(gptLiveStallOf(f)).toBe("no-reply");
    expect(gptLiveStallOf({ ...f, now: T - 1 })).toBeNull();
  });

  it("is owed nothing by the one still running, and is still owed by the one that finished", () => {
    const f = facts({
      readerLastAt: T - 40_000,
      delegations: [
        { id: "d1", startedAt: T - GPT_LIVE_NO_REPLY_MS - 2_000, finalAt: T - GPT_LIVE_NO_REPLY_MS },
        { id: "d2", startedAt: T - 10_000, finalAt: null },
      ],
      delegationEndedAt: T - GPT_LIVE_NO_REPLY_MS,
    });
    expect(gptLiveStallOf(f)).toBe("no-reply");
  });

  it("cannot tell which of two finished delegations one answer was for: it pays both (documented)", () => {
    expect(
      gptLiveStallOf(
        facts({
          readerLastAt: T - 60_000,
          delegations: [
            { id: "d1", startedAt: T - 50_000 - 2_000, finalAt: T - 50_000 },
            { id: "d2", startedAt: T - 48_000 - 2_000, finalAt: T - 48_000 },
          ],
          delegationEndedAt: T - 48_000,
          companionLastBeganAt: T - 47_000,
        }),
      ),
    ).toBeNull();
  });
});

describe("placing a fragment on the caller's clock", () => {
  it("takes the earliest estimate of where the session timeline starts", () => {
    /* The spike's allow trace: arrival time and end_ms of three output fragments. */
    let zero = sessionZero(null, 4_091, 2_000);
    expect(zero).toBe(2_091);
    zero = sessionZero(zero, 5_571, 3_600);
    expect(zero).toBe(1_971);
    zero = sessionZero(zero, 6_410, 4_400);
    expect(zero).toBe(1_971);
  });

  it("puts that trace's answer after the final and its first filler words before it", () => {
    const zero = [
      [4_091, 2_000],
      [5_571, 3_600],
      [6_410, 4_400],
    ].reduce<number | null>((z, [arrived, end]) => sessionZero(z, arrived ?? 0, end ?? 0), null) as number;
    const finalAt = 5_010;
    /* " Alright" began at 1800 on the timeline, "The" at 4200. */
    expect(zero + 1_800).toBeLessThan(finalAt);
    expect(zero + 4_200).toBeGreaterThan(finalAt);
  });
});

/**
 * **The session timeline is not wall time.** The peer's measurement
 * (docs/investigations/261002r-gpt-live-spike.md § What surprised us) saw it
 * stop for 26 s while the wall clock ran. Two ways that could corrupt the
 * rule, in opposite directions, and one test for each.
 */
describe("a timeline that does not keep time", () => {
  /** Fold fragments, as [arrivedAt, endMs], into the estimate. */
  const zeroOf = (fragments: [number, number][], from: number | null = null) =>
    fragments.reduce<number | null>((z, [arrived, end]) => sessionZero(z, arrived, end), from) as number;

  it("is not moved by a burst of fragments that arrive late: old speech stays old", () => {
    /* A second of speech, heard as it was said: the timeline starts at 2000. */
    const before = zeroOf([[3_000, 1_000], [3_200, 1_200], [3_400, 1_400]]);
    expect(before).toBe(2_000);
    /* Then ten seconds of fragments held up on the network and delivered at once. */
    const burst: [number, number][] = Array.from({ length: 50 }, (_, i) => [13_500, 1_600 + i * 200]);
    const after = zeroOf(burst, before);
    expect(after).toBe(before);
    /* Words said at 1600 on the timeline are still placed at 3600, ten
       seconds before they arrived. Placed at their arrival they would pay
       for a final at 5000 that they were spoken before. */
    expect(after + 1_600).toBe(3_600);
    expect(replyOwedSince(facts({
      companionLastBeganAt: after + 1_600,
      delegations: [{ id: "d1", startedAt: 4_000, finalAt: 5_000 }],
      delegationEndedAt: 5_000,
    }))).toBe(5_000);
  });

  it("is never raised by a later fragment, whatever order they come in", () => {
    const late: [number, number][] = [[40_000, 4_800], [9_000, 4_000], [3_936, 1_800], [60_000, 9_400]];
    expect(zeroOf(late)).toBe(2_136);
    expect(zeroOf([...late].reverse())).toBe(2_136);
  });

  it("leaves the origin where the earliest estimate put it while the timeline keeps time", () => {
    /* The latest fragment is a few hundred milliseconds late, as they all are. */
    expect(timelineOrigin(2_000, 2_300)).toBe(2_000);
    /* A burst that catches up: its last fragment is fresh, so nothing moves. */
    expect(timelineOrigin(2_000, 2_100)).toBe(2_000);
    /* Up to the cap is still an ordinary delay. */
    expect(timelineOrigin(2_000, 2_000 + TIMELINE_LAG_CAP_MS)).toBe(2_000);
  });

  it("moves the origin up after a freeze, so speech that has just arrived is not placed 26 s ago", () => {
    /* The trace: the timeline stood still for 26 s, so every fragment after
       it is 26 s further behind the wall clock than the earliest ones were. */
    const origin = timelineOrigin(2_136, 2_136 + 26_000);
    expect(origin).toBe(2_136 + 26_000 - TIMELINE_LAG_CAP_MS);
    /* A fragment that began at 8500 on the timeline, ended at 8700 and
       arrived at 36,836, so it was really spoken at about 36,636. By the
       earliest estimate it began at 10,636: long before a final at 34,000,
       which it could then never pay for. */
    expect(2_136 + 8_500).toBeLessThan(34_000);
    expect(origin + 8_500).toBeGreaterThan(34_000);
    /* Placed early by the cap and no more, and never after it arrived. */
    expect(36_836 - 200 - (origin + 8_500)).toBe(TIMELINE_LAG_CAP_MS);
    expect(gptLiveStallOf(facts({
      now: 34_000 + GPT_LIVE_NO_REPLY_MS + 1,
      companionLastBeganAt: origin + 8_500,
      delegations: [{ id: "d1", startedAt: 33_000, finalAt: 34_000 }],
      delegationEndedAt: 34_000,
    }))).toBeNull();
  });

  it("keeps the two speakers in the order the timeline has them, whatever the origin", () => {
    const [readerEnd, companionStart] = [7_000, 7_400];
    for (const origin of [timelineOrigin(2_136, 2_200), timelineOrigin(2_136, 28_136)]) {
      expect(replyOwedSince(facts({ readerLastAt: origin + readerEnd, companionLastBeganAt: origin + companionStart }))).toBeNull();
    }
  });
});
