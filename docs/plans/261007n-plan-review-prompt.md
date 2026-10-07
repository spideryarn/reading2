You are reviewing a short implementation plan in the Spideryarn repo (this checkout). Read-only: do not edit any file.

Plan: docs/plans/261007n-the-last-six-artefact-reads-answer-none-yet-as-200-null.md

Its predecessor, already landed, is docs/plans/261006h-the-other-seven-artefact-reads-answer-none-yet-as-200-null.md; follow its pattern. Relevant code: src/routes.ts (orNullWhenNotMadeYet, and the GET routes for tweets, relations, skim, sketch, illustrated, arc), src/store/artefact-not-made-yet.ts, src/web/lib/api.ts (NONE_YET_AS_NULL), src/web/useTweets.ts, useSkim.ts, useRelations.ts, useArc.ts, useSketch.ts, useIllustrated.ts, and tests/none-yet-is-not-a-404-route.test.ts, tests/api-fetch-offline.test.ts, tests/none-yet-is-not-a-404-hooks.test.tsx.

Check: (1) is any reader of these six URLs missing from the plan (grep the whole repo, including the public reader, MCP server, offline prefetch, tools/)? (2) does any route's surrounding logic (withProfileChanged, skim's parallel resolveProfile, illustrated's plate route, sendPlate) make the wrap wrong or unsafe? (3) does Illustrated belong on the list? (4) anything in the hooks (useArc's fromPayload, useSketchReadiness, useSketchCaption) where null handling would change what a reader sees? (5) anything else wrong or missing.

Answer with a verdict (build / build with changes / don't), then numbered findings with priority P0-P3, file:line evidence, and the fix. Be brief.
