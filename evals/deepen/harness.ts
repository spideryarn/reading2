/**
 * **The mechanisms stage 5b needs that the cost eval did not**, kept apart from
 * the driving so each can be watched failing without a database, a network or a
 * model — tests/deepen-eval.test.ts.
 *
 * Everything the two evals share is **imported** from evals/cost/harness.ts
 * rather than copied: the eval spend overlay, the fixture stage-1 step, the
 * in-process pump silencer and the local-database gate. What is here is only
 * what is new:
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
import type { CostFixture } from "../cost/fixtures.js";

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
  requeuesBefore: number;
  requeuesNow: number;
}): "stop" | "carry on" {
  if (!opts.reasking) return "carry on";
  return opts.requeuesNow > opts.requeuesBefore ? "stop" : "carry on";
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
 */
export const RECORDS_VERSION: DeepenRecordsFile["version"] = "deepen-records/2";

/** One records file, read back with its shape checked rather than cast. */
export function parseRecordsFile(raw: string, where: string): DeepenRecordsFile {
  const value = JSON.parse(raw) as Partial<DeepenRecordsFile>;
  if (value.version !== RECORDS_VERSION) {
    throw new Error(
      `${where} says version ${JSON.stringify(value.version ?? null)}, and this harness reads ` +
        `${JSON.stringify(RECORDS_VERSION)}. The format moved; read src/hierarchy-deepen.ts ` +
        "§ DeepenRecordsFile before reading any number out of it. `deepen-records/1` in " +
        "particular carries no `range` on its candidates, and pairing repeats without one is " +
        "exactly the mistake this harness refuses to make.",
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
  const wanted = names
    .filter((n) => n.endsWith(".json"))
    .filter((n) => opts.since === undefined || !opts.since.has(n));
  const out: { file: string; parsed: DeepenRecordsFile }[] = [];
  for (const name of wanted) {
    const parsed = parseRecordsFile(await readFile(path.join(dir, name), "utf-8"), name);
    if (opts.slug !== undefined && parsed.slug !== opts.slug) continue;
    out.push({ file: name, parsed });
  }
  return out.sort(byWhenWritten);
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
   * **What this run could cost if every re-asking pass bought its wave twice**,
   * and the sentence that says whether that can happen.
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
   * **The run enforces the bound now rather than only naming it**: `driveToDone`
   * stops a re-asking pass on its first requeue and makes it a fatal finding
   * instead of re-driving it. `worstCaseUsd` is what the same run would have
   * cost without that refusal, kept and printed because a bound nobody can see
   * is a bound nobody checks.
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
      `The nominal total is $${totalUsd.toFixed(2)}. Without the requeue refusal it would be a ` +
      `floor, not a bound: a re-asking pass that hands its claim back at its own 740s deadline ` +
      `used to be re-claimed with the slug still named in the re-ask lever, buying the wave again ` +
      `— three windows per pass, so up to $${(totalUsd + exposure).toFixed(2)}. This run STOPS a ` +
      "re-asking pass on its first requeue and reports it fatally (evals/deepen/run.ts § " +
      "driveToDone), so each pass buys its wave at most once and the nominal total is the bound. " +
      "What it is not is a cap on the run: nothing here refuses a call at $N, and the per-row " +
      "figures are the plan's arithmetic rather than a limit anything enforces.",
    caveat:
      "Every per-row figure is an UPPER BOUND derived from the plan's own arithmetic, not a " +
      "measurement, and the run's own `run.json` carries what it really cost. If the real bill " +
      "lands far under this, that is question 4 answering itself; if it lands over, stop and read " +
      "why before repeating.",
  };
}

export function formatEstimate(e: CostEstimate): string {
  const lines = e.rows.map(
    (r) =>
      `  ${String(r.jobs).padStart(2)} x ${r.what.padEnd(56)} $${r.usdEach.toFixed(2).padStart(6)} each   ` +
      `$${(r.jobs * r.usdEach).toFixed(2).padStart(7)}`,
  );
  lines.push(`  ${"".padEnd(61)}   TOTAL   $${e.totalUsd.toFixed(2).padStart(7)}`);
  lines.push(
    `  ${"".padEnd(61)}   worst case, were a requeue re-driven   $${e.worstCaseUsd.toFixed(2).padStart(7)}`,
  );
  lines.push("");
  for (const r of e.rows) lines.push(`  - ${r.what}: ${r.basis}`);
  lines.push(`  ${e.bound}`);
  lines.push(`  ${e.caveat}`);
  return lines.join("\n");
}
