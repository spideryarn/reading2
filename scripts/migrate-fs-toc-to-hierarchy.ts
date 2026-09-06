#!/usr/bin/env tsx
/**
 * Move the filesystem store's copies of the step name `toc` to `hierarchy`.
 *
 * The database half of this rename is `drizzle/0041_rename_toc_step_to_hierarchy.sql`.
 * This is the other half, and it exists because **the filesystem store spells the
 * step name into paths and into two JSON ledgers**, none of which a SQL migration
 * can reach:
 *
 * - `data/<slug>/steps/<step>.running` — the interruption marker
 *   (`markerFile`, which lived in src/store/artifacts-fs.ts until it was
 *   deleted 2026-09-05).
 * - `data/<slug>/checkpoints/<namespace>/` — `toc-labels` became `hierarchy-labels`
 *   (`CheckpointNamespace` in src/store/checkpoints.ts).
 * - `data/_jobs/*.json` — `steps[].name`, a `JobStep[]` exactly as `jobs.steps` is.
 * - `data/_ai-calls.jsonl` — `stepName` and `job`, the two fields that become
 *   `ai_calls.step_name` and `ai_calls.purpose` (src/store/ai-calls-fs.ts).
 *
 * **The marker is the one that fails silently, and it is why this script exists
 * rather than a shell one-liner.** `store.interrupted(...)` is the *opening* line
 * of `stepIsDone` (src/pipeline.ts), before the outputs are checked and before the
 * stamp — and this step deliberately has no freshness stamp. Leave a `toc.running`
 * behind and `interrupted("hierarchy")` finds nothing, `has(...)` finds all three
 * outputs, and a step explicitly marked interrupted is reported **done** and
 * skipped. Nothing throws and nothing logs.
 * docs/plans/260831ak-rename-the-toc-step-to-hierarchy-everywhere.md § The marker
 * that turns a rename into a skipped step.
 *
 * **Idempotent**, so it is safe to run twice: every rename is skipped when the
 * source is absent, and refused rather than clobbered when the destination
 * already exists. Run with `--dry-run` to see the list without writing.
 *
 *   npx tsx scripts/migrate-fs-toc-to-hierarchy.ts [--dry-run] [--dir <path>]
 */

import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OLD_STEP = "toc";
const NEW_STEP = "hierarchy";
const OLD_NAMESPACE = "toc-labels";
const NEW_NAMESPACE = "hierarchy-labels";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Plan = { what: string; from: string; to: string };

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dirArg = args.indexOf("--dir");
const dataDir = dirArg === -1 ? path.join(ROOT, "data") : path.resolve(args[dirArg + 1] ?? "");

async function exists(at: string): Promise<boolean> {
  try {
    await stat(at);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function listDir(at: string): Promise<string[]> {
  try {
    return await readdir(at);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** A rename that says what it did, refuses to overwrite, and shrugs at a missing source. */
async function movePath(plan: Plan, done: string[], skipped: string[]): Promise<void> {
  if (!(await exists(plan.from))) return;
  if (await exists(plan.to)) {
    skipped.push(`${plan.what}: ${plan.to} already exists — left ${plan.from} in place`);
    return;
  }
  if (!dryRun) await rename(plan.from, plan.to);
  done.push(`${plan.what}: ${path.relative(ROOT, plan.from)} → ${path.relative(ROOT, plan.to)}`);
}

/** Per article: the interruption marker and the checkpoint namespace directory. */
async function moveArticleState(done: string[], skipped: string[]): Promise<void> {
  for (const entry of await listDir(dataDir)) {
    const slugDir = path.join(dataDir, entry);
    if (!(await stat(slugDir)).isDirectory()) continue;
    await movePath(
      {
        what: "interruption marker",
        from: path.join(slugDir, "steps", `${OLD_STEP}.running`),
        to: path.join(slugDir, "steps", `${NEW_STEP}.running`),
      },
      done,
      skipped,
    );
    await movePath(
      {
        what: "checkpoint namespace",
        from: path.join(slugDir, "checkpoints", OLD_NAMESPACE),
        to: path.join(slugDir, "checkpoints", NEW_NAMESPACE),
      },
      done,
      skipped,
    );
  }
}

/** `data/_jobs/*.json`: `steps[].name`, the same `JobStep[]` shape as `jobs.steps`. */
async function moveJobSteps(done: string[]): Promise<void> {
  const jobsDir = path.join(dataDir, "_jobs");
  for (const file of await listDir(jobsDir)) {
    if (!file.endsWith(".json")) continue;
    const at = path.join(jobsDir, file);
    const job = JSON.parse(await readFile(at, "utf-8")) as { steps?: { name?: string }[] };
    if (!Array.isArray(job.steps)) continue;
    const hits = job.steps.filter((s) => s?.name === OLD_STEP).length;
    if (!hits) continue;
    for (const step of job.steps) if (step?.name === OLD_STEP) step.name = NEW_STEP;
    if (!dryRun) await writeFile(at, `${JSON.stringify(job, null, 2)}\n`, "utf-8");
    done.push(`job steps: ${path.relative(ROOT, at)} (${hits})`);
  }
}

/**
 * `data/_ai-calls*.jsonl`: `stepName` and `job`, which become `ai_calls.step_name`
 * and `ai_calls.purpose`. **Both**, because migrating one leaves a row reading
 * `step_name='hierarchy', job='toc'` and splits one stage's cost history a second way.
 */
async function moveLedger(done: string[]): Promise<void> {
  for (const file of await listDir(dataDir)) {
    if (!file.startsWith("_ai-calls") || !file.endsWith(".jsonl")) continue;
    const at = path.join(dataDir, file);
    const lines = (await readFile(at, "utf-8")).split("\n");
    let changed = 0;
    const out = lines.map((line) => {
      if (!line.trim()) return line;
      const row = JSON.parse(line) as Record<string, unknown>;
      const fields = ["stepName", "job"].filter((f) => row[f] === OLD_STEP);
      if (!fields.length) return line;
      for (const field of fields) row[field] = NEW_STEP;
      changed += 1;
      return JSON.stringify(row);
    });
    if (!changed) continue;
    if (!dryRun) await writeFile(at, out.join("\n"), "utf-8");
    done.push(`ai-call ledger: ${path.relative(ROOT, at)} (${changed} rows)`);
  }
}

async function main(): Promise<void> {
  const done: string[] = [];
  const skipped: string[] = [];
  await moveArticleState(done, skipped);
  await moveJobSteps(done);
  await moveLedger(done);
  console.log(done.length ? `${dryRun ? "would change" : "changed"} ${done.length}:` : "nothing to do");
  for (const line of done) console.log(`  ${line}`);
  for (const line of skipped) console.log(`  SKIPPED ${line}`);
}

await main();
