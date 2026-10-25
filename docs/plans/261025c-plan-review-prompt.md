# Review: proposals for what Sources should be (plan 261025c)

You are reviewing a product proposal, read-only. Read, in this worktree:

1. `CLAUDE.md` (house rules) and `docs/project/vision.md` (the principle: augment reading, don't replace it).
2. `docs/project/sources.md` — the mode as it is: six sub-modes, and § Where this piece sits (the experimental dossier).
3. `docs/investigations/261025a-sources-trial-situate-reception-cited-by-on-six-articles.md` — the trial on six articles.
   The raw outputs are in `output/sources-trial/<slug>.md` and `<slug>-dump.json` / `-free.json` (gitignored, but present here).
4. `docs/plans/261025c-sources-proposals-what-it-shows-first-and-fewer-sub-modes.md` — the proposals under review.

Greg asked: what should a reader see first when Sources opens, how should it change with the
article's age, how do six sub-modes fold into fewer, whether and how to read the citing papers, and
what runs automatically versus on a press given cost. The plan offers A, B (recommended), C, and a
shared part.

## What to check

1. **Is each claim in the plan borne out by the trial outputs?** Name any number, quote or example
   that the outputs do not support, or that is stated more strongly than the evidence.
2. **Are A, B and C genuinely different choices**, and is the recommendation (B) argued fairly? Is
   there a better option the plan misses?
3. **The shared part**: is anything there not actually uncontroversial — a hidden product trade-off,
   a security or privacy change (note `docs/project/privacy.md` § Search the literature and the
   query-cleaning defence S3 in plan 261024o), or a cost Greg should decide?
4. **The landmarks idea** (OpenAlex `cites:<W>` with `title_and_abstract.search:<subject>`): what can
   go wrong — choosing the subject words (who picks them, and does that send anything new to
   OpenAlex), pieces not in OpenAlex, duplicate records, the anonymous allowance.
5. **Costs and allowance**: is the per-article cost right, and does A's auto-run conflict with the
   four-an-hour `SITUATE_RATE_POLICY`?
6. **Will Greg understand it?** Per `docs/reusable/ask-me-questions.md`, flag jargon, an unclear
   option, or a missing "how big to build".

Write numbered findings, each with a severity (high / medium / low), the line or section, and a
suggested fix. Then a short overall verdict. Do not edit any file.
