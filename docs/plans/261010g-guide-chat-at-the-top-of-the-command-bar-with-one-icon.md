# 261010g — The guide chat at the top of the command bar, with one icon

Owned by [plans.md](../project/plans.md). Overseer queue item `qi-dp2tphkd`; report `spya-q3pzyn`
(#537, SPIDERYARN-READING2-GJ), Greg's (`feedback-reporter.ts` exit 0). Session
`fbq3pzyn-guide-in-command-bar`. Follows
[261009i](261009i-the-guide-greets-in-chat-takes-live-and-a-bar-row.md), which gave the bar its
*Guide* row, and [261007j](261007j-the-guide-a-conversation-about-how-to-read-this.md), which gave
the guide its `Compass` and the bar its *Ask the guide: “…”* row.
**Status: built, GPT Sol on the plan; code review and a browser check next.**

## What Greg asked for

> Add a way to open the guide chat at the top of the command bar. Find a way to name and/or
> describe it that will be clear to new users, and make sure that we're using an icon for the guide
> chat applied everywhere.
>
> — Greg, 2026-10-09, `spya-q3pzyn`

And the second half of a later report, queued with the suggestions work (`qi-na7p6xy4`, session
`fbyf23zk-bar-suggestions-and-guide`, which is told to take this plan's commit if it has landed):

> I still want an easy way to get to the guide chat, somewhere near the top of the command bar.
>
> — Greg, 2026-10-10, `spya-xasbd3`

## What is there now

- **A *Guide* row** in the bar since 261009i, on the owner's reading view only (`executor.openGuide`).
  But it is appended after the modes and sub-modes (`besideTheModes`), so on an empty bar it is
  some twenty rows down — below the fold on a laptop, never seen on a phone.
- **Its name is one word, "Guide"**, which is also one of Help's aliases, and Help has its own
  *reader guides* (`HELP_GUIDE_PAGES`). A new reader has no way to tell from the row that it is a
  conversation.
- **The `Compass`** is the guide's glyph in two places: its pinned row above Chat's list, and its
  greeting. It is absent from the bar's two guide rows and from Chat's header when the guide is
  open, and [icons.md](../project/icons.md) does not record it.

## What we will do

1. **First on an empty bar.** When nothing is typed and the page can open the guide, the guide row
   is the first row — above *Suggest what to do here* and any suggestions — with the rule the bar
   already draws between groups beneath it. Being row zero, it is what a bare Enter opens; that is
   free (opening draws our greeting, nothing is sent), where row zero used to be *Suggest*, which
   is a paid call. Once the reader types, it ranks like any other row: pinning it while typing
   would put it above the row the reader is spelling out.
2. **Named "Guide chat"**, described *"Talk through how to read this piece: why you're reading it,
   where to start, which modes would help."* "Guide chat" is what Greg calls it in all three of his
   reports, and the word *chat* is the part a new reader lacks: it says pressing it opens a
   conversation, not a Help page. Aliases keep the old ones and add `guide`, `chat with the guide`,
   `help me read`. Inside Chat the row and the header stay "Guide" — the word *chat* is already the
   band's name there.
3. **The `Compass` everywhere the guide is named on screen**: the bar's *Guide chat* row and its
   *Ask the guide: “…”* row (the bar's only icons, which is the point: they are the only rows that
   go to the guide), Chat's header while the guide is open, as well as the two places that have it.
   One line in icons.md says `Compass` means the guide and lists where.

**Not here.** Greg filed this from the home page, where there is no article and so no guide: the
guide is one conversation per article, the owner's. A guide without an article is the bigger idea
deferred as `qi-263b6cpp`. The suggestions' cap, dismissal and collapse are `qi-na7p6xy4`'s.

## The simpler option passed over

Leave the row where it is and only rename it and give it an icon. Cheaper by one memo, but it does
not do the thing asked: "at the top of the command bar".

## Tests

- `tests/command-bar-guide-row.test.ts`: the label, and `guide` still ranks it above Help.
- `tests/command-bar-guide.test.tsx`: on an empty bar with `openGuide`, the first row is *Guide
  chat*, it wears the compass, and a bare Enter opens the guide and asks nothing; with a reason saved
  it is still above *Suggest*; typed, it is not pinned; without `openGuide` it is absent. Each
  written red first.

## After the plan review

GPT Sol ([review](261010g-plan-review-sol.md)): build, with changes. All six taken.

- **F1, a real bug the plan would have shipped**: when *Suggest* lands, the bar selected row zero
  meaning *the first suggestion* — which is now the guide chat, so Enter would have opened the guide
  instead. The selection is now found by kind (`previousReasonRows` in `CommandBar`); the test that
  says so was seen red without the fix.
- **F2**: the fast pick's catalogue is generated from the rows, so it is regenerated
  (`src/command-pick-catalogue.generated.json`), as is the Help corpus for the two Help pages.
- **F3**: the rule under the guide row is its own boundary, and the test checks it is the row's
  next sibling rather than that some rule exists somewhere.
- **F4**: *every mode before every other row* gains a test with the guide on, naming the guide
  chat as the one exception.
- **F5**: the argument parser's collision matrix now builds the guide row, so its new words are
  checked.
- **F6**: Chat's header compass has its assertion.
