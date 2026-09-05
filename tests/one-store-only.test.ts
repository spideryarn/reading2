/**
 * **There is one store, and this is what stops the second one coming back.**
 *
 * The filesystem store and `SPIDERYARN_STORE` went on 2026-09-05
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § F). Three things about that are true today and would be quietly untrue again
 * the first time somebody copies a pattern out of git history, and none of them
 * is visible to the compiler:
 *
 * 1. **Nothing but the tombstone reads `SPIDERYARN_STORE`.** The variable is
 *    still set in Vercel's Preview and Production environments, so a new reader
 *    of it would find a value and act on it.
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

import { refuseTheStoreFlag } from "../src/store/live.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * **The files allowed to name `SPIDERYARN_STORE`, and why each is.**
 *
 * A list rather than a prefix rule, because "anything under `tests/`" would let
 * the next suite start reading the flag again — which is the whole thing this
 * guard is for.
 *
 * **Each entry must still match one of `READS_THE_FLAG`**, and that is a
 * correction: it used to be enough for the file to *contain the string*
 * `SPIDERYARN_STORE` anywhere. That predicate is weaker than the one that makes
 * an exemption necessary, so a file could keep its exemption while losing every
 * reason for it — and the check's **own source contains that string**, which
 * made its own entry unfalsifiable. Proved by rewriting a copy of
 * `store-selection.test.ts` to keep a plain mention and no reader shape: both
 * files stayed green. GPT Sol, 2026-09-05.
 *
 * This file is not in the list. It is skipped from the scan entirely, by `SELF`
 * below, and those are different statements: *"allowed to read the flag"* and
 * *"cannot meaningfully be scanned, because it holds the patterns"*. Conflating
 * them is what produced the hole.
 */
const MAY_NAME_THE_FLAG: Readonly<Record<string, string>> = {
  "src/store/live.ts": "the tombstone itself — the one place, and the only executable read",
  "tests/store-selection.test.ts":
    "drives the refusal, and composes `applyEnvFile` over a `SPIDERYARN_STORE=` line to make the shell/file disagreement real rather than hand-made",
  "tests/store-flag-refused-at-boot.test.ts":
    "puts `SPIDERYARN_STORE` into a child's environment and requires the child to die — the wiring half, which is what was missing on 2026-09-05",
  "src/vercel-health.ts":
    "the sensor that retires the tombstone: it reports the flag as still set on a deployment, in its own `retired` field and never in `warnings`, so that stage I of the plan is triggered by a deploy log rather than by somebody remembering to run `vercel env ls production`. It reads presence and nothing else — `postgres` and `files` are the same answer to it — and it is the one reader whose job ends the day the variable goes",
};

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

/** Every file this guard reads, repo-relative, with its comments stripped. */
async function scanned(): Promise<[string, string][]> {
  const paths: string[] = [];
  for (const dir of DIRS) paths.push(...(await sourcesUnder(path.join(ROOT, dir))));
  for (const file of FILES) paths.push(path.join(ROOT, file));
  const out: [string, string][] = [];
  for (const full of paths) {
    const rel = path.relative(ROOT, full);
    if (rel === SELF) continue;
    try {
      out.push([rel, stripComments(await readFile(full, "utf8"))]);
    } catch {
      /* A file that is not there — `vitest.witness.config.ts` goes with the
         filesystem store in stage G — is not a violation. */
    }
  }
  return out;
}

describe("the store flag is a tombstone and nothing else", () => {
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
    expect(names).toContain("src/store/live.ts");
    expect(names).toContain("vite.config.ts");
    /* **`api/index.js` by name, because it is the file this guard used to miss
       and the one that matters most**: the production shim Vercel invokes. It is
       `.js`, and the extension test was `/\.tsx?$/` until 2026-09-05. */
    expect(names).toContain(path.join("api", "index.js"));
    /* And one `.mts`, for the other half of the same hole. */
    expect(names).toContain(path.join("evals", "extraction", "probe.mts"));
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
   * A string in a message is not a read — the tombstone's own refusal is one —
   * which is why comments are stripped and why the allowlist exists.
   */
  const READS_THE_FLAG = [
    /process\.env\.SPIDERYARN_STORE/,
    /process\.env\[\s*["'`]SPIDERYARN_STORE["'`]\s*\]/,
    /\{[^}]*\bSPIDERYARN_STORE\b[^}]*\}\s*=\s*process\.env/,
    /SPIDERYARN_STORE\s*[:=]/,
  ];

  /* The name says *"and nowhere the list does not"* rather than *"and nowhere
     else"*, because the list is not empty and pretending otherwise is the trap
     this file is full of: a case whose sentence claims more than its code can
     fail on. Everything outside `MAY_NAME_THE_FLAG` is the real claim, and each
     entry in that list carries the reason it is not a violation. */
  it("is read by src/store/live.ts, and nowhere the list above does not name", async () => {
    const readers: string[] = [];
    for (const [rel, code] of await scanned()) {
      if (rel in MAY_NAME_THE_FLAG) continue;
      if (READS_THE_FLAG.some((shape) => shape.test(code))) readers.push(rel);
    }
    expect(
      readers,
      "SPIDERYARN_STORE is a tombstone (src/store/live.ts): unset and `postgres` pass, " +
        "anything else throws. Nothing else may read it, or the repo goes back to telling " +
        "people to set a variable that decides nothing.",
    ).toEqual([]);
  });

  /**
   * **The exemptions, kept honest.** An allowlist that outlives its files is how
   * a guard widens without anybody deciding to widen it — the same rule
   * `LANES_BEYOND_THE_SCAN` polices about itself
   * (tests/store-migration-registry.ts).
   */
  it("exempts only files that exist and still read the flag", async () => {
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

describe("the tombstone itself", () => {
  /* The behaviour lives in tests/store-selection.test.ts and the *wiring* in
     tests/store-flag-refused-at-boot.test.ts, which own them. These two are here
     because this file is the one somebody reads when they are asking "is the
     flag really gone", and the answer has to be "gone except for this, which
     throws". */
  it("passes the values a live deployment still carries", () => {
    expect(() => refuseTheStoreFlag({ inherited: undefined, applied: undefined })).not.toThrow();
    expect(() => refuseTheStoreFlag({ inherited: "postgres", applied: "postgres" })).not.toThrow();
  });

  it("throws on the store that was removed", () => {
    expect(() => refuseTheStoreFlag({ inherited: "files", applied: "files" })).toThrow(
      /there is one store/,
    );
  });

  /**
   * **The line that loads it**, which is the one thing neither behaviour test
   * can see: on 2026-09-05 the hinge removed the last `STORE` comparison and
   * with it the last `import` of `live.ts`, so the refusal left the program
   * while every case above stayed green. The child-process regression is the
   * real guard; this pins the import so that deleting it is a red line here too,
   * next to the sentence explaining why.
   */
  it("is imported for effect by src/db/client.ts, the boundary everything crosses", async () => {
    const source = stripComments(await readFile(path.join(ROOT, "src/db/client.ts"), "utf8"));
    expect(source).toMatch(/^import "\.\.\/store\/live\.js";$/m);
  });

  /**
   * **`db/client.ts` is the boundary for the *application*, and the name of this
   * case says `under src/` because that is all it looks at.**
   *
   * The claim the line above rests on: `getDb` is exported from exactly one
   * place and `new Pool` / `pg` / `drizzle-orm/node-postgres` appear in exactly
   * one file under `src/`, so a second connection built there would be a second
   * door and the tombstone would be back to guarding one path of several — which
   * is precisely how the first fix (in `src/store/index.ts`) looked complete.
   *
   * **Five scripts do build their own, by design**, and they are not doors:
   * `db-migrate.ts`, `db-check.ts`, `db-corpus-readiness.ts`,
   * `db-repair-migration-ledger.ts` and `deploy.ts`. Each is an operator tool
   * whose target is the database named by its own `Target:` line
   * (docs/project/database.md § *`DATABASE_URL=… npm run db:migrate` does not do
   * what it looks like*) rather than a store a reader is served through. Nothing
   * about a store is chosen on those paths, so there is nothing there for the
   * flag to have asked for.
   *
   * **The name is narrow on purpose.** An earlier version of this case was
   * called *"the only place a Postgres connection is built"* while filtering to
   * `src/` — a claim broader than the thing it scanned, which is the same shape
   * this stage has now hit five times over: a check whose sentence promises more
   * than its code can fail on. docs/reusable/silent-success.md.
   */
  it("and db/client.ts is the only place under src/ a Postgres connection is built", async () => {
    const builders: string[] = [];
    for (const [rel, code] of await scanned()) {
      if (!rel.startsWith("src/")) continue;
      if (rel === "src/db/client.ts") continue;
      if (/from "pg"|drizzle-orm\/node-postgres|new Pool\(/.test(code)) builders.push(rel);
    }
    expect(
      builders,
      "a module under src/ that opens its own Postgres connection is a door the " +
        "tombstone in src/db/client.ts does not stand in — import it there too, or " +
        "go through getDb(). (The operator scripts under scripts/ build their own " +
        "deliberately and are outside this claim; see the comment above.)",
    ).toEqual([]);
  });

  /**
   * **And it reads the shell as well as the applied value.** `.env.local` is
   * laid over the shell, so an operator who exported `files` on a machine whose
   * file says `postgres` was silently overruled — measured, 2026-09-05.
   * `inheritedEnv` is `src/env.ts`'s snapshot from before that happened.
   */
  it("checks what the shell exported, not only what won", async () => {
    const source = stripComments(await readFile(path.join(ROOT, "src/store/live.ts"), "utf8"));
    expect(source).toContain('inheritedEnv("SPIDERYARN_STORE")');
    expect(source).toContain("refuseTheStoreFlag({ inherited, applied: process.env.SPIDERYARN_STORE })");
  });
});
