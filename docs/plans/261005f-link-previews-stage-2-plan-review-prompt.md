# Plan review: stage 2 of link previews and SEO

Read `docs/plans/261005f-link-previews-and-seo-for-shared-links.md`, above all the section
"Stage 2: what Greg's five answers build". Greg's five decisions are under "Questions for Greg"
and are not up for review. The design that follows from them is.

This is a read-only review. Do not edit any file.

Read as much of the code as you need: `src/public/page-head.ts`, `src/public/page.ts`,
`src/store/public-reader.ts` (the `head` projection and `loadHead`), `src/assets.ts`,
`src/asset-delivery.ts`, `src/public/routes.ts` (the public asset route), `vercel.json`,
`public/robots.txt`, `index.html`, `scripts/client-shell.ts`, `vite.api.config.ts`,
`scripts/check-public-shell.ts`, `scripts/deploy.ts`, `src/web/page-title.ts`,
`src/web/router.ts`, `src/web/PublicReadableSharingPage.tsx`,
`docs/project/security-map.md`, `docs/project/deployment.md`.

Questions I most want answered, with file and line evidence where you can:

1. Vercel behaviour the plan relies on and cannot test locally. Is `/` answered from
   `dist/index.html` before `rewrites` are consulted? Does a rewrite to `/_pages/x.html` serve that
   static file? Will a `headers` rule whose `source` is a negative lookahead such as
   `/((?!(?:pricing|help)?$).*)` be accepted by Vercel and match as a plain regular expression
   would? If any of these is doubtful, name the safer form.
2. Anything else that reads `dist/index.html` or `GET /index.html` as "the default shell" and
   would silently go wrong once that file holds the homepage's head.
3. `Allow: /read/` for every crawler. Is the reasoning right that a Disallow alone lets a linked
   address be listed as a bare URL, and that letting crawlers in to read the noindex is the
   correct way to keep shared articles out? Is there a narrower form that does the same job?
4. The lead picture. Anything unsafe in putting `/api/public/asset/<slug>/<hash>.<ext>` in
   `og:image`? Is `entries` in document order, so "first" means first? Is the bytes floor a
   reasonable stand-in for dimensions?
5. Anything in the plan that makes a shared article, a reader's shelf, a profile, an admin page
   or an API path listable or crawlable that was not before, other than what the plan names.
6. Anything the plan forgot: a file, a test, a doc, a deploy gate.

Answer with findings ordered by severity (P0 to P3), each with what to change. End with one line:
`VERDICT: approve`, `VERDICT: approve with changes` or `VERDICT: reject`.
