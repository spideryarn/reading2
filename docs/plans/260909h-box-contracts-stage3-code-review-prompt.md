# Review: the fleet dashboard can now only confirm the box action it actually showed you

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/box-contracts`, branch
`worktree-box-contracts`. TypeScript + ESM, vitest, React 18 client under `tools/fleet/web/src/`.
`tools/fleet/` is an internal operations dashboard for the ~35 Claude agent sessions running in tmux
on one Linux box.

## The candidate

Committed: `0e7d29a5` (this stage). The server half it talks to is `2c9a6d9a` + `b47d7828`, already
reviewed by you and **not** what I am asking about now.

```
git diff b47d7828..0e7d29a5
git diff --name-only b47d7828..0e7d29a5
```

Changed paths: `tools/fleet/web/src/actions-client.ts`, `tools/fleet/web/src/ActionButtons.tsx`,
`tools/fleet/web/src/HealthPanel.tsx`, `tools/fleet/web/src/App.tsx`,
`tests/fleet-actions-route.test.ts`, `tests/fleet-box-confirm.test.tsx`,
`tests/fleet-web.test.tsx`, `tests/fleet-questions-panel.test.tsx`, and two plan docs.

Start with `actions-client.ts` (`parseActionPreview`, `parseActionMaterial`, `actionMaterialKind`,
`boxActionBody`, `BoxOutcome`, `makeActionsApi`) and `ActionButtons.tsx` (`BoxActions`). That is where
to begin, not the limit of scope.

Plan: `docs/plans/260909h-box-contracts-kill-and-broadcast-reach-the-inputs-the-server-needs.md`.
Brief this was built from: `docs/plans/260909h-box-contracts-stage3-codex-task.md`.

## What it is meant to do

Two box-wide actions — a **kill** (signal every process matching a named rule) and a **broadcast**
(type one staggered sentence into every steerable agent session) — go press → server dry run →
confirmation panel → second press → server run.

The server now mints a receipt on the dry run (`FleetActionPreview`: schema, previewId,
serverInstanceId, actionId, expiresAt, and the canonical material) and refuses any run that does not
hand it back with the material echoed **verbatim**, deep-equal by JSON value semantics. A receipt is
spendable once.

This stage is the client's half of that contract:

- The envelope is **parsed, not trusted, and all or nothing**. It reaches the component as `null` —
  meaning no Confirm may be rendered — unless the whole answer agrees: `schema`, a *stated*
  `dryRun: true`, the top-level `action` equal to the action pressed, the expected preview `op` for
  that action's effect, the envelope's own `actionId`, and a material discriminator matching.
- `boxPreview(actionId, rows)` / `boxConfirm(envelope)` replace `box(actionId, dryRun, rows)`, so a
  confirm with no envelope does not compile.
- `BoxActions` holds **one** state value with a generation counter and discards responses from an
  older press.
- The confirmation renders the candidate/recipient lists, exclusions with reasons, explicit counts,
  and the action's own words; `RawValue` is demoted to a collapsed diagnostic disclosure.
- `rows` are threaded to `HealthPanel`, whose Broadcast previewed with nobody in it and was refused.

**Deliberately out of scope, and not a finding:** the server; `actionRevision` (established
unreachable in an earlier review); a pidfd for the kill's residual pid-reuse window.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside the stage under review — each finding red-first, with
the test that reproduces it — and leave anything wider as a finding for me to decide. **Do not
commit.** List every file you changed at the end.

Do not touch `tools/fleet/routes-actions.ts`, `tools/fleet/wire.ts`, `tools/fleet/routes-new.ts`,
`tools/overseer/**`, or `scripts/gjd-remote.ts`. Keep edits to `HealthPanel.tsx` and `App.tsx` to the
threaded prop — another session is live in both.

This passes for me and must still: `npx vitest run tests/fleet-actions-route.test.ts
tests/fleet-actions.test.ts tests/fleet-broadcast-route.test.ts tests/fleet-broadcast-card.test.tsx
tests/fleet-web.test.tsx tests/fleet-questions-panel.test.tsx tests/fleet-box-confirm.test.tsx
tests/fleet-imports.test.ts` — 755 passed. `node --import tsx scripts/typecheck.ts` exits 0.

No network, no Postgres, so the wider suite will not collect. **Never touch a live tmux session, the
dashboard on port 8787, or a real process table.**

## Attack it

Independently, before you read my questions below.

**The invariant to break: get a Confirm control onto the page over material the person did not read,
or get `boxConfirm` to submit anything other than the exact envelope the panel is displaying.**

Shapes worth trying, and this list is not the boundary: an answer that is a valid envelope for a
*different* action; a material that parses but whose `status` is a getter, a `__proto__` key, or a
frozen/aliased object the component then mutates while rendering; a preview that arrives after the
component unmounts or after the action list refreshes underneath it; three presses rather than two;
a Confirm pressed twice before the first response; an envelope whose `expiresAt` has already passed
when it arrives; a `result` that disagrees with the envelope it came with.

For each finding give:
- an ID (F8, F9, … — F1–F7 are used by the Stage 2 review), a severity, and **established** or
  **reasoned**
- (a) the input or mutation I can run that shows it fails its own claim
- (b) the smallest change that closes it
A finding with no (a) goes last.

Severity by consequence: **P0** data loss, exploitable security, or the tool broadly unusable; **P1**
user-visible wrong behaviour or an authoritative contract violated; **P2** design or maintainability
risk with no wrong behaviour today; **P3** non-behavioural prose or comment defect. Refuse only on an
**established** P0 or P1, and name what established it.

## One question I have already decided is a defect — tell me if I am wrong, and fix it if I am right

`actionMaterialKind` in `actions-client.ts` maps **hardcoded action ids** to a material kind, and
`boxActionBody` separately branches on the literal `"resource-broadcast"` to decide whether a preview
body carries recipients. The implementer flagged this as underspecified and chose it deliberately.

I think it is a P2 that **recreates by construction the exact failure class this whole stage exists
to fix.** The next box action added — say a second broadcast — would send a preview body with no
`recipients`, be refused *"a broadcast needs recipients"* on the route's first line, and be a dead
button again; or, if it were a kill, would get no envelope and so no Confirm, silently.

The client already has the answer from the server: `ClientAction.effect` is
`"spoken" | "enacted" | "broadcast" | "unrecognised"`, parsed off the same feed, and `boxActions(feed)`
hands it to the component, which already calls `press(action)` with the whole `ClientAction`. The
route derives its own material kind from `action.effect`, so using the feed's effect makes the two
ends agree **by construction** instead of by two hand-maintained lists that no test compares.

My proposed shape: `boxPreview(action: { id: string; effect: "enacted" | "broadcast" }, rows)`, with
`actionMaterialKind` and the `"resource-broadcast"` literal both deriving from `effect`. The
component passes its `ClientAction` straight in; the ~6 test call sites pass a two-field literal.

**Is that right?** If it is, make the change red-first — a test with an unknown-id action of a known
effect getting a working preview body and a Confirm. If you think the hardcode is correct (there is
server-side precedent: `killRoute` maps ids to a `KillPolicy` and refuses `wrong-scope` otherwise),
say so and say why, and leave it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

1. `parseActionMaterial` returns `raw as FleetActionMaterial` — the original object, by design, so
   the echo is verbatim. Does returning an unvalidated-by-structure alias of caller-controlled JSON
   create any way for the rendered confirmation to disagree with the submitted material?
2. The generation counter. Is it incremented and compared in every path, including the confirm's own
   response, and does a *confirm* landing after a newer *preview* do the right thing?
3. `expiresAt` is on the envelope and the client never looks at it. Should the panel withdraw Confirm
   when the clock passes it, or is letting the server refuse the right answer?
4. `tests/fleet-box-confirm.test.tsx` is new. Does any of it assert on something weaker than the
   thing it claims to test — a control being absent when it would have been absent anyway?
