# One shared reader for a `claude` command line

**Three** functions in this repo parse a `claude` process's command line to answer three different
questions, and each one's rule is another one's bug. One of the three is still the substring test
that a cross-family review had already condemned everywhere else.

> Yes, improve the Claude-argv parser situation
>
> — Greg, 2026-09-08

GPT Sol logged the duplication during the wave-2 stage-C review as **the seventeenth hand-written
join** in this repo — the same class as the `dryRun`/`mode` mismatch that made every box action a dry
run reported as "Done" ([260907e](260907e-agent-fleet-dashboard.md)). It was deferred in
[260908f](260908f-orchestrator-wave-2-write-path-usage-limits-box-health-history-attention-inbox-codex-adapter.md)
pending a restructure of `steer.ts` that has since landed. This is that deferral, taken up.

## The measurement that sets the urgency

**Against the live box, right now, the readers do not disagree.** Seven live `claude` processes,
real argv read from `/proc/<pid>/cmdline`, both readers run against each one, **0 disagreements**.

```
7 live claude processes, 0 disagreement(s).
  carrying --session-id:        7
  headless (--print/-p):        0
  BOTH headless and session-id: 0
  containing a bare "--":       2
  using --session-id=<v> form:  0
```

So this is a **durability fix, not an outage**, and the plan should be sized like one. It is also a
positive control that proves the step it wraps and nothing above it: seven processes, none headless,
none using the `=` spelling, and no prompt that happens to begin with a dash. The shapes in use are
narrow because one launcher writes almost all of them.

The one thing on the box that **is** wrong today is the third reader — see D3/D4 below.

## The three readers

| | `recogniseClaude` | `isClaudeForSession` | the awk probe |
|---|---|---|---|
| where | `tools/overseer/harness.ts:368` | `tools/fleet/steer.ts:667` | `scripts/gjd-remote-tmux.ts`, `claudeForSession` |
| asks | what harness is this, and is it headless? | is this the claude for *this* conversation? | is a Claude alive under this pane? |
| input | `args: string` — `ps args`, **quoting already lost** | `readonly string[]` — `/proc`, **faithful** | the same `ps args`, inside awk |
| option region ends at | the first bare word | a bare `--` | *never — it is a substring search* |
| `argv[0]` checked | yes, upstream in `resolveExecutable` | yes, basename must be `claude` | **no** |
| `--session-id=<v>` | accepted | accepted | **not matched** |
| acts on the verdict | nothing yet — no production caller | **`tmux send-keys`**: prose into a live pane | `gjd-remote ls` labelling |

**The awk column is the state this plan was written against, and Stage C has since changed all three
of its bold cells**: it checks the basename, it accepts `--session-id=<v>`, and its option region
ends at a bare `--` or at the first bare word once an id has been seen. The column is left as it was
because D3 and D4 below are the argument for the stage, and rewriting it would leave them describing
nothing.

Both TypeScript rules were written for a real bug, which is why neither is simply wrong.
`recogniseClaude` stops at the first bare word because that word is the user's **prompt**, and a
prompt is free text: a review found that `claude --session-id abc --print do the thing` had matched
the `--session-id` arm and **granted prose steering on a headless run**. `isClaudeForSession` stops
at `--` because everything after it is positional by definition, and `claude --session-id B --
--session-id A` is a prompt that *says* `--session-id A`.

## The disagreements, and which direction each fails

Measured with a spike over eight constructed command lines; four disagree.

```
case                              | harness.ts           | steer(A) | agree?
----------------------------------|----------------------|----------|-------
plain interactive                 | code A               | true     | yes
inline = form                     | code A               | true     | yes
prompt MENTIONS --print           | code A               | true     | yes
prompt MENTIONS --session-id=     | code A               | false    | *** NO ***
prompt MENTIONS bare --session-id | code A               | false    | *** NO ***
-- then a dash-leading prompt     | ambiguous            | true     | *** NO ***
genuinely headless                | claude-headless      | true     | *** NO ***
flag with a value before the id   | code A               | true     | yes
```

- **D1 — the bare `--`.** `recogniseClaude` has no `--` rule at all; `"--"` starts with `-`, so the
  scan walks straight through it into the prompt. **This is not academic**: `scripts/gjd-remote.ts`
  emits `-- "$(cat …)"` on every launch that carries a prompt, and 2 of the 7 live processes have one
  right now. It bites when the prompt's *second* word looks like a flag.
- **D2 — duplicate identical ids.** `steer.ts` refuses `values.length !== 1`, even when both are the
  same uuid. `harness.ts` refuses only when they *differ*.
- **D3 — the awk probe has no `argv[0]` check.** `index(A[q], "--session-id " id)` will call a
  `grep -r --session-id <uuid> logs/` a Claude, and will call a *different* conversation whose launch
  prompt quotes this uuid a Claude. That is precisely the test `steer.ts` deleted as Sol's F3, still
  running. **And the commonest carrier is neither of those**: it is `/bin/bash -c …`, because Claude
  Code's own shell snapshots put the whole command into argv. Three such processes were live while
  Stage C was being built, one of them carrying a real uuid. So the shape is **generated by the
  harness itself**, not only by a user's prompt.
- **D4 — the awk probe misses `--session-id=<uuid>`** entirely; it requires a literal space.
- **D5 — `--print`.** `isClaudeForSession` never looks at it, so a headless claude carrying the
  pane's session id would verify as a steer target. Nothing on the box produces that shape today
  (`run-claude.ts` passes `--print` and **no** `--session-id`, taking the id back out of the event
  stream instead), and a screen check downstream masks it — but the argv reader not knowing is a
  coincidence, not a design.
- **D6 — a fourth reading.** `work.ts:532` matches headless as `/^(--print|-p)(\s|$)/`, anchored to
  the first argument, with a self-declared "KNOWN GAP: `claude --model x -p …` is missed".
  `recogniseClaude` catches that case. So `classifyPaneWork` and `classifyPaneHarness` can disagree
  about one process in one tick.

## What a shared reader must not do

**It must not take a string.** `harness.ts` gets `ps args` — argv joined with single spaces, quoting
destroyed before we see it — while `steer.ts` reads NUL-separated `/proc` argv, which is faithful. A
shared API that takes a string silently downgrades the one reader whose verdict presses Enter in a
live pane. So: the reader takes `readonly string[]`, and the `ps` caller passes
`args.split(/\s+/)` through a boundary whose **name says it is lossy**.

**It must not become one authoritative wrong answer.** From `w2-fleet-dictation`, who had spent the
day on the same class:

> One shared reading that is wrong is worse than two that are wrong, because it looks authoritative
> and nobody re-derives it. […] the win is not "one parser" so much as one parser that **fails
> loudly when the grammar moves under it**.

Three consequences taken directly into the design:

- **Fixtures captured from real invocations, not strings somebody typed.** A hand-written fixture
  encodes the same misunderstanding as the code and votes for the bug twice. The seven live command
  lines above are the seed corpus.
- **The shared reader is a required input, not an available helper** — a type every call site must
  satisfy, so the compiler names anyone who has not adopted it. An optional helper gets taken up at
  one site and the divergence survives in the other.
- **Say which guarantees are properties of `claude` and which are choices we made.** A decision
  written down as a property goes unexamined for months.

**It cannot reach the awk.** `gjd-remote-tmux.ts` (the probe, now `claudeForSession` at ~551, called
at ~577) runs inside a heredoc'd shell script over ssh.
Fixing it means teaching the awk the `argv[0]`-and-exact-token rule, or moving that decision off the
box into TypeScript. **The second option is worse than it looks, and this paragraph said so wrongly
twice.** The `ps` blob is *not* shipped back: `snap` never leaves the box, and only the reduced
per-session `proc` token is printed. So moving the decision home would mean **widening the wire to
carry every process's flattened argv — prompts and possibly secrets included — over ssh**, to fix a
labelling bug. Teaching the awk it is. (Done: Stage C.)

## STOP — the boundary rule is wrong about Claude, and it was never checked

**Measured 2026-09-08, against `claude` 2.1.263 on this box, after Sol's Stage A review (ARGV-01):**

```
claude ordinary-prompt --session-id not-a-uuid --print
  -> Error: Invalid session ID. Must be a valid UUID.          a flag read AFTER a positional

claude some-prompt-here --version
  -> 2.1.263 (Claude Code), exit 0                             the same

claude say-only-OK --print --model definitely-not-a-real-model
  -> unrecognized_model, query_source:"sdk", exit 1            --print AND --model, after a positional
```

**Claude permutes.** Options are parsed anywhere on the command line **except after a bare `--`**.
So "the option region ends at the first bare word" is not a rule about Claude at all.

The consequence is worse than a wrong rule, because the wrong rule was itself a bug fix. The comment
at `harness.ts:374` says:

> Stopping at the first bare word is what keeps the opposite mistake away: a prompt is free text, and
> `claude --session-id abc Please add a --print flag to the CLI` must not be read as headless because
> its PROMPT says `--print`.

**That process is headless.** Claude reads the `--print`. So `recogniseClaude` reports `claude-code`,
the capability table grants prose steering, and that is the *exact false grant* the comment says it
prevents — reintroduced by the fix, for a different input. **A claim about somebody else's tool,
written down as a property, never run.** Same class as
[the postmortem from earlier today](../postmortems/260908f-a-correct-comment-contradicted-by-the-line-beneath-it.md):
an artefact authored to be trusted later, in a place nobody re-derives.

### What survives, and what this vindicates

**`steer.ts` was simply right and `harness.ts` was simply wrong.** The option region ends at `--` and
nowhere else. My "two rules are one rule with one half missing each" was a tidy symmetry over an
unchecked premise — see the superseded section below, kept because being wrong in an interesting way
is worth reading.

**And this is the strongest possible argument for the fidelity tag**, which stops being a nicety and
becomes the thing that resolves the case:

- On **faithful argv**, `["claude","--session-id",A,"Please add a --print flag"]` has the prompt as
  **one element**, so `--print` is *inside* an argument and is not a flag. Decidable. Not headless.
- On **`ps`-flattened**, that same process is byte-identical to
  `["claude",…,"Please","add","a","--print","flag"]`, which **is** headless. Not decidable, so it must
  fail closed as `unreadable`.

The same command line, two fidelities, two different **correct** answers — which is precisely what a
tagged input is for, and precisely what a single `string` API could never have expressed.

## Stage A round 2 — what the second review changed

GPT Sol reviewed the shipped module (`e3e50497`) and returned **four P0s**, one of which overturned
its core rule. This is what round 2 implemented, red-first, on 2026-09-08.

### The rule now

- The option region ends at a bare `--` and **nowhere else**. Positionals do not end it. (On the
  flattened arm a `--` that follows a positional ends nothing either — it makes the whole reading
  `unreadable`. That is ARGV-P1-01, in Stage B round 2 below, and it is the next bullet applied to
  the separator as well.)
- On the **`argv`** arm the scan keeps going past positionals: a dash-led token before any `--` is a
  flag. This is decidable because the prompt is one element.
- On the **`ps-flattened`** arm, once an **unconsumed positional** has appeared, **every** later
  dash-led token is `unreadable`, naming the token — the separator included, since `--` is a word
  people write in prose. "Unconsumed" is load-bearing: a bare word a flag ate as its value is not a
  positional, or the ordinary launcher shape (`--permission-mode auto --print`) would refuse.
- Only the **first** unconsumed positional can be a subcommand word, so a prompt using the word
  "stop" three sentences in is still a prompt.

### `one-free-text` is gone, and that is the surprise

The arity existed because a multi-word `--name` on a flattened line ended the option region early and
hid a later `--print`. **The new boundary rule removes the damage rather than the ambiguity**: a
positional ends nothing now, so `--name` can take exactly one token — which is what the CLI itself
takes, measured — and the leftover words are ordinary positionals handled by the one ambiguity rule
everything else uses. Two measurements settled it, and both contradict the round-1 analysis above:

```
claude --name my mcp     -> Usage: claude mcp [options] [command]      one value, then a subcommand
claude --name=my mcp     -> Usage: claude mcp [options] [command]      the same
claude --version --session-id not-a-uuid -> 2.1.263 (Claude Code), exit 0
```

One special case and one bug class fewer. `claude --session-id U --name my session` still reads as a
session (the cheap case round 1 protected); `--name my session --print` is still refused, but now
because a dash-led token follows a positional, not because `--name` is special.

**The cost of refusing, counted rather than estimated** (Sol asked for the number before I committed
to a refusal): a `/proc` census of every live `claude` on the box, 2026-09-08 — **5 processes, 0
carrying `--name` at all**, so the separate-form question costs nothing today either way. The census
also answered ARGV-06: every one has a trailing-NUL run of exactly 1, so dropping the whole run was
never protecting anything real.

### ARGV-02: a flag that prints and exits reads as `subcommand`

`--version`/`-v` are `TERMINAL_FLAGS` and return `{ kind: "subcommand", name: "--version" }`.
**Why that arm rather than a fifth one**: all three consumers already map `subcommand` to "not a
harness"/"no match" — which is exactly and completely what a caller needs to know about
`claude --version` — so this needed no change in `steer.ts`, `harness.ts` or `work.ts`, and a new arm
would have bought a distinction no caller makes while costing three files a rewrite. The price is
that `subcommand.name` carries a flag spelling in this one case; the arm's doc says so. The check
runs **after** the arity rules, so `--version=x` is still `unreadable` rather than a command.

### The one asymmetry that is NOT a defect, written into the module

`--session-id=-x` is accepted and `--session-id -x` is refused, and that reads like an oversight.
It is not, and an F3 instruction to Stage C to "make them agree" was **wrong and was refused by its
implementer, correctly**. The inline spelling glues the value to the flag, so a dash-led value is
still unambiguously the value; the separate spelling leaves the next token as either the value or the
next flag, which nothing decides. One rule — *never guess where you cannot decide* — over two
different amounts of information. Making them agree would either refuse something decidable or accept
something undecidable, and would put the module back into disagreement with the awk probe, which
draws the same line. Both spellings do agree on the empty value (ARGV-04), because an empty id is not
an id either way. The reasoning is now a comment at both branches, so the next reader does not
"fix" it.

### ARGV-07: subcommand drift fails open, and no hermetic check can see it

An unknown **flag** is `unreadable` — loud and safe. An unknown **subcommand** is just a bare word:
it reads as a positional, the line reads as a `session`, and a caller may grant prose steering on a
process that is a command. The asymmetry is the wrong way round and it is **partly irreducible**: a
new subcommand `foo` is indistinguishable from a prompt beginning with the word "foo", which is why
`help` is already excluded by hand. Proposed rather than invented: **a maintenance check that is
allowed to touch the real binary** — diff `claude --help`'s `Commands:` and `Options:` sections
against `SUBCOMMANDS` and `FLAGS`, run when the CLI updates or in the weekly sweep, never from the
unit suite. **It is not built** (it needs a file outside round 2's boundary); until it is, the
limitation is written into the module header with the CLI version the tables were measured against,
and that is the whole defence. A weak hermetic check would have been worse than the honest note.

### Mutation, round 2: 20 mutants, 1 equivalent, 0 real survivors

Each mutation applied in place, suite run, file restored and verified byte-identical. Re-run after
the `readFlagToken` extraction, so the table describes the code as shipped rather than a draft.

**The harness proves it ran before it reports anything** — Stage C's mutation pass was silently
measuring nothing for a while (`--reporter=basic` does not exist in vitest 4, so no run started and
all thirteen mutants "survived"). This one parses the `Tests N failed | M passed (T)` line, aborts
unless the unmutated baseline is **0 failed of 67**, and treats an anchor that no longer matches the
source as a skip rather than a survivor. A mutant reported as surviving here is one where a run
happened and every test passed.

| mutant | tests red |
|---|---|
| walk through the bare `--` | 5 |
| treat an unknown flag as taking no value (guess, do not refuse) | 5 |
| treat an unknown flag as taking one value (the other wrong guess) | 3 |
| match `--session-id` by prefix *(at the recording line)* | **0 — equivalent, see below** |
| look a flag up in `FLAGS` by PREFIX rather than exact token | 2 |
| drop the subcommand check | 7 |
| check `SUBCOMMANDS` on every positional, not only the first | 1 |
| ignore `-p`, keeping only the long spelling | 2 |
| let a variadic flag run greedily with no `--` | 2 |
| accept an empty INLINE value | 2 |
| basename by prefix rather than equality (`claude-wrapper` is a claude) | 1 |
| **ARGV-01** stop the scan at the first positional (the old, false rule) | 8 |
| **ARGV-01** drop the flattened ambiguity rule | 4 |
| **ARGV-01** apply the ambiguity rule on BOTH arms | 4 |
| **ARGV-01** arm the rule on a bare word a flag consumed as its value | 11 |
| **ARGV-02** drop the terminal-flag check | 4 |
| **ARGV-02** check terminal flags before the arity rules | 1 |
| **ARGV-03** let a `--name` value swallow the run of bare words after it | 5 |
| **ARGV-04** accept an empty SEPARATE value | 2 |
| **ARGV-06** pop the whole trailing-empty run | 1 |

**The survivor is an equivalent mutant and round 1 was wrong to count it as killed.** Changing the
`--session-id` comparison at the *recording* line to `startsWith` changes nothing, because no other
row in `FLAGS` begins with `--session-id`, so the lookup has already refused `--session-idle` before
that line runs. The exactness that a test really holds is the `FLAGS.get(name)` lookup — mutate that
to a prefix search and two tests go red, which is the row above it. Both facts are now in a comment
at the line, because a guard no test holds should say so.

### Live positive control, after the change

All 5 live `claude` processes, read on both arms: **5 × `session` with one id, both arms agreeing.**
No regression on real traffic — including the one process whose prompt has no `--` in front of it,
which stays readable because its prose contains no dash-led word. The captured pane that *does*
(`--- STAGE 1 …`, a markdown rule inside a brief) is refused, and the refusal now names `---` rather
than `--name`: same verdict, honest reason, and `tests/overseer-harness.test.ts` says so.

### What the new refusal costs, said plainly

Round 1 ignored a flattened prompt entirely (it stopped at the prompt's first word), so a pane
launched **without** a `--` was always readable. Round 2 refuses one whose prose contains a dash-led
token — and that is a real cost, not only a correctness win: `harness.ts` reads the flattened arm, so
such a pane is `ambiguous` and **the dashboard will not offer prose steering on it**.

**Prompts with no separator are the common case on this box, not the exotic one** — Stage C's own
positive control found `claude --session-id <uuid> Run get-ready-for-deploy.md, i.e. pull latest …`
running right now. So the trigger matters: it is not "a prompt with no `--`", it is "a prompt with no
`--` **that contains a dash-led word**". That process reads as a clean `session` on both arms, and so
do the other four. What is refused is the captured pane whose brief contains `--- STAGE 1`, and on
that one the honest answer really is *I cannot read this*.

Three things bound the cost. `new-claude` has emitted `-- "$(cat …)"` before every prompted launch
since earlier the same day, so the shape is legacy and shrinking; 5 of 5 live processes read cleanly
today; and `steer.ts`, the one path that actually presses Enter, reads the **faithful** arm, where
none of this applies. The refusal buys not typing prose into a headless process, which is the failure
this whole plan exists to prevent.

### Two Stage B tests were rewritten, not deleted

Both encoded the pre-measurement belief and were left green on purpose by Stage B, flagged in place.
They are now the **pair**, which is the whole point of the fidelity tag: the same command line is a
steerable session on faithful argv and `unreadable` on the `ps` rendering.

- `tests/overseer-harness.test.ts` — the flattened arm is now `ambiguous`, naming `--print`, plus a
  new case asserting the faithful reading of the identical command line.
- `tests/overseer-work.test.ts` — still `null` both times, but the docstring no longer claims the
  second one is safe by accident, and the reading itself is asserted.

## The design: the two rules turn out to be one rule *(SUPERSEDED — see above)*

The two readers end the option region differently — one at the first bare word, one at `--` — and
that looked like a conflict to arbitrate. It is not. **On faithful argv both rules are correct, and
each existing reader is the same rule with one half missing.**

    stop at `--`, or at the first bare word, whichever comes first

On real `/proc` argv the prompt is **one element**, so if there is no `--` the prompt is the first
bare word and the two rules coincide; if there is a `--`, it comes first and is exactly what the CLI
itself does. Neither reader is wrong about its half. They are each incomplete.

Spiked before designing anything: the unified rule against nine constructed cases with the intended
answer written down first, and against every live `claude` on the box, in **both** fidelities.

```
9 constructed cases, 0 wrong.
6 live claude processes; 0 where the unified rule got it wrong (argv or flattened).
```

It fixes all three TypeScript-side divergences as a consequence rather than as special cases:

- **D1** — `--` is honoured, so `-- --session-id B` no longer reads as a second id.
- **D2** — the flattened reader stops at the prompt's first word, so a prompt *mentioning*
  `--session-id` no longer produces a second value, and the pane stops being unaddressable.
- **D6** — `--model opus -p` is caught, because the flag table says `--model` takes a value, so `-p`
  is still inside the option region. That closes `work.ts`'s self-declared KNOWN GAP.

**And it makes the lossy input dramatically safer, which was the unexpected part.** The launcher at
`scripts/gjd-remote.ts` emits `-- "$(cat …)"` before every prompt. A reader that honours `--` never
scans a prompt at all on those command lines — so the `ps` flattening, which is what makes prose
dangerous, stops mattering for exactly the shapes that carry prose. Two of the live processes are
that shape.

### The seam: share the parse, not the verdict

The reader returns a **reading**, and each caller keeps its own policy. This is deliberate, and it
is the answer to "one shared reading that is wrong is worse than two":

*(This shape was superseded before it was built — the four-arm `ClaudeReading` below is what
shipped. The point it makes about policy still stands, and is why the reader returns a reading
rather than a verdict.)*

- `harness.ts` keeps *ambiguous when two ids **differ***.
- `steer.ts` keeps *refuse unless exactly one*.

Both are still true statements about the same parse, and neither has to be talked out of its rule.
The grammar is shared because it is a fact about `claude`; the policy stays local because it is a
fact about what the caller is about to do.

### The rule above is NOT enough — Sol's P1-3, checked and upheld

**Round 1 verdict: revise and split.** The unified rule is right about where the option region ends
and wrong about what is inside it, because it assumes **every flag takes at most one value** and that
**the first bare word is the prompt**. `claude --help` on 2.1.263, read today, says otherwise:

- **Variadic flags.** `--add-dir <directories...>`, `--allowedTools, --allowed-tools <tools...>`,
  `--betas <betas...>`. One value is a guess.
- **Optional-value flags — eight of them, not the one this paragraph first named.** `--cloud`,
  `-r/--resume`, `-w/--worktree`, `-d/--debug`, `--from-pr`, `--remote-control`, `--teleport`,
  `--prompt-suggestions`. The brackets mean the value may be absent, and **argv cannot say**:
  `--resume foo` is either *resume foo* or *resume, then the prompt foo*.
- **Subcommands — twenty-one with aliases, not the fourteen this paragraph first listed.** `agents`,
  `attach`, `auth`, `auto-mode`, `doctor`, `gateway`, `import`, `install`, `kill`, `logs`, `mcp`,
  `plugin`, `plugins`, `project`, `respawn`, `rm`, `setup-token`, `stop`, `ultrareview`, `update`,
  `upgrade`. **`claude agents` is a command, not a prompt.**
- **But `help` must NOT be treated as one**, though Commander offers it implicitly. Measured:
  `claude help me fix this` **answers the prompt**. A prompt beginning "help" is a thing people type,
  so listing it would turn a real session into a `subcommand` — the refusing direction, on a
  plausible shape.

Measured, because Sol has been wrong before and this changes the design:

```
VARIADIC --add-dir before --print
  claude --session-id A --add-dir one two --print -- prompt
  truth:            headless; steering must be refused
  unified rule:     headless=false ids=[A]        <-- consumes `one`, stops at `two`, never sees --print
  harness.ts today: {"found":"claude-code","claudeSessionId":"A"}

SUBCOMMAND `claude agents`
  truth:            not a steerable session at all
  harness.ts today: {"found":"claude-code","claudeSessionId":null}
```

Two things follow. **These are existing defects, not ones the unification would introduce** —
`harness.ts` gets them wrong today in exactly the same way. And **the plan's own headline claim was
false**: a reader that guesses an arity is not one that "fails loudly when the grammar moves". It
fails quietly, in the granting direction.

### So: recognise a narrow shape, and refuse everything else

Sol's alternative, adopted. Do not model Claude's grammar; **model the shapes this repo owns**, and
return `unreadable` for anything else.

```ts
type ClaudeReading =
  | { kind: "not-claude"; why: string }
  | { kind: "subcommand"; name: string }                    // `claude agents` — not a session
  | { kind: "session"; headless: boolean; sessionIds: readonly string[] }
  | { kind: "unreadable"; why: string };                    // an unknown flag: arity unknown, so refuse
```

An **unknown flag makes the whole reading `unreadable`**, named in `why`. That is the loud failure,
and it is the opposite of the `yargs-parser` fallback the research recommended — right for a general
parser, wrong here, because the consequence of a wrong guess is prose typed into a live terminal.

It costs nothing today: every one of the live command lines uses only `--session-id`,
`--permission-mode`, `--name` and `--`, so the real population still parses confidently. The day
Anthropic ships a flag we do not know, the dashboard says *I cannot read this command line, it has a
`--foo` I do not know* instead of confidently mislabelling the pane. `unreadable` grants nothing and
delivers nothing, so it is fail-closed **and** fail-loud.

**And the wrappers must propagate it** (Sol P1-2). `isClaudeForSession` returning `boolean` collapses
*unreadable* into `false`, and `verifyTarget` then says "no live Claude for this session" — which is
a claim about the fleet when the truth is a claim about our parser. The refusal reason has to be able
to say which.

### Fidelity is a type, not a comment

Naming a boundary function "lossy" does not stop anyone calling it. So the input is tagged:

```ts
type ClaudeCommandLine =
  | { fidelity: "argv"; argv: readonly string[] }          // /proc/<pid>/cmdline, NUL-split
  | { fidelity: "ps-flattened"; argv: readonly string[] };  // `ps args`, quoting already destroyed
```

`isClaudeForSession` — the one verdict that presses Enter in a live pane — accepts only the `argv`
arm, and the compiler refuses to hand it a flattened one. The unknown-flag fallback is
`yargs-parser`'s policy, which `recogniseClaude` already implements by hand: skip the flag, and skip
the next word too unless it looks like a flag.

## Stages

**Reordered after Sol's round 1: Stage C goes first and alone.** It is the only defect that exists
today, it stands on its own, and it does not depend on the reader design that round 1 sent back for
revision.

- **Stage C — the awk probe. DONE, and then fixed again in round 2.** `claudeForSession` in
  `scripts/gjd-remote-tmux.ts`; 14 new
  cases in `tests/gjd-remote-tmux-script.test.ts`, **7 of them watched red** against the old
  substring test. Mutation testing found a **real gap
  the first draft had**: without the empty-value refusal, `--session-id= --session-id <real>` left
  the real one as the first non-empty value and was accepted — a test now holds that. Positive
  control: all 6 live `claude` processes, old rule and new rule both yes for their own id, so no
  regression on real traffic. `mawk` agrees with `gawk` on all 15 shapes, so the function is not
  gawk-specific. Verified independently before commit: the basename gate mutated → 7 tests red;
  reverted → 43/43 green.

  **The equivalent-mutant claim in the paragraph above was wrong, and this is the correction.** It
  said the dash-leading `--session-id` guard was an equivalent mutant — that *no command line can
  distinguish it from its absence, because a dash token can never equal a uuid*. That reasoning
  holds only while every session id **is** a uuid, and `CLAUDE_SESSION_ID` is an environment
  variable a person sets: `sessionState` has a whole arm for the hand-set case
  (`not-a-session-id`). With the id set by hand to `-x`, `claude --session-id -x` tells the guard
  from its absence, and a test now does exactly that. The same sentence appeared in the Stage C
  commit message; it is wrong there too.

  **Round 2 (GPT Sol, "request changes"), and what each finding became.** Three of the checkable
  ones were reproduced by hand against the real function under **both gawk and mawk** before
  anything was changed:
  - **F1c, the false negative, and it is the expensive direction.** `claude --session-id A Please
    compare --session-id B` — a prompt with **no `--`**, which is what a person types — read as *no
    claude in this pane*. The shape is live: the process census that day found
    `claude --session-id <uuid> Run get-ready-for-deploy.md, i.e. pull latest …` running on the box.
    **The rule taken: stop at the first bare word, but only once an id has been seen.** Before an id
    a bare word may be the value of a flag the awk does not recognise (`--permission-mode auto
    --session-id A`), and stopping there would lose the id; after one, everything the launcher puts
    before the prompt is behind us. The rejected alternative is an **arity table mirroring
    `claude-argv.ts`** — honest, and it would also fix the two holes the cheap rule leaves, but it is
    a second copy of a table that must track a CLI we do not own, in a language that cannot import
    it, to sharpen a probe whose worst outcome is a mislabelled row. Skipping unknown tokens rather
    than guessing an arity is the awk's one advantage over the typed readers, and this keeps it.
    **What it does not fix**, both in the granting direction and both asserted by tests so they stay
    visible: a prompt quoting this pane's own uuid in a claude carrying no id of its own is still
    read as this session's; and a second, differing id behind an unknown flag's value is never
    reached, so the all-must-agree rule does not fire on it.
  - **F2, and it is a property of awk rather than of the grammar.** `==` compares **numerically**
    when both sides look like numbers, and both `-v` and `split()` produce exactly that kind of
    value, so `01` and `1` were the same session id — in gawk and mawk alike. Every id comparison is
    now written `(x "") == (y "")`, including the duplicate-agreement check.
  - **F3, the two spellings, and they are meant to disagree.** `--session-id=-x` is one token and
    says the value is `-x`; `--session-id -x` cannot say whether `-x` is the value or the next flag.
    `tools/fleet/claude-argv.ts` makes exactly this distinction — dash-led next token ⇒ refuse
    (`claude-argv.ts:330`), non-empty inline value ⇒ accept (`:320`). So "make the two spellings
    agree" would have meant **making the awk disagree with the shared reader** in one spelling or
    the other, which is the divergence this whole plan exists to remove. Left asymmetric, said so in
    the comment, and both spellings now have a test.
  - **F1a and F1b are not fixable over a flattened `ps` string, so they are written down instead.**
    An empty argv element (`["claude","--session-id","",A]`) prints with a doubled space and the
    caller's `$4…$NF` rebuild collapses it; an option value containing an option
    (`["claude","--name","innocent --session-id A"]`) prints identically to three real arguments.
    Both need a deliberately hostile launch, and what they buy is a mislabelled row, not a delivered
    keystroke — nothing steers on this verdict. The comment now says that, and says that `argv[0]`
    text is a claim rather than an identity (`cp $(which bash) /tmp/claude` passes).
  - **F4, the tests.** Now **91**, every one of them run under **gawk and mawk automatically** —
    `awk` is stubbed on the script's PATH, so the whole script is exercised under each, not only the
    probe. New cases: a doubled separator, whitespace inside an earlier option's value, a hand-set
    numeric id both ways round, a hand-set dash-leading id in both spellings, `myclaude` /
    `/tmp/claude-wrapper` / `claude.sh`, `--session-id-<uuid>` and `--session-id-extra=<uuid>`, mixed
    inline/separate duplicates, and the two limitations named above. **The parameterisation was
    itself checked by making it fail**: pointing the `mawk` stub at `/bin/false` reddens exactly the
    31 cases of the `mawk` block and none of the `gawk` one, so the shadow is real, PATH-first, and
    per-implementation rather than two names for the same binary.
  - **F5, four overstatements**, all corrected. Three in the awk comment: `ps` "joined with single
    spaces" (false for an empty argv element), "EVERY occurrence is the same" (it is every
    occurrence the scan **reaches**), and the equivalence claim above. The fourth was next door in
    `tests/gjd-remote-tmux.test.ts`, whose docstring said the id was matched "by string equality" —
    which is what `==` looks like and is not what it did.

  **Round 2 evidence.** Red first: the four new expectations failed 8 times (4 cases × 2 awks) before
  the fix — `expected { kind: 'busy' } to deeply equal { kind: 'claude' }` for F1c, and the reverse
  for F2 — then 91/91 green. **Thirteen mutants, thirteen killed, no survivors**; two of them
  survived the first pass and each earned a test that a real shape motivates: deleting the bare `--`
  boundary (invisible until a prompt begins with a dash-led word, because the new bare-word rule
  stops at the same place on every other prompt), and widening the inline prefix match from
  "starts with" to "contains anywhere". The mutation harness itself lied first — `--reporter=basic`
  does not exist in vitest 4, so the run never started and all thirteen mutants "survived" with zero
  failures; it now refuses a run that does not report all 91 tests.
  Positive control re-run: 5 live `claude` processes, old rule and new rule both yes for their own
  id under both awks, so the change is durability rather than a repair to live traffic.

  Original brief: check the basename of word one,
  scan exact tokens only until a bare `--`, accept both `--session-id ID` and `--session-id=ID`, and
  apply the D2 rule below. **Teach the awk; do not ship the process table back** — Sol's P2-1, and
  the reason is better than the one I had: the raw `ps` blob is not currently sent home at all, only
  a reduced per-session `proc`, so moving the decision into TypeScript would widen the wire to carry
  **every process's flattened argv, prompts and possibly secrets included**, over ssh, to fix a
  labelling bug. Document in the awk that it recognises a launcher-owned shape rather than
  reconstructing argv.
- **Stage A — the shared reader. DONE, and revised in round 2** after a second cross-family review:
  [what changed](#stage-a-round-2-what-the-second-review-changed). `tools/fleet/claude-argv.ts`, a
  true leaf with **no imports at all**; 67 tests in `tests/fleet-claude-argv.test.ts`; **20 mutants,
  1 of them equivalent, 0 real survivors**. Entry criterion
  for the flag table: *a producer in this repo emits it*, so nothing's arity is guessed from a help
  page we do not control. All eight optional-value flags are deliberately absent and land in
  `unreadable`.

  **Variadic flags are IN the table, with a rule**, and the reasoning is better than leaving them
  out: `--tools`, `--allowed-tools` and `--add-dir` are what `run-claude.ts` emits, so excluding them
  would make **every `run-claude` process unreadable** — our own producer, and the shape `work.ts`'s
  headless recogniser exists for. So a variadic is read greedily **only when the line has a bare
  `--`**; with no separator it is `unreadable`, naming the flag. `buildClaudeArgs` always emits `--`,
  so the real population parses, and `claude --add-dir /a tell --session-id <other> to stop` refuses
  rather than handing over an id it read out of prose.

  Verified independently before commit — the case that killed the old design now reports
  `headless=true`; `claude agents` is a `subcommand` and `claude help me fix this` is a `session`;
  an unknown flag is `unreadable` naming itself; and all 5 live processes read as a clean `session`
  with both fidelities agreeing.

  **↳ Round 2 rewrote the boundary rule and deleted `one-free-text`. Everything from here to the end
  of this bullet is round 1 and is kept for the reasoning; read
  [Stage A round 2](#stage-a-round-2-what-the-second-review-changed) for what is true now.**

  **A shape our own launcher makes, found during Stage C.** `scripts/gjd-remote.ts:2563` emits
  `--name ${shq(name)}` **before** the `--`. On faithful argv that is one element. On the flattened
  arm the quoting is gone, so a **multi-word session name** makes `--name` look like a flag taking
  four values: a one-value table consumes the first word, meets the second as a bare word, calls that
  the boundary, and **stops scanning early** — so a `--print` after `--name` is missed, on the arm
  that feeds `harness.ts`. It costs nothing today (the live sessions are provisional and carry no
  `--name`, or a single-word one), but it is ours, and it is the case where an arity table and a
  lossy rendering genuinely conflict. This is the strongest argument for the fidelity tag being a
  *type* rather than a label: the same flag can have a known arity on `argv` and an unknowable one on
  `ps-flattened`, and the reading should be able to say so. The awk is immune only because it skips
  unknown tokens rather than assuming arity — the trade this stage rejects.

  **Settled, as a new arity `one-free-text` — and UNSETTLED in round 2, twice over.** The three
  endings below are **not exhaustive and one of them is wrong**: Sol's ARGV-03 found a fourth,
  `--name my mcp`, where the run swallows a *subcommand* — and the inline `--name=my mcp` swallowed
  one too, though it had already bounded its own value. The second ending is also false as stated:
  `claude --name my mcp -- --help` still dispatches `mcp`, so a `--` ahead does not mean the launcher
  bounded the value. The arity is gone; see round 2. What follows is round 1's reasoning:
  - the run reaches the end of argv → **readable**. This keeps `claude --session-id U
    --permission-mode auto --name my session` working — a named session with no prompt, which
    `new-claude` produces. Refusing it was the expensive direction.
  - the run stops at a dash-led token **with a `--` ahead** → **readable**; the launcher bounded the
    prompt itself.
  - the run stops at a dash-led token **with no `--`** → **`unreadable`**, naming the flag and the
    token. That is `--name my session --print`: nothing says which side of the name that token is
    on. It also stops `--name my session tell --session-id <B> to stop` handing over `B`.

  `--name` is the only free-text value in the table; every other one-value flag takes a uuid, a
  number, or a word from a fixed set. That is stated as a **fidelity-dependent property** in three
  places in the module and has a faithful/flattened contrast pair in the tests.

  **A known limitation, measured and written down rather than guessed.** Subcommand dispatch is not
  as clean as "`claude agents` is a command": `claude mcp` and `claude --session-id <uuid> mcp` both
  dispatch, while `claude logs <bad-id>` errors instantly but the same line behind `--session-id` or
  `--permission-mode auto` produced nothing for 20 seconds. So a prompt *beginning* with a subcommand
  word may be read as a subcommand. It is fail-closed — `subcommand` grants nothing — and the module
  header carries the measurements and says plainly that the behaviour is not fully explained.
- **Stage B — all three TypeScript consumers onto it. DONE**, and all three: `recogniseClaude`,
  `isClaudeForSession`, **and `RECOGNISERS["claude-headless"]` in `work.ts`** (Sol P1-2 — Stage B as
  first written left D6 alive while claiming to have removed the class). The refusal reasons carry
  *unreadable* distinctly from *no claude here*.

  **`work.ts` was wired, and it was not the awkward fit the brief allowed for.** `WorkRecogniser.args`
  already accepts `RegExp | ((args: string) => boolean)` and `codex-exec` already uses the function
  arm, so this is one substitution and D6 closes as a consequence rather than as a special case. The
  import direction is `tools/overseer/` → `tools/fleet/`, which already existed via `wire.ts`, and
  `claude-argv.ts` has no imports at all, so nothing widened.

  **`argvOf` really was `fromProcCmdline` minus the tag** — same split, same trailing-empty pop, same
  reason for keeping an interior empty — checked line by line before deleting it. The one assertion
  its test held that the shared module's did not (`"claude\0\0\0"` → a RUN of trailing empties) moved
  into `tests/fleet-claude-argv.test.ts` rather than being dropped.

  **Four refusal codes' worth of behaviour changed, three of them settled below and one not.** D1,
  D2 and D5 are in the table. The fourth falls out of Stage A's `one-free-text` rule and is worth
  naming because it is the only one that costs availability: on the `ps`-flattened arm a `--name`
  whose value runs into a prompt with no `--` is `unreadable`, so the captured
  `quiet-claude-pane.txt` — a real pane, `--name cheap-postmortem-preventions Build a batch of …` —
  now classifies `unknown` instead of `claude-code`, and the dashboard would refuse to message it.
  **The plan's Stage A note that this "costs nothing today (the live sessions … carry no `--name`,
  or a single-word one)" is wrong about the second half**: a single-word name is exactly as
  unreadable, because `ps` cannot say it was one word. What actually makes it cost nothing is
  `scripts/gjd-remote.ts`'s F10 fix earlier the same day — every prompted launch now emits `--`
  before the prompt, all five live `claude` processes read as a clean `session` on both arms, and
  that capture predates it. The test carries both halves: the capture as it is, and the same row
  with the separator the launcher writes today.

  **GPT Sol's ARGV-05 was fixed rather than reported, and it is three lines in `claude-argv.ts`.**
  `fromProcCmdline` returned the whole `ClaudeCommandLine` union and neither arm had a name, so no
  caller could ask for the faithful one and the compiler could refuse nobody — the fidelity tag was a
  label after all, which is the one thing the module header says it must not be. Each arm is now an
  exported type (`FaithfulCommandLine`, `FlattenedCommandLine`) and each constructor returns the arm
  it builds. Verified by making the error happen: handing `isClaudeForSession` a `fromPsArgs` result
  is `TS2345`, seen, then reverted.

  **What Stage B deliberately did NOT encode: where the option region ends.** Measured on 2026-09-08
  against real `claude` 2.1.263, the CLI PERMUTES — `claude some-prompt --version` prints the
  version, and `claude say-only-OK --print --model definitely-not-a-real-model` reaches the model
  check — so options are read anywhere except after a bare `--`, and "the option region ends at the
  first bare word" is false of the tool. Every test written here depends on the four arms of the
  reading, never on how they are computed, and each one is either flags-only or `--`-bounded. Two
  PRE-EXISTING tests do assert the false claim (`tests/overseer-harness.test.ts`'s "a `--print`
  inside the PROMPT…" and `tests/overseer-work.test.ts`'s "…even when the prompt says --print").
  They are left green and flagged in place rather than changed, because changing them means deciding
  the semantics, which is Stage A round 2's job. **A green test there is not evidence.**

  **Round 2 landed its red tests in this tree while Stage B was being written, and its
  implementation had not.** So `tests/fleet-claude-argv.test.ts` is red — fifteen tests, every one of
  them round 2's (`--version` as a subcommand, a flag after a positional, an empty `--session-id`
  value, the trailing-empty rule) and none of them in Stage B's files. Stage B's own three suites
  are green. That separation is the design working rather than luck: every test written here asserts
  a consequence of one of the four ARMS — what `HARNESS_CAPABILITIES[…].steerWithProse.can` says,
  what `verifyTarget` returns — and none asserts how an arm is computed, so the boundary rule can
  move underneath without any of them having to be rewritten. The two tests that WILL go red when
  round 2's implementation lands are the two pre-existing ones flagged above, and they should.

  Mutation testing at the end, four mutants, all killed: `unreadable` collapsed back to `no` (3
  red), the headless refusal dropped (2 red), the first id taken instead of requiring agreement (4
  red across two suites), and the `--` stop skipped (5 red). The last one found a real gap — it was
  killed by `harness` and `claude-argv` and **not** by the steer suite, the one file that presses
  Enter, because both of steer's `--` assertions happened to give the same answer either way. The
  discriminating case (`claude -- --session-id <ours>`, a claude with no id option at all whose
  prompt begins with those words, which a walked-through separator would hand over) is now asserted
  there with its pair.

### Stage B round 2 — the wiring reviewed, and two of the three were real

A cross-family review (GPT Sol) of Stage B's wiring returned two P0s and a P1. Two are fixed, one is
weighed and written down instead. Everything below was measured on the box on 2026-09-08.

**ARGV-P1-01 — a bare `--` inside a flattened prompt was the option separator, so the `--print`
after it was never seen.** The original bug of this whole plan, arriving through the one token the
round-2 boundary rule had exempted:

```
real argv: ["claude","--session-id",A,"Please explain -- carefully","--print"]
  faithful  -> session, headless=TRUE      correct: claude really does parse that --print
  flattened -> session, headless=FALSE     wrong, and `steerWithProse` grants on it
```

The exemption had a written argument — *stopping at a `--` after a positional is safe under both
readings, because if the prompt really is one element then nothing after it was a flag anyway* — and
its first half is false: a prompt being one element does not make it the LAST element. Same class as
[260908f](../postmortems/260908f-a-correct-comment-contradicted-by-the-line-beneath-it.md), a claim
of impossibility made against the space the author had in mind.

**It fell out as one condition, not two.** The flattened-ambiguity rule now runs in the scan over
every dash-led token, ahead of the separator, instead of inside `readFlagToken` — which could only
ever see the tokens that reached it, and a `--` never did. The rule is now literally *on a `ps` line,
once an unconsumed positional has appeared, every dash-led token is `unreadable`*.

**What it costs, measured rather than asserted.** Census of `/proc` on this box: **6 live `claude`
processes, 0 of them changed by the rule** — the one carrying a `--` has it at argv[7], after
`--name`'s value and before the prompt, which is where both producers put it
(`gjd-remote.ts:2565`, `run-claude.ts:326`). One PRE-EXISTING test did change, and it is worth
naming: a flattened `--name my session -- go and do the thing` is now `unreadable`. **No producer
can emit it** — a session name cannot contain a space (`gjd-remote.ts:2462` and
`tools/fleet/routes-new.ts:376` both refuse anything but `^[a-z0-9][a-z0-9-]{0,40}$`), which also
corrects a comment in `claude-argv.ts` that read the launcher's `shq(name)` as evidence that names
hold spaces. The narrower rule that would have kept it — refuse only when a dash-led token FOLLOWS
the ambiguous `--`, which is exactly when the two readings disagree — is named and rejected in the
module header: a second condition and a lookahead, to buy back a shape nothing can produce.

**STEER-P0-01 — a competing Claude under the same pane, and Stage B is what lost the information.**
`verifyTarget` accepted the first candidate returning `yes` and stopped. Sol's sequence: outer Claude
A starts a descendant Claude B whose prompt quotes A's uuid, so `pgrep` returns both; A reads `yes`,
B reads `no` because B's session id is B's; the loop takes A whatever the ordering — and **B owns the
visible terminal**, showing an ordinary empty input box that the screen check approves. A's message
is typed at B. That is "the right text delivered to the wrong session", which the file's header names
as the failure it exists to prevent.

The cause is the one to act on: the `no` arm had collapsed *not a `claude` at all* (a wrapper shell,
a `grep`) into *a different live conversation*, and nothing downstream could get the distinction
back. So:

- **a fifth arm, `other-claude`**, on `ClaudeForSession` in `steer.ts`. `no` now means *nothing a
  keystroke in this pane could reach* — not a claude, a subcommand, or **a claude for another
  conversation running headless**, which read its prompt at exec and never looks at a tty.
  `other-claude` is a live interactive claude that is not ours: a different id, ids that differ, or
  no id at all.
- **the loop no longer breaks**, and records the first of each kind rather than depending on pid
  order, into a named `PaneCandidates`.
- **a new `RefusalCode`, `competing-claude`** (409 in `REFUSAL_STATUS`), returned by `contendedPane`
  when our session is verified AND a competitor is present. An unreadable second candidate refuses
  too, as `claude-unreadable`, because "we cannot read it" is not an answer that permits a keystroke.
- **`no-claude-in-pane` is unchanged as a code** — a pane holding only somebody else's conversation
  is still "no claude for yours in there" — and its sentence now names what IS under the pane.

**What the refusal costs, measured.** Two censuses. A single `/proc` + `tmux list-panes` pass: 13
panes, 6 with a `claude` descendant, **0 with more than one**. Then a sampler every 5 seconds for 10
minutes: **120 samples, 6 claudes throughout, 0 nested claude-under-a-claude in any of them**. So a
blanket refusal costs nothing today, and the headless exemption is what keeps it that way — it is
`run-claude.ts`'s sub-runs that put a second claude under a delegating session's pane, and those are
`--print`.

**The residual gap, stated in the header rather than implied away.** Candidates come from
`pgrep -f -- <uuid>`, so a competing claude whose argv never mentions this uuid — a plain `claude`
somebody started in the pane by hand — is not in the list and is not refused. Widening to every
descendant of the pane would see it, at an argv read per descendant, for a launch nothing in this
repo performs.

**STEER-P0-02 — the pid-reuse splice: DOCUMENTED, NOT FIXED, and the reasoning is in the file's
KNOWN GAPS.** The ancestry snapshot and the per-candidate `/proc/<pid>/cmdline` read are two
observations with nothing binding them to one process generation. Measured: `pid_max` is 4,194,304
and this box forked 3,842 processes in 60 seconds (64/s) at an ordinary load, so the pid space wraps
about every **18 hours**, against a window of well under a millisecond — and the recycled pid would
ALSO have to be a `claude` carrying this exact uuid before the splice granted anything. Three reasons
not to build the `/proc/<pid>/stat` start-time check, and the third decides it: it widens `SteerIo`'s
contract for a race nobody has seen; **it would not be complete anyway**, because the ancestry walk
reads every intermediate parent from the same snapshot and binding those needs a start time per row,
not per candidate; and `steer.ts:51` already documents a structurally identical, LARGER race — a pane
respawn between the last check and `send-keys`, needing no pid wrap at all — as unclosable and
accepted. A partial fix that reads as a complete one is worse than a paragraph, because the next
person stops looking. The paragraph names its domain: on a kernel with the old 32,768 `pid_max` the
wrap is minutes rather than hours and the arithmetic moves three orders of magnitude.

**TEST-P3-01 — a comment stating the old policy**, at `tests/fleet-claude-argv.test.ts`'s
duplicate-id case: *"`steer.ts` wants to refuse any repeat"*, which stopped being true when Stage B
took D2. Corrected, with what the occurrence list is actually still for (`A A B`). A sweep of the
touched files found four more of the same shape, all corrected: `isClaudeForSession`'s "**THIS
RETURNS FOUR ANSWERS**" (five now), `verifyTarget`'s "a box with forty agents on it reads one
`cmdline`" (it reads every candidate under the pane now, deliberately), `REFUSAL_STATUS`'s "a
thirteenth `RefusalCode`", and the `--name` comment above.

**Red first, and both were live grants.** The steer test refuses through the real `sendMessage` with
a paired positive control that sends, and its red was
`expected a refusal, got a send of [["send-keys","-t","%10","-l","--","keep going"],["send-keys","-t","%10","Enter"]]`
— the message really went out. The argv/harness reds were
`expected 'claude-code' not to be 'claude-code'` on `classifyPaneHarness`, whose `claude-code` is
what `HARNESS_CAPABILITIES` grants prose steering on.

**Mutation: 9 mutants, 9 killed, 0 survivors, 0 void.** Baseline 347 tests across six suites, and
347 again after every revert.

| mutant | red |
|---|---|
| M1 flattened `--` exempted again (the ARGV-P1-01 bug exactly) | 3 |
| M2 whole flattened-ambiguity rule deleted | 9 |
| M3 rule armed on every dash-led token, positional or not | 33 |
| M4 rule applied on the faithful arm too | 5 |
| M5 `other-claude` collapsed back into `no` | 2 |
| M6 `competing-claude` refusal dropped | 1 |
| M7 first-match-wins restored (a competitor seen before ours is forgotten) | 1 |
| M8 a headless claude for somebody else counted as a competitor | 2 |
| M9 the unreadable-second-candidate refusal dropped | 1 |

M6, M7 and M9 are each held by ONE assertion, which is the low-kill-count signal this plan's Stage A
report says to write down: those three rules have no second witness. **The harness lied first, and
its own check caught it** — the summary line arrives wrapped in ANSI escapes, so the parser read a
green run as "no summary at all"; because it refuses a run whose test count does not match the
baseline, that surfaced as a hard stop rather than as nine survivors. That is the failure mode a
sibling agent shipped a table from the day before.

### The behaviour choices, settled

| | rule that wins | why |
|---|---|---|
| **D1** bare `--` | `steer.ts` | Stop scanning; everything after is positional. Fixes a shape the launcher generates on every prompted run, and no legitimate flag is lost. |
| **D2** duplicate ids | `harness.ts`, **corrected** | Accept when *every* occurrence is the same non-empty id; refuse if any differ or any is missing its value. Availability without risk: first-and-last semantics converge on one value. The fix is a set over all occurrences before the boundary, with a three-or-more test. |

**D2's defect, measured rather than quoted.** Sol's P2-2 said `recogniseClaude` "compares only the
first two". True, and the consequence is narrower and stranger than that phrasing suggests — it
destructures `const [first, second] = sessionIds` and compares exactly those, so **a third differing
id is invisible only when the first two agree**:

```
A B      (two, differing)   -> ambiguous
A A      (two, identical)   -> claude-code A
A A B    (odd one LAST)     -> claude-code A     <-- WRONG, and in the granting direction
B A A    (odd one FIRST)    -> ambiguous
A B A    (odd one MIDDLE)   -> ambiguous
```

So two of the three three-id orderings are already caught, and the position of the odd one decides.
That is worth writing down because "compares only the first two" reads as *ignores everything after
the second*, which would have predicted `B A A` to be accepted too. It is not. A test suite built
from the looser description would have tested the wrong ordering and passed.
| **D5** `--print` | `harness.ts` | Headless beats session identity, and steering is refused. Low urgency, right invariant. Sol: *"not overstated as a correctness rule; it would be overstated only as justification for urgency."* |

**Two of these were live grants, not latent ones, and the red tests are the proof.** The plan says
of D5 that "a screen check downstream masks it", which was read as *nothing bad happens today*.
Written as an end-to-end `sendMessage` against the fixture of a working input box — the ordinary
state of a healthy pane — both of these **sent the message** before Stage B:

```
FAIL  refuses `--print` before the id, and sends when it is not there
      Error: expected a refusal, got a send of
        [["send-keys","-t","%10","-l","--","keep going"],["send-keys","-t","%10","Enter"]]

FAIL  names the flag that lost us, and does not claim the pane is empty
      Error: expected a refusal, got a send of
        [["send-keys","-t","%10","-l","--","keep going"],["send-keys","-t","%10","Enter"]]
```

The second is the unknown-flag case (`claude --dangerously-skip-permissions --session-id <ours>`)
and is the sharper of the two: the old reader skipped the flag it did not know, read the id after
it, and granted. The screen check masks D5 only while the pane happens not to be showing an input
box, which is a coincidence about timing rather than a guard.

### What the tests must be

Sol's P2-3, taken: **the seven live captures are a seed corpus, not a drift detector.** They contain
none of the discriminating D2 or D5 shapes — a suite made only of them would be green on every bug in
this document. So: real captures as positive fixtures, **plus** constructed adversarial cases,
**plus** consequence-level assertions — what the capability table grants, what `verifyTarget` does —
rather than assertions on the parser's return value alone.

## The library question, and why the answer is "none"

**ROUND 2 CORRECTION, and it is the interesting kind: the decision survives, the criterion that
produced it does not.** This section shortlisted on *stop at the first non-option argument*, and
`claude` has no such rule — so the feature every candidate was scored on is one we now do not want,
and `parseArgs` was condemned below for behaving **exactly as the real CLI behaves**. What actually
decides it, restated after the measurements:

1. an **explicit arity table** — unchanged, and still the thing frameworks cannot give;
2. **refuse an unknown flag rather than guess its arity** — no general parser does this, because a
   parser exists to produce an answer;
3. **express two fidelities of the same command line and give them different answers** — nothing
   off the shelf has a concept for it, and it is the rule this module turns on.

Only (1) is a library feature at all. So: still hand-written, now for reasons that are true. The
research below is kept as it was written — the dividing line it found between `arg` and
`yargs-parser` is real, and how it was found is worth reading.

Researched against [third-party-library-selection.md](../reusable/third-party-library-selection.md)
on 2026-09-08. Two requirements decide it: can the parser be told to **stop at the first non-option
argument**, and can it be given an **explicit table of which flags take values**. Weekly downloads
and last-publish dates were checked, because "lots of pretraining data" is the first criterion.

| candidate | stops at first positional | flag table | verdict |
|---|---|---|---|
| `node:util.parseArgs` | **no** | yes | disqualified — see below |
| `arg` | `stopAtPositional` | yes | disqualified — see below |
| `yargs-parser` | `halt-at-non-option` | yes | passes technically; buys nothing |
| `minimist` / `mri` | `stopEarly` / absent | yes | unmaintained (2023-02, 2021-09) |
| `commander` / `citty` | no bare primitive | wrong shape | frameworks for authoring a CLI, not reading one |

**Node's built-in is disqualified by measurement, not by argument.** Run live on this box's Node
v26.8.1 with `strict:false, allowPositionals:true`, `parseArgs` on
`['--session-id','abc','Please','add','a','--print','flag']` returns **`values.print === true`** —
`--print` read as a real flag from inside the prose. That is the exact false grant `recogniseClaude`
was fixed to prevent. `tokens:true` does carry enough to stop at the first positional yourself, but
using it means writing `recogniseClaude`'s walking loop again against a different data shape.

> **Round 2: this paragraph is measured correctly and reasoned backwards.** `parseArgs` permutes
> because **`claude` permutes**, and on those seven tokens — which is a `ps` rendering — `print:true`
> is one of the two honest readings, not a false grant. The correct answer there is *unreadable*, and
> `parseArgs` is disqualified for being unable to say that, not for the value it returned. Left in
> place because it is a clean specimen of a measurement read through a false premise: the number was
> right, the sentence after it was not, and the sentence is what got quoted.

**The finding that actually decides it**, and it is in no README:

> "Unknown flag consumes the next bare word" is the load-bearing default. It is what lets an
> unrecognised *future* Anthropic flag not derail a stop-at-first-positional scan — and it is a
> genuine dividing line: `yargs-parser` has it, `arg` does not, though both advertise an
> equivalent-sounding feature. It only shows up by reading the parsing loop.

So `arg`'s `stopAtPositional`, the one purpose-built primitive for this exact class, **fails**: in
permissive mode it pushes an unknown flag to positionals without eating its value, so a future
value-taking flag makes the scan halt on that value and never reach the session id. `yargs-parser`
survives all four criteria — and adopting it means writing out `boolean:['print'],
string:['session-id'], alias:{p:'print'}`, which *is* Claude's grammar restated in yargs-parser's
vocabulary. It also ships no types of its own, and `@types/yargs-parser` is pinned a major version
behind the current API, which is poor company for a `strict` codebase.

**Decision: hand-written, in this repo, with an explicit flag table.** The existing
`recogniseClaude` heuristic — skip an unknown flag, and skip the next word too unless it looks like
a flag — turns out to be the same policy `yargs-parser` implements for the same reason. That is
worth knowing: the code was right, it just was not shared, named, or tested as a grammar.

A third requirement falls out of the same research and belongs in the module's header: **the
`stop-at-first-positional` rule and the `which-flags-take-values` table are not independent
features when the flag set is only partly known.** They interact, and that interaction is what
disqualified `arg`. Anyone re-running a feature checklist against a parser for a foreign CLI needs
to test the pair, not the two boxes.

> **Round 2: the general lesson holds, the specific pair is gone.** There is no
> `stop-at-first-positional` rule in this module any more, so it is not in the header. What replaced
> it is a pair of the same shape — *where the option region ends* and *what the input's fidelity is*
> — which interact for the same reason: the arity table is only partly known, so an unreadable token
> has to be able to stop the whole reading. Checklist features that look independent on a README
> interact once the grammar is foreign.

## The simpler option, named

Do nothing. Zero disagreements on the live box today, and the shapes that diverge are rare. The
reason not to take it: `claude`'s flag set is **not ours**, and the next flag that takes a value gets
handled in one reader and not the others, silently. The failure is a message delivered to the wrong
agent or withheld from the right one — the cost each of the previous sixteen joins paid once. The
awk probe alone (D3) justifies a stage on its own merits.
