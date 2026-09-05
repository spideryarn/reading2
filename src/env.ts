/**
 * `.env.local` → `process.env`.
 *
 * Twenty lines rather than a dependency, because the things that need a secret —
 * the Vite dev middleware, any `tsx src/…` script, the eval harnesses — all run
 * in a plain Node process.
 *
 * ## `.env.local` beats what the shell inherited. This is the whole point.
 *
 * > Where are we getting OPENROUTER_API_KEY from? Use the one in .env.local for
 * > local stuff.
 * >
 * > — Greg, 2026-08-26
 *
 * It used to be the other way round: *"a variable already in the environment
 * wins … `.env.local` is the convenience, not the authority"*. That reads
 * sensibly and it cost an afternoon.
 *
 * `~/.zshrc` and `~/.zprofile` both `export OPENROUTER_API_KEY`, and it is a
 * **different key on a different OpenRouter account** from the one in
 * `.env.local`. So every command in every shell silently used the wrong account.
 * The way it surfaced: an eval could not reach Voyage at all and got back
 * `404 No endpoints available matching your guardrail restrictions` — which
 * reads exactly like a mistyped model id, and is actually one account's privacy
 * settings refusing a provider the other account allows. Nothing was broken,
 * nothing errored, and the file that names the key was being ignored.
 *
 * A profile export and a deliberate `FOO=x npm run dev` are the same thing to a
 * child process, so "the environment wins" cannot mean "the person meant it".
 *
 * ## What still wins, and how that is possible
 *
 * A variable **this process set for itself** after startup still wins — that is
 * what `INHERITED` is for. It snapshots the environment at module load, before
 * any of our code has run, so later we can tell the two cases apart:
 *
 * - value is unchanged since startup → it came from the shell → `.env.local` wins
 * - value differs from the snapshot → this process set it on purpose → it wins
 *
 * Without that distinction, `tests/explain.test.ts` and
 * `tests/converse-stop.test.ts` — which set `OPENROUTER_API_KEY = "test-key"`
 * and then call code that loads this file — would have had the real key put back
 * underneath them, and a test that is supposed to make no model call could make
 * a real one. That is a bad way to find out about a precedence change.
 *
 * ## The one thing `INHERITED` cannot do: survive a process boundary
 *
 * The rule above is *"a value this process set for itself wins"*, and it is
 * decided by comparing against a snapshot taken at **this** process's module
 * load. A child process takes its own snapshot, and by then the parent's
 * deliberate assignment is already in the environment it inherited — so the
 * child reads it as *"the shell said so"* and `.env.local` beats it. The
 * intent is real and the evidence for it does not cross `spawn`.
 *
 * That is fine for a key and fatal for a database. The unit test lane poisons
 * `DATABASE_URL` and `SUPABASE_URL` on purpose, so that a suite which was never
 * meant to have a database or a bucket cannot quietly borrow the shared ones;
 * a `tsx` child spawned from such a test had `.env.local` hand both of them
 * straight back, silently — `NODE_ENV=test` suppresses even the warning below.
 * Reproduced by GPT Sol reviewing stage T-D, 2026-09-04.
 *
 * `PINNED` is the fix, and it is deliberately the smallest one: an environment
 * variable naming the variables `.env.local` may not touch, which **is**
 * inherited, because it is a string in the environment rather than a comparison
 * against a snapshot. See `pinnedNames` below.
 *
 * **In production there is no `.env.local`**, so `process.env` is the only
 * source, `loadEnvLocal` returns at its `readFileSync` and none of this — the
 * precedence rule or the pin — has any effect at all. Nothing outside the test
 * lanes sets `PINNED`, and setting it would only ever *narrow* what a file that
 * is not there could do. See docs/project/setup-dev.md.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The environment as it was before any of our code ran.
 *
 * Captured at module load on purpose: every deliberate in-process assignment
 * happens after this, so anything still matching this snapshot was inherited.
 */
const INHERITED: Readonly<Record<string, string | undefined>> = { ...process.env };

/**
 * **What the shell exported, before `.env.local` had a chance to replace it.**
 *
 * The precedence rule above is right and it has one consequence worth being able
 * to see from outside: a value a person deliberately exported can be silently
 * overruled by a file, and the warning that says so is suppressed under
 * `NODE_ENV=test`. Most callers should not care — the applied value is the one
 * that decides. **A refusal is the exception**: `src/store/live.ts` throws on
 * `SPIDERYARN_STORE=files`, and a file quietly rewriting that to `postgres`
 * would mean an operator who asked for the store that is gone was served the
 * other one without a word. That is the whole failure the tombstone exists to
 * prevent, arriving by a different door.
 *
 * So the snapshot is readable, one name at a time. Not the whole object: this is
 * for asking "did the shell say something different", not for a second source of
 * configuration.
 */
export function inheritedEnv(name: string): string | undefined {
  return INHERITED[name];
}

let done = false;

export function loadEnvLocal(): void {
  if (done) return;
  done = true;
  let text: string;
  try {
    text = readFileSync(path.join(ROOT, ".env.local"), "utf8");
  } catch {
    return; // no file is fine — the variable may be set some other way
  }

  const shadowed = applyEnvFile(text, process.env, INHERITED);

  /* **`console.warn`, and deliberately not src/log.ts.** This runs while the
     environment the logger configures itself from is still being assembled —
     `log.ts` reads `LOG_LEVEL` and `NODE_ENV` at logger creation — so building a
     logger here would freeze a configuration this function is in the middle of
     changing. It is one line per process, on stderr, and it is a fact about the
     machine rather than about a request.

     **Names only, never values.** These are secrets; the whole point of the line
     is that two of them differ, which needs no value to say. */
  if (shadowed.length > 0 && process.env.NODE_ENV !== "test") {
    console.warn(
      `[env] .env.local overrode ${shadowed.join(", ")} from the shell environment. ` +
        `Your shell exports a different value — see docs/project/setup-dev.md.`,
    );
  }
}

/**
 * **Which database a command is about to touch** — the one exception to the
 * rule above, made once and in the open.
 *
 * ## The two conventions this replaces
 *
 * Six scripts read `DATABASE_URL`, and until 2026-09-03 they split into two
 * camps that had never been written down as a choice:
 *
 * - `db-migrate`, `db-check`, `db-corpus-readiness`,
 *   `db-repair-migration-ledger` captured `process.env.DATABASE_URL` into a
 *   local `fromShell` **before** calling `loadEnvLocal()`, then took
 *   `fromShell ?? process.env.DATABASE_URL`. The shell wins.
 * - `db-seed-dev` and `db-reown` called `loadEnvLocal()` first and read
 *   `process.env.DATABASE_URL` after it. The file wins.
 *
 * Four copies of one rule and two of the other, none of them naming the other
 * camp. The risk is not the six; it is the seventh, which copies whichever
 * sibling it happens to open — so this makes the choice a **required argument**
 * that a new caller cannot inherit by accident.
 *
 * ## Why either answer can be right
 *
 * The rule at the top of this file — the file beats the shell — exists because
 * a `~/.zshrc` export and a deliberate `FOO=x npm run …` look identical to a
 * child process. That is still true. What changes it for some of these commands
 * is that **their target is an argument rather than configuration**:
 * `DATABASE_URL=… npm run db:migrate` is somebody naming a database, and on
 * 2026-08-27 `.env.local` buried it, the remote check saw `127.0.0.1`, and the
 * migrator applied migrations to the laptop while printing `✓ migrations
 * applied`. docs/project/database.md, docs/reusable/silent-success.md.
 *
 * `db-seed-dev` and `db-reown` keep `shellWins: false`, and the reason is
 * **not** the one their headers gave — those only described the trap. It is
 * that neither has a remote mode at all: there is no `--allow-remote`, the only
 * valid target is this repo's own local Docker stack, and both settle that
 * against `supabase status` rather than against the connection string
 * (scripts/db-reown-rules.ts). So letting the shell win would buy nothing —
 * any value that disagreed with the stack is refused either way — while
 * reopening the `~/.zshrc` case that this file's whole precedence rule exists
 * to close, and the old app's stack really is running next door on port 54342.
 *
 * ## Why here, and not in a script
 *
 * Because `INHERITED` is here. The four shell-wins copies each depend on
 * running their capture *before* `loadEnvLocal()`, and an import reordered or a
 * helper introduced above them silently turns shell-wins into file-wins with
 * nothing to show for it. `INHERITED` was snapshotted before any of our code
 * ran, so this answers the same whenever it is called — the ordering trap stops
 * existing rather than being documented. It also puts the exception beside the
 * rule it excepts, which is the one place a reader of either will find both.
 *
 * **Out of scope, deliberately**: a process that assigns `DATABASE_URL` to
 * itself at run time. `applyEnvFile` has a rule for that case and none of these
 * six scripts is it; adding a third branch here would be a case nobody can
 * exercise.
 */
export function resolveTargetUrl(choice: { shellWins: boolean }): string | undefined {
  /* Called here rather than required of the caller. It memoises, so a script
     that also calls it pays nothing, and one that forgot cannot get a different
     answer from this function than its neighbour did. */
  loadEnvLocal();
  return chooseTargetUrl(choice.shellWins, INHERITED, process.env);
}

/**
 * **`.env.prod` — for the few commands whose target is production on purpose.**
 *
 * The rule at the top of this file says `.env.local` beats the shell, and it is
 * right. The consequence is that "export the production values and run it"
 * is quietly wrong for every script that calls `loadEnvLocal()`: the file wins,
 * and the command reports on the Docker container while looking like it
 * reported on production. `scripts/check-owner-identity.ts` hit that first and
 * solved it by reading `.env.prod` directly; on 2026-09-03 `stripe-setup` and
 * `stripe-check` needed the same thing to go live, so the solution moved here
 * rather than being copied.
 *
 * It is the same argument that put `resolveTargetUrl` in this file: the
 * exception belongs beside the rule it excepts, where a reader of either finds
 * both.
 *
 * ## Two secrets that have to agree with each other
 *
 * This is why it is a file and not two command-line variables. Pointing
 * `stripe-setup` at live Stripe and the laptop's Postgres is a coherent-looking
 * command that creates live prices and writes their ids somewhere no deployment
 * reads. Taking both from one file that already holds a matched set means a
 * mismatched pair has to be *written into that file* rather than assembled by
 * accident on a command line — the combination is still possible, and
 * `scripts/stripe-target.ts` checks for it. It also keeps a live secret key out
 * of shell history, which typing it would not.
 *
 * ## Where it looks, and why that is two places
 *
 * CLAUDE.md says to work in a git worktree, and `npm run worktree:setup` copies
 * `.env.local` but not `.env.prod`. A production-targeting script that works
 * only in the primary checkout is a trap of the kind this function exists to
 * remove, so it falls back to the primary — `git rev-parse --git-common-dir`,
 * which in a linked worktree points into the primary's `.git`.
 *
 * @returns the file actually read and everything in it, or `null` if there is
 *   no `.env.prod` anywhere. **Callers must print `file`**: which of the two it
 *   found is the difference between reading this tree's production values and
 *   another tree's, and it is not guessable from the output otherwise.
 */
export function readEnvProd(): { file: string; values: Record<string, string> } | null {
  for (const file of envProdCandidates()) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    return { file, values: parseEnvFile(text) };
  }
  return null;
}

/**
 * This checkout's `.env.prod`, then the primary checkout's.
 *
 * `execFileSync` rather than reading `.git` by hand: in a linked worktree
 * `.git` is a *file* holding `gitdir: …/.git/worktrees/<name>`, and parsing
 * that is re-implementing git's own answer. Failure is not an error — running
 * outside a repository at all is legitimate — so it yields nothing extra.
 */
/**
 * The environment minus every `GIT_*` that could redirect `git rev-parse`.
 *
 * `GIT_DIR` and `GIT_COMMON_DIR` are the two that move the answer outright;
 * `GIT_WORK_TREE` and `GIT_OBJECT_DIRECTORY` are dropped with them because a
 * half-overridden git environment is not a state worth reasoning about.
 */
function withoutGitVars(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env };
  for (const name of ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY"]) {
    delete copy[name];
  }
  return copy;
}

function envProdCandidates(): string[] {
  const here = path.join(ROOT, ".env.prod");
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      /* **`GIT_DIR` is inherited, and it overrides `cwd`.** A shell that
         exported one — or a hook, or a parent `git` invocation — makes this
         answer about *that* repository, and the fallback would then read a
         different project's `.env.prod` and hand its production credentials to
         `--apply`. Reproduced by GPT Sol, 2026-09-03. Dropped rather than
         honoured: the question is "where is this checkout's primary", and only
         `cwd` can answer it. */
      env: withoutGitVars(process.env),
    }).trim();
    const primary = path.join(path.dirname(common), ".env.prod");
    return primary === here ? [here] : [here, primary];
  } catch {
    return [here];
  }
}

/**
 * The choice itself, over injected environments — split out for the same reason
 * `applyEnvFile` is, and it is the same reason: `resolveTargetUrl` reads the
 * real snapshot and the real `process.env`, so a test that went through it
 * would be testing the machine. `tests/env.test.ts` drives this.
 */
export function chooseTargetUrl(
  shellWins: boolean,
  inherited: Readonly<Record<string, string | undefined>>,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  /* `??`, so a shell that exported nothing falls through to whatever
     `.env.local` provided rather than resolving to `undefined` and making the
     caller print "DATABASE_URL is not set" beside a perfectly good one. */
  if (shellWins) return inherited.DATABASE_URL ?? env.DATABASE_URL;
  return env.DATABASE_URL;
}

/**
 * The precedence rule itself, over an injected environment.
 *
 * Separated from `loadEnvLocal` so it can be tested. The rule is the part that
 * was wrong, and it cannot be exercised through `loadEnvLocal`, which memoises
 * and reads the real `.env.local` and the real environment — a test that
 * re-implemented the rule beside it would pass while the rule was broken.
 *
 * @param text     the contents of a `.env.local`
 * @param env      the environment to write into (`process.env` in real use)
 * @param inherited that environment as it was before this process ran
 * @returns the names — never the values — where the file disagreed with an
 *          inherited value and won, for the caller to report
 */
export function applyEnvFile(
  text: string,
  env: Record<string, string | undefined>,
  inherited: Readonly<Record<string, string | undefined>>,
): string[] {
  const shadowed: string[] = [];
  const pinned = pinnedNames(env);

  for (const [name, value] of Object.entries(parseEnvFile(text))) {
    /* Pinned by the process that started this one — and unlike the snapshot
       comparison below, that statement survives `spawn`. See the header. */
    if (pinned.has(name)) continue;

    const current = env[name];
    // Set by this process since startup: leave it alone. See the header.
    if (current !== undefined && current !== inherited[name]) continue;

    if (current !== undefined && current !== value) shadowed.push(name);
    env[name] = value;
  }

  return shadowed;
}

/**
 * The variable that makes a deliberate assignment survive `spawn`, and the
 * names it is currently protecting.
 *
 * Set it to a comma-separated list of variable names — `tests/setup/*` is the
 * only thing that does — and `.env.local` will not write any of them, in this
 * process or in any child that inherits it. Nothing else about `loadEnvLocal`
 * changes: an unpinned name follows the ordinary rule, and with no `.env.local`
 * (which is every deployment) there is nothing for the pin to stop.
 *
 * A **list of names rather than a boolean**, because the two lanes pin
 * different things and a child that legitimately tests the override — see
 * `tests/stage2c-raw-bytes.test.ts`, which manufactures a disagreement on
 * `SUPABASE_URL` — can narrow the list rather than having to delete it.
 *
 * Read from the passed environment, not `process.env`, so `applyEnvFile` stays
 * the pure seam `tests/env.test.ts` drives.
 */
export const PINNED = "SPIDERYARN_ENV_PINNED";

export function pinnedNames(env: Readonly<Record<string, string | undefined>>): Set<string> {
  const raw = env[PINNED];
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean),
  );
}

/**
 * An env file's text as names and values. No precedence, no `process.env`.
 *
 * Split out of `applyEnvFile` when `.env.prod` acquired a second reader
 * (`readEnvProd`). Before that, `scripts/check-owner-identity.ts` matched
 * `^NAME=(.*)$` per name against the same file, which is a second parser and a
 * weaker one: it misses an `export ` prefix and leaves single quotes on the
 * value. Both files are written by hand, so either spelling can appear in one
 * tomorrow, and the two readers would then disagree about what production is.
 *
 * ## A later line wins, and that is a **change**, made on purpose
 *
 * The old loop made the *first* of two lines win, and not by decision: having
 * assigned the first, the second iteration saw `current !== inherited[name]`,
 * read that as "this process set it itself", and skipped. The precedence rule
 * for the *shell* was silently deciding precedence *within the file*. Measured
 * both ways before changing it — GPT Sol, 2026-09-03, reviewing the extraction
 * this comment is part of and catching that it was not the pure refactor it was
 * described as.
 *
 * Last-wins is kept, because it is what shell `source` does, and what somebody
 * appending a line to override an earlier one expects. `tests/env.test.ts` pins it through `applyEnvFile` as well as here,
 * since that is the seam where the old behaviour actually lived.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    // Neither group is optional in the pattern, so the defaults never fire —
    // they are here because a regex match types every group as possibly absent.
    const [, name = "", raw = ""] = match;
    values[name] = raw.trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}
