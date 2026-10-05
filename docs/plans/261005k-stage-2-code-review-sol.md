Fixed four behaviour defects and two wording defects. Nothing committed. The shipping prompt and `command-suggest/2` version are unchanged.

Locations below refer to the corrected working tree.

| Finding | Evidence and consequence | Location | Fixed |
|---|---|---|---|
| **CR5 — P1** | **Established, red-first:** an old suggestion response overwrote a newer profile read, restoring stale suggestions. An old `no-reason` response could also contradict that newer read. Both response orders are covered. | [command-suggest-client.ts:125](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/command-suggest-client.ts:125) | Yes |
| **CR6 — P1** | **Established, red-first:** initial `purposeFailed` and failed HTTP reads silently removed the offer and explanation. They now show a retry explanation and an explicit retry press. | [command-suggest-client.ts:107](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/command-suggest-client.ts:107) | Yes |
| **CR7 — P1** | **Established, red-first:** a current `no-reason` reply displayed its message but retained “has reason,” leaving the suggestion row available. The reply now updates that state. | [CommandBar.tsx:2238](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/CommandBar.tsx:2238) | Yes |
| **CR8 — P1** | **Established, red-first:** inserting the offer after a slow read changed the highlighted command; removing suggestions after a save likewise left Enter addressing an unrelated row. Selection now follows the command or resets appropriately. | [CommandBar.tsx:1853](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/CommandBar.tsx:1853) | Yes |
| **CR9 — P3** | **Established by tracing:** privacy wording said a pressed chat suggestion was sent and kept. It actually waits unsent until Send. Corrected page, reference doc and assertion. | [PrivacyPage.tsx:517](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/PrivacyPage.tsx:517) | Yes |
| **CR10 — P3** | **Established by tracing:** the hash comment claimed 53 bits, but the function returns two 32-bit words. Corrected the comment only. | [command-suggest.ts:238](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/command-suggest.ts:238) | Yes |

Your six suspicions:

1. **No normalization disagreement found.** GET and POST use the same normalization before the shared hash. The defect was observation ordering, CR5.
2. **F6 was incomplete in the visible client.** CR6 fixes that; the POST route already distinguished failure from absence.
3. **No forbidden key reaching activation found.** Server catalogue filtering, reply validation and current-command resolution enforce the restriction.
4. **Owner check holds by tracing.** It queries the authenticated owner’s article directly; sharing does not grant access. Database execution remains yours.
5. **One survivor was a real defect:** the removed `purposeFailed` handling. Save-only invalidation was a coverage gap, now tested with an identical-text save and a failing mutation. Chat availability is always true for today’s owner bar; that guard remains.
6. **The privacy addition needed CR9.** Otherwise, the profile transfer, onward search sharing, possible web searches and unenforced personal-detail exclusion are disclosed accurately. I found no additional transfer needing disclosure.

F1, F2, F3, F4, F5 and F9 have discriminating tests; temporary controls for each produced the expected assertion failure. F6 now has browser-side red-first tests as well as the existing database route test. Existing `PROFILE_RULES` stayed unchanged.

**Verification:** 673 tests passed across ten local suites; two opt-in catalogue-writing tests skipped. All typecheck projects passed through `node --import tsx scripts/typecheck.ts`; the npm wrapper was blocked by sandbox IPC. Scoped lint reported four advisory complexity messages. Saved eval numbers match the write-up, which correctly acknowledges that passage-retrieval quality was not measured.

Please run `npm test -- tests/command-suggest-route.test.ts`. Expected: owner success with matching fingerprint, 404 for another owner, 401 signed out, 503 for a failed purpose read, and no model calls on rejected or empty-input paths. Real desktop/iPad/phone checks remain unrun.

Every changed file:

- [src/command-suggest.ts](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/command-suggest.ts)
- [src/web/command-suggest-client.ts](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/command-suggest-client.ts)
- [src/web/CommandBar.tsx](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/CommandBar.tsx)
- [src/web/PrivacyPage.tsx](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/PrivacyPage.tsx)
- [tests/command-bar-suggest.test.tsx](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/tests/command-bar-suggest.test.tsx)
- [tests/privacy-page.test.ts](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/tests/privacy-page.test.ts)
- [docs/project/privacy.md](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/project/privacy.md)
- [Root-cause postmortem](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/postmortems/261005p-a-response-completion-stamp-cannot-prove-its-snapshot-is-newer.md)

The three unrelated held-Enter changes were untouched.

VERDICT: land with my fixes