# Plan review: quick search starts a thorough search in the background (261004l)

Read-only review of a plan, before anything is built. Change no file.

## The candidate

A live, uncommitted candidate in this worktree. Base `b5dbb5d06`. One untracked file:

- `docs/plans/261004l-quick-search-starts-a-thorough-search-in-the-background-and-swaps-it-in.md`

## What it is for

Greg, 2026-10-04: "The quick searches seem much worse than the thorough searches, so I wonder if
the best-of-all-worlds approach is to run a quick search immediately, and and also kick off a
thorough search in the background that will finish a few seconds later."

The brief: show the quick results at once, start the thorough (meaning) search for the same words,
and swap it in automatically when it finishes, with no refresh and no press. Swap only on success;
if it fails the quick row stays. Show quietly that a better answer is coming. Do not move the
reader's place. Take the smallest version.

## Read

- The plan.
- `src/web/modes/search/SearchMode.tsx` (`SearchBand`, `useTypingSession`, `onAsk`'s *thorough*
  branch), `src/web/useSearch.ts` (`ask`, `send`, `follow`, `remove`, `put`, `chosen`,
  `pendingColours`, `inFlight`), `src/web/quick-session.ts`, `src/web/SearchPanel.tsx` (`running`
  near line 348, the saved rows near 960–1160), `src/searches.ts` § `withRun`,
  `src/store/pg-searches.ts` (the trim in `begin`, `finish`).
- `docs/project/search.md` § Quick search, § Thorough replaces the quick row, § Search as you type.
- `docs/plans/261003i-quick-search-plan-review-sol.md` F1–F3: your predecessor's objections to a
  replace-on-success. The plan claims a browser-only, this-tab-only swap avoids needing them.

This list is where to start, not a limit.

## What to do

Attack the plan independently first. Is the design sound, is it the smallest version that does what
Greg asked, and what will break? For every finding give an ID (F1, F2, …), a severity, the evidence
(file and line), and the change you would make to the plan.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

End with a verdict: **build as written**, **build with the changes named**, or **do not build**,
and say what would have to be true for a refusal to lift.

## My own suspicions, last, and worth less than what you find

- Hiding the pending thorough row by filtering `runs` before `useSearchMode`: does anything else
  read the unfiltered list and disagree (the panel's `running`, `assignSlots`, `onToggleAll`,
  the "N searches" count, `?runs=` naming a hidden id)?
- The swap races: a revision of the quick row landing in the same tick as the thorough `done`; the
  reader deleting the quick row while thorough is out (`remove` on a row whose POST is still
  streaming); `begin` renaming the thorough row; StrictMode running an effect twice and asking or
  removing twice.
- `ask(words, "meaning", colour)` pins the colour with a PATCH at `begin`. If the thorough row is
  later dropped, is anything left behind?
- A typing session whose row is swapped while the box still has focus: the next edit starts a new
  quick row with the same words left in the box. Is that right?
- Is 2.5 s after the quick ask the right trigger, or should it be the quick answer landing?
- Does the opening GET, or a reload mid-search, leave anything worse than two rows?
- Is the cost statement honest? The `search` purpose in `ai_calls` may include chat's
  `search_article_meaning` tool calls.
