# A skip guard that passed on the machine it was meant to skip

`tests/gjd-remote-tmux-script.test.ts` is written for the box and says so. Its
docstring: *"They need bash and coreutils, which is what the box is. Skipped
elsewhere rather than failing, because a Mac without GNU `base64 -w0` is not a
bug in this script — the script only ever runs on the box."*

It did not skip on the Mac. Sixteen tests ran and sixteen failed, and the deploy
gate's `test` step could not go green on Greg's laptop because of it.

## What broke

`usable()` probed the environment with one command:

```sh
printf x | base64 -w0 >/dev/null && ps -o args= -p $$ >/dev/null
```

macOS ships **FreeBSD `base64`**, and FreeBSD's `base64` accepts `-w0` — quietly,
exit 0, correct output. So the probe answered *yes, this is GNU coreutils* on the
one machine it existed to answer *no* on.

The real incompatibility is a different utility, one line further into the
script. [`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts) counts
the rows tmux gave it:

```sh
n=$(printf '%s\n' "$rows" | wc -l)
printf 'GJDROWS %s\n' "$n"
```

**BSD `wc -l` pads its count to a fixed width; GNU's does not.** Run by hand
against the test's own stubs, the script emits

```
GJDROWS        1
```

where `parseSessions` wants `GJDROWS 1`. The row count is then unreadable, every
assertion downstream of it fails, and the failures read as though the wire format
were broken rather than as though the suite were running on the wrong machine.

## The root cause

Not `base64`, and not `wc`. **The guard sampled one flag and generalised to a
whole toolchain.** "Does `base64` take `-w0`" and "is this GNU coreutils" are
different questions, and the first is a proxy for the second that happens to be
wrong on precisely the platform the guard was written to exclude.

It is the [silent-success](../reusable/silent-success.md) shape with the sign
flipped. The usual version is a check that agrees with the code because it shares
an assumption with it. This one is a check that had **never been seen to
return false** — nobody had watched it skip, because the machine it was written
on always ran the tests. A guard whose negative branch has never executed is not
a guard; it is a comment that compiles.

## Which commit introduced it

The guard arrived with the file itself, in the work behind
[260901b-the-session-that-was-never-listed.md](260901b-the-session-that-was-never-listed.md)
— tests written on the box, for the box, on 2026-09-01. The bug was latent for a
day and surfaced the first time the deploy gate ran on the Mac.

Worth noticing that the file it belongs to is *itself* a postmortem fix: these
tests exist because `gjd-remote ls` silently dropped one session for its whole
life. The fix for a silent failure shipped with a silent failure in its own
scaffolding.

## The fix

Ask the question the docstring always meant:

```sh
wc --version 2>/dev/null | grep -q GNU && ps -o args= -p $$ >/dev/null
```

Two properties, both deliberate:

- **BSD `wc` has no long options at all**, so `--version` cannot be quietly
  tolerated the way `-w0` was. There is no way for it to look like it worked.
- **It greps for the word GNU** rather than trusting the exit code, so a third
  `wc` that grows `--version` without growing GNU's behaviour still reads as
  "not the box".

On this Mac the file now reports 18 skipped. On the box, where `wc --version`
prints `wc (GNU coreutils) …`, it still runs.

## What would have caught the class

**Watch a guard take its other branch.** Every `skipIf` has two outcomes and only
one of them is ever observed by the person writing it. The cheap discipline is to
force the negative once — invert the condition, confirm the suite skips, put it
back — the same way the repo already insists a test be seen red before it is
trusted green. A guard is a test of the environment, and it earns the same rule.

The generalisable version, for probes rather than assertions: **probe for the
thing you actually depend on, not for a nearby thing that is easier to test.**
The script depends on GNU `wc` output formatting. The guard tested `base64` flag
parsing. Nothing connected the two except an assumption that toolchains come as a
set.

## See also

- [silent-success.md](../reusable/silent-success.md) — the class
- [260901b-the-session-that-was-never-listed.md](260901b-the-session-that-was-never-listed.md)
  — the bug these tests were written to prevent recurring
- [hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md) — the box the script runs on
