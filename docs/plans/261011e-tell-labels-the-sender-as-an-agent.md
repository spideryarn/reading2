# `gjd-remote tell` labels the sender as an agent when an agent runs it

## The problem

On 2026-10-10 the Overseer used `gjd-remote tell <session> "…"` to ask three sessions to pause their
test runs. `tell` always posts as speaker `greg`, so each message arrived as `[Greg, via the fleet
dashboard] …`. The sessions took it as Greg's instruction, and one later refused the Overseer's
go-ahead because only "Greg" could lift it. That is exactly the failure the A12 rule
(tools/fleet/wire.ts § `Speaker`) exists to prevent: a model's message acquiring Greg's authority.

> Or should we change gjd-remote tell to come from the agent (perhaps rename to tell-from-agent),
> and we have a different command for tell-from-admin? Your call.
>
> — Greg, 2026-10-10

## The decision

**One command; the label follows who is actually running it.** Splitting into `tell-from-agent` and
`tell-from-admin` (the simpler-looking option, passed over) still leaves an agent choosing which one
to type, and an agent choosing the wrong one is the failure we are fixing. The environment already
says who is running the command:

- **Claude Code sets `CLAUDECODE=1`** in its Bash tool's environment (checked on the box,
  2026-10-11, in this session's own Bash tool).
- **Codex sets `CODEX_THREAD_ID`** for the commands it runs (the name is in the 0.160.0 binary; the
  code reviewer confirms it from inside its own shell, recorded below).

Either set and non-empty ⇒ the sender is an agent. Neither ⇒ Greg in his own terminal, and nothing
changes: speaker `greg`.

An agent is then one of two speakers:

- **`overseer`**, the existing arm, when the sender's tmux session (`tmux display-message -p` against
  `$TMUX_PANE`, only when `$TMUX` is set) has the same tmux id and name as the row holding the
  Overseer claim in the dashboard snapshot `tell` already reads.
- **`agent`**, a new arm, otherwise. Its prefix names the sending tmux session when it is knowable
  and says "an unnamed session" when not, says it is NOT Greg and carries none of Greg's authority,
  and asks the reader to weigh it as a peer's suggestion — the style of the `overseer` prefix.

Every mistake in this detection lands on a non-Greg label: a sender wrongly called `agent` instead of
`overseer`, or the reverse, still says "not Greg". The one direction that matters — an agent sent as
Greg — needs the agent's shell to have lost both variables.

## The wire

- `Speaker` gains `"agent"`. `SPEAKER_PREFIX` stays an exhaustive record over the other arms, and the
  `agent` prefix is a function of the sender's name, so every place that prefixes text goes through
  one `speakerPrefix(speaker, from)` and the compiler flags any that do not.
- `POST /api/steer/message` alone accepts `agent` (`parseMessageSpeaker`, the way `box` is), plus an
  optional `from`: the sender's name, allowed only with `agent`, and only a short plain name
  (`isSenderName`) so it cannot close the bracket or carry a second sentence. The action, broadcast
  and queue routes go on refusing `agent` through `parseSpeaker`.
- Like every speaker, this is a claim, not authentication: anything that can reach the dashboard can
  say it is Greg. It stops an honest agent being labelled Greg by accident.

`tell`'s success line names how it went: `sent to 'x' as Greg`, `as the Overseer`, `as agent
'fbxx'`, `as an agent (unnamed session)`.

## Not covered

- A Claude or Codex session whose shell has been scrubbed of both variables (an `env -i`, a fresh
  login shell over ssh) is still sent as Greg.
- On the Mac, the tmux ids are the Mac's, not the box's, so an Overseer match is near impossible
  there; the sender is labelled `agent`, which is still not Greg.
- The dashboard's own web UI is unchanged: it is a person at a browser, and stays `greg`.

## Tests

- First, failing: a `tell` run with `CLAUDECODE=1` posts speaker `agent` with the sender's tmux name,
  not `greg`. Then: `CODEX_THREAD_ID` the same; no `$TMUX` ⇒ `from` null; the sender is the claim's
  holder ⇒ `overseer`; neither variable ⇒ `greg`, as before.
- Route: `agent` and `from` parse on the message route and are refused on the action route; `from`
  without `agent` is refused; a name with `]` is refused; the rendered prefix says "NOT Greg".

The fleet dashboard must be restarted for the route change to take effect. Until it is, the old
route refuses `speaker: "agent"`, so an agent's `tell` fails with nothing typed rather than going
out as Greg.
