1. **P1 — `/opensource` makes a false privacy promise.** [OpenSourcePage.tsx:117](/home/greg/code/spideryarn2/.claude/worktrees/changelog-toc-and-opensource/src/web/OpenSourcePage.tsx:117)

   A signed-out reader is told “nobody can” read their data. In reality, the operator can: `/privacy` explicitly says “assume we can see what’s in it,” and there is an administrator view across owners. This is also not a claim made by `README.md`. The intended, defensible claim seems to be that publishing the source does not publish reader data.

2. **P2 — Contents links suppress normal fragment navigation.** [ChangelogPage.tsx:527](/home/greg/code/spideryarn2/.claude/worktrees/changelog-toc-and-opensource/src/web/ChangelogPage.tsx:527), [ChangelogPage.tsx:602](/home/greg/code/spideryarn2/.claude/worktrees/changelog-toc-and-opensource/src/web/ChangelogPage.tsx:602)

   From `/changelog`, click Release 64. It opens and scrolls, but the address remains `/changelog`; reload loses the selected release, copying the address does not copy the release, and Back cannot undo the jump. The unconditional `preventDefault()` also suppresses Ctrl/Cmd-click. Separately, because the hash is read only on mount, a same-document `hashchange` can scroll to a release that React leaves closed.

3. **P2 — The app-link gate permits a cross-origin backslash URL.** [changelog.ts:199](/home/greg/code/spideryarn2/.claude/worktrees/changelog-toc-and-opensource/src/changelog.ts:199)

   An entry with `url: "/\\evil.example/phish"` passes `badLinkUrl`, reaches `splitEntryLinks` as an app link, and resolves as `https://evil.example/phish`. A modified click can leave the site; a plain click may instead throw when `history.pushState` is given the cross-origin URL. Reusing `shaFromCommitUrl` did not introduce this—the old logic behaved identically—but the comment’s “cannot reach here” guarantee is false.

4. **P2 — `buildDescription` accepts any non-`unknown` string as a commit.** [build-stamp.ts:77](/home/greg/code/spideryarn2/.claude/worktrees/changelog-toc-and-opensource/src/web/build-stamp.ts:77), [scripts/build-stamp.ts:80](/home/greg/code/spideryarn2/.claude/worktrees/changelog-toc-and-opensource/scripts/build-stamp.ts:80)

   Build with `SPIDERYARN_BUILD_COMMIT=release-candidate` or a malformed `VERCEL_GIT_COMMIT_SHA`; `resolveBuildStamp` accepts it and the tooltip says “built … from release,” which is false. Production normally receives a valid Vercel SHA, while dev and Vitest return `null`, but the guard does not uphold its stated contract for supported overrides.

5. **P2 — Duplicate commits within `commits` are still rendered twice.** [ChangelogPage.tsx:203](/home/greg/code/spideryarn2/.claude/worktrees/changelog-toc-and-opensource/src/web/ChangelogPage.tsx:203)

   Given `"commits": [SHA, SHA]`, parsing and the upstream copy checks report no error. `splitEntryLinks` preserves both values, producing two identical links and duplicate React keys. The test proves deduplication across `links` and `commits`, but not within `commits` itself.

6. **P3 — `Omit` does not provide the claimed compile-time guarantee.** [changelog.ts:303](/home/greg/code/spideryarn2/.claude/worktrees/changelog-toc-and-opensource/src/changelog.ts:303)

   TypeScript structural typing allows:

   ```ts
   const candidate = { ...fields, release: Number(raw.release) };
   return candidate;
   ```

   from a function returning `Omit<ChangelogVersion, "release">`. The current `{ ...v, release }` ordering still overwrites such a field correctly, so runtime numbering is safe; the comment merely overstates what the type catches.

7. **P3 — The “50 releases you can see at once” measurement is false.** [plan:168](/home/greg/code/spideryarn2/.claude/worktrees/changelog-toc-and-opensource/docs/plans/260907f-changelog-table-of-contents-collapsible-versions-version-numbers-and-an-opensource-page.md:168)

   At 1280×1000, the contents list is capped at 288px and the whole page is reported as 4,640px tall. A reader cannot see all 50 contents rows or all 50 summaries simultaneously. “50 releases available without expanding them” would describe the measured result accurately.

8. **P3 — The plan’s stage list contradicts its adopted decision and the code.** [plan:154](/home/greg/code/spideryarn2/.claude/worktrees/changelog-toc-and-opensource/docs/plans/260907f-changelog-table-of-contents-collapsible-versions-version-numbers-and-an-opensource-page.md:154)

   It still says the version is minted during deploy, added to the build stamp, and backfilled into 69 lines. The decision immediately above says the opposite: the number is display-only and minted nowhere.

Verdict: **not ready to commit**, principally because `/opensource` publishes a materially false privacy statement. The numbering counter itself is correct across blank lines, JSON failures, and schema-level failures; `shaFromCommitUrl` preserves the prior validator behavior; `/opensource` is routed signed out and its GitHub paths exist on `origin/main`; and the `<details>` synchronization is sound—find-in-page expansion fires `toggle`, which the handler feeds back into React state ([HTML Standard](https://html.spec.whatwg.org/multipage/interaction.html#interaction-with-details-and-hidden=until-found)). The `<summary><h2>` structure is valid, the first CSS marker rule is useful, and the second `display:flex` rule is redundant with `tw:flex` but harmless.

I independently reran 63 targeted tests successfully and ran the typecheck driver directly: all three TypeScript projects were clean.