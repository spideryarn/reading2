---
id: q-rh49ck
report: spya-q2qb7q
status: answered
asked: 2026-10-10
title: May the three-hourly feedback sweep run as a permanent systemd timer?
refs: qi-vyxxb5k8 · docs/plans/261010d-standing-jobs-survive-a-reboot.md · docs/user-feedback/261010_0300-the-box-s-repeating-jobs-survive-a-reboot.md · infra/hetzner/systemd/feedback-sweep.service
acted: spya-dkj970
---
The feedback sweep (an unattended Claude Opus run every three hours that reads new reports and queues them) currently lives in a tmux loop that a reboot kills. I have built it a permanent systemd timer but not switched it on, because it spends money on a clock. May I switch it on?

A. Yes, switch on the timer (recommended). The same sweep, same prompt, same three hours, same cost as today; it just survives a reboot, an out-of-memory kill and a rebuilt box, and if a sweep fails the Overseer is told. The tmux loop is stopped first so the two never both run.

B. No, keep the tmux loop. Nothing changes: after any reboot somebody has to remember to restart it, as today.

C. Yes, but only run Claude when there is something new. A cheap check first, and the paid sweep only when a new report has arrived. It saves the cost of empty sweeps but is more to build, and the sweep also does other work each time (acting on your replies to questions, marking finished reports), so it would need care. I would do this as a follow-up after A, not instead of it.

Details

What you asked (report 523, 9 October, from the changelog page): that the repeating jobs, the daily worktree sweep, the three-hourly feedback sweep and box health, be permanent and robust: still there after a reboot, a memory crash or a rebuilt server, deterministic, and silent unless the Overseer has something to decide.

What I found: the Overseer daemon, its watchdog and the hourly disk tidy were already permanent (systemd). The jobs you named were not. The worktree sweep lived inside the Overseer's Claude session as a scheduled prompt. The feedback sweep and the hourly dashboard refresh were tmux loops running old copies of their scripts from a temporary folder. Box health was measured by the dashboard every minute but nobody was ever told when it went bad.

What is now built and ready for the Overseer to switch on (no question needed, none of them spends money): box health every ten minutes, which tells the Overseer only when something goes critical, a disk fills, or one of the box's jobs fails, and says all clear once afterwards; the worktree sweep daily at 06:30, which removes finished worktrees and tells the Overseer only about ones that need a decision; and the dashboard refresh hourly. Each is a systemd timer, so a reboot brings it back.

Why this one is a question: it is the only one that runs Claude, so it costs money each time it runs, unattended. It already does that today, every three hours, so option A does not add any spending you have not already approved; it only makes it durable. The review model (GPT Sol) argued exactly that. But the instructions for this work said a scheduled job that runs Claude is your call, so I am asking rather than assuming.

What A involves for the Overseer, once you say yes: stop the tmux loop between two sweeps, then switch the timer on, which starts one sweep straight away and then one three hours after each finishes.

## Greg's answer, 2026-10-10 (in the Feedback dialog, reply `spya-dkj970`)

> A

Settled: A. Queued for the Overseer as qi-4rnb96h3 (switch on feedback-sweep.timer, stopping the tmux loop first), beside qi-2jk2zjkv (the other three timers). The feedback sweep that read this reply may not touch systemd, so it does not switch the timer on itself. (Feedback sweep, 2026-10-10.)
