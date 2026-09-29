# A shorter Glossary header, and icons where the kind words were

Two admin suggestions from Greg, batched because they touch the same rows of the Glossary band
(overseer queue `qi-m2k852dt`; notes in `docs/user-feedback/260929_0043-…` and `260929_0045-…`).

> The Glossary stuff at the top takes up too much space (e.g. on a phone) - for example, remove
> "Finds the words in this article and explains the passage. Not added to the list" text. And maybe
> move the "N words" onto the `order` row somehow - actually maybe we already show the "of N" so we
> don't need it. Perhaps hide "written for you" as a tooltip on something or just an icon. And get
> rid of the "order" text at the beginning of it.
>
> — Greg, 2026-09-29, `[SPIDERYARN-READING2-4G]`

> In Glossary mode, we have a bunch of labels, e.g. `concept`, `work`. There don't seem to be many
> of them. And what is "work" anyway. Perhaps we can just get rid of these? Or at least replace them
> with icons with explanatory tooltips to reduce the amount of distracting text.
>
> — Greg, 2026-09-29, `[SPIDERYARN-READING2-4H]`

## What the top of the band is today, and what it becomes

```
TODAY (owner, prioritised, written with a profile)      AFTER
┌──────────────────────────────────────────┐            ┌──────────────────────────────────────────┐
│ 24 terms  (👤 written for you)           │ band-head  │ [Look up a term…        ] [Look up]       │
│ [Look up a term…        ] [Look up]      │            │ prioritised first use hardest central  👤 │
│ Finds the words in this article and      │ hint       │ threshold 0.30 · 8 of 24 ↺                │
│ explains the passage. Not added to …     │            │ ───────●──────────                        │
│ order prioritised first use hardest …    │ sort       │ 16 hidden below the threshold             │
│ threshold 0.30 · 8 of 24 ↺               │            │ Transformer 🕮 …                          │
│ ───────●──────────                       │            └──────────────────────────────────────────┘
│ 16 hidden below the threshold            │
│ Transformer  work …                      │
```

Row by row:

1. **The hint under the Look up box goes.** Its two facts move into the button's tooltip, which
   already says the first: *"Finds these words in the article and explains the passage they are in.
   Not added to the list. One model call."* A phone has no hover, so a phone reader loses the
   "not added" sentence; that is the trade Greg asked for, and the answer's own card still appears
   in place of a row, so its absence from the list is visible where it happens.
2. **The "order" word at the front of the sort row goes**, in Glossary and in Citations, which draws
   the same `.gloss-sort-label` in the same place. One look for one control; the group keeps its
   `aria-label` ("Order the terms by"), so a screen reader still hears what the buttons are.
3. **The "N terms" count goes, and the head row with it, whenever the sort row is drawn.** In
   *prioritised* the threshold row already says *8 of 24*, which is Greg's "we already show the of
   N". In the other three orders every term is on screen and there is no count; that is the one
   piece of information lost, and it is recoverable by scrolling. The head row is kept only in the
   cases where there is no sort row to carry the badge — fewer than two terms, fewer than two
   sorts on offer, and while the list is loading — so it still carries the count there.
4. **"written for you" becomes an icon.** `WrittenForYou` drops its words everywhere it is used
   (Glossary, Quotes, Ideas, Tweets, Settings), not just here: it is one component stating one fact,
   and two looks for it would be two things to learn. The icon is `UserRound` as now; *older
   profile* becomes `UserRoundPen` with the existing warmer `.changed` colour, so the two states
   stay distinguishable without words. It stays a button that opens the profile panel, and its
   `aria-label` is unchanged. **No hover tooltip**: `ProfilePanel` deliberately has none, because
   a tooltip on a button that opens a panel about the same thing is two explanations racing; the
   panel, one click away, is the explanation. In Glossary it sits at the right-hand end of the sort
   row.
5. **The kind words become icons with tooltips, and `concept` goes.** One small component,
   `GlossaryKindIcon`, used by the panel row and the prose hover card (which draws the same chip):

   | kind | icon | tooltip |
   |---|---|---|
   | person | `PersonStanding` | A person |
   | place | `MapPin` | A place |
   | organization | `Building2` | An organisation — a company, institution or group |
   | event | `CalendarDays` | An event — something that happened at a particular time |
   | work | `BookOpen` | A work — a book, paper, film, law or other named piece of work |
   | concept, term, other | none | — |

   **`concept` is dropped rather than drawn**, because the prompt never says how a concept differs
   from a term (`src/glossary.ts`, the OUTPUT block lists both and defines neither), so the chip
   was the model's coin toss presented as a fact. The remaining five each answer the question the
   chip existed for — *this is a person or a book, not vocabulary*. The icon is a `span` with
   `role="img"` and an `aria-label`, and a native `title` for the hover — the same mechanism the
   sort buttons beside it use.

## Changed by GPT Sol's plan review

The review (`--sandbox review`, 2026-09-29) had four findings, all checked and all taken:

1. **An icon-only badge in every mode loses *older profile*.** True: `UserRoundPen` and a colour
   are not a sentence, and the panel only described the profile as it is now. So the icon is
   **Glossary only** (`WrittenForYou`'s `compact` prop), the other modes keep their words, and the
   panel now opens with a sentence saying which of the two it is (`ProfilePanel`'s `note`) — in
   every mode, since it costs nothing where the words are also on the badge. Point 4 above is
   superseded by this.
2. **A badge inside the `role="group"` is announced as one of the orders.** So the sort row is an
   outer row holding the named group and, beside it, a trailing slot.
3. **The count is not "recoverable by scrolling"** — the rows are not numbered. So the count moves
   to the trailing slot too, in every order but *prioritised*, where the threshold row's *n of m*
   already says it. Point 3 above is superseded by this.
   **Measured in the browser, and it costs a line there:** outside *prioritised*, the count (and
   the badge with it) does not fit beside the four sort buttons at phone width, nor beside them
   plus the badge in the 410px desktop band, so the trailing slot wraps to a right-aligned second
   line (37px → 62px). Kept, because those orders have no threshold, slider or note rows at all,
   so the band is still shorter than it was; if Greg would rather have the line than the count,
   it is `order !== "prioritised" && count` in `GlossaryPanel` to delete.
4. **While loading, the head row is empty, not a count.** True; the wording in point 3 was wrong.
   Browser checks widened to the states listed below.

## What this does not do

- **No change to the data.** `kind` stays in the entry, the prompt, the export and the public DTO;
  only its drawing changes. So bringing a chip back is a one-line change.
- **Other modes' heads are untouched.** Quotes, Ideas and Timeline have their own count rows;
  Greg's report is about Glossary. If he wants the same there, it is the same move.
- **Citations keeps its head.** Only its "order" word goes.

## The simpler option passed over

Keep the head row and only remove the hint and the "order" word. It saves the hint's two lines
but leaves Greg's other three points undone, and the head row — a count and a badge — is the one
row whose content is otherwise said elsewhere. Moving the sort buttons *into* the head row was also
considered and rejected: `.band-head` does not wrap (`diagram-drift.css` says why), and four sort
buttons plus a count overflow the 18rem band.

## Checks

- `tests/mode-surface-changes-no-markup.test.tsx`'s Glossary literals change on purpose (no
  `.band-head` when the sort row is drawn).
- The two tests that read the badge's text in Quotes and Ideas stay as they are (those modes keep
  their words); `tests/glossary-compact-header.test.tsx` covers Glossary's icon, its label, the
  changed-state icon and the panel's sentence.
- A test that `concept`/`term`/`other` draw no kind icon and `work` draws one with its label.
- A test that the hint paragraph is gone and the button's title carries "Not added to the list".
- Browser: desktop and 375px phone — owner with a profile in prioritised and first-use orders,
  a visitor, a one-term list, and the kind icons' tooltips.
- `docs/project/glossary.md` (the "Not added to the list" sentence and the kind chip) and
  `docs/project/reader-profile.md` (the ASCII of the badge) updated to match.
