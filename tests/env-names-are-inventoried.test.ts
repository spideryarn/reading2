/**
 * **Every environment name `src/` reads is accounted for, in exactly one door.**
 *
 * Stage 2 of
 * docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md,
 * and the thing
 * docs/postmortems/260827b-health-check-green-while-uploads-dead.md asked for as
 * item 1. Stage 1 (tests/env-reads-are-literal.test.ts) established *which*
 * names are read and refuses anything it cannot name; this file asks whether
 * each of them has been thought about.
 *
 * ## The four doors
 *
 * 1. **`EXPECTED`** in src/vercel-health.ts — the health report's table, a row's
 *    `or` alternative included. "An operator staring at this deployment would
 *    want to see whether this is set."
 * 2. **The required client build inputs** — `missingClientEnv` in
 *    scripts/build-stamp.ts, which *fails the build* when one is absent. That is
 *    a stronger guarantee than `/api/health` can give, because these are
 *    compiled into the bundle and health can only see the current project
 *    setting rather than what the running bundle was built with.
 * 3. **`ALLOWED`** below — a written allowlist, grouped, with one reason per
 *    group. "This is real, and it is not something an operator would act on in
 *    a health report."
 * 4. **`VITE_BUILT_INS`** — `PROD` and `MODE` are Vite constants substituted at
 *    compile time. They are not environment-variable names at all; they are here
 *    only because the sweep reads them off the same object as `VITE_SENTRY_DSN`
 *    and must account for every name it finds.
 *
 * **A name in no door is red, and a name in two doors is red as well.** The
 * second half is not tidiness: while a name sits in two doors, deleting it from
 * one leaves this gate green, and a door nobody notices going empty is a door
 * that has quietly stopped being read. The one real overlap is declared and
 * pinned as `EXPECTED_AND_BUILD_REQUIRED`, so it is a fact somebody wrote down
 * rather than a tolerance.
 *
 * ## And the reverse, in both directions
 *
 * A door that only ever grows is a door that rots. So an allowlisted name — or
 * a Vite built-in — that nothing under `src/` reads any more is red too, and it
 * has to be deleted rather than left as sediment.
 *
 * `EXPECTED` is the exception, and the distinction is the postmortem's own:
 * **it legitimately holds names no `src/` line reads**, because the SDK or the
 * platform reads them. `ANTHROPIC_API_KEY` was exactly that until 2026-08-31 —
 * in the table while nothing in this repo named it, because the Anthropic SDK
 * takes it from the environment itself. Those get `READ_OUTSIDE_SRC`, a
 * declared category with a reason, rather than a failure. It is empty today and
 * that is a true statement about the tree, not a stub: every name in `EXPECTED`
 * is currently read by a line under `src/`, `NODEJS_HELPERS` included
 * (src/vercel-health.ts reads it to validate it). The category exists so that
 * the day somebody re-adds a name the platform reads, the remedy in front of
 * them is "declare why", not "delete the reverse check".
 *
 * ## Why the failure message asks rather than tells
 *
 * A peer session on 2026-09-08 watched three sessions hit one failing guard and
 * all three reach first for the remedy its message suggested — right for the
 * common case, silently wrong for theirs, and following it would have made the
 * test green while making the fixtures lie. **The remedy a guard suggests is
 * the part people act on, more than the diagnosis.** So the message below names
 * all four doors and what each one means, and picks none of them. Choosing is
 * the work; a message that chooses for you is a message that gets the wrong
 * answer written down four times out of five.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { missingClientEnv } from "../scripts/build-stamp.js";
import { type AstNode, lineOf, parseSource, walkAst } from "./helpers/ts-ast.js";
import { type EnvSweep, type NameSite, sweepEnvReads } from "./helpers/env-reads.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(REPO_ROOT, "src");
const HEALTH = "src/vercel-health.ts";

/* ────────────────────────────────────────────────────────────────────────────
   Door 3 — the allowlist

   Ported from docs/plans/260907e-stage4-candidate.ts.txt, a parked candidate
   whose architecture failed review twice but whose groups and reasons were
   never what the reviews objected to.

   **Every reason was re-checked against the tree on 2026-09-08 before it was
   kept, and three of them did not survive** — see the notes on the platform
   group, on `NODE_ENV` and on `SPIDERYARN_ENV_PINNED`. A reason that is false is worse than no
   reason: it is what the next person checks against instead of the code. That
   is the candidate's own sentence, and it was written after GPT Sol found four
   of its groups claiming variables were "never read by a deployment" when the
   deployment reads all four.

   A name here is a decision, not a suppression: it says *this is not something
   an operator reading a deployment's health would act on*. If that stops being
   true, move it to `EXPECTED`.
   ──────────────────────────────────────────────────────────────────────────── */

interface AllowGroup {
  readonly why: string;
  readonly names: readonly string[];
}

const ALLOWED: readonly AllowGroup[] = [
  {
    /* The `NODEJS_HELPERS` mistake in reverse: that one is in `EXPECTED`
       because the *platform* reads it and can have it wrong. These the platform
       *writes*, so there is nothing for anybody to set, and a report demanding
       one would be telling an operator to go and configure something they have
       no control over.

       **The candidate's wording was "a deployment cannot be missing one", and
       that is false of the last name in this group.** `VERCEL_GIT_COMMIT_SHA`
       is absent whenever a `vercel deploy` runs from a working directory with
       no git ref attached — scripts/build-stamp.ts says so, at length, and that
       absence is the reason the build stamp exists at all. The variable is
       still nobody's setting: what it says is a property of how the deploy was
       made. So the reason is about *who writes it*, not about whether it is
       always there.

       **`VITE_VERCEL_ENV` is not in this group, and it probably should be** —
       left alone here deliberately, because moving it means editing a row of
       `EXPECTED` rather than adding one, and correcting that table's prose is
       Stage 3's job. The candidate's reason, which src/vercel-health.ts's row
       still carries, is that it *looks* platform-set and is not: Vercel writes
       `VERCEL_ENV`, Vite exposes only `VITE_`-prefixed names, and nothing here
       bridges the two, so a person must set it on the project. **GPT Sol's
       review of this stage says that is false**, and vercel.json:3 is the
       evidence: this project declares `"framework": "vite"`, and Vercel's
       framework environment variables add `VITE_`-prefixed copies of its system
       variables for production and preview builds of a detected framework —
       `VITE_VERCEL_ENV` among them. So it is platform-provided build metadata,
       and its `EXPECTED` row rests on a claim about the platform that nothing
       in this repo can check and that the platform's own documentation
       contradicts. Written down here rather than acted on, so Stage 3 inherits
       a finding instead of an absence.

       `VERCEL_PROJECT_PRODUCTION_URL` joined this group on 2026-09-08. It is
       one of the two names `ownOrigins()` (src/sanitize-policy.ts) reads to
       know which origins are *us*, and it was in no door at all until then —
       found by this sweep rather than by anybody noticing. Vercel sets it on
       every deployment, preferring a custom domain where one is attached
       (docs/project/security.md § the sanitiser's own origins), so it is the
       same kind of thing as `VERCEL_URL` beside it. */
    why: "Written by the Vercel platform rather than by anybody configuring a deployment",
    names: [
      "VERCEL",
      "VERCEL_ENV",
      "VERCEL_REGION",
      "VERCEL_URL",
      "VERCEL_GIT_COMMIT_SHA",
      "VERCEL_PROJECT_PRODUCTION_URL",
    ],
  },
  {
    /* `NODE_ENV` is Node's own and Vercel sets it on a deployment. Five of its
       eight reads ask "am I in production or test" (src/log.ts:57, src/env.ts,
       src/owner.ts, src/store/index.ts) and three use the answer as a label on
       a log line or a Sentry event (src/log.ts:156, src/monitoring.ts,
       src/routes.ts). None of them is a deployment setting. `VITEST` is set by
       the runner and read once, in the same breath, at src/store/index.ts:174. */
    why: "Set by the runtime or the test runner, and read to ask which of those we are in",
    names: ["NODE_ENV", "VITEST"],
  },
  {
    /* All three **are** read by a deployment, which is where the candidate's
       first wording went wrong, and the true claim is the narrower one above.

       `PGAPPNAME` names the connection in `pg_stat_activity` (`applicationName()`,
       src/db/client.ts) and has a useful default built from the directory and
       the pid; a deployed pool reads it and nothing follows from its absence.
       `SENTRY_FORCE_LOCAL` is the first line of `isDeployed()`
       (src/monitoring.ts), so deployed monitoring evaluates it on every start —
       it exists so a laptop can pretend to be deployed, and setting it on a
       real deployment changes nothing, because `Boolean(process.env.VERCEL)`
       has already made that branch true. `SPIDERYARN_OWNER_EMAIL`'s expression
       is evaluated wherever src/owner.ts loads, deployments included, but what
       it computes is `DEV_OWNER_EMAIL` — the label on the seeded local
       development account — so what it says about a deployment is nothing. */
    why: "Read by a deployment, but nothing an operator would act on in a health report",
    names: ["PGAPPNAME", "SENTRY_FORCE_LOCAL", "SPIDERYARN_OWNER_EMAIL"],
  },
  {
    /* **`SPIDERYARN_BASE_URL` was an `EXPECTED` entry for a few hours on
       2026-09-07 and moving it here is the interesting one.** It is where
       Stripe returns a reader after Checkout, and the production table in
       docs/project/deployment.md lists it under "**must stay unset here**, and
       it is listed so nobody adds it" — `billingReturnOrigin()`
       (src/billing/checkout.ts) answers `PUBLIC_ORIGIN` before it reads any
       variable, and a preview falls back to `VERCEL_URL`. Reporting a setting
       production is documented as forbidden to have is worse than not
       reporting it: a line in a health report is an invitation to set the
       thing. It exists for a worktree's dev server on 5274, 5275…  GPT Sol,
       F14.

       `SPIDERYARN_ENV_PINNED` names which inherited variables a `.env.local`
       file may not overwrite, and `loadEnvLocal` (src/env.ts) reads it only
       after finding a `.env.local` at all — which a deployment does not have.
       **The candidate said "only tests/setup/* sets it" and that is not true**:
       nothing under tests/setup/ sets it today; the setters are
       tests/store-boots-without-inherited-credentials.test.ts and the child
       environments some test helpers hand down. It is in neither .env.example
       nor deployment.md, and it is the variable this whole plan was written
       around — no inventory knew about it until something tried to enumerate
       every read. */
    why: "A developer's own machine — and one of them production is documented as forbidden to set",
    names: ["SPIDERYARN_BASE_URL", "SPIDERYARN_ENV_PINNED"],
  },
  {
    /* Whole-run switches somebody sets for one command: the reasoning effort
       every pipeline stage asks for (`effortFor`, src/models.ts), and the three
       hierarchy-deepening experiments (src/hierarchy-deepen.ts, whose exported
       `DEEPEN_ENV`, `REASK_ENV` and `DEEPEN_RECORDS_ENV` are the same three
       strings). A deployment has no opinion about any of them, and reporting
       them would put four lines of tuning above the credentials that actually
       break things. */
    why: "Per-run pipeline switches, set for one command on the machine running it",
    names: [
      "SPIDERYARN_PIPELINE_EFFORT",
      "SPIDERYARN_DEEPEN_HIERARCHY",
      "SPIDERYARN_DEEPEN_REASK",
      "SPIDERYARN_DEEPEN_RECORDS",
    ],
  },
  {
    /* `MODEL_ENV_VAR` in src/models.ts, one per task that has an override, and
       they exist for exactly one purpose: running the real feature against a
       different model for an evening to see whether the cheap one is good
       enough. Twelve names as a group rather than twelve identical comments —
       they are one decision, not twelve.

       **Set on a deployment one of these really would change what a request
       sends**, which the candidate's first wording denied. They are allowlisted
       because `GET /api/models` already reports the model each task will
       actually use, with `source: "override"` when a variable put it there
       (`modelsInUse`, src/routes.ts), and /profile renders it
       (src/web/ProfilePage.tsx). So the health report is neither where anybody
       would look nor where the better answer is. */
    why: "Per-task model overrides for a comparison run — reported by /api/models, not by health",
    names: [
      "SPIDERYARN_EXPLAIN_MODEL",
      "SPIDERYARN_CHAT_MODEL",
      "SPIDERYARN_QUIZ_MARK_MODEL",
      "SPIDERYARN_QUIZ_VERDICT_MODEL",
      "SPIDERYARN_SEARCH_MODEL",
      "SPIDERYARN_PDF_FRONTMATTER_MODEL",
      "SPIDERYARN_REFEREE_MIRROR_MODEL",
      "SPIDERYARN_REFEREE_CRITERIA_MODEL",
      "SPIDERYARN_REFEREE_CLAIMS_MODEL",
      "SPIDERYARN_REFEREE_CANDIDATES_MODEL",
      "SPIDERYARN_DEBATE_MODEL",
      "SPIDERYARN_LINK_SUMMARY_MODEL",
    ],
  },
];

/* ────────────────────────────────────────────────────────────────────────────
   Door 4 — the Vite build constants
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * `import.meta.env.PROD` and `.MODE`, both in src/web/monitoring.ts.
 *
 * Vite substitutes both at build time from how the build was invoked. There is
 * no such environment variable and an operator cannot set one — which is why
 * this is a door of its own rather than an allowlist group: the allowlist says
 * "a real variable nobody would act on", and that is a different claim from
 * "not a variable". They are here at all only because the sweep reads them off
 * the same object as `VITE_SENTRY_DSN` and must account for every name it finds.
 */
const VITE_BUILT_INS: readonly string[] = ["PROD", "MODE"];

/* ────────────────────────────────────────────────────────────────────────────
   The one declared overlap
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The two names that are honestly in both `EXPECTED` and the build-input door,
 * and are neither a duplication nor an oversight.
 *
 * `scripts/build-stamp.ts` fails the build when either is absent, because
 * src/web/lib/supabase.ts throws at module load without them and the result is
 * a blank page that logs nothing — `www.spideryarn.com`, for a few hours on
 * 2026-08-27. `EXPECTED` reports them as well, and that line is worth having
 * *and* is weaker than it looks: they are compiled into the bundle, so what
 * `/api/health` sees is the current project setting rather than what the
 * running bundle was built with. Set them and never redeploy and health goes
 * green over the blank page. Absence is still conclusive, and absence is the
 * case that actually happened.
 *
 * So both doors are true of these two, for different reasons, and the overlap
 * is pinned exactly rather than tolerated: a third name in both goes red, and
 * so does either of these leaving either door.
 */
const EXPECTED_AND_BUILD_REQUIRED: readonly string[] = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
];

/* ────────────────────────────────────────────────────────────────────────────
   `EXPECTED` rows that no line under `src/` reads
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * `EXPECTED` rows that no line under `src/` reads, and why that is right.
 *
 * **Empty on 2026-09-08, and that is a measured fact rather than a stub**: all
 * twenty names the table asks for are read by a line this sweep can point at,
 * `NODEJS_HELPERS` included — src/vercel-health.ts reads it in order to check
 * it is exactly `"0"`.
 *
 * The category exists because the distinction is real and the postmortem drew
 * it: `ANTHROPIC_API_KEY` sat in this table until 2026-08-31 while nothing in
 * this repo ever named it, because the Anthropic SDK takes it from the
 * environment itself. The next such name will arrive, and when it does the
 * remedy in front of whoever meets the red is "write down why the platform or
 * an SDK reads this", not "delete the check that noticed".
 *
 * Keys are `EXPECTED` names; values are the reason, in one sentence.
 */
const READ_OUTSIDE_SRC: Readonly<Record<string, string>> = {};

/* ────────────────────────────────────────────────────────────────────────────
   Reading `EXPECTED` out of src/vercel-health.ts

   Statically, rather than by importing the module: importing it pulls in the
   database client and the store, and this gate has no business needing either.
   Reading the source is also reading the same table a person reads.

   It refuses rather than skips, in Stage 1's shape: a row it cannot read as an
   object literal with a string-literal `name` is an error, never a row quietly
   left out of the door. A door that silently omits a row makes a name look
   unaccounted for, and the remedy somebody would reach for then is to add a
   duplicate entry somewhere else.
   ──────────────────────────────────────────────────────────────────────────── */

interface ExpectedRow {
  name: string;
  or: string | null;
  line: number;
}

/** One row, refusing anything it cannot read as literal text. */
function rowFrom(el: AstNode): ExpectedRow {
  if (el.type !== "ObjectExpression") {
    throw new Error(
      `${HEALTH}:${lineOf(el)}: an EXPECTED element is a ${String(el.type)}, not an object ` +
        "literal. A spread or a computed row cannot be read here, and is refused rather than " +
        "skipped — docs/reusable/silent-success.md.",
    );
  }
  const fields = new Map<string, string>();
  for (const rawProp of el.properties as unknown[]) {
    const prop = rawProp as AstNode;
    /* **A spread is refused, not skipped.** This read `continue` until GPT Sol's
       review of Stage 2: `{ name: "X", ...alternative }` would have had its `or`
       silently dropped, so a real second name — or a real two-door overlap —
       could sit in the running table while this parser reported neither, and
       every assertion below stayed green over it. That is the exact class this
       whole plan exists to close, reproduced inside the gate meant to close it.
       An `ObjectMethod` is refused for the same reason: no row has one today,
       and a row that grows one is a shape somebody has to come and teach this. */
    if (prop.type !== "ObjectProperty") {
      throw new Error(
        `${HEALTH}:${lineOf(prop)}: an EXPECTED row contains a ${String(prop.type)}. This gate ` +
          "reads the table syntactically and cannot see through a spread or a method, so it " +
          "refuses rather than reporting a row with a field missing — " +
          "docs/reusable/silent-success.md.",
      );
    }
    const key = prop.key as AstNode;
    if (prop.computed || key.type !== "Identifier") {
      throw new Error(
        `${HEALTH}:${lineOf(prop)}: an EXPECTED row has a computed or non-identifier key.`,
      );
    }
    if (key.name !== "name" && key.name !== "or") continue;
    const value = prop.value as AstNode;
    if (value.type !== "StringLiteral") {
      throw new Error(
        `${HEALTH}:${lineOf(prop)}: EXPECTED.${String(key.name)} is a ${String(value.type)}, ` +
          "not a string literal. The name a deployment is asked for has to be readable here.",
      );
    }
    fields.set(String(key.name), String(value.value));
  }
  const name = fields.get("name");
  if (!name) throw new Error(`${HEALTH}:${lineOf(el)}: an EXPECTED row has no \`name\``);
  return { name, or: fields.get("or") ?? null, line: lineOf(el) };
}

/* ────────────────────────────────────────────────────────────────────────────
   Door 2 is a *function*, and a function nobody calls is not a door

   `missingClientEnv({})` is the right derivation of "what the build refuses to
   go without" only while the build actually calls it. GPT Sol's review of this
   stage: delete the call from `vite.config.ts`'s `buildStart` and this gate
   stays green, `tests/build-stamp.test.ts` stays green — it exercises the
   helper — and builds silently stop refusing either missing input, while the
   worked example below goes on claiming "the build still refuses without it".
   A door derived from a dead helper is the sharpest form of the thing this
   plan is about.

   So the call site is checked, in the shape Stage 1's sweep uses for
   everything positional: find the call, take its enclosing function's byte
   range, and require the build's own failure call inside it. Nothing here
   resolves a binding or follows a value.
   ──────────────────────────────────────────────────────────────────────────── */

const VITE_CONFIG = "vite.config.ts";

function buildRefusesWithoutClientEnv(): { calls: number; failsInside: boolean } {
  const source = readFileSync(path.join(REPO_ROOT, VITE_CONFIG), "utf8");
  const parsed = parseSource(source);
  const errors = parsed.errors ?? [];
  if (errors.length > 0) {
    throw new Error(`${VITE_CONFIG} did not parse cleanly: ${errors.length} error(s)`);
  }

  const parents = new Map<AstNode, AstNode | null>();
  const calls: AstNode[] = [];
  const FUNCTIONS = new Set([
    "ObjectMethod",
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
    "ClassMethod",
  ]);
  walkAst(parsed.program as unknown, (n, parent) => {
    parents.set(n, parent);
    if (n.type !== "CallExpression") return;
    const callee = n.callee as AstNode;
    if (callee?.type === "Identifier" && callee.name === "missingClientEnv") calls.push(n);
  });
  const call = calls[0];
  if (!call) return { calls: 0, failsInside: false };

  let enclosing: AstNode | null = call;
  while (enclosing && !FUNCTIONS.has(String(enclosing.type))) {
    enclosing = parents.get(enclosing) ?? null;
  }
  if (!enclosing) return { calls: calls.length, failsInside: false };
  const from = Number(enclosing.start ?? -1);
  const to = Number(enclosing.end ?? -1);

  /* `this.error(…)` is how a Rollup plugin hook aborts the build. Anything else
     — a warning, a log line — would leave a deployment building happily without
     the two variables that make it a blank page. */
  let failsInside = false;
  walkAst(parsed.program as unknown, (n) => {
    if (n.type !== "CallExpression") return;
    const at = Number(n.start ?? -1);
    if (at < from || at >= to) return;
    const callee = n.callee as AstNode;
    if (callee?.type !== "MemberExpression" || callee.computed) return;
    const object = callee.object as AstNode;
    const property = callee.property as AstNode;
    if (object?.type === "ThisExpression" && property?.name === "error") failsInside = true;
  });
  return { calls: calls.length, failsInside };
}

function readExpectedTable(): ExpectedRow[] {
  const source = readFileSync(path.join(REPO_ROOT, HEALTH), "utf8");
  const parsed = parseSource(source);
  /* `errorRecovery: true`, so a file this cannot parse comes back looking fine
     unless `errors` is read — the same trap tests/helpers/env-reads.ts's header
     names as one of the two things that must not be softened. */
  const errors = parsed.errors ?? [];
  if (errors.length > 0) {
    throw new Error(`${HEALTH} did not parse cleanly: ${errors.length} error(s)`);
  }

  let array: AstNode | null = null;
  walkAst(parsed.program as unknown, (n, _parent, _key) => {
    if (n.type !== "VariableDeclarator") return;
    const id = n.id as AstNode | undefined;
    if (id?.type !== "Identifier" || id.name !== "EXPECTED") return;
    const init = n.init as AstNode | undefined;
    /* `EXPECTED` is written `[…] as const`-free but with a type annotation, so
       the initialiser is the array itself. A `TSAsExpression` wrapper would be
       a shape this has not been taught, and it is refused rather than unwrapped
       on a guess. */
    if (init?.type !== "ArrayExpression") {
      throw new Error(
        `${HEALTH}: EXPECTED is initialised with a ${String(init?.type)}, not an array literal. ` +
          "This gate reads the table syntactically and will not guess at a new shape.",
      );
    }
    if (array) throw new Error(`${HEALTH}: two declarations named EXPECTED`);
    array = init;
  });
  if (!array) throw new Error(`${HEALTH}: no declaration named EXPECTED — the door has moved`);

  const rows: ExpectedRow[] = [];
  for (const raw of (array as AstNode).elements as unknown[]) {
    const el = raw as AstNode | null;
    if (!el) continue;
    rows.push(rowFrom(el));
  }
  return rows;
}

/* ────────────────────────────────────────────────────────────────────────────
   The gate
   ──────────────────────────────────────────────────────────────────────────── */

/** What each door means, in the words somebody has to choose between. */
const DOORS = [
  `1. EXPECTED in ${HEALTH} — an operator staring at this deployment would want to see whether ` +
    "this is set. Every new entry is `breaks: null`: a `breaks` clause warns a deployment that " +
    "has not set the variable, and that is a judgement about production which a static sweep is " +
    "not entitled to make.",
  "2. The required client build inputs — `missingClientEnv` in scripts/build-stamp.ts. Only for " +
    "a name whose absence must fail the build, because it is compiled into the client bundle.",
  "3. The allowlist in this file — real, but not something an operator would act on in a health " +
    "report. Join a group whose reason already covers it, or write a new group with a new reason.",
  "4. VITE_BUILT_INS in this file — a Vite constant substituted at compile time, not an " +
    "environment variable at all. Vite defines five — MODE, BASE_URL, PROD, DEV and SSR — and " +
    "two of them are read here; a third arriving is a name for this door, not a reason to doubt it.",
];

/**
 * Where a name is read, for a message somebody has to act on.
 *
 * A name a *pinned region* declares has no line — the sweep cannot see the read
 * and a human wrote the name down beside the pin's checksum — so it reports as
 * `:0`, which reads like a bug in the message rather than the truth about the
 * read. It is said in words instead: whoever meets this red needs to know that
 * opening src/models.ts at line 0 is not the next move.
 */
function describeSites(sites: NameSite[]): string {
  return sites
    .map((s) => (s.door === "pin" ? `${s.file} (declared by a pinned region)` : `${s.file}:${s.line}`))
    .join(", ");
}

describe("every environment name src/ reads is inventoried", () => {
  let sweep: EnvSweep;
  let expectedRows: ExpectedRow[];
  let expectedNames: Set<string>;
  let buildRequired: Set<string>;
  let allowed: Set<string>;
  let builtIns: Set<string>;

  beforeAll(async () => {
    sweep = await sweepEnvReads(SRC);
    expectedRows = readExpectedTable();
    expectedNames = new Set(expectedRows.flatMap((r) => (r.or ? [r.name, r.or] : [r.name])));
    /* Derived by *calling* the build's own check with an empty environment, so
       this door is whatever actually fails the build rather than a copy of it
       kept in step by hand. A third required input appears here the moment it
       appears there. */
    buildRequired = new Set(missingClientEnv({}));
    allowed = new Set(ALLOWED.flatMap((g) => g.names));
    builtIns = new Set(VITE_BUILT_INS);
  }, 60_000);

  /* The sweep is Stage 1's, and Stage 1 asserts it refuses nothing — but a
     refusal means the *name list this file inventories* is incomplete, so
     believing an empty answer here while the sweep is choking is exactly the
     shape docs/reusable/silent-success.md is about. Cheap, so it is asserted on
     both sides of the seam rather than assumed across it. */
  it("is inventorying a sweep that refused nothing and found something", () => {
    expect(sweep.refusals).toEqual([]);
    expect(sweep.uniqueNames.length).toBeGreaterThan(30);
    expect(expectedRows.length).toBeGreaterThan(10);
    expect([...buildRequired]).toEqual(["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]);

    /* And that door is only a door while the build walks through it. */
    const site = buildRefusesWithoutClientEnv();
    expect(site.calls, `${VITE_CONFIG} must call missingClientEnv exactly once`).toBe(1);
    expect(
      site.failsInside,
      `${VITE_CONFIG} calls missingClientEnv but does not abort the build with this.error() in ` +
        "the same function. Door 2 claims a guarantee stronger than /api/health's — a build that " +
        "refuses to produce a blank-page bundle. Without the abort it is a helper nobody obeys, " +
        "and every assertion in this file would stay green over it.",
    ).toBe(true);
  });

  it("accounts for every name in at least one door", () => {
    const unaccounted = sweep.uniqueNames.filter(
      (n) => !expectedNames.has(n) && !buildRequired.has(n) && !allowed.has(n) && !builtIns.has(n),
    );
    if (unaccounted.length === 0) return;

    const detail = unaccounted
      .map((n) => `  ${n}\n    read at ${describeSites(sweep.names.filter((s) => s.name === n))}`)
      .join("\n");

    throw new Error(
      `${unaccounted.length} environment name(s) that src/ reads and no door accounts for:\n` +
        `${detail}\n\n` +
        "Each one needs a decision about which of four doors it belongs in. They mean different " +
        "things and only one of them is right for any given name:\n\n" +
        `${DOORS.join("\n\n")}\n\n` +
        "Pick the door that is true of the variable. Putting it in EXPECTED because that is the " +
        "first door listed adds a line to every operator's health report about something they " +
        "cannot act on, which is the mistake that table's own header is about.",
    );
  });

  /* Two doors is as bad as none, and for a reason that is not neatness: while a
     name is in two, deleting it from one leaves this gate green. The real
     overlap is declared and pinned below rather than tolerated here. */
  it("puts no name in two doors, except the one declared overlap", () => {
    const doorsOf = (n: string) =>
      [
        expectedNames.has(n) ? "EXPECTED" : null,
        buildRequired.has(n) ? "build-required" : null,
        allowed.has(n) ? "allowlist" : null,
        builtIns.has(n) ? "Vite built-in" : null,
      ].filter((d): d is string => d !== null);

    const declared = new Set(EXPECTED_AND_BUILD_REQUIRED);
    const all = new Set([...sweep.uniqueNames, ...expectedNames, ...buildRequired, ...allowed]);
    const doubled = [...all].filter((n) => doorsOf(n).length > 1 && !declared.has(n));

    expect(
      doubled.map((n) => `${n} is in ${doorsOf(n).join(" and ")}`),
      "A name in two doors leaves this gate green when one of them is emptied. If the overlap is " +
        "real and deliberate, declare it in EXPECTED_AND_BUILD_REQUIRED with the reason; " +
        "otherwise take it out of the door that is not true of it.",
    ).toEqual([]);

    /* And the declared overlap is pinned in the other direction too, so a
       declaration cannot outlive the fact it describes. */
    for (const name of EXPECTED_AND_BUILD_REQUIRED) {
      expect(doorsOf(name).sort(), `${name} is declared as an EXPECTED/build overlap`).toEqual([
        "EXPECTED",
        "build-required",
      ]);
    }
  });

  /* The other direction of rot. A door that only grows accumulates names for
     variables that no longer exist, and then it is a list nobody trusts. */
  it("holds no allowlisted name that nothing under src/ reads any more", () => {
    const read = new Set(sweep.uniqueNames);
    const dead = [...allowed, ...builtIns].filter((n) => !read.has(n));
    expect(
      dead,
      "These are allowlisted (or listed as Vite built-ins) and no line under src/ reads them. " +
        "The read has gone; delete the entry rather than leaving sediment behind. If the read is " +
        "still there and the sweep cannot see it, that is a Stage 1 refusal and a much bigger " +
        "problem than this list.",
    ).toEqual([]);
  });

  /* `EXPECTED` is the exception to the rule above, and the exception is
     declared rather than assumed. See the header. */
  it("holds no EXPECTED row that nothing reads and nothing has declared", () => {
    const read = new Set(sweep.uniqueNames);
    const orphans = [...expectedNames].filter((n) => !read.has(n) && !(n in READ_OUTSIDE_SRC));
    expect(
      orphans,
      `These are in ${HEALTH}'s EXPECTED table and no line under src/ names them. That is ` +
        "legitimate when the SDK or the platform reads the variable on our behalf — " +
        "ANTHROPIC_API_KEY was exactly that until 2026-08-31 " +
        "(docs/postmortems/260827b-health-check-green-while-uploads-dead.md). If that is the " +
        "case, say so in READ_OUTSIDE_SRC with the reason. If it is not, the report is offering " +
        "an operator a name nothing uses, which is the mistake EXPECTED's own header is about.",
    ).toEqual([]);

    const stale = Object.keys(READ_OUTSIDE_SRC).filter((n) => read.has(n));
    expect(
      stale,
      "These are declared in READ_OUTSIDE_SRC as read only by an SDK or the platform, and src/ " +
        "now reads them by name. The declaration has become false; delete it.",
    ).toEqual([]);

    const unlisted = Object.keys(READ_OUTSIDE_SRC).filter((n) => !expectedNames.has(n));
    expect(unlisted, "READ_OUTSIDE_SRC explains EXPECTED rows, so every key must be one").toEqual(
      [],
    );
  });

  /* Named rather than counted, because every assertion above is that a list is
     empty and an empty list is also what a sweep that examined nothing
     produces. These are chosen one per door, so a door that has silently
     stopped being consulted cannot leave this green. */
  it("has one worked example in each door, named", () => {
    expect(expectedNames.has("OPENROUTER_API_KEY"), "EXPECTED still carries the gateway key").toBe(
      true,
    );
    expect(
      buildRequired.has("VITE_SUPABASE_URL"),
      "the build door still names it — that the build obeys the door is asserted separately",
    ).toBe(true);
    expect(allowed.has("VERCEL_URL"), "the allowlist still carries a platform variable").toBe(true);
    expect(builtIns.has("PROD"), "PROD is still a Vite constant rather than a variable").toBe(true);
  });

  /* Every allowlist group has to say why, and the reason has to be a sentence
     somebody wrote — an empty group, or a group with no reason, is the shape of
     a name that was parked rather than decided. */
  it("gives every allowlist group a reason and every name exactly one group", () => {
    for (const group of ALLOWED) {
      expect(group.why.length, `a group with ${group.names.length} names has no reason`)
        .toBeGreaterThan(20);
      expect(group.names.length, `"${group.why}" is a reason with no names`).toBeGreaterThan(0);
    }
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const group of ALLOWED) {
      for (const name of group.names) {
        const first = seen.get(name);
        if (first) twice.push(`${name} is in "${first}" and in "${group.why}"`);
        else seen.set(name, group.why);
      }
    }
    expect(twice, "one name, one reason — two reasons means neither was decided").toEqual([]);

    /* `READ_OUTSIDE_SRC` promises a reason too, and until GPT Sol's review of
       this stage it only checked the key: `{ ANTHROPIC_API_KEY: "" }` satisfied
       every assertion in this file while the header and the plan both said a
       reason was written down. An empty category whose contract is unenforced
       is a contract that will be met with an empty string the first time
       somebody is in a hurry. */
    const unreasoned = Object.entries(READ_OUTSIDE_SRC)
      .filter(([, why]) => why.trim().length < 20)
      .map(([name]) => name);
    expect(
      unreasoned,
      "READ_OUTSIDE_SRC says a name in EXPECTED is read by the platform or an SDK rather than by " +
        "src/. That claim is only useful with the reason attached — which SDK, reading it when.",
    ).toEqual([]);
  });
});
