**ship with these fixes (applied)**

Sampled **50 rewritten comment blocks**: 26 backend/type comments, 16 stylesheet pointers, and 8 mode/layout comments. **Six contained false or stale wording.** Also corrected six existing stale comment blocks within the permitted files. Seven files modified; nothing committed.

- **C1 — P2 — `src/types.ts:2078`, `src/store/pg.ts:2897`, `src/web/Masthead.tsx:812` — reasoned, fixed.** Visitor omission of `visibility` does not mean visibility is unknown. `PublicArticle.sharedBy` distinguishes public access from a private link. Comments now explain omission of the owner-side field. The first two were rewritten comments; Masthead’s existing explanation had the same error.

- **C2 — P3 — `src/store/pg-jobs.ts:249` — reproduced, fixed.** “Already behind that flag” refers to a removed store flag. `rg -n 'STORE|ingestProvenanceOf' src/billing/admission.ts` finds the provenance call and no such flag. Removed the false qualification.

- **C3 — P3 — `src/store/job-fence.ts:47` — reproduced, fixed.** The rewritten block still described the deleted `jobs-fs.ts` adapter and former parity test in present tense. Converted them to history while preserving the reason for complementary lease boundaries.

- **C4 — P2 — `src/web/styles/structure-mode.css:21` — reproduced, fixed.** “The same rule … as Outline” falsely implies Structure’s list never scrolls. `outline-mode.css:379` sets `overflow-y: auto` for expanded lists and the fisheye’s fit floor. The comment now distinguishes that list from the fixed two-column panel.

- **C5 — P3 — `src/web/scroll.ts:163` — reproduced, fixed.** The rewritten pointer remained inside an explanation claiming live fisheye panels sample the table head. Those panels are gone. Corrected this and five further existing fisheye comment blocks in the file, retaining their historical rationale.

The three requested dead-code claims hold, with qualifications:

- **C6 — P3 — `src/web/FeedbackDialog.tsx:922`, `src/messages.ts:5743` — reproduced, reported.** `rg -n '\b501\b|FEEDBACK_NOT_AVAILABLE' src --glob '*.{ts,tsx}'` shows no application-generated 501 response; the executable references retain the client mapping. Left unchanged as instructed.

- **C7 — P3 — `src/fetch.ts:385` — reproduced, reported.** `rg -n 'writeRawFiles' src tests scripts tools` finds its only invocation in `tests/stage2c-raw-bytes.test.ts:367`; other hits are the definition, import, comments, or descriptive strings. Left unchanged.

- **C8 — P3 — `src/vercel-health.ts:1305` — reasoned, reported.** `rg -n 'cachedSchemaCheck|schema === undefined' src/vercel-health.ts`, followed by reading the implementation, confirms every return path supplies a `SchemaCheck`, including failures. The undefined branch is redundant. Left unchanged.

Independent behavior check: Oxc parsed both commit versions of all **95 TS/TSX files**. Their ASTs matched after excluding comments and positional metadata. All **7 CSS files** matched byte-for-byte after removing comments. Controls detected a code addition and ignored a comment addition. The final working-tree fixes passed the same comparison. No compiler, lint, or bundler directives changed.

The complete list of changes outside source comments is:

- `docs/plans/261006j-sixth-sweep-s2-false-comments.md`
- `docs/tutorials/architecture.html`
- `docs/tutorials/import-pipeline-and-database.html`
- `docs/tutorials/revisions-and-the-schema.html`
- `infra/hetzner/provision.sh`

The last changes bytes written into an SSH comment. Repository searches found only a guard using the unchanged `gjd-remote-loopback` marker, with no parser depending on the changed suffix. Every changed line in `.env.example`, `supabase/config.toml`, and `infra/hetzner/main.tf` is a comment.

All three banners are accurate and dated; all eight documentation links resolve. The seventeen-mode count and removal/rename claims check out. No important surviving rationale was lost.

Validation: typecheck passed across **3,336 files**; **126 database-free tests passed** in four files; `git diff --check` passed. Broader test runs produced no verdict: one was interrupted, and a subsequent three-file run timed out after 60 seconds. No network or database used.