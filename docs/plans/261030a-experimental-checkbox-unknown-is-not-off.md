# The /profile checkbox says "not checked" before it knows

Queue item `qi-ydgn7smk` (authorised by Greg, 2026-10-10). A browser agent in `fbt858ug` reported:

> /profile has no usable switch for Experimental features. Its only checkbox reads false even when
> Experimental is on. I toggled it with the dock's "Experimental" button (aria-pressed) instead.

Up: [experimental-features.md](../project/experimental-features.md). Postmortem:
[261030a-a-check-that-found-a-control-by-its-kind-read-a-different-one.md](../postmortems/261030a-a-check-that-found-a-control-by-its-kind-read-a-different-one.md).

## What is actually wrong

**Not two sources of truth, and not a stale read.** The checkbox, the bar's switch and the command
bar row all read one module store (`src/web/experimental-store.ts`) backed by one column. A browser
agent ran eight scenarios (client-side and full navigations, mid-save navigation, back/forward) and
the two controls agreed every time.

**The report read a different checkbox.** *(Corrected after the first draft of this plan, which
blamed an early read.)* The agent's script used `input[type=checkbox].first()`. Settings on
`/profile` starts shut, and a shut `Section` unmounts its contents, so the first checkbox in the
document was the closed Feedback dialog's consent box. The script got past Playwright's "resolved
to hidden" with `state: 'attached'` and a JavaScript `click()`. The postmortem has the evidence and
names the class.

**What the investigation did find** is the **we-have-not-read-it-yet** state, drawn as an answer.
Until `GET /api/reader` answers, and after a load that failed, the store holds the placeholder
`on: false`. The checkbox drew it as `checked={false}`, disabled, with "Loading…" in a separate
line that nothing linked to it. Disabled hides that from nobody who *reads* the control: it is
exposed to assistive technology as unchecked, and Playwright's `isChecked()` returns `false`.

**The bar's switch already knew this.** Since 2026-09-29 (`8188cc54d`) it draws no answer as a
centred knob and omits `aria-pressed` — Dock.tsx § `SWITCH_LOOK`: *"where there is no answer at
all, a knob on the left is the silent-default mistake in its most visible form."* The checkbox,
written on 2026-08-31 (`369f17a15`), never learned the rule. One store; two controls; only one of
them distinguished "not known" from "off".

## The change

1. **`hasValue(setting)` in `experimental-store.ts`** — is there a value to draw, or only the
   placeholder? A save in flight holds a value; a failed load holds none; otherwise `loaded` or an
   offline copy. A failed save holds one only if there was one before the press, so `toggleVariant`
   gives a save that failed before any read its own marked, inert waiting appearance: no invented
   value, but no hidden failure either (GPT Sol, plan review, finding 2; code review).
   The box is also **disabled whenever it is mixed**, which closes a reload that fails after a good
   load and would otherwise leave a mixed box enabled (finding 1).
2. **The checkbox is `indeterminate` when `!hasValue`** — the native "mixed" state, which is what a
   screen reader announces and what the bar's centred knob is the picture of. Set through a ref,
   because React has no prop for it.
3. **`aria-describedby` from the box to its status line**, so "Loading…" / "Couldn't load" is heard
   with the box, as the bar's switch already does with its `sr-only` description.
4. **Tests**: `tests/profile-settings.test.tsx` — mixed before the answer, mixed after a failed
   load, disabled when a reload fails after a good answer, and described by the status line (all
   four red before the change).
   `tests/dock-experimental-switch.test.tsx` — `hasValue` agrees with `SWITCH_LOOK`'s `is-unknown`
   for all 32 combinations of the five fields, so the two controls cannot drift apart again.
5. **`HighPowerSwitch.tsx`** had the same gap (`since === undefined` drawn unchecked) and gets the
   same `indeterminate`, with a red-first test in `tests/metadata-high-power-switch.test.tsx`.
6. **Docs**: experimental-features.md § The three controls gets the rule;
   browser-testing-playwright.md § The traps that stay gets the two rules the report broke (find a
   control by its name; wait for a setting to load before reading it).

**Simpler option passed over: hide the checkbox until loaded.** It is fewer lines, and an agent's
`isChecked()` would wait rather than answer. Rejected because the bar's switch deliberately keeps
its shape in every state, and *controls that do the same job look the same*
([controls.md](../project/controls.md#controls-that-do-the-same-job-look-the-same)); a box that
appears late also shifts the row. **Also passed over: making Dock call `hasValue`.** It would be
one rule by construction rather than by test, but it reorganises `SWITCH_LOOK` and `aria-pressed`
logic that is tested and right; the 32-case agreement test holds them together for less churn.

**What this does not change.** Playwright's `isChecked()` ignores `indeterminate` and still returns
`false` for a mixed box — so an agent reading a setting must still wait for it to be enabled. That
is a browser-testing rule, and is written there.
