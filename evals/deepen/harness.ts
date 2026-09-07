/**
 * **The mechanisms stage 5b needs that the cost eval did not**, kept apart from
 * the driving so each can be watched failing without a database, a network or a
 * model — tests/deepen-eval.test.ts.
 *
 * Everything the two evals share is **imported** from evals/cost/harness.ts
 * rather than copied: the eval spend overlay, the fixture stage-1 step and the
 * local-database gate. ⟨A fourth, the in-process pump silencer, is gone:
 * `enqueue` takes `pump: false` on the request now — src/jobs.ts § `pump`.
 * 2026-09-05.⟩ What is here is only what is new:
 *
 * - **An ingress for an untracked file.** The book and the article are in
 *   `output/`, which is gitignored, so they cannot join
 *   `evals/cost/fixtures.ts` — a checked-in manifest pointing at a file nobody
 *   else has would break that eval for everyone. They are named on the command
 *   line and hashed at run time instead, and the digest goes in the results
 *   file so a later run can say whether it read the same bytes.
 * - **The re-ask probe.** `SPIDERYARN_DEEPEN_REASK` names articles, and a repeat
 *   that is not named is free, silent and identical *by construction*. That is
 *   the failure this whole harness is most able to produce while looking
 *   healthy, so the lever is exercised against **the very slugs this run will
 *   use**, before anything is bought.
 * - **A recording checkpoint store**, which is how "the wave never touches the
 *   structure checkpoint" becomes an observation rather than a claim.
 * - **The estimate**, so the paid path prints what it is about to buy.
 *
 * **Nothing here may import `src/hierarchy.ts`**, and that is a rule rather than
 * an accident: this file is imported by `tests/deepen-eval.test.ts`, and
 * `src/hierarchy.ts` imports the app, which reaches the filesystem ledger
 * adapter — so a value import of `buildTree` here put a suite that touches no
 * store at all into `tests/store-migration-registry.ts` needing an entry to
 * excuse one. `proveTheSeam` lives in `run.ts` for that reason;
 * `assertSeamProof`, the half with the assertions in it, stays here.
 * `scripts/store-migration-candidates.ts` is what says whether this is still
 * true — the bucket for this file's dependents should be `type-only`.
 */

import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { type DeepenRecordsFile, reaskExpansions, REASK_ENV } from "../../src/hierarchy-deepen.js";
import {
  assertCheckpointRequest,
  type CheckpointArticleRef,
  type CheckpointNamespace,
  type CheckpointStore,
} from "../../src/store/checkpoints.js";
import type { JobStatus, StepName } from "../../src/types.js";
import type { CostFixture } from "../cost/fixtures.js";
import type { DeepenFinding } from "./report.js";

/* ------------------------------------------------------- the file on disk -- */

/**
 * A document named on the command line, hashed as it is read.
 *
 * It wears `CostFixture`'s shape so that `fixtureFetch` — the stage-1 seam the
 * cost eval already proved — takes it unchanged. **`sha256` is measured rather
 * than asserted**, which is the one honest difference: a checked-in fixture is
 * held to a manifest, and an untracked file has no manifest to be held to. The
 * digest is recorded so two runs can be compared, and the run says out loud
 * that nothing verified it.
 */
export async function fileFixture(filePath: string, name: string): Promise<{ fixture: CostFixture; bytes: Uint8Array }> {
  const bytes = new Uint8Array(await readFile(filePath));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".html" && ext !== ".htm") {
    throw new Error(
      `${filePath} is not HTML (${ext || "no extension"}). This eval drives HTML through the ` +
        "fixture stage-1 step; a PDF would pay for transcription as well and is a different " +
        "measurement.",
    );
  }
  return {
    bytes,
    fixture: {
      name,
      /* Repo-relative where it can be, absolute otherwise — recorded so a later
         reader knows which file this was, not so anything re-resolves it. */
      file: filePath,
      kind: "html",
      contentType: "text/html; charset=utf-8",
      sha256,
      words: 0,
      blocks: null,
      gistableBlocks: null,
      caveat:
        "Named on the command line and hashed at run time. output/ is gitignored, so there is no " +
        "committed manifest to hold these bytes to.",
    },
  };
}

/* ------------------------------------------ the checkpoint store, recorded -- */

export interface RecordingCheckpoints extends CheckpointStore {
  /** Every read and write, in order, as `read hierarchy-deepen/<key>`. */
  readonly touched: string[];
  /** Which namespaces were touched at all. The question the seam probe asks. */
  namespaces(): Set<CheckpointNamespace>;
}

/**
 * **A checkpoint store that says what was asked of it.**
 *
 * `tests/helpers/memory-checkpoints.ts` is the faithful in-memory fake and this
 * is deliberately not a second copy of it: it keeps the same refusals (through
 * the same `assertCheckpointRequest`) and adds the one thing an eval needs and a
 * test does not — the namespaces. That is what turns *"re-asking does not touch
 * the structure checkpoint"* from a sentence in a docblock into something this
 * run watched happen with its own eyes.
 */
export function recordingCheckpoints(ref: CheckpointArticleRef): RecordingCheckpoints {
  const entries = new Map<string, string>();
  const touched: string[] = [];
  const at = (namespace: string, key: string): string => `${namespace}/${key}`;
  return {
    touched,
    namespaces(): Set<CheckpointNamespace> {
      return new Set(touched.map((t) => t.split(" ")[1]!.split("/")[0] as CheckpointNamespace));
    },
    async read<T>(slug: string, namespace: CheckpointNamespace, keys: readonly string[]): Promise<Map<string, T>> {
      assertCheckpointRequest(ref, slug, namespace, keys);
      const found = new Map<string, T>();
      for (const key of keys) {
        touched.push(`read ${at(namespace, key)}`);
        const json = entries.get(at(namespace, key));
        if (json !== undefined) found.set(key, JSON.parse(json) as T);
      }
      return found;
    },
    async write(slug: string, namespace: CheckpointNamespace, key: string, value: unknown): Promise<void> {
      assertCheckpointRequest(ref, slug, namespace, [key]);
      touched.push(`write ${at(namespace, key)}`);
      entries.set(at(namespace, key), JSON.stringify(value));
    },
  };
}

/* ----------------------------------------------------------- the re-ask probe -- */

/**
 * **Does the lever name the slugs this run is about to use, and only those?**
 *
 * Pure, so every answer can be exercised rather than only the one this machine
 * happens to give. Two failures, and they are opposite:
 *
 * - **The book is not named.** Its repeats then read their own rows back, make
 *   no call, and report verdicts identical *by construction*. Question 1 comes
 *   out perfect and means nothing, and the run costs money to say so.
 * - **An ordinary article IS named.** Every wave on it is bought again. Harmless
 *   here, but the reason the variable stopped being a boolean is that a worker
 *   started with it set re-bought waves for *unrelated readers' jobs*, so a
 *   harness that widens it by accident is reproducing the P0.
 */
export function assertReaskNames(opts: {
  envValue: string | undefined;
  mustName: readonly string[];
  mustNotName: readonly string[];
}): void {
  const before = process.env[REASK_ENV];
  try {
    if (opts.envValue === undefined) delete process.env[REASK_ENV];
    else process.env[REASK_ENV] = opts.envValue;
    const missing = opts.mustName.filter((slug) => !reaskExpansions(slug));
    if (missing.length > 0) {
      throw new Error(
        `${REASK_ENV}=${JSON.stringify(opts.envValue ?? null)} does not name ${missing.join(", ")}. ` +
          "A repeat that is not named reads its own checkpoint rows back, buys nothing, and " +
          "reports verdicts identical to the previous repeat BY CONSTRUCTION — which looks " +
          "exactly like a perfectly stable signal and is worth nothing. Refusing to spend " +
          "anything until the lever works. src/hierarchy-deepen.ts § REASK_ENV.",
      );
    }
    const over = opts.mustNotName.filter((slug) => reaskExpansions(slug));
    if (over.length > 0) {
      throw new Error(
        `${REASK_ENV}=${JSON.stringify(opts.envValue ?? null)} also names ${over.join(", ")}, ` +
          "which this run must not re-buy. The variable names articles rather than being a " +
          "boolean precisely because a boolean re-bought waves for unrelated readers' jobs.",
      );
    }
  } finally {
    if (before === undefined) delete process.env[REASK_ENV];
    else process.env[REASK_ENV] = before;
  }
}

/* ------------------------------------------------ the step lists, checked -- */

/**
 * **What each kind of job in this run asks the queue for.** `stepsFor` in
 * `run.ts` builds it; the shape lives here so it can be refused for free.
 */
export interface StepPlans {
  /** Phases A, C and D's load articles: nothing to published, in one job. */
  ingest: readonly StepName[];
  /** Phases B, C and D's book pass: the step forced again on an existing article. */
  rerun: readonly StepName[];
  force: readonly StepName[];
}

/**
 * **Would the queue take every list this run is about to send it?**
 *
 * Asked before anything is enqueued, on every path including `--preflight`, and
 * the reason is a run that had already happened: `--dry-run` asked for
 * `["blocks"]`, `enqueue` refused it with a 400 the moment `dev` merged in
 * (src/jobs.ts § `unrunnableStepPlan`), and the rehearsal died at its first
 * `enqueue` having created nothing — after printing its whole closing report,
 * `Findings: none` included.
 * docs/postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md.
 *
 * **The rule is injected rather than imported**, so this can be watched refusing
 * a bad list without `src/jobs.ts` — which imports the world — coming into the
 * test suite with it. `run.ts` passes the real `unrunnableStepPlan`, so there is
 * one rule and this is a caller of it, not a second copy.
 */
export function assertStepPlansRunnable(
  plans: StepPlans,
  refuse: (steps: readonly StepName[]) => string | undefined,
): void {
  for (const [name, steps] of Object.entries(plans) as [keyof StepPlans, readonly StepName[]][]) {
    if (steps.length === 0) continue;
    const why = refuse(steps);
    if (why === undefined) continue;
    throw new Error(
      `This run's \`${name}\` step list [${steps.join(", ")}] is one the queue refuses: ${why}\n` +
        "  Every phase would throw at `enqueue`, no job would exist, and the run would print a " +
        "clean report over nothing. Fix the list in `stepsFor` rather than the rule.",
    );
  }
}

/* ------------------------------------------------ the measured step, lined up -- */

/**
 * **What the gate tells a step it has just let go of.**
 *
 * `"go"` — everybody was at the entry, run. `"abandoned"` — the gate gave up and
 * this phase can no longer be measured, so do not run: see `abandonStep`.
 */
export type GateVerdict = "go" | "abandoned";

/** What the run learned from lining the load jobs up with the book. */
export interface RendezvousOutcome {
  /** The slugs whose measured step reached the entry, in the order they did. */
  arrived: string[];
  /** How many parties the rendezvous has in total — three, in phase D. */
  expected: number;
  /**
   * **How many *this* wait needed**, which is not always all of them: the
   * readiness wait needs the two load steps and deliberately leaves the book out,
   * because the book is not driven until the readiness wait has ended.
   */
  needed: number;
  /** Why the wait ended. Only `"all"` means everyone this wait needed is there. */
  why: "all" | "timed out" | "jobs finished first";
  ms: number;
  /**
   * **How long each held step stood at the entry**, in arrival order.
   *
   * Not decoration. The hold is *inside* the load job's claim and after its
   * step's clock has started, so every one of these milliseconds is both a
   * millisecond off that claim's 740 s deadline and a millisecond added to the
   * `hierarchy` window question 5 reads. `runPhaseD` says so out loud when it is
   * more than a moment.
   */
  held: { slug: string; ms: number }[];
}

/**
 * **An eval-only start rendezvous, so that phase D's three measured windows can
 * actually intersect.**
 *
 * The arithmetic in `peakConcurrency` was right and the phase did not arrange
 * the thing it measures. The book's job is a forced `hierarchy` and begins its
 * measured step at once; the two load articles begin at `fetch` and reach
 * `hierarchy` only after stages 1-3. Whether the three windows shared a common
 * intersection was left to how long those stages happened to take — and a peak
 * below three makes question 5 unanswerable *after* the money has gone.
 * ⟨GPT Sol, DPN-15.⟩
 *
 * **The first fix was a latch and the second was two-party; this one holds all
 * three.** Announcing an arrival is not the same as being *at* the entry when
 * the others get there, so `arrive` **holds its caller** (DPN-20). But holding
 * only the two load steps and then releasing them before driving the book left
 * the same hole one party over: with another job holding the third queue slot,
 * both released loads could finish their measured step before the book ever
 * reached `hierarchy`, and the outcome still said `"all"`. ⟨GPT Sol, DPN-20-R.⟩
 *
 * **So there are two waits, and only the second one opens the gate.**
 *
 * 1. `waitFor(2, …)` — **readiness**. Both load steps are at the entry and still
 *    held; nothing has been bought for the book, which has not been driven or
 *    even queued. A readiness wait that does not end `"all"` is where the run
 *    stops: `loadReadiness`.
 * 2. `wait(…)` — **the gate**. The book is driven, reaches the same entry through
 *    the same hook, and all three are released together.
 *
 * **The book does arrive inside its own claim, and that is sound rather than a
 * concession.** Its `hierarchy` needs 658-778 s against a 740 s deadline and can
 * give up none of it — but by the time it is driven, everybody else is already
 * waiting *for it*, so its own wait is one microtask. The two load steps are the
 * ones that really hold, inside their claims, and what they pay is in `held`.
 *
 * **It gives up rather than hanging, and lets go when it does.** A load job that
 * fails before its measured step never arrives, so a wait ends on the jobs
 * settling or on a deadline. `wait` opens the gate on every ending it has,
 * because by then the phase is inside it and there is nobody else to let the
 * held steps go; `waitFor` deliberately does not, so the caller's `finally` —
 * `release()` — is the one door out of the readiness phase. Pure but for the
 * clock, so every ending can be exercised.
 *
 * **One deadline for the whole rendezvous, not one per wait.** Two waits with a
 * timeout each would let a held load step spend twice the number on standing
 * still, which is twice as much of a 740 s lease as anyone intended.
 *
 * **And the gate says which of the two happened.** A step let go by a gate that
 * *gave up* must not simply carry on: the phase is already lost, and a measured
 * step that runs into a lost phase is bought for an answer the report will
 * refuse. So `arrive` resolves to a verdict rather than to nothing, and
 * `abandonStep` is what the caller does with it. The verdict is **latched at the
 * first opening**, because `runPhaseD`'s `finally` calls `release()` on every
 * path including the successful one — a second call must not turn a gate that
 * opened on all three into an abandonment under three running steps.
 */
export function startRendezvous(opts: {
  expected: number;
  timeoutMs: number;
  now?: () => number;
}): {
  /**
   * Called by a held step. Resolves when the gate opens, to `"go"` if it opened
   * on everybody and `"abandoned"` if it gave up — `abandonStep`.
   */
  arrive: (slug: string) => Promise<GateVerdict>;
  /** Wait for the first `n` parties WITHOUT opening the gate. The readiness wait. */
  waitFor: (n: number, abandonIf: Promise<unknown>) => Promise<RendezvousOutcome>;
  /** Wait for all of them, then open the gate and say what it saw. */
  wait: (abandonIf: Promise<unknown>) => Promise<RendezvousOutcome>;
  /** The failure door: release whoever is held, abandoned, for a phase that will never wait. */
  release: () => void;
  /**
   * **Every slug this gate actually turned away**, which is not the same set as
   * the `held` snapshot in an outcome: that is taken as the outcome is built, so
   * a step arriving *after* the gate closed is missing from it. The run named the
   * abandoned jobs off that snapshot and left a late arrival refused and
   * unexplained. The gate is the only thing that knows, so the gate says.
   * ⟨GPT Sol, DPN-28.⟩ Read it after the jobs have drained.
   */
  turnedAway: () => string[];
} {
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const deadlineAt = startedAt + opts.timeoutMs;
  const arrived: string[] = [];
  const waiting: { slug: string; at: number }[] = [];
  const turnedAway: string[] = [];

  /* **A resolver per threshold**, because two waits want two different counts:
     the readiness wait wants the load steps and the gate wants everybody. */
  const thresholds: { n: number; hit: () => void }[] = [];
  const reached = (n: number): Promise<"all"> => {
    if (arrived.length >= n) return Promise.resolve("all");
    return new Promise<"all">((resolve) => {
      thresholds.push({ n, hit: () => resolve("all") });
    });
  };

  let openedAt: number | null = null;
  let openGate: (verdict: GateVerdict) => void = () => undefined;
  const gate = new Promise<GateVerdict>((resolve) => {
    openGate = resolve;
  });
  /* **Latched, not merely idempotent.** `wait` opens the gate and the caller's
     `finally` opens it again with `"abandoned"`, and the second one must move
     neither the clock the first one stamped nor the verdict it gave — three
     steps released to run must not be told afterwards that they were
     abandoned. */
  const open = (verdict: GateVerdict): void => {
    if (openedAt !== null) return;
    openedAt = now();
    openGate(verdict);
  };

  const outcome = (needed: number, why: RendezvousOutcome["why"]): RendezvousOutcome => ({
    arrived: [...arrived],
    expected: opts.expected,
    needed,
    /* `arrived.length` rather than `why`: a job that reached the entry in the
       same tick as the last one settled must not be reported as missing. */
    why: arrived.length >= needed ? "all" : why,
    ms: now() - startedAt,
    /* Computed here rather than in the released continuations, which do not run
       until after this object has been built. A step that arrives after the gate
       opened waited for nothing, and must not report a negative. */
    held: waiting.map((w) => ({ slug: w.slug, ms: Math.max(0, (openedAt ?? now()) - w.at) })),
  });

  const until = async (n: number, abandonIf: Promise<unknown>): Promise<RendezvousOutcome["why"]> => {
    let timer: NodeJS.Timeout | undefined;
    const alarm = new Promise<"timed out">((resolve) => {
      timer = setTimeout(() => resolve("timed out"), Math.max(0, deadlineAt - now()));
    });
    const why = await Promise.race([
      reached(n),
      alarm,
      abandonIf.then(() => "jobs finished first" as const),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    return why;
  };

  return {
    arrive(slug: string): Promise<GateVerdict> {
      if (!arrived.includes(slug)) arrived.push(slug);
      waiting.push({ slug, at: now() });
      for (const t of thresholds) if (arrived.length >= t.n) t.hit();
      /* Recorded as the verdict reaches this caller rather than from a snapshot
         taken earlier, so a step that arrives after the gate closed is counted
         among the refused — DPN-28. */
      return gate.then((verdict) => {
        if (verdict === "abandoned" && !turnedAway.includes(slug)) turnedAway.push(slug);
        return verdict;
      });
    },
    async waitFor(n: number, abandonIf: Promise<unknown>): Promise<RendezvousOutcome> {
      return outcome(n, await until(n, abandonIf));
    },
    async wait(abandonIf: Promise<unknown>): Promise<RendezvousOutcome> {
      const why = await until(opts.expected, abandonIf);
      const out = outcome(opts.expected, why);
      /* **The verdict is the outcome's own `why`**, computed before the gate
         opens so that a party arriving in the last tick still counts. Only a
         gate that really opened on everybody says `"go"`. */
      open(out.why === "all" ? "go" : "abandoned");
      return out;
    },
    release: () => open("abandoned"),
    turnedAway: () => [...turnedAway],
  };
}

/**
 * **The phrase that marks a step this eval stopped on purpose**, so it can be
 * told at a glance from one that failed on its own merits.
 *
 * **It does not survive in the step's `error`, and that is measured rather than
 * feared.** The thrown error carries it, but the queue replaces a failed step's
 * message with a reader-facing sentence before it is stored — a `--dry-run` on
 * 2026-09-05 forced this path and found `"Extracting the article did not
 * finish…"` in `stepOutcomes[].error`, with no marker anywhere in it. That is
 * the same trap `checkDriving` was written around, met a second time.
 *
 * So the marker's real home is the **finding `runPhaseD` puts on the job's own
 * record**, which nothing rewrites and which reaches `run.json` and the closing
 * findings block. The constant is shared so the two say the same words.
 */
export const ABANDONED_MARKER = "ABANDONED AT THE START RENDEZVOUS";

/**
 * **Should this released step run, or stop before it spends?**
 *
 * The gate can open without everybody at the entry — the book failing to get a
 * claim slot inside the deadline is the likeliest way, and on a shared box that
 * is closer to the expected case than to the tail. Every measured step that runs
 * after that is bought for an answer question 5 will refuse: three windows are
 * what it needs, and this phase no longer has them. On the book that is $7.40 of
 * a $40.90 run. So the step throws **before** `step.run`, having bought nothing.
 * ⟨Greg, 2026-09-05, after round 5 left this as the last known money-waster.⟩
 *
 * **Two guards, and neither is negotiable.**
 *
 * - `"go"` never throws. A gate that opened on everybody is the phase working.
 * - `--dry-run` never throws. Its jobs already stop at their last free step and
 *   fail (`stepsFor`); a second way to fail them proves nothing and would make
 *   the rehearsal's output a worse guide to the paid run's, which is the only
 *   thing the rehearsal is for.
 *
 * Returns the error rather than throwing it, so both answers can be watched
 * without a step, a job or a database.
 */
export function abandonStep(opts: {
  verdict: GateVerdict;
  dryRun: boolean;
  slug: string;
  step: string;
}): Error | null {
  if (opts.verdict === "go") return null;
  if (opts.dryRun) return null;
  return new Error(
    `${ABANDONED_MARKER}: \`${opts.step}\` on ${opts.slug} was released by a start rendezvous that ` +
      "GAVE UP rather than opening on all three, so this eval stopped it before it ran and it " +
      "bought nothing. The three measured windows cannot now overlap, so question 5 is " +
      "unanswerable whatever this step did — running it would have spent money on an answer the " +
      "report would then refuse to quote. This job's `error` is this eval's doing, not the " +
      "pipeline's.",
  );
}

/**
 * **May the book be driven at all?** — asked of the readiness wait, before the
 * book is queued and before a penny of it is spent.
 *
 * Phase D used to drive it unconditionally. So both load jobs could fail before
 * `hierarchy`, the readiness wait end `"jobs finished first"` with their DPN-18
 * findings already on the record, and the run then buy the book's whole wave
 * into a phase that could not answer the only question that pass exists for.
 * Question 1 is phases A and B only; **the phase-D book pass is for question 5
 * and nothing else**, and question 5 needs three windows open at one instant. No
 * load steps at the entry, no question 5, so no reason to buy it.
 * ⟨GPT Sol, DPN-23.⟩
 *
 * Pure, so the refusal can be watched without a database.
 */
export function loadReadiness(ready: RendezvousOutcome): {
  go: boolean;
  findings: DeepenFinding[];
} {
  if (ready.why === "all") return { go: true, findings: [] };
  return {
    go: false,
    findings: [
      {
        kind: "not-answerable",
        fatal: true,
        message:
          `Phase D: only ${ready.arrived.length} of ${ready.needed} load step(s) reached the entry ` +
          `to the measured step (the wait ended "${ready.why}" after ${(ready.ms / 1000).toFixed(1)}s). ` +
          "The book's pass under load was NOT DRIVEN and NOT BOUGHT: it exists to answer question 5, " +
          "question 5 needs all three measured windows open at one instant, and with the load steps " +
          "gone that is no longer possible. Question 5 is absent, not zero, and the phase-D book " +
          "repeat is missing from the driving.",
      },
    ],
  };
}

/* --------------------------------------- a job that stopped, and what it left -- */

/**
 * **Two ways a paid job can stop having lost the evidence it was bought for**,
 * turned into findings so that `stopIfCompromised` can see them.
 *
 * That function reads findings and only findings, so anything not made into one
 * is, to the run, a clean job — and the next phase is purchased over it.
 *
 * 1. **A terminal status that is not `done`** (DPN-18). A phase-B `hierarchy`
 *    writes valid deepening records and then label generation throws; the job
 *    ends `error`, `driveJob` records that, and phase C is bought anyway.
 * 2. **`done`, deepening on, and no records file** (DPN-19). `saveDeepenRecords`
 *    swallows filesystem and hard-link failures on purpose — instrumentation
 *    must not fail a reader's article — and `readRecordsDir` then returns `[]`,
 *    which `driveJob` printed as "nobody asked". But **"nobody asked" and "asked
 *    and the record was lost" are different facts**, and questions 1-3 are
 *    computed entirely out of those records. This is the seam where the two got
 *    confused. ⟨GPT Sol, DPN-18/DPN-19.⟩
 *
 * **`--dry-run` is exempt from the first**, and that is the rehearsal's shape
 * rather than an excuse: its step list stops at `extract`, so the article never
 * publishes and the job is *expected* to end at its last free step
 * (`stepsFor`). It never turns deepening on, so the second cannot arise.
 *
 * A requeued job is left to its own finding, which already says the thing that
 * matters about it — that re-claiming it would buy the whole wave again.
 *
 * Pure, and separate from `driveJob`, so every one of these can be watched
 * without a database — tests/deepen-eval.test.ts.
 */
export function jobIntegrityFindings(opts: {
  label: string;
  dryRun: boolean;
  requeued: boolean;
  status: JobStatus | undefined;
  deepenFlag: boolean;
  hasRecords: boolean;
}): DeepenFinding[] {
  if (opts.dryRun) return [];
  const findings: DeepenFinding[] = [];
  if (!opts.requeued && opts.status !== "done") {
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message:
        `${opts.label}: the job stopped at \`${opts.status ?? "unknown"}\` rather than \`done\`. ` +
        "Whatever it bought before it stopped is on the ledger, but this job did not finish the " +
        "steps the run was buying it for, so nothing measured over it is a whole measurement and " +
        "no later phase may be purchased on top of it.",
    });
  }
  /* **Only on a job that finished**, and that is DPN-27 rather than caution.
     "The records were LOST" is a claim about something having been asked for,
     and a job that ended `error` may have failed before `hierarchy` ran at all —
     a step this eval abandoned at the rendezvous never runs, so it never
     requests anything. Saying "lost" over that is inventing the very fact DPN-19
     was about not inventing, one branch further on. The status finding above
     already says the job did not finish; the missing file is its consequence.
     ⟨GPT Sol, DPN-27.⟩ */
  if (opts.status === "done" && opts.deepenFlag && !opts.hasRecords) {
    findings.push({
      kind: "no-records",
      fatal: true,
      message:
        `${opts.label}: deepening was ON and no records file was written — the records were LOST, ` +
        "not never asked for. `saveDeepenRecords` swallows filesystem and hard-link failures on " +
        "purpose, so this reads downstream as `nobody asked`; it is not. Questions 1-3 are " +
        "computed out of these records and are short by this whole pass.",
    });
  }
  return findings;
}

/* ------------------------------------------------- the requeue, refused -- */

/**
 * **Should the driver claim this job again, or stop?**
 *
 * `advanceJobWith` answers `{done: false, busy: false}` both when there is more
 * to do and when the claimant has just **handed the job back at its own 740 s
 * deadline** — `requeues` is the only thing that tells them apart
 * (src/jobs.ts § `pauseForDeadline`).
 *
 * And the difference is money. On a pass whose slug is named in
 * `SPIDERYARN_DEEPEN_REASK`, the next claim skips the expansion checkpoint read
 * and **buys the whole wave again**; `REQUEUE_BUDGET = 2` permits three windows,
 * so one nominal pass of the book could buy its wave three times, none of it in
 * the printed estimate. ⟨GPT Sol reviewing the stage-5b harness, DPN-07.⟩
 *
 * An ordinary pass is re-driven and must be: a book's `hierarchy` step needs
 * 658–778 s against a 740 s deadline, so a requeue there is routine, and without
 * the lever the re-drive resumes every answer it has already paid for.
 *
 * Pure, so both answers can be exercised rather than only the one this machine
 * happens to give.
 */
export function requeueVerdict(opts: {
  reasking: boolean;
  /**
   * **Is question 5 timing this job's step?** Then a re-drive is not merely
   * expensive, it is a lie: the second attempt takes the rendezvous's *latched*
   * verdict and returns at once, so it runs outside the gate beside whatever its
   * siblings are doing — and the queue replaces the first attempt's clock
   * (src/jobs.ts § `runStep`), so what is left is a plausible-looking pass whose
   * duration omits the attempt that was actually lined up. ⟨GPT Sol, DPN-25.⟩
   */
  measured: boolean;
  requeuesBefore: number;
  requeuesNow: number;
}): "stop" | "carry on" {
  if (!opts.reasking && !opts.measured) return "carry on";
  return opts.requeuesNow > opts.requeuesBefore ? "stop" : "carry on";
}

/**
 * **Why this run refused to re-drive a job the claimant handed back**, in the
 * words of whichever of the two reasons applied — and both can.
 *
 * - **Re-asking** is about money (DPN-07). The next claim would ignore the
 *   checkpoint rows this attempt just wrote and buy the whole wave again, and
 *   `REQUEUE_BUDGET` permits three such windows, none of them in the estimate.
 * - **Measured** is about evidence (DPN-25). The retry takes the start
 *   rendezvous's *latched* verdict and returns at once, so it runs outside the
 *   gate; the queue then replaces the first attempt's clock, and what is left is
 *   a question-5 pass that looks ordinary and whose duration omits the attempt
 *   that was actually lined up.
 *
 * Pure, so both halves of the sentence can be watched being written.
 */
export function requeueFinding(opts: {
  label: string;
  slug: string;
  window: number;
  windows: number;
  reasking: boolean;
  measured: boolean;
}): DeepenFinding {
  return {
    kind: "requeued",
    fatal: true,
    message:
      `${opts.label}: the claimant handed this job back at its own deadline (requeue window ` +
      `${opts.window} of ${opts.windows}). This run STOPPED rather than re-claiming it. ` +
      (opts.reasking
        ? `${REASK_ENV} still named ${opts.slug}, so the next claim would ignore the checkpoint ` +
          "rows this one just wrote and buy the whole wave again, and the budget permits three " +
          "such windows. "
        : "") +
      (opts.measured
        ? "Question 5 is timing this job's measured step, and a re-drive would take the start " +
          "rendezvous's LATCHED verdict — running outside the gate, beside whatever its siblings " +
          "were doing — while the queue replaced this attempt's clock. The pass that came back " +
          "would look ordinary and its duration would omit the attempt that was lined up. "
        : "") +
      "The job is left `queued`, the article and the job are RETAINED rather than cleaned up, " +
      "and no later job in this run can publish over that slug. This pass is partial and must " +
      "not be quoted.",
  };
}

/* ---------------------------------------------- one fate, three measured jobs -- */

/**
 * **The invariant phase D was missing, and the fifth time it was missing it.**
 *
 * Four separate guards had already been fitted for four separate ways of buying
 * something the run already knew it could not use, and here was a fifth: the
 * three measured jobs were driven concurrently and *drained* together, and
 * nothing else passed between them. Load 1's `hierarchy` could fail on its
 * structure call while the book and load 2 went on admitting expansion and label
 * calls — for a question 5 that could no longer reach three usable completions.
 * ⟨GPT Sol, DPN-26.⟩
 *
 * So rather than a fifth guard, the rule those four are instances of:
 *
 * > **The three measured jobs share one fate, and none of them starts more paid
 * > work after any of them has lost it.**
 *
 * Anything that puts three usable completions out of reach loses it: a measured
 * step that failed, a wave that fell back to wave 1, a claim handed back at the
 * deadline.
 *
 * **What this can and cannot do**, because the whole of DPN-29 is that these
 * claims must be exact — and the first version of this paragraph got it wrong,
 * which is DPN-30. It has two halves, and the second exists because the first
 * was not enough:
 *
 * - **Before each claim**, `lost()` refuses: no further step and no re-drive.
 * - **Inside a running claim**, `signal` cancels. One claim runs the *whole*
 *   `hierarchy` step — structure call, expansion wave **and a full pass of
 *   labels**, which `generateHierarchy` starts even after the wave failed — so
 *   "stops starting" was true of steps and false of calls, and up to ~$10.80 of
 *   phase D could still be bought after question 5 was lost.
 *
 * What remains uncancelled is **the single request already in flight**, which
 * may still be billed by the provider. That is the honest bound; it is not "a
 * whole label pass", which is what this used to say.
 *
 * The first reason is kept because the first reason is the cause; the ones after
 * it are consequences, and a report that quoted the last would name the wrong
 * job.
 */
export interface PhaseFate {
  /** Say the phase is lost, and why. Only the first reason is kept. */
  lose: (why: string) => void;
  /** The reason this phase can no longer answer, or `null` while it still can. */
  lost: () => string | null;
  /**
   * **Aborts the instant the fate is first lost**, and never otherwise.
   *
   * This is the half that reaches *inside* a claim, and it exists because
   * stopping before the next claim was not enough (DPN-30). One claim runs the
   * whole `hierarchy` step, and that step buys a structure call, an expansion
   * wave **and a whole pass of labels** — `generateHierarchy` catches a failed
   * wave and falls straight through to `generateLabels` regardless
   * (src/hierarchy.ts § the `deepenFailed` catch). So a sibling could *begin* an
   * entire label pass after question 5 was already unanswerable.
   *
   * `announcing` combines this into the measured step's `ctx.signal`, and `src/`
   * already threads that signal where it needs to go — **read rather than
   * assumed**: label batches are queued *with* it (`src/labels.ts` §
   * `queue.add(…, { signal })`), so an abort drops the ones that have not
   * started; the wave's own calls carry it through `liveExpansionExecutor`; and
   * `src/hierarchy-deepen.ts` § `DeepenOptions.signal` says of it *"cuts short a
   * wait, never a call in flight"*, which is exactly the bound to quote.
   *
   * **Only a lost fate aborts.** `ctx.signal` keeps doing its own job beside it.
   */
  signal: AbortSignal;
}

export function startPhaseFate(): PhaseFate {
  let why: string | null = null;
  const controller = new AbortController();
  return {
    lose(reason: string): void {
      if (why !== null) return;
      why = reason;
      /* Aborting inside the same guard is what makes "lost" and "cancelled" one
         fact rather than two that can drift apart. */
      controller.abort(new Error(`Phase D was already lost: ${reason}`));
    },
    lost: () => why,
    signal: controller.signal,
  };
}

/**
 * **Does this job's ending lose the phase for its siblings, or is it the
 * rehearsal ending the way a rehearsal ends?**
 *
 * The fate used to be disarmed wholesale under `--dry-run`, and for a good
 * reason: every rehearsal job is *expected* to fail at its last free step, so
 * the first one to do so would stop its siblings and the rehearsal would stop
 * being a faithful shape of the paid run — the one thing it is for
 * (docs/postmortems/260905b-…-clean-run-over-zero-jobs.md). But that also meant
 * the free run could never show the one thing DPN-26 and DPN-30 are about: a
 * live failure reaching its siblings. ⟨Greg, 2026-09-05.⟩
 *
 * The distinction that lets both be true: **the expected ending is a failure at
 * the last step this job was asked to run.** A failure earlier in the list, a
 * requeue, or a wave that fell back are real failures even in a rehearsal, and
 * lose the phase there too.
 *
 * Pure, so the rehearsal's own ending can be watched *not* losing it.
 */
export function fateReason(opts: {
  label: string;
  dryRun: boolean;
  status: JobStatus | undefined;
  requeued: boolean;
  waveFailed: boolean;
  /** The step that errored, where one did. */
  failedStep: StepName | null;
  /** The steps this job was asked to run, in order. */
  steps: readonly StepName[];
}): string | null {
  if (opts.requeued) {
    return `${opts.label} handed its claim back at its own deadline and was not re-driven`;
  }
  if (opts.waveFailed) return `${opts.label}'s deepening wave fell back to wave 1`;
  if (opts.status === "done") return null;
  /* The rehearsal's expected ending, and only that: publishing needs a tree and
     a tree needs a model call, so a free job fails at the end of its list. */
  const last = opts.steps.at(-1) ?? null;
  if (opts.dryRun && opts.failedStep !== null && opts.failedStep === last) return null;
  return `${opts.label} ended \`${opts.status ?? "unknown"}\` rather than \`done\``;
}

/* ------------------------------------------------- the checkpoint file -- */

/**
 * **One writer at a time, and a temporary name nobody else can hold.**
 *
 * Phase D drives three jobs concurrently and every one of them checkpoints, so
 * two calls could interleave on a single `run.json.<pid>.tmp`: both write it,
 * both rename it, and one legal ordering leaves the second rename with
 * `ENOENT`. That rejection travelled out of `driveJob`, through `Promise.all`,
 * and took the whole phase down by the path DPN-06 is about.
 * ⟨GPT Sol, DPN-09.⟩
 *
 * The unique name fixes the rename; the chain fixes the *contents*, which is
 * the half a unique name alone would leave broken: the object being serialised
 * is mutated by the jobs still running, so two concurrent `JSON.stringify`s of
 * it are two different documents and the loser is written second.
 */
export function checkpointWriter(finalPath: string, snapshot: () => unknown): () => Promise<void> {
  let writing: Promise<void> = Promise.resolve();
  return () => {
    const mine = writing.then(async () => {
      const temp = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temp, `${JSON.stringify(snapshot(), null, 2)}\n`, "utf-8");
      await rename(temp, finalPath);
    });
    /* The chain must survive a rejection, or one failed write wedges every
       later checkpoint — and the caller is still told about its own. */
    writing = mine.catch(() => undefined);
    return mine;
  };
}

/* --------------------------------------------------------- the seam, proved -- */

/** What the free seam probe watched happen. */
export interface SeamProof {
  /** Calls bought on a cold store. */
  cold: number;
  /** Calls bought on a repeat with the lever off — must be 0. */
  repeatWithoutReask: number;
  /** Calls bought on a repeat with the lever naming this slug — must equal `cold`. */
  repeatWithReask: number;
  /** Reads the re-asking pass made of the deepening namespace — must be 0. */
  readsWhileReasking: number;
  /** Every checkpoint namespace the deepening path touched, across all three passes. */
  namespaces: string[];
}

/**
 * **The three things the probe has to have seen**, as a function so a test can
 * hand it a wrong answer and watch it refuse.
 */
export function assertSeamProof(proof: SeamProof): void {
  if (proof.cold === 0) {
    throw new Error(
      "The seam probe bought no calls at all on a cold store, so it proves nothing about " +
        "re-asking. Either the frontier stopped selecting the probe's headed section or the fake " +
        "executor is not being reached.",
    );
  }
  if (proof.repeatWithoutReask !== 0) {
    throw new Error(
      `The seam probe bought ${proof.repeatWithoutReask} call(s) on an ordinary repeat, so the ` +
        "expansion checkpoint is not resuming. Without that, `resumed` cannot distinguish a " +
        "genuine repeat from a cold one, and a re-asking run proves nothing by contrast.",
    );
  }
  if (proof.repeatWithReask !== proof.cold) {
    throw new Error(
      `The seam probe bought ${proof.repeatWithReask} call(s) with the re-ask lever on and ` +
        `${proof.cold} cold. A repeat must buy every call again or its verdicts are the stored ` +
        "ones and the stability measurement is circular.",
    );
  }
  if (proof.readsWhileReasking !== 0) {
    throw new Error(
      `The re-asking pass made ${proof.readsWhileReasking} checkpoint read(s). The lever skips ` +
        "the read rather than reading and discarding, deliberately, so that `found` cannot " +
        "report rows nobody used. src/hierarchy-deepen.ts § REASK_ENV.",
    );
  }
  if (proof.namespaces.some((n) => n !== "hierarchy-deepen")) {
    throw new Error(
      `The deepening path touched ${proof.namespaces.join(", ")}. It must touch ` +
        "`hierarchy-deepen` and nothing else — the structure checkpoint being left alone is what " +
        "holds the seed constant across repeats, and it is the half of the mechanism that would " +
        "otherwise be taken on trust.",
    );
  }
}

/* ------------------------------------------------------------ the records -- */

/**
 * **The one format this harness can read.**
 *
 * Pinned as a literal rather than derived, because the point of the version is
 * to refuse an older file: `deepen-records/1` has no `range` on its candidates,
 * and a harness that read one anyway would fall back to pairing on `where` —
 * the ordinal path — and report a boundary that moved as a verdict that held.
 * `deepen-records/3` is refused for the same shape of reason and not the same
 * reason: its `stats` has no `missingQuestions`, so reading one here would turn
 * *the question had not been invented yet* into *the model answered every one*.
 */
export const RECORDS_VERSION: DeepenRecordsFile["version"] = "deepen-records/4";

/** One records file, read back with its shape checked rather than cast. */
export function parseRecordsFile(raw: string, where: string): DeepenRecordsFile {
  const value = JSON.parse(raw) as Partial<DeepenRecordsFile>;
  if (value.version !== RECORDS_VERSION) {
    throw new Error(
      `${where} says version ${JSON.stringify(value.version ?? null)}, and this harness reads ` +
        `${JSON.stringify(RECORDS_VERSION)}. The format moved; read src/hierarchy-deepen.ts ` +
        "§ DeepenRecordsFile before reading any number out of it. `deepen-records/1` in " +
        "particular carries no `range` on its candidates, and pairing repeats without one is " +
        "exactly the mistake this harness refuses to make; `deepen-records/3` has no " +
        "`missingQuestions` on its stats, and an absent field would read as a question that " +
        "nothing failed to answer.",
    );
  }
  if (typeof value.slug !== "string" || !Array.isArray(value.records) || value.stats === undefined) {
    throw new Error(`${where} is not a deepening records file: slug, stats or records is missing.`);
  }
  return value as DeepenRecordsFile;
}

/**
 * **Every records file in the directory that this run's process wrote, newest
 * last.**
 *
 * `saveDeepenRecords` names files `<slug>-<stamp>-<pid>-<n>.json` and accumulates
 * rather than overwriting, which is what makes repeats comparable — so the way
 * to attribute a file to a phase is to list the directory before and after, and
 * that is what the runner does with `since`.
 *
 * **`slug` is a filter on the NAME, not only on the contents.** Phase D has
 * three jobs writing into one directory, and this used to parse every new file
 * before asking whose it was: a parse failure on a sibling's file rejected the
 * whole read, marked the *asking* job fatal and left its own `recordsFiles`
 * empty. ⟨GPT Sol, DPN-14.⟩ Both halves matter, and the name is the cheap one —
 * the writer's atomic publication (`src/hierarchy-deepen.ts § saveDeepenRecords`)
 * is what makes a file that IS ours whole when we open it.
 */
export async function readRecordsDir(
  dir: string,
  opts: { slug?: string; since?: ReadonlySet<string> } = {},
): Promise<{ file: string; parsed: DeepenRecordsFile }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const prefix = opts.slug === undefined ? null : `${recordsFilePrefix(opts.slug)}-`;
  const wanted = names
    .filter((n) => n.endsWith(".json"))
    .filter((n) => opts.since === undefined || !opts.since.has(n))
    .filter((n) => prefix === null || n.startsWith(prefix));
  const out: { file: string; parsed: DeepenRecordsFile }[] = [];
  for (const name of wanted) {
    const parsed = parseRecordsFile(await readFile(path.join(dir, name), "utf-8"), name);
    /* The name is a filter, the contents are the authority: a slug long enough
       to be truncated in the filename could share a prefix with another. */
    if (opts.slug !== undefined && parsed.slug !== opts.slug) continue;
    out.push({ file: name, parsed });
  }
  return out.sort(byWhenWritten);
}

/**
 * **How `saveDeepenRecords` spells a slug into a filename**, and the one place
 * this harness is allowed to know it.
 *
 * A second copy of a rule about names is how a filter silently stops matching,
 * so it is one exported function with a test rather than an inline regex — and
 * it stays deliberately *loose*: it is a prefilter, and the parsed `slug` is
 * still what decides. src/hierarchy-deepen.ts § `saveDeepenRecords`.
 */
export function recordsFilePrefix(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "article";
}

/**
 * **Order by what the file says, not by its name.**
 *
 * The names end `-<pid>-<n>.json` with `n` a counter, so a lexical sort puts the
 * tenth pass between the first and the second. Repeat order is the whole
 * ordering question 1 is asked in, and `writtenAt` is the file's own answer to
 * it; the name is the tie-break for two passes inside one millisecond.
 */
export function byWhenWritten(
  a: { file: string; parsed: DeepenRecordsFile },
  b: { file: string; parsed: DeepenRecordsFile },
): number {
  return (
    a.parsed.writtenAt.localeCompare(b.parsed.writtenAt) || a.file.length - b.file.length ||
    a.file.localeCompare(b.file)
  );
}

export async function listRecordsDir(dir: string): Promise<Set<string>> {
  try {
    return new Set(await readdir(dir));
  } catch {
    return new Set();
  }
}

/* --------------------------------------------------------- the tree digest -- */

/**
 * **A digest of a published tree that two runs can be compared on.**
 *
 * Key-sorted, so a JSON key order that moved for a reason nothing here cares
 * about does not read as a changed tree — the comparison is about the nodes,
 * their titles, their gists and their ranges, and that is what a sorted
 * serialisation captures. It is the strictest comparison available without
 * hashing the stored bytes, and the stored bytes are not something this process
 * can reach through the artefact reader.
 */
export function treeDigest(tree: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify(canonical(tree))).digest("hex");
}

/* ---------------------------------------------------------------- the bill -- */

/**
 * **What each kind of job in this run is expected to cost**, with where each
 * number came from. Not a measurement: a run has to print an estimate *before*
 * it buys anything, and an estimate with no provenance is a number somebody will
 * quote back later as a measurement.
 *
 * Every figure is an **upper bound**, and the reason is worth stating: the
 * plan's $8.40 is a **four-wave** cascade over Moby-Dick's whole tree, and stage
 * 5b buys **one** wave over the mechanically selected fat sections. So the real
 * bill should come in under this, and if it does not, that is itself question
 * 4's answer.
 */
export interface EstimateRow {
  what: string;
  jobs: number;
  usdEach: number;
  basis: string;
}

export const ESTIMATE_BASIS: Readonly<Record<string, EstimateRow>> = {
  bookIngestDeepened: {
    what: "book, full ingest, deepening on",
    jobs: 0,
    usdEach: 8.4,
    basis:
      "the plan's costed table (§ It costs about eight times more on a book, 2026-09-04): $8.4 " +
      "for a 296-call four-wave cascade. Stage 5b buys ONE wave, so this is an upper bound.",
  },
  bookHierarchyRepeat: {
    what: "book, forced hierarchy, structure + labels resumed",
    jobs: 0,
    usdEach: 7.4,
    basis:
      "$8.4 less the $1.00 structure call the checkpoint resumes (same table). Labels resume too " +
      "wherever the deepened tree comes out the same, so this is an upper bound twice over.",
  },
  articleIngestDeepened: {
    what: "ordinary article, full ingest",
    jobs: 0,
    usdEach: 3.4,
    basis:
      "evals/cost/run.ts records ~$3.40 for a `long-html` (186-block) ingest, measured 2026-09-03. " +
      "The plan says an ordinary article's wave is 'a fraction' of a book's; nothing is measured, " +
      "so nothing is added. **One of these runs with the flag off** — phase C's first pass, which " +
      "is the byte-identical baseline — and that costs the same, because on an article where " +
      "nothing is eligible the wave makes no call either way. That equality is the thing phase C " +
      "is measuring, so it is an assumption here and a result there.",
  },
  articleHierarchyResumed: {
    what: "ordinary article, forced hierarchy, everything resumed",
    jobs: 0,
    usdEach: 0.1,
    basis:
      "the inertness pass: structure and labels both resume and no section is eligible, so the " +
      "expectation is zero. $0.10 is headroom for a label batch the deepened tree re-cut.",
  },
};

export interface CostEstimate {
  rows: EstimateRow[];
  /** The nominal bill: one purchase of each row. */
  totalUsd: number;
  /**
   * **What this run would cost if every re-asking pass bought its wave in all
   * three of its permitted windows** — the *three-window requeue exposure*, one
   * named risk rather than the run's worst case, which nothing computes because
   * nothing caps it.
   *
   * The nominal total was printed as an "upper bound" and was not one. A
   * claimant that reaches its own 740 s deadline inside the `hierarchy` step
   * requeues the job (src/jobs.ts § `REQUEUE_BUDGET`, which permits three
   * windows), and the driver used to re-claim it immediately — with the slug
   * still named in `SPIDERYARN_DEEPEN_REASK`, so the next claim ignored the
   * checkpoint rows just written and bought the wave again. One nominal pass
   * could therefore buy the book's wave three times, and none of it appeared in
   * the estimate. ⟨GPT Sol reviewing the stage-5b harness, DPN-07.⟩
   *
   * **The run refuses that exposure rather than only naming it**: `driveToDone`
   * stops a re-asking pass on its first requeue and makes it a fatal finding
   * instead of re-driving it. `worstCaseUsd` is what the same run would have
   * cost without that refusal, kept and printed because a risk nobody can see is
   * a risk nobody checks.
   *
   * **What it is not is a bound on the bill**, and saying it was overclaimed:
   * nothing in this harness enforces a spend cap, an ordinary pass can re-buy
   * work whose checkpoint write failed, and a redraw buys a second answer.
   * ⟨GPT Sol, DPN-16.⟩
   */
  worstCaseUsd: number;
  bound: string;
  caveat: string;
}

/** Rows whose wave is re-bought by the re-ask lever — the ones a requeue could multiply. */
const REASKING_ROWS: readonly (keyof typeof ESTIMATE_BASIS)[] = ["bookHierarchyRepeat"];

export function estimate(counts: Readonly<Record<keyof typeof ESTIMATE_BASIS, number>>): CostEstimate {
  const keys = Object.keys(ESTIMATE_BASIS) as (keyof typeof ESTIMATE_BASIS)[];
  const rows = keys
    .map((key) => ({ ...ESTIMATE_BASIS[key]!, jobs: counts[key] ?? 0 }))
    .filter((row) => row.jobs > 0);
  const totalUsd = rows.reduce((sum, r) => sum + r.jobs * r.usdEach, 0);
  /* Three windows per re-asking pass is what `REQUEUE_BUDGET = 2` permits, so
     the unenforced worst case is three purchases of every re-asking row. */
  const exposure = REASKING_ROWS.reduce(
    (sum, key) => sum + (counts[key] ?? 0) * ESTIMATE_BASIS[key]!.usdEach * 2,
    0,
  );
  return {
    rows,
    totalUsd,
    worstCaseUsd: totalUsd + exposure,
    bound:
      `$${totalUsd.toFixed(2)} is the NOMINAL ESTIMATE — one purchase of each row — and ` +
      `$${(totalUsd + exposure).toFixed(2)} is the THREE-WINDOW REQUEUE EXPOSURE: what the same ` +
      "run would cost if every re-asking pass were re-claimed at its own 740s deadline and bought " +
      "its wave in each of the three windows `REQUEUE_BUDGET = 2` permits. This run stops a " +
      "re-asking pass on its first requeue and reports it fatally (evals/deepen/run.ts § " +
      "driveToDone), so it does not buy that exposure. " +
      "**NEITHER FIGURE IS A BOUND, AND NOTHING HERE ENFORCES A CAP.** No dollar or token limit " +
      "refuses a call at $N. An ordinary, non-re-asking pass can requeue and re-buy any answer " +
      "whose best-effort checkpoint write failed; a redraw buys a second answer to the same " +
      "question; and every per-row figure is the plan's arithmetic rather than a limit anything " +
      "checks against. Watch the bill.",
    caveat:
      "Every per-row figure is an upper bound on ONE purchase of that row, derived from the plan's " +
      "own arithmetic rather than measured — it is not a bound on how many purchases the run " +
      "makes, which is the sentence above. The run's own `run.json` carries what it really cost. " +
      "If the real bill lands far under this, that is question 4 answering itself; if it lands " +
      "over, stop and read why before repeating.",
  };
}

export function formatEstimate(e: CostEstimate): string {
  const lines = e.rows.map(
    (r) =>
      `  ${String(r.jobs).padStart(2)} x ${r.what.padEnd(56)} $${r.usdEach.toFixed(2).padStart(6)} each   ` +
      `$${(r.jobs * r.usdEach).toFixed(2).padStart(7)}`,
  );
  lines.push(`  ${"".padEnd(61)}   NOMINAL ESTIMATE   $${e.totalUsd.toFixed(2).padStart(7)}`);
  lines.push(
    `  ${"".padEnd(61)}   three-window requeue exposure   $${e.worstCaseUsd.toFixed(2).padStart(7)}`,
  );
  lines.push("");
  for (const r of e.rows) lines.push(`  - ${r.what}: ${r.basis}`);
  lines.push(`  ${e.bound}`);
  lines.push(`  ${e.caveat}`);
  return lines.join("\n");
}
