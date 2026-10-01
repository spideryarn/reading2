# The mode bar regrouped: Glossary, Ideas and Timeline join Trajectory; Search joins Chat

A follow-on to [260929c](260929c-mode-bar-order-and-groups-experimental-switch-gutter-icons-diagram-behind-the-switch-reading-time-line-explained.md)
§ 1, which put the bar's modes into runs with a line between runs. Greg, admin, so trusted input —
[feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it).

> Move Glossary, Ideas, Timeline modes left into the bottom-bar separator-section with Trajectory. And
> move Search into section with Chat.
>
> — Greg, 2026-09-29 (SPIDERYARN-READING2-57, report `spya-g8a0s8`)

It also answers the question 260929c left open — whether "FAQ and Search a little further left" meant
past Glossary and Ideas. Search now leaves that run altogether.

## The order

Before (Hierarchy has since gone, [260929d](260929d-remove-hierarchy-mode-and-heading-numbers.md)):

```
Plain | Structure Summary Diagram | Trajectory Quotes FAQ Search | Glossary Ideas Timeline
      | Referee Citations Debate | Chat Remember
```

After:

```
Plain | Structure Summary Diagram | Trajectory Quotes FAQ Glossary Ideas Timeline
      | Referee Citations Debate | Search Chat Remember
```

- **Glossary · Ideas · Timeline move left into Trajectory's run**, in their own order, at the end
  of it, where Search was. "Left into" the run is read as joining it with the least movement. Their
  own run is gone, so there is one line fewer.
- **Search goes first in Chat's run.** Greg said "into section with Chat", not where in it; first
  keeps his earlier *"Move Chat right, just before Recall"* true.

With the switch off, a default reader sees
`Plain | Structure Summary | Trajectory Quotes Glossary Ideas | Search Chat`.

## The runs, renamed for what they now hold

`ModeGroup` in `src/web/Dock.tsx` — the names say what makes each one a run, so the next mode knows
which to join:

- `passages` + `dimensions` → **`guides`**: ways through the piece, each drawn from it along one
  line — its route, its quotes, questions it answers, its terms, its ideas, its dates.
- `talk` → **`input`**: modes that wait on the reader's own words — a word to find, a conversation,
  what they took from it. The category [mode.md](../project/mode.md) already names.

The first draft said `contents` and `ask`. GPT Sol: `contents` calls a model's reading literal
contents (FAQ's questions, Ideas' unstated assumptions, Trajectory's route are all generated), and
Search finds rather than asks. Taken.

`exit`, `shape` and `critical` are unchanged.

*Simpler option passed over:* keeping the old names and only moving rows. `dimensions` would then name
a run with nothing in it, and `talk` would hold Search, which is not talk — a wrong name is the
thing the next person adding a mode reads.

## Checks

- `tests/dock-mode-order.test.ts` holds the order and the runs by hand; rewritten to the new ones,
  including the switch-off bar and its lines.
- The row comments that describe a position are updated, so no comment still names the old runs.
- Browser pass at desktop and phone widths: with the switch on, five runs and four lines; with it
  off, four surviving runs and three lines (before Structure, Trajectory and Search).

## Reviews

- **Plan**, GPT Sol: [260929f-sol-plan-review.md](260929f-sol-plan-review.md). Placement confirmed;
  its one high finding (Search left in the wrong group by the rename) was already caught by the order
  test and fixed; the names, one stale comment and the browser expectation taken.
