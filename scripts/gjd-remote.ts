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
import { type StdioOptions, execFileSync, spawnSync } from "node:child_process";
import { parseArgs, styleText } from "node:util";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { constants, homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPushableName, buildEnvPayload, diffKeys, parseEnv } from "./gjd-remote-env.js";
import {
  type Session,
  bindingsVerdict,
  buildBindingsScript,
  buildSessionScript,
  parseSessions,
} from "./gjd-remote-tmux.js";
import { buildProvisionRunner, cloudInitVerdict, provisionVerdict } from "./gjd-remote-provision.js";
import { declaredServers, mcpVerdict } from "./gjd-remote-mcp.js";
import { parseDuration, sshInvocation, waitPreamble } from "./gjd-remote-run.js";
import {
  LOG_SCHEMA,
  type LogRecord,
  buildFactsScript,
  formatLine,
  logPath,
  parseFacts,
  parseLog,
  startMarkerCommand,
  verdict,
} from "./gjd-remote-log.js";
import {
  REMOTE_TAB_COLOUR,
  TAB_COLOUR_ENV,
  type Wanted,
  canColourTab,
  colourSequence,
  wantedColour,
} from "./gjd-remote-tab.js";
import {
  type Here,
  isSessionUuid,
  newTabScript,
  openTabsRefusal,
  parseHere,
  planTabs,
  resolveScript,
  resumeCommand,
  selectScript,
  selfSessionUuid,
} from "./gjd-remote-resume-all.js";

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

/**
 * Linux caps ONE argv string at 32 pages (128 KiB) and fails execve with E2BIG
 * past it. 96KB leaves room for the rest of the command line, and a prompt
 * anywhere near it is a mistake rather than a long instruction.
 */
const MAX_PROMPT_BYTES = 96 * 1024;

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
const SSH_OPTS_INTERACTIVE = ["-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"];

/**
 * BatchMode on top, for the calls nobody is sitting in front of. It turns a
 * passphrase prompt into a failure, which is right for a helper command and
 * wrong for a session you are about to type into — hence the two lists. The
 * interactive paths (`ssh`, `tunnel`, and the ssh fallback for `resume`) used
 * to pass NO options at all, so a rebuilt box gave them the raw
 * host-key-verification error the accept-new note above exists to avoid.
 */
const SSH_OPTS = ["-o", "BatchMode=yes", ...SSH_OPTS_INTERACTIVE];

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
let cachedHost: string | undefined;

function host(): string {
  // Memoised for the process. HOST() is called on every ssh, scp and mosh, and
  // `new-claude` makes six of those — six `tofu output` subprocesses to answer a
  // question whose answer cannot change while we run. It also means an address
  // that stays consistent across one command even if somebody rebuilds the box
  // underneath us, which is the behaviour you want when half the work is done.
  if (cachedHost) return cachedHost;
  if (process.env.GJD_REMOTE_HOST) {
    cachedHost = process.env.GJD_REMOTE_HOST;
    return cachedHost;
  }
  try {
    const out = execFileSync("tofu", ["-chdir=" + path.join(REPO, "infra/hetzner"), "output", "-json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ip = JSON.parse(out)?.ipv4?.value;
    if (!ip) throw new Error("no ipv4 output");
    cachedHost = ip as string;
    return cachedHost;
  } catch (err) {
    die(
      `could not read the server address from Terraform state (${(err as Error).message}).\n` +
        `  Run this from the repo, or set GJD_REMOTE_HOST=<ip> to override.`,
    );
  }
}

const HOST = () => `${USER}@${host()}`;

/**
 * One SSH connection, shared by every command this process runs.
 *
 * The handshake is the whole cost. Measured against the box on 2026-08-31 at a
 * healthy 78ms round trip: a fresh `ssh … true` takes ~2.0s, of which the
 * command itself is free — the rest is roughly fifteen network round trips of
 * key exchange and authentication. `gjd-remote new-claude` opened SIX fresh
 * connections and so paid it six times, 12.3s before Claude started. On a bad
 * link (RTT swung from 74ms to 660ms inside one minute) it was 8-10s each.
 *
 * So: start one master, run everything down it, tear it down when we are done.
 *
 * SCOPED TO THIS PROCESS, deliberately, and this is the decision worth
 * defending. The obvious alternative is `ControlPersist=10m`, which would also
 * make the NEXT `gjd-remote` instant. It buys a failure mode that is much worse
 * than the delay it removes: a master whose TCP connection has been blackholed
 * by a sleep or a network change still accepts the local mux handshake, and the
 * client then waits forever for a remote session that will never open —
 * `ConnectTimeout` does not bound that request. On a tool where every other
 * pause is the network, an infinite hang is indistinguishable from a slow link.
 * A master that dies with the command cannot outlive the network it was made
 * on. GPT Sol's review made this case; the plan doc records it.
 *
 * The path lives directly under /tmp because macOS caps a Unix socket path at
 * 104 bytes and $TMPDIR here is already 48 of them — and OpenSSH first binds
 * the master at `<path>.<16 random chars>`, so the limit applies to a name 17
 * bytes longer than the one written here.
 */
let masterSocket: string | undefined;
let masterDir: string | undefined;
/** Remembered, so a box that refuses a master is not asked six more times. */
let masterFailed = false;

function sshMasterOpts(): string[] {
  if (masterSocket) return ["-o", `ControlPath=${masterSocket}`];
  if (masterFailed) return [];
  // mkdtemp under /tmp, not tmpdir(): see the sun_path note above.
  const dir = mkdtempSync("/tmp/gjdr-");
  const sock = path.join(dir, "s");
  const r = spawnSync(
    "ssh",
    [
      ...SSH_OPTS,
      "-o",
      `ControlPath=${sock}`,
      // ConnectTimeout bounds the handshake and nothing after it: a network
      // that blackholes MID-COMMAND leaves later commands waiting on a mux
      // request with no timeout at all. These bound that to ~45s, which is a
      // wait you can attribute rather than one that never ends.
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      // The master's own dead-man's handle, and the only cleanup that actually
      // works when this command is interrupted. closeSshMaster() below covers
      // the ordinary exits; nothing in Node covers Ctrl-C, because a JS signal
      // handler cannot run while the process is blocked inside spawnSync, which
      // is where this command spends essentially all of its time. Measured:
      // SIGINT to a process sitting in spawnSync ran NEITHER the signal handler
      // NOR the "exit" handler — the process simply died, leaving `ssh -M -N -f`
      // behind. So the master is told to give up on its own 30 seconds after
      // its last client, and that bound holds however this process ends.
      //
      // ControlPersist cannot cause the reuse GPT Sol warned about, because the
      // socket path is a fresh mkdtemp per process: no later invocation can
      // find this master, poisoned or otherwise. It bounds an orphan's life; it
      // does not extend a healthy one.
      "-o",
      "ControlPersist=30",
      "-M",
      "-N",
      "-f",
      HOST(),
    ],
    { encoding: "utf8" },
  );
  // A master that would not start is not fatal — every command still works on
  // its own connection, just slowly. Failing here would turn a performance
  // optimisation into an outage.
  if (r.status !== 0) {
    masterFailed = true;
    rmSync(dir, { recursive: true, force: true });
    return [];
  }
  masterDir = dir;
  masterSocket = sock;
  return ["-o", `ControlPath=${sock}`];
}

/** Close the shared connection. Safe to call twice, and safe when none was opened. */
function closeSshMaster(): void {
  if (!masterSocket) return;
  spawnSync("ssh", ["-o", `ControlPath=${masterSocket}`, "-O", "exit", HOST()], { stdio: "ignore" });
  if (masterDir) rmSync(masterDir, { recursive: true, force: true });
  masterSocket = undefined;
  masterDir = undefined;
}

// The fast path, covering the ordinary return, the `process.exit()` inside
// die() and attach(), and an uncaught throw. spawnSync inside an exit listener
// is fine — synchronous work is the only kind an exit listener may do.
//
// There is deliberately NO signal handler here. One was written, and it did not
// work: a `process.on("SIGINT")` handler cannot run while the process is
// blocked inside spawnSync, and that is where this command spends essentially
// all of its time. A probe that installed both handlers and took SIGINT while
// blocked ran neither, and died leaving the master behind. Keeping the handler
// would have been cleanup code that looks like it runs and does not, which is
// worse than none. ControlPersist on the master above is what actually bounds
// this, because it does not depend on us being alive to do anything.
process.on("exit", closeSshMaster);

/**
 * Run a command on the box over ssh and return stdout.
 *
 * `raw` keeps the bytes exactly as they came back. Everything else here wants
 * the trim; reading a file to compare it against its source does not, because
 * the trim would quietly make two different files look identical.
 */
function ssh(remote: string, opts: { check?: boolean; raw?: boolean } = {}): string {
  const r = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), remote], { encoding: "utf8" });
  if (opts.check !== false && r.status !== 0) {
    die(`ssh failed (${r.status}): ${(r.stderr || "").trim() || "no output"}`);
  }
  const out = r.stdout || "";
  return opts.raw ? out : out.trim();
}

/**
 * Put text on the box, in one round trip, and prove it arrived whole.
 *
 * `scp` was the obvious choice and is the slow one: measured over an ALREADY
 * SHARED connection on 2026-08-31, an scp of a 3-byte file took 3.87s against
 * ~1.0s for a plain command, because the sftp subsystem does its own handshake
 * on top. `new-claude -p` did two of them.
 *
 * The content goes down the command's stdin instead, so there is no local temp
 * file, no second protocol, and no quoting — the bytes never touch a command
 * line. Everything the file needs doing to it rides the same connection.
 *
 * The byte count is the part not to drop. `cat > f` exits 0 on a stdin that
 * ended early, so a connection that dies mid-write leaves a TRUNCATED job
 * script that still starts a session — which is the wrong-tree failure the
 * cdGuard below exists to prevent, arriving by another route. Comparing the
 * size on the box against the size we sent costs nothing, because it happens
 * inside the same remote command, and it turns a silent half-write into a
 * refusal. Writing to `.part` and renaming only on success means a failed write
 * never leaves a plausible-looking file at the real path.
 */
function writeRemote(content: string, remotePath: string, opts: { exec?: boolean } = {}): void {
  const bytes = Buffer.byteLength(content, "utf8");
  const part = `${remotePath}.part`;
  const cmd = [
    `mkdir -p ${shq(path.posix.dirname(remotePath))}`,
    `cat > ${shq(part)}`,
    `[ "$(wc -c < ${shq(part)})" -eq ${bytes} ]`,
    ...(opts.exec ? [`chmod +x ${shq(part)}`] : []),
    `mv -f ${shq(part)} ${shq(remotePath)}`,
  ].join(" && ");
  const r = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), cmd], {
    input: Buffer.from(content, "utf8"),
    encoding: "utf8",
  });
  if (r.status !== 0) {
    spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), `rm -f ${shq(part)}`], { stdio: "ignore" });
    die(`writing ${remotePath} failed (${r.status}): ${(r.stderr || "").trim() || `${bytes} bytes did not arrive intact`}`);
  }
}

/** Copy one file to the box. Dies on failure — a silent scp is how you get a
 *  box running yesterday's script and a green check that means nothing. */
function scpTo(local: string, remote: string): void {
  const r = spawnSync("scp", ["-q", ...SSH_OPTS, ...sshMasterOpts(), local, `${HOST()}:${remote}`], { encoding: "utf8" });
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
  //
  // It asks interactiveStdin() rather than fd 0 because `-p -` spends fd 0 on
  // the prompt; see that function.
  const keyboard = interactiveStdin();
  if (keyboard === null || (keyboard === "inherit" && !process.stdin.isTTY)) {
    return { ok: false, detail: "cannot probe without a terminal; assuming ssh" };
  }
  const probe = `stty rows 40 cols 120; exec env LANG=C.UTF-8 mosh ${shq(HOST())} -- true`;
  const r = spawnSync("script", ["-q", "/dev/null", "sh", "-c", probe], {
    encoding: "utf8",
    // 15s, not 6: a first connection bootstraps over ssh before mosh's own
    // handshake starts, and a short timeout reports a blocked network for what
    // was only slowness. Some timeout is required — mosh retries forever.
    timeout: 15_000,
    stdio: [keyboard, "pipe", "pipe"],
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
      // No ControlPath here: mosh 1.4.0's default --experimental-remote-ip=proxy
      // appends `-S none` to its own ssh command line AFTER anything we pass in
      // --ssh, so connection sharing is switched off no matter what we ask for.
      // /opt/homebrew/bin/mosh line 407. Checked because the plan proposed doing
      // it, and it would have looked like it worked.
      `MOSH_TITLE_NOPREFIX=1 LANG=C.UTF-8 mosh ${shq(HOST())} -- sh -c ${shq(inner)}`
    : // Interactive, so no BatchMode — but a rebuilt box must still not greet
      // the fallback attach with a raw host-key verification failure.
      `ssh -t ${SSH_OPTS_INTERACTIVE.join(" ")} ${shq(HOST())} ${shq(inner)}`;
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

/**
 * The colour to paint the tab with, or "off". Dies on a value that is neither.
 *
 * main() calls this before anything else so a typo in GJD_REMOTE_TAB_COLOUR is
 * refused while nothing has happened yet. It used to be checked inside
 * markTabRemote, which for `new-claude` meant the tmux session was already
 * created on the box before a cosmetic setting aborted the command.
 */
function requireTabColour(): Exclude<Wanted, { kind: "bad" }> {
  const want = wantedColour(process.env);
  if (want.kind === "bad") die(`${TAB_COLOUR_ENV}='${want.value}' is not 'off' or a #rrggbb colour`);
  return want;
}

/**
 * Run the thing that takes this terminal over to the box, with the tab painted
 * violet for as long as it holds it, and exit the way it exited.
 *
 * Paint and un-paint are one function on purpose. The reset hands the tab back
 * to its profile default, so a reset we had not earned would wipe a colour
 * somebody else set; nothing outside iTerm's Python API can read the current
 * colour to put it back properly. Tying the undo to having painted makes the
 * unearned reset unwritable.
 *
 * Everything that could `die()` — resolving the host out of Terraform state,
 * probing mosh — must have happened before the call, or a failure leaves the
 * tab violet with nothing running in it.
 */
function runOnTheBox(file: string, args: string[], stdio: StdioOptions): never {
  const want = requireTabColour();
  const paint = want.kind === "colour" && canColourTab(process.env, Boolean(process.stdout.isTTY));
  if (paint) process.stdout.write(colourSequence(want.rgb));

  // An EMPTY SIGINT handler, and it is load-bearing. Node cannot run a JS
  // handler while spawnSync has the loop blocked, but installing one changes
  // the signal's disposition from "terminate" to "caught", so the Ctrl-C that
  // kills the child no longer kills us — and the un-paint below gets to run.
  // Without it, `tunnel`, whose documented way out is Ctrl-C, left the tab
  // violet every single time. Reproduced on Node 26: with no listener, nothing
  // after spawnSync executes and the process exits on signal 2.
  //
  // SIGINT only. Ctrl-C goes to the whole foreground process group, so the
  // child gets it too and spawnSync returns; a caught SIGTERM or SIGHUP would
  // arrive at us alone and leave us waiting on a child nobody told to stop.
  const swallowInterrupt = () => {};
  process.on("SIGINT", swallowInterrupt);
  const r = spawnSync(file, args, { stdio });
  process.off("SIGINT", swallowInterrupt);

  if (paint) process.stdout.write(colourSequence("default"));
  // The shell convention for "died on a signal", because `process.exit(null ?? 0)`
  // would report a Ctrl-C'd tunnel to the calling shell as a success.
  if (r.signal) return process.exit(128 + (constants.signals[r.signal] ?? 0));
  return process.exit(r.status ?? 0);
}

function attach(name: string, force?: string): never {
  const keyboard = interactiveStdin();
  if (keyboard === null) {
    die(
      "the prompt came in on stdin, so there is no terminal left to attach with.\n" +
        `  The session is running: 'gjd-remote resume ${name}'.\n` +
        "  Add --no-attach to say you meant that.",
    );
  }
  // Before the transport is chosen, not after: chooseTransport may spend six
  // seconds bootstrapping mosh, and the shared connection has no work left. An
  // attach lasts hours, and a -N master idling beside it for all of them is a
  // connection nobody is watching on a link that drops.
  closeSshMaster();
  const transport = chooseTransport(force);
  // Built before the handover, not inside the spawn arguments: attachCmd calls
  // HOST(), which reads Terraform state and can die, and a die after the paint
  // is a violet tab with nothing in it.
  const command = attachCmd(name, transport);
  return runOnTheBox("sh", ["-c", command], [keyboard, "inherit", "inherit"]);
}

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

/** `yyMMdd-HHmmss` in LAPTOP LOCAL time — the same day-ordering as docs/plans
 *  file names, and the same clock as the person reading the name. It was UTC,
 *  which under BST named a session an hour ago.
 *
 *  Seconds are in it because two `new-claude` runs a few seconds apart minted the same
 *  name and tmux refused the second one: "duplicate session: s-0831-1615". */
function timestampName(prefix: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${day}-${time}`;
}

/** A placeholder name, used until Claude has decided what the work is about. */
function provisionalName(prompt?: string): string {
  // A prompt makes a better placeholder than a timestamp, and costs nothing.
  const stamp = timestampName("s");
  return prompt ? slugify(prompt.split(/\s+/).slice(0, 5).join(" "), stamp) : stamp;
}

function sessions(): Session[] {
  // One round trip. For each tmux session: its stats, the Claude session id we
  // pinned into the tmux environment at launch, and the LAST ai-title line from
  // that conversation's transcript — Claude rewrites it as the work becomes
  // clearer, so the last one is the current one.
  //
  // The script and the parse both live in gjd-remote-tmux.ts, which is where
  // their tests can reach them. The parse is strict: a line tmux did not fill
  // in is dropped, not coerced. See tests/gjd-remote-tmux.test.ts for what
  // coercion did to the AGE and ATT columns.
  // ssh's exit status is CHECKED, and that is the whole of this line's history:
  // it used to be `{ check: false }`, so a box that was down, rebuilt, or
  // unreachable gave empty stdout, an empty list, and `gjd-remote ls` printing
  // "no sessions." and exiting 0. "No sessions" is the answer least likely to
  // make anyone look, and every other caller reads absence as permission —
  // `new-claude` decides the name is free, `resume` picks a most-recent out of nothing.
  //
  // The half that exit status cannot reach — an idle box against a broken tmux,
  // because the remote script pipes `tmux ls` into a `while` loop whose exit
  // status is 0 whatever tmux did — is now handled by a completion marker the
  // script prints last, and `failure` below. Verified on the box: tmux off the
  // PATH gives "GJDERR tmux is not on this box", while tmux present with no
  // server still gives a clean empty list, which is the one genuine empty case.
  const { sessions: list, unreadable, failure } = parseSessions(ssh(buildSessionScript()));
  if (failure) die(`could not read the box's tmux sessions: ${failure}`);
  // Fail closed. A short list is indistinguishable from a correct one, and
  // every caller draws a conclusion from absence: `new-claude` decides a name is free,
  // `resume` with no name picks the "most recent". Neither may act on a list we
  // know is incomplete.
  if (unreadable.length > 0) {
    die(
      `could not read ${unreadable.length} of the box's tmux sessions, so the list is incomplete:\n` +
        unreadable.map((l) => `  ${l}`).join("\n") +
        `\n  'gjd-remote ssh' and 'tmux ls' will show what the box actually has.`,
    );
  }
  return list;
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
 * The check belongs HERE, before any session is created, and not only because a
 * session that dies on its first line is confusing. It is the half of the guard
 * that can say something useful — by the time the job script runs, nobody is
 * watching. See cdGuard() below for the other half.
 *
 * It is `cd`, not `test -d`, and the difference is a real hole: `test -d` only
 * stats, so a directory with no execute permission passes it and then refuses
 * every attempt to enter. Asking the question we actually mean costs the same
 * round trip.
 */
function sessionDir(given: string | undefined): string {
  const explicit = given !== undefined;
  const dir = remotePath(given ?? REMOTE_REPO(), explicit ? "--dir" : "GJD_REMOTE_REPO");
  const probe = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), `cd ${shq(dir)}`], { encoding: "utf8" });
  if (probe.status === 0) return dir;
  const why = (probe.stderr || "").trim().split("\n").at(-1)?.replace(/^bash: line \d+: /, "") ?? "";
  die(
    `cannot start a session in ${dir} on the box.\n` +
      (why ? `  the box said: ${why}\n` : "") +
      (explicit
        ? `  --dir is a path on the BOX, not on this laptop.`
        : `  that is where sessions start when you do not say. Either put it there:\n` +
          `    gjd-remote clone spideryarn/reading2 --name spideryarn2\n` +
          `  or say where to start:\n` +
          `    gjd-remote new-claude -d ~   ${dim("# the home directory")}\n` +
          `  (or set GJD_REMOTE_REPO to a checkout that already exists)`),
  );
}

/** Where a session's command leaves its last words. Read back by
 *  confirmStarted() once the session is gone and the pane with it. */
const failNote = (name: string) => `${REMOTE_WORK}/jobs/${name}.fail`;

/**
 * Say why, on the pane AND in the note, then end the session.
 *
 * The message is shq'd rather than interpolated: a path containing `$()` or a
 * backtick would otherwise become shell syntax at exactly the moment the guard
 * fires — which is the one moment nobody is watching.
 *
 * printf and redirection only, no `tee`: the first version piped through tee,
 * and a PATH without it — the very kind of broken environment this guard exists
 * to report — swallowed the note it was trying to leave.
 */
function failTo(name: string, msg: string): string {
  return (
    `{ m=${shq(msg)}; printf '%s\\n' "$m" >&2; ` + `printf '%s\\n' "$m" > ${shq(failNote(name))}; exit 1; }`
  );
}

/**
 * Get into the directory, or end the session saying so.
 *
 * `tmux new-session -c DIR` is not this guard. tmux does NOT fail closed when
 * it cannot enter `-c`: it falls back to the user's home, then to `/`, and
 * exits 0 either way. So `-c` alone buys a healthy-looking session in
 * /home/greg — the same wrong-tree failure `new-claude` was fixed for, reproduced
 * for `new-shell` on the box on 2026-08-31 with a `chmod 000` directory, which `test -d`
 * passes and `cd` refuses.
 *
 * sessionDir() has already asked the box whether it can enter this directory,
 * so reaching the failure branch means it went away in between. Ending the
 * session is a failure you can see; a session in the wrong tree is not.
 */
function cdGuard(name: string, dir: string, what: string): string {
  return `cd ${shq(dir)} || ${failTo(name, `FATAL: cannot enter ${dir} on the box — refusing to start ${what} somewhere else`)}`;
}

/**
 * Did the session survive being started?
 *
 * `tmux new-session -d` exits 0 the moment the pane is spawned, so the green ✓
 * used to be printed before the command in it had had a chance to fail. One
 * round trip a second later asks the box instead, and if the session is gone,
 * the note the guard left says why — the pane that printed it does not outlive
 * it.
 */
function confirmStarted(name: string): void {
  const note = failNote(name);
  const out = ssh(
    `sleep 1; if tmux has-session -t =${name} 2>/dev/null; then printf 'alive\\n'; ` +
      `else cat -- ${shq(note)} 2>/dev/null || ` +
      `printf '%s\\n' 'it was gone a second after it started, and left no note'; fi`,
    { check: false },
  );
  if (out.trim() === "alive") return;
  die(`'${name}' did not survive starting:\n  ${out.trim().split("\n").join("\n  ")}`);
}

/**
 * Append one line to the log, and never fail the command for it.
 *
 * Best-effort, because a log is evidence about the work and not part of it —
 * but LOUD when it cannot write, because a log that silently stopped recording
 * is worse than no log at all: it answers "nothing was scheduled" with the same
 * silence as a quiet week. Warned once per process, so a broken directory does
 * not print on every line.
 *
 * appendFileSync opens with 'a', which is O_APPEND, so concurrent gjd-remote
 * processes cannot interleave — see MAX_LINE_BYTES in scripts/gjd-remote-log.ts
 * for why the line is capped rather than trusted.
 */
let logWarned = false;
function appendLog(rec: Omit<LogRecord, "v" | "t" | "ms">, opts: { loud?: boolean } = {}): boolean {
  const now = new Date();
  const file = logPath(process.env, homedir());
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    // Encoded once, written once, flushed. 0600 because the file is not as
    // harmless as it looks: an unnamed session's NAME is the first five words
    // of its prompt (provisionalName), so this file carries prompt fragments
    // however carefully the prompt field is left out.
    const line = Buffer.from(formatLine({ v: LOG_SCHEMA, t: now.toISOString(), ms: now.getTime(), ...rec }), "utf8");
    appendFileSync(file, line, { mode: 0o600, flush: true });
    return true;
  } catch (err) {
    // `loud` is for the record of a launch, which is the ONLY thing that will
    // ever say this session existed: if it is not written, a job that a reboot
    // eats leaves no trace anywhere and `log --lost` will never mention it.
    // Everything else warns once and gets on with the command, because a log is
    // evidence about the work rather than part of it.
    if (opts.loud) {
      console.error(red(`✗ the session was created but could NOT be written to the log at ${file}`));
      console.error(red(`  ${(err as Error).message}`));
      console.error(red("  nothing will notice if this one never runs — kill it, or write it down yourself"));
      return false;
    }
    if (logWarned) return false;
    logWarned = true;
    console.error(dim(`(could not write the gjd-remote log at ${file}: ${(err as Error).message})`));
    return false;
  }
}

/**
 * Which launches never became a Claude.
 *
 * The question this answers is Greg's: a `--wait 2h` job is a `sleep` in a tmux
 * session on the box, and a reboot takes it with no trace at all — the session
 * is simply not there, which is what a finished session looks like too. So the
 * laptop keeps the intent and the box's job script records the moment it execs,
 * and this command puts the two together.
 *
 * FAILS CLOSED. If the box cannot be reached, every launch is unknown and this
 * says so and exits non-zero. Reporting "nothing ran" because nothing answered
 * would be the same bug as the one the sentinel in gjd-remote-tmux.ts exists to
 * prevent, with worse consequences: it would cry wolf on every job.
 */
function cmdLog(opts: { lost: boolean; limit: number }): void {
  const file = logPath(process.env, homedir());
  if (!existsSync(file)) {
    console.log(dim(`no log yet at ${file}`));
    console.log(dim("  it is written from the next gjd-remote command onwards"));
    return;
  }
  const { records, unreadable } = parseLog(readFileSync(file, "utf8"));
  // A launch is a `new-claude` line WITH a session id. Both halves matter: the
  // plain one-per-command lines have no id and could never be given a verdict,
  // and `kill` lines DO have one — they started carrying the uuid so that a
  // renamed session could be matched — so filtering on the id alone listed
  // every kill as a launch of its own, under the session's new name.
  const launches = records.filter((r) => r.cmd === "new-claude" && r.id !== undefined);
  if (unreadable > 0) console.error(dim(`(${unreadable} line(s) in the log could not be read)`));
  if (launches.length === 0) {
    console.log(dim("no sessions have been launched from this machine yet"));
    return;
  }

  // Every kill this log has seen, by uuid, so a session Greg called off is not
  // reported as one the box lost.
  const killed = new Set<string>();
  for (const r of records) if (r.cmd === "kill" && r.id !== undefined) killed.add(r.id);

  const out = ssh(buildFactsScript(REMOTE_WORK), { check: false });
  const { facts, failure } = parseFacts(out);
  if (failure) {
    console.error(red(`✗ could not ask the box which sessions ran: ${failure}`));
    console.error(dim(`  ${launches.length} launch(es) in the log, and no verdict for any of them`));
    process.exit(1);
  }

  const now = Date.now();
  const rows = launches
    .map((r) => ({ r, state: verdict(r, facts, { now, killed }) }))
    .filter((row) => (opts.lost ? row.state === "lost" || row.state === "unknown" : true))
    .slice(-opts.limit);

  if (rows.length === 0) {
    // A file with a damaged line cannot support "nothing was lost": the missing
    // record is exactly the one that would have said otherwise. Sol's point,
    // and the same rule ai-calls-fs.ts already applies to its own store.
    if (unreadable > 0) {
      console.error(red(`✗ ${unreadable} unreadable line(s), so this cannot say that nothing was lost`));
      process.exit(1);
    }
    console.log(green("✓ nothing was lost") + dim(` — ${launches.length} launch(es) checked`));
    return;
  }

  const colour = { lost: red, unknown: red, waiting: dim, ran: green, running: green, killed: dim } as const;
  const w = Math.max(4, ...rows.map((row) => (row.r.name ?? "").length));
  console.log(bold(`${"WHEN".padEnd(12)}  ${"NAME".padEnd(w)}  STATE`));
  let bad = 0;
  for (const { r, state } of rows) {
    console.log(`${stamp(r.ms).padEnd(12)}  ${(r.name ?? "?").padEnd(w)}  ${colour[state](state)}`);
    if (state !== "lost" && state !== "unknown") continue;
    bad++;
    console.log(dim(`    was due ${r.waitUntilMs === undefined ? "immediately" : stamp(r.waitUntilMs)}`));
    // Only when there is actually a prompt to re-run. The first version printed
    // this line unconditionally with a `…` where the path should be, which is
    // an instruction that cannot be followed — worse than saying nothing.
    if (r.promptPath !== undefined) {
      console.log(dim(`    its prompt is still on the box: ${r.promptPath}`));
      console.log(dim(`    gjd-remote ssh ${shq(`cat -- ${r.promptPath}`)} | gjd-remote new-claude -d ${r.dir ?? "~"} -p -`));
    }
  }
  // Non-zero when something never ran, so `--lost` can be a check rather than
  // only a thing to read — the same convention `doctor` uses.
  if (opts.lost && (bad > 0 || unreadable > 0)) process.exit(1);
}

/** A fixed `dd MMM HH:mm`, not toLocaleString: this is a column, and its width
 *  must not depend on which machine's locale is printing it. */
function stamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${pad(d.getDate())} ${month} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cmdLs(): void {
  const list = adoptTitles(sessions());
  if (list.length === 0) {
    console.log(dim("no sessions. `gjd-remote new-claude` to start one."));
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
 * Run one AppleScript, with its data in argv and never in the script text.
 *
 * Interpolating a shell variable into a quoted AppleScript literal is an
 * injection hole: a `"` in the value closes the literal and the rest runs AS
 * AppleScript. Nothing here builds a script around a value.
 *
 * `retry` is for the read-only walks only. A walk over every window can be
 * invalidated by a peer closing a tab mid-flight — AppleScript raises -1719 and
 * aborts the whole script — and the only cure is to run it again. That cure is
 * poison for the script that creates a tab, which is why that one is addressed
 * by window id and never retried.
 *
 * stderr is folded into stdout so a permission failure (-1743) can be reported
 * rather than swallowed. Every caller therefore validates the SHAPE of what
 * comes back instead of trusting it.
 */
function osa(script: string, args: string[], opts: { retry: boolean }): { ok: boolean; out: string } {
  for (let attempt = 1; ; attempt++) {
    const r = spawnSync("osascript", ["-", ...args], { input: script, encoding: "utf8" });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    const transient = /-1719|Invalid index|-1728/.test(out);
    if (r.status === 0 || !opts.retry || !transient || attempt >= 3) return { ok: r.status === 0, out };
    // Deliberately blocking: this is a whole-tree race that clears in
    // milliseconds, and there is nothing else for this process to do.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  }
}

/**
 * The `gjd-remote` to type into a new tab.
 *
 * Resolved to an absolute path here rather than left as a bare name, because
 * the tab gets a fresh login shell whose PATH is not necessarily this one's.
 * `GJD_REMOTE_BIN` overrides it; the last resort is this very checkout, run the
 * way the shim in ~/bin runs it — absolute both times, because `npx tsx`
 * resolves tsx from the CURRENT directory and a new tab starts in the home
 * directory.
 */
function resumeBin(): string {
  const override = process.env.GJD_REMOTE_BIN;
  if (override) return shq(override);
  // `sh -c`, not `shell: true`: `command` is a shell builtin so it needs a
  // shell, but passing an args array WITH shell:true concatenates them onto the
  // command line unescaped, and Node warns about it (DEP0190) on stderr — which
  // is the command's own output, in front of the person who ran it.
  const which = spawnSync("/bin/sh", ["-c", "command -v gjd-remote"], { encoding: "utf8" });
  const found = (which.stdout ?? "").trim().split("\n")[0] ?? "";
  if (which.status === 0 && found.startsWith("/") && existsSync(found)) return shq(found);
  return `${shq(path.join(REPO, "node_modules/.bin/tsx"))} ${shq(path.join(REPO, "scripts/gjd-remote.ts"))}`;
}

/**
 * A tab per session, each one attached to it.
 *
 * The colour is not set here. Every tab is handed the ordinary
 * `gjd-remote resume <name>` line and paints itself violet the way it does when
 * you type it — one mechanism for "this tab is on the box", in
 * scripts/gjd-remote-tab.ts, rather than a second one that could disagree.
 *
 * Order of operations, and each part is load-bearing:
 *  1. read the box's sessions FIRST, so a box that is down costs nothing and
 *     opens no tabs;
 *  2. find my own window, and which tab is selected in it, BEFORE creating
 *     anything — `create tab` selects the new tab, so afterwards `current tab`
 *     is already the new one and "restoring" it is a no-op that looks like a fix;
 *  3. one tab at a time, stopping at the first failure rather than spraying;
 *  4. put the keyboard back.
 */
function cmdResumeAll(opts: { includeAttached: boolean; transport?: "ssh" | undefined }): void {
  const refusal = openTabsRefusal(process.env, Boolean(process.stdout.isTTY));
  if (refusal) {
    die(
      `resume-all opens iTerm tabs, and I cannot: ${refusal}.\n` +
        `  'gjd-remote ls' lists the sessions; 'gjd-remote resume <name>' attaches to one here.`,
    );
  }
  const me = selfSessionUuid(process.env);
  if (!me) return die("ITERM_SESSION_ID is unset or malformed"); // openTabsRefusal already checked; this is for the types.

  const plan = planTabs(adoptTitles(sessions()), { includeAttached: opts.includeAttached });
  for (const s of plan.skipped) console.log(dim(`skipped ${s.name} — ${s.why}`));
  if (plan.open.length === 0) {
    console.log(dim(plan.skipped.length > 0 ? "nothing left to open." : "no sessions. `gjd-remote new-claude` to start one."));
    return;
  }

  const resolved = osa(resolveScript(), [me], { retry: true });
  const here: Here | undefined = resolved.ok ? parseHere(resolved.out) : undefined;
  if (!here) {
    die(
      `could not find my own iTerm window (session ${me}).\n` +
        (resolved.out ? `  osascript said: ${resolved.out}\n` : "") +
        `  If this is a permissions problem, System Settings → Privacy & Security → Automation.`,
    );
  }

  const bin = resumeBin();
  const opened: string[] = [];
  for (const name of plan.open) {
    // No retry: this creates a tab, and a retried create is two tabs for one
    // session. It addresses the window by id, so the -1719 that retries exist
    // for cannot arise here.
    const made = osa(newTabScript(), [String(here.windowId), resumeCommand(bin, name, opts.transport), "0.4"], {
      retry: false,
    });
    if (!made.ok || !isSessionUuid(made.out)) {
      console.error(red(`✗ opening a tab for ${name} failed: ${made.out || "no output"}`));
      break;
    }
    opened.push(name);
    console.log(`${green("✓")} ${name}`);
  }

  // Last, and unconditional: a run that stopped halfway has stolen the keyboard
  // just as thoroughly as one that finished.
  const back = osa(selectScript(), [here.selectedSession], { retry: true });
  if (!back.ok) console.error(dim(`could not select the tab you were in: ${back.out}`));

  const missed = plan.open.length - opened.length;
  console.log(
    missed === 0
      ? dim(`${opened.length} tab${opened.length === 1 ? "" : "s"} — each attaches on its own; they go violet as they connect.`)
      : red(`${opened.length} of ${plan.open.length} opened; ${missed} not started.`),
  );
}

/**
 * `-p -` means "the prompt is on stdin".
 *
 * `-p "…"` is fine for a sentence, but the text is prose and the local shell
 * gets it first: in double quotes zsh still eats `$`, backticks and backslashes,
 * and a prompt about shell commands is exactly the kind that contains all three.
 * A heredoc hands the text over with no quoting at all:
 *
 *     gjd-remote new-claude -p - <<'EOF'
 *     anything at all, "quoted" or `backticked`
 *     EOF
 *
 * Everything downstream is unchanged — the prompt already travels as a file.
 *
 * The TTY check is not politeness. Without it, a bare `-p -` typed at a terminal
 * blocks on a read that never returns, and on a tool whose every other pause is
 * the network, that looks precisely like a slow connection.
 */
function resolvePrompt(prompt: string | undefined): string | undefined {
  if (prompt !== "-") return prompt;
  if (process.stdin.isTTY) {
    die(
      "-p - reads the prompt from stdin, but stdin is a terminal.\n" +
        "  Pipe it in, or use a heredoc: gjd-remote new-claude -p - <<'EOF' … EOF",
    );
  }
  const text = readFileSync(0, "utf8");
  // An empty stdin would otherwise start Claude with the empty string as its
  // first message, which is not what anyone meant by piping in a prompt.
  if (!text.trim()) die("-p - got nothing on stdin");
  stdinConsumed = true;
  return text;
}

/**
 * Where an interactive child gets its keyboard from.
 *
 * `-p -` and attaching fight over one file descriptor. The heredoc that carries
 * the prompt IS stdin, so by the time the prompt has been read, fd 0 is an
 * exhausted pipe — and every later step quietly does the wrong thing with it:
 * `moshProbe` sees a non-TTY and reports mosh unavailable, then `ssh -t`
 * declines to allocate a pty ("Pseudo-terminal will not be allocated because
 * stdin is not a terminal") and tmux attaches to nothing. Both verified against
 * the box on 2026-08-31. `-t -t` forces the pty but leaves stdin an exhausted
 * pipe, so tmux sees EOF and detaches immediately — worse, because it looks
 * like it worked.
 *
 * /dev/tty is the controlling terminal regardless of what fd 0 was redirected
 * to, which is exactly the question being asked. Opened once, reused.
 *
 * Returns "inherit" when stdin was never consumed — the ordinary case, where fd
 * 0 is already the terminal — and null when there is no terminal to be had, so
 * the caller can say something useful instead of hanging.
 */
let stdinConsumed = false;
let ttyFd: number | null | undefined;

function interactiveStdin(): number | "inherit" | null {
  if (!stdinConsumed) return "inherit";
  if (ttyFd === undefined) {
    try {
      ttyFd = openSync("/dev/tty", "r");
    } catch {
      // No controlling terminal: a cron job, a CI runner, another agent's
      // subprocess. Nothing to attach to, and nothing has gone wrong yet.
      ttyFd = null;
    }
  }
  return ttyFd;
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
function cmdNewClaude(
  given: string | undefined,
  opts: {
    prompt?: string | undefined;
    dir?: string | undefined;
    attach: boolean;
    transport?: string | undefined;
    /** `--wait 2h`: already parsed, because a bad duration must not reach the box. */
    wait?: { seconds: number; label: string } | undefined;
  },
): void {
  // Checked before anything touches the network, because the failure it
  // prevents is a green tick over a Claude that never ran. The job runs
  // `claude "$(cat -- promptPath)"`, so the whole prompt becomes ONE argv
  // string, and Linux caps a single argument at 32 pages — about 128 KiB —
  // failing execve with E2BIG. That failure happens inside the job script on
  // the box, where the fallthrough to `exec bash -l` leaves a live session with
  // no Claude in it while the laptop prints `✓ started`. `-p -` makes an
  // oversized prompt easy to produce by accident (`… -p - < some-file`), so it
  // is refused here, where somebody is present to read the reason. Found by
  // GPT Sol.
  if (opts.prompt !== undefined) {
    const size = Buffer.byteLength(opts.prompt, "utf8");
    if (size > MAX_PROMPT_BYTES) {
      die(
        `that prompt is ${Math.round(size / 1024)}KB, and the box can only take ${MAX_PROMPT_BYTES / 1024}KB ` +
          `on a command line.\n  Put the long part in a file in the repo and ask Claude to read it instead.`,
      );
    }
  }

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
  console.log(bold(`gjd-remote new-claude ${name}`) + dim(` → ${HOST()}:${dir}`));

  // Pin the session id rather than discovering it: it is how we find this
  // conversation's transcript later, and so how we read back its title.
  const sessionId = randomUUID();

  // Keyed by the session id, not by the name, and the name is only in there so
  // a human reading the directory can tell what is what.
  //
  // Name-keyed paths made two concurrent `new-claude` runs able to write each other's
  // files: the existence check above is a look, not a reservation, so both can
  // find the name free. Generated job scripts differ mainly by a same-length
  // UUID, so process A's byte count validates process B's file, renames it into
  // place and starts it — A's tmux environment then records session id A while
  // the job actually runs session id B, and A prints a green tick with title
  // discovery pointed permanently at the wrong transcript. Found by GPT Sol.
  // Seconds in the default name do not fix it; a unique path does.
  const promptPath = `${REMOTE_WORK}/prompts/${name}-${sessionId}.md`;
  const jobPath = `${REMOTE_WORK}/jobs/${name}-${sessionId}.sh`;
  // The note is removed before the run, never after: one left by an earlier
  // session of the same name would otherwise be read back as this one's excuse.
  ssh(`mkdir -p ${REMOTE_WORK}/prompts ${REMOTE_WORK}/jobs && rm -f ${shq(failNote(name))}`);

  // Size already checked at the top, before any of this touched the network.
  if (opts.prompt) writeRemote(opts.prompt, promptPath);

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
    cdGuard(name, dir, "Claude"),
    // And the same shape one line lower: `claude` not being on the job's stock
    // PATH does not stop the script, it falls through to `exec bash -l`. That
    // is a live session, listed by `ls`, with no Claude in it — which is the
    // wrong-tree failure again, wearing different clothes.
    `command -v claude >/dev/null 2>&1 || ` +
      failTo(name, "FATAL: claude is not on this job's PATH — refusing to leave a session with no Claude in it"),
    // AFTER both guards, and that ordering is the whole design of `--wait`.
    // Sleeping first would mean a box with a missing directory or a stock PATH
    // says nothing for two hours and then kills the session — at the one moment
    // nobody is watching. Both guards are one round trip and both fail loudly,
    // so they run while the person who typed the command is still reading the
    // output. Proved by reading the generated job back off the box, not by
    // trusting this comment: see docs/project/hetzner-remote-server-box.md.
    opts.wait ? waitPreamble(opts.wait.seconds, opts.wait.label) : "",
    // One line on the box, one instant before Claude starts, and it is the ONLY
    // trustworthy answer to "did this job ever run?". The laptop cannot know:
    // a session that a reboot ate mid-`sleep` and a session that finished
    // normally are both simply absent. The transcript cannot answer it either —
    // a session started with no prompt had none after 45 seconds while its
    // process was running, because the file is written from the first message.
    // See scripts/gjd-remote-log.ts.
    startMarkerCommand(REMOTE_WORK, sessionId, name),
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

  // exec: true folds the chmod into the same round trip as the write.
  writeRemote(job, jobPath, { exec: true });
  // The id and the provisional flag live in the tmux session's own environment,
  // so they survive the rename that `ls` may later perform — a mapping file
  // keyed by name would go stale at exactly that moment.
  ssh(
    `tmux new-session -d -s ${name} -e CLAUDE_SESSION_ID=${sessionId} ` +
      `-e GJD_PROVISIONAL=${provisional ? 1 : 0} ${shq(`bash ${jobPath}`)}`,
  );

  confirmStarted(name);

  // Written after the session exists, because the record is of a launch that
  // happened — and it carries the uuid, which is the only handle that survives
  // `ls` renaming the session later. A `--wait` job that a reboot eats leaves
  // this line and nothing else, which is the whole point of it.
  appendLog(
    {
      cmd: "new-claude",
      name,
      id: sessionId,
      dir,
      host: host(),
      ...(opts.wait === undefined
        ? {}
        : { waitSeconds: opts.wait.seconds, waitUntilMs: Date.now() + opts.wait.seconds * 1000 }),
      // About the prompt, never its text: how big it was, and the path it is
      // already sitting at on the box, which is what makes a lost job re-runnable.
      ...(opts.prompt === undefined ? {} : { promptBytes: Buffer.byteLength(opts.prompt, "utf8"), promptPath }),
    },
    { loud: true },
  );

  // A waiting session has NOT started Claude, and saying it has would be the
  // green tick this file keeps having to earn back. What confirmStarted proves
  // either way is that the tmux session survived a second — which for a wait is
  // the whole of what has happened so far.
  if (opts.wait) {
    // The zone is named because the two clocks are not in the same one: the
    // box is Europe/London and the laptop is wherever Greg is, which on
    // 2026-09-01 was two hours ahead. Both are right and both print their own
    // zone — a bare "00:03" here beside the pane's "22:03 BST" reads as a
    // broken clock. The sleep itself is a DURATION, so neither zone can affect
    // it; only these two sentences.
    const at = new Date(Date.now() + opts.wait.seconds * 1000);
    const clock = at.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    });
    console.log(green(`✓ created '${name}'`) + dim(` — Claude starts in ${opts.wait.label}, about ${clock}`));
    // Not attaching, on purpose: there is nothing to watch but a sleep, and a
    // tab held open for two hours is a tab you stop trusting. Said out loud
    // rather than done quietly, because --wait did not ask for this.
    console.log(dim(`  nothing runs until then — gjd-remote resume ${name}, or gjd-remote kill ${name}`));
    return;
  }

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
function cmdNewShell(given: string | undefined, opts: { dir?: string | undefined; transport?: string | undefined }): void {
  const name = given ?? timestampName("sh");
  if (!SLUG.test(name)) die(`'${name}' is not a valid name (lower-case letters, digits, hyphens; max 41)`);

  const live = sessions();
  if (live.some((x) => x.name === name)) {
    console.log(dim(`'${name}' already exists — attaching`));
    attach(name, opts.transport);
  }

  const dir = sessionDir(opts.dir);
  console.log(bold(`gjd-remote new-shell ${name}`) + dim(` → ${HOST()}:${dir}`));

  // `-c ${dir}` is NOT the guard, and used to be all there was: tmux falls back
  // to the home directory when it cannot enter `-c` and still exits 0, so this
  // command reported a green ✓ over a shell sitting in /home/greg. The explicit
  // `cd || exit 1` is the same one `new-claude` runs, for the same reason.
  //
  // GJD_PROVISIONAL=0: a shell has no Claude conversation and so will never
  // have a title to adopt. Marking it settled stops `ls` looking every time.
  ssh(`mkdir -p ${REMOTE_WORK}/jobs && rm -f ${shq(failNote(name))}`);
  ssh(
    `tmux new-session -d -s ${name} -c ${shq(dir)} -e GJD_PROVISIONAL=0 ` +
      shq(`${cdGuard(name, dir, "a shell")}; exec bash -l`),
  );
  confirmStarted(name);
  console.log(green(`✓ shell '${name}'`) + dim(` in ${dir}`));
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
  // Refused, not reported. The allowlist stops the file sending a key it should
  // not; nothing stopped it sending FEWER keys than it appears to — a duplicate
  // takes the later value, an unclosed quote eats every line after it, and a
  // line the parser cannot read is skipped. Each of those replaces the box's
  // env file with a shorter one under a green tick, and the box then fails at
  // whatever needed the key that went missing.
  if (payload.problems.length) {
    die(
      `${local} is not a file I will push — I would silently drop keys out of it:\n` +
        payload.problems.map((p) => `  ${p}`).join("\n") +
        `\n  Fix those lines and run this again. Nothing on the box was touched.` +
        `\n  (Line numbers only — the contents of a broken line may well be the secret.)`,
    );
  }
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
  const sent = spawnSync("scp", ["-q", ...SSH_OPTS, ...sshMasterOpts(), staged, `${HOST()}:${tmp}`], { encoding: "utf8" });
  if (sent.status !== 0) {
    ssh(`rm -f ${shq(tmp)}`, { check: false });
    die(`scp failed: ${(sent.stderr || "").trim()}`);
  }
  // One command: chmod, then rename over the destination. rename(2) within a
  // directory is atomic, so a reader on the box sees the old file or the new
  // one and never a half-written one.
  ssh(`chmod 600 ${shq(tmp)} && mv -f ${shq(tmp)} ${shq(dest)}`);

  // BYTES first, meaning second. The readback used to go straight through the
  // parser, which is the one comparison that cannot see what the parser
  // overlooks: a trailing junk line, an appended comment, a second copy of a
  // key. Both sides agreed because both sides had the same blind spot.
  const raw = ssh(`cat ${shq(dest)}`, { raw: true });
  if (raw !== payload.text) {
    const at = [...raw].findIndex((c, i) => c !== payload.text[i]);
    die(
      `the bytes on the box are not the bytes that were sent — leaving it for you to look at.\n` +
        `  sent ${payload.text.length} characters, read back ${raw.length}\n` +
        `  first difference at character ${at < 0 ? Math.min(raw.length, payload.text.length) : at}\n` +
        `  (positions only — the file is full of credentials, so nothing from it is printed)`,
    );
  }
  const back = parseEnv(raw);
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

  // Already there — but only success if it is a checkout of the repo that was
  // ASKED FOR. This used to print the green ✓ and exit 0 for any checkout at
  // all, adding a red advisory line underneath saying it was a different repo:
  // a name collision and a done job then looked the same to a caller, to a
  // script, and to anyone reading the last line.
  if (before.get("checkout") === "yes") {
    const found = remoteSlug(before.get("remote"));
    if (found !== want) {
      die(
        `${dest} on the box is a checkout of a different repository.\n` +
          `  asked for: ${want}\n` +
          `  found:     ${found ?? `unrecognised remote '${before.get("remote") || "(none)"}'`}\n` +
          `  Nothing was cloned and nothing was touched. --name or --base-folder to put\n` +
          `  ${want} somewhere else.`,
      );
    }
    console.log(green(`✓ already a checkout of ${want} — nothing to do`));
    describeCheckout(before);
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
  const r = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), cmd], { stdio: "inherit" });
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
  console.log(dim(`  gjd-remote new-shell -d ${dest}   then npm ci`));
}

/**
 * Tools the box must have, each exercised rather than merely located.
 *
 * `command -v jq` proves a file exists on PATH. Running it and checking what
 * came out proves the thing works — which is the difference that matters after
 * a rebuild installs a broken package or a half-extracted binary.
 */
const TOOLS: { name: string; run: string; want: RegExp }[] = [
  { name: "claude", run: "claude --version", want: /^\d+\.\d+\.\d+ \(Claude Code\)/ },
  { name: "tmux", run: "tmux -V", want: /^tmux \d+\.\d/ },
  { name: "mosh-server", run: "mosh-server --version 2>&1", want: /^mosh-server \(mosh \d+\.\d+/ },
  { name: "node", run: "node --version", want: /^v\d+\.\d+\.\d+$/ },
  { name: "google-chrome", run: "google-chrome --version", want: /^Google Chrome \d+\./ },
  { name: "gh", run: "gh --version", want: /^gh version \d+\.\d+/ },
  { name: "jq", run: `echo '{"a":42}' | jq -r .a`, want: /^42$/ },
  // /bin/sh is dash on this box, so `file` reports the symlink. The alternates
  // are what it says on a box where /bin/sh is a real binary instead.
  { name: "file", run: "file -b /bin/sh", want: /^(symbolic link to |ELF |POSIX shell script)/ },
  // One line of /etc/environment mentions PATH. A count of 0 is a tool that ran
  // and found nothing, which is a different failure from a tool that is absent.
  { name: "rg", run: "rg --count PATH /etc/environment", want: /^[1-9]\d*$/ },
  { name: "unzip", run: "unzip -v", want: /^UnZip \d+\.\d+/ },
];

/**
 * Did the tool run, and if not, what is the shortest true thing to say?
 *
 * `want` is required, and used to be optional — only jq had one, so every other
 * check accepted exit 0 with any output at all, including none. A wrapper
 * script, a shim that logs and returns, an alias someone left in place: all of
 * them passed. Exit 0 says something ran; the pattern says it was the tool.
 */
function toolVerdict(
  tool: (typeof TOOLS)[number],
  got: { status: number; detail: string } | undefined,
): { ok: boolean; why: string } {
  if (!got) return { ok: false, why: "no answer from the box" };
  if (got.status === 127) return { ok: false, why: "not installed" };
  if (got.status !== 0) return { ok: false, why: `exit ${got.status}: ${got.detail}` };
  if (!tool.want.test(got.detail)) {
    return {
      ok: false,
      why: `exited 0 but said ${got.detail ? `'${got.detail}'` : "nothing"}, which does not match ${tool.want}`,
    };
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
  const EXPECTED = ["ssh", "mosh", ...TOOLS.map((t) => t.name), "tmux keys", "browser", "mcp", "provisioning"];
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

  // tmux on this box binds NOTHING -- no prefix, no keys -- so every keystroke
  // reaches Claude Code. That is a rule rather than a preference:
  // docs/project/hetzner-remote-server-box.md, "tmux keeps sessions alive and does nothing else".
  //
  // Checked here, live, rather than left to the provisioning report, because the
  // two facts come apart. provision.sh rewrites ~/.tmux.conf, but a tmux server
  // reads its config once at start and the box's server outlives provisioning by
  // weeks -- so the file can be right while the keyboard is still wrong, with
  // every other check green. doctor runs daily and provisioning almost never,
  // which is the other half of why it belongs here.
  //
  // Named "tmux keys", not "tmux": TOOLS already probes tmux's VERSION under
  // that name, and doctor's own record() refuses a duplicate rather than
  // letting the second result overwrite the first. It caught this.
  const keys = bindingsVerdict(ssh(buildBindingsScript(), { check: false }));
  check("tmux keys", keys.ok, keys.why);

  const smoke = runBrowserSmoke();
  check("browser", smoke.ok, smoke.detail);

  // The MCP servers this repo declares, checked against what the box holds.
  //
  // Two of the three need an OAuth login only a human with a browser can do,
  // once per box. Nothing about a box that has not had it done looks wrong:
  // sessions start, the suite passes, and an agent simply never has the tool.
  // The failure is an absence, so it needs a check rather than a reader.
  //
  // The wanted list is read from OUR .mcp.json, not written down again here, so
  // adding a server extends this check without anyone remembering to.
  const declared = declaredServers(
    existsSync(path.join(REPO, ".mcp.json")) ? readFileSync(path.join(REPO, ".mcp.json"), "utf8") : "",
  );
  if (!declared.ok) {
    check("mcp", false, declared.why);
  } else {
    // `|| true` and check:false: `claude mcp list` exits non-zero when any
    // server is unhealthy, including servers of Greg's that are none of our
    // business. Its OUTPUT is the answer; its exit code is not.
    const listing = ssh(
      `cd ${shq(REMOTE_REPO())} && timeout 120 claude mcp list 2>&1 || true`,
      { check: false },
    );
    const verdict = mcpVerdict(listing, declared.names);
    check("mcp", verdict.ok, verdict.why);
  }

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
  // PROVISION NOT RUN is what cloud-init leaves on a box it has only
  // bootstrapped. It needs a branch of its own: it has no FAIL lines in it, so
  // the counting branch below would render it as "0 failed" — an un-provisioned
  // box reported in the words of a healthy one.
  const notRun = /^PROVISION NOT RUN/m.test(report);
  check(
    "provisioning",
    provisionOk && failedLines.length === 0,
    report.trim() === ""
      ? "no status file — provision.sh has never completed on this box"
      : notRun
        ? "bootstrapped but never provisioned — run: gjd-remote provision"
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
 * Build the box: copy `provision.sh` up and run it.
 *
 * This exists because `user_data` is capped at 32 KiB and `provision.sh` is
 * 67 KiB base64'd, so it cannot ride in cloud-init any more —
 * docs/plans/260901d-split-provisioning-out-of-cloud-init-to-fit-the-user-data-cap.md.
 * cloud-init bootstraps; this builds.
 *
 * Almost all of what follows is about not reporting a success that did not
 * happen. The status file on the box holds the LAST run's verdict, so a run
 * that never started leaves the previous `PROVISION OK` sitting there looking
 * exactly like this run's. Hence the attempt id, and hence four conditions
 * rather than one.
 */
function cmdProvision(opts: { waitSeconds?: number | undefined; runMinutes?: number | undefined } = {}): void {
  const ip = host();
  console.log(bold(`gjd-remote provision → ${ip}`));

  const local = path.join(REPO, "infra/hetzner/provision.sh");
  if (!existsSync(local)) die(`missing locally: ${local}`);

  // The preflight, first, on this laptop. A provision.sh that will not parse
  // should cost seconds here rather than a round trip and a half-built box —
  // and it is the same check that guards a `tofu apply`.
  const pre = spawnSync("npx", ["tsx", path.join(REPO, "scripts/check-cloud-init.ts")], { encoding: "utf8" });
  if (pre.status !== 0) {
    console.log((pre.stdout ?? "").trim());
    die("the cloud-init preflight failed — fix that before provisioning");
  }
  console.log(green("✓ preflight"));

  // Two waits, not one. Straight after `tofu apply` the machine may not answer
  // ssh at all, and once it does, cloud-init's final stage may still be running:
  // sshd comes up early. Provisioning against a half-bootstrapped box is how you
  // get a failure in a step that has nothing to do with the real problem.
  waitForSsh(opts.waitSeconds ?? 300);
  waitForCloudInit(opts.waitSeconds ?? 300);

  // Staged in /tmp and installed from there, NOT run from where it lands.
  // provision.sh bind-mounts the volume over /home partway through its own run,
  // so a script executing from under /home would have the ground move beneath
  // it — and root should not be running code out of a user-writable directory.
  const staged = `/tmp/gjd-provision.${process.pid}.sh`;
  const body = readFileSync(local, "utf8");
  const want = createHash("sha256").update(readFileSync(local)).digest("hex");
  writeRemote(body, staged);

  // An id for THIS run. `provision.sh` writes it into the status file, and the
  // verdict below refuses to read a status file that does not carry it.
  const attempt = randomUUID();

  console.log(dim(`  ${(Buffer.byteLength(body) / 1024).toFixed(1)} KiB → ${staged}`));
  console.log(dim(`  attempt ${attempt}`));
  console.log(bold("\nprovisioning — this takes several minutes\n"));

  // Every clause of this is load-bearing and every one of them is quoting —
  // see buildProvisionRunner, where it is built and tested.
  const runner = buildProvisionRunner({
    staged,
    installed: "/usr/local/sbin/provision.sh",
    sha256: want,
    attempt,
    lock: "/var/lock/gjd-provision.lock",
    log: "/var/log/provision.log",
  });

  const r = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), "sudo bash -s"], {
    input: runner,
    stdio: ["pipe", "inherit", "inherit"],
    timeout: (opts.runMinutes ?? 45) * 60_000,
  });

  const verdict = provisionVerdict(ssh("sudo cat /var/log/gjd-provision-status 2>/dev/null || true", { check: false }), {
    attempt,
    sha256: want,
    exitOk: r.status === 0,
  });
  console.log("");
  if (!verdict.ok) {
    console.log(red(`✗ ${verdict.why}`));
    console.log(dim("  the whole log:  gjd-remote ssh 'sudo tail -100 /var/log/provision.log'"));
    process.exit(1);
  }
  console.log(green(`✓ ${verdict.why}`));
  console.log(dim("  then:  gjd-remote doctor"));
}

/** Block until ssh answers, or give up and say so. Refuses immediately on the
 *  two errors that retrying cannot fix: a changed host key, and a rejected key. */
function waitForSsh(seconds: number): void {
  const deadline = Date.now() + seconds * 1000;
  for (let attempt = 1; ; attempt++) {
    const r = spawnSync("ssh", [...SSH_OPTS, HOST(), "true"], { encoding: "utf8" });
    if (r.status === 0) {
      console.log(green(`✓ ssh${attempt > 1 ? ` (after ${attempt} tries)` : ""}`));
      return;
    }
    const err = r.stderr ?? "";
    if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(err)) {
      die("the host key changed — if you just rebuilt:  gjd-remote forget-key");
    }
    if (/Permission denied|Too many authentication failures/i.test(err)) {
      die(`ssh refused the key: ${err.trim().split("\n").slice(-1)[0]}`);
    }
    if (Date.now() >= deadline) die(`ssh never answered in ${seconds}s: ${err.trim().split("\n").slice(-1)[0]}`);
    process.stdout.write(dim(`\r  waiting for ssh (${attempt})…`));
    spawnSync("sleep", ["5"]);
  }
}

/**
 * Block until cloud-init has finished bootstrapping.
 *
 * Its exit codes carry meaning and are not interchangeable: 0 is done, 2 is
 * "done, but with recoverable errors", which is a refusal here — a box whose
 * packages half-installed is not one to build on top of.
 */
function waitForCloudInit(seconds: number): void {
  const r = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), `cloud-init status --wait --long 2>&1; echo "rc=$?"`], {
    encoding: "utf8",
    timeout: (seconds + 30) * 1000,
  });
  const verdict = cloudInitVerdict(`${r.stdout ?? ""}`);
  if (verdict.ok) {
    console.log(green(`✓ ${verdict.why}`));
    return;
  }
  die(`${verdict.why} — provisioning on top of that would fail obscurely.\n  look:  gjd-remote ssh 'cloud-init status --long'`);
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
  // scp's exit code says a transfer finished, not that THESE bytes are what is
  // now on the box. Hash both ends: the whole point of copying the script every
  // time is that the check runs the version in this repo, and a truncated or
  // stale copy that still parses would go on passing for a script nobody has.
  const want = createHash("sha256").update(readFileSync(local)).digest("hex");
  const got = ssh(`sha256sum ${shq(remote)} 2>/dev/null | cut -d' ' -f1`, { check: false });
  if (got !== want) {
    return { ok: false, detail: `the copy on the box hashes ${got || "(nothing)"}, not ${want} — not running it` };
  }
  // Chrome starting, two page loads and two screenshots. 20s is the normal
  // shape; the cap is for a browser that has hung rather than failed.
  const r = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), `node ${shq(remote)}`], { encoding: "utf8", timeout: 120_000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").filter(Boolean);
  if (r.status !== 0) return { ok: false, detail: out.at(-1) ?? `no output (exit ${r.status}, signal ${r.signal})` };
  // Exit 0 is not the check. An empty script exits 0, and so does one whose
  // assertions were commented out; the smoke test says `ok ` and then what it
  // proved, so that line IS the result and its absence is a failure.
  const last = out.at(-1) ?? "";
  if (!/^ok\s/.test(last)) {
    return {
      ok: false,
      detail: `exited 0 without its 'ok' line — ${out.length} line(s) of output, last: ${last || "(none)"}`,
    };
  }
  return { ok: true, detail: last.replace(/^ok\s+/, "") };
}

// ---------------------------------------------------------------- main

const HELP = `${bold("gjd-remote")} — Claude Code sessions on a server that never sleeps

${bold("SESSIONS")}
  ls, (no args)           list sessions, each with Claude's own title for it
  new-claude [name]       start Claude Code and attach
      -p, --prompt TEXT     give it a first prompt (${dim("-p -")} reads it from stdin)
      -d, --dir DIR         working directory on the box ${dim(`(default: ${REMOTE_REPO_DEFAULT})`)}
          --wait DURATION   create it now, start Claude later ${dim("— 45s, 15m, 2h, 1d")}
          --no-attach       create it, but stay here
  new-shell [name]        a persistent shell, no Claude Code
      -d, --dir DIR         working directory on the box ${dim(`(default: ${REMOTE_REPO_DEFAULT})`)}
  resume [name]           reattach; with no name, the most recent session
  resume-all              one new iTerm tab per session, each attached to its own
      --include-attached    take over sessions something else is already in
  kill <name>             end a session
  log                     every session launched from here, and whether it ran
      --lost                only the ones that never started ${dim("— the reboot case")}
      --limit N             how many rows ${dim("(default 40)")}
      --path                print where the log file is and stop

${bold("THE BOX")}
  doctor                  check everything, and say what is wrong
                          exits non-zero if any check failed
  provision               build a bootstrapped box: copy provision.sh up, run it
                          cloud-init no longer does this — user_data is capped at
                          32 KiB and the script is 67 KiB base64'd
                          safe to re-run; that is how you move a pinned version
      --wait-seconds N      how long to wait for ssh and cloud-init ${dim("(default 300)")}
      --run-minutes N       cap on the run itself ${dim("(default 45)")}
  clone <repo>            clone one of Greg's repos onto the box, over HTTPS
      --base-folder DIR     where to put it ${dim(`(default: ${REMOTE_CODE})`)}
      --name DIR-NAME       directory name, if not the repo's own
  push-env                send .env.local to the repo checkout on the box
      --file PATH           a different .env.local — the basename must be exactly that
  ssh [command]           a throwaway connection — no tmux, dies with the terminal
                          with a command, runs it and prints what it said
                          ${dim("gjd-remote ssh 'free -g; uptime'")}
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
  ${dim("new-claude")} and ${dim("new-shell")} begin in the repo checkout, not the home directory: an agent
  that starts in ~ opens by guessing which tree to edit. Most specific wins —
  ${dim("--dir")}, else ${dim("GJD_REMOTE_REPO")}, else ${dim(REMOTE_REPO_DEFAULT)} — and whichever it
  is, it is printed. ${dim("-d ~")} for the home directory.
  The directory must already exist on the box; there is no fallback, because the
  fallback was a healthy-looking session in ${dim("/home/greg")} editing the wrong thing.

${bold("STARTING LATER")}
  ${dim("--wait 2h")} makes the session NOW and starts Claude in two hours. The units are
  ${dim("s m h d")}, and one is required — ${dim("--wait 2")} is refused rather than guessed at,
  because seconds and hours are both fair readings and they are 3600x apart.
  Use it to spread work out when several sessions at once would be too much
  RAM, or too much of the usage allowance, in one go.
  The waiting happens ON THE BOX, in the session's own pane, so closing the
  laptop makes no difference to it. It does not attach — there is nothing to
  watch but a sleep — and ${dim("gjd-remote kill")} calls it off.
  ${bold("The directory and PATH are checked before the wait, not after")}, so a job that
  could never have worked says so now rather than in two hours' time.
  ${bold("A waiting session does not survive the box rebooting")} — nothing does, and
  there is no replay.

${bold("ANYWHERE")}
  --ssh                   skip mosh, for satellite or UDP-blocked networks

${bold("WHAT SURVIVES WHAT")}
  laptop sleeps, roams, loses wifi     mosh reconnects; do nothing
  laptop reboots, terminal dies        tmux kept it — ${dim("gjd-remote resume")}
  the server reboots                   nothing does; ${dim("gjd-remote log --lost")} says what died

${bold("THE LOG")}
  Every command appends one line to ${dim("~/.local/state/gjd-remote/gjd-remote.ndjson")}
  (${dim("GJD_REMOTE_LOG_DIR")} to move it, ${dim("--path")} to find it). Launches also record the
  session uuid, the directory, the wait and when it was due — and about the
  prompt only its length, a short hash and the path it already sits at on the
  box. Never the prompt itself: it is prose and it is not ours to keep.
  ${bold("What it is for")}: a ${dim("--wait")} job is a sleep in a tmux session, and a box reboot
  takes it with no trace — an absent session is what a FINISHED one looks like
  too. So the job writes one line on the box the instant before it execs, and
  ${dim("gjd-remote log --lost")} is the two put together. A job you killed yourself is
  reported as killed, not as lost, because the kill is in the log as well.
  It is outside the repo on purpose: worktrees would otherwise split the record
  across checkouts, and the repo is inside Dropbox.

${bold("EXAMPLES")}
  gjd-remote new-claude -p "fix the ToC ordering bug"
      ${dim(`gjd-remote new-claude s-260831-171205 → greg@1.2.3.4:${REMOTE_REPO_DEFAULT}`)}
      ${dim("✓ started 's-260831-171205' with a prompt")}
      already in the checkout, and named after whatever Claude decides the work is
  gjd-remote new-claude -p - <<'EOF'
      the prompt comes from stdin, so nothing needs escaping — quotes, backticks,
      dollar signs and newlines all arrive as typed
      EOF
  gjd-remote new-claude -d ~/code/gjdutils
      an unnamed session in a different repo; it takes a name once Claude has a title
  gjd-remote new-claude --wait 2h -p - <<'EOF'
      the same session, created now and starting in two hours
      EOF
      ${dim("✓ created 's-260901-004512' — Claude starts in 2h, about 02:45 your time")}
      ${dim("  nothing runs until then — gjd-remote resume s-260901-004512, or gjd-remote kill …")}
  gjd-remote new-shell
      a plain shell that is still running tomorrow
  gjd-remote ssh 'free -g; tmux ls'
      one command on the box and its output here — no tmux session, nothing left behind
  gjd-remote log --lost
      ${dim("WHEN              NAME            STATE")}
      ${dim("Sep 01 02:14      fix-the-toc     lost")}
      ${dim("    was due 01/09/2026, 04:14:00 (--wait 7200s)")}
      ${dim("    its prompt is still on the box: /home/greg/gjd-remote/prompts/fix-the-toc-….md")}
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
                          writes, and where new-claude/new-shell start without a --dir
                          (default: ${REMOTE_REPO_DEFAULT})
  GJD_REMOTE_TAB_COLOUR   ${dim("off")}, or a ${dim("#rrggbb")} (default: ${REMOTE_TAB_COLOUR})

${bold("WHICH TABS ARE ON THE BOX")}
  Anything that hands this terminal to the box — ${dim("new-claude")}, ${dim("new-shell")}, ${dim("resume")}, ${dim("ssh")},
  ${dim("tunnel")} — paints the iTerm tab violet while it holds it, and hands the colour
  back to your profile when it lets go. It is skipped, silently, anywhere the
  sequence might be printed instead of obeyed: not a terminal, not iTerm, or
  inside tmux or screen.
  ${dim("resume-all")} opens the tabs and types ${dim("gjd-remote resume <name>")} into each, so every
  one paints itself the same way — there is no second colouring mechanism. It
  needs to drive iTerm rather than write to its own tab, so it refuses outright
  in all of those places instead of carrying on uncoloured, and it leaves
  ALREADY-ATTACHED sessions alone: attaching detaches whoever is there, which
  would blank the tab you already had it in. ${dim("--include-attached")} to say you meant it.
  The tab you were in gets the keyboard back at the end, but not during — the
  new tab steals it each time, so let it finish before typing.

Names are optional everywhere. An unnamed session starts under a placeholder and
adopts Claude Code's own title for the work at the next ${dim("gjd-remote ls")}. A name you
choose is never changed for you.`;

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);

  // Before anything, so a mistyped colour is refused while nothing has happened
  // rather than after a tmux session exists on the box. The result is thrown
  // away; only the refusal matters here.
  requireTabColour();

  // One line per invocation, before the work rather than after it: several of
  // these commands hand the terminal to mosh and never return here. It records
  // the command NAME and nothing else — no argv, because argv is where the
  // prompt would be, and a field that is never passed in cannot leak. The
  // interesting records are written by cmdNewClaude and by `kill`, which know
  // things this point does not.
  //
  // `log` and `--help` are exempt: reading the log should not write to it, and
  // a report whose own noise grows every time you read it is a worse report.
  if (cmd !== "log" && cmd !== "-h" && cmd !== "--help" && cmd !== "help") appendLog({ cmd: cmd ?? "ls" });

  switch (cmd) {
    case undefined:
    case "ls":
    case "list":
      return cmdLs();

    case "new-claude": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          prompt: { type: "string", short: "p" },
          dir: { type: "string", short: "d" },
          wait: { type: "string" },
          "no-attach": { type: "boolean", default: false },
          ssh: { type: "boolean", default: false },
        },
      });
      // Parsed here, before anything touches the network: a duration typed
      // wrong should cost a sentence, not a session on the box that has to be
      // killed.
      let wait: { seconds: number; label: string } | undefined;
      if (values.wait !== undefined) {
        const d = parseDuration(values.wait);
        if (!d.ok) die(d.why);
        wait = { seconds: d.seconds, label: d.label };
      }
      return cmdNewClaude(positionals[0], {
        prompt: resolvePrompt(values.prompt),
        dir: values.dir,
        wait,
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

    case "resume-all": {
      const { values } = parseArgs({
        args: rest,
        allowPositionals: false,
        options: {
          "include-attached": { type: "boolean", default: false },
          ssh: { type: "boolean", default: false },
        },
      });
      return cmdResumeAll({
        includeAttached: values["include-attached"],
        transport: values.ssh ? "ssh" : undefined,
      });
    }

    case "kill": {
      const name = rest[0];
      if (!name || !SLUG.test(name)) die("gjd-remote kill <name>");
      // Read the uuid BEFORE killing it, because a second later there is
      // nothing to ask. `gjd-remote log` matches kills by uuid rather than by
      // name: `ls` renames a provisional session to Claude's own title, so the
      // name here is often not the name the launch was recorded under, and
      // matching on it would report every killed session as lost. Found by GPT
      // Sol. `check: false` — a session with no uuid is a `new-shell`, which is
      // a fine thing to kill and has nothing to record.
      const killedId = ssh(`tmux show-environment -t =${name}: CLAUDE_SESSION_ID 2>/dev/null | cut -d= -f2-`, {
        check: false,
      }).trim();
      ssh(`tmux kill-session -t =${name}`);
      appendLog({ cmd: "kill", name, ...(killedId === "" ? {} : { id: killedId }) });
      console.log(green(`✓ killed '${name}'`));
      return;
    }

    case "new-shell": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { dir: { type: "string", short: "d" }, ssh: { type: "boolean", default: false } },
      });
      return cmdNewShell(positionals[0], {
        dir: values.dir,
        transport: values.ssh ? "ssh" : undefined,
      });
    }

    case "doctor":
      return cmdDoctor();

    case "provision": {
      const { values } = parseArgs({
        args: rest,
        options: { "wait-seconds": { type: "string" }, "run-minutes": { type: "string" } },
      });
      const num = (v: string | undefined, name: string) => {
        if (v === undefined) return undefined;
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) die(`--${name} wants a positive number, got ${v}`);
        return n;
      };
      return cmdProvision({
        waitSeconds: num(values["wait-seconds"], "wait-seconds"),
        runMinutes: num(values["run-minutes"], "run-minutes"),
      });
    }

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

    case "log": {
      const { values } = parseArgs({
        args: rest,
        allowPositionals: false,
        options: {
          lost: { type: "boolean", default: false },
          limit: { type: "string" },
          path: { type: "boolean", default: false },
        },
      });
      if (values.path) return console.log(logPath(process.env, homedir()));
      const limit = values.limit === undefined ? 40 : Number(values.limit);
      if (!Number.isInteger(limit) || limit < 1) die(`--limit wants a whole number, not '${values.limit}'`);
      return cmdLog({ lost: values.lost, limit });
    }

    case "ssh": {
      // Coloured for the same reason as an attach: while this runs, the tab is
      // a shell on the box and looks exactly like a shell on the laptop.
      //
      // `rest` goes through UNPARSED. Every other command runs parseArgs first,
      // and here that would be wrong twice over: `gjd-remote ssh 'ls -la'` has
      // no options of ours in it, and a command's own flags are not ours to
      // read. So everything after `ssh` is the command, and `gjd-remote ssh`
      // with nothing after it is still a shell.
      //
      // Until 2026-09-01 the arguments were dropped on the floor: `gjd-remote
      // ssh 'free -g'` opened a login shell, printed the MOTD and exited 0.
      let invocation;
      try {
        invocation = sshInvocation({ host: HOST(), sshOpts: SSH_OPTS_INTERACTIVE, words: rest });
      } catch (err) {
        die((err as Error).message);
      }
      return runOnTheBox("ssh", invocation.args, "inherit");
    }

    case "tunnel": {
      console.log(dim("open http://localhost:6080/vnc.html — and run `start-vnc` on the box"));
      console.log(dim("ctrl-c closes the tunnel"));
      // ExitOnForwardFailure is the whole command. Without it, a local 6080
      // already in use makes ssh print one line and CARRY ON with no forwarding
      // — and the shell it opened kept the process alive, so it looked exactly
      // like a working tunnel until the browser showed you whatever else was
      // already listening on that port.
      //
      // -N because there is nothing to run at the far end. The login shell was
      // only ever a side effect of not saying so, and it made the failure above
      // survivable in the first place.
      const target = HOST();
      return runOnTheBox(
        "ssh",
        ["-o", "ExitOnForwardFailure=yes", "-N", "-L", "6080:localhost:6080", ...SSH_OPTS_INTERACTIVE, target],
        "inherit",
      );
    }

    case "-h":
    case "--help":
    case "help":
      return console.log(HELP);

    default: {
      const known = ["ls", "log", "new-claude", "new-shell", "resume", "kill", "doctor", "provision", "clone", "push-env", "ssh", "tunnel", "forget-key"];
      // The containment clause is not decoration: `new` and `shell` were the
      // names of these two commands until 2026-08-31 and there are no aliases,
      // so the typo path is the whole migration. Two-char prefixes get `new`
      // to both new-* commands but leave `shell` with no suggestion at all,
      // because nothing in the list STARTS with it. Length-guarded, since
      // every string contains "".
      const near = known.filter(
        (k) =>
          k.startsWith(cmd.slice(0, 2)) ||
          cmd.startsWith(k.slice(0, 2)) ||
          (cmd.length >= 3 && k.includes(cmd)),
      );
      die(
        `unknown command '${cmd}'` +
          (near.length ? `\n  did you mean: ${near.join(", ")}?` : "") +
          `\n  gjd-remote --help  for the full list`,
      );
    }
  }
}

main();
