# Plan review: widen the Anubis bot-check entry to the older page

Repo: this worktree (branch `worktree-bot-check-walls` off `dev`). TypeScript, ESM, vitest. A
read-only review of a plan before anything is built.

## The candidate (live, not committed)

Base: `675554b51`. Untracked files, all of them part of the candidate:

- `docs/plans/261006f-other-bot-check-walls-that-clear-the-floor.md` (the plan)
- `docs/investigations/261006c-which-bot-check-walls-clear-the-floor-through-our-fetcher.md` (the
  measurement; read it as a reviewer of its conclusions, not only of the plan)
- `scripts/probes/261006f-bot-wall-probe.ts` (the script that produced the numbers)
- `evals/extraction/fixtures/winehq_anubis.html` (the captured page)

Context that exists already: `src/challenge-page.ts`, `tests/extract-challenge-page.test.ts`,
`evals/extraction/fixtures/hal_anubis.html`,
`docs/plans/261006c-a-bot-check-page-is-refused-by-its-own-markup.md`, `src/extract.ts`
(`readingArm`, `provenanceArm`, `capabilityFloor`).

## What I want

An independent attack on the plan first. You can run anything that needs nothing outside the tree.
In particular: parse both Anubis fixtures with jsdom and try the proposed rule against **every**
fixture in `evals/extraction/fixtures/` to see whether any real article would match the new branch.
Please do that and report what you ran and what it printed.

Then answer:

1. Is the proposed second shape (`script#anubis_version` holding a JSON string **and** a module
   script whose resolved path ends `/.within.website/x/cmd/anubis/static/js/main.mjs`) sound as
   machine-readable evidence that the page is an Anubis challenge? What real page would it wrongly
   refuse, and what Anubis challenge page would it still miss?
2. Is the conclusion *"no Cloudflare, reCAPTCHA or enable-JavaScript entry is warranted"* supported
   by the measurement, or is it explaining away a gap?
3. Is joining the eval corpus worth its churn for a second Anubis page, or should the fixture
   serve the test only?
4. Anything the plan's list of consumers misses.

## Severity and IDs

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Say for each finding whether it is **established** (direct evidence) or **reasoned**. Number the
findings `F1`, `F2`, … End with a one-line verdict: *build as written* / *change first* / *do not
build*.

Do not change any file. Never attribute words to Greg that are not already in the repo verbatim.

## My own suspicions (already mine; spend most of the run elsewhere)

- Whether Anubis's non-challenge pages (its error or deny page) also load `main.mjs`, which would
  make the *"this is a challenge"* half weaker than the plan says.
- Whether resolving `src` needs a base URL when the document has no address (an uploaded copy), and
  what the rule should do then.
