## Your zone: the reader client

`src/web/reader/Reader.tsx` (4.6k lines) and `src/web/reader/*`, the per-mode hooks
(`src/web/useGlossary.ts`, `useIdeas.ts`, `useQuotes.ts`, `useTimeline.ts`, `useFaq.ts`,
`useCitations.ts`, `useDebate.ts`, `useQuiz.ts`, `useSimple.ts`, `useSketch.ts`,
`useIllustrated.ts`, `useTweets.ts`, `useSkim.ts`, `useSearch.ts`, `useCrossrefs.ts`,
`useClaims.ts`, `useCriteria.ts`, `useMirror.ts`, `useComments.ts`, `useChat.ts`), the shared read
machinery (`src/web/useOrderedRead.ts`, `useStepJob.ts`, `useAutoRun.ts`, `src/web/lib/api.ts`,
`src/web/lib/sse.ts`), `src/web/Metadata.tsx`, `src/web/Dock.tsx`, `src/web/activation.ts`,
`src/web/params.ts`, `src/mode-catalog.ts`, and the panels only as far as needed to see what they
do with a hook's result. Read `docs/project/mode.md` first.

Prior doc: `docs/investigations/261003b-fifth-sweep-web-client.md` and
`261003b-fifth-sweep-review-sol-on-server-and-web.md`.

Zone-specific questions:

- **The hooks as siblings.** Build a table, one row per hook: the shape it returns for a read
  (fields; which booleans; is "asking / failed / known-empty / known-with-value / stale" each
  distinguishable?), whether it uses `useOrderedRead`, how it treats a 404 versus a network failure
  versus a malformed reply, whether a retry exists, whether a slug or reader change resets it,
  whether a late answer for an old slug can land, how it aborts. Mark every cell that differs from
  the majority and say whether a reason is written anywhere.
- **An approved piece of work depends on your table**: replacing "a read is a value plus booleans"
  (postmortems 261004c, 261004f, 261005q, 261005r, 261006b, 261006g, 261005i — read them) with one
  discriminated type, roughly `asking | failed | known`, adopted by the per-mode hooks, starting
  with a ONE-hook spike. Say:
  (a) which hook is the best spike (representative, well tested, not the hardest) and why;
  (b) what the type must be able to say that the three-word sketch cannot (a refresh in flight over
  a known value? a failed refresh over a known value? a run in flight? never-had versus
  no-longer-has?) — from the hooks' real states, not in the abstract;
  (c) which consumers (panels, Metadata, Dock, Reader) read the booleans today and would change;
  (d) whether `src/web/public-api.ts` § `PublicRead<T>` is the thing to generalise or a different
  job;
  (e) honestly, whether the type would have prevented each of the seven postmortems, one line each.
  The fifth sweep rejected "a generic artefact-read hook": this is a TYPE for the result, not a
  shared hook. Say if you think it collapses into the rejected thing anyway, or is not worth it.
- `Reader.tsx`: not its size (splitting is rejected). Its **reasons to change**, effects whose
  dependency lists encode an ordering, state that duplicates the URL, and per-mode branches
  (`mode === "..."`) that a new mode would have to find.

Finding IDs: WC1, WC2, ...
