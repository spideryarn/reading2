/**
 * **The environment a test hands a spawned `run-claude` / `run-codex`, with `PATH` out of
 * `.env.local`'s reach.** GPT Sol's F22, plan 260910f.
 *
 * A wrapper's first act is `loadRepoEnv()`, and `.env.local` beats an inherited value
 * (src/env.ts) — so a test that puts a stand-in CLI first on `PATH` has not decided which
 * `claude` or `codex` the wrapper runs. A `.env.local` that assigns `PATH` decides it, after every
 * check the test made, and the real CLI costs money. `tests/run-codex.test.ts` ("F22") shows it
 * happen with two stand-ins.
 *
 * `SPIDERYARN_ENV_PINNED` is the one statement about precedence that survives `spawn`, so the names
 * are pinned there — added to whatever the suite's setup already pins, never replacing it.
 * Production precedence is untouched: nothing outside a test sets the pin.
 */
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PINNED, pinnedNames } from "../../src/env.js";
import { ACCOUNT_ROUTING_VARIABLES, accountNeutralEnv } from "./account-neutral-env.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** `env` with `names` added to its pin, so the wrapper's `.env.local` load cannot write them. */
export function pinForWrapper(env: NodeJS.ProcessEnv, names: readonly string[] = ["PATH"]): NodeJS.ProcessEnv {
  const pinned = pinnedNames(env[PINNED]);
  for (const name of names) pinned.add(name);
  return { ...env, [PINNED]: [...pinned].join(",") };
}

/**
 * {@link accountNeutralEnv} for a wrapper: the account-routing variables the test removed stay
 * removed — `.env.local` cannot hand them back — and `PATH` stays the test's.
 */
export function wrapperEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return pinForWrapper(accountNeutralEnv(overrides), ["PATH", ...ACCOUNT_ROUTING_VARIABLES]);
}

/** Run the real wrapper without tsx's CLI IPC socket. File-backed capture also works in sandboxes
 * where Node's synchronous pipe capture returns EPERM after a child has already run. */
export function runWrapper(script: string, args: string[], env: NodeJS.ProcessEnv) {
  const dir = mkdtempSync(join(tmpdir(), "wrapper-console-"));
  const stdout = join(dir, "stdout.txt");
  const stderr = join(dir, "stderr.txt");
  const out = openSync(stdout, "w");
  const err = openSync(stderr, "w");
  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
      cwd: REPO, env, stdio: ["ignore", out, err],
    });
    if (result.error) throw result.error;
    return { ...result, stdout: readFileSync(stdout, "utf8"), stderr: readFileSync(stderr, "utf8") };
  } finally {
    closeSync(out);
    closeSync(err);
  }
}

/**
 * Where `cli` resolves AFTER the wrapper's own environment load, under `env` — the preflight a test
 * runs before anything can spend. Asking `command -v` under `env` directly answers for the
 * environment the test built, which is not the one the wrapper runs in unless the pin holds.
 */
export function resolveAsWrapper(cli: "claude" | "codex", env: NodeJS.ProcessEnv): string {
  const r = spawnSync(process.execPath, [join(REPO, "node_modules", "tsx", "dist", "cli.mjs"), join(REPO, "tests", "helpers", "resolve-cli-as-wrapper.ts"), cli], {
    cwd: REPO,
    encoding: "utf8",
    env,
  });
  if (r.status !== 0) throw new Error(`could not resolve ${cli} as the wrapper would (exit ${r.status}): ${r.stderr}`);
  return r.stdout.trim();
}
