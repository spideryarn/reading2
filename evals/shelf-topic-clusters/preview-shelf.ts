/**
 * **One real shelf: today's topic pills beside the proposed ones.** Stage 0 of
 * docs/plans/261003f-shelf-topics-named-by-a-model-as-concepts-not-phrases.md.
 *
 *     DATABASE_URL=<production> npm run shelf-topics:preview -- --owner greg@gregdetre.com
 *     DATABASE_URL=<production> npm run shelf-topics:preview -- --owner <uuid> --archived --members
 *
 * `--owner` is an email address or an owner uuid. `--archived` previews active
 * and archived together, which is what `?archived=1` shows. `--members` also
 * lists up to five titles under each proposed topic.
 *
 * ## What it reads, and that it writes nothing
 *
 * **Every query runs inside one `begin read only` transaction that ends in
 * `rollback`**, on a connection of its own: the owner, the shelf's articles
 * (title, gist, abstract), the phrase candidates already stored for them, the
 * stored model scores and the reader's profile. Postgres refuses a write in
 * that transaction, so "writes nothing" does not rest on this file being
 * careful. Never a bare `SET default_transaction_read_only`: on the
 * transaction pooler that outlives the script (docs/project/database.md).
 *
 * At eight or more distinct works it then makes **one paid model call** (GPT-6
 * Luna, about a cent or less) with the eval's own `induce` prompt, so what Greg
 * sees is what was measured. The titles, gists and profile go to OpenAI via
 * OpenRouter, as they already do for today's topics. The call is not recorded
 * in `ai_calls`: the ledger would be a write to the database being read.
 *
 * ## What "today" means here
 *
 * Today's pills are rebuilt from what production has stored: each article's
 * phrase candidates and the model's stored scores, through the same
 * `chooseTerms` the route uses. An article with no stored candidates yet is
 * counted and left out, where the route would read it on the spot. So this can
 * differ from the live row by those articles, and the output says how many.
 *
 * The shell's `DATABASE_URL` wins over `.env.local`, as in
 * `npm run shelf-terms:report`. **Read the `Target:` line before the lists.**
 */
import { Client } from "pg";

import { collectSpend } from "../../src/ai-spend.js";
import { isLocalDatabaseUrl, sslDecisionFor, withoutPassword } from "../../src/db/ssl.js";
import { loadEnvLocal, resolveTargetUrl } from "../../src/env.js";
import { isUuid } from "../../src/ids.js";
import { type ChooseArticle, chooseTerms } from "../../src/shelf-terms/choose.js";
import { type Candidate, EXTRACTOR_VERSION } from "../../src/shelf-terms/extract.js";
import type { ShelfCase } from "../shelf-topics/case.js";
import { induce, type RunOut } from "./run.js";

/** The most distinct works the one call is shown: the plan's stage 1 cap. The newest win. */
const SHOWN_MAX = 150;
/** The product's existing gate, counted in distinct works. */
const MIN_WORKS = 8;

interface ArticleRow {
  slug: string;
  revision_id: string;
  archived: boolean;
  title: string | null;
  title_override: string | null;
  gist: string | null;
  abstract: string | null;
}
interface RunRow {
  revision_id: string;
  words: number;
  text_hash: string;
  skipped: string | null;
  candidates: Candidate[];
}
interface ScoreRow {
  input_hash: string | null;
  model: string | null;
  prompt_version: number | null;
  scores: Record<string, number> | null;
  computed_at: Date | null;
}

interface Work {
  representative: ArticleRow;
  articles: ArticleRow[];
}

/** The route rejects the whole stored answer when even one score is invalid. */
function qualityFrom(row: ScoreRow | undefined): Map<string, number> | null {
  if (
    !row ||
    row.input_hash === null ||
    row.model === null ||
    row.prompt_version === null ||
    row.computed_at === null ||
    row.scores === null
  )
    return null;
  const quality = new Map<string, number>();
  for (const [key, score] of Object.entries(row.scores)) {
    if (!Number.isInteger(score) || score < 0 || score > 3) return null;
    quality.set(key, score);
  }
  return quality.size > 0 ? quality : null;
}

/** One prompt line per exact work; the shelf query's order chooses its newest copy. */
function distinctWorks(articles: ArticleRow[], runOf: Map<string, RunRow>): Work[] {
  const byWork = new Map<string, Work>();
  for (const article of articles) {
    const hash = runOf.get(article.revision_id)?.text_hash;
    /* A missing stored run gives us no content hash. Treat it as its own work
       rather than silently dropping an article the proposed model can read. */
    const key = hash ? `hash:${hash}` : `article:${article.slug}`;
    const found = byWork.get(key);
    if (found) found.articles.push(article);
    else byWork.set(key, { representative: article, articles: [article] });
  }
  return [...byWork.values()];
}

function usage(): never {
  console.error("Usage: DATABASE_URL=<url> npm run shelf-topics:preview -- --owner <email or uuid> [--archived] [--members]");
  process.exit(1);
}

/** Stranger-authored titles and model-written labels are terminal text, not control bytes. */
function printable(text: string): string {
  return [...text]
    .map((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || (code >= 0x7f && code <= 0x9f) ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

async function main(): Promise<void> {
  loadEnvLocal();
  const argv = process.argv.slice(2);
  const ownerAt = argv.indexOf("--owner");
  const ownerArg = ownerAt >= 0 ? argv[ownerAt + 1] : undefined;
  const archived = argv.includes("--archived");
  const members = argv.includes("--members");
  if (!ownerArg) usage();

  const url = resolveTargetUrl({ shellWins: true });
  if (!url) {
    console.error("No DATABASE_URL.");
    process.exit(1);
  }
  console.log(`Target: ${withoutPassword(url)}  (${isLocalDatabaseUrl(url) ? "local" : "REMOTE"})`);
  console.log("Writes: nothing. Every query is inside one read-only transaction.\n");

  const client = new Client({ connectionString: url, ssl: sslDecisionFor(url).ssl });
  await client.connect();
  let articles: ArticleRow[];
  let runs: RunRow[];
  let scoreRow: ScoreRow | undefined;
  let profile: string | null;
  try {
    await client.query("begin read only");
    let owner = ownerArg;
    if (!isUuid(owner)) {
      let found: { rows: { id: string }[] };
      try {
        found = await client.query<{ id: string }>("select id from auth.users where lower(email) = lower($1)", [owner]);
      } catch {
        throw new Error("The database role could not look up that email in auth.users. Pass the owner uuid instead.");
      }
      if (found.rows.length !== 1) {
        throw new Error(`${found.rows.length} accounts have that email address. Pass the owner uuid instead.`);
      }
      owner = found.rows[0]!.id;
    }
    console.log(`Owner:  ${owner}   scope: ${archived ? "active + archived" : "active"}`);

    /* The route's own shelf: src/store/pg-shelf-terms.ts § shelfRevisionsQuery. */
    articles = (
      await client.query<ArticleRow>(
        `select a.slug, r.id as revision_id, a.archived_at is not null as archived,
                r.title, a.title_override, r.root_gist as gist, r.abstract
           from spideryarn.articles a
           join spideryarn.article_revisions r on r.id = a.current_revision_id
          where a.owner_id = $1
            and left(a.slug, 1) <> '_'
            and r.tree is not null
            and coalesce(r.block_count,
                  (select count(*)::integer from spideryarn.revision_blocks b where b.revision_id = r.id)) > 0
            and ($2::boolean or a.archived_at is null)
          order by coalesce(r.fetched_at, a.created_at) desc, a.slug asc`,
        [owner, archived],
      )
    ).rows;
    runs = (
      await client.query<RunRow>(
        `select revision_id, words, text_hash, skipped, candidates
           from spideryarn.revision_phrase_runs
          where extractor_version = $1 and revision_id = any($2::uuid[])`,
        [EXTRACTOR_VERSION, articles.map((a) => a.revision_id)],
      )
    ).rows;
    const stored = await client.query<ScoreRow>(
      `select input_hash, model, prompt_version, scores, computed_at
         from spideryarn.shelf_topic_scores
        where owner_id = $1 and scope = $2`,
      [owner, archived ? "all" : "active"],
    );
    scoreRow = stored.rows[0];
    const prof = await client.query<{ profile: string | null }>("select profile from spideryarn.reader_profiles where owner_id = $1", [owner]);
    profile = prof.rows[0]?.profile?.trim() || null;
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }

  /* ── the shelf's size ── */
  const runOf = new Map(runs.map((r) => [r.revision_id, r]));
  const read = articles.filter((a) => runOf.has(a.revision_id));
  const eligible = read.filter((a) => runOf.get(a.revision_id)!.skipped === null);
  const works = new Set(eligible.map((a) => runOf.get(a.revision_id)!.text_hash)).size;
  const nArchived = articles.filter((a) => a.archived).length;
  console.log(
    `\nShelf:  ${articles.length} articles (${articles.length - nArchived} active${archived ? ` + ${nArchived} archived` : ""}), ` +
      `${works} distinct works among the ${eligible.length} the phrase program can read; ` +
      `${read.length - eligible.length} skipped by it; ${articles.length - read.length} with no stored candidates yet.`,
  );
  if (articles.length === 0) return;

  /* ── today ── */
  const input: ChooseArticle[] = eligible.map((a) => {
    const r = runOf.get(a.revision_id)!;
    return { slug: a.slug, words: r.words, textHash: r.text_hash, candidates: r.candidates };
  });
  const quality = qualityFrom(scoreRow);
  const byModel = quality ? chooseTerms(input, { quality }).terms : [];
  const today = byModel.length > 0 ? byModel : chooseTerms(input).terms;
  const todayBy = byModel.length > 0 ? "the program's phrases, scored by the model" : "the program alone (no usable stored scores)";

  /* ── proposed ── */
  const allWorks = distinctWorks(articles, runOf);
  const shownWorks = allWorks.slice(0, SHOWN_MAX);
  const shownArticles = shownWorks.flatMap((w) => w.articles);
  if (allWorks.length > SHOWN_MAX)
    console.log(
      `\nNOTE: the proposed topics are from the newest ${SHOWN_MAX} of ${allWorks.length} distinct works ` +
        `(${shownArticles.length} shelf articles including exact copies); one call over more is unmeasured.`,
    );
  const shelf: ShelfCase = {
    id: "preview",
    source: "local",
    description: "",
    profile,
    labels: null,
    extractorVersion: EXTRACTOR_VERSION,
    articles: shownWorks.map(({ representative: a }) => ({
      slug: a.slug,
      title: a.title_override ?? a.title ?? a.slug,
      gist: a.gist ?? a.abstract,
      words: 0,
      textHash: "",
      skipped: null,
      candidates: [],
    })),
  };
  const out: RunOut = { case: "preview", arm: "induce", run: 1, articles: shownWorks.length, topics: [], calls: [], embedUsd: null };
  let proposal: "ok" | "too-small" | "failed" = "ok";
  if (shownWorks.length < MIN_WORKS) {
    proposal = "too-small";
  } else {
    try {
      /* **A sink that keeps nothing, on purpose.** The header says why: the
         ledger here would be a write to the production database being read.
         Since 2026-10-07 a collector with no sink is refused its call
         (`UnrecordedSpendRefused`, src/ai-spend.ts), so the choice is spelled
         out rather than left as an absence. About a cent, once per run —
         docs/plans/261007o-openrouter-spend-the-ledger-does-not-record.md. */
      await collectSpend(() => induce(shelf, out), { attribution: { scopeKind: "eval" }, sink: async () => {} });
    } catch {
      /* Provider errors can include returned text. Do not print one beside a
         command whose input is a reader's titles, gists and profile. */
      proposal = "failed";
      process.exitCode = 1;
    }
  }
  const call = out.calls[0];

  /* Expand the model's representative slug back to every exact copy, as the
     proposed route will, so counts and coverage remain counts of shelf cards. */
  const copiesOf = new Map(shownWorks.map((w) => [w.representative.slug, w.articles.map((a) => a.slug)]));
  const proposed = out.topics.map((topic) => ({
    ...topic,
    slugs: [...new Set(topic.slugs.flatMap((slug) => copiesOf.get(slug) ?? []))],
  }));

  /* ── side by side ── */
  const left = today.map((t) => `${printable(t.label)}  ${t.articles.length}`);
  const right = proposed.map((t) => `${printable(t.label)}  ${t.slugs.length}`);
  const todayCaption = `(${todayBy})`;
  const width = Math.max(28, todayCaption.length, ...left.map((s) => s.length)) + 3;
  console.log(`\n${"TODAY".padEnd(width)}PROPOSED`);
  const proposedBy =
    proposal === "ok"
      ? "(the model names the topics)"
      : proposal === "too-small"
        ? `(not run: fewer than ${MIN_WORKS} distinct works)`
        : "(model call failed; no proposed list)";
  console.log(`${todayCaption.padEnd(width)}${proposedBy}`);
  console.log(`${"-".repeat(width - 3).padEnd(width)}${"-".repeat(28)}`);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (i === 12) console.log(`${"· · · behind 'All N topics'".padEnd(width)}· · ·`);
    console.log(`${(left[i] ?? "").padEnd(width)}${right[i] ?? ""}`);
  }
  const cover = (slugs: string[][], of: number) => `${new Set(slugs.flat()).size} of ${of}`;
  const todayCoverage = cover(today.map((t) => t.articles.map((a) => a.slug)), articles.length);
  if (proposal === "ok") {
    console.log(`\nArticles in at least one topic: today ${todayCoverage}; proposed ${cover(proposed.map((t) => t.slugs), shownArticles.length)}.`);
  } else {
    console.log(`\nArticles in at least one topic: today ${todayCoverage}; proposed not available.`);
  }
  if (call) {
    const cost = call.costUsd === null ? "cost not reported" : `$${call.costUsd.toFixed(4)}`;
    console.log(`The call: ${call.tokensIn ?? "?"} tokens in, ${call.tokensOut ?? "?"} out, ${cost}, ${(call.latencyMs / 1000).toFixed(0)} s.`);
  }

  if (members && proposal === "ok") {
    const titleOf = new Map(shownArticles.map((a) => [a.slug, a.title_override ?? a.title ?? a.slug]));
    console.log("\nProposed topics, up to five articles each:");
    for (const t of proposed) {
      console.log(`  ${printable(t.label)} (${t.slugs.length})`);
      for (const s of t.slugs.slice(0, 5)) console.log(`    - ${printable(titleOf.get(s) ?? s)}`);
    }
  }
}

/* A refusal is one line, not a stack: the messages above are written to be read. */
await main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
