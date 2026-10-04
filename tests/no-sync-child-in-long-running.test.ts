/**
 * **No new synchronous child process in the dashboard or the Overseer daemon.**
 *
 * `execFileSync`, `spawnSync` and `execSync` cannot return until the child has
 * exited. Their `timeout` only chooses when to send a signal, so a child that
 * ignores it, or sits in uninterruptible I/O, holds the caller for as long as
 * it likes — and the fleet dashboard and the Overseer daemon each have one
 * thread. docs/postmortems/260910a-a-timeout-that-signals-and-then-waits-is-not-a-bound.md
 * measured it and proposed this check; it was built on 2026-10-04.
 *
 * The bounded way to run a child is `probeOwner().run()` in
 * `tools/fleet/child.ts`: the caller stops waiting at `timeout + grace`.
 *
 * ## A flat scan, not a reachability walk
 *
 * Every file under `tools/`, plus `scripts/overseer.ts` (which composes the
 * daemon and injects callbacks into it). "This file is only reached from a
 * CLI" is exactly the claim that goes stale, so the scan does not try to prove
 * it: a file that imports one is on {@link MAY_STILL_BLOCK} with its reason, or
 * the test fails.
 *
 * **The list may only shrink.** The assertion is equality, so converting a file
 * fails this test until its line is deleted, and nobody can leave a dead
 * exception behind for the next synchronous call to hide under.
 *
 * ## What this does not prove
 *
 * It is a list of FILES. It does not see a second synchronous call added
 * inside a file already listed, a new long-running caller of a listed file's
 * blocking helper (`collectHealth`, say), or a wrapper imported from outside
 * `tools/`. A reason that says "a CLI" is a sentence, not a check. Shrinking
 * the list is how those go away.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SYNC = ["execFileSync", "spawnSync", "execSync"];
const MODULES = ["node:child_process", "child_process"];

/**
 * Files that still import a synchronous child API as a value, and why each is
 * still here. Delete a line when its file is converted; never add one without
 * reading the postmortem above.
 */
const MAY_STILL_BLOCK: Record<string, string> = {
  "tools/fleet/steer.ts": "the send transport; its synchrony is also its exclusion — umbrella 261003f cluster 23",
  "tools/fleet/pane.ts": "the sync capturePane the send transport uses — cluster 23",
  "tools/fleet/health.ts": "the sync collectHealth, kept for the CLI tick and two scripts; the server uses collectHealthAsync",
  "tools/fleet/readiness-wiring.ts": "tmux list-sessions on the readiness timer — plan 261004c stage 4",
  "tools/fleet/readiness-git.ts": "git on the readiness timer, shared with two scripts — plan 261004c stage 4",
  "tools/fleet/routes-actions.ts": "two ps calls in listProcesses — plan 261004c stage 2",
  "tools/fleet/routes-rename.ts": "two tmux calls in the rename route — plan 261004c stage 2",
  "tools/fleet/revision.ts": "runs once at startup, before the server listens",
  "tools/overseer/attention-probe.ts": "the hand-run `overseer attention` CLI",
  "tools/overseer/diagnose.ts": "a CLI",
  "tools/overseer/launchers.ts": "one tmux call per launch; its header argues the window",
  "tools/overseer/report-artefacts.ts": "git in the daemon's report drain — plan 261004c stage 3",
  "tools/overseer/usage.ts": "claude auth status in the usage pass — plan 261004c stage 2",
  "tools/overseer/work-probe.ts": "the sync process-table probe — plan 261004c stage 3",
  "scripts/overseer.ts": "the report CLI's own tmux-session lookup",
};

type AnyNode = { type: string; [key: string]: unknown };

function walk(node: unknown, visit: (node: AnyNode) => void): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const typed = node as AnyNode;
  if (typeof typed.type === "string") visit(typed);
  for (const key of Object.keys(typed)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    walk(typed[key], visit);
  }
}

function literal(node: unknown): string | null {
  const n = node as AnyNode | null | undefined;
  return n !== undefined && n !== null && n.type === "StringLiteral" && typeof n.value === "string" ? n.value : null;
}

/**
 * What a file takes from `child_process` that can block: the sync names it
 * imports as values, or `*` when it takes the whole module (a namespace or
 * default import, a `require`, a dynamic `import()`), since any of the three is
 * then one property access away.
 */
export function syncChildImports(src: string, file: string): string[] {
  const tree = parse(src, { sourceType: "module", plugins: ["typescript", "jsx"], sourceFilename: file });
  const found = new Set<string>();
  walk(tree.program, (node) => {
    if (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
      const source = literal(node.source);
      if (source === null || !MODULES.includes(source)) return;
      if (node.importKind === "type" || node.exportKind === "type") return;
      if (node.type === "ExportAllDeclaration") {
        found.add("*");
        return;
      }
      for (const spec of (node.specifiers as AnyNode[] | undefined) ?? []) {
        if (spec.importKind === "type" || spec.exportKind === "type") continue;
        if (spec.type === "ImportSpecifier" || spec.type === "ExportSpecifier") {
          const named = (spec.type === "ImportSpecifier" ? spec.imported : spec.local) as AnyNode;
          const name = named.type === "Identifier" ? (named.name as string) : literal(named);
          if (name !== null && SYNC.includes(name)) found.add(name);
        } else {
          // ImportDefaultSpecifier, ImportNamespaceSpecifier, ExportNamespaceSpecifier.
          found.add("*");
        }
      }
      return;
    }
    if (node.type === "CallExpression") {
      const callee = node.callee as AnyNode;
      const isRequire = callee.type === "Identifier" && callee.name === "require";
      const isImport = callee.type === "Import";
      const arg = literal((node.arguments as unknown[])[0]);
      if ((isRequire || isImport) && arg !== null && MODULES.includes(arg)) found.add("*");
    }
    if (node.type === "ImportExpression") {
      const arg = literal(node.source);
      if (arg !== null && MODULES.includes(arg)) found.add("*");
    }
  });
  return [...found].sort();
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

describe("no synchronous child process in a long-running process", () => {
  it("sees a value import in every spelling and ignores a type-only one — the scanner, checked first", () => {
    /* The assertion below is "nothing new was found", which is what a scanner
       that sees nothing reports. */
    const from = (mod: string): string => ` from "${mod}";`;
    expect(syncChildImports(`import { execFileSync }${from("node:child_process")}`, "x.ts")).toEqual(["execFileSync"]);
    expect(syncChildImports(`import {\n  spawn,\n  spawnSync as run,\n}${from("child_process")}`, "x.ts")).toEqual(["spawnSync"]);
    expect(syncChildImports(`import * as cp${from("node:child_process")}`, "x.ts")).toEqual(["*"]);
    expect(syncChildImports(`import cp${from("node:child_process")}`, "x.ts")).toEqual(["*"]);
    expect(syncChildImports(`export { execSync }${from("node:child_process")}`, "x.ts")).toEqual(["execSync"]);
    expect(syncChildImports(`const cp = require("child_process");`, "x.ts")).toEqual(["*"]);
    expect(syncChildImports(`const cp = await import("node:child_process");`, "x.ts")).toEqual(["*"]);
    // The async API, a type, and a comment that names one are all free.
    expect(syncChildImports(`import { spawn, execFile }${from("node:child_process")}`, "x.ts")).toEqual([]);
    expect(syncChildImports(`import type { spawnSync }${from("node:child_process")}`, "x.ts")).toEqual([]);
    expect(syncChildImports(`import { type spawnSync, spawn }${from("node:child_process")}`, "x.ts")).toEqual([]);
    expect(syncChildImports(`// execFileSync\nimport { readFileSync }${from("node:fs")}`, "x.ts")).toEqual([]);
  });

  it("is imported only by the files on the list, and every file on the list still imports one", () => {
    const files = [...filesUnder(path.join(ROOT, "tools")), path.join(ROOT, "scripts", "overseer.ts")];
    // The control: a scan that walked an empty or wrong directory finds nothing.
    expect(files.length).toBeGreaterThan(100);
    const importing: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (syncChildImports(readFileSync(file, "utf8"), rel).length > 0) importing.push(rel);
    }
    expect(
      importing.sort(),
      "a synchronous child call's `timeout` is when the signal is sent, not when the caller is freed: " +
        "a child that will not die holds the dashboard's or the daemon's only thread. Run it through " +
        "`probeOwner().run()` in tools/fleet/child.ts instead. If a file here was CONVERTED, delete its line " +
        "from MAY_STILL_BLOCK — the list only shrinks. " +
        "docs/postmortems/260910a-a-timeout-that-signals-and-then-waits-is-not-a-bound.md",
    ).toEqual(Object.keys(MAY_STILL_BLOCK).sort());
  });
});
