/**
 * **Does the `relations` call write a few useful margin notes without
 * changing its relation words?** Greg, 2026-10-11 (spya-qyuet0): *"give the
 * LLM just a bit more freedom … explain things that would otherwise be
 * confusing … highlight really important cross-references, especially if
 * there's an inconsistency"*. docs/plans/261011o-marginalia-off-the-first-open-and-notes-of-its-own.md.
 *
 * ```
 * npx tsx evals/margin-notes/run.ts generate --arm before <slug>…   # paid: one capable call per slug
 * npx tsx evals/margin-notes/run.ts report                          # free: every arm, side by side
 * ```
 *
 * Production's generator (`generateRelations`, standard power, the store's
 * `loadArticle`), with whatever src/relations.ts holds when the arm runs —
 * `PROMPT_VERSION` and a hash of the file are recorded with each arm. Run
 * `before` twice (`before`, `before-2`): the spread between two runs of one
 * prompt is what the relation words' change has to be read against.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";

const OUT = path.join(import.meta.dirname, "..", "results", "margin-notes");
const SRC = path.join(import.meta.dirname, "..", "..", "src", "relations.ts");

type Note = { blockId: string; kind: string; text: string; to: string | null };
type ArmResult = {
  arm: string;
  promptVersion: string;
  srcSha: string;
  at: string;
  articles: {
    slug: string;
    paragraphs: number;
    relations: Record<string, string>;
    notes: Note[];
    dropped: Record<string, number>;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    elapsedMs: number;
    /** Each block a note names, cut short, so the report can be read against the article. */
    text: Record<string, string>;
  }[];
  failed?: { slug: string; error: string }[];
};

async function asOwner<T>(fn: () => Promise<T>): Promise<T> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  return runAsOwner(environmentOwnerId(), fn);
}

async function generate(arm: string, slugs: string[]): Promise<void> {
  if (slugs.length === 0) throw new Error("name at least one slug");
  const mod = await import("../../src/relations.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const result: ArmResult = {
    arm,
    promptVersion: mod.PROMPT_VERSION,
    srcSha: createHash("sha256").update(fs.readFileSync(SRC)).digest("hex").slice(0, 12),
    at: new Date().toISOString(),
    articles: [],
  };
  await asOwner(async () => {
    await Promise.all(
      slugs.map(async (slug) => {
        const found = await loadArticle(slug);
        const article = { slug, blocks: found.blocks, tree: found.tree, meta: found.meta };
        try {
          const run = await mod.generateRelations({ power: "standard", article });
          const notes = ((run.relations as { notes?: Note[] }).notes ?? []) as Note[];
          const named = new Set(notes.flatMap((n) => [n.blockId, ...(n.to ? [n.to] : [])]));
          const text: Record<string, string> = {};
          for (const b of found.blocks) if (named.has(b.id)) text[b.id] = b.text.slice(0, 400);
          result.articles.push({
            slug,
            paragraphs: run.paragraphs,
            relations: run.relations.relations as Record<string, string>,
            notes,
            dropped: {
              ...(run.dropped as unknown as Record<string, number>),
              ...Object.fromEntries(
                Object.entries((run.relations.notesDropped ?? {}) as Record<string, number>).map(
                  ([k, v]) => [`note.${k}`, v],
                ),
              ),
            },
            inputTokens: run.inputTokens,
            outputTokens: run.outputTokens,
            cacheReadTokens: run.cacheReadTokens,
            cacheWriteTokens: run.cacheWriteTokens,
            elapsedMs: run.elapsedMs,
            text,
          });
          console.log(`${slug}: ${run.paragraphs} paragraphs, ${notes.length} notes, ${run.outputTokens} out`);
        } catch (err) {
          (result.failed ??= []).push({ slug, error: (err as Error).message });
          console.log(`${slug}: FAILED ${(err as Error).message}`);
        }
      }),
    );
  });
  if (result.articles.length === 0) throw new Error("every article failed; nothing written");
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${arm}.json`);
  if (fs.existsSync(file)) throw new Error(`${file} exists; never overwrite an arm`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`wrote ${file}`);
}

const DRAWN = new Set(["therefore", "but", "contrast"]);

function report(): void {
  const arms = fs
    .readdirSync(OUT)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")) as ArmResult);
  const byArm = new Map(arms.map((a) => [a.arm, a]));
  const base = byArm.get("before");
  console.log("arm\tversion\tsha\tarticles\tnotes\tdrawn words\tout tokens\tin tokens");
  for (const a of arms) {
    const sum = (f: (x: ArmResult["articles"][number]) => number) => a.articles.reduce((s, x) => s + f(x), 0);
    const drawn = sum((x) => Object.values(x.relations).filter((r) => DRAWN.has(r)).length);
    console.log(
      `${a.arm}\t${a.promptVersion}\t${a.srcSha}\t${a.articles.length}\t${sum((x) => x.notes.length)}\t${drawn}\t${sum((x) => x.outputTokens)}\t${sum((x) => x.inputTokens + x.cacheReadTokens + x.cacheWriteTokens)}`,
    );
  }
  if (base) {
    console.log("\nAgreement of every relation word with `before`, per arm (and of the drawn ones only):");
    for (const a of arms) {
      if (a.arm === "before") continue;
      let same = 0;
      let total = 0;
      let drawnSame = 0;
      let drawnTotal = 0;
      for (const x of a.articles) {
        const b = base.articles.find((y) => y.slug === x.slug);
        if (!b) continue;
        for (const [id, r] of Object.entries(b.relations)) {
          total++;
          if (x.relations[id] === r) same++;
          if (DRAWN.has(r) || (x.relations[id] && DRAWN.has(x.relations[id]!))) {
            drawnTotal++;
            if (x.relations[id] === r) drawnSame++;
          }
        }
      }
      console.log(`  ${a.arm}: ${same}/${total} all, ${drawnSame}/${drawnTotal} where either side drew a word`);
    }
  }
  for (const a of arms) {
    for (const x of a.articles) {
      if (x.notes.length === 0) continue;
      console.log(`\n=== ${a.arm} · ${x.slug} (${x.paragraphs} paragraphs, dropped ${JSON.stringify(x.dropped)})`);
      for (const n of x.notes) {
        console.log(`- [${n.kind}] ${n.blockId}${n.to ? ` → ${n.to}` : ""}: ${n.text}`);
        console.log(`    here: ${(x.text[n.blockId] ?? "?").slice(0, 200)}`);
        if (n.to) console.log(`    there: ${(x.text[n.to] ?? "?").slice(0, 200)}`);
      }
    }
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "generate") {
  const i = rest.indexOf("--arm");
  if (i < 0 || !rest[i + 1]) throw new Error("--arm <name> is required");
  const arm = rest[i + 1]!;
  const slugs = rest.filter((_, j) => j !== i && j !== i + 1);
  const { withLedger } = await import("../../src/cli-ledger.js");
  await withLedger("eval", () => generate(arm, slugs));
  process.exit(0);
} else if (cmd === "report") {
  report();
} else {
  console.error("usage: generate --arm <name> <slug>… | report");
  process.exit(1);
}
