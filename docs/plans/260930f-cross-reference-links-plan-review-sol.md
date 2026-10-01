## Verdict: build with changes

The central design is sound: generate sparse `{from, phrase, to}` relations, validate them against stable block IDs, annotate the source phrase, reuse the existing block preview, and jump through `beginJump`. That directly answers Greg’s request.

I would not build the current plan unchanged. The P0/P1 items below should first be incorporated into it.

### F1 — P0: the public route wording could expose private articles

**Evidence:** The plan combines `GET /api/crossrefs/:slug` with “visitor-readable” and “cacheable” ([plan:80](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md:80)). In the real server, ordinary `/api/...` routes are owner-authenticated ([routes.ts:6707](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/routes.ts:6707)), while public artefacts travel inside the existing public article payload ([public-types.ts:255](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/public-types.ts:255)) through the visibility-checked query ([public-reader.ts:474](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/store/public-reader.ts:474)). Public responses are deliberately `no-store` until visibility-aware invalidation exists ([routes.ts:6647](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/routes.ts:6647)).

**Fix:** State explicitly:

- `/api/crossrefs/:slug` is owner-authenticated and may join the owner’s offline cache.
- Visitors receive crossrefs only inside `/api/public/article/:publicSlug`, through `PUBLIC_PROJECTIONS`, the public DTO, and the existing `visibility = 'public'` predicate.
- No new anonymous by-slug endpoint and no HTTP caching of the public payload.

Add a test proving an anonymous request cannot distinguish a private slug from an absent one.

### F2 — P0: the sanitiser change leaves an exploitable app-chrome forgery

**Evidence:** The plan adds only `data-xref` to `FORBID_ATTR` ([plan:93](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md:93)). The sanitiser explicitly says every new annotation kind requires three changes: attribute, reserved class, and version bump ([sanitize-policy.ts:94](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/sanitize-policy.ts:94)). The reserved-class list currently omits `xref` ([sanitize-policy.ts:627](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/sanitize-policy.ts:627)). Worse, `BlockLinkCard` delegates to any `[data-block-link]` in the document ([BlockLinkCard.tsx:105](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/BlockLinkCard.tsx:105)), and that control attribute is not currently forbidden.

A hostile article could therefore forge an app-looking xref and a genuine target preview on words of its choosing.

**Fix:** In one change:

- Forbid `data-xref`, `data-block-link`, `data-block-preview`, and `data-block-missing` at ingress.
- Reserve the `xref` class.
- Bump `SANITIZER_VERSION`.
- Make the click handler resolve `data-xref` through the validated artefact and derive `to` from that lookup; never trust the DOM’s `data-block-link` as the authority.
- Test hostile source HTML carrying every one of those names.

### F3 — P1: most prompt rules are not enforced by validation

**Evidence:** The prompt requires non-adjacent links, 2–12 words, one link per phrase, and a length-scaled cap ([plan:53](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md:53)). The validator section enforces none of those except overlaps ([plan:63](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md:63)). Existing Ideas code explicitly enforces its cap because model instructions are not a bound ([ideas.ts:362](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/ideas.ts:362)). Existing Referee validation also rejects a missing/non-array root rather than treating it as a legitimate empty answer ([referee-claims.ts:1006](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/referee-claims.ts:1006)).

**Fix:** Define and enforce an exact cap formula, adjacency from block positions, the word bound, duplicate phrase/source pairs, and malformed rows. Only an explicit `{links: []}` is a valid empty answer; `{}`, `null`, or a non-array `links` must throw. Add each case to the red-first validation tests and dropped counters.

### F4 — P1: accepted links can silently fail to render

**Evidence:** Server validation uses a `"spaced"` match against `block.text`, but `xrefMarks` is planned to copy `citeMarks`, which searches rendered HTML text and rejects repeated phrases ([annotate.ts:982](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/annotate.ts:982)). Its documentation explains why “first match in `block.text`” cannot identify the corresponding rendered occurrence and therefore permits only a unique rendered match ([annotate.ts:918](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/annotate.ts:918)).

**Fix:** Make renderability part of server validation. For v1, reject a phrase unless it has exactly one match in the rendered text of `from`; store the exact article slice. Share an import-safe locator or parse `block.html` server-side. Test repeated phrases, whitespace around markup, entities, and a phrase split by `<em>`.

### F5 — P1: overlapping annotations produce two cards or two actions

**Evidence:** The delegated block card does pick up a prose mark because it uses `closest("[data-block-link]")` ([BlockLinkCard.tsx:259](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/BlockLinkCard.tsx:259)). However, `annotateHtml` deliberately merges overlapping kinds into one mark ([annotate.ts:73](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/annotate.ts:73)). An xref overlapping a term or citation will also match `ProseHoverCard` ([ProseHoverCard.tsx:376](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/ProseHoverCard.tsx:376)); on touch, term/citation marks have first-tap behavior of their own ([ProseHoverCard.tsx:448](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/ProseHoverCard.tsx:448)). An xref overlapping a comment or chat can open that artefact on `mouseup` and then jump on `click` ([TableView.tsx:1313](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/TableView.tsx:1313)).

Handling only authored `<a>` elements is insufficient.

**Fix:** Declare precedence. The simplest v1 is “xref wins on an xref-bearing piece”:

- `ProseHoverCard` ignores `.xref` marks.
- Its touch selector excludes `.xref`.
- `TableView.onMouseUp` returns after a genuine selection but before comment/chat activation when the target is an xref.
- Test xref × term, citation, comment, chat, search/quote, and authored link on mouse and touch.

### F6 — P1: `tabindex` and `role=link` do not implement the stated keyboard behavior

**Evidence:** The plan asserts that `role="link"` makes Enter follow the mark ([plan:100](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md:100)). It does not: a non-native element needs a key handler. Also, one logical range becomes one `<mark>` per text node ([annotate.ts:20](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/annotate.ts:20)), so indiscriminate `tabindex=0` creates several tab stops for an emphasized phrase. Modified clicks also do nothing on a mark because, unlike the existing internal links, it has no real `href` ([TableView.tsx:1177](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/TableView.tsx:1177)).

**Fix:** Decide this before building:

- Mark only the first generated piece as the focus stop.
- Add delegated Enter handling that invokes the same validated jump.
- Keep continuation pieces clickable but out of the tab order.
- State honestly that modified/new-tab behavior is unsupported for this synthetic in-page action, rather than saying it is “left alone”.
- Test a phrase split across several text nodes: one Tab stop, one Enter jump.

Do not leave keyboard access as an implementation-time fallback.

### F7 — P1: the plan omits the data path that makes standing marks appear

**Evidence:** Standing owner annotations are fetched unconditionally in `ArticlePage` ([ArticlePage.tsx:436](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/article/ArticlePage.tsx:436)) and carried through `ReaderCapability` ([reader-capability.ts:45](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/reader-capability.ts:45)); visitor artefacts are lifted from the public payload separately ([public-artefacts.ts:60](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/public-artefacts.ts:60)). The plan’s stage only says “TableView marks and click”. It also does not mention adding xrefs to `ProseEntry`, `sameInputs`, or the memo dependencies—the exact omission that made citation marks appear intermittently ([TableView.tsx:1050](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/TableView.tsx:1050)).

**Fix:** Name the full path in the plan: owner read hook → `ArticlePage` → owner capability; public projection/DTO → `PublicArtefactSet` → visitor capability; `Reader` → `TableView`/card provider. Add xrefs to the prose cache value, equality key, and memo dependencies. Test a late owner GET causing marks to appear and a signed-out visitor rendering from the public payload without making an authenticated GET.

### F8 — P1: carrying stale crossrefs would show unlabelled wrong links

**Evidence:** “Carry like Ideas” means retaining an artefact when the article changes; Ideas relies on read-time staleness and labels it ([pg-revisions.ts:304](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/store/pg-revisions.ts:304)). Crossrefs have no panel in which to disclose staleness. Public artefacts deliberately contain no `stale` state ([public-types.ts:274](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/public-types.ts:274)). A carried relation may still have two surviving IDs and a matching phrase while no longer being semantically true.

**Fix:** Carry it in storage as the revision system expects, but do not draw stale crossrefs. Omit them from the public DTO when their fingerprint is stale and give the owner hook no drawable links until regeneration. Test a revision in which the source phrase and target IDs survive but the relation’s input hash changes.

### F9 — P1: “does not stream” conflicts with the chosen token budget

**Evidence:** Ideas uses `streamMessage` internally ([ideas.ts:929](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/ideas.ts:929)). The shared budget reserves 40,000 reasoning tokens, and the SDK refuses large non-streaming requests because they outlive the HTTP timeout ([token-budget.ts:49](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/token-budget.ts:49)).

**Fix:** Say that the job has no incremental reader UI, but the provider request still streams internally through `streamMessage`, ending at `finalMessage()` so spend is recorded. Define a crossref-specific answer estimate for `budgetFor`; do not reuse Ideas’ item calculation.

### F10 — P2: drop `why` from v1

**Evidence:** Greg asked for a preview of the linked-to block, not a generated explanation ([plan:3](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md:3)). `BlockLinkCard` already supplies the target section and target snippet ([BlockLinkCard.tsx:108](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/BlockLinkCard.tsx:108)). `why` adds model output, validation, public data, provider plumbing, and an unsupported model assertion in front of the reader.

**Fix:** Make v1 `{from, phrase, to}` and reuse `BlockLinkCard` unchanged. The target’s own words are the safest explanation of what is there. Add `why` only if real use shows the preview is insufficient.

### F11 — P2: the proposed fingerprint includes an input the prompt does not

**Evidence:** The plan names `articleWithIdsFingerprint` ([plan:72](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md:72)). That fingerprint includes the tree ([source-hash.ts:384](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/source-hash.ts:384)); Ideas legitimately uses it because its user prompt includes the tree ([ideas.ts:966](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/ideas.ts:966)). The crossref plan specifies only `articleWithIds`.

**Fix:** Either include the tree in the actual prompt because section structure materially guides linking, or create a fingerprint over the exact article/head bytes actually sent. Do not make an unrelated tree change mark an identical paid request stale.

### F12 — P2: the registration checklist is no longer complete

**Evidence:** The plan relies on `mode.md`’s artefact checklist ([plan:74](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md:74)), but newer exhaustive registries include `STEP_SHARING` ([sharing-steps.ts:70](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/sharing-steps.ts:70)), `RESET_ROLE` ([reset-role.ts:51](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/reset-role.ts:51)), and the AI job disposition table ([cost-categories.ts:170](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/cost-categories.ts:170)). The owner artefact route must also join the offline-cache list, whose derived test expects every artefact GET ([api.ts:821](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/web/lib/api.ts:821)).

**Fix:** Add an explicit inventory covering at least `STEP_SHARING`, `RESET_ROLE`, `JOB_DISPOSITION`, metadata icon/label maps, authenticated-route contract inventory, `CACHEABLE`, export, storage projection, public DTO, and public/client artefact maps. Most are compiler- or test-enforced, but the plan should not call an older list complete.

### F13 — P3: the cost range is plausible, but the book claim is not supported

**Evidence:** `$0.08–0.20` is a reasonable provisional estimate from Ideas, but output is capped at 60 links while adaptive reasoning is not linear in article length. “A book-length article costs proportionally more” ([plan:129](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md:129)) is therefore not established and ignores the one-call context ceiling.

**Fix:** Call the range provisional. Measure the feedback article as well as the named fixture, recording input, cache, reasoning, output tokens, and exact cost. Replace the book sentence with the actual one-pass length/refusal behavior.

The answer to the three stated suspicions is therefore: `BlockLinkCard` does detect the mark, but overlaps do conflict; `tabindex`/`role` is insufficient and fragments multiply focus stops; and `why` should be removed from v1.

No files were changed. The pre-existing untracked review-prompt file remains untouched.