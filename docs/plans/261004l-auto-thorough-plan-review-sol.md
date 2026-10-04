The browser-only approach is a reasonable small v1, but the plan needs changes. No files changed.

1. **F1 — P1, established — Enter after a pause does not reach the proposed trigger.**

   The plan connects auto-thorough through typing’s `start` and `revise`. However, after a pause submits the words, Enter with unchanged words emits **neither** callback: [quick-session.ts:115](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/quick-session.ts:115), [quick-session.ts:155](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/quick-session.ts:155). I ran the reducer sequence: pause emitted `ask`; subsequent Enter emitted `null` and closed the session.

   **Change:** give explicit submission its own notification, including when the quick words were already submitted. Preserve that intent through loading. Test **pause → Enter with unchanged words**, rather than only Enter before the first pause.

2. **F2 — P1, established — A swap can discard an edit; the settle timer does not actually track unchanged words.**

   The hook hears about revisions only after the 600 ms pause. Suppose thorough for “arguments against” finishes just after the reader adds “dualism”, before that pause. The saved quick row still has the old words, so `settleThorough` selects `swap`. Its `rowGone` ends the session, and `dispatch` stops the pending pause timer: [SearchMode.tsx:328](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/modes/search/SearchMode.tsx:328), [quick-session.ts:137](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/quick-session.ts:137). The new words remain in the box without being searched. The reducer reproduction confirmed that the subsequent pause produces no effect.

   Similarly, editing or clearing the box immediately before the settle deadline leaves the old timer eligible until a revision occurs.

   **Change:** observe edits synchronously, including empty and below-minimum drafts. Invalidate the old upgrade on changed words; never end a session with an unsubmitted edit. Specify timer behavior for clear, matcher changes and session termination. Test edits immediately before both launch and completion.

3. **F3 — P1, established — Replacing the URL ID does not preserve the saved row’s position.**

   Saved rows sort by `createdAt`, not `?runs=` order: [SearchPanel.tsx:891](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/SearchPanel.tsx:891). `ask` gives thorough a new timestamp: [useSearch.ts:796](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/useSearch.ts:796).

   Create quick A, then search B before A’s settle deadline. Thorough A is created after B; on success, A moves above B. That contradicts “same place in the list”.

   **Change:** explicitly preserve the source’s display ordering through the swap. A tab-local ordering override can retain the browser-only scope. Test an intervening search and a source whose `createdAt` survived revisions.

4. **F4 — P1, established — Colour inheritance captures an old choice.**

   `ask(words, "meaning", colour)` establishes a separate lasting choice for the meaning ID: [useSearch.ts:788](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/useSearch.ts:788). Meanwhile, the quick row’s colour picker remains usable: [SearchPanel.tsx:1156](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/SearchPanel.tsx:1156).

   If the reader recolours quick while thorough runs, swapping exposes thorough in the original colour. Also, immediate submission must not resolve the newly minted quick ID against slots from the preceding render.

   **Change:** resolve colour once the quick row exists in the visible assignment, and inherit its **latest resolved colour at swap**. Use the existing recolour mechanism to persist changes. Test recolouring during the background call and Enter on a fresh row.

5. **F5 — P1, established — Dropping an obsolete pending run releases the duplicate guard before the call finishes.**

   The pure function says to `drop` when quick changes, even while meaning remains pending. `remove` immediately deletes the meaning ID from `inFlight`: [useSearch.ts:821](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/useSearch.ts:821). Meaning nevertheless keeps running server-side: [routes.ts:4696](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/routes.ts:4696).

   Typing A → settled B → settled A can therefore start another meaning call for A while the original A call is still running. This violates the plan’s duplicate rule. It also contradicts Q-orphan’s “thrown away **when it lands**”.

   **Change:** mark obsolete pairs as discarded but retain their request ownership and hidden rows until completion, then remove them. Keep request lifetime separate from eligibility to swap. Test A → B → A before the first A finishes.

6. **F6 — P1, established — Filtering display rows also hides request status from the panel.**

   `SearchPanel` derives its running question keys by intersecting `own.running` with its `runs` prop: [SearchPanel.tsx:345](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/SearchPanel.tsx:345). Filtering before `useSearchMode` removes the background meaning request from this calculation.

   Switching to meaning leaves Find enabled for those same words, although the band’s `isRunning` guard then silently refuses the press: [SearchMode.tsx:168](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/modes/search/SearchMode.tsx:168).

   **Change:** supply request status independently of visible saved rows. Keep colour assignment, count, toggle-all and hits based on visible rows. Test switching to meaning while the hidden request runs.

7. **F7 — P1, established — Transport failures will not be quiet.**

   The plan removes the failed background row and says “nothing is said”. A transport failure also sets the hook’s shared `error`: [useSearch.ts:741](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/useSearch.ts:741). The panel renders that error independently of saved rows: [SearchPanel.tsx:387](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/SearchPanel.tsx:387). Removing the row does not clear it.

   **Change:** give background requests an explicit quiet failure policy that does not overwrite or clear foreground errors. Test HTTP failure, interrupted stream and model failure separately.

8. **F8 — P1, established — Browser scoping does not make deletion safe against another tab’s pending attempt.**

   The swap checks source existence and words, but no source status. Reachable sequence: A submits quick and automatic meaning; quick fails; B loads that failed quick row and retries it; meaning succeeds in A. A still sees the old quick row with matching words and deletes B’s pending retry.

   Retry can reset that same failed ID: [searches.ts:208](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/searches.ts:208). DELETE is unconditional: [pg-searches.ts:456](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/store/pg-searches.ts:456). B’s fenced finish then updates nothing, and its untombstoned stream reports failure.

   **Change:** acknowledge that predecessor F2 still applies. Either make automatic source deletion conditional on the source still being the intended completed attempt, atomically on the server, or narrow the v1 to retaining the source in storage while replacing its presentation in this tab. A browser status check alone cannot guarantee shared-store safety.

   The trim dismissal also needs qualification: revisions preserve source age, and trim uses `createdAt`, not recency of revision: [pg-searches.ts:189](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/store/pg-searches.ts:189), [pg-searches.ts:329](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/store/pg-searches.ts:329). The reload promise cannot universally guarantee two surviving rows. The durable retry association from predecessor F3 **can** be omitted under the explicitly tab-local promise.

9. **F9 — P1, established — The saved-answer shortcut leaves quick unimproved and can misidentify an answer as current.**

   “Ask nothing” when a finished meaning row exists does not specify an automatic replacement or activation. The reader can remain on quick indefinitely despite an available better answer.

   Moreover, immediately after GET, `SavedSearch.stale` is deliberately false until a subsequent `begin` supplies the article fingerprint: [useSearch.ts:383](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/useSearch.ts:383), [useSearch.ts:845](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/useSearch.ts:845). `!stale` alone does not establish “current”.

   **Change:** define successful saved-answer reuse as an automatic upgrade, with explicit tick, colour and ordering behavior. Establish freshness using known fingerprints—for example, after quick’s `begin`—before suppressing a new meaning call. Test both reuse and an outdated saved answer following GET.

10. **F10 — P2 — The cost table is a call sample, not yet a demonstrated per-search estimate.**

    Chat’s meaning tool uses `findPassages`, which drains the same stream metered as `search`: [chat-tools.ts:1181](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/chat-tools.ts:1181), [search.ts:641](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/search.ts:641). Quick can make multiple metered chunk calls: [quick-search.ts:341](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/quick-search.ts:341).

    **Change:** include the measurement query or durable results, label the population accurately, and distinguish provider-call cost from complete search/session cost. The figures support “substantially more expensive”; the exact hundredfold estimate needs those qualifications.

**Verdict: build with the changes named.** Keep the tab-local design, but resolve F1–F9 before implementation. The 2.5-second default is reasonable; the missing lifecycle rules matter more than tuning that constant.