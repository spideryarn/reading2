# Review: the Feedback UI half — button, dialog, diagnostics collector, screenshot paste

You reviewed this feature twice already, both times in `/home/greg/code/spideryarn2`:

- `docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry-review-sol.md` — the plan, before
  it was built. You said don't build it yet, and named three things to fix first.
- `docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry-code-review-sol.md` — the server
  half. You returned **NO-SHIP** with five blockers. All five are now fixed and committed
  (`c77a976`, `1d4bd8a`); the plan's § "Stage: what the second review sent back" records each fix.

**This review is the client half**, which neither of those covered: the corner button, the modal
dialog, the diagnostics collector that fills the tick-box's promise, and the screenshot paste. The
server, the table, the store, the Sentry mirror and the envelope guard are **out of scope** — they
are committed and reviewed. Read them if they help you judge the client, but do not re-review them.

The evidence is at `/tmp/claude-1000/-home-greg-code-spideryarn2/957af82b-ad3b-4ddc-9072-f0b76f6da46d/scratchpad/ui-diff.txt`: every new file whole, and a `git diff HEAD` for
the modified ones.

**Two of those diffs contain other agents' work.** This tree has ~25 concurrent sessions.
`src/web/App.tsx` and `src/web/styles.css` both carry hunks that are nothing to do with this
feature — a `toc`→`hierarchy` rename, a `review`→`remember` rename, quiz work. In `App.tsx` the
feature's hunks are the `User`/`FeedbackButton`/`Route` imports, the `SignedIn` split around the
`if (!user)` gate, and a `setFeedbackArticleContext` effect inside `Reader`. In `styles.css` they
are the `--feedback-w` token, the two `padding-right` additions beside the existing
`padding-left` lines, the narrow-window overrides, and the `fb-*` block at the end of the file.
Ignore everything else in those two diffs.

## What I want you to attack

**1. The egress boundary, again, from the client side.** This is where the last two reviews both
found real leaks, and the client is the half neither has looked at. `src/feedback-payload.ts` on the
server rebuilds the diagnostics blob from an allowlist, so the question is not only "does the
collector send something bad" but "does it send something the server will *silently drop*" — a
value in the wrong shape vanishes with no error, which is indistinguishable from a value that was
never collected. Specifically:

- Can article prose, reader-typed search text, a URL with a query string, or a provider's response
  body reach `collectFeedbackDiagnostics()`'s output through *any* field? The collector shape-checks
  the article context with the app's real predicates; is that sufficient, and is anything checked in
  only one of the two places?
- `src/web/log-buffer.ts` is the source for `api` and `errors`. Its `vercelId` came off a response
  header rather than out of our own code. Is the shape check in the right place?
- The uncaught-error listener records `Error.name`. `Error.name` is writable. Is `nameOfThrown()`
  actually closed, including for a cross-origin `event.error` of `null`, a getter that throws, and a
  thrown non-object?

**2. The screenshot path.** `src/web/feedback-screenshot.ts` re-encodes through a `<canvas>` before
sending. Does that actually guarantee what it claims — that nothing from the original file's
metadata, EXIF, or appended bytes survives? Are the size and dimension caps enforced where they
have to be? The server refuses JPEG deliberately (`src/feedback-image.ts` argues why); does the
client's behaviour make sense given that, or does it produce a refusal a reader cannot act on?

**3. The dialog's failure modes.** The report id is minted per *opening* rather than per click, so
that a retry after a failed send is idempotent at the server. Is that actually achieved, including
across the dialog being closed and reopened, and across a 429? Is there any path where the reader
loses text they typed? A failed submit is the one moment where the app holds the only copy of
something a person wrote.

**4. The claims the tests make.** I mutation-tested three of them and each produced exactly one
red test (removing the synchronous `sending` ref latch; minting the id per render; collecting
diagnostics regardless of consent). **Tell me which claims in these test files are still untested or
overclaimed** — that is what your last two reviews were most valuable for. In particular:
`tests/feedback-button-visibility.test.tsx` asserts a *positional* rule by mounting the real `App`;
is its control adequate, or would it pass for the wrong reason?

**5. The layout reservation.** `FeedbackButton.tsx`'s header argues that the right-hand expression
is simpler than the mirrored left-hand one (`--logo-w`) because nothing insets the bars from the
right but `--safe-right`. Check that argument against the actual CSS — `.masthead`, `.bar`, and the
`@media (max-width: 731px)` overrides. The left-hand version got this wrong once already and put a
wordmark on top of an article title; the story is in `HomeLogo.tsx`'s header and in the CSS comments
at that media query. Note the deliberate decision that the space is reserved **whether or not the
button is rendered** — is the cost of that correctly described?

## Known and deliberate, so don't spend the review on them

- `job` and `revisionId` in the diagnostics ship as `null`. Both deferrals are recorded in the plan
  with reasons; `revisionId` needs a server change and is genuinely out of scope.
- `safeDiagnosticError()` from your first review was **not** built. The v1 wire shape has no field
  for a message or a frame, so it would have had nothing to decide and no caller. Say if you think
  that reasoning is wrong.
- There is no one-click screen capture. The spike section of the plan explains it.
- Three test files in this tree are red from other agents' in-flight work (`client-imports`,
  `store-*`, `quiz-panel`). None of them touch this feature.

## What I want back

Findings ranked by severity, each with the file and line, a concrete failure scenario, and what you
would insist on. **Be specific about which of your findings are certain and which are suspicions**
— on the last round I acted on a finding of yours that turned out to be exactly right, and I would
rather know your confidence than guess it. If you think this is shippable, say so plainly; if not,
say what blocks it.
