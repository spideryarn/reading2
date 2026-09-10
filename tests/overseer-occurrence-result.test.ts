/**
 * **The result ladder, row by row and pair by pair.** Plan 260910f-scheduled-dispatch § D6.
 *
 * `classifyOccurrence` is pure, so every case here is a value. What these tests
 * hold: each row of the ladder fires from its own evidence; where two rows'
 * evidence is present at once the one higher in the table wins; a field the
 * exit record did not say (null) is never read as a good answer; and nothing
 * but a `completed` exit record that said all five things is `succeeded`.
 *
 * No id in this file is a uuid (`tests/fixture-ids.test.ts`).
 */
import { describe, expect, test } from "vitest";

import type { ScheduledResultKind } from "../tools/fleet/wire.js";
import {
  classifyOccurrence,
  RESULT_FAILED,
  type ObservedCompletion,
  type ObservedExitRecord,
  type ObservedLaunch,
  type ObservedState,
} from "../tools/overseer/occurrence-result.js";

const UPDATED = "2026-09-10T09:30:00.000Z";

function launch(state: ObservedState, over: Partial<ObservedLaunch> = {}): ObservedLaunch {
  return {
    launchOccurrenceId: "lo-0123456789abcdef0123",
    schedulerOccurrenceId: "occ-fixture-1",
    jobId: "schedule-fixture",
    scheduledAt: "2026-09-10T09:00:00.000Z",
    behaviourHash: "abcdef012345",
    plannedAt: "2026-09-10T09:00:05.000Z",
    updatedAt: UPDATED,
    attempts: 1,
    run: { timeoutMinutes: 5, access: "read-only" },
    tmuxSession: null,
    transcriptPath: null,
    answer: { kind: "present", attempt: 1, bytes: 6, sha256: "0123456789abcdef".repeat(4), usable: true },
    disposition: null,
    state,
    ...over,
  };
}

/** The evidence of a good run; each test spoils one thing. */
function exit(over: Partial<ObservedExitRecord> = {}): ObservedExitRecord {
  return {
    kind: "exit-record",
    ending: { kind: "exited", code: 0 },
    timedOut: false,
    answerUsable: true,
    verdict: { kind: "ok" },
    usageLimit: false,
    permissionDenials: 0,
    ...over,
  };
}

const completed = (evidence: ObservedCompletion): ObservedState => ({ kind: "completed", attempt: 1, evidence });
const classify = (state: ObservedState, over: Partial<ObservedLaunch> = {}) => classifyOccurrence(launch(state, over));
const kindOf = (evidence: ObservedCompletion): ScheduledResultKind => classify(completed(evidence)).kind;

describe("the not-yet-ended rows", () => {
  test.each([
    [{ kind: "planned" }, "pending"],
    [{ kind: "reserved" }, "pending"],
    [{ kind: "waiting-admission", why: "the one claude-session slot is held" }, "admission-waiting"],
    [{ kind: "launching", attempt: 1 }, "running"],
    [{ kind: "observed-running", attempt: 1 }, "running"],
  ] as const)("%j is %s, with no instant", (state, kind) => {
    const result = classify(state);
    expect(result.kind).toBe(kind);
    expect(result.at).toBeNull();
    expect(result.why.length).toBeGreaterThan(0);
  });

  test("admission-waiting names the owner's reason", () => {
    expect(classify({ kind: "waiting-admission", why: "the one claude-session slot is held" }).why).toContain("the one claude-session slot is held");
  });

  test("outcome-unknown is unknown, carries the protocol's why, and is dated", () => {
    const result = classify({ kind: "outcome-unknown", attempt: 1, why: "the supervisor vanished on the same boot" });
    expect(result).toMatchObject({ kind: "unknown", at: UPDATED });
    expect(result.why).toContain("the supervisor vanished on the same boot");
  });
});

describe("each ending row, from its own evidence", () => {
  test("failed-before-launch is launch-failed, naming its proof", () => {
    const result = classify({ kind: "failed-before-launch", attempt: null, proof: "material-mismatch", why: "material.txt no longer matched its pin" });
    expect(result).toMatchObject({ kind: "launch-failed", at: UPDATED });
    expect(result.why).toContain("material-mismatch");
    expect(result.why).toContain("material.txt no longer matched its pin");
  });

  test("a supervisor that failed is launch-failed", () => {
    const result = classify(completed(exit({ ending: { kind: "supervisor-failed", why: "spawn ENOENT" } })));
    expect(result.kind).toBe("launch-failed");
    expect(result.why).toContain("spawn ENOENT");
  });

  test("a wrapper verdict of spawn is launch-failed", () => {
    expect(kindOf(exit({ ending: { kind: "exited", code: 1 }, verdict: { kind: "failed", cause: "spawn", why: "claude not on PATH" } }))).toBe("launch-failed");
  });

  test("timedOut is timed-out", () => {
    expect(kindOf(exit({ ending: { kind: "signalled", signal: "SIGTERM" }, timedOut: true }))).toBe("timed-out");
  });

  test("a wrapper verdict of timeout is timed-out even when timedOut was not set", () => {
    expect(kindOf(exit({ ending: { kind: "exited", code: 124 }, verdict: { kind: "failed", cause: "timeout", why: "ran past 5 minutes" } }))).toBe("timed-out");
  });

  test("a usage limit is quota-refused", () => {
    expect(kindOf(exit({ ending: { kind: "exited", code: 1 }, usageLimit: true, verdict: { kind: "failed", cause: "cli-error", why: "limit" } }))).toBe("quota-refused");
  });

  test("a signal that is not a timeout is interrupted, naming the signal", () => {
    const result = classify(completed(exit({ ending: { kind: "signalled", signal: "SIGHUP" }, verdict: null, usageLimit: null, permissionDenials: null })));
    expect(result.kind).toBe("interrupted");
    expect(result.why).toContain("SIGHUP");
  });

  test("a reboot is interrupted", () => {
    expect(kindOf({ kind: "rebooted" })).toBe("interrupted");
  });

  test("a permission denial is permission-denied, naming the count", () => {
    const result = classify(completed(exit({ permissionDenials: 3 })));
    expect(result.kind).toBe("permission-denied");
    expect(result.why).toContain("3");
  });

  test("an exit of 0 with an unusable answer is missing-answer", () => {
    expect(kindOf(exit({ answerUsable: false }))).toBe("missing-answer");
  });

  test.each(["no-result", "empty-answer"] as const)("a wrapper verdict of %s is missing-answer, whatever the exit code", (cause) => {
    expect(kindOf(exit({ ending: { kind: "exited", code: 1 }, verdict: { kind: "failed", cause, why: cause } }))).toBe("missing-answer");
  });

  test("a non-zero exit is failed, naming the code", () => {
    const result = classify(completed(exit({ ending: { kind: "exited", code: 2 }, verdict: null })));
    expect(result.kind).toBe("failed");
    expect(result.why).toContain("2");
  });

  test.each(["cli-error", "overflow", "nonzero"] as const)("a wrapper verdict of %s is failed, with the wrapper's why", (cause) => {
    const result = classify(completed(exit({ ending: { kind: "exited", code: 1 }, verdict: { kind: "failed", cause, why: `the wrapper says ${cause}` } })));
    expect(result.kind).toBe("failed");
    expect(result.why).toContain(`the wrapper says ${cause}`);
  });

  test("the good run is succeeded, dated by the record", () => {
    expect(classify(completed(exit()))).toMatchObject({ kind: "succeeded", at: UPDATED });
  });

  test.each([
    { kind: "absent" } as const,
    { kind: "present", attempt: 1, bytes: 1, sha256: "0123456789abcdef".repeat(4), usable: false } as const,
    { kind: "present", attempt: 1, bytes: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", usable: true } as const,
  ])("an otherwise good exit with projected answer $kind/$usable is not succeeded", (answer) => {
    expect(classify(completed(exit()), { answer }).kind).toBe("missing-answer");
  });

  test("a negative permission-denial count is not positively zero and cannot succeed", () => {
    const result = classify(completed(exit({ permissionDenials: -1 })));
    expect(result.kind).toBe("failed");
    expect(result.why).toMatch(/permission denial/);
  });
});

describe("precedence is the table's order", () => {
  test.each<[string, ObservedExitRecord, ScheduledResultKind]>([
    ["timed out AND a usage limit", exit({ ending: { kind: "signalled", signal: "SIGTERM" }, timedOut: true, usageLimit: true }), "timed-out"],
    ["supervisor-failed AND timed out", exit({ ending: { kind: "supervisor-failed", why: "wrapper crashed" }, timedOut: true }), "launch-failed"],
    ["a spawn verdict AND timed out", exit({ ending: { kind: "exited", code: 1 }, timedOut: true, verdict: { kind: "failed", cause: "spawn", why: "x" } }), "launch-failed"],
    ["a usage limit AND a signal", exit({ ending: { kind: "signalled", signal: "SIGINT" }, usageLimit: true }), "quota-refused"],
    ["a usage limit AND permission denials", exit({ usageLimit: true, permissionDenials: 2 }), "quota-refused"],
    ["a signal AND permission denials", exit({ ending: { kind: "signalled", signal: "SIGINT" }, permissionDenials: 2 }), "interrupted"],
    ["a permission denial with a usable answer and an ok verdict", exit({ permissionDenials: 1 }), "permission-denied"],
    ["a permission denial AND no usable answer", exit({ permissionDenials: 1, answerUsable: false }), "permission-denied"],
    ["a no-result verdict AND a non-zero exit", exit({ ending: { kind: "exited", code: 1 }, verdict: { kind: "failed", cause: "no-result", why: "x" } }), "missing-answer"],
    ["an unusable answer AND a cli-error verdict on exit 0", exit({ answerUsable: false, verdict: { kind: "failed", cause: "cli-error", why: "x" } }), "missing-answer"],
  ])("%s is %s", (_name, evidence, kind) => {
    expect(kindOf(evidence)).toBe(kind);
  });
});

describe("a disposition is an ending", () => {
  const disposition = { decision: "not-running" as const, why: "Greg looked: no session on the box", at: "2026-09-10T10:00:00.000Z" };

  test.each([
    { kind: "launching", attempt: 1 },
    { kind: "observed-running", attempt: 1 },
    { kind: "outcome-unknown", attempt: 1, why: "the supervisor vanished" },
  ] as const)("a disposed %j is interrupted, dated by the disposition, with Greg's reason", (state) => {
    const result = classify(state, { disposition });
    expect(result).toMatchObject({ kind: "interrupted", at: disposition.at });
    expect(result.why).toContain("Greg looked: no session on the box");
  });

  test("an exit record outranks a disposition the protocol would not have allowed", () => {
    expect(classify(completed(exit()), { disposition }).kind).toBe("succeeded");
  });

  test("a proof that nothing ran outranks one too", () => {
    expect(classify({ kind: "failed-before-launch", attempt: null, proof: "admission-refused", why: "no slot" }, { disposition }).kind).toBe("launch-failed");
  });
});

describe("null means the exit record did not say, and it is never success", () => {
  test("an exit of 0 with no verdict and a usable answer is failed, saying the wrapper gave no verdict", () => {
    const result = classify(completed(exit({ verdict: null })));
    expect(result.kind).toBe("failed");
    expect(result.why).toMatch(/verdict/);
  });

  test("an exit of 0 with no verdict and no answer is missing-answer", () => {
    expect(kindOf(exit({ verdict: null, answerUsable: null }))).toBe("missing-answer");
  });

  test("an exit of 0 with an answer nobody said was usable is missing-answer", () => {
    expect(kindOf(exit({ answerUsable: null }))).toBe("missing-answer");
  });

  test("an unsaid usage limit is not a clear one", () => {
    const result = classify(completed(exit({ usageLimit: null })));
    expect(result.kind).toBe("failed");
    expect(result.why).toMatch(/usage limit/);
  });

  test("an unsaid denial count is not zero", () => {
    const result = classify(completed(exit({ permissionDenials: null })));
    expect(result.kind).toBe("failed");
    expect(result.why).toMatch(/permission denial/);
  });

  test("an unsaid usage limit is not a refusal either", () => {
    expect(kindOf(exit({ ending: { kind: "exited", code: 1 }, usageLimit: null, verdict: null }))).toBe("failed");
  });

  test("a tmux launch's exit of 0 — nothing said but the code — is not succeeded", () => {
    expect(kindOf(exit({ verdict: null, answerUsable: null, usageLimit: null, permissionDenials: null }))).not.toBe("succeeded");
  });
});

describe("only a completed exit record can be succeeded", () => {
  const good = exit();
  const everyState: ObservedState[] = [
    { kind: "planned" },
    { kind: "waiting-admission", why: "held" },
    { kind: "reserved" },
    { kind: "launching", attempt: 1 },
    { kind: "observed-running", attempt: 1 },
    { kind: "completed", attempt: 1, evidence: { kind: "rebooted" } },
    { kind: "failed-before-launch", attempt: 1, proof: "launcher-refused", why: "tmux server not running" },
    { kind: "outcome-unknown", attempt: 1, why: "cannot tell" },
  ];

  test("the list above covers all eight states", () => {
    expect(new Set(everyState.map((state) => state.kind)).size).toBe(8);
  });

  test.each(everyState)("%j is not succeeded, even with a live tmux session and a usable answer beside it", (state) => {
    const result = classify(state, { tmuxSession: "sched-fixture", answer: { kind: "present", attempt: 1, bytes: 40, sha256: "0123456789abcdef".repeat(4), usable: true } });
    expect(result.kind).not.toBe("succeeded");
  });

  test("and the good exit record is — the control that shows the loop above could fail", () => {
    expect(kindOf(good)).toBe("succeeded");
  });
});

describe("RESULT_FAILED", () => {
  test("is the seven failure kinds, and not the four open ones or succeeded", () => {
    expect([...RESULT_FAILED].sort()).toEqual(
      ["failed", "interrupted", "launch-failed", "missing-answer", "permission-denied", "quota-refused", "timed-out"].sort(),
    );
  });
});
