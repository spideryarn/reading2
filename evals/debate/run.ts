/**
 * **The Debate eval runner — stage A of
 * [260906b](../../docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md).**
 *
 * ```
 * npm run eval:debate -- check                    # free: every seam, no model, no network, no database
 * npm run eval:debate -- plan --slug <slug>       # free: what a run would buy, and from where
 * npm run eval:debate -- run --slug <slug>        # one live pass over one article, journalled. ~$0.15
 * npm run eval:debate -- replay --run <dir>       # Layer 1 over a journal on disk. Free.
 * npm run eval:debate -- verify --dry-run         # free: the full-page fallback, over a synthetic web
 * npm run eval:debate -- verify --run <dir>       # does the FULL PAGE hold the quotations the extract lost?
 * ```
 *
 * ## What Stage A is for
 *
 * Two live debate runs cost $0.6252 and **bought no replayable evidence**: only
 * *kept* rows reach `debate.json`, so every refused row and every page extract
 * the model was actually reading was gone the moment the step ended. This runner
 * exists so the next dollar buys a record.
 *
 * It calls [`generateDebate`](../../src/debate.ts) **directly and never through
 * the job queue** — so no reader's artefact is clobbered, and no `product` spend
 * row is written against a purchase nobody made. Everything is scoped
 * `withLedger("eval", …)`, which is what keeps it out of `npm run cost`'s
 * product column.
 *
 * ## The free mode, and why it comes first
 *
 * `evals/summaries/run.ts` has `--stub` and `evals/deepen` has `--dry-run`, and
 * both exist because **a paid run that quietly measured nothing is this repo's
 * commonest expensive bug**. `check` exercises the four seams that a paid run
 * would otherwise exercise for the first time with money on the table:
 *
 * 1. **Journal writing** — a real `JournalFile`, real appends, read back.
 * 2. **Reconciliation** — including an OOM-shaped journal, which must come back
 *    *not complete* with an unmatched start named.
 * 3. **The cost path** — three synthetic call inventories, and the two that are
 *    unknown must print `not measured` and never `$0.0000`.
 * 4. **Layer 1 replay** — over that synthetic journal, with a kept row, a row
 *    lost to `directnessUnverified`, and an attempt that cannot be replayed at
 *    all because its bytes are gone.
 *
 * The seam it does **not** cover is `generateDebate` writing the journal in the
 * first place, which needs a model at the other end of `openRouterJson`. That is
 * covered by [`tests/debate-journal.test.ts`](../../tests/debate-journal.test.ts),
 * which stubs the gateway — including the assertion that `attempt-started` goes
 * down before dispatch and not after the answer.
 *
 * ## Where a run lands, and why it is gitignored
 *
 * `output/debate-runs/<timestamp>/`, the same call `evals/summaries/` made about
 * `output/summaries-runs/`: a journal carries whole page extracts and, through
 * the answer text, sentences of the article. **Never commit one.** What may be
 * promoted into `evals/results/debate/` by hand is a numbers file with no prose
 * in it — and that is Stage B's job, not this one's.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { currentSpend, type SpendRecord } from "../../src/ai-spend.js";
import type { Article } from "../../src/article-input.js";
import { withLedger } from "../../src/cli-ledger.js";
import { isBodyEvidence } from "../../src/block-policy.js";
import { articleWithIds } from "../../src/article-prompt.js";
import {
  blockTextById,
  CLAIMS_PROMPT,
  CLAIMS_SYSTEM,
  DIRECT_SYSTEM,
  directPrompt,
  generateDebate,
  inputFingerprint,
} from "../../src/debate.js";
import type { DebateJournalEvent } from "../../src/debate-journal.js";
import { reconcile, reconciliationLines, sha256Of } from "../../src/debate-journal.js";
import { loadEnvLocal } from "../../src/env.js";
import { isMain } from "../../src/is-main.js";
import { modelFor } from "../../src/models.js";
import { environmentOwnerId, runAsOwner } from "../../src/owner.js";
import { fallbackHeadTitle } from "../../src/source-hash.js";
import type { Block, Meta } from "../../src/types.js";
import { costOf, formatRunCost, type RunCost } from "./cost.js";
import { JournalFile, readJournal } from "./journal-file.js";
import { replayJournal, replayLines } from "./replay.js";
import {
  headline,
  HOW_TO_READ,
  verifyFallback,
  verifyLines,
  type VerifyReport,
} from "./verify-fallback.js";
import { fixtureFetch, fixtureFetchOptions, fixtureJournal, QUOTES, URLS } from "./verify-fixture.js";

/** **Gitignored.** See the header. */
const RUN_ROOT = "output/debate-runs";

/**
 * Two slugs that must never be run: `scaling-hypothesis` and every `evalcost-*`
 * carry `https://cost-eval.invalid/…`, so pass A would search the open web for a
 * domain that does not exist and the run would measure the search engine's
 * imagination. The plan calls them poison; this is the code that says so.
 */
const POISON = [/^scaling-hypothesis$/, /^evalcost-/];

interface Options {
  command: string;
  slug: string | null;
  run: string | null;
  /** `verify` only: the synthetic web instead of the real one. No network at all. */
  dryRun: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  const o: Options = { command: argv[0] ?? "check", slug: null, run: null, dryRun: false };
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--slug":
        if (!value) throw new Error("--slug needs an article slug");
        o.slug = value;
        i += 1;
        break;
      case "--run":
        if (!value) throw new Error("--run needs a run directory");
        o.run = value;
        i += 1;
        break;
      case "--dry-run":
        o.dryRun = true;
        break;
      default:
        throw new Error(`unknown flag "${String(flag)}"`);
    }
  }
  return o;
}

function newRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/* --------------------------------------------------------------- the live run -- */

/** What a run leaves behind, beside its journal. */
interface RunFile {
  runId: string;
  startedAt: string;
  slug: string;
  model: string;
  /** `null` when the run threw before it could stamp one. */
  sourceHash: string | null;
  completed: boolean;
  error: string | null;
  elapsedMs: number;
  webSearches: number | null;
  kept: { direct: number; claims: number } | null;
  cost: RunCost;
  costLine: string;
  /** The collector's own id, which is what joins `callIds` to `ai_calls`. */
  ledgerRunId: string;
  journalFile: string;
  journalWriteFailures: number;
  reconciliation: ReturnType<typeof reconcile>;
}

async function commandRun(o: Options): Promise<void> {
  const slug = o.slug;
  if (!slug) throw new Error("run needs --slug <article-slug>");
  if (POISON.some((p) => p.test(slug))) {
    throw new Error(
      `"${slug}" is one of the fixtures whose URL is https://cost-eval.invalid/… — pass A would search ` +
        "the web for a domain that does not exist, and the run would measure nothing. Pick a real article.",
    );
  }

  const runId = newRunId();
  const dir = path.join(RUN_ROOT, `${runId}-${slug}`);
  await mkdir(dir, { recursive: true });
  const journal = await JournalFile.open(dir);

  const article = await loadArticleFor(slug);
  const model = modelFor("debate");
  console.log(`Article: ${slug} — ${String(article.blocks.length)} blocks`);
  console.log(`Model:   ${model}`);
  console.log(`Journal: ${journal.file}\n`);

  /* **Slice the ambient collector rather than nesting one.** A nested
     `collectSpend` shadows the outer `withLedger("eval", …)`, so every row would
     leave the ledger — evals/cost/interactions.ts § `measure` made this call
     first and gives the whole reasoning. */
  const before = currentSpend()?.calls.length ?? 0;
  const startedAt = Date.now();
  let completed = false;
  let error: string | null = null;
  let sourceHash: string | null = null;
  let webSearches: number | null = null;
  let kept: { direct: number; claims: number } | null = null;

  try {
    const run = await generateDebate({
      article,
      journal,
      onProgress: (detail) => {
        console.log(`  ${detail}…`);
      },
    });
    completed = true;
    sourceHash = run.debate.sourceHash;
    webSearches = run.webSearches;
    kept = { direct: run.debate.direct.rows.length, claims: run.debate.claims.rows.length };
  } catch (err) {
    /* **Recorded, not rethrown.** The call that failed had already been paid
       for, and a failed run is precisely the one whose journal is worth
       keeping — that is the whole reason this exists. */
    error = err instanceof Error ? err.message : String(err);
  }

  const mine = (currentSpend()?.calls ?? []).slice(before);
  const cost = costOf(mine, { completed });
  const contents = await readJournal(journal.file);
  const reconciliation = reconcile(contents.events);

  const runFile: RunFile = {
    runId,
    startedAt: new Date(startedAt).toISOString(),
    slug,
    model,
    sourceHash,
    completed,
    error,
    elapsedMs: Date.now() - startedAt,
    webSearches,
    kept,
    cost,
    costLine: formatRunCost(cost),
    ledgerRunId: currentSpend()?.runId ?? "(no collector)",
    journalFile: journal.file,
    journalWriteFailures: journal.failures.length,
    reconciliation,
  };
  await writeFile(path.join(dir, "run.json"), `${JSON.stringify(runFile, null, 2)}\n`, "utf-8");

  report(runFile, contents.malformedLines, journal.failures.length);
  if (!completed || cost.problems.length > 0 || !reconciliation.complete) process.exitCode = 1;
}

function report(runFile: RunFile, malformedLines: number[], writeFailures: number): void {
  console.log("");
  console.log(runFile.completed ? "The run completed." : `The run FAILED: ${String(runFile.error)}`);
  if (runFile.kept) {
    console.log(
      `  kept ${String(runFile.kept.direct)} about this piece, ${String(runFile.kept.claims)} about what it claims` +
        `; ${String(runFile.webSearches ?? 0)} web search(es); ${String(Math.round(runFile.elapsedMs / 1000))}s`,
    );
  }
  console.log(`\nCost: ${runFile.costLine}`);
  console.log(`  ledger run ${runFile.ledgerRunId}; generations: ${runFile.cost.callIds.join(", ") || "(none)"}`);
  for (const problem of runFile.cost.problems) console.log(`  ! ${problem}`);

  console.log(`\nJournal: ${runFile.journalFile}`);
  for (const line of reconciliationLines(runFile.reconciliation)) console.log(line);
  if (writeFailures > 0) {
    console.log(
      `  ! ${String(writeFailures)} event(s) could not be written down — this journal is not a record of the run`,
    );
  }
  if (malformedLines.length > 0) {
    console.log(
      `  ! ${String(malformedLines.length)} unreadable line(s) at ${malformedLines.join(", ")} — usually a process that died mid-write`,
    );
  }
  console.log(`\nWrote ${path.dirname(runFile.journalFile)}`);
}

/**
 * The article, through the store — never off a directory.
 *
 * `runAsOwner(environmentOwnerId(), …)` because every article read is
 * owner-scoped and a slug somebody else holds is a 404, deliberately
 * (docs/project/auth.md). This is the reader's projection of the same Postgres
 * rows the pipeline's `readArticle` reads; the difference is that it reads the
 * *published* revision rather than a job's draft, which for an article that has
 * already been ingested is the same bytes.
 *
 * There is no `SPIDERYARN_STORE` to set: the flag went on 2026-09-06.
 */
async function loadArticleFor(slug: string): Promise<Article> {
  /* **Imported here rather than at the top**, so that `check` touches no
     database at all: importing `src/store/index.ts` selects the Postgres reader
     and says so in a log line, and a free mode that prints "serving article
     reads from Postgres" invites the reader to believe it needs one. The same
     move `evals/illustrated/run.ts` makes for the same reason. */
  const { loadArticle } = await import("../../src/store/index.js");
  const found = await runAsOwner(environmentOwnerId(), () => loadArticle(slug));
  return { slug, blocks: found.blocks, tree: found.tree, meta: found.meta };
}

/* ------------------------------------------------------------------- plan ---- */

/**
 * **What a run would buy, and from where — for free.**
 *
 * The store read, the fingerprint and the two prompts are all built here and
 * nothing is dispatched, so the one thing `check` cannot cover — that this slug
 * really is readable as this owner, and that pass A has a URL to search for —
 * is answerable without opening the wire. `evals/summaries/run.ts plan` is the
 * same idea.
 *
 * **The prompts are hashed and measured, never printed.** They are the article.
 */
async function commandPlan(o: Options): Promise<void> {
  const slug = o.slug;
  if (!slug) throw new Error("plan needs --slug <article-slug>");
  const article = await loadArticleFor(slug);
  const evidence = article.blocks.filter(isBodyEvidence);
  const meta: Meta = article.meta ?? ({ title: fallbackHeadTitle(article.tree) } as Meta);
  const directUser = directPrompt(article.meta, article.tree);
  const claimsSystem = `${articleWithIds(meta, evidence)}\n\n---\n\n${CLAIMS_SYSTEM}`;

  console.log(`# What a run on "${slug}" would buy\n`);
  console.log(`  blocks           ${String(article.blocks.length)} (${String(evidence.length)} of them argument rather than apparatus)`);
  console.log(`  title            ${article.meta?.title ?? "(none — the tree's first heading stands in)"}`);
  console.log(`  byline           ${article.meta?.byline ?? "(none)"}`);
  console.log(`  url              ${article.meta?.url ?? "(none)"}`);
  console.log(`  inputFingerprint ${inputFingerprint(article.blocks, article.tree, article.meta)}`);
  console.log(`  model            ${modelFor("debate")}`);
  console.log(`\n  pass A  system ${String(DIRECT_SYSTEM.length)} chars (${sha256Of(DIRECT_SYSTEM).slice(0, 12)}), user ${String(directUser.length)} chars (${sha256Of(directUser).slice(0, 12)})`);
  console.log(`  pass B  system ${String(claimsSystem.length)} chars (${sha256Of(claimsSystem).slice(0, 12)}), user ${String(CLAIMS_PROMPT.length)} chars (${sha256Of(CLAIMS_PROMPT).slice(0, 12)})`);

  if (!article.meta?.url) {
    console.log(
      "\n! This article has no URL, so pass A is searching for a title and a byline alone and " +
        "`selfSource` cannot fire. Group one will be weaker than production's usual case.",
    );
  }
  if (POISON.some((p) => p.test(slug))) {
    console.log("\n! This slug is poison — its URL is https://cost-eval.invalid/…, so `run` will refuse it.");
  }
  console.log(
    "\nNothing was dispatched. `run --slug` is the paid one, and it is roughly $0.15 for the two passes.",
  );
}

/* ----------------------------------------------------------------- replay ---- */

async function commandReplay(o: Options): Promise<void> {
  const dir = o.run;
  if (!dir) throw new Error("replay needs --run <run-directory>");
  const contents = await readJournal(path.join(dir, "journal.jsonl"));
  const reconciliation = reconcile(contents.events);

  /* Group two's rows are checked against the article's own blocks, so a replay
     without them would report every row `unknownBlockId` — a catastrophe
     belonging to the replay and not to the run. The slug comes out of the
     journal itself rather than a flag, so a replay cannot be pointed at the
     wrong article. */
  const slug = contents.events.find((e) => e.event === "attempt-started")?.article.slug ?? null;
  const blockText = slug ? blockTextById((await loadArticleFor(slug)).blocks) : undefined;
  if (!slug) console.log("! this journal names no article, so its claims passes cannot be replayed");

  console.log(`Journal: ${path.join(dir, "journal.jsonl")}${slug ? ` — ${slug}` : ""}\n`);
  for (const line of reconciliationLines(reconciliation)) console.log(line);
  console.log("");
  for (const line of replayLines(replayJournal(contents.events, blockText ? { blockText } : {}))) {
    console.log(line);
  }
  if (!reconciliation.complete) process.exitCode = 1;
}

/* ------------------------------------------------------------------ verify -- */

/**
 * **The two-curl experiment: would the full page have held the quotations the
 * search extract lost?**
 *
 * [`verify-fallback.ts`](verify-fallback.ts) has the whole reasoning. This is
 * the two ways in:
 *
 * - `verify --run <dir>` reads a journal and **fetches** each page whose
 *   quotation missed in the extract. It is the only command in this file that
 *   opens a socket, and it spends no money.
 * - `verify --dry-run` runs the same code over a synthetic journal and a
 *   synthetic web ([`verify-fixture.ts`](verify-fixture.ts)) with **no network
 *   at all**, and asserts every seam — including the ones that must *not*
 *   happen, like fetching a page whose quotation the extract already had.
 *
 * The dry run exists for the reason `check` above exists: a tool whose first
 * outing is the outing that decides something is a tool nobody has watched fail.
 */
async function commandVerify(o: Options): Promise<void> {
  if (o.dryRun) {
    await verifyDryRun();
    return;
  }
  const dir = o.run;
  if (!dir) throw new Error("verify needs --run <run-directory>, or --dry-run for the offline rehearsal");

  const contents = await readJournal(path.join(dir, "journal.jsonl"));
  console.log(`Journal: ${path.join(dir, "journal.jsonl")}`);
  if (contents.malformedLines.length > 0) {
    console.log(
      `  ! ${String(contents.malformedLines.length)} unreadable line(s) at ${contents.malformedLines.join(", ")}`,
    );
  }
  console.log("");

  const report: VerifyReport = await verifyFallback({ events: contents.events });
  for (const line of verifyLines(report)) console.log(line);

  /* Beside the journal, which is already gitignored and already holds the
     extracts these counts are about. Nothing is promoted out of here by hand
     except numbers. */
  const file = path.join(dir, "verify-fallback.json");
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  console.log(`\nWrote ${file}`);
}

/**
 * Every seam of the verification path, over a web that is seven strings in a
 * `switch`.
 *
 * The assertions worth reading are the negative ones. A page whose quotation was
 * already in the extract **must not be fetched** — that is Stage F's ordering
 * rule (F53), and it is what keeps the fetch count proportionate to the failures
 * rather than to the rows. A PDF **must not** come back `ok`, and neither it nor
 * a 404 may appear in the *not recovered* column, because both would be a
 * network fact wearing the costume of a fact about the model.
 */
async function verifyDryRun(): Promise<void> {
  const results: { held: boolean }[] = [];
  console.log("The full-page fallback, over a synthetic journal and a synthetic web.");
  console.log("No model, no network, no database.\n");

  const web = fixtureFetch();
  const report = await verifyFallback({
    events: fixtureJournal(),
    fetchOptions: fixtureFetchOptions(web.impl),
  });
  const lines = verifyLines(report);
  for (const line of lines) console.log(line);
  console.log("");

  const s = report.summary;
  const at = (rowIndex: number, field: "sourceQuote" | "articleReferenceQuote" = "sourceQuote") =>
    report.checks.find((c) => c.rowIndex === rowIndex && c.field === field);
  const attempt = (id: string) => report.attempts.find((a) => a.attemptId === id);

  console.log("What the journal was read as");
  results.push(
    check(
      "the direct pass was read, and every reported row with it",
      attempt("direct-1")?.reportedRows === 9,
      JSON.stringify(attempt("direct-1")),
    ),
  );
  results.push(
    check(
      "the claims pass is NOT read, and says so — group two is not this question",
      attempt("claims-1")?.skipped?.includes("not a direct pass") === true,
      JSON.stringify(attempt("claims-1")),
    ),
  );
  results.push(
    check(
      "the attempt that never heard back is NOT read, and says so",
      attempt("dead-1")?.skipped?.includes("never heard back") === true,
      JSON.stringify(attempt("dead-1")),
    ),
  );

  console.log("\nAgainst the provider extract — what production checks today");
  results.push(check("every quotation is classified", s.quotations === 11, String(s.quotations)));
  results.push(check("three are in the extract", s.inExtract === 3, String(s.inExtract)));
  results.push(check("six miss it — the observed failures", s.observedFailures === 6, String(s.observedFailures)));
  results.push(
    check(
      "a row citing an address the search never returned has no extract to check",
      s.noExtract === 1 && at(7)?.klass === "noExtract",
      JSON.stringify(at(7)),
    ),
  );
  results.push(
    check(
      "a two-word quotation is below the floor, and no fetch could rescue it",
      s.belowFloor === 1 && at(8)?.klass === "belowFloor",
      JSON.stringify(at(8)),
    ),
  );

  console.log("\nWhat was fetched, and what was not");
  results.push(
    check(
      "a page whose quotation was already in the extract is NEVER fetched",
      !web.asked.includes(URLS.inExtract),
      web.asked.join(", "),
    ),
  );
  results.push(
    check("nor is an address the search never returned", !web.asked.includes(URLS.uncited), web.asked.join(", ")),
  );
  results.push(
    check(
      "each page that did need fetching was fetched exactly once",
      web.asked.length === new Set(web.asked).size && web.asked.length === 6,
      web.asked.join(", "),
    ),
  );

  console.log("\nThe recovery question");
  results.push(
    check(
      "the recovery case is recovered — the extract stopped short and the page did not",
      at(1)?.page?.recovered === true,
      JSON.stringify(at(1)?.page),
    ),
  );
  results.push(
    check(
      "a quotation living in a comment thread is found by whole-body text and NOT by Readability",
      at(2)?.page?.inWholeBody === true && at(2)?.page?.inReadability === false,
      JSON.stringify(at(2)?.page),
    ),
  );
  results.push(
    check(
      "a paraphrase is not recovered, and the page was genuinely read",
      at(3)?.page?.recovered === false && at(3)?.page?.outcome === "ok",
      JSON.stringify(at(3)?.page),
    ),
  );
  results.push(
    check(
      "a quotation straddling a paragraph break is flagged as a textContent artefact, not a paraphrase",
      at(4)?.page?.recovered === false && at(4)?.page?.inSpacedBody === true && s.spacedBodyOnly === 1,
      JSON.stringify(at(4)?.page),
    ),
  );

  console.log("\nWhat must never be read as evidence about the model");
  results.push(
    check(
      "a PDF is `unsupported`, never `ok`, and never an empty page",
      at(5)?.page?.outcome === "unsupported" && at(5)?.page?.inWholeBody === false,
      JSON.stringify(at(5)?.page),
    ),
  );
  results.push(check("a dead link is `not-found`", at(6)?.page?.outcome === "not-found", JSON.stringify(at(6)?.page)));
  results.push(
    check(
      "neither is counted as `not recovered`; both are `not attempted`",
      s.notAttempted === 2 && s.notRecovered === 2,
      `notAttempted ${String(s.notAttempted)}, notRecovered ${String(s.notRecovered)}`,
    ),
  );
  results.push(
    check(
      "the three columns account for every observed failure and nothing else",
      s.recovered + s.notRecovered + s.notAttempted === s.observedFailures,
      `${String(s.recovered)} + ${String(s.notRecovered)} + ${String(s.notAttempted)} vs ${String(s.observedFailures)}`,
    ),
  );

  console.log("\nThe budget");
  const stingy = fixtureFetch();
  const capped = await verifyFallback({
    events: fixtureJournal(),
    fetchOptions: fixtureFetchOptions(stingy.impl),
    budget: { maxFetches: 1, concurrency: 1 },
  });
  results.push(
    check(
      "a one-fetch budget stops after one page, and the rest are `budget-exhausted`",
      stingy.asked.length === 1 && capped.summary.outcomes["budget-exhausted"] === 5,
      `${String(stingy.asked.length)} fetched, ${String(capped.summary.outcomes["budget-exhausted"])} exhausted`,
    ),
  );
  results.push(
    check(
      "and a budget refusal is `not attempted`, never `not recovered`",
      capped.summary.notRecovered === 0 && capped.summary.notAttempted === 5,
      `notAttempted ${String(capped.summary.notAttempted)}, notRecovered ${String(capped.summary.notRecovered)}`,
    ),
  );

  console.log("\nThe headline, and what may be printed");
  results.push(
    check(
      "the headline reads `recovered X of Y observed failures` and nothing else",
      headline(s) === "recovered 2 of 6 observed failures",
      headline(s),
    ),
  );
  const printed = lines.join("\n");
  results.push(
    check(
      "the zero-recoveries caveat is PRINTED, not left in a comment",
      HOW_TO_READ.every((sentence) => printed.includes(sentence)),
      "one of the two sentences is missing from the output",
    ),
  );
  const leakedUrl = Object.values(URLS).find((url) => printed.includes(url));
  results.push(
    check("the output names hosts and never a full URL", leakedUrl === undefined, `the output contains a URL`),
  );
  const leakedQuote = Object.values(QUOTES).find((quote) => printed.includes(quote));
  results.push(
    check(
      "and never a quotation, an extract or a line of anybody's prose",
      leakedQuote === undefined,
      `the output contains ${String(leakedQuote?.length)} characters of somebody's prose`,
    ),
  );

  const failed = results.filter((x) => !x.held).length;
  console.log(
    `\n${String(results.length - failed)} of ${String(results.length)} checks held.` +
      (failed > 0
        ? ` ${String(failed)} FAILED — do not believe this tool's verdict until they pass.`
        : " Nothing was fetched from the open web and nothing was spent."),
  );
  if (failed > 0) process.exitCode = 1;
}

/* ------------------------------------------------------------- the free mode -- */

/** A tiny article that exists only so the replay has blocks to resolve against. */
const CHECK_BLOCKS: Block[] = [
  {
    id: "spya-aaaaaa",
    tag: "p",
    kind: "text",
    text: "A starter left at room temperature will fall apart within a week.",
    words: 12,
    html: "<p>…</p>",
    gistable: true,
  },
];

const CHECK_ARTICLE = {
  slug: "check-article",
  url: "https://example.invalid/starter-week-3",
  title: "Notes on my sourdough starter, week 3",
  byline: "Greg Detre",
  inputFingerprint: "check-fingerprint",
};

/** A whole chat completion, in the shape a journal holds one. */
function syntheticAnswer(rows: unknown[], annotations: { url: string; title: string; content: string }[]): unknown {
  return {
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: "Here is what I found.\n\n```debate\n" + JSON.stringify(rows) + "\n```",
          annotations: annotations.map((a) => ({ type: "url_citation", url_citation: a })),
        },
      },
    ],
    usage: { server_tool_use: { web_search_requests: 3 } },
  };
}

const NAMES_IT = {
  url: "https://bakingreview.example/on-gregs-notes",
  title: "On Greg's starter notes",
  content:
    "Greg's Notes on my sourdough starter, week 3 argues for twice-daily feeding, which is " +
    "true in a cool kitchen and wrong in a warm one.",
};

const NAMES_NOTHING = {
  url: "https://myeclecticbites.com/sourdough-starter-notes",
  title: "Sourdough starter notes",
  content: "A starter kept on the counter will collapse in about a week if you feed it once a day.",
};

/**
 * The synthetic journal: three attempts, chosen so the replay has to produce
 * three different answers.
 *
 * - `direct-1` keeps one row and loses one to `directnessUnverified` — Sol's
 *   F24, the rule that two genuine quotations from an unrelated page do not
 *   make a response to this piece.
 * - `claims-1` keeps one row, which is the only path that needs the article's
 *   blocks.
 * - `dead-1` is the OOM shape: a start, and nothing after it.
 */
function syntheticJournal(): DebateJournalEvent[] {
  const start = (attemptId: string, pass: "direct" | "claims"): DebateJournalEvent => ({
    event: "attempt-started",
    attemptId,
    at: new Date().toISOString(),
    pass,
    model: "(check — no model was called)",
    search: { engine: "exa", maxTotalResults: 12, maxResults: 5 },
    prompt: { systemSha256: "0".repeat(64), systemChars: 0, userSha256: "0".repeat(64), userChars: 0 },
    article: CHECK_ARTICLE,
  });
  const response = (attemptId: string, json: unknown): DebateJournalEvent => ({
    event: "provider-response",
    attemptId,
    at: new Date().toISOString(),
    response: { kind: "body", json, answeredBy: "(check)", generationId: `gen-${attemptId}` },
  });
  const finished = (attemptId: string): DebateJournalEvent => ({
    event: "attempt-finished",
    attemptId,
    at: new Date().toISOString(),
    elapsedMs: 1,
    outcome: "ok",
    failure: null,
  });

  return [
    start("direct-1", "direct"),
    response(
      "direct-1",
      syntheticAnswer(
        [
          {
            url: NAMES_IT.url,
            sourceQuote: "true in a cool kitchen and wrong in a warm one",
            articleReferenceQuote: "Notes on my sourdough starter, week 3",
            relation: "qualifies",
            lean: "leans-against",
            applies: "It accepts the schedule only for cool kitchens.",
          },
          {
            url: NAMES_NOTHING.url,
            sourceQuote: "collapse in about a week",
            articleReferenceQuote: "feed it once a day",
            relation: "disputes",
            lean: "leans-against",
            applies: "It never names this piece at all.",
          },
        ],
        [NAMES_IT, NAMES_NOTHING],
      ),
    ),
    finished("direct-1"),
    start("claims-1", "claims"),
    response(
      "claims-1",
      syntheticAnswer(
        [
          {
            url: NAMES_NOTHING.url,
            blockId: "spya-aaaaaa",
            claimQuote: "fall apart within a week",
            sourceQuote: "collapse in about a week",
            relation: "corroborates",
            lean: "leans-for",
            applies: "It reports the same collapse.",
          },
        ],
        [NAMES_NOTHING],
      ),
    ),
    finished("claims-1"),
    start("dead-1", "claims"),
  ];
}

/** A `SpendRecord` with only the fields the cost path reads. */
function syntheticCall(opts: { priced: boolean; job?: string }): SpendRecord {
  return {
    job: (opts.job ?? "debate") as SpendRecord["job"],
    wire: "chat",
    model: "(check)",
    answeredBy: null,
    cost: opts.priced ? { source: "provider", costNanos: 75_000_000 } : { source: "none" },
    upstreamCostNanos: null,
    providerAccount: "openrouter",
    generationId: "gen-check",
    upstream: null,
    credentialFingerprint: null,
    isByok: false,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    cacheWrite5mTokens: null,
    cacheWrite1hTokens: null,
    reasoningTokens: null,
    webSearches: 4,
    serviceTier: null,
    inferenceGeo: null,
    ms: 1,
    outcome: "ok",
  };
}

/** One assertion in the free mode: what was checked, and whether it held. */
function check(claim: string, held: boolean, detail: string): { claim: string; held: boolean; detail: string } {
  console.log(`  ${held ? "ok  " : "FAIL"}  ${claim}`);
  if (!held) console.log(`        ${detail}`);
  return { claim, held, detail };
}

async function commandCheck(): Promise<void> {
  const dir = path.join(RUN_ROOT, `${newRunId()}-check`);
  const results: { held: boolean }[] = [];
  console.log(`A free run of every seam. No model, no network, no database.\nWorking in ${dir}\n`);

  /* --- seam 1: the journal on disk ------------------------------------- */
  console.log("Journal writing");
  const journal = await JournalFile.open(dir);
  const events = syntheticJournal();
  for (const event of events) await journal.write(event);
  const contents = await readJournal(journal.file);
  results.push(check("every event was written down", journal.failures.length === 0, `${String(journal.failures.length)} failed`));
  results.push(
    check(
      "every event read back, in order",
      contents.events.length === events.length && contents.malformedLines.length === 0,
      `${String(contents.events.length)} of ${String(events.length)}, ${String(contents.malformedLines.length)} unreadable`,
    ),
  );
  results.push(
    check(
      "a truncated last line is reported rather than skipped",
      (await truncatedLineIsReported(dir)) === 1,
      "readJournal did not count the half-written line",
    ),
  );

  /* --- seam 2: reconciliation ------------------------------------------ */
  console.log("\nReconciliation");
  const r = reconcile(contents.events);
  results.push(check("the two finished attempts are captured", r.captured === 2, `captured ${String(r.captured)}`));
  results.push(
    check(
      "the OOM-shaped attempt is an unmatched start, not a captured one",
      r.unmatchedStarts === 1 && r.attempts.some((a) => a.status === "unmatched-start"),
      `unmatchedStarts ${String(r.unmatchedStarts)}`,
    ),
  );
  results.push(
    check("a journal with an unmatched start is NOT a complete record", !r.complete, "reconcile called it complete"),
  );
  results.push(
    check(
      "the sentence says the process died, in words nobody can read as a recorded failure",
      reconciliationLines(r).join("\n").includes("the process died or the outcome is unknown"),
      "the wording has drifted",
    ),
  );

  /* --- seam 3: the cost path ------------------------------------------- */
  console.log("\nThe cost path");
  const priced = costOf([syntheticCall({ priced: true }), syntheticCall({ priced: true })], { completed: true });
  results.push(
    check(
      "two priced debate calls are a measurement",
      priced.kind === "measured" && priced.problems.length === 0,
      formatRunCost(priced),
    ),
  );
  const unpriced = costOf([syntheticCall({ priced: true }), syntheticCall({ priced: false })], { completed: true });
  results.push(
    check(
      "one unpriced call makes the whole figure `not measured`, with the count printed",
      unpriced.kind === "not-measured" && formatRunCost(unpriced).includes("1 call(s) reported no cost"),
      formatRunCost(unpriced),
    ),
  );
  const nothing = costOf([], { completed: true });
  results.push(
    check(
      "a completed run with no calls is refused, and its zero never prints as a price",
      nothing.kind === "not-measured" && !formatRunCost(nothing).startsWith("$"),
      formatRunCost(nothing),
    ),
  );
  const three = costOf(
    [syntheticCall({ priced: true }), syntheticCall({ priced: true }), syntheticCall({ priced: true })],
    { completed: true },
  );
  results.push(
    check(
      "a completed run must hold exactly its two search calls",
      three.problems.some((p) => p.includes("exactly 2 search calls")),
      three.problems.join("; "),
    ),
  );
  const foreign = costOf([syntheticCall({ priced: true }), syntheticCall({ priced: true, job: "chat" })], {
    completed: true,
  });
  results.push(
    check(
      "a call from another job inside the slice is named, not silently added",
      foreign.problems.some((p) => p.includes("not the debate job")),
      foreign.problems.join("; "),
    ),
  );

  /* --- seam 4: Layer 1 replay ------------------------------------------ */
  console.log("\nLayer 1 replay");
  const replayed = replayJournal(contents.events, { blockText: blockTextById(CHECK_BLOCKS) });
  for (const line of replayLines(replayed)) console.log(line);
  const direct = replayed.find((x) => x.attemptId === "direct-1");
  const claims = replayed.find((x) => x.attemptId === "claims-1");
  const dead = replayed.find((x) => x.attemptId === "dead-1");
  results.push(
    check(
      "the direct pass keeps the page that names the article",
      direct?.ok === true && direct.group.counts.keptRows === 1,
      JSON.stringify(direct),
    ),
  );
  results.push(
    check(
      "and loses the one that does not, as directnessUnverified",
      direct?.ok === true && direct.group.counts.lost.directnessUnverified === 1,
      JSON.stringify(direct?.ok === true ? direct.group.counts.lost : direct),
    ),
  );
  results.push(
    check(
      "the claims pass resolves its block id against the article's own blocks",
      claims?.ok === true && claims.group.counts.keptRows === 1,
      JSON.stringify(claims),
    ),
  );
  results.push(
    check(
      "an attempt that never heard back is NOT replayed, and says why",
      dead?.ok === false && dead.skipped.includes("never heard back"),
      JSON.stringify(dead),
    ),
  );
  const withoutBlocks = replayJournal(contents.events);
  results.push(
    check(
      "a claims pass with no blocks to hand is skipped rather than reported as all-lost",
      withoutBlocks.find((x) => x.attemptId === "claims-1")?.ok === false,
      "it replayed anyway, and every row would have been unknownBlockId",
    ),
  );

  const failed = results.filter((x) => !x.held).length;
  console.log(
    `\n${String(results.length - failed)} of ${String(results.length)} checks held.` +
      (failed > 0 ? ` ${String(failed)} FAILED — do not spend money until they pass.` : " Nothing was measured and nothing was spent."),
  );
  if (failed > 0) process.exitCode = 1;
}

/** Append half a line and count what `readJournal` says about it. */
async function truncatedLineIsReported(dir: string): Promise<number> {
  const file = path.join(dir, "truncated.jsonl");
  await writeFile(file, '{"event":"attempt-finished","attemptId":"a","outcome":"ok"}\n{"event":"attempt-star', "utf-8");
  return (await readJournal(file)).malformedLines.length;
}

/* ------------------------------------------------------------------- main ---- */

async function main(): Promise<void> {
  const o = parseOptions(process.argv.slice(2));
  switch (o.command) {
    case "check":
      await commandCheck();
      break;
    case "plan":
      await commandPlan(o);
      break;
    case "run":
      await commandRun(o);
      break;
    case "replay":
      await commandReplay(o);
      break;
    case "verify":
      await commandVerify(o);
      break;
    default:
      throw new Error(`unknown command "${o.command}". One of: check, plan, run, replay, verify`);
  }
}

if (isMain(import.meta.url)) {
  /* `withLedger("eval", …)` around everything, including `check`, which spends
     nothing: a collector that is open and records no calls prints nothing, and
     a mode that opened one only on the paid path would be one more thing to
     remember. src/cli-ledger.ts. */
  loadEnvLocal();
  await withLedger("eval", main).catch((err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
