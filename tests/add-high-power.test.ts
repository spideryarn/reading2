/**
 * The add page's High-powered AI intent — src/web/add-high-power.ts, plan
 * docs/plans/261002k-high-powered-ai-at-import.md. Every answer the `PUT` can
 * give, driven through an injected request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HighPowerIntent,
  MAX_NOT_YET,
  mayHaveStartedOnStandard,
  type PutHighPower,
} from "../src/web/add-high-power.js";

const SINCE = "2026-10-02T23:00:00.000Z";

function refusal(status: number, message = "no"): Error {
  return Object.assign(new Error(message), { status });
}

/** A `put` whose answers are queued by the test, recording every call. */
function scripted(...answers: Array<string | null | Error>) {
  const calls: Array<[string, boolean]> = [];
  const put: PutHighPower = async (slug, on) => {
    calls.push([slug, on]);
    const next = answers.shift();
    if (next === undefined) throw new Error("unscripted call");
    if (next instanceof Error) throw next;
    return { highPowerSince: next };
  };
  return { put, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("HighPowerIntent", () => {
  it("waits for the slug, then sends once and shows the server's answer", async () => {
    const { put, calls } = scripted(SINCE);
    const intent = new HighPowerIntent(put, 10);
    intent.want(true);
    expect(intent.get()).toEqual({ kind: "waiting" });
    expect(calls).toEqual([]);

    intent.observe("an-essay", true, false);
    expect(intent.get()).toEqual({ kind: "saving", on: true });
    await vi.runAllTimersAsync();
    expect(calls).toEqual([["an-essay", true]]);
    expect(intent.get()).toEqual({ kind: "on", since: SINCE, lateRisk: false });

    /* Later renders send nothing more. */
    intent.observe("an-essay", true, true);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
  });

  it("treats a 404 as *not yet* while the job is alive, and retries", async () => {
    const { put, calls } = scripted(refusal(404), refusal(404), SINCE);
    const intent = new HighPowerIntent(put, 10);
    intent.observe("an-essay", true, false);
    intent.want(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(intent.get()).toEqual({ kind: "waiting" });
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(3);
    expect(intent.get().kind).toBe("on");
  });

  it("gives up retrying after MAX_NOT_YET", async () => {
    const { put, calls } = scripted(...Array.from({ length: MAX_NOT_YET + 1 }, () => refusal(404, "gone")));
    const intent = new HighPowerIntent(put, 1);
    intent.observe("an-essay", true, false);
    intent.want(true);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(MAX_NOT_YET + 1);
    expect(intent.get()).toEqual({ kind: "refused", message: "gone" });
  });

  it("takes a 404 as final once the job has ended", async () => {
    const { put } = scripted(refusal(404, "No article artefacts"));
    const intent = new HighPowerIntent(put, 10);
    intent.observe("an-essay", false, false);
    intent.want(true);
    await vi.runAllTimersAsync();
    expect(intent.get()).toEqual({ kind: "refused", message: "No article artefacts" });
  });

  it("shows a refusal and does not retry it", async () => {
    const { put, calls } = scripted(refusal(402, "[pay-high-power] not enough left"));
    const intent = new HighPowerIntent(put, 10);
    intent.observe("an-essay", true, false);
    intent.want(true);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
    expect(intent.get()).toEqual({ kind: "refused", message: "[pay-high-power] not enough left" });
  });

  it("says *unknown*, not off, when no answer arrived", async () => {
    const { put } = scripted(new TypeError("Failed to fetch"));
    const intent = new HighPowerIntent(put, 10);
    intent.observe("an-essay", true, false);
    intent.want(true);
    await vi.runAllTimersAsync();
    expect(intent.get()).toEqual({ kind: "unknown", message: "Failed to fetch" });
  });

  it("unticking before anything was sent costs nothing and sends nothing", async () => {
    const { put, calls } = scripted();
    const intent = new HighPowerIntent(put, 10);
    intent.want(true);
    intent.want(false);
    intent.observe("an-essay", true, false);
    await vi.runAllTimersAsync();
    expect(calls).toEqual([]);
    expect(intent.get()).toEqual({ kind: "off" });
  });

  it("unticking after it is on sends off", async () => {
    const { put, calls } = scripted(SINCE, null);
    const intent = new HighPowerIntent(put, 10);
    intent.observe("an-essay", true, false);
    intent.want(true);
    await vi.runAllTimersAsync();
    intent.want(false);
    await vi.runAllTimersAsync();
    expect(calls).toEqual([
      ["an-essay", true],
      ["an-essay", false],
    ]);
    expect(intent.get()).toEqual({ kind: "off" });
  });

  it("records whether earlier work may have used the standard model, when it answers", async () => {
    const { put } = scripted(SINCE);
    const intent = new HighPowerIntent(put, 10);
    intent.want(true);
    intent.observe("an-essay", true, true);
    await vi.runAllTimersAsync();
    expect(intent.get()).toEqual({ kind: "on", since: SINCE, lateRisk: true });
  });

  describe("settle — before the main modes are queued", () => {
    it("resolves at once and sends nothing when it was never wanted", async () => {
      const { put, calls } = scripted();
      const intent = new HighPowerIntent(put, 10);
      await intent.settle("an-essay");
      expect(calls).toEqual([]);
    });

    it("sends a still-waiting intent against the completion's slug, and resolves after it", async () => {
      const { put, calls } = scripted(SINCE);
      const intent = new HighPowerIntent(put, 10);
      intent.want(true);
      const settled = intent.settle("from-the-completion");
      expect(intent.get().kind).toBe("saving");
      await settled;
      expect(calls).toEqual([["from-the-completion", true]]);
      expect(intent.get().kind).toBe("on");
    });

    it("cuts a not-yet retry short and asks now, with a 404 final", async () => {
      const { put, calls } = scripted(refusal(404), refusal(404, "No article"));
      const intent = new HighPowerIntent(put, 60_000);
      intent.observe("an-essay", true, false);
      intent.want(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(intent.get()).toEqual({ kind: "waiting" });
      await intent.settle("an-essay");
      expect(calls).toHaveLength(2);
      expect(intent.get()).toEqual({ kind: "refused", message: "No article" });
    });

    it("waits for a request already in flight", async () => {
      let answer: (v: { highPowerSince: string | null }) => void = () => {};
      const put: PutHighPower = () =>
        new Promise((resolve) => {
          answer = resolve;
        });
      const intent = new HighPowerIntent(put, 10);
      intent.observe("an-essay", true, false);
      intent.want(true);
      let done = false;
      void intent.settle("an-essay").then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(false);
      answer({ highPowerSince: SINCE });
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
    });
  });

  it("stops retrying once disposed", async () => {
    const { put, calls } = scripted(refusal(404));
    const intent = new HighPowerIntent(put, 10);
    intent.observe("an-essay", true, false);
    intent.want(true);
    await vi.advanceTimersByTimeAsync(0);
    intent.dispose();
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
  });
});

describe("mayHaveStartedOnStandard", () => {
  const step = (name: string, status: string) => ({ name, status });
  it("is false while only fetch and blocks have moved", () => {
    expect(mayHaveStartedOnStandard(undefined)).toBe(false);
    expect(
      mayHaveStartedOnStandard([step("fetch", "done"), step("extract", "pending"), step("structure", "pending")]),
    ).toBe(false);
  });
  it("is true once extract (capable-tier for a PDF) or anything later has started", () => {
    expect(mayHaveStartedOnStandard([step("fetch", "done"), step("extract", "running")])).toBe(true);
    expect(mayHaveStartedOnStandard([step("blocks", "done"), step("structure", "running")])).toBe(true);
    expect(mayHaveStartedOnStandard([step("structure", "skipped")])).toBe(true);
  });
});
