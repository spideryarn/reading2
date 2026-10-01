# Answer key P07: FAQ generates automatically after an import, like the main modes

Nearest landed work: `260930c-auto-generate-the-main-modes-after-import.md` (the add page's tick
box), plus `260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md` § 3 (the
precedent for adding a step that is not a main mode).

**The core finding.** The box's list is derived, not written: modes with `experimental: false`,
mapped through `modeStep`. FAQ is experimental, so it is skipped by design. There are two honest
routes, and the choice is Greg's, explained plainly:
- (a) promote FAQ out of the switch - then it is queued with no code change, but it is also drawn
  for every reader, and `docs/project/experimental-features.md` says its prompt is unmeasured;
- (b) add `"faq"` to `AUTO_EXTRA_STEPS` by hand, as `crossrefs` was - every import pays for FAQ
  even for readers who cannot see the mode (unless gated on `useExperimental`, a new wrinkle).
Writing a second, hand-kept list of modes is the wrong answer.

## 1. Docs it must read
- MUST `docs/plans/260930c-auto-generate-the-main-modes-after-import.md` (§ Which modes are "main", § The design, § What it costs, § What it does not do) - may be read; it is the record.
- MUST `docs/project/ingest-queue.md` § "Since 2026-09-30 it can also start the main modes" (the signpost to `src/web/auto-modes.ts`).
- MUST `docs/project/experimental-features.md` § "What is behind it today" (FAQ's row and why it is still behind) and `docs/project/new-mode.md` § "Moving a mode in or out of the switch" (three edits, `BEHIND_THE_SWITCH`).
- MUST `docs/project/faq.md` - what the step makes, its order and cost.
- USEFUL `docs/project/cross-references.md` § "When it runs" (the hand-added extra step, and its wording).
- USEFUL `docs/project/ai-gateway.md` § "What stops a reader spending our money, and what does not"; `docs/project/cost-tracking.md` (a pipeline step is tracked for free).
- USEFUL `docs/plans/260929c-modes-generate-in-parallel-on-one-article.md` (one job per mode, side by side; three running at once machine-wide).

## 2. Existing code to reuse
- `src/web/auto-modes.ts` § `autoModes`, `AUTO_EXTRA_STEPS`, `autoModeSteps`, `autoModeRequests`, `autoModePosts`, `queueAutoModes`, `autoModesDetail`, `STEP_READS`. Trap: a second queueing loop in `AddPage.tsx`, or a literal `["tweets","glossary",…,"faq"]`.
- `src/web/activation.ts` § `modeStep` / `MODE_TARGET` (`faq: { kind: "fixed", target: "faq" }`).
- `src/mode-catalog.ts` § `MODE_CATALOG.faq.experimental` (route a).
- `src/sharing-steps.ts` § `STEP_SHARING` (`faq` reads nothing, so it goes in the first, parallel group; `STEP_READS` needs no row).
- `src/web/useFaq.ts` + `src/web/useAutoRun.ts` - a mode opened while its job is queued shows that job's progress (`useStepJob` finds it); nothing new is needed on the panel side.
- `POST /api/jobs` `{ slug, steps }` - de-duplicates on the work key and spends no billing slot. Trap: a server-side hook at publication (passed over in 260930c; needs a column and a migration).

## 3. Code files it would edit
Route (b): `src/web/auto-modes.ts` (`AUTO_EXTRA_STEPS`, and the hand-written tail of `autoModesDetail`, which names extra steps in prose), `tests/auto-modes.test.tsx` (pins today's list and what the add page posts), `docs/project/faq.md` and `docs/project/ingest-queue.md` (the line naming what the box queues).
Route (a): `src/mode-catalog.ts`, `tests/dock-experimental-modes.test.tsx` § `BEHIND_THE_SWITCH`, `docs/project/experimental-features.md` row; the box then follows by derivation.

## 4. Project rules that apply
- Ask Greg: promoting a mode to everyone is his call; a default-on paid call per import adds cost (`CLAUDE.md` § Simplest version first, § Explain plainly; `experimental-features.md`).
- Failing test first: `tests/auto-modes.test.tsx` red on the new list before the change (`CLAUDE.md`).
- Name the cost: 260930c measured ≈ $0.31 per import for the five; FAQ adds its own median (from the `ai_calls` ledger, `npm run cost`, `docs/project/cost-tracking.md`).
- Copy says it costs, no price (`MODE_CATALOG.how` house rule, cited in `autoModesDetail`).
- `npm test`, `npm run typecheck`; GPT Sol code review; browser check in a Sonnet subagent that imports an article and opens FAQ mid-job (`docs/project/browser-control.md`).

## 5. Traps (from the landed plan)
- A mode that reads another's artefact must carry those steps in its own job; relying on job age is unsound because `created_at` comes from each app server's clock (260930c, Sol P1). FAQ reads nothing, so it is a single-step job - check `STEP_SHARING` rather than assume.
- `STEP_READS` is a deliberate copy of `STEP_SHARING`'s reads (the browser cannot import `src/store/` types); a test holds them equal (260930c § The design).
- Nothing is queued if the add page closes before the import finishes, and a failed POST is unreported (260930c § What it does not do) - do not claim otherwise in the copy.
- The modes start ~20-30 s after the article opens, behind the free `labels` step (260930c § What the reader waits on).
- StrictMode double effects: the once-guard `queuedModesFor` in `src/web/AddPage.tsx` and `autoModesRef` written in the gesture (260930c code review; `docs/project/ingest-queue.md` § The three traps).
