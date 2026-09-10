# Stage 2 task — decisions schema 2 (plan 260910e)

You are implementing Stage 2 of `docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md`
in the worktree `/home/greg/code/spideryarn2/.claude/worktrees/work-reports`. Work only there. Read the
plan in full — **its design section is the reviewed version and is the spec**, especially "Decisions:
extend the one record, and how the two logs reconcile" and "Ranking"; the Sol review it answers is
`docs/plans/260910e-work-reports-plan-review-sol.md` (WR-P1, P2, P8 are yours). Then `AGENTS.md` §
Writing code.

**Another subagent is building Stage 1 in the same worktree at the same time** (`tools/overseer/reports.ts`,
`report-artefacts.ts`, `report-identity.ts`, `daemon.ts`, `scripts/overseer.ts`,
`tests/overseer-reports*.test.ts`, `tests/overseer-daemon-reports.test.ts`). Do not touch those files;
their tests may be red while they work.

## Already written, import it

`tools/fleet/artefact-ref.ts`: `CheckedArtefact`, `parseCheckedArtefacts`, `artefactHref` (the only
function allowed to build a link), `describeArtefactCheck`, `untrustedTextProblem`. Schema-2 `evidence`
is `CheckedArtefact[]`. If you need to change this module, say so and why.

## Read first

- `tools/overseer/decisions.ts` in full; `scripts/overseer-decisions.ts` (`template`, `add` and its retry
  logic, `list`); `tools/fleet/decisions-view.ts`; `tools/fleet/routes-decisions.ts`;
  `tools/fleet/wire.ts` `DecisionWireRecord` and neighbours (~line 3250) and `DecisionsFeed`;
  `tools/fleet/web/src/decisions-client.ts` (its strict parser refuses `schema !== 1`);
  `tools/fleet/web/src/DecisionsPanel.tsx`.
- Existing tests: `tests/overseer-decisions.test.ts`, `tests/overseer-decisions-cli.test.ts`,
  `tests/fleet-decisions-view.test.ts`, `tests/fleet-decisions-client.test.ts`,
  `tests/fleet-decisions-panel.test.tsx`, `tests/fleet-decisions-route.test.ts`.

## Build

1. **`decisions.ts`**
   - New events are written at schema 2; the parser accepts schema 1 (exactly as today) and schema 2, and
     refuses anything else. A schema-2 `decided` requires: `author` (`{kind:"overseer"}` |
     `{kind:"greg"}` | `{kind:"session", name, execution: ExecutionRef}`), `consequence`
     (`high|medium|low`), `reversibility` (`easy|costly|one-way`), `domain` (`product|technical`),
     `recommendation` (string or null), `evidence` (`CheckedArtefact[]`, may be empty), `gregAsked`
     (`no|asked-answered|asked-awaiting`), `confidence` (`high|medium|low` or null). Bound every new text
     field with `untrustedTextProblem` (recommendation ≤ 2000; session name `^[A-Za-z0-9._-]{1,64}$`).
     Consider also bounding the existing text fields at schema 2 only (question, why, option text, notes)
     — do it if it is cheap, and never retroactively for schema 1.
   - The recorder `by` gains `"daemon"` (a line the report drain copied from a session's submission). A
     new `DecisionRecorder = "greg" | "overseer" | "daemon"` type — keep `QueueActor` untouched. Parser
     rule: `by: "daemon"` is only valid on a schema-2 `decided` whose author is a session; `reviewed` and
     `reversed` stay Greg-only in the fold, unchanged, whatever the author.
   - `DecisionRecord` carries `author` (with a fourth arm `{kind:"legacy-unrecorded"}` for schema-1 rows —
     **not** `overseer`: the file's own header says V1 assumptions were made under Greg's standing
     decision) and each new field as a discriminated value where schema 1 gives `"not-recorded"`
     (a literal, never `undefined`); `evidence` is `[]` with a separate `evidenceRecorded: boolean` or an
     equivalent union — your call, say which.
   - The V1 refusal of a `decidedBy` field stays as it is.
2. **`overseer-decisions.ts`** — `template` prints schema 2 without `author` (the CLI fills it from
   `--by`: overseer ⇒ `{kind:"overseer"}`, greg ⇒ `{kind:"greg"}`; `--by daemon` is refused here —
   only the drain writes that); `add` refuses a file missing any new field, naming each, pointing at
   `template`; the retry comparison (`authoredContent`) includes the new fields; `list` gains
   `--search <text>` (case-insensitive over question, option names and trade-offs, choice and note, why,
   recommendation, plan, session names, author name), `--domain`, `--consequence`, `--author
   overseer|greg|session|legacy`; printed rows show author and the new fields (`not recorded` for V1).
3. **`decisions-view.ts`** — within the pending group, order by consequence `high` → `not-recorded` →
   `medium` → `low`, then reversibility `one-way` → `not-recorded` → `costly` → `easy`, then newest
   `decidedAt`. Keep pending-before-the-rest and the rest's existing order. Confidence never affects order.
4. **The route and wire, schema 2 of the API** — `DecisionsFeed` and `DecisionWireRecord` carry the new
   fields and the payload's `schema` becomes 2 on every arm (so an old browser, whose parser refuses
   `schema !== 1`, says "this browser can read version 1" rather than showing a session's decision as
   "recorded by overseer"). Edit the decision types in `wire.ts` in place; do not touch unrelated types.
   `routes-decisions.ts` `rowForWire` copies them.
5. **`decisions-client.ts`** parses schema 2 strictly (and refuses 1 with a sentence); **`DecisionsPanel.tsx`**
   shows "decided by <session> (session)" / "decided by the Overseer" / "decided by Greg" / "author not
   recorded", with "recorded by the report drain" when `by` is daemon; consequence, reversibility,
   domain, recommendation, confidence (as a small annotation); **Greg-asked as the author's claim** — the
   words "the author says Greg answered" / "…says Greg has been asked and has not answered" / "…says
   Greg was not asked", visually separate from and never styled like the review state; evidence as a
   list of `spellArtefactRef`-style labels, each a link only when `artefactHref` returns one (`rel=
   "noreferrer"`, `target="_blank"` for http links), with `describeArtefactCheck` beside it. Give each
   card `id="decision-<id>"` so `#decision-<id>` anchors work.
6. A search box above the list filtering rows client-side, case-insensitive, over the same fields as the
   CLI; it never reorders.

## Tests first, red then green

- a schema-1 log (reuse lines from an existing test) folds unchanged, `author` legacy-unrecorded, the new
  fields `not-recorded`;
- schema 2 round-trips through `appendEvents` / `readDecisions`;
- a schema-2 `decided` missing each one required field is refused (one case per field), and one with a
  control character in `recommendation` is refused;
- `by: "daemon"` with a non-session author is refused; a `reviewed` by `daemon` or `overseer` does not
  review, whatever the author; a session-authored decision is pending review;
- `schema: 3` is an unreadable-line problem, not a row;
- **frozen old parsers**: copy today's `parseEvent` (from `git show HEAD:tools/overseer/decisions.ts`) and
  today's client payload parser into `tests/fixtures/decisions-v1-frozen/` (a minimal extract, with a
  comment saying where it came from and why it is frozen), and assert the old event parser returns null
  for a schema-2 line and the old client parser refuses a schema-2 payload;
- ranking: high/one-way before not-recorded before medium; not-recorded never above a known high;
  confidence has no effect;
- CLI: `add` with an old-shape file names the missing fields; `--by daemon` refused; `list --search`
  finds by recommendation and by option trade-off; `--author session` and `--author legacy` filter;
- client accepts schema 2 and refuses a record missing a new field; the panel renders the author line,
  the Greg-asked claim wording, an evidence link whose `href` is exactly `artefactHref`'s, no link for a
  `found-locally` commit, and the search box filters without reordering.

Keep the existing tests passing; update an existing assertion only where the order, schema number or
shape changed by design, and list each one you changed.

## Gates, then stop

Run the decisions test files above plus your new ones and `tests/fleet-artefact-ref.test.ts`;
`npm run build:fleet` then `tests/fleet-decisions-route.test.ts` must pass; `npm run typecheck` (read the
exit code; ✗ goes to stderr and the last lines are always ✓); `npx biome lint <files you touched>`. Not
the full suite. **Do not commit.** Files you may touch: `tools/overseer/decisions.ts`,
`scripts/overseer-decisions.ts`, `tools/fleet/decisions-view.ts`, `tools/fleet/routes-decisions.ts`,
`tools/fleet/wire.ts` (decision types only), `tools/fleet/web/src/decisions-client.ts`,
`tools/fleet/web/src/DecisionsPanel.tsx`, the decisions test files, and `tests/fixtures/decisions-v1-frozen/`.
Anything else: stop and say so.

Report back, briefly: files changed; each new test and whether you saw it red; gate results with exit
codes; existing assertions changed and why; decisions you made (the `evidence` shape, bounds on old
fields); anything in the plan you found wrong. The conclusion, not the file contents.
