Verdict: the persisted artefact design is mechanically plausible, but it is not the simplest version of Greg’s request and cannot ship as written. The conclusion “build it as a job-backed stage beside FAQ” is wrong for v1 and wrong as the only interactive path. Ship one `Simple` level, pitched around ELI15, through a streamed endpoint first. If persistence/public reuse proves valuable, add the stored stage—or pair that stage with a streamed foreground write path.

## P0

1. **Streaming cannot be deferred.** The plan knowingly gives a waiting reader job progress and withholds the prose until completion, deferring streaming based on measured latency ([plan:169](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/plans/260930i-simple-summaries-eli15-sub-mode.md:169)). The repository rule is unconditional: “Stream any model call a person is waiting on”; pipeline exemption applies only when nobody is watching ([CLAUDE.md:428](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/CLAUDE.md:428)). FAQ’s `onText` merely updates job progress ([faq.ts:647](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/faq.ts:647)); it does not satisfy that rule.

   The existing stored-and-streamed Citations investigation shows the intended shape: stream deltas, emit `done` only after storage ([citation-investigate.ts:7](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/citation-investigate.ts:7)). Either:

   - make v1 a direct SSE route and retain its result only in the current tab; or
   - if persistence is required now, stream the foreground generation and store the completed validated artefact, while retaining the pipeline step for Metadata reruns.

2. **The proposed validation permits uncited generated claims, contradicting the product’s core contract.** The plan promises “Every paragraph is a door” ([plan:45](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/plans/260930i-simple-summaries-eli15-sub-mode.md:45)), then explicitly keeps a paragraph after every invalid ID has been removed ([plan:106](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/plans/260930i-simple-summaries-eli15-sub-mode.md:106)). Vision requires every model assertion to be anchored to a block ID ([vision.md:72](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/project/vision.md:72)), and Summary’s justification depends on that route back to prose ([summaries.md:410](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/project/summaries.md:410)).

   “Why it matters” must either have article support or be omitted. Require at least one surviving body-evidence ID per paragraph; if validation empties a non-empty answer, fail without storing, as FAQ does.

## P1

1. **The plan overbuilds Greg’s quoted request.** Greg asked for one or perhaps two short plain-language orientations; he did not ask for persistence, public projection, Metadata reruns, a migration, or a thirty-file pipeline stage ([plan:11](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/plans/260930i-simple-summaries-eli15-sub-mode.md:11), [plan:177](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/plans/260930i-simple-summaries-eli15-sub-mode.md:177)). That conflicts with the repository’s “simplest version first” rule ([CLAUDE.md:403](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/CLAUDE.md:403)).

   A direct streamed response, retained for the tab, delivers most of the value. If forced to choose a level, ship **ELI15 first**, under the label `Simple`: it is less likely to erase qualifications, numbers, or causal direction. Do not ship both levels initially. Before committing to the age pitch, run the same three articles through ELI12 and ELI15; Greg explicitly said he was unsure, and this comparison is cheaper before schema/UI work than after it.

2. **The cache-benefit and effort rationale are wrong.** Placement beside FAQ is technically correct only if Simple sends byte-identical body-only `articleWithIds` bytes and uses the same effort. But cached prefixes are shared only between compatible steps in the **same job** ([pipeline.ts:604](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/pipeline.ts:604)); separate mode presses do not share them ([models.ts:1466](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/models.ts:1466)). Therefore the claim that Simple will be “mostly a cache read when the reader has used Ideas, Timeline, Quiz or FAQ” is false ([plan:145](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/plans/260930i-simple-summaries-eli15-sub-mode.md:145)).

   Do not choose FAQ’s `high` effort to win this mostly nonexistent saving. The model table explicitly rejects aligning effort merely to win cache sharing ([models.ts:1445](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/models.ts:1445)). Compare `medium` and `high` on the real-paper probe. `capable` as the model tier is consistent with current Messages-wire pipeline machinery; it is separate from effort.

3. **The PROFILE_RULES account is incorrect.** The plan conflates the constant rules with the reader’s actual profile and claims profile use might split the cached prefix ([plan:131](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/plans/260930i-simple-summaries-eli15-sub-mode.md:131)). `PROFILE_RULES` is deliberately constant and does not split a cache ([profile.ts:100](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/profile.ts:100)); the varying `profileSection` belongs after the breakpoint ([profile.ts:195](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/profile.ts:195)). FAQ explicitly has no profile in v1 ([faq.ts:34](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/faq.ts:34)).

   The simplest coherent decision is: Simple v1 is profile-independent, with no `profileSection` and no `profileHash`. Use `plainWords("explain")`; do not claim that every reader-facing prompt takes a profile.

4. **The artefact type is incomplete and its validation is under-specified.** The shown type contains only `paragraphs`, yet the plan later requires stamping and outdated comparison ([plan:93](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/plans/260930i-simple-summaries-eli15-sub-mode.md:93), [plan:110](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/plans/260930i-simple-summaries-eli15-sub-mode.md:110)). A stamped artefact needs the established fields: `version`, `generator`, `slug`, `sourceHash`, `generatedAt`, and `elapsedMs`, plus validation-drop counts if they are to be reported. FAQ demonstrates the required shape ([types.ts:4401](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/types.ts:4401)).

   Validation must also:

   - require a real `paragraphs` array and a non-empty surviving result;
   - settle whether the contract is 1–4 or 2–4—the plan currently says both;
   - enforce the promised total word/character ceiling in code, not merely paragraph count;
   - validate IDs against the exact body-evidence set sent to the model, not every article block;
   - deduplicate IDs, cap them at three, and require at least one per paragraph;
   - reject rather than silently truncate overlong prose;
   - handle malformed JSON, refusal, empty output, and token truncation explicitly.

   FAQ’s body-evidence symmetry is the template ([faq.ts:615](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/faq.ts:615)).

5. **Owner/visitor composition needs an explicit redesign.** Public visibility is the correct policy: generated stored output is public by default ([new-mode.md:216](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/project/new-mode.md:216)). But Summary currently uses one owner-and-visitor component precisely because it fetches nothing ([SummaryMode.tsx:29](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/web/modes/summary/SummaryMode.tsx:29)). Adding an owner GET hook without splitting that seam risks a visitor request.

   The plan must state that owners read through the authenticated hook while visitors receive `simpleSummary` solely from the public article DTO, with no GET or job verbs. The public DTO must rebuild only `{paragraphs: [{text, ids}]}` and strip stamps/drop counts, following FAQ’s projection ([dto.ts:478](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/public/dto.ts:478)). Add the public network and DTO allowlist tests, not just “visitor sees one.”

6. **The activation and URL integration is incomplete.** Arming on the Simple chip and not on URL arrival is correct, as is `?summary=simple`; it matches the mode-specific `remember`, `referee`, and `diagram` naming convention. But the plan omits:

   - arm before checking whether Simple is already selected, so a second press can recover from a failed read ([QuizPanel.tsx:170](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/web/QuizPanel.tsx:170));
   - add `summary` parsing to `ModeBoundary`, its reset key, and `bandTarget`, so an error before `useAutoRun` claims the token retires it ([new-mode.md:43](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/project/new-mode.md:43), [ModeBoundary.tsx:110](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/web/reader/ModeBoundary.tsx:110));
   - decide how a top-level Summary press behaves when the retained URL already says `summary=simple`; currently Summary is declared free and arms nothing ([activation.ts:258](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/web/activation.ts:258));
   - add the new key to `REMEMBERED`—the likely choice because arrival is inert—or `NEVER_REMEMBERED`; otherwise the last-view test should fail ([last-view.ts:58](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/web/last-view.ts:58)).

7. **PROMPT_VERSION and migration direction are broadly right, but the tests and UI rule are missing.** An additive JSONB column plus widening the step-name CHECK is the correct migration shape. One exported `PROMPT_VERSION`, used both in the stored artefact and the expected stamp, is also correct. The owner GET must return distinct `stale` and `outdated`; only stale may produce a panel notice, while outdated remains silent ([new-mode.md:257](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/project/new-mode.md:257)). The plan should name tests for `stepIsDone`, stale input, outdated prompt, and “outdated is not announced.”

## P2

1. **“Outline” resurrects a retired product term.** `outline` now resolves to Structure ([url-state.md:39](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/project/url-state.md:39)). Calling Summary’s existing half `Outline` creates two meanings for a deliberately retired name. Prefer `Gists | Simple`, or leave the default chip labelled `Summary`.

2. **The stage/test list is too generic for the known residue.** If persistence remains, explicitly add coverage for:

   - article-cache grouping and exact request-byte/fingerprint agreement;
   - metadata fallback head;
   - stamp agreement and pipeline store/load;
   - malformed/overlong/all-unanchored validation, refusal and truncation;
   - authenticated route and offline-cache registration;
   - export/import coverage;
   - public projection, DTO stripping, and zero visitor network calls;
   - chip press, repeated chip press, URL/Back non-arming, error-boundary token retirement;
   - last-view registration;
   - stale shown/outdated hidden;
   - BlockRef hover and jump;
   - the changed `ModeSurface` header shape.

   Also update the Messages-wire prompt inventory in `docs/project/ai-gateway.md`; the plan currently names only `summaries.md` and `url-state.md`.

So: **ELI15 first, one level, labelled Simple; streaming is required now; and the job-backed FAQ-style stage should not be accepted as the simplest v1 or as the sole reader-facing execution path.**