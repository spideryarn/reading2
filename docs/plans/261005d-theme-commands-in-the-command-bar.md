# Command bar: switch between Light, Dark and System

Report spya-c5wdn7 (SPIDERYARN-READING2-D8), Overseer queue qi-n2hfcag6. From an admin (Greg), so
trusted input; `feedback-reporter.ts` exited 0 on its production row.

> Add a command in the command bar to be able to switch between dark and light mode, and I guess
> system mode as well.
>
> — Greg, 2026-10-04 (spya-c5wdn7, from `?mode=structure`)

## What exists

- **The setting is already built**, by plan
  [261003e](261003e-light-dark-and-system-appearance-on-profile.md):
  [`src/web/appearance.ts`](../../src/web/appearance.ts) holds the choice (`system`, `light`,
  `dark`; unset is Dark) in `localStorage` on the device, and `setAppearance(choice)` saves it,
  applies it to the page at once, tells every subscriber, and returns whether the save reached
  storage (a private window can refuse). `useAppearance()` is the current choice.
- **The only picker is on /profile** (`AppearanceSetting.tsx`: three radios, *System*, *Light*,
  *Dark*, under the legend *Appearance*). `web-client.md` § Appearance, What it does not do yet,
  says so.
- **The command bar has a setting row already**: *Turn experimental features on / off*
  (`CommandBar.tsx` § `experimentalCommand`, `experimentalRows`). It is an `action`, typed-only (not
  in the list the bar opens on), `generates: false`, `opensOnly: false`, and it is appended after
  `besideTheModes` in the `commands` memo. Three tests build the bar's whole list by hand and add
  that row: `tests/command-match-arguments.test.ts` (the collision matrix against the argument
  verbs), `tests/command-match-mode-aliases.test.ts` (every mode alias still ranks its mode first)
  and `tests/command-pick-catalogue.test.ts` (generates
  `src/command-pick-catalogue.generated.json`, the words the sentence-picking model is shown).
- No mode, sub-mode, page or action today has a label or alias containing `theme`, `appearance`,
  `dark`, `light` or `system` (grep of `mode-catalog.ts`, `sub-modes.ts`, `article-commands.ts`,
  `rerun-commands.ts`, `find-more.ts`, `CommandBar.tsx`). Descriptions were not checked by grep;
  the alias test below is what checks ranking.

## What we'll build

One stage. Three action rows, in a new file `src/web/appearance-commands.ts` (as `find-more.ts` and
`rerun-commands.ts` hold their rows' words), appended next to `experimentalRows` in the `commands`
memo:

| Label | Description | Aliases |
|---|---|---|
| Appearance: Dark | Light text on a dark page. | `dark mode`, `dark theme`, `night mode`, `theme`, `colour scheme`, `color scheme` |
| Appearance: Light | Dark text on a light page. | `light mode`, `light theme`, `day mode`, `theme`, `colour scheme`, `color scheme` |
| Appearance: System | Follow this device's light or dark setting. | `system mode`, `system theme`, `auto theme`, `match device`, `os theme`, `theme`, `colour scheme`, `color scheme` |

- **The names are /profile's**: *Appearance*, and *System / Light / Dark*, so the two doors use the
  same words. Typing `appearance`, `theme` or `colour scheme` lists all three; `dark`, `light` and
  `system` each put theirs first (alias prefix; the label contains them too).
- **All three are always offered, and the one in force says so** — its description gains
  *This is what you have now.* Pressing it sets the same value again and closes. This departs from
  the rule Archive and the experimental switch follow (*one row whose label follows the state, so
  there is never a row that does nothing*), on purpose: those are two-state toggles, and this is a
  choice among three. Hiding the current one would mean a reader in Dark who types `dark mode` gets
  `No command matches.` and an offer to ask a model, which reads as the feature being missing.
- **Typed-only**, as the experimental row is, so the list the bar opens on does not grow by three.
- **`opensOnly: false`, `generates: false`.** It changes a setting, so a row the sentence-picking
  model chose (*"make it dark"*) is drawn under *Did you mean* and waits for Enter, the rule every
  row that writes follows. It calls no model.
- **Enter calls `setAppearance(choice)`**, the function /profile's radios call. Saved: the bar
  closes on the new colours. Not saved (storage refused): the colours still change, and the bar
  stays open with /profile's own sentence, *Couldn't save it on this device, so it lasts until you
  close this page.*
- **Offered wherever the bar is**: the reading view and the owner's Metadata page, to a visitor as
  well as a signed-in reader, because the choice is the device's and needs no account. The
  experimental row's `loaded / signedIn / saving` gate has no equivalent here: the write is
  synchronous.
- `CommandBar` reads the current choice with `useAppearance()` and hands it, with `setAppearance`,
  to `appearanceRows(current, set)`. The row builder takes both as arguments so the tests can pass
  stubs.

### Tests, red first

- `tests/appearance-commands.test.tsx` (new, modelled on the experimental block of
  `tests/command-bar-arguments.test.tsx`): the three rows are absent from the opening list;
  `theme` and `appearance` list all three; `dark mode`, `light mode`, `system` each put theirs
  first; Enter on *Appearance: Light* leaves `localStorage["spya.appearance"] === "light"` and
  `<html data-theme="light">` and closes the bar; the row in force carries *This is what you have
  now.* and the other two do not; with `localStorage.setItem` throwing, the theme is applied, the
  bar stays open, and the sentence is shown.
- The three hand-built lists gain the rows: the collision matrix (no label or alias parses as an
  argument verb), the mode-alias ranking (no mode alias now lands on an appearance row first), and
  the pick catalogue, regenerated with the command in that file's header.

### Docs

- `reading-view-overview.md` § The command bar: one paragraph with Greg's words.
- `web-client.md` § Appearance: *The only picker is on /profile* becomes two pickers.
- `help-page.md` says the Help page has a deploy step that keeps it true; if the page's text names
  where the appearance is set, it gains the command.
- `docs/user-feedback/` note, and `feedback-endings.ts`.

## The simpler option passed over

**One row that cycles** (*Switch to light*, then *Switch to system*, …) is fewer rows, but Greg
named three destinations, a cycle makes two of them two presses away, and the label would have to
name the next state rather than the one wanted, so typing `dark mode` while in Light would match
only by luck of the cycle order.

**Two toggle rows hiding the current choice**, the experimental row's shape exactly, is argued
against above.

## Not in this plan

- The bar on pages that do not have one (the shelf, /profile, signed-out pages). The bar is mounted
  by the reading view and Metadata; widening that is a separate piece of work.
- An argument form (`theme dark` parsed as verb + word). The three rows' aliases already answer
  the phrases a reader would type, and a verb would need an entry in `parseArgumentQuery` and a
  runner for no gain.
- Cross-device sync, which 261003e already declined.
