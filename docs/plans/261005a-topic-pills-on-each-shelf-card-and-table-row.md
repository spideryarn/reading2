# Topic pills on each article on the shelf

Up: [plans.md](../project/plans.md) · the features are [library.md](../project/library.md) and
[shelf-terms.md](../project/shelf-terms.md)

**Status: built, 2026-10-05.** GPT Sol's plan review changed five things before it was built:
[§ What the plan review changed](#what-the-plan-review-changed). The sections above that one say
what was built.

> On the logged in home page, for each article show its topic-pills. If there's lots, then maybe
> only show the first three.
>
> — Greg, 2026-10-04, report `spya-mtajjy`

## What this is for

The signed-in shelf has a row of topics above it (*Neuroscience*, *Buddhism*, *Memory & Learning*),
each with a count. Choosing one narrows the shelf. But a card does not say which topics its article
is in. The only place that says so is the paper card on a link in the topics' *More detail* view.
Greg wants each article on the shelf to show its own topics.

**Signed-in shelf only.** The public shelf (`/read/public`, report `spya-mdp0em`) is waiting on Greg
and nothing here touches it, nor the *Include public* section of the signed-in shelf, whose articles
are other people's and are not in this reader's tree.

## What is already there

- The topics answer (`GET /api/library/terms`) already carries every topic's member slugs. Nothing
  new is asked of the server, and no model call is added.
- `ShelfTerms.tsx` already turns that answer into "every topic each article is in"
  (`topicsBySlug`), in the server's rank order with each topic's hue, for the paper card. It lives
  inside the component, so nothing outside the Topics row can reach it.
- A card and a table row already end their meta line with the reader's own tags (`ShelfTags`), as
  plain chips that are not pressable.

## What gets built

```
┌──────────────────────────────────────────────────────────────┐
│ Self-Improvising Memory                                      │
│ Michael Levin · 41 min · 9,812 words · [🏷 to-cite] [+ Tag]  │
│ ● Cognitive Science  ● › Memory & Self  ● › Memory & Learning  +2 │
│                                                              │
│ Memories are not stored and read back but re-made by …       │
└──────────────────────────────────────────────────────────────┘
```

1. **A line of topic pills on each card, and the same topics as running text under the byline line
   of each table row.** Each is the topic's hue dot and its label, in the model's face when a model
   named it, with the faint `›` when it is a finer topic. The same marks as the pills in the row
   above, smaller, with no count. In the table there is no border round each
   ([§ The browser check](#the-browser-check-and-what-it-changed)).
2. **Up to four are all shown. From five, the first three, then `+N`.** In the server's rank order,
   which is the order of the row above: broad subjects first, then by how many articles. `+N` is
   plain text; a screen reader hears *"and 2 more"*.
3. **Labels, not buttons.** On a card, pressing a pill or the `+N` opens the article: like a tag
   chip, it is part of the card's stretched link. In the table they are static labels; only the
   title is the row's link. See the question below.
4. **On its own line**, under the meta line, so pills arriving a moment after the cards do not
   re-wrap the line the tags and badges are on. An article in no topic has no line.
5. **Nothing while topics load, fail, or do not exist** (a shelf under eight works). No placeholder.

### How

- A new pure module `src/web/article-topics.ts`: `articleTopics(terms)` returns the hue stops and
  the per-slug topic lists. This is the `topicsBySlug` code moved out of `ShelfTerms.tsx`, plus a
  `finer` flag on each topic. `rowTopics(topics)` returns `{ shown, more }` using the one shelf-row
  cap.
- `Library.tsx` computes it once (a memo on the answer's `terms`) and hands it to `ShelfTerms` as a
  prop, so the O(topics³) colouring still runs once per answer and the row, the paper card and the
  cards cannot disagree about a hue.
- A new `src/web/ShelfRowTopics.tsx`: a React context holding each article's topics, default none,
  and the `ShelfRowTopics` component that reads it. `Library.tsx` provides it around the list.
  **A context, not the topics as a prop through `libraryColumns`**: the table's column definitions
  are memoised on `[shelf, now, archivedOn]`, and rebuilding them remounts every cell
  ([postmortem 260827e](../postmortems/260827e-shelf-render-loop.md)).
- **`ShelfCard` and `TitleCell` do not import it.** `ShelfEntry.tsx` and `library-columns.tsx` are
  shared with the lazy `/admin` and `/design` routes (`tests/eager-client-graph.test.ts`), so the
  card takes the pills as a `topics` slot, as it takes `readThis`, and `libraryColumns` takes the
  component as an argument. The component is one stable reference, so the columns are not rebuilt.

### The simpler option passed over

Put the topics only in the table's row card and the card's date-line tooltip. No layout change at
all. Passed over because Greg asked to *show* them, and a hover card is not on a phone.

### The fuller option passed over, and why it is a question

**Pills you can press to filter.** Pressing *Buddhism* on a card would choose that topic in the row
above, as if pressed there. Not built in this version because:

- the whole card is one link, and a small button inside it on a phone is easy to hit by mistake
  when you meant to open the article (the shelf's touch targets were reworked for this,
  [261002i](261002i-ipad-touch-targets-shelf-card-actions-on-the-bottom-row-bigger-close-crosses-a-visible-band-scrollbar.md));
- pressing it narrows the shelf, so the card you pressed moves under your finger;
- it needs a chosen state on every card's pill, and the tag chips beside them are not pressable.

None of that is hard, but it is behaviour Greg did not ask for, so it goes to him as a question.

## Costs, named

- **Every card with topics is at least one line taller** (about 24px), and long pills can wrap it
  onto further lines. The line arrives after the cards do, once the topics answer lands. **It can
  move more than once**: the hook shows a partial answer while articles are still being read, shows
  a new one when a re-think lands, and drops the old one when the archive is switched in or the
  shelf changes. Each of those can add, remove or re-wrap a card's line. Accepted for this version.
  Holding the pills back until the answer is settled would hide them for the minutes a re-think
  takes; a per-card placeholder would be a guess at which cards have topics.
  **Since 2026-10-05 the line's height is held**, blank, on every card while topics are expected:
  [261005h](261005h-five-small-ui-fixes-from-the-queue-search-copy-remember-chips-shelf-pills-shift-marginalia-yearless-date-shelf-facts-dot.md)
  § C.
- **A fresh arrival has no pills** until it is sorted in, which happens by itself.
- **On touch there is no way to read the topics behind `+N`** from the card. They are in the
  Topics row's *More detail* view.
- Pills are over every topic the server chose, as the paper card's are, so a card keeps its pills
  however the view is narrowed.

## Tests (red first)

- `articleTopics`: an article in four topics gets four, in rank order, each with the hue the row
  uses; `finer` is set from `granularity`; a phrase topic has no voice.
- `rowTopics`: four or fewer are all shown and `more` is 0; five give three and 2.
- Rendered, through `Library` with a stubbed terms answer (the harness in
  `tests/shelf-topics.test.tsx`): a card shows its article's first three of five and `+2`, and all
  of four; the table view shows the same; the pills land in cards and in table cells when the
  answer arrives after the rows; nothing on the line is pressable or focusable, and on a card
  nothing is lifted above the stretched link. Watched red (seven tests) before the wiring.
- Code review added the regression that a table row keeps its topics while its title is being
  renamed; watched red against the early return, then green after the fix.
- Controls that pass without the change, kept as regressions: no line for an article in no topic,
  none before the answer. The *Include public* section draws its own cards and its slugs are not in
  the answer, so it has no test of its own.
- Mutated at the end: capping at three, and reversing the order, each turned the suite red.
- `tests/eager-client-graph.test.ts` stays green.

## Docs

- `library.md § What a card says`: the topics line. `shelf-terms.md`: a short section, and
  `article-topics.ts` / `ShelfRowTopics.tsx` in its code table.
- `/help` § Your shelf: one sentence. Its Topics paragraph still describes the phrase topics of
  before 2026-10-03 (*"a model scores which make good topics"*); it is corrected to match
  shelf-terms.md in the same edit.

## Stages

One stage: the code, tests, docs and help; a browser check at desktop, iPad and phone widths in
cards and table; GPT Sol's code review; push to `dev`.

## What the plan review changed

`261005a-topic-pills-plan-review-sol.md`: *build with changes*, no P0, two P1. All five taken.

| Finding | What was done |
|---|---|
| F1 (P1): importing the pills from `ShelfEntry.tsx` and `library-columns.tsx` would pull the topic colours into the modules `/admin` and `/design` share | A `topics` slot on the card and a component argument to `libraryColumns`; the page hands them in. |
| F2 (P1): a `+N` lifted above the card's link for a hover card is a patch of the card that does nothing when pressed | No hover card. `+N` is plain text under the link, with *"and N more"* for a screen reader. |
| F3 (P2): the layout can shift more than once, not "once per load" | Accepted, and the cost above now says so. |
| F4 (P2): `+1` hides one label in about the room it would take | Up to four are shown; three and `+N` from five. |
| F5 (P2): three of the planned tests pass without the change; nothing tested a press on `+N` | The tests section above names the controls as controls; the browser check presses every part of the line. |

## GPT Sol's code review

`261005a-topic-pills-code-review-sol.md`, on commit `cfd0b3bdc`: *ship with the fixes I made*. No
P0. It confirmed all five plan-review findings were done, that the context value keeps its identity,
and that a late answer reaches the table's cells. It fixed, and I read and kept:

- **C1 (P1): the table's topics vanished while its title was being renamed**, because the cell
  returns early for the editor. They now stay under the editor; a test was watched red.
- C2–C5 (P3), wording: the docs implied a table pill opens the article (only a card's does, the
  table row has no stretched link); "one line taller" (pills can wrap); `/help` implied topics are
  always model-named (the phrase row is still the fallback); a `cap` parameter that does not exist.

## The browser check, and what it changed

A Sonnet subagent drove Playwright against a dev server in this worktree at 1440, 820 (touch) and
390 (touch), with the topics answer stubbed so one article had six topics, one five, one four, one
a single 40-character label and one none. Cards: no sideways scroll at any width; the counts, the
dots' colours against the row above and the `›` all right; pressing a pill and pressing `+3` each
opened the article, and `elementFromPoint` at both was the card's title link; the Tag button and
the action menu still opened. Screenshots: `261005a-shot-*.png`.

**It found the table ugly, and that was fixed.** The Article column is about 250px wide, so
bordered pills stacked one to a line: 74px of pills for a four-topic article. In the table the
topics are now running text, the dot and the label with no border, wrapping like the byline above
them (`plain` on `ShelfRowTopics`). This fix was made after the code review's snapshot; it is a
styling branch in one component, has its own assertion, and was re-shot in the browser.

GPT Sol looked at that change alone (`261005a-topic-pills-code-review-2-sol.md`, read-only): the
branch, the list semantics and the utilities hold; D1 (P2), the test scanned the whole subtree for
a border class, now checks the items' own classes; D2 (P3), a line of this plan still said "pills"
of the table, corrected. The re-shoot then showed a dot left at the end of one line with its label
on the next; each topic is now `inline-block`, so lines break between topics. That one class was
changed after Sol's second look and checked in the browser only.

Not exercised: the *Include public* section (the test account had no public articles to list). That
its cards carry no pills rests on the code: the section draws its own cards and never renders the
slot.

## Questions for Greg (nobody is in the chat; built the first option of each)

- **[Q-pressable]** Should pressing a pill on a card filter the shelf to that topic? Built: no, a
  label. The other option and its costs are above. My recommendation: leave them as labels until
  the lack is felt.
  **Decided: yes, low priority** — Greg, 2026-10-05: "ideally yes, unless it's a hassle. not a high
  priority". Queued.
- **[Q-more]** Should there be a way to see the topics behind `+N` from the card? Built: no; they
  are in the Topics row's *More detail* view. Options: a hover card on `+N` (a mouse only, and the
  `+N` then has to open the article when pressed, or it is a dead patch); or pressing `+N` unfolds
  the rest in place (works on a phone; makes `+N` a button inside the card's link). My
  recommendation: wait and see whether five or more topics on one article is common enough to
  matter.
  **Decided: wait** — Greg, 2026-10-05: "waiting is fine".
- **[Q-which-three]** Which three, when there are more? Built: the row's own order, broad first
  (*AI & Computing* before *Memory & Learning*). The other option is finest first, which says more
  about the one article and less about where it sits. My recommendation: broad first, because it
  matches the row above and the paper card.
  **Decided: broadest, as built** — Greg, 2026-10-05: "broadest".
