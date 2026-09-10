/**
 * `command -v <cli>` after the same `.env.local` load the wrappers do — `loadRepoEnv` from
 * scripts/subagent-cli.ts, which reads this checkout's `.env.local` — so a test's preflight answers
 * for the environment the wrapper will run in. Spawned by `resolveAsWrapper` in ./wrapper-env.ts;
 * exits non-zero when nothing resolves.
 */
import { execFileSync } from "node:child_process";

import { loadRepoEnv } from "../../scripts/subagent-cli.js";

await loadRepoEnv();
const cli = process.argv[2] ?? "";
process.stdout.write(execFileSync("bash", ["-c", 'command -v -- "$1"', "resolve", cli], { encoding: "utf8", env: process.env }));
