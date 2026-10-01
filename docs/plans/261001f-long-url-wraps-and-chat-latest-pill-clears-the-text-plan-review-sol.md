Verdict: **build with changes**. The prose fix is sound; the pill fix needs one additional dialog-layout rule and stronger tests.

## Findings

### High — the in-flow pill does not work as described in `ChatDialog`

`Conversation` returns `.chat-scroll`, the pill, and `.chat-composer` as sibling elements ([ChatPanel.tsx:1095](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/ChatPanel.tsx:1095)). This works in the mode band because `.mode-band` is a flex column ([mode-band.css:28](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/styles/mode-band.css:28)) and `.chat-scroll` is its flexible child ([mode-band.css:451](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/styles/mode-band.css:451)).

The dialog is different. `Conversation` is rendered inside `.chat-dialog-body` ([ChatDialog.tsx:690](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/ChatDialog.tsx:690), [ChatDialog.tsx:752](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/ChatDialog.tsx:752)), and that body is not a flex column; it is itself the scrolling block ([dialogs.css:409](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/styles/dialogs.css:409)).

Consequences:

- `.chat-scroll { flex: 1 }` is inert in the dialog.
- The outer `.chat-dialog-body` scrolls, while `onScroll` listens on the inner `.chat-scroll` ([ChatPanel.tsx:1097](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/ChatPanel.tsx:1097)). Therefore `away` generally cannot track dialog scrolling.
- An in-flow pill would belong to the outer scrolling content, rather than occupying a persistent row between a dedicated transcript scroller and composer.

Add a conversation-only dialog rule, for example:

```css
.chat-dialog-body:has(> .chat-scroll) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

The existing use of `:has(.chat-scroll)` for the dialog height ([dialogs.css:357](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/styles/dialogs.css:357)) makes this consistent with the current design. Draft dialogs remain ordinary scrolling blocks.

The pill should also explicitly be a non-shrinking centred flex item, and `bottom`, `left`, and `transform` must all be removed—not merely `position: absolute` ([chat-actions.css:165](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/styles/chat-actions.css:165)).

### Medium — the pill test can pass while the layout remains broken

[chat-latest-pill-in-flow.test.ts:25](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/tests/chat-latest-pill-in-flow.test.ts:25) only prohibits `absolute` and `fixed`. It would pass if:

- `left: 50%` and `transform: translateX(-50%)` remained, displacing the flex item;
- the pill used another overlapping positioning mechanism;
- `.chat-dialog-body` remained a non-flex outer scroller;
- the pill was not centred or was allowed to shrink.

Keep the test, but additionally assert:

- the positioning offsets and transform are gone;
- the pill has explicit centring/non-shrinking declarations;
- the conversation form of `.chat-dialog-body` is a flex column;
- `.chat-scroll` remains the overflow owner.

The browser pass should explicitly exercise both full chat and the fixed dialog. For each, verify that `.chat-scroll` itself has `scrollHeight > clientHeight`, that scrolling it produces the pill, and that pill/transcript/composer rectangles do not intersect.

### Medium — the prose test permits the value the plan deliberately rejected

Moving the declaration to `.prose` is safe. Runtime uses are limited to:

- article blocks: [TableView.tsx:1589](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/TableView.tsx:1589)
- enlarged article figures/tables: [Lightbox.tsx:145](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/Lightbox.tsx:145)
- two `/design` specimens: [DesignPage.tsx:519](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/DesignPage.tsx:519), [DesignPage.tsx:1110](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/DesignPage.tsx:1110)

`break-word` is the right value. The outer reading table’s fixed layout gives the prose a definite available width ([table.css:81](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/styles/table.css:81)), so the bare URL will break. Unlike `anywhere`, `break-word` does not add those emergency breaks to min-content sizing, preserving the intended horizontal scrolling of article tables described at [typography.md:126](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/docs/project/typography.md:126). `<pre>` remains protected by its non-wrapping whitespace behavior.

But [prose-long-words-wrap.test.ts:22](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/tests/prose-long-words-wrap.test.ts:22) accepts either `break-word` or `anywhere`. It should require exactly `break-word`. Prefer `readerCssNoComments()` as well.

Add one browser case containing:

- an unlinked, unbroken URL that must not widen the page;
- a long token inside an article data table that must leave the table horizontally scrollable.

### Low — pill insertion itself is stable, but unrelated height changes remain unobserved

The plan’s no-oscillation argument is correct for the mode-band/fixed-dialog flex layout:

- showing begins when distance is at least 60px; shrinking `clientHeight` only increases that distance;
- hiding begins below 60px; expanding `clientHeight` only decreases it;
- the message effect does not depend on `away` ([ChatPanel.tsx:1058](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/ChatPanel.tsx:1058)).

No `ResizeObserver` is required merely for adding/removing this row.

There is, however, a residual blind spot: the composer changes its own height in a child layout effect ([ChatPanel.tsx:1940](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/ChatPanel.tsx:1940)). That can shrink `.chat-scroll` without firing its `onScroll` or rerunning the message effect, temporarily leaving `stick`/`away` stale. I would not expand this focused patch into observer machinery unless the browser pass reproduces a visible problem, but the pass should include growing and shrinking the textarea while both pinned and away.

Both proposed tests genuinely run red before the change—I ran them—but they are structural smoke tests, not sufficient evidence of the geometry.