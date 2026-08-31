# The match that still failed

Two lines in `infra/hetzner/provision.sh` reported `FAIL` on a Hetzner box whose SSH configuration
was correct. Not sometimes — every time, on every box built from this script, since the script was
first written. Greg hit it yesterday, pasted the config that proved it was fine, and the response was
to keep debugging sshd. The checks stayed red for a day before anyone doubted the checks.

**Introduced:** [`6bf262b`](../../infra/hetzner/cloud-init.yaml), the first commit of
`cloud-init.yaml`, which already had both `set -euo pipefail` and the two `sshd -T | grep -q` checks.
**Found:** 2026-08-31, by re-running the checks with pipefail toggled on and off and reading
`PIPESTATUS`. **Fixed:** same day, in the working tree, as part of extracting the verification block
out of the `cloud-init.yaml` heredoc into `infra/hetzner/provision.sh`; not yet committed as of this
writing.

## What happened

The verification block at the end of provisioning runs every check through one helper:

```bash
fail=0
check() { if eval "$2" >/dev/null 2>&1; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
...
check "password auth off"  'sshd -T 2>/dev/null | grep -qi "^passwordauthentication no"'
check "root login off"     'sshd -T 2>/dev/null | grep -qi "^permitrootlogin no"'
```

The script starts `set -euo pipefail`. `grep -q` exits the instant it finds its match, which closes
the read end of the pipe while `sshd -T` is still writing. `sshd` gets SIGPIPE and dies with exit 141.
Under `pipefail`, a pipeline reports the first non-zero status in it, so the pipeline reports 141 —
failure — even though the grep matched exactly what it was looking for.

Measured on the live box: `sshd -T` prints 95 lines, and `passwordauthentication no` is on line 30.
`grep` was always going to leave before `sshd` finished, so the pipe was always going to break, so
these two checks were always going to say `FAIL` on a correctly configured machine. Confirmed with
`PIPESTATUS`: `141 0` — the producer died, the grep succeeded.

Eight other checks in the same block use the identical `... | grep -q ...` shape and passed —
`node -v | grep -q "^v..."`, `swapon --show | grep -q swapfile`, and so on. They passed because their
producers print a handful of lines and finish before grep exits. That is luck, not correctness. The
first time `claude mcp get` or `node -v` got chattier, one of those would have started failing too,
and it would have read as a regression in the thing being checked rather than as this same bug
showing up in a ninth place.

## The root cause, and why it is the inverse of the usual one

[`silent-success.md`](../reusable/silent-success.md) is full of checks that pass while the system is
broken, because the check and the code share a false assumption. This is the same family, run
backwards: the check **fails while the system is fine**, because the check and the shell it runs in
share a false assumption — that finishing early is free. `grep -q` is *supposed* to stop reading once
it knows the answer; nobody writing that check thought of "stop reading" as an action with a
side-effect on the thing being read from.

Of the two directions, this one is worse to live with. A check that passes on a broken system fails
silently — you find out later, from something else breaking. A check that fails on a working system
fails *loudly*, every single time, which trains the very people who'd catch a real regression to stop
reading the report. That is exactly what happened here: `gjd-remote doctor` said `11 ok, 2 FAIL` and
the two FAILs were filed as a known, boring annoyance rather than as evidence something was wrong —
with the checking apparatus, not the box. A permanently red light is worse than an occasionally green
one, because vigilance has nowhere to go: there is no state in which this check ever says `ok`, so it
stops being information.

There's a second irony worth naming. The preflight in
[`scripts/check-cloud-init.ts`](../../scripts/check-cloud-init.ts) — written after
[the-exit-status-that-belonged-to-tee.md](the-exit-status-that-belonged-to-tee.md) — has a rule that a
`runcmd` pipeline without `pipefail` is a bug, because a bare pipe reports its last command's status
and swallows a failure earlier in the chain. That rule is correct for the outer
`bash provision.sh | tee log` line it was written for. It would have been exactly the wrong advice
applied to `check()`: the general lesson from the last postmortem was "add pipefail," and the general
lesson from this one is "not there." Both are right, in their own pipeline.

## The fix

Not the two sshd lines. Turn `pipefail` off for the duration of any check, so a producer that dies of
SIGPIPE after being fully read doesn't shadow the consumer's real answer:

```bash
check() { if ( set +o pipefail; eval "$2" ) >/dev/null 2>&1; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
```

Fixing only `password auth off` and `root login off` — by rewording them to avoid `grep -q`, say —
would have left the other eight checks carrying the same latent bug, waiting for their producer to
print one line more than it does today. The fix has to live in `check()` itself, once, because that's
where every check shares the assumption.

Mutation-tested on the box afterwards: the real check still passes; `grep -qi
"^passwordauthentication yes"`, a missing binary, a bare `false`, and a grep over empty input all
still go red and set the fail flag. Full run: 14 of 14 checks `ok`, `PROVISION OK`, exit 0.

## What would have caught it

Four candidates, in the order they're worth trusting:

1. **Make `check()` prove at least one check can fail, on every run.** The mosh probe in
   [the-exit-status-that-belonged-to-tee.md](the-exit-status-that-belonged-to-tee.md) said "UDP
   blocked?" on every network for weeks because nothing forced a single case where the answer had to
   come back "yes, blocked" for the probe to be believed. The same fix applies here directly: a
   canary check that's built to fail (`check "canary (must fail)" 'false'`, removed before the real
   run, or asserted in the preflight) would have shown, the day this script was written, that a
   passing `sshd -T` check and a failing one look different — which they didn't, because both looked
   like `FAIL`.
2. **Mutation-test every check at the time it's written**, the way the fix above was tested on the
   box before shipping. This is the strongest fix and the one that actually happened, but it only
   happens if someone thinks to do it — it isn't a gate, it's a habit, and the habit is exactly what
   didn't fire for a day.
3. **A static rule in `scripts/check-cloud-init.ts`**: flag `| grep -q` (or `-m1`, `head`, anything
   that can stop a pipeline early) appearing anywhere `pipefail` is in effect. This is the most
   mechanical option and the cheapest to keep enforced, but it's narrower than it looks — it catches
   this exact shape and nothing that stops a producer early some other way (a `timeout`, a `read` that
   returns after one line). Worth adding, not worth trusting alone.
4. **The human rule: when a person pastes evidence that contradicts a check, the check becomes the
   suspect, not the system.** This is the cheapest fix of the four and the one that actually would
   have ended it in one day instead of two — Greg pasted `sshd -T`'s correct output the day before,
   which is direct proof the check was lying, and it was read as a puzzle about sshd's runtime state
   instead. It's also the least mechanical, which is why it's listed last rather than first: it
   depends on someone noticing the shape, every time, rather than a script that can't forget to run.

None of the four is sufficient alone. (1) and (2) both require someone to add a case that isn't the
happy path, which is the actual gap; (3) only sees this one shape of the bug; (4) only works if it's
actually followed. Together they're what should ship: canary-first as the mechanical floor, the human
rule as the thing that stops a day being lost on the way to it.

## The diagnostic mistake

The evidence that the config was correct existed a full day before the fix — Greg ran `sshd -T` by
hand and pasted output showing `passwordauthentication no` and `permitrootlogin no`, both exactly
right. That evidence was read as "the config is fine, so something about sshd's *runtime state* must
be different from what the check assumes" — which led to real bugs (`/run/sshd` missing after the
`ssh.service` restart, a drop-in file `99-hardening.conf` losing to an earlier `50-cloud-init.conf`
because OpenSSH takes the first value it sees) and real fixes, landed the same day in `05b5341`. Those
fixes were correct and worth having. They were also not this bug, and after they landed the two
checks stayed red — which should have been the tell that the theory was still wrong, not that sshd
needed another look. A check contradicted by direct evidence is a check under suspicion; treating it
instead as a hint about where else to look is how a five-minute pipe bug survives a full day of
otherwise-good debugging.

## See also

- [the-exit-status-that-belonged-to-tee.md](the-exit-status-that-belonged-to-tee.md) — the earlier
  postmortem in this same file, and the origin of the `pipefail` rule that this bug is the inverse of
- [silent-success.md](../reusable/silent-success.md) — the check that shares an assumption with the
  code it's checking is not a check
- [`scripts/check-cloud-init.ts`](../../scripts/check-cloud-init.ts) — the preflight, and its
  `REQUIRED_CHECKS` list, which names checks rather than counting them for the same reason a canary
  check would name a failure rather than assume one

## The canary, and what it caught

Built the same day, at the top of the verify block in
[`infra/hetzner/provision.sh`](../../infra/hetzner/provision.sh):

```bash
check "self-test: a check that must pass, passed" 'seq 1 100000 | grep -q "^5$"'
```

`seq 1 100000` is a producer large enough that `grep -q` always leaves while it is still writing, so
it reproduces the bug with nothing installed and no network: 141 under `pipefail`, 0 without. A
second canary asserts something false and must fail, catching the opposite rot — a `check()` that has
stopped being able to fail at all.

Regression-tested on the box by putting the original `check()` back:

```
FAIL self-test: a check that must pass, passed
FAIL password auth off
FAIL root login off
PROVISION INCOMPLETE — see above
exit=1
```

**One thing that only showed up here: the bug is racy.** In another bugged run `password auth off`
passed while `root login off` failed — the same pipeline, the same machine, a different outcome,
because whether the producer has finished when grep leaves is a scheduling question. That is worse
than a deterministic bug, because an intermittent red gets attributed to flakiness and waited out.
It is also the strongest argument for the canary: at 100,000 lines the race is settled every time,
so the canary is reliable exactly where the thing it guards is not.
