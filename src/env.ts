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
 * **In production there is no `.env.local`**, so `process.env` is the only
 * source and none of this applies. See docs/project/setup-dev.md.
 */
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

  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    // Neither group is optional in the pattern, so the defaults never fire —
    // they are here because a regex match types every group as possibly absent.
    const [, name = "", raw = ""] = match;
    const value = raw.trim().replace(/^(['"])(.*)\1$/, "$2");

    const current = env[name];
    // Set by this process since startup: leave it alone. See the header.
    if (current !== undefined && current !== inherited[name]) continue;

    if (current !== undefined && current !== value) shadowed.push(name);
    env[name] = value;
  }

  return shadowed;
}
