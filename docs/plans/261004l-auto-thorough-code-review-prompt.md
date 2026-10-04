# Code review: a settled quick search starts the thorough one and swaps it in (261004l)

Up: [the plan](261004l-quick-search-starts-a-thorough-search-in-the-background-and-swaps-it-in.md)

## The candidate

One commit in this worktree, `b896b0668`. Read `git show b896b0668`. Its paths:

- `src/web/modes/search/auto-thorough.ts` (new)
- `src/web/modes/search/SearchMode.tsx`, `src/web/useSearch.ts`, `src/web/SearchPanel.tsx`,
  `src/web/styles/search.css`, `src/web/help/help-modes.tsx`
- `tests/auto-thorough.test.ts`, `tests/search-auto-thorough.test.tsx` (new)
- `docs/project/search.md`

The plan is the commit before it, `14c6a0df5`, with your plan review
(`261004l-auto-thorough-plan-review-sol.md`) and what was taken from it in the plan's Log. F8 was
overruled in part; the reason is in the plan's § "What the earlier review said". This list is
where to start, not a limit.

## What it is for

Greg, 2026-10-04: "The quick searches seem much worse than the thorough searches, so I wonder if
the best-of-all-worlds approach is to run a quick search immediately, and and also kick off a
thorough search in the background that will finish a few seconds later."

A quick search shows at once; once its answer has settled, the thorough (meaning) search for the
same words starts unseen; on success it replaces the quick row with no press; on failure the quick
row stays. Browser only, this tab only.

## What to do

1. **Attack it independently first.** Does the code do what the plan promises, including each of
   your own F1–F7? What can a reader reach that is wrong? Is a thorough search ever paid for twice,
   or paid for and never shown when it should be? Can a row the reader can see be deleted wrongly,
   or a hidden row be left hidden for ever?
2. **Run the tests yourself**: `npx vitest run tests/auto-thorough.test.ts
   tests/search-auto-thorough.test.tsx tests/search-as-you-type.test.tsx` (jsdom, no network, no
   database). A finding you reproduced outranks one you reasoned to. Say which tests are weak:
   passing for a reason other than the behaviour they name.
3. **Check the docs against the code**: `docs/project/search.md` § "A quick search starts the
   thorough one by itself" and the sentences changed elsewhere in that file, and the `/help`
   sentence. And check the conclusion in the plan's cost section against its stated limits.

Every finding gets an ID (C1, C2, …), a severity, and the evidence (file and line).

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

## What you may change

You may edit files. **Fix what is inside this stage, narrowly, and red first** (a test that fails
before your fix). Stay in the files listed above. Do not add a server change, a migration or a new
dependency, and do not touch `src/web/CommandBar.tsx` or `src/web/command-*.ts`. Do not commit.
Anything wider you notice: report it, do not fix it. If a fix would need more machinery than the
defect is worth, say so and propose the smaller behaviour instead. Do not write any sentence
attributed to Greg; the only words of his are the quote above.

End with: what you changed (file by file), what you found and left, and a verdict: **land**,
**land after the fixes I made**, or **do not land**.

## My own suspicions, last, and worth less than what you find

- A → B → A in one typing session: the first A's answer is discarded and (row, A) is already
  "tried", so the row stays quick with its button. Is that acceptable, or is it a paid answer
  hidden for no reason?
- `submitted` words are remembered for the life of the mount, so words once Entered launch at once
  when typed again later by a pause.
- The swap runs in `useEffect`: one painted frame may show the finished thorough row still hidden.
  And `wired.swap` reads `panel.slots` from the last render.
- The swap's `recolour` PATCH pins a colour that was automatic, as the manual button does.
- `local` is `useState(newLocal)` mutated in effects and callbacks; under StrictMode's double
  effect the cleanup clears it and resets pairs. Is anything lost that should not be?
- `tests/search-auto-thorough.test.tsx` waits real settles; is any case order- or timing-dependent
  on a loaded machine?
