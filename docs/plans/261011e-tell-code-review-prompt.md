# Code review: `gjd-remote tell` labels the sender as an agent (plan 261011e)

You are reviewing, and fixing what you find, in the Spideryarn repo at the current working tree
(a worktree). Read `CLAUDE.md`, then the plan `docs/plans/261011e-tell-labels-the-sender-as-an-agent.md`.

This area (tools/fleet, gjd-remote) has a higher robustness bar than the app. The change is
commit `f70b2a258` (`git show f70b2a258`); your fixes stay uncommitted in the working tree. Files:

- tools/fleet/wire.ts (`Speaker` gains `agent`)
- tools/fleet/actions.ts (`isSenderName`, `agentPrefix`, `speakerPrefix`, `renderMessage(text, speaker, from)`)
- tools/fleet/routes-steer.ts (`parseMessageSpeaker`, `parseSenderName`, `MessageRequest.from`, the render at send)
- tools/fleet/receipt-journal.ts (`SPEAKER_SET`)
- scripts/gjd-remote-tell.ts (`runByAgent`, `ownSessionQuery`, `parseOwnSession`, `voiceFor`, `describeVoice`, `TellBody`)
- scripts/gjd-remote.ts (`cmdTell`, help text)
- tests/gjd-remote-tell.test.ts, tests/fleet-steer-route.test.ts
- docs/project/hetzner-remote-server-box.md, docs/project/overseer.md

## The problem it fixes

`gjd-remote tell` always posted speaker `greg`, so an agent (the Overseer) running it spoke with
Greg's authority — the failure the A12 rule (wire.ts § `Speaker`) exists to prevent. Now: if
`CLAUDECODE` or `CODEX_THREAD_ID` is non-empty, the sender is an agent; it is `overseer` if its tmux
session id and name match the claim holder in the snapshot, else `agent` with its tmux session name
as `from` (validated by `isSenderName`, or null).

## What to look for

1. Any path by which an agent-run `tell` still goes out as `greg`, or by which `from` can inject a
   second bracketed attribution line or terminal control characters.
2. Any place that handles `Speaker` and should now handle `agent` but does not (the compiler covers
   `Record<Speaker, …>`; look for string lists, switch statements with defaults, web client code
   under tools/fleet/web that validates speakers, receipts read back from disk, request
   fingerprinting/replay in routes-steer.ts — does `from` need to be in the fingerprint?).
3. Whether the route stays backward compatible for the dashboard card (`steerMessageBody`) and
   `scripts/box-notify.ts`.
4. Test quality: would each new test have failed before the change? Is anything important untested?
5. Doc accuracy against the code.

## One fact to confirm from your own shell

You are a Codex session. Run `env | grep -E '^CODEX_' | cut -d= -f1` and report which variable
names are set in your shell (names only, never values). The plan assumes `CODEX_THREAD_ID` is.
If it is not, say what is, and fix `runByAgent` and the docs accordingly.

## Rules

- Fix what you find within this change's scope; report anything wider instead of doing it.
- Never send keys or messages to any tmux session or pane, never restart any service, never run
  `gjd-remote tell` against the real box. Do not touch git (no commits, stash, reset, checkout).
- Run `npx vitest run tests/gjd-remote-tell.test.ts tests/fleet-steer-route.test.ts` and
  `npm run typecheck` after any fix.
- End with: findings (each with severity and whether you fixed it), the CODEX_ variable names, and
  the test/typecheck results.
