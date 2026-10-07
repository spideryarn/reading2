/**
 * **Does the glossary still give people entries of their own?** A cheap check of one regression the
 * plain-words work kept reopening (docs/plans/260926a-plainer-summaries-and-glossary.md § Two
 * regressions): generate the essay's glossary N times with the current prompt and list the entries
 * whose explicit glossary kind is `person`.
 *
 * ```
 * npx tsx evals/plain-words/glossary-people.ts [n=2]
 * ```
 */
import { loadEnvLocal } from "../../src/env.js";
import { isMain } from "../../src/is-main.js";

/** Person entries, without mistaking every background-only concept for a person. */
export function personNames<T extends { name: string; kind: string }>(entries: readonly T[]): string[] {
  return entries.filter((entry) => entry.kind === "person").map((entry) => entry.name);
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? 2);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error("n must be a positive integer");

  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { generateGlossary } = await import("../../src/glossary.js");
  const slug = "noema-mythology-of-conscious-ai";
  await runAsOwner(environmentOwnerId(), async () => {
    const article = await loadArticle(slug);
    const runs = await Promise.all(
      Array.from({ length: n }, () => generateGlossary({ power: "standard", article: { ...article, slug }, previous: null, profile: null })),
    );
    for (const r of runs) {
      const entries = r.glossary.entries;
      console.log(`${entries.length} entries; people: ${personNames(entries).join(" | ") || "(none)"}`);
    }
  });
}

if (isMain(import.meta.url)) {
  /* Before the ledger, which reads the owner from the environment. */
  loadEnvLocal();
  const { withLedger } = await import("../../src/cli-ledger.js");
  /* The ledger is open around the paid command only: an eval's spend is refused without one (src/ai-spend.ts § UnrecordedSpendRefused). */
  await withLedger("eval", main);
}
