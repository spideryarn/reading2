# Plan review: the first glossary of a long piece is written in stretches (261022f)

You are reviewing a PLAN, read-only. Nothing is built yet. Repo: this worktree, base commit `HEAD`
(run `git rev-parse HEAD`). The candidate is one untracked file:
`docs/plans/261022f-explain-this-and-a-glossary-that-scales-with-length.md`.

Read it, then the code it changes: `src/glossary.ts` (`BATCH_SIZE`, `suggestedCount`,
`renderPrompt`, `generateGlossary`, `buildGlossary`, `dedupe`, `existingFor`, `appendableVersion`,
`PROMPT_VERSION`), `src/tree-parts.ts` (`partsOf`), the glossary step in `src/pipeline.ts` (search
`Stage 5d`), `src/token-budget.ts`, and `docs/project/glossary.md` (§ What is generated, § The two
bugs, § A cited work is not a term, § The scores, § Finding more, § Staleness). Tests:
`tests/glossary.test.ts`, `tests/glossary-ideas-baseline.test.ts`, `tests/profile-prompts.test.ts`.

Attack the plan independently first. In particular, is it right about:
- the root cause (a fixed cap, 20, on a list that should scale with length), and whether splitting
  by top-level parts with a "first used in PART a–b" instruction actually fixes it;
- what happens downstream with a ~100-entry list: dedupe across stretches (synonyms and
  near-duplicates the name/alias match will not catch — see glossary.md § Two), id minting and
  `idsByTerm`, occurrences, `lastAdded`/`passes`, the profile, the job's progress line, the cost
  ledger (each call must be recorded), the abort signal, the cache_control choice under parallel
  calls, `finishedText` truncation per call;
- partial failure (keeping paid-for stretches): is that honest, or a silent success?
- the prompt version bump to `glossary/10`: what it does to existing lists, Find more, staleness;
- anything the plan claims about the threshold and the underlines that is false;
- a simpler design that gets the same result.

Severity: P0 data loss / security / incorrect charging / broadly unusable; P1 user-visible wrong
behaviour or authoritative contract violated; P2 design/maintainability risk; P3 prose. Give each
finding an id (F1, F2…), a severity, the file:line evidence, and whether it is established or
reasoned. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REJECT.

My own suspicions, worth less than yours, so spend most of the run elsewhere: that per-stretch
answers will duplicate a central term (entropy) in every stretch, since "first use" is fuzzy for a
model; and that five parallel calls on one job may hit a concurrency or rate limit somewhere.
