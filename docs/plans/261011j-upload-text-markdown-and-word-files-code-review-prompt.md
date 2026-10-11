You are reviewing code before it is pushed, in the Spideryarn repo (read AGENTS.md / CLAUDE.md for the house rules). You are working in the worktree you were started in; edit only files in it.

**The work:** Word (.docx), Markdown and plain-text uploads, converted to a web page at stage 1 and stored as an uploaded web page from then on, with the original file kept beside it. Plan, including what changed after your own plan review: docs/plans/261011j-upload-text-markdown-and-word-files.md. Your plan review: docs/plans/261011j-upload-text-markdown-and-word-files-plan-review-sol.md (verdict REWORK; § After the plan review in the plan says what each finding became — check those answers too, and say if any is wrong).

**The diff:** docs/plans/261011j-upload-text-markdown-and-word-files-code-review.diff (`git diff origin/dev...HEAD`, lock file and generated corpus left out). The commit is HEAD.

**What I most want checked:**
1. `boundedDocxParts` in src/upload-convert.ts — the streaming zip guard. Is the count of real inflated bytes sound for every path fflate's streaming `Unzip` takes (stored entries, data descriptors, ZIP64, an entry skipped without `start()`, a truncated archive, an archive with trailing junk or a prepended stub, a central directory that disagrees with the local headers)? Does anything still inflate unboundedly or loop? Is the per-push transient bound (16 KB pushes) real?
2. `uploadedFormat` in src/fetch.ts against `uploadedDocumentKind` and the invariant tests/fetch.test.ts pins.
3. `acquireUpload` in src/pipeline.ts: the order of refuse / checksum / convert / keep-original / store, idempotence on a retry (the step can run twice), and that a refused file keeps nothing.
4. The picker (src/uploads.ts `uploadKind`, `UPLOAD_ACCEPT`) and `POST /api/uploads` (src/routes.ts, name-only `uploadProblem`) agreeing, and the CLI (scripts/stage.ts `ingestFile`).
5. Anything that reads `raw_filename`, `meta.source` or the manifest's kind and would now say something false about a converted upload (masthead, metadata page, export, feedback attachment, batch `metadata` step).
6. Reader-facing copy (src/messages.ts `UPLOAD_UNREADABLE_FILE`, `uploadProblem`, `uploadLimits`, the help page src/web/help/pages/adding-articles.md) against docs/project/copy.md.

**Rules for fixing.** Fix in place what is clearly a defect inside this work, with a test that goes red without your fix. Do NOT edit any file listed in docs/project/security-map.md § Where the defences physically live (src/sanitize*.ts, src/routes.ts, src/fetch.ts's scheme/size envelope, src/injection-scan.ts, etc.) — report instead. Do not touch .env.local, infra/, supabase/migrations, or the production database. Do not commit or run git commands that change state. Run `npx vitest run tests/upload-convert.test.ts tests/uploads.test.ts tests/upload-acquire.test.ts tests/stated-limits.test.ts` and `npm run typecheck` after any fix.

**Answer format.** A numbered list of findings, each with severity (high/medium/low), file:line evidence, and either FIXED (what you changed, and the test) or NOT FIXED (why, and the fix you recommend). Then the list of files you edited. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REWORK.
