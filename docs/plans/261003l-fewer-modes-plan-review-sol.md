The plan needs changes. The main omissions are a second queue regression, command aliases that can open the wrong view, and compatibility rewrites that must work after startup.

1. **F1 — P0, reasoned: a stale press context can leave a token for Back to spend.**  
   The plan adds `PressContext.summary` without specifying where its value comes from. Copying [Dock’s current pattern](/home/greg/code/spideryarn2/.claude/worktrees/fb-thpsnd-fewer-modes/src/web/Dock.tsx:1727)—parsing `location.search` during render—is unsafe during nuqs’s delayed URL update. [Reader explicitly documents that delay](/home/greg/code/spideryarn2/.claude/worktrees/fb-thpsnd-fewer-modes/src/web/reader/Reader.tsx:3433).

   Failure path: select Thread; React shows Thread while the address still says Brief; immediately choose the Summary command row. A context read from the old address arms `simple`, while the mounted Thread hook and boundary handle `tweets`. The `simple` token remains unclaimed. Back to Brief can then claim it and start a paid Summary job.

   **Change:** derive the press context from the same parsed React state selecting the band. Test a second press before the URL flush, assert neither target remains incorrectly armed, then navigate Back and assert no POST.

2. **F2 — P1, established: decision 7 preserves Tweets but drops ordinary summaries from imports.**  
   [modeStep()](/home/greg/code/spideryarn2/.claude/worktrees/fb-thpsnd-fewer-modes/src/web/activation.ts:367) returns `null` for every delegated row. Making Summary delegated therefore removes `simple` from `autoModes()`. Adding only `tweets` to `AUTO_EXTRA_STEPS` produces imports without the summaries they generate today.

   **Change:** preserve both `simple` and `tweets` in the import queue. Assert the complete existing request list, rather than only `toContain("tweets")`. Update `autoModesDetail()` too: its names come only from derived mode rows, so Summary would disappear from the explanation despite still being generated.

3. **F3 — P1, established: moving aliases to Summary does not make them select Thread.**  
   [commandText()](/home/greg/code/spideryarn2/.claude/worktrees/fb-thpsnd-fewer-modes/src/web/command-match.ts:244) gives sub-mode rows their label, parent name, and compound names. It does **not** inherit the parent’s catalog aliases. Adding `tweets`, `twitter`, `x`, and `social` to Summary therefore matches the **Summary mode row**. That row preserves the current `summary` choice; with the default choice, Enter opens Brief and can generate `simple`.

   Giving Thread a description containing “tweets” still leaves Summary’s alias match ahead of Thread’s description match.

   **Change:** specify aliases and precedence for the Thread destination. The acceptance test should assert that typing “tweets” and pressing Enter selects Thread and arms `tweets`; merely *offering* Thread is insufficient.

4. **F4 — P1, reasoned: a boot-only rewrite can strand public readers on Brief.**  
   The new query rewrite is described beside `liftLegacyTweets`, but the existing live-navigation helper invokes only the old **path** lift. [useRoute()](/home/greg/code/spideryarn2/.claude/worktrees/fb-thpsnd-fewer-modes/src/web/router.ts:1802) also subscribes to pathname changes, so Back/Forward between query entries on the same article does not rerun its rewrite effect.

   With `RETIRED_MODES.tweets = "summary"`, an old `?mode=tweets` history entry can consequently parse as Summary without acquiring `summary=thread`. A visitor whose public payload contains a thread but no plain-words summary sees Brief’s missing-summary state instead of the stored thread.

   **Change:** cover cold loads, client navigation, and same-path query history. Legacy path and mode spellings must override any carried `summary=brief|fuller`, remove duplicate selector pairs, and preserve unrelated state. Test with a public article containing **Tweets only**.

5. **F5 — P1, reasoned: paid re-run commands need their own alias migration.**  
   The plan misses [RERUN_MODE.tweets](/home/greg/code/spideryarn2/.claude/worktrees/fb-thpsnd-fewer-modes/src/web/rerun-commands.ts:102). Removing that binding loses old commands such as “rerun tweets.” Replacing it with `"summary"` is worse: `rerunNames()` borrows the parent’s label and aliases, making “rerun summary” force the **Tweets** step.

   **Change:** remove the top-level mode binding and preserve Thread’s own aliases explicitly, or derive them from its sub-mode vocabulary. Test that “rerun tweets” targets Tweets and that “rerun summary” does not silently force a thread.

6. **F6 — P1, established: decision 6 conflicts with the bar’s closing gesture.**  
   It says pressing the Summary bar button while `summary=thread` writes a missing thread. Today, pressing the already visible Summary button **closes** its band, and [useActivateMode()](/home/greg/code/spideryarn2/.claude/worktrees/fb-thpsnd-fewer-modes/src/web/Dock.tsx:1594) deliberately arms nothing for that gesture.

   **Change:** distinguish opening Summary from closing it. Preserve the close-without-arming guard. Test both cases; implementing the sentence literally would permit generation while the reader closes the band.

7. **F7 — P2, established: the argument against retaining arrival generation overstates the required machinery.**  
   The plan says retaining `useAutoRunOnArrival` requires a per-sub-mode `arrival` activation kind. Existing delegated activation already permits `null`, and Diagram demonstrates views whose hooks spend on arrival while their press target is `null`.

   A smaller alternative is feasible: keep Thread’s arrival hook; return `null` for Thread from Summary’s shared activation decision; retain `simple` for Brief/Fuller; mark Thread as generating in command disclosure; and exclude Summary/Thread from remembered restores. This needs a restore exception, but preserves Greg’s existing functionality request and avoids converting Thread’s generation lifecycle during a grouping trial. Compare that implementation before asserting that press-only has fewer parts.

Also include `FeaturesPage.tsx` and its mode-tagged Tweets tile in the retirement sweep. For sharing, preserve a presence-sensitive Thread inventory entry: changing Summary’s static sentence alone cannot distinguish stored from unbuilt threads while `POLICY.summary` remains `available`.

Keeping Simple generated is a reasonable reversible choice. Its additional consequence is that the hidden level still participates in the all-or-none result: its failure can prevent Brief and Fuller from being stored.

No files were changed. The single probe script failed on browser-only `import.meta.env` during imports, before its assertions; these findings rely on code inspection.

**Verdict: build with changes.**