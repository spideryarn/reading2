UI-PLAN-9K

The sweep is worth doing, but several builder instructions need correction. The error-style leak, shelf filter omission, raw failure messages, glossary stepper defect and Referee retry defect are real. The Quotes-arrow claim is false, and the proposed colour and failure-helper changes are incomplete.

I reviewed by content, compared the CSS declarations with one offline script, and calculated contrast including opacity. No browser, network, database or file edits were used.

1. **U1 — P1 — `--destructive` alone does not make both error rows legible.**

   Evidence: [mode-band.css](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/styles/mode-band.css) gives `.chat-tool-detail` **`opacity: 0.7`**. Chat’s band uses `--panel`; `ChatDialog` reuses `Conversation` over `--surface-raised`. [dock.css](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/styles/dock.css) puts `.dock-question-state` over `--panel`.

   Calculated contrast:

   | Text and surface | Dark | Light |
   |---|---:|---:|
   | Opaque destructive on panel — dock row | 5.20:1 | 4.78:1 |
   | Destructive at 0.7 opacity on panel — chat band | 3.10:1 | 3.16:1 |
   | Destructive at 0.7 opacity on raised surface — chat dialog | 2.78:1 | 3.37:1 |
   | Opaque destructive on raised surface | 4.38:1 | 5.37:1 |

   The values in [styles/tokens.css](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/styles/tokens.css) resolve approximately to `#F14E45` in Dark and `#CC2826` in Light. These are small text, so the chat detail fails the plan’s 4.5:1 bar in both themes. Merely removing its opacity still misses on Dark’s raised surface.

   **Replace the instruction with:** make error text pass on both actual surfaces, including opacity and hover states. Reusing `--destructive` for the dock is reasonable. A distinct, measured error-*text* token could earn its keep for chat; it would have a different purpose from the destructive fill. Rejecting a redundant alias was reasonable, but rejecting every `--danger` solution before checking its purpose was premature. Do not globally change a token used by destructive buttons to repair these two text rows.

2. **U2 — P2 — the error-style census must preserve reduced-motion loading, and the leak affects more than padding.**

   The complete bare-class emitters I found are:

   | Emitter | Element |
   |---|---|
   | [ArticlePage.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/article/ArticlePage.tsx) | `<pre className="error">` |
   | [LogoLoader.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/LogoLoader.tsx) | Reduced-motion `<div className="loading">` |
   | [ChatPanel.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/ChatPanel.tsx) | Runtime `li.chat-tool.error` |
   | [Dock.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/Dock.tsx) | Runtime `span.dock-question-state.${c.status}`, including `error` |

   I found no additional bare emitters through runtime class construction or class mutation. Prefixed names such as `chat-loading`, `read-error` and `is-error` do not match.

   **Scoping only the error arm to `pre.error` is safe.** Replacing the whole combined rule with `pre.error` would break `LogoLoader`’s still fallback.

   [shell.css](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/styles/shell.css) also supplies colour, mono face, `13px` type and `pre-wrap`. Removing its match changes the failed chat tool’s typography and whitespace, and the dock preview’s whitespace, as well as padding.

   **The plan should name those effects**, preserve `.loading`, and characterise the complete intended row styling rather than measuring only padding.

3. **U3 — P1 — the focus repair is justified, but “each takes the dominant mark” is unsafe and “nobody else sees anything” is false.**

   Evidence and required treatment:

   | Control | Focus today | Required qualification |
   |---|---|---|
   | Profile contents entries | `PageContents`: outline suppressed; text changes to `--highlight-text` | Full-width buttons sit in an unpadded scrolling `<ul>`. An outward outline clips at its edges. Use an inset mark or provide verified room. |
   | `.prof-box-input` | Outline suppressed; border changes to raw `--highlight` | A stronger mark is justified. Check all consumers, including Add and profile panels, rather than only `/profile`. |
   | `.outln-row.focused` | Existing **inset box shadow** in raw orange | Change its colour; adding an outline duplicates the mark. Retain inset geometry because the list scrolls and the band hides overflow. |
   | Marginalia question, idea, arc and relation buttons | Existing 2px outline, offset 2px, in `--rule-strong` | Recolour the existing outlines. At a 12px root, the `.5rem` grid gap is 6px while two outward marks occupy 8px, so neighbours can collide. |
   | Collapsed chat card | Existing 2px outline with **`outline-offset: -2px`** | Recolour it and preserve the inset; `.chat-dialog` has `overflow: hidden`. |
   | Profile collapsible headings | `PageSection`: outline suppressed; text changes colour | Shared with Metadata, so the repair affects both pages. |
   | Shelf details trigger | Outline suppressed; text changes colour | `ShelfCard` already changes its surrounding border on `focus-within`; adding a local mark adds to that existing indication. Its generous card padding avoids edge clipping. |

   The corresponding evidence is in [PageContents.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/PageContents.tsx), [PageSection.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/PageSection.tsx), [profile.css](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/styles/profile.css), [outline-mode.css](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/styles/outline-mode.css), [marginalia.css](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/styles/marginalia.css), [dialogs.css](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/styles/dialogs.css) and [ShelfEntry.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/ShelfEntry.tsx).

   Crucially, [OutlinePanel.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/OutlinePanel.tsx) derives a `focused` row and emits that class **without requiring keyboard focus**. Its changed mark is visible to mouse readers too.

   **The plan should prescribe geometry per control.** Repairing invisible keyboard focus does not inherently need a design question; changing a persistent selection mark beyond its colour does.

4. **U4 — P1 — K1 and K2 do not have disjoint file sets.**

   K1 says “stylesheets only, plus … `ProfilePage`”, but the controls actually live in `PageContents.tsx`, `PageSection.tsx` and `ShelfEntry.tsx`. K2 needs `ShelfEntry.tsx` for the Built sentence, and an adequate composition repair needs `PageContents.tsx`.

   **Replace the wave claim with an explicit manifest**, including tests. Give these files one owner, or sequence the component-focus work after K2. K1 is also large enough to warrant separate review checkpoints for status styling, focus and miscellaneous cascade corrections, even if it keeps one worktree.

5. **U5 — P2 — K1’s remaining CSS claims mostly hold, but two fixes need sharper boundaries.**

   Confirmed by content:

   - The later fullscreen `.sk-in-full .sk-scene` cap overrides `.sk-scene.on`. Apply the larger cap only to closed chips.
   - `.gloss-btn:hover` matches disabled buttons; `:not(:disabled):hover` is the small repair.
   - `.tooltip.tip-cite` and `.tip-hit` replace the viewport-aware maximum with `26rem`. Restore the viewport cap; actual overflow correctly remains a hypothesis until measured.
   - `.quotes-hint` really uses two `!important`s against `.quotes-empty p`; `.quotes-empty .quotes-hint` can replace them for its current emitter.
   - Both undefined tokens and all six destructive fallbacks are as described. `--ink-faintest` currently falls back to `--ink-faint`, so that substitution preserves rendering.
   - All three named false comments exist.
   - Feedback’s mix with transparent does not introduce the explicit-grey hue problem described in the token comments; switching interpolation is a consistency cleanup.

   **For the iOS floor**, [narrow-window.css](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/styles/narrow-window.css) explicitly says utilities outrank this rule. `tw:any-pointer-coarse:text-base` also becomes 12px at a 12px root. Changing only the CSS rule leaves those fields unprotected; `PageContents` and Help have utility-sized fields too.

   **Say:** use a minimum equivalent to `max(1rem, 16px)` and cover utility-owned fields. A literal `16px` would unnecessarily shrink fields for readers who enlarged their root type.

6. **U6 — P1 — K2’s four handlers are real defects, but the composition census is materially incomplete.**

   [key-chord.ts](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/key-chord.ts) is the right helper: it covers native and React composition flags plus `keyCode === 229`.

   For the named handlers:

   - **RenameRow:** guard after its unconditional `stopPropagation`.
   - **Composer:** guard after its unconditional `stopPropagation`, before the Escape ladder.
   - **Shelf search:** guard before acting; preserve the existing conditional Escape propagation rule.
   - **Help search:** same arrangement as shelf search.

   Returning before the unconditional stops lets composition keys escape handlers that deliberately contain them.

   **There is a fifth identical search shape:** `PageContents` navigates on Enter and clears on Escape without a guard. There is also `ChatPanel`’s question editor, whose Escape cancels during composition.

   The wider input/textarea census finds:

   - Search and `DockQuickSearch` guard **Enter only**; Escape still clears.
   - Annotate’s textarea and Comment’s follow-up/comment editor clear or restore text on Escape without composition protection.
   - Quiz, Feedback, ProfileBox and AddPage execute their modified-Enter actions without this guard.
   - `TitleEditor` cancels on Escape without it.
   - Sign-in email and new-password fields move focus on Enter without it.
   - TagEditor and CommandBar use only `nativeEvent.isComposing`, missing the helper’s older sentinel. CommandBar also prevents default before testing composition.

   **The plan should inventory and assign these, rather than claim the existing consumers are fully protected.** For implicit form submission, follow Debate’s pattern: prevent the composing Enter from submitting, rather than merely returning.

7. **U7 — P1 — local guards alone can still close the surface during composition.**

   [Dock.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/Dock.tsx)’s drawer Escape listener runs in capture and has no composition guard. It can close the drawer before `RenameRow` runs. [useEscapeToClose.ts](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/useEscapeToClose.ts) likewise closes Chat, Annotate and Comment panels without checking composition.

   **The plan should guard the owning listeners as well.** A component-only synthetic-event test would miss this reachable failure. Test through the mounted surface and native propagation.

8. **U8 — P1 — Help’s behaviour is described incorrectly.**

   In [HelpPage.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/help/HelpPage.tsx), Enter calls `onGo(results[0])`, changes the fragment and initiates section arrival. It does not merely blur the search field.

   **Say:** composing Enter must not navigate to a Help result; composing Escape must not clear the query.

9. **U9 — P2 — the shelf defect is real, but the derivation is not specified.**

   [Library.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/Library.tsx) passes only `unread` to `Passages`. Its `chosenSets` already combines topic and tag membership, and [shelf-narrow.ts](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/shelf-narrow.ts) supplies the needed operation.

   **Specify:** derive allowed slugs from `narrowShelf(scope, { query: "", unread: show === "unread", topics: chosenSets })`. Preserve unrestricted/loading semantics when appropriate.

   **Do not derive them from `rows`**: that applies title/byline/site/gist matching to passage hits and suppresses articles whose bodies contain the query but cards do not.

   Keep `ShelfSearchAlso`, archived tallies and `ShelfPublicSection` separately scoped. Their counts deliberately precede the owner’s narrowing. Update the two Unread-specific passage sentences and comments. The existing server-cap limitation remains and must not become a claim that no matching passage exists anywhere.

10. **U10 — P2 — K2’s factual copy fixes are justified, but the Built repair must stay small.**

    The stale Learn accessible name, Admin’s “Only Gift vouchers…” assertion and removed zoom description all exist.

    [ShelfEntry.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/ShelfEntry.tsx) also makes the false “nothing beyond the tree” claim. However, [types.ts](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/types.ts) exposes only `arc`, `tweets` and `glossary` presence in `LibraryEntry.has`.

    **Say:** label this limited inventory honestly, or remove its exhaustive claim. Do not expand server projections and cache contracts merely to make the existing Built label exhaustive. Correct `ModeSurface`’s stale Remember example alongside the accessible name.

11. **U11 — P0 — mechanically calling `describeFetchFailure` loses an authored stream-ending sentence.**

    The six raw sites are real:

    | Site | Reachable throwers |
    |---|---|
    | Glossary lookup and asked-term answer | API transport, HTTP/read failures, stalled stream, server error frame, premature EOF, rejected completion shape |
    | Citation investigation | The same stream family |
    | Quiz marking | The same family, while retaining a partial reply |
    | Projection and Similar | API transport, HTTP/read failures, exceptions while reading response properties |

    The helper correctly handles marked transport errors, `StreamStalled`, `ReaderFacingError` and unexpected exceptions. Projection and Similar should retain their existing abort and successful-answer preservation rules.

    But [sse.ts](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/lib/sse.ts)’s `readAnswerStream` throws **`new Error(sentences.ended)`** on premature clean EOF. That sentence is authored and retryable. The helper instead turns it into `PAGE_FAULT`, calling an interrupted connection an app bug.

    Its rejected-completion branch also throws a plain `Error`.

    **The plan must include the throw seam:** declare premature EOF as `ReaderFacingError`; classify malformed completion deliberately, normally as `MalformedReply`. Then migrate the catches. Test transport, stall, server refusal, premature EOF and malformed completion separately. A mock of `apiFetch` throwing an unmarked `TypeError` tests unexpected exceptions, not the real transport-marking path.

    Quiz currently has no special stalled-stream branch, so its description should also be corrected.

12. **U12 — P2 — the failure-message hypotheses need a bounded ownership list and thrower classification.**

    Among the additional casts:

    - **Ordinary non-reader-facing exceptions can reach** SourceLink, tag command runners, ArticleCost, visibility writes, shelf rebuild, export, archive, and Metadata’s confirmed-survival delete error. These include transport/body failures and local plain validation errors.
    - **GlossaryPanel and ProseHoverCard’s hide catches are already converted:** `useGlossary.setHidden` wraps its cause with `describeFetchFailure` and throws `ReaderFacingError`.
    - **PrivateLink’s displayed cast is restricted to 4xx**, produced here as `HttpError`; transport failures take its unknown-state branch.
    - **Chat effects’ named `NotThisReader` branch receives a plain Error subclass**, but its sentence is intentionally authored. It is not an accidental browser message.
    - **UploadEngine’s grant/queue catches can receive transport and hashing exceptions.** Its sending catches, and batch upload’s sending catch, also receive deliberately authored *plain* Errors from `upload.ts`. Blind helper substitution would hide those Storage/network explanations; their throw sites need classification first.
    - Dictation’s `err.message` is from `failure(res)`; its catch already chooses its own sentence.
    - Authentication’s returned SDK errors are outside this helper’s authored-error contract; thrown storage exceptions are a separate problem.

    **Replace “other dozen” with named sites and owners.** Otherwise K3 has an open-ended file set, including files assigned elsewhere.

13. **U13 — P1 — both Quotes arrows correctly say “First quote.” Remove that nomination.**

    [QuotesPanel.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/QuotesPanel.tsx)’s `stepQuote` explicitly returns the first quote for **either direction** when nothing is selected. The tooltips and accessible names agree with that behaviour.

    **Delete this bullet.** Making the left arrow say Previous or Last would introduce false copy or change navigation.

14. **U14 — P2 — the Quotes ceiling defect is real, but Retry needs the correct operation.**

    `Foot` substitutes the ceiling sentence for `findMore`, which contains `Progress`. A current, capped list with a Metadata-forced job therefore hides progress and Stop; its later failure can hide Retry too.

    **Say:** active and failed job state takes precedence over the idle ceiling sentence. At the ceiling, a failed forced rewrite must retry the rewrite, not the append-only `pressFindMore` path. The existing `rerun`/`Progress` machinery can do this; no new progress component is needed.

15. **U15 — P2 — glossary occurrence and Referee fixes are valid; Search’s replacement sentence must distinguish retryable rows.**

    Evidence: Glossary’s occurrence `BlockRef`s receive `onJump` directly, while only `BlockNav.onGo` updates `atBlock`. Route chip jumps through a callback that records the selected block.

    [CriteriaPanel.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/CriteriaPanel.tsx) offers Retry for every errored row, while Search already checks `worthRetrying`. Reuse that predicate and keep the failure visible.

    Search’s “⚠ on each row above tries it again” is false for permanent failures. **Specify wording/visibility for all-permanent and mixed failures**, rather than replacing it with another blanket instruction.

16. **U16 — P1 — `OrderGroup` changes Search layout and does not supply its button styling.**

    [OrderGroup.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/OrderGroup.tsx) adds `.gloss-sort-group`, a named group, and selection reveal on mount, selection, resizing, font changes and child changes.

    On coarse pointers its CSS adds:

    - No wrapping, horizontal scrolling and hidden vertical overflow.
    - Hidden scrollbar, 3px padding and −3px margin.
    - Non-shrinking children.

    Search currently allows its count and individual buttons to wrap independently. Grouping changes that arrangement even on desktop. **That exceeds “its look stays.”**

    Also, the hover guard and finger floor select `.gloss-sort-btn`, not descendants of `OrderGroup`. Keeping only `.srch-sort-btn` does not acquire them; adding both classes changes font size, hover background and introduces a focus outline, beyond corner and selected-ink differences.

    **Specify the exact classes and CSS overrides**, preserve the count position, and acknowledge/decide the wrapping change. Adopting the established touch-scroll behaviour is defensible, but it must be stated.

17. **U17 — P2 — K4’s declaration comparison holds, but its consumer census is incomplete.**

    I compared all ten rule bodies per slider: **39 of 40 match Glossary’s baseline; Debate’s value alone omits `font-family`**. Technically there are 29 identical comparisons out of 30 when each other copy is compared with the baseline. The order row/button declarations and relevant states also match.

    The stylesheet dedup earns its keep: it removes repeated visual policy while preserving distinct component behaviour. A Debate value modifier is a small CSS distinction, not justification for adding a React boolean.

    **Update the consumer list:**

    - `ThresholdSlider.tsx` emits Glossary’s classes for Glossary, FAQ and Citations.
    - `OrderGroup.tsx` emits the group class.
    - Glossary, Quotes, FAQ, Citations and Debate emit order classes.
    - `narrow-window.css` names both order-button families.
    - `faq.css` has **`:not(:has(> .gloss-sort))`**; preserve that relationship if renaming.
    - `voices.css` names **none of the merged slider/order classes**. Preserve the surrounding voice inheritance, particularly Debate’s value.

    Text-reading guards include `touch-controls`, `glossary-band-wiring`, `css-tokens`, and stylesheet import-order checks. DOM/source-shape consumers additionally include `order-group`, `threshold-slider-adopters`, `mode-surface-changes-no-markup`, panel/compact-header tests, `quotes-yours-rows` and `search-results-get-the-room`. They are not all covered by “tests reading stylesheets as text.”

18. **U18 — P2 — K4’s proposed evidence cannot establish “no pixel moved.”**

    Equal computed declarations do not prove equal geometry, scrolling or wrapping. Its current matrix also omits coarse-pointer behaviour and the hover/focus/reset states these rules contain.

    **Require:** bounding rectangles and overflow measurements alongside resolved styles; fine/coarse pointer cases; relevant pressed, hover, focus and moved-slider states; both themes; and the same loaded fonts and fixtures. Take K4’s baseline **after K1 and K3 land**, especially after Search’s markup change.

    “No differences in this characterised matrix” is a supportable conclusion. “No pixel moved” should remain a target until that evidence arrives.

19. **U19 — P2 — seventh-sweep overlap requires coordination, though the named core edits are mostly mergeable.**

    C2 edits `useQuiz.ts`; K3 edits its marking failure catch. C10 edits `useCitations.ts` and Quotes’ append/rewrite lifecycle; K3 edits citation investigation and Quotes’ foot rendering. The narrowly named edits generally occupy different blocks.

    **No unavoidable semantic conflict is established**, but the integrated behaviour needs checking: progress/failure precedence must work during C10’s post-job read hold. The read-error/rewrite-hold tests also overlap.

    Metadata’s raw casts are expressly C2 territory. Sketch/Illustrated loaded-state work was handed to the other session; keep that ownership explicit.

    **Replace the unbounded K3 hypothesis sweep with assignments**, and require integration against those landed changes before its review. A mergeable line is insufficient evidence that both state machines still present the correct controls.

20. **U20 — P2 — some Greg questions are repairs already authorised; others need concrete examples.**

    Move these into bounded repair work:

    - Remaining tooltips that plainly violate Greg’s existing rule, after separating explanatory content from native titles that need no card.
    - The two button/progress wording contradictions.
    - Restoring keyboard access to existing hover-card controls without introducing a trap or redesign.
    - Bringing accidental secondary-text contrast up to the stated minimum. A broad palette change can remain a design question.

    Keep questions for control-family appearance, shadows, ambiguous overlapping touch targets and any changed selection/wrapping design.

    Question 1 bundles several independent decisions and supplies measurements rather than examples of the proposed result. Show representative current/proposed controls and ask one family at a time. Question 2’s “invisible larger hit area” needs an example of where targets would overlap and what would then move. Question 3 asks Greg to “say” about a tooltip he cannot see; attach the representative comparison.

    **P3 within this finding:** K2 says `SHARED_LINK_CARRIES` is in question 2, but it is absent there. It also contains “every zoom level,” another stale phrase worth correcting.

21. **U21 — P1 — an omitted live UI defect: Skim claims a failed response proves the purpose was not saved.**

    [SkimPurpose.tsx](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/SkimPurpose.tsx) renders **“Not saved — {error}”** after `savePurpose` rejects. [purpose.ts](/var/tmp/spideryarn-worktrees/ui-sweep-umbrella/src/web/purpose.ts) performs a PATCH and then reads its response. The server can commit before that response is lost.

    This is a reachable false assertion in a panel the scope says was read. Changing only its exception sentence leaves it intact.

    **Add:** report that the save could not be confirmed, preserve the draft, and re-read before asserting a stored value or inviting an action based on an assumed failed save.

**Verdict: ready with these fixes.**