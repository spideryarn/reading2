# P07 before: FAQ mode auto-generates after import

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (in context): no pointer to post-import generation; sent me to the entry points.
- `docs/project/faq.md`: what FAQ is; says nothing about generation after import (only "Making it again", re-run from Metadata). Partly helpful.
- `docs/project/mode.md`: the mode checklist, `auto-run-targets.ts` (open-it-to-start), "Moving a mode in or out of the switch". Helpful for the experimental flag; did not mention the add-page tick box.
- `docs/project/ingest-queue.md` (the add page section): the one that actually answers it. "Since 2026-09-30 it can also start the main modes" names `src/web/auto-modes.ts`.
- `docs/project/cross-references.md` § When it runs: showed that a non-mode step (`crossrefs`) was added to the box by hand, a precedent.
- `docs/project/experimental-features.md`: the switch's rules (head only).
- `docs/project/cost-tracking.md` (head): new step gets tracking free via `runStep`.
- Not opened (barred): the 260930c plan that ingest-queue.md and auto-modes.ts link to.

## 2. Code files I would edit
- `src/web/auto-modes.ts` (add `"faq"` to `AUTO_EXTRA_STEPS`, update `autoModesDetail()` wording)
- `tests/auto-modes.test.tsx` (the pinned `autoModeSteps()` list, plus the "takes nothing from behind the experimental switch" test, which would now be false for faq and needs an explicit exception)
- `docs/project/ingest-queue.md` (the "main modes" paragraph) and `docs/project/faq.md` ("When it runs" section, which does not exist yet)
- Alternative, if Greg wants it a true main mode: `src/mode-catalog.ts` (`experimental: false`), `tests/dock-experimental-modes.test.tsx` (`BEHIND_THE_SWITCH`), `docs/project/experimental-features.md`.

## 3. Existing helpers to reuse
- `src/web/auto-modes.ts` § `AUTO_EXTRA_STEPS`, `autoModeSteps`, `autoModeRequests`, `autoModePosts`, `queueAutoModes`, `autoModesDetail`. No new helper needed.
- `src/web/AddPage.tsx` (calls `queueAutoModes` on job done; not opened, I would check it still needs no change).
- `src/step-order.ts` § `STEP_ORDER` (`faq` already there, ordering is derived).
- `src/sharing-steps.ts` § `STEP_SHARING` (faq already classified; reads nothing so it joins the parallel group).

## 4. Rules I would follow
- Product question first: FAQ is `experimental: true` in `MODE_CATALOG`, and the box is "derived, never listed" from non-experimental modes, so the choice is (a) add as an extra, or (b) promote the mode. (a) is simplest but queues a paid call for readers who never see the mode; ask Greg (CLAUDE.md "ask the other way round", "name the complexity").
- Test first, red before green: update `tests/auto-modes.test.tsx` first (CLAUDE.md).
- Run `npm test`, `npm run typecheck`, lint on touched files (CLAUDE.md).
- Plan doc under `docs/plans/` named via `npx tsx scripts/plan-name.ts`, GPT Sol review of plan and code (CLAUDE.md).
- Worktree, merge not rebase, commit own files by name, push to `dev` (CLAUDE.md).
- Cost: nothing to do, `runStep` attributes spend (`cost-tracking.md`); the box's label says "This uses paid model calls", keep that true.
- Docs: edit the owning doc, no mode counts (`mode.md`); the changed wording of an entry-point doc needs approval only if I touch one.
- Copy: reader-facing sentence in `autoModesDetail` follows the "no price" rule noted in its comment.

## 5. Where I got lost
- The task's premise ("like the main modes already do") sounded like a pipeline step, so I started at `DEFAULT_INGEST_STEPS` and `STEP_ORDER` in `src/pipeline.ts` / `src/step-order.ts`, which say the opposite (modes are deliberately off the import). The real mechanism is client-side on the add page; I found it only by grepping "after import" and following a comment in `step-order.ts` (crossrefs). Nothing in CLAUDE.md, `faq.md`, `mode.md` or `architecture.md` signposts it.
- `mode.md` says modes start when opened (`auto-run-targets.ts`) but not that the add page also starts them; a reader could conflate the two.
- Caveats I did not resolve: the box only fires from the add page, so the upload, hover-card and bookmarklet-less front doors, and a closed tab, queue nothing; I did not verify whether the server accepts an experimental step from a non-experimental reader. `src/web/auto-run-targets.ts` header says "Eleven start after a press", a possibly stale count.

## 6. Confidence
7/10. The mechanism and files are clear; the unread plan, AddPage and server-side gating are the gaps, and the product choice (a) vs (b) is open.
