# GPT-Live is the live engine for everyone; Realtime from an arrow on the Live button

Up: [plans.md](../project/plans.md) · Feature: [live-conversation.md](../project/live-conversation.md)
· Report: `spya-t858ug` (#525) · Queue: `qi-s8brz9cw`, and it answers `qi-hq3fv9pw`

## What Greg asked for

> Anytime we have a Live button for real-time conversation, there's a drop-down next to it, which is
> a bit cumbersome and ugly for choosing between OpenAI's Live and Realtime APIs. Let's make Live the
> default and keep real-time only for Experimental Features. In other words, for people who have
> Experimental Features turned off, they won't see that dropdown and it'll always be in Live mode.
>
> And for the people who do have experimental features turned on, can you just make it a little drop
> down on the live button rather than its own separate drop down? i.e. a little drop down arrow to
> the right of the live button.
>
> — Greg, 2026-10-09 (report `spya-t858ug`, filed from Chat on arxiv-1706-03762)

Today it is the other way round: with Experimental off every reader gets Realtime and sees no
choice; with it on, a `<select>` beside the Live button offers Realtime (the default) or GPT-Live
(`src/web/live/engine.ts` § `effectiveEngine`, `DEFAULT_EXPERIMENTAL_ENGINE = "realtime"`).

## This is Greg's answer to `qi-hq3fv9pw`

`qi-hq3fv9pw` (needs Greg, 2026-10-03) held back moving every reader to `gpt-live-1` because the
[261002r spike](../investigations/261002r-gpt-live-spike.md) measured article answers about two
seconds slower (5.2 s against 3.0 s), mostly behind filler, and because it "changes the product":
every article question becomes a delegated round trip. It named four conditions. What changed since:

| Condition in `qi-hq3fv9pw` | Now |
|---|---|
| A WebRTC handshake through our server works | **Met.** `createGptLiveSession` (src/live.ts) does the SDP exchange; GPT-Live has been running behind Experimental since 261003a, with a real-browser check and three defects fixed. |
| Idle sessions closed while the reader reads (it bills every open minute) | **Met in the browser.** `GPT_LIVE_IDLE_CAP_MS` = 2 minutes of quiet (5 on Realtime), 20-minute session cap, and the clock pauses while a delegation runs. Nothing caps it on the server, same as Realtime. |
| Article answers reach ~3 s | **Not met, not re-measured.** |
| The filler can be prompted away | **Not met.** The 261003a browser runs still opened most answers with "Checking." |

So the trade-off is the same one, and Greg has now made it. The plan records `qi-hq3fv9pw` as
answered by `spya-t858ug`, and closes it.

**What every reader gives up by moving** (live-conversation.md § What this engine does not have),
named so the change is decided rather than inherited: no Tap to talk, no microphone placement
(noise-reduction) setting, Listening/Speaking shown as estimates, and article answers ~2 s slower.
Realtime keeps all of those, one click away, for anyone with Experimental on.

**Cost.** Per turn GPT-Live is about a quarter of Realtime's ($0.02 against $0.06–0.12), but it
bills $0.05 for every minute the session is open, silence included. A 20-minute session with five
questions measured about $1.00 on GPT-Live against $0.25 on Realtime; the 2-minute idle cap is what
stops a reader who goes quiet to read paying the far end of that. Both are our cost, not the
reader's (billing is slots, not usage). Worth watching in `/admin/costs` after the deploy; not a
reason to wait, given Greg's call.

## What changes

1. **`engine.ts`.** One constant, `DEFAULT_ENGINE = "gpt-live"` (replacing
   `DEFAULT_EXPERIMENTAL_ENGINE`). `effectiveEngine(preference, experimentalOn)`: off → the default,
   whatever was remembered; on → the remembered choice, or the default before there is one. The
   three-things rule (preference / effective / owner) is unchanged. A reader with Experimental on
   who had explicitly picked Realtime keeps it (it is in their `localStorage`); everybody else moves.
   `ENGINE_COPY` loses "(new)": GPT-Live is the ordinary one now.
2. **`useLive.ts`.** "Turning Experimental off ends a GPT-Live call" becomes "turning Experimental
   off ends a call on the engine only Experimental offers" — i.e. a Realtime call — by the same
   ordinary hang-up, so the words are kept. Generalised as "there is an owner, and it is not
   `DEFAULT_ENGINE`" rather than the literal name swapped, so the rule does not have to be found
   again if the default ever moves. **`owner !== null` is part of the rule**: with no call there is
   nobody to hang up, and an idle hook's `stop()` is not harmless (Sol P1).
   **While the setting is still loading, a remembered choice stands** (`experimental.on ||
   !experimental.loaded`): it reads as off until the fetch lands, and a reader who had chosen
   Realtime would otherwise get GPT-Live for a press in that moment. If it lands off, the rule above
   ends the call (Sol P2).
   (Turning it off mid-call is rare; the alternative — leave a Realtime call running — would make
   the switch say one thing while the call did another.)
3. **`LiveButton.tsx`, the arrow.** The separate `<select>` goes. With Experimental on, a small
   chevron button sits flush against the right edge of the Live button (one split control: Live's
   right corners squared, the chevron's left ones), and opens a Radix `DropdownMenu` with a radio
   group of the two engines — GPT-Live first, then Realtime — each with its one-line tip. It reuses
   `MENU_SURFACE`, `MENU_ITEM` and `useFingerPressMenu` from `src/web/menu.ts`, the two menus' shared
   pieces, rather than drawing a third. Disabled for the whole of a call (the engine is pinned).
   Keydowns inside stop propagating, as the select's did, so the reading view's single-key shortcuts
   do not fire while choosing. With Experimental off nothing is drawn beside Live at all.
   **One component, so every Live button gets it**: `LiveButton` is rendered once, in `ChatPanel`,
   and Learn, the guide and every other Live use that panel's composer.
4. **CSS (`mode-band.css`).** `.chat-live-engine select` rules go; a `.chat-live-arrow` rule joins
   the split, same height as Live in the composer (`--control-h`). Under `any-pointer: coarse` the
   arrow is drawn 40px wide — the house number — rather than given an invisible larger target,
   which would overlap Live's (Sol P7).
4b. **`LiveStatus` hides noise reduction on GPT-Live** (Sol P3). It was drawn for both engines,
   and on GPT-Live it changed nothing and reconnected for it; now it is every reader's engine, most
   readers would meet it. `live.placement !== null` is the signal, which GPT-Live never sets; the
   reconnect note says "the microphone" alone there.
5. **Privacy.** `/privacy` names `gpt-realtime-2.1` with `gpt-live-transcribe` as "the live voice
   mode" and does not name GPT-Live's two models at all — already a hole for Experimental readers,
   and the main claim once it is everyone's. It will say `gpt-live-1` with `gpt-6-luna` behind it
   (which reads the article and runs the tools), and Realtime's two "if you choose it under
   Experimental features". `tests/privacy-page.test.ts` § "names the live-conversation models" widens
   its extraction to `GPT_LIVE_MODEL` and `GPT_LIVE_BACKEND_MODEL` (four ids, positive control kept).
   `LAST_UPDATED` moves to 10 October 2026, because the page's disclosures changed (Sol P6).
   The Help pages do not name an engine (checked `src/web/help/pages`); the Live tooltip's
   "Your audio goes directly to OpenAI" is true of both.
6. **Docs.** live-conversation.md § The default model and § The second engine rewritten for the new
   default; open-questions.md Q12 says GPT-Live is the default by Greg's call and what remains open
   (whether Realtime is deleted); the 261003a plan gets a dated line pointing here; `qi-hq3fv9pw`
   closed with this plan as the source.

## Tests (red first)

`tests/gpt-live-engine.test.tsx` is the spec. Change it first, watch it go red, then the code:

- With Experimental off the engine is GPT-Live, whatever was remembered (today: Realtime).
- With Experimental on and nothing chosen, GPT-Live.
- Turning Experimental off ends a **Realtime** call once; leaves a GPT-Live call alone.
- The control: no arrow with Experimental off; with it on, an arrow that opens a menu of GPT-Live
  and Realtime with the one in effect checked; choosing remembers; disabled during a call; appears
  and disappears with the switch.
- Privacy test: four ids extracted and present.

## Plan review

GPT Sol, read-only:
[261010a-gpt-live-is-the-live-engine-for-everyone-plan-review-sol.md](261010a-gpt-live-is-the-live-engine-for-everyone-plan-review-sol.md).
**REJECT**, on P1: the plan said `owner !== DEFAULT_ENGINE`, which is true of "no call". The code
already had the `null` guard; the plan now says so and a test holds it. Every other finding was
taken: P2 the loading window, P3 noise reduction, P4 a test where the automatic hang-up is the one
that fails, P5 experimental-features.md and ai-gateway.md (both done with the docs), P6 the privacy
date, P7 the finger's target, P8 the tooltip shut while the menu is open (`enabled={!open}`, as the
bar's More does). No server route or cost path assumes a default engine (Sol checked).

## Passed over

- **Swap the default and keep the select** — the smallest change, but Greg asked for the arrow in
  so many words, and the select was the "cumbersome and ugly" half.
- **Delete Realtime now** — Q12 is still Greg's; he asked for it to stay choosable.
- **A native `<select>` restyled as an arrow** — no menu component to write, but a select cannot
  look like a chevron attached to a button on iOS without hiding it under one, and the house already
  has a Radix menu with a finger-safe trigger.

## Stages

1. This plan, GPT Sol plan review (read-only).
2. Tests red → engine/useLive/LiveButton/CSS/privacy → gates. GPT Sol code review (fixes inside the
   stage). Browser check in a Sonnet subagent (Playwright on the box): Chat and Learn, Experimental
   off and on, desktop and phone width.
3. Docs, queue bookkeeping, feedback note, push to `dev`.
