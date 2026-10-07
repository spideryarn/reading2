# Review: a plan to make any arXiv link import the paper (HTML first, PDF fallback), through a resolver other sources can join

Repo: this worktree, branch `worktree-fbayettj-arxiv-import`. TypeScript + ESM, run with `tsx`. An
article is imported by a queue of steps: `fetch` (stage 1, `src/fetch.ts`), `extract` (stage 2:
Readability for a web page in `src/extract.ts`, a model reading pages for a PDF in
`src/pdf-read.ts`), `blocks`, and so on (`src/pipeline.ts`, `src/jobs.ts`).

## The candidate

Committed: commit `1459ef9d3`.
`git show --stat 1459ef9d3` lists the paths. The plan is
`docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md`.
The eval it rests on is `docs/investigations/261005e-arxiv-html-rendering-against-its-pdf-through-our-pipeline.md`,
its harness `evals/arxiv-html-vs-pdf/run.ts`, its numbers
`evals/results/arxiv-html-vs-pdf-261005/results.json`.

Start with the plan and the investigation. That is where to begin, not the limit: the plan makes
claims about `src/ingest.ts` (`normaliseUrl`, `urlKey`, `slugFromUrl`), `src/routes.ts`
(`parseJobRequest`), `src/pipeline.ts` (the `fetch` and `extract` steps, `requireUrl`),
`src/jobs.ts` (how `urlKey` decides "already on the shelf" and "same work"), `src/extract.ts`
(`runExtract`, `readArticle`, `prepareDocument`), `src/maths-import.ts`, `src/protect.ts`,
`src/cited-in-spideryarn.ts` (`identityOf`), `src/paper-text.ts` (`arxivPdfUrl`),
`src/collect-assets.ts` and `src/assets.ts`, and the docs `docs/project/fetching.md`,
`docs/project/security-map.md`, `docs/project/content-extraction.md`. Check them against the code.

## What it is meant to do

The request (an administrator's feedback report, quoted in the plan's § Goal): pasting an arXiv
link of any shape should import the paper, not arXiv's abstract page; an eval should decide HTML or
PDF; correct first, then cheap and quick. This plan is part 1 of 2: arXiv only. A second session
adds other paper sources to the same mechanism, so the mechanism must take a second source without
rework.

Hard limits the plan must stay inside:

- The fetcher's SSRF and address checks, and everything in `docs/project/security-map.md` § Where
  the defences physically live, are defences. The resolved address must go through the existing
  fetch path unchanged. If the plan needs an edit to a defence, that is a finding.
- No new outside service. No write to production data. No deploy.
- One contract that matters: block ids (`docs/project/block-ids.md`). A re-extraction that changes
  a block's text mints a new id for it.

## What you can and cannot run, and what you may change

The tree is read-only. `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and build a
throwaway harness under `/tmp`. You have no network, not even loopback, so you cannot fetch arXiv
or reach Postgres. The eval's extracted pages are not in the tree (gitignored); its numbers are.

## Attack it

Independently, before you read my questions at the end. The statements to test:

1. *"Every shape of arXiv link resolves to one article identity, and nothing that is not an arXiv
   paper link is changed."* Find a link shape that resolves wrongly, a non-arXiv address that is
   captured, or two different texts merged into one article.
2. *"The fetch step tries the candidates in order through `fetchDocument` unchanged, and no defence
   is edited or weakened."* Find a way the candidate loop changes what a defence sees, hides a
   failure the reader should be told about, spends money twice, or misbehaves on Stop, retry,
   refresh (`force`), an upload, or a job that already has a stored manifest.
3. *"`meta.url` is the article's address and the extract step's base is the manifest's final URL."*
   Find what else reads `ctx.url`, `meta.url`, the manifest's `url` or `requestedUrl` and would now
   get a different answer: dedup, `urlForSlug`, retry, the source link, the article registry and
   Crossref/DataCite lookup, link previews, cited-in-Spideryarn, export/import, the backfill.
4. *"A second source is one more object in `SOURCES`."* Find what a second source (say bioRxiv, or a
   DOI that redirects to a publisher) would need that this shape cannot express.
5. *"The four LaTeXML fixes leave any page whose shape does not match exactly as it was."* Find the
   way each could delete or corrupt authored content, break a cross-reference target, or change the
   extraction of a non-LaTeXML page; and whether fix 2 (an SVG in an `<object>` becoming an
   `<img>`) walks into a defence in the asset pipeline.
6. The eval's conclusion (HTML first). Is it supported by the numbers and the method in 261005e, or
   does the write-up claim more than it measured? Is the stage order (resolver lands before the
   four fixes) defensible?

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the authoritative contract it
        contradicts, with the file and symbol
  - (b) the smallest change to the plan that closes it, as exact replacement wording
A finding with no (a) goes last.

Severity, by consequence: **P0** data loss, exploitable security, incorrect charging, or the
service broadly unusable. **P1** user-visible wrong behaviour, or an authoritative contract
violated. **P2** design or maintainability risk with no wrong behaviour today. **P3**
non-behavioural prose defect.

Refuse only on an established P0 or P1, and name what established it. End with a one-line verdict:
`VERDICT: build it` / `VERDICT: build it after fixing <IDs>` / `VERDICT: do not build`.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- Whether `urlKey` resolving through the paper source can make a job's stored `urlKey` disagree
  with one computed before this change, in a way that matters for a job in flight at deploy.
- Whether accepting the *last* candidate "exactly as a pasted address is today" is right when the
  PDF address serves an HTML error page.
- Whether passing the manifest's final URL as the extract base changes anything for an article
  whose manifest predates the field, or for a re-extraction that reads `urlForSlug`.
- Whether an aligned equation rebuilt with `&` between cells is right for every LaTeXML alignment
  shape (`align`, `eqnarray`, `gather`, `multline`, `split`), or whether cells should be joined
  without `&` when the row has one formula cell.

Do not change any file.
