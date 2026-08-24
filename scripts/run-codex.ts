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
 *
 * Plus a hard timeout: SIGTERM → grace → SIGKILL, applied to the whole process group, so a wedged
 * run (and the MCP servers it spawned) actually dies.
 *
 * Quiet by default: prints the output path and a status line, not codex's answer. Read the output
 * file deliberately afterwards, or pass --print.
 *
 *   npx tsx scripts/run-codex.ts --prompt "Summarise how src/extract.ts works"
 *   npx tsx scripts/run-codex.ts --sandbox workspace-write --prompt-file /tmp/task.md -o /tmp/a.md
 *
 * See docs/reusable/CODEX_CLI_AS_SUBAGENT.md for models, auth, and the read-only/write switch.
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  dryRun: boolean;
}

function fail(msg: string): never {
  console.error(`run-codex: ${msg}`);
  process.exit(1);
}

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    model: DEFAULT_MODEL, sandbox: 'read-only', effort: DEFAULT_EFFORT, repoDir: process.cwd(),
    timeoutMinutes: DEFAULT_TIMEOUT_MINUTES, stream: false, print: false, dryRun: false,
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
      case '--dry-run': out.dryRun = true; break;
      default: throw new Error(`unknown flag: ${flag}`);
    }
  }
  if (!out.prompt && !out.promptFile) throw new Error('provide --prompt or --prompt-file');
  if (!SANDBOXES.includes(out.sandbox)) throw new Error(`--sandbox must be one of: ${SANDBOXES.join(', ')}`);
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
    console.log(['codex', ...codexArgs].join(' '));
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
  if (args.print) console.log(`--- output ---\n${readFileSync(answerPath, 'utf8')}`);
}

// Only run when executed directly, so the exported helpers can be imported and tested.
if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  main().catch((e) => fail((e as Error).message));
}
