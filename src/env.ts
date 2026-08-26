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
