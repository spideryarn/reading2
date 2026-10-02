# Build: 261001s stage 3b, part 3 — Skim, and a chat-wire adapter for four simple calls

You are the **builder**; Claude reviews every hunk. Do not dispatch any reviewer yourself.

Read: the plan (Ledger included), your survey (`docs/plans/261001s-reviews/stage3a-survey-sol.md`),
parts 1–2 (`0f53bfc8d`, `de5015eed`) for the Messages pattern, and the six existing strict
chat-wire users (`src/paper-metadata.ts`, `src/pdf-authors.ts`, `src/pdf-figure-locate.ts`,
`src/pdf-frontmatter.ts`, `src/pdf-read.ts`, `src/shelf-terms/model-scores.ts`) for the chat shape:
`response_format: {type: "json_schema", json_schema: {name, strict: true, schema}}`.

## Scope

1. **Skim** (`src/skim.ts`, Messages wire): schema via `withMessagesJsonSchema`, exactly as parts
   1–2. Same binding rule: the schema encodes the prompt's existing contract, never looser than
   the prompt and never stricter than the parser; **no prompt text changes**; version stamp moves
   with "the request gained a schema; the prompt text is unchanged".
2. **A chat-wire adapter** in `src/messages-structured-output.ts` (or a sibling module if that is
   cleaner — say why): it builds `response_format` from a schema name and schema, running the same
   validator. Do not migrate the six existing users onto it in this part (they work; say in your
   report whether they would be a one-line change each).
3. **Four non-streaming, tool-free chat calls** onto the adapter, per the survey rows:
   - `src/simple-check.ts` — keep `n` and `why` optional (do not tighten the measured checker),
     and add the `finish_reason` / `refusal` checks it lacks before its parse (the survey's finding).
   - `src/citation-paper-passages.ts`.
   - `src/debate.ts` synthesis call only (themes and key sources) — remove its fence handling only
     if the schema makes it unreachable, and keep passes A and B exactly as they are.
   - `src/referee-mirror.ts` — keep the raw-delta keepalive events; the schema constrains only the
     completed answer. Keep the existing closed-object-on-`length` behaviour.
   Preserve each call's `require_parameters` routing and provider choice; if a model/provider on
   that route may not support strict `json_schema`, say so with the evidence rather than guessing.

## Out of scope (deferred; do not touch)

Labels, scoped Structure expansion, Search, Referee criteria and claims, citation-find / lookup /
source-guess, Debate passes A and B, Referee candidates, chat-tool and Realtime tool arguments,
`src/hierarchy*.ts`.

## Tests, gates, report

Red-first per call: the request carries the schema (and, for Skim, the effort intact); simple-check
refuses a non-`stop` finish and a refusal before parsing. Existing tests green. Typecheck (fallback
allowed, stated); vitest on every touched test file plus `tests/messages-structured-output.test.ts`
and `tests/doc-links.test.ts`. No state-changing git, no commits. Report files, red evidence, gate
output verbatim, provider-support concerns, and the cheapest eval Claude can run per call for a
validity count.
