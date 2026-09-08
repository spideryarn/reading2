/**
 * The rule protocol, rule 2 riding on it, and the two things about it that
 * would be silent if they broke.
 *
 * **The two are not the same shape and neither is "does it work".**
 *
 *  1. **Append before act.** A rule that took an action and then failed to write
 *     it down has done something nobody can review, which is the gate-1 failure
 *     the ordering exists to prevent (GPT Sol's SP-2). A test that watches a
 *     successful run in order proves nothing about that: the assertion has to be
 *     that the actor is **not called** when the intent append fails, and the
 *     store here is one that refuses on demand.
 *  2. **Round trip, not append.** Adding an event kind touches six places and
 *     the sixth is a runtime parser that nothing forces you to write
 *     (SP-9). A rule event with no parse branch appends perfectly and comes
 *     back on the next read as *"kind … is not an event this version knows"* —
 *     so every event assertion below reads the bytes back through a SECOND
 *     store rather than trusting the `ok` the append returned.
 *
 * The clock is injected everywhere, and nothing here reaches the network: the
 * observer is a function the test supplies, which is the seam that exists so
 * this file does not need a dashboard.
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import type { OverseerEvent } from "../tools/overseer/diff.js";
import { definitionHash, type AuthorisedJob, type JobDefinition, type RuleJobDefinition } from "../tools/overseer/jobs.js";
import {
  AUTHORISED_RULE_HASHES,
  LAUNCH_MODE_SPEC,
  RULE_SOURCES,
  WEDGED_WORK_MIN_AGE_SECONDS,
  WEDGED_WORK_SPEC,
  describeRuleJobs,
  ruleJobs,
} from "../tools/overseer/rule-jobs.js";
import {
  RULES_ENABLED_VAR,
  fleetObserver,
  fleetStateObserver,
  ruleWork,
  rulesEnabled,
  type HttpGet,
  type HttpPost,
} from "../tools/overseer/rule-work.js";
import {
  PROPOSAL_MAX_PROCESSES,
  RULE_SPEC_HASHED_FIELDS,
  canonicalRuleSpec,
  decideRule,
  describeRuleOutcome,
  type ObservedSession,
  type RuleObservation,
  type RuleOutcome,
  type RuleSpec,
  type WedgedProcess,
} from "../tools/overseer/rules.js";
import type { ActingRuleWork, ProposingRuleWork } from "../tools/overseer/rule-protocol.js";
import { schedulerTick, type OccurrenceLog, type SchedulerReport } from "../tools/overseer/scheduler.js";
import { EVENTS_FILE, openStore, type AppendResult, type OverseerStore } from "../tools/overseer/store.js";
import { SPECIMEN_SESSION, listingVerdict } from "../scripts/overseer-launch-mode-specimen.js";
import { schedulerWiring } from "../scripts/overseer.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const opened: OverseerStore[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-rules-test-"));
  roots.push(root);
  return root;
}

function fakeClock(startIso: string): { now: () => Date; advance(ms: number): void } {
  let ms = Date.parse(startIso);
  return { now: () => new Date(ms), advance: (by) => (ms += by) };
}

function mustOpen(root: string, now: () => Date): OverseerStore {
  const result = openStore({ root, now });
  if (!result.ok) throw new Error(`the store would not open: ${JSON.stringify(result.refusal)}`);
  opened.push(result.store);
  return result.store;
}

/**
 * **THE ROUND TRIP.** Close the store and open a second one over the same
 * bytes, which is what a restart does — so an event that appended and cannot be
 * parsed shows up here as an opening that lost its history rather than as a
 * green test.
 */
function reopen(root: string, now: () => Date): OverseerStore {
  for (const store of opened.splice(0)) store.close();
  return mustOpen(root, now);
}

/** The raw lines, for the one assertion that is about what is ON the disk rather than what comes back off it. */
function rawKinds(root: string): string[] {
  const path = join(root, EVENTS_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => (JSON.parse(line) as { kind: string }).kind);
}

const SPEC: RuleSpec = { kind: "wedged-work", minAgeSeconds: 4 * 3600, policy: "safe-to-kill", disposition: "propose" };

/** The live specimen, as the dashboard's dry run actually described it on 2026-09-08. Copied rather than invented, so the shape under test is the shape that exists. */
const SPECIMEN: WedgedProcess = {
  pid: 2282035,
  rule: "cwd-deleted",
  why: "pid 2282035 is running in a directory that has been deleted: /home/greg/code/spideryarn2/.claude/worktrees/glossary-order-touch (deleted)",
  comm: "npm exec playwr",
  args: "npm exec playwright@1.62.1 install webkit",
  rssKiB: 2900,
  etimeSeconds: 70477,
};

const YOUNG: WedgedProcess = { ...SPECIMEN, pid: 999_001, etimeSeconds: 60 };

function ruleJob(spec: RuleSpec = SPEC, everyMs = 60_000): AuthorisedJob {
  const definition: RuleJobDefinition = {
    id: "wedged-work",
    everyMs,
    leaseMs: 120_000,
    what: "propose kills for wedged work",
    documents: [],
    work: { kind: "rule", rule: spec },
  };
  return { definition, authorisedHash: definitionHash(definition) };
}

/**
 * An ACTING capability whose observation the test decides, and which records
 * whether the actor was reached.
 *
 * The shipped daemon holds nothing like this — `schedulerWiring` supplies only
 * the proposing half, which has no `act` on it at all (SC-2). Every test below
 * that reaches an actor has to construct one here, which is the point: the
 * capability is a thing a caller must go and build.
 */
function ruleWorkStub(observation: RuleObservation, outcome: RuleOutcome = { kind: "sent", what: "it was done" }): {
  work: ActingRuleWork;
  acted: string[];
} {
  const acted: string[] = [];
  return {
    acted,
    work: {
      selfPid: 4242,
      observe: async () => observation,
      act: async (_spec: RuleSpec, what: string) => {
        acted.push(what);
        return outcome;
      },
    },
  };
}

/** Let the rule's own promise chain run. The whole protocol after `observe` is microtasks, not timers. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

describe("rule 2 as arithmetic, with no I/O anywhere near it", () => {
  test("the live specimen is proposed, and the sentence says kill, the named rule, and needs confirm", () => {
    // THE ACCEPTANCE SENTENCE for this stage, asserted on the pure function so
    // that the wording cannot drift without something going red.
    const decision = decideRule(SPEC, { kind: "wedged", candidates: [SPECIMEN, YOUNG], scanned: 750 });
    expect(decision.kind).toBe("propose");
    if (decision.kind !== "propose") return;
    expect(decision.what).toContain("kill");
    expect(decision.what).toContain("cwd-deleted");
    expect(decision.what).toContain("needs confirm");
    expect(decision.what).toContain(String(SPECIMEN.pid));
    // The denominators, so a later reader can check the arithmetic rather than
    // take the conclusion. Narrowed rather than cast: with two rules, a finding
    // of the wrong kind here would be a real defect and the compiler is what
    // says so.
    const finding = decision.finding;
    if (finding.kind !== "wedged-work") throw new Error("expected a wedged-work finding");
    expect(finding.matched).toBe(1);
    expect(finding.candidates).toBe(2);
    expect(finding.scanned).toBe(750);
    expect(finding.processes.map((p) => p.pid)).toEqual([SPECIMEN.pid]);
  });

  test("THE THRESHOLD IS THE THRESHOLD: a candidate one second under it is not proposed", () => {
    const just = { ...SPECIMEN, etimeSeconds: SPEC.minAgeSeconds - 1 };
    expect(decideRule(SPEC, { kind: "wedged", candidates: [just], scanned: 10 }).kind).toBe("nothing");
    expect(decideRule(SPEC, { kind: "wedged", candidates: [{ ...just, etimeSeconds: SPEC.minAgeSeconds }], scanned: 10 }).kind).toBe("propose");
  });

  test("NOTHING-TO-DO AND COULD-NOT-LOOK ARE DIFFERENT ANSWERS, and both are different from off", () => {
    // The direction doc's own rule, and the thing the mutation check for this
    // stage breaks on purpose: an empty candidate list must never read the same
    // as a fleet API that did not answer.
    const nothing = decideRule(SPEC, { kind: "wedged", candidates: [], scanned: 750 });
    const blind = decideRule(SPEC, { kind: "cannot-see", why: "could not reach the fleet API at http://x: connect ECONNREFUSED" });
    expect(nothing.kind).toBe("nothing");
    expect(blind.kind).toBe("cannot-tell");
    expect(nothing.kind === "nothing" && nothing.why).toContain("nothing is wedged");
    expect(blind.kind === "cannot-tell" && blind.why).toContain("could not reach the fleet API");
    // And the sentences a person reads are different too, which is where the
    // distinction actually has to survive to.
    expect(describeRuleOutcome({ kind: "nothing-to-do", why: "x" })).not.toBe(describeRuleOutcome({ kind: "refused", why: "x" }));
  });

  test("the oldest leads the sentence, and the list it carries is bounded", () => {
    const many = Array.from({ length: PROPOSAL_MAX_PROCESSES + 5 }, (_v, i) => ({ ...SPECIMEN, pid: 100 + i, etimeSeconds: 20_000 + i }));
    const decision = decideRule(SPEC, { kind: "wedged", candidates: many, scanned: 800 });
    if (decision.kind !== "propose") throw new Error("expected a proposal");
    const finding = decision.finding;
    if (finding.kind !== "wedged-work") throw new Error("expected a wedged-work finding");
    expect(finding.matched).toBe(many.length);
    expect(finding.processes).toHaveLength(PROPOSAL_MAX_PROCESSES);
    // Sorted oldest first, so the bound keeps the ones worth looking at.
    expect(decision.what).toContain(String(100 + many.length - 1));
  });

  test("every knob moves the canonical form, so `definitionHash` cannot miss one", () => {
    // SP-1 in one assertion: a threshold or an action that changed while the
    // fingerprint did not is the hole this exists to close.
    const base = canonicalRuleSpec(SPEC);
    expect(canonicalRuleSpec({ ...SPEC, minAgeSeconds: 1 })).not.toBe(base);
    expect(canonicalRuleSpec({ ...SPEC, policy: "test-suites" })).not.toBe(base);
    expect(canonicalRuleSpec({ ...SPEC, disposition: "act" })).not.toBe(base);
    expect(definitionHash(ruleJob({ ...SPEC, minAgeSeconds: 1 }).definition)).not.toBe(definitionHash(ruleJob().definition));
    expect(definitionHash(ruleJob({ ...SPEC, disposition: "act" }).definition)).not.toBe(definitionHash(ruleJob().definition));
  });

  test("THE FIELD LIST IS THE TYPE'S OWN, for EVERY rule, so a knob added later cannot sit outside the fingerprint", () => {
    // GPT Sol's SC-4, and the reason the test above is not enough on its own: it
    // enumerates TODAY's fields by hand, and the destructure it was written
    // against is not exhaustive in TypeScript, so a fifth field would compile
    // perfectly and be silently unhashed — SP-1 reopened by one line.
    //
    // This asserts the two halves the mapped type buys. `RULE_SPEC_HASHED_FIELDS`
    // is derived from the encoder tables rather than typed out here, so deleting
    // one — reverting to a destructure — takes this test with it.
    //
    // **BOTH RULES, driven off the shipped specs.** `keyof RuleSpec` over a
    // union is only the fields the arms SHARE, so a single table would have
    // silently stopped covering every threshold the moment there were two
    // rules — SC-4 reopened by the union rather than by a destructure. Adding a
    // rule and forgetting its spec here makes this loop cover one rule and say
    // nothing, so the count is asserted too.
    const specs: readonly RuleSpec[] = [WEDGED_WORK_SPEC, LAUNCH_MODE_SPEC];
    expect(specs.map((spec) => spec.kind).sort()).toEqual(Object.keys(RULE_SPEC_HASHED_FIELDS).sort());
    for (const spec of specs) {
      const fields = RULE_SPEC_HASHED_FIELDS[spec.kind] as readonly string[];
      expect([...fields].sort()).toEqual(Object.keys(spec).sort());
      // And every field really reaches the bytes, one labelled line each, in the
      // table's own order. A field with an encoder that dropped it would pass the
      // check above and fail this one.
      const labels = canonicalRuleSpec(spec).split("\n").map((line) => line.slice(0, line.indexOf(":")));
      expect(labels).toEqual([...fields]);
    }
  });
});

describe("the two-phase protocol, under the scheduler", () => {
  test("a proposal round-trips out of the store, in order, and takes nothing", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const stub = ruleWorkStub({ kind: "wedged", candidates: [SPECIMEN, YOUNG], scanned: 750 });
    const reports = schedulerTick({ definitions: [ruleJob()], store, rules: stub.work, now: clock.now });
    expect(reports.map((r) => r.kind)).toEqual(["dispatched"]);
    await settle();

    // THE ORDER ON THE DISK. The intent is between the reservation and the
    // ending, and the run's own lifecycle wraps the lot.
    expect(rawKinds(root)).toEqual([
      "job-occurrence-reserved",
      "job-occurrence-started",
      "rule-intended",
      "rule-settled",
      "job-occurrence-finished",
    ]);

    // **AND THE ROUND TRIP**, which is the assertion that would have caught a
    // missing parse branch. A second store over the same bytes replays them
    // through `parseEvent`, and ONE line it cannot use refuses the whole range:
    // the history becomes `lost`, every job is held, and `unreadableLines` says
    // how many. So this is not "the append returned ok" — it is the store
    // reading its own log back and accepting every line of it.
    const second = reopen(root, clock.now);
    expect(second.opening.unreadableLines).toBe(0);
    expect(second.opening.eventsReplayed).toBe(5);
    expect(second.occurrenceHistory.kind).toBe("intact");
    // **AND THE CONTENTS COME BACK THROUGH `parseEvent`, not through a cast.**
    // GPT Sol's SC-5: the version of this that read `JSON.parse(line) as
    // OverseerEvent` proved the branch existed and nothing about what it
    // produced — a parser that returned an empty `processes`, a different
    // `matched`, or a rewritten outcome passed it, and `foldEvents` ignores rule
    // events, so nothing downstream would have noticed either.
    const events = parsedEvents(second);
    const intended = events.find((e) => e.kind === "rule-intended");
    const settled = events.find((e) => e.kind === "rule-settled");
    if (intended?.kind !== "rule-intended" || settled?.kind !== "rule-settled") throw new Error("the rule events did not survive the round trip");
    expect(intended.ruleId).toBe("wedged-work");
    // EVERY NUMBER THE PROPOSAL RESTS ON, off the disk and through the parser —
    // the denominators as well as the conclusion, because a finding that keeps
    // only its conclusion cannot be argued with afterwards.
    expect(intended.finding).toEqual({
      kind: "wedged-work",
      policy: "safe-to-kill",
      minAgeSeconds: SPEC.minAgeSeconds,
      matched: 1,
      candidates: 2,
      scanned: 750,
      processes: [SPECIMEN],
    });
    expect(intended.what).toContain("needs confirm");
    expect(settled.outcome.kind).toBe("proposed");
    expect(settled.outcome.kind === "proposed" && settled.outcome.what).toBe(intended.what);
    // NOTHING WAS TAKEN, and it could not have been: a `propose` spec is run by
    // `runProposingRule`, which is handed no actor at all.
    expect(stub.acted).toEqual([]);
  });

  test("a rule with nothing to say appends ONE terminal event and no intent", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const stub = ruleWorkStub({ kind: "wedged", candidates: [YOUNG], scanned: 750 });
    schedulerTick({ definitions: [ruleJob()], store, rules: stub.work, now: clock.now });
    await settle();
    expect(rawKinds(root)).toEqual(["job-occurrence-reserved", "job-occurrence-started", "rule-settled", "job-occurrence-finished"]);
    const settled = parsedEvents(store).find((e) => e.kind === "rule-settled");
    expect(settled?.kind === "rule-settled" && settled.outcome.kind).toBe("nothing-to-do");
  });

  test("a fleet API that will not answer is REFUSED and says so, which is not nothing-to-do", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const stub = ruleWorkStub({ kind: "cannot-see", why: "could not reach the fleet API at http://127.0.0.1:8787/api/actions/box: ECONNREFUSED" });
    schedulerTick({ definitions: [ruleJob()], store, rules: stub.work, now: clock.now });
    await settle();
    const settled = parsedEvents(store).find((e) => e.kind === "rule-settled");
    if (settled?.kind !== "rule-settled") throw new Error("expected a settled event");
    expect(settled.outcome.kind).toBe("refused");
    expect(settled.outcome.kind === "refused" && settled.outcome.why).toContain("could not reach the fleet API");
  });

  test("an observer that THROWS is a refusal to look, never an empty candidate list", async () => {
    // The dangerous flattening: a thrown fetch read as "nothing is wedged" is a
    // clean bill of health produced by a broken connection.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const work: ProposingRuleWork = {
      selfPid: 1,
      observe: () => Promise.reject(new Error("socket hang up")),
    };
    schedulerTick({ definitions: [ruleJob()], store, rules: work, now: clock.now });
    await settle();
    const settled = parsedEvents(store).find((e) => e.kind === "rule-settled");
    expect(settled?.kind === "rule-settled" && settled.outcome.kind).toBe("refused");
  });

  test("THE ACTION DOES NOT HAPPEN WHEN THE INTENT APPEND FAILS", async () => {
    // The whole reason the ordering is the scheduler's. An actor reached before
    // the intent is durable is an action nobody can review.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const real = mustOpen(root, clock.now);
    const refuseFrom = failingAfter(real, 3);
    const stub = ruleWorkStub({ kind: "wedged", candidates: [SPECIMEN], scanned: 750 }, { kind: "sent", what: "killed it" });
    schedulerTick({ definitions: [ruleJob({ ...SPEC, disposition: "act" })], store: refuseFrom, acting: stub.work, now: clock.now });
    await settle();
    expect(stub.acted).toEqual([]);
    // And the run is visibly a failure rather than a quiet success: a rule that
    // decided something and did nothing about it must not look like one that
    // had nothing to do.
    expect(rawKinds(root)).toEqual(["job-occurrence-reserved", "job-occurrence-started"]);
  });

  test("the intent is ALREADY ON THE DISK at the instant the actor is called", async () => {
    // The positive half of the ordering, and it is asserted from *inside* the
    // actor rather than from the finished log — because a log read afterwards
    // shows the same two lines in the same order whichever way round they were
    // written, so it cannot tell an append-then-act from an act-then-append.
    // This can: it reads the file at the one moment that distinguishes them.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const whenActed: string[][] = [];
    const work: ActingRuleWork = {
      selfPid: 1,
      observe: async () => ({ kind: "wedged", candidates: [SPECIMEN], scanned: 750 }),
      act: async () => {
        whenActed.push(rawKinds(root));
        return { kind: "sent", what: "killed 1 process" };
      },
    };
    schedulerTick({ definitions: [ruleJob({ ...SPEC, disposition: "act" })], store, acting: work, now: clock.now });
    await settle();
    expect(whenActed).toHaveLength(1);
    expect(whenActed[0]).toContain("rule-intended");
    const settled = parsedEvents(store).find((e) => e.kind === "rule-settled");
    expect(settled?.kind === "rule-settled" && settled.outcome.kind).toBe("sent");
  });

  test("an actor that throws is `failed`, never `refused` — the two are different facts", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const work: ActingRuleWork = {
      selfPid: 1,
      observe: async () => ({ kind: "wedged", candidates: [SPECIMEN], scanned: 750 }),
      act: () => Promise.reject(new Error("the route exploded")),
    };
    schedulerTick({ definitions: [ruleJob({ ...SPEC, disposition: "act" })], store, acting: work, now: clock.now });
    await settle();
    const settled = parsedEvents(store).find((e) => e.kind === "rule-settled");
    expect(settled?.kind === "rule-settled" && settled.outcome.kind).toBe("failed");
  });

  test("a daemon given no rule runner refuses the job rather than dispatching it", () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const reports = schedulerTick({ definitions: [ruleJob()], store, now: clock.now });
    expect(reports.map((r) => r.kind)).toEqual(["refused"]);
  });

  test("AN ACTING SPEC MEETS A REFUSAL IN A PROCESS THAT HOLDS ONLY THE LOOKING CAPABILITY", () => {
    // GPT Sol's SC-2, at the level it actually matters. The old arrangement gave
    // every rule run an `act` callback and separated them with a runtime
    // `switch` — *"precisely the conditional boundary the claim said had been
    // avoided"*. Now the two dispositions are two runners with two capabilities,
    // so a process handed only `observe` has no actor to reach however the
    // switch is edited.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const look: ProposingRuleWork = { selfPid: 7, observe: async () => ({ kind: "wedged", candidates: [SPECIMEN], scanned: 750 }) };
    const reports = schedulerTick({ definitions: [ruleJob({ ...SPEC, disposition: "act" })], store, rules: look, now: clock.now });
    expect(reports.map((r) => r.kind)).toEqual(["refused"]);
    const refusal = reports[0] as Extract<SchedulerReport, { kind: "refused" }>;
    expect(refusal.why).toContain("no actor");
  });

  test("A DAEMON GIVEN NO SPAWNER CANNOT START A SESSION JOB, however due it is", () => {
    // SP-4's structural half. Not a filter over the job list: the capability is
    // absent from the process, so the refusal is the only thing that can happen.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const session: JobDefinition = {
      id: "get-ready-to-deploy",
      everyMs: 1,
      leaseMs: 1000,
      what: "start a session",
      documents: [],
      work: { kind: "session" },
    };
    const reports = schedulerTick({
      definitions: [{ definition: session, authorisedHash: definitionHash(session) }],
      store,
      rules: ruleWorkStub({ kind: "wedged", candidates: [], scanned: 1 }).work,
      now: clock.now,
    });
    expect(reports.map((r) => r.kind)).toEqual(["refused"]);
    const refusal = reports[0] as Extract<SchedulerReport, { kind: "refused" }>;
    expect(refusal.why).toContain("no session dispatcher");
  });
});

/**
 * **RULE 1 THROUGH THE WHOLE MACHINE — and the half that would be silent.**
 *
 * SP-9: adding an event kind touches six places and the sixth is a runtime
 * parser nothing forces you to write. A finding is the same hazard one level
 * down — `parseFinding` switches on the finding's own `kind`, so a launch-mode
 * finding with no branch would append perfectly and come back on the next read
 * as *"is not a rule this version knows"*, taking the whole event with it and
 * making the store's history `lost`.
 *
 * So this reads the bytes back through a SECOND store, and asserts on the four
 * counts rather than on the sentence: a parser that summed `cannotTell` into
 * `auto` on the way out would undo, silently and after the fact, the whole
 * distinction the rule is for.
 */
describe("rule 1 under the scheduler, and back off the disk", () => {
  const LAUNCH_SPEC: RuleSpec = { kind: "launch-mode", minSessions: 1, maxCollectionAgeSeconds: 300, disposition: "propose" };

  function launchJob(): AuthorisedJob {
    const definition: RuleJobDefinition = {
      id: "launch-mode",
      everyMs: 60_000,
      leaseMs: 120_000,
      what: "watch for sessions that did not come up in auto mode",
      documents: [],
      work: { kind: "rule", rule: LAUNCH_SPEC },
    };
    return { definition, authorisedHash: definitionHash(definition) };
  }

  function looking(observation: RuleObservation): ProposingRuleWork {
    return { selfPid: 4242, observe: async () => observation };
  }

  test("a drifted session round-trips out of the store, with all four counts intact", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T22:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const look = looking({
      kind: "launch-modes",
      collection: { collected: true, ageSeconds: 56 },
      sessions: [
        { id: "$1", name: "worktree-alpha", mode: { kind: "auto" } },
        { id: "$2", name: "worktree-beta", mode: { kind: "not-auto", mode: "manual mode" } },
        { id: "$3", name: "shell-one", mode: { kind: "not-applicable", why: "this is a shell" } },
        { id: "$4", name: "worktree-gamma", mode: { kind: "cannot-tell", why: "the status bar is not on this screenful" } },
      ],
    });
    const reports = schedulerTick({ definitions: [launchJob()], store, rules: look, now: clock.now });
    expect(reports.map((r) => r.kind)).toEqual(["dispatched"]);
    await settle();

    expect(rawKinds(root)).toEqual([
      "job-occurrence-reserved",
      "job-occurrence-started",
      "rule-intended",
      "rule-settled",
      "job-occurrence-finished",
    ]);

    const second = reopen(root, clock.now);
    expect(second.opening.unreadableLines).toBe(0);
    expect(second.opening.eventsReplayed).toBe(5);
    expect(second.occurrenceHistory.kind).toBe("intact");
    const events = parsedEvents(second);
    const intended = events.find((e) => e.kind === "rule-intended");
    const settled = events.find((e) => e.kind === "rule-settled");
    if (intended?.kind !== "rule-intended" || settled?.kind !== "rule-settled") throw new Error("the rule events did not survive the round trip");
    expect(intended.ruleId).toBe("launch-mode");
    // EVERY COUNT, off the disk and through the parser. The four arms are four
    // numbers here as well, because a parser that folded two of them would undo
    // the distinction after the fact and nothing downstream reads rule events.
    expect(intended.finding).toEqual({
      kind: "launch-mode",
      minSessions: 1,
      maxCollectionAgeSeconds: 300,
      collectionAgeSeconds: 56,
      auto: 1,
      notAuto: 1,
      cannotTell: 1,
      notApplicable: 1,
      rows: 4,
      sessions: [{ id: "$2", name: "worktree-beta", mode: "manual mode" }],
    });
    expect(intended.what).toContain("kill-and-relaunch");
    // AND IT TOOK NOTHING — `proposed` is this rule's only ending, because there
    // is no reversible act for it at all.
    expect(settled.outcome.kind).toBe("proposed");
  });

  test("a fleet with nothing wrong appends ONE terminal event and no intent", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T22:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const look = looking({
      kind: "launch-modes",
      collection: { collected: true, ageSeconds: 10 },
      sessions: [{ id: "$1", name: "worktree-alpha", mode: { kind: "auto" } }],
    });
    schedulerTick({ definitions: [launchJob()], store, rules: look, now: clock.now });
    await settle();
    expect(rawKinds(root)).toEqual(["job-occurrence-reserved", "job-occurrence-started", "rule-settled", "job-occurrence-finished"]);
    const settled = parsedEvents(store).find((e) => e.kind === "rule-settled");
    expect(settled?.kind === "rule-settled" && settled.outcome.kind).toBe("nothing-to-do");
  });

  test("A STALE COLLECTION IS `refused`, WHICH IS NOT `nothing-to-do` — the two must never read alike", async () => {
    // The direction doc's own rule, at the durable end of the pipe: off,
    // nothing-to-do and could-not-look are three facts, and the log has to keep
    // them three. A rule that could not see reaches `rule-settled` as
    // `refused`, carrying the sentence that says why.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T22:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const look = looking({
      kind: "launch-modes",
      collection: { collected: true, ageSeconds: 4000 },
      sessions: [{ id: "$1", name: "worktree-alpha", mode: { kind: "not-auto", mode: "manual mode" } }],
    });
    schedulerTick({ definitions: [launchJob()], store, rules: look, now: clock.now });
    await settle();
    const settled = parsedEvents(store).find((e) => e.kind === "rule-settled");
    if (settled?.kind !== "rule-settled") throw new Error("no rule-settled");
    expect(settled.outcome.kind).toBe("refused");
    expect(settled.outcome.kind === "refused" && settled.outcome.why).toContain("4000s old");
    // AND NO INTENT WAS RECORDED, because there was no decision to record.
    expect(rawKinds(root)).not.toContain("rule-intended");
  });
});

/**
 * **THE SPECIMEN-MAKER'S GUARD.**
 *
 * Rule 1 has no live condition to fire against, so demonstrating it needs a
 * session made deliberately — and on 2026-09-08 the first such specimen, made by
 * hand with `GJD_REPO=spideryarn2`, blinded every reader of the fleet for ten
 * minutes: `parseMeta` fails the WHOLE listing on one malformed row, so
 * `gjd-remote ls`, the dashboard's collector and `overseer status` all went dark
 * together. A rule whose specimens are anomalous sessions will keep producing
 * anomalous sessions, so the check belongs in the specimen-maker rather than in
 * an agent's memory.
 *
 * **These are the only way the refusals get exercised.** Exercising them for
 * real means blinding the fleet again, which is what the guard exists to
 * prevent — so the runner is injected and both refusals are driven from here.
 */
describe("the launch-mode specimen-maker refuses to leave a blinded fleet behind", () => {
  test("a listing that will not run at all is a refusal, and it says what it said", () => {
    const verdict = listingVerdict(() => {
      throw Object.assign(new Error("Command failed"), {
        stderr: `refusing to list: session has ${"GJD_REPO"}='spideryarn2', which is neither an owner/name slug nor 'unknown'\n`,
      });
    });
    expect(verdict.ok).toBe(false);
    // THE SENTENCE THE READER GAVE, not one this script invented. Whoever meets
    // this needs the reason, and it is the reader that has it.
    expect(verdict.ok === false && verdict.why).toContain("neither an owner/name slug");
  });

  test("A LISTING THAT SUCCEEDS WITHOUT THE SPECIMEN IN IT IS ALSO A REFUSAL", () => {
    // The half worth arguing about. It is not evidence the specimen is fine; it
    // is evidence the check could not have seen a problem with it, and calling
    // that green is the shape of every silent success this project writes up.
    const verdict = listingVerdict(() => "NAME    REPO    AGE\nOverseer  spideryarn/reading2  2h\n");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.why).toContain("cannot say whether the session is readable");
  });

  test("a listing that names the specimen is the one green there is", () => {
    expect(listingVerdict(() => `NAME  REPO\n${SPECIMEN_SESSION}  unknown\n`).ok).toBe(true);
  });
});

describe("the shipped rule job, and its pin", () => {
  test("it is built, it names the implementation files it is pinned to, and it may only propose", () => {
    const built = ruleJobs(REPO);
    expect(built.problems).toEqual([]);
    const job = built.jobs[0];
    if (job === undefined) throw new Error("expected the wedged-work rule");
    expect(job.definition.id).toBe("wedged-work");
    expect(job.definition.documents.map((d) => d.path)).toEqual([...RULE_SOURCES]);
    // AND `rule-protocol.ts` IS ONE OF THEM. The protocol was deliberately left
    // out on the argument that shared machinery in a tripwire mostly fires
    // falsely; GPT Sol's SC-2 is that this falls the wrong way, because the
    // protocol is what interprets the hashed `disposition` — so a change
    // bypassing the switch used to leave the rule's authorised hash perfectly
    // current. The protocol that decides whether to act is more load-bearing
    // than the threshold it reads. Which file it is in is the other half, and
    // the describe below asserts both directions of it.
    expect([...RULE_SOURCES]).toContain("tools/overseer/rule-protocol.ts");
    // GATE 3. Not a comment: the field is hashed, so this is also what stops it
    // being changed quietly.
    const spec = job.definition.work.rule;
    if (spec.kind !== "wedged-work") throw new Error("expected the wedged-work spec");
    expect(spec.disposition).toBe("propose");
    expect(spec.minAgeSeconds).toBe(WEDGED_WORK_MIN_AGE_SECONDS);
  });

  test("EVERY PIN IS CURRENT — each rule would actually dispatch", () => {
    // Goes red the moment anybody edits a pinned file without re-pinning, which
    // is the mechanism working rather than a nuisance:
    // `npx tsx scripts/overseer-pins.ts` prints the number to copy.
    //
    // Over every built job rather than the first, so a second rule cannot ship
    // with an unchecked pin: the three pinned files are shared, so an edit for
    // one rule moves both, and a test that read `jobs[0]` would have watched
    // half of that.
    const built = ruleJobs(REPO).jobs;
    expect(built.map((job) => job.definition.id)).toEqual(["wedged-work", "launch-mode"]);
    for (const job of built) {
      expect([job.definition.id, definitionHash(job.definition)]).toEqual([
        job.definition.id,
        AUTHORISED_RULE_HASHES[job.definition.id as keyof typeof AUTHORISED_RULE_HASHES],
      ]);
    }
  });

  test("editing the IMPLEMENTATION moves the fingerprint, which is the whole of SP-1", () => {
    const job = ruleJobs(REPO).jobs[0];
    if (job === undefined) throw new Error("expected the wedged-work rule");
    // THE TAMPERED DIGEST HAS TO DIFFER FROM THE REAL ONE, and the first version
    // of this only appended a `0` — so it was a no-op, and the test green, for
    // any file whose digest happened to end in `0`. It did on 2026-09-08, one
    // edit to `rules.ts` after this was written: a one-in-sixteen test.
    const flip = (sha: string): string => `${sha.slice(0, -1)}${sha.endsWith("0") ? "1" : "0"}`;
    const tampered = {
      ...job.definition,
      documents: job.definition.documents.map((d, i) => (i === 0 ? { ...d, sha256: flip(d.sha256) } : d)),
    };
    expect(definitionHash(tampered)).not.toBe(definitionHash(job.definition));
  });

  test("OFF and ARMED read differently, and OFF still says what it would have run", () => {
    const jobs = ruleJobs(REPO);
    const off = describeRuleJobs({ armed: false, enableVar: RULES_ENABLED_VAR, jobs });
    const armed = describeRuleJobs({ armed: true, enableVar: RULES_ENABLED_VAR, jobs });
    expect(off).toContain(RULES_ENABLED_VAR);
    expect(armed).not.toContain(RULES_ENABLED_VAR);
    for (const sentence of [off, armed]) expect(sentence).toContain("wedged-work");
  });
});

/**
 * **WHAT THE PIN COVERS, AND WHAT IT DELIBERATELY DOES NOT — and the pair is
 * the whole point.**
 *
 * A test asserting only that editing the protocol disarms the rules proves
 * nothing about over-breadth: adding the entire repository to `RULE_SOURCES`
 * would pass it. The finding these two tests exist for is the OTHER half —
 * `scheduler.ts` also carries session dispatch, the sweep and `describeReport`'s
 * wording, so pinning all of it made every rule's authorisation hostage to a
 * file that changes for reasons having nothing to do with rules. It re-pinned
 * twice in one session, and with three rules an edit to a log sentence would
 * disarm all three.
 *
 * So both directions are asserted, over a real checkout that is really edited,
 * and each is checked to be non-vacuous first: the sentence and the sweep are
 * confirmed to live in `scheduler.ts`, and the ordering is confirmed to live in
 * the file that IS pinned.
 */
describe("what a rule's pin covers, and what it deliberately does not", () => {
  const PROTOCOL = "tools/overseer/rule-protocol.ts";
  const SCHEDULER = "tools/overseer/scheduler.ts";

  /** A checkout holding only the files a pin reads, plus the one it must not. */
  function checkout(): string {
    const root = tempRoot();
    mkdirSync(join(root, "tools", "overseer"), { recursive: true });
    for (const path of [...RULE_SOURCES, SCHEDULER]) copyFileSync(join(REPO, path), join(root, path));
    return root;
  }

  function hashOf(root: string): string {
    const job = ruleJobs(root).jobs[0];
    if (job === undefined) throw new Error(`no rule job was built from ${root}`);
    return definitionHash(job.definition);
  }

  /** An edit a person would actually make, and it is asserted to have landed — a no-op edit would make either test green for nothing. */
  function edit(root: string, path: string, line: string): void {
    const before = readFileSync(join(root, path), "utf8");
    appendFileSync(join(root, path), line);
    expect(readFileSync(join(root, path), "utf8")).not.toBe(before);
  }

  test("EDITING THE SCHEDULER'S REPORTING DISARMS NOTHING — the false trips this split exists to stop", () => {
    // NON-VACUOUS FIRST. The claim is about `describeReport` and the sweep, so
    // this asserts they are in the file the next line says is unpinned.
    const scheduler = readFileSync(join(REPO, SCHEDULER), "utf8");
    expect(scheduler).toContain("export function describeReport");
    expect(scheduler).toContain("function sweep(");
    expect([...RULE_SOURCES]).not.toContain(SCHEDULER);

    const root = checkout();
    const before = hashOf(root);
    edit(root, SCHEDULER, "\n// a report sentence, reworded\n");
    expect(hashOf(root)).toBe(before);
  });

  test("EDITING THE PROTOCOL DISARMS EVERY RULE — the guarantee SC-2 asked for, kept", () => {
    // NON-VACUOUS FIRST, in the same way: the append-before-act ordering and the
    // disposition switch have to be in the file that is pinned, or this test is
    // asserting something about an empty file.
    const protocol = readFileSync(join(REPO, PROTOCOL), "utf8");
    expect(protocol).toContain('kind: "rule-intended"');
    expect(protocol).toContain("runProposingRule");
    expect(protocol).toContain("spec.disposition");
    expect([...RULE_SOURCES]).toContain(PROTOCOL);

    const root = checkout();
    const before = hashOf(root);
    edit(root, PROTOCOL, "\n// the ordering changed\n");
    expect(hashOf(root)).not.toBe(before);
  });
});

/**
 * **RULE 1: LAUNCH-MODE DRIFT, AND THE FOUR ARMS THAT MUST STAY FOUR.**
 *
 * A session that did not come up in auto mode stalls at its next unapprovable
 * call and waits for somebody who is asleep. The rule observes and never acts:
 * there is nothing reversible to do — you cannot type `/permission-mode auto`
 * and may not answer the dialog — so the only remedy is kill-and-relaunch, the
 * least reversible thing on the list.
 *
 * **`cannot-tell` is the arm every test here is really about.** A session whose
 * mode could not be read is NOT a session in auto mode, and it is not a broken
 * one either. Folded into the first it hides the defect; folded into the second
 * it cries wolf on twenty rows and teaches Greg to ignore the badge, which
 * `pane.ts` measured and costs more than the defect does. So each of the four is
 * counted separately, never summed, and both the sentence and the finding carry
 * all four.
 */
describe("rule 1: launch-mode drift", () => {
  const LAUNCH: RuleSpec = { kind: "launch-mode", minSessions: 1, maxCollectionAgeSeconds: 300, disposition: "propose" };

  const auto = (id: string): ObservedSession => ({ id, name: `session-${id}`, mode: { kind: "auto" } });
  const manual = (id: string): ObservedSession => ({ id, name: `session-${id}`, mode: { kind: "not-auto", mode: "manual mode" } });
  const unreadable = (id: string): ObservedSession => ({ id, name: `session-${id}`, mode: { kind: "cannot-tell", why: "the status bar is not on this screenful" } });
  const shell = (id: string): ObservedSession => ({ id, name: `session-${id}`, mode: { kind: "not-applicable", why: "this is a shell" } });

  function seen(sessions: readonly ObservedSession[], ageSeconds = 60): RuleObservation {
    return { kind: "launch-modes", collection: { collected: true, ageSeconds }, sessions };
  }

  test("a session in manual mode is proposed, and the sentence says a person has to relaunch it", () => {
    const decision = decideRule(LAUNCH, seen([auto("$1"), manual("$2"), shell("$3")]));
    if (decision.kind !== "propose") throw new Error(`expected a proposal, got ${decision.kind}`);
    expect(decision.what).toContain("manual mode");
    // THE REMEDY IS IN THE SENTENCE. This rule proposes something only a person
    // can do, and a proposal that does not say so reads like something that
    // happened.
    expect(decision.what).toContain("relaunch");
    const finding = decision.finding;
    if (finding.kind !== "launch-mode") throw new Error("expected a launch-mode finding");
    expect(finding.notAuto).toBe(1);
    expect(finding.auto).toBe(1);
    expect(finding.notApplicable).toBe(1);
    expect(finding.cannotTell).toBe(0);
    expect(finding.sessions.map((session) => session.id)).toEqual(["$2"]);
  });

  test("CANNOT-TELL IS NOT A NEGATIVE — an unreadable row neither fires the rule nor counts as healthy", () => {
    const decision = decideRule(LAUNCH, seen([auto("$1"), unreadable("$2")]));
    // NOT a proposal: a mode we could not read is not evidence of drift.
    expect(decision.kind).toBe("nothing");
    if (decision.kind !== "nothing") throw new Error("unreachable");
    // AND NOT SILENT EITHER. The sentence has to carry the unreadable count, or
    // "nothing to do" is a clean bill this rule never issued.
    expect(decision.why).toContain("1 could not be read");
    expect(decision.why).toContain("1 read auto");
  });

  test("CANNOT-TELL, WHEN SOMETHING IS ALSO WRONG — the proposal still carries it, separately", () => {
    const decision = decideRule(LAUNCH, seen([manual("$1"), unreadable("$2"), unreadable("$3")]));
    if (decision.kind !== "propose") throw new Error(`expected a proposal, got ${decision.kind}`);
    const finding = decision.finding;
    if (finding.kind !== "launch-mode") throw new Error("expected a launch-mode finding");
    expect(finding.notAuto).toBe(1);
    expect(finding.cannotTell).toBe(2);
    expect(decision.what).toContain("2 more could not be read");
  });

  test("A SHELL IS NOT A SESSION THAT FAILED TO LAUNCH — it is left out of the denominator too", () => {
    // SP-11's lesson, in the arithmetic: "3 of 15" mixed eight agent sessions
    // with seven shells. A shell has no permission mode, so it is neither a
    // numerator nor a denominator here.
    const decision = decideRule(LAUNCH, seen([auto("$1"), shell("$2"), shell("$3")]));
    if (decision.kind !== "nothing") throw new Error(`expected nothing, got ${decision.kind}`);
    expect(decision.why).toContain("1 read auto");
    expect(decision.why).toContain("2 row(s) have no permission mode");
    expect(decision.why).not.toContain("of 3 agent");
  });

  test("THE THRESHOLD IS REAL — one drifted session is under a threshold of two", () => {
    const drift = seen([manual("$1"), auto("$2")]);
    expect(decideRule({ ...LAUNCH, minSessions: 2 }, drift).kind).toBe("nothing");
    expect(decideRule({ ...LAUNCH, minSessions: 1 }, drift).kind).toBe("propose");
  });

  test("A COLLECTION THAT WAS STALE WHEN IT WAS SERVED IS A CANNOT-TELL, not a clean bill", () => {
    const stale = seen([auto("$1")], 600);
    const decision = decideRule(LAUNCH, stale);
    expect(decision.kind).toBe("cannot-tell");
    if (decision.kind !== "cannot-tell") throw new Error("unreachable");
    expect(decision.why).toContain("600");
    // And the threshold is the thing that decides it, not a literal.
    expect(decideRule({ ...LAUNCH, maxCollectionAgeSeconds: 900 }, stale).kind).toBe("nothing");
  });

  test("A DASHBOARD THAT HAS NEVER COLLECTED SAYS NOTHING ABOUT THE BOX", () => {
    // `state.ts`'s own rule: an empty `rows` is only a claim about the box when
    // `collectedAt` is non-null. A freshly restarted dashboard reporting no
    // drift is not the same fact as a box with no drift.
    const decision = decideRule(LAUNCH, { kind: "launch-modes", collection: { collected: false }, sessions: [] });
    expect(decision.kind).toBe("cannot-tell");
  });

  test("AN OBSERVATION FOR THE OTHER RULE IS A CANNOT-TELL, never a nothing", () => {
    const decision = decideRule(LAUNCH, { kind: "wedged", candidates: [], scanned: 10 });
    expect(decision.kind).toBe("cannot-tell");
    const other = decideRule(SPEC, { kind: "launch-modes", collection: { collected: true, ageSeconds: 1 }, sessions: [] });
    expect(other.kind).toBe("cannot-tell");
  });

  test("every knob of the launch-mode spec moves the fingerprint", () => {
    const base = ruleJob(LAUNCH).definition;
    const hash = definitionHash(base);
    expect(definitionHash(ruleJob({ ...LAUNCH, minSessions: 2 }).definition)).not.toBe(hash);
    expect(definitionHash(ruleJob({ ...LAUNCH, maxCollectionAgeSeconds: 301 }).definition)).not.toBe(hash);
    expect(definitionHash(ruleJob({ ...LAUNCH, disposition: "act" }).definition)).not.toBe(hash);
    // And the two rules' canonical forms cannot collide.
    expect(canonicalRuleSpec(LAUNCH)).not.toBe(canonicalRuleSpec(SPEC));
  });
});

/**
 * **READING `permissionMode` OFF THE RAW WIRE, with our own parser and our own
 * unknown arms.**
 *
 * `observation.ts`'s `parseRow` drops this field, and widening it is refused on
 * the merits: `ObservedRow` and `diff.ts` answer *what changed about a session
 * over time*, and a permission mode is a present-tense question that was never
 * their customer. So the rule parses the wire payload itself — the same way
 * `web/src/types.ts` restates `FleetPermissionMode` rather than importing it.
 */
describe("rule 1's observer, against the dashboard's own /api/state shape", () => {
  const LAUNCH: RuleSpec = { kind: "launch-mode", minSessions: 1, maxCollectionAgeSeconds: 300, disposition: "propose" };

  function stateBody(rows: readonly unknown[], extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      schema: 1,
      collectedAt: "2026-09-08T21:23:22.269Z",
      servedAt: "2026-09-08T21:23:52.269Z",
      rows,
      ...extra,
    });
  }

  function getter(body: string, ok = true, status = 200): { get: HttpGet; asked: string[] } {
    const asked: string[] = [];
    return {
      asked,
      get: async (url) => {
        asked.push(url);
        return { ok, status, statusText: ok ? "OK" : "Internal Server Error", text: async () => body };
      },
    };
  }

  const row = (id: string, permissionMode: unknown): Record<string, unknown> => ({ id, name: `session-${id}`, permissionMode });

  test("the four arms come across as four", async () => {
    const http = getter(
      stateBody([
        row("$1", { kind: "auto" }),
        row("$2", { kind: "not-auto", mode: "manual mode" }),
        row("$3", { kind: "cannot-tell", why: "the status bar is not on this screenful" }),
        row("$4", { kind: "not-applicable", why: "this is a shell" }),
      ]),
    );
    const observe = fleetStateObserver({ baseUrl: "http://127.0.0.1:8787", get: http.get });
    const observation = await observe(LAUNCH);
    if (observation.kind !== "launch-modes") throw new Error(`expected launch-modes, got ${observation.kind}`);
    expect(observation.sessions.map((session) => session.mode.kind)).toEqual(["auto", "not-auto", "cannot-tell", "not-applicable"]);
    expect(http.asked[0]).toBe("http://127.0.0.1:8787/api/state");
    // The collection's age is the dashboard's OWN two clocks, so there is no
    // skew to argue about.
    expect(observation.collection).toEqual({ collected: true, ageSeconds: 30 });
  });

  test("AN ARM THIS BUILD DOES NOT KNOW IS `cannot-tell`, NEVER `not-auto`", async () => {
    // `readPaneMode`'s own rule, one layer out: the day Claude Code renames a
    // mode, every row must not light up red at once.
    const http = getter(stateBody([row("$1", { kind: "plan-mode" })]));
    const observation = await fleetStateObserver({ baseUrl: "http://127.0.0.1:8787", get: http.get })(LAUNCH);
    if (observation.kind !== "launch-modes") throw new Error("expected launch-modes");
    expect(observation.sessions[0]?.mode.kind).toBe("cannot-tell");
    expect(decideRule(LAUNCH, observation).kind).toBe("nothing");
  });

  test("a dashboard too old to report the field is `cannot-tell` as well", async () => {
    const http = getter(stateBody([{ id: "$1", name: "session-$1" }]));
    const observation = await fleetStateObserver({ baseUrl: "http://127.0.0.1:8787", get: http.get })(LAUNCH);
    if (observation.kind !== "launch-modes") throw new Error("expected launch-modes");
    expect(observation.sessions[0]?.mode.kind).toBe("cannot-tell");
  });

  test("ONE UNREADABLE ROW POISONS THE WHOLE OBSERVATION, exactly as rule 2's does", async () => {
    const http = getter(stateBody([row("$1", { kind: "auto" }), "not a row"]));
    const observation = await fleetStateObserver({ baseUrl: "http://127.0.0.1:8787", get: http.get })(LAUNCH);
    expect(observation.kind).toBe("cannot-see");
  });

  test("a collection served before it was taken is a cannot-see, not a negative age", async () => {
    const http = getter(stateBody([row("$1", { kind: "auto" })], { servedAt: "2026-09-08T21:00:00.000Z" }));
    const observation = await fleetStateObserver({ baseUrl: "http://127.0.0.1:8787", get: http.get })(LAUNCH);
    expect(observation.kind).toBe("cannot-see");
  });

  test("a dashboard that answers badly is a cannot-see rather than an empty fleet", async () => {
    for (const [body, ok] of [["{}", true], ["not json", true], ["{}", false]] as const) {
      const http = getter(body, ok, ok ? 200 : 500);
      const observation = await fleetStateObserver({ baseUrl: "http://127.0.0.1:8787", get: http.get })(LAUNCH);
      expect(observation.kind).toBe("cannot-see");
    }
  });
});

describe("the deterministic-only arming, as the shipped CLI does it", () => {
  test(`nothing but exactly "1" arms it`, () => {
    expect(rulesEnabled({})).toBe(false);
    expect(rulesEnabled({ [RULES_ENABLED_VAR]: "true" })).toBe(false);
    expect(rulesEnabled({ [RULES_ENABLED_VAR]: "1" })).toBe(true);
  });

  test("RULES-ONLY HANDS THE DAEMON NO SPAWNER AT ALL, and no standing job either", () => {
    // The assertion SP-4 asked for, and the one that catches somebody
    // "simplifying" this back into a filter.
    const wiring = schedulerWiring({ [RULES_ENABLED_VAR]: "1" });
    expect(wiring.arming).toBe("rules-only");
    expect(wiring.jobs?.spawn).toBeUndefined();
    expect(wiring.jobs?.rules).toBeDefined();
    expect(wiring.jobs?.definitions.map((job) => job.definition.id)).toEqual(["wedged-work", "launch-mode"]);
    expect(wiring.detail).toContain("NO SESSION DISPATCHER");
  });

  test("the full arming still supplies both standing jobs AND the rule, with a spawner", () => {
    const wiring = schedulerWiring({ OVERSEER_JOBS_ENABLED: "1" });
    expect(wiring.arming).toBe("all");
    expect(typeof wiring.jobs?.spawn).toBe("function");
    expect(wiring.jobs?.definitions.map((job) => job.definition.id)).toEqual([
      "get-ready-to-deploy",
      "feedback-sweep",
      "wedged-work",
      "launch-mode",
    ]);
  });

  test("off is still off, and still says what it would have run", () => {
    const wiring = schedulerWiring({});
    expect(wiring.arming).toBe("off");
    expect(wiring.jobs).toBeUndefined();
    expect(wiring.definitions.map((job) => job.definition.id)).toEqual([
      "get-ready-to-deploy",
      "feedback-sweep",
      "wedged-work",
      "launch-mode",
    ]);
  });
});

describe("looking at the box, and the actor that refuses", () => {
  function respond(body: unknown, ok = true): { post: HttpPost; sent: { url: string; body: string }[] } {
    const sent: { url: string; body: string }[] = [];
    return {
      sent,
      post: async (url, init) => {
        sent.push({ url, body: init.body });
        return { ok, status: ok ? 200 : 500, statusText: ok ? "OK" : "Server Error", text: async () => JSON.stringify(body) };
      },
    };
  }

  const DRY_RUN = { ok: true, op: "dry-run", result: { candidates: [SPECIMEN], scanned: 750, steps: [], unreadable: 1 } };

  test("it asks for a DRY RUN and there is no way to ask for anything else", async () => {
    const http = respond(DRY_RUN);
    const observation = await fleetObserver({ baseUrl: "http://127.0.0.1:8787", post: http.post })(SPEC);
    expect(observation.kind).toBe("wedged");
    const body = JSON.parse(http.sent[0]?.body ?? "{}") as Record<string, unknown>;
    expect(body["mode"]).toBe("dry-run");
    expect(body["actionId"]).toBe("kill-safe-processes");
    // `confirm` is ABSENT rather than false — the route reads `confirm === true`,
    // and there is nothing in this module that could set it.
    expect(Object.hasOwn(body, "confirm")).toBe(false);
    expect(http.sent[0]?.url).toBe("http://127.0.0.1:8787/api/actions/box");
  });

  test("a candidate whose age is not a number POISONS the observation rather than shrinking it", async () => {
    // The silent version of this bug is the dangerous one: a string
    // `etimeSeconds` compares false against the threshold, so a wedged box would
    // read as "nothing is wedged".
    const http = respond({ ok: true, result: { candidates: [{ ...SPECIMEN, etimeSeconds: "70477" }], scanned: 750 } });
    const observation = await fleetObserver({ baseUrl: "http://127.0.0.1:8787", post: http.post })(SPEC);
    expect(observation.kind).toBe("cannot-see");
  });

  test("a dashboard that answers an error, or nonsense, is cannot-see and names the URL", async () => {
    for (const bad of [respond({ ok: false }, false), respond({ ok: true }), respond("not json at all")]) {
      const observation = await fleetObserver({ baseUrl: "http://127.0.0.1:8787", post: bad.post })(SPEC);
      expect(observation.kind).toBe("cannot-see");
      expect(observation.kind === "cannot-see" && observation.why).toContain("http://127.0.0.1:8787/api/actions/box");
    }
  });

  test("THE SHIPPED WIRING CARRIES NO ACTOR AT ALL — there is nothing to refuse with", () => {
    // This replaces a test that asserted the shipped actor refused politely.
    // GPT Sol's SC-2 is that a refusing actor is a runtime conditional wearing
    // the clothes of a boundary; the answer is that the capability is not in
    // this process. So the assertion is about a missing key rather than a
    // returned sentence.
    const work = ruleWork({ baseUrl: "http://127.0.0.1:8787", selfPid: 4242 });
    expect(Object.hasOwn(work, "observe")).toBe(true);
    expect(Object.hasOwn(work, "act")).toBe(false);
    const wired = schedulerWiring({ [RULES_ENABLED_VAR]: "1" }).jobs?.rules;
    expect(wired === undefined || Object.hasOwn(wired, "act")).toBe(false);
  });
});

/**
 * **Read the log back THROUGH THE STORE'S OWN PARSER.**
 *
 * This used to be `JSON.parse(line) as OverseerEvent`, and GPT Sol's SC-5 is
 * that the cast made the round-trip claim in this file's header false: it proved
 * the parse branch *existed* — a deleted one shows up as `unreadableLines` when
 * the store reopens — and nothing at all about whether it parsed *correctly*. A
 * `parseEvent` that accepted a rule event and returned an empty `processes`, or
 * a different `matched`, or rewrote the outcome, passed every assertion here,
 * and `foldEvents` ignores rule events, so nothing else could have caught it.
 *
 * `readEvents` is the real reader: the same `parseEvent`, and the same
 * all-or-nothing refusal, so a corrupted field is a red test rather than a green
 * one.
 */
function parsedEvents(store: OverseerStore): readonly OverseerEvent[] {
  const read = store.readEvents(0);
  expect(read.unreadable).toEqual([]);
  return read.events;
}

/** A store whose appends land until `failFrom`, and are refused from it on. Copied in shape from overseer-jobs.test.ts, which is where the idiom is explained. */
function failingAfter(real: OverseerStore, failFrom: number): OccurrenceLog {
  let appends = 0;
  return {
    instanceId: real.instanceId,
    get occurrences() {
      return real.occurrences;
    },
    occurrenceHistory: { kind: "intact" },
    append(events): AppendResult {
      appends += 1;
      if (appends >= failFrom) return { ok: false, reason: "lock-lost", holder: null };
      return real.append(events);
    },
  };
}
