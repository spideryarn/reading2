# Judge (ranking): ideas

Read-only: do not change any file.

You are judging the output of one feature of a reading app, **ideas**, on eight articles. For each
article there is one lineup of four candidates, labelled W, X, Y and Z in an order that says nothing
about how they were made. Rank them by quality against the rubric.

**Where everything is** (paths relative to the repository root):
- The rubric: `evals/thinking-effort/rubrics.md`, section **Ideas — the propositions this piece needs you to hold**. Use only that section.
- The lineups: `evals/results/thinking-effort-261001s-ideas-schema/judging/ideas/lineup-<slug>.md`, one per article.
- Each article's full text with its block ids: `evals/results/thinking-effort-261001s-ideas-schema/judging/ideas/article-<slug>.md`.
- There are no pictures.
- Do **not** open anything under `evals/results/thinking-effort-261001s-ideas-schema/judging/ideas/keys/`, anything else under `evals/results/thinking-effort-261001s-ideas-schema`, or
  `evals/thinking-effort/` other than the rubric, and do not read git history for these files. The
  judgement must be blind.

The eight slugs: `replication-crisis-spya-hrjamq`, `entropy-24-00930-spya-pywwkq`, `noema-mythology-of-conscious-ai`, `towards-a-theory-of-bugs-the-ruliology-of-the-unexpected`, `analog-cognition-and-consciousness-4-28-26-spya-f03kqf`, `after-work-we-ll-have-each-other-spya-we6h75`, `spider-silk-spya-ge30uz`, `cargocult-spya-rz663q`

**For each article**: read the article (enough to judge, at least its structure and main argument),
then all four candidates, then rank them. Ties are allowed and expected where two candidates are
genuinely as good as each other — do not force a strict order. A candidate that says "This
candidate produced no usable output" ranks below every candidate that has one, tied with any other
such candidate. Judge quality, not length: a longer
candidate is better only if what it adds is good.

**Answer** with JSON only, with no code fence and nothing after it, in exactly this shape:

{
  "mode": "ideas",
  "viewedPictures": true,
  "articles": [
    {
      "slug": "<slug>",
      "ranking": [["W"], ["X", "Z"], ["Y"]],
      "separations": [
        "W over X/Z: <one sentence naming the deciding difference>",
        "X/Z over Y: <one sentence>"
      ],
      "criterionNotes": "<one or two sentences on where the four differ most, by rubric criterion>"
    }
  ]
}

`ranking` is best first; each inner list is a tier of tied candidates; all four labels appear exactly
once. All eight articles must be present. `viewedPictures` is whether you actually looked at the
images (false if you could not, or if this mode has none).
