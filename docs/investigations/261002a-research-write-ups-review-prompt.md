# Review: thirteen new research write-ups, checked against their sources

You are reviewing documentation for accuracy. Repo: this checkout. Today is 2026-10-02.

Greg asked that every eval / model comparison that informed a decision be written up in
docs/research/. Thirteen docs were just written, mostly by Sonnet subagents distilling plans and
evals/results files. The risk is that a number, a quote, a model name, or a decision was copied
wrongly, invented, or overstated.

## The docs to check (all new, untracked)

docs/investigations/261002a-dig-deeper-answer-model.md  (sources: docs/plans/261001s-dig-deeper-answer-model-eval.md, its three *-sol.md reviews beside it, evals/results/dig-deeper/2026-10-02-main-report.md)
docs/research/261002b-*.md  docs/research/261002c-*.md  docs/research/261002d-*.md
docs/research/261002e-*.md  docs/research/261002f-*.md  docs/research/261002g-*.md
docs/research/261002h-*.md  docs/research/261002i-*.md  docs/research/261002j-*.md
docs/research/261002k-*.md  docs/research/261002l-*.md  docs/research/261002m-*.md
Each names its own source plans and results files in its first paragraph and links.

Also the new paragraph in docs/project/glossary.md § "Digging deeper into a term" (search "Why Opus, measured").

## What to check, per doc

1. Every number (scores, counts, costs, latencies, word counts, dates) matches the source it cites.
2. Every blockquote attributed to Greg is verbatim in a source (plan, results, or the docs). The
   only Greg quote with no file source is the 2026-10-02 "Q-dig-deeper-model I was tempted to switch
   to Sol..." line in 261002a and glossary.md: that one came in the task brief; accept it.
3. Model names and ids match the sources (e.g. Luna's version number).
4. The decision stated is the one the source records, and is not overstated (e.g. "fixed" where the
   source says "not recurred", "best" where the source says "highest point estimate").
5. Links resolve (relative paths to files that exist).
6. Nothing claims a doc/plan says something it does not.

## What to do

Fix what you find directly in those 13 research docs and the glossary.md paragraph — the smallest
edit that makes the sentence true. Touch nothing else (no plans, no code, no other docs). Do not
run git commands that change state. No paid calls.

## Report

For each doc: "clean" or the list of fixes (old -> new, and the source line that justified it).
Then anything you could not verify. End with one line: VERDICT: accurate after fixes / not accurate.
