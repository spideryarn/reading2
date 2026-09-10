/**
 * The standing jobs, their pins, and what the shipped CLI hands the daemon.
 *
 * **This file exists because the engine passed every test it had and scheduled
 * nothing.** GPT Sol's C1: `scripts/overseer.ts` called `runOverseer` with no
 * `jobs`, there were no definitions anywhere outside the tests, and nothing
 * that could start a session at all — so a suite full of green scheduler tests
 * said nothing about whether the installed Overseer ran anything.
 *
 * So the assertions here are deliberately about the SHIPPED configuration
 * rather than about fixtures: the real pins, the real documents, the real run
 * specs. Since plan 260910f (scheduled dispatch) a session job starts only
 * through the launch protocol, which `tests/overseer-scheduled-dispatch.test.ts`
 * drives; the `gjd-remote` dispatcher this file used to test is deleted.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { schedulerWiring } from "../scripts/overseer.js";
import { authorisationOf, behaviourHash, documentDrift, type Arming, type AuthorisedJob } from "../tools/overseer/jobs.js";
import { jobsEnabled, JOBS_ENABLED_VAR } from "../tools/overseer/dispatch.js";
import { ruleJobs } from "../tools/overseer/rule-jobs.js";
import { hours } from "../tools/overseer/schedules.js";
import {
  AUTHORISED_HASHES,
  describeStandingJobs,
  FEEDBACK_SWEEP_DOCS,
  FEEDBACK_SWEEP_PROMPT,
  FEEDBACK_SWEEP_RUN,
  GET_READY_TO_DEPLOY_DOCS,
  GET_READY_TO_DEPLOY_PROMPT,
  GET_READY_TO_DEPLOY_RUN,
  SCHEDULE_FIXTURE_DOCS,
  SCHEDULE_FIXTURE_RUN,
  standingJobs,
} from "../tools/overseer/standing-jobs.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-standing-test-"));
  roots.push(root);
  return root;
}

/**
 * WHEN THIS SCHEDULER WAS ARMED, for `schedulerWiring`.
 *
 * It only ever reaches `TickInput.arming`, and nothing in this file runs a tick
 * — these tests ask what the CLI would HAND the daemon, not what the daemon
 * would then do with it. A real instant rather than the `unknown` arm all the
 * same, because the shipped call site passes one and a fixture that could not
 * would be a fixture the wiring never sees.
 */
const ARMED: Arming = { kind: "armed", at: "2026-09-08T00:00:00.000Z" };

/**
 * **THE TWO REAL JOBS WHOSE PINS WERE DELIBERATELY NOT MOVED** (plan 260910f
 * scheduled dispatch, § D4). Their run specs grant `write`, which is Greg's to
 * authorise, so they read NOT AUTHORISED until he re-pins them.
 */
const AWAITING_GREG = ["get-ready-to-deploy", "feedback-sweep"];

describe("the standing jobs, as this checkout would actually run them", () => {
  test("all three are built, and each names the document its authority comes from", () => {
    const built = standingJobs(REPO);
    expect(built.problems).toEqual([]);
    // The third is the dry-run fixture (plan 260910e § D5).
    expect(built.jobs.map((job) => job.definition.behaviour.id)).toEqual(["get-ready-to-deploy", "feedback-sweep", "schedule-fixture"]);
    for (const job of built.jobs) {
      expect(job.definition.behaviour.what.length).toBeGreaterThan(20);
      expect(job.definition.behaviour.documents.length).toBeGreaterThan(0);
      for (const document of job.definition.behaviour.documents) expect(document.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(built.jobs[0]?.definition.behaviour.documents.map((d) => d.path)).toEqual([...GET_READY_TO_DEPLOY_DOCS]);
    expect(built.jobs[1]?.definition.behaviour.documents.map((d) => d.path)).toEqual([...FEEDBACK_SWEEP_DOCS]);
  });

  test("THE PINS ARE CURRENT for the fixture — and the two real jobs are NOT AUTHORISED until Greg authorises their run specs", () => {
    // THIS TEST GOES RED WHEN ONE OF THOSE DOCUMENTS IS EDITED, and that is what
    // it is for. The scheduler refuses a job whose definition no longer matches
    // its pin, so without this the consequence of an ordinary doc edit is a
    // standing job that silently stopped running.
    //
    // WHEN IT FAILS: read what changed in the document, decide whether the job
    // should still run unattended on a box with nobody watching, and only then
    // copy the new hash into AUTHORISED_HASHES in tools/overseer/standing-jobs.ts.
    const jobs = standingJobs(REPO).jobs;
    const fixture = jobs.find((job) => job.definition.behaviour.id === "schedule-fixture");
    if (fixture === undefined) throw new Error("expected the schedule fixture");
    expect(`schedule-fixture ${behaviourHash(fixture.definition.behaviour)}`).toBe(`schedule-fixture ${fixture.authorisedHash}`);

    // THE REFUSAL, WITH ITS REASON: the behaviour moved — by the run spec alone —
    // and NOT because a document did. When Greg re-pins these, this block is
    // what changes, deliberately.
    for (const id of AWAITING_GREG) {
      const job = jobs.find((one) => one.definition.behaviour.id === id);
      if (job === undefined) throw new Error(`expected ${id}`);
      const authorisation = authorisationOf(job);
      expect(authorisation.kind, id).toBe("unauthorised");
      if (authorisation.kind !== "unauthorised") return;
      expect(authorisation.authorised).toBe(AUTHORISED_HASHES[id as keyof typeof AUTHORISED_HASHES]);
      expect(authorisation.why).toContain(`authorised as ${job.authorisedHash} and now fingerprints as ${behaviourHash(job.definition.behaviour)}`);
      expect(documentDrift(job.authorisedDocuments, job.definition.behaviour.documents), id).toEqual([]);
    }
    expect(Object.keys(AUTHORISED_HASHES).sort()).toEqual(["feedback-sweep", "get-ready-to-deploy", "schedule-fixture"]);
  });

  test("each job carries its run spec: the fixture's harmless one, and the two proposed ones that grant write", () => {
    const byId = new Map(standingJobs(REPO).jobs.map((job) => [job.definition.behaviour.id, job.definition.behaviour.work]));
    expect(byId.get("schedule-fixture")).toEqual({ kind: "session", run: { timeoutMinutes: 5, access: "read-only" } });
    expect(SCHEDULE_FIXTURE_RUN).toEqual({ timeoutMinutes: 5, access: "read-only" });
    expect(byId.get("get-ready-to-deploy")).toEqual({ kind: "session", run: GET_READY_TO_DEPLOY_RUN });
    expect(GET_READY_TO_DEPLOY_RUN).toEqual({ timeoutMinutes: 180, access: "write" });
    expect(byId.get("feedback-sweep")).toEqual({ kind: "session", run: FEEDBACK_SWEEP_RUN });
    expect(FEEDBACK_SWEEP_RUN).toEqual({ timeoutMinutes: 120, access: "write" });
  });

  test("a document that cannot be read drops its job AND says so, rather than dropping it quietly", () => {
    // An empty checkout: neither document exists. A job that is simply absent
    // from the list is C1 in miniature — a scheduler with nothing to schedule
    // and no sentence saying why.
    const built = standingJobs(tempRoot());
    expect(built.jobs).toEqual([]);
    expect(built.problems).toHaveLength(3);
    expect(built.problems.join("\n")).toContain("get-ready-to-deploy");
    expect(built.problems.join("\n")).toContain("could not be read");
  });

  test("editing one of the documents moves the fingerprint, so the pin stops matching", () => {
    // The runbook's gate 3 in one test: the jobs ARE documents, so a doc edit is
    // a definition edit whether or not the prompt moved.
    const root = tempRoot();
    for (const path of [...GET_READY_TO_DEPLOY_DOCS, ...FEEDBACK_SWEEP_DOCS]) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(join(root, path), "the document as it was\n");
    }
    const before = standingJobs(root).jobs;
    writeFileSync(join(root, GET_READY_TO_DEPLOY_DOCS[0]), "the document, with a new paragraph nobody reviewed\n");
    const after = standingJobs(root).jobs;
    expect(before[0]?.definition.behaviour.what).toBe(after[0]?.definition.behaviour.what);
    expect(behaviourHash(after[0]!.definition.behaviour)).not.toBe(behaviourHash(before[0]!.definition.behaviour));
    // The other job is untouched: one document changing must not disarm the lot.
    expect(behaviourHash(after[1]!.definition.behaviour)).toBe(behaviourHash(before[1]!.definition.behaviour));
  });
});

describe("per-document pins, the dispatch mode, and the fixture (plan 260910e)", () => {
  const SHIPPED = (): readonly AuthorisedJob[] => [...standingJobs(REPO).jobs, ...ruleJobs(REPO).jobs];
  /** The shipped jobs whose pin is current — every one but the two awaiting Greg. */
  const PINNED = (): readonly AuthorisedJob[] => SHIPPED().filter((job) => !AWAITING_GREG.includes(job.definition.behaviour.id));

  test("THE PINS AGREE: each job's authorised documents rebuild its authorised hash exactly — and the two awaiting Greg differ by the run spec only", () => {
    // Plan § D4. The behaviour hash is the only gate; `authorisedDocuments`
    // exists so a refusal can name WHICH document moved. That is only true if
    // the two literals describe the same authorisation, so this ties them.
    const shipped = SHIPPED();
    expect(shipped.map((job) => job.definition.behaviour.id)).toEqual([
      "get-ready-to-deploy",
      "feedback-sweep",
      "schedule-fixture",
      "wedged-work",
      "launch-mode",
    ]);
    for (const job of shipped) {
      const behaviour = job.definition.behaviour;
      expect(job.authorisedDocuments.map((document) => document.path)).toEqual(behaviour.documents.map((document) => document.path));
      const rebuilt = behaviourHash({ ...behaviour, documents: job.authorisedDocuments });
      if (AWAITING_GREG.includes(behaviour.id)) {
        // THE DOCUMENTS ARE EXACTLY AS PINNED; the hash is not, because the run
        // spec is new and unauthorised. Both halves, so this cannot pass by the
        // documents having moved instead.
        expect(job.authorisedDocuments, behaviour.id).toEqual(behaviour.documents);
        expect(`${behaviour.id} ${rebuilt}`).not.toBe(`${behaviour.id} ${job.authorisedHash}`);
      } else {
        expect(`${behaviour.id} ${rebuilt}`).toBe(`${behaviour.id} ${job.authorisedHash}`);
      }
    }
  });

  test("and it is not vacuous: altering one pinned digest breaks the agreement", () => {
    for (const job of PINNED()) {
      const [first, ...rest] = job.authorisedDocuments;
      if (first === undefined) throw new Error(`${job.definition.behaviour.id} pins no document, so this test would prove nothing about it`);
      const flipped = `${first.sha256.slice(0, -1)}${first.sha256.endsWith("0") ? "1" : "0"}`;
      expect(flipped).not.toBe(first.sha256);
      const altered = [{ ...first, sha256: flipped }, ...rest];
      expect(behaviourHash({ ...job.definition.behaviour, documents: job.authorisedDocuments })).toBe(job.authorisedHash);
      expect(behaviourHash({ ...job.definition.behaviour, documents: altered })).not.toBe(job.authorisedHash);
    }
  });

  test("every session prompt says the Overseer owns the recurrence (plan § D3b)", () => {
    // The roadmap's "No cron hidden inside a Claude session": get-ready-to-deploy.md
    // still tells its runner that the recurring form is a /loop. Until that rule
    // doc changes, the prompt is the mechanism.
    for (const prompt of [GET_READY_TO_DEPLOY_PROMPT, FEEDBACK_SWEEP_PROMPT]) {
      expect(prompt.endsWith(" This run is one occurrence of a schedule the Overseer owns: do not create a /loop, cron job, timer or any follow-up schedule.")).toBe(true);
    }
  });

  test("the fixture is a dry-run session job on its own harmless document; every other shipped job is live", () => {
    const shipped = SHIPPED();
    const fixture = shipped.find((job) => job.definition.behaviour.id === "schedule-fixture");
    if (fixture === undefined) throw new Error("expected the schedule fixture");
    expect(fixture.definition.behaviour.work).toEqual({ kind: "session", run: SCHEDULE_FIXTURE_RUN });
    expect(fixture.definition.behaviour.dispatch.kind).toBe("dry-run");
    expect(fixture.definition.behaviour.documents.map((document) => document.path)).toEqual([...SCHEDULE_FIXTURE_DOCS]);
    expect(fixture.definition.schedule).toEqual({ everyMs: hours(24), leaseMs: hours(1), initialDelayMs: hours(2) });
    expect(readFileSync(join(REPO, "tools/overseer/schedule-fixture.md"), "utf8")).toContain("schedule fixture ran");
    for (const job of shipped.filter((one) => one !== fixture)) {
      expect(`${job.definition.behaviour.id} ${job.definition.behaviour.dispatch.kind}`).toBe(`${job.definition.behaviour.id} live`);
    }
  });
});

describe("armed or not, said out loud", () => {
  test(`nothing but exactly "1" arms it`, () => {
    expect(jobsEnabled({})).toBe(false);
    expect(jobsEnabled({ [JOBS_ENABLED_VAR]: "" })).toBe(false);
    expect(jobsEnabled({ [JOBS_ENABLED_VAR]: "0" })).toBe(false);
    expect(jobsEnabled({ [JOBS_ENABLED_VAR]: "true" })).toBe(false);
    expect(jobsEnabled({ [JOBS_ENABLED_VAR]: "yes" })).toBe(false);
    expect(jobsEnabled({ [JOBS_ENABLED_VAR]: "1" })).toBe(true);
  });

  test("OFF and ARMED read differently, and OFF still says what it would have run", () => {
    // The distinction the whole finding is about: a scheduler that is switched
    // off must not produce the same sentence as one with an empty queue.
    const jobs = standingJobs(REPO);
    const off = describeStandingJobs({ armed: false, enableVar: JOBS_ENABLED_VAR, jobs });
    const armed = describeStandingJobs({ armed: true, enableVar: JOBS_ENABLED_VAR, jobs });
    // The DETAIL, not the word: OFF/ARMED belongs to the caller, which has it
    // already — saying it here too printed `OFF — OFF — …` on the status page.
    expect(off).toContain(JOBS_ENABLED_VAR);
    expect(off).toContain("nothing will be dispatched");
    expect(armed).not.toContain(JOBS_ENABLED_VAR);
    expect(off).not.toBe(armed);
    for (const sentence of [off, armed]) {
      expect(sentence).toContain("get-ready-to-deploy");
      expect(sentence).toContain("feedback-sweep");
    }
  });

  test("the two jobs awaiting Greg are named NOT AUTHORISED in the shipped sentence, with the hash to copy", () => {
    const jobs = standingJobs(REPO);
    const sentence = describeStandingJobs({ armed: true, enableVar: JOBS_ENABLED_VAR, jobs });
    for (const job of jobs.jobs.filter((one) => AWAITING_GREG.includes(one.definition.behaviour.id))) {
      expect(sentence).toContain(`${job.definition.behaviour.id} (NOT AUTHORISED: pinned ${job.authorisedHash}, now ${behaviourHash(job.definition.behaviour)})`);
    }
    expect(sentence).toContain("schedule-fixture (dry-run)");
    expect(sentence).not.toContain("schedule-fixture (dry-run) (NOT AUTHORISED");
  });

  test("a job whose pin no longer matches is named as such, with the hash to copy", () => {
    const jobs = standingJobs(REPO);
    const first = jobs.jobs.find((job) => job.definition.behaviour.id === "schedule-fixture");
    if (first === undefined) throw new Error("expected a job");
    const broken = { jobs: [{ ...first, definition: { ...first.definition, behaviour: { ...first.definition.behaviour, what: "something else" } } }], problems: [] };
    const sentence = describeStandingJobs({ armed: true, enableVar: JOBS_ENABLED_VAR, jobs: broken });
    expect(sentence).toContain("NOT AUTHORISED");
    expect(sentence).toContain(behaviourHash(broken.jobs[0]!.definition.behaviour));
  });
});

describe("the wiring the shipped CLI actually does", () => {
  test("nothing is scheduled unless the env var says so, and the daemon is given no jobs at all", () => {
    // THE FINDING ITSELF. `scripts/overseer.ts` used to call `runOverseer` with
    // no `jobs` under any circumstances, so the installed Overseer scheduled
    // nothing while every scheduler test passed. This is the assertion that
    // would have caught it, and the one that catches it coming back.
    const off = schedulerWiring({}, ARMED);
    expect(off.armed).toBe(false);
    expect(off.detail).toContain(JOBS_ENABLED_VAR);
    // THE ASSERTION THAT MATTERS: the daemon is handed nothing at all, which is
    // what stops it building a scheduler timer.
    expect(off.jobs).toBeUndefined();

    const on = schedulerWiring({ [JOBS_ENABLED_VAR]: "1" }, ARMED);
    expect(on.armed).toBe(true);
    // The deterministic rule rides along under the full arming, which is the
    // superset; `tests/overseer-rules.test.ts` covers the rules-only one.
    expect(on.jobs?.definitions.map((job) => job.definition.behaviour.id)).toEqual(["get-ready-to-deploy", "feedback-sweep", "schedule-fixture", "wedged-work", "launch-mode"]);
    expect(on.detail).not.toContain(JOBS_ENABLED_VAR);
    expect(on.problems).toEqual([]);
  });

  test("NO SESSION CAPABILITY UNDER ANY ARMING until the daemon composes the launch protocol: no spawner, and the preview says so", () => {
    // Plan 260910f (scheduled dispatch): the `gjd-remote` spawner is deleted and
    // the launch protocol is Stage C's to hand over. A wiring that claimed a
    // session capability nothing holds would be S8-7 again.
    for (const env of [{ [JOBS_ENABLED_VAR]: "1" }, { OVERSEER_RULES_ENABLED: "1" }, {}]) {
      const wiring = schedulerWiring(env, ARMED);
      expect(Object.keys(wiring.jobs ?? {})).not.toContain("spawn");
      expect(Object.keys(wiring.jobs ?? {})).not.toContain("launch");
      expect(wiring.preview.capabilities.session).toBe(false);
    }
    // And under the full arming the session jobs say why they cannot run.
    const on = schedulerWiring({ [JOBS_ENABLED_VAR]: "1" }, ARMED);
    const fixture = on.eligibility.find((one) => one.jobId === "schedule-fixture");
    expect(fixture?.kind).toBe("dry-run");
    for (const id of AWAITING_GREG) expect(on.eligibility.find((one) => one.jobId === id)?.kind).toBe("ineligible");
  });

  test("the definitions are built either way, so a disarmed daemon can still say what it would run", () => {
    // Off must not mean blind. A disarmed scheduler that could not name its jobs
    // would be indistinguishable from one that has none.
    expect(schedulerWiring({}, ARMED).definitions.map((job) => job.definition.behaviour.id)).toEqual([
      "get-ready-to-deploy",
      "feedback-sweep",
      "schedule-fixture",
      "wedged-work",
      "launch-mode",
    ]);
  });
});
