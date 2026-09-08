#!/usr/bin/env -S npx tsx
/**
 * Preflight for infra/hetzner/cloud-init.yaml and infra/hetzner/provision.sh —
 * run it before every apply.
 *
 * Every bug that cost us a rebuild was findable here, in seconds, on this
 * laptop:
 *   - an unescaped ${...} in a comment (a plan-time error)
 *   - a pipeline inside a runcmd string, so tee's exit status hid a failure
 *   - a `check` whose nested quoting made it unrunnable, so it passed by
 *     never actually running
 *   - a bash syntax error, which costs a whole boot to discover
 *
 * provision.sh used to live inside a heredoc in the YAML and had to be carved
 * back out of it. It is a real file now, so it is simply read — but that means
 * this script could happily check a file the box never runs. Section 0 is what
 * stops that: it asserts the wiring that makes the file on disk the file that
 * boots.
 *
 * Deliberately has NO dependencies — not even a YAML parser. It parses the one
 * structure we control. The important consequence is the guards at the bottom:
 * if this script extracts nothing, that is a FAILURE, not a pass. A preflight
 * that quietly checks zero things is worse than none, because you trust it.
 * That guard has already caught a bug in this file: a regex that terminated at
 * the first blank line inside provision.sh and silently found zero checks.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = process.argv[2] ?? path.join(REPO, "infra/hetzner/cloud-init.yaml");
const INFRA = path.dirname(FILE);
const PROVISION = path.join(INFRA, "provision.sh");
const MAIN_TF = path.join(INFRA, "main.tf");

/** Must match the templatefile() call in main.tf. */
const TEMPLATE_VARS: Record<string, string> = {
  username: "greg",
  volume_id: "106750393",
  timezone: "Europe/London",
  node_major: "26",
  swap_gb: "16",
  ssh_public_key: "ssh-ed25519 AAAAC3Nz test@example",
  // filebase64(the credential helper). Its value is irrelevant here — what
  // matters is that the variable is declared, because Terraform errors at plan
  // time on one that is not. There is no provision_b64 any more; section 0
  // fails if one comes back.
  helper_b64: "IyEvYmluL3NoCg==",
};

/**
 * The values provision.sh's own `check` lines are allowed to interpolate at
 * the moment the check string is built. Kept in step with the script by
 * section 4, which expands under `set -u`: an unset name there is an error
 * rather than an empty string spliced into a check that then tests nothing.
 */
/**
 * Hetzner Cloud's cap on a server's `user_data`, in bytes. The hcloud provider's
 * own docs for `hcloud_server`: "This field is limited to 32KiB." It is a hard
 * API limit, checked at server creation, and the provider sends the value as-is
 * — no gzip, no re-encoding.
 */
const USER_DATA_LIMIT = 32 * 1024;

const CHECK_ENV = 'USER_NAME=greg; GJD_NODE_MAJOR=26; SUPABASE_VERSION=2.115.0;'
  // A mktemp path in the real script; any path parses the same here, and
  // naming it is what keeps the -u expansion below honest.
  + ' CODEX_CFG_PROBE=/tmp/codex-cfg-probe.sh;';

/**
 * Things the finished box must be proven to have. Each earned its place by
 * being absent on a build that reported success: node was the distro's 18 with
 * no npm beside it, and everything downstream of that never ran.
 */
const REQUIRED_CHECKS = [
  // The two canaries that test the checking machinery itself — see
  // docs/postmortems/260831f-the-match-that-still-failed.md. They are first because
  // without them every other name on this list is a claim nothing verifies.
  "self-test: a check that must pass",
  "self-test: a check that must fail",
  "/home is the volume",
  "swap",
  "node",
  "npm",
  "claude",
  // Both status line checks by their FULL names. "claude statusline" alone
  // would be satisfied by either one, so the check that actually runs the
  // script could disappear while this file stayed green — and that is the
  // half that can fail on a box where the other half looks perfect.
  "claude statusline is wired up",
  "claude statusline shows context %",
  "codex",
  // By its full name, for the reason the two status line checks give: a
  // bare "codex" is satisfied by `codex --version`, and this is the one
  // that asks whether the config every repo here carries still loads.
  "codex accepts a repo-shaped [permissions] config",
  "chrome",
  "playwright",
  "mcp",
  "docker daemon",
  "docker run as",
  "supabase",
  // The editor, all three of the places that name it. Listed separately rather
  // than as one "emacs", because a box can have the package and still open nano.
  "emacs runs",
  "EDITOR is emacs -nw",
  "editor alternative is emacs",
  "git core.editor",
  "sshd",
  "password auth",
  // The two box services, by the checks that carry the actual claim. `enabled`
  // is true of a systemd USER unit as well, and a user unit does not start at
  // boot without lingering — so the multi-user.target.wants symlink is the one
  // that means "this comes back after a reboot", and the ExecStart one is what
  // stops it pointing into a worktree that `git worktree remove` will delete.
  "overseer starts at boot",
  "overseer ExecStart is in the primary checkout",
  // The dashboard's unit is installed and deliberately NOT enabled — its owner
  // asked to read it before it is switched on, and the page is up under a tmux
  // job meanwhile — so there is no boot check to require here. These two are
  // the ones that would be expensive to discover on the day it is enabled.
  "fleet dashboard ExecStart is in the primary checkout",
  "fleet dashboard does not name FLEET_ACT_ENABLED",
];

const problems: string[] = [];
const note = (s: string) => console.log(`  ${s}`);
const fail = (s: string) => {
  problems.push(s);
  console.log(`  ✗ ${s}`);
};

const raw = readFileSync(FILE, "utf8");
const provision = readFileSync(PROVISION, "utf8");
const mainTf = readFileSync(MAIN_TF, "utf8");

// 0. The wiring, first, and it INVERTED on 2026-09-01: provision.sh no longer
//    travels in user_data at all, because the rendered file is capped at 32 KiB
//    and the script is 67 KiB base64'd. So what has to be asserted now is the
//    absence — that nothing has quietly put it back — and that the file this
//    script checks is still the file `gjd-remote provision` uploads.
//
//    The absence needs a check precisely because putting it back would LOOK
//    like a fix: a self-provisioning cloud-init is the obvious shape, it would
//    pass every other check in this file, and it would fail only at the API,
//    months later, on the one day anyone rebuilds.
if (/provision_b64/.test(mainTf) || /provision_b64/.test(raw)) {
  fail("provision.sh is back in user_data — it is 67 KiB base64'd against a 32 KiB cap, and a rebuild would be rejected at the API. `gjd-remote provision` copies it up instead");
}
if (/\/usr\/local\/sbin\/provision\.sh/.test(raw)) {
  fail("cloud-init.yaml mentions /usr/local/sbin/provision.sh — provisioning is `gjd-remote provision` now, and a cloud-init that also does it would run an unknown version of the script");
}
if (!/PROVISION NOT RUN/.test(raw)) {
  fail("cloud-init.yaml never writes PROVISION NOT RUN — a bootstrapped box would have no status file, and `gjd-remote doctor` cannot tell that from one somebody deleted");
}
if (!/cmdProvision|gjd-remote provision/.test(readFileSync(path.join(REPO, "scripts/gjd-remote.ts"), "utf8"))) {
  fail("scripts/gjd-remote.ts has no provision command — nothing would ever run the script this file checks");
}
note("provision.sh is not in user_data, and gjd-remote provision is what runs it");

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

// 1b. SIZE. `user_data` goes to the Hetzner API as one field with a hard cap,
//     and Terraform stores only a hash of it — so a config that is too big
//     plans clean, fails at apply, and leaves nothing behind to read. Nothing
//     else in this repo can see it: `provision.sh` is re-run on the live box by
//     hand, which is a path with no size limit at all, so the two scripts can
//     grow for weeks with every check green and only a REBUILD finding out.
//
//     Measured on the real base64 of both scripts, not the stubs above.
{
  const real: Record<string, string> = {
    ...TEMPLATE_VARS,
    helper_b64: readFileSync(path.join(INFRA, "github-owner-credential-helper.sh")).toString("base64"),
  };
  let full = raw;
  for (const [k, v] of Object.entries(real)) full = full.replaceAll("${" + k + "}", v);
  const bytes = Buffer.byteLength(full.replaceAll("$${", "${"), "utf8");
  const kib = (bytes / 1024).toFixed(1);
  if (bytes > USER_DATA_LIMIT) {
    fail(
      `rendered user_data is ${kib} KiB, over Hetzner's ${USER_DATA_LIMIT / 1024} KiB cap — \`terraform apply\` will be rejected when it creates a server. ` +
        `Base64 costs a third on top, so ${((bytes * 3) / 4 / 1024).toFixed(1)} KiB of script is already too much`,
    );
  } else if (bytes > USER_DATA_LIMIT * 0.8) {
    note(`⚠ rendered user_data is ${kib} KiB of Hetzner's ${USER_DATA_LIMIT / 1024} KiB`);
  } else {
    note(`rendered user_data is ${kib} KiB, within Hetzner's ${USER_DATA_LIMIT / 1024} KiB`);
  }
}

const bashOk = (script: string, label: string) => {
  const r = spawnSync("bash", ["-n", "-c", script], { encoding: "utf8" });
  if (r.status !== 0) fail(`${label}: ${(r.stderr || "").trim().split("\n")[0]}`);
  return r.status === 0;
};

// 3. Pull each `content: |` block out of write_files and syntax-check the ones
//    that are scripts. A line scan, not a regex: the regex version terminated
//    at the first blank line inside a script body and silently found nothing.
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

let embeddedScripts = 0;
for (const b of blocks) {
  if (!b.body.trimStart().startsWith("#!")) continue;
  embeddedScripts++;
  if (bashOk(b.body, `${b.path} syntax`)) note(`✓ ${b.path} parses`);
}

// 4. provision.sh, read straight from disk. `bash -n` on the whole file, then
//    every `check` line individually: nested quoting is where a check silently
//    stops testing anything while still reporting ok.
if (bashOk(provision, "provision.sh syntax")) note("✓ infra/hetzner/provision.sh parses");

// `bash -n` is BLIND to an unterminated heredoc: it warns nothing, exits 0, and
// treats the rest of the file as data. That is not hypothetical — splicing a
// script with no trailing newline into `<<'"'"'STATUSLINE'"'"'` produced
// `printf "%s" "$line"STATUSLINE`, which swallowed the last 40 lines of
// provision.sh, and every check above this one still passed. So count the
// delimiters ourselves.
{
  const lines = provision.split("\n");
  let open: { delim: string; dash: boolean; line: number } | undefined;
  let heredocs = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (open) {
      // Bash's rule, exactly: `<<DELIM` closes only on DELIM at column zero,
      // and `<<-DELIM` strips leading TABS and nothing else. Accepting an
      // indented terminator would let this scanner call closed a heredoc bash
      // reads to end-of-file — which is the one thing it exists to catch.
      const candidate = open.dash ? line.replace(/^\t+/, "") : line;
      if (candidate === open.delim) open = undefined;
      continue;
    }
    const m = /<<(-?)['"]([A-Za-z_][A-Za-z0-9_]*)['"]/.exec(line);
    if (m?.[2]) {
      open = { delim: m[2], dash: m[1] === "-", line: i + 1 };
      heredocs++;
    }
  }
  const openDelim = open?.delim ?? "";
  const openLine = open?.line ?? 0;
  if (openDelim) {
    fail(
      `heredoc <<'${openDelim}' opened at provision.sh:${openLine} is never closed — bash -n cannot see this, so everything after it is data rather than script`,
    );
  } else if (heredocs < 2) {
    // Parser drift, not a box problem: if this stops finding heredocs it stops
    // being able to find an unclosed one either, and says so instead of "ok".
    fail(`found ${heredocs} quoted heredocs in provision.sh — the scanner has drifted from the file`);
  } else {
    note(`${heredocs} heredocs, all closed`);
  }
}

// Backslash-continued lines are JOINED first, and that is not tidiness. A
// `check "…" \` on its own line matched the filter, the regex took its argument
// to be the lone `\`, and `printf "%s" \` parses perfectly — so the check was
// reported as runnable shell while nothing had looked at it. Four checks were
// invisible that way on 2026-09-05, and the count at the bottom said 44.
// A checker that silently skips what it cannot parse is the thing this file
// exists to prevent, so it does not get to do it either.
const continued = provision.replace(/\\\n\s*/g, " ");
const checkLines = continued.split("\n").filter((l) => l.trim().startsWith("check "));
for (const line of checkLines) {
  const m = /^\s*check\s+"([^"]+)"\s+(.*)$/.exec(line);
  if (!m) {
    fail(`unparseable check: ${line.trim().slice(0, 60)}`);
    continue;
  }
  // -u, so a name the check splices in but nothing sets is an error here
  // rather than an empty string in an assertion that then proves nothing
  // (`grep -qx ""` matches a blank line and parses perfectly).
  const expand = spawnSync("bash", ["-u", "-c", `${CHECK_ENV} printf "%s" ${m[2]}`], { encoding: "utf8" });
  if (expand.status !== 0) {
    fail(`check "${m[1]}": its own argument will not parse (${(expand.stderr || "").trim().split("\n")[0]})`);
    continue;
  }
  bashOk(expand.stdout, `check "${m[1]}"`);
}
note(`${checkLines.length} verification checks are runnable shell`);

// A COUNT is the wrong guard for COVERAGE: deleting one check still leaves
// plenty, and the build would go green having stopped verifying the thing that
// broke last time. Name what must be verified, so removing one is a deliberate
// act that edits this list.
// Names come from two places. Most are `check "..."` lines; the must-FAIL
// canary is deliberately NOT a check() call (inverting the flag inside the
// helper would make the helper the thing under test), so its name is only ever
// seen in the ok/FAIL line it prints itself.
const names = [
  ...checkLines.map((l) => /check\s+"([^"]+)"/.exec(l)?.[1] ?? ""),
  // `echo` or `say` — provision.sh routes report lines through say() so they
  // reach the status file as well as stdout. Matching only `echo` silently
  // stopped finding the longhand canary the moment that landed, which is
  // exactly what this guard is for, and it did catch it.
  ...[...provision.matchAll(/(?:echo|say) "(?:ok {3}|FAIL )([^"]+)"/g)].map((m) => (m[1] ?? "").trim()),
];
for (const required of REQUIRED_CHECKS) {
  if (!names.some((n) => n.includes(required))) {
    fail(`no check covers "${required}" — the box could provision without it and still report OK`);
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

// 6. The guards that make the rest mean anything. Each one is "the parser
//    found less than it must have", not "the box has less than it should" —
//    they catch this file drifting away from the files it reads.
if (embeddedScripts < 1) fail(`extracted ${embeddedScripts} embedded scripts from the YAML — the block parser has drifted, so nothing in section 3 was really checked`);
if (checkLines.length < 10) fail(`found only ${checkLines.length} check lines in provision.sh — the parser has drifted from the file, so nothing in section 4 was really checked`);
if (runcmd.length < 1) fail(`found ${runcmd.length} runcmd entries — parser drift`);
if (interpolations < 5) fail(`only found ${interpolations} interpolations — parser drift`);

console.log(problems.length === 0 ? "\n✓ cloud-init preflight passed" : `\n✗ ${problems.length} problem(s)`);
process.exit(problems.length === 0 ? 0 : 1);
