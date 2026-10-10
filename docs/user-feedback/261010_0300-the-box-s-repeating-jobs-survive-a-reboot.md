---
reports: spya-q2qb7q
ending: shipped
comment: Box health, the daily worktree sweep and the dashboard refresh are now systemd timers that survive a reboot and tell the Overseer only when it must decide. The feedback sweep timer awaits your yes (q-rh49ck).
---
# The box's repeating jobs survive a reboot

An admin suggestion from Greg (`scripts/feedback-reporter.ts` exit 0), filed 2026-10-09 at 22:27
UTC from `/changelog` (#523, build `8bd1e67b`). Queue item `qi-vyxxb5k8`, session
`fbq2qb7q-standing-jobs-survive-reboot`. The plan, the inventory of what already ran, and both GPT
Sol reviews: [261010d](../plans/261010d-standing-jobs-survive-a-reboot.md).

> Do we have some kind of cron job or service or daemon that runs perhaps every day and does stuff?
> For example, it could sweep the worktrees. […] Ideally, it would run deterministically and
> invisibly unless it hits worktrees that need LLM input, and then it would notify the overseer
> […] In an ideal world, I think probably we'd make sure those repeating jobs are pretty robust so
> that even if we reboot the server or if they, you know, we run out of memory, or even if we
> reprovision the server, we can be sure that they'll exist. […] They'd probably also report on box
> health, so hard disk space, RAM, swap, CPU load. I think we have all this, so maybe I'm just
> telling you to do things we already have. […] We want this to be something that's permanent and
> robust.

## What was already there

The Overseer daemon, its watchdog and the hourly disk tidy were already systemd units, and the
dashboard already measured box health every minute. The jobs named in the report were not
permanent: the worktree sweep was a scheduled prompt inside the Overseer's Claude session; the
feedback sweep and the dashboard refresh were tmux loops running stale copies of their scripts from
`/tmp`; and nothing ever *told* anybody that health had gone bad or that a timer had failed.

## What shipped (on `dev`; the Overseer installs it)

- **`box-health.timer`**, every ten minutes: the dashboard's own health verdict, and whether any of
  the box's units has failed. It tells the Overseer when the set of alarms changes — critical,
  unknown, a disk at its strained cutoff, a failed unit — once a day while one lasts, and "all
  clear" once afterwards. Never "I ran and found nothing".
- **`worktree-sweep.timer`**, daily at 06:30: `worktree:sweep --remove`, telling the Overseer only
  about trees that need a decision.
- **`dashboard-refresh.timer`**, hourly: the existing refresh, now failing loudly.
- A fourth speaker on the dashboard's steer route, `box`, so the Overseer knows the line is from a
  timer, not from Greg; and request ids, so a retried message is never typed twice.
- Provisioning installs all of these and enables the timers, and now enables the fleet dashboard
  too, so a rebuilt box has them.

## Deferred, each with its own queue entry

- **The feedback sweep's timer** is built and installed-not-enabled: it runs Claude, so it spends
  money on a clock. Question [q-rh49ck](questions/q-rh49ck.md); queue item `qi-rnkpm7ve`.
- **Installing the units on the live box** is the Overseer's step: queue item `qi-2jk2zjkv`, with
  the commands in the plan's § Install.
- **The readiness loop**, the last tmux loop: a proposal, `qi-aveq2cec`.

No Sentry sign-in in this session: the next feedback sweep marks the Sentry issue from this note.
