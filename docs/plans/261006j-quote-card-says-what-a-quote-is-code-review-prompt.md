# Code review: the card on a quote in the prose says what a quote is

Repo: this worktree (TypeScript, ESM, React, vitest). Branch off `dev`.

## The candidate

Committed: commit `48b835bb5`. `git show 48b835bb5` is the whole of it. Changed paths:

- `src/web/ProseHoverCard.tsx` — `QUOTE_CARD_SAYS`, and the paragraph and Help link in `QuoteCard`
- `src/web/styles/prose-hover-card.css` — `.prose-card-quote-what`, `.prose-card-quote-help`
- `src/web/help/help-modes.tsx` — the Quotes entry's two list items about the card and the rows
- `tests/quote-hover-card.test.tsx` — three new cases
- `docs/project/quotes.md` — one bullet
- `docs/plans/261006j-the-card-on-a-quote-in-the-prose-says-what-a-quote-is.md` — the plan, as built
- `docs/plans/261006j-quote-card-says-what-a-quote-is-plan-review-{prompt,sol}.md` — your plan review

Start with `ProseHoverCard.tsx` § `QuoteCard` and the test. That is where to begin, not the limit of
scope.

## What it is meant to do

Greg (an admin) asked, from Citations mode: *"Add a tooltip for Quotes, so readers know what they
are (and any further information about them)"*. The card on a purple quote fill in the prose now
opens with one paragraph saying what a quote is and what the strength of the purple means, ending in
*More in Help →* to Help's section on Quotes. The plan says what was passed over and why, and lists
how each of your plan-review findings F1–F7 was disposed of (§ Reviews).

It must not: say anything false of any `Quote` that can reach the card, for an owner or a visitor;
break the card's existing behaviour (the 900ms wait, ‹ ›, *open Quotes*, pointer entry, a finger's
tap staying the paragraph's); or make Help say anything false.

## What you can run, and what you may change

You may edit this worktree. Fix what is inside this stage, narrowly and red-first (the test that
reproduces it before the fix), and leave anything wider as a finding for me to decide. Do not commit.
List every file you changed at the end.

You can run `npx vitest run tests/quote-hover-card.test.tsx`, `tests/help-page.test.tsx` and
`tests/doc-links.test.ts`, and `npm run typecheck`; none needs a database or the network. I ran all
four after the change and they pass (14, and 43 across the other two; typecheck clean). A real
browser check is running separately; you cannot do that part.

## Attack it

Independently, before you read my suspicions. For each finding give an ID continuing from the plan
review (so start at **F8**), a severity, whether it is established or reasoned, what shows it (an
input or mutation I can run), and the smallest fix.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Mutate the change (delete the paragraph, move it below the scores, drop `onClick={onClose}`, change
the `href`) and say whether the tests notice each.

End with one line: `VERDICT: ship` / `VERDICT: ship with the fixes I made` / `VERDICT: do not ship`
— refuse only on an established P0 or P1.

## Previous findings

F1–F7 and their dispositions are in the plan's § Reviews. Treat what was done about them as
unreviewed code.

## My own suspicions — read last, worth less

- Whether the rewritten Help sentences are each true (`rowScores`, `QuoteCard`), and read plainly.
- Whether `Link`'s plain-click navigation plus `onClose` can leave anything behind (the hover card's
  timers, focus).
- Whether "The stronger the purple, the higher it scored" over-claims next to *Not scored.*
