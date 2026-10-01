# Judge (ranking): {MODE}

Read-only: do not change any file.

You are judging the output of one feature of a reading app, **{MODE}**, on eight articles. For each
article there is one lineup of four candidates, labelled W, X, Y and Z in an order that says nothing
about how they were made. Rank them by quality against the rubric.

**Where everything is** (paths relative to the repository root):
- The rubric: `evals/thinking-effort/rubrics.md`, section **{RUBRIC_SECTION}**. Use only that section.
- The lineups: `{JUDGING_DIR}/lineup-<slug>.md`, one per article.
- Each article's full text with its block ids: `{JUDGING_DIR}/article-<slug>.md`.
{PICTURE_NOTE}
- Do **not** open anything under `{JUDGING_DIR}/keys/`, anything else under `{RESULTS_DIR}`, or
  `evals/thinking-effort/` other than the rubric, and do not read git history for these files. The
  judgement must be blind.

The eight slugs: {SLUGS}

**For each article**: read the article (enough to judge, at least its structure and main argument),
then all four candidates, then rank them. Ties are allowed and expected where two candidates are
genuinely as good as each other — do not force a strict order. A candidate that says "This
candidate produced no usable output" ranks below every candidate that has one, tied with any other
such candidate. Judge quality, not length: a longer
candidate is better only if what it adds is good.

**Answer** with one fenced JSON block and nothing after it, in exactly this shape:

```json
{
  "mode": "{MODE}",
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
```

`ranking` is best first; each inner list is a tier of tied candidates; all four labels appear exactly
once. All eight articles must be present. `viewedPictures` is whether you actually looked at the
images (false if you could not, or if this mode has none).
