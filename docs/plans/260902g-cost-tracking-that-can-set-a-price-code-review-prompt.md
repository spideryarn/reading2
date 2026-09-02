# Code review: the built cost-tracking work

You reviewed this plan twice — the findings, then the plan itself. This is the **code built from
it**, which is the review that matters more: a plan-stage review cannot find a `PATCH` that writes
one field and then rejects the request.

Weight correctness over style. Check each claim below against the diff rather than trusting it.

## What was built, across four stages

**Stage 1a** — `web_searches` populated from the parser that was already running on those calls;
every breakdown line carries its unpriced count; `jobSpend()` routed through `totalRows()` so it
picks up `computed` without a second summing expression; the three unmetered spenders named in a new
`UNMETERED_SPEND` table that `npm run cost` prints; `OPENAI_API_KEY` documented and health-checked.

**Stage 1b** — your option (b): `upstream_inference_nanos` → `byok_upstream_nanos`, written only on
BYOK rows, backfilled to null, held by a CHECK with `is_byok IS TRUE`. Legacy JSONL translated on
read, only when `isByok === true`. The test suite redirected to the filesystem test ledger under
`NODE_ENV=test` even when the app store is Postgres, resolved **per call** rather than at module
load. 4,937 fixture rows deleted. Postgres declared authoritative; no filesystem import.

**Stage 2A** — `realtime_sessions`, created when the client secret is minted, before the token
reaches the browser. Thirteen nullable realtime columns on `ai_calls` (modality splits including
`cached_tokens_details`, transcription seconds, provider event id and status). `parseRealtimeUsage`
and `acceptRealtimeUsage` — pure, no store, no clock. Effective-dated realtime and transcription
rate cards. `Wire`, `Provider`, `ProviderAccount`, `AiJob` widened.

**Stage 2B** — the browser meter: `response.done` **and** the input-transcription event, immediate
posting, in-memory retry with backoff, `keepalive` on teardown as a hint. No IndexedDB outbox, per
your cut. Projections return `null` rather than guessing when the modality split is absent.

**Stage 3** — `spendGroupedByOwner` over an arbitrary half-open `[start, end)`; six categories named
for the mechanism with an exhaustive `unknown` and `assertCategoriesCoverRows`; coverage header;
median/p95/max with zero-spend accounts in the denominator; cash beside credits; model-cost
contribution margin; a spend column on `/admin/users`.

## Specific things to attack

1. **The CHECK and the write path.** Do they agree exactly? A row the CHECK refuses is a call that
   lands in no ledger at all — the sink logs and returns rather than throwing. Is there any input
   for which the projection produces a row Postgres rejects?
2. **The legacy JSONL translation.** Old lines carry `upstreamInferenceNanos`. Translating only when
   `isByok === true` is claimed to be correct because on a non-BYOK line the old value *was* the
   double count. Is that right for every historical row shape, including `cost_source: 'none'` and
   BYOK rows whose upstream figure was null?
3. **The test-ledger redirect.** Resolved per call to dodge ESM hoisting. Does anything capture the
   adapter once — a module-level binding, a closure, a destructure — and defeat it?
4. **`parseRealtimeUsage`'s validation.** It requires every detail field explicitly and refuses
   image tokens. Two counts are defaulted to zero when absent (cached tokens, image tokens) on the
   argument that both can only bias the price upward. Is that argument sound? Can a hostile or buggy
   client get a wrong price past it, or get a *cheaper* price than the truth?
5. **Idempotency.** Uniqueness on `(realtime_session_id, provider_event_id, event_kind)`, partial
   index. Can the browser's retry queue double-count a turn — retry after a success the response to
   which was lost, say?
6. **`assertCategoriesCoverRows`.** It fires when counts stop summing to the ledger's own, and on an
   unrecognised category key, but **not** when `unknown` is non-empty (a real state today). Is that
   the right line, or does it let a whole new `AiJob` disappear quietly?
7. **The percentile and margin arithmetic.** Nearest-rank, zero-spend accounts included. A margin
   p95 is taken from the *cost* spread rather than over margins — is that done correctly everywhere?
8. **The cash uplift.** ~5.5% applied in the report, never written to a row. Applied to the right
   pockets? A BYOK row's upstream figure is somebody else's bill — does the uplift wrongly touch it?
9. **Anything that will hurt when Stripe reads this table.**

## Known and already accepted

- No real live conversation has run end to end, so `voice` has never held a real row.
- Whether `gpt-live-transcribe` reports seconds or tokens is unresolved; tokens are counted and
  refused rather than guessed at.
- Nobody has opened `/admin/users` in a browser; the store half is proved against the real database
  and the render half by `renderToStaticMarkup`.

The scoped diff follows.

```diff
diff --git a/scripts/ai-cost.ts b/scripts/ai-cost.ts
index f01e29a..db0fc68 100644
--- a/scripts/ai-cost.ts
+++ b/scripts/ai-cost.ts
@@ -7,6 +7,23 @@
  *     npm run cost -- --since 2026-08-01 --until 2026-08-15
  *     npm run cost -- --all             everything there is
  *     npm run cost -- --reconcile       ask OpenRouter what it thinks (network, free)
+ *     npm run cost -- --owners          what each owner cost, by category, with the spread
+ *     npm run cost -- --owners --price 20   …and the contribution margin at $20/month
+ *
+ * ## `--owners` is a different report, not a flag on this one
+ *
+ * Everything else here is a developer asking "where did the money go". `--owners`
+ * is the **pricing** report: per-owner spend over an arbitrary half-open range,
+ * split by what kind of work it bought, with a median/p95/max spread across
+ * *every account* rather than only the ones that spent something.
+ *
+ * It is Postgres-only, deliberately — src/store/ai-calls-spend-pg.ts says why —
+ * and it never calls `costStore.read()`. Two reasons, and the second is the
+ * interesting one: a `GROUP BY` in the database is the point (a fold over every
+ * row in JavaScript is fine at four thousand rows and not at four hundred
+ * thousand), and reading whole rows would make the report fail on any box whose
+ * migrations are behind, which is precisely the box that most needs to be told
+ * what its own coverage is.
  *
  * ## UTC, and half-open
  *
@@ -35,6 +52,24 @@ import { formatNanos } from "../src/ai-spend.js";
 import type { AiCallRow } from "../src/ai-spend.js";
 import { loadEnvLocal } from "../src/env.js";
 import { costStore, totalRows } from "../src/store/ai-calls.js";
+import {
+  type CredentialTally,
+  type RealtimeCoverage,
+  credentialsInWindow,
+  currentUtcMonth,
+  realtimeSessionCoverage,
+  spendGroupedByOwner,
+} from "../src/store/ai-calls-spend-pg.js";
+import { CATEGORY_MEANING, COST_CATEGORIES } from "../src/cost-categories.js";
+import {
+  OPENROUTER_CREDIT_FEE,
+  type SpendFold,
+  cashNanos,
+  foldSpend,
+  spendPerAccount,
+  spread,
+  totalNanos,
+} from "../src/cost-report.js";
 import { DECLARATIONS, UNMETERED_SPEND } from "../src/spend-declarations.js";
 import { isMain } from "../src/is-main.js";
 
@@ -43,6 +78,17 @@ interface Args {
   until?: string;
   all: boolean;
   reconcile: boolean;
+  /** `--owners` — the pricing report. See the header. */
+  owners: boolean;
+  /**
+   * `--price 20` — a candidate monthly subscription, in dollars.
+   *
+   * Only ever used to subtract: *price minus what the models cost this account*.
+   * It is **not** a scenario engine and must not become one — GPT Sol cut that
+   * from this stage, and the candidate-price arithmetic belongs in a measured
+   * plan document rather than in code.
+   */
+  price?: number;
   label: string;
 }
 
@@ -61,14 +107,23 @@ function monthRange(month: string): { since: string; until: string } {
   return { since: since.toISOString(), until: until.toISOString() };
 }
 
+/**
+ * **One definition, shared with the admin page.** `currentUtcMonth` lives in
+ * src/store/ai-calls-spend-pg.ts because that is where the query it bounds
+ * lives; `/admin/users` labels its spend column with the same period, and a
+ * column headed "this month" that meant something slightly different from this
+ * report is a discrepancy nobody would ever chase.
+ *
+ * `monthRange` above stays, and does a different job: it *parses* a `--month`
+ * somebody typed, with a regex that has already caught `2026-13` inverting the
+ * range. This one constructs rather than parses.
+ */
 function thisMonth(): { since: string; until: string; label: string } {
-  const now = new Date();
-  const label = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
-  return { ...monthRange(label), label };
+  return currentUtcMonth();
 }
 
 export function parseArgs(argv: string[]): Args {
-  const out: Args = { all: false, reconcile: false, label: "" };
+  const out: Args = { all: false, reconcile: false, owners: false, label: "" };
   const rest = [...argv];
   const value = (flag: string): string => {
     const v = rest.shift();
@@ -95,11 +150,35 @@ export function parseArgs(argv: string[]): Args {
       case "--reconcile":
         out.reconcile = true;
         break;
+      case "--owners":
+        out.owners = true;
+        break;
+      case "--price": {
+        const raw = value("--price");
+        const price = Number(raw);
+        /* Refused rather than coerced. `Number("twenty")` is `NaN`, and every
+           margin computed from it would print as `$NaN` on a page whose whole
+           purpose is a number somebody will act on. Zero is refused for the same
+           reason a zero pocket is not printed: it is not a candidate price. */
+        if (!Number.isFinite(price) || price <= 0) {
+          throw new Error(`--price wants a positive number of dollars, got ${JSON.stringify(raw)}`);
+        }
+        out.price = price;
+        break;
+      }
       default:
         throw new Error(`Unknown flag ${JSON.stringify(flag)}`);
     }
   }
-  if (out.all) return { all: true, reconcile: out.reconcile, label: "all time" };
+  if (out.all) {
+    return {
+      all: true,
+      reconcile: out.reconcile,
+      owners: out.owners,
+      ...(out.price === undefined ? {} : { price: out.price }),
+      label: "all time",
+    };
+  }
   if (!out.since && !out.until) {
     const m = thisMonth();
     return { ...out, since: m.since, until: m.until, label: `${m.label} (UTC)` };
@@ -194,12 +273,26 @@ function table(title: string, rows: Breakdown[]): void {
  * everything spent on this key before the ledger existed, and every stage CLI
  * and eval run since. Watch whether the gap *moves*, not whether it is zero.
  */
-async function reconcile(): Promise<void> {
+/**
+ * What OpenRouter says about the key in the environment, or `null`.
+ *
+ * Pulled out of `reconcile()` on 2026-09-02 so that `--owners` can print the
+ * same gap without going through `costStore.read()` — which fetches every row in
+ * the window, and is the one thing the pricing report is arranged not to do.
+ * Extracted rather than copied: two functions asking OpenRouter what a key has
+ * spent, in slightly different words, is two answers to reconcile.
+ *
+ * **Every failure sets a non-zero exit code**, because a reconciliation that
+ * could not run must not look like one that found nothing.
+ */
+async function openRouterKeyUsage(
+  why: string,
+): Promise<{ fingerprint: string; credits: number | null; byok: number | null } | null> {
   const key = process.env.OPENROUTER_API_KEY;
   if (!key) {
-    console.error("\n--reconcile needs OPENROUTER_API_KEY, and there is none set.");
+    console.error(`\n${why} needs OPENROUTER_API_KEY, and there is none set.`);
     process.exitCode = 1;
-    return;
+    return null;
   }
   const { keyFingerprint } = await import("../src/ai-spend.js");
   const fingerprint = keyFingerprint(key);
@@ -210,16 +303,27 @@ async function reconcile(): Promise<void> {
       headers: { Authorization: `Bearer ${key}` },
     });
     if (!response.ok) {
-      console.error(`\n--reconcile: OpenRouter answered ${response.status}. Nothing was compared.`);
+      console.error(`\n${why}: OpenRouter answered ${response.status}. Nothing was compared.`);
       process.exitCode = 1;
-      return;
+      return null;
     }
     body = (await response.json()) as { data?: Record<string, unknown> };
   } catch (err) {
-    console.error(`\n--reconcile: could not reach OpenRouter — ${(err as Error).message}`);
+    console.error(`\n${why}: could not reach OpenRouter — ${(err as Error).message}`);
     process.exitCode = 1;
-    return;
+    return null;
   }
+  const theirs = (name: string): number | null => {
+    const v = body.data?.[name];
+    return typeof v === "number" ? v : null;
+  };
+  return { fingerprint, credits: theirs("usage_monthly"), byok: theirs("byok_usage_monthly") };
+}
+
+async function reconcile(): Promise<void> {
+  const usage = await openRouterKeyUsage("--reconcile");
+  if (!usage) return;
+  const { fingerprint } = usage;
 
   const month = thisMonth();
   const { rows } = await costStore.read(month.since, month.until);
@@ -227,12 +331,8 @@ async function reconcile(): Promise<void> {
   const others = rows.length - mine.length;
   const { credits, upstream } = totalRows(mine);
 
-  const theirs = (name: string): number | null => {
-    const v = body.data?.[name];
-    return typeof v === "number" ? v : null;
-  };
-  const theirCredits = theirs("usage_monthly");
-  const theirByok = theirs("byok_usage_monthly");
+  const theirCredits = usage.credits;
+  const theirByok = usage.byok;
 
   console.log(`\nAgainst OpenRouter, key ${fingerprint}, ${month.label} (UTC):`);
   console.log(`  our credits    ${formatNanos(credits).padStart(12)}  (${mine.length} call(s))`);
@@ -329,20 +429,32 @@ function pocket(label: string, rows: readonly AiCallRow[]): void {
  * never posted because the tab died first, so the live figure is biased low by a
  * probably-small unknown. docs/project/live-conversation.md § The meter.
  */
-/** Six-space-indented, wrapped to a terminal width — these reasons are sentences, not labels. */
-function wrapped(text: string, width = 84): string[] {
+/** Indented and wrapped to a terminal width — these reasons are sentences, not labels. */
+function wrapped(text: string, width = 84, indent = 6): string[] {
   const lines: string[] = [];
+  const pad = " ".repeat(indent);
   let line = "";
   for (const word of text.split(/\s+/)) {
     if (line !== "" && `${line} ${word}`.length > width) {
-      lines.push(`      ${line}`);
+      lines.push(`${pad}${line}`);
       line = word;
     } else line = line === "" ? word : `${line} ${word}`;
   }
-  if (line !== "") lines.push(`      ${line}`);
+  if (line !== "") lines.push(`${pad}${line}`);
   return lines;
 }
 
+/**
+ * A paragraph under a table, wrapped rather than hard-newlined.
+ *
+ * Hand-broken lines in a template literal go wrong the moment somebody edits the
+ * sentence, and every caveat in the `--owners` report is a sentence that will be
+ * edited — they are the part a reader is meant to argue with.
+ */
+function note(text: string, indent = 2): void {
+  for (const line of wrapped(text, 92, indent)) console.log(line);
+}
+
 function unmetered(): void {
   console.log(
     `\nNot counted here, and NOT in any table above — ${UNMETERED_SPEND.length} way(s) of spending that no seam can see:`,
@@ -396,9 +508,469 @@ function undeclared(): void {
   console.log("  src/spend-declarations.ts says why each one is still open.");
 }
 
+/* ============================================================ --owners === */
+
+/**
+ * The population every per-account figure is divided by, and where it came from.
+ *
+ * `ids` empty means it could not be obtained and `why` says so — the report then
+ * falls back to the owners the ledger has rows for and prints a warning beside
+ * every figure, because that fallback silently turns "per account" into "per
+ * *spending* account".
+ */
+interface Denominator {
+  ids: string[];
+  emails: Map<string, string>;
+  source: string;
+  why: string;
+}
+
+/**
+ * `label` in a fixed-width gutter, with continuation lines under the text
+ * rather than under the label — the coverage header is a table of sentences,
+ * and a caveat that wraps back to column zero reads as a new heading.
+ */
+function say(label: string, ...lines: string[]): void {
+  const [first, ...rest] = lines;
+  console.log(`  ${label.padEnd(20)}${first ?? ""}`);
+  for (const line of rest) console.log(`  ${" ".repeat(20)}${line}`);
+}
+
+/** Cash, which is the figure a price is compared against. Credits + the fee. */
+function money(t: { creditsNanos: number; byokNanos: number; computedNanos: number }): number {
+  return cashNanos(t);
+}
+
+/**
+ * **The coverage header** — printed before any money, and not a preamble.
+ *
+ * Without it every figure below is unfalsifiable: a total of $2.54 looks
+ * identical whether it is the whole truth or the 8% of calls that happened to
+ * report a cost, and this ledger has already spent a fortnight in the second
+ * state with nobody noticing.
+ */
+function printCoverage(
+  args: Args,
+  seen: {
+    fold: SpendFold;
+    credentials: CredentialTally[];
+    realtime: RealtimeCoverage | null;
+    accounts: Denominator;
+  },
+): void {
+  const { fold, credentials, realtime, accounts } = seen;
+  console.log("\nCoverage — read this before believing any figure below");
+  say(
+    "Authoritative",
+    "Postgres. The filesystem ledger is development evidence and is",
+    "deliberately not imported (Stage 1 cutoff, GPT Sol 2026-09-02).",
+  );
+  say("Reading", costStore.describe());
+  say(
+    "Period",
+    `${args.since ?? "the beginning"} → ${args.until ?? "now"}`,
+    "Half-open [start, end) in UTC, so two adjacent periods cannot both",
+    "claim a call. Arbitrary bounds, because Stripe periods are not months.",
+  );
+
+  let settled = 0;
+  let computedCalls = 0;
+  let unpriced = 0;
+  for (const totals of fold.byCategory.values()) {
+    settled += totals.settledCalls;
+    computedCalls += totals.computedCalls;
+    unpriced += totals.unpricedCalls;
+  }
+  say("Rows", `${fold.totalCalls} call(s) from ${fold.byOwner.size} owner(s) with spend`);
+  say("  settled", `${settled} — OpenRouter answered; reconcilable against their own total`);
+  say("  computed by us", `${computedCalls} — priced from our price tables; never reconciled`);
+  say(
+    "  reported no cost",
+    `${unpriced} — every total below is short by an unknown amount`,
+    "These three do not partition: a BYOK row where OpenRouter answered",
+    "but reported no upstream figure is settled AND unpriced.",
+  );
+
+  if (credentials.length === 0) say("Paid with", "no rows, so no credential to name");
+  for (const c of credentials) {
+    /* Every key, not just the first. `--reconcile` compares one key's month
+       against OpenRouter's own figure, and that comparison means nothing if half
+       the rows were bought on a different account — printing the tally is
+       cheaper than explaining the gap afterwards. */
+    say(
+      credentials[0] === c ? "Paid with" : "",
+      `${c.fingerprint ?? "(no fingerprint recorded)"} — ${c.calls} call(s), ` +
+        `${formatNanos(c.creditsNanos)} in credits`,
+    );
+  }
+
+  if (realtime === null) {
+    say(
+      "Live sessions",
+      "NOT VISIBLE from this database — spideryarn.realtime_sessions is not",
+      "there. Run npm run db:migrate. Any voice figure below is whatever",
+      "reached ai_calls, with no session count to qualify it.",
+    );
+  } else {
+    say(
+      "Live sessions",
+      `${realtime.issued} issued, ${realtime.connected} connected, ${realtime.silent} connected ` +
+        "and reported nothing",
+      "A silent session is a conversation whose meter was lost or a reader",
+      "who never spoke; the ledger cannot tell those apart, so the voice",
+      "figure below is biased low by up to that many sessions.",
+    );
+  }
+
+  if (accounts.ids.length === 0) {
+    say(
+      "Denominator",
+      `UNAVAILABLE — ${accounts.why}`,
+      "Falling back to the owners the ledger has rows for, which excludes",
+      "everyone who spent nothing and biases every per-account figure UP.",
+    );
+  } else {
+    say(
+      "Denominator",
+      `${accounts.ids.length} account(s), from ${accounts.source}`,
+      "EVERY account, not subscribers — Stripe's subscriber set does not",
+      "exist yet. Accounts that spent nothing are counted as zero, which is",
+      "the whole point: a GROUP BY over the ledger cannot see them at all.",
+    );
+  }
+}
+
+/**
+ * **The rows no rule recognised, named one by one.**
+ *
+ * A subtotal under "unknown" with nothing beside it is unactionable — the reader
+ * cannot tell a retired job name from a new feature nobody has classified. These
+ * are *not* folded into a neighbouring category, because that would invent the
+ * provenance the schema cannot supply, which is the whole thing
+ * src/cost-categories.ts is arranged against.
+ */
+function printUnclassified(fold: SpendFold): void {
+  const totals = fold.byCategory.get("unknown");
+  if (!totals || totals.calls === 0) return;
+  const grand = [...fold.byCategory.values()].reduce((n, t) => n + money(t), 0);
+  const share = grand === 0 ? 0 : (money(totals) / grand) * 100;
+  console.log(
+    `\nUNCLASSIFIED — ${totals.calls} call(s), ${formatNanos(money(totals))}, ` +
+      `${share.toFixed(1)}% of the money`,
+  );
+  for (const u of fold.unknownFacts) {
+    console.log(
+      `  ${u.facts.padEnd(44)}  ${String(u.calls).padStart(5)} call(s)  ${formatNanos(u.nanos)}`,
+    );
+  }
+  note(
+    "Each is a scope/job/step that no rule in src/cost-categories.ts recognises — usually a " +
+      "retired name from an older row. They are NOT folded into a neighbouring category, " +
+      "because that would invent the provenance the schema cannot supply. Classify them there, " +
+      "or read this as the noise floor.",
+  );
+}
+
+/** What each kind of work cost, over everything in the period. */
+function printCategories(fold: SpendFold): void {
+  console.log("\nBy category, over everything in the period");
+  console.log(
+    `  ${"category".padEnd(26)}${"calls".padStart(7)}${"credits".padStart(13)}` +
+      `${"cash".padStart(13)}${"unpriced".padStart(10)}`,
+  );
+  for (const category of COST_CATEGORIES) {
+    const totals = fold.byCategory.get(category);
+    if (!totals || totals.calls === 0) continue;
+    console.log(
+      `  ${category.padEnd(26)}${String(totals.calls).padStart(7)}` +
+        `${formatNanos(totalNanos(totals)).padStart(13)}${formatNanos(money(totals)).padStart(13)}` +
+        `${String(totals.unpricedCalls).padStart(10)}`,
+    );
+  }
+  note(
+    `Cash is credits + ${(OPENROUTER_CREDIT_FEE * 100).toFixed(1)}%. OpenRouter's fee is on BUYING ` +
+      "credits, not per token, so it is allocated here and never written to a row. BYOK and " +
+      "computed rows never bought a credit and carry no uplift.",
+  );
+  for (const category of COST_CATEGORIES) {
+    const totals = fold.byCategory.get(category);
+    if (totals && totals.calls > 0) note(`${category} — ${CATEGORY_MEANING[category]}`, 4);
+  }
+}
+
+/**
+ * **The distribution, which is the answer a total is not.**
+ *
+ * A median says what the typical account costs, a p95 says what a price would be
+ * underwriting, and a max says what one account has already managed. An average
+ * says none of those and is the statistic a subscription price cannot be set
+ * from.
+ */
+function printSpread(fold: SpendFold, population: string[], denominatorIsReal: boolean): number[] {
+  const product = COST_CATEGORIES.filter((c) => c !== "non-product");
+  console.log(
+    `\nPer-account spread — cash, over ${population.length} account(s), zero-spend included` +
+      (denominatorIsReal ? "" : "  ** SPENDING OWNERS ONLY — see Denominator **"),
+  );
+  console.log(
+    `  ${"category".padEnd(26)}${"spending".padStart(9)}${"median".padStart(13)}` +
+      `${"p95".padStart(13)}${"max".padStart(13)}${"total".padStart(13)}`,
+  );
+  const line = (name: string, values: number[]): void => {
+    const s = spread(values);
+    console.log(
+      `  ${name.padEnd(26)}${String(s.spending).padStart(9)}${formatNanos(s.median).padStart(13)}` +
+        `${formatNanos(s.p95).padStart(13)}${formatNanos(s.max).padStart(13)}` +
+        `${formatNanos(s.total).padStart(13)}`,
+    );
+  };
+  for (const category of product) {
+    const totals = fold.byCategory.get(category);
+    if (!totals || totals.calls === 0) continue;
+    line(category, spendPerAccount(fold, population, [category], money));
+  }
+  const allProduct = spendPerAccount(fold, population, product, money);
+  line("ALL PRODUCT", allProduct);
+  note(
+    "Non-product spend is excluded from this table on purpose — it is ours, not a reader's, and " +
+      "a bake-off landing in the figure a price is set from is how a price gets set wrong. " +
+      `Nearest-rank percentiles: at ${population.length} account(s) the p95 IS the most expensive ` +
+      'account, so read it as "the worst we have seen" rather than as a stable statistic.',
+  );
+  return allProduct;
+}
+
+/** Who cost what, by name where the Auth service could supply one. */
+function printOwners(fold: SpendFold, accounts: Denominator, population: string[]): void {
+  const product = COST_CATEGORIES.filter((c) => c !== "non-product");
+  console.log("\nBy owner — product spend only, cash");
+  const named = [...fold.byOwner.entries()]
+    .map(([id, mine]) => {
+      let cash = 0;
+      let calls = 0;
+      let short = 0;
+      for (const category of product) {
+        const totals = mine.get(category);
+        if (!totals) continue;
+        cash += money(totals);
+        calls += totals.calls;
+        short += totals.unpricedCalls;
+      }
+      return { id, name: accounts.emails.get(id) ?? id, cash, calls, unpriced: short };
+    })
+    .sort((a, b) => b.cash - a.cash);
+  for (const owner of named) {
+    console.log(
+      `  ${owner.name.slice(0, 40).padEnd(40)}${formatNanos(owner.cash).padStart(13)}` +
+        `${String(owner.calls).padStart(7)} call(s)` +
+        (owner.unpriced > 0 ? `  ${owner.unpriced} unpriced` : ""),
+    );
+  }
+  const silent = population.filter((id) => !fold.byOwner.has(id)).length;
+  if (silent > 0) console.log(`  ${silent} more account(s) spent nothing at all in this period.`);
+}
+
+/** Price minus what the models cost, and nothing else. */
+function printMargin(price: number, allProduct: number[]): void {
+  const priceNanos = Math.round(price * 1e9);
+  /* **Derived from the COST spread, not from a spread of the margins.** A
+     nearest-rank p95 over margins returns the *largest* margin, which is the
+     cheapest account — the opposite of the number anybody wants. Subtracting the
+     p95 cost gives the margin on the account at the 95th percentile of spend,
+     which is what "what am I underwriting" means. Getting this backwards would
+     have printed a reassuring figure with nothing red anywhere. */
+  const cost = spread(allProduct);
+  console.log(`\nModel-cost contribution margin at $${price.toFixed(2)} per account`);
+  console.log(
+    `  at the median account ${formatNanos(priceNanos - cost.median)}   ` +
+      `at the p95 account ${formatNanos(priceNanos - cost.p95)}   ` +
+      `at the worst ${formatNanos(priceNanos - cost.max)}   ` +
+      `underwater ${allProduct.filter((c) => c > priceNanos).length} of ${allProduct.length}`,
+  );
+  note(
+    "MODEL-COST contribution margin, not gross margin. It is the price minus what the models " +
+      "cost and nothing else: Stripe's fees, hosting, storage, bandwidth and every unmetered " +
+      "spend listed below are all still to come out of it. The spread is over the same period " +
+      "as everything above, so a period shorter than a month flatters it.",
+  );
+}
+
+/**
+ * **The pricing report.** One command that answers "what did each owner cost
+ * over this period, by category, with the spread" — and, first, how much of
+ * itself it could not see.
+ *
+ * ## Non-product spend is printed and then excluded
+ *
+ * Eval and dev-CLI rows are ours. They are shown, because a report that hid them
+ * would be hiding real money on the OpenRouter bill, and they are kept out of
+ * the per-account spread, because a bake-off over forty PDF pages landing in the
+ * figure Greg prices against is how a price gets set wrong. The same argument
+ * `pocket()` above makes for the ordinary report.
+ */
+async function ownersReport(args: Args): Promise<void> {
+  const { STORE } = await import("../src/store/live.js");
+  if (STORE !== "postgres") {
+    /* Refused rather than answered from the filesystem ledger. GPT Sol settled
+       the cutoff: **Postgres is authoritative and the JSONL history is not
+       imported**, so a per-owner figure computed from files would be a second,
+       plausible, wrong answer to the question a price gets set from. */
+    console.error(
+      "\n--owners reads Postgres, and this process is on the filesystem store.\n" +
+        "  Postgres is the authoritative ledger (docs/plans/260902g-… § the cutoff);\n" +
+        "  the JSONL file is development evidence and was deliberately never imported.\n" +
+        "  Re-run as:  SPIDERYARN_STORE=postgres npm run cost -- --owners",
+    );
+    process.exitCode = 1;
+    return;
+  }
+
+  const [groups, credentials, realtime] = await Promise.all([
+    spendGroupedByOwner(args.since, args.until),
+    credentialsInWindow(args.since, args.until),
+    realtimeSessionCoverage(args.since, args.until),
+  ]);
+  const fold = foldSpend(groups);
+  const accounts = await accountDenominator();
+
+  console.log(`AI spend by owner — ${args.label}`);
+  printCoverage(args, { fold, credentials, realtime, accounts });
+  await reconciliationLine(args);
+
+  if (fold.totalCalls === 0) {
+    /* **Said, rather than drawn as a table of zeroes.** The same rule
+       `pocket()` follows above: a `$0.0000` with a label on it reads as a
+       measurement, and "we recorded nothing here" is the one thing it is not.
+       The second line is the one that matters — a misconfigured store and a
+       genuinely quiet month are indistinguishable from this side, and the
+       coverage header above is where to look for which one it is. */
+    console.log("\nNo calls recorded in this range.");
+    console.log("(An empty range and an unwired ledger look identical from here.)");
+    unmetered();
+    undeclared();
+    return;
+  }
+
+  printUnclassified(fold);
+  printCategories(fold);
+
+  /* **The population, and the fallback said out loud.** Without the Auth
+     service the only owners this process can name are the ones the ledger has
+     rows for, which excludes everybody who spent nothing — so every figure in
+     the spread is biased upward by exactly the population a subscription price
+     cares most about. Falling back silently would be the worse half of that. */
+  const population = accounts.ids.length > 0 ? accounts.ids : [...fold.byOwner.keys()];
+  const allProduct = printSpread(fold, population, accounts.ids.length > 0);
+  printOwners(fold, accounts, population);
+  if (args.price !== undefined) printMargin(args.price, allProduct);
+
+  unmetered();
+  undeclared();
+}
+
+/**
+ * **The population every per-account figure is divided by**, and where it came
+ * from.
+ *
+ * From the Auth service over HTTP rather than a join, because `auth.users`
+ * belongs to Supabase and the deployed role has no grants into that schema —
+ * src/store/admin-accounts.ts has the measurement. So this cannot be one SQL
+ * statement however much a per-owner report would like it to be.
+ *
+ * **A failure here is reported, never swallowed.** Losing the denominator does
+ * not make the report wrong in a way anybody would see; it silently turns every
+ * "per account" figure into a "per *spending* account" figure, which is biased
+ * upward by exactly the population that matters most to a subscription price.
+ */
+async function accountDenominator(): Promise<Denominator> {
+  const none = { ids: [] as string[], emails: new Map<string, string>() };
+  const url = process.env.SUPABASE_URL?.trim();
+  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
+  if (!url || !key) {
+    return {
+      ...none,
+      source: "",
+      why: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set, and the accounts live in the Auth service rather than in a table",
+    };
+  }
+  try {
+    const { gotruePages, listAccounts } = await import("../src/store/admin-accounts.js");
+    const rows = await listAccounts(gotruePages(url, key));
+    return {
+      ids: rows.map((r) => r.id),
+      emails: new Map(rows.flatMap((r) => (r.email ? [[r.id, r.email] as const] : []))),
+      source: `the Supabase Auth service at ${new URL(url).host}`,
+      why: "",
+    };
+  } catch (err) {
+    return { ...none, source: "", why: `the Auth service could not be read — ${(err as Error).message}` };
+  }
+}
+
+/**
+ * The reconciliation gap, **with the three conditions it holds under printed
+ * beside it** — or a line saying why it is not shown.
+ *
+ * `GET /api/v1/key` answers for the *current key*, over the *current UTC month*,
+ * *as of now*. It cannot answer for August, for an arbitrary Stripe period, or
+ * for a key that has been rotated. A gap printed under a report covering some
+ * other range would be a number that looks like a check and is not one — GPT
+ * Sol's condition on this stage, and the same failure mode as the first version
+ * of `reconcile()`, which compared one month's rows against an all-time figure.
+ */
+async function reconciliationLine(args: Args): Promise<void> {
+  const say = (label: string, ...lines: string[]): void => {
+    const [first, ...rest] = lines;
+    console.log(`  ${label.padEnd(20)}${first ?? ""}`);
+    for (const line of rest) console.log(`  ${" ".repeat(20)}${line}`);
+  };
+  const month = thisMonth();
+  const current = args.since === month.since && args.until === month.until;
+  if (!current) {
+    say(
+      "Reconciliation",
+      "omitted. OpenRouter's /api/v1/key answers for the CURRENT key over the",
+      "CURRENT UTC month AS OF NOW, and this report covers another range.",
+      "For the gap: npm run cost -- --owners --reconcile (no --month/--since).",
+    );
+    return;
+  }
+  if (!args.reconcile) {
+    say("Reconciliation", "not asked for. Add --reconcile (network, free).");
+    return;
+  }
+  const usage = await openRouterKeyUsage("--reconcile");
+  if (!usage) return;
+  const spend = await import("../src/store/ai-calls-spend-pg.js");
+  const tallies = await spend.credentialsInWindow(month.since, month.until);
+  const mine = tallies.find((t) => t.fingerprint === usage.fingerprint);
+  const others = tallies.filter((t) => t.fingerprint !== usage.fingerprint);
+  const ours = (mine?.creditsNanos ?? 0) / 1e9;
+  if (usage.credits === null) {
+    say("Reconciliation", `key ${usage.fingerprint} — OpenRouter reported no monthly usage figure.`);
+    return;
+  }
+  say(
+    "Reconciliation",
+    `key ${usage.fingerprint}, ${month.label} (UTC), as of now:`,
+    `ours $${ours.toFixed(6)} in credits over ${mine?.calls ?? 0} call(s)`,
+    `theirs $${usage.credits.toFixed(6)}   gap $${(usage.credits - ours).toFixed(6)} (theirs minus ours)`,
+    ...(others.length > 0
+      ? [`${others.reduce((n, o) => n + o.calls, 0)} call(s) this month were paid on another key.`]
+      : []),
+    "There is no stored baseline, so the gap also holds everything spent on",
+    "this key before the ledger existed, plus every CLI and eval run since.",
+    "Watch whether the gap MOVES, not whether it is zero.",
+  );
+}
+
 async function main(): Promise<void> {
   loadEnvLocal();
   const args = parseArgs(process.argv.slice(2));
+  if (args.owners) {
+    await ownersReport(args);
+    return;
+  }
   const { rows, unreadable } = await costStore.read(args.since, args.until);
 
   console.log(`AI spend — ${args.label}`);
diff --git a/src/admin.ts b/src/admin.ts
index 597de2c..b8232d4 100644
--- a/src/admin.ts
+++ b/src/admin.ts
@@ -285,4 +285,64 @@ export interface AdminUser {
   opens: number;
   /** ISO. The most recent open across all their articles, if there is one. */
   lastReadAt?: string;
+
+  /* ------------------------------------------------------------- spend ---
+   *
+   * **What this account's reading cost us in model calls**, over a period the
+   * page has to name. Greg asked for the column explicitly (2026-09-02) and GPT
+   * Sol withdrew its objection on two conditions, both of which are why there
+   * are four fields here rather than one:
+   *
+   * > A bare currency number would overclaim.
+   *
+   * - **A defined period**, so it is `spendMonth` and not "recently". A number
+   *   whose window is implied is a number two people will read differently.
+   * - **A visible partial marker**, so `spendUnpricedCalls` travels beside the
+   *   money. 207 of this box's 243 rows reported no cost at all; a `$0.00`
+   *   drawn from those would be a lie the page tells confidently.
+   *
+   * `spendCalls` is the third leg of the same argument: zero calls and zero
+   * dollars are different facts, and only one of them means "nothing happened".
+   *
+   * Eval and dev-CLI spend is excluded — see `productSpendByOwner` in
+   * src/store/ai-calls-spend-pg.ts. It is ours rather than a reader's, and on a
+   * per-account page it would draw whoever's owner id the environment was
+   * carrying as costing forty times what anybody else does.
+   */
+
+  /** Model spend over `spendMonth`, in nano-dollars. Credits + BYOK + computed. */
+  spendNanos: number;
+  /** Metered calls behind that figure. `0` means nothing happened, not "free". */
+  spendCalls: number;
+  /** How many of those reported no cost, so the figure above is short. */
+  spendUnpricedCalls: number;
+  /** `YYYY-MM`, UTC — the period the three numbers above cover, never implied. */
+  spendMonth: string;
+}
+
+/**
+ * Nano-dollars as a string, **for the browser** — a deliberate second copy of
+ * `formatNanos` in [src/ai-spend.ts](ai-spend.ts), and the reason is a bundle
+ * boundary rather than an oversight.
+ *
+ * That module opens with `import { AsyncLocalStorage } from "node:async_hooks"`,
+ * because the spend collector is a request-scoped store. Importing one formatter
+ * from it would pull the whole ledger, the gateway request shapes and pino into
+ * the client bundle — exactly the accident `tests/client-imports.test.ts` was
+ * written for, when four lines from `src/converse.ts` grew the bundle 24KB and
+ * put `OPENROUTER_API_KEY` in it. The remedy that test names is to put the
+ * shared thing in a module that imports nothing, and this is that module.
+ *
+ * **The two must agree**, and `tests/admin-spend-column.test.ts` holds them
+ * against each other rather than trusting this comment: a report and a page
+ * showing different dollars for the same account is a bug that would be argued
+ * about for an hour before anybody suspected the formatter.
+ */
+export function formatSpendNanos(nanos: number): string {
+  const dollars = nanos / 1e9;
+  /* Eight decimals under a hundredth of a cent, because `$0.0000` on a call
+     that really cost something reads as free — the rounding-to-zero that
+     `formatNanos` was caught doing on a live probe. */
+  if (nanos !== 0 && Math.abs(dollars) < 0.0001) return `$${dollars.toFixed(8)}`;
+  return `$${dollars.toFixed(4)}`;
 }
diff --git a/src/cost-categories.ts b/src/cost-categories.ts
new file mode 100644
index 0000000..1bd29dd
--- /dev/null
+++ b/src/cost-categories.ts
@@ -0,0 +1,220 @@
+/**
+ * **What kind of work a ledger row paid for** — named for what the schema can
+ * actually prove, and not a word more.
+ *
+ * A total is not an answer to "what should we charge"; a *distribution by kind
+ * of work* is, because the kinds have wildly different economics. One spoken
+ * minute can cost most of an article's whole ingest
+ * (docs/plans/260902g-cost-tracking-that-can-set-a-price.md § Tier 2), so a
+ * report that folds voice into one grand total tells Greg nothing he can price
+ * against.
+ *
+ * ## The trap this file is arranged around: **provenance is not in the row**
+ *
+ * The obvious five categories — "base upload", "reader-triggered rerun", and so
+ * on — are **not derivable from `ai_calls`**, and GPT Sol caught the plan
+ * claiming they were (2026-09-02). Two reasons, both structural:
+ *
+ * - **`scope_kind` does not separate ingest from reading.** A reader who opens
+ *   Glossary posts `{ slug, steps: ["glossary"] }` to `POST /api/jobs`, which
+ *   creates a job and is recorded `scope_kind: "job_step"` — *exactly* like the
+ *   steps that ran when the article was added. The column says which machinery
+ *   ran the call, never who asked for it.
+ * - **A `hierarchy` row cannot say whether it was the first ingest or a rerun.**
+ *   `job_id` is kept, but a finished job may be deleted, and even a live job
+ *   records no "this was the initial upload" fact.
+ *
+ * So the categories here are named for **the mechanism**, which is what the row
+ * knows: *default-step work* rather than *base upload*. That is a weaker claim
+ * and it is a true one. Fixing it properly means durably recording the
+ * initiating job kind, which is a schema change and out of this stage's scope.
+ *
+ * ## Why `unknown` is a category rather than a fallback
+ *
+ * Because the ledger holds **historical strings**, not today's unions.
+ * `data/_ai-calls.jsonl` on this box carries `job: "summarise"` with
+ * `step_name: "summary"` — a stage that was split into `hierarchy` and `labels`
+ * long ago and exists in no type. A classifier that quietly folded those into
+ * the nearest live category would be inventing provenance again, one rename
+ * later. They land in `unknown`, the report prints the distinct
+ * scope/job/step triples inside it, and a person decides.
+ *
+ * The same mechanism is the guard against the *future* version of that: a new
+ * `AiJob` added next month reaches `unknown` and is visible, rather than being
+ * absorbed into whichever category has the loosest `else`. That is why the
+ * request-scope branch enumerates its jobs instead of catching everything left.
+ *
+ * ## The lists come from `src/pipeline.ts`, never from a copy here
+ *
+ * `DEFAULT_INGEST_STEPS` moves — `arc` came off it on 2026-08-29 — and a second
+ * copy of it in this file would be a second copy of a fact nothing keeps in
+ * step. Importing the pipeline from a leaf module is safe because nothing in
+ * `src/` imports this one: the report and the tests do. `npm run cycles` is a
+ * gate and agrees.
+ */
+
+import { DEFAULT_INGEST_STEPS, STEP_ORDER } from "./pipeline.js";
+
+/**
+ * The six kinds of spend, in the order a pricing conversation wants them.
+ *
+ * `unknown` is last and is **exhaustive**: every row reaches exactly one of
+ * these, so a per-category breakdown can be checked against the row count and
+ * nothing can go missing between the two. `assertCategoriesCoverRows` below is
+ * that check.
+ */
+export const COST_CATEGORIES = [
+  "default-step work",
+  "on-demand enrichment",
+  "interactive request work",
+  "voice",
+  "non-product",
+  "unknown",
+] as const;
+
+export type CostCategory = (typeof COST_CATEGORIES)[number];
+
+/** One line of prose per category, printed beside it so a number is readable. */
+export const CATEGORY_MEANING: Record<CostCategory, string> = {
+  "default-step work":
+    "pipeline steps that are in DEFAULT_INGEST_STEPS — what adding a URL runs. " +
+    "A rerun of one of those steps lands here too; the row cannot tell them apart.",
+  "on-demand enrichment":
+    "pipeline steps that are off the default — glossary, quotes, ideas, timeline, " +
+    "quiz, sketch, tweets, arc. Somebody asked for each of these.",
+  "interactive request work":
+    "recognised jobs recorded in request scope: chat, explain, meaning search, " +
+    "referee, quiz marking, dictation, embeddings, PDF transcription.",
+  voice: "live conversation — the realtime model and the separate transcriber.",
+  "non-product": "eval and dev-CLI scope. Ours, not a reader's. Kept out of the per-owner spread.",
+  unknown:
+    "reached no rule above. Retired job or step names from old rows, and anything " +
+    "added since this classifier was written. The report names them.",
+};
+
+/**
+ * The three columns a category is decided from, as **strings**.
+ *
+ * Deliberately not `ScopeKind`/`AiJob`/`StepName`. The ledger is an append-only
+ * historical record and its oldest rows name jobs and steps that no longer
+ * exist; typing this against today's unions would either force a cast at every
+ * call site or make the compiler assert something about the data that is false.
+ * The honest signature takes what the column holds, and `unknown` is what
+ * catches the ones the unions no longer cover.
+ */
+export interface CategoryFacts {
+  scopeKind: string;
+  job: string;
+  stepName: string | null;
+}
+
+/**
+ * **Request-scope jobs this classifier recognises**, enumerated rather than
+ * inferred.
+ *
+ * The tempting shape is `if (scopeKind === "request") return "interactive …"`,
+ * and it is wrong for the reason the header gives: a new job would be swallowed
+ * silently by the category with the widest mouth. Listing them means adding an
+ * `AiJob` shows up in `unknown` on the next report, which is a nuisance that
+ * lasts one line of edit and is the entire point.
+ *
+ * `pdf` and `embeddings` sit here despite not being "text and search" in the
+ * reading sense — a PDF transcription happens when somebody uploads one, and
+ * embeddings are written so that meaning search can run. Both are request-scoped
+ * reader-triggered work, which is what the category is actually named for.
+ */
+const INTERACTIVE_REQUEST_JOBS: ReadonlySet<string> = new Set([
+  "chat",
+  "explain",
+  "search",
+  "quiz-mark",
+  "referee-mirror",
+  "referee-criteria",
+  "referee-claims",
+  "referee-candidates",
+  "dictation",
+  "embeddings",
+  "pdf",
+]);
+
+const DEFAULT_STEPS: ReadonlySet<string> = new Set<string>(DEFAULT_INGEST_STEPS);
+const KNOWN_STEPS: ReadonlySet<string> = new Set<string>(STEP_ORDER);
+
+/**
+ * Which category one row belongs to. Pure, total, and the order of the branches
+ * is the whole of the logic.
+ *
+ * **Non-product first**, before anything looks at the job: an eval that
+ * exercises `chat` is recorded `job: "chat"`, and a bake-off over forty PDFs
+ * landing in a reader-facing category is how a price gets set wrong. The same
+ * argument `scripts/ai-cost.ts` already makes for printing eval spend apart.
+ *
+ * **Voice second**, because a live session is recorded in *request* scope
+ * (`src/live.ts` § the accounting routes) and would otherwise disappear into
+ * the interactive bucket — the one category whose figure it would dominate and
+ * the one distinction the whole live-metering stage exists to make.
+ */
+export function costCategoryOf(facts: CategoryFacts): CostCategory {
+  if (facts.scopeKind === "eval" || facts.scopeKind === "cli") return "non-product";
+  if (facts.job === "live_conversation") return "voice";
+  if (facts.scopeKind === "job_step") {
+    /* The step, not the job. `labels` runs inside the `hierarchy` step and is
+       recorded `job: "labels", step_name: "hierarchy"` — asking the job would
+       put half of the default ingest in `unknown`. The step name is what says
+       which pipeline slot was paid for. */
+    if (facts.stepName === null) return "unknown";
+    if (DEFAULT_STEPS.has(facts.stepName)) return "default-step work";
+    if (KNOWN_STEPS.has(facts.stepName)) return "on-demand enrichment";
+    return "unknown";
+  }
+  if (facts.scopeKind === "request" && INTERACTIVE_REQUEST_JOBS.has(facts.job)) {
+    return "interactive request work";
+  }
+  return "unknown";
+}
+
+/** A row's category, and enough of it to name in the `unknown` block. */
+export function describeFacts(facts: CategoryFacts): string {
+  return `${facts.scopeKind} / ${facts.job} / ${facts.stepName ?? "—"}`;
+}
+
+/**
+ * **Do the per-category counts add up to the number of rows classified?**
+ *
+ * Throws when they do not, and it is not a defensive nicety. Every figure in
+ * the per-owner report is a fold over grouped rows, and a fold that drops a
+ * bucket — a `switch` missing a case, a `Map` keyed on a name that got
+ * renamed — produces a report that is *smaller* than the truth and looks
+ * entirely plausible. Nothing about it is red. This is the one statement that
+ * cannot be satisfied by a plausible-looking wrong answer, which is what
+ * docs/reusable/silent-success.md asks for.
+ *
+ * It is deliberately **not** "unknown must be empty". `unknown` holding rows is
+ * a real and expected state (retired job names), and a check that failed on it
+ * would be muted within a week. The report prints what is in there instead.
+ */
+export function assertCategoriesCoverRows(
+  counts: ReadonlyMap<CostCategory, number>,
+  totalCalls: number,
+): void {
+  let summed = 0;
+  for (const category of COST_CATEGORIES) summed += counts.get(category) ?? 0;
+  /* Extra keys as well as a short sum: a `Map<string, number>` that has been
+     handed a category name this file does not know would otherwise pass the
+     addition above while its rows never appear on the page. */
+  for (const key of counts.keys()) {
+    if (!(COST_CATEGORIES as readonly string[]).includes(key)) {
+      throw new Error(
+        `the cost breakdown has a category this build does not know about (${JSON.stringify(key)}). ` +
+          "Every row must land in one of COST_CATEGORIES — see src/cost-categories.ts.",
+      );
+    }
+  }
+  if (summed !== totalCalls) {
+    throw new Error(
+      `the cost breakdown covers ${summed} call(s) and the ledger returned ${totalCalls} for the ` +
+        "same range, so at least one row is in no category. A per-owner report that is quietly " +
+        "short is worse than none — see src/cost-categories.ts.",
+    );
+  }
+}
diff --git a/src/cost-report.ts b/src/cost-report.ts
new file mode 100644
index 0000000..db70fa2
--- /dev/null
+++ b/src/cost-report.ts
@@ -0,0 +1,247 @@
+/**
+ * **The arithmetic behind the pricing report** — folds, spreads and the cash
+ * uplift, with no I/O and no printing, so every number on the page can be
+ * checked without a database or a terminal.
+ *
+ * `scripts/ai-cost.ts` reads the ledger and draws the tables; this decides what
+ * the tables say. The split is the same one `src/store/pg-admin.ts` makes and
+ * for the same reason: the two bugs this report has already had were both in
+ * *what a number includes*, and neither showed up in a type.
+ *
+ * ## Why a spread and not an average
+ *
+ * Greg is setting a subscription price. An average over readers is the one
+ * statistic that cannot inform that decision, because the readers who lose money
+ * are in the tail: a median tells you what the typical account costs, a p95 tells
+ * you what you are underwriting, and a max tells you what a single account has
+ * already managed. GPT Sol cut p90 as surplus at alpha scale, and that cut
+ * stands.
+ */
+
+import type { SpendGroup } from "./store/ai-calls-spend-pg.js";
+import {
+  type CostCategory,
+  assertCategoriesCoverRows,
+  costCategoryOf,
+  describeFacts,
+} from "./cost-categories.js";
+
+/**
+ * **What OpenRouter's cut adds on top of the credits figure** — the difference
+ * between the ledger and a bank statement.
+ *
+ * Their fee is charged on *buying credits*, not per token: about 5.5% on a card
+ * purchase, with a minimum, and different again for crypto. So a row's settled
+ * `usage.cost` is a credits figure, and the cash it took to put those credits
+ * there is roughly 5.5% more.
+ *
+ * **This is allocated in the report and never written to a row.** Multiplying
+ * each stored cost by 1.055 would put an estimate in a column built to hold
+ * settled figures — the exact thing drizzle/0023's cost-provenance design
+ * exists to prevent — and would invent a precision that can never match a
+ * statement, because the fee has a floor and does not divide evenly over calls.
+ * Greg asked to see both figures (2026-09-02); this is the "both".
+ *
+ * It applies to **credits only**. A BYOK row was billed to somebody else's key
+ * and never touched our credit balance, and a `computed` row went straight to
+ * Anthropic or OpenAI without passing OpenRouter at all. Applying the uplift to
+ * those would be charging ourselves a fee twice for money that never bought a
+ * credit.
+ */
+export const OPENROUTER_CREDIT_FEE = 0.055;
+
+/** Credits plus the fee it took to buy them, with the other pockets untouched. */
+export function cashNanos(totals: {
+  creditsNanos: number;
+  byokNanos: number;
+  computedNanos: number;
+}): number {
+  return Math.round(totals.creditsNanos * (1 + OPENROUTER_CREDIT_FEE)) + totals.byokNanos + totals.computedNanos;
+}
+
+/** One category's money and its honesty markers. */
+export interface CategoryTotals {
+  calls: number;
+  creditsNanos: number;
+  byokNanos: number;
+  computedNanos: number;
+  settledCalls: number;
+  computedCalls: number;
+  unpricedCalls: number;
+}
+
+/** Everything the report draws, folded once from the grouped SQL result. */
+export interface SpendFold {
+  /** Every category, in `COST_CATEGORIES` order, present even when empty. */
+  byCategory: Map<CostCategory, CategoryTotals>;
+  /** Owner → category → totals. Only owners the ledger has rows for. */
+  byOwner: Map<string, Map<CostCategory, CategoryTotals>>;
+  /**
+   * The distinct `scope / job / step` triples that reached `unknown`, so the
+   * report can name them rather than printing a mystery subtotal. Sorted by
+   * money, because the expensive unknown is the one worth classifying.
+   */
+  unknownFacts: { facts: string; calls: number; nanos: number }[];
+  totalCalls: number;
+}
+
+function empty(): CategoryTotals {
+  return {
+    calls: 0,
+    creditsNanos: 0,
+    byokNanos: 0,
+    computedNanos: 0,
+    settledCalls: 0,
+    computedCalls: 0,
+    unpricedCalls: 0,
+  };
+}
+
+function add(into: CategoryTotals, from: SpendGroup): void {
+  into.calls += from.calls;
+  into.creditsNanos += from.creditsNanos;
+  into.byokNanos += from.byokNanos;
+  into.computedNanos += from.computedNanos;
+  into.settledCalls += from.settledCalls;
+  into.computedCalls += from.computedCalls;
+  into.unpricedCalls += from.unpricedCalls;
+}
+
+/** The three pockets as one figure. Callers add them deliberately, and say so. */
+export function totalNanos(t: {
+  creditsNanos: number;
+  byokNanos: number;
+  computedNanos: number;
+}): number {
+  return t.creditsNanos + t.byokNanos + t.computedNanos;
+}
+
+/**
+ * Turn the grouped SQL result into everything the report prints — **and check
+ * that nothing fell out on the way.**
+ *
+ * The `assertCategoriesCoverRows` call at the end is the point of the function
+ * as much as the fold is. A fold that drops a bucket produces a report that is
+ * quietly *smaller* than the truth and looks entirely reasonable, which for a
+ * pricing decision is worse than no report. See
+ * [cost-categories.ts](cost-categories.ts) for why that check is "the counts add
+ * up" rather than "unknown is empty".
+ */
+export function foldSpend(groups: readonly SpendGroup[]): SpendFold {
+  const byCategory = new Map<CostCategory, CategoryTotals>();
+  const byOwner = new Map<string, Map<CostCategory, CategoryTotals>>();
+  const unknown = new Map<string, { calls: number; nanos: number }>();
+  let totalCalls = 0;
+
+  for (const group of groups) {
+    const category = costCategoryOf(group);
+    totalCalls += group.calls;
+
+    const overall = byCategory.get(category) ?? empty();
+    add(overall, group);
+    byCategory.set(category, overall);
+
+    const mine = byOwner.get(group.ownerId) ?? new Map<CostCategory, CategoryTotals>();
+    const ours = mine.get(category) ?? empty();
+    add(ours, group);
+    mine.set(category, ours);
+    byOwner.set(group.ownerId, mine);
+
+    if (category === "unknown") {
+      const key = describeFacts(group);
+      const seen = unknown.get(key) ?? { calls: 0, nanos: 0 };
+      seen.calls += group.calls;
+      seen.nanos += totalNanos(group);
+      unknown.set(key, seen);
+    }
+  }
+
+  const counts = new Map<CostCategory, number>();
+  for (const [category, totals] of byCategory) counts.set(category, totals.calls);
+  assertCategoriesCoverRows(counts, totalCalls);
+
+  return {
+    byCategory,
+    byOwner,
+    unknownFacts: [...unknown.entries()]
+      .map(([facts, seen]) => ({ facts, ...seen }))
+      .sort((a, b) => b.nanos - a.nanos),
+    totalCalls,
+  };
+}
+
+/** A spread over a population, with the population size beside it. */
+export interface Spread {
+  /** How many accounts the spread is over — **including the zero-spend ones**. */
+  n: number;
+  /** How many of those actually spent anything in this category. */
+  spending: number;
+  median: number;
+  p95: number;
+  max: number;
+  /** The sum, which is the only figure here that is not per-account. */
+  total: number;
+}
+
+/**
+ * **Nearest-rank percentiles**, over a population that must already include its
+ * zeroes.
+ *
+ * Nearest-rank rather than an interpolating estimator because at this sample
+ * size interpolation invents a value nobody was charged. With four accounts a
+ * "p95" is the most expensive account, and the report is expected to say so
+ * beside the number rather than let it read as a stable statistic.
+ *
+ * **The caller supplies the population, and that is the load-bearing part.**
+ * A spread over the owners a `GROUP BY` returned is a spread over *spending*
+ * owners, which biases every figure upward — GPT Sol's second structural finding
+ * on this stage. `spendPerAccount` below is what makes the zeroes real.
+ */
+export function spread(values: readonly number[]): Spread {
+  const sorted = [...values].sort((a, b) => a - b);
+  const n = sorted.length;
+  if (n === 0) return { n: 0, spending: 0, median: 0, p95: 0, max: 0, total: 0 };
+  const at = (fraction: number): number => {
+    /* Nearest-rank: the smallest value at or above the fraction of the way
+       through. `Math.max(1, …)` because `ceil(0)` is 0 and there is no zeroth
+       element. */
+    const rank = Math.max(1, Math.ceil(fraction * n));
+    return sorted[rank - 1] as number;
+  };
+  return {
+    n,
+    spending: sorted.filter((v) => v > 0).length,
+    median: at(0.5),
+    p95: at(0.95),
+    max: sorted[n - 1] as number,
+    total: sorted.reduce((a, b) => a + b, 0),
+  };
+}
+
+/**
+ * One number per account for one category — **zeroes included**.
+ *
+ * `accounts` is the denominator and comes from outside the ledger, because the
+ * ledger cannot produce it: a `GROUP BY ai_calls.owner_id` has nothing to group
+ * for somebody who made no calls, so every average over its result is an average
+ * over people who spent money. Until Stripe's subscriber set exists, the
+ * denominator is every account the Auth service knows about, and the report
+ * labels it as that rather than as "subscribers".
+ */
+export function spendPerAccount(
+  fold: SpendFold,
+  accounts: readonly string[],
+  categories: readonly CostCategory[],
+  money: (t: CategoryTotals) => number,
+): number[] {
+  return accounts.map((id) => {
+    const mine = fold.byOwner.get(id);
+    if (!mine) return 0;
+    let sum = 0;
+    for (const category of categories) {
+      const totals = mine.get(category);
+      if (totals) sum += money(totals);
+    }
+    return sum;
+  });
+}
diff --git a/src/store/ai-calls-spend-pg.ts b/src/store/ai-calls-spend-pg.ts
new file mode 100644
index 0000000..d73470d
--- /dev/null
+++ b/src/store/ai-calls-spend-pg.ts
@@ -0,0 +1,404 @@
+/**
+ * **Per-owner spend, aggregated by Postgres** — the query Stripe and the price
+ * are going to be argued from.
+ *
+ * ## Why this is not on `CostStore`
+ *
+ * Every other ledger question has two implementations, because
+ * [ai-calls-fs.ts](ai-calls-fs.ts) has to work on a laptop with no database.
+ * This one deliberately has one. GPT Sol, reviewing the plan on 2026-09-02:
+ *
+ * > Do not widen `CostStore` merely to preserve filesystem parity for a pricing
+ * > query whose source of truth is Postgres.
+ *
+ * The filesystem ledger is development evidence — `docs/plans/260902g-…` § the
+ * cutoff records the decision that **Postgres is authoritative from the Stage 1
+ * deployment timestamp**, with no import of the JSONL history. A second
+ * implementation of this over a file would be a second answer to a pricing
+ * question, and the wrong one would look exactly like the right one.
+ *
+ * ## Why it is a `GROUP BY` and not a fold over `read()`
+ *
+ * `CostStore.read(since, until)` fetches **every row in the window** and sums in
+ * JavaScript. That is fine at four thousand rows and not at four hundred
+ * thousand, and a monthly per-owner total is the thing that will be asked for
+ * every billing period for ever.
+ *
+ * The grouping keys are `(owner, scope_kind, purpose, step_name)` rather than
+ * `(owner, category)`, and that split is on purpose: **Postgres does the
+ * arithmetic, TypeScript does the naming.** Categorisation is a judgement about
+ * what the schema can honestly claim (see
+ * [../cost-categories.ts](../cost-categories.ts)), it changes as jobs are added,
+ * and it is worth having under test without a database. Encoding it as a SQL
+ * `CASE` would put it somewhere no unit test can reach and somewhere a peer
+ * writing their own query would not find it. The grouped result is bounded by
+ * owners × jobs × steps — tens of rows, not hundreds of thousands.
+ *
+ * ## The money expression, and why it is finally safe in SQL
+ *
+ *     coalesce(credits_used_nanos, 0)
+ *   + coalesce(byok_upstream_nanos, 0)
+ *   + coalesce(computed_cost_nanos, 0)
+ *
+ * That was **wrong** until 2026-09-02. `upstream_inference_nanos` was written on
+ * every chat-wire call, BYOK or not, holding the same money as
+ * `credits_used_nanos`, so the obvious sum doubled the bill — an auditor got
+ * $23.54 where the truth was $11.77. The rule that made a total correct lived
+ * only in `totalRows()` in JavaScript. drizzle/20260902141103 renamed the column
+ * `byok_upstream_nanos` and nulls it off a BYOK row, under a CHECK, precisely so
+ * that this expression is the whole of a row's money and nothing has to be
+ * conditional. `tests/store-ai-calls.test.ts` holds this sum against
+ * `totalRows()`; do not reinvent the old conditional here.
+ *
+ * ## The second file in this directory allowed to group by owner
+ *
+ * Every other module under `src/store/` answers *"what does this reader have"*,
+ * and `tests/owner-isolation.test.ts` greps for `groupBy(….ownerId)` — the shape
+ * of a question asked *across* owners — and fails on any file but the two named
+ * there. [pg-admin.ts](pg-admin.ts) was the first; this is the second, added
+ * 2026-09-02 with the same justification and under the same rule:
+ *
+ * - `/admin/users` reads it through the `/api/admin` gate in `src/routes.ts`,
+ *   which is the whole of the enforcement (docs/project/admin.md).
+ * - `npm run cost -- --owners` reads it from a CLI on Greg's own machine.
+ * - **It returns money and an owner id and nothing else** — no title, no URL, no
+ *   slug, no sentence of anybody's reading. That is the rule admin.md states for
+ *   the page, and it is the reason a second entry on that list is a widening
+ *   rather than a hole.
+ *
+ * A third would be a decision about who may see across owners, which is why the
+ * list is in the test rather than a per-file opt-out somewhere quieter.
+ *
+ * ## What may be logged from this file
+ *
+ * Nothing. It returns numbers and owner ids to one CLI and one admin route, and
+ * the insert path's `guardDbStore` reasoning applies to the callers rather than
+ * here — these statements bind two timestamps.
+ */
+
+import { and, gte, lt, sql } from "drizzle-orm";
+
+import { getDb } from "../db/client.js";
+import { aiCalls } from "../db/schema.js";
+
+/**
+ * One `(owner, scope, job, step)` bucket. The four keys are what the ledger
+ * knows about provenance; `src/cost-categories.ts` turns them into a name.
+ */
+export interface SpendGroup {
+  ownerId: string;
+  scopeKind: string;
+  /** `ai_calls.purpose` — `hierarchy`, `chat`, `live_conversation`, … */
+  job: string;
+  stepName: string | null;
+  calls: number;
+  /**
+   * The three pockets, kept apart all the way out of the database for the
+   * reason `totalRows()` gives: `credits` is what OpenRouter deducted and can be
+   * reconciled against their own running total, `byok` was billed to somebody
+   * else's key, and `computed` is our arithmetic over a price table nobody
+   * checks. Adding them is a caller's deliberate act, and the cash uplift below
+   * applies to exactly one of them.
+   */
+  creditsNanos: number;
+  byokNanos: number;
+  computedNanos: number;
+  /** `cost_source = 'provider'` — OpenRouter answered, including a BYOK zero. */
+  settledCalls: number;
+  /** `cost_source = 'computed'` — priced here, never reconciled. */
+  computedCalls: number;
+  /**
+   * Calls that happened and reported no money — **the same condition
+   * `totalRows()` uses**, restated in SQL, because a per-owner figure that
+   * cannot say it is short is false precision.
+   *
+   * It is not disjoint from `settledCalls`: a BYOK row where OpenRouter answered
+   * (`cost: 0`, so `provider`) but reported no upstream figure is both settled
+   * and unpriced. That is the truth about the row rather than a bug in the
+   * count, and the report says so rather than pretending the four numbers
+   * partition.
+   */
+  unpricedCalls: number;
+}
+
+/** What one owner cost over a window, with the honesty marker beside it. */
+export interface OwnerSpend {
+  nanos: number;
+  calls: number;
+  unpricedCalls: number;
+}
+
+/**
+ * **The current UTC month**, as a half-open range and a label — the one
+ * definition, used by the admin column and by `npm run cost`.
+ *
+ * A defined period is GPT Sol's condition on putting spend on `/admin/users`:
+ * *"A bare currency number would overclaim."* So the period has to be stated
+ * wherever the number is, and stated the same way in both places — a column
+ * headed "this month" that quietly means something else from the CLI is a
+ * discrepancy nobody would chase.
+ *
+ * UTC, like everything else in this ledger, and for a reason beyond consistency:
+ * OpenRouter's key limits reset at midnight UTC, so it is the only boundary the
+ * reconciliation can share. A call at 00:30 BST on 1 September is an August call
+ * here.
+ *
+ * This is **not** the period a Stripe invoice covers, and must never become one
+ * — billing periods start on the day somebody subscribed. It is a reporting
+ * window; `spendGroupedByOwner` takes arbitrary bounds precisely so that the
+ * billing question can be asked properly when there is a subscription to ask it
+ * of.
+ */
+export function currentUtcMonth(): { since: string; until: string; label: string } {
+  const now = new Date();
+  const year = now.getUTCFullYear();
+  const month = now.getUTCMonth();
+  return {
+    since: new Date(Date.UTC(year, month, 1)).toISOString(),
+    until: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
+    label: `${year}-${String(month + 1).padStart(2, "0")}`,
+  };
+}
+
+/** `[since, until)` — the end is the first instant *not* counted. */
+function window(since?: string, until?: string) {
+  const bounds = [
+    ...(since ? [gte(aiCalls.startedAt, new Date(since))] : []),
+    ...(until ? [lt(aiCalls.startedAt, new Date(until))] : []),
+  ];
+  return bounds.length > 0 ? and(...bounds) : undefined;
+}
+
+/*
+ * `.mapWith(Number)` on every figure, and it is load-bearing rather than
+ * decorative — the same trap `pg-admin.ts` documents. A `sql` fragment carries a
+ * TypeScript type and no runtime conversion, and node-postgres hands `count()`
+ * back as a **string** (it is `bigint`) and `sum()` as a **string** (it is
+ * `numeric`), so that precision cannot be lost in transit. Without the mapper
+ * every number here would be a string that sorts "10" below "9" and concatenates
+ * under `+`, which is a per-owner bill that is wrong in a way no type would
+ * catch.
+ */
+const CALLS = sql<number>`count(*)`.mapWith(Number);
+
+const CREDITS = sql<number>`coalesce(sum(${aiCalls.creditsUsedNanos}), 0)`.mapWith(Number);
+const BYOK = sql<number>`coalesce(sum(${aiCalls.byokUpstreamNanos}), 0)`.mapWith(Number);
+const COMPUTED = sql<number>`coalesce(sum(${aiCalls.computedCostNanos}), 0)`.mapWith(Number);
+
+const SETTLED_CALLS = sql<number>`count(*) filter (where ${aiCalls.costSource} = 'provider')`.mapWith(
+  Number,
+);
+const COMPUTED_CALLS =
+  sql<number>`count(*) filter (where ${aiCalls.costSource} = 'computed')`.mapWith(Number);
+
+/**
+ * **`totalRows()`'s definition of unpriced, in SQL.** The two must not drift:
+ * `tests/ai-calls-spend-pg.test.ts` runs both over the same fixtures and
+ * compares.
+ *
+ * A `computed` row is never unpriced — it has no `credits_used_nanos` at all and
+ * counting it would be the one thing it is not. Off a computed row, which figure
+ * is supposed to be there depends on `is_byok`, and `is true` rather than a bare
+ * truthiness test because the column is `boolean | null` and "we were not told"
+ * is not "no".
+ */
+const UNPRICED_CALLS = sql<number>`count(*) filter (
+  where ${aiCalls.costSource} <> 'computed'
+    and case when ${aiCalls.isByok} is true
+             then ${aiCalls.byokUpstreamNanos} is null
+             else ${aiCalls.creditsUsedNanos} is null
+        end
+)`.mapWith(Number);
+
+/**
+ * **Every owner's spend over `[since, until)`, split by what the work was.**
+ *
+ * Arbitrary bounds rather than a calendar month, because **Stripe billing
+ * periods are not months** — somebody who subscribes on the 14th has a period
+ * that starts on the 14th, and a query that could only answer for a month would
+ * have to be rewritten the day the first invoice is raised. This is the note the
+ * plan hands to the Stripe agent verbatim.
+ *
+ * Owners with no calls in the window are **not** in this result, and cannot be:
+ * a `GROUP BY` over the ledger has nothing to group for them. That is a real
+ * bias — it makes every average over "owners" an average over *spending* owners
+ * — and closing it needs a denominator from outside this table. The report gets
+ * one from the Auth service (`src/store/admin-accounts.ts`) and labels it.
+ */
+export async function spendGroupedByOwner(
+  since?: string,
+  until?: string,
+): Promise<SpendGroup[]> {
+  const rows = await getDb()
+    .select({
+      ownerId: aiCalls.ownerId,
+      scopeKind: aiCalls.scopeKind,
+      job: aiCalls.purpose,
+      stepName: aiCalls.stepName,
+      calls: CALLS,
+      creditsNanos: CREDITS,
+      byokNanos: BYOK,
+      computedNanos: COMPUTED,
+      settledCalls: SETTLED_CALLS,
+      computedCalls: COMPUTED_CALLS,
+      unpricedCalls: UNPRICED_CALLS,
+    })
+    .from(aiCalls)
+    .where(window(since, until))
+    .groupBy(aiCalls.ownerId, aiCalls.scopeKind, aiCalls.purpose, aiCalls.stepName);
+  return rows;
+}
+
+/**
+ * **What each owner's own reading cost this period** — the number the admin page
+ * puts in a column.
+ *
+ * `scope_kind in ('request', 'job_step')` and nothing else, so an eval run or a
+ * dev CLI invocation does not appear on the row of whoever's owner id the
+ * environment happened to be carrying. That is *our* spend measuring something,
+ * and on a per-account page it would read as a reader who costs forty times what
+ * anybody else does. The filter is a scope test rather than the category
+ * classifier on purpose: this file must stay importable from the store layer,
+ * and `src/cost-categories.ts` reaches `src/pipeline.ts`, which reaches back
+ * into the stores. `npm run cycles` is a gate.
+ *
+ * One statement, one group, one index (`ai_calls_owner_started`) — it stands
+ * beside the five aggregates `pg-admin.ts` already runs in parallel rather than
+ * adding a query per account.
+ */
+export async function productSpendByOwner(
+  since?: string,
+  until?: string,
+): Promise<Map<string, OwnerSpend>> {
+  const scope = sql`${aiCalls.scopeKind} in ('request', 'job_step')`;
+  const bounds = window(since, until);
+  const rows = await getDb()
+    .select({
+      ownerId: aiCalls.ownerId,
+      calls: CALLS,
+      creditsNanos: CREDITS,
+      byokNanos: BYOK,
+      computedNanos: COMPUTED,
+      unpricedCalls: UNPRICED_CALLS,
+    })
+    .from(aiCalls)
+    .where(bounds ? and(bounds, scope) : scope)
+    .groupBy(aiCalls.ownerId);
+
+  return new Map(
+    rows.map((r) => [
+      r.ownerId,
+      {
+        nanos: r.creditsNanos + r.byokNanos + r.computedNanos,
+        calls: r.calls,
+        unpricedCalls: r.unpricedCalls,
+      },
+    ]),
+  );
+}
+
+/** Which credentials paid for the window's rows, and how many each. */
+export interface CredentialTally {
+  /** `null` for rows written before fingerprints, or by a path that had no key. */
+  fingerprint: string | null;
+  calls: number;
+  /**
+   * The credits pocket only, because that is the only one OpenRouter's
+   * `/api/v1/key` has an opinion about. A BYOK row's money was billed to
+   * somebody else and a `computed` row never reached OpenRouter, so including
+   * either would guarantee a gap that is nobody's fault — and a difference that
+   * is always non-zero for a reason nobody names is a check everybody learns to
+   * ignore.
+   */
+  creditsNanos: number;
+}
+
+/**
+ * **Whose key paid** — the header's answer to "what is this report a report of".
+ *
+ * `--reconcile` compares one key's month against OpenRouter's own figure, and
+ * that comparison is meaningless if half the rows were bought on a different
+ * account. Printing the tally is cheaper than explaining a gap afterwards.
+ */
+export async function credentialsInWindow(
+  since?: string,
+  until?: string,
+): Promise<CredentialTally[]> {
+  const rows = await getDb()
+    .select({
+      fingerprint: aiCalls.credentialFingerprint,
+      calls: CALLS,
+      creditsNanos: CREDITS,
+    })
+    .from(aiCalls)
+    .where(window(since, until))
+    .groupBy(aiCalls.credentialFingerprint);
+  return [...rows].sort((a, b) => b.calls - a.calls);
+}
+
+/**
+ * Issued live sessions against the ones that actually produced a priced row.
+ *
+ * `silent` is the number that matters and it is the one nothing else can show: a
+ * session that was issued a token, connected, and reported no usage is either a
+ * conversation whose meter was lost or a reader who never spoke, and the ledger
+ * alone cannot tell those apart. Either way the voice figure below it is biased
+ * low by that many sessions, which is a sentence the report has to be able to
+ * write.
+ */
+export interface RealtimeCoverage {
+  issued: number;
+  connected: number;
+  /** Connected sessions with no `ai_calls` row pointing at them. */
+  silent: number;
+}
+
+/**
+ * `null` when `spideryarn.realtime_sessions` is not in this database.
+ *
+ * **Probed rather than assumed**, because the table arrived in
+ * drizzle/20260902150952 and a box whose migrations are behind — which on
+ * 2026-09-02 was every box, a peer's ledger row having blocked `db:migrate` —
+ * would otherwise fail the whole report with a bare `42P01`. A missing table
+ * here is a *coverage* fact: the report says voice cannot be seen from this
+ * database, which is exactly the kind of thing the coverage header exists for,
+ * and is a far better outcome than a stack trace or a confident zero.
+ */
+export async function realtimeSessionCoverage(
+  since?: string,
+  until?: string,
+): Promise<RealtimeCoverage | null> {
+  const db = getDb();
+  const probe = await db.execute<{ ready: boolean }>(
+    sql`select to_regclass('spideryarn.realtime_sessions') is not null as ready`,
+  );
+  const ready = (probe as unknown as { rows?: { ready: boolean }[] }).rows ?? [];
+  if (ready[0]?.ready !== true) return null;
+
+  const from = since ? sql`and s.issued_at >= ${new Date(since)}` : sql``;
+  const to = until ? sql`and s.issued_at < ${new Date(until)}` : sql``;
+  const result = await db.execute<{ issued: string; connected: string; silent: string }>(
+    sql`select
+          count(*) as issued,
+          count(*) filter (where s.connected_at is not null) as connected,
+          count(*) filter (
+            where s.connected_at is not null
+              and not exists (
+                select 1 from spideryarn.ai_calls c where c.realtime_session_id = s.id
+              )
+          ) as silent
+        from spideryarn.realtime_sessions s
+        where true ${from} ${to}`,
+  );
+  const rows = (result as unknown as { rows?: Record<string, string>[] }).rows ?? [];
+  const row = rows[0];
+  if (!row) return { issued: 0, connected: 0, silent: 0 };
+  /* `count()` is `bigint` and arrives as a string from a raw `execute`, where
+     there is no column mapper to go through. Converted here rather than left to
+     surprise a caller who adds two of them together. */
+  return {
+    issued: Number(row.issued),
+    connected: Number(row.connected),
+    silent: Number(row.silent),
+  };
+}
```
