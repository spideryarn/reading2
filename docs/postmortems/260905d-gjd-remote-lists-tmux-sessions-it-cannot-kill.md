# `gjd-remote` listed tmux sessions it could not kill

Eight sessions nobody recognised were sitting on the box, and two of them could not be ended by the
tool that was showing them.

> But there are a few that are weird, e.g. `stageDbase`, `gateA`. If I try and resume them, it says
> that the session doesn't exist. If I try and kill them, it doesn't work. See if you can figure out
> what they are, how they got created, kill them if safe to do so, and fix things so they won't pop
> up again.
>
> — Greg, 2026-09-05

## What was actually there

Real tmux sessions, made by hand by other Claude Code agents working in this repo's worktrees. Each
was a bare `bash` at an idle prompt with its cwd in `.claude/worktrees/…`, and none carried any
`GJD_*` variable — so `ls` reported `(unknown)` and `shell`, both correctly.

They were not a malfunction. Agents run long commands in tmux **because they are told to**: a
backgrounded `npm test` on this box is killed under load and reported as exit 0
([testing.md](../project/testing.md#run-the-suite-in-tmux-because-a-killed-run-and-a-passing-run-look-the-same)).
Seven of the eight had a live `npm test` or `npm run check` under them when they were inspected. One
— `stageDbase` — had been an abandoned prompt for sixteen hours.

## Root cause, and its class

Two causes, one per half of the complaint.

### `kill` and `resume` refused them: a minting rule enforced as an addressing rule

`scripts/gjd-remote.ts` has `SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/` — the grammar for names **this tool
is willing to create**. `kill` and `resume` used it as the grammar for names **they were willing to
act on**:

```ts
if (!name || !SLUG.test(name)) die("gjd-remote kill <name>");
```

But `ls` enumerates every tmux session on the box, not only the ones this tool made, and a hand-made
name only has to satisfy tmux. `gateA` and `stageDbase` have capitals in them. So the CLI listed two
rows and then answered `gjd-remote kill <name>` about them — the *usage* string, which reads like
"you forgot the argument" rather than "that name is not allowed" — and left the sessions running.
The other six names were lower-case and could be killed all along, which is exactly why Greg named
those two.

**The class: a validator written for one direction of a value's life, reused for the other.** `SLUG`
answers "may I create this?" and was asked "may I touch this?" The two sets are different whenever
anything else can create the same kind of object — and on a box whose whole purpose is holding other
people's sessions, something else always can. The same shape shows up wherever a serialiser's
constraints are used to validate a parse.

Introduced in `938058fe` (2026-08-31), the commit that first wrote `kill`; the check has been there
since the command existed, and every session it could not name was invisible until the box filled up
with sessions this tool had not made.

`SLUG` was also, silently, the only thing making `tmux kill-session -t =${name}` safe to build by
string interpolation — so removing it as the gate meant every such site had to be quoted. That is
the second-order cost of a rule doing a job it was never declared to be doing.

### They accumulated: a recipe whose ergonomics pushed agents off it

`testing.md` gave the raw incantation with the session name hard-coded:

```
tmux new-session -d -s gate "npm test -- --reporter=dot > LOG 2>&1; echo EXIT=\$? >> LOG"
```

Two things follow, and both were observed in the names on the box:

- **The second agent in a minute gets `duplicate session`** and improvises a suffix. `gateA`,
  `stage2base`, `dfs-mtest2`, `g2d-check` are what improvising looks like.
- **A one-shot session vanishes when its command dies**, including when the quoting is wrong and it
  dies immediately — leaving nothing to attach to and nothing to read. An agent that has been burned
  once makes a bare session and `send-keys` into it instead, which is inspectable. And a bare
  `bash -l` session never exits.

**The class: an instruction that is more expensive to follow than to work around.** The drift was
not carelessness; each deviation was locally rational. Rewording would have lost again.

## The fix

- **`resolveSession(list, name)`** in [`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts)
  is now the only way a typed name becomes a session. Existence in the live list is the guard, not a
  grammar. `SLUG` still governs minting, unchanged.
- **Commands address `Session.id`** — tmux's `$N` — which the parser used to validate and discard.
  Between reading the list and sending the kill, a session can end and another take its name, and a
  kill on the wrong session is not recoverable. GPT Sol's point.
- **Every name is `shq`'d before it reaches a shell** (`kill`, `attach`, the `ls` rename, and
  `resumeCommand`, which types one into a fresh iTerm tab) and escaped by `printableName` before it
  reaches a terminal — a tmux name may contain control characters.
- **`positionalName`** respects `--`, so a session called `-odd` is a name and not an option. The old
  `find((a) => !a.startsWith("-"))` skipped it and attached to the newest session instead, which
  looks exactly like success.
- **Two refusals, not one.** Missing argument is `usage: gjd-remote kill <name>`; an absent session
  is `no live session named 'gateA' … nothing was killed.`
- **`ls` distinguishes `shell busy` from `shell idle`**, from an ancestry walk over the process
  snapshot it already takes. `idle` means "at rest right now", never "finished" — one snapshot cannot
  tell a husk from a shell nobody has typed into yet.
- **[`scripts/tmux-job.ts`](../../scripts/tmux-job.ts)** is the recipe as a command: a unique name
  led by the worktree's, a log path printed before anything runs, `EXIT=<n>` as the log's last line,
  the four `GJD_*` variables pinned so `ls` says which repo it is, and the command as the pane's own
  process so the session ends with it. `testing.md` now points at this and says not to hand-roll one.

## What the code review caught, which the design review could not

The plan for this went to GPT Sol before it was built and the code went back afterwards. The second
review is the one that paid, exactly as
[CLAUDE.md](../../CLAUDE.md) says to expect — **it found a blocker in the fix itself, of the same
class as the bug being fixed**:

`confirmStarted` was rewritten to return the session id, and it asked for it with
`tmux display-message -p -t '=name'`. `display-message` takes a target *pane*, so without a trailing
colon tmux 3.4 prints **nothing and exits 0** — the trap already written down two doors away in
[hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md). Measured on the box:

```
$ tmux display-message -p -t '=zzColonProbe'  '#{session_id}'   # prints nothing, exit 0
$ tmux display-message -p -t '=zzColonProbe:' '#{session_id}'
$828
```

So every `new-claude`, `new-shell` and `setup` would have read an empty id and killed itself with
*"'name' did not survive starting"* over a session that was running perfectly. It would have shipped:
no test covers that path, and the manual checks were all of `kill` and `ls`.

Sol also found four more, each certain and each reproduced rather than asserted:

- **`jobScript` used a brace group**, which runs in the wrapper shell — so a command that is a shell
  builtin (`exit`, `exec`) took the wrapper with it and the `EXIT=` line never ran. An empty log and
  a clean exit: the silent success the file exists to prevent, inside the file that exists to prevent
  it. A subshell fixes it. Every test passed over the broken version because they all ran external
  commands.
- **`resume-all` carried names, not ids**, reopening the race the ids were introduced to close.
- **A command running *as* the pane process** was skipped by the busy walk, so
  `tmux new-session -d -s x 'npm test'` — what the old recipe produced — read `shell idle`.
- **`positionalName` looked for `--` anywhere first**, so `resume gateA --` returned nothing and
  attached to the newest session instead.
- **`printableName` was applied only in error messages**, leaving the `ls` table — the one thing that
  prints every name on the box — writing them raw.

The pattern across all six: **a fix written from the same assumptions as the bug inherits them.** The
addressing change was right and every one of these was a detail of carrying it out.

Two more came from the test suite rather than from review, and both are worth the same note:

- **`tmux-job.ts` wrote its logs to `data/tmux-jobs/`**, and `data/` is the article store — every
  file beside an article there must have a home in Postgres, which
  `tests/store-artefact-manifest.test.ts` walks the directory to enforce. It went red naming all six
  logs. They live under `/logs/` now. The test did exactly what its header says it is for: a new
  file arriving beside an article shows up as a red test rather than as archaeology.
- **The awk `busy` walk was written with `\/` inside an awk regex literal**, which a TypeScript
  template literal collapses to a bare `/` — closing the regex early and breaking the probe for
  every session on the box, all of which then read `unknown`. Caught only because
  `tests/gjd-remote-tmux-script.test.ts` runs the generated script through a real shell; a test that
  asserted on the script's *text* would have been perfectly happy. Rewritten with no slashes in it.

## What would have caught it

Ranked by value for effort:

1. **A test that acts on a session name the tool did not mint.** There was none: every test used
   slug-shaped names, so the whole class was invisible. Now
   [`tests/gjd-remote-tmux.test.ts`](../../tests/gjd-remote-tmux.test.ts) § `resolveSession` resolves
   `gateA` and refuses a prefix of a live name. Cheap, and it generalises — *test the values your
   system will meet, not the values it produces*.
2. **Asking what else writes to a namespace you read from.** `ls` reads all of tmux; nothing in the
   code said so, and every command downstream assumed otherwise. A one-line comment on `sessions()`
   naming the untrusted producer would have made the `SLUG` check look wrong on sight.
3. **Watching the failure message rather than the exit code.** `gjd-remote kill gateA` exits 1 either
   way; the difference is entirely in the words. A refusal that names the wrong reason is a check
   agreeing with the code because they share an assumption —
   [silent-success.md](../reusable/silent-success.md).
4. **Noticing that a documented recipe had no test and no caller.** Anything worth writing in a
   fenced block in `docs/` is worth being a script, at which point it can be run, named uniquely, and
   changed in one place.
