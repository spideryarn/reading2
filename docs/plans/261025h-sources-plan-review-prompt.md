# Review: the plan for Sources as three chips, a cost ladder, an eval and experiments

Repo: this worktree, a TypeScript/ESM reading app (Spideryarn). Read-only review of a PLAN, not code.

## The candidate

Committed: d386e7340 — docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md

Background to read first: docs/user-feedback/questions/q-vg2b69.md (the question Greg answered;
his answer is quoted at the top of the plan), docs/plans/261025c-sources-proposals-what-it-shows-first-and-fewer-sub-modes.md,
docs/investigations/261025a-sources-trial-situate-reception-cited-by-on-six-articles.md,
docs/project/sources.md, docs/project/privacy.md (Search the literature, OpenAlex sections),
docs/project/mode.md. Code to check the plan's premises against: src/web/modes/sources/SourcesMode.tsx,
src/web/params.ts (SOURCES_VIEWS, visitorSourcesView), src/web/activation.ts (activationForSources),
src/citation-index.ts (titleMatchOf, citersOf), src/related-work.ts, src/situate.ts (checkFindings,
SITUATE_RATE_POLICY), src/web/InvestigatePanel.tsx, src/web/SituateDossier.tsx, src/web/router.ts
(liftLegacySources), and wherever the visitor POLICY lives. These do not limit scope.

## What I want

An independent attack on the plan: is each stage's premise true of the code, does the sequencing
keep Sources working for readers between stages, does any decision contradict Greg's answer or a
documented contract (privacy promises, the visitor policy, the activation contract, the
experimental-switch rules, block ids), what is missing, what is more complex than it needs to be,
and is there a simpler version of any stage that gets most of the value. Also judge the eval design
(Stage 4): would its arms and scoring actually tell us whether Haiku can do more, and is any arm a
waste. Judge the experiments (Stage 5) for value per cost; suggest a better left-field idea if you
have one.

Severity: P0 data loss / exploitable security / incorrect charging / broadly unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability
risk; P3 prose. Give every finding an ID (F1, F2, …), the evidence (file:line), and a suggested
change to the plan. Do not change any file.

## My own suspicions (worth less; spend most of the run elsewhere)

- Decision 5 (the dossier leaves the experimental switch for every owner) — is that consistent with
  privacy.md and billing, and what has to change with it?
- Decision 6 (Reception's press retired, its query folded into the dossier) — does any other code
  (command bar rerun rows, the Claims line, chat origins, visitors) depend on Reception being pressable?
- The "tools row" in place of real folds — does keeping `where` lit for four other `?sources=` values
  break any invariant of the chip radiogroup (exactly one checked) or of last-view restore?
- The sentence I'd least like to be wrong about: "every old address keeps working with no translation".
