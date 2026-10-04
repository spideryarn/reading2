# Plan review: 261004b, Summary's Fuller level grows, and bold and bullets arrive as two fields

You are reviewing a plan, read-only. Do not edit files. Repo is TypeScript/ESM; this is a git
worktree on branch `worktree-fbazft06-summary-fuller-and-markdown`, base `0531fb7f`.

Read `docs/plans/261004b-summary-fuller-longer-and-bold-and-bullets.md` first, then what it cites:

- `src/simple-summary.ts` (`PITCH`, `simpleSystem`, `systemTail`, `SIMPLE_SUMMARY_OUTPUT_SCHEMA`,
  `ANSWER_TOKENS`, `toParagraphs`, `keptSentences`, `buildLevel`)
- `src/types.ts` (`SimpleParagraph`, `SimpleSentence`, `usableSentences`, `SIMPLE_LIMITS`,
  `isSimpleParagraphs`, `isUsableSimpleSummary`)
- `src/public/dto.ts` § `publicSimpleSummary`, `src/public-types.ts` § `PublicSimpleSummary`
- `src/simple-check.ts` (the fidelity guard, which reads each paragraph's `text`)
- `src/web/SimplePanel.tsx` § `Paragraph`, `src/web/BlockRef.tsx`, `src/web/on-screen.ts`
- `docs/project/summaries.md`, `docs/project/prompting-guide.md` (§ What the model writes back,
  § Measuring a prompt change), `docs/project/security.md` where it concerns model output
- `evals/simple/probe.ts`, and the before arm in `evals/results/simple/high-none-fbazb{1,2}/`

Do an independent pass first. Grade findings P0 (data loss, exploitable security, wrong charging,
service unusable), P1 (user-visible wrong behaviour, or an authoritative contract violated), P2
(design or maintainability risk), P3 (prose). Give every finding an ID, F1, F2, …, with file:line
references, say whether each is established (direct evidence) or reasoned, and end with a one-line
verdict.

Then these, which are my own suspicions and worth less:

1. Is the plan's reading of the two requests right? Anything asked for and unmet, or built and not
   asked for?
2. Two structured fields (`key`, `list`) rather than Markdown in `text`: is the reasoning accurate?
   Is there a simpler design that keeps per-sentence links, `usableSentences`' exact-rejoin rule and
   the fidelity guard's input unchanged?
3. Does anything that reads a stored or public summary break on the new limits or fields: a Fuller
   of 8 paragraphs and 800 words, an old row with neither field, a row with a `key` that is not a
   substring, `list: true` with two sentences? Check every reader of `SIMPLE_LIMITS`,
   `isSimpleParagraphs` and `usableSentences`, the export, and any test that pins the shape.
4. The strict-schema rules in prompting-guide.md: are a required nullable `key` and a required
   boolean `list` right for the Anthropic subset as `validateAnthropicJsonSchema` enforces it? Is the
   `ARTICLE_OUTPUT_FORMAT` cache-key row affected (src/pipeline.ts)?
5. "The first sentence of a list paragraph is its lead-in": is that rule sound for the guard and for
   a reader, or is there a better deterministic rule?
6. Is the prompt-version-only bump right, and is it true that nothing marks stored summaries stale?
7. Is the measurement adequate and the ship rule falsifiable? What would you add or cut, keeping the
   paid runs to a few dollars?
