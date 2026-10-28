# Plan review: 261028c Explanations, and Sources feeding the margin

You are reviewing a **plan**, read-only. The repo is the current worktree at commit 843a6c01 (origin/dev); the candidate is one untracked file:

- `docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md`

Read it in full. Then read what it builds on, as much as you need: `docs/project/marginalia.md`, `docs/project/glossary.md` (§ What is generated, § The hover card), `docs/project/explain-this-vision.md`, `docs/project/sources.md` (§ Where it sits, § Opening it is the request), `docs/project/mode.md` (the checklist), `docs/project/reader-profile.md` (§ Provenance), `docs/project/prompting-guide.md`, `docs/project/principles.md`, and the code it names: `src/faq.ts` (the closest model step), `src/relations.ts` (the existing `explain` notes), `src/situate.ts` (a Haiku pass then a capable pass), `src/auto-mode-steps.ts`, `src/models.ts` (TASK_TIER, PINNED_MODEL, ALWAYS_HIGH_POWER), `src/web/annotate.ts` (`citeMarks`, `termMarks`), `src/web/marginalia/notes.ts`.

The source report is quoted at the top of the plan (Greg, the product owner, admin).

## What I want

An independent attack on the plan: is it the right thing, the right size, and in the right order? In particular:
1. Does the design do what Greg asked, and is anything he asked silently dropped or bent?
2. Is anything missing that will bite during the build (a store/route/test/CHECK/migration seam, freshness, profile staleness, the chat origin, owner-only rules, how prose marks overlap glossary/citation marks, the item-id stability claim)?
3. Is the cost section honest? The figures are estimates scaled from production ledger medians for comparable steps (stated in the plan); model calls are unavailable until 1 Nov. Is the method sound, and is anything about it overstated?
4. Is there a materially simpler version that gets most of the value? (The plan names two it passed over.)
5. The two questions for Greg (q-A: when Sources' literature search runs; q-B: the writer model and the on-import cost) — are they the right questions, and is anything else a product call that the plan quietly decided?

## Severity scale

P0 wrong or harmful as planned; P1 will cost real rework or ship a defect if not changed now; P2 worth changing; P3 nit. Give every finding an ID (PR-1, PR-2, …), the plan section, what's wrong, and the concrete change you recommend. If you have none at a level, say so. End with a one-line verdict: build as planned / build with the listed changes / rethink.

## My own suspicions (worth less; spend most of the run elsewhere)

- Whether a prose underline for passages (multi-word quotes) will collide badly with glossary term marks and citation marks in `annotateHtml`, and whether stage 3 is bigger than it looks.
- Whether "on import" is right while model calls fail until 1 Nov (every import would queue a job that fails).
- The sentence I'd least like to be wrong about: "Explanations adds about 10% to what an import costs at standard power."
