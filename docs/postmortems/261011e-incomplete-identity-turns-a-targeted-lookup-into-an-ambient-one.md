# Incomplete identity turns a targeted lookup into an ambient one

Caught during review of [plan 261011e](../plans/261011e-tell-labels-the-sender-as-an-agent.md).
No real message was sent during reproduction; tests used pure helpers and fake commands.
It affected no real message: `f70b2a258` was fixed in the same worktree before it was pushed.

The defect was introduced by `f70b2a258`: `ownSessionQuery` in
[`gjd-remote-tell.ts`](../../scripts/gjd-remote-tell.ts) omitted `-t` when `TMUX` was set but
`TMUX_PANE` was absent or empty. Tmux's untargeted `display-message` chooses an active pane;
that is evidence about a client, not necessarily about the process running `tell`. If it named
the claim holder, `voiceFor` could label a peer as the Overseer. Agent detection still prevented
the `greg` label.

The class is **incomplete identity broadening a targeted lookup into an ambient lookup**.
Losing identity evidence should reduce confidence, but this fallback substituted another object.
The existing integration tests supplied a valid pane whenever they supplied `TMUX`, so the
fallback was never exercised. Four direct cases went red before the fix: absent, empty, named
and newline-bearing pane targets; missing and empty produced an argv without `-t`.

The long-term fix is also the small fix: require a literal `%N` pane id, always target it,
and otherwise send as an unnamed agent. No additional discovery mechanism is needed.

Countermeasures ranked by ease against value:

1. Test partial identity inputs and assert no query occurs. Added direct regressions and fake-CLI
   coverage in [`gjd-remote-tell.test.ts`](../../tests/gjd-remote-tell.test.ts).
2. Assert the exact target on the valid path. The existing argv assertion already does this.
3. Infer identity through process ancestry or additional session discovery. Rejected: unnecessary
   complexity when honest unnamed attribution already preserves the authority boundary.

Tmux can link one window into multiple sessions. A pane id alone therefore does not prove unique
session ownership in every possible tmux layout. The review found no linked-window use in this
repo and did not reproduce misattribution in that layout; this remains a wider limitation to
investigate if linked sessions become part of the fleet.
