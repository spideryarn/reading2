/**
 * Check that a finished run's challenger calls were actually served under zero
 * data retention.
 *
 *   npx tsx evals/hierarchy-structure/verify-zdr.ts evals/results/hierarchy-structure/<run-dir>
 *
 * **`provider: { zdr: true }` on the way out is a request, not a fact.** The
 * rule that governs everything about OpenRouter routing in this repo is that
 * accepting a request is never evidence of honouring a field — a made-up
 * top-level key comes back 200 with no complaint
 * (src/messages-stream.ts § MESSAGES_PROVIDER). So the write-up is not allowed
 * to say "measured under ZDR" on the strength of what was sent. This asks the
 * other end: every call records the upstream that served it
 * (`CallStats.upstream`), and `GET /api/v1/endpoints/zdr` is OpenRouter's own
 * list of which providers serve which model with no retention. If the upstream
 * that answered is not on that list for that model, the constraint was not
 * applied and the run does not describe a recipe we are allowed to ship.
 *
 * It also prints who served each arm, which is the other half of the story: a
 * model with one zero-retention provider has that provider's latency and no
 * other, and a number quoted without the name belongs to nobody.
 *
 * **GET-only, and its own file**, for the reason verify-costs.ts gives at
 * length: the spend scan forbids a raw fetch inside a declared-bypass file, so
 * a post-run reconciliation cannot live in model-arms.ts. This one can name the
 * endpoint because it is on that scan's allow-list, and it buys no inference.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { isMain } from "../../src/is-main.js";
import { loadEnvLocal } from "../../src/env.js";
import { parseJsonFrom } from "../../src/parse-json.js";
import type { ArmSpec } from "./arms.js";
import type { CallStats } from "./model-arms.js";

/**
 * **Read from the run, never from today's `arms.ts`.**
 *
 * The first version of this file imported `ARMS` and looked each result's arm
 * up by name. A run is an artefact that outlives the code that made it: rename
 * an arm, repoint it at another model, or drop its ZDR policy, and the verifier
 * would then skip the old calls or check them against a model they never used —
 * and still exit 0, because it counted only the calls it happened to check.
 * `run.json` serialises the arm specs it ran; those are the authority.
 * GPT Sol's review, finding 3.
 */
interface RunLike {
  arms: ArmSpec[];
  expected?: { arm: string; slug: string }[];
  completedAt?: string;
  results: { arm: string; slug: string; outcome?: string; calls?: CallStats[] }[];
}

/** `model_id` → the set of provider names OpenRouter lists as zero-retention. */
export async function zdrProvidersByModel(key: string): Promise<Map<string, Set<string>>> {
  const res = await fetch("https://openrouter.ai/api/v1/endpoints/zdr", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`the ZDR endpoint listing answered ${res.status}`);
  const json = (await res.json()) as { data?: { model_id?: string; provider_name?: string }[] };
  const map = new Map<string, Set<string>>();
  for (const e of json.data ?? []) {
    if (!e.model_id || !e.provider_name) continue;
    const set = map.get(e.model_id) ?? new Set<string>();
    set.add(e.provider_name);
    map.set(e.model_id, set);
  }
  return map;
}

/**
 * The verdict for one call, as a value so a test can exercise the rule without
 * a network. `null` upstream is its own failure and not a pass by default:
 * an unknown server is exactly the case this file exists to refuse.
 */
export function zdrVerdict(
  model: string,
  upstream: string | null,
  zdr: Map<string, Set<string>>,
): { ok: boolean; why: string } {
  const allowed = zdr.get(model);
  if (!allowed || allowed.size === 0) {
    return { ok: false, why: `OpenRouter lists no zero-retention endpoint for ${model} at all` };
  }
  if (upstream === null) {
    return { ok: false, why: `the response named no upstream, so nothing can be checked` };
  }
  if (!allowed.has(upstream)) {
    return {
      ok: false,
      why: `served by ${upstream}, which is not among this model's ${allowed.size} zero-retention providers ` +
        `(${[...allowed].slice(0, 6).join(", ")}${allowed.size > 6 ? ", …" : ""})`,
    };
  }
  return { ok: true, why: `served by ${upstream}` };
}

async function main(): Promise<void> {
  loadEnvLocal();
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const runDir = process.argv[2];
  if (!runDir) {
    console.error("Usage: tsx evals/hierarchy-structure/verify-zdr.ts <run-dir>");
    process.exit(1);
  }
  const file = path.join(runDir, "run.json");
  const run = parseJsonFrom<RunLike>(await readFile(file, "utf-8"), file);

  /* An incomplete run is refused before anything is checked, because the
     dangerous reading of a partial panel is the one where the arms that failed
     hardest are simply absent and the survivors get quoted as the result. */
  if (!run.completedAt) {
    console.error(
      `${file} has no completedAt: the run did not finish every cell it set out to fill` +
        (run.expected ? ` (${run.expected.length} expected, ${run.results.length} recorded)` : "") +
        `. Nothing from it may be quoted; re-run it.`,
    );
    process.exit(1);
  }

  const zdr = await zdrProvidersByModel(key);

  /* Only the arms that ASKED for it are checked, and the arms come from the
     run's own record. The incumbent deliberately does not ask (production does
     not), and holding it to a constraint it never sent would invent a failure. */
  const asked = new Map(
    (run.arms ?? []).flatMap((a) =>
      a.kind === "one-call" && a.call.provider?.zdr ? [[a.name, a.call.model] as const] : [],
    ),
  );

  let failures = 0;
  let checked = 0;
  for (const r of run.results) {
    const model = asked.get(r.arm);
    if (!model) continue;
    const calls = r.calls ?? [];
    if (calls.length === 0) {
      /* A cell with no calls is either a routing refusal (which billed nothing
         and is the arm's recorded outcome) or a gap. Both are worth printing;
         only the second is a failure of this check, and `outcome` says which. */
      const why =
        r.outcome === "threw"
          ? "no call recorded — the arm failed before a model answered"
          : "no call recorded, and the cell does not say it failed";
      console.log(`${r.outcome === "threw" ? "·" : "✗"} ${r.arm.padEnd(16)} ${r.slug.slice(0, 30).padEnd(32)} ${why}`);
      if (r.outcome !== "threw") failures++;
      continue;
    }
    for (const call of calls) {
      checked++;
      const v = zdrVerdict(model, call.upstream, zdr);
      if (!v.ok) failures++;
      console.log(`${v.ok ? "✓" : "✗"} ${r.arm.padEnd(16)} ${r.slug.slice(0, 30).padEnd(32)} ${v.why}`);
    }
  }

  if (checked === 0) {
    console.error("\nNo call in this run asked for zero data retention — nothing to verify.");
    process.exit(1);
  }
  /**
   * **"Consistent with", not "confirmed".** GPT Sol's finding 5, and it is the
   * right correction: the response's provider label and the ZDR listing both
   * come from OpenRouter's own control plane, so they would agree with each
   * other even if both were wrong; the listing is read at verification time
   * rather than call time, so a provider newly marked ZDR can retrospectively
   * bless an older call; and a provider name does not identify *which* of that
   * provider's endpoints served the call, while OpenRouter says retention
   * policy is endpoint-specific. What this proves is that the routing records
   * agree with the request. That is worth having and is not proof of
   * non-retention.
   */
  console.log(
    `\n${checked - failures}/${checked} calls served by an upstream OpenRouter lists as ` +
      `zero-retention for that model — consistent with the routing we asked for, which is ` +
      `the strongest thing checkable from outside.`,
  );
  if (failures > 0) {
    console.error(
      `${failures} were not. The run does not describe a recipe we are allowed to ship, ` +
        `and no figure from those arms may be quoted as a ZDR measurement.`,
    );
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
