/**
 * `npm run db:start` — `supabase start`, but only from the primary checkout.
 *
 *     npm run db:start
 *     npm run db:start -- -x vector      (anything else is passed through)
 *
 * **Why it is not plain `supabase start` any more.** The CLI bind-mounts files
 * from the directory it is run in — Studio's `supabase/snippets`, the edge
 * runtime's secrets, Kong's `content_path` email templates — and labels every
 * container `com.supabase.cli.workdir=<that directory>`. Started from a
 * worktree, the one shared stack then belongs to that worktree. Remove the
 * worktree and nothing breaks, until a container restarts: Docker will not
 * start one whose bind source has gone. Local auth was down for 13 days that
 * way, and it looked like flaky auth tests
 * (docs/plans/261025i-guard-the-shared-local-supabase-against-being-mounted-from-a-worktree.md).
 *
 * So this refuses three ways in, and otherwise is `supabase start`:
 *
 * - a **linked worktree**, naming the primary to run it from;
 * - a forwarded **`--workdir`**, in either spelling, which from the primary
 *   would pass the first check and mount the tree anyway;
 * - an **existing `spideryarn2` container labelled with another workdir**: the
 *   stack is already somebody else's, and starting "here" would leave the
 *   containers that are already running where they are.
 *
 * A container with no workdir label is a warning rather than a refusal — an
 * older CLI may not write one, and a refusal nobody can clear is noise. Docker
 * not answering is not a refusal either; `supabase start` says so itself.
 *
 * Still uncovered, on purpose: a raw `supabase start` typed in a worktree. The
 * other half of the guard is `worktree:check`, which refuses to clear a tree
 * any container is mounted from (`mountsUnder` in scripts/worktree-check.ts).
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMain } from "../src/is-main.js";
import { dockerInventory, type InspectedContainer, primaryRoot, SUPABASE_PROJECT, samePath } from "./worktree-check.js";
import { inLinkedWorktree } from "./worktree-port.js";

export type StartDecision = { kind: "start"; args: string[]; warnings: string[] } | { kind: "refuse"; lines: string[] };

export interface StartInput {
  /** The checkout this copy of the script lives in. */
  here: string;
  primary: string;
  linked: boolean;
  /** What came after `--`. */
  args: string[];
  /** Every container on the machine, or `undefined` when Docker would not say. */
  containers: readonly unknown[] | undefined;
  platform?: NodeJS.Platform;
}

const REPAIR = [
  "To move it back, from the primary, at a quiet moment (every session shares the stack):",
  "  npm run db:stop && npm run db:start",
  "A plain stop keeps the local data. Never add --no-backup, which deletes it.",
];

/**
 * The whole judgement, pure, so it is tested without starting anything. The
 * workdir comparison is **equality**, not containment: a stack labelled with a
 * subdirectory of the primary is still not the primary's.
 */
export function decideStart(input: StartInput): StartDecision {
  const { here, primary, linked, args, containers } = input;
  const platform = input.platform ?? process.platform;

  if (linked) {
    return {
      kind: "refuse",
      lines: [
        `db:start refuses to run in a worktree (${here}).`,
        "`supabase start` mounts files from the directory it runs in, and the stack is",
        "shared by every session: once this worktree is removed, its containers cannot",
        "restart. Start it from the primary instead:",
        `  cd ${primary} && npm run db:start`,
      ],
    };
  }

  if (args.some((a) => a === "--workdir" || a.startsWith("--workdir="))) {
    return {
      kind: "refuse",
      lines: [
        "db:start refuses a forwarded --workdir: the stack must be mounted from the primary",
        `checkout (${primary}), and nothing else. Drop the flag.`,
      ],
    };
  }

  const warnings: string[] = [];
  for (const raw of containers ?? []) {
    if (typeof raw !== "object" || raw === null) continue;
    const c = raw as InspectedContainer;
    const labels = c.Config?.Labels ?? {};
    if (labels["com.supabase.cli.project"] !== SUPABASE_PROJECT) continue;
    const name = (c.Name ?? c.Id ?? "?").replace(/^\//, "");
    const workdir = labels["com.supabase.cli.workdir"];
    if (workdir === undefined || workdir === "") {
      warnings.push(`${name} has no com.supabase.cli.workdir label, so where it is mounted from is unknown.`);
      continue;
    }
    if (!samePath(workdir, here, platform)) {
      return {
        kind: "refuse",
        lines: [
          `db:start refuses: the ${SUPABASE_PROJECT} stack was started from ${workdir},`,
          `not from this checkout (${here}) — ${name} says so. Starting again here would`,
          "leave those containers mounted where they are.",
          ...REPAIR,
        ],
      };
    }
  }
  return { kind: "start", args, warnings };
}

function main(argv: string[]): void {
  const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const inventory = dockerInventory();
  const decision = decideStart({
    here,
    primary: primaryRoot(here),
    linked: inLinkedWorktree(here),
    args: argv,
    containers: inventory.kind === "listed" ? inventory.containers : undefined,
  });

  if (decision.kind === "refuse") {
    for (const line of decision.lines) console.error(line);
    process.exit(1);
  }
  for (const w of decision.warnings) console.error(`warning: ${w}`);

  const r = spawnSync("supabase", ["start", ...decision.args], { cwd: here, stdio: "inherit" });
  if (r.error !== undefined) {
    console.error(`could not run supabase start: ${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
