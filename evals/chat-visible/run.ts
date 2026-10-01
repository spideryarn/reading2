/**
 * **Does the on-screen line pull answers toward the screen?** — the paid check
 * behind docs/plans/261001q-chat-knows-the-blocks-on-screen.md.
 *
 * > But let's not overemphasize it.
 * >
 * > — Greg, 2026-10-01 (spya-ybnas5)
 *
 * Production's own `converse`, on one article, with a fixed "screen" of six
 * consecutive blocks from the middle of it. Two kinds of question:
 *
 * - **elsewhere** — questions whose answer lives anywhere but the screen. Each
 *   asked under both arms, twice: `at` (today: the position line naming the
 *   screen's first block) and `visible` (the new hedged line). If the new line
 *   is overemphasised, answers to these will cite the screen's blocks more often
 *   under `visible` than under `at`, beyond the spread between the two repeats.
 * - **here** — questions that point at the screen ("this paragraph"). Asked
 *   once under each arm, and read: the new line should land them on it.
 *
 * The screen is a crude but objective measure: the share of an answer's cited
 * block ids that are on screen. Tools are off, to keep the comparison on the
 * prompt line and the cost to a couple of dollars.
 *
 *   npx tsx evals/chat-visible/run.ts <slug>
 *
 * Writes evals/chat-visible/out/<slug>.json, and refuses to overwrite one.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "../../src/env.js";

const ELSEWHERE = [
  "What is the overall argument of this piece, in a few sentences?",
  "What does the author conclude at the very end?",
  "What does the piece say about language and why it matters for minds?",
  "Where does the author first introduce the idea of computational irreducibility, and what does it mean?",
];

const HERE = [
  "What does this paragraph mean?",
  "Can you explain what he is saying here, more simply?",
  "Is the claim I'm looking at right now backed up anywhere else in the piece?",
];

const SCREEN = 6;
const IDS = /spya-[a-z0-9]{6}/g;

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) throw new Error("usage: run.ts <slug>");
  const outDir = path.join(import.meta.dirname, "out");
  const out = path.join(outDir, `${slug}.json`);
  if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${out}`);

  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { converse } = await import("../../src/converse.js");

  await runAsOwner(environmentOwnerId(), async () => {
    const article = await loadArticle(slug);
    const prose = article.blocks.filter((b) => b.text.trim().length > 80);
    const start = Math.floor(prose.length * 0.45);
    const screen = prose.slice(start, start + SCREEN).map((b) => b.id);
    const onScreen = new Set(screen);

    const ask = async (question: string, arm: "at" | "visible", kind: "elsewhere" | "here", rep: number) => {
      for await (const e of converse({
        power: "standard",
        meta: article.meta,
        blocks: article.blocks,
        history: [],
        question,
        slug,
        kind: "chat",
        useTools: false,
        at: screen[0],
        ...(arm === "visible" ? { visible: screen } : {}),
      })) {
        if (e.type === "done") {
          const cited = [...new Set(e.text.match(IDS) ?? [])];
          const inside = cited.filter((id) => onScreen.has(id)).length;
          return { kind, question, arm, rep, cited: cited.length, onScreen: inside, text: e.text };
        }
      }
      throw new Error("converse ended without a done event");
    };

    const jobs: Promise<Awaited<ReturnType<typeof ask>>>[] = [];
    for (const q of ELSEWHERE) {
      for (const arm of ["at", "visible"] as const) {
        for (const rep of [1, 2]) jobs.push(ask(q, arm, "elsewhere", rep));
      }
    }
    for (const q of HERE) for (const arm of ["at", "visible"] as const) jobs.push(ask(q, arm, "here", 1));
    const answers = await Promise.all(jobs);

    const share = (kind: string, arm: string, rep?: number) => {
      const rows = answers.filter((a) => a.kind === kind && a.arm === arm && (rep === undefined || a.rep === rep));
      const cited = rows.reduce((n, a) => n + a.cited, 0);
      const inside = rows.reduce((n, a) => n + a.onScreen, 0);
      return { answers: rows.length, cited, onScreen: inside, share: cited ? +(inside / cited).toFixed(3) : null };
    };
    const summary = {
      elsewhere: {
        at_rep1: share("elsewhere", "at", 1),
        at_rep2: share("elsewhere", "at", 2),
        visible_rep1: share("elsewhere", "visible", 1),
        visible_rep2: share("elsewhere", "visible", 2),
      },
      here: { at: share("here", "at"), visible: share("here", "visible") },
    };
    const converseSha256 = createHash("sha256")
      .update(fs.readFileSync(path.join(import.meta.dirname, "..", "..", "src", "converse.ts")))
      .update(fs.readFileSync(path.join(import.meta.dirname, "..", "..", "src", "article-prompt.ts")))
      .digest("hex");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      out,
      `${JSON.stringify({ slug, screen, converseSha256, at: new Date().toISOString(), summary, answers }, null, 2)}\n`,
    );
    console.log(JSON.stringify(summary, null, 2));
  });
}

await main();
