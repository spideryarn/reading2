# Design-consistency follow-ups: five queued items from 261007h

**Status: plan, 2026-10-07.** The five items plan
[261007h](261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md)
left in the queue (§ Left, and where it went). Greg, 2026-10-04, on the Overseer's queue: *"If
you're confident, address all of the Q-queue-yeses"*; and on 261007h's deferrals, 2026-10-07:
*"yes to all as you see fit"*. The aim is 261007h's: *"controls that do the same job should look
the same in every mode"* (Greg, 2026-10-07).

One commit per item, cheapest and clearest first. Each defect gets a test seen red first.

## S1 — `qi-fahzat55`: Learn's Start over names what it is doing

**Now.** Start over (`ConversationModes.tsx`, `onDelete` in Learn) sets `resetting` to
`stopping-live`, then `deleting`, and hides the conversation at once (`theLearn` is null unless
`resetting === "idle"`). `ChatPanel` then draws `ChatListLoading` — the delayed band wait — so
for 600ms nothing answers the press, and then it says *"Fetching your Learn conversation…"*,
which is not what is happening.

**Change.** `ChatPanel` takes a `startingOver: boolean` (true while `resetting !== "idle"`); in
the `learn` arm it draws `<BandWaiting delayMs={0}>Starting over…</BandWaiting>` instead of
`ChatListLoading`. The press-response exception in
[loading-spinner.md](../project/loading-spinner.md) is exactly this case. One sentence for both
phases rather than one per phase: the reader pressed one button, and "Ending the live
conversation…" then "Clearing…" is two lines flashing past for one act.

**Test first:** render `ChatPanel` in Learn with no thread and `startingOver`; expect "Starting
over…" on the first render and no "Fetching". Red before the prop exists.

## S2 — `qi-h2cneb4y`: Ask in chat at Dig deeper's size

**Now.** Glossary: Dig deeper is shadcn `Button` outline/sm (32px) beside a 28px `.gloss-btn` Ask
in chat. Citations: Dig deeper was cut to `xs` (24px) to match its 25px Ask in chat.

**Change.** `AskInChatButton` (`OriginChat.tsx`) renders `Button variant="outline" size="sm"`,
keeping the caller's placement class; Citations' Dig deeper goes back to `sm`. Both pairs are then
32px. Its only two callers are Glossary and Citations (Debate's claim has its own icon button),
so "used in several modes" is these two. The `.gloss-btn` rules that styled it are checked for
anything that would now fight the Button's classes. Wrapping checked in a browser at 1440, the
iPad band (~288px) and 390.

**Test first:** a render test that Ask in chat and Dig deeper carry the same `data-size` in each
panel (red today: the Ask button has no `data-size`).

## S3 — `qi-mpnpp2qp`: Diagram's pager takes the Quotes/Skim shape

**Now.** `.diag-step` is a three-column grid; each button fills its third (≈160×44), border
`--rule`, half radius, transparent ground, faint ink. Quotes' and Skim's are 44px squares
(`--control-h-lg`), `--rule-strong` border, `--radius`, `--surface-raised` ground, ink.

**Change.** Dimensions and look only: `.diag-step` becomes a centred flex row like
`.quotes-step`; `.diag-step-btn` takes `.quotes-arrow`'s box (44px square, border, radius,
ground, ink, hover border, focus mark). **Kept** (GPT Sol's R20 on 261007h): vertical chevrons,
`aria-disabled` rather than `disabled` (the unavailable look moves to `[aria-disabled="true"]`),
and the focusable readout with its card. The readout gets Quotes' `min-width` so the buttons do
not move as the count grows.

**Trade-off, named:** the buttons shrink from ≈160×44 to 44×44. 44px is the house touch height
and Apple's minimum; Greg's iPad ask (2026-08-27) was for a target a thumb could hit, which 44
still is, and the queue item asks for exactly this shape. The comment that says "the size is the
whole feature" is rewritten to say what changed and why.

**The missing up-cell border** — diagnosed in the browser baseline: not missing. Computed style
gives 1px on all four sides of both buttons. At the start of the article the up button is
`aria-disabled`, drawn at `opacity: 0.3` with a `--rule` border on a near-black ground, which is
nearly invisible. Quotes' box (`--rule-strong` border, raised ground) and Quotes' 0.4 for an end
cure it as part of the shape change; no separate fix.

## S4 — `qi-a5gzv44d`: six elevation shadows soften in light

**Now.** Docked/in-column chat (`dialogs.css`, two rules), the Ask chip (`annotations.css`), the
revealed gutter (`gutter.css`), the dock drawer (`dock.css`, upward), the mode herald
(`mode-band.css`) and chat's latest-message pill (`chat-actions.css`) keep dark-tuned black
literals, so they are heavy on a white page.

**Change.** One factor rather than six tokens: `--shadow-strength: 1` in the dark block,
`0.38` in the light one (roughly the ratio the three F6 tokens already use), and each of the six writes
its alpha as `calc(<dark alpha> * var(--shadow-strength))`. Dark computes to the same number, so
it is pixel-identical; each silhouette stays its own. **Simpler option passed over:** six new
tokens, each with a dark and a light value — twelve numbers to keep in step, for silhouettes used
once each. The factor is one number and says the rule ("light is ~0.38 of dark") once.

**Test first:** a stylesheet scan that every outer (non-`inset`) `box-shadow` with a black colour
in `src/web/styles/` uses a `--shadow-*` token or `var(--shadow-strength)`; red today on the six
(and any others it finds, each judged: elevation or not).

## S5 — `qi-zm95p9we`: the voice row, one geometry

**Now.** Chat: bare mic, "Live", engine menu (Experimental), Send. Learn: mic + "Talk", "Live
conversation", the menu, Send; at 390 Learn's Send drops to its own line. The mic and Live button
are 1.65rem (26px); Send is `--control-h` (36px).

**Why Send drops.** The baseline at 390 (Experimental on): mic+Talk, "Live conversation" and the
engine select fill the line under the box and Send wraps. A flex row breaks its lines from each
item's natural width before shrinking anything, so the last item — Send — is the one that goes.

**Change, decided.** The microphone and Live go in one `<span class="chat-voice">` in the
composer. In Chat it is `display: contents`, so Chat's row is unchanged. In Learn it is the row's
growing item (`flex: 1 1 0; min-width: 0; flex-wrap: wrap`): a zero basis means the row never
breaks a line for it, so Send stays at the end of the line under the box, and the group wraps
inside itself — Live goes under Talk when there is no room, and its own row wraps the engine
select below Live when the two cannot fit beside Send. That holds
in every state Sol's M5 named ("Listening…", "Writing it down…", Hang up, Cancel), at 390 and in
the iPad's 288px band, because it does not depend on any label's width. And the microphone, the
Live button and the engine select take Send's 36px (`--control-h`) inside `.chat-composer` only,
in both modes. "Talk" and "Live conversation" stay (R20).

**Simpler option passed over:** shortening Learn's label to "Live" at narrow widths. It fixes idle
at 390 but not a longer state or the 288px band, and it needs a width the CSS cannot ask the band
for without a container query, which this repo has backed out of once (structure-mode.css).

## Not in this job

The queue itself (the Overseer owns it). Font sizes across modes (`qi-f8h393sb`).

## Review

GPT Sol on this plan (read-only), then one code review over all five commits.

## What GPT Sol's plan review changed

[Review](261007m-plan-review-sol.md): READY WITH CHANGES, no P0 or P1.

- **M1** (S1 keeps `chat-loading`'s geometry): built that way already — `as="div"
  className="chat-loading" delayMs={0}`. Not taken: extending the controller lifecycle test to
  the prop through Live shutdown, pending DELETE and restore — the prop is `resetting !== "idle"`,
  read straight from the state those paths already set and the existing Learn tests drive.
- **M2** (S2's touch floor): Citations' pair had a 36px `min-height` under `pointer: coarse` and
  Glossary's did not, so the pair would have been one size for a mouse and two for a finger.
  Glossary's Dig deeper and Ask in chat take the same floor.
- **M3** (S3's size floor): `--control-h-lg` is 2.75rem, 33px at a 12px root, where Diagram's bar
  held 44px. Diagram's squares are `max(44px, var(--control-h-lg))`; the test holds that. Sol also
  preferred broad buttons under a coarse pointer; overruled — the queue item asks for Quotes' and
  Skim's shape, which Greg approved, and 44px stays a thumb's target. Quotes and Skim have the same
  12px-root shrink; not touched here, said in the debrief.
- **M4** (S4's test could pass with 1 in both themes): the token test now asserts 1 outside the
  light block and 0.38 inside it. Sol favoured the factor over six tokens and agreed dark computes
  unchanged.
- **M5** (S5 must hold through every state and a narrow band, not just idle at 390): taken into S5.

## Code review of S1–S5

**C1 — P1, fixed in the working tree:** wrapping `.chat-voice` alone still leaves Learn's
`.chat-live` as one unwrapping flex item. With Experimental on, its Live button and engine picker
can exceed the group's available width in the 288px band and extend into Send's space. The
Learn-only rule now wraps that inner row and gives it `min-width: 0; max-width: 100%`. Chat's
base row stays as it was. The added CSS-contract regression in `voice-row.test.tsx` was seen red
before the fix and green afterwards; it does not measure browser layout. A second reviewer
independently confirmed the cause and scope of the fix.

The submitted S1–S5 tests were also run against an archived copy of `9b939b442`, with the candidate
tests copied in: each item's new assertions fail on the old behavior. That reproduces red-before
evidence, rather than relying on the commit messages. The S1 test covers the panel's immediate
copy, S2 the shared Button configuration, S3 declared geometry, S4 shadow routing/theme factors,
and S5 markup/declarations. They do not establish computed dimensions or pixel equivalence.
Inspection of all seven S4 shadow declarations confirms that their original dark alpha and
geometry are preserved. The anonymous Chat wrapper retains DOM focus order and the descendant
`:has()` selectors; Learn's dictation strip and Live status retain their full-width rows and order.

**C2 — P2, wider scope, unchanged:** Quotes and Skim still use `--control-h-lg` without Diagram's
44px floor, giving 33px squares at a 12px root, as M3 already records above.

Browser verification could not run in this review sandbox: system Chrome exits on a denied socket
operation (`EPERM`), and the Sonnet browser dispatch timed out without an answer. The final run
of the requested seven test files plus `learn-own-thread.test.tsx` passed all 119 tests, including
the added C1 regression.
Typechecking passed via `node --import tsx scripts/typecheck.ts` (the npm script's `tsx` launcher
cannot create its IPC socket here). Full `npm test` is blocked by the unavailable local database;
lint of the two changed code/test files reports only two existing specificity warnings.

## What landed

S1 `bd7a7056a`, S2 `1cf3d283c`, S4 `13a22e307`, S3 + plan-review fixes `157cf5bd3`, S5 `4f85b5d01`,
GPT Sol's code-review fix C1 `f398443df` ([review](261007m-code-review-sol.md), READY WITH THESE
FIXES). Browser check at 1440, 1024, 768 (the 288px band) and 390, mouse and emulated touch: every
item as planned; dark shadows equal the old literals, light ones 0.38 of them; Start over shows its
line 29ms after the press. **Follow-up `116e01c1f`:** Quotes' and Skim's arrows now have Diagram's
44px floor too (Sol's C2). **Left:** Citations' row still wraps raggedly at 390 and 1024, now with
32px buttons — the same shape it had before.
