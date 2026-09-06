/**
 * **There is one store, and this is what stops the second one coming back.**
 *
 * The filesystem store and `SPIDERYARN_STORE` went on 2026-09-05
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § F). Three things about that are true today and would be quietly untrue again
 * the first time somebody copies a pattern out of git history, and none of them
 * is visible to the compiler:
 *
 * 1. **Nothing reads `SPIDERYARN_STORE` at all.** That is stronger than what
 *    this said until 2026-09-06, which was *"nothing but the tombstone"*: the
 *    tombstone validated the value and threw on `files`, and it stayed while
 *    Vercel's Preview and Production environments still carried the variable.
 *    Greg removed it from both on 2026-09-06 and stage I of the plan deleted the
 *    validator, so the allowlist below is empty and the claim is now the whole
 *    tree with no exceptions. A new reader would be reading a name nothing sets
 *    and nothing means.
 * 2. **Nothing compares a store name.** `STORE === "postgres"` is gone from
 *    `src/`, `scripts/`, `evals/` and `vite.config.ts`; a new one would be a
 *    branch with a dead arm that reads as a live one.
 * 3. **No suite gates a `describe` on `reachable`.** This is
 *    the one worth the most: `const when = reachable ? describe : describe.skip`
 *    was in 103 files, and its whole effect was that `npm test` printed a green
 *    tick over a hundred suites that had not run. That is the failure this repo
 *    keeps writing postmortems about
 *    ([silent-success.md](../docs/reusable/silent-success.md)), and the reason
 *    the plan's acceptance criterion is *"no `reachable ? describe :
 *    describe.skip` left anywhere"* rather than *"one run failed"*: stopping
 *    Postgres and seeing one error is a check that passes just as happily with
 *    eighty suites still skipping.
 *
 * **A grep rather than a type**, for the reason `tests/store-guarded.test.ts`
 * gives about its own: no type distinguishes a suite that skips itself from one
 * that does not, and every shape forbidden here is well-typed code.
 *
 * **Comments are stripped first**, because several of these files quote the
 * forbidden shapes in prose — including this one, which is why the scan below
 * excludes itself by name rather than by hoping.
 *
 * Needs no database: this reads the source.
 */

import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseSource, walkAst } from "./helpers/ts-ast.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * `loadEnvLocal();` **as a statement**, wherever it sits.
 *
 * Deliberately says nothing about scope: the caller decides that by asking
 * where the node was found — `Program.body` is module scope and nothing else
 * is. Splitting the two questions is the point, because conflating them is how
 * a column-zero regex came to stand in for one of them.
 *
 * A statement rather than any call, so `const x = loadEnvLocal()` — which is
 * not a thing this returns a value for — and a call passed as an argument are
 * not counted as the side-effecting line at the top of the file.
 */
function isLoadEnvLocalCall(node: unknown): boolean {
  const statement = node as {
    type?: unknown;
    expression?: { type?: unknown; callee?: { type?: unknown; name?: unknown } };
  };
  if (statement?.type !== "ExpressionStatement") return false;
  const call = statement.expression;
  if (call?.type !== "CallExpression") return false;
  return call.callee?.type === "Identifier" && call.callee.name === "loadEnvLocal";
}

/**
 * **The files allowed to name `SPIDERYARN_STORE`, and why each is. It is empty,
 * as of 2026-09-06, and that is the whole point of stage I.**
 *
 * It carried four entries until then: the tombstone in `src/store/live.ts` that
 * validated the value, the two suites that drove it, and the sensor in
 * `src/vercel-health.ts` that watched for the variable still being set on a
 * deployment. Greg removed it from Vercel's Preview and Production environments
 * on 2026-09-06; stage I deleted all four readers, so there is nothing left to
 * exempt and the claim below is the whole tree without exceptions.
 *
 * **A list rather than a prefix rule**, still, because the next agent to need an
 * exemption should have to write one down. "Anything under `tests/`" would let
 * the next suite start reading the flag again, which is the whole thing this
 * guard is for.
 *
 * **Each entry must still match one of `READS_THE_FLAG`**, and that was a
 * correction worth keeping for whoever adds the next one: it used to be enough
 * for the file to *contain the string* `SPIDERYARN_STORE` anywhere. That
 * predicate is weaker than the one that makes an exemption necessary, so a file
 * could keep its exemption while losing every reason for it — and the check's
 * **own source contains that string**, which made its own entry unfalsifiable.
 * Proved by rewriting a copy of `store-selection.test.ts` to keep a plain
 * mention and no reader shape: both files stayed green. GPT Sol, 2026-09-05.
 *
 * This file is not in the list. It is skipped from the scan entirely, by `SELF`
 * below, and those are different statements: *"allowed to read the flag"* and
 * *"cannot meaningfully be scanned, because it holds the patterns"*. Conflating
 * them is what produced the hole.
 */
const MAY_NAME_THE_FLAG: Readonly<Record<string, string>> = {};

/**
 * **This file, skipped rather than exempted.**
 *
 * It holds every pattern it forbids, so scanning it reports itself. That is a
 * one-file blind spot and it is said out loud rather than hidden inside the
 * allowlist: a real flag read added *here* would not be caught by this guard.
 * The anti-empty control below is what stops the whole scan quietly covering
 * nothing; nothing stops this one file.
 */
const SELF = "tests/one-store-only.test.ts";

/**
 * Directories that hold source we own. `data/`, `node_modules/`, `dist/` and
 * `docs/` are deliberately out: the first three are not ours, and `docs/plans/`
 * is a dated record of how things used to be — rewriting history to satisfy a
 * grep is the opposite of what those files are for.
 */
const DIRS = ["src", "scripts", "evals", "tests", "api"];

/** Single files that carry executable code and live at the root. */
const FILES = ["vite.config.ts", "vitest.config.ts", "vitest.witness.config.ts", "package.json"];

/**
 * **Two root files that are not code, read raw, added 2026-09-06.**
 *
 * `.env.example` is the file that tells a new developer which variables to set,
 * so a `SPIDERYARN_STORE=files` line reintroduced there would put the flag back
 * into every fresh checkout while everything above stayed green: it is not under
 * `DIRS`, and `RUNNABLE` would refuse it even if it were. `AGENTS.md` — and
 * `CLAUDE.md`, which is a symlink to it — is loaded into every agent's context
 * on every turn, which is the same hazard by a shorter route.
 *
 * The plan's *"what done looks like"* has claimed since stage F that this file
 * asserts over both. It did not, and that is what GPT Sol's round-two review of
 * stage I found (F5, 2026-09-06). A criterion naming a file no check reads is a
 * sentence promising more than its code can fail on, which is the shape this
 * stage keeps hitting (docs/reusable/silent-success.md).
 *
 * **`stripComments` is deliberately not applied to these two**, which is a
 * decision rather than an omission. It strips JS and TS comments: neither a `#`
 * line nor markdown prose is a comment to it, so it would remove nothing it
 * ought to here — and could remove a great deal it ought not, since a fenced
 * code block in `AGENTS.md` holding a block comment would take every line
 * between its delimiters with it. Raw is also the stronger claim for both: a
 * **commented-out** `# SPIDERYARN_STORE=files` in `.env.example` is an
 * invitation to uncomment rather than prose about history, so it should be
 * caught. Both files name the flag today — a `#` note and one sentence — and
 * neither writes it as an assignment, which is why adding them was free. If an
 * edit ever does need to quote the assignment in one of them, that is what
 * `MAY_NAME_THE_FLAG` is for, and it costs a written reason.
 */
const NOT_CODE = [".env.example", "AGENTS.md"];

/**
 * **Every extension that runs here, not just the two this repo mostly writes.**
 *
 * It was `/\.tsx?$/` until 2026-09-05, which left out `api/index.js` — **the
 * production shim, the file Vercel actually invokes** — and every `.mts` under
 * `evals/`. A raw flag read in either was invisible to this guard, which is a
 * guard reporting clean about the one file whose misconfiguration reaches
 * readers. Found by the cross-family review of the hinge.
 */
const RUNNABLE = /\.[cm]?[jt]sx?$/;

/** Block and line comments gone, so prose about a shape is not the shape. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

async function sourcesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      /* `fixtures/` holds captured HTML and scraped pages, which are somebody
         else's text and can contain anything. */
      if (entry.name === "fixtures" || entry.name === "node_modules") continue;
      out.push(...(await sourcesUnder(full)));
    } else if (RUNNABLE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every file this guard reads, repo-relative — code with its comments stripped,
 * and the two in `NOT_CODE` exactly as they are written.
 */
async function scanned(): Promise<[string, string][]> {
  const code: string[] = [];
  for (const dir of DIRS) code.push(...(await sourcesUnder(path.join(ROOT, dir))));
  for (const file of FILES) code.push(path.join(ROOT, file));

  const out: [string, string][] = [];
  const add = async (full: string, strip: boolean): Promise<void> => {
    const rel = path.relative(ROOT, full);
    if (rel === SELF) return;
    try {
      const text = await readFile(full, "utf8");
      out.push([rel, strip ? stripComments(text) : text]);
    } catch {
      /* A file that is not there — `vitest.witness.config.ts` goes with the
         filesystem store in stage G — is not a violation. */
    }
  };

  for (const full of code) await add(full, true);
  for (const file of NOT_CODE) await add(path.join(ROOT, file), false);
  return out;
}

describe("the store flag is a dead name, and this is what stops it coming back", () => {
  /**
   * **The scan found something**, before any assertion about what it did not
   * find. A collector that matches nothing passes every "is it empty" assertion
   * for ever — the vacuous-test shape in silent-success.md — and this guard's
   * whole output is emptiness.
   */
  it("reads the source it claims to read", async () => {
    const files = await scanned();
    const names = files.map(([rel]) => rel);
    expect(files.length).toBeGreaterThan(600);
    /* This was `src/store/live.ts` until stage I deleted that file on
       2026-09-06. The anchor has to name a real path under `DIRS` that nobody
       is about to delete: `index.ts` is the wiring hub, and deleting it would
       mean there is no store at all. */
    expect(names).toContain(path.join("src", "store", "index.ts"));
    expect(names).toContain("vite.config.ts");
    /* **`api/index.js` by name, because it is the file this guard used to miss
       and the one that matters most**: the production shim Vercel invokes. It is
       `.js`, and the extension test was `/\.tsx?$/` until 2026-09-05. */
    expect(names).toContain(path.join("api", "index.js"));
    /* And one `.mts`, for the other half of the same hole. */
    expect(names).toContain(path.join("evals", "extraction", "probe.mts"));
    /* **The two that are not code**, and `.env.example` is the one that matters:
       it is what a new developer copies, and it cites this test by name as the
       thing that keeps the flag dead. Until 2026-09-06 that citation was not
       true — nothing here read the file. `NOT_CODE` says why they are raw. */
    expect(names).toContain(".env.example");
    expect(names).toContain("AGENTS.md");
  });

  /**
   * **Four spellings, because one of them is how it would come back.**
   *
   * Dot access is the ordinary one. **Bracket access** and **shorthand
   * destructuring** are the two a rewrite reaches for and the two the first
   * version of this regex missed — a `process.env["SPIDERYARN_STORE"]` in
   * `api/index.js` would have left this green. The fourth, a bare
   * `SPIDERYARN_STORE=` or `SPIDERYARN_STORE:`, catches a shell assignment in an
   * npm script and a key in an environment object.
   *
   * A string in a message is not a read — the tombstone's own refusal was one,
   * until stage I deleted it — which is why comments are stripped and why the
   * allowlist exists at all, empty though it now is.
   */
  const READS_THE_FLAG = [
    /process\.env\.SPIDERYARN_STORE/,
    /process\.env\[\s*["'`]SPIDERYARN_STORE["'`]\s*\]/,
    /\{[^}]*\bSPIDERYARN_STORE\b[^}]*\}\s*=\s*process\.env/,
    /SPIDERYARN_STORE\s*[:=]/,
  ];

  /* **The name used to hedge, and as of 2026-09-06 it does not have to.** It
     said *"and nowhere the list above does not name"* while the list held four
     entries, because a case whose sentence claims more than its code can fail
     on is the trap this file is full of. `MAY_NAME_THE_FLAG` is empty now, so
     the sentence and the code say the same thing: nowhere. The filter stays,
     because the list is the documented way back in for whoever needs one. */
  it("is read nowhere at all, and the allowlist that could permit it is empty", async () => {
    const readers: string[] = [];
    for (const [rel, code] of await scanned()) {
      if (rel in MAY_NAME_THE_FLAG) continue;
      if (READS_THE_FLAG.some((shape) => shape.test(code))) readers.push(rel);
    }
    expect(
      readers,
      "SPIDERYARN_STORE decides nothing and is set nowhere: the filesystem store went on " +
        "2026-09-05 and the tombstone that validated the value went on 2026-09-06. Nothing " +
        "may read it, or the repo goes back to telling people to set a variable that " +
        "decides nothing.",
    ).toEqual([]);
  });

  /**
   * **The exemptions, kept honest.** An allowlist that outlives its files is how
   * a guard widens without anybody deciding to widen it — the same rule
   * `LANES_BEYOND_THE_SCAN` polices about itself
   * (tests/store-migration-registry.ts).
   *
   * **This case passes vacuously while `MAY_NAME_THE_FLAG` is empty, and that is
   * said out loud rather than left to be discovered.** It is not covering the
   * claim above — that one now scans every file with no exemptions at all, which
   * is why an empty list makes it stronger rather than weaker. What this is, as
   * of 2026-09-06, is a trap set for the next entry: the moment somebody adds
   * one, it starts biting again. `it.each` over the entries was considered and
   * rejected, because vitest fails a `.each` with no cases and a green tick over
   * an empty allowlist is the correct answer here.
   */
  it("exempts only files that exist and still read the flag, and today exempts none", async () => {
    /* **The one assertion here that can fail today.** The loop below iterates an
       empty map, so without this line the case is a green tick over nothing —
       the shape this repo keeps writing postmortems about
       (docs/reusable/silent-success.md), and a poor thing to ship inside the
       commit that removes a silent-failure hazard. Stating the current state
       positively costs one line and turns the vacuum into a claim.

       **Delete this line the day an exemption is genuinely needed**, and the
       loop below takes over again. That is the point: widening the guard should
       take an edit somebody has to justify, not a quiet new key. */
    expect(
      Object.keys(MAY_NAME_THE_FLAG),
      "nothing may name SPIDERYARN_STORE as of 2026-09-06; adding the first exemption back " +
        "is a decision, so delete this assertion deliberately rather than letting the list grow",
    ).toEqual([]);

    const scannedNow = new Map(await scanned());
    const stale: string[] = [];
    for (const [rel, why] of Object.entries(MAY_NAME_THE_FLAG)) {
      const code = scannedNow.get(rel);
      if (code === undefined) {
        stale.push(`${rel} is exempt and is not scanned at all`);
      } else if (!READS_THE_FLAG.some((shape) => shape.test(code))) {
        /* **The same predicate that makes an exemption necessary**, not a
           weaker one. A `code.includes("SPIDERYARN_STORE")` here was the hole:
           it is satisfied by prose, and the guard's own source satisfies it,
           so no entry could ever be reported stale. */
        stale.push(`${rel} is exempt and no longer reads the flag — delete the exemption`);
      }
      if (why.trim().length < 20) stale.push(`${rel} has no real reason`);
    }
    expect(stale).toEqual([]);
  });

  it("is compared against a store name nowhere", async () => {
    const offenders: string[] = [];
    for (const [rel, code] of await scanned()) {
      /* Both quote styles, and both directions, because `'files'` and a `!==`
         are the same selection. */
      if (/\bSTORE\s*[=!]==\s*["'](?:files|postgres)["']/.test(code)) offenders.push(rel);
    }
    expect(
      offenders,
      "there is one store, so a comparison against its name has one answer and a dead arm",
    ).toEqual([]);
  });
});

describe("no suite gates itself on `reachable`, the alias 103 of them shared", () => {
  /**
   * The acceptance criterion, as a grep.
   *
   * Three shapes, because the family is not one line: the `describe` alias, and
   * the two `skipIf` forms that do the same thing without the ternary. All three
   * were in the tree on 2026-09-04 and none is in it now.
   *
   * ## What this does **not** claim, said here rather than left to be found
   *
   * The name used to be *"no suite decides for itself whether the database is
   * required"*, and that was wider than these three regexes, which all key on the
   * identifier `reachable`. Two files still write `x ? describe : describe.skip`
   * against something database-shaped, and both survive on purpose:
   *
   * - **`tests/db-test-create.test.ts`** gates on the opt-in
   *   `SPIDERYARN_TEST_DB_FACTORY=1`, because those cases create and drop real
   *   databases on the cluster every other agent on this box is sharing. It is
   *   loud rather than silent — it writes a line to stderr saying which of the
   *   two reasons applied — so it is not the failure this file exists about. Its
   *   `probe` does also fold in reachability, so an opted-in machine with no
   *   container skips quietly; that residual is the factory's, not the store's.
   * - **`tests/migration-reconciliations.test.ts`** gates on
   *   `isLocalDatabaseUrl`, because the block asserts things about *the schema
   *   this laptop actually has*. Pointed at production it would be asking the
   *   wrong database, and its first case asserts the connection happened, so
   *   "0 tests, all green" cannot read as "every probe verified".
   *
   * **Widening the regex to the structural form was measured and rejected**: a
   * bare `\?\s*describe\s*:\s*describe\.skip` also catches the platform gates in
   * `gjd-remote-tab-lifecycle`, `gjd-remote-prompt` and `gjd-remote-upload`
   * (`process.platform === "darwin"`, `GNU`), which are not claims about the
   * database at all. A guard whose sentence promises more than its code can fail
   * on is the shape this stage has now hit six times over
   * ([silent-success.md](../docs/reusable/silent-success.md)); the fix each time
   * is to make the sentence true, not to make the scan bigger than the claim.
   */
  const FORBIDDEN: [RegExp, string][] = [
    [
      /reachable\s*\?\s*describe\s*:\s*describe\.skip/,
      "a describe gated on whether the database answered",
    ],
    [/describe\.skipIf\(\s*!\s*reachable\s*\)/, "a describe skipped on an unreachable database"],
    [/it\.skipIf\(\s*!\s*reachable\s*\)/, "a test skipped on an unreachable database"],
  ];

  it.each(FORBIDDEN)("has no %s", async (pattern) => {
    const offenders: string[] = [];
    for (const [rel, code] of await scanned()) {
      if (pattern.test(code)) offenders.push(rel);
    }
    expect(
      offenders,
      "`pgReady` throws now and the private lane's globalSetup fails the whole command " +
        "once, so a suite that skipped itself here would be printing a green tick over " +
        "tests that did not run. docs/reusable/silent-success.md.",
    ).toEqual([]);
  });

  /**
   * **The other half, and it is the one a syntactic guard cannot see.** The
   * shapes above are what the pattern looked like on 2026-09-04; what actually
   * matters is that `pgReady` cannot hand anybody a boolean to gate on. So this
   * asks the helper's own surface rather than the files that call it.
   */
  it("cannot be given a boolean to gate on, because pgReady no longer returns one", async () => {
    const source = await readFile(path.join(ROOT, "tests/helpers/pg-ready.ts"), "utf8");
    const shape = /export interface PgReady \{[\s\S]*?\n\}/.exec(stripComments(source))?.[0] ?? "";
    expect(shape, "the PgReady interface was not found — this check reads nothing").toContain(
      "pool",
    );
    expect(shape).not.toContain("reachable");
    expect(shape).not.toContain("why");
  });
});

describe("the boot check that no test can run", () => {
  /**
   * **`.env.local` has to be read before the boot check above reads the
   * variables, and on 2026-09-06 for one afternoon it was not.**
   *
   * `src/store/index.ts` checks Supabase credentials in its *module body*, so
   * ESM evaluates it before any entry point's own `loadEnvLocal()` statement
   * can run. Until stage I that was covered by accident: `src/db/client.ts`
   * opened with `import "../store/live.js"`, the `SPIDERYARN_STORE` tombstone,
   * and that module called `loadEnvLocal()` as it loaded. Deleting the
   * tombstone took the load with it and broke every command that imports the
   * store statically — `scripts/live-spike.ts`, `evals/deepen/run.ts` and
   * `evals/cost/interactions.ts` — with *"there is no Supabase Storage
   * configured"* at boot. Found by GPT Sol's review of stage I, reproduced
   * before the fix, and green after it.
   *
   * **A source guard for the same reason as its neighbour below**: the unit
   * lane sets `VITEST`, which is exactly what makes `src/store/index.ts` skip
   * the check, so no suite here can execute the failure. What a test *can* do
   * is insist the line is still there, at module scope, in the file every path
   * to Postgres crosses.
   *
   * **Module scope specifically, and asked of the AST rather than of column
   * zero.** `databaseUrl()` also calls `loadEnvLocal()` lazily, and that call is
   * no use here — it runs long after the boot check has thrown. This case
   * anchored to column zero until 2026-09-06 to tell the two apart, and GPT Sol
   * was right that it does not: `if (x) {\nloadEnvLocal();\n}` sits at column
   * zero and is not module scope, a minifier or a reformat moves the real one
   * off column zero without changing what it does, and a call inside a function
   * a formatter had unindented would satisfy it. Layout is not scope. So the
   * question is put to the parser this repo already uses for source rules
   * (helpers/ts-ast.ts): **is there an `ExpressionStatement` calling
   * `loadEnvLocal` directly in `Program.body`?** Nothing but module scope can
   * answer yes.
   *
   * **The second assertion is the control**, and it is what makes the first one
   * mean anything: `src/db/client.ts` also calls `loadEnvLocal()` from inside
   * `databaseUrl()`, so a predicate that cannot tell scope apart would count two
   * and pass here with the module-scope line deleted. Requiring a call this
   * check *refuses* proves it can say no.
   */
  it("calls loadEnvLocal() as a statement of Program.body in src/db/client.ts, before anything checks a variable", async () => {
    const ast = parseSource(await readFile(path.join(ROOT, "src/db/client.ts"), "utf8"));
    const atModuleScope = ast.program.body.filter(isLoadEnvLocalCall).length;
    let everywhere = 0;
    walkAst(ast, (node) => {
      if (isLoadEnvLocalCall(node)) everywhere += 1;
    });

    expect(
      atModuleScope,
      "src/db/client.ts must call loadEnvLocal() at module scope — a statement of Program.body, " +
        "not merely a line at column zero. It is the narrowest boundary every path to Postgres " +
        "crosses, and src/store/index.ts checks Supabase credentials while its own module body " +
        "evaluates, which ESM runs before the importing module's first statement — so a lazy " +
        "call inside getDb() is too late and every statically-importing command dies at boot. " +
        "tests/store-boots-without-inherited-credentials.test.ts executes that failure.",
    ).toBe(1);

    expect(
      everywhere - atModuleScope,
      "this file also calls loadEnvLocal() from inside databaseUrl(), and this check must not " +
        "count that one. If the difference is zero the predicate has stopped distinguishing " +
        "scope, and it would pass with the module-scope call deleted — which is exactly what " +
        "the column-zero regex it replaced could not rule out.",
    ).toBeGreaterThan(0);
  });

  /**
   * **A source guard, and it says so.** `src/store/index.ts` refuses at import
   * when `DATABASE_URL` and `SUPABASE_URL` name different Supabase projects —
   * a split brain, where a revision row holds an object key pointing at
   * nothing. It is skipped under the test runner, because the unit lane
   * deliberately poisons those two variables to two different loopback ports,
   * and that is precisely the shape it refuses.
   *
   * So nothing under the runner executes it, which makes it the kind of check
   * somebody deletes while tidying and nothing goes red. This is what goes red.
   *
   * **Both halves of the condition are pinned**, because dropping `VITEST` is
   * the plausible tidy: it looks redundant beside `NODE_ENV`, and it is not —
   * four suites spawn children with `NODE_ENV=development` on purpose, and those
   * children inherit the poison.
   */
  it("is still called at module scope in src/store/index.ts, and still guarded", async () => {
    const source = stripComments(await readFile(path.join(ROOT, "src/store/index.ts"), "utf8"));
    expect(source).toMatch(/^if \(!process\.env\.VITEST && process\.env\.NODE_ENV !== "test"\) \{$/m);
    expect(source).toMatch(/^ {2}postgresBlobStore\(/m);
  });
});

describe("one door to Postgres under src/, so a second store cannot arrive through another", () => {
  /**
   * **`db/client.ts` is the boundary for the *application*, and the name of this
   * case says `under src/` because that is all it looks at.**
   *
   * `getDb` is exported from exactly one place and `new Pool` / `pg` /
   * `drizzle-orm/node-postgres` appear in exactly one file under `src/`, so a
   * second connection built there would be a second door — and a second door is
   * how the first fix for the store flag (in `src/store/index.ts`) looked
   * complete while five roots reached Postgres around it, measured 2026-09-05.
   *
   * **This outlived the flag it was written for.** It sat under a
   * `"the tombstone itself"` block until 2026-09-06, next to the case pinning
   * `import "../store/live.js"` in `src/db/client.ts`; stage I deleted the
   * tombstone and that import with it. The claim here was never about the flag,
   * though — it is about how many places in the application open a connection —
   * so it kept its own block rather than going along.
   *
   * **Five scripts do build their own, by design**, and they are not doors:
   * `db-migrate.ts`, `db-check.ts`, `db-corpus-readiness.ts`,
   * `db-repair-migration-ledger.ts` and `deploy.ts`. Each is an operator tool
   * whose target is the database named by its own `Target:` line
   * (docs/project/database.md § *`DATABASE_URL=… npm run db:migrate` does not do
   * what it looks like*) rather than a store a reader is served through.
   *
   * **The name is narrow on purpose.** An earlier version of this case was
   * called *"the only place a Postgres connection is built"* while filtering to
   * `src/` — a claim broader than the thing it scanned, which is the same shape
   * this stage has now hit five times over: a check whose sentence promises more
   * than its code can fail on. docs/reusable/silent-success.md.
   */
  it("builds a Postgres connection in src/db/client.ts and nowhere else under src/", async () => {
    const builders: string[] = [];
    for (const [rel, code] of await scanned()) {
      if (!rel.startsWith("src/")) continue;
      if (rel === "src/db/client.ts") continue;
      if (/from "pg"|drizzle-orm\/node-postgres|new Pool\(/.test(code)) builders.push(rel);
    }
    /* Non-empty scan, or this passes over a collector that stopped collecting —
       `scanned()` has its own control above, and this reads the same list. */
    expect(
      builders,
      "a module under src/ that opens its own Postgres connection is a second door to the " +
        "store — go through getDb(). (The operator scripts under scripts/ build their own " +
        "deliberately and are outside this claim; see the comment above.)",
    ).toEqual([]);
  });
});
