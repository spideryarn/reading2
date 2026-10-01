# Trawl B: the shape of `docs/project/`

Read-only trawl, 2026-10-01, judged against `docs/reusable/documentation-policy.md`. The standard
there is intent and signposts rather than descriptions of code, one home per fact, Greg quoted
verbatim, and "a doc that has grown past what anyone will read is not doing its job".

**Scope.** 111 files in `docs/project/` (110 `.md` plus `original-version/`), 61,258 lines
(`wc -l docs/project/*.md`).

**How it was done.**
- Sizes and history share were measured by script.
- Owners and back-links were measured by script against the AGENTS.md "↳" lists.
- Code drift was sampled in 14 docs by two read-only subagents (about 555 claims checked, about 45
  stale). I re-ran a sample of their findings myself, and every one I re-ran held.

**The history-share measure.** For each doc, the lines of non-quote paragraphs that contain
since / until / no longer / used to / was removed / landed / on YYYY-MM-DD, divided by all
non-quote lines. It is crude: it over-counts paragraphs that merely mention a date and
under-counts dated headings. Across all 110 docs it comes to **34%**.

## 1. Too big

The 20 largest docs are each over 1,000 lines, and they hold 26.7k of the 61k lines. The ten
worst follow, with the rough history share and what to do with each.

| doc | lines | history | verdict |
|---|---|---|---|
| `diagram.md` | 2349 | 34% | **Split.** It is five pictures in one doc. "The fourth: Sketch" (lines 1512–1781) and "The fifth: Illustrated" (1781–2219, about 440 lines) become `sketch.md` and `illustrated.md`. `diagram.md` keeps Force/Drift/Trail and the shared Interaction section. The reading-view-overview line still says "three of them", while the doc has five headed pictures. |
| `ingest-queue.md` | 2184 | 45% | **Split and cut.** "Uploading a PDF" (89–426) is a separate feature: give it its own doc or move it under `content-extraction.md`. "The queue: it was p-queue, and now it is an index and a loop" (937–1443) is mostly the migration story and belongs in plans. "When this becomes Postgres" (2099) opens with "Done, since 2026-08-27": delete the section. |
| `overseer-direction.md` | 1657 | 31% | **Cut.** "The backlog, after the wide review" (1316–1593, about 280 lines) is a work queue, so it belongs in `overseer-queue.md` or a plan. "Usage limits" (611–726) restates `usage-per-account.md` and `usage-history.md`. "What Greg asked for on 2026-09-08" is fine as a quote block. 171 quote lines is high even for a direction doc. |
| `billing.md` | 1563 | 33% | **Cut.** "The first live sale, and the four things it measured" (354–476) is an incident record with customer and subscription ids, so it belongs in a postmortem or plan. "Not built yet" (1401–1542, 140 lines) is a backlog. |
| `performance.md` | 1470 | 24% (understated) | **Cut hardest.** Lines 211–1392 are ten dated investigations, about 1,180 lines or 80% of the doc: "The numbers, 2026-08-27", "Scrolling, 2026-08-27", "Scrolling rebuilt…, 2026-09-03", "Clicking, 2026-09-05", "Startup…", "At rest again, 2026-09-12" and so on. Keep "Start here: the recipes", "Before you believe a number", "The instruments", "The traps", "Where the pieces are" and "If you are about to work on this". Move each dated study to a postmortem or research doc. |
| `database.md` | 1440 | 38% | **Cut and correct.** "The filesystem era" and "Next: Supabase Postgres" (line 210 on) are written in the present tense about a store deleted on 2026-09-05; see §4. The doc says it keeps that history on purpose (line 36), but a reference doc is the wrong home for it. |
| `testing.md` | 1417 | 36% | **Split.** "One database, many suites: the three shared resources" (1193–1384) and "A run is not the only thing on the machine" (35–135) are box and contention operations: move them beside `hetzner-remote-server-box.md`, or into a `test-infrastructure.md`. The rest is policy and should stay. |
| `hierarchy.md` | 1313 | 41% | **Cut.** Hierarchy *mode* is gone (2026-09-29), but the stage remains. Cut the mode-era material, and fix the `data/<slug>/tree.json` schema label (§4). |
| `glossary.md` | 1295 | 40% | **Trim.** A lot of it is narration of how each bug was found. |
| `security.md` | 1240 | 38% | **Restructure.** It is written as an incident log: "What was wrong", "The stamp was written to a file nobody reads", "Stage 2's debug page, and the three holes nobody counted". Lead with the current defences, which `security-map.md` already does better, and move the narratives to `docs/postmortems/`. |

Also worth flagging:
- **`column-context.md`** (433 lines) opens with *"Read the rest as history"*: Hierarchy mode's
  fisheye went on 2026-09-29. Cut it to the surviving `useColumnContext` and `Tier`, or delete it
  and fold that into the Structure doc.
- **`granularity-zoom.md`** (872 lines) is mostly the removed tabular view and gist columns
  (lines 554–797 are all gist-column widths). Yet AGENTS.md still names it as one of the two docs
  to read before touching anything.
- **Entry points have grown into deep dives.** In `security-map.md` (419 lines), "Where the
  defences physically live" runs from line 80 to 385. In `architecture.md` (418), "Storage" is 105
  lines.

## 2. Overlap

| pair | the shared ground | should own it |
|---|---|---|
| `security.md` / `security-map.md` | Both open with the same "untrusted parties, not other readers" framing and both enumerate the parties. | `security-map.md` owns the list. `security.md` should cite it, not re-count (§5). |
| `web-client.md` § Dark mode / `design-css-overview.md` § Colour: one source, dark only | The rule, Greg's 2026-08-24 quote and the `prefers-color-scheme` / `@custom-variant dark` detail. | `design-css-overview.md`. `web-client.md` keeps a one-line pointer. |
| `overseer-direction.md` § Usage limits / `usage-per-account.md` + `usage-history.md` | How limits are read and shown. | The two usage docs. Direction keeps only the intent. |
| `overseer-direction.md` § The backlog / `overseer-queue.md` | Deferred fleet work. | `overseer-queue.md`, which is the queue. |
| `granularity-zoom.md` / `hierarchy.md` / `column-context.md` / `narrow-windows.md` | Gist-column widths and the tree. | After 260929d, `hierarchy.md` owns the tree (stage) and a new `structure.md` owns the view. The gist-column width material is history in all four. |
| `static-analysis.md` / `code-quality-overview.md` / `testing.md` | Whether the gate needs a database, and how it fails without one. | `testing.md` § "When a skip is not acceptable". The others should cite it, and they disagree (§5). |
| `setup-dev.md` § Which model everything uses / `ai-gateway.md` / `src/models.ts` | Model per job, and which wire each uses. | `src/models.ts`. Both docs copy lists out of it and both have drifted (§4 #9, #13). |
| `deployment.md` / `vercel-hosting-deployment.md` | Already split into process and inspection, with explicit twin lines. | Fine as is; noted only because `deployment.md` describes itself as holding "the history of how each of those was got wrong". |
| `browser-testing.md` / `browser-testing-playwright.md` | `browser-testing.md`'s recipes are written in Claude-in-Chrome tools, though most work now runs on the box. | Acceptable as split, but `browser-testing.md` should lead with the machine fork (`browser-control.md`). |

## 3. Missing owners

These are areas with real code and no doc that owns them. The first three are named as missing in
`reading-view-overview.md` itself ("there is no `structure.md` yet", "There is no `debate.md` yet",
"No `tweets.md` yet").

- **Debate.** About 3,050 lines in `src/` and 2,120 in `src/web/DebatePanel.tsx`:
  - `src/debate.ts` (2006)
  - `src/debate-journal.ts`, `src/debate-registry.ts`, `src/debate-synthesis.ts`,
    `src/debate-themes.ts`
  - `src/web/modes/debate/`

  **No doc in `docs/project/` names any `debate*.ts` file.** In its place, the overview carries a
  ten-line changelog of "since 2026-09-29 / since 2026-09-30 / since 2026-10-01" (lines 124–140).
  This is the largest unowned area.
- **Structure.** `src/web/StructurePanel.tsx` (670) and `src/web/modes/structure/`. It is now the
  default tree view, yet the overview says "the plans are the reference" and cites three plans.
- **Tweets.** `src/tweets.ts` (732), `src/web/modes/tweets/` and `src/web/useTweets.ts`. The plans
  are the reference here too. It is the "one mode that writes on arrival", which is a rule with no
  home.
- **Chat as a mode.** `chat-tools.md` owns the tools, but the chat client state machine
  (`src/web/chat/controller.ts`, `reduce.ts` and `effects.ts`) is described only inside
  `web-client.md` (line 783) and `live-conversation.md`.
- **The HTTP surface.** `src/routes.ts` is 9,846 lines, and 35 docs mention it, but no doc owns
  "the API": its route list, auth wrapper and conventions.
- **Modules no doc mentions.** 41 `src/*.ts` modules are named by no doc. Grouped:
  - all five `debate*.ts`
  - the referee runners: `referee-claims-run.ts`, `referee-criteria-run.ts`,
    `referee-criteria-store.ts`, `referee-candidates-prompt.ts`, `saved-criteria.ts`
  - `pdf-figure-{containment,layout,paint,read,resources}.ts` and `pdf-integrity.ts`; these
    probably belong to `article-images.md` and `content-extraction.md`
  - `citation-entry.ts`, `citable.ts`, `citation-investigate-context.ts`
  - `high-power-model.ts`, which `high-powered-ai.md` does not link
  - `untrusted-fence.ts`, which `security.md` should signpost given its "prompt injection, and
    what the fence does not do" section
  - `stream-run.ts`, `reset.ts`, `cost-report.ts`, `migration-digest.ts`

## 4. Code description that has drifted

These were verified against the code. Line numbers are as of this trawl.

1. **`architecture.md` § Pipeline diagram.**
   - Doc: every box writes `data/<slug>/raw.{html,pdf}`, `article.html`, `blocks.json`,
     `tree.json`.
   - Code: there is no filesystem store. Steps return `produces`/`parts` into the store.
   - The diagram also shows 6 boxes and a stage "5 summarize" that is not a step. `STEP_ORDER`
     has 21.
2. **`architecture.md` § Intent (line 21).**
   - Doc: "two stages of seven cache on a content hash, the rest on a file existing".
   - Code: `src/pipeline.ts` `STEPS` gives 17 of 21 steps a `stamp`.
3. **`architecture.md` § Conventions (line 333).**
   - Doc: "**eleven of the fifteen in `STEP_ORDER`**".
   - Code: 17 of 21. Missing from the doc's list: `faq`, `simple`, `trajectory`, `debate`,
     `citations`, `crossrefs`.
4. **`architecture.md` § Server and client (line 300).**
   - Doc: "`src/jobs.ts`, p-queue, concurrency 1".
   - Code: p-queue is gone (`src/jobs.ts` says so), and `drizzle/0032_jobs_concurrency_cap.sql`
     makes the cap six.
5. **`architecture.md` § Stage ownership.**
   - Doc: `src/extract.ts` "does fetch + Readability + a standalone HTML page in one script,
     writing to `output/`".
   - Code: its header says it "writes neither" artefact. `npm run extract` is
     `scripts/stage.ts extract`.
6. **`database.md` § Next: Supabase Postgres (lines 210–213).**
   - Doc: "Nothing reads or writes it; the app is still entirely on files".
   - Code: the app is on Postgres only.
7. **`database.md` (line 256).**
   - Doc: "Under `files` (the default) the same stages … write `data/<slug>/*.json`".
   - Code: `src/store/index.ts` wires Postgres only.
8. **`database.md` § The filesystem era.**
   - Doc: "Reads all go through `src/api.ts`", in the present tense.
   - Code: the file is gone; reads go through `src/store/index.ts`.
   - Doc: "All seven `owner_id` foreign keys".
   - Code: `src/db/schema.ts` has 21.
9. **`ai-gateway.md` § One gateway, five wires (line 128).**
   - Doc: "`Provider` is still a type there, now with exactly one member".
   - Code: `src/models.ts` has `type Provider = "openrouter" | "openai"`.
   - The wire table also omits `illustrated` and `citations` (Messages), and `debate`,
     `link-summary`, `pdf-frontmatter` and `pdf-figure-locate` (chat).
   - Doc: "the three referee runs". Code: four.
10. **`ai-gateway.md` § durationMs.**
    - Doc: "`evals/` is not in the ledger".
    - Code: `evals/cost/ledger-check.ts` writes `scope_kind='eval'` rows, and `AI_JOB_WIRE` has
      `eval`. This contradicts `cost-tracking.md`.
11. **`web-client.md` § Where the code is.**
    - Doc: `Dock.tsx` has "fourteen" modes. Code: `MODES_UI` has 18.
    - Doc: "37 files under `src/web/styles/`". Code: 43.
    - Doc: "the one `dangerouslySetInnerHTML`". Code: four uses.
    - Doc: `Tweets.tsx` `reloadError`. Code: it no longer exists (`src/web/useTweets.ts`).
12. **`hierarchy.md` § Schema.**
    - Doc: labelled "`data/<slug>/tree.json`".
    - Code: `src/types.ts` `TreeNode` has gained `question?`, `treatment?` and `noteId?`, and
      `Tree` has gained `provisional?`.
13. **`setup-dev.md` § Which model everything uses.**
    - The table omits `SHELF_TOPICS_MODEL` (`openai/gpt-6-luna`) and the Illustrated image model
      (`google/gemini-3.1-flash-image`).
    - The env-var table says it "copies" `MODEL_ENV_VAR`, but omits `SPIDERYARN_DEBATE_MODEL` and
      `SPIDERYARN_PDF_FRONTMATTER_MODEL`.
14. **`keyboard.md`.**
    - Its H1 still reads "← / → choose the stride", which its own banner says is no longer true.
    - § "The aim is visible…" describes `data-aim` as live. Code: none remains in `src/web`.
    - It cites `tests/aimed-column.test.ts`, which does not exist.
15. **`url-state.md`.**
    - Doc (line 158): `?text=` "still honoured on arrival". Its own table (line 34) says it is
      ignored.
    - Doc (line 246): `?mode=hierarchy` appears in copied URLs. Code: it is not in `MODES`.
    - Doc (line 534): cites `columnLabel`. Code: it was deleted.
    - The parameter table has no rows for the live `crits`, `refscale` (`CriteriaPanel.tsx`),
      `debatethread` or `event`.
16. **`mode.md` (line 334).**
    - Doc: tells you to update `liftStrandedText`.
    - Code: `src/web/router.ts` says it was removed on 2026-09-29.
17. **`testing.md`.** It cites `tests/api.test.ts` (line 404) and
    `tests/claim-session-files.test.ts` (line 876) as live. Neither exists.
18. **`ingest-queue.md` § The pipeline is a list (lines 640–655).**
    - Doc: "there are sixteen", followed by a step table whose outputs are all `data/<slug>/…`.
    - Code: 21 steps, written to the store.
19. **`security.md` opening (line 5).**
    - Doc: "Spideryarn is a local, single-user tool".
    - Reality: a multi-reader paid beta with auth, billing and public sharing.
    - § "The stamp was written to a file nobody reads" describes `data/<slug>/blocks.json` in the
      present tense.
20. **`code-quality-overview.md` (line 36).** This is an entry point.
    - Doc: `npm run check` "runs under `REQUIRE_POSTGRES=1` — without it, seventy-odd suites skip
      themselves".
    - `static-analysis.md` (line 173) and `scripts/check.ts` (line 30) both say that ended on
      2026-09-05.

**The pattern.** The two big removals left residue in docs whose removal pass was "each a line,
not a rewrite":
- the filesystem store (2026-09-05)
- Hierarchy mode (2026-09-29, `260929d`)

**Every stale count is a number copied out of code into prose**: fourteen modes, 37 files,
sixteen steps, eleven of fifteen, seven foreign keys, three referee runs. The policy's "cite the
defining file and a stable name, not the value" would have prevented all of them.

## 5. Facts with two homes

- **How many steps are in `STEP_ORDER`, and how many cache on a hash.** Five homes, five answers,
  none of them right (21 steps, 17 stamped):

  | where | what it says |
  |---|---|
  | `AGENTS.md` | "twelve of the fifteen" |
  | `architecture.md` § Intent | "two of seven" |
  | `architecture.md` § Conventions | "eleven of the fifteen" |
  | `ingest-queue.md` | "there are sixteen" |
  | `web-client.md` | 14 modes, which is not the step count but the same failure |

  `architecture.md` line 330 even records that this was "said three different ways … and neither
  was right". Fix: cite `src/step-order.ts` § `STEP_ORDER` and `src/pipeline.ts` § `STEPS`, and
  drop the numbers.
- **How many untrusted parties there are.** Three different counts:

  | where | count |
  |---|---|
  | `security.md` line 3 | "Two untrusted parties" |
  | `security.md` body | five ("A fifth: the manuscript…", line 961) |
  | `security-map.md` line 10 | "security.md counts four … whoever signs in is a fifth party" |
  | `security.md` line 1047 | calls the signed-in reader "A third party who is not untrusted" |
- **Whether the gate needs `REQUIRE_POSTGRES`.** `code-quality-overview.md` says yes;
  `static-analysis.md`, `testing.md` and `scripts/check.ts` say no since 2026-09-05.
- **Whether evals write to the ledger.** `ai-gateway.md` says no; `cost-tracking.md` and the code
  say yes.
- **The model table.** It lives in `setup-dev.md`, `ai-gateway.md` (the wires) and `src/models.ts`,
  and both docs have drifted from the code.
- **The dark-only rule and Greg's quote.** Stated in both `web-client.md` § Dark mode and
  `design-css-overview.md`. They agree today.
- **The Structure-band widths (609px band, 1165px window).** Stated in `narrow-windows.md` (the
  owner), `reading-view-overview.md` (line 88), `granularity-zoom.md` and `browser-testing.md`. The
  overview should cite rather than restate.
- **The step list and its outputs.** Restated in `architecture.md` (diagram and table),
  `ingest-queue.md` (lines 640–655) and `setup-dev.md`'s stage-command table. Only the last is
  current.

## 6. Entry-point lines

**No links back up.** `tests/doc-links.test.ts` checks that an owner links to each child, but not
the reverse. These 16 docs link to **no** entry point at all:
`auth`, `browser-testing`, `column-context`, `dictation`, `hetzner-remote-server-box`, `linting`,
`overseer-queue`, `performance`, `prompt-caching`, `reader-profile`, `static-analysis`,
`supabase-local`, `testing`, `url-state`, `usage-per-account`, `version-control`.
Adding the reverse check to `doc-links.test.ts` is a one-line class fix.

**`architecture.md` has no "The docs" section.** Its 14 children are reached only inline, in the
middle of prose or table cells:
- `block-ids`, `fetching`, `content-extraction`, `hierarchy`, `article-images`, `ingest-queue`
- `ai-gateway`, `cost-tracking`, `email`, `prompt-caching`, `prompting-guide`, `database`, `sql`,
  `export`

So there is no line per child saying when to open it. For example, `prompt-caching.md` is reached
only from line 393, mid-bullet. Every other entry point has a "The docs" list.

**Lines that state a fact instead of saying when you would open the doc:**
- `reading-view-overview.md` line 204, `keyboard.md`: "↑ / ↓ take the step; ← / → step
  Trajectory stops." This is a fact, it is half the doc's scope, and it says nothing about when to
  open it.
- `reading-view-overview.md`, `column-context.md`: "why a coarse column is 80% blank…" It does not
  say that this is now history.
- `reading-view-overview.md`, `granularity-zoom.md`: "**the core feature.** The tree…, the tabular
  view". The tabular view is gone.
- `reading-view-overview.md`, `diagram.md`: "three of them". There are five.
- `reading-view-overview.md`, Debate and Structure: these have no doc, so the overview lines have
  become a changelog (lines 88–101, 124–140). That is history in an entry point.
- `design-css-overview.md` § Under this doc:
  - `tooltips.md`: "the one component whose appearance is entirely ours"
  - `browser-testing.md`: "do not judge colour from a screenshot"

  Both are facts, not "open it when…".
- `vision.md` § Under this doc: the four collection lines (`plans`, `research`, `postmortems`,
  `tutorials`) say what the folder is, not when to open it. That is acceptable for indexes.
- `code-quality-overview.md`, `counting-lines.md`: "how big the thing is now". Fine.

**Most other child lines do say "open it for…"**, which is the house style in
`reading-view-overview.md`. The weak ones are concentrated in `design-css-overview.md`,
`architecture.md` and `security-map.md`. In `security-map.md` the policy facts sit in bold
paragraphs rather than in child lines.

## 7. Signposting down to code

Most feature docs do link their implementing files. A script checked 57 doc → main-file pairs, and
only two missed:
- `keyboard.md` names no keymap, but it does link `src/web/keynav.ts`, so this is minor.
- `high-powered-ai.md` never links `src/high-power-model.ts`.

The real gaps:

- **Areas with no doc have no signpost to their code at all.** Debate, Structure and Tweets (§3).
  The overview links plans rather than `src/debate.ts` or `src/web/StructurePanel.tsx`.
- **`architecture.md` has no "Where the code is" section.** `reading-view-overview.md`,
  `code-quality-overview.md`, `dev-and-deployment-overview.md` and `billing.md` each have one.
- **`debugging.md`** (a signpost page) and **`vercel-hosting-deployment.md`** have zero and one
  code link. That is acceptable, since both point at platforms.
- **The fleet docs cite `tools/fleet/…` as backticked text, not as links.** This applies to
  `readiness.md`, `usage-per-account.md`, `usage-history.md`, `work-reports.md`,
  `fleet-recent-messages.md` and `overseer-queue.md`. They have no clickable path down, and a
  `doc-links` check cannot see a rename. `maths.md` does the same with `src/` (6 backticked, 0
  linked).
- **`security.md` § Prompt injection** discusses the fence but never names `src/untrusted-fence.ts`.
- **`src/routes.ts`** (9.8k lines): no doc indexes it (§3).

## Suggested order

1. Fix the drifted claims in the two entry points: `code-quality-overview.md` line 36, and the
   `architecture.md` diagram and counts.
2. Replace every copied count with a citation (§5).
3. Write `debate.md`, `structure.md` and `tweets.md`, and move the overview's changelog lines into
   them.
4. Move the dated studies out of `performance.md`, and the history sections out of `database.md`,
   `security.md` and `ingest-queue.md`, into postmortems and plans.
5. Add the child→parent check to `tests/doc-links.test.ts`.
