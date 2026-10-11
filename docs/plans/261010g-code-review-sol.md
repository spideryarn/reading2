1. **High — fixed:** a suggestion list landing while the bar was closed reopened with Guide chat selected. The next Enter could therefore open Guide instead of the first suggestion. [CommandBar.tsx](/var/tmp/spideryarn-worktrees/fbq3pzyn-guide-in-command-bar/src/web/CommandBar.tsx:2016) now preserves that newly returned selection through one reopening. Regression was red before the fix.

2. **Medium — fixed:** with Guide plus suggestions, the DOM was `Guide → heading → rule → suggestions`, separating “From why you’re reading” from its rows. The two separators are now independent and correctly ordered: `Guide → rule → heading → suggestions → rule → ordinary rows`. [CommandBar.tsx](/var/tmp/spideryarn-worktrees/fbq3pzyn-guide-in-command-bar/src/web/CommandBar.tsx:2699)

3. **Low — fixed:** expanded coverage for slow profile-read insertion, save-driven removal, typing then clearing, closed-bar suggestion arrival, and held-Enter guards. [command-bar-suggest.test.tsx](/var/tmp/spideryarn-worktrees/fbq3pzyn-guide-in-command-bar/tests/command-bar-suggest.test.tsx:426), [command-bar-guide.test.tsx](/var/tmp/spideryarn-worktrees/fbq3pzyn-guide-in-command-bar/tests/command-bar-guide.test.tsx:330)

4. **Low — fixed:** Help overstated availability (“on your own article,” including Metadata) and incorrectly said closing retained typed text. It now says “while reading your own article” and accurately says closing clears the draft. The Help corpus was regenerated. [keyboard.md](/var/tmp/spideryarn-worktrees/fbq3pzyn-guide-in-command-bar/src/web/help/pages/keyboard.md:10)

5. **No issue:** `pinnedGuide.find()` returns the existing command object. It does not independently churn `ordinary` or `shown`; upstream command changes already rebuild `results`, and the selection effect is guarded by `reason`/`list` identity.

6. **Medium — wider, not changed:** Help’s command-bar screenshot still shows Plain first with no Compass. It should be retaken using the existing recipe. [help-images.ts](/var/tmp/spideryarn-worktrees/fbq3pzyn-guide-in-command-bar/src/web/help/help-images.ts:168)

7. **Low — wider, not changed:** `reading-view-overview.md` still says every non-mode follows the modes and that an empty owner bar opens on Suggest. Both now need the Guide exception. [reading-view-overview.md](/var/tmp/spideryarn-worktrees/fbq3pzyn-guide-in-command-bar/docs/project/reading-view-overview.md:308)

Validation:

- Requested Vitest run: **385 passed, 3 skipped**
- Full typecheck driver: **all four projects passed; 3,664 files covered**
- `npm run typecheck` itself was attempted but its `tsx` launcher hit the known sandbox IPC `EPERM`; `node --import tsx scripts/typecheck.ts` passed.
- Scoped lint: no errors; existing complexity advisories only
- Diff check: clean
- No commit made.