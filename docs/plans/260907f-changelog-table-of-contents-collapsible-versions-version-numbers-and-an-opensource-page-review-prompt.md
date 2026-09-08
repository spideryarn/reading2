# Review prompt — 260907f, the changelog page and `/opensource`

You are reviewing **code that is already written** (stage-2 review, weighted higher than a
plan-stage one). Repository: `/home/greg/code/spideryarn2/.claude/worktrees/changelog-toc-and-opensource`.
Read files there directly; the scoped diff is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/3dbdbfcb-3264-4b23-9243-1c3013826ae9/scratchpad/clog-diff.txt`
(all of `src/` and `tests/`, with the three new files appended in full after the diff).

## What was asked for

Greg, 2026-09-07, in two messages:

> Can you add a table of contents to /changelog, and make each version a collapsible section, all
> default-collapsed except the most recent one. Also, I found the difference between the link to the
> changes and the commit a bit confusing. And take browser screenshots and try and make that page
> more readable and attractive. And include a link to GitHub for the commit corresponding to each
> version. And also then create a brief /opensource page in the footer with links to/from various
> other pages, using GitHub logo to indicate.

> Also, let's include a version number (semver?) as part of the deploy, and include that in
> /changelog for each version, and on tooltip for the Homepage logo.

The plan, with the reasoning and the decisions taken, is
`docs/plans/260907f-changelog-table-of-contents-collapsible-versions-version-numbers-and-an-opensource-page.md`.
Read it first. The evergreen docs it implements against are `docs/project/changelog.md` (especially
§ *A version is a deploy* and § *The page*) and `docs/project/website-text.md`.

## What changed

- `src/web/ChangelogPage.tsx` — rewritten: a contents list, one `<details>` per release (shut but
  the newest), release numbers, a GitHub link per release, and an entry's commits drawn in one row
  rather than two.
- `src/changelog.ts` — one new export, `shaFromCommitUrl`, which `badLinkUrl` now also uses.
- `src/web/GitHubMark.tsx`, `src/web/OpenSourcePage.tsx`, `src/web/styles/changelog.css` — new.
- `src/web/router.ts`, `src/web/App.tsx`, `src/web/page-title.ts`, `src/web/SiteFooter.tsx` — the
  `/opensource` route wired in.
- `src/web/build-stamp.ts` (`buildDescription`) and `src/web/HomeLogo.tsx` — the logo tooltip.
- `tests/changelog-page.test.tsx`, `tests/site-footer.test.tsx` — updated and extended.

## Evidence, so you do not have to take my word for any of it

- `npm run typecheck` — clean, all three projects.
- `npx vitest run tests/changelog-page.test.tsx` — 26 passed.
- `npx vitest run tests/site-footer.test.tsx` — 17 passed.
- Measured in Chrome at 1280×1000 against `npm run dev` on the real 69-line file: page height
  **46,368 px → 4,640 px**; 50 contents rows and 50 `<details>`, of which exactly 1 open on load;
  `/changelog#release-64` opens release 64 *and* release 69; console clean on a fresh load.
- `src/web/changelog-versions.ndjson`: 69 lines, **68 distinct shas** — line 6 (2026-08-27T07:36) is
  a redeploy of line 5's sha with `commit_count: 0`. This is load-bearing for the numbering decision.

## What I want you to rule on

Give me a numbered list of findings, each with a **severity** (P1 blocks the commit / P2 should be
fixed / P3 worth knowing), the **file and line**, and — this is the part I care about most — a
**concrete failure**: an input or a state and what goes wrong. Then a short verdict paragraph.

Specifically, please look at:

1. **The release numbering.** It started as `i + 1` over the oldest-first array in
   `groupForDisplay`, which was a bug I caught while writing this prompt: `parseChangelog` drops a
   bad line, so the index was into what *parsed*, and one unparseable line would silently renumber
   every release above it. It is now `ChangelogVersion.release`, counted over the file's non-blank
   lines inside `parseChangelog`, with `readVersion` returning `Omit<ChangelogVersion, "release">`
   so a future edit cannot invent the number from a line's own contents.
   **Check the fix, not the story**: is the counter in the right place relative to both failure
   paths, does a blank line in the middle of the file do the right thing, and is `Omit` actually
   buying what the comment claims? The test is *"keep their numbers when a line above them fails to
   parse"*.

2. **The commit/link split.** `splitEntryLinks` sorts an entry's links by whether
   `shaFromCommitUrl` recognises them. Can anything reach the page that is neither a path nor a
   commit and is therefore silently dropped or mis-sorted? Check `parseChangelog` § `badLinkUrl`
   and whether my reuse of `shaFromCommitUrl` there changed its behaviour in any case.

3. **The open/shut state.** It is now React state seeded once from `window.location.hash`, with
   `onToggle` feeding the reader's clicks back in. Is there a state the reader can reach where the
   DOM and the state disagree? Consider: a browser restoring scroll on reload, the `onToggle` event
   firing during React's own commit, and a `<details>` opened by the browser's find-in-page.

4. **`buildDescription` and the tooltip.** It returns `null` off a build. Is the guard complete —
   what does `buildCommit()` actually return in each of the three environments (production build,
   `npm run dev`, vitest), and can the tooltip ever say something false?

5. **`/opensource`.** Every factual claim on it must be true and already true in `README.md`. Check
   the licence claim, the "most of it was written by AI agents" claim, and every outbound link's
   path — a 404 on this page is worse than no page. Also: is `/opensource` reachable and correct
   **signed out**, which is the reader it is for?

6. **Anything I have made worse.** Accessibility of the `<details>` rows (the chevron is
   `aria-hidden`, the summary contains an `h2`), the `nav aria-label="Releases"`, the contents list's
   `max-h-72 overflow-y-auto` on a small screen, and whether `changelog.css`'s two rules are right or
   cargo-culted.

Be adversarial. If a claim in the plan or in a code comment is not supported by the code, say so —
several of them are measurements, and a measurement that is wrong is worse than one that is missing.
And tell me if the conclusion I have drawn — that this is ready to commit — is wrong.
