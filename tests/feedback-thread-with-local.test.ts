/**
 * `withLocal`, the receipts of a reply this page sent laid over the server's
 * thread, against the replies an agent has acted on (plan 261010g, GPT Sol's
 * plan review P1): an idempotent retry can hand back a reply the server
 * already lists as acted on, which must not be drawn twice or move the thread
 * to *being considered*.
 */
import { describe, expect, it } from "vitest";
import { withLocal, type ThreadQuestion } from "../src/web/FeedbackEarlier.js";

const ACTED = { id: "spya-ac7edz", body: "A", createdAt: "2026-10-09T23:45:00.000Z" };
const NEW = { id: "spya-a9b2c4", body: "And one more.", createdAt: "2026-10-10T08:00:00.000Z" };
const WAITING: ThreadQuestion = {
  id: "q-aaaaaa",
  title: "One switch or two?",
  body: "Background.",
  asked: "2026-10-09",
  report: null,
  answers: [],
  olderAnswers: 0,
  actedAnswers: [ACTED],
  olderActedAnswers: 0,
  state: "waiting",
  deferredAt: null,
};
const STARTED = 100;

describe("withLocal and acted replies", () => {
  it("ignores a receipt the server already lists as acted on", () => {
    const merged = withLocal(WAITING, STARTED, { sent: { "q-aaaaaa": { value: [ACTED], at: STARTED + 1 } }, deferrals: {} });
    expect(merged.answers).toEqual([]);
    expect(merged.state).toBe("waiting");
  });

  it("still lays over a new reply sent beside an acted one", () => {
    const merged = withLocal(WAITING, STARTED, {
      sent: { "q-aaaaaa": { value: [ACTED, NEW], at: STARTED + 1 } },
      deferrals: {},
    });
    expect(merged.answers).toEqual([NEW]);
    expect(merged.state).toBe("responded");
  });

  it("lets a deferral stand when the only later receipt is ignored as already acted on", () => {
    const merged = withLocal(WAITING, STARTED, {
      sent: { "q-aaaaaa": { value: [ACTED], at: STARTED + 2 } },
      deferrals: { "q-aaaaaa": { value: "2026-10-10T07:00:00.000Z", at: STARTED + 1 } },
    });
    expect(merged.answers).toEqual([]);
    expect(merged.state).toBe("deferred");
    expect(merged.deferredAt).toBe("2026-10-10T07:00:00.000Z");
  });

  it("compares a mixed receipt with a deferral because its new reply is not ignored", () => {
    const merged = withLocal(WAITING, STARTED, {
      sent: { "q-aaaaaa": { value: [ACTED, NEW], at: STARTED + 2 } },
      deferrals: { "q-aaaaaa": { value: "2026-10-10T07:00:00.000Z", at: STARTED + 1 } },
    });
    expect(merged.answers).toEqual([NEW]);
    expect(merged.state).toBe("responded");
    expect(merged.deferredAt).toBeNull();
  });
});
