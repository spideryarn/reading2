Review the plan docs/plans/261001f-long-url-wraps-and-chat-latest-pill-clears-the-text.md (read-only review; do not edit).

Two small CSS display bugs in the Spideryarn reading view. Read the plan, then the code it names:
- src/web/styles/prose.css (the `.prose a { overflow-wrap: break-word; }` rule near line 710) and docs/project/typography.md § Content that cannot reflow
- src/web/ChatPanel.tsx `Conversation` (around lines 1030-1160: the stick/away logic, the .chat-scroll onScroll, and the .chat-to-bottom button), the Composer (~line 2030), src/web/ChatDialog.tsx (which reuses Conversation in a fixed dialog)
- src/web/styles/chat-actions.css `.chat-to-bottom`, src/web/styles/mode-band.css `.chat-scroll` and `.chat-composer`, src/web/styles/dialogs.css `.chat-dialog`
- tests/helpers/stylesheets.ts (readerCss) and tests/diagram-css.test.ts for the CSS-parsing test style.

Questions:
1. Is moving overflow-wrap: break-word to `.prose` safe everywhere `.prose` is used (search all uses of the class), and is break-word the right value vs anywhere given the reading view is a table-layout: fixed table?
2. For the pill: does putting `.chat-to-bottom` in normal flow between the scroller and the composer actually work in BOTH containers (the mode band and the chat dialog) — are they flex columns, will it get its own row, will the 60px threshold logic oscillate or misbehave when clientHeight shrinks/grows by the pill's height (consider the effect that sets scrollTop when stick is true, and the ResizeObserver-less onScroll path)? Is there a better minimal fix I passed over?
3. Are the two proposed tests meaningful (red before, green after) or too weak; what would you add?
Give findings ranked by severity, each with file:line evidence, and a verdict: build as planned / build with changes / rethink.
