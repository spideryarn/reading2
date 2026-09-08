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
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import type { OverseerEvent } from "../tools/overseer/diff.js";
import { definitionHash, type AuthorisedJob, type JobDefinition, type RuleJobDefinition } from "../tools/overseer/jobs.js";
import { AUTHORISED_RULE_HASHES, RULE_SOURCES, WEDGED_WORK_MIN_AGE_SECONDS, describeRuleJobs, ruleJobs } from "../tools/overseer/rule-jobs.js";
import { RULES_ENABLED_VAR, fleetObserver, refusingActor, rulesEnabled, type HttpPost } from "../tools/overseer/rule-work.js";
import {
  PROPOSAL_MAX_PROCESSES,
  canonicalRuleSpec,
  decideRule,
  describeRuleOutcome,
  type RuleObservation,
  type RuleOutcome,
  type RuleSpec,
  type WedgedProcess,
} from "../tools/overseer/rules.js";
import { schedulerTick, type OccurrenceLog, type RuleWork, type SchedulerReport } from "../tools/overseer/scheduler.js";
import { EVENTS_FILE, openStore, type AppendResult, type OverseerStore } from "../tools/overseer/store.js";
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

/** A `RuleWork` whose observation the test decides, and which records whether the actor was reached. */
function ruleWorkStub(observation: RuleObservation, outcome: RuleOutcome = { kind: "sent", what: "it was done" }): {
  work: RuleWork;
  acted: string[];
} {
  const acted: string[] = [];
  return {
    acted,
    work: {
      selfPid: 4242,
      observe: async () => observation,
      act: async (_spec, what) => {
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
    const decision = decideRule(SPEC, { kind: "seen", candidates: [SPECIMEN, YOUNG], scanned: 750 });
    expect(decision.kind).toBe("propose");
    if (decision.kind !== "propose") return;
    expect(decision.what).toContain("kill");
    expect(decision.what).toContain("cwd-deleted");
    expect(decision.what).toContain("needs confirm");
    expect(decision.what).toContain(String(SPECIMEN.pid));
    // The denominators, so a later reader can check the arithmetic rather than
    // take the conclusion.
    expect(decision.finding.matched).toBe(1);
    expect(decision.finding.candidates).toBe(2);
    expect(decision.finding.scanned).toBe(750);
    expect(decision.finding.processes.map((p) => p.pid)).toEqual([SPECIMEN.pid]);
  });

  test("THE THRESHOLD IS THE THRESHOLD: a candidate one second under it is not proposed", () => {
    const just = { ...SPECIMEN, etimeSeconds: SPEC.minAgeSeconds - 1 };
    expect(decideRule(SPEC, { kind: "seen", candidates: [just], scanned: 10 }).kind).toBe("nothing");
    expect(decideRule(SPEC, { kind: "seen", candidates: [{ ...just, etimeSeconds: SPEC.minAgeSeconds }], scanned: 10 }).kind).toBe("propose");
  });

  test("NOTHING-TO-DO AND COULD-NOT-LOOK ARE DIFFERENT ANSWERS, and both are different from off", () => {
    // The direction doc's own rule, and the thing the mutation check for this
    // stage breaks on purpose: an empty candidate list must never read the same
    // as a fleet API that did not answer.
    const nothing = decideRule(SPEC, { kind: "seen", candidates: [], scanned: 750 });
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
    const decision = decideRule(SPEC, { kind: "seen", candidates: many, scanned: 800 });
    if (decision.kind !== "propose") throw new Error("expected a proposal");
    expect(decision.finding.matched).toBe(many.length);
    expect(decision.finding.processes).toHaveLength(PROPOSAL_MAX_PROCESSES);
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
});

describe("the two-phase protocol, under the scheduler", () => {
  test("a proposal round-trips out of the store, in order, and takes nothing", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const stub = ruleWorkStub({ kind: "seen", candidates: [SPECIMEN, YOUNG], scanned: 750 });
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
    const events = eventsFrom(root);
    const intended = events.find((e) => e.kind === "rule-intended");
    const settled = events.find((e) => e.kind === "rule-settled");
    if (intended?.kind !== "rule-intended" || settled?.kind !== "rule-settled") throw new Error("the rule events did not survive the round trip");
    expect(intended.ruleId).toBe("wedged-work");
    expect(intended.finding.processes[0]?.pid).toBe(SPECIMEN.pid);
    expect(settled.outcome.kind).toBe("proposed");
    expect(settled.outcome.kind === "proposed" && settled.outcome.what).toContain("needs confirm");
    // NOTHING WAS TAKEN, and it could not have been: a `propose` spec has no
    // path to the actor at all.
    expect(stub.acted).toEqual([]);
  });

  test("a rule with nothing to say appends ONE terminal event and no intent", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const stub = ruleWorkStub({ kind: "seen", candidates: [YOUNG], scanned: 750 });
    schedulerTick({ definitions: [ruleJob()], store, rules: stub.work, now: clock.now });
    await settle();
    expect(rawKinds(root)).toEqual(["job-occurrence-reserved", "job-occurrence-started", "rule-settled", "job-occurrence-finished"]);
    const settled = eventsFrom(root).find((e) => e.kind === "rule-settled");
    expect(settled?.kind === "rule-settled" && settled.outcome.kind).toBe("nothing-to-do");
  });

  test("a fleet API that will not answer is REFUSED and says so, which is not nothing-to-do", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const stub = ruleWorkStub({ kind: "cannot-see", why: "could not reach the fleet API at http://127.0.0.1:8787/api/actions/box: ECONNREFUSED" });
    schedulerTick({ definitions: [ruleJob()], store, rules: stub.work, now: clock.now });
    await settle();
    const settled = eventsFrom(root).find((e) => e.kind === "rule-settled");
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
    const work: RuleWork = {
      selfPid: 1,
      observe: () => Promise.reject(new Error("socket hang up")),
      act: async () => ({ kind: "sent", what: "no" }),
    };
    schedulerTick({ definitions: [ruleJob()], store, rules: work, now: clock.now });
    await settle();
    const settled = eventsFrom(root).find((e) => e.kind === "rule-settled");
    expect(settled?.kind === "rule-settled" && settled.outcome.kind).toBe("refused");
  });

  test("THE ACTION DOES NOT HAPPEN WHEN THE INTENT APPEND FAILS", async () => {
    // The whole reason the ordering is the scheduler's. An actor reached before
    // the intent is durable is an action nobody can review.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const real = mustOpen(root, clock.now);
    const refuseFrom = failingAfter(real, 3);
    const stub = ruleWorkStub({ kind: "seen", candidates: [SPECIMEN], scanned: 750 }, { kind: "sent", what: "killed it" });
    schedulerTick({ definitions: [ruleJob({ ...SPEC, disposition: "act" })], store: refuseFrom, rules: stub.work, now: clock.now });
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
    const work: RuleWork = {
      selfPid: 1,
      observe: async () => ({ kind: "seen", candidates: [SPECIMEN], scanned: 750 }),
      act: async () => {
        whenActed.push(rawKinds(root));
        return { kind: "sent", what: "killed 1 process" };
      },
    };
    schedulerTick({ definitions: [ruleJob({ ...SPEC, disposition: "act" })], store, rules: work, now: clock.now });
    await settle();
    expect(whenActed).toHaveLength(1);
    expect(whenActed[0]).toContain("rule-intended");
    const settled = eventsFrom(root).find((e) => e.kind === "rule-settled");
    expect(settled?.kind === "rule-settled" && settled.outcome.kind).toBe("sent");
  });

  test("an actor that throws is `failed`, never `refused` — the two are different facts", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const work: RuleWork = {
      selfPid: 1,
      observe: async () => ({ kind: "seen", candidates: [SPECIMEN], scanned: 750 }),
      act: () => Promise.reject(new Error("the route exploded")),
    };
    schedulerTick({ definitions: [ruleJob({ ...SPEC, disposition: "act" })], store, rules: work, now: clock.now });
    await settle();
    const settled = eventsFrom(root).find((e) => e.kind === "rule-settled");
    expect(settled?.kind === "rule-settled" && settled.outcome.kind).toBe("failed");
  });

  test("a daemon given no rule runner refuses the job rather than dispatching it", () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T21:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const reports = schedulerTick({ definitions: [ruleJob()], store, now: clock.now });
    expect(reports.map((r) => r.kind)).toEqual(["refused"]);
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
      rules: ruleWorkStub({ kind: "seen", candidates: [], scanned: 1 }).work,
      now: clock.now,
    });
    expect(reports.map((r) => r.kind)).toEqual(["refused"]);
    const refusal = reports[0] as Extract<SchedulerReport, { kind: "refused" }>;
    expect(refusal.why).toContain("no session dispatcher");
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
    // GATE 3. Not a comment: the field is hashed, so this is also what stops it
    // being changed quietly.
    expect(job.definition.work.rule.disposition).toBe("propose");
    expect(job.definition.work.rule.minAgeSeconds).toBe(WEDGED_WORK_MIN_AGE_SECONDS);
  });

  test("THE PIN IS CURRENT — the rule would actually dispatch", () => {
    // Goes red the moment anybody edits `rules.ts` or `rule-work.ts` without
    // re-pinning, which is the mechanism working rather than a nuisance:
    // `npx tsx scripts/overseer-pins.ts` prints the number to copy.
    const job = ruleJobs(REPO).jobs[0];
    expect(job && definitionHash(job.definition)).toBe(AUTHORISED_RULE_HASHES["wedged-work"]);
  });

  test("editing the IMPLEMENTATION moves the fingerprint, which is the whole of SP-1", () => {
    const job = ruleJobs(REPO).jobs[0];
    if (job === undefined) throw new Error("expected the wedged-work rule");
    const tampered = {
      ...job.definition,
      documents: job.definition.documents.map((d, i) => (i === 0 ? { ...d, sha256: `${d.sha256.slice(0, -1)}0` } : d)),
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
    expect(wiring.jobs?.definitions.map((job) => job.definition.id)).toEqual(["wedged-work"]);
    expect(wiring.detail).toContain("NO SESSION DISPATCHER");
  });

  test("the full arming still supplies both standing jobs AND the rule, with a spawner", () => {
    const wiring = schedulerWiring({ OVERSEER_JOBS_ENABLED: "1" });
    expect(wiring.arming).toBe("all");
    expect(typeof wiring.jobs?.spawn).toBe("function");
    expect(wiring.jobs?.definitions.map((job) => job.definition.id)).toEqual(["get-ready-to-deploy", "feedback-sweep", "wedged-work"]);
  });

  test("off is still off, and still says what it would have run", () => {
    const wiring = schedulerWiring({});
    expect(wiring.arming).toBe("off");
    expect(wiring.jobs).toBeUndefined();
    expect(wiring.definitions.map((job) => job.definition.id)).toEqual(["get-ready-to-deploy", "feedback-sweep", "wedged-work"]);
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
    expect(observation.kind).toBe("seen");
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

  test("the shipped actor refuses, and says whose decision it is", async () => {
    const outcome = await refusingActor()(SPEC, "kill 1 process");
    expect(outcome.kind).toBe("refused");
    expect(outcome.kind === "refused" && outcome.why).toContain("Greg");
  });
});

/** Read the log back through the store's own parser. Nothing here trusts a JSON.parse of a line the test itself wrote. */
function eventsFrom(root: string): OverseerEvent[] {
  const path = join(root, EVENTS_FILE);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "");
  const parsed: OverseerEvent[] = [];
  for (const line of lines) parsed.push(JSON.parse(line) as OverseerEvent);
  return parsed;
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
