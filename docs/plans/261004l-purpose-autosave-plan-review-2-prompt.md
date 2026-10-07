# Review, round 2: the revised plan for the add page's autosaving purpose box

Repo: this worktree. Read-only. Do not change any file.

## The candidate

Live pre-commit, untracked: docs/plans/261004l-the-add-page-purpose-box-saves-as-you-type.md (revised since your round 1, which is docs/plans/261004l-purpose-autosave-plan-review-sol.md).

## Previous findings

| ID | Disposition | What changed |
|----|-------------|--------------|
| F1 | overruled, Opus arbitrated | guarantee restated: ordered while the page is alive, best effort in teardown; reported to the owner as a follow-up for all four boxes. Do not re-argue; say only whether the restated guarantee is accurate. |
| F2 | accepted | idle timer keyed on text and inFlight; ProfileBox takes inFlight |
| F3 | accepted | no reset(); a renderless session component keyed by source+slug owns the hook, so retiring is the hook's unmount path |
| F4 | accepted | same key; only reader-typed words carry to the next session |
| F5 | accepted | fresh, explicit purposeFailed:false, not an offline copy |
| F6 | first half accepted, second overruled (Opus) | warning covers unseeded typed words and in-flight writes; no navigation blocking; status line says "if you stay on this page" |
| F7 | accepted | one request at a time, 10 s deadline, 300 tries a run, fresh run on Retry |
| F8 | accepted | sentences rewritten |

Treat the revision as unreviewed. Spend the run on what changed: design sections 1 to 6 and "What this does not fix".

## The questions, each with a floor

1. Is each statement in the revised plan accurate against the code (src/web/useAutosavedText.ts, src/web/AddPage.tsx, src/web/ProfileBox.tsx, src/web/lib/api.ts, src/jobs.ts slugForRetry)? In particular: does the hook's unmount path really send the old session's latest text to the old slug after a write in flight, when the session is a keyed child that unmounts while the page stays?
2. The textarea lives in the parent and the hook in a renderless keyed child. Name any concrete scenario where the parent's text and the child's draft disagree in a way that loses or misdirects words (StrictMode, the seed adopting a stored value, the server's normalised answer, a slug arriving mid-keystroke, completion landing in the same tick as a save).
3. Any sentence in section 6 still false on a reachable path.

New findings are numbered from F9. Same scale as before (P0 to P3, established or reasoned), each with (a) the scenario and (b) replacement wording. End with BUILD / BUILD WITH CHANGES / DO NOT BUILD; refuse only on an established P0 or P1.
