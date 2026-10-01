Review a small plan in the repo you are in: docs/plans/261001e-masthead-facts-line-overflows-a-phone.md. Read-only.

Read the plan, then the code it names: src/web/Masthead.tsx (the `facts` array and the `<p className="facts">`), src/web/styles/shell.css (the `.facts` rules), src/web/styles/narrow-window.css (anything touching `.masthead`/`.facts`), src/web/AuthorNames.tsx (what the first span holds), and tests/mark-sign-in-chrome.test.ts plus tests/helpers/stylesheets.ts (the test pattern it copies). Also `git show b8e8a9dd` for the commit that added the nowrap.

Evidence the plan rests on (measured by me in headless Chrome 390x844 against the dev server, signed in): scrollWidth 570 with no injection; 390 with `.facts{display:none}`; 390 with `.facts > span + span{display:inline-block}`. The facts innerHTML was exactly:
<span>Contributors to Wikimedia projects</span><span>Wikimedia Foundation, Inc.</span><span>11,688 words</span><span>~51 min</span><span>9 parts</span><span>31 sections</span>

Questions, answer each:
1. Is the root cause right — that adjacent nowrap inline spans with no whitespace between them form one unbreakable run — and is inline-block the right fix? Any browser where breaking around an inline-block is not allowed? Any baseline / vertical alignment / line-height change it would introduce on desktop?
2. Is there another place in the app with the same class (sibling nowrap inline items rendered with no whitespace) that this change should also cover? Grep for `nowrap` in src/web/styles and judge. Name only real ones with the selector and the markup that produces them.
3. Is the test design sound — will it really go red before the fix and green after, and does rendering Masthead via renderToStaticMarkup in a node-environment vitest work (it imports a supabase client; see tests/masthead-authors.test.tsx for the mock)? Anything the test needs that the plan has missed (fonts: headless Chrome's fallback font widths differ from the app's web font — could the test pass before the fix on a narrower fallback font)?
4. Anything in the plan that is false or missing.

Be concrete; cite file:line. Keep the answer short.
