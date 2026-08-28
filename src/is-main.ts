/**
 * **Is this module the file the process was started with?**
 *
 * One spelling of the guard that ends every `tsx src/…` module, replacing the
 * nine that were in the tree on 2026-08-28 across 23 entrypoints. The reason it
 * matters is not tidiness: a module that answers this wrongly either runs its
 * CLI as a side effect of somebody importing it, or — the quieter half — runs
 * nothing at all when you start it, and prints nothing to say so.
 *
 * ## Why this is not in `cli-ledger.ts`
 *
 * That is where `stageCli` lives, and `stageCli` is the *metered* entrypoint:
 * it opens the spend ledger. Most CLIs in this repo spend nothing —
 * `src/blocks.ts`, `src/extract.ts`, `src/fetch.ts`, `src/pdf.ts`,
 * `src/toc-flatten.ts` — and importing `cli-ledger.js` to ask a question about
 * `process.argv` would drag `ai-spend.ts`, `owner.ts` and the Postgres cost
 * store into five modules that have no use for any of it. The plan says the
 * same thing in one line: *"Keep a generic `isMain` separate from the metered
 * helper. Not every importable CLI spends money."*
 * (docs/plans/simplification-wave-2.md §0.1.)
 *
 * ## The comparison, and the one that six files' comments call wrong
 *
 * `import.meta.url` is a **URL** and `process.argv[1]` is a **path**. They are
 * not comparable as text, and every way of pretending they are has a failure:
 *
 * - `import.meta.url.endsWith(path.basename(process.argv[1]))` — the spelling
 *   that was in `src/fetch.ts` and `src/toc-flatten.ts`. Wrong three ways, and
 *   `tests/is-main.test.ts` holds a failing input for each: a same-named file in
 *   another directory runs this module's CLI on import; a *different* file whose
 *   name merely ends with ours (`fetch.ts` starting while `prefetch.ts` is
 *   loaded) does the same; and a file whose name contains a space never matches
 *   at all, because the URL spells it `%20`, so the CLI starts and silently does
 *   nothing.
 * - `import.meta.url === \`file://${process.argv[1]}\`` — three `scripts/`
 *   files. Fails on a relative argument, and on any character the URL escapes.
 *
 * So: decode the URL to a path with `fileURLToPath`, resolve the argument
 * against the working directory, and compare paths. That is the spelling ten of
 * the thirteen `src/` guards already used, and it is the one kept.
 *
 * ## The `realpath` fallback, which the ten did not have
 *
 * Node resolves the entry file's real path before handing it to the ESM loader,
 * but leaves `process.argv[1]` exactly as typed. So starting a CLI through a
 * symlink — a `bin/` shim, a checkout inside a symlinked directory — gives a
 * URL for the target and an argument for the link, and a plain string compare
 * says "not the entry file" and runs nothing. That is the failure mode with no
 * error message, so it is worth two `stat` calls once per process. The direct
 * compare is tried first and answers every ordinary run without touching the
 * disk; the fallback only decides the case that would otherwise be a silent no-op.
 */

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param entry the calling module's `import.meta.url`
 */
export function isMain(entry: string): boolean {
  const started = process.argv[1];
  /* No argument at all — `node --eval`, a REPL, a worker. Nothing was started
     from a file, so no file is the entry file. */
  if (started === undefined) return false;

  const here = fileURLToPath(entry);
  const there = path.resolve(started);
  if (here === there) return true;
  return real(here) === real(there);
}

/**
 * The path with symlinks resolved, or the path unchanged if it cannot be.
 *
 * Unchanged rather than thrown, because `realpathSync` throws on a path that
 * does not exist, and "the entry file does not exist" is not this function's
 * question to answer — it just means the two are not the same file, which is
 * what returning the original produces.
 */
function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
