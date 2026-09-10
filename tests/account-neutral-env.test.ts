/**
 * The runner's account does not reach the tests — checked from inside a worker.
 *
 * vitest.config.ts deletes ACCOUNT_ROUTING_VARIABLES before any worker exists. This file is what
 * notices if that line goes: on a runner that carries one of them (every Overseer-dispatched
 * session since plan 260909g), it goes red. On a runner that carries none it cannot fail, and says
 * nothing it has not measured — that is the honest limit of an in-worker check.
 * Plan 260910d.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCOUNT_ROUTING_VARIABLES, accountNeutralEnv } from "./helpers/account-neutral-env.js";

/** Names `.env.local` defines. Setup files load it over the inherited environment, so these come
 *  from the repo's file — the same for every runner — and not from the runner's account. */
function namesInEnvLocal(): Set<string> {
  if (!existsSync(".env.local")) return new Set();
  const names = readFileSync(".env.local", "utf8")
    .split("\n")
    .map((line) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
  return new Set(names);
}

describe("the account environment a test inherits", () => {
  it("carries none of the runner's account-routing variables", () => {
    const fromRepo = namesInEnvLocal();
    const leaked = ACCOUNT_ROUTING_VARIABLES
      .filter((name) => !fromRepo.has(name))
      .filter((name) => process.env[name] !== undefined);
    expect(leaked).toEqual([]);
  });
});

describe("accountNeutralEnv", () => {
  it("removes every routing variable and keeps everything else", () => {
    const base = Object.fromEntries([
      ...ACCOUNT_ROUTING_VARIABLES.map((name) => [name, "from-the-runner"]),
      ["PATH", "/bin"],
    ]);
    const env = accountNeutralEnv({}, base);
    for (const name of ACCOUNT_ROUTING_VARIABLES) expect(env[name]).toBeUndefined();
    expect(env.PATH).toBe("/bin");
  });

  it("lets a test set one on purpose", () => {
    expect(accountNeutralEnv({ CLAUDE_CONFIG_DIR: "/chosen" }, { CLAUDE_CONFIG_DIR: "/runner" }).CLAUDE_CONFIG_DIR)
      .toBe("/chosen");
  });
});
