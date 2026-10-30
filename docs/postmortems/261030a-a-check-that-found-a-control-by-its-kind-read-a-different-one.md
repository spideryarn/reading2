# A check that found a control by its kind read a different one

Queue item `qi-ydgn7smk`. Plan: [261030a](../plans/261030a-experimental-checkbox-unknown-is-not-off.md).
Up: [postmortems.md](../project/postmortems.md).

## What was seen

On 2026-10-10 a browser agent checking the Live button (session `fbt858ug`) reported:

> /profile has no usable switch for Experimental features. Its only checkbox reads false even when
> Experimental is on. I toggled it with the dock's "Experimental" button (aria-pressed) instead.

The queue item guessed "a stale read of the preference, or two sources of truth?". It was neither.

## What was actually happening

**The app was right, and the check read a different control.** The agent's script (`t2.ts`, in
the `fbt858ug` session transcript) did:

```ts
await page.goto(B + "/profile", { waitUntil: "domcontentloaded" });
const cb = page.locator('input[type=checkbox]').first();
await cb.waitFor({ state: 'attached' });
await page.waitForTimeout(4000);
if ((await cb.isChecked()) !== on) { await cb.evaluate((e) => e.click()); … }
```

`/profile`'s Settings section is collapsible and starts shut, and a shut `Section`
(`src/web/PageSection.tsx`) **unmounts** its children unless it is given `keepMounted`. Settings is
not. So while it is shut the Experimental checkbox does not exist, and the first checkbox in the
document is the **Feedback dialog's consent box**, inside a closed `<dialog>`. Playwright said so —
an earlier run of the same script timed out with `50 × locator resolved to hidden <input
type="checkbox"/>` — and the script moved to `state: 'attached'` and a JavaScript `click()`, both
of which work on a hidden element. It then read and clicked the consent box, saw `false`, and
concluded the setting was broken. Both facts were true on 2026-10-10 (`db2ab36f7`) as well as
today.

**There is one source of truth, and it held.** The checkbox, the bar's switch and the command-bar
row all read one module store (`src/web/experimental-store.ts`) over one column. A browser agent
ran eight scenarios on 2026-10-30 looking for disagreement: client-side and full navigations, a
navigation in the same task as the press, and back and forward. The two controls agreed every
time.

## The root cause

**The check located its target by what kind of element it was, not by what it was called**, and
"there is only one checkbox here" was an assumption about the page that nothing verified. It was
never true while the section was shut. Three things each would have stopped it, and the script
turned two of them off. Playwright's actionability check refused the hidden element, and the
script switched to `attached` plus `evaluate(click)` to get past it. A by-name locator
(`getByRole('checkbox', { name: 'Experimental features' })`) would have found nothing and timed
out loudly. The third was never asked for: a read-back to see whether the click had changed the
setting.

It repeated during this investigation. The brief I wrote for the first measuring agent said the
box was "in the DOM but hidden" while Settings was shut, which was the same untested assumption;
the agent found it was absent.

## The class

**A check that found a control by its kind read a different one.** A selector by tag, type or
position (`input[type=checkbox]`, `.first()`, `nth(2)`) is a claim that the page has exactly one
such thing, or that the one you want comes first. Pages change, sections fold, dialogs mount
hidden. When the claim fails the check does not fail with it: it reads a neighbour and reports
the neighbour's state as the target's. That is [silent-success.md](../reusable/silent-success.md)
in a browser. When a locator resolves to a hidden element and you reach for `force` or
`evaluate`, that is the moment to stop.

## What the investigation found that was real

**The checkbox drew "not known yet" as "off".** Until `GET /api/reader` answers, and after a load
that fails, the store holds a placeholder `on: false`. The checkbox (written 2026-08-31,
`369f17a15`) drew it as an unchecked box: disabled, with "Loading…" in a separate paragraph that
nothing connected to the box. An unchecked box, disabled or not, is exposed as unchecked to a
screen reader and to `isChecked()`. The bar's switch had learned this on 2026-09-29 (`8188cc54d`,
`SWITCH_LOOK`): it draws no answer as a centred knob with no `aria-pressed`. The older checkbox
never caught up. This is a second instance of the same family: one store, several controls, and
only the one reviewed most recently knew which state was a placeholder. `HighPowerSwitch.tsx` had
the same gap. GPT Sol's plan review found two more states with no value: a mixed box that was
still enabled after a reload failed, and a save that failed before the first answer, which both
controls drew as known.

**Fixed in this run:** `hasValue(setting)` in the store says whether there is a value to draw. The
checkbox is `indeterminate` and disabled when it is false, and `aria-describedby` points at its
status line. `HighPowerSwitch` is `indeterminate` while its read is out. `toggleVariant` gives a
save that failed before any read its own marked, inert waiting appearance. Red-first tests are in
`tests/profile-settings.test.tsx`, `tests/metadata-high-power-switch.test.tsx` and
`tests/dock-experimental-switch.test.tsx`; the last holds the bar's `SWITCH_LOOK` to `hasValue`
for all 32 combinations of the five fields. A failed save before the first answer has a distinct
marked, inert waiting appearance, so it reports the failure without inventing a value while the
store's automatic recovery read runs.

**Right for the long term, and not done:** the store should not hand the placeholder out as `on`
at all. A `{ kind: "unknown" } | { kind: "known"; on }` would make the compiler refuse
`checked={experimental.on}` while the value might be unknown. That touches every feature gate that
reads `on` (eleven components and some three dozen reads, most of which want unknown to mean
"hide", so each would have to say so). That is why it was not done under an S-sized queue item.
The agreement test holds the line until it is.

## What would have caught it, ranked by ease against value

1. **A rule in the Playwright doc: find a control by its name, never by its kind, and treat
   "resolved to hidden" as a stop sign.**
   [browser-testing-playwright.md § The traps that stay](../project/browser-testing-playwright.md#the-traps-that-stay).
   Free, and it would have prevented the report outright. *Done.*
2. **Read back what you changed.** After a click meant to set something, read it through the
   thing the app reads, here `GET /api/reader` or the bar's `aria-pressed`. It would have shown the
   click had changed nothing. Same doc, same bullet. *Done.*
3. **No unknown drawn as an answer** (above): it removes the state that made a too-early read look
   like a real "off". *Done for the two controls that had it.*
4. **A stable hook on the control** — `data-experimental-switch`, as the bar has `dock-experimental`.
   Rejected: the accessible name already is one, and a by-name locator also checks that a screen
   reader can find it.
5. **`keepMounted` on Settings, so the box is always in the DOM.** Rejected. It would make this
   one selector land on the right box by accident and teach nothing, and the section unmounts its
   contents on purpose, so a shut section costs nothing.

## A flap that was the harness

One measuring run saw the loaded box fall back to "Loading…" about 4 s in, with a fresh
`GET /api/reader`. The store only resets on a change of reader, so this looked like a session
defect. Eight further runs logged every `onSession` and `onAuthStateChange` event, `storage`
events, and `/auth/v1` requests. They found exactly one session event per load and no reset. The
run that flapped lines up with the dev server's `hmr update` lines for `SettingsSection.tsx` and
the store, which were being edited at that moment. A hot update re-evaluates the module, and with
it the module-level store. A reader never gets a hot update, so it was not pursued. The scripts
are `sesslog.ts` and `cbcount.ts` in the session scratchpad.

## Siblings, looked at and left

- **The add page's *generate the main modes* box** (`src/web/auto-modes-setting.ts`) draws its
  placeholder `on: true` before the read lands, and it is *enabled*. The placeholder is the
  server's real default, and the import reads the committed choice on the server. Even so, a
  reader who had turned it off sees "on" for a moment and could press it. It is the same family
  with a different trade-off, recorded here and not changed under this item.
