No P0 findings.

### P1 — The text-loss holes are only closed for popover dismissal, not unmount

The latch covers outside press/Escape only while `ProfilePanel` is alive. Its editor remains conditional on `open`, and the whole mode subtree is discarded when the reader changes modes or articles ([ProfilePanel.tsx:185](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/ProfilePanel.tsx:185), [Reader.tsx:1926](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/reader/Reader.tsx:1926), [ArticlePage.tsx:223](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/article/ArticlePage.tsx:223)). Clicking the dock is especially concrete: `useDismiss` may refuse to close the popover, but it does not cancel the dock’s navigation, so the band still unmounts.

`useAutosavedText` flushes on `visibilitychange` and `pagehide`, not component unmount; SPA mode/article navigation fires neither ([useAutosavedText.ts:203](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/useAutosavedText.ts:203)). Dictation explicitly aborts on unmount without `onEnd` or a save ([useDictation.ts:548](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/useDictation.ts:548), [useDictation.ts:1854](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/useDictation.ts:1854)). The device recording is best-effort recovery, not closure of the hole.

The retained full-page links are another bypass unless navigation is deferred until clean; today they close and navigate directly ([ProfilePanel.tsx:312](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/ProfilePanel.tsx:312), [Link.tsx:37](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/Link.tsx:37)).

The plan needs an unmount/navigation design and tests, not only dismissal tests.

### P1 — Quotes’ named `regenerate()` does not replace a current list

The plan says Quotes uses “`regenerate()` — replace, not Find more,” but the hook documents and implements the opposite: a forced run appends to a current article/current-prompt list ([useQuotes.ts:168](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/useQuotes.ts:168), [useQuotes.ts:308](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/useQuotes.ts:308)).

Crucially, Quotes deliberately does not reject an append when the profile differs ([quotes.ts:931](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/quotes.ts:931)). It appends new-profile quotes to the old list and retains the original profile stamp ([quotes.ts:1132](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/quotes.ts:1132)). Consequently, pressing the proposed Regenerate after a profile edit would append, leave the badge changed, and fail the button’s promise.

Quotes needs a distinct replace intent in the job/server contract; the existing callback cannot be reused.

### P1 — An offline cached profile is treated as authoritative and editable

`apiFetch` turns a failed cacheable GET into a synthetic successful `200` with `x-spideryarn-offline: copy` ([api.ts:598](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/lib/api.ts:598), [api.ts:676](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/lib/api.ts:676)). `ProfilePanel` immediately parses that response as ready without inspecting the header ([ProfilePanel.tsx:232](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/ProfilePanel.tsx:232)).

Thus the plan’s “failed read is disabled” rule does not cover an offline copy. A reader can be shown an old profile as current, reconnect, and overwrite newer server text. Offline-copy reads should be visibly read-only, or edits must first obtain an authoritative read.

### P1 — Skim would have two independent editors for the same purpose

Skim already mounts `PurposeLine` over every ready owner route ([SkimPanel.tsx:632](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/SkimPanel.tsx:632)). When the purpose is empty, it owns an independent draft, save, and replan path ([SkimPurpose.tsx:36](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/SkimPurpose.tsx:36), [SkimPurpose.tsx:80](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/SkimPurpose.tsx:80)).

For a route profiled from “About you” but with no purpose, adding the editable badge creates two live purpose editors. Saving in the panel does not refresh `PurposeLine`; its stale draft can later overwrite the newly saved sentence. The plan should consolidate them or explicitly revalidate/share state.

### P2 — `savedThisVisit` is an event, not evidence that regeneration is needed

The flag becomes permanently true after any successful write until reseeding ([useAutosavedText.ts:176](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/useAutosavedText.ts:176)). Editing and reverting, or typing whitespace that the server normalises back to the original value, therefore offers a paid regenerate even though the current rendered profile still matches the artefact.

That is wasteful for replacement modes and unsafe for append-capable modes. Gate on actual current-profile hash versus artefact hash, or re-read the mode’s provenance after both saves settle. In the ordinary changed-profile case, the proposed dirty/in-flight checks are otherwise sufficient to prevent a job starting against the old saved profile.

### P2 — Glossary has no existing “forced replace” verb

`useGlossary` exposes an unforced `find()` and a forced `more()`; the latter appends when source, prompt, and profile match ([useGlossary.ts:568](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/useGlossary.ts:568)). An actual profile-hash mismatch makes either path rewrite because `existingFor` rejects it ([glossary.ts:407](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/glossary.ts:407)), but a `savedThisVisit` false positive makes `more()` append or `find()` skip. The plan must name which call it uses and prove the final list was replaced.

### P2 — Preserve Skim’s exceptional provenance rule and explicitly override Sketch’s UI rule

Skim regards `null → hash` as profile-changed ([skim.ts:444](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/skim.ts:444)), whereas `WrittenForYou` renders nothing for an artefact written without a profile ([WrittenForYou.tsx:93](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/WrittenForYou.tsx:93)). Therefore its existing profile-changed banner must remain for a formerly plain route; the new badge cannot replace it. Skim’s regenerate intentionally replans only the route and does not rerun merely profile-changed Quotes or Ideas ([useSkim.ts:172](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/useSkim.ts:172)); the plan should state that cost boundary.

Sketch currently records that offering a paid redraw beside an existing picture is a product decision it intentionally does not make ([SketchView.tsx:276](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/SketchView.tsx:276)). Greg’s newer request is sufficient to override it when the profile changed, but the plan should explicitly update that comment/document and remove the duplicate profile-changed caveat line.

## Verdict

The normal “save finishes, then press Regenerate” gating is sound for Summary, Ideas, Tweets, Sketch, and the Skim route. The plan is not ready to build because navigation still loses drafts/dictation, offline copies are editable, and Quotes does not have the replacement operation the plan claims.

The simplest robust shape is one owner-level modal editor, mounted outside the mode switch, opened by every reusable badge. Keep it mounted until both saves settle, defer its own navigation links, use authoritative hash comparison for Regenerate, and give Quotes an explicit replace operation. This still lets the reader edit without leaving the article while removing most of the popover-lifecycle hazards.