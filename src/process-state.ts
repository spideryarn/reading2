/**
 * **State that has to outlive the module it is declared in.**
 *
 * A `const` at module scope usually *is* process state, and for a cache that is
 * true enough: a second copy of the module starts with an empty one and fills it
 * again. It stops being true the moment the state is a **lock**, because a
 * second copy of a lock is not a slower lock, it is no lock at all.
 *
 * ## The event this exists for
 *
 * `vite.config.ts` mounts the API with a dynamic import of `src/routes.js`,
 * written out there. Vite's config bundler externalises only non-relative
 * specifiers, so that import is bundled into the config — which makes **every
 * server module a config dependency**, 176 of them, `src/jobs.ts` and
 * `src/store/jobs-fs.ts` included. Saving any of them restarts the dev server:
 *
 * (The specifier is deliberately not spelled with its parentheses here.
 * `tests/public-imports.test.ts` walks this file's imports by pattern and would
 * read a quoted one in prose as a real edge — it did, and went red.)
 *
 *     [vite] src/hierarchy.ts changed, restarting server...
 *     [vite] server restarted.
 *
 * The restart loads the config from a **uniquely named** temp file, so the
 * module registry cannot dedupe it, and every server module is evaluated a
 * second time. It also destroys the open sockets — but it does not cancel the
 * in-flight request, so a pipeline step that is half way through an eight-minute
 * model call keeps running, keeps being billed, and keeps believing it holds a
 * claim that the new copy has never heard of.
 *
 * On 2026-08-30 that ran one article's `hierarchy` step **eleven times at once**
 * under a single job id. See
 * docs/postmortems/260902c-the-truncation-retry-cost-storm.md.
 *
 * ## Why `globalThis` rather than something tidier
 *
 * Because the thing being escaped *is* the module system, and there is nowhere
 * else in a Node process that both copies can see. A module cannot hold state
 * across its own re-evaluation by definition; a file, a database or a lock
 * directory would all work and are all a great deal more machinery for a
 * problem that is two copies of one object inside one process.
 *
 * `Symbol.for` rather than a string key: the registry is global, and a string
 * property on `globalThis` is a name anything else can collide with or
 * enumerate.
 *
 * ## What it is not for
 *
 * **Only state whose duplication is a correctness bug.** A cache, a memo, a
 * lazily-built client: leave those alone. Every entry here is a claim that two
 * copies of this value would break a rule, and the entry should say which rule.
 * The general answer to shared state is Postgres — see
 * docs/project/database.md — and this is the small local answer for the one
 * store that is still files.
 *
 * ## Changing the shape of something kept here
 *
 * The value is handed back with a cast, and across a restart the copy that made
 * it may have been built from **different source than the copy reading it** —
 * an edit to the very file being reloaded is the ordinary case. So a shape kept
 * here is changed the way a stored format is changed: additively, and never by
 * assuming a field that an older copy would not have written.
 *
 * **And never by moving to a new key**, which is what this comment used to
 * advise and is the one thing that must not happen. A second key is a second
 * lock universe with the first claimant still running inside the old one — the
 * bug this module exists to prevent, reintroduced by its own migration advice.
 * GPT Sol, reviewing the built code.
 *
 * So `version` fails **closed**: a value stored under a version this copy does
 * not recognise is an error naming the only safe move, which is stopping the
 * server. Loud and stuck beats quiet and duplicated, and stopping the server is
 * a thing anybody can do.
 */

/** What is actually kept on `globalThis`: the value, and what shape it is. */
interface Held<T> {
  version: string;
  value: T;
}

/**
 * The value stored under `name`, made once per process.
 *
 * `name` is namespaced by the caller (`"jobs-fs"`, `"jobs.aborts"`) and turned
 * into a `Symbol.for` key here so that no caller has to remember the prefix.
 * `version` is the caller's own word for the shape of what it keeps — bump it
 * when a field is added or renamed, and a dev server carrying the old shape says
 * so instead of reading `undefined` out of it.
 */
export function processSingleton<T extends object>(
  name: string,
  version: string,
  make: () => T,
): T {
  const key = Symbol.for(`spideryarn.${name}`);
  const host = globalThis as unknown as Record<symbol, unknown>;
  const held = host[key] as Held<T> | undefined;
  /* `!== undefined`, not a truthiness test. `T extends object` means the value
     itself can never be falsy — but the *envelope* is what is tested, and
     writing the test this way is what keeps that true if the constraint ever
     loosens. */
  if (held !== undefined) {
    if (held.version !== version) {
      throw new Error(
        `Process state "${name}" was made by code expecting shape ${JSON.stringify(held.version)}, ` +
          `and this copy expects ${JSON.stringify(version)}. A dev-server restart reuses the old ` +
          `object because it reuses the process. Stop the server and start it again — see ` +
          `src/process-state.ts.`,
      );
    }
    return held.value;
  }
  const made: Held<T> = { version, value: make() };
  host[key] = made;
  return made.value;
}
