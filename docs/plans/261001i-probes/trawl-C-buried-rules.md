# Trawl C — rules buried in plans and postmortems

Read-only, 2026-10-01. Method: (1) grep of the 643 non-review plans named `2609*`/`2610*` for Greg
blockquotes with *always / never / in general / going forwards*, for "goes to Greg" / "rule-bearing"
deferrals, and for pointers into a named doc, each checked against the doc it names; (2) every
postmortem's class line extracted; the 72 of 139 postmortems that no doc in `docs/project/`,
`docs/reusable/` or `AGENTS.md` links were read in three batches, and each rule grepped for in the
evergreen docs in 2–4 phrasings. Weakness: "not landed" means none of those phrasings matched, so a
doc may say the same thing in other words. The Greg-requested product rules from the last three
weeks (icon tooltips, shortcuts in tooltips, cost shown only to the admin, visitors see stored modes,
cost tracking for new AI work) **all did land**. What did not land is mostly agent-practice rules
from postmortems, plus two deferrals that were sent to Greg and never came back.

"Rule" = the change rewords a rule doc (`AGENTS.md`, an entry point, anything in `docs/reusable/`,
or a doc that its own plan calls rule-bearing or a hash pins), so it needs Greg's approval under
`docs/reusable/edit-important-docs.md`. "Knowledge" = a leaf in `docs/project/`, so no approval needed.

## Q1 — Rules that never reached their owning doc, ranked

1. **`url-state.md`'s opening rule is false, and the edit was sent to Greg and never came back.**
   `docs/plans/260902f-make-referee-mode-understandable.md` (around line 394): *"[url-state.md] is still
   not touched**, and it now owes two edits rather than one: `?refscale=` from stage 1, and its line 6
   — *"nothing lives in `localStorage`"* — which two features now break. Both go to Greg together"*.
   It still says *"nothing lives in `localStorage` — with one exception"*. In fact `referee-card.ts`,
   `shelf-hidden-columns.ts`, `auto-modes.ts`, the install hint, the small-screen hint and the mic
   placement code all use it, and two code comments (`src/web/SourceScanNotice.tsx:39`, the
   `RefereeMode.tsx` header) still say *"localStorage is banned"*. Four `useQueryState` params are
   missing from § The parameters: `refscale`, `crits`, `debatethread`, `event`. Owner:
   `docs/project/url-state.md` § opening paragraph and § The parameters. **Rule.**
2. **Greg's own sentence, in no evergreen doc.** `docs/postmortems/260903e-three-attempts-to-build-a-control-for-recorded-not-fixed.md`
   quotes Greg: *"A written-down defect with an unchanged default is a defect with a paper trail, not
   a mitigation."* Its companions are 260902e, *"that sentence is a work item, not documentation"*,
   and 260901a, *"leave the note **in the code**"*. Owner: `docs/reusable/written-down-is-not-checked.md`
   § What to actually do. **Rule.**
3. **"Paste the red message."** `docs/postmortems/260906e-a-guard-that-agreed-with-the-thing-it-was-watching.md`:
   *"a guard may not be committed until its author has pasted the red"* message it produces. This
   *"caught all nine"*. Line 161 of the same file admits that the doc *"does not say **paste the red
   message into the commit**. That is a doc edit for whoever next touches"* it. Owner:
   `docs/reusable/silent-success.md` § The habit. **Rule.**
4. **`feedback-reports.md` contradicts itself.** This is the leftover from
   `docs/plans/260930g-check-for-prior-work-before-building-a-feedback-report.md` § For Greg (whose
   main move did land). Line 220 says *"status write is the sweep's, not the report session's**,
   since 2026-09-11"*, but line 296 still says *"**Each session does its own bookkeeping** — its own
   note … and its own Sentry status write"*. Step 2 still says *"One `gjd-remote` session per
   report"*, and the plan says *"it's per queue entry since 2026-09-10"*. Owner:
   `docs/project/feedback-reports.md` § The run. It is a knowledge change, but **the doc is pinned by
   hash** (`AUTHORISED_DOCUMENTS` in `tools/overseer/standing-jobs.ts`), so it needs a re-pin and Greg.
5. **How to read what a model writes back.** There are four rules, and today they live only in
   postmortems and in `hierarchy.md` and `logging.md`:
   - 260903f: *"extract, but refuse to choose"*, and a permissive parser moves the failure *"from
     'rejects a good answer' to 'accepts the wrong one'"*.
   - 260906b: a conditional field needs *"'and no comma where you omit it'"*, or it should be made
     *"unconditional-and-nullable"*.
   - 260924a: *"Before joining on a model-produced field, name which side is measured"*.
   - 260924a-malformed-label: an item-level fault should not fail the whole answer.

   The doc `AGENTS.md` sends prompt writers to has none of these; the only output rule it carries is
   about block ids. Owner: `docs/project/prompting-guide.md`, in a new § What the model writes back
   (or `ai-gateway.md`). **Knowledge.**
6. **"The check becomes the suspect."** `docs/postmortems/260831f-the-match-that-still-failed.md`:
   *"when a person pastes evidence that contradicts a check, the check becomes the suspect, not the
   system"*, plus a *"canary check that's built to fail"*. Owner: `docs/reusable/silent-success.md`
   § Spotting the family. **Rule.**
7. **Fix the class of a review finding, not the one place it points at.**
   - `docs/postmortems/260908e-a-correction-applied-to-the-instance-not-the-class-three-times.md`:
     *"When a review finding is that something CLAIMS TOO MUCH, grep the whole feature … for the
     claim, before editing anything. Then fix, then grep again."*
   - 260907c-heuristic: when a finding says "X cannot see Y", *"enumerate what else X cannot see"*.
     The postmortem names its own home.

   Owner: `docs/reusable/codex-cli-as-subagent.md` § The house workflow. **Rule.**
8. **Migrating the stored data is part of tightening an invariant, and a plan should say so.**
   `docs/postmortems/260905d-a-new-tree-invariant-met-a-nine-day-old-local-artefact-and-reddened-a-gate.md`:
   *"the corpus is migrated in the same commit, or the reason it need not be is written down."*
   `database.md` § Tightening an invariant over stored data is a migration covers the runtime half.
   The plan-time checklist does not. Owner: `docs/reusable/write-planning-doc.md`. **Rule.**
9. **A reference and the thing it points at go in one commit.**
   - `docs/postmortems/260906d-a-signpost-committed-before-the-thing-it-points-at.md`: *"Commit a
     reference and its referent in one commit, and when they genuinely cannot go together, push the
     *referent* first."*
   - 260831d: ask *"what else does this change need in order to stand up alone"*.

   Owner: `docs/project/version-control.md` § Commit your own files by name. It is **rule**, because
   260906d's own plan calls this file's wording a rule.
10. **Eleven test-harness rules with no home.** All are knowledge, and their home is
    `docs/project/testing.md` § Mocks and fixtures that manufacture green. That section stops at the
    four shapes found on 2026-08-27. The missing rules:
    - 260908c: *"Derive the corpus's membership instead of typing it"*.
    - 260908e-fixture: *"A fixture whose meaning is *fresh* has to be computed from the clock the
      component reads."*
    - 260910b-react: *"Put two transport deliveries in one `act`"*.
    - 260910c: *"Hold one request open … then edit or remount before resolving it"*.
    - 260907b: *"a fixture that jumps to the state tests nothing"*.
    - 260907d: *"Any test about an effect's lifecycle should"* mount inside `<StrictMode>`.
    - 260930a: *"Stop on the condition, never on a clock"*, plus the taskset contention run.
    - 260910d: a jsdom test rewrites a literal `new URL(…, import.meta.url)`.
    - 260830d: a guard on the count of collected test files.
    - 260828b: *"mount, act, **unmount**, then let the world answer"*.
    - 260907c-sweep: *"Test a time-based guard by ageing the artefact, never by advancing the clock"*.
11. **Conventions every mode follows, which a new mode's author cannot find.**
    - Greg, in `docs/plans/260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button.md`:
      *"(just as we do with quotes and glossary), once generated, we should always visually indicate"*
      them *"in the main text"*. 260908i and 260930i say the same thing.
    - In `docs/plans/260929g-faq-difficulty-centrality-and-a-threshold.md`, Greg asks for *"the same
      approach we use for the glossary … a prioritized ordering by default with a threshold"*.

    Each mode's own doc states these for itself. `docs/project/mode.md` states neither as a
    convention: it has the `useOrderedRead` hook only. 260930b, *"grep for 'not designed' / 'nobody'
    comments"* when a mode becomes reachable, belongs in the same checklist. **Knowledge.**
12. **Client-state habits.**
    - 260831a: *"An effect with `[]` deps that reads a ref can only ever see the first render's DOM"*.
    - 260915b: *"For every externally driven flag … write down at the point it's set: what clears it,
      and what does the screen say while it's true?"*
    - 260905e: freshness follows the order requests were issued, not the order they completed. This is
      only in `library.md`.

    Owner: `docs/project/web-client.md`, next to § Empty is not the same as not asked yet. **Knowledge.**
13. **Eval spend.** `docs/postmortems/260905d-the-run-kept-buying-after-it-knew-the-answer-was-incomplete.md`:
    *"An inventory of the spending points, written before the first guard"*. Owner:
    `docs/project/cost-tracking.md`, which has no section on runaway spend. **Knowledge.**
14. **Readiness.** 260909a, 260909b and 260909c are three postmortems about the readiness machinery
    that `readiness.md` does not cite:
    - *"returning is not recovery"*
    - *"Require provenance before an output string changes a record's meaning"*
    - *"process outcome is not artifact provenance"*

    Owner: `docs/project/readiness.md`. **Knowledge.**

Smaller items (all knowledge unless marked):
- **260902d:** add an `ss -ltnp` "how many dev servers am I running" check to `debugging.md`.
- **260906c-safe-helper:** `nameOfThrown` is in no doc. It belongs in `sentry-error-monitoring.md`.
- **260912c:** *"A disclosure has two [states], and each needs a glyph and a name that are true in it"*
  belongs in `controls.md`.
- **block-chat-was-never-in-the-gutter:** *"when a comment places an element, take the measurement it
  is claiming"* belongs in `browser-testing.md`.
- **260908h:** `overseer.md:16` still says *"20–35 coding agents"*. The measured peak was 18 on
  2026-09-08. This one is rule and pinned.

## Q2 — Postmortem classes that recur, ranked by how far the warning is from the point of need

| # | Class (the members) | Count | Evergreen warning at the point of need? | Where it belongs |
|---|---|---|---|---|
| 1 | **The harness or fixture makes the test pass.** It cannot reach the condition, or it removes it: 260828b, 260830a, 260901g, 260902a-skip, 260902c-laptop, 260906a, 260907b, 260907d, 260908c, 260908e-now, 260910b-react, 260910c, 260910d, 260916a, 260930a | 15 | **Partial.** `testing.md` § Mocks and fixtures stops at 2026-08-27. `engineering-manager.md:197` has the end-of-stage mutation. Nothing covers the 11 rules in Q1 item 10 | `testing.md` § Mocks and fixtures — one paragraph per shape |
| 2 | **Prose stands in for a check:** a comment, a deferral or a recorded defect, with the default left unchanged. 260902c-truncation, 260902e, 260903c, 260903e (*"Ten postmortems already name it"*), 260905a, 260908f, 260908g, 260912a, 260930b | 9+ | **Exists but cannot be reached.** `written-down-is-not-checked.md` covers it, but `AGENTS.md` does not link it. It is reachable only from `postmortems.md`, `plans.md` and `documentation-policy.md`, and an agent writing a comment or a deferral reads none of those | A line in `AGENTS.md` § Before you call it finished, beside "A check you have never seen fail". **Rule** |
| 3 | **The checking apparatus agrees with the bug** (silent success): 260827b, 260828d, 260831c, 260831f, 260902b, 260902c-claude, 260903a, 260904a-billing, 260905b, 260906e, 260907c-sweep, 260908g, 260909c, 260910a-container, 260910b-fallback | 15 | **Yes.** `silent-success.md` is linked from `AGENTS.md`. Missing: "paste the red message" and "the check becomes the suspect" (Q1 items 3 and 6), and *"never print a pre-written explanation of an expected failure without checking it happened"* (260905b) | `silent-success.md` § The habit. **Rule** |
| 4 | **Trusting what the model returns** as exactly the payload, as a count, or as a join key: 260826a, 260830e, 260903f, 260906b, 260908b-enum, 260924a ×2, 260928b | 8 | **No, at the point of need.** The warnings are scattered through `hierarchy.md`, `logging.md` and `article-images.md`. `prompting-guide.md`, the doc `AGENTS.md` names for prompt work, covers block ids only | `prompting-guide.md` § What the model writes back (Q1 item 5) |
| 5 | **Stale or out-of-order client state:** 260827e, 260831a, 260905e, 260906c-url, 260906d-slot, 260908c-opening-read, 260910b-react, 260910c, 260915a-store, 260915b, 260916a, 260928c | 12 | **Partial.** `web-client.md` has § A write waits for the opening read and § A store React subscribes to. The rule "issue order, not completion order" is only in `library.md`. Nothing on `[]`-deps effects or on state entered with no way out | `web-client.md` (Q1 item 12) |
| 6 | **Each part tested, the join between them not:** 260831e, 260901e, 260906f, 260907a-vercelignored, 260908b-parts, 260908h, 260928b-lesson-in-helper | 7 | **No.** "Mutate the composition root" exists only in Claude's auto-memory. `composition root` appears in no doc except `fleet-dashboard-modes.md` and `usage-history.md`, and both are local to the fleet | `testing.md`: a new § "Test the join: mutate the composition root" |
| 7 | **The fix is scoped to the first instance:** 260903e, 260907c-heuristic, 260908a, 260908e-correction, 260915c | 5 | **Only at write-up time.** `write-postmortem.md` has "Look for the sibling", but the mistake happens while handling a review finding | `codex-cli-as-subagent.md` § The house workflow (Q1 item 7). **Rule** |
| 8 | **The environment differs from where it was checked** (laptop, Vercel, production bucket, iOS): 260827a, 260828a, 260828f, 260831d, 260903f-bucket ("drifted again"), 260905c, 260907a-vercelignored, 260912b | 8 | **Mostly.** `deployment.md`, `typechecking.md` (`typecheck:committed`), `narrow-windows.md` and `hetzner-remote-server-box.md` each carry their own instance. No single question is written down: "where else will this run?" | Acceptable as it is. At most a line in `silent-success.md` § Spotting the family, which already has "depends on the viewer" |
| 9 | **A timeout or wait that does not bound what you meant:** 260906e-timeout, 260910a-timeout, 260930a, 260902d | 4 | **Partial.** `testing.md` § A test that spawns a process needs its own timeout; `codex-cli-as-subagent.md:398` (its own wrapper only) | `docs/reusable/long-waits.md` or `testing.md`: *"a timeout that signals and then waits is not a bound"* |
| 10 | **One value or switch carries two meanings** (absent, corrupt, refused; may do and may see; 409 versus 500): 260901d, 260904c-glossary, 260908b-enum, 260910b-fallback, 260910b-proof-field, 260929a | 6 | **Partial.** `silent-success.md` has the null that means absent, corrupt or oversize, and the three empty states. Missing: *"A value meaning 'could not read' is never the same type as a real result"* (260910b) | `silent-success.md` or `typechecking.md` (discriminated unions) |
| 11 | **An invariant tightened over data already stored:** 260831b, 260905d-tree, 260905f | 3 | **Runtime only.** `database.md` § Tightening an invariant over stored data is a migration | `write-planning-doc.md` checklist (Q1 item 8). **Rule** |
| 12 | **Spend that keeps going:** 260902c-truncation-storm, 260905d-buying, 260912a | 3 | **No.** `cost-tracking.md` has no section on it; `ai-gateway.md:421` has one incident | `cost-tracking.md` (Q1 item 13) |
| 13 | **Ids re-minted, or a key borrowed from another module:** 260826c, 260826d, 260826f, 260904a-retry, 260905a-empty-blocks | 5 | **Yes.** `block-ids.md`, which `AGENTS.md` names as the one contract | Nothing to do |
| 14 | **Touch and viewport events:** 260903f-notch, 260903g, 260905g, 260912b, 260915a | 5 | **Yes.** `touch.md` (pointerup versus click, *"a lift fires the hover events too"*), `narrow-windows.md` (`innerWidth`, safe-area) | Nothing to do, except 260905g's *"measure rather than agree a number between two files"*, which belongs in `design-css-overview.md` |
| 15 | **A hand-kept list that has to stay complete:** 260828c, 260830c, 260831g, 260901h, 260916a | 5 | **Yes.** `silent-success.md`: *"Never write a 'should I emit this?' condition as a second list"* | Add 260831g's *"property of the map, asserted before the edit"* to `rename-or-move.md` |

## What Greg would actually have to approve

The rule-wording edits are Q1 items 1–4 and 6–9, and Q2 rows 2, 3, 7 and 11. Taken together, that is:

- one `url-state.md` set;
- one `written-down-is-not-checked.md` set (and an `AGENTS.md` pointer to it);
- one `silent-success.md` set;
- one `codex-cli-as-subagent.md` line;
- one `write-planning-doc.md` checklist line;
- one `version-control.md` line;
- the `feedback-reports.md` re-pin.

Everything else is plain knowledge in a `docs/project/` leaf, and an agent can just write it.
