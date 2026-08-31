The core idea is good: a narrow gutter with a native block link and a persistent, interactive comment marker is worth building. I would not build the three-slot/custom-copy version as written.

## High severity

1. **The three-slot overflow is a real input bug, not a cosmetic overlap.**

A hovered one-line row exposes its third control below the row’s box. Moving the pointer downward can still hit that overflowing descendant, which keeps the first row in `:hover`; its `pointer-events: auto` control can then intercept the click intended for the next row. Which row wins can also depend on table painting order.

This will occur regularly: short paragraphs and headings are not rare. A screenshot cannot establish correct hit-testing.

Fix: do not fit three roughly 24px targets vertically into a roughly 39px row. The cleanest version has two slots: persistent comment state and the permalink. Remove or relocate the whole-block chat button. If all three must stay, use a deliberate horizontal hover/focus flyout or increase every row’s minimum height and accept the reading-rhythm cost. A packed stack does not solve the worst case; three targets still need the same height.

2. **A link whose ordinary activation copies is semantically dishonest and has a broken failure path.**

On left click or keyboard Enter, the proposed anchor prevents navigation and attempts a clipboard write. A screen reader announces a link, but activating it performs a button action. If `navigator.clipboard` is absent or `writeText` rejects, navigation has already been cancelled and the fallback is a changed `title`, which touch users and many screen readers will never receive.

Middle-click and modified clicks remain correct only if the current guards in [BlockRef.tsx](/home/greg/code/spideryarn2/src/web/BlockRef.tsx:81) are preserved. `preventDefault` must not run for non-primary, modified, already-prevented, or selection-ending clicks. An asynchronous rejection cannot restore a default action cancelled synchronously.

Fix: keep ordinary link behaviour. The browser already supplies “Copy Link Address”, dragging the link, the status bar, middle-click, and new-tab behaviour—and copies the resolved absolute URL even though the source `href` is a path. That satisfies “if copied, copy the URL” with no clipboard code.

If one-action copying is essential, it should be a real button with an action-oriented accessible name, while navigation remains a separate anchor. On failure, reveal a selected/read-only absolute URL; “right-click the link” is neither touch-safe nor adequate feedback.

3. **The tab-order parity claim is false.**

For an article with 300 blocks:

- Desktop today: 300 block-id links + 300 chat buttons = **600** table controls.
- Desktop after: 300 permalinks + 300 chat buttons + `C` comment buttons = **600 + C**.
- Narrow width today: `.block-id { display:none }`, so **300** chat buttons.
- Narrow width after: **600 + C**.

If every block is commented, the new total is 900. Opacity does not change this; all those controls remain focusable. The mobile increase is particularly large because deleting [the narrow-width `display:none`](/home/greg/code/spideryarn2/src/web/styles.css:8760) restores one link per block.

Fix: state the real count and make an explicit decision. Cutting the chat control from this gutter gives `300 + C`, which is materially better. Every icon-only control also needs an accessible name such as “Link to block spya-k3m9qt” and “Open 2 comments on block spya-k3m9qt”; the plan currently specifies neither.

4. **The browser verification plan cannot verify its most important mobile claim.**

A 390px iframe verifies width media queries, but it does not verify `(hover: none)`: the repository explicitly warns that the iframe retains the desktop pointer capabilities ([browser-testing.md](/home/greg/code/spideryarn2/docs/project/browser-testing.md:52)). The proposed screenshot would therefore look correct even if the permalink remained invisible on every touch device.

The plan also does not specify outcome checks for the overlap, tab count, modified clicks, clipboard rejection, or live announcements.

Fix: add a check matrix with observable results:

- Assert the old `.block-chat` rect no longer precedes/pushes down `.prose`.
- Count focusable gutter controls at desktop and narrow widths.
- Use `elementsFromPoint` and actual clicks at the row-overlap coordinates.
- Exercise keyboard activation, modified click, and middle-click.
- If custom copying survives, stub resolve, reject, and missing clipboard separately.
- Assert `matchMedia("(hover: none)").matches` before citing a touch result; use a touch-emulated browser context or a real device. Otherwise mark touch as unverified and retain a static CSS guard only.
- Break each relevant rule once and require the intended check to fail.

## Medium severity

5. **Grouping comments is cheap, but the plan needs the memo boundary stated precisely.**

An indexed grouping is `O(blocks + comments log comments)` if it reuses `orderComments`; that is negligible beside `renderedText`, `resolveMark`, and `annotateHtml`. It is fine inside `TableView`, memoized only on `[comments, blocks]`, or upstream beside App’s existing ordered-comments memo.

It must remain separate from `marksByBlock`, `openComment`, and `openChat`. Opening a dialog should not regroup comments.

However, the current expensive path already recomputes all comment/chat anchor resolution when `openComment` changes because it is a dependency of [marksByBlock](/home/greg/code/spideryarn2/src/web/TableView.tsx:352), which then invalidates [proseHtml](/home/greg/code/spideryarn2/src/web/TableView.tsx:422). If avoiding unrelated work is an actual goal, split resolved anchor geometry from the transient `open` decoration. Merely memoizing the new grouping does not fix that existing cost.

The orphan claim also needs narrowing: the gutter recovers a comment whose quote no longer resolves **only while its `blockId` still names a rendered block**. A comment whose whole block disappeared has no row beside which to draw a marker; [comment-nav.ts](/home/greg/code/spideryarn2/src/web/comment-nav.ts:24) explicitly preserves that case in the dialog list.

6. **The shared live region is the right count, but its proposed implementation is underspecified.**

Imperatively setting `textContent` through a ref is workable in React 19 if the node stays mounted. It is not the only way to avoid a table render: state inside a small extracted permalink/status component rerenders that leaf, not `TableView`.

One live region for the table is preferable to hundreds. But two rapid assignments may be coalesced by assistive technology; assigning the same “Link copied” string twice may produce no second DOM mutation at all. A first timer can also clear a newer message unless timers are tokened or cancelled.

If retained, use one mounted `role="status" aria-atomic="true"` region, include the block id in the message, and decide whether “latest result wins” is acceptable. Queue announcements only if every rapid copy must be spoken.

7. **`title` is defensible as a cheap native hint, but it is not the tooltip the project normally means.**

A native title is delayed, inconsistently exposed on keyboard focus, and absent on touch. The repository’s own tooltip component says this plainly ([Tooltip.tsx](/home/greg/code/spideryarn2/src/web/Tooltip.tsx:275)). Pointing to `.block-chat` as precedent repeats an existing compromise rather than proving it is good.

One Floating UI instance per block would be excessive. The middle path is one delegated tooltip layer for the table, anchored to the currently hovered or focused permalink. That is more code, so for a first version I would accept `title={id}` only if:

- it is called a native hover hint rather than full tooltip support;
- the anchor has an explicit accessible name containing the full id;
- keyboard focus reveals the icon even when the row is not hovered.

8. **The CSS diagnosis is correct, but several related comments and claims need correction.**

`.block-chat` has no positioning rule ([styles.css](/home/greg/code/spideryarn2/src/web/styles.css:7641)) and appears before the block-level `.prose` in [TableView.tsx](/home/greg/code/spideryarn2/src/web/TableView.tsx:878). It therefore creates an anonymous in-flow line above the prose while transparent. The precise “~19px” needs browser measurement because the button does not inherit font styling, but the structural diagnosis is right.

Other descriptions currently false are:

- The CSS warning that its invisible target could eat clicks meant for “the block id above it” ([styles.css](/home/greg/code/spideryarn2/src/web/styles.css:7652)).
- The claim that the chat button “already lives in the same gutter” ([styles.css](/home/greg/code/spideryarn2/src/web/styles.css:9235)).
- The JSX description that it sits “beside” and underneath the block id ([TableView.tsx](/home/greg/code/spideryarn2/src/web/TableView.tsx:879)).

After adding a comment marker, the comments stylesheet’s “no column, no gutter” statement also becomes false ([styles.css](/home/greg/code/spideryarn2/src/web/styles.css:1672)). The plan needs explicit documentation updates to `comments.md`, `block-ids.md`, the design overview, and these code comments.

## Things that are fine

- **No JavaScript layout number has to change.** `fitView` sizes the whole prose cell using `PROSE_MIN`; it does not subtract the cell’s padding. `position.ts` measures block/section geometry dynamically. The search-hit bar is painted at the cell’s own `x=0`, independently of padding. The only pinned shadow belongs to `.pin-left`; `.pin-right` is explicitly not pinned. So “clear the pinned column’s shadow” is not a valid reason for 2.1rem.

- Keep the 731px media query. Delete only its `.block-id` and duplicate `padding-left` declarations. That query also owns the wordmark and dock changes, and its value remains tied to `GIST_MIN + PROSE_MIN + SPINE_W`.

- “Hands 50px back on every screen” is slightly overstated. At narrow widths it widens the usable prose. On a wide cell where `.prose` already hits its maximum measure, it mostly moves the prose left.

- **`Bookmark` is the right glyph.** A flag suggests reporting; another message square conflicts with chat. A filled or otherwise unmistakably active bookmark is preferable to a neutral outline.

- **Keeping the current view state is consistent with the project’s URL contract.** `blockHref` deliberately carries mode, columns, and open UI state ([BlockRef.tsx](/home/greg/code/spideryarn2/src/web/BlockRef.tsx:45), [url-state.md](/home/greg/code/spideryarn2/docs/project/url-state.md:19)). Call it “link to this block in the current view” rather than implying a canonical clean permalink.

- The rejected additions are sensible. Search, glossary, footnotes, reading position, and generated ideas already have better homes.

## What I would cut

Ship two gutter affordances:

1. A normal permalink anchor, with native navigation/copy behaviour and the full block id in its accessible name/native hint.
2. A persistent bookmark button for comments, counted directly from comments and opening the first one in reading order.

Cut custom left-click copying, its tick/error states, the clipboard helper, and the live-region machinery. Cut or relocate the per-block chat button rather than forcing three controls into a space that cannot contain them. That is the version that satisfies Greg’s brief with fewer moving parts and no known hit-testing defect.