# A visitor sees every stored mode on a public article

**Status as of 2026-09-29: planned, not built** — evidence: `POLICY.trajectory`, `.faq`,
`.citations` and `.debate` are all `{ kind: "owners-only" }` in
[`src/web/visitor.ts`](../../src/web/visitor.ts), and the failing test below is red.

## The report, and the rule

SPIDERYARN-READING2-56, Greg, 2026-09-29, production build `070a2503`, article
`bf03197835-spya-qfwsw2`:

> I tried to open this in an incognito window:
> https://www.spideryarn.com/read/bf03197835-spya-qfwsw2?mode=trajectory&deep=2
> but I got this message:
> """
> Trajectory is for whoever added this article — asking costs a model call, and a shared link spends
> nobody's money. Make a free account to read your own articles this way.
> """
> It's a public article, and the Trajectory has already been generated, so it should show it. I think
> this should be true for all modes - they're available to non-logged-in users if the article is
> public AND they have been generated AND it doesn't incur extra costs to run (e.g. Chat is never
> available to non-logged-in users).
>
> — Greg, 2026-09-29

**The rule, as the Overseer passed it on:** for a public article, a signed-out visitor sees every
mode's already-generated output. Anything that would start a paid model call stays owner-only —
Chat, generating, re-running. A reader's private data stays private.

## What went wrong

`POLICY` answers one question per mode — *may a visitor have this?* — and for four modes the answer
was written from the cost of **making** the output, not of **showing** it. Trajectory's comment says
so outright: *"It spends: one small model pass over the Quotes"*. The explanatory band a visitor gets
instead is safe (it sends nothing), and the tests that shipped with it proved exactly that — no
POST — and nothing asked whether a visitor with a stored route could see it. The postmortem is
[260929a](../postmortems/260929a-one-policy-row-decided-who-may-make-a-mode-and-who-may-see-it.md).

## References

- [security-map.md](../project/security-map.md) — the untrusted parties; a visitor is one.
- [260904c-more-modes-on-a-shared-link.md](260904c-more-modes-on-a-shared-link.md) — **the recipe**:
  Timeline went from `owners-only` to `{ kind: "artefact" }` by the nine steps in its § *What every
  stage owes*, and every stage below follows them.
- [new-mode.md](../project/new-mode.md) § the residue — `PUBLIC_PROJECTIONS`, the DTO, and the tests
  that pin each.
- [`src/store/public-reader.ts`](../../src/store/public-reader.ts) § `PUBLIC_PROJECTIONS` — the
  columns a public read selects; forgetting one is the silent failure.
- [`src/public/dto.ts`](../../src/public/dto.ts) — field-by-field projection to the wire.
- [`src/public-types.ts`](../../src/public-types.ts) § `PublicArtefactSet`, and `PublicArtefacts` in
  [`src/types.ts`](../../src/types.ts) — the flags.
- [`src/web/modes/timeline/TimelineMode.tsx`](../../src/web/modes/timeline/TimelineMode.tsx) — the
  owner band / visitor band split every mode here copies.
- [`tests/public-network-trace.test.tsx`](../../tests/public-network-trace.test.tsx) § `BAND_SAYS` —
  what a visitor's band says, asserted against the network.
- [public-readable-sharing.md](../project/public-readable-sharing.md) — the page that already tells an
  author *"some reading aids may have been shaped by the sharer's reader profile"*.

## Decided by the Overseer, 2026-09-29, pending Greg

Two calls Greg's rule did not settle, put to the Overseer rather than guessed, and answered as
assumptions for Greg to overturn:

- **Remember's Quiz stays owner-only — excluded from public articles for now.** Greg, via the
  Overseer:

  > read-only Quiz sounds quite a neat solution. If you can implement this without much complexity
  > then go for it. But for simplicity I'd be happy instead to just exclude Quiz mode from public
  > articles for now.
  >
  > — Greg, 2026-09-29

  It is not small, so it is excluded. Quiz is not a mode but Remember's second half
  (`?mode=remember&remember=quiz`, `REMEMBER_VIEWS` in src/web/params.ts), and `POLICY` decides per
  *mode*: a visitor quiz means a per-sub-view policy for Remember (whose Recall half must stay
  private), a new public artefact end to end, and a visitor arm on an 889-line `QuizPanel` that has
  none. A visitor following a quiz link gets Remember's owners-only band, which sends nothing —
  pinned by a hostile-URL case in `tests/public-network-trace.test.tsx`.
- **Experimental is not a gate for any of this.** Remember is behind the experimental switch and
  Diagram is about to be (report 4R); the switch only hides a button
  ([experimental-features.md](../project/experimental-features.md) § *Hidden means hidden from the
  controls, not unreachable*), so every visitor rule here holds with it on or off, and nothing in this
  plan reads it.
- **Diagram's Illustrated plates: not doing.** A visitor sees the stored Sketch and never the
  Illustrated plates, and that is decided rather than deferred:

  > We don't need Illustrated diagrams for visitors.
  >
  > — Greg, 2026-09-29
- **Citations' *Find it* results stay private.**
- **Ordering:** Trajectory, FAQ, Citations and Debate go to `dev` together once their gates and the
  Sol code review pass, and the Overseer gets that commit for Greg to deploy.

## The audit: every mode against Greg's rule

Measured against `origin/dev` at `e0aacef8`, 2026-09-29. "Sees stored output" means on a public
article, signed out, when the output exists. "Can opening it spend" is about the *owner's* band —
the thing a visitor twin must not mount. A visitor can spend nothing today in any mode: `visitorGap`
puts the explanatory band in the slot and it sends nothing.

| Mode | Sees stored output today? | Can opening it spend (owner's band)? | Right? | This plan |
|---|---|---|---|---|
| plain, hierarchy, structure, summary | yes — drawn from the tree in the payload | no | yes | nothing |
| glossary, ideas, quotes, timeline | yes — `{ kind: "artefact" }`, on the payload | yes (`useAutoRun` on press) — never mounted for a visitor | yes | nothing |
| diagram — Sketch | yes — the stored Sketch; the fetching hooks off for a visitor | yes — pinned off by `DiagramAccess` | yes | nothing |
| **diagram — Illustrated** | **no** — a visitor is pinned to Sketch (`DiagramPanel.tsx`), and the plates are a separate stored artefact | yes (`useIllustrated`: read, job poller, auto-run) | no (Sol, plan review 3) — **not doing, by Greg's decision**, above | nothing |
| search | yes — the owner's saved runs, read-only | yes — the composer is owner-only | yes | nothing |
| comments (drawer, not a mode) | yes — read-only | yes — the composer is owner-only | yes | nothing |
| tweets (its own page) | yes | yes — not mounted for a visitor | yes | nothing |
| **trajectory** | **no — the report** | yes (`useTrajectory` → `useAutoRun`) | **no** | Stage 1 |
| **faq** | **no** | yes (`useFaq` → `useAutoRun`) | **no** | Stage 2 |
| **citations** | **no** | yes (`useCitations` → `useAutoRun`, and *Find it*) | **no** | Stage 3 |
| **debate** | **no** | yes (`useDebate`, on press) | **no** | Stage 4 |
| chat | no | yes — every turn | yes — Greg's own example | nothing |
| remember — Recall | no | yes — a conversation | yes — below | nothing |
| remember — Quiz | no | marking is `POST /api/quiz/:slug/mark`, a model call; the questions and reference answers are stored | arguably no (Sol, plan review 2) — **excluded by Greg's choice**, above | nothing |
| referee | no | yes | yes — below | nothing |

### What stays owner-only, and why it is not a judgement call

- **Chat** — every turn is a model call, and the threads are the owner's own typing plus their
  profile. Greg named it.
- **Remember's Recall** — the owner's own answers, in a conversation built with their profile
  (`profileSection`, src/converse.ts): a reader's private data.
- **Remember's Quiz was the close call.** It stores questions, reference answers and evidence with
  no profile and no URLs; only *marking* spends. GPT Sol argued a read-only quiz follows Greg's rule;
  Greg allowed it if small and preferred excluding it otherwise — see *Decided*, above.
- **Citations' *Find it* results** (`citation_finds`) — keyed to the owner, and a record of the
  owner's own activity, like a glossary lookup (Sol, plan review 5). Private, not merely deferred.
- **Referee** — everything it stores is keyed to the owner and made from what they typed: criteria and
  poles, their own marks on comments, the Candidates conversation rows. A reviewer's private working,
  on an unpublished paper possibly confidential.

### Is a stored output personalised by the owner's profile, and does showing it leak?

| Mode | Written with the owner's profile or *why I'm reading this*? | Shown to a stranger |
|---|---|---|
| trajectory | **yes** — `profileSection(renderProfile({ profile, purpose }))`, src/trajectory.ts | **Fine, on the terms Glossary, Ideas, Quotes, Tweets and Sketch already are** — all five are profiled the same way and have been on a shared link since slice 1b. `PROFILE_RULES` forbids addressing the reader or restating what they said (*"Every sentence you write is still about the article"*), and a cue is one line about one passage. `profileHash` does not cross, so the visitor's *about* line must not say "shaped by your profile", nor whether there was one. [public-readable-sharing.md](../project/public-readable-sharing.md) already tells the author reading aids *"may have been shaped by the sharer's profile, though the profile itself is never published"*; this adds a sixth under that sentence. |
| faq | no — "No profile in v1", src/faq.ts | fine |
| citations | no | fine |
| debate | no | fine |

**The residual risk, named rather than dodged:** a model that disobeys `PROFILE_RULES` could write a
cue like *"as a cognitive scientist, notice…"*, and that would now reach a stranger. It is the risk
the five profiled artefacts already on a shared link carry, and there is no mechanical guard on any of
them. Not closed here.

## What crosses, mode by mode

Built field by field in `src/public/dto.ts`, as every public artefact is. Provenance (`version`,
`generator`, `slug`, `sourceHash`, `profileHash`, `generatedAt`, `elapsedMs`, drop counts) never
crosses.

- **Trajectory** — `stops[]` as `{ quoteId, depth, role, cue }`, and `offered`, because the panel
  prints it at Most (*"This pass stops at 12 of the 15 quotes offered to this route"*) —
  `PublicQuotes.discarded`'s rule: it crosses because the reader is shown it. The stops' words come
  from `quotes`, already on the payload; a stop whose quote is absent draws as *missing*, as the
  owner's does. The stop card's sources — glossary, ideas, timeline, and FAQ after Stage 2 — come
  from the payload too, never from `useFaqRead` / `useTimelineRead` / `useIdeasRead`.
- **FAQ** — `questions[]` as `{ id, question, passages[{ blockId, quote, start }] }`.
- **Citations** — each `CitedWork` minus provenance, with **`url` through `publicCitationUrl`**: a
  refused URL drops the *link*, not the row — a citation is still a citation without one, unlike a
  Debate row. `key` is an internal dedupe key that can embed a URL and does not cross. `found` (the
  owner's paid *Find it*, table `citation_finds`) does not cross; neither does the attached
  `linkFrom: "web"` fact, which the public projection normalises back to `"search"`. Private, not
  deferred.
- **Debate** — the contract its own plan set,
  [260905f § Stage 4](260905f-debate-mode-what-the-web-says-about-this-piece.md): every row's `url`
  through `publicCitationUrl`, **a refused URL drops the whole row** (a row without its source breaks
  the mode's invariant), the count of dropped rows computed at the boundary and disclosed in the
  visitor's foot line, `searchedAt` crossing deliberately. **And the nested one that plan did not
  name** (Sol, plan review 1, P0): a direct row's `identifies[].url` is copied from the *article's own
  source URL* (src/debate.ts) and printed verbatim, and `articleReferenceQuote` can contain the same
  address — the one `publicMeta` suppresses when it carries a credential or a private host. Public
  row and signal types are rebuilt recursively; a linked signal's URL goes through
  `publicSourceUrl`, and a direct row whose witness names a refused source address is dropped and
  counted. Mutation tests for both nested places.

## The simpler option passed over

**Flip `POLICY.trajectory` to `available` and let the owner's band mount for a visitor**, with the
paid buttons hidden. One line and a prop. Rejected: the owner's band mounts `useTrajectory`, which
GETs `/api/trajectory/:slug` (outside `/api/public/`) and arms `useAutoRun` — the path that spends.
Hiding a button is not a boundary. [260904c](260904c-more-modes-on-a-shared-link.md) § *What every
stage owes* item 4 is the rule this repo already paid for: the visitor renders from data, never from a
hook, and the seam is a component.

**And the smaller scope — Trajectory alone**, which is what the report is about. Rejected because
Greg's report states the rule for *all* modes, and FAQ, Citations and Debate are the same bug with the
same fix. They are staged after Trajectory so the reported one ships first.

## Deferred

- **Stale and outdated banners for a visitor.** No public artefact carries freshness
  (`PublicArtefactSet`'s rule: a visitor cannot act on it). A visitor sees the stored output as it is.

## Stages

Each stage: the failing test first, then the build, `npm run typecheck`, the scoped tests, a GPT Sol
code review that fixes what it finds, commit, push to `dev`.

### Stage 1 — Trajectory (the report)

- [x] Failing test: `tests/public-network-trace.test.tsx` § *draws a stored trajectory from the
  payload, asking nothing* — red on `origin/dev`, the boundary band in the slot.
- [ ] `PublicTrajectory` in `src/public-types.ts`; `trajectory?` on `PublicArtefactSet`;
  `trajectory: boolean` on `PublicArtefacts` (src/types.ts); `shareableArtefacts` (src/store/pg.ts).
- [ ] `trajectory: articleRevisions.trajectory` in `PUBLIC_PROJECTIONS.article`; `publicTrajectory()`
  in `dto.ts`, field by field.
- [ ] `artefactsOf` / `artefactsIn` (src/web/public-artefacts.ts); `NOUN.trajectory`;
  `POLICY.trajectory: { kind: "artefact", key: "trajectory" }`.
- [ ] `VisitorTrajectoryBand` beside `TrajectoryBand`, sharing `useTrajectoryMode`; `TrajectoryPanel`
  takes an `access` union whose visitor arm carries the route and no verbs, no job, no read state.
- [ ] `Reader.tsx` `case "trajectory"`: the visitor branch, gated on `artefacts?.trajectory`.
- [ ] Tests: `BAND_SAYS.trajectory` (the *nobody built one* sentence on the default fixture),
  `public-dto` (exact keys; provenance absent against an over-full input), the projection-column test
  (the silent one), `public-visibility-pg` (a public article with a stored route returns it; a private
  one does not), `visitor-gaps`, `shared-inventory`, and whatever `MODES`-walking test goes red.
- [ ] Docs: trajectory.md's visitor line; any doc listing what a visitor gets.
- [ ] Sol code review → commit → push to `dev` → tell the Overseer the commit.

### Stage 2 — FAQ

The same list on the smallest case: `PublicFaq`, the flag, the column, the DTO, `VisitorFaqBand`, an
access union on `FaqPanel`, `BAND_SAYS`, and the Trajectory stop card's FAQ source from the payload.

### Stage 3 — Citations

The same list, plus `publicCitationUrl` on each `url` (link dropped, row kept), `key` and `found` not
crossing, and a mutation test with a credentialled and a private-host URL.

### Stage 4 — Debate

Its own plan's Stage 4 contract, on `DebatePanel`'s existing `DebateAccess` union, plus the nested
`identifies[].url` and `articleReferenceQuote` handling above.

**As built, 2026-09-29.** `publicDebate` (src/public/dto.ts) rebuilds rows and signals field by
field. A row's `url` goes through `publicCitationUrl`, a refusal dropping the row. A `linked`
signal's address goes through **`publicSourceUrl`**, not `publicCitationUrl`: it is the article's own
address, so it gets the masthead's policy, which also refuses a query string — a refusal takes the
address off the signal. And a row whose *words* (witness, quotation, any string on it) contain a
refused address — the article's own when refused, a refused `linked` address, a refused row source,
each whole and scheme-less — is dropped. The row's own `url` is checked against that set too, so the
article's refused address cannot pass merely because citation policy would allow its query; and the
comparison decodes percent-escaped ASCII, including nested escapes. Every drop is counted per search in `sourceNotPublishable`,
computed at the boundary; the visitor's foot line says it. **No stored count crosses**, so a
visitor's empty search gets a sentence true of both *found nothing* and *could not check*
(`DEBATE_RESPONSES_NONE_SHARED`), and a search emptied by the boundary gets no lead at all. Legacy
rows cross through `readStoredLean` and `identifiesOf`. `tests/visitor-gaps.test.ts` § *the modes a
visitor may not see* is the postmortem's countermeasure 1: chat, remember and referee, each with its
reason.

### What every stage owes (Sol, plan review 4)

260904c's list, in full, for each stage that ships on its own — not abbreviated for the later ones:
`tests/public-imports.test.ts` (only if a table is read), `tests/public-reads.test.ts` (the selected
column), `tests/public-visibility-pg.test.ts` (public vs private, real database),
`tests/public-dto.test.ts` (exact nested keys against an over-full input),
`tests/public-network-trace.test.tsx` (deep links and hostile query parameters, no owner hook, no
paid control drawn), `tests/shared-inventory.test.ts`, `tests/access-sharing.test.tsx` and
`ARTEFACT_KEYS` in `AccessSharing.tsx`, and `/privacy`'s list of what a public article carries plus
`/features/public-readable-sharing` checked against it.

### Finally

- [x] `npm test`, `npm run typecheck`, lint on touched files.
- [x] Browser check in a Sonnet subagent, signed out, on a public article with a stored Trajectory and
  each of the other three.
- [x] Postmortem, feedback note, debrief.

## Progress

**Status as of 2026-09-29: built, on `dev`, not deployed** — evidence: the four commits below, and
the gates.

- **Stage 1, Trajectory** — `b0520cf5`. Red first: *draws a stored trajectory from the payload, asking
  nothing*, red on `origin/dev` with the boundary band in the slot.
- **Stages 2–3, FAQ and Citations** — `81905905`, built by an Opus subagent from stage 1 as template;
  red first for both; column guards mutation-checked.
- **Stage 4, Debate, and GPT Sol's code-review fixes** — `c4947431`. Sol's review
  ([code-review-sol](260929c-a-visitor-sees-every-stored-mode-on-a-public-article-code-review-sol.md))
  found and fixed a P0 (a query-bearing or percent-encoded copy of the article's private address could
  survive in a Debate row) and a P1 (a public citation's `linkFrom: "web"` told a stranger the owner
  had used *Find it*). Its verdict: the boundary is sound, once the claim *"only `/api/public/`"* is
  narrowed for a **signed-in** non-owner, whose session still loads its own `/api/reader` and
  `/api/jobs` — established architecture, unchanged here.
- **The box refused every test run for memory for about four hours** (swap full, MemAvailable under
  the 9.2 GB admission floor). Stage 4 was built blind, and its gates ran afterwards: red first against
  the pre-change policy (4 of 69 in `public-network-trace`), the `debate` column mutation red, both
  files restored and sha256-checked, then 13 runs / ~1,100 tests green.
- **Full suite, after merging `origin/dev`:** 1,190 files passed, 5 red — `cold-start-lazy-imports`
  and `pdf-bundle-trace` (no `api-dist/` in a fresh worktree) and the three `fleet-*` files (no
  `tools/fleet/web/dist/`), all environment, none in code this touches, confirmed by re-running alone.
  Typecheck clean.
- **Browser check, signed out, 1280 and 390** (Sonnet subagent, local database; one private article
  made public for the check and restored): all four modes draw their stored output with none of the
  owner's buttons; missing ones say *Nobody has built…*; Quiz and Chat show the owners-only band;
  no POST, no `/api/` request outside `/api/public/`, no console errors. Screenshots
  `260929c-shot-{trajectory,faq,citations,debate}-*.png`. One cosmetic find, not from this change: a
  Debate source title showing raw `<i>` markup.

