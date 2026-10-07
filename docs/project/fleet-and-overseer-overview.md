# The fleet dashboard and the Overseer: the map

Up: [dev-and-deployment-overview.md](dev-and-deployment-overview.md)

This is a hub. It says which doc to open and where the code is, and it explains nothing else.

The **fleet dashboard** ([`tools/fleet/`](../../tools/fleet/)) is a web page on the box that shows
every agent session, what each is blocked on, and how the box is holding up. The **Overseer**
([`tools/overseer/`](../../tools/overseer/)) is the agent whose job is to oversee all the other
sessions: a daemon that keeps a store, and a permanent Claude session that reads the runbook. The
dashboard is the Overseer's face and the Overseer is the actor. The dashboard owns what is true
right now; the Overseer owns what has been true and what should happen next
([overseer-direction.md § Two tenses](overseer-direction.md#two-tenses-the-seam-between-the-overseer-and-the-dashboard)).

## What Greg asked for

All four are copied from [overseer-direction.md](overseer-direction.md), which holds many more.

> I'd rather not make this Claude-specific, and I think the Claude Code UI is weak, and we want to
> extend/improve on what's possible by building our own custom UI.
>
> — Greg, 2026-09-07

> I'm not certain what the right answer is. It may be that there's both a daemon and a long-running
> session, plus the web interface, and maybe some kind of store (probably gitignored, could be json
> or sqlite or something else, but start simple for now) so that we can resume easily if the session
> got killed (and ideally the overseer should be able to resume itself and all the running sessions
> if the box got rebooted).
>
> — Greg, 2026-09-08

> We want a higher bar for robustness for this orchestrator work, because the orchestrator needs to
> be the one that fixes other problems. But at the end of the day, if the orchestrator broke I could
> just ssh in and use Claude Code in the terminal, so it still wouldn't be the end of the world.
>
> — Greg, 2026-09-08

> Briefly broken is fine for dev, have a slightly higher standard for the orchestrator and its web
> interface, and a higher standard still for keeping things working in prod.
>
> — Greg, 2026-09-08

His list of what the page and the Overseer must eventually do, with his own NOW / SOON tags, is
[overseer-direction.md § The horizon](overseer-direction.md#the-horizon). Check a proposed slice
against it.

## Which doc to open

| You want to | Open |
|---|---|
| know why any of this exists, or what was already decided | [overseer-direction.md](overseer-direction.md): 1,600 lines, so go by section. [§ What the Overseer is](overseer-direction.md#what-the-overseer-is), [§ Constraints already established](overseer-direction.md#constraints-already-established), [§ Principles](overseer-direction.md#principles) |
| know which side of the seam a change belongs on | [overseer-direction.md § Two tenses](overseer-direction.md#two-tenses-the-seam-between-the-overseer-and-the-dashboard) |
| know what a file under `~/.overseer/` is | [overseer-direction.md § The seam is a file](overseer-direction.md#the-seam-is-a-file-not-a-function-overseercurrentjson) and [§ The store](overseer-direction.md#the-store) |
| act as the Overseer, or learn what it may and may not do | [overseer.md](overseer.md): [§ The gates](overseer.md#the-gates), [§ The standing jobs](overseer.md#the-standing-jobs), [§ The tick](overseer.md#the-tick), [§ Things that will catch you](overseer.md#things-that-will-catch-you) |
| steer a session, or restart the dashboard safely | [overseer.md § Steering, and the actions you have](overseer.md#steering-and-the-actions-you-have) |
| get something deployed | [overseer.md § Deploying](overseer.md#deploying) |
| start an agent from the Overseer | [overseer.md § Dispatching agents](overseer.md#dispatching-agents) |
| see what work is approved but deferred | [overseer-queue.md](overseer-queue.md) |
| change when a standing job runs, or ask why there is no cron | [overseer-direction.md § The scheduler](overseer-direction.md#the-scheduler), then [cron-scheduler.md](cron-scheduler.md) |
| report progress, a block, a decision or a finish | [work-reports.md § The commands](work-reports.md#the-commands) |
| add a tab to the dashboard | [fleet-dashboard-modes.md § The registrations](fleet-dashboard-modes.md#the-registrations) |
| add one datum to a tab that exists | [fleet-dashboard-modes.md § Where the panel's data comes from](fleet-dashboard-modes.md#where-the-panels-data-comes-from-the-end-to-end-path) |
| look at the dashboard in a browser | [fleet-dashboard-modes.md § Seeing it](fleet-dashboard-modes.md#seeing-it) |
| change the Recent messages tab | [fleet-recent-messages.md](fleet-recent-messages.md), above all [§ What a row is entitled to say](fleet-recent-messages.md#what-a-row-is-entitled-to-say-about-its-session) |
| change what the Usage limits tab says about an account | [usage-per-account.md § Eight things that are not obvious](usage-per-account.md#eight-things-that-are-not-obvious) |
| change the 24-hour usage chart | [usage-history.md § What the chart may not claim](usage-history.md#what-the-chart-may-not-claim) |
| know what is observable about usage limits at all | [overseer-direction.md § Usage limits](overseer-direction.md#usage-limits) |
| make a test run count towards "dev is green" | [readiness.md § The one command](readiness.md#the-one-command) |
| change what the dashboard calls a session's state | [overseer-direction.md § Attention](overseer-direction.md#attention-and-who-the-overseer-is-really-watching) |
| understand what a reboot loses and what brings it back | [overseer-direction.md § Reboot revival](overseer-direction.md#reboot-revival-and-the-thing-gjd-remote-resume-does-not-do) |
| reach the page from a phone | [hetzner-remote-server-box.md § After `tailscale up`](hetzner-remote-server-box.md#after-tailscale-up-give-the-fleet-dashboard-the-address) and [overseer-direction.md § Access](overseer-direction.md#access) |
| build a dashboard like this in another project | [agent-fleet-dashboard.md](../reusable/agent-fleet-dashboard.md), above all [§ Talking to a session](../reusable/agent-fleet-dashboard.md#talking-to-a-session-what-actually-works) |

## Where the code is

Three directories: [`tools/fleet/`](../../tools/fleet/) (the server),
[`tools/fleet/web/src/`](../../tools/fleet/web/src/) (the page) and
[`tools/overseer/`](../../tools/overseer/) (the daemon's modules). The commands are in `scripts/`.
Every file opens with a header comment that says what it is for and why; read that before the code.

"No owning doc" below means that on 2026-10-07 no file of the area was named in `docs/project/` or
`docs/reusable/`. The intent may still be in overseer-direction.md, and the plan a file's header
cites is then the best account of it.

### The dashboard server, `tools/fleet/`

| Area | Way in | Owning doc |
|---|---|---|
| Collecting sessions and their status | [`collect.ts`](../../tools/fleet/collect.ts), [`status.ts`](../../tools/fleet/status.ts), [`pane.ts`](../../tools/fleet/pane.ts), [`refresh.ts`](../../tools/fleet/refresh.ts) | [overseer-direction.md § Two tenses](overseer-direction.md#two-tenses-the-seam-between-the-overseer-and-the-dashboard) |
| The server, its wire shapes and its stream | [`server.ts`](../../tools/fleet/server.ts), [`wire.ts`](../../tools/fleet/wire.ts), [`state.ts`](../../tools/fleet/state.ts), [`live.ts`](../../tools/fleet/live.ts), [`config.ts`](../../tools/fleet/config.ts) | [fleet-dashboard-modes.md](fleet-dashboard-modes.md) for the path a datum takes |
| Routes: one `routes-*.ts` per endpoint, composed in a `*-wiring.ts` | [`routes-steer.ts`](../../tools/fleet/routes-steer.ts), [`health-wiring.ts`](../../tools/fleet/health-wiring.ts) | [fleet-dashboard-modes.md](fleet-dashboard-modes.md) |
| Writing to a session: steering, actions, the queue | [`steer.ts`](../../tools/fleet/steer.ts), [`actions.ts`](../../tools/fleet/actions.ts), [`queue.ts`](../../tools/fleet/queue.ts), [`send-coordinator.ts`](../../tools/fleet/send-coordinator.ts) | [overseer.md § Steering](overseer.md#steering-and-the-actions-you-have) names `actions.ts` only |
| What survives a failed or repeated send: holds, receipts, request keys | [`quarantine.ts`](../../tools/fleet/quarantine.ts), [`hold-ledger.ts`](../../tools/fleet/hold-ledger.ts), [`receipt-journal.ts`](../../tools/fleet/receipt-journal.ts), [`request-key.ts`](../../tools/fleet/request-key.ts) | **none** |
| Starting, renaming and describing sessions | [`routes-new.ts`](../../tools/fleet/routes-new.ts), [`routes-rename.ts`](../../tools/fleet/routes-rename.ts), [`describe.ts`](../../tools/fleet/describe.ts), [`notify-overseer.ts`](../../tools/fleet/notify-overseer.ts) | **none** |
| Reading the Overseer's store: attention, decisions, claims, recovery, schedule | [`attention.ts`](../../tools/fleet/attention.ts), [`overseer-status.ts`](../../tools/fleet/overseer-status.ts), [`decisions-view.ts`](../../tools/fleet/decisions-view.ts), [`reports-view.ts`](../../tools/fleet/reports-view.ts), [`recovery-feed.ts`](../../tools/fleet/recovery-feed.ts) | [work-reports.md § Where the code is](work-reports.md#where-the-code-is) for claims; **none** for the rest |
| Box health and its 24 hours | [`health.ts`](../../tools/fleet/health.ts), [`health-history.ts`](../../tools/fleet/health-history.ts), [`resource-policy.ts`](../../tools/fleet/resource-policy.ts) | [diagnose-box-resources.md](../reusable/diagnose-box-resources.md) is what it implements; no doc of its own |
| Admission: would a test run be let in right now | [`admission-census.ts`](../../tools/fleet/admission-census.ts), [`routes-admission.ts`](../../tools/fleet/routes-admission.ts), [`admission-wiring.ts`](../../tools/fleet/admission-wiring.ts) | **none** here; the gate itself is in [testing.md](testing.md) |
| Readiness | [`readiness.ts`](../../tools/fleet/readiness.ts), [`readiness-verdict.ts`](../../tools/fleet/readiness-verdict.ts), [`readiness-store.ts`](../../tools/fleet/readiness-store.ts) | [readiness.md § Where it lives](readiness.md#where-it-lives) |
| Usage, read from the checkpoint, and its history | [`usage-feed.ts`](../../tools/fleet/usage-feed.ts), [`account-usage-feed.ts`](../../tools/fleet/account-usage-feed.ts), [`usage-history.ts`](../../tools/fleet/usage-history.ts) | [usage-per-account.md](usage-per-account.md), [usage-history.md](usage-history.md) |
| Recent messages and transcripts | [`routes-recent-feed.ts`](../../tools/fleet/routes-recent-feed.ts), [`transcript.ts`](../../tools/fleet/transcript.ts) | [fleet-recent-messages.md](fleet-recent-messages.md) |
| Deploys tab, diagnostics, which revision is running | [`deploys.ts`](../../tools/fleet/deploys.ts), [`routes-diagnostics.ts`](../../tools/fleet/routes-diagnostics.ts), [`revision.ts`](../../tools/fleet/revision.ts), [`build-stamp.ts`](../../tools/fleet/build-stamp.ts) | **none** |
| Dictation into the page's text boxes | [`transcribe.ts`](../../tools/fleet/transcribe.ts), [`vocabulary.ts`](../../tools/fleet/vocabulary.ts), [`routes-transcribe.ts`](../../tools/fleet/routes-transcribe.ts) | **none**; [dictation.md](dictation.md) is the product's and does not mention the port |

### The page, `tools/fleet/web/src/`

| Area | Way in | Owning doc |
|---|---|---|
| The shell: the tabs, the URL hash, the bottom bar | [`App.tsx`](../../tools/fleet/web/src/App.tsx), [`mode.ts`](../../tools/fleet/web/src/mode.ts), [`Dock.tsx`](../../tools/fleet/web/src/Dock.tsx) | [fleet-dashboard-modes.md § The registrations](fleet-dashboard-modes.md#the-registrations) |
| Getting state into the page | [`useFleetState.ts`](../../tools/fleet/web/src/useFleetState.ts), [`transport.ts`](../../tools/fleet/web/src/transport.ts), [`types.ts`](../../tools/fleet/web/src/types.ts), [`single-flight-reader.ts`](../../tools/fleet/web/src/single-flight-reader.ts) | [fleet-dashboard-modes.md](fleet-dashboard-modes.md), which names only `types.ts` of these |
| One panel per tab, each with a `*-client.ts` that parses its route | [`SessionsPanel.tsx`](../../tools/fleet/web/src/SessionsPanel.tsx), [`FeedPanel.tsx`](../../tools/fleet/web/src/FeedPanel.tsx), [`UsagePanel.tsx`](../../tools/fleet/web/src/UsagePanel.tsx), [`ReadinessPanel.tsx`](../../tools/fleet/web/src/ReadinessPanel.tsx), [`DecisionsPanel.tsx`](../../tools/fleet/web/src/DecisionsPanel.tsx) | the tab's own doc where one exists; **none** for Sessions, Box health, Overseer, Queued ideas, Deploys, Questions |
| Sending from the page: actions, receipts, unsent drafts | [`useActions.ts`](../../tools/fleet/web/src/useActions.ts), [`request-envelope.ts`](../../tools/fleet/web/src/request-envelope.ts), [`drafts.ts`](../../tools/fleet/web/src/drafts.ts), [`ActionButtons.tsx`](../../tools/fleet/web/src/ActionButtons.tsx) | **none** |
| Shared display decisions and chrome | [`view.ts`](../../tools/fleet/web/src/view.ts), [`ui.tsx`](../../tools/fleet/web/src/ui.tsx), [`Tooltip.tsx`](../../tools/fleet/web/src/Tooltip.tsx) | [fleet-dashboard-modes.md § The card on the button](fleet-dashboard-modes.md#the-card-on-the-button) for the tooltips |

### The Overseer, `tools/overseer/`

| Area | Way in | Owning doc |
|---|---|---|
| The daemon, its store and its one writer | [`daemon.ts`](../../tools/overseer/daemon.ts), [`store.ts`](../../tools/overseer/store.ts), [`lock.ts`](../../tools/overseer/lock.ts), [`notes.ts`](../../tools/overseer/notes.ts) | [overseer-direction.md § The store](overseer-direction.md#the-store) |
| Where its evidence comes from | [`source.ts`](../../tools/overseer/source.ts), [`observation.ts`](../../tools/overseer/observation.ts), [`diff.ts`](../../tools/overseer/diff.ts) | [overseer-direction.md § Two tenses](overseer-direction.md#two-tenses-the-seam-between-the-overseer-and-the-dashboard) |
| The scheduler and the standing jobs | [`scheduler.ts`](../../tools/overseer/scheduler.ts), [`standing-jobs.ts`](../../tools/overseer/standing-jobs.ts), [`schedules.ts`](../../tools/overseer/schedules.ts), [`schedule-plan.ts`](../../tools/overseer/schedule-plan.ts), [`dispatch.ts`](../../tools/overseer/dispatch.ts) | [overseer-direction.md § The scheduler](overseer-direction.md#the-scheduler), [overseer.md § The standing jobs](overseer.md#the-standing-jobs) |
| The deterministic rules | [`rules.ts`](../../tools/overseer/rules.ts), [`rule-jobs.ts`](../../tools/overseer/rule-jobs.ts), [`rule-protocol.ts`](../../tools/overseer/rule-protocol.ts) | [overseer.md § The three deterministic rules](overseer.md#the-three-deterministic-rules-that-pay-back-most) gives the intent and names no file |
| Launching a session on Greg's behalf | [`launch-protocol.ts`](../../tools/overseer/launch-protocol.ts), [`launch-gate.ts`](../../tools/overseer/launch-gate.ts), [`launch-store.ts`](../../tools/overseer/launch-store.ts), [`launchers.ts`](../../tools/overseer/launchers.ts) | **none** |
| Attention: what needs Greg, ranked | [`attention.ts`](../../tools/overseer/attention.ts), [`attention-pass.ts`](../../tools/overseer/attention-pass.ts), [`turn-tail.ts`](../../tools/overseer/turn-tail.ts), [`model-budget.ts`](../../tools/overseer/model-budget.ts) | [overseer-direction.md § Attention](overseer-direction.md#attention-and-who-the-overseer-is-really-watching) gives the intent and names no file |
| What a pane is really doing, and which harness holds it | [`work.ts`](../../tools/overseer/work.ts), [`work-probe.ts`](../../tools/overseer/work-probe.ts), [`harness.ts`](../../tools/overseer/harness.ts) | **none** |
| Recovery after a reboot | [`recovery.ts`](../../tools/overseer/recovery.ts), [`recovery-resume.ts`](../../tools/overseer/recovery-resume.ts), [`recovery-view.ts`](../../tools/overseer/recovery-view.ts) | [overseer-direction.md § Reboot revival](overseer-direction.md#reboot-revival-and-the-thing-gjd-remote-resume-does-not-do) gives the intent and names no file |
| Usage limits and accounts | [`usage.ts`](../../tools/overseer/usage.ts), [`account-usage.ts`](../../tools/overseer/account-usage.ts), [`accounts.ts`](../../tools/overseer/accounts.ts), [`codex-usage.ts`](../../tools/overseer/codex-usage.ts) | [usage-per-account.md](usage-per-account.md), [overseer-direction.md § Usage limits](overseer-direction.md#usage-limits) |
| Work reports and decisions | [`reports.ts`](../../tools/overseer/reports.ts), [`decisions.ts`](../../tools/overseer/decisions.ts) | [work-reports.md](work-reports.md) |
| The queue of ideas | [`idea-queue.ts`](../../tools/overseer/idea-queue.ts), [`idea-queue-wait.ts`](../../tools/overseer/idea-queue-wait.ts) | [overseer-queue.md](overseer-queue.md) is the queue; it names the CLI and none of these files |
| The `overseer` command | [`scripts/overseer.ts`](../../scripts/overseer.ts), [`cli-tick.ts`](../../tools/overseer/cli-tick.ts), [`status-cli.ts`](../../tools/overseer/status-cli.ts), [`diagnose.ts`](../../tools/overseer/diagnose.ts) | [overseer.md](overseer.md) says when to run which |

### How each is run

- **The dashboard**: [`fleet-dashboard.service`](../../infra/hetzner/systemd/fleet-dashboard.service),
  which runs `npm run build:fleet` ([`vite.fleet.config.ts`](../../vite.fleet.config.ts)) and then
  `tools/fleet/server.ts`. Restart it only with
  [`scripts/fleet-restart.ts`](../../scripts/fleet-restart.ts) (`npm run fleet:restart`); its header
  says why it has no default mode.
- **The daemon**: [`overseer.service`](../../infra/hetzner/systemd/overseer.service), which runs
  `scripts/overseer.ts run`. [`scripts/overseer-activate.ts`](../../scripts/overseer-activate.ts)
  installs and arms it. A timer,
  [`overseer-watchdog.timer`](../../infra/hetzner/systemd/overseer-watchdog.timer), runs
  [`scripts/overseer-watchdog.ts`](../../scripts/overseer-watchdog.ts) against its heartbeat.
- **The readiness loop** is a plain loop under tmux, not a unit:
  [`scripts/readiness-loop.ts`](../../scripts/readiness-loop.ts), and
  [`scripts/readiness-run.ts`](../../scripts/readiness-run.ts) for one run.
- **Other commands**: [`scripts/overseer-queue.ts`](../../scripts/overseer-queue.ts),
  [`scripts/overseer-decisions.ts`](../../scripts/overseer-decisions.ts),
  [`scripts/overseer-recovery.ts`](../../scripts/overseer-recovery.ts),
  [`scripts/overseer-pins.ts`](../../scripts/overseer-pins.ts). Sessions themselves are launched and
  listed by [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts), which is
  [hetzner-remote-server-box.md](hetzner-remote-server-box.md)'s.

### Where the tests are

All in `tests/`, flat, named for the module: `fleet-*.test.ts` and `fleet-*.test.tsx` (150 files on
2026-10-07), `overseer-*.test.ts` (72), plus `readiness-*.test.ts` and `codex-usage.test.ts`. Ways
in: [`fleet-collect.test.ts`](../../tests/fleet-collect.test.ts),
[`fleet-server-process.test.ts`](../../tests/fleet-server-process.test.ts),
[`fleet-web.test.tsx`](../../tests/fleet-web.test.tsx),
[`overseer-store.test.ts`](../../tests/overseer-store.test.ts),
[`overseer-daemon.test.ts`](../../tests/overseer-daemon.test.ts), and the shared
[`overseer-fixtures.ts`](../../tests/overseer-fixtures.ts). What a tab's test must prove is
[fleet-dashboard-modes.md § The test](fleet-dashboard-modes.md#the-test).

## Rules that are easy to miss

- **This area has its own robustness bar**, above dev and below prod, and a ceiling on it:
  [overseer-direction.md § A higher bar for robustness](overseer-direction.md#a-higher-bar-for-robustness-here-than-elsewhere-and-its-ceiling).
- **Only the Overseer deploys.** Ask it: [overseer.md § Deploying](overseer.md#deploying).
- **There is one collector, and it is the dashboard's.** The Overseer consumes the dashboard's
  stream and does not collect; the dashboard reads the Overseer's files and never writes them:
  [overseer-direction.md § Two tenses](overseer-direction.md#two-tenses-the-seam-between-the-overseer-and-the-dashboard).
  That is a rule about who writes, not about imports: on 2026-10-07 both directories import from
  each other.
- **This is not Spideryarn.** Nothing here may depend on the product database or on `src/`, bar a
  listed handful of leaf modules that [`tests/fleet-imports.test.ts`](../../tests/fleet-imports.test.ts)
  pins: [overseer-direction.md § Principles](overseer-direction.md#principles).
- **Reachability is the access control.** There is no login and none is coming, so anything that can
  reach the page can run code on the box: [overseer-direction.md § Access](overseer-direction.md#access).
- **A work report is a claim, never a state or a permission**:
  [work-reports.md § A report is a claim](work-reports.md#a-report-is-a-claim).
