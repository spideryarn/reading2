# 261026f Stage 2 code review — GPT Sol

## Findings

### S2-F1 — P1 — *See all* does not repeat the count's year window

**Evidence:** `src/citation-fulltext.ts:226-250`, `src/citer-link.ts:30-38`,
`tests/possible-citers.test.tsx:100-112`.

For a dated piece the server counts and lists only `fromYear` through the year in which it made
the request. The link instead writes `publication_year:>fromYear-1`, with no upper bound. OpenAlex
can hold future-dated records (Stage 1's S1-F1 already found that case), so *See all 134* can open a
different result set from the 134 beside the link. The test pins the wider, wrong filter.

**Change:** fixed. The answer now carries the server's `toYear` beside `fromYear`; the client
validates both as one coherent range; and the OpenAlex page filter repeats the same inclusive
`from-to` range. The server, link and tests changed together.

### S2-F2 — P2 — the phrase allowlist is wider and unbounded compared with the producer

**Evidence:** `src/citation-fulltext.ts:92-111`, `src/web/useCiters.ts:113-155`,
`src/web/ReceptionAndClaimsPanel.tsx:1985-1993`.

`phrase` reaches an `href`. The fixed OpenAlex origin and `URLSearchParams` mean the current code
does not permit an origin change or a second query parameter, but the ingress check does not match
the shape its comment promises: it accepts apostrophe-only words, leading/trailing apostrophes and
arbitrarily long strings, while `fulltextPhraseOf` emits words that begin and end in a letter or
number and caps the whole phrase at 300 characters. This weakens the security-map rule that a
registry value which reaches an `href` has an allowlist, and lets a malformed answer create an
unbounded link.

**Change:** fixed. The 300-character bound is shared with the browser-safe link module, the word
shape is tightened to the producer's output, and negative ingress tests include a would-be filter
fragment.

### S2-F3 — P2 — `PossibleCiters` rendering is not exhaustive

**Evidence:** `src/web/ReceptionAndClaimsPanel.tsx:1919-1947`.

`CitersAnswer` still has its `never` check for every `CitersResult`, but the new nested union does
not. `NoListAnswer` handles `found`, `common-phrase` and `none` with conditionals and silently treats
every other present kind like `unavailable`. A future `PossibleCiters` outcome could therefore be
added without making its on-screen meaning a type error.

**Change:** fixed. Rendering now switches exhaustively on the present nested result, with a `never`
default, while keeping absent and `unavailable` as the plain sentence.

### S2-F4 — P2 — the stale-list test does not exercise the switch transition it names

**Evidence:** `tests/use-citers.test.tsx:343-373`, `src/web/useCiters.ts:286-304`.

The test starts with the experimental switch off and has a non-conforming server send `possible`.
It proves that case is stripped, but not the required transition: an allowed `?with=possible`
request starts while the switch is on, the switch turns off, and that reply lands afterwards (or a
drawn list must disappear immediately). An implementation that keyed stripping to the request's
`withPossible` flag could pass the current test and leave the stale list visible.

**Change:** fixed. A pending-response test starts with the switch on, turns it off before the
response lands, and proves the answer is stripped; another proves an already drawn list disappears
without a request.

### S2-F5 — P2 — the copy and external-link accessibility tests share the implementation's premise

**Evidence:** `tests/possible-citers.test.tsx:78-112`,
`src/web/ReceptionAndClaimsPanel.tsx:1963-1994`.

The drawing test imports the same message constants the component renders. If the heading changed
to *Cited by*, or the caveats stopped saying the rows are unchecked and papers-only, the constant
and component would move together and the assertions would stay green. The link test checks its
address and `rel`, but not that the decorative external-link icon is hidden from assistive
technology. It also does not pin the deliberate non-heading `<p>` inside the already-headed
section.

**Change:** fixed. The test asserts the literal reader-facing promises independently of the
constants, and pins the paragraph semantics and `aria-hidden` icon.

## Checks

- The requested focused command passed: 6 files, 247 tests passed, 1 skipped.
- `npm run typecheck` could not start the compiler in this sandbox: `tsx` was denied its IPC socket
  under `/tmp` (`listen EPERM`). The repository's documented socket-free equivalent,
  `node --import tsx scripts/typecheck.ts`, passed all five projects and confirmed all 4,042 source
  files are covered.
- The visitor network guard passed for every Sources route exercised by its parameterised test:
  `tests/public-network-trace.test.tsx -t "starts no paid artefact mode, however it is reached"`
  (1 passed, 98 skipped). It checks that a visitor makes no request outside the public namespace,
  so `/api/citers` and `?with=possible` remain unreachable there.
- Negative controls were observed red before restoration: the old unbounded year link, broad phrase
  validator and request-keyed switch stripping failed four focused assertions; adding a synthetic
  `PossibleCiters` kind failed both client and test typechecks at the `never`; dishonest copy failed
  the literal UI assertion.
- Scoped Biome lint completed with no errors. It reported one warning and two informational
  complexity notices on unchanged lines of `ReceptionAndClaimsPanel.tsx`; none is in this stage's
  diff. `git diff --check` passed.
- The additional whole-repository `npm test` gate could not run here: the private Postgres lane was
  denied its connection to Docker/`127.0.0.1:54362` and the test harness deliberately stopped with
  *No database, and every test that touches the store needs one.* This is an environment refusal,
  not a test failure; the requested scoped suite above did run and pass.
