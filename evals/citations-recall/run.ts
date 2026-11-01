/**
 * **Which model and prompt find every work an article cites, and at what cost**
 * — plan docs/plans/261101a-citations-every-work-cheaply-with-haiku.md, write-up
 * docs/investigations/261101a-citations-recall-haiku-vs-sonnet-prompt-eval.md.
 *
 *   npx tsx evals/citations-recall/run.ts <arm> <run> [slug …]     # paid: one call an article
 *   npx tsx evals/citations-recall/score.ts                        # free: reads what this wrote
 *
 * Arms (see `ARMS`): S0/H0 send production's `citations/7` prompt to Sonnet 5.5
 * and Haiku 5.5; H1/H2/S1 send the candidate (./prompt.ts) at medium, high and
 * medium. It uses production's article text (`articleWithIds` over every
 * block), schema and PDF reference-list construction. The arms vary the model,
 * effort, prompt (system and user turn), and `max_tokens` (the candidate gets
 * the model's whole 128K). Unlike a production job that shares an article-cache
 * group, every eval call deliberately omits `cache_control` so its cost is cold.
 *
 * **What it writes**: one raw answer a slug under
 * `evals/results/citations-recall/261101a/<arm>-<run>/`, never over an existing
 * one, plus the `ai_calls` row each call records in the local ledger. Scoring is
 * separate and free, so the matching rule can change without paying again.
 *
 * LeCun's article lives only in production; it is read from the gitignored
 * `data/evals/261101a/lecun-article.json` (a read-only export), with no PDF
 * reference list — 261027b's fix refuses the one production would have found
 * (a numbered table with no years), so production sends none either.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "../../src/env.js";
import type { NumberedReferenceList } from "../../src/citation-reference-list.js";

export const OUT = path.join(import.meta.dirname, "..", "results", "citations-recall", "261101a");
export const LECUN = "10356-a-path-towards-autonomous-mach-spya-jwqnrf";
export const LECUN_FILE = path.join(import.meta.dirname, "..", "..", "data", "evals", "261101a", "lecun-article.json");

export const SLUGS = [
  "arxiv-2308-08708-spya-w598t3",
  LECUN,
  "jmlr-v15-srivastava14a-spya-sd3uzs",
  "arxiv-1706-03762v7-spya-wv4w9s",
  "fd-src-s41598-023-33209-9-spya-hxekgz-spya-pwtq9e",
  "clark-chalmers-1998-spya-uwb4tn",
  "synesthesia-spya-xkeccf",
] as const;

export const SONNET = "anthropic/claude-sonnet-5.5";
export const HAIKU = "anthropic/claude-haiku-5.5";

type Effort = "medium" | "high" | "xhigh";
export interface Arm {
  model: string;
  prompt: "today" | "candidate";
  effort: Effort;
}
export const ARMS: Record<string, Arm> = {
  S0: { model: SONNET, prompt: "today", effort: "medium" },
  H0: { model: HAIKU, prompt: "today", effort: "medium" },
  H1: { model: HAIKU, prompt: "candidate", effort: "medium" },
  H2: { model: HAIKU, prompt: "candidate", effort: "high" },
  S1: { model: SONNET, prompt: "candidate", effort: "medium" },
  /* Added after the first runs: high effort was what moved Haiku, with wide spread. */
  H3: { model: HAIKU, prompt: "candidate", effort: "xhigh" },
};

export interface RawResult {
  slug: string;
  arm: string;
  run: number;
  model: string;
  effort: Effort;
  prompt: Arm["prompt"];
  systemSha256: string;
  maxTokens: number;
  at: string;
  elapsedMs: number;
  stopReason: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  referenceList: NumberedReferenceList | null;
  /** The model's answer text, or null when the call failed (then `error`). */
  answer: string | null;
  error?: string;
  /** What OpenRouter billed for this article's call(s), from the spend collector. */
  dollars?: number;
  /** How many network attempts that was. */
  calls?: number;
}

/**
 * **A PDF's reference list, read the way src/pipeline.ts § pdfReferenceList
 * reads it**, or null. Shared with score.ts, which re-reads it rather than
 * trusting the result file: the list's entries are a `Map`, which JSON flattens
 * to `{}`. Call inside `runAsOwner`.
 */
export async function referenceListFor(slug: string, source: string | undefined): Promise<NumberedReferenceList | null> {
  if (source !== "pdf") return null;
  const store = await import("../../src/store/index.js");
  const stored = await store.loadSource(slug);
  if (stored === null || stored.kind !== "pdf") return null;
  const { pass0, pageLines } = await import("../../src/pdf.js");
  const { MAX_PAGES } = await import("../../src/uploads.js");
  const { referenceListFrom } = await import("../../src/citation-reference-list.js");
  const pass = await pass0(stored.bytes, { maxPages: MAX_PAGES });
  return pass.isScan ? null : referenceListFrom(pass.pages.flatMap((p) => pageLines(pass, p.page)));
}

export function resultPath(arm: string, run: number, slug: string): string {
  return path.join(OUT, `${arm}-${run}`, `${slug}.json`);
}

async function main(): Promise<void> {
  const [armName, runArg, ...rest] = process.argv.slice(2);
  const arm = armName ? ARMS[armName] : undefined;
  const run = Number(runArg);
  if (!arm || !armName || !Number.isInteger(run) || run < 1) {
    throw new Error(`usage: run.ts <${Object.keys(ARMS).join("|")}> <run ≥ 1> [slug …]`);
  }
  const slugs = rest.length > 0 ? rest : [...SLUGS];

  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const store = await import("../../src/store/index.js");
  const { closeDb } = await import("../../src/db/client.js");
  const { systemPrompt, renderPrompt, BIBLIOGRAPHY_OUTPUT_SCHEMA, answerEstimate } = await import("../../src/bibliography.js");
  const { articleWithIds } = await import("../../src/article-prompt.js");
  const { referenceListText } = await import("../../src/citation-reference-list.js");
  const { withMessagesJsonSchema } = await import("../../src/messages-structured-output.js");
  const { streamMessage } = await import("../../src/messages-stream.js");
  const { budgetFor, MODEL_MAX_TOKENS } = await import("../../src/token-budget.js");
  const { referenceListPrompt } = await import("../../src/bibliography.js");
  const { collectSpend, totalSpend } = await import("../../src/ai-spend.js");
  const { costStore } = await import("../../src/store/ai-calls.js");
  const { candidateSystem, CANDIDATE_USER } = await import("./prompt.js");

  const system = arm.prompt === "today" ? systemPrompt() : candidateSystem();
  const user = arm.prompt === "today" ? renderPrompt() : CANDIDATE_USER;
  const maxTokens = arm.prompt === "today" ? budgetFor("bibliography", answerEstimate()) : MODEL_MAX_TOKENS;
  const systemSha256 = createHash("sha256").update(system).digest("hex");

  const existing = slugs.map((s) => resultPath(armName, run, s)).filter((f) => fs.existsSync(f));
  if (existing.length > 0) throw new Error(`refusing to overwrite:\n${existing.join("\n")}`);
  fs.mkdirSync(path.dirname(resultPath(armName, run, "x")), { recursive: true });

  await runAsOwner(environmentOwnerId(), async () => {
      /* Every article at once: the calls are independent and the long ones take minutes. */
      await Promise.all(
        slugs.map(async (slug) => {
          type Loaded = { meta: Parameters<typeof articleWithIds>[0] | null; blocks: { id: string; text: string }[] };
          let article: Loaded;
          let referenceList: NumberedReferenceList | null = null;
          if (slug === LECUN) {
            article = JSON.parse(fs.readFileSync(LECUN_FILE, "utf8")) as Loaded;
          } else {
            const loaded = await store.loadArticle(slug);
            article = loaded as unknown as Loaded;
            referenceList = await referenceListFor(slug, loaded.meta?.source);
          }
          const meta = article.meta ?? ({ title: slug } as Parameters<typeof articleWithIds>[0]);
          const started = Date.now();
          const base: Omit<RawResult, "stopReason" | "usage" | "answer" | "elapsedMs"> = {
            slug, arm: armName, run, model: arm.model, effort: arm.effort, prompt: arm.prompt,
            systemSha256, maxTokens, at: new Date().toISOString(), referenceList,
          };
          let record: RawResult | undefined;
          /* Its own spend collector, so the dollars are this call's as OpenRouter billed them,
             retries and failed attempts included (Sol's plan review, 9). No cache_control: cold. */
          const { report } = await collectSpend(async () => { try {
            const call = streamMessage(
              "bibliography",
              withMessagesJsonSchema(
                {
                  max_tokens: maxTokens,
                  thinking: { type: "adaptive" },
                  output_config: { effort: arm.effort },
                  system: [
                    { type: "text" as const, text: articleWithIds(meta, article.blocks) },
                    ...(referenceList === null
                      ? []
                      : [{ type: "text" as const, text: referenceListPrompt(referenceListText(referenceList)) }]),
                    { type: "text" as const, text: system },
                  ],
                  messages: [{ role: "user", content: user }],
                },
                BIBLIOGRAPHY_OUTPUT_SCHEMA,
              ),
              { power: "standard", model: arm.model },
            );
            const message = await call.finalMessage();
            const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
            record = {
              ...base,
              elapsedMs: Date.now() - started,
              stopReason: message.stop_reason,
              usage: {
                input: message.usage.input_tokens,
                output: message.usage.output_tokens,
                cacheRead: message.usage.cache_read_input_tokens ?? 0,
                cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
              },
              answer: text,
            };
          } catch (err) {
            record = {
              ...base,
              elapsedMs: Date.now() - started,
              stopReason: null,
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              answer: null,
              error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
            };
          } }, { attribution: { scopeKind: "eval", ownerId: environmentOwnerId() }, sink: (row) => costStore.record(row) });
          if (!record) throw new Error("unreachable: no record");
          record.dollars = totalSpend(report.calls).nanos / 1e9;
          record.calls = report.calls.length;
          fs.writeFileSync(resultPath(armName, run, slug), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
          console.log(
            `${armName}-${run} ${slug}: ${record.error ?? record.stopReason} · ${record.usage.input} in, ` +
              `${record.usage.output} out · $${record.dollars?.toFixed(4)} · ${Math.round(record.elapsedMs / 1000)}s`,
          );
        }),
      );
  });
  await closeDb();
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) await main();
