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
 * completion (P2-7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_NOT_YET } from "../src/web/add-high-power.js";
import { type Probe, ShareAtAdd, type ShareIo, shareUnsettled } from "../src/web/add-share.js";

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
  const io: ShareIo = {
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
  return { io, calls, probes };
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
      expect(share.get()).toEqual({ kind: "unknown" });
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

describe("one share per slug — disposed when the slug changes", () => {
  it("after a share succeeded, sends its own slug private and changes no state", async () => {
    const { io, calls } = scripted("none", PUBLIC, PRIVATE);
    const share = await offered(io);
    confirm(share);
    await vi.runAllTimersAsync();
    share.dispose();
    await vi.runAllTimersAsync();
    expect(calls).toEqual([
      ["an-essay", "public"],
      ["an-essay", "private"],
    ]);
    expect(share.get()).toEqual({ kind: "on", publicAt: AT });
  });

  it("while unknown, sends its own slug private", async () => {
    const { io, calls } = scripted("none", new TypeError("Failed to fetch"), PRIVATE);
    const share = await offered(io);
    confirm(share);
    await vi.runAllTimersAsync();
    share.dispose();
    await vi.runAllTimersAsync();
    expect(calls).toEqual([
      ["an-essay", "public"],
      ["an-essay", "private"],
    ]);
  });

  it("during an unanswered request: the answer changes no state, and a share that took is taken back", async () => {
    let answer: (v: typeof PUBLIC) => void = () => {};
    const calls: Array<[string, string]> = [];
    const io: ShareIo = {
      probe: async () => "none",
      put: (slug, to) => {
        calls.push([slug, to]);
        if (to === "private") return Promise.resolve(PRIVATE);
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
    };
    const share = await offered(io);
    let told = 0;
    confirm(share);
    share.subscribe(() => {
      told += 1;
    });
    share.dispose();
    expect(calls).toEqual([["an-essay", "public"]]);

    answer(PUBLIC);
    await vi.runAllTimersAsync();
    expect(share.get()).toEqual({ kind: "saving", to: "public" });
    expect(told).toBe(0);
    expect(calls).toEqual([
      ["an-essay", "public"],
      ["an-essay", "private"],
    ]);
  });

  it("during an unanswered request that is then refused, sends nothing more", async () => {
    let reject: (e: Error) => void = () => {};
    const calls: Array<[string, string]> = [];
    const io: ShareIo = {
      probe: async () => "none",
      put: (slug, to) => {
        calls.push([slug, to]);
        return new Promise((_resolve, rej) => {
          reject = rej;
        });
      },
    };
    const share = await offered(io);
    confirm(share);
    share.dispose();
    reject(refusal(404));
    await vi.runAllTimersAsync();
    expect(calls).toEqual([["an-essay", "public"]]);
  });

  it("stops a not-yet retry, and sends nothing for a share never sent", async () => {
    const { io, calls } = scripted("none", refusal(404));
    const share = await offered(io);
    confirm(share);
    await vi.advanceTimersByTimeAsync(0);
    share.dispose();
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
  });

  it("ignores a probe that answers after it was disposed", async () => {
    const { io } = scripted("none");
    const share = new ShareAtAdd("an-essay", io, 10);
    share.start();
    share.dispose();
    await vi.runAllTimersAsync();
    expect(share.get()).toEqual({ kind: "probing" });
  });
});

describe("shareUnsettled — what holds the add page from leaving by itself", () => {
  it("holds for an open confirmation and every answer the reader has not read", () => {
    expect(shareUnsettled({ kind: "confirming", rights: false })).toBe(true);
    expect(shareUnsettled({ kind: "waiting" })).toBe(true);
    expect(shareUnsettled({ kind: "saving", to: "public" })).toBe(true);
    expect(shareUnsettled({ kind: "refused", message: "no", on: false, attempted: "public" })).toBe(true);
    expect(shareUnsettled({ kind: "gave-up" })).toBe(true);
    expect(shareUnsettled({ kind: "unknown" })).toBe(true);
  });

  it("does not hold for a box never touched, or a share that is on", () => {
    expect(shareUnsettled({ kind: "probing" })).toBe(false);
    expect(shareUnsettled({ kind: "adopted" })).toBe(false);
    expect(shareUnsettled({ kind: "unavailable" })).toBe(false);
    expect(shareUnsettled({ kind: "off" })).toBe(false);
    expect(shareUnsettled({ kind: "on", publicAt: AT })).toBe(false);
  });
});
