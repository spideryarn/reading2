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
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { constants, homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type EnvAllowance,
  type EnvPayload,
  SPIDERYARN_ALLOWANCE,
  assertPushableName,
  buildEnvPayload,
  diffKeys,
  parseEnv,
} from "./gjd-remote-env.js";
import {
  BOX_HOST_FILE,
  type HostSource,
  describeSource,
  readBoxHostFile,
  resolveHost,
} from "./gjd-remote-host.js";
import {
  type EnvPlan,
  type EnvPlanTone,
  type Policy,
  type Proposal,
  type ProposedKey,
  EnvPolicyError,
  PROPOSAL_MODEL,
  defaultProposalCall,
  policyPath,
  proposeEnvKeys,
  pushEnvPlan,
  readPolicy,
  writePolicy,
} from "./gjd-remote-envpolicy.js";
import {
  META,
  METADATA_VERSION,
  OVERSEER_ROLE,
  type OverseerClaim,
  type Session,
  type SessionKind,
  type SessionState,
  bindingsVerdict,
  buildBindingsScript,
  buildSessionScript,
  decideClaim,
  decideRelease,
  formatWait,
  escapeName,
  overseerClaim,
  parseSessions,
  printableName,
  resolveSession,
  sessionRepo,
  sessionState,
  setRoleCommand,
} from "./gjd-remote-tmux.js";
import { bootstrapProbeScript, buildProvisionRunner, cloudInitGate, provisionVerdict } from "./gjd-remote-provision.js";
import { declaredServers, mcpVerdict } from "./gjd-remote-mcp.js";
import {
  UPLOADS_DIR,
  WRITE_EXISTS_STATUS,
  remoteWriteScript,
  stagingPath,
  uploadDestination,
} from "./gjd-remote-upload.js";
import {
  haveTerminal,
  parseDuration,
  positionalName,
  sshInvocation,
  waitHandover,
  waitPreamble,
} from "./gjd-remote-run.js";
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
  type InventoryEntry,
  type OriginTransport,
  REPO_UNKNOWN,
  type RemoteCheckout,
  STAGING_PREFIX,
  describeLocalRepo,
  describeResolution,
  inventoryScript,
  isRepoValue,
  localRepo,
  originTransport,
  parseInventory,
  remoteSlug,
  resolveRemoteCheckout,
} from "./gjd-remote-repo.js";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  ConfigError,
  type RepoConfig,
  SETUP_SCRIPT,
  parseRepoConfig,
  readRepoConfig,
} from "./gjd-remote-config.js";
import {
  LOCKS_SUBDIR,
  SETUP_EXIT,
  type SetupExpectation,
  type SetupStatus,
  type SetupVerdict,
  describeVerdict,
  newSetupAttempt,
  parseSetupStatus,
  setupJobScript,
  setupPaths,
  setupSlugFile,
  setupStatusPath,
  setupVerdict,
} from "./gjd-remote-setup.js";
import {
  BOX_END,
  BOX_OK,
  boxConfigScript,
  parseBoxConfig,
  type CheckoutProbe,
  type LockState,
  LOCK_STATES,
  type SetupSpec,
  checkoutProbeScript,
  cloneTransactionScript,
  decodeBoxField,
  describeSpec,
  diffSetupSpec,
  foundGateDecision,
  needsTerminalSetupRecord,
  parseBoxRead,
  parseAdmission,
  parseCheckoutProbe,
  parseCloneTransaction,
  SETUP_READ_FIELDS,
  sessionAdmissionScript,
  setupFingerprint,
  setupGateDecision,
  setupReadScript,
  setupSpec,
  sha256,
} from "./gjd-remote-flow.js";
import {
  CANCELLED_NOTHING_CHANGED,
  Cancelled,
  NotInteractive,
  type PromptIo,
  checklistOrRefuse,
  confirmOrRefuse,
  promptIo,
} from "./gjd-remote-prompt.js";
import { withLedger } from "../src/cli-ledger.js";
import { loadEnvLocal } from "../src/env.js";
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

/**
 * THE TOOL ROOT: this checkout, found from the script's own location.
 *
 * It is where the box's own configuration lives — Terraform state (the
 * address), `provision.sh`, `remote-smoke-browser.mjs` — and it is NOT the repo
 * you are working on. Those things belong to the box, which is shared, so they
 * stay here however many repos the tool drives. Everything per-repo goes
 * through `resolveTarget()` instead.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USER = "greg";

/** Where checkouts live on the box, and where `clone` puts a new one. Box
 *  policy, not a property of any repo — see the plan's "The target contract". */
const REMOTE_CODE = `/home/${USER}/code`;

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
const yellow = (s: string) => styleText("yellow", s);
const cyan = (s: string) => styleText("cyan", s);

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
 * The address, and which of the three sources gave it — `GJD_REMOTE_HOST`, this
 * machine's own /etc/gjd-remote-host, or Terraform state. The order, the reasons
 * and the file's contract are in scripts/gjd-remote-host.ts; only the caching
 * and the Terraform read are here.
 *
 * Never a constant: on the laptop it changes on every rebuild, and a hardcoded
 * IP would be wrong exactly when you most need it.
 */
let cachedAddress: { host: string; source: HostSource } | undefined;

/** Terraform state's answer, or why it has none. Not run unless it is asked. */
function terraformHost(): { ok: true; host: string } | { ok: false; why: string } {
  try {
    const out = execFileSync("tofu", ["-chdir=" + path.join(REPO, "infra/hetzner"), "output", "-json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ip = JSON.parse(out)?.ipv4?.value;
    if (!ip) throw new Error("no ipv4 output");
    return { ok: true, host: ip as string };
  } catch (err) {
    return {
      ok: false,
      why:
        `could not read the server address from Terraform state (${(err as Error).message}).\n` +
        `  Run this from the repo, or set GJD_REMOTE_HOST=<ip> to override.\n` +
        `  On a machine that hosts sessions of its own, ${BOX_HOST_FILE} answers this instead —\n` +
        `  provisioning writes it, and this one has not got it.`,
    };
  }
}

/**
 * The address and its source, resolved once.
 *
 * Memoised for the process. HOST() is called on every ssh, scp and mosh, and
 * `new-claude` makes six of those — six `tofu output` subprocesses to answer a
 * question whose answer cannot change while we run. It also means an address
 * that stays consistent across one command even if somebody rebuilds the box
 * underneath us, which is the behaviour you want when half the work is done.
 *
 * ONE object rather than two `let`s. Two could be half-assigned by a later
 * branch — the host set, the source not — and the thing that then printed would
 * be a plausible provenance for an address that did not come from there.
 */
function address(): { host: string; source: HostSource } {
  if (cachedAddress) return cachedAddress;
  const answer = resolveHost({ env: process.env, boxFile: () => readBoxHostFile(), terraform: terraformHost });
  if (!answer.ok) die(answer.why);
  cachedAddress = { host: answer.host, source: answer.source };
  return cachedAddress;
}

const host = (): string => address().host;

/** Where the address came from, for the two commands that say so. */
const hostSource = (): HostSource => address().source;

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
  const r = sshRun(remote);
  if (opts.check !== false && r.status !== 0) {
    die(`ssh failed (${r.status}): ${r.stderr.trim() || "no output"}`);
  }
  return opts.raw ? r.stdout : r.stdout.trim();
}

/**
 * The whole answer — status, stdout and stderr — for the callers that have to
 * tell "the box said nothing" apart from "the box could not be asked".
 *
 * `ssh(…, { check: false })` returns stdout and throws the other two away, and
 * that is fine for a probe whose output IS the verdict. It is not fine for
 * anything whose empty answer means "there is nothing there": ssh exits 255 on
 * a dropped connection having printed nothing to stdout, and an empty stdout
 * that parses as an empty listing is what a clone gets started from.
 */
function sshRun(remote: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), remote], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/** The last thing the box said on stderr, for a message that has to fit on a
 *  line or two. Never the whole stream: ssh's failures are short and a wall of
 *  someone else's output buries the sentence that matters. */
function lastWords(stderr: string): string {
  return stderr.trim().split("\n").slice(-2).join(" ") || "no output";
}

/**
 * Put a file's worth of bytes on the box, in one round trip, and prove they
 * arrived whole.
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
 * The staging, the byte count and the atomic publish are all in the one `sh`
 * command that `remoteWriteScript` builds — the reasoning for each step is on
 * that function, in scripts/gjd-remote-upload.ts, where it can be tested by
 * running the real script against real directories rather than by reading it.
 *
 * `clobber: false` is the one thing a caller can be told about rather than
 * killed over: it comes back as `"exists"`, so `upload` can offer `--force`.
 * Every other failure still dies here, because for every other caller a write
 * that did not happen is the end of the run.
 */
function writeRemote(
  content: string | Buffer,
  remotePath: string,
  opts: { exec?: boolean; clobber?: boolean } = {},
): "written" | "exists" {
  // A Buffer goes through untouched. `upload` sends arbitrary files — a PNG, a
  // PDF — and re-encoding one as UTF-8 replaces every byte that is not valid
  // UTF-8 with U+FFFD, which arrives as a file of the right sort of size that
  // no viewer will open. The byte count then agrees with itself, because both
  // ends are counting the mangled bytes.
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  const bytes = buf.byteLength;
  // Unpredictable, and unique to this invocation. See stagingPath.
  const partId = randomUUID();
  const part = stagingPath(remotePath, partId);
  const cmd = remoteWriteScript({
    dest: remotePath,
    partId,
    bytes,
    exec: opts.exec === true,
    clobber: opts.clobber !== false,
  });
  const r = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), cmd], {
    input: buf,
    encoding: "utf8",
  });
  if (r.status === WRITE_EXISTS_STATUS && opts.clobber === false) return "exists";
  if (r.status !== 0) {
    spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), `rm -f ${shq(part)}`], { stdio: "ignore" });
    die(`writing ${remotePath} failed (${r.status}): ${(r.stderr || "").trim() || `${bytes} bytes did not arrive intact`}`);
  }
  return "written";
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
function attachCmd(id: string, transport: "mosh" | "ssh"): string {
  // Name the terminal tab after the session, and keep it named: `ls` renames a
  // placeholder session to Claude's own title for the work, and tmux pushes the
  // new title out to the attached client the moment that happens. Measured on
  // tmux 3.7b: `ESC]0;<name>BEL` on attach, and one more on each rename —
  // nothing in between, so this is not a per-frame cost.
  //
  //  $N:     tmux's own session id, not the name — see `Session.id`. It needs
  //          no `=` exact-match prefix (an id is exact by construction) and it
  //          cannot have become somebody else's session between the list being
  //          read and this running, which a name can. The COLON is still
  //          required on `set-option -t`, which takes a target *pane*: `-t $3`
  //          fails there where `-t $3:` works.
  //  "#S"    quoted, or `#` starts a comment to the remote shell.
  //
  // `shq` on every target, because an unquoted `$N` is a POSITIONAL PARAMETER
  // to the remote shell. It expands to nothing, `-t` then eats the next word,
  // and the command addresses something nobody asked for.
  //
  // No `|| exec bash -l` here: a failed attach must fail. The job script keeps
  // the session alive after Claude exits, so nothing needs this as a safety net.
  const inner =
    `tmux set -t ${shq(`${id}:`)} set-titles on && ` +
    `tmux set -t ${shq(`${id}:`)} set-titles-string "#S" && ` +
    `tmux attach -d -t ${shq(id)}`;
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
  const r = handOverToTheBox(file, args, stdio);
  // The shell convention for "died on a signal", because `process.exit(null ?? 0)`
  // would report a Ctrl-C'd tunnel to the calling shell as a success.
  if (r.signal) return process.exit(128 + (constants.signals[r.signal] ?? 0));
  return process.exit(r.status ?? 0);
}

/**
 * The handover itself, without the exit — because ONE caller has work left to
 * do afterwards.
 *
 * `gjd-remote setup` attaches so somebody can watch the install, and then has
 * to read the status file to say how it went; the job's pane deliberately
 * outlives the job (`exec bash -l`), so the pane's exit code is a login shell's
 * and proves nothing either way. Every other caller hands the terminal over and
 * is finished, which is what `runOnTheBox` above still is.
 */
function handOverToTheBox(
  file: string,
  args: string[],
  stdio: StdioOptions,
): { status: number | null; signal: NodeJS.Signals | null } {
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
  return { status: r.status, signal: r.signal };
}

/** Everything an attach does except handing over the terminal, which is the one
 *  step its two callers disagree about. */
function attachHandover(
  target: AttachTarget,
  force?: string,
): { status: number | null; signal: NodeJS.Signals | null } {
  const keyboard = interactiveStdin();
  if (keyboard === null) {
    die(
      "the prompt came in on stdin, so there is no terminal left to attach with.\n" +
        `  The session is running: gjd-remote resume ${printableName(target.name)}.\n` +
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
  const command = attachCmd(target.id, transport);
  return handOverToTheBox("sh", ["-c", command], [keyboard, "inherit", "inherit"]);
}

/**
 * What it takes to attach: tmux's id to address, and the name to say out loud.
 *
 * Both, because they answer different questions and neither stands in for the
 * other — the id is unambiguous and means nothing to a reader, the name is what
 * the person typed and is the only half worth putting in a sentence.
 */
type AttachTarget = { id: string; name: string };

function attach(target: AttachTarget, force?: string): never {
  const r = attachHandover(target, force);
  if (r.signal) return process.exit(128 + (constants.signals[r.signal] ?? 0));
  return process.exit(r.status ?? 0);
}

/**
 * Attach, and come back — for `setup`, which has to read the status file once
 * the watching is over.
 *
 * A failed attach is NOT fatal here, and that is deliberate: the setup job is
 * running on the box whatever happens to this terminal, so the useful thing is
 * to say the watching did not work and then go and read the verdict anyway.
 */
function attachAndReturn(target: AttachTarget, force?: string): void {
  const r = attachHandover(target, force);
  if (r.signal) {
    console.log(dim(`\n(the attach ended on ${r.signal}; the job on the box is unaffected)`));
    return;
  }
  if ((r.status ?? 0) !== 0)
    console.log(
      yellow(`the attach to ${printableName(target.name)} exited ${r.status} — reading the status file anyway`),
    );
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

type Fleet = {
  list: Session[];
  /** Status by Claude session id, or null when the box could not be asked. */
  agents: Map<string, string> | null;
  /** Why not, when it is null. */
  agentsWhy: string | null;
};

/**
 * The box's sessions, and — only when asked — what Claude Code says it is doing
 * in each.
 *
 * THE ASKING IS OPTIONAL, and that is not a tidiness thing. `claude agents
 * --json` costs about 0.65s of process startup on the box, and only `ls` shows
 * states: `new-claude` checking a name is free, `resume` and `kill` want the
 * list and nothing else, and must neither pay for it nor be able to hang on it.
 * An earlier version ran it on every command while its own comment claimed
 * otherwise, which GPT Sol found. One round trip either way — the agents
 * question rides along with the tmux one rather than costing a second ssh.
 */
function fleet(opts: { agents: boolean } = { agents: false }): Fleet {
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
  const { sessions: list, unreadable, failure, agents, agentsWhy } = parseSessions(ssh(buildSessionScript(opts)));
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
  return { list, agents, agentsWhy };
}

/** Just the sessions, for the callers that only want to know what exists. */
function sessions(): Session[] {
  return fleet().list;
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
    // Addressed by id, and quoted: the old name came off the box and need not
    // satisfy SLUG, and an unquoted `$N` is a positional parameter to the
    // remote shell. `want` is a fresh slug, quoted beside it rather than
    // trusted to stay one.
    ssh(
      `tmux rename-session -t ${shq(s.id)} ${shq(want)} && ` +
        `tmux set-environment -t ${shq(s.id)} GJD_PROVISIONAL 0`,
    );
    console.error(dim(`renamed ${escapeName(s.name)} → ${want}`));
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

// ------------------------------------------------- which repo, and where

/**
 * WHICH REPO, AND WHERE ON THE BOX — the one question every per-repo command
 * asks, answered in one place.
 *
 * There are three roots and they are not the same directory (the plan's "The
 * target contract"):
 *
 *  - the **tool root** is `REPO` above: Terraform state, `provision.sh`, the
 *    browser smoke test. Shared box, shared tool, one copy.
 *  - the **local target** is the toplevel of the repo you are standing in. It
 *    is where `push-env` reads `.env.local` from.
 *  - the **remote target** is the verified checkout on the box: where a session
 *    starts, where `.env.local` is written, whose `.mcp.json` `doctor` checks.
 *
 * Identity is the git origin of the cwd's repo, never a folder name — so
 * `spideryarn/reading2` is found at `~/code/spideryarn2` with no registry
 * anywhere, and the laptop moving between Dropbox and `~/dev` changes nothing.
 */
type Identity = {
  slug: string;
  owner: string;
  name: string;
  /** The repo's toplevel on THIS machine, or null when `--repo` named a repo
   *  we are not standing in. `push-env` needs it and refuses without it. */
  localToplevel: string | null;
};

/** Which repo the user means: `--repo` if given, else the cwd's origin. The
 *  refusal carries its own wording, because "not a repo" and "a repo with no
 *  origin" need different next steps. */
function identify(repoOpt: string | undefined): { ok: true; id: Identity } | { ok: false; why: string } {
  const here = localRepo(process.cwd());
  if (repoOpt !== undefined) {
    const r = parseRepo(repoOpt);
    const slug = `${r.owner}/${r.name}`.toLowerCase();
    return {
      ok: true,
      id: {
        slug,
        owner: r.owner,
        name: r.name,
        localToplevel: here.kind === "repo" && here.slug === slug ? here.toplevel : null,
      },
    };
  }
  if (here.kind !== "repo") return { ok: false, why: describeLocalRepo(here) };
  return { ok: true, id: { slug: here.slug, owner: here.owner, name: here.name, localToplevel: here.toplevel } };
}

/**
 * Everything directly under `~/code`, strictly parsed. One round trip, and it
 * fails closed twice over.
 *
 * THE SSH STATUS IS PART OF THE ANSWER. It used to be discarded — `check:
 * false`, stdout parsed, status thrown away — and the failure that hides in
 * that is not exotic: any non-zero ssh whose stdout still looks like a finished
 * listing reads as "nothing is under ~/code", which is the one answer that
 * makes the tool clone. So a non-zero status is rejected BEFORE the parse, and
 * the script's own refusals exit 0 and say `GJDERR` precisely so that the
 * status means one thing only. GPT Sol's Stage 1 review, blocker 1.
 *
 * A missing `~/code` is still an empty inventory — but a DELIBERATE one: the
 * script reports the folder's existence as its own field and the parser refuses
 * a reply that leaves it out. Nothing here creates the folder.
 */
function inventory(base = REMOTE_CODE): { entries: InventoryEntry[]; baseExists: boolean } {
  const r = sshRun(inventoryScript(base));
  if (r.status !== 0) {
    die(
      `could not list ${base} on the box: ssh exited ${r.status ?? "on a signal"}.\n` +
        `  ${lastWords(r.stderr)}\n` +
        `  Nothing is concluded from a listing that failed — least of all that the repo\n` +
        `  is absent, which is the answer that would start a clone.`,
    );
  }
  const got = parseInventory(r.stdout);
  if (!got.ok) die(`could not read ${base} on the box: ${got.why}`);
  return { entries: got.entries, baseExists: got.baseExists };
}

/** The inventory row for one path, by listing its parent. The same script and
 *  the same strict parse as everything else — a second way of asking "whose
 *  checkout is this?" would be a second way of getting it wrong. */
function entryAt(dir: string): InventoryEntry | undefined {
  const want = dir.replace(/\/+$/, "") || "/";
  return inventory(path.posix.dirname(want)).entries.find((e) => (e.dir.replace(/\/+$/, "") || "/") === want);
}

/** Where the repo lives on the box. `~/code/<name>` is only the PROPOSAL — a
 *  checkout under any other name with the right origin is the answer. */
function remoteCheckout(id: Identity): RemoteCheckout {
  return resolveRemoteCheckout(id.slug, `${REMOTE_CODE}/${id.name}`, inventory().entries);
}

/**
 * A directory named by hand must be the repo we are standing in, or the command
 * is about to do this repo's work in another repo's tree. Gives back the entry
 * it verified, so the caller need not ask the box a second time.
 *
 * This is the check that makes `GJD_REMOTE_REPO` safe to keep: as a silent
 * default it could steer a hellozenno `push-env` into Spideryarn's checkout,
 * which is exactly what an allowlisted secret must never do.
 *
 * IT SETS THE SAME BAR AS AUTOMATIC RESOLUTION, and it did not until GPT Sol's
 * Stage 1 review: it compared origins and looked at nothing else, so a symlink
 * or an interrupted clone that `resolveRemoteCheckout` blocks by name was
 * waved through the moment somebody typed `--dir`. A hand-typed path is not a
 * reason to check less.
 */
function assertSameRepo(dir: string, id: Identity, what: string): InventoryEntry {
  const e = entryAt(dir);
  const found = e?.isCheckout && e.origin !== undefined ? remoteSlug(e.origin) : undefined;
  if (e !== undefined && found === id.slug && !e.isSymlink && e.hasHead) return e;
  const wrong =
    e === undefined
      ? "does not exist"
      : e.isSymlink
        ? "is a symlink, and symlinks are never followed here"
        : !e.isCheckout
          ? "is not a git checkout"
          : found === undefined
            ? "is a checkout with an origin I do not recognise"
            : found !== id.slug
              ? found
              : "is a half-finished checkout — its HEAD does not resolve";
  die(
    `${what} points at ${dir} on the box, and that is not a usable checkout of ${id.slug}.\n` +
      `  you are in: ${id.slug}\n` +
      `  that path:  ${wrong}\n` +
      `  Nothing was touched. Drop ${what}, or point it at this repo's checkout.`,
  );
}

/** Said out loud every time it is used, rather than obeyed quietly: an env var
 *  that redirects which tree a session opens in — or which checkout a file full
 *  of credentials lands in — is a thing you want reminding is set. */
function sayDeprecated(): void {
  console.error(yellow(`GJD_REMOTE_REPO is deprecated — it is an alias for --dir, and --dir wins over it.`));
}

/** Where this command is about to act, said out loud. Printed before anything
 *  happens, because which tree an agent is about to edit — or which checkout a
 *  file full of credentials is about to land in — should never be something you
 *  find out afterwards. */
type Target = {
  slug: string | null;
  localToplevel: string | null;
  dir: string;
  via: "--dir" | "GJD_REMOTE_REPO" | "origin";
  originTransport: OriginTransport | null;
  /**
   * Was `dir` PROVED to be a checkout of `slug` — by the box, this run?
   *
   * True on the origin path, where the box was asked which directory carries
   * that origin, and on any path where `assertSameRepo` ran. False only for an
   * explicit `--dir` that nothing verified, which is exactly the case where the
   * laptop's repo says nothing about the tree being opened.
   */
  verified: boolean;
};

function announce(t: Target): Target {
  console.log(
    dim(`repo: ${t.slug ?? "unknown — an explicit directory was given"}`) +
      (t.localToplevel ? dim(`  (${t.localToplevel})`) : ""),
  );
  console.log(dim(`box:  ${t.dir}${t.via === "origin" ? "" : `  (${t.via})`}`));
  return t;
}

/**
 * The slug to attribute a session to, or the admission that there is not one.
 *
 * ONLY A VERIFIED TARGET CLAIMS A REPO. That is the origin path, where the box
 * was asked which directory carries this origin and answered, and any path
 * where `assertSameRepo` proved it — which now includes the deprecated env var,
 * because `namedDir` refuses it outright unless it verified. An unverified
 * `--dir` is an arbitrary path — `-d ~` is a home directory — and `t.slug`
 * there is the repo the LAPTOP was standing in, which says nothing about the
 * tree the session will open in. Writing it into `GJD_REPO` would make `ls`
 * claim, in a column people will filter on, that a session in `~` belongs to
 * Spideryarn.
 *
 * The env var used to be lumped in with `--dir` and reported as `(unknown)`
 * even when its origin had been compared. That threw away a fact we had proved
 * (GPT Sol's Stage 1 review, finding 7); the deprecation line is printed every
 * time it is used, which is the honest way to nag about it.
 */
function targetRepo(t: Target): string {
  return t.verified && t.slug !== null ? t.slug : REPO_UNKNOWN;
}

/**
 * The `-e` flags that let `ls` say which repo a session is for, a whole session
 * after everything that knew it has exited.
 *
 * Built from `META` and `METADATA_VERSION` rather than typed out, because the
 * reader in scripts/gjd-remote-tmux.ts asks tmux for those exact names and a
 * second spelling of one is a spelling that stops matching. Every value goes
 * through `shq`: `dir` is a path somebody typed and the slug is validated but
 * not by this process.
 *
 * `dir` is the directory the session actually starts in, which is the one
 * `sessionDir()` proved enterable — not `t.dir`, so that the two cannot differ.
 */
function metaFlags(t: Target, dir: string, kind: SessionKind): string {
  // VALIDATED HERE, immediately before the session is created, and not only
  // where the values were made. A session records this metadata for the rest of
  // its life and `ls` refuses the WHOLE listing over one bad record — so a
  // value the reader would reject must stop the one session being created,
  // rather than break the listing for every other session on the box. The slug
  // producer is strict now too (`remoteSlug`); this is the check that does not
  // depend on that staying true. GPT Sol's Stage 1 review, blocker 2.
  const repo = targetRepo(t);
  if (!isRepoValue(repo)) {
    die(`refusing to start a session labelled '${repo}', which is not a repo I could read back later.`);
  }
  if (!dir.startsWith("/") || /[\r\n\0]/.test(dir)) {
    die(`refusing to start a session in '${dir}': the directory must be an absolute path with nothing odd in it.`);
  }
  return [
    `-e ${META.version}=${shq(METADATA_VERSION)}`,
    `-e ${META.kind}=${shq(kind)}`,
    `-e ${META.repo}=${shq(repo)}`,
    `-e ${META.dir}=${shq(dir)}`,
  ].join(" ");
}

/**
 * The whole resolution, in the order the plan sets out: `--dir` wins, then the
 * deprecated env var, then the repo you are standing in.
 *
 * `--dir` is deliberately an ARBITRARY directory — `-d ~` is a home directory
 * and not a repo at all — so it does not need an identity and prints "unknown".
 * Everything else needs one, and refuses rather than guessing.
 */
function resolveTarget(opts: {
  repo?: string | undefined;
  dir?: string | undefined;
  /** push-env: no identity, no push — and a `--dir` must be this repo. */
  requireIdentity?: boolean;
}): Target {
  const r = resolveOrExplain(opts);
  if (r.kind === "target") return r.target;
  onNotFound(r.id, r.checkout);
}

/**
 * The resolution above, with the one arm that a session can DO something about
 * handed back instead of ending the run.
 *
 * Only `new-claude` and `new-shell` want that: on `absent` they may offer to
 * clone and set the repo up (`resolveTargetForSession`). Every other command
 * goes through `resolveTarget`, which turns the same value into the refusal it
 * always was — so there is one resolution, not two that can drift.
 */
type Resolution =
  | { kind: "target"; target: Target }
  | { kind: "unresolved"; id: Identity; checkout: Exclude<RemoteCheckout, { kind: "found" }> };

function resolveOrExplain(opts: {
  repo?: string | undefined;
  dir?: string | undefined;
  requireIdentity?: boolean;
}): Resolution {
  const envDir = process.env.GJD_REMOTE_REPO;
  const givenDir = opts.dir ?? envDir;
  const via: Target["via"] = opts.dir !== undefined ? "--dir" : envDir !== undefined ? "GJD_REMOTE_REPO" : "origin";
  const id = identify(opts.repo);

  if (via === "GJD_REMOTE_REPO") sayDeprecated();

  if (givenDir !== undefined) {
    return { kind: "target", target: announce(namedDir(givenDir, via, id, opts.requireIdentity ?? false)) };
  }

  if (!id.ok) die(id.why);
  const r = remoteCheckout(id.id);
  if (r.kind !== "found") return { kind: "unresolved", id: id.id, checkout: r };
  return {
    kind: "target",
    target: announce({
      slug: id.id.slug,
      localToplevel: id.id.localToplevel,
      dir: r.dir,
      via: "origin",
      originTransport: r.originTransport,
      // The box was asked which directory carries this origin, and answered.
      verified: true,
    }),
  };
}

/**
 * A directory somebody named, checked as far as it can be.
 *
 * The identity is optional here and that is the point of `--dir`: `-d ~` is a
 * home directory, not a repo, and printing "unknown" is the honest answer. It
 * becomes compulsory the moment the command carries this repo's data
 * (`push-env`), and the ORIGIN is compared whenever the path came from the
 * deprecated env var, because nobody typed that today and it must not steer one
 * repo's work into another's tree.
 */
function namedDir(
  given: string,
  via: Target["via"],
  id: ReturnType<typeof identify>,
  requireIdentity: boolean,
): Target {
  const what = via === "origin" ? "--dir" : via;
  const dir = remotePath(given, what);
  // THE ENV VAR NEEDS AN IDENTITY EVEN WHEN THE COMMAND DOES NOT. `--dir` is
  // something a person just typed, so an arbitrary path is a fair thing to
  // mean; `GJD_REMOTE_REPO` is ambient, and from a directory that is not a repo
  // it silently redirected `new-*` into whatever it named, with nothing to
  // compare it against. An ambient redirect that cannot be checked is refused.
  // GPT Sol's Stage 1 review, finding 5.
  const mustVerify = requireIdentity || via === "GJD_REMOTE_REPO";
  if (!id.ok && mustVerify) {
    die(
      via === "GJD_REMOTE_REPO"
        ? `${id.why}\n` +
            `  GJD_REMOTE_REPO is set, and it may not redirect a command whose repo I\n` +
            `  cannot identify. Unset GJD_REMOTE_REPO, or pass --dir to say you meant it.`
        : id.why,
    );
  }
  const entry = id.ok && mustVerify ? assertSameRepo(dir, id.id, what) : undefined;
  return {
    slug: id.ok ? id.id.slug : null,
    localToplevel: id.ok ? id.id.localToplevel : null,
    dir,
    via,
    originTransport: entry?.origin === undefined ? null : originTransport(entry.origin),
    verified: entry !== undefined,
  };
}

/**
 * No single checkout on the box, so nothing starts.
 *
 * `absent` is the one arm a session can do something about, and
 * `resolveTargetForSession` below takes it before this is reached. Everything
 * else — `ambiguous`, every `blocked` reason — is a refusal for every command
 * alike: there is a tree in the way, or two, and choosing one is exactly the
 * guess this tool does not make.
 */
function onNotFound(id: Identity, r: Exclude<RemoteCheckout, { kind: "found" }>): never {
  die(describeResolution(id.slug, r));
}

// --------------------------------------------- clone-then-setup, for a session

/**
 * ## Starting a session in a repo the box has never had
 *
 * Stage 3 of docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md,
 * and it is Greg's answer to the question the plan opens with: **ask, then
 * clone + setup, and refuse the session if setup fails.**
 *
 * Only `new-claude` and `new-shell` come through here. `push-env`, `setup`,
 * `doctor` and `clone` all still refuse an absent checkout, because none of
 * them is a request to start work in one.
 *
 * The order below is the design, and each step is a thing that can be wrong:
 *
 *  1. **Ask before anything.** One question, defaulting to No, showing the
 *     directory and the command that would run. Off a terminal it is a refusal
 *     naming `gjd-remote clone` and `gjd-remote setup` — never a silent yes.
 *  2. **The command shown first comes from the LAPTOP's checkout**, because
 *     that is the copy the person answering can see. When there is no local
 *     checkout (`--repo` from somewhere else) it is honestly unknown until the
 *     clone has happened.
 *  3. **After the clone the config is re-read from the cloned commit** — GPT
 *     Sol's blocker 4 — and if it resolves to a different command than the one
 *     that was approved, it asks again. When nothing was approved because
 *     nothing was known, that second question is the first one that can name
 *     the command, so it is always asked.
 *  4. **Setup runs as the ordinary tool-owned tmux job**, the same `runSetup`
 *     `gjd-remote setup` uses, and **the session is created only on a `success`
 *     status file for that attempt** (Sol's blocker 2). `--no-attach` therefore
 *     starts setup and stops: nobody read a verdict, so nothing may assume one.
 */
async function resolveTargetForSession(opts: {
  repo?: string | undefined;
  dir?: string | undefined;
  /** `--no-attach`: watch nothing, and so start nothing that needs watching. */
  attach: boolean;
  transport?: string | undefined;
  /** `gjd-remote new-claude` / `new-shell` — the command to tell them to re-run. */
  what: string;
}): Promise<SessionStart> {
  const first = resolveOrExplain({ repo: opts.repo, dir: opts.dir });
  if (first.kind === "target") return sayFoundSetupStatus(first.target);
  if (first.checkout.kind !== "absent") onNotFound(first.id, first.checkout);

  await cloneThenSetUp(first.id, first.checkout.proposedDir, opts);

  // Resolved AGAIN, by origin, through the same box-side scan as every other
  // run: the directory a session starts in is one the box named a moment ago,
  // never one this process remembers having made. It also re-reads the status
  // file it has just watched be written, which is the check the next run would
  // do anyway.
  const again = resolveOrExplain({ repo: opts.repo, dir: opts.dir });
  if (again.kind !== "target") onNotFound(again.id, again.checkout);
  return sayFoundSetupStatus(again.target);
}

/**
 * How a session is allowed to start in a checkout the box already has: the
 * directory, and the lock-and-status ticket the `tmux new-session` must be run
 * under.
 *
 * `admit: null` means "run the command plainly", and it is the honest answer in
 * exactly one case: a `--dir` target, which is an arbitrary path with no repo
 * and so no setup status to be admitted against. A status read that FAILED is
 * not the other case — it used to be, and it was a session with no ticket in a
 * tree nobody had checked; it refuses now, and `--dir` is the way past it.
 */
type SessionStart = { target: Target; admit: AdmissionPlan | null };

/**
 * What the box must still be saying when the session is actually created.
 *
 * The three paths and the bytes, gathered when the gate was decided and handed
 * to `sessionAdmissionScript` unchanged — see `startUnderAdmission`.
 */
type AdmissionPlan = {
  slug: string;
  lockPath: string;
  locksDir: string;
  statusPath: string;
  /** The base64 the status read came back with, or null for "there was none". */
  expect: string | null;
};

/**
 * What the setup status file says about a checkout that IS on the box, and
 * whether that is a reason not to start.
 *
 * The policy itself is `foundGateDecision` in scripts/gjd-remote-flow.ts, where
 * tests/gjd-remote-flow.test.ts walks every cell of it. This is the round trip
 * and the printing.
 *
 * Reading the status COSTS ONE SSH, and reading the box's config costs a second
 * — so the second is only paid when there is a status to judge. With no status
 * at all `setupVerdict` answers `never-run` whatever it is handed.
 *
 * **The decision it makes here is not the guarantee.** It is true at the moment
 * of reading, and `tmux new-session` happens some seconds later; the ticket
 * this returns is what makes it still true then — GPT Sol's Stage 3 finding 1.
 */
function sayFoundSetupStatus(t: Target): SessionStart {
  // A `--dir` nobody verified is an arbitrary path — `-d ~` is a home directory
  // — and there is no repo whose setup status could be asked about.
  if (t.slug === null || !t.verified) return { target: t, admit: null };

  const state = readSetupState(t.slug, t.dir);
  if (!state.ok) {
    // Fatal, and this used to be a yellow line. A status that cannot be READ is
    // not a status that is absent: a cut ssh stream, a broken protocol and a
    // box that is half-way through a rebuild all look like this, and starting
    // a session on any of them is a session with no ticket in a tree nobody
    // has checked. `--dir` is the deliberate bypass, and it prints `repo:
    // unknown` so nobody mistakes it for the admitted kind.
    die(
      `could not read the setup status for ${t.slug} on the box: ${state.why}\n` +
        `  No session started. gjd-remote resolve says what the box thinks; to start anyway,\n` +
        `  name the directory yourself:  --dir ${t.dir}`,
    );
  }

  // When the box has no setup command at all, the status's own hash stands in:
  // "the config changed" is a claim, and there is nothing here to make it
  // against. The identity fields are not optional in the same way — those are
  // what say whether this status is about this tree at all.
  const sha = state.status === undefined ? "" : expectedConfigSha(t.dir, state.status.configSha256);
  // UNREADABLE IS PASSED IN rather than folded into a verdict, and it refuses:
  // GPT Sol's Stage 3 finding 1. This used to print a yellow line and start the
  // session anyway. Something wrote that file, and a verdict nobody can parse
  // is not evidence of readiness — it is evidence that we do not know.
  const gate = foundGateDecision(
    setupVerdict(
      state.status,
      setupExpectation({ attempt: null, configSha256: sha, slug: t.slug, dir: t.dir, inode: state.inode }),
    ),
    state.lock,
    state.unreadable,
  );
  if (gate.kind === "refuse") die(gate.why);
  if (gate.kind === "warn") console.log(yellow(gate.line));

  const paths = setupReadPaths(t.slug);
  return {
    target: t,
    admit: {
      slug: t.slug,
      lockPath: paths.lockPath,
      locksDir: `${REMOTE_WORK}/${LOCKS_SUBDIR}`,
      statusPath: paths.statusPath,
      expect: state.raw,
    },
  };
}

/**
 * Create the session under the setup lock, or say what stopped it — the second
 * half of GPT Sol's Stage 3 finding 1.
 *
 * `sayFoundSetupStatus` decided on bytes it read seconds ago. In between, a
 * `gjd-remote setup` in another terminal can take the lock and start rewriting
 * the tree, and no amount of care in the gate closes that window. So the
 * `tmux new-session` is run BY THE BOX, holding the same lock a setup takes,
 * against the same bytes we decided on — `sessionAdmissionScript` in
 * scripts/gjd-remote-flow.ts.
 *
 * A `--dir` target has no ticket and runs plainly. That is the escape hatch it
 * has always been: an arbitrary path is not a repo, and there is no status file
 * that could be about it.
 *
 * **It leaves the lock FILE behind**, because taking a lock means opening the
 * path: after the first admitted session, a repo's lock state reads `free`
 * rather than `none`. Nothing anywhere distinguishes those two — only `held`
 * and `noflock` are ever acted on — so this is a note for whoever adds a third
 * meaning, not a defect. Observed on the box on 2026-09-02.
 */
function startUnderAdmission(plan: AdmissionPlan | null, command: string, name: string): void {
  if (plan === null) {
    ssh(command);
    return;
  }
  const r = sshRun(
    sessionAdmissionScript({
      lockPath: plan.lockPath,
      locksDir: plan.locksDir,
      statusPath: plan.statusPath,
      expect: plan.expect,
      command,
    }),
  );
  if (r.status !== 0) {
    die(
      `ssh failed while admitting the session (${r.status ?? "on a signal"}): ${lastWords(r.stderr)}\n` +
        `  I do not know whether '${name}' was created — gjd-remote ls`,
    );
  }
  const got = parseAdmission(r.stdout);
  if (!got.ok) {
    // FAILS CLOSED, and the sentence has to as well: the reply is unreadable,
    // so the command may have run. Saying "nothing started" here would be the
    // one lie this whole path exists to avoid.
    die(
      `the box's answer about starting '${name}' was not one I can read: ${got.why}\n` +
        `  The session MAY exist — gjd-remote ls   # gjd-remote kill ${name}, if it does`,
    );
  }
  const a = got.admission;
  if (a.kind === "held") {
    die(
      `a setup for ${plan.slug} took the box-side lock just now — nothing was started.\n` +
        `  Starting a session in a tree mid-install gives an agent a half-built repo.\n` +
        `  gjd-remote setup --status --repo ${plan.slug}   # wait for it, then try again`,
    );
  }
  if (a.kind === "changed") {
    die(
      `${plan.slug}'s setup status changed while I was starting the session — nothing was started.\n` +
        `  ${sayChangedStatus(a.status, plan)}\n` +
        `  gjd-remote setup --status --repo ${plan.slug}   # what it says now`,
    );
  }
  if (a.code !== 0) {
    die(`tmux exited ${a.code} on the box, so '${name}' was not created`);
  }
}

/** What the status file says NOW, in one line, for the refusal above. Parsed
 *  rather than printed: the file is JSON, and what a reader wants from it is
 *  the verdict. */
function sayChangedStatus(text: string | undefined, plan: AdmissionPlan): string {
  if (text === undefined) return `the status file at ${plan.statusPath} is gone`;
  const parsed = parseSetupStatus(text);
  if (!parsed.ok) return `and the file there now is not one I can read: ${parsed.why}`;
  return `it is now about attempt ${parsed.status.attempt}, outcome ${parsed.status.outcome}`;
}

/**
 * The fingerprint of the setup the BOX would run today, or `fallback` when
 * there is no answer to be had — an unreadable config, or a repo with no setup
 * command.
 *
 * `setupFingerprint` over the whole specification, never the two command
 * STRINGS: GPT Sol's Stage 3 finding 2. `./.gjd-remote/setup` is the same eight
 * characters whatever the script behind it now contains, so hashing the
 * commands let a repo whose setup script was rewritten under it keep its old
 * success. The same function answers here, in `gjd-remote setup`, in `doctor`
 * and in the job that writes the status, so the four cannot disagree.
 */
function expectedConfigSha(dir: string, fallback: string): string {
  const box = readBoxConfig(dir);
  if (!box.ok) {
    console.log(yellow(`could not read this repo's config on the box: ${box.why}`));
    return fallback;
  }
  if (box.config.setup.source === "none") return fallback;
  return setupFingerprint(box.spec);
}

/**
 * The setup specification as this LAPTOP's checkout has it — what the first
 * question can honestly show, before there is a cloned commit to read.
 *
 * `unknown` is not a failure: `--repo` from outside the repo is the ordinary
 * way to reach it, and a config this laptop cannot parse is the other. Either
 * way the question after the clone becomes the first one that names a command,
 * and it is always asked.
 */
type SetupPreview = { kind: "known"; spec: SetupSpec; shown: string } | { kind: "unknown"; why: string };

function previewSetup(id: Identity): SetupPreview {
  if (id.localToplevel === null) {
    return { kind: "unknown", why: `setup command unknown until cloned (you are not in a local checkout of ${id.slug})` };
  }
  let here: { config: RepoConfig; spec: SetupSpec };
  try {
    here = localSpec(id.localToplevel);
  } catch (err) {
    return {
      kind: "unknown",
      why: `this laptop's config is unusable, so the command is unknown until cloned: ${err instanceof ConfigError ? err.message : String(err)}`,
    };
  }
  if (here.config.setup.source === "none") {
    return {
      kind: "known",
      spec: here.spec,
      shown: `(none known here — no ${CONFIG_FILE}, no ${SETUP_SCRIPT}, no npm 'setup' script)`,
    };
  }
  // `describeSpec` carries the SCRIPT's hash when a script is what runs,
  // because `./.gjd-remote/setup` names a file rather than saying what it does
  // — and the file is what would run.
  return { kind: "known", spec: here.spec, shown: describeSpec(here.spec) };
}
/**
 * Ask, clone, re-read the config, ask again if it changed, and run setup.
 *
 * Returns only when the box holds a checkout whose setup wrote a `success`
 * status for the attempt this function watched. Every other outcome ends the
 * run — with the clone left in place, because a cloned tree is a fact worth
 * keeping and `gjd-remote setup` is how you retry against it.
 */
async function cloneThenSetUp(
  id: Identity,
  proposedDir: string,
  opts: { attach: boolean; transport?: string | undefined; what: string },
): Promise<void> {
  const preview = previewSetup(id);
  console.log(yellow(`${id.slug} is not on the box.`));
  console.log(dim(`  clone to: ${proposedDir}`));
  console.log(dim(`  setup:    ${preview.kind === "known" ? preview.shown : preview.why}`));

  const yes = await confirmOrRefuse(
    `Clone ${id.slug} to ${proposedDir} and run its setup, then start the session?`,
    promptStreams(),
    {
      default: false,
      instead:
        `Nothing was cloned. From a terminal, or do the two halves yourself:\n` +
        `    gjd-remote clone ${id.slug}\n` +
        `    gjd-remote setup --repo ${id.slug}`,
    },
  );
  if (!yes) die(`nothing was cloned, and no session was started.`);

  // `owner/name` as git recorded them, not the lower-cased slug: GitHub does
  // not care, but the URL this clones from is the URL the transaction compares
  // the recorded remote against, and the two must be the same string.
  const repo = parseRepo(`${id.owner}/${id.name}`);
  const dest = proposedDir;
  const base = path.posix.dirname(dest);
  const dirName = path.posix.basename(dest);
  if (!GH_REPO.test(dirName)) die(`'${dirName}' is not a usable directory name on the box`);
  const tokenFile = `${TOKEN_DIR}/${repo.owner}.token`;

  console.log(bold(`gjd-remote clone ${repo.owner}/${repo.name} → ${HOST()}:${dest}`));
  requireToken(repo, tokenFile);
  // THE SAME LOCKED TRANSACTION `gjd-remote clone` uses, and that is the point
  // of it being one function: the automatic clone is the one nobody is reading
  // the output of, and it re-resolves the destination under the lock — so the
  // `absent` this flow started from cannot go stale while a question sits on
  // screen waiting for an answer.
  const after = ensureRemoteCheckout(repo, { base, dest, dirName, slug: id.slug });
  console.log(green(`✓ cloned ${id.slug}`));
  describeCheckout(after);

  // FROM HERE ON "nothing changed" IS FALSE, and that is GPT Sol's Stage 3
  // finding 4: `main()`'s one sentence for a Ctrl-C said it anyway, at a
  // question that is only asked once the tree is on the box. The phase is this
  // try, rather than a variable somebody has to remember to set, so a prompt
  // added below inherits the right sentence instead of the old one.
  try {
    await setUpTheClone(id, repo, dest, preview, opts);
  } catch (err) {
    if (err instanceof Cancelled) {
      throw new Cancelled(`cancelled: the clone at ${dest} remains; setup and the session were not started`);
    }
    throw err;
  }
}

/**
 * Read the cloned commit's own config, ask again if it differs from what was
 * approved, and run setup — the half of `cloneThenSetUp` that happens once the
 * checkout is a fact on the box.
 *
 * Split out for the cancellation phase above and for nothing else: a Ctrl-C
 * anywhere in here leaves a clone behind, and every path out of it says where
 * that clone is.
 */
async function setUpTheClone(
  id: Identity,
  repo: Repo,
  dest: string,
  preview: SetupPreview,
  opts: { attach: boolean; transport?: string | undefined; what: string },
): Promise<void> {
  // THE CLONED COMMIT'S CONFIG, not the one that was on screen. They differ
  // whenever the laptop's copy is uncommitted or unpushed, which is most of the
  // time while somebody is writing one.
  const box = readBoxConfig(dest);
  if (!box.ok) {
    die(`${box.why}\n  The clone is at ${dest}. Nothing was run and no session was started.`);
  }
  saySetupCommands(box.config, box.spec, "on the box");
  if (box.config.setup.source === "none") {
    die(
      `cloned, but no setup known for ${id.slug}: add ${CONFIG_FILE} or ${SETUP_SCRIPT}.\n` +
        `  The clone is at ${dest} and nothing was run — a repo with no setup command is\n` +
        `  not a repo that is set up, and a session in it would be a session in an\n` +
        `  uninstalled tree.\n` +
        `  gjd-remote setup --repo ${id.slug}   # once there is one`,
    );
  }
  const command = box.config.setup.command;
  const check = box.config.check?.command;

  // RE-CONFIRMED ON ANY DIFFERENCE IN THE SPECIFICATION, not in the command
  // string — GPT Sol's Stage 2 finding 4. A cloned `.gjd-remote/setup` whose
  // contents are nothing like the one that was on screen resolves to the same
  // eight characters, so comparing what was shown would have approved it.
  const differences = preview.kind === "known" ? diffSetupSpec(preview.spec, box.spec) : [];
  if (preview.kind !== "known" || differences.length > 0) {
    if (preview.kind === "known") {
      console.log(yellow(`the cloned commit's setup differs from what you approved:`));
      for (const d of differences) {
        console.log(dim(`  ${d.field}:  approved ${d.a}   the clone ${d.b}`));
      }
    } else {
      console.log(yellow(`the setup command was unknown until now — this is the cloned commit's own:`));
    }
    const go = await confirmOrRefuse(`Run ${command} in ${dest} on the box?`, promptStreams(), {
      default: false,
      instead: `The clone is at ${dest}, unset up.\n    gjd-remote setup --repo ${id.slug}`,
    });
    if (!go) die(`the clone is at ${dest} and nothing was run. No session was started.`);
  }

  const target = announce({
    slug: id.slug,
    localToplevel: id.localToplevel,
    dir: dest,
    via: "origin",
    // The remote was read back off the cloned tree, under the clone's own lock,
    // and compared to the URL we asked for — so this is what git recorded.
    originTransport: originTransport(repo.url),
    verified: true,
  });

  const run = runSetup({
    target,
    slug: id.slug,
    command,
    check,
    spec: box.spec,
    attach: opts.attach,
    transport: opts.transport,
    statusHint: `gjd-remote setup --status --repo ${id.slug}   # how did it go?`,
  });

  // NOBODY READ A VERDICT, so nobody may act on one. This is Sol's blocker 2:
  // the checkout being there is not readiness, and neither is a job having
  // started.
  if (run.kind === "started") {
    die(
      `setup was started and nothing watched it, so no session was created.\n` +
        `  ${opts.what} again once 'gjd-remote setup --status --repo ${id.slug}' says success.`,
    );
  }
  if (run.kind === "detached") {
    die(
      `setup is still running — you detached, it did not stop. No session was created.\n` +
        `  gjd-remote resume ${run.name}   # back to it\n` +
        `  ${opts.what} again once 'gjd-remote setup --status --repo ${id.slug}' says success.`,
    );
  }
  if (run.verdict.kind !== "success") {
    die(`${describeVerdict(run.verdict)}\n  The clone is at ${dest}. No session was created.`);
  }
  console.log(green(`✓ ${run.verdict.why}`));
}

/**
 * `gjd-remote resolve` — say which repo this is and what the box has, and stop.
 *
 * One round trip, nothing created, nothing changed. It exists because every
 * per-repo command now begins with this question, and when one of them refuses,
 * the useful thing is to see the answer on its own rather than reconstruct it
 * from a refusal. Exit 0 only for a checkout that was actually found.
 */
function cmdResolve(opts: { repo?: string | undefined; dir?: string | undefined }): void {
  console.log(dim(`cwd:  ${process.cwd()}`));
  console.log(dim(`host: ${host()}  (${describeSource(hostSource())})`));
  const id = identify(opts.repo);
  if (!id.ok) {
    console.error(red(`✗ ${id.why}`));
    process.exit(1);
  }
  console.log(`repo: ${bold(id.id.slug)}${id.id.localToplevel ? dim(`  (${id.id.localToplevel})`) : ""}`);

  // The env var is read here too, so what this prints is what the real commands
  // will do rather than a tidier version of it.
  const givenDir = opts.dir ?? process.env.GJD_REMOTE_REPO;
  if (givenDir !== undefined) {
    const what = opts.dir !== undefined ? "--dir" : "GJD_REMOTE_REPO";
    if (what === "GJD_REMOTE_REPO") sayDeprecated();
    const dir = remotePath(givenDir, what);
    const e = entryAt(dir);
    const found = e?.isCheckout && e.origin !== undefined ? remoteSlug(e.origin) : undefined;
    const said = found ?? (e === undefined ? "does not exist" : "not a checkout of anything I recognise");
    console.log(`box:  ${dir}  ${dim(`(${what}; ${said})`)}`);
    if (found !== id.id.slug) {
      console.error(red(`✗ that is not ${id.id.slug}, so every per-repo command will refuse it`));
      process.exit(1);
    }
    return;
  }

  const proposed = `${REMOTE_CODE}/${id.id.name}`;
  // The inventory rather than `remoteCheckout`, because this command's job is
  // to show what the box actually said — including the one fact resolution
  // throws away: whether the code folder is there at all. "Nothing under
  // ~/code" and "no ~/code" both resolve to `absent`, and only one of them is a
  // box that has never had a repo put on it.
  const inv = inventory();
  const r = resolveRemoteCheckout(id.id.slug, proposed, inv.entries);
  if (r.kind === "found") {
    console.log(`box:  ${bold(r.dir)}  ${dim(`(found by origin, ${r.originTransport})`)}`);
    if (r.originTransport === "ssh") {
      console.log(yellow(`  its remote is an ssh URL, and the box has no GitHub ssh key — it can never fetch`));
    }
    return;
  }
  console.log(`box:  ${dim(`nothing found; ${r.kind}`)}${r.kind === "absent" ? dim(`, proposed ${proposed}`) : ""}`);
  if (!inv.baseExists) console.log(dim(`      ${REMOTE_CODE} does not exist on the box yet — clone makes it`));
  console.error(red(`✗ ${describeResolution(id.id.slug, r)}`));
  process.exit(1);
}

// ---------------------------------------------------------------- commands

/**
 * Proof that the tree a session is about to start in is actually enterable.
 *
 * The directory itself comes from resolveTarget() — by origin, or from a `--dir`
 * somebody typed. This is the last check before a session exists, and not only
 * because a session that dies on its first line is confusing: it is the half of
 * the guard that can say something useful, since by the time the job script runs
 * nobody is watching. See cdGuard() below for the other half.
 *
 * It is `cd`, not `test -d`, and the difference is a real hole: `test -d` only
 * stats, so a directory with no execute permission passes it and then refuses
 * every attempt to enter. Asking the question we actually mean costs the same
 * round trip.
 */
function sessionDir(t: Target): string {
  const probe = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), `cd ${shq(t.dir)}`], { encoding: "utf8" });
  if (probe.status === 0) return t.dir;
  const why = (probe.stderr || "").trim().split("\n").at(-1)?.replace(/^bash: line \d+: /, "") ?? "";
  die(
    `cannot start a session in ${t.dir} on the box.\n` +
      (why ? `  the box said: ${why}\n` : "") +
      (t.via === "origin"
        ? `  The box listed that directory a moment ago as the checkout of ${t.slug}, so\n` +
          `  something changed underneath us, or its permissions do not allow entering it.\n` +
          `  gjd-remote resolve   ${dim("# what the box says about this repo now")}`
        : `  ${t.via} is a path on the BOX, not on this laptop.`),
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
function confirmStarted(name: string): string {
  const note = failNote(name);
  // `display-message -p` rather than `has-session`, because the answer this
  // needs is the SESSION ID and it is free here: the round trip is already
  // being paid for, and the alternative is a second one from every caller that
  // then wants to attach. See `Session.id` for why a name is not an address.
  //
  // **`=name:` WITH THE COLON.** `display-message` takes a target *pane*, and
  // the `=` exact-match prefix is only honoured on the session part when a
  // colon follows. Without it tmux 3.4 prints NOTHING and exits 0 — so this
  // function would have read an empty id and declared every freshly started
  // session dead. Measured on the box, 2026-09-05; it is the same trap as
  // docs/project/hetzner-remote-server-box.md § Traps, and GPT Sol caught the
  // repeat in review before it shipped.
  const out = ssh(
    `sleep 1; if id=$(tmux display-message -p -t ${shq(`=${name}:`)} '#{session_id}' 2>/dev/null) && [ -n "$id" ]; then ` +
      `printf 'alive %s\\n' "$id"; ` +
      `else cat -- ${shq(note)} 2>/dev/null || ` +
      `printf '%s\\n' 'it was gone a second after it started, and left no note'; fi`,
    { check: false },
  );
  const alive = /^alive (\$\d+)$/.exec(out.trim());
  // The shape is checked rather than the prefix: `alive` followed by something
  // that is not a tmux id is a reply this was not written against, and using it
  // as a target would address whatever tmux makes of it.
  if (alive?.[1]) return alive[1];
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

/**
 * How a state reads on screen: the word, its colour, and where it sorts.
 *
 * SORTED BY WHO IS BEING WAITED ON. A session stuck on a permission prompt is
 * costing you time right now and goes at the top; one that has finished and is
 * sitting at an empty box is next, because it is finished and nobody has looked;
 * everything that is getting on with itself sorts below both. Alphabetical was
 * the old order and it buried the one row that needed a person, which is the
 * whole reason this column exists.
 *
 * The words are what somebody would say out loud. `needs you` rather than
 * `waiting`, because `waiting` is already what `--wait` does and the two states
 * could not be less alike — one wants you, the other wants nothing.
 */
function stateLabel(state: SessionState): { rank: number; text: string } {
  switch (state.kind) {
    case "needs-you":
      return { rank: 0, text: yellow("? needs you") };
    case "unknown":
      return { rank: 1, text: red("! unknown") };
    case "idle":
      return { rank: 2, text: cyan("- idle") };
    case "working":
      return { rank: 3, text: green("* working") };
    case "waiting":
      // The countdown is the point of the row: "waits" alone tells you the job
      // has not started, which you could have guessed, and not the one thing you
      // cannot see from here.
      return { rank: 4, text: dim(`z waits ${formatWait(state.secondsLeft)}`) };
    case "no-claude":
      return { rank: 5, text: dim("  no claude") };
    case "shell":
      // A shell grinding through the test suite and a prompt somebody abandoned
      // fifteen hours ago used to read the same, which is how eight of them
      // accumulated on the box unnoticed. `busy` is one snapshot of the process
      // table, so the quiet word is `idle` — "nothing is running in it right
      // now" — and never `finished`, which claims something no snapshot can see.
      return {
        rank: 6,
        text: dim(state.busy === null ? "  shell ?" : state.busy ? "  shell busy" : "  shell idle"),
      };
  }
}

/** The tally under the table, in the same order as the rows above it. */
function stateSummary(states: SessionState[]): string {
  const counts = new Map<string, number>();
  for (const s of states) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const say: [SessionState["kind"], (n: number) => string][] = [
    ["needs-you", (n) => yellow(`${n} need${n === 1 ? "s" : ""} you`)],
    ["unknown", (n) => red(`${n} unknown`)],
    ["idle", (n) => cyan(`${n} idle`)],
    ["working", (n) => green(`${n} working`)],
    ["waiting", (n) => dim(`${n} waiting to start`)],
    ["no-claude", (n) => dim(`${n} with no claude`)],
    // The shells are split, because the split is the only actionable half:
    // "7 shells" says nothing about which of them are doing work, and the ones
    // that are not are the ones worth looking at.
    ["shell", (n) => dim(`${n} shell${n === 1 ? "" : "s"}`)],
  ];
  const idleShells = states.filter((s) => s.kind === "shell" && s.busy === false).length;
  return say
    .map(([kind, render]) => {
      const n = counts.get(kind);
      if (!n) return null;
      return kind === "shell" && idleShells > 0 ? `${render(n)}${dim(`, ${idleShells} idle`)}` : render(n);
    })
    .filter((s): s is string => s !== null)
    .join(dim(" · "));
}

/**
 * How wide a coloured string looks, as opposed to how many bytes it is.
 *
 * `padEnd` counts the escape bytes, so a coloured cell pads to the wrong width
 * and every column after it staggers by however many bytes the colour took —
 * about ten, which is enough to make the table look broken while every value in
 * it is right.
 */
// Matching the escape byte is the point here: this regex exists to measure SGR
// sequences, not to avoid them.
// biome-ignore lint/suspicious/noControlCharactersInRegex: see above
const SGR = /\u001b\[[0-9;]*m/g;

const visibleWidth = (s: string) => s.replace(SGR, "").length;

const padVisible = (s: string, width: number) => s + " ".repeat(Math.max(0, width - visibleWidth(s)));

/**
 * What the ROLE column says about one session, and `""` for the great majority
 * that hold no role at all.
 *
 * `?` for a role we could not read: it is not nothing, and a blank cell would
 * claim it was.
 */
function roleCell(s: Session): string {
  switch (s.role.kind) {
    case "none":
      return "";
    case "overseer":
      return OVERSEER_ROLE;
    case "other":
      return s.role.name;
    case "cannot-tell":
      return "?";
    default: {
      const never: never = s.role;
      return never;
    }
  }
}

/**
 * One line saying who is the Overseer — **including when nobody is**.
 *
 * Shared by `ls` and by the claim verbs so that the sentence a person reads
 * after claiming is the same sentence `ls` will show them a minute later. There
 * must be exactly one Overseer on the box (docs/project/overseer.md); two is a
 * fault to shout about and never to pick from.
 */
function claimLine(claim: OverseerClaim): string {
  switch (claim.kind) {
    case "one":
      return `${dim("overseer:")} ${cyan(printableName(claim.name))}`;
    case "none":
      return dim("no session holds the overseer claim");
    case "contested":
      return red(`${claim.names.length} sessions claim to be the overseer: ${claim.names.join(", ")}`);
    case "cannot-tell":
      return red(`overseer: ${claim.why}`);
    default: {
      const never: never = claim;
      return never;
    }
  }
}

/**
 * Mark one live session as the Overseer, or let go of the claim.
 *
 * **THE READ AFTERWARDS IS NOT DECORATION.** The refusal is decided against a
 * listing taken a moment ago and then carried out by a second tmux call, so two
 * claims racing can both pass it — see `decideClaim`. Re-reading turns that from
 * a silent double-claim into a sentence on screen, which is the whole of what
 * this design promises: not that a race cannot happen, but that it cannot happen
 * quietly.
 */
function cmdRole(action: "claim" | "release", name: string | undefined): void {
  if (!name) die(`usage: gjd-remote ${action}-overseer <name>`);
  const before = sessions();
  const verdict = action === "claim" ? decideClaim(before, name) : decideRelease(before, name);

  // Before the switch rather than in it: `die` never returns, so a `case` for it
  // is either unreachable code or a value returned from a void function, and
  // there is no spelling of it that tsc and biome both accept.
  if (verdict.kind === "refused") die(verdict.why);

  switch (verdict.kind) {
    case "already-yours":
      console.log(green(`✓ ${printableName(name)} already holds the overseer claim`));
      return;
    case "claim":
    case "release": {
      ssh(setRoleCommand(verdict.id, verdict.kind === "claim" ? OVERSEER_ROLE : null));
      appendLog({ cmd: `${action}-overseer`, name: verdict.name });
      const list = sessions();
      const after = overseerClaim(list);
      // TWO DIFFERENT POSTCONDITIONS, because the two verbs promise different
      // things. A claim promises *this session and no other*, so it is checked
      // against the whole box. A release promises only *this session no longer
      // holds it* — checked against the target, because releasing one of two
      // claimants is the repair for a contested box and would otherwise be
      // reported as a failure. GPT Sol's P1-2.
      const wanted =
        verdict.kind === "claim"
          ? after.kind === "one" && after.id === verdict.id
          : list.find((s) => s.id === verdict.id)?.role.kind !== "overseer";
      // Reported as a warning rather than a success, and non-zero, because the
      // interesting case is somebody else claiming it in the same second.
      if (!wanted) {
        console.error(red(`✗ the ${action} was sent, and the box does not now say what it should`));
        console.error(`  ${claimLine(after)}`);
        process.exit(1);
      }
      console.log(green(`✓ ${verdict.kind === "claim" ? "claimed" : "released"} by ${printableName(verdict.name)}`));
      console.log(dim("— ") + claimLine(after));
      return;
    }
    default: {
      const never: never = verdict;
      throw new Error(`unhandled role change: ${JSON.stringify(never)}`);
    }
  }
}

function cmdLs(): void {
  const { list: raw, agents, agentsWhy } = fleet({ agents: true });
  const list = adoptTitles(raw);
  if (list.length === 0) {
    console.log(dim("no sessions. `gjd-remote new-claude` to start one."));
    return;
  }

  // Said before the table, and on stderr, because it is not a row — it is the
  // reason the whole column is untrustworthy, and it should survive a pipe into
  // grep that the table does not.
  if (agentsWhy !== null) {
    console.error(red("✗ could not ask the box what Claude is doing: ") + agentsWhy);
    console.error(dim("  the STATE column below cannot tell running from finished."));
  }

  const rows = list
    .map((s) => {
      const state = sessionState(s, agents);
      return { s, state, label: stateLabel(state) };
    })
    .sort((a, b) => a.label.rank - b.label.rank || a.s.name.localeCompare(b.s.name));

  // ESCAPED BEFORE IT IS MEASURED, not after. The width has to be the width on
  // screen, and an escaped name is longer than the one it came from — measuring
  // the raw one staggers every column to its right, which is the bug padVisible
  // exists to prevent for colour.
  const shown = new Map(list.map((s) => [s.name, escapeName(s.name)]));
  const nameOf = (s: Session) => shown.get(s.name) ?? s.name;
  const w = Math.max(4, ...list.map((s) => nameOf(s).length));
  // Widths are measured on the UNDIMMED text and the cells are padded with
  // padVisible, because dim() wraps its argument in escape sequences that
  // .length counts and a terminal does not — the bug that once made the STATE
  // column ragged.
  const rw = Math.max(4, ...list.map((s) => sessionRepo(s).text.length));
  const sw = Math.max(5, ...rows.map((r) => visibleWidth(r.label.text)));
  // A COLUMN ONLY WHEN THERE IS SOMETHING IN IT. Almost every session on the box
  // holds no role, so an unconditional column would be a stripe of dashes down
  // the page for the one day in a hundred when it says something. The absent
  // state is not lost by hiding it: the claim line under the table always says
  // whether anybody holds it.
  const oww = Math.max(0, ...list.map((s) => roleCell(s).length));
  const ow = oww === 0 ? 0 : Math.max(4, oww);
  const roleHead = ow === 0 ? "" : `${"ROLE".padEnd(ow)}  `;
  console.log(bold(`${"NAME".padEnd(w)}  ${"REPO".padEnd(rw)}  ${roleHead}AGE   ATT  ${"STATE".padEnd(sw)}  TITLE`));
  for (const { s, label } of rows) {
    // Dimmed when it is not a real answer, the same treatment the empty TITLE
    // cell gets: a session started before the metadata existed, or against an
    // arbitrary --dir, cannot be attributed to a repo and should not look like
    // it has been.
    const repo = sessionRepo(s);
    const role = roleCell(s);
    console.log(
      `${nameOf(s).padEnd(w)}  ${padVisible(repo.known ? repo.text : dim(repo.text), rw)}  ` +
        (ow === 0 ? "" : `${padVisible(role === OVERSEER_ROLE ? cyan(role) : dim(role), ow)}  `) +
        `${age(s.created).padEnd(4)}  ${s.attached ? green("yes") : dim(" no")}  ` +
        `${padVisible(label.text, sw)}  ${s.title ? s.title : dim("(no title yet)")}`,
    );
  }
  if (rows.length > 1) console.log(dim("— ") + stateSummary(rows.map((r) => r.state)));
  // ALWAYS printed, including when nobody holds it. "No session is the
  // Overseer" is the state that most needs saying out loud: it is what a box
  // looks like after a reboot, and a blank line where the answer should be
  // reads exactly like a box that is fine.
  console.log(dim("— ") + claimLine(overseerClaim(list)));

  // Every `unknown` carries a reason, and the first version threw them away —
  // so a row said `! unknown` and there was nowhere to find out why. Printed
  // once per distinct reason rather than once per row, because on a box where
  // the agents call failed that is one sentence instead of twelve.
  const why = new Map<string, string[]>();
  for (const { s, state } of rows) {
    if (state.kind !== "unknown") continue;
    why.set(state.why, [...(why.get(state.why) ?? []), nameOf(s)]);
  }
  for (const [reason, names] of why) {
    console.log(dim(`  ${names.length === 1 ? names[0] : `${names.length} sessions`}: ${reason}`));
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
  for (const s of plan.skipped) console.log(dim(`skipped ${escapeName(s.name)} — ${s.why}`));
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
  for (const tab of plan.open) {
    // No retry: this creates a tab, and a retried create is two tabs for one
    // session. It addresses the window by id, so the -1719 that retries exist
    // for cannot arise here.
    const made = osa(newTabScript(), [String(here.windowId), resumeCommand(bin, tab, opts.transport), "0.4"], {
      retry: false,
    });
    if (!made.ok || !isSessionUuid(made.out)) {
      console.error(red(`✗ opening a tab for ${escapeName(tab.name)} failed: ${made.out || "no output"}`));
      break;
    }
    opened.push(tab.name);
    console.log(`${green("✓")} ${escapeName(tab.name)}`);
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
 * The streams a question is asked on, or `null` when there is no terminal to
 * ask on at all.
 *
 * Both rules live in `promptIo()` in scripts/gjd-remote-prompt.ts, which is
 * where the prompts are and where they can be tested: the input is whatever
 * `interactiveStdin()` found and is never upgraded, so a redirected stdin
 * refuses rather than borrowing a keyboard nobody offered; the output moves to
 * `/dev/tty` when stdout is not a terminal, so a redirected stdout does not
 * swallow the question. This is the seam between the two, and nothing else.
 */
function promptStreams(): PromptIo | null {
  return promptIo(interactiveStdin());
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
async function cmdNewClaude(
  given: string | undefined,
  opts: {
    prompt?: string | undefined;
    /** Where to start: resolved by resolveTargetForSession() below, and
     *  deliberately not in main(), so the cheap local refusals still come
     *  first — an oversized prompt and a bad name are refused before the box is
     *  asked anything, let alone offered a clone. */
    repo?: string | undefined;
    dir?: string | undefined;
    attach: boolean;
    transport?: string | undefined;
    /** `--wait 2h`: already parsed, because a bad duration must not reach the box. */
    wait?: { seconds: number; label: string } | undefined;
  },
): Promise<void> {
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

  // Which repo, which directory, printed — then the last look, which is the one
  // that proves the directory can actually be entered.
  //
  // This is where a repo the box has never had is offered a clone and a setup,
  // and where a checkout whose setup never succeeded says so. Everything above
  // is deliberately in front of it: a bad name or an oversized prompt is a
  // sentence, not a question about cloning.
  const { target, admit } = await resolveTargetForSession({
    repo: opts.repo,
    dir: opts.dir,
    attach: opts.attach,
    transport: opts.transport,
    what: "gjd-remote new-claude",
  });
  const dir = sessionDir(target);
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
    //
    // --permission-mode auto because nobody is sitting in front of these. Without
    // the flag the mode is whatever the CLI happens to pick, and it is not stable:
    // on 2026-09-07 three sessions started 22 seconds apart in the same checkout
    // came up `auto`, `auto` and `default`, and 8 of the 23 then running had
    // launched in `default`. A `default` session stops at the first Bash or MCP
    // call it cannot pre-approve and waits for a person who is not there — nine
    // such stalls since 2026-09-01 cost 41.6 agent-hours, one of them 5h45m on a
    // single Sentry read. Sessions that launched in `auto` lost nothing this way.
    // This does not widen what an agent may do: the deny and ask rules in
    // .claude/settings.json still apply. It only settles whether it stops to ask.
    [
      "claude",
      `--session-id ${sessionId}`,
      `--permission-mode auto`,
      provisional ? "" : `--name ${shq(name)}`,
      // `--` BEFORE THE PROMPT, and it is not decoration. The prompt is text
      // somebody typed — increasingly a web form, tools/fleet/routes-new.ts —
      // and without this separator a prompt beginning `--dangerously-skip-permissions`
      // is a Claude FLAG rather than prose: measured 2026-09-08 with
      // `claude --session-id bad-uuid -p --nonexistent-flag`, which says
      // "unknown option", against the same line with `--`, which gets past
      // parsing to the session-id check. GPT Sol's F10.
      opts.prompt ? `-- "$(cat -- ${promptPath})"` : "",
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
  // The rest of the `-e` flags are the session's own metadata — see metaFlags().
  // UNDER THE SETUP LOCK when the target is a repo the box resolved by origin,
  // and plainly for a `--dir` — `startUnderAdmission`. The gate that let us get
  // here read a status file some seconds ago; this is what makes that reading
  // still true at the moment the session exists.
  startUnderAdmission(
    admit,
    `tmux new-session -d -s ${name} -e CLAUDE_SESSION_ID=${sessionId} ` +
      `-e GJD_PROVISIONAL=${provisional ? 1 : 0} ${metaFlags(target, dir, "claude")} ` +
      shq(`bash ${jobPath}`),
    name,
  );

  const sessionTmuxId = confirmStarted(name);

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
      // The same value the session's own `GJD_REPO` carries, from the same
      // function, so the durable record and the box agree about which repo this
      // was — `dir` alone cannot answer it (see LogRecord.repo).
      repo: targetRepo(target),
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
    // Attaching, like every other launch: the pane you land in is the pane
    // Claude appears in when the sleep ends, so this is the one wait you can
    // sit through. Why that is so, and what it costs on a long one, is on
    // `waitHandover` — including why no terminal is not an error here.
    const handover = waitHandover({
      attach: opts.attach,
      // NOT `interactiveStdin() !== null`, which is what this said first: that
      // is the descriptor to attach WITH, and it says "inherit" for a stdin it
      // has never looked at. See haveTerminal.
      terminal: haveTerminal({ keyboard: interactiveStdin(), stdinIsTty: process.stdin.isTTY === true }),
    });
    if (handover.kind === "attach") {
      // "close the tab", not a detach key: the box's tmux has NO prefix and no
      // bindings at all, so every keystroke belongs to whatever runs inside it
      // (infra/hetzner/provision.sh, `set -g prefix None`). Telling somebody to
      // press ctrl-b d would be telling them to type `^Bd` into Claude.
      console.log(dim(`  attaching — the pane becomes Claude when the wait is over; close the tab to leave it running`));
      attach({ id: sessionTmuxId, name }, opts.transport);
    } else if (handover.why === "no-terminal") {
      console.log(dim(`  no terminal here, so nothing to attach to — the session is waiting either way`));
    }
    console.log(dim(`  nothing runs until then — gjd-remote resume ${name}, or gjd-remote kill ${name}`));
    return;
  }

  console.log(green(`✓ started '${name}'`) + dim(opts.prompt ? " with a prompt" : ""));
  if (opts.attach) attach({ id: sessionTmuxId, name }, opts.transport);
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
async function cmdNewShell(
  given: string | undefined,
  opts: { repo?: string | undefined; dir?: string | undefined; transport?: string | undefined },
): Promise<void> {
  const name = given ?? timestampName("sh");
  if (!SLUG.test(name)) die(`'${name}' is not a valid name (lower-case letters, digits, hyphens; max 41)`);

  const live = sessions();
  const already = live.find((x) => x.name === name);
  if (already) {
    console.log(dim(`'${name}' already exists — attaching`));
    attach({ id: already.id, name: already.name }, opts.transport);
  }

  // As in cmdNewClaude: an absent checkout is offered a clone and a setup here,
  // and a session is created only on a `success` status. A shell always
  // attaches, so it always watches the setup it started.
  const { target, admit } = await resolveTargetForSession({
    repo: opts.repo,
    dir: opts.dir,
    attach: true,
    transport: opts.transport,
    what: "gjd-remote new-shell",
  });
  const dir = sessionDir(target);
  console.log(bold(`gjd-remote new-shell ${name}`) + dim(` → ${HOST()}:${dir}`));

  // `-c ${dir}` is NOT the guard, and used to be all there was: tmux falls back
  // to the home directory when it cannot enter `-c` and still exits 0, so this
  // command reported a green ✓ over a shell sitting in /home/greg. The explicit
  // `cd || exit 1` is the same one `new-claude` runs, for the same reason.
  //
  // GJD_PROVISIONAL=0: a shell has no Claude conversation and so will never
  // have a title to adopt. Marking it settled stops `ls` looking every time.
  ssh(`mkdir -p ${REMOTE_WORK}/jobs && rm -f ${shq(failNote(name))}`);
  // As in cmdNewClaude, the `GJD_*` variables are what `ls` reads back — the
  // kind differs, and nothing else does.
  // Under the setup lock, exactly as `new-claude` starts its session — see
  // `startUnderAdmission`. A shell in a tree mid-`npm ci` is the same
  // half-built repo an agent would get.
  startUnderAdmission(
    admit,
    `tmux new-session -d -s ${name} -c ${shq(dir)} -e GJD_PROVISIONAL=0 ` +
      `${metaFlags(target, dir, "shell")} ` +
      shq(`${cdGuard(name, dir, "a shell")}; exec bash -l`),
    name,
  );
  const shellTmuxId = confirmStarted(name);
  // A launch line, written after the session exists, the way cmdNewClaude
  // writes one. main() has already logged the bare `new-shell` invocation; this
  // is the record of a shell that actually started, and of where. No uuid and
  // no prompt, because a shell has neither.
  appendLog({ cmd: "new-shell", name, dir, repo: targetRepo(target), host: host() });
  console.log(green(`✓ shell '${name}'`) + dim(` in ${dir}`));
  attach({ id: shellTmuxId, name }, opts.transport);
}

/**
 * Which keys may leave the laptop, per repo.
 *
 * A map rather than one hard-wired list, because the list is Spideryarn's: it
 * is a set of key NAMES, and another repo's `DATABASE_URL` is not this one's.
 * A repo with no entry here is REFUSED rather than pushed under somebody else's
 * policy — Stage 4 of the plan fills the gap with a per-repo policy the user
 * ticks once and this file then reads from `~/.config/gjd-remote/repos/`.
 *
 * The seam is deliberately this small. It is a lookup by slug and a function
 * that turns file text into a payload; Stage 4 adds entries to it and changes
 * nothing else here.
 */
type EnvRoute =
  /** A list written down in this repo, in TypeScript, by a person. No prompt,
   *  no model, no saved policy — the list IS the decision. */
  | { kind: "typed"; allowance: EnvAllowance }
  /** Everything else: names off the file, a proposal, a checklist, and what the
   *  reader ticked remembered in `~/.config/gjd-remote/repos/`. */
  | { kind: "checklist" };

const TYPED_ENV_POLICIES: Record<string, EnvAllowance | undefined> = {
  "spideryarn/reading2": SPIDERYARN_ALLOWANCE,
};

/**
 * **Which of the two `push-env` paths this repo takes, and why there are two.**
 *
 * A function rather than a bare lookup so this comment has somewhere to live.
 *
 * The typed path stays for Spideryarn because its allowlist is not a
 * convenience: it is a reviewed list of names with reasons written beside each
 * one, and two of its entries are absences that were argued over
 * (scripts/gjd-remote-env.ts). Replacing it with "whatever Greg ticked last
 * time" would throw that away, and a checklist that re-asks the same twenty
 * keys every time is a checklist people stop reading.
 *
 * Every other repo takes the checklist path, because a list of key NAMES is
 * repo-specific — hellozenno's `DATABASE_URL` is not this one's — and nobody is
 * going to write a TypeScript entry per repo, which was the objection to the
 * typed-map design in the first place (the plan, § "The simpler options passed
 * over").
 *
 * What the two paths SHARE is everything that decides safety: the same value
 * guards (`localityVerdict`, the Supabase-JWT and Stripe-mode checks in
 * `buildEnvPayload`), the same forbidden names, the same atomic write and the
 * same readback. The difference is only where the list of names comes from.
 */
function envRoute(slug: string): EnvRoute {
  const typed = TYPED_ENV_POLICIES[slug];
  return typed === undefined ? { kind: "checklist" } : { kind: "typed", allowance: typed };
}

/**
 * WHICH file on this laptop, and WHOSE rules apply to it.
 *
 * Three refusals, all of them before a single byte is read:
 *
 *  - **No local checkout, no push.** `--repo` can name a repo you are not
 *    standing in, and then there is no `.env.local` to send. Guessing this
 *    checkout's one would send Spideryarn's keys under another repo's name.
 *  - **No symlinks.** What is about to be read is every credential the repo
 *    has, and a symlink is a file whose real location this never looked at.
 *
 * "No policy" used to be a third refusal here. It is a route now: a repo with no
 * typed list is asked about rather than turned away (`envRoute`).
 */
function envSource(
  target: Target,
  file: string | undefined,
): { local: string; slug: string; route: EnvRoute } {
  const slug = target.slug;
  if (slug === null || target.localToplevel === null) {
    die(
      `push-env sends this repo's .env.local, so it has to be run from inside the repo.\n` +
        (slug === null
          ? `  I could not tell which repo you mean.`
          : `  --repo named ${slug}, but this laptop is not standing in it, so there is no\n` +
            `  .env.local to read. Run it from that checkout.`),
    );
  }

  // The LOCAL TARGET, not the tool root: `.env.local` belongs to the repo you
  // are standing in. It used to be read from this checkout however far away the
  // work was, which is how a hellozenno push would have sent Spideryarn's keys.
  const local = path.resolve(file ?? path.join(target.localToplevel, ".env.local"));
  const refusal = assertPushableName(path.basename(local));
  if (refusal) die(refusal);
  const st = lstatSync(local, { throwIfNoEntry: false });
  if (!st) die(`no such file: ${local}`);
  if (st.isSymbolicLink()) {
    die(`${local} is a symlink, and this will not follow one to find credentials.\n  Pass the real file with --file.`);
  }
  if (!st.isFile()) die(`${local} is not a regular file.`);
  return { local, slug, route: envRoute(slug) };
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
type PushEnvOptions = {
  file?: string | undefined;
  repo?: string | undefined;
  dir?: string | undefined;
  /** Ask the model even when the saved policy already covers every key. */
  propose: boolean;
  /** Skip the checklist: every selectable key / no key at all. */
  all: boolean;
  none: boolean;
  /** Record an empty policy when nothing was selected. */
  save: boolean;
  /** Skip the final confirmation. `--all` alone still asks. */
  yes: boolean;
};

async function cmdPushEnv(opts: PushEnvOptions): Promise<void> {
  // `requireIdentity` — this command carries one repo's credentials, so it may
  // not run without knowing which repo, and a `--dir` must be that repo's
  // checkout rather than any directory on the box.
  const target = resolveTarget({ repo: opts.repo, dir: opts.dir, requireIdentity: true });
  const { local, slug, route } = envSource(target, opts.file);
  const text = readFileSync(local, "utf8");
  if (route.kind === "checklist") return pushEnvByChecklist(target, slug, local, text, opts);

  // The typed path takes no options, and says so rather than ignoring them: a
  // `--all` that quietly did nothing would read as "everything was sent".
  const used = (["propose", "all", "none", "save", "yes"] as const).filter((f) => opts[f]);
  if (used.length) {
    die(
      `--${used.join(", --")} ${used.length === 1 ? "is" : "are"} for a repo with no written-down list of keys.\n` +
        `  ${slug} has one, in scripts/gjd-remote-env.ts, and it is the whole decision — there\n` +
        `  is nothing here to propose, tick or remember. Nothing was sent.`,
    );
  }
  sendEnvPayload(target, local, buildEnvPayload(text, route.allowance));
}

/**
 * The tail both routes share: refuse a file that would silently lose keys, say
 * what is changing by KEY NAME, write it atomically, and read it back.
 *
 * Extracted rather than copied when the checklist route arrived. Two copies of
 * this would be two atomic-write recipes and two readbacks, and the one that got
 * a fix would not be the one somebody was running.
 */
function sendEnvPayload(target: Target, local: string, payload: EnvPayload): void {
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
      `none of the keys that were going to be sent are in ${local} — refusing to write an\n` +
        `  empty env file. The list of names came from ${payload.sourceOfNames}.`,
    );
  }

  const dir = target.dir;
  const dest = `${dir}/.env.local`;
  // Not created for you, on purpose: an env file beside no repo is a box that
  // looks set up and is not, and you would find out at the first npm command.
  if (ssh(`test -d ${shq(dir)} && echo yes || echo no`, { check: false }) !== "yes") {
    die(`${dir} went away between resolving it and writing to it, so nothing was written.`);
  }

  console.log(bold(`gjd-remote push-env → ${HOST()}:${dest}`));
  const before = parseEnv(ssh(`cat ${shq(dest)} 2>/dev/null || true`, { check: false, raw: true }));
  const diff = diffKeys(before, payload.pushed);
  for (const k of diff.added) console.log(green(`  + ${k}`) + dim("  added"));
  for (const k of diff.removed) console.log(red(`  - ${k}`) + dim("  removed"));
  for (const k of diff.changed) console.log(`  ${bold("~")} ${k}` + dim("  changed"));
  console.log(dim(`  = ${diff.unchanged} unchanged`));
  if (payload.skipped.length) {
    console.log(dim(`  skipped ${payload.skipped.length} keys that are not going: ${payload.skipped.join(", ")}`));
  }
  if (payload.missing.length) {
    console.log(dim(`  ${payload.missing.length} expected keys absent locally: ${payload.missing.join(", ")}`));
  }

  // A THIRD copy of the selected credentials, and it is removed on every path
  // out of here — GPT Sol's Stage 4 finding 3. `scp` needs a real file, so the
  // copy is unavoidable; leaving it in /tmp until the next reboot is not. The
  // `finally` removes the directory this call created and nothing else, by the
  // name `mkdtempSync` returned.
  //
  // The failure comes back as a value and dies AFTER the `finally`, because
  // `die()` is `process.exit`, and `process.exit` does not run `finally` blocks
  // — so a `die()` inside the `try` left the staged copy behind on exactly the
  // path that was meant to be covered (GPT Sol, post-landing review, finding 2).
  const stage = mkdtempSync(path.join(tmpdir(), STAGE_PREFIX));
  let failure: string | undefined;
  try {
    failure = stageAndSend(stage, payload, dir, dest);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  if (failure !== undefined) die(failure);

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

/** The prefix every staging directory this tool makes is named with, so that
 *  `ls "$TMPDIR" | grep` after a push is a check somebody can actually run. */
const STAGE_PREFIX = "gjd-remote-env-";

/** Write the payload into `stage` and get it onto the box, atomically. Split out
 *  only so that the removal of `stage` can be a `finally` around the whole of
 *  it — including the `die` paths, which throw. */
/**
 * Stage the file and move it into place on the box. Returns the failure rather
 * than dying on it, so the caller's `finally` gets to remove the staged copy
 * first: nothing in here may call `die()` or an `ssh()` that does.
 */
function stageAndSend(stage: string, payload: EnvPayload, dir: string, dest: string): string | undefined {
  const staged = path.join(stage, ".env.local");
  writeFileSync(staged, payload.text, { encoding: "utf8", mode: 0o600 });

  const tmp = `${dir}/.env.local.push-${randomUUID()}`;
  // Pre-create the temp file under umask 077. scp only applies a mode when it
  // CREATES the file, so writing into an existing 0600 file leaves it 0600 —
  // whereas chmod-after-scp leaves a window in which a world-readable copy of
  // every credential is sitting in the repo. The chmod after the copy is belt
  // and braces, not the mechanism.
  const made = sshRun(`umask 077 && : > ${shq(tmp)}`);
  if (made.status !== 0) return `ssh failed (${made.status}): ${lastWords(made.stderr)}`;
  const sent = spawnSync("scp", ["-q", ...SSH_OPTS, ...sshMasterOpts(), staged, `${HOST()}:${tmp}`], { encoding: "utf8" });
  if (sent.status !== 0) {
    ssh(`rm -f ${shq(tmp)}`, { check: false });
    return `scp failed: ${(sent.stderr || "").trim()}`;
  }
  // One command: chmod, then rename over the destination. rename(2) within a
  // directory is atomic, so a reader on the box sees the old file or the new
  // one and never a half-written one.
  const moved = sshRun(`chmod 600 ${shq(tmp)} && mv -f ${shq(tmp)} ${shq(dest)}`);
  if (moved.status !== 0) {
    ssh(`rm -f ${shq(tmp)}`, { check: false });
    return `ssh failed (${moved.status}): ${lastWords(moved.stderr)}`;
  }
  return undefined;
}

/**
 * **`push-env` for a repo with no written-down list**, which is glue and nothing
 * else: read the saved policy, hand `pushEnvPlan` the callbacks it cannot have —
 * money, prompts, the terminal — and do what it says.
 *
 * The decisions all live in `pushEnvPlan` (scripts/gjd-remote-envpolicy.ts), and
 * that is GPT Sol's Stage 4 finding 2 rather than tidiness. They used to be
 * here, where `main()`-on-import makes them untestable, so the leak test could
 * only reach the pure half — and the sinks that matter most, the ones a value
 * would have to pass through a prompt or a `console.log` to reach, were exactly
 * the ones it could not see.
 *
 * Two things stay here on purpose:
 *
 * - **Reading the policy**, because an unreadable file is a refusal rather than
 *   an empty approval set: those two are indistinguishable downstream, and the
 *   second would present every key as undecided and then overwrite the file it
 *   could not read. `SavedPolicy` is the type that makes the confusion
 *   impossible to express.
 * - **The order of the two writes.** The box first, the policy second, so the
 *   file records what actually travelled rather than what was hoped for.
 */
async function pushEnvByChecklist(
  target: Target,
  slug: string,
  local: string,
  text: string,
  opts: PushEnvOptions,
): Promise<void> {
  console.log(bold(`gjd-remote push-env ${slug}`));
  const file = policyFile(slug);
  const saved = readPolicy(file, slug);
  if (saved.kind === "error") {
    die(
      `${saved.why}\n` +
        `  That file records which keys you decided about for this repo, so a push cannot\n` +
        `  go ahead without being able to read it. Fix it or delete it. Nothing was sent.`,
    );
  }
  console.log(
    saved.kind === "policy"
      ? dim(
          `  policy: ${file}  (${saved.approved.length} approved of ${saved.reviewed.length} decided, saved ${saved.savedAt})`,
        )
      : dim(`  policy: none yet — would be ${file}`),
  );

  const dest = `${target.dir}/.env.local`;
  let plan: EnvPlan;
  try {
    plan = await pushEnvPlan({
      text,
      local,
      slug,
      saved,
      flags: { propose: opts.propose, all: opts.all, none: opts.none, save: opts.save, yes: opts.yes },
      propose: askForProposal,
      choose: (items) =>
        checklistOrRefuse({
          message: "which keys should go on the box?",
          items: items.map((i) => ({
            value: i.name,
            label: i.name,
            description: i.description,
            checked: i.checked,
            disabled: i.disabled,
          })),
          io: promptStreams(),
          instead: "gjd-remote push-env --all (every eligible key), or --none --save to approve nothing",
        }),
      confirm: (names) =>
        confirmOrRefuse(`send these ${names.length} keys to ${HOST()}:${dest}?`, promptStreams(), {
          instead: "gjd-remote push-env --all --yes sends every eligible key without asking",
        }),
      say: sayPlanLine,
    });
  } catch (err) {
    if (err instanceof EnvPolicyError) die(err.message);
    throw err;
  }

  if (plan.payload !== undefined) sendEnvPayload(target, local, plan.payload);
  if (plan.policyToSave !== undefined) savePolicy(file, plan.policyToSave);
}

/** One line the plan asked for, coloured. Two spaces, because everything under
 *  the `push-env` banner is indented and the plan should not have to know it. */
function sayPlanLine(line: string, tone: EnvPlanTone): void {
  const paint = tone === "dim" ? dim : tone === "warn" ? yellow : tone === "bad" ? red : (s: string) => s;
  console.log(paint(`  ${line}`));
}

/** `policyPath`, with its refusal in the CLI's voice. It throws on a slug that
 *  cannot be a filename, which is a thing `--repo` can produce. */
function policyFile(slug: string): string {
  try {
    return policyPath(slug);
  } catch (err) {
    if (err instanceof EnvPolicyError) die(err.message);
    throw err;
  }
}

/**
 * Remember what travelled — and treat failing to as a warning, not a failure.
 *
 * The keys are already on the box by the time this runs. Dying here would print
 * a red cross over a push that worked, and the reader would run it again.
 */
function savePolicy(file: string, policy: Policy): void {
  try {
    writePolicy(file, policy, new Date());
    console.log(
      dim(`  ${policy.approved.length} approved of ${policy.reviewed.length} decided, recorded in ${file}`),
    );
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.log(yellow(`  the keys were sent, but the policy was not saved: ${why}`));
  }
}

/**
 * **The paid call, and everything it needs that a pure module cannot have.**
 *
 * WHETHER to ask is not decided here — `pushEnvPlan` does that, and only calls
 * this when there is something undecided to ask about (or `--propose`). This is
 * the money and the printing.
 *
 * `loadEnvLocal()` reads THIS repo's `.env.local` for the OpenRouter key, off
 * the module's own location rather than the cwd — the tool root, never the repo
 * being pushed. `withLedger("cli", …)` is what makes the call appear in `npm run
 * cost`; without it the meter finds no collector, warns once and drops the row.
 *
 * A failure is one line and no proposal, never a refusal: this is advisory, and
 * `push-env` going down because a classifier was unavailable would be a nicety
 * taking the feature with it.
 */
async function askForProposal(
  names: readonly string[],
  why: string,
): Promise<Map<string, ProposedKey> | undefined> {
  // `PROPOSAL_MODEL`, not a model constant of this file's own choosing: the
  // request body is built in gjd-remote-envpolicy.ts, and a line here naming a
  // different model would be a lie printed with total confidence. It said
  // QUICK_MODEL_OPENROUTER for one afternoon while the job ran on the capable
  // one, which is the whole reason the name is exported.
  console.log(dim(`  asking ${PROPOSAL_MODEL} about ${names.length} key NAMES (${why})`));
  loadEnvLocal();
  let outcome: Proposal | undefined;
  await withLedger("cli", async () => {
    outcome = await proposeEnvKeys(names, { call: defaultProposalCall });
  });
  // `outcome` is assigned inside the callback, so the compiler cannot see that
  // it happened; undefined here means the ledger returned without running it,
  // which would be a bug rather than a model failure — and either way the
  // honest answer downstream is "no proposal".
  if (outcome === undefined || !outcome.ok) {
    console.log(yellow(`  no proposal: ${outcome?.why ?? "the call did not run"} — nothing is pre-ticked from it`));
    return undefined;
  }
  return outcome.proposal;
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

// `remoteSlug` used to have a second copy here. It is imported from
// scripts/gjd-remote-repo.ts now, which is the only place that regex lives.

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

/**
 * One directory on the box, asked strictly.
 *
 * WHAT THIS REPLACES, and why it is not a tidy-up. `cloneFacts()` asked with
 * `ssh(..., { check: false })` — no sentinel, no row count, a non-zero status
 * thrown away and every missing field defaulted to the empty string. A reply
 * cut after `token=yes` therefore came back as "the destination does not exist
 * and nothing else under ~/code is a checkout of anything", which is precisely
 * the answer that authorises a clone. It is the same failure class `inventory()`
 * was fixed for in Stage 1, and GPT Sol's Stage 2 finding 3 is that it was
 * still here.
 *
 * The decisions now come from two strict readers and nothing else: `inventory()`
 * for what is under the base folder, and this for one named directory —
 * including the tree a clone has just made, which the inventory deliberately
 * cannot see (it hides staging directories).
 */
function probeCheckout(dir: string): CheckoutProbe {
  const r = sshRun(checkoutProbeScript(dir));
  if (r.status !== 0) {
    die(`could not look at ${dir} on the box: ssh exited ${r.status ?? "on a signal"}.\n  ${lastWords(r.stderr)}`);
  }
  const got = parseCheckoutProbe(r.stdout);
  if (!got.ok) die(`could not look at ${dir} on the box: ${got.why}`);
  return got.probe;
}

/** What a checkout is, said the same way whether we found it or made it. */
function describeCheckout(p: CheckoutProbe): void {
  console.log(`  ${dim("remote")}  ${p.origin ?? dim("(none)")}`);
  console.log(`  ${dim("branch")}  ${p.branch ?? dim("(unknown)")}`);
  console.log(`  ${dim("HEAD")}    ${p.subject ?? dim("(no commits)")}`);
}

/**
 * The box's per-owner token, asked on its own and strictly.
 *
 * Existence and mode ONLY. Never the contents, not even a prefix of them —
 * this file is a GitHub credential and the tool has no reason to read one.
 */
function tokenProbeScript(tokenFile: string): string {
  return [
    `printf '${BOX_OK}\\n'`,
    `if [ -f ${shq(tokenFile)} ]; then printf 'token present\\n'; else printf 'token absent\\n'; fi`,
    `printf 'mode %s\\n' "$(stat -c '%a %U' ${shq(tokenFile)} 2>/dev/null || true)"`,
    `printf '${BOX_END}\\n'`,
  ].join("\n");
}

/** Checked BEFORE git rather than after: git's own error for a missing token
 *  names neither the owner nor the file. */
function requireToken(repo: Repo, tokenFile: string): void {
  const r = sshRun(tokenProbeScript(tokenFile));
  if (r.status !== 0) {
    die(`could not ask the box about ${tokenFile}: ssh exited ${r.status ?? "on a signal"}.\n  ${lastWords(r.stderr)}`);
  }
  const got = parseBoxRead(r.stdout, ["token", "mode"]);
  if (!got.ok) die(`could not ask the box about ${tokenFile}: ${got.why}`);
  if (got.fields.get("token") !== "present") {
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
  const mode = got.fields.get("mode") ?? "";
  if (mode && mode !== `600 ${USER}`) {
    console.log(red(`  warning: ${tokenFile} is '${mode}' and should be '600 ${USER}'`));
  }
}

/**
 * One clone: locked, verified, moved into place, and the old setup status for
 * that slug archived — all inside a single box-side transaction.
 *
 * THE WHOLE THING HOLDS ONE LOCK, and that is GPT Sol's Stage 2 finding 1. The
 * version this replaces asked the box whether the destination existed, and
 * renamed into it several seconds and one clone later; a `test -e` followed by
 * a rename is a TOCTOU check whichever shell runs it, and two `new-shell`s
 * racing on a repo the box has never had is two agents starting at once. The
 * transaction re-resolves the destination under the lock, reserves the staging
 * name with `mkdir` so the failure path can only ever remove a directory it
 * made (finding 2), and proves the destination IS the tree it verified by
 * comparing the `.git` inode across the rename.
 *
 * The generated shell and its parser are in scripts/gjd-remote-flow.ts, where
 * tests/gjd-remote-flow.test.ts runs them for real against temporary repos.
 *
 * stdout is captured for the protocol and **stderr is inherited**, so git's own
 * progress is on your terminal while it runs. A clone is the one thing here
 * slow enough that watching it is worth a round trip's worth of plumbing.
 */
function ensureRemoteCheckout(
  repo: Repo,
  where: { base: string; dest: string; dirName: string; slug: string },
): CheckoutProbe {
  const { base, dest, dirName, slug } = where;
  const staging = `${base}/${STAGING_PREFIX}${dirName}-${randomUUID().slice(0, 8)}`;
  const script = cloneTransactionScript({
    dest,
    staging,
    // Per destination directory, which is what two clones actually contend
    // over. Two different repos cloning to two names never wait on each other.
    lockPath: `${REMOTE_WORK}/${LOCKS_SUBDIR}/clone-${dirName}.lock`,
    locksDir: `${REMOTE_WORK}/${LOCKS_SUBDIR}`,
    url: repo.url,
    statusPath: setupStatusPath(REMOTE_WORK, slug),
  });

  const r = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (r.status !== 0) {
    die(
      `the clone could not be run on the box: ssh exited ${r.status ?? "on a signal"}.\n` +
        `  git's own output, if it got that far, is above.\n` +
        `  Nothing is concluded from a transaction that did not report.`,
    );
  }
  const got = parseCloneTransaction(r.stdout || "");
  if (!got.ok) {
    // A refusal the box MEANT — no lock to be had, no git, no base64 — means
    // nothing was made, and sending somebody to look at two paths that do not
    // exist is worse than saying so.
    die(
      got.refused
        ? `${got.why}.\n  Nothing was cloned and nothing at ${dest} was touched.`
        : `the clone did not report what it did: ${got.why}\n  Look at ${dest} and ${staging} before trying again.`,
    );
  }

  const o = got.outcome;
  switch (o.kind) {
    case "ok": {
      if (o.stale === "archived") {
        console.log(dim(`  a setup status from the checkout that used to be here was moved aside`));
      }
      return probeCheckout(dest);
    }
    /* A stale status that could NOT be moved aside used to be a yellow line on
       the `ok` arm and a clone that carried on. It is its own outcome now
       (scripts/gjd-remote-flow.ts), because readiness is the status file: a
       session started in the fresh checkout would be admitted on the evidence
       of the tree that used to be there. So this refuses, and names the file. */
    case "stale-stuck":
      return die(
        `the clone worked, and I could not move aside the setup status left by the checkout that used to be at ${dest}.\n` +
          `  ${setupStatusPath(REMOTE_WORK, slug)}\n` +
          `  That file is about the tree that WAS here, and until it is gone a session started in\n` +
          `  this one would be admitted on its evidence. Move it or delete it, then run: gjd-remote setup`,
      );
    case "taken":
      return die(`something appeared at ${dest} on the box while the clone was starting. Nothing was cloned.`);
    case "staging-taken":
      return die(
        `${staging} already exists on the box, and I will not clone into a directory I did not make.\n` +
          `  Nothing was cloned and nothing was touched. Look at it, then try again.`,
      );
    case "clone-failed":
      return die(
        `the clone failed on the box (exit ${o.code}) — git's own output is above.\n` +
          `  "Repository not found" on a repo that exists usually means the token has no\n` +
          `  grant for it, or is pending org approval; both read as a typo.\n` +
          `  ${dest} does not exist; nothing was moved into place.\n` +
          (o.swept === "removed"
            ? `  Nothing was left behind.`
            : `  What it did create is still at ${staging} — look at it, then remove it.`),
      );
    case "verify-failed":
      return die(
        (o.why === "wrong-remote"
          ? `cloned, but git recorded a different remote than the one asked for.\n` +
            `    asked for: ${repo.url}\n` +
            `    recorded:  ${o.origin || "(none)"}\n` +
            `  A rewrite (url.insteadOf) would do this, and an ssh remote can never fetch\n` +
            `  from this box — it has no GitHub ssh key.`
          : o.why === "no-head"
            ? `the clone said it succeeded, but HEAD does not resolve in what it made.`
            : `the clone said it succeeded, but what it made is not a checkout.`) +
          `\n  ${dest} does not exist; nothing was moved into place.\n` +
          `  The tree it made is at ${staging} — look at it, then remove it.`,
      );
    case "move-failed":
      return die(
        `the clone finished, but moving it into place did not.\n` +
          `  The verified checkout is at ${staging} — move it yourself, or remove it.`,
      );
    default:
      return die(
        `the clone finished and the move did not take: ${dest} is not the tree that was verified\n` +
          `  (its .git was inode ${o.before}, and ${dest} has ${o.after || "none"}).\n` +
          `  Something else is at ${dest}. The verified checkout is at ${staging}.`,
      );
  }
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
 * With no argument it clones the repo you are standing in.
 *
 * The tree is built at a staging name beside the destination and moved into
 * place only once it has been checked, so an interrupted clone leaves the
 * destination ABSENT rather than half-made — see the comment at the clone
 * itself, and `STAGING_PREFIX` in scripts/gjd-remote-repo.ts.
 *
 * It deliberately runs nothing else — no `npm ci`, no install. A clone that
 * quietly triggers a five-minute install is a clone you cannot use to look at
 * something. The setup command the repo's config would run is printed instead.
 */
async function cmdClone(
  given: string | undefined,
  opts: { baseFolder?: string | undefined; name?: string | undefined; repo?: string | undefined },
): Promise<void> {
  const repo = whichRepoToClone(given, opts.repo);
  // This laptop's checkout of the repo being cloned, when that is where we are
  // standing — the copy whose `.gjd-remote/config.toml` can be read and shown.
  // `identify` answers null for it when the cwd is some other repo, or none.
  const asIdentity = identify(`${repo.owner}/${repo.name}`);
  const localToplevel = asIdentity.ok ? asIdentity.id.localToplevel : null;
  const base = remotePath(opts.baseFolder ?? REMOTE_CODE, "--base-folder");
  const dirName = (opts.name ?? repo.name).trim();
  if (!GH_REPO.test(dirName)) {
    die(`'${dirName}' is not a usable directory name (letters, digits, . _ -; must start with a letter or digit)`);
  }
  const dest = `${base}/${dirName}`;
  const tokenFile = `${TOKEN_DIR}/${repo.owner}.token`;
  const want = `${repo.owner}/${repo.name}`.toLowerCase();

  console.log(bold(`gjd-remote clone ${repo.owner}/${repo.name} → ${HOST()}:${dest}`));

  // THE STRICT LISTING, not a best-effort one. Everything below decides whether
  // to write to the box, and the answer that authorises writing — "there is
  // nothing there" — is exactly what a cut-off reply used to look like.
  const inv = inventory(base);
  const at = entryIn(inv.entries, dest);
  const found = at?.isCheckout && at.origin !== undefined ? remoteSlug(at.origin) : undefined;

  // Already there — but only success if it is a checkout of the repo that was
  // ASKED FOR. This used to print the green ✓ and exit 0 for any checkout at
  // all, adding a red advisory line underneath saying it was a different repo:
  // a name collision and a done job then looked the same to a caller, to a
  // script, and to anyone reading the last line.
  if (at?.isCheckout) {
    if (found !== want) {
      die(
        `${dest} on the box is a checkout of a different repository.\n` +
          `  asked for: ${want}\n` +
          `  found:     ${found ?? `unrecognised remote '${at.origin || "(none)"}'`}\n` +
          `  Nothing was cloned and nothing was touched. --name or --base-folder to put\n` +
          `  ${want} somewhere else.`,
      );
    }
    console.log(green(`✓ already a checkout of ${want} — nothing to do`));
    describeCheckout(probeCheckout(dest));
    return;
  }

  // Answer about the directory that was actually asked for before offering
  // news about any other one: an occupied destination is the user's problem to
  // decide, and burying it under an advisory reads as success.
  if (at !== undefined) {
    die(
      `${dest} exists on the box but is not a git checkout${at.isSymlink ? " — it is a symlink" : ""}.\n` +
        `  Move it aside, or pass --name for a different directory.`,
    );
  }

  // The same repo under another name. This is the reading2/spideryarn2 case,
  // and cloning anyway is how you get two checkouts that drift apart.
  //
  // WITHOUT --name it is simply reported and nothing happens: the caller asked
  // for the repo, the repo is there, and a second copy is not what they meant.
  // WITH --name they have named a directory that is not the one already
  // holding it, which is the only way to say "I do want a second copy" — so it
  // is asked out loud, defaulting to No, rather than either refused or done
  // quietly. Off a terminal the question cannot be asked, and `confirmOrRefuse`
  // throws `NotInteractive`, which main() turns into a refusal.
  const twin = inv.entries.find(
    (e) => !e.isSymlink && e.isCheckout && e.origin !== undefined && remoteSlug(e.origin) === want,
  );
  if (twin) {
    if (opts.name === undefined) {
      console.log(green(`✓ ${want} is already on the box`) + dim(` — under a different name`));
      console.log(`  ${dim("at")}      ${twin.dir}`);
      console.log(dim(`  nothing cloned. For a genuinely separate second copy, use --name or --base-folder.`));
      return;
    }
    const yes = await confirmOrRefuse(
      `${want} is already on the box at ${twin.dir}. Clone a second copy to ${dest} anyway?`,
      promptStreams(),
      {
        default: false,
        instead:
          `Two checkouts of one repo diverge, and every command then refuses both as 'ambiguous'.\n` +
          `  Answer it from a terminal, or put the second copy outside ${base} with --base-folder DIR.`,
      },
    );
    if (!yes) {
      console.log(dim(`nothing cloned. ${want} is at ${twin.dir}.`));
      return;
    }
  }

  requireToken(repo, tokenFile);
  const after = ensureRemoteCheckout(repo, { base, dest, dirName, slug: want });

  console.log(green(`✓ cloned ${want}`));
  describeCheckout(after);
  // The setup command is PRINTED, never run: a clone that silently starts a
  // five-minute install is a clone you cannot use to go and look at something.
  saySetupPlan(localToplevel);
  console.log(dim("\nnext:"));
  // Both are run FROM that repo's checkout on this laptop, which is how they
  // find it on the box — by origin, not by the directory name above.
  console.log(dim(`  gjd-remote push-env      # from ${want}'s own checkout on this laptop`));
  console.log(dim(`  gjd-remote new-shell -d ${dest}`));
}

/** One entry of a listing, by path, with trailing slashes ignored on both
 *  sides. The listing is the strict one; this is only the lookup. */
function entryIn(entries: readonly InventoryEntry[], dir: string): InventoryEntry | undefined {
  const want = dir.replace(/\/+$/, "") || "/";
  return entries.find((e) => (e.dir.replace(/\/+$/, "") || "/") === want);
}

/**
 * Which repo `clone` was asked for: the argument, `--repo`, or — with neither —
 * the repo you are standing in, which is the common case and the one that needs
 * no typing.
 *
 * The argument and `--repo` together must AGREE. A clone of the wrong repo is
 * not a typo anybody notices until an agent is editing it.
 */
function whichRepoToClone(given: string | undefined, repoOpt: string | undefined): Repo {
  if (given !== undefined && repoOpt !== undefined && parseRepo(given).url !== parseRepo(repoOpt).url) {
    die(`clone was given two different repos: '${given}' and --repo ${repoOpt}.`);
  }
  const asked = given ?? repoOpt;
  if (asked !== undefined) return parseRepo(asked);

  const id = identify(undefined);
  if (!id.ok) {
    die(
      `gjd-remote clone [repo] [--base-folder DIR] [--name DIR-NAME]\n` +
        `  With no argument it clones the repo you are standing in, and you are not in one.\n` +
        `${id.why}`,
    );
  }
  console.log(dim(`repo: ${id.id.slug}  (${id.id.localToplevel})`));
  return parseRepo(id.id.slug);
}

/**
 * What setting this repo up on the box would run — printed, never run.
 *
 * It reads the config from the LAPTOP's checkout, which is the copy the person
 * reading this can see and edit. Sol's review asks for it to be re-read from
 * the cloned commit before anything is executed, and that belongs with the
 * command that executes it; here nothing runs, so the honest thing to show is
 * what is in front of you.
 */
function saySetupPlan(localToplevel: string | null): void {
  console.log(dim("\nsetup:"));
  if (localToplevel === null) {
    console.log(dim(`  not in a local checkout of this repo; setup command unknown until 'gjd-remote setup'`));
    return;
  }
  let cfg: RepoConfig;
  try {
    cfg = readRepoConfig(localToplevel);
  } catch (err) {
    console.log(yellow(`  ${err instanceof ConfigError ? err.message : String(err)}`));
    return;
  }
  console.log(
    cfg.setup.source === "none"
      ? dim(`  no setup command known — no ${CONFIG_FILE}, no ${SETUP_SCRIPT}, no npm 'setup' script`)
      : dim(`  ${cfg.setup.command}   (${cfg.setup.source})`),
  );
  for (const w of cfg.warnings) console.log(yellow(`  ${w}`));
  console.log(dim(`  nothing was run. Running it is 'gjd-remote setup'.`));
}

// ---------------------------------------------------------------- setup

/**
 * ## Setting a repo up on the box
 *
 * The durable half — the status file, the job script, the verdict — lives in
 * scripts/gjd-remote-setup.ts, and its header is where the design is written
 * down. What is here is the wiring: which config actually runs, how the job is
 * started, and how the verdict is read back afterwards.
 *
 * **THE CONFIG THAT RUNS IS THE BOX'S**, and that is GPT Sol's finding 4. The
 * laptop's `.gjd-remote/config.toml` is the copy you can see and edit; the
 * box's checkout is the copy the setup command will actually be run from. The
 * two differ whenever a change is uncommitted, or committed and unpushed, or
 * pushed and unpulled — which is most of the time while somebody is editing
 * one. So the box's copy is read on every run, and a disagreement REFUSES
 * rather than quietly picking a side: running the laptop's command against the
 * box's tree is a setup that nobody wrote and that no later reader could
 * reconstruct.
 *
 * **READINESS IS THE STATUS FILE**, never the checkout's presence and never
 * this command's exit code. Everything below reads it back through
 * `setupVerdict`, which is the one place that decides.
 */

/** Only `statusPath` and `lockPath` are read back, and neither depends on which
 *  attempt wrote them — so a reader needs a placeholder to get at them through
 *  the one function that knows the layout. It is never written to a path that
 *  survives this call. */
const ATTEMPT_PLACEHOLDER = "read-only";

function setupReadPaths(slug: string): { statusPath: string; lockPath: string } {
  const p = setupPaths({ work: REMOTE_WORK, slug, attempt: ATTEMPT_PLACEHOLDER });
  return { statusPath: p.statusPath, lockPath: p.lockPath };
}

/**
 * The tagged lines of a box read, framed at BOTH ends.
 *
 * The framing is `parseBoxRead` in scripts/gjd-remote-flow.ts, and the terminal
 * sentinel is GPT Sol's Stage 2 finding 5: a reply cut off after its last field
 * is byte-for-byte a complete one, so `GJDBOXOK` at the top proves only that
 * the script started. Every field is named up front, must appear exactly once,
 * and nothing else may appear.
 *
 * A non-zero ssh status is rejected BEFORE the parse, so it means one thing
 * only — the box could not be asked — and never "there is nothing there",
 * which is the answer that makes this tool run things.
 */
function boxRead(script: string, want: readonly string[], what: string): BoxFields | { ok: false; why: string } {
  const r = sshRun(script);
  if (r.status !== 0) {
    return { ok: false, why: `could not read ${what} on the box: ssh exited ${r.status ?? "on a signal"} — ${lastWords(r.stderr)}` };
  }
  const got = parseBoxRead(r.stdout, want);
  if (!got.ok) return { ok: false, why: `${what}: ${got.why}` };
  return got;
}

type BoxFields = { ok: true; fields: ReadonlyMap<string, string> };

/**
 * The repo's config as the BOX has it, and the specification that comes with
 * it.
 *
 * The script and the field parser are `boxConfigScript`/`parseBoxConfig` in
 * scripts/gjd-remote-flow.ts, where tests/gjd-remote-flow.test.ts runs them
 * against real temporary checkouts — including the one that caught this
 * protocol reporting "no setup script in package.json" as "package.json is
 * unparseable".
 */
type BoxSpecRead = { ok: true; config: RepoConfig; spec: SetupSpec } | { ok: false; why: string };

/**
 * The repo's config as the BOX has it, and the specification that comes with
 * it. Never dies: `doctor` wants the reason as a red line rather than as the
 * end of the run, and `setup` wants to name the directory it was reading from.
 */
function readBoxConfig(dir: string): BoxSpecRead {
  const r = sshRun(boxConfigScript({ dir, configDir: CONFIG_DIR, configFile: CONFIG_FILE, setupScript: SETUP_SCRIPT }));
  if (r.status !== 0) {
    return {
      ok: false,
      why: `could not read ${CONFIG_FILE} in ${dir} on the box: ssh exited ${r.status ?? "on a signal"} — ${lastWords(r.stderr)}`,
    };
  }
  const got = parseBoxConfig(r.stdout, dir);
  if (!got.ok) return { ok: false, why: `${CONFIG_FILE} in ${dir}: ${got.why}` };

  let config: RepoConfig;
  try {
    config = parseRepoConfig(got.fields.configText, {
      setupScript: got.fields.setupScript,
      packageJsonHasSetup: got.fields.packageJsonHasSetup,
    });
  } catch (err) {
    const why = err instanceof ConfigError ? err.message : String(err);
    return { ok: false, why: `the ${CONFIG_FILE} in ${dir} on the box is not usable:\n  ${why}` };
  }
  return {
    ok: true,
    config,
    spec: setupSpec(config, { scriptSha256: got.fields.scriptSha256, packageSetup: got.fields.packageSetup }),
  };
}

/** The same specification, from this laptop's checkout. Throws `ConfigError`
 *  the way `readRepoConfig` does, so a broken local config reads the same
 *  wherever it is met. */
function localSpec(toplevel: string): { config: RepoConfig; spec: SetupSpec } {
  const config = readRepoConfig(toplevel);
  let scriptSha256: string | null = null;
  try {
    scriptSha256 = sha256(readFileSync(path.join(toplevel, SETUP_SCRIPT)));
  } catch {
    // Absent, or unreadable. `readRepoConfig` has already decided what that
    // means for the resolution; here it simply means there is no hash to
    // compare, which is what `null` says.
  }
  let packageSetup: string | null = null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(toplevel, "package.json"), "utf8"));
    if (typeof parsed === "object" && parsed !== null) {
      const scripts = (parsed as { scripts?: unknown }).scripts;
      if (typeof scripts === "object" && scripts !== null) {
        const setup = (scripts as { setup?: unknown }).setup;
        if (typeof setup === "string" && setup.trim()) packageSetup = setup.trim();
      }
    }
  } catch {
    // Same again: `readRepoConfig` throws on a package.json it cannot parse,
    // and it has already run by the time this does.
  }
  return { config, spec: setupSpec(config, { scriptSha256, packageSetup }) };
}

/**
 * The config that will run, having checked it against the one you can see.
 *
 * `boxDir` is the verified checkout. `localToplevel` is this laptop's checkout
 * of the same repo, or null when `--repo` named one we are not standing in — in
 * which case there is nothing to compare and the box's copy simply is the
 * answer, said out loud.
 *
 * WHAT IS COMPARED IS THE SPECIFICATION, not the command strings. GPT Sol's
 * Stage 2 finding 4: three real disagreements have identical commands, because
 * in each of them the command is a constant and the thing that changed is a
 * file behind it. `diffSetupSpec` names the field that differs and prints both
 * sides.
 */
function authoritativeConfig(slug: string, boxDir: string, localToplevel: string | null): { config: RepoConfig; spec: SetupSpec } {
  const box = readBoxConfig(boxDir);
  if (!box.ok) die(box.why);

  if (localToplevel === null) {
    console.log(dim(`config: read from ${boxDir} on the box (you are not in a local checkout of ${slug})`));
    return { config: box.config, spec: box.spec };
  }

  let here: { config: RepoConfig; spec: SetupSpec };
  try {
    here = localSpec(localToplevel);
  } catch (err) {
    die(err instanceof ConfigError ? err.message : String(err));
  }

  const differences = diffSetupSpec(box.spec, here.spec);
  if (differences.length > 0) {
    die(
      `${slug}'s setup differs between the box and this laptop, so I will not choose.\n` +
        differences
          .map(
            (d) =>
              `  ${d.field}:\n` +
              `    the box (${boxDir}) — this is the copy that would run: ${d.a}\n` +
              `    this laptop (${localToplevel}): ${d.b}\n`,
          )
          .join("") +
        `  Nothing was run. Commit and push the change, then pull it on the box —\n` +
        `    gjd-remote ssh 'cd ${boxDir} && git pull'`,
    );
  }
  console.log(dim(`config: ${boxDir} on the box and ${localToplevel} here agree`));
  return { config: box.config, spec: box.spec };
}

/** Say what would run, and every complaint the config had about the files
 *  around it. Warnings are the two ways something on disk is being ignored, and
 *  a warning nobody prints is a file that silently does nothing. */
function saySetupCommands(cfg: RepoConfig, spec: SetupSpec, where: string): void {
  console.log(cfg.setup.source === "none" ? dim(`setup:  (none known)`) : dim(`setup:  ${describeSpec(spec)}  ${where}`));
  if (cfg.check) console.log(dim(`check:  ${cfg.check.command}`));
  for (const w of cfg.warnings) console.log(yellow(`  ${w}`));
}

/**
 * `setupReadScript` USED TO BE HERE, in its own second copy, and it was deleted
 * on 2026-09-02. It is `setupReadScript` in scripts/gjd-remote-flow.ts now,
 * where tests/gjd-remote-flow.test.ts RUNS it — against a real lock file, with
 * `flock` taken off the PATH, which is the one arrangement where a probe in the
 * right order and no probe at all give different answers.
 *
 * The copy that lived here used `base64 -w0`, which is GNU-only: the same
 * script under the test's macOS bash printed nothing and the field came back
 * empty. One of the two copies was therefore untestable, which is how a second
 * copy of a wire protocol earns its keep right up until it doesn't.
 */

type SetupRead =
  | {
      ok: true;
      status: SetupStatus | undefined;
      lock: LockState;
      unreadable: string | undefined;
      /** The `.git` inode of the checkout being asked about, when it has one. */
      inode: string | undefined;
      /**
       * The status file's own bytes, base64, EXACTLY as the box sent them —
       * `null` when there is no status file at all.
       *
       * Kept because `sessionAdmissionScript` compares this string, byte for
       * byte, against what the box reads back under the lock a moment later.
       * Re-encoding the parsed status would compare two ideas of what the file
       * says rather than the file; and a round trip through anybody's JSON
       * would make an unreadable file impossible to speak about at all.
       */
      raw: string | null;
    }
  | { ok: false; why: string };

/**
 * The status file, the lock and the checkout's identity, in one round trip.
 *
 * A status file that is THERE and does not parse is not the same as no status
 * file: the first is a verdict this reader refuses to believe, the second is a
 * repo nothing has ever set up. So `status: undefined` with an `unreadable`
 * reason is carried separately, and the caller prints it — `setupVerdict` would
 * otherwise call a corrupt file `never-run` and cheerfully offer to run setup
 * over the top of whatever wrote it.
 */
function readSetupState(slug: string, dir: string): SetupRead {
  const { statusPath, lockPath } = setupReadPaths(slug);
  const got = boxRead(setupReadScript({ statusPath, lockPath, dir }), [...SETUP_READ_FIELDS], `the setup status for ${slug}`);
  if (!got.ok) return got;

  const lockWord = got.fields.get("lock") ?? "";
  const lock = LOCK_STATES.find((l) => l === lockWord);
  if (lock === undefined) return { ok: false, why: `the box said the lock is '${lockWord}', which means nothing to me` };

  const rawInode = got.fields.get("inode") ?? "-";
  if (rawInode !== "-" && !/^[0-9]+$/.test(rawInode)) {
    return { ok: false, why: `the box said ${dir}'s .git inode is '${rawInode}', which is not a number` };
  }
  const inode = rawInode === "-" ? undefined : rawInode;

  const st = got.fields.get("status") ?? "";
  if (st === "absent") return { ok: true, status: undefined, lock, unreadable: undefined, inode, raw: null };
  if (st !== "present") return { ok: false, why: `the box said the status file is '${st}', which means nothing to me` };

  const raw = got.fields.get("text") ?? "";
  const decoded = decodeBoxField(raw, statusPath);
  if (!decoded.ok) return { ok: false, why: decoded.why };
  const parsed = parseSetupStatus(decoded.text);
  // A file that is there and does not parse still HAS bytes, and the admission
  // compares bytes — so `raw` travels on this arm too. It is what makes "the
  // status changed while you were being asked" a thing that can be said about
  // a file nobody could read.
  if (!parsed.ok) return { ok: true, status: undefined, lock, unreadable: parsed.why, inode, raw };
  return { ok: true, status: parsed.status, lock, unreadable: undefined, inode, raw };
}

/**
 * What this run is asking the status file to be evidence of.
 *
 * Built in ONE place because forgetting a field here is not a type error on the
 * two that are optional, and each of them is a way an old success applies to a
 * tree it was never about — GPT Sol's Stage 2 finding 7.
 */
function setupExpectation(o: {
  attempt: string | null;
  configSha256: string;
  slug: string;
  dir: string;
  inode: string | undefined;
}): SetupExpectation {
  return {
    attempt: o.attempt,
    configSha256: o.configSha256,
    slug: o.slug,
    dir: o.dir,
    ...(o.inode === undefined ? {} : { checkoutInode: o.inode }),
  };
}

/**
 * The tmux session name for a setup job: `setup-<slug>-<8 of the attempt>`.
 *
 * It has to satisfy `SLUG`, because that is what `gjd-remote kill` and `resume`
 * check before they will touch a name — a setup session nobody can kill by name
 * would be a session you have to ssh in and hunt for. So the slug half is
 * lower-cased, anything outside the alphabet becomes a hyphen (a repo name may
 * hold `.` and `_`, which `SLUG` refuses), and it is trimmed to leave room for
 * the attempt. The attempt fragment is what makes two runs distinguishable, so
 * it is never the part that gets cut.
 */
function setupSessionName(slug: string, attempt: string): string {
  const short = attempt.replaceAll("-", "").slice(0, 8);
  const room = 41 - "setup-".length - 1 - short.length;
  const base = setupSlugFile(slug).toLowerCase().replaceAll(/[^a-z0-9-]+/g, "-").slice(0, Math.max(1, room));
  const name = `setup-${base}-${short}`;
  if (!SLUG.test(name)) die(`'${name}' would not be a session name I could kill by name later`);
  return name;
}

/** A setup job can exit before it writes anything, and then the pane is gone
 *  too — so `confirmStarted`'s "it left no note" is true and unhelpful. These
 *  are the three ways, each with its own exit code in `SETUP_EXIT`. */
function confirmSetupStarted(name: string, slug: string, attempt: string, logPath: string, dir: string): string {
  // As `confirmStarted`: the id comes back with the proof, because the caller's
  // next move is to attach and a name is not an address — and `=name:` with the
  // COLON, for the reason spelled out there.
  const out = ssh(`sleep 1; tmux display-message -p -t ${shq(`=${name}:`)} '#{session_id}' 2>/dev/null`, {
    check: false,
  }).trim();
  if (/^\$\d+$/.test(out)) return out;
  const read = readSetupState(slug, dir);
  const wrote = read.ok && read.status !== undefined && read.status.attempt === attempt;
  die(
    `the setup job for ${slug} did not survive starting.\n` +
      (wrote
        ? `  It wrote a status first, so look at it: gjd-remote setup --status\n`
        : `  It wrote no status, so it stopped before it began. The three ways are:\n` +
          `    ${SETUP_EXIT.locked} another setup for ${slug} holds the lock\n` +
          `    ${SETUP_EXIT.noFlock} flock is not installed on the box\n` +
          `    ${SETUP_EXIT.unusable} the checkout could not be entered, or the status file could not be written\n`) +
      `  the job's log, if it got that far: ${logPath}`,
  );
}

/** The one line the whole command exists to produce. Exits 0 only for a
 *  `success` that is about the run we asked about. */
function saySetupVerdict(v: SetupVerdict, lock: LockState): never {
  if (v.kind === "success") {
    console.log(green(`✓ ${v.why}`));
    return process.exit(0);
  }
  console.error(red(`✗ ${describeVerdict(v)}`));
  if (v.kind === "in-progress") console.error(dim(`  the box-side lock is ${lock}${lock === "held" ? " — a run really is under way" : " — nothing holds it, so that attempt died"}`));
  return process.exit(1);
}

/**
 * `gjd-remote setup` — run this repo's setup command on the box, durably.
 *
 * The order is the design, and each step exists because skipping it produces a
 * confident wrong answer:
 *
 *  1. Resolve the checkout, verified. An `absent` repo dies with the clone
 *     command — Stage 3 turns that into a prompt.
 *  2. Read the config from the BOX, and refuse if this laptop's copy disagrees.
 *  3. Read the status file and the lock. A live attempt is refused; a `success`
 *     for the same config is already done and says so.
 *  4. Upload the job and start it in its own tmux session, then record it.
 *  5. Attach, so somebody watches — and read the verdict off the FILE when the
 *     attach returns, never off the stream or the pane's exit code.
 */
function cmdSetup(opts: {
  repo?: string | undefined;
  dir?: string | undefined;
  status: boolean;
  force: boolean;
  attach: boolean;
  transport?: string | undefined;
}): void {
  const target = resolveTarget({ repo: opts.repo, dir: opts.dir, requireIdentity: true });
  if (target.slug === null || !target.verified) {
    // Unreachable: requireIdentity makes namedDir verify, and the origin path
    // is verified by construction. Written out rather than asserted, because
    // "which repo is this setup for" is the question the status file is keyed
    // on and a wrong answer there is a wrong readiness verdict for ever.
    die("setup needs a verified checkout of a repo, and this target is not one");
  }
  const slug = target.slug;

  const { config: cfg, spec } = authoritativeConfig(slug, target.dir, target.localToplevel);
  saySetupCommands(cfg, spec, "on the box");
  if (cfg.setup.source === "none") {
    die(
      `no setup known for ${slug}: add ${CONFIG_FILE} or ${SETUP_SCRIPT}.\n` +
        `  A repo with no setup command is not a repo that is set up — reporting that as\n` +
        `  success is how a session starts in a tree where nothing was ever installed.`,
    );
  }
  const command = cfg.setup.command;
  const check = cfg.check?.command;
  // The whole specification, hashed once — see `expectedConfigSha`. `spec` is
  // the box's, because the box's copy is the one that runs.
  const sha = setupFingerprint(spec);

  const state = readSetupState(slug, target.dir);
  if (!state.ok) die(state.why);
  if (state.unreadable !== undefined) {
    die(
      `there is a setup status file for ${slug} on the box and I will not act on it: ${state.unreadable}.\n` +
        `  ${setupReadPaths(slug).statusPath}\n` +
        `  Look at it, or delete it, before running setup over the top of whatever wrote it.`,
    );
  }

  // `attempt: null` — this is the "is it ready?" question, not "how did MY run
  // go?", which is the one asked at the end.
  const before = setupVerdict(
    state.status,
    setupExpectation({ attempt: null, configSha256: sha, slug, dir: target.dir, inode: state.inode }),
  );

  // Not `return saySetupVerdict(…)`: it returns `never` and this returns void,
  // and biome is right that handing one back as the other reads as a value.
  if (opts.status) {
    // The verdict is settled and the laptop's log may still say `started` —
    // GPT Sol's Stage 2 finding 10. Written here, once, before it is printed.
    reconcileSetupLog(slug, state.status, before, target.dir);
    saySetupVerdict(before, state.lock);
  }

  // The whole verdict × lock × --force matrix is `setupGateDecision` in
  // scripts/gjd-remote-flow.ts, where a test walks every cell of it.
  const gate = setupGateDecision(before, state.lock, opts.force);
  if (gate.kind === "refuse") {
    die(`${gate.why}${gate.remedy === null ? "" : `\n  ${gate.remedy}`}${sayLockHolders(slug, state.lock)}`);
  }
  if (gate.kind === "already-ready") {
    console.log(green(`✓ ${gate.why}`));
    console.log(dim(`  the config has not changed since — 'gjd-remote setup --force' to run it again anyway`));
    return;
  }
  if (gate.note !== null) console.log(gate.note === before.why ? dim(`status: ${gate.note}`) : yellow(gate.note));

  const run = runSetup({
    target,
    slug,
    command,
    check,
    spec,
    attach: opts.attach,
    transport: opts.transport,
    statusHint: `gjd-remote setup --status${opts.repo ? ` --repo ${slug}` : ""}   # how did it go?`,
  });
  if (run.kind === "verdict") saySetupVerdict(run.verdict, run.lock);
}

/** Which session is holding the lock, when one is — a name you can type rather
 *  than a fact you have to go and hunt for. Asked only on the refusal path,
 *  because it is a round trip. */
function sayLockHolders(slug: string, lock: LockState): string {
  if (lock !== "held") return "";
  const holders = sessions()
    .filter((s) => s.meta.version === 1 && s.meta.kind === "setup" && s.meta.repo === slug)
    .map((s) => s.name);
  return (
    `\n  it holds ${setupReadPaths(slug).lockPath}\n` +
    (holders.length
      ? holders.map((n) => `    gjd-remote resume ${n}   # watch it\n`).join("")
      : `  No setup session for ${slug} is listed, so something else on the box has the lock.\n`)
  );
}

/**
 * Close a setup attempt in the laptop's log, once, when the box says it is
 * settled and this laptop only ever wrote `started`.
 *
 * GPT Sol's Stage 2 finding 10: `--no-attach`, or detaching from a job that
 * then finished, leaves a `started` line and nothing else, for ever. `gjd-remote
 * log` reads that log, so a run that succeeded ten minutes ago stayed open in
 * the only durable record of it.
 *
 * Idempotent BY ATTEMPT — `needsTerminalSetupRecord` in
 * scripts/gjd-remote-flow.ts — so `setup --status` can be run ten times and the
 * outcome is written once. Nothing is invented: a verdict this laptop never
 * started, or one that is still `in-progress`, writes nothing.
 */
function reconcileSetupLog(slug: string, status: SetupStatus | undefined, v: SetupVerdict, dir: string): void {
  if (status === undefined) return;
  if (v.kind !== "success" && v.kind !== "failed") return;
  const file = logPath(process.env, homedir());
  if (!existsSync(file)) return;
  const parsed = parseLog(readFileSync(file, "utf8"));
  if (!needsTerminalSetupRecord(parsed.records, status.attempt)) return;
  appendLog({
    cmd: "setup",
    repo: slug,
    attempt: status.attempt,
    outcome: v.kind === "success" ? "success" : "failed",
    dir,
    host: host(),
  });
  console.log(dim(`  (recorded that attempt's outcome in the log, which only had its start)`));
}
/**
 * What happened to one setup run, as far as this laptop can honestly say.
 *
 * `started` and `detached` are NOT verdicts and must never be treated as one:
 * in both, the job is alive on the box and nobody has read its status file.
 * They are separate arms rather than one "unknown" because they need different
 * sentences — one of them means you asked not to watch.
 */
type SetupRun =
  | { kind: "started"; name: string; attempt: string }
  | { kind: "detached"; name: string; attempt: string }
  | { kind: "verdict"; name: string; attempt: string; verdict: SetupVerdict; lock: LockState };

/**
 * Mint an attempt, start the job, and — when somebody is watching — read the
 * verdict back off the file afterwards.
 *
 * THE ONE PLACE A SETUP IS STARTED. `gjd-remote setup` and the automatic
 * clone-then-setup inside `new-claude`/`new-shell` both come here, so there is
 * one attempt id, one status file, one lock and one log record however it was
 * asked for. The two callers differ only in what they do with the answer:
 * `setup` prints it and exits, and a session refuses on anything but `success`.
 *
 * It deliberately decides NOTHING about whether the run should happen —
 * `setupGate` is that, and it belongs to the command, not to the mechanism.
 */
function runSetup(o: {
  target: Target;
  slug: string;
  command: string;
  check: string | undefined;
  /**
   * The BOX's specification — the copy that will run.
   *
   * The specification rather than a hash, because two things have to come out
   * of it and they must come out of the same one: the `configSha256` the status
   * file records, and the file facts the job re-derives under the lock before
   * it runs anything. Handed them separately, a caller could pass a fingerprint
   * of one config and the files of another, and nothing would ever say so.
   */
  spec: SetupSpec;
  attach: boolean;
  transport?: string | undefined;
  /** The line printed under a started-but-unwatched job: how to ask later. */
  statusHint: string;
}): SetupRun {
  const attempt = newSetupAttempt();
  const sha = setupFingerprint(o.spec);
  const paths = setupPaths({ work: REMOTE_WORK, slug: o.slug, attempt });
  const name = setupSessionName(o.slug, attempt);
  // The same proof `new-claude` takes before it starts a session: `cd`, not
  // `test -d`, so a directory nothing can enter fails here where somebody is
  // reading rather than inside a pane nobody is watching.
  const dir = sessionDir(o.target);

  const job = setupJobScript({
    slug: o.slug,
    dir,
    attempt,
    command: o.command,
    ...(o.check === undefined ? {} : { check: o.check }),
    configSha256: sha,
    home: `/home/${USER}`,
    user: USER,
    statusPath: paths.statusPath,
    tmpPath: paths.tmpPath,
    lockPath: paths.lockPath,
    logPath: paths.logPath,
    setupDir: paths.setupDir,
    locksDir: paths.locksDir,
    // THE FILES AS THIS LAPTOP SAW THEM, re-derived by the job inside the lock
    // — GPT Sol's Stage 3 finding 2. Between the config read above and the job
    // starting, the checkout is a directory anything on the box can write to: a
    // `git pull` in another pane rewrites `.gjd-remote/setup`, and the job runs
    // bytes nobody agreed to under a fingerprint naming the ones they did.
    // Omitting this emits no check at all, silently, which is why it is passed
    // here rather than defaulted there.
    expectFiles: { scriptSha256: o.spec.scriptSha256, packageSetup: o.spec.packageSetup },
  });

  const jobPath = `${REMOTE_WORK}/jobs/setup-${setupSlugFile(o.slug)}-${attempt}.sh`;
  console.log(bold(`gjd-remote setup ${o.slug}`) + dim(` → ${HOST()}:${dir}  (attempt ${attempt})`));
  ssh(`mkdir -p ${REMOTE_WORK}/jobs`);
  writeRemote(job, jobPath, { exec: true });
  ssh(`tmux new-session -d -s ${name} ${metaFlags(o.target, dir, "setup")} ${shq(`bash ${jobPath}`)}`);
  const setupTmuxId = confirmSetupStarted(name, o.slug, attempt, paths.logPath, dir);
  appendLog({ cmd: "setup", repo: o.slug, attempt, outcome: "started", dir, host: host() }, { loud: true });
  console.log(green(`✓ started '${name}'`) + dim(` — its verdict will be ${paths.statusPath}`));

  if (!o.attach) {
    console.log(dim(`  ${o.statusHint}`));
    console.log(dim(`  gjd-remote resume ${name}   # watch it`));
    return { kind: "started", name, attempt };
  }

  // The job ends with `exec bash -l`, so the pane outlives the work and this
  // returns when the user detaches or closes it — which is why there is
  // anything to do afterwards at all.
  attachAndReturn({ id: setupTmuxId, name }, o.transport);
  const seen = reportAfterAttach({ slug: o.slug, name, attempt, sha, dir, statusPath: paths.statusPath });
  return seen === null ? { kind: "detached", name, attempt } : { kind: "verdict", name, attempt, ...seen };
}

/**
 * The gate that decided whether a setup could start USED TO LIVE HERE, printing
 * and dying as it went. It is `setupGateDecision` in
 * scripts/gjd-remote-flow.ts now, returning `start | already-ready | refuse`,
 * because a decision that exits cannot be tested and cannot be reused by the
 * clone-then-setup flow — GPT Sol's Stage 2 findings 9 and 11. `cmdSetup` above
 * calls it and does the printing.
 */

/**
 * The verdict, once the watching is over — read off the FILE, and only from a
/**
 * The verdict, once the watching is over — read off the FILE, and only from a
 * file about THIS attempt.
 *
 * A pane that is still there when you detach is the ordinary case, so
 * `in-progress` here is not a failure: it is "you left, it did not". That case
 * comes back as `null` — there IS no verdict — rather than as a verdict the
 * caller might mistake for one; a status file this reader could not believe
 * still ends the run here, because no caller has a sensible next move.
 */
function reportAfterAttach(o: {
  slug: string;
  name: string;
  attempt: string;
  sha: string;
  dir: string;
  statusPath: string;
}): { verdict: SetupVerdict; lock: LockState } | null {
  const after = readSetupState(o.slug, o.dir);
  if (!after.ok) {
    console.error(red(`✗ ${after.why}`));
    console.error(dim(`  the job may well have finished — gjd-remote setup --status`));
    process.exit(1);
  }
  if (after.unreadable !== undefined) {
    console.error(red(`✗ the status file at ${o.statusPath} is not one: ${after.unreadable}`));
    process.exit(1);
  }
  // NOW the attempt matters: a file about any other run says nothing about this
  // one, however healthy it looks.
  const v = setupVerdict(
    after.status,
    setupExpectation({ attempt: o.attempt, configSha256: o.sha, slug: o.slug, dir: o.dir, inode: after.inode }),
  );
  if (v.kind === "in-progress") {
    console.log(yellow(`setup is still running (attempt ${o.attempt}) — you detached, it did not stop`));
    console.log(dim(`  gjd-remote resume ${o.name}   # back to it`));
    console.log(dim(`  gjd-remote setup --status   # the verdict, when there is one`));
    return null;
  }
  appendLog({
    cmd: "setup",
    repo: o.slug,
    attempt: o.attempt,
    outcome: v.kind === "success" ? "success" : "failed",
    dir: o.dir,
    host: host(),
  });
  return { verdict: v, lock: after.lock };
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
  // `emacs -nw` is the box's editor (docs/project/hetzner-remote-server-box.md).
  // This probe says the binary is there; whether $EDITOR and the `editor`
  // alternative point at it is asserted by provision.sh's own verify section,
  // because those are login-shell and root facts and this runs neither.
  { name: "emacs", run: "emacs --version", want: /^GNU Emacs \d+\./ },
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
 * The MCP servers the TARGET repo declares, against what the box holds for that
 * checkout.
 *
 * Two of the three need an OAuth login only a human with a browser can do, once
 * per box. Nothing about a box that has not had it done looks wrong: sessions
 * start, the suite passes, and an agent simply never has the tool. The failure
 * is an absence, so it needs a check rather than a reader.
 *
 * BOTH SIDES ARE THE REMOTE TARGET, and that is the change this stage makes:
 * the wanted list is read from the checkout's own `.mcp.json` ON THE BOX, and
 * `claude mcp list` runs in that same directory. Reading the wanted list from
 * THIS checkout while listing servers in another repo's would compare two
 * different repos and call the difference a broken box.
 *
 * Everything else `doctor` asks is about the box, which is shared, and stays on
 * the tool root — Terraform state, `provision.sh`, the browser smoke test.
 *
 * It takes the resolved directory rather than the `--repo` string: the repo
 * half has already asked the box where the checkout is, and asking a second
 * time is both a second round trip and a second chance for the two answers to
 * differ.
 */
function mcpOutcome(dir: string): { kind: "skip"; why: string } | { kind: "check"; ok: boolean; why: string } {
  const mcpFile = `${dir}/.mcp.json`;
  // A TAGGED READ, not `cat … 2>/dev/null || true`. That idiom turned four
  // different things into one empty string — the file is absent, the file is
  // there and unreadable, the file is there and empty, and the connection died
  // — and the caller then skipped the check and let `doctor` exit 0 on all
  // four. Only the first is a repo with nothing to say. GPT Sol's Stage 1
  // review, blocker 3.
  //
  // `cat` is last in its branch, so an unreadable file makes the whole script
  // exit non-zero, which is the transport-or-permission arm below.
  const read = sshRun(`f=${shq(mcpFile)}\nif [ -e "$f" ]; then echo GJDMCP-PRESENT; cat -- "$f"; else echo GJDMCP-ABSENT; fi`);
  if (read.status !== 0) {
    return { kind: "check", ok: false, why: `could not read ${mcpFile}: ssh exited ${read.status ?? "on a signal"}, ${lastWords(read.stderr)}` };
  }
  const nl = read.stdout.indexOf("\n");
  const tag = (nl === -1 ? read.stdout : read.stdout.slice(0, nl)).trim();
  const raw = nl === -1 ? "" : read.stdout.slice(nl + 1);
  // A repo that declares nothing has nothing to be wrong about, and failing it
  // would make doctor red for every repo but this one. This is the ONE arm that
  // may skip, and it is the one the box said out loud.
  if (tag === "GJDMCP-ABSENT") return { kind: "skip", why: `${mcpFile} does not exist on the box` };
  if (tag !== "GJDMCP-PRESENT") {
    return { kind: "check", ok: false, why: `the box did not answer about ${mcpFile} in the form this asked for` };
  }
  if (raw.trim() === "") {
    return { kind: "check", ok: false, why: `${mcpFile} exists on the box and is empty, so it declares nothing and is not nothing` };
  }
  const declared = declaredServers(raw);
  if (!declared.ok) return { kind: "check", ok: false, why: `${mcpFile}: ${declared.why}` };
  // `|| true` and check:false: `claude mcp list` exits non-zero when any server
  // is unhealthy, including servers of Greg's that are none of our business.
  // Its OUTPUT is the answer; its exit code is not.
  const listing = ssh(`cd ${shq(dir)} && timeout 120 claude mcp list 2>&1 || true`, { check: false });
  const verdict = mcpVerdict(listing, declared.names);
  return { kind: "check", ok: verdict.ok, why: verdict.why };
}

type CheckState = "ok" | "fail" | "skip";

/**
 * Where a doctor check's verdict goes — and the reason the two halves below can
 * be separate functions without either of them being able to lie about what it
 * ran.
 *
 * `skip` is a first-class outcome rather than "no result": a check that did not
 * run is named in the summary as skipped, never left out, because a check
 * silently not running looks exactly like one that passed.
 */
type Scoreboard = {
  check: (name: string, ok: boolean, note?: string) => void;
  skip: (name: string, why: string) => void;
  /** For the one place that has already printed a better message than `check`
   *  would: the ssh refusal, which needs three lines of its own. */
  record: (name: string, state: CheckState) => void;
};

/**
 * The two halves, by name. Each is its own list because they are expected
 * separately: `--box-only`, or a `doctor` run from outside any repo, expects
 * the box's list and nothing else, and the summary's denominator has to match
 * what was actually asked for.
 */
const BOX_CHECKS = ["ssh", "mosh", ...TOOLS.map((t) => t.name), "tmux keys", "browser", "browser mcp", "provisioning"];
const REPO_CHECKS = ["setup", "HEAD", "origin", "mcp", "setup status"];

/**
 * Whether this repo's setup has ever run on the box, and how it went.
 *
 * THE ONE LINE THAT MAY ANSWER "is it ready?", and it answers it from the
 * status file under `~/gjd-remote/setup/` rather than from the checkout's
 * presence — a failed setup leaves a perfectly ordinary-looking checkout behind
 * (Sol's finding 2). Everything except `success`, for the config the repo asks
 * for TODAY, is a red cross with the command to type.
 *
 * It reads the config from the BOX, because that is the copy that would run;
 * and it fails when this laptop's copy resolves to something different, since
 * that is precisely the state in which `gjd-remote setup` refuses.
 */
function doctorSetupStatus(id: Identity, dir: string, d: Scoreboard): void {
  const box = readBoxConfig(dir);
  if (!box.ok) {
    d.check("setup status", false, box.why.split("\n")[0] ?? box.why);
    return;
  }
  if (box.config.setup.source === "none") {
    d.check("setup status", false, `${dir} on the box has no setup command, so nothing could ever have set it up`);
    return;
  }
  if (id.localToplevel !== null) {
    let laptop: { config: RepoConfig; spec: SetupSpec } | undefined;
    try {
      laptop = localSpec(id.localToplevel);
    } catch {
      // Already reported by the `setup` check above, in its own words.
    }
    if (laptop !== undefined) {
      // The SPECIFICATION, not the command strings — the same comparison
      // `gjd-remote setup` refuses on, so doctor cannot say ready where setup
      // would say no (GPT Sol's Stage 2 finding 4).
      const differences = diffSetupSpec(box.spec, laptop.spec);
      const first = differences[0];
      if (first !== undefined) {
        d.check(
          "setup status",
          false,
          `the box and this laptop disagree about ${first.field} ('${first.a}' vs '${first.b}') — ` +
            `gjd-remote setup refuses until they agree`,
        );
        return;
      }
    }
  }
  const sha = setupFingerprint(box.spec);
  const state = readSetupState(id.slug, dir);
  if (!state.ok) {
    d.check("setup status", false, state.why.split("\n")[0] ?? state.why);
    return;
  }
  if (state.unreadable !== undefined) {
    d.check("setup status", false, `there is a status file and it is not one: ${state.unreadable}`);
    return;
  }
  // `attempt: null` — doctor is asking "is this repo ready?", which no
  // particular run owns.
  const v = setupVerdict(
    state.status,
    setupExpectation({ attempt: null, configSha256: sha, slug: id.slug, dir, inode: state.inode }),
  );
  d.check("setup status", v.kind === "success", v.remedy === null ? v.why : `${v.why} — ${v.remedy.split("#")[0]?.trim()}`);
}

/**
 * Everything about the BOX, which is shared and belongs to no repo: can we
 * reach it, are the tools there and working, does tmux bind nothing, does the
 * browser come up, did provisioning finish.
 *
 * Returns false when ssh itself failed, because nothing below that line is
 * knowable — the caller stops rather than reporting a wall of unknowns.
 */
function doctorBox(d: Scoreboard): boolean {
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
    // unknown rather than fine — the summary says so and exits non-zero.
    d.record("ssh", "fail");
    return false;
  }
  d.check("ssh", true);

  const mosh = moshState();
  if (mosh.state === "skip") d.skip("mosh", mosh.note);
  else d.check("mosh", mosh.state === "ok", mosh.note);

  const probes = probeTools();
  for (const tool of TOOLS) {
    const verdict = toolVerdict(tool, probes.get(tool.name));
    d.check(tool.name, verdict.ok, verdict.why);
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
  d.check("tmux keys", keys.ok, keys.why);

  const smoke = runBrowserSmoke("remote-smoke-browser.mjs");
  d.check("browser", smoke.ok, smoke.detail);

  // Separate check, separate name: this one drives the two registered MCP
  // servers rather than playwright-core, and the two fail independently. A box
  // where ad-hoc Playwright works and the MCPs do not is exactly the state that
  // went unnoticed from 2026-08-31 to 2026-09-08.
  const mcpSmoke = runBrowserSmoke("remote-smoke-mcp-browser.mjs", 300_000);
  d.check("browser mcp", mcpSmoke.ok, mcpSmoke.detail);

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
  d.check(
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
  return true;
}

/**
 * Everything about ONE REPO: the checkout on the box, whether the box could
 * ever fetch it again, what its `.mcp.json` asks for, and what setting it up
 * would run.
 *
 * It needs an identity and says so rather than guessing. `doctor` is run from
 * anywhere — a cron line, a terminal in the home directory — and a repo check
 * that quietly fell back to some other checkout would report on a tree nobody
 * asked about.
 *
 * Two of these are laptop-side and box-side halves of the same question, and
 * they are kept apart deliberately: the SETUP PLAN is read from this laptop's
 * checkout, so it is reported even for a repo the box has never seen, while
 * HEAD, origin and mcp are facts about the box and are skipped by name when
 * there is no single checkout to look at.
 */
function doctorRepo(opts: { repo?: string | undefined; dir?: string | undefined }, d: Scoreboard): void {
  console.log(bold("\nthis repo"));
  const id = identify(opts.repo);
  if (!id.ok) {
    // With `--dir` there is nothing to verify the path AGAINST, and a repo
    // check on an unverified path is a check on some other repo's tree. The
    // contract's `push-env`/`setup`/repo-doctor row: those three need an
    // identity, and a path they are given must have the same origin.
    if (opts.dir !== undefined) die(id.why);
    for (const name of REPO_CHECKS) d.skip(name, id.why.split("\n")[0] ?? "no repo identified");
    return;
  }
  if (opts.dir === undefined) {
    console.log(dim(`repo: ${id.id.slug}  (${id.id.localToplevel ?? "not checked out on this laptop"})`));
  }

  // The laptop's half, and it does not need the box at all.
  doctorSetupPlan(id.id, d);

  // A path somebody typed goes through the same resolver every other per-repo
  // command uses, with `requireIdentity` on — so it is proved to be a
  // non-symlink checkout of THIS repo with a resolvable HEAD before a single
  // check is run against it. Stage 1 claimed a verified `doctor --dir` and did
  // not have one (GPT Sol's Stage 1 review, blocker 4).
  if (opts.dir !== undefined) {
    const t = resolveTarget({ repo: opts.repo, dir: opts.dir, requireIdentity: true });
    d.check("HEAD", true, `${t.dir}  (verified as ${id.id.slug}'s checkout)`);
    d.check("origin", t.originTransport === "https", originNote(t.originTransport));
    const mcpAt = mcpOutcome(t.dir);
    if (mcpAt.kind === "skip") d.skip("mcp", mcpAt.why);
    else d.check("mcp", mcpAt.ok, mcpAt.why);
    doctorSetupStatus(id.id, t.dir, d);
    return;
  }

  const r = remoteCheckout(id.id);
  // A `.git` at the right origin with no HEAD is an interrupted clone, and it
  // gets its own arm rather than the generic refusal: it is the one blocked
  // state that is a failure of THIS repo's checkout rather than an absence.
  if (r.kind === "blocked" && r.reason === "incomplete-checkout") {
    d.check("HEAD", false, `${r.dir} has ${id.id.slug}'s origin and no commit — an interrupted clone`);
    for (const name of ["origin", "mcp", "setup status"]) d.skip(name, `there is nothing usable at ${r.dir}`);
    return;
  }
  if (r.kind !== "found") {
    const why = describeResolution(id.id.slug, r).split("\n")[0] ?? r.kind;
    for (const name of ["HEAD", "origin", "mcp", "setup status"]) d.skip(name, why);
    return;
  }

  d.check("HEAD", true, r.dir);
  d.check("origin", r.originTransport === "https", originNote(r.originTransport));

  const mcp = mcpOutcome(r.dir);
  if (mcp.kind === "skip") d.skip("mcp", mcp.why);
  else d.check("mcp", mcp.ok, mcp.why);

  doctorSetupStatus(id.id, r.dir, d);
}

/** An ssh origin ON THE BOX is a checkout that can never fetch or push again:
 *  the box has no GitHub ssh key and gets one per-owner HTTPS token instead. It
 *  resolves perfectly well, which is why it needs a check of its own. */
function originNote(transport: OriginTransport | null): string {
  if (transport === "https") return "https, so the box can fetch it";
  if (transport === "ssh") {
    return "an ssh URL, and the box has no GitHub ssh key — it can never fetch or push from this checkout";
  }
  return "the box did not give an origin for this checkout";
}

/**
 * What setting this repo up on the box would run, read from the LAPTOP's own
 * checkout — so it is reported even for a repo the box has never seen.
 *
 * "No setup command known" is a FAIL, not a skip: it means `gjd-remote setup`
 * has nothing to run for this repo, and reporting that as a clean skip is
 * exactly the silent success the config module exists against.
 */
function doctorSetupPlan(id: Identity, d: Scoreboard): void {
  if (id.localToplevel === null) {
    d.skip("setup", `${id.slug} is not checked out on this laptop, so its config cannot be read`);
    return;
  }
  let cfg: RepoConfig;
  try {
    cfg = readRepoConfig(id.localToplevel);
  } catch (err) {
    d.check("setup", false, err instanceof ConfigError ? (err.message.split("\n")[0] ?? err.message) : String(err));
    return;
  }
  d.check(
    "setup",
    cfg.setup.source !== "none",
    cfg.setup.source === "none"
      ? `no setup command known — add ${CONFIG_FILE}, an executable ${SETUP_SCRIPT}, or an npm 'setup' script`
      : `${cfg.setup.command}  (${cfg.setup.source})`,
  );
  for (const w of cfg.warnings) console.log(yellow(`  ${w}`));
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
 *
 * TWO HALVES. `doctorBox` is about the shared box and needs no repo;
 * `doctorRepo` is about one repo and needs an identity. The repo half runs when
 * there is a repo to run it for, and when there is not, one line says why and
 * its checks are not counted — rather than being counted as skips, which would
 * make "0 skipped" impossible to reach from an ordinary directory.
 */
function cmdDoctor(opts: { repo?: string | undefined; dir?: string | undefined; boxOnly: boolean }): void {
  const ip = host();
  // With the source, because the address is the first thing to doubt when a
  // command talks to the wrong machine — and this heading is reachable with
  // --box-only, from $HOME or a broken checkout, where `resolve` is not.
  console.log(bold(`gjd-remote → ${ip}`) + dim(` (${describeSource(hostSource())})`));

  // Why the repo half is not running, or null. `--repo` and `--dir` both say
  // which repo to check explicitly, so either makes it run; otherwise the cwd
  // has to be one.
  let noRepo: string | null = null;
  if (opts.boxOnly) noRepo = "--box-only";
  else if (opts.repo === undefined && opts.dir === undefined) {
    const here = identify(undefined);
    if (!here.ok) noRepo = here.why.split("\n")[0] ?? "not inside a git repository";
  }

  // Every name here must be recorded exactly once before the run ends. The
  // count is derived from these lists rather than written down, so adding a
  // check cannot leave the two out of step.
  const EXPECTED = noRepo === null ? [...BOX_CHECKS, ...REPO_CHECKS] : [...BOX_CHECKS];
  const seen = new Map<string, CheckState>();
  const d: Scoreboard = {
    record: (name, state) => {
      if (seen.has(name)) die(`doctor recorded '${name}' twice — that is a bug in doctor, not in the box`);
      seen.set(name, state);
    },
    /** Everything that can fail ends up here, so nothing is reported by print
     *  alone. A red cross that does not reach the exit code is decoration. */
    check: (name, ok, note = "") => {
      d.record(name, ok ? "ok" : "fail");
      console.log((ok ? green(`✓ ${name}`) : red(`✗ ${name}`)) + (note ? dim(`  ${note}`) : ""));
    },
    skip: (name, why) => {
      d.record(name, "skip");
      console.log(dim(`· ${name}  not checked: ${why}`));
    },
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
    if (noRepo !== null) {
      console.log(dim(`  repo checks not run (${noRepo.replace(/\.$/, "")}): ${REPO_CHECKS.join(", ")}`));
    }
    if (!missing.length && !failed.length) {
      console.log(green(`✓ ${seen.size - skipped.length} of ${EXPECTED.length} checks passed`));
    }
    process.exit(missing.length || failed.length ? 1 : 0);
  };

  // The box first: without ssh, nothing about any repo is knowable either.
  if (!doctorBox(d)) finish();
  if (noRepo === null) doctorRepo({ repo: opts.repo, dir: opts.dir }, d);
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
  // The bootstrap artefacts are the second witness: cloud-init reports the
  // first boot for ever, and this box's first boot went wrong before
  // provision.sh was split out of it. See cloudInitGate.
  const bootstrap = ssh(bootstrapProbeScript(), { check: false });
  const verdict = cloudInitGate(`${r.stdout ?? ""}`, bootstrap);
  if (verdict.ok) {
    console.log(green(`✓ ${verdict.why}`));
    return;
  }
  die(`${verdict.why} — provisioning on top of that would fail obscurely.\n  look:  gjd-remote ssh 'cloud-init status --long'`);
}

/**
 * Run one of the committed browser smoke tests on the box.
 *
 * Copied on every run rather than trusted to be there. A stale copy is a check
 * that passes for a version of the script nobody has, and it would go on
 * passing after the real one broke.
 *
 * Two scripts share this because they prove different things and one cannot
 * stand in for the other. `remote-smoke-browser.mjs` imports playwright-core and
 * launches Chrome itself, so it says AD-HOC Playwright works.
 * `remote-smoke-mcp-browser.mjs` speaks MCP over stdio to the two registered
 * servers, which is what an agent on the box actually reaches for, and which
 * nothing checked until 2026-09-08 -- `claude mcp list` reports the handshake,
 * not a browser.
 */
function runBrowserSmoke(script: string, timeoutMs = 120_000): { ok: boolean; detail: string } {
  const local = path.join(REPO, "scripts", script);
  if (!existsSync(local)) return { ok: false, detail: `missing locally: ${local}` };
  const remote = `${REMOTE_WORK}/${script}`;
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
  // shape; the cap is for a browser that has hung rather than failed. The MCP
  // script asks for longer: it starts six servers under `npx` and each brings
  // its own Chrome.
  const r = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), `node ${shq(remote)}`], { encoding: "utf8", timeout: timeoutMs });
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


// -------------------------------------------------------------- upload

/**
 * Copy one file from this machine into `uploads/` under the repo's checkout on
 * the box.
 *
 * The point is that you do not have to know the box path. `gjd-remote upload
 * shot.png` from anywhere inside a repo puts it where the agent working in that
 * repo on the box will find it, resolved the same way every other per-repo
 * command resolves it — by origin, asking the box which directory carries it.
 *
 * The two decisions that belong to this command rather than to the writer:
 *
 *  IDENTITY REQUIRED  "the repo you are in" IS the address, so a command that
 *                     cannot say which repo has nowhere to put the file. Like
 *                     `push-env`, a `--dir` must be verified as this repo's
 *                     checkout — a file meant for one repo's agent landing in
 *                     another repo's tree is the failure to design out, and an
 *                     upload is as likely to be a credential dump as
 *                     `.env.local` is.
 *  NEVER CLOBBERS     an existing file at the destination is a refusal naming
 *                     `--force`, not a silent overwrite. Two uploads a week
 *                     apart called `screenshot.png` are the ordinary case, and
 *                     the second one quietly winning is how the first goes
 *                     missing without anybody being told.
 *
 * How the bytes get there, and why there is no second hash round trip, is
 * `remoteWriteScript` in scripts/gjd-remote-upload.ts.
 */
type UploadOptions = {
  repo?: string | undefined;
  dir?: string | undefined;
  force: boolean;
};

function cmdUpload(file: string | undefined, opts: UploadOptions): void {
  if (file === undefined) die(`gjd-remote upload <file>  — a path to a file on this machine`);

  // The local file is checked BEFORE the box is asked anything: a mistyped path
  // should cost a sentence, not a round trip. `statSync` follows a symlink,
  // which is the right answer here — the thing being uploaded is the bytes at
  // the end of it, not the link — but it is said out loud below, because which
  // file you actually sent is not a thing to find out later.
  const local = path.resolve(file);
  const st = statSync(local, { throwIfNoEntry: false });
  if (!st) die(`no such file: ${local}`);
  if (st.isDirectory()) die(`${local} is a directory, and this sends one file. Make an archive of it first.`);
  if (!st.isFile()) die(`${local} is not a regular file.`);

  const target = resolveTarget({ repo: opts.repo, dir: opts.dir, requireIdentity: true });
  const d = uploadDestination(target.dir, local);
  if (!d.ok) die(d.why);

  const real = realpathSync(local);
  if (real !== local) console.log(dim(`file: ${local} → ${real}`));

  // Read before asking about the destination, so a file that cannot be read is
  // a refusal with nothing created on the box.
  let bytes: Buffer;
  try {
    bytes = readFileSync(local);
  } catch (err) {
    die(`could not read ${local}: ${(err as Error).message}`);
  }

  // `uploads/` itself is made by writeRemote's own `mkdir -p`. The checkout
  // above it is never created here: resolveTarget proved it exists, either by
  // asking the box which directory carries this origin or by verifying the
  // --dir, so a missing one is already a refusal by this point.
  //
  // "Is it already there?" is not asked as a question of its own. Two round
  // trips leave a gap that this box in particular will land in — a dozen agents
  // work on it at once — and `ln` closes it in the kernel: it refuses if ANY
  // name is at the destination, a dangling symlink included, so the answer and
  // the write cannot disagree. GPT Sol's finding 3.
  const wrote = writeRemote(bytes, d.dest, { clobber: opts.force });
  if (wrote === "exists") {
    // Not "nothing was sent": the whole file HAS been sent and staged by the
    // time `ln` discovers the name is taken, and saying otherwise would be
    // wrong about the only thing that matters here — what is on the box now.
    die(
      `${d.dest} already exists on the box, and was left exactly as it was.\n` +
        `  --force to replace it, or rename the file here first.`,
    );
  }
  console.log(green(`✓ uploaded ${d.name} — ${bytes.byteLength.toLocaleString()} bytes`));
  console.log(dim(`  ${d.dest}`));
}

// ---------------------------------------------------------------- main

const HELP = `${bold("gjd-remote")} — Claude Code sessions on a server that never sleeps

${bold("SESSIONS")}
  ls, (no args)           list sessions, each with its repo and Claude's own title
  new-claude [name]       start Claude Code and attach
      -p, --prompt TEXT     give it a first prompt (${dim("-p -")} reads it from stdin)
      -d, --dir DIR         a directory on the box, skipping the repo question
          --repo OWNER/NAME which repo, when you are not standing in it
          --wait DURATION   create it now, start Claude later ${dim("— 45s, 15m, 2h, 1d")}
                            attaches too; the pane becomes Claude when it is over
          --no-attach       create it, but stay here ${dim("— what a long --wait wants")}
  new-shell [name]        a persistent shell, no Claude Code
      -d, --dir DIR         a directory on the box
          --repo OWNER/NAME which repo, when you are not standing in it
  resume [name]           reattach; with no name, the most recent session
  resume-all              one new iTerm tab per session, each attached to its own
      --include-attached    take over sessions something else is already in
  kill <name>             end a session ${dim("— any name ls shows, made by this tool or not")}
  claim-overseer <name>   mark that session as ${bold("the Overseer")}, of which the box has
                          exactly one ${dim("(docs/project/overseer.md)")}
                          Refuses, naming the holder, if another live session
                          already holds it. ${bold("There is no --force")} — release it
                          there, or kill that session. The claim is a variable in
                          the session's tmux environment, so it dies with the
                          session and with the tmux server: after a reboot NO
                          session is the Overseer, which ${dim("ls")} says out loud.
  release-overseer <name> let go of the claim, leaving the session running
  log                     every session launched from here, and whether it ran
      --lost                only the ones that never started ${dim("— the reboot case")}
      --limit N             how many rows ${dim("(default 40)")}
      --path                print where the log file is and stop

${bold("THE BOX")}
  resolve                 which repo is this, and where is it on the box?
                          one round trip, nothing created — run it when a command
                          refuses and you want to see what it saw
      -d, --dir DIR         check that this box path is that repo's checkout
          --repo OWNER/NAME ask about a repo you are not standing in
  doctor                  check everything, and say what is wrong
                          exits non-zero if any check failed
                          two halves: the BOX (ssh, tools, tmux, browser,
                          provisioning) and THIS REPO (its checkout on the box,
                          whether the box can still fetch it, its .mcp.json, and
                          what setting it up would run). The repo half needs to
                          know which repo, so it is skipped — by name, never
                          silently — outside a repo and without --repo.
          --repo OWNER/NAME which repo to check, when you are not standing in it
      -d, --dir DIR         check this box path, which must be verified as this
                            repo's checkout — same origin, not a symlink, real HEAD
          --box-only        the box half only, for a check that belongs to no repo
  provision               build a bootstrapped box: copy provision.sh up, run it
                          cloud-init no longer does this — user_data is capped at
                          32 KiB and the script is 67 KiB base64'd
                          safe to re-run; that is how you move a pinned version
      --wait-seconds N      how long to wait for ssh and cloud-init ${dim("(default 300)")}
      --run-minutes N       cap on the run itself ${dim("(default 45)")}
  clone [repo]            clone one of Greg's repos onto the box, over HTTPS
                          with no argument, the repo you are standing in
                          It is ONE LOCKED TRANSACTION on the box: it takes a
                          per-destination lock, re-checks the destination under
                          it, reserves a staging name beside it, clones, verifies
                          the origin and HEAD, and only then renames — proving
                          afterwards that what landed IS the tree it verified. So
                          an interrupted clone leaves NOTHING at the destination
                          rather than a half-made checkout, two clones racing
                          cannot both win, and the failure path can only remove a
                          directory it made itself. If it fails after git has
                          started, the staging path is named so you can look.
                          Nothing is run afterwards; the setup command the repo's
                          config would use is printed instead.
      --base-folder DIR     where to put it ${dim(`(default: ${REMOTE_CODE})`)}
      --name DIR-NAME       directory name, if not the repo's own. With the repo
                            already on the box under another name, this is how you
                            ask for a second copy — and it asks you to confirm it
  setup                   run this repo's setup command in its checkout on the box
                          It is a tmux job on the box, not an ssh command, so it
                          survives the laptop sleeping. You are attached to watch;
                          detaching does not stop it.
          --status          just read the verdict and stop — nothing is run
          --repo OWNER/NAME which repo, when you are not standing in it
      -d, --dir DIR         a box path, which must be this repo's checkout
          --force           run it again even though it already succeeded
          --no-attach       start it and stay here
  push-env                send this repo's .env.local to its checkout on the box
                          Spideryarn's keys come off a list in the code; every
                          other repo gets a checklist you tick once and this
                          remembers. See below.
      --file PATH           a different .env.local — the basename must be exactly that
      --dir DIR             a box path, which must be this repo's checkout
          --propose         ask the model again, even when you have decided them all
          --all             skip the checklist: every key that is not hard-guarded
          --none            skip it the other way: no keys at all. Only useful with
                            --save, which then records "no" for every eligible key
          --save            with --none, write those answers down, so the next run
                            asks no model. An ordinary push saves what it sent, and
                            what you left unticked, without being asked
          --yes             skip the final confirmation. --all on its own still asks
  upload <file>           copy a file into ${dim(`${UPLOADS_DIR}/`)} under this repo's checkout on the box
                          so you never have to know the box path: run it from
                          anywhere in the repo and the agent working on that repo
                          finds it in the same place. Refuses rather than
                          replacing a file already there.
      -d, --dir DIR         a box path, which must be this repo's checkout
          --repo OWNER/NAME which repo, when you are not standing in it
          --force           replace a file of that name that is already there
  ssh [command]           a throwaway connection — no tmux, dies with the terminal
                          with a command, runs it and prints what it said
                          ${dim("gjd-remote ssh 'free -g; uptime'")}
  tunnel                  forward noVNC to http://localhost:6080/vnc.html
  forget-key              after a rebuild: accept the machine's new host key

${bold("WHAT push-env WILL AND WILL NOT SEND")}
  Whichever repo you are in, it ${bold("BUILDS")} the file on the box from a list of key
  names — it never copies yours across. Anything not on that list is skipped and
  named in the output. It reports which KEYS changed, never a value and never a
  hash of one, and the file it writes is read back and compared before it says so.
  ${bold("Where the list comes from depends on the repo, and there are two answers.")}
  ${bold("Spideryarn:")} a reviewed allowlist in ${dim("scripts/gjd-remote-env.ts")}, with the reason for
  each name beside it. No prompt, no model, no remembered state — the list is the
  decision, and a key nobody has added to it stays on the laptop.
  ${bold("Every other repo:")} a checklist. The key NAMES are read out of that repo's
  .env.local — ${bold("a value is never sent to the model and never written to the")}
  ${bold("ledger")}, and never printed; the keys you tick are of course sent to the box —
  and the capable model is asked to sort the names into local-only, provider key,
  production secret, infrastructure-destroying, or unknown. It costs about two
  cents and was chosen over a model eighteen times cheaper, which left a quarter
  of each file unclassified and twice failed to name a token that can delete this
  box. Its answer is the ${bold("starting state")} for a key you have not answered for
  before, with its reason on each row. ${bold("Both your answers are remembered")}, in
  ${dim("~/.config/gjd-remote/repos/<owner>--<name>.toml")}: a key you ticked starts
  ticked, a key you ${bold("unticked stays unticked")} however a later model classifies it,
  and no model is asked about a key you have already decided — so a second run
  usually costs nothing and says so. ${dim("--propose")} asks anyway. ${dim("--all")} and ${dim("--none")}
  skip the checklist, and ${dim("--none --save")} is how you record "none of these" as a
  real answer. There is still a final "send these N keys?" unless you pass ${dim("--yes")}.
  Off a terminal, with none of those flags, it refuses rather than guessing.
  ${bold("That model call is Spideryarn's money, wherever you ran it from")}: the key, and the
  ledger the spend is written to, come from THIS repo's own configuration — the
  tool's location, never the cwd — so a proposal for hellozenno shows up in
  ${dim("npm run cost")} here, under the ${dim("env-proposal")} job.
  ${bold("TWO GUARDS YOU CANNOT TICK PAST")}, on either path. ${dim("HETZNER_CLOUD_API_TOKEN")} (can
  delete this box) and ${dim("SUPABASE_ACCESS_TOKEN")} (can delete the production Supabase
  project) are shown greyed out and can never be selected. And any value that is a
  database URL not pointing at 127.0.0.1 is refused ${bold("whatever it is called")} — by
  its value, so a production database under a name nothing here has heard of is
  caught too. Both are re-applied after you choose, not merely drawn that way.

${bold("SETTING A REPO UP")}
  ${dim("gjd-remote setup")} runs one command — the repo's own — inside its checkout ON THE
  BOX. What that command is comes from ${dim(CONFIG_FILE)}, or an executable
  ${dim(SETUP_SCRIPT)}, or ${dim("npm ci && npm run setup")} if the package.json has a setup
  script. A repo with none of those is refused: "nothing to run" is not "set up".
  ${bold("The config that runs is the box's copy, not yours")}. They differ whenever a change
  is uncommitted, unpushed, or unpulled — so both are read and a disagreement
  refuses, naming each, rather than running the one you cannot see.
  It runs as a tmux job under a per-repo ${dim("flock")}, because ${dim("npm ci")} plus Docker pulls
  outlive an ssh from a laptop that goes to sleep. You are attached so you can
  watch; detaching leaves it running, and ${dim("gjd-remote setup --status")} says how it went.
  ${bold("Readiness is the status file, never the checkout's presence")} — a failed setup
  leaves a perfectly ordinary-looking directory behind. The file records which
  attempt wrote it and a hash of ${bold("everything that would run")} — the commands, the
  ${dim(SETUP_SCRIPT)} contents, the package.json setup script — so a run whose stream
  was cut cannot read as this run's success, and a repo whose setup changed since,
  ${bold("in the file behind the command as much as in the command")}, is
  ${dim("config-changed")} rather than ready. It lives at
  ${dim(`${REMOTE_WORK}/setup/<owner>--<name>.json`)}, and ${dim("doctor")} reads it too.

${bold("HOW clone AUTHENTICATES")}
  Always HTTPS, never ssh: the box has no GitHub ssh key. It has a fine-grained
  PAT per repository OWNER in ${dim(`${TOKEN_DIR}/<owner>.token`)}, picked by a git
  credential helper that reads the owner out of the URL — which it can only do
  when the URL is https. An owner with no token file is refused here, by name,
  before git runs; git's own error for it says only "could not read Username".
  Issuing the tokens is a ceremony in ${dim("infra/hetzner/README.md")}.

${bold("WHERE A SESSION STARTS")}
  Three lines, and they apply to ${dim("new-claude")}, ${dim("new-shell")}, ${dim("push-env")}, ${dim("clone")} and ${dim("doctor")} alike:
    1. the repo is the ${bold("git origin")} of wherever you are standing — never a folder
       name, so ${dim("reading2")} on the laptop and ${dim("spideryarn2")} on the box are one repo.
    2. the box is asked what is under ${dim(REMOTE_CODE)}, and the ONE directory with
       that origin is the answer. None, two, or something else in the way: it says
       so and does nothing. ${dim("--repo owner/name")} when you are not in the repo.
    3. ${dim("--dir")} wins over both, and is an arbitrary path on the box — ${dim("-d ~")} is the
       home directory and no repo at all.
  Whichever it is, the repo and the directory are printed before anything happens.
  The directory must already exist on the box; there is no fallback, because the
  fallback was a healthy-looking session in ${dim("/home/greg")} editing the wrong thing.
  ${bold("A repo the box has never had is offered a clone and a setup")}, by ${dim("new-claude")} and
  ${dim("new-shell")} only. One question, defaulting to No, naming the directory and the
  exact command — off a terminal it refuses and tells you to run ${dim("gjd-remote clone")}
  and ${dim("gjd-remote setup")} yourself. The command in the question is your laptop's copy,
  because that is the one you can see; ${bold("after the clone it is re-read from the cloned")}
  ${bold("commit")}, and if that resolves to something else you are asked again. A repo whose
  cloned commit has no setup command at all is left cloned and unset-up, with no
  session. ${bold("The session is created only for a `success` status file")} from the attempt
  you just watched — so ${dim("--no-attach")} starts the setup and stops, because nobody read
  a verdict. ${dim("gjd-remote clone")} is still the clone on its own, and runs nothing.
  For a checkout that IS there, the setup status is printed when it is not
  ${dim("success")} — a yellow line, and the session starts anyway, because ${dim("~/code/spideryarn2")}
  was set up by hand years before this existed. The refusals are a status file
  nobody can read, a box with no ${dim("flock")}, a status about some other tree, and a
  setup that is running right now, holding the lock.
  ${bold("The session itself is created on the box under that setup lock")}, against the
  same status file the decision was made on: so it cannot start in a tree a
  setup took over while the question was on screen. A ${dim("--dir")} is the exception,
  as it is everywhere — an arbitrary path is not a repo and has no status.

${bold("STARTING LATER")}
  ${dim("--wait 2h")} makes the session NOW and starts Claude in two hours. The units are
  ${dim("s m h d")}, and one is required — ${dim("--wait 2")} is refused rather than guessed at,
  because seconds and hours are both fair readings and they are 3600x apart.
  Use it to spread work out when several sessions at once would be too much
  RAM, or too much of the usage allowance, in one go.
  The waiting happens ON THE BOX, in the session's own pane, so closing the
  laptop makes no difference to it, and ${dim("gjd-remote kill")} calls it off.
  ${bold("It attaches, like any other launch")}, and the pane you land in says how long it
  has left. It is the SAME pane Claude appears in when the sleep ends, so you can
  sit through the wait and start talking; close the tab and it keeps running on
  the box — the box's tmux has no prefix key, so closing IS how you detach.
  ${bold("For a long wait, say --no-attach")} — not because the connection cannot take it
  (mosh rides through a closed lid; see WHAT SURVIVES WHAT below) but because
  that tab is now yours for fifteen hours. ${dim("--no-attach")} gives you the shell back,
  and it is how you queue several waited jobs from one of them. Whatever happens
  to the attach, the job on the box is untouched — ${dim("gjd-remote resume")} returns.
  Off a terminal altogether — a cron job, another agent — it says there is
  nothing to attach to and exits 0, because the session is waiting regardless.
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
  gjd-remote ls
      ${dim("NAME             REPO                  AGE   ATT  STATE        TITLE")}
      ${dim("fix-the-toc      spideryarn/reading2   17m   yes  ? needs you  Fix the ToC ordering")}
      ${dim("scratch-shell    (unknown)             3h     no  - shell      (no title yet)")}
      REPO is what the launcher pinned into the session, not a guess from its
      directory — one repo is ${dim("reading2")} here and ${dim("spideryarn2")} on the box. It is
      dimmed and reads ${dim("(unknown)")} for a session started with ${dim("--dir")}, which is an
      arbitrary path and no repo at all, and for one started before this existed.
  gjd-remote new-claude -p "fix the ToC ordering bug"
      ${dim(`repo: spideryarn/reading2  (/Users/greg/dev/spideryarn/reading2)`)}
      ${dim(`box:  ${REMOTE_CODE}/spideryarn2`)}
      ${dim(`gjd-remote new-claude s-260831-171205 → greg@1.2.3.4:${REMOTE_CODE}/spideryarn2`)}
      ${dim("✓ started 's-260831-171205' with a prompt")}
      in the checkout of the repo you ran it from, found by origin rather than by
      name, and named after whatever Claude decides the work is
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
      told it is already on the box under another name, rather than given a second
      copy; with --name you are asked whether you really want the second copy, and
      off a terminal that question cannot be asked, so it refuses
  gjd-remote upload ~/Desktop/failing-page.png
      ${dim("repo: spideryarn/reading2  (/Users/greg/dev/spideryarn/reading2)")}
      ${dim(`box:  ${REMOTE_CODE}/spideryarn2`)}
      ${dim("✓ uploaded failing-page.png — 184,220 bytes")}
      ${dim(`  ${REMOTE_CODE}/spideryarn2/${UPLOADS_DIR}/failing-page.png`)}
  gjd-remote push-env
      ${dim(`gjd-remote push-env → greg@1.2.3.4:${REMOTE_CODE}/spideryarn2/.env.local`)}
      ${dim("  + OPENROUTER_API_KEY  added")}
      ${dim("  ~ DATABASE_URL  changed")}
      ${dim("  = 10 unchanged")}
      ${dim("  skipped 2 keys not on the allowlist: HETZNER_CLOUD_API_TOKEN, SUPABASE_ACCESS_TOKEN")}
      ${dim("✓ 12 keys, 0600 greg, read back and verified")}

${bold("ENVIRONMENT")}
  GJD_REMOTE_HOST         override the address. Three sources, in this order: this
                          variable, then ${dim(BOX_HOST_FILE)} if the machine
                          has one (which is how the box drives itself — see
                          ${dim("gjd-remote doctor")}, which prints the one that answered),
                          then Terraform state, so a laptop is never stale after a
                          rebuild
  GJD_REMOTE_TRANSPORT    ssh | mosh | auto (default: auto, which probes mosh once)
  GJD_REMOTE_REPO         ${dim("deprecated")} — an alias for --dir, and --dir wins over it.
                          It prints a line whenever it is set, and it REFUSES if the
                          directory it names is not the repo you are standing in:
                          an env var must not quietly steer one repo's work, or one
                          repo's credentials, into another repo's checkout.
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

async function main(): Promise<void> {
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
  //
  // `setup` is exempt for a different reason, and it is not politeness: a
  // `setup` line is a DIFFERENT SHAPE in scripts/gjd-remote-log.ts — it must
  // carry a repo, an attempt and an outcome, because a setup record nobody can
  // join to the box's status file says nothing. A bare `{cmd:"setup"}` is
  // refused by formatLine, which is the module doing its job; the real record
  // is written by cmdSetup, twice, once it knows those three things.
  const generic = cmd !== "log" && cmd !== "setup" && cmd !== "-h" && cmd !== "--help" && cmd !== "help";
  if (generic) appendLog({ cmd: cmd ?? "ls" });

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
          repo: { type: "string" },
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
        repo: values.repo,
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
      const name = positionalName(rest) ?? newest?.name;
      if (!name) die("no sessions to attach to");
      // NOT `SLUG`. `ls` lists every tmux session on the box, including ones an
      // agent made by hand, and those names need only satisfy tmux — see
      // `resolveSession`, which is the whole reasoning. Existence is the guard:
      // without it a typo'd name lands you in a login shell that looks exactly
      // like a successful attach until you wonder where your work went.
      const found = resolveSession(live, name);
      if (!found.ok) die(found.why);
      return attach(found.session, rest.includes("--ssh") ? "ssh" : undefined);
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
      const name = positionalName(rest);
      // TWO REFUSALS, NOT ONE, and telling them apart is the point. This used
      // to be a single `!name || !SLUG.test(name)` printing the usage string,
      // so `gjd-remote kill gateA` — a session sitting right there in `ls` —
      // answered as though the argument had been left out, and left the session
      // running. Sol's wording: missing syntax is a usage error, an absent
      // session is a fact about the box.
      if (!name) die("usage: gjd-remote kill <name>");
      // NOT `SLUG`: see `resolveSession`. A name that `ls` prints is a name
      // `kill` must accept, and `ls` prints every tmux session on the box.
      const found = resolveSession(sessions(), name);
      if (!found.ok) die(`${found.why}\n  nothing was killed.`);
      const target = found.session;
      // Read the uuid BEFORE killing it, because a second later there is
      // nothing to ask. `gjd-remote log` matches kills by uuid rather than by
      // name: `ls` renames a provisional session to Claude's own title, so the
      // name here is often not the name the launch was recorded under, and
      // matching on it would report every killed session as lost. Found by GPT
      // Sol. `check: false` — a session with no uuid is a `new-shell`, which is
      // a fine thing to kill and has nothing to record.
      //
      // Both commands address `target.id`, not the name: between the list being
      // read and the kill being sent, the session can end and another take its
      // name, and a kill that lands on the wrong session is not an error you
      // get to take back. If the id has gone, `kill-session` fails — which is
      // the outcome we want, never a fallback to the name.
      const killedId = ssh(
        `tmux show-environment -t ${shq(`${target.id}:`)} CLAUDE_SESSION_ID 2>/dev/null | cut -d= -f2-`,
        { check: false },
      ).trim();
      ssh(`tmux kill-session -t ${shq(target.id)}`);
      appendLog({ cmd: "kill", name: target.name, ...(killedId === "" ? {} : { id: killedId }) });
      console.log(green(`✓ killed ${printableName(target.name)}`));
      return;
    }

    case "claim-overseer":
    case "release-overseer":
      return cmdRole(cmd === "claim-overseer" ? "claim" : "release", positionalName(rest));

    case "new-shell": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          dir: { type: "string", short: "d" },
          repo: { type: "string" },
          ssh: { type: "boolean", default: false },
        },
      });
      return cmdNewShell(positionals[0], {
        repo: values.repo,
        dir: values.dir,
        transport: values.ssh ? "ssh" : undefined,
      });
    }

    case "doctor": {
      const { values } = parseArgs({
        args: rest,
        options: {
          repo: { type: "string" },
          dir: { type: "string", short: "d" },
          "box-only": { type: "boolean", default: false },
        },
      });
      return cmdDoctor({ repo: values.repo, dir: values.dir, boxOnly: values["box-only"] });
    }

    // Hidden-ish, and documented in the help as a debugging aid: it answers
    // "which repo does this directory mean, and what does the box say about
    // it?" in one cheap round trip, without creating anything. Everything the
    // per-repo commands do starts here, so when one of them refuses, this is
    // how you see what it saw.
    case "resolve": {
      const { values } = parseArgs({
        args: rest,
        options: { repo: { type: "string" }, dir: { type: "string", short: "d" } },
      });
      return cmdResolve({ repo: values.repo, dir: values.dir });
    }

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

    case "setup": {
      const { values } = parseArgs({
        args: rest,
        options: {
          repo: { type: "string" },
          dir: { type: "string", short: "d" },
          status: { type: "boolean", default: false },
          force: { type: "boolean", default: false },
          "no-attach": { type: "boolean", default: false },
          ssh: { type: "boolean", default: false },
        },
      });
      // `--status` looks and stops, so the two flags about running it are a
      // contradiction rather than a preference. Refused, because silently
      // ignoring one of them is how somebody thinks they forced a re-run.
      if (values.status && (values.force || values["no-attach"])) {
        die("--status only looks at the status file; it cannot be combined with --force or --no-attach.");
      }
      return cmdSetup({
        repo: values.repo,
        dir: values.dir,
        status: values.status,
        force: values.force,
        attach: !values["no-attach"],
        transport: values.ssh ? "ssh" : undefined,
      });
    }

    case "push-env": {
      const { values } = parseArgs({
        args: rest,
        options: {
          file: { type: "string" },
          repo: { type: "string" },
          dir: { type: "string", short: "d" },
          propose: { type: "boolean", default: false },
          all: { type: "boolean", default: false },
          none: { type: "boolean", default: false },
          save: { type: "boolean", default: false },
          yes: { type: "boolean", default: false },
        },
      });
      // A contradiction rather than a preference, like `setup --status --force`:
      // silently letting one win is how somebody thinks they sent everything.
      if (values.all && values.none) die("--all and --none are opposites; pick one.");
      return cmdPushEnv({
        file: values.file,
        repo: values.repo,
        dir: values.dir,
        propose: values.propose,
        all: values.all,
        none: values.none,
        save: values.save,
        yes: values.yes,
      });
    }

    case "upload": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          repo: { type: "string" },
          dir: { type: "string", short: "d" },
          force: { type: "boolean", default: false },
        },
      });
      // One file, said rather than assumed. `gjd-remote upload a b` used to
      // send `a` and drop `b` on the floor, which is the silent success this
      // repo keeps being bitten by wearing a green tick.
      if (positionals.length > 1) {
        die(`gjd-remote upload takes one file; you gave ${positionals.length}. Nothing was sent.`);
      }
      return cmdUpload(positionals[0], {
        repo: values.repo,
        dir: values.dir,
        force: values.force,
      });
    }

    case "clone": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          "base-folder": { type: "string" },
          name: { type: "string" },
          repo: { type: "string" },
        },
      });
      return cmdClone(positionals[0], {
        baseFolder: values["base-folder"],
        name: values.name,
        repo: values.repo,
      });
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
      const known = ["ls", "log", "new-claude", "new-shell", "resume", "kill", "doctor", "provision", "clone", "setup", "push-env", "upload", "resolve", "ssh", "tunnel", "forget-key"];
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

/**
 * THE ONE PLACE A REFUSED OR CANCELLED QUESTION LANDS.
 *
 * `main` is async because the prompts are, and everything it dispatches to
 * either returns or throws. The two prompt outcomes that are not errors in the
 * ordinary sense are turned into an exit here, once, rather than in every
 * command that asks something:
 *
 *  - `Cancelled` — Ctrl-C at a question. 130 is the shell's convention for
 *    "killed by SIGINT", and THE THROWER'S OWN MESSAGE is printed, because
 *    "nothing changed" is only true at the first question. `cloneThenSetUp`
 *    re-throws with the clone it left behind named — GPT Sol's Stage 3 finding
 *    4, where a Ctrl-C at the second question said nothing had happened while a
 *    fresh checkout sat on the box.
 *  - `NotInteractive` — there was no terminal to ask on. Its message is already
 *    written in the tool's voice and names what to run instead, so it goes
 *    straight to `die` and exit 1.
 *
 * Anything else is rethrown as it was: an unhandled rejection prints the stack,
 * which is what an unexpected failure should still do.
 */
main().catch((err: unknown) => {
  if (err instanceof Cancelled) {
    console.error(yellow(err.message || CANCELLED_NOTHING_CHANGED));
    process.exit(130);
  }
  if (err instanceof NotInteractive) die(err.message);
  throw err;
});
