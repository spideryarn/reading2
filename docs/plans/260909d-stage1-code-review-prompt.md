# Review Stage 1 of the `overseer` CLI: Commander, generated usage rows, and `mine`

You are GPT Sol, doing a **cross-family code review**. Be adversarial and concrete. The diff is at
the bottom; read the real files in the repo too, because the diff cannot show you what still calls
the code that moved.

## What this is and why it exists

The **Overseer** is a permanently-running Claude Code session that supervises a fleet of 20–35 coding
agents on this box. Its runbook is `docs/project/overseer.md` — read it. Every recipe it runs
regularly is today a hand-typed chain of shell inside one context window, and those chains drift:
four decision-log timestamps were written in BST instead of UTC on the morning of 2026-09-09 because
one used `date` rather than `date -u`. The plan
(`docs/plans/260909d-a-rich-overseer-cli-the-overseers-regular-recipes-one-command-each.md`) turns
each recipe into a subcommand of `scripts/overseer.ts`.

**This is Stage 1 only.** It does three things:

1. Adds `commander` and converts `scripts/overseer.ts`'s hand-rolled argv parsing (`indexOf`,
   `argv.includes`, a `switch` on `argv[0]`) to it. The sibling tool `gjd-remote` chose Commander
   the same morning on your own advice; one parser in the repo is the rule
   (`docs/reusable/third-party-library-selection.md`).
2. Keeps the root help as hand-written prose with **generated usage rows** read back out of
   Commander's registered command objects (`tools/overseer/cli-help.ts`), so a flag cannot be added
   to a command and missed from the help.
3. Adds `overseer mine [list] | add <name> | rm <name>` — the list of sessions the Overseer is
   looking after, in `~/.overseer/cli-state.json` (`tools/overseer/cli-state.ts`). Later stages
   (`tick`, `closeout`, `dispatch`) read and write it.

Repo conventions that bear on this:
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` are all on. Absent and
  `undefined` are different things and the daemon's options object depends on the difference.
- `console.log` from a CLI, `src/log.ts` from a server — the rule is the destination.
- `docs/reusable/silent-success.md`: most of this repo's worst bugs were something reporting success
  while doing nothing, with the obvious check agreeing because it shared an assumption with the code.
- Comments say *why*, not *what*.

## What I want you to attack

Rank findings P0 (must fix before this lands) / P1 (should) / P2 (opinion). For each, name the file
and line, say what concretely goes wrong, and what you would do instead.

1. **Did the conversion change behaviour anywhere it should not have?** This is the finding I most
   want. `run`, `status`, `events`, `notes`, `usage`, `attention` and `reconcile-jobs` all existed
   before and the daemon (`overseer run`) is a live service on this box under systemd. Compare the
   old parsing against the new for every flag: defaults, absence-vs-undefined, `--no-attention` /
   `--no-usage` (now Commander's negation form — is `parsed.attention` true when neither is given,
   and does the "OPENROUTER_API_KEY is not set" message still fire on the right branch?), exit
   codes, and what is printed on stderr vs stdout.

2. **`parseArgv`'s error path.** It calls `program.parse(...)` inside a `try`, captures Commander's
   output into a string, and returns `{kind:"error"}`. Is the `written.trim() === "" ? why : written`
   fallback right, or can a real error message be lost? What does `exitOverride` throw for
   `--help` on a *subcommand* (e.g. `overseer usage --help`), and does that currently come back as
   an error with exit code 1 when it should be help with exit code 0? I think this is a real bug;
   confirm or refute it and say exactly what the user sees.

3. **Output capture.** `configureOutput` is applied recursively after the program is built, because
   a Commander subcommand copies its parent's settings *at creation*. Is the recursion complete? Is
   there any path on which Commander writes to the real stdout/stderr from inside `parseArgv` —
   `outputError`, `showHelpAfterError`, `writeErr` on a nested group like `mine add`? There is a
   test (`parsing writes nothing to the real streams`) that swaps `process.stdout.write`; say
   whether it actually covers what it claims.

4. **`cli-state.ts` and the `absent` / `unusable` split.** The claim is that a file this build
   cannot parse must never be read as an empty list, because that would hand `closeout` an empty
   list and then overwrite the real one. Check every path: `readCliState`, `cliStateForWriting`,
   `runMine`. Is there any route on which unparseable bytes end up replaced? Is the strictness too
   strict — a single unrecognised field making the whole file unusable means the Overseer is locked
   out of its own list until somebody edits JSON by hand. Which way should that go, and why?

5. **The write.** `writeCliState` writes `${path}.${pid}.tmp` and renames. Two concurrent
   `overseer mine add` runs: the plan accepts last-writer-wins and explicitly rejects a lock, on the
   grounds that a lock in the Overseer's own tooling is a thing that can wedge the Overseer. Is that
   acceptable here, given what the list is for? Is there a cheaper middle (O_EXCL, a retry, an
   append-only log)? Note the daemon holds a lock on that same directory for its own files
   (`tools/overseer/lock.ts`, `store.ts`) — does a second unlocked file in there create a problem?

6. **`whyNotASessionName` imports `NAME_RULE` from `tools/fleet/routes-rename.ts`**, an HTTP route
   module. That module's own comment says it restated the regex rather than importing
   `scripts/gjd-remote.ts` to avoid dragging a CLI into a web server. Is importing it the other way
   round a problem — import side effects, module weight, or the seam that
   `tests/fleet-attention.test.ts` enforces between `tools/overseer/` and `tools/fleet/`?

7. **The tests.** Which assertion here would still pass if the thing it names were broken? Name the
   specific mutation each test does *not* catch. I mutation-checked exactly one thing
   (`cliStateForWriting` returning empty on `unusable` → two tests red); tell me what else should
   have been checked and was not.

8. **Anything in the diff that is over-built, or that a later stage will have to undo.**

Also: **check my conclusions, not only my reasoning.** The plan's Stage 1 section lists four things
"the plan did not know". If any of those four is wrong, say so.

## Evidence

Tests run, in this worktree, all green:

```
$ npx vitest run tests/overseer-cli.test.ts tests/overseer-cli-parse.test.ts \
    tests/overseer-cli-state.test.ts tests/overseer-standing-jobs.test.ts \
    tests/overseer-rules.test.ts tests/overseer-store-attention.test.ts \
    tests/gjd-remote-overseer-claim.test.ts tests/overseer-daemon.test.ts \
    tests/overseer-schedules.test.ts
 Test Files  9 passed (9)
      Tests  309 passed (309)
   Duration  10.39s

$ npm run typecheck
✓ src/web/tsconfig.json  (344 files)
✓ tests/tsconfig.json  (1775 files)
✓ tools/fleet/web/tsconfig.json  (71 files)
✓ tsconfig.json  (556 files)
EXIT=0
```

Real CLI, against the live store, read-only:

```
$ npx tsx scripts/overseer.ts --help | head -13
overseer — the fleet's history, and the daemon that records it

  npx tsx scripts/overseer.ts status
  npx tsx scripts/overseer.ts events [--limit <n>]
  npx tsx scripts/overseer.ts notes [--limit <n>]
  npx tsx scripts/overseer.ts attention [--max-calls <n>] [--dry] [--json] [--write] [--out <file>] [--panes <dir>] [--capture-to <dir>]
  npx tsx scripts/overseer.ts usage [--since-hours <n>] [--max-transcripts <n>] [--json]
  npx tsx scripts/overseer.ts reconcile-jobs --why <what you checked>
  npx tsx scripts/overseer.ts mine list
  npx tsx scripts/overseer.ts mine add <name>
  npx tsx scripts/overseer.ts mine rm <name>
  npx tsx scripts/overseer.ts run [--url <url>] [--tick-ms <n>] [--no-attention] [--no-usage]

$ npx tsx scripts/overseer.ts events --limit nope >/dev/null 2>&1; echo $?
1
$ npx tsx scripts/overseer.ts --help >/dev/null 2>&1; echo $?
0
```

`npx biome lint` on the touched files: 14 infos, all `useLiteralKeys` and
`noExcessiveCognitiveComplexity`, matching the file's existing baseline. No errors.

## The diff

```diff
commit 0fe613bfa780e26a40472156a2bd7c4b39262fe5
Author: Greg Detre <greg@gregdetre.com>
Date:   Wed Sep 9 08:52:57 2026 +0100

    overseer CLI stage 1: Commander, generated usage rows, and the `mine` list
    
    The Overseer's regular recipes are hand-typed shell chains living in one context
    window, and they drift — four decision-log timestamps were written in BST this
    morning. This is the first stage of turning each into a subcommand with a test.
    
    Commander, because gjd-remote adopted it this morning on Sol's advice and one
    parser in the repo is the rule (docs/reusable/third-party-library-selection.md).
    Its shape is copied too: Commander owns grammar and metadata, the prose root
    help stays hand-written, and the usage rows are read back out of the registered
    commands so a flag cannot be added to a command and missed from the help.
    
    Converting the existing seven subcommands rather than bolting a second parser
    beside them closed three latent bugs, none of which anything could have caught:
    a misspelled flag was a silent no-op, `--limit nope` was NaN and `--limit 0` was
    a bound that selected nothing. There was no test of argv at all before this;
    tests/overseer-cli-parse.test.ts is that test.
    
    `mine` is the list the later subcommands read — in the bash specimen it was a
    grep alternation typed into the script, so a session dispatched at 3am was
    invisible to the next tick. It lives in ~/.overseer/cli-state.json, beside the
    store rather than in it, because the daemon is the store's single writer.
    
    An unreadable state file is refused, never read as an empty list: answering
    "nothing is mine" to bytes we cannot parse would hand closeout an empty list and
    then overwrite the real one. Mutation-checked — making cliStateForWriting return
    an empty state on `unusable` turns two tests red.
    
    Plan: docs/plans/260909d-a-rich-overseer-cli-the-overseers-regular-recipes-one-command-each.md
    
    Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012vyvBUV6fUswG8gvtHfiSd

diff --git a/package.json b/package.json
index fda5a857..c1cb7286 100644
--- a/package.json
+++ b/package.json
@@ -92,6 +92,7 @@
     "@tanstack/react-table": "^8.21.3",
     "class-variance-authority": "^0.7.1",
     "clsx": "^2.1.1",
+    "commander": "^15.0.0",
     "d3-force": "^3.0.0",
     "dompurify": "^3.4.14",
     "drizzle-orm": "0.45.2",
diff --git a/scripts/overseer.ts b/scripts/overseer.ts
index 06787024..101d8825 100644
--- a/scripts/overseer.ts
+++ b/scripts/overseer.ts
@@ -29,6 +29,19 @@ import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
 import { isAbsolute, join } from "node:path";
 import { fileURLToPath } from "node:url";
 
+import { Command, InvalidArgumentError } from "commander";
+
+import { renderRootHelp } from "../tools/overseer/cli-help.js";
+import {
+  addMine,
+  cliStateForWriting,
+  cliStatePath,
+  readCliState,
+  removeMine,
+  whyNotASessionName,
+  writeCliState,
+} from "../tools/overseer/cli-state.js";
+
 import { attentionRunner, DEFAULT_MAX_CALLS, runAttentionCommand } from "../tools/overseer/attention-cli.js";
 import {
   runOverseer,
@@ -811,32 +824,45 @@ function whenEpoch(ms: number): string {
   return when(new Date(ms).toISOString());
 }
 
-const HELP = [
-  "overseer — the fleet's history, and the daemon that records it",
-  "",
-  "  npx tsx scripts/overseer.ts run [--url URL] [--tick-ms N] [--no-attention] [--no-usage]",
-  "  npx tsx scripts/overseer.ts status",
-  "  npx tsx scripts/overseer.ts reconcile-jobs --why '<what you checked>'",
-  "  npx tsx scripts/overseer.ts events [--limit N]",
-  "  npx tsx scripts/overseer.ts notes [--limit N]",
-  "  npx tsx scripts/overseer.ts usage [--since-hours N] [--max-transcripts N] [--json]",
-  "  npx tsx scripts/overseer.ts attention [--max-calls N] [--dry] [--json]",
-  "                                        [--capture-to DIR | --panes DIR] [--out FILE] [--write]",
-  "",
+/** How the usage rows name this script, and what a person types. */
+const INVOCATION = "npx tsx scripts/overseer.ts";
+
+/**
+ * The paragraphs the parser cannot generate.
+ *
+ * Everything here is a thing Commander does not know: what a command costs, who
+ * decides whether it is armed, and which of two similar-looking switches is the
+ * one that spends money. The usage rows between them come out of the registered
+ * commands — `tools/overseer/cli-help.ts` says why the two halves are split.
+ */
+const HELP_PROSE_AFTER: readonly string[] = [
   `The store is $OVERSEER_STORE_DIR, or ~/.overseer. The dashboard is ${DEFAULT_FLEET_URL} unless --url says otherwise.`,
-  "",
-  "`attention` reads every live pane and says what needs Greg. --dry makes no model calls and no",
-  "paid pass. It does NOT write the store's memory unless you pass --write: the daemon holds the",
-  "lock and this command does not honour it, so two writers is the default you do not want.",
-  "",
-  `THE SCHEDULER IS OFF unless ${JOBS_ENABLED_VAR}=1. Armed, it dispatches the standing jobs in`,
-  "docs/project/overseer.md as real Claude sessions on this box, so turning it on is Greg's",
-  "decision and not a side effect of starting the daemon. `status` says which it is.",
-  "",
-  `${RULES_ENABLED_VAR}=1 is the OTHER arming: the deterministic rules and nothing else. A daemon`,
-  "started that way is handed no session dispatcher at all, so it cannot start a Claude session and",
-  "cannot spend anything. It is the switch to use to watch a rule fire.",
-].join("\n");
+  [
+    "`attention` reads every live pane and says what needs Greg. --dry makes no model calls and no",
+    "paid pass. It does NOT write the store's memory unless you pass --write: the daemon holds the",
+    "lock and this command does not honour it, so two writers is the default you do not want.",
+  ].join("\n"),
+  [
+    `THE SCHEDULER IS OFF unless ${JOBS_ENABLED_VAR}=1. Armed, it dispatches the standing jobs in`,
+    "docs/project/overseer.md as real Claude sessions on this box, so turning it on is Greg's",
+    "decision and not a side effect of starting the daemon. `status` says which it is.",
+  ].join("\n"),
+  [
+    `${RULES_ENABLED_VAR}=1 is the OTHER arming: the deterministic rules and nothing else. A daemon`,
+    "started that way is handed no session dispatcher at all, so it cannot start a Claude session and",
+    "cannot spend anything. It is the switch to use to watch a rule fire.",
+  ].join("\n"),
+];
+
+/** The root help, rows and all. A function because the rows come from the program. */
+export function help(): string {
+  return renderRootHelp({
+    program: buildProgram(),
+    prefix: INVOCATION,
+    title: "overseer — the fleet's history, and the daemon that records it",
+    after: HELP_PROSE_AFTER,
+  });
+}
 
 /**
  * **What the daemon will be given as a scheduler, and whether it is armed.**
@@ -953,53 +979,324 @@ function fleetUrl(env: NodeJS.ProcessEnv): string {
   return env["OVERSEER_FLEET_URL"] ?? DEFAULT_FLEET_URL;
 }
 
-function flag(argv: readonly string[], name: string): string | undefined {
-  const at = argv.indexOf(name);
-  return at === -1 ? undefined : argv[at + 1];
+/**
+ * A positive finite number, or a refusal Commander turns into a usage error.
+ *
+ * **The refusal is the whole point of the function.** `Number("nope")` is `NaN`,
+ * `Number("")` is `0` and `Number(undefined)` is `NaN` — all of which used to
+ * sail through `Number(flag(argv, …) ?? default)` and silently disable the bound
+ * they were meant to set (GPT Sol's finding 10 on the earlier hand-rolled
+ * parser). A flag that quietly does the opposite of what it says is worse than
+ * no flag.
+ *
+ * `integer` is separate because some of these are COUNTS. `--max-transcripts
+ * 0.5` passed the positive check and then `slice(0, 0.5)` selected zero
+ * transcripts: a flag that reads as "scan at most half a file" and behaves as
+ * "scan nothing". `--since-hours` stays fractional on purpose; half an hour is
+ * a sensible window.
+ */
+export function positiveNumber(name: string, opts: { integer?: boolean } = {}): (raw: string) => number {
+  return (raw: string): number => {
+    const value = Number(raw);
+    if (raw.trim() === "" || !Number.isFinite(value) || value <= 0) {
+      throw new InvalidArgumentError(`${name} must be a positive number, got ${JSON.stringify(raw)}`);
+    }
+    if (opts.integer === true && !Number.isInteger(value)) {
+      throw new InvalidArgumentError(`${name} counts whole things, so it must be a whole number, got ${JSON.stringify(raw)}`);
+    }
+    return value;
+  };
+}
+
+/**
+ * **What the command line MEANT**, separated from doing it.
+ *
+ * A discriminated union rather than the `argv` array the bodies below used to
+ * re-scan for themselves. Two things fall out of that, and the second is why it
+ * is worth a type:
+ *
+ * - **A test can ask what a command line parses to** without a store, a
+ *   dashboard or a daemon. There was no such test before, because there was
+ *   nothing to ask.
+ * - **A flag that is not read cannot be spelled.** `--max-transcipts` used to
+ *   be a silent no-op; now it is an unknown option and Commander says so.
+ *
+ * Absent is absent: the optional fields here are genuinely missing rather than
+ * `undefined`, because `exactOptionalPropertyTypes` tells those apart and the
+ * daemon's options object depends on the difference.
+ */
+export type Parsed =
+  | { command: "status" }
+  | { command: "events"; limit: number }
+  | { command: "notes"; limit: number }
+  | {
+      command: "attention";
+      maxCalls: number;
+      dry: boolean;
+      json: boolean;
+      write: boolean;
+      out: string | null;
+      panes: string | null;
+      captureTo: string | null;
+    }
+  | { command: "usage"; json: boolean; sinceHours?: number; maxTranscripts?: number }
+  | { command: "reconcile-jobs"; why: string }
+  | { command: "run"; attention: boolean; usage: boolean; url?: string; tickMs?: number }
+  | { command: "mine"; action: "list" }
+  | { command: "mine"; action: "add" | "rm"; name: string };
+
+/**
+ * The grammar, and nothing else — no store is opened and no environment is read
+ * while this is built, so `help()` can build one purely to print its rows.
+ *
+ * Every action does one thing: hand its parsed shape to `sink`. The work is in
+ * `runParsed`. Commander is the parser here and not the program.
+ */
+export function buildProgram(sink: (parsed: Parsed) => void = () => {}): Command {
+  const program = new Command();
+  program
+    .name("overseer")
+    // Commander's own help would be a reference page; ours is a briefing with
+    // generated rows in it. `help()` is the renderer, and this is what `-h` and
+    // an unknown command both print.
+    .helpOption(false)
+    .addHelpCommand(false)
+    .exitOverride();
+
+  program.command("status").description("is the daemon alive, and what does it know").action(() => sink({ command: "status" }));
+
+  program
+    .command("events")
+    .description("what the fleet did")
+    .option("--limit <n>", "how many to print", positiveNumber("--limit", { integer: true }), 40)
+    .action((opts: { limit: number }) => sink({ command: "events", limit: opts.limit }));
+
+  program
+    .command("notes")
+    .description("what the Overseer's own day was like")
+    .option("--limit <n>", "how many to print", positiveNumber("--limit", { integer: true }), 40)
+    .action((opts: { limit: number }) => sink({ command: "notes", limit: opts.limit }));
+
+  program
+    .command("attention")
+    .description("read every live pane and say what needs Greg")
+    .option("--max-calls <n>", "bound on paid model calls", positiveNumber("--max-calls", { integer: true }), DEFAULT_MAX_CALLS)
+    .option("--dry", "no model calls and no paid pass", false)
+    .option("--json", "the list as JSON", false)
+    .option("--write", "write the store's memory (the daemon holds its lock; you do not)", false)
+    .option("--out <file>", "write the list here")
+    .option("--panes <dir>", "read captured panes from here instead of tmux")
+    .option("--capture-to <dir>", "capture live panes into here first")
+    .action((opts: { maxCalls: number; dry: boolean; json: boolean; write: boolean; out?: string; panes?: string; captureTo?: string }) =>
+      sink({
+        command: "attention",
+        maxCalls: opts.maxCalls,
+        dry: opts.dry,
+        json: opts.json,
+        write: opts.write,
+        out: opts.out ?? null,
+        panes: opts.panes ?? null,
+        captureTo: opts.captureTo ?? null,
+      }),
+    );
+
+  program
+    .command("usage")
+    .description("how close the shared account is to a limit")
+    .option("--since-hours <n>", "how far back to scan", positiveNumber("--since-hours"))
+    .option("--max-transcripts <n>", "how many transcripts to read", positiveNumber("--max-transcripts", { integer: true }))
+    .option("--json", "the report as JSON", false)
+    .action((opts: { sinceHours?: number; maxTranscripts?: number; json: boolean }) =>
+      sink({
+        command: "usage",
+        json: opts.json,
+        ...(opts.sinceHours === undefined ? {} : { sinceHours: opts.sinceHours }),
+        ...(opts.maxTranscripts === undefined ? {} : { maxTranscripts: opts.maxTranscripts }),
+      }),
+    );
+
+  program
+    .command("reconcile-jobs")
+    .description("clear a held occurrence ledger, once, with a reason")
+    // MANDATORY, not defaulted. This clears a hold that exists because nobody
+    // can tell whether some job already ran, and the reason goes into the store
+    // for whoever later asks why a job ran twice.
+    .requiredOption("--why <what you checked>", "what you looked at before deciding")
+    .action((opts: { why: string }) => sink({ command: "reconcile-jobs", why: opts.why }));
+
+  // THE LIST THE OTHER SUBCOMMANDS READ. One noun, three verbs, and `mine` with
+  // no verb lists — the brief asked for `ls-mine` as well, and two spellings for
+  // one noun is the drift this CLI exists to remove.
+  const mine = program.command("mine").description("the sessions this Overseer is looking after");
+  mine.command("list", { isDefault: true }).description("print them").action(() => sink({ command: "mine", action: "list" }));
+  mine
+    .command("add")
+    .argument("<name>", "a session name")
+    .description("start looking after one")
+    .action((name: string) => sink({ command: "mine", action: "add", name }));
+  mine
+    .command("rm")
+    .argument("<name>", "a session name")
+    .description("stop looking after one")
+    .action((name: string) => sink({ command: "mine", action: "rm", name }));
+
+  program
+    .command("run")
+    .description("the daemon")
+    .option("--url <url>", "the dashboard to collect from")
+    .option("--tick-ms <n>", "how often to collect", positiveNumber("--tick-ms", { integer: true }))
+    // `--no-x` is Commander's negation form: the option is `attention`, default
+    // true, and `--no-attention` turns it off. Same switch, same spelling, and
+    // now the parser rather than an `argv.includes` knows about it.
+    .option("--no-attention", "do not run the paid attention pass")
+    .option("--no-usage", "do not scan for usage limits")
+    .action((opts: { url?: string; tickMs?: number; attention: boolean; usage: boolean }) =>
+      sink({
+        command: "run",
+        attention: opts.attention,
+        usage: opts.usage,
+        ...(opts.url === undefined ? {} : { url: opts.url }),
+        ...(opts.tickMs === undefined ? {} : { tickMs: opts.tickMs }),
+      }),
+    );
+
+  return program;
 }
 
 /**
- * A numeric flag that must be a positive finite number, or an explicit refusal.
+ * A command line in, one of three answers out.
  *
- * Three arms rather than `number | undefined`, because "not given" and "given
- * as nonsense" have to lead to different behaviour: the first takes the
- * default, the second must stop. `Number("nope")` is `NaN`, `Number("")` is 0
- * and `Number(undefined)` is `NaN` — all of which used to sail through and
- * silently disable the bound they were meant to set.
+ * `help` is a request, not a failure, and exits 0; `error` is a refusal and
+ * exits 1 with the same prose help underneath it, because a person who typed a
+ * flag wrong is exactly the person who needs the rows.
  */
-function positiveNumberFlag(
-  argv: readonly string[],
-  name: string,
-  opts: { integer?: boolean } = {},
-): { kind: "absent" } | { kind: "value"; value: number } | { kind: "invalid"; why: string } {
-  const at = argv.indexOf(name);
-  if (at === -1) return { kind: "absent" };
-  const raw = argv[at + 1];
-  if (raw === undefined || raw.startsWith("--")) return { kind: "invalid", why: `${name} needs a number after it` };
-  const value = Number(raw);
-  if (!Number.isFinite(value) || value <= 0) {
-    return { kind: "invalid", why: `${name} must be a positive number, got ${JSON.stringify(raw)}` };
+export type ParseOutcome =
+  | { kind: "run"; parsed: Parsed }
+  | { kind: "help" }
+  | { kind: "error"; why: string };
+
+export function parseArgv(argv: readonly string[]): ParseOutcome {
+  // NO ARGUMENT MEANS `status`. Kept from the hand-rolled parser: bare
+  // `overseer` is the thing the Overseer types most, and Commander's default
+  // for an empty line is its own help.
+  const words = argv.length === 0 ? ["status"] : [...argv];
+  const first = words[0];
+  if (first === "--help" || first === "-h" || first === "help") return { kind: "help" };
+
+  let parsed: Parsed | undefined;
+  const program = buildProgram((p) => {
+    parsed = p;
+  });
+  // Commander writes to stdout/stderr by default; here every word it produces
+  // has to come back as a value, so the caller decides what is an error and
+  // what is help.
+  //
+  // **AND ON EVERY SUBCOMMAND, not only the program.** A subcommand copies its
+  // parent's settings *at the moment it is created*, so a `configureOutput`
+  // applied afterwards reaches the root and nothing under it — which is how
+  // `error: unknown option '--max-transcipts'` went on being printed to the
+  // real stderr by a function whose whole job is to return the message instead.
+  // Found by a test run's output, not by an assertion, which is why there is now
+  // an assertion.
+  let written = "";
+  const capture = {
+    writeOut: (s: string) => {
+      written += s;
+    },
+    writeErr: (s: string) => {
+      written += s;
+    },
+  };
+  // RECURSIVE, because `mine add` is two levels down and inherits from `mine`,
+  // not from the root.
+  const applyCapture = (command: Command): void => {
+    command.configureOutput(capture);
+    for (const child of command.commands) applyCapture(child);
+  };
+  applyCapture(program);
+  try {
+    program.parse(words, { from: "user" });
+  } catch (cause) {
+    const why = cause instanceof Error ? cause.message : String(cause);
+    return { kind: "error", why: written.trim() === "" ? why : written.trim() };
   }
-  if (opts.integer === true && !Number.isInteger(value)) {
-    return { kind: "invalid", why: `${name} counts whole transcripts, so it must be a whole number, got ${JSON.stringify(raw)}` };
+  if (parsed === undefined) {
+    // Commander parsed something and no action fired — an empty subcommand
+    // line. Said as a refusal rather than a silent exit 0.
+    return { kind: "error", why: `no command in ${JSON.stringify(words.join(" "))}` };
   }
-  return { kind: "value", value };
+  return { kind: "run", parsed };
 }
 
 async function main(argv: readonly string[]): Promise<number> {
-  const command = argv[0] ?? "status";
-  if (command === "--help" || command === "-h" || command === "help") {
-    console.log(HELP);
+  const outcome = parseArgv(argv);
+  if (outcome.kind === "help") {
+    console.log(help());
     return 0;
   }
+  if (outcome.kind === "error") {
+    console.error(`✗ ${outcome.why}\n\n${help()}`);
+    return 1;
+  }
+  return await runParsed(outcome.parsed);
+}
+
+/**
+ * The `mine` list: print it, or change it by one name.
+ *
+ * **Every arm says what it did or what it refused**, including "it was already
+ * there". A no-op that prints nothing is indistinguishable from a write that
+ * failed, and this list is the input to `closeout` — a name silently missing
+ * from it is a worktree nobody removes.
+ */
+export function runMine(root: string, parsed: Extract<Parsed, { command: "mine" }>): number {
+  if (parsed.action === "list") {
+    const read = readCliState(root);
+    if (read.kind === "unusable") {
+      console.error(`✗ ${read.why} — ${cliStatePath(root)}`);
+      return 1;
+    }
+    const mine = read.kind === "absent" ? [] : read.state.mine;
+    // NOT an empty print. "Nothing is mine" and "the file is not there yet" are
+    // both legitimate and neither is a blank screen.
+    if (mine.length === 0) console.log(`no sessions in ${cliStatePath(root)} — nothing is being looked after`);
+    for (const name of mine) console.log(name);
+    return 0;
+  }
+
+  const why = whyNotASessionName(parsed.name);
+  if (why !== null) {
+    console.error(`✗ ${why}`);
+    return 1;
+  }
+  const forWriting = cliStateForWriting(root);
+  if (!forWriting.ok) {
+    console.error(`✗ ${forWriting.why}`);
+    return 1;
+  }
+  const edit = parsed.action === "add" ? addMine(forWriting.state, parsed.name) : removeMine(forWriting.state, parsed.name);
+  if (!edit.changed) {
+    console.log(parsed.action === "add" ? `${parsed.name} was already on the list` : `${parsed.name} was not on the list`);
+    return 0;
+  }
+  const written = writeCliState(root, edit.state);
+  if (!written.ok) {
+    console.error(`✗ ${written.why}`);
+    return 1;
+  }
+  console.log(`${parsed.action === "add" ? "added" : "removed"} ${parsed.name} — ${edit.state.mine.length} session(s) now`);
+  return 0;
+}
+
+async function runParsed(parsed: Parsed): Promise<number> {
   const root = requireAbsoluteRoot(storeRoot());
 
-  switch (command) {
+  switch (parsed.command) {
     case "status":
       console.log(statusLines(root, Date.now(), await readOverseerClaim(fleetUrl(process.env))).join("\n"));
       return 0;
     case "events": {
-      const tail = readEventTail(root, Number(flag(argv, "--limit") ?? 40));
+      const tail = readEventTail(root, parsed.limit);
       // "0 events" and "no store" are not the same sentence, and printing
       // nothing at all would be a third thing that looks like both.
       if (tail.total === 0) console.log(`no events in ${join(root, EVENTS_FILE)}`);
@@ -1008,7 +1305,7 @@ async function main(argv: readonly string[]): Promise<number> {
       return 0;
     }
     case "notes": {
-      const read = readNotes(root, Number(flag(argv, "--limit") ?? 40));
+      const read = readNotes(root, parsed.limit);
       if (read.notes.length === 0) console.log("the Overseer has written nothing about itself yet");
       for (const note of read.notes) console.log(`${note.at}  ${describeNote(note)}`);
       return 0;
@@ -1016,52 +1313,39 @@ async function main(argv: readonly string[]): Promise<number> {
     case "attention":
       return await runAttentionCommand({
         root,
-        maxCalls: Number(flag(argv, "--max-calls") ?? DEFAULT_MAX_CALLS),
-        dry: argv.includes("--dry"),
-        json: argv.includes("--json"),
+        maxCalls: parsed.maxCalls,
+        dry: parsed.dry,
+        json: parsed.json,
         // READ-ONLY BY DEFAULT, and `--write` is the opt-in — GPT Sol's second
         // round. The daemon holds the store's lock and this command does not
         // honour it, so a hand run against a live daemon's root was a second
         // writer on `attention.json`: an atomic rename stops a torn file and does
         // nothing about a lost update or a duplicated call. Refusing by default
         // costs a person nothing (the daemon is the producer) and cannot be wrong.
-        write: argv.includes("--write"),
-        out: flag(argv, "--out") ?? null,
-        panes: flag(argv, "--panes") ?? null,
-        captureTo: flag(argv, "--capture-to") ?? null,
+        write: parsed.write,
+        out: parsed.out,
+        panes: parsed.panes,
+        captureTo: parsed.captureTo,
       });
     case "usage": {
       // A command rather than a daemon block for the same reason the header
       // gives for the rest of this file: there is no scheduler here yet, and the
       // honest simplest version of "how close are we to a limit" is something a
       // person or another agent can run and read. It does not touch the store.
-      // `Number(flag)` used to go straight into the options, so
-      // `--max-transcripts nope` produced NaN, every comparison against it was
-      // false, and the bound silently vanished — GPT Sol's finding 10. A flag
-      // that quietly does the opposite of what it says is worse than no flag.
-      const sinceHours = positiveNumberFlag(argv, "--since-hours");
-      // INTEGER, because this one is a COUNT. `--max-transcripts 0.5` passed the
-      // positive-number check and then `slice(0, 0.5)` selected zero
-      // transcripts — a flag that reads as "scan at most half a file" and
-      // behaves as "scan nothing". GPT Sol's round-2 finding 7. `--since-hours`
-      // stays fractional on purpose; half an hour is a sensible window.
-      const maxTranscripts = positiveNumberFlag(argv, "--max-transcripts", { integer: true });
-      if (sinceHours.kind === "invalid") {
-        console.error(`✗ ${sinceHours.why}\n\n${HELP}`);
-        return 1;
-      }
-      if (maxTranscripts.kind === "invalid") {
-        console.error(`✗ ${maxTranscripts.why}\n\n${HELP}`);
-        return 1;
-      }
+      //
+      // The nonsense-number arms that used to live here are now `positiveNumber`
+      // above, which refuses at parse time — so a bad `--max-transcripts` never
+      // reaches this body at all, rather than reaching it as `NaN`.
       const report = await collectUsage({
-        ...(sinceHours.kind === "absent" ? {} : { sinceMs: sinceHours.value * 3600_000 }),
-        ...(maxTranscripts.kind === "absent" ? {} : { maxTranscripts: maxTranscripts.value }),
+        ...(parsed.sinceHours === undefined ? {} : { sinceMs: parsed.sinceHours * 3600_000 }),
+        ...(parsed.maxTranscripts === undefined ? {} : { maxTranscripts: parsed.maxTranscripts }),
       });
-      if (argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
+      if (parsed.json) console.log(JSON.stringify(report, null, 2));
       else console.log(usageLines(report).join("\n"));
       return 0;
     }
+    case "mine":
+      return runMine(root, parsed);
     case "reconcile-jobs": {
       // THE ONE WAY OUT OF A HELD SCHEDULER, and it is deliberately a person's
       // act rather than a setting. A start that could not reconstruct the
@@ -1072,10 +1356,15 @@ async function main(argv: readonly string[]): Promise<number> {
       // It writes a file the NEXT start consumes and deletes. Not an env var:
       // one left set turns "somebody decided this once" into "the protection is
       // off for ever".
-      const why = flag(argv, "--why");
-      if (why === undefined || why.trim() === "") {
+      //
+      // ABSENT `--why` is Commander's `requiredOption` now; what it cannot
+      // refuse is `--why ''`, because an empty string is a value it was given.
+      // That check stays here, with its own sentences, because a blank reason is
+      // the shape somebody types to get past the flag.
+      const why = parsed.why;
+      if (why.trim() === "") {
         console.error(
-          "✗ reconcile-jobs needs --why \"<what you checked>\".\n" +
+          "✗ reconcile-jobs needs --why \"<what you checked>\", and a blank reason is not one.\n" +
             "  This clears a hold that exists because nobody can tell whether some job already ran.\n" +
             "  Look at the log and at `gjd-remote ls` first, and put what you found in the reason —\n" +
             "  it is written into the store and read by whoever asks why a job ran twice.",
@@ -1102,7 +1391,6 @@ async function main(argv: readonly string[]): Promise<number> {
           controller.abort();
         });
       }
-      const tickMs = flag(argv, "--tick-ms");
       // The attention pass is wired in HERE rather than inside the daemon,
       // because it reads tmux and calls a paid model and daemon.ts does neither.
       // With no key it is absent, and the store then publishes a list that says
@@ -1111,14 +1399,12 @@ async function main(argv: readonly string[]): Promise<number> {
       // one — which is exactly when the persisted WAITS must be dropped, because a
       // first-seen instant cannot span a gap nobody watched. The verdicts survive
       // it; see `memoryForEpoch`.
-      const attentionRun = argv.includes("--no-attention")
-        ? null
-        : attentionRunner(root, `daemon-${randomUUID()}`);
+      const attentionRun = parsed.attention ? attentionRunner(root, `daemon-${randomUUID()}`) : null;
       if (attentionRun === null) {
         console.log(
-          argv.includes("--no-attention")
-            ? "attention: off (--no-attention)"
-            : "attention: off — OPENROUTER_API_KEY is not set, so nothing will look at what needs you",
+          parsed.attention
+            ? "attention: off — OPENROUTER_API_KEY is not set, so nothing will look at what needs you"
+            : "attention: off (--no-attention)",
         );
       }
       // The usage scan is wired in here for the same reason, and it needs NO
@@ -1133,7 +1419,7 @@ async function main(argv: readonly string[]): Promise<number> {
       // hurry, and a narrowed scan is exactly what `absenceGap` refuses to call
       // conclusive — so a daemon that quietly took them would publish `unknown`
       // for ever and look broken.
-      const usageOff = argv.includes("--no-usage");
+      const usageOff = !parsed.usage;
       if (usageOff) console.log("usage: off (--no-usage)");
 
       /*
@@ -1174,11 +1460,11 @@ async function main(argv: readonly string[]): Promise<number> {
       }
       const outcome = await runOverseer({
         root,
-        baseUrl: flag(argv, "--url") ?? process.env["OVERSEER_FLEET_URL"] ?? DEFAULT_FLEET_URL,
+        baseUrl: parsed.url ?? process.env["OVERSEER_FLEET_URL"] ?? DEFAULT_FLEET_URL,
         signal: controller.signal,
         // Absent rather than undefined: `exactOptionalPropertyTypes` tells those
         // apart, and absent is what "take the default" means.
-        ...(tickMs === undefined ? {} : { tickMs: Number(tickMs) }),
+        ...(parsed.tickMs === undefined ? {} : { tickMs: parsed.tickMs }),
         ...(attentionRun === null ? {} : { attention: { run: attentionRun } }),
         ...(usageOff ? {} : { usage: { run: () => collectUsage(), onPass: usageRetention.onPass } }),
         // ABSENT rather than present-and-empty when disarmed: an absent `jobs`
@@ -1211,9 +1497,14 @@ async function main(argv: readonly string[]): Promise<number> {
         }
       }
     }
-    default:
-      console.error(`unknown command ${JSON.stringify(command)}\n\n${HELP}`);
-      return 1;
+    default: {
+      // EXHAUSTIVE, and the compiler says so. The old `default` arm printed
+      // "unknown command", which is now Commander's job at parse time — by the
+      // time we are here the command is one of the union's members, and a new
+      // member that nobody wired up must not compile.
+      const never: never = parsed;
+      throw new Error(`unhandled command ${JSON.stringify(never)}`);
+    }
   }
 }
 
diff --git a/tests/overseer-cli-parse.test.ts b/tests/overseer-cli-parse.test.ts
new file mode 100644
index 00000000..5e71b201
--- /dev/null
+++ b/tests/overseer-cli-parse.test.ts
@@ -0,0 +1,239 @@
+/**
+ * **What a command line means — the question nothing used to ask.**
+ *
+ * Until 2026-09-09 `scripts/overseer.ts` parsed its own argv with `indexOf` and
+ * `argv.includes`, and no test touched any of it: every test in
+ * `overseer-cli.test.ts` imports a rendering function and hands it a checkpoint.
+ * So a misspelled flag was a silent no-op, a `--limit nope` was `NaN`, and the
+ * hand-written HELP text could name a flag the code did not read. All three are
+ * the same failure — docs/reusable/silent-success.md — and all three are what
+ * these tests are for.
+ *
+ * `parseArgv` opens no store, reads no environment and starts no daemon, which
+ * is why this file can ask about `run` without one existing.
+ */
+import { describe, expect, test } from "vitest";
+
+import { buildProgram, help, parseArgv, positiveNumber } from "../scripts/overseer.js";
+import { usageRows } from "../tools/overseer/cli-help.js";
+import { DEFAULT_MAX_CALLS } from "../tools/overseer/attention-cli.js";
+
+describe("the shape of a command line", () => {
+  test("no argument at all is `status`, which is what the Overseer types most", () => {
+    expect(parseArgv([])).toEqual({ kind: "run", parsed: { command: "status" } });
+  });
+
+  test("--help, -h and help are all the help, and none of them is an error", () => {
+    for (const word of ["--help", "-h", "help"]) {
+      expect(parseArgv([word])).toEqual({ kind: "help" });
+    }
+  });
+
+  test("an unknown command is refused rather than silently doing nothing", () => {
+    const out = parseArgv(["tik"]);
+    expect(out.kind).toBe("error");
+    if (out.kind === "error") expect(out.why).toContain("tik");
+  });
+
+  test("a MISSPELLED FLAG is refused — it used to be a silent no-op", () => {
+    // `--max-transcipts 3` was accepted by `indexOf("--max-transcripts")`
+    // finding nothing, so the bound was never applied and nothing said so.
+    const out = parseArgv(["usage", "--max-transcipts", "3"]);
+    expect(out.kind).toBe("error");
+    if (out.kind === "error") expect(out.why).toContain("max-transcipts");
+  });
+});
+
+describe("numbers that are not numbers", () => {
+  test("--limit nope is refused, not NaN", () => {
+    const out = parseArgv(["events", "--limit", "nope"]);
+    expect(out.kind).toBe("error");
+    if (out.kind === "error") expect(out.why).toContain("--limit");
+  });
+
+  test("--limit 0 and a negative are refused: a bound that selects nothing is not a bound", () => {
+    expect(parseArgv(["events", "--limit", "0"]).kind).toBe("error");
+    expect(parseArgv(["notes", "--limit", "-4"]).kind).toBe("error");
+  });
+
+  test("--max-transcripts 0.5 is refused, because it is a COUNT", () => {
+    // It passed the positive check once and then `slice(0, 0.5)` selected zero
+    // transcripts: a flag reading "at most half a file", behaving as "nothing".
+    const out = parseArgv(["usage", "--max-transcripts", "0.5"]);
+    expect(out.kind).toBe("error");
+    if (out.kind === "error") expect(out.why).toContain("whole number");
+  });
+
+  test("--since-hours stays fractional, because half an hour is a sensible window", () => {
+    expect(parseArgv(["usage", "--since-hours", "0.5"])).toEqual({
+      kind: "run",
+      parsed: { command: "usage", json: false, sinceHours: 0.5 },
+    });
+  });
+
+  test("the coercer refuses an empty string, which Number() calls 0", () => {
+    expect(() => positiveNumber("--limit")("")).toThrow();
+    expect(() => positiveNumber("--limit")("  ")).toThrow();
+  });
+});
+
+describe("defaults and absence", () => {
+  test("events and notes default to 40", () => {
+    expect(parseArgv(["events"])).toEqual({ kind: "run", parsed: { command: "events", limit: 40 } });
+    expect(parseArgv(["notes"])).toEqual({ kind: "run", parsed: { command: "notes", limit: 40 } });
+  });
+
+  test("an absent --since-hours is ABSENT, not undefined", () => {
+    // `exactOptionalPropertyTypes` tells those apart, and `collectUsage` reads
+    // the difference: absent means take the module's own default, and a present
+    // `undefined` would narrow a scan `absenceGap` then refuses to call
+    // conclusive.
+    const out = parseArgv(["usage"]);
+    expect(out.kind).toBe("run");
+    if (out.kind === "run") {
+      expect(Object.hasOwn(out.parsed, "sinceHours")).toBe(false);
+      expect(Object.hasOwn(out.parsed, "maxTranscripts")).toBe(false);
+    }
+  });
+
+  test("attention defaults to read-only, dry off, and the module's own call bound", () => {
+    expect(parseArgv(["attention"])).toEqual({
+      kind: "run",
+      parsed: {
+        command: "attention",
+        maxCalls: DEFAULT_MAX_CALLS,
+        dry: false,
+        json: false,
+        // READ-ONLY BY DEFAULT: the daemon holds the store's lock and this
+        // command does not honour it, so two writers is the default nobody wants.
+        write: false,
+        out: null,
+        panes: null,
+        captureTo: null,
+      },
+    });
+  });
+
+  test("run defaults both passes ON, and --no-attention / --no-usage turn them off", () => {
+    expect(parseArgv(["run"])).toEqual({ kind: "run", parsed: { command: "run", attention: true, usage: true } });
+    const off = parseArgv(["run", "--no-attention", "--no-usage"]);
+    expect(off).toEqual({ kind: "run", parsed: { command: "run", attention: false, usage: false } });
+  });
+
+  test("run --tick-ms and --url arrive as themselves", () => {
+    expect(parseArgv(["run", "--url", "http://127.0.0.1:9999", "--tick-ms", "5000"])).toEqual({
+      kind: "run",
+      parsed: { command: "run", attention: true, usage: true, url: "http://127.0.0.1:9999", tickMs: 5000 },
+    });
+  });
+});
+
+describe("reconcile-jobs guards the reason twice", () => {
+  test("an absent --why is refused by the parser", () => {
+    const out = parseArgv(["reconcile-jobs"]);
+    expect(out.kind).toBe("error");
+    if (out.kind === "error") expect(out.why).toContain("--why");
+  });
+
+  test("a --why that is present and blank still parses — the emptiness check is the command's", () => {
+    // Said out loud because it is the seam: `requiredOption` cannot refuse a
+    // value it was given, so `runParsed` refuses `"   "` itself. A test that
+    // asserted the parser caught it would be testing the wrong half.
+    expect(parseArgv(["reconcile-jobs", "--why", "   "])).toEqual({
+      kind: "run",
+      parsed: { command: "reconcile-jobs", why: "   " },
+    });
+  });
+});
+
+describe("mine — one noun, three verbs", () => {
+  test("bare `mine` lists, so there is no second spelling of the same question", () => {
+    expect(parseArgv(["mine"])).toEqual({ kind: "run", parsed: { command: "mine", action: "list" } });
+    expect(parseArgv(["mine", "list"])).toEqual({ kind: "run", parsed: { command: "mine", action: "list" } });
+  });
+
+  test("add and rm take exactly one name", () => {
+    expect(parseArgv(["mine", "add", "some-agent"])).toEqual({
+      kind: "run",
+      parsed: { command: "mine", action: "add", name: "some-agent" },
+    });
+    expect(parseArgv(["mine", "rm", "some-agent"])).toEqual({
+      kind: "run",
+      parsed: { command: "mine", action: "rm", name: "some-agent" },
+    });
+    expect(parseArgv(["mine", "add"]).kind).toBe("error");
+  });
+
+  test("an unknown verb is refused rather than treated as a name", () => {
+    expect(parseArgv(["mine", "delete", "some-agent"]).kind).toBe("error");
+  });
+});
+
+describe("parsing writes nothing to the real streams", () => {
+  test("a refusal comes back as a value and is not printed", () => {
+    // It WAS printed, by every subcommand, because a subcommand copies its
+    // parent's output configuration when it is created and `parseArgv` applied
+    // one afterwards. Nothing failed; the words simply appeared in the test
+    // runner's output beside the passing assertions.
+    const written: string[] = [];
+    const out = { write: process.stdout.write, error: process.stderr.write };
+    process.stdout.write = ((chunk: string) => {
+      written.push(String(chunk));
+      return true;
+    }) as typeof process.stdout.write;
+    process.stderr.write = ((chunk: string) => {
+      written.push(String(chunk));
+      return true;
+    }) as typeof process.stderr.write;
+    try {
+      parseArgv(["usage", "--max-transcipts", "3"]);
+      parseArgv(["events", "--limit", "nope"]);
+      parseArgv(["reconcile-jobs"]);
+      parseArgv(["tik"]);
+    } finally {
+      process.stdout.write = out.write;
+      process.stderr.write = out.error;
+    }
+    expect(written.join("")).toBe("");
+  });
+});
+
+describe("the help cannot drift from the parser", () => {
+  test("every registered command appears in the help's usage rows", () => {
+    const program = buildProgram();
+    const text = help();
+    for (const command of program.commands) {
+      expect(text).toContain(` ${command.name()}`);
+    }
+  });
+
+  test("every registered option appears in the row for its own command", () => {
+    // This is the whole reason the rows are generated. A flag added to a
+    // command and not to the help was the drift; now there is no second place
+    // for it to be missing from.
+    const program = buildProgram();
+    const rows = usageRows(program, "overseer");
+    for (const command of program.commands) {
+      const row = rows.find((r) => r.startsWith(`  overseer ${command.name()}`));
+      expect(row, `no usage row for ${command.name()}`).toBeDefined();
+      for (const option of command.options) {
+        expect(row).toContain(option.flags);
+      }
+    }
+  });
+
+  test("a mandatory option is printed bare and an optional one in brackets", () => {
+    const rows = usageRows(buildProgram(), "overseer");
+    const reconcile = rows.find((r) => r.startsWith("  overseer reconcile-jobs"));
+    expect(reconcile).toContain("--why <what you checked>");
+    expect(reconcile).not.toContain("[--why");
+    const events = rows.find((r) => r.startsWith("  overseer events"));
+    expect(events).toContain("[--limit <n>]");
+  });
+
+  test("the prose the parser cannot generate is still in there", () => {
+    const text = help();
+    expect(text).toContain("OVERSEER_STORE_DIR");
+    expect(text).toContain("THE SCHEDULER IS OFF");
+  });
+});
diff --git a/tests/overseer-cli-state.test.ts b/tests/overseer-cli-state.test.ts
new file mode 100644
index 00000000..24f5525e
--- /dev/null
+++ b/tests/overseer-cli-state.test.ts
@@ -0,0 +1,301 @@
+/**
+ * The `overseer` CLI's two lists, and the one substitution that would ruin them.
+ *
+ * **Nearly every test here is about `absent` versus `unusable`.** The list of
+ * sessions the Overseer is looking after is the input to `tick` (whose turns do
+ * I read?), `closeout` (whose name do I drop?) and `dispatch` (whose name do I
+ * add?). If a file this build cannot parse were read as an empty list, all three
+ * would carry on cheerfully: the tick would print nothing and look like a quiet
+ * fleet, and the first write afterwards would overwrite the list it could not
+ * read. That is docs/reusable/silent-success.md exactly, so it is the thing
+ * these tests are pointed at rather than round-tripping.
+ *
+ * The pure edits are tested separately from the disk, the way `health.ts` and
+ * `pause.ts` are split, so the join (`cliStateForWriting`) can be tested as
+ * itself rather than inferred from its parts —
+ * docs/postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md.
+ */
+import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
+import { tmpdir } from "node:os";
+import { join } from "node:path";
+import { afterEach, describe, expect, test } from "vitest";
+
+import {
+  CLI_STATE_FILE,
+  EMPTY_CLI_STATE,
+  addMine,
+  cliStateForWriting,
+  cliStatePath,
+  parseCliState,
+  readCliState,
+  recordPause,
+  recordResume,
+  removeMine,
+  whyNotASessionName,
+  writeCliState,
+  type CliState,
+} from "../tools/overseer/cli-state.js";
+import { runMine } from "../scripts/overseer.js";
+
+const roots: string[] = [];
+
+afterEach(() => {
+  for (const root of roots.splice(0)) {
+    try {
+      chmodSync(root, 0o755);
+    } catch {
+      /* it was never made read-only */
+    }
+    rmSync(root, { recursive: true, force: true });
+  }
+});
+
+function tempRoot(): string {
+  const root = mkdtempSync(join(tmpdir(), "overseer-cli-state-test-"));
+  roots.push(root);
+  return root;
+}
+
+function put(root: string, text: string): void {
+  writeFileSync(cliStatePath(root), text, "utf8");
+}
+
+describe("an unreadable state file is not an empty one", () => {
+  test("no file at all is absent, and absent is a legitimate empty state", () => {
+    const root = tempRoot();
+    expect(readCliState(root)).toEqual({ kind: "absent" });
+    const forWriting = cliStateForWriting(root);
+    expect(forWriting).toEqual({ ok: true, state: EMPTY_CLI_STATE });
+  });
+
+  test("bytes this build cannot parse are UNUSABLE, and no writer may proceed", () => {
+    const root = tempRoot();
+    put(root, "{not json");
+    const read = readCliState(root);
+    expect(read.kind).toBe("unusable");
+
+    const forWriting = cliStateForWriting(root);
+    expect(forWriting.ok).toBe(false);
+    // The refusal has to name the file, because the Overseer reads this under
+    // time pressure and "could not be read" alone does not say what to go and look at.
+    if (!forWriting.ok) expect(forWriting.why).toContain(CLI_STATE_FILE);
+  });
+
+  test("a JSON array is not a state object, however well-formed", () => {
+    const root = tempRoot();
+    put(root, '["overseer-cli"]');
+    expect(readCliState(root).kind).toBe("unusable");
+  });
+
+  test("a name in `mine` that is not a session name makes the whole file unusable", () => {
+    // NOT "skip the bad entry and carry on": a dropped name is a worktree nobody
+    // closes out, and the entry that got dropped is the one nobody sees.
+    const root = tempRoot();
+    put(root, JSON.stringify({ mine: ["fine-name", "Not A Name"], paused: [] }));
+    const read = readCliState(root);
+    expect(read.kind).toBe("unusable");
+    if (read.kind === "unusable") expect(read.why).toContain("Not A Name");
+  });
+
+  test("a paused entry missing its instant makes the file unusable, not the session un-paused", () => {
+    const root = tempRoot();
+    put(root, JSON.stringify({ mine: [], paused: [{ session: "some-agent", door: "steer", why: "usage 71%" }] }));
+    const read = readCliState(root);
+    expect(read.kind).toBe("unusable");
+    if (read.kind === "unusable") expect(read.why).toContain("some-agent");
+  });
+
+  test("a paused entry with an unknown door is unusable rather than defaulted", () => {
+    const root = tempRoot();
+    put(
+      root,
+      JSON.stringify({ mine: [], paused: [{ session: "some-agent", at: "2026-09-09T08:00:00.000Z", door: "carrier-pigeon", why: "" }] }),
+    );
+    expect(readCliState(root).kind).toBe("unusable");
+  });
+
+  test("missing keys are empty lists, because a first write need not carry both", () => {
+    const root = tempRoot();
+    put(root, "{}");
+    expect(readCliState(root)).toEqual({ kind: "read", state: { mine: [], paused: [] } });
+  });
+});
+
+describe("writing", () => {
+  test("round-trips through the disk", () => {
+    const root = tempRoot();
+    const state: CliState = {
+      mine: ["agent-one", "agent-two"],
+      paused: [{ session: "agent-two", at: "2026-09-09T08:00:00.000Z", door: "steer", why: "five-hour window at 71%" }],
+    };
+    expect(writeCliState(root, state)).toEqual({ ok: true });
+    expect(readCliState(root)).toEqual({ kind: "read", state });
+  });
+
+  test("the temp file it renames from carries this process's pid", () => {
+    // Two `overseer mine add` runs in the same second is an ordinary tick, and a
+    // shared `${path}.tmp` would have each writing into the other's half-written
+    // file. The rename is the atomic step; this is about what precedes it.
+    const root = tempRoot();
+    expect(writeCliState(root, EMPTY_CLI_STATE)).toEqual({ ok: true });
+    const written = readFileSync(cliStatePath(root), "utf8");
+    expect(JSON.parse(written)).toEqual(EMPTY_CLI_STATE);
+    // and nothing is left behind
+    expect(() => readFileSync(`${cliStatePath(root)}.${process.pid}.tmp`, "utf8")).toThrow();
+  });
+
+  test("a directory it cannot write to is a refusal with a reason, never a silent no-op", () => {
+    const root = tempRoot();
+    chmodSync(root, 0o500);
+    const out = writeCliState(root, { mine: ["agent-one"], paused: [] });
+    // Running as root would make this writable anyway; then the write genuinely
+    // succeeded and there is nothing to assert. Said out loud rather than skipped
+    // silently, because a test that passes both ways is not a check.
+    if (process.getuid?.() === 0) {
+      expect(out).toEqual({ ok: true });
+      return;
+    }
+    expect(out.ok).toBe(false);
+    if (!out.ok) expect(out.why).toContain(CLI_STATE_FILE);
+  });
+});
+
+describe("session names", () => {
+  test("accepts the names the fleet actually uses", () => {
+    for (const name of ["overseer-cli", "fb2p-quotes-always-outlined-in-text", "s-260908-172048", "260908f"]) {
+      expect(whyNotASessionName(name)).toBeNull();
+    }
+  });
+
+  test("refuses what would not be a name anywhere else either", () => {
+    for (const name of ["", "-leading-dash", "Upper", "has space", "semi;colon", "a".repeat(42)]) {
+      expect(whyNotASessionName(name)).not.toBeNull();
+    }
+  });
+});
+
+describe("the `mine` command, end to end against a real directory", () => {
+  // The join, not the parts: `runMine` is what reads the disk, decides, writes
+  // and prints. Every arm below is a sentence the Overseer reads under time
+  // pressure, and a silent arm is the one that costs a worktree.
+  function say(fn: () => number): { code: number; out: string; err: string } {
+    const out: string[] = [];
+    const err: string[] = [];
+    const realOut = console.log;
+    const realErr = console.error;
+    console.log = (...a: unknown[]) => out.push(a.map(String).join(" "));
+    console.error = (...a: unknown[]) => err.push(a.map(String).join(" "));
+    try {
+      return { code: fn(), out: out.join("\n"), err: err.join("\n") };
+    } finally {
+      console.log = realOut;
+      console.error = realErr;
+    }
+  }
+
+  test("an empty list says so in words rather than printing nothing", () => {
+    const root = tempRoot();
+    const r = say(() => runMine(root, { command: "mine", action: "list" }));
+    expect(r.code).toBe(0);
+    expect(r.out).toContain("nothing is being looked after");
+  });
+
+  test("add then list then rm, each saying what it did", () => {
+    const root = tempRoot();
+    expect(say(() => runMine(root, { command: "mine", action: "add", name: "some-agent" })).out).toContain("added some-agent");
+    expect(say(() => runMine(root, { command: "mine", action: "list" })).out).toBe("some-agent");
+    expect(say(() => runMine(root, { command: "mine", action: "rm", name: "some-agent" })).out).toContain("removed some-agent");
+    expect(say(() => runMine(root, { command: "mine", action: "list" })).out).toContain("nothing is being looked after");
+  });
+
+  test("adding twice is not an error and does not pretend it wrote", () => {
+    const root = tempRoot();
+    runMine(root, { command: "mine", action: "add", name: "some-agent" });
+    const again = say(() => runMine(root, { command: "mine", action: "add", name: "some-agent" }));
+    expect(again.code).toBe(0);
+    expect(again.out).toContain("already on the list");
+  });
+
+  test("removing a name that is not there says so rather than succeeding silently", () => {
+    const root = tempRoot();
+    const r = say(() => runMine(root, { command: "mine", action: "rm", name: "never-here" }));
+    expect(r.code).toBe(0);
+    expect(r.out).toContain("was not on the list");
+  });
+
+  test("a state file this build cannot read REFUSES the write — it does not start a new list", () => {
+    // The mutation to try: make `cliStateForWriting` return an empty state on
+    // `unusable`. This test and its sibling in the first describe both go red,
+    // and without them the Overseer's list would be silently replaced by one
+    // name the first time the file was touched by anything.
+    const root = tempRoot();
+    put(root, "{not json");
+    const r = say(() => runMine(root, { command: "mine", action: "add", name: "some-agent" }));
+    expect(r.code).toBe(1);
+    expect(r.err).toContain(CLI_STATE_FILE);
+    // and the unreadable bytes are still there, unclobbered
+    expect(readFileSync(cliStatePath(root), "utf8")).toBe("{not json");
+  });
+
+  test("listing an unreadable file is a refusal too, not an empty fleet", () => {
+    const root = tempRoot();
+    put(root, "{not json");
+    const r = say(() => runMine(root, { command: "mine", action: "list" }));
+    expect(r.code).toBe(1);
+    expect(r.out).toBe("");
+  });
+
+  test("a name that is not a session name is refused before anything is read", () => {
+    const root = tempRoot();
+    const r = say(() => runMine(root, { command: "mine", action: "add", name: "Not A Name" }));
+    expect(r.code).toBe(1);
+    expect(r.err).toContain("Not A Name");
+  });
+});
+
+describe("the pure edits", () => {
+  test("adding is idempotent and sorted", () => {
+    const first = addMine(EMPTY_CLI_STATE, "zeta-agent");
+    expect(first.changed).toBe(true);
+    const second = addMine(first.state, "alpha-agent");
+    expect(second.state.mine).toEqual(["alpha-agent", "zeta-agent"]);
+    const again = addMine(second.state, "alpha-agent");
+    expect(again.changed).toBe(false);
+    expect(again.state).toBe(second.state);
+  });
+
+  test("removing a name that was never there says so rather than pretending", () => {
+    const out = removeMine(EMPTY_CLI_STATE, "never-here");
+    expect(out.changed).toBe(false);
+  });
+
+  test("parseCliState de-duplicates a name the file lists twice", () => {
+    const parsed = parseCliState({ mine: ["agent-one", "agent-one"], paused: [] });
+    expect(parsed).toEqual({ kind: "read", state: { mine: ["agent-one"], paused: [] } });
+  });
+
+  test("pausing the same session twice replaces rather than appends", () => {
+    // `resume --check` walks this list; two entries for one session would report
+    // it twice and read as two agents still asleep.
+    const one = recordPause(EMPTY_CLI_STATE, { session: "agent-one", at: "2026-09-09T08:00:00.000Z", door: "steer", why: "first" });
+    const two = recordPause(one, { session: "agent-one", at: "2026-09-09T09:00:00.000Z", door: "elsewhere", why: "second" });
+    expect(two.paused).toHaveLength(1);
+    expect(two.paused[0]?.why).toBe("second");
+    expect(two.paused[0]?.door).toBe("elsewhere");
+  });
+
+  test("resuming hands back the record it removed, so the caller can say how long it slept", () => {
+    const paused = recordPause(EMPTY_CLI_STATE, { session: "agent-one", at: "2026-09-09T08:00:00.000Z", door: "steer", why: "usage" });
+    const out = recordResume(paused, "agent-one");
+    expect(out.was?.at).toBe("2026-09-09T08:00:00.000Z");
+    expect(out.state.paused).toEqual([]);
+    expect(recordResume(out.state, "agent-one").was).toBeUndefined();
+  });
+
+  test("the paused list stays in the order it will be resumed in — oldest first", () => {
+    // overseer.md § The tick: "resume oldest-first after the reset".
+    const a = recordPause(EMPTY_CLI_STATE, { session: "later-agent", at: "2026-09-09T09:00:00.000Z", door: "steer", why: "" });
+    const b = recordPause(a, { session: "earlier-agent", at: "2026-09-09T08:00:00.000Z", door: "steer", why: "" });
+    expect(b.paused.map((p) => p.session)).toEqual(["earlier-agent", "later-agent"]);
+  });
+});
diff --git a/tools/overseer/cli-help.ts b/tools/overseer/cli-help.ts
new file mode 100644
index 00000000..c3a1ab8d
--- /dev/null
+++ b/tools/overseer/cli-help.ts
@@ -0,0 +1,88 @@
+/**
+ * **The root help: prose we write, usage rows the parser generates.**
+ *
+ * `scripts/overseer.ts` used to hand-write both, and that is the drift this
+ * whole CLI exists to remove — a flag added to a subcommand and not to the help
+ * text is a flag the Overseer never finds. Commander knows every command's
+ * arguments and options because it had to, in order to parse them, so the rows
+ * are read back out of it rather than restated.
+ *
+ * **The prose stays hand-written and interleaved.** Commander's own
+ * `--help` is a good reference page and a poor briefing: it cannot say that
+ * `attention` costs money, or that the scheduler is off unless somebody said so
+ * out loud. Those paragraphs are the reason a person reads this help at all, so
+ * the renderer takes them as text and puts the generated rows between them.
+ *
+ * The same split `gjd-remote` chose on 2026-09-09 (session
+ * `gjd-remote-argument-parsing`, on GPT Sol's advice): **Commander owns grammar
+ * and metadata; the document owns narrative.** One parser in the repo, per
+ * docs/reusable/third-party-library-selection.md.
+ *
+ * NO IMPORT SIDE EFFECTS: nothing here runs a command or reads the environment,
+ * so a test can render the help of a program it built in memory.
+ */
+import type { Command } from "commander";
+
+/**
+ * One usage line per subcommand, in declaration order.
+ *
+ * `  <prefix> <name> <args…> [--flag <value>] …`
+ *
+ * Options are printed in the order they were registered, with Commander's own
+ * `flags` string, so what a reader sees is literally what the parser accepts.
+ * A **mandatory** option is printed bare and everything else is wrapped in
+ * square brackets — the convention every man page uses, and the one thing here
+ * that is a choice rather than a transcription.
+ *
+ * **`option.mandatory`, not `option.required`.** They read like synonyms and are
+ * different questions: `required` is *this option's value is not optional*
+ * (`--sha <sha>` has it, `--dry-run` does not), while `mandatory` is *the
+ * command refuses to run without this option*. Using `required` here printed
+ * `--sha <sha>` as though it were compulsory and `[--limit <n>]` correctly, in
+ * the same list, which is the sort of help nobody notices is wrong.
+ */
+export function usageRows(program: Command, prefix: string): string[] {
+  const rows: string[] = [];
+  for (const command of program.commands) {
+    // A command marked hidden is not part of the vocabulary; Commander hides it
+    // from its own help and so does this.
+    if ((command as { _hidden?: boolean })._hidden === true) continue;
+    const here = `${prefix} ${command.name()}`;
+    // A GROUP GETS NO ROW OF ITS OWN — its leaves do. `mine` is not a thing you
+    // can run; `mine add <name>` is. A row for the group would be a line naming
+    // no arguments and no options, which reads as a command that takes neither.
+    if (command.commands.length > 0) {
+      rows.push(...usageRows(command, here));
+      continue;
+    }
+    const parts = [here];
+    parts.push(...command.registeredArguments.map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`)));
+    for (const option of command.options) {
+      if (option.hidden) continue;
+      parts.push(option.mandatory ? option.flags : `[${option.flags}]`);
+    }
+    rows.push(`  ${parts.join(" ")}`);
+  }
+  return rows;
+}
+
+/**
+ * The whole root help: a title, the generated rows, then the prose.
+ *
+ * `before` and `after` are blocks of already-written text. They are joined with
+ * blank lines rather than concatenated, so a paragraph cannot accidentally run
+ * into a usage row.
+ */
+export function renderRootHelp(input: {
+  program: Command;
+  prefix: string;
+  title: string;
+  before?: readonly string[];
+  after?: readonly string[];
+}): string {
+  const blocks: string[] = [input.title];
+  for (const block of input.before ?? []) blocks.push(block);
+  blocks.push(usageRows(input.program, input.prefix).join("\n"));
+  for (const block of input.after ?? []) blocks.push(block);
+  return blocks.join("\n\n");
+}
diff --git a/tools/overseer/cli-state.ts b/tools/overseer/cli-state.ts
new file mode 100644
index 00000000..b50fbdae
--- /dev/null
+++ b/tools/overseer/cli-state.ts
@@ -0,0 +1,237 @@
+/**
+ * **The `overseer` CLI's own small memory** — `~/.overseer/cli-state.json`.
+ *
+ * Two lists live here and nothing else:
+ *
+ * - **`mine`** — the session names this Overseer is looking after. `overseer
+ *   tick` reads it to decide whose last turn to print, `dispatch` adds to it and
+ *   `closeout` removes from it. In the bash specimen this was a `grep -E`
+ *   alternation typed into the script, which meant a session dispatched at 3am
+ *   was invisible to the next tick unless somebody remembered to edit a file.
+ * - **`paused`** — who was told to pause, when, and by which door. `overseer.md`
+ *   § The tick asks for exactly this and says why: *"Log who is paused, and
+ *   check they woke up."* A pause nobody verifies is indistinguishable from an
+ *   agent that died, and the Overseer auto-compacts, so its own memory of a
+ *   pause it issued forty minutes ago is the first thing to go.
+ *
+ * ## Why this is not in the checkpoint
+ *
+ * `~/.overseer/` is the store and **the daemon is its single writer**
+ * (`store.ts`). This file is beside it, not in it: the daemon never reads or
+ * writes `cli-state.json`, and this module is its only writer. That is the whole
+ * of the concurrency story — one writer, one file — plus the two details below.
+ *
+ * ## An unreadable file is NOT an empty one
+ *
+ * `readCliState` has three arms, and the difference between `absent` and
+ * `unusable` is the whole reason it does. Absent is ordinary: no tick has run
+ * here yet, and an empty state is the right answer. Unusable means the bytes are
+ * there and this build cannot understand them — and answering *empty* to that
+ * would hand `closeout` a list with nothing in it, which reads as *nobody is
+ * mine* rather than *I cannot tell you*, and the write that followed would
+ * overwrite the list it could not read. So every writer refuses on `unusable`
+ * and says so. docs/reusable/silent-success.md is the general form.
+ *
+ * ## The temp file is per-process
+ *
+ * `arming.ts` writes `${path}.tmp` and renames it, which is atomic for one
+ * writer and a shared clobber target for two. Two `overseer mine add` runs in
+ * the same second is not hypothetical — a tick is a burst of commands — so the
+ * temp name carries this process's pid. The rename is still the atomic step;
+ * what the pid buys is that neither process is writing into the other's
+ * half-written file. **Last writer still wins on the file's contents**, and that
+ * is accepted: the alternative is a lock, and a lock in the Overseer's own
+ * tooling is a thing that can wedge the Overseer.
+ */
+import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
+import { dirname, join } from "node:path";
+
+import { NAME_RULE } from "../fleet/routes-rename.js";
+
+/** The file, inside whatever `storeRoot()` resolved to. */
+export const CLI_STATE_FILE = "cli-state.json";
+
+/**
+ * Which door the pause sentence went through.
+ *
+ * `steer` is this CLI posting to `/api/steer/message`; `elsewhere` is the
+ * Overseer having sent it itself with `SendMessage`, which it prefers for a
+ * Claude session and which no CLI can do. The record is the same either way —
+ * that is the point of `--record-only` — but a later "did it wake up?" wants to
+ * know whether a delivery receipt exists to go and look at.
+ */
+export type PauseDoor = "steer" | "elsewhere";
+
+/** One session, told to pause, at one instant. */
+export type PauseRecord = {
+  readonly session: string;
+  /** UTC ISO 8601, always — the BST log lines of 2026-09-09 are why this comment exists. */
+  readonly at: string;
+  readonly door: PauseDoor;
+  /** Whatever the Overseer said the reason was, for the log line and for the resume order. */
+  readonly why: string;
+};
+
+export type CliState = {
+  readonly mine: readonly string[];
+  readonly paused: readonly PauseRecord[];
+};
+
+export const EMPTY_CLI_STATE: CliState = { mine: [], paused: [] };
+
+export type CliStateRead =
+  | { kind: "read"; state: CliState }
+  | { kind: "absent" }
+  | { kind: "unusable"; why: string };
+
+export function cliStatePath(storeRoot: string): string {
+  return join(storeRoot, CLI_STATE_FILE);
+}
+
+/** A session name this CLI will accept, or why not. `null` when it is fine. */
+export function whyNotASessionName(name: string): string | null {
+  if (name.length === 0) return "a session name cannot be empty";
+  if (!NAME_RULE.test(name)) {
+    return (
+      `${JSON.stringify(name)} is not a session name here: lower-case letters, digits and dashes, ` +
+      "starting with a letter or digit, at most 41 characters (tools/fleet/routes-rename.ts § NAME_RULE)"
+    );
+  }
+  return null;
+}
+
+function parsePauseRecord(raw: unknown): PauseRecord | string {
+  if (raw === null || typeof raw !== "object") return "a paused entry is not an object";
+  const o = raw as Record<string, unknown>;
+  const session = o["session"];
+  if (typeof session !== "string" || whyNotASessionName(session) !== null) {
+    return `a paused entry has no usable session name: ${JSON.stringify(session)}`;
+  }
+  const at = o["at"];
+  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) {
+    return `paused entry for ${session} has no readable instant: ${JSON.stringify(at)}`;
+  }
+  const door = o["door"];
+  if (door !== "steer" && door !== "elsewhere") {
+    return `paused entry for ${session} has no known door: ${JSON.stringify(door)}`;
+  }
+  const why = o["why"];
+  if (typeof why !== "string") return `paused entry for ${session} has no reason string`;
+  return { session, at, door, why };
+}
+
+/**
+ * Read it, or say which of the three things is true.
+ *
+ * Strict on purpose. A field this cannot parse is `unusable` rather than a
+ * dropped entry, because a dropped `paused` entry is a session that stays
+ * stopped all day and a dropped `mine` entry is a session nobody closes out.
+ */
+export function parseCliState(raw: unknown): { kind: "read"; state: CliState } | { kind: "unusable"; why: string } {
+  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
+    return { kind: "unusable", why: `${CLI_STATE_FILE} is not a JSON object` };
+  }
+  const o = raw as Record<string, unknown>;
+  const rawMine = o["mine"] ?? [];
+  if (!Array.isArray(rawMine)) return { kind: "unusable", why: `${CLI_STATE_FILE}: "mine" is not an array` };
+  const mine: string[] = [];
+  for (const entry of rawMine) {
+    if (typeof entry !== "string") return { kind: "unusable", why: `${CLI_STATE_FILE}: "mine" holds ${JSON.stringify(entry)}, which is not a name` };
+    const why = whyNotASessionName(entry);
+    if (why !== null) return { kind: "unusable", why: `${CLI_STATE_FILE}: ${why}` };
+    if (!mine.includes(entry)) mine.push(entry);
+  }
+  const rawPaused = o["paused"] ?? [];
+  if (!Array.isArray(rawPaused)) return { kind: "unusable", why: `${CLI_STATE_FILE}: "paused" is not an array` };
+  const paused: PauseRecord[] = [];
+  for (const entry of rawPaused) {
+    const parsed = parsePauseRecord(entry);
+    if (typeof parsed === "string") return { kind: "unusable", why: `${CLI_STATE_FILE}: ${parsed}` };
+    paused.push(parsed);
+  }
+  return { kind: "read", state: { mine, paused } };
+}
+
+export function readCliState(storeRoot: string): CliStateRead {
+  const path = cliStatePath(storeRoot);
+  if (!existsSync(path)) return { kind: "absent" };
+  let raw: unknown;
+  try {
+    raw = JSON.parse(readFileSync(path, "utf8"));
+  } catch (cause) {
+    return {
+      kind: "unusable",
+      why: `${CLI_STATE_FILE} could not be read (${cause instanceof Error ? cause.message : String(cause)})`,
+    };
+  }
+  return parseCliState(raw);
+}
+
+/**
+ * The state to act on, or a refusal — the shape every writing subcommand wants.
+ *
+ * Folded here rather than at each call site so that no caller can spell
+ * `absent` and `unusable` the same way by accident, which is the substitution
+ * this module exists to prevent.
+ */
+export function cliStateForWriting(storeRoot: string): { ok: true; state: CliState } | { ok: false; why: string } {
+  const read = readCliState(storeRoot);
+  if (read.kind === "absent") return { ok: true, state: EMPTY_CLI_STATE };
+  if (read.kind === "unusable") {
+    return {
+      ok: false,
+      why: `${read.why} — refusing to write over a state file this build cannot read; ${cliStatePath(storeRoot)}`,
+    };
+  }
+  return { ok: true, state: read.state };
+}
+
+export function writeCliState(storeRoot: string, state: CliState): { ok: true } | { ok: false; why: string } {
+  const path = cliStatePath(storeRoot);
+  const temporary = `${path}.${process.pid}.tmp`;
+  try {
+    mkdirSync(dirname(path), { recursive: true });
+    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
+    renameSync(temporary, path);
+    return { ok: true };
+  } catch (cause) {
+    try {
+      if (existsSync(temporary)) unlinkSync(temporary);
+    } catch {
+      /* the rename is what matters; a stray temp file is not worth a second failure */
+    }
+    return { ok: false, why: `${CLI_STATE_FILE} could not be written (${cause instanceof Error ? cause.message : String(cause)})` };
+  }
+}
+
+/* ------------------------------------------------------------- pure edits -- */
+
+/** Add a name, keeping the list sorted and unique. Returns the same state when it was already there. */
+export function addMine(state: CliState, name: string): { state: CliState; changed: boolean } {
+  if (state.mine.includes(name)) return { state, changed: false };
+  return { state: { ...state, mine: [...state.mine, name].sort() }, changed: true };
+}
+
+export function removeMine(state: CliState, name: string): { state: CliState; changed: boolean } {
+  if (!state.mine.includes(name)) return { state, changed: false };
+  return { state: { ...state, mine: state.mine.filter((n) => n !== name) }, changed: true };
+}
+
+/**
+ * Record a pause. A second pause of the same session **replaces** the first.
+ *
+ * Replacing rather than appending because the question this list answers is
+ * *who is paused right now, and since when* — a history of pauses is what the
+ * event log is for, and two entries for one session would make
+ * `resume --check` report it twice.
+ */
+export function recordPause(state: CliState, record: PauseRecord): CliState {
+  const paused = state.paused.filter((p) => p.session !== record.session);
+  return { ...state, paused: [...paused, record].sort((a, b) => a.at.localeCompare(b.at)) };
+}
+
+export function recordResume(state: CliState, session: string): { state: CliState; was: PauseRecord | undefined } {
+  const was = state.paused.find((p) => p.session === session);
+  if (was === undefined) return { state, was: undefined };
+  return { state: { ...state, paused: state.paused.filter((p) => p.session !== session) }, was };
+}

```
