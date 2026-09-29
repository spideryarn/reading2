/**
 * **Build the eval's cases** — plan docs/plans/260929c-shelf-topics-chosen-by-a-model.md
 * § Reviews, R6. Writes `cases/<id>.json`; free, no model calls.
 *
 *     npx tsx evals/shelf-topics/build-cases.ts               # synthetic + local
 *     npx tsx evals/shelf-topics/build-cases.ts --synthetic   # synthetic only, no database
 *
 * - **Synthetic** shelves: `synthetic/<id>.json` (title, gist, text, labels,
 *   profile) → the production extractor over each article's title and prose.
 * - **The local shelf** (owner `LOCAL_OWNER`), read **read-only** with the route's
 *   own owner-scoped query, like scripts/shelf-terms-report.ts: title, the
 *   library entry's gist (`article_revisions.root_gist`), the reader's profile
 *   if they wrote one, and each article's candidates, extracted in memory. It
 *   writes nothing to the database and prints its `Target:` first.
 * - **Three subsets** of the local shelf, 16, 18 and 20 articles, chosen by a
 *   seeded hash of the slug so the mixes differ and are reproducible.
 *
 * Greg's production shelf is not available (Greg via the Overseer,
 * 2026-09-29), so there is no export command; `greg-like` is written to stand
 * in for it.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { EXTRACTOR_VERSION, extractCandidates, type Segment } from "../../src/shelf-terms/extract.js";
import { CASES_DIR, type CaseArticle, EVAL_DIR, labelKey, type ShelfCase } from "./case.js";

const LOCAL_OWNER = "f4d08b58-5573-4811-9887-e26c114fb324";
/** Greg's words in the plan, used when the local reader has written no profile. */
const STATED_PROFILE = "Interested in computational neuroscience, consciousness, Buddhism, AI.";

interface SyntheticFile {
  id: string;
  description: string;
  profile: string;
  labels: { good: string[]; distractors: string[] };
  articles: { slug: string; title: string; gist: string; text: string }[];
}

function write(c: ShelfCase): void {
  writeFileSync(path.join(CASES_DIR, `${c.id}.json`), `${JSON.stringify(c, null, 1)}\n`);
  const eligible = c.articles.filter((a) => a.skipped === null).length;
  console.log(`  ${c.id}: ${c.articles.length} articles (${eligible} eligible)`);
}

function buildSynthetic(): void {
  const dir = path.join(EVAL_DIR, "synthetic");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const s = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as SyntheticFile;
    const articles: CaseArticle[] = s.articles.map((a) => {
      const segments: Segment[] = [
        { text: a.title, kind: "title" },
        ...a.text
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((text) => ({ text, kind: "prose" as const })),
      ];
      const run = extractCandidates(segments);
      return {
        slug: a.slug,
        title: a.title,
        gist: a.gist,
        words: run.words,
        textHash: run.textHash,
        skipped: run.skipped,
        candidates: run.candidates,
      };
    });
    write({
      id: s.id,
      source: "synthetic",
      description: s.description,
      profile: s.profile,
      labels: { good: s.labels.good.map(labelKey), distractors: s.labels.distractors.map(labelKey) },
      extractorVersion: EXTRACTOR_VERSION,
      articles,
    });
  }
}

async function buildLocal(): Promise<void> {
  const { loadEnvLocal, resolveTargetUrl } = await import("../../src/env.js");
  const { withoutPassword, isLocalDatabaseUrl } = await import("../../src/db/ssl.js");
  loadEnvLocal();
  const url = resolveTargetUrl({ shellWins: true });
  if (!url) throw new Error("No DATABASE_URL.");
  if (!isLocalDatabaseUrl(url)) throw new Error(`Refusing a remote database: ${withoutPassword(url)}`);
  process.env.DATABASE_URL = url;

  const { closeDb, getDb } = await import("../../src/db/client.js");
  const { runAsOwner } = await import("../../src/owner.js");
  const { currentShelfRevisions, readRevisionBlocks } = await import("../../src/store/pg-shelf-terms.js");
  const { segmentsFromBlocks } = await import("../../src/shelf-terms/extract.js");
  const { articleRevisions, readerProfiles } = await import("../../src/db/schema.js");
  const { eq, inArray, sql } = await import("drizzle-orm");
  type OwnerId = import("../../src/owner.js").OwnerId;

  try {
    const where = await getDb().execute(sql`select current_database() as db`);
    const db = (where.rows[0] as { db?: string } | undefined)?.db;
    console.log(`Target: ${withoutPassword(url)}  (database=${db}, local)`);
    console.log("Writes: nothing to the database.");

    const local = await runAsOwner(LOCAL_OWNER as OwnerId, async () => {
      const set = await currentShelfRevisions({ archived: false });
      const gists = new Map(
        (
          await getDb()
            .select({ id: articleRevisions.id, gist: articleRevisions.rootGist })
            .from(articleRevisions)
            .where(inArray(articleRevisions.id, set.map((s) => s.revisionId)))
        ).map((r) => [r.id, r.gist]),
      );
      const profileRow = await getDb()
        .select({ profile: readerProfiles.profile })
        .from(readerProfiles)
        .where(eq(readerProfiles.ownerId, LOCAL_OWNER));
      const articles: CaseArticle[] = [];
      for (const entry of set) {
        const run = extractCandidates(segmentsFromBlocks(entry.title, await readRevisionBlocks(entry)));
        articles.push({
          slug: entry.slug,
          title: entry.title ?? entry.slug,
          gist: gists.get(entry.revisionId) ?? null,
          words: run.words,
          textHash: run.textHash,
          skipped: run.skipped,
          candidates: run.candidates,
        });
      }
      return { articles, profile: profileRow[0]?.profile?.trim() || null };
    });

    const base: ShelfCase = {
      id: "local",
      source: "local",
      description:
        "The local development shelf: copies of several of Greg's real articles plus test leftovers (duplicates, one-page stubs).",
      profile: local.profile ?? STATED_PROFILE,
      labels: null,
      extractorVersion: EXTRACTOR_VERSION,
      articles: local.articles,
    };
    write(base);
    const eligible = base.articles.filter((a) => a.skipped === null);
    for (const [suffix, seed, size] of [
      ["a", "260929c-a", 16],
      ["b", "260929c-b", 18],
      ["c", "260929c-c", 20],
    ] as const) {
      const keep = new Set(
        [...eligible]
          .sort((x, y) => (hash(seed + x.slug) < hash(seed + y.slug) ? -1 : 1))
          .slice(0, size)
          .map((a) => a.slug),
      );
      write({
        ...base,
        id: `local-subset-${suffix}`,
        source: "subset",
        description: `${size} articles of the local shelf, chosen by a hash of the slug seeded "${seed}".`,
        articles: base.articles.filter((a) => keep.has(a.slug)),
      });
    }
  } finally {
    await closeDb();
  }
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

console.log("Synthetic:");
buildSynthetic();
if (!process.argv.includes("--synthetic")) {
  console.log("Local:");
  await buildLocal();
}
