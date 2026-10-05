Code review of one stage, and you fix what you find inside it.

Candidate: commit cac2fbf9f on branch worktree-why-reading-feeds-the-bar (its parent is 82799379b).
`git show --stat cac2fbf9f` lists every changed path; `git diff 82799379b cac2fbf9f` is the diff.
Start with: src/command-suggest.ts, src/command-suggest-call.ts (`SUGGEST_SYSTEM`,
`suggestCommands`), the `/api/command-suggest/:slug` route and its handler in src/routes.ts,
src/web/command-suggest-client.ts, src/web/profile-saved.ts, src/web/CommandBar.tsx (everything
about suggestions), src/web/command-proposal.ts, src/web/command-runners.ts,
src/web/reader/Reader.tsx (`askThroughLens`), src/web/purpose.ts, src/web/useProfile.ts,
src/web/PrivacyPage.tsx, src/ai-call.ts, src/models.ts, src/cost-categories.ts, src/messages.ts,
the three new test files, evals/command-suggest/, and
docs/investigations/261005b-does-the-command-bar-suggest-useful-searches-from-why-you-are-reading.md.
That list does not limit scope.

What the stage is for: docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md,
§ B, "What changes about the profile's rules", "Stage 2", and its Log entry "stage 2 built", which
says where the build differs from the design and what was not verified. Your own plan review is
docs/plans/261005k-plan-review-sol.md: check that F1, F2, F3, F4, F5, F6 and F9 were each really
done, in code and in a test that would fail without it.

Three small things in this commit are someone else's and unreviewed, outside stage 2: in
src/web/ChatPanel.tsx and src/web/CandidatesPanel.tsx a held Enter is cancelled
(`isHeldSendEnter`), and tests/what-the-enter-key-promises.test.tsx gains one row.

Do an independent pass first. Read the call sites, not only the new functions. Look for: what a
reader sees go wrong (desktop, iPad, phone; keyboard and touch); anything that runs, spends or
sends without its own press; the profile, the reason or a suggestion reaching a log, an error
message, Sentry, a URL, a stored row or another reader; an owner check that can be got round;
state that outlives the reader it belongs to (sign-out, another article, another tab, a save
while the call is in the air); the extra profile read on mount and on every open (cost, races,
what an article with no reason does); a privacy page or doc sentence that the code does not make
true; the eval's write-up claiming more than its numbers show.

You may fix: defects inside this stage, narrowly, with a test you saw fail first where a test can
reach it. Report and do not fix: anything wider. Do not commit. Do not change the prompt's wording
without saying so plainly, because its eval numbers belong to the wording that was measured
(`command-suggest/2`); a prompt change is a finding for me to re-measure. You have no network and
no Postgres: tests/command-suggest-route.test.ts and anything else that needs a database are mine
to run, so say which you want run and what you expect. Tests that need nothing outside the tree
you should run yourself (tests/command-suggest.test.ts, tests/command-bar-suggest.test.tsx,
tests/command-bar-pick.test.tsx, tests/privacy-page.test.ts). When you edit a doc, never write
words as Greg's unless they are quoted exactly from the plan.

Then say whether each of these holds. They are my own suspicions and worth less than what you find:

1. The fingerprint is a 53-bit hash of the two stored boxes, computed on both sides. Can the two
   sides disagree (normalisation, trimming, null against empty), so a list never shows or never
   hides?
2. The implementer removed a client special case for `purposeFailed`: a failed read "reads as no
   reason and shows no row". Is F6 still met where the reader can see it?
3. A suggested mode key is resolved against the bar's own commands at draw time. Any way a key
   reaches `activate` that is not a `mode` or `submode` the reader has now?
4. The route's owner check, compared with sibling owner-only routes. A visitor on a shared
   article; a signed-out reader; another owner.
5. Three mutations survived the implementer's own check (the plan's Log names them). Is any of
   them a real hole?
6. The privacy page: is every sentence it gained true of this code, and is anything this code does
   with the profile missing from it?

Severity, by consequence: P0 data loss, security, wrong charging, service unusable; P1 user-visible
wrong behaviour or an authoritative contract violated; P2 design or maintainability risk with no
wrong behaviour today; P3 prose or comment defect. Number findings from CR5 (CR1 to CR4 were stage
1's); for each give the severity, whether you established it (ran or traced) or reasoned to it,
file:line, and whether you fixed it. List every file you changed.

End with one line: `VERDICT: land` / `VERDICT: land with my fixes` / `VERDICT: do not land`.
