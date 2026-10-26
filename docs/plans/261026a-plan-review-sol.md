## Verdict

The CSS move is correct and safe across all `SiteNav` callers, but the plan has two must-fix gaps before implementation.

### Must-fix findings

1. **The plan has not proved the fix addresses the reported Safari-tab state.**

   The plan itself says the tab’s actual `env(safe-area-inset-top)` value is unknown ([plan:35](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/docs/plans/261026a-signed-out-nav-below-the-clock-on-an-iphone.md:35>)), but then treats the inset as the complete fix ([plan:42](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/docs/plans/261026a-signed-out-nav-below-the-clock-on-an-iphone.md:42>)). The screenshot proves overlap, but not that `--safe-top` is non-zero.

   This matters because portrait Safari tabs commonly report `safe-area-inset-top: 0`; a WebKit engineer described zero as expected in that setting, and iOS 26 has documented viewport/sticky-header cases where applying the inset did not solve the displacement. [WebKit 274773](https://bugs.webkit.org/show_bug.cgi?id=274773), [WebKit 300523](https://bugs.webkit.org/show_bug.cgi?id=300523). The Apple status-bar meta at [index.html:149](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/index.html:149>) only controls an installed web app, not a normal tab.

   Before calling the diagnosis established, measure the reported state on the phone:

   - `getComputedStyle(document.documentElement).getPropertyValue("--safe-top")`
   - a probe’s computed `padding-top: env(safe-area-inset-top)`
   - `navigator.standalone` and `matchMedia("(display-mode: standalone)").matches`
   - ideally `innerHeight`, `screen.height`, and `visualViewport.offsetTop`

   The first real-device check should not be deferred until after deployment ([plan:82](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/docs/plans/261026a-signed-out-nav-below-the-clock-on-an-iphone.md:82>)). If the reported tab returns `0px`, this change is a no-op there, even though it correctly repairs standalone mode.

2. **The painted route pass omits one bare `SiteNav` caller.**

   The proposed list at [plan:74](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/docs/plans/261026a-signed-out-nav-below-the-clock-on-an-iphone.md:74>) includes `/privacy`, which exercises the already-inset `DocumentPage`, but omits `/features/public-readable-sharing`, whose bare nav is at [PublicReadableSharingPage.tsx:133](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/src/web/PublicReadableSharingPage.tsx:133>).

   Test both: keep `/privacy` as the document-shell regression case and add `/features/public-readable-sharing` so all six bare callers are covered. Also ensure the new signed-out branch bypasses the current unconditional `signIn()` at [safe-area-check.ts:97](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/scripts/safe-area-check.ts:97>).

## Answers

1. **Is the diagnosis right?**

   Conditionally, yes. Whenever `--safe-top` is non-zero, the missing declaration on the base `.site-nav` is exactly the problem:

   - `.site-nav` is sticky at `top: 0` but has no inset at [site.css:131](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/src/web/styles/site.css:131>).
   - Only the document wrapper supplies it at [site.css:143](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/src/web/styles/site.css:143>).
   - The interactive row begins immediately inside the nav at [SiteBits.tsx:203](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/src/web/SiteBits.tsx:203>).

   No hero, main content, or second top element also needs the inset. Those elements remain in normal flow below the now-taller nav.

   What remains unproved is whether the exact reported Safari tab supplies a non-zero inset.

2. **Is moving it to `.site-nav` safe for signed-in routes?**

   Yes.

   Signed-in Features, public-sharing, Pricing, and Public Library return their page components directly; they do not also render `HomeLogo` or another app-shell bar above them:

   - [App.tsx:681](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/src/web/App.tsx:681>)
   - [App.tsx:701](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/src/web/App.tsx:701>)
   - [App.tsx:744](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/src/web/App.tsx:744>)
   - [App.tsx:775](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/src/web/App.tsx:775>)

   Therefore there is no double inset.

   No additional arithmetic is needed on the six direct pages:

   - Their nav is in flow, so increasing its padding naturally moves subsequent content down.
   - `SignInPage`’s `min-h-dvh` flex shell at [SignInPage.tsx:52](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/src/web/SignInPage.tsx:52>) includes the nav; the flexible main simply receives less remaining height.
   - None of those pages has sticky offsets or fragment scroll margins tied to the old 56px height.

   `DocumentPage` should retain its existing safe-area arithmetic: its floor subtracts the enlarged nav at [DocumentPage.tsx:69](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/src/web/DocumentPage.tsx:69>) and its anchors add the inset at [DocumentPage.tsx:79](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/src/web/DocumentPage.tsx:79>). Signed-in `DocumentPage` does not render `SiteNav` and has its separate corner-logo clearance at [DocumentPage.tsx:61](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/src/web/DocumentPage.tsx:61>).

3. **What is known about iOS 26 Safari tabs?**

   `viewport-fit=cover` plus `env(safe-area-inset-*)` is the standards-based mechanism; WebKit’s original guidance explicitly recommends it for important content. [WebKit’s safe-area guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)

   However, iOS 26’s Safari-tab status-bar compositing is not reliably represented by a non-zero top inset. Safari may show or derive the strip behind the clock from page content while the CSS top inset remains zero, and there have been several iOS 26 viewport regressions. Consequently:

   - The inset remains the right answer for standalone `black-translucent`, landscape notches, and any browser state that reports it correctly.
   - There is no demonstrably better single CSS value for an ordinary tab when Safari reports zero.
   - If the measured report state is zero, the choices become a narrowly gated iOS/browser-mode fallback with a device-dependent reserve, changing the edge-to-edge viewport policy, or redesigning the phone nav. Those are product trade-offs, not an automatic improvement over `env()`.

4. **Are the checks sound?**

   The pairing is sound as a structural regression check:

   - The static test verifies ownership of the declaration.
   - The forced-59px browser pass verifies actual computed geometry and paint order.
   - A site-specific `--break` that overrides `.site-nav { padding-top: 0 }` is a valid red check. The existing `--break` at [safe-area-check.ts:88](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/scripts/safe-area-check.ts:88>) currently breaks only the reading-view backstop, so the two modes must select different defects.

   The Chromium pass cannot prove what iOS reports or paints outside the web viewport; the plan correctly acknowledges that limitation at [plan:79](</var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/docs/plans/261026a-signed-out-nav-below-the-clock-on-an-iphone.md:79>). It should therefore supplement, not replace, the pre-merge phone measurement.

No files were edited. I attempted the prepared static test, but the repository’s test admission guard refused to start because of current machine memory pressure; no test ran.