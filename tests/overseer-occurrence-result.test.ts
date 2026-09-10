/**
 * **The result ladder, row by row and pair by pair.** Plan 260910f-scheduled-dispatch § D6.
 *
 * `classifyOccurrence` is pure, so every case here is a value. What these tests
 * hold: each row of the ladder fires from its own evidence; where two rows'
 * evidence is present at once the one higher in the table wins; a field the
 * exit record did not say (null) is never read as a good answer; and nothing
 * but a `completed` exit record that said all five things is `succeeded`.
 *
 * The exit records are the protocol's final `exit.json` shape (`ExitFacts`,
 * `launch-protocol.ts`): four endings, a verdict or null, and ten causes.
 *
 * No id in this file is a uuid (`tests/fixture-ids.test.ts`).
 */
import { describe, expect, test } from "vitest";

import type { ScheduledResultKind } from "../tools/fleet/wire.js";
import type { FailedProof, FailureCause } from "../tools/overseer/launch-protocol.js";
import {
  classifyOccurrence,
  RESULT_FAILED,
  type ObservedCompletion,
  type ObservedExitRecord,
  type ObservedLaunch,
  type ObservedState,
} from "../tools/overseer/occurrence-result.js";

const UPDATED = "2026-09-10T09:30:00.000Z";
/** Earlier than `UPDATED`: a release after the ending moves `updatedAt`, never the ending. */
const ENDED = "2026-09-10T09:20:00.000Z";
const SHA = "0123456789abcdef".repeat(4);

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
    run: { timeoutMinutes: 5, access: "read-only", account: "pool-a" },
    tmuxSession: null,
    transcriptPath: null,
    answer: { kind: "present", attempt: 1, bytes: 6, sha256: SHA, usable: true },
    disposition: null,
    state,
    ...over,
  };
}

/** The evidence of a good run, as a wrapper writes it; each test spoils one thing. */
function exit(over: Partial<ObservedExitRecord> = {}): ObservedExitRecord {
  return {
    kind: "exit-record",
    ending: { kind: "exited", code: 0 },
    verdict: { kind: "ok" },
    usageLimit: false,
    permissionDenials: 0,
    answer: { path: "/scratch/launches/o/x/a1/answer.md", bytes: 6, sha256: SHA, usable: true },
    transcript: null,
    ...over,
  };
}

const failed = (cause: FailureCause, why: string = `the wrapper says ${cause}`) => ({ kind: "failed" as const, cause, why });

/** What a job shell writes: how the child ended, and no judgement. */
const shell = (code: number): ObservedExitRecord => exit({ ending: { kind: "exited", code }, verdict: null, usageLimit: null, permissionDenials: null, answer: null });

const completed = (evidence: ObservedCompletion): ObservedState => ({ kind: "completed", attempt: 1, evidence, endedAt: ENDED });
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

  test("outcome-unknown is unknown, carries the protocol's why, and is dated by the record", () => {
    const result = classify({ kind: "outcome-unknown", attempt: 1, why: "the supervisor vanished on the same boot" });
    expect(result).toMatchObject({ kind: "unknown", at: UPDATED });
    expect(result.why).toContain("the supervisor vanished on the same boot");
  });
});

describe("an ending is dated by endedAt, never by updatedAt", () => {
  test("failed-before-launch", () => {
    expect(classify({ kind: "failed-before-launch", attempt: null, proof: "admission-refused", why: "no slot", endedAt: ENDED }).at).toBe(ENDED);
  });

  test("completed", () => {
    expect(classify(completed(exit())).at).toBe(ENDED);
  });

  test("a reboot", () => {
    expect(classify(completed({ kind: "rebooted" })).at).toBe(ENDED);
  });
});

describe("launch-failed: nothing ran", () => {
  test("failed-before-launch is launch-failed, naming its proof", () => {
    const result = classify({ kind: "failed-before-launch", attempt: null, proof: "material-mismatch", why: "material.txt no longer matched its pin", endedAt: ENDED });
    expect(result.kind).toBe("launch-failed");
    expect(result.why).toContain("material-mismatch");
    expect(result.why).toContain("material.txt no longer matched its pin");
  });

  /** Every proof but `superseded`, with the compiler counting: a new proof is a compile error here until somebody says what it reads as. */
  const FAILURE_PROOFS: { readonly [P in Exclude<FailedProof, "superseded">]: true } = {
    "admission-refused": true,
    "restarted-before-launching": true,
    "material-mismatch": true,
    "intent-not-written": true,
    "launcher-refused": true,
  };

  test.each(Object.keys(FAILURE_PROOFS) as Exclude<FailedProof, "superseded">[])("proof %s is still launch-failed", (proof) => {
    expect(classify({ kind: "failed-before-launch", attempt: null, proof, why: "the reason", endedAt: ENDED }).kind).toBe("launch-failed");
  });

  test.each(["wrapper", "prompt-unverified", "spawn"] as const)("a not-run ending with cause %s is launch-failed, saying which", (cause) => {
    const result = classify(completed(exit({ ending: { kind: "not-run" }, verdict: failed(cause), usageLimit: null, permissionDenials: null, answer: null })));
    expect(result.kind).toBe("launch-failed");
    expect(result.why).toContain(cause);
    expect(result.why).toContain(`the wrapper says ${cause}`);
  });

  test("an unverified prompt is launch-failed even over a child ending — the prompt check comes before any child", () => {
    expect(kindOf(exit({ ending: { kind: "exited", code: 1 }, verdict: failed("prompt-unverified") }))).toBe("launch-failed");
  });

  test("a wrapper failure over a child that DID run is not launch-failed: the child's ending decides", () => {
    const result = classify(completed(exit({ ending: { kind: "exited", code: 3 }, verdict: failed("wrapper", "the wrapper exited 0 over a child that did not exit 0") })));
    expect(result.kind).toBe("failed");
    expect(result.why).toContain("the wrapper exited 0 over a child that did not exit 0");
  });
});

describe("timed-out", () => {
  test.each<[string, ObservedExitRecord["ending"]]>([
    ["signalled", { kind: "signalled", signal: "SIGTERM" }],
    ["exited", { kind: "exited", code: 124 }],
    ["unobserved", { kind: "unobserved" }],
  ])("a verdict of timeout is timed-out over a %s ending", (_name, ending) => {
    const result = classify(completed(exit({ ending, verdict: failed("timeout", "ran past 5 minutes") })));
    expect(result.kind).toBe("timed-out");
    expect(result.why).toContain("ran past 5 minutes");
  });
});

describe("interrupted", () => {
  test("a hangup — tmux kill-session — over a signalled child is interrupted, naming the hangup", () => {
    const result = classify(completed(exit({ ending: { kind: "signalled", signal: "SIGHUP" }, verdict: failed("hangup", "the wrapper was hung up") })));
    expect(result.kind).toBe("interrupted");
    expect(result.why).toContain("hangup");
    expect(result.why).toContain("the wrapper was hung up");
  });

  test("a hangup over a child that exited after it was forwarded is still interrupted", () => {
    expect(kindOf(exit({ ending: { kind: "exited", code: 129 }, verdict: failed("hangup", "the wrapper was hung up") }))).toBe("interrupted");
  });

  test.each(["nonzero", "cli-error", "wrapper"] as const)("a signalled child with cause %s is interrupted, naming the signal", (cause) => {
    const result = classify(completed(exit({ ending: { kind: "signalled", signal: "SIGINT" }, verdict: failed(cause) })));
    expect(result.kind).toBe("interrupted");
    expect(result.why).toContain("SIGINT");
  });

  test("a signalled child with no verdict is interrupted", () => {
    expect(kindOf(exit({ ending: { kind: "signalled", signal: "SIGKILL" }, verdict: null, usageLimit: null, permissionDenials: null }))).toBe("interrupted");
  });

  test("an unobserved ending is interrupted, saying the wrapper could not see how its child ended", () => {
    const result = classify(completed(exit({ ending: { kind: "unobserved" }, verdict: failed("wrapper", "forced settle") })));
    expect(result.kind).toBe("interrupted");
    expect(result.why).toMatch(/could not observe/);
  });

  test("a reboot is interrupted", () => {
    expect(kindOf({ kind: "rebooted" })).toBe("interrupted");
  });
});

describe("the remaining ending rows", () => {
  test("a usage limit is quota-refused", () => {
    expect(kindOf(exit({ ending: { kind: "exited", code: 1 }, usageLimit: true, verdict: failed("cli-error", "limit") }))).toBe("quota-refused");
  });

  test("a permission denial is permission-denied, naming the count", () => {
    const result = classify(completed(exit({ permissionDenials: 3 })));
    expect(result.kind).toBe("permission-denied");
    expect(result.why).toContain("3");
  });

  test("an exit of 0 with an unusable answer is missing-answer", () => {
    expect(kindOf(exit({ answer: { path: "/scratch/answer.md", bytes: 2, sha256: SHA, usable: false } }))).toBe("missing-answer");
  });

  test("an exit of 0 with no answer at all is missing-answer", () => {
    expect(kindOf(exit({ answer: null }))).toBe("missing-answer");
  });

  test.each(["no-result", "empty-answer"] as const)("a wrapper verdict of %s is missing-answer, whatever the exit code", (cause) => {
    expect(kindOf(exit({ ending: { kind: "exited", code: 1 }, verdict: failed(cause) }))).toBe("missing-answer");
  });

  test("a non-zero exit from a job shell is failed, naming the code", () => {
    const result = classify(completed(shell(2)));
    expect(result.kind).toBe("failed");
    expect(result.why).toContain("2");
  });

  test.each(["cli-error", "overflow", "nonzero"] as const)("a wrapper verdict of %s is failed, with the wrapper's why", (cause) => {
    const result = classify(completed(exit({ ending: { kind: "exited", code: 1 }, verdict: failed(cause) })));
    expect(result.kind).toBe("failed");
    expect(result.why).toContain(`the wrapper says ${cause}`);
  });

  test("an exit record the attempt's exit.json could not confirm is failed, with the reason", () => {
    const result = classify(completed({ kind: "exit-unconfirmed", why: "exit.json is not JSON" }));
    expect(result.kind).toBe("failed");
    expect(result.why).toContain("exit.json is not JSON");
  });

  test("the good run is succeeded", () => {
    expect(classify(completed(exit())).kind).toBe("succeeded");
  });

  test.each([
    { kind: "absent" } as const,
    { kind: "present", attempt: 1, bytes: 1, sha256: SHA, usable: false } as const,
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
    ["a not-run ending AND an answer file left lying there", exit({ ending: { kind: "not-run" }, verdict: failed("spawn"), usageLimit: null, permissionDenials: null }), "launch-failed"],
    ["an unverified prompt AND a usage limit", exit({ ending: { kind: "exited", code: 1 }, verdict: failed("prompt-unverified"), usageLimit: true }), "launch-failed"],
    ["a timeout AND a usage limit", exit({ ending: { kind: "signalled", signal: "SIGTERM" }, verdict: failed("timeout"), usageLimit: true }), "timed-out"],
    ["a timeout AND permission denials", exit({ ending: { kind: "unobserved" }, verdict: failed("timeout"), permissionDenials: 2 }), "timed-out"],
    ["a usage limit AND a signal", exit({ ending: { kind: "signalled", signal: "SIGINT" }, verdict: failed("nonzero"), usageLimit: true }), "quota-refused"],
    ["a usage limit AND a hangup", exit({ ending: { kind: "signalled", signal: "SIGHUP" }, verdict: failed("hangup"), usageLimit: true }), "quota-refused"],
    ["a usage limit AND permission denials", exit({ usageLimit: true, permissionDenials: 2 }), "quota-refused"],
    ["a signal AND permission denials", exit({ ending: { kind: "signalled", signal: "SIGINT" }, verdict: failed("nonzero"), permissionDenials: 2 }), "interrupted"],
    ["a hangup on an exited child AND permission denials", exit({ ending: { kind: "exited", code: 129 }, verdict: failed("hangup"), permissionDenials: 2 }), "interrupted"],
    ["an unobserved ending AND permission denials", exit({ ending: { kind: "unobserved" }, verdict: failed("wrapper"), permissionDenials: 2 }), "interrupted"],
    ["a permission denial with a usable answer and an ok verdict", exit({ permissionDenials: 1 }), "permission-denied"],
    ["a permission denial AND no usable answer", exit({ permissionDenials: 1, answer: null }), "permission-denied"],
    ["a no-result verdict AND a non-zero exit", exit({ ending: { kind: "exited", code: 1 }, verdict: failed("no-result") }), "missing-answer"],
    ["an unusable answer AND a cli-error verdict on exit 0", exit({ answer: null, verdict: failed("cli-error") }), "missing-answer"],
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
    expect(classify({ kind: "failed-before-launch", attempt: null, proof: "admission-refused", why: "no slot", endedAt: ENDED }, { disposition }).kind).toBe("launch-failed");
  });
});

describe("null means the exit record did not say, and it is never success", () => {
  test("an exit of 0 with no verdict and a usable answer is failed, saying the wrapper gave no verdict", () => {
    const result = classify(completed(exit({ verdict: null, usageLimit: null, permissionDenials: null })));
    expect(result.kind).toBe("failed");
    expect(result.why).toMatch(/verdict/);
  });

  test("a job shell's exit of 0 — nothing said but the code, no answer — is missing-answer", () => {
    expect(kindOf(shell(0))).toBe("missing-answer");
  });

  test("an unsaid usage limit (run-codex) is not a clear one", () => {
    const result = classify(completed(exit({ usageLimit: null })));
    expect(result.kind).toBe("failed");
    expect(result.why).toMatch(/usage limit/);
  });

  test("an unsaid denial count (run-codex) is not zero", () => {
    const result = classify(completed(exit({ permissionDenials: null })));
    expect(result.kind).toBe("failed");
    expect(result.why).toMatch(/permission denial/);
  });

  test("an unsaid usage limit is not a refusal either", () => {
    expect(kindOf(shell(1))).toBe("failed");
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
    { kind: "completed", attempt: 1, evidence: { kind: "rebooted" }, endedAt: ENDED },
    { kind: "failed-before-launch", attempt: 1, proof: "launcher-refused", why: "tmux server not running", endedAt: ENDED },
    { kind: "outcome-unknown", attempt: 1, why: "cannot tell" },
  ];

  test("the list above covers all eight states", () => {
    expect(new Set(everyState.map((state) => state.kind)).size).toBe(8);
  });

  test.each(everyState)("%j is not succeeded, even with a live tmux session and a usable answer beside it", (state) => {
    const result = classify(state, { tmuxSession: "sched-fixture", answer: { kind: "present", attempt: 1, bytes: 40, sha256: SHA, usable: true } });
    expect(result.kind).not.toBe("succeeded");
  });

  test("and the good exit record is — the control that shows the loop above could fail", () => {
    expect(kindOf(good)).toBe("succeeded");
  });
});

describe("superseded: set aside on purpose, and nothing ran — not a failure (M13)", () => {
  test.each([
    "superseded by fedcba987654",
    "pinned account pool-b is no longer usable: it is not a registered Claude pool account",
  ])("a failed-before-launch with proof superseded is superseded, its why the abandon's reason (%s), dated by endedAt", (reason) => {
    const result = classify({ kind: "failed-before-launch", attempt: null, proof: "superseded", why: reason, endedAt: ENDED });
    expect(result).toEqual({ kind: "superseded", why: reason, at: ENDED });
  });

  test("it is not a failure kind", () => {
    expect(RESULT_FAILED.has("superseded")).toBe(false);
  });
});

describe("RESULT_FAILED", () => {
  test("is the seven failure kinds, and not the four open ones or succeeded", () => {
    expect([...RESULT_FAILED].sort()).toEqual(
      ["failed", "interrupted", "launch-failed", "missing-answer", "permission-denied", "quota-refused", "timed-out"].sort(),
    );
  });
});
