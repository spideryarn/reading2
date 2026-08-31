# Review this plan before it is built

You are reviewing a planning doc for a small TypeScript CLI (`gjd-remote`) that drives Claude Code
sessions running in tmux on a Hetzner box, over ssh/mosh. Single user (Greg), macOS laptop →
Ubuntu 24.04 box, OpenSSH 9.6p1 on the server.

Be concrete and adversarial. I care most about:

1. **Is `ControlMaster`/`ControlPersist` the right call here, and what will it break?** This is a
   long-lived shared socket on a laptop that sleeps, changes networks, and talks to a box that gets
   rebuilt (new host key, same IP). What failure modes am I signing up for, and which of them look
   like something else? Specifically: stale sockets after a box rebuild or a network change, the
   macOS `sun_path` ~104-byte limit, `ControlPersist` holding the laptop awake or leaking fds,
   concurrent `gjd-remote` invocations racing to create the master, and whether `-o ControlMaster=auto`
   on a *non-interactive* invocation can wedge.

2. **Is passing the shared socket to mosh via `--ssh=` actually going to work?** mosh uses ssh only
   to bootstrap `mosh-server` and read back its port/key, then talks UDP. Does multiplexing help
   that at all, or am I optimising a part that isn't the cost? Note the measurement: a full mosh
   bootstrap is 6.0–6.8s while a fresh plain ssh is ~2.0s on the same link.

3. **The mosh double-bootstrap.** Every attach runs a throwaway `mosh HOST -- true` probe and then
   the real mosh connection — ~13s of the ~10–20s. The probe exists because mosh retries forever
   when UDP is blocked. Is there a cheaper honest probe (a bare UDP reachability check on mosh's
   port range? caching the answer per network? just running the real thing with a timeout and
   falling back?) — or is my decision to leave it alone for now the right one?

4. **Anything in the plan that is wrong, missing, or over-built.** In particular whether I should
   batch `cmdNew`'s 6–7 connections into one instead of, or as well as, multiplexing.

5. **The tmux fix.** Is `-t "=name:"` the correct and complete fix, or is there a better target
   syntax? Is there a tmux-version portability concern (box runs tmux 3.4)?

Push back on anything unjustified. If you think the whole approach is wrong, say so.

---

## The plan

# gjd-remote: SSH multiplexing, a stdin prompt, and the tmux target colon

## Goal, context

Greg asked for `gjd-remote new -p "…multi-line prose, possibly with double quotes…"`. That
already exists ([`scripts/gjd-remote.ts:387`](../../scripts/gjd-remote.ts)) and the prompt already
travels as a file, so quoting is safe past the local shell. What he actually noticed is the
**delay**:

> I note that it seems to take 10s or so just for `gjd-remote shell`.

So the work is three things, in order of value:

1. **Make `gjd-remote` fast.** Every subcommand opens several *fresh* SSH connections, and each one
   costs ~2s of handshake on a good link and 8–10s on a bad one.
2. **Fix a silent bug found while measuring.** `sessions()` builds its tmux target without the
   trailing colon, so every session's `AGE` and `ATT` column is wrong.
3. **Add `-p -`** so a prompt can come from stdin/heredoc, sidestepping local shell quoting
   entirely.

### The measurements

Taken 2026-08-31 against the live box (188.245.166.213), at a healthy 78ms RTT unless noted.

| what | measured | why |
|---|---|---|
| one fresh `ssh … true` | **~2.0s** | ~15 network round trips of handshake; the command is free |
| `gjd-remote ls` | **2.8s** | 1 connection + 0.4s tsx startup |
| `gjd-remote new --no-attach` | **12.3s** | 6 fresh connections |
| one mosh bootstrap | **6.0s, 6.8s** | measured twice through a real pty |
| 3 fresh connections | **5.12s** | the sequence `shell` runs before attaching |
| master handshake + 3 multiplexed | **2.80s + 1.21s** | same three commands over a shared socket |
| `scp` of a 3-byte file, fresh | **7.08s** | sftp handshake on top of the SSH handshake |

The link is jittery: within one minute `ping` reported RTT from 74ms to 660ms (stddev 217ms). At the
bad end a single connection took 8–10s and `ls` alone took 12.5s. The network is the multiplier; the
round-trip count is ours.

### Where `gjd-remote shell`'s ~10s goes

Five separate connections, three SSH and two mosh:

1. `sessions()` — [`scripts/gjd-remote.ts:271`](../../scripts/gjd-remote.ts)
2. `sessionDir()` — [`scripts/gjd-remote.ts:338`](../../scripts/gjd-remote.ts)
3. `tmux new-session` — [`scripts/gjd-remote.ts:490`](../../scripts/gjd-remote.ts)
4. `moshProbe()` — [`scripts/gjd-remote.ts:138`](../../scripts/gjd-remote.ts), a **complete mosh
   bootstrap whose result is thrown away**
5. the real mosh attach — the same bootstrap again

Step 4 is the single worst item. It answers "does mosh work on this network?" by doing the whole
expensive thing, so every attach pays the mosh bootstrap twice: ~13s of the ~10–20s total.

`new -p` is 7 SSH connections (the prompt adds an `scp`) plus probe plus attach — roughly 25s before
Claude's first token.

### The tmux bug

`sessions()` runs `tmux display -p -t "=$s" '#{session_created}|…'`. On the box (tmux 3.4) that
returns `||` — all three fields empty. With the colon, `-t "=$s:"`, it returns `1788192264|0|1`.
Verified on the live box 2026-08-31.

Two visible consequences:

- `AGE` is computed from `Number("") === 0`, i.e. the epoch, so every row reads `20696d`.
- `attached !== "0"` is **true** for `""`, so `ls` reports `ATT yes` for every session — including
  one created detached one second earlier.

This is the identical trap already written up in `attachCmd`'s own comment at
[`scripts/gjd-remote.ts:178`](../../scripts/gjd-remote.ts): `set-option -t` takes a target *pane*,
and the `=` exact-match prefix is only recognised on the session part when a colon follows. The
comment is 200 lines below the code that gets it wrong.

## References

- [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) — the whole surface. Key spots: `SSH_OPTS`
  (line 57), `ssh()` (107), `scpTo()` (118), `moshProbe()` (130), `attachCmd()` (171),
  `chooseTransport()` (203), `sessions()` (254), `sessionDir()` (335), `cmdNew()` (360),
  `cmdShell()` (475), `main()` (1163).
- [`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts) and
  [`tests/gjd-remote-env.test.ts`](../../tests/gjd-remote-env.test.ts) — the house pattern for this
  script: pure logic in a sibling module, tested against fixtures, never against the live box.
- [`docs/research/260831c-remote-server-tmux-mosh.md`](../research/260831c-remote-server-tmux-mosh.md)
  — why tmux + mosh at all.
- [`docs/plans/260831x-remote-box-dev-environment.md`](260831x-remote-box-dev-environment.md) — the
  plan this script came out of.
- [`docs/reusable/silent-success.md`](../reusable/silent-success.md) — the tmux bug is a textbook
  case: empty output parsed as a valid answer.

## Principles, key decisions

- **Fewer round trips beats a faster round trip.** We cannot fix the network. We can stop paying for
  the handshake six times per command.
- **Multiplexing first, batching later.** `ControlMaster` is a few lines in one constant and helps
  every subcommand at once. Collapsing `cmdNew`'s six connections into one heredoc is a real
  refactor of the code that starts sessions — more risk, less payoff per line. **Simplest version
  first**; batching is out of scope unless multiplexing disappoints.
- **The mosh probe stays for now.** Deleting it is tempting (it is the biggest single item), but it
  exists for a real reason recorded in the code: mosh retries forever when UDP is blocked, and a
  ferry's satellite link is the case that prompted it. Instead, hand mosh the shared SSH socket so
  the probe's *SSH* half becomes nearly free. Getting rid of the second bootstrap is a separate
  decision for Greg, not something to slip in.
- **Simpler option passed over:** telling Greg to set `GJD_REMOTE_TRANSPORT=ssh` and live with it.
  That trades away mosh's whole benefit (a session that survives a lid close) to fix a startup cost.
- **Test the pure parts, smoke-test the rest.** Multiplexing cannot be unit-tested without a
  network; the tmux format string can be, and that is the bug that actually shipped.

## Stages & actions

### Stage: the tmux target colon (the actual bug)

- [ ] Extract the tmux listing into pure functions in a new `scripts/gjd-remote-tmux.ts`:
      `SESSION_FORMAT` (or the whole remote script builder) and `parseSessionLine(line)`.
- [ ] **Write the failing test first** in `tests/gjd-remote-tmux.test.ts`: a line with empty
      `created`/`attached` fields must NOT parse as "attached, aged 20696d". Watch it go red.
- [ ] Add the colon to the `tmux display -p -t` target; make `parseSessionLine` reject a line whose
      `created` is not a positive integer rather than silently producing the epoch.
- [ ] Verify on the live box that `ls` now shows a real age and `ATT no` for a detached session.

### Stage: SSH connection multiplexing

- [ ] Add `ControlMaster=auto`, `ControlPath=<per-user socket in tmpdir>`, `ControlPersist=10m` to
      `SSH_OPTS` ([`scripts/gjd-remote.ts:57`](../../scripts/gjd-remote.ts)).
- [ ] Check the `ControlPath` length against the ~104-byte `sun_path` limit on macOS — a too-long
      path fails at connect time with a message that looks nothing like the cause.
- [ ] Pass the same socket to mosh via `--ssh="ssh -o ControlPath=… -o ControlMaster=auto"` in
      `attachCmd()` and `moshProbe()`.
- [ ] Decide and document what `forget-key` and a rebuilt box do to a stale socket — a persisting
      master to a dead host is a plausible new failure mode.
- [ ] Time `ls`, `shell` and `new` before and after, on the same link, and record the numbers here.

### Stage: `-p -` for a stdin prompt

- [ ] Read `process.stdin` to EOF when `--prompt` is exactly `-`; error clearly if stdin is a TTY
      (otherwise it hangs looking like a network stall).
- [ ] Keep everything downstream unchanged — the prompt already goes to a file.
- [ ] Add `gjd-remote new -p - <<'EOF' … EOF` to the help text's EXAMPLES.

### Stage: finish

- [ ] `npm test`, `npm run typecheck`, `npm run lint` on touched files, `npm run check`.
- [ ] Smoke test on the live box: `ls`, `new --no-attach`, `resume`, `kill`.
- [ ] Update `docs/project/` — the entry point that owns the remote box — with the timings and the
      multiplexing behaviour.
- [ ] Second GPT Sol review of the built code, weighted higher than this plan-stage one.

---

## The relevant code, as it stands today

### `SSH_OPTS`, `ssh()`, `scpTo()` — scripts/gjd-remote.ts:44-125
```typescript
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
```

### `moshProbe()`, `attachCmd()`, `chooseTransport()`, `attach()` — scripts/gjd-remote.ts:126-220
```typescript
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
  // Name the terminal tab after the session, and keep it named: `ls` renames a
  // placeholder session to Claude's own title for the work, and tmux pushes the
  // new title out to the attached client the moment that happens. Measured on
  // tmux 3.7b: `ESC]0;<name>BEL` on attach, and one more on each rename —
  // nothing in between, so this is not a per-frame cost.
  //
  //  =name:  with the COLON. `set-option -t` takes a target *pane*, and the `=`
  //          exact-match prefix is only recognised on the session part when a
  //          colon follows: `-t =name` fails with "no such session". Dropping
  //          the `=` instead would be worse than an error, because a bare
  //          target prefix-matches and would configure somebody else's session.
  //  "#S"    quoted, or `#` starts a comment to the remote shell.
  //
  // No `|| exec bash -l` here: a failed attach must fail. The job script keeps
  // the session alive after Claude exits, so nothing needs this as a safety net.
  const inner =
    `tmux set -t =${name}: set-titles on && ` +
    `tmux set -t =${name}: set-titles-string "#S" && ` +
    `tmux attach -d -t =${name}`;
  return transport === "mosh"
    ? // Without MOSH_TITLE_NOPREFIX every tab reads "[mosh] " before the name.
      `MOSH_TITLE_NOPREFIX=1 LANG=C.UTF-8 mosh ${shq(HOST())} -- sh -c ${shq(inner)}`
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
```

### `sessions()` — the tmux bug — scripts/gjd-remote.ts:254-290
```typescript
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
```

### `sessionDir()` — scripts/gjd-remote.ts:335-350
```typescript
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

```

### `cmdNew()` — the 6-7 connections — scripts/gjd-remote.ts:360-465
```typescript
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
```

### `cmdShell()` — scripts/gjd-remote.ts:475-495
```typescript
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
```

### argument parsing for `new` — scripts/gjd-remote.ts:1170-1192
```typescript
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
```

---

## House rules that constrain the answer

- Prefer boring, prefer simple over easy, simplest version first. No new dependencies without a
  reason worth writing down.
- TypeScript + ESM, run with `tsx`, `strict` and `noUncheckedIndexedAccess` on.
- Pure logic goes in a sibling module and gets unit tests (see `scripts/gjd-remote-env.ts` +
  `tests/gjd-remote-env.test.ts`); anything needing the network gets a manual smoke test instead.
- "A check you have never seen fail is not evidence" — reproduce a bug with a red test before fixing.

Answer with: your verdict on each of the five questions, then a list of concrete changes you would
make to the plan, most important first. Flag anything you are unsure about rather than guessing.
