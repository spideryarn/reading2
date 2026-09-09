Verdict: stage 1 is correct after the fixes below. No code move was reviewed.

- **F1 — P0, fixed:** `reusable/README.md` was omitted from `EVERGREEN`, leaving the new repository front door outside the line/symbol citation gate. [tests/doc-links.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/reusable-folder/tests/doc-links.test.ts:464) now covers all `reusable/**/*.md`, with positive controls for both READMEs and the new repository root.

- **F2 — P1, fixed:** The re-pin explanation was inaccurate. `get-ready-to-deploy` changed its prompt, document path, and document digest; `feedback-sweep` changed five references to three distinct docs. Also, provisioning sets `OVERSEER_JOBS_ENABLED=0`; it is not absent. Corrected [standing-jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/reusable-folder/tools/overseer/standing-jobs.ts:150) and the [stage plan](/home/greg/code/spideryarn2/.claude/worktrees/reusable-folder/docs/plans/260909h-a-reusable-top-level-folder-that-can-become-its-own-repo.md:65). The re-pin itself is legitimate: behavior is semantically unchanged, and all four standing/rule pins now match.

- **F3 — P1, fixed:** The new README overclaimed that the directory was already independent and that the link test was a complete oracle. It does not cover runtime paths or every source-comment root. [reusable/README.md](/home/greg/code/spideryarn2/.claude/worktrees/reusable-folder/reusable/README.md:3) now names those remaining seams honestly.

- **F4 — P1, fixed:** A rewritten source-comment link in [UsagePanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/reusable-folder/tools/fleet/web/src/UsagePanel.tsx:160) was one directory short and resolved to `tools/reusable/`.

- **F5 — P2, fixed:** R1 had rewritten 31 absolute, line-numbered citations in 15 historical review artifacts, contrary to the stated preservation policy. Their original `docs/reusable/` paths were restored.

- **F6 — P3:** `docs/project/original-version/` is not the only depth-three area: 18 files across three nested research directories join its 20 files. R3 handled all 38 correctly; there are no deeper Markdown files. An independent comparison found 1,088 changed relative links with no semantic-target mismatches.

- **F7 — P3:** `.vercelignore` is safe today. The deploy gate derives and masks `reusable/`, and no product/API build import or runtime file read reaches into it.

Verification:

- All 39 moved docs reverse mechanically to their original bytes.
- No missed executable old path was found.
- Pin calculator: all four hashes current.
- `git diff --check`: clean.
- Focused Vitest: 14/15 checks pass. The sole failure is the same three anchor errors already present at `HEAD` in `260909g-several-claude-subscriptions-…`; this move did not introduce them.
- The remaining 46 `docs/reusable` occurrences are deliberate: 31 restored historical citations, two `.diff` files, one transcript fixture, and current descriptions of the move.

Everything remains uncommitted.