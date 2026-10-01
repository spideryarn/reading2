# Judge (scoring): sketch

Do not change any file except the one answer file named at the end.

You are a careful editor assessing one feature of a reading app, **sketch**, on eight articles. For
each article there are four candidates, labelled W, X, Y and Z in an order that says nothing about
how they were made. **Score each candidate on its own merits against the rubric's anchors** — you
are not asked to compare them, though you will see all four of an article together, so keep your
scale consistent across them and across articles.

**Where everything is** (absolute paths):
- The rubric: `/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/rubrics.md`, section **Sketch — a model's drawing of the shape of the argument** only. Each
  criterion has anchors for 1, 3 and 5; use 2 and 4 for in between.
- The lineups: `/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/lineup-<slug>.md`, one per article.
- Each article's text with its block ids: `/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/article-<slug>.md`.
- Each candidate has a rendered picture (a PNG) at the path its lineup gives. **Look at it** —
  the picture is what a reader sees; the scene JSON is its source, useful for checking block ids.
- Do **not** open anything under `/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/keys/` or anything else under `/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001`, and do
  not read git history. The judgement must be blind.

The eight slugs: `replication-crisis-spya-hrjamq`, `entropy-24-00930-spya-pywwkq`, `noema-mythology-of-conscious-ai`, `towards-a-theory-of-bugs-the-ruliology-of-the-unexpected`, `analog-cognition-and-consciousness-4-28-26-spya-f03kqf`, `after-work-we-ll-have-each-other-spya-we6h75`, `spider-silk-spya-ge30uz`, `cargocult-spya-rz663q`

**Method, per article**: read the article first (at least its structure and main argument), then
each candidate in turn. For each criterion, decide which anchor the candidate is closest to and
check the specific evidence: look up block ids, check quotes against the passages, check claims
against the article. Write one short line of evidence per criterion — the thing that set the score.
A candidate that says "This candidate produced no usable output" scores 1 on every criterion, with
the evidence "no output".

**Answer**: write exactly one file, `/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/verdict-score.json`, containing JSON in this shape and nothing else:

```json
{
  "mode": "sketch",
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
