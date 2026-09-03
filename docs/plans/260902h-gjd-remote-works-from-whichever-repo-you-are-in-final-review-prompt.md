# Review: the whole of "gjd-remote works from whichever repo you are in", as landed

Read-only. This is the closing review of the plan
`docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md`. You reviewed the plan, each
of Stages 1–4, the landing and the post-landing fixes (the `…-review-sol.md`, `…-stage{1,2,3,4}-review-sol.md`
and `…-stage4-fixes-review-sol.md` files beside it); do not repeat those findings unless a fix for
one is wrong. Everything is on `dev` at HEAD; the plan's Log (bottom of the doc) is the evidence,
including today's Stage 5 run against the real box from hellozenno, recorded as key names only.

Code: `scripts/gjd-remote.ts`, `scripts/gjd-remote-{repo,config,prompt,setup,flow,envpolicy,env,log,tmux,provision}.ts`,
`infra/hetzner/provision.sh`, and `tests/gjd-remote-*.test.ts`. Docs:
`docs/project/hetzner-remote-server-box.md` § "Which repo, and where on the box" and § "Building a box";
`docs/postmortems/260903a-a-logout-hook-decided-the-exit-status.md`.

Since your last look, three things changed (commits `60cf032` and `e3745e6`):

1. `pushEnvPlan` asks the model only about undecided, unblocked names (`askAbout`); `stageAndSend`
   returns its failure so the `finally` runs before `die()`.
2. `gjd-remote provision`'s cloud-init wait: `cloudInitGate` in `scripts/gjd-remote-provision.ts`
   lets a bad first-boot verdict through when a bootstrap probe (`bootstrapProbeScript`) finds every
   artefact `provision.sh` itself checks first. The box's first boot is `error` for ever.
3. `provision.sh`: user steps run through `"${AS_USER[@]}"` — `runuser -u greg -- env -i HOME=… USER=…
   LOGNAME=… SHELL=… PATH=… bash -c` — instead of `su - greg -c`, because the login shell's
   `~/.bash_logout` (`clear_console -q`) under `set -e` decided the exit status. `run` now reports
   the exit code. A full provision then passed, 43 checks.

Questions, in priority order:

1. Anything that would bite Greg in the first week of real use across two repos on one box — a
   wrong refusal, a silent success, a state the tool cannot get out of without ssh-ing in by hand.
2. `AS_USER`'s `env -i`: is there anything the Claude or Codex installers, `claude mcp add`, or the
   tmux reload script legitimately need from the environment that is now gone (TERM, LANG, XDG_*,
   a proxy variable)? The provision passed, but a passing step is not a proof it needed nothing.
3. `cloudInitGate`: does the artefact probe let through any box that provision.sh would then fail
   on obscurely, which is the failure the wait existed to prevent? Is `sudo test -r` in a
   non-interactive ssh a safe assumption?
4. Stage 5 found that hellozenno's `backend/utils/env_config.py` requires every key, so a 20-key
   `.env.local` on the box would crash that backend at import. Should `push-env` do anything about
   a repo like that (a warning, a per-repo "required keys" line in `.gjd-remote/config.toml`), or is
   that the repo's own problem? One paragraph; Greg decides.
5. Anything in the docs that now says something the code does not do.

Numbered findings with severity, file:function, the concrete change; then "go" or "stop" for
calling this plan finished. No files or remote state may be changed.
