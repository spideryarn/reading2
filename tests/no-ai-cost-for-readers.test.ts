/**
 * **What an AI call costs us reaches the administrator and nobody else.**
 *
 * Greg, 2026-09-30:
 *
 * > that cost information should only be available to me (i.e. admin users). i
 * > don't want any regular users to know how much AI processing of their
 * > articles costs
 *
 * A reader may be told what something costs *them* — in articles, or in their
 * subscription's price. Never what a model call costs *us*: not a ledger figure,
 * and not a hand-written estimate like "about $0.20" either.
 * docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md § 3.
 *
 * Two guards, because the leak has two shapes:
 *
 * 1. **A figure written into reader copy.** Every string and every piece of JSX
 *    text under `src/web/`, every runtime module that tree imports (including
 *    shared copy in `src/billing-plan.ts` and `src/mode-catalog.ts`), the
 *    messages and export-copy sinks, and every raw text asset under `src/web/`
 *    the client can import (`changelog-versions.ndjson`, which `/changelog`
 *    shows every visitor), is scanned for an amount of money:
 *    `$0.20`, `£8`, `€9`, `USD 5`, `20¢`, `20p`, `20 cents`. Comments are not
 *    scanned — they are for developers, and the measured figures in them are
 *    useful there. The few exact exceptions are listed with their reasons.
 * 2. **A cost on a payload.** A walker fails on any object key matching
 *    `cost|spend|nanos|usd|price`, or any string value carrying an amount of
 *    money, at any depth.
 *
 * **Part 2 is a targeted audit of named DTOs, not a sweep of every response.**
 * It runs for real on the billing summary (`GET /api/billing/usage`, store reads
 * stubbed), and on the admin cost route as the control that proves it can see a
 * leak. Standing up the metadata route, the article routes and the job list
 * needs a seeded Postgres article, which is a lot of machinery for a question
 * about the *shape* of a payload, so those four are checked on their declared
 * wire types at compile time (`npm run typecheck`, which covers tests/ — vitest
 * itself never type-checks): every key of `ArticleMetadata`, `Article` (the
 * owner's `/api/article`), `PublicArticle` (a visitor's) and `Job`, at any
 * depth. That catches a cost field added to the contract, which is how one
 * would arrive; it cannot catch a handler that spreads an undeclared row into a
 * response behind the type's back, nor a string value written at run time. The
 * export bundle is held by its coverage record. Who may *reach* the admin
 * route — the authorisation half — is tests/admin-article-cost-route.test.ts's
 * 403 case.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, relative } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArticleCost } from "../src/admin.js";
import type { BillingSummary } from "../src/billing-plan.js";
import type { PublicArticle } from "../src/public-types.js";
import type { AccountSnapshot, Usage } from "../src/store/pg-billing.js";
import type { TierRow } from "../src/billing/tiers.js";
import type { Article, ArticleMetadata, Job } from "../src/types.js";
import type { OwnerId } from "../src/owner.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";
import { dynamicImportSpec, type AstNode, lineOf, parseSource, walkAst } from "./helpers/ts-ast.js";

const ROOT = join(import.meta.dirname, "..");

/* ------------------------------------------------ 1. figures in reader copy -- */

/**
 * **An amount of money, in any of the ways copy writes one.** One pattern, used
 * by both guards, so the source scan and the payload walker cannot disagree
 * about what a figure is.
 *
 * `20p` is matched with a word boundary after the `p`, so `20px` is not; `20
 * cents` needs the number next to the word, so `20 percent` is not.
 */
const CURRENCY_FIGURE = new RegExp(
  [
    String.raw`[$£€¢]\s?\d`, // $0.20, £8, €9
    String.raw`\b(?:USD|GBP|EUR|US\$)\s?\d`, // USD 5, US$5
    String.raw`\b\d+(?:[.,]\d+)?\s?(?:USD|GBP|EUR)\b`, // 5 USD
    String.raw`\d\s?¢`, // 20¢
    String.raw`\b\d+(?:\.\d+)?p\b`, // 20p
    String.raw`\b\d+(?:[.,]\d+)?\s?(?:cents?|pence|penny|pennies|dollars?|pounds?|euros?)\b`, // 20 cents
  ].join("|"),
  "i",
);
/**
 * A template piece that **ends** in a currency sign, so the figure is the
 * interpolation after it: `` `$${amount}` ``. The regex above cannot see that,
 * because the digit is not in the source.
 */
const CURRENCY_BEFORE_INTERPOLATION = /(?:[$£€]|\b(?:USD|GBP|EUR|US\$))\s*$/i;
const CURRENCY_AFTER_INTERPOLATION =
  /^\s*(?:USD|GBP|EUR|dollars?|pounds?|euros?|cents?|pence|penny|pennies)\b/i;
const CURRENCY_TOKEN = /^\s*(?:[$£€]|USD|GBP|EUR|US\$)\s*$/i;

/**
 * **Files allowed to carry a currency figure, and only these.** Each one either
 * shows the reader what *they* pay, or is drawn for the administrator alone.
 * A new entry needs a reason as good as these.
 */
const ALLOWED: Record<string, readonly string[]> = {
  /* Exact plan-card strings: the subscription prices a reader pays. An extra
     amount in this file still fails rather than inheriting a file-wide pass. */
  "src/web/PlanCards.tsx": ["$10", "£8 · €9", "$50", "£40 · €45"],
  /* The formatter is used only on authenticated admin surfaces. These are
     dynamic prefixes, not estimates embedded in the bundle. */
  "src/admin.ts": ["$", "$"],
  /* A regular-expression replacement group in reader-visible prose parsing. */
  "src/referee-candidates.ts": ["$1"],
  /* **The two admin surfaces need no entry**, though the plan expected them
     to: src/web/ArticleCost.tsx (the metadata page's *What it cost*, drawn only
     when `isAdmin`, from `/api/admin/articles/:slug/cost`) and
     src/web/admin-columns.tsx (the admin users table's spend column) both draw
     their figures with `formatSpendNanos` from src/admin.ts, outside this scan,
     and write no literal of their own. Listing them would be a stale entry the
     test below refuses. */
};

/** TypeScript source files whose runtime strings can become reader copy. */
const SOURCE = /\.tsx?$/;
/**
 * Raw text assets a client module can import with `?raw` or as JSON — today
 * only `changelog-versions.ndjson`, which ChangelogPage.tsx draws for every
 * visitor. By extension rather than by name, so the next one is scanned too.
 */
const RAW_TEXT = /\.(?:ndjson|json|md|txt|html|csv)$/;

/** Every file under `src/web/` matching `pattern`, repo-relative. */
function filesUnderWeb(pattern: RegExp): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (pattern.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        out.push(relative(ROOT, full));
      }
    }
  };
  walk(join(ROOT, "src/web"));
  return out.sort();
}

/** Resolve one relative TypeScript/JavaScript import to the source Vite loads. */
function resolveSourceImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const clean = specifier.replace(/[?#].*$/, "");
  const base = join(ROOT, dirname(importer), clean);
  const candidates = clean.endsWith(".js")
    ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`]
    : [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ? relative(ROOT, found) : null;
}

/** Runtime imports and re-exports in one module; type-only edges carry no copy. */
function sourceImports(file: string): string[] {
  const ast = parseSource(readFileSync(join(ROOT, file), "utf8"));
  const found = new Set<string>();
  walkAst(ast.program, (node: AstNode) => {
    const dynamic = dynamicImportSpec(node);
    if (dynamic?.spec) {
      const resolved = resolveSourceImport(file, dynamic.spec);
      if (resolved) found.add(resolved);
      return;
    }
    if (
      node.type !== "ImportDeclaration" &&
      node.type !== "ExportNamedDeclaration" &&
      node.type !== "ExportAllDeclaration"
    ) {
      return;
    }
    if (node.importKind === "type" || node.exportKind === "type") return;
    const specifiers = (node.specifiers ?? []) as AstNode[];
    if (
      node.type === "ImportDeclaration" &&
      specifiers.length > 0 &&
      specifiers.every((specifier) => specifier.importKind === "type")
    ) {
      return;
    }
    const value = (node.source as AstNode | undefined)?.value;
    if (typeof value !== "string") return;
    const resolved = resolveSourceImport(file, value);
    if (resolved) found.add(resolved);
  });
  return [...found];
}

/** Every source module whose runtime strings can enter the browser bundle. */
function clientSourceFiles(): string[] {
  const seen = new Set(filesUnderWeb(SOURCE));
  const queue = [...seen];
  while (queue.length > 0) {
    const file = queue.shift();
    if (!file) continue;
    for (const imported of sourceImports(file)) {
      if (!SOURCE.test(imported) || seen.has(imported)) continue;
      seen.add(imported);
      queue.push(imported);
    }
  }
  return [...seen].sort();
}

/** Reader-copy sinks outside the browser's module graph. */
const READER_COPY_SINKS = [
  "src/messages.ts",
  "src/store/export-bundle.ts",
  "src/store/article-rows.ts",
] as const;

/** Every amount of money in a raw text asset, by line. All of it is copy. */
function currencyFiguresInText(text: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    const m = CURRENCY_FIGURE.exec(line);
    if (m) found.push({ line: i + 1, text: line.slice(Math.max(0, m.index - 60), m.index + 60) });
  }
  return found;
}

/**
 * Every currency figure in a file's **strings and JSX text**, never its comments.
 *
 * A parser rather than a comment-stripping regex: a `//` inside a URL string,
 * or a `/*` inside a template, would desynchronise a character scan and let it
 * go quiet — tests/helpers/ts-ast.ts § *Why a parser*. Babel attaches comments
 * to nodes rather than making them nodes, and `walkAst` skips them.
 */
function currencyFiguresIn(source: string): { line: number; text: string }[] {
  const ast = parseSource(source);
  /* A file the parser could not read must not pass by being unread. */
  if (ast.errors?.length) {
    throw new Error(`could not parse: ${ast.errors.map((e) => e.message).join("; ")}`);
  }
  const found: { line: number; text: string }[] = [];
  walkAst(ast.program, (node: AstNode, parent: AstNode | null) => {
    let text: string | undefined;
    let beforeInterpolation = false;
    switch (node.type) {
      case "StringLiteral":
      case "JSXText":
        text = String(node.value);
        break;
      case "TemplateElement": {
        const value = node.value as { cooked?: string | null; raw: string };
        text = value.cooked ?? value.raw;
        /* The last quasi has no interpolation after it. */
        beforeInterpolation = node.tail !== true;
        break;
      }
      default:
        return;
    }
    /* An import path or a type-level string is not copy. */
    if (parent?.type === "ImportDeclaration" || parent?.type === "ExportNamedDeclaration") return;
    if (
      CURRENCY_FIGURE.test(text) ||
      (beforeInterpolation && CURRENCY_BEFORE_INTERPOLATION.test(text)) ||
      (node.type === "TemplateElement" && CURRENCY_AFTER_INTERPOLATION.test(text)) ||
      (parent?.type === "BinaryExpression" && parent.operator === "+" && CURRENCY_TOKEN.test(text))
    ) {
      found.push({ line: lineOf(node), text: text.trim().slice(0, 120) });
    }
  });
  return found;
}

describe("no AI-cost figure in reader copy", () => {
  it("the scanner finds a figure in a string, in JSX text and before an interpolation — and not in a comment", () => {
    /* The control: a scanner that matches nothing would pass everything below. */
    const sample = [
      `// about $0.20 in a line comment, and https://example.com/$1`,
      `/* about $0.20 in a block comment */`,
      `const url = "https://example.com/path"; // a URL is not a comment`,
      `const a = "Sketch costs about $0.20.";`,
      `const b = <p>Costs {/* $9 hidden */} £8 a month</p>;`,
      "const c = `Costs $${amount} a run`;",
      `const c2 = \`Costs USD \${amount} a run\`;`,
      `const c3 = \`Costs \${amount} dollars a run\`;`,
      `const c4 = "$" + amount;`,
      `const d = "USD 5 a run";`,
      `const e = "about 20¢";`,
      `const f = "20p each";`,
      `const g = "about 20 cents";`,
      `const h = "roughly 3 dollars";`,
      `const h2 = "roughly 0.20 USD";`,
      `const i = "width: 20px; 20 percent; 2026-09-30; v2.3p1";`,
    ].join("\n");
    const found = currencyFiguresIn(sample);
    expect(found.map((f) => f.line)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("the raw-text scanner finds a figure in a changelog-shaped line — its own control", () => {
    const sample = [
      `{"body": "Captions are drawn beneath each picture."}`,
      `{"body": "Illustrating an article is estimated at $0.40 to $0.65."}`,
      `{"body": "Now 20 percent faster, in a 20px column."}`,
    ].join("\n");
    expect(currencyFiguresInText(sample).map((f) => f.line)).toEqual([2]);
  });

  it("every allow-listed file still carries a figure, so the list is not stale", () => {
    for (const [file, allowed] of Object.entries(ALLOWED)) {
      const found = currencyFiguresIn(readFileSync(join(ROOT, file), "utf8")).map((item) => item.text);
      expect(found, `${file}'s allowed reader prices changed`).toEqual(allowed);
    }
  });

  it("scans the browser's shared-module closure and the non-browser reader-copy sinks", () => {
    const files = [...clientSourceFiles(), ...READER_COPY_SINKS];
    /* The walk found the tree, not an empty directory. */
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("src/billing-plan.ts");
    expect(files).toContain("src/mode-catalog.ts");
    expect(files).toContain("src/store/export-bundle.ts");
    const leaks: string[] = [];
    for (const file of files) {
      const allowed = [...(ALLOWED[file] ?? [])];
      for (const f of currencyFiguresIn(readFileSync(join(ROOT, file), "utf8"))) {
        const allowedAt = allowed.indexOf(f.text);
        if (allowedAt !== -1) {
          allowed.splice(allowedAt, 1);
          continue;
        }
        leaks.push(`${file}:${f.line}  ${f.text}`);
      }
    }
    expect(leaks, "a currency figure in reader copy — say what the reader waits for, not what it costs us").toEqual([]);
  });

  it("no raw text asset under src/web/ carries one either", () => {
    const files = filesUnderWeb(RAW_TEXT);
    /* The changelog is the one that matters, and it is really in the list. */
    expect(files).toContain("src/web/changelog-versions.ndjson");
    const leaks: string[] = [];
    for (const file of files) {
      if (file in ALLOWED) continue;
      for (const f of currencyFiguresInText(readFileSync(join(ROOT, file), "utf8"))) {
        leaks.push(`${file}:${f.line}  …${f.text}…`);
      }
    }
    expect(leaks, "a currency figure in a text asset the client shows").toEqual([]);
  });
});

/* --------------------------------------------- 2. cost fields on a payload -- */

const COST_KEY = /cost|spend|nanos|usd|price|amount|currency|dollars?|pounds?|euros?|cents?|pence/i;

function costInString(value: string, path: string, allow: (path: string) => boolean): string | undefined {
  if (!CURRENCY_FIGURE.test(value) || allow(path)) return undefined;
  return `${path} = ${JSON.stringify(value)}`;
}

/**
 * Every path in a JSON value where a cost shows: a key naming one, or a string
 * value carrying an amount of money (`{"message": "about $0.20"}`).
 *
 * `allow` takes the path (`purchase.tiers.0.amounts.usd`) and says whether
 * this one match is the reader's own cost rather than ours.
 */
function costLeaks(value: unknown, allow: (path: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string") {
      const leak = costInString(v, path, allow);
      if (leak) out.push(leak);
      return;
    }
    if (Array.isArray(v)) {
      for (const [i, item] of v.entries()) walk(item, `${path}.${i}`);
      return;
    }
    if (v && typeof v === "object") {
      for (const [key, child] of Object.entries(v)) {
        const at = path ? `${path}.${key}` : key;
        if (COST_KEY.test(key) && !allow(at)) out.push(at);
        walk(child, at);
      }
    }
  };
  walk(value, "");
  return out;
}

/* ---- the stubbed stores: the admin control's, and the billing summary's ---- */

const billing = vi.hoisted(() => ({
  row: undefined as AccountSnapshot | undefined,
}));

vi.mock("../src/store/pg.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/pg.js")>("../src/store/pg.js");
  return {
    ...actual,
    ownedArticleIdentity: async () => ({
      id: "00000000-0000-4000-8000-0000000c0571",
      createdAt: new Date("2026-09-01"),
    }),
  };
});

vi.mock("../src/store/ai-calls-spend-pg.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/ai-calls-spend-pg.js")>(
    "../src/store/ai-calls-spend-pg.js",
  );
  return {
    ...actual,
    spendForArticle: async () => [
      {
        scopeKind: "job_step",
        job: "glossary",
        stepName: "glossary",
        calls: 2,
        creditsNanos: 30_000_000,
        byokNanos: 0,
        computedNanos: 0,
        computedCalls: 0,
        unpricedCalls: 0,
        nonOkCalls: 0,
        firstAt: new Date("2026-09-30T10:00:00.000Z"),
        lastAt: new Date("2026-09-30T10:05:00.000Z"),
      },
    ],
    silentLiveSessionsForArticle: async () => 0,
  };
});

/** Two tiers a reader could buy, shaped like `billing_tiers` rows. */
const TIERS: readonly TierRow[] = [
  {
    id: "reader",
    productName: "Spideryarn Reader",
    description: "For reading regularly",
    ingestsPerPeriod: 30,
    lookupKey: "reader_monthly",
    stripePriceId: "price_test_reader",
    livemode: false,
    active: true,
    sortOrder: 1,
    amounts: { usd: 1000, gbp: 800, eur: 900 },
  },
  {
    id: "researcher",
    productName: "Spideryarn Researcher",
    description: "For reading a lot",
    ingestsPerPeriod: 200,
    lookupKey: "researcher_monthly",
    stripePriceId: "price_test_researcher",
    livemode: false,
    active: true,
    sortOrder: 2,
    amounts: { usd: 5000, gbp: 4000, eur: 4500 },
  },
];

vi.mock("../src/store/pg-tiers.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/pg-tiers.js")>(
    "../src/store/pg-tiers.js",
  );
  return { ...actual, allTiers: async () => TIERS };
});

vi.mock("../src/store/pg-billing.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/pg-billing.js")>(
    "../src/store/pg-billing.js",
  );
  return {
    ...actual,
    accountSnapshot: async () => billing.row,
    usageFor: async (): Promise<Usage> => ({
      chargedFullPrice: 2,
      chargedHalfPrice: 1,
      highPowerFullPrice: 0,
      highPowerHalfPrice: 0,
      inFlightIngest: 0,
      inFlightMinimal: 0,
      minimalCharged: 0,
    }),
  };
});

/* No gift vouchers: the summary asks, and this lane has no database to ask. */
vi.mock("../src/store/pg-vouchers.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/pg-vouchers.js")>(
    "../src/store/pg-vouchers.js",
  );
  return { ...actual, giftsFor: async () => [] };
});

const { handleApi } = await import("../src/routes.js");
const { readBillingSummary } = await import("../src/billing/summary.js");
const { ARTICLE_TABLE_COVERAGE } = await import("../src/store/article-rows.js");

async function get(urlPath: string): Promise<{ status: number; body: string }> {
  const req = Object.assign((async function* () {})(), {
    method: "GET",
    url: urlPath,
    headers: AUTHED_HEADERS,
  }) as unknown as IncomingMessage;
  const chunks: Buffer[] = [];
  let status = 0;
  const res = {
    get statusCode() {
      return status;
    },
    set statusCode(v: number) {
      status = v;
    },
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    flushHeaders() {},
    on() {},
    writeHead(code: number) {
      status = code;
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.from(chunk as never));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.from(chunk as never));
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return { status, body: Buffer.concat(chunks).toString("utf8") };
}

/** A reader who is not the administrator, so the summary is not `exempt`. */
const READER = `00000000-0000-4000-8000-${randomUUID().slice(-12)}` as OwnerId;

/**
 * **The two ways a billing summary may name a price, and both are the reader's
 * own:** `sharedHalfPrice` is how many of *their* articles are counted at half
 * a slot, and `purchase.tiers.N.amounts.<currency>` is what a plan costs them a
 * month. Nothing else in it may match.
 */
const readersOwnPrice = (path: string): boolean =>
  path.endsWith("sharedHalfPrice") || /^purchase\.tiers\.\d+\.amounts(?:\.[a-z]{3})?$/.test(path);

describe("the payload walker", () => {
  it("flags a cost key, and an amount of money in a string value, at any depth — its own control", () => {
    const sample = {
      message: "about $0.20",
      steps: [{ name: "sketch", detail: { creditsNanos: 1 } }],
      tiers: [{ note: "USD 5 a month" }],
      estimate: { dollars: 0.2 },
    };
    expect(costLeaks(sample)).toEqual([
      'message = "about $0.20"',
      "steps.0.detail.creditsNanos",
      'tiers.0.note = "USD 5 a month"',
      "estimate.dollars",
    ]);
  });

  it("does not flag a payload with neither", () => {
    expect(
      costLeaks({ width: "20px", faster: "20 percent", steps: [{ calls: 2, wait: "about two minutes" }] }),
    ).toEqual([]);
  });
});

describe("no AI cost on a reader's payload", () => {
  beforeEach(() => {
    billing.row = undefined;
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_no-ai-cost-for-readers-fake");
    return () => vi.unstubAllEnvs();
  });

  it("the walker flags the administrator's cost route — the control", async () => {
    const sent = await get("/api/admin/articles/an-article-spya-abc123/cost");
    expect(sent.status).toBe(200);
    const flagged = costLeaks(JSON.parse(sent.body) as ArticleCost);
    expect(flagged).toContain("lines.0.creditsNanos");
  });

  it("a free reader's billing summary names only their own prices", async () => {
    const summary = JSON.parse(JSON.stringify(await readBillingSummary(READER))) as BillingSummary;
    /* The offers are really in it, so the allowance below is really exercised. */
    expect(summary.purchase.kind).toBe("checkout");
    expect(costLeaks(summary)).toContain("purchase.tiers.0.amounts.usd");
    expect(costLeaks(summary, readersOwnPrice)).toEqual([]);
  });

  it("a paying reader's billing summary names only their own prices", async () => {
    const now = Date.now();
    billing.row = {
      status: "active",
      priceId: "price_test_reader",
      currentPeriodStart: new Date(now - 86_400_000),
      currentPeriodEnd: new Date(now + 20 * 86_400_000),
      stripeSubscriptionId: "sub_test",
      stripeCustomerId: "cus_test",
      quotaLimitDelta: null,
      quotaPeriodStart: null,
      voucherArticles: 0,
      cancelAtPeriodEnd: false,
      cancelAt: null,
    };
    const summary = JSON.parse(JSON.stringify(await readBillingSummary(READER))) as BillingSummary;
    expect(summary.plan.kind).toBe("paid");
    expect(costLeaks(summary, readersOwnPrice)).toEqual([]);
  });

  it("the export bundle leaves out both spend ledgers", () => {
    /* The bundle is the reader's own data; our record of what serving it cost
       is not. src/store/article-rows.ts is the one list of what goes in. */
    expect(ARTICLE_TABLE_COVERAGE.ai_calls.bundle.exported).toBe(false);
    expect(ARTICLE_TABLE_COVERAGE.realtime_sessions.bundle.exported).toBe(false);
  });
});

/* ---- the declared wire shapes, at compile time ---- */

/** A key naming a cost, in the three casings a TypeScript key is written in. */
type CostWord =
  | "cost" | "Cost" | "COST"
  | "spend" | "Spend" | "SPEND"
  | "nanos" | "Nanos" | "NANOS"
  | "usd" | "Usd" | "USD"
  | "price" | "Price" | "PRICE"
  | "amount" | "Amount" | "AMOUNT"
  | "currency" | "Currency" | "CURRENCY"
  | "dollar" | "Dollar" | "DOLLAR"
  | "pound" | "Pound" | "POUND"
  | "euro" | "Euro" | "EURO"
  | "cent" | "Cent" | "CENT"
  | "pence" | "Pence" | "PENCE";
type CostKey = `${string}${CostWord}${string}`;

/**
 * Every key of `T`, at any depth, through arrays, optionals and unions.
 *
 * Capped at a depth so a recursive type (`Tree`) terminates; eight levels is
 * deeper than any payload here nests. A `Record<string, …>` contributes
 * `string`, which is not a `CostKey`, so a map of currencies is not flagged.
 */
type DeepKeys<T, D extends unknown[] = []> = D["length"] extends 8
  ? never
  : T extends readonly (infer E)[]
    ? DeepKeys<E, [...D, 1]>
    : T extends Date | ((...args: never[]) => unknown)
      ? never
      : T extends object
        ? { [K in keyof T & string]-?: K | DeepKeys<T[K], [...D, 1]> }[keyof T & string]
        : never;

type CostKeysOf<T> = Extract<DeepKeys<T>, CostKey>;
/** `true` when `T` has no cost key anywhere; the offending keys otherwise. */
type Clean<T> = [CostKeysOf<T>] extends [never] ? true : CostKeysOf<T>;

/* A red here is a type error naming the key: `Type '"true"' is not assignable
   to type '"estimatedCost"'`. */
const metadataIsClean: Clean<ArticleMetadata> = true;
const ownerArticleIsClean: Clean<Article> = true;
const visitorArticleIsClean: Clean<PublicArticle> = true;
const jobIsClean: Clean<Job> = true;
/* The control, at compile time: the admin shape **must** be flagged, or the
   check above is a check of nothing. */
const adminCostIsFlagged: [CostKeysOf<ArticleCost>] extends [never] ? false : true = true;

it("the declared wire shapes carry no cost key (enforced by npm run typecheck)", () => {
  expect([metadataIsClean, ownerArticleIsClean, visitorArticleIsClean, jobIsClean, adminCostIsFlagged]).toEqual([
    true,
    true,
    true,
    true,
    true,
  ]);
});
