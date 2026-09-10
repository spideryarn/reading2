/**
 * The standing jobs, their pins, and the thing that actually starts a session.
 *
 * **This file exists because the engine passed every test it had and scheduled
 * nothing.** GPT Sol's C1: `scripts/overseer.ts` called `runOverseer` with no
 * `jobs`, there were no definitions anywhere outside the tests, and no
 * `SpawnJob` implementation at all — so a suite full of green scheduler tests
 * said nothing about whether the installed Overseer ran anything.
 *
 * So the assertions here are deliberately about the SHIPPED configuration
 * rather than about fixtures: the real pins, the real documents, the real argv
 * the box would run. The one thing not exercised is starting an actual Claude
 * session, and that is on purpose — the spawner is injected, because a test that
 * really dispatched would put two agents on the box every time somebody ran the
 * suite.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { schedulerWiring } from "../scripts/overseer.js";
import { behaviourHash, type Arming, type AuthorisedJob, type JobDefinition, type OccurrenceKey } from "../tools/overseer/jobs.js";
import { gjdRemoteDispatch, jobsEnabled, JOBS_ENABLED_VAR, sessionName, TSX_RELATIVE_PATH, type ChildSpawner } from "../tools/overseer/dispatch.js";
import { ruleJobs } from "../tools/overseer/rule-jobs.js";
import { hours } from "../tools/overseer/schedules.js";
import {
  AUTHORISED_HASHES,
  describeStandingJobs,
  FEEDBACK_SWEEP_DOCS,
  FEEDBACK_SWEEP_PROMPT,
  GET_READY_TO_DEPLOY_DOCS,
  GET_READY_TO_DEPLOY_PROMPT,
  SCHEDULE_FIXTURE_DOCS,
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

  test("THE PINS ARE CURRENT — every standing job would actually dispatch", () => {
    // THIS TEST GOES RED WHEN ONE OF THOSE DOCUMENTS IS EDITED, and that is what
    // it is for. The scheduler refuses a job whose definition no longer matches
    // its pin, so without this the consequence of an ordinary doc edit is a
    // standing job that silently stopped running — which is the exact failure
    // (a scheduler that schedules nothing, looking fine) this whole file exists
    // to make impossible.
    //
    // WHEN IT FAILS: read what changed in the document, decide whether the job
    // should still run unattended on a box with nobody watching, and only then
    // copy the new hash into AUTHORISED_HASHES in tools/overseer/standing-jobs.ts.
    // Copying it without reading is the ceremonial version of this check and
    // buys nothing.
    for (const job of standingJobs(REPO).jobs) {
      expect(`${job.definition.behaviour.id} ${behaviourHash(job.definition.behaviour)}`).toBe(`${job.definition.behaviour.id} ${job.authorisedHash}`);
    }
    expect(Object.keys(AUTHORISED_HASHES).sort()).toEqual(["feedback-sweep", "get-ready-to-deploy", "schedule-fixture"]);
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

  test("THE PINS AGREE: each job's authorised documents rebuild its authorised hash exactly", () => {
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
      expect(`${behaviour.id} ${behaviourHash({ ...behaviour, documents: job.authorisedDocuments })}`).toBe(`${behaviour.id} ${job.authorisedHash}`);
    }
  });

  test("and it is not vacuous: altering one pinned digest breaks the agreement", () => {
    for (const job of SHIPPED()) {
      const [first, ...rest] = job.authorisedDocuments;
      if (first === undefined) throw new Error(`${job.definition.behaviour.id} pins no document, so this test would prove nothing about it`);
      const flipped = `${first.sha256.slice(0, -1)}${first.sha256.endsWith("0") ? "1" : "0"}`;
      expect(flipped).not.toBe(first.sha256);
      const altered = [{ ...first, sha256: flipped }, ...rest];
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
    expect(fixture.definition.behaviour.work).toEqual({ kind: "session" });
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

  test("a job whose pin no longer matches is named as such, with the hash to copy", () => {
    const jobs = standingJobs(REPO);
    const tampered = {
      jobs: jobs.jobs.map((job) => ({ ...job, authorisedHash: job.authorisedHash })),
      problems: jobs.problems,
    };
    const first = tampered.jobs[0];
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
    // superset; `tests/overseer-rules.test.ts` covers the rules-only one, where
    // the daemon is handed no spawner at all.
    expect(on.jobs?.definitions.map((job) => job.definition.behaviour.id)).toEqual(["get-ready-to-deploy", "feedback-sweep", "schedule-fixture", "wedged-work", "launch-mode"]);
    expect(typeof on.jobs?.spawn).toBe("function");
    expect(on.detail).not.toContain(JOBS_ENABLED_VAR);
    expect(on.problems).toEqual([]);
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

describe("what actually starts a session", () => {
  const KEY: OccurrenceKey = {
    jobId: "get-ready-to-deploy",
    scheduledAt: "2026-09-08T17:32:00.000Z",
    behaviourHash: behaviourHash({ id: "x", what: "x", documents: [], work: { kind: "session" }, dispatch: { kind: "live" } }),
  };

  /** A one-off session job. The schedule is arbitrary here: nothing in this describe consults the clock — the dispatcher is handed a definition and a key. */
  function job(id: string, what: string): JobDefinition {
    return { behaviour: { id, what, documents: [], work: { kind: "session" }, dispatch: { kind: "live" } }, schedule: { everyMs: 1, leaseMs: 1, initialDelayMs: 0 } };
  }

  function fakeSpawner(): { spawn: ChildSpawner; calls: { command: string; args: readonly string[]; cwd: unknown }[]; stdin: string[]; exit(code: number | null): void } {
    const calls: { command: string; args: readonly string[]; cwd: unknown }[] = [];
    const stdin: string[] = [];
    let exitListener: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
    const spawn: ChildSpawner = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return {
        pid: 5150,
        stdin: { end: (text: string) => stdin.push(text) },
        stderr: { on: () => undefined },
        on: (event: string, listener: (...rest: never[]) => void) => {
          if (event === "exit") exitListener = listener as (code: number | null, signal: NodeJS.Signals | null) => void;
        },
      } as ReturnType<ChildSpawner>;
    };
    return { spawn, calls, stdin, exit: (code) => exitListener?.(code, null) };
  }

  test("it runs the checkout's own tsx against gjd-remote, with the prompt on stdin", async () => {
    // The invocation docs/project/feedback-reports.md § The run names, and the
    // one docs/project/overseer.md § Dispatching agents repeats: `-p -` so the
    // prompt needs no quoting, `--no-attach` because nothing here has a terminal.
    const fake = fakeSpawner();
    const spawn = gjdRemoteDispatch({ repoRoot: REPO, spawnProcess: fake.spawn, log: () => undefined });
    const definition = standingJobs(REPO).jobs[0]?.definition;
    if (definition === undefined) throw new Error("expected a definition");
    const outcome = spawn(definition, KEY);
    expect(outcome.kind).toBe("spawned");
    if (outcome.kind !== "spawned") return;
    expect(outcome.pid).toBe(5150);
    const [call] = fake.calls;
    expect(call?.command).toBe(join(REPO, TSX_RELATIVE_PATH));
    expect(call?.args).toEqual([
      "scripts/gjd-remote.ts",
      "new-claude",
      "get-ready-to-deploy-0908-1732",
      "--account",
      "auto",
      "--no-attach",
      "-p",
      "-",
    ]);
    expect(call?.cwd).toBe(REPO);
    // THE PROMPT, AND IT IS THE DEFINITION'S OWN `what` — the thing that was
    // fingerprinted and pinned. A dispatcher that composed its own prompt here
    // would be running something nobody authorised.
    expect(fake.stdin).toEqual([`${definition.behaviour.what}\n`]);
    fake.exit(0);
    await expect(outcome.done).resolves.toEqual({ kind: "exited", code: 0 });
  });

  test("stdin is CLOSED, or `-p -` waits for an EOF that never comes", async () => {
    // A `-p -` with an open stdin is a gjd-remote that blocks for ever, which
    // this scheduler would eventually call `stuck` — six hours later, for a job
    // that never started.
    const fake = fakeSpawner();
    const spawn = gjdRemoteDispatch({ repoRoot: REPO, spawnProcess: fake.spawn, log: () => undefined });
    spawn(job("j", "do the thing"), KEY);
    expect(fake.stdin).toEqual(["do the thing\n"]);
  });

  test("a checkout with no tsx is REFUSED, not thrown — a refusal settles the occurrence", () => {
    // The difference the scheduler cares about: `refused` means we know nothing
    // started, and a throw means the runner broke its contract and produced an
    // `unknown` that is never retried. A missing binary is knowable.
    const spawn = gjdRemoteDispatch({ repoRoot: tempRoot(), spawnProcess: fakeSpawner().spawn, log: () => undefined });
    const outcome = spawn(job("j", "x"), KEY);
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.why).toContain(TSX_RELATIVE_PATH);
  });

  test("a signal is a failure with a sentence, never an invented exit code", async () => {
    const fake = fakeSpawner();
    const spawn = gjdRemoteDispatch({ repoRoot: REPO, spawnProcess: fake.spawn, log: () => undefined });
    const outcome = spawn(job("j", "x"), KEY);
    if (outcome.kind !== "spawned") throw new Error("expected a spawn");
    fake.exit(null);
    await expect(outcome.done).resolves.toEqual({ kind: "failed", why: expect.stringContaining("killed") });
  });

  test("the session name is one gjd-remote will accept, and says whose it is", () => {
    // `new-claude` refuses anything but lower-case letters, digits and hyphens,
    // up to 41 characters — and refuses a name that already exists, which is why
    // the instant is in it.
    for (const jobId of ["get-ready-to-deploy", "feedback-sweep"]) {
      const name = sessionName({ ...KEY, jobId });
      expect(name).toMatch(/^[a-z0-9-]{1,41}$/);
      expect(name.startsWith(jobId)).toBe(true);
    }
    // Two dispatches at different minutes are different sessions; the same
    // minute is the same name, which gjd-remote refuses loudly rather than
    // running twice.
    expect(sessionName(KEY)).not.toBe(sessionName({ ...KEY, scheduledAt: "2026-09-08T17:33:00.000Z" }));
    expect(sessionName(KEY)).toBe(sessionName({ ...KEY, scheduledAt: "2026-09-08T17:32:44.000Z" }));
  });
});
