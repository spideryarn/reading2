# Plan review: 261003k (the command bar takes a sentence; a fast model picks the command)

You are reviewing a PLAN, read-only. Candidate: the file
docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md in this
worktree, at the commit named on the last line of this prompt. Nothing is built yet.

Context to read (it does not limit scope):
- docs/project/chat-llm-help-commands-vision.md (the interface model, § The line, § Decided)
- docs/investigations/261002c-jev-picks-a-command.md and evals/command-pick/ (the first measurement)
- docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md (what landed today, and its ledger)
- src/web/command-match.ts (Command, commandId, commandText, rankCommands, parseArgumentQuery)
- src/web/command-proposal.ts (CommandProposal, RISK, resolveArgument, runProposal)
- src/web/CommandBar.tsx (the `commands` memo, `results`, `activate`, `said`, `inFlight`, `opening`, NO_MATCH, argumentRows/argumentCommand, the dictation field)
- src/ai-call.ts § decisions (openRouterDecisions, DecisionQuestion, readDecisions), src/quick-search.ts as its one caller
- src/routes.ts § AUTH_ROUTES and the `POST /api/transcribe` row and handler (the template named), tests/authenticated-api-route-contract.test.ts
- docs/project/ai-gateway.md (the no-per-reader-cap decision, about lines 989-1026), docs/project/cost-tracking.md, docs/project/security-map.md, docs/project/experimental-features.md

Do an independent pass first. Would this plan, built as written, produce wrong behaviour; a
security hole (the client sends the option list that goes into a model prompt; the answer runs a
command); a paid call the reader did not ask for or an endpoint usable as a free model proxy; a
command run that the accepted line says must be proposed; a broken contract; or a simpler design
missed? Is anything in the plan contradicted by the code? Is the eval (Stage 1) able to answer the
question it asks, and is its predeclared reading sound? Is the stage cut right?

Severity: P0 data loss / exploitable security / incorrect charging / service unusable; P1
user-visible wrong behaviour or a contract violated; P2 design risk with no wrong behaviour today;
P3 prose. Give every finding an ID (F1, F2, …), a severity, the evidence (file:line), and the fix
you would make. End with a verdict: build as is / build with these changes / rethink.

## My own suspicions (worth less; spend most of the run elsewhere)

1. "Runs at once" for a sure navigate pick: which of the bar's row kinds are really navigate-only?
   A mode row can generate on open (`commandGenerates`), a page row can too. Is "not generates and
   not writes/spends" a complete test, or is there a row that writes without saying so (Archive)?
2. The client-supplied option list: is validating the answer against the same list enough, or
   should the server hold the words?
3. No per-reader rate limit on the new route, on the precedent of dictation and quick search.
4. The Jev "one yes/no question per word" argument trick: worth an arm, or noise?
5. Whether `words must appear in the sentence` is too strict for dictated speech (a tag of
   "neuroscience" said as "neuro science").
