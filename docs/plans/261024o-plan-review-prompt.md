# Plan review: Sources › Situate (261024o)

You are reviewing a **plan**, read-only, for Spideryarn (an AI-assisted reading app whose rule is to
augment reading, never replace it). Repo root is the current directory.

**The candidate** is commit `bcf80b839` (one commit on top of `d629e567f`):
`git show --stat bcf80b839`. Read, in this order:

1. `docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md` — the plan.
2. `docs/investigations/261024b-situate-spike-searches-into-one-read-cost-and-quality.md` and
   `scripts/spikes/261024b-situate-spike.ts` — the spike the plan rests on. **Read the write-up as a
   reviewer of its conclusions, not only of the code.**
3. `docs/research/261024a-situating-a-paper-in-the-literature-how-researchers-read-and-check.md` (skim).

Then whatever the plan touches, which does not limit your scope: `docs/project/sources.md`,
`docs/project/marginalia.md`, `docs/project/mode.md` (§ The artefact, § Its cost),
`docs/project/security-map.md`, `docs/project/privacy.md`, `src/reception.ts` (the nearest existing
step that searches the web), `src/sources-claims.ts` (the newest step, the pattern to copy),
`src/web-search-subagent.ts`, `src/citation-index.ts`, `src/related-work.ts` (the rate policy and
the press-not-chip rule), `src/web/marginalia/notes.ts`, `src/web/InvestigatePanel.tsx`,
`src/web/modes/sources/SourcesMode.tsx`.

The admin's report the plan answers is quoted at the top of the plan. He asked the agent to proceed
without questions and to aim for "a fun, interesting version one" that can be pared back later.

## What I want from you

An independent attack on the plan first. In particular:

- **Is this the right shape** for what Greg asked, or is there a simpler version that gets most of
  the value (fewer phases, fewer files touched, no new step)? Is a seventh sub-mode the right call
  against his "ultimately fewer submodes"?
- **Correctness and safety of the pipeline**: prompt injection from search extracts (the read call
  has no tools; findings are shown as text to the owner), the quote and source checks, the
  "fewer than half the searches succeeded fails the run" rule, the dive pass revising findings, the
  cache-breakpoint layout (two breakpoints: article, then evidence) and whether the dive call
  really reuses them.
- **Cost and abuse**: the rate policy numbers, re-runs, the job system, what a visitor can reach.
- **Privacy**: queries made from an uploaded (possibly confidential) manuscript go to a web search
  engine; is the press-with-a-disclosure-line enough, and does it match `privacy.md`?
- **Contracts the plan may break**: block ids (`docs/project/block-ids.md`), the stale/outdated
  machinery, the stored-artefact registration lists, the Marginalia rule of "one line per kind per
  block", the visitor `POLICY`, `activationForSources`, the command-bar alias collision tests.
- **Anything missing** from the stages that `mode.md` would make a new step or sub-mode do.

Grade each finding by consequence, with an ID (`S1`, `S2` …):

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

For each: the finding, the evidence (file and line), and the change to the plan you recommend.
End with a one-paragraph verdict: build as planned, build with changes, or reshape.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The `citation` kind ("this cited work may not say what it is used for") from a web search
  extract alone may be the riskiest claim the margin can make; maybe it should need the cited
  work's abstract (Bibliography's stored abstract notes) rather than a search extract.
- Storing on `article_revisions` means a re-extraction (new revision) loses or carries forward the
  findings; I have not checked which.
- The sentence I would least like to be wrong about: *"Sonnet stays the reader"* — is the spike's
  Haiku comparison (one article, one run, cached input) enough to justify an 8x price?
