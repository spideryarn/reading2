# Review prompt: the profile panel

You are reviewing a **plan**, before any of it is built, for a small TypeScript + React reading app
called Spideryarn. Be adversarial. I want the things that will be wrong, not a summary.

## What to read

Repo root is the working directory.

- **The plan:** `docs/plans/profile-panel.md` — read this first and in full.
- **The feature it extends:** `docs/project/reader-profile.md` — the two profile boxes, the string
  they join into, the provenance hash, and the two controls.
- **The code it touches:**
  - `src/web/WrittenForYou.tsx` — the label and the checkbox today
  - `src/web/useProfile.ts` — `useProfile()` (the global box's saving, with its guards) and
    `useHasProfile()` (the boolean the plan replaces)
  - `src/web/ProfileBox.tsx` — the textarea the panel will reuse
  - `src/web/Tooltip.tsx` — the Floating UI wrapper, its controlled-open union, `handleClose: null`
  - `src/web/styles.css` — search for `§ tooltip` and for `.prof-use` / `.prof-badge`
  - `src/web/Metadata.tsx` — `savePurpose` (the inline per-article save the plan extracts) and the
    "Your reading" section around line 690
  - `src/web/ProseHoverCard.tsx` and `src/web/useHoverCard.ts` — the ONE interactive card in the app
    today, i.e. the prior art for a card the pointer may enter
  - `src/routes.ts` — `GET /api/reader` (search `readerRoute`) and `patchShelf`
  - `src/web/keynav.ts` — the window-level key handling a textarea in the band must survive
  - `src/web/useGlossary.ts`, `useSummaries.ts`, `useIdeas.ts`, `Tweets.tsx`, `ChatPanel.tsx` — the
    five `useHasProfile` callers

## Context you need

The reading view is a three-column layout: a narrow spine, the article, and a "mode band" on the
right that is **400px wide at best and 288px at worst**, in which the glossary, summaries, ideas,
chat, diagram and search panels take turns. Tooltips are portalled to the end of `<body>`.

There are two profile textareas, on two different pages: a global "about you" at `/profile`, and a
per-article "why you're reading this one" on `/read/<slug>/metadata`. The server joins them into one
string for prompts. A checkbox labelled "Use your profile" appears in 10 places beside buttons that
spend a model call.

The plan adds a click-opened panel, raised from beside that checkbox, holding **both** textareas so
they can be edited without leaving the article.

## One thing already established, so you do not have to re-derive it

`.tooltip-anchor` is `pointer-events: none`, and `Tooltip` passes `handleClose: null`. I measured
this in headless Chrome against the real components and the real stylesheet: the
`<Link href="/profile">Edit your profile →</Link>` inside the shipped `WrittenForYou` tooltip is
**not clickable** — `document.elementFromPoint` at the link's centre returns the page behind it. A
control (the same test on an ordinary in-flow link on the same page) returns the link, so the probe
works. Take that as fact.

## What I want from you

Rank by how much damage it does. For each: what breaks, the concrete sequence that breaks it, and
what you would do instead.

1. **Is the panel the right answer at all?** The alternative I rejected was a read-only hover
   tooltip plus "go to the profile page" in words. Argue the other side if it deserves arguing.
   In particular: is putting two textareas, two microphones and two character counters into a 352px
   floating card over an article a good idea, or a thing that will feel bad and be quietly unused?

2. **`Tooltip` in controlled mode with `.interactive`** — is that component actually capable of
   being a click-popover with focusable content inside it, or am I about to discover that
   `useHover`, `useFocus`, `useDismiss` and `useRole({role: "tooltip"})` fight each other? Read
   `Tooltip.tsx` closely. Note `ProseHoverCard` does NOT use `Tooltip` for its interactive card — it
   has its own `useHoverCard`. Is that a warning I am walking past?
   Accessibility: `role="tooltip"` on a container holding textareas is wrong. What should it be, and
   does focus need trapping and returning?

3. **The promise cache.** The plan replaces five independent `useHasProfile(slug)` fetches with one
   module-level promise keyed on the slug, plus a `refresh()`. Name the ways that goes wrong:
   staleness across article navigations, two slugs in flight, a component unmounting mid-fetch, a
   failed fetch being cached for ever, tests sharing module state between files, a `refresh()` that
   races a `flush()`.

4. **The `usePurpose` extraction.** `savePurpose` in `Metadata.tsx` has no generation counter and no
   in-flight guard; `useProfile`'s `flush` has both. The plan gives the new hook the guards and moves
   the metadata page onto it. Is moving the metadata page onto a new hook in this same change right,
   or should the two boxes' saves stay separate? What breaks on the metadata page?

5. **Saving from a floating panel that can be dismissed.** Save-on-blur plus outside-click-to-dismiss
   is a specific hazard: clicking outside blurs the textarea AND closes the panel in the same event.
   Does the save survive? Does the error have anywhere to be shown if the panel it belongs to has
   just unmounted? Escape while typing? Navigating away with the panel open?

6. **The profile hash and staleness.** Every generated artefact carries a `profileHash`, and editing
   a profile marks artefacts stale (`profileIsStale` in `src/profile.ts`). The panel makes editing a
   profile *easy*, and puts it two inches from the artefact it invalidates. What does the reader see
   the moment they blur that box — and is anything in the plan wrong about it?

7. **Anything the plan does not mention at all.** Touch devices. The public/read-only view. The
   `?slug=` being absent (the panel on a page with no article — does one exist?). Dictation inside a
   dismissable panel. Two panels open at once from two different checkboxes in the same view.
   The `disabled` state while a job is running.

8. **The tests.** Say which named test would pass against the bug it is supposed to catch, and what
   the fixture would have to look like for it not to.

Do not restate the plan back to me. Where you agree with something, say so in one line and move on.
