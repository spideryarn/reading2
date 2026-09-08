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

       **`VITE_VERCEL_ENV` joined this group on 2026-09-08, out of `EXPECTED`,
       and the two halves of that move were settled by two different things
       neither of which was reading this repo harder.** Stage 2 left it in
       `EXPECTED` with a finding attached; Stage 3 acted on it.

       Half one, from GPT Sol's review of Stage 2: the row's reason — that it
       *looks* platform-set and is not, so a person must set it — is false.
       vercel.json:3 declares `"framework": "vite"`, and Vercel's framework
       environment variables add `VITE_`-prefixed copies of its system variables
       to a detected framework's deployment, `VITE_VERCEL_ENV` among them.

       Half two, which the review called unsettleable from here and which one
       HTTP request settled *for the deployment that matters*: /api/health reads
       `process.env` in the serverless function. Production, commit `0f221810`
       on 2026-09-08, returns `"ok": true` with no warnings and
       `"VITE_VERCEL_ENV": false`. So the `EXPECTED` row was reporting `false`
       about a correctly configured deployment, which is worse than the drift it
       was added for.

       **The documentation says the opposite of the measurement**, and that is
       recorded rather than resolved: under the `Vite` preset, Vercel lists
       `VITE_VERCEL_ENV` as "Available at: Both build and runtime" (fetched
       2026-09-08), and Sol argued in a later round that the platform documents
       these as build-only, which is not what the page says. Neither claim is
       load-bearing here. The row reported `false` about a healthy deployment;
       that is the whole basis for this door, and it needs no platform rule.

       Here, the name is inventoried and nobody is asked to act on it. **A
       build-time input is not made checkable by being reported at runtime**,
       and this group is where that belongs.

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
      "VITE_VERCEL_ENV",
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

function parseHealth(): AstNode {
  const source = readFileSync(path.join(REPO_ROOT, HEALTH), "utf8");
  const parsed = parseSource(source);
  /* `errorRecovery: true`, so a file this cannot parse comes back looking fine
     unless `errors` is read — the same trap tests/helpers/env-reads.ts's header
     names as one of the two things that must not be softened. */
  const errors = parsed.errors ?? [];
  if (errors.length > 0) {
    throw new Error(`${HEALTH} did not parse cleanly: ${errors.length} error(s)`);
  }
  return parsed.program as unknown as AstNode;
}

/**
 * The array literal inside `EXPECTED`'s initialiser, refusing any other shape.
 *
 * **Taught one shape, step by step, rather than unwrapping whatever it finds.**
 * The table is written `[…] as const satisfies readonly Expected[]`, which
 * `@babel/parser` gives as a `TSSatisfiesExpression` around a `TSAsExpression`
 * around the array — checked against the parser rather than assumed,
 * 2026-09-08. Both wrappers are load-bearing and so both are *required* here:
 * the `as const` is what keeps each `name` a literal type, which is what
 * `ReportedEnvName` is made of, and the `satisfies` is the shape check that the
 * old `: readonly Expected[]` annotation used to be. A bare `as const` with no
 * `satisfies`, or a `satisfies` with no `as const`, is a real loss of a
 * guarantee dressed as a formatting change, so it is refused here rather than
 * accepted by a generous unwrap.
 */
function expectedArrayLiteral(init: AstNode | undefined): AstNode {
  const refuse = (saw: string): never => {
    throw new Error(
      `${HEALTH}: EXPECTED is initialised with ${saw}. This gate reads the table syntactically ` +
        "and will not guess at a new shape. It knows exactly one: an array literal, `as const` " +
        "(so the names stay literal types for ReportedEnvName), `satisfies` (so the rows are " +
        "still shape-checked against Expected).",
    );
  };

  if (init?.type !== "TSSatisfiesExpression") return refuse(`a ${String(init?.type)}, not a satisfies expression`);
  const asExpr = init.expression as AstNode | undefined;
  if (asExpr?.type !== "TSAsExpression") {
    return refuse(`a satisfies expression around a ${String(asExpr?.type)}, not around \`as const\``);
  }
  const asType = asExpr.typeAnnotation as AstNode | undefined;
  const asTypeName = (asType?.typeName as AstNode | undefined)?.name;
  if (asType?.type !== "TSTypeReference" || asTypeName !== "const") {
    return refuse(`\`as ${String(asTypeName ?? asType?.type)}\` rather than \`as const\``);
  }
  /* **And what is being satisfied, which the first version of this never
     looked at.** GPT Sol changed the target to
     `readonly (Expected & Record<string, unknown>)[]`, misspelled a key as
     `wher`, and watched the typecheck and all eight tests pass: both wrappers
     were present, and `satisfies` was no longer refusing an excess property.
     The wrapper is not the guarantee; the type it names is. */
  const target = init.typeAnnotation as AstNode | undefined;
  const element =
    target?.type === "TSTypeOperator" && target.operator === "readonly"
      ? ((target.typeAnnotation as AstNode | undefined)?.type === "TSArrayType"
          ? ((target.typeAnnotation as AstNode).elementType as AstNode | undefined)
          : undefined)
      : undefined;
  const elementName = (element?.typeName as AstNode | undefined)?.name;
  if (element?.type !== "TSTypeReference" || elementName !== "Expected" || element.typeParameters) {
    return refuse(
      "`satisfies` naming something other than `readonly Expected[]`. The wrapper is not the " +
        "guarantee — the type it names is, and widening it (`Expected & Record<string, unknown>`, " +
        "say) stops it refusing a misspelled key while leaving every check here green",
    );
  }

  const array = asExpr.expression as AstNode | undefined;
  if (array?.type !== "ArrayExpression") {
    return refuse(`\`as const\` around a ${String(array?.type)}, not around an array literal`);
  }
  return array;
}

function readExpectedTable(): ExpectedRow[] {
  const program = parseHealth();

  let array: AstNode | null = null;
  walkAst(program, (n, _parent, _key) => {
    if (n.type !== "VariableDeclarator") return;
    const id = n.id as AstNode | undefined;
    if (id?.type !== "Identifier" || id.name !== "EXPECTED") return;
    const found = expectedArrayLiteral(n.init as AstNode | undefined);
    if (array) throw new Error(`${HEALTH}: two declarations named EXPECTED`);
    array = found;
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
   The brand on `value`, and whether it is still tied to the table

   Stage 3. `value` is the one function in src/vercel-health.ts that indexes
   `process.env` by a variable, so tests/helpers/env-reads.ts cannot read the
   names out of it and pins it by checksum instead, declaring no names at all.
   A pin covers what is inside it: the names come from the **callers**, and a
   caller writing `value("NEW_ONE")` would read a variable neither the sweep nor
   any door here has ever seen.

   What closes that is a type — `value(name: ReportedEnvName)`, the union of
   every `name` and `or` in `EXPECTED` — and `npm run typecheck` is what
   enforces it. This file cannot check assignability and does not try. What it
   checks is that the arrangement is still *there*: the parameter is annotated
   with the brand, and the brand is still derived from `typeof EXPECTED` rather
   than hand-written. Both of those are one edit away from being untrue, and
   neither edit would make any other assertion in this file go red.
   ──────────────────────────────────────────────────────────────────────────── */

const BRAND = "ReportedEnvName";
/**
 * The compile-time assertions in src/vercel-health.ts that this file cannot make.
 *
 * Both were added because a check here answered a weaker question than its
 * message claimed, and both are invisible to vitest — nothing here type-checks.
 * So what this file can do is notice they have been deleted.
 */
const SENTINELS = ["ReportedEnvNameIsExactlyTheTable", "ExpectedHasExactlyItsDeclaredKeys"];

interface BrandFacts {
  /** How many declarations of `value` were found — one, or this says nothing. */
  declarations: number;
  /** The type name `value`'s single parameter is annotated with. */
  parameterType: string | null;
  /** How many members `BRAND`'s union has. */
  members: number;
  /** How many of those reach `typeof EXPECTED`, through aliases. */
  derivedMembers: number;
  /** Whether `BRAND` is declared at all. */
  declared: boolean;
  /** Which of `SENTINELS` are missing from the source. */
  missingSentinels: string[];
}

function brandFacts(): BrandFacts {
  const program = parseHealth();

  const aliases = new Map<string, AstNode>();
  let declarations = 0;
  let parameterType: string | null = null;

  walkAst(program, (n) => {
    if (n.type === "TSTypeAliasDeclaration") {
      const id = n.id as AstNode | undefined;
      const body = n.typeAnnotation as AstNode | undefined;
      if (id?.type === "Identifier" && body) aliases.set(String(id.name), body);
      return;
    }
    if (n.type !== "FunctionDeclaration") return;
    const id = n.id as AstNode | undefined;
    if (id?.type !== "Identifier" || id.name !== "value") return;
    declarations += 1;
    const params = n.params as unknown[];
    /* One parameter, because "the first one is branded" is not the claim — a
       second, unbranded one would be a second way in. */
    if (params.length !== 1) return;
    const param = params[0] as AstNode;
    const annotation = (param.typeAnnotation as AstNode | undefined)?.typeAnnotation as
      | AstNode
      | undefined;
    if (annotation?.type !== "TSTypeReference") return;
    const named = annotation.typeName as AstNode | undefined;
    if (named?.type === "Identifier") parameterType = String(named.name);
  });

  /* **Every member of the union, not the union.** The first version of this
     asked whether the brand's declaration *reaches* `typeof EXPECTED` anywhere,
     and GPT Sol broke it in review on 2026-09-08 with one word:

       type ReportedEnvName = string | ExpectedRow["name"] | Extract<…>["or"];

     That reaches `typeof EXPECTED`, typechecks, leaves the checksum pin on
     `value` green — the function is untouched — and passes every other
     assertion here, while `value("NEW_ONE")` compiles again. "Some branch is
     derived" was never the claim; "the union is nothing but derived branches"
     is. So the body is flattened into members and each one is asked separately.
     A bare `string`, a hand-typed literal, `string & {}` — none of them reaches
     the table, and one such member is enough to fail.

     This is still a syntactic check and it cannot evaluate a type. A widening
     written *inside* an intermediate alias would satisfy it, which is why
     src/vercel-health.ts also asks the compiler the question directly, in
     `ReportedEnvNameIsNotWidened`, and why `sentinel` below asserts that line
     is still there. */
  const members = aliases.has(BRAND) ? unionMembers(aliases.get(BRAND) as AstNode) : [];
  const derived = members.filter((m) => reachesExpected(m, aliases, new Set([BRAND])));

  return {
    declarations,
    parameterType,
    members: members.length,
    derivedMembers: derived.length,
    declared: aliases.has(BRAND),
    missingSentinels: SENTINELS.filter((s) => !aliases.has(s)),
  };
}

/** A union flattened to its leaves; anything else is a one-member union. */
function unionMembers(body: AstNode): AstNode[] {
  if (body.type !== "TSUnionType") return [body];
  return (body.types as AstNode[]).flatMap(unionMembers);
}

/**
 * Whether this type expression reaches `typeof EXPECTED`, through alias hops.
 *
 * Transitive, so renaming or splitting the intermediate alias — `ExpectedRow`
 * today — is not a silent failure. `seen` bounds the walk; a self-referential
 * alias is a stack overflow otherwise, and it is per-member rather than shared,
 * so one member's dead end cannot make the next member's live path look dead.
 */
function reachesExpected(node: AstNode, aliases: Map<string, AstNode>, seen: Set<string>): boolean {
  let found = false;
  walkAst(node, (n) => {
    if (found) return;
    if (n.type === "TSTypeQuery") {
      const of = n.exprName as AstNode | undefined;
      if (of?.type === "Identifier" && of.name === "EXPECTED") found = true;
      return;
    }
    if (n.type !== "TSTypeReference") return;
    const named = n.typeName as AstNode | undefined;
    if (named?.type !== "Identifier") return;
    const name = String(named.name);
    if (seen.has(name)) return;
    seen.add(name);
    const body = aliases.get(name);
    if (body && reachesExpected(body, aliases, seen)) found = true;
  });
  return found;
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

  /* Stage 3, and the only assertion here that is not about a door. Three facts,
     each one edit away from being untrue, and not one of the tests above would
     go red: the parameter widened back to `string`, the brand rewritten as a
     hand-typed union of the same names, or a second unbranded parameter added
     beside the branded one. */
  it("keeps value()'s argument branded, and the brand derived from the table", () => {
    const facts = brandFacts();

    expect(
      facts.declarations,
      `${HEALTH} must declare exactly one function named value; this found ${facts.declarations}, ` +
        "so the facts below are about the wrong function or about none",
    ).toBe(1);

    expect(
      facts.declared,
      `${BRAND} is not declared in ${HEALTH}. It is what stops a caller handing value() a name ` +
        "EXPECTED does not carry; without it that argument is an ordinary string, and the " +
        "checksum pin on value in tests/helpers/env-reads.ts is all that is left.",
    ).toBe(true);

    expect(
      facts.parameterType,
      `value()'s argument in ${HEALTH} must be annotated ${BRAND}. value indexes process.env by a ` +
        "variable, so the Stage 1 sweep cannot read the names out of it and pins it instead, " +
        "declaring none. The names come from its callers, and this annotation is the whole of " +
        "what keeps a caller from naming a variable no door here has ever seen.",
    ).toBe(BRAND);

    expect(facts.members, `${BRAND} is a union of no members, which cannot be right`)
      .toBeGreaterThan(0);

    expect(
      facts.derivedMembers,
      `${facts.members - facts.derivedMembers} member(s) of ${BRAND} do not reach ` +
        "`typeof EXPECTED`. Every one has to: a hand-written literal drifts from the table the " +
        "first time a row is added, which is 260827b's hand-maintained list rebuilt inside the " +
        "check written to close it — and a bare `string` member is worse, because it silently " +
        "readmits every name in the world while this file's other assertions stay green.",
    ).toBe(facts.members);

    expect(
      facts.missingSentinels,
      `gone from ${HEALTH}. Everything above is syntactic and cannot evaluate a type — a widening ` +
        "written inside an intermediate alias satisfies all of it, which is how the first two " +
        "versions of this test were defeated. Those assertions ask the compiler the property " +
        "directly and fail `npm run typecheck`, which vitest never runs; this is the only thing " +
        "here that notices one has been deleted.",
    ).toEqual([]);
  });
});
