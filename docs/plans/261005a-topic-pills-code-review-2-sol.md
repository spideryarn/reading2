D1 — P2 — The border assertion is brittle. [`outerHTML.not.toContain("tw:border")`](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/tests/shelf-topics.test.tsx:969) scans the entire subtree, so an unrelated future bordered descendant would fail it, while a border introduced through ordinary CSS would pass. Check the direct topic `<li>` classes for the pill-specific classes instead. The preceding `data-row-topics-plain` assertion is sound and, together with the current border assertion, definitely fails without `plain`: the old table output lacks the attribute and contains `tw:border`.

D2 — P3 — The plan’s original specification still says there is “[a line of topic pills … under … each table row](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/docs/plans/261005a-topic-pills-on-each-shelf-card-and-table-row.md:48).” That now contradicts its later browser-check section, which correctly says the table uses running text. The project doc’s new bullet is accurate.

Everything else checked out:

- `plain` is passed only by [`TitleCell`](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/src/web/library-columns.tsx:352); the card’s default branch retains its original pill classes.
- The `<ul>` still contains only `<li>` elements. Making those items inline does not remove their HTML list semantics. Its accessible content remains the topic labels followed by “and 2 more”; dots, `›`, and visual `+2` are correctly hidden. The existing `list-none` Safari/VoiceOver caveat predates `plain`.
- Tailwind 4.3.3 generated real rules for all three utilities: `overflow-wrap:anywhere`, `vertical-align:middle`, and `margin-right: calc(var(--tw-spacing) * 2.5)`.
- The requested tests passed: 58/58. The repository’s Tailwind resolution test also passed: 4/4.

VERDICT: ship with changes