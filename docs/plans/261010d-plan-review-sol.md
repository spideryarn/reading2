The plan needs rework. The systemd direction is sound, but the proposed notification path would reject every `box` message, the feedback sweep is omitted, and reprovision robustness is overstated.

1. **P0 blocker — `box` speaker integration is incomplete, so every notification would be refused.**

   Evidence: the plan lists only `Speaker`, `SPEAKER_PREFIX`, and `parseSpeaker` (`docs/plans/261010d-standing-jobs-survive-a-reboot.md:97-100`). Before typing, the steer route writes a receipt (`tools/fleet/routes-steer.ts:1222-1257`). Receipt validation has a separate runtime allowlist containing only `greg`, `overseer`, and `dashboard` (`tools/fleet/receipt-journal.ts:373,484-500`); an invalid receipt is refused (`tools/fleet/receipt-journal.ts:728-735`). The web receipt parser repeats the same allowlist (`tools/fleet/web/src/request-envelope.ts:289-323`).

   Fix: add `box` to both receipt parsers and make their allowlists compile-time exhaustive. Add an end-to-end direct-message test using a real receipt journal and a web receipt parsing test.

   Do not add `box` to the shared `parseSpeaker`: it is also used by queued actions and broadcasts (`tools/fleet/routes-actions.ts:827-872,980-1019`; `tools/fleet/routes-broadcast.ts:482-530`). Use a route-local `parseMessageSpeaker` for `/api/steer/message`. Recent feed, drain and quarantine need no special branch when `box` remains direct-message-only.

2. **P1 should fix — the plan excludes one of the three jobs Greg explicitly requested.**

   The plan declines to make the feedback sweep permanent (`docs/plans/261010d-standing-jobs-survive-a-reboot.md:116-122`), although it already runs and spends money every three hours. Its checked-in loop and exact command exist at `scripts/overseer-tools/feedback-sweep-loop.sh:1-20`.

   Moving the existing cadence to systemd does not introduce a new spending decision; it makes an existing decision durable.

   Fix: extract one feedback-sweep occurrence from the infinite loop and run it from a three-hour systemd timer. Preserve its ambient Claude login, Sentry MCP access, `HOME`, `OVERSEER_SCRATCH`, 150-minute timeout, and non-overlap. State explicitly that reprovision requires restoring those credentials.

3. **P1 should fix — the inventory misses existing box-health collection and creates a competing policy.**

   The claims that pacer gates are “the only reading” and that box health is “nothing” are false (`plan:28,34`). The dashboard already collects load, available memory, swap, swap activity, `/`, and `/home` (`tools/fleet/health.ts:156-170,472-552`) and refreshes this independently about every minute (`tools/fleet/server.ts:505-527,751-769`). The existing thresholds deliberately live in one place (`tools/fleet/resource-policy.ts:1-4,73-125`). The box documentation already calls this the health alert shown in the dashboard, Overseer tick, and launch gate (`docs/project/hetzner-remote-server-box.md:1325-1328`).

   The plan’s proposed thresholds conflict with those cutoffs (`plan:54-65`).

   Fix: describe the missing feature as proactive delivery, not health collection. Make the notifier consume `/api/state.health` or reuse `collectHealth`/`computeVerdict` and `RESOURCE_POLICY`. If alert thresholds intentionally differ from launch-gate thresholds, define that distinction centrally with evidence.

4. **P1 should fix — reprovision survival is substantially overstated.**

   The inventory says the dashboard survives reprovision (`plan:27`), but provisioning deliberately installs and does not enable it (`infra/hetzner/provision.sh:2460-2475`; `docs/project/hetzner-remote-server-box.md:1263-1268`). Provisioning also does not create the primary checkout (`infra/hetzner/provision.sh:1402-1411`) and leaves GitHub credentials empty for later restoration (`infra/hetzner/provision.sh:682-691`). All three proposed jobs depend on checkout code, and notification depends on the dashboard.

   Fix: distinguish:

   - Unit definitions are recreated.
   - Jobs become operational only after checkout, dependencies, dashboard, Git credentials, Overseer secrets, and Claude/Sentry credentials are restored.

   Either automate and verify those prerequisites or narrow the matrix’s “reprovision” claim. The dashboard must now be enabled by provisioning if it is the permanent owner of the steer route.

5. **P1 should fix — the delivery states do not close the OOM/reboot duplicate window.**

   Refused-then-retry is right. Recording uncertainty as sent is not sufficient. If the route types successfully and the notifier is killed before writing `box-health.json`, the next invocation sends a new request and can type the alert twice. If the connection failed before the request arrived, recording uncertainty as sent can instead lose the alert.

   The route already provides durable request-id idempotency (`tools/fleet/request-key.ts:4-24,118-157`; replay at `tools/fleet/routes-steer.ts:1364-1370`).

   Fix: persist `{requestId, target, exact body}` atomically before POST and retry that exact envelope after uncertainty. A replay then returns the original receipt without typing twice. Update `readTellAnswer`, which currently recognizes only `op:"message"` success (`scripts/gjd-remote-tell.ts:185-209`), to recognize receipt replay.

   A `working` Overseer is valid (`tools/fleet/steer.ts:463-468`). The one-line/control-character and 4,000-character restrictions are enforced (`tools/fleet/steer.ts:484-525`), but the cap must apply after adding the `box` prefix.

6. **P1 should fix — dashboard refresh already exists, and moving it “unchanged” preserves several silent failures.**

   The canonical checked-in body is already at `scripts/overseer-tools/dashboard-refresh.sh`; the scratchpad copy is stale. The checked-in script:

   - Treats existing merge, fetch failure, and merge failure as success (`:15-24`).
   - Uses `origin/dev` after fetch rather than reliable `FETCH_HEAD` (`:20-24`).
   - Continues to restart after failed `npm install` (`:31-35`).
   - Does not refuse a generally dirty primary.
   - Has no lock against a surviving tmux loop or another checkout-mutating job.

   Fix: execute the checked-in script, return nonzero and notify on changed persistent failures, use `FETCH_HEAD`, stop after failed installation, refuse a dirty or already-merging primary, and share an explicit `flock`. Verify the old tmux loop is gone before enabling the timer rather than relying only on one generated session name.

   `fleet-restart.ts` does not require tmux or a TTY; it uses `sudo -n` (`scripts/fleet-restart.ts:446-475`). The unit nevertheless needs a generous timeout, because restart/build checks can exceed a default oneshot timeout.

7. **P1 should fix — the checkout and timer execution model is not robust enough as specified.**

   The project explicitly accepts that primary-checkout services may run red dev (`docs/project/hetzner-remote-server-box.md:1245-1255`). These timers could additionally run somebody’s dirty working-tree version while dashboard refresh is changing the checkout or `node_modules`.

   Fix:

   - Install the small health notifier outside the checkout, like box-tidy, or at minimum make it an independent artifact.
   - Run destructive worktree cleanup from a readiness-proven revision, or explicitly accept and document the red-dev risk.
   - Coordinate checkout and dependency mutation with scheduled jobs.
   - Specify `HOME`, explicit `PATH`/absolute executables, `WorkingDirectory`, and network ordering. The sweep’s fetch requires the credential helper and `/etc/github-tokens` (`scripts/worktree-check.ts:690-696`).

   The actual systemd liveness model is sound: the sweep examines same-UID processes and a systemd caller cannot make another session’s lock look like its own (`scripts/worktree-inuse.ts:442-492`; `scripts/worktree-remove.ts:333-349`). It should not need box-tidy’s `AmbientCapabilities`.

   Reboot handling is sound. OOM handling is weak only for the daily sweep: “next tick” may mean another 24 hours. Give failed sweep invocations a small bounded retry policy.

8. **P1 should fix — the sweep changes the existing judgement policy for `in-use` trees.**

   The plan silently leaves every `in-use` result (`plan:68-74`). The current standing job asks the Overseer to inspect trees that are “in use or needing a look” when no live session, deploy, or readiness job owns them (`scripts/overseer-tools/standing-jobs.md:33-36`). A leaked process holding a cwd is precisely such a case.

   Fix: suppress trees owned by an identifiable live fleet/deploy/readiness process, but report changed or persistently in-use trees without such an owner. Continue to leave them untouched.

9. **P2 nice — change-only notification is good; six-hour reminders are probably noisier than necessary.**

   State transitions and one “all clear” message are sensible. Four identical reminders per day indefinitely conflicts with “silent unless judgement is needed.”

   Fix: persist only the last delivered verdict/reasons and delivery time, atomically. Notify on transitions; optionally remind once daily only for unresolved critical or unknown health. Reuse the existing health verdict instead of maintaining another measurement-state model.

10. **P2 nice — the inventory and simpler-options section need smaller factual corrections.**

   The dashboard and feedback scripts are already checked in, despite the table locating them only in `/tmp` (`scripts/overseer-tools/dashboard-refresh.sh`; `scripts/overseer-tools/feedback-sweep-loop.sh`). Permanent daily tmp cleanup is also omitted (`infra/hetzner/tmpfiles.d/tmp.conf:1-12`).

   The daemon scheduler does not only launch Claude sessions as claimed (`plan:135-139`): it has a separately armed deterministic rules-only path (`tools/overseer/jobs.ts:101-126`; `tools/overseer/scheduler.ts:353-398`; `scripts/overseer.ts:622-744`). Systemd remains simpler for independent box chores, but the comparison should be accurate.

The simplest sound shape is four systemd timers: the existing dashboard-refresh body after hardening, one occurrence of the existing feedback sweep, the typed worktree sweep, and a small notification adapter over the existing health verdict. Add the `box` speaker only to the direct-message and receipt surfaces, with durable request IDs.

**REWORK**