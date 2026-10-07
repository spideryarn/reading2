# Code review (read-only): the read-type spike, and which half of it to keep

Read-only. Do not change any file; your reply is the review.

**What this is.** A spike, in this worktree (branch `worktree-sweep7-read-type-spike`), of one
discriminated type for "a read" on one hook, `useIdeas`. The plan, its review, and the builder's
findings are one file: `docs/plans/261006n-one-type-for-a-read-spiked-on-useideas.md` (read § What
the plan review changed, which you wrote, and § What the spike found, which the builder wrote).

**The commits:**

- `f36f463c7` — stage 1: characterisation tests against the code as it was
  (`tests/ideas-read-states.test.tsx`, and three cases in `tests/skim-panel.test.tsx`). No source
  change.
- `751cab265` — **2a, the smaller change**: one `IdeasAnswer | null` object inside `useIdeasRead`
  holding the list and its four flags; `status`, `error` and the hook's returned interface
  unchanged. One file.
- `781589b13` — **2b, the full union on top**: `src/web/read-state.ts` (`Read<A>`, `landed`,
  `failedRead`, `retrying`, `statusOf`, plus `answerOf` and `failureOf` which the plan did not
  list), one `useState<Read<IdeasAnswer>>`, five consumers moved, ten existing test files edited
  through a new `tests/helpers/ideas-read-fields.ts`.
- `153c5035a` — the write-up. (`c0f65abdb` and `cc67ee267` are merges of `origin/dev`.)

Compare with `git diff f36f463c7 751cab265 -- src` (2a) and `git diff 751cab265 781589b13 -- src`
(2b), and read `src/web/useIdeas.ts` and `src/web/IdeasPanel.tsx` at each of the three commits
(`git show <sha>:src/web/useIdeas.ts`).

**The builder recommends landing stage 1 and 2a, and NOT 2b.** Its evidence: compiled against both
interfaces, the wrong consumer code behind postmortems 261004c (an empty state drawn while a failed
re-read is never looked at) and 261006g (a child handed only "list or null") compiles under 2b as
well as under 2a; 2b refuses only contradictory states and un-narrowed reads; the hook is clearer
under 2b but the panel is not (its cognitive complexity went over the lint limit, 27 against 25);
one hook cost ten test-file edits; and on paper `useQuotes` fits, `useGlossary` fits with caveats
and `useSketch` does not. Its own strongest counter-argument: all seven postmortems were written in
the hook, 2b's hook has three named writers and cannot store an impossible combination, and the
spike measured 2b at its most expensive (the first hook pays for the shared module, and the test
adapters exist only while both forms coexist).

**Whose decision.** The product owner approved "a one-hook spike first, then decide". The decision
of what to land from the spike is the orchestrator's (Claude's); rolling the type out further would
go back to the owner as a recommendation. Do not attribute anything else to him.

**What I need from you.**

1. **Judge the recommendation.** Read both versions of the hook and the panel yourself. Which would
   you rather maintain, and which would have made each of the seven postmortems (261004c, 261004f,
   261005q, 261005r, 261006b, 261006g, 261005i) less likely in practice, not in principle? Is the
   builder's tsc evidence a fair test of 2b, or did it pick consumers written to defeat it (for
   example by reaching for `answerOf`, a helper the builder itself added)? Would 2b WITHOUT
   `answerOf` and `failureOf`, forcing consumers to narrow, have refused cases A and B — and is
   that version buildable without making `IdeasPanel` worse? Say plainly: land 1 + 2a; land all
   three; or land 1 only.
2. **Review stage 1 as tests.** For each characterisation case: could it pass against a plausible
   wrong implementation? The builder ran 48 one-line breaks and 47 went red; the survivor is
   removing the first `current()` check after `apiFetch` (the second check catches what it would).
   Is that first check then dead code, or does it guard something no test reaches (a state set
   between the two awaits)?
3. **Review 2a as code.** One object replaces five `useState`s. Find a sequence (open, 404,
   failure, Try again, a job finishing, a slug change, a late reply, an offline copy) where 2a
   draws something different from the code before it. Check the things the plan review pinned:
   functional updates, `load`'s identity unchanged (it is what `useOrderedRead` keys on), every
   `current()` check still in place, all `FreshReads` bookkeeping untouched.
4. **Two things the builder found and did not fix** (out of its scope): `useSketch`'s empty-scenes
   branch and `useIllustrated`'s second "none" branch each leave the four flags from the previous
   answer standing. Confirm or refute each from the code, and say whether 2a's answer-object shape
   is the right fix for those two hooks and how big it is.
5. If your answer to 1 is "land 1 + 2a", landing needs one line from 2b (a `fresh` field on a posed
   Quotes read in `tests/ideas-read-states.test.tsx`, because another cluster added it to
   `QuotesRead`) and, the builder suggests, the footer test 2b added (a `!stale` gate no test
   covered). Anything else from 2b worth carrying without the union?

You may run `npx vitest run tests/<file>` (jsdom; nothing outside the tree) and
`node --import tsx <script>`; the working tree is at 2b, so tests run against 2b. No `npm test`.

**Reply format.** First the verdict on question 1, in one paragraph. Then findings R1, R2, … with
severity P1 (would ship a reader-visible regression) / P2 (should change before landing) / P3
(note); the input or code path; the smallest change. End with the exact list of commits or files
you would land.
