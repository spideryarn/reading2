/**
 * **Does the FAQ now open on a few big questions, without letting summaries back in?**
 * docs/plans/260929g-faq-difficulty-centrality-and-a-threshold.md § Stages, 3.
 *
 * ```
 * npx tsx evals/faq-levels/run.ts generate --arm before   <slug>...   # paid, on the commit before
 * npx tsx evals/faq-levels/run.ts generate --arm before-2 <slug>...   # the same prompt again: the wobble
 * npx tsx evals/faq-levels/run.ts generate --arm after    <slug>...   # paid, on the commit with it
 * npx tsx evals/faq-levels/run.ts report                              # free: counts, drops, scores
 * npx tsx evals/faq-levels/run.ts pairs --name A --a before:reading --b after:default   # free: blind openings
 * ```
 *
 * A side is `<arm>:<view>`, where the view is `reading` (the stored order) or
 * `default` (what the panel opens on). Two comparisons need it: the *prompt*
 * is old against new with both in reading order, and the *rule* is one new arm
 * in reading order against itself in the default view. `--name` is a bare
 * letter, so the file a judge reads says nothing about which comparison it is.
 *
 * The arms are separated in time, not in code — `generate` calls production's
 * own `generateFaq`, whatever the checkout's prompt is, and records a hash of
 * `src/faq.ts` beside each answer (docs/project/prompting-guide.md § Measuring).
 *
 * **What a pair compares is the opening a reader actually meets**: the first
 * `OPENING` questions of the list as the panel draws it by default. For an
 * unscored list that is reading order; for a scored one it is whatever
 * `defaultView` in src/web/faq-order.ts says — the panel's own rule, never a
 * copy of it here.
 *
 * Reads the local database, and writes nothing there beyond one `ai_calls` row
 * per call, through `collectSpend` with an `eval` scope — the first four arms
 * ran without it and are in no ledger (each call logged *"no spend collector
 * open"*); their tokens are in the arm files. Output under
 * `evals/results/faq-levels/<arm>/`.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash, randomInt } from "node:crypto";
import { loadEnvLocal } from "../../src/env.js";

const OUT = path.join(import.meta.dirname, "..", "results", "faq-levels");
const OPENING = 5;

/** A question as stored, with the two scores the `after` arm adds. */
interface Question {
  id: string;
  question: string;
  passages: { blockId: string; quote: string; start: number }[];
  difficulty?: number;
  centrality?: number;
}

interface ArmFile {
  arm: string;
  slug: string;
  version: string;
  faqSha256: string;
  at: string;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  questions: Question[];
  dropped: Record<string, number>;
  scoreDrops?: Record<string, number>;
}

async function generate(arm: string, slugs: string[]): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const faqModule = await import("../../src/faq.js");
  const { collectSpend } = await import("../../src/ai-spend.js");
  const { costStore } = await import("../../src/store/ai-calls.js");
  const faqSha256 = createHash("sha256")
    .update(fs.readFileSync(path.join(import.meta.dirname, "..", "..", "src", "faq.ts")))
    .digest("hex");
  fs.mkdirSync(path.join(OUT, arm), { recursive: true });
  await runAsOwner(environmentOwnerId(), async () => {
    await Promise.all(
      slugs.map(async (slug) => {
        const out = path.join(OUT, arm, `${slug}.json`);
        if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${path.relative(process.cwd(), out)}`);
        const article = await loadArticle(slug);
        const { result: run } = await collectSpend(() => faqModule.generateFaq({ power: "standard", article: { ...article, slug } }), {
          attribution: { scopeKind: "eval", ownerId: environmentOwnerId() },
          sink: (row) => costStore.record(row),
        });
        const scoreDrops = (run as unknown as { scoreDrops?: Record<string, number> }).scoreDrops;
        const file: ArmFile = {
          arm,
          slug,
          version: faqModule.PROMPT_VERSION,
          faqSha256,
          at: new Date().toISOString(),
          tokens: {
            input: run.inputTokens,
            output: run.outputTokens,
            cacheRead: run.cacheReadTokens,
            cacheWrite: run.cacheWriteTokens,
          },
          questions: run.faq.questions as Question[],
          dropped: { ...run.dropped },
          ...(scoreDrops ? { scoreDrops } : {}),
        };
        fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
        console.log(`${arm} ${slug}: ${run.faq.questions.length} questions, ${run.inputTokens}+${run.outputTokens} tokens`);
      }),
    );
  });
}

function readArm(arm: string): ArmFile[] {
  const dir = path.join(OUT, arm);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as ArmFile);
}

type DefaultView = (questions: readonly Question[]) => Question[];

/** The panel's default order, if this checkout has one; reading order otherwise. */
async function defaultView(): Promise<DefaultView> {
  try {
    const mod = (await import("../../src/web/faq-order.js")) as { defaultView?: DefaultView };
    if (mod.defaultView) return mod.defaultView;
  } catch {
    /* The commit before the change has no faq-order module: reading order is its default. */
  }
  return (questions) => [...questions];
}

async function report(): Promise<void> {
  const view = await defaultView();
  for (const arm of fs.readdirSync(OUT).filter((d) => fs.statSync(path.join(OUT, d)).isDirectory()).sort()) {
    for (const f of readArm(arm)) {
      const shown = view(f.questions);
      const opening = new Set(shown.slice(0, OPENING).map((q) => q.id));
      const fmt = (n: number | undefined) => (n === undefined ? "  - " : n.toFixed(2));
      console.log(
        `\n## ${arm} · ${f.slug} · ${f.version} · ${f.questions.length} questions, ${shown.length} shown by default`,
      );
      console.log(`   dropped ${JSON.stringify(f.dropped)}${f.scoreDrops ? ` scoreDrops ${JSON.stringify(f.scoreDrops)}` : ""}`);
      console.log(`   tokens ${JSON.stringify(f.tokens)}`);
      for (const q of shown) {
        console.log(`   ${opening.has(q.id) ? "*" : " "} d${fmt(q.difficulty)} c${fmt(q.centrality)}  ${q.question}`);
      }
      for (const q of f.questions.filter((q) => !shown.includes(q))) {
        console.log(`   - d${fmt(q.difficulty)} c${fmt(q.centrality)}  (hidden) ${q.question}`);
      }
    }
  }
}

async function pairs(name: string, a: string, b: string): Promise<void> {
  const byDefault = await defaultView();
  const side = (spec: string) => {
    const [arm, view = "default"] = spec.split(":");
    if (!arm || (view !== "reading" && view !== "default")) throw new Error(`bad side ${spec}`);
    const order = view === "reading" ? (q: readonly Question[]) => [...q] : byDefault;
    return { spec, files: new Map(readArm(arm).map((f) => [f.slug, f])), order };
  };
  const left = side(a);
  const right = side(b);
  const lines: string[] = [];
  const key: { slug: string; X: string; Y: string }[] = [];
  for (const [slug, fa] of left.files) {
    const fb = right.files.get(slug);
    if (!fb) continue;
    const swap = randomInt(2) === 1;
    const [x, y] = swap ? [{ s: right, f: fb }, { s: left, f: fa }] : [{ s: left, f: fa }, { s: right, f: fb }];
    key.push({ slug, X: x.s.spec, Y: y.s.spec });
    const list = (o: typeof x) =>
      o.s
        .order(o.f.questions)
        .slice(0, OPENING)
        .map((q, i) => `  ${i + 1}. ${q.question}`)
        .join("\n");
    lines.push(`### ${slug}\n\nX:\n${list(x)}\n\nY:\n${list(y)}\n`);
  }
  console.log(`key balance: ${a} on X in ${key.filter((k) => k.X === a).length} of ${key.length}`);
  const stem = path.join(OUT, `pairs-${name}`);
  fs.writeFileSync(`${stem}.md`, lines.join("\n"));
  fs.writeFileSync(path.join(OUT, `key-${name}.json`), `${JSON.stringify({ a, b, key }, null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), stem)}.md and key-${name}.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const at = rest.indexOf(name);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  if (cmd === "generate") {
    const arm = flag("--arm");
    if (!arm || !/^(before|after)(-\d+)?$/.test(arm)) throw new Error("generate needs --arm before|after[-N]");
    const at = rest.indexOf("--arm");
    await generate(
      arm,
      rest.filter((_, i) => i !== at && i !== at + 1),
    );
  } else if (cmd === "report") {
    await report();
  } else if (cmd === "pairs") {
    const name = flag("--name");
    const a = flag("--a");
    const b = flag("--b");
    if (!name || !a || !b) throw new Error("pairs needs --name <letter> --a <arm:view> --b <arm:view>");
    await pairs(name, a, b);
  } else {
    throw new Error("usage: run.ts generate --arm before|after[-N] <slug>... | report | pairs --name <letter> --a <arm:view> --b <arm:view>");
  }
}
