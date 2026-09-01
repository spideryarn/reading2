# The session that was never listed

`gjd-remote ls` showed nine sessions. The box had ten. It had been dropping exactly one — always the
last one alphabetically, because that is the order `tmux ls` prints in — since the command was
written, and nothing in the tool, the tests or a day of looking at its output ever suggested
otherwise. A list of nine sessions is precisely what a box with nine sessions looks like.

**Introduced:** in the first version of `buildSessionScript()` in
[`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts), and carried through both later
rewrites of that function — including the one whose entire purpose was to stop the listing being
quietly wrong. **Found:** 2026-09-01, by GPT Sol reviewing an unrelated change to the same function;
it reproduced the shell shape on its own before reporting it. **Fixed:** same day, in the same change.

## What happened

```sh
rows=$(tmux ls -F '…')
printf '%s' "$rows" | while IFS= read -r row; do …; done
```

Two ordinary things combine into a missing row:

1. **`$(…)` strips every trailing newline.** So `rows` holds `a\nb\nc` — three lines, two newlines.
2. **`printf '%s'` adds none back.** So the pipe carries `a\nb\nc` with no terminator.

`read` returns false at end-of-input, and `while read` tests that return value *before* running the
body. On an unterminated final line `read` fills the variable **and** returns false — so `c` is read
and then thrown away. The loop body never runs for it.

```
$ rows=$(printf "one\ntwo\nthree\n"); printf "%s" "$rows" | while IFS= read -r r; do echo "GOT $r"; done
GOT one
GOT two
```

## Why nothing caught it

**Every check shared the loop's own assumption.** The tests for this module are thorough — they were
written after three separate bugs in the same function — but they all begin with a string that the
shell has already produced. `parseSessions` was handed a fixture of three rows and asserted three
sessions, which is true and answers a different question. Not one test ran the script.

**The output is self-consistent.** A short list has nothing missing *in it*. Every column on every
row was right; the row that would have contradicted it was gone. This is the exact shape of
[silent-success.md](../reusable/silent-success.md), and this file's own comments say so twice about
other failures in the same function while this one sat four lines below them.

**Nobody counts their tmux sessions.** The one person who would notice reads the list to find a name,
and the name he is looking for is usually there.

## What it cost

More than a short list. Callers reason about this list *from its absences*:

- `cmdNewClaude` decides a name is free with `sessions().some(s => s.name === name)` — so the
  alphabetically-last session's name always read as free, and a second session could be made with a
  name already taken.
- `resume` with no argument picks the most recent from the list it is given.

Both are the failure the module's own header warns about, in the function that header is attached to.

## The fix, and the fix for the class

`printf '%s\n' "$rows"`, which is one character.

The character is not the fix that matters. The script now prints **`GJDROWS <n>`** — how many rows
`tmux ls` gave it — before any of them, and `parseSessions` refuses a listing whose row count does
not match:

> tmux listed 10 session(s) and 9 reached this laptop, so the list is not the box's

That turns the whole class into a loud failure: any future way of losing a row between `tmux ls` and
the parse stops the command instead of shortening its answer. It is the same move the module already
made twice — the `GJDOK` sentinel, so an empty reply cannot pass for an empty box, and the strict
field count, so a half-filled record cannot pass for a session at the epoch. Both were added for
exactly this class and neither was in a position to see it.

## What would have caught it

**Running the script.** Every test in `tests/gjd-remote-tmux.test.ts` starts downstream of the shell,
so the shell has never been executed by anything but the box. The wire format is a seam, and both
sides of it were tested against the same assumption about what the other side sends.

So the fix adds it: [`tests/gjd-remote-tmux-script.test.ts`](../../tests/gjd-remote-tmux-script.test.ts)
puts `tmux`, `ps` and `claude` on a PATH as small shell scripts and runs `buildSessionScript()`
through bash. Two rows in, two rows out.

It earned its place immediately. Sol had asked for it as *desirable*; within the hour it had shown
that a `ps` returning 2 still read as "nothing is running here", and building one of its cases by
hand — a Claude in a window that was not the one on screen — turned up a second blind spot nobody had
predicted: the probe looked only at the *children* of a pane, so a `tmux new-window 'claude …'`,
where Claude is the pane process itself, came back `none`. Neither was reachable from a test that
starts after the shell has run.
