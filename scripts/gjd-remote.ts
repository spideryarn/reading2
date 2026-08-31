#!/usr/bin/env -S npx tsx
/**
 * `gjd-remote` — drive Claude Code sessions running in tmux on the Hetzner server.
 *
 * The design, and the reasons behind each piece, are in
 * docs/research/remote-server-tmux-mosh.md. The short version: one tmux session
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

/** Where the repo checkout lives on the box. Overridable so the push can be
 *  exercised against a scratch directory without a real checkout. */
const REMOTE_REPO = () => process.env.GJD_REMOTE_REPO ?? `/home/${USER}/code/spideryarn2`;

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

  const dir = opts.dir ?? `/home/${USER}`;
  // A newline in dir could otherwise close the remote heredoc early. The job
  // file is scp'd rather than heredoc'd now, which removes that boundary
  // entirely, but a dir with control characters is a mistake either way.
  if (/[\r\n]/.test(dir)) die("--dir may not contain newlines");
  // cd failing must not silently start Claude in the wrong tree.
  const dirOk = spawnSync("ssh", [...SSH_OPTS, HOST(), `test -d ${shq(dir)}`]).status === 0;
  if (!dirOk) die(`no such directory on the box: ${dir}`);

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
    `cd ${shq(dir)} || { echo "FATAL: cannot cd to ${dir}"; exec bash -l; }`,
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

  const dir = opts.dir ?? `/home/${USER}`;
  if (/[\r\n]/.test(dir)) die("--dir may not contain newlines");
  if (spawnSync("ssh", [...SSH_OPTS, HOST(), `test -d ${shq(dir)}`]).status !== 0) {
    die(`no such directory on the box: ${dir}`);
  }

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
  // pipefail was reporting the corpse (docs/postmortems/the-match-that-still-failed.md).
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
      -d, --dir DIR         working directory on the box
          --no-attach       create it, but stay here
  shell [name]            a persistent shell, no Claude Code
      -d, --dir DIR         working directory on the box
  resume [name]           reattach; with no name, the most recent session
  kill <name>             end a session

${bold("THE BOX")}
  doctor                  check everything, and say what is wrong
                          exits non-zero if any check failed
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

${bold("ANYWHERE")}
  --ssh                   skip mosh, for satellite or UDP-blocked networks

${bold("WHAT SURVIVES WHAT")}
  laptop sleeps, roams, loses wifi     mosh reconnects; do nothing
  laptop reboots, terminal dies        tmux kept it — ${dim("gjd-remote resume")}
  the server reboots                   nothing does; ${dim("claude --resume")} by hand

${bold("EXAMPLES")}
  gjd-remote new -p "fix the ToC ordering bug"
      starts a session, and names it after whatever Claude decides the work is
  gjd-remote new -d /home/greg/spideryarn2
      an unnamed session in a repo; it takes a name once Claude has a title
  gjd-remote shell
      a plain shell that is still running tomorrow
  gjd-remote resume --ssh
      back into the most recent session, without trying mosh first
  gjd-remote push-env
      ${dim("gjd-remote push-env → greg@1.2.3.4:/home/greg/code/spideryarn2/.env.local")}
      ${dim("  + OPENROUTER_API_KEY  added")}
      ${dim("  ~ DATABASE_URL  changed")}
      ${dim("  = 10 unchanged")}
      ${dim("  skipped 2 keys not on the allowlist: HETZNER_CLOUD_API_TOKEN, SUPABASE_ACCESS_TOKEN")}
      ${dim("✓ 12 keys, 0600 greg, read back and verified")}

${bold("ENVIRONMENT")}
  GJD_REMOTE_HOST         override the address (default: read from Terraform state,
                          so it is never stale after a rebuild)
  GJD_REMOTE_TRANSPORT    ssh | mosh | auto (default: auto, which probes mosh once)
  GJD_REMOTE_REPO         where the checkout lives on the box, for push-env
                          (default: /home/greg/code/spideryarn2)

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
      const known = ["ls", "new", "shell", "resume", "kill", "doctor", "push-env", "ssh", "tunnel", "forget-key"];
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
