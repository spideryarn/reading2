# An import into a `.vercelignore`d directory built everywhere except Vercel

**2026-09-07.** A production deploy pushed `main`, applied a migration, and shipped nothing. The
build failed on Vercel and only on Vercel — green on every laptop, and green in the deploy's own
`build` gate, which exists precisely to answer "does this commit build?".

```
[UNRESOLVED_IMPORT] Could not resolve '../../docs/changelog/versions.ndjson?raw'
  in src/web/ChangelogPage.tsx:44
```

## The class: a gate that assembles a different input than the thing it is gating

**This is not "somebody imported a missing file".** The file was there. It was committed, it was
tracked, `ls` found it, the editor resolved it, and three separate compilers agreed.

`.vercelignore` prunes the upload **before** Vercel's build machine ever sees the tree, and `docs`
is on that list. So there were two builds with two different inputs, and only one of them was the
one that counts:

```
        THE TREE                          THE UPLOAD                    WHAT RAN
   (laptop, and the gate)          (.vercelignore applied)

   src/web/ChangelogPage.tsx  ──┐   src/web/ChangelogPage.tsx  ──┐
   docs/changelog/*.ndjson    ──┤          ( pruned )            │
                                │                                │
                          build OK ✅                      build FAILS ❌
```

The general form: **a check is only evidence about what it was given.** Our `build` gate went to
real trouble to be honest about the _commit_ — it builds a `git worktree` of the exact sha, not the
working tree, because a green build here had shipped a broken `main` three times before
([deployment.md](../project/deployment.md), and the header of [`scripts/deploy.ts`](../../scripts/deploy.ts)).
It got the _commit_ right and the _input_ wrong, and the second was invisible because nothing in the
repo wrote down that the build machine receives a filtered tree.
[written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md) is the other half of it — prose cannot fail, so nobody checks it — and [silent-success.md](../reusable/silent-success.md) is the family: the check agreed
with the code because it shared an assumption with it.

**The near-identical trap that will come round again:** `.vercelignore`'s comment said _"Nothing in
the build or the running server reads any of these."_ That was a claim about the code, written in a
config file, with nothing anywhere checking it stayed true. A comment is not a constraint.

## What introduced it

[`49f06030`](https://github.com/spideryarn/reading2/commit/49f0603054717dc81b85a005ba881817ab3959d9),
2026-09-06, "A page for the changelog, and a runner that need not be reinvented" — the commit that
added `/changelog`. The 210 KB of committed version data lived beside the process that writes it, in
`docs/changelog/`, and the page imported it from there through Vite's `?raw`.

There was a guard that could have caught it and instead waved it through.
`tests/client-imports.test.ts` enforces that the client only reaches modules flat under `src/`, and
this import needed an exception to land: a set literally named `OUTSIDE_SRC_ALLOWED`, holding this
one specifier. Its comment reasoned that the file is _data, not code_ and that there was _no `src/`
leaf to move it into_. Both halves were true. The conclusion was still wrong, because the rule the
exception was reasoning about ("shared modules stay leaves") is not the rule that mattered here
("everything the build reads must survive the upload") — and nobody had written the second rule
down, so the exception could not be weighed against it.

## The fix, and why it is this one rather than the other one

The file moved to `src/web/changelog-versions.ndjson`, beside its one reader.

The alternative — carving `docs/changelog/versions.ndjson` back into the upload via `.vercelignore`
— was rejected. It works, but it needs `docs` to become `docs/*` plus two negations (gitignore
semantics will not re-include a child of an excluded _directory_), and it leaves a notes folder
quietly load-bearing for the production build. Greg chose the move on 2026-09-07.

Moving it beside the page is better than moving it merely _inside_ `src/`, which is where it went
first: from `src/web/`, the specifier is `./changelog-versions.ndjson?raw` and never leaves the
client at all, so **`OUTSIDE_SRC_ALLOWED` could be deleted rather than rewritten.** GPT Sol's review
made that call, and also noted that the rewritten version of the exception was still an unchecked
escape hatch — it returned before resolving the path, so a future entry could reintroduce the
original bug with the test staying green. An exception that has to be kept safe by hand is worse
than no exception.

## What would have caught it, ranked

1. **The `build` gate builds without the pruned directories.** Implemented here, in
   `maskPrunedRoots` in [`scripts/deploy.ts`](../../scripts/deploy.ts): the throwaway worktree has
   every content root named in `.vercelignore` renamed aside for the duration of the build, and
   restored immediately after, because the later gates need `tests/` and the fixture corpus. The
   list is read out of `.vercelignore` itself so it cannot drift from it. This catches static
   imports, Vite globs, config reads and build scripts — everything the real compiler resolves —
   and costs nothing, because that build was already happening. `explainBuildFailure` names the
   directory when it fires, since otherwise the failure reads as insane: the file is right there.
2. **Not a lexical ban on naming a pruned path**, which was the tempting version. It produces false
   positives that are correct code: `vite.config.ts` reads `supabase/config.toml` in an
   `apply: "serve"` plugin, and `src/store/blobs.ts` can fall back to `data/_blobs` in a bundle that
   never takes that branch in production. A rule that fires on honest code gets exceptions added to
   it, and exceptions are what caused this.
3. **What is still not covered:** a runtime `readFileSync` of a pruned path in the deployed
   function. A build cannot see it. That is a boot-refusal or a deployed smoke-test question, and it
   is a different boundary — recorded here rather than fixed.

## The other thing this changed

[deployment.md](../project/deployment.md) said the Git build machine "clones the repo". It does not;
it receives a filtered tree. An evergreen description that is subtly untrue is how the next person
reaches the same wrong conclusion, so it now says so.
