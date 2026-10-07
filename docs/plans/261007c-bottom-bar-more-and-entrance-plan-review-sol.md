The plan is buildable, but not safely as written. There are no P0 findings.

### Findings

**PR-1 — P1 — Established: More would sit inside the mode radiogroup**

(a) D6 places More “in the same frame.” That frame is inside `.dock-modes-radios[role="radiogroup"]` ([Dock.tsx](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/Dock.tsx:2963)). The existing implementation deliberately places Marginalia outside that element because it is not a radio ([dock-fit.css](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/styles/dock-fit.css:363)). A keyboard or screen-reader user would therefore encounter an ordinary menu button as a member of “What the middle column shows.”

(b) Replace D6 with:

> **D6. More is outside the radiogroup.** It is a sibling `.dock-frame` immediately after `.dock-modes-radios`, with `<button aria-haspopup="menu">`. This puts it after the direct mode segment rather than literally after Skim; that small ordering cost preserves one honest radiogroup containing only modes.

This is also the simpler More design. Exact placement after Skim requires restructuring or visually reordering controls across the radiogroup boundary.

---

**PR-2 — P1 — Established: Escape would close the drawer underneath the menu**

(a) The Dock deliberately remains operable while its non-modal drawer is open ([Dock.tsx](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/Dock.tsx:2029)). A reader can open Comments, then More. Radix DropdownMenu is modal by default ([index.mjs](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs:23)), but the drawer’s window-capture Escape handler only yields to native `dialog[open]`; otherwise it stops propagation and closes the drawer ([Dock.tsx](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/Dock.tsx:1947)). Thus the first Escape closes the underlying drawer and leaves the topmost menu open.

(b) Add to D4:

> The More menu is the top overlay when a Dock drawer is also open. The drawer’s capture-phase Escape handler yields while More content is open, so the first Escape closes More and returns focus to its trigger; a second Escape may close the drawer. Add a rendered drawer → More → Escape test. Links use `DropdownMenu.Item asChild`, following ShelfEntry’s anchor example.

---

**PR-3 — P1 — Reasoned from established behavior: the Tooltip can remain open over the menu**

(a) The proposed Tooltip and Radix menu are both portalled. Tooltip stays open while the pointer remains over its trigger ([Tooltip.tsx](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/Tooltip.tsx:297)); opening the menu does not constitute pointer leave. Both surfaces would open above the same button and can overlap. The plan’s “tooltip card on More” ([plan](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/docs/plans/261007c-bottom-bar-rises-in-on-first-load-and-a-more-button-gathers-the-lesser-modes.md:151)) does not coordinate their state.

(b) Replace that stage bullet with:

> More’s Tooltip is controlled by the menu’s open state and disabled while the menu is open; test that opening More removes any mounted tooltip before menu content appears.

Omitting the tooltip entirely would be simpler, but costs an explanation when the label is removed by the fit ladder.

---

**PR-4 — P1 — Established: the portalled menu does not hold a hidden phone Dock home**

(a) Radix moves focus into portalled menu content, outside `.dock`, so `.dock:focus-within` becomes false. The current phone guard recognizes only the drawer, Dock focus, dialogs, install hint, and covering mode bands ([narrow-window.css](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/styles/narrow-window.css:610)). With `data-bars="hidden"`, the Dock can therefore slide away beneath its open menu.

(b) Replace the vague CSS stage sentence with:

> Add `.dock-more-trigger[data-state="open"]` as an explicit argument of the existing `:root:has(...)` keep-home guard, restoring all three coupled variables. Extend `the-dock-hides-in-a-mode-beside-the-article.test.ts` to assert that exact guard.

---

**PR-5 — P1 — Established: the iOS install hint remains while the Dock is “absent”**

(a) D7 applies the entrance class only to `.dock`. `InstallHint` is a sibling rendered before it ([Dock.tsx](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/Dock.tsx:2161)), fixed immediately above the Dock ([dock.css](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/styles/dock.css:191)). On an eligible, undismissed iPhone, the hint would float over an empty Dock-sized gap for the first second.

(b) Add to D7:

> The entrance state covers both `.dock` and `.install-hint`. The hint is hidden during the delay and appears with the Dock; reduced motion shows both immediately. Add the eligible-iOS-hint case to the rendered and browser tests.

---

**PR-6 — P1 — Reasoned: once per slug is broader and more repetitive than the stated goal**

(a) The goal is to help somebody opening their first article, but D7 hides the critical bar again for every new slug in a long-lived session ([plan](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/docs/plans/261007c-bottom-bar-rises-in-on-first-load-and-a-more-button-gathers-the-lesser-modes.md:122)). A regular reader opening ten articles pays ten delays. It also ambiguously says “visitor pages never play it,” although a signed-out article reader is part of the target audience.

(b) Replace D7’s scope with the simpler rule:

> The entrance plays once on the first `Reader` mount in this JavaScript page lifetime, for an owner or signed-out article visitor. Metadata and `PublicPages` Dock mounts do not play it. Refreshing the tab may replay it; later articles in the same tab do not.

Cost: it does not identify a genuinely new account and replay is possible after refresh. It is nevertheless closer to the request and simpler than a set of slugs.

---

**PR-7 — P1 — Reasoned from React’s contract: the module guard is unsafe unless mutation is commit-only**

(a) The application mounts under StrictMode ([main.tsx](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/main.tsx:235)). If a module set/boolean is mutated during render or a state initializer, StrictMode’s discarded render—or a future aborted concurrent render—can consume the entrance before anything commits.

(b) Add:

> Reading the module guard during render is allowed; mutating it is not. The component records that the entrance actually played only in a committed effect, never in render or a state initializer. Test the first mount and subsequent remount under `<StrictMode>`.

---

**PR-8 — P1 — Reasoned: “visibility in the first keyframe” is insufficient**

(a) `visibility` is discrete. A simple `hidden → visible` keyframe can become visible as soon as interpolation begins, and fill-mode determines what applies during the one-second delay. D7 does not specify either, so it does not yet guarantee “not focusable or clickable” during that second.

(b) Replace the CSS description with:

> `.dock-enter` has static `visibility:hidden` and `animation: dock-enter .6s ease 1s forwards`. Both animation endpoints set `visibility:visible`; the first sets opacity 0 and downward `translate`, the last opacity 1 and zero `translate`. Reduced motion sets `animation:none; visibility:visible`. A browser test asserts hidden/non-actionable during the delay and visible/actionable afterwards.

The fit ladder itself is safe: `visibility`, opacity, and `translate` do not change `scrollWidth` or `clientWidth`; the measurement remains the comparison documented in [dock-fit.ts](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/dock-fit.ts:23). Separate `translate` also composes with the Dock’s hide-on-scroll `transform` ([dock.css](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/styles/dock.css:49)). If `data-bars="hidden"` arrives during the entrance, hide-on-scroll correctly wins and the Dock finishes offscreen.

Playwright `locator.click()` will normally wait for visibility, so an immediate click is delayed rather than misdirected. Direct DOM `.click()` tests ignore CSS and cannot prove this behavior.

---

**PR-9 — P1 — Established: D5 deliberately reverses an authoritative command-bar contract without naming that decision**

(a) The code and documentation currently say command-bar mode rows are exactly the array the Dock drew ([Dock.tsx](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/Dock.tsx:2172), [reading-view-overview.md](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/docs/project/reading-view-overview.md:251), [command-bar.test.tsx](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/tests/command-bar.test.tsx:230)). D5’s proposed full list is sensible, but it is a product-contract change, not merely keeping existing plumbing unchanged.

(b) Replace D5’s opening with:

> **D5. The command-bar contract changes deliberately:** its mode rows exactly match what the Dock offers, either directly or under More—not only the direct radios. `visibleModes` remains that reachable set; drawing uses the split subset. Rewrite the code comments, overview, and non-vacuous equality test to this contract.

---

**PR-10 — P2 — Established: at least two tests would remain green while dropping coverage of gathered modes**

(a) `public-network-trace.test.tsx` claims to press every mode but loops only over direct `[role="radio"]` controls and merely checks that the list is non-empty ([public-network-trace.test.tsx](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/tests/public-network-trace.test.tsx:2827)). It would stay green while testing none of the five menu paths. Likewise, “gives every mode its own tab stop” only enumerates radios ([arrows-belong-to-the-article.test.tsx](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/tests/arrows-belong-to-the-article.test.tsx:139)).

`measure-cpu.ts` is not silent: missing direct buttons produce explicit warnings ([measure-cpu.ts](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/scripts/measure-cpu.ts:756), although it apparently still exits successfully).

(b) Replace the generic test-update bullet with:

> Introduce a traversal helper that visits direct radios and then opens More and visits its items. Assert the visited mode identities equal the expected reachable set. Use it for both public-network sweeps; rename or narrow the tab-stop test so it does not claim coverage of menu items. Update `measure-cpu.ts` to open More and treat an unmeasured requested mode as a failing exit.

### D1–D7 disposition

- D1 and D2 are sound for More.
- D3 is sound and preferable to making More itself “on”; the latter overloads a menu trigger and loses the existing second-press-to-close behavior.
- D4 is right about clipping, transforms, portalling, and the two activation arms, but incomplete on overlay ownership, Tooltip state, phone pinning, and `asChild`.
- D5 is accurate about today’s dataflow, but changes the documented contract.
- D6 is not compatible with the current DOM structure.
- D7’s choice of independent `translate` and its fit measurement are safe. Its audience, StrictMode guard, visibility timing, and attached install hint need the fixes above. Keyboard focus during the hidden second will skip the Dock; that is consistent with “absent,” but should be an explicit accepted cost.

VERDICT: build with the P0/P1 fixes