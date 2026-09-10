# Proposals: reaching agents with the work-report convention (plan 260910e)

Plan [260910e](260910e-work-reports-and-decisions-a-small-event-vocabulary.md) builds the machinery — the
`overseer report` command, the daemon's reports log, and the Claims section on the Decisions tab. What
makes agents actually use it lives in three places that are not this session's to edit. These are the
proposed words, for the Overseer to adopt, and for Greg where the change is his. Until one of them lands,
the state is **reporting machinery complete; convention not activated**.

Each proposal is shown as it would read, and every one of them is optional: a session that never reports
shows as *unreported*, which is honest, not an error.

## 1. A paragraph for the Overseer's dispatch briefs (the Overseer's call)

Proposed addition to the "How to run this" block the Overseer appends to every dispatch brief:

> - **Report as you go, as claims.** At the end of each stage, and whenever you are blocked on somebody
>   else, run `npx tsx scripts/overseer.ts report <progress|blocked|completed> --summary "<one line>"`
>   with `--artefact commit:<sha>` / `--artefact path:<file>` for what you produced and `--plan <your plan
>   path>`. When you finish, `report completed --ending finished|done-enough|important-work-left`, naming
>   the revisions you actually reviewed, tested or merged with `--reviewed/--tested/--merged <sha>` — leave
>   out any you did not do; absence reads as "not stated", never as a failure. A decision you took that
>   outlives the branch goes in with `report decision --file <json>` (`overseer-decisions template` shows
>   the fields). A report is a claim Greg can check against its artefacts; it grants nothing, and your
>   debrief message is still the debrief.

Why here first: the roadmap says controlled jobs first, and the Overseer's briefs are the one launch
prompt changed without a re-pin.

## 2. The standing jobs' prompts (Greg's call: a re-pin)

`GET_READY_TO_DEPLOY_PROMPT` and `FEEDBACK_SWEEP_PROMPT` in `tools/overseer/standing-jobs.ts` are pinned
by hash, so a changed prompt stops the job dispatching until Greg re-pins it — by design. Proposed
suffix for both, one sentence:

> When you finish, record it with `npx tsx scripts/overseer.ts report completed --ending <finished|done-enough|important-work-left> --summary "<one line>"`, naming any commit you produced with `--artefact commit:<sha>`.

Computed 2026-09-10 with `behaviourHash` over each job's current behaviour, its `what` joined to the
suffix above by one space (a scratch script; `npx tsx scripts/overseer-pins.ts` prints the same numbers
once the prompt is edited):

| job | pinned today | with the suffix |
|---|---|---|
| `get-ready-to-deploy` | `c5c7f9f93886` | `c2ceaf3a3320` |
| `feedback-sweep` | `c921a5c4b732` | `561541e1b3d1` |

Recomputed after merging the schedule-preview work, which re-pinned both jobs (the first figures,
`d37ae432708c` → `481a81083786` and `eb76b675c2ce` → `8780d37d3a4c`, are stale). The dry-run
`schedule-fixture` job needs no suffix: it starts no session that could report.

A different wording gives different hashes; re-run `overseer-pins.ts` after editing the prompt rather
than copying these. Nothing is re-pinned by this session.

## 3. AGENTS.md (Greg's before/after edit — not needed for the first delivery)

Only if the convention proves useful across uncontrolled sessions too. A candidate, deliberately not
mandatory:

> - **Say what you claim, where Greg can check it.** `npx tsx scripts/overseer.ts report …` records
>   progress, a block, a decision or completion as a claim with links to its artefacts
>   ([work-reports.md](../project/work-reports.md) — written from AGENTS.md itself, the link
>   target would be `docs/project/work-reports.md`). Optional; an unreported session is shown as
>   unreported, not as failing.

Sol's plan review (WR-P7) judged a mandatory rule unnecessary for the first delivery; I agree.
