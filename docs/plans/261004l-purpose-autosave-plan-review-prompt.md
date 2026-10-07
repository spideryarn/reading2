# Review: a plan to make the add page's "Why are you reading this?" box save as it is typed

Repo: this worktree, branch worktree-purpose-autosave. TypeScript, ESM, React client under src/web, vitest.

## The candidate

Live pre-commit: one untracked file, docs/plans/261004l-the-add-page-purpose-box-saves-as-you-type.md. Nothing is built. The tree is read-only for this review.

Start with: that plan; src/web/AddPage.tsx (the purpose draft near line 351, the completion effect near 613, saveAndOpen/openWithoutIt, PurposeBox and its status near 1090); src/web/useAutosavedText.ts; src/web/ProfileBox.tsx; src/web/purpose.ts; src/web/PurposePrompt.tsx (the Done latch the plan copies); src/web/add-high-power.ts (the slug-before-row precedent); src/routes.ts patchShelf and resolveProfileParts and the GET /api/reader handler; src/store/pg-shelf.ts patch and read; src/store/pg-revisions.ts near line 2528 (where publication reads the purpose); tests/add-page-purpose.test.tsx; tests/autosaved-text.test.tsx; docs/plans/261004h-post-import-modes-decided-on-the-server-for-every-import-path.md section "The purpose box". This is where to begin, not the limit.

## What it is meant to do

Greg chose option B of 261004h's purpose question: "B with a small debounce of some kind". The box saves as the reader types, debounced, as soon as the article row exists; before that the text is held and saved the moment the row exists; an older text must never land after a newer one; flush on blur and on leaving the page; clearing the box clears the purpose rather than leaving a stale one, without ever erasing a stored purpose the reader could not see; the page's sentences stay honest about what the first modes used. Out of scope: option C (mode jobs reading the purpose when they start), dictation on the add page.

## Attack it

Independently, before you read my suspicions. The invariants to break:

1. The text in articles.purpose after the reader stops is the last text they typed (or null if they cleared it), on every path: slow PATCH, overlapping saves, address change, Retry, StrictMode, unmount by navigation, pagehide.
2. A stored purpose is never erased or replaced by something the reader did not type and could not see.
3. The page never navigates away over words that are neither saved nor explicitly abandoned, and never navigates twice.
4. The probe (GET /api/reader?slug= until purposeFailed is false) cannot report "exists" for the wrong article or for no article, and cannot loop for ever.
5. Every sentence the plan puts on the page is true.

For each finding give an ID (F1, F2, ...), a severity (P0 data loss, security, wrong charging; P1 user-visible wrong behaviour or a contract violated; P2 design or maintainability risk; P3 prose), whether it is established (a reachable source path or an observed run) or reasoned, (a) the concrete scenario the plan does not handle or the contract it contradicts, with file:line, and (b) the smallest change to the plan that closes it, as replacement wording. Also say if something simpler would do the same job, and whether lifting useIdleCommit / useUnsavedWarning / SaveStatus out of ProfileBox is the right reuse or whether the page should use ProfileBox whole.

End with one line: BUILD / BUILD WITH CHANGES / DO NOT BUILD. Refuse only on an established P0 or P1.

You can run one test file (npx vitest run tests/<one>.test.tsx). You have no network and no Postgres.

## My own suspicions, read last

- Showing a stored purpose in the box on a re-add is a visible change nobody asked for; is it the least surprising way to make clearing safe?
- seed() then setDraft(typed) then commit() in one tick: does useAutosavedText handle that, given seed resets inFlight and epoch?
- job.slug for a job that later adopts another slug, or a slug shared with a different owner's article: can the probe or a PATCH reach a row that is not this add's?
- The completion effect reads hook state through refs; a save that lands in the same tick as completion.
- GET /api/reader?slug= also runs readProfile, readExperimental and readAutoModes each second; acceptable for a second or two?

Do not change any file.
