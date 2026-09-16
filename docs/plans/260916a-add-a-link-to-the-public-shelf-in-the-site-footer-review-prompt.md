# Review this plan before it is built

You are reviewing a **plan**, read-only. Do not edit anything. The repository is a TypeScript/React
reading app (Spideryarn). You are in a git worktree at
`.claude/worktrees/footer-public-shelf-link`; read files from there.

## The request

A user feedback report from the product owner, verbatim:

> Add a link in all the footers to the publicly readable shelf alongside, you know, feedback and
> pricing etc

The "publicly readable shelf" is `/read/public`. This is a small change and the plan should stay
small; the review's job is to find where it is **wrong**, not to make it bigger.

## The plan

`docs/plans/260916a-add-a-link-to-the-public-shelf-in-the-site-footer.md` — read it in full.

## The code it concerns

- `src/web/SiteFooter.tsx` — the one footer component and its `LINKS` array. Read the whole header;
  it is long and it is the design record.
- `src/web/router.ts` — `PUBLIC_LIBRARY_HREF`, `CHANGELOG_LABEL`, `Route`, `parseRoute`.
- `src/messages.ts` — the shelf heading constant and the section around it.
- `src/web/CommandBar.tsx` — the `/read/public` row, around line 320.
- `src/web/page-title.ts` — the `public-library` case, around line 318.
- `src/web/PublicReadableSharingPage.tsx` — the `← Back` link, around line 135.
- `src/web/SiteBits.tsx` — `SiteNav`, whose header says the shelf is "deliberately not in `LINKS`
  below or in `SiteFooter`'s".
- `src/web/PublicLibraryPage.tsx` — the shelf page itself, which mounts no footer.
- `tests/site-footer.test.tsx`, `tests/command-bar.test.tsx`, `tests/page-title.test.ts`,
  `tests/client-imports.test.ts`.
- `docs/project/public-shelf.md`, `docs/project/marketing-pages.md`, `docs/project/website-text.md`.

## The conclusions I would least like to be wrong about

State explicitly whether each is right or wrong, with the file and line you checked it against.
Do not take my word for any of them.

1. **There is exactly one site footer in this codebase**, so "all the footers" is one array entry.
   I swept for `<footer>` and `role="contentinfo"` and classified three other hits as not-site-footers
   (two dialog action rows and the colophon inside an exported article bundle). Did I miss a footer —
   including any server-rendered HTML, an edge/SSR head or shell, an email template, or a page that
   hand-writes a row of site links without using the component?

2. **The label should be the existing heading constant ("Shared articles"), shared with the command bar**,
   rather than a new string or the command bar's current "Public shelf". My count of the existing
   homes of this page's name is in § 1 of the plan. Is that count right? Is there a surface I have
   not found that names this page, and would my change leave the site naming it two ways anywhere?

3. **`messages.ts` is the right home and `router.ts` is not**, because `router.ts` imports React and
   `messages.ts` is on `tests/client-imports.test.ts`'s `SHARED` allowlist. Check that `SiteFooter`,
   `CommandBar` and `page-title.ts` may each legally import `messages.js` under that test's rules,
   and that nothing about the shelf-name constant living there breaks a server/client boundary.

4. **`FooterPage` must gain `"public-library"`**, and the self-drop it enables can never fire,
   because the footer is never drawn under `/read/*`. Is that inertness actually true — is there any
   route or fallback in `App.tsx` under which a page that mounts `SiteFooter` is drawn while
   `useRoute()` returns `public-library`? If it can fire, the plan's comment would be a lie in the
   source.

5. **The `/read/*` footer exclusion is untouched**, and adding a link *to* the shelf is not the same
   act as giving the shelf a footer. The file's header records a previous agent reinterpreting that
   exclusion and being told off for it, so I want this checked hard: am I rationalising in the same
   way, in either direction?

## Also tell me

- **The constant keeps its heading-specific name** although it becomes a nav label too. I
  judged a rename to `PUBLIC_SHELF_LABEL` to be churn and chose a docblock line instead. Is that the
  lazy answer? It is about seven call sites.
- **Row position**: the plan puts the entry after *Features*. Say if you disagree and why.
- **The narrow-window claim.** `SiteFooter.tsx` contains a measured claim — `scrollWidth -
  clientWidth === 0` at 1440, 390 and 320 — that an eighth link invalidates until re-measured. Stage 3
  re-measures. Is there anything else in the tree that carries a **count** or a **measurement** of
  this row that would silently become false, in code, in a comment, in a test, or in a doc?
- Anything the plan proposes that is more complexity than the request needs. The house rule is
  simplest version first, and I would rather cut than add.

## Output

Findings ranked by severity, each with file:line and what you actually checked. If a conclusion above
is right, say so in one line rather than restating it. Write your answer to the `--output` file.
