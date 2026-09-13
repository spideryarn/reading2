# Plan review: 260913a — drop the "Use your profile" checkbox

Read-only review of a plan, before anything is built. Do not change any file.

## The candidate

`docs/plans/260913a-drop-the-use-your-profile-checkbox.md`, committed on branch
`worktree-fb3b-drop-use-profile-checkbox` (the commit that adds it is the tip when you start). The
owning doc is `docs/project/reader-profile.md`. Start with `src/web/WrittenForYou.tsx`
(`<UseProfile>`) and its seven call sites — `rg -n "UseProfile|useHasProfile|useProfile" src/web` —
but that list does not limit scope; the server side is `src/routes.ts` (search `useProfile`) and
`src/jobs.ts` (`sameWork`).

The request, from Greg (the product owner): remove the "use your profile" checkbox everywhere and
always use the profile, so the UI is tidier and more compact.

## What to attack

1. Is the inventory complete? Any surface offering this choice that the plan misses — including one
   that sends `useProfile: false` by another route, or a test that pins today's behaviour.
2. Is "the server is untouched" right? Any server path whose behaviour depends on the client
   sometimes sending `false` that now changes meaning.
3. § "The reader who has it OFF today": is each bullet accurate? In particular verify the glossary
   Find-more claim against `useGlossary` (`find`/`more` → `run`) and `existingFor` in
   `src/glossary.ts` — does Find more on a plain (`profileHash: null`) list really rewrite rather
   than append, and does the reader keep their `?term=` links?
4. Is deleting `useHasProfile` safe — does anything other than the checkbox's rendering read
   `hasProfile`?
5. Is keeping a labelled "👤 Your profile" button the right residue, or does it defeat "tidier and
   more compact"?

## Severity

P0 data loss / security / incorrect charging / broadly unusable · P1 user-visible wrong behaviour or
an authoritative contract violated · P2 design risk, nothing wrong today · P3 prose. Refuse only on
an established P0/P1 (direct evidence, no unresolved inference). Give every finding an ID, F1…

## My own suspicions (worth less; spend most of the run elsewhere)

- The glossary Find-more consequence in item 3 is the claim I am least sure of.
- Whether the chat composer's row inside the Remember panel lays out differently once the checkbox
  is gone (`src/web/styles/mode-band.css` `.remember .prof-row`).

## Answer

A verdict (build as written / build with changes / rethink), then findings by ID with severity,
evidence (file:line), and the change you would make.
