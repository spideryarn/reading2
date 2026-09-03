# A logout hook decided the exit status

**Class: a login shell for a non-interactive command.** The command's exit status is not the last
thing that runs in a login shell; the logout hook is, and under `set -e` its failure is what the
caller sees. The installer said "Installation complete!", exited 0, and the step reported FATAL.

## What happened

On 2026-09-03, `gjd-remote provision` against the box died at its "install claude code" step,
eighteen seconds in, with `FATAL: 'install claude code' failed or timed out after 300s`, directly
under the installer's own `✅ Installation complete!`. Every later step was skipped, and the status
file was left saying `PROVISION INCOMPLETE (started, has not finished)`.

## Root cause

The step was

```
run 300 "install claude code" su - "$USER_NAME" -c 'set -eu; t=$(mktemp); curl … -o "$t"; rc=0; bash "$t" || rc=$?; rm -f "$t"; exit $rc'
```

`su -` starts a **login** shell. Bash runs `~/.bash_logout` when a login shell exits, `-c` or not,
and Ubuntu's stock one is

```
if [ "$SHLVL" = 1 ]; then
    [ -x /usr/bin/clear_console ] && /usr/bin/clear_console -q
fi
```

`clear_console -q` fails when there is no console to clear, which over ssh from a script there is
not. The `set -e` inside the `-c` string is still in force when the logout file runs, so the shell
exits with `clear_console`'s status instead of the `exit 0` it had just been given. `set -x` showed
it plainly:

```
+ exit 0
++ '[' 1 = 1 ']'
++ '[' -x /usr/bin/clear_console ']'
++ /usr/bin/clear_console -q
+ echo TRAP_EXIT=1
```

The same script with `set +e` before its `exit` returned 0; `su - greg -c 'set -eu; true'` returned
1. Every `su -` step with `set -e` in it was affected — the Codex install too — and the steps
without `set -e` (`test -w …`) only happened to survive.

**Introduced by** `dd81858` (2026-09-02, "Install Claude Code as the user, so it can update
itself") and `f763991` (Codex), which moved the installs from root's `npm install -g` to `su -` as
the user so the tools could update themselves. Neither commit was followed by a run of
`gjd-remote provision` against the box, because a second bug stood in front of it: the wait on
`cloud-init status`, added the day before, read the box's first-boot `error` as a live condition
and refused every time ([hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md)).
Two bugs, each hiding the other.

## The fix

`provision.sh` runs user steps through `"${AS_USER[@]}"`: `runuser -u greg -- env -i HOME=… PATH=…
bash -c`, a **non-login** shell with its environment spelled out. No profile, no logout hook, no
inheritance from root. An array rather than a function, because `run` and `timeout` exec a command
by name and cannot call a function.

`run` now says which it was: `failed with exit N`, or `timed out after Ns`. The old message named
both at once, and the timeout was the half that got read.

## What would have caught it

1. **Run the command that changed, against the thing it changes, before committing.** Cheapest and
   most valuable. Both `su -` commits landed without a provision run; the gate that stopped the run
   was itself wrong, and "the gate refuses" was accepted rather than investigated.
2. **A step runner that reports the exit code**, so eighteen seconds and `exit 1` are not read as a
   timeout. Done here.
3. **Reading the whole output, not the last line.** The installer's success banner was in the log
   directly above the FATAL. A step that fails after printing success is the shape to look for,
   and it is the shape [silent-success.md](../reusable/silent-success.md) is about, inverted:
   loud failure over a real success.
