Four code defects are fixed, with regression tests seen red first. **A pending-autosave data-loss path remains outside the permitted manifest.** Nothing was committed.

- **F12 — P0, established: unmounting does not finish an autosave. Reported only; ship blocker.** Save A, type B, then navigate to `/changelog`. [useAutosavedText.ts:263](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/useAutosavedText.ts:263) retains B until A settles. The field’s warning disappears, but `safeToReload()` permits reloading and discarding B’s callback. My probe went red: the final write was still unsent, yet safety returned `true`. Fixing this reliably requires tracking work through completion in the autosave owner, outside this manifest.

- **F13 — P0, established: Feedback’s veto missed unsent audio. Fixed.** An empty textarea can accompany recording, transcription, or failed audio awaiting retry. Device persistence is best effort. [FeedbackDialog.tsx:722](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/FeedbackDialog.tsx:722) now includes those states. Three cases in `feedback-dialog.test.tsx` went red before the fix and green afterward.

- **F14 — P1, established: watcher requests did not update connectivity. Fixed.** After reconnection, successful build checks could leave reloads permanently vetoed. Conversely, a failed check could leave connectivity true, allowing a later subscriber to act on an old notice. [stale-shell.ts:387](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/stale-shell.ts:387) now reports successful requests and transport failures; deadline aborts do not declare disconnection. The production-watcher test went red separately for both defects.

- **F15 — P1, established: the hook could adopt the destination’s pathname. Fixed.** If navigation happened before its passive effect, the changelog hook captured the new address and considered that page eligible. [useReloadForNewBuild.ts:47](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/useReloadForNewBuild.ts:47) now checks `/changelog` explicitly. The late-effect regression test observed an unwanted reload before the fix.

- **F16 — P1, established: inherited stage names defeated the neutral fallback. Fixed.** `__proto__` and `constructor` crashed rendering; `toString` drew the wrong content. [Metadata.tsx:419](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/Metadata.tsx:419) now checks own keys. All three cases went red. Tests now assert the neutral glyph, alongside the known-stage control.

- **F17 — P2, established: page tests bypassed production safety wiring. Fixed in tests.** The existing changelog tests supplied their own `safe` function. I added four cases using the real safety check. All four went red when I temporarily replaced the production safety function with unconditional permission; that control was restored.

- **F18 — P0, established: existing lazy-route recovery bypasses safety. Reported only.** [reloadIfStale:236](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/stale-shell.ts:236) still reloads with a retained Chat draft; my probe observed that call while `safeToReload()` returned false. This behavior predates the candidate and remains unchanged as requested. Consequently, the absolute “no reload can lose drafts” contract conflicts with preserving existing recovery.

- **F19 — P1, reasoned: a wider URL-derived sibling can crash shelf cards. Reported only.** [table-sort.ts:156](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/lib/table-sort.ts:156) admits inherited keys through `id in natural`. The real parser preserved `__proto__`, `constructor`, and `toString`. [Library.tsx:490](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/Library.tsx:490) then selects inherited `CARD_NOTES` values and calls them. This predates the stage; no browser reproduction was performed.

- **F20 — P2, reasoned: remaining wire-derived table lookups have forward-compatibility risks. Reported only.** Current server vocabularies do not establish wrong behavior today. Unknown values can omit labels; inherited names can defeat fallbacks or produce invalid render values:

  | Site | Wire-derived value |
  |---|---|
  | [SourceScanNotice.tsx:441](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/SourceScanNotice.tsx:441), :443, :423 | Finding kind, ordinary explanation, blind spots |
  | [MirrorPanel.tsx:357](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/MirrorPanel.tsx:357) | Remark kind |
  | [CriteriaPanel.tsx:1234](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/CriteriaPanel.tsx:1234) | Criterion kind |
  | [MarginaliaColumn.tsx:372](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/marginalia/MarginaliaColumn.tsx:372), :380, :526, :537 | Relation and provenance |
  | [ProfilePage.tsx:438](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/ProfilePage.tsx:438) | Model provider |
  | [useGptLive.ts:738](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/live/gpt-live/useGptLive.ts:738) | Provider close reason |

The production watcher’s visibility gates and shared per-build session guard hold. A check finishing hidden cannot trigger the changelog reload. Keeping every attempted identity is necessary for the alternating-build guarantee. The Feedback boolean’s multiple-dialog concern is a future ownership risk; production currently mounts one host.

The doc audit found these limits:

| Doc | Result |
|---|---|
| `web-client.md` | Its scoped descriptions match the code. |
| `changelog.md` | Mechanics match; “nothing unsent would be lost” overclaims safety because of F12. |
| Postmortem | Corrected the Sentry attribution to “strongly supported, not proven”; recorded F12’s root cause. |
| First feedback note | The new appendix preserves the provenance caveat and accurately says navigation interception was not built. |
| Refresh feedback note | Cadence, address preservation and session guard match; the broad safety claim has F12’s exception. |
| Plan | The revised design matches the implementation, except its assertion that pending autosaves cannot exist on `/changelog`. |

I ran the requested two suites directly: **61 tests passed** initially. Final verification passed **15 suites, 412 tests**, and all four TypeScript projects. The npm typecheck entry point hit a sandbox IPC error; the same repository script passed through `node --import tsx`. Lint reports one pre-existing complexity advisory.

No database or browser checks were run. The plan contains no raw two-build stage output, so its reported browser pass and failing control remain your claim.

**Verdict: do not ship.**