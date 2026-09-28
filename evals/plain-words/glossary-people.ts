/**
 * **Does the glossary still give people entries of their own?** A cheap check of one regression the
 * plain-words work kept reopening (docs/plans/260926a-plainer-summaries-and-glossary.md § Two
 * regressions): generate the essay's glossary N times with the current prompt and list the entries
 * that carry only `background` — which, for this essay, are the people.
 *
 * ```
 * npx tsx evals/plain-words/glossary-people.ts [n=2]
 * ```
 */
import { loadEnvLocal } from "../../src/env.js";

loadEnvLocal();
const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
const { loadArticle } = await import("../../src/store/index.js");
const { generateGlossary } = await import("../../src/glossary.js");

const n = Number(process.argv[2] ?? 2);
const slug = "noema-mythology-of-conscious-ai";
await runAsOwner(environmentOwnerId(), async () => {
  const article = await loadArticle(slug);
  const runs = await Promise.all(
    Array.from({ length: n }, () => generateGlossary({ article: { ...article, slug }, previous: null, profile: null })),
  );
  for (const r of runs) {
    const e = r.glossary.entries;
    console.log(`${e.length} entries; background only: ${e.filter((x) => !x.senseHere).map((x) => x.name).join(" | ") || "(none)"}`);
  }
});
