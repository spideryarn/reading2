# Plan review: a landing-page link imports the paper (the other paper sources)

You are reviewing a **plan and the research it rests on**, read-only. Nothing is built. Change no file.

## The candidate

Commit `016a63565` in this worktree (`/var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources`). Its paths:

- `docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md` — the plan. Start here.
- `docs/research/261005e-where-a-reader-s-paper-link-points-the-other-sources-measured-and-ranked.md` — the ranking it rests on.
- `docs/research/261005e-where-a-reader-s-paper-link-points-raw-notes.md` — a subagent's web-research notes (each fact marked CHK / SRC / MEM).
- `evals/paper-sources/landing-vs-paper.ts`, `cases.json`, `host-census.mjs` — the scripts that produced the numbers.
- `evals/results/paper-sources-261005/summary.md`, `results.json` — the raw measurement (174 addresses through our real `fetchDocument` and stage-2 extraction).

That list is where to start, not a limit on scope.

**The mechanism this plan builds on is not in this tree.** It is part 1 of the same report, committed in a sibling worktree and not yet on `dev`: commit `0f63486a2`. The object is in this repository, so `git show 0f63486a2:src/paper-sources.ts`, `git show 0f63486a2:src/pipeline.ts`, `git show 0f63486a2 -- src/ingest.ts` and `git show 0f63486a2:docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md` all work. Its own code review found F14–F16 (in `enqueue`, and an over-long slug); assume those get fixed without changing `PaperSource`, `ResolvedPaper` or `fetchFirstCandidate`'s rules.

Read too: `docs/project/fetching.md`, `docs/project/ingest-queue.md`, `docs/project/security-map.md`, `src/fetch.ts`, `src/ingest.ts` (`urlKey`, `slugFromUrl`, `isSlug`), `src/paper-text.ts` (it already follows `citation_pdf_url` once, for a different caller).

## What I want from you

An independent attack on the plan first. In particular:

1. **Is the ranking right, and is the cut between "worth code now", "deferred" and "do nothing" right?** Check the claims in 261005e against `summary.md`/`results.json` and the raw notes: anything the write-up states that the measurement does not show, anything measured that the write-up left out, any source ranked on a memory-only fact. Is nine sources too many for "the top few, simplest first"? Which would you cut or add?
2. **Design A** (static sources as objects in part 1's registry): will each row in the table actually work against part 1's code as committed? Trace `urlKey`, `slugFromUrl`, `isSlug` (60 characters), `fetchFirstCandidate` (`saysItIsNotThere`, `isWhatItPromised`), `fetchDetail`. Is "the landing page is the last candidate" sound, given the loop only moves on for 404/410 or a wrong kind? What happens to an article's identity when the landing page is what got stored (its `final_url`, a later refresh, a later paste of the PDF address)? Is resolving a Hugging Face link to a value deep-equal to arXiv's safe everywhere `resolvePaperSource`/`urlKey` is called (shelf lookup, hover card, `link-facts`, `identityOf`)?
3. **Design B** (re-resolve the fetched document's final address once): correctness, charging, identity, and anything in `enqueue` or the job's stored keys that it breaks. Is "once" actually enforced by the described shape? Is there any security consequence of letting a redirect's destination choose a paper source (every request still goes through `fetchDocument`; candidates are fixed strings on the source's own host)?
4. **The limits I was given**: nothing that needs a new outside service or key, a login, or getting round a paywall, bot wall or robots rule; no edit to the fetcher's SSRF/address checks or anything in security-map.md § Where the defences physically live; every resolved URL through the existing fetch path unchanged. Does anything in the plan cross one of those? (OSF's `/download/` route and bioRxiv's `.full.pdf` are the two I would look at.)
5. **What is deferred**: is anything deferred that is cheap enough to do now, or anything planned that should be deferred? Is "for Greg" (PubMed/PMC) the right call?
6. Anything the plan gets wrong about the cost to the reader (a free HTML import becoming a paid PDF read).

## Severity, and the form of a finding

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an id (`G1`, `G2`, …), its severity, whether it is *established* (you traced it in code or data) or *suspected*, the concrete sequence or input that shows it, and the smallest credible fix. You have no network; do not try to fetch anything.

End with one line: `VERDICT: build it` / `VERDICT: build it after fixing G…` / `VERDICT: do not build`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The landing-page-last candidate makes `urlKey` say "same article" for a stub and for the paper. A reader who got the stub and later pastes the PDF link is told they already have it.
- NeurIPS and PMLR grammars are learned from two papers each.
- Stage B re-fetches the landing page in the fallback case and may double-count something.
- Nine sources in one stage may be a lot for one review to hold.
