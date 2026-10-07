---
reports: spya-rgq3f6
ending: shipped
---
# A design-system refresh: controls that do the same job look the same in every mode

Report `spya-rgq3f6` (Sentry SPIDERYARN-READING2-E5), a suggestion, from Greg (admin, provenance
proved against the production row), 2026-10-06 21:42 UTC, filed from `/changelog`. Overseer queue
item `qi-9sv8cha4`.

> I don't know if we have much of a design system, but maybe this is a good moment to update it.
> See the slash admin slash design. We don't have to adhere to that. We could update that to be in
> line with our current best practices. But I think I'm just trying to sort of look for a tiny bit
> more consistency across modes and in various places, and to use this as a moment to reflect, you
> know, take screenshots, perhaps get input from other agents with different product manager or
> user designer or user personas, perhaps also GPT Soul, and then make a minimal update to
> agents.md and/or design docs to try and ensure that going forward we adhere a bit more to
> whatever revised design system you come up with. Hopefully we don't need major revisions. I'm
> just looking for polish.

Built together with Greg's answers to the UI sweep's three questions (2026-10-07,
[261007a § For Greg](../plans/261007a-ui-sweep-umbrella.md#for-greg)): *"yes A probably controls
that do the same job should look the same in every mode, though use your judgment"*, and *"yes to
all as you see fit"* for the other two.

**Ending: Shipped**, on `dev`, not deployed. Plan:
[261007h](../plans/261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md).
The AGENTS.md line is a question for Greg ([q-cspj2t](questions/q-cspj2t.md)), not applied.

## What changed

Polish, not a redesign: each change moves an outlier onto a design the app already had.

- **The row that switches a mode's parts** is Summary's joined bar in all nine places that have
  one (Summary, Debate, Structure, Referee and its criterion kinds, Learn, Diagram, Search, Skim's
  depths). The chosen part is marked by a raised fill and bold, never the orange: **orange marks
  the mode; a part within it is marked neutrally.** Learn's moved to the left like the rest. 44px
  under a finger everywhere. On a narrow band it scrolls inside itself, keeping the chosen part in
  view.
- **The button that runs a mode's job** is one button (the 32px outlined one nine modes already
  had) in Referee, Search, Glossary and Citations too.
- **Text boxes in the bands** share one border, corner, ground and focus mark.
- **Waiting**: every band now waits the same way. Nothing shows for 600ms, then a small spinner
  and a sentence saying what it's waiting for, which a screen reader announces. A line that
  answers a press shows at once.
- **A failure sentence** is one red everywhere (it was orange, red, plain ink or grey by mode),
  readable on every surface in both themes.
- **Order chips**: one corner, one height, and a neutral "on".
- **On a phone**: small controls (Quotes' ⓘ, passage ids, /profile's and Metadata's section
  headings, "Forgot your password?") have a 40px invisible target, drawn the same size.
- **Keyboard**: "Skip to modes" is the first Tab stop in an article.
- **Signed out**, Help, Changelog, Privacy, Contact and Open source wear the same top bar as Home,
  Features and Pricing.
- **The marketing pages' fade-ins** happen once and stay, so scrolling back up no longer hides
  what you've read.
- **Wording**: "one model call" and "this one" in every not-made-yet line.
- **Dark mode**: the faint grey is one step lighter, so it passes on raised surfaces. **Light
  mode**: tooltips, menus and dialogs have a lighter shadow.
- **`/design`** has a new section, *Controls across modes*: one live example of each of these,
  with its rule, its size for a finger, the modes that use it, and a checklist for whoever adds a
  mode. **controls.md** opens with the aim in Greg's words and a table of each shared piece and
  the test that holds the modes to it.

## How it was decided

Screenshots of every mode and sub-mode (about 115, both themes, 1440 and 390) before and after;
three persona reviews of the plan from those screenshots (designer, product manager, reader); GPT
Sol on the plan (twenty findings, all taken) and on each family's code, eight runs in all. Sol
found and fixed or reported eleven P1s, among them a bar inside the phone's notch, a fade-in that
could stay hidden on a wide, short window, and a skip link that did nothing during the bar's
entrance. A second round confirmed every fix. The persona calls and the two that were overruled
are in the plan's § Judgement calls.

## Deferred, each with its own queue entry

- The voice row in Chat and Learn (`qi-zm95p9we`) and Diagram's pager (`qi-mpnpp2qp`): the plan's
  optional F8.
- "Dig deeper" beside "Ask in chat" at two sizes (`qi-h2cneb4y`).
- Six smaller shadows still tuned for the dark page (`qi-a5gzv44d`).
- Learn's Start over says "Fetching…" while it deletes (`qi-fahzat55`; older, found on the way).

Font sizes across modes (`qi-f8h393sb`) was not part of the answer and was not touched.

## What was checked

Each family's tests were seen red first, and each family was measured in Chrome on the box before
and after. `npm run typecheck`, and the full `npm test` once at the end.
