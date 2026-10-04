/**
 * **Does the starts-only `toc/11` structure answer remain valid in practice?**
 * docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md § Stage 2.
 *
 * ```
 * npx tsx evals/paperwork/structure-parse.ts --label <label> --draws <n> <slug>...   # paid
 * npx tsx evals/paperwork/structure-parse.ts tally                                   # free
 * ```
 *
 * Only the whole-document structure call, `draws` times per article, parsed and
 * built through production's own toc/11 parser/converter. Each answer is one
 * line in `evals/results/paperwork/structure-parse/<label>.jsonl` — the stamp,
 * spend, parse/build outcome and repair counts — and every raw answer is kept
 * beside it. Like evals/paperwork/run.ts the arms are separated in time: run a
 * label on the commit whose prompt it measures.
 */

import type Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import { appendSupplement, splitBlocks } from "../../src/supplement.js";
import { assertTreeSound } from "../../src/tree-invariants.js";
import {
  buildTree,
  estimateStructureTokens,
  parseWholeDocumentAnswer,
  STRUCTURE_HEADROOM,
  type BuildReport,
} from "../../src/structure.js";
import { wasRefused } from "../../src/messages-stream.js";
import { truncationFailure } from "../../src/token-budget.js";
import { MalformedJson } from "../../src/parse-json.js";
import type { Block } from "../../src/types.js";

const OUT = path.join(import.meta.dirname, "..", "results", "paperwork", "structure-parse");

export interface WholeDocumentAnswerFields {
  parsed: boolean;
  treeBuilds: boolean | null;
  droppedChildren: number | null;
  droppedAuthoredHeadings: number | null;
  depth1Count: number | null;
  refusedInventedStart: boolean;
  error?: string;
}

const emptyReport = (): BuildReport => ({
  repairs: [],
  droppedChildren: [],
  rangelessChildren: [],
  droppedHeadings: [],
  collapsedRungs: [],
  droppedQuestions: [],
});

/** Parse, convert and build by the same path production uses, without a model call. */
export function wholeDocumentAnswerFields(
  raw: string,
  blocks: Block[],
  slug: string,
): WholeDocumentAnswerFields {
  const report = emptyReport();
  const { body, groups } = splitBlocks(blocks);
  let depth1Count: number | null = null;
  try {
    const { root } = parseWholeDocumentAnswer(raw, body, report);
    depth1Count = root.children?.length ?? 0;
    const tree = appendSupplement(buildTree(root, {}, body, slug, report), groups);
    assertTreeSound(blocks, tree);
    return {
      parsed: true,
      treeBuilds: true,
      droppedChildren: report.droppedChildren.length,
      droppedAuthoredHeadings: report.droppedHeadings.length,
      depth1Count,
      refusedInventedStart: false,
    };
  } catch (err) {
    const parsed = !(err instanceof MalformedJson);
    const message = err instanceof Error ? err.message : String(err);
    return {
      parsed,
      treeBuilds: parsed ? false : null,
      droppedChildren: parsed ? report.droppedChildren.length : null,
      droppedAuthoredHeadings: parsed ? report.droppedHeadings.length : null,
      depth1Count,
      refusedInventedStart: parsed && /Node range not in blocks\.json.*start/.test(message),
      error: message,
    };
  }
}

/**
 * The text of a whole-document answer, for the two harnesses that hand it straight
 * to production's parser (evals/paperwork/run.ts, evals/plain-words/run.ts) — after
 * the two checks production makes first (`finishedText` in
 * src/messages-stream.ts, which src/structure.ts calls). A refusal or an answer cut off at `max_tokens` can still be
 * text the parser accepts, and would be scored as an ordinary answer.
 */
export function acceptedStructureAnswer(message: Anthropic.Message, body: Block[], maxTokens: number): string {
  const answer = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  if (wasRefused(message)) throw new Error("the model refused the structure call");
  if (message.stop_reason === "max_tokens") {
    throw truncationFailure(
      "table of contents",
      maxTokens,
      estimateStructureTokens(body),
      { outputTokens: message.usage.output_tokens, answerChars: answer.length },
      STRUCTURE_HEADROOM,
    );
  }
  return answer;
}

async function run(label: string, draws: number, slugs: string[]): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { wholeDocumentRequest } = await import("../../src/structure.js");
  const { PROMPT_VERSION } = await import("../../src/structure-prompt.js");
  const { streamMessage, wasRefused } = await import("../../src/messages-stream.js");
  const { collectSpend, totalSpend } = await import("../../src/ai-spend.js");
  const { costStore } = await import("../../src/store/ai-calls.js");
  const { closeDb } = await import("../../src/db/client.js");
  fs.mkdirSync(OUT, { recursive: true });
  const log = path.join(OUT, `${label}.jsonl`);
  const ownerId = environmentOwnerId();
  await runAsOwner(ownerId, async () => {
    await Promise.all(
      slugs.map(async (slug) => {
        const article = await loadArticle(slug);
        const { params } = wholeDocumentRequest(splitBlocks(article.blocks).body);
        for (let i = 0; i < draws; i++) {
          const { result: row, report } = await collectSpend(
            async () => {
              let answer: Record<string, unknown> = {
                label,
                toc: PROMPT_VERSION,
                slug,
                draw: i,
                at: new Date().toISOString(),
              };
              try {
                const message = await streamMessage("structure", params, { power: "standard" }).finalMessage();
                const raw = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
                /* Every answer is kept, including refusals and truncations. */
                const kept = path.join(OUT, `${label}-${slug}-${i}.raw.txt`);
                fs.writeFileSync(kept, raw);
                if (wasRefused(message) || message.stop_reason === "max_tokens") {
                  answer = {
                    ...answer,
                    ok: false,
                    parsed: false,
                    callFailure: wasRefused(message) ? "refusal" : "max_tokens",
                    stop: message.stop_reason,
                    kept: path.basename(kept),
                  };
                } else {
                  const fields = wholeDocumentAnswerFields(raw, article.blocks, slug);
                  answer = {
                    ...answer,
                    ...fields,
                    ok: fields.parsed && fields.treeBuilds === true,
                    stop: message.stop_reason,
                    kept: path.basename(kept),
                  };
                }
              } catch (err) {
                answer = { ...answer, ok: false, parsed: false, callFailure: true, error: String(err) };
              }
              return answer;
            },
            {
              attribution: { scopeKind: "eval", ownerId },
              sink: (spend) => costStore.record(spend),
            },
          );
          const priced = report.calls.length > 0 ? totalSpend(report.calls) : null;
          const sumTokens = (field: "reasoningTokens" | "outputTokens"): number | null =>
            report.calls.length === 0 || report.calls.some((call) => call[field] === null)
              ? null
              : report.calls.reduce((total, call) => total + (call[field] ?? 0), 0);
          const measured: Record<string, unknown> = {
            ...row,
            spendRunId: report.runId,
            thinkingTokens: sumTokens("reasoningTokens"),
            outputTokens: sumTokens("outputTokens"),
            costUsd: priced && priced.unpriced === 0 ? priced.nanos / 1e9 : null,
            durationMs:
              report.calls.length > 0
                ? report.calls.reduce((total, call) => total + call.ms, 0)
                : null,
          };
          fs.appendFileSync(log, `${JSON.stringify(measured)}\n`);
          const state = measured.ok
            ? "ok"
            : measured.callFailure
              ? `FAILED ${String(measured.callFailure)}`
              : measured.parsed
                ? "FAILED build"
                : "FAILED parse";
          console.log(`${label} ${slug} #${i}: ${state}`);
        }
      }),
    );
  });
  await closeDb();
}

function tally(): void {
  for (const f of fs.readdirSync(OUT).filter((x) => x.endsWith(".jsonl")).sort()) {
    const rows = fs.readFileSync(path.join(OUT, f), "utf8").trim().split("\n").map((line) => JSON.parse(line) as {
      ok: boolean;
      parse?: boolean;
      parsed?: boolean;
      toc: string;
      slug?: string;
      treeBuilds?: boolean | null;
      droppedChildren?: number | null;
      droppedAuthoredHeadings?: number | null;
      depth1Count?: number | null;
      refusedInventedStart?: boolean;
      thinkingTokens?: number | null;
      outputTokens?: number | null;
      costUsd?: number | null;
      durationMs?: number | null;
    });
    const hasAnswer = (row: (typeof rows)[number]) => row.parsed !== undefined || row.ok || row.parse === true;
    const summary = (selected: typeof rows): string => {
      const answered = selected.filter(hasAnswer);
      const parsed = answered.filter((row) => row.parsed ?? row.ok);
      const sum = (field: "droppedChildren" | "droppedAuthoredHeadings" | "thinkingTokens" | "outputTokens" | "costUsd" | "durationMs") =>
        selected.reduce((total, row) => total + (row[field] ?? 0), 0);
      const depths = parsed.flatMap((row) => row.depth1Count === null || row.depth1Count === undefined ? [] : [row.depth1Count]);
      return `${answered.length - parsed.length} parse failure(s), ` +
        `${parsed.filter((row) => row.treeBuilds === true || (row.treeBuilds === undefined && row.ok)).length}/${parsed.length} tree(s) built; ` +
        `${sum("droppedChildren")} child(ren) dropped, ${sum("droppedAuthoredHeadings")} authored heading(s) dropped, ` +
        `${selected.filter((row) => row.refusedInventedStart).length} invented-start refusal(s); ` +
        `depth-1 [${depths.join(", ")}]; thinking ${sum("thinkingTokens")}, output ${sum("outputTokens")} tokens, ` +
        `$${sum("costUsd").toFixed(4)}, ${(sum("durationMs") / 1000).toFixed(1)}s ` +
        `(${selected.length - answered.length} call(s) failed before an answer)`;
    };
    console.log(`${f}: ${rows[0]?.toc}: ${summary(rows)}`);
    const slugs = [...new Set(rows.flatMap((row) => row.slug === undefined ? [] : [row.slug]))].sort();
    for (const slug of slugs) {
      console.log(`  ${slug}: ${summary(rows.filter((row) => row.slug === slug))}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === "tally") {
    tally();
  } else {
    const at = (name: string) => args[args.indexOf(name) + 1];
    const label = args.includes("--label") ? at("--label") : undefined;
    const draws = Number(args.includes("--draws") ? at("--draws") : "1");
    const slugs = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
    if (!label || slugs.length === 0 || !(draws > 0)) throw new Error("--label <label> --draws <n> <slug>...  |  tally");
    await run(label, draws, slugs);
  }
}
