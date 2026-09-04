/**
 * Ask OpenRouter, immediately before spending, whether each arm's model really
 * has the effort its arm asks for.
 *
 * **The table in `arms.ts` is a handwritten copy, and the test that guards it
 * compares that copy against itself.** `FIELD_EFFORT` being present in
 * `Candidate.supportedEfforts` proves the two literals agree; both live in one
 * file, so a transcription slip or a catalogue that moved since 2026-09-03
 * passes every test in the repo. GPT Sol's review, finding 2.
 *
 * What makes that dangerous rather than untidy is the failure mode on the other
 * end. OpenRouter does not reject an effort a model lacks — it maps the request
 * onto the nearest level the model does have. So an arm labelled `low` against
 * a model whose ladder is `max, high, low` would run, bill, and be written into
 * a results file at whatever level it actually got, with the response carrying
 * nothing to say so. A wrong number that looks exactly like a right one.
 *
 * So the catalogue is asked at run time, the answer is archived into `run.json`
 * beside the results (`effortCatalogue`), and a mismatch stops the run before
 * the first call. GET-only and its own file for the reason verify-costs.ts
 * gives: the spend scan rightly forbids a raw fetch inside a declared-bypass
 * file, and this one buys no inference.
 */

import type { ArmSpec } from "./arms.js";

/** What the catalogue says about one model's reasoning, archived verbatim. */
export interface EffortRecord {
  model: string;
  /** `reasoning.supported_efforts` as returned, or null if the record had none. */
  supportedEfforts: string[] | null;
  defaultEffort: string | null;
  /** True when the model cannot have reasoning turned off. */
  mandatory: boolean | null;
}

interface ModelRecord {
  id?: string;
  reasoning?: {
    supported_efforts?: string[];
    default_effort?: string;
    mandatory?: boolean;
  } | null;
}

/**
 * The credential is read here rather than passed in, and that is not a style
 * choice: `tests/no-undeclared-spend.test.ts` scans by name, so a caller that
 * merely fetched the key to hand it over would itself be flagged as a file that
 * can reach a paid provider — correctly, since the scan cannot tell handing a
 * key over from spending with it. Keeping it inside the one allow-listed file
 * keeps the runner clean of credentials, which is also where it should be.
 */
function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "the preflight cannot reach OpenRouter: no credential is configured. " +
        "The runner loads .env.local at its own edge (src/messages-stream.ts § loadEnvLocal).",
    );
  }
  return key;
}

export async function catalogue(key: string): Promise<Map<string, EffortRecord>> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`the model catalogue answered ${res.status}`);
  const json = (await res.json()) as { data?: ModelRecord[] };
  const out = new Map<string, EffortRecord>();
  for (const m of json.data ?? []) {
    if (!m.id) continue;
    out.set(m.id, {
      model: m.id,
      supportedEfforts: m.reasoning?.supported_efforts ?? null,
      defaultEffort: m.reasoning?.default_effort ?? null,
      mandatory: m.reasoning?.mandatory ?? null,
    });
  }
  return out;
}

/**
 * The rule, as a value so a test can exercise every branch without a network.
 *
 * A model whose record lists **no** efforts is deliberately allowed through:
 * plenty of reasoning models publish no ladder, and refusing them would ban a
 * whole class of candidate on the strength of a missing field. What is refused
 * is the case that can silently lie — a ladder that exists and does not contain
 * the value we are about to send.
 */
export function effortVerdict(
  arm: string,
  model: string,
  effort: string,
  record: EffortRecord | undefined,
): string | null {
  if (!record) return `${arm}: OpenRouter's catalogue has no record for ${model} at all`;
  const efforts = record.supportedEfforts;
  if (efforts === null || efforts.length === 0) return null;
  if (efforts.includes(effort)) return null;
  return (
    `${arm}: asks ${model} for effort "${effort}", which its catalogue record does not list ` +
    `(${efforts.join(", ")}; default "${record.defaultEffort ?? "?"}"). OpenRouter maps an ` +
    `unsupported level onto the nearest one it has rather than refusing it, so this would run, ` +
    `bill, and be written down as "${effort}" while measuring something else. Fix the arm or the ` +
    `CANDIDATES table in arms.ts — the table is a copy of this catalogue and may have gone stale.`
  );
}

/**
 * Check every paid arm about to run, and hand back what the catalogue said so
 * the runner can archive it. Throws on the first real mismatch rather than
 * collecting them: nothing has been spent yet, and one wrong arm means the
 * table needs re-reading anyway.
 */
export async function preflightEfforts(arms: readonly ArmSpec[]): Promise<EffortRecord[]> {
  const wanted = arms.flatMap((a) =>
    a.kind === "one-call"
      ? [{ arm: a.name, model: a.call.model, effort: a.call.effort }]
      : a.kind === "waves"
        ? [{ arm: a.name, model: a.call.model, effort: a.call.effort }]
        : a.kind === "revise"
          ? [
              { arm: a.name, model: a.propose.model, effort: a.propose.effort },
              { arm: a.name, model: a.revise.model, effort: a.revise.effort },
            ]
          : [],
  );
  if (wanted.length === 0) return [];
  const cat = await catalogue(apiKey());
  const problems = wanted
    .map((w) => effortVerdict(w.arm, w.model, w.effort, cat.get(w.model)))
    .filter((p): p is string => p !== null);
  if (problems.length > 0) throw new Error(`preflight refused this run:\n  ${problems.join("\n  ")}`);
  return [...new Set(wanted.map((w) => w.model))].flatMap((m) => {
    const r = cat.get(m);
    return r ? [r] : [];
  });
}
