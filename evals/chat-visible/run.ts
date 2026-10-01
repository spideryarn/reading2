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
 * - **elsewhere** — four questions that quote the beginning of a known prose
 *   block outside the screen and ask what it means. Each is asked under both
 *   arms, twice: `at` (today: the position line naming the screen's first block)
 *   and `visible` (the new hedged line). If the new line is overemphasised,
 *   answers to these will cite the screen's blocks more often under `visible`
 *   than under `at`, beyond the spread between the two repeats.
 * - **here** — questions that point at the screen ("this paragraph"). Asked
 *   once under each arm, and read: the new line should land them on it.
 *
 * The screen is a crude but objective measure: the share of an answer's real,
 * renderable citations that are on screen. Our multi-round tools are off, to
 * keep the comparison on the prompt line; OpenRouter's built-in web search stays
 * on because production always offers it. Calls run sequentially, with arm order
 * reversed on the second repeat, so a cache race, rate limit or one arm always
 * going first does not become the measured effect.
 *
 *   npx tsx evals/chat-visible/run.ts <slug>
 *
 * Writes evals/chat-visible/out/<slug>.json, and refuses to overwrite one.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "../../src/env.js";

const HERE = [
  "What does this paragraph mean?",
  "Can you explain what he is saying here, more simply?",
  "Is the claim I'm looking at right now backed up anywhere else in the piece?",
];

const SCREEN = 6;
const ELSEWHERE = 4;

function quoteStart(text: string): string {
  const words = text.trim().replace(/\s+/g, " ").split(" ");
  return words.slice(0, 16).join(" ");
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) throw new Error("usage: run.ts <slug>");
  const outDir = path.join(import.meta.dirname, "out");
  const out = path.join(outDir, `${slug}.json`);
  if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${out}`);

  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { citedBlockIds, converse } = await import("../../src/converse.js");

  await runAsOwner(environmentOwnerId(), async () => {
    const article = await loadArticle(slug);
    const prose = article.blocks.filter((b) => b.text.trim().length > 80);
    const start = Math.floor(prose.length * 0.45);
    const screenBlocks = prose.slice(start, start + SCREEN);
    if (screenBlocks.length !== SCREEN) {
      throw new Error(`need ${SCREEN} prose blocks for a screen; article has ${prose.length}`);
    }
    const screen = screenBlocks.map((b) => b.id);
    const onScreen = new Set(screen);
    const known = new Set(article.blocks.map((b) => b.id));
    const outside = prose.filter((b) => !onScreen.has(b.id));
    if (outside.length < ELSEWHERE) {
      throw new Error(`need ${ELSEWHERE} prose blocks outside the screen; article has ${outside.length}`);
    }
    const elsewhere = Array.from({ length: ELSEWHERE }, (_, i) => {
      const at = Math.round((i / (ELSEWHERE - 1)) * (outside.length - 1));
      const target = outside[at]!;
      return {
        target: target.id,
        question: `What does the paragraph beginning “${quoteStart(target.text)}” mean?`,
      };
    });

    const ask = async (
      question: string,
      arm: "at" | "visible",
      kind: "elsewhere" | "here",
      rep: number,
      target: string | null,
    ) => {
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
          const cited = citedBlockIds(e.text, known);
          const inside = cited.filter((id) => onScreen.has(id)).length;
          return {
            kind,
            question,
            arm,
            rep,
            target,
            targetCited: target === null ? null : cited.includes(target),
            cited: cited.length,
            onScreen: inside,
            text: e.text,
          };
        }
      }
      throw new Error("converse ended without a done event");
    };

    const answers: Awaited<ReturnType<typeof ask>>[] = [];
    for (const { question, target } of elsewhere) {
      for (const rep of [1, 2]) {
        const arms = rep === 1 ? (["at", "visible"] as const) : (["visible", "at"] as const);
        for (const arm of arms) {
          answers.push(await ask(question, arm, "elsewhere", rep, target));
        }
      }
    }
    for (const [i, question] of HERE.entries()) {
      const arms = i % 2 === 0 ? (["at", "visible"] as const) : (["visible", "at"] as const);
      for (const arm of arms) answers.push(await ask(question, arm, "here", 1, null));
    }

    const share = (kind: string, arm: string, rep?: number) => {
      const rows = answers.filter((a) => a.kind === kind && a.arm === arm && (rep === undefined || a.rep === rep));
      const cited = rows.reduce((n, a) => n + a.cited, 0);
      const inside = rows.reduce((n, a) => n + a.onScreen, 0);
      const targetHits = rows.filter((a) => a.targetCited === true).length;
      return {
        answers: rows.length,
        cited,
        onScreen: inside,
        share: cited ? +(inside / cited).toFixed(3) : null,
        ...(kind === "elsewhere" ? { targetHits } : {}),
      };
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
      `${JSON.stringify({ slug, screen: screenBlocks.map(({ id, text }) => ({ id, text })), converseSha256, at: new Date().toISOString(), summary, answers }, null, 2)}\n`,
    );
    console.log(JSON.stringify(summary, null, 2));
  });
}

await main();
