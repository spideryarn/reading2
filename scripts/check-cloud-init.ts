#!/usr/bin/env -S npx tsx
/**
 * Preflight for infra/hetzner/cloud-init.yaml — run it before every apply.
 *
 * Every bug that cost us a rebuild was findable here, in seconds, on this
 * laptop:
 *   - an unescaped ${...} in a comment (a plan-time error)
 *   - a pipeline inside a runcmd string, so tee's exit status hid a failure
 *   - a `check` whose nested quoting made it unrunnable, so it passed by
 *     never actually running
 *   - a bash syntax error, which costs a whole boot to discover
 *
 * Deliberately has NO dependencies — not even a YAML parser. It parses the one
 * structure we control. The important consequence is the guard at the bottom:
 * if this script extracts nothing, that is a FAILURE, not a pass. A preflight
 * that quietly checks zero things is worse than none, because you trust it.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = process.argv[2] ?? path.join(REPO, "infra/hetzner/cloud-init.yaml");

/** Must match the templatefile() call in main.tf. */
const TEMPLATE_VARS: Record<string, string> = {
  username: "greg",
  volume_id: "106750393",
  timezone: "Europe/London",
  node_major: "26",
  swap_gb: "16",
  ssh_public_key: "ssh-ed25519 AAAAC3Nz test@example",
};

/**
 * Things the finished box must be proven to have. Each earned its place by
 * being absent on a build that reported success: node was the distro's 18 with
 * no npm beside it, and everything downstream of that never ran.
 */
const REQUIRED_CHECKS = [
  "/home is the volume",
  "swap",
  "node",
  "npm",
  "claude",
  "chrome",
  "playwright",
  "mcp",
  "sshd",
  "password auth",
];

const problems: string[] = [];
const note = (s: string) => console.log(`  ${s}`);
const fail = (s: string) => {
  problems.push(s);
  console.log(`  ✗ ${s}`);
};

const raw = readFileSync(FILE, "utf8");

// 1. Every ${...} must name a declared variable. Terraform errors at plan time
//    on an unknown one, and templatefile() reads comments too.
let interpolations = 0;
for (const m of raw.matchAll(/(?<!\$)\$\{([^}]*)\}/g)) {
  interpolations++;
  const name = m[1]?.trim() ?? "";
  if (!(name in TEMPLATE_VARS)) {
    const line = raw.slice(0, m.index).split("\n").length;
    fail(`line ${line}: \${${name}} is not a declared template variable`);
  }
}
note(`${interpolations} interpolations, all declared`);

// 2. Render as Terraform will.
let rendered = raw;
for (const [k, v] of Object.entries(TEMPLATE_VARS)) rendered = rendered.replaceAll("${" + k + "}", v);
rendered = rendered.replaceAll("$${", "${"); // the escape Terraform consumes

const bashOk = (script: string, label: string) => {
  const r = spawnSync("bash", ["-n", "-c", script], { encoding: "utf8" });
  if (r.status !== 0) fail(`${label}: ${(r.stderr || "").trim().split("\n")[0]}`);
  return r.status === 0;
};

// 3. Pull each `content: |` block out of write_files and syntax-check the ones
//    that are scripts. A line scan, not a regex: the regex version terminated
//    at the first blank line inside provision.sh and silently found zero
//    checks. The count guard at the bottom is what caught that.
type Block = { path: string; body: string };
const blocks: Block[] = [];
{
  const lines = rendered.split("\n");
  let cur: { path: string; indent: number; body: string[] } | null = null;
  for (const line of lines) {
    const pathM = /^( +)- path: (\S+)\s*$/.exec(line);
    if (pathM) {
      if (cur) blocks.push({ path: cur.path, body: cur.body.join("\n") });
      cur = { path: pathM[2] ?? "", indent: (pathM[1] ?? "").length, body: [] };
      continue;
    }
    if (!cur) continue;
    // A line at or left of the list indent ends the block (e.g. `runcmd:`).
    if (line.trim() !== "" && line.search(/\S/) <= cur.indent) {
      blocks.push({ path: cur.path, body: cur.body.join("\n") });
      cur = null;
      continue;
    }
    // Skip the entry's own keys; keep the content body.
    if (/^\s+(permissions|content|owner|encoding|defer|append):/.test(line)) continue;
    cur.body.push(line.slice(cur.indent + 4));
  }
  if (cur) blocks.push({ path: cur.path, body: cur.body.join("\n") });
}

let scripts = 0;
for (const b of blocks) {
  if (!b.body.trimStart().startsWith("#!")) continue;
  scripts++;
  if (bashOk(b.body, `${b.path} syntax`)) note(`✓ ${b.path} parses`);

  if (b.path.endsWith("provision.sh")) {
    // 4. Every check must be runnable shell. Nested quoting here is where a
    //    check silently stops testing anything while still reporting ok.
    const checks = b.body.split("\n").filter((l) => l.trim().startsWith("check "));
    for (const line of checks) {
      const m = /^\s*check\s+"([^"]+)"\s+(.*)$/.exec(line);
      if (!m) {
        fail(`unparseable check: ${line.trim().slice(0, 60)}`);
        continue;
      }
      const expand = spawnSync(
        "bash",
        ["-c", `USER_NAME=greg; node_major=26; printf "%s" ${m[2]}`],
        { encoding: "utf8" },
      );
      if (expand.status !== 0) {
        fail(`check "${m[1]}": its own argument will not parse`);
        continue;
      }
      bashOk(expand.stdout, `check "${m[1]}"`);
    }
    note(`${checks.length} verification checks are runnable shell`);

    // A COUNT is the wrong guard: deleting one check still leaves plenty, and
    // the build would go green having stopped verifying the thing that broke
    // last time. Name what must be verified, so removing one is a deliberate
    // act that edits this list.
    const names = checks.map((l) => /check\s+"([^"]+)"/.exec(l)?.[1] ?? "");
    for (const required of REQUIRED_CHECKS) {
      if (!names.some((n) => n.includes(required))) {
        fail(`no check covers "${required}" — the box could provision without it and still report OK`);
      }
    }
  }
}

// 5. runcmd. A bare pipeline here exits with the LAST command's status, which
//    is how a failed provision reported success for an entire afternoon.
const runcmd = [...rendered.matchAll(/^ {2}- (bash .*)$/gm)].map((m) => m[1] ?? "");
for (const c of runcmd) {
  bashOk(c, "runcmd");
  if (/\|/.test(c) && !/pipefail/.test(c)) {
    fail(`runcmd pipes without pipefail, so the pipeline's status is the LAST command's: ${c.slice(0, 60)}`);
  }
}
note(`${runcmd.length} runcmd entries checked`);

// 6. The guard that makes the rest mean anything.
if (scripts < 2) fail(`only extracted ${scripts} scripts — the parser has drifted from the file, so nothing above was really checked`);
if (interpolations < 5) fail(`only found ${interpolations} interpolations — parser drift`);

console.log(problems.length === 0 ? "\n✓ cloud-init preflight passed" : `\n✗ ${problems.length} problem(s)`);
process.exit(problems.length === 0 ? 0 : 1);
