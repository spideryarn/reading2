Ready after two narrow fixes. No P0/P1 findings.

- **C1 — P2, established, fixed:** unregistered Markdown files were silently ignored. The typed tables only proved that registered IDs had files; they did not prove every file was registered. Added a filesystem-to-catalogue inventory check in [help-markdown.test.tsx](/var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/tests/help-markdown.test.tsx:42). Red-first evidence: a temporary `review-orphan.md` made the test fail naming that file; removing it made all 36 tests pass.

- **C2 — P3, established, fixed:** [help-page.md](/var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/docs/project/help-page.md:3) still described Help as one page and inaccurately gave every Markdown kind the same front matter. It now describes the contents/topic structure and each file kind’s actual fields at [line 53](/var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/docs/project/help-page.md:53). This was a prose-only correction, so no regression test was appropriate; the documentation-link suite passes.

I found no unsupported claims in the four guides. I also verified that:

- `/help/questions` fragment arrivals and Back/Forward are covered by the fragment handling even when the resolved view is unchanged.
- Modified clicks remain native; links to questions from other pages route correctly.
- Production code does not hand-build Help subpage addresses outside the canonical helpers.
- `/help` uses the same title as `SITE_PAGES`.
- Signed-out visitors can reach Help.

Verification:

- Requested suites: 8 files passed; 489 tests passed, 2 skipped.
- Documentation checks: 18 passed.
- Typecheck: all 3,371 source files covered and green.
- Lint: no errors; three pre-existing informational fragment suggestions.
- `git diff --check`: passed.
- Full `npm test` could not start its database lane because the sandbox denied localhost PostgreSQL and Docker access. The requested database-free suites passed.
- No commit made. The two pre-existing untracked review files were left untouched.

VERDICT: ready after its fixes