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
 * A run writes on the high-power model, as a press does; `--power standard`
 * writes on the other (plan 261001p; the default was `standard` until 2026-10-06), and
 * `--guard off` measures the writer alone; without `--guard` the probe does
 * what a press does, `SIMPLE_CHECK_ENABLED`.
 *
 * **Since `simple/2`** (plan 261001b) an arm is `<effort>-<reader>[-<tag>]`,
 * the reader being `none`, `about`, `goalA` or `goalB` from readers.json, and
 * all levels are recorded (Brief and Fuller since 2026-10-04); the ELI12 knob went with the real levels. The
 * `…-15-…` arms under evals/results/simple/ are the older prompt, kept as the
 * `before` side. What follows describes the first probe.
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
import type { SimpleCheck } from "../../src/types.js";

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
  /** Since plan 261005b: the length band the write was asked in. Absent before. */
  band?: string;
  bodyBlocks: number;
  ok: boolean;
  error?: string;
  /**
   * The `simple` level's words and paragraphs: the only level before
   * `simple/2`, the middle of three until 2026-10-04, and **absent in results
   * written since**, when it stopped being written (plan 261004f).
   */
  words?: number;
  paragraphs?: { text: string; ids: string[] }[];
  /** `simple/2` arms: who it was written for, and the `fuller` level. */
  reader?: string;
  fullerWords?: number;
  /**
   * When each level was final, from the write's start: valid, checked and past
   * any retry (`onLevel`, plan 261004f stage 2). Present on a failed write too
   * for a level that landed before the other was lost. Absent before 2026-10-04.
   */
  briefReadyMs?: number;
  fullerReadyMs?: number;
  fuller?: { text: string; ids: string[] }[];
  /** Since the slider (7J): the `brief` level. */
  briefWords?: number;
  brief?: { text: string; ids: string[] }[];
  dropped?: Record<string, number>;
  /**
   * Since plan 261001h, three things that could move between time-separated arms
   * (Sol's plan review there): the model id actually selected for the call,
   * Simple's input fingerprint (rendered article plus profile-free user prompt),
   * and a hash of the rendered system prompts. These live on failed files
   * too.
   */
  model?: string;
  articleHash?: string;
  systemsSha256?: string;
  /**
   * Since plan 261001p: which capable model wrote it (`--power`), and whether
   * the fidelity guard ran (`--guard`). Files without them are `standard`;
   * before 261001i there was no guard, and from 261001i until these flags it
   * ran on every probe, because the probe took the switch's default.
   */
  power?: "standard" | "high";
  guard?: boolean;
  /** Since plan 261002h: the fidelity guard's record (`SimpleCheck`), when it ran. */
  check?: SimpleCheck;
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

/**
 * The reader a `simple/2` arm writes for (plan 261001b § Ledger, P1-5):
 * `none`, `about` alone, or `about` with goal `A` or `B` from readers.json —
 * rendered by production's own `renderProfile`, as a job's `ctx.profile` is.
 */
type Reader = "none" | "about" | "goalA" | "goalB";

async function readerProfile(reader: Reader, slug: string): Promise<string | null> {
  if (reader === "none") return null;
  const { renderProfile } = await import("../../src/profile.js");
  const readers = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "readers.json"), "utf8")) as {
    about: string;
    goals: Record<string, Record<"A" | "B", { goal: string }>>;
  };
  const goal = reader === "about" ? null : readers.goals[slug]?.[reader === "goalA" ? "A" : "B"]?.goal;
  if (reader !== "about" && !goal) throw new Error(`readers.json declares no ${reader} for ${slug}`);
  return renderProfile({ profile: readers.about, purpose: goal ?? null });
}

interface RunOpts {
  power: "standard" | "high";
  /** `undefined` takes `SIMPLE_CHECK_ENABLED`, as a press does. */
  guard: boolean | undefined;
}

async function run(arm: string, slugs: string[], opts: RunOpts): Promise<void> {
  const m = /^(low|medium|high)-(none|about|goalA|goalB)(-[\w]+)?$/.exec(arm);
  if (!m) throw new Error("--arm must be <low|medium|high>-<none|about|goalA|goalB>[-<tag>]");
  const effort = m[1]!;
  const reader = m[2] as Reader;
  const pitch = 15;
  loadEnvLocal();
  process.env.SPIDERYARN_PIPELINE_EFFORT = effort;
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const simple = await import("../../src/simple-summary.js");
  const { modelFor } = await import("../../src/models.js");
  const { SIMPLE_CHECK_ENABLED } = await import("../../src/simple-check.js");
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
        const articleHash = simple.inputFingerprint(article.blocks, article.tree, article.meta);
        /* The length band production picks for this body, and a hash of the
           pair of system prompts that band sends (plan 261005b; GPT Sol's plan
           review, F1). A file from before hashed the one pair there was. */
        const bodyWords = body.reduce((n, b) => n + b.words, 0);
        const band = simple.evidenceBand(body);
        const systemsSha256 = createHash("sha256")
          .update(JSON.stringify(simple.SIMPLE_SYSTEMS_BY_BAND[band]))
          .digest("hex");
        const base = {
          arm,
          effort,
          pitch,
          slug,
          version: simple.SIMPLE_PROMPT_VERSION,
          sourceSha256,
          at: new Date().toISOString(),
          bodyWords,
          band,
          bodyBlocks: body.length,
          /* The resolved call model, including a one-off eval override — not the
             stable generator stamp stored on production artefacts. */
          model: modelFor("simple", opts.power),
          articleHash,
          systemsSha256,
          power: opts.power,
          guard: opts.guard ?? SIMPLE_CHECK_ENABLED,
        };
        const started = Date.now();
        const readyMs: { brief?: number; fuller?: number } = {};
        const ready = () => ({
          ...(readyMs.brief === undefined ? {} : { briefReadyMs: readyMs.brief }),
          ...(readyMs.fuller === undefined ? {} : { fullerReadyMs: readyMs.fuller }),
        });
        let file: ArmFile;
        let spent: { costUsd: number | null; tokens: ArmFile["tokens"] } = { costUsd: null, tokens: null };
        const onDone = (report: { calls: { cost: { source: string; costNanos?: number; computedCostNanos?: number }; inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null }[] }) => {
          /* Summed over every writer and checker call, including retries. */
          if (report.calls.length === 0) return;
          let nanosTotal: number | null = 0;
          const tokens = { input: 0, output: 0, reasoning: 0 as number | null };
          for (const c of report.calls) {
            const nanos = c.cost.source === "provider" ? c.cost.costNanos : c.cost.source === "computed" ? c.cost.computedCostNanos : undefined;
            nanosTotal = nanos === undefined || nanosTotal === null ? null : nanosTotal + nanos;
            tokens.input += c.inputTokens ?? 0;
            tokens.output += c.outputTokens ?? 0;
            tokens.reasoning = c.reasoningTokens === null || tokens.reasoning === null ? null : tokens.reasoning + c.reasoningTokens;
          }
          spent = { costUsd: nanosTotal === null ? null : nanosTotal / 1e9, tokens };
        };
        try {
          /* `onDone`, not the returned report: it fires on a failed run too, so a
             run that fails validation is still priced. */
          const { result } = await collectSpend(
            async () =>
              simple.generateSimpleSummary({
                article: { ...article, slug },
                profile: await readerProfile(reader, slug),
                power: opts.power,
                ...(opts.guard === undefined ? {} : { guard: opts.guard }),
                onLevel: (level) => {
                  readyMs[level] = Date.now() - started;
                },
              }),
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
            ...ready(),
            ok: true,
            reader,
            fullerWords: result.words.fuller,
            briefWords: result.words.brief,
            fuller: result.simpleSummary.levels.fuller,
            brief: result.simpleSummary.levels.brief,
            dropped: { ...result.dropped },
            /* Since plan 261002h (Sol's plan review): the guard's own record,
               so a run's fidelity verdicts and retries are kept beside it. */
            ...(result.simpleSummary.check ? { check: result.simpleSummary.check } : {}),
          };
        } catch (err) {
          file = {
            ...base,
            wallMs: Date.now() - started,
            ...spent,
            ...ready(),
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
        console.log(
          `${arm} ${slug}: ${file.ok ? `Brief ${file.briefWords} words at ${((file.briefReadyMs ?? 0) / 1000).toFixed(1)}s, Fuller ${file.fullerWords} words at ${((file.fullerReadyMs ?? 0) / 1000).toFixed(1)}s` : `FAILED ${file.error}`}, ${(file.wallMs / 1000).toFixed(1)}s, $${file.costUsd?.toFixed(4) ?? "?"}`,
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
  lines.push("| arm | article | body words | ok | wall s | $ | out tokens | words | paras | fuller words | fuller paras | ids dropped | paras dropped |");
  lines.push("|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const f of files) {
    const d = f.dropped ?? {};
    const idsDropped = (d.unknownIds ?? 0) + (d.duplicateIds ?? 0) + (d.overCap ?? 0);
    const parasDropped = (d.unanchored ?? 0) + (d.empty ?? 0) + (d.malformed ?? 0);
    lines.push(
      `| ${f.arm} | ${f.slug} | ${f.bodyWords} | ${f.ok ? "yes" : "**no**"} | ${(f.wallMs / 1000).toFixed(1)} | ${f.costUsd?.toFixed(4) ?? "?"} | ${f.tokens?.output ?? "?"} | ${f.words ?? "-"} | ${f.paragraphs?.length ?? "-"} | ${f.fullerWords ?? "-"} | ${f.fuller?.length ?? "-"} | ${f.ok ? idsDropped : "-"} | ${f.ok ? parasDropped : "-"} |`,
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
      if (f.brief) lines.push("**brief**", "");
      for (const p of f.brief ?? []) lines.push(`${p.text}`, "", `<sub>${p.ids.join(" ")}</sub>`, "");
      /* The middle level: only in a result written before 2026-10-04 (plan 261004f). */
      if (f.fuller && f.paragraphs) lines.push("**simple**", "");
      for (const p of f.paragraphs ?? []) lines.push(`${p.text}`, "", `<sub>${p.ids.join(" ")}</sub>`, "");
      if (f.fuller) lines.push("**fuller**", "");
      for (const p of f.fuller ?? []) lines.push(`${p.text}`, "", `<sub>${p.ids.join(" ")}</sub>`, "");
    }
  }
  console.log(lines.join("\n"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "list") await list();
  else if (cmd === "run") {
    const flags = new Map<string, string>();
    const slugs: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]!;
      if (a.startsWith("--")) flags.set(a, rest[++i] ?? "");
      else slugs.push(a);
    }
    const arm = flags.get("--arm");
    if (!arm) throw new Error("run needs --arm <effort>-<reader>");
    /* `high` unless told otherwise, since 2026-10-06: Summary is always
       written on the high-power model (`ALWAYS_HIGH_POWER`, src/models.ts), and
       a forgotten flag had ten writes measure a model no press uses (plan
       261005b § Brief by band). */
    const power = flags.get("--power") ?? "high";
    if (power !== "standard" && power !== "high") throw new Error("--power must be standard or high");
    const guardFlag = flags.get("--guard");
    if (guardFlag !== undefined && guardFlag !== "on" && guardFlag !== "off") throw new Error("--guard must be on or off");
    const unknown = [...flags.keys()].filter((k) => !["--arm", "--power", "--guard"].includes(k));
    if (unknown.length > 0) throw new Error(`unknown flag ${unknown.join(", ")}`);
    await run(arm, slugs, { power, guard: guardFlag === undefined ? undefined : guardFlag === "on" });
  } else if (cmd === "report") report();
  else if (cmd === "show") await show(rest[0] ?? "", rest.slice(1));
  else throw new Error("usage: list | run --arm <effort>-<reader> [--power standard|high] [--guard on|off] <slug>... | report");
}
