# Code review: the add page's purpose box saves as you type (plan 261004l)

Repo: this worktree, branch worktree-purpose-autosave. TypeScript, ESM, React under src/web, vitest.

## The candidate

Committed: the commit whose subject begins "261004l: the add page's purpose box saves as you type"
(the parent of the commit that added this prompt). `git show --stat HEAD~1` prints the complete list
of changed paths; `git show HEAD~1` the diff.

Start with: src/web/add-purpose.ts, src/web/AddPage.tsx, src/web/ProfileBox.tsx,
src/web/useAutosavedText.ts, tests/add-purpose.test.ts, tests/add-page-purpose.test.tsx. That is
where to begin, not the limit.

## What it is meant to do

The plan is docs/plans/261004l-the-add-page-purpose-box-saves-as-you-type.md; read it, including
"What this does not fix" and "Review record" (your two plan reviews are beside it). The guarantees,
at their true strength:

1. While the page is alive, the last text the reader left in the box is what articles.purpose ends
   as (null if cleared), across slow and overlapping PATCHes, a new address, a Retry that returns a
   different slug, StrictMode and unmount. During pagehide it is best effort (overruled F1; do not
   re-argue it).
2. Nothing is written to an article before its stored purpose has been read fresh, and a stored
   purpose the reader never saw is never erased or copied to another article.
3. The page opens the article by itself only when the box is not focused and nothing is unsaved; it
   never opens twice; it never opens over unsaved words unless the reader pressed Open without
   saving.
4. Every sentence on the page is true.
5. The shipped boxes (Metadata, the first-open prompt, the profile panel, /profile) behave as before
   except: the idle timer re-arms when a write lands, never re-arms on a refusal, and a refusal is
   shown only over the text it was about.

## What you can run, and what you may change

You may edit this worktree. Fix what is inside this stage, each finding red-first with the test that
reproduces it, and leave anything wider as a finding for me. Do not commit. Do not edit anything
under docs/ (if a doc sentence is wrong, say so as a finding with replacement wording). Never write
or alter a quotation attributed to a person, in a doc or a comment. List every file you changed at
the end.

You can run one test file at a time (npx vitest run tests/<one>, with --configLoader runner if the
default loader fails). No network, no Postgres. These pass on my side: tests/add-purpose.test.ts,
tests/add-page-purpose.test.tsx, tests/profile-box-autosave.test.tsx, tests/autosaved-text.test.tsx,
tests/purpose-prompt.test.tsx, tests/profile-panel.test.tsx, and npm run typecheck.

## Attack it

Independently first. For each finding: an ID numbered from F14 (F1 to F13 are the plan reviews'),
P0 to P3 by consequence (P0 data loss, security, wrong charging; P1 user-visible wrong behaviour or
a contract violated; P2 design risk; P3 prose), established or reasoned, (a) the input or mutation
that shows it, (b) the fix you made or propose.

One narrowly scoped check is owed: F9 (two sessions for one slug overlapping; old A in flight with B
behind, new session saves C) was fixed after your round-two snapshot, by `retire()`'s promise handed
to the next same-slug session through `retiringPurposes` in AddPage.tsx. Say plainly whether that
fix holds, including when the old session was retired by unmount and the new one made by a later
mount, and when three sessions for one slug follow each other quickly.

## My own suspicions, read last

- `purposeFor` runs during render and retires a session as a side effect of rendering; under
  StrictMode's double render or an abandoned concurrent render that may retire a session that is
  still on screen.
- `completed()` shortening the probe run, and `observe` versus `completed` ordering in two effects.
- The opening latch effect depends on `purposeNow`; a snapshot that does not change identity when
  nothing changed could leave it un-run, or one that changes every call could loop.
- `wanted()` treating a box of spaces as empty while `text` keeps the spaces.
- The useAutosavedText change (error only over the text it was about) against PurposePrompt's Done
  latch and ProfilePanel's close latch, which let go on `error`: can a latch now wait for ever after
  an older save is refused?
