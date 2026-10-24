# Plan review: a multi-page article imports from its first page (261024p)

You are reviewing a **plan**, before stages 2–4 are built, for Spideryarn, a reading app (TypeScript,
Node, Postgres). Read-only: do not change any file.

## The candidate

Worktree `/var/tmp/spideryarn-worktrees/fbqkyukr-multi-page-import`, branch
`worktree-fbqkyukr-multi-page-import`. The candidate is commit `<SHA>` on top of `origin/dev`
(`git show --stat <SHA>`). Start with, but do not limit yourself to:

- `docs/plans/261024p-a-multi-page-article-imports-from-its-first-page.md` — the plan. **Read it as a
  reviewer of its conclusions and its design, not only of its wording.**
- `src/multi-page.ts` — the judge, already built: link harvesting, prompt, answer parsing.
- `tests/multi-page.test.ts` — its tests (`npx vitest run tests/multi-page.test.ts` needs nothing
  outside the tree; run it).
- `evals/multi-page/run.ts`, `evals/multi-page/gold.json`, and the results under
  `evals/multi-page/results/` — the measurement the plan quotes.
- `docs/investigations/261024c-multi-page-articles-readability-and-a-cheap-judge.md` — the write-up.

The code the plan will change, to read for whether the design fits it:
`src/pipeline.ts` (`STEPS.fetch`, `STEPS.extract`, `fetchByAddress`), `src/fetch.ts` (`RawManifest`,
`writeRaw`, `ConvertedHtml`, `writeConvertedRaw`, `readRawBytes`, `fetchDocument`'s guard),
`src/extract.ts` (`readArticle`, `runExtract`, `debugPage`), `src/notes.ts`, `src/reserved.ts`,
`src/store/artifacts-pg.ts` (how a manifest is persisted), and the docs
`docs/project/fetching.md`, `docs/project/content-extraction.md`, `docs/project/security.md`
§ "A fourth: what the model asks us to fetch", `docs/project/block-ids.md`.

## What it is for

Greg (the owner) filed this: pasting the front page of a piece split across several pages
(https://superdark.antikythera.org/ — a 2,200-character abstract and three chapter pages) should
import the whole piece, with no question to the reader, using a cheap model on every web import.
He set the budget at under a cent a page.

## The questions

1. **The storage design.** One stored HTML document of all the pages plus a `parts` list in the
   manifest (a `text[]` column), against one stored object per page. Is the one-document design
   sound against every reader of the raw source? Find a reader of the stored raw document that would
   break or mislead with it. Is the column really what makes the split trusted, and is the split
   check strong enough?
2. **Stage 2's join.** Per-part `readArticle`, a heading per part, ids namespaced. What breaks in
   stage 3 (block splitting and id preservation), in footnotes (`src/notes.ts`), in Structure, or
   in the reading view, when one article is several Readability outputs joined? Is there a simpler
   join?
3. **Security.** The model picks link ids, not URLs; same host (`www.` aside); `fetchDocument` for
   every fetch; at most 20 pages. What does a hostile page gain? Is "same host" the right boundary?
4. **The measurement.** Do the eval and its gold support the plan's claims (decision accuracy, cost,
   latency)? Is any gold label wrong, or any claim stronger than the rows behind it? Is the
   prompt overfitted to this corpus?
5. **Scope.** Is there a smaller version that gets most of the value, or a part of this that should
   not be built?

Grade every finding P0–P3 and give it an id (F1, F2, …):

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

An *established* finding has direct evidence (a source path you can name, a test you ran); a
*reasoned* one rests on an inference — say which.

## My own suspicions (worth less than yours; spend most of the run elsewhere)

- Stage 2's join may be where this goes wrong: several `section[data-spya-notes]` containers, author
  anchors colliding, and a heading of ours that stage 3 turns into a block.
- `readArticle` runs twice on page 1 (stage 1 to judge, stage 2 to extract); is that acceptable or a
  sign the judge belongs in stage 2?
- The one sentence I would least like to be wrong about: *"One document keeps every one of them
  working unchanged."*

Write your answer as markdown: findings first, most severe first, then anything else.
