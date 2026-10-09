/**
 * **The spike's three articles, read from the local store** — plan 261009a §
 * Stage 3. Read only: `loadArticle` under the environment's owner, the way
 * evals/chat-visible/run.ts does.
 */
import type { Article } from "../../src/article-input.js";
import { withoutPassword } from "../../src/db/ssl.js";

export const SLUGS = [
  "the-mythology-of-conscious-ai-spya-rn5m0q",
  "entropy-24-00930-spya-pywwkq",
  "scaling-hypothesis",
] as const;
export type Slug = (typeof SLUGS)[number];

/** The password-stripped database every read and ledger row goes to. Printed before anything connects. */
export function targetLine(): string {
  const url = process.env.DATABASE_URL;
  return `Target: ${url ? (withoutPassword(url) ?? "(unparsable DATABASE_URL)") : "(no DATABASE_URL)"}`;
}

/** Refuse anything but a loopback database: this spike reads the local corpus and writes ledger rows there. */
export function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* falls through to the refusal */
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`refusing to run against a non-local database (${targetLine()})`);
  }
}

export async function loadArticles(): Promise<Map<Slug, Article>> {
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const out = new Map<Slug, Article>();
  await runAsOwner(environmentOwnerId(), async () => {
    for (const slug of SLUGS) {
      const a = await loadArticle(slug);
      out.set(slug, { slug, blocks: a.blocks, tree: a.tree, meta: a.meta });
    }
  });
  return out;
}
