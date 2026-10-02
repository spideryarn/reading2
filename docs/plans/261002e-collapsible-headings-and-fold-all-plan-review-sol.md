No P0s. The feature is still modest, but the plan’s two central claims do not hold as written: some navigation requests bypass `scrollToBlock`, and several measurement consumers can select or expose zero-height rows.

1. **P1 — “Every jump reveals” is false because visibility guards can suppress the jump.**

   Every actual prose mover I found does eventually use `scrollToBlock`: internal links ([TableView.tsx:1368](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/TableView.tsx:1368)), URL restoration ([useReadingPosition.ts:55](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/reader/useReadingPosition.ts:55)), Spine ([Reader.tsx:2542](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/reader/Reader.tsx:2542)), Diagram ([Reader.tsx:2149](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/reader/Reader.tsx:2149)), Skim ([SkimMode.tsx:736](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/modes/skim/SkimMode.tsx:736)), comment traversal ([comment-jump.ts:113](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/comment-jump.ts:113)), and keynav ([keynav.ts:307](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/keynav.ts:307)). ReturnChip restores through `?at=` ([ReturnChip.tsx:12](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/ReturnChip.tsx:12)); router/jump-history only manage addresses and history. TermJump explicitly does not move the article ([TermJump.tsx:27](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/TermJump.tsx:27)); `flash.ts`’s `scrollIntoView` is for non-prose metadata/help elements ([flash.ts:124](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/flash.ts:124)).

   The leak is before those movers:

   - `nudgeTo` skips its jump when `isBlockOnScreen` returns true ([BlockNav.tsx:150](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/BlockNav.tsx:150)).
   - comments skip when `whereIsBlock` says `here` ([comment-jump.ts:86](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/comment-jump.ts:86)).
   - pasted `?note=` uses the same guard ([Reader.tsx:1512](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/reader/Reader.tsx:1512)).
   - both geometry helpers accept a zero-height row whose coincident top/bottom lies inside the viewport ([scroll.ts:1078](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/scroll.ts:1078), [scroll.ts:1127](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/scroll.ts:1127)).
   - a retained arrival anchor returns `true` even before geometry is checked ([scroll.ts:1081](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/scroll.ts:1081)).
   - `beginJump` can classify the hidden target as already there and only flash its hidden cell ([keynav.ts:319](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/keynav.ts:319), [flash.ts:108](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/flash.ts:108)).

   **Fix:** make all visibility semantics fold-aware: `isBlockOnScreen` and `isPassageOnScreen` return false for `isFolded(id)`; `whereIsBlock` returns `away`; `arrivalAnchor()` clears or ignores a folded target. Add regressions for occurrence chips, comments, pasted `?note=`, and a jump back to a formerly anchored block.

2. **P1 — “Every measurer keeps working unchanged” is false for section-position and origin measurement.**

   `activeSectionIndex` deliberately selects the last equal top ([position.ts:106](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/position.ts:106)). That chooses the next visible row only when the measured array actually contains one.

   Two consumers measure sparse arrays containing only AI Structure starts:

   - `?at=` tracks `sections.map(sectionStart)` ([useReadingPosition.ts:145](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/reader/useReadingPosition.ts:145)).
   - Structure’s live context does the same ([useColumnContext.ts:47](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/useColumnContext.ts:47)).

   If several hidden Structure starts share a top and the next visible authored heading is not itself a Structure start, the last equal item is hidden. `?at=` can therefore be written to a folded block; a later layout restore calls `scrollToBlock` and unexpectedly unfolds it. `useReadingPosition` also has no resize observer or fold subscription, so folding does not reliably trigger a fresh write.

   `measureRow` and `measureOrigin` use all rows ([keynav.ts:164](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/keynav.ts:164), [keynav.ts:239](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/keynav.ts:239)), but still fail for a folded final section, where no following visible row breaks the tie. A hidden retained arrival anchor is an additional direct failure.

   **Fix:** create a shared visible-row measurement that returns original row indices plus tops, and filter hidden section starts before calling `activeSectionIndex`. Subscribe the reading-position spy to fold changes. Never filter tops alone and then use the filtered index against `blocks`.

3. **P2 — the Spine does not merely draw folded material as a harmless sliver.**

   Spine records every row, including zero-height ones, and constructs zero-height bands from their shared edges ([Spine.tsx:180](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/Spine.tsx:180)). Those bands become interactive hit targets with a 4px minimum height ([Spine.tsx:1242](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/Spine.tsx:1242), [spine.css:234](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/styles/spine.css:234)). Multiple folded bands therefore overlap at one coordinate, making some targets inaccessible. Search hits on hidden rows similarly become 3px marks ([spine-marks.ts:144](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/spine-marks.ts:144), [spine.css:286](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/styles/spine.css:286)).

   The body ResizeObserver will remeasure promptly ([Spine.tsx:568](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/Spine.tsx:568)); freshness is not the problem.

   **Fix:** omit fully zero-height bands from `hits`, and omit search/read/origin marks whose row is folded or zero-height. Partially visible bands can retain their real remaining height.

4. **nit — the keynav filtering point is correct; `acrossDepth` and the chain remain sound.**

   Filtering at keypress is right because folding changes without rebuilding the memoized navigation plan ([keynav.ts:515](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/keynav.ts:515)). `←`/`→` through `acrossDepth` calls that same `step` function ([keynav.ts:491](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/keynav.ts:491)), and the chain stores original row indices, so filtering does not invalidate it.

   Diagram’s own step buttons use separate unfiltered `starts` ([DiagramPanel.tsx:1251](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/DiagramPanel.tsx:1251)); they will intentionally unfold their target. That is consistent with “explicit jump reveals,” but inconsistent if the product rule is that all sequential traversal skips folds.

   **Fix:** add tests for up, down, chained presses, `acrossDepth`, and end-of-article folding. Decide explicitly whether Diagram traversal skips or unfolds.

5. **P2 — the requested chord is best-effort, not reliably available.**

   `⌘⌥T` conflicts with the standard macOS “show/hide toolbar” command; Apple specifically documents it for Safari-created web apps, so Safari can consume it before the page sees it. Chrome and Firefox publish no default assignment for that chord, while Arc allows browser shortcuts to be remapped, so Arc conflicts are user-specific. [Apple](https://support.apple.com/en-ie/guide/safari/ibrw3ceda9e7/mac), [Chrome](https://support.google.com/chrome/answer/157179), [Firefox](https://support.mozilla.org/kb/Keyboard%20shortcuts), [Arc](https://resources.arc.net/hc/en-us/sections/16435226323607-Rev-Up).

   `Ctrl+Alt+T` is the Ubuntu global terminal shortcut, and Microsoft explicitly advises against `Ctrl+Alt` application shortcuts because they are AltGr on some layouts. [Ubuntu](https://documentation.ubuntu.com/desktop/en/26.04/how-to/change-the-default-terminal/), [Microsoft](https://learn.microsoft.com/en-us/windows/win32/uxguide/inter-keyboard).

   `e.code === "KeyT"` is the correct way to survive Option producing `†`, but it means the physical US-T position, not necessarily the key labelled T on another layout. The sibling helper is the right shape because `isModChord` intentionally rejects Alt ([key-chord.ts:36](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/key-chord.ts:36)).

   **Fix:** retain the requested chord only as an optional accelerator, backed by visible controls. Test Safari in a real browser and do not claim the chord works everywhere. If the tooltip promises platform-specific modifiers, make the helper require Meta on macOS and Ctrl elsewhere; the current `(metaKey || ctrlKey)` accepts both ([key-chord.ts:69](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/key-chord.ts:69)).

6. **P2 — “left of the gutter” is not sound in this layout.**

   The gutter is already the one reserved slot immediately left of prose, deliberately kept one slot wide for narrow screens ([gutter.css:42](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/styles/gutter.css:42), [gutter.css:75](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/styles/gutter.css:75)). Heading gutters are specially bottom-aligned and normally have room for one 24px target ([gutter.css:293](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/styles/gutter.css:293)). A second absolutely positioned slot to its left consumes space the layout has deliberately not reserved and risks the spine/safe-area edge on narrow windows.

   **Fix:** make disclosure the leading, always-visible item inside `BlockGutter` for foldable headings, with the existing overflow mechanism exposing the remaining controls. That uses the established touch, focus, target-size, narrow-window and positioning rules. It does require an explicit decision that disclosure outranks the existing note-state mark on heading rows.

7. **P2 — the facts line is the wrong home for fold-all.**

   Masthead defines itself as the home of constant article facts ([Masthead.tsx:10](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/Masthead.tsx:10)); folding is mutable view state. The same file emphasizes that the masthead scrolls away ([Masthead.tsx:20](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/Masthead.tsx:20)), so this is not a durable global control. The facts separator and wrapping rules are also explicitly written for sibling spans ([shell.css:369](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/styles/shell.css:369)).

   **Fix:** put fold-all in Dock overflow from the outset. For the smallest v1, omit a separate fold-all control: every heading already provides Alt-click and the shortcut. Greg’s request made the extra icon conditional on finding a natural place.

8. **P2 — the synchronous stylesheet works for one reader, but the store is globally unsafe.**

   SSR-free Vite is fine: `writeStyle` guards `document` ([fold.ts:149](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/fold.ts:149)). Article switches are reset in a layout effect before paint ([fold.ts:239](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/fold.ts:239)). jsdom is fine if every test clears the singleton.

   Two mounted TableViews are not fine. There is one global article/store/style element ([fold.ts:128](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/fold.ts:128)), and the selectors are unscoped across the entire document ([fold.ts:143](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/fold.ts:143)). The second mount replaces the first article; either unmount clears both; matching block IDs in both tables are hidden together.

   **Fix:** either enforce the one-prose-table invariant with a loud second-mount guard, or make the controller per Reader and scope rules to a unique table attribute. Do not silently support only the last mounted table.

9. **P2 — the performance rationale overstates the React alternative; the smallest sound design is narrower than this plan.**

   The rows are not individually memoized. Only the whole `TableView` is memoized ([TableView.tsx:718](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/TableView.tsx:718)); rows are an inline `blocks.map` and already rerender on internal hover state ([TableView.tsx:1451](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/TableView.tsx:1451)). The need for synchronous reveal is real, but “hundreds of memoized rows” is not evidence.

   **Fix:** the simplest sound v1 is:

   - retain cell hiding and a synchronous, table-scoped fold controller;
   - put the chevron in the existing gutter;
   - make visibility, anchors, reading-position and Spine explicitly fold-aware;
   - keep the chord best-effort;
   - omit the masthead control.

   A single static CSS rule plus synchronously managed `data-fold-hidden` attributes is another viable alternative to generating one global CSS rule per hidden ID, though it should be measured rather than assumed faster.

10. **nit — no security-map defence is touched.**

   This is client-only view state: no URL-derived path, fetch, auth, storage, model output, or article HTML is newly trusted. The draft also validates IDs before interpolating them into CSS ([fold.ts:138](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/fold.ts:138)), closing the only plausible CSS-injection edge.

   **Fix:** none. Keep the closed-format ID check and scoped selectors.

Overall: the idea remains below Greg’s “substantial complexity” threshold, but the plan should not proceed on the stated “two hooks and all measurers keep working” argument. The two P1 geometry/position fixes and a deliberate gutter/Dock placement decision belong in the plan first.