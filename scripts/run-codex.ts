#!/usr/bin/env -S npx tsx
/**
 * run-codex.ts — the safe way to run `codex exec` as a subagent from another coding agent.
 *
 * Why a wrapper rather than calling `codex exec` directly: three failure modes are impossible here
 * *by construction*, so a caller can't forget the gotcha.
 *
 *   1. fd 0 is never inherited → codex gets an immediate EOF and never wedges on "Reading
 *      additional input from stdin...", which is what a bare `codex exec` does whenever it
 *      inherits an open pipe on fd 0 (i.e. every time an agent shells out to it). It is either
 *      closed or a **complete regular file**, and never a pipe: a file EOFs because it has an end,
 *      where a pipe EOFs only if a writer remembers. Measured — an unclosed pipe wedged for a full
 *      60 seconds and was SIGKILLed. See `ChildStdin` in subagent-cli.ts.
 *   2. The prompt travels down fd 0 from that file, and argv ends `-- -` → **there is no size a
 *      prompt can exceed.** It was a positional argument until 2026-09-08, and Linux caps a single
 *      argv element at `MAX_ARG_STRLEN` (128 KB), so an ordinary 138 KB review prompt died with
 *      `spawn E2BIG` before codex started — with no answer file, which is exactly what a *killed*
 *      run leaves too. The `--` still means a leading `-` is never read as a flag.
 *      docs/plans/260908g-run-codex-sends-a-large-prompt-on-stdin-instead-of-dying-at-execve.md.
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
 * `--prompt-file` is the interface for a prompt of any size. `--prompt` arrives in *this* script's
 * own argv, so it keeps the 128 KB ceiling — not through anything this wrapper does, and not
 * fixable from in here.
 *
 * The default sandbox is `review`: the tree read-only, the test caches writable — see SANDBOXES.
 * See docs/reusable/codex-cli-as-subagent.md for models, auth, and the read-only/write switch.
 */

import {
  chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isMain } from '../src/is-main.js';
import {
  answerIsUsable, type ChildStdin, elapsedSeconds, formatAnswer, loadRepoEnv, readAnswerForConsole,
  runChild, sameWriteTarget, sanitisedEnv, type RunResult,
} from './subagent-cli.js';

// Re-exported because tests/run-codex.test.ts asserts the truncation rules through this module,
// and because a caller who has this file has the whole wrapper.
export { formatAnswer, readAnswerForConsole };

/** Frontier tier. `gpt-5.6-terra` is the everyday middle, `gpt-5.6-luna` the cheap/fast one. */
const DEFAULT_MODEL = 'gpt-5.6-sol';
/** `xhigh` for a hard review, `low` for mechanical work; see EFFORTS for the whole vocabulary. */
const DEFAULT_EFFORT = 'high';
const DEFAULT_TIMEOUT_MINUTES = 30;
/**
 * `review` is the default: the tree is read-only exactly as under `read-only`, but `/tmp` and the
 * caches under `node_modules` are writable, so the reviewer can run one test file or a tsx script
 * and reproduce a finding rather than reason about it — *a test that needs nothing outside the
 * tree*, since the profile grants no network at all, not even loopback, so anything touching
 * Postgres or a local service is the orchestrator's to run and hand over. Under plain `read-only`,
 * measured on
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
/**
 * The spellings codex is known to take — a vocabulary, not a per-model compatibility check, which
 * this cannot be: the enum differs by model. Measured 2026-09-07 on 0.153.4, one probe per value:
 * `gpt-5.6-sol` accepts `none` and `gpt-6-astra` rejects it, both reject `minimal`, and both
 * complete a run at `max` and at `ultra`. `ultra` is absent from the enum a rejection quotes yet
 * runs, so something upstream maps or ignores it — the probes don't say which, or what it costs.
 *
 * So this catches a *typo* for nothing, before a spawn, and codex catches the mismatch: a value the
 * chosen model refuses comes back as a 400 naming the ones it takes. That 400 is new. The same
 * misspelling was silent on 0.146.0 (2026-08-24) — it parsed as a good TOML string and the run
 * proceeded at the model's own default effort — which is why this check exists at all.
 */
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
/** ~5k tokens. Big enough for any real review, small enough that a runaway answer can't flood a
 * calling agent's context — which is the whole point of this wrapper. */
const DEFAULT_MAX_PRINT_CHARS = 20_000;
/** The one credential codex is entitled to, and the only one that crosses by default. */
const CODEX_SECRET = 'CODEX_API_KEY';

/**
 * The environment codex gets: everything except the variables whose *names* say they hold a
 * credential, plus `CODEX_API_KEY` when this attempt is meant to spend it. The sweep itself is
 * [`subagent-cli.ts`](subagent-cli.ts) § `sanitisedEnv`, shared with the Claude wrapper.
 *
 * `useCodexKey: false` withholds even that one, which is how `--auth subscription-first` reaches
 * `~/.codex/auth.json`: codex prefers the variable whenever it is set, so the only way to ask for
 * the subscription is not to hand the key over.
 */
export function childEnv(
  parent: NodeJS.ProcessEnv, passThrough: string[] = [], useCodexKey = true,
): NodeJS.ProcessEnv {
  return sanitisedEnv(parent, useCodexKey ? [CODEX_SECRET, ...passThrough] : passThrough);
}

/** `codex exec`, with the shared spawn's three guarantees: no stdin, a real watchdog, a capture cap. */
export function runCodex(opts: {
  argv: string[]; timeoutMs: number; stream: boolean; bin?: string; env?: NodeJS.ProcessEnv;
  /**
   * Where the prompt comes from. Defaults to closed, which is what every call that has no prompt
   * wants — the timeout and kill-tree tests, and anything probing the binary.
   */
  stdin?: ChildStdin;
}): Promise<RunResult> {
  return runChild({
    bin: opts.bin ?? 'codex',
    argv: opts.argv,
    timeoutMs: opts.timeoutMs,
    stream: opts.stream,
    env: opts.env ?? childEnv(process.env),
    stdin: opts.stdin ?? { kind: 'closed' },
  });
}

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
  // A typo costs nothing here; codex catches the rest. See EFFORTS for what each side now owns.
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
/**
 * **The prompt is NOT in here, and that is the fix rather than an omission.**
 *
 * It used to be the last element, after `--`. Linux caps a *single* argv element at
 * `MAX_ARG_STRLEN` — 32 pages, 128 KB — so `--prompt-file` with an ordinary code-review prompt
 * (measured: 138 KB, 2,993 lines) died with `spawn E2BIG` before codex started. The failure came
 * with no answer file, which is indistinguishable from a killed run, and the flag's own name
 * promised the file was what travelled.
 *
 * So argv ends with `--`, `-`: the `--` still means "everything after this is positional" and the
 * `-` is codex's documented sentinel for *read the instructions from stdin*. The prompt goes down
 * fd 0 from a complete regular file — see {@link ChildStdin} and
 * docs/plans/260908g-…-execve.md.
 *
 * **`-` must be the only positional.** `codex exec --help`: if stdin is piped *and* a prompt is
 * given, stdin is appended as a `<stdin>` block — so passing both would silently send the prompt
 * twice. `tests/run-codex.test.ts` asserts argv ends exactly this way.
 */
export function buildCodexArgs(o: {
  model: string; effort: string; sandbox: string; repoDir: string; outFile: string;
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
    '--',              // ends flag parsing, so the `-` below is a positional and not a flag
    '-',               // codex's sentinel: read the instructions from stdin
  ];
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
 * The failure whose message points at the wrong thing.
 *
 * Codex reads a repo's `.codex/config.toml` only for a **trusted project** — a
 * `[projects."<abs path>"]` entry with `trust_level = "trusted"` in `$CODEX_HOME/config.toml`,
 * naming that directory or one above it. Everywhere else it skips the file in silence: a
 * deliberately corrupt config in an untrusted directory raises nothing at all. So in a checkout
 * nobody has trusted yet — a fresh clone on the box, a new machine — `-c default_permissions=review`
 * dies with `default_permissions requires a [permissions] table` while the table is sitting right
 * there, and `reviewProfileDefined()` above has already read it and agreed that it is. Measured
 * 2026-09-05 on 0.153.4. Trust is inherited, so one entry covers a checkout's worktrees.
 *
 * Read off codex's own error rather than by re-implementing its trust resolution: the entry may
 * live under a different `CODEX_HOME`, or on a directory above the checkout, and a reimplementation
 * that drifted would refuse runs that work. This fails closed — no error line, no note.
 *
 * Anchored to the `Error:` line for the reason authHint gives: the log is mostly the contents of
 * the files codex read, and this repo's own docs quote this string. They quote it *without* the
 * `Error:` prefix on purpose, so an activity log that has read them cannot manufacture this note.
 */
export function untrustedCheckoutHint(log: string, sandbox: string, repoDir: string): string {
  if (sandbox !== REVIEW_PROFILE || !reviewProfileDefined(repoDir)) return '';
  const errors = log.split('\n').filter((l) => /^\s*Error\b/i.test(l)).join('\n');
  if (!/default_permissions requires/i.test(errors)) return '';
  const dir = resolve(repoDir);
  return `\n  The [permissions.review] table IS in ${join(dir, '.codex/config.toml')} — codex never read it.`
    + ' A project config is loaded only for a trusted project, so add this to ~/.codex/config.toml'
    + ' (or $CODEX_HOME/config.toml) and re-run — a checkout\'s subdirectories and worktrees inherit'
    + ` it:\n\n    [projects."${dir}"]\n    trust_level = "trusted"`;
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
async function runPlan(args: Args, promptPath: string, tmpDir: string, plan: boolean[]): Promise<{
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
    /**
     * **A FRESH FD PER ATTEMPT, and this is the trap in the whole change.**
     *
     * An fd carries a file offset, and the child shares it. The first codex reads the prompt to
     * EOF and leaves the offset there — so a second attempt handed the same fd reads **nothing**,
     * and codex is asked to review an empty instruction. It would not error; it would answer
     * something, and the retry that exists to rescue a credential failure would quietly become a
     * review of no code at all.
     *
     * Nothing about that looks wrong from out here: exit 0, an answer file, a plausible reply.
     * GPT Sol's design review caught it before it was written, and `tests/run-codex.test.ts`
     * pins it with a two-attempt stand-in that verifies stdin on both.
     */
    const promptFd = openSync(promptPath, 'r');
    try {
      run = await runCodex({
        argv: buildCodexArgs({ ...args, outFile }),
        timeoutMs: args.timeoutMinutes * 60_000,
        stream: args.stream,
        env: childEnv(process.env, args.passEnv, withKey),
        stdin: { kind: 'file', fd: promptFd },
      });
    } finally {
      // `finally`, because a throw here would otherwise leak one fd per attempt for the life of
      // the process — and the process is a wrapper that may be waiting 45 minutes.
      closeSync(promptFd);
    }
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

/**
 * **The prompt, as a file this wrapper owns, whichever flag it arrived on.**
 *
 * One shape for both inputs, because two invocation paths would mean two sets of semantics
 * depending on which flag somebody used — and the rare one is always the one with the latent bug.
 * GPT Sol's design review: *"retaining a second Codex invocation path buys little"*.
 *
 * `--prompt-file` is **copied byte for byte** rather than read and re-written: decoding to a
 * string and re-encoding would silently normalise anything that is not well-formed UTF-8, and the
 * one guarantee worth having here is that codex sees the bytes the caller wrote.
 *
 * `0600`, and inside the run's own `mkdtemp` directory: a prompt is often the most sensitive thing
 * in a run — it can carry a diff of unreleased work — and it sits on a box shared by ~27 agent
 * sessions under one Unix user.
 */
function writePromptSnapshot(args: Args, tmpDir: string): string {
  const path = join(tmpDir, 'prompt.txt');
  if (args.promptFile) copyFileSync(resolve(args.promptFile), path);
  else writeFileSync(path, args.prompt!, { encoding: 'utf8', mode: 0o600 });
  /* `copyFileSync` keeps the SOURCE's mode, which may be world-readable, so the tighten happens
     after the copy rather than instead of it. */
  chmodSync(path, 0o600);
  return path;
}

async function main(): Promise<void> {
  await loadRepoEnv();
  let args: Args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { fail((e as Error).message); }

  /* Read for the size check and the dry run only. The bytes that reach codex are the snapshot's,
     written below — see writePromptSnapshot. */
  const prompt = args.promptFile ? readFileSync(resolve(args.promptFile), 'utf8') : args.prompt!;
  if (args.sandbox === REVIEW_PROFILE && !reviewProfileDefined(args.repoDir)) {
    fail(`--sandbox review needs a [permissions.review] table in ${join(resolve(args.repoDir), '.codex/config.toml')}`
      + ' — see docs/reusable/codex-cli-as-subagent.md § The review profile, or pass --sandbox read-only.');
  }
  // Fresh temp dir per run, so a run's -o file can never be a previous run's leftover.
  const tmpDir = mkdtempSync(join(tmpdir(), 'run-codex-'));
  // `--output x --activity-log x` wrote the answer over the log, exited 0, and printed both paths.
  // This wrapper never had the check at all; it arrived here with the Claude one, and the shared
  // helper asks the filesystem rather than comparing strings. GPT Sol's F13, 2026-09-06.
  if (args.output && args.activityLog && sameWriteTarget(args.output, args.activityLog)) {
    fail(`--output and --activity-log are the same file (${resolve(args.output)}); the second write`
      + ' would destroy the first');
  }
  const plan = authPlan(args.auth, Boolean(process.env[CODEX_SECRET]));

  if (args.dryRun) {
    const codexArgs = buildCodexArgs({ ...args, outFile: join(tmpDir, 'output-1.txt') });
    /* **The command is now the whole command**, because the prompt is not in it — argv ends `-- -`
       and the prompt arrives on fd 0. So this prints something that genuinely pastes, and says
       separately where the bytes come from and how many there are.

       It used to `slice(0, -1)` and substitute a capped rendering of the prompt, which was honest
       about the size but produced a line that could not be run. A dry run whose output is not
       runnable is a description of a command rather than the command. */
    const shown = codexArgs;
    // Which credential is a property of the child's environment rather than of the command line,
    // so an argv-only dry run would be silent about the half --auth controls. A comment line, so
    // the thing below it still pastes.
    console.log(`# auth ${args.auth}: ${plan.map(credentialName).join(', then ')}`);
    /* The `-` at the end reads the prompt from fd 0, so the pasteable form needs a redirect. A
       file, never a pipe: see ChildStdin for the sixty seconds that cost. */
    const source = args.promptFile ? resolve(args.promptFile) : '<a temp file this wrapper writes>';
    console.log(`# stdin: ${source} (${Buffer.byteLength(prompt)} bytes)`);
    console.log(`${['codex', ...shown].join(' ')} < ${args.promptFile ? resolve(args.promptFile) : 'prompt.txt'}`);
    return;
  }

  // Measured, so a timeout error can quote the clock rather than the flag it was given.
  const startedAt = Date.now();
  const { run, outFile, logs, attempt } = await runPlan(args, writePromptSnapshot(args, tmpDir), tmpDir, plan);

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
  // The elapsed time rather than the flag: the two are the same number only when the kill lands on
  // schedule, and the whole point of docs/postmortems/260906e-* is that it may not.
  if (run.timedOut) {
    fail(`codex exec was killed after ${elapsedSeconds(startedAt)} (--timeout-minutes ${args.timeoutMinutes})${hint}`);
  }
  // Only here. A timeout or a capture overflow is not an account problem, and telling someone to
  // go and buy credits because a 30-minute run was killed sends them somewhere useless.
  if (run.status !== 0) {
    fail(`codex exec exited ${run.status ?? 'null'}${run.signal ? ` [${run.signal}]` : ''}`
      + `${hint}${accountNote(args, run, plan, attempt)}`
      + untrustedCheckoutHint(args.stream ? '' : combinedLog(run), args.sandbox, args.repoDir));
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
