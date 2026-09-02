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
 * And the credential: by default the ChatGPT subscription is spent first and `CODEX_API_KEY` picks
 * up whatever it can't — see AUTH_MODES. Codex prefers the key whenever the variable is set, so
 * "subscription first" is implemented by withholding the key rather than by asking for anything.
 *
 * What reaches the caller's context, by default: codex's *final answer* (capped at
 * --max-print-chars, then truncated with a pointer to the full file) plus a two-line status. The
 * activity log — which is the big one — only ever reaches a file. `--quiet` prints paths alone;
 * `--print` prints the answer uncapped.
 *
 *   npx tsx scripts/run-codex.ts --prompt "Summarise how src/extract.ts works"
 *   npx tsx scripts/run-codex.ts --sandbox workspace-write --prompt-file /tmp/task.md -o /tmp/a.md
 *
 * The default sandbox is `review`: the tree read-only, the test caches writable — see SANDBOXES.
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
import { isMain } from '../src/is-main.js';

/** Frontier tier. `gpt-5.6-terra` is the everyday middle, `gpt-5.6-luna` the cheap/fast one. */
const DEFAULT_MODEL = 'gpt-5.6-sol';
/** minimal|low|medium|high|xhigh. `xhigh` for a hard review, `low` for mechanical work. */
const DEFAULT_EFFORT = 'high';
const DEFAULT_TIMEOUT_MINUTES = 30;
/**
 * `review` is the default: the tree is read-only exactly as under `read-only`, but `/tmp` and the
 * caches under `node_modules` are writable, so the reviewer can run one test file or a tsx script
 * and reproduce a finding rather than reason about it. Under plain `read-only`, measured on
 * 2026-09-02, vitest died on `node_modules/.vite-temp` and tsx on its IPC pipe, and fifteen
 * reviews in a row had never run a test. The profile is codex's own mechanism — a named
 * `[permissions.<name>]` table with per-path rules — and lives in the repo's `.codex/config.toml`,
 * so a repo without one gets a clear refusal here rather than codex's `default_permissions
 * requires a [permissions] table`. `read-only` stays selectable for such a repo.
 */
const SANDBOXES = ['review', 'read-only', 'workspace-write', 'danger-full-access'];
const REVIEW_PROFILE = 'review';
/** Whether a sandbox can edit the working tree — which decides whether a run may be retried. */
export function writesTree(sandbox: string): boolean {
  return sandbox !== 'read-only' && sandbox !== 'review';
}
/**
 * The repo's `.codex/config.toml` has to define the profile, or codex exits 1 before the model
 * says a word. A textual check rather than a TOML parse: the only question is whether the table
 * header is there, and a wrong rule inside it is codex's error to report, with its own wording.
 */
export function reviewProfileDefined(repoDir: string): boolean {
  const path = join(resolve(repoDir), '.codex', 'config.toml');
  if (!existsSync(path)) return false;
  return /^\s*\[permissions\.review(\.|\])/m.test(readFileSync(path, 'utf8'));
}
/**
 * Which credential to spend, and in what order.
 *
 * Codex takes `CODEX_API_KEY` over a logged-in `~/.codex/auth.json` whenever the variable is set,
 * and the only lever from out here is whether the variable crosses into the child at all. So
 * "prefer the subscription" means *withholding* the key, and falling back means running the whole
 * thing again with it.
 *
 *   subscription-first  the subscription, then the key if that credential is spent (default)
 *   key-first           the key, or the subscription if no key is set — one attempt
 *   subscription-only   the subscription, never the key — one attempt
 */
const AUTH_MODES = ['subscription-first', 'key-first', 'subscription-only'];
const DEFAULT_AUTH = 'subscription-first';
const GRACE_MS = 5_000;
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'];
/** ~5k tokens. Big enough for any real review, small enough that a runaway answer can't flood a
 * calling agent's context — which is the whole point of this wrapper. */
const DEFAULT_MAX_PRINT_CHARS = 20_000;
/** Above this, the answer file is excerpted with two bounded reads instead of being slurped whole.
 * Codex's final message is never this big — which is exactly why an unbounded readFileSync here
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

function isSecretName(name: string): boolean {
  return SECRET_WORD.test(name) || SECRET_SEGMENT.test(name) || SECRET_VALUE_SHAPE.test(name);
}
/** The one credential codex is entitled to, and the only one that crosses by default. */
const CODEX_SECRET = 'CODEX_API_KEY';
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;

interface Args {
  model: string;
  prompt?: string;
  promptFile?: string;
  sandbox: string;
  effort: string;
  auth: string;
  repoDir: string;
  timeoutMinutes: number;
  output?: string;
  activityLog?: string;
  stream: boolean;
  print: boolean;
  quiet: boolean;
  passEnv: string[];
  maxPrintChars: number;
  dryRun: boolean;
}

function fail(msg: string): never {
  console.error(`run-codex: ${msg}`);
  process.exit(1);
}

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    model: DEFAULT_MODEL, sandbox: REVIEW_PROFILE, effort: DEFAULT_EFFORT, auth: DEFAULT_AUTH,
    repoDir: process.cwd(),
    timeoutMinutes: DEFAULT_TIMEOUT_MINUTES, stream: false, print: false, quiet: false,
    maxPrintChars: DEFAULT_MAX_PRINT_CHARS, dryRun: false, passEnv: [],
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
      case '--auth': out.auth = value(flag); break;
      case '--repo-dir': case '--cd': case '-C': out.repoDir = value(flag); break;
      case '--timeout-minutes': out.timeoutMinutes = Number(value(flag)); break;
      case '--output': case '-o': out.output = value(flag); break;
      case '--activity-log': out.activityLog = value(flag); break;
      case '--stream': out.stream = true; break;
      case '--print': out.print = true; break;
      case '--quiet': case '-q': out.quiet = true; break;
      case '--max-print-chars': out.maxPrintChars = Number(value(flag)); break;
      // Repeatable. Named, so every credential that reaches codex is visible in the command line.
      case '--pass-env': out.passEnv.push(value(flag)); break;
      case '--dry-run': out.dryRun = true; break;
      default: throw new Error(`unknown flag: ${flag}`);
    }
  }
  if (!out.prompt && !out.promptFile) throw new Error('provide --prompt or --prompt-file');
  if (!SANDBOXES.includes(out.sandbox)) throw new Error(`--sandbox must be one of: ${SANDBOXES.join(', ')}`);
  if (!AUTH_MODES.includes(out.auth)) throw new Error(`--auth must be one of: ${AUTH_MODES.join(', ')}`);
  // --pass-env is applied *after* the denylist sweep, so this would hand the key to an attempt
  // that had asked for the subscription — which then spends the key, reports the subscription,
  // and "falls back" to the credential it was already using. --auth owns this one variable.
  if (out.passEnv.includes(CODEX_SECRET)) {
    throw new Error(`--pass-env ${CODEX_SECRET} would override --auth; use --auth key-first instead`);
  }
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
    // A named permissions profile and `--sandbox` are two ways of saying the same thing, and the
    // config reference says not to combine them. The profile is resolved from the `--cd` repo's
    // own `.codex/config.toml`; main() has checked it is there.
    ...(o.sandbox === REVIEW_PROFILE
      ? ['-c', `default_permissions=${REVIEW_PROFILE}`]
      : ['--sandbox', o.sandbox]),
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
export function runCodex(opts: {
  argv: string[]; timeoutMs: number; stream: boolean; bin?: string; env?: NodeJS.ProcessEnv;
}): Promise<RunResult> {
  return new Promise((settle) => {
    const child = spawn(opts.bin ?? 'codex', opts.argv, {
      // Never the implicit inherit: see childEnv.
      env: opts.env ?? childEnv(process.env),
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

/**
 * `.env.local` → `process.env`, so `CODEX_API_KEY` can live in the same file as every other secret
 * in this repo and a caller doesn't have to know to export it first. Follows
 * [`scripts/db-migrate.ts`](db-migrate.ts), which imports the same loader.
 *
 * Dynamic on purpose: this file is documented as portable
 * (`docs/reusable/codex-cli-as-subagent.md`) and gets carried into other repos, where `src/env.ts`
 * does not exist. That case is detected by *looking for the file* rather than by catching the
 * import's failure — a broken import somewhere inside a loader that does exist raises the same
 * ERR_MODULE_NOT_FOUND, and catching by code swallows it. So there is no catch at all: a loader
 * that is absent is skipped, and a loader that is present but broken throws, rather than leaving a
 * half-built environment to surface downstream as an auth failure pointing at the wrong thing.
 *
 * Note what this does *not* do: it does not decide what codex sees. It loads the whole file into
 * this process — every secret this repo owns — and `childEnv` below is what stops all but one of
 * them crossing into the child.
 */
async function loadRepoEnv(): Promise<void> {
  if (!existsSync(join(import.meta.dirname, '..', 'src', 'env.ts'))) return;
  const mod = await import('../src/env.js');
  mod.loadEnvLocal();
}

/**
 * The environment codex actually gets. **Deny by default, on the variable's name.**
 *
 * This is the one place a secret can escape. `spawn` inherits the parent's environment unless told
 * otherwise, codex runs shell commands on the model's instruction, and the stdout of those commands
 * becomes the activity log — and can be quoted back in the final answer, which we print. So a bare
 * `env` in a tool call, or a build script that echoes its config, is enough to move every key in
 * `.env.local` into a file and possibly into the caller's context. Nothing about that requires the
 * model to be adversarial; a debugging command is enough.
 *
 * That risk arrived with the `.env.local` load, but it did not start there: a developer's shell
 * routinely exports credentials for entirely unrelated projects, and those crossed too.
 *
 * A denylist rather than an allowlist because codex genuinely needs a large and unenumerable slice
 * of the environment — PATH, HOME, TMPDIR, LANG, the npm and XDG variables, whatever a plugin
 * wants. An allowlist would break in ways nobody could predict from reading it. `--pass-env NAME`
 * is the escape hatch for an MCP server that needs a token of its own, and it makes each crossing
 * explicit and visible in the command.
 *
 * `useCodexKey: false` withholds even that one, which is how `--auth subscription-first` reaches
 * `~/.codex/auth.json`: codex prefers the variable whenever it is set, so the only way to ask for
 * the subscription is not to hand the key over.
 */
export function childEnv(
  parent: NodeJS.ProcessEnv, passThrough: string[] = [], useCodexKey = true,
): NodeJS.ProcessEnv {
  const allowed = new Set(useCodexKey ? [CODEX_SECRET, ...passThrough] : passThrough);
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    if (isSecretName(name) && !allowed.has(name)) continue;
    out[name] = value;
  }
  // Re-added by name after the sweep: CODEX_API_KEY matches the denylist itself, so exactly one
  // secret crosses and it does so on purpose.
  for (const name of allowed) {
    const value = parent[name];
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/**
 * Which credential each attempt spends, in order. `true` = `CODEX_API_KEY` crosses into the child.
 *
 * With no key set there is nothing to fall back *to*, so subscription-first is one attempt rather
 * than two — otherwise every failure would be run twice against the same credential.
 */
export function authPlan(mode: string, haveKey: boolean): boolean[] {
  // `[haveKey]`, not `[true]`: with no key set, codex falls through to the subscription and runs
  // perfectly well — but the status line and the error hint both name whatever this array says,
  // so `[true]` sent somebody to top up a key that does not exist. GPT Sol's, 2026-08-26.
  if (mode === 'key-first') return [haveKey];
  if (mode === 'subscription-only') return [false];
  return haveKey ? [false, true] : [false];
}

/**
 * Is this failure about the credential rather than about the work? Only these are worth spending
 * the other credential on — retrying a bad prompt or a wedged run just pays for it twice.
 *
 * Anchored to codex's own `ERROR:` lines for the same reason authHint is: the activity log is
 * mostly the contents of the files codex read, and this repo's own documentation contains every
 * phrase below. An unanchored match would retry any run that happened to open this page.
 */
export function isCredentialFailure(log: string): boolean {
  const errors = log.split('\n').filter((l) => /^\s*ERROR\b/i.test(l)).join('\n');
  return /out of credits|no credits remaining|insufficient (credit|quota|funds)|quota exceeded/i.test(errors)
    || /rate.?limit|usage limit|\b(401|429)\b|unauthor|not logged in|(missing|incorrect|invalid|no) api key/i.test(errors);
}

/**
 * Whether to try the other credential. Reached only when an attempt produced no usable answer.
 *
 * **Positive evidence, every time.** The bar is a credential phrase in codex's own ERROR lines,
 * and nothing else clears it — not a timeout, not a capture overflow, not a missing binary, and
 * notably not an exit code. Two of those are new, and both were GPT Sol's on 2026-08-26:
 *
 *   - An **exit 0 with no answer** used to fall back unconditionally, on the reasoning that a
 *     status code of 0 tells you nothing. True, but the log does: the one time this was actually
 *     observed (0.149.1, a review that read ~279,000 tokens) `ERROR: Your workspace is out of
 *     credits` was right there, so the evidence rule catches it anyway and the unconditional
 *     branch only ever added false retries.
 *   - A **streamed** run captured no log at all, which used to mean "fall back on any failure".
 *     That is backwards: no evidence is a reason not to spend the second credential, not a licence
 *     to. `--stream` is for a human watching a terminal, and they can re-run it themselves.
 *
 * And a write-capable run is never retried automatically, whatever the log says: the second
 * attempt starts fresh and runs the whole prompt again over the first one's half-finished edits.
 * Whether that is recoverable is a judgement about the diff, so it belongs to whoever reads it.
 */
export function shouldFallBack(
  run: { status: number | null; timedOut: boolean; overflowed: boolean; spawnError?: Error },
  log: string, opts: { streamed: boolean; sandbox: string },
): boolean {
  if (run.spawnError || run.timedOut || run.overflowed) return false;
  if (opts.streamed || writesTree(opts.sandbox)) return false;
  return isCredentialFailure(log);
}

/**
 * The two captured channels as one text. Joined with a newline rather than concatenated: without
 * it the last line of stdout and the first of stderr fuse into one, which can both hide a real
 * `ERROR:` line and manufacture a line that starts with one.
 */
export function combinedLog(run: { stdout: string; stderr: string }): string {
  return `${run.stdout}\n${run.stderr}`;
}

/**
 * The fallback that was available and deliberately not taken, said out loud. Without it a write
 * run that died on a spent credential looks exactly like one where `--auth` was never going to
 * help, and the obvious next move — re-run the same command — repeats the same failure.
 */
function accountNote(args: Args, run: RunResult, plan: boolean[], attempt: number): string {
  if (args.stream) return '';   // both channels went to the terminal; there is no log to read
  const log = combinedLog(run);
  return authHint(log, plan[attempt]!) + heldFallbackNote(args, plan, attempt, log);
}

function heldFallbackNote(args: Args, plan: boolean[], attempt: number, log: string): string {
  if (plan.length < 2 || attempt !== 0 || !writesTree(args.sandbox)) return '';
  // And only when the other credential would actually have helped. A write run that failed on a
  // bad prompt gets told about a fallback that has nothing to do with it — noise in the one place
  // somebody is reading carefully.
  if (!isCredentialFailure(log)) return '';
  return `\n  A ${args.sandbox} run is not retried on the other credential automatically — the`
    + " second attempt would run the whole prompt again over the first one's edits. Check the"
    + ' tree, then re-run with --auth key-first.';
}

/** The name of a credential, never its value. */
function credentialName(withKey: boolean): string {
  return withKey ? CODEX_SECRET : 'the ChatGPT subscription';
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
function answerIsUsable(path: string): boolean {
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

/**
 * Codex reports "out of credits" and "not logged in" as a bare exit 1, with the reason buried in
 * an activity log the caller has been told not to read. Both are about the human's account rather
 * than anything the caller did wrong, and both are one-line fixes, so lift them out — bounded to
 * the matched phrase, never the surrounding log.
 *
 * `usedKey` says which of the two accounts the failing attempt was actually spending, because the
 * fix is different for each and the hint names an account. It used to hedge — "if CODEX_API_KEY is
 * set, that key is the one that has run dry" — which was true while the key always won. Since
 * `--auth` it isn't: a `subscription-only` run sent somebody to top up a key it had deliberately
 * withheld, with the key sitting there full. Caught by the first smoke test that failed on purpose.
 */
export function authHint(log: string, usedKey = true): string {
  // Anchored to codex's own `ERROR:` line, not matched anywhere in the log. The log is mostly the
  // *contents of files codex read*, so an unanchored search reads the repo's own prose back to
  // itself: this very repo documents the string "out of credits", and any failed run that happened
  // to open that doc would have been told to go and buy credits it already had.
  const errors = log.split('\n').filter((l) => /^\s*ERROR\b/i.test(l)).join('\n');
  /* Both auth paths word this the same failure differently, and matching only one of them is
     how a run reports a bare `exit 1` and sends the caller to read the log by hand — the exact
     outcome this function exists to prevent. A ChatGPT subscription says "Your workspace is out
     of credits"; API-key billing says "You have no credits remaining". */
  if (/out of credits|no credits remaining|insufficient (credit|quota|funds)/i.test(errors)) {
    return usedKey
      ? '\n  CODEX_API_KEY is out of credits — top that key up at platform.openai.com billing.' +
        ' A ChatGPT subscription with credit left is reachable with --auth subscription-only.'
      // Not "falls back on its own": on a write run it doesn't, and this sentence would be
      // contradicted by the very next line of the same error.
      : '\n  The ChatGPT subscription is out of credits. Setting CODEX_API_KEY (in .env.local, or' +
        ' exported) bills pay-as-you-go instead; --auth subscription-first spends the subscription' +
        ' first and falls back to the key on a read-only run.';
  }
  if (/401|unauthor|not logged in|(missing|incorrect|invalid|no) api key|authentication/i.test(errors)) {
    return '\n  That looks like an auth failure. Run `codex login`, or set CODEX_API_KEY.';
  }
  return '';
}

/**
 * Run the plan — one `codex exec` per credential, stopping at the first that produces a usable
 * answer. Returns the **last** attempt, which is the one every error message downstream is about:
 * with a fallback in play the earlier failure was on a credential we have already stopped using,
 * and sending somebody to top that account up would point at the wrong one.
 */
async function runPlan(args: Args, prompt: string, tmpDir: string, plan: boolean[]): Promise<{
  run: RunResult; outFile: string; logs: string[]; attempt: number;
}> {
  const logs: string[] = [];
  let run!: RunResult;
  let outFile = '';
  let attempt = 0;
  for (; attempt < plan.length; attempt++) {
    const withKey = plan[attempt]!;
    // A fresh -o path per attempt. Sharing one would let a first attempt's partial answer stand in
    // for a retry that produced nothing — indistinguishable, from out here, from the retry working.
    outFile = join(tmpDir, `output-${attempt + 1}.txt`);
    run = await runCodex({
      argv: buildCodexArgs({ ...args, outFile, prompt }),
      timeoutMs: args.timeoutMinutes * 60_000,
      stream: args.stream,
      env: childEnv(process.env, args.passEnv, withKey),
    });
    const log = args.stream ? '' : combinedLog(run);
    // Banner every attempt once there is more than one, *even when it printed nothing* — an
    // attempt that failed silently is the one you most want to see listed, and a log holding only
    // attempt 1 reads exactly like a run that never retried.
    if (!args.stream) {
      if (plan.length > 1) logs.push(`=== attempt ${attempt + 1}, ${credentialName(withKey)} ===\n${log}`);
      else if (log) logs.push(log);
    }
    const worked = run.status === 0 && !run.spawnError && !run.timedOut && !run.overflowed
      && answerIsUsable(outFile);
    if (worked || attempt === plan.length - 1) break;
    if (!shouldFallBack(run, log, { streamed: args.stream, sandbox: args.sandbox })) break;
    // Said out loud, because a run that quietly cost twice what the caller expected is the whole
    // risk of doing this automatically. Names the credential; never its value.
    console.log(`${credentialName(withKey)} could not run this — retrying with ${credentialName(plan[attempt + 1]!)}.`);
  }
  return { run, outFile, logs, attempt };
}

async function main(): Promise<void> {
  await loadRepoEnv();
  let args: Args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { fail((e as Error).message); }

  const prompt = args.promptFile ? readFileSync(resolve(args.promptFile), 'utf8') : args.prompt!;
  if (args.sandbox === REVIEW_PROFILE && !reviewProfileDefined(args.repoDir)) {
    fail(`--sandbox review needs a [permissions.review] table in ${join(resolve(args.repoDir), '.codex/config.toml')}`
      + ' — see docs/reusable/codex-cli-as-subagent.md § The review profile, or pass --sandbox read-only.');
  }
  // Fresh temp dir per run, so a run's -o file can never be a previous run's leftover.
  const tmpDir = mkdtempSync(join(tmpdir(), 'run-codex-'));
  const plan = authPlan(args.auth, Boolean(process.env[CODEX_SECRET]));

  if (args.dryRun) {
    const codexArgs = buildCodexArgs({ ...args, outFile: join(tmpDir, 'output-1.txt'), prompt });
    // The prompt is the last element, and with --prompt-file it can be arbitrarily large — a third
    // unbounded path to the caller's stdout, next to --stream and --print. Cap it like the answer.
    // The command stops being copy-pasteable at that size anyway (argv has its own limit), and
    // whoever wants the exact text has the file it came from.
    const shown = [...codexArgs.slice(0, -1), formatAnswer(prompt, args.maxPrintChars, args.promptFile ?? '(--prompt)')];
    // Which credential is a property of the child's environment rather than of the command line,
    // so an argv-only dry run would be silent about the half --auth controls. A comment line, so
    // the thing below it still pastes.
    console.log(`# auth ${args.auth}: ${plan.map(credentialName).join(', then ')}`);
    console.log(['codex', ...shown].join(' '));
    return;
  }

  const { run, outFile, logs, attempt } = await runPlan(args, prompt, tmpDir, plan);

  let logPath: string | undefined;
  if (logs.length) {
    logPath = args.activityLog
      ? resolve(args.activityLog)
      : (args.output ? `${resolve(args.output)}.activity.log` : join(tmpDir, 'activity.log'));
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, logs.join('\n'));
  }
  const hint = logPath ? `; activity log at ${logPath}` : '';

  // Fail closed, most-specific cause first. Every branch reports the *last* attempt: with a
  // fallback in play the earlier one failed on a credential we have already stopped using, and
  // sending somebody to top that up would point at the wrong account.
  if (run.spawnError) fail(`could not run codex (${run.spawnError.message}) — is the Codex CLI on PATH?${hint}`);
  if (run.overflowed) fail(`codex exec exceeded the 64 MiB capture cap and was killed${hint}`);
  if (run.timedOut) fail(`codex exec timed out after ${args.timeoutMinutes}m and was killed${hint}`);
  // Only here. A timeout or a capture overflow is not an account problem, and telling someone to
  // go and buy credits because a 30-minute run was killed sends them somewhere useless.
  if (run.status !== 0) {
    fail(`codex exec exited ${run.status ?? 'null'}${run.signal ? ` [${run.signal}]` : ''}`
      + `${hint}${accountNote(args, run, plan, attempt)}`);
  }
  // Exit 0 and nothing to show for it. Same note as the branch above, and this is the path that
  // most needs it: a run that died on a spent credential *and reported success* is the one place a
  // caller has nothing else to go on. Leaving it off here left it off the one documented case.
  if (!answerIsUsable(outFile)) {
    fail('codex exec exited 0 but wrote no answer — which is what running out of credit mid-run'
      + ` looks like${hint}${accountNote(args, run, plan, attempt)}`);
  }

  let answerPath = outFile;
  if (args.output) {
    answerPath = resolve(args.output);
    mkdirSync(dirname(answerPath), { recursive: true });
    copyFileSync(outFile, answerPath);
  }

  console.log(`Done — codex exec (${args.model}, ${args.effort}, ${args.sandbox}, ${credentialName(plan[attempt]!)}).`);
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
if (isMain(import.meta.url)) {
  main().catch((e) => fail((e as Error).message));
}
