/**
 * The Overseer's differ: the canonical transition key, the identity pair, and
 * the generation rule.
 *
 * The four real pairs in tests/fixtures/overseer-snapshots/ carry a status
 * change, a disappearance, an appearance and a byte-identical duplicate. They
 * carry one tmux generation, no `unknown` status, no `waiting` and no resumed
 * session — so the three rules with the sharpest teeth have no real example and
 * every case below that exercises one says CONSTRUCTED in its name and starts
 * from one of those files.
 */
import { describe, expect, test } from "vitest";

import type { SessionState } from "../scripts/gjd-remote-tmux.js";
import type { AdmissibleSnapshot } from "../tools/overseer/admissible.js";
import {
  baselineOf,
  diff,
  generationRelation,
  sessionKey,
  statusKey,
  waitDeadlineToleranceMs,
  type Baseline,
  type SessionEvent,
} from "../tools/overseer/diff.js";
import type { JsonValue } from "../tools/overseer/observation.js";
import { editableFixture, freshFixture, freshFrom, rowsOf, type FixtureName } from "./overseer-fixtures.js";

/** A fixture with one field edited, back through the real parser. */
function edited(name: FixtureName, edit: (payload: Record<string, JsonValue>) => void) {
  const payload = editableFixture(name);
  edit(payload);
  return freshFrom(payload, `${name} (constructed)`);
}

/**
 * The events, for the cases that expect a comparison to have happened at all.
 *
 * IT THROWS ON A HOLD RATHER THAN RETURNING `[]`, because those two are the
 * pair this stage's P0 was about: an empty event list and a refusal to compare
 * look identical to a caller that only reads events, and every test below that
 * expects silence would go on passing if `diff()` quietly started holding
 * everything.
 */
function diffed(previous: AdmissibleSnapshot | null, next: AdmissibleSnapshot): SessionEvent[] {
  const outcome = diff(previous === null ? null : mustBaseline(previous), next);
  if (outcome.kind !== "diffed") throw new Error(`expected a diff, got ${outcome.kind}: ${outcome.reason}`);
  return outcome.events;
}

/**
 * A snapshot promoted to a world, through the real gate.
 *
 * `admissible()` cannot hand out a baseline any more (S2-01, second attempt), so
 * every test that compares two collections goes through `baselineOf` exactly as
 * a restarted daemon does. It THROWS on a refusal rather than shrugging, and
 * puts the refusal's own sentence in the message: passing a null `previous` into
 * `diff()` compiles and quietly means "cold start", which would turn a refused
 * world into a fleet's worth of `session-seen` in the middle of a test that was
 * checking for silence.
 */
function mustBaseline(snapshot: AdmissibleSnapshot): Baseline {
  const result = baselineOf(snapshot);
  if (!result.ok) throw new Error(`refused as a baseline: ${result.reason}`);
  return result.baseline;
}

function kinds(events: readonly SessionEvent[]): string[] {
  return events.map((e) => e.kind);
}

/**
 * Several collections in a row, through the daemon's own loop: each diff's own
 * baseline is what the next one stands on.
 *
 * **NOT `diffed(b, c)` WITH THE MIDDLE SNAPSHOT RE-BLESSED**, and the
 * difference is the whole subject of the flap case below. What makes
 * `42 → null → 42` a false replacement is that the baseline ADVANCES through the
 * miss, so a test that reached back through `baselineOf` would be asserting
 * about a chain the daemon never runs. Two snapshots can only ever show the
 * differ its own inputs; three show it the state it does not have.
 *
 * The first batch is a cold start — one `session-seen` per row — and every
 * caller here ignores it.
 */
function chained(snapshots: readonly AdmissibleSnapshot[]): SessionEvent[][] {
  let baseline: Baseline | null = null;
  const batches: SessionEvent[][] = [];
  for (const snapshot of snapshots) {
    const outcome = diff(baseline, snapshot);
    if (outcome.kind !== "diffed") throw new Error(`expected a diff, got ${outcome.kind}: ${outcome.reason}`);
    batches.push(outcome.events);
    baseline = outcome.baseline;
  }
  return batches;
}

/**
 * Everything the `status-change` pair's own real transition did not produce.
 *
 * `$1991` is the session that really changes state between those two files, so a
 * test constructing a SECOND change on another row has to say which events it is
 * asserting about. Filtering by handle rather than by kind, so an unexpected
 * extra event on the constructed row still shows up.
 */
function elsewhere(events: readonly SessionEvent[]): SessionEvent[] {
  return events.filter((e) => e.identity.tmuxId !== "$1991");
}

/**
 * THE RULES THAT ARE TYPES RATHER THAN BEHAVIOUR, so this is the only test here
 * that vitest cannot fail. It goes red under `npm run typecheck`, which is the
 * wrapper that includes tests/ — `tsc` on the app alone never reads this file,
 * and vitest strips these annotations without looking at them.
 *
 * Each `@ts-expect-error` below is an assertion that the line under it does NOT
 * compile. If a later change makes any of them legal again, the directive
 * becomes unused and the build fails saying so — which is the only way a
 * compile-time guarantee can be regression-tested.
 *
 * **WHAT IT PROVES, AND THE LIMIT.** It proves that these three forgeries need
 * a cast: an admissible snapshot is not a baseline, a spread is not an
 * admission, and a field assignment on an accepted snapshot is refused. It does
 * NOT prove immutability, and reading it as though it did is the mistake this
 * whole stage keeps finding. `Object.assign(admitted.snapshot, …)` compiles —
 * `readonly` is compile-time and shallow — and so does a write nested inside a
 * row. The runtime consequence of the first is covered by the mutated-baseline
 * test below; the nested one is uncovered on purpose, and `AdmissibleSnapshot`
 * says why.
 */
test("TYPE-LEVEL: the three forgeries the P0 and S2-07 turned on", () => {
  const admitted = freshFixture("status-change-before");

  // DECLARED AND NEVER CALLED, on purpose. Every line inside is a claim about
  // what the COMPILER refuses, and running them would only prove that a forged
  // snapshot crashes — which is not the guarantee being made.
  const forgeries = (): void => {
    // 1. AN ADMISSIBLE SNAPSHOT IS NOT A BASELINE. This is the hole S2-01 was
    //    reopened for: withholding `baseline` from a `held` result does not
    //    take away the reference the caller already had, so `baseline = b`
    //    compiled. Now they are different types, and the only two things that
    //    mint the second both ask whether the snapshot can be placed in a world.
    // @ts-expect-error - `previous` is a Baseline: something diff() produced, never something admissible() did
    diff(admitted, admitted);

    // 2. A SPREAD IS NOT AN ADMISSION. Every invariant `admissible()` checks —
    //    error-nullness above all — used to survive `{...snapshot, error:
    //    "boom"}` with the brand intact and no cast, so a failed collection
    //    could still be turned into a fleet's worth of false disappearances.
    // @ts-expect-error - a plain object cannot be an AdmissibleSnapshot, whatever fields it copies
    diff(null, { ...admitted.snapshot, error: "boom" });

    // 3. AND NEITHER IS A MUTATION, which is the same hole reached without a
    //    spread: the accepted snapshot's own fields are readonly now.
    // @ts-expect-error - the accepted snapshot is readonly, so its admissibility cannot be edited away
    admitted.snapshot.error = "boom";
  };

  expect(typeof forgeries).toBe("function");
  expect(admitted.snapshot.error).toBeNull();
});

describe("the real pairs", () => {
  test("a status change is one event, and it names both ends of it", () => {
    const before = freshFixture("status-change-before");
    const after = freshFixture("status-change-after");
    const events = diffed(before, after);

    expect(events).toHaveLength(1);
    const [event] = events;
    if (event?.kind !== "session-status") throw new Error(`expected a status event, got ${event?.kind}`);
    expect(event.identity.tmuxId).toBe("$1991");
    expect(event.from).toBe("idle");
    expect(event.to).toBe("working");
    expect(event.at).toBe(after.snapshot.clock.at);
    expect(event.tmuxServerPid).toBe(132280);
    // The key is the PAIR, so the claimed conversation is in it — and the word
    // `claims` is in the key on purpose, because a human reading the log should
    // not take that half for a verified fact either.
    expect(event.key).toContain("$1991 claims:");
  });

  test("a session that went away, and one that arrived, in the same collection", () => {
    // Churn is constant on this box: every one of the ten transitions in the
    // capture had something appear or disappear, so this is the ordinary case
    // rather than an alarm.
    const events = diffed(freshFixture("session-gone-before"), freshFixture("session-gone-after"));
    expect(kinds(events)).toEqual(["tmux-session-gone", "session-seen"]);

    const [gone, seen] = events;
    if (gone?.kind !== "tmux-session-gone") throw new Error("expected a gone event first");
    expect(gone.identity.tmuxId).toBe("$2225");
    expect(gone.why).toBe("absent-from-snapshot");
    expect(gone.name).not.toBe("");
    if (seen?.kind !== "session-seen") throw new Error("expected a seen event second");
    expect(seen.identity.tmuxId).toBe("$1644");
    // The whole row rides along, because `meta.dir` is the one field nothing
    // downstream can reconstruct.
    expect(seen.row.meta.version === 1 ? seen.row.meta.dir : null).not.toBeNull();
  });

  test("the other real pair, the other way round", () => {
    const events = diffed(freshFixture("session-new-before"), freshFixture("session-new-after"));
    expect(kinds(events)).toEqual(["tmux-session-gone", "session-seen"]);
    expect(events[0]?.identity.tmuxId).toBe("$1992");
    expect(events[1]?.identity.tmuxId).toBe("$2243");
  });

  test("two polls of the same collection produce nothing at all", () => {
    expect(diffed(freshFixture("duplicate-first"), freshFixture("duplicate-second"))).toEqual([]);
  });

  test("the five sessions present in both halves of a status change produce nothing", () => {
    // The steady case. Four of the six rows are untouched between these two
    // collections and none of them should be in the log.
    const events = diffed(freshFixture("status-change-before"), freshFixture("status-change-after"));
    expect(events.filter((e) => e.identity.tmuxId !== "$1991")).toEqual([]);
  });

  test("a cold start announces every row and closes nothing", () => {
    const events = diffed(null, freshFixture("status-change-before"));
    expect(kinds(events)).toEqual(Array(6).fill("session-seen"));
  });
});

/**
 * THE MEASUREMENT THIS MODULE EXISTS FOR: 51 status comparisons in the capture
 * differed in some field and 2 differed in anything meaningful, almost all of
 * the noise being `waiting.secondsLeft` counting down. The capture contains no
 * `waiting` session at all in its trimmed six-session rows, so the noise itself
 * has to be constructed — which is exactly the case that would have made the
 * event log useless.
 */
describe("the canonical transition key", () => {
  test("CONSTRUCTED: a countdown is not a transition", () => {
    // 900 → 826 across the 74.252 s between these two real clocks: the
    // countdown fell by as much as the clock advanced, which is what a wait
    // parked on one deadline does. The numbers used to be 900 → 840, which is
    // not a countdown at all — it is a deadline shoved 14 s later — and it
    // passed because nothing here looked at the deadline until S2-03.
    const before = edited("status-change-before", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "waiting", secondsLeft: 900 };
    });
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "waiting", secondsLeft: 826 };
    });
    // Structurally these two statuses differ. Meaningfully they do not: the
    // session has been parked on the same wait for the whole minute between
    // collections, and a log that says otherwise buries the events that matter
    // under one per waiting session per collection.
    expect(diffed(before, after)).toEqual([]);
  });

  test("CONSTRUCTED: leaving the wait IS a transition", () => {
    const before = edited("status-change-before", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "waiting", secondsLeft: 900 };
    });
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "needs-you" };
    });
    const events = diffed(before, after);
    expect(kinds(events)).toEqual(["session-status"]);
    if (events[0]?.kind !== "session-status") return;
    expect([events[0].from, events[0].to]).toEqual(["waiting", "needs-you"]);
  });

  test("statusKey drops the countdown and keeps everything a consumer acts on", () => {
    const waiting = (secondsLeft: number): SessionState => ({ kind: "waiting", secondsLeft });
    expect(statusKey(waiting(900))).toBe(statusKey(waiting(1)));

    // `busy` is in: it is the difference between a shell grinding through
    // `npm test` and one sitting at a prompt, and null is a third answer.
    const shell = (busy: boolean | null): SessionState => ({ kind: "shell", busy });
    expect(new Set([statusKey(shell(true)), statusKey(shell(false)), statusKey(shell(null))]).size).toBe(3);
  });

  test("CONSTRUCTED: `why` is our wording and is not in the key", () => {
    const cause = "agents-unavailable" as const;
    const a: SessionState = { kind: "unknown", cause, why: "the box could not say what Claude is doing" };
    const b: SessionState = { kind: "unknown", cause, why: "we could not ask the box" };
    expect(statusKey(a)).toBe(statusKey(b));
  });

  test("CONSTRUCTED: the reported status token IS in the key, and this is S1-1's answer", () => {
    // A future Claude Code reports `compacting` and then `waiting-for-input`.
    // Both are `unrecognised-agent-status`, so a key made of the cause alone
    // loses the intermediate state entirely — and unlike our reworded prose,
    // that token is the box's own observation and moves only when the box does.
    const unknown = (reportedStatus: string): SessionState => ({
      kind: "unknown",
      cause: "unrecognised-agent-status",
      why: `Claude Code calls this '${reportedStatus}', which this version does not know`,
      reportedStatus,
    });
    expect(statusKey(unknown("compacting"))).not.toBe(statusKey(unknown("waiting-for-input")));

    const before = edited("status-change-before", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = unknown("compacting") as unknown as JsonValue;
    });
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = unknown("waiting-for-input") as unknown as JsonValue;
    });
    expect(kinds(diffed(before, after))).toEqual(["session-status"]);
  });
});

/**
 * Identity is the pair, and the third of the four ways a session stops being
 * what it was. The capture has no resumed session, so this is constructed.
 */
describe("CONSTRUCTED: a tmux session resumed into a different conversation", () => {
  test("is one replacement, not a disappearance and an arrival", () => {
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["claudeSessionId"] = "00000000-1111-2222-3333-444444444444";
    });

    const events = diffed(before, after);
    expect(kinds(events)).toEqual(["session-replaced"]);
    const [event] = events;
    if (event?.kind !== "session-replaced") return;
    expect(event.identity.claimedConversationId).toBe("00000000-1111-2222-3333-444444444444");
    expect(event.previous.claimedConversationId).toBe(before.snapshot.rows[0]?.claimedConversationId);
    // Same handle, same name, same pane — everything a history keyed on the
    // handle would have used to decide these were one continuous agent.
    expect(event.identity.tmuxId).toBe(event.previous.tmuxId);
    expect(event.key).not.toBe(event.previousKey);
  });

  test("the key of a session with no conversation cannot collide with one that has an empty id", () => {
    const none = sessionKey({ tmuxId: "$7", claimedConversationId: null });
    const empty = sessionKey({ tmuxId: "$7", claimedConversationId: "" });
    expect(none).not.toBe(empty);
  });

  test("KNOWN BLIND SPOT: a replacement the tmux environment did not notice produces nothing", () => {
    // NOT an aspiration and not a bug to fix here. The uuid is pinned into the
    // tmux environment before Claude runs and is never rewritten, so a pane
    // whose Claude exited and restarted goes on reporting the FIRST
    // conversation — measured on the live box, 2026-09-08. This test pins the
    // asymmetry so nobody reads the silence of `session-replaced` as evidence
    // of continuity: only a transcript's mtime can settle that, and this stage
    // does no I/O.
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[0];
      // The conversation changed. The claim did not, because nothing updates it.
      if (row) row["status"] = { kind: "idle" };
    });
    expect(diffed(before, after)).toEqual([]);
  });
});

/**
 * THE GENERATION RULE. The capture is one tmux server throughout
 * (`tmuxServerPid: 132280`), so the case a reboot produces — the event this
 * whole stage exists to survive — has no real example and must be constructed.
 */
describe("CONSTRUCTED: a different tmux generation", () => {
  test("closes every session from the old world and starts the new one fresh", () => {
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      p["tmuxServerPid"] = 999_111;
    });

    const events = diffed(before, after);
    // Six closed, six opened. NOT one status change and five silences: the
    // handles match up perfectly and mean nothing, because `$1991` in a new
    // tmux server is a fresh allocation that happens to wear the same number.
    expect(kinds(events)).toEqual([...Array(6).fill("tmux-session-gone"), ...Array(6).fill("session-seen")]);
    expect(events.some((e) => e.kind === "session-replaced")).toBe(false);
    expect(events.some((e) => e.kind === "session-status")).toBe(false);

    for (const event of events.slice(0, 6)) {
      if (event.kind !== "tmux-session-gone") throw new Error("expected closures first");
      // The reason distinguishes "this session went away" from "the world did",
      // and the generation on the event is the world it belonged to.
      expect(event.why).toBe("tmux-server-changed");
      expect(event.tmuxServerPid).toBe(132280);
    }
    for (const event of events.slice(6)) expect(event.tmuxServerPid).toBe(999_111);
  });

  test("a generation nobody could read is not a change", () => {
    // A tmux busy enough to time out a listing is exactly the box this tooling
    // is for, so "I could not tell" must not close out the entire fleet at the
    // moment it is least true.
    expect(generationRelation(132280, null)).toBe("unverifiable");
    expect(generationRelation(null, 132280)).toBe("unverifiable");
    expect(generationRelation(null, null)).toBe("unverifiable");
    expect(generationRelation(132280, 132280)).toBe("same");
    expect(generationRelation(132280, 1)).toBe("changed");
  });

  /**
   * THIS TEST USED TO ASSERT THE OPPOSITE, and it passed for as long as it was
   * wrong. Its old name was "an unreadable generation diffs normally rather
   * than closing the fleet" and it pinned the unsafe default GPT Sol found as
   * S2-01: a snapshot whose world nobody could identify was compared to the
   * last one anyway, and the baseline moved on to it. Both halves of that were
   * wrong, and neither was visible in an event log. Changed deliberately,
   * 2026-09-08.
   *
   * The rule it was defending is still here and is still right — an unreadable
   * generation must NOT be read as a reboot and must not close the fleet. What
   * changed is what happens instead: nothing is recorded, nothing is compared,
   * and the baseline stays where it was.
   */
  test("S2-01: an unreadable generation neither closes the fleet nor is diffed — THIS TEST ASSERTED THE OPPOSITE UNTIL 2026-09-08", () => {
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      p["tmuxServerPid"] = null;
    });
    const outcome = diff(mustBaseline(before), after);
    expect(outcome.kind).toBe("held");
    if (outcome.kind !== "held") return;
    expect(outcome.why).toBe("generation-unreadable");
    // The sentence is the whole point of holding rather than dropping: S3 has
    // to be able to write down that the history stopped, and why.
    expect(outcome.reason).toContain("no tmux generation");
    expect(outcome.reason).toContain(after.snapshot.clock.at);
  });

  test("S2-01: an EMPTY fleet with an unreadable generation is still diffed, because there is nothing to equate", () => {
    const before = freshFixture("status-change-before");
    const drained = edited("status-change-after", (p) => {
      p["tmuxServerPid"] = null;
      p["rows"] = [];
    });
    const outcome = diff(mustBaseline(before), drained);
    expect(outcome.kind).toBe("diffed");
    // Six sessions were there and are not. That is evidence, and refusing it
    // would be refusing the truth at the moment it is most interesting.
    expect(kinds(diffed(before, drained))).toEqual(Array(6).fill("tmux-session-gone"));
  });

  test("S2-01: baselineOf refuses exactly what diff() holds, so a held snapshot cannot be promoted", () => {
    // THE HOLE THE SECOND MINT SITE COULD HAVE REOPENED. A caller holding the
    // snapshot `diff()` just held could otherwise call `baselineOf(b)` and
    // advance anyway — one function call instead of one assignment is not a
    // boundary. It returns null because the predicate is about the VALUE (rows
    // with no readable generation), not about where the value came from.
    const unplaceable = edited("status-change-after", (p) => {
      p["tmuxServerPid"] = null;
    });
    const refused = baselineOf(unplaceable);
    expect(refused.ok).toBe(false);
    // A HOLD IS NOT SILENCE, and neither is this. The daemon has to be able to
    // write down why last night's snapshot would not stand as this morning's
    // world; a bare null gave it nothing to say.
    if (refused.ok) return;
    expect(refused.reason).toContain("6 sessions");
    expect(refused.reason).toContain("no tmux generation");

    // And the same snapshot is what `diff()` holds — one predicate, two
    // callers, checked here so they cannot drift into two.
    expect(diff(mustBaseline(freshFixture("status-change-before")), unplaceable).kind).toBe("held");

    // The exemption travels with it: an empty fleet is placeable either way.
    const drained = edited("status-change-after", (p) => {
      p["tmuxServerPid"] = null;
      p["rows"] = [];
    });
    expect(baselineOf(drained).ok).toBe(true);
  });

  test("S2-01: a baseline mutated after minting crashes rather than bridging two tmux worlds", () => {
    // SOL'S ROUND-THREE EXAMPLE, and the honest answer to it. The box is
    // nominal, not immutable: `readonly` is compile-time, so `Object.assign`
    // onto the live snapshot the accessor hands back does compile. Nothing in
    // this codebase does that — a grep is the check — but the type's guarantee
    // is made at MINT and JavaScript cannot hold a value still afterwards, so
    // the use site asks once.
    //
    // What it buys: this exact sequence used to be a silently bridged reboot,
    // the P0's own failure, reached by mutation instead of by assignment. It is
    // now a crash, which is the direction the bar asks for.
    const baseline = mustBaseline(freshFixture("status-change-before"));
    Object.assign(baseline.snapshot, { tmuxServerPid: null });
    expect(() => diff(baseline, freshFixture("status-change-after"))).toThrow(/mutated after minting/);
  });

  test("S2-01: a baseline recovered after a restart closes what ended while the daemon was down", () => {
    // WHY THE SECOND MINT SITE EXISTS. S4 persists the producer's own bytes and
    // re-blesses them on restart, so the recovered snapshot never came out of a
    // diff. Without `baselineOf` the daemon would have to resume with
    // `diff(null, …)`, which announces every session on the box as newly seen —
    // a history in which the fleet appears out of nothing at every restart.
    const restored = mustBaseline(freshFixture("session-gone-before"));
    const outcome = diff(restored, freshFixture("session-gone-after"));
    expect(outcome.kind).toBe("diffed");
    if (outcome.kind !== "diffed") return;
    // One session ended and one began — not six arrivals.
    expect(kinds(outcome.events)).toEqual(["tmux-session-gone", "session-seen"]);
  });

  test("S2-01: 100 → null → 200 reads as a reboot rather than as one continuous world", () => {
    // THE SEQUENCE THE P0 IS ABOUT. tmux restarts during the middle collection
    // and the generation cannot be read; the handles in it are fresh
    // allocations wearing the old numbers. Diffing the middle one — which is
    // what this module used to do — attributes $1991's status change across a
    // reboot and then advances the baseline, so by the time a readable
    // generation arrives there is nothing left to notice.
    const a = freshFixture("status-change-before");
    const b = edited("status-change-after", (p) => {
      p["tmuxServerPid"] = null;
    });
    const c = edited("session-new-after", (p) => {
      p["tmuxServerPid"] = 999111;
    });

    // The daemon's loop, as S3 writes it: the baseline moves only on a
    // `diffed`, and the compiler is what stops it moving on a `held` — `b` is
    // an `AdmissibleSnapshot` and this variable is a `Baseline`, so the
    // assignment that used to compile is now the error this describes.
    let baseline = mustBaseline(a);
    const events: SessionEvent[] = [];
    const holds: string[] = [];
    for (const next of [b, c]) {
      const outcome = diff(baseline, next);
      if (outcome.kind === "diffed") {
        events.push(...outcome.events);
        baseline = outcome.baseline;
      } else {
        holds.push(outcome.why);
      }
    }

    expect(holds).toEqual(["generation-unreadable"]);
    // The reboot is found against the LAST KNOWN WORLD rather than against the
    // one nobody could read: six sessions from generation 132280 closed, and
    // the new world's rows announced.
    expect(kinds(events)).toEqual([...Array(6).fill("tmux-session-gone"), ...Array(6).fill("session-seen")]);
    for (const event of events.slice(0, 6)) {
      if (event.kind !== "tmux-session-gone") throw new Error("expected closures first");
      expect(event.why).toBe("tmux-server-changed");
      expect(event.tmuxServerPid).toBe(132280);
    }
    // And nothing is attributed across the boundary — the fabricated history
    // this rule exists to prevent.
    expect(events.some((e) => e.kind === "session-status")).toBe(false);
    expect(events.some((e) => e.kind === "session-replaced")).toBe(false);
  });
});

/**
 * S2-03: a wait that was RESTARTED between two collections, which the canonical
 * key cannot see because every wait keys as `waiting`.
 *
 * The tolerance this rests on is an empirical claim about the producer, so the
 * first test here is a MEASUREMENT of the real `waiting-{first,second}` pair
 * rather than an assertion about our own code. The rest are constructed on top
 * of that real envelope.
 */
describe("a wait, and the deadline that tells a restarted one from a countdown", () => {
  test("REAL: the implied deadline does not move, even across a missed collection", () => {
    // THIS IS THE MEASUREMENT THE BOUND IS SHAPED BY, and it is here rather
    // than only in a comment because it is a claim about somebody else's code.
    // If the producer ever starts sampling `secondsLeft` independently of the
    // deadline it derives it from, this goes red and `waitDeadlineToleranceMs`
    // is wrong rather than merely stale.
    //
    // These two collections are 129.9 s apart — a collection was missed between
    // them, twice the ordinary 65 s cadence — and that is why this pair was
    // captured rather than a consecutive one: the tempting reasoning is that
    // the tolerance must cover the interval, and the interval doubling here
    // moves the deadline by nothing at all, because both halves of the sum move
    // together.
    const first = freshFixture("waiting-first");
    const second = freshFixture("waiting-second");
    expect(second.snapshot.clock.atMs - first.snapshot.clock.atMs).toBe(129_937);

    const deadlines = (s: typeof first): Map<string, number> =>
      new Map(
        s.snapshot.rows
          .filter((r) => r.status.kind === "waiting")
          .map((r) => [
            r.id,
            s.snapshot.clock.atMs + (r.status.kind === "waiting" ? r.status.secondsLeft : 0) * 1000,
          ]),
      );
    const before = deadlines(first);
    const after = deadlines(second);
    expect(before.size).toBe(3);
    for (const [id, deadline] of before) {
      // Whole-second countdowns, so the residue is sub-second rounding.
      expect(Math.abs((after.get(id) ?? 0) - deadline)).toBeLessThan(1000);
    }
  });

  test("REAL: three sessions counting down across a missed collection produce nothing at all", () => {
    // The noise case, at last with real data. Every one of the three waits has
    // a different `secondsLeft` in the two snapshots, and a differ comparing
    // status objects structurally writes three events here.
    expect(diffed(freshFixture("waiting-first"), freshFixture("waiting-second"))).toEqual([]);
  });
});

/**
 * The restart itself, constructed — on the REAL waiting pair above, so only the
 * one countdown under test is synthetic and the 129.937 s between the two
 * clocks is the real thing.
 *
 * `$2082` is the first row of both files and is `waiting` in both, so replacing
 * its `secondsLeft` leaves the other two waits counting down honestly beside
 * it. Their silence is part of every assertion here.
 */
describe("CONSTRUCTED: a wait that was replaced by a longer one", () => {
  /** The gap between the two real collections. Every number below is derived from it. */
  const GAP_MS = 129_937;

  function waits(beforeSeconds: number, afterSeconds: number): SessionEvent[] {
    const before = edited("waiting-first", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "waiting", secondsLeft: beforeSeconds };
    });
    const after = edited("waiting-second", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "waiting", secondsLeft: afterSeconds };
    });
    return diffed(before, after);
  }

  test("S2-03: 60 → 3600 is a new wait and says so", () => {
    // Sol's sequence. The first wait ended and an hour-long one began, and
    // until 2026-09-08 the history showed one uninterrupted wait, because both
    // statuses key as `waiting`.
    const events = waits(60, 3600);
    expect(kinds(events)).toEqual(["session-wait-restarted"]);
    const [event] = events;
    if (event?.kind !== "session-wait-restarted") return;
    expect(event.identity.tmuxId).toBe("$2082");
    expect(Date.parse(event.deadline) - Date.parse(event.previousDeadline)).toBeGreaterThan(
      waitDeadlineToleranceMs(freshFixture("waiting-second").snapshot.tookMs),
    );
    // The status rides along so the log can say how long the new wait is.
    expect(event.status).toEqual({ kind: "waiting", secondsLeft: 3600 });
  });

  test("S2-03: a deadline that moved fifteen seconds is a restart, and this is what pins the tolerance", () => {
    // THE TEST THAT KILLS THE OBVIOUS WRONG CONSTANT. Everything else in this
    // block passes just as well with a two-minute tolerance, because the gap
    // between these two real collections is 130 s and every restart
    // constructed above moves the deadline by minutes. This one moves it by
    // 14.9 s — a wait counted down 115 s while 130 s of clock passed — which a
    // tolerance sized for collection jitter would call jitter and this one
    // calls what it is.
    //
    // Found by mutation: replacing 10 s with 120 s left the whole suite green
    // until this case existed, and the bound is no longer a constant at all.
    const after = freshFixture("waiting-second");
    expect(waitDeadlineToleranceMs(after.snapshot.tookMs)).toBeLessThan(30_000);
    const events = waits(900, 785);
    expect(kinds(events)).toEqual(["session-wait-restarted"]);
    const [event] = events;
    if (event?.kind !== "session-wait-restarted") return;
    const moved = Date.parse(event.deadline) - Date.parse(event.previousDeadline);
    expect(moved).toBeGreaterThan(waitDeadlineToleranceMs(after.snapshot.tookMs));
    expect(moved).toBeLessThan(15_000);
  });

  test("S2-03: an ordinary countdown is silent", () => {
    // A countdown consistent with the interval: the deadline does not move, so
    // there is nothing to say. This is what the real rows either side of it do.
    expect(waits(900, 900 - Math.round(GAP_MS / 1000))).toEqual([]);
  });

  test("S2-03: a countdown that did NOT advance is a restart, not jitter", () => {
    // The same `secondsLeft` twice across 130 s means the deadline moved 130 s
    // later, and under this producer that only happens if the wait was re-armed
    // — measured, not assumed: five consecutive collections held three implied
    // deadlines still to within a second, one of those intervals being this
    // doubled one. An earlier draft of this test asserted the opposite, on the
    // wrong theory that collection jitter moves the deadline. It does not: both
    // halves of the sum move together.
    expect(kinds(waits(900, 900))).toEqual(["session-wait-restarted"]);
  });

  test("S2-03: a wait shortened by hand stays silent, because a deadline that comes closer is not a new wait", () => {
    expect(waits(3600, 60)).toEqual([]);
  });

  test("S2-03: a drift just past the collection's own duration is still rounding, not a restart", () => {
    // The second term of the bound, isolated. This pair's later collection took
    // 3.820 s and the drift here is 3.937 s — outside the sampling window and
    // inside whole-second rounding, which is real: `secondsLeft` is an integer,
    // so each implied deadline is already up to a second off the true one.
    // Without `WAIT_DEADLINE_ROUNDING_MS` this row would be reported as a wait
    // that restarted, on the strength of a rounding error.
    const after = freshFixture("waiting-second");
    expect(after.snapshot.tookMs).toBe(3_820);
    const driftMs = GAP_MS - (900 - 775) * 1000;
    expect(driftMs).toBeGreaterThan(after.snapshot.tookMs);
    expect(driftMs).toBeLessThan(waitDeadlineToleranceMs(after.snapshot.tookMs));
    expect(waits(900, 775)).toEqual([]);
  });

  test("S2-03: a SLOW COLLECTION does not manufacture a restart, and this is why the bound is not a constant", () => {
    // Sol's second sequence. The countdown is read off the pane early in a
    // collection and `collectedAt` is stamped when that collection ends, so the
    // implied deadline carries however long the collection took. A 4 s
    // collection followed by a 20 s one moves it ~16 s later with no wait
    // having changed at all — and a fixed 10 s tolerance, sized off a capture
    // whose collections all took 3.8 s, calls that a restarted wait.
    //
    // `tookMs` is IN BOTH SNAPSHOTS, so the uncertainty does not have to be
    // guessed: it is bounded by how long the later collection ran.
    const before = edited("waiting-first", (p) => {
      p["tookMs"] = 4_000;
      const row = rowsOf(p)[0];
      if (row) row["status"] = { kind: "waiting", secondsLeft: 900 };
    });
    const after = edited("waiting-second", (p) => {
      p["tookMs"] = 20_000;
      const row = rowsOf(p)[0];
      // A countdown consistent with the 129.937 s between the two clocks: the
      // wait did not move. Only the sampling did.
      if (row) row["status"] = { kind: "waiting", secondsLeft: 900 - 130 + 16 };
    });
    expect(diffed(before, after)).toEqual([]);
  });

  test("S2-03: the boundary is exactly where the tolerance says it is", () => {
    // Derived from the constant rather than hard-coded, so changing the
    // tolerance moves this test's boundary with it instead of leaving it
    // quietly checking a number that used to matter.
    const before = freshFixture("waiting-first");
    const after = freshFixture("waiting-second");
    const gapMs = after.snapshot.clock.atMs - before.snapshot.clock.atMs;
    expect(gapMs).toBe(GAP_MS);
    // The largest countdown that still keeps the deadline inside the bound —
    // and the bound comes off the LATER collection's own `tookMs`, so this
    // moves with the fixture rather than with a constant somebody chose.
    const tolerance = waitDeadlineToleranceMs(after.snapshot.tookMs);
    const stillWithin = 900 - Math.ceil((gapMs - tolerance) / 1000);
    expect(waits(900, stillWithin)).toEqual([]);
    expect(kinds(waits(900, stillWithin + 1))).toEqual(["session-wait-restarted"]);
  });
});

/**
 * THE ROW MATERIAL, WHICH THE REGISTER FROZE AT FIRST SIGHT — GPT Sol's S3-03,
 * widened past the field it was reported on.
 *
 * `POST /api/sessions/rename` landed on 2026-09-08, so a name can now change
 * without the identity moving. `name` is not alone in that position: `entryOf()`
 * in store.ts copies seven fields off the row and `session-seen` fires once, so
 * every one of them was stuck at whatever the session looked like the first time
 * the Overseer saw it — which is the answer a reboot recovery would hand back.
 *
 * The capture has no rename in it — the endpoint did not exist when it was taken
 * — so all of these are CONSTRUCTED from real rows.
 *
 * WHY THE FIELDS SPLIT THE WAY THEY DO is in `REGISTER_ROW_FIELDS` and in
 * `session-pane-replaced`; the short version is that a pane being respawned is a
 * different fact from a session being renamed, and `title` and `question` move
 * on their own and are not register material.
 */
describe("CONSTRUCTED: the row material changing under a stable identity", () => {
  test("a rename is an event", () => {
    const before = freshFixture("status-change-before");
    // Row 1, not row 0: row 0 is the pair's real status change, and a test that
    // renamed it would be asserting about two events at once.
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[1];
      if (row) row["name"] = "renamed-by-a-person";
    });

    const events = elsewhere(diffed(before, after));
    expect(kinds(events)).toEqual(["session-row-changed"]);
    const [event] = events;
    if (event?.kind !== "session-row-changed") throw new Error(`expected a row change, got ${event?.kind}`);
    expect(event.fields).toEqual(["name"]);
    expect(event.row.name).toBe("renamed-by-a-person");
    expect(event.at).toBe(after.snapshot.clock.at);
    expect(event.tmuxServerPid).toBe(132280);
  });

  test("every field the register keeps is watched, not only the one that was reported", () => {
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[1];
      if (!row) throw new Error("expected a second row");
      // NAMED FOR WHAT IT IS — a `worktree` string that differs between two
      // snapshots — and not for a story about how it got that way. It used to
      // say `moved-by-enterworktree`, which is a claim this data source cannot
      // make: `worktree` and `meta.dir` come off tmux session environment
      // variables fixed at session creation, and `EnterWorktree` moves the
      // TRANSCRIPT, a different file that is not in this payload at all
      // (observation.ts, `meta.dir`). The mistake came in from the brief and
      // reached the plan doc as well; corrected 2026-09-08.
      row["worktree"] = "a-worktree-that-differs";
      row["meta"] = { version: 1, kind: "claude", repo: "spideryarn/other", dir: "/somewhere/else" };
      row["repo"] = "spideryarn/other";
    });

    const [event] = elsewhere(diffed(before, after));
    if (event?.kind !== "session-row-changed") throw new Error(`expected a row change, got ${event?.kind}`);
    // In the order `REGISTER_ROW_FIELDS` declares them, so the log reads the
    // same way twice and a test can compare it without sorting.
    expect(event.fields).toEqual(["repo", "worktree", "meta"]);
  });

  /**
   * ONE MEMBER OF `meta` AT A TIME, BECAUSE THE MUTATION EVIDENCE WAS WRONG.
   *
   * The stage claimed "19 mutations, 19 caught". For `sameMeta` that was an
   * overstatement, and it is the shape worth remembering rather than the
   * incident: the only constructed metadata transition moved `meta.repo` and
   * `meta.dir` TOGETHER and left `kind` alone, so deleting any one of the three
   * comparisons still passed — whichever other member had also changed reported
   * `meta` as moved regardless. **A test that changes several members at once
   * cannot distinguish an AND of three comparisons from an AND of two**, so the
   * suite was covering `sameMeta` as a unit and not as three.
   *
   * **REPRODUCED RATHER THAN ASSERTED**, because the point of the finding is
   * that the evidence was wrong and replacing it with more unchecked evidence
   * would be worse. Each of the three comparisons deleted in turn, with only the
   * combined test above selected: `1 passed | 47 skipped` all three times — all
   * three survived. With these, each deletion is caught by exactly the test that
   * names the member it removed, which is the property the old run only appeared
   * to have.
   *
   * Each of these therefore moves exactly one member and asserts the whole
   * `fields` list, so it fails both ways: silence if the comparison is deleted,
   * and a wider list if something else starts firing.
   */
  describe("CONSTRUCTED: the launcher metadata, one member at a time", () => {
    /** Row 1's `meta`, with one member replaced and the rest as captured. */
    function metaMoved(member: "kind" | "repo" | "dir", value: string): AdmissibleSnapshot {
      return edited("status-change-after", (p) => {
        const row = rowsOf(p)[1];
        if (!row) throw new Error("expected a second row");
        const meta = row["meta"] as Record<string, JsonValue>;
        if (meta["version"] !== 1) throw new Error("expected a version-1 meta in the fixture");
        row["meta"] = { ...meta, [member]: value };
      });
    }

    function fieldsFor(after: AdmissibleSnapshot): readonly string[] {
      const [event] = elsewhere(diffed(freshFixture("status-change-before"), after));
      if (event?.kind !== "session-row-changed") throw new Error(`expected a row change, got ${event?.kind}`);
      return event.fields;
    }

    test("kind alone", () => {
      // `shell` rather than `claude`: the launcher says what it started, and a
      // register that thought a shell was an agent would offer to resume it.
      expect(fieldsFor(metaMoved("kind", "shell"))).toEqual(["meta"]);
    });

    test("repo alone", () => {
      // `meta.repo`, NOT the row's own `repo` field — they are two different
      // members of the register and only one of them is inside `sameMeta`.
      expect(fieldsFor(metaMoved("repo", "spideryarn/hellozenno"))).toEqual(["meta"]);
    });

    test("dir alone", () => {
      // Absolute, because `parseMeta` refuses anything else; a relative one
      // would be refused as a payload rather than reported as a change.
      expect(fieldsFor(metaMoved("dir", "/home/greg/code/somewhere-else"))).toEqual(["meta"]);
    });
  });

  test("startedAt is watched even though it should never move", () => {
    // ADDED AFTER A MUTATION SURVIVED: making `rowFieldMoved("startedAt")`
    // return `false` passed the whole suite, because every other test here edits
    // some other field. A field nothing exercises is a field that is not really
    // watched.
    //
    // It should never fire — tmux's `session_created` does not change while the
    // session lives, and 25 collections of the live fleet agree — but if it does,
    // the row is not the session we thought it was, and silence would be the
    // worse outcome.
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[1];
      if (row) row["startedAt"] = "2026-09-08T00:00:00.000Z";
    });
    const [event] = elsewhere(diffed(before, after));
    if (event?.kind !== "session-row-changed") throw new Error(`expected a row change, got ${event?.kind}`);
    expect(event.fields).toEqual(["startedAt"]);
  });

  test("the volatile fields the register does not keep are NOT in it", () => {
    // `title` and `question` move on their own — a question appeared and
    // disappeared once in 24 minutes of the live fleet — and neither is
    // reboot-resume material. An arm that fired on any row difference is the
    // 52k-rows-a-day design this whole module refused.
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[1];
      if (!row) throw new Error("expected a second row");
      row["title"] = "a title adoptTitles just wrote";
      row["question"] = { asked: "anything at all" };
    });
    expect(elsewhere(diffed(before, after))).toEqual([]);
  });

  test("a rename and a status change in one collection are two events, not one", () => {
    // The status arm `continue`s past everything below it, so a session renamed
    // WHILE it changed state would have had the rename swallowed if the row
    // check had been put underneath.
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[0];
      if (row) row["name"] = "renamed-while-it-started-working";
    });

    const events = diffed(before, after);
    expect(kinds(events)).toEqual(["session-row-changed", "session-status"]);
    expect(events.every((e) => e.identity.tmuxId === "$1991")).toBe(true);
  });

  test("a replaced conversation is NOT also a row change", () => {
    // `session-replaced` already carries the whole new row and the fold rebuilds
    // the entry from it. Two events for one thing would double-count the log and
    // say the register had been repaired when it had been replaced.
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[1];
      if (!row) throw new Error("expected a second row");
      row["claudeSessionId"] = "00000000-1111-2222-3333-444444444444";
      row["name"] = "and-renamed-too";
    });
    expect(kinds(elsewhere(diffed(before, after)))).toEqual(["session-replaced"]);
  });

  test("a new tmux generation announces sessions rather than renaming them", () => {
    // The generation rule owns the whole comparison: across it every handle is a
    // fresh allocation, so there is no identity under which a name was kept.
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      p["tmuxServerPid"] = 999_111;
      const row = rowsOf(p)[1];
      if (row) row["name"] = "renamed-in-a-world-that-did-not-exist-before";
    });
    expect(diffed(before, after).some((e) => e.kind === "session-row-changed")).toBe(false);
  });
});

/**
 * THE PANE, WHICH IS NOT A LABEL.
 *
 * `panePid` is the field `tools/fleet/steer.ts` compares before it types, so a
 * changed one means the pane somebody was looking at has been replaced by
 * another wearing the same handle. That is a fact about the world rather than
 * drift in a name, and folding it into the rename arm would put a `name` field
 * on an event that is really about a pane.
 *
 * A NULL IS NOT A CHANGE, IN EITHER DIRECTION, and that is the whole hazard
 * here: `paneId` and `panePid` come from a SEPARATE pane listing joined to the
 * session by handle (`tools/fleet/collect.ts`), so a join miss yields null on a
 * session that is perfectly alive. The arm therefore fires only on
 * non-null → non-null → differing.
 *
 * **THE SECOND HALF OF THAT RULE WAS BOUGHT WITH A FALSE EVENT AND A WRONG
 * TEST.** An earlier version emitted on `null → pid`, justified here as *"the
 * register needs it"* — which is true when the register has never had the pane
 * and false in exactly the case it mattered, because in a flap the register
 * already holds that pid. Two snapshots cannot tell "learned" from "recovered",
 * so the test that encoded the justification also encoded the bug, and it took
 * a three-collection test to show it. The cost is a real uncovered case and it
 * has a test of its own below rather than a sentence.
 */
describe("CONSTRUCTED: a pane respawned under a live session", () => {
  test("a new pid under the same handle is its own event", () => {
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[1];
      if (!row) throw new Error("expected a second row");
      row["paneId"] = "%9999";
      row["panePid"] = 424242;
    });

    const events = elsewhere(diffed(before, after));
    expect(kinds(events)).toEqual(["session-pane-replaced"]);
    const [event] = events;
    if (event?.kind !== "session-pane-replaced") throw new Error("expected a pane event");
    expect(event.panePid).toBe(424242);
    expect(event.paneId).toBe("%9999");
    expect(event.previousPanePid).not.toBe(424242);
  });

  test("a pane listing that could not be joined is silence, not a respawn", () => {
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[1];
      if (!row) throw new Error("expected a second row");
      row["paneId"] = null;
      row["panePid"] = null;
    });
    expect(elsewhere(diffed(before, after))).toEqual([]);
  });

  test("A PANE THAT WENT MISSING AND CAME BACK IS NOT A REPLACEMENT — the same pid, three collections", () => {
    // THE CASE TWO SNAPSHOTS CANNOT SHOW, which is why this one runs three.
    // Found independently by two cross-family reviews, 2026-09-08; the second
    // printed `original panePid: 645023 / miss: no events / recovery:
    // session-pane-replaced, null → 645023`.
    //
    // Nothing was replaced. $1643 sat on pane pid 645023 throughout and the
    // middle collection simply failed to join a pane onto it. The event is not
    // noise, it is FALSE, and it goes into a permanent history — once every two
    // collections, per session, for as long as the listing is under load.
    const first = freshFixture("status-change-before");
    const missed = edited("status-change-after", (p) => {
      const row = rowsOf(p)[1];
      if (!row) throw new Error("expected a second row");
      row["paneId"] = null;
      row["panePid"] = null;
    });
    const recovered = freshFixture("status-change-after");

    const [, duringMiss, afterRecovery] = chained([first, missed, recovered]);
    // The miss itself was already silent; that direction was never the bug.
    expect(kinds(elsewhere(duringMiss ?? []))).toEqual([]);
    // And the recovery: nothing at all, on ANY row — `missed` and `recovered`
    // are the same collection but for that one pane, so an unfiltered assertion
    // is available here and is the stronger one.
    expect(kinds(afterRecovery ?? [])).toEqual([]);
  });

  test("KNOWN UNCOVERED: a pane first seen as a miss is never learned afterwards", () => {
    // THE COST OF THE RULE ABOVE, asserted rather than described, so that the
    // day somebody decides to buy the learn case back this test goes red and
    // tells them where the decision was made.
    //
    // `null → 645023` is silence, so a session whose FIRST observation had a
    // join miss keeps `panePid: null` in the register until the daemon restarts
    // (a cold start rebuilds every entry from the row) or tmux does. Nothing in
    // between can fill it in.
    //
    // Why that is the side to be wrong on: a null pane pid is honest — *we do
    // not know* — where a wrong one is an address `tools/fleet/steer.ts` types
    // keystrokes into, and the thing wearing that pid may be whatever now
    // occupies the slot. And the measured join-miss rate is 0 of 551 row
    // observations over 24 minutes of the live fleet, so the gap is real but
    // rare. `session-pane-replaced` in diff.ts carries the argument and names
    // the upstream repair that removes the trade-off entirely.
    const before = edited("status-change-before", (p) => {
      const row = rowsOf(p)[1];
      if (!row) throw new Error("expected a second row");
      row["paneId"] = null;
      row["panePid"] = null;
    });
    const after = freshFixture("status-change-after");

    expect(elsewhere(diffed(before, after))).toEqual([]);
  });

  test("a rename and a respawn in one collection are two events", () => {
    const before = freshFixture("status-change-before");
    const after = edited("status-change-after", (p) => {
      const row = rowsOf(p)[1];
      if (!row) throw new Error("expected a second row");
      row["name"] = "renamed";
      row["panePid"] = 424242;
    });
    expect(kinds(elsewhere(diffed(before, after)))).toEqual(["session-row-changed", "session-pane-replaced"]);
  });
});
