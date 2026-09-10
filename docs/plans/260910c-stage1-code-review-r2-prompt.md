# Review, round 2: Stage 1 of session continuity — your round-1 fixes, and the three findings left open

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/session-continuity`, branch
`worktree-session-continuity`. TypeScript + ESM; the dashboard's browser code is **React 19**
(19.2.8) under `tools/fleet/web/src/`; tests are vitest + jsdom.

This is **round two, and the last round of discovery** for this stage. After it I settle anything
still open myself, and an overruled P0 or P1 goes to arbitration rather than past.

## The candidate

Committed, two commits, in order:

1. `c71ddbac4ab41c573739300a55ff2a74ac916dd1` — **your round-1 fixes** (F11–F14), which I read and
   verified before committing. Review them as **someone else's unreviewed code**: they have not
   been reviewed by anyone but their author.
2. `3b4d7a071d64d384b3fdb236d08fed643ace1999` — fixes for the three things round 1 left open, built by an implementer from a
   brief I wrote (`260910c` ledger, rows F10, F11 follow-up, F16).

       git show c71ddbac4ab41c573739300a55ff2a74ac916dd1
       git show 3b4d7a071d64d384b3fdb236d08fed643ace1999
       changed paths: git show --name-only --format= <each>

**Scope the diff to those two commits.** Other commits on the branch belong to other stages.

**Other reviewers and implementers may be in this worktree at the same time.** Do not edit:
`drafts.ts`, `MessageOverseerCard.tsx`, `BroadcastCard.tsx`, `FeedPanel.tsx`, `feed-client.ts`,
`useActions.ts`, `actions-client.ts`, or their tests (`fleet-drafts`, `fleet-overseer-message`,
`fleet-broadcast-card`, `fleet-feed-freshness`, `fleet-feed-panel`). A red in one of those is not
yours: name it and re-run your own files.

## What it is meant to do

The guarantee as narrowed after your F15 — read § "What this guarantees" in
`docs/plans/260910c-session-continuity-protect-drafts-and-keep-context-current.md`:

> No state the browser holds and draws about a session — a draft, a transcript reading, an action
> outcome, a refusal — can be presented under, or restored for, a conversation other than the one
> it was created against, **among the changes the browser has evidence for**. An execution reading,
> a tmux-server pid or a conversation claim that goes unknown and returns unchanged destroys nothing.

## Previous findings

| ID | Finding, round 1 | Disposition | What changed |
|---|---|---|---|
| F10 | Transcript answers carry no provenance | Accepted | `readRecentMessages` stamps each answer with the conversation it read; the browser draws a mismatch as a refusal, and accepts an unstamped (older-server) answer as before. The tmux world is deliberately not in the stamp. |
| F11 | Claim and world missing from the mount key | Fixed by you — **then followed up** | Your key reads `collect.ts:550`'s `tmuxServerPid: null` on a failed `list-panes` as a change, so a loaded box remounted the pane and wiped the composer. The key now holds the last *known* world and claim per session and moves only between two known, different values. |
| F12 | A flicker erased an established conflict | Fixed by you, accepted | — |
| F13 | The latch recorded the tap-time payload | Fixed by you, accepted | I had dismissed this; you were right. |
| F14 | A dialog refusal was hidden, not cleared | Fixed by you, accepted | — |
| F15 | Hidden replacement undetectable | Guarantee narrowed (your first option) | Not a code change. |
| F16 | Two answering latches | Accepted | `QuestionsPanel` takes App's latch and handler as props. |

## What you may change

**You may edit this worktree**, inside this stage: fix what you establish, red-first, and report
anything wider. Do not commit. List every file you changed.

Gates as I ran them on the tree carrying both commits: `npx vitest run tests/fleet-` — **92 of 93
files passed**, and the one red (`tests/fleet-decisions-route.test.ts`, server.ts wiring) was
`process.exit(2)` because this worktree had never built the fleet client: `server.ts` refuses to
start without `tools/fleet/web/dist/index.html`. After `npm run build:fleet` that file passes 15 of
15. `npm run typecheck` exit 0 (`logs/tmux-jobs/sc-wide-tests-0853-524644.log`,
`sc-wide-typecheck-0854-524972.log`).

## Attack it

Is the guarantee above **accurate** of these two commits? Concretely:

- **Your own round-1 fixes, as strangers' code.** The render-phase `setLastConflict` in
  `Conversation` and `setPermissionRefusal(null)` in `SessionDetail` — guarded against loops, and
  correct under a discarded render? The layout-effect ref in `App` — is there an ordering in which
  the refusal arrives before the layout effect for a payload that has already painted?
- **The held-last-known key** — `useDetailTargetKey` in `continuity.ts`, which `SessionsPanel` now
  uses. Every sequence of `tmuxServerPid` and claim values: known → null → same, known → null →
  different, null from first sight, and a row disappearing and returning. It is built from three
  independent `useState` maps (execution, world, claim) inside one hook: can they disagree in a
  frame? An empty-string claim is treated as unknown — is that ever a real, distinct claim?
- **The provenance stamp.** `readRecentMessages` in `tools/fleet/transcript.ts` now returns
  `RecentMessagesOf`, stamped by one wrapper. Every arm it can return; every other caller of it
  (`routes-recent-feed.ts` was reported as needing no change — check); an answer arriving after the
  row's claim has moved *twice*. On the client (`messages-client.ts`, `ofTheClaimAsked`, and the new
  `moved` arm drawn in `RecentMessages.tsx`): a mismatch refuses on *every* arm including not-found
  and unreadable; a `null` stamp is a real stamp, so asking under C and hearing "no id" is `moved`;
  a stamp present but neither a string nor null becomes `no-answer`. Are those three right, and is
  the `moved` refusal's copy true?
- **The one latch.** `QuestionsPanel.tsx` now takes App's `answeringRefusal` and handler, and draws
  a new alarm-toned notice on the Questions tab stating the latched refusal. Is that notice drawn
  exactly when the buttons are withheld for that reason, and never otherwise?
- **Tests that pass for the wrong reason.** Mutate each fix and check its test fails.

Findings continue from **F17** (F50 onwards is reserved for the Stage 3 review). Each: ID,
severity, established or reasoned; (a) the input or mutation I can run; (b) the smallest change.

  P0  data loss, exploitable security, or the tool broadly unusable
  P1  user-visible wrong behaviour, or an authoritative contract violated
  P2  design or maintainability risk with no wrong behaviour today
  P3  non-behavioural prose or comment defect

Refuse only on an established P0 or P1, and name what established it.
