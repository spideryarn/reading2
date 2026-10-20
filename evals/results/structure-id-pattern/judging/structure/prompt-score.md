# Judge (scoring): structure

Do not change any file except the one answer file named at the end.

You are a careful editor assessing one feature of a reading app, **structure**, on eight articles. For
each article there are four candidates, labelled W, X, Y and Z in an order that says nothing about
how they were made. **Score each candidate on its own merits against the rubric's anchors** — you
are not asked to compare them, though you will see all four of an article together, so keep your
scale consistent across them and across articles.

**Where everything is** (absolute paths):
- The rubric: `/var/tmp/spideryarn-worktrees/fbmxdf6r-structure-json-schema/evals/thinking-effort/rubrics.md`, section **Structure — the tree the Structure mode, the zoom and the gists all read** only. Each
  criterion has anchors for 1, 3 and 5; use 2 and 4 for in between.
- The lineups: `/var/tmp/spideryarn-worktrees/fbmxdf6r-structure-json-schema/evals/results/structure-id-pattern/judging/structure/lineup-<slug>.md`, one per article.
- Each article's text with its block ids: `/var/tmp/spideryarn-worktrees/fbmxdf6r-structure-json-schema/evals/results/structure-id-pattern/judging/structure/article-<slug>.md`.
- There are no pictures.
- Do **not** open anything under `/var/tmp/spideryarn-worktrees/fbmxdf6r-structure-json-schema/evals/results/structure-id-pattern/judging/structure/keys/` or anything else under `/var/tmp/spideryarn-worktrees/fbmxdf6r-structure-json-schema/evals/results/structure-id-pattern`, and do
  not read git history. The judgement must be blind.
- Nor open anything under the repository's `evals/results/hierarchy-structure/`,
  `evals/results/structure-whole-document/`, `evals/structure-whole-document/` or
  `evals/structure-id-pattern/`, nor `docs/plans/261020aa-*`: they name which candidate came from where.

The eight slugs: `replication-crisis-spya-hrjamq`, `entropy-24-00930-spya-pywwkq`, `noema-mythology-of-conscious-ai`, `towards-a-theory-of-bugs-the-ruliology-of-the-unexpected`, `analog-cognition-and-consciousness-4-28-26-spya-f03kqf`, `after-work-we-ll-have-each-other-spya-we6h75`, `spider-silk-spya-ge30uz`, `cargocult-spya-rz663q`

**Method, per article**: read the article first (at least its structure and main argument), then
each candidate in turn. For each criterion, decide which anchor the candidate is closest to and
check the specific evidence: look up block ids, check quotes against the passages, check claims
against the article. Write one short line of evidence per criterion — the thing that set the score.
A candidate that says "This candidate produced no usable output" scores 1 on every criterion, with
the evidence "no output".

**Answer**: write exactly one file, `/var/tmp/spideryarn-worktrees/fbmxdf6r-structure-json-schema/evals/results/structure-id-pattern/judging/structure/verdict-score.json`, containing JSON in this shape and nothing else:

```json
{
  "mode": "structure",
  "viewedPictures": true,
  "articles": [
    {
      "slug": "<slug>",
      "candidates": {
        "W": { "scores": { "c1": 4, "c2": 3, "c3": 5, "c4": 4, "c5": 3 }, "evidence": { "c1": "…", "c2": "…", "c3": "…", "c4": "…", "c5": "…" } },
        "X": { "...": "..." },
        "Y": { "...": "..." },
        "Z": { "...": "..." }
      }
    }
  ]
}
```

`c1`–`c5` are the rubric's five criteria in order. Integers 1–5. All eight articles, all four
candidates, all five criteria. Then reply with one line: the path you wrote and "done".
