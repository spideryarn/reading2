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
| where | `tools/overseer/harness.ts:368` | `tools/fleet/steer.ts:667` | `scripts/gjd-remote-tmux.ts:520` |
| asks | what harness is this, and is it headless? | is this the claude for *this* conversation? | is a Claude alive under this pane? |
| input | `args: string` — `ps args`, **quoting already lost** | `readonly string[]` — `/proc`, **faithful** | `ps args` inside awk, flattened a third time |
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
  running.
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

**It cannot reach the awk.** `gjd-remote-tmux.ts:520` runs inside a heredoc'd shell script over ssh.
Fixing it means teaching the awk the `argv[0]`-and-exact-token rule, or moving that decision off the
box into TypeScript over the `ps` blob it already ships back.

## Stages

- **Stage A — the shared reader.** One module, one grammar, an explicit table of which `claude`
  flags take a value, `readonly string[]` in, a discriminated union out that can say *headless*,
  *this conversation*, and *I cannot tell* separately. Fixtures from the live corpus. Tests that
  assert on the **consequence** (what the capability table grants, what `verifyTarget` does) and not
  only on the parser's return value.
- **Stage B — both TypeScript call sites onto it.** `isClaudeForSession` keeps its name, signature
  and exact semantics; its body becomes a call. `recogniseClaude` likewise. Any behaviour change —
  D1, D2, D5 — is a deliberate, separately-argued line in this doc, not a side effect.
- **Stage C — the awk probe.** The only live defect. Decide between teaching the awk and moving the
  decision into TypeScript, and say why in this doc.

Library choice for the parsing itself: **pending** — research running against
[third-party-library-selection.md](../reusable/third-party-library-selection.md). The requirement
that will decide it is whether a candidate can be told to **stop at the first non-option argument**
and be given an **explicit table of which flags take values**; a parser that guesses either is the
bug class we are removing.

## The simpler option, named

Do nothing. Zero disagreements on the live box today, and the shapes that diverge are rare. The
reason not to take it: `claude`'s flag set is **not ours**, and the next flag that takes a value gets
handled in one reader and not the others, silently. The failure is a message delivered to the wrong
agent or withheld from the right one — the cost each of the previous sixteen joins paid once. The
awk probe alone (D3) justifies a stage on its own merits.
