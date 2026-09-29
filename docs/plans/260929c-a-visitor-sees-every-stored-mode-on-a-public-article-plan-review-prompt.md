You are reviewing a plan in the repo at the current directory (Spideryarn, TypeScript). Read-only: do not edit files.

Plan: docs/plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md — read it in full.

This is an **access-control change**. A signed-out visitor (or a signed-in non-owner) of a *public* article will newly see the stored output of four modes — Trajectory, FAQ, Citations, Debate — that are `owners-only` today in src/web/visitor.ts § POLICY. Greg's rule: a visitor sees every mode's already-generated output; anything that would start a paid model call stays owner-only; a reader's private data stays private.

Look hard, and above all, for:

1. **Any way a visitor could trigger a paid model call** after this change: a hook mounted on the visitor path (useTrajectory, useFaq, useCitations, useDebate, useAutoRun, useStepJob, useIdeasRead/useFaqRead/useTimelineRead inside the Trajectory stop card), a deep-link parameter (?stop=, ?depth=, ?q=, …) that routes round a hidden button, a job-route or API route that does not check ownership, the "Find it" citation search, the stop card's "open in mode" links. Read src/web/modes/trajectory/TrajectoryMode.tsx, src/web/TrajectoryPanel.tsx, src/web/reader/Reader.tsx (case "trajectory" and around), src/web/useTrajectory.ts, and the equivalents for faq/citations/debate.
2. **Any private data that would reach a stranger**: profile or purpose text inside a Trajectory cue (src/trajectory.ts, src/profile.ts PROFILE_RULES), profileHash or other provenance in a DTO, citation_finds rows, URLs that need src/urls.ts publicCitationUrl, the Citations `key` field, anything owner-keyed. Is the plan's judgement that Trajectory's profile-shaped cues are "the same bargain as Glossary/Ideas/Quotes" sound?
3. **The audit table** in the plan: is any row wrong? Is any mode mis-classified (e.g. is Remember's Quiz, or Referee, actually shareable under Greg's rule without cost or privacy loss)? Are there stored outputs the plan missed entirely?
4. **The silent failures** the recipe in docs/plans/260904c-more-modes-on-a-shared-link.md § "What every stage owes" names — has the plan left any step out for these four modes? (PUBLIC_PROJECTIONS column, shareableArtefacts, shared-inventory, the owner's sharing inventory copy, privacy page / public-readable-sharing page claims, export, tests/public-imports.test.ts.)
5. Whether the staging (Trajectory first and shipped alone) is safe.

A failing test already exists: tests/public-network-trace.test.tsx § "draws a stored trajectory from the payload, asking nothing".

Answer as a numbered list of findings, each with severity (P0 = a visitor can spend money or read private data; P1 = wrong/missing behaviour; P2 = nit), file:line evidence, and a concrete fix. Then a one-line verdict. Be concise.
