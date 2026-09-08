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

## The design: the two rules turn out to be one rule

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

- **Stage C — the awk probe. DONE.** `claudeForSession` in `scripts/gjd-remote-tmux.ts`; 14 new
  cases in `tests/gjd-remote-tmux-script.test.ts`, **7 of them watched red** against the old
  substring test. Nine mutants: eight killed, one an equivalent mutant (a dash-leading `--session-id`
  value — no command line can distinguish it, because a dash token can never equal a uuid and the
  all-must-agree rule refuses anyway; the line stays because it states the grammar where the grammar
  is read, and the comment says a test does not hold it). Mutation testing also found a **real gap
  the first draft had**: without the empty-value refusal, `--session-id= --session-id <real>` left
  the real one as the first non-empty value and was accepted — a test now holds that. Positive
  control: all 6 live `claude` processes, old rule and new rule both yes for their own id, so no
  regression on real traffic. `mawk` agrees with `gawk` on all 15 shapes, so the function is not
  gawk-specific. Verified independently before commit: the basename gate mutated → 7 tests red;
  reverted → 43/43 green.

  Original brief: check the basename of word one,
  scan exact tokens only until a bare `--`, accept both `--session-id ID` and `--session-id=ID`, and
  apply the D2 rule below. **Teach the awk; do not ship the process table back** — Sol's P2-1, and
  the reason is better than the one I had: the raw `ps` blob is not currently sent home at all, only
  a reduced per-session `proc`, so moving the decision into TypeScript would widen the wire to carry
  **every process's flattened argv, prompts and possibly secrets included**, over ssh, to fix a
  labelling bug. Document in the awk that it recognises a launcher-owned shape rather than
  reconstructing argv.
- **Stage A — the shared reader. DONE.** `tools/fleet/claude-argv.ts`, a true leaf with **no imports
  at all**; 48 tests in `tests/fleet-claude-argv.test.ts`; **8 mutants, 0 survivors**. Entry criterion
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

  **Settled, as a new arity `one-free-text`.** One value on `argv`, unknowable on `ps-flattened`,
  where the value is a run of bare words. Three endings, and only one is refused:
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
- **Stage B — all three TypeScript consumers onto it**, not two: `recogniseClaude`,
  `isClaudeForSession`, **and `RECOGNISERS["claude-headless"]` in `work.ts`** (Sol P1-2 — Stage B as
  first written left D6 alive while claiming to have removed the class). The refusal reasons carry
  *unreadable* distinctly from *no claude here*.

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

### What the tests must be

Sol's P2-3, taken: **the seven live captures are a seed corpus, not a drift detector.** They contain
none of the discriminating D2 or D5 shapes — a suite made only of them would be green on every bug in
this document. So: real captures as positive fixtures, **plus** constructed adversarial cases,
**plus** consequence-level assertions — what the capability table grants, what `verifyTarget` does —
rather than assertions on the parser's return value alone.

## The library question, and why the answer is "none"

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

## The simpler option, named

Do nothing. Zero disagreements on the live box today, and the shapes that diverge are rare. The
reason not to take it: `claude`'s flag set is **not ours**, and the next flag that takes a value gets
handled in one reader and not the others, silently. The failure is a message delivered to the wrong
agent or withheld from the right one — the cost each of the previous sixteen joins paid once. The
awk probe alone (D3) justifies a stage on its own merits.
