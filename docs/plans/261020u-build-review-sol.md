1. **Medium — Document-wide dialog checks trust untrusted article markup.** The checks in [ReturnChip.tsx](/var/tmp/spideryarn-worktrees/fbyjnpjg-backspace-build/src/web/ReturnChip.tsx:234) and [key-chord.ts](/var/tmp/spideryarn-worktrees/fbyjnpjg-backspace-build/src/web/key-chord.ts:74) match dialogs inside the article’s prose too. A direct sanitiser probe confirmed that both `<div role="dialog">` and `<dialog open>` survive sanitisation. Either would make Backspace permanently dead for that article while the chip shows; the native form already disables G and `/`. Scope “open dialog” to application surfaces outside `.prose`, and add a regression test for article-owned dialog markup.

2. **Low — The reporter’s Structure case works, but the focus description needs precision.** Structure’s sole focus target is the `<ol role="tree" tabindex="0">`; its `treeitem` rows deliberately cannot receive focus ([OutlinePanel.tsx](/var/tmp/spideryarn-worktrees/fbyjnpjg-backspace-build/src/web/OutlinePanel.tsx:604)). Enter/Space calls `jump` without moving focus, so Backspace arrives with focus on the tree and is accepted. Pointer activation has no explicit focus call ([OutlinePanel.tsx](/var/tmp/spideryarn-worktrees/fbyjnpjg-backspace-build/src/web/OutlinePanel.tsx:703)); native browser focus decides between the tree and page, both of which the rule permits. Describe and test “from the tree”, not “from a tree item”. A real-browser test should pin pointer focus; Chrome could not start in this sandbox.

3. **Low — The exclusion list should include ARIA text fields.** Native inputs and contenteditable elements are covered by `isTyping`, but a scripted `[role="textbox"]` or `[role="searchbox"]` can also own Backspace. Add both. Also, “any plain control” is slightly overstated because `isTyping` conservatively rejects every `<input>`, including checkbox/radio/button types.

4. **Low — The test list is incomplete.** Add:

   - every promised composite role: `grid`, `slider`, `spinbutton`, `menubar`, plus `textbox` and `searchbox`;
   - legacy IME composition via `keyCode: 229`;
   - assertions that refusal paths leave `defaultPrevented === false`;
   - real Structure activation, confirming Enter leaves focus on the tree before Backspace;
   - article-owned `[role="dialog"]` and `<dialog open>` do not suppress the shortcut.

5. **Info — The other front surfaces are accounted for.** The command bar is an open native `<dialog>`; the drawer, profile/search popovers, prose hover card, and interactive cards use `role="dialog"`. Menus put focus under `role="menu"`. Passive tooltip cards need not block a key because they contain no interaction. A covering band should deliberately remain allowed: the return chip is shown above it, and the shared `onReturn` first steps the band aside ([Reader.tsx](/var/tmp/spideryarn-worktrees/fbyjnpjg-backspace-build/src/web/reader/Reader.tsx:878)). No app-owned `role="dialog"` is always mounted while closed; the article-markup case in finding 1 is the exception.

6. **Info — Extracting `isPlainKey` is behavior-preserving.** Exact key matching remains exact, G still rejects Shift, `/` still permits it, and repeat, IME, `defaultPrevented`, typing, and native-dialog guards are unchanged. G’s stricter focus decision remains in `startingPoint`; `/` gains no new policy.

VERDICT: proceed with changes