# Plan review: reset and regenerate an article (260928a)

You are reviewing a **plan**, read-only. Repo root is the current directory (a git worktree of the
spideryarn2 repo, branch based on dev at the commit you are sitting on). The candidate is one
untracked file: `docs/plans/260928a-reset-and-regenerate-article.md`. Read it first, then read the
code it cites to check its claims. Start with, but do not limit yourself to: `src/jobs.ts`
(`enqueue`, `cascadeForce`, `retryJob`, claim ordering), `src/store/jobs.ts` (`workKeyFor`),
`src/store/pg-revisions.ts` (`REVISION_CARRY_POLICY`, `beginDraftIn`, `openOrBeginJobDraft`),
`src/store/artifacts-pg.ts` (`STORAGE`), `src/pipeline.ts` (`DEFAULT_INGEST_STEPS`,
`FORCE_ONLY_WHEN_NAMED`, `stepIsDone`, the extract and fetch steps), `src/store/pg-successor.ts`
(the labels successor), `src/billing/admission.ts`, `src/web/Metadata.tsx`, `src/rerun-steps.ts`,
`src/db/schema.ts` (`jobs`, `comments`, `reading_time`, `block_identities`, `glossary_lookups`,
`citation_finds`), and docs `docs/project/ingest-queue.md`, `docs/project/block-ids.md`.

Greg's ask, verbatim: "add a reset-and-regenerate button in the lower part of Metadata mode
(perhaps the default is just to reset as if it had just been imported for the first time, and
there's an option to regenerate any extra stuff that had been generated for the article with a
queue)". Hard constraint: reader-written data (comments, highlights, notes, reading time) must
survive, and block ids must be preserved the way re-extraction preserves them.

## What to do

An independent attack on the plan. In particular: is each factual claim about the code true? Will
the design, built as written, do what it says — i.e. publish a revision equivalent to a fresh
import of the stored copy, with the extras gone, and (with regenerate) remake them one after
another? Is there a simpler design that gets the same result? Anything that would lose or detach
reader data that the plan does not name? Anything that would charge a billing slot or spend
money the plan does not name? Anything the job machinery (dedupe `work_key`, retry, the
successor/labels job, draft sweep, the publication guard `reasonsNotToPublish`) would do to
this that the plan misses?

## Severity scale

P0 data loss, exploitable security, incorrect charging, or broadly unusable. P1 user-visible wrong
behaviour, or an authoritative contract violated. P2 design/maintainability risk, no wrong
behaviour today. P3 prose. Refuse only on an established P0/P1 (direct evidence: an exact reachable
source path, or a contract the plan contradicts). Give every finding an ID F1, F2, … with file:line
evidence.

## My own suspicions (worth less; spend most of the run elsewhere)

- Does a forced `extract` with `fetch` in the steps list really skip `fetch` and re-read the stored
  raw source, for both a URL article and an uploaded PDF?
- Does minting the draft happen before any step runs, so nulling there is safe; and are there
  other places that copy step-run rows or artefacts back into a draft (e.g. a reopened draft after
  a lease expiry, or a retry) that would undo the drop?
- Are queued jobs on one slug claimed in created_at order, so the regenerate jobs really run after
  the reset?
- Will unforced regenerate jobs run on a reset revision, or will something (e.g. `stepIsDone`
  falling back to an `isDone` that looks at something else) treat them as done?

End with a verdict: approve / approve with changes / refuse, and the list of IDs.
