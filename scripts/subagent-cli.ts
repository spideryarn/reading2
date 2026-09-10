#!/usr/bin/env -S npx tsx
/**
 * subagent-cli.ts — the machinery both subagent wrappers share.
 *
 * [`run-codex.ts`](run-codex.ts) drives OpenAI's `codex exec`; [`run-claude.ts`](run-claude.ts)
 * drives Anthropic's `claude -p`. The two CLIs disagree about almost everything — flags, sandbox
 * model, how the answer comes back — but the *hard* parts are identical and were all written once,
 * for codex, in August 2026:
 *
 *   - a spawn that closes fd 0, so an inherited pipe can neither wedge the child nor append itself
 *     to the prompt;
 *   - a real watchdog — SIGTERM → grace → SIGKILL, on the whole process group — because
 *     `spawnSync`'s timeout blocks waiting for a child that may be ignoring the signal;
 *   - a capture cap, so a runaway child cannot exhaust our memory;
 *   - a deny-by-default child environment, keyed on the *name* of a variable, because a subagent
 *     runs shell commands on a model's instruction and one `env` in a debugging call is enough to
 *     move a production database URL into a log and then into the caller's context;
 *   - a bounded read of the answer, and a middle-truncating formatter, so what reaches the caller
 *     is the answer rather than everything the subagent looked at.
 *
 * Every one of those is a claim about our process handling rather than about anybody's model, and
 * each is tested in [`tests/run-codex.test.ts`](../tests/run-codex.test.ts) — which is why they are
 * shared rather than copied: a second copy is a second place for the guarantee to quietly stop
 * holding.
 *
 * Nothing here knows which CLI it is running. The wrapper supplies the binary, the argv, and the
 * names of the credentials that may cross.
 */

import { spawn } from 'node:child_process';
import {
  closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const GRACE_MS = 5_000;

/** Above this, the answer file is excerpted with two bounded reads instead of being slurped whole.
 * A subagent's final message is never this big — which is exactly why an unbounded readFileSync here
 * would never fail in testing and only ever fail in the wild. */
const MAX_ANSWER_READ_BYTES = 4 * 1024 * 1024;

/**
 * Environment variables whose *names* say they hold a credential. Matched on the name because the
 * value tells you nothing — a database URL and a session cookie look like ordinary strings.
 *
 * Two rules, because one doesn't fit both kinds of word.
 *
 * `SECRET_WORD` is matched **anywhere in the name**: these words have no innocent use in an
 * environment variable, and requiring an underscore boundary loses `PGPASSWORD`, `MYSQL_PWD` and
 * `CI_JOB_JWT` — all of which are exactly what they look like.
 *
 * `SECRET_SEGMENT` is matched on underscore-delimited **segments**, because these words do have
 * innocent uses: `AUTHOR` is not `AUTH`, `KEYBOARD_LAYOUT` is not `KEY`. `SSH_AUTH_SOCK` does go —
 * it is a path rather than a secret, but it hands over the ssh agent; `--pass-env SSH_AUTH_SOCK`
 * brings it back for a run that has to push.
 *
 * `SESSION` is in neither, deliberately. It reads like a credential and mostly isn't:
 * `XDG_SESSION_TYPE`, `DBUS_SESSION_BUS_ADDRESS`, `DESKTOP_SESSION` and `SESSION_MANAGER` are all
 * ordinary Linux desktop plumbing, and a session variable that *is* a credential is named for what
 * it holds — `SESSION_SECRET`, `SESSION_TOKEN` — and caught by the word rule anyway.
 */
const SECRET_WORD = /SECRET|PASSWORD|PASSWD|CREDENTIAL|APIKEY|JWT|BEARER|_PWD$|KUBECONFIG|NETRC/i;
const SECRET_SEGMENT = /(^|_)(KEY|TOKEN|AUTH|COOKIE|PRIVATE|DSN|SIGNATURE)(_|$)/i;
/** Names and shapes that carry credentials inside an otherwise ordinary-looking value. */
const SECRET_VALUE_SHAPE = /^(DATABASE|REDIS|MONGO|AMQP|POSTGRES|MYSQL|CLICKHOUSE)_URL$|_URI$|_PROXY$/i;

export function isSecretName(name: string): boolean {
  return SECRET_WORD.test(name) || SECRET_SEGMENT.test(name) || SECRET_VALUE_SHAPE.test(name);
}

const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;

/**
 * Are these two paths the same file to *write to*?
 *
 * Both wrappers write an answer and a transcript, and `--output x --activity-log x` wrote one over
 * the other, exited 0, and printed both paths — the evidence gone with nothing saying so.
 *
 * String comparison catches the obvious case and nothing else: a symlink, a hard link, or a
 * symlinked *parent directory* with two names that do not exist yet all reach one inode by two
 * spellings, and the last of those defeated a `statSync` pair because there was nothing to stat.
 * So this asks the filesystem the question the writes will ask — **open both for append**, which
 * creates without truncating and follows every link, and compare `dev:ino`. The empty files it may
 * leave behind are files the caller is about to write anyway.
 *
 * A path that cannot be opened at all is not reported as a collision: the write will fail on its
 * own, with its own error, and inventing a different one here would send the reader somewhere else.
 */
export function sameWriteTarget(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  const identify = (p: string): string | undefined => {
    let fd: number | undefined;
    try {
      mkdirSync(dirname(resolve(p)), { recursive: true });
      fd = openSync(p, 'a');
      const st = fstatSync(fd);
      return `${st.dev}:${st.ino}`;
    } catch {
      return undefined;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };
  const first = identify(a);
  return first !== undefined && first === identify(b);
}

/**
 * How long it really took, for an error that would otherwise report the setting back to you.
 * `timed out after 5m` reads identically whether the kill landed on schedule or ten minutes late —
 * and on 2026-09-06 it was printed by a call that took fifteen minutes, which is the whole of
 * docs/postmortems/260906e-a-timeout-that-bounded-the-child-and-not-the-wrapper.md.
 */
export function elapsedSeconds(startedAt: number, now = Date.now()): string {
  return `${((now - startedAt) / 1000).toFixed(1)}s`;
}

/**
 * What the caller actually sees of the subagent's answer. Truncating in the *middle* rather than the tail
 * keeps a review's verdict, which reviewers put last, as well as its opening. Exported so the cap
 * can be asserted on without spawning anything.
 *
 * Two things here are deliberate, and both were bugs in the first version:
 *
 * `Array.from` splits into **code points**, so a `slice` can never land between the two halves of a
 * surrogate pair and emit a lone half — and the "characters omitted" count then counts characters
 * rather than UTF-16 code units, which is what it says it does. The early return uses `.length`
 * (code units) on purpose: it is an upper bound on the code-point count, so a string that passes it
 * is definitely short enough, and the common case never pays for building the array.
 *
 * The tail is taken with an **explicit index** rather than `slice(-half)`. At `maxChars` of 1 or 2
 * `half` is 0, and `slice(-0)` is `slice(0)` — the entire string, printed under a banner claiming
 * it had been omitted. That is a cap that silently does the opposite of its job at exactly the
 * settings someone reaches for when testing whether the cap works.
 */
export function formatAnswer(answer: string, maxChars: number, path: string): string {
  if (answer.length <= maxChars) return answer;
  const chars = Array.from(answer);
  if (chars.length <= maxChars) return answer;
  const half = Math.floor(maxChars / 2);
  const head = chars.slice(0, half).join('');
  const tail = chars.slice(chars.length - half).join('');
  const omitted = chars.length - half * 2;
  return `${head}\n\n[… ${omitted} characters omitted — full answer at ${path} …]\n\n${tail}`;
}

/**
 * Read as much of the answer as we are willing to hold in memory. The activity log has a 64 MiB
 * capture cap; the `-o` file had none, so a pathological answer could OOM the wrapper *before*
 * formatAnswer ever got the chance to bound it.
 */
export function readAnswerForConsole(path: string, maxChars: number): string {
  const size = statSync(path).size;
  if (size <= MAX_ANSWER_READ_BYTES) return formatAnswer(readFileSync(path, 'utf8'), maxChars, path);

  const half = Math.floor(maxChars / 2);
  // 4 is the most bytes UTF-8 spends on one code point, so a span this wide always contains at
  // least `half` characters. Math.max(1, …) keeps readSync legal when half is 0.
  const span = Math.max(1, half) * 4;
  const fd = openSync(path, 'r');
  try {
    const headBuf = Buffer.alloc(span), tailBuf = Buffer.alloc(span);
    const headLen = readSync(fd, headBuf, 0, span, 0);
    // Clamp the tail's start past the head's end, so a file barely over the threshold doesn't get
    // its middle printed twice.
    const tailLen = readSync(fd, tailBuf, 0, span, Math.max(headLen, size - span));
    // A bounded byte read lands mid-codepoint at the inner edge of each span roughly three times
    // in four, and the decoder turns that fragment into a U+FFFD. It is an artefact of where we
    // cut, not of the file, so drop it — but only at the seam, so a U+FFFD the model actually
    // wrote survives.
    const headText = headBuf.subarray(0, headLen).toString('utf8').replace(/\uFFFD+$/, '');
    const tailText = tailBuf.subarray(0, tailLen).toString('utf8').replace(/^\uFFFD+/, '');
    // Trimmed here rather than by a second formatAnswer pass: that pass was given `maxChars * 2`
    // (because two 4-bytes-per-char spans overshoot the cap on ASCII) and so quietly doubled the
    // cap the caller asked for, which put the 1-and-2 edge case straight back.
    const headChars = Array.from(headText), tailChars = Array.from(tailText);
    const head = headChars.slice(0, half).join('');
    const tail = tailChars.slice(tailChars.length - half).join('');
    // Bytes, not "characters omitted": we never counted the characters in between and saying so
    // would be a number we made up.
    return `${head}\n\n[… answer file is ${size} bytes — full text at ${path} …]\n\n${tail}`;
  } finally {
    closeSync(fd);
  }
}

export interface RunResult {
  status: number | null;
  signal: string | null;
  timedOut: boolean;
  overflowed: boolean;
  stdout: string;
  stderr: string;
  spawnError?: Error;
}

/**
 * Spawn the subagent CLI, capture (or stream) its output, enforce the timeout. Never rejects: every outcome —
 * clean exit, non-zero, timeout-kill, spawn failure, capture overflow — resolves to a RunResult the
 * caller classifies, so callers fail closed rather than on an unhandled throw.
 */
/**
 * **What fd 0 may be. Two shapes, and deliberately not Node's `StdioOptions`.**
 *
 * The invariant this type exists to hold:
 *
 * > fd 0 is never inherited. It is either closed, or attached to a finite,
 * > already-complete regular file that must reach EOF.
 *
 * It was `'ignore'` unconditionally until 2026-09-08, and the comment called that the load-bearing
 * anti-hang guarantee — correctly: a `codex exec` that inherits an open pipe on fd 0 wedges on
 * *"Reading additional input from stdin…"* until something kills it. Measured, rather than
 * inherited folklore: a pipe nobody closes wedged for a full 60 seconds, was SIGKILLed, and wrote
 * no answer file (docs/plans/260908g-…-execve.md).
 *
 * What changed is that argv turned out to have a ceiling of its own — a single argument may not
 * exceed Linux's `MAX_ARG_STRLEN`, 128 KB — so a large prompt could not travel that way at all.
 * A regular file is the way to hand one over **without** giving the guarantee up: reading it
 * returns EOF because the file has an end, not because a writer remembered to close it. There is no
 * writer whose lifetime can accidentally hold the input open, which a pipe has and is exactly the
 * thing the 60-second arm demonstrates.
 *
 * A union rather than `number | 'ignore'`, and never Node's own `StdioOptions`, so that
 * `'inherit'` and `'pipe'` are not spellable here at all. GPT Sol's design review, 2026-09-08.
 */
export type ChildStdin =
  | { kind: 'closed' }
  /** An open fd on a regular file that is complete. The CALLER opens and closes it. */
  | { kind: 'file'; fd: number };

export function runChild(opts: {
  bin: string; argv: string[]; timeoutMs: number; stream: boolean; env: NodeJS.ProcessEnv;
  /** Where the child runs. `codex exec` takes a `--cd` flag; `claude -p` has none, so for that
   *  wrapper the working directory *is* the repo it reviews. */
  cwd?: string;
  /** Required, so a new caller cannot inherit fd 0 by leaving an argument off. See {@link ChildStdin}. */
  stdin: ChildStdin;
  /**
   * Told how the child ended when THIS process is hung up, synchronously, before the SIGHUP is
   * re-raised. A process that dies of a signal never reaches 'exit', so this is a caller's last
   * chance to record the run. See the SIGHUP handler below.
   */
  onHangup?: ((result: RunResult) => void) | undefined;
}): Promise<RunResult> {
  return new Promise((settle) => {
    const fd0 = opts.stdin.kind === 'closed' ? 'ignore' : opts.stdin.fd;
    const child = spawn(opts.bin, opts.argv, {
      cwd: opts.cwd,
      // Never the implicit inherit: see sanitisedEnv. Required rather than defaulted, so a new
      // caller cannot get the whole parent environment by leaving an argument off.
      env: opts.env,
      // fd 0 is 'ignore' or a complete regular file, and never anything else — see ChildStdin.
      stdio: opts.stream ? [fd0, 'inherit', 'inherit'] : [fd0, 'pipe', 'pipe'],
      // Own process group, so a kill reaches the CLI *and everything it spawned* (its MCP stdio
      // servers). Without this they outlive the kill and reparent to init. POSIX only.
      detached: process.platform !== 'win32',
    });

    // Negative pid addresses the process group. Best-effort by construction: every way this can
    // fail means the thing we wanted dead is already dead.
    const killTree = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, signal); }
      catch { try { child.kill(signal); } catch { /* already reaped */ } }
    };

    let stdout = '', stderr = '', captured = 0;
    let timedOut = false, overflowed = false, settled = false;
    let exitStatus: number | null = null, exitSignal: NodeJS.Signals | null = null;
    // Decode through StringDecoder so a multibyte codepoint split across two chunks isn't mangled.
    const outDec = new StringDecoder('utf8'), errDec = new StringDecoder('utf8');
    let watchdog: NodeJS.Timeout | undefined, killTimer: NodeJS.Timeout | undefined;
    let closeGrace: NodeJS.Timeout | undefined;
    /** Everything except the forced settle — the two that decide when to kill. */
    const stopKillTimers = (): void => { clearTimeout(watchdog); clearTimeout(killTimer); };
    const stopTimers = (): void => { stopKillTimers(); clearTimeout(closeGrace); };

    const capture = (buf: Buffer, isErr: boolean): void => {
      if (overflowed) return;
      captured += buf.length;
      if (captured > MAX_CAPTURE_BYTES) {
        overflowed = true;
        stopKillTimers();        // else the watchdog could fire and mask the real cause
        killTree('SIGKILL');
        // …but *not* the forced settle. Clearing all three here disarmed the one timer that
        // bounds this call, and an overflow whose pipe was held by a leaked helper then waited
        // for that helper. GPT Sol's F9, 2026-09-06.
        armForcedSettle();
        return;
      }
      if (isErr) stderr += errDec.write(buf); else stdout += outDec.write(buf);
    };
    if (!opts.stream) {
      child.stdout?.on('data', (b: Buffer) => capture(b, false));
      child.stderr?.on('data', (b: Buffer) => capture(b, true));
    }

    watchdog = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      killTimer = setTimeout(() => {
        killTree('SIGKILL');                     // the part spawnSync can't do
        // …and settle on the same deadline rather than starting a second grace from the child's
        // exit. Two graces in series made a timed-out run return at timeout + 10s while every
        // doc said timeout + grace. GPT Sol's F11. setImmediate so an 'exit' landing in this same
        // tick still gets its status in.
        setImmediate(forceSettle);
      }, GRACE_MS);
    }, opts.timeoutMs);

    // Ctrl-C reaches the terminal's foreground process group, which `detached` took the child out
    // of — so forward it by hand, then re-raise so we still die from it exactly as before.
    const onSignal = (sig: NodeJS.Signals) => (): void => {
      killTree(sig);
      detachSignals();
      process.kill(process.pid, sig);
    };
    const onInt = onSignal('SIGINT'), onTerm = onSignal('SIGTERM');
    const detachSignals = (): void => {
      process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); process.off('SIGHUP', onHup);
    };
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);

    /**
     * SIGHUP — a closed tmux pane, a closed terminal — reaches THIS process and not the child,
     * which `detached` put in a process group and a session of its own. Until 2026-09-10 nothing
     * listened, so the wrapper died of it at once and left the CLI running as an orphan: measured
     * with a real pane on a scratch tmux socket (tests/run-claude.test.ts).
     *
     * So it is forwarded to the child's group like SIGTERM, and then WAITED FOR within the same
     * kill grace — SIGKILL at the grace — before it is re-raised, so the child is gone before this
     * process is. `onHangup` hears how the child ended first, synchronously. SIGINT and SIGTERM are
     * untouched.
     */
    let hungUp = false, hangupRaised = false, childGone = false;
    let hangupTimer: NodeJS.Timeout | undefined;
    const raiseHangup = (): void => {
      if (hangupRaised) return;
      hangupRaised = true;
      clearTimeout(hangupTimer);
      stopTimers();
      flush();
      try {
        opts.onHangup?.({ status: exitStatus, signal: exitSignal, timedOut, overflowed, stdout, stderr });
      } finally {
        detachSignals();
        process.kill(process.pid, 'SIGHUP');
      }
    };
    const onHup = (): void => {
      if (hungUp) return;
      hungUp = true;
      killTree('SIGHUP');
      if (childGone) { raiseHangup(); return; }
      // setImmediate for the reason the watchdog gives: an 'exit' landing in this tick still counts.
      hangupTimer = setTimeout(() => { killTree('SIGKILL'); setImmediate(raiseHangup); }, GRACE_MS);
    };
    process.on('SIGHUP', onHup);

    const finish = (r: RunResult): void => {
      if (settled) return;
      settled = true;
      stopTimers();
      detachSignals();
      // Sweep the group even on a clean exit: a run that exits without tearing down its MCP
      // servers leaves them alive in our group, and nothing else will ever collect them.
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), GRACE_MS).unref?.();
      settle(r);
    };
    const flush = (): void => { stdout += outDec.end(); stderr += errDec.end(); };

    /**
     * Settle without waiting for `'close'`, and **let go of the pipes**.
     *
     * Settling the promise is not the same as letting this process exit: the read streams are
     * ours, and while a leaked helper holds the other end they are open handles that keep node
     * alive after `main()` has returned. A successful run against a stand-in that left a
     * 20-second helper behind printed `Done —` and then sat there for the remaining fifteen
     * seconds — GPT Sol's F8, 2026-09-06, and invisible on the timeout path because `fail()`
     * calls `process.exit`.
     *
     * `destroy()` after the flush, so what the child actually wrote is already captured.
     */
    const forceSettle = (): void => {
      flush();
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish({ status: exitStatus, signal: exitSignal, timedOut, overflowed, stdout, stderr });
    };
    /** Bound the wait, once. Idempotent: several paths reach for the same guarantee. */
    function armForcedSettle(): void {
      closeGrace ??= setTimeout(forceSettle, GRACE_MS);
    }

    child.on('error', (spawnError) => {   // e.g. ENOENT — the CLI is not installed; 'close' may not fire
      flush();
      finish({ status: null, signal: null, timedOut, overflowed, stdout, stderr, spawnError });
    });
    child.on('close', (status, signal) => {   // 'close', not 'exit', so stdio is flushed first
      flush();
      finish({ status, signal, timedOut, overflowed, stdout, stderr });
    });
    /**
     * …but 'close' waits for **every** holder of our stdio pipes, and the child is not always the
     * last one. A helper it left behind — detached into its own process group, so the group kill
     * never reaches it — keeps the pipe open long after the child itself is gone, and until 2026-09-06
     * that meant the timeout bounded the *child* and not this function.
     *
     * Measured, twice: a `--timeout-minutes 5` claude run stuck in an API retry loop returned after
     * **15 minutes**, and a stand-in that spawns `sleep 120` detached turned a 6-second timeout into
     * 121 seconds. The wrapper reported "timed out after 5m and was killed" both times, because the
     * message names the flag rather than the clock — so nothing about it looked wrong.
     *
     * So 'exit' — which fires when the child itself goes, whatever is still holding the pipe —
     * starts a bounded wait for the flush. In the ordinary case 'close' lands microseconds later
     * and clears this; nothing changes. In the leaked-helper case we lose whatever that helper
     * would have written, which is not the child's output anyway.
     */
    child.on('exit', (status, signal) => {
      exitStatus = status;
      exitSignal = signal;
      childGone = true;
      // Hung up and waiting: the child is gone, so the hangup can be re-raised now.
      if (hungUp) raiseHangup();
      armForcedSettle();
    });
  });
}

/**
 * `.env.local` → `process.env`, so a subagent CLI's API key can live in the same file as every
 * other secret in this repo and a caller doesn't have to know to export it first. Follows
 * [`scripts/db-migrate.ts`](db-migrate.ts), which imports the same loader.
 *
 * Dynamic on purpose: this file is documented as portable
 * (`docs/reusable/codex-cli-as-subagent.md`, `claude-cli-as-subagent.md`) and gets carried into
 * other repos, where `src/env.ts`
 * does not exist. That case is detected by *looking for the file* rather than by catching the
 * import's failure — a broken import somewhere inside a loader that does exist raises the same
 * ERR_MODULE_NOT_FOUND, and catching by code swallows it. So there is no catch at all: a loader
 * that is absent is skipped, and a loader that is present but broken throws, rather than leaving a
 * half-built environment to surface downstream as an auth failure pointing at the wrong thing.
 *
 * Note what this does *not* do: it does not decide what the subagent sees. It loads the whole file
 * into this process — every secret this repo owns — and `sanitisedEnv` below is what stops all but
 * the named ones crossing into the child.
 */
export async function loadRepoEnv(): Promise<void> {
  if (!existsSync(join(import.meta.dirname, '..', 'src', 'env.ts'))) return;
  const mod = await import('../src/env.js');
  mod.loadEnvLocal();
}

/**
 * The environment the subagent actually gets. **Deny by default, on the variable's name.**
 *
 * This is the one place a secret can escape. `spawn` inherits the parent's environment unless told
 * otherwise, a subagent runs shell commands on the model's instruction, and the stdout of those
 * commands becomes the activity log — and can be quoted back in the final answer, which we print.
 * So a bare
 * `env` in a tool call, or a build script that echoes its config, is enough to move every key in
 * `.env.local` into a file and possibly into the caller's context. Nothing about that requires the
 * model to be adversarial; a debugging command is enough.
 *
 * That risk arrived with the `.env.local` load, but it did not start there: a developer's shell
 * routinely exports credentials for entirely unrelated projects, and those crossed too.
 *
 * A denylist rather than an allowlist because these CLIs genuinely need a large and unenumerable slice
 * of the environment — PATH, HOME, TMPDIR, LANG, the npm and XDG variables, whatever a plugin
 * wants. An allowlist would break in ways nobody could predict from reading it. `--pass-env NAME`
 * is the escape hatch for an MCP server that needs a token of its own, and it makes each crossing
 * explicit and visible in the command.
 *
 * Passing no `passThrough` withholds even the CLI's own key, which is how both wrappers reach a
 * subscription credential: each CLI prefers an API key whenever the variable is set, so the only
 * way to ask for the subscription is not to hand the key over.
 *
 * `drop` is the third list, and it is not about secrets: it removes variables that are *correct*
 * for the calling process and wrong for the child — the session-scoped plumbing a nested
 * `claude -p` would otherwise inherit from the Claude Code session that launched it.
 *
 * **`drop` beats `passThrough`.** A name on both is withheld, and `onOverruled` is told which —
 * by default a WARNING on stderr, names only. It used to be the other way round: passThrough was
 * re-added after the sweep, so `--pass-env` quietly defeated a drop list, and a child routed to
 * one account could be handed another's token beside it (plan 260910d). A caller that wants a name
 * to be restorable leaves it out of `drop` when it is asked for — see `claudeEnv` in run-claude.ts.
 */
export function sanitisedEnv(
  parent: NodeJS.ProcessEnv, passThrough: string[] = [], drop: string[] = [],
  onOverruled: (names: string[]) => void = warnOverruled,
): NodeJS.ProcessEnv {
  const dropped = new Set(drop);
  const allowed = new Set(passThrough.filter((name) => !dropped.has(name)));
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    if (dropped.has(name)) continue;
    if (isSecretName(name) && !allowed.has(name)) continue;
    out[name] = value;
  }
  // Re-added by name after the sweep: a CLI's own credential matches the denylist itself, so the
  // one variable the run is entitled to crosses, and it does so on purpose.
  for (const name of allowed) {
    const value = parent[name];
    if (value !== undefined) out[name] = value;
  }
  // Only names the parent actually has: withholding an absent variable refused nothing.
  const overruled = [...new Set(passThrough)].filter(
    (n) => dropped.has(n) && Object.hasOwn(parent, n) && parent[n] !== undefined,
  );
  if (overruled.length > 0) onOverruled(overruled);
  return out;
}

function warnOverruled(names: string[]): void {
  console.error(`WARNING: not passed to the child: ${names.join(', ')} — on this run's drop list,`
    + ' which --pass-env cannot override');
}

/**
 * Exists, and has something in it that isn't whitespace. `existsSync` alone was the check, and it
 * passes on the zero-byte file a killed run leaves behind — silence recorded as agreement. A lone
 * newline is the same silence with a byte in it.
 *
 * Scanned in fixed-size chunks rather than read whole: memory stays bounded at one chunk, which is
 * the property the rest of this file is careful about, without the "over 64 KiB, assume it's fine"
 * shortcut the first version took — that shortcut said a large whitespace-only file was an answer,
 * which is the exact claim the function exists to deny. GPT Sol's, 2026-08-26.
 *
 * Judged **byte by byte** rather than by decoding. A chunk boundary lands mid-codepoint most of
 * the time, and the U+FFFD that produces is not whitespace — so a file of non-breaking spaces
 * could come back "usable" purely because of where we cut. Any byte outside ASCII whitespace,
 * including every byte of a multibyte character, counts as content.
 */
const ANSWER_CHUNK_BYTES = 64 * 1024;
const ASCII_WHITESPACE = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]);
export function answerIsUsable(path: string): boolean {
  let fd: number | undefined;
  try {
    if (statSync(path).size === 0) return false;
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(ANSWER_CHUNK_BYTES);
    for (;;) {
      const len = readSync(fd, buf, 0, ANSWER_CHUNK_BYTES, null);
      if (len === 0) return false;
      for (let i = 0; i < len; i++) if (!ASCII_WHITESPACE.has(buf[i]!)) return true;
    }
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
