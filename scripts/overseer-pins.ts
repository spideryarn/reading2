/**
 * **Print the fingerprint every scheduled job currently has**, so re-pinning is
 * a copy and never a guess.
 *
 * A job's `authorisedHash` is a literal in `standing-jobs.ts` or
 * `rule-jobs.ts`, and it moves whenever the job's BEHAVIOUR does — a prompt, a
 * rule's threshold, or the bytes of a document or an implementation file. That
 * is the gate working. What it costs is that somebody has to know the new
 * number, and reading it out of a refusal on a live daemon is a slow way to find
 * out.
 *
 * **A schedule edit does not move any of these.** Cadence, lease and first-run
 * delay left the fingerprint on 2026-09-09 (GPT Sol's S8-1, which was found by
 * reading the paragraph below and noticing that the plan proposed exactly what
 * it forbids). Editing `tools/overseer/schedules.ts` and re-running this script
 * should print no drift at all; if it does, something other than a schedule
 * changed.
 *
 * **This does not re-pin anything.** It prints, and a person decides. That
 * separation is the whole of `standing-jobs.ts` § THE PIN: an authorisation the
 * authorised party can write is not one, and a script that edited the literal
 * would be exactly that.
 *
 *     npx tsx scripts/overseer-pins.ts
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { behaviourHash } from "../tools/overseer/jobs.js";
import { AUTHORISED_RULE_HASHES, ruleJobs } from "../tools/overseer/rule-jobs.js";
import { AUTHORISED_HASHES, standingJobs } from "../tools/overseer/standing-jobs.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function main(): number {
  const built = [
    ...standingJobs(repoRoot).jobs.map((job) => ({ job, pinned: AUTHORISED_HASHES[job.definition.behaviour.id as keyof typeof AUTHORISED_HASHES] })),
    ...ruleJobs(repoRoot).jobs.map((job) => ({ job, pinned: AUTHORISED_RULE_HASHES[job.definition.behaviour.id as keyof typeof AUTHORISED_RULE_HASHES] })),
  ];
  const problems = [...standingJobs(repoRoot).problems, ...ruleJobs(repoRoot).problems];
  let drifted = 0;
  for (const { job, pinned } of built) {
    const found = behaviourHash(job.definition.behaviour);
    const same = found === pinned;
    if (!same) drifted += 1;
    console.log(`${same ? "  " : "✗ "}${job.definition.behaviour.id.padEnd(22)} pinned ${String(pinned)}  now ${found}`);
  }
  for (const problem of problems) console.log(`✗ ${problem}`);
  if (drifted > 0) console.log(`\n${drifted} job(s) would refuse to dispatch. Read what changed, then copy the "now" hash into its AUTHORISED_* literal.`);
  return drifted === 0 && problems.length === 0 ? 0 : 1;
}

process.exitCode = main();
