/**
 * Prints an article's body passages as `id<TAB>text`, one per line, to write
 * the case manifest against (plan 261018i § How we will know it works). Free.
 *
 *   npx tsx evals/marginalia-sources/dump.ts <slug>
 */
import { loadEnvLocal } from "../../src/env.js";
loadEnvLocal();
const slug = process.argv[2];
if (!slug) throw new Error("name a slug");
const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
const { loadArticle } = await import("../../src/store/index.js");
const { isBodyEvidence } = await import("../../src/block-policy.js");
await runAsOwner(environmentOwnerId(), async () => {
  const found = await loadArticle(slug);
  for (const b of found.blocks.filter(isBodyEvidence)) {
    console.log(`${b.id}\t${b.text.replace(/\s+/g, " ")}`);
  }
});
process.exit(0);
