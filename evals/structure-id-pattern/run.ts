/**
 * **How should the Structure answer name the block a section starts at?**
 * docs/plans/261020aa-structure-answers-the-block-number-not-its-id.md.
 *
 * Three arms, on production's own request (`wholeDocumentRequest`):
 * - `incumbent` — `toc/12`: the id, as a free string (the prompt and schema
 *   before this change, reconstructed by `toc12System`);
 * - `pattern` — `toc/12` with src/ids.ts's `ID_PATTERN` on `start`;
 * - `line` — production since `toc/13`: the block's number, an integer.
 *
 * ```
 * npx tsx evals/structure-id-pattern/run.ts probe                                   # paid, ~$0.01
 * npx tsx evals/structure-id-pattern/run.ts compile                                 # paid, ~$0.002
 * npx tsx evals/structure-id-pattern/run.ts run --arm <incumbent|pattern> --draws <n> \
 *     --label <label> --file <blocks.json>...                                       # paid
 * npx tsx evals/structure-id-pattern/run.ts tally                                   # free
 * ```
 *
 * `probe` asks for an answer the pattern forbids, so a 200 that obeys the
 * prompt says the constraint never reached the decoder (OpenRouter's docs say
 * nothing about `output_config`, and a pattern that is silently dropped looks
 * exactly like one that works on an answer that happened to be good).
 *
 * `run` sends that request with the arm's prompt and `start` schema. Each `--file` is a JSON
 * `{slug, blocks}` (scripts/eval/skim-inputs-from-production.ts writes one) — a
 * reader's article, so keep the files out of the repo — or a slug in the local
 * database. Every answer's raw text is written beside the `.jsonl`; for a
 * reader's article that text summarises their article, so move those
 * `.raw.txt` files out before committing (the `.jsonl` holds only counts and
 * block positions). Every start in every
 * answer is classified against the body's block ids, and the answer is also
 * built by production's strict parser (the default `"refuse"` policy), so a
 * recovery added in 261019l cannot flatter either arm.
 */

import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import { ID_PATTERN, ID_PREFIX } from "../../src/ids.js";
import { splitBlocks } from "../../src/supplement.js";
import type { Block } from "../../src/types.js";
import { wholeDocumentAnswerFields } from "../paperwork/structure-parse.js";

const OUT = path.join(import.meta.dirname, "..", "results", "structure-id-pattern");

type Arm = "incumbent" | "pattern" | "line";
const ARMS: readonly Arm[] = ["incumbent", "pattern", "line"];
type StartKind = "ok" | "first-child-bad" | "digit-after-prefix" | "well-formed-unknown" | "other";

/** Rewrite every `start` property in a schema; nothing else moves. */
export function withArm(schema: unknown, arm: Arm): unknown {
  if (Array.isArray(schema)) return schema.map((s) => withArm(s, arm));
  if (schema === null || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "properties" && v && typeof v === "object") {
      const props: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(v)) {
        if (name === "start") {
          props[name] = arm === "pattern"
            ? { type: "string", pattern: ID_PATTERN.source }
            : arm === "line" ? { type: "integer" } : { type: "string" };
        } else {
          props[name] = withArm(sub, arm);
        }
      }
      out[k] = props;
    } else {
      out[k] = withArm(v, arm);
    }
  }
  return out;
}

/**
 * The two passages `toc/13` changed: `toc/12`'s words, then `toc/13`'s. Nothing
 * else in the prompt moved, which `toc12System` checks by swapping them back.
 */
const TOC13_SWAPS: readonly [string, string][] = [
  ['Give each child one "start": the id of the first block it covers.',
    'Give each child one "start": the number in square brackets of the first block it\ncovers — for the line "[582] spya-xcf0dz <h1>: …" that is 582, an integer.'],
  ['"start": "<firstBlockId>"', '"start": <firstBlockNumber>'],
];

function swap(system: string, from: 0 | 1): string {
  let out = system;
  for (const pair of TOC13_SWAPS) {
    const [a, b] = [pair[from], pair[1 - from]!];
    if (!out.includes(a)) throw new Error(`the prompt no longer contains ${JSON.stringify(a)}`);
    out = out.replace(a, b);
  }
  return out;
}

/**
 * `toc/12`'s prompt, rebuilt from production's. The `line` arm's runs before the
 * change sent `toc/12` with these swaps applied, so they and production are the
 * same bytes; the round trip throws if that ever stops being true.
 */
export function toc12System(production: string): string {
  const old = swap(production, 1);
  if (swap(old, 0) !== production) throw new Error("toc/12 does not round-trip to production's prompt");
  return old;
}

/** Map every integer `start` back to the id of that numbered block, as production would. */
export function linesToIds(raw: string, body: readonly Block[]): string {
  const parsed = JSON.parse(raw) as { root?: unknown };
  const walk = (node: unknown) => {
    const children = (node as { children?: unknown[] } | null)?.children;
    if (!Array.isArray(children)) return;
    for (const child of children as { start?: unknown }[]) {
      if (typeof child.start === "number") {
        child.start = body[child.start]?.id ?? `out-of-range-${child.start}`;
      }
      walk(child);
    }
  };
  walk(parsed.root);
  return JSON.stringify(parsed);
}

/** Depth-1 starts as block indices (or the raw value when it names no block). */
function topStarts(raw: string, index: ReadonlyMap<string, number>): (number | string)[] | null {
  try {
    const children = (JSON.parse(raw) as { root?: { children?: { start?: unknown }[] } }).root?.children ?? [];
    return children.map((c) => index.get(String(c.start)) ?? String(c.start));
  } catch {
    return null;
  }
}

interface StartSeen {
  where: string;
  kind: StartKind;
}

/** Every child's start, by path, classified against the body's ids. */
export function classifyStarts(raw: string, ids: Set<string>): StartSeen[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const seen: StartSeen[] = [];
  const walk = (node: unknown, where: string) => {
    const children = (node as { children?: unknown[] } | null)?.children;
    if (!Array.isArray(children)) return;
    children.forEach((child, k) => {
      const here = `${where} > ${k}`;
      const start = (child as { start?: unknown }).start;
      let kind: StartKind;
      if (typeof start === "string" && ids.has(start)) kind = "ok";
      else if (k === 0) kind = "first-child-bad";
      else if (typeof start === "string" && /^\d/.test(start.slice(ID_PREFIX.length)) && start.startsWith(ID_PREFIX)) kind = "digit-after-prefix";
      else if (typeof start === "string" && ID_PATTERN.test(start)) kind = "well-formed-unknown";
      else kind = "other";
      seen.push({ where: here, kind });
      walk(child, here);
    });
  };
  walk((parsed as { root?: unknown }).root, "root");
  return seen;
}

async function probe(): Promise<void> {
  loadEnvLocal();
  const { streamMessage } = await import("../../src/messages-stream.js");
  const { withMessagesJsonSchema } = await import("../../src/messages-structured-output.js");
  const schema = {
    type: "object",
    properties: { start: { type: "string", pattern: ID_PATTERN.source } },
    required: ["start"],
    additionalProperties: false,
  };
  const params = withMessagesJsonSchema({
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    messages: [{ role: "user", content: 'Set "start" to exactly the string spya-582xcf0dz, character for character.' }],
  }, schema);
  const message = await streamMessage("structure", params, { power: "standard" }).finalMessage();
  const raw = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  console.log(`stop ${message.stop_reason}; answer ${raw}`);
  const start = (JSON.parse(raw) as { start: string }).start;
  console.log(ID_PATTERN.test(start)
    ? "obeyed: the answer matches the id pattern although the prompt asked for one that does not"
    : "NOT obeyed: the answer broke the pattern");
  /* Obeying could be the model reading the pattern, not the decoder holding
     it. A pattern Anthropic's grammar compiler refuses (a lookahead) tells the
     two apart: a 400 means the pattern is compiled, so it is enforced. The
     body is built by hand because our validator rightly refuses it. */
  try {
    await streamMessage("structure", {
      ...params,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: { ...schema, properties: { start: { type: "string", pattern: "^(?=a)a$" } } } },
      },
    }, { power: "standard" }).finalMessage();
    console.log("lookahead ACCEPTED: the pattern may not reach a grammar compiler");
  } catch (err) {
    console.log(`lookahead REJECTED, so the pattern is compiled: ${String(err).slice(0, 300)}`);
  }
}

/**
 * Production's Structure schema, sent once with a trivial prompt. A schema the
 * grammar compiler refuses is a 400 before any answer; anything else (here
 * `max_tokens`, by design) means it compiled.
 */
async function compile(): Promise<void> {
  const { streamMessage } = await import("../../src/messages-stream.js");
  const { withMessagesJsonSchema } = await import("../../src/messages-structured-output.js");
  const { STRUCTURE_OUTPUT_SCHEMA } = await import("../../src/structure.js");
  try {
    const message = await streamMessage("structure", withMessagesJsonSchema({
      max_tokens: 64,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "Answer with the smallest valid JSON." }],
    }, STRUCTURE_OUTPUT_SCHEMA), { power: "standard" }).finalMessage();
    console.log(`compiled structure (stop ${message.stop_reason})`);
  } catch (err) {
    console.log(`REFUSED structure: ${String(err).slice(0, 300)}`);
    process.exitCode = 1;
  }
}

async function run(arm: Arm, label: string, draws: number, files: string[]): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { wholeDocumentRequest } = await import("../../src/structure.js");
  const { streamMessage, wasRefused } = await import("../../src/messages-stream.js");
  const { collectSpend, totalSpend } = await import("../../src/ai-spend.js");
  const { costStore } = await import("../../src/store/ai-calls.js");
  const { closeDb } = await import("../../src/db/client.js");
  fs.mkdirSync(OUT, { recursive: true });
  const log = path.join(OUT, `${label}.jsonl`);
  const ownerId = environmentOwnerId();
  await runAsOwner(ownerId, async () => {
    const { loadArticle } = await import("../../src/store/index.js");
    await Promise.all(files.map(async (file) => {
      /* A path is a production article read to a file; anything else is a local slug. */
      const { slug, blocks } = file.endsWith(".json")
        ? (JSON.parse(fs.readFileSync(file, "utf8")) as { slug: string; blocks: Block[] })
        : { slug: file, blocks: (await loadArticle(file)).blocks };
      const { body } = splitBlocks(blocks);
      const ids = new Set(body.map((b) => b.id));
      const index = new Map(body.map((b, i) => [b.id, i]));
      /* The authored top-level headings, to say whether each answer starts a part at each. */
      const h1s = body.flatMap((b, i) => (b.tag === "h1" ? [i] : []));
      const { params } = wholeDocumentRequest(body);
      const format = params.output_config?.format as { type: string; schema: unknown };
      const armed = {
        ...params,
        ...(arm === "line" ? {} : { system: toc12System(params.system as string) }),
        output_config: { ...params.output_config, format: { ...format, schema: withArm(format.schema, arm) } },
      };
      for (let i = 0; i < draws; i++) {
        const { result: row, report } = await collectSpend(async () => {
          const base = { label, arm, slug, draw: i, at: new Date().toISOString() };
          try {
            const message = await streamMessage("structure", armed as typeof params, { power: "standard" }).finalMessage();
            const answer = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
            fs.writeFileSync(path.join(OUT, `${label}-${slug}-${i}.raw.txt`), answer);
            if (wasRefused(message) || message.stop_reason === "max_tokens") {
              return { ...base, ok: false, callFailure: message.stop_reason };
            }
            const raw = arm === "line" ? linesToIds(answer, body) : answer;
            const starts = classifyStarts(raw, ids);
            const top = topStarts(raw, index);
            /* Parse the model's original answer so the line arm exercises the
               same integer-to-id conversion as production. `raw` is only the
               common, id-shaped view used by the cross-arm scorers above. */
            const fields = wholeDocumentAnswerFields(answer, blocks, slug);
            const bad = (starts ?? []).filter((s) => s.kind !== "ok");
            return {
              ...base,
              ok: fields.parsed && fields.treeBuilds === true,
              stop: message.stop_reason,
              starts: starts?.length ?? null,
              bad,
              topStarts: top,
              h1s,
              h1sStarted: top === null ? null : h1s.filter((h) => top.includes(h)).length,
              ...fields,
            };
          } catch (err) {
            return { ...base, ok: false, callFailure: String(err) };
          }
        }, { attribution: { scopeKind: "eval", ownerId }, sink: (spend) => costStore.record(spend) });
        const priced = report.calls.length > 0 ? totalSpend(report.calls) : null;
        const measured = {
          ...row,
          thinkingTokens: report.calls.reduce((t, c) => t + (c.reasoningTokens ?? 0), 0),
          outputTokens: report.calls.reduce((t, c) => t + (c.outputTokens ?? 0), 0),
          costUsd: priced && priced.unpriced === 0 ? priced.nanos / 1e9 : null,
          durationMs: report.calls.reduce((t, c) => t + c.ms, 0),
        };
        fs.appendFileSync(log, `${JSON.stringify(measured)}\n`);
        const bad = (measured as { bad?: StartSeen[] }).bad;
        console.log(`${label} ${slug} #${i}: ${measured.ok ? "builds" : "REFUSED"}; bad starts ${bad ? JSON.stringify(bad) : "n/a"}`);
      }
    }));
  });
  await closeDb();
}

function tally(): void {
  if (!fs.existsSync(OUT)) return;
  for (const f of fs.readdirSync(OUT).filter((x) => x.endsWith(".jsonl")).sort()) {
    const rows = fs.readFileSync(path.join(OUT, f), "utf8").trim().split("\n").map((l) => JSON.parse(l) as {
      slug: string; ok: boolean; callFailure?: unknown; bad?: StartSeen[]; starts?: number | null;
      h1s?: number[]; h1sStarted?: number | null;
      depth1Count?: number | null; thinkingTokens: number; costUsd: number | null; durationMs: number;
    });
    for (const slug of [...new Set(rows.map((r) => r.slug))].sort()) {
      const mine = rows.filter((r) => r.slug === slug);
      const answered = mine.filter((r) => r.callFailure === undefined);
      const kinds: Record<string, number> = {};
      for (const r of answered) for (const b of r.bad ?? []) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
      const withBad = answered.filter((r) => (r.bad ?? []).some((b) => b.kind !== "first-child-bad")).length;
      console.log(
        `${f} ${slug}: ${mine.filter((r) => r.ok).length}/${mine.length} build strictly; ` +
        `${withBad}/${answered.length} answers with a bad non-first start; kinds ${JSON.stringify(kinds)}; ` +
        `depth-1 [${answered.map((r) => r.depth1Count).join(", ")}]; ` +
        (answered[0]?.h1s?.length
          ? `h1s started ${answered.map((r) => r.h1sStarted ?? "-").join(",")} of ${answered[0].h1s.length}; `
          : "") +
        `thinking ${answered.reduce((t, r) => t + r.thinkingTokens, 0)}; ` +
        `$${mine.reduce((t, r) => t + (r.costUsd ?? 0), 0).toFixed(2)}; ` +
        `${(mine.reduce((t, r) => t + r.durationMs, 0) / 1000 / Math.max(1, mine.length)).toFixed(0)}s mean` +
        `${mine.length - answered.length ? `; ${mine.length - answered.length} call(s) failed` : ""}`,
      );
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const at = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  if (args[0] === "probe" || args[0] === "compile") {
    loadEnvLocal();
    const { withLedger } = await import("../../src/cli-ledger.js");
    const { closeDb } = await import("../../src/db/client.js");
    await withLedger("eval", args[0] === "probe" ? probe : compile);
    await closeDb();
  }
  else if (args[0] === "tally") tally();
  else if (args[0] === "run") {
    const arm = at("--arm");
    const label = at("--label");
    if (!ARMS.includes(arm as Arm) || !label) throw new Error(`run needs --arm ${ARMS.join("|")} and --label`);
    const files = args.flatMap((a, i) => (args[i - 1] === "--file" ? [a] : []));
    if (files.length === 0) throw new Error("run needs at least one --file");
    await run(arm as Arm, label, Number(at("--draws") ?? "1"), files);
  } else throw new Error("usage: probe | run … | tally");
}
