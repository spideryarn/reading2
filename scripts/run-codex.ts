#!/usr/bin/env -S npx tsx
/**
 * run-codex.ts — the safe way to run `codex exec` as a subagent from another coding agent.
 *
 * Why a wrapper rather than calling `codex exec` directly: three failure modes are impossible here
 * *by construction*, so a caller can't forget the gotcha.
 *
 *   1. stdin is closed (`stdio[0] = 'ignore'`) → codex gets an immediate EOF and never wedges on
 *      "Reading additional input from stdin...", which is what a bare `codex exec` does whenever
 *      it inherits an open pipe on fd 0 (i.e. every time an agent shells out to it).
 *   2. The prompt is a positional arg after `--` → a prompt beginning with `-` is never parsed as
 *      a flag, and it never has to travel via stdin.
 *   3. Codex's activity log (every command it ran, plus that command's full stdout) is *captured
 *      to a file*, not streamed. A bare `codex exec` floods the calling agent's context with tens
 *      of thousands of tokens of file dumps and grep hits. Pass --stream for a human watching.
 *      This one is safe *by default* rather than by construction: --stream and --print are
 *      deliberate escape hatches out of it, and they say so.
 *
 * Plus a hard timeout: SIGTERM → grace → SIGKILL, applied to the whole process group, so a wedged
 * run (and the MCP servers it spawned) actually dies.
 *
 * What reaches the caller's context, by default: codex's *final answer* (capped at
 * --max-print-chars, then truncated with a pointer to the full file) plus a two-line status. The
 * activity log — which is the big one — only ever reaches a file. `--quiet` prints paths alone;
 * `--print` prints the answer uncapped.
 *
 *   npx tsx scripts/run-codex.ts --prompt "Summarise how src/extract.ts works"
 *   npx tsx scripts/run-codex.ts --sandbox workspace-write --prompt-file /tmp/task.md -o /tmp/a.md
 *
 * See docs/reusable/codex-cli-as-subagent.md for models, auth, and the read-only/write switch.
 */

import { spawn } from 'node:child_process';
import {
  closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync,
  statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/** Frontier tier. `gpt-5.6-terra` is the everyday middle, `gpt-5.6-luna` the cheap/fast one. */
const DEFAULT_MODEL = 'gpt-5.6-sol';
/** minimal|low|medium|high|xhigh. `xhigh` for a hard review, `low` for mechanical work. */
const DEFAULT_EFFORT = 'high';
const DEFAULT_TIMEOUT_MINUTES = 30;
const SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access'];
const GRACE_MS = 5_000;
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'];
/** ~5k tokens. Big enough for any real review, small enough that a runaway answer can't flood a
 * calling agent's context — which is the whole point of this wrapper. */
const DEFAULT_MAX_PRINT_CHARS = 20_000;
/** Above this, the answer file is excerpted with two bounded reads instead of being slurped whole.
 * Codex's final message is never this big — which is exactly why an unbounded readFileSync here
 * would never fail in testing and only ever fail in the wild. */
const MAX_ANSWER_READ_BYTES = 4 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;

interface Args {
  model: string;
  prompt?: string;
  promptFile?: string;
  sandbox: string;
  effort: string;
  repoDir: string;
  timeoutMinutes: number;
  output?: string;
  activityLog?: string;
  stream: boolean;
  print: boolean;
  quiet: boolean;
  maxPrintChars: number;
  dryRun: boolean;
}

function fail(msg: string): never {
  console.error(`run-codex: ${msg}`);
  process.exit(1);
}

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    model: DEFAULT_MODEL, sandbox: 'read-only', effort: DEFAULT_EFFORT, repoDir: process.cwd(),
    timeoutMinutes: DEFAULT_TIMEOUT_MINUTES, stream: false, print: false, quiet: false,
    maxPrintChars: DEFAULT_MAX_PRINT_CHARS, dryRun: false,
  };
  const rest = [...argv];
  const value = (flag: string): string => {
    const v = rest.shift();
    if (v === undefined) throw new Error(`${flag} requires a value`);
    return v;
  };
  while (rest.length) {
    const flag = rest.shift()!;
    switch (flag) {
      case '--model': case '-m': out.model = value(flag); break;
      case '--prompt': out.prompt = value(flag); break;
      case '--prompt-file': out.promptFile = value(flag); break;
      case '--sandbox': case '-s': out.sandbox = value(flag); break;
      case '--effort': out.effort = value(flag); break;
      case '--repo-dir': case '--cd': case '-C': out.repoDir = value(flag); break;
      case '--timeout-minutes': out.timeoutMinutes = Number(value(flag)); break;
      case '--output': case '-o': out.output = value(flag); break;
      case '--activity-log': out.activityLog = value(flag); break;
      case '--stream': out.stream = true; break;
      case '--print': out.print = true; break;
      case '--quiet': case '-q': out.quiet = true; break;
      case '--max-print-chars': out.maxPrintChars = Number(value(flag)); break;
      case '--dry-run': out.dryRun = true; break;
      default: throw new Error(`unknown flag: ${flag}`);
    }
  }
  if (!out.prompt && !out.promptFile) throw new Error('provide --prompt or --prompt-file');
  if (!SANDBOXES.includes(out.sandbox)) throw new Error(`--sandbox must be one of: ${SANDBOXES.join(', ')}`);
  // Caught here rather than by codex: `-c model_reasoning_effort=hgih` is accepted by the config
  // parser as a literal string, so a typo silently runs at the model's own default effort.
  if (!EFFORTS.includes(out.effort)) throw new Error(`--effort must be one of: ${EFFORTS.join(', ')}`);
  // Integer and positive: a fractional or zero cap made `half` zero, and the truncation branch then
  // printed the whole answer under a banner saying it had been cut. `--print` is the way to ask for
  // no cap; there is no in-band value that means it.
  if (!Number.isSafeInteger(out.maxPrintChars) || out.maxPrintChars < 1) {
    throw new Error(`--max-print-chars must be a positive integer (got ${out.maxPrintChars})`);
  }
  // --stream hands both of codex's streams straight to the terminal, so nothing downstream of it
  // can cap or suppress anything. Silently ignoring a cap the caller asked for is how an
  // orchestrated run floods a context while its flags claim otherwise.
  if (out.stream && (out.quiet || out.print)) {
    throw new Error('--stream sends everything to the terminal; it cannot be combined with --quiet or --print');
  }
  if (!Number.isFinite(out.timeoutMinutes) || out.timeoutMinutes <= 0) {
    throw new Error(`--timeout-minutes must be a positive number (got ${out.timeoutMinutes})`);
  }
  return out;
}

/** The one place the codex invocation shape is defined. Exported so it can be asserted on. */
export function buildCodexArgs(o: {
  model: string; effort: string; sandbox: string; repoDir: string; outFile: string; prompt: string;
}): string[] {
  return [
    'exec',
    '--model', o.model,
    '-c', `model_reasoning_effort=${o.effort}`,
    // Load-bearing, and NOT the default once a user config sets `approvals_reviewer`: without it
    // `--sandbox read-only` is not a boundary. Under `approval_policy = "on-request"` the model can
    // escalate past the sandbox, and an automated approver grants it with no human in the loop —
    // verified on codex 0.146.0, where a read-only run happily created a file. `never` makes the
    // sandbox authoritative: a blocked operation just returns its failure to the model.
    '-c', 'approval_policy=never',
    '--sandbox', o.sandbox,
    '--cd', resolve(o.repoDir),
    '--skip-git-repo-check',
    '-o', o.outFile,
    '--',              // ends flag parsing: a prompt starting with `-` stays a prompt
    o.prompt,
  ];
}

/**
 * What the caller actually sees of codex's answer. Truncating in the *middle* rather than the tail
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

interface RunResult {
  status: number | null;
  signal: string | null;
  timedOut: boolean;
  overflowed: boolean;
  stdout: string;
  stderr: string;
  spawnError?: Error;
}

/**
 * Spawn codex, capture (or stream) its output, enforce the timeout. Never rejects: every outcome —
 * clean exit, non-zero, timeout-kill, spawn failure, capture overflow — resolves to a RunResult the
 * caller classifies, so callers fail closed rather than on an unhandled throw.
 */
export function runCodex(opts: { argv: string[]; timeoutMs: number; stream: boolean; bin?: string }): Promise<RunResult> {
  return new Promise((settle) => {
    const child = spawn(opts.bin ?? 'codex', opts.argv, {
      // fd 0 = 'ignore' is the load-bearing anti-hang guarantee. Never inherit or pipe stdin here.
      stdio: opts.stream ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
      // Own process group, so a kill reaches codex *and everything it spawned* (its MCP stdio
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
    // Decode through StringDecoder so a multibyte codepoint split across two chunks isn't mangled.
    const outDec = new StringDecoder('utf8'), errDec = new StringDecoder('utf8');
    let watchdog: NodeJS.Timeout | undefined, killTimer: NodeJS.Timeout | undefined;
    const stopTimers = (): void => { clearTimeout(watchdog); clearTimeout(killTimer); };

    const capture = (buf: Buffer, isErr: boolean): void => {
      if (overflowed) return;
      captured += buf.length;
      if (captured > MAX_CAPTURE_BYTES) {
        overflowed = true;
        stopTimers();            // else the watchdog could fire and mask the real cause
        killTree('SIGKILL');
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
      killTimer = setTimeout(() => killTree('SIGKILL'), GRACE_MS);  // the part spawnSync can't do
    }, opts.timeoutMs);

    // Ctrl-C reaches the terminal's foreground process group, which `detached` took the child out
    // of — so forward it by hand, then re-raise so we still die from it exactly as before.
    const onSignal = (sig: NodeJS.Signals) => (): void => {
      killTree(sig);
      detachSignals();
      process.kill(process.pid, sig);
    };
    const onInt = onSignal('SIGINT'), onTerm = onSignal('SIGTERM');
    const detachSignals = (): void => { process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); };
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);

    const finish = (r: RunResult): void => {
      if (settled) return;
      settled = true;
      stopTimers();
      detachSignals();
      // Sweep the group even on a clean exit: a codex run that exits without tearing down its MCP
      // servers leaves them alive in our group, and nothing else will ever collect them.
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), GRACE_MS).unref?.();
      settle(r);
    };
    const flush = (): void => { stdout += outDec.end(); stderr += errDec.end(); };

    child.on('error', (spawnError) => {   // e.g. ENOENT — codex not installed; 'close' may not fire
      flush();
      finish({ status: null, signal: null, timedOut, overflowed, stdout, stderr, spawnError });
    });
    child.on('close', (status, signal) => {   // 'close', not 'exit', so stdio is flushed first
      flush();
      finish({ status, signal, timedOut, overflowed, stdout, stderr });
    });
  });
}

async function main(): Promise<void> {
  let args: Args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { fail((e as Error).message); }

  const prompt = args.promptFile ? readFileSync(resolve(args.promptFile), 'utf8') : args.prompt!;
  // Fresh temp dir per run, so a run's -o file can never be a previous run's leftover.
  const tmpDir = mkdtempSync(join(tmpdir(), 'run-codex-'));
  const outFile = join(tmpDir, 'output.txt');
  const codexArgs = buildCodexArgs({ ...args, outFile, prompt });

  if (args.dryRun) {
    // The prompt is the last element, and with --prompt-file it can be arbitrarily large — a third
    // unbounded path to the caller's stdout, next to --stream and --print. Cap it like the answer.
    // The command stops being copy-pasteable at that size anyway (argv has its own limit), and
    // whoever wants the exact text has the file it came from.
    const shown = [...codexArgs.slice(0, -1), formatAnswer(prompt, args.maxPrintChars, args.promptFile ?? '(--prompt)')];
    console.log(['codex', ...shown].join(' '));
    return;
  }

  const run = await runCodex({ argv: codexArgs, timeoutMs: args.timeoutMinutes * 60_000, stream: args.stream });

  let logPath: string | undefined;
  if (!args.stream) {
    const log = run.stdout + run.stderr;
    if (log) {
      logPath = args.activityLog
        ? resolve(args.activityLog)
        : (args.output ? `${resolve(args.output)}.activity.log` : join(tmpDir, 'activity.log'));
      mkdirSync(dirname(logPath), { recursive: true });
      writeFileSync(logPath, log);
    }
  }
  const hint = logPath ? `; activity log at ${logPath}` : '';

  // Fail closed, most-specific cause first.
  if (run.spawnError) fail(`could not run codex (${run.spawnError.message}) — is the Codex CLI on PATH?${hint}`);
  if (run.overflowed) fail(`codex exec exceeded the 64 MiB capture cap and was killed${hint}`);
  if (run.timedOut) fail(`codex exec timed out after ${args.timeoutMinutes}m and was killed${hint}`);
  if (run.status !== 0) fail(`codex exec exited ${run.status ?? 'null'}${run.signal ? ` [${run.signal}]` : ''}${hint}`);
  if (!existsSync(outFile)) fail(`codex exec produced no output file${hint}`);

  let answerPath = outFile;
  if (args.output) {
    answerPath = resolve(args.output);
    mkdirSync(dirname(answerPath), { recursive: true });
    copyFileSync(outFile, answerPath);
  }

  console.log(`Done — codex exec (${args.model}, ${args.effort}, ${args.sandbox}).`);
  console.log(`Output: ${answerPath}`);
  if (logPath) console.log(`Activity log (not streamed): ${logPath}`);
  // The answer is the thing you asked for, so print it: a caller that has to shell out a second
  // time to `cat` it pays a whole extra round trip for nothing. The activity log is the part that
  // must never be printed, and it isn't. `--print` lifts the cap; `--quiet` prints neither.
  if (!args.quiet && !args.stream) {
    // --print is the deliberate escape hatch, and the one path that will read a file of any size
    // into memory. Everything else goes through the bounded reader.
    const shown = args.print
      ? readFileSync(answerPath, 'utf8')
      : readAnswerForConsole(answerPath, args.maxPrintChars);
    console.log(`--- output ---\n${shown}`);
  }
}

// Only run when executed directly, so the exported helpers can be imported and tested.
if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  main().catch((e) => fail((e as Error).message));
}
