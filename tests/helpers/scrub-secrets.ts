/**
 * **A test worker holds no secret it does not need.** Each lane's setup file calls
 * `scrubSecrets` after `loadEnvLocal()`.
 *
 * A failing matcher prints its subject. When the subject is an environment, whether that is
 * `process.env`, a spawn's `env`, or a child's `env` dump, the failure message is every value in
 * it. On 2026-09-10 a red-first run printed four real keys into a subagent's context that way —
 * docs/postmortems/260910d-an-assertion-over-a-whole-environment-prints-every-secret-when-it-fails.md.
 * Deciding which assertions are safe does not scale: there are dozens of `...process.env` spreads
 * in `tests/`, and grep cannot tell which child prints what it inherited. So the values are taken
 * away instead. A failure message cannot contain a value the worker does not have.
 *
 * **What a secret is, is `isSecretName`'s call** (scripts/subagent-cli.ts), the same rule that
 * decides what a `run-codex`/`run-claude` child may see. One list, not two.
 *
 * **Replaced, not deleted.** A *missing* credential can pick a working fallback, `blobStore()`
 * choosing the filesystem being the one this repo has already been bitten by
 * (tests/setup/unit-no-database.ts § *Why a syntactically valid URL*). A present, useless value
 * fails where it is used. See `scrubbedValue` for what it is replaced with.
 *
 * **Pinned, so it stays scrubbed.** `loadEnvLocal()` runs once per module instance. A
 * `vi.resetModules()` reloads `src/env.ts` with a fresh snapshot that already holds the sentinel,
 * which makes `.env.local`'s value win again. A child process that spreads `process.env` does the
 * same in its own `loadEnvLocal()`. `SPIDERYARN_ENV_PINNED` is a string in the environment, so it
 * survives both (src/env.ts § `PINNED`). Every scrubbed name goes onto it.
 *
 * **Only names already present are touched.** The account-routing names `vitest.config.ts`
 * deletes stay absent, and a name nothing set is not invented.
 *
 * What it cannot cover:
 *  - a child whose environment is built without the pin (from scratch, or with the pin deleted
 *    or replaced) and which then loads `.env.local` itself. That child holds the real values
 *    again. A test that needs such a child takes only its own names off the pin — see
 *    tests/store-boots-without-inherited-credentials.test.ts;
 *  - code that reads `.env.local` with its own `readFileSync` rather than through the
 *    environment — `tools/fleet/transcribe.ts` reads `OPENROUTER_API_KEY` that way.
 */
import { isSecretName } from "../../scripts/subagent-cli.js";
import { isLocalDatabaseUrl } from "../../src/db/ssl.js";
import { PINNED, pinnedNames } from "../../src/env.js";

/**
 * **What each database lane keeps real**, named here once so the lane's setup and the probe that
 * checks it read the same list. The unit lane keeps nothing. Why each name is kept is in the setup
 * file that passes it: tests/setup/private-db.ts and tests/setup/shared-db.ts.
 */
export const PRIVATE_LANE_KEEPS = ["DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
export const SHARED_LANE_KEEPS = [
  "DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
] as const;

/** What a scrubbed variable holds, unless it is a URL. */
export const SCRUBBED_SECRET = "test-lane-scrubbed-secret";

/** The user a scrubbed URL carries in place of its own. */
const SCRUBBED_USER = "scrubbed";

/**
 * **A value that looks like what it replaces, with nothing secret left in it.**
 *
 * `isSecretName` catches some names for the credential that can sit *inside* an ordinary value:
 * `DATABASE_URL`, any `_URI`, any `_PROXY`. A bare sentinel there is a non-URL where a library
 * expects to parse one, which is a failure about the wrong thing. GPT Sol, 2026-09-11. So a value
 * that parses as a URL keeps its scheme, host, port and path, and loses its user, password, query
 * and fragment, which are where a credential in a URL lives.
 *
 * **`NO_PROXY` is left alone.** It is a list of hosts that must bypass a proxy, never a
 * credential, and it matches `_PROXY` only by its spelling. Turning it into a sentinel would send
 * local traffic through whatever proxy is set.
 *
 * Even a URL with no credentials gets the scrubbed username. Besides making the replacement
 * visible, that puts its name on the pin so a later `loadEnvLocal()` cannot restore a credential.
 *
 * @returns the replacement, or `undefined` for the deliberate `NO_PROXY` exception
 */
export function scrubbedValue(name: string, value: string): string | undefined {
  if (/^no_proxy$/i.test(name)) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return SCRUBBED_SECRET;
  }
  /* Only a URL with an authority: `new URL("a:b")` parses too, and that is not a URL anybody
     meant. */
  if (!url.host) return SCRUBBED_SECRET;
  url.username = SCRUBBED_USER;
  url.password = "";
  url.search = "";
  url.hash = "";
  /* Some schemes parse with an authority but do not accept userinfo. A scalar sentinel is safer
     than returning a URL whose value this function did not actually change. */
  if (url.username !== SCRUBBED_USER) return SCRUBBED_SECRET;
  return url.toString();
}

/**
 * The names this lane may keep real — `names` when both of the local stack's URLs point at this
 * machine, and nothing otherwise.
 *
 * A `.env.local` pointed at a hosted project would otherwise hand a hosted service key to a test,
 * and the database lanes write. Scrubbed, the key fails where it is used instead.
 */
export function keptOnlyIfLocal(env: NodeJS.ProcessEnv, names: readonly string[]): readonly string[] {
  const local = [env.DATABASE_URL, env.SUPABASE_URL].every(
    (url) => url !== undefined && isLocalDatabaseUrl(url),
  );
  return local ? names : [];
}

/**
 * Replace every present secret-named value, and pin its name.
 *
 * @param keep  the secret-named variables this lane really uses, which stay real and unpinned
 * @returns the names it replaced
 */
export function scrubSecrets(env: NodeJS.ProcessEnv, keep: readonly string[] = []): string[] {
  const scrubbed: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !isSecretName(name) || keep.includes(name)) continue;
    const replacement = scrubbedValue(name, value);
    if (replacement === undefined) continue;
    env[name] = replacement;
    scrubbed.push(name);
  }
  env[PINNED] = [...new Set([...pinnedNames(env[PINNED]), ...scrubbed])].join(",");
  return scrubbed;
}

/**
 * **The secret-named variables in `env` that still hold something real** — names only, for an
 * assertion to compare against a lane's keep-list.
 *
 * A value counts as scrubbed if it has a safe replacement shape **and the name is pinned**. The
 * pin is provenance: without it, a real scalar equal to the sentinel or a URL whose real username
 * happens to be `scrubbed` is indistinguishable from output this helper wrote, and a later
 * `loadEnvLocal()` can replace it. `NO_PROXY` needs no replacement; `allowed` is the unit lane's
 * two pinned poison URLs.
 */
export function unscrubbedNames(env: NodeJS.ProcessEnv, allowed: readonly string[] = []): string[] {
  const pinned = pinnedNames(env[PINNED]);
  return Object.entries(env)
    .filter(([name, value]) => value !== undefined && isSecretName(name))
    .filter(([name, value]) => {
      const v = value as string;
      if (allowed.includes(v)) return !pinned.has(name);
      const replacement = scrubbedValue(name, v);
      if (replacement === undefined) return false; // NO_PROXY
      return replacement !== v || !pinned.has(name);
    })
    .map(([name]) => name);
}
