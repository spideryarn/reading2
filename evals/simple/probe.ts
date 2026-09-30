/**
 * **Simple's stage-1 probe: `medium` against `high`, and a twelve-year-old's
 * pitch against a fifteen-year-old's** —
 * docs/plans/260930i-simple-summaries-eli15-sub-mode.md § Measuring it.
 *
 * ```
 * npx tsx evals/simple/probe.ts list                                       # free: local articles by size
 * npx tsx evals/simple/probe.ts run --arm medium-15 <slug>...              # paid
 * npx tsx evals/simple/probe.ts run --arm high-15   <slug>...              # paid
 * npx tsx evals/simple/probe.ts run --arm medium-12 <slug>...              # paid
 * npx tsx evals/simple/probe.ts report > evals/simple/results-260930.md    # free
 * ```
 *
 * An arm is `<effort>-<pitch>[-<tag>]`; the tag names a prompt revision, since
 * the arms are separated in time, not in code. The effort goes through
 * `SPIDERYARN_PIPELINE_EFFORT`, the whole-run override `effortFor` already
 * reads (src/models.ts), and the pitch through `generateSimpleSummary`'s
 * probe-only `pitch` — so every call is production's own function, and only
 * the one knob named by the arm differs. A hash of src/simple-summary.ts is
 * recorded beside each answer (docs/project/prompting-guide.md § Measuring).
 *
 * A run that fails validation is recorded as a failure with its message, not
 * retried: a failure rate is one of the things this measures.
 *
 * Reads the local database, and writes nothing there beyond one `ai_calls` row
 * per call, through `collectSpend` with an `eval` scope. Output under
 * `evals/results/simple/<arm>/`.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "../../src/env.js";

const OUT = path.join(import.meta.dirname, "..", "results", "simple");
const SOURCE = path.join(import.meta.dirname, "..", "..", "src", "simple-summary.ts");

interface ArmFile {
  arm: string;
  effort: string;
  pitch: number;
  slug: string;
  version: string;
  sourceSha256: string;
  at: string;
  wallMs: number;
  costUsd: number | null;
  tokens: { input: number; output: number; reasoning: number | null } | null;
  bodyWords: number;
  bodyBlocks: number;
  ok: boolean;
  error?: string;
  words?: number;
  paragraphs?: { text: string; ids: string[] }[];
  dropped?: Record<string, number>;
}

async function list(): Promise<void> {
  loadEnvLocal();
  const { getDb, closeDb } = await import("../../src/db/client.js");
  const { sql } = await import("drizzle-orm");
  const rows = await getDb().execute(sql`
    select a.slug, r.title,
           count(b.*)::int as blocks,
           coalesce(sum(b.words), 0)::int as words
      from spideryarn.articles a
      join spideryarn.article_revisions r on r.id = a.current_revision_id
      left join spideryarn.revision_blocks b on b.revision_id = r.id
     group by a.slug, r.title
     order by words desc`);
  for (const r of rows.rows as { slug: string; title: string | null; blocks: number; words: number }[]) {
    console.log(`${String(r.words).padStart(7)} words ${String(r.blocks).padStart(4)} blocks  ${r.slug}  ${r.title ?? ""}`);
  }
  await closeDb();
}

async function run(arm: string, slugs: string[]): Promise<void> {
  const m = /^(low|medium|high|max)-(12|15)(-[\w]+)?$/.exec(arm);
  if (!m) throw new Error("--arm must be <low|medium|high|max>-<12|15>[-<tag>]");
  const effort = m[1]!;
  const pitch = Number(m[2]) as 12 | 15;
  loadEnvLocal();
  process.env.SPIDERYARN_PIPELINE_EFFORT = effort;
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const simple = await import("../../src/simple-summary.js");
  const { isBodyEvidence } = await import("../../src/block-policy.js");
  const { collectSpend } = await import("../../src/ai-spend.js");
  const { costStore } = await import("../../src/store/ai-calls.js");
  const { closeDb } = await import("../../src/db/client.js");
  const sourceSha256 = createHash("sha256").update(fs.readFileSync(SOURCE)).digest("hex");
  fs.mkdirSync(path.join(OUT, arm), { recursive: true });
  await runAsOwner(environmentOwnerId(), async () => {
    await Promise.all(
      slugs.map(async (slug) => {
        const out = path.join(OUT, arm, `${slug}.json`);
        if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${path.relative(process.cwd(), out)}`);
        const article = await loadArticle(slug);
        const body = article.blocks.filter(isBodyEvidence);
        const base = {
          arm,
          effort,
          pitch,
          slug,
          version: simple.SIMPLE_VERSION,
          sourceSha256,
          at: new Date().toISOString(),
          bodyWords: body.reduce((n, b) => n + b.words, 0),
          bodyBlocks: body.length,
        };
        const started = Date.now();
        let file: ArmFile;
        let spent: { costUsd: number | null; tokens: ArmFile["tokens"] } = { costUsd: null, tokens: null };
        const onDone = (report: { calls: { cost: { source: string; costNanos?: number; computedCostNanos?: number }; inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null }[] }) => {
          const c = report.calls[0];
          if (!c) return;
          const nanos = c.cost.source === "provider" ? c.cost.costNanos : c.cost.source === "computed" ? c.cost.computedCostNanos : undefined;
          spent = {
            costUsd: nanos === undefined ? null : nanos / 1e9,
            tokens: { input: c.inputTokens ?? 0, output: c.outputTokens ?? 0, reasoning: c.reasoningTokens },
          };
        };
        try {
          /* `onDone`, not the returned report: it fires on a failed run too, so a
             run that fails validation is still priced. */
          const { result } = await collectSpend(
            () => simple.generateSimpleSummary({ article: { ...article, slug }, pitch }),
            {
              attribution: { scopeKind: "eval", ownerId: environmentOwnerId() },
              sink: (row) => costStore.record(row),
              onDone: (report) => onDone(report as never),
            },
          );
          file = {
            ...base,
            wallMs: Date.now() - started,
            ...spent,
            ok: true,
            words: result.words,
            paragraphs: result.simpleSummary.paragraphs,
            dropped: { ...result.dropped },
          };
        } catch (err) {
          file = {
            ...base,
            wallMs: Date.now() - started,
            ...spent,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
        console.log(
          `${arm} ${slug}: ${file.ok ? `${file.paragraphs?.length} paragraphs, ${file.words} words` : `FAILED ${file.error}`}, ${(file.wallMs / 1000).toFixed(1)}s, $${file.costUsd?.toFixed(4) ?? "?"}`,
        );
      }),
    );
  });
  await closeDb();
}

/** The passages a paragraph names, for reading it against its sources. Free. */
async function show(slug: string, ids: string[]): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { closeDb } = await import("../../src/db/client.js");
  await runAsOwner(environmentOwnerId(), async () => {
    const article = await loadArticle(slug);
    for (const id of ids) {
      const b = article.blocks.find((x) => x.id === id);
      console.log(`--- ${id}\n${b ? b.text : "(no such block)"}\n`);
    }
  });
  await closeDb();
}

function readArms(): ArmFile[] {
  if (!fs.existsSync(OUT)) return [];
  return fs
    .readdirSync(OUT)
    .filter((d) => fs.statSync(path.join(OUT, d)).isDirectory())
    .sort()
    .flatMap((arm) =>
      fs
        .readdirSync(path.join(OUT, arm))
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(fs.readFileSync(path.join(OUT, arm, f), "utf8")) as ArmFile),
    );
}

function report(): void {
  const files = readArms();
  const lines: string[] = [];
  lines.push("| arm | article | body words | ok | wall s | $ | out tokens | words | paras | ids dropped | paras dropped |");
  lines.push("|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const f of files) {
    const d = f.dropped ?? {};
    const idsDropped = (d.unknownIds ?? 0) + (d.duplicateIds ?? 0) + (d.overCap ?? 0);
    const parasDropped = (d.unanchored ?? 0) + (d.empty ?? 0) + (d.malformed ?? 0);
    lines.push(
      `| ${f.arm} | ${f.slug} | ${f.bodyWords} | ${f.ok ? "yes" : "**no**"} | ${(f.wallMs / 1000).toFixed(1)} | ${f.costUsd?.toFixed(4) ?? "?"} | ${f.tokens?.output ?? "?"} | ${f.words ?? "-"} | ${f.paragraphs?.length ?? "-"} | ${f.ok ? idsDropped : "-"} | ${f.ok ? parasDropped : "-"} |`,
    );
  }
  lines.push("");
  const slugs = [...new Set(files.map((f) => f.slug))];
  for (const slug of slugs) {
    lines.push(`## ${slug}`, "");
    for (const f of files.filter((x) => x.slug === slug)) {
      lines.push(`### ${f.arm}`, "");
      if (!f.ok) {
        lines.push(`Failed: ${f.error}`, "");
        continue;
      }
      for (const p of f.paragraphs ?? []) lines.push(`${p.text}`, "", `<sub>${p.ids.join(" ")}</sub>`, "");
    }
  }
  console.log(lines.join("\n"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "list") await list();
  else if (cmd === "run") {
    const at = rest.indexOf("--arm");
    const arm = at >= 0 ? rest[at + 1] : undefined;
    if (!arm) throw new Error("run needs --arm <effort>-<pitch>");
    await run(
      arm,
      rest.filter((_, i) => i !== at && i !== at + 1),
    );
  } else if (cmd === "report") report();
  else if (cmd === "show") await show(rest[0] ?? "", rest.slice(1));
  else throw new Error("usage: list | run --arm <effort>-<pitch> <slug>... | report");
}
