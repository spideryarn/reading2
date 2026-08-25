# Third-party library selection

> **Provenance.** Copied verbatim 2026-08-24 from
> [gjdutils `docs/instructions/THIRD_PARTY_LIBRARY_SELECTION.md`](https://github.com/gregdetre/gjdutils/blob/main/docs/instructions/THIRD_PARTY_LIBRARY_SELECTION.md),
> renamed to this repo's lower-case kebab-case convention (AGENTS.md § How we write docs here). It
> references `SOUNDING_BOARD_MODE.md` and `WRITE_DEEP_DIVE_DOC.md`, which live in gjdutils and not
> here; treat those two steps as "talk it over with Greg, then write the decision down under
> `docs/project/`".
>
> Followed for the test runner — see [docs/project/testing.md](../project/testing.md) — for
> tooltips, see [docs/project/tooltips.md](../project/tooltips.md) — and for the auth provider, see
> [docs/research/auth-options.md](../research/auth-options.md).

## Selection Criteria

- **IMPORTANT** Long-lasting community, lots of docs/discussion/examples (so there will be lots of pretraining data to help LLM coding models).
- Well-designed API: Intuitive, composable, type-safe (for TypeScript).
- Plus any other criteria from the user.


## Process
- Understand requirements first. see `SOUNDING_BOARD_MODE.md`. Ask questions if you need to clarify.
- Read relevant code/docs to understand the relevant technology stack & architecture for this project.
- Run `date` to get today's date, so you can judge recency.
- Search the web. Evaluate options, tradeoffs.
- Usually prefer the most recent stable version, but also consider whether an older, more popular version with more pretraining data would be a better fit. Discuss with the user if the answer isn't obvious.
- Make a recommendation.
- Discuss with user.
- Write a doc describing the chosen library, as per `WRITE_DEEP_DIVE_DOC.md`.

