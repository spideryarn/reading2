You are reviewing STAGE 2 of plan 260913a in this worktree, READ-ONLY. Do not change any file:
another agent is still writing stage 1 in this same tree, so the caller will apply your fixes.
For each finding, give the exact replacement text (a before/after) so it can be applied as
written. Server code (src/feedback.ts, src/feedback-envelope.ts, src/feedback-article.ts,
src/routes.ts, src/store/**, tests/feedback-mirror.test.ts) is stage 1 and may be half-written
right now — read it only to check the words against, and do not review it.

The plan (the spec, especially § The proposed reader-facing wording and § What the plan review
changed): docs/plans/260913a-send-the-source-file-and-the-article-with-extra-diagnostics.md

Stage 2 is commit 7c09f719 — review exactly `git show 7c09f719`. Its files:
- src/web/FeedbackDialog.tsx (the .fb-consent tick-box sentence)
- src/web/PrivacyPage.tsx (§ If you send us a bug report, last paragraph, and its JSX comment)
- tests/feedback-dialog.test.tsx, tests/privacy-page.test.ts (new pins)
- docs/project/feedback.md, docs/project/privacy.md, docs/project/admin.md,
  docs/project/feedback-reports.md

What stage 1 builds (so you can check the words against it): src/feedback-article.ts gathers,
only when the reader ticked the box AND the report names a slug AND the reporter owns that article
(owner-filtered reads that 404 otherwise), the source file via loadSource (≤10 MiB) and an
article.json = loadArticle payload + a field-by-field pick of articleMetadata that EXCLUDES the
reader's profile and purpose. Two tags source_file / article_json ∈ attached|too_large|none|failed.
Sentry only; the Postgres row is unchanged; nothing new leaves the browser.

The conclusion I most want checked: "every sentence a reader sees — the tick-box and /privacy — is
true of what stage 1 sends, promises nothing it does not do, and omits nothing a reader would be
annoyed to discover." Hunt for a clause that is false in some state (a visitor on a public
article, the metadata or tweets page, a report with no slug, an HTML source, a too-large file, a
reader-renamed title, the screenshot, the URL tag that carries ?q= on every report).

Then check the docs: does each new claim trace to code or to the plan? Is any number stated that
nothing in the repo supports? Does tests/doc-links.test.ts pass once src/feedback-article.ts exists?

Run: npx vitest run tests/feedback-dialog.test.tsx tests/privacy-page.test.ts (no network needed).

Severity: P0 (a false promise to readers about their data), P1 (misleading or incomplete copy, a
wrong doc claim), P2 (worth changing), P3 (nit). ID every finding (S2-1, S2-2, …), with file:line
evidence, what you fixed (if anything) and why. End with: FIXED/NO-CHANGE per finding, and a
one-line verdict.
