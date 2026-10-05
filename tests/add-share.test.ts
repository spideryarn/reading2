/**
 * The add page's *Make it public* — src/web/add-share.ts, plan
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md.
 * Every answer the probe and the `PUT` can give, driven through injected
 * requests, as tests/add-high-power.test.ts does for the box above it.
 *
 * What differs from that intent, and is pinned here because GPT Sol's plan
 * review asked for each: one instance belongs to one slug for life (P1), the
 * box is offered only once the probe has said there is no article yet (P2-2),
 * and a share that gave up while the job sat queued is sent again at
 * completion (P2-7). And from its code review: the only `private` sent is the
 * box unticked (F11), the tab has one controller per slug (F12), and what the
 * tab remembers across a reload leads to *unknown* and sends nothing (F10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_NOT_YET } from "../src/web/add-high-power.js";
import {
  type Probe,
  resetShareAtAddForTests,
  ShareAtAdd,
  shareAtAddFor,
  type ShareIo,
  shareUnsettled,
} from "../src/web/add-share.js";

const AT = "2026-10-05T12:00:00.000Z";
const PUBLIC = { visibility: "public", publicAt: AT } as const;
const PRIVATE = { visibility: "private", publicAt: null } as const;

function refusal(status: number, message = "no"): Error {
  return Object.assign(new Error(message), { status });
}

type Answer = typeof PUBLIC | typeof PRIVATE | null | Error;

/** Requests whose answers are queued by the test, recording every `put`. */
function scripted(probe: Probe | Error, ...answers: Answer[]) {
  const calls: Array<[string, "public" | "private"]> = [];
  const probes: string[] = [];
  /** The slugs this tab remembers making public: the page's `sessionStorage`. */
  const marks = new Set<string>();
  const io: ShareIo = {
    marks: {
      recall: (slug) => marks.has(slug),
      remember: (slug) => void marks.add(slug),
      forget: (slug) => void marks.delete(slug),
    },
    probe: async (slug) => {
      probes.push(slug);
      if (probe instanceof Error) throw probe;
      return probe;
    },
    put: async (slug, to) => {
      calls.push([slug, to]);
      const next = answers.shift();
      if (next === undefined) throw new Error("unscripted call");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { io, calls, probes, marks };
}

/** A started share whose probe has answered. */
async function offered(io: ShareIo, retryMs = 10): Promise<ShareAtAdd> {
  const share = new ShareAtAdd("an-essay", io, retryMs);
  share.start();
  await vi.advanceTimersByTimeAsync(0);
  return share;
}

/** Tick the box, tick the rights, press *Share it*. */
function confirm(share: ShareAtAdd): void {
  share.open();
  share.tick(true);
  share.share();
}

beforeEach(() => {
  vi.useFakeTimers();
  resetShareAtAddForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the adopted-article probe", () => {
  it("asks nothing until it is started, and then once", async () => {
    const { io, probes } = scripted("none");
    const share = new ShareAtAdd("an-essay", io, 10);
    expect(share.get()).toEqual({ kind: "probing" });
    await vi.runAllTimersAsync();
    expect(probes).toEqual([]);
    share.start();
    share.start();
    await vi.runAllTimersAsync();
    expect(probes).toEqual(["an-essay"]);
  });

  it("offers the box when nothing is published at this slug", async () => {
    const { io } = scripted("none");
    const share = await offered(io);
    expect(share.get()).toEqual({ kind: "off" });
  });

  it("offers no box over an article already on the shelf", async () => {
    const { io, calls } = scripted("article");
    const share = await offered(io);
    expect(share.get()).toEqual({ kind: "adopted" });
    confirm(share);
    await vi.runAllTimersAsync();
    expect(calls).toEqual([]);
    expect(share.get()).toEqual({ kind: "adopted" });
  });

  it("offers nothing when it could not find out", async () => {
    for (const answer of ["unknown", new TypeError("Failed to fetch")] as const) {
      const { io, calls } = scripted(answer);
      const share = await offered(io);
      expect(share.get()).toEqual({ kind: "unavailable" });
      confirm(share);
      await vi.runAllTimersAsync();
      expect(calls).toEqual([]);
    }
  });

  it("cannot be confirmed while the probe is still out", async () => {
    const { io, calls } = scripted("none");
    const share = new ShareAtAdd("an-essay", io, 10);
    share.start();
    confirm(share);
    expect(share.get()).toEqual({ kind: "probing" });
    await vi.runAllTimersAsync();
    expect(calls).toEqual([]);
    expect(share.get()).toEqual({ kind: "off" });
  });
});

describe("the confirmation", () => {
  it("sends nothing on the tick, nor on the press without the rights box", async () => {
    const { io, calls } = scripted("none");
    const share = await offered(io);
    share.open();
    expect(share.get()).toEqual({ kind: "confirming", rights: false });
    share.share();
    await vi.runAllTimersAsync();
    expect(calls).toEqual([]);
    expect(share.get()).toEqual({ kind: "confirming", rights: false });
  });

  it("sends once, with the rights box ticked and the press, and shows the server's answer", async () => {
    const { io, calls } = scripted("none", PUBLIC);
    const share = await offered(io);
    confirm(share);
    expect(share.get()).toEqual({ kind: "saving", to: "public" });
    await vi.runAllTimersAsync();
    expect(calls).toEqual([["an-essay", "public"]]);
    expect(share.get()).toEqual({ kind: "on", publicAt: AT });
  });

  it("closes without sending, and the rights box starts unticked next time", async () => {
    const { io, calls } = scripted("none");
    const share = await offered(io);
    share.open();
    share.tick(true);
    share.cancel();
    expect(share.get()).toEqual({ kind: "off" });
    share.open();
    expect(share.get()).toEqual({ kind: "confirming", rights: false });
    share.untick();
    expect(share.get()).toEqual({ kind: "off" });
    await vi.runAllTimersAsync();
    expect(calls).toEqual([]);
  });
});

describe("before the article's row exists", () => {
  it("pauses pending retries and can resume the same consent after effect replay", async () => {
    const { io, calls } = scripted("none", refusal(404), PUBLIC);
    const share = await offered(io);
    confirm(share);
    await vi.advanceTimersByTimeAsync(0);
    share.pause();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
    share.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(share.get()).toEqual({ kind: "on", publicAt: AT });
  });

  it("treats a 404 as *not yet* while the job is alive, and retries", async () => {
    const { io, calls } = scripted("none", refusal(404), refusal(404), PUBLIC);
    const share = await offered(io);
    confirm(share);
    await vi.advanceTimersByTimeAsync(0);
    expect(share.get()).toEqual({ kind: "waiting" });
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(3);
    expect(share.get()).toEqual({ kind: "on", publicAt: AT });
  });

  it("unticking before anything landed cancels the retry and sends nothing more", async () => {
    const { io, calls } = scripted("none", refusal(404));
    const share = await offered(io, 60_000);
    confirm(share);
    await vi.advanceTimersByTimeAsync(0);
    share.untick();
    expect(share.get()).toEqual({ kind: "off" });
    await vi.runAllTimersAsync();
    expect(calls).toEqual([["an-essay", "public"]]);
  });

  it("gives up after five minutes of not yet, and `settle` sends it again", async () => {
    const answers: Answer[] = Array.from({ length: MAX_NOT_YET + 1 }, () => refusal(404));
    const { io, calls } = scripted("none", ...answers, PUBLIC);
    const share = await offered(io);
    confirm(share);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(MAX_NOT_YET + 1);
    expect(share.get()).toEqual({ kind: "gave-up" });

    /* The job sat queued for longer than that, then ran and finished. */
    await share.settle();
    expect(calls).toHaveLength(MAX_NOT_YET + 2);
    expect(share.get()).toEqual({ kind: "on", publicAt: AT });
  });

  it("at completion sends a still-waiting share now, and a 404 is then final", async () => {
    const { io, calls } = scripted("none", refusal(404), refusal(404, "No article"));
    const share = await offered(io, 60_000);
    confirm(share);
    await vi.advanceTimersByTimeAsync(0);
    expect(share.get()).toEqual({ kind: "waiting" });
    await share.settle();
    expect(calls).toHaveLength(2);
    expect(share.get()).toEqual({ kind: "refused", message: "No article", on: false, attempted: "public" });
  });

  it("`settle` sends nothing for a box never confirmed", async () => {
    const { io, calls } = scripted("none");
    const share = await offered(io);
    share.open();
    share.tick(true);
    await share.settle();
    expect(calls).toEqual([]);
    expect(share.get()).toEqual({ kind: "confirming", rights: true });
  });

  it("keeps the share across a job that failed before its claim, and its Retry", async () => {
    const { io, calls } = scripted("none", refusal(404, "No article"), PUBLIC);
    const share = await offered(io);
    share.observe(false);
    confirm(share);
    await vi.advanceTimersByTimeAsync(0);
    expect(share.get()).toEqual({ kind: "refused", message: "No article", on: false, attempted: "public" });
    /* Retry made the job live again, under the same slug. */
    share.observe(true);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(2);
    expect(share.get()).toEqual({ kind: "on", publicAt: AT });
  });
});

describe("the server's other answers", () => {
  it("shows a refusal in the server's sentence, and leaves the box off", async () => {
    const { io } = scripted("none", refusal(409, "A paper that has not been read cannot be shared."));
    const share = await offered(io);
    confirm(share);
    await vi.runAllTimersAsync();
    expect(share.get()).toEqual({
      kind: "refused",
      message: "A paper that has not been read cannot be shared.",
      on: false,
      attempted: "public",
    });
    /* Asking again goes through the confirmation again. */
    share.open();
    expect(share.get()).toEqual({ kind: "confirming", rights: false });
  });

  it("does not claim either state when no answer arrived, or one it cannot read", async () => {
    for (const answer of [new TypeError("Failed to fetch"), null] as const) {
      const { io } = scripted("none", answer);
      const share = await offered(io);
      confirm(share);
      await vi.runAllTimersAsync();
      expect(share.get()).toEqual({ kind: "unknown", because: "write" });
    }
  });

  it("unticking while on sends private, with no second confirmation", async () => {
    const { io, calls } = scripted("none", PUBLIC, PRIVATE);
    const share = await offered(io);
    confirm(share);
    await vi.runAllTimersAsync();
    share.untick();
    expect(share.get()).toEqual({ kind: "saving", to: "private" });
    await vi.runAllTimersAsync();
    expect(calls).toEqual([
      ["an-essay", "public"],
      ["an-essay", "private"],
    ]);
    expect(share.get()).toEqual({ kind: "off" });
  });

  it("unticking while unknown sends private", async () => {
    const { io, calls } = scripted("none", new TypeError("Failed to fetch"), PRIVATE);
    const share = await offered(io);
    confirm(share);
    await vi.runAllTimersAsync();
    share.untick();
    await vi.runAllTimersAsync();
    expect(calls).toEqual([
      ["an-essay", "public"],
      ["an-essay", "private"],
    ]);
    expect(share.get()).toEqual({ kind: "off" });
  });

  it("keeps the last confirmed public state when unsharing is refused, and can ask again", async () => {
    const { io, calls } = scripted("none", PUBLIC, refusal(503, "Please try again."), PRIVATE);
    const share = await offered(io);
    confirm(share);
    await vi.runAllTimersAsync();
    share.untick();
    await vi.runAllTimersAsync();
    expect(share.get()).toEqual({ kind: "refused", message: "Please try again.", on: true, attempted: "private" });
    share.untick();
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(3);
    expect(share.get()).toEqual({ kind: "off" });
  });
});

describe("nothing is sent that the reader did not ask for", () => {
  /* GPT Sol's code review, F11 and F12: a compensating unshare whose failure
     nobody can see is worse than the state it compensates for. The only
     `private` this class sends is the box being unticked. */
  it("a publish that answers after its page has gone is kept, and nothing is taken back", async () => {
    let answer: (v: typeof PUBLIC) => void = () => {};
    const calls: Array<[string, string]> = [];
    const { io: base } = scripted("none");
    const io: ShareIo = {
      ...base,
      put: (slug, to) => {
        calls.push([slug, to]);
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
    };
    const share = await offered(io);
    confirm(share);
    share.pause();
    answer(PUBLIC);
    await vi.runAllTimersAsync();
    expect(share.get()).toEqual({ kind: "on", publicAt: AT });
    expect(calls).toEqual([["an-essay", "public"]]);
  });

  it("pausing a share that is on, unknown or refused-while-public sends nothing", async () => {
    for (const answers of [[PUBLIC], [new TypeError("Failed to fetch")], [PUBLIC, refusal(503)]] as Answer[][]) {
      const { io, calls } = scripted("none", ...answers);
      const share = await offered(io);
      confirm(share);
      await vi.runAllTimersAsync();
      if (answers.length === 2) {
        share.untick();
        await vi.runAllTimersAsync();
      }
      const sent = calls.length;
      share.pause();
      await vi.runAllTimersAsync();
      expect(calls).toHaveLength(sent);
    }
  });
});

describe("one controller per slug, per tab", () => {
  /* F12: two controllers for one slug are two writers, and the older one's
     answer can land last. */
  it("hands back the same controller for the same slug, with its state", async () => {
    const { io, calls } = scripted("none", PUBLIC);
    const first = shareAtAddFor("an-essay", io);
    first.start();
    await vi.advanceTimersByTimeAsync(0);
    confirm(first);
    await vi.runAllTimersAsync();

    const again = shareAtAddFor("an-essay", io);
    expect(again).toBe(first);
    again.start();
    await vi.runAllTimersAsync();
    expect(again.get()).toEqual({ kind: "on", publicAt: AT });
    expect(calls).toEqual([["an-essay", "public"]]);
  });

  it("gives another slug its own, starting from nothing", async () => {
    const { io } = scripted("none", PUBLIC);
    const a = shareAtAddFor("an-essay", io);
    a.start();
    await vi.advanceTimersByTimeAsync(0);
    confirm(a);
    await vi.runAllTimersAsync();

    const b = shareAtAddFor("another", io);
    expect(b).not.toBe(a);
    expect(b.slug).toBe("another");
    expect(b.get()).toEqual({ kind: "probing" });
    expect(a.get()).toEqual({ kind: "on", publicAt: AT });
  });
});

describe("what this tab remembers across a reload", () => {
  /* F10: before publication nothing on the server can be asked whether the
     article is public. A mark in the tab is a hint, and leads to *unknown*. */
  it("remembers a share that is on, and forgets it when private is confirmed", async () => {
    const { io, marks } = scripted("none", PUBLIC, PRIVATE);
    const share = await offered(io);
    expect([...marks]).toEqual([]);
    confirm(share);
    await vi.runAllTimersAsync();
    expect([...marks]).toEqual(["an-essay"]);
    share.untick();
    await vi.runAllTimersAsync();
    expect([...marks]).toEqual([]);
  });

  it("remembers a publish that did not come back, and one it could not read", async () => {
    for (const answer of [new TypeError("Failed to fetch"), null] as const) {
      const { io, marks } = scripted("none", answer);
      const share = await offered(io);
      confirm(share);
      await vi.runAllTimersAsync();
      expect([...marks]).toEqual(["an-essay"]);
    }
  });

  it("remembers nothing for a publish the server refused, or one never sent", async () => {
    const { io, marks } = scripted("none", refusal(409, "No."));
    const share = await offered(io);
    share.open();
    share.tick(true);
    expect([...marks]).toEqual([]);
    share.share();
    await vi.runAllTimersAsync();
    expect([...marks]).toEqual([]);
  });

  it("keeps the mark when unsharing is refused or does not come back", async () => {
    for (const answer of [refusal(503), new TypeError("Failed to fetch")] as const) {
      const { io, marks } = scripted("none", PUBLIC, answer);
      const share = await offered(io);
      confirm(share);
      await vi.runAllTimersAsync();
      share.untick();
      await vi.runAllTimersAsync();
      expect([...marks]).toEqual(["an-essay"]);
    }
  });

  it("a marked slug with nothing published starts unknown, and sends nothing on the strength of the mark", async () => {
    const { io, calls, marks } = scripted("none");
    marks.add("an-essay");
    const share = await offered(io);
    expect(share.get()).toEqual({ kind: "unknown", because: "reload" });
    share.observe(true);
    await share.settle();
    await vi.runAllTimersAsync();
    expect(calls).toEqual([]);
  });

  it("unticking it sends private, and a confirmed private forgets the mark", async () => {
    const { io, calls, marks } = scripted("none", PRIVATE);
    marks.add("an-essay");
    const share = await offered(io);
    share.untick();
    await vi.runAllTimersAsync();
    expect(calls).toEqual([["an-essay", "private"]]);
    expect(share.get()).toEqual({ kind: "off" });
    expect([...marks]).toEqual([]);
  });

  it("without the mark it starts off", async () => {
    const { io, marks } = scripted("none");
    marks.add("some-other-essay");
    const share = await offered(io);
    expect(share.get()).toEqual({ kind: "off" });
  });

  it("the mark does not offer a box over an article already on the shelf", async () => {
    const { io, marks } = scripted("article");
    marks.add("an-essay");
    const share = await offered(io);
    expect(share.get()).toEqual({ kind: "adopted" });
  });
});

describe("shareUnsettled — what holds the add page from leaving by itself", () => {
  it("holds for an open confirmation and every answer the reader has not read", () => {
    expect(shareUnsettled({ kind: "confirming", rights: false })).toBe(true);
    expect(shareUnsettled({ kind: "waiting" })).toBe(true);
    expect(shareUnsettled({ kind: "saving", to: "public" })).toBe(true);
    expect(shareUnsettled({ kind: "refused", message: "no", on: false, attempted: "public" })).toBe(true);
    expect(shareUnsettled({ kind: "gave-up" })).toBe(true);
    expect(shareUnsettled({ kind: "unknown", because: "write" })).toBe(true);
    expect(shareUnsettled({ kind: "unknown", because: "reload" })).toBe(true);
  });

  it("does not hold for a box never touched, or a share that is on", () => {
    expect(shareUnsettled({ kind: "probing" })).toBe(false);
    expect(shareUnsettled({ kind: "adopted" })).toBe(false);
    expect(shareUnsettled({ kind: "unavailable" })).toBe(false);
    expect(shareUnsettled({ kind: "off" })).toBe(false);
    expect(shareUnsettled({ kind: "on", publicAt: AT })).toBe(false);
  });
});
