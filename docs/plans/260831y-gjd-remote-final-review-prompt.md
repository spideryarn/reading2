# Final review: `gjd-remote`, the CLI that drives a remote Claude Code box

You have reviewed this codebase twice today. This is the closing review of one artefact: the CLI.
Be adversarial. The most valuable finding is a path that reports success while doing nothing, or a
design we will have to undo.

## What it is

A Hetzner box (Ubuntu 24.04, 30GB RAM) runs Claude Code sessions 24/7 inside tmux. `gjd-remote` is
run from a laptop and drives it entirely over ssh. There is no daemon on the box and no state
outside tmux, `tofu output`, and files on the box's persistent `/home`.

Commands: `ls`, `new`, `shell`, `resume`, `kill`, `clone`, `push-env`, `doctor`, `ssh`, `tunnel`,
`forget-key`, `help`. Dependency-free TypeScript run through `tsx`; `util.parseArgs` only.

## What changed since you last saw it, and what I want checked

**1. `doctor` now has real exit semantics.** You found it printed red crosses and exited 0. It now
accumulates failures, asserts every expected check actually ran (so a doctor that ran nothing fails
rather than printing a clean screen), and exits non-zero. Provisioning is a counted check reading a
status file that `provision.sh` rewrites on every run, not the boot log.
   *Check:* is there any path where a check is skipped and that skip is silently treated as a pass?
   Is the "every expected check ran" assertion itself defeatable?

**2. `push-env` is an allowlist, not a blocklist** — your finding 3. It builds the remote
`.env.local` from `ALLOWLIST` in `scripts/gjd-remote-env.ts`; anything else is skipped and named.
This paid off immediately: Greg added two GitHub PATs to `.env.local` and they were skipped without
anyone changing the list.
   *Check:* can a key reach the box that is not on the list — through `--file`, a malformed line, a
   duplicate key, a value containing a newline, or CRLF? Is the after-write verification real, or
   does it re-read something it just computed?

**3. GitHub auth is two fine-grained PATs routed by a credential helper.** Seven repos across two
owners (`spideryarn` org, `gregdetre` user); a fine-grained PAT has one resource owner, so one token
cannot cover them. `infra/hetzner/github-owner-credential-helper.sh` parses the owner out of git's
`path=` and reads `/etc/github-tokens/<owner>.token`. Registered against the host only, because
per-owner `credential.<url>.helper` sections match a path prefix on git 2.50.0 but
`gitcredentials(5)` says paths must match exactly, and matching sections fire in config-file order
rather than most-specific-first.
   Measured: all seven repos clone and reach `git-receive-pack`; both tokens 403 across owners in
   both directions.
   *Check:* the helper is included below. Can it ever hand a token to the wrong owner? What about a
   `path=` that is empty, has a leading slash, contains `..`, or a host of `github.com:443`? Is
   registering host-only with `useHttpPath=true` genuinely safe, and what happens if some other
   config on the box sets a broader helper?

**4. Sessions now start in the repo checkout** (`--dir` → `GJD_REMOTE_REPO` → `~/code/spideryarn2`),
and your finding 4's `cd dir || cd /home/greg` fallback is gone. Reproduced through the real
check-then-act race — create the directory, generate the job, delete the directory, run the job —
which produced a live session at a bash prompt in `/home/greg` with the FATAL line one keystroke
from scrolling away. Now the session exits instead.
   *Check:* is "the session disappears" actually better than "the session is in the wrong place",
   given the user learns about it only from `ls` showing nothing? Is there a third option we are
   missing?

**5. `clone` refuses to make a twin.** The repo is `spideryarn/reading2` but is checked out as
`spideryarn2`, so a bare clone would have made a second copy named `reading2`. It scans siblings by
origin URL. It also checks the owner's token file exists before running git, because git's own error
(`could not read Username`) says nothing about why.

**6. Session naming.** `new` mints a UUID, starts Claude with `--session-id`, and `ls` later renames
a provisional session from the `ai-title` line in the transcript JSONL.

## Specific things I am unsure about

- **`shq()` and the ssh boundary.** Everything is composed into strings and passed to `ssh`. Is
  there an injection or quoting hole left — particularly in `clone` (repo names, `--base-folder`,
  `--name`) and `push-env`?
- **tmux target matching.** `=name` is used for exact matching. Is it used *everywhere* it must be?
  One prefix match on a `kill` would kill the wrong session.
- **The transcript rename.** It reads and parses JSONL written by another process while that process
  is still writing. What does a partial line do?
- **`doctor`'s browser smoke test** copies `scripts/remote-smoke-browser.mjs` to the box on every run
  rather than trusting a stale copy. Is that the right call, and is the copy itself verified?
- **What is missing entirely?** The question I most want answered. This CLI is the only way anyone
  operates this box. What will hurt in a month?

Rank findings by severity, say whether each mechanism is certain or speculative, and give the
smallest fix. Do not rewrite the file; tell me what is wrong with it.

## The code


### `scripts/gjd-remote.ts`

```
#!/usr/bin/env -S npx tsx
/**
 * `gjd-remote` — drive Claude Code sessions running in tmux on the Hetzner server.
 *
 * The design, and the reasons behind each piece, are in
 * docs/research/260831c-remote-server-tmux-mosh.md. The short version: one tmux session
 * per Claude session, mosh as transport with ssh as fallback, and tmux is not
 * optional because mosh cannot reattach — a client that dies leaves a session
 * nobody could otherwise get back into.
 *
 * No argument-parsing dependency, deliberately. Commander was the researched
 * recommendation and would be the right call for a bigger surface, but adding it
 * means editing package.json, which a peer had uncommitted work in at the time.
 * node:util's parseArgs covers six subcommands without touching a shared file.
 * Swapping in Commander later is contained to main().
 */
import { execFileSync, spawnSync } from "node:child_process";
import { parseArgs, styleText } from "node:util";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPushableName, buildEnvPayload, diffKeys, parseEnv } from "./gjd-remote-env.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USER = "greg";

/** Where checkouts live on the box, and where `clone` puts a new one. */
const REMOTE_CODE = `/home/${USER}/code`;

/** The one checkout that already exists. Written once and referenced everywhere
 *  — it used to be a literal in two places, and the help text is exactly where
 *  a second copy goes stale without anything noticing. */
const REMOTE_REPO_DEFAULT = `${REMOTE_CODE}/spideryarn2`;

/** Where the repo checkout lives on the box. Overridable so the push can be
 *  exercised against a scratch directory without a real checkout. */
const REMOTE_REPO = () => process.env.GJD_REMOTE_REPO ?? REMOTE_REPO_DEFAULT;

/** Everything gjd-remote leaves on the box lives under here. */
const REMOTE_WORK = `/home/${USER}/gjd-remote`;

/** tmux session names travel through shell commands across an ssh boundary, so
 *  nothing surprising may ever reach a shell. Same slug rule as the fleet. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

/**
 * accept-new, not `no` and not the default `ask`.
 *
 * The default cannot prompt under BatchMode, so the first connection after a
 * rebuild fails with "Host key verification failed" — which reads as a security
 * alarm and is really just "I have never seen this machine". accept-new trusts
 * a host it has no record of, and still REFUSES one whose key has changed,
 * which is the case actually worth refusing.
 */
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"];

const dim = (s: string) => styleText("dim", s);
const bold = (s: string) => styleText("bold", s);
const red = (s: string) => styleText("red", s);
const green = (s: string) => styleText("green", s);

function die(msg: string): never {
  console.error(red(`✗ ${msg}`));
  process.exit(1);
}

/** Single-quote for /bin/sh. The only safe way to put arbitrary text in a
 *  remote command line — and we still avoid doing it with prompts, which go
 *  through a file instead. */
function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/**
 * The address comes from Terraform state, never a constant: it changes on every
 * rebuild, and a hardcoded IP would be wrong exactly when you most need it.
 */
function host(): string {
  if (process.env.GJD_REMOTE_HOST) return process.env.GJD_REMOTE_HOST;
  try {
    const out = execFileSync("tofu", ["-chdir=" + path.join(REPO, "infra/hetzner"), "output", "-json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ip = JSON.parse(out)?.ipv4?.value;
    if (!ip) throw new Error("no ipv4 output");
    return ip;
  } catch (err) {
    die(
      `could not read the server address from Terraform state (${(err as Error).message}).\n` +
        `  Run this from the repo, or set GJD_REMOTE_HOST=<ip> to override.`,
    );
  }
}

const HOST = () => `${USER}@${host()}`;

/**
 * Run a command on the box over ssh and return stdout.
 *
 * `raw` keeps the bytes exactly as they came back. Everything else here wants
 * the trim; reading a file to compare it against its source does not, because
 * the trim would quietly make two different files look identical.
 */
function ssh(remote: string, opts: { check?: boolean; raw?: boolean } = {}): string {
  const r = spawnSync("ssh", [...SSH_OPTS, HOST(), remote], { encoding: "utf8" });
  if (opts.check !== false && r.status !== 0) {
    die(`ssh failed (${r.status}): ${(r.stderr || "").trim() || "no output"}`);
  }
  const out = r.stdout || "";
  return opts.raw ? out : out.trim();
}

/** Copy one file to the box. Dies on failure — a silent scp is how you get a
 *  box running yesterday's script and a green check that means nothing. */
function scpTo(local: string, remote: string): void {
  const r = spawnSync("scp", ["-q", ...SSH_OPTS, local, `${HOST()}:${remote}`], { encoding: "utf8" });
  if (r.status !== 0) die(`scp to ${remote} failed: ${(r.stderr || "").trim()}`);
}

/**
 * Is mosh actually usable right now? Networks that block UDP exist.
 *
 * The stty is load-bearing and cost someone an afternoon: script(1)'s fake pty
 * is 0x0, and mosh-server aborts on a zero-width client (`assertion s_width > 0`).
 * That failure looks exactly like a blocked firewall — two causes, one symptom.
 */
function moshProbe(): { ok: boolean; detail: string } {
  // script(1) calls tcgetattr on its stdin. Handed a pipe, it dies with
  // "tcgetattr/ioctl: Operation not supported on socket" — which is what this
  // probe did on EVERY network, while reporting "UDP blocked?". It was never
  // testing reachability at all. stdin must be the real terminal.
  if (!process.stdin.isTTY) {
    return { ok: false, detail: "cannot probe without a terminal; assuming ssh" };
  }
  const probe = `stty rows 40 cols 120; exec env LANG=C.UTF-8 mosh ${shq(HOST())} -- true`;
  const r = spawnSync("script", ["-q", "/dev/null", "sh", "-c", probe], {
    encoding: "utf8",
    // 15s, not 6: a first connection bootstraps over ssh before mosh's own
    // handshake starts, and a short timeout reports a blocked network for what
    // was only slowness. Some timeout is required — mosh retries forever.
    timeout: 15_000,
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (r.status === 0) return { ok: true, detail: "" };
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-4)
    .join("  ");
  const detail =
    r.signal === "SIGTERM" || r.error?.message?.includes("ETIMEDOUT")
      ? "timed out — mosh retries forever when UDP is blocked, so this is the usual shape of a blocked network"
      : out || `exit ${r.status}`;
  return { ok: false, detail };
}

/**
 * Attach to a tmux session. Three details here are not stylistic:
 *  =name  tmux target matching is a PREFIX match, so `-t fix` also matches
 *         `fix-login`. `=` demands exact. Attaching to the wrong session looks
 *         exactly like attaching to the right one until your work is missing.
 *  -d     detach other clients. mosh-servers orphaned by a laptop reboot linger
 *         as invisible attached clients holding the window at their old size.
 *  sh -c  mosh execs the remote command directly with no shell, so a bare
 *         `a || b` dies with "execvp: a || b: No such file or directory".
 */
function attachCmd(name: string, transport: "mosh" | "ssh"): string {
  // No `|| exec bash -l` here: a failed attach must fail. The job script keeps
  // the session alive after Claude exits, so nothing needs this as a safety net.
  const inner = `tmux attach -d -t =${name}`;
  return transport === "mosh"
    ? `LANG=C.UTF-8 mosh ${shq(HOST())} -- sh -c ${shq(inner)}`
    : `ssh -t ${shq(HOST())} ${shq(inner)}`;
}

/**
 * mosh, ssh, or decide by probing. Forced to ssh with GJD_REMOTE_TRANSPORT=ssh
 * or --ssh, which matters on networks where mosh's UDP does not get through —
 * a ferry's satellite link being the case that prompted it. The probe costs a
 * round trip and mosh retries forever when blocked, so on a known-bad network
 * you want to skip asking rather than wait to be told.
 */
function chooseTransport(force?: string): "mosh" | "ssh" {
  const pref = force ?? process.env.GJD_REMOTE_TRANSPORT ?? "auto";
  if (pref === "ssh" || pref === "mosh") return pref;
  const probe = moshProbe();
  if (!probe.ok) console.error(dim(`mosh unavailable (${probe.detail}); using ssh`));
  return probe.ok ? "mosh" : "ssh";
}

function attach(name: string, force?: string): never {
  const transport = chooseTransport(force);
  const r = spawnSync("sh", ["-c", attachCmd(name, transport)], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}

type Session = {
  name: string;
  created: Date;
  attached: boolean;
  windows: number;
  /** Claude Code's own generated title for the conversation, once it has one. */
  title: string;
  /** Whether the name is a placeholder we chose, and so may be replaced. */
  provisional: boolean;
};

/** A tmux session name: lower-case, hyphenated, and never surprising to a shell. */
function slugify(text: string, fallback: string): string {
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > 40) {
    // Cut back to a whole word rather than leaving a stump: a plain slice gave
    // "remote-server-setup-for-claude-code-agen".
    slug = slug.slice(0, 40);
    const lastGap = slug.lastIndexOf("-");
    if (lastGap > 10) slug = slug.slice(0, lastGap);
  }
  slug = slug.replace(/-+$/, "");
  // Non-Latin titles slug to nothing, which is a fallback, not a failure.
  return SLUG.test(slug) ? slug : fallback;
}

/** A placeholder name, used until Claude has decided what the work is about. */
function provisionalName(prompt?: string): string {
  const stamp = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "").replace(/(\d{4})(\d{4})/, "$1-$2");
  // A prompt makes a better placeholder than a timestamp, and costs nothing.
  return prompt ? slugify(prompt.split(/\s+/).slice(0, 5).join(" "), `s-${stamp}`) : `s-${stamp}`;
}

function sessions(): Session[] {
  // One round trip. For each tmux session: its stats, the Claude session id we
  // pinned into the tmux environment at launch, and the LAST ai-title line from
  // that conversation's transcript — Claude rewrites it as the work becomes
  // clearer, so the last one is the current one.
  const remote = `
    for s in $(tmux ls -F '#{session_name}' 2>/dev/null); do
      stats=$(tmux display -p -t "=$s" '#{session_created}|#{session_attached}|#{session_windows}')
      id=$(tmux show-environment -t "=$s" CLAUDE_SESSION_ID 2>/dev/null | cut -d= -f2-)
      prov=$(tmux show-environment -t "=$s" GJD_PROVISIONAL 2>/dev/null | cut -d= -f2-)
      title=""
      if [ -n "$id" ]; then
        f=$(ls -1 "$HOME"/.claude/projects/*/"$id".jsonl 2>/dev/null | head -1)
        [ -n "$f" ] && title=$(grep -o '"aiTitle":"[^"]*"' "$f" 2>/dev/null | tail -1 | cut -d'"' -f4)
      fi
      printf '%s|%s|%s|%s\\n' "$s" "$stats" "$prov" "$title"
    done`;
  const out = ssh(remote, { check: false });
  if (!out) return [];
  return out.split("\n").flatMap((line) => {
    const [name, created, attached, windows, prov, ...rest] = line.split("|");
    if (!name) return [];
    return [
      {
        name,
        created: new Date(Number(created) * 1000),
        attached: attached !== "0",
        windows: Number(windows),
        title: rest.join("|").trim(),
        provisional: prov === "1",
      },
    ];
  });
}

/**
 * Rename any placeholder-named session to Claude's own title for the work.
 *
 * Only placeholders: a name you chose is yours, and having a tool quietly
 * rename it under you would be worse than a dull name. Once renamed, the
 * session is marked no-longer-provisional so it settles rather than drifting
 * every time Claude sharpens its title.
 */
function adoptTitles(list: Session[]): Session[] {
  const taken = new Set(list.map((s) => s.name));
  return list.map((s) => {
    if (!s.provisional || !s.title) return s;
    let want = slugify(s.title, s.name);
    if (want === s.name || !SLUG.test(want)) return s;
    for (let n = 2; taken.has(want); n++) want = `${slugify(s.title, s.name).slice(0, 37)}-${n}`;
    ssh(`tmux rename-session -t =${s.name} ${want} && tmux set-environment -t =${want} GJD_PROVISIONAL 0`);
    console.error(dim(`renamed ${s.name} → ${want}`));
    taken.delete(s.name);
    taken.add(want);
    return { ...s, name: want, provisional: false };
  });
}

function age(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

// ---------------------------------------------------------------- commands

/**
 * Which tree a session starts in — and proof that it is actually there.
 *
 * Most specific first: an explicit `--dir`, else `GJD_REMOTE_REPO`, else the one
 * checkout that already exists. The home directory used to be the default, and
 * it is the wrong one: every session then opened with an agent guessing where to
 * `cd`, and a guess about which tree to edit is the expensive kind. `-d ~` still
 * gets you home when that is genuinely what you want.
 *
 * The existence check belongs HERE, before any session is created, and not only
 * because a session that dies on its first line is confusing. It is the half of
 * the guard that can say something useful — by the time the job script runs,
 * nobody is watching. See the job script below for the other half.
 */
function sessionDir(given: string | undefined): string {
  const explicit = given !== undefined;
  const dir = remotePath(given ?? REMOTE_REPO(), explicit ? "--dir" : "GJD_REMOTE_REPO");
  if (spawnSync("ssh", [...SSH_OPTS, HOST(), `test -d ${shq(dir)}`]).status === 0) return dir;
  die(
    `no such directory on the box: ${dir}\n` +
      (explicit
        ? `  --dir is a path on the BOX, not on this laptop.`
        : `  that is where sessions start when you do not say. Either put it there:\n` +
          `    gjd-remote clone spideryarn/reading2 --name spideryarn2\n` +
          `  or say where to start:\n` +
          `    gjd-remote new -d ~          ${dim("# the home directory")}\n` +
          `  (or set GJD_REMOTE_REPO to a checkout that already exists)`),
  );
}

function cmdLs(): void {
  const list = adoptTitles(sessions());
  if (list.length === 0) {
    console.log(dim("no sessions. `gjd-remote new` to start one."));
    return;
  }
  const w = Math.max(4, ...list.map((s) => s.name.length));
  console.log(bold("NAME".padEnd(w) + "  AGE   ATT  TITLE"));
  for (const s of list) {
    console.log(
      `${s.name.padEnd(w)}  ${age(s.created).padEnd(4)}  ${s.attached ? green("yes") : dim(" no")}  ${
        s.title ? s.title : dim("(no title yet)")
      }`,
    );
  }
}

/**
 * Create a session and start Claude Code in it.
 *
 * The prompt goes through a FILE, never a command line. It is prose: it will
 * contain quotes, backticks and newlines, and inlining it means escaping across
 * three layers (local shell → ssh → tmux → remote shell). A file means one.
 * Lifted from MindstoneRebel's fleet, whose comment reads "keeps quoting sane
 * when prompts contain prose".
 */
function cmdNew(
  given: string | undefined,
  opts: { prompt?: string | undefined; dir?: string | undefined; attach: boolean; transport?: string | undefined },
): void {
  // The name is optional. Without one we use a placeholder — derived from the
  // prompt if there is one, otherwise a timestamp — and `ls` later replaces it
  // with Claude's own title for the work once Claude has decided what that is.
  const provisional = !given;
  const name = given ?? provisionalName(opts.prompt);
  if (!SLUG.test(name)) die(`'${name}' is not a valid name (lower-case letters, digits, hyphens; max 41)`);
  if (sessions().some((s) => s.name === name)) die(`session '${name}' already exists — 'gjd-remote resume ${name}'`);

  // Resolved, normalised and checked in one place — and said out loud, because
  // which tree an agent is about to edit should never be something you find out
  // afterwards.
  const dir = sessionDir(opts.dir);
  console.log(bold(`gjd-remote new ${name}`) + dim(` → ${HOST()}:${dir}`));

  // Pin the session id rather than discovering it: it is how we find this
  // conversation's transcript later, and so how we read back its title.
  const sessionId = randomUUID();

  const promptPath = `/home/${USER}/gjd-remote/prompts/${name}.md`;
  const jobPath = `/home/${USER}/gjd-remote/jobs/${name}.sh`;
  ssh(`mkdir -p /home/${USER}/gjd-remote/prompts /home/${USER}/gjd-remote/jobs`);

  const stage = mkdtempSync(path.join(tmpdir(), "gjd-remote-"));

  if (opts.prompt) {
    const f = path.join(stage, `${name}.md`);
    writeFileSync(f, opts.prompt, "utf8");
    scpTo(f, promptPath);
  }

  // Non-interactive ssh sources NEITHER .bashrc NOR .bash_profile, so the job
  // gets a stock PATH. Append, never substitute: `PATH=$PATH || default` only
  // fires when PATH is undefined, never when it is set-but-incomplete, which is
  // the shape tmux and cron actually hand you.
  //
  // The prompt is read with "$(cat ...)" in DOUBLE quotes. It was single-quoted
  // in the first version, which suppresses the substitution entirely and passed
  // Claude the literal text `$(cat /home/greg/...)` — the whole feature was
  // broken and nothing would have shown it but reading Claude's first reply.
  const job = [
    `#!/usr/bin/env bash`,
    `export PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:$PATH"`,
    `export LANG=C.UTF-8`,
    // No fallback. This line used to end `|| { echo FATAL; exec bash -l; }`,
    // which gave you a healthy-looking tmux session sitting in /home/greg with
    // the FATAL line one keystroke from scrolling away — and Claude never
    // started. `gjd-remote ls` showed a session; the tree was the wrong one.
    // Reproduced 2026-08-31 by deleting the directory after the check.
    //
    // sessionDir() already checked, so reaching here means the directory went
    // away in between. Exiting ends the session, which is a failure you can see;
    // a session in the wrong tree is one you cannot.
    `cd ${shq(dir)} || { echo "FATAL: ${dir} is gone — refusing to start Claude somewhere else"; exit 1; }`,
    // --name only when Greg chose one: passing a placeholder would stop Claude
    // generating a title of its own, which is the thing we actually want.
    [
      "claude",
      `--session-id ${sessionId}`,
      provisional ? "" : `--name ${shq(name)}`,
      opts.prompt ? `"$(cat -- ${promptPath})"` : "",
    ]
      .filter(Boolean)
      .join(" "),
    `echo`,
    `echo "--- claude exited; shell follows, session stays alive ---"`,
    `exec bash -l`,
    ``,
  ].join("\n");

  const jobLocal = path.join(stage, `${name}.sh`);
  writeFileSync(jobLocal, job, "utf8");
  scpTo(jobLocal, jobPath);
  ssh(`chmod +x ${jobPath}`);
  // The id and the provisional flag live in the tmux session's own environment,
  // so they survive the rename that `ls` may later perform — a mapping file
  // keyed by name would go stale at exactly that moment.
  ssh(
    `tmux new-session -d -s ${name} -e CLAUDE_SESSION_ID=${sessionId} ` +
      `-e GJD_PROVISIONAL=${provisional ? 1 : 0} ${shq(`bash ${jobPath}`)}`,
  );

  console.log(green(`✓ started '${name}'`) + dim(opts.prompt ? " with a prompt" : ""));
  if (opts.attach) attach(name, opts.transport);
  else console.log(dim(`  gjd-remote resume ${name}`));
}

/**
 * A tmux session running a plain shell — no Claude Code.
 *
 * Distinct from `gjd-remote ssh` on purpose, and the difference is the whole
 * point of the box: this one keeps running when you close the lid, and `resume`
 * gets you back into it. `ssh` is a throwaway connection that dies with the
 * terminal, which is what you want for a quick look and never for real work.
 */
function cmdShell(given: string | undefined, opts: { dir?: string | undefined; transport?: string | undefined }): void {
  const name = given ?? `sh-${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "").replace(/(\d{4})(\d{4})/, "$1-$2")}`;
  if (!SLUG.test(name)) die(`'${name}' is not a valid name (lower-case letters, digits, hyphens; max 41)`);

  const live = sessions();
  if (live.some((x) => x.name === name)) {
    console.log(dim(`'${name}' already exists — attaching`));
    attach(name, opts.transport);
  }

  const dir = sessionDir(opts.dir);
  console.log(bold(`gjd-remote shell ${name}`) + dim(` → ${HOST()}:${dir}`));

  // GJD_PROVISIONAL=0: a shell has no Claude conversation and so will never
  // have a title to adopt. Marking it settled stops `ls` looking every time.
  ssh(`tmux new-session -d -s ${name} -c ${shq(dir)} -e GJD_PROVISIONAL=0`);
  console.log(green(`✓ shell '${name}'`));
  attach(name, opts.transport);
}

/**
 * Copy the laptop's `.env.local` to the repo checkout on the box.
 *
 * Three rules, and each exists because of a specific way this could go wrong:
 *
 *  ALLOWLIST  The file written on the box is BUILT from the keys named in
 *             scripts/gjd-remote-env.ts, not copied wholesale. Greg's
 *             .env.local holds a Hetzner token that can delete this box and a
 *             Supabase management PAT that can delete the production project;
 *             neither is on the list. A blocklist would have shipped whatever
 *             he adds next.
 *  ATOMIC     Written to a temp file beside the destination and renamed over
 *             it. A half-copied .env.local still parses — it just silently
 *             lacks its last few keys — which is precisely the silent success
 *             this project keeps being bitten by.
 *  VERIFIED   The file is read back off the box and re-parsed before this
 *             command claims anything. scp's exit code says a transfer
 *             finished, not that the right bytes are in the right file.
 *
 * Reports which KEYS changed. Never a value, and never a hash of one: a short
 * value shown as a hash is a value shown.
 */
function cmdPushEnv(opts: { file?: string | undefined }): void {
  const local = path.resolve(opts.file ?? path.join(REPO, ".env.local"));
  const refusal = assertPushableName(path.basename(local));
  if (refusal) die(refusal);
  if (!existsSync(local)) die(`no such file: ${local}`);

  const payload = buildEnvPayload(readFileSync(local, "utf8"));
  if (payload.pushed.size === 0) {
    die(
      `${local} has none of the allowlisted keys — refusing to write an empty env file.\n` +
        `  The allowlist is in scripts/gjd-remote-env.ts.`,
    );
  }

  const dir = REMOTE_REPO();
  const dest = `${dir}/.env.local`;
  // Not created for you, on purpose: an env file beside no repo is a box that
  // looks set up and is not, and you would find out at the first npm command.
  if (ssh(`test -d ${shq(dir)} && echo yes || echo no`, { check: false }) !== "yes") {
    die(
      `no checkout at ${dir} on the box, so there is nowhere to put .env.local.\n` +
        `  Create it first, then run this again:\n` +
        `    gjd-remote ssh\n` +
        // HTTPS, not the ssh remote the laptop uses. The box authenticates with
        // per-owner fine-grained PATs through a git credential helper, which only
        // sees a request it can route when the URL is https.
        `    mkdir -p ~/code && git clone https://github.com/spideryarn/reading2.git ${dir}\n` +
        `  (or set GJD_REMOTE_REPO to a checkout that already exists)`,
    );
  }

  console.log(bold(`gjd-remote push-env → ${HOST()}:${dest}`));
  const before = parseEnv(ssh(`cat ${shq(dest)} 2>/dev/null || true`, { check: false, raw: true }));
  const diff = diffKeys(before, payload.pushed);
  for (const k of diff.added) console.log(green(`  + ${k}`) + dim("  added"));
  for (const k of diff.removed) console.log(red(`  - ${k}`) + dim("  removed"));
  for (const k of diff.changed) console.log(`  ${bold("~")} ${k}` + dim("  changed"));
  console.log(dim(`  = ${diff.unchanged} unchanged`));
  if (payload.skipped.length) {
    console.log(dim(`  skipped ${payload.skipped.length} keys not on the allowlist: ${payload.skipped.join(", ")}`));
  }
  if (payload.missing.length) {
    console.log(dim(`  ${payload.missing.length} allowlisted keys absent locally: ${payload.missing.join(", ")}`));
  }

  const stage = mkdtempSync(path.join(tmpdir(), "gjd-remote-env-"));
  const staged = path.join(stage, ".env.local");
  writeFileSync(staged, payload.text, { encoding: "utf8", mode: 0o600 });

  const tmp = `${dir}/.env.local.push-${randomUUID()}`;
  // Pre-create the temp file under umask 077. scp only applies a mode when it
  // CREATES the file, so writing into an existing 0600 file leaves it 0600 —
  // whereas chmod-after-scp leaves a window in which a world-readable copy of
  // every credential is sitting in the repo. The chmod after the copy is belt
  // and braces, not the mechanism.
  ssh(`umask 077 && : > ${shq(tmp)}`);
  const sent = spawnSync("scp", ["-q", ...SSH_OPTS, staged, `${HOST()}:${tmp}`], { encoding: "utf8" });
  if (sent.status !== 0) {
    ssh(`rm -f ${shq(tmp)}`, { check: false });
    die(`scp failed: ${(sent.stderr || "").trim()}`);
  }
  // One command: chmod, then rename over the destination. rename(2) within a
  // directory is atomic, so a reader on the box sees the old file or the new
  // one and never a half-written one.
  ssh(`chmod 600 ${shq(tmp)} && mv -f ${shq(tmp)} ${shq(dest)}`);

  const back = parseEnv(ssh(`cat ${shq(dest)}`, { raw: true }));
  const wrong = [...payload.pushed].filter(([k, v]) => back.get(k) !== v).map(([k]) => k);
  const extra = [...back.keys()].filter((k) => !payload.pushed.has(k));
  if (wrong.length || extra.length || back.size !== payload.pushed.size) {
    die(
      `the file on the box does not match what was sent — leaving it for you to look at.\n` +
        (wrong.length ? `  wrong or missing: ${wrong.join(", ")}\n` : "") +
        (extra.length ? `  unexpected keys: ${extra.join(", ")}\n` : "") +
        `  sent ${payload.pushed.size} keys, read back ${back.size}`,
    );
  }
  const mode = ssh(`stat -c '%a %U' ${shq(dest)}`, { check: false });
  if (mode !== `600 ${USER}`) die(`written, but the mode is '${mode}' and should be '600 ${USER}'`);

  console.log(green(`✓ ${payload.pushed.size} keys, 0600 ${USER}, read back and verified`));
}

// ---------------------------------------------------------------- clone

/**
 * GitHub's own naming rules, narrowed: nothing here may ever surprise a shell.
 * Owners are alphanumeric-and-hyphen; repo names also allow dot and underscore.
 * Both must START with alphanumeric, which is what rules out `.`, `..`, and a
 * leading hyphen that a command would read as a flag.
 */
const GH_OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const GH_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Per-owner fine-grained PATs, one file each. See infra/hetzner/README.md. */
const TOKEN_DIR = "/etc/github-tokens";

type Repo = { owner: string; name: string; url: string };

/**
 * `owner/name` or `https://github.com/owner/name(.git)`, normalised to one thing.
 *
 * HTTPS is not a preference. The box has no ssh key at all; it authenticates
 * through a git credential helper that reads the owner out of the request PATH,
 * and a `git@github.com:` URL never reaches it. So an ssh URL is rejected here
 * with the reason, rather than handed to git to fail obscurely three seconds later.
 */
function parseRepo(given: string): Repo {
  const raw = given.trim();
  const forms = `  owner/name\n  https://github.com/owner/name.git`;
  if (/^(git@|ssh:\/\/)/.test(raw)) {
    die(
      `'${raw}' is an ssh URL, and the box has no ssh key for GitHub.\n` +
        `  It authenticates with per-owner tokens through a credential helper that only\n` +
        `  sees the owner when the URL is https. Use one of:\n${forms}`,
    );
  }
  const m = /^(?:https:\/\/github\.com\/)?([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(raw);
  const owner = m?.[1];
  const name = m?.[2];
  if (!owner || !name || !GH_OWNER.test(owner) || !GH_REPO.test(name)) {
    die(`'${raw}' is not a repository I recognise. Two forms are accepted:\n${forms}`);
  }
  return { owner, name, url: `https://github.com/${owner}/${name}.git` };
}

/** `owner/name`, lower-cased, out of any GitHub remote URL — the comparable
 *  form. GitHub owners and repo names are case-insensitive, so the comparison
 *  has to be too, or an existing checkout goes unrecognised and gets a twin. */
function remoteSlug(url: string): string | undefined {
  const m = /^(?:https:\/\/(?:[^@/]*@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
    url.trim(),
  );
  const owner = m?.[1];
  const name = m?.[2];
  return owner && name ? `${owner}/${name}`.toLowerCase() : undefined;
}

/** A path ON THE BOX, from a flag. Absolute or `~`-relative; anything else is a
 *  path relative to whatever directory ssh happened to land in, which is not a
 *  thing anybody means. */
function remotePath(given: string, what: string): string {
  const p = given.trim();
  if (!p) die(`${what} may not be empty`);
  if (/[\r\n\0]/.test(p)) die(`${what} may not contain newlines`);
  const abs = p === "~" ? `/home/${USER}` : p.startsWith("~/") ? `/home/${USER}/${p.slice(2)}` : p;
  if (!abs.startsWith("/")) die(`${what} must be absolute or ~-relative, got '${p}'`);
  return abs.replace(/\/+$/, "") || "/";
}

type CloneFacts = {
  get: (k: string) => string;
  /** Every checkout directly under the base folder, with its origin URL. */
  siblings: { dir: string; url: string }[];
};

/**
 * Everything the decision needs, in one round trip: the destination's state,
 * whether the owner has a token, and what else under the base folder is already
 * a checkout of something.
 *
 * `rev-parse --show-toplevel` alone is not "is this a checkout" — inside a repo
 * it happily answers for an ANCESTOR, so a plain subdirectory of one would read
 * as a checkout of the parent. It counts only when the toplevel IS the
 * directory we asked about.
 */
function cloneFacts(base: string, dest: string, tokenFile: string): CloneFacts {
  const script = `
    isrepo() {
      top=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null || true)
      real=$(cd "$1" 2>/dev/null && pwd -P || true)
      [ -n "$top" ] && [ "$top" = "$real" ]
    }
    d=${shq(dest)}
    printf 'exists=%s\\n' "$(test -e "$d" && echo yes || echo no)"
    if isrepo "$d"; then
      printf 'checkout=yes\\n'
      printf 'remote=%s\\n' "$(git -C "$d" remote get-url origin 2>/dev/null || true)"
      printf 'branch=%s\\n' "$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
      printf 'subject=%s\\n' "$(git -C "$d" log -1 --pretty=%s 2>/dev/null | tr -d '\\n' || true)"
      printf 'dotgit=%s\\n' "$(test -e "$d/.git" && echo yes || echo no)"
    else
      printf 'checkout=no\\n'
    fi
    for c in ${shq(base)}/*/; do
      c=\${c%/}
      if isrepo "$c"; then
        printf 'sibling=%s|%s\\n' "$c" "$(git -C "$c" remote get-url origin 2>/dev/null || true)"
      fi
    done
    printf 'token=%s\\n' "$(test -f ${shq(tokenFile)} && echo yes || echo no)"
    printf 'tokenmode=%s\\n' "$(stat -c '%a %U' ${shq(tokenFile)} 2>/dev/null || true)"`;
  const map = new Map<string, string>();
  const siblings: { dir: string; url: string }[] = [];
  for (const line of ssh(script, { check: false }).split("\n")) {
    const at = line.indexOf("=");
    if (at < 1) continue;
    const key = line.slice(0, at);
    const value = line.slice(at + 1).trim();
    if (key === "sibling") {
      const bar = value.lastIndexOf("|");
      const dir = value.slice(0, bar);
      const url = value.slice(bar + 1);
      if (bar > 0 && url) siblings.push({ dir, url });
      continue;
    }
    map.set(key, value);
  }
  return { get: (k) => map.get(k) ?? "", siblings };
}

/** What a checkout is, said the same way whether we found it or made it. */
function describeCheckout(facts: CloneFacts): void {
  console.log(`  ${dim("remote")}  ${facts.get("remote") || dim("(none)")}`);
  console.log(`  ${dim("branch")}  ${facts.get("branch") || dim("(unknown)")}`);
  console.log(`  ${dim("HEAD")}    ${facts.get("subject") || dim("(no commits)")}`);
}

/**
 * Clone one of Greg's repos onto the box, over HTTPS, after saying no to the
 * three ways this goes wrong quietly.
 *
 *  NO TOKEN     The credential helper refuses an unknown owner before any
 *               network call — correctly — but git reports it as "could not
 *               read Username for 'https://github.com'", which names neither
 *               the owner nor the file. Checking first is the whole value this
 *               command adds over typing `git clone`.
 *  A SECOND COPY  `spideryarn/reading2` is checked out as `spideryarn2`, so the
 *               obvious default name would put a second, diverging copy beside
 *               it. Any checkout under the base folder with the same origin
 *               counts as the answer, whatever it is called.
 *  A REWRITTEN REMOTE  `url.insteadOf` and friends can rewrite what git records,
 *               and an ssh remote on this box can never fetch again. So the
 *               remote is read back and compared, not assumed.
 *
 * It deliberately runs nothing else — no `npm ci`, no install. A clone that
 * quietly triggers a five-minute install is a clone you cannot use to look at
 * something. The next steps are printed instead.
 */
function cmdClone(given: string | undefined, opts: { baseFolder?: string | undefined; name?: string | undefined }): void {
  if (!given) {
    die(`gjd-remote clone <repo> [--base-folder DIR] [--name DIR-NAME]\n  owner/name, or https://github.com/owner/name.git`);
  }
  const repo = parseRepo(given);
  const base = remotePath(opts.baseFolder ?? REMOTE_CODE, "--base-folder");
  const dirName = (opts.name ?? repo.name).trim();
  if (!GH_REPO.test(dirName)) {
    die(`'${dirName}' is not a usable directory name (letters, digits, . _ -; must start with a letter or digit)`);
  }
  const dest = `${base}/${dirName}`;
  const tokenFile = `${TOKEN_DIR}/${repo.owner}.token`;

  console.log(bold(`gjd-remote clone ${repo.owner}/${repo.name} → ${HOST()}:${dest}`));

  const before = cloneFacts(base, dest, tokenFile);
  const want = `${repo.owner}/${repo.name}`.toLowerCase();

  // Already there. Success, not an error — but say WHICH repo is sitting there,
  // because a name collision and a done job look identical from the outside.
  if (before.get("checkout") === "yes") {
    const found = remoteSlug(before.get("remote"));
    console.log(green(`✓ already a checkout — nothing to do`));
    describeCheckout(before);
    if (found !== want) {
      console.log(red(`  note: that is ${found ?? "an unrecognised remote"}, not ${want}`));
      console.log(dim(`  --name or --base-folder if you meant somewhere else`));
    }
    return;
  }

  // Answer about the directory that was actually asked for before offering
  // news about any other one: an occupied destination is the user's problem to
  // decide, and burying it under an advisory reads as success.
  if (before.get("exists") === "yes") {
    die(`${dest} exists on the box but is not a git checkout.\n  Move it aside, or pass --name for a different directory.`);
  }

  // The same repo under another name. This is the reading2/spideryarn2 case,
  // and cloning anyway is how you get two checkouts that drift apart.
  const twin = before.siblings.find((s) => remoteSlug(s.url) === want);
  if (twin) {
    console.log(green(`✓ ${want} is already on the box`) + dim(` — under a different name`));
    console.log(`  ${dim("at")}      ${twin.dir}`);
    console.log(dim(`  nothing cloned. For a genuinely separate second copy, use --base-folder.`));
    return;
  }

  // Before git, not after: git's own error names neither the owner nor the file.
  if (before.get("token") !== "yes") {
    die(
      `no GitHub token on the box for owner '${repo.owner}'.\n` +
        `  git would fail with "could not read Username for 'https://github.com'", which\n` +
        `  says nothing about why. The credential helper needs this file:\n` +
        `    ${tokenFile}\n` +
        `  Issue a fine-grained PAT with resource owner '${repo.owner}', then:\n` +
        `    ssh ${HOST()} 'umask 077; cat > ${tokenFile}'   # paste, then Ctrl-D\n` +
        `  The full ceremony — including the org policy that makes a private repo look\n` +
        `  like a typo — is in infra/hetzner/README.md § Giving the box GitHub access.`,
    );
  }
  // Existence and mode only. Never the contents, not even a prefix of them.
  const mode = before.get("tokenmode");
  if (mode && mode !== `600 ${USER}`) {
    console.log(red(`  warning: ${tokenFile} is '${mode}' and should be '600 ${USER}'`));
  }

  // stdio inherit: a clone is the one thing here slow enough that its progress
  // is worth watching. GIT_TERMINAL_PROMPT=0 so a credential miss fails instead
  // of hanging on a username nobody is there to type.
  const cmd = `mkdir -p ${shq(base)} && GIT_TERMINAL_PROMPT=0 git clone ${shq(repo.url)} ${shq(dest)}`;
  const r = spawnSync("ssh", [...SSH_OPTS, HOST(), cmd], { stdio: "inherit" });
  if (r.status !== 0) {
    die(
      `git clone failed on the box (exit ${r.status}) — git's own output is above.\n` +
        `  "Repository not found" on a repo that exists usually means the token has no\n` +
        `  grant for it, or is pending org approval; both read as a typo.`,
    );
  }

  // Verify rather than trust. A clone that exited 0 into the wrong shape, or
  // with a rewritten remote, is exactly the silent success worth catching.
  const after = cloneFacts(base, dest, tokenFile);
  if (after.get("checkout") !== "yes" || after.get("dotgit") !== "yes") {
    die(`git clone said it succeeded, but ${dest} is not a checkout on the box.`);
  }
  const got = after.get("remote");
  if (got !== repo.url) {
    die(
      `cloned, but git recorded a different remote than the one asked for.\n` +
        `  asked for: ${repo.url}\n` +
        `  recorded:  ${got || "(none)"}\n` +
        `  A rewrite (url.insteadOf) would do this, and an ssh remote can never fetch\n` +
        `  from this box — it has no GitHub ssh key.`,
    );
  }

  console.log(green(`✓ cloned ${want}`));
  describeCheckout(after);
  // Nothing else is run for you — no `npm ci`, no install. Said out loud,
  // because a clone that silently starts a five-minute install is a clone you
  // cannot use to go and look at something.
  const envNote = dest === REMOTE_REPO() ? "" : `   # note: writes to ${REMOTE_REPO()}, not here`;
  console.log(dim("\nnext:"));
  console.log(dim(`  gjd-remote push-env${envNote}`));
  console.log(dim(`  gjd-remote shell -d ${dest}   then npm ci`));
}

/**
 * Tools the box must have, each exercised rather than merely located.
 *
 * `command -v jq` proves a file exists on PATH. Running it and checking what
 * came out proves the thing works — which is the difference that matters after
 * a rebuild installs a broken package or a half-extracted binary.
 */
const TOOLS: { name: string; run: string; want?: string }[] = [
  { name: "claude", run: "claude --version" },
  { name: "tmux", run: "tmux -V" },
  { name: "mosh-server", run: "mosh-server --version 2>&1" },
  { name: "node", run: "node --version" },
  { name: "google-chrome", run: "google-chrome --version" },
  { name: "gh", run: "gh --version" },
  { name: "jq", run: `echo '{"a":42}' | jq -r .a`, want: "42" },
  { name: "file", run: "file -b /bin/sh" },
  { name: "rg", run: "rg --count PATH /etc/environment" },
  { name: "unzip", run: "unzip -v" },
];

/** Did the tool run, and if not, what is the shortest true thing to say? */
function toolVerdict(
  tool: (typeof TOOLS)[number],
  got: { status: number; detail: string } | undefined,
): { ok: boolean; why: string } {
  if (!got) return { ok: false, why: "no answer from the box" };
  if (got.status === 127) return { ok: false, why: "not installed" };
  if (got.status !== 0) return { ok: false, why: `exit ${got.status}: ${got.detail}` };
  if (tool.want !== undefined && got.detail !== tool.want) {
    return { ok: false, why: `ran, but said '${got.detail}' where '${tool.want}' was expected` };
  }
  return { ok: true, why: got.detail };
}

/**
 * Is mosh usable from here?
 *
 * Three outcomes, not two. The probe needs a real terminal, and under an agent
 * or a pipe there isn't one — calling that a failure would make doctor
 * permanently red for every caller who cannot see a tty, so it is a named skip.
 */
function moshState(): { state: "ok" | "fail" | "skip"; note: string } {
  if (spawnSync("sh", ["-c", "command -v mosh"], { encoding: "utf8" }).status !== 0) {
    return { state: "fail", note: "not installed on THIS Mac (brew install mosh)" };
  }
  const probe = moshProbe();
  if (probe.ok) return { state: "ok", note: "" };
  if (!process.stdin.isTTY) return { state: "skip", note: "no terminal (run doctor from a shell to check it)" };
  // Say what happened rather than offering a theory. "UDP blocked?" was a
  // guess, and a guess in an error message gets believed.
  return { state: "fail", note: `installed both ends, but the probe failed: ${probe.detail}` };
}

/** name|exit|first line of output, one tool per line, in one round trip. */
function probeTools(): Map<string, { status: number; detail: string }> {
  const script = TOOLS.map(
    (t) =>
      `printf %s ${shq(`${t.name}|`)}; if out=$(${t.run} 2>&1); then st=0; else st=$?; fi; ` +
      `printf '%s|%s\\n' "$st" "$(printf %s "$out" | head -1)"`,
  ).join("\n");
  const out = new Map<string, { status: number; detail: string }>();
  for (const line of ssh(script, { check: false }).split("\n")) {
    const [name, status, ...rest] = line.split("|");
    if (!name) continue;
    out.set(name, { status: Number(status), detail: rest.join("|").trim() });
  }
  return out;
}

/**
 * Everything that can be checked from here, in one command — because Claude
 * Code's own shell cannot reach port 22, so an agent cannot run any of this
 * itself. Run `gjd-remote doctor` and paste the output.
 *
 * It EXITS NON-ZERO if anything failed. It printed red crosses and exited 0
 * until 2026-08-31, which made every "doctor is green" claim worth nothing —
 * including the one at the end of the rebuild drill this command exists for.
 *
 * And it asserts, positively, that every check it means to run actually ran.
 * A doctor that quietly ran nothing at all otherwise looks exactly like a pass.
 */
function cmdDoctor(): void {
  const ip = host();
  console.log(bold(`gjd-remote → ${ip}`));

  // Every name here must be recorded exactly once before the run ends. The
  // count is derived from this list rather than written down, so adding a check
  // cannot leave the two out of step.
  const EXPECTED = ["ssh", "mosh", ...TOOLS.map((t) => t.name), "browser", "provisioning"];
  const seen = new Map<string, "ok" | "fail" | "skip">();
  const record = (name: string, state: "ok" | "fail" | "skip") => {
    if (seen.has(name)) die(`doctor recorded '${name}' twice — that is a bug in doctor, not in the box`);
    seen.set(name, state);
  };
  /** Everything that can fail ends up here, so nothing is reported by print
   *  alone. A red cross that does not reach the exit code is decoration. */
  const check = (name: string, ok: boolean, note = "") => {
    record(name, ok ? "ok" : "fail");
    console.log((ok ? green(`✓ ${name}`) : red(`✗ ${name}`)) + (note ? dim(`  ${note}`) : ""));
  };

  const finish = (): never => {
    const missing = EXPECTED.filter((n) => !seen.has(n));
    const failed = [...seen].filter(([, s]) => s === "fail").map(([n]) => n);
    const skipped = [...seen].filter(([, s]) => s === "skip").map(([n]) => n);
    console.log("");
    if (missing.length) {
      // The positive assertion. A doctor that ran nothing at all otherwise
      // prints a clean screen and exits 0, which is the worst possible pass.
      const n = missing.length;
      console.log(red(`✗ ${n} check${n === 1 ? "" : "s"} never ran: ${missing.join(", ")}`));
    }
    if (failed.length) console.log(red(`✗ ${failed.length} of ${EXPECTED.length} checks failed: ${failed.join(", ")}`));
    if (skipped.length) console.log(dim(`  skipped: ${skipped.join(", ")}`));
    if (!missing.length && !failed.length) {
      console.log(green(`✓ ${seen.size - skipped.length} of ${EXPECTED.length} checks passed`));
    }
    process.exit(missing.length || failed.length ? 1 : 0);
  };

  const reach = spawnSync("ssh", [...SSH_OPTS, HOST(), "true"], { encoding: "utf8" });
  if (reach.status !== 0) {
    const err = reach.stderr ?? "";
    // A rebuild puts a NEW machine on the OLD address, so the host key changes
    // and ssh refuses with a wall of asterisks about a possible attack. It is
    // alarming, it is expected here, and the fix is one command — but only ever
    // run it when YOU just rebuilt the box.
    if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(err)) {
      console.log(red("✗ ssh: the host key changed"));
      console.log(dim("  expected after a rebuild — a new machine on the same address."));
      console.log(dim("  if you just rebuilt:  gjd-remote forget-key"));
    } else {
      console.log(red("✗ ssh: cannot connect"));
      console.log(dim("  still booting? `hcloud server list` shows its state"));
      console.log(dim(`  ${err.trim().split("\n").slice(-2).join(" ")}`));
    }
    // Nothing below this line can run without ssh, so the rest is genuinely
    // unknown rather than fine — finish() says so and exits non-zero.
    record("ssh", "fail");
    finish();
  }
  check("ssh", true);

  const mosh = moshState();
  if (mosh.state === "skip") {
    record("mosh", "skip");
    console.log(dim(`· mosh  not probed: ${mosh.note}`));
  } else {
    check("mosh", mosh.state === "ok", mosh.note);
  }

  const probes = probeTools();
  for (const tool of TOOLS) {
    const verdict = toolVerdict(tool, probes.get(tool.name));
    check(tool.name, verdict.ok, verdict.why);
  }

  const smoke = runBrowserSmoke();
  check("browser", smoke.ok, smoke.detail);

  // cloud-init's own status is genuinely informational: it reports the FIRST
  // boot and never changes afterwards, so on a box that has been re-provisioned
  // since, it is history rather than news.
  const status = ssh(`cloud-init status 2>/dev/null; true`, { check: false });
  const word = /status:\s*(\S+)/.exec(status)?.[1] ?? "unknown";
  console.log(dim(`\ncloud-init: ${word} ${dim("(first boot only — see provisioning below)")}`));

  // Provisioning IS a check, and it reads the status file that provision.sh
  // rewrites on every run — not /var/log/provision.log, which cloud-init tees
  // once at build time and never touches again.
  //
  // This used to be informational, with a comment saying its two FAIL lines were
  // a false alarm. They were: `grep -q` was killing `sshd -T` with SIGPIPE and
  // pipefail was reporting the corpse (docs/postmortems/260831f-the-match-that-still-failed.md).
  // But "known false alarm" is not a state a check may sit in — it is how a
  // report stops being read. The bug is fixed, so this counts again.
  const report = ssh(`sudo cat /var/log/gjd-provision-status 2>/dev/null || true`, { check: false });
  const ranAt = /^ran:\s*(\S+)/m.exec(report)?.[1];
  const provisionOk = /^PROVISION OK$/m.test(report);
  const failedLines = report.split("\n").filter((l) => l.startsWith("FAIL"));
  check(
    "provisioning",
    provisionOk && failedLines.length === 0,
    report.trim() === ""
      ? "no status file — provision.sh has never completed on this box"
      : provisionOk && failedLines.length === 0
        ? `all checks ok, last run ${ranAt ?? "unknown"}`
        : `${failedLines.length} failed: ${failedLines.map((l) => l.replace(/^FAIL\s+/, "")).join(", ")}`,
  );
  if (failedLines.length) console.log(dim(report.trim()));

  const list = sessions();
  console.log(bold(`\nsessions: ${list.length}`));
  finish();
}

/**
 * Run the committed browser smoke test on the box.
 *
 * Copied on every run rather than trusted to be there. A stale copy is a check
 * that passes for a version of the script nobody has, and it would go on
 * passing after the real one broke.
 */
function runBrowserSmoke(): { ok: boolean; detail: string } {
  const local = path.join(REPO, "scripts/remote-smoke-browser.mjs");
  if (!existsSync(local)) return { ok: false, detail: `missing locally: ${local}` };
  const remote = `${REMOTE_WORK}/remote-smoke-browser.mjs`;
  ssh(`mkdir -p ${shq(REMOTE_WORK)}`);
  scpTo(local, remote);
  // Chrome starting, two page loads and two screenshots. 20s is the normal
  // shape; the cap is for a browser that has hung rather than failed.
  const r = spawnSync("ssh", [...SSH_OPTS, HOST(), `node ${shq(remote)}`], { encoding: "utf8", timeout: 120_000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").filter(Boolean);
  if (r.status === 0) return { ok: true, detail: out.at(-1)?.replace(/^ok\s+/, "") ?? "" };
  return { ok: false, detail: out.at(-1) ?? `no output (exit ${r.status}, signal ${r.signal})` };
}

// ---------------------------------------------------------------- main

const HELP = `${bold("gjd-remote")} — Claude Code sessions on a server that never sleeps

${bold("SESSIONS")}
  ls, (no args)           list sessions, each with Claude's own title for it
  new [name]              start Claude Code and attach
      -p, --prompt TEXT     give it a first prompt
      -d, --dir DIR         working directory on the box ${dim(`(default: ${REMOTE_REPO_DEFAULT})`)}
          --no-attach       create it, but stay here
  shell [name]            a persistent shell, no Claude Code
      -d, --dir DIR         working directory on the box ${dim(`(default: ${REMOTE_REPO_DEFAULT})`)}
  resume [name]           reattach; with no name, the most recent session
  kill <name>             end a session

${bold("THE BOX")}
  doctor                  check everything, and say what is wrong
                          exits non-zero if any check failed
  clone <repo>            clone one of Greg's repos onto the box, over HTTPS
      --base-folder DIR     where to put it ${dim(`(default: ${REMOTE_CODE})`)}
      --name DIR-NAME       directory name, if not the repo's own
  push-env                send .env.local to the repo checkout on the box
      --file PATH           a different .env.local — the basename must be exactly that
  ssh                     a throwaway connection — no tmux, dies with the terminal
  tunnel                  forward noVNC to http://localhost:6080/vnc.html
  forget-key              after a rebuild: accept the machine's new host key

${bold("WHAT push-env WILL AND WILL NOT SEND")}
  It BUILDS the file on the box from an allowlist of key names — it does not copy
  yours across. Anything not on the list is skipped and named in the output, so a
  new key stays on the laptop until somebody puts it on the list on purpose.
  ${dim("HETZNER_CLOUD_API_TOKEN")} (can delete this box) and ${dim("SUPABASE_ACCESS_TOKEN")} (can delete the
  production Supabase project) are deliberately off it. The list, and the reasons,
  are at the top of ${dim("scripts/gjd-remote-env.ts")}.
  It reports which KEYS changed. Never a value, and never a hash of one.

${bold("HOW clone AUTHENTICATES")}
  Always HTTPS, never ssh: the box has no GitHub ssh key. It has a fine-grained
  PAT per repository OWNER in ${dim(`${TOKEN_DIR}/<owner>.token`)}, picked by a git
  credential helper that reads the owner out of the URL — which it can only do
  when the URL is https. An owner with no token file is refused here, by name,
  before git runs; git's own error for it says only "could not read Username".
  Issuing the tokens is a ceremony in ${dim("infra/hetzner/README.md")}.

${bold("WHERE A SESSION STARTS")}
  ${dim("new")} and ${dim("shell")} begin in the repo checkout, not the home directory: an agent
  that starts in ~ opens by guessing which tree to edit. Most specific wins —
  ${dim("--dir")}, else ${dim("GJD_REMOTE_REPO")}, else ${dim(REMOTE_REPO_DEFAULT)} — and whichever it
  is, it is printed. ${dim("-d ~")} for the home directory.
  The directory must already exist on the box; there is no fallback, because the
  fallback was a healthy-looking session in ${dim("/home/greg")} editing the wrong thing.

${bold("ANYWHERE")}
  --ssh                   skip mosh, for satellite or UDP-blocked networks

${bold("WHAT SURVIVES WHAT")}
  laptop sleeps, roams, loses wifi     mosh reconnects; do nothing
  laptop reboots, terminal dies        tmux kept it — ${dim("gjd-remote resume")}
  the server reboots                   nothing does; ${dim("claude --resume")} by hand

${bold("EXAMPLES")}
  gjd-remote new -p "fix the ToC ordering bug"
      ${dim(`gjd-remote new s-0831-1712 → greg@1.2.3.4:${REMOTE_REPO_DEFAULT}`)}
      ${dim("✓ started 's-0831-1712' with a prompt")}
      already in the checkout, and named after whatever Claude decides the work is
  gjd-remote new -d ~/code/gjdutils
      an unnamed session in a different repo; it takes a name once Claude has a title
  gjd-remote shell
      a plain shell that is still running tomorrow
  gjd-remote resume --ssh
      back into the most recent session, without trying mosh first
  gjd-remote clone gregdetre/gjdutils
      ${dim(`gjd-remote clone gregdetre/gjdutils → greg@1.2.3.4:${REMOTE_CODE}/gjdutils`)}
      ${dim("✓ cloned gregdetre/gjdutils")}
      ${dim("  remote  https://github.com/gregdetre/gjdutils.git")}
      ${dim("  branch  main")}
      ${dim("  HEAD    Add a --json flag to the export script")}
  gjd-remote clone spideryarn/reading2 --name spideryarn2
      the repo is ${dim("reading2")} and its checkout is ${dim("spideryarn2")}. Without --name you are
      told it is already on the box under another name, rather than given a second copy
  gjd-remote push-env
      ${dim(`gjd-remote push-env → greg@1.2.3.4:${REMOTE_REPO_DEFAULT}/.env.local`)}
      ${dim("  + OPENROUTER_API_KEY  added")}
      ${dim("  ~ DATABASE_URL  changed")}
      ${dim("  = 10 unchanged")}
      ${dim("  skipped 2 keys not on the allowlist: HETZNER_CLOUD_API_TOKEN, SUPABASE_ACCESS_TOKEN")}
      ${dim("✓ 12 keys, 0600 greg, read back and verified")}

${bold("ENVIRONMENT")}
  GJD_REMOTE_HOST         override the address (default: read from Terraform state,
                          so it is never stale after a rebuild)
  GJD_REMOTE_TRANSPORT    ssh | mosh | auto (default: auto, which probes mosh once)
  GJD_REMOTE_REPO         where the checkout lives on the box — where push-env
                          writes, and where new/shell start without a --dir
                          (default: ${REMOTE_REPO_DEFAULT})

Names are optional everywhere. An unnamed session starts under a placeholder and
adopts Claude Code's own title for the work at the next ${dim("gjd-remote ls")}. A name you
choose is never changed for you.`;

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case undefined:
    case "ls":
    case "list":
      return cmdLs();

    case "new": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          prompt: { type: "string", short: "p" },
          dir: { type: "string", short: "d" },
          "no-attach": { type: "boolean", default: false },
          ssh: { type: "boolean", default: false },
        },
      });
      return cmdNew(positionals[0], {
        prompt: values.prompt,
        dir: values.dir,
        attach: !values["no-attach"],
        transport: values.ssh ? "ssh" : undefined,
      });
    }

    case "resume":
    case "attach": {
      const live = sessions();
      // `tmux ls` order is not a newest-first contract, so sort explicitly.
      const newest = [...live].sort((a, b) => a.created.getTime() - b.created.getTime()).at(-1);
      const name = rest.find((a) => !a.startsWith("-")) ?? newest?.name;
      if (!name) die("no sessions to attach to");
      if (!SLUG.test(name)) die(`'${name}' is not a valid session name`);
      // Without this, a typo'd name lands you in a login shell that looks
      // exactly like a successful attach until you wonder where your work went.
      if (!live.some((x) => x.name === name)) {
        die(`no session '${name}'. Live: ${live.map((x) => x.name).join(", ") || "none"}`);
      }
      return attach(name, rest.includes("--ssh") ? "ssh" : undefined);
    }

    case "kill": {
      const name = rest[0];
      if (!name || !SLUG.test(name)) die("gjd-remote kill <name>");
      ssh(`tmux kill-session -t =${name}`);
      console.log(green(`✓ killed '${name}'`));
      return;
    }

    case "shell": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { dir: { type: "string", short: "d" }, ssh: { type: "boolean", default: false } },
      });
      return cmdShell(positionals[0], {
        dir: values.dir,
        transport: values.ssh ? "ssh" : undefined,
      });
    }

    case "doctor":
      return cmdDoctor();

    case "push-env": {
      const { values } = parseArgs({ args: rest, options: { file: { type: "string" } } });
      return cmdPushEnv({ file: values.file });
    }

    case "clone": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          "base-folder": { type: "string" },
          name: { type: "string" },
        },
      });
      return cmdClone(positionals[0], { baseFolder: values["base-folder"], name: values.name });
    }

    case "forget-key": {
      // A rebuild puts a new machine on the old address, so ssh refuses with a
      // warning about a possible attack. That warning is correct and worth
      // keeping — accept-new deliberately does NOT auto-accept a changed key.
      // This makes clearing it one deliberate word instead of a remembered
      // incantation, without ever doing it behind your back.
      const ip = host();
      const r = spawnSync("ssh-keygen", ["-R", ip], { encoding: "utf8" });
      if (r.status !== 0) die(`ssh-keygen -R failed: ${(r.stderr || "").trim()}`);
      console.log(green(`✓ forgot the old host key for ${ip}`));
      console.log(dim("  the next connection will accept the new one"));
      return;
    }

    case "ssh":
      process.exit(spawnSync("ssh", ["-t", HOST()], { stdio: "inherit" }).status ?? 0);

    case "tunnel":
      console.log(dim("open http://localhost:6080/vnc.html — and run `start-vnc` on the box"));
      process.exit(
        spawnSync("ssh", ["-L", "6080:localhost:6080", HOST()], { stdio: "inherit" }).status ?? 0,
      );

    case "-h":
    case "--help":
    case "help":
      return console.log(HELP);

    default: {
      const known = ["ls", "new", "shell", "resume", "kill", "doctor", "clone", "push-env", "ssh", "tunnel", "forget-key"];
      const near = known.filter((k) => k.startsWith(cmd.slice(0, 2)) || cmd.startsWith(k.slice(0, 2)));
      die(
        `unknown command '${cmd}'` +
          (near.length ? `\n  did you mean: ${near.join(", ")}?` : "") +
          `\n  gjd-remote --help  for the full list`,
      );
    }
  }
}

main();
```

### `scripts/gjd-remote-env.ts`

```
/**
 * What `gjd-remote push-env` is allowed to put on the box, and how it is
 * written. Pure functions only — no ssh, no filesystem — so the rule that
 * matters can be tested without a server: tests/gjd-remote-env.test.ts.
 *
 * Split out of scripts/gjd-remote.ts for exactly that reason. That file runs
 * main() on import, and an entrypoint guard is a bad thing to depend on.
 */
import { createHash } from "node:crypto";

/**
 * THE ALLOWLIST. Every key that may reach the box, named.
 *
 * An allowlist, not a blocklist, and the difference is the whole point: with a
 * blocklist the next secret Greg adds to `.env.local` travels to the box by
 * default, and nobody finds out. Here, a new key is skipped and reported until
 * somebody deliberately adds it to this list.
 *
 * What is on it: the local Supabase stack's fixed demo credentials, the Google
 * OAuth pair that only works against that local stack, and the model-provider
 * keys the pipeline needs to do anything at all.
 *
 * Deliberately NOT on it, and neither may be added without Greg saying so:
 *  - HETZNER_CLOUD_API_TOKEN — it can destroy this very box. A box that holds
 *    the credential for its own deletion is one bad agent away from gone.
 *  - SUPABASE_ACCESS_TOKEN — a Supabase *management* PAT. `.env.example` says
 *    in its own comment that it can create and delete projects, which includes
 *    the production one. Nothing on the box needs it; stage 4's Supabase MCP
 *    is pointed at the local stack and gets --read-only.
 *
 * The box is shared by many autonomous agents running as one user with
 * passwordless sudo, so "on the box" means "reachable by all of them".
 */
export const ALLOWLIST: readonly string[] = [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "DATABASE_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET",
];

/** Only this name, ever. See assertPushableName. */
export const ENV_BASENAME = ".env.local";

/**
 * Refuse anything that is not literally `.env.local`.
 *
 * This is a guard against an accident — a stray `--file ../.env.prod`, a
 * tab-completion that went one entry too far — not against someone determined
 * to copy a file to another name first. The allowlist above is what actually
 * stops a production credential travelling; this is the cheap outer fence.
 */
export function assertPushableName(basename: string): string | undefined {
  if (basename === ENV_BASENAME) return undefined;
  return (
    `refusing to push '${basename}' — push-env only ever copies ${ENV_BASENAME}.\n` +
    `  There is no flag for this. .env.prod holds production database credentials,\n` +
    `  and the box runs autonomous agents as one user with passwordless sudo.`
  );
}

/**
 * Key → value from a .env file's bytes.
 *
 * ONE parser, used for the laptop's file AND for reading the box's copy back.
 * Two parsers is how a diff quietly lies: each side agrees with itself, and the
 * value that crossed the seam is never the thing compared.
 *
 * A quoted value may run over several lines (a PEM key does). Consuming those
 * continuation lines matters more than getting the value exactly right — a
 * parser that stops at the newline goes on to read `-----END` as a key name and
 * invents entries that were never in the file.
 */
export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  // A byte-order mark would otherwise glue itself to the first key's name.
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m?.[1]) continue;
    const rest = m[2] ?? "";
    const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : "";
    if (!quote) {
      out.set(m[1], rest.trim());
      continue;
    }
    let body = rest.slice(1);
    let end = closingQuote(body, quote);
    while (end < 0 && i + 1 < lines.length) {
      body += `\n${lines[++i]}`;
      end = closingQuote(body, quote);
    }
    const raw = end < 0 ? body : body.slice(0, end);
    // Single quotes are literal, double quotes carry escapes — the same rule
    // serialiseEnv writes by, so a value survives the round trip unchanged.
    out.set(m[1], quote === "'" ? raw : unescapeDouble(raw));
  }
  return out;
}

function closingQuote(body: string, quote: string): number {
  for (let j = 0; j < body.length; j++) {
    if (quote === '"' && body[j] === "\\") {
      j++;
      continue;
    }
    if (body[j] === quote) return j;
  }
  return -1;
}

function unescapeDouble(s: string): string {
  return s.replace(/\\(.)/g, (_, c: string) =>
    c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c,
  );
}

/** Bare where it is safe, double-quoted where it is not. The inverse of the
 *  double-quote branch of parseEnv, and the push verifies the round trip. */
export function serialiseValue(value: string): string {
  if (value !== "" && /^[A-Za-z0-9_@%+=:,./?&#~^*!$()[\]{}<>|;-]+$/.test(value)) return value;
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
  return `"${escaped}"`;
}

export type EnvPayload = {
  /** The exact bytes to write on the box. */
  text: string;
  /** Allowlisted keys that were present locally, in allowlist order. */
  pushed: Map<string, string>;
  /** Present locally, not on the allowlist — reported, never sent. */
  skipped: string[];
  /** On the allowlist, absent locally — reported, because a missing key is
   *  usually a laptop that has drifted rather than a deliberate omission. */
  missing: string[];
};

export function buildEnvPayload(localText: string): EnvPayload {
  const local = parseEnv(localText);
  const allowed = new Set(ALLOWLIST);
  const pushed = new Map<string, string>();
  const missing: string[] = [];
  for (const key of ALLOWLIST) {
    const value = local.get(key);
    if (value === undefined) missing.push(key);
    else pushed.set(key, value);
  }
  const skipped = [...local.keys()].filter((k) => !allowed.has(k)).sort();

  // No timestamp in the banner: it would make every push a change even when
  // nothing changed, and the file's mtime already says when.
  const header = [
    `# Written by \`gjd-remote push-env\` from the laptop's ${ENV_BASENAME}.`,
    `# Only the keys on the allowlist in scripts/gjd-remote-env.ts are here —`,
    `# production credentials are deliberately absent. Edits made on the box are`,
    `# overwritten by the next push.`,
    ``,
  ];
  const body = [...pushed].map(([k, v]) => `${k}=${serialiseValue(v)}`);
  return { text: `${[...header, ...body].join("\n")}\n`, pushed, skipped, missing };
}

/** Compared, never printed. A short value would not survive being shown as a
 *  hash, so no hash is ever shown — only key names are. */
export function valueHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export type KeyDiff = { added: string[]; removed: string[]; changed: string[]; unchanged: number };

/** What changed between what is on the box and what we are about to send —
 *  by KEY NAME only. */
export function diffKeys(before: Map<string, string>, after: Map<string, string>): KeyDiff {
  const added: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  for (const [k, v] of after) {
    const old = before.get(k);
    if (old === undefined) added.push(k);
    else if (valueHash(old) !== valueHash(v)) changed.push(k);
    else unchanged++;
  }
  const removed = [...before.keys()].filter((k) => !after.has(k));
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort(), unchanged };
}
```

### `infra/hetzner/github-owner-credential-helper.sh`

```
#!/bin/sh
# Git credential helper: pick a GitHub token by repository owner.
#
# WHY THIS EXISTS, AND WHY NOT THE TWO OBVIOUS ALTERNATIVES.
#
# A GitHub fine-grained PAT has exactly one resource owner, so the box's repos --
# four under the `spideryarn` org and three under `gregdetre` -- cannot share one
# token. Something has to choose per repository.
#
# Not `GH_TOKEN` in a shell profile: `gjd-remote` starts each agent through a
# non-interactive ssh command, which sources neither .bashrc nor .bash_profile.
# An exported token works when a human tests it in a login shell and is absent
# inside every actual agent session -- a difference that would not show up until
# an unattended push failed at 3am.
#
# Not per-owner `credential.<url>.helper` config sections: they do match on a path
# prefix on git 2.50.0, but gitcredentials(5) says a path in the pattern "must
# match exactly", so that behaviour is undocumented and could change under a git
# upgrade. Worse, matching sections are tried in config-file order rather than
# most-specific-first, so a broader section added above a narrower one silently
# shadows it. This helper uses only the uncontested rule -- a host-only pattern
# always applies -- and does the owner routing itself, where it can be tested.
#
# Install (see infra/hetzner/README.md):
#   git config --global credential.useHttpPath true
#   git config --global credential.https://github.com.helper /usr/local/bin/github-owner-credential-helper.sh
#
# Tokens: one file per owner, named <owner>.token, mode 0600, in $GITHUB_OWNER_TOKEN_DIR
# (default /etc/github-tokens, mode 0700). Adding a repo under an owner that
# already has a token needs no change here at all -- add it to the token's
# repository list on github.com. Adding a new owner is one new file.
set -eu

TOKEN_DIR="${GITHUB_OWNER_TOKEN_DIR:-/etc/github-tokens}"
ACTION="${1:-}"

# Drain stdin unconditionally and before branching. A helper that exits without
# reading leaves git writing into a closed pipe.
host=""
path=""
while IFS='=' read -r key value; do
  [ -z "$key" ] && continue
  case "$key" in
    host) host="$value" ;;
    path) path="$value" ;;
    *) ;;
  esac
done

case "$ACTION" in
  # This helper only reads. `store` and `erase` must still exit 0 -- git treats a
  # non-zero status as an error even though it ignores the output.
  store|erase) exit 0 ;;
  get) ;;
  *) echo "github-owner-credential-helper: unknown action '$ACTION'" >&2; exit 1 ;;
esac

if [ "$host" != "github.com" ]; then
  echo "github-owner-credential-helper: refusing non-github.com host '$host'" >&2
  exit 1
fi

# `path` arrives as `<owner>/<repo>.git`, and only when credential.useHttpPath is
# on. If it is off, git sends no path at all, owner is empty, and we refuse --
# which is the right answer, because guessing an owner would mean sending one
# repo's token to another repo's host.
owner="${path%%/*}"
if [ -z "$owner" ]; then
  echo "github-owner-credential-helper: no owner in path '$path' -- is credential.useHttpPath set?" >&2
  exit 1
fi

token_file="$TOKEN_DIR/$owner.token"
if [ ! -f "$token_file" ]; then
  echo "github-owner-credential-helper: no token for owner '$owner' (looked for $token_file)" >&2
  exit 1
fi

token=$(tr -d '\n\r \t' < "$token_file")
if [ -z "$token" ]; then
  echo "github-owner-credential-helper: $token_file is empty" >&2
  exit 1
fi

# GitHub validates the token, not the username, so any non-empty string works --
# but note that `x-access-token` is only *documented* for GitHub App installation
# tokens, not for fine-grained PATs. It is the conventional choice and is expected
# to work. If a real `git ls-remote` ever comes back 403 while the token itself is
# good, this line is the first thing to try changing (to the owner's GitHub
# username). The first real clone in bootstrap is what proves it either way.
echo "username=x-access-token"
echo "password=$token"
```

### `scripts/remote-smoke-browser.mjs`

```
#!/usr/bin/env node
/**
 * Does the browser stack on the remote box actually work?
 *
 * Runs ON THE BOX (`gjd-remote doctor` copies it there and runs it; you can also
 * run it by hand over `gjd-remote ssh`). It serves two pages from a Node server
 * on 127.0.0.1, drives them with Playwright, and asserts on the values it reads
 * back — not merely that nothing threw.
 *
 * Three things here are load-bearing, and each is a way this check could have
 * passed while the stack was broken:
 *
 *  1. executablePath is SYSTEM Chrome, never the bundled chromium.
 *     ~/.cache/ms-playwright/chromium-1234 was downloaded by @playwright/mcp.
 *     A project that installs its own playwright pins a different build number
 *     and dies with "Executable doesn't exist" — so a smoke test that used the
 *     bundled browser would be testing a browser nothing else uses.
 *  2. It asserts the text BEFORE and AFTER the click, and that they differ.
 *     "no exception was thrown" is true of a page that never loaded.
 *  3. It screenshots two visually different pages and requires the bytes to
 *     differ. A headless browser that renders blank produces a perfectly valid
 *     PNG of the right size every time — magic bytes and dimensions alone
 *     cannot tell you anything rendered.
 *
 * No dependency beyond playwright-core, which must already be on the box; see
 * PLAYWRIGHT_ROOTS below for where it is looked for and what to do if it is not
 * found.
 */
import http from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** System Chrome. Override only to prove this script can fail. */
const CHROME = process.env.GJD_SMOKE_CHROME ?? "/usr/bin/google-chrome-stable";

/** Explicit, because the whole point of check 3 is to compare against a number
 *  we asked for rather than whatever came back. */
const VIEWPORT = { width: 1024, height: 640 };

/**
 * Where playwright-core might live on the box, best first. There is no global
 * install and this script deliberately installs nothing, so it borrows one:
 * the repo checkout once it exists, otherwise whatever the MCPs pulled into the
 * npx cache. GJD_SMOKE_PLAYWRIGHT overrides the lot.
 */
const PLAYWRIGHT_ROOTS = () => {
  const home = homedir();
  const roots = [];
  if (process.env.GJD_SMOKE_PLAYWRIGHT) roots.push(process.env.GJD_SMOKE_PLAYWRIGHT);
  roots.push(path.join(home, "code/spideryarn2"), process.cwd(), path.join(home, "smoke"));
  const npx = path.join(home, ".npm/_npx");
  try {
    for (const d of readdirSync(npx)) roots.push(path.join(npx, d));
  } catch {
    // no npx cache; the other roots still stand
  }
  return roots;
};

// ---------------------------------------------------------------- assertions

/** Named so a failure says WHICH check broke, not just that something did. */
class SmokeError extends Error {
  constructor(check, detail) {
    super(detail);
    this.check = check;
  }
}

function assert(check, ok, detail) {
  if (!ok) throw new SmokeError(check, detail);
}

/** PNG header: 8 magic bytes, then a length, then "IHDR", then w and h. */
function pngDims(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ---------------------------------------------------------------- the pages

/** Ordinary page: reads one way, then another after you click. */
const PAGE_A = `<!doctype html><meta charset="utf-8"><title>A</title>
<style>body{background:#fff;color:#111;font:48px system-ui;margin:0;padding:40px}</style>
<h1 id="t">Localhost app OK</h1>
<button id="b" onclick="document.getElementById('t').textContent='CLICKED'">go</button>`;

/** Deliberately unlike page A at every pixel — inverted, and full-bleed, so two
 *  blank renders cannot pass for two different ones. */
const PAGE_B = `<!doctype html><meta charset="utf-8"><title>B</title>
<style>body{background:#101820;color:#ffd400;font:64px system-ui;margin:0;padding:0}
div{height:100vh;display:flex;align-items:center;justify-content:center}</style>
<div>SECOND PAGE</div>`;

const TEXT_BEFORE = "Localhost app OK";
const TEXT_AFTER = "CLICKED";
const TEXT_B = "SECOND PAGE";

// ---------------------------------------------------------------- run

async function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const roots = PLAYWRIGHT_ROOTS();
  let resolved;
  for (const name of ["playwright-core", "playwright"]) {
    try {
      resolved = req.resolve(name, { paths: roots });
      break;
    } catch {
      // try the next name
    }
  }
  assert(
    "playwright-resolve",
    resolved,
    `playwright-core not found. Looked under: ${roots.join(", ")}\n` +
      `  Fix by installing it somewhere on that list, e.g.\n` +
      `    npm --prefix ~/code/spideryarn2 install\n` +
      `  or point GJD_SMOKE_PLAYWRIGHT at a directory whose node_modules has it.`,
  );
  const mod = await import(pathToFileURL(resolved).href);
  const pw = mod.chromium ? mod : mod.default;
  assert("playwright-resolve", pw?.chromium, `${resolved} exports no chromium`);
  return { chromium: pw.chromium, resolved };
}

async function main() {
  const { chromium, resolved } = await loadPlaywright();

  // Ephemeral port. A fixed one collides with whatever else the box's agents
  // are running, and that collision would read as a browser failure.
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(req.url === "/b" ? PAGE_B : PAGE_A);
  });
  let browser;
  try {
    const port = await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    });
    assert("server-listening", Number.isInteger(port) && port > 0, `got port ${port}`);
    const base = `http://127.0.0.1:${port}`;

    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: CHROME,
        // The box runs as an unprivileged user with no user namespaces to
        // spare; Chrome's sandbox cannot start and the launch fails without
        // this.
        args: ["--no-sandbox"],
      });
    } catch (err) {
      throw new SmokeError("browser-launch", `${CHROME}: ${err.message.split("\n")[0]}`);
    }
    const page = await browser.newPage({ viewport: VIEWPORT });

    const response = await page.goto(`${base}/a`, { waitUntil: "load" });
    assert("navigate", response?.ok(), `GET ${base}/a → ${response?.status() ?? "no response"}`);

    const before = (await page.textContent("#t"))?.trim();
    assert("text-before", before === TEXT_BEFORE, `#t was ${JSON.stringify(before)}, expected ${JSON.stringify(TEXT_BEFORE)}`);

    await page.click("#b");
    const after = (await page.textContent("#t"))?.trim();
    assert("click-changed", after !== before, `#t is still ${JSON.stringify(after)} after clicking #b`);
    assert("click-changed", after === TEXT_AFTER, `#t became ${JSON.stringify(after)}, expected ${JSON.stringify(TEXT_AFTER)}`);

    const shotA = await page.screenshot();
    assert(
      "png-magic",
      shotA.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
      `screenshot starts ${shotA.subarray(0, 8).toString("hex")}, not a PNG`,
    );
    const dims = pngDims(shotA);
    assert("png-dimensions", dims.width > 0 && dims.height > 0, `IHDR says ${dims.width}x${dims.height}`);
    assert(
      "png-dimensions",
      dims.width === VIEWPORT.width && dims.height === VIEWPORT.height,
      `IHDR says ${dims.width}x${dims.height}, asked for ${VIEWPORT.width}x${VIEWPORT.height}`,
    );

    const responseB = await page.goto(`${base}/b`, { waitUntil: "load" });
    assert("navigate-b", responseB?.ok(), `GET ${base}/b → ${responseB?.status() ?? "no response"}`);
    // Not decoration: without it, a server that hands back page A for every URL
    // still produces two different PNGs (A is mid-click by now), and the
    // differ check below would pass while nothing was being compared.
    // "body", not the div: textContent auto-waits for its selector, so a
    // selector only page B has would spend 30s timing out and then report
    // itself as an unexpected error rather than as this check.
    const textB = (await page.textContent("body"))?.replace(/\s+/g, " ").trim();
    assert("navigate-b", textB?.includes(TEXT_B), `second page reads ${JSON.stringify(textB)}, expected it to contain ${JSON.stringify(TEXT_B)}`);

    const shotB = await page.screenshot();
    assert(
      "png-magic",
      shotB.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
      `second screenshot starts ${shotB.subarray(0, 8).toString("hex")}, not a PNG`,
    );
    assert(
      "screenshots-differ",
      !shotA.equals(shotB),
      `two visually different pages produced byte-identical PNGs (${shotA.length} bytes) — the browser is rendering nothing`,
    );

    const version = browser.version();
    console.log(
      `ok  chrome ${version} via ${CHROME}, playwright-core ${path.relative(homedir(), resolved) || resolved}: ` +
        `"${before}" → "${after}", 2 distinct ${dims.width}x${dims.height} PNGs (${shotA.length}/${shotB.length} bytes)`,
    );
  } finally {
    // Both paths. A leaked Chrome on a box running many agents is not a small
    // mess, and a listening server survives long enough to break the next run.
    await browser?.close().catch(() => {});
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

try {
  await main();
  process.exit(0);
} catch (err) {
  const check = err instanceof SmokeError ? err.check : "unexpected";
  console.error(`FAIL [${check}] ${err.message}`);
  process.exit(1);
}
```
