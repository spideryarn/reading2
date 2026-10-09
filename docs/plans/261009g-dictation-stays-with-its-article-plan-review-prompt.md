# GPT Sol: plan review of 261009g (read-only)

You are reviewing a plan in the Spideryarn repo (cwd). Read-only: do not edit any file.

Read `docs/plans/261009g-dictation-stays-with-its-article-and-the-button-says-its-tricks.md` (the
plan), then `docs/project/dictation.md` § "Words go only where they were said" and § "A closed tab
does not lose a dictation", `src/web/dictation-keep.ts`, and the parts of `src/web/useDictation.ts`
that use `keep`/`keepBox`/`elsewhere`/recovery. The implementation is already drafted in the working
tree (`git diff HEAD` shows it; new tests are untracked under tests/ — `git status`).

Questions:

1. Is the root cause right? Is there any other path by which Greg's report (a failed dictation in
   the guide's "Why you're reading this one" box on article A, then Try again on a newly opened
   article B pasting A's words) could happen that the keeper rename does not close?
2. The trawl table: is any site's verdict wrong, or any dictation site missing? Check the users,
   tabs and server claims.
3. Does changing a keeper's name while a dictation is live (the command bar's slug, ChatDialog's
   draftTarget, a Conversation's thread id) now cause words to be refused (`[mic-moved]`) in a case
   a reader would consider the same box? Is that acceptable?
4. The dictation button's tooltip: anything false in its words (check MAX_MS, the cap warning,
   which boxes have onDone), or any interaction problem (touch, the disabled button, the
   aria-describedby merge, the double-press window)?
5. Anything simpler that does the same job.

Write findings as F1..Fn with severity (P0/P1/P2), file:line evidence, and a recommended change. End
with a one-line verdict.
