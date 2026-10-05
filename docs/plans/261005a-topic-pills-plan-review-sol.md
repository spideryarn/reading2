The plan is sound on data flow and React state, but needs changes before implementation.

### Findings

- **F1 — P1 — The planned imports violate the eager-client graph contract.**  
  The plan has both `ShelfCard` and `TitleCell` import `ShelfRowTopics` ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/docs/plans/261005a-topic-pills-on-each-shelf-card-and-table-row.md:67)). But `ShelfEntry.tsx` and `library-columns.tsx` are explicitly on the `/admin`/`/design` shared-module seam ([eager-client-graph.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/tests/eager-client-graph.test.ts:535), [same test](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/tests/eager-client-graph.test.ts:594)). Their new imports would pull `ShelfRowTopics`, `article-topics`, `ShelfTermChip`, and `topic-colour` into that seam, so the graph test will fail. `/admin` and `/design` do not render `ShelfCard`; they share its module closure.  
  Keep the context, but inject the rendering from `Library`: an optional `topics` slot on `ShelfCard`, following the existing `readThis` precedent, and an optional stable topic-renderer component/function passed to `libraryColumns`. That preserves stable columns without making shared modules import the shelf-only feature.

- **F2 — P1 — The proposed `+N` creates a dead patch in the stretched card link.**  
  Ordinary topic labels remain beneath the title link’s full-card pseudo-element and therefore open the article. The proposed `+N` is deliberately `relative`, lifting it above that link ([ShelfRowTopics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/src/web/ShelfRowTopics.tsx:77)), but it is neither a link nor a button and has no click action. Clicking or tapping it therefore does nothing. That contradicts the plan’s claim that labels remain part of the card link and repeats exactly the distinction documented for tags ([ShelfTags.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/src/web/ShelfTags.tsx:12)).  
  The simplest fix is to drop the `+N` hover card and leave the count inside the card link’s hit area. If the hover card is retained, the trigger needs real navigation semantics to the same article. Add a real-browser regression test that clicks/taps every visual pill area, including `+N`.

- **F3 — P2 — The layout can shift repeatedly, not “once per load.”**  
  The terms hook publishes partial answers and then asks again while `pending` or `refreshing` ([useShelfTerms.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/src/web/useShelfTerms.ts:145)). It also hides the old answer whenever the shelf or archive scope changes. Consequently topic lines may appear, disappear, gain membership, and re-wrap several times—especially during the phrase-to-model transition—not just once as claimed in the plan ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/docs/plans/261005a-topic-pills-on-each-shelf-card-and-table-row.md:94)).  
  Either reserve a row, defer per-card pills until the answer is settled, or explicitly accept and browser-test repeated partial/replacement answers. The current cost statement is inaccurate.

- **F4 — P2 — Special-case exactly four topics.**  
  For four topics, `+1` hides precisely one label on touch while consuming almost a pill’s worth of space. Greg said “if there’s lots, then maybe only show the first three”; four is not clearly “lots.” Show all four, and use `three + N` from five onward. This is a small rule and removes the least defensible overflow case.

- **F5 — P2 — The tests miss the highest-risk interaction and overstate “red first.”**  
  I ran the two positive integration cases against the current unintegrated code; both went red as desired, including the late-arriving table-cell case. That is good evidence against stale cells. But the “no topic,” “before the answer,” and “Include public” cases already pass without the feature; they are regression controls, not red-first tests. The planned `+N` test checks only `aria-label` and `tabIndex`, not whether the omitted names become the accessible description or whether clicking it still opens the card. Add the stretched-link browser test from F2 and explicitly run the eager-graph test after wiring imports.

### What holds

- **No new server data is needed for the owner’s shelf.** The terms response already carries every physical slug. Archived scope is active plus archived, and model topic projection expands one work’s membership back onto every in-view copy ([shelf-topic-sets.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/src/shelf-topic-sets.ts:193)). Thus archived articles and exact copies get the right lists.

- **Include public correctly gets no pills under the existing product contract.** Those cards are not in the signed-in reader’s owner-scoped topic tree. The plan should replace “in nobody’s tree” with “not in this reader’s tree”; another owner’s tree may exist and must not be exposed.

- **Context is safe for TanStack cells.** A context update reaches consumers even through memoised ancestors, and these cells are not themselves memoised. It does not change `columns`, `sorting`, or `data`, and `useSortedTable` already disables the page-index reset that closed the old render loop. The context approach is sound once it is injected across the shared-module boundary as in F1.

- **Hue computation remains once per terms answer** if `Library` memoises `articleTopics(terms.data?.terms ?? [])`, passes its hue map into `ShelfTerms`, and removes the old internal hue/topics projection.

- **The ordinary labels do not break interaction.** They stay under the stretched link; the card action row still sits above it, and its touch presentation is width-driven. In the table, the topics are siblings of the title trigger, so they do not enlarge or replace the title’s row card. Only `+N` is wrong.

### Product and accessibility calls

Labels rather than filter buttons are the right simplest version. Greg asked to show them, not explicitly to make them another set of filters. Static tag chips already establish that vocabulary. Keep them visibly quieter than the filter controls—smaller, no count, no pointer cursor, no hover treatment.

A screen reader currently encounters an article landmark, linked heading, metadata and tags, gist, bottom facts/details, then the action controls; opacity-hidden desktop actions remain in the accessibility tree. The new line adds a list named “Topics,” followed by each textual label; dots and `›` are correctly hidden. A focusable `+N` can be acceptable if focus reliably supplies the omitted names through `aria-describedby`, but the planned test does not prove that, and its pointer behavior is broken as described in F2.

Correcting `/help` belongs in this change. Its current Topics paragraph is already false—it still says phrases are picked and model-scored ([help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/src/web/help/help-topics.tsx:621))—and the help policy requires visible feature changes to update it in the same commit.

VERDICT: build with changes