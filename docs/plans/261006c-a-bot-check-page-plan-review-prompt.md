# Review: the plan to refuse an Anubis bot-check page in stage 2 by its own markup

Repo: this worktree, branch `worktree-qi-ptvjnvdm-bot-check-page` off `dev`. TypeScript, ESM. This
is a **plan review, read-only**: change no file. Nothing is built yet.

## The candidate

Live, uncommitted. Untracked files:

- `docs/plans/261006c-a-bot-check-page-is-refused-by-its-own-markup.md` — the plan. Read it first.
- `evals/extraction/fixtures/hal_anubis.html` — the real page (12.6 KB), the evidence.

Context the plan rests on (read as needed, this does not limit scope):

- `docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md` § C1 and § C1a (search
  "C1 — the bot wall") — the earlier decision this builds.
- `src/extract.ts` — `readArticle`, `readingArm`, `readArticleWithProvenance`, `provenanceArm`,
  `capabilityFloor`, `runExtract`, the two error classes.
- `src/pipeline.ts` around `err instanceof ReadabilityRefused`.
- `src/messages.ts` § `documentHasNoArticle`, `documentHadTooLittleText`; `docs/project/copy.md`.
- `evals/extraction/arms.mts` (`refused`, `floorSuspended`), `evals/extraction/manifest.mts`
  (`notAnArticle`), `evals/extraction/corpus.mts` (`EXTRA_FIXTURES`).
- `tests/extract-capability-floor.test.ts` — the pattern the new test copies.
- `docs/project/content-extraction.md` § "The two ways this stage refuses".

## What I want

An independent attack on the plan before any of it is built. In particular, whether these
statements in it are **accurate**:

1. "A real `<script id="anubis_challenge" type="application/json">` element whose text parses as a
   JSON object" is conclusive: no genuine article reaches stage 2 carrying it.
2. Running the recogniser on the source document before `prepareDocument`, in one place both read
   paths share, is achievable in `src/extract.ts` as it stands without the two paths diverging.
3. The counterfactual (same bytes minus the one script element come back as an article over the
   floor) proves the refusal is the recogniser's.
4. Nothing else in the tree needs to hear about a third refusal type that the plan does not name
   (search for consumers of `TooLittleTextToRead`, `refusal`, the `jb-` code registries, the
   eval harness, any exhaustive switch).

You may run one test file that needs nothing outside the tree, for example
`npx vitest run tests/extract-capability-floor.test.ts`, or a `npx tsx -e` one-liner that calls
`readArticle` on the fixture. You have no network and no Postgres.

## Severity and IDs

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse the plan only on an **established** P0 or P1 (direct evidence, no unresolved inference);
mark the rest *reasoned*. Give every finding an ID `F1`, `F2`, …. End with a one-line verdict:
`VERDICT: build it` or `VERDICT: change first`, and the shortest list of changes.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The two draft reader sentences: is "save it as a PDF or a web page and upload that file" true of
  what the app's upload accepts, and do they break a rule in copy.md?
- Whether "wins over `ReadabilityRefused`" is worth the reorder in `runExtract`, or whether it
  complicates `readArticle`'s contract (`article` null with a non-null `refusal`).
- Whether requiring the JSON to parse is too strict (a future Anubis version) or pointless.
- The redacted IP makes the fixture not byte-identical to what was served; `verify.mts --refetch`
  would report drift anyway since the challenge is per-request.
