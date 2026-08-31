# The exit status that belonged to tee

A server's provisioning died a hundred lines in. cloud-init reported `done`. It took most of a day
and two rebuilds to find out, and the whole time the failure was sitting in a log file nobody could
reach.

**Introduced:** `6bf262b`, the first commit of `infra/hetzner/cloud-init.yaml`.
**Found:** by GPT Sol, on the second review round, after the machine had already failed twice.
**Fixed:** `3d64aaa`.

## What happened

`runcmd` invoked the provisioning script and teed its output to a log:

```yaml
runcmd:
  - bash /usr/local/sbin/provision.sh 2>&1 | tee /var/log/provision.log
```

A string `runcmd` entry is interpreted by `sh`, so that is a pipeline, and **a pipeline exits with
the status of its LAST command** — `tee`, which succeeds essentially always. `provision.sh` ran
`set -euo pipefail` and exited 1 at line 55. cloud-init saw zero and reported success.

## The real cause

Not the pipe. The pipe is a symptom of something more general: **the provisioning had no way to
tell anyone it had failed.** Three independent channels all said "fine":

- `cloud-init status` said `done`, because of the pipeline.
- The verification block at the end of the script never ran, so its silence looked like the silence
  of a machine that had not got there yet, rather than one that had already given up.
- The CPU graph showed real work and then flat zero — which reads as "hung", and which two separate
  analyses (mine, and a subagent's) independently concluded. **We agreed, and we were both wrong,
  because we shared an assumption.** No CPU equally means "finished, badly".

The one channel that would have settled it in seconds — the log — was unreachable, because Claude
Code's Bash tool has no outbound port 22. Every question had to go through Greg, so I built a
theory instead of asking for a line of text. That is the expensive habit here, not the pipe.

## The class, not the instance

Every bug in that day's work was the same shape: **a command that succeeds while doing nothing.**

- `apt-get install nodejs` was a no-op because `novnc` had already pulled in Ubuntu's Node 18. apt
  printed "already the newest version" and exited 0. Ubuntu's `nodejs` ships no `npm`, so the next
  line failed — a hundred lines from the actual mistake.
- NodeSource's own setup script can exit 0 having failed: `if ! apt update; then handle_error "$?"`
  passes the status of the *successful negation*, which is zero.
- `apt-get update` tolerates a repository that failed to refresh, so you install the distro's
  package believing you added a repo.
- The mosh probe reported "UDP blocked?" on every network for weeks, because `script(1)` was handed
  a pipe for stdin and died before mosh was ever contacted.
- Two `sshd -T` checks reported the door open on a box whose config was correct, because
  `/run/sshd` is a systemd `RuntimeDirectory` that is deleted when ssh.service stops — and the
  script restarts ssh two lines earlier.

## The fix that is right for the long term

Not `-o pipefail` on that line, though that is the one-line fix ([`3d64aaa`](../../infra/hetzner/cloud-init.yaml)).
Three things, in increasing order of what they buy:

1. **Assert the effect, never the artefact.** `command -v node` proves a file exists. `node -v |
   grep ^v26` proves the right one is there. The nodejs bug survived a `command -v` check and would
   have survived any number of them.
2. **Assert the *candidate* before installing, not the result after.** `apt-cache policy nodejs`
   would have printed `Candidate: 18.19.1` and named the problem before a single package was
   fetched.
3. **A preflight that can fail** — [`scripts/check-cloud-init.ts`](../../scripts/check-cloud-init.ts),
   which runs in seconds on the laptop and catches the whole class: unescaped interpolations, a pipe
   inside a `runcmd`, a `check` whose quoting makes it unrunnable, plain syntax errors.

## What would have caught it

The preflight, and it was written the same day. Note two things about how it is built, because they
are the actual lesson:

- **It refuses to pass if its own parser finds nothing.** That is not hypothetical: the first
  version used a regex that stopped at the first blank line in `provision.sh`, found zero checks,
  and the count guard is the only reason it did not ship as a preflight that approved everything.
- **It names the checks that must exist rather than counting them.** Commenting out one check left
  twelve, comfortably over the threshold, and went uncaught until the guard was changed from a
  number to a list.

Both are the same principle as [silent-success.md](../reusable/silent-success.md): a check you have
never seen fail is not evidence. Every check in that preflight has been mutation-tested, and every
mutation goes red.

## The other lesson, which is not technical

I diagnosed "it hung" from a CPU graph, said so with confidence, and hardened the whole script
against hanging. It had not hung. One line of log, which Greg could have pasted at any point, ended
the theory instantly. **When the cheap evidence is one question away, ask for it before building
the model** — and when a second opinion agrees with you, check whether it is looking at the same
graph you are.
