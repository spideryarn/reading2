# Plan review: 261028b

You are reviewing a plan, read-only. Do not change any file.

Read docs/plans/261028b-feedback-discussions-monospace-mockups-and-admin-mockups-page.md (untracked in this worktree, the plan under review). Context: docs/project/feedback.md (§ One box, § Questions for an admin, § Adding to an earlier report), docs/project/feedback-reports.md (§ Asking Greg a question), docs/project/overseer.md (lines 39-63 and § The log), docs/project/admin.md (§ The three refusals), src/types.ts § FEEDBACK_KINDS, src/routes.ts around line 9071 (kind validation), src/web/FeedbackDialog.tsx (KindHint, THANKS, KindButton), src/feedback-question-values.ts, src/web/FeedbackEarlier.tsx around line 1749, vercel.json (includeFiles), src/db/ssl.ts line 30 (how certs/ is read at runtime).

Questions I most want answered:
1. Stage 3: is reading docs/mockups/** from disk at runtime on Vercel (includeFiles, as certs/ is) sound, and is there a simpler or safer way to serve admin-only images? What would break?
2. Stage 1: refusing `discussion` from non-admins at the route — is that the right place, and which readers of `kind` (closed lists, Sentry, mail, admin list, scripts) would silently mishandle a new value? Grep for them.
3. Stage 2: is a ``` fence in a plain-text body the simplest robust rule? Edge cases (Details line inside a fence, CRLF, an unclosed fence in an already-published row).
4. Is the staging right, and is anything here more complex than the value it buys? Name a smaller version if there is one.

Severity: P0 (would ship broken or unsafe), P1 (likely bug or wrong design), P2 (worth changing), P3 (nit). Give each finding an ID (F1, F2…), the file/line evidence, and a concrete fix. Last, my suspicions: the includeFiles glob and the admin gate for the image route; kind values reaching the shipped-emails script.
