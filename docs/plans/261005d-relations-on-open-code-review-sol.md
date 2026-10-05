Static review of the uncommitted change, including the untracked relation tests. No tests,
typecheck, build, server or browser were run, as instructed. No commit was made.
`git diff HEAD --check` passed; that is only a whitespace check.

No functional defect found within the generation-on-show scope.

- All direct `useRelations` and `OwnerMarginFeed` callers supply the new arguments. The
  zero-argument feed mocks remain compatible. The delegated row matches `ModeActivation`;
  `armActivationForMode` skips its null target, `modeGenerates` stays true and `modeStep`
  returns null. The written and derived import lists both exclude relations.
- The first-open default supplies `margin=1`; Reader mounts the owner's feed and passes
  `marginRoom`, so generation needs no press. A narrow window supplies false, deferring the
  attempt until the notes fit. `OwnedArticle key={slug}` in ArticlePage remounts the entire
  owner subtree on article changes, preventing A's settled status from starting B's job.
- Both signed-out visitors and signed-in readers of somebody else's public article use
  VisitorArticle, which supplies no owner capability. They cannot mount OwnerMarginFeed.
  The public-network-trace path uses this same seam.
- `beginAutoAttempt` records synchronously before starting work, preventing duplicate attempts
  under StrictMode, visibility changes, remounts and job/POST failures. A failed artefact read
  gets one reread per mount; another failure starts no job. Stale/outdated answers use the same
  attempt guard. The server's unforced stamp check prevents paying again for a current result.
- Quiet `useStepJob` still starts through the job engine, whose action reconciliation follows
  the returned job. Completion calls `refresh`, including the first-poll-done reconciliation,
  so words arrive without reopening and a read already in flight cannot swallow the update.
- A first import cannot mount Reader against its unpublished draft: `loadArticle` reads the
  current published revision and requires blocks and a tree; minimal papers take the unread
  branch. Relations needs those article inputs, not the other modes' artefacts, so remaining
  mode jobs do not prevent it from running. No extra import gate is needed here.
- The named test suites contain no concrete newly failing assertion found by reading. Existing
  Marginalia POST expectations still hold because a press shows the column. Command-bar
  markers remain true, and first-open wiring tests exercise URL restoration alone.

I extended the new relation test file with failed-GET recovery and bounded retries, refused POST
and failed-job remounts, repeated visibility changes, outdated lists, and a press that leaves no
activation token. These additions were reviewed by reading, including a separate agent's review;
they have not been executed. Real Reader first-open integration remains verified only by tracing
the production wiring, not by a new executed integration test.

Findings:

- **F1 — P3 — Fixed.** `src/web/last-view.ts` still described every remembered parameter as
  inert on arrival; `src/web/activation.ts` described delegated rows as necessarily arming work
  and called null-only delegation invalid; `docs/project/marginalia.md` said the feed was not
  mounted on narrow windows. Updated these comments to match arrival generation and the shown
  gate. No runtime behavior changed in these fixes.
- **F2 — P3 — Not fixed; outside scope.** `docs/project/interface-vision.md:156` still says
  opening Marginalia spends nothing. `docs/project/mode.md` describes import generation as
  covering every main mode without the Marginalia exception. `src/web/useAutoRun.ts` still
  describes the arrival hook as having one caller. Press-only wording also remains in
  `tests/every-mode-draws-its-surface.test.tsx:1216`,
  `tests/a-second-press-closes-the-mode.test.tsx:440` and
  `tests/command-bar.test.tsx:583`. None of these tests becomes red from that wording, so I left
  these files untouched under the scope restriction. Help and Features contain no conflicting
  claim about when relation words are generated.
- **F3 — P3 — Not fixed; wider requirement decision.** A visitor currently sees no relation
  words even if stored: the public DTO excludes them, and Reader supplies null for visitor
  relations. This predates the patch and matches the owner-only policy in marginalia.md.
  If “a visitor ... sees whatever exists” is intended to include relation words, it needs a
  separate public projection/freshness change; this patch only preserves the no-POST seam.

Verdict: approve
