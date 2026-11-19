## Findings

**F1 — P1 — The follow-up searches cross an established security boundary.**

Evidence: the plan lets each Haiku reader read hostile web text and then emit up to two searches ([plan:78](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md:78), [plan:95](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md:95)). The mirrored implementation explicitly forbids that exact path because “a query written after reading web pages is a search steered by those pages” ([situate.ts:36](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/src/situate.ts:36), [situate.ts:45](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/src/situate.ts:45)). `validateQueries` removes addresses and operators, but does not stop a page steering the subject or causing article text to be echoed into a query ([situate.ts:438](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/src/situate.ts:438)).

Concrete change: remove page-informed follow-up searches from v1 and spend the fixed search budget in the trusted planner phase. If they are essential, the plan needs a separately reviewed admission design and an explicit security-risk decision; merely passing them through `validateQueries` is insufficient.

**F2 — P1 — Quote checking is specified, but the end-to-end untrusted-text boundary is not.**

Evidence: the readers receive longer web extracts and the writer receives their reports ([plan:78](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md:78), [plan:84](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md:84)), but the only stated defense is checking quotations ([plan:105](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md:105)). Quote validation does not stop an extract from instructing a reader, nor a tainted report from instructing the writer. `situate` separately fences the article and every evidence body and repeats the instruction after the fence ([situate.ts:900](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/src/situate.ts:900), [situate.ts:921](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/src/situate.ts:921)); the security map treats stranger-text-to-model fencing as its own defense ([security-map.md:132](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/project/security-map.md:132)).

Concrete change: require `untrusted()` fences for article passages and every search-result body at the reader boundary, then fence the reader reports and evidence again at the writer boundary, with trusted instructions after the fences and no tools. Add planted-instruction tests proving hostile extracts cannot close a fence, produce operational output, or become writer instructions.

**F3 — P1 — Owner-only reading contradicts the mode artefact contract without deciding an exception.**

Evidence: the plan makes the generated digest owner-only and deliberately maps a visitor’s digest address to Bibliography ([plan:169](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md:169)). The authoritative checklist says a stored generated artefact is readable by visitors by default; owner-only is for the reader’s own writing ([mode.md:467](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/project/mode.md:467)). Situate is a named exception, not a rule that automatically transfers to every sibling ([pg.ts:2880](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/src/store/pg.ts:2880)).

Concrete change: either add the public projection/DTO and visitor rendering for a stored digest, stripping provenance and interactive verbs, or make “Digest joins `NeverShared`” an explicit product decision with its reason and Greg’s approval. “As the dossier” is not enough to override the default.

**F4 — P1 — The new ask boxes can construct a first message the chat route refuses.**

Evidence: the plan sends the reader’s question together with the digest or summary text ([plan:180](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md:180)). A chat question, context included, is capped at 4,000 characters ([types.ts:6575](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/src/types.ts:6575)), while Fuller may contain 1,400 words ([types.ts:7108](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/src/types.ts:7108)). The existing paragraph handoff deliberately caps and escapes its quoted context for this reason ([chat-handoff.ts:93](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/src/web/chat-handoff.ts:93)).

Concrete change: define one shared builder that reserves room for the reader’s words and fixed headings, then fences and visibly truncates the digest/summary context to the remaining allowance. Test the maximum Fuller, maximum digest, fence-breaking quotes, surrogate boundaries, and a maximum-length reader question against `MAX_CHAT_QUESTION_CHARS`.

**F5 — P2 — The fan-out and duration bounds contradict one another.**

Evidence: 16 leads × 3 initial searches permits 48, despite the diagram claiming at most 40; 16 × 2 follow-ups adds 32, making the possible total either 72 or 80 depending on which statement wins ([plan:74](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md:74), [plan:76](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md:76), [plan:95](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md:95)). The rate policy says “one at a time” but gives no lease or step budget. `RatePolicy` requires a lease ([contracts.ts:3657](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/src/store/contracts.ts:3657)), and Situate explicitly sizes it to the whole step budget so a slot cannot expire mid-run ([situate.ts:229](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/src/situate.ts:229)).

Concrete change: declare code-enforced global caps for initial, follow-up, total pages, and total characters; give every call a timeout; derive a pessimistic `STEP_BUDGET_MS.sources-digest`; and set the allowance lease to cover it. Test that the lease cannot expire during the maximum permitted run.

**F6 — P2 — The cost estimate omits the capable planner and is not aligned with the stated caps.**

Evidence: `digest-plan` is a paid capable-model call, potentially Opus under high-powered AI ([plan:73](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md:73)), but the estimate totals only searches, Haiku readers, and the Opus writer ([plan:123](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md:123)). Its 40–70 search range also does not match the possible 10–80 range currently described.

Concrete change: include the planner, distinguish standard/high-powered and expected/worst-case totals, and derive the search and reader ranges from the final enforced caps. Keep the whole estimate labelled unmeasured until the proposed real-run investigation.

**F7 — P2 — Marking the registry row experimental does not hide a Sources chip.**

Evidence: Stage 2 treats `experimental: true` on `SOURCES_SUB_MODES` as the switch wiring ([plan:216](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md:216)). Today the Sources chip row maps `SOURCES_CHIPS` directly and never consults that field or the switch ([SourcesMode.tsx:623](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/src/web/modes/sources/SourcesMode.tsx:623), [SourcesMode.tsx:641](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/src/web/modes/sources/SourcesMode.tsx:641)). The registry flag hides command-bar rows, not this chip.

Concrete change: state that `experimental.on` is threaded into `SourcesViews` and the chip list uses `shownBehindTheSwitch`, preserving a current digest chip for pasted addresses. The planned switch-off test is good and should remain.

The summary identity suspicion is resolved: `SimpleSummary` has one `generatedAt` shared by both levels ([types.ts:7173](/var/tmp/spideryarn-worktrees/fbvqmfrs-sources-digest/src/types.ts:7173)), so `level + generatedAt` distinguishes Brief from Fuller and distinguishes rewrites. I also found no rule conflict in making an explicit Digest-chip press start the job; arrivals remain non-spending.

Verdict: revise.