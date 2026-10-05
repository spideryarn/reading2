# Review request: the read-while-importing spike and its write-up

You are reviewing an investigation write-up and the spike code behind it. Read-only: change nothing.

**The box is overloaded. Do not run tests, typecheck, a build, a dev server, a browser, or any
import.** Read files and `git` output only.

## What to read

1. The write-up:
   `docs/investigations/261005b-read-while-importing-draft-prose-on-the-add-page-spiked.md`
2. The investigation that raised the question:
   `docs/investigations/261004e-open-the-article-before-structure-and-assets-where-the-import-s-time-goes-and-what-deferring-costs.md`
3. The spike code, which is the diff `git diff d86797d6f HEAD -- src tests` in this worktree. The
   files: `src/store/pg-job-draft.ts`, `src/web/DraftProse.tsx`, `src/web/AddPage.tsx` (the parts
   naming `draftIsReadable`, `draftOf`, `handOverHref`), the new row in `src/routes.ts`
   (`/api/jobs/:id/draft`), `tests/draft-prose.test.ts`, `tests/job-draft-read.test.ts`.
4. `docs/project/security-map.md`, and `src/web/rehost.ts` and `src/web/sanitize.ts` for the path
   the reading view uses on a stranger's HTML.

## The evidence the write-up stands on

- Server rows for the spike's imports (job created, `structure` call start, job finished; all UTC,
  2026-10-05), from `spideryarn.jobs` and `spideryarn.ai_calls` on the local database:

  | Slug | Job created | `structure` call start | Job finished |
  |---|---|---|---|
  | difference-engine-spya-qcb46k | 16:31:08.7 | 16:31:16.9 | 16:32:13.3 |
  | analytical-engine-spya-cnkcmj | 16:32:20.5 | 16:32:27.7 | 16:32:58.3 |
  | punched-card-spya-quks9b | 16:37:48.2 | 16:37:57.3 | 16:39:02.0 |
  | charles-babbage-spya-bezqyd | 16:43:00.7 | 16:43:18.8 | 16:43:59.8 |
  | ada-lovelace-spya-hrsbga | 16:45:52.5 | 16:46:15.8 | 16:47:15.3 |
  | herman-hollerith-spya-g2psut | 16:50:58.1 | 16:51:09.9 | 16:51:28.6 |
  | arxiv-1706-spya-hxcnz0 (PDF) | 16:57:45.9 | 17:00:07.3 (last `extract` call ended 16:59:56.2; `structure` call ended 17:00:41.0) | 17:03:46.6 |

- Spend, summed from `ai_calls` for those slugs (credits + byok + computed, nano-dollars / 1e9):
  0.0929, 0.0499, 0.0539, 0.0466, 0.1037, 0.0829, 0.0893, 0.1387, 0.0514, 0.1064, 0.1177, 0.0476,
  0.0352, 0.0295, 0.0204, 0.0599, 0.0716, 0.0057, 0.0720. One more `structure` call was refused and
  unpriced.
- A browser agent (Playwright) reported, for web imports only: prose drawn 1 to 10 s after the
  `blocks` step showed done; no request to a non-localhost host before the hand-over; inside the
  draft 20 `<img>` and 0 with `src`, 0 `<iframe>`, 0 `<script>`, 0 `on*` attributes; the draft's
  first block at 857 px in a 900 px window; in both scrolled runs the final address was
  `/read/<slug>?mode=summary&margin=1` with no `at=` and the reading view at the top.
- The box's load average was 70 to 180 throughout. No PDF was watched in a browser. The latch in
  `AddPage.tsx` (`draftOf`) was written after those runs and has not been run.
  `tests/job-draft-read.test.ts` has never run.

## What I want from you

1. **Check the conclusion, not only the prose.** Does the recommendation follow from the evidence?
   Is anything stated as measured that was only inferred, or stated more strongly than the evidence
   allows? Check my arithmetic in the tables and the spend against the rows above.
2. **The hand-over bug.** I guessed the cause (the prose unmounting when the job is briefly missing
   from a poll, the page collapsing, the scroll resetting). Read `AddPage.tsx`, `jobEngine.ts`,
   `useJobs.ts`, `router.ts` (`navigate`) and `src/web/reader/useReadingPosition.ts` and tell me
   whether that is right, or what the real cause is. In particular: could `draftReadingPlace()`
   return null for another reason, and does anything strip `?at=` on arrival?
3. **Security.** Is there a way the draft path renders something the reading view would not, or
   reaches the publisher, or serves a draft to somebody who is not the job's owner? Look at the
   query in `pg-job-draft.ts`, at `rehostBlockHtml` with the `waiting` placement (does it cover
   `srcset`, `<source>`, `<video poster>`, CSS `background`, `<svg><image>`?), and at anything the
   reading view does to a block's HTML that `draftBlockHtml` skips.
4. **Is the code clean enough to land behind the Experimental switch** once the three owed checks
   pass, or should it stay off `dev`? Name what you would change first.
5. Anything in the write-up a reader who has not seen the code would not understand.

Answer with findings ranked P0 to P3, each with the file and line, and a one-paragraph verdict at
the top.
