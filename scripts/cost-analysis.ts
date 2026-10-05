#!/usr/bin/env -S npx tsx
/**
 * **The cost analysis an agent can run** — where the money went, already
 * answered, and the leads worth a look.
 *
 *     npm run cost:analyse                              local database, current UTC month
 *     npm run cost:analyse -- --prod --all              production, read-only
 *     npm run cost:analyse -- --prod --month 2026-09 --html --json
 *     npm run cost:analyse -- --since 2026-09-01 --until 2026-10-01
 *     npm run cost:analyse -- --prod --all --lookup-unpriced --commentary notes.md --html logs/cost-reports/x.html
 *
 * docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md
 * § The analysis an agent runs. The arithmetic is src/cost-analysis.ts, which
 * is pure; the report file is scripts/cost-analysis-html.ts. This file reads,
 * prints and writes.
 *
 * ## Which database, and that it cannot be written to
 *
 * **The first line printed is `Target:`**, and it is in the report's header
 * and in the JSON, because which database a figure came from is the first
 * thing to know about it.
 *
 * - `--prod` reads `.env.prod` through `productionClient`
 *   (scripts/feedback-reporter.ts): the production project checked, TLS
 *   verified. Never an ambient `DATABASE_URL`.
 * - Without it, the local database of `.env.local` — and a `DATABASE_URL` that
 *   is not local is refused rather than read under the word "local".
 *
 * Either way both reads happen on one connection inside
 * `begin transaction isolation level repeatable read read only`, rolled back:
 * no write is possible, there is no bare `SET`, and the cube and the detail
 * rows see **one snapshot**, so a call landing between them cannot make them
 * disagree.
 *
 * ## What leaves the database
 *
 * Money, ids, and the names of jobs, steps and models. The administrator's own
 * articles by slug; anybody else's as an opaque id, keyed with 32 random bytes
 * made for this run and kept nowhere (src/store/ai-calls-spend-pg.ts).
 * No prompt, no answer, no article text: the ledger holds none.
 *
 * `--lookup-unpriced` then asks OpenRouter what it recorded for the calls the
 * ledger has no money for (scripts/openrouter-generation.ts): a free GET per
 * call, capped, with the local key.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";

import { ADMIN_USER_ID_LOCAL, ADMIN_USER_ID_PROD, formatCostNanos } from "../src/admin.js";
import {
  type CostAnalysis,
  CostReadsDisagree,
  P95_MIN_CALLS,
  type Lead,
  type UnpricedLookup,
  analyseCosts,
  detailIsUnpriced,
} from "../src/cost-analysis.js";
import type { CostCubeGroup } from "../src/cost-cube.js";
import { partitionByScope } from "../src/cost-report.js";
import { drizzleOver } from "../src/db/client.js";
import { isLocalDatabaseUrl, sslDecisionFor } from "../src/db/ssl.js";
import { loadEnvLocal } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import { authAdminEndpoint, gotruePages, listAccounts } from "../src/store/admin-accounts.js";
import {
  type SpendDetailRow,
  SpendCubeTooLarge,
  SpendDetailTooLarge,
  currentUtcMonth,
  spendCube,
  spendDetail,
} from "../src/store/ai-calls-spend-pg.js";
import { monthRange } from "./ai-cost.js";
import { resolveBuildStamp } from "./build-stamp.js";
import { dayChartMarkup } from "./cost-analysis-chart.js";
import { cellText, renderCostReport, trusted, writePrivateFile } from "./cost-analysis-html.js";
import { CannotTell, productionClient } from "./feedback-reporter.js";
import {
  type GenerationLookup,
  localOpenRouterKey,
  lookupGenerations,
} from "./openrouter-generation.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/** The most generation lookups one run makes. */
export const MAX_LOOKUPS = 400;
const LOOKUP_CONCURRENCY = 4;

/* ---------------------------------------------------------- the arguments -- */

/** Something wrong with the command line. Printed with the usage. */
export class UsageError extends Error {}

export interface CostAnalysisArgs {
  prod: boolean;
  /** ISO; absent for no bound. */
  since?: string;
  until?: string;
  /** The period in words, for the terminal and the report. */
  label: string;
  /** The period as part of a file name. */
  fileLabel: string;
  includeNonProduct: boolean;
  top: number;
  lookupUnpriced: boolean;
  /** Absolute paths; absent when the output was not asked for. */
  json?: string;
  html?: string;
  commentary?: string;
}

const USAGE = `Usage: npm run cost:analyse -- [flags]
  --prod                 read production, read-only (default: the local database)
  --month YYYY-MM        one UTC month (default: the current one)
  --since DATE --until DATE   a half-open UTC range; either may be left out
  --all                  everything recorded
  --include-nonproduct   count eval and CLI spend too (default: product spend only)
  --top N                how many articles get a breakdown (default 15)
  --lookup-unpriced      ask OpenRouter what the calls with no money really cost (free)
  --json [path]          write the analysis as JSON
  --html [path]          write the HTML report
  --commentary FILE      notes to place at the top of the HTML report
Default paths are under logs/cost-reports/.`;

/** `20261005T021500Z`. */
function fileStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function instant(flag: string, value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new UsageError(`${flag} wants a date such as 2026-09-01, got ${JSON.stringify(value)}`);
  }
  return date.toISOString();
}

type Period = Pick<CostAnalysisArgs, "since" | "until" | "label" | "fileLabel">;

/** One period out of the three ways to name one; two at once is refused, not resolved. */
function periodOf(asked: { all: boolean; month?: string | undefined; since?: string | undefined; until?: string | undefined }): Period {
  const { all, month, since, until } = asked;
  const ranged = since !== undefined || until !== undefined;
  if ([all, month !== undefined, ranged].filter(Boolean).length > 1) {
    throw new UsageError("Give one period: --month, or --since/--until, or --all.");
  }
  if (all) return { label: "all recorded calls", fileLabel: "all" };
  if (month !== undefined) {
    try {
      return { ...monthRange(month), label: `${month} (UTC)`, fileLabel: month };
    } catch (err) {
      throw new UsageError((err as Error).message);
    }
  }
  if (!ranged) {
    const current = currentUtcMonth();
    return { since: current.since, until: current.until, label: `${current.label} (UTC)`, fileLabel: current.label };
  }
  if (since !== undefined && until !== undefined && since >= until) {
    throw new UsageError("--since must be earlier than --until.");
  }
  const day = (iso: string | undefined, open: string): string => (iso === undefined ? open : iso.slice(0, 10));
  return {
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
    label: `from ${since ?? "the first call"} to before ${until ?? "now"} (UTC)`,
    fileLabel: `${day(since, "start")}_${day(until, "now")}`,
  };
}

/**
 * The command line, or a `UsageError`. **An unknown flag is an error**: a flag
 * silently ignored is a report over a period, a database or a scope nobody
 * asked for, and it looks exactly like the one they did.
 */
export function parseCostAnalysisArgs(
  argv: readonly string[],
  now: Date = new Date(),
  root: string = ROOT,
): CostAnalysisArgs {
  const rest = [...argv];
  let prod = false;
  let all = false;
  let month: string | undefined;
  let since: string | undefined;
  let until: string | undefined;
  let includeNonProduct = false;
  let top = 15;
  let lookupUnpriced = false;
  let json: string | true | undefined;
  let html: string | true | undefined;
  let commentary: string | undefined;

  const value = (flag: string): string => {
    const v = rest.shift();
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  /* `--html` alone means the default path; `--html x.html` names one. */
  const optional = (): string | true => {
    const v = rest[0];
    if (v === undefined || v.startsWith("--")) return true;
    rest.shift();
    return v;
  };

  while (rest.length > 0) {
    const flag = rest.shift() as string;
    switch (flag) {
      case "--prod":
        prod = true;
        break;
      case "--all":
        all = true;
        break;
      case "--month":
        month = value(flag);
        break;
      case "--since":
        since = instant(flag, value(flag));
        break;
      case "--until":
        until = instant(flag, value(flag));
        break;
      case "--include-nonproduct":
        includeNonProduct = true;
        break;
      case "--top": {
        const raw = value(flag);
        top = Number(raw);
        if (!Number.isInteger(top) || top < 1) {
          throw new UsageError(`--top wants a whole number of at least 1, got ${JSON.stringify(raw)}`);
        }
        break;
      }
      case "--lookup-unpriced":
        lookupUnpriced = true;
        break;
      case "--json":
        json = optional();
        break;
      case "--html":
        html = optional();
        break;
      case "--commentary":
        commentary = path.resolve(value(flag));
        break;
      default:
        throw new UsageError(`Unknown flag ${JSON.stringify(flag)}`);
    }
  }

  const period = periodOf({ all, month, since, until });
  const target = prod ? "production" : "local";
  const defaultPath = (extension: string): string =>
    path.join(root, "logs", "cost-reports", `cost-${target}-${period.fileLabel}-${fileStamp(now)}.${extension}`);
  const out = (asked: string | true | undefined, extension: string): string | undefined =>
    asked === undefined ? undefined : asked === true ? defaultPath(extension) : path.resolve(asked);
  const jsonPath = out(json, "json");
  const htmlPath = out(html, "html");

  return {
    prod,
    ...period,
    includeNonProduct,
    top,
    lookupUnpriced,
    ...(jsonPath === undefined ? {} : { json: jsonPath }),
    ...(htmlPath === undefined ? {} : { html: htmlPath }),
    ...(commentary === undefined ? {} : { commentary }),
  };
}

/* ------------------------------------------------------------ the database -- */

/** What `readSnapshot` needs of a `pg.Client`. */
export type SnapshotClient = Pick<pg.Client, "connect" | "query" | "end">;

/**
 * Connect, do `work` inside one read-only snapshot, roll back, close.
 *
 * `repeatable read` so every statement in `work` sees the same rows; `read
 * only` so none of them can write. Declared on the `begin` itself — never a
 * bare `SET`, which a transaction pooler would apply to somebody else's
 * session (docs/project/database.md). A rollback that fails replaces the
 * result: without it the read did not keep its contract.
 */
export async function readSnapshot<T>(client: SnapshotClient, work: () => Promise<T>): Promise<T> {
  try {
    await client.connect();
    await client.query("begin transaction isolation level repeatable read read only");
    try {
      return await work();
    } finally {
      await client.query("rollback");
    }
  } finally {
    await client.end();
  }
}

export interface Target {
  kind: "local" | "production";
  /** The file and host, or the local address. Never a credential. */
  description: string;
  client: pg.Client;
  /** Whose slugs may be named. */
  adminOwnerId: string;
}

/** The local database of `.env.local`, or a refusal when `DATABASE_URL` is not local. */
export function localTarget(): Target {
  loadEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new CannotTell("DATABASE_URL is not set: npm run db:start, then it comes from .env.local.");
  }
  if (!isLocalDatabaseUrl(url)) {
    throw new CannotTell(
      "DATABASE_URL does not point at a local database, so this is not a local report. Use --prod to read production.",
    );
  }
  const parsed = new URL(url);
  const ssl = sslDecisionFor(url);
  return {
    kind: "local",
    description: `the local database at ${parsed.host}${parsed.pathname}`,
    client: new pg.Client({ connectionString: url, ssl: ssl.ssl }),
    adminOwnerId: ADMIN_USER_ID_LOCAL,
  };
}

function productionTarget(): Target {
  const { client, target } = productionClient();
  return { kind: "production", description: target, client, adminOwnerId: ADMIN_USER_ID_PROD };
}

/* ---------------------------------------------------------------- emails -- */

interface Emails {
  emails: Map<string, string | null>;
  /** Where the labels came from, in words, for the report's header. */
  note: string;
}

/** The header's words for a production report's users. */
export const PRODUCTION_USERS_NOTE =
  "users are shown by id: production email addresses are not read from the box";

/** The local Auth service's accounts: the listing `/api/admin/costs` uses, on the local stack. */
export type AccountListing = () => Promise<readonly { id: string; email: string | null }[]>;

const localAccounts: AccountListing = () => {
  const { url, key } = authAdminEndpoint();
  return listAccounts(gotruePages(url, key, AbortSignal.timeout(20_000)));
};

/**
 * Owner id → email, **for a local report only**.
 *
 * A production report labels users by id. Reading production is bounded to
 * the read-only database transaction above; asking the production Auth
 * service for its account list would take the service-role key, which this
 * script never reads — the only thing it takes from `.env.prod` is the
 * database address, through `productionClient`. So for production `listing`
 * is not called at all.
 *
 * **Never fatal** locally: a report without emails labels users by id and
 * says so, as a category and never as an error's own text.
 */
export async function readEmails(
  kind: Target["kind"],
  listing: AccountListing = localAccounts,
): Promise<Emails> {
  if (kind === "production") return { emails: new Map(), note: PRODUCTION_USERS_NOTE };
  try {
    const accounts = await listing();
    return {
      emails: new Map(accounts.map((a) => [a.id, a.email])),
      note: "by email, from the local Auth service's account list; an account it does not know is shown as an id",
    };
  } catch {
    return {
      emails: new Map(),
      note: "shown as ids (user 001bb7a0): the local Auth service's account list could not be read",
    };
  }
}

/* --------------------------------------------------------------- lookups -- */

interface LookupRun {
  lookups: Map<string, UnpricedLookup>;
  lines: string[];
}

/**
 * The money an OpenRouter generation record establishes for an unpriced call.
 * A missing cost, or a record whose BYOK status does not say which pocket the
 * figure belongs in, is "could not check" — never a known zero.
 */
export function unpricedLookupOfGeneration(answer: GenerationLookup): UnpricedLookup {
  if (answer.kind === "no-record") return { kind: "no-record" };
  if (answer.kind === "failed") return { kind: "failed" };
  if (answer.isByok === false && answer.totalCostNanos !== null) {
    return { kind: "found", creditsNanos: answer.totalCostNanos, upstreamNanos: 0 };
  }
  if (
    answer.isByok === true &&
    answer.totalCostNanos !== null &&
    answer.upstreamCostNanos !== null
  ) {
    return {
      kind: "found",
      creditsNanos: answer.totalCostNanos,
      upstreamNanos: answer.upstreamCostNanos,
    };
  }
  return { kind: "failed" };
}

/**
 * Ask OpenRouter about the unpriced calls in scope that carry a generation
 * id, the most recent first, up to the cap. Prints what was asked and what
 * came back; a lookup that failed stays "could not check".
 */
async function lookupUnpriced(
  detail: readonly SpendDetailRow[],
  includeNonProduct: boolean,
): Promise<LookupRun> {
  const key = localOpenRouterKey();
  if (key === null) {
    throw new CannotTell("--lookup-unpriced needs an OpenRouter key in .env.local, and there is none.");
  }
  const scoped = includeNonProduct ? [...detail] : partitionByScope(detail).product;
  const askable = scoped
    .filter((row) => detailIsUnpriced(row) && row.generationId !== null)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const asking = askable.slice(0, MAX_LOOKUPS);
  const answers = await lookupGenerations(
    asking,
    (row) => row.generationId as string,
    (row) => row.id,
    key,
    { concurrency: LOOKUP_CONCURRENCY },
  );
  const lookups = new Map<string, UnpricedLookup>();
  const tally = { found: 0, noRecord: 0, failed: 0 };
  for (const [id, answer] of answers) {
    const lookup = unpricedLookupOfGeneration(answer);
    if (lookup.kind === "found") {
      tally.found++;
    } else if (lookup.kind === "no-record") {
      tally.noRecord++;
    } else {
      tally.failed++;
    }
    lookups.set(id, lookup);
  }
  const skipped = askable.length - asking.length;
  return {
    lookups,
    lines: [
      `Asked OpenRouter about ${asking.length} unpriced call(s) with a generation id` +
        (skipped > 0 ? ` (the most recent ${MAX_LOOKUPS}; ${skipped} more were not asked)` : "") +
        `: ${tally.found} matched a record, ${tally.noRecord} had no record, ${tally.failed} failed (could not check).`,
    ],
  };
}

/* ------------------------------------------------------------ the summary -- */

const money = formatCostNanos;
const whole = (n: number): string => n.toLocaleString("en-US");
const share = (value: number | null): string =>
  value === null ? "—" : value > 0 && value < 0.01 ? "<1%" : `${Math.round(value * 100)}%`;

function ranking(
  title: string,
  rows: readonly { label: string; recordedNanos: number; share: number | null; calls: number }[],
  extra: (index: number) => string = () => "",
): string[] {
  const shown = rows.slice(0, 10);
  const width = Math.min(48, Math.max(8, ...shown.map((r) => r.label.length)));
  return [
    "",
    `${title}${rows.length > shown.length ? ` (top ${shown.length} of ${rows.length})` : ""}`,
    ...shown.map(
      (r, i) =>
        `  ${r.label.slice(0, width).padEnd(width)}  ${money(r.recordedNanos).padStart(10)}  ${share(r.share).padStart(4)}  ${whole(r.calls).padStart(7)} calls${extra(i)}`,
    ),
  ];
}

function leadLines(lead: Lead): string[] {
  const amount = lead.amountNanos > 0 ? money(lead.amountNanos) : "no amount claimed";
  return [
    "",
    `  ${lead.title} — ${amount} [${lead.confidence}]`,
    `    ${lead.detail}`,
    ...lead.evidence.facts.map((f) => `    · ${f.label}: ${cellText(f.value)}`),
  ];
}

/**
 * The terminal summary: the target, the period, the totals, the four rankings
 * and the leads. Lines, so a test can read them. The Target line is first.
 */
export function summaryLines(a: CostAnalysis): string[] {
  const t = a.totals;
  const lines = [
    `Target: ${a.target.kind === "production" ? "PRODUCTION (read-only)" : "local"} — ${a.target.description}`,
    `Period: ${a.window.label}${t.firstDay ? `; calls from ${t.firstDay} to ${t.lastDay} (UTC days)` : ""}`,
    a.scope === "product"
      ? `Covers: product spend only. Left out: ${whole(a.excluded.calls)} eval and CLI call(s), ${money(a.excluded.recordedNanos)} (--include-nonproduct counts them).`
      : "Covers: everything — product spend, evals and the developer CLI.",
    `Users:  ${a.userLabels}`,
    "",
    `Recorded amount   ${money(t.recordedNanos)}   = credits ${money(t.creditsNanos)} + provider keys ${money(t.byokNanos)} + priced by us ${money(t.computedNanos)}`,
    `  exact nano-dollars: credits ${t.creditsNanos}, provider keys ${t.byokNanos}, priced by us ${t.computedNanos}`,
    `Estimated cash    ${money(t.estimatedCashNanos)}   (OpenRouter's fee added to the credits only)`,
    `Calls             ${whole(t.calls)}: ${whole(t.pricedCalls)} priced, ${whole(t.unpricedCalls)} reporting no money` +
      (t.unpricedCalls > 0 ? " — so the recorded amount is a floor" : ""),
    `Failed or stopped ${whole(t.failedCalls)} call(s), ${money(t.failedRecordedNanos)} recorded on them`,
  ];
  if (a.lookup) {
    lines.push(
      `Known shortfall   ${money(a.lookup.knownShortfallNanos)} on ${whole(a.lookup.found)} unpriced call(s) OpenRouter has a record of ` +
        `(credits ${money(a.lookup.creditsNanos)}, provider keys ${money(a.lookup.upstreamNanos)}); ` +
        `${whole(a.lookup.noRecord)} no record, ${whole(a.lookup.failed)} could not check, ${whole(a.lookup.notAsked)} not asked, ${whole(a.lookup.noGenerationId)} with no id to ask about`,
    );
  }
  lines.push(
    ...ranking("Users", a.users),
    ...ranking(
      `Articles (median article ${money(a.articles.medianNanos)}, ${whole(a.articles.count)} with any call)`,
      a.articles.top,
      (i) => {
        const article = a.articles.top[i];
        if (!article) return "";
        const times = article.timesMedian === null ? "" : `  ${article.timesMedian.toFixed(1)}× median`;
        return `${times}  mostly ${article.byTask[0]?.label ?? "—"}`;
      },
    ),
    ...ranking("Modes or tasks", a.tasks, (i) => {
      const per = a.tasks[i]?.perCall;
      if (!per) return "";
      /* A p95 of a handful of calls is the largest call again: a dash. */
      const p95 = per.calls >= P95_MIN_CALLS ? money(per.p95Nanos) : "—";
      return `  per call: median ${money(per.medianNanos)}, p95 ${p95}, max ${money(per.maxNanos)}`;
    }),
    ...ranking("Answering models", a.models),
    "",
    a.leads.length > 0 ? "Leads, most money first:" : "Leads: none — there are no calls in this period.",
    ...a.leads.flatMap(leadLines),
  );
  return lines;
}

/* -------------------------------------------------------------------- run -- */

/** Errors whose own words are safe and useful to print. Anything else is a database or network error. */
function isOurs(err: unknown): err is Error {
  return (
    err instanceof UsageError ||
    err instanceof CannotTell ||
    err instanceof CostReadsDisagree ||
    err instanceof SpendCubeTooLarge ||
    err instanceof SpendDetailTooLarge
  );
}

export async function main(argv: readonly string[]): Promise<number> {
  let args: CostAnalysisArgs;
  try {
    args = parseCostAnalysisArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`${err.message}\n\n${USAGE}`);
    return 2;
  }

  try {
    let commentary: string | null = null;
    if (args.commentary !== undefined) {
      try {
        commentary = readFileSync(args.commentary, "utf8");
      } catch {
        /* Before any read, so a typo in the path costs nothing. */
        throw new CannotTell(`--commentary: cannot read ${args.commentary}`);
      }
    }
    const target = args.prod ? productionTarget() : localTarget();
    /* First, before anything is read. */
    console.log(
      `Target: ${target.kind === "production" ? "PRODUCTION (read-only)" : "local"} — ${target.description}`,
    );

    /* For this run only: the hashes need to be stable inside one report and
       nowhere else, so the key is kept nowhere. */
    const privacyKey = randomBytes(32).toString("hex");
    const { cube, detail } = await readSnapshot(target.client, async () => {
      const db = drizzleOver(target.client);
      const groups: CostCubeGroup[] = await spendCube(
        args.since,
        args.until,
        target.adminOwnerId,
        privacyKey,
        undefined,
        db,
      );
      const rows = await spendDetail(args.since, args.until, target.adminOwnerId, privacyKey, { db });
      return { cube: groups, detail: rows };
    });

    const labels = await readEmails(target.kind);
    let lookups: Map<string, UnpricedLookup> | null = null;
    if (args.lookupUnpriced) {
      const run = await lookupUnpriced(detail, args.includeNonProduct);
      lookups = run.lookups;
      for (const line of run.lines) console.log(line);
    }

    const analysis = analyseCosts({
      target: { kind: target.kind, description: target.description },
      window: { since: args.since ?? null, until: args.until ?? null, label: args.label },
      generatedAt: new Date().toISOString(),
      cube,
      detail,
      emails: labels.emails,
      userLabels: labels.note,
      includeNonProduct: args.includeNonProduct,
      top: args.top,
      lookups,
    });

    /* The Target line is already out; the summary's own copy of it is skipped. */
    for (const line of summaryLines(analysis).slice(1)) console.log(line);

    await writeOutputs(args, analysis, commentary);
    return 0;
  } catch (err) {
    console.error(failureLine(err, args.prod));
    return 1;
  }
}

/** The JSON and the HTML report, each private, each path printed. */
async function writeOutputs(
  args: CostAnalysisArgs,
  analysis: CostAnalysis,
  commentary: string | null,
): Promise<void> {
  if (args.json === undefined && args.html === undefined) return;
  console.log("");
  if (args.json !== undefined) {
    console.log(`JSON:  ${writePrivateFile(args.json, `${JSON.stringify(analysis, null, 1)}\n`)}`);
  }
  if (args.html !== undefined) {
    let chart: Awaited<ReturnType<typeof dayChartMarkup>> | null = null;
    try {
      chart = await dayChartMarkup(analysis);
    } catch (err) {
      console.error(`The per-day chart could not be drawn (${(err as Error).name}); the report has the table.`);
    }
    const stamp = resolveBuildStamp();
    const report = renderCostReport(analysis, {
      commentary,
      chart: chart === null ? null : trusted(chart.markup),
      commit: stamp.commit === "unknown" ? null : stamp.commit.slice(0, 9),
    });
    console.log(`HTML:  ${writePrivateFile(args.html, report)}`);
  }
  console.log("Private: readable by you only (mode 0600), and not uploaded or served anywhere.");
}

/**
 * What to print for a failure. Our own errors speak for themselves. A database
 * or parser error can carry connection details, and production's are secrets:
 * its code alone (`ECONNREFUSED`, `28P01`) is safe, and is most of a
 * diagnosis. The local stack has no secret to carry, so there the message is
 * printed.
 */
export function failureLine(err: unknown, prod: boolean): string {
  if (isOurs(err)) return err.message;
  const code = (err as { code?: unknown } | null)?.code;
  const safeCode = typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? ` [${code}]` : "";
  const name = err instanceof Error ? err.name : "error";
  const said = prod ? "(other details withheld)" : err instanceof Error ? err.message : String(err);
  return `The cost analysis failed: ${name}${safeCode} ${said}`;
}

/* Run only when run, so a test can import without the process exiting under it. */
if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
