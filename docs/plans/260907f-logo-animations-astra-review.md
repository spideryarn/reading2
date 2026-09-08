**I would not push this unchanged.** There are gesture-state defects and two remaining geometry errors.

I read the requested files and both prior reviews. All **19 existing tests pass**. Temporary [handler-level probes](/tmp/logo-cross-review/trigger.test.tsx) produced **four failures**, while rerender and unmount-cleanup checks passed. I did not run a new browser or device session; the CSS findings below come from the declarations and geometry.

Ranked by what I would fix first:

1. **A long mouse press can navigate after leaving and returning.**  
   [logo-animation.ts:260](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/logo-animation.ts:260)

   Hold past 350ms, move just outside the control, move back while still holding, then release. `pointerleave` clears `suppressClick`; re-entry and release never restore it. The click reaches `Link` unprevented and navigates.

   A small excursion across the edge suffices; this does not require initiating a native drag. The handler probe fails.

   **The prior fix is overbroad:** leaving the control does not establish that the gesture ended or that no click can follow. Keep suppression associated with the completed long press until that gesture ends, while still allowing a subsequent deliberate press.

2. **A second pointer can erase the first pointer’s gesture.**  
   [logo-animation.ts:286](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/logo-animation.ts:286), [305](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/logo-animation.ts:305)

   There is no pointer ownership. Every primary-button `pointerdown`, including another finger, replaces the timers and clears suppression; every `pointerup` cancels the shared press timer.

   Two concrete sequences:
   - Finger A holds past 350ms; finger B briefly presses and releases the logo; A releases. B has erased A’s click suppression. The probe confirms the eventual click is unprevented.
   - A presses; B presses at 100ms and releases at 200ms; A keeps holding. No long press fires. B’s release also clears `pressedByTouch`, allowing the context menu while A remains down.

   Track the owning `pointerId`, reject additional presses while it owns the gesture, and ignore unrelated up/cancel events.

3. **Radius Sweep and Dragline Drop are misaligned in the coarse-pointer dock.**  
   [logo-animations.css:694](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/styles/logo-animations.css:694), [753](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/styles/logo-animations.css:753)

   Their geometry assumes the image begins at the anchor’s left padding. But [narrow-window.css:643](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/styles/narrow-window.css:643) makes `.dock-home` grow, and [657](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/styles/narrow-window.css:657) centres its contents.

   On a tablet with spare row space, the spider moves right while both pseudo-elements remain at the padding. Radius paints an offset second spider; Dragline’s thread misses the spider.

   This also occurs without flex growth: at a 16px root size, rung 3’s icon-only control has a 40px minimum width and 7.2px padding. Its centred 20px image starts at **10px**, while Radius starts at **7.2px**—a **2.8px error**.

   The four padding values match their declarations; **padding is not always the image’s position**. Position these effects relative to the rendered mark. The invariant asserted at [design-logo.md:202](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/docs/project/design-logo.md:202) needs correcting too.

4. **Touch linger has two lifetime defects.**  
   [logo-animation.ts:286](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/logo-animation.ts:286), [297](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/logo-animation.ts:297)

   **It expires before the promised time.** The 4.5-second timer starts at the long-press threshold, not release. Hold for five seconds and the animation finishes beneath your finger; lifting gives you no linger. This contradicts the documented behaviour and fails the probe.

   **It can lose its only expiry.** Long-press and release; during linger, make a second short touch that ends without navigation or `pointercancel`. Its down cancels the linger timer without clearing `active`; its up schedules no replacement, and touch leave is ignored. The old animation remains active indefinitely.

   The second failure is conditional on the browser producing neither navigation nor cancellation—for example, a moved gesture whose click is discarded. The handler sequence is demonstrated; that device sequence remains unverified.

   Start linger on the owning touch’s release. When another interaction cancels an existing linger, explicitly clear or transfer ownership of its active state.

5. **Abseil’s thread detaches during descent and ascent.**  
   [logo-animations.css:639](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/styles/logo-animations.css:639), [650](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/styles/logo-animations.css:650)

   The thread rides inside the moving letter and scales from its **top**. At half the eased descent, the letter has dropped 4px. The thread runs from approximately 4px above the original glyph top to the original glyph top, leaving a **4px gap** before the descending letter.

   At the full 8px hang, the endpoints happen to align. **The previous offset fix corrected that pose, not the motion.**

   With the existing offset and synchronised keyframes, `transform-origin: bottom` keeps the thread’s lower end attached to the letter and its upper end at the original attachment point. This affects both visible-word mount points.

**The durable CSS explanations still contain actionable errors.**

- [The header at line 40](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/styles/logo-animations.css:40) says reduced motion freezes the *first* frame. It does not: delays remain, then the shortened animation finishes, and fill mode determines whether the underlying style or final frame remains. “The guard fills nothing” in [design-logo.md:156](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/docs/project/design-logo.md:156) is likewise false globally. The guard does not change fill mode. [CSS animation fill semantics](https://www.w3.org/TR/css-animations-1/#animation-fill-mode).

  The blanket “start and end every keyframe set at rest” rule also has existing exceptions: Register starts with displaced shadows, Retype starts dim, Blink starts visible, and Seam’s thread ends extended. Safe underlying styles and explicit fill behaviour are the useful contract.

- **The earlier Retype explanation is not an established root cause.** [Its current keyframes end at opacity 1](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/styles/logo-animations.css:567). Normal `both` semantics therefore do not explain four letters remaining at 0.3 indefinitely. Keep the observed `backwards` workaround, but describe the permanent dimming as an observed browser result with an unresolved cause, rather than ordinary forwards-fill behaviour.

- [Seam’s comment at line 364](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/styles/logo-animations.css:364) promises that the letters transition closed. Their transition declaration disappears with `.spya-seam`, so they snap closed. The prose correction to “Only The Settle eases out” did not reach this comment.

- [Radius’s reduced-motion comment at line 739](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/styles/logo-animations.css:739) says the overlay exists for 0.01ms. Its static content, background and angle persist for the entire active class: the result is a permanent two-tone still.

- [The gallery’s clipping claim at line 300](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/styles/design-page.css:300) is false. `overflow: hidden` clips the whole caption-containing card, not a 40px wordmark viewport. A falling letter can extend into the space below the logo without encountering the dock’s clip. The gallery cannot certify dock clearance.

**Areas checked without another defect found:**

The picker preserves the previous draw across leave, both mount points attach the hook correctly, and `Link` invokes the hook before checking `defaultPrevented`. Ordinary short presses and cancellation are sound. Rerendering during the hold preserves the refs and timer callback; unmount clears all retained timers. I found an orphaned active state, not an orphaned running timeout.

The `.spya-anim:not(.logo-home)` exclusion is correct. I do not find a Dawn/fixed-position defect: masking the anchor does not change its own fixed positioning. The masking specification establishes a stacking context and explicitly preserves box geometry and hit testing. [CSS masking rendering model](https://www.w3.org/TR/css-masking-1/#the-mask-image-rendering-model).

For the ordinary desktop dock, I found no declaration-driven horizontal overflow: the cursor and sideways transforms fit within the available padding. Abseil and Dragline remain the closest to the vertical clip; Abseil’s easing overshoots its nominal 8px, so the documentation’s exact clearance should not be treated as measured. This is a geometry assessment, not live clearance verification.

The seven letter-only effects disappear together with the hidden wrapper, including their pseudo-elements. The six mark effects remain available. The dock word disappears starting at **rung 1**, and coarse-pointer dock height is **52px**, so “tightest rungs” and “40px” are incomplete descriptions.

**The tests guard syntax more strongly than behaviour.** The [resting-transform guard](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/tests/logo-animation.test.tsx:108) accepts `transform: none` on a thread, which recreates the full-length resting defect. Removing the letters’ positioning also leaves all six stylesheet guards green. Neither coarse-pointer alignment nor Abseil’s moving endpoints is represented.

The [abandoned-press test](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/tests/logo-animation.test.tsx:303) cannot independently validate the leave reset: its subsequent `pointerdown` clears suppression anyway.

I would add just two permanent checks:

- Long mouse press → leave → re-enter without another down → release/click; assert suppression before `Link` handles it.
- A browser geometry check comparing the Radius overlay and Dragline attachment with the actual image under coarse-pointer centring, including rung 3 and a grown tablet button. This catches the same misplaced-overlay class that already happened in the gallery.

On design, I would reconsider **Only the i**: [its rationale](/home/greg/code/spideryarn2/.claude/worktrees/logo-animations/src/web/styles/logo-animations.css:463) says the motion distinguishes the raised letter from a typographic fault, while reduced motion deliberately removes that distinction and leaves the raised letter. That is a taste concern, not a blocker. The rest of the set has enough range to justify keeping it, once the interaction and attachment errors are fixed.

**Conclusion: not safe to push as it stands.** The minimum is to preserve gesture ownership and long-press suppression, repair touch-linger lifetime, align the two dock pseudo-elements under coarse-pointer centring, and fix Abseil’s transform origin. Correct the motion-guard and geometry contracts alongside those changes, then verify the coarse-pointer dock in a browser.