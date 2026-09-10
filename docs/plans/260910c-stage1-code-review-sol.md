Verdict: **refuse the guarantee as stated**. The in-scope client defects I established are fixed, but F10 and F15 still make the absolute guarantee false.

## Findings

### F10 — P1 · established · unresolved: transcript responses are not identity-bound

(a) `/api/messages` receives only `row.id`. If the browser holds claim C, but the server snapshot advances to claim D before the request is handled, [server.ts](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/server.ts:757) reads D’s transcript. The browser then labels that response with its locally captured C identity in [RecentMessages.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/RecentMessages.tsx:648). The response carries no provenance with which to detect the mismatch.

(b) Send expected tmux world, conversation claim, and verified execution identity as preconditions—not as a caller-selected path—and have the route refuse a changed target or return authoritative response identity which the browser compares before drawing. This crosses the client/server boundary, so I left it for you.

### F11 — P1 · established · fixed: the detail key omitted conversation and tmux world

(a) Under an unverifiable execution, changing either `claudeSessionId` or `tmuxServerPid` retained the draft and both outcome cards.

(b) The mount key now includes tmux server PID and claimed conversation around the execution key in [SessionsPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/SessionsPanel.tsx:587).

### F12 — P1 · established · fixed: an unverifiable flicker erased an established conflict

(a) `conflicting → unknown` removed `PreviousConversation`. With a recent transcript, `StaleNote` was absent too, leaving the previous conversation uncaveated.

(b) [RecentMessages.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/RecentMessages.tsx:756) now retains the last established conflict until verified coherence arrives, with different wording when the latest pass could not re-check it.

### F13 — P1 · established · fixed: the page latch used the tap-time payload

(a) Start an answer under S1, receive enabled S2 while it is pending, then receive `answering-disabled`. The callback captured S1, so S2 was incorrectly treated as post-refusal evidence and the buttons immediately returned.

(b) [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/App.tsx:231) now records the latest committed payload at the moment the refusal arrives.

### F14 — P1 · established · fixed: a dialog refusal was hidden, not cleared

(a) `question A → grants-permission → no question → identical new question A` resurrected the old refusal.

(b) [SessionDetail.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/SessionDetail.tsx:744) now clears a refusal synchronously when its tuple changes.

### F15 — P1 · established contract gap · unresolved: unverifiable first sight cannot support the absolute execution guarantee

(a) First show an unverifiable row and type state under actual execution A. Replace A with B before any verified reading arrives, then deliver the first verified reading for B. Because there was no prior verified baseline, B establishes epoch 0 and the state survives.

More generally, the page cannot promise facts about replacements hidden entirely inside unverifiable observations while also preserving state through that weather.

(b) Either narrow the guarantee to changes the browser has evidence for, or change the product rule so state created before the first verified baseline is withheld/remounted when verification first arrives. The latter conflicts with the accepted “cannot tell” behavior, so this needs your decision.

### F16 — P1 · established, wider than the detail-pane guarantee

`QuestionsPanel` still owns a separate `answering-disabled` latch in [QuestionsPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/QuestionsPanel.tsx:171). A refusal in Session detail does not prevent the Questions tab offering buttons from the stale enabled payload. This does not violate the narrowly worded detail-pane guarantee, but it contradicts the notion of one page-level owner.

Smallest change: pass App’s refusal and handler into `QuestionsPanel`; leave only `grants-permission` local to a dialog.

## Specific checks

- The render-phase state adjustment is guarded and did not loop. Under StrictMode, no committed frame combined the replacement’s title with the old draft. The installed runtime is React **19.2.8**, not React 18.
- The three original epoch maps do not currently disagree behaviorally: the parent remount destroys the two child maps on replacement, while each child only compares identities within its own lifetime.
- Row disappearance unmounts detail state; return mounts fresh state while the parent retains its token baseline.
- A tab round-trip destroys detail-local state and its maps; the App refusal survives.
- Withdrawing `StaleNote` on verified conversation is internally consistent: the identity hazard is disproved and the “last wrote” age remains visible. A stronger long-tool-call warning would be a separate product decision.
- A newly parsed, enabled payload after a refusal legitimately satisfies “received after.” The real latch bug was counting a payload received before the refusal.

Mutation checks succeeded:

- Dropping `row.id` now fails the two-unverifiable-session test.
- Using the raw token fails both flicker regressions.
- Omitting either conversation or tmux world fails its new regression.
- Simulating a below-tab latch fails the tab-round-trip test.
- Reverting the refusal-time boundary fails the pending-request regression.

Verification:

- `fleet-web` plus `fixture-ids`: **451 passed**.
- All TypeScript projects passed via `node --import tsx scripts/typecheck.ts`. The normal wrapper could not create its `/tmp/tsx-1000/*.pipe` in this sandbox and exited 1 before typechecking.
- Scoped lint still exits 1 on pre-existing `SessionsPanel` ARIA errors and baseline advisory diagnostics.
- `git diff --check` passed.

Files I changed:

- `tools/fleet/web/src/App.tsx`
- `tools/fleet/web/src/RecentMessages.tsx`
- `tools/fleet/web/src/SessionDetail.tsx`
- `tools/fleet/web/src/SessionsPanel.tsx`
- `tests/fleet-web.test.tsx`

I did not edit the parallel Stage 3 files or other changes that appeared in the worktree.