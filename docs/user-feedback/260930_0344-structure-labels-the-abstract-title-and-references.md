---
reports: spya-abs6bj
ending: shipped
---
# Structure labels the abstract, the title and the references instead of summarising them

Report `spya-abs6bj`, a suggestion from Greg (admin; `scripts/feedback-reporter.ts` exited 0),
2026-09-30 03:44 UTC, sent from Summary on `pmc13013618-spya-uekgh6` at Sections depth. Overseer
queue item `qi-ta8cqa26`.

> Make a minor tweak to the prompt for generating the summary mode to sort of skip or be very
> minimal for kind of non-content sections like, I don't know, title or abstract or references or
> acknowledgments. Like, I think maybe they don't need a summary at all, or maybe it's just very
> brief because we want the summary text to focus on kind of substantive content.
>
> — Greg, 2026-09-30

**Ending: Shipped** to `dev`. The plan and both GPT Sol reviews are in
[261003c](../plans/261003c-summary-and-structure-skip-the-front-matter.md); the measurement is in
[261003a](../investigations/261003a-summary-and-structure-skip-the-front-matter-prompt-eval.md).

What changed, in plain words:

- **When he wrote this, Summary was the per-section outline.** Since 2026-10-01 that outline is
  only in Structure, so Structure is where this landed. Acknowledgements were already left out by
  [261001_1134](261001_1134-summaries-skip-the-paperwork-and-brief-gets-shorter.md).
- **The abstract gets a label, not a summary.** A Structure node that covers only the front
  abstract (with any title and author lines) now reads *"The authors' summary of the paper."* and
  asks no question. Before, it restated the paper's main claim, which the root line just above it
  already says. A closing Summary or Conclusions section keeps its claim. This took Greg's "no
  summary at all" rather than "very brief". The fallback, one short sentence, was not needed.
- **The title block and the reference list are named as paperwork** in the shared rule that
  Summary, Tweets and Structure all use. The model was mostly labelling them already; now the
  prompt says so.
- **Measured** on four local papers. Abstract nodes with a question went from 2–3 per run to 0,
  and with a restating gist from 4–6 to 0. Nothing substantive was lost.

Deferred:

- Stripping front matter before any model sees it.
- Pointing Summary paragraphs at the body rather than the abstract. About one in four rest on the
  abstract, which is a fair use of it.

Existing trees are unchanged until regenerated, including the one on the article he sent this
from.
