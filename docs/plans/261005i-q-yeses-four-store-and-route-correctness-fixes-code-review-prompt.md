# Review and fix: four small store and route correctness fixes, as built

You are the code reviewer for a finished stage, and you may write. **Fix what is inside this stage,
narrowly, each finding red-first with the test that reproduces it. Report, do not fix, anything
wider you notice.** Do not commit. Do not attribute any sentence to a named person unless it is
already quoted, with that attribution, in the tree.

Repo: this worktree, branch `worktree-q-yeses-store-route-correctness` (TypeScript, ESM).

## The candidate

Committed, in order, on top of `c151e32d7` (the plan):

- `40c217dd6` — B, the visibility row lock's test
- `c0b2e1727` — A, the `blocks` arm on the Metadata page
- `d5a445c32` — C, live markers count their holders
- `7fc1b41fb` — D, Search and Criteria take the hash of the blocks they send

`git diff c151e32d7..7fc1b41fb`; changed paths: `git diff --name-only c151e32d7..7fc1b41fb`. The
tree is clean at `7fc1b41fb`, so anything `git diff` shows afterwards is yours.

Start with: `src/blocks.ts` § `blocksAreWhatTheirHtmlProduces`, `src/store/pg.ts` §
`articleMetadata`, `src/live-keys.ts`, `src/routes.ts` § `search`, `runRefereeCriterion`,
`runRefereeClaims`, `src/store/pg-searches.ts` § `begin`, `src/store/pg-referee-criteria.ts` §
`begin`, `src/store/pg-visibility.ts`. That is where to begin, not the limit of scope.

## What it is meant to do

The plan is `docs/plans/261005i-q-yeses-four-store-and-route-correctness-fixes.md`; your own plan
review is beside it, and its Log says how each of PF1–PF5 was taken. In one line each:

- **A.** `stepIsDone` for `blocks` and the Metadata page's `isCurrent` call one function on the
  same inputs (the blocks as stored, not sanitised). The `metadata` projection still does not
  select the two HTML columns; they are a second query, made only when the run row says `done`.
- **B.** No behaviour change. The article row lock stays; a new test holds a `processing` write
  open and shows a share blocked behind it. The comments say which lock does which job.
- **C.** `searching`, `refereeing`, `pullingClaims` and `answering` are counts per key through one
  helper. `hold` sits immediately before the outer `try` in each handler.
- **D.** `SearchStore.begin` and `RefereeCriteriaStore.begin` take a required `sourceHash` after
  `slug`; the two handlers load the article before `begin` and give the same article to the model.
  `refuseAPaperNotReadYet` stays ahead of the load.

Deliberately out of scope: `structure`'s opposite disagreement (pinned, known); `streaming`; the
client panels; any migration.

## What I ran (you cannot: no network, not even loopback, so nothing touching Postgres)

All on this box, each file alone, at the commits above. `npm run typecheck`: all four projects
pass at `7fc1b41fb`.

- A: `store-revision-columns` 47, `freshness-deciders-agree` 145, `blocks-baseline` 24. Red first:
  the guard said `expected [ 'blocks' ] to deeply equal []`; three agreement cases said
  `{ queue: false, page: true }`. Mutations: `case "blocks": return true` reds the same three;
  feeding the arm the sanitised blocks reds only the `data-hit` case.
- B: `public-visibility-pg` 52, `public-reads` 34. With `.for("update")` deleted: the new case
  answers 409 while the row is held; the old two-publish case stays green; the SQL assertion reds.
- C: `live-keys` 3, `referee-stream-lifetime` 18, `routes` 151 at `d5a445c32`. Red first on the
  old maps, once per handler: `expected 'error' to be 'pending'`. Mutation (delete on first
  release): 10 red across four files.
- D: `referee-stream-lifetime` 19, `routes` 152, `store-searches-pg` 38, `referee-criteria-store`
  11, and nine more files that call `begin`. Red first on the old order, both handlers: `the row's
  hash is not of the blocks the model was sent`. The two store tests are new-signature tests; a
  mutation that makes a store read `sourceHashFor` again reds exactly those.

The full suite is running as you read this; I will read it before landing.

You may run a test file that needs nothing outside the tree (`npx vitest run tests/live-keys.test.ts`)
or a script (`node --import tsx <script>`). A red Postgres test inside your sandbox is not a
finding. Say which findings you reproduced and which you reasoned to.

## What I want from you

Independent pass first: attack each of the four. Is it correct; does a test claim more than it
proves; is a comment or doc now false; is there a caller, fake, script or eval the change missed;
did a fix make something else wrong.

Severity, by consequence: **P0** data loss, exploitable security, incorrect charging, service
broadly unusable. **P1** user-visible wrong behaviour, or an authoritative contract violated.
**P2** design or maintainability risk with no wrong behaviour today. **P3** prose or comment
defect. Refuse only on an established P0 or P1 (direct evidence, no unresolved material
inference). IDs continue from the plan review: `CF6`, `CF7`, … (PF1–PF5 are taken).

Write your review as the answer: each finding with its ID, severity, established or reasoned,
what you changed (file and what), or why you left it. End with one line: **land**, **land after
the fixes above**, or **do not land**.

## My own suspicions (already mine; spend most of the run elsewhere)

- A: `articleMetadata` now reads the block rows once and derives the cleaned copy; whether any
  other caller of `blocksFor` changed behaviour. Whether a draft revision and the current one can
  differ between the page's read and the queue's.
- C: `tests/routes.test.ts` and `tests/referee-stream-lifetime.test.ts` wrap the real `begin` to
  delay its return; whether a wrapper leaks into later cases.
- D: the handler tests rewrite one `revision_blocks.text` row in place and restore it in
  `finally`; whether that can leave the shared fixture changed on a failure. Whether moving
  `loadArticle` ahead of `begin` changes what is charged or logged for a request that fails.
- Docs: `docs/project/architecture.md` § Shared code (server) has no line for `src/live-keys.ts`;
  add one if that section lists helpers of this kind (a signpost, not a rule). `search.md` and
  `referee-mode.md` may describe the old order or the old marker.
