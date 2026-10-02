### Findings

**R1 — P1 — `PageContents` is the wrong whole-component reuse.**  
Evidence: `docs/plans/261002b-help-page.md:73`; `src/web/PageContents.tsx:220`, `:380`, `:393`, `:446`; `src/web/ChangelogPage.tsx:573`. It produces a flat DOM-derived list, assumes the page reserves Metadata’s exact left margin, and is entirely hidden below `lg`—including its search box. It cannot render the proposed groups without another behavioural mode. Search Enter also calls `revealSection` without creating a fragment.  
**Recommendation:** reuse only `searchSections`, generalized to accept synonyms. Build a small Help-owned contents component directly from the typed group list: grouped and fixed at `lg`, in-flow or collapsible with search on smaller screens, with real anchor links. This is simpler than adding `fragmentLinks`, grouping, and responsive variants to a Metadata-specific observer.

**R2 — P1 — “Permanent” mode anchors are not permanent when derived solely from `Mode`.**  
Evidence: `docs/plans/261002b-help-page.md:59-65`; `src/modes.ts:39`, `:106`, `:325`. Modes have already been retired or renamed (`hierarchy`, `outline`, `trajectory`), with compatibility aliases deliberately retained. Removing a mode from `MODES` would remove `#mode-x`; a pinned test merely makes that visible during the change—it does not preserve the link.  
**Recommendation:** retain `Record<Mode, HelpModeSection>` for current coverage, but maintain a separate append-only anchor/alias registry. Retired anchors should remain as hidden aliases or short successor notes linking to the current section.

**R3 — P1 — Fragment navigation needs one explicit owner; the proposed mixed browser/reveal path will misbehave.**  
Evidence: `docs/plans/261002b-help-page.md:76-86`; `src/web/Link.tsx:37`; `src/web/router.ts:1240`; `src/web/main.tsx:20`; `src/web/ChangelogPage.tsx:537`, `:705`; `src/web/PageContents.tsx:407`. Direct `/help#x` arrives before React has mounted the target; `history.scrollRestoration` is manual; SPA `navigate()` scrolls to the top; `Link` cancels native navigation; and `pushState` emits no `hashchange`. Meanwhile, letting a raw anchor navigate while `reveal()` also scrolls creates two competing scrolls.  
**Recommendation:** use ordinary `<a href="#id">` for every same-page link and search result. Give Help a mount effect plus a `hashchange` listener that validates the anchor, scrolls after the section exists, and flashes once; also handle app-owned history notifications if any same-route `Link` can write the hash. Test direct load, search Enter, Back/Forward, ordinary click, and Cmd-click.

**R4 — P1 — The deploy sequence becomes self-invalidating when Help actually needs an update.**  
Evidence: `docs/plans/261002b-help-page.md:145-149`; `docs/project/overseer.md:519-529`; `docs/project/changelog.md:150-156`. The proposed step runs `changelog:prepare`, then may commit a reader-visible Help change. The changelog gate will correctly reject that new uncovered commit.  
**Recommendation:** specify the loop: prepare notes → inspect them for Help implications → update/commit/push Help if needed → rerun `changelog:prepare` → deploy. Keep this semantic check non-gating; a mechanical “Help changed” gate would create false positives and meaningless edits. The existing changelog gate plus exhaustive mode typing is the right mechanical boundary.

**R5 — P1 — Do not put another information icon in either the spine or every band.**  
Evidence: `docs/plans/261002b-help-page.md:121-138`; `src/web/styles/shell.css:104-110`; `src/web/styles/spine.css:13-63`; `src/web/ModeSurface.tsx:199-206`; `src/web/styles/mode-band.css:1091-1106`. The spine is only 12px wide and clips overflow; even the 14px glyph, let alone a usable target, cannot fit without obscuring its marks and hit targets. Bands already reserve 1.9rem for a 24px `(i)`; a second visually identical icon adds ambiguous semantics and another collision budget.  
**Recommendation:** add one labelled, contextual **Help** link in the Dock, visible to owners and visitors: current mode → its section; Plain → the reading-view/spine section. Keep the command-bar row and footer. If links inside the existing band card remain desirable, treat that later as the per-use interactive-card case already recommended by `docs/project/open-questions.md:202-205`, rather than adding a sibling `(i)`.

**R6 — P1 — Several content premises are already inaccurate.**  
Evidence:

- `docs/plans/261002b-help-page.md:34-36` omits the current-section fill; see `src/web/Spine.tsx:1011`.
- `docs/plans/261002b-help-page.md:100` calls the view three parts, but Marginalia is a right-hand column that can coexist with a band; see `docs/project/reading-view-overview.md:145-153`.
- `docs/plans/261002b-help-page.md:102` describes the gutter as “ask, comment, bookmark,” omitting its always-present permalink and separate Chat control; see `src/web/BlockGutter.tsx:607`, `:658`, `:744`, `:771`.
- “What it costs” must not imply each mode consumes allowance: rerunning modes is free; see `docs/project/billing.md:598-604`, `:954-955`.

**Recommendation:** correct the outline before delegating copy. Avoid counting spine layers; explain each visible state. Describe the gutter’s responsive `…`, owner/visitor differences, and one-press Ask-AI behaviour. State plainly that mode reruns do not consume article allowance, while new ingests and High-powered AI can.

**R7 — P2 — Avoid duplicating each mode’s canonical explanation.**  
Evidence: `docs/plans/261002b-help-page.md:56`, `:106`; `src/mode-catalog.ts:77`; `src/web/BandAbout.tsx:93`. `MODE_CATALOG` already owns “what” and “how.” Eighteen independently written Help versions will drift despite being exhaustive.  
**Recommendation:** render the label and canonical description/how from `MODE_LABEL` and `MODE_CATALOG`; let the exhaustive Help record contain only Help-specific fields such as `whenToUse` and `readingTip`. Test that every registered anchor renders exactly once and every generated Help fragment resolves.

**R8 — P2 — “Help in the reader’s menus” is undefined scope.**  
Evidence: `docs/plans/261002b-help-page.md:135`; `src/web/CommandBar.tsx:194-201`; `src/web/SiteBits.tsx:246-260`. Privacy and What’s new do not share a common signed-in menu: Privacy is in `SiteNav`, while What’s new is in the command bar/footer.  
**Recommendation:** replace this with an explicit inventory. For v1: footer, command bar, and one contextual Dock link. Do not widen `SiteNav` or invent another menu without a separate layout decision.

**Verdict: Sound goal and content architecture, but revise before building—especially the responsive contents, permanent-anchor model, hash owner, deploy loop, and duplicate-icon design.**